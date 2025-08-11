from drsai import AssistantAgent, HepAIChatCompletionClient, DrSaiAPP,TextMentionTermination,SelectorGroupChat, run_console, run_worker,Console
from drsai.modules.managers.base_thread import Thread
from drsai.modules.managers.threads_manager import ThreadsManager
import os, json
import asyncio
from typing import List, Dict, Union, AsyncGenerator, Tuple, Any

from openai import OpenAI
import base64

from autogen_core import CancellationToken
from autogen_core.tools import  (
    BaseTool, 
    FunctionTool, 
    StaticWorkbench, 
    Workbench, 
    ToolResult, 
    TextResultContent, 
    ToolSchema)
from autogen_core.models import (
    LLMMessage,
    ChatCompletionClient,
)
from autogen_agentchat.messages import MultiModalMessage, Image
from autogen_core import Image
import uuid

here = os.path.dirname(os.path.abspath(__file__))

def update_image(
        client: OpenAI,
        file_bytes: bytes,
) -> str:

    file_obj = client.files.create(
        file=file_bytes,
        purpose="user_data"
        )
    return file_obj.id

async def async_generate_image(
        prompt: str, 
        n: int=1,
        api_key: str = ""
    ) -> AsyncGenerator[str, None]:
    try:
        # yield "正在初始化图片生成客户端...\n\n"
        # await asyncio.sleep(0.1)

        client = OpenAI(
            api_key=api_key,
            base_url="https://aiapi.ihep.ac.cn/apiv2",
        )
        yield "已连接图片生成服务，正在生成图片...\n\n"
        await asyncio.sleep(0.1)

        img = client.images.generate(
            model='openai/gpt-image-1',
            prompt=prompt,
            n=n,
        )
        yield "图片已生成，正在解码和保存...\n\n"
        await asyncio.sleep(0.1)

        image_bytes = base64.b64decode(img.data[0].b64_json)
        file_id = update_image(client, image_bytes)
        image_url = f"https://aiapi.ihep.ac.cn/apiv2/files/{file_id}/preview"
        yield f"图片已保存，预览地址：{image_url}\n\n"
        file_name = f"output_{uuid.uuid4().hex}.png"
        # yield f"![{file_name}]({image_url}) \n\n"
        # yield f"![{file_name}]({image_url}?width=480&height=320) \n\n"
        yield f'<img src="{image_url}" width="180">'

        
        # with open(f"{here}/files/{file_name}", "wb") as f:
        #     f.write(image_bytes)

    except Exception as e:
        yield f"图片生成失败:{str(e)}"

async def interface( 
    agent: AssistantAgent,  # DrSai assistant agent
    oai_messages: List[str],  # OAI messages
    agent_name: str,  # Agent name
    llm_messages: List[LLMMessage],  # AutoGen LLM messages
    model_client: ChatCompletionClient,  # AutoGen LLM Model client
    workbench: Workbench,
    handoff_tools: List[BaseTool[Any, Any]],
    tools: Union[ToolSchema, List[BaseTool[Any, Any]]],
    cancellation_token: CancellationToken,  # AutoGen cancellation token,
    thread: Thread,  # DrSai thread
    thread_mgr: ThreadsManager,  # DrSai thread manager
    **kwargs) -> Union[str, AsyncGenerator[str, None]]:
    """Address the messages and return the response."""

    HEPAI_API_KEY = model_client._client.api_key
    prompt = llm_messages[-1].content
    image_path = kwargs.get("image_path", "")
    async for progress in async_generate_image(prompt, api_key=HEPAI_API_KEY):
        yield progress



