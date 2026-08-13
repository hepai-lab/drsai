"""Read-only public OAEP contract smoke for the production Runtime Relay."""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import time
from pathlib import Path
from typing import Any

import aiohttp


DEFAULT_BASE_URL = "https://ai-dev.ihep.ac.cn/api/runtime-relay"
OAEP_PATHS = {
    "/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/oaep-snapshot",
    "/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/oaep-events",
    "/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/oaep-events/stream",
}
OAEP_SCHEMA_NAMES = {"OaepSnapshot", "OaepEventPage", "OaepEvent"}
LATENCY_OBSERVATION_PATH = (
    "/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/"
    "events/{event_id}/latency-observation"
)
LATENCY_METRICS_PATH = "/metrics/relay-latency"
USER_SLO_METRICS_PATH = "/metrics/user-slo"
USER_SLO_PATHS = {
    "first_screen": (
        "/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/"
        "slo/first-screen/{sample_id}",
        "FirstScreenObservationRequest",
        {"cache_load_at_ms", "authority_refresh_at_ms", "first_render_at_ms"},
    ),
    "operation_confirmation": (
        "/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/"
        "slo/operation-confirmation/{sample_id}",
        "OperationConfirmationObservationRequest",
        {"request_dispatch_at_ms", "runtime_commit_at_ms", "confirmation_render_at_ms"},
    ),
    "reconnect": (
        "/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/"
        "slo/reconnect/{sample_id}",
        "ReconnectObservationRequest",
        {"disconnect_detect_at_ms", "transport_restore_at_ms", "replay_catchup_at_ms"},
    ),
}
LATENCY_SCHEMA_NAMES = {
    "LatencyObservationRequest", "LatencyObservationResponse", "LatencyPercentiles",
    "LatencyReportResponse", "FirstScreenObservationRequest",
    "OperationConfirmationObservationRequest", "ReconnectObservationRequest",
    "UserSloObservationResponse", "UserSloJourneyResponse", "UserSloJourneysResponse",
    "UserSloReportResponse",
}
ROOT = Path(__file__).parents[1]
OAEP_SCHEMA = ROOT / "cores/protocol/oaep/oaep.schema.json"
RELAY_SCHEMA = ROOT / "cores/protocol/relay/runtime-relay.schema.json"
OAEP_CONVERSATION_CONSISTENCY = {
    "protocol": "oaep/1",
    "snapshot_cursor_field": "snapshot_sequence",
    "cursor_semantics": "exclusive",
    "replay_before_live": True,
    "sequence_strictly_increasing": True,
    "event_id_deduplicated": True,
    "sequence_collision_fail_closed": True,
    "cursor_expired_status": 409,
    "snapshot_refresh_after_cursor_expired": True,
    "cross_worker_fanout": True,
    "generation_fenced": True,
    "authorization_before_side_effects": True,
    "replay_scope_fields": ["runtime_id", "workspace_id", "session_id", "generation"],
}
LONG_CONVERSATION_NAVIGATION = {
    "protocol": "oaep/1",
    "pagination": "keyset",
    "checkpoint": "snapshot.checkpoint",
    "anchor_stable": True,
    "search_scope": "client_local_only",
    "local_filter_fields": ["unread", "kind", "role", "run", "status"],
    "bounded_memory": True,
    "snapshot_page_limit": 500,
    "replay_retention": 10_000,
    "subscriber_queue_limit": 256,
    "no_content_indexing": True,
    "authorization_precedes_query_cache_and_runtime": True,
}
CAPACITY_BACKPRESSURE = {
    "version": "p6-capacity-backpressure/1",
    "layers": {
        "run_event_replay": {"capacity": 2_000, "ttl_seconds": 86_400},
        "session_event_replay": {"capacity": 2_000, "ttl_seconds": 86_400},
        "oaep_event_replay": {"capacity": 10_000, "ttl_seconds": 86_400},
        "workspace_catalog_replay": {"capacity": 10_000, "ttl_seconds": 86_400},
        "sse_subscriber_queue": {"capacity": 256, "ttl_seconds": None},
        "push_outbox": {"capacity": 10_000, "ttl_seconds": 604_800},
        "push_dead_letter": {"capacity": 10_000, "ttl_seconds": 604_800},
    },
    "recovery": {
        "overflow": "content_free_gap_then_snapshot",
        "gap": "snapshot_then_exclusive_cursor_replay",
        "cursor_expired": "http_409_then_snapshot",
        "generation_change": "fence_old_owner_then_snapshot",
    },
    "terminal_approval_authority": "persistent_sql",
    "terminal_approval_never_depends_on_notification_delivery": True,
    "push_retry": {
        "lease_seconds": 30,
        "max_attempts": 8,
        "max_backoff_seconds": 300,
        "busy_loop": False,
    },
    "authorization_precedes_state_access": True,
    "observability": {"labels": ["stage", "outcome"], "content_free": True},
}
RELAY_LATENCY_OBSERVABILITY = {
    "schema_version": "p6-relay-latency/1",
    "stages": [
        "runtime_receive", "runtime_commit", "relay_fanout", "android_receive", "android_render",
    ],
    "correlation_key": "sha256(runtime_id\\0workspace_id\\0session_id\\0event_id)",
    "retention_days": 30,
    "sample_limit": 100_000,
    "minimum_complete_correlations": 20,
    "minimum_worker_count": 2,
    "multi_worker_ready_requires": ["complete_correlations", "worker_count"],
    "failure_modes": ["missing_stage", "single_worker", "duplicate_conflict", "out_of_order"],
    "worker_identity": "internal_sha256_only",
    "public_worker_dimension": "worker_count",
    "persistent_layers": ["redis", "postgresql"],
    "authorization_precedes_body_and_storage": True,
    "content_free": True,
}
USER_SLO = {
    "schema_version": "p6-user-slo/1",
    "minimum_complete_samples": 20,
    "journeys": {
        "first_screen": {
            "stages": ["cache_load", "authority_refresh", "first_render"],
            "threshold_ms": 2_000,
        },
        "event_to_render": {
            "stages": [
                "runtime_receive", "runtime_commit", "relay_fanout", "android_receive",
                "android_render",
            ],
            "threshold_ms": 1_000,
        },
        "operation_confirmation": {
            "stages": ["request_dispatch", "runtime_commit", "confirmation_render"],
            "threshold_ms": 2_000,
        },
        "reconnect": {
            "stages": ["disconnect_detect", "transport_restore", "replay_catchup"],
            "threshold_ms": 30_000,
        },
    },
    "readiness": "each_journey_complete_samples_gte_20",
    "bottleneck": "highest_stage_p95_ms",
    "scope_hash": "sha256",
    "identity_dimensions": [],
    "authorization_precedes_body_and_storage": True,
    "content_free": True,
}


