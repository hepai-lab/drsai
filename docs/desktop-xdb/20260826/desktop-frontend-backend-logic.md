# Desktop 前后端整体逻辑文档

> **路径**: `apps/desktop/` → `cores/python/packages/drsai/src/drsai/backend/`  
> **文档版本**: 2026-08-26  
> **目的**: 整合 Desktop 从 Electron 前端到后端智能体的完整前后端逻辑

---

## 目录

1. [架构总览](#1-架构总览)
2. [Electron 进程模型](#2-electron-进程模型)
3. [Gateway 进程管理](#3-gateway-进程管理)
4. [HTTP/SSE 通信协议](#4-httpsse-通信协议)
5. [Gateway 后端路由](#5-gateway-后端路由)
6. [Runtime 中间件层](#6-runtime-中间件层)
7. [智能体执行](#7-智能体执行)
8. [完整数据流：用户发消息到 UI 渲染](#8-完整数据流用户发消息到-ui-渲染)
9. [关键设计模式](#9-关键设计模式)
10. [附录：文件索引与行号](#10-附录文件索引与行号)

---

## 1. 架构总览

### 三进程模型

Desktop 应用由**三个进程**组成：

```
┌─────────────────────────────────────────────────────────────────────┐
│ 进程 1: Electron Renderer (React UI)                                │
│ • 渲染聊天界面、工具调用展示、审批弹窗                              │
│ • 通过 contextBridge 暴露的 IPC API 与 Main 进程通信                 │
│ • 不直接访问 Gateway HTTP — 所有请求经 Main 进程代理                 │
└───────────────────────────┬─────────────────────────────────────────┘
                            │ IPC (ipcRenderer.invoke / ipcRenderer.on)
┌───────────────────────────▼─────────────────────────────────────────┐
│ 进程 2: Electron Main (Node.js)                                    │
│ • gateway.ts: 启动/管理 Python Gateway 子进程                       │
│ • chat.ts: 编排聊天流程 (startChat → runChat)                       │
│ • runtimeClient.ts: HTTP/SSE 客户端 (fetch 到 Gateway)              │
│ • sseParser.ts: SSE 帧解析                                          │
│ • preload.ts: contextBridge IPC 桥接                                │
│ • 120+ 个模块: 工作区管理、审批、附件、语音、终端...                │
└───────────────────────────┬─────────────────────────────────────────┘
                            │ HTTP (fetch, localhost) + SSE
┌───────────────────────────▼─────────────────────────────────────────┐
│ 进程 3: Python Gateway (FastAPI / uvicorn)                         │
│ • gateway_legacy.py: FastAPI 应用、路由、AgentManager              │
│ • runtime/: 安全边界、权限、Kernel 决策引擎、状态持久化              │
│ • DrSaiAssistant: 智能体 (LLM 调用、工具执行、子智能体)             │
└─────────────────────────────────────────────────────────────────────┘
```

### 通信路径汇总

```
用户输入
  ↓
[Renderer] ipcRenderer.invoke("desktop:chat-start", request)
  ↓ IPC
[Main] startChat(webContents, request) → runChat()
  ↓ HTTP POST + SSE
[Gateway] POST /v1/chat/completions → AgentManager.run_stream()
  ↓ 函数调用
[Runtime] 安全检查 → Agent Kernel 决策编排
  ↓ 函数调用
[DrSaiAssistant] run_stream() → LLM → 工具 → 子智能体
  ↓ async yield 事件
[Gateway] StreamingResponse(text/event-stream)
  ↓ SSE chunks
[Main] runtimeClient → sseParser → emit(webContents, ChatEvent)
  ↓ IPC push
[Renderer] ipcRenderer.on("desktop:chat-event", callback)
  ↓
UI 渲染
```

---

## 2. Electron 进程模型

### Renderer 进程 (React UI)

**入口**: `apps/desktop/renderer/`

Renderer 进程是用户看到的界面。它**不能直接访问文件系统或网络**（Electron 安全模型），所有系统操作必须通过 IPC 桥接。

**关键 IPC 接口** (`preload.ts` 通过 `contextBridge.exposeInMainWorld` 暴露):

```typescript
// 请求-响应模式 (ipcRenderer.invoke)
window.desktop.chat.start(request)           // 启动聊天
window.desktop.chat.cancel(identity)          // 取消当前轮
window.desktop.chat.respondInput(request)    // 发送后续输入（如审批回复）
window.desktop.threads.list()                // 获取会话列表
window.desktop.workspaces.list()             // 获取工作区列表

// 事件推送模式 (ipcRenderer.on)
ipcRenderer.on("desktop:chat-event", callback)  // 接收聊天事件流
ipcRenderer.on("desktop:lifecycle-event", callback) // 生命周期事件
ipcRenderer.on("desktop:diagnostics-event", callback) // 诊断事件
```

**ChatEvent 类型** (Renderer 接收的事件):

```typescript
type ChatEvent = 
  | { type: "start", requestId, sessionId, runId }
  | { type: "delta", content, reasoningContent? }    // LLM 流式文本
  | { type: "tool_start", toolName, args }            // 工具开始
  | { type: "tool_complete", toolName, result }       // 工具完成
  | { type: "input_request", prompt, options }        // 需要用户输入（审批）
  | { type: "connection", connection: {...} }         // 连接状态
  | { type: "error", error, errorEnvelope }           // 错误
  | { type: "aborted" }                               // 取消
  | { type: "complete" }                               // 完成
```

### Main 进程 (Node.js 后端)

**入口**: `apps/desktop/main/` → `apps/desktop/shared/main/` (120+ 个 TypeScript 文件)

Main 进程是 Desktop 的核心编排层。它负责：
1. **启动和管理 Gateway 子进程** (`gateway.ts`)
2. **编排聊天流程** (`chat.ts`)
3. **HTTP/SSE 通信** (`runtimeClient.ts`)
4. **SSE 解析** (`sseParser.ts`)
5. **IPC 桥接** (`preload.ts`)
6. **工作区管理** (`workspaces.ts`, `workspaceContext.ts`)
7. **审批管理** (`approvalStore.ts`)
8. **附件处理** (`chat.ts` 中的 stageAttachments/preflightAttachments)
9. **终端模拟** (`terminalReplay.ts`)
10. **语音 TTS** (`voice.ts`, `voiceTts.ts`)
11. **诊断** (`diagnostics.ts`, `productionDiagnostics.ts`)
12. **OAEP 事件流** (`oaepSessionStream.ts`)

**核心模块关系**:

```
preload.ts ←─ contextBridge ──→ Renderer
    ↓ IPC
chat.ts ────→ startChat() / runChat() / cancelChatTurn() / respondChatInput()
    ↓
runtimeClient.ts ──→ LocalRuntimeClient / RemoteRuntimeClient
    ↓                   ↓
    ↓               fetch() HTTP/SSE
    ↓                   ↓
gateway.ts ──→ startGateway() / startGatewayOnce() ──→ spawn("python -m drsai.backend.gateway")
    ↓
sseParser.ts ──→ parseChatSseFrame() / parseAgentLogSseFrame() / ...
```

---

## 3. Gateway 进程管理

### 启动流程 (`gateway.ts`)

**入口函数**: `startGateway()` (line 182) → `startGatewayOnce()` (line 434)

```
startGateway()
  ↓ (单例锁，防止重复启动)
startGatewayOnce()
  ├── 1. 检查已运行的 Gateway 是否健康 → checkGatewayReady()
  │     └── 健康 → 同步认证身份 → 返回 true
  ├── 2. 探测端口 → probeGatewayEndpoints()
  │     ├── 端口可用且健康 → 采用现有进程 (adoptedPersistentRuntime = true)
  │     ├── 端口被占用但不健康 → 清理占用者 → killPortOccupant()
  │     └── 端口空闲 → 继续到步骤 3
  ├── 3. 解析 Python 可执行文件 → resolveGatewayPythonExecutable()
  ├── 4. 构建 spawn 参数
  │     ├── 热重载模式 (非 Windows): ["-m", "uvicorn", "drsai.backend.gateway:app", "--reload"]
  │     └── 标准模式: ["-m", "drsai.backend.gateway"]
  └── 5. spawn 子进程
        env: {
          DRSAI_HOME, DRSAI_API_PORT,
          OPENDRSAI_GATEWAY_INSTANCE_TOKEN,
          OPENDRSAI_DESKTOP_RUNTIME: "1",
          DRSAI_USER_ID: desktopUserId,
          PATH: getEnhancedPath()
        }
```

### 环境变量

| 变量 | 用途 | 来源 |
|------|------|------|
| `DRSAI_HOME` | DrSai 安装目录 | `paths.ts` |
| `DRSAI_PYTHON` | Python 可执行文件路径 | `paths.ts` |
| `DRSAI_REPO` | 仓库根目录 (开发模式) | `paths.ts` |
| `DRSAI_API_PORT` | Gateway HTTP 端口 | `gateway.ts` |
| `OPENDRSAI_GATEWAY_INSTANCE_TOKEN` | Gateway 实例认证令牌 | `gateway.ts` |
| `OPENDRSAI_DESKTOP_RUNTIME` | 标记为 Desktop 启动的 Runtime | `gateway.ts` |
| `DRSAI_USER_ID` | 用户身份 | `gateway.ts` |
| `OPENDRSAI_DESKTOP_DEV` | 开发模式标志 | 环境继承 |
| `OPENDRSAI_ENABLE_REGRESSION_CONTROL` | 回归控制 (开发模式) | `gateway.ts` |

### 健康检查

**函数**: `checkGatewayReady()` (line 161)

```
GET http://127.0.0.1:PORT/health
  → 200 + { status: "ok" }  →  ready = true
  → 其他                    →  ready = false
```

使用 `http.get()` (Node.js 原生 HTTP)，带 `OPENDRSAI_GATEWAY_INSTANCE_TOKEN` 认证头，超时 5 秒。

### 进程生命周期管理

- `managedProcessRegistry.ts`: 统一管理所有子进程
- `gatewayProcess` 变量: 当前 Gateway 子进程引用
- `PERSIST_RUNTIME`: 是否持久运行 (打包模式 detached=true)
- `windowsHide: true`: Windows 上隐藏控制台窗口
- 进程退出时: `gatewayRegistration.crashed()` 或 `.exited()`，触发 `invalidateGatewayObservation()`

### Gateway 启动模式

| 模式 | 说明 | 触发条件 |
|------|------|---------|
| `managed` | Desktop 自己 spawn 的 Gateway | 默认 (打包模式) |
| `external` | 外部管理的 Gateway (如开发模式 dev.ps1) | `getGatewayStartupMode() === "external"` |
| `adopt` | 采用已运行的健康 Gateway | 探测发现端口有健康进程 |

---

## 4. HTTP/SSE 通信协议

### RuntimeClient 抽象

**文件**: `runtimeClient.ts`

```
RuntimeClient (interface)
  ├── LocalRuntimeClient  ── 本地 Gateway (http://127.0.0.1:PORT)
  └── RemoteRuntimeClient ── 远程 SSH Gateway
      └── HttpRuntimeClient (abstract base)
          └── request(path, init) ── fetch(${baseUrl}${path}, ...)
```

**LocalRuntimeClient** (line 1483):
- 必须使用 loopback: `http://127.0.0.1:PORT` (正则验证)
- `connectIfAvailable()`: 检查 Gateway 健康但不启动
- `forAccess(baseUrl, headers)`: 工厂方法

**RemoteRuntimeClient** (line 1569):
- 用于 SSH 远程工作区
- 携带 token 认证
- 支持 `RemoteProtocolError` 错误处理

### 核心 HTTP 请求方法

**`request(path, init)`** (line 1439):
```typescript
protected async request(path: string, init: RequestInit): Promise<Response> {
  response = await fetch(`${this.access.baseUrl}${path}`, {
    ...init,
    headers: {
      "X-Correlation-ID": randomUUID(),       // 请求追踪
      ...getDiagnosticPropagationHeaders(),     // 诊断传播
      ...this.access.headers,                  // 认证头
      ...init.headers,                         // 调用者头
    },
    signal: AbortSignal.any([
      this.lifecycle.signal,                   // 生命周期信号
      init.signal ?? AbortSignal.timeout(30_000),  // 30s 超时
    ]),
  });
  if (!response.ok) {
    body = await response.json();
    throw parseRemoteProtocolError(response.status, body, ...);
  }
  return response;
}
```

### createRun — 聊天请求

**`createRun(request, signal)`** (line 1251):
```typescript
async createRun(request: RuntimeRunRequest, signal?: AbortSignal): Promise<RuntimeRunStream> {
  const requestId = randomUUID();
  const response = await this.request("/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "text/event-stream",           // SSE 流式
      "Idempotency-Key": requestId,             // 幂等键
    },
    body: JSON.stringify(request),
    signal,
  });
  return { requestId, response, events: response.body };  // ReadableStream
}
```

### SSE 帧解析

**文件**: `sseParser.ts`

Desktop Main 进程将 Gateway 返回的 SSE 流 (`ReadableStream<Uint8Array>`) 解析为结构化事件：

| 解析函数 | 输入 | 输出 |
|---------|------|------|
| `parseCompletionSseFrame(frame)` | SSE `data:` 行 | 文本 delta 列表 |
| `parseAgentLogSseFrame(frame)` | agent_log 帧 | `AgentLogSsePayload` |
| `parseChatSseErrorFrame(frame)` | error 帧 | `ChatSseError` |
| `parseChatReasoningSseFrame(frame)` | reasoning 帧 | 推理内容 delta |
| `parseStructuredConversationSseFrame(frame)` | 结构化对话帧 | 结构化数据 |
| `parseProviderUsageAnalyticsSseFrame(frame)` | 用量分析帧 | `ProviderUsageAnalyticsEvent` |
| `parseProviderErrorAnalyticsSseFrame(frame)` | 错误分析帧 | `ProviderErrorAnalyticsEvent` |
| `parseProviderStatusSseFrame(frame)` | 提供商状态帧 | 状态信息 |
| `parseAgentInputRequestSseFrame(frame)` | 输入请求帧 | `AgentInputRequestSsePayload` |
| `parseAgentRunSseFileEvents(frame)` | 文件事件帧 | 文件事件列表 |

**SSE 帧格式** (Gateway 端):
```
data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n
data: {"type":"agent_log","level":"info","message":"..."}\n\n
data: {"type":"input_request","prompt":"...","options":[...]}\n\n
data: [DONE]\n\n
```

### 其他通信端点

| 端点 | 方法 | 用途 |
|------|------|------|
| `/health` | GET | 健康检查 |
| `/v1/chat/completions` | POST (SSE) | 聊天/智能体运行 |
| `/v1/threads` | GET | 会话列表 |
| `/v1/threads/{id}` | GET/PUT | 会话详情/更新 |
| `/v1/workspaces` | POST | 创建工作区 |
| `/v1/workspaces/{id}/session-catalog-events/stream` | GET (SSE) | 工作区会话目录事件流 |
| `/v1/owop` | POST | OWOP 工作区对象操作 |
| `/v1/pty` | WebSocket | 终端 PTY |
| `/v1/runtime` | GET | Runtime 状态 |
| `/v1/runtime/shutdown` | POST | 关闭 Runtime |
| `/v1/capabilities` | GET | 能力清单 |
| `/v1/agent-definitions` | GET | 智能体定义 |
| `/v1/agent-backends/{id}/models` | GET | 模型列表 |
| `/v1/agent-backends/{id}/account` | GET | 账户状态 |
| `/v1/sessions/{id}/agent-backend/history/sync` | POST | 历史同步 |
| `/v1/mobile-pairing/*` | various | 移动配对 |
| `/v1/runs/{id}/experiments` | POST | 创建实验 |
| `/v1/run-comparisons` | POST | 运行比较 |

---

## 5. Gateway 后端路由

### FastAPI 应用

**文件**: `backend/gateway_legacy.py` (~10000 行)

```
FastAPI app
  ├── /health                        → 健康检查
  ├── /v1/runtime                    → Runtime 状态
  ├── /v1/capabilities               → 能力清单
  ├── /v1/agent-definitions          → 智能体定义
  ├── /v1/chat/completions           → ★ 核心: 聊天/运行 (SSE)
  ├── /v1/threads                    → 会话 CRUD
  ├── /v1/workspaces                 → 工作区管理
  ├── /v1/owop                       → OWOP 工作区对象协议
  ├── /v1/agent-backends             → 模型/账户管理
  ├── /v1/mobile-pairing             → 移动配对
  ├── /v1/runs/*/experiments         → 实验管理
  └── /v1/run-comparisons            → 运行比较
```

### 聊天路由 — `/v1/chat/completions`

这是 OpenAI 兼容的聊天补全端点，也是 Desktop 智能体运行的核心入口。

```python
# gateway_legacy.py (line ~5280)
@app.post("/v1/chat/completions")
async def chat_completions(request: Request):
    # 1. 解析请求 (messages, stream, model, ...)
    # 2. 获取/创建智能体: AgentManager.get_or_create(user_id, thread_id)
    # 3. 调用: manager.run_stream(task, thread_id, user_id, ...)
    # 4. 返回: StreamingResponse(stream(), media_type="text/event-stream")
```

**AgentManager** (line 991):
- 管理智能体实例: `agents: Dict[str, Dict[str, DrSaiAssistant]]` (按 `user_id:thread_id`)
- `run_stream()` (line 1476): asyncio.Lock 并发控制
- 内部调用 `agent.run_stream(task=task)` → 异步生成器

**StreamingResponse** (line 5291):
```python
return StreamingResponse(
    stream(),              # async generator → SSE data: lines
    media_type="text/event-stream",
)
```

### 事件序列

Gateway 的 `stream()` 生成器将 `agent.run_stream()` 产出的事件转为 SSE 帧：

```
data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n          ← LLM 流式文本
data: {"type":"agent_log","message":"Using tool..."}\n\n        ← 工具日志
data: {"type":"input_request","prompt":"Approve?","options":[...]}\n\n  ← 审批请求
data: {"choices":[{"delta":{"content":" world"}}]}\n\n         ← 更多文本
data: [DONE]\n\n                                                ← 完成
```

---

## 6. Runtime 中间件层

> 详细分析见 `docs/runtime-analysis.md`

Runtime 是 Gateway Python 进程**内部的中间件层**，不是独立的网络跳。它在 `FastAPI 路由 → AgentManager → DrSaiAssistant.run_stream()` 调用链中以函数调用形式插入。

### 三大职责

```
FastAPI 路由
  ↓
AgentManager.run_stream()
  ↓
┌─────────────────────────────────────────┐
│ Runtime 中间件                          │
│                                         │
│ 1. 安全检查 (security_boundary/)        │
│    → 文件系统隔离、命令审批、网络限制   │
│    → Windows 沙箱 / AppContainer       │
│                                         │
│ 2. 权限模式 (permission_modes/)         │
│    → 只读/写入/危险操作模式             │
│    → 自动审核 / 紧急停止                │
│                                         │
│ 3. Agent Kernel (mobile_core/engine.py)│
│    → Host-Driven 决策编排              │
│    → RuntimeEnvelope 消息协议           │
│    → 模型请求 → 工具调用 → 审批 → 产物 │
│                                         │
│ 4. 状态持久化 (engine.py)               │
│    → SQLite 加密存储                   │
│    → 会话/检查点/通道                   │
│                                         │
│ 5. OAEP 事件投影 (oaep.py)              │
│    → 内部事件 → 安全外部事件           │
│    → 敏感信息脱敏                       │
└─────────────────────────────────────────┘
  ↓
DrSaiAssistant.run_stream()
```

### Host-Driven Kernel 架构

```
Host (DrSaiAssistant)              ← 拥有 LLM/工具/技能，负责"执行"
       ↕ RuntimeEnvelope
Kernel (DrSaiAgentKernel)         ← 不含 I/O，只负责"决策编排"
       何时调模型？调哪些工具？需要审批？产物处理？
```

Kernel 不直接调用 LLM — 它通过 `RuntimeEnvelope` 消息协议"请求"Host 执行：

```
Kernel → Host:  MODEL_REQUEST     → Host 调用 LLM → MODEL_CHUNK/MODEL_COMPLETED
Kernel → Host:  TOOL_CALL_REQUEST → Host 执行工具 → TOOL_RESULT
Kernel → Host:  APPROVAL_REQUEST  → Host 请求用户 → APPROVAL_RESULT
Kernel → Host:  ARTIFACT_REQUEST  → Host 处理产物 → ARTIFACT_RESULT
```

---

## 7. 智能体执行

### DrSaiAssistant

**文件**: `modules/agents/skills_agent/drsai_assistant.py`

```python
class DrSaiAssistant(DrSaiAgent):
    async def run_stream(self, *, task, cancellation_token=None):
        # 检查 _shared_agent_kernel
        if self._shared_agent_kernel:
            # Runtime V2: 通过 Kernel 决策循环
            async for event in run_agent_through_kernel(self, task=task, ...):
                yield event
        else:
            # Runtime V1: 直接 LLM 循环 (legacy)
            async for event in self.on_messages_stream(task=task, ...):
                yield event
```

### 执行路径 (Runtime V2 — Kernel 路径)

```
run_stream()
  → run_agent_through_kernel()          (desktop_agent_kernel_adapter.py:821)
    ├── 安全绑定验证
    ├── 工具提升 (_elevate_tools_for_skill)
    ├── 记忆初始化 (_init_memory_documents)
    ├── 启动检查 (_run_startup_checks)
    └── DesktopKernelRunStream
        → Kernel.handle(START_RUN envelope)
          → _start_run() → 组装上下文 → MODEL_REQUEST
            → Host 调用 _call_llm() → MODEL_COMPLETED
              → 检查工具调用 → TOOL_CALL_REQUEST
                → Host 执行工具 → TOOL_RESULT
                  → 循环 until COMPLETED
        → yield 所有事件
```

### 执行路径 (Runtime V1 — Legacy 直接路径)

```
run_stream()
  → on_messages_stream()
    → _call_llm()                     (line 1949)
      → _process_model_result()       (line 2281)
        → 工具调用 → _execute_tool()
        → 子智能体 → _execute_subagent()
        → 循环 until 无更多工具调用
    → yield 事件
```

### 工具分类

| 分类 | 说明 | 示例 |
|------|------|------|
| `_DESKTOP_READ_ONLY_TOOLS` | 只读工具，无需审批 | 文件读取、搜索 |
| `_DESKTOP_LOCAL_WRITE_TOOLS` | 本地写入工具 | 文件创建、编辑 |
| `_DESKTOP_CONDITIONAL_TOOLS` | 条件工具，根据参数决定是否需要审批 | bash (只读命令 vs 写入命令) |
| `_DESKTOP_REQUIRED_APPROVAL_TOOLS` | 必须审批的工具 | 危险命令、系统修改 |

### 子智能体系统

```
_create_local_subagent()     (line 3115) → 本地子智能体
_create_remote_subagent()   (line 3193) → 远程子智能体
_create_daemon_subagent()   (line 3223) → 守护进程子智能体
_execute_subagent()         (line 3342) → 串行执行
_execute_subagents_parallel() (line 3434) → 并行执行
```

---

## 8. 完整数据流：用户发消息到 UI 渲染

### 步骤 1: 用户输入

```
[Renderer] 用户在聊天框输入 "帮我分析这个文件"
  → 点击发送
  → window.desktop.chat.start({
      messages: [{ role: "user", content: "帮我分析这个文件" }],
      sessionId: "thread-xxx",
      workspaceId: "ws-xxx",
      agentId: "my-drsai",
      attachments: [...],
    })
  → ipcRenderer.invoke("desktop:chat-start", request)
```

### 步骤 2: Main 进程接收

```
[Main] ipcMain.handle("desktop:chat-start")
  → startChat(webContents, request)                    (chat.ts:194)
    ├── validateChatRequest(request)
    ├── 生成 requestId (randomUUID)
    ├── 创建 AbortController
    ├── 存入 chatTurns Map
    ├── 启动诊断追踪
    └── runChat(webContents, requestId, request, controller)  (chat.ts:964)
        → 异步执行，错误时 emit("error"/"aborted")
```

### 步骤 3: 连接 Runtime

```
[Main] runChat()
  → connectRuntimeClientForWorkspace(workspacePath, workspaceId)
    → 检查 Gateway 健康: getGatewayStatus()
    → 创建 LocalRuntimeClient.forAccess("http://127.0.0.1:PORT", headers)
    → 返回 RuntimeClient 实例
  → emit(webContents, { type: "start", requestId, sessionId, runId })  (chat.ts:1037)
    → webContents.send("desktop:chat-event", event)
      → Renderer 收到 "start" 事件 → 显示加载状态
```

### 步骤 4: HTTP 请求到 Gateway

```
[Main] runtimeClient.createRun(request, signal)
  → fetch("http://127.0.0.1:PORT/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        "Idempotency-Key": "<uuid>",
        "X-Correlation-ID": "<uuid>",
        ...authHeaders,
      },
      body: JSON.stringify({
        messages: [...],
        stream: true,
        model: "...",
        ...
      }),
      signal: abortController.signal,
    })
  → 返回 RuntimeRunStream { events: ReadableStream }
```

### 步骤 5: Gateway 处理

```
[Gateway] POST /v1/chat/completions
  → FastAPI 路由处理
    → AgentManager.get_or_create(user_id, thread_id)
      → create_agent() → DrSaiAssistant 实例
      → agent.lazy_init() → 加载技能/工具/记忆
      → agent.load_state() → 恢复历史状态
    → manager.run_stream(task=task, thread_id, user_id)
      → asyncio.Lock 并发控制
      → agent.run_stream(task=task)
```

### 步骤 6: Runtime 中间件

```
[Runtime] agent.run_stream()
  → 检查 _shared_agent_kernel → 走 Kernel 路径
  → run_agent_through_kernel(agent, task, ...)
    ├── 安全绑定验证 (security_boundary/)
    ├── 工具提升 (_elevate_tools_for_skill)
    ├── 记忆初始化 (_init_memory_documents)
    └── Kernel 决策循环
      → MODEL_REQUEST → Host._call_llm() → MODEL_COMPLETED
      → TOOL_CALL_REQUEST → 安全检查 → 执行工具 → TOOL_RESULT
      → (循环直到完成)
    → yield 事件流
```

### 步骤 7: SSE 流式返回

```
[Gateway] StreamingResponse(stream(), media_type="text/event-stream")
  → async generator 将 agent 事件转为 SSE 帧:
    data: {"choices":[{"delta":{"content":"我来"}}]}\n\n
    data: {"choices":[{"delta":{"content":"帮你"}}]}\n\n
    data: {"type":"agent_log","message":"Reading file..."}\n\n
    data: {"type":"tool_start","toolName":"read_file","args":{...}}\n\n
    data: {"type":"tool_complete","toolName":"read_file","result":{...}}\n\n
    data: {"choices":[{"delta":{"content":"分析完毕"}}]}\n\n
    data: [DONE]\n\n
```

### 步骤 8: Main 进程解析 SSE

```
[Main] 读取 ReadableStream
  → for await (chunk of response.body)
    → parseCompletionSseFrame(frame) → 文本 delta
    → parseAgentLogSseFrame(frame) → 工具日志
    → parseChatSseErrorFrame(frame) → 错误
    → parseAgentInputRequestSseFrame(frame) → 审批请求
    → ...
  → emit(webContents, { type: "delta", content: "我来" })
  → emit(webContents, { type: "tool_start", toolName: "read_file", ... })
  → emit(webContents, { type: "tool_complete", ... })
  → emit(webContents, { type: "delta", content: "分析完毕" })
  → emit(webContents, { type: "complete" })
```

### 步骤 9: IPC 推送到 Renderer

```
[Main] emit(webContents, event)
  → BoundedEventDispatcher → target.send("desktop:chat-event", event)
    → ipcMain → ipcRenderer (Electron IPC)

[Renderer] ipcRenderer.on("desktop:chat-event", callback)
  → callback(event)
    ├── type: "start"    → 显示加载动画
    ├── type: "delta"    → 追加文本到聊天框
    ├── type: "tool_start" → 显示工具调用卡片
    ├── type: "tool_complete" → 更新工具结果
    ├── type: "input_request" → 弹出审批对话框
    └── type: "complete" → 停止加载动画
```

### 步骤 10: 用户审批 (如果需要)

```
[Renderer] 用户点击 "批准"
  → window.desktop.chat.respondInput({
      requestId,
      sessionId,
      input: { approved: true, ... }
    })
  → ipcRenderer.invoke("desktop:chat-respond", request)

[Main] respondChatInput(rawRequest, eventTarget)    (chat.ts:654)
  → 获取对应的 chatTurn
  → 向 Gateway 发送审批结果
    → POST /v1/.../approval 或通过 RuntimeClient API
  → Gateway → Runtime → Kernel → APPROVAL_RESULT
    → Kernel 继续决策循环
    → 后续事件通过 SSE 流式返回
```

---

## 9. 关键设计模式

### 9.1 三进程隔离

```
Renderer (不可信)  ←IPC→  Main (可信)  ←HTTP→  Gateway (子进程)
```

- Renderer 不能直接访问文件系统或网络
- Main 进程是所有系统操作的代理
- Gateway 是独立的 Python 子进程，崩溃不影响 Electron

### 9.2 SSE 流式通信

选择 SSE 而非 WebSocket 的原因：
1. **单向推送**: 智能体 → 前端是主要数据流，SSE 天然适合
2. **HTTP 兼容**: 不需要协议升级，与 FastAPI 中间件兼容
3. **断线重连**: SSE 有内置重连机制 (`Last-Event-ID`)
4. **基础设施友好**: 穿透代理/CDN 比 WebSocket 更可靠

例外：终端 PTY 使用 WebSocket (`/v1/pty`)，因为需要双向交互。

### 9.3 幂等键 + 关联 ID

```
Idempotency-Key: <uuid>   → 防止重复执行同一请求
X-Correlation-ID: <uuid>  → 全链路请求追踪
```

### 9.4 断路器模式

**文件**: `agentCircuitBreaker.ts`

```typescript
// 连续失败时熔断，避免雪崩
assertAgentCircuitAvailable(agentId)  // 检查熔断状态
recordAgentCircuitFailure(agentId)    // 记录失败
recordAgentCircuitSuccess(agentId)    // 记录成功
```

### 9.5 流恢复

**文件**: `chat.ts` 中的 `RecoverableStreamError`, `createStreamAttemptCursor`, `StreamResumeState`

```typescript
// SSE 流中断后可恢复
const resumeState: StreamResumeState = { content: "", fileEventKeys: new Set() };
// 通过 Idempotency-Key 重连，Gateway 返回未消费的事件
```

### 9.6 BoundedEventDispatcher

**文件**: `boundedEventDispatcher.ts`

```typescript
// 有界事件分发器，防止 Renderer 消费慢时 Main 进程内存溢出
const dispatcher = new BoundedEventDispatcher<ChatEvent>({
  target: webContents,
  eventName: "desktop:chat-event",
  // 当队列超过阈值时丢弃旧事件或暂停生产
});
```

### 9.7 OWOP — 工作区对象协议

```
POST /v1/owop
{
  "version": "1.0",
  "request_id": "<uuid>",
  "correlation_id": "<uuid>",
  "workspace_id": "<ws-id>",
  "operation": "read_file" | "write_file" | "list_dir" | ...,
  "params": { ... },
  "binding": { "kind": "local_ipc" | "ssh" }
}
```

统一的文件系统操作协议，支持本地和 SSH 远程工作区。

### 9.8 OAEP — 事件投影

```
内部事件 (含敏感信息)
  → oaep.project_event() → 安全外部事件 (脱敏)
  → oaep.project_snapshot() → 安全状态快照
  → oaep.safe_error() → 安全错误信息
```

确保推送到前端的事件不包含 API key、文件路径、凭证等敏感数据。

---

## 10. 附录：文件索引与行号

### Desktop Electron (TypeScript)

| 文件 | 关键符号 | 行号 | 功能 |
|------|---------|------|------|
| `shared/main/gateway.ts` | `startGateway()` | 182 | 启动 Gateway |
| `shared/main/gateway.ts` | `startGatewayOnce()` | 434 | 启动实现 |
| `shared/main/gateway.ts` | `checkGatewayReady()` | 161 | 健康检查 |
| `shared/main/gateway.ts` | `getGatewayRequestHeaders()` | 130 | 请求头 |
| `shared/main/gateway.ts` | `resolveGatewayPythonExecutable()` | 664 | Python 路径 |
| `shared/main/gateway.ts` | `GATEWAY_BASE_URL` | 41 | HTTP 基地址 |
| `shared/main/gateway.ts` | `spawn(GATEWAY_PYTHON, args)` | ~524 | 子进程启动 |
| `shared/main/chat.ts` | `startChat()` | 194 | 启动聊天 |
| `shared/main/chat.ts` | `runChat()` | 964 | 聊天主流程 |
| `shared/main/chat.ts` | `cancelChatTurn()` | 264 | 取消聊天 |
| `shared/main/chat.ts` | `respondChatInput()` | 654 | 响应输入 |
| `shared/main/chat.ts` | `recoverChatRun()` | 346 | 恢复运行 |
| `shared/main/chat.ts` | `emit()` | ~78 | 事件推送 |
| `shared/main/chat.ts` | `getGatewayPort()` | 3400 | 端口获取 |
| `shared/main/runtimeClient.ts` | `RuntimeClient` (interface) | ~420 | 客户端接口 |
| `shared/main/runtimeClient.ts` | `HttpRuntimeClient` | 604 | HTTP 基类 |
| `shared/main/runtimeClient.ts` | `createRun()` | 1251 | 创建运行流 |
| `shared/main/runtimeClient.ts` | `request()` | 1439 | HTTP 请求 |
| `shared/main/runtimeClient.ts` | `LocalRuntimeClient` | 1483 | 本地客户端 |
| `shared/main/runtimeClient.ts` | `RemoteRuntimeClient` | 1569 | 远程客户端 |
| `shared/main/runtimeClient.ts` | `executeOWOP()` | ~1277 | OWOP 操作 |
| `shared/main/sseParser.ts` | `parseCompletionSseFrame()` | 234 | SSE 帧解析 |
| `shared/main/sseParser.ts` | `parseAgentLogSseFrame()` | 266 | 日志帧解析 |
| `shared/main/sseParser.ts` | `ChatSsePayload` | 21 | SSE 载荷类型 |
| `shared/main/preload.ts` | `contextBridge` | 1 | IPC 桥接 |
| `shared/main/threads.ts` | `listThreads()` | - | 会话列表 |
| `shared/main/agentCircuitBreaker.ts` | `assertAgentCircuitAvailable()` | - | 熔断检查 |

### Gateway 后端 (Python)

| 文件 | 关键符号 | 行号 | 功能 |
|------|---------|------|------|
| `backend/gateway_legacy.py` | `AgentManager` | 991 | 智能体管理器 |
| `backend/gateway_legacy.py` | `run_stream()` | 1476 | 运行流 |
| `backend/gateway_legacy.py` | `StreamingResponse` | 5291 | SSE 响应 |
| `backend/gateway_legacy.py` | `@app.get("/health")` | 4540 | 健康检查 |
| `backend/gateway_legacy.py` | `@app.post("/v1/chat/completions")` | ~5280 | 聊天端点 |
| `backend/run_drsai_agent_factory.py` | `create_agent()` | 726 | 智能体工厂 |

### Runtime 中间件

| 文件 | 关键符号 | 行号 | 功能 |
|------|---------|------|------|
| `backend/runtime/engine.py` | `RuntimeEngine` | 309 | 状态引擎 |
| `backend/runtime/agent_kernel.py` | `AgentRunConfig` | 1668 | 运行配置 |
| `backend/runtime/agent_kernel_factory.py` | `create_agent_kernel()` | ~20 | Kernel 工厂 |
| `backend/runtime/desktop_agent_kernel_adapter.py` | `run_agent_through_kernel()` | 821 | Kernel 桥接 |
| `backend/runtime/desktop_kernel_coordinator.py` | `DesktopKernelCoordinator` | 60 | 协调器 |
| `backend/runtime/desktop_kernel_run_stream.py` | `DesktopKernelRunStream` | 55 | 流式运行 |
| `backend/runtime/mobile_core/engine.py` | `DrSaiAgentKernel` | 267 | Kernel 实现 |
| `backend/runtime/mobile_core/protocol.py` | `RuntimeEnvelope` | ~35 | 消息协议 |
| `backend/runtime/security.py` | `RuntimeSecurity` | 241 | 安全门面 |
| `backend/runtime/oaep.py` | `project_event()` | - | 事件投影 |

### 智能体

| 文件 | 关键符号 | 行号 | 功能 |
|------|---------|------|------|
| `modules/agents/skills_agent/drsai_assistant.py` | `DrSaiAssistant` | 331 | 智能体类 |
| `modules/agents/skills_agent/drsai_assistant.py` | `run_stream()` | 1349 | 运行入口 |
| `modules/agents/skills_agent/drsai_assistant.py` | `on_messages_stream()` | 1491 | LLM 循环 |
| `modules/agents/skills_agent/drsai_assistant.py` | `_call_llm()` | 1949 | LLM 调用 |
| `modules/agents/skills_agent/drsai_assistant.py` | `_process_model_result()` | 2281 | 模型结果处理 |

---

> **总结**: Desktop 前后端逻辑由**三进程模型**组成。Electron Renderer (React UI) 通过 IPC 与 Electron Main 进程通信；Main 进程通过 HTTP/SSE 与 Python Gateway 子进程通信；Gateway 内部的 Runtime 中间件层负责安全、权限、Kernel 决策编排和状态持久化；最终由 DrSaiAssistant 智能体执行 LLM 调用、工具执行和子智能体调度。整个链路从用户输入到 UI 渲染经过 10 个步骤，使用 SSE 流式通信实现实时输出，通过幂等键、关联 ID、断路器和流恢复等模式保证可靠性。
