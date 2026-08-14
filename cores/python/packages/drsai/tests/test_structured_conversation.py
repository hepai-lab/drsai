from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sys


MODULE_PATH = (
    Path(__file__).parents[1]
    / "src"
    / "drsai"
    / "backend"
    / "runtime"
    / "conversation.py"
)
SPEC = importlib.util.spec_from_file_location("drsai_structured_conversation_test", MODULE_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)

STRUCTURED_SSE_EVENT = MODULE.STRUCTURED_SSE_EVENT
StructuredConversationProjector = MODULE.StructuredConversationProjector
encode_structured_sse = MODULE.encode_structured_sse

TRANSLATOR_PATH = Path(__file__).parents[1] / "src" / "drsai" / "backend" / "tui_gateway" / "adapter" / "event_translator.py"
TRANSLATOR_SPEC = importlib.util.spec_from_file_location("drsai_event_translator_test", TRANSLATOR_PATH)
assert TRANSLATOR_SPEC and TRANSLATOR_SPEC.loader
TRANSLATOR = importlib.util.module_from_spec(TRANSLATOR_SPEC)
sys.modules[TRANSLATOR_SPEC.name] = TRANSLATOR
TRANSLATOR_SPEC.loader.exec_module(TRANSLATOR)


NOW = "2026-07-17T00:00:00Z"


def _projector(turn_id: str = "turn-1") -> StructuredConversationProjector:
    return StructuredConversationProjector(turn_id, now=lambda: NOW)


def test_projects_reasoning_and_markdown_without_leaking_think_tags() -> None:
    projector = _projector()
    events = projector.project("message.delta", {"text": "<thi", "source": "agent"})
    events += projector.project("message.delta", {"text": "nk>first</think>Final", "source": "agent"})
    events += projector.project("thinking.delta", {"text": "first", "source": "agent"})
    events += projector.complete({"usage": {"model": "test-model"}})

    reasoning_parts = [event for event in events if event.get("part", {}).get("kind") == "reasoning"]
    markdown_deltas = [
        event["delta"]["text"] for event in events
        if event["type"] == "part.delta" and event["delta"]["kind"] == "markdown.append"
    ]
    assert len({event["part"]["id"] for event in reasoning_parts}) == 1
    assert "".join(markdown_deltas) == "Final"
    assert all("<think>" not in json.dumps(event) for event in events)
    assert projector._reasoning_text() == "first"


def test_projects_tool_updates_as_activity_not_chat_parts() -> None:
    projector = _projector()
    started = projector.project("tool.start", {"tool_id": "call-1", "name": "run_shell", "args": {"cmd": "pwd"}})
    completed = projector.project("tool.complete", {"tool_id": "call-1", "name": "run_shell", "result": "ok"})

    activities = [event["activity"] for event in started + completed if event["type"] == "activity.updated"]
    assert [activity["status"] for activity in activities] == ["running", "completed"]
    assert activities[0]["id"] == activities[1]["id"]
    assert not projector.parts


def test_projects_capability_configuration_as_a_typed_private_interaction() -> None:
    projector = _projector()
    events = projector.project("interaction.request", {
        "request_id": "capability-1",
        "interaction_type": "capability_configuration",
        "prompt": "Web search is needed",
        "request_summary": {
            "capability": "web.search",
            "resource_kind": "public_web",
            "preferred_adapter": "tavily",
            "reason": "credential_missing",
            "query_disclosed": False,
        },
    })
    part = next(event["part"] for event in events if event["type"] == "part.started")
    assert part["interactionType"] == "capability_configuration"
    assert part["capability"] == "web.search"
    assert part["preferredAdapter"] == "tavily"
    assert part["queryDisclosed"] is False
    assert "api_key" not in json.dumps(part).lower()


