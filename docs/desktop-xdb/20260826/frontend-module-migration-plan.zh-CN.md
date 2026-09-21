# Desktop V2 前端模块迁移方案：IPC 架构不变，后端路由收窄

> **分支**: `feature/desktop-v2`
> **日期**: 2026-08-26
> **关系**: 收窄 `v2-minimal-surface.zh-CN.md` 的 16 条路由至前端迁移实践
> **前置文档**: `windows-module-restructure-plan.zh-CN.md`, `v2-minimal-surface.zh-CN.md`

---

## 0. 核心结论

**V2 不是重构 IPC 架构，而是缩减后端 gateway 路由（42 → 16）。**

迁移的正确做法：

1. **复制旧版完整前端代码**（renderer + main + api + preload）到 `apps/desktop/`
2. **仅修改 gateway 端口**：`28642` → `28643`（V2 desktop_gateway 端口）
3. **删除 V2 不需要的 IPC handler**（对应被砍掉的 26 条路由的功能）
4. **保留 OIDC 登录链路原样不动**（0 条 gateway 路由，全在主进程完成）
5. **不需要创建新的 `window.drsai` bridge 或极简 workbench UI**

> ⚠️ 之前的迁移犯了根本性错误：创建了全新的 4 组件极简 workbench + 19 方法的 `window.drsai` bridge，完全偏离了"保留旧版 UI"的要求。正确做法是**复制旧版代码，仅改端口和裁剪路由**。

---

## 1. V2 的 16 条后端路由

后端 `desktop_gateway` 已存在于 `cores/python/packages/drsai/src/drsai/backend/desktop_gateway/`，端口 `28643`。

### 路由清单

| # | operation_id | HTTP | 路径 | 路由文件 | 后端实现 |
|---|---|---|---|---|---|
| 1 | `getRuntimeIdentity` | GET | `/v1/runtime` | `routes/runtime.py:59` | Runtime 身份与能力 |
| 2 | `createSession` | POST | `/v1/sessions` | `routes/sessions.py:38` | `RuntimeEngine.create_session` |
| 3 | `listSessions` | GET | `/v1/sessions` | `routes/sessions.py:50` | `RuntimeEngine.list_sessions` |
| 4 | `getSession` | GET | `/v1/sessions/{session_id}` | `routes/sessions.py:64` | `RuntimeEngine.get_session` |
| 5 | `updateSession` | PATCH | `/v1/sessions/{session_id}` | `routes/sessions.py:71` | `RuntimeEngine.update_session` |
| 6 | `getSessionSnapshot` | GET | `/v1/sessions/{session_id}/oaep-snapshot` | `routes/sessions.py:83` | `RuntimeEngine.oaep_snapshot` |
| 7 | `listSessionEvents` | GET | `/v1/sessions/{session_id}/oaep-events` | `routes/sessions.py:105` | `RuntimeEngine.list_oaep_events` |
| 8 | `streamSessionEvents` | GET | `/v1/sessions/{session_id}/oaep-events/stream` | `routes/sessions.py:125` | SSE over `ConversationJournal` |
| 9 | `createRun` | POST | `/v1/sessions/{session_id}/runs` | `routes/runs.py:48` | `RuntimeEngine.create_run` |
| 10 | `executeRun` | POST | `/v1/runs/{run_id}/execute` | `routes/runs.py:63` | `RuntimeAgentService.execute` |
| 11 | `cancelRun` | POST | `/v1/runs/{run_id}/cancel` | `routes/runs.py:131` | `RuntimeAgentService.cancel` |
| 12 | `getModelCatalog` | GET | `/v1/config/model-catalog` | `routes/models.py:32` | `build_model_catalog()` |
| 13 | `listWorkspaces` | GET | `/v1/workspaces` | `routes/workspaces.py:20` | `RuntimeRegistry.list_workspaces` |
| 14 | `openWorkspace` | POST | `/v1/workspaces` | `routes/workspaces.py:31` | `RuntimeRegistry.open_workspace` |
| 15 | `listWorkspaceFiles` | GET | `/v1/workspaces/{workspace_id}/files` | `routes/workspaces.py:44` | 目录遍历 + git status |
| 16 | `readWorkspaceFile` | GET | `/v1/workspaces/{workspace_id}/file` | `routes/workspaces.py:64` | 读文件 + mime + base64 兜底 |
| 17 | `transcribeAudio` | POST | `/v1/audio/transcriptions` | `routes/audio.py:109` | `OpenAIAudioOperationAdapter.transcribe` |

