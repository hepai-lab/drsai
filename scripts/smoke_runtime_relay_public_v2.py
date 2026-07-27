"""Fail-closed public deployment smoke for the Runtime Relay V2 API.

The anonymous checks are safe to run in CI. Authenticated directory and cursor
checks are enabled only when a bearer is supplied through the environment; the
credential is never written to the report or exception text.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import aiohttp


DEFAULT_BASE_URL = "https://ai-dev.ihep.ac.cn/api/runtime-relay"
REQUIRED_OPENAPI_PATHS = {
    "/runtimes",
    "/runtimes/{runtime_id}/workspaces",
    "/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions",
    "/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/conversation-snapshot",
    "/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/events",
    "/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/events/stream",
    "/runtimes/{runtime_id}/runs/{run_id}/events/stream",
}


class SmokeFailure(RuntimeError):
    pass


@dataclass(frozen=True)
class Check:
    name: str
    status: str
    latency_ms: int
    detail: str


def error_code(payload: Any) -> str | None:
    if not isinstance(payload, dict):
        return None
    detail = payload.get("detail", payload)
    if not isinstance(detail, dict):
        return None
    value = detail.get("code")
    return value if isinstance(value, str) else None


def websocket_url(base_url: str) -> str:
    parsed = urlsplit(base_url.rstrip("/"))
    scheme = "wss" if parsed.scheme == "https" else "ws"
    query = "runtime_id=runtime-public-smoke&instance_id=instance-public-smoke&version=0"
    return urlunsplit((scheme, parsed.netloc, f"{parsed.path}/v2/runtime-connect", query, ""))


async def _json_request(
    session: aiohttp.ClientSession,
    method: str,
    url: str,
    *,
    expected_status: int,
    headers: dict[str, str] | None = None,
) -> tuple[Any, int]:
    started = time.perf_counter()
    async with session.request(method, url, headers=headers) as response:
        body = await response.text()
        latency_ms = round((time.perf_counter() - started) * 1000)
        if response.status != expected_status:
            raise SmokeFailure(
                f"{method} {url} returned HTTP {response.status}; expected {expected_status}"
            )
        try:
            return json.loads(body), latency_ms
        except json.JSONDecodeError as error:
            raise SmokeFailure(f"{method} {url} did not return JSON") from error


async def _text_request(
    session: aiohttp.ClientSession,
    method: str,
    url: str,
    *,
    expected_status: int,
) -> tuple[str, int]:
    started = time.perf_counter()
    async with session.request(method, url) as response:
        body = await response.text()
        latency_ms = round((time.perf_counter() - started) * 1000)
        if response.status != expected_status:
            raise SmokeFailure(
                f"{method} {url} returned HTTP {response.status}; expected {expected_status}"
            )
        return body, latency_ms


async def run_smoke(
    base_url: str,
    *,
    bearer: str | None = None,
    runtime_id: str | None = None,
    timeout_seconds: float = 15.0,
) -> dict[str, Any]:
    base_url = base_url.rstrip("/")
    timeout = aiohttp.ClientTimeout(total=timeout_seconds)
    checks: list[Check] = []
    async with aiohttp.ClientSession(timeout=timeout) as session:
        for name, path in (
            ("root_health", "/health"),
            ("v2_health", "/v2/health"),
        ):
            payload, latency = await _json_request(
                session, "GET", f"{base_url}{path}", expected_status=200
            )
            checks.append(Check(name, "passed", latency, "HTTP 200 JSON"))

        openapi, latency = await _json_request(
            session, "GET", f"{base_url}/v2/openapi.json", expected_status=200
        )
        if openapi.get("info", {}).get("version") != "2.0.0":
            raise SmokeFailure("V2 OpenAPI info.version drifted from 2.0.0")
        paths = set(openapi.get("paths", {}))
        missing = sorted(REQUIRED_OPENAPI_PATHS - paths)
        if missing:
            raise SmokeFailure(f"V2 OpenAPI is missing required paths: {missing}")
        checks.append(Check("v2_openapi", "passed", latency, "2.0.0 required paths present"))

        metrics, latency = await _text_request(
            session, "GET", f"{base_url}/v2/metrics", expected_status=200
        )
        required_metrics = {
            "runtime_relay_idempotency_operations",
            "runtime_relay_idempotency_duration_seconds",
        }
        missing_metrics = sorted(item for item in required_metrics if item not in metrics)
        if missing_metrics:
            raise SmokeFailure(f"V2 metrics are missing: {missing_metrics}")
        checks.append(Check("v2_metrics", "passed", latency, "idempotency metrics present"))

        for version in ("v1", "v2"):
            payload, latency = await _json_request(
                session,
                "GET",
                f"{base_url}/{version}/runtimes",
                expected_status=401,
            )
            if error_code(payload) != "invalid_token":
                raise SmokeFailure(f"{version} anonymous error envelope is not invalid_token")
            checks.append(Check(f"{version}_anonymous_401", "passed", latency, "invalid_token"))

        for name, suffix in (
            (
                "session_snapshot_anonymous_401",
                "/v2/runtimes/runtime-public-smoke/workspaces/"
                "workspace-public-smoke/sessions/session-public-smoke/"
                "conversation-snapshot",
            ),
            (
                "session_stream_anonymous_401",
                "/v2/runtimes/runtime-public-smoke/workspaces/"
                "workspace-public-smoke/sessions/session-public-smoke/"
                "events/stream",
            ),
        ):
            payload, latency = await _json_request(
                session,
                "GET",
                f"{base_url}{suffix}",
                expected_status=401,
            )
            if error_code(payload) != "invalid_token":
                raise SmokeFailure(f"{name} error envelope is not invalid_token")
            checks.append(Check(name, "passed", latency, "invalid_token"))

        started = time.perf_counter()
        try:
            await session.ws_connect(
                websocket_url(base_url),
                headers={"X-Runtime-Token": "public-smoke-invalid-token"},
            )
        except aiohttp.WSServerHandshakeError as error:
            if error.status not in {401, 403}:
                raise SmokeFailure(
                    f"WSS invalid-token handshake returned HTTP {error.status}"
                ) from error
            checks.append(
                Check(
                    "wss_auth_rejection",
                    "passed",
                    round((time.perf_counter() - started) * 1000),
                    f"HTTP {error.status}",
                )
            )
        else:
            raise SmokeFailure("WSS accepted an invalid Runtime token")

        if bearer:
            auth = {"Authorization": f"Bearer {bearer}"}
            catalog, latency = await _json_request(
                session,
                "GET",
                f"{base_url}/v2/runtimes?limit=1",
                expected_status=200,
                headers=auth,
            )
            if not isinstance(catalog.get("items"), list):
                raise SmokeFailure("authenticated Runtime catalog is not paginated")
            checks.append(Check("runtime_pagination", "passed", latency, "limit=1 envelope"))

            invalid_cursor, latency = await _json_request(
                session,
                "GET",
                f"{base_url}/v2/runtimes?limit=1&cursor=public-smoke-tampered",
                expected_status=400,
                headers=auth,
            )
            if error_code(invalid_cursor) != "invalid_cursor":
                raise SmokeFailure("tampered cursor did not return invalid_cursor")
            checks.append(Check("cursor_rejection", "passed", latency, "invalid_cursor"))

            if runtime_id:
                workspaces, latency = await _json_request(
                    session,
                    "GET",
                    f"{base_url}/v2/runtimes/{runtime_id}/workspaces?limit=1",
                    expected_status=200,
                    headers=auth,
                )
                if not isinstance(workspaces.get("items"), list):
                    raise SmokeFailure("authenticated Workspace catalog is not paginated")
                checks.append(
                    Check("workspace_pagination", "passed", latency, "limit=1 envelope")
                )
        else:
            checks.append(
                Check(
                    "authenticated_pagination",
                    "skipped",
                    0,
                    "set DRS_RUN_SMOKE_BEARER for the non-destructive authenticated gate",
                )
            )

    return {
        "schema_version": 1,
        "target": base_url,
        "authenticated": bool(bearer),
        "runtime_checked": bool(bearer and runtime_id),
        "checks": [asdict(check) for check in checks],
        "passed": all(check.status in {"passed", "skipped"} for check in checks),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--runtime-id", default=os.getenv("DRS_RUN_SMOKE_RUNTIME_ID"))
    parser.add_argument("--output", type=Path)
    parser.add_argument("--require-authenticated", action="store_true")
    args = parser.parse_args()
    bearer = os.getenv("DRS_RUN_SMOKE_BEARER")
    if args.require_authenticated and not bearer:
        raise SystemExit("DRS_RUN_SMOKE_BEARER is required")
    try:
        report = asyncio.run(
            run_smoke(args.base_url, bearer=bearer, runtime_id=args.runtime_id)
        )
    except SmokeFailure as error:
        report = {
            "schema_version": 1,
            "target": args.base_url.rstrip("/"),
            "authenticated": bool(bearer),
            "runtime_checked": bool(bearer and args.runtime_id),
            "passed": False,
            "error": {"code": "public_smoke_failed", "message": str(error)},
        }
    encoded = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded + "\n", encoding="utf-8")
    print(encoded)
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
