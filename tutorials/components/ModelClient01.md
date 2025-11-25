# 大模型接入层设计

## 兼容[HepAI](https://aiapi.ihep.ac.cn/)部署的OpenAI Style的模型

```python
from drsai import HepAIChatCompletionClient
from autogen_core.models import CreateResult

model_client = HepAIChatCompletionClient(
        model="deepseek-ai/deepseek-r1", # 必填参数，指定模型名称
        # api_key=os.environ.get("HEPAI_API_KEY"), # 选择性参数，指定HepAI API Key
        # base_url="https://aiapi.ihep.ac.cn/apiv2", # 选择性参数，指定HepAI API的URL,或者任意兼容OpenAPI的API
    )

# chat completion
result: CreateResult = model_client.create(
    llm_messages, 
    tools=tools, 
    cancellation_token=cancellation_token
)

# chat completion as stream
model_result : CreateResult|None = None
async for chunk in model_client.create_stream(
    llm_messages, 
    tools=tools,
    json_output=output_content_type,
    cancellation_token=cancellation_token
):
    # process the chunk of chat completion result
     if isinstance(chunk, CreateResult):
        model_result = chunk
    elif isinstance(chunk, str):
        yield ModelClientStreamingChunkEvent(content=chunk, source=agent_name)
    else:
        yield chunk
```

- `llm_messages` 是autogen LLMMessage格式的列表, 如`[UserMessage(content="What is the capital of France?", source="user")]`.
- `tools` 是可选参数，指定OpenAI API的tools参数。
- `cancellation_token` 是可选参数，一个异步管理运行状态的类,用于取消请求。
- `output_content_type` 是可选参数，指定输出结果的格式，支持json和Basemodel。

**Note:**

对于非[HepAI](https://aiapi.ihep.ac.cn/)支持或者OpenAI名称的模型,通过`model_info`参数指定模型信息:

```python
model_client = HepAIChatCompletionClient(
        model="deepseek-ai/deepseek-r1",
        api_key=os.environ.get("HEPAI_API_KEY"), 
        base_url="https://aiapi.ihep.ac.cn/apiv2", 
        model_info={
            "json_output": True,
            "function_calling": True,
            "vision": False,
            "family": "unknown",
            "structured_output": False,
            "multiple_system_messages":True,
            "token_model": "gpt-4o-2024-11-20", # Default model for token counting
        
        }
    )
```

## 组件式加载

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

## 接入智能体

```python
AssistantAgent(
    name="weather_agent",
    model_client=model_client,
    system_message="You are a helpful assistant.",
    model_client_stream=True,  # Enable streaming tokens from the model client.
    )
```