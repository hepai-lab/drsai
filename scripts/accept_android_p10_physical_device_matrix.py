from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess


ROOT = Path(__file__).resolve().parents[1]
ANDROID = ROOT / "apps/android"
OUTPUT = ROOT / "docs/android/reports/evidence/p10/m10-f04-physical-device-matrix.json"
APP_APK = ANDROID / "app/build/outputs/apk/debug/OpenDrSai-Android-v1.5.7.apk"
TEST_APK = ANDROID / "app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk"
PACKAGE = "ai.drsai.remote.debug"
OBSERVED_JOURNEYS = {"login", "first_success", "tools", "approval", "background", "recovery", "accessibility"}
CLASSES = [
    "ai.drsai.remote.LoginScreenTest",
    "ai.drsai.remote.OidcRedirectTest",
    "ai.drsai.remote.SetupJourneyStoreInstrumentedTest",
    "ai.drsai.remote.FirstTaskJourneyInstrumentedTest",
    "ai.drsai.remote.FullRuntimePhysicalAcceptanceTest",
    "ai.drsai.remote.RemoteApprovalDecisionLedgerTest",
    "ai.drsai.remote.P9RuntimeCancelBackgroundInstrumentedTest",
    "ai.drsai.remote.runtime.device.OaepRunNotificationIntentTest",
    "ai.drsai.remote.ui.CoreAccessibilitySemanticsTest",
]


def command(args: list[str], timeout: int = 1200) -> str:
    result = subprocess.run(
        args, cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace",
        timeout=timeout, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
    )
    output = result.stdout + result.stderr
    if result.returncode:
        raise RuntimeError(f"command_failed:{result.returncode}\n{output[-8000:]}")
    return output


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def classify_device(*, serial: str, state: str, qemu: str, abi: str, api: int, size: str, density: str) -> dict:
    if state != "device" or qemu == "1" or serial.startswith("emulator-"):
        raise RuntimeError(f"physical_device_required:{serial}")
    if not abi.startswith("arm64"):
        raise RuntimeError(f"arm64_device_required:{serial}:{abi}")
    pixels = re.search(r"(\d+)x(\d+)", size)
    dpi = re.search(r"(\d+)", density)
    if not pixels or not dpi or int(dpi.group(1)) <= 0:
        raise RuntimeError(f"device_geometry_unreadable:{serial}")
    width, height = map(int, pixels.groups())
    smallest_dp = min(width, height) * 160 / int(dpi.group(1))
    return {"serial": serial, "api": api, "abi": abi, "form_factor": "tablet" if smallest_dp >= 600 else "phone", "smallest_width_dp": round(smallest_dp, 1)}


def validate_matrix(rows: list[dict]) -> None:
    factors = {row["form_factor"] for row in rows}
    if not {"phone", "tablet"} <= factors:
        raise RuntimeError(f"phone_and_tablet_required:{sorted(factors)}")
    if any(row["api"] < 30 for row in rows):
        raise RuntimeError("physical_device_api30_or_newer_required")


def validate_observations(document: dict, serials: set[str]) -> dict[str, dict]:
    rows = document.get("devices")
    if not isinstance(rows, list):
        raise ValueError("physical_observation_devices_required")
    mapped = {row.get("serial"): row for row in rows if isinstance(row, dict)}
    if set(mapped) != serials:
        raise ValueError("physical_observation_serials_must_match")
    for serial, row in mapped.items():
        journeys = row.get("journeys")
        if not isinstance(journeys, dict) or set(journeys) != OBSERVED_JOURNEYS or any(value is not True for value in journeys.values()):
            raise ValueError(f"all_observed_journeys_must_pass:{serial}")
        evidence = row.get("evidence")
        if not isinstance(evidence, list) or not evidence or any(not isinstance(value, str) or not value.strip() for value in evidence):
            raise ValueError(f"physical_media_evidence_required:{serial}")
    return mapped


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--serial", action="append", required=True)
    parser.add_argument("--adb", type=Path, default=Path.home() / "AppData/Local/Android/Sdk/platform-tools/adb.exe")
    parser.add_argument("--app-apk", type=Path, default=APP_APK)
    parser.add_argument("--test-apk", type=Path, default=TEST_APK)
    parser.add_argument("--observations", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    options = parser.parse_args()
    for path in (options.adb, options.app_apk, options.test_apk, options.observations):
        if not path.is_file():
            raise FileNotFoundError(path)
    devices = []
    for serial in options.serial:
        base = [str(options.adb), "-s", serial]
        prop = lambda name: command(base + ["shell", "getprop", name], 30).strip()
        row = classify_device(
            serial=serial, state=command(base + ["get-state"], 30).strip(), qemu=prop("ro.kernel.qemu"),
            abi=prop("ro.product.cpu.abi"), api=int(prop("ro.build.version.sdk")),
            size=command(base + ["shell", "wm", "size"], 30), density=command(base + ["shell", "wm", "density"], 30),
        )
        row["device_id_sha256"] = hashlib.sha256((serial + "\0" + prop("ro.build.fingerprint")).encode()).hexdigest()
        row["manufacturer"] = prop("ro.product.manufacturer")
        row["model"] = prop("ro.product.model")
        devices.append(row)
    validate_matrix(devices)
    observation_bytes = options.observations.read_bytes()
    observations = validate_observations(json.loads(observation_bytes.decode("utf-8")), set(options.serial))
    for row in devices:
        base = [str(options.adb), "-s", row["serial"]]
        for apk in (options.app_apk, options.test_apk):
            command(base + ["install", "-r", "-t", str(apk.resolve())], 300)
        runners = [line.removeprefix("instrumentation:").split(" (target=")[0] for line in command(base + ["shell", "pm", "list", "instrumentation"], 30).splitlines() if PACKAGE in line]
        if len(runners) != 1:
            raise RuntimeError(f"instrumentation_runner_invalid:{row['serial']}:{runners}")
        raw = command(base + ["shell", "am", "instrument", "-w", "-r", "-e", "class", ",".join(CLASSES), runners[0]], 2400)
        count = re.search(r"OK \((\d+) tests?\)", raw)
        row["journeys"] = {name: name in raw for name in CLASSES}
        row["instrumentation_tests"] = int(count.group(1)) if count else 0
        row["observed_journeys"] = observations[row["serial"]]["journeys"]
        row["media_evidence"] = observations[row["serial"]]["evidence"]
        row["passed"] = bool(count) and "FAILURES!!!" not in raw and all(row["journeys"].values()) and all(row["observed_journeys"].values())
    passed = all(row["passed"] for row in devices)
    report = {
        "schema_version": "opendrsai.p10-physical-device-matrix-result/1", "feature_id": "M10-F04",
        "generated_at": datetime.now(timezone.utc).isoformat(), "passed": passed, "devices": devices,
        "required_journeys": ["login", "first_success", "tools", "approval", "background", "recovery", "accessibility"],
        "provenance": {"app_apk_sha256": sha256(options.app_apk), "test_apk_sha256": sha256(options.test_apk), "observations_sha256": hashlib.sha256(observation_bytes).hexdigest()},
    }
    options.output.parent.mkdir(parents=True, exist_ok=True)
    options.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": passed, "devices": [(r["form_factor"], r["api"]) for r in devices]}))
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
