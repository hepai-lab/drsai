from drsai.modules.components.model_client import HepAIChatCompletionClient
from drsai.modules.baseagent import DrSaiAgent
from drsai.backend import run_worker, run_console, DrSaiAPP
import os, json, sys
import asyncio
from drsai import tools_reply_function

# For this example, we use a fake weather tool for demonstration purposes.
async def get_weather(city: str) -> str:
    """Get the weather for a given city."""
    return f"The weather in {city} is 73 degrees and Sunny."

# Create a factory function to ensure isolated Agent instances for concurrent access.
def create_agent() -> DrSaiAgent:

    # Define a model client. You can use other model client that implements
    # the `ChatCompletionClient` interface.
    model_client = HepAIChatCompletionClient(
        model="deepseek-ai/deepseek-v3-1",
        api_key=os.environ.get("HEPAI_API_KEY"),
        base_url="https://aiapi.ihep.ac.cn/apiv2",
    )
    # model_client._client.api_key = os.environ.get("HEPAI_API_KEY")

    # Define an AssistantAgent with the model, tool, system message, and reflection enabled.
    # The system message instructs the agent via natural language.
    return DrSaiAgent(
        name="weather_agent",
        model_client=model_client,
        system_message="You are a helpful assistant.",
        reflect_on_tool_use=False,
        model_client_stream=True,  # Must set to True if reply_function returns a generator.
        tools=[get_weather],
        reply_function=tools_reply_function,
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