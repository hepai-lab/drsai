from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[5]
sys.path.insert(0, str(ROOT / "scripts"))
SCRIPT = ROOT / "scripts/finalize_mobile_remote_workspace_release_v4.py"
SPEC = importlib.util.spec_from_file_location("finalizer_v4", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def _write(path: Path, value: dict) -> Path:
    path.write_text(json.dumps(value), encoding="utf-8")
    return path


def _junit(path: Path, count: int) -> Path:
    path.write_text("<testsuite>" + "".join(f'<testcase name="c{index}"/>' for index in range(count)) + "</testsuite>", encoding="utf-8")
    return path


def _screenshot(name: str) -> dict[str, str]:
    path = ROOT / f"release/product-evidence/mobile-remote-workspace-v4/test-{name}.png"
    path.parent.mkdir(parents=True, exist_ok=True)
    content = b"\x89PNG\r\n\x1a\n" + name.encode()
    path.write_bytes(content)
    return {
        "screenshot_artifact": path.relative_to(ROOT).as_posix(),
        "screenshot_sha256": hashlib.sha256(content).hexdigest(),
    }


@pytest.fixture
def evidence(tmp_path: Path):
    digest = "d" * 64
    relay_checks = [{"name": name, "status": "passed"} for name in MODULE.REQUIRED_RELAY_CHECKS]
    relay_by_name = {row["name"]: row for row in relay_checks}
    relay_by_name["cross_worker_replay_10k"].update(event_count=10000, p95_ms=20)
    relay_by_name["scope_before_side_effect"].update(runtime_call_count=0)
    relay_by_name["revocation_closes_sse"].update(subsequent_status=403)
    relay = {"passed": True, "environment": "ai-dev.ihep.ac.cn", "protocol": "oaep/1", "schema_hash": digest, "checks": relay_checks}
    real_checks = [{"name": name, "status": "passed"} for name in MODULE.REQUIRED_REAL_CHECKS]
    real_by_name = {row["name"]: row for row in real_checks}
    real_by_name["pair_and_catalog"].update(**_screenshot("catalog"))
    for name in ("windows_to_android_two_runs", "android_to_windows_two_runs"):
        real_by_name[name].update(
            run_count=2, duplicate_sequence_count=0, missing_sequence_count=0,
            delta_run_count=2, terminal_run_count=2, p95_seconds=.2,
            **({"tool_run_count": 2} if name == "windows_to_android_two_runs" else {}),
            **_screenshot(name),
        )
    real_by_name["oaep_hash_convergence"].update(runtime_sha256=digest, windows_sha256=digest, android_sha256=digest)
    real_by_name["approval_single_decision"].update(successful_decisions=1, tool_execution_count=1)
    real_by_name["file_change_safe_paths"].update(file_change_count=1, safe_relative_paths=True, absolute_path_count=0, sensitive_field_count=0)
    real_by_name["two_device_isolation"].update(device_a_status=403, device_b_status=200, credential_copy_rejected=True)
    real_by_name["revocation_stream_closed"].update(
        subsequent_status=403, stream_closed_immediately=True,
        other_device_stream_open=True, close_seconds=.5,
    )
    real = {
        "passed": True,
        "protocol": "oaep/1",
        "devices": [{"device_proof_sha256": "a" * 64}, {"device_proof_sha256": "b" * 64}],
        "checks": real_checks,
        "v3_inherited": [{"id": item, "status": "passed"} for item in MODULE.V3_INHERITED],
    }
    stability = {
        "passed": True, "required_duration_seconds": 3600, "observed_duration_seconds": 3601,
        "probe_error_count": 0, "oaep_hash_stable": True, "memory_within_threshold": True,
        "handle_count_within_threshold": True,
        "faults": [{"name": name, "status": "passed", "oaep_hash_preserved": True, "sequence_preserved": True, "duplicate_sequence_count": 0, "missing_sequence_count": 0} for name in MODULE.REQUIRED_FAULTS],
    }
    secret = {"passed": True, "matches": 0, "sources": [{"name": name, "status": "clean", "bytes_scanned": 1} for name in MODULE.REQUIRED_SECRET_SOURCES]}
    paths = [
        _write(tmp_path / "relay.json", relay), _write(tmp_path / "real.json", real),
        _write(tmp_path / "stability.json", stability), _write(tmp_path / "secret.json", secret),
    ]
    apk = tmp_path / "app.apk"; apk.write_bytes(b"apk")
    paths.extend([apk, _junit(tmp_path / "python.xml", 500), _junit(tmp_path / "android.xml", 200), _junit(tmp_path / "desktop.xml", 4)])
    yield tuple(paths)
    evidence_dir = ROOT / "release/product-evidence/mobile-remote-workspace-v4"
    for path in evidence_dir.glob("test-*.png"):
        path.unlink()


def _finalize(paths):
    return MODULE.finalize(
        MODULE.acceptance.LEDGER, *paths,
        hai_revision="a" * 40, windows_revision="b" * 40, android_revision="c" * 40,
    )


def test_v4_finalizer_emits_80_of_80_digest_manifest(evidence) -> None:
    ledger, manifest = _finalize(evidence)
    assert MODULE.acceptance.validate(ledger) == []
    assert all(row["status"] == "full_pass" for row in ledger["items"])
    assert manifest["full_pass"] == 80
    assert manifest["v3_unverified"] == 0
    assert manifest["test_counts"] == {"python": 500, "android": 200, "desktop": 4}


@pytest.mark.parametrize(
    ("index", "mutation", "error"),
    [
        (0, lambda value: value.update(environment="wrong.example"), "v4_relay_environment_invalid"),
        (1, lambda value: value["devices"].pop(), "v4_two_devices_missing"),
        (1, lambda value: next(row for row in value["checks"] if row["name"] == "file_change_safe_paths").update(absolute_path_count=1), "v4_file_change_paths_invalid"),
        (2, lambda value: value.update(observed_duration_seconds=3599), "v4_stability_invalid"),
        (3, lambda value: value.update(matches=1), "v4_secret_scan_failed"),
    ],
)
def test_v4_finalizer_fails_closed_on_missing_real_gate(evidence, index, mutation, error) -> None:
    paths = list(evidence)
    value = json.loads(paths[index].read_text(encoding="utf-8"))
    mutation(value)
    paths[index].write_text(json.dumps(value), encoding="utf-8")
    with pytest.raises(RuntimeError, match=error):
        _finalize(tuple(paths))


def test_v4_finalizer_requires_all_v3_inherited_evidence(evidence) -> None:
    paths = list(evidence)
    value = json.loads(paths[1].read_text(encoding="utf-8"))
    value["v3_inherited"].pop()
    paths[1].write_text(json.dumps(value), encoding="utf-8")
    with pytest.raises(RuntimeError, match="v4_v3_inherited_incomplete"):
        _finalize(tuple(paths))
