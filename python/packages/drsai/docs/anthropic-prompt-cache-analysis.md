# Anthropic Prompt Caching 与 `cache_control` 机制分析报告

## 1. 背景

本报告分析 DrSai 项目中 Anthropic 模型客户端的 prompt caching 支持情况，重点关注：

- `/home/xiongdb/drsai/python/packages/drsai/src/drsai/modules/components/model_client/anthropic/_anthropic_client.py`
- `HepAIAnthropicChatCompletionClient`
- 其父类 `autogen_ext.models.anthropic.AnthropicChatCompletionClient`
- Anthropic Python SDK 的 `AsyncAnthropic` / `messages.create`
- Anthropic 如何通过 `cache_control` 设置 prompt cache 断点
- 当前项目是否实际透传 `cache_control`
- 如何判断缓存创建与缓存命中

分析环境中 Anthropic SDK 版本为：

```text
anthropic 0.102.0
```

---

## 2. 关键结论

### 2.1 当前 DrSai 的 Anthropic client 没有真正启用 top-level `cache_control`

当前文件中定义了：

```python
class HepAIAnthropicChatCompletionClient(AnthropicChatCompletionClient):
```

并实现了一个：

```python
async def create_stream_tmp(...)
```

但是在项目源码中没有发现 `create_stream_tmp()` 的调用点。实际调用更多是：

```python
model_client.create_stream(...)
model_client.create(...)
```

因此当前 `create_stream_tmp()` 大概率不是主路径。

### 2.2 实际主路径走的是父类 `create()` / `create_stream()`

`HepAIAnthropicChatCompletionClient` 没有 override `create()` / `create_stream()`，因此实际会使用 autogen-ext 中的：

```python
BaseAnthropicChatCompletionClient.create()
BaseAnthropicChatCompletionClient.create_stream()
```

### 2.3 autogen-ext 当前白名单没有包含 `cache_control`

在环境中的 autogen-ext 文件：

```text
/home/xiongdb/miniconda3/envs/drsai_dev/lib/python3.12/site-packages/autogen_ext/models/anthropic/_anthropic_client.py
```

有如下参数白名单：

```python
anthropic_message_params = {
    "system",
    "messages",
    "max_tokens",
    "temperature",
    "top_p",
    "top_k",
    "stop_sequences",
    "tools",
    "tool_choice",
    "stream",
    "metadata",
}
```

这里没有：

```python
"cache_control"
```

因此初始化 client 时传入 `cache_control` 通常不会进入 `_create_args`。

### 2.4 Anthropic SDK 本身已经支持 `cache_control`

`AsyncAnthropic().messages.create` 的签名中包含：

```python
cache_control: Optional[CacheControlEphemeralParam] | Omit = omit
```

其结构为：

```python
class CacheControlEphemeralParam(TypedDict, total=False):
    type: Required[Literal["ephemeral"]]
    ttl: Literal["5m", "1h"]
```

典型写法：

```python
cache_control={"type": "ephemeral"}
```

或：

```python
cache_control={"type": "ephemeral", "ttl": "1h"}
```

### 2.5 当前 usage 统计没有暴露 cache hit 信息

Anthropic SDK 返回的 usage 包含：

```python
cache_creation_input_tokens
cache_read_input_tokens
input_tokens
output_tokens
```

但 AutoGen 的 `RequestUsage` 只有：

```python
prompt_tokens
completion_tokens
```

当前 DrSai 代码也没有读取：

```python
cache_creation_input_tokens
cache_read_input_tokens
```

因此即使 Anthropic 返回了缓存相关 usage，当前也不会显示缓存创建或命中情况。

---

## 3. Anthropic prompt caching 的基本机制

Anthropic 的 prompt caching 不是客户端本地缓存，也不是显式传入一个 `cache_key`。它采用的是“缓存断点”机制。

开发者在请求中的某个 cacheable block 上加入：

```json
"cache_control": {"type": "ephemeral"}
```

表示：

```text
从 prompt 开头到该 block 为止的前缀可以被缓存。
```

后续请求如果在 TTL 内复用完全相同的前缀，Anthropic 服务端就可能从 prompt cache 中读取这部分 tokens。

典型模式：

