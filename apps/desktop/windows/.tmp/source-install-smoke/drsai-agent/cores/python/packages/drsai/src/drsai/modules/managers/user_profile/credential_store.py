"""
统一凭证存储 `CredentialStore`
================================

整合 ``UserApiKeyManager``（LLM API Key）与 ``GfsProvisioner`` 的磁盘缓存（GFS S3 凭证），
提供统一的 per-user 敏感凭证持久化。

设计要点
--------

- **目录结构**：``<base_dir>/user_credentials/<user_id>/<cred_type>.json``
- **线程安全**：per-user ``threading.Lock``，同用户并发写串行化
- **原子写入**：先写临时文件再 ``os.replace``，避免半截文件
- **权限保护**：文件 ``chmod 0600``，目录 ``chmod 0700``
- **cred_type 命名**：``"llm"``（LLM API Key）、``"gfs"``（GFS S3 凭证），未来可扩展

与旧实现的兼容
--------------

``UserApiKeyManager`` 保持原有 API 不变，内部委托给 ``CredentialStore``。
原有存储路径 ``<base_dir>/user_configs/<user_id>.json`` 会在首次读取时自动迁移。
"""

from __future__ import annotations

import json
import os
import stat
import threading
from datetime import datetime
from pathlib import Path
from typing import Any

from loguru import logger


# ---------------------------------------------------------------------- #
# 常量
# ---------------------------------------------------------------------- #
CREDENTIALS_DIR_NAME = "user_credentials"
LLM_CRED_TYPE = "llm"
GFS_CRED_TYPE = "gfs"


def _safe_user_dirname(user_id: str) -> str:
    """将 user_id 转为安全的目录名."""
    keep: list[str] = []
    for ch in user_id:
        if ch.isalnum() or ch in "-_.@":
            keep.append(ch)
        else:
            keep.append("_")
    return "".join(keep)


def _atomic_write_json(path: Path, data: dict[str, Any]) -> None:
    """原子写入 JSON：先写 .tmp 再 rename，并设 chmod 0600."""
    tmp = path.with_suffix(".json.tmp")
    tmp.parent.mkdir(parents=True, exist_ok=True)
    tmp.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    try:
        os.chmod(tmp, stat.S_IRUSR | stat.S_IWUSR)  # 0600
    except OSError as e:
        logger.warning("chmod 0600 {} failed: {}", tmp, e)
    os.replace(tmp, path)


def _ensure_dir_perms(dir_path: Path) -> None:
    """确保目录存在且权限为 0700."""
    dir_path.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(dir_path, stat.S_IRWXU)  # 0700
    except OSError as e:
        logger.warning("chmod 0700 {} failed: {}", dir_path, e)


