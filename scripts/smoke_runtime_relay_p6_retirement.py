#!/usr/bin/env python3
"""Read-only public smoke for the P6 Runtime compatibility retirement gate."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from urllib.request import Request, urlopen


REQUIRED_PATH_SUFFIXES = {
    "/health", "/push/readiness", "/metrics/protocol-usage/deletion-decision",
    "/metrics/relay-latency",
}
REQUIRED_FIELDS = {"supported_runtime_count", "supported_runtime_requires_legacy"}


def _contains_path(paths: set[str], suffix: str) -> bool:
    return any(path == suffix or path.endswith(suffix) for path in paths)


def audit(health_raw: bytes, openapi_raw: bytes, relay_origin: str) -> dict[str, Any]:
    try:
        health = json.loads(health_raw)
        openapi = json.loads(openapi_raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("p6_public_contract_json_invalid") from exc
    if not isinstance(health, dict) or not isinstance(openapi, dict):
        raise ValueError("p6_public_contract_shape_invalid")
    paths_value = openapi.get("paths")
    if not isinstance(paths_value, dict):
        raise ValueError("p6_public_contract_paths_invalid")
    paths = set(paths_value)
    encoded = json.dumps(openapi, sort_keys=True, separators=(",", ":"))
    checks = {suffix.removeprefix("/").replace("/", "_"): _contains_path(paths, suffix)
              for suffix in sorted(REQUIRED_PATH_SUFFIXES)}
    checks.update({field: f'"{field}"' in encoded for field in sorted(REQUIRED_FIELDS)})
    failed = sorted(key for key, passed in checks.items() if not passed)
    return {
        "schema_version": "p6-public-contract-audit/1",
        "observed_at": datetime.now(timezone.utc).isoformat(),
        "relay_origin": relay_origin.rstrip("/"),
        "openapi_version": openapi.get("openapi"),
        "service_title": openapi.get("info", {}).get("title"),
        "service_version": openapi.get("info", {}).get("version"),
        "path_count": len(paths),
        "health_sha256": hashlib.sha256(health_raw).hexdigest(),
        "openapi_sha256": hashlib.sha256(openapi_raw).hexdigest(),
        "checks": checks,
        "failed_requirements": failed,
        "mutation_performed": False,
        "passed": not failed,
    }


def _get(url: str) -> bytes:
    request = Request(url, headers={"User-Agent": "OpenDrSai-P6-Contract-Audit/1"})
    with urlopen(request, timeout=20) as response:
        if response.status != 200:
            raise RuntimeError(f"p6_public_contract_http_{response.status}")
        return response.read()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--relay-origin", default="https://ai-dev.ihep.ac.cn/api/runtime-relay")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(argv)
    parsed = urlparse(args.relay_origin)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password \
            or parsed.query or parsed.fragment:
        raise SystemExit("p6_public_contract_origin_invalid")
    origin = args.relay_origin.rstrip("/")
    report = audit(_get(origin + "/v2/health"), _get(origin + "/v2/openapi.json"), origin)
    encoded = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if args.output is not None:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded, encoding="utf-8")
    print(json.dumps({"failed_requirements": report["failed_requirements"],
                      "passed": report["passed"]}, sort_keys=True, separators=(",", ":")))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
