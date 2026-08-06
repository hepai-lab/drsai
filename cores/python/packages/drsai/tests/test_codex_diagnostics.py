from __future__ import annotations

from pathlib import Path

from drsai.backend.codex_adapter.diagnostics import CodexDiagnosticSink
from drsai.backend.codex_adapter.event_mapper import CodexEventMapper
from drsai.backend.runtime.agent import AgentExecutionServices, RuntimeRunContext, RuntimeToolDispatcher
from drsai.backend.runtime.engine import RuntimeEngine, RuntimeEngineIdentity
from drsai.backend.runtime.registry import RuntimeRegistry


def _runtime(tmp_path: Path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    registry = RuntimeRegistry(tmp_path / "registry.sqlite3")
    record = registry.open_workspace(str(workspace))
    engine = RuntimeEngine(
        tmp_path / "runtime.sqlite3",
        RuntimeEngineIdentity(registry.identity.runtime_id, registry.identity.instance_id),
        lambda identity: registry.get_workspace(identity) is not None,
    )
    session = engine.create_session(record.workspace_id, "diagnostics")
    run, _ = engine.create_run(session["session_id"], "codex@1", "diag-run", "codex")
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


def test_diagnostic_and_unknown_storm_is_bounded_and_never_enters_oaep(tmp_path: Path) -> None:
    engine, context, services = _runtime(tmp_path)
    sink = CodexDiagnosticSink(max_methods=8, clock=lambda: 123.0)
    mapper = CodexEventMapper(diagnostic_sink=sink)
    initial = engine.oaep_snapshot(context.session_id)
    for index in range(10_000):
        mapper.handle(context, services, {
            "method": f"future/private/{index}",
            "params": {
                "token": "SECRET-CANARY",
                "message": "payload must not be retained",
                "prompt": "USER-TEXT-CANARY",
                "command": "COMMAND-CANARY --password secret",
                "path": "C:/Sensitive/PRIVATE-PATH-CANARY.txt",
            },
        })
    mapper.handle(context, services, {
        "method": "thread/tokenUsage/updated",
        "params": {"accessToken": "SECRET-CANARY", "total": 100},
    })
    current = engine.oaep_snapshot(context.session_id)
    assert current["snapshot_sequence"] == initial["snapshot_sequence"]
    assert current["items"] == initial["items"]
    report = mapper.diagnostics_snapshot()["protocol_diagnostics"]
    assert report["total"] == 10_001
    assert report["unique_methods"] <= 8
    assert report["methods"]["__overflow__"]["count"] > 9_900
    assert report["content_retained"] is False
    assert "SECRET-CANARY" not in str(report)
    assert "payload must not be retained" not in str(report)
    assert "USER-TEXT-CANARY" not in str(report)
    assert "COMMAND-CANARY" not in str(report)
    assert "PRIVATE-PATH-CANARY" not in str(report)


def test_reviewed_user_notice_is_an_oaep_notice_item(tmp_path: Path) -> None:
    engine, context, services = _runtime(tmp_path)
    mapper = CodexEventMapper()
    mapper.handle(context, services, {
        "method": "model/rerouted",
        "params": {
            "threadId": "thread-1",
            "turnId": "turn-1",
            "fromModel": "requested-model",
            "toModel": "safe-model",
            "reason": "availability",
            "token": "SECRET-CANARY",
        },
    })
    snapshot = engine.oaep_snapshot(context.session_id)
    notices = [item for item in snapshot["items"] if item["type"] == "notice"]
    assert len(notices) == 1
    assert notices[0]["content"]["code"] == "model_rerouted"
    assert notices[0]["content"]["level"] == "warning"
    assert "SECRET-CANARY" not in str(notices[0])


def test_fatal_without_turn_is_diagnostic_not_session_content(tmp_path: Path) -> None:
    engine, context, services = _runtime(tmp_path)
    mapper = CodexEventMapper()
    before = engine.oaep_snapshot(context.session_id)
    mapper.handle(context, services, {"method": "error", "params": {"message": "server failed"}})
    after = engine.oaep_snapshot(context.session_id)
    assert after == before
    report = mapper.diagnostics_snapshot()["protocol_diagnostics"]
    assert report["methods"]["error"]["classification"] == "fatal_without_turn"
