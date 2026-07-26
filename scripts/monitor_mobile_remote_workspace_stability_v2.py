"""One-hour stability monitor for the real Mobile Remote Workspace chain.

The debug Android app performs authenticated probes internally. Its OIDC bearer
never leaves secure storage; ADB reads only a nonce-bound sanitized proof.
"""
from __future__ import annotations

import argparse
import asyncio
import csv
import json
import math
import os
import statistics
import subprocess
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from uuid import uuid4


PROBE_ACTION = "ai.drsai.remote.debug.STABILITY_PROBE"
PROBE_RECEIVER = "ai.drsai.remote.remote.debug.StabilityProbeReceiver"
PROBE_FILE = "no_backup/remote-workspace-stability-proof.json"


@dataclass(frozen=True)
class Sample:
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
    transcript_sha256: str | None


def percentile(values: list[int], fraction: float) -> int:
    if not values:
        return 0
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, max(0, math.ceil(len(ordered) * fraction) - 1))]


def slope(values: list[int | None], elapsed: list[float]) -> float | None:
    points = [(x, float(y)) for x, y in zip(elapsed, values) if y is not None]
    if len(points) < 2:
        return None
    mean_x = statistics.fmean(x for x, _ in points)
    mean_y = statistics.fmean(y for _, y in points)
    denominator = sum((x - mean_x) ** 2 for x, _ in points)
    if denominator == 0:
        return 0.0
    return sum((x - mean_x) * (y - mean_y) for x, y in points) / denominator


