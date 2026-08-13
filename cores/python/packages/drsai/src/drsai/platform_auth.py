from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
import urllib.request
import uuid
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field as dataclass_field
from typing import FrozenSet, Iterator, Protocol
from pydantic import SecretStr


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
    model_base_url: str = "https://ai-dev.ihep.ac.cn/apiv2/v1"

    def __post_init__(self) -> None:
        if isinstance(self.access_token, str):
            object.__setattr__(self, "access_token", SecretStr(self.access_token))
        if self.token_type != "Bearer" or self.audience != "hai-model-gateway":
            raise ValueError("invalid_delegated_credential")
        if self.expires_at <= int(time.time()):
            raise ValueError("delegation_expired")
        if not self.model_base_url.startswith("https://ai-dev.ihep.ac.cn/"):
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


def get_model_credential_provider(
    fallback_token: str | None = None,
    fallback_base_url: str | None = None,
) -> ModelCredentialProvider | None:
    delegated = get_delegated_credential()
    if delegated:
        return DelegatedModelCredentialProvider(delegated)
    context = get_platform_auth()
    if context:
        return OidcModelCredentialProvider(context)
    if static_model_credentials_allowed() and fallback_token and fallback_base_url:
        return StaticModelCredentialProvider(fallback_token, fallback_base_url)
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


def context_from_bearer(authorization: str | None, expected_subject: str) -> PlatformAuthContext:
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
    return PlatformAuthContext(
        access_token=access_token,
        subject=subject,
        issuer=issuer,
        expires_at=expires_at,
        model_base_url=_model_base_url(issuer),
        organization_id=str(organization_id) if organization_id else None,
        session_id=str(session_id) if session_id else None,
        audience=expected_audience or None,
    )


def _is_platform_user_id(value: str) -> bool:
    try:
        uuid.UUID(value)
        return True
    except (ValueError, AttributeError, TypeError):
        return False


def verify_gateway_instance(provided: str | None) -> bool:
    expected = os.environ.get("OPENDRSAI_GATEWAY_INSTANCE_TOKEN", "").strip()
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
        return override
    if issuer == "https://ai-dev.ihep.ac.cn/api":
        return "https://ai-dev.ihep.ac.cn/apiv2/v1"
    if issuer == "https://ai.ihep.ac.cn/api":
        return "https://ai.ihep.ac.cn/apiv2/v1"
    raise ValueError("unsupported_issuer")


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
