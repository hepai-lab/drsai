"""Unit tests for drsai.modules.managers.gfs.admin_client.

Strategy: 用 ``unittest.mock`` 替换 ``GfsAdminClient._http.request`` 返回的 ``httpx.Response``，
避免对真实 OpenAPI 的依赖。
"""

from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import httpx
import pytest

from drsai.modules.managers.gfs.admin_client import (
    GfsAdminClient,
    GfsAdminError,
    GfsBucketInfo,
    GfsCredential,
)


# ---------------------------------------------------------------------- #
# Helpers
# ---------------------------------------------------------------------- #
def _mock_response(status: int, body: dict | None) -> httpx.Response:
    content = json.dumps(body).encode() if body is not None else b""
    return httpx.Response(
        status_code=status,
        content=content,
        headers={"content-type": "application/json"},
        request=httpx.Request("GET", "http://test/"),
    )


@pytest.fixture
def admin() -> GfsAdminClient:
    return GfsAdminClient(
        base_url="http://gfs.test:7800",
        api_key="test-admin-key",
        s3_endpoint="https://fgws3.test",
    )


# ---------------------------------------------------------------------- #
# 构造 / 鉴权
# ---------------------------------------------------------------------- #
class TestConstruction:
    def test_requires_api_key(self, monkeypatch):
        monkeypatch.delenv("GFS_OPENAPI_KEY", raising=False)
        with pytest.raises(RuntimeError, match="api key"):
            GfsAdminClient(api_key=None)

    def test_reads_env(self, monkeypatch):
        monkeypatch.setenv("GFS_OPENAPI_KEY", "env-key")
        c = GfsAdminClient()
        assert c.api_key == "env-key"

    def test_base_url_stripped(self):
        c = GfsAdminClient(
            base_url="http://gfs.test:7800/", api_key="k"
        )
        assert c.base_url == "http://gfs.test:7800"


# ---------------------------------------------------------------------- #
# _call 行为
# ---------------------------------------------------------------------- #
class TestCall:
    def test_success_returns_data(self, admin):
        with patch.object(admin._http, "request") as req:
            req.return_value = _mock_response(
                200, {"code": 200, "message": "ok", "data": {"x": 1}}
            )
            assert admin._call("GET", "/v1/foo") == {"x": 1}

    def test_http_4xx_raises(self, admin):
        with patch.object(admin._http, "request") as req:
            req.return_value = _mock_response(
                404, {"code": "NOT_FOUND", "message": "no such user"}
            )
            with pytest.raises(GfsAdminError) as exc:
                admin._call("GET", "/v1/users/x")
            assert exc.value.status == 404
            assert exc.value.code == "NOT_FOUND"

    def test_http_error_wraps(self, admin):
        with patch.object(admin._http, "request") as req:
            req.side_effect = httpx.ConnectError("nope")
            with pytest.raises(GfsAdminError) as exc:
                admin._call("GET", "/healthz")
            assert exc.value.status == 0
            assert "nope" in exc.value.message

    def test_invalid_json_returns_safe_error(self, admin):
        with patch.object(admin._http, "request") as req:
            req.return_value = httpx.Response(
                status_code=500,
                content=b"<html>500</html>",
                request=httpx.Request("GET", "http://test/"),
            )
            with pytest.raises(GfsAdminError) as exc:
                admin._call("GET", "/healthz")
            assert exc.value.status == 500


# ---------------------------------------------------------------------- #
# list_buckets
# ---------------------------------------------------------------------- #
class TestListBuckets:
    def test_parses_items(self, admin):
        body = {
            "code": 200, "message": "ok",
            "data": {
                "items": [{
                    "bucket_name": "20235-xiongdb", "short_name": "xiongdb",
                    "owner_id": "20235", "quota_mb": 512000,
                    "used_bytes": 100, "file_num": 5, "mtime": 1700000000,
                }],
                "total": 1,
            },
        }
        with patch.object(admin._http, "request") as req:
            req.return_value = _mock_response(200, body)
            buckets = admin.list_buckets("xiongdb@ihep.ac.cn")
            assert len(buckets) == 1
            b = buckets[0]
            assert isinstance(b, GfsBucketInfo)
            assert b.bucket_name == "20235-xiongdb"
            assert b.owner_id == "20235"
            assert b.quota_mb == 512000

    def test_email_in_path(self, admin):
        with patch.object(admin._http, "request") as req:
            req.return_value = _mock_response(
                200, {"code": 200, "message": "ok", "data": {"items": []}}
            )
            admin.list_buckets("alice@ihep.ac.cn")
            args, kwargs = req.call_args
            # httpx.Client.request(method, url, ...)
            assert "alice@ihep.ac.cn" in args[1]

    def test_empty_list(self, admin):
        with patch.object(admin._http, "request") as req:
            req.return_value = _mock_response(
                200, {"code": 200, "message": "ok", "data": {}}
            )
            assert admin.list_buckets("a@b.c") == []


