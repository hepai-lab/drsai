from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[5]
SCRIPT = ROOT / "scripts/smoke_runtime_relay_public_v4.py"
SPEC = importlib.util.spec_from_file_location("runtime_relay_public_smoke_v4", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def test_v4_public_smoke_requires_all_native_oaep_endpoints() -> None:
    assert len(MODULE.OAEP_PATHS) == 3
    assert all("oaep-" in path for path in MODULE.OAEP_PATHS)
    assert not any("conversation" in path for path in MODULE.OAEP_PATHS)


def test_v4_public_smoke_requires_native_oaep_schemas() -> None:
    assert MODULE.OAEP_SCHEMA_NAMES == {"OaepSnapshot", "OaepEventPage", "OaepEvent"}
    assert len(MODULE.OAEP_SCHEMA_SHA256) == 64


def test_v4_public_smoke_requires_authoritative_schema_hash_on_all_routes() -> None:
    openapi = {
        "paths": {
            path: {"get": {"x-oaep-schema-sha256": MODULE.OAEP_SCHEMA_SHA256}}
            for path in MODULE.OAEP_PATHS
        }
    }
    assert MODULE.validate_schema_hash(openapi) == MODULE.OAEP_SCHEMA_SHA256
    first = next(iter(MODULE.OAEP_PATHS))
    openapi["paths"][first]["get"]["x-oaep-schema-sha256"] = "0" * 64
    try:
        MODULE.validate_schema_hash(openapi)
    except MODULE.SmokeFailure:
        pass
    else:
        raise AssertionError("schema drift was accepted")


def test_v4_error_code_accepts_fastapi_envelope_only_as_data() -> None:
    assert MODULE.error_code({"detail": {"code": "invalid_token"}}) == "invalid_token"
    assert MODULE.error_code({"detail": "invalid"}) is None
    assert MODULE.error_code([]) is None
