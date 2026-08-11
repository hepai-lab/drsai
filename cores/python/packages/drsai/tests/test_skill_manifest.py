from __future__ import annotations

import pytest

from drsai.backend.runtime.agent_kernel import (
    SKILL_MANIFEST_VERSION,
    AgentRunConfig,
    build_run_capability_snapshot,
    skill_manifest_digest,
)


def tool(name: str, capability: str | None = None) -> dict:
    return {
        "name": name,
        "version": 1,
        "source": "android-host",
        "classification": "local-equivalent",
        "risk": "read_only",
        "parameters": {"type": "object", "properties": {}},
        "requires_approval": False,
        "required_capabilities": [] if capability is None else [capability],
    }


def skill(
    skill_id: str = "workspace.inspect",
    *,
    instructions: str = "Inspect before answering.",
    tools: list[str] | None = None,
    capabilities: list[str] | None = None,
) -> dict:
    allowed = ["workspace.read"] if tools is None else tools
    required = ["saf_read"] if capabilities is None else capabilities
    value = {
        "id": skill_id,
        "version": 3,
        "source": "built_in",
        "availability": "local",
        "instructions": instructions,
        "tools": allowed,
        "capabilities": required,
    }
    value["digest"] = skill_manifest_digest(skill_id, 3, "built_in", instructions, allowed, required)
    return value


def test_versioned_skill_manifest_binds_instructions_tools_capabilities_and_prompt() -> None:
    manifest = skill()
    snapshot = build_run_capability_snapshot(
        "android", [tool("workspace.read", "saf_read")], [manifest], ["saf_read"],
    )

    frozen = snapshot["skills"][0]
    assert SKILL_MANIFEST_VERSION == "p9-skill-manifest-v1"
    assert frozen["digest"] == manifest["digest"]
    assert frozen["allowed_tools"] == ["workspace.read"]
    assert frozen["required_capabilities"] == ["saf_read"]
    prompt = AgentRunConfig().authoritative_prompt([manifest])
    assert "[SKILL id=workspace.inspect v=3]" in prompt
    assert "Inspect before answering." in prompt


@pytest.mark.parametrize("missing", ["instructions", "tools", "digest"])
def test_missing_required_skill_manifest_field_fails_closed(missing: str) -> None:
    manifest = skill()
    manifest.pop(missing)
    with pytest.raises(ValueError, match=f"run_skill_{missing}"):
        build_run_capability_snapshot(
            "android", [tool("workspace.read", "saf_read")], [manifest], ["saf_read"],
        )


def test_tamper_duplicate_capability_and_allowed_tool_drift_fail_closed() -> None:
    tampered = {**skill(), "instructions": "Tampered after signing."}
    with pytest.raises(ValueError, match="run_skill_digest_mismatch"):
        build_run_capability_snapshot(
            "android", [tool("workspace.read", "saf_read")], [tampered], ["saf_read"],
        )
    duplicate = skill()
    with pytest.raises(ValueError, match="run_skill_duplicate"):
        build_run_capability_snapshot(
            "android", [tool("workspace.read", "saf_read")], [duplicate, duplicate], ["saf_read"],
        )
    with pytest.raises(ValueError, match="run_skill_capability_unavailable"):
        build_run_capability_snapshot("android", [], [skill(tools=[])], [])
    with pytest.raises(ValueError, match="run_skill_tool_unavailable"):
        build_run_capability_snapshot("android", [], [skill(capabilities=[])], [])


def test_skill_manifest_digest_is_order_independent_but_version_sensitive() -> None:
    first = skill_manifest_digest("s", 1, "built_in", "i", ["b", "a"], ["saf_write", "saf_read"])
    reordered = skill_manifest_digest("s", 1, "built_in", "i", ["a", "b"], ["saf_read", "saf_write"])
    upgraded = skill_manifest_digest("s", 2, "built_in", "i", ["a", "b"], ["saf_read", "saf_write"])
    assert first == reordered
    assert first != upgraded


def test_user_declarative_skill_is_a_local_instruction_manifest_not_dynamic_code() -> None:
    instructions = "Read only the user-authorized workspace."
    manifest = {
        "id": "user.workspace", "version": 1, "source": "user_declarative", "availability": "local",
        "instructions": instructions, "tools": ["workspace.read"], "capabilities": [],
    }
    manifest["digest"] = skill_manifest_digest(
        "user.workspace", 1, "user_declarative", instructions, ["workspace.read"], [],
    )
    snapshot = build_run_capability_snapshot(
        "android", [tool("workspace.read")], [manifest], [],
    )
    assert snapshot["skills"][0]["source"] == "user_declarative"
    assert snapshot["skills"][0]["allowed_tools"] == ["workspace.read"]
