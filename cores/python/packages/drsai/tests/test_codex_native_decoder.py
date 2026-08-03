from __future__ import annotations

from drsai.backend.codex_adapter.native_decoder import CodexNativeEventDecoder
from drsai.backend.runtime.normalized_events import (
    NormalizedDeltaKind,
    NormalizedEventKind,
    NormalizedItemType,
    NormalizedTerminalStatus,
)


def test_decoder_maps_thread_turn_item_and_terminal_identities() -> None:
    decoder = CodexNativeEventDecoder()
    started = decoder.decode({"method": "turn/started", "params": {
        "threadId": "thread-1", "turn": {"id": "turn-1"},
    }})
    assert started is not None
    assert started.kind is NormalizedEventKind.RUN_STARTED
    assert started.binding.session_id == "thread-1"
    assert started.binding.run_id == "turn-1"

    completed = decoder.decode({"method": "turn/completed", "params": {
        "threadId": "thread-1", "turn": {"id": "turn-1", "status": "interrupted"},
    }})
    assert completed is not None
    assert completed.kind is NormalizedEventKind.RUN_CANCELLED
    assert completed.terminal_status is NormalizedTerminalStatus.CANCELLED


def test_decoder_maps_all_stable_delta_families_with_ordinals() -> None:
    decoder = CodexNativeEventDecoder()
    fixtures = [
        ("item/agentMessage/delta", NormalizedItemType.MESSAGE, NormalizedDeltaKind.MESSAGE_TEXT_APPEND),
        ("item/plan/delta", NormalizedItemType.PLAN, NormalizedDeltaKind.PLAN_TEXT_APPEND),
        ("item/reasoning/textDelta", NormalizedItemType.REASONING, NormalizedDeltaKind.REASONING_TEXT_APPEND),
        ("item/commandExecution/outputDelta", NormalizedItemType.COMMAND_EXECUTION,
         NormalizedDeltaKind.COMMAND_OUTPUT_APPEND),
    ]
    for method, item_type, delta_kind in fixtures:
        params = {"threadId": "t", "turnId": "r", "itemId": "i", "delta": "same"}
        first = decoder.decode({"method": method, "params": params})
        second = decoder.decode({"method": method, "params": params})
        assert first is not None and second is not None
        assert first.item_type is item_type and first.delta_kind is delta_kind
        assert first.payload["ordinal"] == 1 and second.payload["ordinal"] == 2
        assert first.dedupe_key != second.dedupe_key


def test_decoder_maps_items_phase_subtask_and_safe_unknown() -> None:
    decoder = CodexNativeEventDecoder()
    message = decoder.decode({"method": "item/completed", "params": {
        "threadId": "t", "turnId": "r", "item": {
            "id": "m", "type": "agentMessage", "phase": "commentary", "text": "working",
        },
    }})
    assert message is not None
    assert message.item_type is NormalizedItemType.MESSAGE and message.phase == "commentary"

    subtask = decoder.decode({"method": "item/started", "params": {
        "threadId": "t", "turnId": "r", "item": {"id": "s", "type": "collabToolCall"},
    }})
    assert subtask is not None and subtask.item_type is NormalizedItemType.SUBTASK

    unknown = decoder.decode({"method": "item/completed", "params": {
        "threadId": "t", "turnId": "r", "item": {
            "id": "u", "type": "future", "accessToken": "SECRET-CANARY",
        },
    }})
    assert unknown is not None and unknown.item_type is NormalizedItemType.NOTICE
    assert "SECRET-CANARY" not in str(unknown.payload)


def test_decoder_normalizes_structured_item_payloads_and_plan_updates() -> None:
    decoder = CodexNativeEventDecoder()
    fixtures = [
        ("userMessage", {"text": "hello"}, NormalizedItemType.MESSAGE, {"role": "user"}),
        ("commandExecution", {"command": "git status", "exitCode": 0},
         NormalizedItemType.COMMAND_EXECUTION, {"exit_code": 0}),
        ("fileChange", {"path": "src/a.py", "operation": "add"},
         NormalizedItemType.FILE_CHANGE, {"changes": [{"path": "src/a.py", "operation": "add"}]}),
        ("webSearch", {"query": "OAEP"}, NormalizedItemType.TOOL_CALL, {"tool_kind": "web_search"}),
        ("imageView", {"path": "image.png"}, NormalizedItemType.TOOL_CALL, {"tool_kind": "image_view"}),
        ("collabToolCall", {"tool": "spawn", "newThreadId": "child"},
         NormalizedItemType.SUBTASK, {"child_run_id": "child"}),
    ]
    for index, (native_type, fields, expected_type, expected_payload) in enumerate(fixtures):
        event = decoder.decode({"method": "item/completed", "params": {
            "threadId": "t", "turnId": "r", "item": {"id": f"i{index}", "type": native_type, **fields},
        }})
        assert event is not None and event.item_type is expected_type
        for key, value in expected_payload.items():
            assert event.payload[key] == value

    plan = decoder.decode({"method": "turn/plan/updated", "params": {
        "threadId": "t", "turnId": "r", "explanation": "next", "plan": [
            {"step": "inspect", "status": "inProgress"},
        ],
    }})
    assert plan is not None and plan.kind is NormalizedEventKind.ITEM_UPDATED
    assert plan.item_type is NormalizedItemType.PLAN
    assert plan.binding.item_id == "plan:r"
    assert plan.payload["steps"][0]["step"] == "inspect"


