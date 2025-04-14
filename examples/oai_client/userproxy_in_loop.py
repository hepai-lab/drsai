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
from drsai import RoundRobinGroupChat, DrSaiRoundRobinGroupChat
from drsai import Console
import asyncio

# 创建一个工厂函数，用于并发访问时确保后端使用的Agent实例是隔离的。
def create_team() -> DrSaiRoundRobinGroupChat:
    # Create the agents.
    model_client = HepAIChatCompletionClient(
        model="deepseek-r1-250120",
        api_key=os.environ.get("VOLCES_API_KEY"),
        base_url=os.environ.get("VOLCES_BASE_URL"),
        # model="openai/gpt-4o",
        # api_key="sk-...", # Optional if you have an HEPAI_API_KEY env variable set.
    )
    assistant = AssistantAgent("assistant", model_client=model_client)
    user_proxy = UserProxyAgent("user_proxy", input_func=input)  # Use input() to get user input from console.

    user_proxy1 = UserProxyAgent("user_proxy1", input_func=input)  # Use input() to get user input from console.

    # Create the termination condition which will end the conversation when the user says "APPROVE".
    termination = TextMentionTermination("APPROVE")

    # Create the team.
    return DrSaiRoundRobinGroupChat([ assistant, user_proxy,], termination_condition=termination)


if __name__ == "__main__":
    from drsai import run_console, run_backend, run_hepai_worker
    asyncio.run(run_console(agent_factory=create_team, task="Write a 4-line poem about the ocean."))
    # asyncio.run(run_backend(agent_factory=create_team))
    # asyncio.run(run_hepai_worker(agent_factory=create_team))
    # asyncio.run(run_backend(agent_factory=create_team, enable_openwebui_pipeline=True))