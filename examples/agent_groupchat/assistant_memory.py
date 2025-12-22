from drsai.modules.components.model_client import HepAIChatCompletionClient, ModelFamily
from drsai.modules.components.memory import ListMemory, MemoryContent, MemoryMimeType, RAGFlowMemory
from drsai.modules.components.model_context import (
    BufferedChatCompletionContext,
    UnboundedChatCompletionContext,
    HeadAndTailChatCompletionContext,
    TokenLimitedChatCompletionContext,
    )
from drsai.modules.baseagent import DrSaiAgent
from drsai import run_backend, run_console, run_worker
import os, json, sys
import asyncio
from dotenv import load_dotenv
load_dotenv()

RAGFLOW_URL = os.getenv('RAGFLOW_URL')
RAGFLOW_TOKEN = os.getenv('RAGFLOW_TOKEN')


# Create a factory function to ensure isolated Agent instances for concurrent access.
async def create_agent() -> DrSaiAgent:

    # Create model client
    model_client = HepAIChatCompletionClient(
        model="deepseek-ai/deepseek-v3-1",
        base_url="https://aiapi.ihep.ac.cn/apiv2",
        api_key=os.getenv('HEPAI_API_KEY'),
        model_info={
                "vision": False,
                "function_calling": True,  # You must sure that the model can handle function calling
                "json_output": True,
                "structured_output": False,
                "family": ModelFamily.GPT_41,
                "multiple_system_messages":True,
                "token_model": "gpt-4o-2024-11-20", # Default model for token counting
            },)

    # Create a RAGFlow memory for your specific knowledge
    # ragflow_memory = RAGFlowMemory(
    #     RAGFlowMemoryConfig(
    #         RAGFLOW_URL=RAGFLOW_URL,
    #         RAGFLOW_TOKEN=RAGFLOW_TOKEN,
    #         dataset_ids=["28e3ad8499b311f0a65d0242ac120006"],
    #         keyword=True,
    #     )
    # )

    # Create a memory for your specific konwledge
    with open("examples/agent_groupchat/Your_specific_konwledge.md", "r") as f:
        Your_specific_konwledge = f.read()
    list_momery = ListMemory(name = "list_memory")
    await list_momery.add(
        content=MemoryContent(
            content=Your_specific_konwledge,
            mime_type=MemoryMimeType.TEXT,
        )
        )

    # Create model context
    model_context = TokenLimitedChatCompletionContext(
        model_client=model_client,
        token_limit=100000,
    )

    # Create assistant agent with the model client and memory
    assistant_agent = DrSaiAgent(
        name="assistant_agent",
        system_message="""你是一个问答助手，需要根据检索到的记忆内容进行回复。""",
        description="一个问答助手",
        model_client=model_client,
        model_client_stream=True,
        memory=[list_momery],
        model_context=model_context
    )

    return assistant_agent

if __name__ == "__main__":
    
    # asyncio.run(
    #     run_console(
    #         agent_factory=create_agent, 
    #         task="什么是OpenDrSai"
    #     )
    # )

    asyncio.run(
        run_worker(
            # 智能体注册信息
            agent_name="Your_Assistant",
            author = "xiongdb@ihep.ac.cn",
            permission='groups: drsai, payg, ddf_free; users: admin, xiongdb@ihep.ac.cn, ddf_free, yqsun@ihep.ac.cn; owner: xiongdb@ihep.ac.cn',
            description = "一个问答助手",
            version = "0.1.0",
            logo="https://aiapi.ihep.ac.cn/apiv2/files/file-8572b27d093f4e15913bebfac3645e20/preview",
            # 智能体实体
            agent_factory=create_agent, 
            # 后端服务配置
            port = 42816, 
            no_register=False,
            enable_openwebui_pipeline=True, 
            history_mode = "backend",
            # use_api_key_mode = "backend",
        )
    )