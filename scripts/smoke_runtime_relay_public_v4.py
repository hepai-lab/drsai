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
OAEP_SCHEMA_SHA256 = "c502943a3c0c582aba71d9495abe148738a9ff62aa119359e305f74d04950277"


class SmokeFailure(RuntimeError):
    pass


def error_code(value: Any) -> str | None:
    if not isinstance(value, dict):
        return None
    detail = value.get("detail", value)
    return detail.get("code") if isinstance(detail, dict) and isinstance(detail.get("code"), str) else None


def validate_schema_hash(openapi: dict[str, Any]) -> str:
    hashes = {
        openapi.get("paths", {}).get(path, {}).get("get", {}).get("x-oaep-schema-sha256")
        for path in OAEP_PATHS
    }
    if hashes != {OAEP_SCHEMA_SHA256}:
        raise SmokeFailure("OAEP OpenAPI schema hash drift")
    return OAEP_SCHEMA_SHA256


async def request_json(
    session: aiohttp.ClientSession, url: str, expected_status: int
) -> tuple[dict[str, Any], int]:
    started = time.perf_counter()
    async with session.get(url) as response:
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
