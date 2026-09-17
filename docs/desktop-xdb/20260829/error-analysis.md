# 合并提交 f5e1f7ea 后桌面版运行时错误分析

> **日期**: 2026-08-29
> **合并提交**: `f5e1f7ead842953d02aa852f50866fdab76c3409`
> **范围**: `apps/desktop` 前端 → `desktop_gateway` V2 后端
> **目的**: 分析合并后桌面版出现的运行时错误，给出根因和修复方案

---

## 目录

1. [背景：历次启动失败回顾](#1-背景历次启动失败回顾)
2. [合并提交 f5e1f7ea 变更内容](#2-合并提交-f5e1f7ea-变更内容)
3. [当前错误清单](#3-当前错误清单)
4. [错误 1：GET /v1/models → 504 Gateway Timeout](#4-错误-1get-v1models--504-gateway-timeout)
5. [错误 2：GET /v1/workspaces/{id}/session-catalog-events/stream → 404](#5-错误-2get-v1workspacesidsession-catalog-eventsstream--404)
6. [错误 3：前端 V1 路径调用矩阵 vs V2 路由覆盖](#6-错误-3前端-v1-路径调用矩阵-vs-v2-路由覆盖)
7. [修复优先级](#7-修复优先级)

---

## 1. 背景：历次启动失败回顾

在合并 `f5e1f7ea` 之前，桌面版 V2 gateway 已经经历过三轮修复（2026-08-28）：

| 轮次 | 根因 | 修复 | 文件 |
|------|------|------|------|
| 第 1 轮 | `capabilities.py` 缺少 OAEP 协议声明（`oaep.v1` 等 5 个 capability 字符串） | 补全 `_CAPABILITY_VERSIONS` 和 `_RUNTIME_PROTOCOLS` | `routes/capabilities.py` |
| 第 2 轮 | `runs.py` 缺少前端期望的 6 个 GET 路由 | 添加 reproduction-manifest、inspection、diagnostics 等 | `routes/runs.py` |
| 第 3 轮 | `runs.py` 的 `source_message_id` 字段位置不匹配（前端发在 metadata 内，后端只读顶层） | 修改 `runs.py` L91 兼容 `metadata.get("source_message_id")` | `routes/runs.py` |

这三轮修复后，**核心聊天流程已经可用**（diag-trace.log 显示 8/28 OAEP 运行成功）。

但合并 `f5e1f7ea` 后，引入了新的问题。

---

## 2. 合并提交 f5e1f7ea 变更内容

合并提交 `f5e1f7ea` 的主要变更：

- **`chat.ts`**: `runChat()` 函数中，`authContext.accessToken` 改为 `resolvePlatformBearerToken(authContext)`，允许使用 HepAI API Key 作为 Bearer token（不再强制 OIDC accessToken）
- **依赖修复**: `jszip` 和 `docx-preview` 添加到 `shared/renderer/package.json` 和 `windows/package.json`
- **GFS/Skills 路由**: 确认 V2 通过 `register_gfs_routes(app)` 和 `register_skills_routes(app)` 注册

合并后，核心聊天链路（`chat.ts → client.ts → service.ts → V2 gateway OAEP`）仍然可用。

**但** bootstrap 阶段和 V1 legacy 调用链出现问题。

---

## 3. 当前错误清单

| # | 错误 | HTTP | 严重度 | 根因类别 |
|---|------|------|--------|----------|
| 1 | `GET /v1/models` 超时 | 504 | **P0（阻塞启动）** | V2 后端 timeout 过短 + 无降级 |
| 2 | `GET /v1/workspaces/{id}/session-catalog-events/stream` | 404 | P1（持续 404 刷屏） | V2 后端缺少 SSE 路由 |
| 3 | 前端 `runtimeClient.ts` 调用 V1-only 路径 | 404/不可用 | P2（功能性缺失） | V1→V2 未完成迁移 |

---

## 4. 错误 1：GET /v1/models → 504 Gateway Timeout

### 4.1 现象

桌面版启动时，`bootstrapDesktop()` 的第 5 步 `discoverModelsWithRecovery()` 调用 `GET /v1/models`，前端在重试 4 次（0/250/750/1500ms）后仍失败，最终返回 `blocker: "service_unavailable"`。

### 4.2 根因

**文件**: `cores/python/.../desktop_gateway/routes/models.py` L64

```python
async def _list_platform_models(auth) -> dict:
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:  # ← 4 秒超时
            response = await client.get(
                f"{auth.model_base_url.rstrip('/')}/models",
                headers={"Authorization": f"Bearer {auth.access_token}"},
            )
    except httpx.TimeoutException as exc:
        raise HTTPException(
            status_code=504,
            detail={
                "code": "model_catalog_timeout",
                "message": "The HepAI model catalog timed out.",
                "retryable": True,
            },
        ) from exc
```

**问题链**:

1. `timeout=4.0` 秒太短 — 外部 API `https://aiapi.ihep.ac.cn/apiv2/v1/models` 在网络波动时经常 >4s
2. 超时后直接 `raise HTTPException(504)` — **没有 fallback 到本地模型**
3. `_list_local_models()` 函数已存在（L107），但仅在没有 OIDC auth 时才调用（`list_models()` L56 的 if/else 分支），**超时时不会走到这里**
4. 前端 `discoverGatewayModels()` 重试 4 次都是同一个超时请求，不会改善

### 4.3 调用链

```
bootstrapDesktop() L801
  └── discoverModelsWithRecovery(auth.accessToken)
        └── discoverGatewayModels(accessToken)
              HTTP GET http://127.0.0.1:28643/v1/models
                Headers: X-OpenDrSai-Gateway-Token + Bearer <access_token>
              ↓
              models.py: list_models()
                ├── auth is not None → _list_platform_models(auth)
                │     └── httpx.AsyncClient(timeout=4.0)
                │           └── GET https://aiapi.ihep.ac.cn/apiv2/v1/models
                │                 └── 4s 超时 → HTTPException(504)
                └── [不会执行] _list_local_models()
              ↓
              前端重试 4 次（0/250/750/1500ms）→ 全部 504
              ↓
              blocker: "service_unavailable" → 启动失败
```

### 4.4 修复方案

**文件**: `routes/models.py`

1. `timeout` 从 `4.0` → `10.0` 秒
2. `_list_platform_models()` 超时时，**fallback** 到 `_list_local_models()` 而非直接报错
3. 可选：添加简单的内存缓存（TTL 60s），避免短时间内重复请求外部 API

```python
# 修改后的 _list_platform_models():
async def _list_platform_models(auth) -> dict:
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(...)
        # ... 正常处理 ...
    except (httpx.TimeoutException, httpx.HTTPError) as exc:
        logger.warning("Model catalog unreachable (%s); falling back to local catalog", exc)
        return await _list_local_models()  # ← 降级而非报错
```

---

## 5. 错误 2：GET /v1/workspaces/{id}/session-catalog-events/stream → 404

### 5.1 现象

桌面版启动后，前端持续向 V2 gateway 发送 `GET /v1/workspaces/{id}/session-catalog-events/stream` 请求，全部返回 404。这是 SSE 长轮询连接，连接断开后会自动重连，导致 **404 刷屏**。

### 5.2 根因

**前端调用方**: `apps/desktop/shared/main/runtimeClient.ts` L785

```typescript
async openWorkspaceSessionCatalogStream(
    workspaceId: string,
    signal: AbortSignal,
): Promise<RuntimeWorkspaceSessionCatalogStream> {
    this.assertResourceId("Workspace", workspaceId);
    const response = await this.request(
        `/v1/workspaces/${encodeURIComponent(workspaceId)}/session-catalog-events/stream`,
        { headers: { Accept: "text/event-stream" }, signal },
    );
    // ...
}
```

**V1 后端实现**: `gateway_legacy.py` L5257

```python
@app.get("/v1/workspaces/{workspace_id}/session-catalog-events/stream")
async def runtime_workspace_session_catalog_event_stream(workspace_id, raw_request):
    journal = _runtime_engine().conversation_journal
    cursor = journal.workspace_catalog_watermark(workspace_id)
    # SSE 流：每 15s 检查一次 session 变更事件
    async def stream():
        yield ": connected\n\n"
        while not await raw_request.is_disconnected():
            events = await asyncio.to_thread(
                journal.wait_for_workspace_catalog_events,
                workspace_id, after_cursor=cursor, timeout=15.0, limit=500,
            )
            if not events:
                yield ": heartbeat\n\n"
                continue
            for event in events:
                cursor = int(event["cursor"])
                public = {k: v for k, v in event.items() if k != "cursor"}
                yield f"id: {public['event_id']}\nevent: session.catalog.changed\ndata: {json.dumps(public)}\n\n"
    return StreamingResponse(stream(), media_type="text/event-stream")
```

**V2 后端**: `routes/workspaces.py` 只有 5 个路由，**没有** `session-catalog-events/stream`。

### 5.3 影响分析

- `runtimeClient.ts` 的 `openWorkspaceSessionCatalogStream()` 被 `remoteGatewayClient.generated.ts` L85 的路由映射引用
- SSE 连接断开后浏览器自动重连 → 404 刷屏
- 不影响核心聊天功能，但会在控制台持续报错，可能导致 session 列表不实时更新

### 5.4 修复方案（二选一）

**方案 A（推荐）：在 V2 后端添加 SSE 路由**

在 `routes/workspaces.py` 中添加 `session-catalog-events/stream` 路由，从 V1 `gateway_legacy.py` L5257 迁移实现逻辑：

```python
@api.get("/v1/workspaces/{workspace_id}/session-catalog-events/stream",
          operation_id="streamWorkspaceSessionCatalog")
async def stream_workspace_session_catalog(workspace_id: str, request: Request):
    engine = _state.runtime_engine()
    # ... 与 V1 相同的 SSE 逻辑 ...
```

**方案 B：前端改用 V2 轮询**

修改 `runtimeClient.ts` 的 `openWorkspaceSessionCatalogStream()`，改为定时调用 V2 已有的 `GET /v1/sessions?workspace_id=...` 路由。

**推荐方案 A**，因为 SSE 实时性更好，且迁移成本低（直接复用 V1 实现）。

---

## 6. 错误 3：前端 V1 路径调用矩阵 vs V2 路由覆盖

### 6.1 问题本质

前端代码中 `runtimeClient.ts`（~1934 行）包含 103+ 个 V1 路径调用，被 20+ 个文件导入。V2 `DesktopGatewayClient`（`client.ts`）只有 17 个操作。前端混用两套客户端，V1-only 路径在 V2 gateway 上会返回 404。

### 6.2 V1-only 路径（V2 无对应路由）

| 前端路径 | 调用方 | HTTP | V2 状态 | V1 后端位置 |
|----------|--------|------|---------|-------------|
| `/v1/workspaces/{id}/session-catalog-events/stream` | runtimeClient.ts:785 | GET (SSE) | **缺失** | gateway_legacy.py:5257 |
| `/v1/chat/completions` | runtimeClient.ts:1253, agentRuns.ts:314 | POST (SSE) | **缺失** (V2 用 OAEP 替代) | gateway_legacy.py 内 |
| `/v1/runtime/shutdown` | gateway.ts:983 | POST | **缺失** | gateway_legacy.py:4674 |
| `/v1/feedback` | feedback.ts:101,195 | GET/POST/DELETE | **缺失** | 外部 feedback 服务 |
| `/v1/feedback/{id}/status` | feedback.ts:106 | POST | **缺失** | 外部 feedback 服务 |
| `/v1/feedback/{id}` | feedback.ts:111 | DELETE | **缺失** | 外部 feedback 服务 |
| `/v1/config/model/restore` | myDrSaiConfig.ts | POST | **缺失** | gateway_legacy.py:11434 |
| `/v1/config/model-providers/{name}` | myDrSaiConfig.ts | PUT/DELETE | **缺失** | gateway_legacy.py:12313,12410 |
| `/v1/config/model-providers/{name}/test` | myDrSaiConfig.ts | POST | **缺失** | gateway_legacy.py:12446 |
| `/v1/config/model-providers/{name}/capability-probes` | myDrSaiConfig.ts | POST | **缺失** | gateway_legacy.py:12495 |
| `/v1/config/model-providers/models` | myDrSaiConfig.ts | POST | **缺失** | gateway_legacy.py:12242 |
| `/v1/config/agents/{id}/tools` | myDrSaiConfig.ts | GET/PUT | **缺失** | gateway_legacy.py:11877,11983 |
| `/v1/config/agents/{id}/tools/preview` | myDrSaiConfig.ts | POST | **缺失** | gateway_legacy.py:11931 |
| `/v1/config/tools/{id}/test` | myDrSaiConfig.ts | POST | **缺失** | gateway_legacy.py:10441 |
| `/v1/config/agents/{id}/skills` | myDrSaiConfig.ts | GET/PUT | **缺失** | gateway_legacy.py:11993,11999 |
| `/v1/config/agents/{id}/skills/preview` | myDrSaiConfig.ts | POST | **缺失** | gateway_legacy.py:12009 |
| `/v1/config/agents/{id}/knowledge` | myDrSaiConfig.ts | GET/PUT | **缺失** | gateway_legacy.py:12043,12049 |
| `/v1/config/agents/{id}/knowledge/preview` | myDrSaiConfig.ts | POST | **缺失** | gateway_legacy.py:12062 |
| `/v1/config/knowledge-bases/{id}/index` | myDrSaiConfig.ts | POST | **缺失** | gateway_legacy.py:10686 |
| `/v1/config/agents/{id}/realtime-voice-probe` | myDrSaiConfig.ts | POST | **缺失** | — |
| `/v1/config/agents/current` | myDrSaiConfig.ts | GET/PUT | **已有** V2 config.py:139 | — |
| `/v1/config/agents/{id}/model-capability-status` | myDrSaiConfig.ts | GET | **已有** V2 config.py:617 | — |

### 6.3 V2 已有路由（前端已覆盖）

V2 `desktop_gateway` 共有 **10 个路由文件** + GFS + Skills，总计 ~60 个路由：

| 路由文件 | 路由数 | 关键路由 |
|----------|--------|----------|
| `runtime.py` | 2 | `GET /health`, `GET /v1/runtime` |
| `capabilities.py` | 1 | `GET /v1/capabilities` (含 OAEP 协议声明) |
| `sessions.py` | 7 | `POST/GET /v1/sessions`, `PATCH`, `oaep-snapshot`, `oaep-events`, `oaep-events/stream` |
| `runs.py` | 9 | `POST /v1/sessions/{id}/runs`, `execute`, `cancel`, 6 个 GET |
| `workspaces.py` | 5 | `GET/POST/DELETE /v1/workspaces`, `files`, `file` |
| `models.py` | 2 | `GET /v1/models`, `GET /v1/config/model-catalog` |
| `config.py` | 14 | `cli`, `agents`, `agents/{id}/models`, `model`, `model-providers`, `model-state`, `runtime-models`, `model/preview` |
| `identity.py` | 2 | `PUT /v1/config/user-name`, `POST /v1/identity/canonicalize` |
| `audio.py` | 1 | `POST /v1/audio/transcriptions` |
| `agent_backends.py` | 6 | `account`, `login`, `logout`, `models`, `restart` |
| `gfs_api.py` | 9 | `/v1/gfs/*` (health, list, stat, read, write, upload, download, delete, share-url) |
| `skills_api.py` | 7 | `/v1/skills/*` (list, available, get, install, update, delete, reload) |

### 6.4 前端 V1 残留模块

| 模块文件 | 行数 | 耦合度 | 说明 |
|----------|------|--------|------|
| `runtimeClient.ts` | ~1934 | **极高** | 被 chat.ts、index.ts(30+处)、oaepSessionStream.ts、conversationResourceActions.ts、forkWorktrees.ts 等导入 |
| `agentRuns.ts` | ~314 | 中 | V1 `/v1/chat/completions` 调用，已被 V2 OAEP 链路替代 |
| `feedback.ts` | ~195 | 低 | `/v1/feedback` 调用，指向外部服务 |
| `remoteGatewayClient.generated.ts` | ~85 | 低 | 自动生成的 V1 路由映射 |
| `gatewayManagedResources.ts` | ~80 | 中 | 与 gfs.ts/skills.ts 重复的调用 |

---

## 7. 修复优先级

| 优先级 | 错误 | 修复方式 | 预估工作量 |
|--------|------|----------|------------|
| **P0** | models.py 504 超时 | timeout 4s→10s + 超时降级到本地模型 | 1 处改动 |
| **P1** | session-catalog-events/stream 404 | V2 workspaces.py 添加 SSE 路由（从 V1 迁移） | 1 个路由 |
| **P2** | config 子路由缺失 | 从 gateway_legacy.py 提取 ~20 个路由到 V2 config.py | 中等 |
| **P3** | runtimeClient.ts V1 代码迁移 | 类型提取 + 调用替换 + 删除 V1 模块 | 大规模重构 |

---

## 附录：关键文件索引

| 文件 | 路径 | 说明 |
|------|------|------|
| V2 app 工厂 | `cores/python/.../desktop_gateway/app.py` | create_app() 注册 10 ROUTERS + GFS + Skills |
| V2 路由目录 | `cores/python/.../desktop_gateway/routes/` | 10 个路由模块 |
| V1 legacy 后端 | `cores/python/.../backend/gateway_legacy.py` | ~12600 行，含所有 V1 路由 |
| V1 前端客户端 | `apps/desktop/shared/main/runtimeClient.ts` | ~1934 行，103+ 路径 |
| V2 前端客户端 | `apps/desktop/shared/main/desktopGateway/client.ts` | 17 个操作 |
| V2 前端服务 | `apps/desktop/shared/main/desktopGateway/service.ts` | 19 个 IPC 方法 |
| 启动序列文档 | `docs/desktop-xdb/20260827/desktop-startup-sequence.md` | 完整启动链路分析 |
| V2 路由清单 | `docs/desktop-xdb/20260827/desktop-gateway-routes.md` | V2 路由完整清单 |
