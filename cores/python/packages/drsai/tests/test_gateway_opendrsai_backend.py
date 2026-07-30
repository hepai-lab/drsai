from __future__ import annotations

import asyncio
import time
from pathlib import Path
from types import SimpleNamespace

from autogen_agentchat.messages import TextMessage

from drsai.backend.gateway import GatewayOpenDrSaiAgentBackend
from drsai.backend.runtime.agent import AgentDefinition, RuntimeRunContext
from drsai.platform_auth import PlatformAuthContext, platform_auth_scope


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


def _definition() -> AgentDefinition:
    return AgentDefinition(
        asset_id="opendrsai",
        version="1",
        backend="opendrsai",
        model=None,
        instructions="",
        permissions=frozenset(),
        raw={},
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