def test_multiple_thinking_events_share_one_reasoning_part() -> None:
    projector = _projector()
    events = projector.project("thinking.delta", {"text": "one", "source": "agent"})
    events += projector.project("thinking.delta", {"text": "two", "source": "agent"})
    events += projector.complete()

    started = [event for event in events if event["type"] == "part.started" and event["part"]["kind"] == "reasoning"]
    assert len(started) == 1
    assert len(projector.parts[projector.reasoning_part_id]["segments"]) == 2


def test_completion_is_idempotent_and_sequences_are_monotonic() -> None:
    projector = _projector()
    events = projector.project("message.delta", {"text": "answer"})
    events += projector.complete({"usage": {"model": "m", "total_tokens": 3}})
    assert projector.complete() == []
    assert [event["sequence"] for event in events] == list(range(1, len(events) + 1))
    assert len({event["dedupeKey"] for event in events}) == len(events)
    assert events[-1]["type"] == "turn.completed"


def test_subagent_maps_to_one_subtask_part() -> None:
    projector = _projector()
    events = projector.project("subagent.thinking", {"source": "sub:literature", "text": "searching"})
    events += projector.project("subagent.complete", {"source": "sub:literature", "text": "done"})
    subtask_events = [event for event in events if event.get("part", {}).get("kind") == "subtask"]
    assert len({event["part"]["id"] for event in subtask_events}) == 1


def test_structured_sse_encoding_uses_named_event() -> None:
    event = _projector().start()[0]
    frame = encode_structured_sse(event)
    assert frame.startswith(f"event: {STRUCTURED_SSE_EVENT}\n")
    assert json.loads(frame.split("data: ", 1)[1]) == event


def test_projector_covers_all_eight_assistant_part_kinds() -> None:
    projector = _projector()
    projector.project("message.delta", {"text": "answer"})
    projector.project("thinking.delta", {"text": "reasoning"})
    projector.project("progress.update", {"progress_id": "p", "summary": "working", "status": "running"})
    projector.project("artifact.created", {"artifact_id": "a", "artifact_type": "report", "name": "report.md"})
    projector.project("citation.added", {"citation_id": "c", "title": "Paper", "url": "https://example.test"})
    projector.project("interaction.request", {"request_id": "i", "interaction_type": "approval", "prompt": "Continue?"})
    projector.project("subagent.thinking", {"source": "sub:reviewer", "text": "reviewing"})
    projector.project("notice", {"id": "n", "level": "warning", "message": "Check result"})
    assert {part["kind"] for part in projector.parts.values()} == {
        "markdown", "reasoning", "progress", "artifact", "citation", "interaction", "subtask", "notice",
    }


def test_artifact_projection_preserves_oaep_integrity_and_capabilities() -> None:
    projector = _projector()
    projector.project("artifact.created", {
        "artifact_id": "artifact-1",
        "artifact_type": "file",
        "name": "output.bin",
        "mime": "application/octet-stream",
        "size": 9,
        "sha256": "a" * 64,
        "previewable": False,
        "downloadable": True,
        "source_call_id": "call-1",
    })
    artifact = next(part for part in projector.parts.values() if part["kind"] == "artifact")
    assert artifact["mime"] == "application/octet-stream"
    assert artifact["size"] == 9
    assert artifact["sha256"] == "a" * 64
    assert artifact["previewable"] is False
    assert artifact["downloadable"] is True
    assert artifact["sourceCallId"] == "call-1"


def test_files_event_translation_preserves_opaque_artifact_descriptor() -> None:
    from drsai.modules.managers.messages import FileInfo, FilesContent, FilesEvent

    translated = TRANSLATOR.translate(FilesEvent(
        source="OpenDrSai",
        content=FilesContent(files=[FileInfo(
            artifact_id="artifact-binary",
            name="output.bin",
            mime_type="application/octet-stream",
            size=7,
            sha256="b" * 64,
            previewable=False,
            downloadable=True,
            source_call_id="call-binary",
            download_method="none",
        )]),
    ), TRANSLATOR.TurnState())
    assert translated == [("artifact.created", {
        "artifact_id": "artifact-binary",
        "artifact_type": "file",
        "name": "output.bin",
        "title": "Agent files",
        "summary": "",
        "url": None,
        "mime": "application/octet-stream",
        "size": 7,
        "sha256": "b" * 64,
        "previewable": False,
        "downloadable": True,
        "source_call_id": "call-binary",
        "source": "OpenDrSai",
    })]


