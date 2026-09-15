from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import logging
import os
import re
import time
import urllib.parse
import urllib.request
import uuid
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field as dataclass_field
from typing import FrozenSet, Iterator, Protocol
from pydantic import SecretStr

from drsai.platform_upstream import (
    API_PATH_PREFIX,
    DEVELOPMENT_MODEL_BASE_URL,
    PRODUCTION_MODEL_BASE_URL,
    resolve_platform_base_url,
    resolve_hepai_model_base_url,
)


@dataclass(frozen=True)
class PlatformAuthContext:
    access_token: str
    subject: str
    issuer: str
    expires_at: int
    model_base_url: str
    organization_id: str | None = None
    session_id: str | None = None
    audience: str | None = None
    # OIDC refresh token for server-side access token renewal. Only present
    # when the gateway received it via the x-opendrsai-refresh-token header.
    refresh_token: str | None = None
    # OIDC login email (``email`` claim of the verified access token when the
    # issuer includes it; otherwise filled by the gateway auth middleware from
    # the authenticated caller's X-OpenDrSai-User-Email header). Remote DDF
    # workers key their users on this email, not on the UUID subject.
    user_email: str | None = None

    @property
    def anthropic_base_url(self) -> str:
        return f"{self.model_base_url.removesuffix('/v1')}/anthropic"


@dataclass(frozen=True)
class DelegatedCredentialContext:
    access_token: SecretStr | str = dataclass_field(repr=False)
    token_type: str = "Bearer"
    expires_at: int = 0
    audience: str = "hai-model-gateway"
    invocation_id: str = ""
    subject: str = ""
    worker_id: str = ""
    allowed_models: FrozenSet[str] = frozenset()
    allowed_operations: FrozenSet[str] = frozenset()
    model_base_url: str = DEVELOPMENT_MODEL_BASE_URL

    def __post_init__(self) -> None:
        if isinstance(self.access_token, str):
            object.__setattr__(self, "access_token", SecretStr(self.access_token))
        if self.token_type != "Bearer" or self.audience != "hai-model-gateway":
            raise ValueError("invalid_delegated_credential")
        if self.expires_at <= int(time.time()):
            raise ValueError("delegation_expired")
        # Build the allowed set from the unified platform base + explicit overrides.
        allowed = {DEVELOPMENT_MODEL_BASE_URL, PRODUCTION_MODEL_BASE_URL}
        base = resolve_platform_base_url(os.environ)
        allowed.add(f"{base}{API_PATH_PREFIX}")
        allowed.add(f"{base}{API_PATH_PREFIX}/v1")
        configured = os.environ.get("OPENDRSAI_MODEL_BASE_URL", "").strip().rstrip("/")
        if configured:
            allowed.add(configured)
        if self.model_base_url.rstrip("/") not in allowed:
            raise ValueError("delegation_host_not_allowed")

    def __reduce__(self):
        raise TypeError("delegated credentials cannot be pickled")


class ModelCredentialProvider(Protocol):
    @property
    def access_token(self) -> str: ...

    @property
    def openai_base_url(self) -> str: ...

    @property
    def anthropic_base_url(self) -> str: ...

    @property
    def delegation_headers(self) -> dict[str, str]: ...


@dataclass(frozen=True)
class OidcModelCredentialProvider:
    context: PlatformAuthContext

    @property
    def access_token(self) -> str:
        return self.context.access_token

    @property
    def openai_base_url(self) -> str:
        return self.context.model_base_url

    @property
    def anthropic_base_url(self) -> str:
        return self.context.anthropic_base_url

    @property
    def delegation_headers(self) -> dict[str, str]:
        return {}


@dataclass(frozen=True)
class DelegatedModelCredentialProvider:
    context: DelegatedCredentialContext

    @property
    def access_token(self) -> str:
        return self.context.access_token.get_secret_value()

    @property
    def openai_base_url(self) -> str:
        return self.context.model_base_url

    @property
    def anthropic_base_url(self) -> str:
        return f"{self.context.model_base_url.removesuffix('/v1')}/anthropic"

    @property
    def delegation_headers(self) -> dict[str, str]:
        return {
            "X-HepAI-Delegation-Worker-ID": self.context.worker_id,
            "X-HepAI-Delegation-Invocation-ID": self.context.invocation_id,
        }


@dataclass(frozen=True)
class StaticModelCredentialProvider:
    access_token: str
    openai_base_url: str

    @property
    def anthropic_base_url(self) -> str:
        return self.openai_base_url

    @property
    def delegation_headers(self) -> dict[str, str]:
        return {}


