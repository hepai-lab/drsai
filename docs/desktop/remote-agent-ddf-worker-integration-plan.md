# Desktop → HAI DDF → Remote Agent 联调与自动化验收方案

## 1. 文档信息

- 目标智能体：`drsai_v3_test`
- 开发平台：`https://ai-dev.ihep.ac.cn`
- DDF Base URL：`https://ai-dev.ihep.ac.cn/apiv2`
- Desktop 启动方式：`windows-desktop-dev.cmd`
- Desktop 代码库：`C:\Users\win11\VSProjects\drsai`
- HAI/DDF 维护任务：`019fa479-4136-7cf0-99b8-b55d7fc51be7`
- Worker 维护任务：`019fa9b0-bb86-7331-8812-ca9694eeca65`
- 文档状态：联调基线
- 最后更新：2026-07-29

## 2. 目标

实现并验证以下完整链路：

```text
Windows Desktop
  → https://ai-dev.ihep.ac.cn/apiv2/chat/completions
  → HAI DDF 鉴权、路由与流式转发
  → drsai_v3_test worker
  → HAI DDF 透明转发
  → Windows Desktop 解析与渲染
```

用户从智能体广场选择 `drsai_v3_test` 后，应自动看到该智能体提供的专属示例任务。发送消息后，Desktop 应实时展示连接状态、执行过程、步骤、工具活动、产物和最终回答。成功、失败和取消都必须形成明确终态，不能无限等待。

## 3. 非目标

本轮不包含：

- 重构 HAI 的通用模型路由架构。
- 为单一智能体在 Desktop 中写死专属逻辑或示例。
- 暴露 worker 私有配置、内部提示词、内部网络地址或模型思维链。
- 依赖人工观察作为唯一验收方式。
- 在生产环境 `ai.ihep.ac.cn` 上进行破坏性或故障注入测试。

## 4. 三端职责

### 4.1 Windows Desktop

负责：

- 从当前 `config.toml` 的 active platform 读取 `portal_url` 和 `base_url`。
- 使用 OIDC Bearer 获取远程智能体目录。
- 使用平台智能体 ID 作为 DDF 请求的 `model`。
- 发送稳定的 `thread_id`、`run_id` 和 `desktop_request_id`。
- 解析 HTTP 错误与 SSE 事件。
- 将事件映射为过程、步骤、工具、文件、最终文本和终态 UI。
- 对目录元数据进行安全缓存和本地化展示。
- 提供自动化解析器测试、路由测试和真实 UI 验收。

### 4.2 HAI/DDF

负责：

- OIDC 鉴权和用户权限判断。
- 返回远程智能体公开目录及展示元数据。
- 按 `model=drsai_v3_test` 选择正确 worker。
- 完整传递会话、运行和请求关联字段。
- 低延迟、无缓冲地转发 SSE。
- 在 worker 不可用、超时、执行失败时返回结构化错误。
- 支持客户端断开或取消向 worker 传播。
- 在日志中使用统一关联 ID，且不记录 Bearer、私有配置或敏感正文。

### 4.3 drsai_v3_test Worker

负责：

- 提供公开智能体元数据和专属示例任务。
- 将 `thread_id` 归一化为非空内部 `chat_id`。
- 按约定产生文本、状态、步骤、工具、文件、输入请求和终态事件。
- 保持同一会话的多轮连续性。
- 响应取消并停止后台执行。
- 把内部异常转换为结构化错误，不以无终态断流结束。
- 提供固定的黄金 SSE fixture 和 worker 单体测试。

## 5. 协议冻结

### 5.1 智能体目录

目录入口：

```http
GET {base_url}/agents/list_agents
Authorization: Bearer <OIDC token>
```

`drsai_v3_test` 的公开条目至少包含：

```json
{
  "id": "drsai_v3_test",
  "name": "DrSai BESIII",
  "description": "面向 BESIII 数据分析任务的远程智能体",
  "owner": "zdzhang@ihep.ac.cn",
  "available": true,
  "capabilities": [
    "chat",
    "streaming",
    "steps",
    "tools"
  ],
  "examples": [
    {
      "zh": "帮我分析这个 BESIII 物理过程，并给出分析步骤",
      "en": "Analyze this BESIII physics process and propose the analysis steps"
    }
  ],
  "updated_at": "2026-07-29T00:00:00Z"
}
```

