# OpenHuman 技术分析文档

> 分析对象：`/home/xiongdb/test/openhuman`  
> 目标：以 harness project 的视角梳理 OpenHuman 的功能定位、技术特点、架构分层、运行流程与可借鉴设计。

---

## 1. 项目定位

OpenHuman 是一个面向个人工作流的开源 AI Agent Harness。它不是单一聊天机器人，而是一个本地优先、桌面优先的智能体运行平台，核心目标是让 Agent 能在用户授权范围内连接日常工具、持续同步上下文、构建长期记忆，并通过桌面 UI、原生能力和模型路由提供稳定的交互体验。

项目 README 中给出的核心定位是：

- Personal AI super intelligence；
- 本地 Memory Tree；
- 按需使用托管服务；
- 简洁 UI-first 的桌面体验；
- 集成 OAuth、模型路由、搜索、抓取、语音、编码工具等能力。

从 harness 角度看，OpenHuman 重点解决的是：

1. Agent 如何长期拥有用户上下文；
2. Agent 如何安全调用本地和云端工具；
3. Agent 如何通过子智能体和工具循环完成复杂任务；
4. 桌面应用如何稳定承载本地核心服务、系统权限、实时连接和 UI 状态。

---

## 2. 主要功能与特点

### 2.1 UI-first 的桌面 Agent

OpenHuman 提供 React + Tauri 的桌面应用。用户不需要先在终端配置复杂参数，而是通过桌面 UI 完成登录、连接服务、设置模型、查看记忆和使用 Agent。

相关路径：

```text
app/                      # React + Tauri 桌面应用
app/src/                  # Vite/React 前端
app/src-tauri/            # Tauri 桌面宿主，Windows/macOS/Linux
```

特点：

- 桌面优先，支持 Windows/macOS/Linux；
- Tauri v2 + Rust，而非 Electron；
- CEF runtime 是主要 WebView runtime；
- 支持系统托盘、通知、深链、全局快捷键、窗口状态等桌面能力；
- 部分移动端目录存在，但当前产品文档强调桌面为主要发布目标。

### 2.2 本地优先 Memory Tree + Obsidian 风格知识库

OpenHuman 的重要差异点是长期记忆。它会将连接的数据、用户活动和同步内容规范化为 Markdown chunk，写入本地 SQLite 和 Obsidian 风格 vault，再通过 Memory Tree 建立层级摘要与检索能力。

相关路径：

```text
src/openhuman/memory/             # 记忆编排层：ingest、query、tree policy
src/openhuman/memory_store/       # 底层统一存储、chunk、vector、tree、content
src/openhuman/memory_sync/        # 外部数据同步管线
src/openhuman/memory_tree/        # Memory Tree 运行和检索
src/openhuman/memory_graph/       # 实体关系图谱相关
src/openhuman/vault/              # Obsidian 风格 vault 输出
```

特点：

- 本地 SQLite 存储；
- Markdown 文档化，方便用户审阅和编辑；
- 支持 document、KV、graph、vector、tree 等多种存储形态；
- `MemoryClient` 是推荐的外部访问接口，避免外部模块直接操作底层 `UnifiedMemory`；
- 支持轻量写入 `put_doc_light()`、语义写入 `put_doc()`、同步完整 ingest `ingest_doc()` 等不同成本路径。

### 2.3 118+ 第三方集成与自动拉取

OpenHuman 的集成层通过 Composio、MCP、本地 workspace 等多种 pipeline 将 Gmail、Slack、GitHub、Notion、Linear、Jira 等服务的数据拉入本地记忆。

相关路径：

```text
src/openhuman/composio/           # Composio 集成
src/openhuman/memory_sync/        # sync pipeline 抽象和实现
src/openhuman/memory_sync/composio
src/openhuman/memory_sync/mcp
src/openhuman/memory_sync/workspace
src/openhuman/channels/           # 消息渠道与 provider runtime
```

`memory_sync` 的设计原则是：

- 每类上游服务一个 pipeline；
- pipeline 只写入 `memory_store`，不直接写 tree；
- ingest pipeline 是 memory tree/graph/vector 的边界；
- orchestrator 统一驱动 `init -> tick -> repeat`。

### 2.4 Agent Harness 与子智能体委托

OpenHuman 的 Agent 不是简单单轮调用。它包含会话运行时、工具调用循环、子智能体、prompt 构造、工具过滤、结果综合等完整 harness。