> 注：`app.py` 注释写 "17 routes" 是因为将 SSE stream 单独计数。V2 spec 按 16 条计（execute 不做流式输出，返回 JSON；事件通过 SSE 事件流读取）。

### 认证中间件（0 条路由）

`_auth.py` 中间件校验 4 个请求头，逐请求执行，**不是独立路由**：

| 请求头 | 用途 |
|---|---|
| `x-opendrsai-gateway-token` | 证明调用方是配对的本机主进程（实例令牌） |
| `x-opendrsai-auth-mode: oidc` | 标识使用 OIDC 认证模式 |
| `authorization: Bearer <hepai_token>` | HepAI 访问令牌（签名、发行者、受众、作用域、过期校验） |
| `x-opendrsai-principal: <subject>` | 用户主体标识 |

---

## 2. 前端模块清单

### 2.1 需要迁移的模块（全部复制）

| 模块路径 | 文件数 | 说明 |
|---|---|---|
| `shared/renderer/src/` | 198 文件 | React UI（聊天、工作区、认证、语音等全部界面） |
| `shared/main/` | 143 文件 | 主进程（IPC handler、gateway 管理、auth、runtimeClient 等） |
| `shared/api/` | 38 文件 | 类型定义（desktopApi.ts, desktopBridge.ts, desktopGateway.ts 等） |
| `windows/src/main/` | — | Windows 平台主进程入口 |
| `windows/src/preload/` | — | Windows 平台 preload 脚本 |

### 2.2 迁移后需要修改的部分

| 修改项 | 旧值 | 新值 | 影响文件 |
|---|---|---|---|
| Gateway 端口 | `28642` (dev) / `18642` (prod) | `28643` | `gatewayEnvironment.ts` |
| Gateway 模块路径 | `gateway_legacy.py:app` | `desktop_gateway.app:app` | `gateway.ts` |
| Gateway 进程启动参数 | `--app gateway_legacy` | `--app desktop_gateway` | `gateway.ts` 或进程启动脚本 |

### 2.3 迁移后需要删除的 IPC handler（对应被砍掉的路由）

以下 IPC 通道在旧版中有对应的 gateway 路由，但 V2 不再需要：

| 功能类别 | 被 V2 砍掉的 IPC 通道 | 原因 |
|---|---|---|
| **模型配置管理** | `desktop:save-my-drsai-model-provider`, `desktop:test-my-drsai-model-provider`, `desktop:diagnose-my-drsai-model-connection` 等 | V2 从 catalog 直接选模型，不再走 provider 配置 |
| **Skills 管理** | `desktop:list-installed-skills`, `desktop:install-skill`, `desktop:uninstall-skill`, `desktop:update-skill`, `desktop:reload-skills` 等 | 内置 skills 随 agent 加载，无管理 UI |
| **GFS 对象存储** | `desktop:gfs-list`, `desktop:gfs-stat`, `desktop:gfs-read`, `desktop:gfs-write`, `desktop:gfs-upload-file` 等 9 条 | gateway 从未挂载 gfs 路由 |
| **远程工作区** | `desktop:workspace-git-diff`, `desktop:workspace-git-file-at-ref`, `desktop:workspace-stage-file`, `desktop:workspace-revert-file`, `desktop:workspace-stage-hunk`, `desktop:workspace-revert-hunk` 等 | V2 工作区只保留 list/open/files/file 4 条路由 |
| **检查点管理** | `desktop:workspace-checkpoints-list`, `desktop:workspace-checkpoint-create`, `desktop:workspace-checkpoint-accept`, `desktop:workspace-checkpoint-preview`, `desktop:workspace-checkpoint-restore` | V2 无对应路由 |
| **移动配对** | `desktop:mobile-pairing-readiness`, `desktop:mobile-pairing-create`, `desktop:mobile-pairing-revoke` | V2 无对应路由 |
| **终端** | `desktop:terminal-*` (7 条) | V2 无对应路由 |
| **自动化/工作流** | `desktop:workflow-*`, `desktop:background-task-*`, `desktop:scheduled-task-*` | V2 无对应路由 |
| **连接适配器** | `desktop:channel-adapter-*`, `desktop:wechat-*` | V2 无对应路由 |
| **分享** | `desktop:thread-share-*`, `desktop:object-share-*`, `desktop:share-comment-*` | V2 无对应路由 |
| **远程访问** | `desktop:ssh-host-*`, `desktop:remote-gateway-*`, `desktop:remote-workspace-*` | V2 无对应路由 |
| **诊断** | `desktop:diagnostics-*` | V2 无对应路由 |
| **演示文稿** | `desktop:presentation-*` | V2 无对应路由 |
| **Codex 后端** | `desktop:restart-codex-backend`, `desktop:sync-codex-workspace-sessions`, `desktop:get-codex-backend-status`, `desktop:start-codex-backend-login` | V2 无对应路由 |
| **运行检查** | `desktop:run-list`, `desktop:run-inspection`, `desktop:run-item-locator`, `desktop:run-manifest` | V2 无对应路由 |
| **信任审批** | `desktop:propose-approval`, `desktop:pending-approvals`, `desktop:decide-approval`, `desktop:shell-command-approval`, `desktop:git-commit-approval` | V2 无对应路由 |
| **自定义配置** | `desktop:custom-command-*`, `desktop:project-memory-*`, `desktop:project-skills-*` | V2 无对应路由 |
| **资源订阅** | `desktop:conversation-resource-subscription-start` | V2 用 SSE 事件流替代 |

