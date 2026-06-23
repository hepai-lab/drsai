"""Unit tests for drsai.modules.managers.gfs.provisioner."""

from __future__ import annotations

import json
import os
import stat
import threading
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from drsai.modules.managers.gfs.admin_client import GfsAdminError, GfsCredential
from drsai.modules.managers.gfs.provisioner import (
    GfsProvisioner,
    _default_cache_dir,
    _safe_filename,
)


# ---------------------------------------------------------------------- #
# helpers
# ---------------------------------------------------------------------- #
def _cred(email: str, ak: str = "AK", sk: str = "SK") -> GfsCredential:
    return GfsCredential(
        access_key=ak, secret_key=sk,
        bucket=f"20001-{email.split('@')[0]}",
        s3_endpoint="https://fgws3.test",
        email=email, owner_id="20001",
    )


@pytest.fixture
def tmp_cache(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("DRSAI_GFS_CACHE_DIR", str(tmp_path))
    GfsProvisioner.reset()
    yield tmp_path
    GfsProvisioner.reset()


@pytest.fixture
def mock_admin():
    """A MagicMock admin client; .get_user_credential controllable per-test."""
    return MagicMock(name="GfsAdminClient")


@pytest.fixture
def mock_user_client_factory():
    """patch GfsUserClient so we can assert which credential it was instantiated with,
    and force healthcheck() True / False per test."""
    instances = []

    def _factory(cred, **kw):
        m = MagicMock(name="GfsUserClient")
        m.credential = cred
        m.email = cred.email
        m.bucket = cred.bucket
        m.healthcheck.return_value = True
        instances.append(m)
        return m

    with patch("drsai.modules.managers.gfs.provisioner.GfsUserClient", side_effect=_factory) as p:
        yield instances


# ---------------------------------------------------------------------- #
# 小工具
# ---------------------------------------------------------------------- #
class TestSafeFilename:
    def test_email(self):
        assert _safe_filename("alice@ihep.ac.cn") == "alice@ihep.ac.cn.json"

    def test_strips_slash(self):
        assert "/" not in _safe_filename("a/b@c.com")

    def test_strips_dotdot(self):
        # ".." 里 '.' 在白名单，但 / 不在 → 没有 .. 转义路径
        assert "/" not in _safe_filename("../etc@x")


class TestDefaultCacheDir:
    def test_env_override(self, monkeypatch, tmp_path):
        monkeypatch.setenv("DRSAI_GFS_CACHE_DIR", str(tmp_path))
        assert _default_cache_dir() == tmp_path.resolve()

    def test_default(self, monkeypatch):
        monkeypatch.delenv("DRSAI_GFS_CACHE_DIR", raising=False)
        d = _default_cache_dir()
        assert d.parts[-3:] == (".drsai", ".cache", "gfs")


# ---------------------------------------------------------------------- #
# 缓存目录权限
# ---------------------------------------------------------------------- #
class TestCacheDirSecurity:
    def test_creates_with_0700(self, tmp_cache, mock_admin):
        p = GfsProvisioner(admin=mock_admin, cache_dir=tmp_cache)
        assert p.cache_dir.exists()
        # 在 windows / 部分容器上 chmod 不一定生效；仅在 unix 验证
        if os.name == "posix":
            mode = stat.S_IMODE(p.cache_dir.stat().st_mode)
            assert mode == 0o700, f"expected 0700, got {oct(mode)}"


# ---------------------------------------------------------------------- #
# 凭证落盘 / 读盘
# ---------------------------------------------------------------------- #
class TestPersistence:
    def test_save_then_load(self, tmp_cache, mock_admin):
        p = GfsProvisioner(admin=mock_admin, cache_dir=tmp_cache)
        cred = _cred("alice@ihep.ac.cn")
        p._save_cached(cred)

        # 文件存在且权限 0600
        path = p._cred_path("alice@ihep.ac.cn")
        assert path.exists()
        if os.name == "posix":
            assert stat.S_IMODE(path.stat().st_mode) == 0o600

        # 读回来一致
        loaded = p._load_cached("alice@ihep.ac.cn")
        assert loaded == cred

    def test_load_missing(self, tmp_cache, mock_admin):
        p = GfsProvisioner(admin=mock_admin, cache_dir=tmp_cache)
        assert p._load_cached("nobody@x.y") is None

    def test_load_corrupt_returns_none_and_unlinks(self, tmp_cache, mock_admin):
        p = GfsProvisioner(admin=mock_admin, cache_dir=tmp_cache)
        bad = p._cred_path("a@b.c")
        bad.write_text("not json")
        assert p._load_cached("a@b.c") is None
        assert not bad.exists()

    def test_load_wrong_schema(self, tmp_cache, mock_admin):
        p = GfsProvisioner(admin=mock_admin, cache_dir=tmp_cache)
        bad = p._cred_path("a@b.c")
        bad.write_text(json.dumps({"foo": "bar"}))
        assert p._load_cached("a@b.c") is None


# ---------------------------------------------------------------------- #
# get_user_client：核心策略
# ---------------------------------------------------------------------- #
class TestGetUserClient:
    def test_first_time_calls_admin(self, tmp_cache, mock_admin, mock_user_client_factory):
        cred = _cred("alice@ihep.ac.cn")
        mock_admin.get_user_credential.return_value = cred
        p = GfsProvisioner(admin=mock_admin, cache_dir=tmp_cache)

        c = p.get_user_client("alice@ihep.ac.cn")

        mock_admin.get_user_credential.assert_called_once_with("alice@ihep.ac.cn")
        assert c.credential.access_key == "AK"
        # 已写入缓存
        assert p._cred_path("alice@ihep.ac.cn").exists()

    def test_second_call_reuses_inmem(self, tmp_cache, mock_admin, mock_user_client_factory):
        mock_admin.get_user_credential.return_value = _cred("a@b.c")
        p = GfsProvisioner(admin=mock_admin, cache_dir=tmp_cache)
        c1 = p.get_user_client("a@b.c")
        c2 = p.get_user_client("a@b.c")
        assert c1 is c2
        assert mock_admin.get_user_credential.call_count == 1

    def test_uses_cache_on_disk_when_warm(
        self, tmp_cache, mock_admin, mock_user_client_factory
    ):
        # 先手动落盘
        cred = _cred("alice@ihep.ac.cn", ak="CACHED_AK")
        p = GfsProvisioner(admin=mock_admin, cache_dir=tmp_cache)
        p._save_cached(cred)

        # 创建新 provisioner（模拟进程重启）
        GfsProvisioner.reset()
        p2 = GfsProvisioner(admin=mock_admin, cache_dir=tmp_cache)
        c = p2.get_user_client("alice@ihep.ac.cn")

        # 不应调用 OpenAPI
        mock_admin.get_user_credential.assert_not_called()
        assert c.credential.access_key == "CACHED_AK"

    def test_stale_cache_triggers_refresh(
        self, tmp_cache, mock_admin
    ):
        """缓存里的凭证健康检查失败 → evict + 重新走 OpenAPI."""
        stale = _cred("a@b.c", ak="STALE")
        fresh = _cred("a@b.c", ak="FRESH")
        p = GfsProvisioner(admin=mock_admin, cache_dir=tmp_cache)
        p._save_cached(stale)
        mock_admin.get_user_credential.return_value = fresh

        # 自定义 GfsUserClient 工厂：第一次 healthcheck False, 之后 True
        call_count = {"n": 0}

        def _factory(cred, **kw):
            call_count["n"] += 1
            m = MagicMock()
            m.credential = cred
            m.email = cred.email
            m.bucket = cred.bucket
            m.healthcheck.return_value = (cred.access_key == "FRESH")
            return m

        with patch("drsai.modules.managers.gfs.provisioner.GfsUserClient", side_effect=_factory):
            c = p.get_user_client("a@b.c")

        assert c.credential.access_key == "FRESH"
        mock_admin.get_user_credential.assert_called_once()
        assert call_count["n"] == 2  # 一次 stale 验失败，一次 fresh

    def test_isolation_between_emails(
        self, tmp_cache, mock_admin, mock_user_client_factory
    ):
        """alice 和 bob 的 client 必须是不同实例 / 不同凭证."""
        mock_admin.get_user_credential.side_effect = lambda e: _cred(e, ak=f"AK_{e}")
        p = GfsProvisioner(admin=mock_admin, cache_dir=tmp_cache)
        ca = p.get_user_client("alice@x.com")
        cb = p.get_user_client("bob@x.com")
        assert ca is not cb
        assert ca.credential.access_key == "AK_alice@x.com"
        assert cb.credential.access_key == "AK_bob@x.com"

    def test_admin_error_propagates(self, tmp_cache, mock_admin):
        mock_admin.get_user_credential.side_effect = GfsAdminError(
            "NO_BUCKET", "x", 404
        )
        p = GfsProvisioner(admin=mock_admin, cache_dir=tmp_cache)
        with pytest.raises(GfsAdminError):
            p.get_user_client("nobody@x.com")

    def test_healthcheck_fail_after_fresh_aksk(self, tmp_cache, mock_admin):
        """OpenAPI 返回凭证但 S3 不通 → 抛 CREDENTIAL_UNUSABLE."""
        mock_admin.get_user_credential.return_value = _cred("a@b.c")
        p = GfsProvisioner(admin=mock_admin, cache_dir=tmp_cache)

        def _factory(cred, **kw):
            m = MagicMock()
            m.healthcheck.return_value = False
            m.credential = cred
            m.email = cred.email
            return m

        with patch("drsai.modules.managers.gfs.provisioner.GfsUserClient", side_effect=_factory):
            with pytest.raises(GfsAdminError) as exc:
                p.get_user_client("a@b.c")
            assert exc.value.code == "CREDENTIAL_UNUSABLE"


# ---------------------------------------------------------------------- #
# evict
# ---------------------------------------------------------------------- #
class TestEvict:
    def test_removes_inmem_and_disk(self, tmp_cache, mock_admin, mock_user_client_factory):
        mock_admin.get_user_credential.return_value = _cred("a@b.c")
        p = GfsProvisioner(admin=mock_admin, cache_dir=tmp_cache)
        p.get_user_client("a@b.c")
        assert p._cred_path("a@b.c").exists()
        assert "a@b.c" in p._user_clients

        p.evict("a@b.c")

        assert not p._cred_path("a@b.c").exists()
        assert "a@b.c" not in p._user_clients

    def test_evict_unknown_email_no_error(self, tmp_cache, mock_admin):
        p = GfsProvisioner(admin=mock_admin, cache_dir=tmp_cache)
        p.evict("never@seen.com")  # no raise


# ---------------------------------------------------------------------- #
# 并发：同一 email 多线程首次开通只调用一次 OpenAPI
# ---------------------------------------------------------------------- #
class TestConcurrency:
    def test_first_open_is_locked(self, tmp_cache, mock_admin, mock_user_client_factory):
        cred = _cred("alice@x.com")
        # 让 get_user_credential 故意慢一点，制造并发窗口
        slow_event = threading.Event()

        def _slow(email):
            slow_event.wait(timeout=2)
            return cred

        mock_admin.get_user_credential.side_effect = _slow
        p = GfsProvisioner(admin=mock_admin, cache_dir=tmp_cache)

        results: list = []
        def worker():
            results.append(p.get_user_client("alice@x.com"))

        threads = [threading.Thread(target=worker) for _ in range(5)]
        for t in threads:
            t.start()
        # 给所有线程时间进入 lock 等待
        import time
        time.sleep(0.1)
        slow_event.set()
        for t in threads:
            t.join(timeout=5)

        # 5 个线程拿到同一个实例
        assert len({id(r) for r in results}) == 1
        # 但 OpenAPI 只被调用一次
        assert mock_admin.get_user_credential.call_count == 1


# ---------------------------------------------------------------------- #
# singleton
# ---------------------------------------------------------------------- #
class TestSingleton:
    def test_get_returns_same(self, tmp_cache, monkeypatch):
        # 用环境 + 默认构造
        monkeypatch.setenv("GFS_OPENAPI_KEY", "test")
        a = GfsProvisioner.get()
        b = GfsProvisioner.get()
        assert a is b

    def test_reset_recreates(self, tmp_cache, monkeypatch):
        monkeypatch.setenv("GFS_OPENAPI_KEY", "test")
        a = GfsProvisioner.get()
        GfsProvisioner.reset()
        b = GfsProvisioner.get()


# ---------------------------------------------------------------------- #
# CredentialStore 集成测试
# ---------------------------------------------------------------------- #
class TestCredentialStoreIntegration:
    """验证 GfsProvisioner 通过 CredentialStore 统一存储凭证."""

    def test_set_credential_store_classmethod(self, tmp_cache, mock_admin, monkeypatch):
        """set_credential_store() 注入 CredentialStore."""
        monkeypatch.setenv("GFS_OPENAPI_KEY", "test")
        from drsai.modules.managers.user_profile.credential_store import CredentialStore
        cs = CredentialStore(base_dir=tmp_cache)
        GfsProvisioner.set_credential_store(cs)

        p = GfsProvisioner.get()
        assert p._cred_store is cs

    def test_save_and_load_via_credential_store(
        self, tmp_cache, mock_admin, mock_user_client_factory, monkeypatch
    ):
        """通过 CredentialStore 持久化和读取 GFS 凭证."""
        from drsai.modules.managers.user_profile.credential_store import CredentialStore
        cs = CredentialStore(base_dir=tmp_cache)

        cred = _cred("alice@ihep.ac.cn", ak="VIA_STORE_AK")
        mock_admin.get_user_credential.return_value = cred
        p = GfsProvisioner(admin=mock_admin, credential_store=cs)

        # 第一次：调 admin → 存入 CredentialStore
        c1 = p.get_user_client("alice@ihep.ac.cn")
        assert c1.credential.access_key == "VIA_STORE_AK"

        # 验证 CredentialStore 中有数据
        stored = cs.get_credential("alice@ihep.ac.cn", "gfs")
        assert stored is not None
        assert stored["access_key"] == "VIA_STORE_AK"
        assert stored["email"] == "alice@ihep.ac.cn"

        # 模拟进程重启：新的 Provisioner + 同一个 CredentialStore → 不再调 admin
        mock_admin.get_user_credential.reset_mock()
        p2 = GfsProvisioner(admin=mock_admin, credential_store=cs)

        c2 = p2.get_user_client("alice@ihep.ac.cn")
        assert c2.credential.access_key == "VIA_STORE_AK"
        mock_admin.get_user_credential.assert_not_called()

    def test_evict_via_credential_store(
        self, tmp_cache, mock_admin, mock_user_client_factory
    ):
        """evict 应该通过 CredentialStore 删除持久化凭证."""
        from drsai.modules.managers.user_profile.credential_store import CredentialStore
        cs = CredentialStore(base_dir=tmp_cache)

        cred = _cred("a@b.c")
        mock_admin.get_user_credential.return_value = cred
        p = GfsProvisioner(admin=mock_admin, credential_store=cs)
        p.get_user_client("a@b.c")

        assert cs.has_credential("a@b.c", "gfs")

        p.evict("a@b.c")

        assert not cs.has_credential("a@b.c", "gfs")
        assert "a@b.c" not in p._user_clients

    def test_has_cached_via_credential_store(self, tmp_cache, mock_admin):
        """has_cached 通过 CredentialStore 判断."""
        from drsai.modules.managers.user_profile.credential_store import CredentialStore
        from dataclasses import asdict
        cs = CredentialStore(base_dir=tmp_cache)

        # 直接写入 CredentialStore（不经过 provisioner）
        cred = _cred("store@x.com", ak="PRELOADED")
        cs.save_credential("store@x.com", "gfs", asdict(cred))

        p = GfsProvisioner(admin=mock_admin, credential_store=cs)
        assert p.has_cached("store@x.com")
        assert not p.has_cached("unknown@x.com")

    def test_fallback_without_credential_store(
        self, tmp_cache, mock_admin, mock_user_client_factory
    ):
        """未注入 CredentialStore 时回退到旧文件缓存（向后兼容）."""
        cred = _cred("fallback@x.com", ak="FALLBACK_AK")
        mock_admin.get_user_credential.return_value = cred
        p = GfsProvisioner(admin=mock_admin, cache_dir=tmp_cache)

        c = p.get_user_client("fallback@x.com")
        assert c.credential.access_key == "FALLBACK_AK"
        assert p._cred_path("fallback@x.com").exists()

    def test_shared_store_between_llm_and_gfs(
        self, tmp_cache, mock_admin, mock_user_client_factory
    ):
        """同一个 CredentialStore 同时存 LLM Key 和 GFS 凭证."""
        from drsai.modules.managers.user_profile.credential_store import CredentialStore
        cs = CredentialStore(base_dir=tmp_cache)

        # LLM 侧
        cs.save_api_key("shared@x.com", "sk-llm")

        # GFS 侧
        cred = _cred("shared@x.com", ak="GFS_AK")
        mock_admin.get_user_credential.return_value = cred
        p = GfsProvisioner(admin=mock_admin, credential_store=cs)
        p.get_user_client("shared@x.com")

        # 验证两者在同一目录下
        user_dir = cs.root_dir / "shared@x.com"
        assert (user_dir / "llm.json").is_file()
        assert (user_dir / "gfs.json").is_file()

        # 互不干扰
        assert cs.get_api_key("shared@x.com") == "sk-llm"
        gfs_data = cs.get_credential("shared@x.com", "gfs")
        assert gfs_data["access_key"] == "GFS_AK"

    def test_corrupt_gfs_in_store_triggers_refresh(
        self, tmp_cache, mock_admin, mock_user_client_factory
    ):
        """CredentialStore 中 GFS 凭证损坏 → 自动重取."""
        from drsai.modules.managers.user_profile.credential_store import CredentialStore
        cs = CredentialStore(base_dir=tmp_cache)

        # 写入损坏的 gfs 数据（缺少必需字段导致 GfsCredential(**data) 失败）
        cs.save_credential("corrupt@x.com", "gfs", {"foo": "bar"})

        fresh = _cred("corrupt@x.com", ak="FRESH_AK")
        mock_admin.get_user_credential.return_value = fresh
        p = GfsProvisioner(admin=mock_admin, credential_store=cs)

        c = p.get_user_client("corrupt@x.com")
        assert c.credential.access_key == "FRESH_AK"
        # 损坏数据应被清理并重写
        stored = cs.get_credential("corrupt@x.com", "gfs")
        assert stored is not None
        assert stored["access_key"] == "FRESH_AK"
