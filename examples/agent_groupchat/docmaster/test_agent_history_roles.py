import asyncio

from autogen_agentchat.messages import TextMessage
from autogen_core.model_context import UnboundedChatCompletionContext
from autogen_core.models import AssistantMessage, UserMessage

from agent import DocMasterAgent


def test_desktop_history_roles_are_preserved():
    async def exercise():
        context = UnboundedChatCompletionContext()

        await DocMasterAgent._add_messages_to_context(
            context,
            [
                TextMessage(content="question", source="user"),
                TextMessage(content="answer", source="assistant"),
                TextMessage(content="follow-up", source="user"),
            ],
        )

        return await context.get_messages()

    messages = asyncio.run(exercise())
    assert [type(message) for message in messages] == [
        UserMessage,
        AssistantMessage,
        UserMessage,
    ]
