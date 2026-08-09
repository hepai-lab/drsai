from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def call(tmp_path: Path, *args: str) -> object:
    completed = subprocess.run(
        [sys.executable, str(ROOT / "control_bridge.py"), "--output-root", str(tmp_path), *args],
        cwd=ROOT, capture_output=True, text=True, encoding="utf-8", check=True,
    )
    return json.loads(completed.stdout)


def test_bridge_lists_dynamic_p3_catalog(tmp_path: Path) -> None:
    value = call(tmp_path, "list-cases", "--suite", "p3-desktop")
    assert isinstance(value, dict)
    assert len(value["cases"]) == 12
    assert value["cases"][0]["id"] == "qa.greeting.hello"


def test_bridge_begins_and_reads_persistent_evaluation(tmp_path: Path) -> None:
    detail = call(tmp_path, "get-case", "--case", "qa.greeting.hello")
    started = call(
        tmp_path, "begin", "--suite", "p3-desktop", "--case", detail["id"],
        "--revision", str(detail["revision"]), "--definition-sha256", detail["definition_sha256"],
    )
    restored = call(tmp_path, "get", "--evaluation", started["evaluation_id"])
    assert restored["status"] == "preflighting"