# ---------------------------------------------------------------------------
# TEMPORARY — bypass OIDC platform auth and route model calls directly to any
# OpenAI-compatible API.  Intended for development / PAYG-without-worker
# scenarios.  Remove once platform auth is healthy again.
#
#   DRSAI_BYPASS_PLATFORM_AUTH=1              ← enable the bypass
#   DRSAI_DIRECT_API_KEY=sk-...               ← your direct API key
#   OPENDRSAI_MODEL_BASE_URL=https://.../v1    ← target API base URL
# ---------------------------------------------------------------------------
_BYPASS_PLATFORM = os.environ.get("DRSAI_BYPASS_PLATFORM_AUTH", "").strip() == "1"


def get_model_credential_provider(
    fallback_token: str | None = None,
    fallback_base_url: str | None = None,
    *,
    configured_provider: bool = False,
) -> ModelCredentialProvider | None:
    # An Agent-selected external Provider is an explicit security boundary:
    # use only its own resolved credential and URL. Never replace a missing
    # third-party key with the HepAI OIDC token or a development bypass key.
    if configured_provider:
        return (
            StaticModelCredentialProvider(fallback_token, fallback_base_url)
            if fallback_token and fallback_base_url
            else None
        )
    delegated = get_delegated_credential()
    if delegated:
        return DelegatedModelCredentialProvider(delegated)
    if _BYPASS_PLATFORM:
        direct_key = os.environ.get("DRSAI_DIRECT_API_KEY", "").strip()
        direct_url = os.environ.get("OPENDRSAI_MODEL_BASE_URL", "").strip().rstrip("/")
        if direct_key and direct_url:
            return StaticModelCredentialProvider(access_token=direct_key, openai_base_url=direct_url)

    # An explicitly resolved Provider from Settings / Agent configuration is
    # authoritative.  A signed-in platform session identifies the user, but it
    # must not silently reroute a configured third-party model to HepAI or send
    # the HepAI bearer token to that third party.
    if static_model_credentials_allowed() and fallback_token and fallback_base_url:
        return StaticModelCredentialProvider(fallback_token, fallback_base_url)
    context = get_platform_auth()
    if context:
        return OidcModelCredentialProvider(context)
    return None


def static_model_credentials_allowed() -> bool:
    return os.environ.get("OPENDRSAI_OIDC_ONLY", "").strip() != "1"


_platform_auth: ContextVar[PlatformAuthContext | None] = ContextVar(
    "drsai_platform_auth",
    default=None,
)

_delegated_credential: ContextVar[DelegatedCredentialContext | None] = ContextVar(
    "drsai_delegated_credential", default=None,
)


def get_platform_auth() -> PlatformAuthContext | None:
    return _platform_auth.get()


def get_delegated_credential() -> DelegatedCredentialContext | None:
    local = _delegated_credential.get()
    if local is not None:
        return local
    # Remote Workers bind the transport credential in HepAI's request context.
    # Import lazily so local/CLI DrSai remains independent of the Worker SDK.
    try:
        from hepai.tools.request_context import get_remote_call_context
        remote = get_remote_call_context()
        delegated = remote.delegation if remote else None
    except (ImportError, AttributeError):
        return None
    if delegated is None:
        return None
    return DelegatedCredentialContext(
        access_token=delegated.access_token,
        token_type=delegated.token_type,
        expires_at=delegated.expires_at,
        audience=delegated.audience,
        invocation_id=delegated.invocation_id,
        subject=delegated.subject,
        worker_id=delegated.worker_id,
        allowed_models=frozenset(delegated.allowed_models),
        allowed_operations=frozenset(delegated.allowed_operations),
        model_base_url=getattr(
            delegated,
            "model_base_url",
            resolve_hepai_model_base_url(os.environ),
        ),
    )


@contextmanager
def delegated_credential_scope(context: DelegatedCredentialContext) -> Iterator[None]:
    """Bind a Worker-verified credential to exactly one remote-call lifetime."""
    token = _delegated_credential.set(context)
    try:
        yield
    finally:
        _delegated_credential.reset(token)


@contextmanager
def platform_auth_scope(context: PlatformAuthContext) -> Iterator[None]:
    token = _platform_auth.set(context)
    try:
        yield
    finally:
        _platform_auth.reset(token)


