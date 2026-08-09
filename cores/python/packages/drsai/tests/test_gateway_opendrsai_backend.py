from __future__ import annotations

import asyncio
import time
from pathlib import Path
from types import SimpleNamespace

import pytest
from autogen_agentchat.messages import MultiModalMessage, TextMessage
from PIL import Image as PILImage

from drsai.backend import gateway
from drsai.backend.gateway import GatewayOpenDrSaiAgentBackend
from drsai.backend.runtime.agent import AgentDefinition, RuntimeRunContext
from drsai.platform_auth import PlatformAuthContext, platform_auth_scope
from drsai.backend.runtime.agent import RuntimeExecutionError
from drsai.config.knowledge_registry import KnowledgeResource, index_local_files, put_knowledge_resource


class RecordingServices:
    def __init__(self) -> None:
        self.events: list[tuple[str, dict]] = []

    def emit(self, _context: RuntimeRunContext, event_type: str, data: dict) -> dict:
        self.events.append((event_type, data))
        return data


def _context(workspace: Path) -> RuntimeRunContext:
    return RuntimeRunContext(
        runtime_id="runtime",
        instance_id="instance",
        workspace_id="workspace",
        workspace_path=workspace,
        session_id="thread-one",
        run_id="run-one",
        agent_definition_id="opendrsai",
        agent_definition_version="1",
    )


def _definition(model_provider: str | None = None) -> AgentDefinition:
    return AgentDefinition(
        asset_id="opendrsai",
        version="1",
        backend="opendrsai",
        model=None,
        instructions="",
        permissions=frozenset(),
        raw={},
        model_provider=model_provider,
    )


def _auth() -> PlatformAuthContext:
    return PlatformAuthContext(
        access_token="test-only",
        subject="user@example.invalid",
        issuer="https://issuer.example.invalid",
        expires_at=int(time.time()) + 300,
        model_base_url="https://issuer.example.invalid/v1",
    )


def test_gateway_backend_reuses_desktop_stream_and_projects_runtime_events(tmp_path: Path) -> None:
    observed: dict = {}

    async def runner(**kwargs):
        observed.update(kwargs)
        yield TextMessage(source="assistant", content="Windows answer")

    backend = GatewayOpenDrSaiAgentBackend(runner)
    services = RecordingServices()
    with platform_auth_scope(_auth()):
        result = asyncio.run(backend.execute(_context(tmp_path), _definition(), "hello", services))

    assert result["content"] == "Windows answer"
    assert observed["thread_id"] == "thread-one"
    assert observed["user_id"] == "user@example.invalid"
    assert observed["work_dir"] == str(tmp_path)
    assert [event_type for event_type, _ in services.events] == [
        "agent.started",
        "agent.message.delta",
        "agent.completed",
    ]
    assert services.events[1][1]["delta"] == "Windows answer"


def test_gateway_backend_forwards_existing_oaep_image_resource_to_real_desktop_stream(tmp_path: Path) -> None:
    PILImage.new("RGB", (2, 2), "white").save(tmp_path / "proof.png")
    image = (tmp_path / "proof.png").read_bytes()
    context = _context(tmp_path)
    context = RuntimeRunContext(
        **{**context.__dict__, "input_resources": ({
            "protocol": "oaep.input/1", "resource_id": "image-1", "kind": "file",
            "name": "proof.png", "permission": "read", "status": "encoded",
            "reference": "proof.png", "mime": "image/png", "size_bytes": len(image),
            "sha256": __import__("hashlib").sha256(image).hexdigest(),
        },)}
    )
    observed = {}

    async def runner(**kwargs):
        observed.update(kwargs)
        yield TextMessage(source="assistant", content="P3-TRACE-42")

    with platform_auth_scope(_auth()):
        asyncio.run(GatewayOpenDrSaiAgentBackend(runner).execute(context, _definition(), "describe", RecordingServices()))
    assert isinstance(observed["task"], MultiModalMessage)
    assert observed["task"].content[0] == "describe"
    assert "resource_id=image-1" in observed["task"].content[1]
    assert observed["task"].content[2].to_base64()


def test_gateway_backend_requires_forwarded_oidc_identity(tmp_path: Path) -> None:
    async def runner(**_kwargs):
        if False:
            yield SimpleNamespace()

    backend = GatewayOpenDrSaiAgentBackend(runner)
    services = RecordingServices()

    try:
        asyncio.run(backend.execute(_context(tmp_path), _definition(), "hello", services))
    except Exception as exc:
        assert getattr(exc, "code", None) == "model_unauthorized"
    else:
        raise AssertionError("missing OIDC identity must fail closed")


