from __future__ import annotations

import asyncio
import json
from copy import deepcopy
from pathlib import Path

import pytest

from drsai.relay.oaep_replay import OAEPReplayHub
from drsai.relay.registry import RelayRegistryError


ROOT = Path(__file__).resolve().parents[5]


def _event(sequence: int) -> dict:
    fixture = json.loads(
        (ROOT / "cores/protocol/oaep/examples.json").read_text(encoding="utf-8")
    )
    value = deepcopy(fixture["events"][0])
    value.update({
        "event_id": f"event-{sequence}",
        "sequence": sequence,
        "dedupe_key": f"event-{sequence}",
    })
    value["source"]["runtime_id"] = "runtime-one"
    return value


def _frame(sequence: int, **overrides) -> dict:
    event = _event(sequence)
    result = {
        "type": "event",
        "protocol": "oaep/1",
        "scope": "session",
        "runtime_id": "runtime-one",
        "workspace_id": "workspace-one",
        "session_id": event["session_id"],
        "sequence": sequence,
        "event": event,
    }
    result.update(overrides)
    return result


def test_oaep_replay_is_generation_fenced_bounded_and_collision_safe() -> None:
    async def scenario() -> None:
        hub = OAEPReplayHub(max_events_per_session=3)
        await hub.attach("runtime-one", "generation-one")
        for sequence in range(1, 5):
            assert await hub.accept(
                "runtime-one", "generation-one", _frame(sequence)
            )

        # Exact retransmission is idempotent; same cursor with different data
        # is a protocol collision.
        assert not await hub.accept(
            "runtime-one", "generation-one", _frame(4)
        )
        collision = _frame(4)
        collision["event"]["dedupe_key"] = "forged"
        with pytest.raises(RelayRegistryError, match="reused") as captured:
            await hub.accept("runtime-one", "generation-one", collision)
        assert captured.value.code == "oaep_sequence_collision"

        with pytest.raises(RelayRegistryError) as expired:
            await hub.page(
                "runtime-one", "workspace-one", _event(1)["session_id"],
                after_sequence=0, limit=10,
            )
        assert expired.value.code == "cursor_expired"
        page = await hub.page(
            "runtime-one", "workspace-one", _event(1)["session_id"],
            after_sequence=1, limit=10,
        )
        assert [event["sequence"] for event in page["data"]] == [2, 3, 4]

        await hub.attach("runtime-one", "generation-two")
        with pytest.raises(RelayRegistryError) as stale:
            await hub.accept("runtime-one", "generation-one", _frame(5))
        assert stale.value.code == "stale_runtime_generation"
        assert await hub.accept("runtime-one", "generation-two", _frame(5))

    asyncio.run(scenario())


def test_oaep_replay_rejects_gap_cross_scope_and_malformed_before_fanout() -> None:
    async def scenario() -> None:
        hub = OAEPReplayHub()
        await hub.attach("runtime-one", "generation-one")
        session_id = _event(1)["session_id"]
        queue = await hub.subscribe("runtime-one", session_id)
        assert await hub.accept("runtime-one", "generation-one", _frame(1))
        assert (await asyncio.wait_for(queue.get(), timeout=1))["sequence"] == 1

        with pytest.raises(RelayRegistryError) as gap:
            await hub.accept("runtime-one", "generation-one", _frame(3))
        assert gap.value.code == "oaep_sequence_gap"
        with pytest.raises(RelayRegistryError) as cross_workspace:
            await hub.accept(
                "runtime-one", "generation-one",
                _frame(2, workspace_id="workspace-two"),
            )
        assert cross_workspace.value.code == "oaep_frame_identity_mismatch"
        malformed = _frame(2)
        malformed["event"] = {"legacy": True}
        with pytest.raises(RelayRegistryError) as invalid:
            await hub.accept("runtime-one", "generation-one", malformed)
        assert invalid.value.code == "oaep_event_invalid"
        assert queue.empty()

    asyncio.run(scenario())


def test_oaep_metrics_expose_drift_backpressure_and_recovery_without_payloads() -> None:
    async def scenario() -> None:
        hub = OAEPReplayHub(max_events_per_session=2)
        await hub.attach("runtime-one", "generation-one")
        queue = await hub.subscribe("runtime-one", _event(1)["session_id"], queue_size=1)
        for sequence in range(1, 4):
            assert await hub.accept("runtime-one", "generation-one", _frame(sequence))
        unknown = _frame(4)
        unknown["event"]["type"] = "event.future.unsupported"
        with pytest.raises(RelayRegistryError):
            await hub.accept("runtime-one", "generation-one", unknown)
        with pytest.raises(RelayRegistryError):
            await hub.page(
                "runtime-one", "workspace-one", _event(1)["session_id"],
                after_sequence=0, limit=10,
            )
        metrics = hub.metrics()
        assert metrics["protocol"] == "oaep/1"
        assert len(metrics["schema_hash"]) == 64
        assert metrics["counters"]["accepted"] == 3
        assert metrics["counters"]["subscriber_overflow"] == 2
        assert metrics["counters"]["replay_evicted"] == 1
        assert metrics["counters"]["unknown_event_type"] == 1
        assert metrics["counters"]["cursor_expired"] == 1
        assert "event" not in metrics and "payload" not in metrics
        assert queue.qsize() == 1

    asyncio.run(scenario())


def test_workspace_catalog_fanout_only_emits_session_lifecycle_and_is_revocable() -> None:
    async def scenario() -> None:
        hub = OAEPReplayHub()
        await hub.attach("runtime-one", "generation-one")
        queue = await hub.subscribe_workspace("runtime-one", "workspace-one")
        assert await hub.accept("runtime-one", "generation-one", _frame(1))
        assert queue.empty()
        lifecycle = _frame(2)
        lifecycle["event"]["type"] = "event.session.updated"
        assert await hub.accept("runtime-one", "generation-one", lifecycle)
        row = await asyncio.wait_for(queue.get(), timeout=1)
        assert row == {"event_id": "event-2", "session_id": lifecycle["session_id"],
                       "type": "event.session.updated", "sequence": 2}
        assert not ({"payload", "body", "message"} & row.keys())
        assert await hub.invalidate_runtime("runtime-one") == 1
        assert (await queue.get()) == {"_control": "authorization_changed"}

    asyncio.run(scenario())


def test_workspace_catalog_slow_consumer_is_bounded_and_unsubscribes_cleanly() -> None:
    async def scenario() -> None:
        hub = OAEPReplayHub()
        await hub.attach("runtime-one", "generation-one")
        queue = await hub.subscribe_workspace("runtime-one", "workspace-one", queue_size=1)
        for sequence in (1, 2):
            frame = _frame(sequence)
            frame["event"]["type"] = "event.session.updated"
            assert await hub.accept("runtime-one", "generation-one", frame)
        assert queue.qsize() == 1
        assert hub.metrics()["counters"]["workspace_subscriber_overflow"] == 1
        await hub.unsubscribe_workspace("runtime-one", "workspace-one", queue)
        assert hub.metrics()["workspace_subscribers"] == 0

    asyncio.run(scenario())
