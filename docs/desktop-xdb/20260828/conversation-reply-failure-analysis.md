# 会话回复失败分析报告：V2 Desktop Gateway 缺失 OAEP 协议声明

> **日期**: 2026-08-28
> **现象**: 发起会话时直接显示"回复失败。请查看调试信息"，后台无任何报错
> **根因**: V2 desktop_gateway 的 `/v1/capabilities` 端点未声明 OAEP 协议支持

---

## 1. 问题现象

用户在桌面端发起会话（发送第一条消息）时，前端立即显示：

> 回复失败。请查看调试信息。

后台 gateway 日志中无任何错误输出，无 4xx/5xx HTTP 错误，无 Python 异常堆栈。

---

## 2. 前后端整体数据流分析

### 2.1 桌面启动架构（参考 desktop-startup-sequence.md L22-89）

```
Electron Desktop App (apps/desktop)
    │
    ├── Main Process (Node.js)
    │   ├── bootstrap.ts      → 启动 Python gateway 进程
    │   ├── gateway.ts        → 健康检查 + 端口探测 (127.0.0.1:28643)
    │   ├── IPC handlers      → drsai:bridge:* 事件
    │   └── chat.ts           → startChat() / runChat() / runRuntimeBackendChat()
    │
    ├── Renderer Process (React)
    │   ├── ChatWorkspace.tsx  → 消息展示 + 错误渲染
    │   ├── Composer.tsx       → 消息输入
    │   └── useSessionStream   → SSE 订阅
    │
    ▼  HTTP (127.0.0.1:28643)
    │
┌─────────────────────────────────────────────────┐
│  V2 desktop_gateway (FastAPI, port 28643)        │
│  cores/python/.../desktop_gateway/                │
│  ├── app.py           → 10个路由模块              │
│  ├── _state.py        → RuntimeRegistry/Engine    │
│  ├── _agent_backend.py → DesktopAgentBackend      │
│  ├── _agent_manager.py → DesktopAgentManager      │
│  └── routes/                                     │
│      ├── runtime.py     → /health, /v1/runtime    │
│      ├── capabilities.py → /v1/capabilities      │
│      ├── sessions.py    → /v1/sessions/*          │
│      ├── runs.py        → /v1/runs/*              │
│      ├── workspaces.py  → /v1/workspaces/*        │
│      ├── models.py      → /v1/models              │
│      ├── config.py      → /v1/config/*            │
│      ├── audio.py       → /v1/audio/*             │
│      ├── agent_backends.py → /v1/agent-backends/* │
│      └── identity.py    → /v1/identity/*          │
└─────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────┐
│  runtime/ (SQLite + Event Journal)                │
│  ├── registry.py  → RuntimeRegistry (workspaces)  │
│  ├── engine.py     → RuntimeEngine (sessions,runs) │
│  ├── agent.py      → RuntimeAgentService          │
│  └── journal.py    → ConvJournal (OAEP events)    │
└─────────────────────────────────────────────────┘
    │
    ▼
  run_drsai_agent_factory.py → create_agent() → HepAI LLM API
```

### 2.2 会话发起的完整调用链

当用户在 Composer 中输入消息并点击发送时：

```
Renderer (React)
  │
  ├── 1. IPC: desktop:chat:start → Main Process
  │
  ▼
Main Process: chat.ts
  │
  ├── 2. startChat(webContents, request)
  │      ├── validateChatRequest()
  │      ├── 创建 ChatTurnRecord (phase: "pending")
  │      └── runChat(webContents, requestId, request, controller)
  │
  ├── 3. runChat()
  │      ├── requireAuthContext() → OIDC 鉴权
  │      ├── startGateway() → 确保 gateway 进程运行
  │      ├── listConfiguredAgents() → GET /v1/config/agents
  │      └── runRuntimeBackendChat(...) ← 本地 Agent 走此分支
  │
  ├── 4. runRuntimeBackendChat()  [chat.ts:1825]
  │      │
  │      ├── 4a. connectRuntimeClientForWorkspace()
  │      │       └── LocalRuntimeClient.connect()
  │      │            ├── startGateway()  → 确认端口 28643
  │      │            ├── getGatewayStatus() → GET /health
  │      │            └── 返回 baseUrl = http://127.0.0.1:28643
  │      │
  │      ├── 4b. client.getCapabilities()  → GET /v1/capabilities  ★关键★
  │      │
  │      ├── 4c. selectRuntimeConversationProtocolResult(capabilities)
  │      │       ├── 检查 capabilities.protocols.oaep
  │      │       ├── 检查 OAEP_REQUIRED: ["oaep.v1", "oaep.session.snapshot",
  │      │       │                           "oaep.session.events", "oaep.session.events.stream"]
  │      │       ├── 检查 OAEP_VERSION, OAEP_PROFILE, OAEP_SCHEMA_SHA256
  │      │       └── 如果不完整 → 返回 { selected: "unavailable" }
  │      │
  │      ├── 4d. ❌ if (runtimeProtocol.selected !== "oaep")
  │      │         throw Error("This Runtime does not provide the
  │      │                       required OAEP conversation protocol...")
  │      │         (code: "oaep_runtime_required")
  │      │
  │      └── (以下代码因 4d 抛出异常而永远不执行)
  │           ├── 4e. client.createSession() → POST /v1/sessions
  │           ├── 4f. client.createAgentRun() → POST /v1/sessions/{id}/runs
  │           ├── 4g. client.executeAgentRun() → POST /v1/runs/{id}/execute
  │           └── 4h. subscribeOaepSession() → GET /v1/sessions/{id}/oaep-events/stream
  │
  ├── 5. runChat() 的 .catch() 捕获异常
  │      └── emit(webContents, { type: "error", error: errorMessage })
  │
  ▼
Renderer: ChatWorkspace.tsx [L4675]
  │
  └── StreamingStatus({ message })
       └── if (message.error) {
             return <p>"回复失败。请查看调试信息。"</p>;
           }
```

