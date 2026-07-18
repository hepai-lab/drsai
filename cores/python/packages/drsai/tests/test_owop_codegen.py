from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from drsai.owop.generated import OWOP_PARAMS_BY_OPERATION, OWOP_RESULTS_BY_OPERATION, OWOP_VERSION
from drsai.owop.protocol import OWOPProtocol


ROOT = Path(__file__).resolve().parents[5]
GENERATOR = ROOT / "scripts" / "generate-owop-types.py"
SCHEMA = ROOT / "protocol" / "owop" / "owop.schema.json"


def test_generated_python_and_typescript_have_zero_drift() -> None:
    completed = subprocess.run([sys.executable, str(GENERATOR), "--check"], capture_output=True, text=True)
    assert completed.returncode == 0, completed.stdout + completed.stderr
    protocol = OWOPProtocol(SCHEMA)
    assert OWOP_VERSION == protocol.version
    assert set(OWOP_PARAMS_BY_OPERATION) == set(protocol.operations)
    assert set(OWOP_RESULTS_BY_OPERATION) == set(protocol.results)


def test_schema_change_without_regeneration_fails_drift_gate(tmp_path: Path) -> None:
    changed = json.loads(SCHEMA.read_text(encoding="utf-8"))
    changed["x-owop-operations"]["future.breaking"] = {
        "type": "object", "additionalProperties": False, "required": ["value"],
        "properties": {"value": {"type": "string"}},
    }
    changed_schema = tmp_path / "changed.schema.json"
    changed_schema.write_text(json.dumps(changed), encoding="utf-8")
    completed = subprocess.run([
        sys.executable,
        str(GENERATOR),
        "--schema", str(changed_schema),
        "--check",
    ], capture_output=True, text=True)
    assert completed.returncode == 1
    assert "drift" in completed.stdout
