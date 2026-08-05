from __future__ import annotations

import hashlib
import importlib.util
import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[5]
SCHEMA = ROOT / "cores/protocol/oaep/oaep.schema.json"
PYTHON = ROOT / "cores/python/packages/drsai/src/drsai/oaep/generated.py"
TYPESCRIPT = ROOT / "apps/desktop/shared/api/oaep.generated.ts"
KOTLIN = ROOT / "apps/android/app/src/main/java/ai/drsai/remote/remote/generated/OaepGenerated.kt"


def test_oaep_generated_types_have_no_drift() -> None:
    result = subprocess.run(
        [sys.executable, str(ROOT / "scripts/generate-oaep-types.py"), "--check"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_oaep_generated_types_pin_schema_version_digest_and_enums() -> None:
    schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
    digest = hashlib.sha256(SCHEMA.read_bytes()).hexdigest()
    spec = importlib.util.spec_from_file_location("oaep_generated_contract", PYTHON)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.OAEP_VERSION == schema["version"]
    assert module.OAEP_SCHEMA_SHA256 == digest
    assert module.OAEP_PROFILE == "oaep.session-stream/1"
    for path in (TYPESCRIPT, KOTLIN):
        content = path.read_text(encoding="utf-8")
        assert digest in content
        assert "oaep.session-stream/1" in content
        for value in schema["$defs"]["itemType"]["enum"]:
            assert value in content
        for value in schema["$defs"]["eventType"]["enum"]:
            assert value in content
