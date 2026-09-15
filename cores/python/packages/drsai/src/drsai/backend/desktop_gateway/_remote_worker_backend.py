"""Remote worker Agent Backend: HepAIWorkerAgent behind the Runtime contract.

A platform ("official") agent is a remote worker customised from
``drsai_assistant.py`` and exposed over the HepAI/DDF worker protocol. The
Desktop must not know that: it consumes exactly the same OAEP/Runtime event
stream as a local OpenDrSai Agent. This backend is the adapter that makes that
true.

It is deliberately the sibling of :mod:`._agent_backend`
(``DesktopAgentBackend``): both implement the same ``AgentBackend`` protocol and
both run their agent's ``run_stream()`` through the *same* shared translator
(``events.agent_event_translator.translate``) and the *same*
``services.emit()`` trunk. The only difference is the agent object:

    DesktopAgentBackend  -> DrSaiAssistant     (local, this machine)
    RemoteWorkerBackend  -> HepAIWorkerAgent   (remote HepAI/DDF worker)

Because the translator is shared, every ``DrSaiMessageFactory`` message the
remote worker yields (``ModelClientStreamingChunkEvent`` / ``ThoughtEvent`` /
``AgentLogEvent`` / ``TaskEvent`` / ``ToolCallRequestEvent`` / ``TextMessage`` /
``stop_reason``) becomes the identical ``agent.message.delta`` / ``tool.*`` /
``agent.completed`` sequence the renderer already understands. The frontend
therefore needs no remote-specific branch, and cancellation / artifacts /
recovery inherit the local behaviour.

Connection details (worker url, api key, worker model name) come from the Agent
Definition's ``raw`` payload, so they stay server-side: the Desktop never sees
the DDF credential.
"""

from __future__ import annotations

import asyncio
import json
import time
from typing import Any, Mapping, Optional

from loguru import logger

from autogen_core import CancellationToken
from autogen_agentchat.base import Response
from autogen_agentchat.messages import TextMessage

from drsai.backend.runtime.agent import (
    AgentDefinition,
    RuntimeExecutionError,
    RuntimeRunContext,
)
from drsai.backend.events.agent_event_translator import (
    TurnState as ConversationTranslationState,
)
from drsai.backend.events.agent_event_translator import (
    translate as translate_conversation_event,
)

from . import _artifacts
from ._auth import effective_user_id

# Default remote worker endpoint. Overridable per Run through the Agent
# Definition payload so a deployment can target DDF prod/dev or a private
# worker without a code change.
DEFAULT_REMOTE_WORKER_URL = "https://ddf.ihep.ac.cn/apiv2"
DEFAULT_REMOTE_WORKER_NAME = "hepai/drsai"
DEFAULT_REMOTE_WORKER_TIMEOUT_SECONDS = 600.0


