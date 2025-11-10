# 异步 RPC 调用详解

## 一、RPC 基础概念

### 1.1 什么是 RPC (Remote Procedure Call)

**RPC** = **远程过程调用**，是一种进程间通信方式，允许程序像调用本地函数一样调用远程服务。

#### 传统的同步 RPC 模型：

```python
# 看起来像本地函数调用
result = add(2, 3)  # 实际上可能在远程服务器上执行
print(result)  # 输出: 5
```

**流程：**
```
客户端                          服务端
  |                              |
  |------ 发送请求 (2, 3) ------>|
  |                              | 执行 add(2, 3)
  |<----- 返回结果 (5) ----------|
  |                              |
继续执行
```

**特点：**
- 调用方**阻塞等待**响应
- 看起来像本地函数调用
- 隐藏了网络通信细节

### 1.2 什么是异步 RPC

**异步 RPC** 在传统 RPC 基础上加入了**异步特性**，调用方不会阻塞主线程，而是通过 Future/Promise 等机制在响应返回时获取结果。

#### 异步 RPC 模型：

```python
# Python async/await 风格
result = await remote_add(2, 3)  # 不阻塞事件循环，可以处理其他任务
print(result)  # 输出: 5

# 或者 Future/Promise 风格
future = remote_add(2, 3)  # 立即返回 Future
# ... 可以做其他事情 ...
result = await future  # 需要时再等待结果
```

**流程：**
```
客户端 (事件循环)                 服务端
  |                              |
  |------ 发送请求 (2, 3) ------>|
  |<--- 立即返回 Future ---------|
  |                              | 执行 add(2, 3)
  | 可以处理其他任务               |
  |                              |
  |<----- 响应完成，设置 Future --|
  |                              |
await future 获取结果
```

**特点：**
- 调用方**不阻塞**，可以继续处理其他任务
- 通过 **Future/Promise** 机制异步获取结果
- 提高并发性能和系统吞吐量

## 二、SingleThreadedAgentRuntime 中的异步 RPC 实现

### 2.1 为什么需要异步 RPC

在 Agent 系统中：

```python
# Agent A 需要向 Agent B 发送消息并等待响应
response = await runtime.send_message(
    message=QueryMessage("What is 2+3?"),
    recipient=AgentId("math_agent", "default")
)
print(response)  # AnswerMessage(result=5)
```

**需求：**
1. Agent A 发送消息后需要等待 Agent B 的响应
2. 等待期间不能阻塞整个 Runtime（可能有其他消息需要处理）
3. 响应返回后能够继续执行

这正是异步 RPC 的应用场景！

### 2.2 核心实现机制

#### Step 1: 发送消息并创建 Future