```text
[稳定 system prompt]
[稳定 tool definitions]
[稳定长文档 / repo context]   <-- cache_control breakpoint
[当前用户的新问题]
```

这样新问题可以变化，但前面大段稳定上下文可复用。

---

## 4. `cache_control` 的结构

Anthropic SDK 中 `CacheControlEphemeralParam` 定义如下：

```python
class CacheControlEphemeralParam(TypedDict, total=False):
    type: Required[Literal["ephemeral"]]

    ttl: Literal["5m", "1h"]
    """The time-to-live for the cache control breakpoint.

    - `5m`: 5 minutes
    - `1h`: 1 hour

    Defaults to `5m`.
    """
```

因此可用配置为：

```python
{"type": "ephemeral"}
```

默认 TTL 为 5 分钟。

也可以显式指定：

```python
{"type": "ephemeral", "ttl": "5m"}
```

或：

```python
{"type": "ephemeral", "ttl": "1h"}
```

---

## 5. `cache_control` 可以放在哪些位置

Anthropic SDK 支持多种位置设置 `cache_control`。

### 5.1 top-level request

`messages.create` 支持顶层参数：

```python
await client.messages.create(
    model="claude-sonnet-4-5",
    max_tokens=1024,
    messages=[...],
    cache_control={"type": "ephemeral", "ttl": "1h"},
)
```

SDK 注释说明：

```text
Top-level cache control automatically applies a cache_control marker to the last
cacheable block in the request.
```

即 top-level `cache_control` 会自动应用到请求中最后一个可缓存 block。

注意：如果最后一个可缓存 block 是“当前用户问题”，那么缓存前缀会包含当前问题。后续换问题时，命中率可能不高。

### 5.2 text block

`anthropic.types.TextBlockParam` 支持：

```python
class TextBlockParam(TypedDict, total=False):
    text: Required[str]
    type: Required[Literal["text"]]
    cache_control: Optional[CacheControlEphemeralParam]
```

示例：

```python
messages=[
    {
        "role": "user",
        "content": [
            {
                "type": "text",
                "text": long_context,
                "cache_control": {"type": "ephemeral", "ttl": "1h"},
            },
            {
                "type": "text",
                "text": "基于上面的上下文回答这个问题：...",
            },
        ],
    }
]
```

这是更可控的方式，适合将稳定上下文缓存，而不把最新问题放进缓存前缀。

### 5.3 system block

Anthropic 的 `system` 参数既可以是字符串，也可以是 text block 数组。

如果要缓存 system prompt，应该使用 block 数组：

```python
system=[
    {
        "type": "text",
        "text": stable_system_prompt,
        "cache_control": {"type": "ephemeral", "ttl": "1h"},
    }
]
```

而不是普通字符串：

```python
system="..."
```

### 5.4 tool 定义

`anthropic.types.ToolParam` 也支持：

```python
cache_control: Optional[CacheControlEphemeralParam]
```

示例：

```python
tools=[
    {
        "name": "my_tool",
        "description": "...",
        "input_schema": {...},
        "cache_control": {"type": "ephemeral", "ttl": "1h"},
    }
]
```

这适用于大量工具定义、很长 tool description、复杂 schema 等场景。

### 5.5 image/document/tool_result 等 block

SDK 类型中大量 block 均支持 `cache_control`，例如：

- `ImageBlockParam`
- `DocumentBlockParam`
- `ToolUseBlockParam`
- `ToolResultBlockParam`
- `SearchResultBlockParam`
- `WebSearchToolResultBlockParam`
- `WebFetchToolResultBlockParam`
- `CodeExecutionToolResultBlockParam`

因此缓存不局限于文本，也可以用于文档、图像、工具结果等输入块。

---

## 6. 当前 DrSai 文件中的 `create_stream_tmp()` 分析

文件：

```text
/home/xiongdb/drsai/python/packages/drsai/src/drsai/modules/components/model_client/anthropic/_anthropic_client.py
```

`create_stream_tmp()` 中首先复制并合并参数：

```python
create_args = self._create_args.copy()
create_args.update(extra_create_args)
```

然后构造请求参数：

```python
request_args: Dict[str, Any] = {
    "model": create_args["model"],
    "messages": anthropic_messages,
    "max_tokens": create_args.get("max_tokens", 4096),
    "temperature": create_args.get("temperature", 1.0),
    "stream": True,
}
```

