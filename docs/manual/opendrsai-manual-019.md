---
tags: OpenDrSai, 智能体文档
---

# OpenDrSai-API访问

如果您希望在独立项目中集成智能体，OpenDrSai提供了智能体系统后端的访问方法，具体包含基于通用OpenAI协议的ChatCompletion和基于自研无限函数协议（IF）的HepAI worker两种访问模式。

建议先启动[examples/agent_groupchat/assistant_base_R1_oai.py](https://github.com/hepai-lab/drsai/blob/main/examples/agent_groupchat/assistant_base_R1_oai.py)智能体案例，以下远程访问智能体后端的案例都是基于此。如无法通过`https://aiapi.ihep.ac.cn/apiv2`远程访问，可以试试localhost访问作为远程访问实验。

## 1.OpenAI ChatCompletion 格式

1. 导入依赖包

```python
from openai import OpenAI
# from hepai import HepAI
import os
import json
import requests
import asyncio

HEPAI_API_KEY = os.getenv("HEPAI_API_KEY")
# base_url = "http://localhost:42813/apiv2"
base_url = "https://aiapi.ihep.ac.cn/apiv2"

```

2. 使用OpenAI格式的同步客户端访问

```python
def request_client():
    client = OpenAI(api_key=HEPAI_API_KEY, base_url=base_url)

    models = client.models.list()
    for idx, model in enumerate(models):
      print(model)

    stream = True

    completion = client.chat.completions.create(
      model='R1_test',
      messages=[
        # {"role": "user", "content": "请使用百度搜索什么是Ptychography?"}
        {"role": "user", "content": "What is the weather in New York?"}
      ],
      stream=stream,
      extra_body = {
        "chat_id": "1234567893",
        "user": {"name": "Alice", "email": "alice@example.com"}
        }
    )

    if stream:
      for chunk in completion:
        if chunk.choices and chunk.choices[0].delta.content:
          print(chunk.choices[0].delta.content, end='', flush=True)
      print('\n')

    else:
      print(completion)
```

3. 使用OpenAI格式的异步客户端访问

```python
async def request_async_client():
  from openai import AsyncOpenAI
  client = AsyncOpenAI(api_key=HEPAI_API_KEY, base_url=base_url)
  completion = await client.chat.completions.create(
    model='R1_test',
    messages=[
      # {"role": "user", "content": "请使用百度搜索什么是Ptychography?"}
      {"role": "user", "content": "What is the weather in New York?"}
    ],
    stream=True,
    extra_body = {
      "chat_id": "1234567893",
      "user": {"name": "Alice", "email": "alice@example.com"}
      }
  )
  async for chunk in completion:
    if chunk.choices and chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end='', flush=True)
  print('\n')
```

4. 使用request的方式访问

```python
def request_url():
    url = base_url + "/chat/completions"
    headers = {
        "Authorization": "Bearer " + HEPAI_API_KEY,
        "Content-Type": "application/json"
    }
    data = {
        "model": "R1_test",
        "messages": [
            {"role": "user", "content": "What is the weather in New York?"},
            ],
        "stream": True, 
        "chat_id": "1234567893",
        "user": {"name": "Alice", "email": "alice@example.com"}
    }
    response = requests.post(url, headers=headers, data=json.dumps(data))
    if response.status_code == 200:
        for chunk in response.iter_content(chunk_size=None):
            if chunk:
                print(chunk.decode('utf-8'), end='', flush=True)
    else:
        print(response.status_code)
        print(response.text)
```

注意：这里的chat_id和user是做后端对话session分区关键。

## 2.HepAI Worker 格式

1. 导入依赖包，重点是各种智能体事件和消息的种类

```python
from hepai import HepAI, HRModel
import os
import json
import requests
import sys
import asyncio
from autogen_agentchat.messages import (
    StructuredMessageFactory,
    BaseChatMessage,
    TextMessage,
    HandoffMessage,
    StopMessage,
    ToolCallSummaryMessage,
    StructuredMessage,
    BaseAgentEvent,
    ToolCallExecutionEvent,
    ToolCallRequestEvent,
    CodeGenerationEvent,
    CodeExecutionEvent,
    UserInputRequestedEvent,
    MemoryQueryEvent,
    ModelClientStreamingChunkEvent,
    ThoughtEvent,
    SelectSpeakerEvent,
    SelectorEvent,
    MessageFactory,
    MultiModalMessage,
    Image,
)
from autogen_core.models import (
    AssistantMessage,
    ChatCompletionClient,
    CreateResult,
    FunctionExecutionResult,
    FunctionExecutionResultMessage,
    LLMMessage,
    ModelFamily,
    SystemMessage,
)
```


以下的test_autogen_messages函数展示了智能体后端对各种事件和消息类型的输出处理方式，即直接进行model_dump：

```python
def test_autogen_messages():
    textmessage = TextMessage(content="Hello, world!", source="Alice", metadata={"timestamp": "1626713600"})
    textmessage_json = textmessage.model_dump(mode="json") 
    print(textmessage_json)
```

你可以在[Open DrSai](https://docs-drsai.ihep.ac.cn/)中的`OpenDrSai-事件与消息`中查询各个智能体事件和消息的具体描述，这些事件或消息通常是由智能体开发者决定输出。


2. 使用异步访问方法获取智能体后端定义的函数方法。消息交互通过智能体后端的`a_chat_completions`方法进行。传入的消息类型为TextMessage或者MultiModalMessage，输出格式则为上面`test_autogen_messages`函数输出的各种事件或消息的josn格式。其中特别注意`ModelClientStreamingChunkEvent`-后端产生的流式文本消息和`TextMessage`-后端完整的智能体回复消息，一个通常应用于流式输出，一个通常用于保存聊天记录。

```python
async def test_async_request():
  model = await HRModel.async_connect(
      api_key=HEPAI_API_KEY,
      name="R1_test",
      base_url="https://aiapi.ihep.ac.cn/apiv2"
  )
  
  funcs = model.functions  # Get all remote callable functions.
  print(f"Remote callable funcs: {funcs}")
  
  info = await model.get_info()
  print(f"Model info: {info}")
  stream = True
  completion = await model.a_chat_completions(
    api_key=HEPAI_API_KEY,
    stream =  stream,
    messages=[
      TextMessage(content="Hello, world!", source="Alice", metadata={"timestamp": "1626713600"}).model_dump(mode="json")
    ],
    chat_id =  "1234567893",
    user =  {"name": "Alice", "email": "alice@example.com"}
  )
  async for chunk in completion:
      print(chunk)
```
      
3. 使用同步访问方法

```python
def test_sync_request():
    model = HRModel.connect(
        api_key=HEPAI_API_KEY,
        name="R1_test",
        base_url="https://aiapi.ihep.ac.cn/apiv2"
    )
    funcs = model.functions  # Get all remote callable functions.
    print(f"Remote callable funcs: {funcs}")
    
    info = model.get_info()
    print(f"Model info: {info}")
    stream = True
    completion = model.a_chat_completions(
      api_key=HEPAI_API_KEY,
      stream =  stream,
      messages=[
        TextMessage(content="Hello, world!", source="Alice", metadata={"timestamp": "1626713600"}).model_dump(mode="json")
      ],
      chat_id =  "1234567893",
      user =  {"name": "Alice", "email": "alice@example.com"}
    )
    for chunk in completion:
       print(chunk)
```

4. 智能体后端的其他人机交互接口，

- lazy_init：初始智能体实例

```python
async def lazy_init(self, chat_id: str, api_key: str, run_info: Dict[str, str], stream: bool = True, **kwargs) -> Dict[str, Any]:
```

- pause：暂停智能体操作

```python
 async def pause(self, chat_id: str) -> Dict[str, Any]:
```

- resume：恢复智能体操作

```python
async def resume(self, chat_id: str) -> Dict[str, Any]:
```

- close：关闭智能体

```python
async def close(self, chat_id: str) -> Dict[str, Any]:
```

- save_state：让后端智能体主动保存状态

```python
async def save_state(self, chat_id: str) -> Dict[str, Any]:
```


- load_state：让后端智能体从远程加载状态


```python
async def load_state(self, chat_id: str, state: Mapping[str, Any]) -> Dict[str, Any]:
```


为了方便起见，OpenDrSai提供HepAIWorkerAgent，可直接通过HepAIWorkerAgent作为远程智能体代理进行交互。

```python
async def test_HepAIWorkerAgent_request():
    from drsai.modules.agents import HepAIWorkerAgent
     
    agent = HepAIWorkerAgent(
          name="RemoteAgent",
          model_remote_configs = {
            "api_key" : HEPAI_API_KEY,
            "url" : base_url,
            "model" : "R1_test",
          },
          chat_id="1234567893",
          run_info={"name": "Alice", "email": "alice@example.com"},
          )
    
    await agent.lazy_init()
    
    async for event in agent.run_stream(task = "Hello, world!"):
        # print(event)
        if isinstance(event, TextMessage):
           print(event)
```