### 2.4 需要保留的 IPC handler（对应 V2 的 16 条路由 + 纯本地功能）

#### 对应 V2 路由的 IPC 通道

| V2 路由 # | IPC 通道 | 旧版调用位置 | 说明 |
|---|---|---|---|
| 1 | `desktop:bootstrap` → `desktop:get-health` | `registerPlatformIpc.ts` | bootstrap 时探测 `/v1/runtime` |
| 2 | `desktop:create-session` | `registerExecutionIpc.ts` | `POST /v1/sessions` |
| 3 | `desktop:list-threads` | `registerCatalogIpc.ts` | `GET /v1/sessions?workspace_id=` |
| 4 | `desktop:get-session` | `registerExecutionIpc.ts` | `GET /v1/sessions/{id}` |
| 5 | `desktop:update-session` | `registerExecutionIpc.ts` | `PATCH /v1/sessions/{id}` |
| 6 | `desktop:get-session-snapshot` | `registerExecutionIpc.ts` | `GET /v1/sessions/{id}/oaep-snapshot` |
| 7 | `desktop:get-session-events` | `registerExecutionIpc.ts` | `GET /v1/sessions/{id}/oaep-events` |
| 8 | `desktop:start-chat` → SSE 事件流 | `registerExecutionIpc.ts` | `GET /v1/sessions/{id}/oaep-events/stream` |
| 9 | `desktop:start-chat` / `desktop:start-agent-run` | `registerExecutionIpc.ts` | `POST /v1/sessions/{id}/runs` |
| 10 | `desktop:start-chat` → execute | `registerExecutionIpc.ts` | `POST /v1/runs/{run_id}/execute` |
| 11 | `desktop:cancel-chat-turn` / `desktop:abort-agent-run` | `registerExecutionIpc.ts` | `POST /v1/runs/{run_id}/cancel` |
| 12 | `desktop:get-runtime-model-catalog` | `registerCatalogIpc.ts` | `GET /v1/config/model-catalog` |
| 13 | `desktop:list-workspaces` | `registerCatalogIpc.ts` | `GET /v1/workspaces` |
| 14 | `desktop:create-workspace` | `registerCatalogIpc.ts` | `POST /v1/workspaces` |
| 15 | `desktop:workspace-files` | `registerWorkspaceIpc.ts` | `GET /v1/workspaces/{id}/files`（旧版用本地 fs，V2 改走 gateway） |
| 16 | `desktop:workspace-file-preview` | `registerWorkspaceIpc.ts` | `GET /v1/workspaces/{id}/file`（旧版用本地 fs，V2 改走 gateway） |
| 17 | `desktop:voice-transcription-start` | `registerVoiceIpc.ts` | `POST /v1/audio/transcriptions` |

