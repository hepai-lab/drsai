from __future__ import annotations

import json
import time
from pathlib import Path

from drsai.modules.agents.skills_agent.managers.get_managers_tools import get_regression_read_tools
from drsai.modules.agents.skills_agent.managers.regression_manager import RegressionManager


def test_regression_read_tool_contract_is_narrow_and_complete() -> None:
    tools = get_regression_read_tools(strict=True)
    names = [tool["name"] if isinstance(tool, dict) else tool.name for tool in tools]
    assert names == [
        "regression_list_suites",
        "regression_list_cases",
        "regression_get_case",
        "regression_preflight",
        "regression_start",
        "regression_history",
        "regression_get",
        "regression_events",
        "regression_cancel",
    ]


def test_regression_manager_reads_dynamic_suite_and_case(tmp_path: Path, monkeypatch) -> None:
    root = Path(__file__).resolve().parents[5] / "eval" / "regression"
    monkeypatch.setenv("OPENDRSAI_REGRESSION_ROOT", str(root))
    manager = RegressionManager(tmp_path)

    suites = json.loads(manager.execute("regression_list_suites", {}))
    cases = json.loads(manager.execute("regression_list_cases", {"suite_id": "p3-desktop"}))
    detail = json.loads(manager.execute("regression_get_case", {"case_id": "qa.greeting.hello"}))

    assert any(item["id"] == "p3-desktop" for item in suites["suites"])
    assert len(cases["cases"]) == 12
    assert cases["cases"][0]["id"] == "qa.greeting.hello"
    assert detail["id"] == "qa.greeting.hello"
    assert "expectation_summary" in detail


def test_regression_manager_uses_application_data_not_the_user_workspace(tmp_path: Path, monkeypatch) -> None:
    home = tmp_path / "home"
    workspace = tmp_path / "workspace" / "profile-1"
    monkeypatch.setenv("DRSAI_HOME", str(home))
    manager = RegressionManager(workspace)
    assert manager.storage_dir == home / "regression" / "agent-p4" / "profile-1"
    assert not (workspace / "regression").exists()


def test_regression_manager_resolves_current_runtime_workspace_per_call(tmp_path: Path, monkeypatch) -> None:
    root = Path(__file__).resolve().parents[5] / "eval" / "regression"
    monkeypatch.setenv("OPENDRSAI_REGRESSION_ROOT", str(root))
    first = tmp_path / "workspace-a"
    second = tmp_path / "workspace-b"
    current = [first]
    manager = RegressionManager(tmp_path / "profile", workspace_resolver=lambda: current[0])

    _, first_service = manager._services()
    current[0] = second
    _, second_service = manager._services()

    assert first_service.workspace_path == first.resolve()
    assert second_service.workspace_path == second.resolve()


def test_regression_manager_uses_explicitly_marked_last_known_good_catalog(tmp_path: Path) -> None:
    manager = RegressionManager(tmp_path)
    fresh = manager._catalog_call("suites", lambda: {"schema_version": "test", "suites": [{"id": "p3"}]})
    assert fresh["catalog_stale"] is False

    def invalid_catalog() -> dict:
        raise ValueError("invalid yaml")

    stale = manager._catalog_call("suites", invalid_catalog)
    assert stale["suites"] == [{"id": "p3"}]
    assert stale["catalog_stale"] is True
    assert stale["catalog_warning"] == "regression_catalog_invalid:ValueError"


def test_regression_events_use_monotonic_cursor(tmp_path: Path, monkeypatch) -> None:
    root = Path(__file__).resolve().parents[5] / "eval" / "regression"
    monkeypatch.setenv("OPENDRSAI_REGRESSION_ROOT", str(root))
    manager = RegressionManager(tmp_path)
    cases = json.loads(manager.execute("regression_list_cases", {"suite_id": "p3-desktop"}))
    case = cases["cases"][0]
    monkeypatch.setenv("OPENDRSAI_REGRESSION_ALLOW_FIXTURE", "1")
    _, service = manager._services()
    preflight = service.preflight("p3-desktop", [case["id"]])
    evaluation = service.start("p3-desktop", [case["id"]], preflight["catalog_revision"], preflight["confirmation_token"])
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline and service.get(evaluation["evaluation_id"])["status"] not in {"passed", "failed", "blocked", "cancelled"}:
        time.sleep(0.05)

    first = json.loads(manager.execute("regression_events", {"evaluation_id": evaluation["evaluation_id"]}))
    second = json.loads(manager.execute("regression_events", {"evaluation_id": evaluation["evaluation_id"], "after_cursor": first["next_cursor"]}))
    terminal = json.loads(manager.execute("regression_get", {"evaluation_id": evaluation["evaluation_id"]}))
    assert first["next_cursor"] >= 1
    assert first["events"][0]["type"] == "evaluation_started"
    assert second == {"events": [], "next_cursor": first["next_cursor"]}
    assert terminal["agent_reporting"]["required"] is True
    assert terminal["agent_reporting"]["references"] == terminal["result"]["references"]