def context_from_bearer(
    authorization: str | None,
    expected_subject: str,
    *,
    refresh_token: str | None = None,
) -> PlatformAuthContext:
    if not authorization or not authorization.startswith("Bearer "):
        raise ValueError("invalid_token")
    access_token = authorization.removeprefix("Bearer ").strip()
    claims = _decode_verified_claims(access_token)
    subject = claims.get("sub")
    issuer = claims.get("iss")
    expires_at = claims.get("exp")
    audience = claims.get("aud")
    expected_audience = os.environ.get("OPENDRSAI_OIDC_AUDIENCE", "hai-api").strip()
    if not isinstance(subject, str) or not subject:
        raise ValueError("invalid_token")
    if not _is_platform_user_id(subject):
        raise ValueError("invalid_subject")
    if expected_subject and subject != expected_subject:
        raise ValueError("subject_mismatch")
    if not isinstance(issuer, str) or not issuer.startswith("https://"):
        raise ValueError("invalid_token")
    if not isinstance(expires_at, int):
        raise ValueError("invalid_token")
    if expires_at <= int(time.time()):
        raise ValueError("token_expired")
    audiences = [audience] if isinstance(audience, str) else audience if isinstance(audience, list) else []
    if expected_audience and expected_audience not in audiences:
        raise ValueError("audience_mismatch")
    not_before = claims.get("nbf")
    if isinstance(not_before, int) and not_before > int(time.time()) + 30:
        raise ValueError("token_not_yet_valid")
    if claims.get("typ") != "access_token":
        raise ValueError("invalid_token_type")
    scopes = claims.get("scope")
    if not isinstance(scopes, str) or "hai_api" not in scopes.split():
        raise ValueError("missing_hai_api_scope")
    organization_id = claims.get("organization_id") or claims.get("org_id") or claims.get("org")
    session_id = claims.get("sid") or claims.get("session_id")
    email = claims.get("email")
    return PlatformAuthContext(
        access_token=access_token,
        subject=subject,
        issuer=issuer,
        expires_at=expires_at,
        model_base_url=_model_base_url(issuer),
        organization_id=str(organization_id) if organization_id else None,
        session_id=str(session_id) if session_id else None,
        audience=expected_audience or None,
        refresh_token=refresh_token or None,
        user_email=str(email).strip() if isinstance(email, str) and email.strip() else None,
    )


def _is_platform_user_id(value: str) -> bool:
    try:
        uuid.UUID(value)
        return True
    except (ValueError, AttributeError, TypeError):
        return False


def resolve_gateway_instance_token(*, required: bool = False) -> str | None:
    """Resolve the local instance token from env or Desktop's bounded file.

    The persisted file is the Desktop/Runtime handoff across source-watcher
    and process restarts.  A present but malformed file is never treated as
    "authentication disabled".
    """
    configured = os.environ.get("OPENDRSAI_GATEWAY_INSTANCE_TOKEN", "").strip()
    if configured:
        return configured
    root = os.environ.get("DRSAI_HOME", os.path.expanduser("~/.drsai"))
    token_path = os.path.join(root, "runtime", "instance-token")
    if not os.path.lexists(token_path):
        if required:
            raise RuntimeError("gateway_instance_token_required")
        return None
    try:
        if os.path.islink(token_path) or not os.path.isfile(token_path):
            raise RuntimeError("gateway_instance_token_file_invalid")
        if os.path.getsize(token_path) > 256:
            raise RuntimeError("gateway_instance_token_file_invalid")
        with open(token_path, encoding="ascii") as handle:
            token = handle.read().strip()
    except RuntimeError:
        raise
    except (OSError, UnicodeError) as exc:
        raise RuntimeError("gateway_instance_token_file_invalid") from exc
    if not re.fullmatch(r"[A-Za-z0-9_-]{32,128}", token):
        raise RuntimeError("gateway_instance_token_file_invalid")
    return token


def verify_gateway_instance(provided: str | None) -> bool:
    try:
        expected = resolve_gateway_instance_token()
    except RuntimeError:
        return False
    if not expected:
        return True
    if os.environ.get("OPENDRSAI_GATEWAY_INSTANCE_TOKEN_REVOKED") == "1":
        return False
    raw_expiry = os.environ.get("OPENDRSAI_GATEWAY_INSTANCE_TOKEN_EXPIRES_AT", "").strip()
    if raw_expiry:
        try:
            if float(raw_expiry) <= time.time():
                return False
        except ValueError:
            return False
    revoked_path = os.path.join(os.environ.get("DRSAI_HOME", os.path.expanduser("~/.drsai")), "runtime", "revoked-instance-tokens.json")
    try:
        with open(revoked_path, encoding="utf-8") as handle:
            revoked = json.load(handle)
        if hashlib.sha256(expected.encode()).hexdigest() in revoked:
            return False
    except (OSError, ValueError, TypeError):
        pass
    if not provided or len(provided) != len(expected):
        return False
    return hmac.compare_digest(provided, expected)


