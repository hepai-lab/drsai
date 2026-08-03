from __future__ import annotations

import json
from pathlib import Path
import inspect
import pytest

from jsonschema import Draft202012Validator

from drsai.backend.runtime.agent import AgentExecutionServices, RuntimeRunContext, RuntimeToolDispatcher
from drsai.backend.codex_adapter.event_mapper import CodexEventMapper
from drsai.backend.runtime.engine import RuntimeEngine, RuntimeEngineIdentity
from drsai.backend.runtime.registry import RuntimeRegistry
from drsai.backend.runtime.normalized_events import (
    BackendBinding,
    NormalizedAgentEvent,
    NormalizedDeltaKind,
    NormalizedEventKind,
    NormalizedItemType,
)


ROOT = Path(__file__).resolve().parents[5]
OAEP_SCHEMA = ROOT / "cores/protocol/oaep/oaep.schema.json"


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
        {"method": "item/commandExecution/outputDelta", "params": {"threadId": "thread-1", "turnId": "turn-1",
                                                                   "itemId": "command-1", "delta": "clean\n",
                                                                   "stream": "stdout"}},
        {"method": "item/completed", "params": {"threadId": "thread-1", "turnId": "turn-1",
                                                      "item": {"id": "command-1", "type": "commandExecution", "exitCode": 0}}},
        {"method": "item/reasoning/textDelta", "params": {"threadId": "thread-1", "turnId": "turn-1",
                                                          "itemId": "reasoning-1", "delta": "thinking"}},
        {"method": "item/plan/delta", "params": {"threadId": "thread-1", "turnId": "turn-1",
                                                    "itemId": "plan-1", "delta": "inspect"}},
        {"method": "item/completed", "params": {"threadId": "thread-1", "turnId": "turn-1",
                                                   "item": {"id": "plan-1", "type": "plan", "text": "inspect"}}},
        {"method": "item/completed", "params": {"threadId": "thread-1", "turnId": "turn-1",
                                                   "item": {"id": "subtask-1", "type": "collabToolCall",
                                                            "tool": "spawn", "newThreadId": "child-1"}}},
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
    assert len(mapped) == len(messages) - 1
    assert [event["sequence"] for event in events] == list(range(1, len(events) + 1))
    assert {event["type"] for event in mapped} >= {
        "agent.item.command", "agent.item.command.delta", "agent.item.reasoning.delta",
        "agent.item.plan", "agent.item.plan.delta", "agent.item.subtask",
        "agent.item.file_change", "agent.item.tool", "agent.item.unknown"
    }
    serialized = str(mapped)
    assert "SECRET-CANARY" not in serialized and "[REDACTED]" in serialized
    oaep_items = {
        item["id"]: item for item in engine.oaep_snapshot(context.session_id)["items"]
    }
    command = oaep_items[f"codex:{context.run_id}:command-1"]
    assert command["type"] == "command_execution"
    assert command["source"]["backend"] == "codex"
    assert command["source"]["adapter"] == "codex-adapter"
    assert command["source"]["mapping_version"] == "oaep-codex/2.0"
    assert command["content"]["display_command"] == "git status"
    assert command["content"]["output"] == "clean\n"
    assert command["content"]["exit_code"] == 0
    file_change = oaep_items[f"codex:{context.run_id}:file-1"]
    assert file_change["type"] == "file_change"
    assert file_change["content"]["changes"] == [{"path": "a.txt", "operation": "modify"}]
    reasoning = oaep_items[f"codex:{context.run_id}:reasoning-1"]
    assert reasoning["type"] == "reasoning"
    assert reasoning["content"]["segments"][0]["text"] == "thinking"
    plan = oaep_items[f"codex:{context.run_id}:plan-1"]
    assert plan["type"] == "plan" and plan["content"]["text"] == "inspect"
    subtask = oaep_items[f"codex:{context.run_id}:subtask-1"]
    assert subtask["type"] == "subtask" and subtask["content"]["child_run_id"] == "child-1"
    tool = oaep_items[f"codex:{context.run_id}:tool-1"]
    assert tool["type"] == "tool_call"
    assert tool["content"]["result"] == "ok"
    unknown = oaep_items[f"codex:{context.run_id}:future-1"]
    assert unknown["type"] == "notice"
    assert unknown["content"]["code"] == "codex_item_unknown"
    assert "SECRET-CANARY" not in str(oaep_items)
    schema = json.loads(OAEP_SCHEMA.read_text(encoding="utf-8"))
    validator = Draft202012Validator({"$defs": schema["$defs"], "$ref": "#/$defs/item"})
    for item in oaep_items.values():
        validator.validate(item)
    oaep_events = engine.list_oaep_events(context.session_id)
    assert any(
        event["type"] == "event.item.completed"
        and event.get("item_id") == f"codex:{context.run_id}:command-1"
        for event in oaep_events
    )
    assert any(
        event["type"] == "event.item.delta"
        and event.get("item_id") == f"codex:{context.run_id}:command-1"
        and event["data"]["delta"] == {
            "kind": "command.output.append",
            "stream": "stdout",
            "text": "clean\n",
        }
        for event in oaep_events
    )
    assert any(
        event["type"] == "event.item.delta"
        and event.get("item_id") == f"codex:{context.run_id}:reasoning-1"
        and event["data"]["delta"] == {
            "kind": "reasoning.text.append",
            "text": "thinking",
        }
        for event in oaep_events
    )
    assert any(
        event["type"] == "event.item.completed"
        and event.get("item_id") == f"codex:{context.run_id}:file-1"
        for event in oaep_events
    )
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


