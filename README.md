# OpenDrSai 

由高能物理研究所Dr.Sai团队开发的智能体与多智能体协同系统快速开发框架，可快速地开发和部署自己的智能体与多智能体协作系统后端服务。

<div align="center">
  <p>
      <img width="80%" src="assets/drsai.png" alt="适配逻辑图">
  </p>
</div>

## 1.特色

- 1.可基于[HepAI平台](https://ai.ihep.ac.cn/)进行智能体基座模型的灵活切换。
- 2.为智能体设计了感知、思考、记忆、执行等行为功能，并进行了插件化设计，可灵活扩展，满足多种应用场景。
- 3.为智能体和多智能体协作系统交互提供了兼容OpenAI Chat和OpenAI ASSISTANTS(**正在开发**)的标准后端接口，可与兼容OpenAI输出的前端进行无缝对接，从而可将智能体和多智能体协作系统作为模型或智能体服务进行部署。

## 2.快速开始

### 2.1.安装OpenDrSai

#### pip 安装

```shell
conda create -n drsai python=>3.11
conda activate drsai
pip install drsai -U
```

#### 从源码安装和配置OpenDrSai运行环境

创建[code.ihep.ac.cn](https://code.ihep.ac.cn/)账号，克隆OpenDrSai仓库到本地：
```shell
git clone https://code.ihep.ac.cn/hepai/drsai.git drsai
cd drsai
```

配置conda环境，安装依赖包：
```shell
conda create -n drsai python>=3.11
conda activate drsai
pip install -e .  # 以开发者模式安装，任何仓库内的修改会直接生效 ，无需重新安装。
```

#### 配置HepAI平台的API访问密钥

配置[HepAI](https://ai.ihep.ac.cn)DDF2平台的API访问密钥等环境变量(Based on bash)：

linux/mac平台:
```shell
vi ~/.bashrc
export HEPAI_API_KEY=your_api_key
source ~/.bashrc
```
windows平台：
```shell
setx "HEPAI_API_KEY" "your_api_key"
# 注意 windows环境变量需要重启电脑才会生效
```

### 2.2.创建一个可以使用函数作为工具的简单智能体

```python
from drsai import AssistantAgent, HepAIChatCompletionClient
import os
import asyncio

# 创建一个工厂函数，用于并发访问时确保后端使用的Agent实例是隔离的。
def create_agent() -> AssistantAgent:
    
    # Define a model client. You can use other model client that implements
    # the `ChatCompletionClient` interface.
    model_client = HepAIChatCompletionClient(
        model="openai/gpt-4o",
        api_key=os.environ.get("HEPAI_API_KEY"),
        # base_url = "http://192.168.32.148:42601/apiv2"
    )

    # Define a simple function tool that the agent can use.
    # For this example, we use a fake weather tool for demonstration purposes.
    async def get_weather(city: str) -> str:
        """Get the weather for a given city."""
        return f"The weather in {city} is 73 degrees and Sunny."

    # Define an AssistantAgent with the model, tool, system message, and reflection enabled.
    # The system message instructs the agent via natural language.
    return AssistantAgent(
        name="weather_agent",
        model_client=model_client,
        tools=[get_weather],
        system_message="You are a helpful assistant.",
        reflect_on_tool_use=False,
        model_client_stream=True,  # Enable streaming tokens from the model client.
    )

from drsai import run_console
asyncio.run(run_console(agent_factory=create_agent, task="What is the weather in New York?"))
```

## 3.自定义智能体开发案例

### 3.1.使用简单的RAG函数作为智能体的记忆层

```python
from drsai import AssistantAgent, HepAIChatCompletionClient
import os
import asyncio
from typing import List, Dict, Union

# 创建一个工厂函数，用于并发访问时确保后端使用的Agent实例是隔离的。
def create_agent() -> AssistantAgent:

    # Define a model client. You can use other model client that implements
    # the `ChatCompletionClient` interface.
    model_client = HepAIChatCompletionClient(
        model="openai/gpt-4o",
        # api_key=os.environ.get("HEPAI_API_KEY"),
    )

    # Define a simple rag-demo for the assistant.
    async def rag_demo(messages: List[Dict], **kwargs):
        query = messages[-1]["content"]  # Select the last message of the chat history as the RAG query statement.
        retrieve_txt = "1. Humans will be destroyed by AI in 2050;\n2. Humans are destroyed by AI due to their arrogance and conceit."
        last_txt = f"""The following are some reference materials, and you must refer to these materials to answer the question:\n{retrieve_txt}. My question is: {query}"""
        messages[-1]["content"] = last_txt
        return messages

    # Define an AssistantAgent with the model, tool, system message, and reflection enabled.
    # The system message instructs the agent via natural language.
    return AssistantAgent(
        name="weather_agent",
        model_client=model_client,
        memory_function=rag_demo,
        system_message="You are a helpful assistant.",
        reflect_on_tool_use=False,
        model_client_stream=True,  # Enable streaming tokens from the model client.
    )

from drsai import run_console
asyncio.run(run_console(agent_factory=create_agent, task="Why will humans be destroyed"))
```

### 3.2.自定义智能体的回复逻辑

```python

from drsai import AssistantAgent, HepAIChatCompletionClient
import os
import asyncio
from autogen_core import CancellationToken
from autogen_core.tools import BaseTool
from autogen_core.models import (
    LLMMessage,
    ChatCompletionClient,
)
from typing import List, Dict, Any, Union, AsyncGenerator

# 创建一个工厂函数，用于并发访问时确保后端使用的Agent实例是隔离的。
def create_agent() -> AssistantAgent:

    # Define a model client. You can use other model client that implements
    # the `ChatCompletionClient` interface.
    model_client = HepAIChatCompletionClient(
        model="openai/gpt-4o",
        # api_key=os.environ.get("HEPAI_API_KEY"),
    )

    # Address the messages and return the response. Must accept messages and return a string, or a generator of strings.
    async def interface(
        oai_messages: List[str],  # OAI messages
        agent_name: str,  # Agent name
        llm_messages: List[LLMMessage],  # AutoGen LLM messages
        model_client: ChatCompletionClient,  # AutoGen LLM Model client
        tools: List[BaseTool[Any, Any]],  # AutoGen tools
        cancellation_token: CancellationToken,  # AutoGen cancellation token,
        **kwargs) -> Union[str, AsyncGenerator[str, None]]:
        """Address the messages and return the response."""
        yield "test_worker reply"


    # Define an AssistantAgent with the model, tool, system message, and reflection enabled.
    # The system message instructs the agent via natural language.
    return AssistantAgent(
        name="weather_agent",
        model_client=model_client,
        reply_function=interface,
        system_message="You are a helpful assistant.",
        reflect_on_tool_use=False
    )

from drsai import run_console
asyncio.run(run_console(agent_factory=create_agent, task="Why will humans be destroyed"))
```

## 4.将OpenDrSai部署为OpenAI格式的后端模型服务或者HepAI woker服务

### 4.1.部署为OpenAI格式的后端模型服务/HepAI worker服务
```python
from drsai import run_backend, run_hepai_worker
import asyncio
asyncio.run(run_backend(agent_factory=create_agent)) # 部署为OpenAI格式的后端模型服务
# asyncio.run(run_hepai_worker(agent_factory=create_agent)) # 部署为HepAI worker服务
```
后端默认启动在```http://localhost:42801/apiv2```, 通过```port```参数可自定义端口

### 4.2.使用HepAI client访问的方式访问定制好的智能体

```python
from hepai import HepAI 
import os
import json
import requests
import sys

HEPAI_API_KEY = os.getenv("HEPAI_API_KEY")
base_url = "http://localhost:42801/apiv2"


# 调用HepAI client接口
client = HepAI(api_key=HEPAI_API_KEY, base_url=base_url)
completion = client.chat.completions.create(
  model='hepai/Dr-Sai',
  messages=[
    {"role": "user", "content": "What is the weather in New York?"}
  ],
  stream=True
)
for chunk in completion:
  if chunk.choices[0].delta.content:
    print(chunk.choices[0].delta.content, end='', flush=True)
print('\n')
```

## 5.OpenWebUI Pipeline接入

### 5.1.启动包含OpenWebUI Pipeline的OpenDrSai服务

```python
asyncio.run(run_backend(agent_factory=create_agent, enable_openwebui_pipeline=True))
```

后端默认启动在```http://localhost:42801/apiv2```, 通过```port```参数可自定义端口；OpenWebUI Pipeline默认启动在```http://localhost:42801/pipelines```

### 5.2.安装OpenWebUI

```shell
pip install open-webui
```

在命令行中运行：```open-webui serve --port 8088```启动OpenWebUI服务。

### 5.3.配置OpenWebUI Pipeline

pipeline的密钥在```drsai/backend/pipelines/config.py```中，默认为：```0p3n-w3bu!```，将密钥和pipeline后端服务的地址：```http://localhost:42801/pipelines```加入OpenWebUI的```管理员面板-设置-外部连接-管理OpenAI API连接```中。

### 5.4.自定义Pipeline

将OpenDrSai项目中的```drsai/backend/owebui_pipeline/pipelines/pipelines/drsai_pipeline.py```复制到在自定义文件夹下，进行自定义修改，设置环境变量```PIPELINES_DIR```，让OpenWebUI Pipeline加载自定义的pipeline文件。

## 6.详细文档
见docs目录：
```shell
开发中
```

## 7.联系我们

- 邮箱：hepai@ihep.ac.cn/xiongdb@ihep.ac.cn
- 微信：xiongdongbo_12138