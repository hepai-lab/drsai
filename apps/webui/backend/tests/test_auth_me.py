import asyncio
import inspect
import sys
import types
from datetime import timedelta
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

package = types.ModuleType("drsai_ui")
package.__path__ = [str(Path(__file__).parents[1] / "src" / "drsai_ui")]
sys.modules.setdefault("drsai_ui", package)
backend = types.ModuleType("drsai_ui.ui_backend.backend")
backend.__path__ = [str(Path(__file__).parents[1] / "src" / "drsai_ui" / "ui_backend" / "backend")]
sys.modules.setdefault("drsai_ui.ui_backend.backend", backend)

from drsai_ui.drsai_adapter.sso.jwt import create_jwt_token
from drsai_ui.ui_backend.backend.web.routes.auth import auth_me


def _request_without_session() -> MagicMock:
    request = MagicMock()
    request.session.get.side_effect = AssertionError("SessionMiddleware not installed")
    return request


def _request_with_session_user(user: dict) -> MagicMock:
    request = MagicMock()
    request.session.get.return_value = user
    return request


def _token(user_id: str) -> str:
    return create_jwt_token(
        data={"sub": user_id},
        expires_delta=timedelta(minutes=30),
    ).access_token


def test_auth_me_signature_has_no_db_dependency():
    source = inspect.getsource(auth_me)
    assert "db" not in inspect.signature(auth_me).parameters
    assert "get_profile_fields" not in source
    assert "to_thread" not in source


def test_auth_me_jwt_returns_user_id_without_sqlite():
    payload = asyncio.run(
        auth_me(_request_without_session(), token=_token("alice@ihep.ac.cn"))
    )
    assert payload["status"] is True
    assert payload["data"]["user_id"] == "alice@ihep.ac.cn"
    assert payload["data"]["cooper_info"] == ""
    assert payload["data"]["display_name"] == ""


def test_auth_me_session_cookie_skips_jwt():
    request = _request_with_session_user(
        {"email": "bob@ihep.ac.cn", "sub": "oidc-sub", "name": "Bob"}
    )
    payload = asyncio.run(auth_me(request, token=_token("should-not-win")))
    assert payload["data"]["user_id"] == "bob@ihep.ac.cn"
    assert payload["data"]["display_name"] == "Bob"


def test_auth_me_rejects_missing_credentials():
    with pytest.raises(HTTPException) as error:
        asyncio.run(auth_me(_request_without_session(), token=None))
    assert error.value.status_code == 401
