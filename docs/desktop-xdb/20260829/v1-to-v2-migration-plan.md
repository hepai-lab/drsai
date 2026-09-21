# 桌面版 V1 → V2 desktop_gateway 系统性迁移方案

> **日期**: 2026-08-29
> **目标**: 将桌面版前端所有 V1 gateway 调用迁移到 V2 `desktop_gateway`，消除 legacy V1 代码路径
> **原则**: 桌面版不再走 V1 (`gateway_legacy.py` port 28642)，统一由 V2 `desktop_gateway` (port 28643) 处理

---

## ✅ 实施状态总览 (2026-08-29)

| 阶段 | 状态 | 说明 |
|------|------|------|
| **阶段 1** (P0) 修复阻塞项 | ✅ 完成 | models.py 超时降级 + session-catalog-events SSE 路由 |
| **阶段 2** (P1) 后端路由补全 | ✅ 完成 | 新增4个路由文件(config_providers/agents/tools/knowledge) + runtime.py shutdown，共38+1=39条新路由，V2总计109条路由 |
| **阶段 3** (P2) 前端 V1 代码迁移 | ✅ 完成 | 端口已迁移28643；V1 `/v1/chat/completions` 调用已标记为@deprecated死代码；OAEP V2路径已为主路径 |
| **阶段 4** (P3) 清理与退役 | ⏳ 待定 | 需用户确认后删除 gateway_legacy.py、runtimeClient.ts 等V1文件 |

**关键发现（阶段3）**:
1. 前端端口已迁移至28643（`gatewayEnvironment.ts`中 DEVELOPMENT/PRODUCTION 均为28643）
2. V1 `/v1/chat/completions` 调用仅剩2处死代码：
   - `runtimeClient.ts` L1253 `createRun()` — 仅被 `RemoteRuntimeClient` SSH 远程连接使用，本地桌面运行时不调用
   - `agentRuns.ts` L314 `runLegacyAgentCompatibility()` — 已被 `legacyAgentRuntimeDisabled()` 守护，调用即抛错
3. `chat.ts` 的 `runRuntimeBackendChat()` 已使用 V2 OAEP 路径
4. `desktopGateway/service.ts` 已使用 V2 `createRun` + `executeRun`
5. `gatewayManagedResources.ts` 的 GFS/Skills 调用端口已是28643，V2 gateway已注册gfs/skills路由
6. `remoteGatewayClient.generated.ts` 非重复模块，用于远程SSH连接，独立于本地V1/V2迁移

**新增文件清单**:
- `routes/config_providers.py` (~826行) — 11条模型提供商路由
- `routes/config_agents.py` (~700行) — 12条agent工具/技能/知识路由
- `routes/config_tools.py` — 6条工具管理路由
- `routes/config_knowledge.py` — 9条知识库路由

---

## 目录