相关路径：

```text
src/openhuman/agent/                      # Agent domain
src/openhuman/agent/harness/              # 多智能体 harness
src/openhuman/agent/harness/session/      # 主 Agent session lifecycle
src/openhuman/agent/harness/subagent_runner.rs
src/openhuman/agent/harness/tool_loop.rs
src/openhuman/tools/impl/agent/           # spawn_subagent 等工具
```

核心模型：

1. `Agent::turn` 是主会话运行时，负责历史、记忆、系统提示、工具调用和 transcript；
2. `run_subagent` 是隔离的委托运行，不是完整 nested session；
3. `spawn_subagent` 作为工具暴露给主 Agent；
4. 子智能体通过 tool filtering、prompt suffix、token budget 等机制降低上下文成本；
5. 子智能体返回一个综合后的 compact result 给父 Agent。

典型流程：

```text
User message
  -> Agent::turn
  -> 恢复 transcript / 构造系统 prompt / 加载 memory context
  -> LLM provider call
  -> 解析 tool calls
  -> 执行工具或 spawn_subagent
  -> 工具结果回填给模型
  -> 生成最终 assistant text
  -> 写入 transcript 与 memory hooks
```

### 2.5 TokenJuice 压缩层

OpenHuman 强调在工具结果、网页抓取、邮件正文、搜索 payload 进入 LLM 前先做 token 压缩。README 中称其可降低最高约 80% 成本和延迟。

相关路径：

```text
src/openhuman/tokenjuice/
src/openhuman/tokenjuice/rules
src/openhuman/tokenjuice/text
src/openhuman/tokenjuice/vendor
```

关键思想：

- HTML 转 Markdown 或纯文本；
- 长 URL 缩短；
- 冗余工具输出去重；
- 规则 overlay 控制不同类型文本的压缩方式；
- 保留 CJK、emoji 等 grapheme，不粗暴丢弃多字节字符。

### 2.6 本地 + 托管混合模式

OpenHuman 是 local-first，但默认体验仍使用托管服务来降低使用门槛。

托管能力包括：

- 账户登录；
- 模型路由；
- Web search proxy；
- Composio OAuth 和 managed integration；
- 某些实时 trigger/webhook。

本地能力包括：

- Memory Tree；
- Obsidian vault；
- workspace config；
- SQLite runtime state；
- 本地工具和本地模型可选项；
- OS keyring secret storage。

---

## 3. 仓库结构

OpenHuman 是 monorepo，关键路径如下：

```text
/home/xiongdb/test/openhuman
├── Cargo.toml                  # Rust core crate，openhuman-core binary
├── src/                        # Rust core library + RPC server + domain modules
│   ├── main.rs                 # core binary entry，Sentry 初始化和 CLI 分发
│   ├── lib.rs                  # openhuman_core library entry
│   ├── core/                   # CLI、JSON-RPC、auth、logging、shutdown
│   ├── api/                    # TinyHumans/OpenHuman backend REST/socket client
│   ├── rpc/                    # structured error / dispatch
│   └── openhuman/              # 主要业务 domain
├── app/                        # React + Tauri desktop app
│   ├── src/                    # React UI、Redux、页面、组件、服务
│   ├── src-tauri/              # Desktop host，CEF/Tauri/Rust bridge
│   └── src-tauri-mobile/       # 移动端实验/构建目标
├── packages/                   # npm/deb/homebrew/tauri plugin packaging
├── scripts/                    # 安装、构建、测试、发布脚本
├── docs/                       # 工程设计文档
├── gitbooks/                   # 面向用户和开发者的 GitBook 文档
├── e2e/                        # Docker/local E2E 环境
└── .github/workflows/          # CI、release、coverage、e2e、installer smoke
```

---

## 4. 技术架构分层

### 4.1 前端 UI 层

路径：

```text
app/src/
```

技术栈：

- React 19；
- Vite；
- Redux Toolkit；
- Tailwind CSS；
- Vitest；
- Tauri JS API；
- socket.io-client；
- cmdk、react-router、react-markdown 等 UI/交互组件。

职责：

- onboarding 和登录；
- 对话页与 Agent 交互；
- 设置页、模型页、技能页、连接页；
- Composio/OAuth/MCP 配置 UI；
- mascot、voice、screen intelligence、wallet 等特性入口；
- 通过 Tauri command 获取 core RPC URL/token；
- 通过 HTTP JSON-RPC 调用 Rust core。

