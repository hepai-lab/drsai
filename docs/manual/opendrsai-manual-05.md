---
tags: OpenDrSai, 智能体文档
---

# Open Dr.Sai快速开始

## 1.构建并运行一个使用本地函数工具的智能体

### 1.1.构建一个智能体

创建`my_agent.py`，代码如下：

```python
import os, json, sys, asyncio  # 导入基础的包

from drsai.modules.baseagent import DrSaiAgent  #导入智能体框架
from drsai.modules.components.model_client import HepAIChatCompletionClient  #导入大模型管理模块
from drsai.backend import run_worker, run_console  #导入智能体启动服务
from drsai.modules.managers.database import DatabaseManager  #导入智能体的数据库服务

# 构建一个工具函数
def get_weather(city: str) -> str:
    """Get the weather for a given city."""
    return f"The weather in {city} is 73 degrees and Sunny."

# 使用一个函数包裹智能体实例，用于前端访问时保证实例独立
def create_agent(
        thread_id: str = None, 
        user_id: str = None, 
        db_manager: DatabaseManager = None
        ) -> DrSaiAgent:
    
    # 给智能体构建一个大模型组件
    model_client = HepAIChatCompletionClient(
        model="deepseek-ai/deepseek-v3.2", # 模型的名称
        api_key=os.environ.get("HEPAI_API_KEY"), # 模型API的APIKEY
        base_url="https://aiapi.ihep.ac.cn/apiv2"  # 模型API的base url
    )
    
    # 构建智能体实例
    return DrSaiAgent(
        name="weather_agent", # 智能体的名称，必须以python变量的格式定义名称，即只能用：大小写字母、下划线、数字
        model_client=model_client, # 为智能体赋予大模型大脑
        tools=[get_weather],# 为智能体添加工具函数
        system_message="You are a helpful assistant.", # 为智能体添加系统提示词
        tool_call_summary_format = "Calling {tool_name} with {arguments}.\nResult:\n{result}.\n",# 约束工具调用后的输出格式
        thread_id=thread_id,
        db_manager=db_manager,
        user_id=user_id,
    )
    
if __name__ == "__main__":
    asyncio.run(run_console(agent_factory=create_agent, task="What is the weather in New York?"))
    
```

### 1.2.命令行打印的方式运行智能体

```python
asyncio.run(run_console(agent_factory=create_agent, task="What is the weather in New York?"))
```

### 1.3.将构建的智能体作为人机交互的API后端服务

#### 1.3.1.启动API后端服务
```python
asyncio.run(
    run_worker(
        # 智能体注册的名称
        agent_name="weather_agent",
        # 智能体如果注册到HepAI智能体平台需要的权限设置
        permission='groups: drsai; users: admin, xiongdb@ihep.ac.cn, ddf_free, yqsun@ihep.ac.cn; owner: xiongdb@ihep.ac.cn',
        # 智能体给前端展示的描述信息
        description = "一个可以使用城市天气查询工具的助手。",
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
        port = 42810, 
        # 是否注册到HepAI智能体平台
        no_register=False,
        # 是否注册为OpenWebUI的pipeline
        enable_openwebui_pipeline=True, 
        # 使用后端的api_key
        use_api_key_mode = "backend",
    )
)
```
注：请将permission参数中`onwer: xxx`部分改为您的HAI平台用户名（邮箱）

此时你可以通过Dr.Sai UI人机交互前端、任何OpenAI格式的API、OpenWebUI的pipeline获取启动的智能体API后端服务，启动界面也会打印相应的智能体服务地址：

![](https://note.ihep.ac.cn/uploads/c69e594a-be46-465e-b863-023815765677.png)

- Dr.Sai UI人机交互前端、OpenAI格式的API服务地址：`http://xxxx.xx.xx.xx/apiv2`
- OpenWebUI的pipeline地址：`http://xxxx.xx.xx.xx/pipelines`

`xxxx.xx.xx.xx`为你服务器的ip地址。

#### 1.3.2.在前端使用启动的智能体API后端服务

- 1.你可以直接访问 https://drsaiv2.ihep.ac.cn 查看到自己构建智能体，或者通过命令行`drsai ui`启动自己的Dr.Sai UI:

![](https://note.ihep.ac.cn/uploads/f872851e-1807-44a2-ab83-871ba7cb77c4.png)

- 2.如果服务器的ip地址可以公网访问，同时你启动参数设置了`no_register=False`，后端服务端口`port = 42810`防火墙也是开放的，可以通过下图的刷新获取部署的智能体服务:

![](https://note.ihep.ac.cn/uploads/a1b96263-2dfe-41bd-a125-2d6212b75452.png)

- 3.如果本地使用，可以使用下图的连接远程智能体连接到部署的智能体服务:
    - 智能体服务地址：`http://xxxx.xx.xx.xx/apiv2`，`xxxx.xx.xx.xx`为你部署智能体的服务器ip地址。
    - APIKEY：访问智能体大模型的所需要的apikey

![](https://note.ihep.ac.cn/uploads/cd1d220f-b566-467f-97c4-ab2337e4b075.png)

- 4.通过点击使用开始聊天，可以添加到侧边栏方便下次使用:

![](https://note.ihep.ac.cn/uploads/95ac3e7c-7346-40d2-b636-28f2fafcfa14.png)