随后加入 system：

```python
if system_message is not None:
    request_args["system"] = system_message
```

加入 tools：

```python
if len(tools) > 0:
    converted_tools = convert_tools(tools)
    self._last_used_tools = converted_tools
    request_args["tools"] = converted_tools
```

最后只透传以下 optional 参数：

```python
for param in ["top_p", "top_k", "stop_sequences", "metadata"]:
    if param in create_args:
        request_args[param] = create_args[param]
```

这里没有：

```python
"cache_control"
```

因此即使上层调用：

```python
extra_create_args={
    "cache_control": {"type": "ephemeral", "ttl": "1h"}
}
```

`cache_control` 只会进入 `create_args`，不会进入 `request_args`，最终不会传给：

```python
self._client.messages.create(**request_args)
```

---

## 7. 实际主路径的 autogen-ext `create()` / `create_stream()` 分析

由于项目中实际调用的是：

```python
model_client.create_stream(...)
model_client.create(...)
```

而当前子类没有 override 它们，因此会走父类实现。

父类 `create()` / `create_stream()` 中也只透传：

```python
for param in ["top_p", "top_k", "stop_sequences", "metadata"]:
    if param in create_args:
        request_args[param] = create_args[param]
```

同样没有 `cache_control`。

因此当前实际运行路径同样无法通过 top-level `cache_control` 设置 Anthropic prompt cache。

---

## 8. 如何判断 cache creation 和 cache hit

Anthropic SDK 的非流式返回 `result.usage` 包含：

```python
class Usage(BaseModel):
    cache_creation: Optional[CacheCreation] = None
    cache_creation_input_tokens: Optional[int] = None
    cache_read_input_tokens: Optional[int] = None
    input_tokens: int
    output_tokens: int
```

流式返回中的 `MessageDeltaUsage` 包含：

```python
class MessageDeltaUsage(BaseModel):
    cache_creation_input_tokens: Optional[int] = None
    cache_read_input_tokens: Optional[int] = None
    input_tokens: Optional[int] = None
    output_tokens: int
```

含义：

| 字段 | 含义 |
| --- | --- |
| `cache_creation_input_tokens` | 本次创建 cache entry 的输入 token 数 |
| `cache_read_input_tokens` | 本次从 cache 读取的输入 token 数 |
| `input_tokens` | 本次普通输入 token 数 |
| `output_tokens` | 输出 token 数 |

判断缓存命中的核心逻辑：

```python
cache_hit = (usage.cache_read_input_tokens or 0) > 0
```

典型表现：

第一次请求：

```text
cache_creation_input_tokens > 0
cache_read_input_tokens = 0
```

第二次请求，且缓存前缀完全一致：

```text
cache_read_input_tokens > 0
```

---

## 9. 当前 usage 统计的限制

当前 `create_stream_tmp()` 中只统计：

```python
input_tokens: int = 0
output_tokens: int = 0
```

在 `message_start` 中读取：

```python
if hasattr(chunk.message.usage, "input_tokens"):
    input_tokens = chunk.message.usage.input_tokens
if hasattr(chunk.message.usage, "output_tokens"):
    output_tokens = chunk.message.usage.output_tokens
```

在 `message_delta` 中读取：

```python
if hasattr(chunk, "usage") and hasattr(chunk.usage, "output_tokens"):
    output_tokens = chunk.usage.output_tokens
```

没有读取：

```python
cache_creation_input_tokens
cache_read_input_tokens
```

最终构造：

```python
usage = RequestUsage(
    prompt_tokens=input_tokens,
    completion_tokens=output_tokens,
)
```

而 AutoGen 的 `RequestUsage` 类型只有：

```python
prompt_tokens: int
completion_tokens: int
```

无法原生保存 Anthropic 的缓存字段。

因此如果要观测 cache hit，建议额外通过日志或自定义统计字段记录。

---

## 10. 最小修复方案

### 10.1 让子类覆盖 `create_stream()`

因为 `create_stream_tmp()` 当前没有被调用，最小修复之一是新增：

