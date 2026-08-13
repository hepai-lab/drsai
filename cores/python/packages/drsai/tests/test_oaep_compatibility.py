from __future__ import annotations

import pytest

from drsai.oaep.compatibility import LegacyRemovalMetrics, legacy_removal_decision


READY = {
    "release_cycles": 0,
    "observation_days": 0,
    "oaep_client_ratio": 0.999,
    "migration_ratio": 1.0,
    "legacy_request_ratio": 0.0009,
    "fallback_error_rate": 0.001,
    "supported_runtime_requires_legacy": False,
    "rollback_artifact_verified": True,
    "rollback_artifact_sha256": "a" * 64,
    "migration_transcript_before_sha256": "b" * 64,
    "migration_transcript_after_sha256": "b" * 64,
    "database_migration_verified": True,
}


def test_legacy_removal_requires_threshold_migration_and_rollback_evidence() -> None:
    decision = legacy_removal_decision(LegacyRemovalMetrics.from_mapping(READY))
    assert decision == {
        "allowed": True,
        "checks": {name: True for name in decision["checks"]},
        "failed": [],
    }


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("oaep_client_ratio", 0.9989),
        ("migration_ratio", 0.999),
        ("legacy_request_ratio", 0.001),
        ("fallback_error_rate", 0.0011),
        ("supported_runtime_requires_legacy", True),
        ("rollback_artifact_verified", False),
        ("database_migration_verified", False),
        ("migration_transcript_after_sha256", "c" * 64),
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
    with pytest.raises(ValueError, match="digest_invalid"):
        LegacyRemovalMetrics.from_mapping({**READY, "rollback_artifact_sha256": "bad"})
    with pytest.raises(ValueError, match="metric_invalid"):
        LegacyRemovalMetrics.from_mapping({**READY, "supported_runtime_requires_legacy": "false"})
