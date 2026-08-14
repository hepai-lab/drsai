from __future__ import annotations

import pytest

from drsai.backend.runtime.agent_kernel import AgentRunConfig
from drsai.backend.runtime.grounded import (
    GROUNDED_POLICY_VERSION,
    build_claim_support,
    detect_grounded_request,
    partition_grounded_tools,
)

GROUNDED_CASE_PROMPT = (
    "根据提供的 OpenDrSai Runtime 知识库回答：\n\n"
    "1. Session 和 Run 分别表示什么？\n\n"
    "请仅根据知识库回答，并提供引用。"
)
ABSENT_CASE_PROMPT = (
    "根据提供的 OpenDrSai Runtime 知识库回答：\n\n"
    "OpenDrSai 本地 Gateway 默认监听哪个端口？\n\n"
    "请仅根据知识库回答，并提供依据。"
)


def test_acceptance_prompts_trigger_grounded_mode() -> None:
    for prompt in (GROUNDED_CASE_PROMPT, ABSENT_CASE_PROMPT):
        decision = detect_grounded_request(prompt)
        assert decision["grounded"] is True, prompt
        assert decision["requires_citations"] is True, prompt
        assert decision["policy_version"] == GROUNDED_POLICY_VERSION


def test_english_grounded_phrasing_triggers() -> None:
    decision = detect_grounded_request(
        "Based only on the provided knowledge base, what is a Run? Include citations."
    )

    assert decision["grounded"] is True
    assert decision["requires_citations"] is True


def test_ordinary_questions_do_not_trigger_grounded_mode() -> None:
    # Grounded mode is explicit-only: inferring it would silently change how
    # everyday questions get answered.
    for prompt in (
        "帮我读一下这个文件，总结要点。",
        "What does this document say about replay?",
        "Session 和 Run 有什么区别？",
    ):
        assert detect_grounded_request(prompt)["grounded"] is False, prompt


def test_decision_records_no_user_text() -> None:
    decision = detect_grounded_request(ABSENT_CASE_PROMPT)

    serialized = repr(decision)
    assert "Gateway" not in serialized
    assert "端口" not in serialized
    assert decision["trigger_count"] >= 1


def test_grounded_layer_outranks_profile_skill_and_project() -> None:
    config = AgentRunConfig(
        agent_profile="Answer confidently from your own expertise.",
        project_instructions="Prefer speed over sourcing.",
    )

    layers = [layer["id"] for layer in config.prompt_layers(grounded=True)]

    assert layers.index("grounded_answering") < layers.index("agent_profile")
    assert layers.index("grounded_answering") < layers.index("project")
    assert "grounded_answering" not in config.prompt_layers()


def test_grounded_prompt_states_the_three_answer_states() -> None:
    prompt = AgentRunConfig().authoritative_prompt(grounded=True)

    assert "answerable" in prompt
    assert "partially answerable" in prompt
    assert "unanswerable" in prompt
    assert "[E<n>]" in prompt


def test_grounded_withholds_tools_that_reach_outside_the_material() -> None:
    allowed, withheld = partition_grounded_tools([
        "knowledge_search", "web_search", "fetch_url", "browser_navigate",
        "retrieve_from_memory", "search_memory", "run_read", "get_current_time",
    ])

    assert "knowledge_search" in allowed
    # Conversation history can contain the model's own earlier answers, so it
    # must not be reachable as evidence.
    assert set(withheld) == {
        "web_search", "fetch_url", "browser_navigate", "retrieve_from_memory", "search_memory",
    }
    assert "run_read" in allowed


def test_grounded_follows_the_kernel_classification_not_a_local_list() -> None:
    # Run history is material outside the supplied corpus: an answer copied
    # from a previous Run is the same failure as one copied from the web.
    # These tools were moved into the retrieval domain by the kernel, and a
    # hand-maintained list here would have kept letting them through.
    _allowed, withheld = partition_grounded_tools([
        "knowledge_search", "run_inspect", "run_manifest_read", "run_compare", "mcp_fetch",
    ])

    assert set(withheld) == {"run_inspect", "run_manifest_read", "run_compare", "mcp_fetch"}


def test_every_retrieval_and_memory_tool_the_kernel_knows_is_withheld() -> None:
    from drsai.backend.runtime.agent_kernel import tool_decision_domain

    candidates = [
        "knowledge_search", "web_search", "search_web", "fetch_url", "browser_navigate",
        "mcp_list", "run_inspect", "run_compare", "save_memory", "search_memory",
        "retrieve_from_memory", "read_session_memory_by_index",
        "run_read", "run_bash", "get_current_time", "image_generation", "some_custom_skill_tool",
    ]

    allowed, withheld = partition_grounded_tools(candidates)

    for name in candidates:
        domain = tool_decision_domain(name)
        outside = domain in {"retrieval", "memory"} and name != "knowledge_search"
        assert (name in withheld) is outside, f"{name} ({domain})"
    assert "knowledge_search" in allowed
    # Unclassified tools stay available so Skills and custom tools keep working.
    assert "some_custom_skill_tool" in allowed


def test_claim_support_accepts_a_statement_its_citation_states() -> None:
    evidence = [{"content": "A Session is one continuous user conversation and can contain multiple Runs."}]

    support = build_claim_support("一个 Session 可以包含多个 Run [E1]。", evidence)

    assert support["valid"] is True
    assert support["cited_claims"] == 1
    assert support["unsupported_claims"] == 0


def test_claim_support_rejects_a_number_absent_from_the_cited_passage() -> None:
    evidence = [{"content": "The Gateway is started by the desktop application."}]

    support = build_claim_support("默认端口是 18642 [E1]。", evidence)

    # A figure that does not occur in the cited passage is the precise failure
    # this check exists for: it looks sourced and is invented.
    assert support["valid"] is False
    assert support["unsupported_claims"] == 1


def test_claim_support_flags_a_citation_that_does_not_exist() -> None:
    evidence = [{"content": "Replay always creates a new Run."}]

    support = build_claim_support("Replay overwrites the original Run [E7].", evidence)

    assert support["fabricated_citation_ids"] == [7]
    assert support["valid"] is False


def test_claim_support_counts_uncited_factual_statements() -> None:
    evidence = [{"content": "Replay always creates a new Run."}]

    support = build_claim_support("Replay always creates a new Run [E1]. Runs are billed hourly.", evidence)

    assert support["uncited_claims"] == 1
    assert support["valid"] is False


def test_refusal_wording_is_not_scored_as_an_unsupported_claim() -> None:
    evidence = [{"content": "Runtime hosts Sessions and Runs."}]

    support = build_claim_support(
        "知识库中并未包含本地 Gateway 的默认端口信息。我已检索了提供的文档，没有找到相关内容。",
        evidence,
    )

    # A correct refusal must not be penalised for citing nothing, otherwise the
    # only way to satisfy the check would be to assert something.
    assert support["factual_claims"] == 0
    assert support["valid"] is True


def test_claim_support_rejects_oversized_input() -> None:
    with pytest.raises(ValueError):
        build_claim_support("x" * 1_000_001, [])
