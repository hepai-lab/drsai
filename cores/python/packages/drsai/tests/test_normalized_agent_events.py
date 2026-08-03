from __future__ import annotations

import pytest

from drsai.backend.runtime.adapter_registry import AgentEventAdapterRegistry
from drsai.backend.runtime.agent import (
    AgentExecutionServices,
    RuntimeRunContext,
)
from drsai.backend.runtime.normalized_events import (
    BackendBinding,
    NormalizedAgentEvent,
    NormalizedDeltaKind,
    NormalizedEventKind,
    NormalizedItemType,
    NormalizedTerminalStatus,
)


def test_normalized_item_delta_is_typed_and_immutable() -> None:
    event = NormalizedAgentEvent(
        kind=NormalizedEventKind.ITEM_DELTA,
        backend="codex",
        binding=BackendBinding("thread-1", "turn-1", "item-1"),
        item_type=NormalizedItemType.MESSAGE,
        delta_kind=NormalizedDeltaKind.MESSAGE_TEXT_APPEND,
        phase="final",
        dedupe_key="codex:thread-1:turn-1:item-1:delta:1",
        payload={"text": "hello"},
    )
    assert event.payload["text"] == "hello"
    with pytest.raises(TypeError):
        event.payload["text"] = "changed"  # type: ignore[index]


@pytest.mark.parametrize(
    "kwargs",
    [
        {"kind": NormalizedEventKind.ITEM_DELTA, "binding": BackendBinding("t", "r", "i"),
         "item_type": NormalizedItemType.MESSAGE},
        {"kind": NormalizedEventKind.ITEM_STARTED, "binding": BackendBinding("t", "r", "i"),
         "item_type": NormalizedItemType.MESSAGE, "delta_kind": NormalizedDeltaKind.MESSAGE_TEXT_APPEND},
        {"kind": NormalizedEventKind.RUN_COMPLETED, "binding": BackendBinding("t", "r")},
        {"kind": NormalizedEventKind.RUN_STARTED, "binding": BackendBinding("t")},
    ],
)
def test_normalized_contract_rejects_illegal_combinations(kwargs) -> None:
    with pytest.raises(ValueError):
        NormalizedAgentEvent(backend="codex", dedupe_key="key", **kwargs)


def test_terminal_status_is_explicit_and_exclusive() -> None:
    event = NormalizedAgentEvent(
        kind=NormalizedEventKind.RUN_CANCELLED,
        backend="codex",
        binding=BackendBinding("thread-1", "turn-1"),
        terminal_status=NormalizedTerminalStatus.CANCELLED,
        dedupe_key="codex:turn-1:cancelled",
    )
    assert event.terminal_status is NormalizedTerminalStatus.CANCELLED


class _ExampleFutureBackendAdapter:
    backend_id = "example"

    def decode(self, message):
        return NormalizedAgentEvent(
            kind=NormalizedEventKind.ITEM_COMPLETED,
            backend=self.backend_id,
            binding=BackendBinding(
                str(message["session_id"]),
                str(message["run_id"]),
                str(message["item_id"]),
            ),
            item_type=NormalizedItemType.MESSAGE,
            dedupe_key=str(message["event_id"]),
            payload={"role": "assistant", "text": str(message["text"])},
        )


def test_future_backend_uses_adapter_spi_without_client_changes() -> None:
    registry = AgentEventAdapterRegistry([_ExampleFutureBackendAdapter()])
    event = registry.decode(
        "example",
        {
            "session_id": "session-1",
            "run_id": "run-1",
            "item_id": "item-1",
            "event_id": "example-event-1",
            "text": "done",
        },
    )
    assert event is not None
    assert event.backend == "example"
    assert event.item_type is NormalizedItemType.MESSAGE
    assert registry.backend_ids == frozenset({"example"})


def test_adapter_registry_rejects_backend_spoofing() -> None:
    adapter = _ExampleFutureBackendAdapter()
    registry = AgentEventAdapterRegistry([adapter])
    adapter.backend_id = "changed"
    with pytest.raises(ValueError, match="foreign backend"):
        registry.decode(
            "example",
            {
                "session_id": "session-1",
                "run_id": "run-1",
                "item_id": "item-1",
                "event_id": "example-event-1",
                "text": "done",
            },
        )


def test_backend_private_ids_cannot_redirect_runtime_persistence(tmp_path) -> None:
    class _State:
        def __init__(self):
            self.calls = []

        def append_backend_event(self, *args, **kwargs):
            self.calls.append((args, kwargs))
            return {"ok": True}

    async def _subagent(*args, **kwargs):
        return {}

    state = _State()
    services = AgentExecutionServices(state, None, _subagent)  # type: ignore[arg-type]
    context = RuntimeRunContext(
        runtime_id="runtime-1",
        instance_id="instance-1",
        workspace_id="workspace-1",
        workspace_path=tmp_path,
        session_id="session-1",
        run_id="run-1",
        agent_definition_id="agent",
        agent_definition_version="1",
    )
    event = NormalizedAgentEvent(
        kind=NormalizedEventKind.ITEM_COMPLETED,
        backend="example",
        binding=BackendBinding("foreign-thread", "foreign-turn", "foreign-item"),
        item_type=NormalizedItemType.MESSAGE,
        dedupe_key="foreign-backend-event",
        payload={"role": "assistant", "text": "done"},
    )
    services.emit_normalized(context, event)
    assert state.calls[0][0][0] == "run-1"
    assert state.calls[0][0][3] == "foreign-backend-event"
