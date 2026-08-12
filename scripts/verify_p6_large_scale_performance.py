#!/usr/bin/env python3
"""Real-path P6 scale gate for catalogs, history windows and OAEP replay."""
from __future__ import annotations

import base64
import ctypes
import json
import os
from pathlib import Path
import statistics
import subprocess
import sys
import tempfile
import time

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "cores/python/packages/drsai/src"
if str(SOURCE) not in sys.path:
    sys.path.insert(0, str(SOURCE))

from drsai.relay.models import Workspace  # noqa: E402
from drsai.relay.registry import RelayRegistry  # noqa: E402
from drsai.relay.runtime_domain import AgentDefinition, RuntimeAuthority  # noqa: E402


def _rss_bytes() -> int:
    if os.name == "nt":
        class Counters(ctypes.Structure):
            _fields_ = [
                ("cb", ctypes.c_ulong), ("PageFaultCount", ctypes.c_ulong),
                ("PeakWorkingSetSize", ctypes.c_size_t), ("WorkingSetSize", ctypes.c_size_t),
                ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                ("PagefileUsage", ctypes.c_size_t), ("PeakPagefileUsage", ctypes.c_size_t),
            ]
        counters = Counters()
        counters.cb = ctypes.sizeof(counters)
        get_current_process = ctypes.windll.kernel32.GetCurrentProcess
        get_current_process.restype = ctypes.c_void_p
        get_process_memory_info = ctypes.windll.psapi.GetProcessMemoryInfo
        get_process_memory_info.argtypes = [
            ctypes.c_void_p, ctypes.POINTER(Counters), ctypes.c_ulong,
        ]
        get_process_memory_info.restype = ctypes.c_int
        process = get_current_process()
        if not get_process_memory_info(
            process, ctypes.byref(counters), counters.cb
        ):
            raise RuntimeError("p6_scale_rss_unavailable")
        return int(counters.WorkingSetSize)
    status = Path("/proc/self/status")
    if status.is_file():
        for line in status.read_text().splitlines():
            if line.startswith("VmRSS:"):
                return int(line.split()[1]) * 1024
    raise RuntimeError("p6_scale_rss_unavailable")


def _p95(values: list[float]) -> float:
    return statistics.quantiles(values, n=100)[94] if len(values) > 1 else values[0]


def _catalog_scale() -> dict[str, object]:
    private = Ed25519PrivateKey.generate()
    public = base64.urlsafe_b64encode(private.public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw
    )).rstrip(b"=").decode()
    registry = RelayRegistry(cursor_secret=b"g" * 32)
    runtime_id, token = registry.register(
        registry.issue_registration_code(), "Scale PC", "2.0.0", public, "scale-register-key"
    )
    _, grant, _ = registry.issue_access_grant(runtime_id, token)
    registry.associate("scale-subject", grant, "scale-device", "Scale Device", public)
    registry.publish_workspaces(runtime_id, token, [
        Workspace(runtime_id=runtime_id, workspace_id=f"workspace-{index:04d}", display_name="Scale")
        for index in range(100)
    ])
    workspace_latencies: list[float] = []
    workspace_ids: list[str] = []
    cursor = None
    while True:
        started = time.perf_counter()
        page, cursor = registry.list_workspaces(
            "scale-subject", runtime_id, cursor=cursor, limit=17
        )
        workspace_latencies.append((time.perf_counter() - started) * 1_000)
        workspace_ids.extend(item.workspace_id for item in page)
        if cursor is None:
            break
    if not (len(workspace_ids) == len(set(workspace_ids)) == 100):
        raise RuntimeError("p6_scale_workspace_catalog_invalid")

    authority = RuntimeAuthority(
        runtime_id, cursor_secret=b"r" * 32
    )
    authority.add_agent_definition(AgentDefinition(
        "agent", "1.0.0", "Agent", "backend", "healthy", frozenset()
    ))
    rss_before = _rss_bytes()
    for index in range(10_000):
        authority.create_session(
            "scale-subject", "workspace-scale", title="Scale Session",
            definition_id="agent", definition_version="1.0.0",
            idempotency_key=f"session-key-{index:05d}",
        )
    session_latencies: list[float] = []
    session_ids: list[str] = []
    cursor = None
    while True:
        started = time.perf_counter()
        page, cursor = authority.list_sessions(
            "workspace-scale", cursor=cursor, limit=100
        )
        session_latencies.append((time.perf_counter() - started) * 1_000)
        session_ids.extend(item.session_id for item in page)
        if cursor is None:
            break
    rss_delta = max(0, _rss_bytes() - rss_before)
    if not (len(session_ids) == len(set(session_ids)) == 10_000):
        raise RuntimeError("p6_scale_session_catalog_invalid")
    workspace_p95 = _p95(workspace_latencies)
    session_p95 = _p95(session_latencies)
    if workspace_p95 > 100 or session_p95 > 250 or rss_delta > 512 * 1024 * 1024:
        raise RuntimeError("p6_scale_catalog_budget_exceeded")
    return {
        "workspace_count": 100,
        "workspace_page_p95_ms": round(workspace_p95, 3),
        "session_count": 10_000,
        "session_page_p95_ms": round(session_p95, 3),
        "rss_delta_bytes": rss_delta,
    }


def _runtime_and_relay_scale() -> None:
    nodes = [
        "cores/python/packages/drsai/tests/test_oaep_snapshot_window.py::test_100k_item_cold_start_is_bounded_and_streams_checkpoint_hash",
        "cores/python/packages/drsai/tests/test_relay_oaep_performance.py::test_10k_oaep_events_have_bounded_replay_latency_and_memory",
    ]
    # Each heavy scenario owns a fresh process. This prevents the 100k Item
    # tracemalloc budget from being contaminated by the Relay's 10k Event
    # object graph or by a parent pytest process running the verifier.
    for index, node in enumerate(nodes):
        environment = os.environ.copy()
        environment.pop("PYTEST_CURRENT_TEST", None)
        completed = subprocess.run(
            [sys.executable, "-m", "pytest", "-q", node, "-p", "no:cacheprovider"],
            cwd=ROOT, env=environment, stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT, text=True, timeout=180,
        )
        if completed.returncode != 0:
            raise RuntimeError(
                f"p6_scale_runtime_relay_failed:{index}:{completed.returncode}:"
                f"{len(completed.stdout.encode('utf-8'))}"
            )


def _android_gate_contract() -> None:
    source = (ROOT / "apps/android/app/src/androidTest/java/ai/drsai/remote/"
              "P5LongSessionPerformanceTest.kt").read_text(encoding="utf-8")
    required = (
        "TOTAL_ITEMS = 100_000", "DELTA_COUNT = 10_000",
        "DELTA_MIN_THROUGHPUT_PER_SECOND = 10_000L",
        "p6_delta_throughput_budget_exceeded", "cold_pss_delta_kb",
        "workerStarts <= DELTA_BATCHES", "render_cycles",
    )
    if any(value not in source for value in required):
        raise RuntimeError("p6_scale_android_physical_contract_missing")


def verify() -> dict[str, object]:
    with tempfile.TemporaryDirectory(prefix="opendrsai-p6-scale-"):
        catalogs = _catalog_scale()
        _runtime_and_relay_scale()
        _android_gate_contract()
    return {
        "passed": True,
        **catalogs,
        "item_count": 100_000,
        "item_window_memory_bounded": True,
        "oaep_event_count": 10_000,
        "oaep_replay_p95_bounded": True,
        "android_delta_target_per_second": 10_000,
        "content_free": True,
    }


def main() -> int:
    print(json.dumps(verify(), sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
