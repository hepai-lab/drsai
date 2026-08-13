"""Dependency-light shared agent loop for host-driven runtimes."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
import ast
import base64
import copy
import hashlib
import json
import re
from typing import Any, Mapping, Sequence

if __package__ == "mobile_core":  # Android packages the shared runtime directory as a top-level Chaquopy source root.
    from sandbox_compute import execute_declarative_compute
else:
    from ..sandbox_compute import execute_declarative_compute

from .protocol import MessageType, RuntimeEnvelope
from .plan_state import event_kind as plan_event_kind, normalize_plan_state, normalize_plan_update
from .subagents import build_subagent_scheduling_policy
from .context import assemble_mobile_context, build_citation_evidence, build_context_observability, build_execution_tool_registry, build_memory_policy, build_prompt_layer_diagnostics, build_run_capability_snapshot, build_tool_choice_policy, build_tool_decision_requirement, classify_tool_error, completed_tool_decision_domains, execution_tool_record, freeze_model_tool_snapshot, normalize_citation_evidence, normalize_context_budget, normalize_kernel_host_port, normalize_memory_policy, normalize_memory_selection, normalize_model_route_snapshot, normalize_tool_loop_policy, normalize_tool_output, resolve_tool_decision, select_relevant_memories, validate_context_within_budget, validate_conversation_context, validate_memory_tool_call, validate_tool_call_batch, verify_model_tool_calls, verify_run_capability_snapshot


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
WEB_SEARCH_MAX_ATTEMPTS = 3


def _public_retrieval_source_urls(messages: Sequence[Mapping[str, Any]]) -> list[str]:
    """Return exact public URLs already supplied by successful Web retrieval tools."""
    candidates: dict[str, tuple[float, int]] = {}
    order = 0

    def collect(value: Any, key: str = "", parent_score: float = 0.0) -> None:
        nonlocal order
        if isinstance(value, Mapping):
            try:
                local_score = float(value.get("score", parent_score) or parent_score)
            except (TypeError, ValueError):
                local_score = parent_score
            for child_key, child in value.items():
                collect(child, str(child_key), local_score)
        elif isinstance(value, Sequence) and not isinstance(value, (str, bytes)):
            for child in value:
                collect(child, key, parent_score)
        elif isinstance(value, str):
            if key in {"url", "final_url"} and value.startswith("https://"):
                url = value.rstrip(".,;:!?")
                priority = 2.0 if key == "final_url" else parent_score
                previous = candidates.get(url)
                if previous is None:
                    candidates[url] = (priority, order)
                    order += 1
                elif priority > previous[0]:
                    candidates[url] = (priority, previous[1])
            elif key in {"content", "result"} and value.lstrip().startswith("{"):
                try:
                    decoded = json.loads(value)
                except (TypeError, json.JSONDecodeError):
                    try:
                        decoded = ast.literal_eval(value)
                    except (SyntaxError, ValueError):
                        decoded = None
                if isinstance(decoded, Mapping):
                    collect(decoded)

    for message in messages:
        if message.get("role") != "tool" or message.get("succeeded") is False:
            continue
        if str(message.get("name", "")).casefold() not in {"web.search", "web_search", "web.fetch", "web_fetch"}:
            continue
        collect(message.get("content", {}), "content")
    return [url for url, _ in sorted(candidates.items(), key=lambda item: (-item[1][0], item[1][1]))]


def _knowledge_retrieval_sources(messages: Sequence[Mapping[str, Any]]) -> list[str]:
    """Return bounded source references supplied by successful knowledge tools."""
    sources: dict[str, None] = {}

    def collect(value: Any, key: str = "") -> None:
        if isinstance(value, Mapping):
            for child_key, child in value.items():
                collect(child, str(child_key))
        elif isinstance(value, Sequence) and not isinstance(value, (str, bytes)):
            for child in value:
                collect(child, key)
        elif isinstance(value, str):
            if key == "source" and value and len(value) <= 2000 and "\n" not in value and "\r" not in value:
                sources.setdefault(value, None)
            elif key in {"content", "result"} and value.lstrip().startswith("{"):
                try:
                    decoded = json.loads(value)
                except (TypeError, json.JSONDecodeError):
                    try:
                        decoded = ast.literal_eval(value)
                    except (SyntaxError, ValueError):
                        decoded = None
                if isinstance(decoded, Mapping):
                    collect(decoded)

    for message in messages:
        if message.get("role") != "tool" or message.get("succeeded") is False:
            continue
        if str(message.get("name", "")).casefold() != "knowledge_search":
            continue
        collect(message.get("content", {}), "content")
    return list(sources)


def _memory_retrieval_sources(messages: Sequence[Mapping[str, Any]]) -> list[str]:
    """Return exact, bounded memory markers supplied by successful memory tools."""
    sources: dict[str, None] = {}
    for message in messages:
        if message.get("role") != "tool" or message.get("succeeded") is False:
            continue
        if str(message.get("name", "")).casefold() not in {
            "search_memory", "retrieve_from_memory", "read_session_memory_by_index",
        }:
            continue
        content = message.get("content", {})
        if isinstance(content, str):
            try:
                content = json.loads(content)
            except (TypeError, json.JSONDecodeError):
                content = {}
        if not isinstance(content, Mapping):
            continue
        rows = content.get("items", content.get("results", []))
        if not isinstance(rows, Sequence) or isinstance(rows, (str, bytes)):
            continue
        for row in rows:
            if not isinstance(row, Mapping):
                continue
            source_id = str(row.get("source_id") or "").strip()
            if not source_id:
                memory_id = str(row.get("id") or "").strip()
                source_id = f"memory:{memory_id}" if memory_id else ""
            if re.fullmatch(r"memory:[A-Za-z0-9._:-]{1,160}", source_id):
                sources.setdefault(f"[{source_id}]", None)
    return list(sources)


def _web_search_query_terms(query: str) -> frozenset[str]:
    normalized = query.casefold()
    normalized = re.sub(r"(?<=[a-z])(?=[0-9])|(?<=[0-9])(?=[a-z])", " ", normalized)
    ignored = {
        "about", "and", "conference", "current", "find", "for", "latest", "official",
        "search", "the", "what", "workshop", "介绍", "什么", "如何", "是什么", "查询", "搜索", "最新",
    }
    return frozenset(
        value
        for value in re.findall(r"[a-z]+|[0-9]+|[\u4e00-\u9fff]{2,}", normalized)
        if value not in ignored
    )


def _web_search_queries_are_near_duplicates(left: str, right: str) -> bool:
    left_terms = _web_search_query_terms(left)
    right_terms = _web_search_query_terms(right)
    if not left_terms or not right_terms:
        return " ".join(left.casefold().split()) == " ".join(right.casefold().split())
    overlap = len(left_terms & right_terms)
    return left_terms == right_terms or overlap / len(left_terms | right_terms) >= 0.8


@dataclass(slots=True)
class MobileRunState:
    run_id: str
    session_id: str
    model_id: str
    model_route_snapshot: dict[str, Any] = field(default_factory=dict)
    phase: RunPhase = RunPhase.RUNNING
    outbound_sequence: int = 0
    messages: list[dict[str, Any]] = field(default_factory=list)
    completed_side_effects: set[str] = field(default_factory=set)
    pending_tool_calls: dict[str, Mapping[str, Any]] = field(default_factory=dict)
    pending_artifacts: dict[str, dict[str, Any]] = field(default_factory=dict)
    tools: list[dict[str, Any]] = field(default_factory=list)
    skills: list[dict[str, Any]] = field(default_factory=list)
    host_capabilities: list[str] = field(default_factory=list)
    blocked_capabilities: list[dict[str, str]] = field(default_factory=list)
    remote_capabilities: list[str] = field(default_factory=list)
    capability_snapshot: dict[str, Any] = field(default_factory=dict)
    model_tool_snapshot: dict[str, Any] = field(default_factory=dict)
    execution_tool_registry: dict[str, Any] = field(default_factory=dict)
    tool_loop_policy: dict[str, Any] = field(default_factory=dict)
    tool_decision_requirement: dict[str, Any] = field(default_factory=dict)
    prompt_layer_diagnostics: list[dict[str, Any]] = field(default_factory=list)
    context_budget: dict[str, Any] = field(default_factory=dict)
    context_observability: dict[str, Any] = field(default_factory=dict)
    memory_policy: dict[str, Any] = field(default_factory=dict)
    memory_selection: dict[str, Any] = field(default_factory=dict)
    verification_retry_count: int = 0
    citation_retry_count: int = 0
    citation_evidence: dict[str, Any] = field(default_factory=dict)
    tool_round_count: int = 0
    tool_execution_disabled: bool = False
    web_search_queries: list[str] = field(default_factory=list)
    web_search_exhausted: bool = False
    lifecycle_state: str = "foreground"
    subagent_scheduling_policy: dict[str, Any] = field(default_factory=dict)
    pending_subagents: dict[str, dict[str, Any]] = field(default_factory=dict)
    subagent_results: dict[str, str] = field(default_factory=dict)
    subagent_failures: dict[str, dict[str, Any]] = field(default_factory=dict)
    delegate_call_id: str | None = None
    plan_state: dict[str, Any] = field(default_factory=dict)

    @property
    def terminal(self) -> bool:
        return self.phase in TERMINAL_PHASES


class DrSaiAgentKernel:
    """The single dependency-light Agent Loop constructed for every production surface."""

    agent_type = "drsai-agent-kernel"

    def __init__(self) -> None:
        self._runs: dict[str, MobileRunState] = {}
        self._active_run_by_session: dict[str, str] = {}
        self._replies_by_idempotency_key: dict[tuple[str, str], tuple[RuntimeEnvelope, ...]] = {}

    def _runtime_surface(self) -> str:
        """Return the factory-bound capability surface, never a caller payload value."""

        surface = getattr(self, "_factory_runtime_surface", "android")
        if surface not in {"android", "desktop"}:
            raise RuntimeError("agent_kernel_runtime_surface_invalid")
        return surface

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
        state.model_route_snapshot = normalize_model_route_snapshot(
            command.payload.get("model_route_snapshot"), model_id,
        )
        raw_tools = command.payload.get("tools", [])
        raw_skills = command.payload.get("skills", [])
        # `host_port` is the sole current capability contract. The flat field
        # remains read-only migration input for pre-Host-Port checkpoints and
        # clients, and may never contradict the versioned contract.
        legacy_host_capabilities_present = "host_capabilities" in command.payload
        raw_host_capabilities = command.payload.get("host_capabilities", [])
        raw_diagnostics = command.payload.get("capability_diagnostics", {})
        if not isinstance(raw_tools, list) or not all(isinstance(value, Mapping) for value in raw_tools):
            raise ValueError("run_tools_invalid")
        if not isinstance(raw_skills, list) or not all(isinstance(value, Mapping) for value in raw_skills):
            raise ValueError("run_skills_invalid")
        if not isinstance(raw_host_capabilities, list) or not all(
            isinstance(value, str) for value in raw_host_capabilities
        ):
            raise ValueError("run_host_capabilities_invalid")
        if not isinstance(raw_diagnostics, Mapping):
            raise ValueError("run_capability_diagnostics_invalid")
        raw_blocked = raw_diagnostics.get("blocked", [])
        raw_remote = raw_diagnostics.get("remote_available", [])
        if not isinstance(raw_blocked, list) or not all(isinstance(value, Mapping) for value in raw_blocked):
            raise ValueError("run_blocked_capabilities_invalid")
        if not isinstance(raw_remote, list):
            raise ValueError("run_remote_capabilities_invalid")
        state.tools = [dict(value) for value in raw_tools]
        state.skills = [dict(value) for value in raw_skills]
        runtime_surface = self._runtime_surface()
        host_port = normalize_kernel_host_port(
            command.payload.get("host_port"),
            surface=runtime_surface,
            legacy_capabilities=raw_host_capabilities,
        )
        if command.payload.get("host_port") is not None and legacy_host_capabilities_present:
            if sorted(set(raw_host_capabilities)) != list(host_port["capabilities"]):
                raise ValueError("run_host_capabilities_conflict")
        state.host_capabilities = list(host_port["capabilities"])
        state.blocked_capabilities = [dict(value) for value in raw_blocked]
        state.remote_capabilities = list(raw_remote)
        # Validate the complete host/skill contract before deriving the active
        # tool set. This prevents a signed Skill from naming a missing tool and
        # then hiding that error through filtering.
        build_run_capability_snapshot(
            runtime_surface, state.tools, state.skills, state.host_capabilities,
            state.blocked_capabilities, state.remote_capabilities,
        )
        active_local_skills = [
            value for value in state.skills if value.get("availability") == "local"
        ]
        if active_local_skills:
            allowed_tool_names = {
                str(name)
                for skill in active_local_skills
                for name in skill.get("tools", [])
            }
            state.tools = [
                value for value in state.tools if value.get("name") in allowed_tool_names
            ]
        state.capability_snapshot = build_run_capability_snapshot(
            runtime_surface, state.tools, state.skills, state.host_capabilities,
            state.blocked_capabilities, state.remote_capabilities,
        )
        state.model_tool_snapshot = freeze_model_tool_snapshot(runtime_surface, state.tools)
        state.execution_tool_registry = build_execution_tool_registry(
            runtime_surface, state.tools, self._execution_registry_metadata(state.tools), state.host_capabilities,
        )
        state.tool_loop_policy = normalize_tool_loop_policy(command.payload.get("tool_loop_policy"))
        state.tool_decision_requirement = build_tool_decision_requirement(
            input_text, [str(value["name"]) for value in state.tools],
        )
        raw_satisfied_domains = command.payload.get("satisfied_capability_domains", [])
        if not isinstance(raw_satisfied_domains, list) or not all(
            isinstance(value, str) for value in raw_satisfied_domains
        ):
            raise ValueError("run_satisfied_capability_domains_invalid")
        satisfied_domains = set(raw_satisfied_domains)
        # Keep this set aligned with agent_kernel._tool_decision_domain. A
        # trusted Host may satisfy any domain with already-captured evidence;
        # restricting this to the original five domains made isolated
        # regression Judges re-run process/image/plan capabilities even though
        # their complete candidate evidence was supplied inline.
        if not satisfied_domains.issubset({
            "retrieval", "workspace", "process", "device", "time", "memory",
            "plan", "image_generation", "image_edit",
        }):
            raise ValueError("run_satisfied_capability_domains_invalid")
        if satisfied_domains:
            requirement = dict(state.tool_decision_requirement)
            requirement["required_domains"] = [
                value for value in requirement.get("required_domains", []) if value not in satisfied_domains
            ]
            if not requirement["required_domains"]:
                requirement["reason"] = "requirement_satisfied_by_trusted_evidence"
            unsigned_requirement = {key: value for key, value in requirement.items() if key != "sha256"}
            requirement["sha256"] = hashlib.sha256(json.dumps(
                unsigned_requirement, ensure_ascii=False, separators=(",", ":"), sort_keys=True,
            ).encode("utf-8")).hexdigest()
            state.tool_decision_requirement = requirement
        state.context_budget = normalize_context_budget(command.payload.get("context_budget"))
        memory_enabled = command.payload.get("memory_enabled", True)
        if not isinstance(memory_enabled, bool):
            raise ValueError("memory_enabled_invalid")
        state.memory_policy = build_memory_policy(input_text, enabled=memory_enabled)
        raw_memory_candidates = command.payload.get("memory_candidates", []) if memory_enabled else []
        state.memory_selection = select_relevant_memories(input_text, raw_memory_candidates)
        raw_agent = command.payload.get("agent")
        if raw_agent is not None and not isinstance(raw_agent, Mapping):
            raise ValueError("agent_config_invalid")
        effective_agent = dict(raw_agent or {})
        if state.memory_selection["summary"]:
            if effective_agent.get("memory_summary"):
                raise ValueError("memory_summary_host_conflict")
            effective_agent["memory_summary"] = state.memory_selection["summary"]
        state.prompt_layer_diagnostics = build_prompt_layer_diagnostics(effective_agent, state.skills)
        state.lifecycle_state = str(command.payload.get("lifecycle_state", "foreground"))
        state.subagent_scheduling_policy = build_subagent_scheduling_policy(
            state.lifecycle_state,
            advertised_max_active=command.payload.get("subagent_max_active"),
            advertised_max_parallel=command.payload.get("subagent_max_parallel"),
        )
        history = command.payload.get("history", [])
        if not isinstance(history, list):
            raise ValueError("history_invalid")
        state.messages = assemble_mobile_context(
            history,
            input_text,
            agent=effective_agent,
            skills=state.skills,
            context_budget=state.context_budget,
        )
        state.context_observability = build_context_observability(
            effective_agent, state.skills, state.messages, state.context_budget,
            history_message_count=len(history),
        )
        self._runs[state.run_id] = state
        self._active_run_by_session[state.session_id] = state.run_id
        started = self._event(state, "run.started", {
            "status": "running",
            "capability_snapshot_sha256": state.capability_snapshot["sha256"],
            "capability_snapshot_version": state.capability_snapshot["snapshot_version"],
            "capability_diagnostics": state.capability_snapshot["diagnostics"],
            "tool_manifest_version": state.capability_snapshot["tool_manifest_version"],
            "tool_count": len(state.tools),
            "skill_count": len(state.skills),
            "skill_snapshot": [{
                "id": skill["id"],
                "version": skill["version"],
                "source": skill["source"],
                "availability": skill["availability"],
                "required_capabilities": sorted(set(skill.get("capabilities", []))),
                "allowed_tools": sorted(set(skill.get("tools", []))),
                "digest": skill["digest"],
                "instructions_sha256": hashlib.sha256(skill.get("instructions", "").encode("utf-8")).hexdigest(),
            } for skill in state.skills],
            "host_port_protocol_version": host_port["protocol_version"],
            "host_port_sha256": host_port["sha256"],
            "model_tool_snapshot_version": state.model_tool_snapshot["snapshot_version"],
            "model_tool_snapshot_sha256": state.model_tool_snapshot["sha256"],
            "execution_tool_registry_version": state.execution_tool_registry["registry_version"],
            "execution_tool_registry_sha256": state.execution_tool_registry["sha256"],
            "tool_loop_policy_version": state.tool_loop_policy["policy_version"],
            "tool_loop_policy_sha256": state.tool_loop_policy["sha256"],
            "tool_decision_required_domains": list(state.tool_decision_requirement.get("required_domains", [])),
            "tool_decision_reason": state.tool_decision_requirement.get("reason"),
            "prompt_layers": state.prompt_layer_diagnostics,
            "context_budget": validate_context_within_budget(state.messages, state.context_budget),
            "context_observability": state.context_observability,
            "memory_policy": state.memory_policy,
            "memory_selection": {key: state.memory_selection[key] for key in ("policy_version", "selected", "omitted", "sha256")},
            "subagent_scheduling": dict(state.subagent_scheduling_policy),
        })
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
            {
                "model_id": state.model_id, "messages": state.messages, "tools": state.tools, "skills": state.skills,
                "capability_snapshot_sha256": state.capability_snapshot["sha256"],
            },
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
        raw_web_search_queries = raw.get("web_search_queries", [])
        raw_web_search_exhausted = raw.get("web_search_exhausted", False)
        raw_tool_execution_disabled = raw.get("tool_execution_disabled", False)
        if not isinstance(raw_web_search_queries, list) or not all(
            isinstance(value, str) and len(value) <= 500 for value in raw_web_search_queries
        ):
            raise ValueError("web_search_queries_invalid")
        if not isinstance(raw_web_search_exhausted, bool):
            raise ValueError("web_search_exhausted_invalid")
        if not isinstance(raw_tool_execution_disabled, bool):
            raise ValueError("tool_execution_disabled_invalid")
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
            host_capabilities=list(raw.get("host_capabilities", [])),
            blocked_capabilities=[dict(value) for value in raw.get("blocked_capabilities", [])],
            remote_capabilities=list(raw.get("remote_capabilities", [])),
            lifecycle_state=str(raw.get("lifecycle_state", "foreground")),
            subagent_scheduling_policy=dict(raw.get("subagent_scheduling_policy", {})),
            pending_subagents={str(key): dict(value) for key, value in raw.get("pending_subagents", {}).items()},
            subagent_results={str(key): str(value) for key, value in raw.get("subagent_results", {}).items()},
            subagent_failures={str(key): dict(value) for key, value in raw.get("subagent_failures", {}).items()},
            delegate_call_id=raw.get("delegate_call_id"),
            plan_state=normalize_plan_state(raw.get("plan_state")),
            model_route_snapshot=normalize_model_route_snapshot(
                raw.get("model_route_snapshot"), self._required_string(raw, "model_id"),
            ),
            tool_round_count=int(raw.get("tool_round_count", 0)),
            tool_execution_disabled=raw_tool_execution_disabled,
            web_search_queries=list(raw_web_search_queries),
            web_search_exhausted=raw_web_search_exhausted,
            tool_decision_requirement=dict(raw.get("tool_decision_requirement", {})),
            verification_retry_count=int(raw.get("verification_retry_count", 0)),
            citation_retry_count=int(raw.get("citation_retry_count", 0)),
            citation_evidence=normalize_citation_evidence(raw.get("citation_evidence")),
            prompt_layer_diagnostics=[dict(value) for value in raw.get("prompt_layer_diagnostics", [])],
            context_budget=normalize_context_budget(raw.get("context_budget")),
            context_observability=dict(raw.get("context_observability", {})),
            memory_policy=normalize_memory_policy(
                raw.get("memory_policy") or build_memory_policy("", enabled=False)
            ),
            memory_selection=normalize_memory_selection(
                raw.get("memory_selection") or select_relevant_memories("[resume]", [])
            ),
        )
        expected_scheduling = build_subagent_scheduling_policy(state.lifecycle_state)
        if state.subagent_scheduling_policy and state.subagent_scheduling_policy != expected_scheduling:
            raise ValueError("subagent_scheduling_policy_mismatch")
        state.subagent_scheduling_policy = expected_scheduling
        if not state.tool_decision_requirement:
            # Legacy checkpoints predate redacted Tool-decision diagnostics. They
            # cannot safely reconstruct the original classification without input.
            state.tool_decision_requirement = build_tool_decision_requirement(
                "", [str(value["name"]) for value in state.tools],
            )
        restored_conversation = validate_conversation_context(
            state.messages, require_complete_tool_calls=not bool(
                state.pending_tool_calls or state.pending_subagents or state.delegate_call_id
            ),
        )
        stored_conversation = raw.get("conversation_context")
        if stored_conversation is not None and dict(stored_conversation) != restored_conversation:
            raise ValueError("conversation_context_mismatch")
        runtime_surface = self._runtime_surface()
        stored_snapshot = raw.get("capability_snapshot")
        if stored_snapshot is None:  # v1.5.6 checkpoint migration.
            state.capability_snapshot = build_run_capability_snapshot(
                runtime_surface, state.tools, state.skills, state.host_capabilities,
                state.blocked_capabilities, state.remote_capabilities,
            )
        else:
            state.capability_snapshot = verify_run_capability_snapshot(
                stored_snapshot,
                surface=runtime_surface,
                tools=state.tools,
                skills=state.skills,
                host_capabilities=state.host_capabilities,
                blocked_capabilities=state.blocked_capabilities,
                remote_capabilities=state.remote_capabilities,
            )
        expected_model_tools = freeze_model_tool_snapshot(runtime_surface, state.tools)
        stored_model_tools = raw.get("model_tool_snapshot")
        if stored_model_tools is not None and dict(stored_model_tools) != expected_model_tools:
            raise ValueError("model_tool_snapshot_mismatch")
        state.model_tool_snapshot = expected_model_tools
        expected_execution_registry = build_execution_tool_registry(
            runtime_surface, state.tools, self._execution_registry_metadata(state.tools), state.host_capabilities,
        )
        stored_execution_registry = raw.get("execution_tool_registry")
        if stored_execution_registry is not None and dict(stored_execution_registry) != expected_execution_registry:
            raise ValueError("execution_tool_registry_mismatch")
        state.execution_tool_registry = expected_execution_registry
        stored_tool_loop_policy = raw.get("tool_loop_policy")
        expected_tool_loop_policy = normalize_tool_loop_policy(stored_tool_loop_policy)
        if stored_tool_loop_policy is not None and dict(stored_tool_loop_policy) != expected_tool_loop_policy:
            raise ValueError("tool_loop_policy_mismatch")
        if state.tool_round_count < 0 or state.tool_round_count > expected_tool_loop_policy["max_tool_rounds"]:
            raise ValueError("tool_round_count_invalid")
        state.tool_loop_policy = expected_tool_loop_policy
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
                        {**dict(task["model_request"]), "subagent_id": task_id,
                         "subagent_kernel_sha256": task["kernel_sha256"],
                         "parent_context_sha256": task["parent_context_sha256"]},
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
                    {
                        "model_id": state.model_id, "messages": state.messages, "tools": state.tools,
                        "skills": state.skills,
                        "capability_snapshot_sha256": state.capability_snapshot["sha256"],
                    },
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
        reasoning_summary = command.payload.get("reasoning_summary", "")
        if not isinstance(delta, str):
            raise ValueError("model_delta_invalid")
        if not isinstance(reasoning_summary, str):
            raise ValueError("model_reasoning_summary_invalid")
        if not delta and not reasoning_summary:
            return ()
        subagent_id = command.payload.get("subagent_id")
        if subagent_id is not None:
            if subagent_id not in state.pending_subagents:
                raise ValueError("subagent_not_pending")
            return (self._event(state, "subagent.thinking", {"subagent_id": subagent_id, "text": delta}),)
        replies = []
        if reasoning_summary:
            replies.append(self._event(state, "reasoning.delta", {"text": reasoning_summary}))
        if delta:
            # Retrieval-required turns are buffered by the Host and released only
            # after the completed Tool decision is verified. This prevents an
            # unverified streamed answer from reaching UI before fail-closed policy.
            if not state.tool_decision_requirement.get("required_domains"):
                replies.append(self._event(state, "message.delta", {"text": delta}))
        return tuple(replies)

    @staticmethod
    def _visible_tools(state: MobileRunState) -> list[dict[str, Any]]:
        if state.tool_execution_disabled:
            return []
        if not state.web_search_exhausted:
            return list(state.tools)
        return [tool for tool in state.tools if tool.get("name") != "web_search"]

    def _request_budget_finalization(
        self,
        state: MobileRunState,
        *,
        code: str,
        reasoning_events: Sequence[RuntimeEnvelope],
        decision_event: RuntimeEnvelope,
        details: Mapping[str, Any],
    ) -> Sequence[RuntimeEnvelope]:
        """Stop admitting tools but give the model one tool-free turn to deliver the result."""

        state.tool_execution_disabled = True
        instruction = (
            "The tool-execution budget for this turn is exhausted. Do not call more tools. "
            "Complete the user's request now from the evidence and artifacts already available. "
            "Be explicit about any remaining limitation instead of asking the user to restart."
        )
        maximum_messages = int(state.context_budget.get("max_messages", 20))
        if len(state.messages) < maximum_messages:
            state.messages.append({"role": "system", "content": instruction})
        else:
            # Preserve every completed Tool call/result pair when the message
            # budget is exactly full; fold the finalization directive into the
            # authoritative system message instead of splitting a Tool chain.
            state.messages[0] = {
                **state.messages[0],
                "content": f"{state.messages[0].get('content', '')}\n\n{instruction}",
            }
        state.phase = RunPhase.WAITING_MODEL
        return (
            *reasoning_events,
            decision_event,
            self._event(state, "tool.budget_exhausted", {
                "code": code,
                "retryable": False,
                "action": "finalize_without_tools",
                **dict(details),
            }),
            self._checkpoint(state, "before_budget_finalization"),
            self._request(state, MessageType.MODEL_REQUEST, {
                "model_id": state.model_id,
                "messages": state.messages,
                "tools": [],
                "skills": state.skills,
                "capability_snapshot_sha256": state.capability_snapshot["sha256"],
            }, "budget_finalization"),
        )

    def _finish_rejected_web_search_round(
        self,
        state: MobileRunState,
        tool_calls: Sequence[Mapping[str, Any]],
        *,
        reason: str,
        reasoning_events: Sequence[RuntimeEnvelope],
        decision_event: RuntimeEnvelope,
    ) -> Sequence[RuntimeEnvelope]:
        """Close the model's Tool protocol while enforcing a per-turn search circuit breaker."""

        normalized_calls = [
            {
                "call_id": self._required_string(call, "call_id"),
                "name": "web_search",
                "arguments": dict(call.get("arguments", {})),
            }
            for call in tool_calls
        ]
        state.messages.append({"role": "assistant", "content": "", "tool_calls": normalized_calls})
        events: list[RuntimeEnvelope] = []
        for call in normalized_calls:
            query = str(call["arguments"].get("query", "")).strip()
            result = {
                "version": 1,
                "query": query,
                "provider": "runtime-policy",
                "results": [],
                "partial": True,
                "warnings": [reason],
            }
            state.messages.append({
                "role": "tool",
                "tool_call_id": call["call_id"],
                "name": "web_search",
                "content": result,
                "succeeded": True,
            })
            state.completed_side_effects.add(call["call_id"])
            events.append(self._event(state, "tool.result", {
                "call_id": call["call_id"],
                "item_id": f"{state.run_id}:tool:{call['call_id']}",
                "name": "web_search",
                "tool_kind": "host",
                "arguments": dict(call["arguments"]),
                "result": result,
                "succeeded": True,
                "policy_blocked": True,
            }))
        state.web_search_exhausted = True
        exhausted_event = self._event(state, "web_search.exhausted", {
            "reason": reason,
            "attempt_count": len(state.web_search_queries),
            "maximum_attempts": WEB_SEARCH_MAX_ATTEMPTS,
        })
        evidence = build_citation_evidence(state.messages, "", retrieval_required=False)
        if not evidence["source_url_sha256"]:
            limitation = self._web_search_limitation(state)
            state.messages.append({"role": "assistant", "content": limitation})
            state.phase = RunPhase.COMPLETED
            self._active_run_by_session.pop(state.session_id, None)
            return (
                *reasoning_events,
                decision_event,
                *events,
                exhausted_event,
                self._event(state, "message.completed", {
                    "item_id": f"{state.run_id}:assistant",
                    "role": "assistant",
                    "text": limitation,
                    "phase": "final",
                }),
                self._event(state, "run.completed", {"status": "completed_with_limitation"}),
                self._checkpoint(state, "terminal"),
            )
        state.phase = RunPhase.WAITING_MODEL
        return (
            *reasoning_events,
            decision_event,
            *events,
            exhausted_event,
            self._checkpoint(state, "after_web_search_circuit_breaker"),
            self._request(
                state,
                MessageType.MODEL_REQUEST,
                {
                    "model_id": state.model_id,
                    "messages": state.messages,
                    "tools": state.tools,
                    "skills": state.skills,
                    "capability_snapshot_sha256": state.capability_snapshot["sha256"],
                    "tool_choice": build_tool_choice_policy(
                        state.tool_decision_requirement,
                        [str(tool.get("name", "")) for tool in self._visible_tools(state)],
                        prior_tool_use=True,
                        disabled=True,
                    ),
                },
                "model_after_web_search_circuit_breaker",
            ),
        )

    @staticmethod
    def _web_search_limitation(state: MobileRunState) -> str:
        user_text = next(
            (str(message.get("content", "")) for message in reversed(state.messages) if message.get("role") == "user"),
            "",
        )
        if any("\u4e00" <= character <= "\u9fff" for character in user_text):
            return "未找到足够可靠的公开网络搜索结果。你可以补充更完整的名称、官方网站或相关领域后重试。"
        return (
            "No sufficiently reliable public web results were found. "
            "Provide a fuller name, an official site, or the relevant field and try again."
        )

    def _complete_ignored_exhausted_web_search(
        self,
        state: MobileRunState,
        *,
        reasoning_events: Sequence[RuntimeEnvelope],
    ) -> Sequence[RuntimeEnvelope]:
        limitation = self._web_search_limitation(state)
        state.messages.append({"role": "assistant", "content": limitation})
        state.phase = RunPhase.COMPLETED
        self._active_run_by_session.pop(state.session_id, None)
        return (
            *reasoning_events,
            self._event(state, "web_search.exhausted_tool_ignored", {
                "code": "web_search_budget_exhausted",
                "attempt_count": len(state.web_search_queries),
                "retryable": False,
            }),
            self._event(state, "message.completed", {
                "item_id": f"{state.run_id}:assistant",
                "role": "assistant",
                "text": limitation,
                "phase": "final",
            }),
            self._event(state, "run.completed", {"status": "completed_with_limitation"}),
            self._checkpoint(state, "terminal"),
        )

    def _model_completed(self, command: RuntimeEnvelope) -> Sequence[RuntimeEnvelope]:
        state = self._require_phase(command.run_id, RunPhase.WAITING_MODEL)
        content = command.payload.get("content", "")
        if not isinstance(content, str):
            raise ValueError("model_content_invalid")
        reasoning_summary = command.payload.get("reasoning_summary", "")
        if not isinstance(reasoning_summary, str):
            raise ValueError("model_reasoning_summary_invalid")
        reasoning_events = () if not reasoning_summary else (self._event(state, "reasoning.completed", {
            "item_id": f"{state.run_id}:reasoning", "segments": [
                {"id": "summary-1", "text": reasoning_summary},
            ],
        }),)
        subagent_id = command.payload.get("subagent_id")
        if subagent_id is not None:
            return self._subagent_completed(state, str(subagent_id), content)
        tool_calls = command.payload.get("tool_calls", [])
        if not isinstance(tool_calls, list):
            raise ValueError("tool_calls_invalid")
        preferred_tools = state.tool_decision_requirement.get("preferred_tools", [])
        if isinstance(preferred_tools, list) and len(preferred_tools) == 1:
            preferred_name = preferred_tools[0]
            matching_calls = [
                value for value in tool_calls
                if isinstance(value, Mapping) and value.get("name") == preferred_name
            ]
            # A specified P9 task executes at most one matching call per
            # model turn. Reasoning providers sometimes emit duplicate calls
            # with alternate queries even when only one Tool is visible.
            if matching_calls:
                tool_calls = matching_calls[:1]
        if state.web_search_exhausted and any(
            isinstance(value, Mapping) and value.get("name") == "web_search" for value in tool_calls
        ):
            return self._complete_ignored_exhausted_web_search(
                state,
                reasoning_events=reasoning_events,
            )
        verify_model_tool_calls(
            freeze_model_tool_snapshot(self._runtime_surface(), self._visible_tools(state)),
            tool_calls,
        )
        decision = resolve_tool_decision(
            state.tool_decision_requirement,
            [str(value.get("name", "")) for value in tool_calls if isinstance(value, Mapping)],
            prior_tool_use=state.tool_round_count > 0 or bool(state.completed_side_effects),
            prior_tool_domains=completed_tool_decision_domains(state.messages),
        )
        decision_event = self._event(state, "tool.decision", {
            **decision,
            "required_domains": list(state.tool_decision_requirement.get("required_domains", [])),
            "tool_round_count": state.tool_round_count,
        })
        if decision["category"] == "required_tool_unavailable":
            limitation = (
                "当前运行位置缺少完成核实所需的检索或主机能力；请连接 Desktop Runtime 或启用相应工具后重试。"
                if any("\u4e00" <= character <= "\u9fff" for character in state.messages[-1].get("content", ""))
                else "The verification capability required for this task is unavailable here. "
                     "Connect Desktop Runtime or enable the required tool and try again."
            )
            state.messages.append({"role": "assistant", "content": limitation})
            state.phase = RunPhase.COMPLETED
            self._active_run_by_session.pop(state.session_id, None)
            return (*reasoning_events, decision_event,
                self._event(state, "verification.unavailable", {
                    "code": "required_capability_unavailable",
                    "reason": decision["reason"],
                    "requirement_sha256": decision["requirement_sha256"],
                }),
                self._event(state, "message.completed", {
                    "item_id": f"{state.run_id}:assistant", "role": "assistant", "text": limitation, "phase": "final",
                }),
                self._event(state, "run.completed", {"status": "completed_with_limitation"}),
                self._checkpoint(state, "terminal"),
            )
        if decision["category"] in {"required_tool_omitted", "wrong_tool_selected"}:
            if state.verification_retry_count >= 1:
                state.phase = RunPhase.FAILED
                self._active_run_by_session.pop(state.session_id, None)
                return (*reasoning_events, decision_event,
                    self._event(state, "run.failed", {
                        "code": "verification_required_tool_omitted", "retryable": True,
                    }),
                    self._checkpoint(state, "terminal"),
                )
            state.verification_retry_count += 1
            state.messages.append({
                "role": "system",
                "content": "Verification is required for this task. Use an available matching retrieval or Host tool "
                           "before answering. If it cannot be used, state the capability limitation explicitly.",
            })
            state.phase = RunPhase.WAITING_MODEL
            return (*reasoning_events, decision_event,
                self._event(state, "verification.required", {
                    "code": decision["category"], "reason": decision["reason"],
                    "requirement_sha256": decision["requirement_sha256"],
                    "retry_count": state.verification_retry_count,
                }),
                self._checkpoint(state, "before_verification_retry"),
                self._request(state, MessageType.MODEL_REQUEST, {
                    "model_id": state.model_id, "messages": state.messages, "tools": state.tools, "skills": state.skills,
                    "capability_snapshot_sha256": state.capability_snapshot["sha256"],
                }, "verification_retry"),
            )
        if tool_calls:
            max_messages = int(state.context_budget.get("max_messages", 20))
            # Reserve one message for a policy instruction or final answer.
            # This guards the next model request before mutating the active
            # chain, instead of letting validation raise after Tool execution.
            projected_messages = len(state.messages) + 1 + len(tool_calls) + 1
            if projected_messages > max_messages:
                return self._request_budget_finalization(
                    state,
                    code="tool_context_budget_exhausted",
                    reasoning_events=reasoning_events,
                    decision_event=decision_event,
                    details={
                        "message_count": len(state.messages),
                        "projected_message_count": projected_messages,
                        "maximum_messages": max_messages,
                    },
                )
            if state.tool_round_count >= state.tool_loop_policy["max_tool_rounds"]:
                return self._request_budget_finalization(
                    state,
                    code="tool_round_limit",
                    reasoning_events=reasoning_events,
                    decision_event=decision_event,
                    details={
                        "tool_round_count": state.tool_round_count,
                        "max_tool_rounds": state.tool_loop_policy["max_tool_rounds"],
                    },
                )
            validate_tool_call_batch(
                state.execution_tool_registry,
                tool_calls,
                max_parallel_tool_calls=state.tool_loop_policy["max_parallel_tool_calls"],
            )
            for raw_call in tool_calls:
                call_id = self._required_string(raw_call, "call_id")
                if call_id in state.pending_tool_calls or call_id in state.completed_side_effects:
                    raise ValueError("tool_call_duplicate")
            state.tool_round_count += 1
        citation_event: tuple[RuntimeEnvelope, ...] = ()
        if not tool_calls:
            citation = build_citation_evidence(
                state.messages, content,
                retrieval_required="retrieval" in state.tool_decision_requirement.get("required_domains", ()),
            )
            state.citation_evidence = citation
            if not citation["valid"]:
                if state.citation_retry_count >= 1:
                    # The retrieval itself succeeded, so a model formatting miss
                    # must not discard an otherwise useful answer. When the only
                    # problem is a missing citation, append an exact URL from the
                    # trusted Tool result and validate the repaired answer again.
                    source_urls = _public_retrieval_source_urls(state.messages)
                    knowledge_sources = _knowledge_retrieval_sources(state.messages)
                    memory_sources = _memory_retrieval_sources(state.messages)
                    trusted_sources = [*source_urls, *knowledge_sources, *memory_sources]
                    if trusted_sources:
                        # Remove every model-authored URL before attaching trusted
                        # Tool URLs. This also safely handles subtly altered paths,
                        # tracking parameters, or genuinely fabricated citations.
                        content = re.sub(r"https://[^\s<>\]\[(){}\"']+", "", content).rstrip()
                        content = re.sub(r"\[([^\]]+)\]\(\s*\)", r"\1", content)
                        content += "\n\nSources:\n" + "\n".join(
                            f"- {source}" for source in trusted_sources[:3]
                        )
                        citation = build_citation_evidence(
                            state.messages, content,
                            retrieval_required="retrieval" in state.tool_decision_requirement.get("required_domains", ()),
                        )
                        state.citation_evidence = citation
                    if not citation["valid"]:
                        warning = (
                            "\n\n> Note: Retrieved information was available, but some source citations "
                            "could not be fully verified. Review the listed sources before relying on sensitive details."
                        )
                        content = f"{content.rstrip()}{warning}"
                        state.messages.append({"role": "assistant", "content": content})
                        state.phase = RunPhase.COMPLETED
                        self._active_run_by_session.pop(state.session_id, None)
                        return (*reasoning_events, decision_event,
                            self._event(state, "citation.warning", {
                                "code": "citation_evidence_incomplete",
                                "message": "Retrieved information was available, but some source citations could not be fully verified.",
                                "citation_sha256": citation["sha256"],
                            }),
                            self._event(state, "message.completed", {
                                "item_id": f"{state.run_id}:assistant",
                                "role": "assistant",
                                "text": content,
                                "phase": "final",
                                "warning_code": "citation_evidence_incomplete",
                            }),
                            self._event(state, "run.completed", {
                                "status": "completed_with_warning",
                                "warning_code": "citation_evidence_incomplete",
                            }),
                            self._checkpoint(state, "terminal"),
                        )
                else:
                    state.citation_retry_count += 1
                    state.messages.append({
                        "role": "system",
                        "content": "Your answer must cite at least one exact source reference from the successful retrieval "
                                   "tool results (an HTTPS URL, an internal knowledge source URI, or every exact "
                                   "[memory:<id>] marker returned by memory search) and must not invent sources. "
                                   "For conflicting memory results, state the conflict rather than silently choosing one. Revise the answer now.",
                    })
                    state.phase = RunPhase.WAITING_MODEL
                    return (*reasoning_events, decision_event,
                        self._event(state, "citation.required", {
                            "citation_sha256": citation["sha256"], "missing": citation["missing"],
                            "fabricated_count": len(citation["fabricated_url_sha256"]),
                            "source_call_ids": citation["source_call_ids"],
                            "retry_count": state.citation_retry_count,
                        }),
                        self._checkpoint(state, "before_citation_retry"),
                        self._request(state, MessageType.MODEL_REQUEST, {
                            "model_id": state.model_id, "messages": state.messages, "tools": [], "skills": state.skills,
                            "capability_snapshot_sha256": state.capability_snapshot["sha256"],
                        }, "citation_retry"),
                    )
            if citation["required"] or citation["source_url_sha256"]:
                citation_event = (self._event(state, "citation.verified", {
                    "citation_sha256": citation["sha256"],
                    "source_call_ids": citation["source_call_ids"],
                    "source_url_sha256": citation["source_url_sha256"],
                    "cited_url_sha256": citation["cited_url_sha256"],
                }),)
        tool_definitions = {str(value["name"]): value for value in state.tools}
        for raw_call in tool_calls:
            if not isinstance(raw_call, Mapping):
                raise ValueError("tool_call_invalid")
            name = self._required_string(raw_call, "name")
            execution_tool_record(state.execution_tool_registry, name)
            arguments = raw_call.get("arguments", {})
            if not isinstance(arguments, Mapping):
                raise ValueError("tool_arguments_invalid")
            validate_memory_tool_call(state.memory_policy, name, arguments)
            if name not in tool_definitions:
                raise ValueError(f"tool_not_available:{name}")
        search_calls = [
            value for value in tool_calls
            if isinstance(value, Mapping) and value.get("name") == "web_search"
        ]
        if search_calls:
            fetch_calls = [
                value for value in tool_calls
                if isinstance(value, Mapping) and value.get("name") == "web_fetch"
            ]
            if len(search_calls) + len(fetch_calls) != len(tool_calls):
                raise ValueError("web_search_mixed_batch_not_allowed")
            # Search is intentionally serialized. Some model providers emit several
            # alternative queries in one response even when parallel tool use is
            # disabled. Execute the first deterministic query instead of rejecting
            # the entire batch and losing the required retrieval round.
            search_calls = search_calls[:1]
            # A model may also open an already-known primary-source URL in the
            # same read-only batch. Keep those fetches; unlike an arbitrary
            # mixed tool call, they are independently URL-admitted by the Host.
            tool_calls = [*search_calls, *fetch_calls]
            raw_queries = [str(value.get("arguments", {}).get("query", "")).strip() for value in search_calls]
            repeated = any(
                _web_search_queries_are_near_duplicates(query, previous)
                for query in raw_queries
                for previous in state.web_search_queries
            )
            state.web_search_queries.extend(raw_queries)
            reason = (
                "duplicate_query" if repeated
                else "search_attempt_limit" if len(state.web_search_queries) > WEB_SEARCH_MAX_ATTEMPTS
                else None
            )
            if reason is not None:
                return self._finish_rejected_web_search_round(
                    state,
                    search_calls,
                    reason=reason,
                    reasoning_events=reasoning_events,
                    decision_event=decision_event,
                )
        delegate_calls = [value for value in tool_calls if isinstance(value, Mapping) and value.get("name") == "delegate"]
        if delegate_calls:
            if len(tool_calls) != 1:
                raise ValueError("delegate_must_be_single")
            return (*reasoning_events, decision_event, *self._start_subagents(state, delegate_calls[0], content))
        core_calls = [value for value in tool_calls if isinstance(value, Mapping) and value.get("name") in {"core.text_stats", "core.data_compute", "core.update_plan"}]
        if core_calls:
            if len(core_calls) != len(tool_calls):
                raise ValueError("core_and_host_tools_cannot_mix")
            return (*reasoning_events, decision_event, *self._execute_core_tools(state, core_calls, content))
        if content and not tool_calls:
            state.messages.append({"role": "assistant", "content": content})
        if not tool_calls:
            if state.subagent_failures:
                state.phase = RunPhase.FAILED
                self._active_run_by_session.pop(state.session_id, None)
                return (*reasoning_events, decision_event,
                    self._event(state, "run.failed", {
                        "code": "subagent_failed", "retryable": False,
                        "failed_subagent_ids": sorted(state.subagent_failures),
                    }),
                    self._checkpoint(state, "terminal"),
                )
            state.phase = RunPhase.COMPLETED
            self._active_run_by_session.pop(state.session_id, None)
            completed_message = ()
            if content:
                completed_message = (self._event(state, "message.completed", {
                    "item_id": f"{state.run_id}:assistant", "role": "assistant", "text": content, "phase": "final",
                }),)
            return (*reasoning_events, decision_event, *citation_event, *completed_message,
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
            arguments = raw_call.get("arguments", {})
            if not isinstance(arguments, Mapping):
                raise ValueError("tool_arguments_invalid")
            registry_record = execution_tool_record(state.execution_tool_registry, name)
            normalized = {
                "call_id": call_id,
                "name": name,
                "arguments": dict(arguments),
                "requires_approval": registry_record["approval_mode"] == "required",
                "approval_mode": registry_record["approval_mode"],
                "risk": registry_record["risk"],
                "executor_id": registry_record["executor_id"],
                "execution_registry_sha256": state.execution_tool_registry["sha256"],
                "retry_policy": dict(registry_record["retry_policy"]),
                "oaep_output_type": tool_definitions[name].get("oaep_output_type"),
            }
            state.pending_tool_calls[call_id] = normalized
            if normalized["requires_approval"]:
                approval_call = normalized
            else:
                replies.append(self._event(state, "tool.started", {
                    "item_id": f"{state.run_id}:tool:{call_id}",
                    "call_id": call_id, "name": name, "tool_kind": "host",
                    "arguments": dict(arguments),
                    "risk": normalized["risk"], "approval_mode": normalized["approval_mode"],
                    "executor_id": normalized["executor_id"],
                    "execution_registry_sha256": normalized["execution_registry_sha256"],
                }))
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
            replies.append(self._event(state, "tool.started", {
                "item_id": f"{state.run_id}:tool:{call_id}",
                "call_id": call_id, "name": approval_call["name"], "tool_kind": "host",
                "arguments": dict(approval_call.get("arguments", {})),
                "risk": approval_call["risk"], "approval_mode": approval_call["approval_mode"],
                "executor_id": approval_call["executor_id"],
                "execution_registry_sha256": approval_call["execution_registry_sha256"],
            }))
            replies.append(self._event(state, "approval.requested", {
                "approval_id": f"approval:{call_id}",
                "call_id": call_id,
                "name": approval_call["name"],
                "operation": "tool.execute",
                "prompt": approval_call.get("title", "需要确认工具操作"),
                "summary": approval_call.get("summary", "工具将在 Android Host 执行副作用"),
            }))
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
                        "approval_mode": approval_call["approval_mode"],
                        "executor_id": approval_call["executor_id"],
                        "execution_registry_sha256": approval_call["execution_registry_sha256"],
                        "title": approval_call.get("title", "需要确认工具操作"),
                        "summary": approval_call.get("summary", "工具将在 Android Host 执行副作用"),
                    },
                    f"approval:{call_id}",
                )
            )
        else:
            state.phase = RunPhase.WAITING_TOOL
            replies.insert(0, self._checkpoint(state, "before_tool"))
        # Preserve the durable pre-execution checkpoint as the first Host-facing
        # command; diagnostics must never move a side effect ahead of persistence.
        return (*reasoning_events, replies[0], decision_event, *replies[1:])

    def _tool_result(self, command: RuntimeEnvelope) -> Sequence[RuntimeEnvelope]:
        state = self._require_phase(command.run_id, RunPhase.WAITING_TOOL)
        call_id = self._required_string(command.payload, "call_id")
        call = state.pending_tool_calls.get(call_id)
        if call is None:
            if call_id in state.completed_side_effects:
                return ()
            raise ValueError("tool_call_not_pending")
        raw_content = command.payload.get("content", {})
        if not isinstance(raw_content, Mapping):
            raise ValueError("tool_output_content_invalid")
        raw_artifacts = command.payload.get("artifacts", [])
        if not isinstance(raw_artifacts, list) or any(not isinstance(value, Mapping) for value in raw_artifacts):
            raise ValueError("tool_output_artifacts_invalid")
        output_content, artifact_descriptors = normalize_tool_output(raw_content, raw_artifacts)
        inspection = command.payload.get("inspection")
        if inspection is not None and not isinstance(inspection, Mapping):
            raise ValueError("tool_output_inspection_invalid")
        artifact_ids = command.payload.get("artifact_ids", [])
        if not isinstance(artifact_ids, list) or any(not isinstance(value, str) or not value for value in artifact_ids):
            raise ValueError("tool_artifact_ids_invalid")
        descriptor_ids = [value["artifact_id"] for value in artifact_descriptors]
        if sorted(artifact_ids) != sorted(descriptor_ids):
            raise ValueError("tool_artifact_metadata_mismatch")
        state.pending_tool_calls.pop(call_id)
        state.completed_side_effects.add(call_id)
        succeeded = bool(command.payload.get("succeeded", False))
        error = None if succeeded else classify_tool_error(command.payload.get("error_code"), str(call["risk"]))
        model_content = output_content
        if error is not None:
            model_content = {"error": error, "details": model_content}
        state.messages.append(
            {
                "role": "tool",
                "tool_call_id": call_id,
                "name": call["name"],
                "content": model_content,
                "succeeded": succeeded,
            }
        )
        tool_event = self._event(
            state,
            "tool.result" if succeeded else "tool.error",
            {
                "call_id": call_id,
                "item_id": f"{state.run_id}:tool:{call_id}",
                "name": call["name"],
                "tool_kind": "host",
                "arguments": dict(call.get("arguments", {})),
                "result": output_content,
                **({"inspection": dict(inspection)} if isinstance(inspection, Mapping) else {}),
                "succeeded": succeeded,
                "code": None if error is None else error["code"],
                "category": None if error is None else error["category"],
                "retryable": False if error is None else error["retryable"],
                "automatic_retry": False if error is None else error["automatic_retry"],
                "actionable": None if error is None else error["actionable"],
                "duration_ms": command.payload.get("duration_ms"),
            },
        )
        artifact_events = tuple(
            self._event(state, "artifact.created", {
                "item_id": f"artifact:{descriptor['artifact_id']}",
                "artifact_id": descriptor["artifact_id"],
                "artifact_type": "file",
                "name": descriptor["artifact_id"],
                "summary": f"Created by {call['name']}",
                "source_call_id": call_id,
                "mime_type": descriptor["mime_type"],
                "size": descriptor["size"],
                "sha256": descriptor["sha256"],
                "previewable": descriptor["mime_type"].startswith("text/") or descriptor["mime_type"] in {"application/json", "application/pdf"},
                "downloadable": True,
            })
            for descriptor in artifact_descriptors
        )
        semantic_events: tuple[RuntimeEnvelope, ...] = ()
        if succeeded and call.get("oaep_output_type") == "command_execution":
            output = output_content
            semantic_events = (self._event(state, "command.completed", {
                "item_id": f"command:{call_id}", "command": [call["name"]],
                "display_command": call["name"], "cwd": "workspace",
                "output": json.dumps(output, ensure_ascii=False, sort_keys=True),
                "exit_code": 0, "duration_ms": command.payload.get("duration_ms"),
            }),)
        elif succeeded and call.get("oaep_output_type") == "file_change":
            path = str(call.get("arguments", {}).get("path") or output_content.get("path", ""))
            if not path or path.startswith(("/", "\\")) or ".." in path.replace("\\", "/").split("/"):
                raise ValueError("file_change_path_invalid")
            before_sha256 = str(output_content.get("before_sha256", ""))
            after_sha256 = str(output_content.get("after_sha256", ""))
            operation = "create" if before_sha256 == "missing" else "remove" if after_sha256 == "missing" else "modify"
            receipt_fields = ("operation", "before_sha256", "after_sha256", "mutation_token")
            diff_summary = "; ".join(
                f"{key}={output_content[key]}" for key in receipt_fields if output_content.get(key) is not None
            )
            change = {"operation": operation, "path": path}
            if diff_summary:
                change["diff_summary"] = diff_summary[:4000]
            summary_verb = {"create": "Created", "remove": "Removed", "modify": "Modified"}[operation]
            semantic_events = (self._event(state, "file_change.completed", {
                "item_id": f"file-change:{call_id}", "summary": f"{summary_verb} {path}",
                "changes": [change],
            }),)
        if state.pending_tool_calls:
            return (tool_event, *semantic_events, *artifact_events)
        exhaustion_events: tuple[RuntimeEnvelope, ...] = ()
        if (
            call["name"] == "web_search"
            and len(state.web_search_queries) >= WEB_SEARCH_MAX_ATTEMPTS
            and not state.web_search_exhausted
        ):
            state.web_search_exhausted = True
            state.messages.append({
                "role": "system",
                "content": "The WebSearch attempt budget is exhausted. Do not search again. "
                           "Answer from the best reliable evidence already returned, or clearly state that no "
                           "reliable public result was found.",
            })
            exhaustion_events = (self._event(state, "web_search.exhausted", {
                "reason": "search_attempt_limit",
                "attempt_count": len(state.web_search_queries),
                "maximum_attempts": WEB_SEARCH_MAX_ATTEMPTS,
            }),)
        if exhaustion_events:
            evidence = build_citation_evidence(state.messages, "", retrieval_required=False)
            if not evidence["source_url_sha256"]:
                limitation = self._web_search_limitation(state)
                state.messages.append({"role": "assistant", "content": limitation})
                state.phase = RunPhase.COMPLETED
                self._active_run_by_session.pop(state.session_id, None)
                return (
                    tool_event,
                    *semantic_events,
                    *artifact_events,
                    *exhaustion_events,
                    self._event(state, "message.completed", {
                        "item_id": f"{state.run_id}:assistant",
                        "role": "assistant",
                        "text": limitation,
                        "phase": "final",
                    }),
                    self._event(state, "run.completed", {"status": "completed_with_limitation"}),
                    self._checkpoint(state, "terminal"),
                )
        state.phase = RunPhase.WAITING_MODEL
        return (
            tool_event,
            *semantic_events,
            *artifact_events,
            *exhaustion_events,
            self._checkpoint(state, "after_tool"),
            self._request(
                state,
                MessageType.MODEL_REQUEST,
                {"model_id": state.model_id, "messages": state.messages, "tools": state.tools, "skills": state.skills,
                 "capability_snapshot_sha256": state.capability_snapshot["sha256"]},
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
                {"model_id": state.model_id, "messages": state.messages, "tools": state.tools, "skills": state.skills,
                 "capability_snapshot_sha256": state.capability_snapshot["sha256"]},
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
        max_active = int(state.subagent_scheduling_policy.get("max_active", 3))
        if not 1 <= len(tasks) <= max_active:
            raise ValueError("subagent_active_limit")
        pending: dict[str, dict[str, Any]] = {}
        for raw_task in tasks:
            if not isinstance(raw_task, Mapping):
                raise ValueError("subagent_task_invalid")
            task_id = self._required_string(raw_task, "task_id")
            prompt = self._required_string(raw_task, "prompt")
            task_type = str(raw_task.get("type", "general"))
            if task_type not in {"explore", "general"}:
                raise ValueError("subagent_type_invalid")
            if task_id in pending:
                raise ValueError("subagent_task_duplicate")
            requested_tools = raw_task.get("allowed_tools")
            if requested_tools is not None and (
                not isinstance(requested_tools, list) or not all(isinstance(value, str) for value in requested_tools)
            ):
                raise ValueError("subagent_tool_whitelist_invalid")
            safe_tools = [dict(tool) for tool in state.tools if (
                tool.get("risk") == "read_only" and not bool(tool.get("requires_approval"))
                and tool.get("name") not in {"delegate", "core.update_plan"}
            )]
            safe_names = {str(tool["name"]) for tool in safe_tools}
            # A general child is a bounded reasoning worker. The mobile
            # coordinator currently accepts one child model completion and
            # does not execute a nested child Tool loop. Only an explicit
            # allowlist opts an explore child into a Tool surface.
            if requested_tools is None:
                safe_tools = []
                safe_names = set()
            if requested_tools is not None:
                # OpenAI-compatible providers may encode punctuation in nested
                # string arguments using the same reversible spelling used for
                # function names. Resolve only exact aliases of already-safe
                # tools; this cannot expand a child beyond the parent allowlist.
                requested = {
                    value.replace("__dot__", ".") if value.replace("__dot__", ".") in safe_names else value
                    for value in requested_tools
                }
                if not requested <= safe_names:
                    raise ValueError("subagent_tool_whitelist_denied")
                safe_tools = [tool for tool in safe_tools if tool["name"] in requested]
                safe_names = requested
            child_skills = [dict(skill) for skill in state.skills if (
                skill.get("availability") == "local"
                and set(skill.get("tools", [])) <= safe_names
            )]
            child = self._new_subagent_kernel()
            child_run_id = f"{state.run_id}:subagent:{task_id}"
            child_session_id = f"{state.session_id}:subagent:{task_id}"
            child_host_capabilities = sorted({
                str(capability) for tool in safe_tools for capability in tool.get("required_capabilities", [])
                if capability in state.host_capabilities
            })
            start = RuntimeEnvelope(
                MessageType.START_RUN, f"{child_run_id}:start", child_run_id, child_session_id, 0,
                f"{child_run_id}:start", {
                    "input": prompt, "model_id": state.model_id, "tools": safe_tools, "skills": child_skills,
                    "host_port": {
                        "schema_version": 1,
                        "protocol_version": "p9-host-port-v1",
                        "surface": self._runtime_surface(),
                        "capabilities": [
                            {"id": capability, "version": 1, "required": False}
                            for capability in child_host_capabilities
                        ],
                    },
                },
            )
            child_outbound = child.handle(start)
            child_model = next(value for value in child_outbound if value.message_type is MessageType.MODEL_REQUEST)
            identity = dict(getattr(child, "_factory_identity"))
            parent_context_sha256 = hashlib.sha256(json.dumps(
                state.messages, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
            ).encode("utf-8")).hexdigest()
            pending[task_id] = {
                "task_id": task_id, "prompt": prompt, "type": task_type,
                "allowed_tools": sorted(safe_names), "parent_context_sha256": parent_context_sha256,
                "kernel_id": identity["kernel_id"], "kernel_sha256": identity["kernel_sha256"],
                "child_run_id": child_run_id, "child_session_id": child_session_id,
                "child_state": child.snapshot(child_run_id), "model_request": dict(child_model.payload),
            }
        state.messages.append({"role": "assistant", "content": content, "tool_calls": [dict(raw_call)]})
        state.pending_subagents = pending
        state.subagent_results = {}
        state.delegate_call_id = call_id
        replies: list[RuntimeEnvelope] = [self._checkpoint(state, "before_subagents")]
        for task_id, task in pending.items():
            replies.append(self._event(state, "subagent.started", {
                "subagent_id": task_id,
                "title": task["prompt"][:120],
                "summary": "",
                "subagent_type": task["type"],
                "kernel_id": task["kernel_id"],
                "kernel_sha256": task["kernel_sha256"],
                "parent_context_sha256": task["parent_context_sha256"],
                "allowed_tools": task["allowed_tools"],
                "parent_run_id": state.run_id,
                "child_run_id": task["child_run_id"],
                "agent_name": task["kernel_id"],
            }))
        for task_id, task in pending.items():
            replies.append(
                self._request(
                    state, MessageType.MODEL_REQUEST,
                    {**task["model_request"], "subagent_id": task_id,
                     "subagent_kernel_sha256": task["kernel_sha256"],
                     "parent_context_sha256": task["parent_context_sha256"]},
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
            name = self._required_string(raw_call, "name")
            arguments = raw_call.get("arguments", {})
            if not isinstance(arguments, Mapping):
                raise ValueError("core_tool_arguments_invalid")
            if name == "core.text_stats":
                text = arguments.get("text")
                if not isinstance(text, str):
                    raise ValueError("core_tool_arguments_invalid")
                if len(text) > 10_000:
                    raise ValueError("core_tool_arguments_too_large")
                normalized.append({"call_id": call_id, "name": name, "arguments": {"text": text}})
            elif name == "core.data_compute":
                # Validation and execution share the same declarative policy. There is no code/import/path/network input.
                execute_declarative_compute(arguments)
                normalized.append({"call_id": call_id, "name": name, "arguments": dict(arguments)})
            elif name == "core.update_plan":
                if any(value["name"] == "core.update_plan" for value in normalized):
                    raise ValueError("core_plan_concurrent_update")
                plan = normalize_plan_update(state.plan_state, arguments)
                plan["item_id"] = f"{state.run_id}:plan"
                # The stable item identity is part of the canonical state. Rebuild
                # once with the Run-bound identity on first creation.
                if not state.plan_state:
                    plan = normalize_plan_update({}, {**arguments, "item_id": plan["item_id"]})
                normalized.append({"call_id": call_id, "name": name, "arguments": plan})
            else:
                raise ValueError("core_tool_unknown")
        state.messages.append({"role": "assistant", "content": content, "tool_calls": normalized})
        for call in normalized:
            if call["name"] == "core.text_stats":
                text = call["arguments"]["text"]
                result = {"characters": len(text), "words": len(text.split()), "lines": 0 if not text else text.count("\n") + 1}
            elif call["name"] == "core.data_compute":
                result = execute_declarative_compute(call["arguments"])
            else:
                result = {"updated": True, "steps": len(call["arguments"]["steps"])}
            replies.append(self._event(state, "tool.started", {
                "name": call["name"], "call_id": call["call_id"], "tool_kind": "core",
                "arguments": dict(call["arguments"]),
            }))
            state.messages.append({
                "role": "tool", "tool_call_id": call["call_id"], "name": call["name"],
                "succeeded": True, "content": json.dumps(result, sort_keys=True),
            })
            replies.append(self._event(state, "tool.result", {
                "name": call["name"], "call_id": call["call_id"], "tool_kind": "core",
                "arguments": dict(call["arguments"]), "result": result,
            }))
            if call["name"] == "core.update_plan":
                plan = call["arguments"]
                state.plan_state = dict(plan)
                replies.append(self._event(state, plan_event_kind(plan), dict(plan)))
            state.completed_side_effects.add(call["call_id"])
        state.phase = RunPhase.WAITING_MODEL
        replies.append(self._checkpoint(state, "after_core_tool"))
        replies.append(
            self._request(
                state, MessageType.MODEL_REQUEST,
                {"model_id": state.model_id, "messages": state.messages, "tools": state.tools, "skills": state.skills,
                 "capability_snapshot_sha256": state.capability_snapshot["sha256"]},
                "model_after_core_tool",
            )
        )
        return replies

    def _subagent_completed(
        self, state: MobileRunState, subagent_id: str, content: str,
    ) -> Sequence[RuntimeEnvelope]:
        if subagent_id not in state.pending_subagents:
            raise ValueError("subagent_not_pending")
        task = state.pending_subagents[subagent_id]
        child = self._new_subagent_kernel()
        child.handle(RuntimeEnvelope(
            MessageType.RESUME_RUN, f"{task['child_run_id']}:resume", task["child_run_id"],
            task["child_session_id"], 1, f"{task['child_run_id']}:resume", {"state": task["child_state"]},
        ))
        child_result = child.handle(RuntimeEnvelope(
            MessageType.MODEL_COMPLETED, f"{task['child_run_id']}:model", task["child_run_id"],
            task["child_session_id"], 2, f"{task['child_run_id']}:model", {"content": content},
        ))
        if not any(value.payload.get("kind") == "run.completed" for value in child_result):
            raise ValueError("subagent_kernel_did_not_complete")
        state.pending_subagents.pop(subagent_id)
        state.subagent_results[subagent_id] = content
        completed = self._event(state, "subagent.completed", {
            "subagent_id": subagent_id,
            "summary": content,
            "result": content,
            "kernel_id": task["kernel_id"],
            "kernel_sha256": task["kernel_sha256"],
            "allowed_tools": task["allowed_tools"],
            "parent_run_id": state.run_id,
            "child_run_id": task["child_run_id"],
            "agent_name": task["kernel_id"],
        })
        if state.pending_subagents:
            return (completed, self._checkpoint(state, "after_subagent"))
        ordered = "\n".join(f"[{key}] completed: {value}" for key, value in state.subagent_results.items())
        completed_delegate_call_id = state.delegate_call_id
        state.messages.append({
            "role": "tool", "tool_call_id": state.delegate_call_id, "name": "delegate", "succeeded": True,
            "content": ordered,
        })
        if completed_delegate_call_id is not None:
            state.completed_side_effects.add(completed_delegate_call_id)
        state.delegate_call_id = None
        return (
            completed,
            self._checkpoint(state, "after_subagents"),
            self._request(
                state, MessageType.MODEL_REQUEST,
                {"model_id": state.model_id, "messages": state.messages, "tools": state.tools, "skills": state.skills,
                 "capability_snapshot_sha256": state.capability_snapshot["sha256"]},
                "model_after_subagents",
            ),
        )

    def _new_subagent_kernel(self) -> "DrSaiAgentKernel":
        if __package__ == "mobile_core":
            from agent_kernel_factory import create_agent_kernel
        else:
            from ..agent_kernel_factory import create_agent_kernel
        return create_agent_kernel(surface=self._runtime_surface())

    def _model_failed(self, command: RuntimeEnvelope) -> Sequence[RuntimeEnvelope]:
        state = self._require_phase(command.run_id, RunPhase.WAITING_MODEL)
        subagent_id = command.payload.get("subagent_id")
        if subagent_id is not None:
            return self._subagent_failed(
                state, str(subagent_id), str(command.payload.get("code", "subagent_model_failed")),
                bool(command.payload.get("retryable", False)),
            )
        state.phase = RunPhase.FAILED
        self._active_run_by_session.pop(state.session_id, None)
        return (
            self._event(
                state,
                "run.failed",
                {
                    "code": command.payload.get("code", "model_failed"),
                    "message": command.payload.get("message", ""),
                    "retryable": bool(command.payload.get("retryable", True)),
                },
            ),
            self._checkpoint(state, "terminal"),
        )

    def _subagent_failed(
        self, state: MobileRunState, subagent_id: str, code: str, retryable: bool,
    ) -> Sequence[RuntimeEnvelope]:
        task = state.pending_subagents.pop(subagent_id, None)
        if task is None:
            raise ValueError("subagent_not_pending")
        failure = {"code": code, "retryable": retryable, "status": "failed"}
        state.subagent_failures[subagent_id] = failure
        failed = self._event(state, "subagent.failed", {
            "subagent_id": subagent_id,
            "title": task["prompt"][:120],
            "summary": f"Subagent failed: {code}",
            "code": code,
            "retryable": retryable,
            "parent_run_id": state.run_id,
            "child_run_id": task["child_run_id"],
            "agent_name": task["kernel_id"],
            "kernel_sha256": task["kernel_sha256"],
        })
        if state.pending_subagents:
            return (failed, self._checkpoint(state, "after_subagent_failure"))
        lines = [f"[{key}] completed: {value}" for key, value in state.subagent_results.items()]
        lines.extend(f"[{key}] failed: {value['code']}" for key, value in state.subagent_failures.items())
        delegate_call_id = state.delegate_call_id
        state.messages.append({
            "role": "tool", "tool_call_id": delegate_call_id, "name": "delegate", "succeeded": True,
            "content": "\n".join(lines),
        })
        if delegate_call_id is not None:
            state.completed_side_effects.add(delegate_call_id)
        state.delegate_call_id = None
        return (
            failed,
            self._checkpoint(state, "after_subagents"),
            self._request(state, MessageType.MODEL_REQUEST, {
                "model_id": state.model_id, "messages": state.messages, "tools": state.tools, "skills": state.skills,
                "capability_snapshot_sha256": state.capability_snapshot["sha256"],
            }, "model_after_subagents"),
        )

    def _lifecycle_changed(self, command: RuntimeEnvelope) -> Sequence[RuntimeEnvelope]:
        state = self._runs.get(command.run_id)
        if state is None or state.terminal:
            raise ValueError("run_not_active")
        lifecycle = self._required_string(command.payload, "state")
        if lifecycle not in {"foreground", "background", "low_memory", "thermal_limited"}:
            raise ValueError("lifecycle_state_invalid")
        state.lifecycle_state = lifecycle
        state.subagent_scheduling_policy = build_subagent_scheduling_policy(lifecycle)
        return (
            self._event(
                state, "runtime.lifecycle_changed",
                {"state": lifecycle, "max_parallel_agents": state.subagent_scheduling_policy["max_parallel"],
                 "subagent_scheduling": dict(state.subagent_scheduling_policy)},
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
            state.messages.append({
                "role": "tool", "tool_call_id": state.delegate_call_id, "name": "delegate", "succeeded": True,
                "content": ordered,
            })
            if state.delegate_call_id is not None:
                state.completed_side_effects.add(state.delegate_call_id)
            state.delegate_call_id = None
            return (
                cancelled,
                self._checkpoint(state, "after_subagents"),
                self._request(
                    state, MessageType.MODEL_REQUEST,
                    {"model_id": state.model_id, "messages": state.messages, "tools": state.tools, "skills": state.skills,
                     "capability_snapshot_sha256": state.capability_snapshot["sha256"]},
                    "model_after_subagents",
                ),
            )
        cancelled_tools: list[RuntimeEnvelope] = []
        for call_id, call in list(state.pending_tool_calls.items()):
            error = classify_tool_error("cancelled", str(call.get("risk", "sensitive")))
            state.messages.append({
                "role": "tool", "tool_call_id": call_id, "name": call["name"],
                "content": {"error": error}, "succeeded": False,
            })
            state.completed_side_effects.add(call_id)
            cancelled_tools.append(self._event(state, "tool.error", {
                "item_id": f"{state.run_id}:tool:{call_id}",
                "call_id": call_id, "name": call["name"], "tool_kind": "host",
                "succeeded": False, **error,
            }))
        state.pending_tool_calls.clear()
        if state.delegate_call_id is not None:
            cancelled_summary = "\n".join(
                f"[{subagent_id}] cancelled: parent_cancelled" for subagent_id in state.pending_subagents
            )
            state.messages.append({
                "role": "tool", "tool_call_id": state.delegate_call_id, "name": "delegate", "succeeded": False,
                "content": cancelled_summary or "cancelled: parent_cancelled",
            })
            state.completed_side_effects.add(state.delegate_call_id)
        state.pending_subagents.clear()
        state.delegate_call_id = None
        state.pending_artifacts.clear()
        state.phase = RunPhase.CANCELLED
        self._active_run_by_session.pop(state.session_id, None)
        return (*cancelled_tools,
            self._event(state, "run.cancelled", {"reason": "user_cancelled"}),
            self._checkpoint(state, "terminal"),
        )

    def snapshot(self, run_id: str) -> dict[str, Any]:
        state = self._runs[run_id]
        return {
            "run_id": state.run_id,
            "session_id": state.session_id,
            "model_id": state.model_id,
            "model_route_snapshot": dict(state.model_route_snapshot),
            "phase": state.phase.value,
            "outbound_sequence": state.outbound_sequence,
            "messages": state.messages,
            "completed_side_effects": sorted(state.completed_side_effects),
            "pending_tool_calls": dict(state.pending_tool_calls),
            "pending_artifacts": dict(state.pending_artifacts),
            "tools": list(state.tools),
            "skills": list(state.skills),
            "host_capabilities": list(state.host_capabilities),
            "blocked_capabilities": list(state.blocked_capabilities),
            "remote_capabilities": list(state.remote_capabilities),
            "capability_snapshot": dict(state.capability_snapshot),
            "model_tool_snapshot": dict(state.model_tool_snapshot),
            "execution_tool_registry": dict(state.execution_tool_registry),
            "tool_loop_policy": dict(state.tool_loop_policy),
            "tool_decision_requirement": dict(state.tool_decision_requirement),
            "verification_retry_count": state.verification_retry_count,
            "citation_retry_count": state.citation_retry_count,
            "citation_evidence": dict(state.citation_evidence),
            "prompt_layer_diagnostics": list(state.prompt_layer_diagnostics),
            "context_budget": dict(state.context_budget),
            "context_observability": dict(state.context_observability),
            "memory_policy": dict(state.memory_policy),
            "memory_selection": dict(state.memory_selection),
            "conversation_context": validate_conversation_context(
                state.messages, require_complete_tool_calls=not bool(
                    state.pending_tool_calls or state.pending_subagents or state.delegate_call_id
                ),
            ),
            "tool_round_count": state.tool_round_count,
            "tool_execution_disabled": state.tool_execution_disabled,
            "web_search_queries": list(state.web_search_queries),
            "web_search_exhausted": state.web_search_exhausted,
            "lifecycle_state": state.lifecycle_state,
            "subagent_scheduling_policy": dict(state.subagent_scheduling_policy),
            "pending_subagents": dict(state.pending_subagents),
            "subagent_results": dict(state.subagent_results),
            "subagent_failures": dict(state.subagent_failures),
            "delegate_call_id": state.delegate_call_id,
            "plan_state": dict(state.plan_state),
        }

    @staticmethod
    def _execution_registry_metadata(tools: Sequence[Mapping[str, Any]]) -> dict[str, dict[str, Any]]:
        metadata: dict[str, dict[str, Any]] = {}
        for tool in tools:
            name = str(tool["name"])
            source = str(tool["source"])
            metadata[name] = {
                "version": int(tool["version"]),
                "source": source,
                "classification": str(tool["classification"]),
                "risk": str(tool["risk"]),
                "approval_mode": str(tool.get(
                    "approval_mode", "required" if bool(tool["requires_approval"]) else "none",
                )),
                "executor_id": f"{source}:{name}",
                "required_capabilities": list(tool.get("required_capabilities", [])),
            }
        return metadata

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
        request_payload = dict(payload)
        if message_type is MessageType.MODEL_REQUEST:
            messages = request_payload.get("messages", [])
            if not isinstance(messages, list) or not all(isinstance(value, Mapping) for value in messages):
                raise ValueError("model_request_messages_invalid")
            request_payload["context_budget"] = validate_context_within_budget(messages, state.context_budget)
            request_payload["conversation_context"] = validate_conversation_context(messages)
            visible_tools = request_payload.get("tools", [])
            if not isinstance(visible_tools, list):
                raise ValueError("model_request_tools_invalid")
            if state.tool_execution_disabled:
                visible_tools = []
                request_payload["tools"] = visible_tools
            elif state.web_search_exhausted:
                visible_tools = [tool for tool in visible_tools if tool.get("name") != "web_search"]
                request_payload["tools"] = visible_tools
            request_payload["model_tool_snapshot_sha256"] = freeze_model_tool_snapshot(
                self._runtime_surface(), visible_tools,
            )["sha256"]
            request_payload["model_route_snapshot"] = dict(state.model_route_snapshot)
            request_payload.setdefault("tool_choice", build_tool_choice_policy(
                state.tool_decision_requirement,
                [str(value.get("name", "")) for value in visible_tools if isinstance(value, Mapping)],
                prior_tool_use=state.tool_round_count > 0 or bool(state.completed_side_effects),
                prior_tool_domains=completed_tool_decision_domains(state.messages),
            ))
        return self._outbound(state, message_type, request_payload, suffix)

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
            payload=copy.deepcopy(dict(payload)),
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


MobileAgentCore = DrSaiAgentKernel


def create_mobile_agent_core() -> DrSaiAgentKernel:
    from ..agent_kernel_factory import create_agent_kernel

    # Backward-compatible Android/mobile test helper. Desktop/TUI callers must
    # use the explicit factory so their capability surface cannot be confused.
    return create_agent_kernel(surface="android")
