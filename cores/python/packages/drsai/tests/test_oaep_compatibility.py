from __future__ import annotations

import pytest

from drsai.oaep.compatibility import LegacyRemovalMetrics, legacy_removal_decision


READY = {
    "release_cycles": 2,
    "observation_days": 14,
    "oaep_client_ratio": 0.99,
    "migration_ratio": 1.0,
    "legacy_request_ratio": 0.01,
    "fallback_error_rate": 0.001,
    "rollback_artifact_verified": True,
}


def test_legacy_removal_requires_every_release_metric() -> None:
    decision = legacy_removal_decision(LegacyRemovalMetrics.from_mapping(READY))
    assert decision == {
        "allowed": True,
        "checks": {name: True for name in decision["checks"]},
        "failed": [],
    }


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("release_cycles", 1),
        ("observation_days", 13),
        ("oaep_client_ratio", 0.989),
        ("migration_ratio", 0.999),
        ("legacy_request_ratio", 0.011),
        ("fallback_error_rate", 0.0011),
        ("rollback_artifact_verified", False),
    ],
)
def test_legacy_removal_fails_closed_for_each_missing_threshold(
    name: str, value: object,
) -> None:
    decision = legacy_removal_decision(
        LegacyRemovalMetrics.from_mapping({**READY, name: value})
    )
    assert decision["allowed"] is False
    assert decision["failed"]


def test_legacy_removal_rejects_missing_and_out_of_range_metrics() -> None:
    with pytest.raises(ValueError, match="metrics_missing"):
        LegacyRemovalMetrics.from_mapping({})
    with pytest.raises(ValueError, match="metric_invalid"):
        LegacyRemovalMetrics.from_mapping({**READY, "oaep_client_ratio": 1.1})
