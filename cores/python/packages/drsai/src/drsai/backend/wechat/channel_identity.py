"""Privacy-preserving identities for Runtime-owned channel bindings."""

from __future__ import annotations

import hashlib
import hmac


class ChannelIdentity:
    """Derive installation-scoped opaque keys without retaining provider IDs."""

    def __init__(self, installation_secret: bytes):
        if len(installation_secret) < 32:
            raise ValueError("installation_secret must contain at least 32 bytes")
        self._secret = bytes(installation_secret)

    def account_fingerprint(self, account_id: str) -> str:
        return self._derive("account", account_id)

    def provider_user_key(self, provider_user_id: str) -> str:
        return self._derive("user", provider_user_id)

    def _derive(self, namespace: str, value: str) -> str:
        normalized = str(value).strip()
        if not normalized:
            raise ValueError(f"{namespace} identifier is required")
        digest = hmac.new(
            self._secret,
            f"wechat-channel-v1\0{namespace}\0{normalized}".encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        return f"wechat-{namespace}:{digest}"