def revoke_gateway_instance_token(token: str) -> None:
    """Persist only a token digest so a disconnected instance cannot return."""
    root = os.path.join(os.environ.get("DRSAI_HOME", os.path.expanduser("~/.drsai")), "runtime")
    os.makedirs(root, exist_ok=True)
    path = os.path.join(root, "revoked-instance-tokens.json")
    try:
        with open(path, encoding="utf-8") as handle:
            values = json.load(handle)
        if not isinstance(values, list):
            values = []
    except (OSError, ValueError):
        values = []
    digest = hashlib.sha256(token.encode()).hexdigest()
    if digest not in values:
        values.append(digest)
    temporary = f"{path}.tmp"
    with open(temporary, "w", encoding="utf-8") as handle:
        json.dump(values[-1000:], handle)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)


def classify_model_error(error: Exception) -> dict[str, object]:
    status_code = getattr(error, "status_code", None)
    message = str(error).lower()
    if "context_active_chain_budget_overflow" in message or "context_budget_invariant_failed" in message:
        return {
            "code": "context_budget_exhausted",
            "message": "The local agent context budget was exhausted.",
            "retryable": False,
        }
    if "model_tool_not_in_snapshot" in message:
        return {
            "code": "model_tool_contract_violation",
            "message": "The model requested a tool that was not available for this turn.",
            "retryable": False,
        }
    if (
        "credential context is unavailable" in message
        or "provider api credential is unavailable" in message
    ):
        return {
            "code": "model_credential_unavailable",
            "message": "The selected model provider credential is unavailable.",
            "retryable": False,
        }
    if "token_expired" in message or "token expired" in message or "expired token" in message:
        return {"code": "token_expired", "message": "Your HepAI session expired.", "retryable": True}
    if (
        status_code == 401
        or "authenticationerror" in message
        or "unauthorized" in message
        or "invalid token" in message
        or "invalid_token" in message
    ):
        return {"code": "model_unauthorized", "message": "The HepAI identity is not authorized.", "retryable": False}
    if status_code == 403 or "forbidden" in message or "permission" in message:
        return {"code": "model_forbidden", "message": "Your account cannot use this model.", "retryable": False}
    if status_code == 429 or "quota" in message or "rate limit" in message:
        return {"code": "quota_exceeded", "message": "The model quota or concurrency limit was reached.", "retryable": True}
    if status_code == 404 or "model_not_found" in message or "model_unavailable" in message:
        return {"code": "model_not_found", "message": "The selected model is unavailable.", "retryable": False}
    return {"code": "upstream_unavailable", "message": "The model service is temporarily unavailable.", "retryable": True}


def _model_base_url(issuer: str) -> str:
    override = os.environ.get("OPENDRSAI_MODEL_BASE_URL", "").strip().rstrip("/")
    if override:
        if not override.startswith("https://") and os.environ.get("DRSAI_ALLOW_INSECURE_MODEL_URL") != "1":
            raise ValueError("invalid_model_base_url")
    result = resolve_hepai_model_base_url(os.environ, issuer=issuer)
    return result


def _decode_verified_claims(token: str) -> dict[str, object]:
    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError("invalid_token")
    try:
        header_raw = parts[0] + "=" * (-len(parts[0]) % 4)
        header = json.loads(base64.urlsafe_b64decode(header_raw).decode("utf-8"))
        payload = parts[1] + "=" * (-len(parts[1]) % 4)
        claims = json.loads(base64.urlsafe_b64decode(payload).decode("utf-8"))
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("invalid_token") from exc
    if not isinstance(header, dict) or not isinstance(claims, dict):
        raise ValueError("invalid_token")
    algorithm = header.get("alg")
    signature = _decode_segment(parts[2])
    signing_input = f"{parts[0]}.{parts[1]}".encode()
    if algorithm == "HS256":
        secret = os.environ.get("OPENDRSAI_OIDC_HS256_SECRET", "").encode()
        if not secret or not hmac.compare_digest(signature, hmac.new(secret, signing_input, hashlib.sha256).digest()):
            raise ValueError("invalid_token_signature")
    elif algorithm == "RS256":
        _verify_rs256(header, claims, signing_input, signature)
    else:
        raise ValueError("invalid_token_algorithm")
    return claims


