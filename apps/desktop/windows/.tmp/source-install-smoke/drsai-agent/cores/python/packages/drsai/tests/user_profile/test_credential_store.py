"""Unit tests for drsai.modules.managers.user_profile.credential_store."""

from __future__ import annotations

import json
import os
import stat
import threading
import time
from pathlib import Path

import pytest

from drsai.modules.managers.user_profile.credential_store import (
    CredentialStore,
    _safe_user_dirname,
    _atomic_write_json,
    _ensure_dir_perms,
    _migrate_legacy_user_config,
    migrate_all_legacy_user_configs,
    LLM_CRED_TYPE,
    GFS_CRED_TYPE,
    CREDENTIALS_DIR_NAME,
)


# ---------------------------------------------------------------------- #
# helpers
# ---------------------------------------------------------------------- #
@pytest.fixture
def tmp_base(tmp_path: Path) -> Path:
    """临时基础目录."""
    return tmp_path


@pytest.fixture
def store(tmp_base: Path) -> CredentialStore:
    """新 CredentialStore 实例."""
    return CredentialStore(base_dir=tmp_base)


# ---------------------------------------------------------------------- #
# 工具函数
# ---------------------------------------------------------------------- #
class TestSafeUserDirname:
    def test_email(self):
        assert _safe_user_dirname("alice@ihep.ac.cn") == "alice@ihep.ac.cn"

    def test_strips_slash(self):
        assert "/" not in _safe_user_dirname("a/b@c.com")

    def test_strips_special_chars(self):
        assert _safe_user_dirname("user name!") == "user_name_"

    def test_keeps_hyphen_dot(self):
        assert _safe_user_dirname("test-user.1@x.com") == "test-user.1@x.com"


class TestEnsureDirPerms:
    def test_creates_dir(self, tmp_path: Path):
        d = tmp_path / "some" / "nested" / "dir"
        _ensure_dir_perms(d)
        assert d.is_dir()

    def test_perms_0700(self, tmp_path: Path):
        d = tmp_path / "secure"
        _ensure_dir_perms(d)
        if os.name == "posix":
            mode = stat.S_IMODE(d.stat().st_mode)
            assert mode == 0o700, f"expected 0700, got {oct(mode)}"


class TestAtomicWriteJSON:
    def test_writes_file(self, tmp_path: Path):
        path = tmp_path / "test.json"
        _atomic_write_json(path, {"foo": "bar"})
        assert path.exists()
        data = json.loads(path.read_text())
        assert data == {"foo": "bar"}

    def test_perms_0600(self, tmp_path: Path):
        path = tmp_path / "test.json"
        _atomic_write_json(path, {"x": 1})
        if os.name == "posix":
            mode = stat.S_IMODE(path.stat().st_mode)
            assert mode == 0o600, f"expected 0600, got {oct(mode)}"

    def test_no_tmp_leftover(self, tmp_path: Path):
        path = tmp_path / "test.json"
        _atomic_write_json(path, {"a": 1})
        tmp = path.with_suffix(".json.tmp")
        assert not tmp.exists()

    def test_overwrites_existing(self, tmp_path: Path):
        path = tmp_path / "test.json"
        _atomic_write_json(path, {"v": 1})
        _atomic_write_json(path, {"v": 2})
        data = json.loads(path.read_text())
        assert data["v"] == 2


# ---------------------------------------------------------------------- #
# CredentialStore — 基本 CRUD
# ---------------------------------------------------------------------- #
class TestCredentialStoreCRUD:
    def test_save_and_get(self, store: CredentialStore):
        store.save_credential("alice@x.com", "test", {"value": 42})
        cred = store.get_credential("alice@x.com", "test")
        assert cred is not None
        assert cred["value"] == 42
        assert cred["cred_type"] == "test"
        assert cred["user_id"] == "alice@x.com"
        assert "updated_at" in cred

    def test_get_missing(self, store: CredentialStore):
        assert store.get_credential("nobody@x.com", "llm") is None

    def test_has_credential(self, store: CredentialStore):
        assert not store.has_credential("a@b.c", "llm")
        store.save_api_key("a@b.c", "sk-123")
        assert store.has_credential("a@b.c", "llm")

    def test_delete(self, store: CredentialStore):
        store.save_credential("a@b.c", "test", {"x": 1})
        assert store.has_credential("a@b.c", "test")
        store.delete_credential("a@b.c", "test")
        assert not store.has_credential("a@b.c", "test")
        assert store.get_credential("a@b.c", "test") is None

    def test_delete_missing_no_error(self, store: CredentialStore):
        store.delete_credential("never@x.com", "test")  # no raise

    def test_delete_all_user(self, store: CredentialStore):
        store.save_credential("a@b.c", "llm", {"api_key": "k1"})
        store.save_credential("a@b.c", "gfs", {"ak": "ak1"})
        store.save_credential("other@x.com", "llm", {"api_key": "k2"})

        store.delete_all_user_credentials("a@b.c")

        assert not store.has_credential("a@b.c", "llm")
        assert not store.has_credential("a@b.c", "gfs")
        assert store.has_credential("other@x.com", "llm")  # untouched

    def test_overwrite(self, store: CredentialStore):
        store.save_api_key("a@b.c", "old-key")
        store.save_api_key("a@b.c", "new-key")
        assert store.get_api_key("a@b.c") == "new-key"


