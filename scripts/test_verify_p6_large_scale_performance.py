from __future__ import annotations

import verify_p6_large_scale_performance as verifier


def test_real_catalog_runtime_relay_and_android_scale_gates() -> None:
    report = verifier.verify()
    assert report["passed"] is True
    assert report["workspace_count"] == 100
    assert report["session_count"] == 10_000
    assert report["item_count"] == 100_000
    assert report["oaep_event_count"] == 10_000
    assert report["android_delta_target_per_second"] == 10_000
    assert report["workspace_page_p95_ms"] <= 100
    assert report["session_page_p95_ms"] <= 250
    assert report["rss_delta_bytes"] <= 512 * 1024 * 1024
    assert report["content_free"] is True
