import pytest
import base64

from drsai.backend.runtime.mobile_core import MessageType, RuntimeEnvelope, RunPhase, create_mobile_agent_core


def command(message_type: MessageType, sequence: int, payload: dict, *, key: str | None = None) -> RuntimeEnvelope:
    return RuntimeEnvelope(
        message_type=message_type,
        request_id=f"request-{sequence}",
        run_id="run-1",
        session_id="session-1",
        sequence=sequence,
        idempotency_key=key or f"command-{sequence}",
        payload=payload,
    )


def test_text_run_emits_model_request_stream_event_and_terminal_event() -> None:
    core = create_mobile_agent_core()
    started = core.handle(command(MessageType.START_RUN, 0, {"input": "hello", "model_id": "model-1"}))
    delta = core.handle(command(MessageType.MODEL_CHUNK, 1, {"delta": "hi"}))
    completed = core.handle(command(MessageType.MODEL_COMPLETED, 2, {"content": "hi"}))

    assert [item.message_type for item in started] == [
        MessageType.RUNTIME_EVENT, MessageType.CHECKPOINT_REQUEST, MessageType.MODEL_REQUEST,
    ]
    assert started[0].payload["kind"] == "run.started"
    assert delta[0].payload == {"kind": "message.delta", "text": "hi"}
    assert completed[0].payload["kind"] == "run.completed"
    assert core.snapshot("run-1")["phase"] == RunPhase.COMPLETED.value


def test_text_artifact_is_loaded_by_opaque_id_before_model_request() -> None:
    core = create_mobile_agent_core()
    started = core.handle(command(
        MessageType.START_RUN, 0,
        {"input": "summarize", "model_id": "model-1", "artifacts": ["artifact-1"],
         "skills": [{"id": "attachments", "availability": "local"}]},
    ))
    described = core.handle(command(
        MessageType.ARTIFACT_RESULT, 1,
        {"artifact_id": "artifact-1", "operation": "describe", "mime_type": "text/plain", "size": 5},
    ))
    loaded = core.handle(command(
        MessageType.ARTIFACT_RESULT, 2,
        {"artifact_id": "artifact-1", "operation": "read", "data_base64": base64.b64encode(b"hello").decode()},
    ))

    assert started[-1].message_type is MessageType.ARTIFACT_REQUEST
    assert described[-1].payload["length"] == 5
    assert loaded[-1].message_type is MessageType.MODEL_REQUEST
    assert "hello" in loaded[-1].payload["messages"][-1]["content"]
    assert loaded[-1].payload["skills"] == [{"id": "attachments", "availability": "local"}]


def test_constrained_lifecycle_emits_degraded_event_and_is_checkpointed() -> None:
    core = create_mobile_agent_core()
    started = core.handle(command(
        MessageType.START_RUN, 0,
        {"input": "hello", "model_id": "model-1", "lifecycle_state": "low_memory"},
    ))

    assert [item.payload.get("kind") for item in started[:2]] == ["run.started", "runtime.degraded"]
    assert core.snapshot("run-1")["lifecycle_state"] == "low_memory"


def test_delegate_starts_two_logical_children_cancels_one_and_summarizes_other() -> None:
    core = create_mobile_agent_core()
    core.handle(command(MessageType.START_RUN, 0, {"input": "research", "model_id": "model-1"}))
    delegated = core.handle(command(
        MessageType.MODEL_COMPLETED, 1,
        {"tool_calls": [{"call_id": "delegate-1", "name": "delegate", "arguments": {"tasks": [
            {"task_id": "child-a", "prompt": "A"}, {"task_id": "child-b", "prompt": "B"},
        ]}}]},
    ))
    cancelled = core.handle(command(MessageType.CANCEL_RUN, 2, {"subagent_id": "child-a"}))
    completed = core.handle(command(
        MessageType.MODEL_COMPLETED, 3, {"subagent_id": "child-b", "content": "answer B"},
    ))

    requests = [item for item in delegated if item.message_type is MessageType.MODEL_REQUEST]
    assert [item.payload["subagent_id"] for item in requests] == ["child-a", "child-b"]
    assert cancelled[0].payload["kind"] == "subagent.cancelled"
    assert completed[0].payload["kind"] == "subagent.completed"
    assert completed[-1].message_type is MessageType.MODEL_REQUEST
    assert completed[-1].payload["messages"][-1]["content"] == "[child-b] completed: answer B"


def test_pure_core_text_tool_executes_without_android_tool_host_round_trip() -> None:
    core = create_mobile_agent_core()
    core.handle(command(MessageType.START_RUN, 0, {"input": "count", "model_id": "model-1"}))
    tool = core.handle(command(
        MessageType.MODEL_COMPLETED, 1,
        {"tool_calls": [{"call_id": "stats-1", "name": "core.text_stats", "arguments": {"text": "one two\nthree"}}]},
    ))

    assert MessageType.TOOL_CALL_REQUEST not in [item.message_type for item in tool]
    assert [item.payload.get("kind") for item in tool[:2]] == ["tool.started", "tool.result"]
    assert tool[-1].message_type is MessageType.MODEL_REQUEST
    assert tool[-1].payload["messages"][-1]["content"] == '{"characters": 13, "lines": 2, "words": 3}'


