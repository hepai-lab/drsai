"""Versioned native driver for the current Harness SDK JSON-RPC surface."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, Protocol, Sequence

from .contracts import NATIVE_SERVER_NAME
from .jsonrpc import JsonRpcNotification, JsonRpcPeer, JsonRpcProtocolError


CURRENT_METHODS = frozenset({"initialize", "session/prompt", "shutdown"})
CURRENT_NOTIFICATIONS = frozenset({
    "session.event",
    "session.status",
    "subagent.started",
    "subagent.finished",
})
CURRENT_CAPABILITIES = frozenset({"run.enqueue-receipt", "session.events.live"})
EXTENSION_METHODS = frozenset({
    "initialize", "session/prompt", "session/cancel", "session/history",
    "session/resume", "runtime/attestation", "shutdown",
})
EXTENSION_CAPABILITIES = frozenset({
    "approval.respond", "run.cancel", "run.terminal", "run.turn-binding",
    "session.history", "session.resume", "tool.side-effect-ledger",
    "workspace.containment",
})


class NativeCapabilityUnavailable(RuntimeError):
    def __init__(self, capability: str):
        super().__init__(f"Native Harness capability is unavailable: {capability}")
        self.capability = capability


@dataclass(frozen=True)
class NativeRuntimeIdentity:
    server_name: str
    server_version: str
    contract_sha256: str
    methods: frozenset[str]
    notifications: frozenset[str]
    capabilities: frozenset[str]


@dataclass(frozen=True)
class NativeRunReceipt:
    session_id: str
    message_id: str


class NativeDriver(Protocol):
    async def initialize(self, *, cwd: Path, provider: str, model: str, max_tokens: int | None = None) -> NativeRuntimeIdentity: ...
    async def start_run(self, *, session_id: str, content_blocks: Sequence[Mapping[str, Any]]) -> NativeRunReceipt: ...
    async def next_fact(self, *, timeout: float | None = None) -> JsonRpcNotification: ...
    async def cancel_run(self, *, session_id: str, message_id: str) -> None: ...
    async def resume_session(self, *, session_id: str) -> Mapping[str, Any]: ...
    async def session_history(self, *, session_id: str, from_sequence: int = 0) -> Mapping[str, Any]: ...
    async def workspace_attestation(self, *, session_id: str) -> Mapping[str, Any]: ...
    async def close(self) -> None: ...


class HarnessSdkDriver:
    """Strict decoder for the audited v0.1 SDK wire.

    The current upstream wire is intentionally probe-only. Unsupported control
    methods fail explicitly instead of being emulated from agent-wide idle.
    """

    def __init__(self, peer: JsonRpcPeer, *, contract_sha256: str):
        self._peer = peer
        self._contract_sha256 = contract_sha256
        self._identity: NativeRuntimeIdentity | None = None

    async def initialize(
        self,
        *,
        cwd: Path,
        provider: str,
        model: str,
        max_tokens: int | None = None,
    ) -> NativeRuntimeIdentity:
        resolved = cwd.expanduser().resolve(strict=False)
        if not resolved.is_absolute():
            raise ValueError("cwd must resolve to an absolute path")
        if not provider or not model:
            raise ValueError("provider and model must be non-empty")
        if max_tokens is not None and max_tokens < 1:
            raise ValueError("max_tokens must be positive")
        params: dict[str, object] = {"cwd": str(resolved), "provider": provider, "model": model}
        if max_tokens is not None:
            params["maxTokens"] = max_tokens
        raw = await self._peer.request("initialize", params)
        if not isinstance(raw, dict) or set(raw) not in ({"serverInfo"}, {"serverInfo", "protocol"}):
            raise JsonRpcProtocolError("Harness initialize result is invalid")
        server = raw["serverInfo"]
        if not isinstance(server, dict) or set(server) != {"name", "version"}:
            raise JsonRpcProtocolError("Harness serverInfo is invalid")
        name, version = server["name"], server["version"]
        if name != NATIVE_SERVER_NAME or not isinstance(version, str) or not version:
            raise JsonRpcProtocolError("Harness server identity is incompatible")
        methods, notifications, capabilities = CURRENT_METHODS, CURRENT_NOTIFICATIONS, CURRENT_CAPABILITIES
        if "protocol" in raw:
            protocol = raw["protocol"]
            if not isinstance(protocol, dict) or set(protocol) != {"methods", "notifications", "capabilities"}:
                raise JsonRpcProtocolError("Harness extension protocol declaration is invalid")
            fields = {}
            for field in ("methods", "notifications", "capabilities"):
                value = protocol[field]
                if not isinstance(value, list) or not value or not all(isinstance(item, str) and item for item in value):
                    raise JsonRpcProtocolError(f"Harness extension {field} declaration is invalid")
                if len(value) != len(set(value)):
                    raise JsonRpcProtocolError(f"Harness extension {field} declaration contains duplicates")
                fields[field] = frozenset(value)
            if fields["methods"] != EXTENSION_METHODS or fields["notifications"] != CURRENT_NOTIFICATIONS:
                raise JsonRpcProtocolError("Harness extension wire surface is incompatible")
            if fields["capabilities"] != EXTENSION_CAPABILITIES:
                raise JsonRpcProtocolError("Harness extension capability surface is incompatible")
            methods, notifications, capabilities = fields["methods"], fields["notifications"], fields["capabilities"]
        self._identity = NativeRuntimeIdentity(
            name, version, self._contract_sha256, methods, notifications, capabilities,
        )
        return self._identity

    async def start_run(
        self,
        *,
        session_id: str,
        content_blocks: Sequence[Mapping[str, Any]],
    ) -> NativeRunReceipt:
        if self._identity is None:
            raise RuntimeError("Harness driver is not initialized")
        if not session_id:
            raise ValueError("session_id must be non-empty")
        blocks = [dict(block) for block in content_blocks]
        if not blocks or not all(isinstance(block.get("type"), str) and block["type"] for block in blocks):
            raise ValueError("content_blocks must contain typed blocks")
        raw = await self._peer.request("session/prompt", {"sessionId": session_id, "contentBlocks": blocks})
        if not isinstance(raw, dict) or set(raw) != {"messageId"} or not isinstance(raw["messageId"], str) or not raw["messageId"]:
            raise JsonRpcProtocolError("Harness prompt receipt is invalid")
        return NativeRunReceipt(session_id, raw["messageId"])

    async def next_fact(self, *, timeout: float | None = None) -> JsonRpcNotification:
        notification = await self._peer.next_notification(timeout=timeout)
        if notification.method not in CURRENT_NOTIFICATIONS:
            raise JsonRpcProtocolError("Harness emitted an unknown notification method")
        if not isinstance(notification.params, dict):
            raise JsonRpcProtocolError("Harness notification params must be an object")
        return notification

    async def cancel_run(self, *, session_id: str, message_id: str) -> None:
        if self._identity is None or "run.cancel" not in self._identity.capabilities:
            raise NativeCapabilityUnavailable("run.cancel")
        raw = await self._peer.request("session/cancel", {"sessionId": session_id, "messageId": message_id})
        if not isinstance(raw, dict) or raw.get("disposition") not in {"queued-cancelled", "active-cancelling"}:
            raise JsonRpcProtocolError("Harness cancellation receipt is invalid")

    async def resume_session(self, *, session_id: str) -> Mapping[str, Any]:
        if self._identity is None or "session.resume" not in self._identity.capabilities:
            raise NativeCapabilityUnavailable("session.resume")
        raw = await self._peer.request("session/resume", {"sessionId": session_id})
        if not isinstance(raw, dict) or raw.get("sessionId") != session_id:
            raise JsonRpcProtocolError("Harness resume receipt is invalid")
        return raw

    async def session_history(self, *, session_id: str, from_sequence: int = 0) -> Mapping[str, Any]:
        if self._identity is None or "session.history" not in self._identity.capabilities:
            raise NativeCapabilityUnavailable("session.history")
        raw = await self._peer.request(
            "session/history", {"sessionId": session_id, "fromSequence": from_sequence}
        )
        if not isinstance(raw, dict) or set(raw) != {"meta", "events"} or not isinstance(raw["events"], list):
            raise JsonRpcProtocolError("Harness history result is invalid")
        return raw

    async def workspace_attestation(self, *, session_id: str) -> Mapping[str, Any]:
        if self._identity is None or "workspace.containment" not in self._identity.capabilities:
            raise NativeCapabilityUnavailable("workspace.containment")
        raw = await self._peer.request("runtime/attestation", {"sessionId": session_id})
        if not isinstance(raw, dict) or set(raw) != {"policy", "enforcement", "contained"}:
            raise JsonRpcProtocolError("Harness workspace attestation is invalid")
        if raw["enforcement"] not in {"full", "partial", "none"} or not isinstance(raw["contained"], bool):
            raise JsonRpcProtocolError("Harness workspace attestation values are invalid")
        return raw

    async def close(self) -> None:
        if not self._peer.closed:
            try:
                await self._peer.request("shutdown", timeout=5.0)
            finally:
                await self._peer.close()
