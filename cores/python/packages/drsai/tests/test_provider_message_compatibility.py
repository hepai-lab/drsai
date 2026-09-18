from autogen_core.models import (
    AssistantMessage,
    FunctionExecutionResult,
    FunctionExecutionResultMessage,
    ModelFamily,
    UserMessage,
)

from drsai.modules.baseagent.drsaiagent import DrSaiAgent


def test_sanitizer_does_not_persist_role_ack_insertion() -> None:
    source = DrSaiAgent._sanitize_api_messages.__doc__ or ""
    assert "provider-only compatibility" in source
    assert "does not persist them in model context" in source


class FakeClient:
    def __init__(self, family: str) -> None:
        self.model_info = {"family": family, "vision": True}


def test_claude_gets_ephemeral_continuation_ack_without_mutating_history() -> None:
    messages = [
        FunctionExecutionResultMessage(
            content=[
                FunctionExecutionResult(
                    call_id="call-1",
                    name="tool",
                    content="result",
                    is_error=False,
                )
            ]
        ),
        UserMessage(content="next request", source="user"),
    ]

    prepared = DrSaiAgent._get_compatible_context(
        FakeClient(ModelFamily.CLAUDE_3_5_SONNET), messages
    )

    assert len(messages) == 2
    assert len(prepared) == 3
    assert isinstance(prepared[1], AssistantMessage)
    assert prepared[1].content == "[Continuing]"
    assert messages[0] is prepared[0]
    assert messages[1] is prepared[2]


def test_non_claude_does_not_receive_continuation_ack() -> None:
    messages = [
        FunctionExecutionResultMessage(
            content=[
                FunctionExecutionResult(
                    call_id="call-1",
                    name="tool",
                    content="result",
                    is_error=False,
                )
            ]
        ),
        UserMessage(content="next request", source="user"),
    ]

    prepared = DrSaiAgent._get_compatible_context(
        FakeClient("openai"), messages
    )

    assert prepared == messages
    assert not any(
        isinstance(message, AssistantMessage) and message.content == "[Continuing]"
        for message in prepared
    )


def test_claude_does_not_insert_ack_inside_tool_result_sequence() -> None:
    messages = [
        FunctionExecutionResultMessage(
            content=[
                FunctionExecutionResult(
                    call_id="call-1",
                    name="tool",
                    content="first",
                    is_error=False,
                )
            ]
        ),
        FunctionExecutionResultMessage(
            content=[
                FunctionExecutionResult(
                    call_id="call-2",
                    name="tool",
                    content="second",
                    is_error=False,
                )
            ]
        ),
    ]

    prepared = DrSaiAgent._get_compatible_context(
        FakeClient(ModelFamily.CLAUDE_3_5_SONNET), messages
    )

    assert prepared == messages


def test_claude_ack_count_is_stable_for_repeated_preparation() -> None:
    messages = [
        UserMessage(content="one", source="user"),
        UserMessage(content="two", source="user"),
        UserMessage(content="three", source="user"),
    ]

    first = DrSaiAgent._get_compatible_context(
        FakeClient(ModelFamily.CLAUDE_3_5_SONNET), messages
    )
    second = DrSaiAgent._get_compatible_context(
        FakeClient(ModelFamily.CLAUDE_3_5_SONNET), messages
    )

    assert len(messages) == 3
    assert len(first) == 5
    assert len(second) == 5
    assert sum(message.content == "[Continuing]" for message in first if isinstance(message, AssistantMessage)) == 2
    assert sum(message.content == "[Continuing]" for message in second if isinstance(message, AssistantMessage)) == 2
