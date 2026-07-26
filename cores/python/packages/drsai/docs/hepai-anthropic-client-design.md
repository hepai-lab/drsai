# HepAI Anthropic Client：流式 + Prompt Cache 设计报告

> 对应实现：[`cores/python/packages/drsai/src/drsai/modules/components/model_client/anthropic/_anthropic_client.py`](../src/drsai/modules/components/model_client/anthropic/_anthropic_client.py)
>
> 配套测试：
> - 单元 + 集成：[`test/tests/test_hepai_anthropic_cache_control.py`](../../../../../test/tests/test_hepai_anthropic_cache_control.py)
> - 端到端流式：[`test/tests/test_hepai_anthropic_client.py`](../../../../../test/tests/test_hepai_anthropic_client.py)
> - 多轮 rolling 缓存：[`test/tests/test_hepai_rolling_cache.py`](../../../../../test/tests/test_hepai_rolling_cache.py)
> - 原始 SSE 探针：[`test/tests/test_async_anthropic_raw.py`](../../../../../test/tests/test_async_anthropic_raw.py)

---

## 1. 背景

`HepAIAnthropicChatCompletionClient` 继承自 `autogen_ext.models.anthropic.AnthropicChatCompletionClient`，
对接的不是真实的 Anthropic 端点，而是 HepAI 内部网关（默认 `https://aiapi.ihep.ac.cn/apiv2/anthropic`），
后端代理到 AWS Bedrock 的 Claude 模型（`anthropic/claude-sonnet-4-6`、`anthropic/claude-opus-4-7` 等）。

实测中陆续暴露了三个相互交织的问题，本报告记录每一个问题的根因、修复方案、
以及未来仍需要继续优化的点。

---

## 2. 三个已修复的核心问题

### 2.1 流式 SSE 全部丢失：HepAI 的 `message_metrics` envelope

#### 现象

`create_stream` 返回的 `CreateResult.content` 始终为空字符串；服务端日志却显示完整回复。

#### 根因

HepAI 网关把上游 Anthropic 的 SSE event 用非标准的 envelope 包裹后再下发：

```
event: message_metrics                       ← 永远是这个名字
data:  {"event": "<真实类型>", "data": {<真实 Anthropic 负载>}}
```

而 anthropic Python SDK 的 `_streaming.py` 用 `sse.event == "message_start"`、
`sse.event == "content_block_delta"` 等做派发，遇到 `message_metrics` 全部失配 →
SDK 的 `async for chunk in stream:` 直接空跑结束 → `text_content=[]` →
最终 `content=""`。

#### 修复

`_stream_sse_via_httpx()` 复用 anthropic SDK 自己的 HTTP 基础设施获取 `httpx.Response`，
然后用 SDK 自带的 `SSEDecoder` 解析底层字节流，但**派发依据从 `sse.event` 改成 `sse.data` 解析后的 JSON**：

```python
raw_resp = await self._client.messages.with_raw_response.create(
    stream=True, extra_body=extra_body, **sdk_kwargs
)
http_response = raw_resp.http_response

from anthropic._streaming import SSEDecoder
async for sse in SSEDecoder().aiter_bytes(http_response.aiter_bytes()):
    raw = json.loads(sse.data)
    # envelope: {"event": "...", "data": {...真实负载...}}
    is_envelope = (
        "event" in raw and isinstance(raw.get("data"), dict)
        and raw["data"].get("type") == raw.get("event")
    )
    payload = raw["data"] if is_envelope else raw
    yield _to_attr_namespace(payload)
```

复用 SDK 的好处：
- 连接池、代理、超时、auth header、cancellation 全部由 SDK 接管
- `SSEDecoder` 正确处理跨 chunk 边界、多行 `data:`、注释行
- 未来 SDK 升级时无须我们跟着改 transport

#### 收敛策略

- `_gateway_uses_metrics_envelope()` 启发式：base_url 包含 `aiapi.ihep.ac.cn` 或 `/apiv2/anthropic`
  → 默认走自定义路径；第一次响应若 `content-type` 不是 SSE，则降级并永久缓存到实例属性 `_hepai_metrics_envelope_detected=False`。
- 若 envelope 不存在（直连真 Anthropic），首个 SSE event 的 `data` 不带 `event/data` 两层结构，
  自动识别并 fall back 到正常解包路径。
- 若整个 stream 一个事件都没收到，最终再 fall back 到非流式 `messages.create(stream=False)`
  作为最后兜底（见 `create_stream_tmp` 末尾的"empty events"分支）。

---

### 2.2 顶层 `cache_control` 被 Bedrock 静默吞掉

#### 现象

`model_info["anthropic_cache_control"] = {"type": "ephemeral", "ttl": "1h"}` 已配置，
但服务端 `usage.cache_creation_input_tokens` 始终为 0。

