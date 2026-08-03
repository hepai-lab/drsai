from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[5]
SCRIPT = ROOT / "scripts/collect_mobile_remote_workspace_devices_v4.py"
SPEC = importlib.util.spec_from_file_location("mobile_devices_v4", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def test_device_proof_parser_and_report_emit_only_irreversible_digests() -> None:
    first, second = "a" * 64, "b" * 64
    output = "OPENDRSAI_REAL_DEVICE_PROOF=" + json.dumps(
        {"phase": "device-proof", "device_proof_sha256": first}
    )
    assert MODULE.parse_proof(output) == first
    result = MODULE.report([first, second])
    assert result == {
        "schema_version": 1,
        "passed": True,
        "devices": [
            {"device_proof_sha256": first},
            {"device_proof_sha256": second},
        ],
    }


@pytest.mark.parametrize(
    "values",
    [[], ["a" * 64], ["a" * 64, "a" * 64], ["short", "b" * 64]],
)
def test_device_proof_report_fails_closed(values: list[str]) -> None:
    with pytest.raises(RuntimeError, match="v4_device_proofs_invalid"):
        MODULE.report(values)


@pytest.mark.parametrize(
    "output",
    ["", "OPENDRSAI_REAL_DEVICE_PROOF={}", "OPENDRSAI_REAL_DEVICE_PROOF=not-json"],
)
def test_device_proof_parser_fails_closed(output: str) -> None:
    with pytest.raises(RuntimeError, match="v4_device_proof_invalid"):
        MODULE.parse_proof(output)