def test_gateway_backend_static_provider_does_not_require_hepai_identity(tmp_path: Path) -> None:
    observed = {}

    async def runner(**kwargs):
        observed.update(kwargs)
        yield TextMessage(source="assistant", content="provider answer")

    result = asyncio.run(GatewayOpenDrSaiAgentBackend(runner).execute(
        _context(tmp_path), _definition("zhizengzeng"), "hello", RecordingServices(),
    ))
    assert result["content"] == "provider answer"
    assert observed["model_provider"] == "zhizengzeng"
    assert observed["user_id"] == "provider-zhizengzeng"


def test_gateway_backend_preserves_secret_free_failure_type(tmp_path: Path) -> None:
    async def runner(**_kwargs):
        raise TypeError("provider payload rejected")
        if False:
            yield SimpleNamespace()

    with platform_auth_scope(_auth()), pytest.raises(RuntimeExecutionError) as caught:
        asyncio.run(GatewayOpenDrSaiAgentBackend(runner).execute(
            _context(tmp_path), _definition(), "hello", RecordingServices(),
        ))
    assert caught.value.code == "upstream_unavailable"
    assert caught.value.message == "TypeError: provider payload rejected"
    assert caught.value.as_dict()["redacted_details"] == {"reason": "TypeError"}


def test_gateway_backend_redacts_credentials_from_diagnostic_message(tmp_path: Path) -> None:
    async def runner(**_kwargs):
        raise RuntimeError("request failed with api_key=super-secret-value")
        if False:
            yield SimpleNamespace()

    with platform_auth_scope(_auth()), pytest.raises(RuntimeExecutionError) as caught:
        asyncio.run(GatewayOpenDrSaiAgentBackend(runner).execute(
            _context(tmp_path), _definition(), "hello", RecordingServices(),
        ))

    assert caught.value.message == "RuntimeError: request failed with api_key=[REDACTED]"
    assert "super-secret-value" not in str(caught.value.as_dict())


def test_gateway_backend_preserves_complete_provider_response_body(tmp_path: Path) -> None:
    response_body = "provider response: " + ("x" * 6_000) + " access_token=private-token tail"

    async def runner(**_kwargs):
        raise RuntimeError(response_body)
        if False:
            yield SimpleNamespace()

    with platform_auth_scope(_auth()), pytest.raises(RuntimeExecutionError) as caught:
        asyncio.run(GatewayOpenDrSaiAgentBackend(runner).execute(
            _context(tmp_path), _definition(), "hello", RecordingServices(),
        ))

    assert caught.value.message.endswith(" access_token=[REDACTED] tail")
    assert "x" * 6_000 in caught.value.message
    assert "private-token" not in caught.value.message


def test_gateway_backend_preserves_allowlisted_kernel_failure_code(tmp_path: Path) -> None:
    async def runner(**_kwargs):
        raise RuntimeError("APIStatusError")
        if False:
            yield SimpleNamespace()

    backend = GatewayOpenDrSaiAgentBackend(runner)
    services = RecordingServices()
    with platform_auth_scope(_auth()), pytest.raises(RuntimeExecutionError) as caught:
        asyncio.run(backend.execute(_context(tmp_path), _definition(), "hello", services))

    assert caught.value.code == "upstream_unavailable"
    assert caught.value.message == "RuntimeError: APIStatusError"
    assert caught.value.as_dict()["redacted_details"] == {"reason": "APIStatusError"}


def test_gateway_backend_classifies_local_vision_mismatch_without_retry(tmp_path: Path) -> None:
    async def runner(**_kwargs):
        raise RuntimeError("The model does not support vision and image was provided")
        if False:
            yield SimpleNamespace()

    with platform_auth_scope(_auth()), pytest.raises(RuntimeExecutionError) as caught:
        asyncio.run(GatewayOpenDrSaiAgentBackend(runner).execute(
            _context(tmp_path), _definition(), "describe", RecordingServices(),
        ))
    assert caught.value.code == "model_capability_mismatch"
    assert caught.value.retryable is False
    assert caught.value.as_dict()["redacted_details"] == {"reason": "model_vision_unsupported"}


