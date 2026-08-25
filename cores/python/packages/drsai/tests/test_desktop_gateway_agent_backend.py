"""The translation trunk in ``desktop_gateway._agent_backend``.

``test_desktop_gateway_surface`` stubs the Agent Backend out to keep the route tests
free of a model, which leaves the one genuinely migrated class untested. These
tests drive it directly with a fake autogen stream.

What is worth pinning here is not that events arrive, but the three places
where a wrong answer is silent:

- a tool event without a call identity must be **rejected**, because the journal
  keys tool Items by call id and a synthesised one splits a single tool call
  across two Items;
- artifacts must be filtered by this Run's baseline, because a desktop
  Workspace's ``artifacts/`` still holds output from earlier tasks;
- an exception must arrive as a coded, credential-free ``RuntimeExecutionError``,
  because that string is shown to the user.
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from drsai.backend.desktop_gateway import _state
from drsai.backend.desktop_gateway._agent_backend import DesktopAgentBackend
from drsai.backend.runtime.agent import (
    AgentDefinition,
    RuntimeExecutionError,
    RuntimeRunContext,
)


class RecordingServices:
    """Captures the ``(type, payload)`` pairs the backend emits."""

    def __init__(self) -> None:
        self.events: list[tuple[str, dict[str, Any]]] = []
        self.state = None

    def emit(self, _context, event_type: str, payload: dict[str, Any]) -> None:
        self.events.append((event_type, dict(payload)))

    def types(self) -> list[str]:
        return [event_type for event_type, _ in self.events]

    def text(self) -> str:
        return "".join(
            payload.get("delta", "")
            for event_type, payload in self.events
            if event_type == "agent.message.delta"
        )


@pytest.fixture
def workspace(tmp_path, monkeypatch):
    monkeypatch.setenv("DRSAI_DESKTOP_GATEWAY_HOME", str(tmp_path / "home"))
    monkeypatch.setenv("DRSAI_HOME", str(tmp_path / "home"))
    _state.reset_state()
    root = tmp_path / "project"
    (root / "artifacts").mkdir(parents=True)
    # The Artifact store resolves a Workspace id back to a directory through
    # the registry; these tests use a synthetic id, so seed the cache directly.
    _state.remember_workspace_root("workspace-test", root)
    yield root
    _state.reset_state()


@pytest.fixture
def context(workspace) -> RuntimeRunContext:
    return RuntimeRunContext(
        runtime_id="runtime-test",
        instance_id="instance-test",
        workspace_id="workspace-test",
        workspace_path=workspace,
        session_id="session-test",
        run_id="run-test",
        agent_definition_id="opendrsai",
        agent_definition_version="1",
    )


@pytest.fixture
def definition() -> AgentDefinition:
    # A static provider so the backend does not demand a HepAI identity; the
    # OIDC requirement has its own test below.
    return AgentDefinition(
        asset_id="opendrsai",
        version="1",
        backend="opendrsai",
        model="deepseek-v4-pro",
        instructions="",
        permissions=frozenset(),
        raw={},
        model_provider="static",
    )


def runner_yielding(*messages):
    """Build a ``runner`` that replays fixed autogen messages."""

    def runner(_task, **_kwargs):
        async def stream():
            for message in messages:
                yield message

        return stream()

    return runner


def chunk(text: str):
    from autogen_agentchat.messages import ModelClientStreamingChunkEvent

    return ModelClientStreamingChunkEvent(content=text, source="assistant")


async def execute(backend, context, definition, services, prompt="hello"):
    return await backend.execute(context, definition, prompt, services)


# ───────────────────────────────────────────────────────── the happy path


def test_streamed_chunks_become_message_deltas(context, definition) -> None:
    backend = DesktopAgentBackend(runner=runner_yielding(chunk("Hel"), chunk("lo")))
    services = RecordingServices()
    result = asyncio.run(execute(backend, context, definition, services))

    assert services.types()[0] == "agent.started"
    assert services.types()[-1] == "agent.completed"
    assert services.text() == "Hello"
    assert result["content"] == "Hello"


def test_the_completion_carries_the_whole_answer(context, definition) -> None:
    """The renderer replaces accumulated deltas with this, so it must be complete."""
    backend = DesktopAgentBackend(runner=runner_yielding(chunk("a"), chunk("b"), chunk("c")))
    services = RecordingServices()
    asyncio.run(execute(backend, context, definition, services))
    completed = next(p for t, p in services.events if t == "agent.completed")
    assert completed["content"] == "abc"


def test_the_prompt_is_not_echoed_into_the_event_payload(context, definition) -> None:
    """``agent.started`` reports a length, not the text: it lands in the journal."""
    backend = DesktopAgentBackend(runner=runner_yielding(chunk("ok")))
    services = RecordingServices()
    asyncio.run(execute(backend, context, definition, services, prompt="my secret question"))
    started = next(p for t, p in services.events if t == "agent.started")
    assert started == {"backend": "opendrsai", "prompt_length": len("my secret question")}


# ────────────────────────────────────────────────────────── tool identity


def test_tool_events_gain_a_stable_identity(context, definition) -> None:
    from autogen_agentchat.messages import FunctionCall, ToolCallRequestEvent

    call = FunctionCall(id="call-1", name="web_search", arguments="{}")
    backend = DesktopAgentBackend(
        runner=runner_yielding(ToolCallRequestEvent(content=[call], source="assistant")),
    )
    services = RecordingServices()
    asyncio.run(execute(backend, context, definition, services))

    started = next(p for t, p in services.events if t == "tool.started")
    assert started["call_id"] == "call-1"
    assert started["operation_id"] == "run-test:call-1"
    assert started["operation_ref"]["operation"] == "web_search"
    assert started["operation_ref"]["workspace_id"] == "workspace-test"


def test_a_tool_event_without_a_call_id_is_refused(context, definition) -> None:
    """Inventing an id would split one tool call across two OAEP Items."""
    backend = DesktopAgentBackend()
    with pytest.raises(RuntimeExecutionError) as error:
        backend._normalize_event(context, "tool.start", {"name": "web_search"})
    assert error.value.code == "tool_identity_missing"


def test_normalize_passes_unknown_events_through(context) -> None:
    """An event type this surface does not model must not be dropped or renamed."""
    backend = DesktopAgentBackend()
    assert backend._normalize_event(context, "citation.added", {"url": "x"}) == (
        "citation.added", {"url": "x"},
    )


# ──────────────────────────────────────────────────────────── artifacts


def test_only_files_written_during_the_run_are_published(context, definition, workspace) -> None:
    """A shared Workspace keeps earlier tasks' output under artifacts/."""
    stale = workspace / "artifacts" / "old-report.pdf"
    stale.write_bytes(b"%PDF-old")

    def runner(_task, **_kwargs):
        async def stream():
            (workspace / "artifacts" / "new-report.pdf").write_bytes(b"%PDF-new")
            yield chunk("done")

        return stream()

    backend = DesktopAgentBackend(runner=runner)
    services = RecordingServices()
    asyncio.run(execute(backend, context, definition, services))

    published = [p["relative_path"] for t, p in services.events if t == "artifact.created"]
    assert published == ["artifacts/new-report.pdf"]


