import sys
import os
try:
    import drsai
except ImportError:
    current_file_path = os.path.abspath(__file__)
    current_directory = os.path.dirname(current_file_path)
    drsai_path = os.path.abspath(os.path.join(current_directory, "../../"))
    sys.path.append(drsai_path)

from drsai import AssistantAgent, HepAIChatCompletionClient, DrSaiAPP, run_hepai_worker, run_backend
import os, json
import asyncio
from typing import List, Dict, Union, Generator

# Define a model client. You can use other model client that implements
# the `ChatCompletionClient` interface.
model_client = HepAIChatCompletionClient(
    model="openai/gpt-4o",
    # api_key=os.environ.get("HEPAI_API_KEY"),
)

# # Set to True if the model client supports streaming. !!!! This is important for reply_function to work.
model_client_stream = False  

# Address the messages and return the response. Must accept messages and return a string, or a generator of strings.
async def interface(messages: List[Dict], **kwargs) -> Union[str, Generator[str, None, None]]:
    """Address the messages and return the response."""
    return "test_worker reply"


# Define an AssistantAgent with the model, tool, system message, and reflection enabled.
# The system message instructs the agent via natural language.
agent = AssistantAgent(
    name="weather_agent",
    model_client=model_client,
    reply_function=interface,
    system_message="You are a helpful assistant.",
    reflect_on_tool_use=False,
    model_client_stream=model_client_stream,  # Must set to True if reply_function returns a generator.
)


async def main():

    drsaiapp = DrSaiAPP(agent=agent)
    stream =  drsaiapp.a_start_chat_completions(messages=[{"content":"Why will humans be destroyed", "role":"user"}])

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
    asyncio.run(main())
    # from drsai import run_console, run_backend, run_hepai_worker
    # asyncio.run(run_console(team, "Why will humans be destroyed"))
    # asyncio.run(run_backend(agent=agent))
    # asyncio.run(run_hepai_worker(agent=agent))