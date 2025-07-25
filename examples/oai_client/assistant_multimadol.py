from drsai import AssistantAgent, HepAIChatCompletionClient, DrSaiAPP, run_console, run_backend
from drsai.modules.managers.base_thread import Thread
from drsai.modules.managers.threads_manager import ThreadsManager
import os, json
import asyncio
from typing import List, Dict, Union, AsyncGenerator, Tuple, Any

from openai import OpenAI
import base64

from autogen_core import CancellationToken
from autogen_core.tools import BaseTool, FunctionTool, StaticWorkbench, Workbench, ToolResult, TextResultContent, ToolSchema
from autogen_core.models import LLMMessage, ChatCompletionClient
from autogen_agentchat.messages import MultiModalMessage, Image

# async def explain_image(prompt: str, image_path: str, api_key: str = "") -> AsyncGenerator[str, None]:
#     try:
#         # 创建OpenAI客户端实例
#         client = OpenAI(api_key=api_key, base_url="https://aiapi.ihep.ac.cn/apiv2")

#         # 调用Qwen-VL-Max-Latest模型解释图片
#         response = await client.chat.completions.create(
#             model="aliyun/qwen-vl-max-latest",
#             messages=[
#                 {"role": "system", "content": "You are a helpful assistant."},
#                 {
#                     "role": "user",
#                     "content": [
#                         {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{encoded_image}"}},
#                         {"type": "text", "text": prompt}
#                     ]
#                 }
#             ],
#             stream=True
#         )

#         # 流式返回结果
#         async for chunk in response:
#             if chunk.choices and chunk.choices[0].delta.content:
#                 yield chunk.choices[0].delta.content

#     except Exception as e:
#         # 捕获并返回异常信息
#         yield f"图片解释失败: {str(e)}"

# async def interface(
#     oai_messages: List[Dict],  # OAI messages
#     agent_name: str,  # Agent name
#     llm_messages: List[LLMMessage],  # AutoGen LLM messages
#     model_client: HepAIChatCompletionClient,  # AutoGen LLM Model client
#     workbench: Workbench,
#     handoff_tools: List[BaseTool[Any, Any]],
#     tools: Union[ToolSchema, List[BaseTool[Any, Any]]],
#     cancellation_token: CancellationToken,  # AutoGen cancellation token
#     thread: Thread,  # DrSai thread
#     thread_mgr: ThreadsManager,  # DrSai thread manager
#     **kwargs) -> AsyncGenerator:
#     """Address the messages and return the response."""

#     HEPAI_API_KEY = model_client._client.api_key
#     prompt = llm_messages[-1].content
#     image_path = kwargs.get("image_path", "")

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
    import asyncio  # 导入asyncio模块，用于异步编程
    # from autogen_core import Image
    # 运行控制台，启动代理并与用户交互

    image = Image.from_file(file_path="/home/xiongdb/VSproject/drsai/assets/1-2.OpenDrSai_backend.png")
    multimodal_message = MultiModalMessage(
        source="user",
        content=[
            "解释这张图片的内容。",
            image
            
        ]
    )
    asyncio.run(run_console(agent_factory=create_agent, task=multimodal_message))