class SmokeFailure(RuntimeError):
    pass


def error_code(value: Any) -> str | None:
    if not isinstance(value, dict):
        return None
    detail = value.get("detail", value)
    return detail.get("code") if isinstance(detail, dict) and isinstance(detail.get("code"), str) else None


def authoritative_schema_hash() -> str:
    try:
        raw = OAEP_SCHEMA.read_bytes()
        relay = json.loads(RELAY_SCHEMA.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise SmokeFailure("local OAEP contract is unavailable") from exc
    digest = hashlib.sha256(raw).hexdigest()
    if relay.get("x-oaep-schema-sha256") != digest:
        raise SmokeFailure("local OAEP and Relay schema hashes drift")
    return digest


def validate_schema_hash(openapi: dict[str, Any], expected_hash: str | None = None) -> str:
    expected = expected_hash or authoritative_schema_hash()
    if openapi.get("x-oaep-schema-sha256") != expected:
        raise SmokeFailure("OAEP OpenAPI root schema hash drift")
    hashes = {
        openapi.get("paths", {}).get(path, {}).get("get", {}).get("x-oaep-schema-sha256")
        for path in OAEP_PATHS
    }
    if hashes != {expected}:
        raise SmokeFailure("OAEP OpenAPI schema hash drift")
    return expected


def validate_conversation_consistency(openapi: dict[str, Any]) -> None:
    if openapi.get("x-oaep-conversation-consistency") != OAEP_CONVERSATION_CONSISTENCY:
        raise SmokeFailure("OAEP conversation consistency contract drift")


def validate_long_conversation_navigation(openapi: dict[str, Any]) -> None:
    if openapi.get("x-long-conversation-navigation") != LONG_CONVERSATION_NAVIGATION:
        raise SmokeFailure("long conversation navigation contract drift")


def validate_capacity_backpressure(openapi: dict[str, Any]) -> None:
    if openapi.get("x-capacity-backpressure") != CAPACITY_BACKPRESSURE:
        raise SmokeFailure("capacity backpressure contract drift")


def validate_latency_contract(openapi: dict[str, Any]) -> None:
    paths = openapi.get("paths", {})
    schemas = openapi.get("components", {}).get("schemas", {})
    observation = paths.get(LATENCY_OBSERVATION_PATH, {})
    metrics = paths.get(LATENCY_METRICS_PATH, {})
    slo_metrics = paths.get(USER_SLO_METRICS_PATH, {})
    if set(observation) < {"get", "post"} or "get" not in metrics or "get" not in slo_metrics:
        raise SmokeFailure("latency OpenAPI paths drift")
    if not LATENCY_SCHEMA_NAMES.issubset(schemas):
        raise SmokeFailure("latency OpenAPI schemas drift")
    request = schemas["LatencyObservationRequest"]
    if request.get("additionalProperties") is not False \
            or set(request.get("required", [])) != {"client_receive_at_ms", "render_at_ms"} \
            or set(request.get("properties", {})) != {"client_receive_at_ms", "render_at_ms"}:
        raise SmokeFailure("latency observation request drift")
    report = schemas["LatencyReportResponse"]
    expected_latency_fields = {
        "schema_version", "retention_days", "sample_limit", "minimum_complete_samples",
        "sample_count", "complete_count", "incomplete_count", "invalid_count", "worker_count",
        "multi_worker_ready", "stages", "p50_ms", "p95_ms", "bottleneck_stage",
    }
    if report.get("additionalProperties") is not False \
            or set(report.get("properties", {})) != expected_latency_fields \
            or set(report.get("required", [])) != expected_latency_fields - {
                "p50_ms", "p95_ms", "bottleneck_stage",
            }:
        raise SmokeFailure("latency report response drift")
    for _, (path, schema_name, fields) in USER_SLO_PATHS.items():
        operation = paths.get(path, {}).get("post", {})
        request_ref = operation.get("requestBody", {}).get("content", {}).get(
            "application/json", {}
        ).get("schema", {}).get("$ref")
        if request_ref != f"#/components/schemas/{schema_name}":
            raise SmokeFailure("user SLO OpenAPI path drift")
        request_schema = schemas[schema_name]
        if request_schema.get("additionalProperties") is not False \
                or set(request_schema.get("properties", {})) != fields \
                or set(request_schema.get("required", [])) != fields:
            raise SmokeFailure("user SLO request schema drift")
    journeys = schemas["UserSloJourneysResponse"]
    if journeys.get("additionalProperties") is not False \
            or set(journeys.get("properties", {})) != set(USER_SLO["journeys"]) \
            or set(journeys.get("required", [])) != set(USER_SLO["journeys"]):
        raise SmokeFailure("user SLO journey response drift")
    slo_report = schemas["UserSloReportResponse"]
    if slo_report.get("additionalProperties") is not False \
            or set(slo_report.get("required", [])) != {
                "schema_version", "minimum_complete_samples", "ready", "journeys",
            }:
        raise SmokeFailure("user SLO report response drift")


def validate_latency_extensions(openapi: dict[str, Any]) -> None:
    if openapi.get("x-relay-latency-observability") != RELAY_LATENCY_OBSERVABILITY:
        raise SmokeFailure("relay latency observability extension drift")
    if openapi.get("x-user-slo") != USER_SLO:
        raise SmokeFailure("user SLO extension drift")


async def request_json(
    session: aiohttp.ClientSession,
    url: str,
    expected_status: int,
    method: str = "GET",
    body: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], int]:
    started = time.perf_counter()
    async with session.request(method, url, json=body) as response:
        body = await response.text()
        latency = round((time.perf_counter() - started) * 1000)
        if response.status != expected_status:
            raise SmokeFailure(f"GET endpoint returned HTTP {response.status}; expected {expected_status}")
        try:
            value = json.loads(body)
        except json.JSONDecodeError as exc:
            raise SmokeFailure("endpoint did not return JSON") from exc
        if not isinstance(value, dict):
            raise SmokeFailure("endpoint did not return a JSON object")
        return value, latency


