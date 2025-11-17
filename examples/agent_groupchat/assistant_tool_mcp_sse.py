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
from autogen_core.models import ModelFamily
from drsai import RAGFlowMemory, RAGFlowMemoryConfig
from autogen_core.memory import ListMemory, MemoryContent, MemoryMimeType
from autogen_core.model_context import (
    BufferedChatCompletionContext,)
from autogen_ext.tools.mcp import SseServerParams,mcp_server_tools
from drsai import run_backend, run_console, run_worker
import asyncio

# Create a factory function to ensure isolated Agent instances for concurrent access.
async def create_agent() -> AssistantAgent:

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
            },)

    tools = await mcp_server_tools(SseServerParams(
        url="http://0.0.0.0:42608/sse",
        env=None))

    # Create assistant agent with the model client and memory
    assistant_agent = AssistantAgent(
        name="assistant_agent",
        system_message="""你是一个可以使用简单计算器进行加法计算的助手。""",
        description="一个简单计算器助手",
        model_client=model_client,
        model_client_stream=True,
        tools=tools,
    )

    return assistant_agent

if __name__ == "__main__":
    
    asyncio.run(
        run_console(
            agent_factory=create_agent, 
            task="-5+20=?"
        )
    )

    # asyncio.run(
    #     run_worker(
    #         # 智能体注册信息
    #         agent_name="Calculate_Assistant",
    #         author = "xiongdb@ihep.ac.cn",
    #         permission='groups: drsai, payg, ddf_free; users: admin, xiongdb@ihep.ac.cn, ddf_free, yqsun@ihep.ac.cn; owner: xiongdb@ihep.ac.cn',
    #         description = "一个简单计算器助手",
    #         version = "0.1.0",
    #         logo="https://aiapi.ihep.ac.cn/apiv2/files/file-8572b27d093f4e15913bebfac3645e20/preview",
    #         # 智能体实体
    #         agent_factory=create_agent, 
    #         # 后端服务配置
    #         port = 42816, 
    #         no_register=False,
    #         enable_openwebui_pipeline=True, 
    #         history_mode = "backend",
    #         # use_api_key_mode = "backend",
    #     )
    # )