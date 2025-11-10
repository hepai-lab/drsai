# SingleThreadedAgentRuntime 消息机制深度分析

## 一、核心架构概览

### 1.1 关键组件

`SingleThreadedAgentRuntime` 是一个单线程异步的 Agent 运行时环境，它通过以下核心组件实现消息的发送和订阅机制：

- **消息队列 (`_message_queue`)**: `Queue[PublishMessageEnvelope | SendMessageEnvelope | ResponseMessageEnvelope]`
- **订阅管理器 (`_subscription_manager`)**: `SubscriptionManager` 实例
- **Agent 工厂 (`_agent_factories`)**: 存储 Agent 类型到工厂函数的映射
- **实例化 Agent (`_instantiated_agents`)**: 存储已创建的 Agent 实例
- **运行上下文 (`_run_context`)**: `RunContext` 实例，管理消息处理循环

### 1.2 消息信封类型

系统定义了三种消息信封类型，用于包装不同类型的消息：

```python
@dataclass(kw_only=True)
class SendMessageEnvelope:
    """点对点消息 - 发送给特定 Agent"""
    message: Any                    # 消息内容
    sender: AgentId | None          # 发送者 ID
    recipient: AgentId              # 接收者 ID
    future: Future[Any]             # 用于接收响应的 Future
    cancellation_token: CancellationToken
    metadata: EnvelopeMetadata | None
    message_id: str

@dataclass(kw_only=True)
class PublishMessageEnvelope:
    """发布订阅消息 - 发送给主题的所有订阅者"""
    message: Any
    sender: AgentId | None
    topic_id: TopicId               # 主题 ID
    cancellation_token: CancellationToken
    metadata: EnvelopeMetadata | None
    message_id: str

@dataclass(kw_only=True)
class ResponseMessageEnvelope:
    """响应消息 - 处理完 SendMessage 后的回复"""
    message: Any
    future: Future[Any]             # 设置结果到此 Future
    sender: AgentId
    recipient: AgentId | None
    metadata: EnvelopeMetadata | None
```

## 二、消息发送机制详解

### 2.1 `send_message()` - 点对点消息发送

**流程图：**
```
send_message(message, recipient)
    ↓
[创建 SendMessageEnvelope]
    ↓
[放入 _message_queue]
    ↓
[返回 Future，等待响应]
```

**详细实现 (第 331-383 行)：**

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
    # 1. 初始化取消令牌和消息 ID
    if cancellation_token is None:
        cancellation_token = CancellationToken()
    if message_id is None:
        message_id = str(uuid.uuid4())

    # 2. 记录事件日志
    event_logger.info(MessageEvent(...))

    # 3. 创建 Future 用于接收响应
    future = asyncio.get_event_loop().create_future()

    # 4. 检查接收者是否存在
    if recipient.type not in self._known_agent_names:
        future.set_exception(Exception("Recipient not found"))

    # 5. 创建 SendMessageEnvelope 并放入队列
    await self._message_queue.put(
        SendMessageEnvelope(
            message=message,
            recipient=recipient,
            future=future,
            cancellation_token=cancellation_token,
            sender=sender,
            metadata=get_telemetry_envelope_metadata(),
            message_id=message_id,
        )
    )

    # 6. 链接取消令牌到 Future
    cancellation_token.link_future(future)

    # 7. 等待并返回响应
    return await future
```

**关键特点：**
- 使用 `asyncio.Future` 实现异步 RPC 调用
- 消息先入队列，不会阻塞调用者
- 通过 Future 机制等待和获取响应

### 2.2 `publish_message()` - 发布订阅消息

**流程图：**
```
publish_message(message, topic_id)
    ↓
[创建 PublishMessageEnvelope]
    ↓
[放入 _message_queue]
    ↓
[立即返回 (无需等待响应)]
```

**详细实现 (第 385-427 行)：**

```python
async def publish_message(
    self,
    message: Any,
    topic_id: TopicId,
    *,
    sender: AgentId | None = None,
    cancellation_token: CancellationToken | None = None,
    message_id: str | None = None,
) -> None:
    # 1. 初始化取消令牌和消息 ID
    if cancellation_token is None:
        cancellation_token = CancellationToken()
    if message_id is None:
        message_id = str(uuid.uuid4())

    # 2. 记录日志
    event_logger.info(MessageEvent(...))

    # 3. 创建 PublishMessageEnvelope 并放入队列
    await self._message_queue.put(
        PublishMessageEnvelope(
            message=message,
            cancellation_token=cancellation_token,
            sender=sender,
            topic_id=topic_id,
            metadata=get_telemetry_envelope_metadata(),
            message_id=message_id,
        )
    )
    # 4. 无需等待，直接返回
