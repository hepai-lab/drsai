#!/usr/bin/env python3
"""Prove P5 Session Catalog convergence on one physical Android device.

The driver intentionally keeps Runtime/Workspace/Session identifiers, titles,
the gateway token, and instrumentation stdout in memory.  Its durable report is
content-free and can therefore be retained as release evidence.
"""
from __future__ import annotations

import argparse
from datetime import UTC, datetime
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
PACKAGE = "ai.drsai.remote.debug"
RUNNER = f"{PACKAGE}.test/androidx.test.runner.AndroidJUnitRunner"
TARGET_TEST = "ai.drsai.remote.RealRemoteWorkspaceE2ETest"
MONITOR_TEST = "ai.drsai.remote.P5SessionCatalogRealtimeTest"
READY_FILE = "files/p5-session-catalog-monitor-ready.json"
PROOF_PREFIXES = (
    "INSTRUMENTATION_STATUS: realDeviceProof=",
    "OPENDRSAI_REAL_DEVICE_PROOF=",
)
MONITOR_PREFIXES = (
    "INSTRUMENTATION_STATUS: p5SessionCatalogReport=",
    "P5_SESSION_CATALOG_REPORT=",
)
EXPECTED_TRANSITIONS = ["rename", "archive", "unarchive", "rollback"]
DEFAULT_OUTPUT = (
    ROOT / "release/product-evidence/mobile-remote-workspace-p5"
    / "m03-session-catalog-physical.json"
)


def run(command: list[str], *, timeout: int = 180, include_output: bool = False) -> str:
    completed = subprocess.run(
        command,
        cwd=ROOT,
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        timeout=timeout,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
    )
    if completed.returncode:
        suffix = completed.stdout[-2000:] if include_output else ""
        raise RuntimeError(f"p5_session_catalog_command_failed:{completed.returncode}{suffix}")
    return completed.stdout


def adb(adb_path: Path, serial: str, *arguments: str, timeout: int = 180) -> str:
    return run([str(adb_path), "-s", serial, *arguments], timeout=timeout)


def _prop(adb_path: Path, serial: str, name: str) -> str:
    return adb(adb_path, serial, "shell", "getprop", name, timeout=20).strip()


def physical_environment(adb_path: Path, serial: str) -> dict[str, Any]:
    state = adb(adb_path, serial, "get-state", timeout=20).strip()
    qemu = _prop(adb_path, serial, "ro.kernel.qemu")
    fingerprint = _prop(adb_path, serial, "ro.build.fingerprint")
    if state != "device" or qemu == "1" or serial.startswith("emulator-"):
        raise RuntimeError("p5_session_catalog_physical_device_required")
    return {
        "kind": "physical_device",
        "device_id_sha256": hashlib.sha256(
            f"p5-session-catalog/1\0{serial}\0{fingerprint}".encode()
        ).hexdigest(),
        "manufacturer": _prop(adb_path, serial, "ro.product.manufacturer")[:80],
        "model": _prop(adb_path, serial, "ro.product.model")[:80],
        "api": int(_prop(adb_path, serial, "ro.build.version.sdk")),
    }


def extract_single_json(output: str, prefixes: tuple[str, ...], error: str) -> dict[str, Any]:
    candidates: list[dict[str, Any]] = []
    for line in output.splitlines():
        for prefix in prefixes:
            if line.startswith(prefix):
                try:
                    value = json.loads(line[len(prefix):].strip())
                except json.JSONDecodeError as exc:
                    raise ValueError(f"{error}_invalid") from exc
                if isinstance(value, dict) and value not in candidates:
                    candidates.append(value)
    if len(candidates) != 1:
        raise ValueError(f"{error}_missing")
    return candidates[0]


def validate_target(value: Any) -> dict[str, str]:
    if not isinstance(value, dict) or value.get("phase") != "target-proof":
        raise ValueError("p5_session_catalog_target_invalid")
    result: dict[str, str] = {}
    for key in ("runtime_id", "workspace_id", "session_id"):
        item = value.get(key)
        if not isinstance(item, str) or not 1 <= len(item) <= 500 or any(
            character in item for character in "\r\n\x00"
        ):
            raise ValueError("p5_session_catalog_target_invalid")
        result[key] = item
    if int(value.get("workspace_count", 0)) < 1 or int(value.get("active_session_count", 0)) < 1:
        raise ValueError("p5_session_catalog_target_empty")
    return result