```python
async def create_stream(
    self,
    messages: Sequence[LLMMessage],
    *,
    tools: Sequence[Tool | ToolSchema] = [],
    json_output: Optional[bool | type[BaseModel]] = None,
    extra_create_args: Mapping[str, Any] = {},
    cancellation_token: Optional[CancellationToken] = None,
    max_consecutive_empty_chunk_tolerance: int = 0,
) -> AsyncGenerator[Union[str, CreateResult], None]:
    async for item in self.create_stream_tmp(
        messages=messages,
        tools=tools,
        json_output=json_output,
        extra_create_args=extra_create_args,
        cancellation_token=cancellation_token,
        max_consecutive_empty_chunk_tolerance=max_consecutive_empty_chunk_tolerance,
    ):
        yield item
```

这样项目中的：

```python
model_client.create_stream(...)
```

会走当前子类逻辑。

### 10.2 在 optional 参数透传列表中加入 `cache_control`

将：

```python
for param in ["top_p", "top_k", "stop_sequences", "metadata"]:
    if param in create_args:
        request_args[param] = create_args[param]
```

改为：

```python
for param in ["top_p", "top_k", "stop_sequences", "metadata", "cache_control"]:
    if param in create_args:
        request_args[param] = create_args[param]
```

这样调用：

```python
model_client.create_stream(
    messages=messages,
    extra_create_args={
        "cache_control": {"type": "ephemeral", "ttl": "1h"},
    },
)
```

就能把 `cache_control` 传到 Anthropic SDK。

### 10.3 采集 streaming cache usage

在流式处理前增加：

```python
cache_creation_input_tokens: int = 0
cache_read_input_tokens: int = 0
```

在 `message_start` 中：

```python
elif chunk.type == "message_start":
    if hasattr(chunk, "message") and hasattr(chunk.message, "usage"):
        usage_obj = chunk.message.usage

        if hasattr(usage_obj, "input_tokens"):
            input_tokens = usage_obj.input_tokens
        if hasattr(usage_obj, "output_tokens"):
            output_tokens = usage_obj.output_tokens

        if getattr(usage_obj, "cache_creation_input_tokens", None) is not None:
            cache_creation_input_tokens = usage_obj.cache_creation_input_tokens or 0

        if getattr(usage_obj, "cache_read_input_tokens", None) is not None:
            cache_read_input_tokens = usage_obj.cache_read_input_tokens or 0
```

在 `message_delta` 中：

```python
elif chunk.type == "message_delta":
    if hasattr(chunk.delta, "stop_reason") and chunk.delta.stop_reason:
        stop_reason = chunk.delta.stop_reason

    if hasattr(chunk, "usage"):
        usage_obj = chunk.usage

        if hasattr(usage_obj, "output_tokens"):
            output_tokens = usage_obj.output_tokens

        if getattr(usage_obj, "input_tokens", None) is not None:
            input_tokens = usage_obj.input_tokens or input_tokens

        if getattr(usage_obj, "cache_creation_input_tokens", None) is not None:
            cache_creation_input_tokens = usage_obj.cache_creation_input_tokens or 0

        if getattr(usage_obj, "cache_read_input_tokens", None) is not None:
            cache_read_input_tokens = usage_obj.cache_read_input_tokens or 0
```

最后增加日志：

```python
logger.info(
    "Anthropic prompt cache: creation=%s read=%s hit=%s",
    cache_creation_input_tokens,
    cache_read_input_tokens,
    cache_read_input_tokens > 0,
)
```

---

## 11. 非流式 `create()` 的修复建议

项目中也有多处调用：

```python
model_client.create(...)
```

如果这些路径也需要 prompt caching，需要 override `create()` 或 patch autogen-ext。

修复点同样包括：

1. request args 透传 `cache_control`
2. 读取 `result.usage.cache_creation_input_tokens`
3. 读取 `result.usage.cache_read_input_tokens`
4. 日志输出 cache hit

伪代码：

```python
cache_creation_input_tokens = result.usage.cache_creation_input_tokens or 0
cache_read_input_tokens = result.usage.cache_read_input_tokens or 0

logger.info(
    "Anthropic prompt cache: creation=%s read=%s hit=%s",
    cache_creation_input_tokens,
    cache_read_input_tokens,
    cache_read_input_tokens > 0,
)
```