# ---------------------------------------------------------------------- #
# list_credentials / _pick_usable_credential
# ---------------------------------------------------------------------- #
class TestListCredentials:
    def test_returns_items(self, admin):
        cred_item = {
            "access_key": "AK1", "secret_key": "SK1",
            "expiration": 9999999999, "status": "active",
            "resources": [{"Bucket": "20001-d", "Path": "/buckets/20001-d",
                           "Actions": ["Write", "Read", "List"]}],
        }
        with patch.object(admin._http, "request") as req:
            req.return_value = _mock_response(
                200, {"code": 200, "message": "ok",
                      "data": {"items": [cred_item], "total": 1}}
            )
            creds = admin.list_credentials("a@b.c")
            assert len(creds) == 1
            assert creds[0]["access_key"] == "AK1"


class TestPickCredential:
    @staticmethod
    def _c(ak, status="active", actions=None, sk="SK"):
        return {
            "access_key": ak, "secret_key": sk, "status": status,
            "resources": ([{"Actions": actions}] if actions is not None else []),
        }

    def test_pick_explicit_rw(self):
        items = [
            self._c("AK_ro", actions=["Read", "List"]),
            self._c("AK_rw", actions=["Write", "Read", "List"]),
        ]
        c = GfsAdminClient._pick_usable_credential(items, require_writable=True)
        assert c["access_key"] == "AK_rw"

    def test_fallback_to_empty_resources(self):
        items = [self._c("AK_empty", actions=None)]
        c = GfsAdminClient._pick_usable_credential(items, require_writable=True)
        assert c["access_key"] == "AK_empty"

    def test_skip_inactive(self):
        items = [self._c("AK_off", status="disabled", actions=["Write"])]
        c = GfsAdminClient._pick_usable_credential(items, require_writable=True)
        assert c is None

    def test_skip_missing_keys(self):
        items = [{"access_key": "", "secret_key": "x", "status": "active"}]
        c = GfsAdminClient._pick_usable_credential(items, require_writable=True)
        assert c is None

    def test_rw_preferred_over_empty(self):
        items = [
            self._c("AK_empty", actions=None),
            self._c("AK_rw", actions=["Write"]),
        ]
        c = GfsAdminClient._pick_usable_credential(items, require_writable=True)
        assert c["access_key"] == "AK_rw"

    def test_ro_when_not_require_writable(self):
        items = [self._c("AK_ro", actions=["Read"])]
        c = GfsAdminClient._pick_usable_credential(items, require_writable=False)
        # require_writable=False 时，空 actions 也接受；显式 ro 仍被排除（因为没进 any_active）
        assert c is None


