"""OIDC Device Code Flow client for TUI.

Reference: desktop ``apps/desktop/shared/main/auth.ts`` startOidcDeviceLogin().

Flow:
    1. ``discovery()``           — GET /.well-known/openid-configuration
    2. ``request_device_code()`` — POST /device_authorization
    3. ``poll_device_token()``   — POST /token (grant_type=device_code)
    4. ``validate_id_token()``   — verify JWT signature + claims
    5. ``refresh_access_token()``— POST /token (grant_type=refresh_token)
    6. ``revoke_token()``        — POST /revoke

All HTTP calls use ``urllib`` (no extra dependency) with a timeout.
"""

from __future__ import annotations

import base64
import json
import logging
import time
import urllib.parse
import urllib.request
from typing import Any

logger = logging.getLogger(__name__)

OIDC_FETCH_TIMEOUT_S = 10
OIDC_DEVICE_FLOW_TIMEOUT_S = 300  # 5 min default device code lifetime
JWKS_CACHE_TTL_S = 300  # 5 min JWKS cache

# Reuse the verifier from platform_auth.py for JWT validation
from drsai.platform_auth import context_from_bearer, PlatformAuthContext


class OidcClient:
    """OIDC Device Code Flow client (sync, blocking)."""

    def __init__(self, issuer: str, client_id: str, scopes: str):
        self.issuer = issuer.rstrip("/")
        self.client_id = client_id
        self.scopes = scopes
        self._metadata: dict | None = None
        self._jwks_cache: dict[str, tuple[float, dict]] = {}

    # ── HTTP helper ────────────────────────────────────────────────

    @staticmethod
    def _post(url: str, data: dict, timeout: int = OIDC_FETCH_TIMEOUT_S) -> dict:
        """POST form-encoded data and return JSON response."""
        body = urllib.parse.urlencode(data).encode("utf-8")
        req = urllib.request.Request(url, data=body, method="POST")
        req.add_header("Content-Type", "application/x-www-form-urlencoded")
        req.add_header("Accept", "application/json")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read(2_000_000)
            return json.loads(raw)

    @staticmethod
    def _get(url: str, timeout: int = OIDC_FETCH_TIMEOUT_S) -> dict:
        """GET JSON."""
        req = urllib.request.Request(url, method="GET")
        req.add_header("Accept", "application/json")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read(1_000_000)
            return json.loads(raw)

    # ── OIDC flow ──────────────────────────────────────────────────

    def discovery(self) -> dict:
        """Fetch /.well-known/openid-configuration (cached)."""
        if self._metadata is not None:
            return self._metadata
        url = f"{self.issuer}/.well-known/openid-configuration"
        self._metadata = self._get(url)
        return self._metadata

    def request_device_code(self) -> dict:
        """POST device_authorization_endpoint.

        Returns:
            ``{device_code, user_code, verification_uri,
               verification_uri_complete, expires_in, interval}``
        """
        meta = self.discovery()
        endpoint = meta.get("device_authorization_endpoint")
        if not endpoint:
            raise RuntimeError(
                "OIDC provider does not support device flow: "
                "device_authorization_endpoint not found"
            )
        data = {
            "client_id": self.client_id,
            "scope": self.scopes,
        }
        result = self._post(endpoint, data)
        if "device_code" not in result:
            raise RuntimeError(f"Device auth response missing device_code: {result}")
        return result

    def poll_device_token(self, device_code: str) -> dict:
        """POST token_endpoint with grant_type=device_code.

        Returns:
            On success: ``{"status": "success", "access_token": ..., ...}``
            On pending: ``{"status": "pending", "error": "authorization_pending" | "slow_down"}``
            On expired: ``{"status": "expired", "error": "expired_token"}``
        """
        meta = self.discovery()
        endpoint = meta["token_endpoint"]
        data = {
            "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
            "device_code": device_code,
            "client_id": self.client_id,
        }
        try:
            result = self._post(endpoint, data)
        except urllib.error.HTTPError as exc:
            try:
                err_body = json.loads(exc.read(10_000))
            except Exception:
                err_body = {"error": str(exc)}
            err_code = err_body.get("error", "")
            if err_code in ("authorization_pending", "slow_down"):
                return {"status": "pending", "error": err_code}
            if err_code in ("expired_token", "access_denied"):
                return {"status": "expired", "error": err_code}
            return {"status": "error", "error": err_code}

        if "access_token" in result:
            return {"status": "success", **result}
        # Unexpected response
        return {"status": "error", "error": result.get("error", "unknown_error")}

    def validate_id_token(self, id_token: str, expected_subject: str = "") -> dict:
        """Validate the JWT ID Token and extract user claims.

        Delegates to :func:`drsai.platform_auth.context_from_bearer` for
        signature verification (RS256 / HS256), issuer / audience / scope
        checks, then extracts user info from the claims.

        Returns:
            ``{user_id, email, name, roles, groups}``
        """
        # context_from_bearer does full JWT verification (sig, exp, iss, aud, scope)
        # We pass the token as a Bearer header value.
        context: PlatformAuthContext = context_from_bearer(
            f"Bearer {id_token}",
            expected_subject=expected_subject,
        )

        # Also decode the payload to extract email / name / roles
        claims = self._decode_jwt_payload(id_token)

        return {
            "user_id": context.subject,
            "email": claims.get("email", ""),
            "name": claims.get("name", ""),
            "roles": claims.get("roles", []),
            "groups": claims.get("groups", []),
            "organization_id": context.organization_id,
            "session_id": context.session_id,
        }

    @staticmethod
    def _decode_jwt_payload(token: str) -> dict:
        """Decode (without verifying) the JWT payload for claim extraction."""
        parts = token.split(".")
        if len(parts) < 2:
            return {}
        payload_b64 = parts[1]
        payload_b64 += "=" * (-len(payload_b64) % 4)
        try:
            return json.loads(base64.urlsafe_b64decode(payload_b64))
        except Exception:
            return {}

    def refresh_access_token(self, refresh_token: str) -> dict:
        """POST token_endpoint with grant_type=refresh_token.

        Returns:
            ``{access_token, refresh_token, id_token, expires_in}``
        """
        meta = self.discovery()
        endpoint = meta["token_endpoint"]
        data = {
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": self.client_id,
        }
        result = self._post(endpoint, data)
        if "access_token" not in result:
            raise RuntimeError(f"Token refresh failed: {result}")
        return result

    def revoke_token(self, refresh_token: str) -> None:
        """POST revocation_endpoint (best-effort)."""
        meta = self.discovery()
        endpoint = meta.get("revocation_endpoint")
        if not endpoint:
            return
        data = {
            "token": refresh_token,
            "client_id": self.client_id,
        }
        try:
            self._post(endpoint, data)
        except Exception as exc:
            logger.warning("Token revocation failed: %s", exc)
