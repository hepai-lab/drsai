# 使用 drsai_ui API 的人机交互访问智能体后端

## 使用aotugen的消息内容作为输入输出

```python
from hepai import HepAI, HRModel
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
    CreateResult
)


model = HRModel.connect(
    api_key=HEPAI_API_KEY,
    name="DeepSeek_R1_test",
    base_url="https://aiapi.ihep.ac.cn/apiv2"
)
funcs = model.functions  # Get all remote callable functions.
print(f"Remote callable funcs: {funcs}")

stream = True
completion = model.a_chat_completions(
    api_key=HEPAI_API_KEY,
    stream =  stream,
    messages=[
    # {"role": "user", "content": "请使用百度搜索什么是Ptychography?"}
    # {"role": "user", "content": "What is the weather in New York?"},
    TextMessage(content="Hello, world!", source="Alice", metadata={"timestamp": "1626713600"}).model_dump(mode="json")
    ],
    chat_id =  "1234567893",
    user =  {"name": "Alice", "email": "alice@example.com"}
)
for chunk in completion:
    print(chunk)
```
## 输入输出说明
与aotugen的run_stream函数输入输出一致，输入为messages列表，输出为chunk列表。
- 输入的messages类型为：List[BaseChatMessage], 其中BaseChatMessage为autogen_agentchat.messages.BaseChatMessage
- 输出的chunk类型为：json.dumps(message.model_dump(mode="json")), message: BaseAgentEvent | BaseChatMessage | TaskResult，具体为autogen_agentchat.messages和autogen_core.models中导入的内容。


