from __future__ import annotations

from pathlib import Path

import pytest

from drsai.backend.runtime.desktop_oaep_bridge import DesktopOaepJournalBridge, _safe
from drsai.backend.runtime.engine import RuntimeEngine, RuntimeEngineIdentity


def _runtime(tmp_path: Path):
    engine = RuntimeEngine(
        tmp_path / "runtime.sqlite3",
        RuntimeEngineIdentity("runtime-desktop-test", "instance-desktop-test"),
        lambda workspace_id: workspace_id == "workspace-desktop-test",
    )
    session = engine.create_session("workspace-desktop-test", "Desktop OAEP")
    return engine, session


def test_desktop_bridge_preserves_diagnostic_codes_and_redacts_credentials() -> None:
    safe = _safe(
        '{"error_code":"service_unavailable","authorization":"Bearer secret-token"}'
    )

    assert "service_unavailable" in safe
    assert "secret-token" not in safe


def test_desktop_turn_is_mirrored_to_one_oaep_run(tmp_path: Path) -> None:
    engine, session = _runtime(tmp_path)
    bridge = DesktopOaepJournalBridge.begin(
        engine,
        session_id=session["session_id"],
        request_id="desktop-request-1",
        display_message="visible user message",
        source_message_id="windows-message-1",
        correlation_id="correlation-1",
        agent_definition="opendrsai@1",
        backend_id="opendrsai",
    )
    bridge.record("message.delta", {"text": "hello "})
    bridge.record(
        "tool.start",
        {"tool_id": "tool-1", "name": "shell", "args": {"command": "safe"}},
    )
    bridge.record(
        "tool.complete",
        {"tool_id": "tool-1", "name": "shell", "result": "done"},
    )
    bridge.record("message.delta", {"text": "world"})
    bridge.complete({"text": "hello world"})

    snapshot = engine.oaep_snapshot(session["session_id"])
    run = next(item for item in snapshot["runs"] if item["id"] == bridge.run_id)
    assert run["status"] == "completed"
    user = next(
        item
        for item in snapshot["items"]
        if item["run_id"] == bridge.run_id and item["content"].get("role") == "user"
    )
    assert user["source"]["client"] == "windows"
    assert user["source"]["message_id"] == "windows-message-1"
    assert user["content"]["text"] == "visible user message"
    assistant_messages = [
        item
        for item in snapshot["items"]
        if item["run_id"] == bridge.run_id and item["content"].get("role") == "assistant"
        and item["type"] == "message"
    ]
    assert "hello world" in [item["content"]["text"] for item in assistant_messages]
    tool = next(
        item
        for item in snapshot["items"]
        if item["run_id"] == bridge.run_id and item["type"] in {"tool_call", "command_execution"}
    )
    assert tool["status"] == "completed"


def test_desktop_retry_reuses_run_and_does_not_duplicate_events(tmp_path: Path) -> None:
    engine, session = _runtime(tmp_path)
    first = DesktopOaepJournalBridge.begin(
        engine,
        session_id=session["session_id"],
        request_id="desktop-retry-1",
        display_message="retry-safe",
        source_message_id="windows-retry-1",
        correlation_id="correlation-retry",
        agent_definition="opendrsai@1",
        backend_id="opendrsai",
    )
    first.record("message.delta", {"text": "alpha"})
    first.record("tool.start", {"tool_id": "stable-tool", "name": "shell"})
    first.record("tool.complete", {"tool_id": "stable-tool", "name": "shell"})
    first.complete({"text": "alpha"})
    before = engine.oaep_snapshot(session["session_id"])

    retry = DesktopOaepJournalBridge.begin(
        engine,
        session_id=session["session_id"],
        request_id="desktop-retry-1",
        display_message="retry-safe",
        source_message_id="windows-retry-1",
        correlation_id="correlation-retry",
        agent_definition="opendrsai@1",
        backend_id="opendrsai",
        retry_attempt=1,
        resume_from_chars=5,
    )
    assert retry.run_id == first.run_id
    retry.record("message.delta", {"text": "alpha"})
    retry.record("tool.start", {"tool_id": "stable-tool", "name": "shell"})
    retry.record("tool.complete", {"tool_id": "stable-tool", "name": "shell"})
    retry.complete({"text": "alpha"})
    after = engine.oaep_snapshot(session["session_id"])
    assert after == before


def test_desktop_partial_stream_retry_resumes_from_character_cursor(
    tmp_path: Path,
) -> None:
    engine, session = _runtime(tmp_path)
    common = {
        "session_id": session["session_id"],
        "request_id": "desktop-partial-retry-1",
        "display_message": "partial retry",
        "source_message_id": "windows-partial-retry-1",
        "correlation_id": "correlation-partial-retry",
        "agent_definition": "opendrsai@1",
        "backend_id": "opendrsai",
    }
    first = DesktopOaepJournalBridge.begin(engine, **common)
    first.record("message.delta", {"text": "alpha"})

    retry = DesktopOaepJournalBridge.begin(
        engine, retry_attempt=1, resume_from_chars=5, **common
    )
    assert retry.run_id == first.run_id
    retry.record("message.delta", {"text": "alpha"})
    retry.record("message.delta", {"text": " beta"})
    retry.complete({"text": "alpha beta"})

    snapshot = engine.oaep_snapshot(session["session_id"])
    assistant = next(
        item
        for item in snapshot["items"]
        if item["run_id"] == retry.run_id
        and item["type"] == "message"
        and item["content"].get("role") == "assistant"
    )
    assert assistant["content"]["text"] == "alpha beta"


def test_desktop_request_identity_rejects_different_message(tmp_path: Path) -> None:
    engine, session = _runtime(tmp_path)
    kwargs = {
        "session_id": session["session_id"],
        "request_id": "desktop-conflict-1",
        "source_message_id": "windows-conflict-1",
        "correlation_id": "correlation-conflict",
        "agent_definition": "opendrsai@1",
        "backend_id": "opendrsai",
    }
    DesktopOaepJournalBridge.begin(
        engine, display_message="first message", **kwargs
    )
    with pytest.raises(ValueError, match="another message"):
        DesktopOaepJournalBridge.begin(
            engine, display_message="different message", **kwargs
        )


@pytest.mark.parametrize(
    ("terminal", "expected"),
    [("cancel", "cancelled"), ("fail", "failed")],
)
def test_desktop_turn_records_non_success_terminal_state(
    tmp_path: Path, terminal: str, expected: str
) -> None:
    engine, session = _runtime(tmp_path)
    bridge = DesktopOaepJournalBridge.begin(
        engine,
        session_id=session["session_id"],
        request_id=f"desktop-{terminal}-1",
        display_message=f"{terminal} message",
        source_message_id=f"windows-{terminal}-1",
        correlation_id=f"correlation-{terminal}",
        agent_definition="opendrsai@1",
        backend_id="opendrsai",
    )
    if terminal == "cancel":
        bridge.cancel()
    else:
        bridge.fail({"code": "test_failure", "message": "safe failure"})
    assert engine.get_run(bridge.run_id)["status"] == expected
    snapshot = engine.oaep_snapshot(session["session_id"])
    assert next(run for run in snapshot["runs"] if run["id"] == bridge.run_id)[
        "status"
    ] == expected
