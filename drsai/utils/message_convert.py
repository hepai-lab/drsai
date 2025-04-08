
from typing import (
    List,
    Dict, 
    )

from autogen_core.models import (
    FunctionExecutionResultMessage,
    LLMMessage,
    UserMessage,
    AssistantMessage,
    SystemMessage,
)

async def llm_messages2oai_messages(llm_messages: List[LLMMessage]) -> List[Dict[str, str]]:
    """Convert a list of LLM messages to a list of OAI chat messages."""
    messages = []
    for llm_message in llm_messages:
        if isinstance(llm_message, SystemMessage):
            messages.append({"role": "system", "content": llm_message.content} )
        if isinstance(llm_message, UserMessage):
            messages.append({"role": "user", "content": llm_message.content, "name": llm_message.source})
        if isinstance(llm_message, AssistantMessage):
            messages.append({"role": "assistant", "content": llm_message.content, "name": llm_message.source})
        if isinstance(llm_message, FunctionExecutionResultMessage):
            messages.append({"role": "function", "content": llm_message.content})
    return messages