### 2.3 关键发现：异常在前端被"吞掉"

`runChat()` 的 `.catch()` 处理器 (chat.ts ~L142) 会发出一个 `type: "error"` 的 ChatEvent。
渲染器 `ChatWorkspace.tsx` 在 `StreamingStatus` 组件中检查 `message.error`，
如果为 true，直接显示"回复失败。请查看调试信息。"

**这就是为什么后台没有报错**：异常发生在前端 (Node.js Main Process) 的
JavaScript 层面，是在 `GET /v1/capabilities` 返回数据后、发起任何写请求之前
就抛出了。gateway 进程本身运行完全正常，只是返回的 capabilities 数据不完整。

---

## 3. 根因分析：V2 Gateway 缺失 OAEP 协议声明

### 3.1 V2 capabilities.py 的问题

**文件**: `cores/python/.../desktop_gateway/routes/capabilities.py`

V2 gateway 的 `_RUNTIME_PROTOCOLS` 只声明了 `control`：

```python
# V2 (当前) — capabilities.py
_RUNTIME_PROTOCOLS: dict[str, dict] = {
    "control": {"version": "1"},
}
```

V2 的 `_CAPABILITY_VERSIONS` 也不包含任何 `oaep.*` 条目：

```python
# V2 (当前) — capabilities.py
_CAPABILITY_VERSIONS: dict[str, int] = {
    "workspaces": 1,
    "sessions": 1,
    "session_events": 1,
    "runs": 1,
    "model_catalog": 1,
    "speech_to_text": 1,
    "workspace_files": 1,
    "agent-backend": 1,
    "agent-backend-account": 1,
}
```

### 3.2 Legacy gateway 的对照

**文件**: `cores/python/.../backend/gateway_legacy.py` (L2023-2065)

Legacy gateway 声明了完整的 OAEP 协议支持：

```python
# Legacy (原版) — gateway_legacy.py L2047-2058
_REMOTE_CAPABILITY_VERSIONS = {
    ...  # (30+ 条目)
    "oaep.v1": 1,                    # ← V2 缺失
    "oaep.session.snapshot": 1,      # ← V2 缺失
    "oaep.session.events": 1,        # ← V2 缺失
    "oaep.session.events.stream": 1, # ← V2 缺失
    ...
}

_RUNTIME_PROTOCOLS = {
    "oaep": {                         # ← V2 整个 key 缺失
        "version": OAEP_VERSION,      # "1.0"
        "profiles": [OAEP_PROFILE],    # "oaep.session-stream/1"
        "schema_sha256": OAEP_SCHEMA_SHA256,
    },
    "owop": { ... },
    "control": {"version": "1"},
    "relay": {"version": "2.0.0"},
}
```

### 3.3 前端协议选择的逻辑

**文件**: `apps/desktop/shared/main/runtimeProtocolSelection.ts`