def test_completed_turn_without_delta_emits_full_answer_once(tmp_path: Path):
    engine, context, services = _fixture(tmp_path)
    mapper = CodexEventMapper()
    completed = {
        "method": "turn/completed",
        "params": {"threadId": "thread-1", "turn": {
            "id": "turn-1", "status": "completed",
            "items": [{"id": "answer-1", "type": "agentMessage", "text": "Full terminal answer"}],
        }},
    }
    mapper.handle(context, services, completed)
    mapper.handle(context, services, completed)
    items = engine.oaep_snapshot(context.session_id)["items"]
    answers = [item for item in items if item["type"] == "message" and item["content"].get("text") == "Full terminal answer"]
    assert len(answers) == 1


def test_codex_mapper_has_no_legacy_agent_event_write_path() -> None:
    source = inspect.getsource(CodexEventMapper)
    assert ".emit_backend(" not in source
    assert "method != \"turn/completed\"" not in source
    writer = inspect.getsource(RuntimeEngine.append_normalized_event)
    assert "append_backend_event(" not in writer
    assert "normalized_canonical_item" in writer
    assert "upsert_item_in_transaction" in writer


def test_normalized_write_rolls_back_item_binding_event_and_snapshot_together(tmp_path: Path) -> None:
    engine, context, services = _fixture(tmp_path)
    before_events = engine.list_events(context.run_id)
    with pytest.raises(ValueError, match="resource_ref belongs to another Workspace"):
        services.emit_normalized(context, NormalizedAgentEvent(
            kind=NormalizedEventKind.ITEM_COMPLETED,
            backend="codex",
            binding=BackendBinding("thread-1", "turn-1", "artifact-invalid"),
            item_type=NormalizedItemType.ARTIFACT,
            dedupe_key="codex:invalid-resource-ref",
            payload={
                "artifact_id": "artifact-invalid",
                "artifact_type": "file",
                "name": "invalid",
                "resource_refs": [{
                    "protocol": "owop/1",
                    "workspace_id": "different-workspace",
                    "resource_type": "artifact",
                    "resource_id": "artifact-invalid",
                }],
            },
        ))
    assert engine.list_events(context.run_id) == before_events
    assert engine.get_backend_item_bindings(context.run_id) == []
    assert all(item["id"] != f"codex:{context.run_id}:artifact-invalid"
               for item in engine.oaep_snapshot(context.session_id)["items"])


def test_normalized_session_lifecycle_and_extended_deltas(tmp_path: Path) -> None:
    engine, context, services = _fixture(tmp_path)
    mapper = CodexEventMapper()
    before_archive = len(engine.list_oaep_events(context.session_id))
    mapper.handle(context, services, {
        "method": "thread/archived", "params": {"threadId": "thread-1"},
    })
    assert engine.get_session(context.session_id)["lifecycle"] == "archived"
    archive_events = engine.list_oaep_events(context.session_id)[before_archive:]
    assert [event["type"] for event in archive_events] == ["event.session.archived"]
    before_unarchive = len(engine.list_oaep_events(context.session_id))
    mapper.handle(context, services, {
        "method": "thread/unarchived", "params": {"threadId": "thread-1"},
    })
    assert engine.get_session(context.session_id)["lifecycle"] == "active"
    unarchive_events = engine.list_oaep_events(context.session_id)[before_unarchive:]
    assert [event["type"] for event in unarchive_events] == ["event.session.updated"]

    for item_id, item_type, delta_kind, text in (
        ("plan-delta", NormalizedItemType.PLAN, NormalizedDeltaKind.PLAN_TEXT_APPEND, "plan step"),
        ("tool-delta", NormalizedItemType.TOOL_CALL, NormalizedDeltaKind.TOOL_OUTPUT_APPEND, "result"),
        ("subtask-delta", NormalizedItemType.SUBTASK, NormalizedDeltaKind.SUBTASK_SUMMARY_APPEND, "summary"),
    ):
        services.emit_normalized(context, NormalizedAgentEvent(
            kind=NormalizedEventKind.ITEM_DELTA,
            backend="codex",
            binding=BackendBinding("thread-1", "turn-1", item_id),
            item_type=item_type,
            delta_kind=delta_kind,
            dedupe_key=f"codex:turn-1:{item_id}:1",
            payload={"text": text, "ordinal": 1},
        ))
    items = {item["id"]: item for item in engine.oaep_snapshot(context.session_id)["items"]}
    assert items[f"codex:{context.run_id}:plan-delta"]["content"]["text"] == "plan step"
    assert items[f"codex:{context.run_id}:tool-delta"]["content"]["result"] == "result"
    assert items[f"codex:{context.run_id}:subtask-delta"]["content"]["summary"] == "summary"


