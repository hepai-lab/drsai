"""GfsProvisioner: 进程级别 per-email 的 ``GfsUserClient`` 缓存 & 凭证落盘.

设计要点：
- 单进程内每个 email 复用同一个 ``GfsUserClient`` 实例（boto3 client 内含连接池, 线程安全）.
- 推荐通过 ``credential_store`` 参数传入统一的 ``CredentialStore`` 进行凭证持久化；
  若未传入则回退到旧的文件缓存目录 ``~/.drsai/.cache/gfs/<email>.json``.
- 凭证文件 ``chmod 600``，目录 ``chmod 700``（CredentialStore 内部保证）.
- 首次拉取 / 凭证失效自动重发 + 重试一次.
- 进程内对同一 email 的"首次开通"加锁，避免并发请求重复发 AKSK.
"""

from __future__ import annotations

import errno
import json
import logging
import os
import stat
import threading
from dataclasses import asdict
from pathlib import Path
from typing import TYPE_CHECKING

from .admin_client import (
    GfsAdminClient,
    GfsAdminError,
    GfsCredential,
    get_admin_client,
)
from .user_client import GfsUserClient

if TYPE_CHECKING:
    from ..user_profile.credential_store import CredentialStore


logger = logging.getLogger(__name__)


ENV_CACHE_DIR = "DRSAI_GFS_CACHE_DIR"


def _default_cache_dir() -> Path:
    explicit = os.environ.get(ENV_CACHE_DIR)
    if explicit:
        return Path(explicit).expanduser().resolve()
    return Path.home() / ".drsai" / ".cache" / "gfs"


# ---------------------------------------------------------------------- #
# 个人模式：直接用用户自己的 AKSK，不经过 admin OpenAPI
# ---------------------------------------------------------------------- #
ENV_PERSONAL_ACCESS_KEY = "GFS_ACCESS_KEY"
ENV_PERSONAL_SECRET_KEY = "GFS_SECRET_KEY"
ENV_PERSONAL_BUCKET = "GFS_BUCKET"
ENV_PERSONAL_EMAIL = "GFS_USER_EMAIL"  # 可选，用于日志/缓存键


def credential_from_env(
    *,
    email: str | None = None,
    s3_endpoint: str | None = None,
) -> "GfsCredential":
    """从环境变量直接构造 GfsCredential（个人模式，不依赖 admin key）.

    需要的环境变量：
      - ``GFS_ACCESS_KEY``     用户自己的 access key
      - ``GFS_SECRET_KEY``     用户自己的 secret key
      - ``GFS_BUCKET``         用户的完整桶名 (e.g. "20235-xiongdb")
      - ``GFS_USER_EMAIL``     可选，仅用于日志（默认 "personal@local"）
      - ``GFS_S3_ENDPOINT``    可选，默认 https://fgws3-gfs.ihep.ac.cn

    Args:
        email: 显式指定的用户标识，优先级高于 ``GFS_USER_EMAIL`` 环境变量。
        s3_endpoint: 显式 S3 endpoint，优先级高于 ``GFS_S3_ENDPOINT``。

    Raises:
        RuntimeError: 当 AKSK 或 bucket 任一项缺失时。
    """
    from .admin_client import (  # 局部导入避免循环
        DEFAULT_S3_ENDPOINT,
        ENV_S3_ENDPOINT,
        GfsCredential,
    )

    ak = os.environ.get(ENV_PERSONAL_ACCESS_KEY)
    sk = os.environ.get(ENV_PERSONAL_SECRET_KEY)
    bucket = os.environ.get(ENV_PERSONAL_BUCKET)
    missing = [
        name
        for name, val in (
            (ENV_PERSONAL_ACCESS_KEY, ak),
            (ENV_PERSONAL_SECRET_KEY, sk),
            (ENV_PERSONAL_BUCKET, bucket),
        )
        if not val
    ]
    if missing:
        raise RuntimeError(
            "GFS personal mode requires env vars: "
            f"{', '.join(missing)}. "
            "请在 https://gfs.ihep.ac.cn 网页端密钥管理页拿到自己的 AK/SK，并设置："
            f"{ENV_PERSONAL_ACCESS_KEY}, {ENV_PERSONAL_SECRET_KEY}, {ENV_PERSONAL_BUCKET}."
        )

    resolved_email = (
        email
        or os.environ.get(ENV_PERSONAL_EMAIL)
        or "personal@local"
    )
    resolved_endpoint = (
        s3_endpoint
        or os.environ.get(ENV_S3_ENDPOINT)
        or DEFAULT_S3_ENDPOINT
    )

    return GfsCredential(
        access_key=ak,
        secret_key=sk,
        bucket=bucket,
        s3_endpoint=resolved_endpoint,
        email=resolved_email,
        owner_id="",  # 个人模式下没有 admin 给的 owner_id
        expiration=-1,
        status="active",
        resources=[],
    )