### 4.2 Tauri 桌面宿主层

路径：

```text
app/src-tauri/src/
```

职责：

- 启动和管理内嵌 Rust core HTTP/JSON-RPC server；
- 生成并注入本地 RPC bearer token；
- 提供 Tauri IPC commands，例如 `core_rpc_url`、`core_rpc_token`；
- 处理系统托盘、窗口、深链、通知、全局快捷键；
- 处理 CEF profile 和 WebView API bridge；
- 实现 screen capture、fake camera、Meet audio/video、Slack/WhatsApp/Telegram/GMessages/WeChat scanner；
- 防止旧 core 进程或端口冲突导致 UI 连接到错误版本。

关键文件：

```text
app/src-tauri/src/lib.rs
app/src-tauri/src/core_process.rs
app/src-tauri/src/core_rpc.rs
app/src-tauri/src/webview_apis/
app/src-tauri/src/cdp/
```

### 4.3 Rust Core 服务层

路径：

```text
src/
```

核心 crate：

```toml
[package]
name = "openhuman"
description = "OpenHuman core business logic and RPC server"

[[bin]]
name = "openhuman-core"
path = "src/main.rs"

[lib]
name = "openhuman_core"
```

职责：

- CLI 分发；
- JSON-RPC server；
- REST/backend client；
- auth 与 token；
- agent harness；
- memory 和 memory sync；
- MCP client/server；
- Composio/OAuth；
- local inference / provider routing；
- skills runtime；
- scheduler/cron；
- observability、Sentry、Prometheus、OpenTelemetry；
- update、doctor、health。

### 4.4 外部服务层

外部依赖包括：

- TinyHumans/OpenHuman hosted backend；
- 模型提供商或 OpenHuman model routing backend；
- Composio connector layer；
- OAuth providers；
- MCP registries and servers；
- Web search/scraper；
- local AI runtimes，例如 Ollama/LM Studio；
- OS keychain；
- SQLite local store。

---

## 5. RPC 与运行流程

### 5.1 启动流程

桌面应用启动时大致流程：

```text
用户启动 OpenHuman desktop
  -> Tauri host 初始化 CEF/WebView
  -> CoreProcessHandle 生成 RPC token
  -> 启动内嵌 openhuman-core server
  -> core 绑定本地 HTTP JSON-RPC 端口
  -> 前端通过 Tauri IPC 获取 core_rpc_url/core_rpc_token
  -> 前端使用 Authorization: Bearer <token> 调用 /rpc
  -> UI 加载账户、配置、会话、记忆、技能等状态
```

`core_process.rs` 中明确说明：core server 作为 tokio task 跑在 Tauri host 内，生命周期绑定 GUI 进程，避免 sidecar 残留。

### 5.2 JSON-RPC 调用路径

核心路径：

```text
app/src UI
  -> Tauri command: core_rpc_url / core_rpc_token
  -> HTTP POST /rpc
  -> src/core/jsonrpc.rs::rpc_handler
  -> src/core/jsonrpc.rs::invoke_method
  -> src/core/dispatch.rs::dispatch
  -> core internal / registered controller / legacy rpc dispatch
  -> domain handler
  -> JSON-RPC response
```

`src/core/dispatch.rs` 采用分层路由：

1. legacy method alias rewrite；
2. core subsystem，例如 `core.ping`、`core.version`；
3. registered domain controllers；
4. legacy domain dispatcher；
5. unknown method warning。

### 5.3 Agent turn 流程

```text
UI 提交用户消息
  -> core JSON-RPC agent/chat method
  -> prompt injection guard
  -> Agent::turn
  -> 加载 session transcript
  -> 构建 system prompt
  -> 加载 memory context
  -> provider inference
  -> parse tool calls
  -> execute tools / spawn subagent
  -> tool result compression / summarization
  -> LLM synthesis
  -> transcript + memory hooks
  -> response 回 UI
```

### 5.4 Memory sync 流程

```text
用户连接服务或启用 pipeline
  -> OAuth/credential 存储
  -> memory_sync pipeline init
  -> scheduler/cron tick
  -> 拉取上游数据
  -> canonicalize / chunk
  -> memory_store 写入
  -> embedding / graph extraction / tree folding
  -> Agent recall/query 时加载相关上下文
```