目录约束：

- `id` 是 DDF 可路由的模型/worker 名称。
- `examples` 由智能体所有者维护，Desktop 不按 ID 写死。
- `examples` 最多 4 项；单语言文本建议不超过 500 字符。
- Desktop 有专属案例时只显示专属案例，不使用通用案例补足。
- Desktop 仅在没有任何有效专属案例时显示通用案例。
- 目录不得包含 worker URL、API key、Bearer、私有配置和系统提示词。

### 5.2 Chat 请求

```http
POST {base_url}/chat/completions
Authorization: Bearer <OIDC token>
Content-Type: application/json
Accept: text/event-stream
Idempotency-Key: desktop-chat-<desktop_request_id>
```

请求体：

```json
{
  "model": "drsai_v3_test",
  "stream": true,
  "thread_id": "desktop-thread-id",
  "run_id": "desktop-run-id",
  "messages": [
    {
      "role": "user",
      "content": "用户消息"
    }
  ],
  "attachments": [],
  "metadata": {
    "desktop_request_id": "desktop-request-id",
    "network_retry_attempt": 0,
    "resume_from_chars": 0
  }
}
```

约束：

- `model` 必须是远程智能体 ID，不能使用 Desktop 当前选择的普通 LLM。
- `thread_id` 在同一 Desktop 会话中保持稳定。
- `run_id` 每次执行唯一。
- `desktop_request_id` 每次用户发送唯一。
- DDF 和 worker 必须保留上述字段。
- Worker 优先使用 `thread_id` 作为 `chat_id`；兼容 `chat_id`、`conversation_id`；全部缺失时才生成。

### 5.3 SSE 通用规则

- 响应 `Content-Type` 必须为 `text/event-stream`。
- 每个事件以空行结束。
- UTF-8 编码。
- DDF 不得等待 worker 完成后一次性返回。
- DDF 可发送 `: ping` 心跳，Desktop 应忽略。
- 成功流必须以 `data: [DONE]` 结束。
- 失败流必须先发送结构化错误，再发送 `[DONE]` 并关闭。
- 相同逻辑步骤使用稳定 `id`，状态更新不能产生重复步骤。

### 5.4 最终文本

```text
data: {"choices":[{"delta":{"content":"正在处理"}}]}

data: {"choices":[{"delta":{"content":"，结果如下。"}}]}

data: [DONE]
```

### 5.5 用户可见的阶段说明

不传输模型私有思维链，仅发送适合用户阅读的过程摘要：

```text
event: agent.log
data: {"title":"分析任务","content":"已识别目标，正在制定执行步骤","level":"INFO","content_type":"reasoning"}
```

普通状态：

```text
event: agent.log
data: {"title":"加载上下文","content":"正在读取任务信息","level":"INFO","content_type":"status"}
```

### 5.6 步骤与工具事件

开始：

```text
event: tool.progress
data: {"id":"step-1","kind":"tool","title":"查询数据","status":"running","content":"正在查询相关数据"}
```

完成：

```text
event: tool.result
data: {"id":"step-1","kind":"tool_result","title":"查询数据","status":"completed","content":"查询完成"}
```

失败：

```text
event: tool.result
data: {"id":"step-1","kind":"tool_result","title":"查询数据","status":"failed","content":"查询失败"}
```

### 5.7 文件与产物

```text
data: {"file_events":[{"action":"artifact","path":"result.txt","name":"result.txt"}]}
```

公开路径必须是可供 Desktop 理解的逻辑路径或可下载引用，不得泄露 worker 宿主机敏感绝对路径。

### 5.8 用户输入请求

```text
event: agent.input_request
data: {"type":"input_request","input_type":"approval","prompt":"是否继续执行？"}
```

后续输入必须关联原 `thread_id`、`run_id` 和 input request ID。若 DDF 当前没有统一 continuation API，本功能在协议冻结时明确标记为暂缓，不允许 Desktop 展示一个无法提交的交互控件。

### 5.9 错误

SSE headers 尚未发送：

```json
{
  "error": {
    "code": "worker_execution_failed",
    "message": "远程智能体执行失败",
    "retryable": false,
    "request_id": "req-..."
  }
}
```

SSE 已开始：

```text
event: error
data: {"error":{"code":"worker_execution_failed","message":"远程智能体执行失败","retryable":false},"request_id":"req-..."}

data: [DONE]
```