```typescript
const OAEP_VERSION = "1.0";
const OAEP_PROFILE = "oaep.session-stream/1";
const OAEP_SCHEMA_SHA256 = "154cac089e8d0f243e3f42a56187061cd821b648416df2ccf4224cd47003e184";

const OAEP_REQUIRED = [
    "oaep.v1",
    "oaep.session.snapshot",
    "oaep.session.events",
    "oaep.session.events.stream",
];

export function selectRuntimeConversationProtocolResult(
  capabilities: RuntimeCapabilities,
  options: { forceLegacy?: boolean } = {},
): RuntimeConversationProtocolSelection {
    const oaepProtocol = capabilities.protocols?.oaep;  // V2 返回 undefined
    const oaepSignals = Boolean(oaepProtocol) ||
        [...advertised].some((name) => name.startsWith("oaep."));  // V2: false
    const oaepComplete = oaepProtocol?.version === OAEP_VERSION
        && oaepProtocol.profiles.includes(OAEP_PROFILE)
        && oaepProtocol.schema_sha256 === OAEP_SCHEMA_SHA256
        && OAEP_REQUIRED.every((name) => advertised.has(name));  // V2: false

    // oaepSignals=false → 跳过
    // oaepComplete=false → 跳过
    // legacy 也 false → 跳过

    // 最终返回:
    return {
        selected: "unavailable",  // ← 这就是触发问题的返回值
        version: null,
        schemaHash: null,
        fallbackReason: "oaep_unavailable",
    };
}
```

### 3.4 chat.ts 中的守卫检查

**文件**: `apps/desktop/shared/main/chat.ts` L1855-1866

```typescript
const runtimeProtocol = selectRuntimeConversationProtocolResult(
    await client.getCapabilities(),
    { forceLegacy: process.env.OPENDRSAI_DESKTOP_PROTOCOL_ROLLBACK === "conversation/1" },
);

if (runtimeProtocol.selected !== "oaep") {
    throw Object.assign(new Error(
        runtimeProtocol.fallbackReason === "operator_rollback"
            ? "OAEP Chat is disabled by the operator rollback setting..."
            : "This Runtime does not provide the required OAEP conversation protocol. Upgrade or repair the Runtime.",
    ), {
        code: "oaep_runtime_required",
        protocol: runtimeProtocol,
    });
}
```

**异常被 `runChat()` 的 `.catch()` 捕获** (chat.ts ~L142)，发出 `type: "error"` 事件，
渲染器显示"回复失败。请查看调试信息。"

---

## 4. V2 Gateway vs Legacy Gateway 路由对比

### 4.1 会话相关路由对比

| 路由 | Legacy gateway_legacy.py | V2 desktop_gateway | 状态 |
|------|--------------------------|---------------------|------|
| `GET /health` | L4540 | runtime.py | ✅ 有 |
| `GET /v1/runtime` | L4656 | runtime.py | ✅ 有 |
| `GET /v1/capabilities` | L4682 | capabilities.py | ⚠️ 有但**不完整** |
| `POST /v1/sessions` | L5234 | sessions.py | ✅ 有 |
| `GET /v1/sessions` | L5247 | sessions.py | ✅ 有 |
| `GET /v1/sessions/{id}` | L5297 | sessions.py | ✅ 有 |
| `PATCH /v1/sessions/{id}` | L5492 | sessions.py | ✅ 有 |
| `GET /v1/sessions/{id}/oaep-snapshot` | L5369 | sessions.py | ✅ 有 |
| `GET /v1/sessions/{id}/oaep-events` | L5414 | sessions.py | ✅ 有 |
| `GET /v1/sessions/{id}/oaep-events/stream` | L5440 | sessions.py | ✅ 有 |
| `POST /v1/sessions/{id}/runs` | L5530 | runs.py | ✅ 有 |
| `POST /v1/runs/{id}/execute` | L6583 | runs.py | ✅ 有 |
| `POST /v1/runs/{id}/cancel` | L7276 | runs.py | ✅ 有 |
| `POST /v1/chat/completions` | L9340 | **无** | ❌ 缺失 (注1) |
| `GET /v1/sessions/{id}/runs/by-idempotency/{key}` | L5555 | **无** | ❌ 缺失 (注2) |
| `GET /v1/sessions/{id}/runs` | L5572 | **无** | ❌ 缺失 (注2) |
| `GET /v1/runs/{id}` | L5603 | **无** | ❌ 缺失 (注2) |
| `GET /v1/sessions/{id}/conversation-snapshot` | (Legacy) | **无** | ❌ 缺失 (注3) |
| `GET /v1/sessions/{id}/events` | (Legacy) | **无** | ❌ 缺失 (注3) |
| `GET /v1/sessions/{id}/events/stream` | (Legacy) | **无** | ❌ 缺失 (注3) |
| `GET /v1/workspaces/{id}/session-catalog-events/stream` | L5257 | **无** | ❌ 缺失 (注4) |