# ---------------------------------------------------------------------- #
# CredentialStore — LLM API Key 便捷方法
# ---------------------------------------------------------------------- #
class TestLLMConvenienceMethods:
    def test_save_and_get_api_key(self, store: CredentialStore):
        store.save_api_key("user@x.com", "sk-abc123")
        assert store.get_api_key("user@x.com") == "sk-abc123"

    def test_get_api_key_missing(self, store: CredentialStore):
        assert store.get_api_key("nobody@x.com") is None

    def test_has_api_key(self, store: CredentialStore):
        assert not store.has_api_key("a@b.c")
        store.save_api_key("a@b.c", "k")
        assert store.has_api_key("a@b.c")

    def test_delete_api_key(self, store: CredentialStore):
        store.save_api_key("a@b.c", "k")
        store.delete_api_key("a@b.c")
        assert not store.has_api_key("a@b.c")

    def test_update_api_key(self, store: CredentialStore):
        store.update_api_key("a@b.c", "key-v1")
        assert store.get_api_key("a@b.c") == "key-v1"
        store.update_api_key("a@b.c", "key-v2")
        assert store.get_api_key("a@b.c") == "key-v2"

    def test_update_creates_if_not_exist(self, store: CredentialStore):
        store.update_api_key("new@x.com", "fresh-key")
        assert store.get_api_key("new@x.com") == "fresh-key"


# ---------------------------------------------------------------------- #
# CredentialStore — 存储结构验证
# ---------------------------------------------------------------------- #
class TestStorageLayout:
    def test_root_dir_created(self, store: CredentialStore):
        root = store.root_dir
        assert root.is_dir()
        assert root.name == CREDENTIALS_DIR_NAME

    def test_per_user_subdir(self, store: CredentialStore):
        store.save_api_key("alice@x.com", "k")
        user_dir = store.root_dir / "alice@x.com"
        assert user_dir.is_dir()

    def test_credential_file_path(self, store: CredentialStore):
        store.save_credential("bob@x.com", "gfs", {"ak": "x"})
        cred_file = store.root_dir / "bob@x.com" / "gfs.json"
        assert cred_file.is_file()

    def test_file_perms_0600(self, store: CredentialStore):
        store.save_api_key("a@b.c", "secret")
        cred_file = store.root_dir / "a@b.c" / "llm.json"
        if os.name == "posix":
            mode = stat.S_IMODE(cred_file.stat().st_mode)
            assert mode == 0o600, f"expected 0600, got {oct(mode)}"

    def test_dir_perms_0700(self, store: CredentialStore):
        store.save_api_key("a@b.c", "secret")
        user_dir = store.root_dir / "a@b.c"
        if os.name == "posix":
            mode = stat.S_IMODE(user_dir.stat().st_mode)
            assert mode == 0o700, f"expected 0700, got {oct(mode)}"

    def test_multiple_cred_types_same_user(self, store: CredentialStore):
        store.save_api_key("multi@x.com", "llm-key")
        store.save_credential("multi@x.com", "gfs", {"ak": "gfs-ak"})
        store.save_credential("multi@x.com", "github", {"token": "ghp_xxx"})

        assert store.get_api_key("multi@x.com") == "llm-key"
        assert store.get_credential("multi@x.com", "gfs") is not None
        assert store.get_credential("multi@x.com", "github") is not None

        # 目录结构验证
        user_dir = store.root_dir / "multi@x.com"
        files = sorted(f.name for f in user_dir.iterdir())
        assert files == ["gfs.json", "github.json", "llm.json"]