推荐状态码：

| 场景 | HTTP | code | retryable |
|---|---:|---|---|
| 请求字段错误 | 400 | `invalid_request` | false |
| OIDC 失效 | 401 | `token_expired` | true |
| 无权限 | 403 | `forbidden` | false |
| 智能体不存在 | 404 | `agent_not_found` | false |
| 频率限制 | 429 | `rate_limited` | true |
| 没有可用 worker | 503 | `worker_unavailable` | true |
| worker 连接超时 | 503 | `upstream_timeout` | true |
| worker 执行异常 | 500 | `worker_execution_failed` | false |
| DDF 未知异常 | 500 | `internal_error` | false |

Desktop 不得把所有 500 当作网络中断重试。只对明确可恢复的状态进行可见、有界重试。

### 5.10 取消

- Desktop 取消后立即停止 loading，并进入 `aborted` 终态。
- DDF 应取消到 worker 的活动连接或调用统一 stop API。
- Worker 应停止实际后台执行，而不只是停止向客户端输出。
- 取消是正常终态，不记录为内部异常。
- 取消后到达的迟到事件必须被 Desktop 丢弃。

### 5.11 关联 ID

三端日志必须可以使用以下字段关联：

| 字段 | 产生方 | 生命周期 |
|---|---|---|
| `desktop_request_id` | Desktop | 单次发送 |
| `thread_id` | Desktop | 多轮会话 |
| `run_id` | Desktop | 单次执行 |
| DDF `request_id` | DDF | 单次 HTTP/转发 |
| `chat_id` | Worker | 应等于或映射自 `thread_id` |
| worker invoke ID | DDF/Worker | 单次 worker 调用 |

任何端都不得在日志中输出完整 Bearer 或私有配置。

## 6. 联调功能点

本轮共验收 20 个功能点。

### F01 平台配置选择

- Development 使用 `ai-dev.ihep.ac.cn/apiv2`。
- Production 使用生产地址。
- 验收：Desktop 启动日志和实际请求 host 与 active platform 一致。

### F02 OIDC 鉴权

- 目录和聊天均携带有效 Bearer。
- 401 token expired 最多刷新并重试一次。
- 验收：正常请求成功；失效 token 不形成无限循环。

### F03 远程智能体目录

- `list_agents` 返回 `drsai_v3_test`。
- Desktop 使用稳定公开 ID `platform:drsai_v3_test`。
- 验收：刷新智能体广场后条目存在且不重复。

### F04 智能体公开元数据

- 名称、说明、owner、能力、可用状态正确。
- 私有字段不会进入 renderer 和缓存。
- 验收：DTO/缓存安全测试。

### F05 专属示例任务

- Desktop 自动加载 `examples`。
- 有专属案例时不混入通用案例。
- 切换智能体时案例同步切换。
- 验收：目录 fixture、renderer 测试和真实 UI 截图。

### F06 正确路由模型

- 请求 `model=drsai_v3_test`。
- 不受普通模型选择器影响。
- 验收：Desktop E2E 捕获请求体；DDF RML 日志一致。

### F07 会话 ID 映射

- `thread_id` 在 worker 内成为非空 `chat_id`。
- 验收：不再出现 `taskdb.chat_id NOT NULL`；多轮复用同一 ID。

### F08 请求字段透传

- `thread_id`、`run_id`、`messages`、`metadata` 完整到达 worker。
- 验收：三端脱敏 capture 对比。

### F09 流式首包

- Worker 首事件通过 DDF 尽快到达 Desktop。
- 建议 DDF 转发延迟低于 200ms，不包含 worker 自身首包耗时。
- 验收：带时间戳的三端事件 capture。

### F10 最终文本增量

- Desktop 按增量展示文本，不重复、不缺字、不乱码。
- 验收：中文、英文、跨 chunk UTF-8 fixture。

### F11 过程状态

- `agent.log/status` 显示在过程区域。
- 验收：至少包含开始、处理中两个不同状态。

### F12 阶段说明

- 用户可见 reasoning 摘要单独展示。
- 不展示私有思维链。
- 验收：内容类型映射和 UI 测试。

### F13 步骤生命周期

- 相同步骤从 `running` 更新为 `completed` 或 `failed`。
- 验收：稳定 ID、无重复卡片、顺序正确。

