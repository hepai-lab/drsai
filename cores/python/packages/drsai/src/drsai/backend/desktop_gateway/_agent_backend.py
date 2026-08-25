"""The one class genuinely migrated out of the legacy monolith.

``GatewayOpenDrSaiAgentBackend`` (``gateway_legacy.py:2716``, ~690 lines) is the
only core asset in the gateway: it implements the ``AgentBackend`` protocol and
translates ``DrSaiAssistant.run_stream()``'s autogen events into Runtime events.
Everything else in this surface is a wrapper over ``backend/runtime/``.

What survives here is the trunk::

    run_stream()  ->  translate()  ->  _normalize_event()  ->  services.emit()

and the Artifact registration that makes features 2.3 and 4.1 work.

Cut, with reasons:
  - **approval round-trips** (``_await_approval``, ``tool_approval_handler``):
    the 11 features have no approval UI, so a run that waited for one would
    hang forever with nothing on screen to answer it.
  - **side-effect claiming** (``claim_side_effect`` / ``complete_side_effect``
    and the ``approved_side_effect_not_executed`` guards): that ledger exists to
    make approved effects replay-safe, which is only meaningful with approvals.
  - **codex backend branch**: only one backend is registered here.
  - **regression control / experiment scopes**: acceptance-harness machinery.
  - **image generation context**: no image-generation feature in the list.

The event translator is imported, not copied -- it already lives outside the
gateway in ``tui_gateway/adapter/``, shared with the TUI.
"""

from __future__ import annotations

import asyncio
import re
import time
from typing import Any

from autogen_core import CancellationToken

from drsai.backend.runtime.agent import (
    AgentDefinition,
    RuntimeExecutionError,
    RuntimeRunContext,
)
from drsai.backend.tui_gateway.adapter.event_translator import (
    TurnState as ConversationTranslationState,
)
from drsai.backend.tui_gateway.adapter.event_translator import (
    translate as translate_conversation_event,
)
from drsai.platform_auth import classify_model_error, get_platform_auth

from . import _artifacts, _state
from ._auth import effective_user_id

# The Desktop Kernel ends a Run with a bare RuntimeError code for local policy
# outcomes. Running those through the model-error classifier used to show users
# "the model service is unavailable" for what was never a model failure.
_KERNEL_FAILURES = {
    "verification_required_tool_omitted": (
        "verification_required_tool_omitted",
        "This task requires a matching verification tool before it can be answered.",
        True,
    ),
    "required_capability_unavailable": (
        "required_capability_unavailable",
        "This task requires a capability that is not available in the current Agent session.",
        False,
    ),
}


