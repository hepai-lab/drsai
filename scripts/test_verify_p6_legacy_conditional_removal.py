from __future__ import annotations

import json
from pathlib import Path

import pytest

import verify_p6_legacy_conditional_removal as verifier


def _write(tmp_path: Path, name: str, value: object) -> Path:
    path = tmp_path / name
    path.write_text(json.dumps(value), encoding="utf-8")
    return path


def test_current_legacy_removal_path_is_complete_but_does_not_claim_production_deletion() -> None:
    report = verifier.verify()
    assert report["passed"] is True
    assert report["legacy_deleted"] is False
    assert report["production_evidence_required"] is True
    assert report["checks"]["contract_negative_matrix"] == 5


def test_contract_without_supported_runtime_gate_fails_closed(tmp_path: Path) -> None:
    contract = json.loads(verifier.CONTRACT.read_text(encoding="utf-8"))
    schema = contract["$defs"]["protocol_deletion_decision"]
    schema["required"].remove("supported_runtime_requires_legacy")
    schema["properties"].pop("supported_runtime_requires_legacy")
    with pytest.raises(verifier.LegacyConditionalRemovalError):
        verifier.verify(contract_path=_write(tmp_path, "contract.json", contract))


def test_wait_window_or_missing_runtime_evidence_policy_fails_closed(tmp_path: Path) -> None:
    inventory = json.loads(verifier.INVENTORY.read_text(encoding="utf-8"))
    inventory["policy"]["long_observation_window_required"] = True
    with pytest.raises(verifier.LegacyConditionalRemovalError, match="wait_window_reintroduced"):
        verifier.verify(inventory_path=_write(tmp_path, "inventory.json", inventory))
    inventory = json.loads(verifier.INVENTORY.read_text(encoding="utf-8"))
    inventory["policy"]["delete_only_when"].remove(
        "supported_runtime_requires_legacy=false"
    )
    with pytest.raises(verifier.LegacyConditionalRemovalError, match="inventory_policy_invalid"):
        verifier.verify(inventory_path=_write(tmp_path, "inventory-missing.json", inventory))


def test_duplicate_contract_key_fails_closed(tmp_path: Path) -> None:
    source = verifier.CONTRACT.read_text(encoding="utf-8")
    path = tmp_path / "duplicate.json"
    path.write_text(source.replace("{", '{"$schema":"duplicate",', 1), encoding="utf-8")
    with pytest.raises(verifier.LegacyConditionalRemovalError, match="duplicate_json_key"):
        verifier.verify(contract_path=path)