**注1**: `POST /v1/chat/completions` 是 Legacy 的 OpenAI 兼容 SSE 端点。
V2 架构用 `POST /v1/runs/{id}/execute` + `GET /v1/sessions/{id}/oaep-events/stream`
替代了它，属于设计变更，不是缺失。但如果部分前端代码仍调用此端点，会 404。

**注2**: `getAgentRunByIdempotency()`、`listSessionRuns()`、`getAgentRun()`
等方法在 `runtimeClient.ts` 中被 `chat.ts` 的恢复/重试逻辑调用
(chat.ts L383, L408, L272)。V2 gateway 缺少这些路由会导致 404，
但它们在正常流程（首次发消息）中不被触发，只在异常恢复路径中使用。

**注3**: `conversation-snapshot`、`events`、`events/stream` 是 Legacy 协议路由。
`runtimeClient.ts` 中定义了这些方法 (L802, L810, L822)，
但 V2 gateway 只有 `oaep-snapshot`、`oaep-events`、`oaep-events/stream`。
chat.ts 中 `selectRuntimeConversationProtocolResult` 正确地要求 OAEP 协议，
所以这些 Legacy 路由在正常 OAEP 路径下不会被调用。但如果 OAEP 协议检查
失败，也没有 Legacy 回退路由可用。

**注4**: `session-catalog-events/stream` 用于侧边栏会话列表的实时更新。
V2 gateway 缺少此路由，可能导致会话侧边栏不实时更新。

### 4.2 capabilities 声明差异（核心问题）

| 声明项 | Legacy | V2 | 影响 |
|--------|--------|-----|------|
| `protocols.oaep` | ✅ 完整 (version/profiles/schema_sha256) | ❌ 缺失 | **导致 oaep_runtime_required 错误** |
| `protocols.owop` | ✅ | ❌ 缺失 | OWOP 操作不可用 |
| `protocols.relay` | ✅ | ❌ 缺失 | 中继不可用 |
| `protocols.control` | ✅ | ✅ | 正常 |
| `oaep.v1` (capability) | ✅ | ❌ 缺失 | **前端 OAEP 检查失败** |
| `oaep.session.snapshot` | ✅ | ❌ 缺失 | **前端 OAEP 检查失败** |
| `oaep.session.events` | ✅ | ❌ 缺失 | **前端 OAEP 检查失败** |
| `oaep.session.events.stream` | ✅ | ❌ 缺失 | **前端 OAEP 检查失败** |
| `conversation.snapshot` | ✅ | ❌ | Legacy 协议不可用 |
| `session.event.*` | ✅ | ❌ | Legacy 事件协议不可用 |
| `chat` | ✅ | ❌ | chat/completions 端点不存在 |

---

## 5. 修复方案

### 5.1 核心修复：在 capabilities.py 中声明 OAEP 协议

**文件**: `cores/python/.../desktop_gateway/routes/capabilities.py`

需要添加 OAEP 协议声明，与 Legacy gateway 保持一致：

```python
from drsai.oaep.generated import OAEP_PROFILE, OAEP_SCHEMA_SHA256, OAEP_VERSION

# 在 _CAPABILITY_VERSIONS 中添加 OAEP 条目
_CAPABILITY_VERSIONS: dict[str, int] = {
    "workspaces": 1,
    "sessions": 1,
    "session_events": 1,
    "runs": 1,
    "model_catalog": 1,
    "speech_to_text": 1,
    "workspace_files": 1,
    "agent-backend": 1,
    "agent-backend-account": 1,
    # ── OAEP 协议能力声明（修复核心问题）──
    "oaep.v1": 1,
    "oaep.session.snapshot": 1,
    "oaep.session.events": 1,
    "oaep.session.events.stream": 1,
}

# 在 _RUNTIME_PROTOCOLS 中添加 oaep 协议元数据
_RUNTIME_PROTOCOLS: dict[str, dict] = {
    "control": {"version": "1"},
    "oaep": {
        "version": OAEP_VERSION,       # "1.0"
        "profiles": [OAEP_PROFILE],    # "oaep.session-stream/1"
        "schema_sha256": OAEP_SCHEMA_SHA256,
    },
}
```

这样前端 `selectRuntimeConversationProtocolResult()` 就会返回
`{ selected: "oaep" }`，从而通过守卫检查，继续执行后续的
`createSession()` → `createAgentRun()` → `executeAgentRun()` 流程。

### 5.2 建议补充的路由（非阻塞但推荐）

以下路由虽然不影响首次发消息，但在异常恢复、会话列表等场景中被前端调用：

1. **`GET /v1/runs/{run_id}`** — 获取单个 Run 状态
   - 前端: `runtimeClient.ts` L921 `getAgentRun()`
   - 用途: chat.ts L272 的取消恢复路径

