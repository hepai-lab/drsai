from hepai import HepAI, HRModel
import os
import json
import requests
import sys
import asyncio
from autogen_agentchat.messages import (
    StructuredMessageFactory,
    BaseChatMessage,
    TextMessage,
    HandoffMessage,
    StopMessage,
    ToolCallSummaryMessage,
    StructuredMessage,
    BaseAgentEvent,
    ToolCallExecutionEvent,
    ToolCallRequestEvent,
    CodeGenerationEvent,
    CodeExecutionEvent,
    UserInputRequestedEvent,
    MemoryQueryEvent,
    ModelClientStreamingChunkEvent,
    ThoughtEvent,
    SelectSpeakerEvent,
    SelectorEvent,
    MessageFactory,
    MultiModalMessage,
    Image,
)
from autogen_core.models import (
    AssistantMessage,
    ChatCompletionClient,
    CreateResult,
    FunctionExecutionResult,
    FunctionExecutionResultMessage,
    LLMMessage,
    ModelFamily,
    SystemMessage,
)

HEPAI_API_KEY = os.getenv("HEPAI_API_KEY")
# base_url = "http://localhost:42801/apiv2"
base_url = "https://aiapi.ihep.ac.cn/apiv2"


def test_autogen_messages():
    textmessage = TextMessage(content="Hello, world!", source="Alice", metadata={"timestamp": "1626713600"})
    textmessage_json = textmessage.model_dump(mode="json") 
    print(textmessage_json)
    textmessage_return = TextMessage.model_validate(textmessage_json)
    print(textmessage_return)


def get_model_list():
  client = HepAI(api_key=HEPAI_API_KEY, base_url=base_url)

  models = client.models.list()
  for idx, model in enumerate(models):
    print(model)

def test_sync_request():
    model = HRModel.connect(
        api_key=HEPAI_API_KEY,
        name="DeepSeek_R1_test",
        base_url="https://aiapi.ihep.ac.cn/apiv2"
    )
    funcs = model.functions  # Get all remote callable functions.
    print(f"Remote callable funcs: {funcs}")

    stream = True
    completion = model.a_chat_completions(
      api_key=HEPAI_API_KEY,
      stream =  stream,
      messages=[
        # {"role": "user", "content": "请使用百度搜索什么是Ptychography?"}
        # {"role": "user", "content": "What is the weather in New York?"},
        TextMessage(content="Hello, world!", source="Alice", metadata={"timestamp": "1626713600"}).model_dump(mode="json")
      ],
      chat_id =  "1234567893",
      user =  {"name": "Alice", "email": "alice@example.com"}
    )
    for chunk in completion:
       print(chunk)

async def test_StatusAgent_request():
    from drsai_ui import StatusAgent
     
    agent = StatusAgent(
          name="RemoteAgent",
          model_remote_configs = {
            "api_key" : HEPAI_API_KEY,
            "url" : base_url,
            "model" : "DeepSeek_R1_test",
          },
          chat_id="1234567893",
          run_info={"name": "Alice", "email": "alice@example.com"},
          )
    
    await agent.lazy_init()
    
    async for event in agent.run_stream(task = "Hello, world!"):
        # print(event)
        if isinstance(event, TextMessage):
           print(event)

   
if __name__ == '__main__':
    # test_autogen_messages()
    # get_model_list()
    # get_model_list()
    # asyncio.run(test_async_request())
    # test_sync_request()
    asyncio.run(test_StatusAgent_request())
