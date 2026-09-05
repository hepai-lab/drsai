import sys
import types
from pathlib import Path
from unittest.mock import MagicMock

import pytest

package = types.ModuleType("drsai_ui")
package.__path__ = [str(Path(__file__).parents[1] / "src" / "drsai_ui")]
sys.modules.setdefault("drsai_ui", package)

from drsai_ui.drsai_adapter.sso.hepai_oidc import (
    OidcError,
    authlib_client_kwargs,
    authorize_extra_params,
    callback_redirect_uri,
    load_oidc_config,
    oidc_configured,
    session_user_id,
    session_user_payload,
)


def _env(**overrides: str) -> dict[str, str]:
    base = {
        "OIDC_ISSUER": "https://ai-dev.ihep.ac.cn/api",
        "OIDC_CLIENT_ID": "opendrsai-webui",
        "OIDC_CLIENT_SECRET": "test-client-secret",
        "OIDC_SCOPE": "openid email profile hai_api offline_access",
        "SESSION_SECRET": "session-secret-for-tests",
    }
    base.update(overrides)
    return base


def test_oidc_configured_requires_secret():
    assert oidc_configured(_env()) is True
    env = _env()
    env["OIDC_CLIENT_SECRET"] = ""
    assert oidc_configured(env) is False


def test_scope_strips_quotes_and_keeps_hai_api():
    config = load_oidc_config(_env(OIDC_SCOPE='"openid email profile hai_api offline_access"'))
    assert config.scope == "openid email profile hai_api offline_access"
    assert config.client_id == "opendrsai-webui"
    assert config.discovery_url.endswith("/.well-known/openid-configuration")


def test_authlib_client_forces_pkce_s256():
    kwargs = authlib_client_kwargs("openid email profile hai_api offline_access")
    assert kwargs["code_challenge_method"] == "S256"
    assert "offline_access" in kwargs["scope"]
    assert "hai_api" in kwargs["scope"]


def test_authorize_extras_force_ihep_sso_after_oidc():
    extras = authorize_extra_params(_env())
    assert extras["prompt"] == "login"
    assert extras["max_age"] == "0"
    assert extras["idp"] == "ihep"
    assert extras["kc_idp_hint"] == "ihep"


def test_upstream_login_url_from_hai_authorize_location():
    from drsai_ui.drsai_adapter.sso.hepai_oidc import upstream_login_url_from_location

    authorize = "https://ai-dev.ihep.ac.cn/api/oauth2/authorize?client_id=opendrsai-webui"
    request_id = "7cd17589-74f5-4544-8d78-2608b0af7eec"
    assert (
        upstream_login_url_from_location(
            f"https://ai-dev.ihep.ac.cn/api/oauth2/upstream/ihep/login?request_id={request_id}",
            authorize,
        )
        == f"https://ai-dev.ihep.ac.cn/api/oauth2/upstream/ihep/login?request_id={request_id}"
    )
    ihep = "https://newlogin.ihep.ac.cn/oauth2/authorize?client_id=13388"
    assert upstream_login_url_from_location(ihep, authorize) == ihep
    consent = (
        f"https://ai-dev.ihep.ac.cn/#/oidc/authorize?request_id={request_id}"
        "&decision_url=https://ai-dev.ihep.ac.cn/api/oauth2/authorize/decision"
    )
    assert (
        upstream_login_url_from_location(consent, authorize)
        == f"https://ai-dev.ihep.ac.cn/api/oauth2/upstream/ihep/login?request_id={request_id}"
    )


def test_idp_logout_url_sends_browser_back_to_app():
    from drsai_ui.drsai_adapter.sso.hepai_oidc import idp_logout_html, idp_logout_url

    url = idp_logout_url("https://drsaiv2.ihep.ac.cn/login?logout=1")
    assert url.startswith("https://newlogin.ihep.ac.cn/logout/")
    assert "WebServerURL=https%3A%2F%2Fdrsaiv2.ihep.ac.cn%2Flogin%3Flogout%3D1" in url
    html = idp_logout_html(url)
    assert "location.replace(" in html
    assert "newlogin.ihep.ac.cn/logout/" in html


def test_authlib_register_uses_confidential_secret():
    from drsai_ui.drsai_adapter.sso.hepai_oidc import build_oauth

    config = load_oidc_config(_env())
    oauth = build_oauth(config)
    client = oauth._clients["hai"]
    assert client.client_id == "opendrsai-webui"
    assert client.client_secret == "test-client-secret"
    assert client.client_kwargs["code_challenge_method"] == "S256"


def test_callback_redirect_uri_allowlist():
    allowed = (
        "https://opendrsai.ihep.ac.cn/auth/oidc/callback",
        "https://drsaiv2.ihep.ac.cn/auth/oidc/callback",
    )
    request = MagicMock()
    request.headers = {
        "x-forwarded-proto": "https",
        "x-forwarded-host": "opendrsai.ihep.ac.cn",
    }
    request.url.scheme = "http"
    request.url.netloc = "127.0.0.1:8086"
    request.url_for.return_value = "http://127.0.0.1:8086/auth/oidc/callback"
    assert callback_redirect_uri(request, allowed) == allowed[0]

    request.headers = {
        "x-forwarded-proto": "https",
        "x-forwarded-host": "evil.example",
        "host": "evil.example",
    }
    request.url.scheme = "https"
    request.url.netloc = "evil.example"
    with pytest.raises(OidcError, match="not registered"):
        callback_redirect_uri(request, allowed)


def test_session_user_payload_and_id():
    user = session_user_payload(
        "https://ai-dev.ihep.ac.cn/api",
        {"sub": "oidc-sub", "email": "user@ihep.ac.cn", "name": "User", "roles": ["user"]},
    )
    assert user["sub"] == "oidc-sub"
    assert user["email"] == "user@ihep.ac.cn"
    assert user["name"] == "User"
    assert session_user_id(user) == "user@ihep.ac.cn"
    with pytest.raises(OidcError, match="sub"):
        session_user_payload("https://ai-dev.ihep.ac.cn/api", {"email": "user@ihep.ac.cn"})
