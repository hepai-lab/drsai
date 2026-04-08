from drsai.modules.baseagent import DrSaiAgent
from drsai.modules.components.model_client import HepAIChatCompletionClient
from drsai.modules.groupchat import AGSelectorGroupChat, TextMentionTermination
from drsai.backend import run_worker, Console, DrSaiAPP

import json, sys
import asyncio


# Create a factory function to ensure isolated Agent instances for concurrent access.
def create_team() -> AGSelectorGroupChat:
    # Create an OpenAI model client.
    model_client = HepAIChatCompletionClient(
        model="openai/gpt-4o",
        # api_key="sk-...", # Optional if you have an HEPAI_API_KEY env variable set.
    )

    # Create the primary agent.
    primary_agent = DrSaiAgent(
        "primary",
        model_client=model_client,
        system_message="You are a helpful AI assistant.",
        model_client_stream=True,
    )

    # Create the critic agent.
    critic_agent = DrSaiAgent(
        "critic",
        model_client=model_client,
        system_message="Provide constructive feedback. Respond with 'APPROVE' to when your feedbacks are addressed.",
        model_client_stream=True,
    )

    # Define a termination condition that stops the task if the critic approves.
    text_termination = TextMentionTermination("APPROVE")

    # Create a team with the primary and critic agents.
    return AGSelectorGroupChat(
        participants=[primary_agent, critic_agent], 
        termination_condition=text_termination,
        model_client = model_client,
        allow_repeated_speaker=True,
        )

async def main():

    drsaiapp = DrSaiAPP(
        agent_factory=create_team,
        use_api_key_mode = "backend", #"frontend"
        )
    stream =  drsaiapp.a_start_chat_completions(
        messages=[{"content":"Write a short poem about the fall season.", "role":"user"}],
        stream=True,
        chat_id = "22578926-f5e3-48ef-873b-13a8fe7ca3e4",
        history_mode = "frontend", #
        agent_name = "primary",
        )

    async for message in stream:
        oai_json = json.loads(message.split("data: ")[1])
        textchunck = oai_json["choices"][0]["delta"]["content"]
        if textchunck:
            sys.stdout.write(textchunck)
            sys.stdout.flush()


if __name__ == "__main__":
    
    asyncio.run(main())
    # asyncio.run(
    #     run_console(
    #         agent_factory=create_team, 
    #         task="-5+20=?"
    #     )
    # )
    
    # asyncio.run(
    #     run_worker(
    #         # 智能体注册信息
    #         agent_name="Selector_GroupChat",
    #         author = "xiongdb@ihep.ac.cn",
    #         permission='groups: drsai, payg, ddf_free; users: admin, xiongdb@ihep.ac.cn, ddf_free, yqsun@ihep.ac.cn; owner: xiongdb@ihep.ac.cn',
    #         description = "一个可智能选择智能体的多智能体系统",
    #         version = "0.1.0",
    #         logo="https://aiapi.ihep.ac.cn/apiv2/files/file-8572b27d093f4e15913bebfac3645e20/preview",
    #         # 智能体实体
    #         agent_factory=create_team, 
    #         # 后端服务配置
    #         port = 42816, 
    #         no_register=False,
    #         enable_openwebui_pipeline=True, 
    #         history_mode = "backend",
    #         # use_api_key_mode = "backend",
    #     )
    # )