def test_tool_loop_returns_to_model_and_never_reexecutes_completed_call() -> None:
    core = create_mobile_agent_core()
    core.handle(command(MessageType.START_RUN, 0, {"input": "time", "model_id": "model-1"}))
    tool = core.handle(
        command(
            MessageType.MODEL_COMPLETED,
            1,
            {"tool_calls": [{"call_id": "call-1", "name": "clock", "arguments": {}}]},
        )
    )
    next_model = core.handle(
        command(MessageType.TOOL_RESULT, 2, {"call_id": "call-1", "succeeded": True, "content": {"time": "12:00"}})
    )
    replay = core.handle(
        command(
            MessageType.TOOL_RESULT,
            2,
            {"call_id": "call-1", "succeeded": True, "content": {"time": "12:00"}},
            key="command-2",
        )
    )

    assert [item.message_type for item in tool] == [MessageType.CHECKPOINT_REQUEST, MessageType.TOOL_CALL_REQUEST]
    assert next_model[0].payload["kind"] == "tool.result"
    assert next_model[1].message_type is MessageType.CHECKPOINT_REQUEST
    assert next_model[2].message_type is MessageType.MODEL_REQUEST
    assert replay == next_model
    assert core.snapshot("run-1")["completed_side_effects"] == ["call-1"]


def test_cancel_releases_session_and_model_failure_is_terminal() -> None:
    core = create_mobile_agent_core()
    start = command(MessageType.START_RUN, 0, {"input": "hello", "model_id": "model-1"})
    core.handle(start)
    cancelled = core.handle(command(MessageType.CANCEL_RUN, 1, {}))
    assert cancelled[0].payload["kind"] == "run.cancelled"

    second = RuntimeEnvelope(
        MessageType.START_RUN, "request-new", "run-2", "session-1", 0, "start-new",
        {"input": "again", "model_id": "model-1"},
    )
    core.handle(second)
    failed = core.handle(
        RuntimeEnvelope(
            MessageType.MODEL_FAILED, "request-failed", "run-2", "session-1", 1, "failed-new",
            {"code": "timeout", "retryable": True},
        )
    )
    assert failed[0].payload["kind"] == "run.failed"


def test_invalid_phase_and_parallel_session_run_are_rejected() -> None:
    core = create_mobile_agent_core()
    core.handle(command(MessageType.START_RUN, 0, {"input": "hello", "model_id": "model-1"}))
    with pytest.raises(ValueError, match="run_phase_invalid"):
        core.handle(command(MessageType.TOOL_RESULT, 1, {"call_id": "missing"}))
    with pytest.raises(ValueError, match="session_run_already_active"):
        core.handle(
            RuntimeEnvelope(
                MessageType.START_RUN, "request-2", "run-2", "session-1", 0, "start-2",
                {"input": "again", "model_id": "model-1"},
            )
        )


def test_high_risk_tool_waits_for_approval_before_host_execution() -> None:
    core = create_mobile_agent_core()
    core.handle(command(MessageType.START_RUN, 0, {"input": "save", "model_id": "model-1"}))
    approval = core.handle(
        command(
            MessageType.MODEL_COMPLETED,
            1,
            {
                "tool_calls": [
                    {
                        "call_id": "write-1",
                        "name": "save_artifact",
                        "arguments": {"artifact_id": "opaque-1"},
                        "requires_approval": True,
                        "risk": "high",
                    }
                ]
            },
        )
    )
    tool = core.handle(
        command(
            MessageType.APPROVAL_RESULT,
            2,
            {"approval_id": "approval:write-1", "call_id": "write-1", "decision": "approved"},
        )
    )

    assert [item.message_type for item in approval] == [
        MessageType.CHECKPOINT_REQUEST, MessageType.RUNTIME_EVENT, MessageType.APPROVAL_REQUEST,
    ]
    assert approval[-1].payload["name"] == "save_artifact"
    assert approval[-1].payload["arguments"] == {"artifact_id": "opaque-1"}
    assert [item.message_type for item in tool] == [
        MessageType.RUNTIME_EVENT, MessageType.CHECKPOINT_REQUEST, MessageType.TOOL_CALL_REQUEST,
    ]
    assert core.snapshot("run-1")["phase"] == RunPhase.WAITING_TOOL.value


def test_checkpoint_restores_waiting_tool_without_losing_side_effect_identity() -> None:
    first = create_mobile_agent_core()
    first.handle(command(MessageType.START_RUN, 0, {"input": "time", "model_id": "model-1"}))
    tool = first.handle(
        command(
            MessageType.MODEL_COMPLETED,
            1,
            {"tool_calls": [{"call_id": "call-1", "name": "clock", "arguments": {}}]},
        )
    )
    checkpoint = next(item for item in tool if item.message_type is MessageType.CHECKPOINT_REQUEST)

    recovered = create_mobile_agent_core().handle(
        RuntimeEnvelope(
            MessageType.RESUME_RUN,
            "resume-1",
            "run-1",
            "session-1",
            2,
            "resume:key",
            {"state": checkpoint.payload["state"]},
        )
    )

    assert recovered[0].payload["kind"] == "run.recovered"
    request = next(item for item in recovered if item.message_type is MessageType.TOOL_CALL_REQUEST)
    assert request.payload["call_id"] == "call-1"