def test_gateway_backend_double_cancel_reaches_model_tool_and_subtask_tokens(tmp_path: Path) -> None:
    async def scenario(phase: str) -> None:
        started = asyncio.Event()
        stopped = asyncio.Event()
        observed: dict = {}

        async def runner(**kwargs):
            token = kwargs["cancellation_token"]
            observed["token"] = token
            waiter = asyncio.get_running_loop().create_future()
            token.link_future(waiter)
            started.set()
            try:
                await waiter
            finally:
                stopped.set()
            if False:
                yield SimpleNamespace(phase=phase)

        backend = GatewayOpenDrSaiAgentBackend(runner)
        with platform_auth_scope(_auth()):
            execution = asyncio.create_task(
                backend.execute(_context(tmp_path), _definition(), phase, RecordingServices())
            )
            await asyncio.wait_for(started.wait(), timeout=1)
            await asyncio.gather(backend.cancel("run-one"), backend.cancel("run-one"))
            with pytest.raises(RuntimeExecutionError) as caught:
                await asyncio.wait_for(execution, timeout=1)
        assert caught.value.code == "run_cancelled"
        assert observed["token"].is_cancelled()
        assert stopped.is_set()
        assert "run-one" not in backend._cancellations

    async def matrix() -> None:
        for phase in ("model", "tool", "subtask"):
            await scenario(phase)

    asyncio.run(matrix())


def test_gateway_backend_disconnect_stops_active_execution_without_rollback(tmp_path: Path) -> None:
    async def scenario() -> None:
        completed_side_effects = ["file-written-once"]
        started = asyncio.Event()
        stopped = asyncio.Event()

        async def runner(**kwargs):
            waiter = asyncio.get_running_loop().create_future()
            kwargs["cancellation_token"].link_future(waiter)
            started.set()
            try:
                await waiter
            finally:
                stopped.set()
            if False:
                yield SimpleNamespace()

        backend = GatewayOpenDrSaiAgentBackend(runner)
        with platform_auth_scope(_auth()):
            execution = asyncio.create_task(
                backend.execute(_context(tmp_path), _definition(), "disconnect", RecordingServices())
            )
            await asyncio.wait_for(started.wait(), timeout=1)
            await backend.close()
            with pytest.raises(RuntimeExecutionError) as caught:
                await asyncio.wait_for(execution, timeout=1)
        assert caught.value.code == "run_cancelled"
        assert stopped.is_set()
        assert completed_side_effects == ["file-written-once"]

    asyncio.run(scenario())


def test_gateway_backend_binds_and_clears_image_tool_run_context(monkeypatch, tmp_path: Path) -> None:
    observed = []
    fake_adapter = SimpleNamespace(
        generate=lambda context, arguments, _cancelled: observed.append((context, arguments)) or {"artifact_id": "artifact-1"},
    )
    monkeypatch.setattr(gateway, "_runtime_image_adapter", lambda: fake_adapter)

    async def runner(**_kwargs):
        result = await gateway.image_generation("draw a comet", "512x512")
        assert result == {"artifact_id": "artifact-1"}
        yield TextMessage(source="assistant", content="created")

    context = _context(tmp_path)
    with platform_auth_scope(_auth()):
        result = asyncio.run(GatewayOpenDrSaiAgentBackend(runner).execute(
            context, _definition(), "draw", RecordingServices(),
        ))

    assert result["content"] == "created"
    assert observed == [(context, {"prompt": "draw a comet", "size": "512x512"})]
    with pytest.raises(RuntimeExecutionError) as unavailable:
        asyncio.run(gateway.image_generation("outside a run"))
    assert unavailable.value.code == "runtime_context_unavailable"


def test_agent_manager_always_injects_native_image_tools(monkeypatch, tmp_path: Path) -> None:
    captured = {}

    class FakeAgent:
        async def lazy_init(self):
            return None

    def create_agent(**kwargs):
        captured.update(kwargs)
        return FakeAgent()

    async def no_remote_tools():
        return [], None

    async def no_state(*_args):
        return None

    async def no_thread(*_args):
        return None

    manager = gateway.AgentManager()
    monkeypatch.setattr(gateway, "create_agent", create_agent)
    monkeypatch.setattr(gateway, "_load_remote_hepai_tools", no_remote_tools)
    monkeypatch.setattr(gateway, "_get_db", lambda: object())
    monkeypatch.setattr(gateway, "_model_config_stamp", lambda: None)
    monkeypatch.setattr(gateway, "model_config_revision", lambda: "sha256:" + "a" * 64)
    monkeypatch.setattr(gateway, "current_agent_name", lambda: "opendrsai")
    monkeypatch.setattr(gateway, "load_agent_runtime_policy", lambda _name: gateway.AgentRuntimePolicySnapshot(
        "opendrsai", gateway.AgentToolPolicy(), gateway.AgentSkillPolicy(), gateway.AgentKnowledgePolicy(),
        "sha256:" + "b" * 64,
    ))
    monkeypatch.setattr(gateway, "list_tool_resources", lambda _path: ())
    monkeypatch.setattr(manager, "_load_thread_state", no_state)
    monkeypatch.setattr(manager, "_get_or_create_thread", no_thread)

    asyncio.run(manager.get_or_create("thread", "user", work_dir=str(tmp_path)))

    tools = captured["extra_tools"]
    assert [tool.__name__ for tool in tools[:2]] == ["image_generation", "image_edit"]


