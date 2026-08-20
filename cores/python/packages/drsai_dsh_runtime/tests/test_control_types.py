from __future__ import annotations

import importlib.util
import json
from pathlib import Path

from opendrsai_dsh_runtime.control_types import CONTROL_METHODS


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = Path(__file__).resolve().parents[5]
SCHEMA = REPOSITORY_ROOT / "cores" / "protocol" / "runtime" / "runtime-control.schema.json"
GENERATED = PACKAGE_ROOT / "src" / "opendrsai_dsh_runtime" / "control_types.py"
GENERATOR = PACKAGE_ROOT / "tools" / "generate_control_types.py"


def load_generator():
    spec = importlib.util.spec_from_file_location("generate_control_types", GENERATOR)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_generated_control_types_are_reproducible_and_complete() -> None:
    schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
    generated = load_generator().generate(schema)
    assert GENERATED.read_text(encoding="utf-8") == generated
    assert set(CONTROL_METHODS) == set(schema["x-control-methods"])
    assert set(schema["properties"]["method"]["enum"]) == set(CONTROL_METHODS)