### F14 工具活动

- 工具名称、状态和安全摘要可见。
- 验收：工具开始、结果、失败三个 fixture。

### F15 文件和产物

- 产物以文件/产物卡片展示。
- 验收：合法路径展示；敏感绝对路径被拒绝或脱敏。

### F16 成功终态

- `[DONE]` 映射为 Desktop `done`。
- loading 停止，线程状态回到 idle。
- 验收：成功后没有活动请求残留。

### F17 结构化错误

- HTTP 和流内错误都能显示服务端 message 和 request ID。
- loading 立即结束。
- 验收：500、503、断流三类故障注入。

### F18 有界恢复

- 仅 retryable 错误进行重试。
- 用户可看到重试状态。
- 超过策略后明确失败。
- 验收：次数、退避和终态断言。

### F19 用户取消

- Desktop、DDF、worker 均停止。
- 验收：取消传播、后台无继续执行、迟到事件不渲染。

### F20 多轮与幂等

- 同一 thread 第二轮保持上下文。
- 相同 Idempotency-Key 不产生重复执行。
- 验收：两轮对话和重复提交测试。

## 7. 自动化测试架构

自动化测试分五层。低层失败时不继续高层，避免跨系统噪声掩盖根因。

### L1：纯函数与 Schema 测试

运行位置：各自代码库。

覆盖：

- 目录 DTO 验证和脱敏。
- `examples` 本地化、过滤、上限与 fallback。
- `thread_id → chat_id`。
- SSE frame 编码与解析。
- 错误分类。
- UTF-8 分块。
- 工具/文件事件归一化。

要求：

- 不依赖网络。
- 每次提交执行。
- 固定 fixture，失败可复现。

### L2：单服务组件测试

#### Worker

- 直接调用 chat entry point。
- 收集完整 SSE。
- 与黄金 fixture 的 schema 和事件顺序比较。
- 覆盖成功、失败、取消、多轮。

#### DDF

- 使用假 worker server。
- 验证请求字段、路由、SSE 透明转发、错误映射和取消。
- 对每个输入 frame 断言转发 frame，不允许缓冲到结束。

#### Desktop

- 使用本地假 DDF server。
- 验证鉴权刷新、请求体、SSE 到 Desktop event 的映射和终态。
- 复用 `windows/scripts/verify-agent-cloud-route-e2e.mjs` 扩充场景。

### L3：协议契约测试

三端共享版本化 fixture：

```text
fixtures/remote-agent/
  catalog.success.json
  catalog.localized-examples.json
  request.success.json
  stream.success.sse
  stream.steps-tools.sse
  stream.file.sse
  stream.error.sse
  http.worker-unavailable.json
```

契约测试检查：

- 必填字段。
- 枚举值。
- 最大长度。
- 未知字段兼容策略。
- 敏感字段禁止清单。
- 事件顺序和终态。

fixture 变更必须显式 review，不能由测试运行时自动覆盖。

### L4：开发环境端到端测试

使用真实：

- Desktop OIDC token。
- `ai-dev.ihep.ac.cn/apiv2`。
- `drsai_v3_test` worker。

测试程序发送唯一关联 ID，等待有限时间并生成脱敏报告：

```json
{
  "desktop_request_id": "...",
  "thread_id": "...",
  "run_id": "...",
  "ddf_request_id": "...",
  "events": [],
  "first_event_ms": 0,
  "total_ms": 0,
  "terminal_state": "done"
}
```

不得把 Bearer 写入报告。

### L5：真实 Windows UI 验收

启动：

```powershell
.\windows-desktop-dev.cmd
```

可使用 Computer Use 操作，但断言应优先依赖可查询 DOM、IPC 事件和诊断日志。截图作为补充证据。

验证：

- 智能体广场正确显示 agent。
- 专属案例卡片加载。
- 点击案例填充输入框但不自动发送。
- 发送后过程逐步出现。
- 最终回答流式显示。
- 成功后 loading 停止。
- 失败显示错误卡片和 request ID。
- 取消后 UI 进入终态。

## 8. 自动化测试用例矩阵