# ---------------------------------------------------------------------- #
# get_user_credential 组合
# ---------------------------------------------------------------------- #
class TestGetUserCredential:
    def test_happy_path(self, admin):
        bucket_body = {"code": 200, "message": "ok", "data": {"items": [{
            "bucket_name": "20001-alice", "short_name": "alice",
            "owner_id": "20001", "quota_mb": 512000,
        }]}}
        cred_body = {"code": 200, "message": "ok", "data": {"items": [{
            "access_key": "AK", "secret_key": "SK",
            "expiration": -1, "status": "active",
        }]}}

        with patch.object(admin._http, "request") as req:
            req.side_effect = [
                _mock_response(200, bucket_body),
                _mock_response(200, cred_body),
            ]
            cred = admin.get_user_credential("alice@ihep.ac.cn")
        assert isinstance(cred, GfsCredential)
        assert cred.email == "alice@ihep.ac.cn"
        assert cred.bucket == "20001-alice"
        assert cred.owner_id == "20001"
        assert cred.access_key == "AK"
        assert cred.secret_key == "SK"
        assert cred.never_expires

    def test_no_bucket_raises(self, admin):
        with patch.object(admin._http, "request") as req:
            req.return_value = _mock_response(
                200, {"code": 200, "message": "ok", "data": {"items": []}}
            )
            with pytest.raises(GfsAdminError) as exc:
                admin.get_user_credential("a@b.c")
            assert exc.value.code == "NO_BUCKET"

    def test_no_credential_triggers_create_then_list(self, admin):
        bucket_body = {"code": 200, "message": "ok", "data": {"items": [{
            "bucket_name": "B", "short_name": "u", "owner_id": "1", "quota_mb": 1,
        }]}}
        empty_creds = {"code": 200, "message": "ok", "data": {"items": []}}
        post_resp = {"code": 200, "message": "ok"}
        after_create = {"code": 200, "message": "ok", "data": {"items": [{
            "access_key": "NEW", "secret_key": "NSK", "status": "active",
        }]}}

        with patch.object(admin._http, "request") as req:
            req.side_effect = [
                _mock_response(200, bucket_body),       # list_buckets
                _mock_response(200, empty_creds),       # list_credentials (empty)
                _mock_response(200, post_resp),         # POST credentials
                _mock_response(200, after_create),      # list_credentials (after)
            ]
            cred = admin.get_user_credential("a@b.c")
        assert cred.access_key == "NEW"

    def test_create_fails_then_list_still_works(self, admin):
        """POST 500 → 不抛错，落到第二次 list 仍能拿到（其他线程可能并发申请过）."""
        bucket_body = {"code": 200, "message": "ok", "data": {"items": [{
            "bucket_name": "B", "short_name": "u", "owner_id": "1", "quota_mb": 1,
        }]}}
        empty_creds = {"code": 200, "message": "ok", "data": {"items": []}}
        post_err = {"code": "FGW_UNAVAILABLE", "message": "down"}
        after = {"code": 200, "message": "ok", "data": {"items": [{
            "access_key": "X", "secret_key": "Y", "status": "active",
        }]}}

        with patch.object(admin._http, "request") as req:
            req.side_effect = [
                _mock_response(200, bucket_body),
                _mock_response(200, empty_creds),
                _mock_response(502, post_err),
                _mock_response(200, after),
            ]
            cred = admin.get_user_credential("a@b.c")
        assert cred.access_key == "X"

    def test_no_credential_at_all_raises(self, admin):
        bucket_body = {"code": 200, "message": "ok", "data": {"items": [{
            "bucket_name": "B", "short_name": "u", "owner_id": "1", "quota_mb": 1,
        }]}}
        empty_creds = {"code": 200, "message": "ok", "data": {"items": []}}
        post_resp = {"code": 200, "message": "ok"}

        with patch.object(admin._http, "request") as req:
            req.side_effect = [
                _mock_response(200, bucket_body),
                _mock_response(200, empty_creds),
                _mock_response(200, post_resp),
                _mock_response(200, empty_creds),
            ]
            with pytest.raises(GfsAdminError) as exc:
                admin.get_user_credential("a@b.c")
            assert exc.value.code == "NO_CREDENTIAL"


# ---------------------------------------------------------------------- #
# Credential dataclass
# ---------------------------------------------------------------------- #
class TestCredential:
    def test_never_expires_minus_one(self):
        c = GfsCredential("AK", "SK", "B", "https://e", "u@h", "1", expiration=-1)
        assert c.never_expires

    def test_never_expires_big(self):
        c = GfsCredential("AK", "SK", "B", "https://e", "u@h", "1", expiration=9999999999)
        assert c.never_expires

    def test_masked_hides_secret(self):
        c = GfsCredential("AK_longkey_abcd1234", "very-secret-sk-xyz",
                          "B", "https://e", "u@h", "1")
        m = c.masked()
        assert "very-secret-sk-xyz" not in str(m)
        assert m["secret_key"] == "***"
        assert m["access_key"].startswith("AK_longk")
