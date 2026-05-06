from drsai import CancellationToken
from drsai.modules.baseagent import DrSaiAgent
from drsai.modules.components.model_client import HepAIChatCompletionClient, ModelFamily
from drsai.modules.components.model_client.anthropic import (
    HepAIAnthropicChatCompletionClient,
    _MODEL_INFO
)
from drsai.modules.managers.database import DatabaseManager
from drsai.backend import run_worker, DrSaiAPP, run_console
import os, json, sys
import asyncio

class TestAgent(DrSaiAgent):
    async def lazy_init(self, cancellation_token: CancellationToken|None = None, **kwargs) -> None:
        """Initialize the tools and models needed by the agent."""
        return {"status": True, "content": "Lazy initialization testing....", "metadata": {"test": "test"}}

llm_mode_config = {
    "hepai/minimax-m2.7": ("hepai/minimax-m2.7", 204000),
    "hepai/minimax-m2.7-highspeed": ("hepai/minimax-m2.7-highspeed", 204000),
    "minimax-m2.5": ("minimax/minimax-m2.5", 204000),
    "minimax-m2.5-highspeed": ("minimax/minimax-m2.5-highspeed", 204000),
    "minimax-m2.7": ("minimax/minimax-m2.7", 204000),
    "minimax-m2.7-highspeed": ("minimax/minimax-m2.7-highspeed", 204000),
    "claude-sonnet-4-6": ("anthropic/claude-sonnet-4-6", 200000),
    "claude-haiku-4-5": ("anthropic/claude-haiku-4-5", 200000),
    "claude-opus-4-6": ("anthropic/claude-opus-4-6", 200000),
    "gpt-4o": ("openai/gpt-4o", 128000),
    "gpt-4.1": ("openai/gpt-4.1", 1000000),
    "gpt-5.2": ("openai/gpt-5.2", 1000000),
    "gpt-5.4": ("openai/gpt-5.4", 1000000),
    "deepseek-r1(No image)": ("deepseek-ai/deepseek-r1", 128000),
    "deepseek-v3.2(No image)": ("deepseek-ai/deepseek-v3.2", 128000),
}

# Create a factory function to ensure isolated Agent instances for concurrent access.
def create_agent(
        api_key: str|None = None, 
        thread_id: str|None = None, 
        user_id: str|None = None, 
        db_manager: DatabaseManager|None = None,
        defult_config_name: str|None = "hepai/minimax-m2.7-highspeed",
) -> TestAgent:
    
    # Define a model client. You can use other model client that implements
    # the `ChatCompletionClient` interface.
    def set_model_client(defult_config_name: str|None = "hepai/minimax-m2.7-highspeed") -> HepAIAnthropicChatCompletionClient| HepAIChatCompletionClient:
        llm_model, token_limit = llm_mode_config.get(defult_config_name, "hepai/minimax-m2.7-highspeed")
        if ("claude" in llm_model) or ("minimax" in llm_model):
            model_info=_MODEL_INFO["claude-sonnet-4-5"]
            model_info["token_model"] = "claude-3-5-sonnet-20240620"
            model_client = HepAIAnthropicChatCompletionClient(
                model=llm_model,
                base_url="https://aiapi.ihep.ac.cn/apiv2/anthropic",
                api_key=api_key,
                model_info=model_info,
                # temperature=0.5,
                max_tokens=int(token_limit*0.25),
            )
        else:
            is_vision = True
            if "deepseek" in llm_model:
                is_vision = False
            model_client = HepAIChatCompletionClient(
                model=llm_model,
                api_key=api_key,
                base_url="https://aiapi.ihep.ac.cn/apiv2",
                model_info={
                        "vision": is_vision,
                        "function_calling": True,  # You must sure that the model can handle function calling
                        "json_output": True,
                        "structured_output": False,
                        "family": ModelFamily.GPT_41,
                        "multiple_system_messages":True,
                        "token_model": "gpt-4o-2024-11-20", # Default model for token counting
                    }
            )
        
        return model_client

    # Define an AssistantAgent with the model, tool, system message, and reflection enabled.
    # The system message instructs the agent via natural language.
    return TestAgent(
        name="weather_agent",
        model_client=set_model_client(defult_config_name),
        system_message="You are a helpful assistant.",
        reflect_on_tool_use=False,
        model_client_stream=True,  # Enable streaming tokens from the model client.
        thread_id=thread_id,
        db_manager=db_manager,
        user_id=user_id,
        set_model_client=set_model_client,
        llm_mode_config = llm_mode_config,

    )


async def main():

    drsaiapp = DrSaiAPP(agent_factory=create_agent)
    stream =  drsaiapp.a_start_chat_completions(
        messages=[
            {"content":"What is the weather in New York?", "role":"user"},
            {"content":"布吉岛啊？？", "role":"assistant"},
            {"content":"What is the weather in New York?", "role":"user"}],
        stream=True,
        use_api_key_mode = "frontend",  # Use frontend API key mode
        api_key = os.environ.get("HEPAI_API_KEY"),
        chat_id = "test_chat_id",
        )

    async for message in stream:
        oai_json = json.loads(message.split("data: ")[1])
        textchunck = oai_json["choices"][0]["delta"]["content"]
        if textchunck:
            sys.stdout.write(textchunck)
            sys.stdout.flush()
    print()


if __name__ == "__main__":
    # OpenAI Chat Completion接口测试
    # asyncio.run(main())

    # 命令行测试
    # asyncio.run(run_console(agent_factory=create_agent, task="What is the weather in New York?"))
    
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
    asyncio.run(
        run_worker(
            # 智能体注册的名称
            agent_name="weather_agent",
            # 智能体如果注册到HepAI智能体平台需要的权限设置
            permission='groups: drsai; users: admin, xiongdb@ihep.ac.cn, ddf_free, yqsun@ihep.ac.cn; owner: xiongdb@ihep.ac.cn',
            # 智能体给前端展示的描述信息
            description = "一个可以切换基座模型的智能体",
            # 前端的展示的试用案例
            examples=[
                    "What is the weather in New York?",
                    "I want to write a python script to print hello world and run it in a shell. please plan before executing",
                ],
            agent_config = llm_mode_config,
            defult_config_name="hepai/minimax-m2.7-highspeed",
            # 智能体给前端展示的描述信息
            version = "0.1.0",
            # 智能体logo图像的url，使用git源码安装的目前支持png/jpg的logo_path
            logo="https://aiapi.ihep.ac.cn/apiv2/files/file-8572b27d093f4e15913bebfac3645e20/preview",
            # 智能体实体
            agent_factory=create_agent, 
            # 智能体数据库地址
            # engine_uri = "sqlite:////home/xiongdb/drsai_dev/examples/cli/tmp/drsai/drsai.db",
            # # 数据库及文件存储目录
            # base_dir = "/home/xiongdb/drsai_dev/examples/cli/tmp/drsai", 
            # drsai_dir = "/home/xiongdb/drsai_dev/examples/cli/tmp/drsai", 
            # 后端服务端口
            port = 42815, 
            # 是否注册到HepAI智能体平台
            no_register=False,
            # 为了节约资源，是否在前端关闭智能体/页面后后端的智能体实例清除
            close_agent_on_finish=False,
            # 是否注册为OpenWebUI的pipeline
            enable_openwebui_pipeline=True, 
            # 使用backend/frontend的api_key
            use_api_key_mode = "frontend",
            link_wechat = False,
        )
    )