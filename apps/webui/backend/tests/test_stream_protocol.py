from drsai_ui.ui_backend.backend.web.stream_protocol import (
    StreamProjector,
    is_default_continuation_prompt,
)


def test_reasoning_and_content_share_one_message_lifecycle() -> None:
    projector = StreamProjector(run_id=7)
    events = []
    events += projector.ingest_chunk("assistant", "<think>分析")
    events += projector.ingest_chunk("assistant", "中</think>答案")
    events += projector.complete("assistant", "答案")

    assert [event["seq"] for event in events] == list(range(1, len(events) + 1))
    assert len({event["message_id"] for event in events}) == 1
    assert [event["event"] for event in events].count("message.started") == 1
    assert events[-1]["event"] == "message.completed"
    assert events[-1]["snapshot"] == {
        "reasoning": "分析中",
        "content": "答案",
        "status": "completed",
    }


def test_tool_interrupt_closes_segment_and_next_chunk_gets_new_id() -> None:
    projector = StreamProjector(run_id=8)
    first = projector.ingest_chunk("assistant", "准备调用工具")
    interrupted = projector.interrupt()
    second = projector.ingest_chunk("assistant", "工具结果如下")

    assert interrupted[-1]["status"] == "interrupted"
    assert first[0]["message_id"] == interrupted[0]["message_id"]
    assert second[0]["message_id"] != first[0]["message_id"]


def test_replay_is_idempotent_and_snapshot_recovers_old_gap() -> None:
    projector = StreamProjector(run_id=9, journal_size=2)
    projector.ingest_chunk("assistant", "<think>x</think>")
    projector.ingest_chunk("assistant", "abc")
    projector.complete("assistant", "abc")

    replay = projector.replay_after(projector.seq - 1)
    assert len(replay) == 1
    assert replay[0]["event"] == "message.completed"

    snapshot = projector.replay_after(0)
    assert snapshot[-1]["event"] == "message.snapshot"
    assert snapshot[-1]["snapshot"]["content"] == "abc"


def test_late_thought_updates_completed_message_without_opening_another() -> None:
    projector = StreamProjector(run_id=10)
    first = projector.ingest_chunk("assistant", "正文")
    completed = projector.complete("assistant", "正文")
    late = projector.ingest_thought("assistant", "迟到的思考")

    assert late[0]["event"] == "message.snapshot"
    assert late[0]["message_id"] == first[0]["message_id"]
    assert late[0]["message_id"] == completed[-1]["message_id"]
    assert late[0]["status"] == "completed"
    assert projector.complete("assistant", "正文") == []


def test_default_continuation_prompt_detection() -> None:
    assert is_default_continuation_prompt("Enter your response: ")
    assert is_default_continuation_prompt("Handoff received from agent. Enter your response: ")
    assert not is_default_continuation_prompt("Please approve the plan", "approval")
    assert not is_default_continuation_prompt("确认是否继续执行实验？")


def test_turn_ready_and_interaction_required_are_sequenced() -> None:
    projector = StreamProjector(run_id=11)
    projector.ingest_chunk("assistant", "答案")
    projector.complete("assistant", "答案")
    ready = projector.emit_turn_ready(prompt="Enter your response: ")
    required = projector.emit_interaction_required(
        prompt="Please approve the plan",
        input_type="approval",
    )

    assert ready["event"] == "turn.ready"
    assert ready["status"] == "ready"
    assert ready["final_message_id"] == ready["message_id"]
    assert ready["interaction"]["kind"] == "continuation"
    assert required["event"] == "interaction.required"
    assert required["status"] == "awaiting_input"
    assert required["seq"] == ready["seq"] + 1


def test_turn_ready_pins_last_completed_hop_not_interrupted() -> None:
    projector = StreamProjector(run_id=13)
    first = projector.ingest_chunk("assistant", "先加载技能")
    projector.interrupt()
    second = projector.ingest_chunk("assistant", "这是终稿")
    projector.complete("assistant", "这是终稿")
    ready = projector.emit_turn_ready(prompt="Enter your response: ")

    assert first[0]["message_id"] != second[0]["message_id"]
    assert ready["final_message_id"] == second[0]["message_id"]
    assert ready["message_id"] == second[0]["message_id"]


def test_assistant_textmessage_is_draft_until_turn_ready() -> None:
    projector = StreamProjector(run_id=14)
    started = projector.ingest_chunk("Assistant", "你好！我是 **DrSai")
    draft = projector.apply_draft("Assistant", "你好！我是 **DrSai Synchrotron**")
    more = projector.ingest_chunk("Assistant", "，助手")
    sealed = projector.seal_active_assistant()
    ready = projector.emit_turn_ready(prompt="Enter your response: ")

    message_id = started[0]["message_id"]
    assert all(event["message_id"] == message_id for event in draft + more + sealed)
    assert [event["event"] for event in draft] == ["message.snapshot"]
    assert more[0]["event"] == "message.delta"
    assert "message.completed" not in [event["event"] for event in draft + more]
    assert sealed[-1]["event"] == "message.completed"
    assert sealed[-1]["snapshot"]["content"] == "你好！我是 **DrSai Synchrotron**，助手"
    assert ready["event"] == "turn.ready"
    assert ready["final_message_id"] == message_id
    assert ready["seq"] == sealed[-1]["seq"] + 1