#### 根因

Anthropic SDK 接受顶层 `cache_control` 字段，文档说"automatically applies a cache_control marker
to the last cacheable block in the request"。**但 HepAI 网关后端走的是 Bedrock，Bedrock 不支持这个 shorthand**，
该字段被静默忽略。

直接对比（httpx 探针）：
- 顶层 `cache_control`：`cache_creation_input_tokens = 0` ❌
- 挂在 `system[0]` 上：`cache_creation_input_tokens = 24002` ✅

#### 修复

`_apply_cache_control_to_last_block()` 把 marker 直接挂到一个具体的 content block 上，
顶层字段从 `request_args` 中移除。详见 §3 的 marker 选位策略。

---

### 2.3 多轮对话的新增内容掉进默认 5 分钟桶

#### 现象（你最初看到的）

```
Turn 1: 1h_create=5953, 5m_create=0,    read=0
Turn 2: 1h_create=0,    5m_create=510,  read=5953
Turn 3: 1h_create=0,    5m_create=1621, read=5953   ← 永远停在 turn-1
Turn N: 1h_create=0,    5m_create=...,  read=5953
```

— 多轮对话的所有新增内容（user / assistant / tool_result）每轮都进 5m bucket，
然后被下一轮覆盖；1h read 量永远不增长。

#### 根因

之前的实现把 1h marker 挂到 `system[-1]`。Anthropic 服务端的行为是：
**对未显式标记的请求尾部新增内容，会自动用默认 5m TTL 创建一个 cache breakpoint**。
于是每轮请求实际有两个 cache prefix：

1. `system[-1]` 标的 1h prefix —— 跨轮 read，但不延长
2. 服务端自动加的 5m prefix —— 覆盖 user/assistant/tool_result，但每轮被冲掉

#### 修复：rolling marker（参考 claude-code）

