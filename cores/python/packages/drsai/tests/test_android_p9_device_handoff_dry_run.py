from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest


ROOT = Path(__file__).parents[5]
SCRIPT = ROOT / "scripts/accept_android_p9_real_model_statistics.py"


def module():
    spec = importlib.util.spec_from_file_location("p9_real_model_runner", SCRIPT)
    assert spec and spec.loader
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


def test_dry_run_validates_exact_artifacts_models_counts_and_formal_outputs() -> None:
    runner = module()
    suite = runner.load_tool_selection_suite(runner.SUITE_PATH)
    policy = runner.load_real_model_policy(runner.POLICY_PATH)
    app = ROOT / "apps/android/app/build/outputs/apk/debug/OpenDrSai-Android-v1.5.6.apk"
    test = ROOT / "apps/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk"
    report = runner.build_device_handoff_dry_run(
        serial="PHYSICAL_ARM64_SERIAL", adb_path=Path(runner.DEFAULT_DRY_RUN_OUTPUT).anchor and Path("C:/adb.exe"),
        app_apk=app, test_apk=test, suite=suite, policy=policy,
        output=runner.DEFAULT_OUTPUT, m04_output=runner.DEFAULT_M04_OUTPUT,
    )

    assert report["passed"] is True and report["release_evidence"] is False
    assert report["inputs"]["models"] == ["deepseek-v4-flash", "deepseek-v4-pro"]
    assert report["inputs"]["expected_observations"] == 180
    assert len(report["artifacts"]["app_apk"]["sha256"]) == 64
    assert "authorize_adb" in report["device_requirements"]["user_actions"]


def test_dry_run_rejects_emulator_serial_and_non_formal_destination() -> None:
    runner = module()
    suite = runner.load_tool_selection_suite(runner.SUITE_PATH)
    policy = runner.load_real_model_policy(runner.POLICY_PATH)
    app = ROOT / "apps/android/app/build/outputs/apk/debug/OpenDrSai-Android-v1.5.6.apk"
    test = ROOT / "apps/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk"
    common = dict(
        adb_path=Path("C:/adb.exe"), app_apk=app, test_apk=test, suite=suite, policy=policy,
        output=runner.DEFAULT_OUTPUT, m04_output=runner.DEFAULT_M04_OUTPUT,
    )
    with pytest.raises(ValueError, match="physical_device_serial_required"):
        runner.build_device_handoff_dry_run(serial="emulator-5554", **common)
    with pytest.raises(ValueError, match="formal_output_path_invalid"):
        runner.build_device_handoff_dry_run(
            serial="PHYSICAL_ARM64_SERIAL", **{**common, "output": ROOT / "tmp/not-formal.json"},
        )
