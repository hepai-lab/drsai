"""HepAI OIDC client: Authlib Authorization Code + PKCE S256 (confidential)."""

from __future__ import annotations

import json
import os
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse, urlunparse

import httpx
from authlib.integrations.starlette_client import OAuth
from fastapi import Request
from loguru import logger

logger = logger.bind(name="HepAI-OIDC")

DEFAULT_ISSUER = "https://ai-dev.ihep.ac.cn/api"
DEFAULT_SCOPE = "openid email profile hai_api offline_access"
DEFAULT_CLIENT_ID = "opendrsai-webui"
CALLBACK_PATH = "/auth/oidc/callback"
DEFAULT_IDP_LOGOUT_URL = "https://newlogin.ihep.ac.cn/logout/"
DEFAULT_ALLOWED_REDIRECT_URIS = (
    "https://opendrsai.ihep.ac.cn/auth/oidc/callback",
    "https://drsaiv2.ihep.ac.cn/auth/oidc/callback",
)
REQUEST_TIMEOUT = 15.0
SESSION_USER_KEY = "user"
SESSION_TOKEN_SID_KEY = "token_sid"

_oauth: OAuth | None = None
_store_lock = threading.Lock()


class OidcError(Exception):
    """OIDC protocol or configuration error."""


@dataclass(frozen=True)
class OidcClientConfig:
    issuer: str
    client_id: str
    client_secret: str
    scope: str
    session_secret: str
    allowed_redirect_uris: tuple[str, ...]

    @property
    def discovery_url(self) -> str:
        return f"{self.issuer}/.well-known/openid-configuration"

    @property
    def userinfo_url(self) -> str:
        return f"{self.issuer}/oauth2/userinfo"

    @property
    def token_url(self) -> str:
        return f"{self.issuer}/oauth2/token"


def _strip_env(value: str | None) -> str:
    if not value:
        return ""
    return value.strip().strip('"').strip("'")


def oidc_configured(env: Mapping[str, str] | None = None) -> bool:
    source = env if env is not None else os.environ
    return bool(
        _strip_env(source.get("OIDC_ISSUER"))
        and _strip_env(source.get("OIDC_CLIENT_ID"))
        and _strip_env(source.get("OIDC_CLIENT_SECRET"))
    )


def load_oidc_config(env: Mapping[str, str] | None = None) -> OidcClientConfig:
    source = env if env is not None else os.environ
    issuer = _strip_env(source.get("OIDC_ISSUER")) or DEFAULT_ISSUER
    client_id = _strip_env(source.get("OIDC_CLIENT_ID")) or DEFAULT_CLIENT_ID
    client_secret = _strip_env(source.get("OIDC_CLIENT_SECRET"))
    if not client_secret:
        raise OidcError("OIDC_CLIENT_SECRET is not set")
    scope = _strip_env(source.get("OIDC_SCOPE")) or DEFAULT_SCOPE
    session_secret = _strip_env(source.get("SESSION_SECRET")) or _strip_env(
        source.get("SECRET_KEY")
    )
    if not session_secret:
        raise OidcError("SESSION_SECRET is not set")
    return OidcClientConfig(
        issuer=issuer.rstrip("/"),
        client_id=client_id,
        client_secret=client_secret,
        scope=scope,
        session_secret=session_secret,
        allowed_redirect_uris=_allowed_redirect_uris(source),
    )


def _allowed_redirect_uris(env: Mapping[str, str]) -> tuple[str, ...]:
    uris: list[str] = list(DEFAULT_ALLOWED_REDIRECT_URIS)
    configured = _strip_env(env.get("OIDC_REDIRECT_URI"))
    if configured:
        uris.append(configured)
    extra = _strip_env(env.get("OIDC_ALLOWED_REDIRECT_URIS"))
    if extra:
        uris.extend(part for part in extra.replace(",", " ").split() if part)
    return tuple(dict.fromkeys(uris))


def authlib_client_kwargs(scope: str) -> dict[str, str]:
    return {
        "scope": scope,
        "code_challenge_method": "S256",
    }


def authorize_extra_params(env: Mapping[str, str] | None = None) -> dict[str, str]:
    """OIDC authorize extras. HAI then federates to IHEP SSO as upstream IdP.

    prompt=login / max_age=0 are still sent, but HAI currently ignores them when
    a HAI session cookie exists (it shows consent instead of IHEP). Login must
    therefore send the browser to /oauth2/upstream/ihep/login — see
    resolve_upstream_login_url.
    """
    source = env if env is not None else os.environ
    prompt = _strip_env(source.get("OIDC_PROMPT")) or "login"
    extras: dict[str, str] = {"prompt": prompt, "max_age": "0"}
    upstream = _strip_env(source.get("OIDC_UPSTREAM_IDP")) or "ihep"
    extras["idp"] = upstream
    extras["kc_idp_hint"] = upstream
    return extras


