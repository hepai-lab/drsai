"""Run deterministic local or opt-in real model Provider compatibility matrices."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import platform
import sys
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit


REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "cores" / "python" / "packages" / "drsai" / "src"))

from drsai.config.probe import ProviderDraft, probe_provider_draft  # noqa: E402


@dataclass(frozen=True)
class MatrixCase:
    service_type: str
    name: str
    base_url: str
    model: str
    wire_api: Literal["openai", "anthropic"]
    requires_api_key: bool
    api_key: str | None
    modes: tuple[Literal["basic", "model"], ...] = ("basic", "model")
    expected_errors: tuple[str | None, ...] = (None, None)


SERVICE_TYPES = ("openai", "anthropic", "deepseek", "ollama", "chat_only", "custom_proxy")


def main() -> int:
    parser = argparse.ArgumentParser()
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--local", action="store_true", help="run deterministic loopback services")
    source.add_argument("--real-env", action="store_true", help="read real Provider settings from DRSAI_MATRIX_* environment variables")
    parser.add_argument("--require-all", action="store_true", help="fail unless all required real service types are configured and pass")
    parser.add_argument("--preflight", action="store_true", help="validate real Provider environment variables without sending network requests")
    parser.add_argument(
        "--service-type",
        action="append",
        choices=SERVICE_TYPES,
        help="limit a real-environment preflight or run to one or more service types; repeat the option",
    )
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    if args.preflight and not args.real_env:
        parser.error("--preflight requires --real-env")
    if args.service_type and not args.real_env:
        parser.error("--service-type requires --real-env")

    required_service_types = tuple(dict.fromkeys(args.service_type or SERVICE_TYPES))

    server: ThreadingHTTPServer | None = None
    if args.local:
        for name in ("NO_PROXY", "no_proxy"):
            values = [value.strip() for value in os.environ.get(name, "").split(",") if value.strip()]
            os.environ[name] = ",".join(dict.fromkeys([*values, "127.0.0.1", "localhost"]))
        server = ThreadingHTTPServer(("127.0.0.1", 0), _LocalMatrixHandler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        cases = local_cases(server.server_address[1])
        matrix_kind = "local-deterministic"
    else:
        configuration_status = real_env_configuration_status(required_service_types)
        configured_status_types = {row["serviceType"] for row in configuration_status if row["configured"]}
        cases = [
            case for case in real_env_cases()
            if case.service_type in required_service_types and case.service_type in configured_status_types
        ]
        matrix_kind = "real-opt-in" if required_service_types == SERVICE_TYPES else "real-opt-in-partial"

    try:
        configured = {case.service_type for case in cases}
        missing = sorted(set(required_service_types) - configured)
        if args.preflight:
            evidence = {
                "schemaVersion": 1,
                "testId": "model-provider-compatibility-preflight",
                "kind": "real-environment-preflight",
                "passed": not missing,
                "networkRequestsSent": False,
                "requiredServiceTypes": list(required_service_types),
                "configuredServiceTypes": sorted(configured),
                "missingServiceTypes": missing,
                "configuration": configuration_status,
                "generatedAt": datetime.now(timezone.utc).isoformat(),
            }
            output = args.output or REPO_ROOT / "build" / "acceptance" / "model-provider-real-preflight.json"
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            print(f"Model Provider real environment preflight: {'passed' if not missing else 'failed'}; no network requests sent; evidence: {output}")
            return 0 if not missing else 2
        if args.require_all and missing:
            print(f"Missing required real Provider matrix configuration: {', '.join(missing)}", file=sys.stderr)
            return 2
        results = asyncio.run(run_cases(cases))
        passed = bool(results) and all(row["passed"] for row in results) and (not args.require_all or not missing)
        evidence = {
            "schemaVersion": 2,
            "testId": f"model-provider-{matrix_kind}",
            "kind": matrix_kind,
            "platform": "darwin-arm64" if sys.platform == "darwin" and platform.machine() == "arm64" else f"{sys.platform}-{platform.machine()}",
            "passed": passed,
            "featureIds": ["F04.3"],
            "requiredServiceTypes": list(required_service_types),
            "configuredServiceTypes": sorted(configured),
            "missingServiceTypes": missing,
            "results": results,
            "generatedAt": datetime.now(timezone.utc).isoformat(),
        }
        serialized = json.dumps(evidence, ensure_ascii=False, indent=2)
        for case in cases:
            if case.api_key:
                assert case.api_key not in serialized, f"Secret leaked into compatibility evidence for {case.name}"
        output = args.output or REPO_ROOT / "build" / "acceptance" / f"model-provider-{matrix_kind}.json"
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(serialized + "\n", encoding="utf-8")
        print(f"Model Provider {matrix_kind} matrix: {len(results)} probes, {'passed' if passed else 'failed'}; evidence: {output}")
        return 0 if passed else 1
    finally:
        if server:
            server.shutdown()
            server.server_close()


async def run_cases(cases: list[MatrixCase]) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for case in cases:
        assert len(case.modes) == len(case.expected_errors)
        for mode, expected_error in zip(case.modes, case.expected_errors, strict=True):
            result = await probe_provider_draft(
                ProviderDraft(
                    name=case.name,
                    base_url=case.base_url,
                    model=case.model,
                    wire_api=case.wire_api,
                    requires_api_key=case.requires_api_key,
                    api_key=case.api_key,
                ),
                mode=mode,
                timeout=8.0,
            )
            actual_error = result.get("error") if isinstance(result.get("error"), str) else None
            passed = bool(result.get("ok")) if expected_error is None else actual_error == expected_error
            rows.append({
                "serviceType": case.service_type,
                "provider": case.name,
                "mode": mode,
                "passed": passed,
                "ok": bool(result.get("ok")),
                "error": actual_error,
                "statusCode": result.get("status_code") if isinstance(result.get("status_code"), int) else None,
                "durationMs": result.get("duration_ms") if isinstance(result.get("duration_ms"), int) else None,
                "mayIncurCost": bool(result.get("may_incur_cost")),
            })
    return rows


def local_cases(port: int) -> list[MatrixCase]:
    root = f"http://127.0.0.1:{port}"
    return [
        MatrixCase("openai", "matrix-openai", f"{root}/openai/v1", "gpt-test", "openai", True, "local-openai-secret"),
        MatrixCase("anthropic", "matrix-anthropic", f"{root}/anthropic/v1", "claude-test", "anthropic", True, "local-anthropic-secret"),
        MatrixCase("deepseek", "matrix-deepseek", f"{root}/deepseek/v1", "deepseek-test", "openai", True, "local-deepseek-secret"),
        MatrixCase("ollama", "matrix-ollama", f"{root}/ollama/v1", "ollama-test", "openai", False, None),
        MatrixCase("chat_only", "matrix-chat-only", f"{root}/chat-only/v1", "chat-only-test", "openai", False, None, ("basic", "model"), ("endpoint_not_found", None)),
        MatrixCase("custom_proxy", "matrix-proxy", f"{root}/proxy/gateway/v1", "proxy-test", "openai", True, "local-proxy-secret"),
        MatrixCase("openai", "matrix-auth-error", f"{root}/auth-error/v1", "gpt-test", "openai", True, "wrong-secret", ("basic",), ("authentication_failed",)),
        MatrixCase("openai", "matrix-rate-limit", f"{root}/rate-limit/v1", "gpt-test", "openai", True, "local-openai-secret", ("basic",), ("rate_limited",)),
        MatrixCase("openai", "matrix-model-missing", f"{root}/model-missing/v1", "gpt-test", "openai", True, "local-openai-secret", ("model",), ("model_not_found",)),
    ]


def real_env_cases() -> list[MatrixCase]:
    specs = {
        "openai": ("openai", True),
        "anthropic": ("anthropic", True),
        "deepseek": ("openai", True),
        "ollama": ("openai", False),
        "chat_only": ("openai", False),
        "custom_proxy": ("openai", True),
    }
    cases: list[MatrixCase] = []
    for service_type, (wire_api, default_requires_key) in specs.items():
        prefix = f"DRSAI_MATRIX_{service_type.upper()}"
        base_url = os.environ.get(f"{prefix}_BASE_URL", "").strip()
        model = os.environ.get(f"{prefix}_MODEL", "").strip()
        if not base_url or not model:
            continue
        requires_key = os.environ.get(f"{prefix}_REQUIRES_KEY", str(default_requires_key)).lower() in {"1", "true", "yes"}
        api_key = os.environ.get(f"{prefix}_API_KEY") if requires_key else None
        if requires_key and not api_key:
            continue
        modes: tuple[Literal["basic", "model"], ...] = ("model",) if service_type == "chat_only" else ("basic", "model")
        cases.append(MatrixCase(service_type, f"real-{service_type}", base_url, model, wire_api, requires_key, api_key, modes, tuple(None for _ in modes)))
    return cases


def real_env_configuration_status(service_types: tuple[str, ...] = SERVICE_TYPES) -> list[dict[str, object]]:
    """Return presence-only diagnostics; never expose environment values."""
    defaults = {
        "openai": True,
        "anthropic": True,
        "deepseek": True,
        "ollama": False,
        "chat_only": False,
        "custom_proxy": True,
    }
    rows: list[dict[str, object]] = []
    for service_type in service_types:
        default_requires_key = defaults[service_type]
        prefix = f"DRSAI_MATRIX_{service_type.upper()}"
        raw_requires_key = os.environ.get(f"{prefix}_REQUIRES_KEY")
        requires_key, boolean_valid = parse_optional_bool(raw_requires_key, default_requires_key)
        base_url = os.environ.get(f"{prefix}_BASE_URL", "").strip()
        model = os.environ.get(f"{prefix}_MODEL", "").strip()
        present = {
            "baseUrl": bool(base_url),
            "model": bool(model),
            "apiKey": bool(os.environ.get(f"{prefix}_API_KEY")) if requires_key else True,
        }
        issues: list[str] = []
        if not present["baseUrl"]:
            issues.append("base_url_missing")
        elif not valid_provider_base_url(base_url):
            issues.append("base_url_invalid")
        if not present["model"]:
            issues.append("model_missing")
        if not boolean_valid:
            issues.append("requires_key_invalid")
        if requires_key and not present["apiKey"]:
            issues.append("api_key_missing")
        rows.append({
            "serviceType": service_type,
            "configured": not issues,
            "requiresApiKey": requires_key,
            "present": present,
            "issues": issues,
        })
    return rows


def parse_optional_bool(value: str | None, default: bool) -> tuple[bool, bool]:
    if value is None or not value.strip():
        return default, True
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes"}:
        return True, True
    if normalized in {"0", "false", "no"}:
        return False, True
    return default, False


def valid_provider_base_url(value: str) -> bool:
    try:
        parsed = urlsplit(value)
        return (
            parsed.scheme in {"http", "https"}
            and bool(parsed.hostname)
            and parsed.username is None
            and parsed.password is None
            and not parsed.query
            and not parsed.fragment
        )
    except ValueError:
        return False


class _LocalMatrixHandler(BaseHTTPRequestHandler):
    server_version = "OpenDrSaiMatrix/1"

    def do_GET(self) -> None:  # noqa: N802
        segment = self.path.split("/")[1] if self.path.count("/") >= 2 else ""
        if segment == "chat-only":
            self._json(404, {"error": "route not found"})
            return
        if segment == "auth-error":
            self._json(401, {"error": "unauthorized"})
            return
        if segment == "rate-limit":
            self._json(429, {"error": "too many requests"})
            return
        expected_tokens = {
            "openai": "local-openai-secret",
            "deepseek": "local-deepseek-secret",
            "proxy": "local-proxy-secret",
        }
        expected = expected_tokens.get(segment)
        if expected and self.headers.get("Authorization") != f"Bearer {expected}":
            self._json(401, {"error": "unauthorized"})
            return
        if segment == "anthropic" and (self.headers.get("x-api-key") != "local-anthropic-secret" or self.headers.get("anthropic-version") != "2023-06-01"):
            self._json(401, {"error": "unauthorized"})
            return
        models = {
            "openai": "gpt-test", "anthropic": "claude-test", "deepseek": "deepseek-test",
            "ollama": "ollama-test", "proxy": "proxy-test", "model-missing": "other-model",
        }
        self._json(200, {"data": [{"id": models.get(segment, "gpt-test")}]})

    def do_POST(self) -> None:  # noqa: N802
        segment = self.path.split("/")[1] if self.path.count("/") >= 2 else ""
        length = min(int(self.headers.get("Content-Length", "0")), 16_384)
        body = json.loads(self.rfile.read(length) or b"{}")
        if segment == "model-missing":
            self._json(404, {"error": {"message": "model not found"}})
            return
        if segment == "anthropic":
            if self.headers.get("x-api-key") != "local-anthropic-secret" or self.headers.get("anthropic-version") != "2023-06-01":
                self._json(401, {"error": "unauthorized"})
                return
            assert body.get("max_tokens") == 256
            self._json(200, {"id": "minimal-completion", "content": [{"type": "text", "text": "pong"}], "stop_reason": "end_turn"})
            return
        elif segment == "chat-only":
            if self.path.endswith("/responses"):
                self._json(404, {"error": "route not found"})
                return
            assert body.get("max_tokens") == 256
        if self.path.endswith("/responses"):
            assert body.get("max_output_tokens") == 256
            self._json(200, {"id": "minimal-response", "output": [{"type": "message", "content": [{"type": "output_text", "text": "pong"}]}]})
        else:
            self._json(200, {"id": "minimal-completion", "choices": [{"message": {"content": "pong"}, "finish_reason": "stop"}]})

    def log_message(self, _format: str, *_args: object) -> None:
        return

    def _json(self, status: int, payload: object) -> None:
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    raise SystemExit(main())
