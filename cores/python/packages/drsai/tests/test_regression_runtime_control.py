from __future__ import annotations

import json
from pathlib import Path

import pytest

from drsai.backend.runtime.agent import RuntimeExecutionError, RuntimeRunContext, RuntimeToolDispatcher
from drsai.backend import gateway


class State:
    def __init__(self): self.events = []
    def append_event(self, run_id, event_type, data):
        event = {"event_id": f"event-{len(self.events) + 1}", "run_id": run_id, "type": event_type, "data": data}
        self.events.append(event)
        return event


def context(tmp_path: Path, control: dict) -> RuntimeRunContext:
    return RuntimeRunContext(
        runtime_id="runtime", instance_id="instance", workspace_id="workspace", workspace_path=tmp_path,
        session_id="session", run_id="run", agent_definition_id="agent", agent_definition_version="1",
        permissions=frozenset({"tool:web_search", "tool:image_generation", "process:python"}),
        input_resources=({"kind": "selection", "name": "OpenDrSai regression control", "content": json.dumps(control)},),
    )


def test_regression_tool_fixture_runs_at_formal_dispatch_and_preserves_retry_attempts(tmp_path: Path) -> None:
    state = State()
    value = RuntimeToolDispatcher(state).dispatch(context(tmp_path, {
        "schema_version": "opendrsai.regression-control/1", "network": "disabled",
        "tool_faults": [{"tool": "web_search", "fail_invocations": [1], "error": {"code": "service_unavailable", "retryable": True}}],
        "tool_fixtures": {"web_search": {"successful_result": {"status": "success", "results": [{"title": "fixture"}]}}},
    }), "tool", "web_search", {"query": "OpenDrSai"})
    assert value["status"] == "success"
    assert value["attempts"] == [
        {"tool": "web_search", "status": "failed", "error_code": "service_unavailable", "retryable": True},
        {"tool": "web_search", "status": "completed"},
    ]
    assert [event["type"] for event in state.events] == ["tool.started", "tool.failed", "tool.completed"]


def test_regression_network_and_forbidden_capabilities_fail_closed(tmp_path: Path) -> None:
    dispatcher = RuntimeToolDispatcher(State(), tools={"web_search": lambda *_: {"unexpected": True}})
    with pytest.raises(RuntimeExecutionError, match="disables network"):
        dispatcher.dispatch(context(tmp_path, {"schema_version": "opendrsai.regression-control/1", "network": "disabled", "tool_fixtures": {}}), "tool", "web_search", {})
    with pytest.raises(RuntimeExecutionError, match="forbids image_generation"):
        dispatcher.dispatch(context(tmp_path, {"schema_version": "opendrsai.regression-control/1", "network": "enabled", "forbidden_capabilities": ["image_generation"], "tool_fixtures": {}}), "tool", "image_generation", {})


def test_disabled_network_process_requires_exact_declared_command(tmp_path: Path) -> None:
    dispatcher = RuntimeToolDispatcher(State())
    control = {
        "schema_version": "opendrsai.regression-control/1", "network": "disabled",
        "allowed_commands": [{"executable": "python", "args": ["-B", "-m", "pytest", "tests/test_runtime_metrics.py"]}],
    }
    with pytest.raises(RuntimeExecutionError, match="did not allow this exact process command"):
        dispatcher.dispatch(context(tmp_path, control), "process", "python", {"command": ["python", "-c", "import urllib.request"]})

    # The exact allowlisted command reaches the real process path; a missing
    # cwd then proves the regression guard allowed it without executing a
    # different command.
    with pytest.raises(RuntimeExecutionError, match="failed"):
        dispatcher.dispatch(
            context(tmp_path, control), "process", "python",
            {"command": ["python", "-B", "-m", "pytest", "tests/test_runtime_metrics.py"], "cwd": "missing"},
        )


def test_phase3_acceptance_workspace_change_is_gated_and_changes_only_candidate(monkeypatch, tmp_path: Path) -> None:
    (tmp_path / "README.md").write_text("baseline\n", encoding="utf-8")
    (tmp_path / "p3-delete-me.txt").write_text("delete\n", encoding="utf-8")
    run_context = context(tmp_path, {"schema_version": "opendrsai.regression-control/1"})
    monkeypatch.delenv("DRSAI_RUNTIME_PHASE3_ACCEPTANCE", raising=False)
    with pytest.raises(RuntimeExecutionError, match="disabled"):
        gateway._phase3_acceptance_workspace_change(run_context, {})
    monkeypatch.setenv("DRSAI_RUNTIME_PHASE3_ACCEPTANCE", "1")
    result = gateway._phase3_acceptance_workspace_change(run_context, {})
    assert result["changed_paths"] == ["README.md", "p3-created.txt", "p3-delete-me.txt"]
    assert (tmp_path / "README.md").read_text(encoding="utf-8").endswith("phase3 candidate change\n")
    assert (tmp_path / "p3-created.txt").is_file()
    assert not (tmp_path / "p3-delete-me.txt").exists()
