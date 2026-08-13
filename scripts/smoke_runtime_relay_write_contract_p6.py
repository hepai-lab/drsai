"""Read-only/anonymous production smoke for P6 generated Relay write DTOs."""
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

SESSION_COLLECTION = "/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions"
SESSION_ITEM = SESSION_COLLECTION + "/{session_id}"
RUN_COLLECTION = SESSION_ITEM + "/runs"
RUN_ITEM = "/runtimes/{runtime_id}/runs/{run_id}"
RUN_CANCEL = "/runtimes/{runtime_id}/workspaces/{workspace_id}/runs/{run_id}/cancel"
APPROVAL_DECISION = "/runtimes/{runtime_id}/approvals/{approval_id}/decision"
APPROVAL_RECOVERY = "/runtimes/{runtime_id}/idempotency/approval.decide/{idempotency_key}"
RUN_RECOVERY = "/runtimes/{runtime_id}/idempotency/run.create/{idempotency_key}"
MESSAGE_DELIVERY_RECOVERY = {
    "delivery_states": ["optimistic", "sending", "accepted", "running", "terminal"],
    "recovery_states": ["pending", "accepted", "running", "terminal", "unknown"],
    "scope_binding": ["issuer", "subject", "runtime_id", "workspace_id", "session_id"],
    "identity_binding": ["source_message_id", "idempotency_key"],
    "persistent_recovery": True,
    "runtime_lookup_before_retry": True,
    "cross_worker_single_side_effect": True,
    "authorization_precedes_body_and_ledger": True,
    "scope_shrink_immediate": True,
    "result_at_rest": "authenticated_encryption",
}
RUN_APPROVAL_RACE_CONSISTENCY = {
    "approval_terminal_states": ["approved", "denied", "cancelled", "expired"],
    "authorization_precedes_body_and_ledger": True,
    "decisions": ["approve", "deny", "cancel"],
    "generation_fencing": True,
    "mutual_exclusion": "runtime_authoritative",
    "persistent_recovery": True,
    "revision_monotonic": True,
    "run_terminal_states": ["completed", "failed", "cancelled"],
    "scope_binding": [
        "issuer", "subject", "runtime_id", "workspace_id", "session_id",
        "run_id", "approval_id", "idempotency_key", "decision",
    ],
    "single_side_effect": True,
    "single_terminal": True,
}


class SmokeFailure(RuntimeError):
    pass


def _schema_for(openapi: dict[str, Any], path: str, method: str, section: str) -> tuple[str, dict[str, Any]]:
    operation = openapi.get("paths", {}).get(path, {}).get(method, {})
    if section == "request":
        schema = (((operation.get("requestBody") or {}).get("content") or {})
                  .get("application/json", {}).get("schema"))
    else:
        success_responses = [
            response
            for status, response in (operation.get("responses") or {}).items()
            if isinstance(status, str) and len(status) == 3 and status.startswith("2")
        ]
        if len(success_responses) != 1:
            raise SmokeFailure(
                f"{method.upper()} {path} must define exactly one successful response schema"
            )
        schema = (((success_responses[0].get("content") or {})
                  .get("application/json", {}).get("schema")))
    reference = schema.get("$ref") if isinstance(schema, dict) else None
    prefix = "#/components/schemas/"
    if not isinstance(reference, str) or not reference.startswith(prefix):
        raise SmokeFailure(f"{method.upper()} {path} {section} schema ref is missing")
    name = reference.removeprefix(prefix)
    resolved = openapi.get("components", {}).get("schemas", {}).get(name)
    if not isinstance(resolved, dict):
        raise SmokeFailure(f"OpenAPI schema is missing: {name}")
    return name, resolved


def _strict_object(
    schema: dict[str, Any], *, required: set[str], properties: set[str], label: str
) -> None:
    if schema.get("type") != "object" or schema.get("additionalProperties") is not False:
        raise SmokeFailure(f"{label} is not a strict object")
    if set(schema.get("required", [])) != required:
        raise SmokeFailure(f"{label} required fields drift")
    if set(schema.get("properties", {})) != properties:
        raise SmokeFailure(f"{label} properties drift")


