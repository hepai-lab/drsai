from __future__ import annotations

from datetime import UTC, datetime
from threading import Event

import pytest

from drsai.relay.models import RelayEvent
from drsai.relay.registry import RelayRegistryError
from drsai.relay.streaming import RawStreamGateway, RelayEventStore


def event(sequence: int, event_id: str | None = None, runtime_id: str = "rt-a") -> RelayEvent:
    return RelayEvent(event_id=event_id or f"evt-{sequence}", sequence=sequence, runtime_id=runtime_id,
                      workspace_id="ws", session_id="session", run_id="run", timestamp=datetime.now(UTC),
                      kind="output.delta", payload={"delta": str(sequence)})


def test_event_resume_cursor_dedupe_and_scope() -> None:
    store = RelayEventStore()
    first = event(1)
    assert store.append(first) == store.append(first)
    store.append(event(2))
    store.append(event(3))
    page, cursor = store.after("rt-a", "run", 0, limit=2)
    assert [item.sequence for item in page] == [1, 2] and cursor == "2"
    assert [item.sequence for item in store.after("rt-a", "run", int(cursor))[0]] == [3]
    assert store.after("rt-b", "run", 0)[0] == []


def test_event_gap_and_event_id_collision_fail_closed() -> None:
    store = RelayEventStore()
    store.append(event(1))
    with pytest.raises(RelayRegistryError, match="Expected sequence 2"):
        store.append(event(3))
    with pytest.raises(RelayRegistryError, match="different content"):
        store.append(event(1, event_id="evt-1", runtime_id="rt-other"))


def test_raw_stream_range_digest_limit_auth_and_cancel() -> None:
    gateway = RawStreamGateway(lambda subject, runtime, workspace: subject == "alice",
                               lambda workspace, token: b"abcdefghij", max_request_bytes=8, chunk_size=3)
    chunks = list(gateway.stream("alice", "rt", "ws", "opaque-file-token", offset=2, length=6))
    assert b"".join(item.data for item in chunks) == b"cdefgh"
    assert [item.offset for item in chunks] == [2, 5]
    assert all(len(item.digest) == 64 and item.total_size == 10 for item in chunks)
    with pytest.raises(RelayRegistryError, match="not authorized"):
        list(gateway.stream("bob", "rt", "ws", "token", offset=0, length=1))
    with pytest.raises(RelayRegistryError, match="exceeds"):
        list(gateway.stream("alice", "rt", "ws", "token", offset=0, length=9))
    cancelled = Event()
    cancelled.set()
    assert list(gateway.stream("alice", "rt", "ws", "token", offset=0, length=2, cancel=cancelled)) == []
