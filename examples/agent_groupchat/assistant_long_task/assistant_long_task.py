
from drsai.modules.components.model_client import HepAIChatCompletionClient, ModelFamily
from drsai.modules.components.tool import (
    mcp_server_tools,
    SseServerParams
)
from drsai.modules.baseagent import DrSaiAgent
from drsai.backend import run_worker, run_console, DrSaiAPP
import os, json, sys
import asyncio
# Create a factory function to ensure isolated Agent instances for concurrent access.
async def create_agent() -> DrSaiAgent:

    # Create model client
    model_client = HepAIChatCompletionClient(
        model="deepseek-ai/deepseek-v3.2",
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

    tools = await mcp_server_tools(SseServerParams(
        url="http://0.0.0.0:42609/sse",
        env=None))

    # Create assistant agent with the model client and memory
    assistant_agent = DrSaiAgent(
        name="Web_agent",
        system_message="""你是一个可以进行web检索的智能体""",
        description="一个web检索助手",
        model_client=model_client,
        tool_call_summary_prompt= "1.如果任务在执行过程中，请使用表格的形式展示输出的状态；2.如果任务已经结束，请根据用户要求进行总结。",
        model_client_stream=True,
        tools=tools,
    )

    return assistant_agent

if __name__ == "__main__":
    
    # 命令行测试
    # asyncio.run(run_console(agent_factory=create_agent, task="跟我检索什么是OpenDrSai"))
    
    asyncio.run(
        run_worker(
            # 智能体注册的名称
            agent_name="Web_agent",
            # 智能体如果注册到HepAI智能体平台需要的权限设置
            permission='groups: drsai; users: admin, xiongdb@ihep.ac.cn, ddf_free, yqsun@ihep.ac.cn; owner: xiongdb@ihep.ac.cn',
            # 智能体给前端展示的描述信息
            description = "一个可以切换基座模型的智能体",
            # 前端的展示的试用案例
            examples=[
                    "跟我检索什么是OpenDrSai？",
                    "查询任务ID：0f247f59-d2b7-4e26-bfdd-dcb627f8c53d的执行进度",
                ],
            # agent_config = llm_mode_config,
            # defult_config_name="deepseek-r1",
            # 智能体给前端展示的描述信息
            version = "0.1.0",
            # 智能体logo图像的url，使用git源码安装的目前支持png/jpg的logo_path
            logo="https://aiapi.ihep.ac.cn/apiv2/files/file-8572b27d093f4e15913bebfac3645e20/preview",
            # 智能体实体
            agent_factory=create_agent, 
            # 后端服务端口
            port = 42810, 
            # 是否注册到HepAI智能体平台
            no_register=False,
            # 是否注册为OpenWebUI的pipeline
            enable_openwebui_pipeline=True, 
            # 使用backend/frontend的api_key
            use_api_key_mode = "frontend",
        )
    )