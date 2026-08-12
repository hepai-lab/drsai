from __future__ import annotations

import verify_p6_user_slo as verifier


def test_four_user_visible_slos_are_aggregate_complete_and_diagnostic() -> None:
    assert verifier.verify() == {
        "passed": True,
        "journey_count": 4,
        "complete_samples_per_journey": 20,
        "p50_nonempty": True,
        "p95_nonempty": True,
        "breach_located": True,
        "content_free": True,
    }
