from drsai.modules.baseagent import DrSaiAgent, DrSaiUserProxyAgent
from drsai.modules.components.model_client import HepAIChatCompletionClient
from drsai.modules.groupchat import RoundRobinGroupChat, TextMentionTermination
from drsai.backend import run_console
import asyncio, os

# Create a factory function to ensure isolated Agent instances for concurrent access.
def create_team() -> RoundRobinGroupChat:
    # Create the agents.
    model_client = HepAIChatCompletionClient(
        model="deepseek-ai/deepseek-r1:671b",
        api_key=os.environ.get("HEPAI_API_KEY"),
        base_url="https://aiapi.ihep.ac.cn/apiv2",
        # model="openai/gpt-4o",
        # api_key="sk-...", # Optional if you have an HEPAI_API_KEY env variable set.
    )
    assistant = DrSaiAgent("assistant", model_client=model_client)
    user_proxy = DrSaiUserProxyAgent("user_proxy", input_func=input)  # Use input() to get user input from console.

    user_proxy1 = DrSaiUserProxyAgent("user_proxy1", input_func=input)  # Use input() to get user input from console.

    # Create the termination condition which will end the conversation when the user says "APPROVE".
    termination = TextMentionTermination("APPROVE")

    # Create the team.
    return RoundRobinGroupChat([ assistant, user_proxy,], termination_condition=termination)


if __name__ == "__main__":
    asyncio.run(run_console(agent_factory=create_team, task="Write a 4-line poem about the ocean."))
    # asyncio.run(run_backend(
    #     agent_factory=create_agent, 
    #     port = 42805, 
    #     enable_openwebui_pipeline=True, 
    #     history_mode = "backend",
    #     use_api_key_mode = "backend")
    #     )