2. **`GET /v1/sessions/{session_id}/runs/by-idempotency/{key}`** — 幂等键查 Run
   - 前端: `runtimeClient.ts` L936 `getAgentRunByIdempotency()`
   - 用途: chat.ts L383 的网络重试恢复路径

3. **`GET /v1/sessions/{session_id}/runs`** — 列出会话的所有 Run
   - 前端: `runtimeClient.ts` L1031 `listSessionRuns()`
   - 用途: 会话历史详情

4. **`GET /v1/workspaces/{workspace_id}/session-catalog-events/stream`** — 会话目录 SSE
   - 前端: `runtimeClient.ts` `openWorkspaceSessionCatalogStream()`
   - 用途: 侧边栏会话列表实时更新

### 5.3 不需要补充的路由

1. **`POST /v1/chat/completions`** — V2 架构用 Session+Run+OAEP 替代，不是缺失
2. **Legacy `conversation-snapshot` / `events` / `events/stream`** — V2 用 OAEP 替代
3. **`owop` / `relay` 协议** — V2 暂不实现这些子系统

---

## 6. 验证方法

### 6.1 快速验证

修复后，直接 curl 测试 capabilities 端点：

```bash
curl -s http://127.0.0.1:28643/v1/capabilities | python -m json.tool
```

应看到 `protocols.oaep` 和 `oaep.*` 能力声明。

### 6.2 端到端验证

1. 启动桌面应用
2. 打开工作区
3. 新建会话
4. 发送消息
5. 应看到模型回复流式输出，而非"回复失败"

### 6.3 调试技巧

如果需要确认前端协议选择结果，在 chat.ts 的 `runRuntimeBackendChat()` 中
L1858 附近添加日志：

```typescript
console.log("[chat] capabilities:", JSON.stringify(await client.getCapabilities()));
console.log("[chat] protocol selection:", JSON.stringify(runtimeProtocol));
```

---

## 7. 附录：关键文件索引

| 文件 | 行号 | 说明 |
|------|------|------|
| `apps/desktop/shared/main/chat.ts` | 964 | `runChat()` 入口 |
| `apps/desktop/shared/main/chat.ts` | 1825 | `runRuntimeBackendChat()` — Runtime 会话路径 |
| `apps/desktop/shared/main/chat.ts` | 1858 | `selectRuntimeConversationProtocolResult()` 调用 |
| `apps/desktop/shared/main/chat.ts` | ~142 | `.catch()` 处理器 → 发出 error 事件 |
| `apps/desktop/shared/main/runtimeProtocolSelection.ts` | 33-52 | OAEP/Legacy 协议选择逻辑 |
| `apps/desktop/shared/main/runtimeClient.ts` | 1483 | `LocalRuntimeClient.connect()` |
| `apps/desktop/shared/main/runtimeClient.ts` | 792 | `createSession()` → POST /v1/sessions |
| `apps/desktop/shared/main/runtimeClient.ts` | 926 | `createAgentRun()` → POST /v1/sessions/{id}/runs |
| `apps/desktop/shared/main/runtimeClient.ts` | 979 | `executeAgentRun()` → POST /v1/runs/{id}/execute |
| `apps/desktop/shared/main/runtimeClient.ts` | 886 | `openOaepEventStream()` → GET .../oaep-events/stream |
| `apps/desktop/shared/main/gatewayEnvironment.ts` | 1-2 | 端口配置: 28643 |
| `apps/desktop/shared/main/gateway.ts` | 40-41 | `GATEWAY_PORT` / `GATEWAY_BASE_URL` |
| `apps/desktop/shared/renderer/src/components/ChatWorkspace.tsx` | 4675 | "回复失败。请查看调试信息。" |
| `cores/python/.../desktop_gateway/routes/capabilities.py` | 全文 | **根因文件** |
| `cores/python/.../desktop_gateway/routes/sessions.py` | 全文 | Session + OAEP 路由 (已实现) |
| `cores/python/.../desktop_gateway/routes/runs.py` | 全文 | Run 路由 (已实现) |
| `cores/python/.../desktop_gateway/_agent_backend.py` | 全文 | Agent 执行后端 |
| `cores/python/.../desktop_gateway/_agent_manager.py` | 全文 | Agent 实例管理 |
| `cores/python/.../backend/gateway_legacy.py` | 2023-2065 | Legacy capabilities (对照基准) |
| `cores/python/.../backend/gateway_legacy.py` | 9340 | Legacy chat/completions 端点 |
| `cores/python/.../backend/gateway_legacy.py` | 5234-5440 | Legacy session/run 路由 |
