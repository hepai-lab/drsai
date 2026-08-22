"""Desktop/TUI stream facade whose execution is owned by DrSaiAgentKernel."""

from __future__ import annotations

from typing import Any, AsyncIterator, Mapping, Sequence

from autogen_agentchat.base import TaskResult
from autogen_agentchat.messages import BaseAgentEvent, BaseChatMessage, TextMessage

from .desktop_kernel_coordinator import DesktopKernelCoordinator
from .desktop_kernel_events import DesktopKernelTurnState, translate_kernel_event
from .mobile_core import RuntimeEnvelope
from .mobile_core import MessageType


def build_desktop_start_envelope(
    *,
    run_id: str,
    session_id: str,
    input_text: str,
    model_id: str,
    tools: Sequence[Mapping[str, Any]],
    history: Sequence[Mapping[str, Any]] = (),
    skills: Sequence[Mapping[str, Any]] = (),
    artifacts: Sequence[str] = (),
    agent: Mapping[str, Any] | None = None,
    context_budget: Mapping[str, Any] | None = None,
    memory_candidates: Sequence[Mapping[str, Any]] = (),
    satisfied_capability_domains: Sequence[str] = (),
    host_port: Mapping[str, Any],
) -> RuntimeEnvelope:
    return RuntimeEnvelope(
        MessageType.START_RUN,
        f"{run_id}:desktop:start",
        run_id,
        session_id,
        0,
        f"{run_id}:desktop:start",
        {
            "input": input_text,
            "model_id": model_id,
            "tools": [dict(value) for value in tools],
            "history": [dict(value) for value in history],
            "skills": [dict(value) for value in skills],
            "artifacts": list(artifacts),
            "agent": None if agent is None else dict(agent),
            "context_budget": None if context_budget is None else dict(context_budget),
            "memory_candidates": [dict(value) for value in memory_candidates],
            "satisfied_capability_domains": list(satisfied_capability_domains),
            "host_port": dict(host_port),
        },
    )


class DesktopKernelRunStream:
    def __init__(self, coordinator: DesktopKernelCoordinator, *, assistant_name: str) -> None:
        self._coordinator = coordinator
        self._assistant_name = assistant_name

    async def execute(
        self,
        start: RuntimeEnvelope,
    ) -> AsyncIterator[BaseAgentEvent | BaseChatMessage | TaskResult]:
        state = DesktopKernelTurnState(self._assistant_name)
        output: list[BaseAgentEvent | BaseChatMessage] = []
        final_message_emitted = False
        async for runtime_event in self._coordinator.execute(start):
            translated = translate_kernel_event(runtime_event, state)
            for event in translated:
                if isinstance(event, TextMessage):
                    final_message_emitted = True
                output.append(event)
                yield event
        if state.terminal_kind is None:
            raise RuntimeError("desktop_kernel_terminal_event_missing")
        if state.terminal_kind == "run.failed":
            code = str(state.terminal_payload.get("code") or "kernel_run_failed")
            message = str(state.terminal_payload.get("message") or "").strip()
            raise RuntimeError(message or code)
        if state.final_text and not final_message_emitted:
            final = TextMessage(
                content=state.final_text,
                source=self._assistant_name,
                metadata={**state.message_metadata(state.final_text), "kernel_terminal": state.terminal_kind},
            )
            output.append(final)
            yield final
        yield TaskResult(messages=output, stop_reason=state.terminal_kind)
