from drsai import HepAIChatCompletionClient
import asyncio
import os, sys
from autogen_core import (
    CancellationToken,
    Component,
)
from autogen_core.models import  (
    ChatCompletionTokenLogprob,
    CreateResult,
    LLMMessage,
    ModelFamily,
    RequestUsage,
    TopLogprob,
    ModelInfo,
    SystemMessage,
    UserMessage,
    AssistantMessage,
)

async def main():
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
            },
        temperature=0.5,
        )
    
    # mutiple coversation
    llm_messages = [
        SystemMessage(content="You are a helpful assistant."),
        UserMessage(content="What is the weather today?", source="user"),
        AssistantMessage(content="The weather is sunny today.", source="assistant"),
        UserMessage(content="What is the time?", source="user"),
    ]
    cancellation_token = CancellationToken()
    async for chunk in async_client.create_stream(
        llm_messages,
        cancellation_token = cancellation_token,
        ):
        if isinstance(chunk, str):
            sys.stdout.write(chunk)
            sys.stdout.flush()
        elif isinstance(chunk, CreateResult):
            print()
            print(chunk.model_dump())
        else:
            print("Unknown chunk type:", type(chunk))

if __name__ == "__main__":
    asyncio.run(main())
