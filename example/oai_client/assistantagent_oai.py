try:
    import drsai
except ImportError:
    import sys
    sys.path.append("../../drsai")

from drsai import AssistantAgent, HepAIChatCompletionClient, DrSaiAPP, run_hepai_worker, run_backend
import os, json
import asyncio

# Define a model client. You can use other model client that implements
# the `ChatCompletionClient` interface.
model_client = HepAIChatCompletionClient(
    model="openai/gpt-4o",
    # api_key=os.environ.get("HEPAI_API_KEY"),
)


# Define a simple function tool that the agent can use.
# For this example, we use a fake weather tool for demonstration purposes.
async def get_weather(city: str) -> str:
    """Get the weather for a given city."""
    return f"The weather in {city} is 73 degrees and Sunny."


# Define an AssistantAgent with the model, tool, system message, and reflection enabled.
# The system message instructs the agent via natural language.
agent = AssistantAgent(
    name="weather_agent",
    model_client=model_client,
    tools=[get_weather],
    system_message="You are a helpful assistant.",
    reflect_on_tool_use=False,
    model_client_stream=True,  # Enable streaming tokens from the model client.
)


async def main():

    drsaiapp = DrSaiAPP(agent=agent)
    stream =  drsaiapp.a_start_chat_completions(
        messages=[{"content":"What is the weather in New York?", "role":"user"}],
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
    # from drsai import run_console, run_backend, run_hepai_worker
    # asyncio.run(run_console(team, "What is the weather in New York?"))
    # asyncio.run(run_backend(agent=agent))
    # asyncio.run(run_hepai_worker(agent=agent))