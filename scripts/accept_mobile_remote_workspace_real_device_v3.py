"""Collect a sanitized three-client Session transcript proof for V3."""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse
from uuid import uuid4

import aiohttp

from accept_mobile_remote_workspace_real_device_v2 import (
    GatewayPairingClient,
    TEST_CLASS,
    adb,
    adb_shell_quote,
    capture_screenshot,
    open_android_route,
    phase,
)


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "cores/python/packages/drsai/src"
if str(SOURCE) not in sys.path:
    sys.path.insert(0, str(SOURCE))

from drsai.relay.models import session_conversation_digest  # noqa: E402


DIGEST = re.compile(r"^[0-9a-f]{64}$")
MONITOR_SAFE_ERROR = re.compile(
    r"(relay_http_[0-9]{3}|real_[a-z0-9_]+|SSLHandshakeException|"
    r"SSLProtocolException|device_proof_required)"
)
MONITOR_SAFE_SCHEMA_ERRORS = {
    "No value for snapshot_sequence": "snapshot_sequence_missing",
}


def monitor_failure_code(output: str, returncode: int | None) -> str:
    match = MONITOR_SAFE_ERROR.search(output)
    if match:
        return match.group(1)
    for marker, code in MONITOR_SAFE_SCHEMA_ERRORS.items():
        if marker in output:
            return code
    return "monitor_exited" if returncode not in (None, 0) else "monitor_timeout"


async def public_relay_preflight(
    base_url: str,
    *,
    session_factory: Any = aiohttp.ClientSession,
    attempts: int = 3,
    retry_delay: float = 0.25,
) -> None:
    parsed = urlparse(base_url)
    if (
        parsed.scheme != "https"
        or parsed.hostname not in {"ai-dev.ihep.ac.cn", "ai.ihep.ac.cn"}
        or parsed.username
        or parsed.password
        or parsed.fragment
    ):
        raise RuntimeError("v3_public_relay_url_invalid")
    health_url = urljoin(base_url.rstrip("/") + "/", "v2/health")
    timeout = aiohttp.ClientTimeout(total=15)
    if attempts < 1:
        raise ValueError("preflight_attempts_must_be_positive")
    last_error: BaseException | None = None
    last_code = "v3_public_relay_preflight_unavailable"
    for attempt in range(attempts):
        try:
            async with session_factory(timeout=timeout) as session:
                async with session.get(
                    health_url,
                    allow_redirects=False,
                    headers={"Accept": "application/json"},
                ) as response:
                    if response.status != 200:
                        raise RuntimeError(
                            f"v3_public_relay_preflight_http_{response.status}"
                        )
                    return
        except aiohttp.ClientConnectorCertificateError as exc:
            # Certificate identity failures are never transiently ignored.
            raise RuntimeError("v3_public_relay_preflight_tls") from exc
        except aiohttp.ClientSSLError as exc:
            last_error = exc
            last_code = "v3_public_relay_preflight_tls"
        except (aiohttp.ClientConnectionError, asyncio.TimeoutError) as exc:
            last_error = exc
            last_code = "v3_public_relay_preflight_unavailable"
        if attempt + 1 < attempts:
            await asyncio.sleep(retry_delay)
    raise RuntimeError(last_code) from last_error


def desktop_digest(snapshot: dict[str, Any]) -> str:
    completed = subprocess.run(
        [
            "node",
            str(ROOT / "apps/desktop/shared/test-kit/run-bundled-test.mjs"),
            str(
                ROOT
                / "apps/desktop/windows/scripts/"
                "digest-runtime-conversation.mts"
            ),
        ],
        cwd=ROOT / "apps/desktop/windows",
        input=json.dumps({"items": snapshot.get("items", [])}, ensure_ascii=False),
        text=True,
        encoding="utf-8",
        errors="strict",
        capture_output=True,
        timeout=30,
        check=False,
    )
    value = completed.stdout.strip()
    if completed.returncode or not DIGEST.fullmatch(value):
        raise RuntimeError("v3_windows_transcript_digest_failed")
    return value