---

## 6. Agent Harness 设计重点

### 6.1 主 Agent 与子 Agent 的边界

`Agent::turn` 是完整会话 runtime，拥有：

- conversation history；
- system prompt reuse；
- memory loading；
- hooks；
- transcript resume；
- parent context；
- tool execution loop。

`run_subagent` 是委托执行器：

- 不创建完整 nested session；
- 使用较小 inner loop；
- 使用 filtered tools；
- 返回单个 compact result；
- typed subagent prompt 会附加统一 role contract。

这种边界可以防止子任务膨胀成无限嵌套会话，也方便控制 token、工具权限和结果形态。

### 6.2 工具暴露与过滤

OpenHuman 的工具系统有两类重要约束：

1. 主 Agent 可见工具需要按上下文过滤；
2. 子 Agent 工具范围更窄，避免权限扩大和 token 浪费。

相关模块：

```text
src/openhuman/tool_registry
src/openhuman/tools
src/openhuman/tools/impl
src/openhuman/agent/harness/tool_filter.rs
src/openhuman/agent_tool_policy
```

### 6.3 大结果处理

从文档 `agent-subagent-tool-flow.md` 可见，子智能体和工具链路包含 large-result handoff。结合 TokenJuice 和 memory 层，可以推断其策略是：

- 大工具结果不直接塞入 LLM；
- 先摘要、压缩或写入存储；
- 给父 Agent 一个 synthesis-ready 的结果；
- 必要时通过引用/检索再取细节。

这对 DrSai/Hermes 类 TUI 同样有参考价值：长 paste、长 log、长工具输出应折叠为文件或结构化块展示，不应直接刷屏。

---

## 7. 安全与隐私设计

### 7.1 本地优先与密钥存储

OpenHuman 默认将记忆、vault、配置、runtime state 放在本机。密钥相关能力由 OS keyring、本地加密和 OAuth 托管代理共同承担。

相关路径：

```text
src/openhuman/keyring
src/openhuman/credentials
src/openhuman/encryption
src/openhuman/security
app/src-tauri/src/core_process.rs
```

### 7.2 本地 RPC Bearer Token

Tauri host 启动 core 时生成 256-bit token：

```text
CoreProcessHandle::new
  -> generate_rpc_token
  -> OPENHUMAN_CORE_TOKEN
  -> frontend via core_rpc_token command
```

所有前端到本地 core 的 RPC 都需要携带：

```text
Authorization: Bearer <token>
```

这样可以避免本机其他进程随意调用 core RPC。

### 7.3 Prompt Injection Guard

OpenHuman 有后端权威的 prompt injection 检测：

```text
src/openhuman/prompt_injection/
```

检测层包括：

- normalization；
- override/exfiltration/role hijack/secret patterns；
- 可选 heuristic classifier；
- verdict: allow / review / block；
- action: allow / block / review_blocked。

执行位置包括：

- channels provider；
- local AI ops；
- agent harness runtime；
- agent bus。

关键原则：前端提示只是 UX，后端拦截才是权威。

### 7.4 MCP Secret Opaque Ref 设计

`docs/MCP_SETUP_AGENT.md` 描述了一个重要安全模式：子智能体需要设置 MCP server 时，secret 不进入 LLM 上下文，而是：

```text
agent -> mcp_setup_request_secret
core  -> UI 原生密钥输入
core  -> 返回 secret://opaque-ref
agent -> 用 opaque ref 测试连接
core  -> just-in-time 解析真实 secret
```

这对任何 agent harness 都值得借鉴：LLM 只见 handle，不见 secret value。

---

## 8. Native / Desktop 能力

OpenHuman 的桌面宿主包含大量系统级能力：

```text
app/src-tauri/src/screen_capture/
app/src-tauri/src/meet_audio/
app/src-tauri/src/meet_video/
app/src-tauri/src/fake_camera/
app/src-tauri/src/native_notifications/
app/src-tauri/src/dictation_hotkeys.rs
app/src-tauri/src/mascot_native_window.rs
app/src-tauri/src/*_scanner/
```

功能包括：

- 屏幕智能；
- 语音输入/输出；
- Google Meet agent；
- fake camera / virtual camera；
- 原生通知；
- Slack/WhatsApp/Telegram/WeChat/GMessages/Discord 数据扫描；
- mascot native window；
- deep link OAuth callback；
- WebView API bridge。

