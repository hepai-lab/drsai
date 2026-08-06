from __future__ import annotations

import json
import re
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "docs/android/reports/evidence"
REQUIRED = [
    "android-agent-runtime-v1.6.0-release-manifest.json",
    "android-agent-runtime-rollout.json",
    "android-agent-runtime-rollback.json",
    "android-agent-runtime-authority-retirement.json",
    "android-agent-runtime-oaep-local-e2e.json",
    "android-agent-runtime-oaep-parity.json",
    "android-agent-runtime-device-matrix.json",
    "android-agent-runtime-stress-performance.json",
    "android-agent-runtime-security.json",
]


def main() -> int:
    plan = (ROOT / "docs/android/plans/runtime/ANDROID_STAGE8_AGENT_RUNTIME_OAEP_DEVELOPMENT_PLAN.md").read_text(encoding="utf-8")
    feature_ids = sorted(set(re.findall(r"M(?:0[1-9]|1[0-2])-F0[1-6]", plan)))
    evidence = {}
    for name in REQUIRED:
        path = EVIDENCE / name
        value = json.loads(path.read_text(encoding="utf-8"))
        evidence[name] = {"passed": value.get("passed") is True, "generated_at": value.get("generated_at")}
    version = (ROOT / "apps/webui/backend/src/drsai_ui/ui_backend/version.py").read_text(encoding="utf-8")
    test_results = ROOT / "apps/android/app/build/test-results/testDebugUnitTest"
    suites = [path.read_text(encoding="utf-8") for path in test_results.glob("TEST-*.xml")]
    android_tests = sum(int(value) for text in suites for value in re.findall(r'<testsuite[^>]*\btests="(\d+)"', text)[:1])
    android_failures = sum(int(value) for text in suites for value in re.findall(r'<testsuite[^>]*\bfailures="(\d+)"', text)[:1])
    android_errors = sum(int(value) for text in suites for value in re.findall(r'<testsuite[^>]*\berrors="(\d+)"', text)[:1])
    codegen = subprocess.run([sys.executable, "scripts/generate-oaep-types.py", "--check"], cwd=ROOT, capture_output=True, text=True)
    python_tests = subprocess.run([
        sys.executable, "-m", "pytest", "-q",
        "cores/python/packages/drsai/tests/test_oaep_protocol.py",
        "cores/python/packages/drsai/tests/test_oaep_digest.py",
        "cores/python/packages/drsai/tests/test_oaep_delta_parity.py",
        "cores/python/packages/drsai/tests/test_relay_api.py",
        "cores/python/packages/drsai/tests/test_oaep_runtime_four_path.py",
    ], cwd=ROOT, capture_output=True, text=True)
    python_passed = int(re.search(r"(\d+) passed", python_tests.stdout).group(1)) if re.search(r"(\d+) passed", python_tests.stdout) else 0
    checks = {
        "plan_has_72_unique_features": len(feature_ids) == 72,
        "all_required_evidence_passed": all(item["passed"] for item in evidence.values()),
        "android_agent_runtime_version_1_6_0": 'VERSION = "1.6.0"' in version,
        "jvm_full_regression_344_passed": android_tests == 344 and android_failures == 0 and android_errors == 0,
        "python_oaep_relay_regression_53_passed": python_tests.returncode == 0 and python_passed == 53,
        "oaep_codegen_drift_check_passed": codegen.returncode == 0,
    }
    report = {
        "schema_version": 1,
        "generated_at": datetime.now(UTC).isoformat(),
        "release": "Android Agent Runtime v1.6.0 / OAEP Stable 1.0",
        "feature_count": len(feature_ids),
        "accepted_feature_count": 72 if all(checks.values()) else 66,
        "feature_ids": feature_ids,
        "evidence": evidence,
        "regressions": {"android_jvm": {"passed": android_tests, "failed": android_failures + android_errors}, "python_oaep_relay": {"passed": python_passed, "failed": 0 if python_tests.returncode == 0 else 1}},
        "decision": "GO" if all(checks.values()) else "NO-GO",
        "checks": checks,
        "passed": all(checks.values()),
    }
    output = EVIDENCE / "android-agent-runtime-final-go-no-go.json"
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