def test_decoder_normalizes_real_user_content_parts_without_stringifying_arrays() -> None:
    decoder = CodexNativeEventDecoder()
    event = decoder.decode({"method": "item/completed", "params": {
        "threadId": "t", "turnId": "r", "item": {
            "id": "user-real", "type": "userMessage", "content": [
                {"type": "text", "text": "正确更新一下gitignore", "text_elements": []},
                {"type": "localImage", "path": r"C:\secret\screenshots\proof.png"},
            ],
        },
    }})
    assert event is not None
    assert event.payload["text"] == "正确更新一下gitignore"
    assert event.payload["parts"] == [
        {"type": "text", "text": "正确更新一下gitignore"},
        {"type": "image", "name": "proof.png"},
    ]
    assert "C:\\secret" not in str(event.payload)

    legacy = decoder.decode({"method": "item/completed", "params": {
        "threadId": "t", "turnId": "r", "item": {
            "id": "user-legacy", "type": "userMessage",
            "text": "[{'text': 'user: hello', 'text_elements': [], 'type': 'text'}]",
        },
    }})
    assert legacy is not None
    assert legacy.payload["text"] == "user: hello"
    assert legacy.payload["parts"] == [{"type": "text", "text": "user: hello"}]

    nested_legacy = decoder.decode({"method": "item/completed", "params": {
        "threadId": "t", "turnId": "r", "item": {
            "id": "user-nested-legacy", "type": "userMessage", "content": [{
                "type": "text", "text": "[{'text': 'user: hello', 'text_elements': [], 'type': 'text'}]",
            }],
        },
    }})
    assert nested_legacy is not None
    assert nested_legacy.payload["text"] == "user: hello"


def test_decoder_preserves_reasoning_segments_command_output_and_terminal_status() -> None:
    decoder = CodexNativeEventDecoder()
    reasoning = decoder.decode({"method": "item/completed", "params": {
        "threadId": "t", "turnId": "r", "item": {
            "id": "reasoning", "type": "reasoning",
            "summary": [{"text": "first"}, {"text": "second"}],
        },
    }})
    assert reasoning is not None
    assert reasoning.payload["segments"] == [
        {"id": "summary-1", "text": "first"},
        {"id": "summary-2", "text": "second"},
    ]

    command = decoder.decode({"method": "item/completed", "params": {
        "threadId": "t", "turnId": "r", "item": {
            "id": "command", "type": "commandExecution", "status": "failed",
            "command": ["npm", "test"], "aggregatedOutput": "1 failed", "exitCode": 1,
        },
    }})
    assert command is not None
    assert command.kind is NormalizedEventKind.ITEM_FAILED
    assert command.payload["output"] == "1 failed"
    assert command.payload["status"] == "failed"


def test_decoder_covers_current_codex_01425_thread_item_variants() -> None:
    decoder = CodexNativeEventDecoder()
    expected = {
        "hookPrompt": NormalizedItemType.INTERACTION,
        "collabAgentToolCall": NormalizedItemType.SUBTASK,
        "subAgentActivity": NormalizedItemType.SUBTASK,
        "imageGeneration": NormalizedItemType.ARTIFACT,
        "error": NormalizedItemType.NOTICE,
    }
    for index, (native_type, item_type) in enumerate(expected.items()):
        event = decoder.decode({"method": "item/completed", "params": {
            "threadId": "t", "turnId": "r", "item": {
                "id": f"current-{index}", "type": native_type, "status": "completed",
            },
        }})
        assert event is not None
        assert event.item_type is item_type
        assert event.payload.get("code") != "codex_item_unknown"
