from __future__ import annotations

import hashlib
import json
from pathlib import Path
from unittest.mock import patch

import accept_remote_workspace_local_p5 as gate


class _Result:
    def __init__(self, code: int, output: bytes = b"content-free-output") -> None:
        self.returncode = code
        self.stdout = output
        self.stderr = b""


def test_run_records_only_bounded_content_free_metadata(tmp_path: Path) -> None:
    with patch.object(gate.subprocess, "run", return_value=_Result(0, b"secret canary")):
        result = gate._run("fixture", ["fixture"], tmp_path, None, 30)
    assert result == {
        "name": "fixture", "passed": True, "return_code": 0,
        "duration_ms": result["duration_ms"], "output_bytes": 13,
        "output_sha256": hashlib.sha256(b"secret canary").hexdigest(),
    }
    assert "secret canary" not in json.dumps(result)


def test_main_fails_closed_when_any_suite_fails(tmp_path: Path) -> None:
    suites = [
        ("one", ["one"], tmp_path, None),
        ("two", ["two"], tmp_path, None),
    ]
    with patch.object(gate, "suite_catalog", return_value=suites), patch.object(
        gate.subprocess, "run", side_effect=[_Result(0), _Result(7)],
    ):
        output = tmp_path / "report.json"
        assert gate.main(["--output", str(output), "--timeout", "30"]) == 1
    report = json.loads(output.read_text(encoding="utf-8"))
    assert report["passed"] is False
    assert [row["passed"] for row in report["suites"]] == [True, False]


def test_release_instrumentation_compile_is_a_distinct_local_gate() -> None:
    suites = {name: command for name, command, _cwd, _environment in gate.suite_catalog()}
    command = suites["android_release_test_compile"]
    assert ":app:compileReleaseAndroidTestKotlin" in command
    assert "-Popendrsai.android.testBuildType=release" in command
    assert "android_release_test_compile" != "android_test_compile"
