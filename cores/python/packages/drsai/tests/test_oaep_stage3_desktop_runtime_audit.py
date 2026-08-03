from __future__ import annotations

import importlib.util
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[5]
SCRIPT = ROOT / "scripts/verify_oaep_stage3_desktop_runtime_audit.py"
SPEC = importlib.util.spec_from_file_location("oaep_stage3_desktop_runtime_audit", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def test_desktop_runtime_audit_is_complete_without_android_device() -> None:
    report = MODULE.build_report(require_complete=True)
    assert report["scope"] == "windows_desktop_runtime"
    assert report["passed"] is True
    assert report["complete"] is True
    assert report["feature_total"] == 27
    assert report["counts"] == {"passed_local": 27}
    assert report["completion_percent"] == 100.0
    assert report["blockers"] == []


def test_desktop_runtime_audit_excludes_android_owned_features() -> None:
    report = MODULE.build_report(require_complete=True)
    feature_ids = {row["id"] for row in report["features"]}
    out_of_scope = set(report["out_of_scope"]["android_owned_feature_ids"])
    assert not (feature_ids & out_of_scope)
    assert {"M02-F04", "M06-F01", "M06-F05", "M07-F04"} <= out_of_scope
    assert "M05-F02" in out_of_scope


def test_desktop_runtime_audit_keeps_core_windows_runtime_modules() -> None:
    report = MODULE.build_report(require_complete=True)
    feature_ids = {row["id"] for row in report["features"]}
    assert {
        "M01-F03",
        "M01-F05",
        "M03-F01",
        "M03-F06",
        "M04-F06",
        "M05-F05",
        "M07-F05",
    } <= feature_ids
    assert {row["module"] for row in report["module_summaries"]} == {"M01", "M03", "M04", "M05", "M07"}


def test_windows_package_exposes_desktop_runtime_stage3_gate() -> None:
    package = json.loads((ROOT / "apps/desktop/windows/package.json").read_text(encoding="utf-8"))
    scripts = package["scripts"]
    assert "verify:oaep-stage3-desktop-runtime" in scripts
    assert "verify_oaep_stage3_desktop_runtime_audit.py --require-complete" in scripts[
        "verify:oaep-stage3-desktop-runtime"
    ]