```

**关键特点：**
- 发布后立即返回，不等待订阅者处理
- 通过 topic_id 找到所有订阅者
- 支持广播到多个 Agent

## 三、消息队列处理机制

### 3.1 运行上下文和消息循环

**RunContext 类 (第 99-130 行)：**

```python
class RunContext:
    def __init__(self, runtime: SingleThreadedAgentRuntime) -> None:
        self._runtime = runtime
        # 创建后台任务，持续处理消息
        self._run_task = asyncio.create_task(self._run())
        self._stopped = asyncio.Event()

    async def _run(self) -> None:
        while True:
            if self._stopped.is_set():
                return
            # 核心：不断处理下一条消息
            await self._runtime._process_next()
```

**启动流程：**

```python
# 调用 runtime.start()
def start(self) -> None:
    if self._run_context is not None:
        raise RuntimeError("Runtime is already started")
    # 创建 RunContext，自动启动消息循环
    self._run_context = RunContext(self)
```

### 3.2 `_process_next()` - 消息处理核心

**流程图：**
```
_process_next()
    ↓
[从 _message_queue 取出消息]
    ↓
[根据消息类型匹配处理]
    ├─ SendMessageEnvelope → 调用拦截器 → _process_send()
    ├─ PublishMessageEnvelope → 调用拦截器 → _process_publish()
    └─ ResponseMessageEnvelope → 调用拦截器 → _process_response()
```

**详细实现 (第 669-792 行)：**

```python
async def _process_next(self) -> None:
    # 1. 检查是否有后台异常
    if self._background_exception is not None:
        e = self._background_exception
        self._background_exception = None
        self._message_queue.shutdown(immediate=True)
        raise e

    # 2. 从队列获取消息
    try:
        message_envelope = await self._message_queue.get()
    except QueueShutDown:
        if self._background_exception is not None:
            raise self._background_exception from None
        return

    # 3. 模式匹配，根据消息类型分发处理
    match message_envelope:
        case SendMessageEnvelope(message=message, sender=sender, recipient=recipient, future=future):
            # 3.1 应用拦截器 (intervention handlers)
            if self._intervention_handlers is not None:
                for handler in self._intervention_handlers:
                    temp_message = await handler.on_send(
                        message, message_context=..., recipient=recipient
                    )
                    if temp_message is DropMessage:
                        # 消息被拦截丢弃
                        future.set_exception(MessageDroppedException())
                        return
                    message_envelope.message = temp_message

            # 3.2 创建异步任务处理消息
            task = asyncio.create_task(self._process_send(message_envelope))
            self._background_tasks.add(task)
            task.add_done_callback(self._background_tasks.discard)

        case PublishMessageEnvelope(...):
            # 应用拦截器并创建处理任务
            task = asyncio.create_task(self._process_publish(message_envelope))
            self._background_tasks.add(task)
            task.add_done_callback(self._background_tasks.discard)

        case ResponseMessageEnvelope(...):
            # 应用拦截器并创建处理任务
            task = asyncio.create_task(self._process_response(message_envelope))
            self._background_tasks.add(task)
            task.add_done_callback(self._background_tasks.discard)

    # 4. 让出控制权，允许其他任务运行
    await asyncio.sleep(0)
```

**关键特点：**
- 使用 `match/case` 模式匹配分发消息
- 支持拦截器 (InterventionHandler) 在消息处理前拦截/修改消息
- 每个消息的处理都在独立的 asyncio.Task 中并发执行
- 使用 `_background_tasks` 集合跟踪所有后台任务

### 3.3 `_process_send()` - 处理点对点消息

**流程图：**
```
_process_send(SendMessageEnvelope)
    ↓
[获取接收者 Agent 实例]
    ↓
[创建 MessageContext]
    ↓
[调用 recipient_agent.on_message()]
    ↓
[获取响应]
    ↓
[创建 ResponseMessageEnvelope]
    ↓
[放回队列]
    ↓
