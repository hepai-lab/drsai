# OpenDrSai 回归测试 P2 开发方案

## 1. 文档定位

P2 的目标不是立即执行并放行此前定义的 12 项智能体任务回归，而是先解决它们共同依赖的模型基础：以 OpenDrSai 当前智能体 `my-drsai` 绑定的智增增 Provider 和 5 个模型为真实对象，建立可重复、可审计、可由正式 Runtime 使用的模型能力验证与按操作选路机制。

P2 完成后，OpenDrSai 应当能回答以下问题：

1. 智能体为文本推理、工具调用、图片理解、图片生成、语音合成和语音识别分别绑定了哪个精确模型？
2. 每个模型声明具备什么能力，哪些能力已经通过真实请求验证，哪些只是声明、未知或当前不可用？
3. 同一个 Provider 下，不同模型和不同操作应走 Responses、Chat Completions、Gemini `generateContent`，还是 OpenAI Audio 接口？
4. 正式 Agent Runtime 是否与能力探针使用同一模型引用、同一凭据解析和同一协议适配器？
5. 运行 12 项回归测试之前，模型基础是否满足执行条件；如果不满足，失败来自配置、凭据、协议、模型能力、Runtime 接入还是外部服务？

本方案承接 [OpenDrSai 智能体回归测试 P1 完成方案](opendrsai-agent-regression-testing-p1-completion-plan.md)。P1 已具备 Case、Suite、隔离环境、Gateway Adapter、证据、断言、结果和门禁框架；P2 不重写这些模块，而是补齐 P1 正式 Gateway 运行所缺少的模型能力基础。

## 2. 总体目标

### 2.1 业务目标

通过真实验证智增增 Provider 下 5 个已绑定模型的能力，确认 OpenDrSai 调用不同模型的统一方案，为下一阶段正式执行 12 项代表性回归测试提供可信、稳定、可诊断的模型底座。

当前目标模型与角色如下：

| 智能体角色 | Provider | 模型 | P2 必验能力 |
|---|---|---|---|
| 主模型 | `zhizengzeng` | `deepseek-v4-flash` | 文本生成、推理、结构化工具调用、工具结果续接 |
| 图片理解模型 | `zhizengzeng` | `gpt-5.6-luna` | Responses 文本/图片理解；同时确认结构化函数调用路由是否可用 |
| 图片生成模型 | `zhizengzeng` | `gemini-3.1-flash-lite-image` | 文生图、混合文本/图片响应，必要时为后续图片编辑预留 |
| 文字转语音模型 | `zhizengzeng` | `tts-1` | 文字转有效音频 |
| 语音转文字模型 | `zhizengzeng` | `whisper-1` | 真实音频转写 |

模型角色必须来自智能体模型策略，不得回退到一个产品级“全局默认模型”。Provider 级默认值只允许用于配置向导或显式的兼容迁移，不能在 Runtime 中静默覆盖智能体选择。

### 2.2 工程目标

- 建立“Provider → 模型 → 操作 → 协议”的操作级路由，而不是用单个 `wire_api` 代表模型的全部能力。
- 对 OpenAI 兼容的文本/Agent 模型优先探测和使用 Responses；仅在模型或 Provider 不支持时按明确策略回退 Chat Completions。
- 保留 Gemini 原生 `generateContent`，用于智增增明确要求 Google 协议的多模态与图片生成模型。
- TTS/STT 使用 Audio 专用接口，并复用智能体模型策略和 Provider 安全凭据，不再依赖无关的全局环境变量。
- 建立分层能力状态、结构化探针结果、不可变能力快照和失败分类。
- 让正式 Runtime、配置页测试、CLI 探针和回归预检复用相同的解析、路由、凭据和响应规范化代码。
- 在不泄露 Key、完整推理内容或大体积媒体的前提下保存足够的验收证据。

### 2.3 完成边界

