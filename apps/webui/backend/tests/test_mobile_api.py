import os
import asyncio
import sys
import types
from pathlib import Path

import pytest
from fastapi import HTTPException

# The project package exports all Agent implementations from its root module.
# API unit tests do not need those optional browser/runtime dependencies.
package = types.ModuleType("drsai_ui")
package.__path__ = [str(Path(__file__).parents[1] / "src" / "drsai_ui")]
sys.modules.setdefault("drsai_ui", package)
backend = types.ModuleType("drsai_ui.ui_backend.backend")
backend.__path__ = [str(Path(__file__).parents[1] / "src" / "drsai_ui" / "ui_backend" / "backend")]
sys.modules.setdefault("drsai_ui.ui_backend.backend", backend)
deps = types.ModuleType("drsai_ui.ui_backend.backend.web.deps")
deps.get_db = lambda: None
deps.get_websocket_manager = lambda: None
sys.modules.setdefault("drsai_ui.ui_backend.backend.web.deps", deps)

from drsai_ui.drsai_adapter.sso.jwt import decode_jwt_token
from drsai_ui.ui_backend.backend.web.routes.mobile import DevLogin, dev_login


def test_dev_login_is_disabled_by_default(monkeypatch):
    monkeypatch.delenv("OPENDRSAI_MOBILE_DEV_AUTH", raising=False)
    with pytest.raises(HTTPException) as error:
        asyncio.run(dev_login(DevLogin(user_id="mobile-user")))
    assert error.value.status_code == 404


def test_dev_login_issues_access_and_refresh_tokens(monkeypatch):
    monkeypatch.setenv("OPENDRSAI_MOBILE_DEV_AUTH", "true")
    response = asyncio.run(dev_login(DevLogin(user_id="mobile-user")))
    data = response["data"]
    assert data["user_id"] == "mobile-user"
    assert decode_jwt_token(data["access_token"]).user_id == "mobile-user"
    assert decode_jwt_token(data["refresh_token"]).user_id == "mobile-user"


def test_dev_login_rejects_blank_user(monkeypatch):
    monkeypatch.setenv("OPENDRSAI_MOBILE_DEV_AUTH", "1")
    with pytest.raises(HTTPException) as error:
        asyncio.run(dev_login(DevLogin(user_id="   ")))
    assert error.value.status_code == 400
