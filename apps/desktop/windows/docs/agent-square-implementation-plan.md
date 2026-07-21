# OpenDrSai Windows 智能体广场实现规划

## 1. 目标

让 Windows App 用户在完成 HepAI OIDC 登录后，可以发现、查看、选择并使用 `opendrsai.ihep.ac.cn` 中的智能体，同时保留本地 `My DrSai` 的现有使用方式。

本方案优先复用：

- Windows App 已有的智能体广场、聊天窗口、Electron IPC、安全边界和 SSE 解析链路；
- WebUI 已有的统一智能体目录、默认智能体、最近使用和远程/自定义智能体数据；
- OpenDrSai 后端已有的 `UserAgents`、智能体配置解析和运行管理能力；
- Windows App 已有的 HepAI OIDC 登录和 `hai_api` Access Token。

## 2. 调研结论

### 2.1 已有能力

Windows App 已有：

- `desktop:list-agents` IPC 和 `DesktopAgent` 类型；
- `AgentSquareView` 智能体页面；
- 聊天输入区的智能体选择；
- 本机 gateway 的 OpenAI 风格流式聊天；
- SSE、停止、超时、错误和线程状态处理；
- HepAI OIDC 登录，且申请了 `hai_api` scope。

WebUI/后端已有：

- `/agentworker/user_agents/list` 统一目录；
- 默认智能体和最近使用记录；
- 默认、DDF、remote、custom 四类平台智能体的聚合；
- 会话、运行和智能体构建能力。

### 2.2 当前缺口

1. Windows 的平台智能体发现依赖本地 `HEPAI_API_KEY`，没有优先使用登录后的 OIDC Access Token。
2. Windows 当前直接访问 HepAI `agents/list_agents`，不能完整获得 OpenDrSai 用户目录中的默认、remote 和 custom 智能体。
3. 用户选择智能体后，Windows 只传递 `metadata.selected_agent` 名称，聊天仍发往本机 gateway，没有按智能体 ID 和类型执行真实路由。
4. 线上生产 OpenAPI 尚未提供完整的原生客户端流式运行接口。
5. remote/custom 智能体可能包含服务端密钥，不能将完整配置发送给 Renderer 或保存到普通本地缓存。

## 3. 推荐架构

```text
Windows Renderer
  智能体广场 / 详情 / 聊天选择器
                 │ 仅传 agentId 和公开信息
                 ▼
Electron Main：PlatformAgentAdapter
  ├─ My DrSai ─────────────────────> 本机 Gateway
  └─ 平台智能体 ───────────────────> OpenDrSai Native API
                                         │
                                         ├─ DDF/HepAI Worker
                                         ├─ Remote Agent
                                         └─ Custom Agent
```

关键约束：

- OIDC Token、API Key 和私有执行配置只存在于 Electron Main 或服务端；
- Renderer 只接收经过清洗的公开智能体 DTO；
- 本地和云端执行最终都转换为现有 `ChatEvent`；
- 服务端从 Token subject 识别用户，不信任客户端提交的 `user_id`；
- WebUI 页面和 Gatsby 路由不直接导入 Windows 工程，只复用框架无关的数据模型与产品逻辑。

## 4. 建议接口

建议新增 Windows/Android 共用的稳定 Native API：

```http
GET  /api/native/v1/agents?refresh=false
PUT  /api/native/v1/agents/default
POST /api/native/v1/agents/{agent_id}/usage

POST /api/native/v1/chat/completions
Authorization: Bearer <OIDC access token>
Content-Type: application/json

{
  "agent_id": "agent-id",
  "thread_id": "desktop-thread-id",
  "messages": [],
  "stream": true,
  "workspace": {}
}
```

`chat/completions` 应输出现有 Windows SSE 解析器能够消费的事件，并支持取消、错误、工具状态、文件和人机交互事件。

## 5. 开发项与功能点清单

### 统计口径

“功能点”指可独立实现和验收的用户行为或平台能力。代码重构步骤、单条测试用例、调研记录和普通文档更新不重复计数。

本规划共分为 **7 类开发项、35 个功能点**。

