from __future__ import annotations

import argparse
import json
import subprocess

import pytest

import collect_android_secret_scan_p5 as collector


def _args(tmp_path) -> argparse.Namespace:
    return argparse.Namespace(
        adb="adb", device="physical-one", test_package="ai.drsai.remote.test",
        runner="androidx.test.runner.AndroidJUnitRunner", timeout=10,
        environment_id="ai-dev", canary_run_id="canary-one",
        output=tmp_path / "android.json", allow_non_physical=False,
    )


def _endpoint(**changes) -> dict:
    value = {
        "schema_version": "p5-android-endpoint/1", "passed": True, "matches": 0,
        "physical": True, "debuggable": False, "backup_disabled": True,
        "artifact_sha256": "a" * 64,
        "sources": [
            {"name": name, "status": "clean", "bytes_scanned": 10, "files_scanned": 1}
            for name in ("android_apk", "android_logs", "android_room", "android_backup")
        ],
    }
    value.update(changes)
    return value


def test_safe_endpoint_report_is_converted_without_raw_artifacts(monkeypatch, tmp_path) -> None:
    stdout = "INSTRUMENTATION_STATUS: p5AndroidSecretReport=" + json.dumps(_endpoint()) + "\nOK (1 test)"
    monkeypatch.setattr(subprocess, "run", lambda *args, **kwargs:
                        subprocess.CompletedProcess(args[0], 0, stdout, ""))
    report = collector.collect(_args(tmp_path))
    assert report["artifact_sha256"] == "a" * 64
    assert report["raw_artifacts_exported"] is False
    assert {row["name"] for row in report["sources"]} == {
        "android_apk", "android_logs", "android_room", "android_backup",
    }


@pytest.mark.parametrize("changes", [
    {"debuggable": True}, {"physical": False}, {"backup_disabled": False},
    {"matches": 1}, {"passed": False}, {"artifact_sha256": "bad"}, {"sources": []},
])
def test_debug_emulator_leak_and_missing_sources_fail_closed(monkeypatch, tmp_path, changes) -> None:
    stdout = "P5_ANDROID_SECRET_REPORT=" + json.dumps(_endpoint(**changes))
    monkeypatch.setattr(subprocess, "run", lambda *args, **kwargs:
                        subprocess.CompletedProcess(args[0], 0, stdout, ""))
    with pytest.raises(RuntimeError):
        collector.collect(_args(tmp_path))
