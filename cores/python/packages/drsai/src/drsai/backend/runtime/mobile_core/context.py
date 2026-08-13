"""Compatibility wrapper for the shared production Agent Kernel context."""

from __future__ import annotations

from typing import Any, Mapping, Sequence

try:  # Regular Python package layout.
    from drsai.backend.runtime.agent_kernel import AgentRunConfig, assemble_agent_context, build_citation_evidence, build_context_observability, build_execution_tool_registry, build_memory_policy, build_run_capability_snapshot, build_tool_choice_policy, build_tool_decision_requirement, classify_tool_error, completed_tool_decision_domains, execution_tool_record, freeze_model_tool_snapshot, normalize_citation_evidence, normalize_context_budget, normalize_kernel_host_port, normalize_memory_policy, normalize_memory_selection, normalize_model_route_snapshot, normalize_tool_loop_policy, normalize_tool_output, resolve_tool_decision, select_relevant_memories, validate_context_within_budget, validate_conversation_context, validate_memory_tool_call, validate_tool_call_batch, verify_model_tool_calls, verify_run_capability_snapshot
except ImportError:  # Android Chaquopy adds backend/runtime as a source root.
    from agent_kernel import AgentRunConfig, assemble_agent_context, build_citation_evidence, build_context_observability, build_execution_tool_registry, build_memory_policy, build_run_capability_snapshot, build_tool_choice_policy, build_tool_decision_requirement, classify_tool_error, completed_tool_decision_domains, execution_tool_record, freeze_model_tool_snapshot, normalize_citation_evidence, normalize_context_budget, normalize_kernel_host_port, normalize_memory_policy, normalize_memory_selection, normalize_model_route_snapshot, normalize_tool_loop_policy, normalize_tool_output, resolve_tool_decision, select_relevant_memories, validate_context_within_budget, validate_conversation_context, validate_memory_tool_call, validate_tool_call_batch, verify_model_tool_calls, verify_run_capability_snapshot


def build_prompt_layer_diagnostics(
    agent: Mapping[str, Any] | None,
    skills: Sequence[Mapping[str, Any]] = (),
) -> list[dict[str, Any]]:
    return AgentRunConfig.from_mapping(agent).prompt_layer_diagnostics(skills)


def assemble_mobile_context(
    history: Sequence[Mapping[str, Any]],
    input_text: str,
    *,
    agent: Mapping[str, Any] | None = None,
    skills: Sequence[Mapping[str, Any]] = (),
    context_budget: Mapping[str, Any] | None = None,
    max_messages: int | None = None,
    max_chars: int | None = None,
) -> list[dict[str, Any]]:
    return assemble_agent_context(
        history,
        input_text,
        agent=agent,
        skills=skills,
        context_budget=context_budget,
        max_messages=max_messages,
        max_chars=max_chars,
    )
