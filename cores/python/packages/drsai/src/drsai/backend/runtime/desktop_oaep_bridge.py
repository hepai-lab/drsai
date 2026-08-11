"""Mirror Desktop agent turns into the canonical Runtime OAEP journal.

The Desktop currently executes its local agent through ``/v1/chat/completions``.
This bridge deliberately does not execute another Agent Backend.  It owns only
the durable Runtime Run and mirrors the already-produced semantic events so all
clients observe the same Session snapshot and event stream.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
import hashlib
import json
from typing import Any

from drsai.backend.runtime.engine import RuntimeEngine
from drsai.backend.runtime.security import redact_sensitive
from drsai.relay.security import redact_credentials


_TERMINAL = {"completed", "cancelled", "failed"}


def _safe(value: Any) -> Any:
    if isinstance(value, str):
        # Tool results are frequently JSON-encoded strings.  Preserve
        # diagnostic fields such as ``error_code`` while still removing real
        # credential material before it enters the durable OAEP journal.
        return redact_sensitive(redact_credentials(value))
    if isinstance(value, dict):
        return {str(key): _safe(child) for key, child in list(value.items())[:100]}
    if isinstance(value, (list, tuple)):
        return [_safe(child) for child in list(value)[:100]]
    return redact_sensitive(value)


def _digest(value: Any) -> str:
    encoded = json.dumps(
        _safe(value), ensure_ascii=False, separators=(",", ":"), sort_keys=True
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()[:24]


@dataclass
class DesktopOaepJournalBridge:
    """Idempotently mirror one Desktop request into a Runtime Run."""

    engine: RuntimeEngine
    run_id: str
    request_id: str
    retry_attempt: int = 0
    resume_from_chars: int = 0
    message_chars_seen: int = 0
    _occurrences: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    _assistant_terminal_recorded: bool = False

    @classmethod
    def begin(
        cls,
        engine: RuntimeEngine,
        *,
        session_id: str,
        request_id: str,
        display_message: str,
        source_message_id: str,
        correlation_id: str | None,
        agent_definition: str,
        backend_id: str,
        retry_attempt: int = 0,
        resume_from_chars: int = 0,
    ) -> "DesktopOaepJournalBridge":
        if not request_id or len(request_id) > 200:
            raise ValueError("A valid Desktop request identity is required")
        run, created = engine.create_run(
            session_id,
            agent_definition,
            f"desktop-agent:{request_id}",
            backend_id,
        )
        safe_message = str(_safe(display_message))
        if created:
            engine.set_run_input(
                run["run_id"],
                display_message,
                correlation_id=correlation_id,
                source_client="windows",
                source_message_id=source_message_id,
            )
        elif str(run.get("input_message") or "") != safe_message:
            raise ValueError(
                "Desktop request identity is already bound to another message"
            )
        current = engine.get_run(run["run_id"])
        if current["status"] == "queued":
            engine.transition_run(run["run_id"], "running")
        return cls(
            engine=engine,
            run_id=str(run["run_id"]),
            request_id=request_id,
            retry_attempt=max(0, int(retry_attempt)),
            resume_from_chars=max(0, int(resume_from_chars)),
        )

    def record(self, event_type: str, payload: dict[str, Any]) -> None:
        """Persist one translated semantic event with retry-stable identity."""
        normalized_type, normalized_payload = self._normalize(event_type, payload)
        if normalized_type == "agent.message.delta":
            delta = str(
                normalized_payload.get("delta")
                or normalized_payload.get("text")
                or normalized_payload.get("content")
                or ""
            )
            start = self.message_chars_seen
            end = start + len(delta)
            self.message_chars_seen = end
            if end <= self.resume_from_chars:
                return
            if start < self.resume_from_chars:
                delta = delta[self.resume_from_chars - start :]
                start = self.resume_from_chars
            if not delta:
                return
            normalized_payload = {
                **normalized_payload,
                "delta": delta,
                "content": delta,
                "text": delta,
            }
            key = (
                f"desktop:{self.request_id}:message:{start}:"
                f"{_digest(normalized_payload)}"
            )
        else:
            fingerprint = f"{normalized_type}:{_digest(normalized_payload)}"
            occurrence = self._occurrences[fingerprint]
            self._occurrences[fingerprint] += 1
            key = (
                f"desktop:{self.request_id}:{normalized_type}:"
                f"{occurrence}:{_digest(normalized_payload)}"
            )
        self.engine.append_backend_event(
            self.run_id, normalized_type, normalized_payload, key
        )
        if normalized_type in {"message.complete", "agent.completed"}:
            self._assistant_terminal_recorded = True

    def complete(self, payload: dict[str, Any] | None = None) -> None:
        current = self.engine.get_run(self.run_id)
        if current["status"] in _TERMINAL:
            return
        if not self._assistant_terminal_recorded:
            self.engine.append_backend_event(
                self.run_id,
                "agent.completed",
                dict(payload or {}),
                f"desktop:{self.request_id}:terminal:completed",
            )
            self._assistant_terminal_recorded = True
        self.engine.transition_run(self.run_id, "completed")

    def cancel(self) -> None:
        current = self.engine.get_run(self.run_id)
        if current["status"] not in _TERMINAL:
            self.engine.transition_run(
                self.run_id, "cancelled", reason="desktop_client_cancelled"
            )

    def fail(self, error: dict[str, Any]) -> None:
        current = self.engine.get_run(self.run_id)
        if current["status"] in _TERMINAL:
            return
        safe_error = _safe(error)
        self.engine.append_backend_event(
            self.run_id,
            "agent.failed",
            {"error": safe_error},
            f"desktop:{self.request_id}:terminal:failed",
        )
        self.engine.transition_run(
            self.run_id, "failed", reason="desktop_agent_failed", error=safe_error
        )

    @staticmethod
    def _normalize(
        event_type: str, payload: dict[str, Any]
    ) -> tuple[str, dict[str, Any]]:
        safe_payload = dict(_safe(payload))
        if event_type == "message.delta":
            delta = str(
                safe_payload.get("text")
                or safe_payload.get("delta")
                or safe_payload.get("content")
                or ""
            )
            return "agent.message.delta", {
                **safe_payload,
                "delta": delta,
                "content": delta,
            }
        if event_type == "tool.start":
            return "tool.started", safe_payload
        if event_type == "tool.complete":
            return "tool.completed", safe_payload
        return event_type, safe_payload
