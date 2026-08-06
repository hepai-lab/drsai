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


def test_decoder_preserves_reasoning_segment_identity_and_hides_unknown_notifications() -> None:
    decoder = CodexNativeEventDecoder()
    marker = decoder.decode({"method": "item/reasoning/summaryPartAdded", "params": {
        "threadId": "t", "turnId": "r", "itemId": "reasoning", "summaryIndex": 2,
    }})
    delta = decoder.decode({"method": "item/reasoning/summaryTextDelta", "params": {
        "threadId": "t", "turnId": "r", "itemId": "reasoning", "summaryIndex": 2, "delta": "third",
    }})
    assert marker is not None and marker.segment_id == "summary-3"
    assert delta is not None and delta.segment_id == "summary-3"
    assert delta.payload["segment_id"] == "summary-3"

    content_delta = decoder.decode({"method": "item/reasoning/textDelta", "params": {
        "threadId": "t", "turnId": "r", "itemId": "reasoning", "contentIndex": 1, "delta": "detail",
    }})
    assert content_delta is not None and content_delta.segment_id == "content-2"

    unknown = decoder.decode({"method": "future/privateNotification", "params": {
        "threadId": "t", "turnId": "r", "accessToken": "SECRET-CANARY",
    }})
    assert unknown is None


def test_decoder_maps_items_phase_subtask_and_safe_unknown() -> None:
    decoder = CodexNativeEventDecoder()
    message = decoder.decode({"method": "item/completed", "params": {
        "threadId": "t", "turnId": "r", "item": {
            "id": "m", "type": "agentMessage", "phase": "commentary", "text": "working",
        },
    }})
    assert message is not None
    assert message.item_type is NormalizedItemType.MESSAGE and message.phase == "commentary"

    decoder.decode({"method": "item/started", "params": {
        "threadId": "t", "turnId": "r", "item": {
            "id": "streamed", "type": "agentMessage", "phase": "commentary", "text": "",
        },
    }})
    message_delta = decoder.decode({"method": "item/agentMessage/delta", "params": {
        "threadId": "t", "turnId": "r", "itemId": "streamed", "delta": "working",
    }})
    assert message_delta is not None and message_delta.phase == "commentary"

    subtask = decoder.decode({"method": "item/started", "params": {
        "threadId": "t", "turnId": "r", "item": {"id": "s", "type": "collabToolCall"},
    }})
    assert subtask is not None and subtask.item_type is NormalizedItemType.SUBTASK

    unknown = decoder.decode({"method": "item/completed", "params": {
        "threadId": "t", "turnId": "r", "item": {
            "id": "u", "type": "future", "accessToken": "SECRET-CANARY",
        },
    }})
    assert unknown is None


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

    literal = "[{'text': 'user: hello', 'text_elements': [], 'type': 'text'}]"
    live_literal = decoder.decode({"method": "item/completed", "params": {
        "threadId": "t", "turnId": "r", "item": {
            "id": "user-legacy", "type": "userMessage",
            "text": literal,
        },
    }})
    assert live_literal is not None
    assert live_literal.payload["text"] == literal
    assert live_literal.payload["parts"] == [{"type": "text", "text": literal}]

    history_decoder = CodexNativeEventDecoder(history_mode=True)
    legacy = history_decoder.decode({"method": "item/completed", "params": {
        "threadId": "t", "turnId": "r", "item": {
            "id": "user-history-legacy", "type": "userMessage", "text": literal,
        },
    }})
    assert legacy is not None
    assert legacy.payload["text"] == "user: hello"
    assert legacy.payload["parts"] == [{"type": "text", "text": "user: hello"}]

    nested_legacy = history_decoder.decode({"method": "item/completed", "params": {
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
        {"id": "summary-1", "text": "first", "kind": "summary", "visibility": "user", "source": "backend"},
        {"id": "summary-2", "text": "second", "kind": "summary", "visibility": "user", "source": "backend"},
    ]

    reasoning_with_content = decoder.decode({"method": "item/completed", "params": {
        "threadId": "t", "turnId": "r", "item": {
            "id": "reasoning-content", "type": "reasoning",
            "summary": [{"text": "summary"}], "content": [{"text": "detail one"}, {"text": "detail two"}],
        },
    }})
    assert reasoning_with_content is not None
    assert reasoning_with_content.payload["segments"] == [
        {"id": "summary-1", "text": "summary", "kind": "summary", "visibility": "user", "source": "backend"},
    ]
    assert "detail one" not in str(reasoning_with_content.payload)
    assert "detail two" not in str(reasoning_with_content.payload)

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


def test_decoder_separates_failure_warning_compaction_and_unknown_reroute() -> None:
    decoder = CodexNativeEventDecoder()
    failed = decoder.decode({"method": "turn/completed", "params": {
        "threadId": "t", "turn": {"id": "r", "status": "failed", "error": {"code": "boom"}},
    }})
    assert failed is not None
    assert failed.kind is NormalizedEventKind.RUN_FAILED
    assert failed.terminal_status is NormalizedTerminalStatus.FAILED

    warning = decoder.decode({"method": "deprecationNotice", "params": {
        "threadId": "t", "message": "old field", "accessToken": "SECRET-CANARY",
    }})
    assert warning is not None and warning.kind is NormalizedEventKind.ITEM_COMPLETED
    assert warning.item_type is NormalizedItemType.NOTICE
    assert warning.payload["code"] == "codex_deprecation"
    assert warning.payload["details"]["category"] == "deprecationNotice"
    assert "SECRET-CANARY" not in str(warning.payload)

    compaction = decoder.decode({"method": "item/completed", "params": {
        "threadId": "t", "turnId": "r", "item": {
            "id": "compact", "type": "contextCompaction", "message": "Context compacted",
        },
    }})
    assert compaction is not None and compaction.item_type is NormalizedItemType.NOTICE
    assert compaction.payload["code"] == "codex_contextCompaction"

    reroute = decoder.decode({"method": "model/rerouted", "params": {
        "threadId": "t", "turnId": "r", "fromModel": "requested-model", "toModel": "safe-model",
        "reason": "highRiskCyberActivity", "token": "SECRET-CANARY",
    }})
    assert reroute is not None and reroute.kind is NormalizedEventKind.ITEM_COMPLETED
    assert reroute.item_type is NormalizedItemType.NOTICE
    assert reroute.payload["code"] == "model_rerouted"
    assert reroute.payload["details"]["from_model"] == "requested-model"
    assert reroute.payload["details"]["to_model"] == "safe-model"
    assert "SECRET-CANARY" not in str(reroute.payload)

    assert decoder.decode({"method": "future/private", "params": {"token": "SECRET-CANARY"}}) is None
    assert decoder.decode({"method": "thread/tokenUsage/updated", "params": {"total": 10}}) is None


def test_decoder_turn_state_is_bounded_after_ten_thousand_short_runs() -> None:
    decoder = CodexNativeEventDecoder()
    for index in range(10_000):
        turn_id = f"turn-{index}"
        decoder.decode({"method": "turn/started", "params": {"threadId": "t", "turn": {"id": turn_id}}})
        decoder.decode({"method": "item/agentMessage/delta", "params": {
            "threadId": "t", "turnId": turn_id, "itemId": f"item-{index}", "delta": "x",
        }})
        decoder.decode({"method": "turn/completed", "params": {
            "threadId": "t", "turn": {"id": turn_id, "status": "completed"},
        }})
    assert decoder.state_diagnostics() == {"ordinals": 0, "message_phases": 0}


def test_decoder_maps_p10_semantic_notifications_without_exposing_terminal_input() -> None:
    decoder = CodexNativeEventDecoder()

    hook_started = decoder.decode({"method": "hook/started", "params": {
        "threadId": "t", "turnId": "r", "run": {
            "id": "h1", "eventName": "preToolUse", "handlerType": "command",
            "executionMode": "sync", "scope": "turn", "source": "project",
            "sourcePath": r"C:\private\hooks\check.ps1", "entries": [], "status": "running",
        },
    }})
    assert hook_started is not None
    assert hook_started.kind is NormalizedEventKind.ITEM_STARTED
    assert hook_started.item_type is NormalizedItemType.INTERACTION
    assert hook_started.payload["source_name"] == "check.ps1"
    assert "C:\\private" not in str(hook_started.payload)

    hook_completed = decoder.decode({"method": "hook/completed", "params": {
        "threadId": "t", "turnId": "r", "run": {
            "id": "h1", "eventName": "preToolUse", "handlerType": "command",
            "executionMode": "sync", "scope": "turn", "source": "project",
            "sourcePath": r"C:\private\hooks\check.ps1", "entries": [{"kind": "warning", "text": "review"}],
            "status": "completed", "durationMs": 15,
        },
    }})
    assert hook_completed is not None and hook_completed.kind is NormalizedEventKind.ITEM_COMPLETED
    assert hook_completed.binding.item_id == hook_started.binding.item_id

    terminal = decoder.decode({"method": "item/commandExecution/terminalInteraction", "params": {
        "threadId": "t", "turnId": "r", "itemId": "cmd", "processId": "p1",
        "stdin": "SECRET-TERMINAL-CANARY",
    }})
    assert terminal is not None and terminal.kind is NormalizedEventKind.ITEM_UPDATED
    assert terminal.item_type is NormalizedItemType.COMMAND_EXECUTION
    assert terminal.payload["input_redacted"] is True
    assert terminal.payload["input_bytes"] == len("SECRET-TERMINAL-CANARY")
    assert "SECRET-TERMINAL-CANARY" not in str(terminal.payload)

    patch = decoder.decode({"method": "item/fileChange/patchUpdated", "params": {
        "threadId": "t", "turnId": "r", "itemId": "files",
        "changes": [{"path": "src/a.py", "kind": {"type": "update"}, "diff": "+ok"}],
    }})
    assert patch is not None and patch.kind is NormalizedEventKind.ITEM_UPDATED
    assert patch.item_type is NormalizedItemType.FILE_CHANGE
    assert patch.payload["changes"][0]["path"] == "src/a.py"

    progress = decoder.decode({"method": "item/mcpToolCall/progress", "params": {
        "threadId": "t", "turnId": "r", "itemId": "mcp", "message": "Fetching schema",
    }})
    assert progress is not None and progress.kind is NormalizedEventKind.ITEM_DELTA
    assert progress.delta_kind is NormalizedDeltaKind.TOOL_OUTPUT_APPEND
    assert progress.payload["text"] == "Fetching schema"

    closed = decoder.decode({"method": "thread/closed", "params": {"threadId": "t"}})
    assert closed is not None and closed.kind is NormalizedEventKind.SESSION_UPDATED
    assert closed.payload["status"] == "closed"

    diff = decoder.decode({"method": "turn/diff/updated", "params": {
        "threadId": "t", "turnId": "r", "diff": "diff --git a/a b/a",
    }})
    assert diff is not None and diff.kind is NormalizedEventKind.ITEM_UPDATED
    assert diff.item_type is NormalizedItemType.FILE_CHANGE
    assert diff.binding.item_id == "turn-diff:r"

    # The reviewed Codex schema explicitly says this deprecated notification
    # is no longer emitted. It remains non-mapped by design and is accounted
    # for by the semantic-disposition registry.
    assert decoder.decode({"method": "item/fileChange/outputDelta", "params": {
        "threadId": "t", "turnId": "r", "itemId": "files", "delta": "legacy",
    }}) is None