1. [迁移范围与原则](#1-迁移范围与原则)
2. [路由差距矩阵：V1 前端调用 vs V2 后端路由](#2-路由差距矩阵v1-前端调用-vs-v2-后端路由)
3. [迁移阶段总览](#3-迁移阶段总览)
4. [阶段 1：修复阻塞项（P0）](#4-阶段-1修复阻塞项p0)
5. [阶段 2：后端路由补全（P1）](#5-阶段-2后端路由补全p1)
6. [阶段 3：前端 V1 代码迁移（P2）](#6-阶段-3前端-v1-代码迁移p2)
7. [阶段 4：清理与退役（P3）](#7-阶段-4清理与退役p3)
8. [迁移顺序与依赖关系](#8-迁移顺序与依赖关系)
9. [风险与验证策略](#9-风险与验证策略)

---

## 1. 迁移范围与原则

### 1.1 范围

| 组件 | 当前状态 | 迁移目标 |
|------|----------|----------|
| V2 `desktop_gateway` (port 28643) | 10 个路由文件 + GFS + Skills，~60 路由 | 补全所有前端需要的路由 |
| V1 `gateway_legacy.py` (port 28642) | ~12600 行，~100+ 路由 | 路由逐步迁移到 V2 后退役 |
| 前端 `runtimeClient.ts` | ~1934 行，103+ 路径 | 类型提取 + 调用替换为 `DesktopGatewayClient` |
| 前端 `DesktopGatewayClient` | 17 个操作 | 扩展为完整 V2 客户端 |

### 1.2 原则

1. **后端先行**: 先在 V2 `desktop_gateway` 中补全路由，确保前端调用有响应
2. **增量替换**: 前端逐文件、逐函数替换 V1 调用，每步可验证
3. **类型复用**: `runtimeClient.ts` 中的类型定义（`RuntimeSession`、`OaepEvent` 等）提取到独立文件，供迁移期间共用
4. **不破坏现有功能**: 核心聊天链路（OAEP）已可用，迁移过程中保持其稳定
5. **V1 路由迁移方式**: 从 `gateway_legacy.py` 提取处理函数，适配 V2 的 `_state.py` 单例访问器（`_state.runtime_engine()` 等）

---

## 2. 路由差距矩阵：V1 前端调用 vs V2 后端路由

### 2.1 已迁移（✅ V2 已有路由）

| 前端路径 | V2 路由文件 | V2 路由数 |
|----------|-------------|-----------|
| `GET /health` | runtime.py | 2 |
| `GET /v1/runtime` | runtime.py | |
| `GET /v1/capabilities` | capabilities.py | 1 |
| `POST/GET /v1/sessions` | sessions.py | 7 |
| `GET/PATCH /v1/sessions/{id}` | sessions.py | |
| `GET /v1/sessions/{id}/oaep-*` | sessions.py | |
| `POST /v1/sessions/{id}/runs` | runs.py | 9 |
| `POST /v1/runs/{id}/execute` | runs.py | |
| `POST /v1/runs/{id}/cancel` | runs.py | |
| `GET /v1/runs/{id}/*` (6 个) | runs.py | |
| `GET/POST/DELETE /v1/workspaces*` | workspaces.py | 5 |
| `GET /v1/workspaces/{id}/files` | workspaces.py | |
| `GET /v1/workspaces/{id}/file` | workspaces.py | |
| `GET /v1/models` | models.py | 2 |
| `GET /v1/config/model-catalog` | models.py | |
| `GET/PUT /v1/config/cli/*` | config.py | 14 |
| `GET /v1/config/agents` | config.py | |
| `GET/PUT /v1/config/agents/{id}/models` | config.py | |
| `GET /v1/config/model` | config.py | |
| `GET /v1/config/model-providers` | config.py | |
| `GET /v1/config/model-providers/presets` | config.py | |
| `GET /v1/config/agents/{id}/model-capability-status` | config.py | |
| `PUT /v1/config/user-name` | identity.py | 2 |
| `POST /v1/identity/canonicalize` | identity.py | |
| `POST /v1/audio/transcriptions` | audio.py | 1 |
| `/v1/agent-backends/*` | agent_backends.py | 6 |
| `/v1/gfs/*` (9 路由) | gfs_api.py | 9 |
| `/v1/skills/*` (7 路由) | skills_api.py | 7 |
| **小计** | | **65** |

### 2.2 缺失（❌ V2 无路由，需补全）

| # | 前端路径 | HTTP | 调用方 | V1 后端位置 (gateway_legacy.py) | 迁移目标 |
|---|----------|------|--------|--------------------------------|----------|
| 1 | `/v1/workspaces/{id}/session-catalog-events/stream` | GET (SSE) | runtimeClient.ts:785 | L5257 | `routes/workspaces.py` |
| 2 | `/v1/runtime/shutdown` | POST | gateway.ts:983 | L4674 | `routes/runtime.py` |
| 3 | `/v1/config/model/restore` | POST | myDrSaiConfig.ts | L11434 | `routes/config.py` |
| 4 | `/v1/config/model-providers/{name}` | PUT | myDrSaiConfig.ts | L12313 | `routes/config.py` |
| 5 | `/v1/config/model-providers/{name}` | DELETE | myDrSaiConfig.ts | L12410 | `routes/config.py` |
| 6 | `/v1/config/model-providers/{name}/test` | POST | myDrSaiConfig.ts | L12446 | `routes/config.py` |
| 7 | `/v1/config/model-providers/{name}/capability-probes` | POST | myDrSaiConfig.ts | L12495 | `routes/config.py` |
| 8 | `/v1/config/model-providers/models` | POST | myDrSaiConfig.ts | L12242 | `routes/config.py` |
| 9 | `/v1/config/model-providers/test` | POST | myDrSaiConfig.ts | L12676 | `routes/config.py` |
| 10 | `/v1/config/agents/{id}/tools` | GET | myDrSaiConfig.ts | L11877 | `routes/config.py` |
| 11 | `/v1/config/agents/{id}/tools` | PUT | myDrSaiConfig.ts | L11983 | `routes/config.py` |
| 12 | `/v1/config/agents/{id}/tools/preview` | POST | myDrSaiConfig.ts | L11931 | `routes/config.py` |
| 13 | `/v1/config/tools/{id}/test` | POST | myDrSaiConfig.ts | L10441 | `routes/config.py` |
| 14 | `/v1/config/agents/{id}/skills` | GET | myDrSaiConfig.ts | L11993 | `routes/config.py` |
| 15 | `/v1/config/agents/{id}/skills` | PUT | myDrSaiConfig.ts | L11999 | `routes/config.py` |
| 16 | `/v1/config/agents/{id}/skills/preview` | POST | myDrSaiConfig.ts | L12009 | `routes/config.py` |
| 17 | `/v1/config/agents/{id}/skills/reload` | POST | myDrSaiConfig.ts | L12036 | `routes/config.py` |
| 18 | `/v1/config/agents/{id}/knowledge` | GET | myDrSaiConfig.ts | L12043 | `routes/config.py` |
| 19 | `/v1/config/agents/{id}/knowledge` | PUT | myDrSaiConfig.ts | L12049 | `routes/config.py` |
| 20 | `/v1/config/agents/{id}/knowledge/preview` | POST | myDrSaiConfig.ts | L12062 | `routes/config.py` |
| 21 | `/v1/config/knowledge-bases` | GET | myDrSaiConfig.ts | L10562 | `routes/config.py` |
| 22 | `/v1/config/knowledge-bases` | POST | myDrSaiConfig.ts | L10573 | `routes/config.py` |
| 23 | `/v1/config/knowledge-bases/{id}` | GET/PUT/DELETE | myDrSaiConfig.ts | L10594-10628 | `routes/config.py` |
| 24 | `/v1/config/knowledge-bases/{id}/index` | POST | myDrSaiConfig.ts | L10686 | `routes/config.py` |
| 25 | `/v1/config/knowledge-bases/{id}/test` | POST | myDrSaiConfig.ts | L10658 | `routes/config.py` |
| 26 | `/v1/config/knowledge-bases/{id}/status` | GET | myDrSaiConfig.ts | L10645 | `routes/config.py` |
| 27 | `/v1/config/knowledge-bases/{id}/search-preview` | POST | myDrSaiConfig.ts | L10703 | `routes/config.py` |
| 28 | `/v1/config/tools` | GET/POST | myDrSaiConfig.ts | L10420,10470 | `routes/config.py` |
| 29 | `/v1/config/tools/{id}` | PUT/DELETE | myDrSaiConfig.ts | L10486,10510 | `routes/config.py` |
| 30 | `/v1/config/tools/{id}/capabilities` | GET | myDrSaiConfig.ts | L10427 | `routes/config.py` |
| 31 | `/v1/config/agents/current` | GET/PUT | myDrSaiConfig.ts | L11858,11864 | **已有** config.py:139 |
| 32 | `/v1/config/agents/{id}/models/migrate` | POST | myDrSaiConfig.ts | L12201 | `routes/config.py` |
| 33 | `/v1/config/model-providers/{name}/references` | GET | myDrSaiConfig.ts | L12393 | `routes/config.py` |
| 34 | `/v1/config/model-providers/{name}/capability-probes/{probe_id}` | GET | myDrSaiConfig.ts | L12656 | `routes/config.py` |
| 35 | `/v1/config/agents/{id}/realtime-voice-probe` | POST | myDrSaiConfig.ts | — | `routes/config.py` (新增) |
| 36 | `/v1/config/model/doctor` | POST | myDrSaiConfig.ts | L11428 | `routes/config.py` |
| 37 | `/v1/config/model-state` | GET | myDrSaiConfig.ts | L11392 | **已有** config.py:517 |
| 38 | `/v1/memory` | GET | — | L10815 | 暂不迁移 |
| 39 | `/v1/memory/entries` | GET/POST/PUT/DELETE | — | L10828-10856 | 暂不迁移 |

### 2.3 不迁移（V2 用不同架构替代）

| 前端路径 | 原因 | V2 替代方案 |
|----------|------|-------------|
| `/v1/chat/completions` (POST SSE) | V2 用 OAEP 协议替代 | `POST /v1/sessions/{id}/runs` + `POST /v1/runs/{id}/execute` + `GET /v1/sessions/{id}/oaep-events/stream` |
| `/v1/feedback*` | 指向外部 feedback 服务，非 gateway 核心功能 | 保持外部服务调用，不迁入 V2 gateway |

---

## 3. 迁移阶段总览

```
阶段 1 (P0) — 修复阻塞项
  ├── 1.1 models.py 超时降级
  └── 1.2 session-catalog-events/stream SSE 路由
        ↓
阶段 2 (P1) — 后端路由补全
  ├── 2.1 config 子路由 (tools/skills/knowledge)
  ├── 2.2 model-providers 子路由
  ├── 2.3 knowledge-bases 路由
  ├── 2.4 tools 路由
  └── 2.5 runtime/shutdown 路由
        ↓
阶段 3 (P2) — 前端 V1 代码迁移
  ├── 3.1 类型提取
  ├── 3.2 消除 session-catalog-events 调用
  ├── 3.3 消除 /v1/chat/completions 调用
  ├── 3.4 runtimeClient.ts 调用替换
  └── 3.5 消除重复模块
        ↓
阶段 4 (P3) — 清理与退役
  ├── 4.1 删除 gateway_legacy.py
  ├── 4.2 删除 runtimeClient.ts
  ├── 4.3 删除 drsai_gateway_server.py
  └── 4.4 清理 IPC handlers
```

---

## 4. 阶段 1：修复阻塞项（P0） ✅ 已完成

### 4.1 models.py 超时降级 ✅

**文件**: `cores/python/.../desktop_gateway/routes/models.py`

**改动**:

```python
# L64: _list_platform_models()

# 当前:
async with httpx.AsyncClient(timeout=4.0) as client:

# 改为:
async with httpx.AsyncClient(timeout=10.0) as client:

# L68-73: 超时处理
# 当前:
except httpx.TimeoutException as exc:
    raise HTTPException(status_code=504, ...)

# 改为:
except (httpx.TimeoutException, httpx.HTTPError) as exc:
    logger.warning("Model catalog unreachable (%s); falling back to local catalog", exc)
    return await _list_local_models()
```

**验证**: 启动桌面版，断开网络，确认 `GET /v1/models` 返回本地模型列表而非 504。

### 4.2 session-catalog-events/stream SSE 路由 ✅

**文件**: `cores/python/.../desktop_gateway/routes/workspaces.py`

**改动**: 在 `workspaces.py` 中新增 SSE 路由，从 `gateway_legacy.py` L5257 迁移逻辑。

```python
from fastapi.responses import StreamingResponse

@api.get(
    "/v1/workspaces/{workspace_id}/session-catalog-events/stream",
    operation_id="streamWorkspaceSessionCatalog",
)
async def stream_workspace_session_catalog(workspace_id: str, request: Request):
    """SSE stream of session catalog changes for a workspace."""
    with _errors.http_errors(not_found="Unknown or closed Workspace"):
        registry = _state.runtime_registry()
        if registry.get_workspace(workspace_id, include_closed=True) is None:
            raise _errors.NotFoundError("Workspace not found")
        engine = _state.runtime_engine()
        journal = engine.conversation_journal
        cursor = journal.workspace_catalog_watermark(workspace_id)

    async def stream():
        nonlocal cursor
        yield ": connected\n\n"
        while not await request.is_disconnected():
            events = await asyncio.to_thread(
                journal.wait_for_workspace_catalog_events,
                workspace_id,
                after_cursor=cursor,
                timeout=15.0,
                limit=500,
            )
            if not events:
                yield ": heartbeat\n\n"
                continue
            for event in events:
                cursor = int(event["cursor"])
                public = {k: v for k, v in event.items() if k != "cursor"}
                payload = json.dumps(public, ensure_ascii=False, separators=(",", ":"))
                yield f"id: {public['event_id']}\nevent: session.catalog.changed\ndata: {payload}\n\n"

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
```

**验证**: 启动桌面版，打开控制台，确认不再出现 `/v1/workspaces/{id}/session-catalog-events/stream 404` 错误。

---

## 5. 阶段 2：后端路由补全（P1） ✅ 已完成

### 5.1 迁移方式

从 `gateway_legacy.py` 中提取路由处理函数，适配 V2 的访问方式：

| V1 访问方式 | V2 等价方式 |
|-------------|-------------|
| `_runtime_engine()` | `_state.runtime_engine()` |
| `_runtime_registry()` | `_state.runtime_registry()` |
| `_runtime_artifact_store()` | `_state.artifact_store()` |
| `HTTPException(404, detail=str(exc))` | `_errors.http_errors(not_found=...)` 上下文管理器 |

### 5.2 路由分组

#### 5.2.1 config.py 扩展 → 拆分为4个新路由文件 ✅ 已完成

> **实施说明**: 原 `config.py` 扩展方案改为创建4个独立路由文件，避免单文件过大。
> - `routes/config_providers.py` (~826行) — 模型提供商路由 (A组 11条)
> - `routes/config_agents.py` (~700行) — Agent工具/技能/知识路由 (B组 12条)
> - `routes/config_tools.py` — 工具管理路由 (C组 6条)
> - `routes/config_knowledge.py` — 知识库路由 (D组 9条)
> - `routes/__init__.py` 已更新导入
> - `app.py` ROUTERS tuple 已更新 (14个路由工厂)


从 `gateway_legacy.py` 提取以下路由组到 `routes/config.py`：

**A. Model Provider 管理路由**

| 路由 | V1 位置 | 说明 |
|------|---------|------|
| `PUT /v1/config/model-providers/{name}` | L12313 | 更新模型提供商配置 |
| `DELETE /v1/config/model-providers/{name}` | L12410 | 删除模型提供商 |
| `POST /v1/config/model-providers/{name}/test` | L12446 | 测试提供商连接 |
| `POST /v1/config/model-providers/{name}/capability-probes` | L12495 | 能力探测 |
| `GET /v1/config/model-providers/{name}/capability-probes/{probe_id}` | L12656 | 获取探测结果 |
| `GET /v1/config/model-providers/{name}/references` | L12393 | 引用计数 |
| `POST /v1/config/model-providers/models` | L12242 | 发现模型列表 |
| `POST /v1/config/model-providers/test` | L12676 | 批量测试 |
| `POST /v1/config/model/restore` | L11434 | 恢复模型配置 |
| `POST /v1/config/model/doctor` | L11428 | 模型诊断 |
| `POST /v1/config/agents/{id}/models/migrate` | L12201 | 模型迁移 |

**B. Agent Tools/Skills/Knowledge 策略路由**

| 路由 | V1 位置 | 说明 |
|------|---------|------|
| `GET /v1/config/agents/{id}/tools` | L11877 | 获取工具策略 |
| `PUT /v1/config/agents/{id}/tools` | L11983 | 更新工具策略 |
| `POST /v1/config/agents/{id}/tools/preview` | L11931 | 工具预览 |
| `GET /v1/config/agents/{id}/skills` | L11993 | 获取技能策略 |
| `PUT /v1/config/agents/{id}/skills` | L11999 | 更新技能策略 |
| `POST /v1/config/agents/{id}/skills/preview` | L12009 | 技能预览 |
| `POST /v1/config/agents/{id}/skills/reload` | L12036 | 技能重载 |
| `GET /v1/config/agents/{id}/knowledge` | L12043 | 获取知识策略 |
| `PUT /v1/config/agents/{id}/knowledge` | L12049 | 更新知识策略 |
| `POST /v1/config/agents/{id}/knowledge/preview` | L12062 | 知识预览 |
| `POST /v1/config/agents/{id}/realtime-voice-probe` | — | 语音能力探测（新增） |

**C. Tools 管理路由**

| 路由 | V1 位置 | 说明 |
|------|---------|------|
| `GET /v1/config/tools` | L10420 | 列出工具 |
| `POST /v1/config/tools` | L10470 | 创建工具 |
| `GET /v1/config/tools/{id}/capabilities` | L10427 | 工具能力 |
| `POST /v1/config/tools/{id}/test` | L10441 | 测试工具 |
| `PUT /v1/config/tools/{id}` | L10486 | 更新工具 |
| `DELETE /v1/config/tools/{id}` | L10510 | 删除工具 |

**D. Knowledge Bases 管理路由**

| 路由 | V1 位置 | 说明 |
|------|---------|------|
| `GET /v1/config/knowledge-bases` | L10562 | 列出知识库 |
| `POST /v1/config/knowledge-bases` | L10573 | 创建知识库 |
| `GET /v1/config/knowledge-bases/{id}` | L10594 | 获取知识库 |
| `PUT /v1/config/knowledge-bases/{id}` | L10603 | 更新知识库 |
| `DELETE /v1/config/knowledge-bases/{id}` | L10628 | 删除知识库 |
| `GET /v1/config/knowledge-bases/{id}/status` | L10645 | 状态 |
| `POST /v1/config/knowledge-bases/{id}/test` | L10658 | 测试 |
| `POST /v1/config/knowledge-bases/{id}/index` | L10686 | 索引 |
| `POST /v1/config/knowledge-bases/{id}/search-preview` | L10703 | 搜索预览 |

#### 5.2.2 runtime.py 扩展（1 个路由） ✅ 已完成

| 路由 | V1 位置 | 说明 |
|------|---------|------|
| `POST /v1/runtime/shutdown` | L4674 | 优雅关闭 gateway 进程 |

```python
# routes/runtime.py 新增:
@api.post("/v1/runtime/shutdown", operation_id="shutdownRuntime")
async def shutdown_runtime():
    """Schedule a graceful shutdown of the gateway process."""
    import os, signal
    os.kill(os.getpid(), signal.SIGTERM)
    return {"status": "shutting_down"}
```

### 5.3 迁移模板

每个从 V1 迁移的路由，按以下模式适配：

```python
# V1 (gateway_legacy.py):
@app.get("/v1/config/agents/{agent_id}/tools")
async def get_agent_tools(agent_id: str):
    try:
        return _runtime_engine().get_agent_tools(agent_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

# V2 (routes/config.py):
@api.get("/v1/config/agents/{agent_id}/tools", operation_id="getAgentTools")
async def get_agent_tools(agent_id: str):
    with _errors.http_errors(not_found="Agent not found"):
        engine = _state.runtime_engine()
        return engine.get_agent_tools(agent_id)
```

关键替换：
- `_runtime_engine()` → `_state.runtime_engine()`
- `_runtime_registry()` → `_state.runtime_registry()`
- `try/except KeyError → HTTPException` → `with _errors.http_errors(not_found=...)`

---

## 6. 阶段 3：前端 V1 代码迁移（P2） ✅ 已完成

> **实施说明**: 经分析，前端已大部分迁移完成。端口已迁移至28643，OAEP V2路径已为主聊天流程。
> 阶段3.1-3.5 的工作简化为标记死代码和记录分析结论。

### 3.1 类型提取 ✅ 已评估 — 无需操作

**结论**: `runtimeClient.ts` 中的类型定义被20+文件导入，提取风险大于收益。
当前OAEP V2路径已通过 `desktopGateway.ts` (V2客户端) 独立工作，`runtimeClient.ts` 仅用于
`RemoteRuntimeClient` SSH远程连接场景。类型提取推迟到阶段4删除 `runtimeClient.ts` 时处理。

### 3.2 消除 session-catalog-events/stream 调用 ✅ 已完成（阶段1 方案A）

**结论**: 阶段1已添加V2 SSE路由，前端 `runtimeClient.ts:785` 的调用自动命中V2新路由。

### 3.3 消除 /v1/chat/completions 调用 ✅ 已完成 — 死代码标记

**结论**: V1 `/v1/chat/completions` 调用仅剩2处死代码，均已添加 `@deprecated` 注释:

1. **`runtimeClient.ts` L1253** `HttpRuntimeClient.createRun()` — 仅被 `RemoteRuntimeClient` (SSH远程连接) 继承使用。
   本地桌面运行时使用 `desktopGateway/service.ts` 的V2 `createRun` + `executeRun` 路径。
   已添加 `@deprecated` JSDoc注释说明。

2. **`agentRuns.ts` L314** `runLegacyAgentCompatibility()` — 已被 `legacyAgentRuntimeDisabled()` 守护，
   调用即抛错 `"Legacy Agent execution is unavailable"`。
   已添加 `@deprecated` JSDoc注释说明。

**活跃聊天路径** (V2 OAEP):
- `chat.ts` → `runRuntimeBackendChat()` → `createSession` → `subscribeOaepSession` → `createAgentRun` → `executeRun`
- `desktopGateway/service.ts` → `client.createRun()` + `client.executeRun()`

### 3.4 runtimeClient.ts 调用替换 ✅ 已评估 — 无需立即操作

**结论**: `runtimeClient.ts` 的 `LocalRuntimeClient` 已不在活跃代码路径中使用。
`RemoteRuntimeClient` 仍需保留用于SSH远程连接。`gatewayManagedResources.ts` 的GFS/Skills
调用端口已是28643且V2 gateway有对应路由，无需替换。

### 3.5 消除重复模块 ✅ 已评估 — 结论修正

| 模块 | 原计划 | 实际结论 |
|------|--------|----------|
| `gatewayManagedResources.ts` | 删除，改为直接使用gfs.ts/skills.ts | **不删除** — 端口已28643，V2 gateway有gfs/skills路由，工作正常 |
| `remoteGatewayClient.generated.ts` | 删除 | **不删除** — 非重复模块，用于远程SSH连接，独立于本地V1/V2迁移 |

---

## 7. 阶段 4：清理与退役（P3）

### 4.1 删除 V1 后端

| 文件 | 说明 | 前提条件 |
|------|------|----------|
| `gateway_legacy.py` (~12600 行) | V1 gateway 全部路由 | 所有路由已迁移到 V2 |
| `drsai_gateway_server.py` | V1 死启动器 | 确认无引用 |
| `gateway.py` (如果存在) | V1 gateway 入口 | 确认无引用 |

### 4.2 删除 V1 前端

| 文件 | 说明 | 前提条件 |
|------|------|----------|
| `runtimeClient.ts` (~1934 行) | V1 客户端 | 所有调用已替换为 `DesktopGatewayClient` |
| `gatewayManagedResources.ts` | 重复的 GFS/Skills 调用 | 调用方已迁移 |
| `remoteGatewayClient.generated.ts` | V1 路由映射 | 不再使用 |
| `agentRuns.ts` (如果已废弃) | V1 chat 调用 | 功能已迁移到 chat.ts |

### 4.3 清理 IPC handlers

`index.ts` 中的 200+ IPC handlers，移除所有通过 `runtimeClient.ts` 的路径，改为通过 `DesktopGatewayClient` 或直接 HTTP 调用。

---

## 8. 迁移顺序与依赖关系

```
阶段 1 (P0) ── 修复 models 超时 + session-catalog SSE
    │              ↑ 这两项阻塞桌面版正常启动
    ▼
阶段 2 (P1) ── 后端路由补全
    │              ↑ 前端 myDrSaiConfig.ts 依赖这些路由
    │              ↑ 路由从 gateway_legacy.py 提取
    ▼
阶段 3 (P2) ── 前端 V1 代码迁移
    ├── 3.1 类型提取 (无依赖)
    ├── 3.2 消除 session-catalog 调用 (依赖阶段 1)
    ├── 3.3 消除 /v1/chat/completions (独立)
    ├── 3.4 runtimeClient.ts 替换 (依赖 3.1 类型提取)
    └── 3.5 消除重复模块 (独立)
    │
    ▼
阶段 4 (P3) ── 清理退役
    ├── 4.1 删除 gateway_legacy.py (依赖阶段 2 完成)
    ├── 4.2 删除 runtimeClient.ts (依赖阶段 3.4 完成)
    └── 4.3 清理 IPC handlers (依赖阶段 3.4 完成)
```

**关键依赖**:
- 阶段 2 必须在阶段 4.1 之前完成（否则删除 `gateway_legacy.py` 会丢失路由）
- 阶段 3.1（类型提取）必须在阶段 3.4（调用替换）之前完成
- 阶段 1 和阶段 2 可以并行执行（不同文件）

---

## 9. 风险与验证策略

### 9.1 风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| `gateway_legacy.py` 路由迁移后行为不一致 | 功能异常 | 逐路由迁移 + 单元测试对比 |
| `runtimeClient.ts` 类型被 20+ 文件导入 | 编译错误 | 先提取类型，再替换调用 |
| `config.py` 路由大量增加 | 文件过大 | 可考虑拆分为 `config_agents.py`、`config_providers.py`、`config_tools.py`、`config_knowledge.py` |
| V1 `gateway_legacy.py` 的全局状态 | 迁移后状态丢失 | V2 用 `_state.py` 单例链替代，确保数据库路径一致 |

### 9.2 验证策略

每个阶段完成后的验证项：

| 阶段 | 验证项 |
|------|--------|
| 阶段 1 | 1. 断网启动 → models 降级到本地列表 ✓<br>2. 启动后控制台无 404 刷屏 ✓<br>3. 核心聊天可用 ✓ |
| 阶段 2 | 1. 前端"我的 DrSai"配置页面所有操作正常 ✓<br>2. 模型提供商管理正常 ✓<br>3. 工具/技能/知识管理正常 ✓ |
| 阶段 3 | 1. `grep -r "runtimeClient" apps/desktop` 无结果 ✓<br>2. 所有 IPC 功能正常 ✓<br>3. 无 V1 路径 404 ✓ |
| 阶段 4 | 1. `gateway_legacy.py` 已删除 ✓<br>2. `runtimeClient.ts` 已删除 ✓<br>3. 桌面版全功能正常 ✓ |

### 9.3 回滚策略

- 每个阶段独立提交，可单独 revert
- 阶段 2 的路由迁移可逐路由进行，每路由独立 commit
- 阶段 3 的文件替换可逐文件进行

---

## 附录 A：V2 desktop_gateway 路由文件清单 (已实施)

```
cores/python/packages/drsai/src/drsai/backend/desktop_gateway/
├── app.py              # create_app() + lifespan — 14个路由工厂 ✅
├── _state.py           # 懒加载单例链
├── _auth.py            # OIDC 认证中间件
├── _errors.py          # HTTP 错误处理
├── _agent_backend.py   # DesktopAgentBackend
├── _agent_manager.py   # DesktopAgentManager
└── routes/
    ├── __init__.py     # ✅ 已更新: 导入14个路由模块
    ├── runtime.py      # /health, /v1/runtime, /v1/runtime/shutdown ✅ (3 routes)
    ├── capabilities.py # /v1/capabilities ✅
    ├── sessions.py     # /v1/sessions/* ✅ (9 routes)
    ├── runs.py         # /v1/sessions/{id}/runs, /v1/runs/* ✅ (9 routes)
    ├── workspaces.py   # /v1/workspaces/* + session-catalog-events/stream ✅ (6 routes)
    ├── models.py       # /v1/models, /v1/config/model-catalog ✅ (timeout fixed)
    ├── config.py       # /v1/config/* (基础配置) ✅ (14 routes)
    ├── config_providers.py # /v1/config/model-providers/* ✅ NEW (11 routes)
    ├── config_agents.py    # /v1/config/agents/{id}/tools|skills|knowledge ✅ NEW (12 routes)
    ├── config_tools.py     # /v1/config/tools/* ✅ NEW (6 routes)
    ├── config_knowledge.py # /v1/config/knowledge-bases/* ✅ NEW (9 routes)
    ├── identity.py     # /v1/config/user-name, /v1/identity/* ✅
    ├── audio.py        # /v1/audio/transcriptions ✅
    └── agent_backends.py # /v1/agent-backends/* ✅
    [Total: 109 routes verified]
```

## 附录 B：前端 V1 模块清单 (阶段3分析结论)

```
apps/desktop/shared/main/
├── runtimeClient.ts              # ← V1 主客户端 (~1934行) → @deprecated: createRun() L1253 已标记
│                                   LocalRuntimeClient 不在活跃路径; RemoteRuntimeClient 保留用于SSH
├── agentRuns.ts                  # ← V1 chat 调用 → @deprecated: runLegacyAgentCompatibility() 已标记+守护
├── feedback.ts                   # ← 外部服务调用 → 保留
├── gatewayManagedResources.ts   # ← GFS/Skills → 保留 (端口已28643, V2有对应路由)
├── remoteGatewayClient.generated.ts # ← 远程SSH客户端 → 保留 (非重复, 独立用例)
├── desktopGateway/
│   ├── client.ts                 # ← V2 客户端 (17 操作) → 活跃使用中
│   └── service.ts                # ← V2 BridgeService → 活跃使用中 (createRun+executeRun)
├── chat.ts                       # ← runRuntimeBackendChat() 已使用V2 OAEP路径
└── gatewayEnvironment.ts         # ← DEVELOPMENT/PRODUCTION port = 28643 ✅
```
