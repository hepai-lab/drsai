from __future__ import annotations

import pytest

from drsai.backend.runtime.agent_kernel import build_citation_evidence, normalize_citation_evidence
from drsai.backend.runtime.mobile_core import MessageType, RuntimeEnvelope, create_mobile_agent_core


SOURCE = "https://example.org/hepix-2026"


def tool() -> dict:
    return {
        "name": "web.search", "version": 1, "source": "android-host", "classification": "local-equivalent",
        "description": "search", "parameters": {"type": "object", "properties": {}},
        "required_capabilities": [], "risk": "read_only", "requires_approval": False,
    }


def command(kind: MessageType, sequence: int, payload: dict, key: str | None = None) -> RuntimeEnvelope:
    return RuntimeEnvelope(kind, f"request-{sequence}", "run-cite", "session-cite", sequence, key or f"key-{sequence}", payload)


def kinds(events) -> list[str]:
    return [item.payload["kind"] for item in events if item.message_type is MessageType.RUNTIME_EVENT]


def searched_core():
    core = create_mobile_agent_core()
    core.handle(command(MessageType.START_RUN, 0, {
        "input": "HEPiX 2026是什么？请给出来源", "model_id": "model", "tools": [tool()],
    }))
    core.handle(command(MessageType.MODEL_COMPLETED, 1, {"tool_calls": [
        {"call_id": "search-1", "name": "web.search", "arguments": {"query": "HEPiX 2026"}},
    ]}))
    core.handle(command(MessageType.TOOL_RESULT, 2, {
        "call_id": "search-1", "succeeded": True,
        "content": {"status": "ok", "results": [{"title": "HEPiX 2026", "url": SOURCE}]},
        "artifact_ids": [], "artifacts": [],
    }))
    return core


def proactively_searched_core():
    core = create_mobile_agent_core()
    core.handle(command(MessageType.START_RUN, 0, {
        "input": "Tell me something interesting.", "model_id": "model", "tools": [tool()],
    }))
    core.handle(command(MessageType.MODEL_COMPLETED, 1, {"tool_calls": [
        {"call_id": "search-1", "name": "web.search", "arguments": {"query": "HEPiX 2026"}},
    ]}))
    core.handle(command(MessageType.TOOL_RESULT, 2, {
        "call_id": "search-1", "succeeded": True,
        "content": {"status": "ok", "results": [{"title": "HEPiX 2026", "url": SOURCE}]},
        "artifact_ids": [], "artifacts": [],
    }))
    return core


def test_evidence_contains_only_call_ids_and_url_digests() -> None:
    evidence = build_citation_evidence([
        {"role": "tool", "tool_call_id": "search-1", "name": "web.search", "succeeded": True,
         "content": {"results": [{"url": SOURCE, "snippet": "private source text"}]}},
    ], f"See [{SOURCE}]({SOURCE})", retrieval_required=True)
    assert evidence["valid"] is True
    assert evidence["source_call_ids"] == ["search-1"]
    assert SOURCE not in str(evidence)
    assert "private source text" not in str(evidence)
    assert len(evidence["source_url_sha256"][0]) == 64
    assert normalize_citation_evidence(evidence) == evidence
    with pytest.raises(ValueError, match="citation_evidence_digest_mismatch"):
        normalize_citation_evidence({**evidence, "missing": True})


def test_knowledge_evidence_is_bound_by_hash_and_requires_source_label() -> None:
    content = {
        "require_citations": True,
        "evidence": [{
            "knowledge_id": "product-docs", "document_id": "doc-1", "chunk_id": "doc-1:0",
            "source": "guide.md", "score": 0.9, "content": "private knowledge text",
            "content_sha256": "a" * 64,
        }],
    }
    missing = build_citation_evidence([
        {"role": "tool", "tool_call_id": "kb-1", "name": "knowledge_search", "succeeded": True, "content": content},
    ], "The product supports knowledge.", retrieval_required=True)
    cited = build_citation_evidence([
        {"role": "tool", "tool_call_id": "kb-1", "name": "knowledge_search", "succeeded": True, "content": content},
    ], "The product supports knowledge (guide.md).", retrieval_required=True)

    assert missing["missing"] is True
    assert cited["valid"] is True
    assert cited["knowledge_evidence_sha256"]
    assert "guide.md" not in str(cited)
    assert "private knowledge text" not in str(cited)
    assert normalize_citation_evidence(cited) == cited


def test_missing_citation_is_buffered_and_retried_then_exact_source_completes() -> None:
    core = searched_core()
    retry = core.handle(command(MessageType.MODEL_COMPLETED, 3, {"content": "HEPiX 2026 is a conference."}))
    assert kinds(retry) == ["tool.decision", "citation.required"]
    assert retry[-1].message_type is MessageType.MODEL_REQUEST
    assert "HEPiX 2026 is a conference." not in str(retry)
    assert core.snapshot("run-cite")["citation_retry_count"] == 1

    completed = core.handle(command(
        MessageType.MODEL_COMPLETED, 4,
        {"content": f"HEPiX 2026 is described by the retrieved source: {SOURCE}"}, "cited",
    ))
    assert kinds(completed) == ["tool.decision", "citation.verified", "message.completed", "run.completed"]
    citation = next(item.payload for item in completed if item.payload.get("kind") == "citation.verified")
    assert citation["source_call_ids"] == ["search-1"]
    assert SOURCE not in str(citation)


def test_fabricated_url_is_rejected_and_second_invalid_answer_fails_closed() -> None:
    core = searched_core()
    first = core.handle(command(MessageType.MODEL_COMPLETED, 3, {
        "content": f"Source {SOURCE} and https://fabricated.example/claim",
    }))
    assert kinds(first) == ["tool.decision", "citation.required"]
    checkpoint = next(item for item in first if item.message_type is MessageType.CHECKPOINT_REQUEST)
    recovered = create_mobile_agent_core()
    recovered.handle(command(MessageType.RESUME_RUN, 4, {"state": checkpoint.payload["state"]}, "resume"))
    failed = recovered.handle(command(MessageType.MODEL_COMPLETED, 5, {
        "content": "Still no source URL",
    }, "invalid-again"))
    assert kinds(failed) == ["tool.decision", "run.failed"]
    failure = next(item.payload for item in failed if item.payload.get("kind") == "run.failed")
    assert failure["code"] == "citation_evidence_invalid"


def test_proactive_retrieval_still_requires_an_exact_source_url() -> None:
    core = proactively_searched_core()
    retry = core.handle(command(MessageType.MODEL_COMPLETED, 3, {
        "content": "HEPiX 2026 is a conference.",
    }))
    assert kinds(retry) == ["tool.decision", "citation.required"]
    assert retry[-1].message_type is MessageType.MODEL_REQUEST