#### 纯本地功能（不需要 gateway 路由，直接保留）

| IPC 通道 | 说明 |
|---|---|
| `desktop:get-auth-session` | 读取本地 `auth.json` |
| `desktop:start-oidc-login` | PKCE 流程，本地回环回调服务器 |
| `desktop:cancel-oidc-login` | 中止本地 HTTP 服务器 |
| `desktop:refresh-auth-session` | 远程 IdP 刷新令牌 |
| `desktop:logout` | 清除本地会话 + 可选撤销令牌 |
| `desktop:login` | HepAI 门户登录（远程 API） |
| `desktop:restart-application` | `app.relaunch()` |
| `desktop:clipboard-copy-text` | Electron 剪贴板 |
| `desktop:open-external` | `shell.openExternal()` |
| `desktop:open-path` | `shell.openPath()` |
| `desktop:open-log-folder` | 打开日志目录 |
| `desktop:check-for-updates` 等 | Electron 自动更新 |
| `desktop:local-data-cleanup-preview` / `desktop:local-data-cleanup` | 本地数据清理 |
| `desktop:respond-chat-input` | 后续输入（如审批回复） |
| `desktop:chat-event` | 事件推送（`BoundedEventDispatcher`） |

---

## 3. 前端 IPC → 后端路由的完整对接关系

### 3.1 认证链路（0 条 gateway 路由）

```
用户点击登录按钮 (Sidebar/LoginScreen.tsx)
  ↓ ipcRenderer.invoke("desktop:start-oidc-login")
[Main] auth.ts: startOidcLogin()
  ├── 创建本地回环 HTTP 服务器 (PKCE)
  ├── shell.openExternal(authorizationURL)  → 浏览器打开 IdP 登录页
  ├── 等待回调 → 交换 token
  └── 存储 token 到 OS 凭据库 (auth.json)
  ↓ ipcRenderer.invoke("desktop:get-auth-session")
[Main] auth.ts: getAuthSession() → 读取 auth.json → 返回 AuthContext
  ↓ 渲染进程渲染用户信息
```

**Gateway 的角色**：仅中间件逐请求校验 Bearer 令牌，不参与登录流程。

### 3.2 聊天执行链路（路由 #8, #9, #10, #11）

```
用户发送消息 (ChatInput.tsx)
  ↓ ipcRenderer.invoke("desktop:start-chat", { workspaceId, message })
[Main] chat.ts: startChat()
  ├── runtimeClient.createSession()           → POST /v1/sessions          (#2)
  ├── runtimeClient.createAgentRun()           → POST /v1/sessions/{id}/runs (#9)
  ├── runtimeClient.executeAgentRun()          → POST /v1/runs/{id}/execute (#10)
  ├── runtimeClient.openOaepEventStream()      → GET  /v1/sessions/{id}/oaep-events/stream (#8)
  └── SSE 事件 → BoundedEventDispatcher → ipcRenderer.emit("desktop:chat-event")
  ↓
[Renderer] ipcRenderer.on("desktop:chat-event") → UI 渲染流式 token

用户点击停止
  ↓ ipcRenderer.invoke("desktop:cancel-chat-turn")
[Main] chat.ts: cancelChatTurn()
  └── runtimeClient.cancelAgentRun()           → POST /v1/runs/{id}/cancel  (#11)
```

### 3.3 会话管理链路（路由 #2~#8）

```
历史会话列表 (Sidebar/ThreadList.tsx)
  ↓ ipcRenderer.invoke("desktop:list-threads", { workspaceId })
[Main] runtimeClient.listSessions()             → GET /v1/sessions?workspace_id=  (#3)

打开历史会话
  ↓ ipcRenderer.invoke("desktop:get-session", { sessionId })
[Main] runtimeClient.getSession()               → GET /v1/sessions/{id}          (#4)
  ↓ ipcRenderer.invoke("desktop:get-session-snapshot", { sessionId })
[Main] runtimeClient.getOaepSnapshot()          → GET /v1/sessions/{id}/oaep-snapshot (#6)
  ↓ ipcRenderer.invoke("desktop:get-session-events", { sessionId, afterSequence })
[Main] runtimeClient.listOaepEvents()           → GET /v1/sessions/{id}/oaep-events (#7)

重命名/归档
  ↓ ipcRenderer.invoke("desktop:update-session", { sessionId, updates })
[Main] runtimeClient.updateSession()           → PATCH /v1/sessions/{id}        (#5)
```

