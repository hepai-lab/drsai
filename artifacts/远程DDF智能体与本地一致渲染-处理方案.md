# 远程 DDF 智能体与本地一致渲染 —— 处理方案

> 目标：在 Desktop 右侧「广场-智能体 → 官方平台智能体」中选中一个远程 DDF 智能体并发起对话时，
> 其输出的渲染与本地智能体**完全一致**（同样的 markdown/推理/工具/文件/计划/artifact 富组件）。
>
> 结论（当前状态）：**后端代理已就绪，前端接入尚未完成 —— 目前仍无法一致渲染。**

---

## 一、目标架构（唯一正确形态）

```
Desktop 渲染层
  └─ IPC desktop:chat → chat.ts: startChat → runChat
        └─ POST 本地 Gateway(28643) /v1/sessions/{id}/runs  { agent_definition: "remote-worker@1" }
              └─ RuntimeAgentService 按 definition.backend 分派
                    ├─ "opendrsai"     → DesktopAgentBackend   → DrSaiAssistant      (本地)
                    └─ "remote-worker" → RemoteWorkerBackend   → HepAIWorkerAgent    (远程 DDF worker)
                                             │
                                             └─ translate_conversation_event() + services.emit()
                                                ↑ 与本地**同一个**事件翻译器、同一个 emit 干线
        └─ OAEP 事件流（structured）→ 同一套 StructuredMessageParts 富渲染
```

**核心原则**：差异全部收敛在后端 `AgentBackend`，前端只认一套 OAEP 事件，**零远程分支**。
DDF/HepAI 凭据与 worker 路由只留在后端，前端不接触。

---

## 二、现状盘点

### 2.1 已完成（后端 desktop_gateway）

| 文件 | 内容 |
|---|---|
| `cores/python/.../backend/desktop_gateway/_remote_worker_backend.py`（新增） | `RemoteWorkerBackend`（backend_id=`remote-worker`），实现 `AgentBackend` 协议；内部以 `HepAIWorkerAgent` 代理远程 worker，复用 `drsai.backend.events.agent_event_translator.translate` + `services.emit()`，产出与本地**逐字一致**的事件 |
| `cores/python/.../backend/desktop_gateway/_remote_worker_catalog.py`（新增） | 服务端远程 worker 目录（DDF `/agents/list_agents` + `/worker/unified_gate get_info`） |
| `cores/python/.../backend/desktop_gateway/routes/remote_workers.py`（新增） | `GET /v1/remote-workers`、`POST /v1/remote-workers/select`、`GET /v1/remote-workers/status` |
| `_state.py` | 注册双 backend（`opendrsai`、`remote-worker`）、`allowed_backends`、种子 `remote-worker@1` 定义、`write_remote_worker_definition()` |
| `app.py` | 挂载 `remote_workers.router` |
| `routes/runs.py` | `run_create` 支持 `agent_definition=remote-worker@1`（未知引用 422 兜底） |

已验证：AST、模块导入、OpenAPI 路由注册、隔离自测 10/10 通过。

### 2.2 已回退（前端旧尝试，未采用）

上一轮的前端"远程专属分支"（`chat.ts` 的 `readRemoteSse`、`remotePresentationProjector.ts`、`sseParser` 远程解析、catalog 能力改动）
已 `git stash` 存档（`stash@{0}`），工作区已干净。**该方向被否决**（前端不该感知远程）。

### 2.3 尚未完成（缺口 — 导致当前无法一致渲染）

| 缺口 | 说明 |
|---|---|
| **前端 `chat.ts` 未接入新路由** | 命中平台智能体时仍走旧的 `platformDescriptor` 分支 → **直连 `getPlatformAgentChatUrl()`（DDF `/apiv2/chat/completions`）** → `readSse` 纯文本解析，**未经过** 新的 `remote-worker` backend |
| **前端未调用 `POST /v1/remote-workers/select`** | 选中 DDF 智能体时未把 worker 绑定成 `remote-worker@1` 定义 |
| **Run 请求未携带 `agent_definition`** | 前端发起 Run 时未传 `agent_definition: "remote-worker@1"`，后端只会用默认 `opendrsai@1` |
| **旧直连分支未移除/旁路** | `chat.ts` 的 `platformDescriptor` 分支仍在，与新路径并存 |

> 证据：`apps/desktop/shared/main/chat.ts` 中无任何 `/v1/remote-workers`、`remote-worker`、`agent_definition` 的调用
> （仅有一处无关的诊断字段名 `agent_definition_id`）。

---

## 三、待执行方案（前端接入）

### 步骤 1：广场选中远程智能体 → 绑定 worker

- 在「广场-智能体」选中 DDF 智能体、"开始使用"时，调用本地 Gateway：
  ```
  POST {gateway}/v1/remote-workers/select
  body: { "worker": "<DDF 可路由 worker 名>", "url"?: "...", "model"?: "..." }
  → { "agent_definition": "remote-worker@1", "backend": "remote-worker", "worker": "..." }
  ```
- 结果缓存在会话/前端状态，供发起 Run 时使用。
- 目录来源：优先 `GET {gateway}/v1/remote-workers`（服务端代理，凭据不外泄），替代前端直连 DDF 取目录。

