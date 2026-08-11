from __future__ import annotations

from pathlib import Path

from drsai.relay.notifications import NotificationDeliveryQueue, NotificationFanoutSink, NotificationOutbox, notification_intent


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
    assert queue.dispatch_once(provider, now=10) == {"claimed": 1, "delivered": 0, "retrying": 1}
    assert queue.dispatch_once(provider, now=11)["claimed"] == 0
    assert queue.dispatch_once(provider, now=12) == {"claimed": 1, "delivered": 1, "retrying": 0}
    assert queue.dispatch_once(provider, now=20)["claimed"] == 0
    assert queue.status_counts() == {"delivered": 1}


def test_fanout_resolves_only_opaque_device_ids_at_accept_time(tmp_path: Path) -> None:
    queue = NotificationDeliveryQueue(tmp_path / "push.sqlite3")
    sink = NotificationFanoutSink(queue, lambda runtime_id: ["device-a", "device-b"])
    sink.accept("runtime", "workspace", "session", {"event_id": "event", "type": "event.run.completed"})
    assert {row["device_id"] for row in queue.claim(now=1)} == {"device-a", "device-b"}