| 类别 | 开发项 | 功能点数量 |
| --- | --- | ---: |
| A | 平台契约与身份认证 | 4 |
| B | 智能体目录与数据适配 | 6 |
| C | 智能体广场产品界面 | 7 |
| D | 聊天选择与执行路由 | 6 |
| E | Native 云端执行接口 | 5 |
| F | 安全、可靠性与可观测性 | 4 |
| G | 测试、发布与灰度 | 3 |
| **合计** | **7 类开发项** | **35** |

### 实施进度（2026-07-14，第 8 轮）

前两轮已完成平台目录的 Windows 基础链路、Native 目录接口，以及广场的发现与选择交互。进度按“已实现且有对应自动化证据”统计；仍需真实 HAI Token 或完整执行链验证的项目保留为部分完成。

| 状态 | 功能点 | 数量 |
| --- | --- | ---: |
| 已完成 | A1～A4、B1～B6、C1～C7、D1～D6、E1～E3、E5、F1～F4、G1～G3 | 34 |
| 部分完成 | E4 | 1 |
| 尚未完成 | 无 | 0 |
| **合计** |  | **35** |

本轮新增或确认的证据：

- Windows 平台目录使用 OIDC Token，支持一次 401 刷新重试和能力降级；
- 平台智能体公开 DTO、Main 私有执行描述符、稳定排序/去重、强制刷新和公开缓存已经实现；
- 缓存采用字段白名单，不写入平台 URL、`api_key` 或原始 `config`；
- Native `/api/native/v1/agents`、详情、默认智能体和使用记录接口已完成本地代码；
- Native 鉴权从 RS256 OIDC Token subject 推导用户，并通过 issuer allowlist、audience 和 JWKS 验签；
- `ai-dev.ihep.ac.cn/api/native/v1/agents` 在未携带 Token 时返回 401，证明联调环境已有受保护的 Native 路由入口；
- 广场支持本地/官方/我的智能体分组，按来源和可用性筛选，并按推荐、最近使用和名称排序；
- 卡片支持平台 Logo 与失败回退、模式/能力标签、详情弹窗、设为默认和使用记录上报；
- 服务端默认智能体可同步到聊天选择，Windows 偏好写入支持一次 401 刷新重试；
- `ChatRequest` 已显式携带 `agentId`；My DrSai 保持本机 gateway 路由，平台分支复用同一 SSE/停止/超时处理，并受 `agent-chat` 能力开关保护；
- 会话持久化绑定 agentId/name；历史会话恢复绑定，带上下文切换智能体时确认并新建会话；
- Native SSE 接口复用现有 WebSocket 运行管理器，支持线程复用、断开和显式停止、工具/文件事件、人机输入与回复；
- DDF、remote、custom 三种私有配置均由服务端按 agentId 注入运行管理器，公开 SSE 白名单测试确认不返回 API Key 和内部配置；
- 新增 HTTPS/主机/IP/凭据/allowlist 执行目标策略、隐私安全的本地运行遥测，以及桌面端和服务端双重灰度开关；
- 执行目标策略增加 DNS 解析结果复检；直接 remote HTTP 禁止跟随重定向，DDF 目标限制为 IHEP allowlist，自定义目标支持运维 allowlist；
- 平台执行增加连续失败熔断、30 秒半开与成功复位，和既有超时、取消、一次 401 重试共同形成 F3 可靠性边界；
- Native 鉴权默认 audience 修正为实际 Access Token 使用的 `hai-api`，RS256/JWKS/issuer/audience/subject 正向验签测试通过；
- Windows TypeScript 全量类型检查、51 项 Renderer UI 回归、平台契约/目录/UI 验证和后端 Native/Mobile 测试通过。

第四轮验证结果更新为：Windows 类型检查通过、Renderer 51 项检查通过、平台目录/路由/偏好/灰度契约通过、Chat SSE 解析通过；当前后端 Native/Mobile 已扩展为 22 项测试（其中 Native 19 项），覆盖三种模式适配、连续线程、取消、错误脱敏、输入限制和执行目标策略。

第五轮新增真实打包与端到端证据：当前代码重新执行 `build:unpack` 成功；打包 Electron + 真实 Python fake gateway 聊天通过；取消、SSE 错误、不可达、超时、空完成、断流和附件失败矩阵通过；线程重启持久化与稳定 threadId 通过；实际 Main `chat.ts` 对假平台 HTTP/SSE 的云端路由 E2E 通过，覆盖一次 401 刷新、文本/工具/文件/输入事件、回复、连续线程、停止和私有配置隔离。F2、F3、G2 因此转为完成。