[标记队列任务完成]
```

**详细实现 (第 464-553 行)：**

```python
async def _process_send(self, message_envelope: SendMessageEnvelope) -> None:
    recipient = message_envelope.recipient

    # 1. 检查接收者是否存在
    if recipient.type not in self._known_agent_names:
        raise LookupError(f"Agent type '{recipient.type}' does not exist.")

    try:
        # 2. 记录日志
        event_logger.info(MessageEvent(...))

        # 3. 获取接收者 Agent 实例 (懒加载)
        recipient_agent = await self._get_agent(recipient)

        # 4. 创建消息上下文
        message_context = MessageContext(
            sender=message_envelope.sender,
            topic_id=None,
            is_rpc=True,                    # 标记为 RPC 调用
            cancellation_token=message_envelope.cancellation_token,
            message_id=message_envelope.message_id,
        )

        # 5. 设置上下文并调用 Agent 的消息处理器
        with MessageHandlerContext.populate_context(recipient_agent.id):
            response = await recipient_agent.on_message(
                message_envelope.message,
                ctx=message_context,
            )

    except CancelledError as e:
        # 处理取消异常
        if not message_envelope.future.cancelled():
            message_envelope.future.set_exception(e)
        self._message_queue.task_done()
        return

    except BaseException as e:
        # 处理其他异常
        message_envelope.future.set_exception(e)
        self._message_queue.task_done()
        return

    # 6. 记录响应日志
    event_logger.info(MessageEvent(..., kind=MessageKind.RESPOND))

    # 7. 将响应放回队列，由 _process_response 处理
    await self._message_queue.put(
        ResponseMessageEnvelope(
            message=response,
            future=message_envelope.future,
            sender=message_envelope.recipient,
            recipient=message_envelope.sender,
            metadata=get_telemetry_envelope_metadata(),
        )
    )

    # 8. 标记队列任务完成
    self._message_queue.task_done()
```

**关键特点：**
- 使用 `is_rpc=True` 标记为同步 RPC 调用
- 异常会被捕获并设置到 Future 中
- 响应通过新的 ResponseMessageEnvelope 返回
- 使用 `task_done()` 支持 `stop_when_idle()` 功能

### 3.4 `_process_publish()` - 处理发布订阅消息

**流程图：**
```
_process_publish(PublishMessageEnvelope)
    ↓
[通过 SubscriptionManager 获取订阅者列表]
    ↓
[遍历所有订阅者]
    ├─ 过滤掉发送者自己
    ├─ 获取订阅者 Agent 实例
    ├─ 创建 MessageContext (is_rpc=False)
    └─ 调用 agent.on_message()
    ↓
[使用 asyncio.gather() 并发执行所有调用]
    ↓
[标记队列任务完成]
```

**详细实现 (第 555-628 行)：**

```python
async def _process_publish(self, message_envelope: PublishMessageEnvelope) -> None:
    try:
        responses: List[Awaitable[Any]] = []

        # 1. 获取所有订阅者 (核心：通过 SubscriptionManager)
        recipients = await self._subscription_manager.get_subscribed_recipients(
            message_envelope.topic_id
        )

        # 2. 遍历所有订阅者
        for agent_id in recipients:
            # 2.1 避免发送消息回给发送者
            if message_envelope.sender is not None and agent_id == message_envelope.sender:
                continue

            # 2.2 记录日志
            event_logger.info(MessageEvent(...))

            # 2.3 创建消息上下文
            message_context = MessageContext(
                sender=message_envelope.sender,
                topic_id=message_envelope.topic_id,
                is_rpc=False,                    # 标记为发布订阅
                cancellation_token=message_envelope.cancellation_token,
                message_id=message_envelope.message_id,
            )

            # 2.4 获取订阅者实例
            agent = await self._get_agent(agent_id)

            # 2.5 创建异步消息处理函数
            async def _on_message(agent: Agent, message_context: MessageContext) -> Any:
                with MessageHandlerContext.populate_context(agent.id):
                    try:
                        return await agent.on_message(
                            message_envelope.message,
                            ctx=message_context,
                        )
                    except BaseException as e:
                        logger.error(f"Error processing publish message for {agent.id}")
                        event_logger.info(MessageHandlerExceptionEvent(...))
                        raise e

            # 2.6 将异步任务添加到列表
            future = _on_message(agent, message_context)
            responses.append(future)

        # 3. 并发执行所有订阅者的消息处理
        await asyncio.gather(*responses)

    except BaseException as e:
        # 4. 处理异常
        if not self._ignore_unhandled_handler_exceptions:
            self._background_exception = e

    finally:
        # 5. 标记任务完成
        self._message_queue.task_done()
