import sys
import os
try:
    import drsai
except ImportError:
    current_file_path = os.path.abspath(__file__)
    current_directory = os.path.dirname(current_file_path)
    drsai_path = os.path.abspath(os.path.join(current_directory, "../../"))
    sys.path.append(drsai_path)


from drsai import AssistantAgent, HepAIChatCompletionClient, DrSaiAPP
from drsai import RAGFlowMemory, RAGFlowMemoryConfig
from autogen_core.model_context import (
    BufferedChatCompletionContext,)
from drsai import run_backend, run_console, run_worker
import os, json
import asyncio
from dotenv import load_dotenv
load_dotenv()

RAGFLOW_URL = os.getenv('RAGFLOW_URL')
RAGFLOW_TOKEN = os.getenv('RAGFLOW_TOKEN')


# 创建一个工厂函数，用于并发访问时确保后端使用的Agent实例是隔离的。
async def create_agent() -> AssistantAgent:

    model_client = HepAIChatCompletionClient(
        model="deepseek-ai/deepseek-v3-1",
    )

    ragflow_memory = RAGFlowMemory(
        RAGFlowMemoryConfig(
            RAGFLOW_URL=RAGFLOW_URL,
            RAGFLOW_TOKEN=RAGFLOW_TOKEN,
            dataset_ids=["28e3ad8499b311f0a65d0242ac120006"],
            keyword=True,
        )
    )

    # Create assistant agent with ChromaDB memory
    assistant_agent = AssistantAgent(
        name="assistant_agent",
        system_message="""你是一个高能物理BESIII实验分析软件BOSS8的问答助手， 你需要根据查询到记忆回答用户的相关问题，你的要求如下：
1. 严格按照查询的到的记忆进行回复，禁止自己编造相关内容；
2. 当未查询到相关内容，或者查询的内容与用户的不相关时，请回复“未查询到相关内容，具体内容参见：https://code.ihep.ac.cn/mrli/boss_docs/-/releases”；
""",
        description="一个高能物理BESIII实验分析软件BOSS8的一个问答助手",
        model_client=model_client,
        model_client_stream=True,
        memory=[ragflow_memory],
        model_context=BufferedChatCompletionContext(buffer_size = 20) # 限制最多20条消息
    )

    return assistant_agent

if __name__ == "__main__":
    # ragflow = RAGFlowMemory(
    #     RAGFlowMemoryConfig(
    #         RAGFLOW_URL=RAGFLOW_URL,
    #         RAGFLOW_TOKEN=RAGFLOW_TOKEN,
    #         dataset_ids=["28e3ad8499b311f0a65d0242ac120006"],
    #     )
    # )

    # asyncio.run(ragflow.query(
    #     query = "BOSS8 使用的C++版本"
    # ))

    # asyncio.run(
    #     run_console(
    #         agent_factory=create_agent, 
    #         task="BOSS8 使用的C++版本"
    #     )
    # )

    asyncio.run(
        run_worker(
            # 智能体注册信息
            agent_name="BOSS8_Assistant",
            author = "xiongdb@ihep.ac.cn",
            permission='groups: drsai, payg; users: admin, xiongdb@ihep.ac.cn, ddf_free, yqsun@ihep.ac.cn; owner: xiongdb@ihep.ac.cn',
            description = "一个高能物理BESIII实验分析软件BOSS8的一个问答助手",
            version = "0.1.0",
            logo="https://aiapi.ihep.ac.cn/apiv2/files/file-8572b27d093f4e15913bebfac3645e20/preview",
            # 智能体实体
            agent_factory=create_agent, 
            # 后端服务配置
            port = 42816, 
            no_register=False,
            enable_openwebui_pipeline=True, 
            pipelines_dir="/home/xiongdb/drsai/examples/agent_groupchat/assistant_ragflow/pipelines/",
            history_mode = "backend",
            # use_api_key_mode = "backend",
        )
    )