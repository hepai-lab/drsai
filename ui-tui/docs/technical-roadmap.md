# DrSai ui-tui 技术路线深度分析

> 本文档对 DrSai TUI 终端前端项目进行完整的技术路线剖析，涵盖技术选型、架构设计、与后端的连接运行逻辑等核心内容。

---

## 目录

1. [项目概览](#1-项目概览)
2. [技术选型详解](#2-技术选型详解)
3. [项目结构](#3-项目结构)
4. [与后端的连接运行逻辑](#4-与后端的连接运行逻辑)
5. [前端组件架构](#5-前端组件架构)
6. [状态管理架构](#6-状态管理架构)
7. [性能优化策略](#7-性能优化策略)
8. [构建与分发](#8-构建与分发)
9. [技术路线总结](#9-技术路线总结)

---

## 1. 项目概览

`@drsai/ui-tui` 是 DrSai 的**终端用户界面（TUI）**前端，采用 React + Ink 在终端中渲染交互式 AI 对话界面，通过 **JSON-RPC 协议** 与 Python 后端网关通信。

整体架构如下：

```
┌─────────────────────────────────────────────────────┐
│                  ui-tui 架构总览                      │
│                                                      │
│   ┌──────────────┐    JSON-RPC     ┌──────────────┐  │
│   │  React/Ink   │◄──────────────►│  Python      │  │
│   │  TUI 前端     │   stdio / WS   │  tui_gateway │  │
│   │  (TypeScript) │               │  (后端网关)    │  │
│   └──────────────┘               └──────┬───────┘  │
│                                         │           │
│                                    ┌────▼──────┐   │
│                                    │ LLM/Agent │   │
│                                    │ 核心引擎   │   │
│                                    └───────────┘   │
└─────────────────────────────────────────────────────┘
```

---

## 2. 技术选型详解

### 2.1 语言与运行时

| 技术 | 版本 | 选型理由 |
|------|------|----------|
| **TypeScript** | ^5.7 | 类型安全，IDE 支持完善，与 React 生态深度集成 |
| **Node.js** | ≥20 (ES2022 target) | 原生支持 ESM、`import.meta`、`child_process` 等系统级 API |
| **Python** | 3.x | 后端网关语言，通过 `python -m drsai.backend.tui_gateway` 启动 |

### 2.2 核心框架

| 依赖 | 版本 | 角色 | 选型理由 |
|------|------|------|----------|
| **React** | ^19.0.0 | UI 声明层 | 组件化 + Hooks 模式，状态管理清晰 |
| **Ink** | ^6.0.0 | 终端渲染引擎 | 用 React 的方式写终端 UI（`<Box>`, `<Text>`, `useInput` 等），支持 Flexbox 布局 |
| **nanostores** | ^1.0.0 | 状态管理 | 极轻量原子化 store（`atom()`），避免 Redux 的复杂度 |
| **@nanostores/react** | ^1.0.0 | React 绑定 | `useStore($atom)` 按需订阅，精确重渲染 |

关键设计决策：

- **Ink 而非 blessed/ncurses**：Ink 使用 React 的 reconciliation + Yoga Flexbox 布局，开发体验远优于命令式终端库
- **nanostores 而非 Redux/Zustand**：TUI 状态简单且分散（连接状态、会话元数据、streaming 状态），原子化 store 天然按需订阅，避免全局 re-render

### 2.3 通信层

| 依赖 | 版本 | 角色 |
|------|------|------|
| **ws** | ^8.18.0 | WebSocket 客户端（attach 模式） |
| **Node child_process** | 内置 | 启动 Python 网关子进程（stdio 模式） |
| **Node readline** | 内置 | 按行解析 JSON-RPC 帧 |

### 2.4 开发与构建工具链

| 工具 | 版本 | 角色 | 选型理由 |
|------|------|------|----------|
| **esbuild** | ^0.28 | 打包为单文件 `dist/entry.mjs` | 极速构建，支持 JSX/TSX 直接打包 |
| **tsx** | ^4.19 | 开发时直接运行 `.tsx` | 无需预编译，`--watch` 支持 HMR |
| **pnpm** | — | 包管理 | 快速 + 严格依赖隔离 |

---

## 3. 项目结构

```
ui-tui/
├── src/
│   ├── entry.tsx                       # 入口：spawn Gateway + mount Ink App
│   ├── app.tsx                         # 启动编排：连接→配置→会话→就绪
│   ├── gatewayClient.ts                # JSON-RPC 客户端（stdio + WebSocket 双模式）
│   ├── gatewayTypes.ts                 # JSON-RPC 协议类型定义（与 Python 端对齐）
│   ├── theme.ts                        # 暗色主题配色
│   ├── app/
│   │   ├── types.ts                    # UI 领域类型（Turn, ToolCall 等）
│   │   ├── turnController.ts           # 轮次控制器（submit→stream→finalize）
│   │   ├── turnStore.ts                # 会话 transcript + streaming 原子 store
│   │   ├── uiStore.ts                  # 连接状态、会话元数据等全局 UI store
│   │   ├── overlayStore.ts             # 审批/澄清/密钥弹窗 store
│   │   └── createGatewayEventHandler.ts # 事件→store 统一分发器
│   ├── components/
│   │   ├── appLayout.tsx               # 主布局骨架
│   │   ├── transcriptPane.tsx          # 历史记录 + 流式输出区域
│   │   ├── streamingAssistant.tsx      # 正在流式输出的 assistant turn
│   │   ├── composerPane.tsx            # 输入区 + 斜杠命令处理
│   │   ├── textInput.tsx               # 多行文本输入（历史 + Tab 补全）
│   │   ├── statusBar.tsx               # 底部状态栏
│   │   ├── prompts.tsx                 # 审批/澄清/密钥弹窗覆盖层
│   │   ├── setupScreen.tsx             # 首次运行配置向导
│   │   ├── sessionPicker.tsx           # 会话选择器覆盖层
│   │   ├── modelPicker.tsx             # 模型选择器覆盖层
│   │   ├── markdownRenderer.tsx        # Markdown 渲染（代码块、表格、列表等）
│   │   ├── markdown.tsx                # Markdown 辅助组件
│   │   └── toolCallLine.tsx            # 工具调用单行摘要
│   └── hooks/
│       └── useVirtualHistory.ts        # 虚拟历史窗口（只保留最近 N 条）
├── scripts/
│   ├── build.mjs                       # esbuild 打包脚本
│   ├── smoke.mjs                       # 冒烟测试
│   ├── e2e-test.sh                     # E2E 测试
│   └── pty-smoke.sh                    # PTY 冒烟测试
├── dist/
│   └── entry.mjs                       # 构建产物（单文件 bundle）
├── package.json
├── tsconfig.json
└── pnpm-lock.yaml
```

---

## 4. 与后端的连接运行逻辑

### 4.1 启动流程

```
用户执行 drsai-tui
    │
    ▼
entry.tsx: 创建 GatewayClient 实例 → gw.start()
    │
    ├── [有 TTY] → render(<App gw={gw} />)     ← 交互式 Ink 模式
    │                  │
    │                  ▼
    │              App 启动编排 (Bootstrap 状态机)
    │
    └── [无 TTY] → headless smoke test         ← CI/自动化路径
                        │
                        ▼
                    gw.ready_() → gw.request('session.list') → 输出 JSON → exit
```

### 4.2 GatewayClient 双模式

GatewayClient 支持两种连接模式：

| 模式 | 触发条件 | 机制 |
|------|----------|------|
| **stdio 模式** | 默认 | `spawn('python', ['-m', 'drsai.backend.tui_gateway'])` 子进程，通过 stdin/stdout 通信 |
| **WebSocket 模式** | 设置 `DRSAI_TUI_ATTACH_URL=ws://...` | 连接已有网关实例，无需启动新进程 |

Python 解释器解析优先级：

```
1. DRSAI_PYTHON 环境变量
2. PYTHON 环境变量
3. VIRTUAL_ENV/bin/python (venv)
4. 系统 python3 / python
```

Python 源码根目录解析优先级：

```
1. DRSAI_PYTHON_SRC_ROOT 环境变量
2. 默认 ../python/packages/drsai/src/ (相对于 ui-tui/src/)
```

环境变量注入：`PYTHONIOENCODING=utf-8` + `PYTHONUTF8=1`，强制 UTF-8 编码（解决 Windows 下 CJK 乱码问题）。

### 4.3 JSON-RPC 通信协议

#### 帧格式

每行一个 JSON 对象（newline-delimited JSON）：

```jsonc
// 请求帧 (TUI → Gateway)
{ "jsonrpc": "2.0", "id": "r1", "method": "prompt.submit", "params": { "session_id": "...", "text": "..." } }

// 响应帧 (Gateway → TUI)
{ "jsonrpc": "2.0", "id": "r1", "result": { "status": "streaming" } }

// 事件帧 (Gateway → TUI, 服务器推送)
{ "jsonrpc": "2.0", "method": "event", "params": { "type": "message.delta", "payload": { "text": "..." } } }
```

#### RPC 方法一览

| 方法 | 方向 | 用途 |
|------|------|------|
| `session.list` | TUI→Gateway | 获取会话列表 |
| `session.most_recent` | TUI→Gateway | 获取当前目录最近会话 |
| `session.create` | TUI→Gateway | 创建新会话 |
| `session.resume` | TUI→Gateway | 恢复会话（加载 Agent） |
| `prompt.submit` | TUI→Gateway | 提交用户输入（fire-and-forget） |
| `prompt.cancel` | TUI→Gateway | 取消当前流式响应 |
| `model.options` | TUI→Gateway | 获取可用模型列表 |
| `setup.save` | TUI→Gateway | 保存初始配置（API Key 等） |
| `slash.exec` | TUI→Gateway | 执行斜杠命令 |
| `commands.catalog` | TUI→Gateway | 获取命令目录（Tab 补全用） |
| `approval.respond` | TUI→Gateway | 回应审批请求 |
| `clarify.respond` | TUI→Gateway | 回应澄清问题 |
| `secret.respond` | TUI→Gateway | 回应密钥请求 |

#### Gateway 事件类型

| 事件类型 | 方向 | 载荷说明 |
|----------|------|----------|
| `gateway.ready` | Gateway→TUI | 网关就绪（含 skin/branding/setup 状态） |
| `gateway.stderr` | Gateway→TUI | 网关标准错误输出 |
| `gateway.protocol_error` | Gateway→TUI | 协议错误 |
| `gateway.exit` | Gateway→TUI | 网关退出 |
| `session.info` | Gateway→TUI | 会话元数据（model, tools, workdir 等） |
| `session.started` | Gateway→TUI | 新会话已创建 |
| `session.restored` | Gateway→TUI | 已有会话已恢复 |
| `message.start` | Gateway→TUI | LLM 开始输出 |
| `message.delta` | Gateway→TUI | 流式文本增量（100-200Hz） |
| `message.complete` | Gateway→TUI | LLM 输出完成（含 usage/token 统计） |
| `thinking.delta` | Gateway→TUI | 思考过程增量 |
| `reasoning.delta` | Gateway→TUI | 推理过程增量 |
| `reasoning.available` | Gateway→TUI | 推理结果就绪 |
| `tool.start` | Gateway→TUI | 工具调用开始 |
| `tool.progress` | Gateway→TUI | 工具执行进度 |
| `tool.complete` | Gateway→TUI | 工具调用完成 |
| `subagent.spawn_requested` | Gateway→TUI | 子 Agent 请求创建 |
| `subagent.start` | Gateway→TUI | 子 Agent 启动 |
| `subagent.thinking` | Gateway→TUI | 子 Agent 思考中 |
| `subagent.tool` | Gateway→TUI | 子 Agent 调用工具 |
| `subagent.complete` | Gateway→TUI | 子 Agent 完成 |
| `approval.request` | Gateway→TUI | 请求用户审批（危险命令） |
| `clarify.request` | Gateway→TUI | 请求用户澄清 |
| `secret.request` | Gateway→TUI | 请求密钥输入 |
| `sudo.request` | Gateway→TUI | 请求 sudo 权限 |

### 4.4 事件流 — 核心数据流

这是整个项目最核心的交互流程：

```
Python Gateway                        TUI Frontend
    │                                     │
    │  ── gateway.ready ──────────────►   │  启动完成，UI 解除 loading
    │  ── session.info ───────────────►   │  会话元数据（model, tools, workdir）
    │                                     │
    │  ◄── prompt.submit(text) ───────    │  用户提交输入
    │      返回 {status: "streaming"}     │  (立即返回，不等结果)
    │                                     │
    │  ── message.start ──────────────►   │  LLM 开始流式输出
    │  ── message.delta {text} ───────►   │  流式文本增量
    │  ── message.delta {text} ───────►   │  (100-200Hz 高频)
    │  ── thinking.delta ─────────────►   │  思考过程增量
    │  ── tool.start ─────────────────►   │  工具调用开始
    │  ── tool.progress ──────────────►   │  工具执行进度
    │  ── tool.complete ──────────────►   │  工具调用完成（含结果+耗时）
    │  ── subagent.start ─────────────►   │  子 Agent 启动
    │  ── subagent.tool ──────────────►   │  子 Agent 调用工具
    │  ── subagent.complete ──────────►   │  子 Agent 完成
    │  ── message.complete ───────────►   │  轮次结束（含 usage/token 统计）
    │                                     │
    │  ── approval.request ───────────►   │  需要用户审批（危险命令）
    │  ◄── approval.respond ──────────    │  用户选择 approve/deny
    │  ── clarify.request ────────────►   │  需要用户澄清问题
    │  ◄── clarify.respond ──────────     │  用户回答
    │  ── secret.request ─────────────►   │  需要密钥输入
    │  ◄── secret.respond ──────────      │  用户输入密钥值
```

### 4.5 Turn Controller — 轮次生命周期

TurnController 是一轮对话（用户输入 → AI 回复）的核心编排器：

```
用户按 Enter 提交输入
    │
    ▼
TurnController.submit(trimmed)
    ├─ appendTurn(UserTurn)          → 写入 $transcript 锁定历史
    ├─ setCurrent(newAssistantTurn)  → 创建占位流式 turn 在 $current
    ├─ $isStreaming = true           → 锁定输入，显示 streaming 状态
    └─ gw.request('prompt.submit')   ← fire-and-forget：立即返回 {status: "streaming"}
         │
         │  (后台运行，不阻塞 UI)
         │
         ▼
GatewayEventHandler 持续接收事件并更新 store:
    │
    ├─ message.delta → textBuf += text → 50ms 节流后刷新到 $current.text
    ├─ thinking.delta / reasoning.delta → reasoningBuf → 同上节流
    ├─ tool.start → 追加到 $current.tools[]
    ├─ tool.complete → 更新对应 tool 的 status + result + durationMs
    │
    ▼
message.complete 事件到达
    └─ controller.finalize()
        ├─ flushBuffers()             → 刷出最后一批缓存 delta
        ├─ 将 $current 移入 $transcript（锁定到历史）
        ├─ $current = null            → 清除流式占位
        └─ $isStreaming = false       → 解锁输入
```

**关键设计：fire-and-forget RPC**

`prompt.submit` 立即返回 `{status: "streaming"}`，轮次结束完全由 `message.complete` 事件驱动。这解决了旧设计中长时间工具调用导致 RPC 超时的问题（原来 120s timeout 对于复杂的 Agent 工具链远远不够）。

### 4.6 App 启动编排（Bootstrap 状态机）

App 组件管理从启动到就绪的完整状态机：

```
                    ┌──────────┐
                    │connecting │  初始状态：等待 gateway.ready
                    └────┬─────┘
                         │ gateway.ready 事件
                         ▼
               ┌─────────────────┐
               │ setup_required? │  检查 gateway.ready.payload.setup
               └────┬───────┬────┘
                    │       │
          required=true   required=false
                    │       │
                    ▼       ▼
             ┌──────────┐  ┌──────────────┐
             │  setup   │  │resolveSession│
             │(首次配置) │  └──────┬───────┘
             └────┬─────┘         │
                  │               ├── session.most_recent → 有 → 使用该会话
                  │               └── session.create → 新建会话
                  │               │
                  │               ▼
            SetupScreen       ┌─────────┐
            (用户交互)         │ resuming │  session.resume → 加载 Agent
                  │           └────┬────┘
                  │                │
            setup.save RPC        │
                  │                ▼
                  │           ┌──────────────────────────────────────┐
                  └──────────►│               ready                  │
                              │  创建 TurnController, 绑定事件处理器   │
                              │  渲染 AppLayout 主界面               │
                              └──────────────────────────────────────┘
```

错误路径：任何步骤失败 → `error` 状态，显示错误信息。

---

## 5. 前端组件架构

```
App (启动编排 + Bootstrap 状态机)
 ├── SetupScreen            ← 首次运行配置（选 Provider + 输入 API Key）
 │    ├── Provider 选择 (HepAI / Anthropic / OpenAI / Skip)
 │    ├── API Key 输入
 │    └── Base URL 输入
 │
 └── AppLayout              ← 主界面布局
      ├── Banner            ← ⚡ DrSai 标题
      │
      ├── TranscriptPane    ← 对话主区域
      │    ├── <Static>     ← 已完成的历史 turn（只写一次，永不重绘）
      │    │    ├── UserBlock        (▸ 用户消息)
      │    │    └── AssistantBlock   (● assistant 回复)
      │    │         ├── ToolCallLine × N
      │    │         ├── MarkdownRenderer (完整 Markdown 渲染)
      │    │         └── Usage 统计 (model · in=N out=N)
      │    │
      │    └── StreamingAssistant  ← 正在流式输出的当前 turn
      │         ├── ToolCallLine × N
      │         ├── Reasoning 展示 (可选，受 $showReasoning 控制)
      │         └── 纯文本渲染 (不走 Markdown 解析，避免半截内容乱码)
      │
      ├── PromptsOverlay     ← 弹窗覆盖层（同时只显示一个）
      │    ├── ApprovalOverlay   (⚠ 审批请求)
      │    ├── ClarifyOverlay    (? 澄清问题)
      │    ├── SecretOverlay     (🔑 密钥输入)
      │    └── SudoOverlay       (🔒 sudo 请求)
      │
      ├── StatusBar          ← 底部状态栏
      │    └── 连接状态 · 用户 · 模型 · 工具数 · 工作目录 · plan_mode · streaming
      │
      └── ComposerPane       ← 输入区
           ├── TextInput     (多行输入 + 命令历史 + Tab 补全)
           ├── SessionPicker (会话选择器覆盖层，/list /switch 触发)
           └── ModelPicker   (模型选择器覆盖层，/model 触发)
```

### 关键组件说明

#### TranscriptPane — 双渲染路径

| 状态 | 渲染方式 | 原因 |
|------|----------|------|
| 流式中 (`$current`) | 纯文本 (`<Text>`) | Token 边界任意，半截 Markdown 会乱码；频繁重解析浪费 CPU |
| 已锁定 (`$transcript`) | 完整 MarkdownRenderer | 内容完整，一次性渲染表格/代码块/列表等 |

#### TextInput — 终端多行输入

| 快捷键 | 功能 |
|--------|------|
| `Enter` | 提交 |
| `Esc+Enter` / `Shift+Enter` / `Alt+Enter` | 插入换行 |
| `↑` / `↓` | 浏览命令历史 |
| `Tab` / `Shift+Tab` | 循环补全斜杠命令 |
| `Ctrl+U` | 清除当前行 |
| `Ctrl+A` / `Ctrl+E` | 行首 / 行尾 |

#### ComposerPane — 斜杠命令处理

| 命令 | 功能 |
|------|------|
| `/quit`, `/exit`, `/q` | 退出程序 |
| `/list`, `/ls`, `/switch` | 打开 SessionPicker |
| `/model`, `/m` | 打开 ModelPicker |
| `/new` | 创建新会话并切换 |
| 其他 | 通过 `slash.exec` RPC 发送到后端执行 |

---

## 6. 状态管理架构

### 6.1 Store 划分

所有 store 均为 nanostores `atom()`，完全解耦、按需订阅：

```
┌───────────────────────────────────────────────────────────┐
│                      turnStore.ts                         │
│  $transcript: atom<Turn[]>         已锁定的对话历史        │
│  $current: atom<AssistantTurn | null>  正在流式的 turn     │
│  $isStreaming: atom<boolean>       是否正在流式输出        │
└───────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────┐
│                       uiStore.ts                          │
│  $connectionStatus: atom<ConnectionStatus>  连接状态       │
│  $connectionError: atom<string>             连接错误信息   │
│  $skin: atom<GatewaySkin | null>            品牌/皮肤配置  │
│  $sessionMeta: atom<SessionMetadata | null> 会话元数据     │
│  $statusLine: atom<string>                  状态栏文本    │
│  $userId: atom<string>                      用户 ID       │
│  $showReasoning: atom<boolean>              显示推理过程   │
└───────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────┐
│                    overlayStore.ts                         │
│  $approval: atom<ApprovalRequestPayload | null>  审批弹窗  │
│  $clarify: atom<ClarifyRequestPayload | null>    澄清弹窗  │
│  $secret: atom<SecretRequestPayload | null>      密钥弹窗  │
│  $sudo: atom<SudoRequestPayload | null>          sudo弹窗  │
└───────────────────────────────────────────────────────────┘
```

### 6.2 数据流向

```
Gateway 事件
    │
    ▼
createGatewayEventHandler()     ← 事件统一分发器
    │
    ├── gateway.ready       → $connectionStatus, $skin
    ├── session.info        → $sessionMeta, $userId
    ├── message.delta       → textBuf → 50ms → $current.text
    ├── thinking.delta      → reasoningBuf → 50ms → $current.reasoning
    ├── tool.start          → $current.tools[]
    ├── tool.complete       → $current.tools[i] status/result
    ├── message.complete    → finalize() → $transcript, $current=null
    ├── approval.request    → $approval
    ├── clarify.request     → $clarify
    ├── secret.request      → $secret
    └── gateway.exit/error  → $connectionStatus, $connectionError
```

组件通过 `useStore($atom)` 精确订阅需要的 store，避免级联重渲染。

---

## 7. 性能优化策略

### 7.1 流式 Delta 节流

LLM 流式事件频率高达 100-200Hz，直接每个 delta 触发 React re-render 会导致：

- Ink reconciliation 跟不上
- CJK 字符的 yoga-layout 列宽计算延迟
- 文本碎片散乱、列偏移错位

**解决方案**：`createGatewayEventHandler` 内的 **50ms 合并缓冲**：

```typescript
// 收到 message.delta
textBuf += text           // 积攒到缓冲区
scheduleFlush()           // 调度 50ms 后刷新

// 50ms 定时器触发
flushBuffers()
  → updateCurrent(c => ({ ...c, text: c.text + textBuf }))
  → textBuf = ''          // 清空缓冲区
```

效果：将 100-200Hz 的事件降频为 ~20Hz 的 UI 更新，用户感知仍是"实时"，但 CPU 开销大幅降低。

### 7.2 Ink `<Static>` 组件

已完成的 turn 通过 `<Static>` 渲染：

- 只写入终端**一次**，永不重绘
- 终端 resize 不触发历史内容的 reflow
- 流式文本不再与历史重绘竞争
- 历史自然滚入终端的 scrollback buffer

### 7.3 虚拟历史窗口

`useVirtualHistory(50)` 只保留最近 50 个 turn 在 React DOM 中：

- 更旧的 turn 仍可见（终端 scrollback），但不再参与 reconciliation
- 避免千级对话历史导致 O(N) 重渲染

### 7.4 双渲染路径

| 阶段 | 渲染策略 | 理由 |
|------|----------|------|
| 流式中 | 纯文本 + `stripThinkBlocks` | 避免半截 Markdown（如不完整的表格行）被误解析 |
| 已锁定 | 完整 `MarkdownRenderer` | 内容完整，可安全渲染代码块/表格/列表等 |

---

## 8. 构建与分发

### 8.1 构建策略

```bash
pnpm build  →  node scripts/build.mjs  →  dist/entry.mjs
```

**esbuild 配置要点**：

| 配置 | 值 | 说明 |
|------|------|------|
| `platform` | `node` | 运行在 Node.js 环境 |
| `target` | `node20` | 最低支持 Node 20 |
| `format` | `esm` | 输出 ESM 模块 |
| `bundle` | 全量 | 所有依赖打进 bundle，PyPI 用户无需 npm |
| `minify` | `false` | 保持可读性，方便调试 |
| `sourcemap` | `inline` | 内联 source map |

### 8.2 DevTools Stub 插件

Ink 在开发模式懒加载 `react-devtools-core`，生产环境不需要：

```javascript
// esbuild plugin: stub-devtools
b.onResolve({ filter: /^react-devtools-core$/ }, () => ({
  path: 'react-devtools-core',
  namespace: 'stub-devtools',
}))
b.onLoad({ filter: /.*/, namespace: 'stub-devtools' }, () => ({
  contents: 'export function connectToDevTools() {}\n...',
  loader: 'js',
}))
```

### 8.3 CJS 兼容 Banner

Ink 内部部分代码使用 `require()`，需要在 ESM bundle 中注入兼容层：

```javascript
banner: {
  js: "import { createRequire as topLevelCreateRequire } from 'module';\n"
    + "const require = topLevelCreateRequire(import.meta.url);\n",
}
```

### 8.4 开发命令

| 命令 | 说明 |
|------|------|
| `pnpm dev` | tsx 直接运行（无需构建） |
| `pnpm watch` | tsx --watch 模式 |
| `pnpm build` | esbuild 打包 |
| `pnpm start` | 运行构建产物 |
| `pnpm type-check` | tsc --noEmit 类型检查 |

---

## 9. 技术路线总结

### 9.1 核心设计哲学

| 原则 | 实现方式 |
|------|----------|
| **前后端解耦** | JSON-RPC 协议，TUI 和 Gateway 独立进程，前端可替换（Web/IDE 插件同理） |
| **事件驱动** | 轮次结束由 `message.complete` 事件决定，不依赖 RPC 返回值，避免超时 |
| **流式优先** | Delta 合并 + 节流 + 双渲染路径，优化终端流式体验 |
| **零外部依赖分发** | esbuild 全量打包，PyPI 用户只需 Node.js，无需 npm install |
| **渐进式 Bootstrap** | 从 connecting → setup → resuming → ready 的状态机，每步可恢复 |
| **原子化状态** | nanostores 按需订阅，避免 Redux 全局重渲染开销 |

### 9.2 技术风险与取舍

| 取舍 | 选择 | 优势 | 代价 |
|------|------|------|------|
| Ink vs blessed | Ink (React 模型) | 声明式 UI + Hooks，开发体验极好 | 终端布局受 Yoga Flexbox 限制，CJK 宽度偶尔不准 |
| nanostores vs Redux | nanostores | 轻量、按需订阅、零模板代码 | 无中间件/time-travel，调试靠 console |
| stdio vs WebSocket | 默认 stdio | 零配置，子进程管理简单 | 无法多客户端共享；attach 模式需额外部署 |
| 全量 bundle vs 依赖安装 | 全量打包 | 分发简单，一个文件搞定 | bundle ~2-3MB，更新需重新打包 |
| fire-and-forget RPC vs 同步等待 | 事件驱动 | 无超时问题，支持长时间工具链 | 逻辑复杂度略高（需追踪事件完成） |

### 9.3 前后端契约机制

**唯一通信接口** = `GatewayClient`，通过三个核心方法：

```typescript
// 1. 发送 RPC 请求
gw.request<T>(method, params): Promise<T>

// 2. 订阅特定事件
gw.onEvent<T>(type, handler): () => void

// 3. 订阅所有事件
gw.onAny(handler): () => void
```

Python 端的事件定义在 `event_translator.py`，TypeScript 端在 `gatewayTypes.ts` 镜像同一契约——**两边是独立语言，但通过 JSON-RPC 类型契约保持同步**。任何一端修改事件结构都需同步更新另一端的类型定义。

### 9.4 未来演进方向

基于当前代码注释中的线索：

| 方向 | 线索来源 | 说明 |
|------|----------|------|
| 浅色主题 | `theme.ts` 注释 | "Phase 4 can add light theme + COLORFGBG-driven auto-detect" |
| 语法高亮 | `markdownRenderer.tsx` 注释 | "no syntax highlighting yet — that's Phase 4+" |
| WebSocket attach 模式完善 | `gatewayClient.ts` | 已实现基础 WebSocket 连接，可扩展为多终端同步 |
| PTY 集成 | `scripts/pty-smoke.sh` | 已有 PTY 冒烟测试，可能发展为更完整的终端集成 |