def test_keep_open_complete_unlocks_but_allows_late_deltas() -> None:
    projector = StreamProjector(run_id=19)
    started = projector.ingest_chunk("Assistant", "你好")
    sealed = projector.complete(
        "Assistant", "你好，我是助手", keep_open=True
    )
    late = projector.ingest_chunk("Assistant", "！")
    projector.close_turn()
    nxt = projector.ingest_chunk("Assistant", "第二轮")

    assert sealed[-1]["event"] == "message.completed"
    assert sealed[-1]["status"] == "completed"
    assert "Assistant" in projector.active or late[0]["message_id"] == started[0]["message_id"]
    assert late[0]["message_id"] == started[0]["message_id"]
    assert late[0]["event"] == "message.delta"
    assert nxt[0]["event"] == "message.started"
    assert nxt[0]["message_id"] != started[0]["message_id"]


def test_shorter_textmessage_does_not_seal_or_truncate() -> None:
    projector = StreamProjector(run_id=15)
    projector.ingest_chunk("Assistant", "根据你的实验技术需求匹配线站")
    events = projector.apply_draft("Assistant", "根据你的实验技术需求")
    assert events == []
    assert projector.active["Assistant"].content == "根据你的实验技术需求匹配线站"
    assert projector.active["Assistant"].status == "streaming"


def test_chunks_after_complete_open_new_message() -> None:
    """Next-turn tokens must not append onto a sealed hop (answer-above-user bug)."""
    projector = StreamProjector(run_id=16)
    first = projector.ingest_chunk("Assistant", "根据你的实验技术")
    completed = projector.complete("Assistant", "根据你的实验技术")
    second = projector.ingest_chunk("Assistant", "新一轮回复")

    assert completed[-1]["event"] == "message.completed"
    assert second[0]["event"] == "message.started"
    assert second[0]["message_id"] != first[0]["message_id"]
    assert projector.active["Assistant"].content == "新一轮回复"


def test_close_turn_forces_new_hop_after_ready() -> None:
    projector = StreamProjector(run_id=18)
    first = projector.ingest_chunk("Assistant", "第一轮")
    projector.seal_active_assistant()
    projector.emit_turn_ready(prompt="Enter your response: ")
    projector.close_turn()
    second = projector.ingest_chunk("Assistant", "第二轮")

    assert second[0]["event"] == "message.started"
    assert second[0]["message_id"] != first[0]["message_id"]


def test_complete_does_not_replace_with_shorter_body() -> None:
    projector = StreamProjector(run_id=17)
    projector.ingest_chunk("Assistant", "完整的介绍列表")
    sealed = projector.complete("Assistant", "完整")
    assert sealed[-1]["snapshot"]["content"] == "完整的介绍列表"


def test_agent_working_is_run_level_and_sequenced() -> None:
    projector = StreamProjector(run_id=12)
    working = projector.emit_agent_working(phase="orchestrator")
    after_tool = projector.emit_agent_working(phase="tool", detail="ToolCallRequestEvent")
    after_model = projector.emit_agent_working(phase="model")

    assert working["event"] == "agent.working"
    assert working["status"] == "active"
    assert working["working"] == {"phase": "orchestrator", "detail": ""}
    assert after_tool["working"]["phase"] == "tool"
    assert after_tool["working"]["detail"] == "ToolCallRequestEvent"
    assert after_model["seq"] == working["seq"] + 2
    # No message row required — message_id may be a placeholder UUID.
    assert "message_id" in after_model


def test_seal_active_assistant_before_user_proxy_clears_keep_open_hop() -> None:
    """When close_turn wasn't called (no turn.ready), a keep_open assistant
    hop lingers in active.  Sealing before the user_proxy TextMessage ensures
    the next assistant reasoning opens a new message_id instead of appending
    onto the previous turn's bubble (answer-above-user bug)."""
    projector = StreamProjector(run_id=20)
    first = projector.ingest_chunk("Assistant", "第一轮回复")
    projector.complete("Assistant", "第一轮回复", keep_open=True)
    # No turn.ready / close_turn — hop lingers in active, status=completed
    assert "Assistant" in projector.active
    assert projector.active["Assistant"].status == "completed"
    # Simulate what connection.py does when a user_proxy TextMessage arrives:
    # seal lingering assistant hops first.
    seal_events = projector.seal_active_assistant()
    # Already-completed hop: seal returns [] and pops from active
    assert seal_events == []
    assert "Assistant" not in projector.active
    # User proxy message
    user_events = projector.complete("user_proxy", "学术写作")
    assert user_events[-1]["event"] == "message.completed"
    user_msg_id = user_events[-1]["message_id"]
    # Next assistant reasoning must get a new message_id
    second = projector.ingest_chunk("Assistant", "第二轮")
    assert second[0]["event"] == "message.started"
    assert second[0]["message_id"] != first[0]["message_id"]
    assert second[0]["message_id"] != user_msg_id
