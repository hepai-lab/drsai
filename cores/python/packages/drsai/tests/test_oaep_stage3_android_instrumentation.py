from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[5]
SCRIPT = ROOT / "scripts/verify_oaep_stage3_android_instrumentation.py"
SPEC = importlib.util.spec_from_file_location("oaep_stage3_android_instrumentation", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def test_parse_junit_accepts_successful_remote_session_store_report(tmp_path: Path) -> None:
    report = tmp_path / "TEST-device.xml"
    report.write_text(
        """<?xml version='1.0' encoding='UTF-8' ?>
<testsuite name="ai.drsai.remote.RemoteSessionSyncStoreTest" tests="2" failures="0" errors="0">
  <testcase name="oaep_delta" classname="ai.drsai.remote.RemoteSessionSyncStoreTest" />
  <testcase name="oaep_plan_delta" classname="ai.drsai.remote.RemoteSessionSyncStoreTest" />
</testsuite>
""",
        encoding="utf-8",
    )
    parsed = MODULE.parse_junit(report, "ai.drsai.remote.RemoteSessionSyncStoreTest")
    assert parsed["tests"] == 2
    assert parsed["testcases"] == ["oaep_delta", "oaep_plan_delta"]


@pytest.mark.parametrize("failures,errors", [(1, 0), (0, 1)])
def test_parse_junit_fails_closed_on_failed_report(tmp_path: Path, failures: int, errors: int) -> None:
    report = tmp_path / "TEST-device.xml"
    report.write_text(
        f"""<?xml version='1.0' encoding='UTF-8' ?>
<testsuite name="ai.drsai.remote.RemoteSessionSyncStoreTest" tests="1" failures="{failures}" errors="{errors}">
  <testcase name="oaep_delta" classname="ai.drsai.remote.RemoteSessionSyncStoreTest" />
</testsuite>
""",
        encoding="utf-8",
    )
    with pytest.raises(RuntimeError, match="android_junit_failed"):
        MODULE.parse_junit(report, "ai.drsai.remote.RemoteSessionSyncStoreTest")


def test_connected_devices_parses_only_online_devices(monkeypatch) -> None:
    class _Completed:
        stdout = "List of devices attached\nemulator-5554\tdevice\nR5GY\tunauthorized\n"

    monkeypatch.setattr(MODULE, "run", lambda *_args, **_kwargs: _Completed())
    assert MODULE.connected_devices(Path("adb")) == ["emulator-5554"]
