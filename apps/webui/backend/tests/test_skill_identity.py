import asyncio
import sys
import types
from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

package = types.ModuleType("drsai_ui")
package.__path__ = [str(Path(__file__).parents[1] / "src" / "drsai_ui")]
sys.modules.setdefault("drsai_ui", package)

from drsai_ui.drsai_adapter.sso.jwt import create_jwt_token
from drsai_ui.ui_backend.backend.web.identity import resolve_request_user
from drsai_ui.ui_backend.backend.web.native_auth import NativeIdentity
from drsai_ui.ui_backend.backend.web import identity as identity_mod
from drsai_ui.ui_backend.backend.web import native_auth as native_auth_mod


class _FakeRequest:
    def __init__(self, headers=None, session=None):
        self.headers = headers or {}
        self.session = session if session is not None else {}
        self.state = SimpleNamespace()


def _run(coro):
    return asyncio.run(coro)


def _native_identity(email=None):
    return NativeIdentity(
        user_id="1e3da1ff-4551-4680-9e30-c281e796bc1f",
        issuer="https://ai-dev.ihep.ac.cn/api",
        email=email,
    )


def test_oidc_session_wins_over_api_key(monkeypatch):
    request = _FakeRequest(
        headers={"Authorization": "Bearer sk-should-not-be-used"},
        session={"user": {"sub": "oidc-sub", "email": "oidc@ihep.ac.cn"}},
    )
    verify = AsyncMock(side_effect=AssertionError("API key must not be used when OIDC session exists"))
    monkeypatch.setattr(identity_mod, "_verify_api_key", verify)

    uid = _run(resolve_request_user(request))
    assert uid == "oidc@ihep.ac.cn"
    assert request.state.user_id == "oidc@ihep.ac.cn"
    verify.assert_not_called()


def test_native_oidc_bearer_prefers_email_claim(monkeypatch):
    request = _FakeRequest(headers={"Authorization": "Bearer aaa.bbb.ccc"})
    monkeypatch.setattr(
        identity_mod,
        "try_get_native_identity",
        AsyncMock(return_value=_native_identity(email="native@ihep.ac.cn")),
    )
    userinfo = AsyncMock(side_effect=AssertionError("userinfo must not run when email claim exists"))
    monkeypatch.setattr(identity_mod, "fetch_native_userinfo_email", userinfo)
    verify = AsyncMock(side_effect=AssertionError("API key must not run after OIDC"))
    monkeypatch.setattr(identity_mod, "_verify_api_key", verify)

    uid = _run(resolve_request_user(request))
    assert uid == "native@ihep.ac.cn"
    verify.assert_not_called()
    userinfo.assert_not_called()


def test_native_oidc_uses_userinfo_email_when_claim_missing(monkeypatch):
    request = _FakeRequest(
        headers={
            "Authorization": "Bearer aaa.bbb.ccc",
            "X-OpenDrSai-Auth-Mode": "oidc",
            "X-OpenDrSai-Principal": "haiuser06@ihep.ac.cn",
        }
    )
    monkeypatch.setattr(
        identity_mod,
        "try_get_native_identity",
        AsyncMock(return_value=_native_identity()),
    )
    userinfo = AsyncMock(return_value="haiuser06@ihep.ac.cn")
    monkeypatch.setattr(identity_mod, "fetch_native_userinfo_email", userinfo)
    verify = AsyncMock(side_effect=AssertionError("API key must not run after OIDC"))
    monkeypatch.setattr(identity_mod, "_verify_api_key", verify)

    uid = _run(resolve_request_user(request))
    assert uid == "haiuser06@ihep.ac.cn"
    userinfo.assert_awaited_once()
    verify.assert_not_called()


def test_native_oidc_does_not_persist_sub_without_email(monkeypatch):
    request = _FakeRequest(headers={"Authorization": "Bearer aaa.bbb.ccc"})
    monkeypatch.setattr(
        identity_mod,
        "try_get_native_identity",
        AsyncMock(return_value=_native_identity()),
    )
    monkeypatch.setattr(identity_mod, "fetch_native_userinfo_email", AsyncMock(return_value=None))

    with pytest.raises(HTTPException) as exc:
        _run(resolve_request_user(request))
    assert exc.value.status_code == 401
    assert exc.value.detail == "OIDC user is missing a verified email"


def test_oidc_auth_mode_does_not_treat_jwt_as_api_key(monkeypatch):
    request = _FakeRequest(
        headers={
            "Authorization": "Bearer aaa.bbb.ccc",
            "X-OpenDrSai-Auth-Mode": "oidc",
        }
    )
    monkeypatch.setattr(identity_mod, "try_get_native_identity", AsyncMock(return_value=None))
    verify = AsyncMock(side_effect=AssertionError("API key must not run when Auth-Mode is oidc"))
    monkeypatch.setattr(identity_mod, "_verify_api_key", verify)
    monkeypatch.setattr(identity_mod, "_webui_jwt_user_id", lambda _token: None)

    with pytest.raises(HTTPException) as exc:
        _run(resolve_request_user(request))
    assert exc.value.status_code == 401
    assert exc.value.detail == "Invalid OIDC access token"
    verify.assert_not_called()


def test_principal_email_mismatch_is_rejected(monkeypatch):
    request = _FakeRequest(
        headers={
            "Authorization": "Bearer aaa.bbb.ccc",
            "X-OpenDrSai-Auth-Mode": "oidc",
            "X-OpenDrSai-Principal": "other@ihep.ac.cn",
        }
    )
    monkeypatch.setattr(
        identity_mod,
        "try_get_native_identity",
        AsyncMock(return_value=_native_identity(email="haiuser06@ihep.ac.cn")),
    )

    with pytest.raises(HTTPException) as exc:
        _run(resolve_request_user(request))
    assert exc.value.status_code == 401
    assert exc.value.detail == "OIDC principal does not match token email"


