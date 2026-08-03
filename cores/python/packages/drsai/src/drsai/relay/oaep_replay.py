"""Generation-fenced OAEP replay and live fan-out for the reference Relay."""

from __future__ import annotations

import asyncio
from collections import deque
from collections import Counter
from copy import deepcopy
from dataclasses import dataclass
from typing import Any

from drsai.oaep.protocol import OAEPProtocol, OAEPValidationError

from .registry import RelayRegistryError


@dataclass(frozen=True)
class _StoredEvent:
    generation: str
    workspace_id: str
    event: dict[str, Any]


class OAEPReplayHub:
    """Bounded Session replay with generation fencing and collision checks.

    Production HAI deployments replace the storage/fan-out implementation with
    Redis while retaining these validation and identity semantics.
    """

    def __init__(self, *, max_events_per_session: int = 10_000) -> None:
        if max_events_per_session < 1:
            raise ValueError("oaep_replay_limit_invalid")
        self.max_events_per_session = max_events_per_session
        self.protocol = OAEPProtocol()
        self._generations: dict[str, str] = {}
        self._events: dict[tuple[str, str], deque[_StoredEvent]] = {}
        self._workspaces: dict[tuple[str, str], str] = {}
        self._subscribers: dict[tuple[str, str], set[asyncio.Queue[dict[str, Any]]]] = {}
        self._metrics: Counter[str] = Counter()
        self._lock = asyncio.Lock()

    def metrics(self) -> dict[str, Any]:
        return {
            "protocol": "oaep/1",
            "schema_hash": self.protocol.schema_hash,
            "counters": dict(sorted(self._metrics.items())),
            "active_runtimes": len(self._generations),
            "cached_sessions": len(self._events),
            "subscribers": sum(len(value) for value in self._subscribers.values()),
        }

    async def attach(self, runtime_id: str, generation: str) -> None:
        async with self._lock:
            self._generations[runtime_id] = generation

    async def detach(self, runtime_id: str, generation: str) -> None:
        async with self._lock:
            if self._generations.get(runtime_id) == generation:
                self._generations.pop(runtime_id, None)

    async def accept(
        self, runtime_id: str, generation: str, frame: dict[str, Any]
    ) -> bool:
        expected_keys = {
            "type", "protocol", "scope", "runtime_id", "workspace_id",
            "session_id", "sequence", "event",
        }
        if set(frame) != expected_keys:
            self._metrics["frame_invalid"] += 1
            raise RelayRegistryError("oaep_frame_invalid", "OAEP frame shape is invalid")
        if (
            frame.get("type") != "event"
            or frame.get("protocol") != "oaep/1"
            or frame.get("scope") != "session"
            or frame.get("runtime_id") != runtime_id
        ):
            self._metrics["frame_invalid"] += 1
            raise RelayRegistryError("oaep_frame_invalid", "OAEP frame identity is invalid")
        workspace_id = str(frame.get("workspace_id") or "")
        session_id = str(frame.get("session_id") or "")
        sequence = frame.get("sequence")
        event = frame.get("event")
        if not workspace_id or not session_id or not isinstance(sequence, int) or sequence < 1:
            self._metrics["frame_invalid"] += 1
            raise RelayRegistryError("oaep_frame_invalid", "OAEP frame scope is invalid")
        if not isinstance(event, dict):
            self._metrics["frame_invalid"] += 1
            raise RelayRegistryError("oaep_frame_invalid", "OAEP Event is invalid")
        try:
            self.protocol.validate_event(event)
        except OAEPValidationError as exc:
            self._metrics["event_invalid"] += 1
            event_type = event.get("type")
            if isinstance(event_type, str) and event_type not in self.protocol.schema["$defs"]["eventType"]["enum"]:
                self._metrics["unknown_event_type"] += 1
            raise RelayRegistryError("oaep_event_invalid", "OAEP Event is invalid") from exc
        source = event.get("source")
        if (
            event.get("session_id") != session_id
            or event.get("sequence") != sequence
            or not isinstance(source, dict)
            or source.get("runtime_id") != runtime_id
        ):
            self._metrics["identity_mismatch"] += 1
            raise RelayRegistryError("oaep_frame_identity_mismatch", "OAEP Event identity is invalid")

        key = (runtime_id, session_id)
        async with self._lock:
            if self._generations.get(runtime_id) != generation:
                self._metrics["stale_generation"] += 1
                raise RelayRegistryError(
                    "stale_runtime_generation",
                    "Runtime generation is no longer active",
                    retryable=True,
                )
            bound_workspace = self._workspaces.setdefault(key, workspace_id)
            if bound_workspace != workspace_id:
                self._metrics["identity_mismatch"] += 1
                raise RelayRegistryError(
                    "oaep_frame_identity_mismatch", "Session Workspace identity changed"
                )
            rows = self._events.setdefault(key, deque())
            if rows:
                latest = int(rows[-1].event["sequence"])
                if sequence <= latest:
                    existing = next(
                        (row.event for row in rows if row.event["sequence"] == sequence),
                        None,
                    )
                    if existing == event:
                        self._metrics["duplicate"] += 1
                        return False
                    self._metrics["sequence_collision"] += 1
                    raise RelayRegistryError(
                        "oaep_sequence_collision", "OAEP sequence was reused"
                    )
                if sequence != latest + 1:
                    self._metrics["sequence_gap"] += 1
                    raise RelayRegistryError("oaep_sequence_gap", "OAEP sequence is not contiguous")
            rows.append(_StoredEvent(generation, workspace_id, deepcopy(event)))
            while len(rows) > self.max_events_per_session:
                rows.popleft()
                self._metrics["replay_evicted"] += 1
            subscribers = tuple(self._subscribers.get(key, ()))
            self._metrics["accepted"] += 1
        for queue in subscribers:
            try:
                queue.put_nowait(deepcopy(event))
            except asyncio.QueueFull:
                # The client reconnects from its last committed Session cursor.
                self._metrics["subscriber_overflow"] += 1
        return True

    async def page(
        self,
        runtime_id: str,
        workspace_id: str,
        session_id: str,
        *,
        after_sequence: int,
        limit: int,
    ) -> dict[str, Any] | None:
        key = (runtime_id, session_id)
        async with self._lock:
            rows = self._events.get(key)
            if rows is None:
                return None
            if self._workspaces.get(key) != workspace_id:
                raise RelayRegistryError("session_not_found", "Session was not found")
            earliest = int(rows[0].event["sequence"]) if rows else after_sequence + 1
            latest = int(rows[-1].event["sequence"]) if rows else after_sequence
            if rows and after_sequence < earliest - 1:
                self._metrics["cursor_expired"] += 1
                raise RelayRegistryError(
                    "cursor_expired",
                    "OAEP replay cursor expired",
                    source="relay",
                    details={
                        "reason": "history_truncated",
                        "runtime_id": runtime_id,
                        "workspace_id": workspace_id,
                        "session_id": session_id,
                        "requested_sequence": after_sequence,
                        "earliest_sequence": earliest,
                        "latest_sequence": latest,
                    },
                )
            events: list[dict[str, Any]] = []
            for row in rows:
                if int(row.event["sequence"]) <= after_sequence:
                    continue
                events.append(deepcopy(row.event))
                if len(events) == limit:
                    break
        return {
            "version": "1.0",
            "object": "list",
            "data": events,
            "next_sequence": int(events[-1]["sequence"]) if events else after_sequence,
            "has_more": bool(events and int(events[-1]["sequence"]) < latest),
        }

    async def subscribe(
        self, runtime_id: str, session_id: str, *, queue_size: int = 256
    ) -> asyncio.Queue[dict[str, Any]]:
        key = (runtime_id, session_id)
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=queue_size)
        async with self._lock:
            self._subscribers.setdefault(key, set()).add(queue)
        return queue

    async def unsubscribe(
        self, runtime_id: str, session_id: str, queue: asyncio.Queue[dict[str, Any]]
    ) -> None:
        key = (runtime_id, session_id)
        async with self._lock:
            subscribers = self._subscribers.get(key)
            if subscribers is not None:
                subscribers.discard(queue)
                if not subscribers:
                    self._subscribers.pop(key, None)