def validate_contract(openapi: dict[str, Any]) -> dict[str, str]:
    refs: dict[str, str] = {}
    cases = (
        ("session_create_request", SESSION_COLLECTION, "post", "request",
         {"request_id", "correlation_id", "idempotency_key", "title", "agent_definition_id", "agent_definition_version"},
         {"request_id", "correlation_id", "idempotency_key", "title", "agent_definition_id", "agent_definition_version"}),
        ("session_update_request", SESSION_ITEM, "patch", "request",
         {"request_id", "correlation_id"},
         {"request_id", "correlation_id", "title", "lifecycle"}),
        ("run_create_request", RUN_COLLECTION, "post", "request",
         {"request_id", "correlation_id", "idempotency_key", "message"},
         {"request_id", "correlation_id", "idempotency_key", "message", "source_message_id", "attachment_refs", "retry_of"}),
        ("approval_decision_request", APPROVAL_DECISION, "post", "request",
         {"request_id", "correlation_id", "decision"},
         {"request_id", "correlation_id", "idempotency_key", "decision"}),
        ("session_projection", SESSION_COLLECTION, "post", "response",
         {"runtime_id", "workspace_id", "session_id", "title", "lifecycle", "updated_at"},
         {"runtime_id", "workspace_id", "session_id", "title", "lifecycle", "updated_at",
          "agent_definition_id", "agent_definition_version", "backend_id", "last_run_status"}),
        ("run_projection", RUN_COLLECTION, "post", "response",
         {"runtime_id", "workspace_id", "session_id", "run_id", "backend_id", "status",
          "correlation_id", "created_at", "message", "attachment_refs"},
         {"runtime_id", "workspace_id", "session_id", "run_id", "backend_id", "status",
          "correlation_id", "created_at", "retry_of", "message", "attachment_refs"}),
        ("approval_projection", APPROVAL_DECISION, "post", "response",
         {"runtime_id", "workspace_id", "session_id", "run_id", "approval_id", "agent_definition_id",
          "backend_id", "operation", "risk_summary", "scope", "expires_at", "correlation_id", "status"},
         {"runtime_id", "workspace_id", "session_id", "run_id", "approval_id", "agent_definition_id",
          "backend_id", "operation", "risk_summary", "scope", "expires_at", "correlation_id", "status"}),
        ("approval_recovery", APPROVAL_RECOVERY, "get", "response",
         {"status", "operation", "resource"}, {"status", "operation", "resource"}),
    )
    for label, path, method, section, required, properties in cases:
        name, schema = _schema_for(openapi, path, method, section)
        _strict_object(schema, required=required, properties=properties, label=label)
        refs[label] = name

    recovery = openapi["components"]["schemas"][refs["approval_recovery"]]
    resource_ref = recovery["properties"]["resource"].get("$ref")
    prefix = "#/components/schemas/"
    if not isinstance(resource_ref, str) or not resource_ref.startswith(prefix):
        raise SmokeFailure("approval recovery resource ref is missing")
    resource_name = resource_ref.removeprefix(prefix)
    resource = openapi["components"]["schemas"].get(resource_name)
    if not isinstance(resource, dict):
        raise SmokeFailure("approval recovery resource schema is missing")
    _strict_object(
        resource,
        required={"runtime_id", "approval_id", "status"},
        properties={"runtime_id", "approval_id", "status"},
        label="approval_recovery_resource",
    )
    refs["approval_recovery_resource"] = resource_name
    return refs


def validate_message_delivery_recovery(openapi: dict[str, Any]) -> None:
    if openapi.get("x-message-delivery-recovery") != MESSAGE_DELIVERY_RECOVERY:
        raise SmokeFailure("message delivery recovery contract drift")
    if "get" not in openapi.get("paths", {}).get(RUN_RECOVERY, {}):
        raise SmokeFailure("message delivery recovery path drift")


def validate_run_approval_race_consistency(openapi: dict[str, Any]) -> None:
    if openapi.get("x-run-approval-race-consistency") != RUN_APPROVAL_RACE_CONSISTENCY:
        raise SmokeFailure("run approval race consistency contract drift")


