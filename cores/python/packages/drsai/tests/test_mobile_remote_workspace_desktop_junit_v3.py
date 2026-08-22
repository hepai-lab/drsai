from __future__ import annotations

import importlib.util
import sys
import xml.etree.ElementTree as ET
from pathlib import Path


ROOT = Path(__file__).resolve().parents[5]
SCRIPT = ROOT / "scripts/run_mobile_remote_workspace_desktop_tests_v3.py"
SPEC = importlib.util.spec_from_file_location("desktop_junit_v3", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def test_desktop_junit_contains_four_secret_free_pass_cases(tmp_path: Path) -> None:
    path = tmp_path / "desktop.xml"
    results = [
        MODULE.Result(name=name, duration_seconds=index / 10, returncode=0)
        for index, (name, _) in enumerate(MODULE.COMMANDS)
    ]
    MODULE.write_junit(path, results)
    root = ET.parse(path).getroot()
    assert root.attrib["tests"] == "4"
    assert root.attrib["failures"] == "0"
    assert [row.attrib["name"] for row in root.findall("testcase")] == [
        name for name, _ in MODULE.COMMANDS
    ]
    assert "stdout" not in path.read_text(encoding="utf-8")


def test_desktop_junit_records_only_failed_exit_code(tmp_path: Path) -> None:
    path = tmp_path / "desktop.xml"
    MODULE.write_junit(
        path,
        [MODULE.Result("desktop-node-typecheck", 0.1, 17)],
    )
    failure = ET.parse(path).getroot().find(".//failure")
    assert failure is not None
    assert failure.text == "exit_code=17"
