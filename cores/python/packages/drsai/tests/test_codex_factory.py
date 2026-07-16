from pathlib import Path
import sys

import pytest

from drsai.backend.codex_adapter.factory import build_codex_adapter
from drsai.backend.runtime_engine import RuntimeEngine, RuntimeEngineIdentity


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_factory_builds_lazy_runtime_owned_backend_in_development(tmp_path: Path):
    engine = RuntimeEngine(tmp_path / "engine.sqlite3", RuntimeEngineIdentity("runtime-1", "instance-1"), lambda _: True)
    adapter = build_codex_adapter(tmp_path, engine, environ={
        "DRSAI_CODEX_DEVELOPMENT": "1", "CODEX_BIN": sys.executable,
    })
    health = await adapter.health()
    assert health["backend_id"] == "codex"
    assert health["available"] is True
    assert health["reason"] == "ready_not_started"
    assert health["release_safe"] is False
    assert health["start_count"] == 0
    await adapter.close()


@pytest.mark.anyio
async def test_factory_product_mode_reports_missing_managed_artifact(tmp_path: Path):
    engine = RuntimeEngine(tmp_path / "engine.sqlite3", RuntimeEngineIdentity("runtime-1", "instance-1"), lambda _: True)
    adapter = build_codex_adapter(tmp_path, engine, environ={"CODEX_BIN": sys.executable})
    health = await adapter.health()
    assert health["available"] is False
    assert health["reason"] == "codex_artifact_not_installed"
    assert health["start_count"] == 0
    await adapter.close()
