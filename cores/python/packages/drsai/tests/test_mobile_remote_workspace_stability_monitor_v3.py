from __future__ import annotations

import asyncio
import importlib.util
import sys
from pathlib import Path
from types import SimpleNamespace


ROOT = Path(__file__).resolve().parents[5]
SCRIPTS = ROOT / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))
SCRIPT = SCRIPTS / "monitor_mobile_remote_workspace_stability_v3.py"
SPEC = importlib.util.spec_from_file_location("mobile_stability_monitor_v3", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def sample(
    elapsed: float,
    *,
    digest: str = "a" * 64,
    generation: int = 1,
    android_pid: int = 10,
    windows_pid: int = 20,
    memory: int = 1_000,
    handles: int = 10,
):
    return MODULE.Sample(
        elapsed,
        25,
        "online",
        generation,
        4,
        True,
        android_pid,
        windows_pid,
        memory,
        handles,
        digest,
    )


def fault(
    name: str,
    *,
    generation_before: int = 1,
    generation_after: int = 1,
    pid_before: int = 10,
    pid_after: int = 10,
    windows_pid_before: int = 20,
    windows_pid_after: int = 20,
):
    return MODULE.FaultRecord(
        name,
        "passed",
        100,
        105,
        5,
        True,
        True,
        True,
        True,
        0,
        0,
        0,
        generation_before,
        generation_after,
        pid_before,
        pid_after,
        windows_pid_before,
        windows_pid_after,
        True,
    )


def full_faults():
    return [
        fault("android_background"),
        fault("android_process_death", pid_after=11),
        fault("network_change"),
        fault(
            "runtime_restart",
            generation_after=2,
            windows_pid_after=21,
        ),
        fault("relay_restart", generation_before=2, generation_after=3),
    ]


def test_v3_stability_accepts_expected_pid_and_generation_changes() -> None:
    samples = [
        sample(0),
        sample(
            3_600,
            generation=3,
            android_pid=11,
            windows_pid=21,
            memory=2_000,
            handles=11,
        ),
    ]
    result = MODULE.evaluate(samples, full_faults(), 3_600)
    assert result["passed"] is True
    assert result["memory_within_threshold"] is True
    assert result["handle_count_within_threshold"] is True
    assert {row["name"] for row in result["faults"]} == set(MODULE.FAULT_NAMES)


def test_v3_stability_rejects_missing_fault_or_transcript_drift() -> None:
    samples = [sample(0), sample(3_600, memory=2_000, handles=11)]
    assert MODULE.evaluate(samples, full_faults()[:-1], 3_600)["passed"] is False
    drift = [
        sample(0),
        sample(3_600, digest="b" * 64, memory=2_000, handles=11),
    ]
    assert MODULE.evaluate(drift, full_faults(), 3_600)["passed"] is False


def test_v3_stability_preserves_sanitized_probe_error_details() -> None:
    details = [
        {
            "elapsed_seconds": 120.5,
            "code": "stability_android_probe_timeout",
        }
    ]
    result = MODULE.evaluate(
        [sample(0), MODULE.Sample(
            120.5, 0, "probe_error", None, 0, True, 10, 20, 1_000, 10, None,
        )],
        [],
        3_600,
        details,
    )
    assert result["passed"] is False
    assert result["probe_error_count"] == 1
    assert result["probe_errors"] == details


def test_v3_safe_error_code_never_exposes_unstructured_detail() -> None:
    assert MODULE._safe_error_code(
        RuntimeError("stability_android_probe_timeout")
    ) == "stability_android_probe_timeout"
    assert MODULE._safe_error_code(
        RuntimeError("server said: secret value with spaces")
    ) == "RuntimeError"


def test_v3_stability_rejects_failed_fault_and_excessive_resource_slope() -> None:
    failed = full_faults()
    failed[0] = MODULE.FaultRecord(
        **{
            **failed[0].__dict__,
            "transcript_hash_preserved": False,
        }
    )
    assert MODULE.evaluate(
        [sample(0), sample(3_600, memory=2_000, handles=11)],
        failed,
        3_600,
    )["passed"] is False
    leaking = [
        sample(0),
        sample(
            3_600,
            memory=100_000_000,
            handles=100,
        ),
    ]
    result = MODULE.evaluate(leaking, full_faults(), 3_600)
    assert result["memory_within_threshold"] is False
    assert result["handle_count_within_threshold"] is False
    assert result["passed"] is False


def test_v3_probe_requires_canonical_digest_and_snapshot_sequence() -> None:
    assert MODULE._probe_snapshot(
        {"transcript_sha256": "f" * 64, "snapshot_sequence": 7}
    ) == ("f" * 64, 7)
    for invalid in (
        {"transcript_sha256": "f" * 63, "snapshot_sequence": 7},
        {"transcript_sha256": "g" * 64, "snapshot_sequence": 7},
        {"transcript_sha256": "f" * 64, "snapshot_sequence": -1},
        {"transcript_sha256": "f" * 64},
    ):
        try:
            MODULE._probe_snapshot(invalid)
        except RuntimeError:
            pass
        else:
            raise AssertionError("invalid V3 probe was accepted")


def test_v3_probe_integrity_requires_measured_counts_and_rejects_gaps() -> None:
    valid = {
        "run_count": 4,
        "session_event_count": 17,
        "duplicate_run_count": 0,
        "duplicate_sequence_count": 0,
        "missing_sequence_count": 0,
    }
    assert MODULE._probe_integrity(valid) == (4, 17, 0, 0, 0)
    for key in valid:
        invalid = {**valid, key: None}
        try:
            MODULE._probe_integrity(invalid)
        except RuntimeError:
            pass
        else:
            raise AssertionError(f"missing measured count was accepted: {key}")
    for key in (
        "duplicate_run_count",
        "duplicate_sequence_count",
        "missing_sequence_count",
    ):
        invalid = {**valid, key: 1}
        try:
            MODULE._probe_integrity(invalid)
        except RuntimeError:
            pass
        else:
            raise AssertionError(f"integrity failure was accepted: {key}")


def test_v3_fault_identity_transitions_are_strict() -> None:
    common = {
        "generation_before": 1,
        "generation_after": 1,
        "android_pid_before": 10,
        "android_pid_after": 10,
        "windows_pid_before": 20,
        "windows_pid_after": 20,
    }
    assert MODULE._identity_transition_valid("android_background", **common)
    assert MODULE._identity_transition_valid(
        "android_process_death",
        **{**common, "android_pid_after": 11},
    )
    assert MODULE._identity_transition_valid("network_change", **common)
    assert MODULE._identity_transition_valid(
        "runtime_restart",
        **{
            **common,
            "generation_after": 2,
            "windows_pid_after": 21,
        },
    )
    assert MODULE._identity_transition_valid(
        "relay_restart",
        **{**common, "generation_after": 2},
    )
    assert not MODULE._identity_transition_valid(
        "runtime_restart",
        **{**common, "windows_pid_after": 21},
    )


def test_v3_fault_matrix_writes_only_complete_measured_matrix(
    monkeypatch,
    tmp_path: Path,
) -> None:
    records = {item.name: item for item in full_faults()}

    async def measured(_args, name, _service, _started):
        return records[name]

    monkeypatch.setattr(MODULE, "_fault", measured)
    monkeypatch.setattr(MODULE, "_open_session", lambda _args: None)
    output = tmp_path / "faults.json"
    token = tmp_path / "token"
    token.write_text("fixture_instance_token_00000000000", encoding="utf-8")
    result = asyncio.run(
        MODULE.fault_matrix(
            SimpleNamespace(
                gateway_url="http://127.0.0.1:1",
                token_path=token,
                output=output,
            )
        )
    )
    assert result["passed"] is True
    assert output.exists()
    assert {row["name"] for row in result["faults"]} == set(MODULE.FAULT_NAMES)


def test_v3_fault_matrix_rejects_failed_measurement(
    monkeypatch,
    tmp_path: Path,
) -> None:
    records = {item.name: item for item in full_faults()}
    records["network_change"] = MODULE.FaultRecord(
        **{
            **records["network_change"].__dict__,
            "status": "failed",
            "missing_sequence_count": 1,
        }
    )

    async def measured(_args, name, _service, _started):
        return records[name]

    monkeypatch.setattr(MODULE, "_fault", measured)
    monkeypatch.setattr(MODULE, "_open_session", lambda _args: None)
    token = tmp_path / "token"
    token.write_text("fixture_instance_token_00000000000", encoding="utf-8")
    try:
        asyncio.run(
            MODULE.fault_matrix(
                    SimpleNamespace(
                        gateway_url="http://127.0.0.1:1",
                        token_path=token,
                    output=tmp_path / "faults.json",
                )
            )
        )
    except RuntimeError as exc:
        assert str(exc) == "v3_stability_fault_failed:network_change"
    else:
        raise AssertionError("failed measured fault was accepted")


def test_v3_failed_fault_record_is_explicit_and_sanitized(monkeypatch) -> None:
    monkeypatch.setattr(MODULE, "android_state", lambda *_args: (True, 10))
    monkeypatch.setattr(MODULE, "gateway_pid", lambda _port: 20)
    record = MODULE._failed_fault_record(
        "runtime_restart",
        started=1.0,
        began=2.0,
        exc=RuntimeError("v3_stability_restarted_runtime_exited"),
        args=SimpleNamespace(
            adb="adb",
            device="device",
            package="package",
            gateway_port=18642,
        ),
    )
    assert record.status == "failed"
    assert record.failure_code == "v3_stability_restarted_runtime_exited"
    assert record.identity_transition_valid is False
    assert MODULE._fault_passed(record) is False


def test_v3_runtime_restart_explicitly_starts_replacement(monkeypatch) -> None:
    pids = iter((20, None, 21))
    started = []

    class Service:
        async def shutdown_runtime(self):
            return {"status": "stopping"}

    class Process:
        def poll(self):
            return None

    monkeypatch.setattr(MODULE, "gateway_pid", lambda _port: next(pids))
    monkeypatch.setattr(
        MODULE,
        "start_runtime",
        lambda args: started.append(args) or Process(),
    )
    args = SimpleNamespace(
        gateway_port=18642,
        recovery_timeout_seconds=30,
        supervisor_restart_grace_seconds=0,
    )
    asyncio.run(MODULE._runtime_reconnect(args, Service()))
    assert started == [args]


def test_v3_runtime_restart_prefers_supervisor_replacement(monkeypatch) -> None:
    pids = iter((20, None, 21))
    started = []

    class Service:
        async def shutdown_runtime(self):
            return {"status": "stopping"}

    monkeypatch.setattr(MODULE, "gateway_pid", lambda _port: next(pids))
    monkeypatch.setattr(
        MODULE,
        "start_runtime",
        lambda args: started.append(args),
    )
    args = SimpleNamespace(
        gateway_port=18642,
        recovery_timeout_seconds=30,
        supervisor_restart_grace_seconds=10,
    )
    asyncio.run(MODULE._runtime_reconnect(args, Service()))
    assert started == []


def test_v3_runtime_restart_accepts_supervisor_after_fallback_exit(
    monkeypatch,
) -> None:
    pids = iter((20, None, None, 21))

    class Service:
        async def shutdown_runtime(self):
            return {"status": "stopping"}

    class Process:
        def poll(self):
            return 1

    monkeypatch.setattr(MODULE, "gateway_pid", lambda _port: next(pids))
    monkeypatch.setattr(MODULE, "start_runtime", lambda _args: Process())
    args = SimpleNamespace(
        gateway_port=18642,
        recovery_timeout_seconds=30,
        supervisor_restart_grace_seconds=0,
    )
    asyncio.run(MODULE._runtime_reconnect(args, Service()))