独立 OIDC 联调脚本仍因 Windows DPAPI 进程上下文隔离而在 `safeStorage.decryptString` 返回 `0x8009000B`，但第七轮已由正常运行的 Windows App 使用其现有 OIDC 会话完成真实刷新；因此不再用独立脚本的 DPAPI 限制阻塞 A1。

第六轮外部状态为：2026-07-14 14:26（Asia/Shanghai），`GET https://ai-dev.ihep.ac.cn/api/native/v1/agents?refresh=false` 返回 `401 Unauthorized` 和 `WWW-Authenticate: Bearer`；同一环境的 `POST /api/native/v1/agents/nonexistent/chat` 返回 `404 Not Found`。这证明受保护目录入口在线，但 Native 执行路由尚未部署到 ai-dev。

第七轮通过 SSH 指挥塔恢复 HAI 协作会话 `019f5208-0f19-7883-b3e2-4dcc8ffa4b61`，在 `/home/zzd/VSProjects/hepai/hai-ai-platform-backend` 修复平台目录：删除 `hai.native.default/ddf/remote/custom` 四个模式模板，改为按 OIDC subject 映射 HAI 用户并读取真实 DDF、remote、custom 目录，使用公开字段白名单和按 subject 隔离的回退缓存；平台侧 26 项 Native/OIDC 测试、Black、`py_compile` 和 `git diff --check` 通过，并于 17:12:09 热加载 ai-dev。17:13:57，正常运行的 Windows App 使用现有 OIDC 会话成功刷新出 5 个真实 HAI DDF 智能体（稳定平台 UUID，`source=remote`），A1 据此完成。Windows 同时移除本地 `remote_agents.json` 聚合，强制仅 `my-drsai` 可标记为本地，并过滤旧缓存中的 `hai.native.*` 模板。

第七轮后续补充远程描述本地化兼容：HAI `description` 为普通字符串时直接展示；为 `{ "en": "...", "zh": "..." }` JSON 字符串或对象时，在 Main 进程解析为公开 `localizedDescription`，Renderer 按当前中英文界面选择对应文本，缺少目标语言时回退另一语言。两种语言均纳入搜索，详情弹窗和卡片使用同一选择函数，公开缓存支持安全往返；平台契约、目录缓存、UI 回归和 Windows 全量 TypeScript 检查通过。

第七轮交互语义补充：平台智能体已经由 HAI 远端运行，广场卡片不再显示“一键启动”，统一改为“开始使用 / Use agent”。该操作只选择并绑定智能体、预填任务提示并进入当前会话，不启动或重启远端服务；不可用智能体保持禁用。本机智能体同样只在运行可用时提供“开始使用”。

第七轮卡片信息收敛：广场卡片不展示 `ddf`、`remote`、`custom` 等后端运行模式，避免向普通用户暴露实现细节；模式仍保留在 Main 私有执行描述符和详情弹窗中，用于正确路由与诊断，能力标签继续展示。

第七轮默认操作布局补充：删除卡片底部“设为默认”文字按钮，将其移动为卡片右上角的星标按钮；未默认时为空心星，当前默认时为实心星并禁用重复提交，保存中显示旋转状态，同时提供中英文 `aria-label` 和悬浮提示。底部操作区只保留“详情”和“开始使用”。

第七轮默认操作联调修复：星标失效的根因不是 Agent 目录域名，而是 ai-dev 当时只有 `GET /api/native/v1/agents`，缺少 Windows 已调用的 `PUT /api/native/v1/agents/default`。HAI 指挥塔已补齐该受保护路由：从 OIDC subject 映射平台用户，先校验 agentId 属于其真实可见目录，再代理 OpenDrSai `PUT /api/agentworker/user_default_agent`，成功后更新按 subject 隔离的目录缓存并仅标记一个默认项；同时宣告 `agent-default` 能力，不宣告尚未部署的 `agent-chat`。远端 Native/OIDC 聚焦测试 35 项通过并已热加载。`https://aiapi.ihep.ac.cn/apiv2/agents/list_agents` 经探测为有效但受保护的 DDF 上游；它不保存默认偏好，也不聚合 remote/custom，因此保留为 HAI/OpenDrSai 内部 DDF 数据源，不把 Windows Native base URL 直接替换为 aiapi。