---

## 12. 更完整的参数透传建议

Anthropic SDK 当前 `messages.create` 还支持不少参数：

- `cache_control`
- `container`
- `inference_geo`
- `output_config`
- `service_tier`
- `thinking`
- `tool_choice`
- `tools`
- `top_k`
- `top_p`

如果只想解决 prompt cache，最小加入：

```python
"cache_control"
```

如果希望保持与新版 Anthropic SDK 更一致，可以扩展为：

```python
for param in [
    "top_p",
    "top_k",
    "stop_sequences",
    "metadata",
    "cache_control",
    "container",
    "inference_geo",
    "output_config",
    "service_tier",
    "thinking",
    "tool_choice",
]:
    if param in create_args:
        request_args[param] = create_args[param]
```

注意：如果当前 `base_url` 指向第三方 Anthropic-compatible 服务，例如 Minimax、HepAI 网关等，对方未必支持所有参数。为降低兼容风险，建议第一阶段只透传 `cache_control`。

---

## 13. 如何启用缓存

### 13.1 每次调用时显式传入

```python
async for chunk in model_client.create_stream(
    messages=llm_messages,
    extra_create_args={
        "cache_control": {"type": "ephemeral", "ttl": "1h"},
    },
):
    ...
```

优点：控制精确。

缺点：项目中调用点较多，修改分散。

### 13.2 在 client 层默认开启

```python
if "cache_control" not in create_args:
    create_args["cache_control"] = {"type": "ephemeral", "ttl": "1h"}
```

优点：所有 Anthropic 请求自动启用。

缺点：可能对所有请求都打缓存断点，不一定合理；第三方 endpoint 可能不兼容。

### 13.3 通过配置项控制

建议新增类似配置：

```yaml
anthropic_cache_control:
  type: ephemeral
  ttl: 1h
```

然后在创建 `HepAIAnthropicChatCompletionClient` 时传入或存入 model_info，并在请求时读取：

```python
cache_control = create_args.get("cache_control")

if cache_control is None:
    cache_control = self._model_info.get("anthropic_cache_control")

if cache_control:
    request_args["cache_control"] = cache_control
```

这是较推荐的工程化方式。

---

## 14. 如何验证 `cache_control` 已发出

### 14.1 mock `_client.messages.create`

可以临时替换：

```python
async def fake_create(**kwargs):
    print(kwargs.keys())
    print(kwargs.get("cache_control"))
    ...
```

验证是否出现：

```python
"cache_control": {"type": "ephemeral", "ttl": "1h"}
```

### 14.2 加 debug log

在调用 `messages.create` 前加入：

```python
logger.info(
    "Anthropic request args keys: %s, cache_control=%s",
    list(request_args.keys()),
    request_args.get("cache_control"),
)
```

注意避免打印完整 `messages`，因为可能非常大且包含敏感内容。

---

## 15. 如何验证真的 cache hit

测试时需要两次请求使用完全相同的缓存前缀。

第一次请求预期：

```text
cache_creation_input_tokens > 0
cache_read_input_tokens = 0
```

第二次请求预期：

```text
cache_read_input_tokens > 0
```

判断逻辑：

```python
cache_hit = cache_read_input_tokens > 0
```

如果第二次仍未命中，常见原因包括：

1. 请求前缀没有完全一致。
2. cache marker 放在了最新用户问题之后，导致不同问题无法命中。
3. prompt 太短，不满足 Anthropic 的缓存最低 token 阈值。
4. 模型不同。
5. TTL 过期。
6. `base_url` 指向第三方服务，该服务不支持 Anthropic prompt caching。
7. `cache_control` 没有实际透传到 SDK。
8. system/tools/messages 的 block 结构发生变化，即使文本相同也可能影响缓存。

---

## 16. 推荐实践

### 16.1 优先缓存稳定的大块内容

适合缓存：

- 长 system prompt
- 大量 tool definitions
- 长文档
- repo context
- RAG 检索出的稳定文档块
- 会话开头长期不变的大段历史

不适合放进缓存断点前：

- 每次变化的最新用户问题
- 时间戳
- 随机 nonce
- 动态 metadata
- 每轮都会变化的工具结果

### 16.2 优先使用 block-level `cache_control`

