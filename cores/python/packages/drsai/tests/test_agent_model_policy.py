from __future__ import annotations

import json
import tomllib

import pytest

from drsai.config.agent_model_policy import (
    AgentKnowledgePolicy,
    AgentModelPolicyConflict,
    AgentRuntimePolicySnapshot,
    AgentSkillPolicy,
    AgentToolPolicy,
    agent_model_policy_path,
    commit_agent_model_policy,
    commit_agent_runtime_policy,
    current_agent_name,
    list_agent_names,
    load_agent_model_policy,
    load_agent_runtime_policy,
)
from drsai.config.loader import load_user_config
from drsai.config.model_catalog import AgentModelPolicy, AgentModelSelection, ModelRef


def test_missing_agent_config_has_unbound_policy(tmp_path) -> None:
    snapshot = load_agent_model_policy("opendrsai", path=tmp_path / "agent_opendrsai.toml")
    assert snapshot.policy.primary_model.mode == "inherit_provider_default"
    assert snapshot.revision.startswith("sha256:")


def test_agent_toml_persists_all_provider_aware_roles(tmp_path) -> None:
    path = tmp_path / "agent_opendrsai.toml"
    initial = load_agent_model_policy("opendrsai", path=path)
    policy = AgentModelPolicy(
        agent_id="opendrsai",
        primary_model=AgentModelSelection("explicit", ModelRef("provider-a", "chat")),
        image_understanding_model=AgentModelSelection("explicit", ModelRef("provider-a", "vision")),
        image_generation_model=AgentModelSelection("explicit", ModelRef("provider-b", "image")),
        text_to_speech_model=AgentModelSelection("explicit", ModelRef("provider-b", "tts")),
        realtime_voice_model=AgentModelSelection("explicit", ModelRef("provider-b", "gpt-realtime-2")),
        speech_to_text_model=AgentModelSelection("explicit", ModelRef("provider-b", "stt")),
        reasoning_effort="max",
    )
    committed = commit_agent_model_policy(policy, expected_revision=initial.revision, path=path)
    loaded = load_agent_model_policy("opendrsai", path=path)
    document = tomllib.loads(path.read_text(encoding="utf-8"))

    assert loaded == committed
    assert document["agent_name"] == "opendrsai"
    assert document["display_name"] == "OpenDrSai"
    assert document["models"]["primary"] == {
        "mode": "explicit", "provider_id": "provider-a", "model_id": "chat",
    }
    assert document["models"]["image_generation"]["model_id"] == "image"
    assert document["models"]["realtime_voice"]["model_id"] == "gpt-realtime-2"
    assert document["models"]["reasoning_effort"] == "max"
    assert document["schema_version"] == 2
    assert document["tools"]["mode"] == "inherit"


def test_agent_runtime_policy_round_trips_without_losing_models(tmp_path) -> None:
    path = tmp_path / "agent_opendrsai.toml"
    model_initial = load_agent_model_policy("opendrsai", path=path)
    commit_agent_model_policy(
        AgentModelPolicy("opendrsai", AgentModelSelection("explicit", ModelRef("p", "chat"))),
        expected_revision=model_initial.revision,
        path=path,
    )
    initial = load_agent_runtime_policy("opendrsai", path=path)
    committed = commit_agent_runtime_policy(
        AgentRuntimePolicySnapshot(
            agent_id="opendrsai",
            tools=AgentToolPolicy("explicit", ("web.search",), ("builtin.shell",), ("web.search",)),
            skills=AgentSkillPolicy("explicit", ("research",), (), False),
            knowledge=AgentKnowledgePolicy("explicit", ("product-docs",), "always", 8, 0.5, True),
            revision=initial.revision,
        ),
        expected_revision=initial.revision,
        path=path,
    )
    loaded = load_agent_runtime_policy("opendrsai", path=path)
    document = tomllib.loads(path.read_text(encoding="utf-8"))

    assert loaded == committed
    assert loaded.tools.enabled == ("web.search",)
    assert loaded.skills.allow_thread_override is False
    assert loaded.knowledge.top_k == 8
    assert document["models"]["primary"]["model_id"] == "chat"


def test_model_update_preserves_agent_runtime_policy(tmp_path) -> None:
    path = tmp_path / "agent_opendrsai.toml"
    initial = load_agent_runtime_policy("opendrsai", path=path)
    runtime = commit_agent_runtime_policy(
        AgentRuntimePolicySnapshot(
            "opendrsai",
            AgentToolPolicy("explicit", ("web.search",)),
            AgentSkillPolicy("explicit", ("research",)),
            AgentKnowledgePolicy("explicit", ("docs",)),
            initial.revision,
        ),
        expected_revision=initial.revision,
        path=path,
    )
    commit_agent_model_policy(
        AgentModelPolicy("opendrsai", AgentModelSelection("explicit", ModelRef("p", "next"))),
        expected_revision=runtime.revision,
        path=path,
    )
    loaded = load_agent_runtime_policy("opendrsai", path=path)
    assert loaded.tools.enabled == ("web.search",)
    assert loaded.skills.enabled == ("research",)
    assert loaded.knowledge.sources == ("docs",)