| ID | 场景 | 层级 | 预期 |
|---|---|---|---|
| T01 | development 配置 | L1/L2 | 请求 ai-dev base URL |
| T02 | 目录正常 | L2/L4 | 返回唯一 `drsai_v3_test` |
| T03 | 目录含专属案例 | L1/L3/L5 | 只显示专属案例 |
| T04 | 目录无案例 | L1/L5 | 显示通用案例 |
| T05 | 中英文案例 | L1/L5 | 按 UI 语言选择 |
| T06 | 目录缓存 | L2/L5 | 离线时显示安全缓存 |
| T07 | OIDC token 正常 | L2/L4 | 目录和 chat 成功 |
| T08 | token expired | L2 | 刷新一次后成功 |
| T09 | token 无效 | L2 | 明确 error，不循环 |
| T10 | 普通模型选择器干扰 | L2 | body 仍为 `drsai_v3_test` |
| T11 | thread_id 映射 | L1/L4 | worker chat_id 非空且一致 |
| T12 | 简单文本流 | L1-L5 | 文本增量且 done |
| T13 | 中文拆包 | L1/L2 | 无乱码、无丢字 |
| T14 | 多 frame 合包 | L1/L2 | 全部解析 |
| T15 | 单 frame 拆包 | L1/L2 | 重组后解析 |
| T16 | agent.log status | L1/L5 | 过程状态展示 |
| T17 | reasoning 摘要 | L1/L5 | 阶段说明展示 |
| T18 | 工具开始/完成 | L1/L5 | 同一卡片更新 |
| T19 | 工具失败 | L1/L5 | 步骤 failed，运行有终态 |
| T20 | 文件产物 | L1/L5 | 产物卡片展示 |
| T21 | 成功 `[DONE]` | L1-L5 | loading 停止 |
| T22 | HTTP 400 | L2 | 立即显示请求错误 |
| T23 | HTTP 401 | L2 | 按 token 语义处理 |
| T24 | HTTP 500 | L2 | 不作为网络中断长重试 |
| T25 | HTTP 503 retryable | L2/L4 | 可见、有界重试 |
| T26 | SSE 中途 error | L1/L2 | 保留已有输出并失败 |
| T27 | 无 `[DONE]` 断流 | L2 | 有界恢复后明确失败 |
| T28 | worker 无候选 | L2/L4 | `worker_unavailable` |
| T29 | worker 超时 | L2/L4 | `upstream_timeout` |
| T30 | 用户取消 | L2/L4/L5 | 三端停止、aborted |
| T31 | 取消后迟到事件 | L1/L2 | Desktop 丢弃 |
| T32 | 同会话第二轮 | L2/L4/L5 | 上下文连续 |
| T33 | 重复 Idempotency-Key | L2/L4 | 不重复执行 |
| T34 | 日志关联 | L4 | 三端 ID 可串联 |
| T35 | 敏感字段 | L1-L4 | 不进入 DTO、缓存、日志 |

## 9. 标准联调任务

### 9.1 Smoke

```text
请简单介绍你自己，并列出你处理这个问题的两个步骤。
```

必须产生：

- 至少一个状态事件。
- 至少两个步骤或工具时间线事件。
- 至少两个文本增量。
- 一个明确 `[DONE]`。

### 9.2 BESIII 专属任务

从 worker 提供的 `examples` 中选择一个真实、低成本、无破坏性的案例。该案例既是用户入口，也是能力验收用例。

必须产生：

- 可理解的阶段说明。
- 稳定步骤 ID。
- 最终结论。
- 若缺少材料，明确请求材料或说明限制，不能无限等待。

### 9.3 多轮

第一轮要求生成分析步骤；第二轮要求修改其中一步。验证同一 `thread_id/chat_id` 的上下文连续性。

### 9.4 取消

使用一个可稳定执行超过数秒的测试任务，在出现首个过程事件后取消。验证三端终止。

## 10. 故障注入

故障注入只在自动化假服务或 development 环境执行。

| 注入点 | 故障 | 预期 |
|---|---|---|
| Desktop 假 DDF | 401 token expired | 刷新一次 |
| Desktop 假 DDF | 500 JSON | 立即失败并显示 message |
| Desktop 假 DDF | 503 retryable | 有界重试 |
| Desktop 假 DDF | SSE 半帧断开 | 重组或恢复 |
| DDF 假 worker | ConnectTimeout | 503 `upstream_timeout` |
| DDF 假 worker | 无候选 | 503 `worker_unavailable` |
| DDF 假 worker | 流中异常 | error + `[DONE]` |
| Worker 测试入口 | 空 thread/chat ID | 生成 ID 或受控拒绝 |
| Worker 测试入口 | DB 异常 | 结构化失败终态 |
| 全链路 | 用户取消 | 后台执行停止 |

