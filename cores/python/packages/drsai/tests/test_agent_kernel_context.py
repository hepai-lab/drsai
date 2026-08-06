import pytest

from drsai.backend.runtime.agent_kernel import (
    CAPABILITY_CLASSIFICATIONS,
    DEFAULT_TOOL_POLICY,
    AgentRunConfig,
    agent_kernel_identity,
    assemble_agent_context,
    build_run_capability_snapshot,
    build_execution_tool_registry,
    classify_tool_error,
    execution_tool_record,
    freeze_model_tool_snapshot,
    normalize_kernel_host_port,
    normalize_tool_loop_policy,
    normalize_tool_output,
    production_capability_manifest,
    validate_tool_call_batch,
    verify_run_capability_snapshot,
    verify_model_tool_calls,
)


def test_tool_loop_policy_is_bounded_versioned_and_deterministic() -> None:
    policy = normalize_tool_loop_policy()
    assert policy == normalize_tool_loop_policy(policy)
    assert policy["policy_version"] == "p9-tool-loop-v1"
    assert policy["max_tool_rounds"] == 24
    assert policy["max_parallel_tool_calls"] == 8
    with pytest.raises(ValueError, match="tool_loop_max_rounds_invalid"):
        normalize_tool_loop_policy({
            "schema_version": 1, "policy_version": "p9-tool-loop-v1",
            "max_tool_rounds": 25, "max_parallel_tool_calls": 1,
        })


@pytest.mark.parametrize(
    ("code", "category", "retryable"),
    [
        ("http_400", "invalid_request", False),
        ("http_401", "authorization", False),
        ("http_408", "timeout", True),
        ("http_429", "rate_limited", True),
        ("http_500", "provider_unavailable", True),
        ("http_503", "provider_unavailable", True),
        ("cancelled", "cancelled", False),
    ],
)
def test_tool_error_taxonomy_and_retry_safety(code: str, category: str, retryable: bool) -> None:
    read = classify_tool_error(code, "read_only")
    write = classify_tool_error(code, "external_write")
    assert read["category"] == category
    assert read["retryable"] is retryable
    assert read["automatic_retry"] is retryable
    assert write["automatic_retry"] is False
    assert write["actionable"]


def test_large_tool_output_requires_complete_artifact_and_returns_bounded_preview() -> None:
    large = {"text": "x" * 20_000}
    with pytest.raises(ValueError, match="tool_output_artifact_required"):
        normalize_tool_output(large)
    bounded, artifacts = normalize_tool_output(large, [{
        "artifact_id": "opaque-1", "mime_type": "text/plain", "size": 20_000, "sha256": "a" * 64,
    }])
    assert bounded["truncated"] is True
    assert len(bounded["preview"]) == 4_096
    assert bounded["artifact_ids"] == ["opaque-1"]
    assert artifacts[0]["sha256"] == "a" * 64


def test_tool_output_rejects_truncation_claim_without_artifact_and_bad_binary_metadata() -> None:
    with pytest.raises(ValueError, match="tool_output_artifact_required"):
        normalize_tool_output({"truncated": True, "preview": "partial"})
    with pytest.raises(ValueError, match="tool_output_artifact_digest_invalid"):
        normalize_tool_output({}, [{
            "artifact_id": "binary-1", "mime_type": "application/octet-stream", "size": 5, "sha256": "bad",
        }])


def test_authoritative_system_and_tool_policy_are_always_first() -> None:
    messages = assemble_agent_context(
        [{"role": "user", "content": "earlier"}],
        "What is HEPiX 2026?",
        agent={
            "schema_version": 1,
            "prompt_version": "test-v1",
            "system_prompt": "You are the production OpenDrSai agent.",
        },
    )

    assert messages[0]["role"] == "system"
    assert messages[0]["content"].startswith("[SYSTEM v=test-v1]")
    assert "production OpenDrSai" in messages[0]["content"]
    assert DEFAULT_TOOL_POLICY in messages[0]["content"]
    assert "recent or changeable information" in messages[0]["content"]
    assert messages[-1] == {"role": "user", "content": "What is HEPiX 2026?"}


