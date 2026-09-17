# 完整数据流图：apps/desktop → desktop_gateway → runtime → run_drsai_agent_factory.py

> 生成时间：2026-08-27
> 分析范围：从 Electron 桌面启动到 Python 智能体流式输出的完整架构关系和数据逻辑

---

## 一、架构总览

系统由 **四层** 组成，当前存在 **V1（旧）与 V2（新）两套并行系统**，且两者之间存在严重的路由不匹配问题：

```
┌─────────────────────────────────────────────────────────────────────┐
│ Layer 1: Electron Desktop (apps/desktop)                           │
│  V1: index.ts + gateway.ts + runtimeClient.ts (~70 路由)          │
│  V2: workbench.ts + desktopGateway/ (19 IPC 方法)                 │
│  端口: V1=28642, V2=28643                                          │
├─────────────────────────────────────────────────────────────────────┤
│ Layer 2: desktop_gateway (Python FastAPI)                           │
│  app.py → _auth.py → _state.py → 6 个 route 模块                   │
│  17 个路由, NO /health, NO /v1/chat/completions                     │
├─────────────────────────────────────────────────────────────────────┤
│ Layer 3: runtime (Python)                                           │
│  RuntimeEngine (SQLite) → RuntimeAgentService → AgentBackend       │
│  OAEP 事件协议 + 归一化事件系统                                      │
├─────────────────────────────────────────────────────────────────────┤
│ Layer 4: run_drsai_agent_factory.py                                 │
│  create_agent() → DrSaiAssistant (LLM + 工具 + 技能 + 内核)        │
│  run_stream() 产出 autogen 事件                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 两套系统的关键差异

| 维度 | V1（当前生产构建） | V2（实验性，未构建） |
|------|---------------------|----------------------|
| 入口 | `index.ts` + `gateway.ts` + `runtimeClient.ts` | `workbench.ts` + `desktopGateway/` |
| 端口 | 28642 | 28643 |
| 健康检查 | `GET /health` → `{"status":"ok"}` | `GET /v1/runtime` → RuntimeIdentity |
| 聊天路由 | `POST /v1/chat/completions` (SSE) | `POST /v1/sessions/{id}/runs` + `POST /v1/runs/{id}/execute` |
| 事件流 | SSE on `/v1/chat/completions` response | SSE on `GET /v1/sessions/{id}/oaep-events/stream` |
| 认证 | `X-OpenDrSai-Gateway-Token` header + Bearer | 同 + `OPENDRSAI_GATEWAY_INSTANCE_TOKEN` env |
| 超时 | 30s, 500ms 轮询 | 90s, 750ms 轮询 |
| 调用路由数 | ~70 个 | 17 个 |

---

## 二、完整数据流图

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                          Electron Renderer (React)                          │
│                                                                              │
│  ┌──────────────┐  ┌────────────────┐  ┌───────────────┐  ┌──────────────┐ │
│  │  Login UI    │  │  Chat UI        │  │ Session List  │  │  Settings   │ │
│  └──────┬───────┘  └───────┬────────┘  └───────┬───────┘  └──────┬───────┘ │
│         │ ipcRenderer       │ ipcRenderer        │ ipcRenderer     │          │
│         │ "desktop:auth     │ "desktop:chat     │ "desktop:       │          │
│         │  :login"          │  :send"           │  sessions:*"   │          │
├─────────┼───────────────────┼───────────────────┼─────────────────┼──────────┤
│         ▼                   ▼                   ▼                 ▼          │
│  ┌──────────────────────────────────────────────────────────────────────────┐ │
│  │              Electron Main Process (index.ts ~7229 行)                  │ │
│  │                                                                          │ │
│  │  ════════════ 阶段 1: 登录 ════════════                                  │ │
│  │  Auth: startOidcLogin()                                                 │ │
│  │    → 1. 生成 PKCE pair (verifier + challenge)                           │ │
│  │    → 2. 创建 loopback HTTP server (127.0.0.1:0)                          │ │
│  │    → 3. 获取 OIDC discovery metadata                                     │ │
│  │    → 4. 打开浏览器 → HepAI OIDC 授权页面                                  │ │
│  │    → 5. 等待 loopback server 收到 authorization code                     │ │
│  │    → 6. exchangeOidcAuthorizationCode() → token endpoint                 │ │
│  │    → 7. verifyOidcTokenSignature() — RS256 via JWKS                      │ │
│  │    → 8. validateOidcClaims() — issuer/audience/sub/scope/nonce/exp       │ │
│  │    → 9. writeStoredSession() — Windows Credential Service 加密存储       │ │
│  │    → 10. propagateAuthIdentityToGateway(userId)                          │ │
│  │                                                                          │ │
│  │  ════════════ 阶段 2: Gateway 启动 ════════════                          │ │
│  │  app.whenReady()                                                         │ │
│  │    → autoStartGatewayWhenInstalled() — eager 模式                       │ │
│  │      → startGateway() → startGatewayOnce()                              │ │
│  │        → resolveDesktopUserIdForGateway()                               │ │
│  │        → checkGatewayReady() — 尝试接管已有进程                          │ │
│  │        → spawn Python 进程:                                              │ │
│  │            pythonw.exe -m drsai.backend.desktop_gateway                 │ │
│  │            env: DRSAI_HOME, DRSAI_API_PORT=28642,                       │ │
│  │                OPENDRSAI_GATEWAY_INSTANCE_TOKEN=...,                     │ │
│  │                DRSAI_DESKTOP_USER=userId, DRSAI_USER_ID=userId          │ │
│  │        → pollGatewayReady(process, 30000ms)                             │ │
│  │            → 每 500ms: GET http://127.0.0.1:28642/health               │ │
│  │            → 检查 response.status === "ok"                             │ │
│  │            ★ desktop_gateway 无 /health 路由 → 401 → 超时 30s          │ │
│  │        → syncAuthIdentityToGateway(userId)                              │ │
│  │            → PUT /v1/config/user-name { user_name: userId }            │ │
│  │            → PUT /v1/config/cli/user_id { value: userId }             │ │
│  │            ★ desktop_gateway 无这些路由 → 404                            │ │
│  │                                                                          │ │
│  │  ════════════ 阶段 3: 消息发送 ════════════                              │ │
│  │  LocalRuntimeClient.connect()                                           │ │
│  │    → startGateway() → getGatewayStatus()                                │ │
│  │    → access = { baseUrl, headers: getGatewayRequestHeaders() }          │ │
│  │    → connectAuthoritativeRuntimeClient(access, ...)                    │ │
│  │      → GET /v1/runtime — 握手                                           │ │
│  │      → 缓存到 runtimeClientRegistry (Map, MAX=16, LRU)                 │ │
│  │                                                                          │ │
│  │  withRuntimeClientForWorkspace(workspacePath, workspaceId, callback)   │ │
│  │    → acquireRuntimeClientLease() — 引用计数                              │ │
│  │    → client.createRun(request)                                          │ │
│  │      → POST /v1/chat/completions  ★ V1 路由                             │ │
│  │        Headers:                                                          │ │
│  │          X-OpenDrSai-Gateway-Token: {instance_token}                    │ │
│  │          Authorization: Bearer {access_token}                          │ │
│  │          X-OpenDrSai-Auth-Mode: oidc                                    │ │
│  │          X-OpenDrSai-Principal: {userId}                                │ │
│  │          Idempotency-Key: {requestId}                                   │ │
│  │        Body: RuntimeRunRequest (prompt, model, workspace...)           │ │
│  │        Accept: text/event-stream                                        │ │
│  │      ★ desktop_gateway 无 /v1/chat/completions 路由 → 404              │ │
│  │    → release() — 引用计数释放                                           │ │
│  └──────────────────────────────┬───────────────────────────────────────────┘ │
│                                 │ HTTP fetch                                  │
│                                 │ Headers: X-OpenDrSai-Gateway-Token         │
│                                 │          Authorization: Bearer ...          │
│                                 │          X-OpenDrSai-Auth-Mode: oidc       │
│                                 │          X-OpenDrSai-Principal: userId     │
└─────────────────────────────────┼─────────────────────────────────────────────┘
                                  │
                          ┌───────▼─────────────────────────────────────────┐
                          │      HTTP / SSE  —  port 28642 (V1) / 28643 (V2) │
                          └───────┬─────────────────────────────────────────┘
                                  │
┌─────────────────────────────────▼─────────────────────────────────────────────┐
│                    Layer 2: desktop_gateway (Python FastAPI)                  │
│                    cores/python/.../backend/desktop_gateway/                  │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────────┐ │
│  │  app.py — create_app()                                                   │ │
│  │    FastAPI(title="OpenDrSai Desktop Runtime", version="2.0.0")          │ │
│  │    _auth.install(app)  ← 安装认证中间件                                   │ │
│  │    for factory in ROUTERS: app.include_router(factory())                │ │
│  │      ROUTERS = (runtime, workspaces, sessions, runs, models, audio)     │ │
│  │    lifespan: shutdown 时关闭 agent backends + agent_manager             │ │
│  │    ★ 无启动时初始化 — 全部懒加载                                          │ │
│  └──────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────────┐ │
│  │  _auth.py — 认证中间件                                                   │ │
│  │                                                                          │ │
│  │  PUBLIC_PATHS = frozenset({"/v1/runtime"})  ← /health 不在其中          │ │
│  │                                                                          │ │
│  │  每个 HTTP 请求:                                                         │ │
│  │    1. 生成/获取 correlation_id                                           │ │
│  │    2. 如果 path in PUBLIC_PATHS → 跳过认证                              │ │
│  │    3. 验证 x-opendrsai-gateway-token → 401 if invalid                   │ │
│  │    4. 如果 x-opendrsai-auth-mode == "oidc":                              │ │
│  │       → 验证 Bearer token 签名/issuer/audience/scope/expiry             │ │
│  │       → 交叉检查 x-opendrsai-principal == token.sub → 403 if mismatch  │ │
│  │    5. 安装 auth_context 到 task-local scope (platform_auth_scope)       │ │
│  │       → Agent 深层代码可通过 get_platform_auth() 获取 HepAI 凭据          │ │
│  │                                                                          │ │
│  │  effective_user_id(): 安全关键函数                                       │ │
│  │    → 已登录: 以 OIDC subject 为准，不接受自报 user_id                     │ │
│  │    → 离线: 使用本地 profile name                                          │ │
│  │    → 强制"登录身份决定历史归属"                                          │ │
│  └──────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────────┐ │
│  │  _state.py — 懒加载单例管理                                              │ │
│  │                                                                          │ │
│  │  所有单例首次访问时创建:                                                  │ │
│  │  ┌────────────────────┬──────────────────────────────────────────────┐ │ │
│  │  │ 访问器              │ 后端存储                                       │ │ │
│  │  ├────────────────────┼──────────────────────────────────────────────┤ │ │
│  │  │ runtime_registry()  │ state_root()/runtime/runtime.sqlite3         │ │ │
│  │  │ runtime_engine()    │ state_root()/runtime/engine.sqlite3           │ │ │
│  │  │ artifact_store()    │ state_root()/runtime/artifacts.sqlite3        │ │ │
│  │  │ agent_manager()     │ 内存 (per (user_id, session_id) 缓存)        │ │ │
│  │  │ agent_service()     │ Run 生命周期管理                                │ │ │
│  │  │ agent_definition_   │ state_root()/assets/agents/                  │ │ │
│  │  │   store()           │                                                │ │ │
│  │  └────────────────────┴──────────────────────────────────────────────┘ │ │
│  │                                                                          │ │
│  │  DEFAULT_AGENT_DEFINITION = "opendrsai@1"                               │ │
│  │  内置 agent definition: opendrsai@1 → backend_id="opendrsai"            │ │
│  └──────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────────┐ │
│  │  路由层 — 17 个路由                                                      │ │
│  │                                                                          │ │
│  │  routes/runtime.py:                                                      │ │
│  │    GET  /v1/runtime                              → RuntimeIdentity        │ │
│  │      SOURCE_DIGEST = _source_digest()  ← import 时同步计算 SHA256         │ │
│  │                                                                          │ │
│  │  routes/sessions.py:                                                     │ │
│  │    POST /v1/sessions                            → createSession (201)    │ │
│  │    GET  /v1/sessions                            → listSessions           │ │
│  │    GET  /v1/sessions/{id}                       → getSession            │ │
│  │    PATCH /v1/sessions/{id}                      → updateSession         │ │
│  │    GET  /v1/sessions/{id}/oaep-snapshot         → getSessionSnapshot    │ │
│  │    GET  /v1/sessions/{id}/oaep-events           → listSessionEvents      │ │
│  │    GET  /v1/sessions/{id}/oaep-events/stream    → streamSessionEvents    │ │
│  │      (SSE: id: {seq}\nevent: oaep.event\ndata: {json})                   │ │
│  │                                                                          │ │
│  │  routes/runs.py:                                                         │ │
│  │    POST /v1/sessions/{session_id}/runs          → run_create (201/200)  │ │
│  │      body: { idempotency_key }  ← 幂等键必填                               │ │
│  │      → engine.create_run(session_id, "opendrsai@1", idempotency_key)   │ │
│  │      → 返回 201 (新建) 或 200 (已存在)                                    │ │
│  │                                                                          │ │
│  │    POST /v1/runs/{run_id}/execute              → run_execute (202)     │ │
│  │      body: { prompt, model_alias?, source_message_id? }                  │ │
│  │      → engine.get_run(run_id)  — 验证 Run 存在                            │ │
│  │      → engine.set_run_input(run_id, prompt, ...)  — 同步绑定输入         │ │
│  │      → asyncio.create_task(execute())  — ★ 分离后台任务                  │ │
│  │      → 返回 202 + { run, accepted: true,                                 │ │
│  │        events: "/v1/sessions/.../oaep-events/stream" }                   │ │
│  │                                                                          │ │
│  │    POST /v1/runs/{run_id}/cancel               → run_cancel            │ │
│  │      → agent_service().cancel(run_id)                                  │ │
│  │                                                                          │ │
│  │  routes/workspaces.py:                                                  │ │
│  │    GET/POST /v1/workspaces                      → workspace CRUD        │ │
│  │    GET  /v1/workspaces/{id}/files               → file tree              │ │
│  │    GET  /v1/workspaces/{id}/file                → file read             │ │
│  │                                                                          │ │
│  │  routes/models.py:                                                      │ │
│  │    GET  /v1/config/model-catalog               → model catalog          │ │
│  │                                                                          │ │
│  │  routes/audio.py:                                                       │ │
│  │    POST /v1/audio/transcriptions               → speech-to-text        │ │
│  └──────────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────┬─────────────────────────────────────┘
                                         │
                   ┌─────────────────────▼─────────────────────┐
                   │  _state.agent_service().execute()           │
                   │  (RuntimeAgentService — Layer 3)             │
                   └─────────────────────┬─────────────────────┘
                                         │
┌────────────────────────────────────────▼─────────────────────────────────────┐
│                    Layer 3: runtime (Python)                                  │
│                    cores/python/.../backend/runtime/                          │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────────┐ │
│  │  RuntimeEngine (engine.py) — 持久化 Session/Run/Event 状态               │ │
│  │                                                                          │ │
│  │  SQLite 表:                                                              │ │
│  │  ┌─────────────────────────┬─────────────────────────────────────────┐  │ │
│  │  │ 表名                    │ 用途                                    │  │ │
│  │  ├─────────────────────────┼─────────────────────────────────────────┤  │ │
│  │  │ runtime_sessions         │ 会话: session_id, workspace_id, title   │  │ │
│  │  │ runtime_runs             │ 运行: run_id, session_id, status, input │  │ │
│  │  │ runtime_events           │ 事件: event_id, run_id, sequence, type  │  │ │
│  │  │                          │ ★ append-only (trigger 防 UPDATE/DELETE)│  │ │
│  │  │ runtime_channel_bindings │ 外部渠道绑定                             │  │ │
│  │  │ runtime_channel_deliveries│ 幂等投递追踪                             │  │ │
│  │  │ runtime_backend_item_bindings│ 后端 item ID 映射                   │  │ │
│  │  └─────────────────────────┴─────────────────────────────────────────┘  │ │
│  │                                                                          │ │
│  │  SQLite 配置: WAL 模式, foreign_keys=ON, timeout=30s                   │ │
│  │                                                                          │ │
│  │  Run 状态机:                                                            │ │
│  │    queued → running → {waiting_approval} → completed/cancelled/failed   │ │
│  │                                                                          │ │
│  │  初始化 20+ 子系统:                                                      │ │
│  │    SecurityBoundaryStore, AuthorizationApprovalService,                │ │
│  │    PermissionModeService, RuntimeConversationJournal,                   │ │
│  │    ReplayPlanStore, RunComparisonStore, RuntimeObservability, ...       │ │
│  │                                                                          │ │
│  │  _CheckpointCipher: AES-GCM 加密可恢复 agent 状态                       │ │
│  │    → Windows 上用 WindowsDpapiProtector 保护密钥                         │ │
│  │    → 格式: enc:v1: + base64(nonce[12] + ciphertext)                    │ │
│  │    → AAD: b"opendrsai-runtime-checkpoint-v1"                            │ │
│  └──────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────────┐ │
│  │  RuntimeAgentService (agent.py) — Run 生命周期管理                        │ │
│  │                                                                          │ │
│  │  execute(run_id, prompt, correlation_id, model_override):                │ │
│  │    → 构建 RuntimeRunContext(session_id, workspace_id, run_id, ...)      │ │
│  │    → 查找 DesktopAgentBackend (backend_id="opendrsai")                  │ │
│  │    → backend.execute(context, definition, prompt, services)             │ │
│  │                                                                          │ │
│  │  emit(context, event_type, data):                                        │ │
│  │    → RuntimeEngine → 写入 runtime_events 表 (append-only)               │ │
│  │    → RuntimeConversationJournal → 转换为 OAEP items                      │ │
│  │    → 可通过 /v1/sessions/{id}/oaep-events/stream 订阅                    │ │
│  └──────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────────┐ │
│  │  归一化事件系统 (normalized_events.py)                                   │ │
│  │                                                                          │ │
│  │  NormalizedEventKind:                                                    │ │
│  │    session.created/updated/archived/deleted                             │ │
│  │    run.started/waiting/resumed/completed/failed/cancelled                │ │
│  │    item.started/delta/updated/completed/failed/cancelled                 │ │
│  │                                                                          │ │
│  │  NormalizedItemType:                                                    │ │
│  │    message, reasoning, plan, command_execution, file_change,           │ │
│  │    tool_call, artifact, interaction, subtask, notice                     │ │
│  │                                                                          │ │
│  │  NormalizedDeltaKind:                                                   │ │
│  │    message.text.append, reasoning.segment.added, ...                    │ │
│  │                                                                          │ │
│  │  OAEP 兼容映射:                                                         │ │
│  │    "oaep.item.message.delta" → "agent.message.delta"                    │ │
│  │    "oaep.run.started"        → "agent.started"                         │ │
│  │    "oaep.run.completed"      → "agent.completed"                       │ │
│  │    "oaep.run.failed"         → "agent.failed"                          │ │
│  └──────────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────┬─────────────────────────────────────┘
                                         │
                   ┌─────────────────────▼─────────────────────┐
                   │  DesktopAgentBackend.execute()              │
                   │  (desktop_gateway/_agent_backend.py)        │
                   └─────────────────────┬─────────────────────┘
                                         │
┌────────────────────────────────────────▼─────────────────────────────────────┐
│              消息执行 & 智能体实例化 & 流式输出                                  │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────────┐ │
│  │  DesktopAgentBackend.execute(context, definition, prompt, services)     │ │
│  │  (desktop_gateway/_agent_backend.py)                                     │ │
│  │                                                                          │ │
│  │  1. 检查 auth: get_platform_auth() → 需要 HepAI 身份                      │ │
│  │  2. 创建 CancellationToken → 存入 _cancellations[run_id]                │ │
│  │  3. services.emit(context, "agent.started", {...})                      │ │
│  │  4. baseline = _artifacts.artifact_snapshot(workspace_path)  — 基线快照  │ │
│  │  5. task = _input_task(context, prompt)  — 编码 prompt + 附件            │ │
│  │     → autogen_input_task(prompt, input_resources, workspace_path, ...)  │ │
│  │                                                                          │ │
│  │  6. stream = _state.agent_manager().run_stream(task, ...)              │ │
│  │     (见下方 DesktopAgentManager)                                          │ │
│  │                                                                          │ │
│  │  7. async for event in stream:  — 遍历 autogen 事件                     │ │
│  │     → translate_conversation_event(event, translation_state)            │ │
│  │       (from tui_gateway/adapter/event_translator.py)                    │ │
│  │       → 产出 (event_type, payload) 对                                    │ │
│  │     → _normalize_event(context, event_type, payload)                   │ │
│  │       → "message.delta" → ("agent.message.delta", { delta, content }) │ │
│  │       → "tool.start"    → ("tool.started", { call_id, operation_id,    │ │
│  │                                      correlation_id, operation_ref })  │ │
│  │       → "tool.complete" → ("tool.completed", { ... })                   │ │
│  │     → services.emit(context, kind, data)  — 写入 OAEP journal          │ │
│  │                                                                          │ │
│  │  8. _artifacts.register_new_artifacts(...)  — 注册新文件                 │ │
│  │  9. services.emit(context, "agent.completed", { content, citations })  │ │
│  │  10. return { content }                                                 │ │
│  │                                                                          │ │
│  │  异常处理:                                                              │ │
│  │    CancelledError → RuntimeExecutionError("run_cancelled")             │ │
│  │    其他异常 → _failure(exc) → 分类为 model_error / capability_mismatch │ │
│  └──────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────────┐ │
│  │  DesktopAgentManager.run_stream(task, session_id, user_id, ...)         │ │
│  │  (desktop_gateway/_agent_manager.py)                                    │ │
│  │                                                                          │ │
│  │  1. 获取 per-key lock (asyncio.Lock)                                    │ │
│  │     → 如果锁已占用 → RuntimeExecutionError("session_busy")             │ │
│  │     → 拒绝同一 session 的第二个并发 turn                                 │ │
│  │                                                                          │ │
│  │  2. agent = await get_or_create(session_id, user_id, model_alias, ...)  │ │
│  │     │                                                                    │ │
│  │     │  ┌──────────────────────────────────────────────────────────────┐ │ │
│  │     │  │ get_or_create():                                             │ │ │
│  │     │  │  key = f"{user_id}::{session_id}"                            │ │ │
│  │     │  │  if cached and alias unchanged → return cached agent         │ │ │
│  │     │  │  else:                                                        │ │ │
│  │     │  │    create_agent(                                              │ │ │
│  │     │  │      thread_id=session_id,                                    │ │ │
│  │     │  │      user_id=uid,                                             │ │ │
│  │     │  │      db_manager=_database(),  ← 共享 SQLite (thread/message)  │ │ │
│  │     │  │      defult_config_name=alias,  ← 模型别名                    │ │ │
│  │     │  │      work_dir=work_dir,                                       │ │ │
│  │     │  │      extra_tools=[deliver_artifact]  ← 工件交付工具           │ │ │
│  │     │  │    )  → (见下方 Layer 4)                                      │ │ │
│  │     │  │    agent.lazy_init()                                          │ │ │
│  │     │  │    state = _load_state(session_id, uid)  ← 从 Thread 加载状态  │ │ │
│  │     │  │    if state: agent.load_state(state)                         │ │ │
│  │     │  │    _ensure_thread(session_id, uid, work_dir)                  │ │ │
│  │     │  │    cache[key] = agent; aliases[key] = alias                  │ │ │
    │     │  └──────────────────────────────────────────────────────────────┘ │ │
    │     │                                                                    │ │
    │  3. agent._runtime_workspace_path = Path(work_dir).resolve()  — turn 作用域 │
    │  4. agent._runtime_workspace_id = workspace_id                     │ │
    │  5. async for event in agent.run_stream(task, cancellation_token): │ │
    │       yield event  ← 产出 raw autogen 事件                           │ │
    │  6. finally: 恢复 workspace_path/id + save_state()                   │ │
    └──────────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────┬─────────────────────────────────────┘
                                         │
                                         │ agent.run_stream(task, cancellation_token)
                                         │ 产出 raw autogen events
                                         │
┌────────────────────────────────────────▼─────────────────────────────────────┐
│                    Layer 4: run_drsai_agent_factory.py                       │
│                    cores/python/.../backend/run_drsai_agent_factory.py       │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────────┐ │
│  │  create_agent() — 行 726+, 约 500 行                                     │ │
│  │                                                                          │ │
│  │  输入参数:                                                               │ │
│  │    thread_id, user_id, db_manager, defult_config_name (模型别名),       │ │
│  │    work_dir, extra_tools, kernel_surface="desktop", ...                 │ │
│  │                                                                          │ │
│  │  步骤 1: 加载 LLM catalog                                               │ │
│  │    load_llm_mode_config(llm_config_path)                                │ │
│  │    优先级: YAML > cli_config > DEFAULT_LLM_MODE_CONFIG (内置)          │ │
│  │    内置目录: deepseek-v4-pro/flash, gpt-5.4/5.5, gemini-3.1-pro/flash, │ │
│  │              glm-5.1/5.2, minimax-m2.7, claude-sonnet-5, 等            │ │
│  │                                                                          │ │
│  │  步骤 2: 解析模型配置                                                    │ │
│  │    load_user_config() → config.toml                                     │ │
│  │    migrate_legacy_model_config() → 环境变量迁移                          │ │
│  │    resolve_model_config() → 最终模型 + provider + capabilities          │ │
│  │    如果 unified_model_config_active: 合并到 llm_mode_config             │ │
│  │                                                                          │ │
│  │  步骤 3: 解析 API endpoint + key                                         │ │
│  │    anthropic_base_url: cli_cfg / env / default (aiapi.ihep.ac.cn)      │ │
│  │    openai_base_url: cli_cfg / env / default (aiapi.ihep.ac.cn)         │ │
│  │    如果有 resolved_user_model: 使用 provider 的 base_url + api_key     │ │
│  │                                                                          │ │
│  │  步骤 4: 创建 set_model_client 函数                                      │ │
│  │    根据 client_type + entry:                                            │ │
│  │    → HepAIAnthropicChatCompletionClient (Claude 系列)                   │ │
│  │    → HepAIChatCompletionClient (OpenAI 系列)                            │ │
│  │    → GeminiNativeChatCompletionClient (Gemini)                          │ │
│  │                                                                          │ │
│  │  步骤 5: 加载技能、工具、GFS                                             │ │
│  │    skills_dir = resolve_builtin_skills_dir()                           │ │
│  │    final_tools = extra_tools + MCP + knowledge + GFS 工具              │ │
│  │    final_sub_agent_config = sub_agent_config                            │ │
│  │                                                                          │ │
│  │  步骤 6: 创建 agent kernel                                               │ │
│  │    create_agent_kernel(surface="desktop")                               │ │
│  │    → 桌面内核: fail-closed 策略                                          │ │
│  │      (memory 门禁, verification, citation, context budget, artifact)   │ │
│  │                                                                          │ │
│  │  步骤 7: 构建 system message                                             │ │
│  │    DEFAULT_SYSTEM_PROMPT + cwd_prompt (工作目录上下文)                   │ │
│  │                                                                          │ │
│  │  步骤 8: 实例化 DrSaiAssistant                                            │ │
│  │    assistant = DrSaiCLIAssistant(                                       │ │
│  │      name="OpenDrSai",                                                  │ │
│  │      model_client=set_model_client(resolved_config_name),              │ │
│  │      system_message=cwd_prompt,                                         │ │
│  │      model_client_stream=True,  ← ★ 流式输出                            │ │
│  │      thread_id=thread_id,                                               │ │
│  │      db_manager=db_manager,                                            │ │
│  │      work_dir=cwd,            ← 主工作区 = 用户 cwd                    │ │
│  │      storage_dir=user_storage_dir, ← 内部配置/记忆                      │ │
│  │      only_in_workspace=True,  ← 工具限制在 cwd + storage_dir           │ │
│  │      tools=final_tools,       ← 额外工具 (MCP, knowledge, GFS)         │ │
│  │      metadata={ kernel identity, parity manifest, ... },              │ │
│  │      token_limit=int(token_limit * 0.7),  ← 70% 上下文窗口              │ │
│  │      rag_flow_url, rag_flow_token, memory_dataset_id,                  │ │
│  │      context_type,  ← "ragflow" or "sqlite"                           │ │
│  │      ...                                                                │ │
│  │    )                                                                    │ │
│  │    assistant._shared_agent_kernel = effective_shared_kernel            │ │
│  │    assistant._production_parity_manifest = parity_manifest              │ │
│  │    return assistant                                                     │ │
│  └──────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────────┐ │
│  │  DrSaiAssistant.run_stream(task, cancellation_token)                    │ │
│  │  (modules/agents/skills_agent.py)                                       │ │
│  │                                                                          │ │
│  │  → autogen-core 驱动 LLM + 工具循环                                     │ │
│  │  → 流式产出 autogen 事件:                                               │ │
│  │    - message.delta (LLM 文本增量)                                       │ │
│  │    - tool.start / tool.complete (工具调用)                              │ │
│  │    - reasoning.delta (推理增量)                                          │ │
│  │    - citation.added (引用)                                              │ │
│  │  → cancellation_token 支持取消                                          │ │
│  └──────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 三、完整启动时序图

```
时间轴 →

