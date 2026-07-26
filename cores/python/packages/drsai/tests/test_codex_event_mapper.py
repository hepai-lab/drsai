from __future__ import annotations

from pathlib import Path

from drsai.backend.runtime.agent import AgentExecutionServices, RuntimeRunContext, RuntimeToolDispatcher
from drsai.backend.codex_adapter.event_mapper import CodexEventMapper
from drsai.backend.runtime.engine import RuntimeEngine, RuntimeEngineIdentity
from drsai.backend.runtime.registry import RuntimeRegistry


def _fixture(tmp_path: Path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    registry = RuntimeRegistry(tmp_path / "registry.sqlite3")
    record = registry.open_workspace(str(workspace))
    engine = RuntimeEngine(
        tmp_path / "runtime.sqlite3",
        RuntimeEngineIdentity(registry.identity.runtime_id, registry.identity.instance_id),
        lambda identity: registry.get_workspace(identity) is not None,
    )
    session = engine.create_session(record.workspace_id, "events")
    run, _ = engine.create_run(session["session_id"], "codex@1", "event-run", "codex")
    engine.transition_run(run["run_id"], "running")
    context = RuntimeRunContext(
        runtime_id=registry.identity.runtime_id, instance_id=registry.identity.instance_id,
        workspace_id=record.workspace_id, workspace_path=workspace,
        session_id=session["session_id"], run_id=run["run_id"],
        agent_definition_id="codex", agent_definition_version="1",
    )
    services = AgentExecutionServices(engine, RuntimeToolDispatcher(engine), None)
    return engine, context, services


def test_codex_items_authoritative_sequence_dedupe_and_safe_unknown(tmp_path: Path):
    engine, context, services = _fixture(tmp_path)
    mapper = CodexEventMapper(batch_bytes=1024, max_buffer_bytes=4096, max_field_chars=1000)
    messages = [
        {"method": "turn/started", "params": {"threadId": "thread-1", "turn": {"id": "turn-1"}}},
        {"method": "item/started", "params": {"threadId": "thread-1", "turnId": "turn-1",
                                                    "item": {"id": "command-1", "type": "commandExecution", "command": "git status"}}},
        {"method": "item/completed", "params": {"threadId": "thread-1", "turnId": "turn-1",
                                                      "item": {"id": "command-1", "type": "commandExecution", "exitCode": 0}}},
        {"method": "item/completed", "params": {"threadId": "thread-1", "turnId": "turn-1",
                                                      "item": {"id": "file-1", "type": "fileChange", "path": "a.txt"}}},
        {"method": "item/completed", "params": {"threadId": "thread-1", "turnId": "turn-1",
                                                      "item": {"id": "tool-1", "type": "mcpToolCall", "output": "ok"}}},
        {"method": "item/completed", "params": {"threadId": "thread-1", "turnId": "turn-1",
                                                      "item": {"id": "future-1", "type": "futureItem",
                                                               "accessToken": "SECRET-CANARY", "detail": "safe"}}},
    ]
    for message in messages + messages:
        mapper.handle(context, services, message)
    events = engine.list_events(context.run_id)
    mapped = [event for event in events if event.get("backend_event_key")]
    assert len(mapped) == len(messages)
    assert [event["sequence"] for event in events] == list(range(1, len(events) + 1))
    assert {event["type"] for event in mapped} >= {
        "agent.started", "agent.item.command", "agent.item.file_change", "agent.item.tool", "agent.item.unknown"
    }
    serialized = str(mapped)
    assert "SECRET-CANARY" not in serialized and "[REDACTED]" in serialized
    restarted = RuntimeEngine(
        engine.database, engine.identity, engine.workspace_exists,
    )
    assert restarted.list_events(context.run_id) == events


def test_delta_batch_memory_cap_truncation_and_replay_dedupe(tmp_path: Path):
    engine, context, services = _fixture(tmp_path)
    message = {
        "method": "item/agentMessage/delta",
        "params": {"threadId": "thread-1", "turnId": "turn-1", "itemId": "message-1", "delta": "Z" * 10000},
    }
    mapper = CodexEventMapper(batch_bytes=1024, max_buffer_bytes=4096)
    mapper.handle(context, services, message)
    mapper.handle(context, services, {
        "method": "turn/completed", "params": {"threadId": "thread-1", "turn": {"id": "turn-1", "status": "completed"}},
    })
    deltas = [event for event in engine.list_events(context.run_id) if event["type"] == "agent.message.delta"]
    assert len(deltas) == 1
    assert deltas[0]["data"]["truncated"] is True
    assert deltas[0]["data"]["truncated_prefix_bytes"] == 5904
    assert len(deltas[0]["data"]["content"].encode()) == 4096
    assert deltas[0]["data"]["backend_metadata"]["received_bytes"] == 10000

    # A restarted mapper replaying the same notification creates the same stable key.
    replay = CodexEventMapper(batch_bytes=1024, max_buffer_bytes=4096)
    replay.handle(context, services, message)
    replay.handle(context, services, {
        "method": "turn/completed", "params": {"threadId": "thread-1", "turn": {"id": "turn-1", "status": "completed"}},
    })
    assert len([event for event in engine.list_events(context.run_id) if event["type"] == "agent.message.delta"]) == 1


def test_runtime_backend_event_store_returns_same_authoritative_event_for_duplicate_key(tmp_path: Path):
    engine, context, _ = _fixture(tmp_path)
    first = engine.append_backend_event(context.run_id, "agent.item.command", {"value": 1}, "codex:stable-key")
    duplicate = engine.append_backend_event(context.run_id, "agent.item.command", {"value": 999}, "codex:stable-key")
    assert duplicate == first
    events = engine.list_events(context.run_id)
    assert [event["sequence"] for event in events] == [1, 2, 3]
    assert events[-1]["data"] == {"value": 1}
