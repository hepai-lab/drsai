from __future__ import annotations

import base64
import json
import os
import time
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Iterator, Protocol


@dataclass(frozen=True)
class PlatformAuthContext:
    access_token: str
    subject: str
    issuer: str
    expires_at: int
    model_base_url: str

    @property
    def anthropic_base_url(self) -> str:
        return f"{self.model_base_url.removesuffix('/v1')}/anthropic"


class ModelCredentialProvider(Protocol):
    @property
    def access_token(self) -> str: ...

    @property
    def openai_base_url(self) -> str: ...

    @property
    def anthropic_base_url(self) -> str: ...


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


@dataclass(frozen=True)
class StaticModelCredentialProvider:
    access_token: str
    openai_base_url: str

    @property
    def anthropic_base_url(self) -> str:
        return self.openai_base_url


def get_model_credential_provider(
    fallback_token: str | None = None,
    fallback_base_url: str | None = None,
) -> ModelCredentialProvider | None:
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


def get_platform_auth() -> PlatformAuthContext | None:
    return _platform_auth.get()


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
    claims = _decode_claims(access_token)
    subject = claims.get("sub")
    issuer = claims.get("iss")
    expires_at = claims.get("exp")
    if not isinstance(subject, str) or not subject:
        raise ValueError("invalid_token")
    if expected_subject and subject != expected_subject:
        raise ValueError("subject_mismatch")
    if not isinstance(issuer, str) or not issuer.startswith("https://"):
        raise ValueError("invalid_token")
    if not isinstance(expires_at, int):
        raise ValueError("invalid_token")
    if expires_at <= int(time.time()):
        raise ValueError("token_expired")
    return PlatformAuthContext(
        access_token=access_token,
        subject=subject,
        issuer=issuer,
        expires_at=expires_at,
        model_base_url=_model_base_url(issuer),
    )


def verify_gateway_instance(provided: str | None) -> bool:
    expected = os.environ.get("OPENDRSAI_GATEWAY_INSTANCE_TOKEN", "").strip()
    if not expected:
        return True
    if not provided or len(provided) != len(expected):
        return False
    import hmac

    return hmac.compare_digest(provided, expected)


def classify_model_error(error: Exception) -> dict[str, object]:
    status_code = getattr(error, "status_code", None)
    message = str(error).lower()
    if status_code == 401 or "token_expired" in message or "token expired" in message:
        return {"code": "token_expired", "message": "Your HepAI session expired.", "retryable": True}
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


def _decode_claims(token: str) -> dict[str, object]:
    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError("invalid_token")
    try:
        payload = parts[1] + "=" * (-len(parts[1]) % 4)
        claims = json.loads(base64.urlsafe_b64decode(payload).decode("utf-8"))
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("invalid_token") from exc
    if not isinstance(claims, dict):
        raise ValueError("invalid_token")
    return claims
