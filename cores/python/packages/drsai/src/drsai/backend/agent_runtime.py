"""Agent execution owned by an OpenDrSai Runtime.

This module deliberately contains no HTTP or Desktop concerns.  A Runtime builds
the immutable context from its own registries, loads an exact Agent Definition
asset, and dispatches every tool in the Runtime process and Workspace.
"""

from __future__ import annotations

import json
import os
import re
import socket
import subprocess
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Awaitable, Callable, Iterable, Mapping, Protocol, Sequence

from drsai.backend.workspace_paths import WorkspacePathError, resolve_workspace_path


_ASSET_PART = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")
_RESERVED_CONTEXT_KEYS = frozenset(
    {
        "runtime_id",
        "agent_backend_runtime_id",
        "workspace_runtime_id",
        "instance_id",
        "workspace_id",
        "workspace_path",
        "session_id",
        "run_id",
        "parent_run_id",
        "correlation_id",
        "permissions",
    }
)


class RuntimeExecutionError(RuntimeError):
    """A secret-free, transport-neutral Runtime execution failure."""

    def __init__(self, code: str, message: str, *, retryable: bool = False, detail: Mapping[str, Any] | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable
        self.detail = dict(detail or {})

    def as_dict(self) -> dict[str, Any]:
        return {"code": self.code, "message": self.message, "retryable": self.retryable, "detail": self.detail}


@dataclass(frozen=True)
class RuntimeRunContext:
    runtime_id: str
    instance_id: str
    workspace_id: str
    workspace_path: Path
    session_id: str
    run_id: str
    agent_definition_id: str
    agent_definition_version: str
    permissions: frozenset[str] = field(default_factory=frozenset)
    parent_run_id: str | None = None
    correlation_id: str | None = None
    agent_backend_runtime_id: str | None = None
    workspace_runtime_id: str | None = None

    def __post_init__(self) -> None:
        backend_runtime_id = self.agent_backend_runtime_id or self.runtime_id
        workspace_runtime_id = self.workspace_runtime_id or self.runtime_id
        object.__setattr__(self, "agent_backend_runtime_id", backend_runtime_id)
        object.__setattr__(self, "workspace_runtime_id", workspace_runtime_id)
        if backend_runtime_id != workspace_runtime_id:
            raise RuntimeExecutionError(
                "distributed_backend_not_supported",
                "Agent Backend and Workspace must run in the same Full Agent Runtime.",
                detail={
                    "agent_backend_runtime_id": backend_runtime_id,
                    "workspace_runtime_id": workspace_runtime_id,
                },
            )

    def audit_fields(self) -> dict[str, Any]:
        return {
            "runtime_id": self.runtime_id,
            "agent_backend_runtime_id": self.agent_backend_runtime_id,
            "workspace_runtime_id": self.workspace_runtime_id,
            "instance_id": self.instance_id,
            "workspace_id": self.workspace_id,
            "session_id": self.session_id,
            "run_id": self.run_id,
            "parent_run_id": self.parent_run_id,
            "correlation_id": self.correlation_id,
            "agent_definition_id": self.agent_definition_id,
            "agent_definition_version": self.agent_definition_version,
        }


@dataclass(frozen=True)
class AgentDefinition:
    asset_id: str
    version: str
    backend: str
    model: str | None
    instructions: str
    permissions: frozenset[str]
    raw: Mapping[str, Any]

    @property
    def reference(self) -> str:
        return f"{self.asset_id}@{self.version}"


class AgentDefinitionStore:
    """Loads immutable, explicitly-versioned Agent Definition assets."""

    def __init__(self, root: Path, *, allowed_backends: Iterable[str] = ("opendrsai", "codex")):
        self.root = Path(root).expanduser().resolve(strict=False)
        self.allowed_backends = frozenset(str(item) for item in allowed_backends)
        if not self.allowed_backends:
            raise ValueError("At least one Agent Backend must be allowed")

    @staticmethod
    def parse_reference(reference: str) -> tuple[str, str]:
        parts = reference.rsplit("@", 1)
        if len(parts) != 2 or not all(_ASSET_PART.fullmatch(part or "") for part in parts):
            raise RuntimeExecutionError(
                "agent_definition_version_required",
                "Agent Definition must use an exact id@version reference.",
            )
        if parts[1].lower() == "latest":
            raise RuntimeExecutionError(
                "agent_definition_version_required",
                "Agent Definition must use an exact immutable version, not latest.",
            )
        return parts[0], parts[1]

    def load(self, reference: str) -> AgentDefinition:
        asset_id, version = self.parse_reference(reference)
        path = (self.root / asset_id / f"{version}.json").resolve(strict=False)
        if self.root not in path.parents:
            raise RuntimeExecutionError("agent_definition_invalid", "Agent Definition path is invalid.")
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError as exc:
            raise RuntimeExecutionError(
                "agent_definition_not_found",
                f"Agent Definition {asset_id}@{version} is not installed on this Runtime.",
            ) from exc
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise RuntimeExecutionError("agent_definition_invalid", "Agent Definition asset is invalid.") from exc
        if not isinstance(payload, dict) or payload.get("id") != asset_id or str(payload.get("version")) != version:
            raise RuntimeExecutionError("agent_definition_invalid", "Agent Definition identity does not match its asset path.")
        permissions = payload.get("permissions", [])
        if not isinstance(permissions, list) or not all(isinstance(item, str) and item for item in permissions):
            raise RuntimeExecutionError("agent_definition_invalid", "Agent Definition permissions are invalid.")
        backend = payload.get("backend")
        if not isinstance(backend, str) or backend not in self.allowed_backends:
            raise RuntimeExecutionError(
                "agent_backend_invalid",
                "Agent Definition references an unsupported Agent Backend.",
            )
        return AgentDefinition(
            asset_id=asset_id,
            version=version,
            backend=backend,
            model=str(payload["model"]) if payload.get("model") else None,
            instructions=str(payload.get("instructions") or ""),
            permissions=frozenset(permissions),
            raw=payload,
        )


class RuntimeState(Protocol):
    identity: Any

    def get_run(self, run_id: str) -> dict[str, Any]: ...
    def transition_run(self, run_id: str, status: str) -> dict[str, Any]: ...
    def append_event(self, run_id: str, event_type: str, data: dict[str, Any]) -> dict[str, Any]: ...
    def append_backend_event(self, run_id: str, event_type: str, data: dict[str, Any], backend_event_key: str) -> dict[str, Any]: ...
    def create_run(
        self, session_id: str, agent_definition: str, idempotency_key: str, backend_id: str = "opendrsai"
    ) -> tuple[dict[str, Any], bool]: ...
    def mark_cancel_requested(self, run_id: str) -> dict[str, Any]: ...


class WorkspaceState(Protocol):
    def get_workspace(self, workspace_id: str, *, include_closed: bool = False) -> Any: ...


class AgentBackend(Protocol):
    """Replaceable execution backend contract used by RuntimeAgentService."""

    backend_id: str

    async def execute(
        self,
        context: RuntimeRunContext,
        definition: AgentDefinition,
        prompt: str,
        services: "AgentExecutionServices",
    ) -> dict[str, Any]: ...

    async def cancel(self, run_id: str) -> None: ...

    async def respond_approval(self, run_id: str, approval_id: str, decision: str) -> None: ...

    async def recover(self, run_id: str) -> None: ...

    async def health(self) -> Mapping[str, Any]: ...

    async def close(self) -> None: ...

    async def account_status(self, *, refresh: bool = False) -> Mapping[str, Any]: ...
    async def account_login_start(self, login_type: str = "chatgpt") -> Mapping[str, Any]: ...
    async def account_login_cancel(self, login_id: str) -> None: ...
    async def account_logout(self) -> None: ...


class AgentBackendRouter:
    """Exact Backend routing and process-lifetime ownership; never falls back."""

    def __init__(self, backends: Mapping[str, AgentBackend]):
        self._backends = dict(backends)
        if not self._backends:
            raise ValueError("At least one Agent Backend must be registered")
        for backend_id, backend in self._backends.items():
            if not backend_id or backend.backend_id != backend_id:
                raise ValueError("Agent Backend registration identity does not match")
        self._closed = False

    @property
    def backend_ids(self) -> tuple[str, ...]:
        return tuple(sorted(self._backends))

    def require(self, backend_id: str) -> AgentBackend:
        if self._closed:
            raise RuntimeExecutionError("agent_backend_service_closed", "Agent Backend Router is closed.")
        backend = self._backends.get(backend_id)
        if backend is None:
            raise RuntimeExecutionError("agent_backend_not_found", f"Agent backend {backend_id} is not installed.")
        return backend

    async def health(self) -> dict[str, Mapping[str, Any]]:
        return {backend_id: await backend.health() for backend_id, backend in self._backends.items()}

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        seen: set[int] = set()
        for backend in self._backends.values():
            if id(backend) not in seen:
                seen.add(id(backend))
                await backend.close()


@dataclass(frozen=True)
class ModelIdentity:
    subject: str
    expires_at: int


class HAIModelAdapter:
    """Binds an OIDC identity to a model call and normalizes provider errors."""

    def __init__(
        self,
        invoke: Callable[[str, AgentDefinition, RuntimeRunContext, Sequence[Mapping[str, Any]]], Mapping[str, Any]],
        identity: ModelIdentity | None,
        classify_error: Callable[[Exception], Mapping[str, Any]] | None = None,
    ):
        self.invoke = invoke
        self.identity = identity
        self.classify_error = classify_error or _classify_model_error

    def __call__(
        self,
        prompt: str,
        definition: AgentDefinition,
        context: RuntimeRunContext,
        history: Sequence[Mapping[str, Any]],
    ) -> Mapping[str, Any]:
        if self.identity is None or not self.identity.subject:
            raise RuntimeExecutionError("model_unauthorized", "A valid HepAI identity is required.")
        if self.identity.expires_at <= int(time.time()):
            raise RuntimeExecutionError("token_expired", "Your HepAI session expired.", retryable=True)
        try:
            return self.invoke(prompt, definition, context, history)
        except RuntimeExecutionError:
            raise
        except Exception as exc:
            mapped = self.classify_error(exc)
            raise RuntimeExecutionError(
                str(mapped.get("code", "upstream_unavailable")),
                str(mapped.get("message", "The model service is temporarily unavailable.")),
                retryable=bool(mapped.get("retryable", True)),
            ) from exc


def _classify_model_error(error: Exception) -> Mapping[str, Any]:
    # Import lazily so the execution core remains independently testable.
    from drsai.platform_auth import classify_model_error

    return classify_model_error(error)


ToolHandler = Callable[[RuntimeRunContext, Mapping[str, Any]], Mapping[str, Any]]


class RuntimeToolDispatcher:
    """Dispatches Tool/Skill/MCP/process work inside one Runtime Workspace."""

    def __init__(
        self,
        state: RuntimeState,
        *,
        tools: Mapping[str, ToolHandler] | None = None,
        skills: Mapping[str, ToolHandler] | None = None,
        mcp_servers: Mapping[str, ToolHandler] | None = None,
    ):
        self.state = state
        self.tools = dict(tools or {})
        self.skills = dict(skills or {})
        self.mcp_servers = dict(mcp_servers or {})

    def dispatch(self, context: RuntimeRunContext, kind: str, name: str, arguments: Mapping[str, Any]) -> dict[str, Any]:
        self._validate_arguments(arguments)
        permission = f"{kind}:{name}"
        broad_permission = f"{kind}:*"
        if permission not in context.permissions and broad_permission not in context.permissions:
            raise RuntimeExecutionError("permission_denied", f"Run is not permitted to invoke {kind}:{name}.")
        call_id = f"call-{uuid.uuid4()}"
        audit = {**context.audit_fields(), "call_id": call_id, "kind": kind, "name": name}
        self.state.append_event(context.run_id, "tool.started", audit)
        try:
            if kind in {"shell", "process", "test"}:
                result = self._run_process(context, arguments)
            else:
                registry = {"tool": self.tools, "skill": self.skills, "mcp": self.mcp_servers}.get(kind)
                if registry is None or name not in registry:
                    raise RuntimeExecutionError("tool_not_found", f"Runtime {kind} {name} is not registered.")
                result = dict(registry[name](context, arguments))
            event = {**audit, "result": _safe_result(result)}
            self.state.append_event(context.run_id, "tool.completed", event)
            return {"call_id": call_id, **result}
        except RuntimeExecutionError as exc:
            self.state.append_event(context.run_id, "tool.failed", {**audit, "error": exc.as_dict()})
            raise
        except Exception as exc:
            error = RuntimeExecutionError("tool_failed", f"Runtime {kind} execution failed.")
            self.state.append_event(context.run_id, "tool.failed", {**audit, "error": error.as_dict()})
            raise error from exc

    @staticmethod
    def _validate_arguments(arguments: Mapping[str, Any]) -> None:
        overwritten = sorted(_RESERVED_CONTEXT_KEYS.intersection(arguments))
        if overwritten:
            raise RuntimeExecutionError(
                "run_context_override_rejected",
                "Model-provided arguments cannot override Runtime Run Context.",
                detail={"fields": overwritten},
            )

    @staticmethod
    def _cwd(context: RuntimeRunContext, value: Any) -> Path:
        root = context.workspace_path.resolve(strict=True)
        relative = "." if value in {None, "", "."} else str(value)
        try:
            candidate = resolve_workspace_path(root, relative, strict=True)
        except WorkspacePathError as exc:
            raise RuntimeExecutionError(exc.code, str(exc)) from exc
        if not candidate.is_dir():
            raise RuntimeExecutionError("workspace_path_invalid", "Command cwd is not a directory.")
        return candidate

    def _run_process(self, context: RuntimeRunContext, arguments: Mapping[str, Any]) -> dict[str, Any]:
        command = arguments.get("command")
        if not isinstance(command, list) or not command or not all(isinstance(part, str) and part for part in command):
            raise RuntimeExecutionError("command_invalid", "Runtime commands must be a non-empty argv array.")
        cwd = self._cwd(context, arguments.get("cwd"))
        timeout = min(max(float(arguments.get("timeout_seconds", 30)), 0.1), 300.0)
        env = os.environ.copy()
        supplied_env = arguments.get("env", {})
        if not isinstance(supplied_env, dict) or not all(isinstance(key, str) and isinstance(value, str) for key, value in supplied_env.items()):
            raise RuntimeExecutionError("command_invalid", "Runtime command environment must contain string pairs.")
        env.update(supplied_env)
        try:
            completed = subprocess.run(
                command,
                cwd=cwd,
                env=env,
                capture_output=True,
                text=True,
                timeout=timeout,
                shell=False,
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise RuntimeExecutionError("command_timeout", "Runtime command timed out.", retryable=True) from exc
        except OSError as exc:
            raise RuntimeExecutionError("command_start_failed", "Runtime command could not be started.") from exc
        return {
            "exit_code": completed.returncode,
            "stdout": completed.stdout,
            "stderr": completed.stderr,
            "hostname": socket.gethostname(),
            "cwd": str(cwd),
        }


@dataclass
class AgentExecutionServices:
    state: RuntimeState
    dispatcher: RuntimeToolDispatcher
    run_subagent: Callable[[RuntimeRunContext, Mapping[str, Any]], Awaitable[Mapping[str, Any]]]

    def emit(self, context: RuntimeRunContext, event_type: str, data: Mapping[str, Any]) -> dict[str, Any]:
        return self.state.append_event(context.run_id, event_type, {**context.audit_fields(), **dict(data)})

    def emit_backend(
        self, context: RuntimeRunContext, event_type: str, data: Mapping[str, Any], backend_event_key: str,
    ) -> dict[str, Any]:
        payload = {**context.audit_fields(), **dict(data)}
        append = getattr(self.state, "append_backend_event", None)
        if append is None:
            return self.state.append_event(context.run_id, event_type, payload)
        return append(context.run_id, event_type, payload, backend_event_key)


class OpenDrSaiAgentBackend:
    """V1 OpenDrSai Agent Loop backend with unified Runtime Events."""

    backend_id = "opendrsai"

    def __init__(
        self,
        model: Callable[[str, AgentDefinition, RuntimeRunContext, Sequence[Mapping[str, Any]]], Mapping[str, Any]],
        *,
        max_turns: int = 8,
    ):
        self.model = model
        self.max_turns = max(1, min(max_turns, 64))
        self._closed = False
        self._cancelled_runs: set[str] = set()

    async def execute(
        self,
        context: RuntimeRunContext,
        definition: AgentDefinition,
        prompt: str,
        services: AgentExecutionServices,
    ) -> dict[str, Any]:
        if self._closed:
            raise RuntimeExecutionError("agent_backend_closed", "OpenDrSai Agent Backend is closed.")
        history: list[Mapping[str, Any]] = []
        services.emit(context, "agent.started", {"backend": self.backend_id, "prompt_length": len(prompt)})
        for turn in range(1, self.max_turns + 1):
            if context.run_id in self._cancelled_runs:
                raise RuntimeExecutionError("run_cancelled", "Run was cancelled.")
            response = self.model(prompt, definition, context, tuple(history))
            if not isinstance(response, Mapping):
                raise RuntimeExecutionError("model_response_invalid", "Model response is not a structured Agent turn.")
            calls = response.get("calls", [])
            if not isinstance(calls, list):
                raise RuntimeExecutionError("model_response_invalid", "Model calls must be a list.")
            turn_results: list[Mapping[str, Any]] = []
            for call in calls:
                if not isinstance(call, Mapping):
                    raise RuntimeExecutionError("model_response_invalid", "Model call is invalid.")
                kind, name = str(call.get("kind") or "tool"), str(call.get("name") or "")
                arguments = call.get("arguments", {})
                if not isinstance(arguments, Mapping):
                    raise RuntimeExecutionError("model_response_invalid", "Model call arguments are invalid.")
                if kind == "subagent":
                    result = dict(await services.run_subagent(context, call))
                else:
                    result = services.dispatcher.dispatch(context, kind, name, arguments)
                turn_results.append({"kind": kind, "name": name, "result": _safe_result(result)})
            content = str(response.get("content") or "")
            if content:
                services.emit(context, "agent.message.delta", {"turn": turn, "content": content})
            history.append({"turn": turn, "content": content, "results": turn_results})
            if bool(response.get("done", not calls)):
                result = {"content": content, "turns": turn, "history": history}
                services.emit(context, "agent.completed", {"turns": turn, "content": content})
                return result
        raise RuntimeExecutionError("agent_turn_limit", "Agent Loop reached its turn limit.")

    async def cancel(self, run_id: str) -> None:
        self._cancelled_runs.add(run_id)

    async def respond_approval(self, run_id: str, approval_id: str, decision: str) -> None:
        raise RuntimeExecutionError(
            "approval_not_supported",
            "OpenDrSai Agent Backend does not own an external approval request.",
        )

    async def recover(self, run_id: str) -> None:
        if self._closed:
            raise RuntimeExecutionError("agent_backend_closed", "OpenDrSai Agent Backend is closed.")

    async def health(self) -> Mapping[str, Any]:
        return {
            "backend_id": self.backend_id,
            "available": not self._closed,
            "reason": "closed" if self._closed else None,
        }

    async def close(self) -> None:
        self._closed = True
        self._cancelled_runs.clear()


class RuntimeAgentService:
    """Builds authoritative contexts and invokes replaceable Runtime backends."""

    def __init__(
        self,
        state: RuntimeState,
        workspaces: WorkspaceState,
        definitions: AgentDefinitionStore,
        dispatcher: RuntimeToolDispatcher,
        backends: Mapping[str, AgentBackend],
        *,
        default_backend: str = "opendrsai",
    ):
        self.state = state
        self.workspaces = workspaces
        self.definitions = definitions
        self.dispatcher = dispatcher
        self.router = AgentBackendRouter(backends)
        self.backends = dict(backends)
        self.default_backend = default_backend
        if default_backend not in self.backends:
            raise ValueError("Default Agent Backend is not registered")
        self._closed = False

    async def execute(self, run_id: str, prompt: str, correlation_id: str | None = None) -> dict[str, Any]:
        if self._closed:
            raise RuntimeExecutionError("agent_backend_service_closed", "Agent Backend service is closed.")
        run = self.state.get_run(run_id)
        definition = self.definitions.load(str(run["agent_definition"]))
        if str(run.get("backend_id") or "") != definition.backend:
            raise RuntimeExecutionError(
                "run_backend_binding_mismatch",
                "Run Agent Backend binding does not match its Agent Definition.",
            )
        context = self._context(run, definition, correlation_id=correlation_id)
        backend = self.router.require(definition.backend)
        if run["status"] == "queued":
            self.state.transition_run(run_id, "running")
        elif run["status"] != "running":
            raise RuntimeExecutionError("run_not_executable", f"Run in state {run['status']} cannot execute.")
        services = AgentExecutionServices(self.state, self.dispatcher, self._run_subagent)
        try:
            result = await backend.execute(context, definition, prompt, services)
            if self.state.get_run(run_id)["status"] == "running":
                self.state.transition_run(run_id, "completed")
            return {"run": self.state.get_run(run_id), "result": result, "context": context.audit_fields()}
        except Exception as exc:
            error = exc if isinstance(exc, RuntimeExecutionError) else RuntimeExecutionError("agent_execution_failed", "Agent execution failed.")
            self.state.append_event(run_id, "agent.failed", {**context.audit_fields(), "error": error.as_dict()})
            if self.state.get_run(run_id)["status"] == "running":
                self.state.transition_run(run_id, "cancelled" if error.code == "run_cancelled" else "failed")
            raise error from exc

    async def cancel(self, run_id: str) -> dict[str, Any]:
        run = self.state.get_run(run_id)
        if run["status"] in {"completed", "cancelled", "failed"}:
            return run
        marker = getattr(self.state, "mark_cancel_requested", None)
        if marker is not None:
            marker(run_id)
        backend = self._backend_for_run(run_id)
        await backend.cancel(run_id)
        return self.state.cancel_run(run_id)

    async def respond_approval(self, run_id: str, approval_id: str, decision: str) -> None:
        await self._backend_for_run(run_id).respond_approval(run_id, approval_id, decision)

    async def recover(self, run_id: str) -> None:
        await self._backend_for_run(run_id).recover(run_id)

    async def health(self) -> dict[str, Mapping[str, Any]]:
        return await self.router.health()

    async def backend_account_status(self, backend_id: str, *, refresh: bool = False) -> dict[str, Any]:
        backend = self.router.require(backend_id)
        operation = getattr(backend, "account_status", None)
        if operation is None:
            raise RuntimeExecutionError("backend_account_unsupported", f"Agent Backend {backend_id} has no managed account.")
        return dict(await operation(refresh=refresh))

    async def backend_account_login_start(self, backend_id: str, login_type: str = "chatgpt") -> dict[str, Any]:
        backend = self.router.require(backend_id)
        operation = getattr(backend, "account_login_start", None)
        if operation is None:
            raise RuntimeExecutionError("backend_account_unsupported", f"Agent Backend {backend_id} has no managed account.")
        return dict(await operation(login_type))

    async def backend_account_login_cancel(self, backend_id: str, login_id: str) -> None:
        backend = self.router.require(backend_id)
        operation = getattr(backend, "account_login_cancel", None)
        if operation is None:
            raise RuntimeExecutionError("backend_account_unsupported", f"Agent Backend {backend_id} has no managed account.")
        await operation(login_id)

    async def backend_account_logout(self, backend_id: str) -> None:
        backend = self.router.require(backend_id)
        operation = getattr(backend, "account_logout", None)
        if operation is None:
            raise RuntimeExecutionError("backend_account_unsupported", f"Agent Backend {backend_id} has no managed account.")
        await operation()

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        await self.router.close()

    def _backend_for_run(self, run_id: str) -> AgentBackend:
        run = self.state.get_run(run_id)
        definition = self.definitions.load(str(run["agent_definition"]))
        return self.router.require(definition.backend)

    def _context(
        self,
        run: Mapping[str, Any],
        definition: AgentDefinition,
        *,
        parent: RuntimeRunContext | None = None,
        correlation_id: str | None = None,
    ) -> RuntimeRunContext:
        record = self.workspaces.get_workspace(str(run["workspace_id"]), include_closed=True)
        if record is None or not getattr(record, "open", False):
            raise RuntimeExecutionError("workspace_not_open", "Run Workspace is not open on this Runtime.")
        runtime_id = str(run["runtime_id"])
        instance_id = str(run["instance_id"])
        if runtime_id != str(self.state.identity.runtime_id) or instance_id != str(self.state.identity.instance_id):
            raise RuntimeExecutionError("runtime_identity_mismatch", "Run does not belong to this Runtime instance.")
        permissions = definition.permissions if parent is None else definition.permissions.intersection(parent.permissions)
        return RuntimeRunContext(
            runtime_id=runtime_id,
            agent_backend_runtime_id=runtime_id,
            workspace_runtime_id=runtime_id,
            instance_id=instance_id,
            workspace_id=str(run["workspace_id"]),
            workspace_path=Path(record.path).resolve(strict=True),
            session_id=str(run["session_id"]),
            run_id=str(run["run_id"]),
            agent_definition_id=definition.asset_id,
            agent_definition_version=definition.version,
            permissions=frozenset(permissions),
            parent_run_id=parent.run_id if parent else None,
            correlation_id=parent.correlation_id if parent else correlation_id,
        )

    async def _run_subagent(self, parent: RuntimeRunContext, call: Mapping[str, Any]) -> Mapping[str, Any]:
        arguments = call.get("arguments", {})
        if not isinstance(arguments, Mapping):
            raise RuntimeExecutionError("subagent_request_invalid", "Subagent arguments are invalid.")
        forbidden = sorted((_RESERVED_CONTEXT_KEYS - {"workspace_id", "permissions"}).intersection(arguments))
        if forbidden:
            raise RuntimeExecutionError(
                "run_context_override_rejected",
                "Subagent arguments cannot override Runtime Run Context.",
                detail={"fields": forbidden},
            )
        requested_workspace = arguments.get("workspace_id")
        if requested_workspace is not None and requested_workspace != parent.workspace_id:
            raise RuntimeExecutionError("workspace_escape_rejected", "Subagent must inherit its parent Workspace.")
        reference = str(arguments.get("agent_definition") or call.get("name") or "")
        definition = self.definitions.load(reference)
        requested_permissions = arguments.get("permissions")
        if requested_permissions is not None:
            if not isinstance(requested_permissions, list) or not set(requested_permissions).issubset(parent.permissions):
                raise RuntimeExecutionError("permission_escalation_rejected", "Subagent cannot gain permissions from its parent.")
        child_run, _ = self.state.create_run(
            parent.session_id,
            reference,
            f"subagent:{parent.run_id}:{uuid.uuid4()}",
            definition.backend,
        )
        child_context = self._context(child_run, definition, parent=parent)
        backend = self.router.require(definition.backend)
        self.state.append_event(parent.run_id, "subagent.started", {**parent.audit_fields(), "child_run_id": child_context.run_id})
        self.state.transition_run(child_context.run_id, "running")
        services = AgentExecutionServices(self.state, self.dispatcher, self._run_subagent)
        result = await backend.execute(child_context, definition, str(arguments.get("prompt") or ""), services)
        self.state.transition_run(child_context.run_id, "completed")
        self.state.append_event(
            parent.run_id,
            "subagent.completed",
            {**parent.audit_fields(), "child_run_id": child_context.run_id, "child_parent_run_id": child_context.parent_run_id},
        )
        return {"run_id": child_context.run_id, "parent_run_id": parent.run_id, "result": result}


def _safe_result(value: Mapping[str, Any]) -> dict[str, Any]:
    blocked = re.compile(r"(?:token|password|secret|private.?key|authorization|api.?key|credential)", re.I)
    bearer = re.compile(r"(?i)Bearer\s+[A-Za-z0-9._~+/=-]+")
    private_key = re.compile(r"-----BEGIN [^-]*PRIVATE KEY-----.*?-----END [^-]*PRIVATE KEY-----", re.S)

    def clean(item: Any, key: str = "") -> Any:
        if blocked.search(key):
            return "[REDACTED]"
        if isinstance(item, Mapping):
            return {str(child_key): clean(child, str(child_key)) for child_key, child in item.items()}
        if isinstance(item, (list, tuple)):
            return [clean(child) for child in item]
        if isinstance(item, str):
            return private_key.sub("[REDACTED PRIVATE KEY]", bearer.sub("Bearer [REDACTED]", item))
        return item

    return clean(value)
