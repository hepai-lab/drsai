---
tags: OpenDrSai, 智能体文档
---

# OpenDrSai-智能体的大模型管理组件

这里主要介绍兼容[HepAI](https://aiapi.ihep.ac.cn/)部署的OpenAI ChatCompletion格式模型的大模型管理组件-`HepAIChatCompletionClient`，继承于AutoGen的`ChatCompletionClient`组件，可通过`drsai.modules.components.model_client`导入。通过以下的方式进行实例化使用：

```python
from drsai.modules.components.model_client import  (
    HepAIChatCompletionClient,
    ModelFamily,
    CreateResult,
    LLMMessage,
    SystemMessage,
    UserMessage,
    AssistantMessage,    
)
from drsai.modules.managers.messages import ModelClientStreamingChunkEvent
import asyncio

async def test():
    # HepAIChatCompletionClient内部大模型调用方式都是异步调用
    model_client = HepAIChatCompletionClient(
        model="deepseek-ai/deepseek-v3-1", # 模型的名称
        api_key=os.environ.get("HEPAI_API_KEY"),# API服务商的api_key
        base_url="https://aiapi.ihep.ac.cn/apiv2",# API服务商的base_url
        # 描述大模型的具体信息，方便确定大模型的功能
        model_info={
                "vision": False, # 是否具有多模态功能
                "function_calling": True,  # 是否可以进行function_calling
                "json_output": True, # 是否支持json_output
                "structured_output": False, # 是否支持结构化输出，目前只有gpt-4o等少数模型具有这个能力
                "family": ModelFamily.GPT_41, # 确定模型的上下文窗口长度属于哪种类型，方便进行token计算
                "multiple_system_messages":True, # 是否支持多条system_message
                "token_model": "gpt-4o-2024-11-20", # 使用tiktoken中的哪种模型进行token计算
            },
        temperature=0.5, # 其他的大模型配置参数
        )

    # 传入HepAIChatCompletionClient的对话数据格式
    llm_messages = [
        SystemMessage(content="You are a helpful assistant."),
        UserMessage(content="What is the weather today?", source="user"),
        AssistantMessage(content="The weather is sunny today.", source="assistant"),
        UserMessage(content="What is the time?", source="user"),
    ]

    # 非流式调用
    result: CreateResult = await model_client.create(
        llm_messages,
    )
    print(result)

    # 流式调用
    model_result : CreateResult|None = None
    async for chunk in model_client.create_stream(
        llm_messages, 
    ):
        # process the chunk of chat completion result
         if isinstance(chunk, CreateResult):
            model_result = chunk
            print(model_result)
        elif isinstance(chunk, str):
            # 发送流式事件
            print(ModelClientStreamingChunkEvent(content=chunk, source="agent_name"))
        else:
            print(chunk)

asyncio.run(test())
```

具体案例见：[model_client01.py](https://github.com/hepai-lab/drsai/blob/main/examples/components/model_client01.py)。

**Note:** 对于非[HepAI](https://aiapi.ihep.ac.cn/)提供商的OpenAI格式访问的模型,通过`model_info`参数指定模型信息即可正常使用。


## 1.主要功能函数

- `create`与`create_stream`:进行非流式或流式输出，支持直接传入`temperature`、`max_tokens`等大模型配置参数。
- `close`:关闭远程client连接。
- `actual_usage`:统计`ChatCompletionClient`实例在多轮调用大模型返回的prompt_tokens、completion_tokens累计计数。
- `total_usage`:统计`ChatCompletionClient`实例在多轮调用大模型返回的prompt_tokens、completion_tokens累计计数。
- `count_tokens`:基于基座模型计算上下文所占用的token数。
- `remaining_tokens`:基于基座模型的tokens窗口限制，统计减去上下文还剩下多少窗口token数剩余。

## 2.在智能体内部调用时的数据格式

### 2.1.`create`与`create_stream`输入输出的数据格式

1. `create`与`create_stream`接受的消息上下文格式为：`List[SystemMessage|UserMessage|AssistantMessage|]`。
2. `create_stream`返回的类型为`AsyncGenerator[Union[str, CreateResult], None]:`，`create`返回的类型为`CreateResult`。`CreateResult`类型的具体字段为：

```python
class CreateResult(BaseModel):
    """Create result contains the output of a model completion."""

    finish_reason: FinishReasons
    """The reason the model finished generating the completion."""

    content: Union[str, List[FunctionCall]]
    """The output of the model completion."""

    usage: RequestUsage
    """The usage of tokens in the prompt and completion."""

    cached: bool
    """Whether the completion was generated from a cached response."""

    logprobs: Optional[List[ChatCompletionTokenLogprob] | None] = None
    """The logprobs of the tokens in the completion."""

    thought: Optional[str] = None
    """The reasoning text for the completion if available. Used for reasoning models
    and additional text content besides function calls."""
```


## 3.组件式加载

```python
model_client_config = {
    "provider": "drsai.HepAIChatCompletionClient"
    "config":
        "model": "openai/gpt-4o"
        "api_key": "sk-****"
        "base_url": "https://aiapi.ihep.ac.cn/apiv2"
        "max_retries": 10
    }
model_client=ChatCompletionClient.load_component(model_client_config)
```

## 4.接入智能体

```python
DrSaiAgent(
    name="weather_agent",
    model_client=model_client,
    system_message="You are a helpful assistant.",
    model_client_stream=True,  # Enable streaming tokens from the model client.
    )
```