def test_only_local_skill_instructions_enter_model_context() -> None:
    messages = assemble_agent_context(
        [],
        "inspect my workspace",
        skills=[
            {
                "id": "workspace.saf",
                "version": 2,
                "availability": "local",
                "instructions": "Read before writing and request approval.",
            },
            {
                "id": "desktop.shell",
                "version": 1,
                "availability": "remote-required",
                "instructions": "Run arbitrary shell commands.",
            },
        ],
    )

    prompt = messages[0]["content"]
    assert "[SKILL id=workspace.saf v=2]" in prompt
    assert "Read before writing" in prompt
    assert "desktop.shell" not in prompt
    assert "arbitrary shell" not in prompt


@pytest.mark.parametrize(
    "agent,error",
    [
        ({"schema_version": 2}, "agent_config_schema_unsupported"),
        ({"system_prompt": ""}, "agent_system_prompt_invalid"),
        ({"prompt_version": ""}, "agent_prompt_version_invalid"),
    ],
)
def test_agent_run_config_fails_closed(agent: dict, error: str) -> None:
    with pytest.raises(ValueError, match=error):
        AgentRunConfig.from_mapping(agent)


def test_context_budget_preserves_authoritative_prompt_and_current_input() -> None:
    messages = assemble_agent_context(
        [{"role": "user", "content": f"old-{index}-" + "x" * 200} for index in range(20)],
        "current",
        max_messages=5,
        max_chars=2_000,
    )

    assert len(messages) <= 5
    assert messages[0]["role"] == "system"
    assert "[TOOL_POLICY]" in messages[0]["content"]
    assert messages[-1] == {"role": "user", "content": "current"}


def test_kernel_identity_is_stable_and_contains_no_prompt_text() -> None:
    first = agent_kernel_identity()
    second = agent_kernel_identity()

    assert first == second
    assert first["kernel_id"] == "drsai-agent-kernel"
    assert first["kernel_version"] == "p9.1"
    assert first["prompt_version"] == "p9-agent-kernel-v1"
    assert len(first["base_prompt_sha256"]) == 64
    assert len(first["kernel_sha256"]) == 64
    assert first["tool_manifest_version"] == "p9-tools-v1"
    assert "OpenDrSai" not in str(first)


def test_capability_manifests_are_versioned_deterministic_and_fully_classified() -> None:
    desktop = production_capability_manifest("desktop")
    android = production_capability_manifest("android")

    assert desktop == production_capability_manifest("desktop")
    assert desktop["schema_version"] == 1
    assert desktop["manifest_version"] == "p9-capabilities-v1"
    assert desktop["tool_manifest_version"] == "p9-tools-v1"
    assert len(desktop["sha256"]) == len(android["sha256"]) == 64
    assert desktop["sha256"] != android["sha256"]
    assert {item["domain"] for item in desktop["capabilities"]} >= {
        "prompt", "context", "tool-policy", "model", "memory", "skill", "subagent", "tool", "mcp",
    }
    android_classifications = {item["classification"] for item in android["capabilities"]}
    assert android_classifications <= CAPABILITY_CLASSIFICATIONS
    assert {"shared", "local-equivalent", "remote-required"} <= android_classifications
    shell = next(item for item in android["capabilities"] if item["id"] == "tool.shell")
    assert shell["classification"] == "remote-required"
    web = next(item for item in android["capabilities"] if item["id"] == "tool.web.search")
    assert web["classification"] == "local-equivalent"


def test_kernel_digest_is_shared_while_surface_manifest_digest_is_not() -> None:
    desktop = agent_kernel_identity(surface="desktop")
    android = agent_kernel_identity(surface="android")

    assert desktop["kernel_sha256"] == android["kernel_sha256"]
    assert desktop["base_prompt_sha256"] == android["base_prompt_sha256"]
    assert desktop["tool_manifest_version"] == android["tool_manifest_version"]
    assert desktop["capability_manifest_sha256"] != android["capability_manifest_sha256"]