def validate_proof(
    snapshot: dict[str, Any],
    android_proof: dict[str, Any],
    windows_sha256: str,
) -> dict[str, Any]:
    items = snapshot.get("items")
    if (
        not isinstance(items, list)
        or not isinstance(snapshot.get("snapshot_sequence"), int)
        or snapshot.get("session_id") != android_proof.get("session_id")
    ):
        raise RuntimeError("v3_runtime_snapshot_invalid")
    runtime_sha256 = session_conversation_digest(items)
    android_sha256 = android_proof.get("transcript_sha256")
    if not (
        DIGEST.fullmatch(runtime_sha256)
        and isinstance(android_sha256, str)
        and DIGEST.fullmatch(android_sha256)
        and DIGEST.fullmatch(windows_sha256)
        and runtime_sha256 == android_sha256 == windows_sha256
    ):
        raise RuntimeError("v3_session_transcript_hash_mismatch")
    if (
        android_proof.get("snapshot_sequence") != snapshot["snapshot_sequence"]
        or int(android_proof.get("duplicate_sequence_count", -1)) != 0
        or int(android_proof.get("missing_sequence_count", -1)) != 0
        or int(android_proof.get("run_count", 0)) < int(
            android_proof.get("expected_run_count", 0)
        )
    ):
        raise RuntimeError("v3_session_sequence_proof_invalid")
    return {
        "name": "session_hash_convergence",
        "status": "passed",
        "runtime_sha256": runtime_sha256,
        "windows_sha256": windows_sha256,
        "android_sha256": android_sha256,
        "snapshot_sequence": snapshot["snapshot_sequence"],
        "item_count": len(items),
        "session_event_count": int(android_proof.get("session_event_count", 0)),
        "duplicate_sequence_count": 0,
        "missing_sequence_count": 0,
    }


def validate_approval_proof(proof: dict[str, Any]) -> dict[str, Any]:
    event_sha256 = proof.get("event_sha256")
    conversation_sha256 = proof.get("conversation_sha256")
    if not (
        proof.get("phase") == "interaction"
        and proof.get("terminal_status") == "completed"
        and proof.get("approval_status") == "approved"
        and int(proof.get("successful_decisions", 0)) == 1
        and int(proof.get("tool_execution_count", 0)) == 1
        and int(proof.get("sse_event_count", 0)) > 0
        and int(proof.get("event_count", 0)) > 0
        and int(proof.get("conversation_after", 0))
        > int(proof.get("conversation_before", 0))
        and proof.get("session_ui_visible") is True
        and isinstance(event_sha256, str)
        and DIGEST.fullmatch(event_sha256)
        and isinstance(conversation_sha256, str)
        and DIGEST.fullmatch(conversation_sha256)
    ):
        raise RuntimeError("v3_approval_single_execution_proof_invalid")
    return {
        "name": "approval_single_decision",
        "status": "passed",
        "terminal_status": "completed",
        "approval_status": "approved",
        "successful_decisions": 1,
        "tool_execution_count": 1,
        "sse_event_count": int(proof["sse_event_count"]),
        "event_count": int(proof["event_count"]),
        "event_sha256": event_sha256,
        "conversation_sha256": conversation_sha256,
        "session_ui_visible": True,
    }


def validate_two_run_oaep_proof(
    proof: dict[str, Any],
    *,
    direction: str,
    p95_seconds: float,
) -> dict[str, Any]:
    """Validate the V4 OAEP counters emitted by the shared real-device driver."""
    if direction not in {"windows_to_android", "android_to_windows"}:
        raise ValueError("v4_two_run_direction_invalid")
    digest = proof.get("oaep_sha256")
    valid = (
        int(proof.get("run_count", 0)) == 2
        and int(proof.get("duplicate_run_count", -1)) == 0
        and int(proof.get("missing_sequence_count", -1)) == 0
        and int(proof.get("delta_run_count", 0)) >= 2
        and int(proof.get("terminal_run_count", 0)) >= 2
        and 0 <= p95_seconds < 2
        and isinstance(digest, str)
        and DIGEST.fullmatch(digest)
    )
    if direction == "windows_to_android":
        valid = valid and (
            int(proof.get("tool_run_count", 0)) >= 2
        )
    if not valid:
        diagnostics = {
            "run": int(proof.get("run_count", 0)),
            "duplicate": int(proof.get("duplicate_run_count", -1)),
            "missing": int(proof.get("missing_sequence_count", -1)),
            "delta": int(proof.get("delta_run_count", 0)),
            "terminal": int(proof.get("terminal_run_count", 0)),
            "tool": int(proof.get("tool_run_count", 0)),
            "p95_ms": round(p95_seconds * 1000),
            "digest": bool(isinstance(digest, str) and DIGEST.fullmatch(digest)),
        }
        raise RuntimeError(
            f"v4_{direction}_two_runs_invalid:"
            f"{json.dumps(diagnostics, sort_keys=True, separators=(',', ':'))}"
        )
    result = {
        "name": f"{direction}_two_runs",
        "status": "passed",
        "run_count": 2,
        "duplicate_run_count": 0,
        "missing_sequence_count": 0,
        "delta_run_count": int(proof["delta_run_count"]),
        "terminal_run_count": int(proof["terminal_run_count"]),
        "p95_seconds": p95_seconds,
        "oaep_sha256": digest,
    }
    if direction == "windows_to_android":
        result.update({
            "tool_run_count": int(proof["tool_run_count"]),
        })
    return result


