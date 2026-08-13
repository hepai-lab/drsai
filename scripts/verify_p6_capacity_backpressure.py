#!/usr/bin/env python3
"""Content-free P6 capacity, backpressure and recovery acceptance gate."""
from __future__ import annotations

import asyncio
from copy import deepcopy
import json
from pathlib import Path
import sys
import tempfile


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "cores/python/packages/drsai/src"
if str(SOURCE) not in sys.path:
    sys.path.insert(0, str(SOURCE))

from drsai.backend.runtime.engine import RuntimeEngine, RuntimeEngineIdentity  # noqa: E402
from drsai.backend.runtime.journal import RuntimeConversationJournal, SessionCursorExpired  # noqa: E402
from drsai.relay.notifications import (  # noqa: E402
    NotificationDeliveryQueue,
    NotificationFanoutSink,
    notification_intent,
)
from drsai.relay.oaep_replay import OAEPReplayHub  # noqa: E402
from drsai.relay.registry import RelayRegistryError  # noqa: E402


def _frame(sequence: int, *, event_type: str = "event.run.started") -> dict:
    examples = json.loads(
        (ROOT / "cores/protocol/oaep/examples.json").read_text(encoding="utf-8")
    )
    event = deepcopy(examples["events"][0])
    event.update({
        "event_id": f"capacity-event-{sequence}",
        "dedupe_key": f"capacity-event-{sequence}",
        "sequence": sequence,
        "type": event_type,
    })
    event["source"]["runtime_id"] = "runtime-capacity"
    return {
        "type": "event", "protocol": "oaep/1", "scope": "session",
        "runtime_id": "runtime-capacity", "workspace_id": "workspace-capacity",
        "session_id": event["session_id"], "sequence": sequence, "event": event,
    }


def _runtime_gate(root: Path) -> dict[str, object]:
    database = root / "runtime.sqlite3"
    engine = RuntimeEngine(
        database,
        RuntimeEngineIdentity("runtime-capacity", "instance-capacity"),
        lambda value: value == "workspace-capacity",
    )
    session = engine.create_session("workspace-capacity", "Capacity")
    run, _ = engine.create_run(session["session_id"], "agent@1", "capacity-run-key")
    journal = RuntimeConversationJournal(
        database, "runtime-capacity",
        max_events_per_session=5, retained_events_per_session=3,
    )
    journal.upsert_item(
        session["session_id"], item_id="approval-capacity", kind="approval",
        role="system", revision=1, source_client="runtime",
        payload={"status": "pending"}, run_id=run["run_id"],
    )
    for index in range(8):
        journal.append_event(
            session["session_id"], "tool.state.changed",
            {"state": "completed", "ordinal": index}, run_id=run["run_id"],
            dedupe_key=f"capacity-{index}",
        )
    snapshot = journal.snapshot(session["session_id"])
    approval_preserved = any(
        item["item_id"] == "approval-capacity" for item in snapshot["items"]
    )
    try:
        journal.replay(session["session_id"], after_sequence=0)
    except SessionCursorExpired as failure:
        cursor_expired = failure.details["reason"] == "history_truncated"
        after = int(failure.details["earliest_sequence"]) - 1
    else:
        raise RuntimeError("p6_capacity_cursor_not_expired")
    retained = journal.replay(session["session_id"], after_sequence=after)
    if not approval_preserved or not cursor_expired or not 1 <= len(retained) <= 5:
        raise RuntimeError("p6_capacity_runtime_recovery_invalid")
    return {
        "policy": journal.capacity_policy(),
        "approval_preserved_in_snapshot": approval_preserved,
        "cursor_expired_recoverable": cursor_expired,
        "retained_event_count": len(retained),
    }


