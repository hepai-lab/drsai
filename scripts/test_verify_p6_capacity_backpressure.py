from __future__ import annotations

import verify_p6_capacity_backpressure as verifier


def test_runtime_relay_room_and_notification_capacity_recover_without_loss() -> None:
    report = verifier.verify()
    assert report["passed"] is True
    assert report["content_free"] is True
    assert report["runtime_journal"]["approval_preserved_in_snapshot"] is True
    assert report["runtime_journal"]["cursor_expired_recoverable"] is True
    assert report["relay_replay"]["overflow_forced_replay"] is True
    assert report["relay_replay"]["approval_recovered"] is True
    assert report["notification_delivery"]["active_terminal_not_evicted"] is True
    assert report["notification_delivery"]["retry_backoff_observed"] is True
    assert report["notification_delivery"]["max_attempts_enforced"] is True
    assert report["android_room_and_frames"]["terminal_projection_preserved"] is True
