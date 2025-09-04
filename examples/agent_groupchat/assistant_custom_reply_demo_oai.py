import sys
import os
try:
    import drsai
except ImportError:
    current_file_path = os.path.abspath(__file__)
    current_directory = os.path.dirname(current_file_path)
    drsai_path = os.path.abspath(os.path.join(current_directory, "../../"))
    sys.path.append(drsai_path)

from drsai import AssistantAgent, HepAIChatCompletionClient, DrSaiAPP, run_console, run_backend
from drsai.modules.managers.database import DatabaseManager
import os, json
import asyncio
from typing import List, Dict, Union, AsyncGenerator, Tuple, Any


from autogen_core import CancellationToken
from autogen_core.tools import  (
    BaseTool, 
    FunctionTool, 
    StaticWorkbench, 
    Workbench, 
    ToolResult, 
    TextResultContent, 
    ToolSchema)
from autogen_core.models import (
    LLMMessage,
    ChatCompletionClient,
)

# 创建一个工厂函数，用于并发访问时确保后端使用的Agent实例是隔离的。
def create_agent() -> AssistantAgent:

    # Define a model client. You can use other model client that implements
    # the `ChatCompletionClient` interface.
    model_client = HepAIChatCompletionClient(
        model="deepseek-ai/deepseek-r1:671b",
        api_key=os.environ.get("HEPAI_API_KEY"),
        base_url="https://aiapi.ihep.ac.cn/apiv2",
    )
    # model_client._client.api_key = os.environ.get("HEPAI_API_KEY")
    # Address the messages and return the response. Must accept messages and return a string, or a generator of strings.
    async def interface( 
        agent: AssistantAgent,  # DrSai assistant agent
        oai_messages: List[str],  # OAI messages
        agent_name: str,  # Agent name
        llm_messages: List[LLMMessage],  # AutoGen LLM messages
        model_client: ChatCompletionClient,  # AutoGen LLM Model client
        workbench: Workbench,
        handoff_tools: List[BaseTool[Any, Any]],
        tools: Union[ToolSchema, List[BaseTool[Any, Any]]],
        cancellation_token: CancellationToken,  # AutoGen cancellation token,
        db_manager: DatabaseManager,  # DrSai database manager,
        **kwargs) -> Union[str, AsyncGenerator[str, None]]:
        """Address the messages and return the response."""
        yield "test_worker reply"


    # Define an AssistantAgent with the model, tool, system message, and reflection enabled.
    # The system message instructs the agent via natural language.
    return AssistantAgent(
        name="weather_agent",
        model_client=model_client,
        reply_function=interface,
        system_message="You are a helpful assistant.",
        reflect_on_tool_use=False,
        model_client_stream=True,  # Must set to True if reply_function returns a generator.
    )


async def main():

    drsaiapp = DrSaiAPP(agent_factory=create_agent)

    # agent_info = await drsaiapp.get_agents_info()
    # print(agent_info)

    stream =  drsaiapp.a_start_chat_completions(
        messages=[{"content":"Why will humans be destroyed", "role":"user"}],
        # chat_id = "22578926-f5e3-48ef-873b-13a8fe7ca3e4",
        use_api_key_mode = "frontend",  # Use frontend API key mode
        api_key = os.environ.get("HEPAI_API_KEY"),
        )
    model_client_stream = create_agent()._model_client_stream
    async for message in stream:
        oai_json = json.loads(message.split("data: ")[1])
        if model_client_stream:
            textchunck = oai_json["choices"][0]["delta"]["content"]
        else:
            textchunck = oai_json["choices"][0]["message"]["content"]
        if textchunck:
            sys.stdout.write(textchunck)
            sys.stdout.flush()
    print()


if __name__ == "__main__":
    # asyncio.run(main())
    asyncio.run(run_console(agent_factory=create_agent, task="What is the weather in New York?"))
    # asyncio.run(run_backend(
    #     agent_factory=create_agent, 
    #     port = 42805, 
    #     enable_openwebui_pipeline=True, 
    #     history_mode = "backend",
    #     use_api_key_mode = "backend")
    #     )