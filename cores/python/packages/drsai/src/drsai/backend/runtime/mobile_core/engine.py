"""Dependency-light shared agent loop for host-driven runtimes."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
import base64
import json
from typing import Any, Mapping, Sequence

from .protocol import MessageType, RuntimeEnvelope
from .context import assemble_mobile_context


class RunPhase(StrEnum):
    RUNNING = "running"
    WAITING_MODEL = "waiting_model"
    WAITING_TOOL = "waiting_tool"
    WAITING_APPROVAL = "waiting_approval"
    WAITING_ARTIFACT = "waiting_artifact"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    FAILED = "failed"


TERMINAL_PHASES = {RunPhase.COMPLETED, RunPhase.CANCELLED, RunPhase.FAILED}


@dataclass(slots=True)
class MobileRunState:
    run_id: str
    session_id: str
    model_id: str
    phase: RunPhase = RunPhase.RUNNING
    outbound_sequence: int = 0
    messages: list[dict[str, Any]] = field(default_factory=list)
    completed_side_effects: set[str] = field(default_factory=set)
    pending_tool_calls: dict[str, Mapping[str, Any]] = field(default_factory=dict)
    pending_artifacts: dict[str, dict[str, Any]] = field(default_factory=dict)
    tools: list[dict[str, Any]] = field(default_factory=list)
    skills: list[dict[str, Any]] = field(default_factory=list)
    lifecycle_state: str = "foreground"
    pending_subagents: dict[str, dict[str, Any]] = field(default_factory=dict)
    subagent_results: dict[str, str] = field(default_factory=dict)
    delegate_call_id: str | None = None

    @property
    def terminal(self) -> bool:
        return self.phase in TERMINAL_PHASES


class MobileAgentCore:
    """Single-actor core. The Kotlin bridge serializes calls into this object."""

    def __init__(self) -> None:
        self._runs: dict[str, MobileRunState] = {}
        self._active_run_by_session: dict[str, str] = {}
        self._replies_by_idempotency_key: dict[tuple[str, str], tuple[RuntimeEnvelope, ...]] = {}

    def handle(self, command: RuntimeEnvelope) -> tuple[RuntimeEnvelope, ...]:
        replay_key = (command.run_id, command.idempotency_key)
        replay = self._replies_by_idempotency_key.get(replay_key)
        if replay is not None:
            return replay
        handler = {
            MessageType.START_RUN: self._start_run,
            MessageType.RESUME_RUN: self._resume_run,
            MessageType.CANCEL_RUN: self._cancel_run,
            MessageType.MODEL_CHUNK: self._model_chunk,
            MessageType.MODEL_COMPLETED: self._model_completed,
            MessageType.MODEL_FAILED: self._model_failed,
            MessageType.TOOL_RESULT: self._tool_result,
            MessageType.APPROVAL_RESULT: self._approval_result,
            MessageType.ARTIFACT_RESULT: self._artifact_result,
            MessageType.LIFECYCLE_CHANGED: self._lifecycle_changed,
        }.get(command.message_type)
        if handler is None:
            raise ValueError("command_not_supported_by_core")
        replies = tuple(handler(command))
        self._replies_by_idempotency_key[replay_key] = replies
        return replies

    def _start_run(self, command: RuntimeEnvelope) -> Sequence[RuntimeEnvelope]:
        active = self._active_run_by_session.get(command.session_id)
        if active is not None and active != command.run_id:
            raise ValueError("session_run_already_active")
        if command.run_id in self._runs:
            raise ValueError("run_already_exists")
        input_text = self._required_string(command.payload, "input")
        model_id = self._required_string(command.payload, "model_id")
        state = MobileRunState(command.run_id, command.session_id, model_id)
        state.tools = [dict(value) for value in command.payload.get("tools", [])]
        state.skills = [dict(value) for value in command.payload.get("skills", [])]
        state.lifecycle_state = str(command.payload.get("lifecycle_state", "foreground"))
        history = command.payload.get("history", [])
        if not isinstance(history, list):
            raise ValueError("history_invalid")
        state.messages = assemble_mobile_context(history, input_text)
        self._runs[state.run_id] = state
        self._active_run_by_session[state.session_id] = state.run_id
        started = self._event(state, "run.started", {"status": "running"})
        prefix = [started]
        if state.lifecycle_state in {"background", "low_memory", "thermal_limited"}:
            prefix.append(self._event(state, "runtime.degraded", {"reason": state.lifecycle_state, "max_parallel_agents": 1}))
        artifacts = command.payload.get("artifacts", [])
        if not isinstance(artifacts, list) or any(not isinstance(value, str) or not value for value in artifacts):
            raise ValueError("artifacts_invalid")
        if artifacts:
            state.phase = RunPhase.WAITING_ARTIFACT
            state.pending_artifacts = {value: {"phase": "describe"} for value in artifacts}
            requests = tuple(
                self._request(
                    state, MessageType.ARTIFACT_REQUEST,
                    {"artifact_id": artifact_id, "operation": "describe"},
                    f"artifact_describe:{artifact_id}",
                )
                for artifact_id in artifacts
            )
            return (*prefix, self._checkpoint(state, "before_artifact"), *requests)
        state.phase = RunPhase.WAITING_MODEL
        model = self._request(
            state,
            MessageType.MODEL_REQUEST,
            {"model_id": state.model_id, "messages": state.messages, "tools": state.tools, "skills": state.skills},
            "model",
        )
        return (*prefix, self._checkpoint(state, "before_model"), model)

    def _resume_run(self, command: RuntimeEnvelope) -> Sequence[RuntimeEnvelope]:
        raw = command.payload.get("state")
        if not isinstance(raw, Mapping):
            raise ValueError("resume_state_required")
        if command.run_id in self._runs:
            raise ValueError("run_already_exists")
        phase = RunPhase(self._required_string(raw, "phase"))
        state = MobileRunState(
            run_id=command.run_id,
            session_id=command.session_id,
            model_id=self._required_string(raw, "model_id"),
            phase=phase,
            outbound_sequence=int(raw.get("outbound_sequence", 0)),
            messages=[dict(value) for value in raw.get("messages", [])],
            completed_side_effects=set(raw.get("completed_side_effects", [])),
            pending_tool_calls={str(key): dict(value) for key, value in raw.get("pending_tool_calls", {}).items()},
            pending_artifacts={str(key): dict(value) for key, value in raw.get("pending_artifacts", {}).items()},
            tools=[dict(value) for value in raw.get("tools", [])],
            skills=[dict(value) for value in raw.get("skills", [])],
            lifecycle_state=str(raw.get("lifecycle_state", "foreground")),
            pending_subagents={str(key): dict(value) for key, value in raw.get("pending_subagents", {}).items()},
            subagent_results={str(key): str(value) for key, value in raw.get("subagent_results", {}).items()},
            delegate_call_id=raw.get("delegate_call_id"),
        )
        self._runs[state.run_id] = state
        if not state.terminal:
            self._active_run_by_session[state.session_id] = state.run_id
        recovered = self._event(state, "run.recovered", {"phase": state.phase.value})
        if state.phase is RunPhase.WAITING_ARTIFACT:
            requests = []
            for artifact_id, value in state.pending_artifacts.items():
                operation = value.get("phase", "describe")
                payload = {"artifact_id": artifact_id, "operation": operation}
                if operation == "read":
                    payload.update({"offset": 0, "length": min(int(value.get("size", 0)), 65536)})
                requests.append(self._request(state, MessageType.ARTIFACT_REQUEST, payload, f"resume_artifact:{operation}:{artifact_id}"))
            return (recovered, *requests)
        if state.phase in {RunPhase.RUNNING, RunPhase.WAITING_MODEL}:
            state.phase = RunPhase.WAITING_MODEL
            if state.pending_subagents:
                requests = tuple(
                    self._request(
                        state, MessageType.MODEL_REQUEST,
                        {"model_id": state.model_id, "messages": [
                            {"role": "system", "content": "Complete only the focused delegated task."},
                            {"role": "user", "content": task["prompt"]},
                        ], "tools": [], "subagent_id": task_id},
                        f"resume_subagent_model:{task_id}",
                    )
                    for task_id, task in state.pending_subagents.items()
                )
                return (recovered, *requests)
            return (
                recovered,
                self._request(
                    state,
                    MessageType.MODEL_REQUEST,
                    {"model_id": state.model_id, "messages": state.messages, "tools": state.tools, "skills": state.skills},
                    "resume_model",
                ),
            )
        if state.phase is RunPhase.WAITING_TOOL:
            pending = [
                self._request(state, MessageType.TOOL_CALL_REQUEST, call, f"resume_tool:{call_id}")
                for call_id, call in state.pending_tool_calls.items()
                if call_id not in state.completed_side_effects
            ]
            return (recovered, *pending)
        if state.phase is RunPhase.WAITING_APPROVAL:
            call_id, call = next(iter(state.pending_tool_calls.items()))
            return (
                recovered,
                self._request(
                    state,
                    MessageType.APPROVAL_REQUEST,
                    {
                        "approval_id": f"approval:{call_id}", "call_id": call_id, "risk": "high",
                        "name": call["name"], "arguments": call["arguments"],
                        "title": "需要确认工具操作", "summary": f"继续执行 {call['name']}",
                    },
                    f"resume_approval:{call_id}",
                ),
            )
        return (recovered,)

    def _model_chunk(self, command: RuntimeEnvelope) -> Sequence[RuntimeEnvelope]:
        state = self._require_phase(command.run_id, RunPhase.WAITING_MODEL)
        delta = command.payload.get("delta", "")
        if not isinstance(delta, str):
            raise ValueError("model_delta_invalid")
        if not delta:
            return ()
        subagent_id = command.payload.get("subagent_id")
        if subagent_id is not None:
            if subagent_id not in state.pending_subagents:
                raise ValueError("subagent_not_pending")
            return (self._event(state, "subagent.thinking", {"subagent_id": subagent_id, "text": delta}),)
        return (self._event(state, "message.delta", {"text": delta}),)

    def _model_completed(self, command: RuntimeEnvelope) -> Sequence[RuntimeEnvelope]:
        state = self._require_phase(command.run_id, RunPhase.WAITING_MODEL)
        content = command.payload.get("content", "")
        if not isinstance(content, str):
            raise ValueError("model_content_invalid")
        subagent_id = command.payload.get("subagent_id")
        if subagent_id is not None:
            return self._subagent_completed(state, str(subagent_id), content)
        tool_calls = command.payload.get("tool_calls", [])
        if not isinstance(tool_calls, list):
            raise ValueError("tool_calls_invalid")
        delegate_calls = [value for value in tool_calls if isinstance(value, Mapping) and value.get("name") == "delegate"]
        if delegate_calls:
            if len(tool_calls) != 1:
                raise ValueError("delegate_must_be_single")
            return self._start_subagents(state, delegate_calls[0], content)
        core_calls = [value for value in tool_calls if isinstance(value, Mapping) and value.get("name") == "core.text_stats"]
        if core_calls:
            if len(core_calls) != len(tool_calls):
                raise ValueError("core_and_host_tools_cannot_mix")
            return self._execute_core_tools(state, core_calls, content)
        if content and not tool_calls:
            state.messages.append({"role": "assistant", "content": content})
        if not tool_calls:
            state.phase = RunPhase.COMPLETED
            self._active_run_by_session.pop(state.session_id, None)
            return (
                self._event(state, "run.completed", {"status": "completed"}),
                self._checkpoint(state, "terminal"),
            )
        replies: list[RuntimeEnvelope] = []
        approval_call: Mapping[str, Any] | None = None
        for raw_call in tool_calls:
            if not isinstance(raw_call, Mapping):
                raise ValueError("tool_call_invalid")
            call_id = self._required_string(raw_call, "call_id")
            name = self._required_string(raw_call, "name")
            if call_id in state.pending_tool_calls or call_id in state.completed_side_effects:
                raise ValueError("tool_call_duplicate")
            arguments = raw_call.get("arguments", {})
            if not isinstance(arguments, Mapping):
                raise ValueError("tool_arguments_invalid")
            normalized = {
                "call_id": call_id,
                "name": name,
                "arguments": dict(arguments),
                "requires_approval": bool(raw_call.get("requires_approval", False)),
            }
            state.pending_tool_calls[call_id] = normalized
            if normalized["requires_approval"]:
                if len(tool_calls) != 1:
                    raise ValueError("approval_tool_must_be_single")
                approval_call = raw_call
            else:
                replies.append(self._request(state, MessageType.TOOL_CALL_REQUEST, normalized, f"tool:{call_id}"))
        state.messages.append(
            {
                "role": "assistant",
                "content": content,
                "tool_calls": [dict(value) for value in state.pending_tool_calls.values()],
            }
        )
        if approval_call is not None:
            state.phase = RunPhase.WAITING_APPROVAL
            call_id = self._required_string(approval_call, "call_id")
            replies.append(self._checkpoint(state, "before_approval"))
            replies.append(self._event(state, "approval.requested", {"call_id": call_id}))
            replies.append(
                self._request(
                    state,
                    MessageType.APPROVAL_REQUEST,
                    {
                        "approval_id": f"approval:{call_id}",
                        "call_id": call_id,
                        "name": approval_call["name"],
                        "arguments": approval_call.get("arguments", {}),
                        "risk": approval_call.get("risk", "high"),
                        "title": approval_call.get("title", "需要确认工具操作"),
                        "summary": approval_call.get("summary", "工具将在 Android Host 执行副作用"),
                    },
                    f"approval:{call_id}",
                )
            )
        else:
            state.phase = RunPhase.WAITING_TOOL
            replies.insert(0, self._checkpoint(state, "before_tool"))
        return replies

    def _tool_result(self, command: RuntimeEnvelope) -> Sequence[RuntimeEnvelope]:
        state = self._require_phase(command.run_id, RunPhase.WAITING_TOOL)
        call_id = self._required_string(command.payload, "call_id")
        call = state.pending_tool_calls.pop(call_id, None)
        if call is None:
            if call_id in state.completed_side_effects:
                return ()
            raise ValueError("tool_call_not_pending")
        state.completed_side_effects.add(call_id)
        state.messages.append(
            {
                "role": "tool",
                "tool_call_id": call_id,
                "name": call["name"],
                "content": command.payload.get("content", {}),
                "succeeded": bool(command.payload.get("succeeded", False)),
            }
        )
        tool_event = self._event(
            state,
            "tool.result" if bool(command.payload.get("succeeded", False)) else "tool.error",
            {"call_id": call_id, "name": call["name"], "code": command.payload.get("error_code")},
        )
        if state.pending_tool_calls:
            return (tool_event,)
        state.phase = RunPhase.WAITING_MODEL
        return (
            tool_event,
            self._checkpoint(state, "after_tool"),
            self._request(
                state,
                MessageType.MODEL_REQUEST,
                {"model_id": state.model_id, "messages": state.messages, "tools": state.tools, "skills": state.skills},
                "model_after_tools",
            ),
        )

    def _approval_result(self, command: RuntimeEnvelope) -> Sequence[RuntimeEnvelope]:
        state = self._require_phase(command.run_id, RunPhase.WAITING_APPROVAL)
        decision = self._required_string(command.payload, "decision")
        if decision not in {"approved", "rejected"}:
            raise ValueError("approval_decision_invalid")
        state.phase = RunPhase.WAITING_TOOL if decision == "approved" else RunPhase.CANCELLED
        if decision == "rejected":
            self._active_run_by_session.pop(state.session_id, None)
            return (
                self._event(state, "approval.decided", {"decision": decision}),
                self._event(state, "run.cancelled", {"reason": "approval_rejected"}),
                self._checkpoint(state, "terminal"),
            )
        call_id = self._required_string(command.payload, "call_id")
        call = state.pending_tool_calls.get(call_id)
        if call is None:
            raise ValueError("tool_call_not_pending")
        return (
            self._event(state, "approval.decided", {"decision": decision, "call_id": call_id}),
            self._checkpoint(state, "after_approval"),
            self._request(state, MessageType.TOOL_CALL_REQUEST, call, f"tool:{call_id}"),
        )

    def _artifact_result(self, command: RuntimeEnvelope) -> Sequence[RuntimeEnvelope]:
        state = self._require_phase(command.run_id, RunPhase.WAITING_ARTIFACT)
        artifact_id = self._required_string(command.payload, "artifact_id")
        pending = state.pending_artifacts.get(artifact_id)
        if pending is None:
            raise ValueError("artifact_not_pending")
        operation = self._required_string(command.payload, "operation")
        if operation == "describe":
            size = int(command.payload.get("size", -1))
            mime_type = self._required_string(command.payload, "mime_type")
            if size < 0:
                raise ValueError("artifact_size_invalid")
            pending.update({"phase": "read", "size": size, "mime_type": mime_type})
            if mime_type.startswith("text/") or mime_type in {"application/json", "application/xml"}:
                return (
                    self._request(
                        state, MessageType.ARTIFACT_REQUEST,
                        {"artifact_id": artifact_id, "operation": "read", "offset": 0, "length": min(size, 65536)},
                        f"artifact_read:{artifact_id}",
                    ),
                )
            state.messages.append({"role": "system", "content": f"Attachment {artifact_id}: {mime_type}, {size} bytes (binary metadata only)."})
            state.pending_artifacts.pop(artifact_id)
        elif operation == "read":
            encoded = self._required_string(command.payload, "data_base64")
            content = base64.b64decode(encoded, validate=True).decode("utf-8", errors="replace")
            mime_type = str(pending.get("mime_type", "text/plain"))
            state.messages.append({"role": "system", "content": f"Attachment {artifact_id} ({mime_type}):\n{content}"})
            state.pending_artifacts.pop(artifact_id)
        else:
            raise ValueError("artifact_operation_invalid")
        if state.pending_artifacts:
            return (self._checkpoint(state, "after_artifact"),)
        state.phase = RunPhase.WAITING_MODEL
        return (
            self._checkpoint(state, "after_artifact"),
            self._request(
                state, MessageType.MODEL_REQUEST,
                {"model_id": state.model_id, "messages": state.messages, "tools": state.tools, "skills": state.skills},
                "model_after_artifacts",
            ),
        )

    def _start_subagents(
        self, state: MobileRunState, raw_call: Mapping[str, Any], content: str,
    ) -> Sequence[RuntimeEnvelope]:
        call_id = self._required_string(raw_call, "call_id")
        arguments = raw_call.get("arguments", {})
        if not isinstance(arguments, Mapping) or not isinstance(arguments.get("tasks"), list):
            raise ValueError("subagent_tasks_invalid")
        tasks = arguments["tasks"]
        if not 1 <= len(tasks) <= 3:
            raise ValueError("subagent_active_limit")
        pending: dict[str, dict[str, Any]] = {}
        for raw_task in tasks:
            if not isinstance(raw_task, Mapping):
                raise ValueError("subagent_task_invalid")
            task_id = self._required_string(raw_task, "task_id")
            prompt = self._required_string(raw_task, "prompt")
            if task_id in pending:
                raise ValueError("subagent_task_duplicate")
            pending[task_id] = {"task_id": task_id, "prompt": prompt}
        state.messages.append({"role": "assistant", "content": content, "tool_calls": [dict(raw_call)]})
        state.pending_subagents = pending
        state.subagent_results = {}
        state.delegate_call_id = call_id
        replies: list[RuntimeEnvelope] = [self._checkpoint(state, "before_subagents")]
        for task_id, task in pending.items():
            replies.append(self._event(state, "subagent.started", {"subagent_id": task_id}))
        for task_id, task in pending.items():
            replies.append(
                self._request(
                    state, MessageType.MODEL_REQUEST,
                    {"model_id": state.model_id, "messages": [
                        {"role": "system", "content": "Complete only the focused delegated task."},
                        {"role": "user", "content": task["prompt"]},
                    ], "tools": [], "subagent_id": task_id},
                    f"subagent_model:{task_id}",
                )
            )
        return replies

    def _execute_core_tools(
        self, state: MobileRunState, calls: Sequence[Mapping[str, Any]], content: str,
    ) -> Sequence[RuntimeEnvelope]:
        replies: list[RuntimeEnvelope] = []
        normalized = []
        for raw_call in calls:
            call_id = self._required_string(raw_call, "call_id")
            arguments = raw_call.get("arguments", {})
            if not isinstance(arguments, Mapping) or not isinstance(arguments.get("text"), str):
                raise ValueError("core_tool_arguments_invalid")
            text = arguments["text"]
            if len(text) > 10_000:
                raise ValueError("core_tool_arguments_too_large")
            normalized.append({"call_id": call_id, "name": "core.text_stats", "arguments": {"text": text}})
        state.messages.append({"role": "assistant", "content": content, "tool_calls": normalized})
        for call in normalized:
            text = call["arguments"]["text"]
            result = {"characters": len(text), "words": len(text.split()), "lines": 0 if not text else text.count("\n") + 1}
            replies.append(self._event(state, "tool.started", {"name": call["name"], "call_id": call["call_id"]}))
            state.messages.append({"role": "tool", "tool_call_id": call["call_id"], "content": json.dumps(result, sort_keys=True)})
            replies.append(self._event(state, "tool.result", {"name": call["name"], "call_id": call["call_id"]}))
        state.phase = RunPhase.WAITING_MODEL
        replies.append(self._checkpoint(state, "after_core_tool"))
        replies.append(
            self._request(
                state, MessageType.MODEL_REQUEST,
                {"model_id": state.model_id, "messages": state.messages, "tools": state.tools, "skills": state.skills},
                "model_after_core_tool",
            )
        )
        return replies

    def _subagent_completed(
        self, state: MobileRunState, subagent_id: str, content: str,
    ) -> Sequence[RuntimeEnvelope]:
        if subagent_id not in state.pending_subagents:
            raise ValueError("subagent_not_pending")
        state.pending_subagents.pop(subagent_id)
        state.subagent_results[subagent_id] = content
        completed = self._event(state, "subagent.completed", {"subagent_id": subagent_id})
        if state.pending_subagents:
            return (completed, self._checkpoint(state, "after_subagent"))
        ordered = "\n".join(f"[{key}] completed: {value}" for key, value in state.subagent_results.items())
        state.messages.append({
            "role": "tool", "tool_call_id": state.delegate_call_id,
            "content": ordered,
        })
        state.delegate_call_id = None
        return (
            completed,
            self._checkpoint(state, "after_subagents"),
            self._request(
                state, MessageType.MODEL_REQUEST,
                {"model_id": state.model_id, "messages": state.messages, "tools": state.tools, "skills": state.skills},
                "model_after_subagents",
            ),
        )

    def _model_failed(self, command: RuntimeEnvelope) -> Sequence[RuntimeEnvelope]:
        state = self._require_phase(command.run_id, RunPhase.WAITING_MODEL)
        state.phase = RunPhase.FAILED
        self._active_run_by_session.pop(state.session_id, None)
        return (
            self._event(
                state,
                "run.failed",
                {"code": command.payload.get("code", "model_failed"), "retryable": bool(command.payload.get("retryable", True))},
            ),
            self._checkpoint(state, "terminal"),
        )

    def _lifecycle_changed(self, command: RuntimeEnvelope) -> Sequence[RuntimeEnvelope]:
        state = self._runs.get(command.run_id)
        if state is None or state.terminal:
            raise ValueError("run_not_active")
        lifecycle = self._required_string(command.payload, "state")
        if lifecycle not in {"foreground", "background", "low_memory", "thermal_limited"}:
            raise ValueError("lifecycle_state_invalid")
        state.lifecycle_state = lifecycle
        return (
            self._event(
                state, "runtime.lifecycle_changed",
                {"state": lifecycle, "max_parallel_agents": 2 if lifecycle == "foreground" else 1},
            ),
            self._checkpoint(state, "lifecycle_changed"),
        )

    def _cancel_run(self, command: RuntimeEnvelope) -> Sequence[RuntimeEnvelope]:
        state = self._runs.get(command.run_id)
        if state is None:
            raise ValueError("run_not_found")
        if state.terminal:
            return ()
        subagent_id = command.payload.get("subagent_id")
        if subagent_id is not None:
            child = state.pending_subagents.pop(str(subagent_id), None)
            if child is None:
                raise ValueError("subagent_not_pending")
            cancelled = self._event(state, "subagent.cancelled", {"subagent_id": subagent_id})
            if state.pending_subagents:
                return (cancelled, self._checkpoint(state, "after_subagent_cancel"))
            ordered = "\n".join(f"[{key}] completed: {value}" for key, value in state.subagent_results.items())
            state.messages.append({"role": "tool", "tool_call_id": state.delegate_call_id, "content": ordered})
            state.delegate_call_id = None
            return (
                cancelled,
                self._checkpoint(state, "after_subagents"),
                self._request(
                    state, MessageType.MODEL_REQUEST,
                    {"model_id": state.model_id, "messages": state.messages, "tools": state.tools, "skills": state.skills},
                    "model_after_subagents",
                ),
            )
        state.phase = RunPhase.CANCELLED
        self._active_run_by_session.pop(state.session_id, None)
        return (
            self._event(state, "run.cancelled", {"reason": "user_cancelled"}),
            self._checkpoint(state, "terminal"),
        )

    def snapshot(self, run_id: str) -> dict[str, Any]:
        state = self._runs[run_id]
        return {
            "run_id": state.run_id,
            "session_id": state.session_id,
            "model_id": state.model_id,
            "phase": state.phase.value,
            "outbound_sequence": state.outbound_sequence,
            "messages": state.messages,
            "completed_side_effects": sorted(state.completed_side_effects),
            "pending_tool_calls": dict(state.pending_tool_calls),
            "pending_artifacts": dict(state.pending_artifacts),
            "tools": list(state.tools),
            "skills": list(state.skills),
            "lifecycle_state": state.lifecycle_state,
            "pending_subagents": dict(state.pending_subagents),
            "subagent_results": dict(state.subagent_results),
            "delegate_call_id": state.delegate_call_id,
        }

    def _event(self, state: MobileRunState, kind: str, payload: Mapping[str, Any]) -> RuntimeEnvelope:
        return self._outbound(state, MessageType.RUNTIME_EVENT, {"kind": kind, **payload}, kind)

    def _checkpoint(self, state: MobileRunState, reason: str) -> RuntimeEnvelope:
        return self._outbound(
            state,
            MessageType.CHECKPOINT_REQUEST,
            {"reason": reason, "state": self.snapshot(state.run_id)},
            f"checkpoint:{reason}",
        )

    def _request(
        self,
        state: MobileRunState,
        message_type: MessageType,
        payload: Mapping[str, Any],
        suffix: str,
    ) -> RuntimeEnvelope:
        return self._outbound(state, message_type, payload, suffix)

    def _outbound(
        self,
        state: MobileRunState,
        message_type: MessageType,
        payload: Mapping[str, Any],
        suffix: str,
    ) -> RuntimeEnvelope:
        state.outbound_sequence += 1
        return RuntimeEnvelope(
            message_type=message_type,
            request_id=f"{state.run_id}:{state.outbound_sequence}",
            run_id=state.run_id,
            session_id=state.session_id,
            sequence=state.outbound_sequence,
            idempotency_key=f"{state.run_id}:{state.outbound_sequence}:{suffix}",
            payload=payload,
        )

    def _require_phase(self, run_id: str, phase: RunPhase) -> MobileRunState:
        state = self._runs.get(run_id)
        if state is None:
            raise ValueError("run_not_found")
        if state.phase != phase:
            raise ValueError(f"run_phase_invalid:{state.phase.value}")
        return state

    @staticmethod
    def _required_string(value: Mapping[str, Any], key: str) -> str:
        result = value.get(key)
        if not isinstance(result, str) or not result:
            raise ValueError(f"{key}_required")
        return result


def create_mobile_agent_core() -> MobileAgentCore:
    from .factory import create_shared_mobile_core

    return create_shared_mobile_core(surface="test")