def _proof_from_instrumentation(output: str, phase_name: str) -> dict[str, Any]:
    prefixes = (
        "OPENDRSAI_REAL_DEVICE_PROOF=",
        "INSTRUMENTATION_STATUS: realDeviceProof=",
    )
    encoded = next(
        (
            line.split(prefix, 1)[1].strip()
            for line in output.splitlines()
            for prefix in prefixes
            if prefix in line
        ),
        None,
    )
    if encoded is None:
        raise RuntimeError(f"v3_{phase_name}_proof_missing")
    proof = json.loads(encoded)
    if not isinstance(proof, dict) or proof.get("phase") != phase_name:
        raise RuntimeError(f"v3_{phase_name}_proof_invalid")
    return proof


def _start_windows_monitor(
    args: argparse.Namespace,
    source_ids: list[str],
    marker: str,
) -> subprocess.Popen[str]:
    extras = {
        "verifyWorkspaceId": args.workspace_id,
        "verifySessionId": args.session_id,
        "expectedSourceMessageIds": ",".join(source_ids),
        "expectedMessageMarker": marker,
    }
    arguments = [
        args.adb,
        "-s",
        args.device,
        "shell",
        "am",
        "instrument",
        "-w",
        "-r",
        "-e",
        "class",
        adb_shell_quote(TEST_CLASS),
        "-e",
        "phase",
        "windows-two-runs-monitor",
        "-e",
        "runtimeId",
        adb_shell_quote(args.runtime_id),
        "-e",
        "relayBaseUrl",
        adb_shell_quote(args.base_url),
    ]
    arguments.extend(
        value
        for key, raw in extras.items()
        for value in ("-e", key, adb_shell_quote(raw))
    )
    arguments.append(f"{args.package}.test/androidx.test.runner.AndroidJUnitRunner")
    return subprocess.Popen(
        arguments,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )


async def _wait_windows_monitor_ready(args: argparse.Namespace) -> dict[str, Any]:
    deadline = asyncio.get_running_loop().time() + 30
    while asyncio.get_running_loop().time() < deadline:
        before_epoch_ms = __import__("time").time() * 1000
        result = await asyncio.to_thread(
            adb,
            args,
            "shell",
            "run-as",
            args.package,
            "cat",
            "files/v3-session-monitor-ready.json",
            timeout=10,
        )
        after_epoch_ms = __import__("time").time() * 1000
        if result.returncode == 0:
            try:
                value = json.loads(result.stdout)
            except json.JSONDecodeError:
                value = None
            if (
                isinstance(value, dict)
                and value.get("session_id") == args.session_id
                and isinstance(value.get("snapshot_sequence"), int)
                and isinstance(value.get("android_epoch_ms"), int)
            ):
                value["clock_offset_ms"] = value["android_epoch_ms"] - (
                    before_epoch_ms + after_epoch_ms
                ) / 2
                return value
        await asyncio.sleep(0.1)
    raise RuntimeError("v3_windows_monitor_ready_timeout")


async def _send_windows_runs(
    client: GatewayPairingClient,
    session_id: str,
    workspace_id: str,
    source_ids: list[str],
    marker: str,
) -> dict[str, int]:
    async def send(index: int, source_id: str) -> tuple[str, int]:
        key = f"v3-windows-{source_id}"
        started = round(__import__("time").time() * 1000)
        body = {
            "model": "drsai",
            "messages": [{"role": "user", "content": f"{marker} {index}"}],
            "display_message": f"{marker} {index}",
            "source_message_id": source_id,
            "stream": True,
            "user_id": "v4-acceptance-windows",
            "thread_id": session_id,
            "workspace_id": workspace_id,
            "metadata": {
                "desktop_request_id": key,
                "run_id": key,
                "v4_controlled_desktop_turn": True,
            },
        }
        async with client.session_factory(timeout=client.timeout) as session:
            async with session.post(
                client.root + "/v1/chat/completions",
                headers={
                    **client.headers,
                    "X-OpenDrSai-Auth-Mode": "offline",
                    "Idempotency-Key": key,
                },
                json=body,
            ) as response:
                payload = await response.text()
                if response.status != 200:
                    raise RuntimeError(
                        f"v4_windows_desktop_turn_http_{response.status}"
                    )
                if "data: [DONE]" not in payload:
                    raise RuntimeError("v4_windows_desktop_turn_incomplete")
        return source_id, started

    return dict(
        await asyncio.gather(
            *(send(index, source_id) for index, source_id in enumerate(source_ids, 1))
        )
    )