[claude-code 的实现](https://github.com/anthropics/claude-code) `src/services/api/claude.ts:3063-3105` 注释里明确说：

> "Exactly one message-level cache_control marker per request"

它的做法是把 marker 挂到 `messages[messages.length - 1]`，**每轮都重新放到最新的 message 上**。
Anthropic 服务端会以这个 marker 为 cache prefix 的结尾，每轮该 prefix 自然延长——
旧前缀仍然是新前缀的一部分，所以 read 量随对话历史增长；新增内容用同一个 ttl 写入，
不再被默认 5m 桶接住。

实现位置：`_apply_cache_control_to_last_block()`，优先级从原来的 `system → tools → messages`
**倒过来** 为 `messages → tools → system`。

#### 实测验证（[test_hepai_rolling_cache.py](../../../../../test/tests/test_hepai_rolling_cache.py)）

| Turn | 1h_create | 5m_create | read    |
|------|-----------|-----------|---------|
| 1    | 36055     | **0**     | 0       |
| 2    | 77        | **0**     | 36055   |
| 3    | 74        | **0**     | 36132   |

5m bucket 全程归零，read 量随对话历史前移。这正是 claude-code 的高命中率表现。

---

## 3. Marker 选位策略详解

`_apply_cache_control_to_last_block(request_args, cache_control)` 按以下顺序找第一个可用目标块，
就近挂上 `cache_control` 后返回（in-place mutate）：

| 优先级 | 目标 | 理由 |
|--------|------|------|
| 1 | `request_args["messages"][-1].content[-1]` | rolling marker —— 每轮前移，让缓存 prefix 自然延长 |
| 2 | `request_args["tools"][-1]` | 没有 messages（仅工具校验等极端场景）时的稳定锚 |
| 3 | `request_args["system"][-1]` 文本块 | 二者都没有时最后兜底；必要时把 `system: str` 升级为 `[TextBlockParam]` |

附带规则：

- **强制 `type: ephemeral`**：传入 `cache_control` 若缺失或不等于 `ephemeral`，自动设为 `ephemeral`。
- **`ttl` 原样透传**：只接受 Anthropic 文档定义的 `"5m"` / `"1h"`，不做转换或回写。
- **无候选块**：静默返回，请求里就没有 cache 标记。
- **顶层字段一律不写**：避免 Bedrock 静默吞掉造成的"看似设置了 cache 但其实没生效"的假象。
- **`system: str` 自动升级**：仅在最终回退到 system 路径时把字符串升级为 `[{"type": "text", "text": ...}]`，
  正常情况下用户的 system 字符串原样保留。

---

## 4. 配置层（`run_drsai_agent_factory.py`）

```python
anthropic_cache_ttl = str(_resolve(
    cli_cfg, "anthropic_cache_ttl", "DRSAI_ANTHROPIC_CACHE_TTL",
    default="1h",
))
if anthropic_cache_ttl not in {"5m", "1h"}:
    anthropic_cache_ttl = "1h"

anthropic_cache_control = (
    {"type": "ephemeral", "ttl": anthropic_cache_ttl}
    if anthropic_cache_enabled else None
)
...
model_info["anthropic_cache_control"] = anthropic_cache_control
```

来源优先级（在 `create_stream_tmp` 里）：

```
create_args["cache_control"]           # extra_create_args 临时覆盖
  ↓ 否则
self._model_info["anthropic_cache_control"]   # 工厂时确定的全局默认
```

- `DRSAI_ANTHROPIC_CACHE_TTL=1h` 是默认值，亦可在 cli config 里覆盖。
- 个别调用想关掉 cache 时，传 `extra_create_args={"cache_control": None}` 即可（None 时跳过整段）。

每次实际生效的 ttl 会被打到 logger：

```
INFO Anthropic prompt cache: applying {'type': 'ephemeral', 'ttl': '1h'} ttl=1h (from model_info.anthropic_cache_control)
```

如果你看到日志显示 `ttl=5m` 但配置写的是 `1h`，说明：
1. cli_cfg 中显式覆盖了；或
2. 某个调用栈传了 `extra_create_args={"cache_control": {"ttl": "5m"}}`；或
3. 环境变量 `DRSAI_ANTHROPIC_CACHE_TTL=5m` 注入。

---

## 5. 缓存效果观测

服务端 SSE 中 `message_start` / `message_delta` 的 `usage` 是观察口子：

```json
"usage": {
  "input_tokens": 3,
  "cache_creation_input_tokens": 77,
  "cache_read_input_tokens": 36055,
  "cache_creation": {
    "ephemeral_5m_input_tokens": 0,
    "ephemeral_1h_input_tokens": 77
  },
  "output_tokens": 59
}
```

健康标志：

| 指标 | 期望 |
|------|------|
| `ephemeral_5m_input_tokens` | 持续为 0（不该有任何 5m 命中） |
| `ephemeral_1h_input_tokens` | 每轮 = 本轮"未命中前缀"的 token 数 |
| `cache_read_input_tokens` | 随对话历史单调增长 |
| `input_tokens` | 接近 1～几十（仅剩当前真正新增的非命中部分） |

实测中也观察到 `cache_read` 短时间内回到 0 的情况：Bedrock cache write→read
存在传播延迟（实测 >3s 仍偶有 read=0）。这是后端行为，不在客户端能控制范围。

---

## 6. 已知限制 / 未来优化

### 6.1 Tools 列表也很大时的双 marker 策略

**当前**：只在 `messages[-1]` 打一个 marker。

**问题**：如果工具 schema 总和很大（drsai 接入 MCP / 自定义工具后常见 >5k tokens），
工具列表本身已经稳定不变了，但每轮都参与 cache prefix 计算 —— 第一轮 cache_creation 会包含工具的 tokens，
后续 read 也会带着工具一起 hit。表面上没问题，但若工具列表偶尔增减（比如 `/agent` 切换、用户启停某个工具），
整段 prefix 就会失效。

**优化方向**（claude-code 的做法）：用 2 个 marker

1. 第一个 marker 挂在 `tools[-1]` —— 工具层 cache prefix（最稳定）
2. 第二个 marker 挂在 `messages[-1]` —— 对话层 rolling marker

这样工具一旦变动，只重写 tools 那段；对话历史仍然能复用工具的 cache prefix。

Anthropic 允许每请求最多 4 个 marker，所以双 marker 在配额内。

**实现成本**：低。`_apply_cache_control_to_last_block` 改成 `_apply_cache_control_breakpoints`，
传入策略 `"rolling" | "tools_and_rolling"`，根据 `request_args` 形状决定打几个。

### 6.2 子智能体 / 工作流切换时的 cache 失效追踪

DrSai 的 `_handle_default_subagent_mode`、`_execute_subagent` 路径会在同一 thread 内
切换 system prompt / tools，每次切换都让旧的 cache prefix 失效。

**优化方向**：
- 主子 agent 的 system prompt 拆成共享段 + 私有段，共享段挂第一个 marker、私有段挂第二个。
- 在 logger 里给每次 cache miss 加一个原因标签（system_changed / tools_changed / first_turn），
  便于线上观察缓存失效成本。

参考 claude-code 的 `promptCacheBreakDetection.ts` —— 它会对 system 数组做 hash，
检测出 cache 何时被打断、原因是 scope/TTL 翻转还是内容变化。

### 6.3 `service_tier` / `inference_geo` 等 Bedrock 特有字段

当前 `_stream_sse_via_httpx` 中的白名单 `_SDK_KWARGS` 包含了 `service_tier`，
但未来 Bedrock 可能加新字段（`output_config`、`container` 等）。
现在通过 `extra_body` 兜底（任何非白名单字段都进 `extra_body`），不会阻断升级，
但有可能掩盖问题（拼写错误也会被静默通过）。

**优化方向**：定期对照 [Anthropic SDK `messages.py`](../../../../../home/xiongdb/miniconda3/envs/drsai_dev/lib/python3.12/site-packages/anthropic/resources/messages/messages.py) 的
`_SDK_KWARGS` 更新名单；或在 DEBUG 日志里打印 `extra_body` 的 keys，便于发现意外字段。

### 6.4 cache write/read 量级监控

实测看到 cache write 在小请求（<1500 tokens）下经常不触发或只触发 5m bucket，
是因为 Anthropic 有最小阈值（sonnet 系列约 1024 tokens；opus 系列阈值更高）。

**优化方向**：
- 在 prompt token 数小于阈值时不打 marker（避免无谓的 marker 占用配额）。
- 给 `model_info` 加 `anthropic_cache_min_tokens` 配置，按模型分别设阈值。

### 6.5 `_jsonable` 的 pydantic 兼容性

当前 `_jsonable` 用 `model_dump(exclude_none=True)` 处理 pydantic v2，
`obj.dict()` 处理 v1，对 TypedDict 直接当 dict 处理。

**潜在风险**：autogen 升级后 message content 可能出现新的非 dict / 非 pydantic 类型
（dataclass、namedtuple、attrs class 等）。

**优化方向**：扩展 `_jsonable` 用 `attrs.asdict` / `dataclasses.asdict` 兜底，
并在 unknown 类型时打 warning 而不是直接交给 `json.dumps` 报错。

### 6.6 Anthropic SDK `_streaming.py` 的私有 import

```python
from anthropic._streaming import SSEDecoder  # private but stable
```

下划线开头的模块属于 SDK 私有 API，理论上不保证向后兼容。

**优化方向**：在 module import 时做一次性的 fallback 探测，如果 `SSEDecoder` 找不到就用我们自己写的简化版（参考早期版本 `_stream_sse_via_httpx` 中手写的 `aiter_lines` 解析）。也可以钉死 anthropic SDK 版本下界并加 CI 检查。

### 6.7 流式 fallback 后的 token 计数完整性

`create_stream_tmp` 末尾的"empty events"分支会在 stream 完全空时 fallback 到
`messages.create(stream=False)`。fallback 路径正确填充了 `content` / `usage` /
`finish_reason`，但**没有同步触发 `LLMStreamStartEvent` / `LLMStreamEndEvent`** —— 监控管线
看不到这次请求。

**优化方向**：fallback 路径里也按 stream 协议补发一次 Start/End event。

---

## 7. 测试矩阵

| 文件 | 覆盖范围 | 是否需要真实 API key |
|------|----------|----------------------|
| `test_hepai_anthropic_cache_control.py`（unit 部分） | `_apply_cache_control_to_last_block` 的优先级 / fallback / type 强制 | 否 |
| `test_hepai_anthropic_cache_control.py`（integration） | ttl=1h/5m 真实路由是否生效 | 是（需 `ANTHROPIC_TEST_CACHE_LIVE=1`） |
| `test_hepai_anthropic_client.py` | 流式 / 非流式两条路径都能拿到内容 | 是 |
| `test_hepai_rolling_cache.py` | 多轮对话 1h cache 命中率随历史增长 | 是 |
| `test_async_anthropic_raw.py` | 探针：gateway 是否返回 SSE、envelope 是否存在、原 SDK 能否解 | 是 |

跑全套：

```bash
# 不花钱
python test/tests/test_hepai_anthropic_cache_control.py

# 花钱（每轮约 0.4 RMB）
HEPAI_API_KEY=sk-xxx ANTHROPIC_TEST_CACHE_LIVE=1 \
    python test/tests/test_hepai_anthropic_cache_control.py
HEPAI_API_KEY=sk-xxx python test/tests/test_hepai_anthropic_client.py
HEPAI_API_KEY=sk-xxx python test/tests/test_hepai_rolling_cache.py
HEPAI_API_KEY=sk-xxx python test/tests/test_async_anthropic_raw.py
```

---

## 8. 参考

- 历史报告：[`anthropic-prompt-cache-analysis.md`](anthropic-prompt-cache-analysis.md) —— 修复前的状态分析（已过时但保留作为对比）
- Anthropic 官方文档：<https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching>
- claude-code 实现参考：`/home/xiongdb/work/claude-code/src/services/api/claude.ts`
  - `getCacheControl()`：ttl 选择策略
  - `addCacheBreakpoints()`：marker 放置策略
  - `userMessageToMessageParam()` / `assistantMessageToMessageParam()`：addCache 的具体注入
  - `promptCacheBreakDetection.ts`：缓存失效原因检测
- AWS Bedrock prompt caching 文档：<https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html>
