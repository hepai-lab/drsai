from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[5]
SCRIPT = ROOT / "scripts/assemble_mobile_remote_workspace_real_evidence_v3.py"
SPEC = importlib.util.spec_from_file_location("mobile_real_evidence_v3", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def catalog_report() -> dict:
    return {
        "passed": True,
        "checks": [
            {
                "name": "pre_pair_invisible",
                "status": "passed",
                "target_visible": False,
            },
            {
                "name": "pair_and_catalog",
                "status": "passed",
                "target_visible": True,
                "runtime_status": "online",
                "workspace_lifecycles": ["active"],
                "directory_ui_visible": True,
                "session_list_ui_visible": True,
                "screenshot_artifact": "catalog.png",
                "screenshot_sha256": "a" * 64,
            },
            {
                "name": "message_stream_approval",
                "status": "passed",
                "approval_status": "approved",
                "terminal_status": "completed",
                "successful_decisions": 1,
                "tool_execution_count": 1,
                "session_ui_visible": True,
            },
        ],
    }


def device_report() -> dict:
    return {
        "passed": True,
        "checks": [
            {
                "name": "two_device_isolation",
                "status": "passed",
                "device_a_revoked_status": 403,
                "device_b_status": 200,
                "credential_copy_rejected": True,
                "independent_association_ids": True,
            },
            {
                "name": "revocation_stream_closed",
                "status": "passed",
                "stream_closed_immediately": True,
                "subsequent_status": 403,
                "other_device_stream_open": True,
            },
        ],
    }


def stability_report() -> dict:
    return {
        "passed": True,
        "faults": [
            {
                "name": name,
                "status": "passed",
                "transcript_hash_preserved": True,
                "snapshot_sequence_preserved": True,
                "run_count_preserved": True,
                "event_count_preserved": True,
                "identity_transition_valid": True,
                "duplicate_run_count": 0,
                "duplicate_sequence_count": 0,
                "missing_sequence_count": 0,
                "recovery_seconds": 3.5,
            }
            for name in MODULE.FAULT_TO_CHECK
        ],
    }


def test_assembler_produces_exact_pre_convergence_real_check_set() -> None:
    result = MODULE.assemble(
        catalog_report(),
        device_report(),
        stability_report(),
    )
    assert result["passed"] is True
    assert {row["name"] for row in result["checks"]} == {
        "pre_pair_invisible",
        "pair_and_catalog",
        "approval_single_decision",
        "two_device_isolation",
        "revocation_stream_closed",
        *MODULE.FAULT_TO_CHECK.values(),
    }
    assert len(result["checks"]) == 10


@pytest.mark.parametrize("failure", ["approval", "device", "fault"])
def test_assembler_fails_closed_on_weak_component_evidence(failure: str) -> None:
    catalog = catalog_report()
    device = device_report()
    stability = stability_report()
    if failure == "approval":
        catalog["checks"][2]["tool_execution_count"] = 2
    elif failure == "device":
        device["checks"][0]["credential_copy_rejected"] = False
    else:
        stability["faults"][0]["identity_transition_valid"] = False
    with pytest.raises(RuntimeError):
        MODULE.assemble(catalog, device, stability)
