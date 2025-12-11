
from drsai.modules.components.model_client import HepAIChatCompletionClient
from drsai.modules.baseagent import DrSaiAgent
from drsai.backend import run_worker, run_console, DrSaiAPP
import os, json, sys
import asyncio


# Create a factory function to ensure isolated Agent instances for concurrent access.
def create_agent() -> DrSaiAgent:
    
    # Define a model client. You can use other model client that implements
    # the `ChatCompletionClient` interface.
    model_client = HepAIChatCompletionClient(
        # model="openai/gpt-4.1",
        model="deepseek-ai/deepseek-v3",
        api_key=os.environ.get("HEPAI_API_KEY"),
        # base_url = "http://192.168.32.148:42601/apiv2"
    )
    # model_client = None


    # Define a simple function tool that the agent can use.
    # For this example, we use a fake weather tool for demonstration purposes.
    async def get_weather(city: str) -> str:
        """Get the weather for a given city."""
        return f"The weather in {city} is 73 degrees and Sunny."

    # Define an AssistantAgent with the model, tool, system message, and reflection enabled.
    # The system message instructs the agent via natural language.
    return DrSaiAgent(
        name="weather_agent",
        model_client=model_client,
        tools=[get_weather],
        system_message="You are a helpful assistant.",
        tool_call_summary_format = "Calling {tool_name} with {arguments}.\nResult:\n{result}.\n",
        reflect_on_tool_use=False, # Only supported by OpenAI model or other model that supports tool use and strucutred output.
        output_content_type=None,
        model_client_stream=True,  # Enable streaming tokens from the model client.
    )


async def main():

    drsaiapp = DrSaiAPP(agent_factory=create_agent)
    stream =  drsaiapp.a_start_chat_completions(
        messages=[{"content":"What is the weather in New York?", "role":"user"}],
        # chat_id = "22578926-f5e3-48ef-873b-13a8fe7ca3e4",
        stream=True,
        use_api_key_mode = "frontend",  # Use frontend API key mode
        api_key = os.environ.get("HEPAI_API_KEY"),
        )

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