async def collect_windows_two_runs(
    args: argparse.Namespace,
    client: GatewayPairingClient,
    interaction_id: str,
) -> tuple[dict[str, Any], list[str]]:
    source_ids = [
        f"windows-v3-{interaction_id}-{index}" for index in (1, 2)
    ]
    marker = f"V3-WINDOWS-{interaction_id}"
    adb(
        args,
        "shell",
        "run-as",
        args.package,
        "rm",
        "-f",
        "files/v3-session-monitor-ready.json",
        timeout=10,
    )
    monitor = _start_windows_monitor(args, source_ids, marker)
    try:
        ready = await _wait_windows_monitor_ready(args)
    except BaseException as failure:
        if monitor.poll() is None:
            monitor.kill()
        output, _ = await asyncio.to_thread(monitor.communicate, timeout=10)
        code = monitor_failure_code(output, monitor.returncode)
        raise RuntimeError(f"v3_windows_monitor_ready_failed:{code}") from failure
    try:
        starts = await _send_windows_runs(
            client,
            args.session_id,
            args.workspace_id,
            source_ids,
            marker,
        )
        output, _ = await asyncio.to_thread(
            monitor.communicate,
            timeout=args.interaction_timeout_seconds,
        )
    except BaseException:
        monitor.kill()
        monitor.wait(timeout=10)
        raise
    if monitor.returncode != 0 or "OK (1 test)" not in output:
        code = monitor_failure_code(output, monitor.returncode)
        raise RuntimeError(f"v3_windows_two_runs_instrumentation_failed:{code}")
    proof = _proof_from_instrumentation(output, "windows-two-runs-monitor")
    arrivals = proof.get("arrival_epoch_ms_by_source_sha256")
    if not isinstance(arrivals, dict):
        raise RuntimeError("v3_windows_two_runs_arrivals_missing")
    latencies: list[float] = []
    for source_id in source_ids:
        key = hashlib.sha256(source_id.encode()).hexdigest()
        arrived = arrivals.get(key)
        if not isinstance(arrived, int):
            raise RuntimeError("v3_windows_two_runs_arrival_missing")
        latencies.append(
            (
                arrived
                - (
                    starts[source_id]
                    + float(ready["clock_offset_ms"])
                )
            )
            / 1000
        )
    p95 = max(latencies)
    check = validate_two_run_oaep_proof(
        proof,
        direction="windows_to_android",
        p95_seconds=p95,
    )
    return (
        {
            **check,
            **capture_screenshot(args, "windows-to-android"),
        },
        source_ids,
    )


