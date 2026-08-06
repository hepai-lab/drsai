from __future__ import annotations

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


def test_verification_and_unknown_oaep_events_remain_observable_logs() -> None:
    state = DesktopKernelTurnState("OpenDrSai")
    verification = translate_kernel_event(_event(
        1, "verification.required", code="required_tool_omitted", requirement_sha256="a" * 64,
    ), state)[0]
    unknown = translate_kernel_event(_event(2, "artifact.created", artifact_id="artifact-1"), state)[0]

    assert verification.metadata["kernel_event"] == "verification.required"
    assert verification.metadata["level"] == "warning"
    assert unknown.metadata["kernel_event"] == "artifact.created"
