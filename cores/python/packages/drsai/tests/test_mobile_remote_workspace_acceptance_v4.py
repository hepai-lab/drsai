from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[5]
SCRIPT = ROOT / "scripts/mobile_remote_workspace_acceptance_v4.py"
SPEC = importlib.util.spec_from_file_location("acceptance_v4", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def test_v4_ledger_has_exact_plan_topology_and_current_progress() -> None:
    ledger = MODULE.generated()
    assert MODULE.validate(ledger) == []
    assert len(ledger["items"]) == 80
    assert [row["id"] for row in ledger["items"]] == MODULE.expected_ids()
    assert sum(row["status"] == "local_pass" for row in ledger["items"]) == 63
    assert sum(row["status"] == "unverified" for row in ledger["items"]) == 17


def test_v4_release_ready_fails_closed_without_real_evidence() -> None:
    ledger = MODULE.generated()
    assert any(row["id"].startswith("M07-") and row["status"] == "unverified" for row in ledger["items"])
    assert all(row["status"] == "unverified" for row in ledger["items"] if row["id"].startswith("M12-"))


def test_v4_ledger_rejects_false_full_pass() -> None:
    ledger = MODULE.generated()
    ledger["items"][0]["status"] = "full_pass"
    assert any("full_pass requires release evidence" in error for error in MODULE.validate(ledger))
