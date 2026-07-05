"""Unit tests for UserApiKeyManager backward compatibility.

验证改造后的 UserApiKeyManager：
1. 原有 API 全部可用
2. 旧 user_configs/ 数据自动迁移
3. 内部委托给 CredentialStore
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from drsai.modules.managers.user_profile import UserApiKeyManager, CredentialStore


# ---------------------------------------------------------------------- #
# helpers
# ---------------------------------------------------------------------- #
@pytest.fixture
def tmp_base(tmp_path: Path) -> Path:
    return tmp_path


@pytest.fixture
def manager(tmp_base: Path) -> UserApiKeyManager:
    return UserApiKeyManager(base_dir=tmp_base)


def _write_legacy_config(base_dir: Path, user_id: str, api_key: str) -> Path:
    """模拟旧的 user_configs/<user_id>.json 格式."""
    configs_dir = base_dir / "user_configs"
    configs_dir.mkdir(parents=True, exist_ok=True)
    safe = user_id.replace("/", "_").replace("\\", "_")
    path = configs_dir / f"{safe}.json"
    path.write_text(json.dumps({
        "user_id": user_id,
        "api_key": api_key,
        "updated_at": "2024-01-01T00:00:00",
    }))
    return path


# ---------------------------------------------------------------------- #
# 基本 API 兼容
# ---------------------------------------------------------------------- #
class TestAPICompatibility:
    def test_save_and_get(self, manager: UserApiKeyManager):
        manager.save_api_key("alice@x.com", "sk-test123")
        assert manager.get_api_key("alice@x.com") == "sk-test123"

    def test_get_missing(self, manager: UserApiKeyManager):
        assert manager.get_api_key("nobody@x.com") is None

    def test_has_api_key(self, manager: UserApiKeyManager):
        assert not manager.has_api_key("a@b.c")
        manager.save_api_key("a@b.c", "k")
        assert manager.has_api_key("a@b.c")

    def test_delete(self, manager: UserApiKeyManager):
        manager.save_api_key("a@b.c", "k")
        assert manager.delete_api_key("a@b.c")
        assert not manager.has_api_key("a@b.c")

    def test_delete_missing(self, manager: UserApiKeyManager):
        assert manager.delete_api_key("never@x.com")  # 返回 True

    def test_update(self, manager: UserApiKeyManager):
        manager.update_api_key("a@b.c", "v1")
        assert manager.get_api_key("a@b.c") == "v1"
        manager.update_api_key("a@b.c", "v2")
        assert manager.get_api_key("a@b.c") == "v2"

    def test_update_creates(self, manager: UserApiKeyManager):
        manager.update_api_key("new@x.com", "fresh")
        assert manager.get_api_key("new@x.com") == "fresh"


# ---------------------------------------------------------------------- #
# 旧数据自动迁移
# ---------------------------------------------------------------------- #
class TestAutoMigration:
    def test_migrates_on_init(self, tmp_base: Path):
        """创建 UserApiKeyManager 时自动迁移旧的 user_configs/."""
        _write_legacy_config(tmp_base, "alice@x.com", "legacy-ak")

        # 创建 manager → 应自动迁移
        mgr = UserApiKeyManager(base_dir=tmp_base)

        assert mgr.get_api_key("alice@x.com") == "legacy-ak"
        # 旧文件应已删除
        legacy_file = tmp_base / "user_configs" / "alice@x.com.json"
        assert not legacy_file.exists()

    def test_get_api_key_triggers_lazy_migration(self, tmp_base: Path):
        """即使初始化时没有旧数据，随后写入旧格式再 get 也会触发迁移."""
        mgr = UserApiKeyManager(base_dir=tmp_base)

        # 先通过 manager 正常存储
        mgr.save_api_key("bob@x.com", "normal-key")
        assert mgr.get_api_key("bob@x.com") == "normal-key"

        # 模拟另一个路径写入旧格式（比如老版本代码写入的）
        _write_legacy_config(tmp_base, "carol@x.com", "carol-legacy")

        # get 应该自动迁移
        assert mgr.get_api_key("carol@x.com") == "carol-legacy"

        # 旧文件应已删除
        legacy_file = tmp_base / "user_configs" / "carol@x.com.json"
        assert not legacy_file.exists()

    def test_delete_also_cleans_legacy(self, tmp_base: Path):
        """delete_api_key 同时清理旧路径."""
        legacy = _write_legacy_config(tmp_base, "dave@x.com", "dave-key")
        mgr = UserApiKeyManager(base_dir=tmp_base)

        # 先触发迁移
        assert mgr.get_api_key("dave@x.com") == "dave-key"

        # 再次写入旧文件（模拟异常情况）
        _write_legacy_config(tmp_base, "dave@x.com", "dave-key")

        # 删除
        mgr.delete_api_key("dave@x.com")

        # 新旧路径都不应有数据
        assert mgr.get_api_key("dave@x.com") is None
        assert not legacy.exists()

    def test_has_api_key_checks_legacy(self, tmp_base: Path):
        """has_api_key 应同时检查旧路径."""
        _write_legacy_config(tmp_base, "eve@x.com", "eve-key")
        mgr = UserApiKeyManager(base_dir=tmp_base)

        # 未迁移前也能检测到
        assert mgr.has_api_key("eve@x.com")


# ---------------------------------------------------------------------- #
# 内部委托验证
# ---------------------------------------------------------------------- #
class TestDelegation:
    def test_credential_store_property(self, manager: UserApiKeyManager):
        """manager.credential_store 返回内部 CredentialStore."""
        cs = manager.credential_store
        assert isinstance(cs, CredentialStore)

    def test_data_via_credential_store(self, manager: UserApiKeyManager):
        """通过 manager 保存的数据应该能被 CredentialStore 直接读取."""
        manager.save_api_key("test@x.com", "hello")
        cs = manager.credential_store
        assert cs.get_api_key("test@x.com") == "hello"

    def test_data_via_credential_store_direct(self, manager: UserApiKeyManager):
        """通过 CredentialStore 直接写的数据 manager 也能读到."""
        cs = manager.credential_store
        cs.save_api_key("direct@x.com", "direct-key")
        assert manager.get_api_key("direct@x.com") == "direct-key"


# ---------------------------------------------------------------------- #
# 边缘情况
# ---------------------------------------------------------------------- #
class TestEdgeCases:
    def test_special_chars_in_user_id(self, manager: UserApiKeyManager):
        manager.save_api_key("user/with\\slashes@x.com", "k")
        assert manager.get_api_key("user/with\\slashes@x.com") == "k"

    def test_empty_api_key(self, manager: UserApiKeyManager):
        """空字符串 API Key 也能存储（虽然业务上可能不合理）."""
        manager.save_api_key("a@b.c", "")
        assert manager.get_api_key("a@b.c") == ""

    def test_multiple_users(self, manager: UserApiKeyManager):
        users = [f"user{i}@x.com" for i in range(5)]
        for u in users:
            manager.save_api_key(u, f"key-{u}")
        for u in users:
            assert manager.get_api_key(u) == f"key-{u}"

    def test_base_dir_tree_exists(self, manager: UserApiKeyManager):
        """确认 user_credentials 目录树已创建."""
        cs = manager.credential_store
        assert cs.root_dir.is_dir()