P2 的完成定义是“五模型能力和 OpenDrSai 模型调用链验收通过”，不是“12 项任务回归已经通过”。P2 只为 12 项回归提供以下输入：

- 已验证的模型能力快照；
- 可复现的操作级路由快照；
- 正式 Runtime 的模型调用证据；
- 回归 Runner 可消费的模型预检结果；
- 清晰的环境失败与产品失败分类。

P2 不负责评价 HEPiX 搜索答案质量、PPTX 设计质量、审批安全行为或 Workspace 诊断质量；这些仍属于 12 项任务回归。

## 3. 研究结论与现状审计

### 3.1 智增增接口结论

根据智增增文档：

- 平台提供 `POST https://api.zhizengzeng.com/v1/responses`，但文档没有承诺所有代理模型、所有模态都支持 Responses。
- `deepseek-v4-flash` 明确支持 OpenAI Chat 接口，也可使用智增增的 Anthropic 兼容入口；它被描述为具有推理和 Agent 能力。
- Gemini 文本模型支持 OpenAI Chat 格式和 Google 原生格式。
- `gemini-3.1-flash-lite-image` 明确要求 Gemini 格式，通过 `generateContent` 并设置 `responseModalities: ["TEXT", "IMAGE"]`；不能把 `/images/generations` 作为唯一调用方式。
- `tts-1` 和 `whisper-1` 分别使用 `/v1/audio/speech` 和 `/v1/audio/transcriptions`，不应通过 Responses 或 Chat 探测。

因此，“Responses 优先”应当是操作级优先策略，而不是“全部模型一律 Responses”的硬编码假设。

参考资料：