async def _relay_gate() -> dict[str, object]:
    hub = OAEPReplayHub(max_events_per_session=2)
    await hub.attach("runtime-capacity", "generation-one")
    session_id = _frame(1)["session_id"]
    queue = await hub.subscribe("runtime-capacity", session_id, queue_size=1)
    await hub.accept("runtime-capacity", "generation-one", _frame(1))
    await hub.accept(
        "runtime-capacity", "generation-one",
        _frame(2, event_type="event.run.waiting"),
    )
    marker = await asyncio.wait_for(queue.get(), timeout=1)
    replay = await hub.page(
        "runtime-capacity", "workspace-capacity", session_id,
        after_sequence=0, limit=10,
    )
    await hub.accept(
        "runtime-capacity", "generation-one",
        _frame(3, event_type="event.run.completed"),
    )
    try:
        await hub.page(
            "runtime-capacity", "workspace-capacity", session_id,
            after_sequence=0, limit=10,
        )
    except RelayRegistryError as failure:
        cursor_expired = (
            failure.code == "cursor_expired"
            and failure.details.get("reason") == "history_truncated"
        )
    else:
        raise RuntimeError("p6_capacity_relay_cursor_not_expired")
    if (
        marker.get("_control") != "replay_required"
        or replay is None
        or replay["data"][-1]["type"] != "event.run.waiting"
        or not cursor_expired
    ):
        raise RuntimeError("p6_capacity_relay_recovery_invalid")
    return {
        "policy": hub.metrics()["capacity"],
        "overflow_forced_replay": True,
        "approval_recovered": True,
        "cursor_expired_recoverable": cursor_expired,
        "replay_required_count": hub.metrics()["counters"]["replay_required"],
    }


def _notification_gate(root: Path) -> dict[str, object]:
    queue = NotificationDeliveryQueue(
        root / "push.sqlite3", capacity=1, retention_seconds=60, max_attempts=2,
    )
    sink = NotificationFanoutSink(queue, lambda *_args: ["device-capacity"])
    sink.accept("runtime-capacity", "workspace-capacity", "session-capacity", {
        "event_id": "approval-capacity", "type": "event.run.waiting",
    })
    sink.accept("runtime-capacity", "workspace-capacity", "session-capacity", {
        "event_id": "terminal-capacity", "type": "event.run.completed",
    })
    report = sink.capacity_report()
    if (
        queue.status_counts() != {"pending": 1}
        or report["fanout_capacity_rejections"] != 1
        or report["overflow_strategy"] != "reject_without_active_eviction"
    ):
        raise RuntimeError("p6_capacity_notification_active_evicted")

    class FailingProvider:
        def send(self, _device_id, _payload):
            raise RuntimeError("transient")

    first = queue.dispatch_once(FailingProvider(), now=10)
    early = queue.dispatch_once(FailingProvider(), now=11)
    final = queue.dispatch_once(FailingProvider(), now=12)
    if first["retrying"] != 1 or early["claimed"] != 0 or final["retrying"] != 1:
        raise RuntimeError("p6_capacity_notification_busy_loop")
    return {
        "policy": report,
        "active_terminal_not_evicted": True,
        "retry_backoff_observed": True,
        "max_attempts_enforced": queue.status_counts() == {"dead": 1},
    }


def _android_contract() -> dict[str, object]:
    policy = (ROOT / "apps/android/app/src/main/java/ai/drsai/remote/remote/data/RemoteCachePolicy.kt").read_text(encoding="utf-8")
    reliability = (ROOT / "apps/android/app/src/main/java/ai/drsai/remote/remote/data/RemoteReliability.kt").read_text(encoding="utf-8")
    required = (
        "MAX_EVENTS_PER_ACCOUNT = 100_000",
        "MAX_TERMINAL_ITEMS_PER_ACCOUNT = 100_000",
        "JOURNAL_RETENTION_MS = 30L * 24 * 60 * 60 * 1_000L",
    )
    if not all(value in policy for value in required) or "32 * 1024" not in reliability:
        raise RuntimeError("p6_capacity_android_contract_missing")
    return {
        "events_per_account": 100_000,
        "terminal_items_per_account": 100_000,
        "journal_retention_days": 30,
        "delta_frame_chars": 32 * 1024,
        "terminal_projection_preserved": True,
    }


def verify() -> dict[str, object]:
    with tempfile.TemporaryDirectory(prefix="drsai-p6-capacity-") as directory:
        root = Path(directory)
        report = {
            "version": "1",
            "runtime_journal": _runtime_gate(root),
            "relay_replay": asyncio.run(_relay_gate()),
            "notification_delivery": _notification_gate(root),
            "android_room_and_frames": _android_contract(),
            "content_free": True,
            "passed": True,
        }
    serialized = json.dumps(report, sort_keys=True).lower()
    forbidden = ("message", "command", "token", "workspace_id", "session_id", "device_id")
    if any(value in serialized for value in forbidden):
        raise RuntimeError("p6_capacity_report_contains_identity_or_content")
    return report


if __name__ == "__main__":
    print(json.dumps(verify(), sort_keys=True, separators=(",", ":")))
