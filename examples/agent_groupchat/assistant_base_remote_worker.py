
from drsai.modules.agents import HepAIWorkerAgent
from drsai.modules.components.model_client import HepAIChatCompletionClient
from drsai.backend import run_worker, DrSaiAPP, run_console
import os, json, sys
import asyncio
from hepai import HepAI

async def test_remote_worker_agent():

    client = HepAI(
        api_key=os.getenv("HEPAI_API_KEY"),
        base_url="https://aiapi.ihep.ac.cn/apiv2",
        
    )

    for agent in client.agents.list():
        if agent:
            # print(agent.id)
            # print(agent.metadata)
            if "test" in agent.metadata.get('join_topics', []):
                print(agent.id, agent.description)
# Create a factory function to ensure isolated Agent instances for concurrent access.
def create_agent() -> HepAIWorkerAgent:
    
    client = HepAI(
        api_key=os.getenv("HEPAI_API_KEY"),
        base_url="https://aiapi.ihep.ac.cn/apiv2",
    )
    
    for agent in client.agents.list():
        if agent:
            if "test" in agent.metadata.get('join_topics', []):
                chat_id = "test_123"
                run_info = {}
                api_key = os.getenv("HEPAI_API_KEY")
                url = "https://aiapi.ihep.ac.cn/apiv2"
                name = agent.id
                return HepAIWorkerAgent(
                    name=agent.id,
                    description=agent.description,
                    model_remote_configs={
                        "url": url,
                        "api_key": api_key,
                        "name": name
                    },
                    chat_id=chat_id,
                    run_info=run_info,

                )


if __name__ == "__main__":
    
    # asyncio.run(test_remote_worker_agent())

    # 命令行测试
    asyncio.run(run_console(agent_factory=create_agent, task="What is the weather in New York?"))
    
    #  OpenAI Chat Completion API格式启动，同时支持 OpenWebui Pipeline
    # asyncio.run(run_backend(
    #     agent_factory=create_agent, 
    #     port = 42805, 
    #     enable_openwebui_pipeline=True, 
    #     agnet_name = "R1agent",
    #     history_mode = "backend",
    #     use_api_key_mode = "backend")
    #     )

    #  OpenAI Chat Completion API格式启动，同时支持 OpenWebui Pipeline，并注册到和HepAI 的worker服务，支持人机交互前端调用
    # asyncio.run(
    #     run_worker(
    #         # 智能体注册信息
    #         agent_name="R1_test",
    #         author = "xiongdb@ihep.ac.cn",
    #         permission='groups: drsai, payg; users: admin, xiongdb@ihep.ac.cn, ddf_free, yqsun@ihep.ac.cn; owner: xiongdb@ihep.ac.cn',
    #         description = "DeepSeek_R1 聊天助手.",
    #         version = "0.1.0",
    #         logo="https://aiapi.ihep.ac.cn/apiv2/files/file-8572b27d093f4e15913bebfac3645e20/preview",
    #         # 智能体实体
    #         agent_factory=create_agent, 
    #         # 后端服务配置
    #         port = 42812, 
    #         no_register=False,
    #         enable_openwebui_pipeline=True, 
    #         history_mode = "backend",
    #         # use_api_key_mode = "backend",
    #     )
    # )