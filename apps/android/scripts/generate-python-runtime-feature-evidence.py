"""Create the honest 40-point acceptance matrix for the Python Runtime prototype."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path


PARTIAL = {
    "M01-F03": "TUI/Desktop have not yet been switched to the mobile Core factory",
    "M04-F04": "device timeout and SSE fault-injection evidence is pending",
    "M07-F04": "APK scan passed; device log and app-data scans are pending",
    "M08-F05": "Beta remains disabled until the Samsung arm64 physical-device gate passes",
}
DEVICE_PENDING = {
    "M02-F02": "runtime process isolation requires API 35 device evidence",
    "M02-F03": "interpreter shutdown and process release require device evidence",
    "M06-F04": "kill-process recovery test is compiled but not executed",
    "M06-F05": "logout cleanup is implemented and host-tested; service process release requires device evidence",
    "M07-F05": "API 35 emulator metrics passed; Samsung arm64 physical-device metrics remain required",
    "M08-F03": "install-r and rollback verification require a device and baseline APK",
}

DEVICE_RUNTIME_VERIFIED = {"M02-F02", "M02-F03", "M06-F04", "M06-F05"}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--android-tests", type=int, required=True)
    parser.add_argument("--python-tests", type=int, required=True)
    parser.add_argument(
        "--device-runtime-tests",
        type=int,
        default=0,
        help="Passing API 35 runtime-process instrumentation tests.",
    )
    parser.add_argument("--device-security-tests", type=int, default=0)
    parser.add_argument("--cross-surface-factory-tests", type=int, default=0)
    parser.add_argument("--fault-injection-tests", type=int, default=0)
    parser.add_argument("--upgrade-rollback-tests", type=int, default=0)
    parser.add_argument("--physical-device-tests", type=int, default=0)
    args = parser.parse_args()
    rows = []
    for module in range(1, 9):
        for feature in range(1, 6):
            feature_id = f"M{module:02d}-F{feature:02d}"
            status = "passed"
            reason = None
            if feature_id in PARTIAL:
                status, reason = "partial", PARTIAL[feature_id]
            elif feature_id in DEVICE_PENDING:
                status, reason = "device_pending", DEVICE_PENDING[feature_id]
            if args.device_runtime_tests >= 3 and feature_id in DEVICE_RUNTIME_VERIFIED:
                status, reason = "passed", None
            if args.device_security_tests >= 1 and feature_id == "M07-F04":
                status, reason = "passed", None
            if args.cross_surface_factory_tests >= 1 and feature_id == "M01-F03":
                status, reason = "passed", None
            if args.fault_injection_tests >= 1 and feature_id == "M04-F04":
                status, reason = "passed", None
            if args.upgrade_rollback_tests >= 3 and feature_id == "M08-F03":
                status, reason = "passed", None
            if args.physical_device_tests >= 90 and feature_id in {"M07-F05", "M08-F05"}:
                status, reason = "passed", None
            rows.append({
                "feature_id": feature_id,
                "status": status,
                "environment": "automated" if status == "passed" else "not_fully_verified",
                "test_evidence": {
                    "python_mobile_suite": args.python_tests,
                    "android_jvm_suite": args.android_tests,
                    **(
                        {"api35_runtime_instrumentation": args.device_runtime_tests}
                        if feature_id in DEVICE_RUNTIME_VERIFIED and args.device_runtime_tests
                        else {}
                    ),
                    **(
                        {"samsung_arm64_instrumentation": args.physical_device_tests}
                        if feature_id in {"M07-F05", "M08-F05"} and args.physical_device_tests
                        else {}
                    ),
                    **(
                        {"cross_surface_factory": args.cross_surface_factory_tests}
                        if feature_id == "M01-F03" and args.cross_surface_factory_tests
                        else {}
                    ),
                    **(
                        {"fault_injection": args.fault_injection_tests}
                        if feature_id == "M04-F04" and args.fault_injection_tests
                        else {}
                    ),
                    **(
                        {"upgrade_rollback_instrumentation": args.upgrade_rollback_tests}
                        if feature_id == "M08-F03" and args.upgrade_rollback_tests
                        else {}
                    ),
                    **(
                        {"api35_security_instrumentation": args.device_security_tests}
                        if feature_id == "M07-F04" and args.device_security_tests
                        else {}
                    ),
                },
                **({"remaining": reason} if reason else {}),
            })
    counts = {status: sum(row["status"] == status for row in rows) for status in ("passed", "partial", "device_pending")}
    value = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "summary": {"total": 40, **counts},
        "features": rows,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
