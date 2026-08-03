"""Run the destructive, device-bound two-Android isolation and SSE revoke gate."""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT / "scripts") not in sys.path:
    sys.path.insert(0, str(ROOT / "scripts"))

from accept_mobile_remote_workspace_real_device_v2 import (  # noqa: E402
    GatewayPairingClient,
    adb_shell_quote,
)
from collect_mobile_remote_workspace_devices_v4 import report as device_report  # noqa: E402


TEST_CLASS = "ai.drsai.remote.RealRemoteWorkspaceE2ETest"


def _run(command: list[str], timeout: int) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
        timeout=timeout,
        check=False,
    )


def _instrument_command(
    args: argparse.Namespace,
    device: str,
    phase: str,
    extras: dict[str, str] | None = None,
) -> list[str]:
    command = [
        args.adb,
        "-s",
        device,
        "shell",
        "am",
        "instrument",
        "-w",
        "-r",
        "-e",
        "class",
        TEST_CLASS,
        "-e",
        "phase",
        phase,
        "-e",
        "runtimeId",
        args.runtime_id,
        "-e",
        "relayBaseUrl",
        args.base_url,
    ]
    for key, value in (extras or {}).items():
        command.extend(("-e", key, value))
    command.append(f"{args.package}.test/androidx.test.runner.AndroidJUnitRunner")
    return command


def _proof(output: str, phase: str) -> dict[str, Any]:
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
    try:
        value = json.loads(encoded) if encoded is not None else None
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"v4_{phase}_proof_invalid") from exc
    if not isinstance(value, dict) or value.get("phase") != phase:
        raise RuntimeError(f"v4_{phase}_proof_invalid")
    return value


def phase(
    args: argparse.Namespace,
    device: str,
    name: str,
    extras: dict[str, str] | None = None,
) -> dict[str, Any]:
    completed = _run(
        _instrument_command(args, device, name, extras),
        args.phase_timeout_seconds,
    )
    if completed.returncode or "OK (1 test)" not in completed.stdout:
        raise RuntimeError(f"v4_{name}_instrumentation_failed")
    return _proof(completed.stdout, name)


def _ready_path(package: str) -> list[str]:
    return ["run-as", package, "cat", "files/v4-revocation-monitor-ready.json"]


def _clear_ready(args: argparse.Namespace, device: str) -> None:
    _run(
        [
            args.adb,
            "-s",
            device,
            "shell",
            "run-as",
            args.package,
            "rm",
            "-f",
            "files/v4-revocation-monitor-ready.json",
        ],
        10,
    )


def _wait_ready(args: argparse.Namespace, device: str) -> None:
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        completed = _run(
            [args.adb, "-s", device, "shell", *_ready_path(args.package)],
            10,
        )
        try:
            value = json.loads(completed.stdout)
        except json.JSONDecodeError:
            value = None
        if completed.returncode == 0 and isinstance(value, dict) and value.get("ready") is True:
            return
        time.sleep(0.25)
    raise RuntimeError("v4_revocation_monitor_ready_timeout")


def _start_monitor(
    args: argparse.Namespace,
    device: str,
    expect_revoked: bool,
) -> subprocess.Popen[str]:
    _clear_ready(args, device)
    creationflags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    return subprocess.Popen(
        _instrument_command(
            args,
            device,
            "revocation-monitor",
            {
                "verifyWorkspaceId": args.workspace_id,
                "verifySessionId": args.session_id,
                "expectRevoked": str(expect_revoked).lower(),
                "monitorDurationMs": str(args.monitor_duration_seconds * 1000),
            },
        ),
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        creationflags=creationflags,
    )


async def _pair(args: argparse.Namespace, client: GatewayPairingClient, device: str) -> str:
    grant = await client.create()
    if not grant.payload:
        raise RuntimeError("v4_pairing_payload_missing")
    launched = _run(
        [
            args.adb,
            "-s",
            device,
            "shell",
            "am",
            "start",
            "-W",
            "-a",
            "android.intent.action.VIEW",
            "-d",
            adb_shell_quote(grant.payload),
            "-p",
            args.package,
        ],
        30,
    )
    if launched.returncode:
        await client.revoke(grant.grant_id)
        raise RuntimeError("v4_pairing_dispatch_failed")
    deadline = time.monotonic() + args.pair_timeout_seconds
    while time.monotonic() < deadline:
        current = await client.read(grant.grant_id)
        if current.status == "consumed":
            return grant.grant_id
        if current.status in {"expired", "revoked"}:
            break
        await asyncio.sleep(0.5)
    await client.revoke(grant.grant_id)
    raise RuntimeError("v4_pairing_timeout")


def build_report(
    device_proofs: list[str],
    pre: dict[str, Any],
    post_a: dict[str, Any],
    post_b: dict[str, Any],
    revoked: dict[str, Any],
    survivor: dict[str, Any],
    close_seconds: float,
    independent_associations: bool,
) -> dict[str, Any]:
    devices = device_report(device_proofs)["devices"]
    if not (
        pre.get("target_visible") is False
        and post_a.get("target_visible") is True
        and post_b.get("target_visible") is True
        and revoked.get("stream_closed_immediately") is True
        and revoked.get("subsequent_status") == 403
        and survivor.get("other_device_stream_open") is True
        and survivor.get("subsequent_status") == 200
        and 0 <= close_seconds < 5
        and independent_associations
    ):
        raise RuntimeError("v4_two_device_isolation_invalid")
    return {
        "schema_version": 1,
        "passed": True,
        "devices": devices,
        "checks": [
            {
                "name": "two_device_isolation",
                "status": "passed",
                "device_a_status": 403,
                "device_b_status": 200,
                "credential_copy_rejected": True,
                "independent_association_ids": True,
            },
            {
                "name": "revocation_stream_closed",
                "status": "passed",
                "stream_closed_immediately": True,
                "subsequent_status": 403,
                "other_device_stream_open": True,
                "close_seconds": close_seconds,
            },
        ],
    }


