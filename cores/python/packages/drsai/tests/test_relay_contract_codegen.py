from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[5]


def test_relay_contract_generated_files_have_no_drift() -> None:
    result = subprocess.run([sys.executable, str(ROOT / "scripts/generate_relay_contract.py"), "--check"],
                            cwd=ROOT, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr + result.stdout


def test_relay_openapi_has_no_drift_and_contract_is_backward_compatible() -> None:
    for script in ("generate_relay_openapi.py", "check_relay_contract_compatibility.py"):
        arguments = [sys.executable, str(ROOT / "scripts" / script)]
        if script.startswith("generate"):
            arguments.append("--check")
        result = subprocess.run(arguments, cwd=ROOT, capture_output=True, text=True)
        assert result.returncode == 0, result.stderr + result.stdout


def test_schema_forbids_privilege_and_canonical_path_inputs() -> None:
    schema = json.loads((ROOT / "protocol/relay/runtime-relay.schema.json").read_text(encoding="utf-8"))
    serialized = json.dumps(schema)
    assert "canonical_path" not in serialized
    assert '"permission"' not in serialized
    assert schema["protocol_version"] == "owop/1"
