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
from drsai import run_backend, run_console, run_worker
import os, json
import asyncio

# 创建一个工厂函数，用于并发访问时确保后端使用的Agent实例是隔离的。
def create_agent() -> AssistantAgent:
    
    # Define a model client. You can use other model client that implements
    # the `ChatCompletionClient` interface.
    model_client = HepAIChatCompletionClient(
        model="deepseek-ai/deepseek-r1:671b",
        api_key=os.environ.get("HEPAI_API_KEY"),
        base_url="https://aiapi.ihep.ac.cn/apiv2",
        model_info={
                "vision": False,
                "function_calling": False,  # You must sure that the model can handle function calling
                "json_output": False,
                "structured_output": False,
                "family": "r1",
            }
    )

    # Define an AssistantAgent with the model, tool, system message, and reflection enabled.
    # The system message instructs the agent via natural language.
    return AssistantAgent(
        name="weather_agent",
        model_client=model_client,
        system_message="You are a helpful assistant.",
        reflect_on_tool_use=False,
        model_client_stream=True,  # Enable streaming tokens from the model client.
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
    #         agent_name="DeepSeek_R1",
    #         permission='groups: drsai; users: admin, xiongdb@ihep.ac.cn, ddf_free, yqsun@ihep.ac.cn; owner: xiongdb@ihep.ac.cn',
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