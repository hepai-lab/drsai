try:
    import drsai
except ImportError:
    import sys
    import os
    current_file_path = os.path.abspath(__file__)
    current_directory = os.path.dirname(current_file_path)
    drsai_path = os.path.abspath(os.path.join(current_directory, "../../"))
    sys.path.append(drsai_path)


from drsai import AssistantAgent, HepAIChatCompletionClient

import asyncio
from autogen_agentchat.conditions import ExternalTermination, TextMentionTermination
from autogen_agentchat.teams import RoundRobinGroupChat, SelectorGroupChat
from drsai import AssistantAgent, HepAIChatCompletionClient, DrSaiAPP
import os, json
import asyncio

# Create an OpenAI model client.
model_client = HepAIChatCompletionClient(
    model="openai/gpt-4o",
    # api_key="sk-...", # Optional if you have an HEPAI_API_KEY env variable set.
)

# Create the primary agent.
primary_agent = AssistantAgent(
    "primary",
    model_client=model_client,
    system_message="You are a helpful AI assistant.",
    model_client_stream=True,
)

# Create the critic agent.
critic_agent = AssistantAgent(
    "critic",
    model_client=model_client,
    system_message="Provide constructive feedback. Respond with 'APPROVE' to when your feedbacks are addressed.",
    model_client_stream=True,
)

# Define a termination condition that stops the task if the critic approves.
text_termination = TextMentionTermination("APPROVE")

# Create a team with the primary and critic agents.
team = RoundRobinGroupChat([primary_agent, critic_agent], termination_condition=text_termination)

async def main():

    drsaiapp = DrSaiAPP(agent=team)
    stream =  drsaiapp.a_start_chat_completions(
        messages=[{"content":"Write a short poem about the fall season.", "role":"user"}],
        stream=True,
        )

    async for message in stream:
        oai_json = json.loads(message.split("data: ")[1])
        textchunck = oai_json["choices"][0]["delta"]["content"]
        if textchunck:
            sys.stdout.write(textchunck)
            sys.stdout.flush()


if __name__ == "__main__":
    asyncio.run(main())
    # from drsai import run_console, run_backend, run_hepai_worker
    # asyncio.run(run_console(team, "Write a short poem about the fall season."))
    # asyncio.run(run_backend(agent=agent))
    # asyncio.run(run_hepai_worker(agent=agent))