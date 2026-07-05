"""Unit tests for drsai.modules.managers.gfs.agent_tools.make_gfs_tools."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from drsai.modules.managers.gfs.admin_client import GfsCredential
from drsai.modules.managers.gfs.agent_tools import make_gfs_tools
from drsai.modules.managers.gfs.provisioner import GfsProvisioner
from drsai.modules.managers.gfs.user_client import GfsObjectInfo


@pytest.fixture(autouse=True)
def _reset_singleton():
    GfsProvisioner.reset()
    yield
    GfsProvisioner.reset()


@pytest.fixture
def mock_user_client():
    return MagicMock(name="GfsUserClient", bucket="20001-alice")


@pytest.fixture
def patched_provisioner(mock_user_client, monkeypatch, tmp_path):
    """Patch GfsProvisioner.get() to return a fresh provisioner whose
    get_user_client always returns the mock."""
    monkeypatch.setenv("DRSAI_GFS_CACHE_DIR", str(tmp_path))
    monkeypatch.setenv("GFS_OPENAPI_KEY", "test-key")

    p = GfsProvisioner.get()
    monkeypatch.setattr(p, "get_user_client",
                        MagicMock(return_value=mock_user_client))
    return p


# ---------------------------------------------------------------------- #
# Top-level shape
# ---------------------------------------------------------------------- #
class TestFactory:
    def test_empty_email_returns_empty(self):
        assert make_gfs_tools("") == []
        assert make_gfs_tools(None) == []

    def test_returns_8_callables(self, patched_provisioner):
        tools = make_gfs_tools("alice@x.com")
        assert len(tools) == 8
        names = [t.__name__ for t in tools]
        assert names == [
            "gfs_ls", "gfs_stat", "gfs_read", "gfs_write",
            "gfs_upload", "gfs_download", "gfs_delete", "gfs_share_url",
        ]

    def test_tools_have_docstrings(self, patched_provisioner):
        for t in make_gfs_tools("alice@x.com"):
            assert t.__doc__ and len(t.__doc__.strip()) > 10, \
                f"{t.__name__} missing docstring"


# ---------------------------------------------------------------------- #
# Each tool
# ---------------------------------------------------------------------- #
@pytest.fixture
def tools(patched_provisioner):
    return {t.__name__: t for t in make_gfs_tools("alice@x.com")}


class TestGfsLs:
    def test_empty(self, tools, mock_user_client):
        mock_user_client.list_dir.return_value = []
        s = tools["gfs_ls"]("workspace/")
        assert "empty" in s
        assert "20001-alice" in s

    def test_lists_files_and_dirs(self, tools, mock_user_client):
        mock_user_client.list_dir.return_value = [
            GfsObjectInfo(path="workspace/sub/", size=0, etag="", modified_ms=0, is_dir=True),
            GfsObjectInfo(path="workspace/a.txt", size=42, etag="x", modified_ms=0),
            GfsObjectInfo(path="workspace/b.bin", size=2048, etag="y", modified_ms=0),
        ]
        out = tools["gfs_ls"]("workspace/")
        assert "DIR" in out
        assert "workspace/sub/" in out
        assert "42 B" in out
        assert "2.0 KB" in out

    def test_passes_kwargs(self, tools, mock_user_client):
        mock_user_client.list_dir.return_value = []
        tools["gfs_ls"]("uploads/", recursive=True, max_items=50)
        kw = mock_user_client.list_dir.call_args.kwargs
        assert kw["recursive"] is True
        assert kw["max_items"] == 50


class TestGfsStat:
    def test_not_found(self, tools, mock_user_client):
        mock_user_client.exists.return_value = False
        s = tools["gfs_stat"]("missing.txt")
        assert "not found" in s

    def test_returns_json(self, tools, mock_user_client):
        mock_user_client.exists.return_value = True
        mock_user_client.head.return_value = GfsObjectInfo(
            path="a.txt", size=1024, etag="abc", modified_ms=1700_000_000_000
        )
        import json as _json
        out = _json.loads(tools["gfs_stat"]("a.txt"))
        assert out["size"] == 1024
        assert out["etag"] == "abc"
        assert "KB" in out["size_human"]


class TestGfsRead:
    def test_small_returns_full(self, tools, mock_user_client):
        mock_user_client.read_text.return_value = "hello"
        assert tools["gfs_read"]("a.txt") == "hello"

    def test_too_big_truncated(self, tools, mock_user_client):
        big = "x" * (100 * 1024)
        mock_user_client.read_text.return_value = big
        out = tools["gfs_read"]("a.txt")
        assert "[... truncated" in out
        assert str(len(big)) in out

    def test_value_error_becomes_message(self, tools, mock_user_client):
        mock_user_client.read_text.side_effect = ValueError("too big")
        out = tools["gfs_read"]("a.bin")
        assert out.startswith("ERROR:")
        assert "too big" in out


class TestGfsWrite:
    def test_writes_and_reports(self, tools, mock_user_client):
        mock_user_client.write_text.return_value = "deadbeef"
        out = tools["gfs_write"]("a.md", "hi")
        assert "deadbeef" in out
        assert "a.md" in out
        assert "20001-alice" in out
        mock_user_client.write_text.assert_called_once_with("a.md", "hi")


class TestGfsUploadDownloadDelete:
    def test_upload(self, tools, mock_user_client):
        out = tools["gfs_upload"]("/tmp/x.csv", "uploads/run-1/x.csv")
        mock_user_client.upload_file.assert_called_once_with(
            "/tmp/x.csv", "uploads/run-1/x.csv"
        )
        assert "/tmp/x.csv" in out
        assert "uploads/run-1/x.csv" in out

    def test_download(self, tools, mock_user_client):
        tools["gfs_download"]("a.txt", "/tmp/a.txt")
        mock_user_client.download_file.assert_called_once_with("a.txt", "/tmp/a.txt")

    def test_delete(self, tools, mock_user_client):
        out = tools["gfs_delete"]("garbage.txt")
        mock_user_client.delete.assert_called_once_with("garbage.txt")
        assert "deleted" in out


class TestGfsShareUrl:
    def test_not_found(self, tools, mock_user_client):
        mock_user_client.exists.return_value = False
        out = tools["gfs_share_url"]("missing.txt")
        assert out.startswith("ERROR:")

    def test_returns_url(self, tools, mock_user_client):
        mock_user_client.exists.return_value = True
        mock_user_client.presign_get.return_value = "https://x/y?sig=..."
        out = tools["gfs_share_url"]("a.txt", ttl_minutes=30)
        assert out == "https://x/y?sig=..."
        kw = mock_user_client.presign_get.call_args
        assert kw.kwargs["ttl_sec"] == 30 * 60

    def test_ttl_clamped(self, tools, mock_user_client):
        mock_user_client.exists.return_value = True
        mock_user_client.presign_get.return_value = "url"
        tools["gfs_share_url"]("a.txt", ttl_minutes=99999)
        kw = mock_user_client.presign_get.call_args
        # 上限 1440 min
        assert kw.kwargs["ttl_sec"] == 1440 * 60

    def test_ttl_floor(self, tools, mock_user_client):
        mock_user_client.exists.return_value = True
        mock_user_client.presign_get.return_value = "url"
        tools["gfs_share_url"]("a.txt", ttl_minutes=0)
        kw = mock_user_client.presign_get.call_args
        assert kw.kwargs["ttl_sec"] == 1 * 60
