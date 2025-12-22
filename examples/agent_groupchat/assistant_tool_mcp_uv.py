

from drsai.modules.components.tool import web_fetch
from drsai import AssistantAgent, HepAIChatCompletionClient, DrSaiAPP
from drsai import run_backend, run_console
import os, json
import sys
import asyncio

web_fetch_tool = asyncio.run(web_fetch())

# Create a factory function to ensure isolated Agent instances for concurrent access.
async def create_agent() -> AssistantAgent:
    
    # Define a model client. You can use other model client that implements
    # the `ChatCompletionClient` interface.
    # model_client = HepAIChatCompletionClient(
    #     model="openai/gpt-4o",
    #     api_key=os.environ.get("HEPAI_API_KEY"),
    #     # base_url = "http://192.168.32.148:42601/apiv2"
    # )

    # Define an AssistantAgent with the model, tool, system message, and reflection enabled.
    # The system message instructs the agent via natural language.
    return AssistantAgent(
        name="weather_agent",
        tools=[web_fetch_tool],
        system_message="You are a helpful assistant.",
        reflect_on_tool_use=False,
        model_client_stream=True,  # Enable streaming tokens from the model client.
    )


async def main():

    drsaiapp = DrSaiAPP(agent_factory=create_agent)
    stream =  drsaiapp.a_start_chat_completions(
        messages=[{"content":"请跟我总结什么是：https://www.aivi.fyi/aiagents/mcpo-and-OpenWebUI-tutorial#%E4%BB%80%E4%B9%88%E6%98%AF-mcpo?", "role":"user"}],
        # chat_id = "22578926-f5e3-48ef-873b-13a8fe7ca3e4",
        stream=True,
        use_api_key_mode = "frontend",  # Use frontend API key mode
        api_key = os.environ.get("HEPAI_API_KEY"),)

    async for message in stream:
        oai_json = json.loads(message.split("data: ")[1])
        textchunck = oai_json["choices"][0]["delta"]["content"]
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