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

### 2.1.安装DrSai

#### pip 安装

```shell
conda create -n drsai python=>3.11
conda activate drsai
pip install drsai -U
```

#### 从源码安装和配置DrSai运行环境

创建[code.ihep.ac.cn](https://code.ihep.ac.cn/)账号，克隆OpenDrSai仓库到本地：
```shell
git clone https://code.ihep.ac.cn/hepai/drsai.git drsai
cd drsai
```

配置conda环境，安装依赖包：
```shell
conda create -n drsai python>=3.11
conda activate drsai
pip install .
```

#### 配置HepAI平台的API访问密钥

配置[HepAI](https://ai.ihep.ac.cn)DDF2平台的API访问密钥等环境变量(Based on bash)：
```shell
vi ~/.bashrc
export HEPAI_API_KEY=your_api_key
source ~/.bashrc
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
from typing import List, Dict, Union, Generator

# 创建一个工厂函数，用于并发访问时确保后端使用的Agent实例是隔离的。
def create_agent() -> AssistantAgent:

    # Define a model client. You can use other model client that implements
    # the `ChatCompletionClient` interface.
    model_client = HepAIChatCompletionClient(
        model="openai/gpt-4o",
        # api_key=os.environ.get("HEPAI_API_KEY"),
    )

    # # Set to True if the model client supports streaming. !!!! This is important for reply_function to work.
    model_client_stream = False  

    # Address the messages and return the response. Must accept messages and return a string, or a generator of strings.
    async def interface(messages: List[Dict], **kwargs) -> Union[str, AsyncGenerator[str, None, None]]:
        """Address the messages and return the response."""
        return "test_worker reply"


    # Define an AssistantAgent with the model, tool, system message, and reflection enabled.
    # The system message instructs the agent via natural language.
    return AssistantAgent(
        name="weather_agent",
        model_client=model_client,
        reply_function=interface,
        system_message="You are a helpful assistant.",
        reflect_on_tool_use=False,
        model_client_stream=model_client_stream,  # Must set to True if reply_function returns a generator.
    )

from drsai import run_console
asyncio.run(run_console(agent_factory=create_agent, task="Why will humans be destroyed"))
```

## 4.将DrSai部署为OpenAI格式的后端模型服务或者HepAI woker服务

### 4.1.部署为OpenAI格式的后端模型服务/HepAI worker服务
```python
from DrSai import run_backend, run_hepai_worker
import asyncio
asyncio.run(run_backend(agent_factory=create_agent)) # 部署为OpenAI格式的后端模型服务
# asyncio.run(run_hepai_worker(agent_factory=create_agent)) # 部署为HepAI worker服务
```

### 4.2.使用HepAI client访问的方式访问定制好的智能体

```python
from hepai import HepAI 
import os
import json
import requests
import sys

HEPAI_API_KEY = os.getenv("HEPAI_API_KEY2")
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

### 5.1.基于pm2进程管理的一键启动配置

- 1. python环境中安装openwebui：

```shell
pip install open-webui
```

- 2. 克隆DrSai仓库到本地:

适配DrSai的OpenWebUI Pipeline的相对路径在：```drsai/backend/pipelines```，在启动时需要使用绝对路径:```pipelines_path = your_path_to_drsai/backend/pipelines```


- 3.检查本地是否安装了```pm2```后台任务管理工具：

```shell
pm2 -v
```
具体见：https://pm2.io/docs/plus/quick-start/

- 4.一键启动DrSai的OpenWebUI Pipeline和OpenWebUI服务：

```python
from DrSai import run_drsai_app
import asyncio
asyncio.run(run_drsai_app(agent_factory=create_agent, pipelines_path=pipelines_path))
```

openwebui服务默认启动在```http://localhost:8088```, 通过```openwebui_port```参数可自定义端口;

drsai的pipeline服务默认启动在```http://localhost:9097```，通过```pipelines_port```参数可自定义端口;

drsai后端服务默认启动在```http://localhost:42801/apiv2```, 通过```port```参数可自定义端口;

- 5.将pipeline的密钥加入OpenWebUI：

pipeline的密钥在```drsai/backend/pipelines/config.py```中，默认为：```0p3n-w3bu!```，将密钥和pipeline后端服务的地址：```http://localhost:9097```加入OpenWebUI的```管理员面板-设置-外部连接-管理OpenAI API连接```中。

### 5.2.不需pm2进程管理的后台启动方式

- 1. 启动OpenWebUI服务：

python环境中安装openwebui

```shell
pip install open-webui
```
在命令行中运行：```open-webui serve --port 8088```启动OpenWebUI服务。

- 2. 启动DrSai的OpenWebUI Pipeline:

克隆DrSai仓库到本地，适配DrSai的OpenWebUI Pipeline的相对路径在：```drsai/backend/pipelines```。进入该目录下，使用：```python main.py --port 9097```启动OpenWebUI Pipeline。

- 3. 启动DrSai的后端服务：

```python
from DrSai import run_backend
import asyncio
asyncio.run(run_backend(agent_factory=create_agent))
```

openwebui服务默认启动在```http://localhost:8088```, 通过```openwebui_port```参数可自定义端口;

drsai的pipeline服务默认启动在```http://localhost:9097```，通过```pipelines_port```参数可自定义端口;

drsai后端服务默认启动在```http://localhost:42801/apiv2```, 通过```port```参数可自定义端口;

- 4. 将pipeline的密钥加入OpenWebUI：

pipeline的密钥在```drsai/backend/pipelines/config.py```中，默认为：```0p3n-w3bu!```，将密钥和pipeline后端服务的地址：```http://localhost:9097```加入OpenWebUI的```管理员面板-设置-外部连接-管理OpenAI API连接```中。

## 6.详细文档
见docs目录：
```shell
开发中
```

## 7.联系我们

- 邮箱：hepai@ihep.ac.cn/xiongdb@ihep.ac.cn
- 微信：xiongdongbo_12138