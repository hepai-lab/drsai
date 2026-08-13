"""Public, read-only P6 Relay error-action contract smoke."""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
from pathlib import Path
from typing import Any

import aiohttp


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BASE_URL = "https://ai-dev.ihep.ac.cn/api/runtime-relay/v2"
ACTIONS = {"retry", "login", "re-pair", "update", "contact-admin"}
FORBIDDEN_KEYS = {"message", "title", "reason", "url", "path", "token", "body", "details"}


class SmokeFailure(RuntimeError):
    pass


def canonical_actions(value: Any) -> dict[str, list[str]]:
    if not isinstance(value, dict) or set(value) != ACTIONS:
        raise SmokeFailure("relay_error_action_groups_invalid")
    result: dict[str, list[str]] = {}
    seen: set[str] = set()
    for action in sorted(ACTIONS):
        codes = value[action]
        if not isinstance(codes, list) or not codes or codes != sorted(codes):
            raise SmokeFailure("relay_error_action_codes_invalid")
        for code in codes:
            if not isinstance(code, str) or not code or code in seen:
                raise SmokeFailure("relay_error_action_codes_invalid")
            seen.add(code)
        result[action] = codes
    serialized = json.dumps(result, sort_keys=True).lower()
    if any(f'"{key}"' in serialized for key in FORBIDDEN_KEYS):
        raise SmokeFailure("relay_error_action_sensitive_field_present")
    return result


def expected_actions() -> dict[str, list[str]]:
    schema = json.loads(
        (ROOT / "cores/protocol/relay/runtime-relay.schema.json").read_text(encoding="utf-8")
    )
    return canonical_actions(schema.get("x-relay-error-actions"))


async def run(base_url: str) -> dict[str, Any]:
    timeout = aiohttp.ClientTimeout(total=20)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.get(base_url.rstrip("/") + "/health") as response:
            if response.status != 200:
                raise SmokeFailure(f"relay_health_http_{response.status}")
        async with session.get(base_url.rstrip("/") + "/openapi.json") as response:
            if response.status != 200:
                raise SmokeFailure(f"relay_openapi_http_{response.status}")
            openapi = await response.json()
    actual = canonical_actions(openapi.get("x-relay-error-actions"))
    expected = expected_actions()
    if actual != expected:
        raise SmokeFailure("relay_error_action_contract_drift")
    canonical = json.dumps(actual, sort_keys=True, separators=(",", ":")).encode()
    return {
        "schema_version": "p6-relay-error-actions-public-smoke/1",
        "environment": "ai-dev.ihep.ac.cn",
        "passed": True,
        "action_count": len(actual),
        "code_count": sum(map(len, actual.values())),
        "contract_sha256": hashlib.sha256(canonical).hexdigest(),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    try:
        report = asyncio.run(run(args.base_url))
    except (SmokeFailure, aiohttp.ClientError, asyncio.TimeoutError, json.JSONDecodeError) as failure:
        report = {
            "schema_version": "p6-relay-error-actions-public-smoke/1",
            "environment": "ai-dev.ihep.ac.cn",
            "passed": False,
            "error": {"code": "p6_relay_error_actions_public_smoke_failed", "message": str(failure)},
        }
    encoded = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded + "\n", encoding="utf-8")
    print(encoded)
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
