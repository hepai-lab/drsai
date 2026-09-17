"""Shared, UI-agnostic WeChat ilink authorization service."""

from __future__ import annotations

import asyncio
import json
import os
import secrets
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable
from urllib.parse import quote

import httpx

from .wechat_login import BASE_URL
from drsai.config import delete_credential, resolve_credential, store_credential

MAX_RESPONSE_BYTES = 64 * 1024
LOGIN_TTL_SECONDS = 120
POLL_INTERVAL_SECONDS = 3
VALID_CREDENTIAL_AGE_SECONDS = 7 * 24 * 3600


class WeChatAuthError(RuntimeError):
    """A stable, non-secret authorization failure."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass
class _LoginOperation:
    operation_id: str
    qrcode_id: str
    expires_at: float
    next_poll_at: float
    consecutive_failures: int = 0


Transport = Callable[[str], Awaitable[dict[str, Any]]]


class WeChatAuthService:
    """Own QR operations and credentials without exposing secrets to a UI."""

    def __init__(
        self,
        credentials_path: str | Path,
        *,
        transport: Transport | None = None,
        now: Callable[[], float] = time.time,
        credential_root: Path | None = None,
    ) -> None:
        self.credentials_path = Path(credentials_path)
        self._transport = transport or self._request_json
        self._now = now
        self._credential_root = credential_root
        self._operations: dict[str, _LoginOperation] = {}
        self._lock = asyncio.Lock()

    async def status(self) -> dict[str, Any]:
        metadata = self._read_metadata()
        if not metadata:
            return {
                "configured": False,
                "credential_state": "missing",
                "account_label": None,
                "login_time": None,
                "expires_at": None,
            }
        login_time = metadata.get("login_time")
        valid_time = isinstance(login_time, (int, float)) and 0 < login_time <= self._now()
        expires_at = float(login_time) + VALID_CREDENTIAL_AGE_SECONDS if valid_time else None
        reference = metadata.get("credential_ref")
        available = isinstance(reference, str) and resolve_credential(reference, root=self._credential_root) is not None
        state = "unavailable" if not available else "valid" if expires_at is not None and expires_at > self._now() else "expired"
        return {
            "configured": True,
            "credential_state": state,
            "account_label": metadata.get("account_label"),
            "login_time": _iso(login_time) if valid_time else None,
            "expires_at": _iso(expires_at) if expires_at else None,
        }

    async def start_login(self) -> dict[str, Any]:
        data = await self._transport(f"{BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=3")
        if data.get("ret") != 0:
            raise WeChatAuthError("provider_rejected", "WeChat did not issue a login QR code.")
        qr_content = _required_string(data.get("qrcode_img_content"), "invalid_provider_response", 8192)
        qrcode_id = _required_string(data.get("qrcode"), "invalid_provider_response", 2048)
        now = self._now()
        operation = _LoginOperation(
            operation_id=f"wechat-login:{secrets.token_urlsafe(24)}",
            qrcode_id=qrcode_id,
            expires_at=now + LOGIN_TTL_SECONDS,
            next_poll_at=now,
        )
        async with self._lock:
            self._operations.clear()
            self._operations[operation.operation_id] = operation
        return {
            "operation_id": operation.operation_id,
            "qr_content": qr_content,
            "status": "waiting",
            "expires_at": _iso(operation.expires_at),
            "poll_interval_seconds": POLL_INTERVAL_SECONDS,
        }

    async def poll_login(self, operation_id: str) -> dict[str, Any]:
        async with self._lock:
            operation = self._operations.get(operation_id)
            if operation is None:
                raise WeChatAuthError("operation_not_found", "WeChat login operation was not found.")
            now = self._now()
            if now >= operation.expires_at:
                self._operations.pop(operation_id, None)
                return {"status": "expired", "operation_id": operation_id}
            if now < operation.next_poll_at:
                return {
                    "status": "waiting",
                    "operation_id": operation_id,
                    "retry_after_seconds": max(1, int(operation.next_poll_at - now + 0.999)),
                }
            operation.next_poll_at = now + POLL_INTERVAL_SECONDS

        try:
            data = await self._transport(
                f"{BASE_URL}/ilink/bot/get_qrcode_status?qrcode={quote(operation.qrcode_id, safe='')}"
            )
        except WeChatAuthError as exc:
            # QR polling is a time-bounded long-running operation. A single
            # provider timeout/5xx must not discard it or force the user to
            # request and scan another QR code.
            if exc.code != "provider_unavailable":
                raise
            async with self._lock:
                active = self._operations.get(operation_id)
                if active is not operation:
                    raise WeChatAuthError("operation_not_found", "WeChat login operation was not found.")
                operation.consecutive_failures += 1
                retry_after = min(15, POLL_INTERVAL_SECONDS * operation.consecutive_failures)
                operation.next_poll_at = self._now() + retry_after
            return {
                "status": "waiting",
                "operation_id": operation_id,
                "expires_at": _iso(operation.expires_at),
                "poll_interval_seconds": retry_after,
                "retry_after_seconds": retry_after,
                "transient_error_code": "provider_unavailable",
            }
        async with self._lock:
            if self._operations.get(operation_id) is not operation:
                raise WeChatAuthError("operation_not_found", "WeChat login operation was not found.")
            operation.consecutive_failures = 0
        provider_status = str(data.get("status") or "").lower()
        status = {"wait": "waiting", "scaned": "scanned", "scanned": "scanned"}.get(provider_status)
        if status:
            return {
                "status": status,
                "operation_id": operation_id,
                "expires_at": _iso(operation.expires_at),
                "poll_interval_seconds": POLL_INTERVAL_SECONDS,
            }
        if provider_status == "expired":
            async with self._lock:
                self._operations.pop(operation_id, None)
            return {"status": "expired", "operation_id": operation_id}
        if provider_status != "confirmed":
            raise WeChatAuthError("invalid_provider_response", "WeChat returned an unknown login status.")

        credentials = {
            "bot_token": _required_string(data.get("bot_token"), "invalid_provider_response", 8192),
            "account_id": _required_string(data.get("ilink_bot_id"), "invalid_provider_response", 2048),
            "user_id": _required_string(data.get("ilink_user_id"), "invalid_provider_response", 2048),
            "base_url": BASE_URL,
            "login_time": self._now(),
        }
        reference = store_credential(json.dumps(credentials, ensure_ascii=False), root=self._credential_root)
        try:
            self._write_metadata({
                "schema_version": 2,
                "credential_ref": reference,
                "account_label": _mask_identifier(credentials["account_id"]),
                "login_time": credentials["login_time"],
            })
        except Exception:
            delete_credential(reference, root=self._credential_root)
            raise
        async with self._lock:
            self._operations.pop(operation_id, None)
        return {
            "status": "confirmed",
            "operation_id": operation_id,
            "account_label": _mask_identifier(credentials["account_id"]),
        }

    async def cancel_login(self, operation_id: str) -> dict[str, Any]:
        async with self._lock:
            removed = self._operations.pop(operation_id, None)
        return {"status": "cancelled", "operation_id": operation_id, "cancelled": removed is not None}

    async def logout(self) -> dict[str, Any]:
        async with self._lock:
            self._operations.clear()
        metadata = self._read_metadata()
        reference = metadata.get("credential_ref") if metadata else None
        if isinstance(reference, str):
            try:
                delete_credential(reference, root=self._credential_root)
            except Exception:
                pass
        try:
            self.credentials_path.unlink()
        except FileNotFoundError:
            pass
        return {"status": "logged_out"}

    def load_runtime_credentials(self) -> dict[str, Any]:
        metadata = self._read_metadata()
        if not metadata:
            raise WeChatAuthError("credentials_missing", "WeChat login is required.")
        reference = metadata.get("credential_ref")
        if not isinstance(reference, str):
            raise WeChatAuthError("credentials_unavailable", "WeChat credential storage is unavailable.")
        secret = resolve_credential(reference, root=self._credential_root)
        try:
            credentials = json.loads(secret) if secret else None
        except json.JSONDecodeError:
            credentials = None
        if not isinstance(credentials, dict):
            raise WeChatAuthError("credentials_unavailable", "WeChat credential storage is unavailable.")
        return credentials

    def _read_metadata(self) -> dict[str, Any] | None:
        try:
            value = json.loads(self.credentials_path.read_text(encoding="utf-8"))
        except (FileNotFoundError, OSError, json.JSONDecodeError):
            return None
        if not isinstance(value, dict):
            return None
        if isinstance(value.get("credential_ref"), str):
            return value
        # One-time migration from the legacy plaintext file. The replacement
        # contains only a protected credential reference and display metadata.
        if isinstance(value.get("bot_token"), str):
            reference = store_credential(json.dumps(value, ensure_ascii=False), root=self._credential_root)
            metadata = {
                "schema_version": 2,
                "credential_ref": reference,
                "account_label": _mask_identifier(value.get("account_id")),
                "login_time": value.get("login_time"),
            }
            try:
                self._write_metadata(metadata)
            except Exception:
                delete_credential(reference, root=self._credential_root)
                raise
            return metadata
        return value

    def _write_metadata(self, value: dict[str, Any]) -> None:
        self.credentials_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.credentials_path.with_name(f".{self.credentials_path.name}.{secrets.token_hex(8)}.tmp")
        try:
            temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
            try:
                os.chmod(temporary, 0o600)
            except OSError:
                pass
            os.replace(temporary, self.credentials_path)
        finally:
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass

    @staticmethod
    async def _request_json(url: str) -> dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=15, follow_redirects=False) as client:
                response = await client.get(url)
                response.raise_for_status()
        except httpx.HTTPError as exc:
            raise WeChatAuthError("provider_unavailable", "Unable to contact WeChat.") from exc
        if len(response.content) > MAX_RESPONSE_BYTES:
            raise WeChatAuthError("provider_response_too_large", "WeChat returned an oversized response.")
        try:
            data = response.json()
        except ValueError as exc:
            raise WeChatAuthError("invalid_provider_response", "WeChat returned invalid JSON.") from exc
        if not isinstance(data, dict):
            raise WeChatAuthError("invalid_provider_response", "WeChat returned an invalid response.")
        return data


def _required_string(value: Any, code: str, maximum: int) -> str:
    if not isinstance(value, str) or not value or len(value) > maximum:
        raise WeChatAuthError(code, "WeChat returned an incomplete response.")
    return value


def _mask_identifier(value: Any) -> str | None:
    if not isinstance(value, str) or not value:
        return None
    if len(value) <= 6:
        return "***"
    return f"{value[:3]}…{value[-3:]}"


def _iso(value: float | int) -> str:
    return datetime.fromtimestamp(float(value), tz=timezone.utc).isoformat()