def _decode_segment(value: str) -> bytes:
    try:
        return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
    except (ValueError, TypeError) as exc:
        raise ValueError("invalid_token") from exc


_JWKS_CACHE: dict[str, tuple[float, dict[str, object]]] = {}


def _verify_rs256(header: dict[str, object], claims: dict[str, object], signing_input: bytes, signature: bytes) -> None:
    issuer = claims.get("iss")
    kid = header.get("kid")
    if not isinstance(issuer, str) or not isinstance(kid, str) or not kid:
        raise ValueError("invalid_token")
    configured = os.environ.get("OPENDRSAI_OIDC_JWKS_URL", "").strip()
    cache_key = configured or issuer
    cached = _JWKS_CACHE.get(cache_key)
    if cached and cached[0] > time.time():
        document = cached[1]
    else:
        try:
            if configured:
                jwks_url = configured
            else:
                discovery_url = f"{issuer.rstrip('/')}/.well-known/openid-configuration"
                with urllib.request.urlopen(discovery_url, timeout=5) as response:
                    discovery = json.loads(response.read(1_000_000))
                jwks_url = discovery["jwks_uri"]
            with urllib.request.urlopen(str(jwks_url), timeout=5) as response:
                document = json.loads(response.read(2_000_000))
            if not isinstance(document, dict):
                raise ValueError("invalid JWKS")
            _JWKS_CACHE[cache_key] = (time.time() + 300, document)
        except Exception as exc:
            raise ValueError("oidc_verification_unavailable") from exc
    key = next((item for item in document.get("keys", []) if isinstance(item, dict) and item.get("kid") == kid and item.get("kty") == "RSA"), None)
    if not key:
        raise ValueError("invalid_token_signature")
    try:
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.asymmetric import padding, rsa

        modulus = int.from_bytes(_decode_segment(str(key["n"])), "big")
        exponent = int.from_bytes(_decode_segment(str(key["e"])), "big")
        rsa.RSAPublicNumbers(exponent, modulus).public_key().verify(signature, signing_input, padding.PKCS1v15(), hashes.SHA256())
    except Exception as exc:
        raise ValueError("invalid_token_signature") from exc


# ---------------------------------------------------------------------------
# Token expiry checking and proactive refresh (Option C: backend holds
# refresh_token and can renew the access_token without round-tripping to
# the frontend).
# ---------------------------------------------------------------------------

_logger = logging.getLogger("drsai.platform_auth")

#: How many seconds before *exp* the refresh logic should kick in.
TOKEN_REFRESH_WINDOW_SECONDS = int(
    os.environ.get("DRSAI_TOKEN_REFRESH_WINDOW", "120")
)

#: OIDC client_id used when exchanging a refresh_token for a new access_token.
_OIDC_CLIENT_ID = os.environ.get("OPENDRSAI_OIDC_CLIENT_ID", "opendrsai-desktop")

#: Cache: issuer → (expires_at_float, token_endpoint_url)
_OIDC_TOKEN_ENDPOINT_CACHE: dict[str, tuple[float, str]] = {}

#: Lazily-initialised asyncio lock so only one refresh request runs at a time.
_refresh_lock: asyncio.Lock | None = None


def _decode_jwt_exp(token: str) -> int | None:
    """Read the ``exp`` claim from a JWT **without** signature verification.

    The token was already fully verified (signature + claims) by
    :func:`context_from_bearer` at request entry, so we only need the raw
    payload here for a cheap expiry pre-check.
    """
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None
        payload = parts[1] + "=" * (-len(parts[1]) % 4)
        claims = json.loads(base64.urlsafe_b64decode(payload).decode("utf-8"))
        exp = claims.get("exp")
        return int(exp) if isinstance(exp, (int, float)) else None
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError):
        return None


def is_token_expiring_soon(
    access_token: str,
    window: int = TOKEN_REFRESH_WINDOW_SECONDS,
) -> bool:
    """Return *True* if *access_token* will expire within *window* seconds."""
    exp = _decode_jwt_exp(access_token)
    if exp is None:
        return False  # not a JWT or undecodable — skip proactive refresh
    return exp <= int(time.time()) + window


def is_token_expired(access_token: str) -> bool:
    """Return *True* if *access_token* has already passed its ``exp``."""
    exp = _decode_jwt_exp(access_token)
    if exp is None:
        return False
    return exp <= int(time.time())


