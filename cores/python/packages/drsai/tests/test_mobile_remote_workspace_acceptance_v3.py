from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[5]
SCRIPT = ROOT / "scripts/mobile_remote_workspace_acceptance_v3.py"
LEDGER = ROOT / "release/product-evidence/mobile-remote-workspace-v3/acceptance.json"


def test_v3_acceptance_ledger_has_104_stable_unique_features() -> None:
    ledger = json.loads(LEDGER.read_text(encoding="utf-8"))
    items = ledger["items"]
    assert ledger["expected_count"] == 104
    assert ledger["release_gate"]["required_full_pass"] == 104
    assert ledger["release_gate"]["stability_duration_seconds"] == 3600
    assert len(items) == len({item["id"] for item in items}) == 104
    assert [item["id"] for item in items[-24:]] == [
        f"M{module:02d}-F{feature:02d}"
        for module in range(11, 17)
        for feature in range(1, 5)
    ]
    counts = {
        status: sum(item["status"] == status for item in items)
        for status in {"local_pass", "unverified", "full_pass", "blocked"}
    }
    assert counts == {
        "local_pass": 96,
        "unverified": 8,
        "full_pass": 0,
        "blocked": 0,
    }


def test_v3_acceptance_ledger_has_no_generator_drift() -> None:
    result = subprocess.run(
        [sys.executable, str(SCRIPT), "--check"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr + result.stdout


def test_v3_release_gate_fails_until_all_104_items_have_full_evidence() -> None:
    result = subprocess.run(
        [sys.executable, str(SCRIPT), "--check", "--require-release-ready"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    assert result.returncode != 0
    assert "full_pass=0/104" in result.stderr + result.stdout