T=0s     Electron app.whenReady()
         │
T=0.1s   ├─ registerIpc() — 注册 ~200 个 IPC handler
         ├─ createWindow() — 创建 BrowserWindow
         ├─ autoStartGatewayWhenInstalled() — eager 模式
         │
T=0.2s   ├─ startGateway() → startGatewayOnce()
         │   ├─ resolveDesktopUserIdForGateway()
         │   ├─ checkGatewayReady() — 尝试接管 → GET /health → 401/404
         │   ├─ killPortOccupant(28642) — 清理端口
         │   ├─ spawn: pythonw.exe -m drsai.backend.desktop_gateway
         │   │   ├─ Python: import desktop_gateway
         │   │   ├─ create_app() → FastAPI + _auth + 6 routers
         │   │   ├─ SOURCE_DIGEST = _source_digest() ← 同步计算所有 .py 的 SHA256
         │   │   ├─ uvicorn.run(app, port=28643)  ← ★ 但 Electron 用 28642!
         │   │   └─ FastAPI 就绪 (但无 /health 路由)
         │   │
T=0.5s   ├─ pollGatewayReady(process, 30000ms) — 开始轮询
         │   ├─ 每 500ms: GET http://127.0.0.1:28642/health
         │   ├─ desktop_gateway: /health 不存在 → 404/401
         │   ├─ 重复 60 次 (30s / 500ms)...
         │   │
