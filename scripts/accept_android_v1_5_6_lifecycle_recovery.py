from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
APK = ROOT / "apps/android/app/build/outputs/apk/debug/OpenDrSai-Android-v1.5.6.apk"
TEST_APK = ROOT / "apps/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk"
PACKAGE = "ai.drsai.remote.debug"
RUNNER = f"{PACKAGE}.test/androidx.test.runner.AndroidJUnitRunner"
TEST_CLASS = "ai.drsai.remote.PythonRuntimeUpgradeStateTest"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Verify one durable Full Runtime run across Android lifecycle disruptions",
    )
    parser.add_argument("--serial", required=True)
    parser.add_argument(
        "--output",
        default=str(ROOT / "docs/android/reports/evidence/v1.5.6/lifecycle-recovery.json"),
    )
    args = parser.parse_args()
    sdk = Path(os.environ.get("ANDROID_HOME", Path.home() / "AppData/Local/Android/Sdk"))
    adb = sdk / "platform-tools/adb.exe"

    def run(*parts: str, timeout: int = 120, check: bool = True) -> str:
        completed = subprocess.run(
            [str(adb), "-s", args.serial, *parts], check=check, timeout=timeout,
            text=True, encoding="utf-8", errors="replace", capture_output=True,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        return completed.stdout + completed.stderr

    def instrument(method: str, phase: str) -> str:
        output = run(
            "shell", "am", "instrument", "-w", "-r",
            "-e", "class", f"{TEST_CLASS}#{method}",
            "-e", "upgradePhase", phase, RUNNER, timeout=180,
        )
        if "OK (1 test)" not in output:
            raise RuntimeError(f"lifecycle_{phase}_failed:\n{output[-4000:]}")
        return output

    if run("shell", "getprop", "ro.kernel.qemu").strip() != "1":
        raise RuntimeError(
            "lifecycle_acceptance_refuses_physical_device_because_seed_phase_replaces_target_test_data"
        )

    for artifact in (APK, TEST_APK):
        run("install", "-r", "-d", "-t", str(artifact), timeout=240)

    original_accelerometer = run("shell", "settings", "get", "system", "accelerometer_rotation").strip()
    original_rotation = run("shell", "settings", "get", "system", "user_rotation").strip()
    steps: dict[str, object] = {}
    started = datetime.now(timezone.utc)
    try:
        instrument("seedUpgradeState", "seed")
        steps["durable_run_seeded"] = True

        run("shell", "input", "keyevent", "224")
        run("shell", "wm", "dismiss-keyguard", check=False)
        launch = run(
            "shell", "monkey", "-p", PACKAGE,
            "-c", "android.intent.category.LAUNCHER", "1",
        )
        time.sleep(2)
        launched_state = run("shell", "dumpsys", "activity", "activities")
        steps["main_activity_launched"] = (
            "Events injected: 1" in launch
            and re.search(rf"(?:topResumedActivity|ResumedActivity):.*{re.escape(PACKAGE)}/ai\.drsai\.remote\.MainActivity", launched_state) is not None
        )

        run("shell", "settings", "put", "system", "accelerometer_rotation", "0")
        observed_rotations: list[int] = []
        for rotation in (1, 3, 0):
            run("shell", "settings", "put", "system", "user_rotation", str(rotation))
            observed = None
            for _ in range(12):
                time.sleep(0.3)
                state = run("shell", "dumpsys", "window", "displays")
                match = re.search(r"mRotation=(\d)", state)
                if match:
                    observed = int(match.group(1))
                    if observed == rotation:
                        break
            if observed is not None:
                observed_rotations.append(observed)
        steps["rotation_values"] = observed_rotations
        steps["rotation_recreation"] = set(observed_rotations) >= {0, 1, 3}

        split = run(
            "shell", "am", "start", "-W", "--windowingMode", "6",
            "-a", "android.intent.action.MAIN", "-c", "android.intent.category.LAUNCHER",
            "-n", f"{PACKAGE}/ai.drsai.remote.ExternalEntryActivity",
        )
        activity_state = run("shell", "dumpsys", "activity", "activities")
        steps["split_screen"] = (
            "Status: ok" in split
            and re.search(rf"Task\{{[^\n]+{re.escape(PACKAGE)}[^\n]+mode=multi-window", activity_state) is not None
        )

        run("shell", "input", "keyevent", "223")
        time.sleep(1)
        sleeping = run("shell", "dumpsys", "power")
        lock_policy = run("shell", "dumpsys", "window", "policy")
        run("shell", "input", "keyevent", "224")
        run("shell", "wm", "dismiss-keyguard", check=False)
        wakefulness = re.search(r"mWakefulness=([^\r\n]+)", sleeping)
        screen_state = re.search(r"screenState=([^\s]+)", lock_policy)
        interactive_state = re.search(r"interactiveState=([^\s]+)", lock_policy)
        steps["lock_wakefulness"] = wakefulness.group(1).strip() if wakefulness else "unknown"
        steps["lock_screen_state"] = screen_state.group(1) if screen_state else "unknown"
        steps["lock_interactive_state"] = interactive_state.group(1) if interactive_state else "unknown"
        steps["lock_screen"] = (
            steps["lock_wakefulness"] in {"Asleep", "Dozing"}
            or steps["lock_screen_state"] == "SCREEN_STATE_OFF"
            or steps["lock_interactive_state"] == "INTERACTIVE_STATE_SLEEP"
        )

        run("shell", "input", "keyevent", "3")
        time.sleep(1)
        background_state = run("shell", "dumpsys", "activity", "activities")
        steps["background"] = (
            PACKAGE in background_state
            and not re.search(rf"ResumedActivity:.*{re.escape(PACKAGE)}", background_state)
        )

        pid_before = run("shell", "pidof", PACKAGE, check=False).strip()
        run("shell", "am", "kill", PACKAGE)
        time.sleep(2)
        pid_after = run("shell", "pidof", PACKAGE, check=False).strip()
        steps["system_reclaim"] = bool(pid_before) and pid_after != pid_before
        steps["pid_before_reclaim"] = pid_before
        steps["pid_after_reclaim"] = pid_after

        instrument("verifyUpgradeState", "verify")
        steps["same_run_checkpoint_and_resume_envelope"] = True
        gates = {
            "main_activity": bool(steps["main_activity_launched"]),
            "rotation": bool(steps["rotation_recreation"]),
            "split_screen": bool(steps["split_screen"]),
            "lock_screen": bool(steps["lock_screen"]),
            "background": bool(steps["background"]),
            "system_reclaim": bool(steps["system_reclaim"]),
            "same_run_restored": bool(steps["same_run_checkpoint_and_resume_envelope"]),
        }
        report = {
            "schema_version": 1,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "duration_ms": round((datetime.now(timezone.utc) - started).total_seconds() * 1000, 3),
            "serial": args.serial,
            "device": run("shell", "getprop", "ro.product.model").strip(),
            "api": int(run("shell", "getprop", "ro.build.version.sdk").strip()),
            "apk": APK.name,
            "apk_sha256": hashlib.sha256(APK.read_bytes()).hexdigest(),
            "test_apk_sha256": hashlib.sha256(TEST_APK.read_bytes()).hexdigest(),
            "run_id": "upgrade-python-run",
            "checkpoint_sequence": 7,
            "steps": steps,
            "gates": gates,
            "passed": all(gates.values()),
        }
        output = Path(args.output).resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
        print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
        return 0 if report["passed"] else 1
    finally:
        run("shell", "settings", "put", "system", "accelerometer_rotation", original_accelerometer, check=False)
        run("shell", "settings", "put", "system", "user_rotation", original_rotation, check=False)
        run("shell", "input", "keyevent", "224", check=False)
        run("shell", "wm", "dismiss-keyguard", check=False)


if __name__ == "__main__":
    raise SystemExit(main())
