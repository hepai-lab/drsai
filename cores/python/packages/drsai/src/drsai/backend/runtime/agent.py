"""Agent execution owned by an OpenDrSai Runtime.

This module deliberately contains no HTTP or Desktop concerns.  A Runtime builds
the immutable context from its own registries, loads an exact Agent Definition
asset, and dispatches every tool in the Runtime process and Workspace.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import re
import socket
import threading
import time
import traceback
import uuid
from datetime import UTC, datetime, timedelta
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any, Awaitable, Callable, Iterable, Mapping, Protocol, Sequence

from drsai.backend.workspace.paths import WorkspacePathError, resolve_workspace_path
from drsai.backend.runtime.normalized_events import (
    BackendBinding,
    NormalizedAgentEvent,
    NormalizedDeltaKind,
    NormalizedEventKind,
    NormalizedItemType,
)
from drsai.backend.runtime.evidence import (
    agent_definition_evidence,
    backend_runtime_evidence,
    workspace_revision_evidence,
)
from drsai.version import __version__ as DRS_AI_VERSION


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
        from drsai.backend.runtime.error_contract import error_envelope
        envelope = error_envelope(self.code, retryable=self.retryable, details=self.detail)
        return {**envelope, "message": self.message, "detail": envelope["redacted_details"]}


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
    input_resources: tuple[Mapping[str, Any], ...] = field(default_factory=tuple)
    model_override_requested: bool = False

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
            "input_resource_count": len(self.input_resources),
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
    reasoning_effort: str | None = None
    # Request-scoped effective model binding. The Gateway populates these
    # after resolving a canonical ModelRef; definition assets never persist it.
    model_provider: str | None = None
    model_id: str | None = None
    model_config_revision: str | None = None
    model_catalog_revision: str | None = None

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
    def list_session_runs(self, session_id: str) -> list[dict[str, Any]]: ...
    def transition_run(
        self,
        run_id: str,
        status: str,
        *,
        reason: str | None = None,
        error: dict[str, Any] | None = None,
    ) -> dict[str, Any]: ...
    def append_event(self, run_id: str, event_type: str, data: dict[str, Any]) -> dict[str, Any]: ...
    def append_backend_event(self, run_id: str, event_type: str, data: dict[str, Any], backend_event_key: str) -> dict[str, Any]: ...
    def append_normalized_event(
        self, run_id: str, event: "NormalizedAgentEvent", audit: Mapping[str, Any]
    ) -> dict[str, Any]: ...
    def create_run(
        self, session_id: str, agent_definition: str, idempotency_key: str,
        backend_id: str = "opendrsai", parent_run_id: str | None = None,
    ) -> tuple[dict[str, Any], bool]: ...
    def mark_cancel_requested(self, run_id: str) -> dict[str, Any]: ...
    def request_approval(self, run_id: str, request: dict[str, Any], deadline_at: str | None = None) -> dict[str, Any]: ...
    def get_approval(self, approval_id: str) -> dict[str, Any]: ...
    def resolve_approval(self, approval_id: str, decision: str, detail: dict[str, Any] | None = None,
                         *, resume_on_denied: bool = False) -> dict[str, Any]: ...
    def get_side_effect(self, approval_id: str) -> dict[str, Any]: ...
    def claim_side_effect(self, approval_id: str, run_id: str, operation: str, *, recovered: bool = False) -> dict[str, Any]: ...
    def complete_side_effect(self, approval_id: str, result: Mapping[str, Any]) -> dict[str, Any]: ...
    def fail_side_effect(self, approval_id: str, error_code: str) -> dict[str, Any]: ...


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


_AGENT_BACKEND_HEALTH_TIMEOUT_SECONDS = 5.0


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
        async def bounded(backend_id: str, backend: AgentBackend) -> tuple[str, Mapping[str, Any]]:
            try:
                value = await asyncio.wait_for(
                    backend.health(),
                    timeout=_AGENT_BACKEND_HEALTH_TIMEOUT_SECONDS,
                )
            except TimeoutError:
                value = {
                    "backend_id": backend_id,
                    "available": False,
                    "reason": "health_timeout",
                }
            except Exception:
                # Health is a catalog/diagnostic projection. One optional
                # backend must not take the Runtime directory down with it,
                # and exception text can contain local paths or credentials.
                value = {
                    "backend_id": backend_id,
                    "available": False,
                    "reason": "health_check_failed",
                }
            return backend_id, value

        rows = await asyncio.gather(*(
            bounded(backend_id, backend)
            for backend_id, backend in self._backends.items()
        ))
        return dict(rows)

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
        self._replay_results: dict[str, list[dict[str, Any]]] = {}
        self._replay_passthrough: dict[str, list[dict[str, Any]]] = {}
        self._replay_guarded_runs: set[str] = set()
        self._regression_invocations: dict[tuple[str, str], int] = {}
        self._operation_lock = threading.RLock()
        self._active_processes: dict[str, tuple[Any, str]] = {}
        self._cancelled_runs: set[str] = set()

    def cancel_run(self, run_id: str) -> None:
        """Stop an active OWOP process before its owning execution task is cancelled."""
        with self._operation_lock:
            self._cancelled_runs.add(run_id)
            active = self._active_processes.pop(run_id, None)
        if active is None:
            return
        provider, process_id = active
        try:
            provider.process_kill({"process_id": process_id, "tree": True})
        finally:
            provider.close()

    def has_active_operations(self, run_id: str) -> bool:
        with self._operation_lock:
            return run_id in self._active_processes

    def install_replay_results(
        self, run_id: str, entries: Sequence[Mapping[str, Any]],
        allowed_reexecute: Sequence[Mapping[str, Any]] = (),
    ) -> None:
        """Install one-shot, evidence-bound Pure Tool results for a Replay Run."""
        installed: list[dict[str, Any]] = []
        for entry in entries:
            result = entry.get("result")
            arguments = entry.get("arguments")
            if not isinstance(result, Mapping) or not isinstance(arguments, Mapping):
                raise RuntimeExecutionError(
                    "pure_tool_reuse_evidence_invalid",
                    "Pure Tool replay requires a structured historical result and arguments.",
                )
            installed.append({
                "kind": str(entry.get("kind") or "tool"),
                "name": str(entry.get("name") or ""),
                "arguments": dict(arguments),
                "result": dict(result),
                "source_event_id": str(entry.get("source_event_id") or ""),
            })
        passthrough: list[dict[str, Any]] = []
        for entry in allowed_reexecute:
            arguments = entry.get("arguments")
            if not isinstance(arguments, Mapping):
                raise RuntimeExecutionError(
                    "replay_tool_call_binding_invalid",
                    "Safe Tool re-execution requires the reviewed structured arguments.",
                )
            passthrough.append({
                "kind": str(entry.get("kind") or "tool"),
                "name": str(entry.get("name") or ""),
                "arguments": dict(arguments),
                "input_digest": str(entry.get("input_digest") or ""),
                "implementation_digest": str(entry.get("implementation_digest") or ""),
                "schema_digest": str(entry.get("schema_digest") or ""),
                "classification": str(entry.get("classification") or ""),
                "policy_version": str(entry.get("policy_version") or ""),
            })
        self._replay_results[run_id] = installed
        self._replay_passthrough[run_id] = passthrough
        self._replay_guarded_runs.add(run_id)

    def assert_replay_results_consumed(self, run_id: str) -> None:
        if self._replay_results.get(run_id):
            raise RuntimeExecutionError(
                "pure_tool_reuse_not_consumed",
                "Replay completed without consuming every reviewed Pure Tool result.",
            )

    def clear_replay_results(self, run_id: str) -> None:
        self._replay_results.pop(run_id, None)
        self._replay_passthrough.pop(run_id, None)
        self._replay_guarded_runs.discard(run_id)

    def dispatch(
        self, context: RuntimeRunContext, kind: str, name: str, arguments: Mapping[str, Any],
        *, approval_id: str | None = None, recovered: bool = False,
    ) -> dict[str, Any]:
        self._validate_arguments(arguments)
        phase_marker = getattr(self.state, "mark_replay_execution_phase", None)
        if callable(phase_marker):
            phase_marker(context.run_id, "tool_execution")
        permission = f"{kind}:{name}"
        broad_permission = f"{kind}:*"
        if permission not in context.permissions and broad_permission not in context.permissions:
            raise RuntimeExecutionError("permission_denied", f"Run is not permitted to invoke {kind}:{name}.")
        call_id = f"call-{uuid.uuid4()}"
        operation_id = f"operation-{uuid.uuid4()}"
        correlation_id = context.correlation_id or f"correlation-{uuid.uuid4()}"
        audit = {
            **context.audit_fields(),
            "call_id": call_id,
            "operation_id": operation_id,
            "kind": kind,
            "name": name,
            "arguments": dict(arguments),
        }
        side_effect: dict[str, Any] | None = None
        if approval_id:
            try:
                side_effect = self.state.get_side_effect(approval_id)
                allowed_operations = {permission, f"{kind}.{name}", name}
                if str(side_effect["operation"]) not in allowed_operations:
                    raise ValueError("Side effect approval does not match this operation")
                side_effect = self.state.claim_side_effect(
                    approval_id, context.run_id, str(side_effect["operation"]), recovered=recovered,
                )
                audit["side_effect"] = {
                    "effect_id": side_effect["effect_id"],
                    "approval_id": approval_id,
                    "idempotency_key": side_effect["idempotency_key"],
                    "recovered": recovered,
                }
            except (KeyError, ValueError) as exc:
                raise RuntimeExecutionError("side_effect_not_executable", str(exc)) from exc
        if kind in {"shell", "process", "test"}:
            command = arguments.get("command")
            if isinstance(command, list):
                audit["command"] = [str(part) for part in command]
                audit["display_command"] = " ".join(str(part) for part in command)
            audit["cwd"] = str(arguments.get("cwd") or ".")
            audit["operation_ref"] = {
                "protocol": "owop/1",
                "operation_id": operation_id,
                "workspace_id": context.workspace_id,
                "operation": "process.start",
                "correlation_id": correlation_id,
            }
        self.state.append_event(context.run_id, "tool.started", audit)
        try:
            replay = next((entry for entry in self._replay_results.get(context.run_id, [])
                           if entry["kind"] == kind and entry["name"] == name
                           and entry["arguments"] == dict(arguments)), None)
            passthrough = next((entry for entry in self._replay_passthrough.get(context.run_id, [])
                                if entry["kind"] == kind and entry["name"] == name
                                and entry["arguments"] == dict(arguments)), None)
            if replay is not None:
                self._replay_results[context.run_id].remove(replay)
                result = dict(replay["result"])
                audit["reused_from_event_id"] = replay["source_event_id"]
                audit["replay_decision"] = "reuse"
            elif passthrough is not None:
                self._replay_passthrough[context.run_id].remove(passthrough)
                registry = {"tool": self.tools, "skill": self.skills, "mcp": self.mcp_servers}.get(kind)
                if registry is None or name not in registry:
                    raise RuntimeExecutionError("tool_not_found", f"Runtime {kind} {name} is not registered.")
                result = dict(registry[name](context, arguments))
                audit["replay_decision"] = "reexecute"
            elif context.run_id in self._replay_guarded_runs:
                raise RuntimeExecutionError(
                    "replay_tool_call_mismatch",
                    "Replay attempted a Tool call that does not match any reviewed Tool invocation.",
                )
            elif (controlled := self._regression_result(context, kind, name, arguments, audit)) is not None:
                result = controlled
            elif kind in {"shell", "process", "test"}:
                result = self._run_process(
                    context,
                    arguments,
                    operation_id=operation_id,
                    correlation_id=correlation_id,
                )
            else:
                registry = {"tool": self.tools, "skill": self.skills, "mcp": self.mcp_servers}.get(kind)
                if registry is None or name not in registry:
                    raise RuntimeExecutionError("tool_not_found", f"Runtime {kind} {name} is not registered.")
                result = dict(registry[name](context, arguments))
            replay_policy = result.pop("_replay_policy", None) if isinstance(result.get("_replay_policy"), Mapping) else None
            file_changes = result.pop("_runtime_file_changes", None)
            if isinstance(file_changes, list) and all(isinstance(item, Mapping) for item in file_changes):
                self.state.append_event(context.run_id, "agent.item.file_change", {
                    "item_id": f"file-change:{call_id}",
                    "phase": "completed",
                    "item": {
                        "id": f"file-change:{call_id}",
                        "type": "file_change",
                        "summary": f"Recorded {len(file_changes)} candidate file changes.",
                        "changes": [dict(item) for item in file_changes],
                    },
                })
            event = {**audit, "result": _safe_result(result)}
            if isinstance(result.get("resource_refs"), list):
                event["resource_refs"] = list(result["resource_refs"])
            if approval_id:
                try:
                    self.state.complete_side_effect(approval_id, result)
                except ValueError as exc:
                    raise RuntimeExecutionError(
                        "side_effect_outcome_unknown",
                        "The side effect completed but its durable receipt could not be committed; automatic replay is blocked.",
                    ) from exc
            completed = self.state.append_event(context.run_id, "tool.completed", event)
            recorder = getattr(self.state, "record_tool_replay_evidence", None)
            if replay_policy is not None and recorder is not None:
                recorder(
                    context.run_id, call_id, str(completed["event_id"]), arguments, result,
                    {**dict(replay_policy), "source_event_id": str(completed["event_id"])},
                )
            return {"call_id": call_id, "operation_id": operation_id, **result}
        except RuntimeExecutionError as exc:
            if approval_id and side_effect is not None and exc.code != "side_effect_outcome_unknown":
                try:
                    self.state.fail_side_effect(approval_id, exc.code)
                except ValueError:
                    pass
            self.state.append_event(context.run_id, "tool.failed", {**audit, "error": exc.as_dict()})
            raise
        except Exception as exc:
            error = RuntimeExecutionError("tool_failed", f"Runtime {kind} execution failed.")
            if approval_id and side_effect is not None:
                try:
                    self.state.fail_side_effect(approval_id, error.code)
                except ValueError:
                    pass
            self.state.append_event(context.run_id, "tool.failed", {**audit, "error": error.as_dict()})
            raise error from exc

    def _regression_result(
        self, context: RuntimeRunContext, kind: str, name: str,
        arguments: Mapping[str, Any], audit: Mapping[str, Any],
    ) -> dict[str, Any] | None:
        control: dict[str, Any] | None = None
        for resource in context.input_resources:
            if resource.get("kind") == "selection" and resource.get("name") == "OpenDrSai regression control":
                try:
                    value = json.loads(str(resource.get("content") or ""))
                except json.JSONDecodeError as exc:
                    raise RuntimeExecutionError("regression_control_invalid", "Regression control is not valid JSON.") from exc
                if not isinstance(value, dict) or value.get("schema_version") != "opendrsai.regression-control/1":
                    raise RuntimeExecutionError("regression_control_invalid", "Regression control schema is invalid.")
                control = value
                break
        if control is None:
            return None
        capability = name if kind in {"tool", "skill"} else f"{kind}:{name}"
        if capability in set(control.get("forbidden_capabilities") or []):
            raise RuntimeExecutionError("regression_capability_forbidden", f"Regression Case forbids {capability}.")
        fixtures = control.get("tool_fixtures") if isinstance(control.get("tool_fixtures"), dict) else {}
        fixture = fixtures.get(name)
        external = name in {"web_search", "image_generation"}
        if fixture is None:
            if control.get("network") == "disabled" and kind in {"shell", "process", "test"}:
                command = arguments.get("command")
                normalized = [str(part) for part in command] if isinstance(command, list) else []
                allowed = control.get("allowed_commands") if isinstance(control.get("allowed_commands"), list) else []
                permitted = any(
                    isinstance(item, Mapping)
                    and normalized == [str(item.get("executable") or ""), *[str(part) for part in (item.get("args") or [])]]
                    for item in allowed
                )
                if not permitted:
                    raise RuntimeExecutionError(
                        "regression_command_blocked",
                        "Regression Case disables network and did not allow this exact process command.",
                    )
            if control.get("network") == "disabled" and external:
                raise RuntimeExecutionError("regression_network_blocked", f"Regression Case disables network access for {name}.")
            return None
        if not isinstance(fixture, dict) or not isinstance(fixture.get("successful_result"), dict):
            raise RuntimeExecutionError("regression_fixture_invalid", f"Regression fixture for {name} is invalid.")
        key = (context.run_id, name)
        invocation = self._regression_invocations.get(key, 0) + 1
        self._regression_invocations[key] = invocation
        attempts: list[dict[str, Any]] = []
        for fault in control.get("tool_faults") or []:
            if not isinstance(fault, dict) or fault.get("tool") != name or invocation not in (fault.get("fail_invocations") or []):
                continue
            error = fault.get("error") if isinstance(fault.get("error"), dict) else {}
            failed = RuntimeExecutionError(
                str(error.get("code") or "service_unavailable"), str(error.get("message") or "Injected regression failure."),
                retryable=error.get("retryable") is True,
            )
            self.state.append_event(context.run_id, "tool.failed", {**dict(audit), "attempt": 1, "error": failed.as_dict()})
            attempts.append({"tool": name, "status": "failed", "error_code": failed.code, "retryable": failed.retryable})
        attempts.append({"tool": name, "status": "completed"})
        return {**dict(fixture["successful_result"]), "attempts": attempts, "regression_fixture": True}

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

    def _run_process(
        self,
        context: RuntimeRunContext,
        arguments: Mapping[str, Any],
        *,
        operation_id: str,
        correlation_id: str,
    ) -> dict[str, Any]:
        command = arguments.get("command")
        if not isinstance(command, list) or not command or not all(isinstance(part, str) and part for part in command):
            raise RuntimeExecutionError("command_invalid", "Runtime commands must be a non-empty argv array.")
        cwd = self._cwd(context, arguments.get("cwd"))
        timeout = min(max(float(arguments.get("timeout_seconds", 30)), 0.1), 300.0)
        supplied_env = arguments.get("env", {})
        if not isinstance(supplied_env, dict) or not all(isinstance(key, str) and isinstance(value, str) for key, value in supplied_env.items()):
            raise RuntimeExecutionError("command_invalid", "Runtime command environment must contain string pairs.")
        if supplied_env:
            raise RuntimeExecutionError(
                "owop_environment_unsupported",
                "OWOP process.start does not accept environment overrides.",
            )
        from drsai.owop.process_pty import LocalProcessPtyOperations
        from drsai.owop.protocol import OWOPError, OWOPProtocol

        relative_cwd = cwd.relative_to(context.workspace_path.resolve(strict=True)).as_posix() or "."
        request = {
            "version": "1.0",
            "request_id": operation_id,
            "correlation_id": correlation_id,
            "workspace_id": context.workspace_id,
            "operation": "process.start",
            "params": {
                "argv": list(command),
                "cwd": relative_cwd,
                "timeout_ms": max(1, int(timeout * 1000)),
                "max_output_bytes": 4 * 1024 * 1024,
            },
            "binding": {"kind": "in_process"},
        }
        provider = LocalProcessPtyOperations(context.workspace_path)
        try:
            OWOPProtocol().validate_request(request)
            started = provider.process_start(request["params"])
            process_id = str(started["process_id"])
            with self._operation_lock:
                self._active_processes[context.run_id] = (provider, process_id)
            offset = 0
            stdout = bytearray()
            stderr = bytearray()
            while True:
                run = self.state.get_run(context.run_id)
                if context.run_id in self._cancelled_runs or run.get("cancel_requested_at") or run.get("status") == "cancelled":
                    raise RuntimeExecutionError("run_cancelled", "Runtime process was cancelled.")
                attached = provider.process_attach(
                    {"process_id": process_id, "after_offset": offset}
                )
                for segment in attached["segments"]:
                    decoded = base64.b64decode(segment["content_base64"])
                    (stderr if segment["stream"] == "stderr" else stdout).extend(decoded)
                offset = int(attached["next_offset"])
                if not attached["running"]:
                    if attached.get("timed_out"):
                        raise RuntimeExecutionError(
                            "command_timeout", "Runtime command timed out.", retryable=True
                        )
                    exit_code = attached.get("exit_code")
                    break
                time.sleep(0.01)
        except OWOPError as exc:
            raise RuntimeExecutionError(
                exc.code,
                exc.message,
                retryable=exc.retryable,
                detail=dict(exc.details or {}),
            ) from exc
        finally:
            with self._operation_lock:
                active = self._active_processes.get(context.run_id)
                if active is not None and active[0] is provider:
                    self._active_processes.pop(context.run_id, None)
            provider.close()
        return {
            "exit_code": exit_code,
            "stdout": stdout.decode(errors="replace"),
            "stderr": stderr.decode(errors="replace"),
            "hostname": socket.gethostname(),
            "cwd": str(cwd),
            "resource_refs": [{
                "protocol": "owop/1",
                "workspace_id": context.workspace_id,
                "resource_type": "process",
                "resource_id": process_id,
                "operation_id": operation_id,
            }],
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

    def emit_normalized(self, context: RuntimeRunContext, event: "NormalizedAgentEvent") -> dict[str, Any]:
        """Write a backend event through the Runtime-owned semantic boundary."""
        # event.binding contains Backend-private ids (for example Codex
        # thread/turn/item ids), not Runtime ids. The active Runtime context
        # remains authoritative for persistence; private ids are metadata only.
        append = getattr(self.state, "append_normalized_event", None)
        if append is not None:
            return append(context.run_id, event, context.audit_fields())
        from drsai.backend.runtime.normalized_writer import normalized_runtime_write

        event_type, data, dedupe_key = normalized_runtime_write(event)
        return self.emit_backend(context, event_type, data, dedupe_key)


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
        self._pending_approvals: dict[str, tuple[str, asyncio.Future[str]]] = {}
        self._approved_effects: dict[str, list[tuple[str, str]]] = {}

    async def execute(
        self,
        context: RuntimeRunContext,
        definition: AgentDefinition,
        prompt: str,
        services: AgentExecutionServices,
        initial_history: Sequence[Mapping[str, Any]] | None = None,
    ) -> dict[str, Any]:
        if self._closed:
            raise RuntimeExecutionError("agent_backend_closed", "OpenDrSai Agent Backend is closed.")
        history: list[Mapping[str, Any]] = list(initial_history or ())
        services.emit(context, "agent.started", {"backend": self.backend_id, "prompt_length": len(prompt)})
        for turn in range(1, self.max_turns + 1):
            if context.run_id in self._cancelled_runs:
                raise RuntimeExecutionError("run_cancelled", "Run was cancelled.")
            response = await asyncio.to_thread(self.model, prompt, definition, context, tuple(history))
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
                elif kind == "approval":
                    result = await self._await_approval(context, name, arguments, services)
                else:
                    approval_id = str(call.get("approval_id") or "").strip() or None
                    if approval_id is None:
                        candidates = {f"{kind}:{name}", f"{kind}.{name}", name}
                        queued = self._approved_effects.get(context.run_id, [])
                        match = next(((operation, item_id) for operation, item_id in queued if operation in candidates), None)
                        if match is not None:
                            queued.remove(match)
                            approval_id = match[1]
                    result = await asyncio.to_thread(
                        services.dispatcher.dispatch, context, kind, name, arguments,
                        approval_id=approval_id, recovered=bool(call.get("recovered")),
                    )
                turn_results.append({"kind": kind, "name": name, "result": _safe_result(result)})
            content = str(response.get("content") or "")
            if content:
                item_id = f"message-{turn}"
                binding = BackendBinding(context.session_id, context.run_id, item_id)
                services.emit_normalized(context, NormalizedAgentEvent(
                    kind=NormalizedEventKind.ITEM_STARTED,
                    backend=self.backend_id,
                    binding=binding,
                    item_type=NormalizedItemType.MESSAGE,
                    phase="final",
                    dedupe_key=f"opendrsai:{context.run_id}:{item_id}:started",
                    payload={"role": "assistant", "phase": "final", "text": "", "parts": [], "citations": []},
                ))
                services.emit_normalized(context, NormalizedAgentEvent(
                    kind=NormalizedEventKind.ITEM_DELTA,
                    backend=self.backend_id,
                    binding=binding,
                    item_type=NormalizedItemType.MESSAGE,
                    delta_kind=NormalizedDeltaKind.MESSAGE_TEXT_APPEND,
                    phase="final",
                    dedupe_key=f"opendrsai:{context.run_id}:{item_id}:delta:1",
                    payload={"text": content, "ordinal": 1},
                ))
                services.emit_normalized(context, NormalizedAgentEvent(
                    kind=NormalizedEventKind.ITEM_COMPLETED,
                    backend=self.backend_id,
                    binding=binding,
                    item_type=NormalizedItemType.MESSAGE,
                    phase="final",
                    dedupe_key=f"opendrsai:{context.run_id}:{item_id}:completed",
                    payload={
                        "role": "assistant", "phase": "final", "text": content,
                        "parts": [{"type": "text", "text": content}], "citations": [], "status": "completed",
                    },
                ))
            history.append({"turn": turn, "content": content, "results": turn_results})
            if bool(response.get("done", not calls)):
                if self._approved_effects.get(context.run_id):
                    raise RuntimeExecutionError(
                        "approved_side_effect_not_executed",
                        "The Run cannot complete while an approved side effect is still waiting for execution.",
                    )
                result = {"content": content, "turns": turn, "history": history}
                return result
        raise RuntimeExecutionError("agent_turn_limit", "Agent Loop reached its turn limit.")

    async def execute_from_checkpoint(
        self,
        context: RuntimeRunContext,
        definition: AgentDefinition,
        prompt: str,
        checkpoint_state: Mapping[str, Any],
        services: AgentExecutionServices,
    ) -> dict[str, Any]:
        payload = checkpoint_state.get("resume_payload")
        history = payload.get("history") if isinstance(payload, Mapping) else None
        if not isinstance(history, list) or not all(isinstance(item, Mapping) for item in history):
            raise RuntimeExecutionError(
                "checkpoint_restore_invalid",
                "Runtime Checkpoint does not contain a valid Agent history payload.",
            )
        services.emit(context, "agent.checkpoint.restored", {
            "history_entries": len(history),
            "agent_state_digest": checkpoint_state.get("agent_state_digest"),
        })
        return await self.execute(context, definition, prompt, services, history)

    async def cancel(self, run_id: str) -> None:
        self._cancelled_runs.add(run_id)
        for pending_run_id, future in list(self._pending_approvals.values()):
            if pending_run_id == run_id and not future.done():
                future.cancel()

    async def respond_approval(self, run_id: str, approval_id: str, decision: str) -> None:
        pending = self._pending_approvals.get(approval_id)
        if pending is None or pending[0] != run_id:
            raise RuntimeExecutionError("approval_not_found", "OpenDrSai Approval is no longer pending.")
        if decision not in {"approved", "denied", "timeout"}:
            raise RuntimeExecutionError("approval_decision_invalid", "OpenDrSai Approval decision is invalid.")
        if not pending[1].done():
            pending[1].set_result(decision)

    async def recover(self, run_id: str) -> None:
        if self._closed:
            raise RuntimeExecutionError("agent_backend_closed", "OpenDrSai Agent Backend is closed.")

    async def health(self) -> Mapping[str, Any]:
        return {
            "backend_id": self.backend_id,
            "available": not self._closed,
            "reason": "closed" if self._closed else None,
            "version": DRS_AI_VERSION,
            "adapter_version": DRS_AI_VERSION,
        }

    async def model_catalog(self, *, refresh: bool = False) -> Mapping[str, Any]:
        """Expose the two deterministic model identities this controlled backend executes."""
        return {
            "backend_id": self.backend_id,
            "models": [
                {"id": "controlled-default", "display_name": "Controlled default", "default": True},
                {"id": "controlled-candidate", "display_name": "Controlled candidate", "default": False},
            ],
            "refreshed": bool(refresh),
        }

    async def close(self) -> None:
        self._closed = True
        self._cancelled_runs.clear()
        for _, future in self._pending_approvals.values():
            if not future.done():
                future.cancel()
        self._pending_approvals.clear()
        self._approved_effects.clear()

    async def _await_approval(
        self,
        context: RuntimeRunContext,
        operation: str,
        arguments: Mapping[str, Any],
        services: AgentExecutionServices,
    ) -> dict[str, Any]:
        if not operation or operation not in context.permissions:
            raise RuntimeExecutionError("permission_denied", "Run is not permitted to request this operation.")
        timeout_seconds = min(max(float(arguments.get("timeout_seconds", 300)), 1.0), 1800.0)
        request = {
            "operation": operation,
            "risk_summary": str(arguments.get("risk_summary") or f"Allow {operation}?")[:512],
            "scope": str(arguments.get("scope") or "workspace")[:256],
        }
        deadline = (datetime.now(UTC) + timedelta(seconds=timeout_seconds)).isoformat()
        approval = services.state.request_approval(context.run_id, request, deadline)
        approval_id = str(approval["approval_id"])
        future = asyncio.get_running_loop().create_future()
        self._pending_approvals[approval_id] = (context.run_id, future)
        try:
            decision = await asyncio.wait_for(future, timeout=timeout_seconds)
        except asyncio.CancelledError as exc:
            raise RuntimeExecutionError("run_cancelled", "Run was cancelled while waiting for approval.") from exc
        except TimeoutError as exc:
            if services.state.get_approval(approval_id)["status"] == "pending":
                services.state.resolve_approval(approval_id, "timeout", {"reason": "deadline_elapsed"})
            raise RuntimeExecutionError("approval_timeout", "OpenDrSai Approval timed out.") from exc
        finally:
            self._pending_approvals.pop(approval_id, None)
        if decision != "approved":
            raise RuntimeExecutionError("approval_denied", "OpenDrSai Approval was not granted.")
        self._approved_effects.setdefault(context.run_id, []).append((operation, approval_id))
        return {"approval_id": approval_id, "decision": decision, "operation": operation}


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
        self._cancel_tasks: dict[str, asyncio.Task[dict[str, Any]]] = {}
        self._execution_tasks: dict[str, asyncio.Task[Any]] = {}

    async def execute(
        self,
        run_id: str,
        prompt: str,
        correlation_id: str | None = None,
        *,
        model_override: str | None = None,
        model_evidence: Mapping[str, Any] | None = None,
        reasoning_effort: str | None = None,
        model_provider: str | None = None,
        model_id: str | None = None,
        model_config_revision: str | None = None,
        model_catalog_revision: str | None = None,
        checkpoint_state: Mapping[str, Any] | None = None,
        input_resources_override: tuple[Mapping[str, Any], ...] | None = None,
    ) -> dict[str, Any]:
        if self._closed:
            raise RuntimeExecutionError("agent_backend_service_closed", "Agent Backend service is closed.")
        run = self.state.get_run(run_id)
        definition = self.definitions.load(str(run["agent_definition"]))
        if model_override or reasoning_effort or model_provider or model_id:
            definition = replace(
                definition,
                model=model_override or definition.model,
                reasoning_effort=reasoning_effort,
                model_provider=model_provider,
                model_id=model_id,
                model_config_revision=model_config_revision,
                model_catalog_revision=model_catalog_revision,
            )
        if str(run.get("backend_id") or "") != definition.backend:
            raise RuntimeExecutionError(
                "run_backend_binding_mismatch",
                "Run Agent Backend binding does not match its Agent Definition.",
            )
        context = self._context(
            run,
            definition,
            correlation_id=correlation_id,
            model_override_requested=bool(model_override),
        )
        if input_resources_override is not None:
            context = replace(context, input_resources=tuple(input_resources_override))
        backend = self.router.require(definition.backend)
        backend_health = await backend.health()
        manifest_writer = getattr(self.state, "update_run_manifest", None)
        if manifest_writer is not None:
            manifest_writer(
                run_id,
                {
                    **agent_definition_evidence(definition),
                    **backend_runtime_evidence(definition.backend, backend_health),
                    **workspace_revision_evidence(context.workspace_path),
                    **dict(model_evidence or {}),
                },
            )
        if run["status"] == "queued":
            self.state.transition_run(run_id, "running")
        elif run["status"] != "running":
            raise RuntimeExecutionError("run_not_executable", f"Run in state {run['status']} cannot execute.")
        services = AgentExecutionServices(self.state, self.dispatcher, self._run_subagent)
        execution_task = asyncio.current_task()
        if execution_task is not None:
            self._execution_tasks[run_id] = execution_task
        try:
            phase_marker = getattr(self.state, "mark_replay_execution_phase", None)
            if callable(phase_marker):
                phase_marker(run_id, "model_stream")
            if checkpoint_state is not None:
                resume = getattr(backend, "execute_from_checkpoint", None)
                if not callable(resume):
                    raise RuntimeExecutionError(
                        "checkpoint_restore_unsupported",
                        "The selected Agent Backend cannot restore Runtime Checkpoint state.",
                    )
                result = await resume(context, definition, prompt, checkpoint_state, services)
            else:
                result = await backend.execute(context, definition, prompt, services)
            if callable(phase_marker):
                phase_marker(run_id, "terminal_finalization")
            if self.state.get_run(run_id)["status"] == "running":
                self.state.transition_run(run_id, "completed")
            return {"run": self.state.get_run(run_id), "result": result, "context": context.audit_fields()}
        except asyncio.CancelledError as exc:
            error = RuntimeExecutionError("run_cancelled", "Agent execution was cancelled.")
            self.state.append_backend_event(
                run_id,
                "agent.failed",
                {**context.audit_fields(), "error": error.as_dict(), "diagnostic": {"stack": [], "source": None}},
                f"agent-cancelled:{run_id}",
            )
            if self.state.get_run(run_id)["status"] == "running":
                self.state.transition_run(run_id, "cancelled", reason=error.code, error=error.as_dict())
            raise error from exc
        except Exception as exc:
            error = exc if isinstance(exc, RuntimeExecutionError) else RuntimeExecutionError("agent_execution_failed", "Agent execution failed.")
            stack = _safe_diagnostic_stack(exc)
            self.state.append_backend_event(
                run_id,
                "agent.failed",
                {
                    **context.audit_fields(),
                    "error": error.as_dict(),
                    "diagnostic": {
                        "stack": stack,
                        "source": next((frame for frame in reversed(stack) if frame.get("in_app")), stack[-1] if stack else None),
                    },
                },
                f"agent-failed:{run_id}",
            )
            if self.state.get_run(run_id)["status"] == "running":
                terminal_status = "cancelled" if error.code == "run_cancelled" else "failed"
                self.state.transition_run(
                    run_id,
                    terminal_status,
                    reason=error.code,
                    error=error.as_dict(),
                )
            raise error from exc
        finally:
            if execution_task is not None and self._execution_tasks.get(run_id) is execution_task:
                self._execution_tasks.pop(run_id, None)

    def supports_checkpoint_restore(self, backend_id: str) -> bool:
        backend = self.backends.get(backend_id)
        return callable(getattr(backend, "execute_from_checkpoint", None))

    async def cancel(self, run_id: str) -> dict[str, Any]:
        existing = self._cancel_tasks.get(run_id)
        if existing is not None:
            return await asyncio.shield(existing)
        task = asyncio.create_task(self._cancel_once(run_id))
        self._cancel_tasks[run_id] = task
        try:
            return await asyncio.shield(task)
        finally:
            if self._cancel_tasks.get(run_id) is task and task.done():
                self._cancel_tasks.pop(run_id, None)

    async def _cancel_once(self, run_id: str) -> dict[str, Any]:
        run = self.state.get_run(run_id)
        if run["status"] in {"completed", "cancelled", "failed"}:
            return run
        marker = getattr(self.state, "mark_cancel_requested", None)
        if marker is not None:
            marker(run_id)
        backend = self._backend_for_run(run_id)
        backend_cancel_error: Exception | None = None
        try:
            await backend.cancel(run_id)
        except RuntimeExecutionError as exc:
            if exc.retryable:
                # A transport failure leaves the backend outcome unknown.  Keep
                # the durable cancel request pending so a later call can retry
                # against the same Run instead of presenting a false terminal.
                raise
            backend_cancel_error = exc
        except Exception as exc:
            # Cancelling the replaceable backend is best-effort.  A broken model,
            # Tool, or subagent cancellation hook must never prevent the Runtime
            # from closing approvals, stopping OWOP operations, and committing the
            # one authoritative terminal state.
            backend_cancel_error = exc
        self.dispatcher.cancel_run(run_id)
        cancelled = self.state.cancel_run(run_id)
        execution = self._execution_tasks.get(run_id)
        if execution is not None and execution is not asyncio.current_task() and not execution.done():
            execution.cancel()
        if backend_cancel_error is not None:
            self.state.append_backend_event(
                run_id,
                "agent.cancel.warning",
                {
                    "error": {
                        "code": "backend_cancel_failed",
                        "message": "Agent Backend cancellation failed after the Runtime converged the Run.",
                    },
                    "diagnostic": {
                        "stack": _safe_diagnostic_stack(backend_cancel_error),
                        "source": None,
                    },
                },
                f"agent-cancel-warning:{run_id}",
            )
        return cancelled

    async def archive_session(self, session_id: str, *, archived: bool) -> None:
        """Ask the Session's backend to mirror a Runtime archive transition.

        A Session with no Runs is Runtime-only.  Once Runs exist, they must all
        belong to one backend before we can safely mirror a session-level action.
        """
        backend_ids = {str(run["backend_id"]) for run in self.state.list_session_runs(session_id)}
        if not backend_ids:
            session = self.state.get_session(session_id)
            session_backend = str(session.get("backend_id") or "").strip()
            if not session_backend:
                return
            backend_ids.add(session_backend)
        if len(backend_ids) != 1:
            raise RuntimeExecutionError(
                "session_backend_ambiguous",
                "Session contains Runs from multiple Agent Backends.",
            )
        backend_id = backend_ids.pop()
        operation = getattr(self.router.require(backend_id), "archive_session", None)
        if operation is not None:
            await operation(session_id, archived=archived)

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

    async def backend_model_catalog(self, backend_id: str, *, refresh: bool = False) -> dict[str, Any]:
        backend = self.router.require(backend_id)
        operation = getattr(backend, "model_catalog", None)
        if operation is None:
            raise RuntimeExecutionError("backend_model_catalog_unsupported", f"Agent Backend {backend_id} has no model catalog.")
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

    async def restart_backend(self, backend_id: str) -> dict[str, Any]:
        backend = self.router.require(backend_id)
        operation = getattr(backend, "restart_backend", None)
        if operation is None:
            raise RuntimeExecutionError("backend_restart_unsupported", f"Agent Backend {backend_id} cannot be restarted independently.")
        return dict(await operation())

    async def backend_session_binding_status(self, session_id: str) -> dict[str, Any]:
        try:
            session = self.state.get_session(session_id)
        except KeyError:
            return {"session_id": session_id, "state": "backend-missing", "reason": "session_not_found"}
        backend_id = str(session.get("backend_id") or "").strip()
        if not backend_id:
            return {"session_id": session_id, "state": "unbound"}
        backend = self.router.require(backend_id)
        operation = getattr(backend, "session_binding_status", None)
        if operation is None:
            return {"session_id": session_id, "backend_id": backend_id, "state": "unbound"}
        result = dict(await operation(session_id))
        state = str(result.get("state") or "")
        if state not in {"unbound", "bound", "recovery-required", "conflict", "backend-missing"}:
            raise RuntimeExecutionError(
                "backend_session_binding_status_invalid",
                f"Agent Backend {backend_id} returned an invalid Session binding state.",
            )
        return {"session_id": session_id, "backend_id": backend_id, **result}

    async def sync_backend_sessions(self, backend_id: str, workspace_id: str) -> dict[str, Any]:
        backend = self.router.require(backend_id)
        discover = getattr(backend, "discover_sessions", None)
        bind = getattr(backend, "bind_imported_session", None)
        if discover is None or bind is None:
            raise RuntimeExecutionError("backend_session_sync_unsupported", f"Agent Backend {backend_id} cannot discover existing Sessions.")
        workspace = self.workspaces.get_workspace(workspace_id)
        if workspace is None:
            raise RuntimeExecutionError("workspace_not_found", "Workspace is not open on this Runtime.")
        rows = await discover(str(workspace.path))
        health = await backend.health()
        backend_version = str(health.get("version") or "unknown")
        result = {"backend_id": backend_id, "workspace_id": workspace_id, "discovered": len(rows),
                  "active": 0, "archived": 0, "created": 0, "updated": 0, "skipped": 0,
                  "conflicts": 0, "sessions": []}
        for row in rows:
            backend_session_id = str(row.get("backend_session_id") or "")
            if not backend_session_id:
                result["skipped"] += 1
                continue
            session_id = f"session-{backend_id}-{hashlib.sha256(backend_session_id.encode('utf-8')).hexdigest()[:32]}"
            try:
                previous = self.state.get_session(session_id)
            except KeyError:
                previous = None
            incoming_updated_at = str(row.get("updated_at") or row.get("created_at") or "")
            if previous and bool(previous.get("archived")) != bool(row.get("archived")):
                try:
                    local_at = datetime.fromisoformat(str(previous.get("updated_at") or "").replace("Z", "+00:00"))
                    remote_at = datetime.fromisoformat(incoming_updated_at.replace("Z", "+00:00"))
                    if local_at > remote_at:
                        result["conflicts"] += 1
                except ValueError:
                    pass
            session, created = self.state.import_session(
                session_id, workspace_id, str(row.get("title") or "Imported session"),
                agent_definition=f"{backend_id}@1", backend_id=backend_id,
                created_at=row.get("created_at"), updated_at=row.get("updated_at"),
                archived=bool(row.get("archived")),
            )
            await bind(
                session_id, workspace_id, str(self.state.identity.runtime_id), backend_session_id,
                backend_version=backend_version,
                backend_updated_at=incoming_updated_at or None,
            )
            state = "archived" if session["archived"] else "active"
            result[state] += 1
            if created:
                result["created"] += 1
            elif previous != session:
                result["updated"] += 1
            else:
                result["skipped"] += 1
            message_count = len(self.state.oaep_snapshot(session_id).get("items") or [])
            result["sessions"].append({**session, "message_count": message_count})
        return result

    async def sync_backend_session_history(
        self, session_id: str, *, force_reproject: bool = False,
        cursor: str | None = None, limit: int = 100,
    ) -> dict[str, Any]:
        from drsai.backend.runtime.history import validate_history_page

        session = self.state.get_session(session_id)
        backend_id = str(session.get("backend_id") or "")
        backend = self.router.require(backend_id)
        capability_reader = getattr(backend, "history_capability", None)
        page_reader = getattr(backend, "read_normalized_history", None)
        if capability_reader is None or page_reader is None:
            return {"session_id": session_id, "backend_id": backend_id, "imported": 0, "total": 0}
        capability = dict(capability_reader())
        mapping_version = str(capability.get("mapping_version") or "")
        if not mapping_version:
            raise RuntimeExecutionError("backend_history_capability_invalid", "Backend history mapping version is missing.")
        watermark_reader = getattr(backend, "history_sync_watermark", None)
        watermark_writer = getattr(backend, "mark_history_synced", None)
        watermark = await watermark_reader(session_id) if watermark_reader is not None else None
        if (
            isinstance(watermark, Mapping)
            and watermark.get("backend_updated_at")
            and watermark.get("backend_updated_at") == watermark.get("synced_backend_updated_at")
            and watermark.get("mapping_version") == mapping_version
            and int(watermark.get("schema_version") or 0) == 1
            and cursor is None
        ):
            return {
                "session_id": session_id, "backend_id": backend_id, "imported": 0,
                "total": int(watermark.get("item_count") or 0),
                "runs": int(watermark.get("run_count") or 0),
                "warnings": int(watermark.get("warning_count") or 0),
                "mapping_version": mapping_version, "cached": True,
            }
        page = validate_history_page(
            await page_reader(session_id, cursor=cursor, limit=limit), capability,
        )
        history = list(page["turns"])
        next_cursor = page.get("next_cursor")
        if force_reproject:
            while next_cursor:
                older = validate_history_page(
                    await page_reader(session_id, cursor=next_cursor, limit=limit), capability,
                )
                history = list(older["turns"]) + history
                next_cursor = older.get("next_cursor")
        kind_map = {
            "message": "message", "reasoning": "reasoning", "plan": "plan",
            "command_execution": "tool", "tool_call": "tool", "file_change": "file_change",
            "interaction": "approval", "artifact": "artifact", "subtask": "subtask", "notice": "error",
        }
        existing_items = {
            str(item["item_id"]): item
            for item in self.state.conversation_snapshot(session_id).get("items") or []
        }
        legacy_projection = any(
            str(item.get("source_message_id") or "").startswith("codex:")
            and str((item.get("payload") or {}).get("mapping_version") or "") != mapping_version
            for item in existing_items.values()
        )
        mapping_changed = bool(
            isinstance(watermark, Mapping) and watermark.get("mapping_version")
            and watermark.get("mapping_version") != mapping_version
        )
        migration_reasons = [
            *( ["manual_repair"] if force_reproject else []),
            *( ["mapping_version_changed"] if mapping_changed else []),
            *( ["legacy_projection"] if legacy_projection else []),
        ]
        migration_planner = getattr(backend, "plan_history_migration", None)
        migration_scan = dict(migration_planner(
            session_id, history, list(existing_items.values()), self.state.list_oaep_events(session_id),
            mapping_version=mapping_version, reasons=migration_reasons,
        )) if migration_planner is not None else {
            "mode": "skipped", "mapping_version": mapping_version, "affected_items": 0,
            "reasons": {}, "content_redacted": True, "triggers": migration_reasons,
        }
        pending_items: list[dict[str, Any]] = []
        warning_count = 0
        for historical_turn in history:
            backend_run_id = str(historical_turn.get("backend_run_id") or "")
            if not backend_run_id:
                continue
            imported_run, _ = self.state.import_backend_run(
                session_id, backend_id, backend_run_id,
                status=str(historical_turn.get("status") or "completed"),
                backend_run_index=(int(historical_turn["backend_run_index"])
                                   if historical_turn.get("backend_run_index") is not None else None),
                created_at=historical_turn.get("created_at"), completed_at=historical_turn.get("completed_at"),
            )
            for historical_item in historical_turn.get("items") or []:
                if not isinstance(historical_item, Mapping):
                    continue
                backend_item_id = str(historical_item.get("item_id") or "")
                if not backend_item_id:
                    continue
                item_digest = hashlib.sha256(
                    f"{session_id}\0{backend_run_id}\0{backend_item_id}".encode("utf-8")
                ).hexdigest()[:32]
                role = historical_item.get("role")
                if role not in {"user", "assistant", "system", "tool", None}:
                    role = None
                item_id = f"codex-item-{item_digest}"
                existing = existing_items.get(item_id)
                old_payload = dict(existing.get("payload") or {}) if existing else {}
                payload = {**dict(historical_item.get("payload") or {}), "backend_item_id": backend_item_id,
                           "backend_run_id": backend_run_id,
                           "backend_run_index": historical_turn.get("backend_run_index"),
                           "mapping_version": mapping_version,
                           "status": str(historical_item.get("status") or "completed")}
                if payload.get("code") == "codex_item_unknown":
                    warning_count += 1
                if existing:
                    ignored = {"mapping_version", "projection_correction"}
                    old_semantics = {key: value for key, value in old_payload.items() if key not in ignored}
                    new_semantics = {key: value for key, value in payload.items() if key not in ignored}
                    if old_payload.get("mapping_version") == mapping_version and (
                        not force_reproject or old_semantics == new_semantics
                    ):
                        continue
                correction = bool(existing)
                if correction:
                    payload["projection_correction"] = True
                pending_items.append({
                    "item_id": item_id,
                    "kind": kind_map.get(str(historical_item.get("kind") or "notice"), "error"),
                    "role": role, "revision": int(existing.get("revision") or 0) + 1 if correction else 1,
                    "source_client": "runtime",
                    "source_message_id": f"codex:{item_digest}",
                    "payload": payload,
                    "run_id": str(imported_run["run_id"]), "event_kind": "conversation.item.upsert",
                    "created_at": historical_item.get("created_at") or historical_turn.get("created_at"),
                    "updated_at": historical_item.get("updated_at") or historical_turn.get("completed_at")
                                  or historical_turn.get("created_at"),
                })
        imported = 0
        # Bound correction transactions so a large legacy Thread does not lock
        # the Runtime database for the whole reprojection. Every batch is
        # append-only and idempotent; interruption resumes from the first
        # uncommitted mapping revision.
        for offset in range(0, len(pending_items), 250):
            imported += self.state.record_conversation_items(
                session_id, pending_items[offset:offset + 250]
            )["created"]
            # Cancellation is a real checkpoint. Committed append-only batches
            # remain valid and a later repair resumes idempotently.
            await asyncio.sleep(0)
        total = len(self.state.oaep_snapshot(session_id).get("items") or [])
        if watermark_writer is not None and not next_cursor:
            content_digest = hashlib.sha256(
                json.dumps(history, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
            ).hexdigest()
            await watermark_writer(
                session_id, mapping_version=mapping_version, content_digest=content_digest,
                run_count=len(history), item_count=total, warning_count=warning_count,
            )
        return {
            "session_id": session_id,
            "backend_id": backend_id,
            "imported": imported,
            "total": total,
            "runs": len(history),
            "warnings": warning_count,
            "mapping_version": mapping_version,
            "next_cursor": next_cursor,
            "estimated_total": int(page.get("estimated_total") or len(history)),
            "truncated": bool(next_cursor),
            "loaded_runs": len(history),
            "migration": {
                **migration_scan,
                "corrected_items": imported,
                "status": "completed",
            },
        }

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        active_run_ids = list(self._execution_tasks)
        if active_run_ids:
            await asyncio.gather(*(self.cancel(run_id) for run_id in active_run_ids), return_exceptions=True)
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
        model_override_requested: bool = False,
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
            input_resources=tuple(
                value for value in run.get("input_resources", []) if isinstance(value, Mapping)
            ) if parent is None else parent.input_resources,
            model_override_requested=model_override_requested if parent is None else parent.model_override_requested,
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
            parent_run_id=parent.run_id,
        )
        child_context = self._context(child_run, definition, parent=parent)
        backend = self.router.require(definition.backend)
        self.state.append_event(parent.run_id, "subagent.started", {**parent.audit_fields(), "child_run_id": child_context.run_id})
        self.state.transition_run(child_context.run_id, "running")
        services = AgentExecutionServices(self.state, self.dispatcher, self._run_subagent)
        try:
            result = await backend.execute(child_context, definition, str(arguments.get("prompt") or ""), services)
        except asyncio.CancelledError:
            await backend.cancel(child_context.run_id)
            self.state.cancel_run(child_context.run_id)
            self.state.append_event(
                parent.run_id,
                "subagent.cancelled",
                {**parent.audit_fields(), "child_run_id": child_context.run_id, "reason": "parent_cancelled"},
            )
            raise
        except Exception as exc:
            if self.state.get_run(child_context.run_id)["status"] == "running":
                self.state.transition_run(
                    child_context.run_id,
                    "failed",
                    reason="subagent_execution_failed",
                    error={"code": "subagent_execution_failed", "message": "Subagent execution failed."},
                )
            self.state.append_event(
                parent.run_id,
                "subagent.failed",
                {**parent.audit_fields(), "child_run_id": child_context.run_id, "error_type": type(exc).__name__},
            )
            raise
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


def _safe_diagnostic_stack(exc: BaseException, limit: int = 80) -> list[dict[str, Any]]:
    """Return code locations only; never include locals, arguments, prompts, or source lines."""
    frames: list[dict[str, Any]] = []
    for frame in traceback.extract_tb(exc.__traceback__, limit=limit):
        normalized = str(Path(frame.filename)).replace("\\", "/")
        lowered = normalized.lower()
        home = str(Path.home()).replace("\\", "/").rstrip("/")
        if home and lowered.startswith(home.lower() + "/"):
            normalized = "$HOME" + normalized[len(home):]
        frames.append({
            "file": normalized,
            "line": max(1, int(frame.lineno)),
            "function": str(frame.name)[:500],
            "language": "python",
            "in_app": "/drsai/" in lowered or lowered.endswith("/drsai"),
        })
    return frames