class DesktopAgentBackend:
    """Run the production OpenDrSai Agent behind the Runtime ``AgentBackend`` contract."""

    backend_id = "opendrsai"

    def __init__(self, runner: Any = None) -> None:
        # ``runner`` replaces the whole agent stream in tests: it is called with
        # the same kwargs the manager would receive and must yield autogen
        # events. Production leaves it None.
        self._runner = runner
        self._closed = False
        self._cancellations: dict[str, CancellationToken] = {}

    async def execute(
        self,
        context: RuntimeRunContext,
        definition: AgentDefinition,
        prompt: str,
        services: Any,
    ) -> dict[str, Any]:
        if self._closed:
            raise RuntimeExecutionError("agent_backend_closed", "OpenDrSai Agent Backend is closed.")
        auth = get_platform_auth()
        # HepAI-hosted models are the default and require a signed-in identity;
        # a run configured against a static provider may proceed offline.
        if definition.model_provider in {None, "", "hepai", "hepai-anthropic"} and auth is None:
            raise RuntimeExecutionError("model_unauthorized", "A valid HepAI identity is required.")
        user_id = auth.subject if auth is not None else effective_user_id()

        cancellation = CancellationToken()
        self._cancellations[context.run_id] = cancellation
        translation = ConversationTranslationState()
        content_parts: list[str] = []
        citations: list[dict[str, Any]] = []

        services.emit(context, "agent.started", {
            "backend": self.backend_id,
            "prompt_length": len(prompt),
        })
        # Wall clock and directory baseline so finishing this Run only publishes
        # files it actually wrote, not leftovers from earlier tasks in a shared
        # desktop Workspace.
        started_at = time.time()
        baseline = _artifacts.artifact_snapshot(context.workspace_path)

        token = _artifacts.run_context.set(context)
        try:
            task = self._input_task(context, prompt)
            stream = self._stream(
                task,
                context=context,
                definition=definition,
                user_id=user_id,
                cancellation=cancellation,
            )
            async for event in stream:
                for event_type, payload in translate_conversation_event(event, translation):
                    kind, data = self._normalize_event(context, event_type, payload)
                    if kind == "agent.message.delta":
                        content_parts.append(str(data.get("delta") or ""))
                    elif kind == "citation.added":
                        citations.append(dict(data))
                    services.emit(context, kind, data)

            _artifacts.register_new_artifacts(context, baseline, started_at, services.emit)
            content = "".join(content_parts)
            services.emit(context, "agent.completed", {
                "content": content,
                **({"citations": citations} if citations else {}),
            })
            return {"content": content}
        except asyncio.CancelledError as exc:
            raise RuntimeExecutionError("run_cancelled", "Run was cancelled.") from exc
        except RuntimeExecutionError:
            raise
        except Exception as exc:
            raise self._failure(exc) from exc
        finally:
            _artifacts.run_context.reset(token)
            self._cancellations.pop(context.run_id, None)

    # ── Stream plumbing ──────────────────────────────────────────────────

    @staticmethod
    def _input_task(context: RuntimeRunContext, prompt: str) -> Any:
        """Encode prompt plus any attached resources the way the Agent expects."""
        from drsai.backend.runtime.input_resources import autogen_input_task

        try:
            return autogen_input_task(
                prompt,
                context.input_resources,
                workspace_path=context.workspace_path,
                input_parts=context.input_parts or None,
            )
        except (OSError, ValueError) as exc:
            raise RuntimeExecutionError(
                "input_resources_invalid",
                "An input resource is unavailable, changed, or cannot be decoded.",
            ) from exc

    def _stream(
        self,
        task: Any,
        *,
        context: RuntimeRunContext,
        definition: AgentDefinition,
        user_id: str,
        cancellation: CancellationToken,
    ):
        kwargs = dict(
            session_id=context.session_id,
            user_id=user_id,
            model_alias=definition.model,
            work_dir=str(context.workspace_path),
            workspace_id=context.workspace_id,
            cancellation_token=cancellation,
        )
        if self._runner is not None:
            return self._runner(task, **kwargs)
        return _state.agent_manager().run_stream(task, **kwargs)

    @staticmethod
    def _normalize_event(
        context: RuntimeRunContext,
        event_type: str,
        payload: dict[str, Any],
    ) -> tuple[str, dict[str, Any]]:
        """Give every event the identity the Runtime journal needs.

        Tool events without a call identity are rejected rather than
        synthesised: the journal keys tool Items by call id, and inventing one
        would split a single tool call across two Items on the stream.
        """
        if event_type == "message.delta":
            delta = str(payload.get("text") or payload.get("delta") or payload.get("content") or "")
            return "agent.message.delta", {**payload, "delta": delta, "content": delta}
        if event_type in {"tool.start", "tool.complete"}:
            call_id = str(payload.get("call_id") or payload.get("tool_id") or "").strip()
            if not call_id:
                raise RuntimeExecutionError(
                    "tool_identity_missing",
                    "OpenDrSai Agent emitted a Tool event without a call identity.",
                )
            operation_id = str(payload.get("operation_id") or f"{context.run_id}:{call_id}")
            correlation_id = str(
                payload.get("correlation_id") or context.correlation_id or f"{context.run_id}:{call_id}"
            )
            identity = {
                **context.audit_fields(),
                "call_id": call_id,
                "operation_id": operation_id,
                "correlation_id": correlation_id,
                "operation_ref": {
                    "protocol": "owop/1",
                    "operation_id": operation_id,
                    "workspace_id": context.workspace_id,
                    "operation": str(payload.get("name") or payload.get("tool_name") or "tool.execute"),
                    "correlation_id": correlation_id,
                },
            }
            return (
                "tool.started" if event_type == "tool.start" else "tool.completed",
                {**payload, **identity},
            )
        return event_type, payload

    @staticmethod
    def _failure(exc: Exception) -> RuntimeExecutionError:
        """Turn an arbitrary Agent exception into a user-facing, secret-free error."""
        from drsai.relay.security import redact_credentials

        kernel_code = str(exc) if isinstance(exc, RuntimeError) else ""
        if kernel_code in _KERNEL_FAILURES:
            code, message, retryable = _KERNEL_FAILURES[kernel_code]
            return RuntimeExecutionError(code, message, retryable=retryable)

        error = classify_model_error(exc)
        lowered = str(exc).casefold()
        raw = str(exc)
        # Keep the actionable exception text for diagnostics. The classifier
        # returns stable user-facing categories; using its generic message here
        # collapsed every unknown failure into "model service unavailable" and
        # made the recorded Run impossible to diagnose.
        safe_text = redact_credentials(raw).strip()
        diagnostic = f"{type(exc).__name__}: {safe_text}" if safe_text else type(exc).__name__
        safe_code = (
            raw
            if isinstance(exc, RuntimeError) and re.fullmatch(r"[A-Za-z][A-Za-z0-9_.:-]{0,119}", raw)
            else type(exc).__name__
        )
        if "vision" in lowered or "image input" in lowered or "image was provided" in lowered:
            return RuntimeExecutionError(
                "model_capability_mismatch",
                "The selected model cannot process the supplied image input.",
                detail={"reason": "model_vision_unsupported"},
            )
        return RuntimeExecutionError(
            str(error.get("code") or "agent_execution_failed"),
            diagnostic,
            retryable=bool(error.get("retryable")),
            detail={"reason": safe_code},
        )

    # ── AgentBackend protocol ────────────────────────────────────────────

    async def cancel(self, run_id: str) -> None:
        token = self._cancellations.get(run_id)
        if token is not None:
            token.cancel()

    async def respond_approval(self, run_id: str, approval_id: str, decision: str) -> None:
        raise RuntimeExecutionError(
            "approvals_unsupported",
            "This Runtime does not run approval round-trips.",
        )

    async def recover(self, run_id: str) -> None:
        return None

    async def health(self) -> dict[str, Any]:
        return {
            "backend": self.backend_id,
            "closed": self._closed,
            "active_runs": sorted(self._cancellations),
        }

    async def close(self) -> None:
        self._closed = True
        for token in list(self._cancellations.values()):
            token.cancel()
        self._cancellations.clear()

    async def account_status(self, *, refresh: bool = False) -> dict[str, Any]:
        auth = get_platform_auth()
        return {
            "backend": self.backend_id,
            "signed_in": auth is not None,
            "subject": auth.subject if auth is not None else None,
        }


__all__ = ["DesktopAgentBackend"]
