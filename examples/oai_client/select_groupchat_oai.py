import sys
import os
try:
    import drsai
except ImportError:
    current_file_path = os.path.abspath(__file__)
    current_directory = os.path.dirname(current_file_path)
    drsai_path = os.path.abspath(os.path.join(current_directory, "../../"))
    sys.path.append(drsai_path)

from drsai import AssistantAgent, HepAIChatCompletionClient, DrSaiAPP, DrSaiSelectorGroupChat, TextMentionTermination
import json
import asyncio
from drsai import AssistantAgent, HepAIChatCompletionClient, DrSaiAPP
from drsai import run_backend, run_console

# 创建一个工厂函数，用于并发访问时确保后端使用的Agent实例是隔离的。
def create_team() -> DrSaiSelectorGroupChat:
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
    return DrSaiSelectorGroupChat(
        participants=[primary_agent, critic_agent], 
        termination_condition=text_termination)

async def main():

    drsaiapp = DrSaiAPP(agent_factory=create_team)
    stream =  drsaiapp.a_start_chat_completions(
        messages=[{"content":"Write a short poem about the fall season.", "role":"user"}],
        stream=True,
        chat_id = "22578926-f5e3-48ef-873b-13a8fe7ca3e4",
        )

    async for message in stream:
        oai_json = json.loads(message.split("data: ")[1])
        textchunck = oai_json["choices"][0]["delta"]["content"]
        if textchunck:
            sys.stdout.write(textchunck)
            sys.stdout.flush()


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