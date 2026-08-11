from __future__ import annotations

import asyncio
import json
from pathlib import Path


def test_gateway_lists_desktop_catalog_and_projects_snapshot(tmp_path: Path, monkeypatch) -> None:
    home = tmp_path / "home"
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    desktop = home / "desktop"
    desktop.mkdir(parents=True)
    thread_id = "thread-desktop-one"
    (desktop / "threads.json").write_text(json.dumps([{
        "id": thread_id,
        "kind": "chat",
        "title": "Windows 当前任务",
        "workspacePath": str(workspace),
        "boundAgentId": "my-codex",
        "createdAt": "2026-07-01T00:00:00Z",
        "updatedAt": "2026-07-02T00:00:00Z",
    }], ensure_ascii=False), encoding="utf-8")
    (desktop / "thread-snapshots.json").write_text(json.dumps({
        thread_id: {
            "threadId": thread_id,
            "title": "Windows 当前任务",
            "updatedAt": 1_774_915_200_000,
            "messageCount": 2,
            "messages": [
                {"id": "u1", "role": "user", "content": "远端问题"},
                {"id": "a1", "role": "assistant", "content": "远端回答"},
            ],
        },
    }, ensure_ascii=False), encoding="utf-8")
    monkeypatch.setenv("DRSAI_HOME", str(home))

    from drsai.backend import gateway

    gateway._runtime_registry_instance = None
    gateway._runtime_engine_instance = None
    opened = gateway._runtime_registry().open_workspace(str(workspace))
    mobile = gateway._runtime_engine().create_session(
        opened.workspace_id,
        "Android 新会话",
        agent_definition="mobile-acceptance@1",
        backend_id="opendrsai",
    )

    listed = asyncio.run(gateway.runtime_session_list(opened.workspace_id, 0, 50, False))
    conversation = asyncio.run(gateway.runtime_session_conversation(thread_id, None, 100))

    assert listed["total"] == 2
    assert {item["session_id"] for item in listed["data"]} == {
        thread_id,
        mobile["session_id"],
    }
    assert {item["title"] for item in listed["data"]} == {
        "Windows 当前任务",
        "Android 新会话",
    }
    assert [item["kind"] for item in conversation["data"]] == [
        "message.user", "message.assistant",
    ]
    assert [item["payload"]["content"] for item in conversation["data"]] == [
        "远端问题", "远端回答",
    ]
    assert [item["sequence"] for item in conversation["data"]] == [1, 2]