第八轮修复云端消息发送：Windows 的平台执行分支此前仍会先启动本机 Gateway，导致消息在到达 HAI 前失败；现已将平台智能体与本机/远程工作区 Gateway 完全解耦，平台消息不启动 Gateway，也不构建仅供本机执行的附件上下文。云端路由 E2E 将 `startGateway()` 改为主动抛错并仍通过，证明 DDF 请求只进入 Native SSE 通道；Windows 类型检查和智能体广场 UI 契约检查同时通过，运行中的 Electron 已重启加载新 Main 代码。

同轮 HAI 指挥塔在 `/home/zzd/VSProjects/hepai/hai-ai-platform-backend` 新增并热加载认证路由 `POST /api/native/v1/agents/{agent_id}/chat`。服务端仅以 OIDC subject 查询用户可见目录，将稳定 agent UUID 映射为服务端私有 DDF runtime name，再代理固定上游 `https://aiapi.ihep.ac.cn/apiv2/chat/completions`；禁止重定向，校验 SSE Content-Type，处理断开取消并保证一个 `[DONE]`，错误响应不回显 Token、私有配置或上游正文。目录仅对 DDF 宣告 chat/streaming，remote/custom 在找到安全的服务端执行入口前保持不可用。平台 Native/OIDC 聚焦测试扩展为 52 项，Black、`py_compile` 和 diff 检查通过；ai-dev 的未认证路由探测返回结构化 401 而非 404/405，Windows 随后刷新出的 5 个真实 DDF 智能体均带 chat/streaming 能力。

第八轮真实发送发现并修复第二个认证边界问题：目录请求使用 OIDC Access Token 正常，但 Native Chat 最初误将该 Token 转发给 `aiapi`，而现有 HAI WebUI 实际使用服务端托管的用户 AI API Key，因此上游返回 401 并被 Windows 错误提示为“登录已过期”。HAI 现按已验证的 OIDC subject 调用既有 `Users.get_user_api_key_by_id`，只在服务端把该 Key 用作 `aiapi` Bearer，绝不回退或下发 OIDC Token；缺少 Key 返回非 401 的 `agent_credentials_unavailable`，上游拒绝 Key 返回非 401 的 `agent_credentials_invalid`。Windows 同时改为先解析 401 结构化错误，只有明确的 `token_expired` 才刷新一次，并为两类模型凭证错误提供独立中英文提示。Windows 全量类型检查、云端路由 E2E、SSE 解析和平台认证验证通过，应用重启后目录继续成功刷新。

最后 1 个部分完成项仍为 E4。DDF 代码链已打通，待用当前 Windows 登录态完成一次真实文本流与 `[DONE]` 冒烟；remote/custom 仍缺 HAI 内部的安全认证执行端点，不采用客户端 URL 或私有配置下发的临时方案。完成 E4 还需：

1. 从已登录的 Windows App 对一个 DDF 智能体发送消息，确认出现文本增量、正常结束并记录脱敏遥测；
2. HAI/OpenDrSai 提供 remote 与 custom 的受认证服务端执行入口，或将现有运行管理器接入 Native 路由；
3. 对 DDF、remote、custom 各保留一个稳定测试智能体，完成连续对话、停止、401/403、下线和断流冒烟。

Windows 端请求体继续按 `messages`、`stream`、`thread_id`、`run_id`、`model`、`attachments`、`metadata` 发送；HAI 不信任客户端 `model` 选择执行目标，而是以经过可见性校验的 agentId 解析真实 runtime name。

### A. 平台契约与身份认证（4 个）

- **A1**：使用 Windows OIDC Access Token 访问平台智能体目录。
- **A2**：Access Token 临期刷新，并对一次 401 执行安全重试。
- **A3**：启动或首次进入广场时执行平台能力/版本探测，兼容暂未部署 Native API 的环境。
- **A4**：服务端根据 Token subject 解析用户身份，移除对客户端 `user_id` 的信任。