```

**关键特点：**
- 使用 `is_rpc=False` 标记为发布订阅
- 通过 `SubscriptionManager` 查找订阅者
- 避免消息回环（发送者不会收到自己发布的消息）
- 使用 `asyncio.gather()` 并发处理所有订阅者
- 支持 `ignore_unhandled_exceptions` 配置

### 3.5 `_process_response()` - 处理响应消息

**流程图：**
```
_process_response(ResponseMessageEnvelope)
    ↓
[记录日志]
    ↓
[设置 Future 结果]
    ↓
[标记队列任务完成]
```

**详细实现 (第 630-660 行)：**

```python
async def _process_response(self, message_envelope: ResponseMessageEnvelope) -> None:
    # 1. 记录日志
    event_logger.info(MessageEvent(..., kind=MessageKind.RESPOND))

    # 2. 设置 Future 结果（如果未被取消）
    if not message_envelope.future.cancelled():
        message_envelope.future.set_result(message_envelope.message)

    # 3. 标记队列任务完成
    self._message_queue.task_done()
```

**关键特点：**
- 简单的 Future 结果设置
- 检查 Future 是否已被取消
- 完成 RPC 调用的响应流程

## 四、订阅管理机制

### 4.1 SubscriptionManager 核心结构

```python
class SubscriptionManager:
    def __init__(self) -> None:
        # 订阅列表
        self._subscriptions: List[Subscription] = []
        # 已见主题集合
        self._seen_topics: Set[TopicId] = set()
        # 主题到订阅者的映射（缓存）
        self._subscribed_recipients: DefaultDict[TopicId, List[AgentId]] = defaultdict(list)
```

### 4.2 订阅管理流程

**添加订阅：**

```python
async def add_subscription(self, subscription: Subscription) -> None:
    # 1. 检查订阅是否已存在
    if any(sub == subscription for sub in self._subscriptions):
        raise ValueError("Subscription already exists")

    # 2. 添加订阅
    self._subscriptions.append(subscription)

    # 3. 重建订阅缓存
    self._rebuild_subscriptions(self._seen_topics)
```

**获取订阅者：**

```python
async def get_subscribed_recipients(self, topic: TopicId) -> List[AgentId]:
    # 1. 如果是新主题，构建订阅映射
    if topic not in self._seen_topics:
        self._build_for_new_topic(topic)

    # 2. 返回订阅者列表
    return self._subscribed_recipients[topic]
```

**构建主题订阅映射：**

```python
def _build_for_new_topic(self, topic: TopicId) -> None:
    # 1. 标记主题为已见
    self._seen_topics.add(topic)

    # 2. 遍历所有订阅
    for subscription in self._subscriptions:
        # 3. 检查订阅是否匹配主题
        if subscription.is_match(topic):
            # 4. 将订阅者添加到映射
            self._subscribed_recipients[topic].append(
                subscription.map_to_agent(topic)
            )
```

**关键特点：**
- 使用懒加载策略，只在首次遇到主题时构建映射
- 缓存主题到订阅者的映射，提高查询效率
- 支持订阅模式匹配（通过 `subscription.is_match()`）
- 支持动态映射（通过 `subscription.map_to_agent()`）

### 4.3 订阅注册流程

```python
# Runtime 提供订阅接口
async def add_subscription(self, subscription: Subscription) -> None:
    await self._subscription_manager.add_subscription(subscription)

async def remove_subscription(self, id: str) -> None:
    await self._subscription_manager.remove_subscription(id)
```

## 五、Agent 生命周期管理

### 5.1 Agent 注册

**工厂函数注册：**

```python
async def register_factory(
    self,
    type: str | AgentType,
    agent_factory: Callable[[], T | Awaitable[T]],
    *,
    expected_class: type[T] | None = None,
) -> AgentType:
    # 1. 检查类型是否已存在
    if type.type in self._agent_factories:
        raise ValueError(f"Agent with type {type} already exists.")

    # 2. 包装工厂函数
    async def factory_wrapper() -> T:
        maybe_agent_instance = agent_factory()
        if inspect.isawaitable(maybe_agent_instance):
            agent_instance = await maybe_agent_instance
        else:
            agent_instance = maybe_agent_instance

        if expected_class is not None and type(agent_instance) != expected_class:
            raise ValueError("Factory registered using the wrong type.")

        return agent_instance

    # 3. 存储工厂函数
    self._agent_factories[type.type] = factory_wrapper

    return type
