from __future__ import annotations

import hashlib
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from threading import Event, RLock

from .models import RelayEvent
from .registry import RelayRegistryError


class RelayEventStore:
    """Resume-safe event buffer. Runtime remains the authoritative producer."""

    def __init__(self) -> None:
        self._lock = RLock()
        self._events: dict[tuple[str, str], list[RelayEvent]] = {}
        self._ids: dict[str, RelayEvent] = {}

    def append(self, event: RelayEvent) -> RelayEvent:
        scope = (event.runtime_id, event.run_id)
        with self._lock:
            previous = self._ids.get(event.event_id)
            if previous is not None:
                if previous != event:
                    raise RelayRegistryError("event_id_conflict", "event_id was reused with different content")
                return previous
            events = self._events.setdefault(scope, [])
            expected = events[-1].sequence + 1 if events else 1
            if event.sequence != expected:
                raise RelayRegistryError("event_sequence_gap", f"Expected sequence {expected}")
            events.append(event)
            self._ids[event.event_id] = event
            return event

    def after(self, runtime_id: str, run_id: str, after_sequence: int, limit: int = 100) -> tuple[list[RelayEvent], str | None]:
        if after_sequence < 0 or not 1 <= limit <= 500:
            raise RelayRegistryError("event_cursor_invalid", "Invalid event cursor or limit")
        events = [event for event in self._events.get((runtime_id, run_id), []) if event.sequence > after_sequence]
        page = events[:limit]
        cursor = str(page[-1].sequence) if len(events) > len(page) else None
        return page, cursor


@dataclass(frozen=True)
class RawChunk:
    offset: int
    data: bytes
    digest: str
    total_size: int


class RawStreamGateway:
    """Authenticated byte-stream helper; bytes never enter a JSON envelope."""

    def __init__(self, authorize: Callable[[str, str, str], bool], read: Callable[[str, str], bytes],
                 *, max_request_bytes: int = 4 * 1024 * 1024, chunk_size: int = 64 * 1024) -> None:
        self.authorize, self.read = authorize, read
        self.max_request_bytes, self.chunk_size = max_request_bytes, chunk_size

    def stream(self, subject: str, runtime_id: str, workspace_id: str, path_token: str, *, offset: int,
               length: int, cancel: Event | None = None) -> Iterator[RawChunk]:
        if not self.authorize(subject, runtime_id, workspace_id):
            raise RelayRegistryError("file_forbidden", "File access is not authorized")
        if offset < 0 or length < 1 or length > self.max_request_bytes:
            raise RelayRegistryError("raw_range_invalid", "Raw range exceeds the configured limit")
        content = self.read(workspace_id, path_token)
        selected = content[offset:offset + length]
        total = len(content)
        for index in range(0, len(selected), self.chunk_size):
            if cancel and cancel.is_set():
                return
            data = selected[index:index + self.chunk_size]
            yield RawChunk(offset=offset + index, data=data, digest=hashlib.sha256(data).hexdigest(), total_size=total)
