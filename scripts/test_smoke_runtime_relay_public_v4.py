from __future__ import annotations

import hashlib
import json

import pytest

import smoke_runtime_relay_public_v4 as smoke


def _openapi(value: str) -> dict:
    return {
        "paths": {
            path: {"get": {"x-oaep-schema-sha256": value}}
            for path in smoke.OAEP_PATHS
        }
    }


def test_authoritative_hash_is_derived_and_bound_to_relay_schema() -> None:
    expected = hashlib.sha256(smoke.OAEP_SCHEMA.read_bytes()).hexdigest()
    relay = json.loads(smoke.RELAY_SCHEMA.read_text(encoding="utf-8"))
    assert smoke.authoritative_schema_hash() == expected
    assert relay["x-oaep-schema-sha256"] == expected
    assert smoke.validate_schema_hash(_openapi(expected)) == expected


def test_stale_public_or_local_hash_fails_closed(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    expected = smoke.authoritative_schema_hash()
    with pytest.raises(smoke.SmokeFailure, match="OpenAPI schema hash drift"):
        smoke.validate_schema_hash(_openapi("0" * 64), expected)

    relay = tmp_path / "relay.json"
    relay.write_text(json.dumps({"x-oaep-schema-sha256": "0" * 64}), encoding="utf-8")
    monkeypatch.setattr(smoke, "RELAY_SCHEMA", relay)
    with pytest.raises(smoke.SmokeFailure, match="local OAEP and Relay schema hashes drift"):
        smoke.authoritative_schema_hash()


def latency_openapi() -> dict:
    return {
        "paths": {
            smoke.LATENCY_OBSERVATION_PATH: {"get": {}, "post": {}},
            smoke.LATENCY_METRICS_PATH: {"get": {}},
        },
        "components": {"schemas": {
            "LatencyObservationRequest": {
                "additionalProperties": False,
                "required": ["client_receive_at_ms", "render_at_ms"],
                "properties": {
                    "client_receive_at_ms": {"type": "integer"},
                    "render_at_ms": {"type": "integer"},
                },
            },
            "LatencyObservationResponse": {"properties": {}},
            "LatencyReportResponse": {
                "additionalProperties": False,
                "properties": {
                    "sample_count": {}, "ready_count": {}, "ready": {},
                    "end_to_end_p95_ms": {},
                },
            },
        }},
    }


def test_latency_contract_accepts_frozen_ai_dev_shape() -> None:
    smoke.validate_latency_contract(latency_openapi())


@pytest.mark.parametrize("mutation", [
    lambda value: value["paths"].pop(smoke.LATENCY_METRICS_PATH),
    lambda value: value["paths"][smoke.LATENCY_OBSERVATION_PATH].pop("post"),
    lambda value: value["components"]["schemas"]["LatencyObservationRequest"].update(
        additionalProperties=True
    ),
    lambda value: value["components"]["schemas"]["LatencyObservationRequest"]["required"].pop(),
    lambda value: value["components"]["schemas"]["LatencyReportResponse"]["properties"].pop(
        "end_to_end_p95_ms"
    ),
])
def test_latency_contract_drift_fails_closed(mutation) -> None:
    value = latency_openapi()
    mutation(value)
    with pytest.raises(smoke.SmokeFailure, match="latency"):
        smoke.validate_latency_contract(value)
