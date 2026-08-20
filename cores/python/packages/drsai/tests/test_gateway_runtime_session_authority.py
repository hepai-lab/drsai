from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest
from fastapi import HTTPException


def test_desktop_catalog_cannot_create_runtime_sessions(tmp_path: Path, monkeypatch) -> None:
    home = tmp_path / "home"
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    desktop = home / "desktop"
    desktop.mkdir(parents=True)
    phantom_id = "thread-desktop-phantom"
    (desktop / "threads.json").write_text(json.dumps([{
        "id": phantom_id,
        "kind": "chat",
        "title": "Desktop-only presentation row",
        "workspacePath": str(workspace),
        "createdAt": "2026-07-01T00:00:00Z",
        "updatedAt": "2026-07-02T00:00:00Z",
    }]), encoding="utf-8")
    monkeypatch.setenv("DRSAI_HOME", str(home))

    from drsai.backend import gateway

    gateway._runtime_registry_instance = None
    gateway._runtime_engine_instance = None
    opened = gateway._runtime_registry().open_workspace(str(workspace))
    authoritative = gateway._runtime_engine().create_session(
        opened.workspace_id,
        "Authoritative Runtime session",
        agent_definition="opendrsai@1",
        backend_id="opendrsai",
    )

    listed = asyncio.run(gateway.runtime_session_list(opened.workspace_id, 0, 50, False))

    assert listed["total"] == 1
    assert [item["session_id"] for item in listed["data"]] == [authoritative["session_id"]]
    with pytest.raises(HTTPException) as missing:
        asyncio.run(gateway.runtime_session_get(phantom_id))
    assert missing.value.status_code == 404