def gateway_pid(port: int) -> int | None:
    result = subprocess.run(
        ["netstat.exe", "-ano", "-p", "TCP"],
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    marker = f":{port}"
    for line in result.stdout.splitlines():
        fields = line.split()
        if len(fields) >= 5 and fields[1].endswith(marker) and fields[3] == "LISTENING":
            return int(fields[4])
    return None


def windows_process_counters(pid: int | None) -> tuple[int | None, int | None]:
    if pid is None or os.name != "nt":
        return None, None
    command = [
        "powershell.exe",
        "-NoProfile",
        "-Command",
        f"$p=Get-Process -Id {pid} -ErrorAction Stop; "
        "[Console]::WriteLine(('{0},{1}' -f $p.WorkingSet64,$p.HandleCount))",
    ]
    result = subprocess.run(command, check=False, capture_output=True, text=True)
    if result.returncode:
        return None, None
    try:
        working_set, handles = next(csv.reader([result.stdout.strip()]))
        return int(working_set), int(handles)
    except (ValueError, StopIteration):
        return None, None


def android_state(adb: str, serial: str, package: str) -> tuple[bool, int | None]:
    state = subprocess.run(
        [adb, "-s", serial, "get-state"], check=False, capture_output=True, text=True
    )
    if state.returncode or state.stdout.strip() != "device":
        return False, None
    pid = subprocess.run(
        [adb, "-s", serial, "shell", "pidof", package],
        check=False,
        capture_output=True,
        text=True,
    ).stdout.strip()
    return True, int(pid.split()[0]) if pid else None


def start_android_app(args: argparse.Namespace) -> int:
    launched = subprocess.run(
        [
            args.adb, "-s", args.device, "shell", "am", "start", "-W",
            "-n", f"{args.package}/{args.activity}",
        ],
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=20,
    )
    if launched.returncode or "Status: ok" not in launched.stdout:
        raise RuntimeError("stability_android_app_launch_failed")
    online, pid = android_state(args.adb, args.device, args.package)
    if not online or pid is None:
        raise RuntimeError("stability_android_process_missing")
    return pid


def android_probe(args: argparse.Namespace) -> tuple[dict[str, Any], int]:
    nonce = uuid4().hex
    started = time.perf_counter()
    component = f"{args.package}/{PROBE_RECEIVER}"
    dispatched = subprocess.run(
        [
            args.adb, "-s", args.device, "shell", "am", "broadcast",
            "--receiver-foreground",
            "-a", PROBE_ACTION,
            "-n", component,
            "--es", "nonce", nonce,
            "--es", "runtime_id", args.runtime_id,
            "--es", "workspace_id", args.workspace_id,
            "--es", "session_id", args.session_id,
            "--es", "relay_base_url", args.base_url.rstrip("/"),
        ],
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=15,
    )
    if dispatched.returncode or "result=0" not in dispatched.stdout:
        raise RuntimeError("stability_android_probe_dispatch_failed")
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        read = subprocess.run(
            [
                args.adb, "-s", args.device, "shell", "run-as", args.package,
                "cat", PROBE_FILE,
            ],
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=5,
        )
        if read.returncode == 0:
            try:
                proof = json.loads(read.stdout)
            except json.JSONDecodeError:
                proof = {}
            if proof.get("nonce") == nonce:
                if proof.get("status") != "passed":
                    raise RuntimeError(
                        f"stability_android_probe_failed:{proof.get('error_code', 'unknown')}"
                    )
                return proof, round((time.perf_counter() - started) * 1000)
        time.sleep(0.25)
    raise RuntimeError("stability_android_probe_timeout")


def report(samples: list[Sample], duration_seconds: int) -> dict[str, Any]:
    elapsed = [item.elapsed_seconds for item in samples]
    memory_slope = slope([item.windows_working_set_bytes for item in samples], elapsed)
    handle_slope = slope([item.windows_handle_count for item in samples], elapsed)
    generations = [item.generation for item in samples if item.generation is not None]
    hashes = {item.transcript_sha256 for item in samples if item.transcript_sha256}
    android_pids = {item.android_pid for item in samples if item.android_pid is not None}
    probe_errors = sum(item.runtime_status == "probe_error" for item in samples)
    completed_window = bool(samples and samples[-1].elapsed_seconds >= duration_seconds)
    passed = (
        completed_window
        and probe_errors == 0
        and all(item.runtime_status == "online" for item in samples)
        and all(item.workspace_count > 0 for item in samples)
        and all(item.android_online and item.android_pid is not None for item in samples)
        and len(android_pids) == 1
        and all(
            item.windows_pid is not None
            and item.windows_working_set_bytes is not None
            and item.windows_handle_count is not None
            for item in samples
        )
        and (not generations or max(generations) == min(generations))
        and len(generations) == len(samples)
        and len(hashes) == 1
        and all(item.transcript_sha256 for item in samples)
        and percentile([item.relay_latency_ms for item in samples], 0.95) < 2_000
        and (memory_slope is None or memory_slope < 1024 * 1024 / 60)
        and (handle_slope is None or handle_slope < 1 / 60)
    )
    return {
        "schema_version": 1,
        "required_duration_seconds": duration_seconds,
        "observed_duration_seconds": samples[-1].elapsed_seconds if samples else 0,
        "sample_count": len(samples),
        "relay_latency_p95_ms": percentile([item.relay_latency_ms for item in samples], 0.95),
        "runtime_generation_min": min(generations) if generations else None,
        "runtime_generation_max": max(generations) if generations else None,
        "windows_memory_slope_bytes_per_second": memory_slope,
        "windows_handle_slope_per_second": handle_slope,
        "transcript_hash_count": len(hashes),
        "transcript_hash_stable": len(hashes) == 1 and all(
            item.transcript_sha256 for item in samples
        ),
        "probe_error_count": probe_errors,
        "probe_errors": probe_errors,
        "android_pid_unique_count": len(android_pids),
        "workspace_empty_sample_count": sum(item.workspace_count <= 0 for item in samples),
        "android_process_missing_sample_count": sum(item.android_pid is None for item in samples),
        "windows_counter_missing_sample_count": sum(
            item.windows_pid is None
            or item.windows_working_set_bytes is None
            or item.windows_handle_count is None
            for item in samples
        ),
        "passed": passed,
        "samples": [asdict(item) for item in samples],
    }


async def monitor(args: argparse.Namespace) -> dict[str, Any]:
    start_android_app(args)
    started = time.monotonic()
    samples: list[Sample] = []
    while True:
        elapsed = time.monotonic() - started
        proof: dict[str, Any] = {}
        latency = 0
        probe_error = False
        try:
            proof, latency = android_probe(args)
        except (OSError, subprocess.SubprocessError, RuntimeError, json.JSONDecodeError):
            probe_error = True
        online, android_pid = android_state(args.adb, args.device, args.package)
        windows_pid = gateway_pid(args.gateway_port)
        memory, handles = windows_process_counters(windows_pid)
        samples.append(Sample(
            round(elapsed, 3),
            latency,
            "probe_error" if probe_error else str(proof.get("runtime_status", "unknown")),
            proof.get("runtime_generation"),
            int(proof.get("workspace_count", 0)),
            online,
            android_pid,
            windows_pid,
            memory,
            handles,
            proof.get("transcript_sha256"),
        ))
        current = report(samples, args.duration_seconds)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        temporary = args.output.with_suffix(args.output.suffix + ".tmp")
        temporary.write_text(json.dumps(current, indent=2) + "\n", encoding="utf-8")
        temporary.replace(args.output)
        if elapsed >= args.duration_seconds:
            return current
        await asyncio.sleep(min(args.interval_seconds, args.duration_seconds - elapsed))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime-id", required=True)
    parser.add_argument("--workspace-id", required=True)
    parser.add_argument("--session-id", required=True)
    parser.add_argument("--base-url", default="https://ai-dev.ihep.ac.cn/api/runtime-relay")
    parser.add_argument("--duration-seconds", type=int, default=3600)
    parser.add_argument("--interval-seconds", type=int, default=10)
    parser.add_argument("--gateway-port", type=int, default=18643)
    parser.add_argument("--device", default="R5GYB3S8ACH")
    parser.add_argument("--package", default="ai.drsai.remote.debug")
    parser.add_argument("--activity", default="ai.drsai.remote.MainActivity")
    parser.add_argument(
        "--adb",
        default=str(
            Path(os.getenv("LOCALAPPDATA", "")) / "Android/Sdk/platform-tools/adb.exe"
        ),
    )
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.duration_seconds < 60 or args.interval_seconds < 1:
        raise SystemExit("duration must be >=60 seconds and interval >=1 second")
    result = asyncio.run(monitor(args))
    print(json.dumps({key: value for key, value in result.items() if key != "samples"}, indent=2))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