class RemoteWorkerBackend:
    """Run a remote HepAI/DDF worker behind the Runtime ``AgentBackend`` contract."""

    backend_id = "remote-worker"

    def __init__(self, runner: Any = None) -> None:
        # ``runner`` replaces the remote agent stream in tests: it is called
        # with ``(task, worker_config, chat_id, run_info, cancellation)`` and
        # must yield autogen events. Production leaves it None.
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
            raise RuntimeExecutionError(
                "agent_backend_closed", "Remote worker Agent Backend is closed."
            )

        worker_config = _remote_worker_config(definition)
        if context.model_override_requested and definition.model:
            worker_config["model"] = definition.model
        if not worker_config["url"]:
            raise RuntimeExecutionError(
                "remote_worker_unconfigured",
                "The remote worker has no url configured. Select a remote agent again.",
            )
        if not worker_config["api_key"]:
            raise RuntimeExecutionError(
                "remote_worker_unauthorized",
                "The remote worker requires a HepAI credential that this Runtime does not have.",
            )

        user_id = _remote_worker_user_id()
        cancellation = CancellationToken()
        self._cancellations[context.run_id] = cancellation
        translation = ConversationTranslationState()
        final_content: str | None = None
        content_parts: list[str] = []
        citations: list[dict[str, Any]] = []

        services.emit(context, "agent.started", {
            "backend": self.backend_id,
            "worker": worker_config["name"],
            "prompt_length": len(prompt),
        })
        started_at = time.time()
        baseline = _artifacts.artifact_snapshot(context.workspace_path)

        token = _artifacts.run_context.set(context)
        try:
            task = self._input_task(context, prompt)
            stream = self._stream(
                task,
                context=context,
                worker_config=worker_config,
                user_id=user_id,
                cancellation=cancellation,
            )
            async for event in stream:
                # Capture the terminal answer from the agent's own TextMessage,
                # mirroring DesktopAgentBackend: streaming deltas are the live
                # Process layer; the terminal message is the authoritative
                # answer and must not be re-joined from deltas.
                if isinstance(event, Response):
                    chat = getattr(event, "chat_message", None)
                    if isinstance(chat, TextMessage):
                        src = getattr(chat, "source", "") or ""
                        meta = getattr(chat, "metadata", None) or {}
                        if src.lower() != "user" and meta.get("internal") != "yes":
                            final_content = getattr(chat, "content", "") or ""
                elif isinstance(event, TextMessage):
                    src = getattr(event, "source", "") or ""
                    meta = getattr(event, "metadata", None) or {}
                    if src.lower() != "user" and meta.get("internal") != "yes":
                        final_content = getattr(event, "content", "") or ""

                for event_type, payload in translate_conversation_event(event, translation):
                    kind, data = self._normalize_event(context, event_type, payload)
                    if kind == "agent.message.delta":
                        content_parts.append(str(data.get("delta") or ""))
                    elif kind == "citation.added":
                        citations.append(dict(data))
                    services.emit(context, kind, data)

            _artifacts.register_new_artifacts(context, baseline, started_at, services.emit)
            content = final_content if final_content is not None else "".join(content_parts)

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
        """Encode remote input without exposing Desktop-local filesystem paths."""
        if context.remote_files or context.remote_skills:
            metadata: dict[str, str] = {}
            if context.remote_files:
                metadata["attached_files"] = json.dumps(list(context.remote_files), ensure_ascii=False)
            if context.remote_skills:
                metadata["skills"] = json.dumps(list(context.remote_skills), ensure_ascii=False)
            return TextMessage(content=prompt, source="user", metadata=metadata)

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
        worker_config: Mapping[str, str],
        user_id: str,
        cancellation: CancellationToken,
    ):
        run_info = {
            "run_id": context.run_id,
            "session_id": context.session_id,
            "trace_id": context.correlation_id or context.run_id,
            "user_id": user_id,
            "backend": self.backend_id,
        }
        if self._runner is not None:
            return self._runner(
                task,
                worker_config=worker_config,
                chat_id=context.session_id,
                run_info=run_info,
                cancellation_token=cancellation,
            )
        return _run_remote_worker_stream(
            task,
            worker_config=worker_config,
            chat_id=context.session_id,
            run_info=run_info,
            cancellation_token=cancellation,
        )

    @staticmethod
    def _normalize_event(
        context: RuntimeRunContext,
        event_type: str,
        payload: dict[str, Any],
    ) -> tuple[str, dict[str, Any]]:
        """Give every event the identity the Runtime journal needs.

        Identical contract to ``DesktopAgentBackend._normalize_event`` so the
        remote worker's events land in the same journal shape as local ones.
        """
        if event_type == "message.delta":
            delta = str(payload.get("text") or payload.get("delta") or payload.get("content") or "")
            return "agent.message.delta", {**payload, "delta": delta, "content": delta}
        if event_type in {"tool.start", "tool.complete"}:
            call_id = str(payload.get("call_id") or payload.get("tool_id") or "").strip()
            if not call_id:
                raise RuntimeExecutionError(
                    "tool_identity_missing",
                    "Remote worker emitted a Tool event without a call identity.",
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
        """Turn an arbitrary remote-worker exception into a user-facing, secret-free error."""
        from drsai.relay.security import redact_credentials

        raw = str(exc)
        safe_text = redact_credentials(raw).strip()
        diagnostic = f"{type(exc).__name__}: {safe_text}" if safe_text else type(exc).__name__
        return RuntimeExecutionError(
            "remote_worker_error",
            diagnostic,
            retryable=True,
            detail={"reason": type(exc).__name__},
        )

    # ── AgentBackend protocol ────────────────────────────────────────────

    async def cancel(self, run_id: str) -> None:
        token = self._cancellations.get(run_id)
        if token is not None:
            token.cancel()

    async def respond_approval(self, run_id: str, approval_id: str, decision: str) -> None:
        raise RuntimeExecutionError(
            "approvals_unsupported",
            "Remote worker runs do not expose approval round-trips.",
        )

    async def recover(self, run_id: str) -> None:
        return None

    async def health(self) -> Mapping[str, Any]:
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

    async def account_status(self, *, refresh: bool = False) -> Mapping[str, Any]:
        return {"backend": self.backend_id, "signed_in": True}

    async def account_login_start(self, login_type: str = "chatgpt") -> Mapping[str, Any]:
        raise RuntimeExecutionError(
            "account_login_unsupported",
            "Remote worker credentials are configured per Agent Definition, not through a login flow.",
        )

    async def account_login_cancel(self, login_id: str) -> None:
        raise RuntimeExecutionError(
            "account_login_unsupported",
            "Remote worker credentials are configured per Agent Definition, not through a login flow.",
        )

    async def account_logout(self) -> None:
        return None


async def _run_remote_worker_stream(
    task: Any,
    *,
    worker_config: Mapping[str, str],
    chat_id: str,
    run_info: Mapping[str, Any],
    cancellation_token: Any,
):
    """Drive a ``HepAIWorkerAgent`` and yield its autogen events.

    Construction mirrors WebUI's ``task_team.py`` remote branch: the worker is
    addressed by its routable model/worker name, with the url and api key kept
    server-side in ``model_remote_configs``.
    """
    from drsai.modules.agents import HepAIWorkerAgent

    agent = HepAIWorkerAgent(
        name="RemoteWorker",
        model_remote_configs={
            "url": worker_config["url"],
            "api_key": worker_config["api_key"],
            "name": worker_config["name"],
            **(
                {"defult_config_name": worker_config["model"]}
                if worker_config.get("model")
                else {}
            ),
        },
        chat_id=chat_id,
        run_info=dict(run_info),
        stream_timeout=DEFAULT_REMOTE_WORKER_TIMEOUT_SECONDS,
    )
    if hasattr(agent, "lazy_init"):
        await agent.lazy_init()
    try:
        async for event in agent.run_stream(task=task, cancellation_token=cancellation_token):
            yield event
    finally:
        if hasattr(agent, "close"):
            try:
                await agent.close()
            except Exception as exc:  # pragma: no cover - shutdown best effort
                logger.debug("remote worker close() failed: {}", exc)


def _remote_worker_config(definition: AgentDefinition) -> dict[str, str]:
    """Resolve the remote worker connection from the Agent Definition payload.

    Everything here stays server-side. ``api_key`` falls back to the platform
    credential the Runtime already holds for the active platform so a
    deployment does not have to persist a key per definition.
    """
    raw = definition.raw if isinstance(definition.raw, Mapping) else {}
    worker = raw.get("remote_worker") if isinstance(raw.get("remote_worker"), Mapping) else raw

    def pick(*keys: str) -> str:
        for key in keys:
            value = worker.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        return ""

    return {
        "url": pick("url", "base_url") or DEFAULT_REMOTE_WORKER_URL,
        "name": pick("name", "worker", "model") or definition.model or DEFAULT_REMOTE_WORKER_NAME,
        "model": pick("defult_config_name", "default_config_name", "model_alias"),
        "api_key": pick("api_key", "apikey") or _platform_api_key(),
    }


def _remote_worker_user_id() -> str:
    """The user identity the remote DDF worker keys its users on.

    Remote workers identify callers by the HepAI login email, not by the OIDC
    subject UUID. Prefer the verified ``email`` claim from the platform auth
    context, fall back to the desktop-supplied login email filled in by the
    gateway middleware (X-OpenDrSai-User-Email), and finally to the gateway's
    internal user key (offline mode returns "local").
    """
    from drsai.platform_auth import get_platform_auth

    try:
        auth = get_platform_auth()
    except Exception:
        auth = None
    email = getattr(auth, "user_email", None) if auth is not None else None
    if isinstance(email, str) and email.strip():
        return email.strip()
    return effective_user_id(None)


def _platform_api_key() -> str:
    """The HepAI/DDF credential the Runtime holds for the active platform."""
    import os

    for name in ("HEPAI_API_KEY", "OPENAI_API_KEY"):
        value = os.environ.get(name)
        if isinstance(value, str) and value.strip():
            return value.strip()
    try:
        from drsai.platform_auth import get_platform_auth

        context = get_platform_auth()
        if context is not None and context.access_token:
            return context.access_token
    except Exception:
        pass
    return ""


__all__ = ["RemoteWorkerBackend", "DEFAULT_REMOTE_WORKER_URL", "DEFAULT_REMOTE_WORKER_NAME"]