### B. 智能体目录与数据适配（6 个）

- **B1**：聚合本地 My DrSai 与平台默认、DDF、remote、custom 智能体。
- **B2**：建立统一 `DesktopAgent` 公开 DTO，覆盖 mode、来源、状态、头像、示例和能力。
- **B3**：在 Electron Main 建立按 agentId 索引的私有执行描述符，禁止发送密钥到 Renderer。
- **B4**：智能体去重、稳定 ID、默认排序和不可用条目归一化。
- **B5**：支持手动强制刷新，并展示刷新时间和加载状态。
- **B6**：支持本地目录缓存、过期策略和离线只读降级。

### C. 智能体广场产品界面（7 个）

- **C1**：展示本地、官方、我的智能体分组及数量。
- **C2**：按名称、描述、作者和能力搜索。
- **C3**：按来源、可用状态、最近使用等条件筛选和排序。
- **C4**：智能体卡片展示头像、描述、来源、状态和能力标签。
- **C5**：智能体详情展示完整介绍、示例问题、作者和使用限制。
- **C6**：设置默认智能体并在广场、设置页和聊天区同步状态。
- **C7**：展示最近使用、空状态、离线缓存、加载失败和重试入口。

### D. 聊天选择与执行路由（6 个）

- **D1**：`ChatRequest` 显式传递 agentId，不再以智能体名称作为执行依据。
- **D2**：新会话绑定选中的智能体，并在会话标题区持续展示。
- **D3**：My DrSai 继续路由到本机 gateway，保持现有功能兼容。
- **D4**：平台智能体路由到 Native 云端执行接口。
- **D5**：会话中切换智能体时提供新建会话或确认切换行为，避免上下文串线。
- **D6**：本地与云端统一流式输出、停止、超时、错误、工具和文件事件。

### E. Native 云端执行接口（5 个）

- **E1**：提供认证后的统一智能体目录接口，仅返回公开配置。
- **E2**：提供默认智能体和最近使用的读取/写入接口。
- **E3**：提供按 agentId 执行的 OpenAI 风格 SSE 聊天接口。
- **E4**：服务端解析并执行 DDF、remote、custom 三类平台智能体，复用现有智能体工厂和运行管理器。
- **E5**：支持云端线程连续对话、停止、文件事件和人机输入事件。

### F. 安全、可靠性与可观测性（4 个）

- **F1**：Token、API Key、remote 配置在进程、IPC、日志和缓存中的全链路隔离与脱敏。
- **F2**：对远程 URL、重定向和访问目标执行允许策略，降低 SSRF 和错误配置风险。
- **F3**：实现目录与执行请求的超时、取消、有限重试、熔断和友好错误映射。
- **F4**：记录目录刷新、智能体选择、执行成功率、延迟和错误类型，不记录用户正文与密钥。

### G. 测试、发布与灰度（3 个）

- **G1**：增加目录契约、数据归一化、身份刷新和密钥隔离的单元/契约测试。
- **G2**：增加本地与云端路由、SSE、取消、下线和会话绑定的端到端测试。
- **G3**：通过功能开关、灰度用户、兼容性检测和回滚策略发布。

## 6. HAI 平台联调机制

HAI 平台联调是本方案的必要环节，并作为 P1 开发的前置准入条件。智能体广场的静态界面、本地缓存和 My DrSai 可以独立开发，但以下能力必须在 HAI 开发环境完成真实验证：

- Windows OIDC Access Token 对 HAI 智能体目录的访问权限；
- `hai_api` scope、Token 刷新及 401/403 行为；
- 智能体稳定 ID、名称、状态、上下线及详情字段；
- 选定智能体后的流式调用、停止、超时和错误协议；
- 用户、组织、角色或白名单导致的可见性差异；
- DDF、remote、custom 智能体的配置和密钥托管边界。

### 联调环境与协作会话

- 优先联调环境：`https://ai-dev.ihep.ac.cn`；
- 平台协作会话：`019f5208-0f19-7883-b3e2-4dcc8ffa4b61`；
- 该会话修改的大部分平台内容可以热加载到 `ai-dev.ihep.ac.cn`，因此优先通过该会话提交小步、可验证的平台变更，减少完整部署等待；
- 只有在出现明确的平台接口问题、需要平台代码调整或需要确认线上契约时发送消息，避免发送没有具体行动项的状态消息。

