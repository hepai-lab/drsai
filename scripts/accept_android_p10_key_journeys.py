from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import time
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
ADB = Path.home() / "AppData/Local/Android/Sdk/platform-tools/adb.exe"
PENDING = ROOT / "docs/android/reports/evidence/p10/pending"
OUTPUT = ROOT / "docs/android/reports/evidence/p10/m10-f02-key-user-journeys.json"
APP_APK = ROOT / "apps/android/app/build/outputs/apk/debug/OpenDrSai-Android-v1.5.7.apk"
TEST_APK = ROOT / "apps/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk"

DEVICES = {
    "26": "emulator-5556",
    "30": "emulator-5558",
    "35": "emulator-5554",
    "36": "emulator-5560",
}

JOURNEYS = {
    "fresh_install_first_success": "ai.drsai.remote.FirstTaskJourneyInstrumentedTest",
    "returning_task": "ai.drsai.remote.PythonRuntimeCriticalJourneyTest",
    "permission_repair": "ai.drsai.remote.PythonRuntimeCriticalJourneyTest",
    "error_recovery": "ai.drsai.remote.AndroidOaepStage8StressTest",
    "desktop_handoff": (
        "ai.drsai.remote.ui.MainInterfaceTest#"
        "handoffPickerExplainsTransferAndRequiresUserTargetChoice"
    ),
}


def adb(serial: str, *args: str, binary: bool = False) -> subprocess.CompletedProcess:
    return subprocess.run(
        [str(ADB), "-s", serial, *args],
        cwd=ROOT,
        capture_output=True,
        text=not binary,
        check=False,
    )


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def install_and_find_runner(serial: str) -> str:
    for apk in (APP_APK, TEST_APK):
        result = adb(serial, "install", "-r", "-t", str(apk))
        if result.returncode != 0 or "Success" not in result.stdout:
            raise SystemExit(f"{serial}: install failed for {apk.name}: {result.stdout}{result.stderr}")
    instruments = adb(serial, "shell", "pm", "list", "instrumentation").stdout.splitlines()
    matches = [line.removeprefix("instrumentation:").split(" (target=")[0] for line in instruments if "ai.drsai.remote" in line]
    if len(matches) != 1:
        raise SystemExit(f"{serial}: expected one OpenDrSai instrumentation, got {matches}")
    return matches[0]


