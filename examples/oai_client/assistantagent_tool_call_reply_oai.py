import sys
import os
try:
    import drsai
except ImportError:
    current_file_path = os.path.abspath(__file__)
    current_directory = os.path.dirname(current_file_path)
    drsai_path = os.path.abspath(os.path.join(current_directory, "../../"))
    sys.path.append(drsai_path)


from drsai import AssistantAgent, HepAIChatCompletionClient, DrSaiAPP
from drsai import run_console, run_backend
from drsai import StdioServerParams, mcp_server_tools
# 使用tool_reply_function让大模型执行函数，并根据函数结果生成回复。
from drsai import tools_reply_function, tools_recycle_reply_function
import os, json
import asyncio

# 创建一个工厂函数，用于并发访问时确保后端使用的Agent实例是隔离的。
async def create_agent() -> AssistantAgent:
    
    # Define a model client. You can use other model client that implements
    # the `ChatCompletionClient` interface.
    # model_client = HepAIChatCompletionClient(
    #     model="openai/gpt-4o",
    #     api_key=os.environ.get("HEPAI_API_KEY"),
    #     # base_url = "http://192.168.32.148:42601/apiv2"
    # )
    model_client = None


    # Define a simple function tool that the agent can use.
    # For this example, we use a fake weather tool for demonstration purposes.
    tools = []
    tools.extend(await mcp_server_tools(
        StdioServerParams(
            command="conda",
            args=[
                    "run",
                    "-n",
                    "drsai",
                    "--live-stream",
                    "python",
                    "examples/oai_client/MCP_tools/mcp_server.py"
                    ],
            env=None)))
    # async def get_weather(city: str) -> str:
    #     """Get the weather for a given city."""
    #     return f"The weather in {city} is 73 degrees and Sunny."

    # Define an AssistantAgent with the model, tool, system message, and reflection enabled.
    # The system message instructs the agent via natural language.
    return AssistantAgent(
        name="weather_agent",
        model_client=model_client,
        tools=tools,
        system_message="You are a helpful assistant.",
        # reply_function=tools_reply_function,
        reply_function=tools_recycle_reply_function,
        max_turns = 5
    )
    

async def main():

    drsaiapp = DrSaiAPP(agent_factory=create_agent)
    stream =  drsaiapp.a_start_chat_completions(
        messages=[{"content":"What is the weather in New York?", "role":"user"}],
        # chat_id = "22578926-f5e3-48ef-873b-13a8fe7ca3e4",
        stream=True,)

    async for message in stream:
        oai_json = json.loads(message.split("data: ")[1])
        textchunck = oai_json["choices"][0]["delta"]["content"]
        if textchunck:
            sys.stdout.write(textchunck)
            sys.stdout.flush()
    print()


if __name__ == "__main__":
    asyncio.run(main())
    # asyncio.run(run_console(agent_factory=create_agent, task="What is the weather in New York?"))
    # asyncio.run(run_backend(
    #     agent_factory=create_agent, 
    #     port = 42805, 
    #     enable_openwebui_pipeline=True, 
    #     history_mode = "backend",
    #     use_api_key_mode = "backend")
    #     )