def test_principal_uuid_is_ignored(monkeypatch):
    request = _FakeRequest(
        headers={
            "Authorization": "Bearer aaa.bbb.ccc",
            "X-OpenDrSai-Principal": "1e3da1ff-4551-4680-9e30-c281e796bc1f",
        }
    )
    monkeypatch.setattr(
        identity_mod,
        "try_get_native_identity",
        AsyncMock(return_value=_native_identity(email="haiuser06@ihep.ac.cn")),
    )

    uid = _run(resolve_request_user(request))
    assert uid == "haiuser06@ihep.ac.cn"


def test_webui_jwt_used_when_native_oidc_fails(monkeypatch):
    token = create_jwt_token(
        {"sub": "jwt-user@ihep.ac.cn"},
        expires_delta=timedelta(minutes=5),
    ).access_token
    request = _FakeRequest(headers={"Authorization": f"Bearer {token}"})
    monkeypatch.setattr(identity_mod, "try_get_native_identity", AsyncMock(return_value=None))
    verify = AsyncMock(side_effect=AssertionError("API key must not run after JWT"))
    monkeypatch.setattr(identity_mod, "_verify_api_key", verify)

    uid = _run(resolve_request_user(request))
    assert uid == "jwt-user@ihep.ac.cn"
    verify.assert_not_called()


def test_invalid_oidc_jwt_falls_back_to_api_key(monkeypatch):
    request = _FakeRequest(headers={"Authorization": "Bearer aaa.bbb.ccc"})
    monkeypatch.setattr(identity_mod, "try_get_native_identity", AsyncMock(return_value=None))
    monkeypatch.setattr(identity_mod, "_webui_jwt_user_id", lambda _token: None)
    monkeypatch.setattr(identity_mod, "_verify_api_key", AsyncMock(return_value="key-user@ihep.ac.cn"))

    uid = _run(resolve_request_user(request))
    assert uid == "key-user@ihep.ac.cn"
    identity_mod._verify_api_key.assert_awaited_once_with("aaa.bbb.ccc")


def test_api_key_used_when_oidc_fails(monkeypatch):
    request = _FakeRequest(headers={"Authorization": "Bearer sk-user-key"})
    monkeypatch.setattr(identity_mod, "try_get_native_identity", AsyncMock(return_value=None))
    monkeypatch.setattr(identity_mod, "_verify_api_key", AsyncMock(return_value="key-user@ihep.ac.cn"))

    uid = _run(resolve_request_user(request))
    assert uid == "key-user@ihep.ac.cn"
    identity_mod._verify_api_key.assert_awaited_once_with("sk-user-key")


def test_invalid_api_key_raises_401(monkeypatch):
    request = _FakeRequest(headers={"Authorization": "Bearer sk-bad"})
    monkeypatch.setattr(
        identity_mod,
        "_verify_api_key",
        AsyncMock(side_effect=HTTPException(status_code=401, detail="Invalid API key")),
    )
    with pytest.raises(HTTPException) as exc:
        _run(resolve_request_user(request))
    assert exc.value.status_code == 401
    assert exc.value.detail == "Invalid API key"


def test_missing_credentials_returns_none():
    request = _FakeRequest()
    assert _run(resolve_request_user(request)) is None


def test_verify_api_key_reads_email(monkeypatch):
    class _Resp:
        status_code = 200

        def json(self):
            return {"email": "from-key@ihep.ac.cn"}

    class _Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def get(self, url, params=None, headers=None):
            assert params == {"api_key": "sk-ok"}
            return _Resp()

    monkeypatch.setattr(identity_mod.httpx, "AsyncClient", lambda **_kwargs: _Client())
    uid = _run(identity_mod._verify_api_key("sk-ok"))
    assert uid == "from-key@ihep.ac.cn"


def test_fetch_native_userinfo_email_reads_verified_email(monkeypatch):
    native_auth_mod._userinfo_email_cache.clear()

    class _Resp:
        status_code = 200

        def json(self):
            return {
                "sub": "1e3da1ff-4551-4680-9e30-c281e796bc1f",
                "email": "haiuser06@ihep.ac.cn",
                "email_verified": True,
            }

    class _Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def get(self, url, headers=None):
            assert url == "https://ai-dev.ihep.ac.cn/api/oauth2/userinfo"
            assert headers["Authorization"] == "Bearer access-token"
            return _Resp()

    monkeypatch.setattr(native_auth_mod.httpx, "AsyncClient", lambda **_kwargs: _Client())
    email = _run(
        native_auth_mod.fetch_native_userinfo_email(
            "access-token",
            "https://ai-dev.ihep.ac.cn/api",
            "1e3da1ff-4551-4680-9e30-c281e796bc1f",
        )
    )
    assert email == "haiuser06@ihep.ac.cn"


def test_fetch_native_userinfo_email_rejects_unverified(monkeypatch):
    native_auth_mod._userinfo_email_cache.clear()

    class _Resp:
        status_code = 200

        def json(self):
            return {"sub": "sub-1", "email": "user@ihep.ac.cn", "email_verified": False}

    class _Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def get(self, url, headers=None):
            return _Resp()

    monkeypatch.setattr(native_auth_mod.httpx, "AsyncClient", lambda **_kwargs: _Client())
    email = _run(
        native_auth_mod.fetch_native_userinfo_email(
            "access-token",
            "https://ai-dev.ihep.ac.cn/api",
            "sub-1",
        )
    )
    assert email is None