async def run(base_url: str, timeout_seconds: float = 20) -> dict[str, Any]:
    base_url = base_url.rstrip("/")
    checks: list[dict[str, Any]] = []
    timeout = aiohttp.ClientTimeout(total=timeout_seconds)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        health, latency = await request_json(session, f"{base_url}/v2/health", 200)
        checks.append({"name": "health", "status": "passed", "latency_ms": latency})
        openapi, latency = await request_json(session, f"{base_url}/v2/openapi.json", 200)
        paths = set(openapi.get("paths", {}))
        schemas = set(openapi.get("components", {}).get("schemas", {}))
        missing_paths = sorted(OAEP_PATHS - paths)
        missing_schemas = sorted(OAEP_SCHEMA_NAMES - schemas)
        if missing_paths or missing_schemas:
            raise SmokeFailure(
                "OAEP OpenAPI contract missing; paths=" + ",".join(missing_paths)
                + ";schemas=" + ",".join(missing_schemas)
            )
        schema_hash = validate_schema_hash(openapi)
        validate_conversation_consistency(openapi)
        validate_long_conversation_navigation(openapi)
        validate_capacity_backpressure(openapi)
        validate_latency_contract(openapi)
        validate_latency_extensions(openapi)
        canonical = json.dumps(
            {"paths": {name: openapi["paths"][name] for name in sorted(OAEP_PATHS)},
             "schemas": {name: openapi["components"]["schemas"][name] for name in sorted(OAEP_SCHEMA_NAMES)}},
            ensure_ascii=False, sort_keys=True, separators=(",", ":"),
        ).encode()
        openapi_contract_hash = hashlib.sha256(canonical).hexdigest()
        checks.append({
            "name": "oaep_openapi",
            "status": "passed",
            "latency_ms": latency,
            "schema_hash": schema_hash,
            "openapi_contract_hash": openapi_contract_hash,
        })
        checks.append({
            "name": "latency_openapi",
            "status": "passed",
            "latency_ms": latency,
        })
        checks.append({
            "name": "user_slo_openapi",
            "status": "passed",
            "latency_ms": latency,
        })
        checks.append({
            "name": "conversation_consistency_openapi",
            "status": "passed",
            "latency_ms": latency,
        })
        checks.append({
            "name": "long_conversation_navigation_openapi",
            "status": "passed",
            "latency_ms": latency,
        })
        checks.append({
            "name": "capacity_backpressure_openapi",
            "status": "passed",
            "latency_ms": latency,
        })
        for name, path in (
            ("snapshot_anonymous_401", next(value for value in OAEP_PATHS if value.endswith("oaep-snapshot"))),
            ("events_anonymous_401", next(value for value in OAEP_PATHS if value.endswith("oaep-events"))),
            ("stream_anonymous_401", next(value for value in OAEP_PATHS if value.endswith("oaep-events/stream"))),
        ):
            concrete = path.format(runtime_id="runtime-public-smoke", workspace_id="workspace-public-smoke", session_id="session-public-smoke")
            payload, latency = await request_json(session, f"{base_url}/v2{concrete}", 401)
            if error_code(payload) != "invalid_token":
                raise SmokeFailure(f"{name} did not return invalid_token")
            checks.append({"name": name, "status": "passed", "latency_ms": latency})
        for journey, (path, _, _) in USER_SLO_PATHS.items():
            concrete = path.format(
                runtime_id="runtime-public-smoke",
                workspace_id="workspace-public-smoke",
                session_id="session-public-smoke",
                sample_id="sample-public-smoke",
            )
            payload, latency = await request_json(
                session, f"{base_url}/v2{concrete}", 401, method="POST", body={},
            )
            if error_code(payload) != "invalid_token":
                raise SmokeFailure(f"{journey} anonymous request did not return invalid_token")
            checks.append({
                "name": f"{journey}_anonymous_malformed_401",
                "status": "passed",
                "latency_ms": latency,
            })
        payload, latency = await request_json(
            session, f"{base_url}/v2{USER_SLO_METRICS_PATH}", 401,
        )
        if error_code(payload) != "invalid_token":
            raise SmokeFailure("user SLO metrics did not return invalid_token")
        checks.append({
            "name": "user_slo_metrics_anonymous_401",
            "status": "passed",
            "latency_ms": latency,
        })
        latency_concrete = LATENCY_OBSERVATION_PATH.format(
            runtime_id="runtime-public-smoke",
            workspace_id="workspace-public-smoke",
            session_id="session-public-smoke",
            event_id="event-public-smoke",
        )
        for name, path in (
            ("latency_observation_anonymous_401", latency_concrete),
            ("latency_metrics_anonymous_401", LATENCY_METRICS_PATH),
        ):
            payload, latency = await request_json(session, f"{base_url}/v2{path}", 401)
            if error_code(payload) != "invalid_token":
                raise SmokeFailure(f"{name} did not return invalid_token")
            checks.append({"name": name, "status": "passed", "latency_ms": latency})
    return {
        "schema_version": 1,
        "environment": "ai-dev.ihep.ac.cn",
        "protocol": "oaep/1",
        "schema_hash": schema_hash,
        "passed": True,
        "checks": checks,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    try:
        report = asyncio.run(run(args.base_url))
    except (SmokeFailure, aiohttp.ClientError, asyncio.TimeoutError) as exc:
        report = {
            "schema_version": 1,
            "environment": "ai-dev.ihep.ac.cn",
            "protocol": "oaep/1",
            "passed": False,
            "error": {"code": "oaep_public_contract_failed", "message": str(exc)},
        }
    encoded = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded + "\n", encoding="utf-8")
    print(encoded)
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
