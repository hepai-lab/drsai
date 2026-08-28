# Desktop Gateway 路由全览

> **路径**: `cores/python/packages/drsai/src/drsai/backend/desktop_gateway/`
> **生成日期**: 2026-08-27
> **路由总数**: 42 条（37 条路径，含 `/health`、`/v1/models`、`/v1/config/user-name`、`/v1/identity/canonicalize` 等迁移补全路由）
> **FastAPI 应用**: 独立于 legacy gateway 的 `app = create_app()`，端口 `28643`

---

## 目录

1. [架构总览](#1-架构总览)
2. [认证机制](#2-认证机制)
3. [路由注册](#3-路由注册)
4. [路由清单（按模块）](#4-路由清单按模块)
5. [支撑模块](#5-支撑模块)
6. [Feature 映射表](#6-feature-映射表)
7. [错误响应格式](#7-错误响应格式)
8. [V1 兼容性差距](#8-v1-兼容性差距)

---

## 1. 架构总览

```
desktop_gateway/
├── __init__.py            # 包入口，导出 create_app, main, DEFAULT_HOST, DEFAULT_PORT
├── __main__.py            # python -m drsai.backend.desktop_gateway 入口
├── app.py                 # FastAPI 装配 + uvicorn 启动
├── _auth.py               # 认证中间件（gateway token + OIDC bearer）
├── _state.py              # 懒加载单例（RuntimeRegistry/Engine/ArtifactStore/AgentService）
├── _models.py             # 请求体 Pydantic 模型
├── _errors.py             # Runtime 异常 → HTTP 状态码映射
├── _oaep.py               # P1 Items → P2 OAEP 形状投影
├── _artifacts.py          # Artifact 交付 + artifacts/ 目录扫描
├── _agent_manager.py      # 每个 (user, session) 的 Agent 缓存
├── _agent_backend.py      # autogen 事件 → Runtime 事件翻译（DesktopAgentBackend）
├── _workspace_files.py    # 文件树 + 单文件读取
└── routes/
    ├── __init__.py         # 10 个路由模块导出
    ├── runtime.py          # Feature 1: 身份与健康
    ├── workspaces.py       # Feature 2.5, 2.3, 4.1: 工作区
    ├── sessions.py         # Feature 2.1, 2.2, 3.1, 3.3: 会话
    ├── runs.py             # Feature 3.1: 运行
    ├── models.py           # Feature 3.2: 模型选择 + OpenAI兼容 /v1/models
    ├── audio.py            # Feature 3.4: 语音转文字
    ├── config.py           # V1兼容 /v1/config/* 路由
    ├── capabilities.py     # GET /v1/capabilities
    ├── agent_backends.py   # /v1/agent-backends/*
    └── identity.py         # PUT /v1/config/user-name, POST /v1/identity/canonicalize
```

### 关键设计原则

- **独立应用**: 不挂载到 legacy gateway 的 app 上，避免继承其中间件栈和冻结的路由顺序
- **薄包装**: 所有路由都是 `backend/runtime/` 已实现功能的 HTTP 包装
- **端口分离**: `28643`（本网关） vs `28642`（legacy），允许迁移期同时运行
- **无自有持久化**: 复用 `RuntimeRegistry` / `RuntimeEngine` 的 SQLite 文件

### 环境变量

| 变量 | 默认值 | 用途 |
|------|--------|------|
| `DRSAI_DESKTOP_GATEWAY_HOST` | `127.0.0.1` | 绑定地址 |
| `DRSAI_DESKTOP_GATEWAY_PORT` | `28643` | 绑定端口 |
| `DRSAI_DESKTOP_GATEWAY_HOME` | → `DRSAI_HOME` → `~/.drsai` | 状态根目录 |
| `DRSAI_GATEWAY_DEV_MANAGED` | (未设置) | 开发管理模式标志 |
| `DRSAI_STT_MODEL` | `whisper-1` | STT 默认模型 |

---

## 2. 认证机制

**文件**: `_auth.py`

### 中间件流程

```
请求进入
  │
  ├─ path ∈ PUBLIC_PATHS? ──── 是 ──→ 放行（跳过认证）
  │                                    │
  │                                    否
  │                                    │
  ├─ verify_gateway_instance(token)? ── 失败 → 401 gateway_unauthorized
  │                                    │
  │                                    成功
  │                                    │
  ├─ auth-mode == "oidc"? ──────────── 是 ──→ 验证 Bearer token
  │                                    │         ├─ subject 不匹配 → 403 subject_mismatch
  │                                    │         ├─ token 过期 → 401 token_expired (retryable)
  │                                    │         └─ 验证通过 → 安装 auth_context
  │                                    │
  │                                    否（offline 模式）
  │                                    │
  └─ 放行，auth_context = None
```

### PUBLIC_PATHS

```python
PUBLIC_PATHS = frozenset({"/v1/runtime", "/v1/capabilities", "/health"})
```

这两个路径不需要 gateway token 即可访问：
- `GET /v1/runtime` — 桌面进程需要先确认 Runtime 身份，才能获取配对 token
- `GET /health` — 桌面进程的 `pollGatewayReady()` 轮询，在任何认证之前确认进程存活

### 请求头

| 头部 | 必要性 | 用途 |
|------|--------|------|
| `x-opendrsai-gateway-token` | 非PUBLIC路径必填 | 证明调用者是配对的本地主进程 |
| `x-opendrsai-auth-mode` | 可选 | `"oidc"` 或 `"offline"` |
| `authorization` | OIDC模式必填 | `Bearer <hepai access token>` |
| `x-opendrsai-principal` | OIDC模式必填 | 调用者声称的主体身份 |
| `x-correlation-id` | 可选 | 请求追踪ID（不匹配正则则自动生成UUID） |

### 用户身份解析

```python
effective_user_id(supplied) → str
```

- OIDC 模式: 返回 `auth.subject`（已验证的 OIDC 主体），忽略调用者传入的 `supplied`
- Offline 模式: 返回 `supplied` 或 `"local"`

**核心安全保证**: 登录身份决定历史归属——渲染器无法通过修改请求体中的字段来访问另一个账户的会话。

---

## 3. 路由注册

**文件**: `app.py`

```python
ROUTERS = (
    runtime.router,      # 2 路由
    workspaces.router,   # 4 路由
    sessions.router,     # 6 路由
    runs.router,         # 3 路由
    models.router,       # 2 路由
    audio.router,        # 1 路由
    config.router,       # 14 路由
    capabilities.router, # 1 路由
    agent_backends.router, # 6 路由
    identity.router,     # 2 路由
)

def create_app() -> FastAPI:
    app = FastAPI(title="OpenDrSai Desktop Runtime", version="2.0.0", lifespan=lifespan)
    _auth.install(app)
    for factory in ROUTERS:
        app.include_router(factory())
    return app
```

每个路由模块定义 `api = APIRouter(tags=[...])`，通过 `def router() -> APIRouter: return api` 工厂函数暴露，`create_app()` 循环调用 `factory()` 挂载。

---

## 4. 路由清单（按模块）

### 4.1 runtime — 身份与健康

**文件**: `routes/runtime.py` | **tags**: `["runtime"]` | **Feature**: 1（OIDC登录身份）

| # | 方法 | 路径 | operation_id | 认证 | 状态码 | 说明 |
|---|------|------|-------------|------|--------|------|
| 1 | GET | `/health` | `healthCheck` | PUBLIC | 200 | 健康探针 |
| 2 | GET | `/v1/runtime` | `getRuntimeIdentity` | PUBLIC | 200 | Runtime身份 |

#### Route 1: `GET /health`

**认证**: PUBLIC（无需任何头部）

**用途**: Electron 主进程的 `gateway.ts` 在启动 Python 子进程后轮询此路由，确认进程已就绪。每 500ms 一次，30s 超时，有 750ms 缓存和 3 次失败阈值。

**响应**:
```json
{
  "status": "ok"
}
```

> **新增路由**（2026-08-27）。V1 `gateway.ts` 的 `pollGatewayReady()` 期望 `body.status === "ok"`，原 desktop_gateway 无此路由，导致进程启动检测失败。

#### Route 2: `GET /v1/runtime`

**认证**: PUBLIC

**用途**: 桌面进程在启动时调用，确认它启动的 Runtime 进程是期望的实例，并学习协议版本，以便版本不匹配时给出清晰错误而非后续的 422。

**响应**:
```json
{
  "runtime_id": "<string>",
  "instance_id": "<string>",
  "version": "<string>",
  "protocol_version": "<string>",
  "surface": "desktop-v2",
  "capabilities": [
    "model_catalog", "runs", "session_events", "sessions",
    "speech_to_text", "workspace_files", "workspaces"
  ],
  "platform": "<sys.platform>",
  "dev_managed": false,
  "runtime_source_digest": "<sha256 hex>"
}
```

**字段说明**:

| 字段 | 类型 | 说明 |
|------|------|------|
| `runtime_id` | str | Runtime 稳定标识（来自 RuntimeRegistry） |
| `instance_id` | str | 当前实例标识 |
| `version` | str | `drsai.version.__version__` |
| `protocol_version` | str | `remote_ssh.workspace.PROTOCOL_VERSION` |
| `surface` | str | 固定 `"desktop-v2"` |
| `capabilities` | list[str] | 此 surface 实现的功能集（已排序） |
| `platform` | str | `sys.platform` |
| `dev_managed` | bool | `DRSAI_GATEWAY_DEV_MANAGED == "1"` |
| `runtime_source_digest` | str | import 时同步计算所有 `.py` 文件的 SHA256 指纹 |

**CAPABILITIES 集合**:
```python
CAPABILITIES = frozenset({
    "workspaces", "sessions", "session_events", "runs",
    "model_catalog", "speech_to_text", "workspace_files",
})
```

> 注意：Feature 2.4（个人信息）和 3.3（会话状态）不在 capabilities 中，因为它们不需要路由：前者读取主进程已持有的 OIDC claims，后者折叠事件流中的 `run.status` 事件。

---

### 4.2 workspaces — 工作区容器

**文件**: `routes/workspaces.py` | **tags**: `["workspaces"]` | **Features**: 2.5, 2.3, 4.1

| # | 方法 | 路径 | operation_id | 认证 | 状态码 | 说明 |
|---|------|------|-------------|------|--------|------|
| 3 | GET | `/v1/workspaces` | `listWorkspaces` | gateway token | 200 | 列出所有工作区 |
| 4 | POST | `/v1/workspaces` | `openWorkspace` | gateway token | 200 | 注册/返回工作区 |
| 5 | GET | `/v1/workspaces/{workspace_id}/files` | `listWorkspaceFiles` | gateway token | 200 | 文件树+git状态 |
| 6 | GET | `/v1/workspaces/{workspace_id}/file` | `readWorkspaceFile` | gateway token | 200 | 单文件内容 |

#### Route 3: `GET /v1/workspaces`

**用途**: Feature 2.5。列出此 Runtime 已知的所有 Workspace。

**查询参数**:

| 参数 | 类型 | 默认 | 约束 | 说明 |
|------|------|------|------|------|
| `include_closed` | bool | `false` | — | 是否包含已关闭的 Workspace |

**响应**:
```json
{
  "data": [
    { /* WorkspaceRecord.as_dict() */ }
  ]
}
```

#### Route 4: `POST /v1/workspaces`

**用途**: Feature 2.5。将一个目录注册为 Workspace。**路径幂等**——如果目录已注册，返回现有记录而非创建重复。

**请求体** (`WorkspaceOpenRequest`):
```json
{
  "path": "/path/to/project",
  "display_name": "My Project"
}
```

**错误**:
- `400` — 路径不存在 / OSError / ValueError

**响应**: `WorkspaceRecord.as_dict()`

#### Route 5: `GET /v1/workspaces/{workspace_id}/files`

**用途**: Feature 2.3。有界工作区文件树，带 git 状态徽章。

**路径参数**:

| 参数 | 类型 | 说明 |
|------|------|------|
| `workspace_id` | str | Workspace 标识 |

**查询参数**:

| 参数 | 类型 | 默认 | 约束 | 说明 |
|------|------|------|------|------|
| `path` | str | `"."` | — | 起始路径 |
| `depth` | int | `2` | `0-5` | 递归深度 |
| `query` | str | `""` | — | 过滤关键词 |
| `offset` | int | `0` | `≥0` | 分页偏移 |
| `max_entries` | int | `500` | `1-5000` | 最大返回条目 |

**响应** (浏览模式 → tree 形状; 搜索/分页 → flat 形状):
```json
{
  "workspace_id": "<string>",
  "shape": "tree" | "flat",
  "data": [
    {
      "name": "src",
      "path": "src",
      "directory": true,
      "size": 4096,
      "modified_at": 1234567890.0,
      "children": [/* ... */],
      "git_status": "modified"
    }
  ],
  "total": 42,
  "offset": 0,
  "next_offset": null,
  "truncated": false,
  "scan_limit": 5000
}
```

**git_status 值**: `untracked`, `renamed`, `deleted`, `added`, `modified`

**安全特性**:
- `.gitignore` + 固定忽略集（`node_modules`, `__pycache__` 等）
- `scan_limit` 限制遍历总量，不仅是返回量
- `resolve(strict=True)` + `relative_to(root)` 拒绝指向工作区外的符号链接
- 子目录的 git 状态通过前缀匹配传播到父目录

#### Route 6: `GET /v1/workspaces/{workspace_id}/file`

**用途**: Feature 4.1。读取单个文件内容，用于预览面板。

**查询参数**:

| 参数 | 类型 | 默认 | 约束 | 说明 |
|------|------|------|------|------|
| `path` | str | (必填) | — | 文件相对路径 |
| `max_bytes` | int | `262144` | `1-1048576` | 最大读取字节数 |

**响应** (文本文件):
```json
{
  "path": "src/main.py",
  "mime": "text/x-python",
  "truncated": false,
  "size": 1024,
  "modified_at": 1234567890.0,
  "sha256": "<hex>",
  "content": "...",
  "binary": false,
  "encoding": "utf-8"
}
```

**响应** (二进制文件):
```json
{
  "path": "data/image.png",
  "mime": "image/png",
  "truncated": false,
  "size": 2048,
  "modified_at": 1234567890.0,
  "sha256": "<hex>",
  "data_url": "data:image/png;base64,...",
  "binary": true,
  "encoding": null
}
```

> 前 8KB 含 NUL 字节则判定为二进制。最大 1MB。

---

### 4.3 sessions — 会话与事件流

**文件**: `routes/sessions.py` | **tags**: `["sessions"]` | **Features**: 2.1, 2.2, 3.1, 3.3

| # | 方法 | 路径 | operation_id | 认证 | 状态码 | 说明 |
|---|------|------|-------------|------|--------|------|
| 7 | POST | `/v1/sessions` | `createSession` | gateway token | 201 | 新建会话 |
| 8 | GET | `/v1/sessions` | `listSessions` | gateway token | 200 | 会话列表 |
| 9 | GET | `/v1/sessions/{session_id}` | `getSession` | gateway token | 200 | 会话元数据 |
| 10 | PATCH | `/v1/sessions/{session_id}` | `updateSession` | gateway token | 200 | 重命名/归档 |
| 11 | GET | `/v1/sessions/{session_id}/oaep-snapshot` | `getSessionSnapshot` | gateway token | 200 | 完整投影 |
| 12 | GET | `/v1/sessions/{session_id}/oaep-events` | `listSessionEvents` | gateway token | 200 | 事件重放 |
| 13 | GET | `/v1/sessions/{session_id}/oaep-events/stream` | `streamSessionEvents` | gateway token | 200 (SSE) | 实时事件流 |

#### Route 7: `POST /v1/sessions`

**用途**: Feature 2.1。在一个 Workspace 中开始新会话。

**请求体** (`SessionCreateRequest`):
```json
{
  "workspace_id": "<string>",
  "title": "New session"
}
```

**错误**:
- `404` — Unknown or closed Workspace

**响应**: RuntimeEngine 的 `create_session()` 返回值

#### Route 8: `GET /v1/sessions`

**用途**: Features 2.2, 2.5。一个 Workspace 的历史会话列表。

**查询参数**:

| 参数 | 类型 | 默认 | 约束 | 说明 |
|------|------|------|------|------|
| `workspace_id` | str | (必填) | — | Workspace 标识 |
| `offset` | int | `0` | `≥0` | 分页偏移 |
| `limit` | int | `50` | `1-200` | 每页条数 |
| `archived` | bool\|null | `false` | — | 归档过滤 |

**错误**:
- `404` — Unknown Workspace

#### Route 9: `GET /v1/sessions/{session_id}`

**用途**: 获取单个会话的元数据：标题、生命周期、Workspace、修订号。

**错误**:
- `404` — Unknown Session

#### Route 10: `PATCH /v1/sessions/{session_id}`

**用途**: Feature 2.2。重命名或归档会话。

**请求体** (`SessionUpdateRequest`):
```json
{
  "title": "New title",
  "archived": true,
  "lifecycle": "archived"
}
```

> `lifecycle` 优先于 `archived`（当两者同时设置时）。

**错误**:
- `404` — Unknown Session

#### Route 11: `GET /v1/sessions/{session_id}/oaep-snapshot`

**用途**: Feature 2.2。获取会话的完整 OAEP 投影，用于打开历史记录。

**查询参数**:

| 参数 | 类型 | 默认 | 约束 | 说明 |
|------|------|------|------|------|
| `cursor` | str\|null | `null` | — | 分页游标 |
| `limit` | int | `100` | `1-500` | 每页条目数 |

**响应**: 经过 `_oaep.migrate_snapshot()` 投影的快照，包含：
- `items` — P1→P2 投影后的 Item 列表
- `session` — 会话元数据
- `snapshot_sequence` — 快照水位线
- `window` — 分页窗口信息
- `checkpoint` — 基于**投影后**的 Items 重计算的检查点（`snapshot_hash`, `item_count`）

> **关键**: checkpoint 的 `snapshot_hash` 是对完整 Item 集合（非仅当前页）的投影后 Items 计算的 OAEP digest，确保客户端验证时不会误判为损坏。

**错误**:
- `404` — Unknown Session

#### Route 12: `GET /v1/sessions/{session_id}/oaep-events`

**用途**: Feature 3.1（重连路径）。在独占游标 `after_sequence` 之后重放持久事件。

**查询参数**:

| 参数 | 类型 | 默认 | 约束 | 说明 |
|------|------|------|------|------|
| `after_sequence` | int | `0` | `≥0` | 独占游标（返回此序列号之后的事件） |
| `limit` | int | `500` | `1-2000` | 最大返回事件数 |

**响应**:
```json
{
  "version": "1.0",
  "object": "list",
  "data": [
    { /* _oaep.migrate_event() 投影后的事件 */ }
  ],
  "next_sequence": 42,
  "has_more": false
}
```

**错误**:
- `404` — Unknown Session
- `409` — `SessionCursorExpired`（客户端游标超出保留窗口，必须重新 snapshot 而非 replay）

> **409 而非空列表**: 客户端无法区分"无新事件"和"错过的事件已丢失"，静默返回空列表会在会话中渲染出一个空洞。

#### Route 13: `GET /v1/sessions/{session_id}/oaep-events/stream`

**用途**: Feature 3.1。实时 SSE token 流。

**查询参数**:

| 参数 | 类型 | 默认 | 约束 | 说明 |
|------|------|------|------|------|
| `after_sequence` | int | `0` | `≥0` | 独占游标 |

**响应**: `text/event-stream`

```
id: 42
event: oaep.event
data: {"session_id":"...","sequence":42,"type":"agent.message.delta","data":{...}}

: heartbeat

id: 43
event: oaep.event
data: {...}
```

**响应头**:
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no
```

**机制**:
1. 响应开始前先用 1 条事件的读取验证游标——错误的 session_id 或过期游标返回真正的 HTTP 错误，而非一个立即关闭的 200
2. 循环调用 `engine.wait_oaep_events(timeout=15, limit=500)`，通过 `asyncio.to_thread` 卸载到线程池
3. 无事件时发送 `: heartbeat` 保持连接活跃
4. 每个事件经 `_oaep.migrate_event()` 投影后以 SSE 格式 yield
5. `SessionCursorExpired` 时静默结束流

**错误**:
- `404` — Unknown Session（在流开始前验证）
- `409` — 游标过期（在流开始前验证）

---

### 4.4 runs — 创建/执行/取消

**文件**: `routes/runs.py` | **tags**: `["runs"]` | **Feature**: 3.1

| # | 方法 | 路径 | operation_id | 认证 | 状态码 | 说明 |
|---|------|------|-------------|------|--------|------|
| 14 | POST | `/v1/sessions/{session_id}/runs` | `createRun` | gateway token | 201/200 | 创建运行记录 |
| 15 | POST | `/v1/runs/{run_id}/execute` | `executeRun` | gateway token + OIDC | 202/200 | 绑定输入并启动 |
| 16 | POST | `/v1/runs/{run_id}/cancel` | `cancelRun` | gateway token | 200 | 取消运行 |

#### Route 14: `POST /v1/sessions/{session_id}/runs`

**用途**: 创建 Turn 记录。幂等——相同 `idempotency_key` 返回已创建的 Run。

**请求体** (`RunCreateRequest`):
```json
{
  "idempotency_key": "unique-key-123"
}
```

> **幂等键必填**: 重试提交必须落在第一次创建的 Run 上，否则用户会得到两个 Agent 回答同一条消息。

**响应**:
- `201` — 新建 Run
- `200` — 幂等键已存在，返回原 Run

**错误**:
- `404` — Unknown Session
- `422` — 验证失败

**内部流程**:
1. `agent_definition_store().load("opendrsai@1")` — 加载 Agent 定义
2. `runtime_engine().create_run(session_id, "opendrsai@1", idempotency_key, "opendrsai", manifest_evidence=...)` — 创建 Run 记录

#### Route 15: `POST /v1/runs/{run_id}/execute`

**用途**: 绑定 prompt 到 Run 并启动 Agent。

**请求体** (`RunExecuteRequest`):
```json
{
  "prompt": "用户输入文本",
  "model_alias": "gpt-4o",
  "user_id": "optional-user-id",
  "source_message_id": "optional-msg-id",
  "metadata": {
    "source_client": "windows"
  }
}
```

**查询参数**:

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `wait` | bool | `false` | `true` 同步等待完成；`false` 异步执行返回 202 |

**响应** (异步, `wait=false`):
```json
{
  "run": { /* Run 记录 */ },
  "accepted": true,
  "events": "/v1/sessions/{session_id}/oaep-events/stream"
}
```

**响应** (同步, `wait=true`): Agent 执行结果 `{"content": "..."}`

**错误**:
- `404` — Unknown Run
- `422` — 输入绑定失败
- `401` — model_unauthorized / credential_unavailable
- `403` — permission_denied
- `409` — session_busy / cursor_expired

**内部流程**:
1. **同步绑定输入**: `engine.get_run(run_id)` + `engine.set_run_input(run_id, prompt, correlation_id, source_client, source_message_id, model)`
2. **异步执行**: `asyncio.create_task(execute())` → `agent_service().execute(run_id, prompt, correlation_id, model_override=alias)`
3. 后台任务存入 `_EXECUTIONS: dict[str, asyncio.Task]`，完成后自动清理
4. `?wait=true` 时同步执行并等待完成

**执行链** (`DesktopAgentBackend.execute()`):
1. `services.emit(context, "agent.started", {...})` — 发出开始事件
2. `_artifacts.artifact_snapshot(workspace_path)` — 记录 artifacts/ 基线
3. `_input_task(context, prompt)` — 编码 prompt + 附加资源
4. `_stream(task, ...)` → `agent_manager().run_stream(task, ...)` — 驱动 Agent
5. `translate_conversation_event(event, translation)` — autogen 事件翻译
6. `_normalize_event(context, event_type, payload)` — 事件标准化:
   - `message.delta` → `agent.message.delta`
   - `tool.start` → `tool.started`
   - `tool.complete` → `tool.completed`
7. `services.emit(context, kind, data)` — 写入 journal
8. `_artifacts.register_new_artifacts(context, baseline, started_at, emit)` — 注册新 Artifact
9. `services.emit(context, "agent.completed", {...})` — 发出完成事件

> **202 而非同步长轮询**: 同步会将 Run 生命周期绑定到一个 HTTP 连接——刷新页面、打开第二个窗口、或 Wi-Fi 断开都会放弃仍在执行的 Run。输出从不在此响应上；它通过 `services.emit` 进入 journal，到达客户端已在读取的事件流。

#### Route 16: `POST /v1/runs/{run_id}/cancel`

**用途**: 停止按钮（Feature 3.3）。

**响应**: `agent_service().cancel(run_id)` 的返回值

**错误**:
- `404` — Unknown Run
- `409` — 无法取消（如已完成）

**内部流程**: `DesktopAgentBackend.cancel(run_id)` → `CancellationToken.cancel()`

---

### 4.5 models — 模型选择

**文件**: `routes/models.py` | **tags**: `["models"]` | **Feature**: 3.2 + bootstrap

| # | 方法 | 路径 | operation_id | 认证 | 状态码 | 说明 |
|---|------|------|-------------|------|--------|------|
| 17 | GET | `/v1/config/model-catalog` | `getModelCatalog` | gateway token | 200 | 模型选择列表 |
| 17b | GET | `/v1/models` | `listModels` | gateway token | 200 | OpenAI兼容模型列表 |

#### Route 17: `GET /v1/config/model-catalog`

**用途**: Feature 3.2。返回模型选择器所需的所有模型配置。只读，无 CRUD。

**响应**:
```json
{
  "default_alias": "gpt-4o",
  "models": [
    {
      "alias": "gpt-4o",
      "display_name": "GPT-4o",
      "client_type": "openai",
      "model": "gpt-4o",
      "token_limit": 128000,
      "max_tokens": 16384,
      "vision": true
    }
  ]
}
```

**内部流程**: 通过 `asyncio.to_thread` 卸载到线程池（避免慢磁盘阻塞事件循环）:
1. `load_llm_mode_config(get_llm_config_file_path())` — 读取 LLM 配置文件
2. `build_model_catalog(config)` — 构建模型目录

> 选择的 `alias` 通过 execute 请求的 `model_alias` 字段传入 `create_agent(defult_config_name=alias)`。这是 Feature 3.2 的全部——选择从不会离开请求，不需要 provider CRUD 面板。

#### Route 17b: `GET /v1/models`

**用途**: **Bootstrap 关键路由**。Electron 主进程的 `discoverGatewayModels()` (gateway.ts L906) 在 `bootstrapDesktop()` Step 5 调用此路由，确认 gateway 能返回可用模型。404 → state="unavailable" → 4次重试失败 → `bootstrapDesktop()` 返回 `service_unavailable` blocker → 前端显示"运行时需要修复"。

**认证**: gateway token（必须）+ OIDC bearer（可选）

**行为**:
- **OIDC 模式** (有 `Authorization: Bearer <token>` + `X-OpenDrSai-Auth-Mode: oidc`): 通过 `get_platform_auth()` 获取已验证的 HepAI 凭证，代理请求到 `{auth.model_base_url}/models`，返回 OpenAI 兼容格式
- **Offline 模式** (仅 gateway token): 回退到本地配置的模型目录，将 `alias` 映射为 `id`/`name`

**响应** (OpenAI 兼容):
```json
{
  "object": "list",
  "data": [
    {"id": "claude-haiku-4-5", "name": "Claude Haiku 4.5"},
    {"id": "deepseek-v4-flash", "name": "DeepSeek V4 Flash"}
  ]
}
```

**错误** (OIDC 模式代理失败时):
- `504` — model_catalog_timeout (HepAI 4s 超时)
- `502` — model_catalog_unreachable / model_catalog_invalid_response
- `401` — model_unauthorized
- `403` — model_forbidden
- `429` — quota_exceeded

> **V1 参考实现**: `gateway_legacy.py` L8464。V2 从 V1 移植，逻辑一致。

---

### 4.6 audio — 语音转文字

**文件**: `routes/audio.py` | **tags**: `["audio"]` | **Feature**: 3.4

| # | 方法 | 路径 | operation_id | 认证 | 状态码 | 说明 |
|---|------|------|-------------|------|--------|------|
| 18 | POST | `/v1/audio/transcriptions` | `transcribeAudio` | gateway token | 200 | 语音转文字 |

#### Route 18: `POST /v1/audio/transcriptions`

**用途**: Feature 3.4。语音转文字（STT）。无 TTS，无实时双工。

**Content-Type**: `multipart/form-data`

**表单参数**:

| 参数 | 类型 | 默认 | 约束 | 说明 |
|------|------|------|------|------|
| `file` | UploadFile | (必填) | ≤ 10MB | 音频文件 |
| `model` | str | `whisper-1` | — | STT 模型（`DRSAI_STT_MODEL`） |
| `language` | str\|null | `null` | — | 语言提示 |

**响应**:
```json
{
  "text": "转录后的文本",
  "language": "zh",
  "confidence": 0.95,
  "model_ref": {
    "provider_id": "hepai",
    "model_id": "whisper-1"
  },
  "protocol": "openai_audio_transcriptions"
}
```

**错误**:
- `400` — 上传文件为空
- `413` — 超过 10MB 限制
- `401` — credential_unavailable（未登录且无 API key）
- `403` — permission_denied
- `429` — quota_exceeded
- `502` — provider_unreachable / invalid_provider_response / endpoint_not_found
- `504` — provider_timeout

**能力位门控** (Feature 3.4 能力位门控):
- `GET /v1/runtime` 的 `capabilities` 包含 `speech_to_text` → 此 surface 有此路由
- `stt_available()` → 当前是否能解析到一个 STT provider（需要登录的 HepAI 会话或配置的 API key）
- 渲染器在两者都满足时才显示麦克风按钮

**内部流程**:
1. `resolve_stt_operation(model)` — 从与 chat Agent 相同的配置构建 STT 绑定:
   - `load_config()` 读取 CLI 配置
   - `_resolve(cli_cfg, "openai_base_url", ...)` → base_url
   - `_resolve(cli_cfg, "openai_api_key", ...)` → api_key
   - `get_platform_auth()` 检查 OIDC 会话
   - 构建 `ProviderConfig(name="hepai", ...)` + `ResolvedAgentOperation(...)`
2. `OpenAIAudioOperationAdapter().transcribe(resolved, audio, filename, media_type, language)` — 执行转录

---

### 4.7 config — V1兼容配置路由

**文件**: `routes/config.py` | **tags**: `["config"]` | **迁移补全**

| # | 方法 | 路径 | operation_id | 认证 | 说明 |
|---|------|------|-------------|------|------|
| 18b | GET | `/v1/config/cli` | `getCliConfig` | gateway token | CLI配置 |
| 18c | PUT | `/v1/config/cli/{key}` | `setCliConfigKey` | gateway token | 设置CLI配置项 |
| 18d | GET | `/v1/config/agents` | `listConfiguredAgents` | gateway token | 已配置Agent列表 |
| 18e | GET | `/v1/config/agents/current` | `getCurrentAgent` | gateway token | 当前Agent |
| 18f | GET | `/v1/config/agents/{agent_id}/models` | `getAgentModels` | gateway token | Agent模型列表 |
| 18g | PUT | `/v1/config/agents/{agent_id}/models` | `setAgentModels` | gateway token | 设置Agent模型 |
| 18h | GET | `/v1/config/model-state` | `getModelState` | gateway token | 模型状态 |
| 18i | GET | `/v1/config/model-providers` | `getModelProviders` | gateway token | 模型provider列表 |
| 18j | GET | `/v1/config/model-providers/presets` | `getModelProviderPresets` | gateway token | 预设provider |
| 18k | GET | `/v1/config/runtime-models` | `getRuntimeModels` | gateway token | 运行时模型 |
| 18l | GET | `/v1/config/model` | `getModel` | gateway token | 当前模型 |
| 18m | PUT | `/v1/config/model` | `setModel` | gateway token | 设置模型(410) |
| 18n | POST | `/v1/config/model/preview` | `previewModel` | gateway token | 预览模型(410) |
| 18o | GET | `/v1/config/agents/{agent_id}/model-capability-status` | `getAgentModelCapabilityStatus` | gateway token | 模型能力状态 |

> **迁移补全**（2026-08-27）。V1 `gateway_legacy.py` 的配置路由在 V2 desktop_gateway 中缺失，导致前端 404 "Not Found" 错误（`getMyDrSaiAgentModelPolicy`, `listConfiguredAgents` 等）。

### 4.8 capabilities — 能力发现

**文件**: `routes/capabilities.py` | **tags**: `["capabilities"]`

| # | 方法 | 路径 | operation_id | 认证 | 说明 |
|---|------|------|-------------|------|------|
| 18p | GET | `/v1/capabilities` | `getCapabilities` | PUBLIC | 网关能力发现 |

> **迁移补全**（2026-08-27）。`LocalRuntimeClient.connect()` 调用此路由发现协议版本和功能标志。

### 4.9 agent_backends — Agent后端管理

**文件**: `routes/agent_backends.py` | **tags**: `["agent_backends"]`

| # | 方法 | 路径 | operation_id | 认证 | 说明 |
|---|------|------|-------------|------|------|
| 18q | GET | `/v1/agent-backends/{backend_id}/account` | `getBackendAccount` | gateway token | 后端账户状态 |
| 18r | POST | `/v1/agent-backends/{backend_id}/account/login` | `loginBackend` | gateway token | 后端登录 |
| 18s | POST | `/v1/agent-backends/{backend_id}/account/login/cancel` | `cancelBackendLogin` | gateway token | 取消登录 |
| 18t | POST | `/v1/agent-backends/{backend_id}/account/logout` | `logoutBackend` | gateway token | 后端登出 |
| 18u | GET | `/v1/agent-backends/{backend_id}/models` | `getBackendModels` | gateway token | 后端模型列表 |
| 18v | POST | `/v1/agent-backends/{backend_id}/restart` | `restartBackend` | gateway token | 重启后端 |

### 4.10 identity — 身份同步

**文件**: `routes/identity.py` | **tags**: `["identity"]` | **迁移补全**

| # | 方法 | 路径 | operation_id | 认证 | 说明 |
|---|------|------|-------------|------|------|
| 18w | PUT | `/v1/config/user-name` | `setUserName` | gateway token | 设置桌面用户名 |
| 18x | POST | `/v1/identity/canonicalize` | `canonicalizeIdentity` | gateway token | user_id迁移 |

#### Route 18w: `PUT /v1/config/user-name`

**用途**: `syncAuthIdentityToGateway()` (gateway.ts L198) 在 OIDC 登录后调用，设置桌面会话的用户名。best-effort — 调用方捕获所有错误。

**请求体** (`UserNameRequest`):
```json
{"user_name": "张三"}
```

**响应**: `{"user_name": "张三"}`

#### Route 18x: `POST /v1/identity/canonicalize`

**用途**: `syncAuthIdentityToGateway()` 调用，将历史/不稳定 user_id 行迁移到 Desktop 规范身份（BUG-5）。

**请求体** (`CanonicalizeIdentityRequest`):
```json
{
  "canonical_user_id": "oidc-sub-xxx",
  "aliases": ["anonymous", "desktop"]
}
```

**行为**: 扫描 `thread`、`sessionmessage`、`sessionsummary` 表的 `user_id` 列，将已知不稳定值（`anonymous`、`desktop`、`local-api-*` 等）和显式别名重写为 canonical_user_id。迁移时临时禁用 FTS 触发器以避免索引损坏。

**响应**:
```json
{
  "ok": true,
  "canonical_user_id": "oidc-sub-xxx",
  "aliases": ["anonymous", "desktop"],
  "migrated": {"thread": 3, "sessionmessage": 15},
  "total_migrated": 18
}
```

> **迁移补全**（2026-08-27）。V1 `gateway_legacy.py` L10908（user-name）和 L10961（canonicalize）。

---

## 5. 支撑模块

### 5.1 `_state.py` — 懒加载单例

所有 Runtime 组件通过模块级变量懒加载，`reset_state()` 为测试提供干净状态。

| 访问器 | 类型 | 持久化文件 | 用途 |
|--------|------|-----------|------|
| `runtime_registry()` | RuntimeRegistry | `runtime/runtime.sqlite3` | Workspace 目录 + Runtime 身份 |
| `runtime_engine()` | RuntimeEngine | `runtime/engine.sqlite3` | Sessions, Runs, 对话 journal, OAEP 投影 |
| `artifact_store()` | RuntimeArtifactStore | `runtime/artifacts.sqlite3` | Artifact 记录 |
| `tool_dispatcher()` | RuntimeToolDispatcher | (内存) | Runtime 宿主工具（artifact.publish, artifact.deliver） |
| `agent_manager()` | DesktopAgentManager | (内存) | 每 (user, session) Agent 缓存 |
| `agent_service()` | RuntimeAgentService | (内存) | Run 生命周期 + 后端调度 |

**状态根解析**: `DRSAI_DESKTOP_GATEWAY_HOME` → `DRSAI_HOME` → `~/.drsai`

**Agent 定义种子**: `_ensure_agent_definition(root)` 在首次启动时写入 `assets/agents/opendrsai/1.json`:
```json
{
  "id": "opendrsai",
  "version": "1",
  "backend": "opendrsai",
  "instructions": "Use the production OpenDrSai Agent in this Runtime Workspace.",
  "permissions": []
}
```

### 5.2 `_models.py` — 请求体

| 模型 | 字段 | 约束 |
|------|------|------|
| `WorkspaceOpenRequest` | `path: str`, `display_name: str\|None` | — |
| `SessionCreateRequest` | `workspace_id: str`, `title: str = "New session"` | — |
| `SessionUpdateRequest` | `title: str\|None`, `archived: bool\|None`, `lifecycle: Literal[...]\|None` | `lifecycle` 胜于 `archived` |
| `RunCreateRequest` | `idempotency_key: str` | `min_length=1, max_length=200` |
| `RunExecuteRequest` | `prompt: str`, `model_alias: str\|None`, `user_id: str\|None`, `source_message_id: str\|None`, `metadata: dict\|None` | — |

### 5.3 `_errors.py` — 异常映射

```python
@contextmanager
def http_errors(*, not_found: str = "", invalid: int = 400):
    ...
```

| 异常 | HTTP 状态码 | 说明 |
|------|------------|------|
| `KeyError` | 404 | Session/Run/Workspace 不存在 |
| `ValueError` | 400 (或 `invalid` 参数) | 请求格式错误或顺序不对 |
| `SessionCursorExpired` | 409 | 客户端恢复游标超出保留窗口 |
| `RuntimeExecutionError` | 401/403/409 | 携带自身 code 和 `retryable` 标志 |

**RuntimeExecutionError code → 状态码**:
- `401`: `token_expired`, `model_unauthorized`, `credential_unavailable`
- `403`: `permission_denied`
- `409`: 其他所有（如 `session_busy`, `cursor_expired` 等）

### 5.4 `_oaep.py` — P1→P2 投影

将 journal 中存储的 P1 Items 投影为 OAEP P2 形状。

- `migrate_event(event)`: 投影单个事件中的 Item
- `migrate_snapshot(snapshot, checkpoint_items=...)`: 投影完整快照 + **重算 checkpoint**
  - checkpoint 的 `snapshot_hash` 基于投影后的完整 Item 集合计算（非仅当前页）
  - 防止客户端验证时误判投影前后的 digest 不匹配为损坏

### 5.5 `_agent_backend.py` — DesktopAgentBackend

实现 `AgentBackend` 协议，`backend_id = "opendrsai"`。

**核心方法**:
- `execute(context, definition, prompt, services)`: 驱动一个完整 Run
- `cancel(run_id)`: 通过 CancellationToken 取消
- `respond_approval(...)`: **raise unsupported**（此 surface 无审批 UI）
- `health()`: 返回 `{backend, closed, active_runs}`
- `account_status(refresh=...)`: 返回 `{backend, signed_in, subject}`

**事件标准化** (`_normalize_event`):
- `message.delta` → `agent.message.delta`
- `tool.start` → `tool.started`
- `tool.complete` → `tool.completed`
- Tool 事件无 call_id → **raise** `tool_identity_missing`

### 5.6 `_agent_manager.py` — DesktopAgentManager

每 `(user_id, session_id)` 缓存一个 Agent 实例。

**关键行为**:
- 每 key 一把锁：同一 session 不允许并发执行（raise `session_busy`，retryable）
- `load_state` / `save_state`：每个 turn 前后持久化 Agent 压缩状态
- 模型 alias 变化时重建 Agent（Feature 3.2）
- Workspace 路径为 turn 作用域：一个长寿命 Agent 服务多个 Run
- 共享 `drsai.db` 数据库（与 CLI 和 TUI 相同）

### 5.7 `_artifacts.py` — Artifact 交付

两种路径产生 Artifact 知识：
1. Agent 显式调用 `deliver_artifact(...)` 工具
2. Agent 在 `<workspace>/artifacts/` 下写文件，backend 自动注册

**关键函数**:
- `artifact_snapshot(workspace_path)`: Run 开始前记录 artifacts/ 下所有文件签名
- `register_new_artifacts(context, baseline, started_at, emit)`: Run 结束后扫描新增文件，最多 32 个
- `deliver_artifact(source_path, ...)`: Agent 可调用的异步工具
- `publish_runtime_artifact` / `deliver_runtime_artifact`: Runtime 工具分发器注册的工具

### 5.8 `_workspace_files.py` — 文件树和文件读取

- `list_files(workspace_id, ...)`: 有界文件树 + git 状态 + .gitignore
- `read_file(workspace_id, path, ...)`: 单文件读取（文本/二进制自适应）
- `workspace_path(workspace_id, path)`: 路径解析 + 越界防护

---

## 6. Feature 映射表

| Feature | 描述 | 路由 | 备注 |
|---------|------|------|------|
| 1 | OIDC登录身份 | `GET /v1/runtime`, `GET /health` + `_auth.py` 中间件 | 登录流程在 Electron 主进程，无独立路由 |
| 2.1 | 新建会话 | `POST /v1/sessions` | — |
| 2.2 | 会话历史列表 | `GET /v1/sessions`, `GET /v1/sessions/{id}`, `PATCH /v1/sessions/{id}`, `GET /v1/sessions/{id}/oaep-snapshot` | — |
| 2.3 | 工作区文件树 | `GET /v1/workspaces/{id}/files` | — |
| 2.4 | 个人信息 | (无路由) | 读取 OIDC claims，主进程已持有 |
| 2.5 | 工作区列表 | `GET /v1/workspaces`, `POST /v1/workspaces` | POST 路径幂等 |
| 3.1 | 对话写入路径 | `POST /v1/sessions/{id}/runs`, `POST /v1/runs/{id}/execute`, `GET /v1/sessions/{id}/oaep-events`, `GET /v1/sessions/{id}/oaep-events/stream` | execute 返回 202，输出在事件流 |
| 3.2 | 模型选择 | `GET /v1/config/model-catalog` | 只读，无 CRUD |
| 3.3 | 会话运行状态 | (无独立路由) | `run.status` 随事件流 |
| 3.4 | 语音转文字 | `POST /v1/audio/transcriptions` | STT only |
| 4.1 | 文件预览 | `GET /v1/workspaces/{id}/file` | — |

---

## 7. 错误响应格式

### 统一错误形状（来自 `_auth.py`）

```json
{
  "error": {
    "code": "gateway_unauthorized",
    "message": "Gateway caller is not authorized.",
    "retryable": false,
    "correlation_id": "abc123"
  }
}
```

### 认证错误

| 状态码 | code | 说明 |
|--------|------|------|
| 401 | `gateway_unauthorized` | 缺少或无效的 gateway token |
| 401 | `token_expired` | OIDC token 过期（retryable） |
| 401 | (其他 401) | Bearer token 无效 |
| 403 | `subject_mismatch` | `x-opendrsai-principal` 与 token sub 不匹配 |

### Runtime 错误（来自 `_errors.py`）

| 状态码 | 来源异常 | 示例 code |
|--------|---------|-----------|
| 404 | `KeyError` | "Unknown Session" / "Unknown Run" / "Unknown Workspace" |
| 400/422 | `ValueError` | 请求格式错误 |
| 409 | `SessionCursorExpired` | `cursor_expired` (retryable: false) |
| 401 | `RuntimeExecutionError` | `token_expired`, `model_unauthorized`, `credential_unavailable` |
| 403 | `RuntimeExecutionError` | `permission_denied` |
| 409 | `RuntimeExecutionError` | `session_busy` (retryable: true), `run_cancelled` 等 |

### STT 错误（来自 `audio.py`）

| 状态码 | code | 说明 |
|--------|------|------|
| 401 | `credential_unavailable` | 未登录且无 API key |
| 403 | `permission_denied` | 权限不足 |
| 429 | `quota_exceeded` | 配额用尽 |
| 502 | `provider_unreachable` | 供应商不可达 |
| 504 | `provider_timeout` | 供应商超时 |

---

## 8. V1 兼容性差距

以下路由在 V1 (`gateway.ts` / `runtimeClient.ts`) 中被调用，但在当前 desktop_gateway 中**不存在**：

| V1 路由 | V1 调用方 | 用途 | 状态 |
|---------|----------|------|------|
| `POST /v1/chat/completions` | `runtimeClient.ts` | OpenAI SSE 格式聊天，body={model, messages, stream, workspace_id, thread_id} | **缺失**。需方案 A-3 补全（内部转 V2 三步流程） |
| `PUT /v1/config/user-name` | `gateway.ts` | body={user_name: userId}，5s 超时 | **缺失**。需方案 A-4 补全 |
| `PUT /v1/config/cli/user_id` | `gateway.ts` | body={value: userId}，evict agent pool | **缺失**。需方案 A-4 补全 |
| `GET /v1/capabilities` | V1 接口 | 声明能力（legacy gateway 有） | **缺失**。V2 用 `GET /v1/runtime` 的 `capabilities` 字段替代 |

### 已完成的最小修复

| 修复 | 日期 | 文件 | 内容 |
|------|------|------|------|
| `/health` 路由 | 2026-08-27 | `routes/runtime.py` | 新增 `GET /health` → `{"status": "ok"}` |
| PUBLIC_PATHS | 2026-08-27 | `_auth.py` | 添加 `/health` 到 `PUBLIC_PATHS` |