async def _request(
    session: aiohttp.ClientSession,
    method: str,
    url: str,
    expected_status: int,
    body: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], int]:
    started = time.perf_counter()
    async with session.request(method, url, json=body) as response:
        raw = await response.text()
        latency = round((time.perf_counter() - started) * 1000)
        if response.status != expected_status:
            raise SmokeFailure(f"{method} endpoint returned HTTP {response.status}; expected {expected_status}")
        try:
            value = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise SmokeFailure("endpoint did not return JSON") from exc
        if not isinstance(value, dict):
            raise SmokeFailure("endpoint did not return a JSON object")
        return value, latency


def _error_code(value: dict[str, Any]) -> str | None:
    detail = value.get("detail", value)
    return detail.get("code") if isinstance(detail, dict) else None


async def run(base_url: str) -> dict[str, Any]:
    base = base_url.rstrip("/") + "/v2"
    timeout = aiohttp.ClientTimeout(total=20)
    checks: list[dict[str, Any]] = []
    async with aiohttp.ClientSession(timeout=timeout) as session:
        _, latency = await _request(session, "GET", base + "/health", 200)
        checks.append({"name": "health", "passed": True, "latency_ms": latency})
        openapi, latency = await _request(session, "GET", base + "/openapi.json", 200)
        refs = validate_contract(openapi)
        validate_message_delivery_recovery(openapi)
        validate_run_approval_race_consistency(openapi)
        canonical = json.dumps(
            {name: openapi["components"]["schemas"][schema] for name, schema in sorted(refs.items())},
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
        checks.append({
            "name": "write_openapi",
            "passed": True,
            "latency_ms": latency,
            "contract_sha256": hashlib.sha256(canonical).hexdigest(),
            "schema_count": len(refs),
        })
        values = {
            "runtime_id": "runtime-public-smoke",
            "workspace_id": "workspace-public-smoke",
            "session_id": "session-public-smoke",
            "run_id": "run-public-smoke",
            "approval_id": "approval-public-smoke",
            "idempotency_key": "idempotency-public-smoke",
        }
        valid_control = {
            "request_id": "550e8400-e29b-41d4-a716-446655440000",
            "correlation_id": "public-smoke",
        }
        anonymous = (
            ("session_create_anonymous_401", "POST", SESSION_COLLECTION,
             {**valid_control, "idempotency_key": "public-smoke-key", "title": "Public smoke",
              "agent_definition_id": "agent", "agent_definition_version": "1.0.0"}),
            ("session_update_anonymous_401", "PATCH", SESSION_ITEM,
             {**valid_control, "title": "Public smoke"}),
            ("run_create_anonymous_401", "POST", RUN_COLLECTION,
             {**valid_control, "idempotency_key": "public-smoke-key", "message": "public smoke"}),
            ("approval_decision_anonymous_401", "POST", APPROVAL_DECISION,
             {**valid_control, "decision": "deny"}),
            ("approval_recovery_anonymous_401", "GET", APPROVAL_RECOVERY, None),
            ("run_recovery_anonymous_401", "GET", RUN_RECOVERY, None),
        )
        for name, method, path, body in anonymous:
            payload, latency = await _request(session, method, base + path.format(**values), 401, body)
            if _error_code(payload) != "invalid_token":
                raise SmokeFailure(f"{name} did not fail at the authentication boundary")
            checks.append({"name": name, "passed": True, "latency_ms": latency})
    return {
        "schema_version": "p6-write-contract-public-smoke/1",
        "environment": "ai-dev.ihep.ac.cn",
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
    except (SmokeFailure, aiohttp.ClientError, asyncio.TimeoutError, KeyError) as exc:
        report = {
            "schema_version": "p6-write-contract-public-smoke/1",
            "environment": "ai-dev.ihep.ac.cn",
            "passed": False,
            "error": {"code": "p6_write_contract_public_smoke_failed", "message": str(exc)},
        }
    encoded = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded + "\n", encoding="utf-8")
    print(encoded)
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
