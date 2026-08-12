from __future__ import annotations

import json

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


def memory_tool() -> dict:
    return {
        "name": "search_memory", "version": 1, "source": "android-host", "classification": "local-equivalent",
        "description": "search memory", "parameters": {"type": "object", "properties": {}},
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


def knowledge_searched_core():
    core = create_mobile_agent_core()
    knowledge_tool = {
        "name": "knowledge_search", "version": 1, "source": "desktop-host", "classification": "local-equivalent",
        "description": "knowledge", "parameters": {"type": "object", "properties": {}},
        "required_capabilities": [], "risk": "read_only", "requires_approval": False,
    }
    core.handle(command(MessageType.START_RUN, 0, {
        "input": "仅根据知识库回答并引用", "model_id": "model", "tools": [knowledge_tool],
    }))
    core.handle(command(MessageType.MODEL_COMPLETED, 1, {"tool_calls": [
        {"call_id": "kb-1", "name": "knowledge_search", "arguments": {"query": "default port"}},
    ]}))
    core.handle(command(MessageType.TOOL_RESULT, 2, {
        "call_id": "kb-1", "succeeded": True,
        "content": {
            "require_citations": True,
            "evidence": [{
                "knowledge_id": "kb", "document_id": "doc", "chunk_id": "doc:0",
                "source": "opendrsai://knowledge/kb/doc", "score": 1.0,
                "content_sha256": "a" * 64,
            }],
        },
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


def test_https_root_url_trailing_slash_is_citation_equivalent() -> None:
    evidence = build_citation_evidence([{
        "role": "tool", "tool_call_id": "search-root", "name": "web.search", "succeeded": True,
        "content": {"results": [{"url": "https://www.hepix.org"}]},
    }], "Source: https://www.hepix.org/", retrieval_required=True)

    assert evidence["valid"] is True
    assert evidence["fabricated_url_sha256"] == []


def test_memory_results_require_exact_returned_source_marker_and_reject_fabrication() -> None:
    messages = [{
        "role": "tool", "tool_call_id": "memory-lookup-1", "name": "search_memory", "succeeded": True,
        "content": {"items": [
            {"id": 7, "source_id": "memory:7", "content": "Use concise answers"},
            {"id": 8, "source_id": "memory:8", "content": "Use detailed answers"},
        ]},
    }]
    missing = build_citation_evidence(messages, "The saved preferences conflict.", retrieval_required=False)
    cited = build_citation_evidence(
        messages, "The saved preferences conflict: concise [memory:7], detailed [memory:8].",
        retrieval_required=False,
    )
    fabricated = build_citation_evidence(messages, "Use concise answers [memory:999].", retrieval_required=False)

    assert missing["missing"] is True
    assert cited["valid"] is True
    assert len(cited["memory_source_sha256"]) == 2
    assert len(cited["memory_cited_sha256"]) == 2
    assert "Use concise answers" not in str(cited)
    assert fabricated["valid"] is False
    assert fabricated["memory_fabricated_sha256"]
    assert normalize_citation_evidence(cited) == cited


def test_empty_memory_result_does_not_require_a_source_marker() -> None:
    evidence = build_citation_evidence([{
        "role": "tool", "tool_call_id": "memory-empty", "name": "search_memory", "succeeded": True,
        "content": {"items": [], "result_count": 0},
    }], "I found no matching saved preference.", retrieval_required=False)

    assert evidence["required"] is False
    assert evidence["valid"] is True


def test_conflicting_memory_answer_is_retried_until_every_returned_source_is_marked() -> None:
    core = create_mobile_agent_core()
    core.handle(command(MessageType.START_RUN, 0, {
        "input": "What are my saved answer preferences?", "model_id": "model", "tools": [memory_tool()],
        "memory_enabled": True,
    }))
    core.handle(command(MessageType.MODEL_COMPLETED, 1, {"tool_calls": [
        {"call_id": "memory-1", "name": "search_memory", "arguments": {"query": "answer preference"}},
    ]}))
    core.handle(command(MessageType.TOOL_RESULT, 2, {
        "call_id": "memory-1", "succeeded": True,
        "content": {"items": [
            {"id": 7, "source_id": "memory:7", "content": "Use concise answers"},
            {"id": 8, "source_id": "memory:8", "content": "Use detailed answers"},
        ]},
        "artifact_ids": [], "artifacts": [],
    }))

    retry = core.handle(command(MessageType.MODEL_COMPLETED, 3, {
        "content": "Your saved preference is concise [memory:7].",
    }))
    assert kinds(retry) == ["tool.decision", "citation.required"]
    completed = core.handle(command(MessageType.MODEL_COMPLETED, 4, {
        "content": "Two saved preferences conflict: concise [memory:7] and detailed [memory:8].",
    }))
    assert kinds(completed) == ["tool.decision", "citation.verified", "message.completed", "run.completed"]


def test_missing_citation_is_buffered_and_retried_then_exact_source_completes() -> None:
    core = searched_core()
    retry = core.handle(command(MessageType.MODEL_COMPLETED, 3, {"content": "HEPiX 2026 is a conference."}))
    assert kinds(retry) == ["tool.decision", "citation.required"]
    assert retry[-1].message_type is MessageType.MODEL_REQUEST
    assert retry[-1].payload["tools"] == []
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


def test_second_invalid_answer_removes_fabricated_url_and_attaches_trusted_source() -> None:
    core = searched_core()
    first = core.handle(command(MessageType.MODEL_COMPLETED, 3, {
        "content": f"Source {SOURCE} and https://fabricated.example/claim",
    }))
    assert kinds(first) == ["tool.decision", "citation.required"]
    checkpoint = next(item for item in first if item.message_type is MessageType.CHECKPOINT_REQUEST)
    recovered = create_mobile_agent_core()
    recovered.handle(command(MessageType.RESUME_RUN, 4, {"state": checkpoint.payload["state"]}, "resume"))
    completed = recovered.handle(command(MessageType.MODEL_COMPLETED, 5, {
        "content": "Still cites https://fabricated.example/claim",
    }, "invalid-again"))
    assert kinds(completed) == ["tool.decision", "citation.verified", "message.completed", "run.completed"]
    message = next(item.payload for item in completed if item.payload.get("kind") == "message.completed")
    assert "fabricated.example" not in message["text"]
    assert SOURCE in message["text"]


def test_second_missing_citation_is_repaired_from_trusted_tool_result() -> None:
    core = searched_core()
    first = core.handle(command(MessageType.MODEL_COMPLETED, 3, {
        "content": "HEPiX 2026 is a scientific computing forum.",
    }))
    assert kinds(first) == ["tool.decision", "citation.required"]

    completed = core.handle(command(MessageType.MODEL_COMPLETED, 4, {
        "content": "HEPiX 2026 is a scientific computing forum.",
    }, "still-missing"))

    assert kinds(completed) == ["tool.decision", "citation.verified", "message.completed", "run.completed"]
    message = next(item.payload for item in completed if item.payload.get("kind") == "message.completed")
    assert SOURCE in message["text"]
    assert core.snapshot("run-cite")["phase"] == "completed"


def test_second_missing_knowledge_citation_attaches_trusted_internal_source() -> None:
    core = knowledge_searched_core()
    first = core.handle(command(MessageType.MODEL_COMPLETED, 3, {
        "content": "The supplied knowledge does not state a default port.",
    }))
    assert kinds(first) == ["tool.decision", "citation.required"]

    completed = core.handle(command(MessageType.MODEL_COMPLETED, 4, {
        "content": "The supplied knowledge does not state a default port.",
    }, "still-missing-kb"))

    assert kinds(completed) == ["tool.decision", "citation.verified", "message.completed", "run.completed"]
    message = next(item.payload for item in completed if item.payload.get("kind") == "message.completed")
    assert "opendrsai://knowledge/kb/doc" in message["text"]
    assert "Web information" not in message["text"]


def test_second_missing_citation_decodes_tavily_string_wrappers() -> None:
    core = create_mobile_agent_core()
    core.handle(command(MessageType.START_RUN, 0, {
        "input": "What is HEPiX 2026?", "model_id": "model", "tools": [tool()],
    }))
    core.handle(command(MessageType.MODEL_COMPLETED, 1, {"tool_calls": [
        {"call_id": "search-1", "name": "web.search", "arguments": {"query": "HEPiX 2026"}},
    ]}))
    tavily_result = {
        "content": repr({
            "version": 1,
            "requested_url": SOURCE,
            "final_url": SOURCE,
            "provider": "tavily",
        }),
    }
    core.handle(command(MessageType.TOOL_RESULT, 2, {
        "call_id": "search-1", "succeeded": True,
        "content": {"content": json.dumps(tavily_result)},
        "artifact_ids": [], "artifacts": [],
    }))
    first = core.handle(command(MessageType.MODEL_COMPLETED, 3, {
        "content": "HEPiX 2026 is a scientific computing forum.",
    }))
    assert kinds(first) == ["tool.decision", "citation.required"]

    completed = core.handle(command(MessageType.MODEL_COMPLETED, 4, {
        "content": "HEPiX 2026 is a scientific computing forum.",
    }, "still-missing-tavily"))

    assert kinds(completed) == ["tool.decision", "citation.verified", "message.completed", "run.completed"]
    message = next(item.payload for item in completed if item.payload.get("kind") == "message.completed")
    assert SOURCE in message["text"]


def test_unverifiable_retrieval_preserves_answer_and_completes_with_warning() -> None:
    core = create_mobile_agent_core()
    core.handle(command(MessageType.START_RUN, 0, {
        "input": "Verify HEPiX 2026.", "model_id": "model", "tools": [tool()],
    }))
    core.handle(command(MessageType.MODEL_COMPLETED, 1, {"tool_calls": [
        {"call_id": "search-1", "name": "web.search", "arguments": {"query": "HEPiX 2026"}},
    ]}))
    core.handle(command(MessageType.TOOL_RESULT, 2, {
        "call_id": "search-1", "succeeded": True,
        "content": {"status": "ok", "results": [{"title": "HEPiX", "snippet": "No public URL"}]},
        "artifact_ids": [], "artifacts": [],
    }))
    first = core.handle(command(MessageType.MODEL_COMPLETED, 3, {"content": "HEPiX is a forum. https://untrusted.example/one"}))
    assert kinds(first) == ["tool.decision", "citation.required"]

    completed = core.handle(command(MessageType.MODEL_COMPLETED, 4, {
        "content": "HEPiX is a scientific computing forum. https://untrusted.example/two",
    }, "unverifiable"))

    assert kinds(completed) == ["tool.decision", "citation.warning", "message.completed", "run.completed"]
    warning = next(item.payload for item in completed if item.payload.get("kind") == "citation.warning")
    assert warning["code"] == "citation_evidence_incomplete"
    message = next(item.payload for item in completed if item.payload.get("kind") == "message.completed")
    assert "HEPiX is a scientific computing forum." in message["text"]
    terminal = next(item.payload for item in completed if item.payload.get("kind") == "run.completed")
    assert terminal["status"] == "completed_with_warning"
    assert core.snapshot("run-cite")["phase"] == "completed"


def test_proactive_retrieval_still_requires_an_exact_source_url() -> None:
    core = proactively_searched_core()
    retry = core.handle(command(MessageType.MODEL_COMPLETED, 3, {
        "content": "HEPiX 2026 is a conference.",
    }))
    assert kinds(retry) == ["tool.decision", "citation.required"]
    assert retry[-1].message_type is MessageType.MODEL_REQUEST