这说明 OpenHuman 的 agent harness 不只运行在聊天框中，而是深度接入桌面环境。

---

## 9. 构建、测试与发布

### 9.1 主要命令

根目录 `package.json`：

```bash
pnpm dev                 # web UI dev
pnpm dev:app             # desktop app dev
pnpm build               # app build
pnpm typecheck           # TypeScript compile
pnpm test                # app tests
pnpm test:rust           # Rust tests
pnpm test:e2e            # E2E
pnpm rust:check          # cargo check
```

Rust core：

```bash
cargo check -p openhuman --lib
cargo build --bin openhuman-core
```

桌面 app：

```bash
pnpm --filter openhuman-app dev:app
pnpm --filter openhuman-app tauri
```

### 9.2 测试矩阵

`docs/TEST-COVERAGE-MATRIX.md` 将功能映射到：

- RU：Rust unit；
- RI：Rust integration；
- VU：Vitest unit；
- WD：WDIO E2E；
- MS：manual smoke。

这种矩阵适合大型 agent harness，因为功能跨越前端、Tauri、Rust core、OS 权限和外部服务，不可能只靠一种测试覆盖。

### 9.3 CI/CD

`.github/workflows/` 包含：

- build；
- desktop build；
- Windows build；
- typecheck；
- coverage；
- e2e；
- release staging/production；
- installer smoke；
- uptime monitor；
- tauri-cef pin guard。

---

## 10. 可借鉴设计

### 10.1 对 DrSai/Hermes TUI 的启发

1. **长文本折叠**  
   OpenHuman/Hermes 对长 paste 和长 message 采用 token/file 引用思路，不直接渲染全文。这与 DrSai TUI 当前长 paste 转 txt 的方向一致。

2. **工具结果结构化展示**  
   TodoWrite、tool call、large result 应该进入独立结构化渲染链路，而不是混入 assistant 正文。

3. **本地 RPC token**  
   Desktop/TUI 如果暴露本地 HTTP RPC，应该使用本地 bearer token 或随机 socket path，避免同机进程误调用。

4. **MemoryClient 门面**  
   对外统一 memory API，内部可替换 SQLite/vector/tree/graph 实现，避免业务模块直接碰底层表。

5. **子智能体不是完整 session**  
   子智能体使用轻量 runner，减少上下文和生命周期复杂度。

6. **secret opaque ref**  
   任何密钥收集都应通过 out-of-band UI，LLM 只获得不可反解引用。

7. **测试矩阵**  
   Agent harness 功能跨层，建议维护 feature-to-test matrix。

### 10.2 风险与复杂度

OpenHuman 的能力很完整，但复杂度也高：

- Rust core domain 非常多，学习成本高；
- Tauri/CEF 与 OS 权限耦合强；
- managed backend 与 local-first 边界需要清晰解释；
- connector/OAuth/MCP/Memory sync 都依赖外部服务稳定性；
- 多平台发布链路复杂；
- Agent 工具权限、prompt injection、secret flow 必须持续维护。

---

## 11. 总结

OpenHuman 是一个完整的本地优先 AI Agent Harness，重点不在单次对话，而在“让 Agent 成为长期工作流参与者”。它通过 Tauri + Rust core + React UI 构建桌面应用，通过 JSON-RPC 连接 UI 与本地 core，通过 Memory Tree 和 Obsidian vault 建立长期记忆，通过 Composio/MCP/workspace pipeline 同步外部上下文，通过 Agent Harness 和子智能体机制执行复杂任务。

对 harness project 来说，OpenHuman 的主要价值在于展示了一个端到端 Agent 平台的工程形态：

```text
桌面 UI
  + 本地 core RPC
  + 安全 token/secret 管理
  + agent tool loop
  + subagent delegation
  + memory tree
  + connector sync
  + token compression
  + native desktop capabilities
  + CI/E2E/release matrix
```

如果要在 DrSai 或其他 Agent CLI/TUI/Desktop 项目中吸收经验，优先级建议是：

1. 长文本/长工具结果折叠与文件化；
2. Todo/工具结果结构化渲染；
3. MemoryClient 门面；
4. 子智能体轻量 runner；
5. 本地 RPC token；
6. secret opaque ref；
7. feature-to-test coverage matrix。