async def planning_agent() -> AssistantAgent:
    
    # Define a model client. You can use other model client that implements
    # the `ChatCompletionClient` interface.
    model_client = HepAIChatCompletionClient(
        model="openai/gpt-4.1",
        api_key=os.environ.get("HEPAI_API_KEY"),
        base_url="https://aiapi.ihep.ac.cn/apiv2",
    )
    return AssistantAgent(
        name="PlanningAgent",
        model_client=model_client,
        description="An agent that generates images based on user prompts.",
       system_message="""
        You are a planning agent.
        Your job is to break down complex tasks into smaller, manageable subtasks.
        Your team members are:
        ImageCreator:An agent that generates images based on user prompts.
        ImageExplainier: An agent that explains images based on user prompts.

        You only plan and delegate tasks - you do not execute them yourself.

         When assigning tasks, use this format:
        1. <agent> : <task>

        After all tasks are complete, summarize the findings and end with "TERMINATE".
        """,
        reply_function=None,
    )

# 创建一个工厂函数，用于并发访问时确保后端使用的Agent实例是隔离的。
async def create_ImageCreatoragent() -> AssistantAgent:
    
    # Define a model client. You can use other model client that implements
    # the `ChatCompletionClient` interface.
    model_client = HepAIChatCompletionClient(
        model="openai/gpt-image-1",
        api_key=os.environ.get("HEPAI_API_KEY"),
        base_url="https://aiapi.ihep.ac.cn/apiv2",
    )

    # Define an AssistantAgent with the model, tool, system message, and reflection enabled.
    # The system message instructs the agent via natural language.
    return AssistantAgent(
        name="ImageCreator",
        model_client=model_client,
        description="An agent that generates images based on user prompts.",
        system_message="You are used for generating the images specified by the users.",
        reply_function=interface,
    )

async def create_ImageExplainieragent() -> AssistantAgent:
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

text_termination = TextMentionTermination("TERMINATE")


async def main():
    # 实例化所有 agent
    planner = await planning_agent()
    image_creator = await create_ImageCreatoragent()
    image_explainer = await create_ImageExplainieragent()

    # 创建团队
    team = SelectorGroupChat(
        participants=[planner, image_creator, image_explainer],
        termination_condition=text_termination,
        model_client=HepAIChatCompletionClient(
            model="openai/gpt-4.1",
            api_key=os.environ.get("HEPAI_API_KEY"),
            base_url="https://aiapi.ihep.ac.cn/apiv2",
        )
    )

    # 示例调用
    # await Console(team.run_stream(task=multimodal_message))

if __name__ == "__main__":
    import asyncio  # 导入asyncio模块，用于异步编程
    # from autogen_core import Image
    # 运行控制台，启动代理并与用户交互
    # image = Image.from_file(file_path="/mnt/e/kelongku/drsai/output.png")
    # multimodal_message = MultiModalMessage(
    #     source="user",
    #     content=[
    #         "解释这张图片的内容。",
    #         image
            
    #     ]
    # )
    # asyncio.run(main())

    # asyncio.run(
    #     run_worker(
    #         agent_name="drsai/ImageExplainier",
    #         agent_factory=create_agent, 
    #         port = 42806, 
    #         no_register=False,
    #         enable_openwebui_pipeline=True, 
    #         history_mode = "backend",
    #         use_api_key_mode = "backend",
    #     )
    # )

    asyncio.run(
        run_worker(
            # 智能体注册信息
            agent_name="ImageGenerator",
            # permission='groups: payg; users: admin, xiongdb@ihep.ac.cn, ddf_free, yqsun@ihep.ac.cn; owner: 11192333767@qq.com',
            permission={
                "groups": "payg", 
                "users": ["admin", "ddf_free", "xiongdb@ihep.ac.cn", "yqsun@ihep.ac.cn"], 
                "owner": "11192333767@qq.com"
                },
            description = "An agent that generates images based on user prompts.",
            version = "0.1.0",
            logo="https://aiapi.ihep.ac.cn/apiv2/files/file-8572b27d093f4e15913bebfac3645e20/preview",
            # 智能体实体
            agent_factory=create_ImageCreatoragent, 
            # 后端服务配置
            port = 42813, 
            no_register=False,
            enable_openwebui_pipeline=True, 
            history_mode = "backend",
            # use_api_key_mode = "backend",
        )
    )