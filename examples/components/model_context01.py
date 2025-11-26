from drsai.modules.components.model_context import DrSaiChatCompletionContext
from drsai.modules.components.model_client import HepAIChatCompletionClient
from autogen_core.models import  (
    CreateResult,
    SystemMessage,
    UserMessage,
    AssistantMessage,
    ModelFamily,
)
from autogen_core.tools import (
    FunctionTool,
    ToolSchema,
)
import asyncio
import os
async def test_long_memory():


    async def get_weather(city: str) -> str:
        """Get the weather for a given city."""
        return f"The weather in {city} is 73 degrees and Sunny."
    
    tool = FunctionTool(func=get_weather, description=get_weather.__doc__)

    async_client = HepAIChatCompletionClient(
        # model="openai/gpt-4.1",
        model="deepseek-ai/deepseek-v3-1",
        api_key=os.environ.get("HEPAI_API_KEY"),
        base_url="https://aiapi.ihep.ac.cn/apiv2",
        model_info={
                "vision": True,
                "function_calling": True,  # You must sure that the model can handle function calling
                "json_output": True,
                "structured_output": True,
                "family": ModelFamily.GPT_41,
                "multiple_system_messages":True,
                "token_model": "gpt-4o-2024-11-20", # Default model for token counting
            },
        )
    
    with open("examples/agent_groupchat/Your_specific_konwledge.md", "r") as f:
        Your_specific_konwledge = f.read()

    llm_messages = [
        SystemMessage(content="You are a helpful assistant."),
        UserMessage(content="What is the weather today?", source="user"),
        AssistantMessage(content="The weather is sunny today.", source="assistant"),
        UserMessage(content=f"There some memory knowledge: \n {Your_specific_konwledge}", source="user"),
        UserMessage(content="What is the opendrsai?", source="user"),
    ]

    """
    A context that limits the number of tokens using LLM and store memory using RAGFlow.
    Note:
        - This ChatCompletionContext keeps the first two SystemMessage and the last two UserMessage.
    """
    
    long_memory_context = DrSaiChatCompletionContext(
        agent_name = "assistant",
        model_client = async_client,
        token_limit = 3000,
        tool_schema = [tool.schema]
    )

    for message in llm_messages:
        await long_memory_context.add_message(message=message)

    compressed_messages = await long_memory_context.get_messages()

    print(compressed_messages)


if __name__ == "__main__":
    asyncio.run(test_long_memory())




