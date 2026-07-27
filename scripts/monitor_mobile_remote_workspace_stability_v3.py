"""One-hour V3 stability and recovery gate for the real mobile workspace chain.

The Android bearer remains in Android secure storage.  This driver only reads
nonce-bound, sanitized probe files and the Windows loopback Gateway token.
Faults are injected one at a time and every recovery is checked against the
same Session snapshot sequence and canonical transcript digest.
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

from accept_mobile_remote_workspace_real_device_v2 import (
    GatewayPairingClient,
    adb,
    open_android_route,
    set_network,
)
from monitor_mobile_remote_workspace_stability_v2 import (
    Sample,
    android_probe,
    android_state,
    gateway_pid,
    percentile,
    slope,
    windows_process_counters,
)


FAULT_NAMES = (
    "android_background",
    "android_process_death",
    "network_change",
    "runtime_restart",
    "relay_restart",
)


@dataclass(frozen=True)
class FaultRecord:
    name: str
    status: str
    started_at_seconds: float
    recovered_at_seconds: float
    recovery_seconds: float
    transcript_hash_preserved: bool
    snapshot_sequence_preserved: bool
    run_count_preserved: bool
    event_count_preserved: bool
    duplicate_run_count: int
    duplicate_sequence_count: int
    missing_sequence_count: int
    generation_before: int | None
    generation_after: int | None
    android_pid_before: int | None
    android_pid_after: int | None
    windows_pid_before: int | None
    windows_pid_after: int | None
    identity_transition_valid: bool


def _probe_snapshot(proof: dict[str, Any]) -> tuple[str, int]:
    digest = proof.get("transcript_sha256")
    sequence = proof.get("snapshot_sequence")
    if (
        not isinstance(digest, str)
        or len(digest) != 64
        or any(character not in "0123456789abcdef" for character in digest)
        or not isinstance(sequence, int)
        or sequence < 0
    ):
        raise RuntimeError("v3_stability_probe_snapshot_invalid")
    return digest, sequence


def _probe_integrity(proof: dict[str, Any]) -> tuple[int, int, int, int]:
    keys = (
        "run_count",
        "session_event_count",
        "duplicate_run_count",
        "duplicate_sequence_count",
        "missing_sequence_count",
    )
    values = {key: proof.get(key) for key in keys}
    if any(
        not isinstance(value, int) or isinstance(value, bool) or value < 0
        for value in values.values()
    ):
        raise RuntimeError("v3_stability_probe_integrity_invalid")
    if values["duplicate_run_count"] or values["duplicate_sequence_count"]:
        raise RuntimeError("v3_stability_probe_duplicate_detected")
    if values["missing_sequence_count"]:
        raise RuntimeError("v3_stability_probe_sequence_gap")
    return (
        values["run_count"],
        values["session_event_count"],
        values["duplicate_run_count"],
        values["missing_sequence_count"],
    )


def evaluate(
    samples: list[Sample],
    faults: list[FaultRecord],
    duration_seconds: int,
) -> dict[str, Any]:
    elapsed = [item.elapsed_seconds for item in samples]
    memory_slope = slope(
        [item.windows_working_set_bytes for item in samples],
        elapsed,
    )
    handle_slope = slope([item.windows_handle_count for item in samples], elapsed)
    hashes = {item.transcript_sha256 for item in samples if item.transcript_sha256}
    probe_errors = sum(item.runtime_status == "probe_error" for item in samples)
    completed_window = bool(samples and samples[-1].elapsed_seconds >= duration_seconds)
    memory_within_threshold = (
        memory_slope is not None and memory_slope < 1024 * 1024 / 60
    )
    handle_count_within_threshold = (
        handle_slope is not None and handle_slope < 1 / 60
    )
    fault_names = {
        item.name
        for item in faults
        if item.status == "passed"
        and item.transcript_hash_preserved
        and item.snapshot_sequence_preserved
        and item.run_count_preserved
        and item.event_count_preserved
        and item.duplicate_run_count == 0
        and item.duplicate_sequence_count == 0
        and item.missing_sequence_count == 0
        and item.identity_transition_valid
    }
    passed = (
        completed_window
        and probe_errors == 0
        and bool(samples)
        and all(item.runtime_status == "online" for item in samples)
        and all(item.workspace_count > 0 for item in samples)
        and all(item.android_online and item.android_pid is not None for item in samples)
        and all(
            item.windows_pid is not None
            and item.windows_working_set_bytes is not None
            and item.windows_handle_count is not None
            and item.transcript_sha256 is not None
            for item in samples
        )
        and len(hashes) == 1
        and percentile([item.relay_latency_ms for item in samples], 0.95) < 2_000
        and memory_within_threshold
        and handle_count_within_threshold
        and fault_names == set(FAULT_NAMES)
    )
    return {
        "schema_version": 1,
        "profile": "mobile-remote-workspace-v3",
        "required_duration_seconds": duration_seconds,
        "observed_duration_seconds": samples[-1].elapsed_seconds if samples else 0,
        "sample_count": len(samples),
        "relay_latency_p95_ms": percentile(
            [item.relay_latency_ms for item in samples],
            0.95,
        ),
        "windows_memory_slope_bytes_per_second": memory_slope,
        "windows_handle_slope_per_second": handle_slope,
        "memory_within_threshold": memory_within_threshold,
        "handle_count_within_threshold": handle_count_within_threshold,
        "transcript_hash_count": len(hashes),
        "transcript_hash_stable": len(hashes) == 1 and bool(samples),
        "probe_error_count": probe_errors,
        "faults": [asdict(item) for item in faults],
        "passed": passed,
        "samples": [asdict(item) for item in samples],
    }


def _atomic_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


async def _wait_probe(
    args: argparse.Namespace,
    *,
    timeout_seconds: int,
) -> tuple[dict[str, Any], int]:
    deadline = time.monotonic() + timeout_seconds
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            return await asyncio.to_thread(android_probe, args)
        except Exception as exc:  # bounded retry around real recovery
            last_error = exc
            await asyncio.sleep(1)
    code = type(last_error).__name__ if last_error else "unknown"
    raise RuntimeError(f"v3_stability_recovery_timeout:{code}")


def _open_session(args: argparse.Namespace) -> None:
    open_android_route(
        args,
        "opendrsai://session/"
        f"{args.runtime_id}/{args.workspace_id}/{args.session_id}",
    )


async def _runtime_reconnect(
    args: argparse.Namespace,
    service: GatewayPairingClient,
) -> None:
    old_pid = gateway_pid(args.gateway_port)
    if old_pid is None:
        raise RuntimeError("v3_stability_gateway_pid_missing")
    await service.shutdown_runtime()
    deadline = time.monotonic() + args.recovery_timeout_seconds
    observed_offline = False
    while time.monotonic() < deadline:
        current = gateway_pid(args.gateway_port)
        if current is None:
            observed_offline = True
        elif observed_offline and current != old_pid:
            return
        await asyncio.sleep(0.5)
    raise RuntimeError("v3_stability_runtime_restart_timeout")


async def _relay_reconnect(
    args: argparse.Namespace,
    service: GatewayPairingClient,
) -> None:
    scheduled = await service.inject_connection_owner_restart(
        args.relay_fault_ttl_seconds
    )
    if int(scheduled["recovery"]["required_generation"]) <= int(
        scheduled["generation"]
    ):
        raise RuntimeError("v3_stability_relay_generation_invalid")
    # The loopback readiness endpoint deliberately has no public connection
    # generation.  Wait past the fenced-owner TTL here; _fault then proves the
    # new owner by completing an authenticated Android probe and comparing its
    # returned generation and Session snapshot.
    await asyncio.sleep(args.relay_fault_ttl_seconds + 1)


async def _inject(
    args: argparse.Namespace,
    name: str,
    service: GatewayPairingClient,
) -> None:
    if name == "android_background":
        adb(args, "shell", "input", "keyevent", "KEYCODE_HOME", timeout=10)
        await asyncio.sleep(args.fault_hold_seconds)
        await asyncio.to_thread(_open_session, args)
    elif name == "android_process_death":
        stopped = adb(
            args,
            "shell",
            "am",
            "force-stop",
            args.package,
            timeout=10,
        )
        if stopped.returncode:
            raise RuntimeError("v3_stability_android_force_stop_failed")
        await asyncio.sleep(args.fault_hold_seconds)
        await asyncio.to_thread(_open_session, args)
    elif name == "network_change":
        wifi = _network_setting(args, "wifi_on")
        data = _network_setting(args, "mobile_data")
        try:
            set_network(args, wifi=False, data=False)
            await asyncio.sleep(args.fault_hold_seconds)
        finally:
            set_network(args, wifi=wifi, data=data)
        await asyncio.to_thread(_open_session, args)
    elif name == "runtime_restart":
        await _runtime_reconnect(args, service)
    elif name == "relay_restart":
        await _relay_reconnect(args, service)
    else:
        raise RuntimeError(f"v3_stability_fault_unknown:{name}")


def _network_setting(args: argparse.Namespace, key: str) -> bool:
    result = adb(args, "shell", "settings", "get", "global", key, timeout=10)
    value = result.stdout.strip()
    if result.returncode or value not in {"0", "1"}:
        raise RuntimeError(f"v3_stability_network_setting_invalid:{key}")
    return value == "1"


async def _fault(
    args: argparse.Namespace,
    name: str,
    service: GatewayPairingClient,
    started: float,
) -> FaultRecord:
    before, _ = await _wait_probe(args, timeout_seconds=args.recovery_timeout_seconds)
    before_digest, before_sequence = _probe_snapshot(before)
    before_runs, before_events, before_duplicate_runs, before_missing = (
        _probe_integrity(before)
    )
    _, before_pid = android_state(args.adb, args.device, args.package)
    windows_pid_before = gateway_pid(args.gateway_port)
    began = time.monotonic()
    await _inject(args, name, service)
    after, _ = await _wait_probe(args, timeout_seconds=args.recovery_timeout_seconds)
    recovered = time.monotonic()
    after_digest, after_sequence = _probe_snapshot(after)
    after_runs, after_events, after_duplicate_runs, after_missing = (
        _probe_integrity(after)
    )
    _, after_pid = android_state(args.adb, args.device, args.package)
    windows_pid_after = gateway_pid(args.gateway_port)
    generation_before = before.get("runtime_generation")
    generation_after = after.get("runtime_generation")
    identity_transition_valid = _identity_transition_valid(
        name,
        generation_before=generation_before,
        generation_after=generation_after,
        android_pid_before=before_pid,
        android_pid_after=after_pid,
        windows_pid_before=windows_pid_before,
        windows_pid_after=windows_pid_after,
    )
    return FaultRecord(
        name=name,
        status="passed",
        started_at_seconds=round(began - started, 3),
        recovered_at_seconds=round(recovered - started, 3),
        recovery_seconds=round(recovered - began, 3),
        transcript_hash_preserved=before_digest == after_digest,
        snapshot_sequence_preserved=before_sequence == after_sequence,
        run_count_preserved=before_runs == after_runs,
        event_count_preserved=before_events == after_events,
        duplicate_run_count=max(before_duplicate_runs, after_duplicate_runs),
        duplicate_sequence_count=max(
            int(before.get("duplicate_sequence_count", -1)),
            int(after.get("duplicate_sequence_count", -1)),
        ),
        missing_sequence_count=max(before_missing, after_missing),
        generation_before=generation_before,
        generation_after=generation_after,
        android_pid_before=before_pid,
        android_pid_after=after_pid,
        windows_pid_before=windows_pid_before,
        windows_pid_after=windows_pid_after,
        identity_transition_valid=identity_transition_valid,
    )


def _identity_transition_valid(
    name: str,
    *,
    generation_before: int | None,
    generation_after: int | None,
    android_pid_before: int | None,
    android_pid_after: int | None,
    windows_pid_before: int | None,
    windows_pid_after: int | None,
) -> bool:
    values = (
        generation_before,
        generation_after,
        android_pid_before,
        android_pid_after,
        windows_pid_before,
        windows_pid_after,
    )
    if any(value is None for value in values):
        return False
    if name == "android_background":
        return (
            android_pid_after == android_pid_before
            and windows_pid_after == windows_pid_before
            and generation_after == generation_before
        )
    if name == "android_process_death":
        return (
            android_pid_after != android_pid_before
            and windows_pid_after == windows_pid_before
            and generation_after == generation_before
        )
    if name == "network_change":
        return (
            android_pid_after == android_pid_before
            and windows_pid_after == windows_pid_before
            and generation_after == generation_before
        )
    if name == "runtime_restart":
        return (
            android_pid_after == android_pid_before
            and windows_pid_after != windows_pid_before
            and generation_after > generation_before
        )
    if name == "relay_restart":
        return (
            android_pid_after == android_pid_before
            and windows_pid_after == windows_pid_before
            and generation_after > generation_before
        )
    return False


async def monitor(args: argparse.Namespace) -> dict[str, Any]:
    service = GatewayPairingClient(
        args.gateway_url,
        args.token_path,
        timeout_seconds=15,
    )
    await asyncio.to_thread(_open_session, args)
    started = time.monotonic()
    samples: list[Sample] = []
    faults: list[FaultRecord] = []
    next_fault = 0
    fault_offsets = [
        args.duration_seconds * fraction
        for fraction in (1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6)
    ]
    while True:
        elapsed = time.monotonic() - started
        if (
            next_fault < len(FAULT_NAMES)
            and elapsed >= fault_offsets[next_fault]
        ):
            faults.append(
                await _fault(args, FAULT_NAMES[next_fault], service, started)
            )
            next_fault += 1
            elapsed = time.monotonic() - started

        proof: dict[str, Any] = {}
        latency = 0
        probe_error = False
        try:
            proof, latency = await asyncio.to_thread(android_probe, args)
            _probe_snapshot(proof)
        except Exception:
            probe_error = True
        online, android_pid = android_state(args.adb, args.device, args.package)
        windows_pid = gateway_pid(args.gateway_port)
        memory, handles = windows_process_counters(windows_pid)
        samples.append(
            Sample(
                round(elapsed, 3),
                latency,
                "probe_error"
                if probe_error
                else str(proof.get("runtime_status", "unknown")),
                proof.get("runtime_generation"),
                int(proof.get("workspace_count", 0)),
                online,
                android_pid,
                windows_pid,
                memory,
                handles,
                proof.get("transcript_sha256"),
            )
        )
        current = evaluate(samples, faults, args.duration_seconds)
        _atomic_json(args.output, current)
        if elapsed >= args.duration_seconds:
            return current
        await asyncio.sleep(
            min(args.interval_seconds, args.duration_seconds - elapsed)
        )


def main() -> int:
    parser = argparse.ArgumentParser()
    state_root = Path(os.getenv("DRSAI_HOME", str(Path.home() / ".drsai")))
    parser.add_argument("--runtime-id", required=True)
    parser.add_argument("--workspace-id", required=True)
    parser.add_argument("--session-id", required=True)
    parser.add_argument(
        "--base-url",
        default="https://ai-dev.ihep.ac.cn/api/runtime-relay",
    )
    parser.add_argument("--gateway-url", default="http://127.0.0.1:18642")
    parser.add_argument("--gateway-port", type=int, default=18642)
    parser.add_argument(
        "--token-path",
        type=Path,
        default=state_root / "runtime/instance-token",
    )
    parser.add_argument("--duration-seconds", type=int, default=3600)
    parser.add_argument("--interval-seconds", type=int, default=10)
    parser.add_argument("--fault-hold-seconds", type=int, default=5)
    parser.add_argument("--recovery-timeout-seconds", type=int, default=180)
    parser.add_argument("--relay-fault-ttl-seconds", type=int, default=5)
    parser.add_argument("--device", default="R5GYB3S8ACH")
    parser.add_argument("--package", default="ai.drsai.remote.debug")
    parser.add_argument(
        "--adb",
        default=str(
            Path(os.getenv("LOCALAPPDATA", ""))
            / "Android/Sdk/platform-tools/adb.exe"
        ),
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(
            "release/product-evidence/mobile-remote-workspace-v3/"
            "real-stability-1h.json"
        ),
    )
    args = parser.parse_args()
    if (
        args.duration_seconds < 3600
        or args.interval_seconds < 1
        or args.recovery_timeout_seconds < 30
    ):
        raise SystemExit(
            "V3 release stability requires duration>=3600, interval>=1, "
            "recovery-timeout>=30"
        )
    result = asyncio.run(monitor(args))
    print(
        json.dumps(
            {key: value for key, value in result.items() if key != "samples"},
            indent=2,
        )
    )
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