def validate_monitor_report(value: Any) -> dict[str, Any]:
    expected = {
        "schema_version", "feature_id", "passed", "physical", "catalog_event_count",
        "observed_transitions", "manual_refresh_count", "final_active", "title_restored",
        "lifecycle_restored",
    }
    if not isinstance(value, dict) or set(value) != expected:
        raise ValueError("p5_session_catalog_report_shape_invalid")
    if value.get("schema_version") != "p5-session-catalog/1" \
            or value.get("feature_id") != "P5-M03-F04" \
            or value.get("passed") is not True or value.get("physical") is not True:
        raise ValueError("p5_session_catalog_report_not_passed")
    if value.get("observed_transitions") != EXPECTED_TRANSITIONS \
            or value.get("manual_refresh_count") != 0 \
            or int(value.get("catalog_event_count", -1)) < len(EXPECTED_TRANSITIONS):
        raise ValueError("p5_session_catalog_transition_invalid")
    if any(value.get(key) is not True for key in (
        "final_active", "title_restored", "lifecycle_restored"
    )):
        raise ValueError("p5_session_catalog_rollback_invalid")
    return value


class GatewayClient:
    def __init__(self, root: str, token: str) -> None:
        if not re.fullmatch(r"http://127\.0\.0\.1:\d{2,5}", root.rstrip("/")):
            raise ValueError("p5_session_catalog_gateway_url_invalid")
        if not token or any(character in token for character in "\r\n\x00"):
            raise ValueError("p5_session_catalog_gateway_token_invalid")
        self.root = root.rstrip("/")
        self.token = token

    def request(self, method: str, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
        encoded = None if body is None else json.dumps(body, separators=(",", ":")).encode()
        request = Request(
            f"{self.root}{path}", data=encoded, method=method,
            headers={
                "X-OpenDrSai-Gateway-Token": self.token,
                "Content-Type": "application/json",
            },
        )
        try:
            with urlopen(request, timeout=20) as response:  # noqa: S310 - loopback is validated
                value = json.loads(response.read().decode())
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as exc:
            raise RuntimeError("p5_session_catalog_gateway_request_failed") from exc
        if not isinstance(value, dict):
            raise RuntimeError("p5_session_catalog_gateway_response_invalid")
        return value


def measure_patch(client: GatewayClient, session_id: str, body: dict[str, Any]) -> int:
    started = time.monotonic()
    client.request("PATCH", f"/v1/sessions/{quote(session_id, safe='')}", body)
    return round((time.monotonic() - started) * 1000)


def wait_ready(adb_path: Path, serial: str, process: subprocess.Popen[str], timeout: float) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError("p5_session_catalog_monitor_ended_before_ready")
        completed = subprocess.run(
            [str(adb_path), "-s", serial, "exec-out", "run-as", PACKAGE, "cat", READY_FILE],
            text=True, encoding="utf-8", errors="replace", stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, timeout=10,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
        if completed.returncode == 0:
            try:
                if json.loads(completed.stdout).get("ready") is True:
                    return
            except (json.JSONDecodeError, AttributeError):
                pass
        time.sleep(0.25)
    raise RuntimeError("p5_session_catalog_monitor_ready_timeout")


def atomic_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    temporary.replace(path)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sdk = Path(os.environ.get("ANDROID_HOME", Path.home() / "AppData/Local/Android/Sdk"))
    state_root = Path(os.environ.get("DRSAI_HOME", Path.home() / ".drsai-dev"))
    parser.add_argument("--adb", type=Path, default=sdk / "platform-tools/adb.exe")
    parser.add_argument("--serial", required=True)
    parser.add_argument("--gateway-url", default="http://127.0.0.1:28642")
    parser.add_argument("--token-path", type=Path, default=state_root / "runtime/instance-token")
    parser.add_argument("--relay-base-url", default="https://ai-dev.ihep.ac.cn/api/runtime-relay/")
    parser.add_argument("--hold-seconds", type=float, default=2.0)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    options = parser.parse_args(argv)
    if not options.adb.is_file() or not options.token_path.is_file():
        raise FileNotFoundError("p5_session_catalog_required_local_artifact_missing")
    if not 0.5 <= options.hold_seconds <= 15:
        raise ValueError("p5_session_catalog_hold_invalid")
    environment = physical_environment(options.adb, options.serial)
    token = options.token_path.read_text(encoding="utf-8").strip()
    client = GatewayClient(options.gateway_url, token)
    status = client.request("GET", "/v1/mobile-pairing/status")
    runtime_id = status.get("runtime_id")
    if status.get("state") != "ready" or not isinstance(runtime_id, str) or not runtime_id:
        raise RuntimeError("p5_session_catalog_runtime_not_ready")

    target_output = adb(
        options.adb, options.serial, "shell", "am", "instrument", "-w", "-r",
        "-e", "phase", "target-proof", "-e", "runtimeId", runtime_id,
        "-e", "relayBaseUrl", options.relay_base_url,
        "-e", "class", TARGET_TEST, RUNNER, timeout=120,
    )
    if "OK (1 test)" not in target_output or "FAILURES!!!" in target_output:
        raise RuntimeError("p5_session_catalog_target_instrumentation_failed")
    target = validate_target(extract_single_json(
        target_output, PROOF_PREFIXES, "p5_session_catalog_target_proof"
    ))
    if target["runtime_id"] != runtime_id:
        raise RuntimeError("p5_session_catalog_runtime_identity_mismatch")

    temporary_title = f"P5-M03-F04-{secrets.token_hex(6)}"
    monitor_command = [
        str(options.adb), "-s", options.serial, "shell", "am", "instrument", "-w", "-r",
        "-e", "runtimeId", runtime_id,
        "-e", "workspaceId", target["workspace_id"],
        "-e", "sessionId", target["session_id"],
        "-e", "temporaryTitle", temporary_title,
        "-e", "monitorDurationMs", "120000",
        "-e", "relayBaseUrl", options.relay_base_url,
        "-e", "class", MONITOR_TEST, RUNNER,
    ]
    monitor = subprocess.Popen(
        monitor_command, cwd=ROOT, text=True, encoding="utf-8", errors="replace",
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
    )
    session_id = target["session_id"]
    original: dict[str, Any] | None = None
    durations: dict[str, int] = {}
    restored = False
    transaction_error: Exception | None = None
    try:
        wait_ready(options.adb, options.serial, monitor, 30)
        original = client.request("GET", f"/v1/sessions/{quote(session_id, safe='')}")
        if original.get("lifecycle") != "active" or not isinstance(original.get("title"), str):
            raise RuntimeError("p5_session_catalog_baseline_invalid")
        durations["rename_ms"] = measure_patch(client, session_id, {"title": temporary_title})
        time.sleep(options.hold_seconds)
        durations["archive_ms"] = measure_patch(client, session_id, {"lifecycle": "archived"})
        time.sleep(options.hold_seconds)
        durations["unarchive_ms"] = measure_patch(client, session_id, {"lifecycle": "active"})
        time.sleep(options.hold_seconds)
        durations["rollback_ms"] = measure_patch(client, session_id, {
            "title": original["title"], "lifecycle": original["lifecycle"],
        })
        time.sleep(options.hold_seconds)
        current = client.request("GET", f"/v1/sessions/{quote(session_id, safe='')}")
        restored = current.get("title") == original["title"] \
            and current.get("lifecycle") == original["lifecycle"]
    except Exception as exc:
        transaction_error = exc
    finally:
        if original is not None and not restored:
            try:
                client.request("PATCH", f"/v1/sessions/{quote(session_id, safe='')}", {
                    "title": original["title"], "lifecycle": original["lifecycle"],
                })
                current = client.request("GET", f"/v1/sessions/{quote(session_id, safe='')}")
                restored = current.get("title") == original["title"] \
                    and current.get("lifecycle") == original["lifecycle"]
            except Exception:
                restored = False
    if transaction_error is not None:
        monitor.terminate()
        try:
            monitor.communicate(timeout=10)
        except subprocess.TimeoutExpired:
            monitor.kill()
            monitor.communicate(timeout=10)
        raise transaction_error
    try:
        monitor_output, _ = monitor.communicate(timeout=45)
    except subprocess.TimeoutExpired as exc:
        monitor.terminate()
        monitor.communicate(timeout=10)
        raise RuntimeError("p5_session_catalog_monitor_timeout") from exc
    if monitor.returncode or "OK (1 test)" not in monitor_output or "FAILURES!!!" in monitor_output:
        raise RuntimeError("p5_session_catalog_monitor_failed")
    monitor_report = validate_monitor_report(extract_single_json(
        monitor_output, MONITOR_PREFIXES, "p5_session_catalog_monitor_report"
    ))
    if not restored:
        raise RuntimeError("p5_session_catalog_runtime_rollback_failed")

    report = {
        "schema_version": "p5-session-catalog-acceptance/1",
        "feature_id": "P5-M03-F04",
        "generated_at": datetime.now(UTC).isoformat(),
        "passed": True,
        "environment": environment,
        "protocol": "oaep/1+owop/1",
        "transaction": {
            "hold_seconds": options.hold_seconds,
            "stage_durations_ms": durations,
            "runtime_authority_restored": True,
        },
        "android": monitor_report,
    }
    atomic_json(options.output.resolve(), report)
    digest = hashlib.sha256(options.output.resolve().read_bytes()).hexdigest()
    print(json.dumps({
        "schema_version": report["schema_version"], "passed": True,
        "feature_count": 1, "output_sha256": digest,
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
