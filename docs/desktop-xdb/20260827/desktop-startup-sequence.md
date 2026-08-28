# Desktop → Gateway → Runtime → Agent 完整启动顺序与 Session 创建流程分析

> **日期**: 2026-08-27
> **范围**: `apps/desktop` → `desktop_gateway` → `runtime` → `run_drsai_agent_factory.py`
> **目的**: 追踪桌面端启动时 runtime 的完整启动顺序，以及新建 session 时的完整调用链路

---

## 目录

1. [架构总览](#1-架构总览)
2. [启动链路：Desktop → Gateway → Runtime](#2-启动链路desktop--gateway--runtime)
3. [Gateway 进程初始化：lifespan → 懒加载单例](#3-gateway-进程初始化lifespan--懒加载单例)
4. [新建 Session 的完整调用链](#4-新建-session-的完整调用链)
5. [发送消息的完整调用链](#5-发送消息的完整调用链)
6. [SSE 事件流的建立与传输](#6-sse-事件流的建立与传输)
7. [Agent 工厂：create_agent() 的模型选择逻辑](#7-agent-工厂create_agent-的模型选择逻辑)
8. [关键数据结构总结](#8-关键数据结构总结)

---

## 1. 架构总览

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Electron Desktop App                           │
│  apps/desktop/windows/src/main/index.ts                             │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Main Process (Node.js)                                     │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │    │
│  │  │bootstrap │ │ gateway  │ │IPC handler│ │SessionStream │  │    │
│  │  │  .ts     │ │  .ts     │ │  (200+)   │ │ Controller   │  │    │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────────┘  │    │
│  └─────────────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Renderer Process (React)                                   │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────────┐ ┌──────────┐ │    │
│  │  │ App.tsx  │ │Composer  │ │useSessionStr.│ │Transcript│ │    │
│  │  └──────────┘ └──────────┘ └──────────────┘ └──────────┘ │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
         │  HTTP (127.0.0.1:28643)        │  IPC (drsai:bridge:*)
         ▼                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                desktop_gateway (FastAPI, port 28643)                │
│  cores/python/.../desktop_gateway/                                  │
│  ┌─────────┐ ┌─────────┐ ┌───────────┐ ┌────────────────────┐     │
│  │ app.py  │ │ _auth.py│ │ routes/   │ │  _state.py         │     │
│  │(lifespan)│ │ (token) │ │ sessions  │ │  (singletons)       │     │
│  │ 10 router│ │         │ │ runs      │ │  RuntimeRegistry   │     │
│  │          │ │         │ │ models    │ │  RuntimeEngine     │     │
│  └─────────┘ └─────────┘ └───────────┘ └────────────────────┘     │
│  ┌─────────────────┐  ┌──────────────────────────────────────┐     │
│  │ _agent_backend  │  │ _agent_manager                       │     │
│  │ DesktopAgent    │  │ DesktopAgentManager                  │     │
│  │ Backend         │  │ (per-user-session Agent cache)        │     │
│  └─────────────────┘  └──────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│               runtime/ (SQLite + Event Journal)                     │
│  cores/python/.../backend/runtime/                                  │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐     │
│  │registry.py │ │ engine.py  │ │ agent.py   │ │journal.py  │     │
│  │RuntimeReg. │ │RuntimeEng. │ │RuntimeAgent│ │ConvJournal │     │
│  │(workspaces)│ │(sessions,  │ │Service     │ │(OAEP evts) │     │
│  │            │ │ runs, evts)│ │(execute)   │ │            │     │
│  └────────────┘ └────────────┘ └────────────┘ └────────────┘     │
└─────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│           run_drsai_agent_factory.py (Agent 工厂)                   │
│  ┌────────────────────────────────────────────────────────┐        │
│  │ create_agent()                                         │        │
│  │  - load_llm_mode_config() → model catalog              │        │
│  │  - resolve_model_config() → config.toml                │        │
│  │  - set_model_client() → HepAIChatCompletionClient      │        │
│  │  - DrSaiCLIAssistant(... system_message, tools)        │        │
│  └────────────────────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│               HepAI Platform / LLM API                              │
│  (OpenAI-compatible or Anthropic wire protocol)                    │
└─────────────────────────────────────────────────────────────────────┘
```

### 关键端口与路径

| 组件 | 端口/路径 | 文件 |
|------|----------|------|
| V2 Desktop Gateway | `127.0.0.1:28643` | `desktop_gateway/app.py` L34 |
| V1 Legacy Gateway | `127.0.0.1:28642` | `gateway_legacy.py` |
| Gateway Token | `~/.drsai/runtime/instance-token` | `gateway.ts` |
| Gateway Log | `~/.drsai/logs/gateway.log` | `gateway.ts` |
| Model Catalog Status | `~/.drsai/logs/model-catalog-status.json` | `bootstrap.ts` |
| Runtime SQLite | `~/.drsai/runtime/*.sqlite3` | `_state.py` |

---

## 2. 启动链路：Desktop → Gateway → Runtime

### 2.1 Electron 主进程启动

**入口**: `apps/desktop/windows/src/main/index.ts` — `app.whenReady()`

```
app.whenReady()
  ├── restoreApprovalState()              # 恢复待审批状态
  ├── updateChecks()                       # 更新检查
  ├── singleInstanceLock                   # 单实例锁
  ├── registerDeepLinkProtocol()           # opendrsai:// 协议
  ├── registerRendererProtocol()           # 文件协议
  ├── registerIpc()                        # 注册 200+ IPC handlers
  ├── createWindow()                       # 创建 BrowserWindow
  ├── startUpdateScheduler()
  └── handleDeepLinkArgv()
```

`createWindow()` 在 `did-finish-load` 事件中触发 `startDeferredStartupTasks()`：

```typescript
// index.ts ~L3800
function startDeferredStartupTasks() {
  recoverWorkflowRunStateAfterRestart();
  startScheduledTaskWorkerIfEnabled();
  autoStartGatewayWhenInstalled();  // 如果 eager 模式，自动启动 gateway
  restorePersistedRemoteWorkspaces();
}
```

### 2.2 Bootstrap Desktop 启动链路

当渲染进程加载完成后，调用 `desktop:bootstrap` IPC：

```
Renderer (App.tsx)
  └── window.drsai.bootstrap()  →  IPC "drsai:bridge:invoke" / "bootstrap"
        └── ipcMain.handler → bootstrapDesktop()
```

**`bootstrapDesktop()`** (`bootstrap.ts` ~L16) — 5 步启动链路：

```
bootstrapDesktop()
  │
  ├── 1. requireAuthContext()
  │     └── 验证 OIDC 模式 + access_token
  │         失败 → blocker: "auth_required"
  │
  ├── 2. syncAuthIdentityToGateway(auth.userId)
  │     ├── PUT /v1/config/user-name         (推送用户名)
  │     ├── PUT /v1/config/cli/user_id        (设置 CLI user ID, 清空 agent pool)
  │     └── POST /v1/identity/canonicalize    (历史 user_id 迁移)
  │
  ├── 3. getInstallStatus()
  │     ├── 检查 DRSAI_PYTHON (pythonw.exe)
  │     ├── 检查 DRSAI_SCRIPT / DRSAI_CMD_SCRIPT
  │     ├── 检查 DRSAI_REPO
  │     ├── readInstalledRuntimeVersion() → "1.5.8"
  │     └── 失败 → blocker: "runtime_missing" (canRepairRuntime: true)
  │
  ├── 4. startGateway()
  │     ├── resolveGatewayPythonExecutable()   # Windows: 优先 pythonw.exe
  │     ├── spawnGatewayProcess()
  │     │     spawn(pythonw.exe, ["-m", "drsai.backend.desktop_gateway"], { env })
  │     │     环境变量:
  │     │       OPENDRSAI_DESKTOP_RUNTIME=1
  │     │       OPENDRSAI_GATEWAY_INSTANCE_TOKEN=<shared_secret>
  │     │       DRSAI_API_PORT=28643
  │     │       DRSAI_DESKTOP_USER=<user_id>
  │     │       DRSAI_USER_ID=<user_id>
  │     ├── pollGatewayReady(process, 30s timeout)
  │     │     ├── HTTP GET /health (with X-OpenDrSai-Gateway-Token)
  │     │     └── 检查 body.status === "ok"
  │     └── 失败 → blocker: "service_unavailable"
  │
  └── 5. discoverModelsWithRecovery(auth.accessToken)
        ├── discoverGatewayModels(accessToken)
        │     HTTP GET /v1/models
        │       Headers: X-OpenDrSai-Gateway-Token + Bearer <access_token>
        │       + X-OpenDrSai-Auth-Mode: oidc + X-OpenDrSai-Principal: <userId>
        ├── 重试: [0, 250, 750, 1500] ms 延迟
        ├── 如果 auth_expired → refreshAuthContextAfterUnauthorized() → 重试
        └── 结果分类:
              ready + models > 0  → 成功
              ready + 0 models     → blocker: "permission_denied"
              forbidden            → blocker: "permission_denied"
              auth_required/expired → blocker: "auth_required"
              unavailable           → blocker: "service_unavailable"
```

**最终成功返回**:

```typescript
{
  ok: true,
  capabilities: { chat: true, agent: true, tools: ["files", "shell", "git"] },
  defaults: { agentId: "drsai", modelAlias: models[0]?.id },
  limits: { maxConcurrentRuns: 1 }
}
```

### 2.3 Python Gateway 进程启动

当 `startGateway()` 调用 `spawnGatewayProcess()` 时，Python 子进程启动：

```
pythonw.exe -m drsai.backend.desktop_gateway
  │
  └── desktop_gateway/app.py
        ├── __main__: main()
        │     └── uvicorn.run(app, host="127.0.0.1", port=28643)
        │
        ├── create_app()
        │     ├── FastAPI(title="OpenDrSai Desktop Runtime", version="2.0.0")
        │     ├── _auth.install(app)          # 安装中间件
        │     └── for router in ROUTERS:      # 注册 10 个路由模块
        │           app.include_router(factory())
        │
        └── lifespan(app)  # FastAPI lifespan 上下文
              │
              ├── [启动阶段] yield 之前:
              │     └── ensure_desktop_runtime_config()
              │           └── 种子 TOML 配置:
              │                 - HepAI provider (base_url, api_key 来源)
              │                 - 默认模型: deepseek-v4-flash
              │                 - AgentModelPolicy (primary_model)
              │                 - 没有这步 → routes/config.py 报 "no primary model configured"
              │
              └── [关闭阶段] yield 之后:
                    ├── service.backends.close()   # 关闭所有 Agent Backend
                    └── agent_manager.close()      # 关闭 Agent 缓存
```

**关键代码位置**:

| 步骤 | 文件 | 行号 |
|------|------|------|
| `bootstrapDesktop()` | `apps/desktop/windows/src/main/bootstrap.ts` | ~L16 |
| `requireAuthContext()` | `apps/desktop/shared/main/auth.ts` | ~L1500 |
| `syncAuthIdentityToGateway()` | `apps/desktop/shared/main/gateway.ts` | ~L195 |
| `getInstallStatus()` | `apps/desktop/windows/src/main/status.ts` | ~L21 |
| `spawnGatewayProcess()` | `apps/desktop/shared/main/gateway.ts` | ~L500 |
| `resolveGatewayPythonExecutable()` | `apps/desktop/shared/main/gateway.ts` | ~L580 |
| `probeGatewayEndpointsOnce()` | `apps/desktop/shared/main/gateway.ts` | ~L730 |
| `discoverGatewayModels()` | `apps/desktop/shared/main/gateway.ts` | ~L850 |
| `lifespan()` | `desktop_gateway/app.py` | ~L54 |
| `ensure_desktop_runtime_config()` | `config/desktop_bootstrap.py` | — |
| `create_app()` | `desktop_gateway/app.py` | ~L82 |
| `main()` | `desktop_gateway/app.py` | ~L100 |

---

## 3. Gateway 进程初始化：lifespan → 懒加载单例

### 3.1 lifespan 阶段

`app.py` 的 `lifespan()` 在 uvicorn 启动时执行：

```python
# app.py L54-80
@asynccontextmanager
async def lifespan(app: FastAPI):
    # 种子配置（同步，在 to_thread 中执行）
    bootstrap = await asyncio.to_thread(ensure_desktop_runtime_config)
    logger.info("Desktop Runtime configuration ready (changed={}, actions={})",
                bootstrap.changed, ",".join(bootstrap.actions))

    yield  # ← uvicorn 开始接收请求

    # 关闭阶段
    service = _state.agent_service()
    for backend in service.backends.values():
        await backend.close()
    await _state.agent_manager().close()
```

**注意**: `ensure_desktop_runtime_config()` 是**唯一**在启动时同步执行的配置操作。RuntimeRegistry、RuntimeEngine 等都是**懒加载**的——只有在第一次 HTTP 请求时才初始化。

### 3.2 懒加载单例链 (`_state.py`)

`_state.py` 定义了一系列模块级单例访问器，按需初始化：

```
_state.py 懒加载链
  │
  ├── state_root()
  │     └── DRSAI_DESKTOP_GATEWAY_HOME > DRSAI_HOME > ~/.drsai
  │
  ├── runtime_registry()  [首次调用时初始化]
  │     └── RuntimeRegistry(state_root()/runtime/runtime.sqlite3)
  │         ├── 创建 runtime_metadata 表（存 runtime_id UUID）
  │         ├── 创建 workspaces 表（workspace_id, canonical_path, lifecycle）
  │         └── 创建 worktrees 表（worktree_id, source_workspace_id, status）
  │
  ├── runtime_engine()  [首次调用时初始化]
  │     └── RuntimeEngine(
  │           db_path=state_root()/runtime/engine.sqlite3,
  │           workspace_exists_callback=<lambda>,   # 回调到 registry
  │           worktree_for_workspace_callback=<lambda>, # 回调到 registry
  │         )
  │         ├── 创建 runtime_sessions 表
  │         ├── 创建 runtime_runs 表
  │         ├── 创建 runtime_events 表（append-only, trigger 防止 UPDATE/DELETE）
  │         ├── 创建 runtime_approvals 表
  │         ├── 创建 runtime_checkpoints 表
  │         ├── 创建 runtime_run_manifests 表
  │         ├── 创建 runtime_oaep_events / runtime_session_journal 表
  │         └── 创建 RuntimeConversationJournal（事件日志 + OAEP 投影）
  │
  ├── artifact_store()  [首次调用时初始化]
  │     └── RuntimeArtifactStore(state_root()/runtime/artifacts.sqlite3)
  │
  ├── tool_dispatcher()  [首次调用时初始化]
  │     └── RuntimeToolDispatcher(runtime_engine(), artifact_store())
  │
  ├── agent_definition_store()  [首次调用时初始化]
  │     └── AgentDefinitionStore(root=state_root()/assets/agents)
  │         └── _ensure_agent_definition() → 种子 assets/agents/opendrsai/1.json
  │
  ├── agent_manager()  [首次调用时初始化]
  │     └── DesktopAgentManager()  # 空缓存，按需创建 Agent
  │
  └── agent_service()  [首次调用时初始化]
        └── RuntimeAgentService(
              state=runtime_engine(),           # RuntimeState (engine)
              workspaces=runtime_registry(),    # WorkspaceState (registry)
              definitions=agent_definition_store(),
              dispatcher=tool_dispatcher(),
              backends={
                "opendrsai": DesktopAgentBackend()
              },
              default_backend="opendrsai",
            )
```

**关键设计**: 所有 SQLite 数据库在第一次被需要时才打开和初始化。这意味着：

- **启动时**: 只有 `ensure_desktop_runtime_config()` 写 TOML 配置
- **第一次 GET /health**: 不触发任何数据库初始化（runtime.py 路由不调用 `_state`）
- **第一次 POST /v1/sessions**: 触发 `runtime_engine()` → 打开 engine.sqlite3 → 建表
- **第一次 POST /v1/runs/{id}/execute**: 触发 `agent_service()` → 全链初始化

---

## 4. 新建 Session 的完整调用链

### 4.1 渲染层（Renderer）

```
用户点击 "New" 按钮
  │
  ├── Sidebar.tsx: <button onClick={props.onCreateSession}>New</button>
  │
  ├── App.tsx: actions.createSession()
  │     └── setSessionId(session.sessionId)  # 设置当前 session
  │
  └── useDesktop.ts: createSession()
        └── attempt(bridge().sessions.create({ workspaceId, title: "New session" }))
              │
              └── preload.ts: invoke("sessions.create", input)
                    └── ipcRenderer.invoke("drsai:bridge:invoke", "sessions.create", input)
```

### 4.2 IPC → 主进程 → HTTP

```
ipcMain.handle("drsai:bridge:invoke", ...)
  ├── sender 验证 (isTrustedSender)
  ├── 诊断上下文传播 (traceId/spanId)
  └── BridgeConnection.route("sessions.create", input)
        └── DesktopGatewayClient.createSession(workspaceId, title)
              └── HTTP POST /v1/sessions
                    Headers:
                      X-OpenDrSai-Gateway-Token: <instance_token>
                      Authorization: Bearer <access_token>
                      X-OpenDrSai-Auth-Mode: oidc
                      X-OpenDrSai-Principal: <userId>
                    Body: { "workspace_id": "...", "title": "New session" }
```

### 4.3 Gateway 路由处理

```python
# routes/sessions.py — session_create()
@api.post("/v1/sessions", status_code=201, operation_id="createSession")
async def session_create(request: SessionCreateRequest):
    with _errors.http_errors(not_found="Unknown or closed Workspace"):
        engine = _state.runtime_engine()      # ← 懒加载触发！
        return engine.create_session(
            workspace_id=request.workspace_id,
            title=request.title,
            agent_definition="opendrsai@1",
            backend_id="opendrsai",
        )
```

### 4.4 RuntimeEngine.create_session() — 完整流程

**文件**: `runtime/engine.py` ~L854

```python
def create_session(self, workspace_id, title, agent_definition, backend_id):
    # 1. 验证 workspace 存在且活跃
    if not self._workspace_exists(workspace_id):
        raise NotFoundError("Unknown or closed Workspace")
    
    # 2. 生成 session_id (UUID)
    session_id = f"ses_{uuid4().hex}"
    
    # 3. INSERT runtime_sessions
    with self._db.connect() as conn:
        conn.execute("""
            INSERT INTO runtime_sessions 
                (session_id, workspace_id, title, lifecycle, agent_definition, backend_id, created_at)
            VALUES (?, ?, ?, 'active', ?, ?, ?)
        """, (session_id, workspace_id, title, agent_definition, backend_id, now))
        
        # 4. 追加 journal 事件 "session.updated"
        self._journal.append(conn, session_id, {
            "type": "session.updated",
            "session": {"session_id": session_id, "title": title, ...}
        })
    
    # 5. notify_committed() — 唤醒 SSE 等待线程
    self._journal.notify_committed()
    
    return {"session_id": session_id, "workspace_id": workspace_id, ...}
```

**关键点**:
- `workspace_exists_callback` 回调到 `RuntimeRegistry`，验证 workspace 已注册
- Session 创建后 lifecycle = "active"，agent_definition = "opendrsai@1" 绑定
- Journal 事件用于 OAEP 投影，SSE 流会推送给前端

### 4.5 Session 创建后的 SSE 连接

Session 创建后，Renderer 立即建立 SSE 连接：

```
App.tsx: setSessionId(session.sessionId)
  └── useSessionStream(sessionId) 触发
        └── sessions.subscribe({ sessionId })
              └── HTTP GET /v1/sessions/{id}/oaep-events/stream
                    → SSE 长连接建立
```

**SessionController 三阶段** (`useSessionStream.ts`):
1. **Snapshot**: `GET /v1/sessions/{id}/oaep-snapshot` — 获取当前完整状态
2. **Replay**: `GET /v1/sessions/{id}/oaep-events?after_sequence=0` — 回放历史事件
3. **Connect**: `GET /v1/sessions/{id}/oaep-events/stream` — 实时 SSE 流

---

## 5. 发送消息的完整调用链

### 5.1 渲染层（Renderer）

```
用户在 Composer 输入文本，按 Enter 或点击发送
  │
  ├── Composer.tsx: send()
  │     const clientMessageId = crypto.randomUUID()
  │     bridge().chat.send({ sessionId, prompt, clientMessageId, modelAlias })
  │
  └── preload.ts: invoke("chat.send", input)
        └── ipcRenderer.invoke("drsai:bridge:invoke", "chat.send", input)
```

### 5.2 IPC → 主进程 → HTTP (两步: create run + execute run)

**关键**: 发送消息是一个两步操作 — 先创建 Run，再执行 Run。

```
ipcMain.handle("drsai:bridge:invoke", ...)
  └── BridgeConnection.route("chat.send", input)
        │
        ├── 步骤 1: POST /v1/sessions/{session_id}/runs
        │     Body: { "prompt": "...", "client_message_id": "uuid", "model_alias": "..." }
        │     → 返回 { run_id, status: "queued" }
        │
        └── 步骤 2: POST /v1/runs/{run_id}/execute
              Body: { "prompt": "...", "correlation_id": "uuid", "source_client": "desktop", 
              │        "source_message_id": "uuid", "model": "..." }
              → 返回 202 { run_id, status: "running", events_url: "/v1/sessions/.../oaep-events/stream" }
              │
              └── 异步执行: asyncio.create_task(agent_service.execute(run_id, definition, prompt))
```

### 5.3 Gateway: 创建 Run (`routes/runs.py`)

```python
# routes/runs.py — run_create()
@api.post("/v1/sessions/{session_id}/runs", status_code=201)
async def run_create(session_id: str, request: RunCreateRequest):
    engine = _state.runtime_engine()
    definition_store = _state.agent_definition_store()
    
    # 加载 AgentDefinition
    definition = definition_store.get("opendrsai", 1)
    
    # 创建 Run（幂等性检查）
    run = engine.create_run(
        session_id=session_id,
        agent_definition="opendrsai@1",
        backend_id=definition.backend,  # "opendrsai"
        idempotency_key=request.client_message_id,  # 防重复提交
        manifest_evidence=request.model_alias,
    )
    return run  # { run_id, status: "queued", ... }
```

**RuntimeEngine.create_run()** (`engine.py` ~L1505):
1. 验证 session active
2. 幂等性检查: 如果 `idempotency_key` 已存在，返回已有 Run
3. UPDATE session 绑定 agent_definition
4. INSERT runtime_runs (status='queued')
5. INSERT runtime_events (event_type='run.created', sequence=1)
6. 存储 run manifest
7. 返回 Run 记录

### 5.4 Gateway: 执行 Run (`routes/runs.py`)

```python
# routes/runs.py — run_execute()
@api.post("/v1/runs/{run_id}/execute", status_code=202)
async def run_execute(run_id: str, request: RunExecuteRequest):
    engine = _state.runtime_engine()
    service = _state.agent_service()  # ← 触发全链懒加载!
    
    # 获取 Run
    run = engine.get_run(run_id)
    
    # 设置输入（标准化 prompt, 关联消息 ID）
    engine.set_run_input(
        run_id, 
        message=request.prompt,
        correlation_id=request.correlation_id,
        source_client=request.source_client,
        source_message_id=request.source_message_id,
        model=request.model,
    )
    
    # 异步执行（不阻塞 HTTP 响应）
    task = asyncio.create_task(
        service.execute(run_id, definition, prompt)
    )
    
    return Response(status=202, content={
        "run_id": run_id, 
        "status": "running",
        "events_url": f"/v1/sessions/{run['session_id']}/oaep-events/stream"
    })
```

**RuntimeEngine.set_run_input()** (`engine.py` ~L2331):
1. Redact secrets（API key 等敏感信息脱敏）
2. 标准化输入 parts/resources
3. UPDATE runtime_runs: input_message, correlation_id, source_client, source_message_id
4. 合并 manifest evidence
5. Upsert conversation item "user:{run_id}" (kind=message, role=user)
6. 输入绑定后不可变

### 5.5 RuntimeAgentService.execute() — 执行流程

**文件**: `runtime/agent.py` ~L1100

```python
async def execute(self, run_id, definition, prompt):
    # 1. 加载 run + definition，应用 model override
    run = self.state.get_run(run_id)
    definition = self.definitions.get(run["agent_definition"])
    
    # 2. 验证 backend binding
    assert run["backend_id"] == definition.backend  # "opendrsai"
    
    # 3. 构建 RuntimeRunContext (workspace, session, run, permissions)
    context = RuntimeRunContext(
        workspace=workspace,
        session=session,
        run=run,
        permissions=definition.permissions,
        ...
    )
    
    # 4. 状态转换: queued → running
    self.state.transition_run(run_id, "running")
    
    # 5. 调用 backend.execute() — 即 DesktopAgentBackend.execute()
    result = await self.backends["opendrsai"].execute(
        context, definition, prompt, services
    )
    
    # 6. 成功: transition_run(run_id, "completed")
    self.state.transition_run(run_id, "completed")
    return {"run": run, "result": result, "context": context}
    
    # 7. 失败: append_backend_event("agent.failed"), transition_run(run_id, "failed")
```

### 5.6 DesktopAgentBackend.execute() — Agent 执行核心

**文件**: `desktop_gateway/_agent_backend.py` ~L50

```python
async def execute(self, context, definition, prompt, services):
    # 1. 检查 platform_auth (OIDC 验证上下文)
    platform_auth = context.platform_auth  # 优先级高于静态配置
    
    # 2. 创建 CancellationToken
    cancellation = CancellationToken()
    self._cancellations[context.run_id] = cancellation
    
    # 3. 设置 artifacts context
    self._artifacts.run_context.set(context)
    
    # 4. 发射 agent.started 事件
    await services.emit(context, "agent.started", {"agent_id": definition.asset_id})
    
    # 5. 基线 artifact 快照
    await self._artifacts.artifact_snapshot(baseline=True)
    
    # 6. 创建输入任务并启动流
    task = self._input_task(context, prompt)  # 包装 prompt
    
    # 7. 流循环: _stream() → agent_manager.run_stream() → autogen events
    async for event in self._stream(context, definition, prompt, task, cancellation):
        # 8. 翻译 autogen 事件 → Runtime 事件
        translation = translate_conversation_event(event, state)
        for kind, data in translation:
            kind, data = self._normalize_event(kind, data)
            await services.emit(context, kind, data)  # → engine.append_event()
    
    # 9. 注册新 artifacts
    await self._artifacts.register_new_artifacts()
    
    # 10. 发射 agent.completed 事件
    await services.emit(context, "agent.completed", {})
    
    return {"content": accumulated_content}
```

### 5.7 DesktopAgentManager.run_stream() — Agent 实例化与流式执行

**文件**: `desktop_gateway/_agent_manager.py` ~L180

```python
async def run_stream(self, task, session_id, user_id, model_alias, work_dir, 
                     workspace_id, cancellation_token):
    # 1. 获取 per-session 锁（拒绝并发执行）
    lock = self._get_lock(session_id)
    async with lock:
        # 2. 获取或创建 Agent
        agent = await self.get_or_create(
            session_id=session_id,
            user_id=user_id,
            model_alias=model_alias,
            work_dir=work_dir,
        )
        
        # 3. 设置 runtime workspace
        agent._runtime_workspace_path = work_dir
        agent._runtime_workspace_id = workspace_id
        
        # 4. 调用 agent.run_stream() — 流式执行
        async for event in agent.run_stream(task, cancellation_token):
            yield event  # autogen 事件流
        
        # 5. finally: 恢复 workspace_path/id + save_state()
        agent._runtime_workspace_path = None
        agent._runtime_workspace_id = None
        await agent.save_state()
```

**DesktopAgentManager.get_or_create()** (~L100):

```python
async def get_or_create(self, session_id, user_id, model_alias, work_dir):
    key = f"{user_id}::{session_id}"
    
    # 如果 agent 存在且 model_alias 匹配，直接返回
    if key in self._agents:
        if self._aliases.get(key) == model_alias:
            return self._agents[key]
    
    # 否则创建新 Agent
    agent = create_agent(
        thread_id=session_id,
        user_id=user_id,
        db_manager=db_manager,  # Thread DB
        defult_config_name=model_alias,  # model alias
        work_dir=work_dir,
        extra_tools=[deliver_artifact],
    )
    
    await agent.lazy_init()  # 加载/保存状态
    self._ensure_thread(user_id, session_id, work_dir)  # Thread DB 记录
    
    self._agents[key] = agent
    self._aliases[key] = model_alias
    return agent
```

### 5.8 事件翻译层

**文件**: `tui_gateway/adapter/event_translator.py`

`translate_conversation_event()` 将 autogen 原始事件翻译为 Runtime 规范事件：

| Autogen 事件 | Runtime 事件 | 说明 |
|--------------|-------------|------|
| `TextMessage` / `ModelClientStreamingChunkEvent` | `message.delta` | 文本消息流 |
| `FunctionCall` | `tool.start` | 工具调用开始 |
| `ToolCallExecutionEvent` | `tool.complete` | 工具调用完成 |
| `ToolLongTaskEvent` | `progress.update` | 长任务进度 |
| `FilesEvent` | `artifact.created` | 文件/制品创建 |
| `ThoughtEvent` | `reasoning.delta` | 思考/推理流 |
| `MemoryQueryEvent` | `memory.query` | 记忆查询 |
| `BackgroundTaskEvent` | `background.task` | 后台任务 |

`_normalize_event()` 进一步规范化:
- `message.delta` → `agent.message.delta`
- `tool.start` → `tool.started`
- `tool.complete` → `tool.completed` (需要 call_id)

### 5.9 完整调用链汇总

```
Composer.send()
  → bridge().chat.send()
  → IPC "drsai:bridge:invoke" / "chat.send"
  → POST /v1/sessions/{id}/runs           [创建 Run]
    → engine.create_run()                 [SQLite: INSERT runtime_runs]
    → 返回 run_id, status="queued"
  → POST /v1/runs/{run_id}/execute        [执行 Run]
    → engine.set_run_input()              [SQLite: UPDATE run + INSERT conversation item]
    → asyncio.create_task(agent_service.execute())
    → 返回 202 Accepted
  ↓ (异步)
  RuntimeAgentService.execute()
    → transition_run(run_id, "running")
    → DesktopAgentBackend.execute()
      → services.emit("agent.started")
      → DesktopAgentManager.run_stream()
        → get_or_create() → create_agent()    [首次: 实例化 Agent]
        → agent.run_stream(task, cancellation)
          → autogen event stream
            → HepAIChatCompletionClient.stream()  [LLM API 调用]
      → translate_conversation_event() → services.emit()
        → engine.append_event()               [SQLite: INSERT runtime_events]
        → journal.notify_committed()           [唤醒 SSE 等待]
      → _artifacts.register_new_artifacts()
      → services.emit("agent.completed")
    → transition_run(run_id, "completed")
```

---

## 6. SSE 事件流的建立与传输

### 6.1 SSE 连接建立

当 Renderer 选中一个 session 后，`useSessionStream` hook 发起 SSE 连接：

```
useSessionStream(sessionId)
  │
  ├── 阶段 1: Snapshot (一次性)
  │   GET /v1/sessions/{id}/oaep-snapshot
  │   → 返回当前完整状态 { items: [...], runs: [...], phases: [...] }
  │   → applySessionEvent({ type: "snapshot", ... })  # 权威替换
  │
  ├── 阶段 2: Replay (一次性)
  │   GET /v1/sessions/{id}/oaep-events?after_sequence=0
  │   → 返回历史事件列表
  │   → 逐个 applySessionEvent({ type: "items"|"run"|"phase", ... })
  │
  └── 阶段 3: Live SSE (持续连接)
      GET /v1/sessions/{id}/oaep-events/stream
      Headers: X-OpenDrSai-Gateway-Token, Authorization: Bearer, ...
      → text/event-stream
      → onmessage: applySessionEvent(event)
      → onerror: 自动重连 (指数退避)
```

### 6.2 SSE 路由实现

**文件**: `routes/sessions.py` — `session_event_stream()`

```python
@api.get("/v1/sessions/{session_id}/oaep-events/stream")
async def session_event_stream(session_id: str, request: Request):
    # 1. 预验证 session 存在
    engine = _state.runtime_engine()
    if not engine.session_exists(session_id):
        raise HTTPException(404)
    
    # 2. SSE 流生成
    async def event_generator():
        cursor = int(request.query_params.get("after_sequence", 0))
        
        while True:
            # 3. 阻塞等待新事件 (15s timeout, 500 max)
            events = await asyncio.to_thread(
                engine.wait_oaep_events,
                session_id=session_id,
                after_sequence=cursor,
                timeout=15.0,
                limit=500,
            )
            
            if events:
                for event in events:
                    cursor = event["sequence"]
                    yield {
                        "event": "oaep",
                        "data": json.dumps(event),
                        "id": str(event["sequence"]),
                    }
            else:
                # 4. Heartbeat (防止连接超时)
                yield {"event": "heartbeat", "data": "{}"}
    
    return EventSourceResponse(event_generator())
```

### 6.3 wait_oaep_events() — 事件等待机制

**文件**: `runtime/engine.py` ~L2882

```python
def wait_oaep_events(self, session_id, after_sequence, timeout=15.0, limit=500):
    # 委托给 conversation_journal
    return self._journal.wait_for_oaep_events(
        session_id=session_id,
        after_sequence=after_sequence,
        timeout=timeout,
        limit=limit,
    )
```

**RuntimeConversationJournal.wait_for_oaep_events()** (`journal.py`):

```python
def wait_for_oaep_events(self, session_id, after_sequence, timeout, limit):
    deadline = time.time() + timeout
    
    with self._condition:  # threading.Condition
        while True:
            # 1. 查询新事件
            events = self._fetch_oaep_events(session_id, after_sequence, limit)
            
            if events:
                return events  # 有事件，立即返回
            
            # 2. 计算剩余等待时间
            remaining = deadline - time.time()
            if remaining <= 0:
                return []  # 超时，返回空列表 (触发 heartbeat)
            
            # 3. 等待通知 (最多 remaining 秒)
            self._condition.wait(timeout=remaining)
            # 被 notify_committed() 唤醒后，重新查询
```

### 6.4 notify_committed() — 事件通知机制

当 `engine.append_event()` 写入新事件后：

```python
# engine.py ~L3717
def append_event(self, run_id, event_type, data):
    with self._db.connect() as conn:
        # 1. INSERT runtime_events
        conn.execute("INSERT INTO runtime_events ...")
        
        # 2. Journal append (构建 OAEP 事件)
        self._journal.append(conn, session_id, event_data)
        #   → INSERT runtime_oaep_events
        #   → INSERT runtime_session_journal
        
        # 3. 记录 conversation item (如果适用)
        self._record_runtime_event_item_in_transaction(conn, ...)
        
    # 4. 通知 SSE 等待线程
    self._journal.notify_committed()
    #   → self._condition.notify_all()
    #   → 唤醒所有 wait_for_oaep_events() 调用
```

**关键点**: `append_event()` 和 `append_backend_event()` 的区别:
- `append_event()`: 通用事件追加
- `append_backend_event()`: 带 `backend_event_key` 去重，已存在则幂等返回

**消息/思考 delta 的特殊处理**:
- `message.delta` / `thinking.delta` / `oaep.item.*` 只走 canonical Item journal path
- **不镜像**为 `conversation.item.delta` (避免重复事件)
- 其他事件类型同时走 runtime_events 表和 journal

### 6.5 前端事件处理

**文件**: `workbench/transcript.ts` — `applySessionEvent()`

纯函数，处理 6 种事件类型：

```typescript
function applySessionEvent(state: TranscriptState, event: SessionEvent): TranscriptState {
    switch (event.type) {
        case "snapshot":
            // 权威替换整个状态
            return { items: event.items, runs: event.runs, phases: event.phases }
        
        case "items":
            // Upsert: 更新或插入 items
            return upsertItems(state, event.items)
        
        case "run":
            // 记住 run 信息 (status, model, etc.)
            return { ...state, runs: { ...state.runs, [event.run.id]: event.run } }
        
        case "delta":
            // 追加 overlay delta 到 item
            return appendDelta(state, event)
        
        case "phase":
            // 连接状态 (connected/reconnecting/disconnected)
            return { ...state, phase: event.phase }
        
        case "error":
            // 错误事件
            return { ...state, errors: [...state.errors, event.error] }
    }
}
```

### 6.6 事件流向图

```
LLM API (HepAI Platform)
    │
    ▼ autogen events
agent.run_stream()
    │
    ▼ raw autogen events
DesktopAgentBackend._stream()
    │
    ▼ translate_conversation_event()
    │  → list of (kind, data) tuples
    ▼ _normalize_event()
    │  → normalized event kind
    ▼ services.emit(context, kind, data)
    │
    ▼ AgentExecutionServices.emit()
    │  → engine.append_event(run_id, event_type, data)
    │    → INSERT runtime_events
    │    → journal.append() → INSERT runtime_oaep_events
    │    → _record_runtime_event_item_in_transaction()
    │    → journal.notify_committed() → Condition.notify_all()
    │
    ▼ (SSE 线程被唤醒)
    │
    ▼ engine.wait_oaep_events() 返回新事件
    │
    ▼ SSE route yield event
    │
    ▼ Renderer onmessage
    │
    ▼ applySessionEvent() → 更新 TranscriptState
    │
    ▼ React re-render
```

---

## 7. Agent 工厂：create_agent() 的模型选择逻辑

### 7.1 create_agent() 概述

**文件**: `run_drsai_agent_factory.py` ~L726

`create_agent()` 是整个 Agent 实例化的核心工厂函数。它被 `DesktopAgentManager.get_or_create()` 调用，每个 (user, session) 首次使用时创建一个 Agent 实例。

```python
def create_agent(
    api_key=None,
    thread_id=None,          # = session_id
    user_id=None,
    db_manager=None,         # Thread DB
    defult_config_name=None, # model alias, e.g. "deepseek-v4-flash"
    model_provider=None,
    model_id=None,
    cli_cfg=None,
    assistant_cls=DrSaiCLIAssistant,
    work_dir=None,
    extra_tools=None,        # [deliver_artifact]
    enable_security=True,
    kernel_surface="desktop",
    tool_policy_params=None,
    skill_policy_params=None,
):
```

### 7.2 双模型解析路径

create_agent() 有两条独立的模型解析路径：

```
路径 A: YAML llm_mode_config (模型目录)
  │
  ├── load_llm_mode_config()
  │     读取 ~/.drsai/config/llm_mode_config.yaml
  │     → 模型目录 (catalog): { model_alias: { provider, model_id, ... } }
  │
  └── 用于: 运行时模型选择，DEFAULT_LLM_MODE_CONFIG
  │     agent._production_parity_manifest 基于 YAML catalog

路径 B: TOML config.toml (用户配置)
  │
  ├── load_user_config()
  │     读取 ~/.drsai/config/config.toml
  │     → AgentModelPolicy: { primary_model, fallback_model, ... }
  │     → model 配置: { provider, model, api_key, base_url, ... }
  │
  └── 用于: 配置面 (routes/config.py 读取)
  │     如果 TOML 有 model 配置 → resolve_model_config() / resolve_model_ref()
  │     → 覆盖 YAML catalog 的选择
```

### 7.3 完整实例化流程

```
create_agent()
  │
  ├── 1. load_config()
  │     加载全局配置 (DRSAI_HOME, paths, etc.)
  │
  ├── 2. load_llm_mode_config()
  │     读取 YAML 模型目录 → DEFAULT_LLM_MODE_CONFIG
  │
  ├── 3. load_user_config()
  │     读取 TOML 用户配置
  │     如果 TOML 有 model 配置:
  │       ├── resolve_model_config(toml_model_config)
  │       │   → 解析 provider, model_id, api_key, base_url
  │       └── resolve_model_ref(model_ref)
  │           → 从 catalog 查找 model entry
  │
  ├── 4. 构建 ModelEntry
  │     model_entry = ModelEntry(
  │         model=resolved_model_name,
  │         provider=resolved_provider,
  │         base_url=resolved_base_url,
  │         api_key=resolved_api_key,
  │     )
  │
  ├── 5. 解析 resolved_config_name
  │     根据 defult_config_name (alias) 查找 catalog
  │     如果 TOML 覆盖 → 使用 TOML 的 model
  │
  ├── 6. set_model_client() 内函数
  │     def set_model_client(config_name):
  │         # 解析 client_type (优先级):
  │         #   1. platform_auth (OIDC) → highest priority
  │         #   2. YAML catalog entry
  │         #   3. config.toml model config
  │         #   4. heuristic (基于 model name pattern)
  │         #
  │         # 解析 base_url:
  │         #   platform_auth.model_base_url > catalog > toml > default
  │         #
  │         # 解析 api_key:
  │         #   platform_auth.access_token > catalog > toml > env
  │         #
  │         # 返回:
  │         #   - HepAIAnthropicChatCompletionClient (Anthropic wire protocol)
  │         #   - HepAIChatCompletionClient (OpenAI-compatible)
  │         #   - GeminiNativeChatCompletionClient (Gemini native)
  │
  ├── 7. 构建 cwd_prompt
  │     基于工作目录的系统提示词
  │
  ├── 8. _build_gfs_tools()
  │     构建 GFS (Global File System) 工具集
  │
  ├── 9. create_agent_kernel()
  │     构建 Agent Kernel (工具注册, skill policy, tool policy)
  │
  ├── 10. assistant_cls(model_client=set_model_client(resolved_config_name),
  │                    system_message=cwd_prompt,
  │                    tools=tools,
  │                    work_dir=work_dir,
  │                    storage_dir=storage_dir,
  │                    ...)
  │
  ├── 11. 设置 agent 属性
  │     agent._production_parity_manifest = manifest
  │     agent._shared_agent_kernel = kernel
  │     agent._p9_context_budget = budget
  │
  └── 12. 返回 DrSaiAssistant 实例
```

### 7.4 PlatformAuthContext — OIDC 模型解析

当桌面端通过 OIDC 登录时，`PlatformAuthContext` 具有最高优先级：

```python
class PlatformAuthContext:
    access_token: str      # OIDC access token, 用作 API key
    subject: str           # user_id
    issuer: str            # OIDC issuer
    model_base_url: str    # 平台 API base URL
```

**优先级链** (在 `set_model_client()` 内函数中):

```
1. platform_auth (OIDC)      ← 最高优先级，桌面端默认
   │  client_type: 平台返回的 client_type hint
   │  base_url: platform_auth.model_base_url
   │  api_key: platform_auth.access_token
   │
2. YAML catalog              ← 模型目录
   │  client_type: catalog[alias].client_type
   │  base_url: catalog[alias].base_url
   │  api_key: catalog[alias].api_key
   │
3. config.toml               ← 用户配置
   │  client_type: toml[model].client_type
   │  base_url: toml[model].base_url
   │  api_key: toml[model].api_key
   │
4. heuristic                 ← 基于 model name pattern 推断
   │  "claude" in model_name → Anthropic
   │  "gpt" in model_name → OpenAI
   │  "gemini" in model_name → Gemini
```

### 7.5 模型客户端类型

| 客户端类 | 协议 | 适用场景 |
|----------|------|----------|
| `HepAIChatCompletionClient` | OpenAI-compatible | DeepSeek, GPT 等模型 |
| `HepAIAnthropicChatCompletionClient` | Anthropic wire | Claude 系列模型 |
| `GeminiNativeChatCompletionClient` | Gemini native | Gemini 系列模型 |

所有客户端都继承自 autogen 的 `BaseChatCompletionClient`，实现 `stream()` 方法用于流式生成。

### 7.6 AgentDefinition 与 AgentDefinitionStore

**文件**: `runtime/agent.py` ~L95

```python
@dataclass(frozen=True)
class AgentDefinition:
    asset_id: str        # "opendrsai"
    version: int         # 1
    backend: str         # "opendrsai" (must be in {"opendrsai", "codex"})
    model: str           # model alias
    instructions: str    # system prompt override
    permissions: dict    # tool permissions
    reasoning_effort: str  # "medium"
    model_provider: str | None  # provider override
    model_id: str | None       # model ID override
```

`AgentDefinitionStore` 从 `~/.drsai/assets/agents/{asset_id}/{version}.json` 加载定义。`_state.py` 的 `agent_definition_store()` 会在首次调用时种子 `opendrsai/1.json`。

---

## 8. 关键数据结构与状态总结

### 8.1 SQLite 数据库文件

| 数据库文件 | 所在模块 | 核心表 | 用途 |
|-----------|----------|--------|------|
| `runtime.sqlite3` | RuntimeRegistry | `runtime_metadata`, `workspaces`, `worktrees` | 身份与工作空间注册 |
| `engine.sqlite3` | RuntimeEngine | `runtime_sessions`, `runtime_runs`, `runtime_events`, `runtime_approvals`, `runtime_run_manifests`, `runtime_checkpoints`, `runtime_oaep_events`, `runtime_session_journal` | Session/Run/Event 持久化 |
| `artifacts.sqlite3` | RuntimeArtifactStore | `artifacts`, `artifact_baselines` | 产物追踪与基线对比 |

### 8.2 RuntimeRunContext — 运行时上下文

**文件**: `runtime/agent.py` ~L55

```python
@dataclass(frozen=True)
class RuntimeRunContext:
    run_id: str              # Run UUID
    session_id: str          # Session UUID
    user_id: str             # 用户 ID
    workspace_id: str        # 工作空间 ID
    worktree_path: str       # 工作目录路径
    work_dir: str            # = worktree_path (运行时工作目录)
    agent_definition: AgentDefinition
    model_override: str | None  # 模型覆盖 (AgentDefinition.model)
    services: AgentExecutionServices  # emit() 入口
```

### 8.3 AgentExecutionServices — 事件发射器

```python
class AgentExecutionServices:
    state: RuntimeEngine     # engine 引用
    run_id: str
    
    def emit(self, ctx: RuntimeRunContext, kind: str, data: dict):
        # → engine.append_event(ctx.run_id, kind, data)
        # → journal.append() → runtime_oaep_events
        # → journal.notify_committed() → 唤醒 SSE
```

### 8.4 Session 生命周期状态机

```
Session 创建
  │
  ▼
[created] ── POST /v1/sessions/{id}/runs ──▶ [run.queued]
                                                    │
                                                    ▼
                              POST /v1/runs/{id}/execute ──▶ [run.running]
                                                    │
                                          ┌─────────┼─────────┐
                                          ▼         ▼         ▼
                                   [completed]  [failed]  [cancelled]
```

### 8.5 DesktopAgentManager 缓存结构

```python
class DesktopAgentManager:
    _agents: dict[str, DrSaiCLIAssistant]    # key = "{uid}::{session_id}"
    _aliases: dict[str, str]                  # key → model_alias
    _locks: dict[str, asyncio.Lock]           # key → per-session lock
    
    # 每个 (user, session) 首次使用时:
    #   1. create_agent() → DrSaiCLIAssistant
    #   2. lazy_init() → 加载 thread DB
    #   3. load_state() → 恢复 agent 状态
    #   4. _ensure_thread() → 确保 thread_id 绑定
    #   5. 缓存到 _agents[key]
    #
    # 后续调用: cache hit (如果 alias 匹配)
    #   → 直接返回缓存的 agent
    #   → 如果 alias 不匹配 → 重新 create_agent()
```

### 8.6 DesktopAgentBackend — 事件翻译映射表

| autogen 原始事件 | translate_conversation_event() | OAEP 事件 kind |
|------------------|---------------------------------|----------------|
| `TextMessage` | `message.delta` | `oaep.item.delta` |
| `ModelClientStreamingChunkEvent` | `message.delta` | `oaep.item.delta` |
| `FunctionCall` | `tool.start` | `oaep.item.created` |
| `ToolCallExecutionEvent` | `tool.complete` | `oaep.item.completed` |
| `ThoughtEvent` | `reasoning.delta` | `oaep.item.delta` |
| `FilesEvent` | `artifact.created` | `oaep.item.created` |
| `ToolLongTaskEvent` | `progress.update` | `oaep.progress` |
| `MemoryQueryEvent` | `memory.query` | `oaep.item.created` |
| `StopMessage` | `message.stop` | `oaep.item.completed` |

### 8.7 关键常量与默认值

| 常量 | 值 | 来源 |
|------|-----|------|
| `DEFAULT_AGENT_DEFINITION` | `"opendrsai@1"` | `_state.py` |
| `DesktopAgentBackend.backend_id` | `"opendrsai"` | `_agent_backend.py` |
| Gateway 端口 | `28643` | `desktop_gateway/app.py` |
| Gateway host | `127.0.0.1` | `desktop_gateway/app.py` |
| SSE 轮询 timeout | `15.0s` | `engine.py wait_oaep_events()` |
| SSE 批量 limit | `500` | `engine.py wait_oaep_events()` |
| Model catalog status 文件 | `~/.drsai/logs/model-catalog-status.json` | `bootstrap.ts writeModelCatalogStatus()` |
| Gateway probe timeout | `2500ms` | `gateway.ts probeGatewayEndpointsOnce()` |
| Model discovery 重试 | `[0, 250, 750, 1500]ms` | `bootstrap.ts discoverModelsWithRecovery()` |

### 8.8 端到端时序总结

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 桌面端启动                                                                │
├─────────────────────────────────────────────────────────────────────────┤
│ 1. Electron app.whenReady()                                             │
│ 2. registerIpc() — 注册 150+ IPC handlers                               │
│ 3. bootstrapDesktop()                                                   │
│    3a. requireAuthContext() — 检查 OIDC token                           │
│    3b. syncAuthIdentityToGateway() — PUT /v1/config/user-name           │
│    3c. getInstallStatus() — 检查 Python/script/repo 存在性               │
│    3d. startGateway() — spawn python -m drsai.backend.desktop_gateway   │
│        → probeGatewayEndpointsOnce() — GET /health (2500ms)             │
│    3e. discoverModelsWithRecovery() — GET /v1/models (4 retries)        │
│ 4. Renderer 加载 — main.tsx → App.tsx                                    │
└─────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 新建 Session                                                             │
├─────────────────────────────────────────────────────────────────────────┤
│ 5. User clicks "New" → Sidebar → useDesktop.createSession()              │
│ 6. POST /v1/sessions → engine.create_session() → runtime_sessions 表    │
│ 7. Renderer 导航到 /session/{id}                                        │
│ 8. useSessionStream(sessionId) 开始连接:                                 │
│    8a. GET /v1/sessions/{id}/oaep-snapshot — 获取快照                    │
│    8b. GET /v1/sessions/{id}/oaep-events — 回放历史                      │
│    8c. GET /v1/sessions/{id}/oaep-events/stream — 建立 SSE 连接          │
└─────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 发送消息 & Agent 执行                                                    │
├─────────────────────────────────────────────────────────────────────────┤
│ 9. User types message → Composer → bridge().chat.send(sessionId, text)  │
│ 10. POST /v1/sessions/{id}/runs → engine.create_run() (queued)          │
│ 11. POST /v1/runs/{id}/execute → RuntimeAgentService.execute()          │
│     11a. transition_run(queued → running)                               │
│     11b. DesktopAgentBackend.execute()                                  │
│          → agent_manager.get_or_create(session_id, user_id, ...)        │
│             → create_agent() [首次] 或 cache hit                        │
│          → agent.run_stream(task, cancellation_token)                   │
│     11c. autogen events → translate_conversation_event()               │
│          → services.emit() → engine.append_event()                     │
│          → journal.notify_committed() → SSE 线程唤醒                    │
│     11d. transition_run(running → completed/failed)                     │
│ 12. SSE stream → Renderer onmessage → applySessionEvent() → React     │
└─────────────────────────────────────────────────────────────────────────┘
```

---

*报告完成。本报告基于代码静态分析生成，涵盖了从桌面端 Electron 启动到 Agent 执行的完整调用链路。所有文件路径和行号基于分析时的代码状态。*