def test_agent_manager_applies_explicit_agent_tool_policy(monkeypatch, tmp_path: Path) -> None:
    captured = {}

    class FakeAgent:
        async def lazy_init(self):
            return None

    async def no_state(*_args):
        return None

    async def no_thread(*_args):
        return None

    async def remote_tools():
        return [SimpleNamespace(name="web.search"), SimpleNamespace(name="other")], []

    manager = gateway.AgentManager()
    monkeypatch.setattr(gateway, "create_agent", lambda **kwargs: captured.update(kwargs) or FakeAgent())
    monkeypatch.setattr(gateway, "_load_remote_hepai_tools", remote_tools)
    monkeypatch.setattr(gateway, "_get_db", lambda: object())
    monkeypatch.setattr(gateway, "_model_config_stamp", lambda: None)
    monkeypatch.setattr(gateway, "model_config_revision", lambda: "sha256:" + "a" * 64)
    monkeypatch.setattr(gateway, "current_agent_name", lambda: "opendrsai")
    monkeypatch.setattr(gateway, "load_agent_runtime_policy", lambda _name: gateway.AgentRuntimePolicySnapshot(
        "opendrsai",
        gateway.AgentToolPolicy("explicit", ("builtin.image_edit", "web.search")),
        gateway.AgentSkillPolicy(), gateway.AgentKnowledgePolicy(), "sha256:" + "b" * 64,
    ))
    monkeypatch.setattr(gateway, "list_tool_resources", lambda _path: ())
    monkeypatch.setattr(manager, "_load_thread_state", no_state)
    monkeypatch.setattr(manager, "_get_or_create_thread", no_thread)

    asyncio.run(manager.get_or_create("thread", "user", work_dir=str(tmp_path)))

    assert captured["tool_resource_ids"] == ["builtin.image_edit", "web.search"]
    assert [getattr(tool, "__name__", getattr(tool, "name", "")) for tool in captured["extra_tools"]] == [
        "image_edit", "web.search",
    ]


def test_agent_knowledge_tool_returns_auditable_local_evidence(tmp_path: Path) -> None:
    docs = tmp_path / "docs"; docs.mkdir()
    (docs / "guide.md").write_text("OpenDrSai knowledge search uses cited chunks.", encoding="utf-8")
    config_dir = tmp_path / "config"
    resource = put_knowledge_resource(config_dir, KnowledgeResource(
        "guide", "Guide", "local-files", True,
        {"root_path": str(docs), "paths": ["."], "chunk_size": 200, "chunk_overlap": 20},
    ))
    index_local_files(config_dir, resource)
    policy = gateway.AgentKnowledgePolicy("explicit", ("guide",), "always", 4, 0.0, True)
    tool = gateway._build_agent_knowledge_tool(config_dir=config_dir, resources=(resource,), policy=policy)

    payload = __import__("json").loads(asyncio.run(tool("knowledge search")))

    assert payload["require_citations"] is True
    assert payload["evidence"][0]["knowledge_id"] == "guide"
    assert payload["evidence"][0]["source"] == "guide.md"
    assert payload["evidence"][0]["content_sha256"]


