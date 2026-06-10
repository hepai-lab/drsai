"""
用户 API Key 管理器
用于存储和检索用户的 API Key，供定时任务等后台服务使用
"""

import json
from pathlib import Path
from typing import Optional
from loguru import logger


class UserApiKeyManager:
    """
    管理用户的 API Key 存储和读取

    存储结构:
    <base_dir>/user_configs/
        ├── user1@example.com.json
        ├── user2@example.com.json
        └── ...

    每个用户配置文件内容:
    {
        "user_id": "user@example.com",
        "api_key": "encrypted_or_plain_api_key",
        "updated_at": "2026-04-09T20:00:00"
    }
    """

    def __init__(self, base_dir: Path):
        """
        Args:
            base_dir: 基础目录路径
        """
        self.base_dir = Path(base_dir)
        self.configs_dir = self.base_dir / "user_configs"
        self.configs_dir.mkdir(exist_ok=True, parents=True)

    def _get_config_file(self, user_id: str) -> Path:
        """
        获取用户配置文件路径

        Args:
            user_id: 用户ID

        Returns:
            配置文件路径
        """
        # 对用户ID进行清理，避免路径问题
        safe_user_id = user_id.replace("/", "_").replace("\\", "_")
        return self.configs_dir / f"{safe_user_id}.json"

    def save_api_key(self, user_id: str, api_key: str) -> bool:
        """
        保存用户的 API Key

        Args:
            user_id: 用户ID
            api_key: API Key

        Returns:
            是否保存成功
        """
        try:
            from datetime import datetime

            config_file = self._get_config_file(user_id)

            config = {
                "user_id": user_id,
                "api_key": api_key,
                "updated_at": datetime.now().isoformat()
            }

            with open(config_file, 'w', encoding='utf-8') as f:
                json.dump(config, f, ensure_ascii=False, indent=2)

            logger.info(f"Saved API key for user: {user_id}")
            return True

        except Exception as e:
            logger.error(f"Failed to save API key for user {user_id}: {e}")
            return False

    def get_api_key(self, user_id: str) -> Optional[str]:
        """
        获取用户的 API Key

        Args:
            user_id: 用户ID

        Returns:
            API Key，如果不存在则返回 None
        """
        try:
            config_file = self._get_config_file(user_id)

            if not config_file.exists():
                logger.warning(f"API key config not found for user: {user_id}")
                return None

            with open(config_file, 'r', encoding='utf-8') as f:
                config = json.load(f)

            return config.get("api_key")

        except Exception as e:
            logger.error(f"Failed to get API key for user {user_id}: {e}")
            return None

    def has_api_key(self, user_id: str) -> bool:
        """
        检查用户是否已保存 API Key

        Args:
            user_id: 用户ID

        Returns:
            是否已保存
        """
        config_file = self._get_config_file(user_id)
        return config_file.exists()

    def delete_api_key(self, user_id: str) -> bool:
        """
        删除用户的 API Key

        Args:
            user_id: 用户ID

        Returns:
            是否删除成功
        """
        try:
            config_file = self._get_config_file(user_id)

            if config_file.exists():
                config_file.unlink()
                logger.info(f"Deleted API key for user: {user_id}")
                return True
            else:
                logger.warning(f"API key config not found for user: {user_id}")
                return False

        except Exception as e:
            logger.error(f"Failed to delete API key for user {user_id}: {e}")
            return False

    def update_api_key(self, user_id: str, api_key: str) -> bool:
        """
        更新用户的 API Key（如果存在则更新，不存在则创建）

        Args:
            user_id: 用户ID
            api_key: 新的 API Key

        Returns:
            是否更新成功
        """
        return self.save_api_key(user_id, api_key)
