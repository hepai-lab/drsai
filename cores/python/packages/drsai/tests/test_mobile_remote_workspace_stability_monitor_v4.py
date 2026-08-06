from __future__ import annotations
import importlib.util
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[5]
SCRIPTS = ROOT / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))
SCRIPT = SCRIPTS / "monitor_mobile_remote_workspace_stability_v4.py"
SPEC = importlib.util.spec_from_file_location("mobile_stability_monitor_v4", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def sample(
    elapsed: float,
    *,
    digest: str = "a" * 64,
    schema: str = "b" * 64,
    generation: int = 1,
    android_pid: int = 10,
    windows_pid: int = 20,
    memory: int = 1_000,
    handles: int = 10,
) -> MODULE.OaepSample:
    return MODULE.OaepSample(
        elapsed_seconds=elapsed,
        relay_latency_ms=25,
        runtime_status="online",
        generation=generation,
        workspace_count=2,
        android_online=True,
        android_pid=android_pid,
        windows_pid=windows_pid,
        windows_working_set_bytes=memory,
        windows_handle_count=handles,
        schema_hash=schema,
        snapshot_sequence=20,
        item_count=10,
        run_count=4,
        event_count=20,
        duplicate_sequence_count=0,
        missing_sequence_count=0,
        oaep_sha256=digest,
    )


def fault(
    name: str,
    *,
    generation_before: int = 1,
    generation_after: int = 1,
    android_before: int = 10,
    android_after: int = 10,
    windows_before: int = 20,
    windows_after: int = 20,
) -> MODULE.OaepFault:
    return MODULE.OaepFault(
        name=name,
        status="passed",
        started_at_seconds=100,
        recovered_at_seconds=105,
        recovery_seconds=5,
        oaep_hash_preserved=True,
        sequence_preserved=True,
        item_count_preserved=True,
        run_count_preserved=True,
        event_count_preserved=True,
        duplicate_sequence_count=0,
        missing_sequence_count=0,
        reexecuted_side_effect_count=0,
        generation_before=generation_before,
        generation_after=generation_after,
        android_pid_before=android_before,
        android_pid_after=android_after,
        windows_pid_before=windows_before,
        windows_pid_after=windows_after,
        identity_transition_valid=True,
    )


def faults() -> list[MODULE.OaepFault]:
    return [
        fault("android_background"),
        fault("android_process_death", android_after=11),
        fault("network_change"),
        fault("runtime_restart", generation_after=2, windows_after=21),
        fault("relay_restart", generation_before=2, generation_after=3),
    ]


def valid_probe() -> dict[str, object]:
    return {
        "protocol": "oaep/1",
        "schema_hash": "b" * 64,
        "oaep_sha256": "a" * 64,
        "snapshot_sequence": 20,
        "item_count": 10,
        "run_count": 4,
        "event_count": 20,
        "duplicate_sequence_count": 0,
        "missing_sequence_count": 0,
    }


def test_v4_stability_accepts_one_hour_oaep_and_five_faults() -> None:
    result = MODULE.evaluate(
        [sample(0), sample(3_600, generation=3, android_pid=11, windows_pid=21, memory=2_000, handles=11)],
        faults(),
        3_600,
    )
    assert result["passed"] is True
    assert result["oaep_hash_stable"] is True
    assert result["probe_error_count"] == 0
    assert {row["name"] for row in result["faults"]} == set(MODULE.FAULT_NAMES)


def test_v4_stability_rejects_digest_schema_fault_and_probe_drift() -> None:
    assert MODULE.evaluate(
        [sample(0), sample(3_600, digest="c" * 64, memory=2_000, handles=11)], faults(), 3_600
    )["passed"] is False
    assert MODULE.evaluate(
        [sample(0), sample(3_600, schema="d" * 64, memory=2_000, handles=11)], faults(), 3_600
    )["passed"] is False
    assert MODULE.evaluate(
        [sample(0), sample(3_600, memory=2_000, handles=11)], faults()[:-1], 3_600
    )["passed"] is False
    assert MODULE.evaluate(
        [sample(0), sample(3_600, memory=2_000, handles=11)], faults(), 3_600,
        [{"elapsed_seconds": 5, "code": "probe_timeout"}],
    )["passed"] is False


def test_v4_probe_requires_oaep_digest_schema_and_gap_free_counts() -> None:
    assert MODULE._probe(valid_probe())["snapshot_sequence"] == 20
    mutations = (
        {"protocol": "conversation/1"},
        {"schema_hash": "x" * 64},
        {"oaep_sha256": "a" * 63},
        {"duplicate_sequence_count": 1},
        {"missing_sequence_count": 1},
        {"event_count": 0},
    )
    for mutation in mutations:
        try:
            MODULE._probe({**valid_probe(), **mutation})
        except RuntimeError:
            pass
        else:
            raise AssertionError(f"invalid V4 probe accepted: {mutation}")


def test_v4_safe_error_code_never_exports_unstructured_detail() -> None:
    assert MODULE._safe_error_code(RuntimeError("v4_probe_timeout")) == "v4_probe_timeout"
    assert MODULE._safe_error_code(RuntimeError("server leaked sensitive body")) == "RuntimeError"
