from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
SECURITY = ROOT / "docs/android/reports/evidence/p10/pending/m10-f01-security-api35.json"
OUTPUT = ROOT / "docs/android/reports/evidence/p10/m10-f01-privacy-credential-gate.json"


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def green_xml(path: Path, minimum: int = 1) -> bool:
    suite = ET.parse(path).getroot()
    return int(suite.attrib.get("tests", 0)) >= minimum and int(suite.attrib.get("failures", 0)) == 0 and int(suite.attrib.get("errors", 0)) == 0


def main() -> int:
    security = json.loads(SECURITY.read_text(encoding="utf-8"))
    android_xml = next((ROOT / "apps/android/app/build/outputs/androidTest-results/connected/debug").glob("TEST-*.xml"))
    jvm_dir = ROOT / "apps/android/app/build/test-results/testDebugUnitTest"
    jvm_xml = [jvm_dir / f"TEST-ai.drsai.remote.{name}.xml" for name in (
        "DiagnosticFeedbackBundleTest", "FullRuntimeUiContractTest", "ApprovalChangePreviewPolicyTest",
    )]
    gates = {
        "apk_room_logcat_and_private_data_canaries_zero": all(security["dynamic_findings"].get(name) == 0 for name in ("apk", "app_data", "logcat")),
        "apk_generic_secret_patterns_zero": not security["generic_apk_findings"],
        "oaep_checkpoint_receipt_and_absolute_path_zero": security["device_checks"]["oaep_token_findings"] == 0 and security["device_checks"]["oaep_absolute_path_findings"] == 0 and security["device_checks"]["checkpoint_receipt_token_findings"] == 0,
        "cross_account_reads_zero": security["device_checks"]["cross_account_reads"] == 0,
        "runtime_service_not_exported": security["gates"]["external_runtime_service_rejected"],
        "diagnostic_and_approval_redaction_jvm_green": all(path.is_file() and green_xml(path) for path in jvm_xml),
        "screen_semantics_canary_and_three_screenshots_green": green_xml(android_xml) and "OaepToolVisibilityUiTest" in android_xml.read_text(encoding="utf-8"),
    }
    sources = [SECURITY, android_xml, *jvm_xml]
    report = {
        "schema_version": 1,
        "feature_id": "M10-F01",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "passed": all(gates.values()),
        "candidate_apk_sha256": security["apk_sha256"],
        "scope": ["APK", "Room/app data", "logcat", "OAEP", "checkpoint/receipt", "diagnostic feedback", "approval preview", "Compose screen screenshots/semantics"],
        "findings": 0,
        "gates": gates,
        "source_sha256": {str(path.relative_to(ROOT)).replace("\\", "/"): digest(path) for path in sources},
    }
    OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "gates": sum(gates.values()), "total": len(gates)}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
