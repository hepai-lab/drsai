from __future__ import annotations

from pathlib import Path

import pytest

from drsai.relay.notifications import (
    NotificationDeliveryQueue,
    NotificationFanoutSink,
    NotificationOutbox,
    NotificationQueueCapacityError,
    PushDeliveryError,
    notification_intent,
)


def test_notification_payload_is_opaque_and_content_free() -> None:
    event = {
        "event_id": "event-one",
        "type": "event.run.waiting",
        "item_id": "item-one",
        "payload": {"message": "secret", "command": "danger", "path": "/private"},
    }
    intent = notification_intent("runtime-one", "workspace-one", "session-one", event)
    assert intent is not None
    assert intent.payload == {
        "version": "1", "kind": "approval_required", "runtime_id": "runtime-one",
        "workspace_id": "workspace-one", "session_id": "session-one",
        "event_id": "event-one", "item_id": "item-one",
    }
    serialized = repr(intent.payload).lower()
    assert all(secret not in serialized for secret in ("secret", "danger", "/private", "message", "command", "path"))


def test_notification_outbox_is_bounded_deduplicated_and_ignores_deltas() -> None:
    outbox = NotificationOutbox(capacity=2)
    for index, kind in enumerate(("event.run.completed", "event.run.failed", "event.run.cancelled"), 1):
        outbox.accept("runtime", "workspace", "session", {"event_id": f"event-{index}", "type": kind})
    outbox.accept("runtime", "workspace", "session", {"event_id": "event-3", "type": "event.run.cancelled"})
    outbox.accept("runtime", "workspace", "session", {"event_id": "delta", "type": "event.item.delta"})
    assert [item["event_id"] for item in outbox.snapshot()] == ["event-2", "event-3"]


def test_delivery_queue_is_per_device_durable_deduplicated_and_content_free(tmp_path: Path) -> None:
    database = tmp_path / "push.sqlite3"
    queue = NotificationDeliveryQueue(database)
    intent = notification_intent("runtime", "workspace", "session", {
        "event_id": "event", "type": "event.run.completed", "payload": {"message": "secret"},
    })
    assert intent is not None
    assert queue.enqueue(intent, ["device-b", "device-a", "device-a"]) == 2
    assert queue.enqueue(intent, ["device-a"]) == 0
    claimed = queue.claim(now=10)
    assert {row["device_id"] for row in claimed} == {"device-a", "device-b"}
    assert "secret" not in repr(claimed).lower()
    database.unlink()
    assert not database.exists()


def test_delivery_retries_without_duplicate_success(tmp_path: Path) -> None:
    queue = NotificationDeliveryQueue(tmp_path / "push.sqlite3", max_attempts=2)
    intent = notification_intent("runtime", "workspace", "session", {
        "event_id": "event", "type": "event.run.failed",
    })
    assert intent is not None
    queue.enqueue(intent, ["device-a"])

    class Provider:
        attempts = 0
        def send(self, device_id, payload):
            self.attempts += 1
            if self.attempts == 1:
                raise RuntimeError("temporary")

    provider = Provider()
    assert queue.dispatch_once(provider, now=10) == {"claimed": 1, "delivered": 0, "retrying": 1, "dead": 0}
    assert queue.dispatch_once(provider, now=11)["claimed"] == 0
    assert queue.dispatch_once(provider, now=12) == {"claimed": 1, "delivered": 1, "retrying": 0, "dead": 0}
    assert queue.dispatch_once(provider, now=20)["claimed"] == 0
    assert queue.status_counts() == {"delivered": 1}


def test_delivery_permanent_provider_error_goes_directly_to_dead_letter(tmp_path: Path) -> None:
    queue = NotificationDeliveryQueue(tmp_path / "push.sqlite3", max_attempts=8)
    intent = notification_intent("runtime", "workspace", "session", {
        "event_id": "event", "type": "event.run.failed",
    })
    assert intent is not None
    queue.enqueue(intent, ["device-a"])

    class Provider:
        def send(self, _device_id, _payload):
            raise PushDeliveryError("provider_token_invalid", retryable=False)

    assert queue.dispatch_once(Provider(), now=10) == {
        "claimed": 1, "delivered": 0, "retrying": 0, "dead": 1,
    }
    assert queue.status_counts() == {"dead": 1}
    assert queue.dispatch_once(Provider(), now=20)["claimed"] == 0


