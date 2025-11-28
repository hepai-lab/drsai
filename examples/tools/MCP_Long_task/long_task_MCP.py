from mcp.server.fastmcp import FastMCP
from uuid import uuid4
from enum import Enum

import asyncio
import multiprocessing
import threading
import time

from drsai_ext.tools import LongTaskManager, TaskStatus

# create a MCP server
mcp=FastMCP(
    name="Long_Task_Tool",
    instructions="A tool for performing long tasks.",
    host="0.0.0.0",
    port = 42609, # for transport = "sse" to start a server-sent events (SSE) server
    )


test_text  =  """
#### [English](README_en.md) | 简体中文

# OpenDrSai 

由中国科学院高能物理研究所[HepAI](https://ai.ihep.ac.cn/)团队开发的智能体、多智能体协同系统快速开发和部署一体化框架，可快速地开发和部署自己的智能体、多智能体协同系统前后端服务。

<div align="center">
  <p>
      <img width="30%" src="assets/drsai.png" alt="适配逻辑图">
  </p>
</div>

该开发框架基于Microsoft开源框架[AutoGen](https://github.com/microsoft/autogen)（当前0.5.7版本），在兼容AutoGen完整结构和生态的基础上，重新设计了智能体、多智能体系统的组件和开发逻辑，使其更适合于开发**专业科学智能体和多智能体系统🤖：如复杂多任务执行💡、状态管理和人机交互🙋‍♂️🙋‍♀️、专业科学工具管理和执行🛠️、长任务执行管理⏰、长短记忆管理等🧠**。与主流MCP、A2A协议、[HepAI](https://ai.ihep.ac.cn/)的相关生态、RAGFlow等主流RAG架构具有很好的兼容性。而且具备开发部署一体化能力，智能体或多智能体系统代码可一键启动，注册为openai ChatCompletions格式、HepAI Worker格式，作为API调用。并配套相应的人机交互前端，可以直接开发部署完整的前后端应用。

## 1.特色

- 1.可基于[HepAI平台](https://aiapi.ihep.ac.cn/)进行智能体基座模型的灵活切换，以及工具、知识库等智能体组件的灵活配置。同时兼容OpenAI ChatCompletions，Ollama等模型格式接入。
- 2.为智能体和多智能体系统设计了感知、思考、记忆、执行、状态管理等预定义组件，并进行了插件化设计，可灵活扩展，满足多种专业智能体设计应用场景。
- 3.提供了一键启动的人机交互前后端，实现了开发即应用。并为智能体和多智能体协作系统交互提供了兼容OpenAI ChatCompletions、OpenWebui-Pipeline的标准后端接口，可将智能体和多智能体协作系统作为第三方的模型或智能体API服务。

## 2.快速开始

### 2.1.安装OpenDrSai

#### 源码安装(推荐)
```shell
conda create -n drsai python=>3.11
conda activate drsai
git clone https://code.ihep.ac.cn/hepai/drsai drsai

cd your/path/to/drsai/python/packages/drsai && pip install -e . # for OpenDrSai backend and agent components
cd your/path/to/drsai/python/packages/drsai_ui && pip install -e . # for DrSai-UI  human-computer interaction frontend
```
#### pip 安装

```shell
conda create -n drsai python=>3.11
conda activate drsai
pip install drsai drsai_ui -U
# NOTE: if you have installed hepai<=1.40.0, please keep opneai<= 1.98.0
```

#### 配置HepAI平台的API访问密钥

配置[HepAI](https://aiapi.ihep.ac.cn)DDF2平台的API访问密钥等环境变量(Based on bash)：

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

""" 

#  create your long task function
def search_google_demo_sync(
        keywords: list[str],
        ):
    try:
    # simulate a long task
        time.sleep(30)
        
        return test_text

    except Exception as e:
        return str(e)

# create your long task function
async def search_google_demo_async(
        keywords: list[str],
        ):
    try:
    # simulate a long task
        await asyncio.sleep(30)
        return test_text

    except Exception as e:
        return str(e)


########################################################################
# create a long running task manager
task_manager = LongTaskManager(time_limit=5)

# use the long task manager to run the long task with same parameters
@mcp.tool()
async def search_google(
    keywords: list[str],
):
    """
    This tool performs a long research task by searching for the given keywords on Google.

    Args:
        keywords (list[str]): A list of keywords to search for.

    Returns:
        dict: A JSON object containing:
            - id: The task ID
            - status: Current status (TODO, IN_PROGRESS, DONE, ERROR)
            - result: The result (None if not completed, error message if failed, or actual result if done)
            - message: Additional information about the task
    """

    task_id = str(uuid4())
    result = task_manager.run_sync_task(
        func=search_google_demo_sync, 
        task_id=task_id, 
        keywords=keywords
        )
    return result

# use the long task manager to run the long task with same parameters
@mcp.tool()
async def query_research_status(
    task_id: str,
):
    """
    This tool queries the status of a long research task.

    Args:
        task_id (str): A unique identifier for the task. If the same task_id is provided,
                      it will return the current status/result of that task.

    Returns:
        dict: A JSON object containing:
            - id: The task ID
            - status: Current status (TODO, IN_PROGRESS, DONE, ERROR)
            - result: The result (None if not completed, error message if failed, or actual result if done)
            - message: Additional information about the task
    """
    result = task_manager.get_task_status(task_id)
    return result


if __name__ == '__main__':
    # mcp.run(transport="stdio")
    mcp.run(transport="sse")