def test_a_run_that_writes_nothing_publishes_nothing(context, definition, workspace) -> None:
    (workspace / "artifacts" / "old.txt").write_bytes(b"old")
    backend = DesktopAgentBackend(runner=runner_yielding(chunk("no files")))
    services = RecordingServices()
    asyncio.run(execute(backend, context, definition, services))
    assert "artifact.created" not in services.types()


# ────────────────────────────────────────────────────────────── failures


def test_an_agent_exception_becomes_a_coded_runtime_error(context, definition) -> None:
    def runner(_task, **_kwargs):
        async def stream():
            raise ValueError("upstream exploded")
            yield  # pragma: no cover

        return stream()

    backend = DesktopAgentBackend(runner=runner)
    with pytest.raises(RuntimeExecutionError) as error:
        asyncio.run(execute(backend, context, definition, RecordingServices()))
    assert error.value.code
    assert "upstream exploded" in error.value.message


def test_a_kernel_policy_failure_is_not_reported_as_a_model_outage(context, definition) -> None:
    """These are local policy outcomes; the classifier used to mislabel them."""

    def runner(_task, **_kwargs):
        async def stream():
            raise RuntimeError("required_capability_unavailable")
            yield  # pragma: no cover

        return stream()

    backend = DesktopAgentBackend(runner=runner)
    with pytest.raises(RuntimeExecutionError) as error:
        asyncio.run(execute(backend, context, definition, RecordingServices()))
    assert error.value.code == "required_capability_unavailable"
    assert "model" not in error.value.message.casefold()


