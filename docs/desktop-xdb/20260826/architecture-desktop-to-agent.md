# OpenDrSai 架构与数据通信文档

> **路径**: Desktop → Backend → DrSaiAssistant 智能体  
> **文档版本**: 2026-08-26  
> **范围**: `apps/desktop` → `cores/.../backend` → `cores/.../modules/agents/skills_agent/drsai_assistant.py`

---

## 目录

1. [架构总览](#1-架构总览)
2. [分层架构图](#2-分层架构图)
3. [第一层：Desktop Electron 应用 (`apps/desktop`)](#3-第一层desktop-electron-应用)
4. [第二层：TUI 前端 (`apps/ui-tui`)](#4-第二层tui-前端)
5. [第三层：Python 后端网关](#5-第三层python-后端网关)
6. [第四层：DrSaiAssistant 智能体](#6-第四层drsaiassistant-智能体)
7. [端到端数据通信流程](#7-端到端数据通信流程)
8. [关键设计模式](#8-关键设计模式)
9. [附录：关键文件索引](#9-附录关键文件索引)

---

## 1. 架构总览

OpenDrSai 采用 **四层分层架构**, 从用户界面到 AI 智能体形成完整的数据通路。系统存在两条独立的通信路径, 共享同一个智能体核心:

### 路径 A：Desktop HTTP 路径（桌面应用主路径）
```
Electron 主进程 (apps/desktop/shared/main/gateway.ts)
    ↓ spawn: python -m drsai.backend.gateway
HTTP Gateway (backend/gateway_legacy.py → FastAPI + uvicorn)
    ↓ AgentManager.run_stream()
    ↓ GatewayOpenDrSaiAgentBackend.execute()
DrSaiAssistant.run_stream() → yield events
    ↑ StreamingResponse (SSE/NDJSON) 回流
Electron 渲染进程 (Web UI)
```

### 路径 B：TUI/CLI JSON-RPC 路径（终端路径）
```
TUI 前端 (apps/ui-tui/src/gatewayClient.ts)
    ↓ spawn: python -m drsai.backend.tui_gateway  (stdio 模式)
    ↓ 或 WebSocket 连接 ws://127.0.0.1:port/attach
tui_gateway (backend/tui_gateway/ → JSON-RPC over stdio/WS)
    ↓ AgentSession.run_turn() → _async_run_turn()
    ↓ agent.run_stream() → translate() → on_event()
DrSaiAssistant.run_stream() → yield events
    ↑ JSON-RPC event frames 回流
TUI 前端 (Ink/React)
```

**两条路径共享同一个智能体实例工厂**: `run_drsai_agent_factory.create_agent()`

---

## 2. 分层架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                        用户交互层                                    │
│  ┌──────────────────────┐    ┌──────────────────────────────────┐  │
│  │  Desktop Electron     │    │  TUI (React/Ink)                 │  │
│  │  (apps/desktop/windows)│   │  (apps/ui-tui)                   │  │
│  │  - BrowserWindow      │    │  - gatewayClient.ts             │  │
│  │  - IPC (preload)       │    │  - turnController.ts            │  │
│  │  - gateway.ts          │    │  - gatewayTypes.ts              │  │
│  └──────────┬─────────────┘    └────────────┬───────────────────┘  │
└─────────────┼─────────────────────────────────┼─────────────────────┘
              │ HTTP (localhost:PORT)            │ stdio / WebSocket
              ↓                                  ↓
┌─────────────────────────────────────────────────────────────────────┐
│                        后端网关层                                     │
│  ┌──────────────────────┐    ┌──────────────────────────────────┐  │
│  │  HTTP Gateway         │    │  tui_gateway (JSON-RPC)          │  │
│  │  (backend/gateway/)   │    │  (backend/tui_gateway/)          │  │
│  │  - FastAPI + uvicorn  │    │  - server.py (dispatch)          │  │
│  │  - AgentManager       │    │  - transport.py (stdio/WS)       │  │
│  │  - GatewayBackend     │    │  - adapter/agent_runner.py       │  │
│  └──────────┬─────────────┘    └────────────┬───────────────────┘  │
└─────────────┼─────────────────────────────────┼─────────────────────┘
              │                                  │
              └──────────┬───────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────────────┐
│                     智能体核心层                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  run_drsai_agent_factory.create_agent()                     │   │
│  │  → DrSaiAssistant (extends DrSaiAgent)                      │   │
│  │                                                              │   │
│  │  核心方法:                                                    │   │
│  │  - run_stream()     → 异步生成器, yield 事件流                │   │
│  │  - on_messages_stream() → LLM 循环 + 工具调用                 │   │
│  │  - _call_llm()      → 调用模型客户端                          │   │
│  │  - _process_model_result() → 处理模型响应                     │   │
│  │                                                              │   │
│  │  子智能体系统:                                                │   │
│  │  - _create_local_subagent()    → 本地子智能体                 │   │
│  │  - _create_remote_subagent()   → 远程子智能体                 │   │
│  │  - _create_daemon_subagent()   → 守护进程子智能体             │   │
│  │  - _execute_subagent()         → 执行子智能体                 │   │
│  │  - _execute_subagents_parallel() → 并行子智能体               │   │
│  │                                                              │   │
│  │  管理器:                                                      │   │
│  │  - UserProfileManager  → 用户画像                              │   │
│  │  - TodoManager         → 任务管理                              │   │
│  │  - TaskPlanner         → 任务规划                              │   │
│  │  - LongTermMemoryManager → 长期记忆                           │   │
│  │  - ScheduledTaskManager → 定时任务                             │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. 第一层：Desktop Electron 应用

### 3.1 架构概述

**关键文件**:
- `apps/desktop/windows/src/main/index.ts` — Electron 主进程入口
- `apps/desktop/shared/main/gateway.ts` — 网关进程管理（核心）
- `apps/desktop/windows/src/main/gateway.ts` — 平台适配器（re-export shared）
- `apps/desktop/windows/src/preload/workbench.ts` — IPC 预加载脚本

Electron 桌面应用采用 **主进程 + 渲染进程** 架构:

- **主进程** (`index.ts`): 管理窗口生命周期、IPC 通道、子进程管理
- **渲染进程**: 加载 Web UI（内嵌 TUI 或独立 Web 前端）
- **Preload 脚本** (`preload/workbench.ts`): 在渲染进程中暴露安全的 IPC API

### 3.2 网关进程管理

**文件**: `apps/desktop/shared/main/gateway.ts`

Desktop 主进程通过 `startGateway()` 函数管理 Python 后端进程:

```typescript
// 启动命令 (第 ~500 行)
const args = ["-m", "drsai.backend.gateway"];  // 非 Windows 可选 --reload
gatewayProcess = spawn(GATEWAY_PYTHON, args, {
  cwd: DRSAI_REPO,
  env: {
    DRSAI_HOME,
    DRSAI_API_PORT: GATEWAY_PORT,        // 默认从 resolveGatewayPort() 获取
    OPENDRSAI_GATEWAY_INSTANCE_TOKEN,     // 实例令牌认证
    OPENDRSAI_DESKTOP_RUNTIME: "1",
    DRSAI_USER_ID: desktopUserId,         // 用户身份注入
    ...
  },
  windowsHide: true,
  detached: PERSIST_RUNTIME,              // 持久化运行
  stdio: PERSIST_RUNTIME ? "ignore" : ["ignore", "pipe", "pipe"],
});
```

**关键设计**:
- **健康探测**: 通过 `http://127.0.0.1:PORT/health` 探测网关存活
- **实例令牌认证**: `GATEWAY_INSTANCE_TOKEN` 防止未授权访问
- **进程持久化**: `PERSIST_RUNTIME` 控制是否在窗口关闭后保持运行
- **身份同步**: `syncAuthIdentityToGateway()` 将登录用户 ID 注入网关
- **端口占用检测**: 自动清理冲突进程
- **开发/打包模式**: `DEV_MANAGED_EXTERNAL_GATEWAY` 区分开发热重载和打包部署

### 3.3 IPC 通信

Desktop 通过 Electron 的 `ipcMain` / `ipcRenderer` 在主进程和渲染进程间通信:

```typescript
// index.ts 中注册的 IPC handlers
ipcMain.handle("gateway:start", startGateway);
ipcMain.handle("gateway:status", getGatewayStatus);
ipcMain.handle("gateway:shutdown", shutdownGateway);
// ... 大量 IPC handler
```

Preload 脚本在渲染进程暴露:
```typescript
// preload/workbench.ts
contextBridge.exposeInMainWorld("drsai", {
  gateway: { start, getStatus, shutdown },
  // ...
});
```

### 3.4 数据通信协议（Desktop → Gateway）

Desktop 与 HTTP Gateway 通信使用 **RESTful HTTP + SSE/Streaming**:

| 操作 | HTTP 方法 | 路径 | 说明 |
|------|----------|------|------|
| 健康检查 | GET | `/health` | 探测网关存活 |
| 模型列表 | GET | `/v1/models` | 获取可用模型 |
| 用户身份 | PUT | `/v1/config/user-name` | 同步用户 ID |
| 会话列表 | GET | `/v1/threads` | 获取会话列表 |
| 运行智能体 | POST | `/v1/.../run` | 触发 `run_stream()` (StreamingResponse) |
| 取消运行 | POST | `/v1/.../cancel` | 取消当前运行 |

---

## 4. 第二层：TUI 前端

### 4.1 架构概述

**关键文件**:
- `apps/ui-tui/src/gatewayClient.ts` — JSON-RPC 网关客户端（核心）
- `apps/ui-tui/src/gatewayTypes.ts` — 事件类型定义
- `apps/ui-tui/src/app/turnController.ts` — 对话轮次控制
- `apps/ui-tui/src/entry.tsx` — 入口

TUI 是基于 **React + Ink** 的终端 UI, 通过 `GatewayClient` 与 Python 后端通信。

### 4.2 GatewayClient 通信

`GatewayClient` 继承 `EventEmitter`, 支持两种传输模式:

#### stdio 模式（默认）
```typescript
// 启动 Python 子进程
this.proc = spawn(python, ['-m', 'drsai.backend.tui_gateway'], {
  cwd: gatewayCwd,
  env: { PYTHONPATH: resolvePythonSrcRoot(), ...process.env },
  stdio: ['pipe', 'pipe', 'pipe'],
});

// 从 stdout 读取 JSON-RPC 帧
const stdoutRl = createInterface({ input: this.proc.stdout! });
stdoutRl.on('line', raw => {
  this.dispatch(JSON.parse(raw));  // 分发响应/事件
});
```

#### WebSocket 模式（远程连接）
```typescript
// 通过 DRSAI_TUI_ATTACH_URL=ws://host:port/attach 连接
this.ws = new WebSocket(url);
this.ws.on('message', data => {
  this.dispatch(JSON.parse(data.toString()));
});
```

### 4.3 请求/响应机制

```typescript
// 发送 JSON-RPC 请求
request<T>(method: string, params: Record<string, unknown>): Promise<T> {
  const id = `r${++this.reqId}`;
  const frame = JSON.stringify({ id, jsonrpc: '2.0', method, params }) + '\n';
  // stdio: this.proc.stdin.write(frame)
  // websocket: this.ws.send(frame)
  return new Promise((resolve, reject) => {
    this.pending.set(id, { id, method, resolve, reject, timeout });
  });
}
```

### 4.4 事件分发

```typescript
private dispatch(frame: unknown): void {
  const f = frame as Record<string, unknown>;

  // 事件推送 (无 id, method === 'event')
  if (f.method === 'event') {
    const params = f.params as { type?: string; session_id?: string; payload?: unknown };
    const ev = { type: params.type, payload: params.payload, session_id: params.session_id };
    this.publish(ev as GatewayEvent);  // 触发 EventEmitter
    return;
  }

  // RPC 响应 (有 id)
  if (typeof f.id === 'string' && this.pending.has(f.id)) {
    const pending = this.pending.get(f.id)!;
    if ('error' in frame) {
      pending.reject(new Error(...));
    } else if ('result' in frame) {
      pending.resolve(frame.result);
    }
  }
}

private publish(ev: GatewayEvent): void {
  if (ev.type === 'gateway.ready') {
    this.ready = true;
    this.resolveReady();  // 解除 ready() 阻塞
  }
  this.emit('event', ev);      // 全局事件
  this.emit(ev.type, ev);     // 类型特定事件
}
```

### 4.5 事件类型联合 (`GatewayEvent`)

`gatewayTypes.ts` 定义了完整的 TypeScript 事件联合类型:

```typescript
export type GatewayEvent =
  // 生命周期
  | { type: 'gateway.ready'; payload?: { skin?: GatewaySkin; setup?: SetupStatus } }
  | { type: 'gateway.stderr'; payload: { line: string } }
  | { type: 'gateway.exit'; payload?: { code?: number; reason?: string } }
  // 消息流
  | { type: 'message.start'; payload?: { role?: 'assistant' } }
  | { type: 'message.delta'; payload: { text: string; rendered?: string } }
  | { type: 'message.complete'; payload: { text: string; usage: UsagePayload; status: string } }
  | { type: 'thinking.delta'; payload: { text: string } }
  // 工具
  | { type: 'tool.start'; payload: ToolStartPayload }
  | { type: 'tool.complete'; payload: ToolCompletePayload }
  | { type: 'artifact.created'; payload: ArtifactCreatedPayload }
  // 子智能体
  | { type: 'subagent.start'; payload: { source?: string; goal?: string } }
  | { type: 'subagent.thinking'; payload: { source?: string; text: string } }
  | { type: 'subagent.complete'; payload: { source?: string; text?: string } }
  // 交互请求
  | { type: 'approval.request'; payload: ApprovalRequestPayload }
  | { type: 'clarify.request'; payload: ClarifyRequestPayload }
  | { type: 'secret.request'; payload: SecretRequestPayload }
  // 状态
  | { type: 'status.update'; payload: { kind: string; text: string } }
  | { type: 'background.complete'; payload: BackgroundCompletePayload }
  | { type: 'error'; payload: { message: string } }
  // ... 更多类型
```

---

## 5. 第三层：Python 后端网关

### 5.1 两条网关路径

| 特性 | HTTP Gateway (`backend/gateway/`) | TUI Gateway (`backend/tui_gateway/`) |
|------|-----------------------------------|--------------------------------------|
| 协议 | HTTP REST + Streaming | JSON-RPC 2.0 over stdio/WebSocket |
| 服务框架 | FastAPI + uvicorn | 自定义 stdin 循环 + 可选 FastAPI WS |
| 主要用户 | Desktop Electron | TUI / CLI |
| 入口命令 | `python -m drsai.backend.gateway` | `python -m drsai.backend.tui_gateway` |
| 智能体调用 | `AgentManager.run_stream()` | `AgentSession.run_turn()` |
| 状态管理 | `_agents: dict[user_id:thread_id]` | `_sessions: dict[session_id]` |

### 5.2 HTTP Gateway（Desktop 路径）

**文件**: `backend/gateway_legacy.py` (由 `gateway/__init__.py` 重新执行)

#### AgentManager 类（第 991 行）

管理按 `(user_id, thread_id)` 键的智能体实例:

```python
class AgentManager:
    def __init__(self):
        self._agents: dict[str, Any] = {}       # "user_id:thread_id" → agent
        self._locks: dict[str, asyncio.Lock] = {}  # 并发控制锁
        self._global_lock = asyncio.Lock()

    async def run_stream(self, task, thread_id, user_id, ...):
        """运行 agent.run_stream(), 带并发保护"""
        key = self._make_key(uid, tid)
        lock = await self._get_lock(key)
        if lock.locked():
            raise HTTPException(503, "Session is busy")
        async with lock:
            agent = await self.get_or_create(thread_id=tid, user_id=uid, ...)
            async for event in agent.run_stream(task=task, cancellation_token=...):
                yield event  # 流式返回给 HTTP 客户端
```

#### GatewayOpenDrSaiAgentBackend 类（第 2716 行）

Runtime V2 的智能体后端适配器:

```python
class GatewayOpenDrSaiAgentBackend:
    """生产级 Desktop 智能体后端"""

    async def execute(self, context, definition, prompt, services):
        # 调用 manager.run_stream()
        run_stream = self._runner or manager.run_stream
        async for event in run_stream(task=input_task, thread_id=..., user_id=...):
            # 翻译事件为 Runtime 协议
            services.emit(context, event_type, payload)
```

#### 智能体创建流程

`AgentManager.get_or_create()` 调用 `create_agent()` 工厂:

```python
# gateway_legacy.py 第 ~1375 行
from drsai.backend.run_drsai_agent_factory import create_agent
create_agent_kwargs = dict(
    api_key=..., thread_id=..., user_id=..., db_manager=...,
    defult_config_name=..., cli_cfg=...,
    kernel_surface="desktop",  # 桌面模式
    work_dir=..., sub_agent_config=..., extra_tools=...,
    enable_security=...,
)
agent = await create_agent(**create_agent_kwargs)
await agent.lazy_init()
```

### 5.3 TUI Gateway（TUI/CLI 路径）

#### 传输层 (`transport.py`)

抽象传输接口, 支持 stdio 和 WebSocket:

```python
class Transport(Protocol):
    def write(self, obj: dict) -> bool: ...
    def close(self) -> None: ...

class StdioTransport(Transport):
    """JSON 帧 → stdout, 线程安全"""
    # 使用 _stdout_lock 序列化输出
    # 处理 BrokenPipeError, UnicodeEncodeError

class WebSocketTransport(Transport):
    """通过 asyncio.run_coroutine_threadsafe 安全写入 WebSocket"""
```

传输绑定使用 `ContextVar`:
```python
_current_transport: ContextVar[Optional[Transport]]
bind_transport(t) / reset_transport(token) / current_transport()
```

#### 消息分发 (`server.py`)

JSON-RPC 2.0 分发器, 使用装饰器注册模式:

```python
_methods: dict[str, callable] = {}  # 方法注册表
_sessions: dict[str, dict] = {}      # 会话状态
_pool = ThreadPoolExecutor(max_workers=4)  # 长任务线程池

@method("prompt.submit")
def _submit(rid, params):
    # 返回 {status: "streaming"} 立即响应
    # 在后台线程中运行 agent
    ...

_LONG_HANDLERS = frozenset({
    "prompt.submit", "session.resume", "slash.exec", "skills.manage", ...
})

def dispatch(req, transport=None):
    # 短任务: 内联执行
    # 长任务: _pool.submit(ctx.run(run))  → 线程池执行
```

#### 事件推送

```python
def _emit(event, sid, payload):
    """推送事件帧到前端"""
    write_json({
        "jsonrpc": "2.0",
        "method": "event",
        "params": {"type": event, "session_id": sid, "payload": payload}
    })

def write_json(obj):
    # 优先级: session 绑定的 transport > ContextVar transport > stdio
    if obj has session_id:
        transport = _sessions[sid]["transport"]
    else:
        transport = current_transport() or _stdio_transport
    transport.write(obj)
```

#### 阻塞式审批流

```python
def _block(event, sid, payload, timeout=300):
    """阻塞等待用户审批响应"""
    rid = uuid.uuid4().hex[:8]
    ev = threading.Event()
    _pending[rid] = (sid, ev)
    _emit(event, sid, {**payload, "request_id": rid})
    ev.wait(timeout=timeout)  # 阻塞最多 5 分钟
    return _answers.pop(rid, "")
```

#### Handler 注册表 (`handlers/__init__.py`)

```python
from . import (session, prompt, tools, slash, setup, paste,
               skills, scheduler, wechat, daemon, gfs, artifact,
               resource, remote)
# 每个模块的 @method 装饰器在导入时注册
```

| Handler 模块 | 方法 | 功能 |
|---|---|---|
| `session.py` | `session.create/list/resume/delete/interrupt` | 会话生命周期 |
| `prompt.py` | `prompt.submit/cancel` | 提交/取消对话 |
| `tools.py` | `approval.respond/clarify.respond/secret.respond` | 交互响应 |
| `slash.py` | `slash.exec` | 斜杠命令 |
| `skills.py` | `skills.manage` | 技能管理 |
| `artifact.py` | `artifact.metadata/chunk` | 产物获取 |
| `resource.py` | `files.register/resolve/read` | 文件资源 |
| `daemon.py` | `daemon.list/start/stop`, `subagent.invoke` | 守护进程 |
| `scheduler.py` | 调度器 RPC | 定时任务 |
| `remote.py` | `remote.connect/disconnect/exec` | SSH 远程 |
| `setup.py` | `setup.status/save` | 首次配置 |
| `paste.py` | `paste.collapse` | 大文本处理 |
| `gfs.py` | GFS 配置 | 文件系统配置 |
| `wechat.py` | 微信集成 | 微信通道 |

#### AgentSession 适配器 (`adapter/agent_runner.py`)

`AgentSession` 是 **同步 RPC ↔ 异步智能体** 的关键桥梁:

```python
class AgentSession:
    def __init__(self, session_id, user_id, cli_cfg, db_manager):
        # 每个会话拥有独立的 asyncio 事件循环（运行在守护线程上）
        self._loop = asyncio.new_event_loop()
        self._loop_thread = Thread(target=self._loop.run_forever, daemon=True)

    def _run_coro(self, coro, timeout=None):
        """同步→异步桥接"""
        return asyncio.run_coroutine_threadsafe(coro, self._loop).result(timeout)

    async def _async_init(self):
        from drsai.backend.run_drsai_agent_factory import create_agent
        self.agent = create_agent(
            api_key=..., thread_id=session_id, user_id=...,
            kernel_surface="tui",  # TUI 模式
            work_dir=...
        )
        await self.agent.lazy_init()

    def run_turn(self, text, on_event, images=None):
        """提交用户消息, 流式回调事件"""
        self._run_coro(self._async_run_turn(text, on_event, images))

    async def _async_run_turn(self, text, on_event, images):
        async for message in self.agent.run_stream(task=task):
            events = translate(message, state)  # 翻译 autogen 事件
            for ev_type, payload in events:
                on_event(ev_type, payload)       # 回调推送
```

#### 事件翻译器 (`adapter/event_translator.py`)

`translate()` 是纯函数, 将 autogen 消息翻译为网关事件:

| autogen 事件 | 网关事件 | 说明 |
|---|---|---|
| `ModelClientStreamingChunkEvent` | `message.delta` | 文本流增量 |
| `ThoughtEvent` | `thinking.delta` | 思考过程 |
| `ToolCallRequestEvent` | `tool.start` | 工具调用开始 |
| `ToolCallExecutionEvent` | `tool.complete` | 工具调用完成 |
| `TextMessage` (source="sub:") | `subagent.complete` | 子智能体完成 |
| `FilesEvent` | `artifact.created` | 文件产物 |
| `UserInputRequestedEvent` | `interaction.request` | 需要用户输入 |
| `MemoryQueryEvent` | `status.update` (kind=memory) | 记忆查询 |
| `AgentLogEvent` | `status.update` (kind=log) | 日志 |
| `TaskResult` | (usage 扫描) | 最终结果 |

---

## 6. 第四层：DrSaiAssistant 智能体

### 6.1 类继承结构

```
DrSaiAgent (baseagent/drsaiagent.py)
    ↑
DrSaiAssistant (skills_agent/drsai_assistant.py, 第 331 行)
    ↑
DrSaiCLIAssistant (skills_agent/drsai_cli_assistant.py)
```

### 6.2 构造函数

```python
class DrSaiAssistant(DrSaiAgent):
    def __init__(
        self, name, *,
        model_client: ChatCompletionClient,
        tools: List[BaseTool],
        workbench: Workbench,
        model_context: ChatCompletionContext,
        system_message: str,
        memory: Sequence[Memory],
        db_manager: DatabaseManager,
        thread_id: str,
        user_id: str,
        work_dir: str,              # 工作目录
        storage_dir: str,           # 存储目录
        only_in_workspace: bool,    # 工具限制在工作目录内
        skills_dir: str | List[str],# 技能目录
        sub_agent_config: Dict,     # 子智能体配置
        max_agent_concurrent: int,  # 最大并行子智能体
        max_turn_count: int,        # 最大轮次
        max_tool_rounds_ceiling: int,  # 工具调用上限
        context_type: str,          # "sqlite" 或 "ragflow"
        ...
    ):
```

### 6.3 核心方法

#### `run_stream()` (第 1349 行) — 智能体入口

```python
async def run_stream(
    self, *,
    task: str | BaseChatMessage | Sequence[BaseChatMessage] | None = None,
    cancellation_token: CancellationToken | None = None,
) -> AsyncGenerator[BaseAgentEvent | BaseChatMessage | TaskResult, None]:
    """运行智能体, 返回事件流"""

    # 1. 如果有 _shared_agent_kernel, 走 Runtime Kernel 路径
    if use_kernel_stream:
        async for event in run_agent_through_kernel(self, task=task, ...):
            yield event
        return

    # 2. 构建输入消息
    if isinstance(task, str):
        text_msg = TextMessage(content=task, source="user")
        yield text_msg

    # 3. 进入消息流循环
    async for message in self.on_messages_stream(input_messages, cancellation_token):
        if isinstance(message, Response):
            yield message.chat_message
            yield TaskResult(messages=output_messages)
        else:
            yield message  # 流式输出: delta, tool events, thinking, etc.
```

#### `on_messages_stream()` (第 1491 行) — LLM 循环

这是智能体的核心循环, 负责多轮 LLM 调用 + 工具执行:

```
循环逻辑:
1. 更新系统提示 (update_system_prompt)
2. 更新用户技能 (update_user_skills)
3. 更新用户工具 (update_user_tools)
4. 调用 LLM (_call_llm)
5. 处理模型响应 (_process_model_result)
   - 如果有工具调用 → 执行工具 → 回到步骤 4
   - 如果是文本响应 → yield Response → 结束
   - 如果是子智能体委派 → 执行子智能体 → 回到步骤 4
6. yield 所有中间事件 (delta, tool events, thinking, etc.)
```

#### `_call_llm()` (第 1949 行)

调用模型客户端, 带重试机制:
- `llm_max_retries`: 最大重试次数（默认 3）
- `llm_retry_base_delay`: 指数退避基础延迟（默认 2.0s）
- 流式输出: `model_client_stream=True` 时 yield `ModelClientStreamingChunkEvent`

#### `_process_model_result()` (第 2281 行)

处理 LLM 响应:
- 解析工具调用请求 → 执行工具 → yield `ToolCallExecutionEvent`
- 检测子智能体委派 → 调用 `_execute_subagent()` / `_execute_subagents_parallel()`
- 处理文本响应 → yield `Response`

### 6.4 子智能体系统

```python
# 本地子智能体
async def _create_local_subagent(self, sub_agent_name, ...) -> DrSaiAgent:
    # 创建独立的 DrSaiAgent 实例, 继承工具/技能配置

# 远程子智能体
async def _create_remote_subagent(self, sub_agent_name, ...) -> RemoteAgent:
    # 创建远程智能体, 通过网络通信

# 守护进程子智能体
async def _create_daemon_subagent(self, sub_agent_name, ...) -> DaemonSubagent:
    # 创建守护进程, 后台运行

# 执行子智能体
async def _execute_subagent(self, subagent, messages, ...) -> AsyncGenerator:
    # 调用 subagent.run_stream(), 转发事件
    # source 前缀 "sub:agent_name" 用于事件路由

# 并行子智能体
async def _execute_subagents_parallel(self, subagents, messages, ...) -> AsyncGenerator:
    # asyncio.gather() 并行执行多个子智能体
```

### 6.5 状态持久化

```python
def _to_config(self) -> DrSaiAssistantConfig:
    """导出智能体状态为配置字典"""
    return DrSaiAssistantConfig(
        system_message=..., tools=..., skills=...,
        sub_agent_config=..., model_config=...,
    )

@classmethod
def _from_config(cls, config: DrSaiAssistantConfig, ...):
    """从配置恢复智能体状态"""
```

### 6.6 工具系统

DrSaiAssistant 管理三类工具:

```python
_DESKTOP_READ_ONLY_TOOLS = {"run_read", "run_grep", "run_glob", "web_search", ...}
_DESKTOP_LOCAL_WRITE_TOOLS = {"run_write", "run_edit", "TodoWrite", "UpdateUserConfig"}
_DESKTOP_CONDITIONAL_TOOLS = {"run_bash", "run_powershell", ...}  # 需要审批
_DESKTOP_REQUIRED_APPROVAL_TOOLS = {"Delegate", "ScheduledTaskManager"}
```

工具权限分类:
- **只读工具**: 无需审批, 可自由执行
- **写入工具**: 在工作空间内可直接执行
- **条件工具**: 根据配置决定是否需要审批
- **审批工具**: 始终需要用户审批

### 6.7 管理器组件

| 管理器 | 文件 | 功能 |
|---|---|---|
| `UserProfileManager` | `managers/user_profile_manager.py` | 用户画像管理 |
| `TodoManager` | `managers/todo_manager.py` | 待办事项管理 |
| `TaskPlanner` | `managers/task_planner.py` | 任务规划与分解 |
| `LongTermMemoryManager` | `managers/memory_manager.py` | 长期记忆 |
| `ScheduledTaskManager` | `managers/scheduled_task_manager.py` | 定时任务 |
| `DaemonSubagent` | `daemon_subagent.py` | 守护进程子智能体 |

---

## 7. 端到端数据通信流程

### 7.1 Desktop 路径完整流程

```
用户在 Desktop UI 输入消息
    ↓
渲染进程 → IPC → 主进程
    ↓
gateway.ts: HTTP POST /v1/.../run { task: "...", thread_id: "..." }
    ↓
HTTP Gateway (gateway_legacy.py)
    ↓
AgentManager.run_stream(task, thread_id, user_id)
    ↓
get_or_create() → create_agent() → DrSaiAssistant 实例
    ↓
agent.lazy_init() → 加载技能/工具/记忆
    ↓
agent.load_state() → 恢复历史状态
    ↓
async for event in agent.run_stream(task=task):
    ↓
DrSaiAssistant.run_stream()
    ├→ on_messages_stream() 进入 LLM 循环
    │   ├→ update_system_prompt()    → 更新提示
    │   ├→ _call_llm()              → 调用模型, yield delta 事件
    │   ├→ _process_model_result()  → 处理响应
    │   │   ├→ 工具调用 → 执行 → yield tool events
    │   │   ├→ 子智能体 → _execute_subagent() → yield subagent events
    │   │   └→ 文本响应 → yield Response
    │   └→ 循环直到完成或取消
    ↓
StreamingResponse (SSE/NDJSON) → HTTP 响应流
    ↓
Electron 主进程 → IPC → 渲染进程
    ↓
Desktop UI 渲染流式输出
```

### 7.2 TUI 路径完整流程

```
用户在 TUI 输入消息
    ↓
GatewayClient.request("prompt.submit", {session_id, text})
    ↓
JSON-RPC 帧: {"id":"r1","jsonrpc":"2.0","method":"prompt.submit","params":{...}}
    ↓ (stdio stdin / WebSocket)
tui_gateway entry.py → server.dispatch(req)
    ↓
prompt._submit() handler:
    1. _ensure_agent_session() → 创建 AgentSession
    2. sess.init() → create_agent() → DrSaiAssistant
    3. 返回 {"status": "streaming"} 立即响应
    4. 后台线程: _run_turn_in_background()
    ↓
AgentSession.run_turn(text, _on_event)
    ↓
_run_coro(_async_run_turn())  [跨线程 async 桥接]
    ↓
async for message in agent.run_stream(task=task):
    events = translate(message, state)  [事件翻译]
    for ev_type, payload in events:
        on_event(ev_type, payload)
    ↓
_on_event → _emit(event_type, session_id, payload)
    ↓
write_json() → transport.write()
    ↓ (stdio stdout / WebSocket)
GatewayClient.dispatch(frame)
    ↓
publish(ev) → EventEmitter.emit(ev.type, ev)
    ↓
TUI React 组件渲染事件
```

### 7.3 交互审批流程

当智能体需要用户审批时（如执行危险命令）:

```
Desktop 路径:
    agent._tool_approval_handler(command) → HTTP 请求 → Desktop UI → 用户点击
    ↓ HTTP 响应
    agent 继续执行

TUI 路径:
    adapter/callbacks.py → server._block("approval.request", sid, payload)
    ↓ _emit 推送事件
    GatewayClient 收到 approval.request 事件
    ↓ TUI 显示审批 UI
    用户选择 → GatewayClient.request("approval.respond", {request_id, approved})
    ↓
    tools.py: _respond() → _answers[rid] = answer → threading.Event.set()
    ↓
    _block() 返回 → agent 继续执行
```

### 7.4 消息帧格式

#### JSON-RPC 请求（前端 → 网关）
```json
{
  "jsonrpc": "2.0",
  "id": "r1",
  "method": "prompt.submit",
  "params": {
    "session_id": "abc-123",
    "text": "帮我分析这段代码"
  }
}
```

#### JSON-RPC 响应（网关 → 前端）
```json
{
  "jsonrpc": "2.0",
  "id": "r1",
  "result": { "status": "streaming" }
}
```

#### 事件推送（网关 → 前端）
```json
{
  "jsonrpc": "2.0",
  "method": "event",
  "params": {
    "type": "message.delta",
    "session_id": "abc-123",
    "payload": { "text": "这段代码..." }
  }
}
```

---

## 8. 关键设计模式

### 8.1 装饰器注册模式
```python
# tui_gateway/server.py
_methods: dict[str, callable] = {}

@method("prompt.submit")
def _submit(rid, params): ...

@method("session.create")
def _create(rid, params): ...
```
所有 handler 在模块导入时自动注册, 无需中央配置。

### 8.2 传输抽象 + ContextVar 绑定
```python
# 支持 stdio + WebSocket 同时工作
_current_transport: ContextVar[Optional[Transport]]
# 每个请求绑定自己的 transport, 事件路由到正确的会话 transport
```

### 8.3 同步→异步桥接
```python
# AgentSession: 每个会话拥有独立的 asyncio 循环
self._loop = asyncio.new_event_loop()  # 守护线程
asyncio.run_coroutine_threadsafe(coro, self._loop).result()
# RPC handler (同步) → agent.run_stream() (异步)
```

### 8.4 立即返回 + 异步事件流
```python
# prompt.submit 立即返回 {status: "streaming"}
# 实际事件通过 _emit() 异步推送
# 前端通过 EventEmitter 监听事件类型
```

### 8.5 纯函数事件翻译
```python
# translate(message, state) → list[(event_type, payload)]
# 无副作用, 可独立测试
# TurnState 跟踪去重状态 (streamed_sources, pending_tool_calls, citation_ids)
```

### 8.6 状态持久化
```python
# 每轮对话后: agent.save_state() → compress_state() → db.upsert(Thread)
# 会话恢复时: decompress_state() → agent.load_state(state_dict)
```

### 8.7 并发控制
```python
# HTTP Gateway: asyncio.Lock per (user_id, thread_id)
# TUI Gateway: state["running"] flag + threading.Event
# 防止同一会话并发运行
```

---

## 9. 附录：关键文件索引

### Desktop 层
| 文件 | 行号 | 说明 |
|---|---|---|
| `apps/desktop/windows/src/main/index.ts` | - | Electron 主进程入口 |
| `apps/desktop/shared/main/gateway.ts` | 182 | `startGateway()` |
| `apps/desktop/shared/main/gateway.ts` | 434 | `startGatewayOnce()` - 进程创建 |
| `apps/desktop/shared/main/gateway.ts` | ~500 | `spawn(GATEWAY_PYTHON, args)` |
| `apps/desktop/windows/src/preload/workbench.ts` | - | IPC 桥接 |

### TUI 层
| 文件 | 行号 | 说明 |
|---|---|---|
| `apps/ui-tui/src/gatewayClient.ts` | - | `GatewayClient` 类 |
| `apps/ui-tui/src/gatewayClient.ts` | ~200 | `startSubprocess()` - spawn Python |
| `apps/ui-tui/src/gatewayClient.ts` | ~260 | `startWebSocket()` - WS 连接 |
| `apps/ui-tui/src/gatewayClient.ts` | ~290 | `request()` - 发送 RPC |
| `apps/ui-tui/src/gatewayClient.ts` | 620 | `dispatch()` - 帧分发 |
| `apps/ui-tui/src/gatewayClient.ts` | 654 | `publish()` - 事件发布 |
| `apps/ui-tui/src/gatewayTypes.ts` | - | `GatewayEvent` 联合类型 |
| `apps/ui-tui/src/app/turnController.ts` | - | 对话轮次控制 |

### HTTP Gateway 层
| 文件 | 行号 | 说明 |
|---|---|---|
| `backend/gateway/__init__.py` | - | 包入口 (re-exec legacy) |
| `backend/gateway/_app.py` | - | FastAPI 路由挂载 |
| `backend/gateway_legacy.py` | 991 | `AgentManager` 类 |
| `backend/gateway_legacy.py` | 1476 | `AgentManager.run_stream()` |
| `backend/gateway_legacy.py` | 2716 | `GatewayOpenDrSaiAgentBackend` |
| `backend/run_drsai_agent_factory.py` | 726 | `create_agent()` 工厂函数 |

### TUI Gateway 层
| 文件 | 行号 | 说明 |
|---|---|---|
| `backend/tui_gateway/entry.py` | 195 | `main()` 入口 |
| `backend/tui_gateway/server.py` | ~230 | `@method` 装饰器 |
| `backend/tui_gateway/server.py` | ~274 | `dispatch()` 路由 |
| `backend/tui_gateway/server.py` | ~175 | `_emit()` 事件推送 |
| `backend/tui_gateway/server.py` | ~186 | `_block()` 阻塞审批 |
| `backend/tui_gateway/transport.py` | ~50 | `Transport` 协议 |
| `backend/tui_gateway/transport.py` | ~80 | `StdioTransport` |
| `backend/tui_gateway/ws.py` | ~35 | `WebSocketTransport` |
| `backend/tui_gateway/ws.py` | ~82 | `attach()` WS 处理器 |
| `backend/tui_gateway/handlers/__init__.py` | - | Handler 注册 |
| `backend/tui_gateway/handlers/prompt.py` | - | `prompt.submit` |
| `backend/tui_gateway/handlers/session.py` | - | `_ensure_agent_session()` |
| `backend/tui_gateway/handlers/tools.py` | - | `approval.respond` 等 |
| `backend/tui_gateway/adapter/agent_runner.py` | ~178 | `AgentSession.__init__` |
| `backend/tui_gateway/adapter/agent_runner.py` | ~235 | `_async_init()` |
| `backend/tui_gateway/adapter/agent_runner.py` | ~340 | `run_turn()` |
| `backend/tui_gateway/adapter/agent_runner.py` | ~415 | `_async_run_turn()` |
| `backend/tui_gateway/adapter/event_translator.py` | ~190 | `translate()` |
| `backend/tui_gateway/adapter/event_translator.py` | ~535 | `finalize()` |
| `backend/tui_gateway/adapter/callbacks.py` | - | 会话上下文绑定 |

### 智能体层
| 文件 | 行号 | 说明 |
|---|---|---|
| `modules/agents/skills_agent/drsai_assistant.py` | 331 | `DrSaiAssistant` 类 |
| `modules/agents/skills_agent/drsai_assistant.py` | 345 | `__init__()` |
| `modules/agents/skills_agent/drsai_assistant.py` | 685 | `_create_context()` |
| `modules/agents/skills_agent/drsai_assistant.py` | 744 | `_register_context_tools()` |
| `modules/agents/skills_agent/drsai_assistant.py` | 1349 | `run_stream()` |
| `modules/agents/skills_agent/drsai_assistant.py` | 1491 | `on_messages_stream()` |
| `modules/agents/skills_agent/drsai_assistant.py` | 1949 | `_call_llm()` |
| `modules/agents/skills_agent/drsai_assistant.py` | 2281 | `_process_model_result()` |
| `modules/agents/skills_agent/drsai_assistant.py` | 3115 | `_create_local_subagent()` |
| `modules/agents/skills_agent/drsai_assistant.py` | 3193 | `_create_remote_subagent()` |
| `modules/agents/skills_agent/drsai_assistant.py` | 3223 | `_create_daemon_subagent()` |
| `modules/agents/skills_agent/drsai_assistant.py` | 3342 | `_execute_subagent()` |
| `modules/agents/skills_agent/drsai_assistant.py` | 3434 | `_execute_subagents_parallel()` |
| `modules/agents/skills_agent/drsai_assistant.py` | 3931 | `_to_config()` (状态导出) |
| `modules/agents/skills_agent/drsai_assistant.py` | 3982 | `_from_config()` (状态恢复) |
| `modules/agents/skills_agent/drsai_assistant.py` | 4045 | `export_production_parity_manifest()` |
| `modules/agents/skills_agent/drsai_cli_assistant.py` | - | `DrSaiCLIAssistant` (CLI 子类) |
| `modules/agents/skills_agent/__init__.py` | - | 包导出 |
| `modules/agents/skills_agent/assistant_skill.py` | - | `SkillAgent` 技能系统 |
| `modules/agents/skills_agent/daemon_subagent.py` | - | `DaemonSubagent` 守护子智能体 |
| `modules/baseagent/drsaiagent.py` | - | `DrSaiAgent` 基类 |

### 管理器
| 文件 | 说明 |
|---|---|
| `modules/agents/skills_agent/managers/user_profile_manager.py` | 用户画像 |
| `modules/agents/skills_agent/managers/todo_manager.py` | 待办事项 |
| `modules/agents/skills_agent/managers/task_planner.py` | 任务规划 |
| `modules/agents/skills_agent/managers/memory_manager.py` | 长期记忆 |
| `modules/agents/skills_agent/managers/scheduled_task_manager.py` | 定时任务 |
| `modules/agents/skills_agent/managers/get_managers_tools.py` | 工具获取 |
| `modules/agents/skills_agent/managers/get_scheduled_task_tools.py` | 定时任务工具 |

---

> **总结**: OpenDrSai 架构采用分层解耦设计, Desktop 和 TUI 两条入口路径共享同一个 `DrSaiAssistant` 智能体核心。HTTP Gateway 适合桌面应用的 RESTful 交互, TUI Gateway 适合终端的 JSON-RPC 通信。两者通过 `create_agent()` 工厂统一创建智能体实例, 通过 `run_stream()` 异步生成器统一输出事件流, 通过事件翻译器 (`translate()` / `GatewayOpenDrSaiAgentBackend`) 适配各自的通信协议。
