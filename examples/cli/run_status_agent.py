from drsai_ui.agent_factory.remote_agent import StatusAgent
import os
from drsai import run_backend, run_console, Console
import asyncio

async def create_agent() -> StatusAgent:
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

async def run_status_agent():

    besiii_agent: StatusAgent = await create_agent()
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
    asyncio.run(run_status_agent())