def test_capability_manifest_rejects_unknown_surface() -> None:
    with pytest.raises(ValueError, match="capability_manifest_surface_invalid"):
        production_capability_manifest("ios")


def _run_tool(name: str, *, version: int = 1, risk: str = "read_only", approval: bool = False) -> dict:
    return {
        "name": name, "version": version, "source": "android-host",
        "classification": "local-equivalent", "risk": risk,
        "requires_approval": approval,
        "parameters": {"type": "object", "properties": {}},
        "required_capabilities": [],
    }


def test_run_capability_snapshot_is_order_independent_and_permission_sensitive() -> None:
    clock = _run_tool("clock")
    memory = _run_tool("memory")
    first = build_run_capability_snapshot("android", [clock, memory], [], ["chat", "local_memory"])
    reordered = build_run_capability_snapshot("android", [memory, clock], [], ["local_memory", "chat"])
    reduced = build_run_capability_snapshot("android", [clock], [], ["chat"])

    assert first == reordered
    assert first["snapshot_version"] == "p9-run-capabilities-v2"
    assert len(first["sha256"]) == 64
    assert first["sha256"] != reduced["sha256"]


def test_run_capability_diagnostics_freeze_available_remote_unsupported_and_blocked() -> None:
    snapshot = build_run_capability_snapshot(
        "android", [_run_tool("clock")], [], ["chat"],
        blocked_capabilities=[{"id": "tool.workspace.write", "reason": "saf_permission_missing"}],
        remote_capabilities=["tool.shell"],
    )
    diagnostic = snapshot["diagnostics"]
    assert "tool:clock" in diagnostic["available"]
    assert "tool.shell" in diagnostic["available"]
    assert "tool.shell" not in diagnostic["remote_required"]
    assert "mcp.stdio" in diagnostic["remote_required"]
    assert "tool.web.search" in diagnostic["available"]
    assert "tool.web.fetch" in diagnostic["available"]
    assert diagnostic["blocked"] == [
        {"id": "tool.workspace.write", "reason": "saf_permission_missing"},
    ]
    changed = build_run_capability_snapshot(
        "android", [_run_tool("clock")], [], ["chat"],
        blocked_capabilities=[{"id": "model.chat", "reason": "network_unavailable"}],
    )
    assert changed["sha256"] != snapshot["sha256"]


def test_run_capability_diagnostics_reject_undeclared_remote_and_duplicate_blocked() -> None:
    with pytest.raises(ValueError, match="run_remote_capability_not_declared"):
        build_run_capability_snapshot("android", [], [], [], remote_capabilities=["tool.web.search"])
    with pytest.raises(ValueError, match="run_blocked_capability_duplicate"):
        build_run_capability_snapshot("android", [], [], [], blocked_capabilities=[
            {"id": "model.chat", "reason": "network_unavailable"},
            {"id": "model.chat", "reason": "provider_unavailable"},
        ])


@pytest.mark.parametrize(
    ("tools", "error"),
    [
        ([_run_tool("clock", version=0)], "run_tool_version_invalid:clock"),
        ([_run_tool("clock"), _run_tool("clock")], "run_tool_duplicate"),
        ([_run_tool("write", risk="sensitive", approval=False)], "run_tool_approval_policy_drift:write"),
        ([{**_run_tool("shell"), "classification": "remote-required"}], "run_tool_not_executable:shell"),
        ([_run_tool("forbidden", risk="forbidden")], "run_tool_forbidden_visible:forbidden"),
        ([{**_run_tool("workspace"), "required_capabilities": ["saf_read"]}], "run_tool_capability_unavailable:workspace"),
    ],
)
def test_run_capability_snapshot_rejects_registry_drift(tools: list[dict], error: str) -> None:
    with pytest.raises(ValueError, match=error):
        build_run_capability_snapshot("android", tools, [], [])