### 3.4 工作区链路（路由 #13~#16）

```
工作区列表
  ↓ ipcRenderer.invoke("desktop:list-workspaces")
[Main] runtimeClient.listWorkspaces()           → GET /v1/workspaces             (#13)

打开工作区
  ↓ ipcRenderer.invoke("desktop:create-workspace", { path })
[Main] runtimeClient.openWorkspace()             → POST /v1/workspaces            (#14)

文件视图 (FileTree.tsx)
  ↓ ipcRenderer.invoke("desktop:workspace-files", { workspaceId })
[Main] workspaceContext.listWorkspaceFiles()     → 旧版：本地 fs.readdir
                                                  → V2：GET /v1/workspaces/{id}/files (#15)

文件预览
  ↓ ipcRenderer.invoke("desktop:workspace-file-preview", { workspaceId, path })
[Main] workspaceContext.previewWorkspaceFile()  → 旧版：本地 fs.readFile
                                                  → V2：GET /v1/workspaces/{id}/file  (#16)
```

> **架构变更点**：旧版工作区文件操作直接用 Node.js `fs` API 读本地文件系统。V2 将这些操作路由到 gateway（`/v1/workspaces/{id}/files` 和 `/v1/workspaces/{id}/file`），支持远程工作区。迁移时需要将 `workspaceContext.ts` 中的本地 fs 调用改为通过 `runtimeClient` 调用 gateway 路由。

### 3.5 模型选择链路（路由 #12）

```
模型选择器 (ModelSelector.tsx)
  ↓ ipcRenderer.invoke("desktop:get-runtime-model-catalog")
[Main] myDrSaiConfig.readRuntimeModelCatalog()  → GET /v1/config/model-catalog  (#12)
  ↓ 返回 [{ alias, display_name, client_type, model, token_limit, max_tokens, vision }]

用户选择模型 → 作为 execute 请求体的 alias 传入
  ↓ POST /v1/runs/{id}/execute  body: { ..., model_alias: "..." }
```

### 3.6 语音输入链路（路由 #17）

```
录音结束 (VoiceInput.tsx)
  ↓ ipcRenderer.invoke("desktop:voice-transcription-start", { audioBlob })
[Main] voice.ts: transcribeThroughGateway()
  └── POST /v1/audio/transcriptions  FormData: { file, model, language? }  (#17)
  ↓ 返回转录文本 → 填入输入框
```

### 3.7 Gateway HTTP 调用层

主进程通过两条路径调用 gateway：

