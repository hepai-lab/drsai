from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from android_p9_legacy_path_gate import audit  # noqa: E402


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    main_apk = ROOT / "apps/android/app/build/outputs/apk/debug/OpenDrSai-Android-v1.5.6.apk"
    test_apk = ROOT / "apps/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk"
    test = ROOT / "cores/python/packages/drsai/tests/test_android_p9_legacy_path_gate.py"
    engine = ROOT / "cores/python/packages/drsai/src/drsai/backend/runtime/mobile_core/engine.py"
    factory = ROOT / "cores/python/packages/drsai/src/drsai/backend/runtime/mobile_core/factory.py"
    probe = ROOT / "apps/android/app/src/main/python/runtime_probe.py"
    gradle = ROOT / "apps/android/app/build.gradle.kts"
    sources = (test, engine, factory, probe, gradle)
    result = audit(ROOT, main_apk, test_apk)
    pytest = subprocess.run(
        [sys.executable, "-m", "pytest", str(test.relative_to(ROOT)), "-q"], cwd=ROOT,
        capture_output=True, text=True, timeout=60, check=False,
    )
    gates = {**result.gates, "fault_injection_static_gate_tests_are_green": pytest.returncode == 0}
    report = {
        "schema_version": 1, "feature_id": "M12-F05",
        "generated_at": datetime.now(timezone.utc).isoformat(), "passed": all(gates.values()),
        "gates": gates, "errors": list(result.errors),
        "main_apk_sha256": digest(main_apk), "test_apk_sha256": digest(test_apk),
        "pytest": {"returncode": pytest.returncode, "summary": "\n".join(pytest.stdout.strip().splitlines()[-3:])},
        "source_sha256": {str(path.relative_to(ROOT)).replace("\\", "/"): digest(path) for path in sources},
    }
    output = ROOT / "docs/android/reports/evidence/p9/m12-f05-legacy-path-retirement.json"
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "gates": sum(gates.values()), "total": len(gates)}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
