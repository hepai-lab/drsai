from mcp.server.fastmcp import FastMCP
from uuid import uuid4
from enum import Enum

import asyncio
import multiprocessing
import threading
import time

mcp=FastMCP(
    name="Long_Task_Tool",
    instructions="A tool for performing long tasks.",
    host="0.0.0.0",
    port = 42608, # for transport = "sse" to start a server-sent events (SSE) server
    )

def search_google_demo_sync(
        task_id: str,
        keywords: list[str],
        ouput_queue: multiprocessing.Queue,
        ):
    try:
    # simulate a long task
        time.sleep(30)
        result =  """
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
        result_json={"id":task_id,'status':TaskStatus.DONE.value,'result':result}
        ouput_queue.put(result_json)

    except Exception as e:
        result_json={"id":task_id,'status':TaskStatus.ERROR.value,'result':str(e)}
        ouput_queue.put(result_json)


class TaskStatus(str, Enum):
    """The status of a task in the task management system."""

    TODO = "TODO"
    IN_PROGRESS = "IN_PROGRESS"
    DONE = "DONE"
    CANCELED = "CANCELED"
    ERROR = "ERROR"

task_id_to_task={}
task_id_to_result={}
time_limit=10 # seconds
result_queue = multiprocessing.Queue()

def queue_monitor_worker():
    """
    Background thread to monitor the result queue and update task_id_to_result.
    """
    while True:
        try:
            # Non-blocking check for queue items
            if not result_queue.empty():
                result_json = result_queue.get_nowait()
                task_id = result_json.get('id')
                if task_id:
                    task_id_to_result[task_id] = result_json
                    print(f"[Queue Monitor] Updated result for task {task_id}: {result_json['status']}")
        except Exception as e:
            print(f"[Queue Monitor] Error: {e}")
        time.sleep(0.5)  # Check every 0.5 seconds

# Start the queue monitor thread
monitor_thread = threading.Thread(target=queue_monitor_worker, daemon=True)
monitor_thread.start()

def cleanup_task(task_id: str):
    """
    Clean up task resources after completion or failure.
    """
    if task_id in task_id_to_task:
        process_info = task_id_to_task[task_id]
        process = process_info.get('process')

        # Terminate process if still running
        if process and process.is_alive():
            process.terminate()
            process.join(timeout=5)
            if process.is_alive():
                process.kill()

        # Remove from task dictionary
        del task_id_to_task[task_id]
        print(f"[Cleanup] Task {task_id} cleaned up")

@mcp.tool()
async def perform_long_research(
    keywords: list[str],
    task_id: str|None = None,
):
    """
    This tool performs a long research task by searching for the given keywords on Google.

    Args:
        keywords (list[str]): A list of keywords to search for.
        task_id (str): A unique identifier for the task. If the same task_id is provided,
                      it will return the current status/result of that task.

    Returns:
        dict: A JSON object containing:
            - id: The task ID
            - status: Current status (TODO, IN_PROGRESS, DONE, ERROR)
            - result: The result (None if not completed, error message if failed, or actual result if done)
            - message: Additional information about the task
    """

    # Generate or use existing task_id
    if task_id is None:
        task_id = str(uuid4())

    # Check if task already exists
    if task_id in task_id_to_result:
        # Return existing result
        result = task_id_to_result[task_id]

        # Cleanup if task is done or failed
        if result['status'] in [TaskStatus.DONE.value, TaskStatus.ERROR.value]:
            cleanup_task(task_id)

        return result

    # Check if task is currently running
    if task_id in task_id_to_task:
        task_info = task_id_to_task[task_id]
        start_time = task_info['start_time']
        elapsed_time = time.time() - start_time

        # Check if time limit exceeded
        if elapsed_time >= time_limit:
            # Return IN_PROGRESS status
            result_json = {
                "id": task_id,
                'status': TaskStatus.IN_PROGRESS.value,
                'result': "Task is still running",
                'message': f'Task is still running. Elapsed time: {elapsed_time:.1f}s / Time limit: {time_limit}s',
                'elapsed_time': elapsed_time
            }
            return result_json
        else:
            # Wait for remaining time
            remaining_time = time_limit - elapsed_time
            await asyncio.sleep(remaining_time)

            # Check result again
            if task_id in task_id_to_result:
                result = task_id_to_result[task_id]

                # Cleanup if done or failed
                if result['status'] in [TaskStatus.DONE.value, TaskStatus.ERROR.value]:
                    cleanup_task(task_id)

                return result
            else:
                # Still not done
                result_json = {
                    "id": task_id,
                    'status': TaskStatus.IN_PROGRESS.value,
                    'result': "Task is still running",
                    'message': f'Task is still running after {time_limit}s',
                    'elapsed_time': time.time() - start_time
                }
                return result_json

    # Create new task
    process = multiprocessing.Process(
        target=search_google_demo_sync,
        args=(task_id, keywords, result_queue)
    )

    # Store task information
    task_id_to_task[task_id] = {
        'process': process,
        'start_time': time.time(),
        'keywords': keywords
    }

    # Start the process
    process.start()
    print(f"[Task] Started task {task_id} for keywords: {keywords}")

    # Wait for time_limit
    await asyncio.sleep(time_limit)

    # Check if result is ready
    if task_id in task_id_to_result:
        result = task_id_to_result[task_id]

        # Cleanup if done or failed
        if result['status'] in [TaskStatus.DONE.value, TaskStatus.ERROR.value]:
            cleanup_task(task_id)

        return result
    else:
        # Task still running
        result_json = {
            "id": task_id,
            'status': TaskStatus.IN_PROGRESS.value,
            'result': "Task is still running",
            'message': f'Task is still running after {time_limit}s. Use the same task_id to check status.',
            'elapsed_time': time_limit
        }
        return result_json



if __name__ == '__main__':
    # mcp.run(transport="stdio")
    mcp.run(transport="sse")