T=30s    ├─ ★ 超时! Gateway 判定为未就绪
         │   ├─ 终止进程树
         │   └─ return false
         │
T=30.1s  └─ 用户看到 "Gateway 启动失败" 或降级模式

─────────────────────────────────────────────────────────────────

如果通过某种方式判定 ready (例如手动设置或 V2 路径):

T+0s     用户在 Chat UI 输入消息
         │
T+0.1s   ├─ IPC: "desktop:chat:send"
         ├─ withRuntimeClientForWorkspace(path, workspaceId, callback)
         │   ├─ acquireRuntimeClientLease()
         │   ├─ LocalRuntimeClient.connect()
         │   │   ├─ startGateway()
         │   │   ├─ getGatewayStatus() → status.baseUrl
         │   │   └─ connectAuthoritativeRuntimeClient()
         │   │       └─ GET /v1/runtime — 握手
         │   │           → runtime_registry().get_runtime_identity()
         │   │           → 首次访问: 创建 SQLite + 建表 (懒加载延迟)
         │   │
T+0.5s   ├─ client.createRun(request)
         │   ├─ POST /v1/chat/completions  ← ★ V1 路由
         │   │   Headers: X-OpenDrSai-Gateway-Token, Authorization: Bearer...
         │   │   Body: { prompt, model, workspace... }
         │   │   Accept: text/event-stream
         │   │
         │   ├─ ★ desktop_gateway 无 /v1/chat/completions → 404
         │   └─ 聊天请求失败