# ---------------------------------------------------------------------- #
# CredentialStore — 损坏容错
# ---------------------------------------------------------------------- #
class TestCorruptionRecovery:
    def test_corrupt_json_returns_none(self, store: CredentialStore):
        # 手动写坏文件
        cred_file = store.root_dir / "bad@x.com" / "llm.json"
        cred_file.parent.mkdir(parents=True, exist_ok=True)
        cred_file.write_text("not valid json {{{")
        assert store.get_api_key("bad@x.com") is None

    def test_corrupt_json_auto_unlinks(self, store: CredentialStore):
        cred_file = store.root_dir / "bad@x.com" / "llm.json"
        cred_file.parent.mkdir(parents=True, exist_ok=True)
        cred_file.write_text("rubbish")
        store.get_api_key("bad@x.com")
        assert not cred_file.exists()

    def test_wrong_schema_still_readable(self, store: CredentialStore):
        """凭证 dict 里没有 api_key 字段时 get_api_key 返回 None."""
        store.save_credential("a@b.c", "llm", {"wrong_field": "val"})
        assert store.get_api_key("a@b.c") is None


# ---------------------------------------------------------------------- #
# CredentialStore — 线程安全
# ---------------------------------------------------------------------- #
class TestThreadSafety:
    def test_concurrent_writes_same_user(self, store: CredentialStore):
        """多线程同时写同一用户的不同 cred_type，不应丢失数据."""
        errors = []
        def worker(cred_type: str, val: int):
            try:
                store.save_credential("alice@x.com", cred_type, {"val": val})
            except Exception as e:
                errors.append(e)

        threads = [
            threading.Thread(target=worker, args=(f"type_{i}", i))
            for i in range(10)
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert not errors
        for i in range(10):
            cred = store.get_credential("alice@x.com", f"type_{i}")
            assert cred is not None
            assert cred["val"] == i


# ---------------------------------------------------------------------- #
# 旧数据迁移
# ---------------------------------------------------------------------- #
class TestLegacyMigration:
    def _write_legacy_config(self, base_dir: Path, user_id: str, api_key: str) -> Path:
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

    def test_migrate_single(self, tmp_base: Path):
        store = CredentialStore(base_dir=tmp_base)
        legacy = self._write_legacy_config(tmp_base, "alice@x.com", "legacy-key")

        ok = _migrate_legacy_user_config(legacy, store)
        assert ok
        assert not legacy.exists()  # 旧文件已删除
        assert store.get_api_key("alice@x.com") == "legacy-key"

    def test_migrate_missing_file(self, tmp_base: Path):
        store = CredentialStore(base_dir=tmp_base)
        ok = _migrate_legacy_user_config(tmp_base / "user_configs" / "nobody.json", store)
        assert ok  # 无需迁移也算成功

    def test_migrate_batch(self, tmp_base: Path):
        store = CredentialStore(base_dir=tmp_base)
        self._write_legacy_config(tmp_base, "alice@x.com", "ak-alice")
        self._write_legacy_config(tmp_base, "bob@x.com", "ak-bob")
        self._write_legacy_config(tmp_base, "carol@x.com", "ak-carol")

        count = migrate_all_legacy_user_configs(tmp_base, store)
        assert count == 3

        assert store.get_api_key("alice@x.com") == "ak-alice"
        assert store.get_api_key("bob@x.com") == "ak-bob"
        assert store.get_api_key("carol@x.com") == "ak-carol"

        # 旧目录应该空了
        remaining = list((tmp_base / "user_configs").iterdir())
        assert len(remaining) == 0

    def test_migrate_no_legacy_dir(self, tmp_base: Path):
        store = CredentialStore(base_dir=tmp_base)
        count = migrate_all_legacy_user_configs(tmp_base, store)
        assert count == 0

    def test_migrate_skips_non_json(self, tmp_base: Path):
        """user_configs/ 里的非 .json 文件应被跳过."""
        store = CredentialStore(base_dir=tmp_base)
        configs_dir = tmp_base / "user_configs"
        configs_dir.mkdir(parents=True, exist_ok=True)
        (configs_dir / "README.txt").write_text("hello")

        count = migrate_all_legacy_user_configs(tmp_base, store)
        assert count == 0

    def test_migrate_corrupt_json(self, tmp_base: Path):
        """损坏的旧配置文件应被跳过（不崩溃）."""
        store = CredentialStore(base_dir=tmp_base)
        configs_dir = tmp_base / "user_configs"
        configs_dir.mkdir(parents=True, exist_ok=True)
        (configs_dir / "bad.json").write_text("{{{ corrupt")

        count = migrate_all_legacy_user_configs(tmp_base, store)
        assert count == 0

    def test_migrate_missing_user_id(self, tmp_base: Path):
        """旧配置文件缺少 user_id 字段时应跳过."""
        store = CredentialStore(base_dir=tmp_base)
        configs_dir = tmp_base / "user_configs"
        configs_dir.mkdir(parents=True, exist_ok=True)
        (configs_dir / "bad.json").write_text(json.dumps({"api_key": "k"}))

        count = migrate_all_legacy_user_configs(tmp_base, store)
        assert count == 0
