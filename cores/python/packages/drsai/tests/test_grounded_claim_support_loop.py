from __future__ import annotations

from drsai.backend.runtime.mobile_core import MessageType, RuntimeEnvelope, create_mobile_agent_core


SOURCE = "opendrsai://knowledge/runtime/documents/overview.md"
PASSAGE = "A Session is one continuous user conversation and can contain multiple Runs."


def knowledge_tool() -> dict:
    return {
        "name": "knowledge_search", "version": 1, "source": "desktop-host",
        "classification": "local-equivalent", "description": "search the configured knowledge bases",
        "parameters": {"type": "object", "properties": {}},
        "required_capabilities": [], "risk": "read_only", "requires_approval": False,
    }


def command(kind: MessageType, sequence: int, payload: dict) -> RuntimeEnvelope:
    return RuntimeEnvelope(kind, f"request-{sequence}", "run-ground", "session-ground", sequence, f"key-{sequence}", payload)


def kinds(events) -> list[str]:
    return [item.payload["kind"] for item in events if item.message_type is MessageType.RUNTIME_EVENT]


def retrieved_core(*, grounded: bool):
    core = create_mobile_agent_core()
    core.handle(command(MessageType.START_RUN, 0, {
        "input": "请仅根据提供的资料回答，并提供引用：Session 和 Run 是什么？",
        "model_id": "model", "tools": [knowledge_tool()],
        "agent": {"schema_version": 1, "grounded": grounded},
    }))
    core.handle(command(MessageType.MODEL_COMPLETED, 1, {"tool_calls": [
        {"call_id": "k-1", "name": "knowledge_search", "arguments": {"query": "Session Run"}},
    ]}))
    core.handle(command(MessageType.TOOL_RESULT, 2, {
        "call_id": "k-1", "succeeded": True,
        "content": {
            "status": "completed", "completed": True, "corpus_complete": True,
            "require_citations": True, "supporting_match": True,
            "evidence": [{
                "knowledge_id": "runtime", "document_path": "overview.md", "source": SOURCE,
                "chunk_id": "overview.md:0", "content": PASSAGE, "content_sha256": "a" * 64,
                "relation": "supports_claim", "score": 1.0,
            }],
            "documents": [{"knowledge_base_id": "runtime", "document_path": "overview.md", "corpus_complete": True}],
        },
        "artifact_ids": [], "artifacts": [],
    }))
    return core


def wrapped_core():
    """The Desktop host returns the production result wrapped as {"content": "<json>"}."""
    import json as _json

    core = create_mobile_agent_core()
    core.handle(command(MessageType.START_RUN, 0, {
        "input": "请仅根据提供的资料回答，并提供引用：Session 和 Run 是什么？",
        "model_id": "model", "tools": [knowledge_tool()],
        "agent": {"schema_version": 1, "grounded": True},
    }))
    core.handle(command(MessageType.MODEL_COMPLETED, 1, {"tool_calls": [
        {"call_id": "k-1", "name": "knowledge_search", "arguments": {"query": "Session Run"}},
    ]}))
    inner = {
        "status": "completed", "completed": True, "corpus_complete": True,
        "require_citations": True, "supporting_match": True,
        "evidence": [{
            "knowledge_id": "runtime", "document_path": "overview.md", "source": SOURCE,
            "chunk_id": "overview.md:0", "content": PASSAGE, "content_sha256": "a" * 64,
            "relation": "supports_claim", "score": 1.0,
        }],
        "documents": [{"knowledge_base_id": "runtime", "document_path": "overview.md", "corpus_complete": True}],
    }
    core.handle(command(MessageType.TOOL_RESULT, 2, {
        "call_id": "k-1", "succeeded": True,
        "content": {"content": _json.dumps(inner, ensure_ascii=False)},
        "artifact_ids": [], "artifacts": [],
    }))
    return core


def test_wrapped_host_result_still_yields_evidence_for_claim_support() -> None:
    core = wrapped_core()

    events = core.handle(command(MessageType.MODEL_COMPLETED, 3, {
        "content": f"A Session can contain multiple Runs. [E1] {SOURCE}",
    }))

    # Reading only the outer envelope finds no evidence, which makes every
    # citation look fabricated and reports a correct answer as unverifiable.
    assert "message.completed" in kinds(events)
    assert "citation.required" not in kinds(events)


def test_grounded_answer_citing_a_figure_absent_from_the_passage_is_sent_back() -> None:
    core = retrieved_core(grounded=True)

    events = core.handle(command(MessageType.MODEL_COMPLETED, 3, {
        "content": f"默认端口是 18642。[E1] {SOURCE}",
    }))

    # The cited passage says nothing about a port. Accepting this is exactly
    # the failure grounded answering exists to prevent, so the turn goes back
    # to the model instead of reaching the user.
    assert "citation.required" in kinds(events)
    assert "message.completed" not in kinds(events)


def test_grounded_answer_supported_by_its_passage_completes() -> None:
    core = retrieved_core(grounded=True)

    events = core.handle(command(MessageType.MODEL_COMPLETED, 3, {
        "content": f"A Session can contain multiple Runs. [E1] {SOURCE}",
    }))

    assert "message.completed" in kinds(events)
    assert "citation.required" not in kinds(events)


def test_grounded_run_gives_up_with_a_warning_rather_than_looping() -> None:
    core = retrieved_core(grounded=True)
    core.handle(command(MessageType.MODEL_COMPLETED, 3, {"content": f"默认端口是 18642。[E1] {SOURCE}"}))

    events = core.handle(command(MessageType.MODEL_COMPLETED, 4, {
        "content": f"默认端口仍然是 18642。[E1] {SOURCE}",
    }))

    assert "citation.warning" in kinds(events)
    assert "run.completed" in kinds(events)


def test_ungrounded_run_never_pays_for_the_per_sentence_check() -> None:
    core = retrieved_core(grounded=False)

    events = core.handle(command(MessageType.MODEL_COMPLETED, 3, {
        "content": f"默认端口是 18642。[E1] {SOURCE}",
    }))

    # Same unsupported figure, but this turn did not ask to be grounded, so the
    # path it takes must be the one it took before this check existed.
    assert "message.completed" in kinds(events)
    assert "citation.required" not in kinds(events)