async def collect(args: argparse.Namespace) -> dict[str, Any]:
    await public_relay_preflight(args.base_url)
    client = GatewayPairingClient(
        args.gateway_url,
        args.token_path,
        timeout_seconds=args.phase_timeout_seconds,
    )
    checks: list[dict[str, Any]] = []
    if args.approval_only:
        interaction_id = args.interaction_id or uuid4().hex
        approval = phase(
            args,
            "interaction",
            extras={
                "interactionWorkspaceId": args.workspace_id,
                "interactionAgentDefinitionId": args.approval_agent_definition_id,
                "interactionId": interaction_id,
                "interactionMessage": args.interaction_message,
            },
        )
        if approval is None:
            raise RuntimeError("v3_approval_single_execution_proof_missing")
        check = validate_approval_proof(approval)
        open_android_route(
            args,
            "opendrsai://session/"
            f"{args.runtime_id}/{args.workspace_id}/{approval['session_id']}",
        )
        time.sleep(5)
        check.update(capture_screenshot(args, "approval-single-execution"))
        return {
            "schema_version": 1,
            "passed": True,
            "checks": [check],
        }
    if not args.session_id:
        raise RuntimeError("v3_session_id_required")
    expected_source_ids = list(args.expected_source_message_id)
    if args.windows_two_runs:
        windows_check, windows_source_ids = await collect_windows_two_runs(
            args,
            client,
            args.interaction_id or uuid4().hex,
        )
        checks.append(windows_check)
        expected_source_ids.extend(windows_source_ids)
    if args.android_two_runs:
        interaction_id = args.interaction_id or uuid4().hex
        android_runs = phase(
            args,
            "android-two-runs",
            extras={
                "verifyWorkspaceId": args.workspace_id,
                "verifySessionId": args.session_id,
                "interactionId": interaction_id,
                "interactionMessage": args.interaction_message,
            },
        )
        if android_runs is None:
            raise RuntimeError("v3_android_two_runs_proof_missing")
        android_check = validate_two_run_oaep_proof(
            android_runs,
            direction="android_to_windows",
            p95_seconds=float(android_runs.get("p95_seconds", 999)),
        )
        expected_source_ids.extend(
            f"android-v3-{interaction_id}-{index}" for index in (1, 2)
        )
        checks.append(
            {
                **android_check,
                **capture_screenshot(args, "android-to-windows"),
            }
        )

    # V4 validates the canonical OAEP Snapshot/EventPage with the dedicated
    # real-device V4 collector.  Keep this driver usable for its two-run
    # realtime gates without falling through to the superseded V3
    # conversation projection parser.
    if args.two_runs_only:
        if not checks:
            raise RuntimeError("v3_two_runs_only_requires_two_run_phase")
        return {
            "schema_version": 1,
            "passed": True,
            "checks": checks,
        }

    if not expected_source_ids:
        raise RuntimeError("v3_expected_source_message_ids_required")
    snapshot = await client._request(  # noqa: SLF001 - acceptance uses loopback authority.
        "GET",
        f"/v1/sessions/{args.session_id}/conversation-snapshot",
    )
    windows_sha256 = desktop_digest(snapshot)
    proof = phase(
        args,
        "session-proof",
        extras={
            "verifyWorkspaceId": args.workspace_id,
            "verifySessionId": args.session_id,
            "expectedSourceMessageIds": ",".join(expected_source_ids),
            "expectedRunCount": str(args.expected_run_count),
        },
    )
    if proof is None:
        raise RuntimeError("v3_android_session_proof_missing")
    proof["session_id"] = args.session_id
    proof["expected_run_count"] = args.expected_run_count
    check = validate_proof(snapshot, proof, windows_sha256)
    check.update(capture_screenshot(args, "session-convergence"))
    checks.append(check)
    return {
        "schema_version": 1,
        "passed": True,
        "checks": checks,
    }


def atomic_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)


def main() -> int:
    parser = argparse.ArgumentParser()
    state_root = Path(os.getenv("DRSAI_HOME", str(Path.home() / ".drsai")))
    parser.add_argument("--runtime-id", required=True)
    parser.add_argument("--workspace-id", required=True)
    parser.add_argument("--session-id")
    parser.add_argument("--expected-source-message-id", action="append", default=[])
    parser.add_argument("--expected-run-count", type=int, default=4)
    parser.add_argument("--android-two-runs", action="store_true")
    parser.add_argument("--windows-two-runs", action="store_true")
    parser.add_argument("--two-runs-only", action="store_true")
    parser.add_argument("--approval-only", action="store_true")
    parser.add_argument(
        "--approval-agent-definition-id",
        default="mobile-acceptance",
    )
    parser.add_argument("--interaction-id")
    parser.add_argument(
        "--interaction-message",
        default="V3 Android to Windows Session synchronization",
    )
    parser.add_argument("--base-url", default="https://ai-dev.ihep.ac.cn/api/runtime-relay/")
    parser.add_argument("--gateway-url", default="http://127.0.0.1:18642")
    parser.add_argument("--token-path", type=Path, default=state_root / "runtime/instance-token")
    parser.add_argument("--device", default="R5GYB3S8ACH")
    parser.add_argument("--package", default="ai.drsai.remote.debug")
    parser.add_argument(
        "--adb",
        default=str(
            Path(os.getenv("LOCALAPPDATA", ""))
            / "Android/Sdk/platform-tools/adb.exe"
        ),
    )
    parser.add_argument("--phase-timeout-seconds", type=int, default=120)
    parser.add_argument("--interaction-timeout-seconds", type=int, default=420)
    parser.add_argument(
        "--output",
        type=Path,
        default=(
            ROOT
            / "release/product-evidence/mobile-remote-workspace-v3/"
            "session-convergence.json"
        ),
    )
    args = parser.parse_args()
    report = asyncio.run(collect(args))
    atomic_json(args.output, report)
    print(json.dumps({"passed": True, "output": str(args.output)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