─────────────────────────────────────────────────────────────────

V2 正确路径 (如果使用 workbench.ts + desktopGateway/):

T+0s     用户在 Chat UI 输入消息
         │
T+0.1s   ├─ IPC: "chat.send" → BridgeService.send()
         │   ├─ client.createSession(workspaceId, title)
         │   │   └─ POST /v1/sessions → 201
         │   │       → runtime_engine().create_session(...)
         │   │
T+0.2s   ├─ client.createRun(sessionId, idempotencyKey)
         │   └─ POST /v1/sessions/{id}/runs → 201
         │       → engine.create_run(session_id, "opendrsai@1", idempotency_key)
         │
T+0.3s   ├─ client.executeRun(runId, prompt, modelAlias)
         │   └─ POST /v1/runs/{id}/execute → 202
         │       ├─ engine.get_run(run_id)
         │       ├─ engine.set_run_input(run_id, prompt, ...)
         │       └─ asyncio.create_task(execute())  ← 后台任务
         │           │
T+0.4s   │           ├─ agent_service().execute(run_id, prompt, ...)
T+0.5s   │           │   └─ DesktopAgentBackend.execute(context, ...)
T+0.6s   │           │       ├─ services.emit("agent.started")
T+0.7s   │           │       ├─ agent_manager().get_or_create(...)
T+0.8s   │           │       │   └─ create_agent() ← 重量级初始化
T+1.5s   │           │       │       ├─ 加载 LLM catalog
T+1.6s   │           │       │       ├─ 解析模型配置
T+1.7s   │           │       │       ├─ 创建 model client
T+1.8s   │           │       │       ├─ 加载技能/工具
T+1.9s   │           │       │       └─ 实例化 DrSaiAssistant
T+2.0s   │           │       ├─ agent.lazy_init()
T+2.1s   │           │       ├─ agent.load_state() ← 恢复历史
T+2.2s   │           │       └─ agent.run_stream(task, cancellation_token)
T+2.3s   │           │           │
T+2.5s   │           │           ├─ yield message.delta ← LLM 流式输出
T+2.6s   │           │           ├─ translate → "agent.message.delta"
T+2.7s   │           │           ├─ services.emit("agent.message.delta", {delta})
T+2.8s   │           │           │   → 写入 runtime_events 表 (append-only)
T+2.9s   │           │           │   → RuntimeConversationJournal → OAEP items
         │           │           │
