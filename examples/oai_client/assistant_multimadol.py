from drsai import AssistantAgent, HepAIChatCompletionClient, DrSaiAPP, run_console, run_backend, run_worker
from drsai.modules.managers.base_thread import Thread
from drsai.modules.managers.threads_manager import ThreadsManager
import os, json
import asyncio
from typing import List, Dict, Union, AsyncGenerator, Tuple, Any

from openai import OpenAI
import base64

from autogen_core import CancellationToken
from autogen_core.tools import (
    BaseTool, 
    FunctionTool, 
    StaticWorkbench, 
    Workbench, 
    ToolResult, 
    TextResultContent, 
    ToolSchema)
from autogen_core.models import (
    LLMMessage, 
    CreateResult,
)

from autogen_agentchat.messages import (
    MultiModalMessage, 
    Image,
    ModelClientStreamingChunkEvent,
    )

async def explain_image(oai_messages: List[Dict], api_key: str = "") -> AsyncGenerator[str, None]:
    try:
        # 创建OpenAI客户端实例
        client = OpenAI(api_key=api_key, base_url="https://aiapi.ihep.ac.cn/apiv2")

        # 调用Qwen-VL-Max-Latest模型解释图片
        response = await client.chat.completions.create(
            model="aliyun/qwen-vl-max-latest",
            messages=oai_messages,
            stream=True
        )

        # 流式返回结果
        async for chunk in response:
            if chunk.choices and chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content

    except Exception as e:
        # 捕获并返回异常信息
        yield f"图片解释失败: {str(e)}"

async def interface(
    oai_messages: List[Dict],  # OAI messages
    agent_name: str,  # Agent name
    llm_messages: List[LLMMessage],  # AutoGen LLM messages
    model_client: HepAIChatCompletionClient,  # AutoGen LLM Model client
    workbench: Workbench,
    handoff_tools: List[BaseTool[Any, Any]],
    tools: Union[ToolSchema, List[BaseTool[Any, Any]]],
    cancellation_token: CancellationToken,  # AutoGen cancellation token
    thread: Thread,  # DrSai thread
    thread_mgr: ThreadsManager,  # DrSai thread manager
    **kwargs)  -> AsyncGenerator[Union[CreateResult, ModelClientStreamingChunkEvent], None]:
    """Address the messages and return the response."""

    # HEPAI_API_KEY = model_client._client.api_key

    # 
    
    


async def create_agent() -> AssistantAgent:
    # 创建模型客户端实例
    model_client = HepAIChatCompletionClient(
        model="aliyun/qwen-vl-max-latest",
        api_key=os.environ.get("HEPAI_API_KEY"),
        base_url="https://aiapi.ihep.ac.cn/apiv2",
    )
    # 创建AssistantAgent实例并返回
    return AssistantAgent(
        name="ImageExplainier",
        model_client=model_client,
        description="An agent that explains images based on user prompts.",
        system_message="You are used for explaining images specified by the users.",
        reflect_on_tool_use=False,
        model_client_stream=True  # 启用流式响应
    )

if __name__ == "__main__":
    
    # from autogen_core import Image
    # 运行控制台，启动代理并与用户交互

    # image = Image.from_file(file_path="/home/xiongdb/VSproject/drsai/assets/1-2.OpenDrSai_backend.png")
    # multimodal_message = MultiModalMessage(
    #     source="user",
    #     content=[
    #         "解释这张图片的内容。",
    #         image
            
    #     ]
    # )
    # asyncio.run(run_console(agent_factory=create_agent, task=multimodal_message))

    asyncio.run(
        run_worker(
            # 智能体注册信息
            agent_name="ImageExplainier",
            permission='groups: drsai; users: admin, xiongdb@ihep.ac.cn, ddf_free, yqsun@ihep.ac.cn; owner: xiongdb@ihep.ac.cn',
            description = "以qwen-vl-max-latest为基座模型的图像解释智能体。",
            version = "0.1.0",
            logo="https://aiapi.ihep.ac.cn/apiv2/files/file-8572b27d093f4e15913bebfac3645e20/preview",
            # 智能体实体
            agent_factory=create_agent, 
            # 后端服务配置
            port = 42810, 
            no_register=False,
            enable_openwebui_pipeline=True, 
            history_mode = "backend",
            # use_api_key_mode = "backend",
        )
    )