```

**实例注册：**

```python
async def register_agent_instance(
    self,
    agent_instance: Agent,
    agent_id: AgentId,
) -> AgentId:
    # 1. 检查是否已存在
    if agent_id in self._instantiated_agents:
        raise ValueError(f"Agent with id {agent_id} already exists.")

    # 2. 绑定 ID 和 Runtime
    await agent_instance.bind_id_and_runtime(id=agent_id, runtime=self)

    # 3. 存储实例
    self._instantiated_agents[agent_id] = agent_instance

    return agent_id
```

### 5.2 Agent 懒加载

```python
async def _get_agent(self, agent_id: AgentId) -> Agent:
    # 1. 检查是否已实例化
    if agent_id in self._instantiated_agents:
        return self._instantiated_agents[agent_id]

    # 2. 检查工厂是否存在
    if agent_id.type not in self._agent_factories:
        raise LookupError(f"Agent with name {agent_id.type} not found.")

    # 3. 调用工厂创建实例
    agent_factory = self._agent_factories[agent_id.type]
    agent = await self._invoke_agent_factory(agent_factory, agent_id)

    # 4. 缓存实例
    self._instantiated_agents[agent_id] = agent

    return agent
```

**关键特点：**
- 支持工厂函数和实例两种注册方式
- 懒加载机制，只在需要时创建 Agent
- 实例缓存，避免重复创建
- 支持同步和异步工厂函数

## 六、并发和异常处理

### 6.1 并发模型

```
单线程事件循环 (asyncio)
    ↓
消息队列 (FIFO)
    ↓
消息处理器 (_process_next)
    ↓
创建并发任务 (asyncio.create_task)
    ├─ Task 1: _process_send()
    ├─ Task 2: _process_publish()
    └─ Task N: _process_response()
```

**关键机制：**

```python
# 在 _process_next 中创建并发任务
task = asyncio.create_task(self._process_send(message_envelope))
self._background_tasks.add(task)
task.add_done_callback(self._background_tasks.discard)

# 让出控制权
await asyncio.sleep(0)
```

**特点：**
- 单线程异步，避免线程同步问题
- 消息按 FIFO 顺序从队列取出
- 消息处理并发执行，不阻塞队列
- 使用 `_background_tasks` 集合跟踪所有任务

### 6.2 异常处理策略

**发送消息异常：**

```python
try:
    response = await recipient_agent.on_message(message, ctx=message_context)
except CancelledError as e:
    # 取消异常：设置到 Future
    message_envelope.future.set_exception(e)
    return
except BaseException as e:
    # 其他异常：设置到 Future，调用者会收到
    message_envelope.future.set_exception(e)
    return
```

**发布消息异常：**

```python
try:
    await agent.on_message(message, ctx=message_context)
except BaseException as e:
    logger.error(f"Error processing publish message for {agent.id}")
    if not self._ignore_unhandled_handler_exceptions:
        # 记录后台异常，下次 process_next 时抛出
        self._background_exception = e
    raise e
```

**配置选项：**

```python
def __init__(
    self,
    *,
    ignore_unhandled_exceptions: bool = True,  # 是否忽略未处理的异常
):
    self._ignore_unhandled_handler_exceptions = ignore_unhandled_exceptions
```

### 6.3 取消令牌机制

```python
# 创建取消令牌
if cancellation_token is None:
    cancellation_token = CancellationToken()

# 链接到 Future
cancellation_token.link_future(future)

# 传递给消息处理器
message_context = MessageContext(
    ...,
    cancellation_token=cancellation_token,
)
```

## 七、拦截器机制

### 7.1 拦截器接口

```python
class InterventionHandler:
    async def on_send(
        self,
        message: Any,
        message_context: MessageContext,
        recipient: AgentId
    ) -> Any | DropMessage:
        """拦截点对点消息"""
        pass

    async def on_publish(
        self,
        message: Any,
        message_context: MessageContext
    ) -> Any | DropMessage:
        """拦截发布消息"""
        pass

    async def on_response(
        self,
        message: Any,
        sender: AgentId,
        recipient: AgentId
    ) -> Any | DropMessage:
        """拦截响应消息"""
        pass
