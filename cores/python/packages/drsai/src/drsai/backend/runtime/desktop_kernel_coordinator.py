"""Dependency-light Desktop/TUI Host driver for the shared Agent Kernel.

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
        max_host_steps: int = 64,
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
            queue.extend(self._kernel.handle(command))

        send(start)
        while queue:
            outbound = queue.popleft()
            if outbound.message_type is MessageType.RUNTIME_EVENT:
                yield outbound
            elif outbound.message_type is MessageType.CHECKPOINT_REQUEST:
                await self._checkpoint(outbound.payload)
            elif outbound.message_type is MessageType.MODEL_REQUEST:
                try:
                    result = await self._model(outbound.payload)
                except Exception as error:
                    # The model port is the last layer that still owns the SDK
                    # exception (including HTTP status and provider response
                    # body). Preserve that diagnostic text across the compact
                    # Kernel protocol, redacting credential values only.
                    send(response(MessageType.MODEL_FAILED, {
                        "code": type(error).__name__,
                        "message": redact_credentials(str(error)).strip() or type(error).__name__,
                        "retryable": False,
                    }, "model-failed"))
                    continue
                for delta in result.deltas:
                    send(response(MessageType.MODEL_CHUNK, {"delta": delta}, "model-chunk"))
                send(response(MessageType.MODEL_COMPLETED, {
                    "content": result.content or "".join(result.deltas),
                    "tool_calls": [dict(value) for value in result.tool_calls],
                    "finish_reason": result.finish_reason,
                    "reasoning_summary": result.reasoning_summary,
                }, "model-completed"))
            elif outbound.message_type is MessageType.TOOL_CALL_REQUEST:
                result = await self._tool(outbound.payload)
                if result.call_id != outbound.payload.get("call_id"):
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
