from __future__ import annotations

import importlib
import json
import sys
from pathlib import Path

from drsai.backend import run_drsai_agent_factory as factory
from drsai.backend.runtime.agent_kernel import (
    AgentRunConfig,
    agent_kernel_identity,
    build_tool_decision_requirement,
    normalize_kernel_host_port,
    resolve_tool_decision,
)
from drsai.config.loader import parse_user_config
from drsai.modules.agents.skills_agent.drsai_assistant import _desktop_execution_metadata
from drsai.platform_auth import PlatformAuthContext, platform_auth_scope


class _Client:
    def __init__(self, **kwargs):
        self.kwargs = kwargs


def _capturing_assistant(**kwargs):
    return kwargs


def test_desktop_memory_retrieval_tools_are_read_only_without_approval() -> None:
    for name in ("retrieve_from_memory", "read_session_memory_by_index"):
        metadata = _desktop_execution_metadata(name, f"desktop:{name}")
        assert metadata["risk"] == "read_only"
        assert metadata["approval_mode"] == "none"


def test_explicit_local_memory_tool_satisfies_source_attribution_request() -> None:
    requirement = build_tool_decision_requirement(
        "Call retrieve_from_memory exactly once and cite source marker P3-KB-42.",
        ["retrieve_from_memory", "web.search"],
    )
    assert requirement["required_domains"] == ["memory", "retrieval"]
    decision = resolve_tool_decision(requirement, ["retrieve_from_memory"])
    assert decision["category"] == "required_tool_selected"


def test_oidc_anthropic_model_uses_model_protocol_not_static_provider_protocol(
    monkeypatch, tmp_path: Path,
) -> None:
    config = parse_user_config({
        "model": "anthropic/claude-sonnet-4-6",
        "model_provider": "static-openai",
        "model_providers": {
            "static-openai": {
                "base_url": "https://static-provider.example/v1",
                "api_key": "not-a-live-secret",
                "wire_api": "openai",
            },
        },
    })
    monkeypatch.setattr(factory, "load_user_config", lambda: config)
    monkeypatch.setattr(factory, "HepAIChatCompletionClient", lambda **kwargs: {"wire_api": "openai", **kwargs})
    monkeypatch.setattr(factory, "HepAIAnthropicChatCompletionClient", lambda **kwargs: {"wire_api": "anthropic", **kwargs})
    auth = PlatformAuthContext(
        access_token="test-oidc-token",
        subject="test-subject",
        issuer="https://identity.example.test",
        expires_at=4_102_444_800,
        model_base_url="https://model.example.test/v1",
    )
    with platform_auth_scope(auth):
        desktop = factory.create_agent(
            cli_cfg={"workspace_enabled": True},
            assistant_cls=_capturing_assistant,
            work_dir=str(tmp_path),
        )
    assert desktop["model_client"]["wire_api"] == "anthropic"


def test_desktop_production_factory_and_android_probe_share_kernel_prompt_identity(
    monkeypatch, tmp_path: Path,
) -> None:
    config = parse_user_config({
        "model": "parity-model",
        "model_provider": "parity-provider",
        "model_providers": {
            "parity-provider": {
                "base_url": "https://provider.example/v1",
                "api_key": "not-a-live-secret",
            },
        },
    })
    monkeypatch.setattr(factory, "load_user_config", lambda: config)
    monkeypatch.setattr(factory, "HepAIChatCompletionClient", _Client)
    desktop = factory.create_agent(
        cli_cfg={"workspace_enabled": True},
        assistant_cls=_capturing_assistant,
        work_dir=str(tmp_path),
    )

    repo = Path(__file__).parents[5]
    runtime_root = repo / "cores/python/packages/drsai/src/drsai/backend/runtime"
    android_python = repo / "apps/android/app/src/main/python"
    sys.path[:0] = [str(runtime_root), str(android_python)]
    try:
        probe = importlib.import_module("runtime_probe")
        probe.reset()
        health = json.loads(probe.health())
        start = {
            "protocol_version": 1,
            "message_type": "start_run",
            "request_id": "p9-parity-start",
            "run_id": "p9-parity-run",
            "session_id": "p9-parity-session",
            "sequence": 0,
            "idempotency_key": "p9-parity-key",
            "payload": {
                "input": "What is HEPiX 2026?",
                "model_id": "parity-model",
                "agent": {"schema_version": 1, "prompt_version": "p9-agent-kernel-v1"},
            },
        }
        outbound = json.loads(probe.execute(json.dumps(start)))["outbound"]
        model_request = next(item for item in outbound if item["message_type"] == "model_request")
    finally:
        sys.path.remove(str(runtime_root))
        sys.path.remove(str(android_python))
        sys.modules.pop("runtime_probe", None)

    android_identity = health["agent_kernel"]
    desktop_identity = agent_kernel_identity(surface="desktop")
    desktop_host_port = normalize_kernel_host_port({
        "schema_version": 1, "protocol_version": "p9-host-port-v1", "surface": "desktop",
        "capabilities": [
            {"id": value, "version": 1, "required": value == "chat"}
            for value in [
                "chat", "streaming", "local_memory", "project_files", "shell", "approvals", "artifacts",
                "web_search", "network.public_https",
            ]
        ],
    }, surface="desktop")
    assert desktop["metadata"] == {
        "agent_kernel_id": android_identity["kernel_id"],
        "agent_kernel_version": android_identity["kernel_version"],
        "agent_prompt_version": android_identity["prompt_version"],
        "agent_base_prompt_sha256": android_identity["base_prompt_sha256"],
        "agent_kernel_sha256": android_identity["kernel_sha256"],
        "agent_capability_manifest_version": android_identity["capability_manifest_version"],
        "agent_capability_manifest_sha256": desktop_identity["capability_manifest_sha256"],
        "agent_tool_manifest_version": android_identity["tool_manifest_version"],
        "agent_model_tool_snapshot_version": android_identity["model_tool_snapshot_version"],
        "kernel_host_port_protocol_version": "p9-host-port-v1",
        "kernel_host_port_sha256": desktop_host_port["sha256"],
    }
    assert desktop["metadata"]["agent_capability_manifest_sha256"] != android_identity["capability_manifest_sha256"]
    production_manifest = desktop["_production_parity_manifest"]
    assert production_manifest["manifest_version"] == "p9-production-parity-v1"
    assert production_manifest["inventory"]["prompt"]["count"] == 1
    assert production_manifest["inventory"]["model"]["implementation"] == "client"
    base_prompt = AgentRunConfig().authoritative_prompt()
    assert desktop["system_message"].startswith(base_prompt)
    assert model_request["payload"]["messages"][0] == {"role": "system", "content": base_prompt}
