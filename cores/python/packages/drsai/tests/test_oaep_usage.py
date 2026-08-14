from pathlib import Path
from datetime import date, datetime, timedelta, timezone
import hashlib
import json
import sqlite3

import jsonschema
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from drsai.oaep.usage import ProtocolUsageTelemetry
from drsai.relay.api import (
    P5_PLATFORM_CONTRACT_SHA256,
    ProtocolDeletionDecision,
    create_relay_app,
    record_protocol_usage_safely,
)


def test_usage_report_is_bounded_content_free_and_actionable(tmp_path: Path) -> None:
    usage = ProtocolUsageTelemetry(tmp_path / "usage.sqlite3")
    usage.record("oaep", "2.0.0")
    usage.record("oaep", "2.0.0")
    usage.record("legacy", "1.5.3", "oaep_unavailable")
    report = usage.report()
    assert report["oaep_request_ratio"] == pytest.approx(2 / 3)
    assert report["legacy_request_ratio"] == pytest.approx(1 / 3)
    assert report["retirement_decision"]["eligible"] is False
    encoded = str(report).lower()
    assert not any(secret in encoded for secret in ("subject", "workspace", "session", "payload", "message", "token"))


def test_usage_rejects_protocol_and_normalizes_unsafe_dimensions(tmp_path: Path) -> None:
    database = tmp_path / "usage.sqlite3"
    usage = ProtocolUsageTelemetry(database)
    with pytest.raises(ValueError, match="protocol_usage_protocol_invalid"):
        usage.record("new-secret-protocol", "2")
    usage.record("legacy", "token=secret", "message=secret")
    assert usage.report()["rows"] == [{
        "protocol": "legacy", "runtime_version": "unknown", "fallback_reason": "other", "request_count": 1,
    }]
    database.unlink()
    assert not database.exists()


def test_relay_exposes_only_aggregate_protocol_usage() -> None:
    app = create_relay_app(
        principal_resolver=lambda request: request.headers.get("x-subject", "test"),
        release_id="1.5.6",
    )
    app.state.protocol_usage.record("oaep", "2.0.0")
    app.state.registry.supported_runtime_capability_summary = lambda required: (1, 0)
    with TestClient(app) as client:
        payload = client.get("/v1/metrics/protocol-usage").json()
        decision = client.get("/v1/metrics/protocol-usage/deletion-decision").json()
        operation = client.get("/openapi.json").json()["paths"][
            "/v1/metrics/protocol-usage/deletion-decision"
        ]["get"]
    assert payload["schema_version"] == "p5-protocol-usage/1"
    assert payload["rows"] == [{"protocol": "oaep", "runtime_version": "2.0.0",
                                "fallback_reason": "selected", "request_count": 1}]
    assert decision["status"] == "eligible"
    assert decision["release_cycles"] == 1
    assert decision["migration_ratio"] == 1.0
    assert decision["eligible"] is True
    assert operation["x-p5-platform-contract-sha256"] == P5_PLATFORM_CONTRACT_SHA256
    assert operation["responses"]["200"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/ProtocolDeletionDecision"
    }
    app.state._telemetry_directory.cleanup()


def test_deletion_decision_model_and_openapi_hash_fail_closed() -> None:
    contract_path = Path(__file__).parents[4] / "protocol/relay/p5-platform-adapter.contract.json"
    assert hashlib.sha256(contract_path.read_bytes()).hexdigest() == P5_PLATFORM_CONTRACT_SHA256
    invalid = {
        "schema_version": "p5-protocol-deletion-decision/1",
        "status": "eligible",
        "data_start": "2026-07-01",
        "data_end": "2026-07-14",
        "observation_days": 14,
        "release_cycles": 2,
        "oaep_ratio": 0.998,
        "legacy_ratio": 0.0,
        "migration_ratio": 1.0,
        "fallback_error_ratio": 0.0,
        "gap_days": 0,
        "supported_runtime_count": 1,
        "supported_runtime_requires_legacy": False,
        "requirements": {
            "observation_days": 0,
            "release_cycles": 0,
            "oaep_ratio": 0.999,
            "legacy_ratio": 0.001,
            "migration_ratio": 1.0,
            "fallback_error_ratio": 0.001,
            "supported_runtime_requires_legacy": False,
        },
        "eligible": True,
    }
    with pytest.raises(ValidationError, match="protocol_deletion_decision_eligible_invalid"):
        ProtocolDeletionDecision.model_validate(invalid)


