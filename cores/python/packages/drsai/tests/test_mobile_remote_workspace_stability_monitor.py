from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from types import SimpleNamespace


ROOT = Path(__file__).resolve().parents[5]
SCRIPT = ROOT / "scripts/monitor_mobile_remote_workspace_stability_v2.py"
SPEC = importlib.util.spec_from_file_location("mobile_stability_monitor", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def sample(elapsed: float, memory: int, handles: int, generation: int = 3):
    return MODULE.Sample(
        elapsed, 25, "online", generation, 4, True, 123, 456,
        memory, handles, "a" * 64,
    )


def test_stability_report_requires_full_window_and_bounded_slopes() -> None:
    incomplete = MODULE.report([sample(0, 100, 10), sample(30, 200, 11)], 60)
    assert incomplete["passed"] is False
    complete = MODULE.report([sample(0, 100, 10), sample(60, 200, 10)], 60)
    assert complete["passed"] is True
    assert complete["transcript_hash_stable"] is True
    assert complete["probe_error_count"] == 0
    assert complete["android_pid_unique_count"] == 1


def test_stability_report_rejects_generation_churn_and_hash_drift() -> None:
    first = sample(0, 100, 10, 1)
    second = MODULE.Sample(
        60, 25, "online", 5, 4, True, 123, 456, 200, 10, "b" * 64
    )
    result = MODULE.report([first, second], 60)
    assert result["passed"] is False
    assert result["transcript_hash_count"] == 2


def test_stability_report_rejects_single_generation_restart() -> None:
    first = sample(0, 100, 10, 1)
    second = sample(60, 200, 10, 2)
    assert MODULE.report([first, second], 60)["passed"] is False


def test_stability_report_rejects_android_process_restart() -> None:
    first = sample(0, 100, 10)
    second = MODULE.Sample(
        60, 25, "online", 3, 4, True, 999, 456, 200, 10, "a" * 64
    )
    result = MODULE.report([first, second], 60)
    assert result["passed"] is False
    assert result["android_pid_unique_count"] == 2


def test_stability_report_fails_closed_when_any_required_probe_is_missing() -> None:
    healthy = sample(0, 100, 10)
    cases = [
        MODULE.Sample(60, 25, "probe_error", 3, 4, True, 123, 456, 200, 10, "a" * 64),
        MODULE.Sample(60, 25, "online", 3, 0, True, 123, 456, 200, 10, "a" * 64),
        MODULE.Sample(60, 25, "online", 3, 4, True, 123, None, None, None, "a" * 64),
        MODULE.Sample(60, 25, "online", 3, 4, True, 123, 456, 200, 10, None),
        MODULE.Sample(60, 2_500, "online", 3, 4, True, 123, 456, 200, 10, "a" * 64),
    ]
    for missing in cases:
        assert MODULE.report([healthy, missing], 60)["passed"] is False


def test_android_probe_uses_foreground_receiver_and_never_exports_bearer(
    monkeypatch,
) -> None:
    calls: list[list[str]] = []
    proof = {
        "nonce": "a" * 32,
        "status": "passed",
        "runtime_status": "online",
        "runtime_generation": 7,
        "workspace_count": 4,
        "transcript_sha256": "b" * 64,
    }

    def fake_run(command, **_kwargs):
        calls.append(command)
        if "broadcast" in command:
            proof["nonce"] = command[command.index("nonce") + 1]
            return SimpleNamespace(returncode=0, stdout="Broadcast completed: result=0")
        return SimpleNamespace(returncode=0, stdout=json.dumps(proof))

    monkeypatch.setattr(MODULE.subprocess, "run", fake_run)
    args = SimpleNamespace(
        adb="adb",
        device="device",
        package="ai.drsai.remote.debug",
        runtime_id="runtime-1",
        workspace_id="workspace-1",
        session_id="session-1",
        base_url="https://ai-dev.ihep.ac.cn/api/runtime-relay",
    )
    result, _latency = MODULE.android_probe(args)
    assert result["status"] == "passed"
    assert "--receiver-foreground" in calls[0]
    flattened = " ".join(part for call in calls for part in call).lower()
    assert "authorization" not in flattened
    assert "bearer" not in flattened
