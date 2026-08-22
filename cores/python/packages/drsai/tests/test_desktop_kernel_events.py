from __future__ import annotations

import json

from drsai.backend.runtime.desktop_kernel_events import DesktopKernelTurnState, translate_kernel_event
from drsai.backend.runtime.mobile_core import MessageType, RuntimeEnvelope


def _event(sequence: int, kind: str, **payload):
    return RuntimeEnvelope(
        MessageType.RUNTIME_EVENT, f"request-{sequence}", "run-1", "session-1", sequence,
        f"event-{sequence}", {"kind": kind, **payload},
    )


def test_message_stream_and_terminal_build_existing_desktop_event_types() -> None:
    state = DesktopKernelTurnState("OpenDrSai")
    first = translate_kernel_event(_event(1, "message.delta", text="hel"), state)
    second = translate_kernel_event(_event(2, "message.delta", text="lo"), state)
    terminal = translate_kernel_event(_event(3, "run.completed", status="completed"), state)

    assert type(first[0]).__name__ == type(second[0]).__name__ == "ModelClientStreamingChunkEvent"
    assert terminal == ()
    assert state.final_text == "hello"
    assert state.terminal_kind == "run.completed"


def test_tool_events_preserve_call_identity_and_structured_result() -> None:
    state = DesktopKernelTurnState("OpenDrSai")
    started = translate_kernel_event(_event(
        1, "tool.started", call_id="call-1", name="clock", arguments={"zone": "UTC"},
    ), state)[0]
    completed = translate_kernel_event(_event(
        2, "tool.result", call_id="call-1", name="clock", result={"time": "12:00"},
    ), state)[0]

    assert started.content[0].id == completed.content[0].call_id == "call-1"
    assert started.content[0].name == completed.content[0].name == "clock"
    assert completed.content[0].is_error is False


def test_tool_inspection_survives_desktop_projection_as_ui_only_envelope() -> None:
    state = DesktopKernelTurnState("OpenDrSai")
    completed = translate_kernel_event(_event(
        1, "tool.result", call_id="search-1", name="web_search", result={"results": []},
        inspection={"kind": "web_search", "candidates": [{"title": "Candidate"}]},
    ), state)[0]

    content = json.loads(completed.content[0].content)
    assert content["result"] == {"results": []}
    assert content["_inspection"]["candidates"][0]["title"] == "Candidate"


def test_knowledge_citation_is_emitted_only_when_final_text_links_source() -> None:
    state = DesktopKernelTurnState("OpenDrSai")
    source = "opendrsai://regression/knowledge/kb/revisions/1/documents/doc.md"
    translate_kernel_event(_event(
        1, "tool.result", call_id="knowledge-1", name="knowledge_search",
        result={
            "documents": [{
                "knowledge_base_id": "kb", "knowledge_base_revision": 1,
                "document_path": "doc.md", "corpus_complete": True,
            }],
            "evidence": [{
                "knowledge_id": "kb", "knowledge_base_revision": 1,
                "document_path": "doc.md", "title": "Runtime",
                "source": source, "chunk_id": "doc.md:0", "content": "searched text",
                "content_sha256": "a" * 64, "relation": "searched_scope",
            }],
        },
    ), state)

    unlinked = translate_kernel_event(_event(2, "message.completed", text="No answer."), state)[0]
    linked = translate_kernel_event(_event(3, "message.completed", text=f"No answer. [{source}]({source})"), state)[0]

    assert "citations_json" not in unlinked.metadata
    citation = json.loads(linked.metadata["citations_json"])[0]
    assert citation["url"] == source
    assert citation["relation"] == "searched_scope"
    assert citation["knowledge_base_id"] == "kb"
    assert citation["revision"] == 1
    assert citation["document_path"] == "doc.md"
    assert citation["corpus_complete"] is True


def test_web_citation_is_emitted_only_for_url_present_in_final_text() -> None:
    state = DesktopKernelTurnState("OpenDrSai")
    source = "https://indico.cern.ch/event/1598655"
    translate_kernel_event(_event(
        1, "tool.result", call_id="web-1", name="web_search",
        result={"results": [{"title": "HEPiX Spring 2026", "url": source}]},
    ), state)

    message = translate_kernel_event(_event(
        2, "message.completed", text=f"Official source: {source}",
    ), state)[0]
    citation = json.loads(message.metadata["citations_json"])[0]

    assert citation["url"] == source
    assert citation["title"] == "HEPiX Spring 2026"
    assert citation["relation"] == "supports_claim"
    assert citation["citation_id"]


def test_verification_and_unknown_oaep_events_remain_observable_logs() -> None:
    state = DesktopKernelTurnState("OpenDrSai")
    verification = translate_kernel_event(_event(
        1, "verification.required", code="required_tool_omitted", requirement_sha256="a" * 64,
    ), state)[0]
    unknown = translate_kernel_event(_event(2, "artifact.created", artifact_id="artifact-1"), state)[0]

    assert verification.metadata["kernel_event"] == "verification.required"
    assert verification.metadata["level"] == "warning"
    assert unknown.metadata["kernel_event"] == "artifact.created"