def test_agent_runtime_policy_rejects_invalid_values(tmp_path) -> None:
    path = tmp_path / "agent_opendrsai.toml"
    path.write_text(
        'schema_version = 2\nagent_name = "opendrsai"\n[knowledge]\ntop_k = 0\n',
        encoding="utf-8",
    )
    with pytest.raises(Exception, match="top_k"):
        load_agent_runtime_policy("opendrsai", path=path)


def test_schema_one_preserves_legacy_all_installed_skills_behavior(tmp_path) -> None:
    path = tmp_path / "agent_opendrsai.toml"
    path.write_text(
        'schema_version = 1\nagent_name = "opendrsai"\n[models.primary]\nmode = "explicit"\nprovider_id = "p"\nmodel_id = "m"\n',
        encoding="utf-8",
    )
    runtime = load_agent_runtime_policy("opendrsai", path=path)
    assert runtime.skills.mode == "all_enabled"

    commit_agent_model_policy(
        load_agent_model_policy("opendrsai", path=path).policy,
        expected_revision=runtime.revision,
        path=path,
    )
    upgraded = load_agent_runtime_policy("opendrsai", path=path)
    assert upgraded.skills.mode == "all_enabled"


def test_each_agent_has_an_independent_revision(tmp_path) -> None:
    first_path = tmp_path / "agent_first.toml"
    second_path = tmp_path / "agent_second.toml"
    first_initial = load_agent_model_policy("first", path=first_path)
    second_initial = load_agent_model_policy("second", path=second_path)
    first = AgentModelPolicy("first", AgentModelSelection("explicit", ModelRef("p", "a")))
    second = AgentModelPolicy("second", AgentModelSelection("explicit", ModelRef("p", "b")))
    commit_agent_model_policy(first, expected_revision=first_initial.revision, path=first_path)
    commit_agent_model_policy(second, expected_revision=second_initial.revision, path=second_path)
    assert load_agent_model_policy("first", path=first_path).policy == first
    assert load_agent_model_policy("second", path=second_path).policy == second


def test_agent_revision_conflict_does_not_overwrite(tmp_path) -> None:
    path = tmp_path / "agent_opendrsai.toml"
    initial = load_agent_model_policy("opendrsai", path=path)
    first = AgentModelPolicy("opendrsai", AgentModelSelection("explicit", ModelRef("a", "one")))
    second = AgentModelPolicy("opendrsai", AgentModelSelection("explicit", ModelRef("b", "two")))
    commit_agent_model_policy(first, expected_revision=initial.revision, path=path)
    with pytest.raises(AgentModelPolicyConflict):
        commit_agent_model_policy(second, expected_revision=initial.revision, path=path)
    assert load_agent_model_policy("opendrsai", path=path).policy == first


def test_legacy_json_migrates_to_current_agent_toml(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("DRSAI_HOME", str(tmp_path))
    (tmp_path / "config.toml").write_text("config_version = 2\n", encoding="utf-8")
    legacy = tmp_path / "agent-model-policies.json"
    legacy.write_text(json.dumps({"schema_version": 1, "policies": {"my-drsai": {
        "primary_model": {"mode": "explicit", "ref": {"provider_id": "p", "model_id": "m"}},
        "reasoning_effort": "high",
    }}}), encoding="utf-8")

    snapshot = load_agent_model_policy("opendrsai")

    assert snapshot.policy.primary_model.ref == ModelRef("p", "m")
    assert agent_model_policy_path(agent_name="opendrsai").is_file()
    assert legacy.with_suffix(".json.migrated.bak").is_file()
    config = load_user_config()
    assert config.current_agent == "opendrsai"
    assert config.agent_config_file == "configs/agents/agent_opendrsai.toml"
    assert current_agent_name() == "opendrsai"
    assert list_agent_names() == ("opendrsai",)


def test_agent_name_rejects_path_traversal(tmp_path) -> None:
    with pytest.raises(Exception, match="Agent name is invalid"):
        load_agent_model_policy("../escape", path=tmp_path / "escape.toml")


def test_corrupted_agent_toml_fails_closed(tmp_path) -> None:
    path = tmp_path / "agent_opendrsai.toml"
    path.write_text('schema_version = 1\nagent_name = "opendrsai"\n[models.primary]\nmode = "explicit"\n', encoding="utf-8")
    with pytest.raises(Exception, match="selection is invalid"):
        load_agent_model_policy("opendrsai", path=path)