def test_threshold_and_migration_evidence_can_become_eligible_without_time_window(tmp_path: Path) -> None:
    database = tmp_path / "usage.sqlite3"
    usage = ProtocolUsageTelemetry(database)
    start = date(2026, 7, 1)
    usage.record_release_cycle("1.5.6", observed_at=start)
    usage.record_release_cycle("1.5.7", observed_at=start + timedelta(days=7))
    for offset in range(14):
        observed = start + timedelta(days=offset)
        usage.record("oaep", "2.0.0", observed_at=observed)
    decision = usage.deletion_decision(
        supported_runtime_count=1, supported_runtime_requires_legacy=False,
    )
    assert decision == {
        "schema_version": "p5-protocol-deletion-decision/1", "status": "eligible",
        "data_start": "2026-07-01", "data_end": "2026-07-14", "observation_days": 14,
        "release_cycles": 2, "oaep_ratio": 1.0, "legacy_ratio": 0.0,
        "migration_ratio": 1.0, "fallback_error_ratio": 0.0, "gap_days": 0,
        "supported_runtime_count": 1, "supported_runtime_requires_legacy": False,
        "requirements": {"observation_days": 0, "release_cycles": 0, "oaep_ratio": 0.999,
                         "legacy_ratio": 0.001, "migration_ratio": 1.0,
                         "fallback_error_ratio": 0.001,
                         "supported_runtime_requires_legacy": False},
        "eligible": True,
    }
    contract = json.loads((Path(__file__).parents[4] / "protocol/relay/p5-platform-adapter.contract.json")
                          .read_text(encoding="utf-8"))
    jsonschema.Draft202012Validator({
        "$defs": contract["$defs"], "$ref": "#/$defs/protocol_deletion_decision",
    }).validate(decision)
    database.unlink()


def test_deletion_decision_distinguishes_no_data_and_threshold_failure(tmp_path: Path) -> None:
    usage = ProtocolUsageTelemetry(tmp_path / "usage.sqlite3")
    assert usage.deletion_decision()["status"] == "no_data"
    start = date(2026, 7, 1)
    usage.record("oaep", "2.0.0", observed_at=start)
    usage.record("oaep", "2.0.0", observed_at=start + timedelta(days=2))
    assert usage.deletion_decision(
        supported_runtime_count=1, supported_runtime_requires_legacy=False,
    )["status"] == "eligible"
    assert usage.deletion_decision()["gap_days"] == 1


def test_explicit_zero_flow_days_are_observed_without_inventing_protocol_usage(tmp_path: Path) -> None:
    usage = ProtocolUsageTelemetry(tmp_path / "usage.sqlite3")
    start = date(2026, 7, 1)
    for offset in range(14):
        usage.record_observation_day(observed_at=start + timedelta(days=offset))
    usage.record_release_cycle("1.5.6", observed_at=start)
    usage.record_release_cycle("1.5.7", observed_at=start + timedelta(days=7))

    decision = usage.deletion_decision()
    assert decision["status"] == "no_data"
    assert decision["observation_days"] == 0
    assert decision["release_cycles"] == 0
    assert decision["migration_ratio"] is None
    assert decision["eligible"] is False

    complete = ProtocolUsageTelemetry(tmp_path / "threshold.sqlite3")
    complete.record_release_cycle("1.5.6", observed_at=start)
    complete.record_release_cycle("1.5.7", observed_at=start + timedelta(days=7))
    for offset in range(14):
        observed = start + timedelta(days=offset)
        complete.record("legacy" if offset == 0 else "oaep", "2.0.0", observed_at=observed)
    decision = complete.deletion_decision(
        supported_runtime_count=1, supported_runtime_requires_legacy=False,
    )
    assert decision["status"] == "threshold_failed"
    assert decision["eligible"] is False