def _request_id_from_location(location: str) -> str:
    parsed = urlparse(location)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    fragment = parsed.fragment or ""
    if "?" in fragment:
        query.update(dict(parse_qsl(fragment.split("?", 1)[1], keep_blank_values=True)))
    return str(query.get("request_id") or "").strip()


def upstream_login_url_from_location(location: str, authorize_url: str) -> str:
    """Turn a HAI authorize Location into the IHEP upstream login URL."""
    dest = location if location.startswith("http") else urljoin(authorize_url, location)
    if "/oauth2/upstream/ihep/login" in dest or "newlogin.ihep.ac.cn" in dest:
        return dest
    request_id = _request_id_from_location(dest)
    if not request_id:
        return dest
    parsed = urlparse(authorize_url)
    return urlunparse(
        (
            parsed.scheme,
            parsed.netloc,
            "/api/oauth2/upstream/ihep/login",
            "",
            urlencode({"request_id": request_id}),
            "",
        )
    )


async def resolve_upstream_login_url(authorize_url: str) -> str:
    """Follow HAI authorize without the user's HAI cookie.

    The browser still has a HepAI session after app logout, so a top-level
    /oauth2/authorize lands on the consent page and never asks IHEP for a
    password. A cookieless server GET gets /oauth2/upstream/ihep/login instead.
    Sending the user there always federates to newlogin.ihep.ac.cn.
    """
    try:
        async with httpx.AsyncClient(follow_redirects=False, timeout=REQUEST_TIMEOUT) as client:
            response = await client.get(authorize_url)
    except httpx.HTTPError:
        logger.warning("HAI authorize probe failed; falling back to authorize URL")
        return authorize_url
    location = response.headers.get("location")
    if not location:
        return authorize_url
    return upstream_login_url_from_location(location, authorize_url)


def idp_logout_url(post_logout_redirect: str, env: Mapping[str, str] | None = None) -> str:
    """IHEP UMT logout. WebServerURL sends the browser back to this app after the IdP cookie is cleared."""
    source = env if env is not None else os.environ
    base = _strip_env(source.get("OIDC_IDP_LOGOUT_URL")) or DEFAULT_IDP_LOGOUT_URL
    parsed = urlparse(base)
    path = parsed.path or "/"
    if not path.endswith("/"):
        path = f"{path}/"
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query["WebServerURL"] = post_logout_redirect
    return urlunparse(parsed._replace(path=path, query=urlencode(query)))


def idp_logout_html(dest: str) -> str:
    """Tiny page that always navigates the browser to IHEP logout (survives proxies that eat 302)."""
    js_url = json.dumps(dest)
    safe = dest.replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;")
    return (
        "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"/>"
        f"<meta http-equiv=\"refresh\" content=\"0;url={safe}\"/>"
        "<title>Signing out</title></head><body>"
        "<p>正在退出统一认证…</p>"
        f"<script>location.replace({js_url});</script>"
        "</body></html>"
    )


def post_logout_redirect_url(request: Request) -> str:
    proto, host = public_base_parts(request)
    return f"{proto}://{host}/login?logout=1"


def clear_oidc_session(request: Request) -> str | None:
    """Drop the Starlette session and return the token-store sid, if any."""
    try:
        sid = request.session.get(SESSION_TOKEN_SID_KEY)
        request.session.clear()
    except AssertionError:
        return None
    return sid if isinstance(sid, str) and sid else None


def build_oauth(config: OidcClientConfig) -> OAuth:
    oauth = OAuth()
    oauth.register(
        name="hai",
        server_metadata_url=config.discovery_url,
        client_id=config.client_id,
        client_secret=config.client_secret,
        client_kwargs=authlib_client_kwargs(config.scope),
    )
    return oauth


def get_oauth() -> OAuth:
    global _oauth
    if _oauth is None:
        _oauth = build_oauth(load_oidc_config())
    return _oauth


def public_base_parts(request: Request) -> tuple[str, str]:
    proto = (request.headers.get("x-forwarded-proto") or request.url.scheme).split(",")[0].strip()
    host = (
        request.headers.get("x-forwarded-host")
        or request.headers.get("host")
        or request.url.netloc
    ).split(",")[0].strip()
    return proto, host


def callback_redirect_uri(request: Request, allowed: tuple[str, ...]) -> str:
    proto, host = public_base_parts(request)
    candidate = f"{proto}://{host}{CALLBACK_PATH}"
    if candidate in allowed:
        return candidate
    generated = str(request.url_for("oidc_callback"))
    parsed = urlparse(generated)
    rewritten = urlunparse((proto, host, parsed.path, "", "", ""))
    if rewritten in allowed:
        return rewritten
    raise OidcError(f"redirect_uri is not registered: {candidate}")


