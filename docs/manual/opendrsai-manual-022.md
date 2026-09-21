---
tags: OpenDrSai, 智能体开发实践
---

# OpenDrSai智能体开发实践-智能体前后端的人机交互

这里主要介绍如何OpenDrSai智能体与Dr.Sai UI进行前后端配合，实现前端用户的智能体配置/案例选择、前后文件/log的交互、人在环路的人机任务系统交互。

## 1.前后端配置和案例交互的智能体设计

### 1.1.智能体后端设计

```python
from drsai import CancellationToken
from drsai.modules.baseagent import DrSaiAgent
from drsai.modules.components.model_client import HepAIChatCompletionClient
from drsai.modules.managers.database import DatabaseManager
from drsai.backend import run_worker, DrSaiAPP, run_console
import os, json, sys
import asyncio

# 继承 DrSaiAgent 重写lazy_init函数，模拟智能体进行浏览器、远程工具、远程服务器连接的过程
# 在开发者开发自己的专业智能体时可以考虑将一些基础功能在lazy_init中进行初始化，作为全局参数，如果失败可以直接在on_messages_stream中拒绝执行接下来的任务。
class TestAgent(DrSaiAgent):
    async def lazy_init(self, cancellation_token: CancellationToken|None = None, **kwargs) -> None:
        """Initialize the tools and models needed by the agent."""
        return {"status": True, "content": "Lazy initialization testing....", "metadata": {"test": "test"}}

# 你需要给前端的展示的智能体配置名称和具体配置内容。前端只会展示名称
llm_mode_config = {
    "gpt-4o": "openai/gpt-4o",
    "deepseek-r1": "deepseek-ai/deepseek-r1",
    "深度思考": "deepseek-r1",
    "多模态模式": "gpt-4o",
}

# 将前端传入的配置名称可通过defult_config_name传入智能体启动函数
def create_agent(
        api_key: str|None = None,  # 前端传入的apikey
        thread_id: str|None = None, # 前端传入的session id
        user_id: str|None = None,  # 用户的邮箱
        db_manager: DatabaseManager|None = None, # 数据库
        defult_config_name: str|None = "deepseek-r1",
) -> TestAgent:
    
    # Define a model client. You can use other model client that implements
    # the `ChatCompletionClient` interface.
    model_client = HepAIChatCompletionClient(
        # model="deepseek-ai/deepseek-r1",
        model=llm_mode_config.get(defult_config_name, "openai/gpt-4o"),
        api_key=api_key or os.environ.get("HEPAI_API_KEY"),
        base_url="https://aiapi.ihep.ac.cn/apiv2",
    )

    # Define an AssistantAgent with the model, tool, system message, and reflection enabled.
    # The system message instructs the agent via natural language.
    return TestAgent(
        name="weather_agent",
        model_client=model_client,
        system_message="You are a helpful assistant.",
        reflect_on_tool_use=False,
        model_client_stream=True,  # Enable streaming tokens from the model client.
        thread_id=thread_id,
        db_manager=db_manager,
        user_id=user_id,
    )


if __name__ == "__main__":

    # 命令行测试
    # asyncio.run(run_console(agent_factory=create_agent, task="What is the weather in New York?"))

    #  OpenAI Chat Completion API格式启动，同时支持 OpenWebui Pipeline，并注册到和HepAI 的worker服务，支持人机交互前端调用
    asyncio.run(
        run_worker(
            # 智能体注册的名称
            agent_name="R1_test",
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
            defult_config_name="deepseek-r1",
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

```

### 1.2.Dr.Sai UI展示智能体运行Log和文件信息

- 前端展示的案例内容

![](https://note.ihep.ac.cn/uploads/f3d9c827-6cbe-4c35-b157-d26107bd6540.png)

- 前端展示的案例配置

![](https://note.ihep.ac.cn/uploads/d206e71c-d643-49bf-a94a-f55dab44e490.png)

## 2.前后端文件/log交互的智能体设计

具体见：https://github.com/hepai-lab/drsai/blob/main/examples/agent_groupchat/assistant_custom_log_event-filespy

### 2.1.导入相应的模块

```python
from drsai.modules.managers.messages import ( 
    AgentLogEvent,
    FileInfo,
    FilesContent,
    FilesEvent,
    )
```

### 2.2.向前端传递智能体的运行log

```python
yield AgentLogEvent(
    title="I'm searching the memory.",
    content="Adding the memory to the model context",
    source=self.name,
    content_type = "log",
)
```

前端展示：

![](https://note.ihep.ac.cn/uploads/86f8c25a-2fd0-4339-8d20-6165a857304a.png)

### 2.3.向前端传递智能体产生的文件供前端下载

**请注意，通过base64传递的文件，大小最好不要超过10MB**

```python
# test: yield file list
file_base64, file_obj = get_knowledge_base64_and_url()
## base64 file
base64_file = FileInfo(
    name = "Your_specific_knowledge.md",
    base64_content = file_base64,
    description="test file",
    download_method="base64"
)
## url file
url_file = FileInfo(
    name = "Your_specific_knowledge.md",
    url = file_obj["url"],
    description="test file",
    download_method="url"
)
files=FilesContent(
    files=[base64_file, url_file],
    title="测试文件列表",
    description="包含url下载和base64下载的测试文件列表",
)
yield FilesEvent(
    source=self.name,
    content=files.model_dump(),
)

```

前端展示：

![](https://note.ihep.ac.cn/uploads/922e8386-eb51-49a1-a286-60ed1518e992.png)

## 3.人在环路的人机任务系统交互

- 智能体具体案例见：[assistant_task_interaction.py](https://github.com/hepai-lab/drsai/blob/main/examples/agent_groupchat/assistant_task_interaction.py)
- 文档见：https://note.ihep.ac.cn/s/Pe5yVj68X