def test_a_vision_rejection_names_the_model_not_the_service(context, definition) -> None:
    def runner(_task, **_kwargs):
        async def stream():
            raise RuntimeError("this model does not support image input")
            yield  # pragma: no cover

        return stream()

    backend = DesktopAgentBackend(runner=runner)
    with pytest.raises(RuntimeExecutionError) as error:
        asyncio.run(execute(backend, context, definition, RecordingServices()))
    assert error.value.code == "model_capability_mismatch"


def test_credentials_are_stripped_from_the_diagnostic(context, definition) -> None:
    """The message is shown to the user and stored in the Run manifest.

    ``redact_credentials`` removes credentials in labelled form (``Bearer x``,
    ``api_key=x``), which is how an SDK surfaces them in an error. It makes no
    claim about a bare token sitting in free prose, so this asserts the backend
    routes the text through the redactor -- not that the redactor is total.
    """

    def runner(_task, **_kwargs):
        async def stream():
            raise ValueError("rejected: Bearer sk-abcdefghijklmnop0123456789")
            yield  # pragma: no cover

        return stream()

    backend = DesktopAgentBackend(runner=runner)
    with pytest.raises(RuntimeExecutionError) as error:
        asyncio.run(execute(backend, context, definition, RecordingServices()))
    assert "sk-abcdefghijklmnop0123456789" not in error.value.message
    assert "[REDACTED]" in error.value.message


def test_a_hepai_model_without_an_identity_is_refused(context) -> None:
    """Feature 1 again: the signed-in account is what pays for the model call."""
    hepai = AgentDefinition(
        asset_id="opendrsai", version="1", backend="opendrsai", model="deepseek-v4-pro",
        instructions="", permissions=frozenset(), raw={}, model_provider="hepai",
    )
    backend = DesktopAgentBackend(runner=runner_yielding(chunk("unreachable")))
    with pytest.raises(RuntimeExecutionError) as error:
        asyncio.run(execute(backend, context, hepai, RecordingServices()))
    assert error.value.code == "model_unauthorized"


def test_a_closed_backend_refuses_new_work(context, definition) -> None:
    backend = DesktopAgentBackend(runner=runner_yielding(chunk("x")))
    asyncio.run(backend.close())
    with pytest.raises(RuntimeExecutionError) as error:
        asyncio.run(execute(backend, context, definition, RecordingServices()))
    assert error.value.code == "agent_backend_closed"


# ──────────────────────────────────────────────────────── run bookkeeping


def test_the_run_context_is_released_after_execution(context, definition) -> None:
    """A leaked context would let a later Run's deliver_artifact write here."""
    from drsai.backend.desktop_gateway import _artifacts

    backend = DesktopAgentBackend(runner=runner_yielding(chunk("x")))
    asyncio.run(execute(backend, context, definition, RecordingServices()))
    assert _artifacts.run_context.get() is None


def test_the_cancellation_token_is_dropped_after_execution(context, definition) -> None:
    backend = DesktopAgentBackend(runner=runner_yielding(chunk("x")))
    asyncio.run(execute(backend, context, definition, RecordingServices()))
    assert backend._cancellations == {}


def test_approvals_are_explicitly_unsupported(context) -> None:
    """V2 has no approval UI; failing loudly beats hanging a run forever."""
    backend = DesktopAgentBackend()
    with pytest.raises(RuntimeExecutionError) as error:
        asyncio.run(backend.respond_approval("run-test", "approval-1", "approved"))
    assert error.value.code == "approvals_unsupported"


def test_health_reports_the_backend_identity() -> None:
    backend = DesktopAgentBackend()
    assert asyncio.run(backend.health())["backend"] == "opendrsai"
