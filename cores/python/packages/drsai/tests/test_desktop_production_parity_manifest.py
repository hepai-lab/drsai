from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from drsai.backend.runtime.agent_kernel import (
    CAPABILITY_CLASSIFICATIONS,
    desktop_production_parity_manifest,
)
from drsai.modules.agents.skills_agent.drsai_assistant import DrSaiAssistant


class _Model:
    _model_info = {"function_calling": True, "vision": True, "structured_output": False}


class _Context:
    pass


def _agent(tmp_path: Path, *, extra_tool: str | None = None) -> SimpleNamespace:
    tools = [SimpleNamespace(name="run_read"), SimpleNamespace(name="run_bash")]
    if extra_tool:
        tools.append(SimpleNamespace(name=extra_tool))
    return SimpleNamespace(
        _developer_system_message="secret prompt body that must never be exported",
        _model_client=_Model(),
        _model_context=_Context(),
        _tools=tools,
        _workbench=SimpleNamespace(_tools=list(tools)),
        _handoff_tools=[],
        _update_user_config_tools=[SimpleNamespace(name="UpdateUserConfig")],
        _agent_skills_tools=[SimpleNamespace(name="Skill")],
        _subagent_tools=[SimpleNamespace(name="Delegate")],
        _todo_tools=[SimpleNamespace(name="TodoWrite")],
        _scheduled_task_tools=[],
        _skills_dir=[str(tmp_path / "private-skills" / "analysis")],
        _user_sub_agents={"explore": {}, "general": {}},
    )


def test_manifest_enumerates_constructed_agent_and_is_secret_free(tmp_path: Path) -> None:
    manifest = desktop_production_parity_manifest(_agent(tmp_path))

    assert manifest == desktop_production_parity_manifest(_agent(tmp_path))
    assert manifest["schema_version"] == 1
    assert manifest["manifest_version"] == "p9-production-parity-v1"
    assert len(manifest["sha256"]) == 64
    assert manifest["inventory"]["prompt"]["count"] == 1
    assert manifest["inventory"]["tools"]["count"] == 6
    assert manifest["inventory"]["skills"]["count"] == 1
    assert manifest["inventory"]["subagents"]["count"] == 2
    domains = {item["domain"] for item in manifest["capabilities"]}
    assert domains >= {"prompt", "context", "tool-policy", "model", "memory", "skill", "subagent", "tool"}
    assert all(set(item["classification"]) == {"desktop", "android"} for item in manifest["capabilities"])
    assert all(
        value in CAPABILITY_CLASSIFICATIONS
        for item in manifest["capabilities"]
        for value in item["classification"].values()
    )
    tools = {item.get("tool_name"): item for item in manifest["capabilities"] if item["domain"] == "tool"}
    assert tools["run_read"]["classification"]["android"] == "local-equivalent"
    assert tools["run_bash"]["classification"]["android"] == "remote-required"
    encoded = json.dumps(manifest, ensure_ascii=False)
    assert "secret prompt body" not in encoded
    assert str(tmp_path) not in encoded


def test_manifest_digest_changes_when_production_inventory_changes(tmp_path: Path) -> None:
    baseline = desktop_production_parity_manifest(_agent(tmp_path))
    changed = desktop_production_parity_manifest(_agent(tmp_path, extra_tool="mcp_external_write"))

    assert baseline["sha256"] != changed["sha256"]
    external = next(item for item in changed["capabilities"] if item.get("tool_name") == "mcp_external_write")
    assert external["classification"] == {"desktop": "local-equivalent", "android": "unsupported"}


def test_manifest_rejects_normalized_capability_id_collisions(tmp_path: Path) -> None:
    agent = _agent(tmp_path)
    agent._tools.extend([SimpleNamespace(name="same-tool"), SimpleNamespace(name="same_tool")])

    with pytest.raises(ValueError, match="production_parity_capability_duplicate"):
        desktop_production_parity_manifest(agent)


def test_production_agent_live_export_refreshes_after_tool_reload(tmp_path: Path) -> None:
    source = _agent(tmp_path)
    agent = DrSaiAssistant.__new__(DrSaiAssistant)
    agent.__dict__.update(source.__dict__)
    initial = agent.export_production_parity_manifest()
    agent._workbench._tools.append(SimpleNamespace(name="mcp_after_lazy_reload"))
    refreshed = agent.export_production_parity_manifest()

    assert initial["sha256"] != refreshed["sha256"]
    assert refreshed == agent._production_parity_manifest
    assert any(item.get("tool_name") == "mcp_after_lazy_reload" for item in refreshed["capabilities"])
