from __future__ import annotations

import hashlib
import json

import pytest

import smoke_runtime_relay_public_v4 as smoke


def _openapi(value: str) -> dict:
    return {
        "x-oaep-schema-sha256": value,
        "paths": {
            path: {"get": {"x-oaep-schema-sha256": value}}
            for path in smoke.OAEP_PATHS
        }
    }


def test_conversation_consistency_accepts_exact_content_free_contract() -> None:
    value = {
        "x-oaep-conversation-consistency": dict(smoke.OAEP_CONVERSATION_CONSISTENCY)
    }
    smoke.validate_conversation_consistency(value)


@pytest.mark.parametrize("mutation", [
    lambda value: value.pop("replay_before_live"),
    lambda value: value.update(cursor_semantics="inclusive"),
    lambda value: value["replay_scope_fields"].append("subject"),
    lambda value: value.update(cursor_expired_status=200),
])
def test_conversation_consistency_drift_fails_closed(mutation) -> None:
    contract = json.loads(json.dumps(smoke.OAEP_CONVERSATION_CONSISTENCY))
    mutation(contract)
    with pytest.raises(smoke.SmokeFailure, match="conversation consistency"):
        smoke.validate_conversation_consistency(
            {"x-oaep-conversation-consistency": contract}
        )


def test_long_conversation_navigation_accepts_exact_content_free_contract() -> None:
    smoke.validate_long_conversation_navigation({
        "x-long-conversation-navigation": dict(smoke.LONG_CONVERSATION_NAVIGATION),
    })


@pytest.mark.parametrize("mutation", [
    lambda value: value.pop("checkpoint"),
    lambda value: value.update(pagination="offset"),
    lambda value: value.update(search_scope="server_index"),
    lambda value: value["local_filter_fields"].append("content"),
    lambda value: value.update(no_content_indexing=False),
    lambda value: value.update(authorization_precedes_query_cache_and_runtime=False),
])
def test_long_conversation_navigation_drift_fails_closed(mutation) -> None:
    contract = json.loads(json.dumps(smoke.LONG_CONVERSATION_NAVIGATION))
    mutation(contract)
    with pytest.raises(smoke.SmokeFailure, match="long conversation navigation"):
        smoke.validate_long_conversation_navigation({
            "x-long-conversation-navigation": contract,
        })


def test_capacity_backpressure_accepts_exact_content_free_contract() -> None:
    smoke.validate_capacity_backpressure({
        "x-capacity-backpressure": json.loads(json.dumps(smoke.CAPACITY_BACKPRESSURE)),
    })


@pytest.mark.parametrize("mutation", [
    lambda value: value["layers"]["sse_subscriber_queue"].update(capacity=0),
    lambda value: value["layers"]["push_outbox"].update(ttl_seconds=None),
    lambda value: value["recovery"].update(cursor_expired="retry_forever"),
    lambda value: value["push_retry"].update(busy_loop=True),
    lambda value: value["observability"]["labels"].append("runtime_id"),
    lambda value: value.update(authorization_precedes_state_access=False),
])
def test_capacity_backpressure_drift_fails_closed(mutation) -> None:
    contract = json.loads(json.dumps(smoke.CAPACITY_BACKPRESSURE))
    mutation(contract)
    with pytest.raises(smoke.SmokeFailure, match="capacity backpressure"):
        smoke.validate_capacity_backpressure({"x-capacity-backpressure": contract})


def test_authoritative_hash_is_derived_and_bound_to_relay_schema() -> None:
    expected = hashlib.sha256(smoke.OAEP_SCHEMA.read_bytes()).hexdigest()
    relay = json.loads(smoke.RELAY_SCHEMA.read_text(encoding="utf-8"))
    assert smoke.authoritative_schema_hash() == expected
    assert relay["x-oaep-schema-sha256"] == expected
    assert smoke.validate_schema_hash(_openapi(expected)) == expected


def test_stale_public_or_local_hash_fails_closed(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    expected = smoke.authoritative_schema_hash()
    with pytest.raises(smoke.SmokeFailure, match="OpenAPI (root )?schema hash drift"):
        smoke.validate_schema_hash(_openapi("0" * 64), expected)

    relay = tmp_path / "relay.json"
    relay.write_text(json.dumps({"x-oaep-schema-sha256": "0" * 64}), encoding="utf-8")
    monkeypatch.setattr(smoke, "RELAY_SCHEMA", relay)
    with pytest.raises(smoke.SmokeFailure, match="local OAEP and Relay schema hashes drift"):
        smoke.authoritative_schema_hash()


def latency_openapi() -> dict:
    paths = {
        smoke.LATENCY_OBSERVATION_PATH: {"get": {}, "post": {}},
        smoke.LATENCY_METRICS_PATH: {"get": {}},
        smoke.USER_SLO_METRICS_PATH: {"get": {}},
    }
    schemas = {
        "LatencyObservationRequest": {
            "additionalProperties": False,
            "required": ["client_receive_at_ms", "render_at_ms"],
            "properties": {
                "client_receive_at_ms": {"type": "integer"},
                "render_at_ms": {"type": "integer"},
            },
        },
        "LatencyObservationResponse": {"properties": {}},
        "LatencyPercentiles": {"additionalProperties": False},
        "LatencyReportResponse": {
            "additionalProperties": False,
            "required": [
                "schema_version", "retention_days", "sample_limit",
                "minimum_complete_samples", "sample_count", "complete_count",
                "incomplete_count", "invalid_count", "worker_count",
                "multi_worker_ready", "stages",
            ],
            "properties": {name: {} for name in {
                "schema_version", "retention_days", "sample_limit",
                "minimum_complete_samples", "sample_count", "complete_count",
                "incomplete_count", "invalid_count", "worker_count",
                "multi_worker_ready", "stages", "p50_ms", "p95_ms", "bottleneck_stage",
            }},
        },
        "UserSloObservationResponse": {"additionalProperties": False},
        "UserSloJourneyResponse": {"additionalProperties": False},
        "UserSloJourneysResponse": {
            "additionalProperties": False,
            "required": list(smoke.USER_SLO["journeys"]),
            "properties": {name: {} for name in smoke.USER_SLO["journeys"]},
        },
        "UserSloReportResponse": {
            "additionalProperties": False,
            "required": ["schema_version", "minimum_complete_samples", "ready", "journeys"],
            "properties": {},
        },
    }
    for _, (path, schema_name, fields) in smoke.USER_SLO_PATHS.items():
        paths[path] = {"post": {"requestBody": {"content": {"application/json": {
            "schema": {"$ref": f"#/components/schemas/{schema_name}"},
        }}}}}
        schemas[schema_name] = {
            "additionalProperties": False,
            "required": list(fields),
            "properties": {name: {} for name in fields},
        }
    return {
        "x-relay-latency-observability": smoke.RELAY_LATENCY_OBSERVABILITY,
        "x-user-slo": smoke.USER_SLO,
        "paths": {
            **paths,
        },
        "components": {"schemas": schemas},
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
        "multi_worker_ready"
    ),
    lambda value: value.update(**{"x-user-slo": {}}),
    lambda value: value["paths"].pop(smoke.USER_SLO_METRICS_PATH),
    lambda value: value["components"]["schemas"]["FirstScreenObservationRequest"][
        "required"
    ].pop(),
])
def test_latency_contract_drift_fails_closed(mutation) -> None:
    value = latency_openapi()
    mutation(value)
    with pytest.raises(smoke.SmokeFailure, match="latency|SLO"):
        smoke.validate_latency_contract(value)
        smoke.validate_latency_extensions(value)