向协作会话发送联调消息时，应包含：

1. 环境、接口和调用场景；
2. 预期行为与实际行为；
3. HTTP 状态码、错误码和脱敏后的最小日志；
4. 建议的平台修改位置或接口契约；
5. 修改后的验收步骤和回归范围。

不得在协作消息中发送 OIDC Token、API Key、用户正文、remote 密钥或未经脱敏的完整请求。平台侧修改及热加载结果记录在协作会话中，Windows 侧代码和测试仍以本仓库为准。

### 最小联调闭环

```text
Windows OIDC 登录
    → 使用 Access Token 获取智能体目录
    → 选择一个稳定测试智能体
    → 发起一次流式对话
    → 验证停止、Token 过期、无权限和智能体下线
    → 将结果回填到规划和自动化契约测试
```

建议 HAI 平台准备一个普通测试账号、一个受限测试账号，以及 2～3 个稳定测试智能体，用于验证目录差异、权限和真实执行。

本节属于协作与实施机制，不作为新的产品功能点重复计数，因此总数仍为 **7 类开发项、35 个功能点**。

## 7. 分阶段实施

### P0：线上契约验证，0.5～1 天

目标：消除 OIDC Token、线上目录和平台执行协议的不确定性。

协作方式：优先在 `ai-dev.ihep.ac.cn` 验证；需要平台修改或确认契约时，向会话 `019f5208-0f19-7883-b3e2-4dcc8ffa4b61` 发送包含复现、建议修改和验收步骤的消息。

覆盖功能点：A1、A2、A3 的验证部分。

验收条件：

- 使用真实 Windows 登录 Token 成功读取目录；
- 明确各类智能体的返回字段和调用方式；
- 确认响应中不会向客户端暴露服务端密钥。
- 完成最小联调闭环，并将确认后的接口样例固化为契约测试夹具。

### P1：发现与选择 MVP，2～3 天

目标：Windows 用户可以看见、搜索、查看和选择平台智能体。

准入条件：P0 的 HAI 最小联调闭环已经通过；若未通过，只允许继续开发不依赖平台契约的 UI，不进入真实目录和执行能力的发布验收。

主要覆盖：A1～A3、B1～B6、C1～C7、E1～E2。

验收条件：

- 登录后自动加载完整平台目录；
- 支持搜索、详情、刷新、缓存、默认和最近使用；
- Renderer 中不存在 Access Token 或智能体密钥。

### P2：真实执行，4～6 天

目标：选中的智能体能够真正处理 Windows 聊天请求。

主要覆盖：A4、D1～D6、E3～E5、F1～F3。

验收条件：

- My DrSai 与平台智能体分别进入正确执行通道；
- DDF、remote、custom 至少各有一个真实冒烟样例；
- 流式回答、停止、超时、工具和文件事件可正常显示；
- 会话之间不会发生智能体或上下文串线。

### P3：质量与灰度，2～3 天

目标：达到可灰度发布质量。

主要覆盖：F4、G1～G3。

验收条件：

- 自动化测试进入 Windows CI；
- 具备功能开关、指标监控和快速回滚路径；
- 401、403、超时、下线、断流和离线场景均有明确用户反馈。

## 8. MVP 与后续边界

MVP 必须包含：

- 统一平台目录；
- 搜索、详情、最近使用和默认智能体；
- My DrSai 本地执行；
- DDF 平台智能体真实执行；
- 身份刷新、密钥隔离、SSE 和基本错误处理。

可以在后续小版本完善：

- remote/custom 的复杂文件上传；
- 多轮人机确认和暂停/恢复；
- 更丰富的能力标签、评价和推荐；
- 多设备会话同步。

remote/custom 的密钥始终保留在服务端，即使功能延期，也不采用将完整配置下发到桌面端的临时方案。

## 9. 工作量判断

- 可用 MVP：约 7～10 个开发日；
- 完整覆盖 35 个功能点并完成灰度准备：约 10～15 个开发日；
- 若 Native API 需要独立部署审批、生产鉴权改造或多环境联调，应额外预留发布窗口，但不改变本规划的功能点数量。
