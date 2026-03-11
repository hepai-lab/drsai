---
tags: OpenDrSai, 智能体文档
---

# OpenDrSai-智能体框架内部的协作逻辑

## 1.OpenDrSai和AutoGen中的智能体框架中的一些基本概念

- **组件化**：将智能体进行大模型调用管理、记忆和上下文管理、工具调用管理、学习等独立功能进行组件化、模块化，方便进行智能体逻辑的编排。
- **子系统**：在编排智能体功能时，需要一些子系统协调相应的模块，如状态管理、配置和参数管理。
- **通信协议**：即智能体内部之间、智能体与外部的数据交换协议和格式，通常通过pydantic的BaseModel进行数据格式定义：
    - 智能体内部模块、子系统之间的通信：每个模块/组件接收特定的数据格式输入、也会有特定的输出格式。
    - 智能体与外部的通信：智能体在任务处理过程中产生的事件、消息等需要向外部告知。

## 2.基础智能体`DrSaiAgent`内的协作逻辑


OpenDrSai提供了基础功能的智能体-`DrSaiAgent`，内部通过以下流程使用组件、子系统、通信协议构建了`DrSaiAgent`的外部消息智能处理逻辑，代码见[drsaiagent.py](https://github.com/hepai-lab/drsai/blob/main/python/packages/drsai/src/drsai/modules/baseagent/drsaiagent.py)。

![](https://note.ihep.ac.cn/uploads/16b8f934-2d0c-44d8-93ac-c68713f33b45.png)


1. 智能体外部的消息通过`DrSaiAgent.run_stream`函数传入，传入的数据格式为`str | BaseChatMessage | Sequence[BaseChatMessage]`。`run_stream`函数将外部传入的不同格式的消息转化为智能体框架内的消息处理格式：`List[BaseChatMessage]`。`run_stream`函数输出的数据格式有：智能体的工作中产生的各种事件`BaseAgentEvent`、智能体的回复的文本/多模态/工具等智能体消息`BaseChatMessage`、智能体最终的回复`TaskResult`。函数定义如下:

```python
async def run_stream(
    self,
    *,
    task: str | BaseChatMessage | Sequence[BaseChatMessage] | None = None,
    cancellation_token: CancellationToken | None = None,
) -> AsyncGenerator[BaseAgentEvent | BaseChatMessage | TaskResult, None]:
```

2. 在`DrSaiAgent.on_messages_stream`函数内进行智能体组件、子系统的编排，构建智能体外部消息的智能处理逻辑。函数接受`DrSaiAgent.run_stream`函数整理传入的数据格式：`List[BaseChatMessage]`，根据函数内的编排逻辑处理外部消息，并输出各种智能体运作中的各种事件、消息，以及最终的回复格式`Response`。这些回复在由`DrSaiAgent.run_stream`函数调用时转发给外部。函数定义如下:

```python
async def on_messages_stream(
    self, messages: Sequence[BaseChatMessage], cancellation_token: CancellationToken
) -> AsyncGenerator[BaseAgentEvent | BaseChatMessage | Response, None]:
```

3. `DrSaiAgent.on_messages_stream`函数内的消息处理逻辑为：
     - 将外部消息加入智能体的上下文管理组件内。
     - 将RAG与记忆管理组件检索的信息加入智能体的上下文管理组件内。
     - 使用大模型调用管理组件处理从上下文管理组件中获取的智能体上下文，在设置为流式回复时，实时输出流式事件`ModelClientStreamingChunkEvent`，并给出大模型的最终回复数据格式`CreateResult`。
     - 上下文管理组件提取`CreateResult`中的大模型回复完整内容，通过上下文管理组件加入到智能体上下文中。
     - 最后由`_process_model_result`函数提取`CreateResult`中的内容是非工具调用回复还是工具调用回复。非工具调用回复则整理为`TextMessage`等消息，工具调用则指定工具执行，并整理为`ToolCallSummaryMessage`工具调用结果的消息类型。这些消息由`Response`数据格式包裹输出。
     - 智能体内的状态管理子系统监控着以上的处理过程。具体逻辑是：通过在每个过程中设置状态变量监控，让外部可以通过改变状态变量值来控制智能体的运行状态。


我将后面的文档中分别介绍智能体的模块化组件、子系统，以及智能体内部之间、智能体与外部的通信协议。