在 [_single_threaded_agent_runtime.py:331-383](_single_threaded_agent_runtime.py#L331-L383) 中：

```python
async def send_message(
    self,
    message: Any,
    recipient: AgentId,
    *,
    sender: AgentId | None = None,
    cancellation_token: CancellationToken | None = None,
    message_id: str | None = None,
) -> Any:
    # 1. 创建一个 Future 对象，用于接收响应
    future = asyncio.get_event_loop().create_future()

    # 2. 创建消息信封，包含消息和 Future
    await self._message_queue.put(
        SendMessageEnvelope(
            message=message,
            recipient=recipient,
            future=future,  # ← 关键：Future 随消息一起传递
            cancellation_token=cancellation_token,
            sender=sender,
            metadata=get_telemetry_envelope_metadata(),
            message_id=message_id,
        )
    )

    # 3. 等待 Future 完成并返回结果
    return await future  # ← 异步等待，不阻塞事件循环
```

**关键点：**
- `asyncio.Future`: Python 异步编程的核心机制
- Future 作为"占位符"，稍后会被设置结果
- `await future` 会挂起当前协程，但不阻塞事件循环

#### Step 2: 处理消息并生成响应

在 [_single_threaded_agent_runtime.py:464-553](_single_threaded_agent_runtime.py#L464-L553) 中：

```python
async def _process_send(self, message_envelope: SendMessageEnvelope) -> None:
    recipient = message_envelope.recipient

    try:
        # 1. 获取接收者 Agent
        recipient_agent = await self._get_agent(recipient)

        # 2. 创建消息上下文，标记为 RPC 调用
        message_context = MessageContext(
            sender=message_envelope.sender,
            topic_id=None,
            is_rpc=True,  # ← 标记这是一个 RPC 调用
            cancellation_token=message_envelope.cancellation_token,
            message_id=message_envelope.message_id,
        )

        # 3. 调用 Agent 的消息处理器，获取响应
        response = await recipient_agent.on_message(
            message_envelope.message,
            ctx=message_context,
        )

    except BaseException as e:
        # 4. 如果出错，设置 Future 的异常
        message_envelope.future.set_exception(e)
        self._message_queue.task_done()
        return

    # 5. 将响应封装成 ResponseMessageEnvelope，放回队列
    await self._message_queue.put(
        ResponseMessageEnvelope(
            message=response,
            future=message_envelope.future,  # ← 携带原来的 Future
            sender=message_envelope.recipient,
            recipient=message_envelope.sender,
            metadata=get_telemetry_envelope_metadata(),
        )
    )

    self._message_queue.task_done()
```

**关键点：**
- `is_rpc=True` 告诉接收者这是一个需要响应的调用
- 异常会通过 `future.set_exception()` 传递给调用者
- 响应通过新的 `ResponseMessageEnvelope` 返回

#### Step 3: 设置 Future 结果

在 [_single_threaded_agent_runtime.py:630-660](_single_threaded_agent_runtime.py#L630-L660) 中：

```python
async def _process_response(self, message_envelope: ResponseMessageEnvelope) -> None:
    # 1. 记录日志
    event_logger.info(MessageEvent(...))

    # 2. 设置 Future 的结果
    if not message_envelope.future.cancelled():
        message_envelope.future.set_result(message_envelope.message)
        # ↑ 这会唤醒等待这个 Future 的协程

    # 3. 标记任务完成
    self._message_queue.task_done()
```

**关键点：**
- `future.set_result()` 会唤醒所有等待这个 Future 的协程
- 原来阻塞在 `await future` 的代码会继续执行
- 检查 `cancelled()` 避免设置已取消的 Future

### 2.3 完整的异步 RPC 流程

```
[调用者协程]
    |
    | await runtime.send_message(msg, recipient)
    |     ↓
    |   创建 future = Future()
    |   创建 SendMessageEnvelope(message=msg, future=future)
    |   await queue.put(envelope)
    |   return await future  ← 协程在此挂起（不阻塞事件循环）
    |
    ⋮ (等待中，事件循环可以处理其他任务)
    ⋮
    |
[消息循环: _process_next]
    |
    | envelope = await queue.get()
    | asyncio.create_task(_process_send(envelope))  ← 并发处理
    |     ↓
    |   [_process_send 在后台 Task 中执行]
    |       ↓
    |     recipient = await self._get_agent(recipient_id)
    |     response = await recipient.on_message(msg, ctx)
    |     await queue.put(ResponseMessageEnvelope(response, future))
    |
[消息循环: _process_next]
    |
    | envelope = await queue.get()
    | asyncio.create_task(_process_response(envelope))
    |     ↓
    |   [_process_response 在后台 Task 中执行]
    |       ↓
    |     future.set_result(response)  ← 设置 Future 结果
    |
    ⋮ (Future 完成，等待的协程被唤醒)
    ⋮
    |
[调用者协程]
    |
    | await future  ← 协程恢复，获取结果
    | return response
    |
继续执行
```

## 三、asyncio.Future 工作原理

### 3.1 Future 是什么

`asyncio.Future` 是一个代表**未来某个时刻会得到的值**的对象。

```python
import asyncio

# 创建一个 Future
future = asyncio.get_event_loop().create_future()

print(future.done())  # False - 还没有结果

# 设置结果
future.set_result(42)

print(future.done())  # True - 有结果了
print(future.result())  # 42 - 获取结果
```

### 3.2 await Future 的原理

```python
# 当你写：
result = await future

# 底层发生的事情：
# 1. 检查 Future 是否已完成
if future.done():
    # 如果已完成，直接返回结果
    result = future.result()
else:
    # 如果未完成，注册回调并挂起当前协程
    future.add_done_callback(resume_coroutine)
    # 让出控制权，事件循环可以执行其他任务
    yield
    # 当 Future 完成时，事件循环会恢复这个协程
    result = future.result()
```

### 3.3 Future 的生命周期

```python
# 阶段 1: 创建
future = asyncio.Future()
print(future.done())  # False

# 阶段 2: 等待 (可选)
task = asyncio.create_task(wait_for_future(future))

async def wait_for_future(f):
    result = await f  # 协程挂起，等待结果
    print(result)

# 阶段 3: 设置结果
future.set_result("Hello")  # 唤醒等待的协程

# 或者设置异常
# future.set_exception(Exception("Error"))
```

## 四、异步 RPC vs 发布订阅

### 4.1 send_message (异步 RPC)

```python
# RPC 调用：等待响应
response = await runtime.send_message(
    message=QueryMessage("What is 2+3?"),
    recipient=AgentId("calculator", "default")
)
print(f"Result: {response.result}")  # 需要响应才能继续
```

**特点：**
- ✅ **双向通信**：请求 + 响应
- ✅ **等待结果**：使用 `await` 等待
- ✅ **RPC 语义**：`is_rpc=True`
- ✅ **点对点**：一个发送者，一个接收者
- ✅ **异常传播**：接收者的异常会传递给发送者

**实现机制：**
- 使用 `Future` 接收响应
- 响应通过 `ResponseMessageEnvelope` 返回
- 调用者阻塞等待（但不阻塞事件循环）

### 4.2 publish_message (发布订阅)

```python
# 发布消息：不等待响应
await runtime.publish_message(
    message=NotificationMessage("System updated"),
    topic_id=DefaultTopicId()
)
# 立即继续执行，不等待订阅者处理
print("Message published")
```

**特点：**
- ✅ **单向通信**：只发送，不等待响应
- ✅ **立即返回**：`await` 只等待消息入队
- ✅ **发布订阅语义**：`is_rpc=False`
- ✅ **一对多**：一个发送者，多个订阅者
- ❌ **异常隔离**：订阅者异常不影响发布者

**实现机制：**
- 无 `Future`，直接返回
- 通过 `SubscriptionManager` 找到所有订阅者
- 使用 `asyncio.gather()` 并发调用所有订阅者

### 4.3 对比表

| 特性 | send_message (RPC) | publish_message (发布订阅) |
|------|-------------------|---------------------------|
| **通信模式** | 点对点 (1-to-1) | 发布订阅 (1-to-N) |
| **响应** | 等待响应 | 无响应 |
| **Future** | 有 | 无 |
| **is_rpc** | True | False |
| **异常处理** | 异常传播给调用者 | 异常隔离（可配置） |
| **返回值** | 接收者的响应 | None |
| **使用场景** | 需要响应的查询/命令 | 事件通知、广播 |

## 五、实际应用示例

### 5.1 异步 RPC 示例

```python
from dataclasses import dataclass
from autogen_core import (
    AgentId,
    MessageContext,
    RoutedAgent,
    SingleThreadedAgentRuntime,
    message_handler,
)

@dataclass
class QueryMessage:
    question: str

@dataclass
class AnswerMessage:
    answer: str

# 服务端 Agent
class CalculatorAgent(RoutedAgent):
    @message_handler
    async def handle_query(self, message: QueryMessage, ctx: MessageContext) -> AnswerMessage:
        # 模拟计算
        if "2+3" in message.question:
            result = "5"
        else:
            result = "I don't know"

        # 返回响应
        return AnswerMessage(answer=result)

# 客户端使用
async def main():
    runtime = SingleThreadedAgentRuntime()

    # 注册服务端 Agent
    await CalculatorAgent.register(
        runtime,
        "calculator",
        lambda: CalculatorAgent("Calculator")
    )

    runtime.start()

    # 异步 RPC 调用
    response = await runtime.send_message(
        message=QueryMessage(question="What is 2+3?"),
        recipient=AgentId("calculator", "default")
    )

    print(f"Answer: {response.answer}")  # 输出: Answer: 5

    await runtime.stop_when_idle()
```

### 5.2 发布订阅示例

```python
from autogen_core import (
    DefaultTopicId,
    default_subscription,
    message_handler,
)

@dataclass
class NotificationMessage:
    content: str

# 订阅者 Agent 1
@default_subscription
class LoggerAgent(RoutedAgent):
    @message_handler
    async def handle_notification(self, message: NotificationMessage, ctx: MessageContext) -> None:
        print(f"[Logger] {message.content}")
        # 无需返回值

# 订阅者 Agent 2
@default_subscription
class AlertAgent(RoutedAgent):
    @message_handler
    async def handle_notification(self, message: NotificationMessage, ctx: MessageContext) -> None:
        print(f"[Alert] {message.content}")
        # 无需返回值

# 发布者使用
async def main():
    runtime = SingleThreadedAgentRuntime()

    # 注册订阅者
    await LoggerAgent.register(runtime, "logger", lambda: LoggerAgent("Logger"))
    await AlertAgent.register(runtime, "alert", lambda: AlertAgent("Alert"))

    runtime.start()

    # 发布消息（不等待响应）
    await runtime.publish_message(
        message=NotificationMessage(content="System started"),
        topic_id=DefaultTopicId()
    )

    print("Message published, continuing...")

    await runtime.stop_when_idle()
```

## 六、异步 RPC 的优势

### 6.1 与同步 RPC 对比

**同步 RPC (阻塞)：**
```python
# 伪代码
def sync_rpc_call(message, recipient):
    send(message, recipient)
    # 线程阻塞，等待响应
    response = wait_for_response()  # ← 阻塞整个线程
    return response

# 问题：等待期间线程无法处理其他任务
```

**异步 RPC (非阻塞)：**
```python
async def async_rpc_call(message, recipient):
    future = send(message, recipient)
    # 协程挂起，但事件循环可以处理其他任务
    response = await future  # ← 不阻塞事件循环
    return response

# 优势：等待期间可以处理其他消息
```

### 6.2 并发性能

**场景：Agent A 需要同时向 10 个 Agent 发送查询**

**同步方式：**
```python
# 顺序执行，总耗时 = 10 * 单次耗时
for i in range(10):
    response = sync_rpc_call(msg, agents[i])  # 阻塞
    results.append(response)
```

**异步方式：**
```python
# 并发执行，总耗时 ≈ 单次耗时
tasks = [
    async_rpc_call(msg, agents[i])
    for i in range(10)
]
results = await asyncio.gather(*tasks)  # 并发等待
```

### 6.3 资源利用率

```
同步模型：
Thread 1: [等待] [等待] [等待] [处理] ← 大部分时间在等待
Thread 2: [等待] [等待] [等待] [处理]
Thread 3: [等待] [等待] [等待] [处理]

异步模型：
Event Loop: [处理A] [处理B] [处理C] [处理A] [处理D] ← 持续处理任务
            ↑ A等待时切换到B，B等待时切换到C
```

## 七、总结

### 7.1 异步 RPC 核心概念

1. **RPC (远程过程调用)**：像调用本地函数一样调用远程服务
2. **异步**：调用方不阻塞，通过 Future/Promise 异步获取结果
3. **Future**：代表未来某个时刻会得到的值的占位符

### 7.2 SingleThreadedAgentRuntime 实现要点

1. **消息入队**：`send_message()` 创建 Future 并将消息放入队列
2. **异步等待**：`await future` 挂起协程，不阻塞事件循环
3. **消息处理**：`_process_send()` 调用接收者，获取响应
4. **响应返回**：`_process_response()` 设置 Future 结果
5. **协程恢复**：等待的协程被唤醒，继续执行

### 7.3 何时使用

**使用异步 RPC (send_message)：**
- ✅ 需要获取响应结果
- ✅ 点对点通信
- ✅ 需要异常传播
- ✅ 查询、命令等场景

**使用发布订阅 (publish_message)：**
- ✅ 不需要响应
- ✅ 一对多通信
- ✅ 事件通知
- ✅ 广播场景

### 7.4 关键优势

1. **非阻塞**：不阻塞事件循环，提高并发性能
2. **高效**：单线程处理多个并发请求
3. **简洁**：async/await 语法简单易懂
4. **可靠**：完善的异常处理和取消机制