def test_citation_adds_stable_bidirectional_relations() -> None:
    projector = _projector()
    projector.project("message.delta", {"text": "answer"})
    projector.project("artifact.created", {
        "artifact_id": "report-1",
        "artifact_type": "report",
        "name": "report.md",
        "citation_ids": ["source-1"],
    })
    events = projector.project("citation.added", {
        "citation_id": "source-1",
        "title": "Paper",
        "url": "https://example.test",
        "artifact_id": "report-1",
    })

    markdown = projector.parts[projector.markdown_part_id]
    citation = next(part for part in projector.parts.values() if part["kind"] == "citation")
    artifact = next(part for part in projector.parts.values() if part["kind"] == "artifact")
    assert markdown["citationIds"] == ["source-1"]
    assert artifact["citationIds"] == ["source-1"]
    assert citation["markdownPartId"] == projector.markdown_part_id
    assert citation["artifactId"] == "report-1"
    assert any(event.get("delta", {}).get("kind") == "markdown.citations" for event in events)


def test_provider_metadata_citations_are_normalized_and_deduplicated() -> None:
    state = TRANSLATOR.TurnState()
    metadata = {
        "annotations": [{
            "type": "url_citation",
            "url_citation": {
                "url": "https://example.test/paper",
                "title": "Paper",
                "start_index": 4,
                "end_index": 9,
            },
        }],
        "sources": [{"path": "results.csv", "title": "Results", "artifact_id": "result-table"}],
    }
    first = TRANSLATOR.extract_citation_payloads(metadata, state)
    second = TRANSLATOR.extract_citation_payloads(metadata, state)
    assert len(first) == 2
    assert second == []
    assert first[0]["url"] == "https://example.test/paper"
    assert first[0]["locator"] == "chars 4-9"
    assert first[1]["path"] == "results.csv"
    assert first[1]["artifact_id"] == "result-table"


def test_knowledge_citation_metadata_survives_normalization_and_projection() -> None:
    state = TRANSLATOR.TurnState()
    source = "opendrsai://regression/knowledge/kb/revisions/1/documents/doc.md"
    payload = TRANSLATOR.extract_citation_payloads({"citations": [{
        "url": source, "title": "Runtime", "relation": "searched_scope",
        "knowledge_base_id": "kb", "revision": 1, "document_path": "doc.md",
        "corpus_complete": True,
    }]}, state)[0]
    projector = _projector()
    projector.project("message.delta", {"text": "No answer"})
    projector.project("citation.added", payload)
    citation = next(part for part in projector.parts.values() if part["kind"] == "citation")
    assert citation["relation"] == "searched_scope"
    assert citation["knowledge_base_id"] == "kb"
    assert citation["revision"] == 1
    assert citation["document_path"] == "doc.md"
    assert citation["corpus_complete"] is True


def test_error_and_cancelled_turns_keep_terminal_part_state() -> None:
    failed = _projector("failed")
    failed.project("message.delta", {"text": "partial"})
    failed_events = failed.complete({"message": "Model unavailable"}, status="error")
    assert failed.parts[failed.markdown_part_id]["status"] == "error"
    assert any(event.get("part", {}).get("kind") == "notice" for event in failed_events)
    assert failed_events[-1]["type"] == "turn.error"

    cancelled = _projector("cancelled")
    cancelled.project("message.delta", {"text": "partial"})
    cancelled.complete(status="cancelled")
    assert cancelled.parts[cancelled.markdown_part_id]["status"] == "cancelled"


if __name__ == "__main__":
    tests = [value for name, value in globals().copy().items() if name.startswith("test_") and callable(value)]
    for test in tests:
        test()
    print(f"Structured conversation gateway verification passed ({len(tests)} checks).")