def get_personal_user_client(
    *,
    email: str | None = None,
    s3_endpoint: str | None = None,
    healthcheck: bool = True,
) -> GfsUserClient:
    """个人模式入口：用环境变量里的 AKSK 直接构造 ``GfsUserClient``.

    与 ``get_user_client(email)`` 的区别：
      - 不调 admin OpenAPI，不需要 ``GFS_OPENAPI_KEY``
      - 不写磁盘缓存（凭证已经是用户自己保管的，没必要再落盘）
      - 每次返回新实例（boto3 client 内部已有连接池，开销很小）

    Args:
        email: 显式 email，覆盖 ``GFS_USER_EMAIL``。
        s3_endpoint: 显式 endpoint，覆盖 ``GFS_S3_ENDPOINT``。
        healthcheck: 创建后是否做一次 ``list_objects_v2`` 探活。
    """
    cred = credential_from_env(email=email, s3_endpoint=s3_endpoint)
    cli = GfsUserClient(cred)
    if healthcheck and not cli.healthcheck():
        from .admin_client import GfsAdminError
        raise GfsAdminError(
            "PERSONAL_CREDENTIAL_UNUSABLE",
            f"S3 healthcheck failed for personal credential "
            f"(bucket={cred.bucket}, ak={cred.access_key[:8]}...). "
            "请确认 AK/SK 与 bucket 匹配，且当前网络能访问 GFS S3 endpoint。",
            status=500,
        )
    logger.info(
        "GFS personal mode: bucket=%s ak=%s... email=%s",
        cred.bucket, cred.access_key[:8], cred.email,
    )
    return cli


def _safe_filename(email: str) -> str:
    """email → 文件名，保持可读性同时避免奇字符."""
    keep = []
    for ch in email:
        if ch.isalnum() or ch in "-_.@":
            keep.append(ch)
        else:
            keep.append("_")
    return "".join(keep) + ".json"


