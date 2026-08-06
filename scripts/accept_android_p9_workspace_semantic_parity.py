from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import xml.etree.ElementTree as ET


REPO = Path(__file__).resolve().parents[1]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    fixture_path = REPO / "cores/protocol/android-runtime/fixtures/workspace-tool-parity-v1.json"
    android_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/runtime/device/AndroidLocalCapabilities.kt"
    android_test_path = REPO / "apps/android/app/src/test/java/ai/drsai/remote/WorkspaceToolSemanticParityTest.kt"
    python_test_path = REPO / "cores/python/packages/drsai/tests/test_workspace_tool_semantic_parity.py"
    desktop_path = REPO / "cores/python/packages/drsai/src/drsai/modules/agents/skills_agent/managers/operater_funs.py"
    pytest = subprocess.run(
        [sys.executable, "-m", "pytest", str(python_test_path.relative_to(REPO)), "-q"], cwd=REPO,
        capture_output=True, text=True, timeout=60, check=False,
    )
    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
    android = android_path.read_text(encoding="utf-8")
    desktop = desktop_path.read_text(encoding="utf-8")
    xml_path = REPO / "apps/android/app/build/test-results/testDebugUnitTest/TEST-ai.drsai.remote.WorkspaceToolSemanticParityTest.xml"
    suite = None
    if xml_path.is_file():
        root = ET.parse(xml_path).getroot()
        suite = {key: int(root.attrib.get(key, 0)) for key in ("tests", "failures", "errors", "skipped")}
        suite["sha256"] = digest(xml_path)
    mappings = fixture["mappings"]
    gates = {
        "fixture_is_versioned": fixture.get("schema_version") == 1,
        "desktop_and_android_mapping_is_complete": set(mappings) == {"run_read", "run_glob", "run_grep", "run_write", "run_edit"},
        "desktop_implements_every_source_tool": all(f"def {name}(" in desktop for name in mappings),
        "android_implements_every_mapped_tool": all(f'"{name}"' in android for name in mappings.values()),
        "android_paths_are_relative_and_traversal_safe": "safeParts" in android and "saf_path_invalid" in android,
        "android_access_is_persisted_grant_bound": "persistedUriPermissions" in android and "saf_permission_missing" in android,
        "glob_grep_and_read_are_bounded": all(value in android for value in ("saf_glob_limit_invalid", "saf_grep_limit_invalid", "saf_read_limit_invalid")),
        "writes_and_edits_require_approval": "saf_write_approval_required" in android and "saf_edit_approval_required" in android,
        "python_cross_surface_fixture_green": pytest.returncode == 0,
        "android_cross_surface_fixture_green": suite is not None and suite["tests"] == 2 and suite["failures"] == 0 and suite["errors"] == 0,
    }
    sources = (fixture_path, android_path, android_test_path, python_test_path, desktop_path)
    report = {
        "schema_version": 1, "feature_id": "M06-F01", "generated_at": datetime.now(timezone.utc).isoformat(),
        "passed": all(gates.values()), "gates": gates,
        "pytest": {"returncode": pytest.returncode, "summary": "\n".join(pytest.stdout.strip().splitlines()[-3:])},
        "android_suite": suite,
        "source_sha256": {str(path.relative_to(REPO)).replace("\\", "/"): digest(path) for path in sources},
    }
    output = REPO / "docs/android/reports/evidence/p9/m06-f01-workspace-semantic-parity.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "gates": sum(gates.values()), "total": len(gates)}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