def capture(serial: str, api: str, name: str, test: str, runner: str) -> dict:
    directory = PENDING / "m10-f02-media" / f"api{api}" / name
    directory.mkdir(parents=True, exist_ok=True)
    remote_video = f"/sdcard/p10-{api}-{name}.mp4"
    video_process = subprocess.Popen(
        [str(ADB), "-s", serial, "shell", "screenrecord", "--time-limit", "6", remote_video],
        cwd=ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    time.sleep(0.5)
    result = adb(serial, "shell", "am", "instrument", "-w", "-r", "-e", "class", test, runner)
    screenshot = adb(serial, "exec-out", "screencap", "-p", binary=True)
    screenshot_path = directory / "final.png"
    screenshot_path.write_bytes(screenshot.stdout if isinstance(screenshot.stdout, bytes) else b"")
    try:
        video_process.wait(timeout=8)
    except subprocess.TimeoutExpired:
        video_process.terminate()
        video_process.wait(timeout=2)
    video_path = directory / "journey.mp4"
    pull = adb(serial, "pull", remote_video, str(video_path))
    adb(serial, "shell", "rm", remote_video)
    raw_path = directory / "instrumentation.txt"
    raw = (result.stdout or "") + (result.stderr or "")
    raw_path.write_text(raw, encoding="utf-8")
    passed = result.returncode == 0 and "OK (" in raw and "FAILURES!!!" not in raw
    return {
        "passed": passed,
        "test": test,
        "screenshot": str(screenshot_path.relative_to(ROOT)).replace("\\", "/"),
        "video": str(video_path.relative_to(ROOT)).replace("\\", "/"),
        "instrumentation": str(raw_path.relative_to(ROOT)).replace("\\", "/"),
        "screenshot_sha256": sha256(screenshot_path) if screenshot_path.stat().st_size else None,
        "video_sha256": sha256(video_path) if pull.returncode == 0 and video_path.is_file() else None,
    }


def write_junit(api: str, journeys: dict[str, dict]) -> Path:
    failures = sum(not value["passed"] for value in journeys.values())
    suite = ET.Element("testsuite", name=f"P10KeyJourneysApi{api}", tests=str(len(journeys)), failures=str(failures), errors="0")
    for name, value in journeys.items():
        case = ET.SubElement(suite, "testcase", classname="P10KeyJourneys", name=name)
        if not value["passed"]:
            ET.SubElement(case, "failure", message="instrumentation journey failed")
    path = PENDING / "m10-f02-media" / f"api{api}" / "junit.xml"
    ET.ElementTree(suite).write(path, encoding="utf-8", xml_declaration=True)
    return path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-media", action="store_true")
    parser.add_argument("--only", choices=tuple(JOURNEYS))
    args = parser.parse_args()
    previous = json.loads(OUTPUT.read_text(encoding="utf-8")) if args.only and OUTPUT.is_file() else {"matrix": {}}
    matrix = {}
    candidate_hashes = set()
    for api, serial in DEVICES.items():
        sdk = adb(serial, "shell", "getprop", "ro.build.version.sdk").stdout.strip()
        if sdk != api:
            raise SystemExit(f"{serial}: expected API {api}, got {sdk!r}")
        handoff_path = PENDING / f"m10-f02-handoff-api{api}.json"
        handoff = json.loads(handoff_path.read_text(encoding="utf-8"))
        candidate_hashes.add(handoff["apk_sha256"])
        runner = install_and_find_runner(serial) if not args.skip_media else None
        journeys = dict(previous["matrix"].get(api, {}).get("journeys", {})) if args.only else {}
        selected = {args.only: JOURNEYS[args.only]} if args.only else JOURNEYS
        if not args.skip_media:
            journeys.update({name: capture(serial, api, name, test, runner) for name, test in selected.items()})
        junit = write_junit(api, journeys) if journeys else None
        matrix[api] = {
            "serial": serial,
            "api": int(sdk),
            "journeys": journeys,
            "junit": str(junit.relative_to(ROOT)).replace("\\", "/") if junit else None,
            "handoff": {
                "passed": handoff.get("passed") is True,
                "android_to_desktop_events": handoff.get("android_to_desktop", {}).get("event_count"),
                "desktop_to_android_events": handoff.get("desktop_to_android", {}).get("event_count"),
                "side_effect_execution_count": handoff.get("cross_end_approval_race", {}).get("side_effect_execution_count"),
                "source": str(handoff_path.relative_to(ROOT)).replace("\\", "/"),
            },
        }
    gates = {
        "api_26_30_35_36_present": set(matrix) == set(DEVICES),
        "all_five_journeys_green": all(len(v["journeys"]) == 5 and all(j["passed"] for j in v["journeys"].values()) for v in matrix.values()),
        "screenshot_video_and_instrumentation_per_journey": all(
            j["screenshot_sha256"] and j["video_sha256"] and j["instrumentation"]
            for v in matrix.values() for j in v["journeys"].values()
        ),
        "junit_per_api": all(v["junit"] for v in matrix.values()),
        "oaep_handoff_per_api": all(
            v["handoff"]["passed"] and v["handoff"]["android_to_desktop_events"] == 9
            and v["handoff"]["desktop_to_android_events"] == 9
            and v["handoff"]["side_effect_execution_count"] == 1
            for v in matrix.values()
        ),
        "single_candidate_apk": len(candidate_hashes) == 1,
    }
    report = {
        "schema_version": 1,
        "feature_id": "M10-F02",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "passed": all(gates.values()),
        "candidate_apk_sha256": next(iter(candidate_hashes)) if len(candidate_hashes) == 1 else None,
        "gates": gates,
        "matrix": matrix,
    }
    OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "gates": sum(gates.values()), "total": len(gates)}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
