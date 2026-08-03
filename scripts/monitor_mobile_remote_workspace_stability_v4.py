"""One-hour OAEP stability and five-fault recovery gate for V4.

The Android bearer never leaves Android secure storage.  Each probe is
nonce-bound and exports only protocol metadata, counters, identifiers needed
for fencing checks, and a canonical OAEP item digest.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from accept_mobile_remote_workspace_real_device_v2 import GatewayPairingClient
from drsai.version import __version__ as CURRENT_RUNTIME_VERSION
from monitor_mobile_remote_workspace_stability_v2 import (
    android_probe,
    android_state,
    gateway_pid,
    percentile,
    slope,
    windows_process_counters,
)
from monitor_mobile_remote_workspace_stability_v3 import (
    FAULT_NAMES,
    _identity_transition_valid,
    _inject,
    _open_session,
)


DIGEST = re.compile(r"^[0-9a-f]{64}$")


@dataclass(frozen=True)
class OaepSample:
    elapsed_seconds: float
    relay_latency_ms: int
    runtime_status: str
    generation: int | None
    workspace_count: int
    android_online: bool
    android_pid: int | None
    windows_pid: int | None
    windows_working_set_bytes: int | None
    windows_handle_count: int | None
    schema_hash: str | None
    snapshot_sequence: int | None
    item_count: int | None
    run_count: int | None
    event_count: int | None
    duplicate_sequence_count: int | None
    missing_sequence_count: int | None
    oaep_sha256: str | None


@dataclass(frozen=True)
class OaepFault:
    name: str
    status: str
    started_at_seconds: float
    recovered_at_seconds: float
    recovery_seconds: float
    oaep_hash_preserved: bool
    sequence_preserved: bool
    item_count_preserved: bool
    run_count_preserved: bool
    event_count_preserved: bool
    duplicate_sequence_count: int
    missing_sequence_count: int
    generation_before: int | None
    generation_after: int | None
    android_pid_before: int | None
    android_pid_after: int | None
    windows_pid_before: int | None
    windows_pid_after: int | None
    identity_transition_valid: bool
    failure_code: str | None = None


def _safe_error_code(exc: BaseException) -> str:
    raw = str(exc)
    if 1 <= len(raw) <= 160 and all(character.isalnum() or character in "_:.-" for character in raw):
        return raw
    return type(exc).__name__


def _probe(proof: dict[str, Any]) -> dict[str, Any]:
    integer_keys = (
        "snapshot_sequence", "item_count", "run_count", "event_count",
        "duplicate_sequence_count", "missing_sequence_count",
    )
    if proof.get("protocol") != "oaep/1" or not DIGEST.fullmatch(str(proof.get("schema_hash", ""))):
        raise RuntimeError("v4_stability_protocol_invalid")
    if not DIGEST.fullmatch(str(proof.get("oaep_sha256", ""))):
        raise RuntimeError("v4_stability_digest_invalid")
    if any(
        not isinstance(proof.get(key), int)
        or isinstance(proof.get(key), bool)
        or int(proof[key]) < 0
        for key in integer_keys
    ):
        raise RuntimeError("v4_stability_counters_invalid")
    if proof["duplicate_sequence_count"] or proof["missing_sequence_count"]:
        raise RuntimeError("v4_stability_sequence_integrity_invalid")
    if proof["snapshot_sequence"] > 0 and proof["event_count"] == 0:
        raise RuntimeError("v4_stability_events_missing")
    return proof


def _fault_passed(row: OaepFault) -> bool:
    return (
        row.status == "passed"
        and row.oaep_hash_preserved
        and row.sequence_preserved
        and row.item_count_preserved
        and row.run_count_preserved
        and row.event_count_preserved
        and row.duplicate_sequence_count == 0
        and row.missing_sequence_count == 0
        and row.identity_transition_valid
    )


def evaluate(
    samples: list[OaepSample],
    faults: list[OaepFault],
    duration_seconds: int,
    probe_errors: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    elapsed = [row.elapsed_seconds for row in samples]
    memory_slope = slope([row.windows_working_set_bytes for row in samples], elapsed)
    handle_slope = slope([row.windows_handle_count for row in samples], elapsed)
    hashes = {row.oaep_sha256 for row in samples if row.oaep_sha256}
    schemas = {row.schema_hash for row in samples if row.schema_hash}
    errors = list(probe_errors or ())
    completed = bool(samples and samples[-1].elapsed_seconds >= duration_seconds)
    memory_ok = memory_slope is not None and memory_slope < 1024 * 1024 / 60
    handles_ok = handle_slope is not None and handle_slope < 1 / 60
    good_faults = {row.name for row in faults if _fault_passed(row)}
    passed = (
        completed
        and not errors
        and bool(samples)
        and all(row.runtime_status == "online" for row in samples)
        and all(row.workspace_count > 0 and row.android_online for row in samples)
        and all(
            row.android_pid is not None
            and row.windows_pid is not None
            and row.windows_working_set_bytes is not None
            and row.windows_handle_count is not None
            for row in samples
        )
        and len(hashes) == 1
        and len(schemas) == 1
        and percentile([row.relay_latency_ms for row in samples], 0.95) < 2_000
        and memory_ok
        and handles_ok
        and good_faults == set(FAULT_NAMES)
    )
    return {
        "schema_version": 1,
        "profile": "mobile-remote-workspace-v4-oaep",
        "protocol": "oaep/1",
        "schema_hash": next(iter(schemas), None),
        "required_duration_seconds": duration_seconds,
        "observed_duration_seconds": samples[-1].elapsed_seconds if samples else 0,
        "sample_count": len(samples),
        "relay_latency_p95_ms": percentile([row.relay_latency_ms for row in samples], 0.95),
        "windows_memory_slope_bytes_per_second": memory_slope,
        "windows_handle_slope_per_second": handle_slope,
        "memory_within_threshold": memory_ok,
        "handle_count_within_threshold": handles_ok,
        "oaep_hash_count": len(hashes),
        "oaep_hash_stable": len(hashes) == 1 and bool(samples),
        "probe_error_count": len(errors),
        "probe_errors": errors,
        "faults": [asdict(row) for row in faults],
        "passed": passed,
        "samples": [asdict(row) for row in samples],
    }


def _atomic_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


async def _wait_probe(args: argparse.Namespace, timeout_seconds: int) -> tuple[dict[str, Any], int]:
    deadline = time.monotonic() + timeout_seconds
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            proof, latency = await asyncio.to_thread(android_probe, args)
            return _probe(proof), latency
        except Exception as exc:  # bounded real recovery retry
            last_error = exc
            await asyncio.sleep(1)
    raise RuntimeError(f"v4_stability_recovery_timeout:{type(last_error).__name__ if last_error else 'unknown'}")


async def _fault(
    args: argparse.Namespace,
    name: str,
    service: GatewayPairingClient,
    started: float,
) -> OaepFault:
    before, _ = await _wait_probe(args, args.recovery_timeout_seconds)
    _, android_before = android_state(args.adb, args.device, args.package)
    windows_before = gateway_pid(args.gateway_port)
    began = time.monotonic()
    await _inject(args, name, service)
    after, _ = await _wait_probe(args, args.recovery_timeout_seconds)
    recovered = time.monotonic()
    _, android_after = android_state(args.adb, args.device, args.package)
    windows_after = gateway_pid(args.gateway_port)
    identity_ok = _identity_transition_valid(
        name,
        generation_before=before.get("runtime_generation"),
        generation_after=after.get("runtime_generation"),
        android_pid_before=android_before,
        android_pid_after=android_after,
        windows_pid_before=windows_before,
        windows_pid_after=windows_after,
    )
    values = dict(
        name=name,
        started_at_seconds=round(began - started, 3),
        recovered_at_seconds=round(recovered - started, 3),
        recovery_seconds=round(recovered - began, 3),
        oaep_hash_preserved=before["oaep_sha256"] == after["oaep_sha256"],
        sequence_preserved=before["snapshot_sequence"] == after["snapshot_sequence"],
        item_count_preserved=before["item_count"] == after["item_count"],
        run_count_preserved=before["run_count"] == after["run_count"],
        event_count_preserved=before["event_count"] == after["event_count"],
        duplicate_sequence_count=max(before["duplicate_sequence_count"], after["duplicate_sequence_count"]),
        missing_sequence_count=max(before["missing_sequence_count"], after["missing_sequence_count"]),
        generation_before=before.get("runtime_generation"),
        generation_after=after.get("runtime_generation"),
        android_pid_before=android_before,
        android_pid_after=android_after,
        windows_pid_before=windows_before,
        windows_pid_after=windows_after,
        identity_transition_valid=identity_ok,
    )
    candidate = OaepFault(status="passed", **values)
    return candidate if _fault_passed(candidate) else OaepFault(status="failed", **values)


def _failed_fault(args: argparse.Namespace, name: str, started: float, began: float, exc: BaseException) -> OaepFault:
    _, android_pid = android_state(args.adb, args.device, args.package)
    windows_pid = gateway_pid(args.gateway_port)
    return OaepFault(
        name=name,
        status="failed",
        started_at_seconds=round(began - started, 3),
        recovered_at_seconds=round(time.monotonic() - started, 3),
        recovery_seconds=round(time.monotonic() - began, 3),
        oaep_hash_preserved=False,
        sequence_preserved=False,
        item_count_preserved=False,
        run_count_preserved=False,
        event_count_preserved=False,
        duplicate_sequence_count=0,
        missing_sequence_count=0,
        generation_before=None,
        generation_after=None,
        android_pid_before=android_pid,
        android_pid_after=android_pid,
        windows_pid_before=windows_pid,
        windows_pid_after=windows_pid,
        identity_transition_valid=False,
        failure_code=_safe_error_code(exc),
    )


def _sample(args: argparse.Namespace, proof: dict[str, Any], latency: int, elapsed: float) -> OaepSample:
    online, android_pid = android_state(args.adb, args.device, args.package)
    windows_pid = gateway_pid(args.gateway_port)
    memory, handles = windows_process_counters(windows_pid)
    return OaepSample(
        elapsed_seconds=round(elapsed, 3),
        relay_latency_ms=latency,
        runtime_status=str(proof.get("runtime_status", "unknown")),
        generation=proof.get("runtime_generation"),
        workspace_count=int(proof.get("workspace_count", 0)),
        android_online=online,
        android_pid=android_pid,
        windows_pid=windows_pid,
        windows_working_set_bytes=memory,
        windows_handle_count=handles,
        schema_hash=proof.get("schema_hash"),
        snapshot_sequence=proof.get("snapshot_sequence"),
        item_count=proof.get("item_count"),
        run_count=proof.get("run_count"),
        event_count=proof.get("event_count"),
        duplicate_sequence_count=proof.get("duplicate_sequence_count"),
        missing_sequence_count=proof.get("missing_sequence_count"),
        oaep_sha256=proof.get("oaep_sha256"),
    )


async def monitor(args: argparse.Namespace) -> dict[str, Any]:
    service = GatewayPairingClient(args.gateway_url, args.token_path, timeout_seconds=15)
    await asyncio.to_thread(_open_session, args)
    started = time.monotonic()
    samples: list[OaepSample] = []
    faults: list[OaepFault] = []
    errors: list[dict[str, Any]] = []
    next_fault = 0
    offsets = [args.duration_seconds * fraction for fraction in (1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6)]
    while True:
        elapsed = time.monotonic() - started
        if next_fault < len(FAULT_NAMES) and elapsed >= offsets[next_fault]:
            name = FAULT_NAMES[next_fault]
            began = time.monotonic()
            try:
                faults.append(await _fault(args, name, service, started))
            except Exception as exc:
                faults.append(_failed_fault(args, name, started, began, exc))
                _atomic_json(args.output, evaluate(samples, faults, args.duration_seconds, errors))
                raise
            next_fault += 1
            elapsed = time.monotonic() - started
        try:
            proof, latency = await asyncio.to_thread(android_probe, args)
            samples.append(_sample(args, _probe(proof), latency, elapsed))
        except Exception as exc:
            errors.append({"elapsed_seconds": round(elapsed, 3), "code": _safe_error_code(exc)})
            samples.append(_sample(args, {}, 0, elapsed))
        report = evaluate(samples, faults, args.duration_seconds, errors)
        _atomic_json(args.output, report)
        if elapsed >= args.duration_seconds:
            return report
        await asyncio.sleep(min(args.interval_seconds, args.duration_seconds - elapsed))


async def fault_matrix(args: argparse.Namespace) -> dict[str, Any]:
    service = GatewayPairingClient(args.gateway_url, args.token_path, timeout_seconds=15)
    await asyncio.to_thread(_open_session, args)
    started = time.monotonic()
    faults = [await _fault(args, name, service, started) for name in FAULT_NAMES]
    result = {
        "schema_version": 1,
        "profile": "mobile-remote-workspace-v4-oaep-fault-matrix",
        "protocol": "oaep/1",
        "passed": all(_fault_passed(row) for row in faults),
        "faults": [asdict(row) for row in faults],
    }
    _atomic_json(args.output, result)
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    state_root = Path(os.getenv("DRSAI_HOME", str(Path.home() / ".drsai")))
    parser.add_argument("--runtime-id", required=True)
    parser.add_argument("--workspace-id", required=True)
    parser.add_argument("--session-id", required=True)
    parser.add_argument("--base-url", default="https://ai-dev.ihep.ac.cn/api/runtime-relay")
    parser.add_argument("--gateway-url", default="http://127.0.0.1:18642")
    parser.add_argument("--gateway-port", type=int, default=18642)
    parser.add_argument("--state-root", type=Path, default=state_root)
    parser.add_argument("--runtime-python", default=sys.executable)
    parser.add_argument("--runtime-version", default=CURRENT_RUNTIME_VERSION)
    parser.add_argument("--token-path", type=Path, default=state_root / "runtime/instance-token")
    parser.add_argument("--duration-seconds", type=int, default=3600)
    parser.add_argument("--interval-seconds", type=int, default=10)
    parser.add_argument("--fault-hold-seconds", type=int, default=5)
    parser.add_argument("--recovery-timeout-seconds", type=int, default=180)
    parser.add_argument("--relay-fault-ttl-seconds", type=int, default=5)
    parser.add_argument("--supervisor-restart-grace-seconds", type=float, default=10.0)
    parser.add_argument("--fault-only", action="store_true")
    parser.add_argument("--probe-only", action="store_true")
    parser.add_argument("--device", default="R5GYB3S8ACH")
    parser.add_argument("--package", default="ai.drsai.remote.acceptance")
    parser.add_argument("--adb", default=str(Path(os.getenv("LOCALAPPDATA", "")) / "Android/Sdk/platform-tools/adb.exe"))
    parser.add_argument("--output", type=Path, default=Path("release/product-evidence/mobile-remote-workspace-v4/real-stability-1h.json"))
    args = parser.parse_args()
    args.probe_protocol = "oaep/1"
    if ((not args.fault_only and not args.probe_only and args.duration_seconds < 3600)
            or args.interval_seconds < 1 or args.recovery_timeout_seconds < 30):
        raise SystemExit("V4 release stability requires duration>=3600, interval>=1, recovery-timeout>=30")
    if args.probe_only:
        proof, latency = android_probe(args)
        proof = _probe(proof)
        result = {
            "schema_version": 1,
            "profile": "mobile-remote-workspace-v4-oaep-probe",
            "passed": True,
            "latency_ms": latency,
            **{key: proof.get(key) for key in (
                "protocol", "schema_hash", "runtime_status", "runtime_generation",
                "workspace_count", "snapshot_sequence", "item_count", "run_count",
                "event_count", "duplicate_sequence_count", "missing_sequence_count", "oaep_sha256",
            )},
        }
    else:
        result = asyncio.run(fault_matrix(args) if args.fault_only else monitor(args))
    print(json.dumps({key: value for key, value in result.items() if key != "samples"}, indent=2))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