class GfsProvisioner:
    """进程级单例：管理多个用户的 GFS 凭证 & client."""

    _singleton: "GfsProvisioner | None" = None
    _global_lock = threading.Lock()

    @classmethod
    def get(cls) -> "GfsProvisioner":
        if cls._singleton is None:
            with cls._global_lock:
                if cls._singleton is None:
                    cls._singleton = cls()
        return cls._singleton

    @classmethod
    def set_credential_store(
        cls,
        credential_store: "CredentialStore",
    ) -> None:
        """注入统一的 ``CredentialStore`` 到 GfsProvisioner 单例.

        应在进程启动早期（如 ``DrSai.__init__``）调用，否则 GfsProvisioner
        会回退到旧的文件缓存模式。
        """
        provisioner = cls.get()
        provisioner._cred_store = credential_store

    @classmethod
    def reset(cls) -> None:
        """测试用：清空单例。生产代码不要调."""
        with cls._global_lock:
            if cls._singleton is not None:
                cls._singleton._user_clients.clear()
            cls._singleton = None

    # ------------------------------------------------------------------ #
    def __init__(
        self,
        admin: GfsAdminClient | None = None,
        cache_dir: Path | str | None = None,
        credential_store: "CredentialStore | None" = None,
    ) -> None:
        self.admin: GfsAdminClient = admin or get_admin_client()

        # CredentialStore（优先）：与 LLM API Key 存储统一
        self._cred_store: CredentialStore | None = credential_store

        # 旧文件缓存（回退兼容）
        self.cache_dir: Path = (
            Path(cache_dir).expanduser() if cache_dir else _default_cache_dir()
        )

        self._user_clients: dict[str, GfsUserClient] = {}
        self._per_user_locks: dict[str, threading.Lock] = {}
        self._locks_guard = threading.Lock()

        if self._cred_store is None:
            # 没有 CredentialStore 时才创建旧缓存目录
            self._ensure_cache_dir()

    def _ensure_cache_dir(self) -> None:
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        try:
            os.chmod(self.cache_dir, stat.S_IRWXU)  # 0700
        except OSError as e:
            # Windows / 特殊 fs 上 chmod 可能失败；不致命
            logger.warning("chmod 0700 %s failed: %s", self.cache_dir, e)

    def _user_lock(self, email: str) -> threading.Lock:
        with self._locks_guard:
            lock = self._per_user_locks.get(email)
            if lock is None:
                lock = threading.Lock()
                self._per_user_locks[email] = lock
            return lock

    # ------------------------------------------------------------------ #
    # 凭证落盘 / 读盘
    # ------------------------------------------------------------------ #
    def _cred_path(self, email: str) -> Path:
        return self.cache_dir / _safe_filename(email)

    def _load_cached(self, email: str) -> GfsCredential | None:
        # 优先从 CredentialStore 读取
        if self._cred_store is not None:
            data = self._cred_store.get_credential(email, "gfs")
            if data:
                try:
                    # CredentialStore 附加的元数据字段不影响 GfsCredential 构造，
                    # 但需去除避免 unexpected keyword argument
                    data.pop("cred_type", None)
                    data.pop("user_id", None)
                    data.pop("updated_at", None)
                    return GfsCredential(**data)
                except (TypeError, ValueError) as e:
                    logger.warning(
                        "corrupt gfs credential in store for %s: %s", email, e
                    )
                    self._cred_store.delete_credential(email, "gfs")
                    return None

        # 回退：从旧文件缓存读取
        p = self._cred_path(email)
        if not p.exists():
            return None
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
            return GfsCredential(**data)
        except (json.JSONDecodeError, TypeError, ValueError) as e:
            logger.warning("corrupt cache %s, ignoring: %s", p, e)
            try:
                p.unlink()
            except OSError:
                pass
            return None

    def _save_cached(self, cred: GfsCredential) -> None:
        # 优先通过 CredentialStore 保存
        if self._cred_store is not None:
            self._cred_store.save_credential(
                cred.email,
                "gfs",
                asdict(cred),
            )
            return

        # 回退：旧文件缓存方式
        p = self._cred_path(cred.email)
        tmp = p.with_suffix(".json.tmp")
        tmp.write_text(
            json.dumps(asdict(cred), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        try:
            os.chmod(tmp, stat.S_IRUSR | stat.S_IWUSR)  # 0600
        except OSError as e:
            logger.warning("chmod 0600 %s failed: %s", tmp, e)
        os.replace(tmp, p)

    def evict(self, email: str) -> None:
        """删除某 email 的缓存（含 disk）。下次会重新走 OpenAPI."""
        with self._user_lock(email):
            self._user_clients.pop(email, None)

            # CredentialStore 路径
            if self._cred_store is not None:
                self._cred_store.delete_credential(email, "gfs")

            # 旧文件缓存路径（兜底）
            try:
                self._cred_path(email).unlink()
            except OSError as e:
                if e.errno != errno.ENOENT:
                    logger.warning("evict %s failed: %s", email, e)

    # ------------------------------------------------------------------ #
    # 主入口
    # ------------------------------------------------------------------ #
    def get_user_client(self, email: str) -> GfsUserClient:
        """幂等地拿到 ``email`` 对应的 ``GfsUserClient``.

        - 先看进程内字典；
        - 再看磁盘缓存（验证可用）；
        - 都不行再通过 OpenAPI 申请，并把结果持久化.

        发生 S3 401/403 等"凭证失效"信号时会自动 ``evict`` 一次并重试一次.
        """
        # fast path
        cli = self._user_clients.get(email)
        if cli is not None:
            return cli

        with self._user_lock(email):
            # double-check（其他线程可能已建好）
            cli = self._user_clients.get(email)
            if cli is not None:
                return cli

            cred = self._load_cached(email)
            if cred is not None:
                cli = GfsUserClient(cred)
                if cli.healthcheck():
                    self._user_clients[email] = cli
                    return cli
                # 缓存失效：清掉重新拉
                logger.info("cached credential for %s is stale, refreshing", email)
                self._user_clients.pop(email, None)
                cred = None

            # 通过 OpenAPI 拉
            cred = self.admin.get_user_credential(email)
            self._save_cached(cred)
            cli = GfsUserClient(cred)
            if not cli.healthcheck():
                raise GfsAdminError(
                    "CREDENTIAL_UNUSABLE",
                    f"got credential for {email} but S3 healthcheck failed",
                    status=500,
                )
            self._user_clients[email] = cli
            return cli

    def has_cached(self, email: str) -> bool:
        """检查是否有缓存（内存或磁盘）."""
        if email in self._user_clients:
            return True
        if self._cred_store is not None:
            return self._cred_store.has_credential(email, "gfs")
        return self._cred_path(email).exists()


# ---------------------------------------------------------------------- #
# 便捷顶层函数
# ---------------------------------------------------------------------- #
def get_user_client(email: str) -> GfsUserClient:
    """``GfsProvisioner.get().get_user_client(email)`` 的语法糖."""
    return GfsProvisioner.get().get_user_client(email)