def _get_oidc_token_endpoint(issuer: str) -> str:
    """Discover and cache the OIDC ``token_endpoint`` for *issuer*."""
    cache_key = issuer.rstrip("/")
    cached = _OIDC_TOKEN_ENDPOINT_CACHE.get(cache_key)
    if cached and cached[0] > time.time():
        return cached[1]
    discovery_url = f"{cache_key}/.well-known/openid-configuration"
    req = urllib.request.Request(discovery_url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        metadata = json.loads(resp.read().decode("utf-8"))
    token_endpoint = metadata.get("token_endpoint")
    if not token_endpoint:
        raise ValueError("oidc_token_endpoint_not_found")
    _OIDC_TOKEN_ENDPOINT_CACHE[cache_key] = (time.time() + 300, token_endpoint)
    return token_endpoint


def _exchange_refresh_token(
    refresh_token: str,
    issuer: str,
) -> tuple[str, int]:
    """Call the OIDC token endpoint to exchange *refresh_token* for a new
    access_token.

    Returns ``(new_access_token, new_expires_at_unix)``.
    Raises *ValueError* on any failure.
    """
    token_endpoint = _get_oidc_token_endpoint(issuer)
    data = urllib.parse.urlencode({
        "grant_type": "refresh_token",
        "client_id": _OIDC_CLIENT_ID,
        "refresh_token": refresh_token,
    }).encode("utf-8")
    req = urllib.request.Request(
        token_endpoint,
        data=data,
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        token_data = json.loads(resp.read().decode("utf-8"))
    new_access_token = token_data.get("access_token")
    if not new_access_token:
        raise ValueError("oidc_refresh_failed: no access_token in response")
    new_exp = _decode_jwt_exp(new_access_token)
    if new_exp is None:
        expires_in = token_data.get("expires_in", 3600)
        new_exp = int(time.time()) + int(expires_in)
    return new_access_token, new_exp


async def try_refresh_platform_auth() -> PlatformAuthContext | None:
    """Check the current platform-auth token and proactively refresh it.

    * **No refresh_token available** — if the token is already expired, raise
      ``ValueError("token_expired")`` so the caller can surface the error;
      otherwise return *None* (token still valid, nothing to do).
    * **Token still valid** — return *None* immediately.
    * **Token expiring soon** — call the OIDC endpoint, update the
      :pydata:`_platform_auth` ContextVar, and return the new context.

    Concurrency-safe: an :class:`asyncio.Lock` ensures only one refresh HTTP
    request is in-flight at a time.  Other callers that entered the lock while
    waiting will re-read the ContextVar and find the already-refreshed token.
    """
    global _refresh_lock
    if _refresh_lock is None:
        _refresh_lock = asyncio.Lock()

    current = get_platform_auth()
    if current is None:
        return None

    # No refresh_token → can't renew; check if already expired.
    if not current.refresh_token:
        if is_token_expired(current.access_token):
            raise ValueError("token_expired: no refresh_token available for renewal")
        return None

    # Still valid?
    if not is_token_expiring_soon(current.access_token):
        return None

    async with _refresh_lock:
        # Double-check after acquiring the lock — another coroutine may have
        # already refreshed while we were waiting.
        current = get_platform_auth()
        if current is None:
            return None
        if not current.refresh_token:
            if is_token_expired(current.access_token):
                raise ValueError("token_expired: refresh_token was removed")
            return None
        if not is_token_expiring_soon(current.access_token):
            return None

        _logger.info(
            "platform_auth: access_token expiring soon (exp=%d), refreshing via OIDC endpoint…",
            _decode_jwt_exp(current.access_token) or 0,
        )
        # _exchange_refresh_token() uses blocking urllib calls — offload to
        # thread pool so the async event loop is not blocked during the OIDC
        # token endpoint HTTP round-trip (up to 25s worst case).
        new_access_token, new_expires_at = await asyncio.to_thread(
            _exchange_refresh_token,
            current.refresh_token,
            current.issuer,
        )
        new_context = PlatformAuthContext(
            access_token=new_access_token,
            subject=current.subject,
            issuer=current.issuer,
            expires_at=new_expires_at,
            model_base_url=current.model_base_url,
            organization_id=current.organization_id,
            session_id=current.session_id,
            audience=current.audience,
            refresh_token=current.refresh_token,
            user_email=current.user_email,
        )
        _platform_auth.set(new_context)
        _logger.info("platform_auth: token refreshed successfully, new exp=%d", new_expires_at)
        return new_context
