"""
用户 API Key 管理器（向后兼容层）

.. deprecated::
    请直接使用 ``CredentialStore`` 替代。本类保留仅为了不破坏现有调用方。
    所有方法内部委托给 ``CredentialStore``。

存储位置已迁移到统一路径：
    ``<base_dir>/user_credentials/<user_id>/llm.json``

首次读取旧路径 ``<base_dir>/user_configs/<user_id>.json`` 时会自动迁移。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

from loguru import logger

from .credential_store import CredentialStore, _migrate_legacy_user_config


class UserApiKeyManager:
    """管理用户的 LLM API Key 存储和读取（向后兼容层）.

    内部委托给 ``CredentialStore``，并自动迁移旧格式。
    """

    def __init__(self, base_dir: Path):
        """
        Args:
            base_dir: 基础目录路径
        """
        self.base_dir = Path(base_dir)
        self._store = CredentialStore(base_dir=self.base_dir)

        # 旧目录（用于迁移）
        self._legacy_configs_dir = self.base_dir / "user_configs"

        # 首次初始化时尝试迁移旧数据
        self._try_migrate()

    def _try_migrate(self) -> None:
        """扫描旧 user_configs 目录，迁移到 CredentialStore."""
        if not self._legacy_configs_dir.is_dir():
            return
        try:
            from .credential_store import migrate_all_legacy_user_configs
            count = migrate_all_legacy_user_configs(self.base_dir, self._store)
            if count > 0:
                logger.info(
                    "UserApiKeyManager migrated {} legacy config(s) to CredentialStore",
                    count,
                )
        except Exception as e:
            logger.warning("UserApiKeyManager legacy migration error: {}", e)

    def _get_config_file(self, user_id: str) -> Path:
        """旧接口兼容：返回旧格式路径（用于迁移检查）."""
        safe_user_id = user_id.replace("/", "_").replace("\\", "_")
        return self._legacy_configs_dir / f"{safe_user_id}.json"

    # ------------------------------------------------------------------ #
    # 委托给 CredentialStore
    # ------------------------------------------------------------------ #
    def save_api_key(self, user_id: str, api_key: str) -> bool:
        """保存用户的 API Key."""
        return self._store.save_api_key(user_id, api_key)

    def get_api_key(self, user_id: str) -> Optional[str]:
        """获取用户的 API Key.

        先查 CredentialStore，若不存在则尝试从旧路径迁移后读取。
        """
        result = self._store.get_api_key(user_id)
        if result is not None:
            return result

        # 尝试从旧路径迁移
        legacy_file = self._get_config_file(user_id)
        if legacy_file.exists():
            if _migrate_legacy_user_config(legacy_file, self._store):
                return self._store.get_api_key(user_id)

        return None

    def has_api_key(self, user_id: str) -> bool:
        """检查用户是否已保存 API Key."""
        if self._store.has_api_key(user_id):
            return True
        return self._get_config_file(user_id).exists()

    def delete_api_key(self, user_id: str) -> bool:
        """删除用户的 API Key."""
        # 同时清理旧路径
        legacy_file = self._get_config_file(user_id)
        if legacy_file.exists():
            try:
                legacy_file.unlink()
            except OSError:
                pass
        return self._store.delete_api_key(user_id)

    def update_api_key(self, user_id: str, api_key: str) -> bool:
        """更新用户的 API Key（如果存在则更新，不存在则创建）."""
        return self._store.update_api_key(user_id, api_key)

    # ------------------------------------------------------------------ #
    # 向后兼容：暴露内部 CredentialStore
    # ------------------------------------------------------------------ #
    @property
    def credential_store(self) -> CredentialStore:
        """获取内部的 ``CredentialStore`` 实例，供 ``GfsProvisioner`` 等共享."""
        return self._store