# ---------------------------------------------------------------------- #
# CredentialStore
# ---------------------------------------------------------------------- #
class CredentialStore:
    """统一凭证存储.

    Args:
        base_dir: 存储根目录，凭证将存于 ``<base_dir>/user_credentials/`` 下.
    """

    def __init__(self, base_dir: str | Path) -> None:
        self._base_dir = Path(base_dir).expanduser().resolve()
        self._root_dir = self._base_dir / CREDENTIALS_DIR_NAME
        _ensure_dir_perms(self._root_dir)
        # 线程安全：per-user 锁
        self._locks: dict[str, threading.Lock] = {}
        self._locks_guard = threading.Lock()

    # ------------------------------------------------------------------ #
    # 内部工具
    # ------------------------------------------------------------------ #
    @property
    def root_dir(self) -> Path:
        """凭证存储根目录（只读）。"""
        return self._root_dir

    def _user_dir(self, user_id: str) -> Path:
        safe = _safe_user_dirname(user_id)
        d = self._root_dir / safe
        _ensure_dir_perms(d)
        return d

    def _cred_file(self, user_id: str, cred_type: str) -> Path:
        return self._user_dir(user_id) / f"{cred_type}.json"

    def _user_lock(self, user_id: str) -> threading.Lock:
        with self._locks_guard:
            lock = self._locks.get(user_id)
            if lock is None:
                lock = threading.Lock()
                self._locks[user_id] = lock
            return lock

    def _read_json(self, path: Path) -> dict[str, Any] | None:
        if not path.exists():
            return None
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, TypeError, ValueError) as e:
            logger.warning("corrupt credential file {}, ignoring: {}", path, e)
            try:
                path.unlink()
            except OSError:
                pass
            return None

    # ------------------------------------------------------------------ #
    # 通用凭证 API
    # ------------------------------------------------------------------ #
    def save_credential(
        self,
        user_id: str,
        cred_type: str,
        data: dict[str, Any],
    ) -> bool:
        """保存某用户某类型的凭证.

        Args:
            user_id: 用户标识（通常是邮箱）
            cred_type: 凭证类型，如 ``"llm"``、``"gfs"``
            data: 凭证内容 dict，会自动附加 ``updated_at`` 时间戳

        Returns:
            True 表示保存成功
        """
        try:
            payload = dict(data)
            payload.setdefault("cred_type", cred_type)
            payload.setdefault("user_id", user_id)
            payload["updated_at"] = datetime.now().isoformat()

            cred_file = self._cred_file(user_id, cred_type)

            with self._user_lock(user_id):
                _atomic_write_json(cred_file, payload)

            logger.debug(
                "CredentialStore saved cred_type={} for user={}",
                cred_type, user_id,
            )
            return True
        except Exception as e:
            logger.error(
                "Failed to save cred_type={} for user={}: {}",
                cred_type, user_id, e,
            )
            return False

    def get_credential(
        self,
        user_id: str,
        cred_type: str,
    ) -> dict[str, Any] | None:
        """读取某用户某类型的凭证.

        Returns:
            凭证 dict，不存在则返回 None
        """
        try:
            cred_file = self._cred_file(user_id, cred_type)
            with self._user_lock(user_id):
                return self._read_json(cred_file)
        except Exception as e:
            logger.error(
                "Failed to read cred_type={} for user={}: {}",
                cred_type, user_id, e,
            )
            return None

    def has_credential(self, user_id: str, cred_type: str) -> bool:
        """检查某用户某类型凭证是否存在."""
        return self._cred_file(user_id, cred_type).exists()

    def delete_credential(self, user_id: str, cred_type: str) -> bool:
        """删除某用户某类型的凭证.

        Returns:
            True 表示删除成功（不存在也算成功）
        """
        try:
            cred_file = self._cred_file(user_id, cred_type)
            with self._user_lock(user_id):
                if cred_file.exists():
                    cred_file.unlink()
                    logger.debug(
                        "CredentialStore deleted cred_type={} for user={}",
                        cred_type, user_id,
                    )
            return True
        except Exception as e:
            logger.error(
                "Failed to delete cred_type={} for user={}: {}",
                cred_type, user_id, e,
            )
            return False

    def delete_all_user_credentials(self, user_id: str) -> bool:
        """删除某用户的所有凭证（整个用户目录）."""
        try:
            user_dir = self._user_dir(user_id)
            with self._user_lock(user_id):
                if user_dir.exists():
                    for f in user_dir.iterdir():
                        try:
                            f.unlink()
                        except OSError:
                            pass
                    try:
                        user_dir.rmdir()
                    except OSError:
                        pass
                    logger.debug(
                        "CredentialStore deleted all credentials for user={}",
                        user_id,
                    )
            return True
        except Exception as e:
            logger.error(
                "Failed to delete all credentials for user={}: {}",
                user_id, e,
            )
            return False

    # ------------------------------------------------------------------ #
    # LLM API Key 便捷方法（向后兼容 UserApiKeyManager）
    # ------------------------------------------------------------------ #
    def save_api_key(self, user_id: str, api_key: str) -> bool:
        """保存用户的 LLM API Key."""
        return self.save_credential(user_id, LLM_CRED_TYPE, {"api_key": api_key})

    def get_api_key(self, user_id: str) -> str | None:
        """获取用户的 LLM API Key."""
        cred = self.get_credential(user_id, LLM_CRED_TYPE)
        if cred is None:
            return None
        return cred.get("api_key")

    def has_api_key(self, user_id: str) -> bool:
        """检查用户是否已保存 API Key."""
        return self.has_credential(user_id, LLM_CRED_TYPE)

    def delete_api_key(self, user_id: str) -> bool:
        """删除用户的 LLM API Key."""
        return self.delete_credential(user_id, LLM_CRED_TYPE)

    def update_api_key(self, user_id: str, api_key: str) -> bool:
        """更新用户的 LLM API Key（不存在则创建）."""
        return self.save_api_key(user_id, api_key)


# ---------------------------------------------------------------------- #
# 向后兼容：UserApiKeyManager 的旧存储路径迁移
# ---------------------------------------------------------------------- #
def _migrate_legacy_user_config(
    legacy_path: Path,
    store: CredentialStore,
) -> bool:
    """将旧 ``user_configs/<user_id>.json`` 迁移到 ``CredentialStore``.

    Returns:
        True 表示迁移成功或无需迁移
    """
    if not legacy_path.exists():
        return True
    try:
        data = json.loads(legacy_path.read_text(encoding="utf-8"))
        user_id = data.get("user_id")
        api_key = data.get("api_key")
        if not user_id or not api_key:
            logger.warning("legacy config {} missing user_id/api_key, skip", legacy_path)
            return False
        ok = store.save_api_key(user_id, api_key)
        if ok:
            legacy_path.unlink()
            logger.info("migrated legacy config: {} → CredentialStore", legacy_path)
        return ok
    except Exception as e:
        logger.warning("failed to migrate legacy config {}: {}", legacy_path, e)
        return False


def migrate_all_legacy_user_configs(
    legacy_base_dir: Path,
    store: CredentialStore,
) -> int:
    """扫描旧 ``<base_dir>/user_configs/`` 并全部迁移到 ``CredentialStore``.

    Returns:
        成功迁移的文件数
    """
    legacy_dir = legacy_base_dir / "user_configs"
    if not legacy_dir.is_dir():
        return 0
    count = 0
    for f in legacy_dir.iterdir():
        if f.suffix == ".json" and _migrate_legacy_user_config(f, store):
            count += 1
    return count
