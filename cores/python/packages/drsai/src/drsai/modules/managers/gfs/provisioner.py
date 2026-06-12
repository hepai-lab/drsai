"""GfsProvisioner: 进程级别 per-email 的 ``GfsUserClient`` 缓存 & 凭证落盘.

设计要点：
- 单进程内每个 email 复用同一个 ``GfsUserClient`` 实例（boto3 client 内含连接池, 线程安全）.
- AKSK 持久化到 worker 进程私有目录 ``~/.drsai/.cache/gfs/<email>.json``，
  **绝不**放到用户可见 work_dir，避免凭证从聊天导出/分享时泄露.
- 凭证文件 ``chmod 600``，目录 ``chmod 700``.
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

from .admin_client import (
    GfsAdminClient,
    GfsAdminError,
    GfsCredential,
    get_admin_client,
)
from .user_client import GfsUserClient


logger = logging.getLogger(__name__)


ENV_CACHE_DIR = "DRSAI_GFS_CACHE_DIR"


def _default_cache_dir() -> Path:
    explicit = os.environ.get(ENV_CACHE_DIR)
    if explicit:
        return Path(explicit).expanduser().resolve()
    return Path.home() / ".drsai" / ".cache" / "gfs"


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
    ) -> None:
        self.admin: GfsAdminClient = admin or get_admin_client()
        self.cache_dir: Path = Path(cache_dir).expanduser() if cache_dir else _default_cache_dir()
        self._user_clients: dict[str, GfsUserClient] = {}
        self._per_user_locks: dict[str, threading.Lock] = {}
        self._locks_guard = threading.Lock()
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
        p = self._cred_path(cred.email)
        # 写到临时文件再 rename，避免半截文件
        tmp = p.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(asdict(cred), ensure_ascii=False, indent=2), encoding="utf-8")
        try:
            os.chmod(tmp, stat.S_IRUSR | stat.S_IWUSR)  # 0600
        except OSError as e:
            logger.warning("chmod 0600 %s failed: %s", tmp, e)
        os.replace(tmp, p)

    def evict(self, email: str) -> None:
        """删除某 email 的缓存（含 disk）。下次会重新走 OpenAPI."""
        with self._user_lock(email):
            self._user_clients.pop(email, None)
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
        return email in self._user_clients or self._cred_path(email).exists()


# ---------------------------------------------------------------------- #
# 便捷顶层函数
# ---------------------------------------------------------------------- #
def get_user_client(email: str) -> GfsUserClient:
    """``GfsProvisioner.get().get_user_client(email)`` 的语法糖."""
    return GfsProvisioner.get().get_user_client(email)