## 11. 性能和稳定性门槛

- DDF 单帧转发附加延迟：开发环境建议 P95 < 200ms。
- Desktop 收到 frame 到 UI event：本地建议 P95 < 100ms。
- 成功流不得等待完整回答后才首屏显示。
- 明确不可重试的错误：收到响应后 1 秒内进入 error UI。
- 自动重试必须有最大次数或最大恢复窗口。
- 测试结束后 Desktop、DDF、worker 不得残留对应活动 run。
- 连续执行 20 次 smoke，成功率应为 100%；若外部依赖不稳定，必须按结构化错误结束，不能悬挂。

## 12. 安全验收

- Bearer 在日志中脱敏。
- Desktop renderer 不获得 worker 私有配置。
- 公开目录不包含 worker 内网 URL。
- error 的 `original_error` 不直接暴露内部堆栈。
- 文件事件不暴露敏感宿主机绝对路径。
- 示例任务不包含系统提示词或凭据。
- 缓存只保存公开目录 DTO。
- 诊断包默认脱敏，原始消息正文仅在用户明确选择时包含。

## 13. 执行顺序与门禁

### Gate A：目录合同

完成条件：

- DDF 返回公开元数据和 `examples`。
- Desktop DTO、缓存和 UI 测试通过。
- 智能体切换行为通过。

### Gate B：Worker 黄金流

完成条件：

- Worker 提供成功、步骤工具、失败三份 SSE fixture。
- Worker 单测覆盖会话 ID、终态和取消。

### Gate C：DDF 透明转发

完成条件：

- 假 worker 契约测试通过。
- 错误状态码和 SSE error 合同通过。
- 无响应缓冲。

### Gate D：Desktop 解析

完成条件：

- 黄金 fixture 全部解析。
- UI event 顺序、去重、错误和终态断言通过。

### Gate E：真实开发环境

完成条件：

- 同一个关联 ID 的三端证据齐全。
- Smoke、专属案例、多轮、错误和取消通过。

### Gate F：回归

完成条件：

- 所有新增自动化测试加入日常验证命令。
- 20 次 smoke 无悬挂。
- 形成脱敏验收报告。

任何 Gate 未通过，不进入依赖它的下一 Gate。

## 14. 交付物

- 本联调方案。
- 冻结的目录、请求、SSE 和错误 schema。
- Worker 黄金 SSE fixtures。
- Worker 单元/组件测试。
- DDF 假 worker 转发测试。
- Desktop SSE、路由、目录和 UI 测试。
- Development 全链路测试脚本。
- 脱敏的三端事件对照报告。
- Windows UI 截图或录像。
- 已知限制与延期功能清单。

## 15. 最终验收清单

- [x] active platform 为 development 时只访问 ai-dev。
- [x] 智能体广场列出唯一且正确的 `drsai_v3_test`。
- [x] 专属示例由目录自动加载。
- [x] 有专属示例时不混入通用示例。
- [x] 点击示例只填充，不自动发送。
- [x] 请求 model 为 `drsai_v3_test`。
- [x] thread/run/request ID 三端一致可追踪。
- [x] worker chat_id 非空且多轮稳定。
- [x] 最终文本实时增量显示。
- [x] 状态、阶段和步骤正确展示。
- [x] 工具状态原位更新、不重复。
- [x] 文件和产物安全展示。
- [x] 成功后 loading 停止。
- [x] 失败后显示结构化错误和 request ID。
- [x] 不可重试 500 不长时间等待。
- [x] retryable 错误有界且可见。
- [x] 断流不会伪装成成功。
- [x] 取消传播到 worker。
- [x] 取消后不渲染迟到事件。
- [x] 同会话第二轮保持上下文。
- [x] 重复请求不产生重复执行。
- [x] 目录、缓存、日志和诊断中无敏感信息。
- [x] 自动化测试覆盖 T01-T35。
- [x] 20 次 smoke 无悬挂。

全部勾选后，`drsai_v3_test` 的 Desktop → DDF → Worker 联调才可标记为完成。
