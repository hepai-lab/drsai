"""Dependency-light Desktop/TUI Host driver for the shared Agent Kernel.

ARCHIVED(2026-09-02): Desktop now reuses the TUI legacy path; see
desktop_agent_kernel_adapter.py for details. Kept importable for legacy
callers only.


The coordinator owns no Agent decisions. It services requests emitted by
``DrSaiAgentKernel`` through Desktop-provided model, Tool and checkpoint ports.
Production Autogen adapters are layered on these small ports separately.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from typing import Any, AsyncIterator, Awaitable, Callable, Mapping, Sequence

from drsai.relay.security import redact_credentials

from .mobile_core import DrSaiAgentKernel, MessageType, RuntimeEnvelope


@dataclass(frozen=True, slots=True)
class DesktopModelResult:
    content: str = ""
    deltas: tuple[str, ...] = ()
    tool_calls: tuple[Mapping[str, Any], ...] = ()
    finish_reason: str | None = None
    reasoning_summary: str = ""


@dataclass(frozen=True, slots=True)
class DesktopModelDelta:
    """One model text fragment that is ready to cross the Kernel boundary."""

    text: str


@dataclass(frozen=True, slots=True)
class DesktopToolResult:
    call_id: str
    succeeded: bool
    content: Mapping[str, Any]
    error_code: str | None = None
    artifact_ids: tuple[str, ...] = ()
    artifacts: tuple[Mapping[str, Any], ...] = ()
    inspection: Mapping[str, Any] | None = None


@dataclass(frozen=True, slots=True)
class DesktopApprovalResult:
    approval_id: str
    call_id: str
    decision: str


ModelPort = Callable[[Mapping[str, Any]], Awaitable[DesktopModelResult]]
ToolPort = Callable[[Mapping[str, Any]], Awaitable[DesktopToolResult]]
CheckpointPort = Callable[[Mapping[str, Any]], Awaitable[None]]
ApprovalPort = Callable[[Mapping[str, Any]], Awaitable[DesktopApprovalResult]]
ArtifactPort = Callable[[Mapping[str, Any]], Awaitable[Mapping[str, Any]]]


class DesktopKernelCoordinator:
    """Drive one Desktop/TUI Run exclusively from Kernel outbound requests."""

    def __init__(
        self,
        kernel: DrSaiAgentKernel,
        *,
        model: ModelPort,
        tool: ToolPort,
        checkpoint: CheckpointPort,
        approval: ApprovalPort | None = None,
        artifact: ArtifactPort | None = None,
        max_host_steps: int = 1000_000,
    ) -> None:
        if getattr(kernel, "_factory_runtime_surface", None) != "desktop":
            raise ValueError("desktop_kernel_surface_required")
        if max_host_steps < 1:
            raise ValueError("desktop_kernel_host_steps_invalid")
        self._kernel = kernel
        self._model = model
        self._tool = tool
        self._checkpoint = checkpoint
        self._approval = approval
        self._artifact = artifact
        self._max_host_steps = max_host_steps

    async def execute(self, start: RuntimeEnvelope) -> AsyncIterator[RuntimeEnvelope]:
        if start.message_type not in {MessageType.START_RUN, MessageType.RESUME_RUN}:
            raise ValueError("start_or_resume_run_required")
        queue: deque[RuntimeEnvelope] = deque()
        inbound_sequence = start.sequence
        host_steps = 0

        def response(message_type: MessageType, payload: Mapping[str, Any], suffix: str) -> RuntimeEnvelope:
            nonlocal inbound_sequence
            inbound_sequence += 1
            return RuntimeEnvelope(
                message_type, f"{start.run_id}:desktop-host:{inbound_sequence}",
                start.run_id, start.session_id, inbound_sequence,
                f"{start.run_id}:desktop-host:{inbound_sequence}:{suffix}", dict(payload),
            )

        def send(command: RuntimeEnvelope) -> None:
            nonlocal host_steps
            if command.message_type is not MessageType.MODEL_CHUNK:
                host_steps += 1
                if host_steps > self._max_host_steps:
                    raise RuntimeError("desktop_kernel_host_step_limit")
            try:
                queue.extend(self._kernel.handle(command))
            except Exception as error:
                # Policy / validation errors must not leave the session run locked
                # (e.g. approval_tool_must_be_single → session_run_already_active).
                if command.message_type in {
                    MessageType.START_RUN,
                    MessageType.RESUME_RUN,
                    MessageType.CANCEL_RUN,
                    MessageType.MODEL_FAILED,
                }:
                    raise
                fail_payload = {
                    "code": type(error).__name__,
                    "message": redact_credentials(str(error)).strip() or type(error).__name__,
                    "retryable": True,
                }
                # ARCHIVED(2026-09-02): the shared desktop-kernel subagent
                # machinery (_start_subagents/_subagent_failed in
                # mobile_core/engine.py) is archived for Desktop; Delegate is
                # handled directly by DrSaiAssistant. Kept only for legacy
                # importers of these archived adapters.
                # Carry subagent_id from the failed command so _model_failed
                # routes to _subagent_failed (graceful subagent failure
                # reported as a tool result to the main agent) instead of
                # treating it as a main-agent failure that kills the run.
                _failed_subagent_id = command.payload.get("subagent_id")
                if _failed_subagent_id is not None:
                    fail_payload["subagent_id"] = _failed_subagent_id
                try:
                    queue.extend(self._kernel.handle(response(
                        MessageType.MODEL_FAILED, fail_payload, "kernel-command-failed",
                    )))
                    return
                except Exception:
                    try:
                        queue.extend(self._kernel.handle(RuntimeEnvelope(
                            MessageType.CANCEL_RUN,
                            f"{start.run_id}:desktop-host:cancel",
                            start.run_id,
                            start.session_id,
                            inbound_sequence + 1,
                            f"{start.run_id}:desktop-host:cancel",
                            {},
                        )))
                        return
                    except Exception as cancel_error:
                        raise error from cancel_error

        release_seq = 0

        def release_session_run(run_id: str) -> None:
            nonlocal release_seq, inbound_sequence
            if self._kernel.active_run_id_for_session(start.session_id) != run_id:
                return
            release_seq += 1
            inbound_sequence += 1
            try:
                self._kernel.handle(RuntimeEnvelope(
                    MessageType.CANCEL_RUN,
                    f"{run_id}:desktop-host:release:{release_seq}",
                    run_id,
                    start.session_id,
                    inbound_sequence,
                    f"{run_id}:desktop-host:release:{release_seq}",
                    {},
                ))
            except Exception:
                if self._kernel.active_run_id_for_session(start.session_id) == run_id:
                    self._kernel._active_run_by_session.pop(start.session_id, None)

        def start_or_replace_stale_session() -> None:
            try:
                send(start)
            except ValueError as error:
                if str(error) != "session_run_already_active":
                    raise
                stale = self._kernel.active_run_id_for_session(start.session_id)
                if stale is None or stale == start.run_id:
                    raise
                # A previous Desktop turn can leave the shared Kernel session
                # locked after a Host exception or a UI stop that never reached
                # CANCEL_RUN. The next user message must replace that stale Run.
                release_session_run(stale)
                send(start)

        try:
            start_or_replace_stale_session()
            while queue:
                outbound = queue.popleft()
                if outbound.message_type is MessageType.RUNTIME_EVENT:
                    yield outbound
                elif outbound.message_type is MessageType.CHECKPOINT_REQUEST:
                    await self._checkpoint(outbound.payload)
                elif outbound.message_type is MessageType.MODEL_REQUEST:
                    # ARCHIVED(2026-09-02): desktop-kernel subagent routing is
                    # archived for Desktop (Delegate handled by DrSaiAssistant).
                    # Carry subagent_id from the Model request through every
                    # host response so the Kernel routes chunks/completions to
                    # _model_chunk's subagent branch instead of mistaking a
                    # subagent's output for the main agent's final answer.
                    subagent_id = outbound.payload.get("subagent_id")
                    try:
                        stream = getattr(self._model, "stream", None)
                        if callable(stream):
                            result: DesktopModelResult | None = None
                            async for item in stream(outbound.payload):
                                if isinstance(item, DesktopModelDelta):
                                    if not item.text:
                                        continue
                                    # Do not enqueue model chunks behind the still-running
                                    # Provider call. Feed them into the Kernel immediately
                                    # and yield its Runtime Events before requesting the next
                                    # Provider fragment.
                                    chunk_payload: dict[str, Any] = {"delta": item.text}
                                    if subagent_id is not None:
                                        chunk_payload["subagent_id"] = subagent_id
                                    commands = self._kernel.handle(response(
                                        MessageType.MODEL_CHUNK,
                                        chunk_payload,
                                        "model-chunk",
                                    ))
                                    for command in commands:
                                        if command.message_type is MessageType.RUNTIME_EVENT:
                                            yield command
                                        else:
                                            queue.append(command)
                                elif isinstance(item, DesktopModelResult):
                                    if result is not None:
                                        raise RuntimeError("desktop_model_result_duplicate")
                                    result = item
                                else:
                                    raise RuntimeError(f"desktop_model_stream_item_invalid:{type(item).__name__}")
                            if result is None:
                                raise RuntimeError("desktop_model_result_missing")
                        else:
                            # Compatibility for small Host adapters and existing
                            # extensions that still implement the atomic ModelPort.
                            result = await self._model(outbound.payload)
                    except Exception as error:
                        # The model port is the last layer that still owns the SDK
                        # exception (including HTTP status and provider response
                        # body). Preserve that diagnostic text across the compact
                        # Kernel protocol, redacting credential values only.
                        fail_payload: dict[str, Any] = {
                            "code": type(error).__name__,
                            "message": redact_credentials(str(error)).strip() or type(error).__name__,
                            "retryable": False,
                        }
                        if subagent_id is not None:
                            fail_payload["subagent_id"] = subagent_id
                        send(response(MessageType.MODEL_FAILED, fail_payload, "model-failed"))
                        continue
                    # Atomic ModelPorts can still return buffered deltas. Production
                    # Desktop uses ``stream`` above and therefore reaches the UI as
                    # each Provider fragment arrives.
                    completed_payload: dict[str, Any] = {
                        "content": result.content or "".join(result.deltas),
                        "tool_calls": [dict(value) for value in result.tool_calls],
                        "finish_reason": result.finish_reason,
                        "reasoning_summary": result.reasoning_summary,
                    }
                    if subagent_id is not None:
                        completed_payload["subagent_id"] = subagent_id
                    for delta in result.deltas:
                        chunk_payload = {"delta": delta}
                        if subagent_id is not None:
                            chunk_payload["subagent_id"] = subagent_id
                        send(response(MessageType.MODEL_CHUNK, chunk_payload, "model-chunk"))
                    send(response(MessageType.MODEL_COMPLETED, completed_payload, "model-completed"))
                elif outbound.message_type is MessageType.TOOL_CALL_REQUEST:
                    # ARCHIVED(2026-09-02): desktop-kernel Delegate is archived
                    # for Desktop (handled directly by DrSaiAssistant). The
                    # try/except below remains for legacy tool-port robustness.
                    # Wrap tool execution in try/except so a tool-port exception
                    # (e.g. Delegate/subagent failure) is reported back to the
                    # Kernel as a failed tool result instead of killing the
                    # entire Run.  This mirrors the MODEL_REQUEST handler.
                    call_id = outbound.payload.get("call_id")
                    try:
                        result = await self._tool(outbound.payload)
                    except Exception as error:
                        result = DesktopToolResult(
                            call_id or "",
                            False,
                            {"content": redact_credentials(str(error)).strip() or type(error).__name__},
                            type(error).__name__.lower(),
                        )
                    if result.call_id != call_id:
                        raise RuntimeError("desktop_tool_call_identity_mismatch")
                    send(response(MessageType.TOOL_RESULT, {
                        "call_id": result.call_id,
                        "succeeded": result.succeeded,
                        "content": dict(result.content),
                        "error_code": result.error_code,
                        "artifact_ids": list(result.artifact_ids),
                        "artifacts": [dict(value) for value in result.artifacts],
                        **({"inspection": dict(result.inspection)} if result.inspection is not None else {}),
                    }, f"tool-result:{result.call_id}"))
                elif outbound.message_type is MessageType.APPROVAL_REQUEST:
                    if self._approval is None:
                        raise RuntimeError("desktop_approval_port_unavailable")
                    result = await self._approval(outbound.payload)
                    if result.approval_id != outbound.payload.get("approval_id"):
                        raise RuntimeError("desktop_approval_identity_mismatch")
                    if result.call_id != outbound.payload.get("call_id"):
                        raise RuntimeError("desktop_approval_call_identity_mismatch")
                    if result.decision not in {"approved", "rejected"}:
                        raise RuntimeError("desktop_approval_decision_invalid")
                    send(response(MessageType.APPROVAL_RESULT, {
                        "approval_id": result.approval_id,
                        "call_id": result.call_id,
                        "decision": result.decision,
                    }, f"approval-result:{result.approval_id}"))
                elif outbound.message_type is MessageType.ARTIFACT_REQUEST:
                    if self._artifact is None:
                        raise RuntimeError("desktop_artifact_port_unavailable")
                    result = dict(await self._artifact(outbound.payload))
                    if result.get("artifact_id") != outbound.payload.get("artifact_id"):
                        raise RuntimeError("desktop_artifact_identity_mismatch")
                    if result.get("operation") != outbound.payload.get("operation"):
                        raise RuntimeError("desktop_artifact_operation_mismatch")
                    send(response(MessageType.ARTIFACT_RESULT, result, (
                        f"artifact-result:{result['artifact_id']}:{result['operation']}"
                    )))
                else:
                    raise RuntimeError(f"desktop_kernel_host_port_unimplemented:{outbound.message_type.value}")
        finally:
            release_session_run(start.run_id)