def test_real_hello_fixture_has_one_user_one_final_and_canonical_order(tmp_path: Path) -> None:
    engine, context, services = _fixture(tmp_path)
    engine.set_run_input(
        context.run_id,
        "hello",
        source_client="windows",
        source_message_id="desktop:hello-1",
    )
    mapper = CodexEventMapper(batch_bytes=4096, max_wait_ms=40)
    messages = [
        {"method": "item/started", "params": {
            "threadId": "thread-1", "turnId": "turn-1",
            "item": {"id": "user-echo", "type": "userMessage", "content": [
                {"type": "text", "text": "hello", "text_elements": []},
            ]},
        }},
        {"method": "item/completed", "params": {
            "threadId": "thread-1", "turnId": "turn-1",
            "item": {"id": "user-echo", "type": "userMessage", "content": [
                {"type": "text", "text": "hello", "text_elements": []},
            ]},
        }},
        {"method": "item/started", "params": {
            "threadId": "thread-1", "turnId": "turn-1",
            "item": {"id": "answer-1", "type": "agentMessage", "phase": "final"},
        }},
        {"method": "item/agentMessage/delta", "params": {
            "threadId": "thread-1", "turnId": "turn-1", "itemId": "answer-1", "delta": "Hello.",
        }},
        {"method": "item/completed", "params": {
            "threadId": "thread-1", "turnId": "turn-1",
            "item": {"id": "answer-1", "type": "agentMessage", "phase": "final", "text": "Hello."},
        }},
        {"method": "turn/completed", "params": {
            "threadId": "thread-1", "turn": {"id": "turn-1", "status": "completed"},
        }},
    ]
    for message in messages:
        mapper.handle(context, services, message)

    snapshot = engine.oaep_snapshot(context.session_id)
    user_items = [item for item in snapshot["items"] if item["type"] == "message" and item["content"]["role"] == "user"]
    assistant_items = [item for item in snapshot["items"] if item["type"] == "message" and item["content"]["role"] == "assistant"]
    assert len(user_items) == 1
    assert user_items[0]["id"] == f"user:{context.run_id}"
    assert user_items[0]["content"]["text"] == "hello"
    assert len(assistant_items) == 1
    assert assistant_items[0]["id"] == f"codex:{context.run_id}:answer-1"
    assert assistant_items[0]["content"]["text"] == "Hello."
    assert assistant_items[0]["content"]["phase"] == "final"
    serialized = json.dumps(snapshot, ensure_ascii=False)
    assert "Hello.Hello." not in serialized
    assert "[{'text':" not in serialized

    item_events = [
        event for event in engine.list_oaep_events(context.session_id)
        if event.get("item_id") == f"codex:{context.run_id}:answer-1"
    ]
    assert [event["type"] for event in item_events] == [
        "event.item.started", "event.item.delta", "event.item.completed",
    ]
    assert not any(
        event["type"] == "event.run.resumed" and event.get("run_id") == context.run_id
        for event in engine.list_oaep_events(context.session_id)
    )
    bindings = engine.get_backend_item_bindings(context.run_id)
    assert len(bindings) == 1
    assert bindings[0]["backend_item_id"] == "answer-1"
    assert bindings[0]["runtime_item_id"] == f"codex:{context.run_id}:answer-1"
    restarted = RuntimeEngine(engine.database, engine.identity, engine.workspace_exists)
    assert restarted.get_backend_item_bindings(context.run_id) == bindings


def test_short_delta_flushes_on_max_wait_without_waiting_for_terminal(tmp_path: Path) -> None:
    engine, context, services = _fixture(tmp_path)
    now = [100.0]
    mapper = CodexEventMapper(batch_bytes=4096, max_wait_ms=40, clock=lambda: now[0])
    mapper.handle(context, services, {
        "method": "item/agentMessage/delta",
        "params": {"threadId": "thread-1", "turnId": "turn-1", "itemId": "answer-1", "delta": "H"},
    })
    assert not any(event["type"] == "agent.message.delta" for event in engine.list_events(context.run_id))
    now[0] += 0.041
    mapper.flush_due(context, services)
    deltas = [event for event in engine.list_events(context.run_id) if event["type"] == "agent.message.delta"]
    assert len(deltas) == 1
    assert deltas[0]["data"]["content"] == "H"
    diagnostics = mapper.diagnostics_snapshot()
    assert diagnostics["received_notifications"] == 1
    assert diagnostics["emitted_normalized_events"] == 1
    assert diagnostics["delta_flushes"] == 1
    assert diagnostics["delta_flush_delay_ms"]["maximum"] >= 40
    assert diagnostics["event_coverage"] == {"item.delta": 1}
    assert diagnostics["mapping_errors"] == {}
    assert diagnostics["content_redacted"] is True
