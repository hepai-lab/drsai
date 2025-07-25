from drsai_ui.agent_factory.remote_agent import StatusAgent
from drsai.modules.baseagent import DrSaiAgent
from drsai.modules.groupchat import RoundRobinGroupChat
from drsai import  HepAIChatCompletionClient, TextMentionTermination
import os
from drsai import run_backend, run_console, Console, run_worker
import asyncio

async def create_remote_agent() -> StatusAgent:
    besiii = StatusAgent(
        name='besiii',
        chat_id='8f19aa1e-df12-4a4f-bed0-b4525371b9d73',
        run_info={
            "email": "localhost@email.com"
        },
        model_remote_configs={
            "url": "http://202.122.37.163:42887/apiv2/chat/completions",
            "api_key": os.getenv("HEPAI_API_KEY")
        },
    )
    return besiii

async def create_team() -> RoundRobinGroupChat:
    # Create an OpenAI model client.
    model_client = HepAIChatCompletionClient(
        # model="deepseek-ai/deepseek-r1:671b",
        # api_key=os.environ.get("HEPAI_API_KEY"),
        # base_url="https://aiapi.ihep.ac.cn/apiv2",
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
    return RoundRobinGroupChat(
        participants=[primary_agent, critic_agent], 
        termination_condition=text_termination)

async def run_status_agent():

    # besiii_agent: StatusAgent = await create_remote_agent()
    besiii_agent: RoundRobinGroupChat = await create_team()
    await besiii_agent.lazy_init()

    # 创建一个并行的协程任务，在30s后中止对话
    async def cancel_dialog():
        await asyncio.sleep(10)
        # await besiii_agent.close()
        await besiii_agent.pause()
    monitor_pause_task = asyncio.create_task(cancel_dialog())

    await Console(besiii_agent.run_stream(task = "帮我测量psi(4260) -> K+ K- [J/psi -> e+ e-]过程在4.26 GeV能量点上的截面，并且绘制Jpsi（ee）的不变质量。先规划后执行。"))
    # await besiii_agent.close()

if __name__ == '__main__':
    # run_console(agent_factory=create_agent, task='status')
    # asyncio.run(run_status_agent())
    asyncio.run(
        run_worker(
            agent_factory=create_team, 
            port = 42805, 
            no_register=False,
            enable_openwebui_pipeline=True, 
            history_mode = "backend",
            use_api_key_mode = "backend",
        )
    )