| 调用路径 | 函数 | 用途 | 认证头 |
|---|---|---|---|
| `LocalRuntimeClient.request()` | `fetch(baseUrl + path, { headers, signal })` | 16 条 V2 路由中的 14 条 | `getAuthenticatedGatewayRequestHeaders()` |
| `gatewayRequest(baseUrl, method, path)` | `fetch(baseUrl + path, { method, headers, body })` | model-catalog (#12) | `getGatewayRequestHeaders()` + Bearer |
| `transcribeThroughGateway()` | `fetch(baseUrl + "/v1/audio/transcriptions", ...)` | audio (#17) | `getGatewayRequestHeaders()` + Bearer |

**认证头构建**：

```typescript
// 仅实例令牌（健康检查、模型发现）
getGatewayRequestHeaders() → {
  "X-OpenDrSai-Gateway-Token": GATEWAY_INSTANCE_TOKEN  // 从 $DRSAI_HOME/runtime/instance-token 读取
}

// 实例令牌 + OIDC Bearer（所有需认证的路由）
getAuthenticatedGatewayRequestHeaders() → {
  "X-OpenDrSai-Gateway-Token": GATEWAY_INSTANCE_TOKEN,
  "Authorization": "Bearer ${accessToken}",
  "X-OpenDrSai-Auth-Mode": "oidc",
  "X-OpenDrSai-Principal": userId
}
```

---

## 4. 迁移步骤

### 步骤 1：清理错误的 V2 代码

删除 `apps/desktop/` 下当前错误的极简迁移代码：
- `apps/desktop/shared/api/desktopGateway/` — 错误的 bridge 层
- `apps/desktop/shared/renderer/src/workbench/` — 错误的极简 UI
- `apps/desktop/shared/main/desktopGateway.ts` — 错误的 gateway 桥接
- `apps/desktop/windows/src/preload/` 中的 `drsai` bridge 暴露

### 步骤 2：复制旧版代码

```
apps/desktop_legacy/shared/    →  apps/desktop/shared/
apps/desktop_legacy/windows/   →  apps/desktop/windows/
```

保留以下已修复的文件（如它们比旧版更正确）：
- `apps/desktop/shared/api/window.d.ts` — 已修复为可选 `drsai?`

### 步骤 3：修改 gateway 端口和模块路径

在 `apps/desktop/shared/main/gatewayEnvironment.ts` 中：

```typescript
// 旧版
DEVELOPMENT_GATEWAY_PORT = "28642"
PRODUCTION_GATEWAY_PORT = "18642"

// V2
DEVELOPMENT_GATEWAY_PORT = "28643"
PRODUCTION_GATEWAY_PORT = "28643"  // V2 统一端口
```

在 `apps/desktop/shared/main/gateway.ts` 中修改 gateway 进程启动参数，指向 `desktop_gateway.app:app`。

### 步骤 4：裁剪不需要的 IPC handler

按照 §2.3 的清单，删除或注释掉对应被砍掉路由的 `secureHandle` / `ipcMain.handle` 注册。

**注意**：删除 IPC handler 时需要同步删除 renderer 中对相应 `window.openDrSai.*` 方法的调用，否则会导致运行时错误。建议按模块逐步裁剪。

### 步骤 5：工作区文件操作迁移到 gateway

将 `workspaceContext.ts` 中的本地 `fs.readdir` / `fs.readFile` 调用改为通过 `runtimeClient` 调用：
- `listWorkspaceFiles()` → `GET /v1/workspaces/{id}/files`
- `previewWorkspaceFile()` → `GET /v1/workspaces/{id}/file`

### 步骤 6：验证

1. `tsc --noEmit` 通过
2. `electron-vite build` 成功
3. `dev` 启动后 OIDC 登录正常
4. 聊天发送/取消/历史/模型选择/语音输入/文件预览 功能正常
5. gateway 端口为 28643

---

## 5. 端口与进程对照

| 项 | 旧版 | V2 |
|---|---|---|
| Gateway 端口 (dev) | `28642` | `28643` |
| Gateway 端口 (prod) | `18642` | `28643` |
| Gateway 模块 | `gateway_legacy.py:app` | `desktop_gateway.app:app` |
| Gateway 路由数 | ~42 | 16 (+1 SSE stream) |
| IPC 架构 | `window.openDrSai` → `secureHandle` → HTTP | **不变** |
| Preload 暴露 | `contextBridge.exposeInMainWorld("openDrSai", ...)` | **不变** |
| 认证存储 | OS 凭据库 `auth.json` | **不变** |
| OIDC 登录路由 | 0 条 | 0 条 |

---

## 6. 渲染进程直连 Runtime 的铁律冲突

V2 spec 提到一个铁律冲突：

> token 在主进程，渲染进程直连就拿不到。必须二选一——要么渲染进程走主进程代理（放弃直连），要么主进程把短时令牌下发给渲染进程（多一套令牌生命周期）。

**本方案选择前者**：渲染进程继续走主进程代理（`ipcRenderer.invoke` → `secureHandle` → `fetch` gateway）。这与旧版架构完全一致，不需要额外的令牌生命周期管理。

理由：
1. 旧版 IPC 架构已经验证了"渲染进程 → 主进程代理 → gateway"模式的安全性和可靠性
2. 避免引入短时令牌下发机制带来的额外复杂度
3. V2 的核心收益是缩减后端路由（42→16），不是改变前端架构
