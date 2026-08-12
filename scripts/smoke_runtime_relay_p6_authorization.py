#!/usr/bin/env python3
"""Read-only public smoke for P6 association authorization semantics."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from urllib.request import Request, urlopen


EXPECTED = {
    "actions": ["read", "send", "approve", "files"],
    "workspace_scopes": ["all", "selected"],
    "authorization_precedes_body_validation": True,
    "push_requires_read_and_workspace_allowlist": True,
    "scope_shrink_immediate": True,
}


def audit(health_raw: bytes, openapi_raw: bytes, relay_origin: str) -> dict[str, Any]:
    try:
        health = json.loads(health_raw)
        openapi = json.loads(openapi_raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("p6_authorization_public_json_invalid") from exc
    if not isinstance(health, dict) or not isinstance(openapi, dict):
        raise ValueError("p6_authorization_public_shape_invalid")
    extension = openapi.get("x-association-authorization")
    checks = {
        "health_object_nonempty": bool(health),
        "extension_exact": extension == EXPECTED,
        "openapi_3_1": str(openapi.get("openapi", "")).startswith("3.1."),
        "service_version_present": bool(openapi.get("info", {}).get("version")),
    }
    failed = sorted(name for name, passed in checks.items() if not passed)
    return {
        "schema_version": "p6-association-authorization-public-audit/1",
        "observed_at": datetime.now(timezone.utc).isoformat(),
        "relay_origin": relay_origin.rstrip("/"),
        "service_version": openapi.get("info", {}).get("version"),
        "health_sha256": hashlib.sha256(health_raw).hexdigest(),
        "openapi_sha256": hashlib.sha256(openapi_raw).hexdigest(),
        "authorization_contract": extension if extension == EXPECTED else None,
        "checks": checks,
        "failed_requirements": failed,
        "mutation_performed": False,
        "passed": not failed,
    }


def _get(url: str) -> bytes:
    request = Request(url, headers={"User-Agent": "OpenDrSai-P6-Authorization-Audit/1"})
    with urlopen(request, timeout=20) as response:
        if response.status != 200:
            raise RuntimeError(f"p6_authorization_public_http_{response.status}")
        return response.read()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--relay-origin", default="https://ai-dev.ihep.ac.cn/api/runtime-relay")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(argv)
    parsed = urlparse(args.relay_origin)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password \
            or parsed.query or parsed.fragment:
        raise SystemExit("p6_authorization_public_origin_invalid")
    origin = args.relay_origin.rstrip("/")
    report = audit(_get(origin + "/v2/health"), _get(origin + "/v2/openapi.json"), origin)
    encoded = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if args.output is not None:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded, encoding="utf-8")
    print(json.dumps(
        {"failed_requirements": report["failed_requirements"], "passed": report["passed"]},
        sort_keys=True,
        separators=(",", ":"),
    ))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