def test_run_capability_snapshot_tampering_fails_closed() -> None:
    tool = _run_tool("clock")
    snapshot = build_run_capability_snapshot("android", [tool], [], ["chat"])
    tampered = {**snapshot, "host_capabilities": ["chat", "shell"]}

    with pytest.raises(ValueError, match="run_capability_snapshot_mismatch"):
        verify_run_capability_snapshot(
            tampered, surface="android", tools=[tool], skills=[], host_capabilities=["chat"],
        )


def test_kernel_host_port_supports_legacy_and_versioned_negotiation() -> None:
    legacy = normalize_kernel_host_port(None, surface="android", legacy_capabilities=["chat"])
    current = normalize_kernel_host_port({
        "schema_version": 1,
        "protocol_version": "p9-host-port-v1",
        "surface": "android",
        "capabilities": [
            {"id": "chat", "version": 1, "required": True},
            {"id": "vendor_optional", "version": 7, "required": False},
        ],
    }, surface="android")

    assert legacy["protocol_version"] == "v1.5.6-legacy"
    assert current["capabilities"] == ["chat"]
    assert len(current["sha256"]) == 64


@pytest.mark.parametrize(
    ("port", "error"),
    [
        ({"schema_version": 0}, "kernel_host_port_schema_unsupported"),
        ({
            "schema_version": 1, "protocol_version": "p9-host-port-v1", "surface": "android",
            "capabilities": [{"id": "future_required", "version": 1, "required": True}],
        }, "kernel_host_capability_required_unknown:future_required"),
        ({
            "schema_version": 1, "protocol_version": "p9-host-port-v1", "surface": "android",
            "capabilities": [{"id": "chat", "version": 2, "required": False}],
        }, "kernel_host_capability_version_unsupported:chat"),
    ],
)
def test_kernel_host_port_fails_closed_for_incompatible_contracts(port: dict, error: str) -> None:
    with pytest.raises(ValueError, match=error):
        normalize_kernel_host_port(port, surface="android")


def test_model_tool_snapshot_uses_exact_schema_objects_and_rejects_phantom_calls() -> None:
    class ExecutableTool:
        schema = {
            "name": "workspace.read",
            "description": "Read",
            "parameters": {"type": "object", "properties": {"path": {"type": "string"}}},
        }

    manager = {
        "name": "TodoWrite",
        "parameters": {"type": "object", "properties": {"items": {"type": "array"}}},
    }
    snapshot = freeze_model_tool_snapshot("desktop", [manager, ExecutableTool()])

    assert snapshot["snapshot_version"] == "p9-model-tools-v1"
    assert [item["name"] for item in snapshot["tools"]] == ["TodoWrite", "workspace.read"]
    verify_model_tool_calls(snapshot, [{"name": "workspace.read"}])
    with pytest.raises(ValueError, match="model_tool_not_in_snapshot:UpdateUserConfig"):
        verify_model_tool_calls(snapshot, [{"name": "UpdateUserConfig"}])


def test_model_tool_snapshot_rejects_duplicate_model_names() -> None:
    tool = {"name": "clock", "parameters": {"type": "object", "properties": {}}}
    with pytest.raises(ValueError, match="model_tool_duplicate"):
        freeze_model_tool_snapshot("desktop", [tool, dict(tool)])


def test_execution_registry_binds_schema_executor_risk_and_approval() -> None:
    read = {"name": "run_read", "parameters": {"type": "object", "properties": {}}}
    shell = {"name": "run_powershell", "parameters": {"type": "object", "properties": {}}}
    registry = build_execution_tool_registry("desktop", [shell, read], {
        "run_read": {
            "version": 1, "source": "desktop-host", "classification": "local-equivalent",
            "risk": "read_only", "approval_mode": "none", "executor_id": "workbench:run_read",
        },
        "run_powershell": {
            "version": 1, "source": "desktop-host", "classification": "local-equivalent",
            "risk": "sensitive", "approval_mode": "conditional", "executor_id": "workbench:run_powershell",
        },
    })

    assert registry["registry_version"] == "p9-execution-tools-v1"
    assert registry["model_tool_snapshot_sha256"] == freeze_model_tool_snapshot("desktop", [shell, read])["sha256"]
    assert execution_tool_record(registry, "run_powershell")["approval_mode"] == "conditional"
    with pytest.raises(ValueError, match="execution_tool_not_registered:phantom"):
        execution_tool_record(registry, "phantom")