def session_user_payload(issuer: str, user: Mapping[str, Any]) -> dict[str, Any]:
    subject = str(user.get("sub") or "").strip()
    if not subject:
        raise OidcError("OIDC userinfo is missing sub")
    return {
        "issuer": issuer,
        "sub": subject,
        "email": user.get("email"),
        "name": user.get("name"),
        "picture": user.get("picture"),
        "roles": user.get("roles", []) if isinstance(user.get("roles"), list) else [],
    }


def session_user_id(user: Mapping[str, Any] | None) -> str | None:
    if not user:
        return None
    email = user.get("email")
    if isinstance(email, str) and email.strip():
        return email.strip()
    sub = user.get("sub")
    if isinstance(sub, str) and sub.strip():
        return sub.strip()
    return None


def get_session_user(request: Request) -> dict[str, Any] | None:
    try:
        user = request.session.get(SESSION_USER_KEY)
    except AssertionError:
        return None
    return user if isinstance(user, dict) else None


def _token_store_path() -> Path:
    root = Path(os.getenv("DRSAI_HOME") or (Path.home() / ".drsai"))
    root.mkdir(parents=True, exist_ok=True)
    return root / "oidc_token_store.json"


def _read_store() -> dict[str, Any]:
    path = _token_store_path()
    if not path.is_file():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def _write_store(payload: dict[str, Any]) -> None:
    path = _token_store_path()
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload), encoding="utf-8")
    tmp.replace(path)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def save_server_tokens(sid: str, token: Mapping[str, Any]) -> None:
    expires_at = time.time() + float(token.get("expires_in") or 3600) - 30
    record = {
        "access_token": token.get("access_token"),
        "refresh_token": token.get("refresh_token"),
        "expires_at": expires_at,
        "token_type": token.get("token_type", "Bearer"),
    }
    with _store_lock:
        store = _read_store()
        store[sid] = record
        _write_store(store)


def pop_server_tokens(sid: str) -> None:
    with _store_lock:
        store = _read_store()
        store.pop(sid, None)
        _write_store(store)


async def revoke_server_tokens(sid: str) -> None:
    """Best-effort RFC 7009 revoke, then drop the local token record."""
    record = load_server_tokens(sid)
    pop_server_tokens(sid)
    if not record:
        return
    try:
        config = load_oidc_config()
    except OidcError:
        return
    revoke_url = f"{config.issuer}/oauth2/revoke"
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
        for token, hint in (
            (record.get("refresh_token"), "refresh_token"),
            (record.get("access_token"), "access_token"),
        ):
            if not isinstance(token, str) or not token:
                continue
            try:
                await client.post(
                    revoke_url,
                    data={
                        "token": token,
                        "token_type_hint": hint,
                        "client_id": config.client_id,
                        "client_secret": config.client_secret,
                    },
                    headers={
                        "Accept": "application/json",
                        "Content-Type": "application/x-www-form-urlencoded",
                    },
                )
            except httpx.HTTPError:
                logger.warning("OIDC token revoke failed ({})", hint)


def load_server_tokens(sid: str) -> dict[str, Any] | None:
    with _store_lock:
        record = _read_store().get(sid)
    return record if isinstance(record, dict) else None


async def refresh_access_token(config: OidcClientConfig, refresh_token: str) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
        response = await client.post(
            config.token_url,
            data={
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
                "client_id": config.client_id,
                "client_secret": config.client_secret,
            },
            headers={
                "Accept": "application/json",
                "Content-Type": "application/x-www-form-urlencoded",
            },
        )
    if response.status_code >= 400:
        raise OidcError("OIDC refresh_token grant failed")
    payload = response.json()
    if not isinstance(payload, dict) or not payload.get("access_token"):
        raise OidcError("OIDC refresh response is missing access_token")
    if not payload.get("refresh_token"):
        payload["refresh_token"] = refresh_token
    return payload


async def get_valid_access_token(request: Request) -> str:
    try:
        sid = request.session.get(SESSION_TOKEN_SID_KEY)
    except AssertionError as exc:
        raise OidcError("OIDC session is missing") from exc
    if not isinstance(sid, str) or not sid:
        raise OidcError("OIDC session is missing")
    record = load_server_tokens(sid)
    if not record or not record.get("access_token"):
        raise OidcError("OIDC access token is missing")
    expires_at = float(record.get("expires_at") or 0)
    if expires_at > time.time():
        return str(record["access_token"])
    refresh = record.get("refresh_token")
    if not refresh:
        raise OidcError("OIDC refresh token is missing")
    config = load_oidc_config()
    token = await refresh_access_token(config, str(refresh))
    save_server_tokens(sid, token)
    return str(token["access_token"])


async def call_hai_api(access_token: str, url: str | None = None) -> dict[str, Any]:
    config = load_oidc_config()
    endpoint = url or config.userinfo_url
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
        response = await client.get(
            endpoint,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        response.raise_for_status()
        payload = response.json()
    if not isinstance(payload, dict):
        raise OidcError("HAI userinfo response is invalid")
    return payload
