from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[5]
SCRIPT = ROOT / "scripts/finalize_mobile_remote_workspace_release_v3.py"
sys.path.insert(0, str(ROOT / "scripts"))
SPEC = importlib.util.spec_from_file_location("release_finalizer_v3", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
SCREENSHOT_ROOT = (
    ROOT / "release/product-evidence/mobile-remote-workspace-v3/test-screenshots"
)


@pytest.fixture(autouse=True)
def clean_test_screenshots():
    yield
    if SCREENSHOT_ROOT.is_dir():
        for path in SCREENSHOT_ROOT.iterdir():
            path.unlink(missing_ok=True)
        SCREENSHOT_ROOT.rmdir()


def _screenshot(name: str) -> dict[str, str]:
    content = b"\x89PNG\r\n\x1a\nv3-release-proof-" + name.encode()
    path = SCREENSHOT_ROOT / f"{name}.png"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    return {
        "screenshot_artifact": path.relative_to(ROOT).as_posix(),
        "screenshot_sha256": hashlib.sha256(content).hexdigest(),
    }


def _junit(path: Path, count: int) -> None:
    path.write_text(
        "<testsuite>"
        + "".join(f'<testcase name="case-{index}"/>' for index in range(count))
        + "</testsuite>",
        encoding="utf-8",
    )


def evidence(tmp_path: Path) -> tuple[Path, ...]:
    anonymous = {
        "passed": True,
        "authenticated": False,
        "checks": [
            {"name": name, "status": "passed"}
            for name in sorted(MODULE.REQUIRED_ANONYMOUS_CHECKS)
        ],
    }
    checks = [
        {"name": name, "status": "passed"}
        for name in sorted(MODULE.REQUIRED_REAL_CHECKS)
    ]
    by_name = {row["name"]: row for row in checks}
    by_name["pair_and_catalog"].update(
        target_visible=True,
        runtime_status="online",
        workspace_lifecycles=["active"],
        **_screenshot("catalog"),
    )
    for name in ("windows_to_android_two_runs", "android_to_windows_two_runs"):
        by_name[name].update(
            run_count=2,
            duplicate_run_count=0,
            missing_sequence_count=0,
            p95_seconds=0.25,
            **_screenshot(name),
        )
    digest = "d" * 64
    by_name["session_hash_convergence"].update(
        runtime_sha256=digest,
        windows_sha256=digest,
        android_sha256=digest,
    )
    by_name["approval_single_decision"].update(
        successful_decisions=1,
        tool_execution_count=1,
    )
    by_name["two_device_isolation"].update(
        device_a_revoked_status=403,
        device_b_status=200,
        credential_copy_rejected=True,
    )
    by_name["revocation_stream_closed"].update(
        stream_closed_immediately=True,
        subsequent_status=403,
    )
    for name in (
        "background_recovery",
        "process_death_recovery",
        "network_recovery",
        "runtime_restart_recovery",
        "relay_restart_recovery",
    ):
        by_name[name].update(
            transcript_hash_preserved=True,
            run_count_preserved=True,
            event_count_preserved=True,
            duplicate_run_count=0,
            duplicate_sequence_count=0,
            missing_sequence_count=0,
        )
    real = {"passed": True, "checks": checks}
    stability = {
        "passed": True,
        "required_duration_seconds": 3600,
        "observed_duration_seconds": 3601,
        "probe_error_count": 0,
        "transcript_hash_stable": True,
        "memory_within_threshold": True,
        "handle_count_within_threshold": True,
        "faults": [
            {
                "name": name,
                "status": "passed",
                "transcript_hash_preserved": True,
                "snapshot_sequence_preserved": True,
                "run_count_preserved": True,
                "event_count_preserved": True,
                "duplicate_run_count": 0,
                "duplicate_sequence_count": 0,
                "missing_sequence_count": 0,
            }
            for name in sorted(MODULE.REQUIRED_FAULTS)
        ],
    }
    secret_scan = {
        "passed": True,
        "matches": 0,
        "sources": [
            {"name": name, "status": "clean", "bytes_scanned": 1}
            for name in sorted(MODULE.REQUIRED_SECRET_SOURCES)
        ],
    }
    paths = tuple(
        tmp_path / name
        for name in ("anonymous.json", "real.json", "stability.json", "secret.json")
    )
    for path, value in zip(paths, (anonymous, real, stability, secret_scan)):
        path.write_text(json.dumps(value), encoding="utf-8")
    apk = tmp_path / "app.apk"
    apk.write_bytes(b"android-apk")
    python_junit = tmp_path / "python.xml"
    android_junit = tmp_path / "android.xml"
    desktop_junit = tmp_path / "desktop.xml"
    _junit(python_junit, 500)
    _junit(android_junit, 200)
    _junit(desktop_junit, 4)
    return (*paths, apk, python_junit, android_junit, desktop_junit)


def finalize(paths: tuple[Path, ...]):
    return MODULE.finalize(
        MODULE.acceptance.LEDGER,
        *paths,
        hai_revision="a" * 40,
        windows_revision="b" * 40,
        android_revision="c" * 40,
    )


def test_v3_finalizer_requires_complete_evidence_and_emits_digest_manifest(
    tmp_path: Path,
) -> None:
    ledger, manifest = finalize(evidence(tmp_path))
    assert len(ledger["items"]) == 104
    assert all(item["status"] == "full_pass" for item in ledger["items"])
    assert MODULE.acceptance.validate(ledger) == []
    assert manifest["full_pass"] == 104
    assert manifest["test_counts"] == {
        "python": 500,
        "android": 200,
        "desktop": 4,
    }
    assert len(manifest["artifacts"]) == 11
    assert all(MODULE.DIGEST.fullmatch(row["sha256"]) for row in manifest["artifacts"])


def test_v3_finalizer_expands_junit_directory_into_manifest(
    tmp_path: Path,
) -> None:
    paths = list(evidence(tmp_path))
    android_junit = paths[-2]
    android_directory = tmp_path / "android-junit"
    android_directory.mkdir()
    moved = android_directory / "TEST-android.xml"
    android_junit.replace(moved)
    paths[-2] = android_directory

    ledger, manifest = finalize(tuple(paths))

    assert len(ledger["items"]) == 104
    artifacts = {row["path"] for row in manifest["artifacts"]}
    assert any(path.endswith("/TEST-android.xml") for path in artifacts)
    assert str(android_directory) not in artifacts


@pytest.mark.parametrize(
    ("report_index", "mutation", "error"),
    [
        (
            1,
            lambda report: next(
                row for row in report["checks"]
                if row["name"] == "windows_to_android_two_runs"
            ).update(p95_seconds=2.0),
            "release_windows_to_android_two_runs_invalid",
        ),
        (
            1,
            lambda report: next(
                row for row in report["checks"]
                if row["name"] == "session_hash_convergence"
            ).update(android_sha256="e" * 64),
            "release_session_hash_mismatch",
        ),
        (
            2,
            lambda report: report["faults"].pop(),
            "release_stability_faults_missing",
        ),
        (
            3,
            lambda report: report.update(matches=1),
            "release_secret_scan_failed",
        ),
    ],
)
def test_v3_finalizer_fails_closed_on_weak_cross_system_evidence(
    tmp_path: Path,
    report_index: int,
    mutation,
    error: str,
) -> None:
    paths = evidence(tmp_path)
    report = json.loads(paths[report_index].read_text(encoding="utf-8"))
    mutation(report)
    paths[report_index].write_text(json.dumps(report), encoding="utf-8")
    with pytest.raises(RuntimeError, match=error):
        finalize(paths)


def test_v3_finalizer_rejects_failed_desktop_junit(tmp_path: Path) -> None:
    paths = evidence(tmp_path)
    paths[-1].write_text(
        '<testsuite><testcase name="failed"><failure/></testcase></testsuite>',
        encoding="utf-8",
    )
    with pytest.raises(RuntimeError, match="release_desktop_junit_failed"):
        finalize(paths)


def test_v3_finalizer_can_merge_independent_session_convergence_report(
    tmp_path: Path,
) -> None:
    paths = evidence(tmp_path)
    real = json.loads(paths[1].read_text(encoding="utf-8"))
    names = {
        "session_hash_convergence",
        "windows_to_android_two_runs",
        "android_to_windows_two_runs",
    }
    convergence = [row for row in real["checks"] if row["name"] in names]
    real["checks"] = [
        row for row in real["checks"] if row["name"] not in names
    ]
    paths[1].write_text(json.dumps(real), encoding="utf-8")
    convergence_path = tmp_path / "convergence.json"
    convergence_path.write_text(
        json.dumps({"passed": True, "checks": convergence}),
        encoding="utf-8",
    )
    ledger, manifest = MODULE.finalize(
        MODULE.acceptance.LEDGER,
        *paths,
        hai_revision="a" * 40,
        windows_revision="b" * 40,
        android_revision="c" * 40,
        convergence_path=convergence_path,
    )
    assert all(item["status"] == "full_pass" for item in ledger["items"])
    assert any(row["path"].endswith("convergence.json") for row in manifest["artifacts"])