虽然 top-level `cache_control` 最方便，但它自动作用于最后一个可缓存 block，可能不符合预期。

更推荐显式在稳定上下文 block 上设置：

```python
{
    "type": "text",
    "text": stable_long_context,
    "cache_control": {"type": "ephemeral", "ttl": "1h"},
}
```

然后在后面追加最新问题。

### 16.3 保留 top-level `cache_control` 作为低成本启用方式

对于不方便改 message block 结构的路径，可以先通过 top-level `cache_control` 快速验证 prompt caching 是否可用。

---

## 17. 推荐实施路径

建议分三步实施：

### 第一步：让流式主路径支持 `cache_control`

- 在 `HepAIAnthropicChatCompletionClient` 中 override `create_stream()`。
- 复用或重命名当前 `create_stream_tmp()`。
- 在 optional 参数列表中加入 `cache_control`。
- 采集并日志输出 `cache_creation_input_tokens` / `cache_read_input_tokens`。

### 第二步：让非流式 `create()` 支持 `cache_control`

- override `create()` 或 patch autogen-ext。
- 同样透传 `cache_control`。
- 同样采集 cache usage。

### 第三步：设计配置开关

新增配置控制是否默认启用：

```yaml
anthropic_prompt_cache:
  enabled: true
  ttl: 1h
```

避免所有 endpoint 默认启用导致兼容性问题。

---

## 18. 参考 patch 片段

### 18.1 覆盖 `create_stream()`

```python
async def create_stream(
    self,
    messages: Sequence[LLMMessage],
    *,
    tools: Sequence[Tool | ToolSchema] = [],
    json_output: Optional[bool | type[BaseModel]] = None,
    extra_create_args: Mapping[str, Any] = {},
    cancellation_token: Optional[CancellationToken] = None,
    max_consecutive_empty_chunk_tolerance: int = 0,
) -> AsyncGenerator[Union[str, CreateResult], None]:
    async for item in self.create_stream_tmp(
        messages=messages,
        tools=tools,
        json_output=json_output,
        extra_create_args=extra_create_args,
        cancellation_token=cancellation_token,
        max_consecutive_empty_chunk_tolerance=max_consecutive_empty_chunk_tolerance,
    ):
        yield item
```

### 18.2 透传 `cache_control`

```python
for param in ["top_p", "top_k", "stop_sequences", "metadata", "cache_control"]:
    if param in create_args:
        request_args[param] = create_args[param]
```

### 18.3 采集 cache usage

```python
cache_creation_input_tokens: int = 0
cache_read_input_tokens: int = 0
```

在 stream event 中读取：

```python
if getattr(usage_obj, "cache_creation_input_tokens", None) is not None:
    cache_creation_input_tokens = usage_obj.cache_creation_input_tokens or 0

if getattr(usage_obj, "cache_read_input_tokens", None) is not None:
    cache_read_input_tokens = usage_obj.cache_read_input_tokens or 0
```

最终日志：

```python
logger.info(
    "Anthropic prompt cache: creation=%s read=%s hit=%s",
    cache_creation_input_tokens,
    cache_read_input_tokens,
    cache_read_input_tokens > 0,
)
```

---

## 19. 总结

当前 DrSai 项目中 Anthropic prompt caching 的状态可以概括为：

1. Anthropic Python SDK 已支持 `cache_control`。
2. `cache_control` 可以作为 top-level 参数，也可以放在 text/system/tool/document/image 等 block 上。
3. 当前 DrSai 的 `HepAIAnthropicChatCompletionClient.create_stream_tmp()` 没有透传 `cache_control`。
4. 更关键的是，`create_stream_tmp()` 当前没有被项目调用。
5. 实际主路径走父类 `create()` / `create_stream()`，而 autogen-ext 当前也没有透传 `cache_control`。
6. 当前 usage 统计没有读取 `cache_creation_input_tokens` / `cache_read_input_tokens`，无法判断缓存是否命中。
7. 最小修复是 override `create_stream()`，将 `cache_control` 加入 request args，并采集 cache usage。
8. 若要完整支持，还需要 override `create()` 或 patch autogen-ext。
9. 工程上建议增加配置开关，并优先使用 block-level cache marker 缓存稳定大上下文。
