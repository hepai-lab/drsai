from drsai_ui.agent_factory.remote_agent import StatusAgent, RemoteAgent
from drsai import Console
import asyncio
import os

async def main():
    api_key = os.environ.get("HEPAI_API_KEY")
    chat_id = "22578926-f5e3-48ef-873b-13a8fe7ca3e4"
    model_name = "hepai/drsai"
    url = "http://0.0.0.0:42806/apiv2/"

    agent = StatusAgent(
        name='besiii',
        chat_id=chat_id,
        run_info={
            "email": "localhost@email.com"
        },
        model_remote_configs={
            "url": url,
            "api_key": api_key,
            "model_name": model_name
        },
    )

    # await agent.lazy_init()

    # 创建一个并行的协程任务，在30s后中止对话
    async def cancel_dialog():
        await asyncio.sleep(10)
        await agent.pause()
    monitor_pause_task = asyncio.create_task(cancel_dialog())

    await Console(
        agent.run_stream(
            task = "帮我测量psi(4260) -> K+ K- [J/psi -> e+ e-]过程在4.26 GeV能量点上的截面，并且绘制Jpsi（ee）的不变质量。先规划后执行。"
            )
            )

if __name__ == '__main__':
    asyncio.run(main())