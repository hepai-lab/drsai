# 智能体代码开发案例

## 1.快速开始
### 1.1.创建一个可以使用函数作为工具的简单智能体

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

### 1.2.使用简单的RAG函数作为智能体的记忆层

```python
from drsai import AssistantAgent, HepAIChatCompletionClient, LLMMessage, CancellationToken

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
    async def rag_demo(
        oai_messages: List[Dict], 
        llm_messages: List[LLMMessage], 
        model_client: HepAIChatCompletionClient,
        cancellation_token: CancellationToken,
        agent_name: str,
         **kwargs):
        query = oai_messages[-1]["content"]  # Select the last message of the chat history as the RAG query statement.
        retrieve_txt = "1. Humans will be destroyed by AI in 2050;\n2. Humans are destroyed by AI due to their arrogance and conceit."
        last_txt = f"""The following are some reference materials, and you must refer to these materials to answer the question:\n{retrieve_txt}. My question is: {query}"""
        oai_messages[-1]["content"] = last_txt
        return oai_messages

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

### 1.3.自定义智能体的回复逻辑

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

## 2.进阶开发案例

支持openai格式的智能体/多智能体系统开发具体见：```examples/oai_client```

支持人机交互前端UI的智能体/多智能体系统具体见：```examples/cli```

## 3.UI启动案例
具体见：```examples/cli/run_backend.py```

## 4.代码请求后端案例
具体见：```examples/requests```