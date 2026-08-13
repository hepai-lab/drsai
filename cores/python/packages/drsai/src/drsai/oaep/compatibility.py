"""Fail-closed release policy for retiring OAEP legacy projections."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class LegacyRemovalMetrics:
    release_cycles: int
    observation_days: int
    oaep_client_ratio: float
    migration_ratio: float
    legacy_request_ratio: float
    fallback_error_rate: float
    supported_runtime_requires_legacy: bool
    rollback_artifact_verified: bool
    rollback_artifact_sha256: str
    migration_transcript_before_sha256: str
    migration_transcript_after_sha256: str
    database_migration_verified: bool

    @classmethod
    def from_mapping(cls, value: dict[str, Any]) -> "LegacyRemovalMetrics":
        required = {
            "release_cycles", "observation_days", "oaep_client_ratio",
            "migration_ratio", "legacy_request_ratio", "fallback_error_rate",
            "supported_runtime_requires_legacy",
            "rollback_artifact_verified",
            "rollback_artifact_sha256", "migration_transcript_before_sha256",
            "migration_transcript_after_sha256", "database_migration_verified",
        }
        missing = sorted(required - value.keys())
        if missing:
            raise ValueError(f"oaep_legacy_removal_metrics_missing:{','.join(missing)}")
        if not isinstance(value["supported_runtime_requires_legacy"], bool):
            raise ValueError("oaep_legacy_removal_metric_invalid:supported_runtime_requires_legacy")
        metrics = cls(
            release_cycles=int(value["release_cycles"]),
            observation_days=int(value["observation_days"]),
            oaep_client_ratio=float(value["oaep_client_ratio"]),
            migration_ratio=float(value["migration_ratio"]),
            legacy_request_ratio=float(value["legacy_request_ratio"]),
            fallback_error_rate=float(value["fallback_error_rate"]),
            supported_runtime_requires_legacy=(
                value["supported_runtime_requires_legacy"] is True
            ),
            rollback_artifact_verified=value["rollback_artifact_verified"] is True,
            rollback_artifact_sha256=str(value["rollback_artifact_sha256"]),
            migration_transcript_before_sha256=str(value["migration_transcript_before_sha256"]),
            migration_transcript_after_sha256=str(value["migration_transcript_after_sha256"]),
            database_migration_verified=value["database_migration_verified"] is True,
        )
        for name in (
            "oaep_client_ratio", "migration_ratio", "legacy_request_ratio",
            "fallback_error_rate",
        ):
            if not 0 <= getattr(metrics, name) <= 1:
                raise ValueError(f"oaep_legacy_removal_metric_invalid:{name}")
        for name in (
            "rollback_artifact_sha256", "migration_transcript_before_sha256",
            "migration_transcript_after_sha256",
        ):
            digest = getattr(metrics, name)
            if len(digest) != 64 or any(character not in "0123456789abcdef" for character in digest):
                raise ValueError(f"oaep_legacy_removal_digest_invalid:{name}")
        return metrics


def legacy_removal_decision(metrics: LegacyRemovalMetrics) -> dict[str, Any]:
    checks = {
        "oaep_clients_99_9_percent": metrics.oaep_client_ratio >= 0.999,
        "migration_complete": metrics.migration_ratio == 1.0,
        "legacy_requests_below_0_1_percent": metrics.legacy_request_ratio < 0.001,
        "fallback_errors_below_0_1_percent": metrics.fallback_error_rate <= 0.001,
        "supported_runtimes_are_oaep_capable": not metrics.supported_runtime_requires_legacy,
        "rollback_artifact_verified": metrics.rollback_artifact_verified,
        "rollback_artifact_digest_present": bool(metrics.rollback_artifact_sha256),
        "database_migration_verified": metrics.database_migration_verified,
        "transcript_hash_preserved": (
            metrics.migration_transcript_before_sha256
            == metrics.migration_transcript_after_sha256
        ),
    }
    return {
        "allowed": all(checks.values()),
        "checks": checks,
        "failed": sorted(name for name, passed in checks.items() if not passed),
    }