```

### 7.2 拦截流程

```python
# 在 _process_next 中应用拦截器
if self._intervention_handlers is not None:
    for handler in self._intervention_handlers:
        # 调用拦截器
        temp_message = await handler.on_send(message, ...)

        # 检查是否丢弃消息
        if temp_message is DropMessage or isinstance(temp_message, DropMessage):
            event_logger.info(MessageDroppedEvent(...))
            future.set_exception(MessageDroppedException())
            return

        # 更新消息
        message_envelope.message = temp_message
```

**特点：**
- 支持链式拦截器
- 可以修改消息内容
- 可以丢弃消息 (DropMessage)
- 支持异常处理

## 八、完整消息流程示例

### 8.1 点对点消息 (send_message)

```
[调用者]
    ↓ send_message(msg, recipient)
    ↓ 创建 SendMessageEnvelope
    ↓ await _message_queue.put(envelope)
    ↓ await future (阻塞等待)
         ↓
[消息循环: _process_next]
    ↓ message_envelope = await _message_queue.get()
    ↓ 应用拦截器
    ↓ asyncio.create_task(_process_send(envelope))
         ↓
[_process_send]
    ↓ recipient_agent = await _get_agent(recipient)
    ↓ response = await recipient_agent.on_message(msg, ctx)
    ↓ await _message_queue.put(ResponseMessageEnvelope(response, future, ...))
    ↓ _message_queue.task_done()
         ↓
[消息循环: _process_next]
    ↓ message_envelope = await _message_queue.get()
    ↓ 应用拦截器
    ↓ asyncio.create_task(_process_response(envelope))
         ↓
[_process_response]
    ↓ future.set_result(response)
    ↓ _message_queue.task_done()
         ↓
[调用者]
    ↓ future 完成，返回 response
```

### 8.2 发布订阅 (publish_message)

```
[发布者]
    ↓ publish_message(msg, topic_id)
    ↓ 创建 PublishMessageEnvelope
    ↓ await _message_queue.put(envelope)
    ↓ 立即返回
         ↓
[消息循环: _process_next]
    ↓ message_envelope = await _message_queue.get()
    ↓ 应用拦截器
    ↓ asyncio.create_task(_process_publish(envelope))
         ↓
[_process_publish]
    ↓ recipients = await _subscription_manager.get_subscribed_recipients(topic_id)
    ↓ for agent_id in recipients:
    ↓     agent = await _get_agent(agent_id)
    ↓     responses.append(_on_message(agent, msg, ctx))
    ↓ await asyncio.gather(*responses)  # 并发处理所有订阅者
    ↓ _message_queue.task_done()
```

## 九、关键设计模式和优化

### 9.1 设计模式

1. **生产者-消费者模式**: 消息队列解耦发送和处理
2. **观察者模式**: 发布订阅机制
3. **工厂模式**: Agent 懒加载创建
4. **责任链模式**: 拦截器链
5. **Future/Promise 模式**: 异步 RPC 实现

### 9.2 性能优化

1. **懒加载**: Agent 和订阅映射按需创建
2. **实例缓存**: 避免重复创建 Agent
3. **订阅缓存**: 主题到订阅者的映射缓存
4. **并发处理**: 使用 asyncio.gather 并发处理订阅者
5. **单线程异步**: 避免线程切换开销

### 9.3 限制和适用场景

**适用场景：**
- 开发和测试环境
- 独立应用程序
- 中小规模 Agent 系统

**不适用场景：**
- 高吞吐量场景
- 高并发场景
- 分布式系统（需要其他 Runtime 实现）

## 十、总结

`SingleThreadedAgentRuntime` 通过以下核心机制实现完整的消息发送和订阅系统：

1. **消息队列**: 使用 asyncio.Queue 实现 FIFO 消息缓冲
2. **消息信封**: 三种信封类型封装不同消息语义
3. **消息循环**: RunContext 持续从队列取消息并分发处理
4. **并发处理**: 每个消息在独立 Task 中处理，不阻塞队列
5. **订阅管理**: SubscriptionManager 维护主题到订阅者的映射
6. **懒加载**: Agent 按需创建和缓存
7. **RPC 支持**: 通过 Future 实现异步请求-响应模式
8. **拦截机制**: 支持消息处理前的拦截和修改
9. **异常处理**: 完善的异常捕获和传播机制
10. **生命周期**: 完整的启动、运行、停止流程管理

这种设计既保证了消息处理的顺序性和可靠性，又通过异步并发保证了系统的响应性能。