def test_legacy_ragflow_environment_migrates_without_plaintext_secret(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("MEMORY_DATASET_ID", "dataset-one")
    monkeypatch.setenv("RAGFLOW_URL", "https://rag.example.invalid/")
    monkeypatch.setenv("RAGFLOW_TOKEN", "legacy-secret")
    monkeypatch.setattr(gateway, "store_credential", lambda secret: "drsai-credential:" + "1" * 36 if secret == "legacy-secret" else "")

    gateway._migrate_legacy_knowledge_config(tmp_path)
    resource = gateway.get_knowledge_resource(tmp_path, "legacy-ragflow")

    assert resource.config["credential_ref"].startswith("drsai-credential:")
    assert "legacy-secret" not in (tmp_path / "knowledge" / "knowledge_legacy-ragflow.toml").read_text(encoding="utf-8")


def test_gateway_backend_preserves_kernel_verification_failure(tmp_path: Path) -> None:
    async def runner(**_kwargs):
        raise RuntimeError("verification_required_tool_omitted")
        yield  # pragma: no cover

    with platform_auth_scope(_auth()):
        with pytest.raises(RuntimeExecutionError) as caught:
            asyncio.run(GatewayOpenDrSaiAgentBackend(runner).execute(
                _context(tmp_path), _definition(), "verify", RecordingServices(),
            ))

    assert caught.value.code == "verification_required_tool_omitted"
    assert "verification tool" in str(caught.value)


def test_agent_resource_snapshots_are_isolated_immutable_and_secret_free(tmp_path: Path) -> None:
    put_knowledge_resource(tmp_path, KnowledgeResource(
        "alpha-kb", "Alpha", "local-files", True,
        {"root_path": str(tmp_path), "paths": ["."], "chunk_size": 200, "chunk_overlap": 20},
    ))
    alpha = gateway.AgentRuntimePolicySnapshot(
        "alpha", gateway.AgentToolPolicy("explicit", ("builtin.image_edit",)),
        gateway.AgentSkillPolicy("explicit", ("alpha-skill",), (), True),
        gateway.AgentKnowledgePolicy("explicit", ("alpha-kb",), "always", 3, 0.2, True), "rev-alpha",
    )
    beta = gateway.AgentRuntimePolicySnapshot(
        "beta", gateway.AgentToolPolicy("explicit", ("builtin.image_generation",)),
        gateway.AgentSkillPolicy("explicit", ("beta-skill",), (), False),
        gateway.AgentKnowledgePolicy("explicit", (), "never", 5, 0.5, False), "rev-beta",
    )

    first = gateway._resolved_agent_resource_snapshot(
        agent_name="alpha", runtime_policy=alpha, model_provider="openai", model_id="gpt-alpha",
        config_dir=tmp_path, installed_skill_ids=("alpha-skill", "beta-skill"),
    )
    second = gateway._resolved_agent_resource_snapshot(
        agent_name="beta", runtime_policy=beta, model_provider="local", model_id="model-beta",
        config_dir=tmp_path, installed_skill_ids=("alpha-skill", "beta-skill"),
    )

    assert first["tools"]["enabled_ids"] == ["builtin.image_edit"]
    assert second["tools"]["enabled_ids"] == ["builtin.image_generation"]
    assert first["skills"]["enabled_ids"] == ["alpha-skill"]
    assert second["skills"]["enabled_ids"] == ["beta-skill"]
    assert first["knowledge"]["source_ids"] == ["alpha-kb"]
    assert second["knowledge"]["source_ids"] == []
    assert first["sha256"] != second["sha256"]
    assert "secret" not in __import__("json").dumps(first).lower()


def test_thread_skill_override_policy_is_enforced() -> None:
    denied = gateway.AgentRuntimePolicySnapshot(
        "locked", gateway.AgentToolPolicy(), gateway.AgentSkillPolicy("explicit", ("review",), (), False),
        gateway.AgentKnowledgePolicy(), "revision",
    )
    with pytest.raises(RuntimeExecutionError) as caught:
        gateway._validate_thread_skill_selection("review", denied, ("review",))
    assert caught.value.code == "thread_skill_override_disabled"

    allowed = gateway.AgentRuntimePolicySnapshot(
        "open", gateway.AgentToolPolicy(), gateway.AgentSkillPolicy("explicit", ("review",), (), True),
        gateway.AgentKnowledgePolicy(), "revision",
    )
    assert gateway._validate_thread_skill_selection("review", allowed, ("review",)) == "review"
    with pytest.raises(RuntimeExecutionError) as unavailable:
        gateway._validate_thread_skill_selection("missing", allowed, ("review",))
    assert unavailable.value.code == "thread_skill_unavailable"


def test_skills_registry_revision_changes_with_skill_content(monkeypatch, tmp_path: Path) -> None:
    user_skills = tmp_path / "skills"
    skill_dir = user_skills / "review"
    skill_dir.mkdir(parents=True)
    skill_file = skill_dir / "SKILL.md"
    skill_file.write_text("# Review\nFirst version", encoding="utf-8")
    monkeypatch.setattr(gateway, "_get_skills_dir", lambda _user_id=None: user_skills)
    monkeypatch.setattr(gateway, "_get_available_skills_dirs", lambda: [])

    first = gateway._skills_registry_revision("user")
    skill_file.write_text("# Review\nSecond version", encoding="utf-8")
    second = gateway._skills_registry_revision("user")

    assert first.startswith("sha256:")
    assert first != second
