from __future__ import annotations

import json
from pathlib import Path

from opendrsai_regression.cli import main


ROOT = Path(__file__).resolve().parents[1]


def test_stop_on_failure_does_not_start_later_cases(tmp_path: Path) -> None:
    fixture_dir = tmp_path / "fixtures"
    fixture_dir.mkdir()
    output = tmp_path / "results"
    exit_code = main([
        "--root", str(ROOT), "run",
        "--case", "qa.greeting.hello", "--case", "qa.constraints.json",
        "--adapter", "fixture", "--fixture-dir", str(fixture_dir),
        "--output", str(output), "--execution-id", "stop-policy", "--stop-on-failure",
    ])
    assert exit_code == 1
    summary = json.loads((output / "stop-policy" / "summary.json").read_text(encoding="utf-8"))
    assert [item["case_id"] for item in summary["results"]] == ["qa.greeting.hello"]
    assert summary["results"][0]["status"] == "error"
