from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[5]
SCRIPT = ROOT / "scripts/smoke_runtime_relay_public_v2.py"
SPEC = importlib.util.spec_from_file_location("runtime_relay_public_smoke", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def test_error_code_accepts_direct_and_fastapi_envelopes() -> None:
    assert MODULE.error_code({"code": "invalid_cursor"}) == "invalid_cursor"
    assert MODULE.error_code({"detail": {"code": "invalid_token"}}) == "invalid_token"
    assert MODULE.error_code({"detail": "unauthorized"}) is None
    assert MODULE.error_code([]) is None


def test_websocket_url_preserves_runtime_relay_mount() -> None:
    assert (
        MODULE.websocket_url("https://ai-dev.ihep.ac.cn/api/runtime-relay/")
        == "wss://ai-dev.ihep.ac.cn/api/runtime-relay/v2/runtime-connect"
        "?runtime_id=runtime-public-smoke&instance_id=instance-public-smoke&version=0"
    )
    assert (
        MODULE.websocket_url("http://127.0.0.1:8080/api/runtime-relay")
        == "ws://127.0.0.1:8080/api/runtime-relay/v2/runtime-connect"
        "?runtime_id=runtime-public-smoke&instance_id=instance-public-smoke&version=0"
    )


def test_required_openapi_paths_cover_mobile_control_plane() -> None:
    assert "/runtimes" in MODULE.REQUIRED_OPENAPI_PATHS
    assert "/runtimes/{runtime_id}/workspaces" in MODULE.REQUIRED_OPENAPI_PATHS
    assert "/runtimes/{runtime_id}/runs/{run_id}/events/stream" in MODULE.REQUIRED_OPENAPI_PATHS
    assert (
        "/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/"
        "{session_id}/conversation-snapshot"
    ) in MODULE.REQUIRED_OPENAPI_PATHS
    assert (
        "/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/"
        "{session_id}/events/stream"
    ) in MODULE.REQUIRED_OPENAPI_PATHS