@pytest.mark.parametrize(
    ("metadata", "error"),
    [
        ({}, "execution_tool_registry_metadata_drift:clock"),
        ({"clock": {"version": 1, "source": "desktop-host", "classification": "local-equivalent",
                    "risk": "sensitive", "approval_mode": "none", "executor_id": "workbench:clock"}},
         "execution_tool_approval_policy_drift:clock"),
    ],
)
def test_execution_registry_fails_closed_on_drift(metadata: dict, error: str) -> None:
    tool = {"name": "clock", "parameters": {"type": "object", "properties": {}}}
    with pytest.raises(ValueError, match=error):
        build_execution_tool_registry("desktop", [tool], metadata)


@pytest.mark.parametrize("risk", ["read_only", "local_write", "external_write", "sensitive", "forbidden"])
@pytest.mark.parametrize("approval_mode", ["none", "required", "conditional"])
def test_execution_registry_risk_approval_matrix(risk: str, approval_mode: str) -> None:
    tool = {"name": "matrix", "parameters": {"type": "object", "properties": {}}}
    metadata = {"matrix": {
        "version": 1, "source": "desktop-host", "classification": "local-equivalent",
        "risk": risk, "approval_mode": approval_mode, "executor_id": "workbench:matrix",
    }}
    valid = (
        risk == "local_write"
        or (risk == "read_only" and approval_mode == "none")
        or (risk in {"external_write", "sensitive"} and approval_mode != "none")
    )
    if valid:
        assert build_execution_tool_registry("desktop", [tool], metadata)["tools"][0]["risk"] == risk
    else:
        with pytest.raises(ValueError):
            build_execution_tool_registry("desktop", [tool], metadata)


def test_execution_registry_filters_unavailable_capability_before_model_execution() -> None:
    tool = {"name": "workspace.read", "parameters": {"type": "object", "properties": {}}}
    metadata = {"workspace.read": {
        "version": 1, "source": "android-host", "classification": "local-equivalent",
        "risk": "read_only", "approval_mode": "none", "executor_id": "android-host:workspace.read",
        "required_capabilities": ["saf_read"],
    }}
    with pytest.raises(ValueError, match="execution_tool_capability_unavailable:workspace.read"):
        build_execution_tool_registry("android", [tool], metadata, ["chat"])
    accepted = build_execution_tool_registry("android", [tool], metadata, ["chat", "saf_read"])
    assert accepted["tools"][0]["required_capabilities"] == ["saf_read"]


def test_tool_call_batch_rejects_duplicate_limit_and_mixed_approval_before_execution() -> None:
    schemas = [
        {"name": "clock", "parameters": {"type": "object", "properties": {}}},
        {"name": "publish", "parameters": {"type": "object", "properties": {}}},
    ]
    registry = build_execution_tool_registry("desktop", schemas, {
        "clock": {"version": 1, "source": "desktop-host", "classification": "local-equivalent",
                  "risk": "read_only", "approval_mode": "none", "executor_id": "workbench:clock"},
        "publish": {"version": 1, "source": "desktop-host", "classification": "local-equivalent",
                    "risk": "external_write", "approval_mode": "required", "executor_id": "workbench:publish"},
    })
    with pytest.raises(ValueError, match="tool_call_id_duplicate"):
        validate_tool_call_batch(registry, [
            {"call_id": "same", "name": "clock"}, {"call_id": "same", "name": "clock"},
        ])
    with pytest.raises(ValueError, match="tool_call_parallel_limit"):
        validate_tool_call_batch(registry, [{"call_id": str(i), "name": "clock"} for i in range(3)], max_parallel_tool_calls=2)
    with pytest.raises(ValueError, match="approval_tool_must_be_single"):
        validate_tool_call_batch(registry, [
            {"call_id": "read", "name": "clock"}, {"call_id": "write", "name": "publish"},
        ], allow_homogeneous_approval_batch=True)
