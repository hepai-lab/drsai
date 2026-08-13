from __future__ import annotations

import verify_p6_multi_worker_latency as verifier


def test_two_real_worker_processes_aggregate_twenty_complete_correlations() -> None:
    assert verifier.verify() == {
        "passed": True,
        "worker_process_count": 2,
        "complete_correlation_count": 20,
        "stage_count": 5,
        "p50_nonempty": True,
        "p95_nonempty": True,
        "content_free": True,
    }
