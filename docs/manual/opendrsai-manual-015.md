---
tags: OpenDrSai, 智能体文档
---

# OpenDrSai-事件与消息

在OpenDrSai和AutoGen内，智能体或者多智能体系统通过事件和消息与外部进行通信。

- 智能体事件：用于智能体或者多智能体系统向外部传递内部的运行状态。

- 智能体消息：用于智能体或者多智能体系统发送完整的回复内容，也是智能体或者多智能体系统接受外部消息的数据格式。

下面具体介绍在OpenDrSai内的具体智能体事件和消息类型，你可以通过`drsai.modules.managers.messages`路径导入以下的事件和消息类型。

## 1.BaseAgentEvent:

基础的智能体事件类型为`BaseAgentEvent`：

```python
class BaseAgentEvent(BaseMessage, ABC):
    """Base class for agent events.

    .. note::

        If you want to create a new message type for signaling observable events
        to user and application, inherit from this class.

    Agent events are used to signal actions and thoughts produced by agents
    and teams to user and applications. They are not used for agent-to-agent
    communication and are not expected to be processed by other agents.

    You should override the :meth:`to_text` method if you want to provide
    a custom rendering of the content.
    """

    source: str
    """The name of the agent that sent this message."""

    models_usage: RequestUsage | None = None
    """The model client usage incurred when producing this message."""

    metadata: Dict[str, str] = {}
    """Additional metadata about the message."""
```

继承`BaseAgentEvent`的事件类型有：

- `ToolCallRequestEvent`:大模型回复的工具调用信息事件
- `ToolCallExecutionEvent`:工具函数执行返回的结果信息事件
- `CodeGenerationEvent`:生成的代码信息事件
- `CodeExecutionEvent`:生成代码执行的结果信息事件
- `UserInputRequestedEvent`:user_proxy智能体接受用户的输入信息事件
- `MemoryQueryEvent`:记忆或RAG查询时的查询信息事件
- `ModelClientStreamingChunkEvent`:大模型流式输出的内容事件
- `ThoughtEvent`:大模型思考的内容事件
- `SelectSpeakerEvent`:多智能体系统中选择智能体时的内容事件
- `SelectorEvent`:`SelectorGroupChat`多智能体协作模式时发送的事件
- `TaskEvent`:任务系统事件，可在Dr.Sai UI人机交互前端展示任务执行进度
- `AgentLogEvent`:后端执行的log事件，可在Dr.Sai UI人机交互前端展示智能体的执行过程
- `ToolLongTaskEvent`:长时间运行工具函数执行超时发送的事件

## 2.BaseChatMessage:

基础的智能体消息类型为`BaseChatMessage`：

```python
class BaseChatMessage(BaseMessage, ABC):
    """Abstract base class for chat messages.

    .. note::

        If you want to create a new message type that is used for agent-to-agent
        communication, inherit from this class, or simply use
        :class:`StructuredMessage` if your content type is a subclass of
        Pydantic BaseModel.

    This class is used for messages that are sent between agents in a chat
    conversation. Agents are expected to process the content of the
    message using models and return a response as another :class:`BaseChatMessage`.
    """

    source: str
    """The name of the agent that sent this message."""

    models_usage: RequestUsage | None = None
    """The model client usage incurred when producing this message."""

    metadata: Dict[str, str] = {}
    """Additional metadata about the message."""

    @abstractmethod
    def to_model_text(self) -> str:
        """Convert the content of the message to text-only representation.
        This is used for creating text-only content for models.

        This is not used for rendering the message in console. For that, use
        :meth:`~BaseMessage.to_text`.

        The difference between this and :meth:`to_model_message` is that this
        is used to construct parts of the a message for the model client,
        while :meth:`to_model_message` is used to create a complete message
        for the model client.
        """
        ...

    @abstractmethod
    def to_model_message(self) -> UserMessage:
        """Convert the message content to a :class:`~autogen_core.models.UserMessage`
        for use with model client, e.g., :class:`~autogen_core.models.ChatCompletionClient`.
        """
        ...
```

继承`BaseChatMessage`的消息类型有：

- `TextMessage`:智能体或者多智能体系统回复的文本消息
- `StopMessage`:智能体或者多智能体系统回复的停止对话的消息
- `HandoffMessage`:智能体或者多智能体系统需要下一位智能体或者用户的`传球`消息
- `ToolCallSummaryMessage`:智能体或者多智能体系统回复的工具调用结果的总结消息
- `StructuredMessage`:智能体或者多智能体系统回复的结构化输出消息
- `MultiModalMessage`:智能体或者多智能体系统回复的多模态消息
- `AgentLongTaskMessage`:智能体或者多智能体系统回复的长时间运行工具函数执行消息
- `LongTaskQueryMessage`:智能体或者多智能体系统发送的长时间运行工具函数执行状态查询消息

## 3.一些实践经验:

### 3.1.在智能体或者多智能体系统设计中如何使用这些事件和消息类型

1. 智能体事件有助于将智能体执行过程透明化，而不是黑箱运行。为此，在你设计智能体时应该要考虑到应该在某些阶段输出一个合适的事件类型。例如，在`DrSaiAgent`处理工具调用时，对外输出了`ToolCallExecutionEvent`事件，将工具的执行结果发布出去，让用户更为清晰地了解到工具的调用情况。

2. 在OpenDrSai内，我们一般调用`run_stream`或者`on_messages_stream`函数作为智能体对话入口，所有的处理事件或者智能体消息通过yield输出，输入方式如下：

```python
yield ToolCallExecutionEvent(content=exec_results, source=agent_name,)
```

3. 在你有特殊的输出要求时，鼓励继承`BaseAgentEvent`构建你自己特殊的事件。

### 3.2.如何判断这些事件或消息类型

1. 在代码调用智能体时，我们可以通过`isinstance`判断输出类型，例如：

```python
agent_messages = []
async for message in agent.run_stream(task=task):
    if isinstance(message, ModelClientStreamingChunkEvent):
        yield message
    if isinstance(message, TextMessage):
        agent_messages.append(message)
```

1. 在api等方式调用时，OpenDrSai一般会基于`pydantic.BaseModel`的特性，将事件和消息dump：`json.dumps(message.model_dump(mode="json"))`，方便网络传输。所以在构建你的消息或者事件类型时，务必在类型中添加`type`字段，并赋予独一无二的名称，如下面的`TextMessage`：

```python
class TextMessage(BaseTextChatMessage):
    """A text message with string-only content."""

    type: Literal["TextMessage"] = "TextMessage"
```

例如，我们在dump`TextMessage(source="agent", content="test")`后的内容为：'`{"source": "agent", "models_usage": null, "metadata": {}, "content": "test", "type": "TextMessage"}'`。你就可以通过"type"字段判断输出类型。
