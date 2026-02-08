
from drsai.modules.agents import RemoteAgent
from drsai.backend import run_worker, run_console
import asyncio


# Create a factory function to ensure isolated Agent instances for concurrent access.
def create_agent() -> RemoteAgent:
    
    token = "xxx"
    # Define an AssistantAgent with the model, tool, system message, and reflection enabled.
    # The system message instructs the agent via natural language.
    return RemoteAgent(
        name="openclaw_agent",
        system_message="You are a helpful assistant.",
        model_client_stream=True,  # Enable streaming tokens from the model client.
        model_remote_configs = {
            "model": "openclaw",
            "url": "http://127.0.0.1:18789/v1/chat/completions",
            "headers": {
                        "Authorization": f"Bearer {token}",
                        "Content-Type": "application/json",
                        "x-openclaw-agent-id": "main"
                    }
        },
    )


if __name__ == "__main__":

    # 命令行测试
    # asyncio.run(run_console(agent_factory=create_agent, task="What is the weather in New York?"))

    #  OpenAI Chat Completion API格式启动，同时支持 OpenWebui Pipeline，并注册到和HepAI 的worker服务，支持人机交互前端调用
    asyncio.run(
        run_worker(
            # 智能体注册的名称
            agent_name="openclaw_agent",
            # 智能体如果注册到HepAI智能体平台需要的权限设置
            permission='groups: drsai; users: admin, xiongdb@ihep.ac.cn, ddf_free, yqsun@ihep.ac.cn; owner: xiongdb@ihep.ac.cn',
            author="xiongdb@ihep.ac.cn",
            # 智能体给前端展示的描述信息
            description = "我的openclaw_agent",
            # 前端的展示的试用案例
            examples=[
                    "What is the weather in New York?",
                    "I want to write a python script to print hello world and run it in a shell. please plan before executing",
                ],
            # 智能体给前端展示的描述信息
            version = "0.1.0",
            # 智能体logo图像的url，使用git源码安装的目前支持png/jpg的logo_path
            logo="https://aiapi.ihep.ac.cn/apiv2/files/file-8572b27d093f4e15913bebfac3645e20/preview",
            # 智能体实体
            agent_factory=create_agent, 
            # 后端服务端口
            port = 42850, 
            # 是否注册到HepAI智能体平台
            no_register=False,
            # 是否注册为OpenWebUI的pipeline
            enable_openwebui_pipeline=True, 
            # 使用backend/frontend的api_key
            use_api_key_mode = "frontend",
        )
    )