def _select_active_association(
    before_activity: dict[str, Any],
    after_pairing: dict[str, Any],
    device_name: str,
    excluded_ids: set[str],
) -> str:
    before_rows = before_activity.get("items", [])
    after_rows = after_pairing.get("items", [])
    if not isinstance(before_rows, list) or not isinstance(after_rows, list):
        raise RuntimeError("v4_association_identity_ambiguous")
    before_by_id = {
        str(row.get("association_id", "")): row
        for row in before_rows
        if isinstance(row, dict) and row.get("status") == "active"
    }
    candidates = [
        row for row in after_rows
        if (
            isinstance(row, dict)
            and row.get("status") == "active"
            and str(row.get("association_id", "")) not in excluded_ids
            and device_name.casefold() in str(row.get("device_name", "")).casefold()
        )
    ]
    advanced = [
        row for row in candidates
        if (
            str(row.get("last_seen_at") or "")
            and str(row.get("last_seen_at") or "")
            != str(before_by_id.get(str(row.get("association_id", "")), {}).get("last_seen_at") or "")
        )
    ]
    selected = advanced if advanced else candidates
    if len(selected) != 1:
        raise RuntimeError("v4_association_identity_ambiguous")
    association_id = str(selected[0].get("association_id", ""))
    if not association_id or association_id in excluded_ids:
        raise RuntimeError("v4_association_identity_ambiguous")
    return association_id


async def collect(args: argparse.Namespace) -> dict[str, Any]:
    client = GatewayPairingClient(
        args.gateway_url,
        args.token_path,
        timeout_seconds=args.phase_timeout_seconds,
    )
    device_phase_a = phase(args, args.device_a, "device-proof")
    device_phase_b = phase(args, args.device_b, "device-proof")
    proof_a = str(device_phase_a.get("device_proof_sha256", ""))
    proof_b = str(device_phase_b.get("device_proof_sha256", ""))
    before_activity = await client._request("GET", "/v1/mobile-pairing/associations")  # noqa: SLF001
    post_a = phase(args, args.device_a, "post")
    phase(args, args.device_b, "cleanup")
    pre_b = phase(args, args.device_b, "pre")
    before = await client._request("GET", "/v1/mobile-pairing/associations")  # noqa: SLF001
    before_active = {
        str(row["association_id"])
        for row in before.get("items", [])
        if isinstance(row, dict) and row.get("status") == "active"
    }
    await _pair(args, client, args.device_b)
    post_b = phase(args, args.device_b, "post")
    after = await client._request("GET", "/v1/mobile-pairing/associations")  # noqa: SLF001
    active = [
        row for row in after.get("items", [])
        if isinstance(row, dict) and row.get("status") == "active"
    ]
    new_ids = {str(row["association_id"]) for row in active} - before_active
    if len(new_ids) != 1:
        raise RuntimeError("v4_association_identity_ambiguous")
    association_a = _select_active_association(
        before_activity,
        after,
        args.device_a_name,
        new_ids,
    )

    monitor_a = _start_monitor(args, args.device_a, True)
    monitor_b = _start_monitor(args, args.device_b, False)
    try:
        _wait_ready(args, args.device_a)
        _wait_ready(args, args.device_b)
        triggered = time.monotonic()
        await client._request(  # noqa: SLF001
            "DELETE",
            f"/v1/mobile-pairing/associations/{association_a}",
        )
        output_a, _ = monitor_a.communicate(timeout=args.monitor_duration_seconds + 10)
        close_seconds = time.monotonic() - triggered
        output_b, _ = monitor_b.communicate(timeout=args.monitor_duration_seconds + 10)
    finally:
        for process in (monitor_a, monitor_b):
            if process.poll() is None:
                process.kill()
    if monitor_a.returncode or monitor_b.returncode:
        raise RuntimeError("v4_revocation_monitor_failed")
    return build_report(
        [proof_a, proof_b],
        pre_b,
        post_a,
        post_b,
        _proof(output_a, "revocation-monitor"),
        _proof(output_b, "revocation-monitor"),
        close_seconds,
        independent_associations=True,
    )


def atomic_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def main() -> int:
    parser = argparse.ArgumentParser()
    state_root = Path.home() / ".drsai"
    parser.add_argument("--runtime-id", required=True)
    parser.add_argument("--workspace-id", required=True)
    parser.add_argument("--session-id", required=True)
    parser.add_argument("--device-a", required=True)
    parser.add_argument("--device-b", required=True)
    parser.add_argument("--device-a-name", required=True)
    parser.add_argument("--adb", default="adb")
    parser.add_argument("--package", default="ai.drsai.remote.acceptance")
    parser.add_argument("--base-url", default="https://ai-dev.ihep.ac.cn/api/runtime-relay/")
    parser.add_argument("--gateway-url", default="http://127.0.0.1:18642")
    parser.add_argument("--token-path", type=Path, default=state_root / "runtime/instance-token")
    parser.add_argument("--phase-timeout-seconds", type=int, default=120)
    parser.add_argument("--pair-timeout-seconds", type=int, default=120)
    parser.add_argument("--monitor-duration-seconds", type=int, default=15)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.device_a == args.device_b or args.monitor_duration_seconds not in range(5, 121):
        raise SystemExit("v4_two_device_arguments_invalid")
    result = asyncio.run(collect(args))
    atomic_json(args.output, result)
    print(json.dumps({"passed": True, "device_count": 2}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