- [智增增 Responses](https://doc.zhizengzeng.com/doc-7762827)
- [智增增模型和价格说明](https://doc.zhizengzeng.com/doc-3979947)
- [智增增 Gemini 函数调用](https://doc.zhizengzeng.com/doc-6882594)
- [智增增 Gemini 图片生成](https://doc.zhizengzeng.com/doc-6882629)
- [智增增 Audio](https://doc.zhizengzeng.com/doc-3989034)
- [智增增语音识别示例](https://doc.zhizengzeng.com/doc-3989697)
- [智增增思考模式说明](https://doc.zhizengzeng.com/doc-7823226)

### 3.2 OpenDrSai 当前可保留部分

- `AgentModelPolicy` 已能分别保存主模型、图片理解、图片生成、TTS 和 STT 模型引用。
- `ModelDescriptor` 已表达输入/输出模态、操作、推理级别、能力来源和置信度。
- Provider 配置已经支持 `base_url`、`anthropic_base_url`、`google_base_url`，且模型可声明 `api_protocol`。
- Provider 凭据已支持安全引用，公开结构只暴露是否存在和来源。
- P1 `GatewayRuntimeAdapter` 已坚持通过正式 Session/Run/Gateway 执行任务。
- OAEP、Run Inspection、Reproduction Manifest 和回归 Evidence 已能承载模型快照扩展。

### 3.3 需要完善的问题

1. `WireApi` 只有 `openai | anthropic | gemini`，无法区分 OpenAI Responses、Chat、Images 和 Audio，也无法表达同一模型针对不同操作使用不同协议。
2. `test_provider_connection()` 在 model 模式下把非 Anthropic/Gemini 模型统一发送到 `/chat/completions`，因此会错误测试图片生成、TTS 和 STT。
3. Gateway 没有 `/v1/responses`，正式 Agent 模型客户端仍以 Chat Completion 抽象为主。
4. `RuntimeImageOperationAdapter` 只接受 OpenAI 图片协议并固定调用 `/images/generations` 或 `/images/edits`，与智增增 Gemini 图片模型要求不一致。
5. 图片操作的模型解析仍读取兼容字段 `policy.image_model`，没有完整统一到 `image_generation_model`。
6. `/v1/audio/speech` 和 `/v1/audio/transcriptions` 从 `HEPAI_API_KEY`、`OPENAI_API_KEY`、`OPENAI_BASE_URL` 和 `OPENDRSAI_TTS_MODEL` 读取全局环境配置，没有使用智能体绑定模型及其 Provider 凭据。
7. 当前能力声明可由内置注册表或 TOML 提供，但没有独立的“真实验证结果”；声明变化可能被误当作已经验证。
8. 配置测试、正式 Runtime 和回归测试的调用路径不同，容易出现“连接测试通过、Agent Runtime 失败”。
9. 失败分类粒度不足，协议不支持、能力不支持、身份错误、Provider 拒绝和模型输出不合格可能都表现为笼统的上游失败。

### 3.4 需要移除或禁止的行为

- 移除 Runtime 对产品级全局默认模型的隐式依赖；运行模型以智能体策略为准。
- 移除音频代理对全局 `OPENAI_*`/`HEPAI_*` Key 和 `OPENDRSAI_TTS_MODEL` 的业务依赖；环境变量只保留显式兼容迁移，不得高于智能体策略优先级。
- 移除“所有 OpenAI 兼容模型都用 `/chat/completions` 探测”的逻辑。
- 移除“所有图片生成模型都用 `/images/generations`”的假设。
- 禁止探针成功后自动修改用户模型能力声明或切换智能体模型。
- 禁止将 HTTP 2xx、非空文本或非空字节直接等价为能力通过。
- 禁止把探针 fixture、Mock 或文档声明标记成 `verified`。
- 禁止持久化 API Key、Authorization Header、完整上游响应、完整思维链和非必要的原始音视频。

## 4. 总体解决方案

### 4.1 分层架构

```text
AgentModelPolicy
    ↓ 精确 ModelRef
Model Catalog + Declared Capabilities
    ↓ operation
Model Operation Router
    ├─ openai_responses
    ├─ openai_chat_completions
    ├─ gemini_generate_content
    ├─ openai_audio_speech
    └─ openai_audio_transcriptions
    ↓
Protocol Adapter + Shared Credential Resolver
    ↓
Normalized Model Result / Runtime Events / Artifacts
    ↓
Capability Probe Result + Capability Snapshot
    ↓
Regression Preflight → P1 GatewayRuntimeAdapter → 12 Cases
```

### 4.2 声明、验证与运行状态分离

每项能力必须分别记录：

- `declared`：来自智增增目录、用户配置或内置知识；
- `verified`：指定 Provider、模型、操作和协议经过真实探针；
- `runtime_verified`：通过正式 OpenDrSai Runtime 完成最小闭环；
- `unavailable`：凭据、配额、权限或网络当前不可用；
- `unsupported`：端点或模型明确拒绝该操作；
- `inconclusive`：请求完成但结果不足以证明能力；
- `stale`：Provider、模型目录、路由规则或探针版本变化后旧结果失效。

声明不能覆盖验证失败；一次外部环境失败也不能永久删除模型声明。

### 4.3 操作级路由

保留 Provider `wire_api` 作为旧配置的默认协议提示，但新增操作级候选路由。例如：

```yaml
model: deepseek-v4-flash
routes:
  chat:
    - protocol: openai_responses
      priority: 10
    - protocol: openai_chat_completions
      priority: 20
  tool_calling:
    - protocol: openai_responses
      priority: 10
    - protocol: openai_chat_completions
      priority: 20
  reasoning:
    - protocol: openai_responses
      priority: 10
    - protocol: openai_chat_completions
      priority: 20
```

路由选择遵守以下规则：

1. 只使用当前 AgentModelPolicy 指向的精确 `ModelRef`。
2. 候选路由必须与操作、输入输出模态和 Provider 地址匹配。
3. Responses 对 OpenAI 兼容文本/Agent 操作优先，但仅在探测成功或明确声明支持时启用。
4. 回退只允许发生在请求提交前可确定的“不支持”错误；超时或结果未知的有副作用请求不得自动跨协议重试。
5. 每个 Run 固化 route snapshot；运行中不得因探针刷新而切换协议。
6. 报告同时记录规范模型 ID、上游模型 ID、Provider、协议、操作和路由规则版本。

### 4.4 能力探针 API

新增 Gateway 内部管理接口，示意如下：

```text
POST /v1/config/model-providers/{provider_id}/capability-probes
GET  /v1/config/model-providers/{provider_id}/capability-probes/{probe_id}
GET  /v1/config/agents/{agent_id}/model-capability-status
```

请求只接受 Provider 中已配置的模型引用和允许的操作，不接受调用方提交明文 Key。探针通过 Gateway 内部凭据解析器使用现有安全凭据。

响应至少包含：

- `probe_id`、探针 schema/revision；
- `provider_id`、`model_id`、`upstream_model_id`；
- `operation`、`protocol`、路由来源；
- `status`、稳定错误码、HTTP 状态类别、是否可重试；
- 开始时间、耗时、请求/输出大小、费用风险标记；
- 经过裁剪和脱敏的确定性断言结果；
- Provider 配置 revision、模型目录 revision、Agent policy revision；
- `runtime_verified` 和证据引用。

## 5. 五模型能力测试设计

### 5.1 `deepseek-v4-flash`

#### 文本与 Responses 路由

- 首先调用 `/v1/responses` 执行固定文本任务；若端点或模型明确不支持，记录 `unsupported` 并测试 Chat 回退。
- 不能因 Responses 的 401、403、429、超时或网络错误自动认定 Chat 是永久首选。
- 通过标准：输出可解析，遵守固定格式，route snapshot 正确，凭据和模型引用来自 AgentModelPolicy。

#### 推理

- 使用结果确定、需要多步计算但规模很小的问题。
- 分别验证推理参数是否被接受、最终答案是否正确、是否提供可公开的推理摘要或对应使用量字段。
- 不把完整隐藏思维链作为验收要求或持久化证据。
- 通过标准：至少一个正式支持的推理模式通过；不支持的 effort 必须在调用前或由稳定上游错误明确拒绝。

#### 工具调用

- 提供无副作用的 `calculator_add(a, b)` 或隔离 Shell 工具，强制模型生成结构化调用。
- 校验工具名、参数 JSON、call ID、结束原因；执行工具后回传结果，要求模型生成最终答案。
- 再通过正式 Agent Runtime 执行一次隔离终端命令，确认模型调用、Tool Dispatcher、OAEP Tool Item 和最终答复闭环。
- 通过标准：不能用纯文本“我要调用工具”冒充结构化调用；逻辑调用一次，工具执行一次，最终答案正确，证据关联完整。

### 5.2 `gpt-5.6-luna`

#### 文本和候选协议

- 优先探测 Responses，并保留 OpenAI Chat 作为明确的兼容回退；不以一个协议成功推导其他协议成功。
- 文本能力至少有一个正式协议通过。

#### 图片理解

- 使用仓库内小型、确定性合成图：红色背景、中心蓝色圆形，并记录资产 SHA-256。
- 要求返回固定 JSON：背景色、中心色、形状。
- 先测试 Responses `input_image` 多模态格式，再测试 Chat `image_url` 兼容格式；按真实结果确定优先路由。
- 通过标准：三个字段全部正确；图片确实出现在上游请求的规范化证据中；正式 Runtime 使用 `image_understanding_model`，而不是错误复用主模型。

#### 函数调用

- 使用与主模型相同的无副作用函数 Schema，通过 Responses tools 验证结构化调用。
- 该结果用于确认图片理解角色的候选调用能力，不要求 P2 将 Luna 设置为主 Agent 模型。
- 函数调用必须锁定同一 Agent ModelRef、Provider、凭据和协议。它是 Provider 路由确认项，不是独立产品 Runtime；P2 Gate 要求真实 Provider 断言，但仅对图片理解 `chat` 要求正式 Runtime 图片闭环。

### 5.3 `gemini-3.1-flash-lite-image`

- 使用 Gemini `generateContent`，设置 `responseModalities: ["TEXT", "IMAGE"]`。
- 提示生成白色背景上的单一蓝色圆形，不包含文字，降低成本和主观性。
- 规范化解析 Gemini `parts` 中的文字和图片数据，发布为 OpenDrSai Artifact。
- 验证 MIME、可解码性、尺寸边界、像素上限、Artifact digest、模型/协议来源和取消语义。
- P2 不采用像素级黄金基准，只检查结构、可解码性、基本主题语义和证据完整性。
- 通过标准：正式 Runtime 使用 `image_generation_model` 生成一个有效图片 Artifact；不得调用 `/images/generations` 后把 403 误报为模型无权限。

### 5.4 `tts-1`

- 通过 `/v1/audio/speech` 合成固定短句 `OpenDrSai capability test 42`。
- 请求必须由 `text_to_speech_model` 解析 Provider、模型、Base URL 和凭据。
- 验证 HTTP 成功、MIME、容器头、可解码性、时长大于零、大小上限和模型路由快照。
- 原始音频只保存在受限临时结果目录，并按策略清理；机器报告只保存 digest、格式、时长和字节数。

### 5.5 `whisper-1`

- 将上一项生成的音频以 multipart 上传到 `/v1/audio/transcriptions`。
- 请求必须由 `speech_to_text_model` 解析，不允许调用通用 Chat 探针。
- 对结果做大小写、标点和空白规范化，断言包含 `OpenDrSai`、`capability test` 和 `42`。
- 通过标准：TTS→STT 闭环成功，并可分别定位合成失败、音频无效、转写失败和语义不匹配。

## 6. 模块、功能点、测试与验收

| ID | 模块与功能点 | 实现或更新 | 测试方案 | 验收标准 |
|---|---|---|---|---|
| P2-F01 | 协议与操作路由合同 | 新增操作级协议类型、候选路由、优先级、回退条件和 route snapshot；保留旧 `wire_api` 只作迁移输入 | Schema/数据类单测；未知协议、重复路由、模态冲突、非法回退反例 | 5 模型每项操作都有确定候选路由；同一模型可按操作使用不同协议；旧配置可读且不会静默改义 |
| P2-F02 | 统一模型与凭据解析 | 从 AgentModelPolicy 的精确 ModelRef 解析 Provider、上游 ID、协议地址和安全凭据；配置测试与 Runtime 共用 | DPAPI/环境引用/无 Key fixture；错误 Provider、缺凭据、revision 冲突；秘密扫描 | 探针、Agent、图像和音频使用同一解析器；公开结果及日志无 Key/Header |
| P2-F03 | Responses Adapter | 实现非流式/流式文本、推理、function tools、tool result 续接和错误规范化；Responses 优先但可明确回退 | 本地 HTTP fixture 覆盖文本、流、工具、推理、400/401/403/404/429/5xx、超时、畸形事件 | Flash 在智增增 Responses 成功则成为首选；不支持则有可审计 Chat 回退；不得因临时错误永久降级 |
| P2-F04 | Chat Completions Adapter 收敛 | 保留 Chat 兼容路径，规范化为与 Responses 相同的内部 ModelResult/ToolCall 结构 | Responses/Chat 等价契约测试；流式 tool delta 拼接；`reasoning_content` 脱敏/裁剪 | Agent 上层不依赖具体协议响应结构；Flash Chat 回退闭环可用 |
| P2-F05 | 多模态 Adapter | Responses/Chat 支持 Luna 图片输入；Gemini `generateContent` 支持图片输入、函数调用和混合 TEXT/IMAGE 输出 | Responses `input_image`、Chat `image_url` 与 Gemini fixture 覆盖；安全阻断、无图片、超大图片、错误响应 | `gpt-5.6-luna` 通过 Responses 图片理解；Lite Image 生成有效 Artifact；不再强制 OpenAI Images |
| P2-F06 | 图片 Runtime 重构 | `RuntimeImageOperationAdapter` 按路由分派 OpenAI Images 或 Gemini；统一使用 `image_generation_model`，仅兼容读取旧 `image_model` | 两协议契约测试；模型角色错误、取消、超时结果未知、Artifact 解码与限额 | 智增增 Lite Image 通过正式 Runtime；Run/Artifact 中固定模型与 route snapshot |
| P2-F07 | 音频 Runtime 重构 | TTS/STT 从 AgentModelPolicy 解析模型和凭据；拆出 Audio Adapter；保留 Gateway 产品接口 | multipart、格式、语言、大小、超时、空音频、无效容器、Provider 错误单测 | `tts-1` 与 `whisper-1` 分别通过，并完成闭环；不设置全局 `OPENAI_API_KEY` 也可运行 |
| P2-F08 | 能力探针服务 | 按 operation 运行最小真实请求；异步状态、超时、取消、费用标记、稳定错误码；不持久化秘密和大响应 | 各协议 fixture；并发、重复请求、取消、部分成功、Provider 限流；API 契约测试 | 单次运行能得到 5 模型完整矩阵；每项有终态且无“空白通过” |
| P2-F09 | 能力快照与失效 | 保存声明、探针验证、Runtime 验证、revision、route、时间和证据引用；配置/目录/探针版本变化后标 stale | canonical digest、原子写入、损坏恢复、revision 变化、并发写测试 | 同一输入产生稳定 digest；过期结果不会继续作为回归前提；历史结果不可被新规则改义 |
| P2-F10 | 正式 Runtime 闭环 | 主模型工具调用、图片理解、图片生成和音频均走正式 Gateway/Run；OAEP/Inspection/Manifest 写入模型路由与能力证据 | Fake Gateway 契约；真实 DEV E2E；模型成功但 Tool/Artifact 失败的分层反例 | 每种能力至少一个真实 Run/操作证据；配置测试通过但 Runtime 失败会使 P2 Gate 失败 |
| P2-F11 | 回归 Runner 预检接入 | P1 Runner 在执行 12 Case 前读取能力快照，按 Case required capability 映射模型角色；缺失时 fail closed | fixture 快照、stale、unsupported、unauthorized、角色未绑定、revision 不匹配 | Runner 能在花费任务调用前指出阻塞的模型/能力/协议；不把环境失败记为任务断言失败 |
| P2-F12 | CLI、Desktop 与报告 | 提供 `probe/list/show/model-runtime-verify/model-audio-runtime-verify`；Run 绑定必须从 Gateway 校验 completed Run、精确模型、Provider、operation 与安全 Manifest digest；音频绑定必须亲自执行正式 TTS→STT 产品闭环并只保存 operation evidence，禁止手改 Runtime 通过状态；Desktop 显示声明/已验证/Runtime 已验证与修复建议；输出 JSON/Markdown/JUnit | CLI 退出码、Windows 路径、Run/模型/操作不匹配、音频模型/语义不匹配、损坏 snapshot、Desktop IPC、错误文案、报告一致性、敏感信息扫描 | 开发者一条命令执行五模型矩阵；Run 与无 Run 的产品操作均可受控写回快照；UI 不显示秘密；报告可关联 probe ID、run/operation ID 和复现命令 |
| P2-F13 | 安全、成本与可靠性 | 每探针最大 token/字节/时长；低成本固定输入；媒体清理；副作用和未知结果不自动重试 | 限额、重试、429、超时、取消、重复提交、日志脱敏测试 | 默认完整矩阵成本有明确上限；无无限重试；图片生成未知结果不重复计费；秘密扫描零命中 |
| P2-F14 | P2 Gate | 声明五模型和必验能力、允许的协议回退、快照新鲜度、真实 Provider 与 Runtime 证据要求 | 缺模型、缺能力、fixture 冒充、stale、inconclusive、Runtime 未验证反例 | 所有必验项通过才放行 12 项回归；任何 fixture 或仅 declared 结果不能满足发布门禁 |

## 7. 测试分层

### 7.1 单元测试

- 路由选择与回退判定；
- 各协议请求构造和响应解析；
- ToolCall、reasoning、图片和音频结果规范化；
- 能力状态机、错误分类、快照 digest 与失效；
- 凭据脱敏、媒体边界和成本限制。

单元测试不得访问真实智增增服务。

### 7.2 本地协议契约测试

使用本地 HTTP fixture 模拟 Responses、Chat、Gemini 和 Audio 端点，覆盖正常、流式、畸形、限流、授权、超时和取消。fixture 只证明 OpenDrSai 适配器正确，结果必须标记 `adapter=fixture`，不能形成真实能力结论。

### 7.3 智增增真实能力测试

使用低额度专用账户和智能体已经绑定的安全凭据，运行五模型矩阵。机器证据只保留稳定错误码、模型/操作/协议、耗时、大小、断言摘要和 digest。真实探针必须显式标记可能产生费用。

### 7.4 正式 Runtime 集成测试

能力探针成功后，还必须通过正式 Runtime 验证：

- Flash 结构化工具调用与一次工具执行；
- Gemini 图片输入确实由图片理解模型处理；
- 图片生成由图片生成模型产生 Artifact；
- TTS/STT 使用各自角色模型完成闭环；
- OAEP、Inspection 和 Manifest 中的模型及路由证据一致。

### 7.5 回归预检契约测试

从 12 Case 中提取所需能力，至少建立以下映射：

| 回归能力 | P2 前置条件 |
|---|---|
| 普通问答、JSON、搜索、知识、Skill、Workspace、审批、运行比较 | 主模型 `chat` 通过 |
| Tool、Skill、搜索、Workspace、审批 | 主模型 `tool_calling` 和 Runtime tool loop 通过 |
| 需要高推理的诊断/比较 | 主模型 `reasoning` 通过或明确采用已验收的普通模式 |
| 截图理解 | 图片理解模型通过且 Runtime 路由正确 |
| 图片输出 | 图片生成模型通过且 Artifact 链路正确 |
| 未来语音案例 | TTS/STT 对应能力通过 |

P2 不改变 12 Case 的业务断言，只增加执行前模型前置条件。

## 8. 错误分类与用户可操作诊断

能力测试至少区分：

- `configuration_invalid`
- `agent_model_unbound`
- `credential_unavailable`
- `authentication_failed`
- `permission_denied`
- `quota_exceeded`
- `endpoint_not_found`
- `protocol_unsupported`
- `model_not_found`
- `operation_unsupported`
- `request_rejected`
- `provider_timeout`
- `provider_unreachable`
- `invalid_provider_response`
- `capability_assertion_failed`
- `runtime_integration_failed`
- `side_effect_outcome_unknown`

每个错误应包含稳定 code、所属层、是否可重试以及有限的修复动作，例如重新保存 Provider Key、修正模型上游 ID、切换已验证协议或检查账户权限。不得把智增增返回错误原文无界地透传给 UI。

## 9. 数据与证据

建议将 P2 能力证据放在回归体系内，但与 12 Case 结果分开：

```text
eval/regression/
├─ model_capabilities/
│  ├─ schemas/
│  │  ├─ probe-request.schema.json
│  │  ├─ probe-result.schema.json
│  │  └─ capability-snapshot.schema.json
│  ├─ profiles/
│  │  └─ zhizengzeng-my-drsai-p2.yaml
│  └─ policies/
│     └─ p2-model-capability-gate.yaml
└─ ... P1 cases, suites and policies

tmp/eval-results/regression/model-capabilities/<execution-id>/
├─ results.jsonl
├─ capability-snapshot.json
├─ summary.json
├─ report.md
└─ bounded-media/
```

正式发布摘要可归档到 `docs/evidence/agent-regression/`，但原始音频、图片 Base64、完整上游响应和凭据不得提交 Git。

能力快照必须绑定：

- OpenDrSai commit/build；
- Provider 配置 revision；
- AgentModelPolicy revision；
- 模型目录 revision；
- 路由规则 revision；
- 探针定义 revision；
- 真实/fixture 标识；
- 每项 probe ID，以及 Runtime 闭环对应的 run ID。

## 10. 实施轮次

### 第 1 轮：合同与路由基础

完成 P2-F01、P2-F02、能力结果 Schema 和错误分类；固化 5 模型 profile。验收重点是兼容读取旧配置、精确模型解析和零秘密泄露。

### 第 2 轮：文本模型协议

完成 Responses 和 Chat Adapter 收敛，验证 Flash 文本、推理和结构化工具调用。只有真实智增增探针和正式 Runtime 均通过，Flash 才标记 `runtime_verified`。

### 第 3 轮：Gemini 多模态与图片生成

完成 Gemini 原生 Adapter、图片理解和图片生成 Runtime 重构，修正 `image_generation_model` 使用。产出图片理解结果和有效图片 Artifact。

### 第 4 轮：音频模型

完成 Audio Adapter 和智能体策略凭据路由，执行 TTS→STT 闭环，移除音频业务对全局环境模型配置的依赖。

### 第 5 轮：探针产品化和回归接入

完成 Gateway API、CLI/Desktop 状态、快照、报告、P2 Gate 和 P1 Runner 预检接入；运行完整本地契约矩阵和一次真实智增增矩阵。

### 第 6 轮：正式验收与交接

在 OPENDESAI-DEV 上执行五模型真实探针和 Runtime 闭环，冻结已验收能力快照。随后才进入 12 项任务回归的正式 Gateway 执行阶段。

## 11. P2 发布门禁

P2 Gate 必须 fail closed，并满足：

- 5 个模型都来自 `my-drsai` 的显式模型策略且 Provider 为 `zhizengzeng`；
- 必验操作均有真实终态，不允许缺失、stale 或仅 declared；
- `deepseek-v4-flash` 文本、推理、结构化工具调用和 Runtime tool loop 通过；
- `gpt-5.6-luna` Responses 图片理解、结构化函数探针和正式 Runtime 路由通过；
- `gemini-3.1-flash-lite-image` 通过 Gemini 原生协议生成有效 Artifact；
- `tts-1` 和 `whisper-1` 分别通过并完成闭环；
- Responses 是否适用于 Flash/Gemini 有真实探测结论；不支持时存在明确、已验证的回退，不允许猜测；
- 配置测试和正式 Runtime 使用相同解析器、凭据与协议适配器；
- 能力快照 revision 全部匹配当前配置和代码；
- fixture、Mock、文档声明、人工口头确认都不能替代真实 Provider 和 Runtime 证据；
- 报告和日志敏感信息扫描零命中；
- 所有 P2 单元、契约、故障和真实验收测试通过。

如果某模型因账户权限、配额或智增增临时故障不可用，结论必须是 `environment_failed` 或对应稳定错误，P2 Gate 失败；不得删除该能力要求、切换未确认模型或用其他 Provider 冒充通过。

## 12. P2 最终交付物

- 操作级模型路由与协议合同；
- Responses、Chat、Gemini、Audio 协议适配器；
- 统一模型/凭据解析和错误规范化；
- Gateway 能力探针 API；
- 5 模型 P2 profile、Schema、结果与 Gate policy；
- 能力快照、CLI/Desktop 状态和三类报告；
- 正式 Runtime 的工具、图片理解、图片生成和语音闭环证据；
- P1 Runner 的模型能力预检；
- 单元、契约、真实 Provider、Runtime E2E、安全和成本测试；
- 一份通过 P2 Gate 的真实智增增验收摘要。

只有上述交付物全部完成，才认为 OpenDrSai 已具备运行此前 12 项代表性回归测试所需的模型基础。