### 步骤 2：发起 Run 走本地 Gateway + `agent_definition`

- `chat.ts: runChat` 的远程分支改为：
  - **不再** `fetch(getPlatformAgentChatUrl(...))` 直连 DDF；
  - 改为与本地一致：`runRuntimeBackendChat(...)`（本地 Gateway OAEP 管线），
    并在 `createAgentRun` / Run 请求中携带 `agent_definition: "remote-worker@1"`。
- 后端 `run_create` 已支持该字段 → 分派到 `RemoteWorkerBackend` → `HepAIWorkerAgent` 代理。

### 步骤 3：移除/旁路旧直连分支

- 删除或短路 `chat.ts` 中 `platformDescriptor` → `getPlatformAgentChatUrl` → `readSse` 的旧平台聊天分支。
- `agents.ts` 的 `getPlatformAgentChatUrl` / `isPlatformAgentExecutionAvailable` 相应退役或改为"是否可作 remote-worker 代理"。
- 取消/输入回传：远程 Run 的取消走 Runtime 的 `cancelAgentRun`（`RemoteWorkerBackend.cancel` → 取消 `HepAIWorkerAgent`），
  与本地一致；旧 `stopPlatformChat` / `respondToDdfChatInput` 相应收敛。

### 步骤 4：目录与隐私

- 前端只调本地 Gateway 的 `/v1/remote-workers*`；DDF api_key 永不进入前端。
- 附件沿用本地 `stageAttachments` 语义（前端无需为远程单列）。

---

## 四、验收标准

1. 在广场选中 DDF 智能体发起对话，**渲染与本地智能体同构**：
   markdown 正文、推理折叠、工具/文件时间线、计划进度、artifact 卡片均正常。
2. 前端代码路径中**不存在**"远程专属渲染/解析分支"（无 `readRemoteSse` 类实现）。
3. Run 的 `agent_definition` 为 `remote-worker@1`，后端分派到 `RemoteWorkerBackend`。
4. 取消、错误恢复、消息持久化行为与本地一致。
5. DDF 凭据仅存在于后端；前端网络请求不含 DDF url/api_key。

---

## 五、关键文件索引

| 关注点 | 文件 |
|---|---|
| 后端远程 backend | `cores/python/.../backend/desktop_gateway/_remote_worker_backend.py` |
| 后端 remote worker 目录 | `cores/python/.../backend/desktop_gateway/_remote_worker_catalog.py` |
| 后端 remote worker 路由 | `cores/python/.../backend/desktop_gateway/routes/remote_workers.py` |
| 后端注册/种子 | `cores/python/.../backend/desktop_gateway/_state.py` |
| 路由挂载 | `cores/python/.../backend/desktop_gateway/app.py` |
| Run 创建（definition 选择） | `cores/python/.../backend/desktop_gateway/routes/runs.py` |
| 共享事件翻译器 | `cores/python/.../backend/events/agent_event_translator.py`（`translate` / `TurnState`） |
| 本地 backend 参照 | `cores/python/.../backend/desktop_gateway/_agent_backend.py` |
| 远程 agent 实现参照 | `cores/python/.../modules/agents/drsai_worker_agent.py`（`HepAIWorkerAgent`） |
| 参考调用 | `apps/webui/backend/src/drsai_ui/agent_factory/magentic_one/task_team.py`（`:537`） |
| **前端待改**：chat 分支 | `apps/desktop/shared/main/chat.ts`（`runChat` 平台分支） |
| **前端待改**：平台目录/地址 | `apps/desktop/shared/main/agents.ts`（`getPlatformAgentChatUrl` / `isPlatformAgentExecutionAvailable`） |
| 前端渲染适配 | `apps/desktop/shared/renderer/src/adapters/useDesktopChatAdapter.ts` |
| 富组件 | `apps/desktop/shared/renderer/src/components/StructuredMessageParts.tsx` |

---

## 六、风险与注意事项

1. **并行重构**：仓库中 `event_translator` 正被从 `tui_gateway/adapter/` 迁移到 `backend/events/agent_event_translator.py`
   （非本方案改动）。本方案的前端接入开工前，需确认该共享事件层路径/符号已稳定，避免半迁移状态被一起提交。
2. **前端移除旧分支**需回归测试：确保"本地智能体"路径不受影响（旧 `platformDescriptor` 分支可能被其它入口引用）。
3. **多远程 worker 场景**：当前 `remote-worker@1` 为单一模板，`select` 覆盖同一资产文件；
   若需并发多个不同 worker，应扩展为按 worker 名生成独立定义版本。

---

## 七、一句话总结

后端已把"远程 DDF 智能体"做成 `desktop_gateway` 的独立 `remote-worker` backend（代理 `HepAIWorkerAgent` + 复用本地同款事件翻译与 emit），
**但前端 `chat.ts` 仍未接入**——目前点广场里的 DDF 智能体走的还是旧的"直连 DDF + 纯文本"分支，**因此渲染尚不一致**。
完成本文档第三节（前端接入 + 移除旧分支）后，远程智能体才会与本地一样正常渲染。