def test_delivery_retryable_provider_error_remains_bounded(tmp_path: Path) -> None:
    queue = NotificationDeliveryQueue(tmp_path / "push.sqlite3", max_attempts=2)
    intent = notification_intent("runtime", "workspace", "session", {
        "event_id": "event", "type": "event.run.completed",
    })
    assert intent is not None
    queue.enqueue(intent, ["device-a"])

    class Provider:
        def send(self, _device_id, _payload):
            raise PushDeliveryError("provider_rate_limited", retryable=True)

    assert queue.dispatch_once(Provider(), now=10)["retrying"] == 1
    assert queue.dispatch_once(Provider(), now=12)["retrying"] == 1
    assert queue.status_counts() == {"dead": 1}


def test_fanout_resolves_only_opaque_device_ids_at_accept_time(tmp_path: Path) -> None:
    queue = NotificationDeliveryQueue(tmp_path / "push.sqlite3")
    sink = NotificationFanoutSink(
        queue,
        lambda runtime_id, workspace_id: ["device-a", "device-b"],
    )
    sink.accept("runtime", "workspace", "session", {"event_id": "event", "type": "event.run.completed"})
    assert {row["device_id"] for row in queue.claim(now=1)} == {"device-a", "device-b"}


def test_delivery_capacity_never_evicts_active_terminal_or_approval(tmp_path: Path) -> None:
    queue = NotificationDeliveryQueue(
        tmp_path / "push.sqlite3", capacity=2, retention_seconds=60,
    )
    terminal = notification_intent("runtime", "workspace", "session", {
        "event_id": "terminal", "type": "event.run.completed",
    })
    approval = notification_intent("runtime", "workspace", "session", {
        "event_id": "approval", "type": "event.run.waiting",
    })
    overflow = notification_intent("runtime", "workspace", "session", {
        "event_id": "overflow", "type": "event.run.failed",
    })
    assert terminal and approval and overflow
    assert queue.enqueue(terminal, ["device-a"], now=1) == 1
    assert queue.enqueue(approval, ["device-a"], now=1) == 1
    with pytest.raises(NotificationQueueCapacityError):
        queue.enqueue(overflow, ["device-a"], now=2)
    assert queue.status_counts() == {"pending": 2}
    report = queue.capacity_report()
    assert report["capacity_rejections"] == 1
    assert report["overflow_strategy"] == "reject_without_active_eviction"


def test_delivery_capacity_prunes_only_settled_rows_and_retention_is_explicit(tmp_path: Path) -> None:
    queue = NotificationDeliveryQueue(
        tmp_path / "push.sqlite3", capacity=1, retention_seconds=10,
    )
    first = notification_intent("runtime", "workspace", "session", {
        "event_id": "first", "type": "event.run.completed",
    })
    second = notification_intent("runtime", "workspace", "session", {
        "event_id": "second", "type": "event.run.waiting",
    })
    assert first and second
    queue.enqueue(first, ["device-a"], now=1)
    row = queue.claim(now=1)[0]
    queue.settle(row["delivery_id"], delivered=True, now=2)
    assert queue.enqueue(second, ["device-a"], now=3) == 1
    assert queue.status_counts() == {"pending": 1}
    report = queue.capacity_report()
    assert report["retention_seconds"] == 10
    assert report["pruned_rows"] == 1


def test_fanout_capacity_does_not_fail_authoritative_terminal_acceptance(tmp_path: Path) -> None:
    queue = NotificationDeliveryQueue(tmp_path / "push.sqlite3", capacity=1)
    sink = NotificationFanoutSink(queue, lambda *_args: ["device-a"])
    sink.accept("runtime", "workspace", "session", {
        "event_id": "approval", "type": "event.run.waiting",
    })
    # The second terminal remains recoverable from OAEP/Snapshot even while the
    # optional push hint queue is saturated; the sink never enters retry spin.
    sink.accept("runtime", "workspace", "session", {
        "event_id": "terminal", "type": "event.run.completed",
    })
    assert queue.status_counts() == {"pending": 1}
    assert sink.capacity_report()["fanout_capacity_rejections"] == 1
