from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from drsai.backend.codex_adapter.event_mapper import CodexEventMapper
from drsai.backend.codex_adapter.run_finalizer import CodexRunFinalizer
from drsai.backend.runtime.agent import AgentExecutionServices, RuntimeRunContext, RuntimeToolDispatcher
from drsai.backend.runtime.engine import RuntimeEngine, RuntimeEngineIdentity
from drsai.backend.runtime.registry import RuntimeRegistry


def _runtime(tmp_path: Path, suffix: str = "one"):
    workspace = tmp_path / f"workspace-{suffix}"
    workspace.mkdir()
    registry = RuntimeRegistry(tmp_path / f"registry-{suffix}.sqlite3")
    record = registry.open_workspace(str(workspace))
    engine = RuntimeEngine(
        tmp_path / f"runtime-{suffix}.sqlite3",
        RuntimeEngineIdentity(registry.identity.runtime_id, registry.identity.instance_id),
        lambda identity: registry.get_workspace(identity) is not None,
    )
    session = engine.create_session(record.workspace_id, "finalizer")
    run, _ = engine.create_run(session["session_id"], "codex@1", f"run-{suffix}", "codex")
    engine.transition_run(run["run_id"], "running")
    context = RuntimeRunContext(
        runtime_id=registry.identity.runtime_id,
        instance_id=registry.identity.instance_id,
        workspace_id=record.workspace_id,
        workspace_path=workspace,
        session_id=session["session_id"],
        run_id=run["run_id"],
        agent_definition_id="codex",
        agent_definition_version="1",
    )
    return engine, context, AgentExecutionServices(engine, RuntimeToolDispatcher(engine), None)


class _Approval:
    def __init__(self):
        self.calls = 0

    async def cancel_run(self, _run_id: str) -> None:
        self.calls += 1


@pytest.mark.anyio
async def test_finalizer_flushes_once_cancels_tasks_and_cleans_all_mapper_state(tmp_path: Path) -> None:
    engine, context, services = _runtime(tmp_path)
    mapper = CodexEventMapper(batch_bytes=4096)
    mapper.handle(context, services, {"method": "turn/started", "params": {"threadId": "t", "turn": {"id": "r"}}})
    mapper.handle(context, services, {"method": "item/agentMessage/delta", "params": {
        "threadId": "t", "turnId": "r", "itemId": "answer", "delta": "partial",
    }})
    task = asyncio.create_task(asyncio.sleep(60))
    approval = _Approval()
    released = []
    finalizer = CodexRunFinalizer(mapper)
    first = await finalizer.finalize(
        context,
        services,
        outcome="completed",
        backend_turn_id="r",
        flush_policy="flush",
        tasks=(task,),
        unsubscribe=(lambda: released.append("route"), lambda: released.append("failure")),
        approval_bridge=approval,
        release=lambda: released.append("state"),
    )
    second = await finalizer.finalize(
        context, services, outcome="failed", backend_turn_id="r", flush_policy="discard",
    )
    assert first == second
    assert task.cancelled()
    assert approval.calls == 1
    assert released == ["route", "failure", "state"]
    assert first["active_delta_buffers"] == 0
    assert first["active_message_runs"] == 0
    assert first["decoder_state"] == {"ordinals": 0, "message_phases": 0}
    items = engine.oaep_snapshot(context.session_id)["items"]
    assert [item["content"]["text"] for item in items if item["type"] == "message"] == ["partial"]


@pytest.mark.anyio
async def test_mapping_failure_discards_untrusted_partial_content(tmp_path: Path) -> None:
    engine, context, services = _runtime(tmp_path, "discard")
    mapper = CodexEventMapper(batch_bytes=4096)
    mapper.handle(context, services, {"method": "item/agentMessage/delta", "params": {
        "threadId": "t", "turnId": "r", "itemId": "answer", "delta": "unsafe-partial",
    }})
    report = await CodexRunFinalizer(mapper).finalize(
        context,
        services,
        outcome="mapping_failed",
        backend_turn_id="r",
        flush_policy="discard",
    )
    assert report["active_delta_buffers"] == 0
    assert engine.oaep_snapshot(context.session_id)["items"] == []
    assert "unsafe-partial" not in str(report)


@pytest.mark.anyio
async def test_cleanup_error_is_bounded_and_does_not_skip_remaining_cleanup(tmp_path: Path) -> None:
    _engine, context, services = _runtime(tmp_path, "errors")
    mapper = CodexEventMapper()
    released = []

    def broken() -> None:
        raise ValueError("SECRET-CANARY")

    report = await CodexRunFinalizer(mapper).finalize(
        context,
        services,
        outcome="disconnect",
        backend_turn_id="r",
        flush_policy="flush",
        unsubscribe=(broken, lambda: released.append("continued")),
    )
    assert report["cleanup_errors"] == ("ValueError",)
    assert released == ["continued"]
    assert "SECRET-CANARY" not in str(report)


@pytest.mark.anyio
async def test_one_hundred_terminal_racers_converge_to_exactly_one_outcome(tmp_path: Path) -> None:
    _engine, context, services = _runtime(tmp_path, "terminal-race")
    mapper = CodexEventMapper()
    finalizer = CodexRunFinalizer(mapper)
    releases: list[int] = []
    reports = await asyncio.gather(*(finalizer.finalize(
        context, services,
        outcome=("completed", "failed", "cancelled", "timeout", "approval_denied")[index % 5],
        backend_turn_id="turn-race", flush_policy="discard",
        release=lambda index=index: releases.append(index),
    ) for index in range(100)))
    assert len({json.dumps(report, sort_keys=True) for report in reports}) == 1
    assert len(releases) == 1
    assert finalizer.diagnostics()["retained_reports"] == 1