T+3.0s   │           ├─ client.subscribe(sessionId, cursor)
         │           │   └─ GET /v1/sessions/{id}/oaep-events/stream (SSE)
         │           │       ├─ id: {seq}
         │           │       ├─ event: oaep.event
         │           │       └─ data: {json} ← 实时推送到 Renderer
         │           │
T+10s    │           ├─ yield tool.start ← 工具调用
T+10.1s  │           │   ├─ translate → "tool.started"
T+10.2s  │           │   ├─ services.emit("tool.started", {call_id, ...})
T+10.3s  │           │   └─ SSE 推送到 Renderer
T+15s    │           ├─ yield tool.complete
T+15.1s  │           │   └─ services.emit("tool.completed", ...)
T+20s    │           ├─ yield message.delta ← 继续输出
T+25s    │           └─ agent 完成
T+25.1s  │               ├─ services.emit("agent.completed", {content})
T+25.2s  │               └─ _artifacts.register_new_artifacts(...)
T+25.3s  └─ SSE 流关闭, Renderer 显示完整回复
```
---

## 四、路由不匹配矩阵 (V1 runtimeClient.ts vs V2 desktop_gateway)

| V1 runtimeClient.ts 调用的路由 | desktop_gateway 是否有 | 说明 |
|---|---|---|
| `GET /health` | ❌ 缺失 | ★ 启动轮询失败根因 |
| `GET /v1/runtime` | ✅ 有 | 握手路由，PUBLIC_PATHS |
| `POST /v1/chat/completions` | ❌ 缺失 | ★ V1 聊天核心路由 |
| `GET /v1/config/user-name` | ❌ 缺失 | 身份同步失败 |
| `PUT /v1/config/user-name` | ❌ 缺失 | 身份同步失败 |
| `PUT /v1/config/cli/user_id` | ❌ 缺失 | 身份同步失败 |
| `GET /v1/capabilities` | ❌ 缺失 | 能力查询 |
| `POST /v1/owop` | ❌ 缺失 | OWOP 操作 |
| `WS /v1/pty` | ❌ 缺失 | 终端 WebSocket |
| `GET /v1/sessions` | ✅ 有 | 列出会话 |
| `POST /v1/sessions` | ✅ 有 | 创建会话 |
| `GET /v1/sessions/{id}` | ✅ 有 | 获取会话 |
| `PATCH /v1/sessions/{id}` | ✅ 有 | 更新会话 |
| `GET /v1/sessions/{id}/snapshot` | ✅ 有 | 会话快照 |
| `GET /v1/sessions/{id}/events` | ✅ 有 | 会话事件 |
| `GET /v1/sessions/{id}/oaep-events/stream` | ✅ 有 | ★ SSE 流式输出 |
| `POST /v1/sessions/{id}/runs` | ✅ 有 | 创建 Run |
| `POST /v1/runs/{id}/execute` | ✅ 有 | 执行 Run (202) |
| `POST /v1/runs/{id}/cancel` | ✅ 有 | 取消 Run |
| `GET /v1/workspaces` | ✅ 有 | 列出工作区 |
| `POST /v1/workspaces` | ✅ 有 | 创建工作区 |
| `GET /v1/workspaces/{id}` | ✅ 有 | 获取工作区 |
| `GET /v1/models` | ✅ 有 | 列出模型 |
| `GET /v1/audio/speech` | ✅ 有 | TTS |

**统计**: V1 调用 ~70 个路由, V2 desktop_gateway 仅提供 17 个路由

**关键断裂点**:
1. `/health` 缺失 → Gateway 启动轮询 30s 超时
2. `/v1/chat/completions` 缺失 → 聊天不可用
3. `/v1/config/*` 缺失 → 身份同步失败

---

## 五、认证数据流详图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        认证数据流 — 三层令牌模型                              │
└─────────────────────────────────────────────────────────────────────────────┘

1. OIDC PKCE 登录流程 (auth.ts)
   ┌─────────────┐    ┌──────────────┐    ┌─────────────┐    ┌────────────┐
   │ Electron UI │    │ Loopback     │    │ OIDC Provider│    │ Credential │
   │ "登录" 按钮 │───→│ HTTP Server  │    │ (AuthSSO)   │    │ Service    │
   └─────────────┘    └──────────────┘    └─────────────┘    └────────────┘
        │                    │                    │                  │
        │ 1. startOidcLogin()│                    │                  │
        │ 2. 生成 PKCE pair   │                    │                  │
        │    code_verifier    │                    │                  │
        │    code_challenge   │                    │                  │
        │    =SHA256(verifier)│                    │                  │
        │    .base64url()     │                    │                  │
        │                    │                    │                  │
        │ 3. 启动 loopback    │                    │                  │
        │    HTTP server      │                    │                  │
        │    (随机端口)        │                    │                  │
        │                    │                    │                  │
        │ 4. 打开浏览器       │                    │                  │
        │    authorization    │                    │                  │
        │    endpoint URL     │                    │                  │
        │    +client_id       │                    │                  │
        │    +redirect_uri   │                    │                  │
        │    +code_challenge  │                    │                  │
        │    +scope           │                    │                  │
        │    "openid email    │                    │                  │
        │     profile roles   │                    │                  │
        │     groups hai_api" │                    │                  │
        │                    │                    │                  │
        │                    │ 5. 用户在浏览器    │                  │
        │                    │    完成认证        │                  │
        │                    │                    │ 6. 回调          │
        │                    │←──────────────────│    ?code=xxx     │
        │                    │                    │                  │
        │ 7. POST /token     │                    │                  │
        │    code + verifier  │──────────────────→│                  │
        │                    │ 8. 返回            │                  │
        │                    │←──────────────────│    access_token  │
        │                    │    id_token       │                  │
        │                    │    refresh_token  │                  │
        │                    │                    │                  │
        │ 9. RS256 验证       │                    │                  │
        │    id_token + JWKS │                    │                  │
        │                    │                    │                  │
        │ 10. claims 交叉验证│                    │                  │
        │    sub, email,     │                    │                  │
        │    name, groups    │                    │                  │
        │                    │                    │                  │
        │ 11. 加密存储        │                    │                  │
        │    access_token →  │                    │                  │
        │    Windows DPAPI    │──────────────────────────────────→  存储
        │                    │                    │                  │
        └────────────────────┘                    └──────────────┘  └──────────┘

2. 双层令牌模型
   ┌─────────────────────────────────────────────────────────────────────────┐
   │ Layer 1: Instance Token (进程身份)                                      │
   │   - 名称: GATEWAY_INSTANCE_TOKEN                                       │
   │   - Header: X-OpenDrSai-Gateway-Token                                  │
   │   - 生成: gateway.ts 启动时随机生成                                     │
   │   - 用途: Electron → desktop_gateway 通信鉴权                           │
   │   - 验证: _auth.py 比对环境变量 OPEN_DRSAI_GATEWAY_TOKEN                │
   │   - 不在 PUBLIC_PATHS 中的路由必须携带此 token                          │
   └─────────────────────────────────────────────────────────────────────────┘
   ┌─────────────────────────────────────────────────────────────────────────┐
   │ Layer 2: Bearer Token (用户身份)                                        │
   │   - Header: Authorization: Bearer <access_token>                       │
   │   - 附加: X-OpenDrSai-Auth-Mode: oidc                                  │
   │           X-OpenDrSai-Principal: <user_id>                             │
   │   - 来源: OIDC access_token (RS256 签名)                               │
   │   - 用途: 用户身份验证 + 授权                                            │
   │   - 验证: _auth.py 解析 Bearer → 提取 sub → 比对 X-OpenDrSai-Principal  │
   │           不匹配 → 403 Forbidden                                       │
   └─────────────────────────────────────────────────────────────────────────┘

3. 请求鉴权流程 (desktop_gateway/_auth.py)
   ┌─────────────────┐
   │ HTTP 请求到达   │
   └────────┬────────┘
            │
            ▼
   ┌─────────────────────────┐
   │ 路径在 PUBLIC_PATHS?    │
   │ PUBLIC_PATHS = {        │
   │   "/v1/runtime"         │
   │ }                       │
   └────────┬────────────────┘
            │
       是?  ├──────────→ 放行
            │
       否   ▼
   ┌─────────────────────────┐
   │ 检查 X-OpenDrSai-        │
   │ Gateway-Token            │
   │ == 环境变量?             │
   └────────┬────────────────┘
            │
      不匹配├──────────→ 401 Unauthorized
            │
       匹配 ▼
   ┌─────────────────────────┐
   │ 有 Authorization:       │
   │ Bearer?                │
   └────────┬────────────────┘
            │
       否   ├──────────→ 放行 (仅 Instance Token)
            │
       是   ▼
   ┌─────────────────────────┐
   │ 解析 Bearer token       │
   │ 提取 sub (user_id)      │
   │ 比对 X-OpenDrSai-        │
   │ Principal header        │
   └────────┬────────────────┘
            │
      不匹配├──────────→ 403 Forbidden
            │
       匹配 ▼
   ┌─────────────────────────┐
   │ 放行, request.state.    │
   │ principal = user_id     │
   └─────────────────────────┘
```

---

## 六、流式输出数据流详图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                  流式输出数据流 — 从 LLM 到 Renderer                         │
└─────────────────────────────────────────────────────────────────────────────┘

Renderer (Chat UI)
    ▲
    │ EventSource (SSE)
    │
    │ GET /v1/sessions/{id}/oaep-events/stream?cursor=0
    │ Headers: X-OpenDrSai-Gateway-Token, Authorization: Bearer...
    │
    ▼
desktop_gateway (routes/sessions.py: streamSessionEvents)
    │
    │ while True:
    │   events = engine.wait_oaep_events(session_id, timeout=15, limit=500, cursor)
    │   for event in events:
    │     yield f"id: {seq}\nevent: oaep.event\ndata: {json.dumps(event)}\n\n"
    │
    ▼
RuntimeEngine (runtime/engine.py)
    │
    │ wait_oaep_events(session_id, timeout, limit, cursor):
    │   → SELECT * FROM runtime_events
    │     WHERE session_id = ? AND seq > cursor
    │     ORDER BY seq ASC
    │     LIMIT 500
    │   → 如果无新事件: time.sleep(poll_interval)
    │   → 超过 timeout: 返回空
    │
    ▲ (事件如何写入 runtime_events?)
    │
    │ services.emit(kind, payload, session_id, run_id):
    │   → engine.record_oaep_event(session_id, run_id, kind, payload)
    │     → INSERT INTO runtime_events (session_id, run_id, seq, kind, payload)
    │       VALUES (?, ?, next_seq(), ?, ?)
    │     → SQLite WAL: 即时写入
    │     → runtime_events 有 trigger: 防止 UPDATE/DELETE
    │
    ▼
AgentService (desktop_gateway/_agent_service.py)
    │
    │ execute(run_id, prompt, ...):
    │   → agent_backend.execute(context, request)
    │
    ▼
DesktopAgentBackend (desktop_gateway/_agent_backend.py)
    │
    │ execute(context, request):
    │   1. services.emit("agent.started", {run_id, ...})
    │   2. _input_task(request.prompt)
    │   3. async for event in agent_manager().run_stream(...):
    │        translate_conversation_event(event) → _normalize_event()
    │        services.emit(normalized_kind, normalized_payload)
    │   4. services.emit("agent.completed", {content, ...})
    │
    │ _normalize_event() 事件映射:
    │   autogen "message.delta"    → "agent.message.delta"
    │   autogen "tool.start"       → "tool.started"
    │   autogen "tool.complete"     → "tool.completed"
    │   autogen "reasoning.delta"  → "agent.reasoning.delta"
    │   autogen "citation.added"   → "citation.added"
    │
    ▼
DesktopAgentManager (desktop_gateway/_agent_manager.py)
    │
    │ run_stream(session_id, user_id, task, workspace_id, work_dir, ...):
    │   1. async with self._locks[key]:  ← per-key Lock
    │        if key in active: raise "session_busy"  ← 拒绝并发
    │   2. agent = self.get_or_create(user_id, session_id, work_dir, ...)
    │   3. agent._runtime_workspace_path = Path(work_dir).resolve()
    │   4. async for event in agent.run_stream(task, cancellation_token):
    │        yield event  ← 产出 raw autogen 事件
    │   5. finally: save_state()
    │
    ▼
DrSaiAssistant (modules/agents/skills_agent.py)
    │
    │ run_stream(task, cancellation_token):
    │   → autogen-core 驱动:
    │     1. 构造 prompt → 发送给 LLM
    │     2. LLM 流式返回 → yield message.delta
    │     3. LLM 请求工具调用 → yield tool.start
    │     4. 执行工具 → yield tool.complete
    │     5. 工具结果反馈给 LLM → 继续循环
    │     6. LLM 结束 → yield message.delta (final)
    │
    │ cancellation_token: 支持用户取消 (POST /v1/runs/{id}/cancel)
    │
    ▼
LLM API (HepAI / OpenAI / Anthropic / Gemini)
    │
    │ model_client.stream_create(...)  ← model_client_stream=True
    │   → HTTP POST /v1/chat/completions (stream=true)
    │   → SSE: data: {choices: [{delta: {content: "..."}}]}
    │   → 逐 chunk 转换为 autogen message.delta 事件
    │
    └─────────────────────────────────────────────────────────────────────────
```

---

## 七、关键文件索引

| 层级 | 文件路径 | 关键行/函数 | 说明 |
|---|---|---|---|
| **Electron Main** | | | |
| | `apps/desktop/windows/src/main/index.ts` | registerIpc, createWindow | V1 主入口, ~200 IPC handler |
| | `apps/desktop/shared/main/gateway.ts` | startGateway (L80), pollGatewayReady (L100), getGatewayRequestHeaders (L130), getAuthenticatedGatewayRequestHeaders (L137), syncAuthIdentityToGateway (L198) | Gateway 生命周期管理 |
| | `apps/desktop/shared/main/auth.ts` | startOidcLogin, verifyIdToken, storeTokens | OIDC PKCE 登录 |
| | `apps/desktop/shared/main/runtimeClient.ts` | LocalRuntimeClient.connect (L1498), createRun (L1252) | V1 运行时客户端, 1934 行 |
| | `apps/desktop/shared/main/workspaceContext.ts` | - | V2 gateway adapters |
| | `apps/desktop/windows/electron.vite.config.ts` | - | V1/V2 构建入口配置 |
| **desktop_gateway** | | | |
| | `desktop_gateway/app.py` | create_app, main | FastAPI 应用创建, uvicorn 启动 |
| | `desktop_gateway/_auth.py` | PUBLIC_PATHS, verify_gateway | 双层令牌验证 |
| | `desktop_gateway/_state.py` | runtime_registry, runtime_engine, agent_manager, agent_service | 懒加载单例 |
| | `desktop_gateway/_agent_manager.py` | DesktopAgentManager.get_or_create, run_stream | per-session Agent 缓存 |
| | `desktop_gateway/_agent_backend.py` | DesktopAgentBackend.execute, _normalize_event | AgentBackend 协议实现 |
| | `desktop_gateway/_agent_service.py` | AgentService.execute, cancel | Run 执行服务 |
| | `desktop_gateway/routes/sessions.py` | createSession, streamSessionEvents | 会话路由 + SSE |
| | `desktop_gateway/routes/runs.py` | run_create, run_execute, run_cancel | Run 路由 (三步分离) |
| | `desktop_gateway/routes/workspaces.py` | listWorkspaces, createWorkspace | 工作区路由 |
| | `desktop_gateway/routes/models.py` | listModels | 模型列表 |
| | `desktop_gateway/routes/audio.py` | speech | TTS 路由 |
| **runtime** | | | |
| | `runtime/engine.py` | RuntimeEngine, create_session, create_run, record_oaep_event, wait_oaep_events, _CheckpointCipher | SQLite 引擎, ~1000+ 行 |
| | `runtime/registry.py` | RuntimeRegistry | 运行时身份注册 |
| | `runtime/normalized_events.py` | NormalizedEventKind, NormalizedItemType, NormalizedDeltaKind | OAEP 事件协议 |
| | `runtime/artifact_store.py` | ArtifactStore | 工件存储 |
| | `runtime/artifact_dao.py` | ArtifactDAO | 工件 DAO |
| **agent_factory** | | | |
| | `run_drsai_agent_factory.py` | create_agent (L726+) | Agent 工厂, ~500 行 |
| | `modules/agents/skills_agent.py` | DrSaiCLIAssistant.run_stream | Agent 实现 |
| | `modules/agents/agent_kernel.py` | create_agent_kernel | 内核创建 |

---

## 八、修复方案

### 方案 A: 最小修复 (在 desktop_gateway 中添加缺失路由)

**目标**: 让 V1 `runtimeClient.ts` 能正常工作

**修改清单**:

1. **添加 `/health` 路由** (desktop_gateway/app.py 或 routes/runtime.py)
   ```python
   @app.get("/health")
   async def health_check():
       return {"status": "ok"}
   ```

2. **将 `/health` 加入 `_auth.py` 的 PUBLIC_PATHS**
   ```python
   PUBLIC_PATHS = frozenset({"/v1/runtime", "/health"})
   ```

3. **添加 `/v1/chat/completions` 路由** (新建 routes/chat.py 或在 sessions.py)
   - 接收 V1 格式的请求 (prompt, model, workspace)
   - 内部转换为 V2 三步流程: createSession → createRun → executeRun
   - 返回 SSE 流

4. **添加 `/v1/config/*` 路由**
   - `GET /v1/config/user-name` → 返回当前用户名
   - `PUT /v1/config/user-name` → 设置用户名
   - `PUT /v1/config/cli/user_id` → 设置 user_id

5. **端口对齐**: 确认 desktop_gateway 监听 28642 (Electron 期望) 还是 28643

**优点**: 改动集中, 不影响 V2 workbench.ts 路径
**缺点**: 需要维护 V1 兼容路由, 技术债

### 方案 B: 切换到 V2 客户端 (推荐)

**目标**: 放弃 V1 runtimeClient.ts, 使用 V2 workbench.ts 路径

**修改清单**:

1. **修改 `electron.vite.config.ts`** 构建入口
   - 从 `index.ts` (V1) 切换到 `workbench.ts` (V2)
   - 或合并两者

2. **确保 V2 desktopGateway/ 客户端** 已实现
   - 创建会话: `POST /v1/sessions`
   - 创建 Run: `POST /v1/sessions/{id}/runs`
   - 执行 Run: `POST /v1/runs/{id}/execute`
   - 订阅 SSE: `GET /v1/sessions/{id}/oaep-events/stream`

3. **在 desktop_gateway 添加 `/health` 路由**
   - 即使 V2 也需要启动健康检查

4. **迁移 IPC handlers**
   - V1: `desktop:chat:send` → V2: `chat.send`
   - V1: `desktop:runtime:*` → V2: 对应的 desktopGateway 调用

**优点**: 架构更干净, 不需要维护兼容路由
**缺点**: 改动范围大, 需要迁移所有 IPC handlers

### 方案 C: 混合方案 (推荐短期)

1. **立即修复**: 添加 `/health` 路由 + PUBLIC_PATHS (解决启动超时)
2. **短期适配**: 添加 `/v1/chat/completions` 适配路由 (解决聊天)
3. **中期迁移**: 逐步将 V1 IPC handlers 迁移到 V2
4. **长期目标**: 完全切换到 V2 workbench.ts

---

## 附录: 数据流关键路径总结

```
Electron Renderer (Chat UI)
    ↓ IPC
Electron Main (index.ts)
    ↓ spawn + HTTP
desktop_gateway (FastAPI, port 28642/28643)
    ↓ lazy singleton
RuntimeEngine (SQLite, WAL, append-only)
    ↓ record_oaep_event
runtime_events 表 (trigger 保护)
    ↓ wait_oaep_events
SSE 流 (oaep-events/stream)
    ↓ EventSource
Electron Renderer (Chat UI)

Agent 路径:
desktop_gateway
    ↓ agent_service().execute()
DesktopAgentBackend
    ↓ translate + normalize
services.emit() → runtime_events
    ↓
DesktopAgentManager
    ↓ get_or_create (per-session cache)
create_agent() (run_drsai_agent_factory.py)
    ↓ LLM catalog + model config + tools
DrSaiAssistant
    ↓ run_stream()
autogen-core + LLM API
    ↓ yield events
```
