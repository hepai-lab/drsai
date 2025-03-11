import sys
import os
try:
    import drsai
except ImportError:
    current_file_path = os.path.abspath(__file__)
    current_directory = os.path.dirname(current_file_path)
    drsai_path = os.path.abspath(os.path.join(current_directory, "../../"))
    sys.path.append(drsai_path)


from drsai import HepAIChatCompletionClient
from drsai import AssistantAgent, UserProxyAgent
from drsai import TextMentionTermination
from drsai import RoundRobinGroupChat
from drsai import Console
import asyncio

# Create the agents.
model_client = HepAIChatCompletionClient(model="openai/gpt-4o-mini")
assistant = AssistantAgent("assistant", model_client=model_client)
user_proxy = UserProxyAgent("user_proxy", input_func=input)  # Use input() to get user input from console.

user_proxy1 = UserProxyAgent("user_proxy1", input_func=input)  # Use input() to get user input from console.

# Create the termination condition which will end the conversation when the user says "APPROVE".
termination = TextMentionTermination("APPROVE")

# Create the team.
team = RoundRobinGroupChat([ assistant, user_proxy,], termination_condition=termination)


if __name__ == "__main__":
    asyncio.run(Console(team.run_stream(task="Write a 4-line poem about the ocean.")))
    # from drsai import run_console, run_backend, run_hepai_worker
    # asyncio.run(run_console(team, "Write a short poem about the fall season."))
    # asyncio.run(run_backend(agent=agent))
    # asyncio.run(run_hepai_worker(agent=agent))