def test_daily_evidence_survives_restart_and_requires_timezone_for_datetime(tmp_path: Path) -> None:
    database = tmp_path / "usage.sqlite3"
    usage = ProtocolUsageTelemetry(database)
    with pytest.raises(ValueError, match="timezone_required"):
        usage.record("oaep", "2.0.0", observed_at=datetime(2026, 7, 1))
    usage.record("oaep", "2.0.0", observed_at=datetime(2026, 7, 1, 23, tzinfo=timezone.utc))
    usage.record_release_cycle("1.5.6", observed_at=date(2026, 7, 1))
    restarted = ProtocolUsageTelemetry(database)
    decision = restarted.deletion_decision()
    assert decision["data_start"] == "2026-07-01"
    assert decision["observation_days"] == 1
    assert decision["release_cycles"] == 1
    assert decision["migration_ratio"] == 1.0


def test_supported_runtime_compatibility_is_a_fail_closed_deletion_gate(tmp_path: Path) -> None:
    usage = ProtocolUsageTelemetry(tmp_path / "usage.sqlite3")
    usage.record("oaep", "2.0.0", observed_at=date(2026, 7, 1))
    unknown = usage.deletion_decision()
    assert unknown["status"] == "runtime_compatibility_unknown"
    assert unknown["supported_runtime_requires_legacy"] is None
    assert unknown["eligible"] is False
    blocked = usage.deletion_decision(
        supported_runtime_count=2, supported_runtime_requires_legacy=True,
    )
    assert blocked["status"] == "supported_runtime_requires_legacy"
    assert blocked["eligible"] is False
    with pytest.raises(ValueError, match="supported_runtime_compatibility_invalid"):
        usage.deletion_decision(
            supported_runtime_count=1, supported_runtime_requires_legacy=None,
        )


def test_usage_dimensions_and_daily_history_are_bounded(tmp_path: Path) -> None:
    usage = ProtocolUsageTelemetry(tmp_path / "usage.sqlite3")
    start = date(2026, 6, 1)
    for index in range(140):
        usage.record("oaep", f"2.0.{index}", observed_at=start)
    rows = usage.report()["rows"]
    assert len({row["runtime_version"] for row in rows}) == 128
    assert any(row["runtime_version"] == "other" for row in rows)

    for offset in range(40):
        observed = start + timedelta(days=offset)
        usage.record("oaep", "2.0.0", observed_at=observed)
    decision = usage.deletion_decision()
    assert decision["observation_days"] == 30
    assert decision["data_start"] == "2026-06-11"
    assert decision["data_end"] == "2026-07-10"
    assert decision["gap_days"] == 0


def test_ten_thousand_observations_do_not_create_high_cardinality_rows(tmp_path: Path) -> None:
    usage = ProtocolUsageTelemetry(tmp_path / "usage.sqlite3")
    observed = date(2026, 7, 1)
    for _ in range(10_000):
        usage.record("oaep", "2.0.0", observed_at=observed)
    report = usage.report()
    assert report["total_requests"] == 10_000
    assert report["rows"] == [{
        "protocol": "oaep", "runtime_version": "2.0.0",
        "fallback_reason": "selected", "request_count": 10_000,
    }]


def test_telemetry_storage_failure_is_isolated_from_business_path(tmp_path: Path, monkeypatch) -> None:
    usage = ProtocolUsageTelemetry(tmp_path / "usage.sqlite3")
    def fail(*_args, **_kwargs):
        raise sqlite3.OperationalError("unavailable")
    monkeypatch.setattr(usage, "record", fail)
    assert record_protocol_usage_safely(usage, "oaep", "2.0.0", "selected") is False
