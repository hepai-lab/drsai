# Desktop V2 重构：架构框架与 Runtime v1 接口契约

- 分支：`feature/desktop-v2`（自 `feature/desktop` 切出）
- 状态：范围已确认，M0 进行中
- 日期：2026-08-25
- 相关：[gateway 冻结与退役方案](gateway-freeze-and-retirement.zh-CN.md)

---

## 1. 背景：为什么必须重建而不是继续加功能

对现有 `feature/desktop` 的实测规模：

| 层 | 规模 |
|---|---|
| `backend/gateway.py`（现 `gateway_legacy.py`） | 14,210 行，**257 个 HTTP 路由**<br>删除死路由后为 13,083 行 / 211 条 |
| `RuntimeClient` 接口（`apps/desktop/shared/main/runtimeClient.ts:439`） | **约 90 个方法** |
| Electron 主进程 IPC（`apps/desktop/windows/src/main/index.ts`） | **432 个 channel**，7,229 行 |
| 渲染层门面 `apps/desktop/shared/api/desktopApi.ts` | 6,209 行，452 个方法 |
| desktop TypeScript 总量 | 约 230,000 行 |

**结论：膨胀的根因不是功能多，是同一件事被定义了四遍。**

```
一个功能 = 1 个 HTTP 路由
         + 1 个 RuntimeClient 方法
         + 1 个 IPC channel（main 侧 handle + preload 侧 invoke）
         + 1 个 desktopApi 方法
         + 1 个 renderer hook
```

任何"只做最小功能"的重建，如果保留这个四层结构，半年内一定回到 400 个 channel。**V2 的第一目标是拆掉这个乘数，而不是砍功能列表。**

---

## 2. 目标与非目标

### 2.1 目标（本阶段交付的功能）

| 编号 | 功能 | 说明 |
|---|---|---|
| 1 | OIDC 登录 | HepAI OIDC，登录身份决定历史归属 |
| 2.1 | 新建会话 | |
| 2.2 | 历史会话列表 | |
| 2.3 | 工作区文件视图 | Agent 产出的结果文件 |
| 2.4 | 个人信息（折叠） | 纯 UI |
| 2.5 | 工作区 ↔ 会话归属 | |
| 3.1 | 流式聊天 | |
| 3.2 | 模型选择 | 仅"选"，不做 provider 配置 CRUD |
| 3.3 | 会话状态显示 | 运行中 / 等待 / 完成 / 失败 |
| 3.4 | 语音输入 | 仅 STT，能力位门控；TTS 与实时双工不做 |
| 4.1 | 右侧栏文件预览 | |

### 2.2 保留的能力组与端点收敛

除上表的界面功能外，以下 10 项后端能力需在 V2 中继续可用。它们覆盖现有网关 151/211 条路由，收敛为 **42 个端点**（按「方法 + 路径」计）：

| # | 能力组 | 现有路由 | V2 端点 | 契约分组 | 收敛掉的内容 |
|---|---|---|---|---|---|
| 1 | 鉴权 | 10 | 4 | A | 细粒度授权审计、remote handshake |
| 2 | 配置持久化 | 19 | 5 | F | agents/tools/env/cli/platforms 各自的 CRUD |
| 3 | 运行时 | 28 | 6 | B | goal propose/confirm、diagnostics、side-effects |
| 4 | 模型切换 | 23 | 2 | E | provider CRUD、能力探针、doctor、两套别名系统 |
| 5 | 工作区 | 38 | 5 | D | git 9 + worktrees 8 + checkpoints 4 + watch/permissions |
| 6 | session | 20 | 7 | C | legacy conversation 双路径、backend 绑定同步 |
| 7 | skills | 8 | 3 | G | preview/reload |
| 8 | 语音输入 | 2 | 1 | I | 实时 WS 双工 |
| 9 | gfs | **0** | 9 | H | 见下 |
| 10 | 网络检索 | 4 | **0** | — | 表达为 `tool_call`，不需要端点 |
| | **合计** | **151** | **42** | | |

**保留能力 ≠ 保留路由。** 差额来自现有网关的分层冗余：两套模型别名系统（`/v1/models/config*` 在代码中已标 `deprecated=True`）、provider 配置的完整管理面、git/worktree/checkpoint 操作面、threads 与 sessions 双套会话路径。

> **gfs 是新工作，不是保留。** `backend/gfs_api.py` 定义了 9 条路由但当前网关从未挂载，live app 的 OpenAPI 中 gfs 为 0 条。实际在用的是 `apps/webui`，走 API key 直连外部服务。V2 接入需从零验证鉴权传递与 personal mode 判定。

### 2.3 非目标（本阶段明确不做）

- run 实验、replay、run 对比、adoption（`/v1/experiments`、`/v1/replay-plans`、`/v1/run-comparisons`）
- 移动端配对、Relay 远程接入（`/v1/mobile-pairing/*`）
- worktree / git 操作面板、checkpoint
- PTY / 终端
- 知识库端点（`/v1/config/knowledge-bases/*`）—— **实现完整保留**在 `backend/runtime/`（分块、sqlite-vec 向量检索、embedding provider 接口），仅暂不暴露端点
- Kanban、Cronjob、WeChat 通道、feedback、memory
- model provider 配置、能力探针、模型迁移
- 实时双工语音（`/v1/audio/transcriptions/stream`、`/v1/audio/duplex`）
- 多 Agent 定义选择 UI（后端保留 adapter seam，前端 v1 固定单一 Agent）

**非目标不等于永远不做。判定标准是：它能否在不改 Runtime v1 契约的前提下后加。** 见 §9 扩展点。

---

## 3. 架构总览

### 3.1 分层

```
┌───────────────────────────────────────────────────────────┐
│  Renderer（唯一的业务层）                                  │
│    features/  auth · sidebar · chat · workspace · preview  │
│    store/     snapshot + event reducer（单一事实来源）      │
│    runtime/   RuntimeClient：42 个方法，与端点 1:1          │
└──────────────┬──────────────────────┬─────────────────────┘
               │ HTTP + SSE           │ IPC（≤15 channel）
               │ （业务全部走这里）    │ （仅 native 能力）
               ▼                      ▼
┌──────────────────────────┐  ┌──────────────────────────────┐
│  DrSai Runtime (Python)  │  │  Electron Main               │
│    42 个 v1 端点          │  │   窗口/托盘、OIDC 交互登录、 │
│    OAEP 事件流           │  │   文件对话框、runtime 进程   │
│    Agent Kernel          │  │   生命周期、自动更新         │
│      └ DrSaiAssistant    │  │   （不含任何业务逻辑）       │
└──────────────────────────┘  └──────────────────────────────┘
```

### 3.2 三条铁律

> **铁律一：渲染进程直连 Runtime。**
> 业务请求一律走 `http://127.0.0.1:<port>`，不经过 IPC 转发。主进程只在启动时通过 `app:runtime-endpoint` 一次性下发 `{ baseUrl, token }`。IPC channel 数量**硬上限 15 个**，超出需要架构评审。

> **铁律二：只有一条事件流，UI 状态必须可从 `snapshot + events` 重放。**
> 不存在 run 级事件流（现有代码 `/v1/runs/{id}/events` 与 `/v1/sessions/{id}/oaep-events/stream` 并存是复杂度主源）。任何"只在内存里、重放不出来"的 UI 状态都是 bug。

> **铁律三：新功能优先表现为新的 item 类型或 tool_call，而不是新端点。**
> 新增 v1 端点需要架构评审。这是"可扩展"三个字在本架构里的唯一落点。

### 3.3 复用与隔离

**复用（不重写）：**

| 资产 | 路径 | 说明 |
|---|---|---|
| OAEP 事件协议 | `cores/protocol/oaep/oaep.schema.json` | **唯一真源**，TS 类型继续 codegen |
| 错误契约 | `.../backend/runtime/error_contract.py` | 类别 + 恢复动作模型直接沿用 |
| Agent Kernel | `.../modules/agents/skills_agent/` 的 `DrSaiAssistant` | 作为默认 backend adapter |
| 资源操作语义 | `cores/protocol/owop/owop.schema.json` | v1 只取 `files.list` / `files.read` / `resources.preview` 三个语义，不引入 OWOP 全量传输层 |

**隔离（新代码不得依赖）：**

- 不 `import` `backend/gateway_legacy.py`（会把 211 条路由顺着依赖链拖回来）。该模块已冻结，见[退役方案](gateway-freeze-and-retirement.zh-CN.md)
- 不复用 `apps/desktop/shared/main/*`、`apps/desktop/shared/api/desktopApi.ts`
- 不复用 `apps/desktop/windows/src/main/index.ts`

新代码落位：

```
cores/python/packages/drsai/src/drsai/backend/desktop_v2/    # 薄门面，独立 FastAPI app
apps/desktop-v2/
  protocol/     # 由 cores/protocol 生成，禁止手改
  main/         # Electron 主进程
  renderer/     # 全部业务
```

---

## 4. 领域模型

```
User (OIDC sub)
 └── Workspace          一个本地目录 + 一组会话
      └── Session       一次连续对话（= UI 上的"任务"）
           └── Run      一次用户输入触发的执行
                └── Item   message / reasoning / tool_call / artifact / notice
```

### 4.1 三个必须现在定死的决定

**决定 1：不区分"任务"和"会话"。**
手稿中 2.1 写作"新建任务/会话"。v1 只有 Session 一个概念，一个 Session 下多个 Run 已足够表达"历史任务"。单独建模 Task 会立刻逼出"任务和会话谁包含谁"这个没有正确答案的问题。

**决定 2：`user_id` 从第一条 commit 起就是 Session / Workspace 表的一等主键。**
现有代码里的 `/v1/identity/canonicalize` 和 `/v1/migrations/legacy-desktop-agent-runs` 就是这件事定晚了留下的疤。V2 不重蹈。

**决定 3：默认工作区隐式存在。**
Runtime 保证 `GET /v1/workspaces` 至少返回一个默认工作区（`$DRSAI_HOME/workspaces/default`）。用户"新建会话"不需要先建工作区——否则最小版本的第一步就是一个多余的仪式。

---

## 5. Runtime v1 接口契约

**共 42 个端点**（按「方法 + 路径」计）。 分组字母对应 §2.2 表的「契约分组」列。

约定：

- 全部 `Content-Type: application/json`，除上传（multipart）与音频。
- 认证：`Authorization: Bearer <runtime_token>`（`A1`、`B1` 除外）。
- 所有失败响应遵循 §7 错误契约。
- 能力位门控的端点，前端必须依据 `B2` 的返回降级，不得用版本号硬编码判断。

### A. 鉴权（4）— 能力组 1

交互式 OIDC 由 Electron 主进程完成（授权码 + PKCE 或设备码），Runtime 只接收 `id_token`，用 JWKS 验签后取 `sub` 作 `user_id`，签发自己的不透明 token。**HepAI 的 access_token 不进入 Runtime**（沿用现有安全边界）。

| | 端点 | 说明 |
|---|---|---|
| A1 | `POST /v1/auth/session` | 无需认证。`{id_token}` → `{runtime_token, expires_at, user:{user_id, display_name, email, avatar_url}}` |
| A2 | `GET /v1/auth/me` | 当前身份（手稿 2.4 个人信息） |
| A3 | `POST /v1/auth/refresh` | 续期，返回新 `runtime_token` |
| A4 | `POST /v1/auth/logout` | 吊销当前 token |

> `user_id` 从第一条 commit 起就是 Session / Workspace 表的一等主键，见 §4.1 决定 2。

### B. 运行时与运行（6）— 能力组 3

| | 端点 | 说明 |
|---|---|---|
| B1 | `GET /v1/runtime` | 无需认证。`{runtime_id, instance_id, version, protocol_version:"drsai-desktop/1", oaep_version:"1.0", oaep_profile}`。版本不匹配时 UI 必须提示更新而非白屏 |
| B2 | `GET /v1/capabilities` | `{capabilities:[...], item_types:[...]}`，前端降级依据 |
| B3 | `POST /v1/sessions/{session_id}/runs` | **202** `{run_id, status:"queued"}`，见下 |
| B4 | `GET /v1/runs/{run_id}` | 运行状态（手稿 3.3） |
| B5 | `POST /v1/runs/{run_id}/cancel` | → `{run_id, status:"cancelled"}` |
| B6 | `POST /v1/runs/{run_id}/interactions/{item_id}` | `{response}` → `204`。v1 只保留端点与 `waiting` 状态，不做 UI |

**B3 请求体：**

```jsonc
{
  "idempotency_key": "uuid",                        // 必填，防重复提交
  "parts": [
    { "type": "text", "text": "..." },
    { "type": "resource", "resource_id": "..." }    // 来自 D5 上传
  ],
  "model": "model-id"                               // 可选，缺省沿用会话上次模型
}
```

> **关键设计：立即返回，不在此响应上流式输出。** 所有输出走 C7 会话流。后台运行、多窗口同步、断线重连三件事因此自然成立，无需额外机制。
>
> B5 必须进 v1：流式聊天没有停止键不可用，而 run 状态机一旦定死再加 `cancelled` 会波及全部前端状态机。

### C. Session（7）— 能力组 6

| | 端点 | 说明 |
|---|---|---|
| C1 | `POST /v1/sessions` | `{workspace_id, title?}` → `OaepSession` |
| C2 | `GET /v1/sessions?workspace_id=&cursor=&limit=` | `{items, next_cursor}`（手稿 2.2 历史任务） |
| C3 | `PATCH /v1/sessions/{session_id}` | `{title?, status?: "active"\|"archived"}` |
| C4 | `DELETE /v1/sessions/{session_id}` | 软删除（`status = deleted`）→ `204` |
| C5 | `GET /v1/sessions/{session_id}/snapshot?limit=` | `OaepSnapshot`，进入会话时一次拉取 |
| C6 | `GET /v1/sessions/{session_id}/events?after_sequence=&limit=` | `OaepEventPage`，断线补拉 |
| C7 | `GET /v1/sessions/{session_id}/events/stream?after_sequence=` | `text/event-stream`，每帧一个 `OaepEvent` |

> C2 的列表项需带 `updated_at` 与最后一条 run 的 `status`，供侧栏直接渲染会话状态（手稿 3.3），避免 N+1 请求。

**重连语义（必须在 v1 实现，后补代价极大）：**

1. 客户端持久化 `last_sequence`。
2. 重连时带 `after_sequence=last_sequence`。
3. Runtime 无法覆盖该断点（历史被压缩）时返回 `409 {"code":"history_gap"}`，客户端回落到 C5 全量快照。
4. 客户端按 `dedupe_key` 去重；`sequence` 在单个 session 内严格单调递增。
5. SSE 每 15s 发送注释心跳 `: ping`，用于探测半开连接。

### D. 工作区与资源（5）— 能力组 5

| | 端点 | 说明 |
|---|---|---|
| D1 | `GET /v1/workspaces` | `{items:[{workspace_id, path, display_name, created_at}]}`，**至少含一个默认工作区** |
| D2 | `POST /v1/workspaces` | `{path, display_name?}` |
| D3 | `GET /v1/workspaces/{id}/files?path=&depth=1` | `{entries:[{path, name, kind, size, mtime, mime_type}]}`（手稿 2.3） |
| D4 | `GET /v1/workspaces/{id}/file?path=` | 字节流，支持 `Range`，响应带 `Content-Type`/`ETag`/`X-Digest`（手稿 4.1）。越界返回 `403 workspace_escape` |
| D5 | `POST /v1/workspaces/{id}/uploads` | `multipart/form-data` → `{resource_id, name, mime_type, size, digest}` |

> D5 是**输入侧附件**。手稿 4.1 只覆盖了输出预览，用户发文件给 Agent 的路径必须同时定义，否则 B3 的 `parts` 里的 `resource` 无处产生。
>
> 默认工作区隐式存在（`$DRSAI_HOME/workspaces/default`），见 §4.1 决定 3。

### E. 模型（2）— 能力组 4

| | 端点 | 说明 |
|---|---|---|
| E1 | `GET /v1/models` | `{items:[{model_id, display_name, provider, available, capabilities:["vision","tools"]}], default}` |
| E2 | `PUT /v1/config/model` | `{model_id}` → 设为默认，供后续 run 缺省使用 |

> 模型选择是 **run 参数**（B3 的 `model` 字段），E2 只负责持久化缺省值。v1 **不迁移** `/v1/config/model-providers/*` 那 14 条管理面，也不迁移已标 `deprecated=True` 的 `/v1/models/config*` 别名系统。

### F. 配置持久化（5）— 能力组 2

现有网关把配置摊成 19 条各自独立的 CRUD（agents / tools / env / cli / platforms）。v1 收敛为**一份配置文档 + 独立的密钥通道**。

| | 端点 | 说明 |
|---|---|---|
| F1 | `GET /v1/config` | 全部可持久化配置：默认模型、平台开关、网络检索开关、工具开关 |
| F2 | `PATCH /v1/config` | 部分更新，仅提交变更字段 |
| F3 | `GET /v1/config/secrets` | **只返回已配置的密钥名与是否存在，绝不返回值** |
| F4 | `PUT /v1/config/secrets/{key}` | 写入密钥 |
| F5 | `DELETE /v1/config/secrets/{key}` | 移除密钥 |

> 密钥与普通配置分开，是因为 F1 会被前端频繁读取并可能进入日志与错误上报；密钥必须只写不读。

### G. Skills（3）— 能力组 7

| | 端点 | 说明 |
|---|---|---|
| G1 | `GET /v1/skills` | `{installed:[...], available:[...]}` |
| G2 | `POST /v1/skills/install` | `{name, source?}` |
| G3 | `DELETE /v1/skills/{skill_name}` | |

> 不迁移 `preview` 与 `reload`：前者是编辑器辅助，后者应由安装/卸载隐式触发。

### H. GFS（9）— 能力组 9

**这是新接入，不是迁移。** `backend/gfs_api.py` 定义了这 9 条但当前网关从未挂载，live app 的 OpenAPI 中 gfs 为 0 条。实际在用 GFS 的是 `apps/webui`，走 API key 直连外部服务。

| | 端点 |
|---|---|
| H1 | `GET /v1/gfs/health` |
| H2–H9 | `POST /v1/gfs/{list,stat,read,write,upload,download,delete,share-url}` |

> **接入前必须先验证两件事**：Desktop 的 OIDC 身份如何映射到 GFS 的鉴权（现有实现走 `GFS_API_KEY` 环境变量），以及 personal mode 的判定条件。这两点没确认之前不要开始写端点。
>
> 受 `gfs` 能力位门控：未配置时 B2 不返回该能力，前端隐藏入口。

### I. 语音输入（1）— 能力组 8

| | 端点 | 说明 |
|---|---|---|
| I1 | `POST /v1/audio/transcriptions` | `multipart`（音频）→ `{text}` |

> 语音是**旁路服务，不进入 run 循环契约**：STT 的产物是填进输入框的文本。这样它可独立开关、独立失败，不影响主链路。受 `audio.stt` 能力位门控。
>
> 实时双工（现有 `/v1/audio/transcriptions/stream`、`/v1/audio/duplex`）v1 不做。TTS 也不做——手稿 3.4 只写了「语音」，用户确认为语音**输入**。

### J. 网络检索（0）— 能力组 10

**不需要任何端点。** 联网搜索是 Agent 的工具，表现为事件流中的 `tool_call` item；开关落在 F1/F2 的配置文档里。

这是 §3.2 铁律三的样板：新增能力优先表现为新的 item 类型或 tool_call，而不是新端点。


## 6. OAEP v1 子集

复用 `cores/protocol/oaep/oaep.schema.json`（`OAEP_VERSION = "1.0"`，profile `oaep.session-stream/1`），**不新增任何字段**。v1 只是收窄取值域。

### 6.1 v1 发射的 item 类型（5）

| 类型 | 用途 | UI 落点 |
|---|---|---|
| `message` | 用户与助手消息 | 中间栏气泡（3.1） |
| `reasoning` | 思考过程 | 可折叠区块 |
| `tool_call` | 工具调用 | 折叠卡片 |
| `artifact` | 产出文件 | 工作区（2.3）+ 右侧预览（4.1） |
| `notice` | 警告 / 错误 | 内联提示条 |

**保留但 v1 不发射**：`plan`、`command_execution`、`file_change`、`interaction`、`subtask`。前端 item 渲染器注册表遇到未知类型时，降级为 `notice` 样式并记录一条诊断，**不得崩溃**。

### 6.2 v1 发射的事件类型

```
event.session.created | event.session.updated
event.run.created | event.run.started | event.run.completed
                  | event.run.failed  | event.run.cancelled
event.item.created | event.item.delta | event.item.completed | event.item.failed
```

保留：`event.run.waiting` / `event.run.resumed`（配合 E3）、`event.session.archived` / `event.session.deleted`。

### 6.3 文件预览如何挂到消息上

不发明新机制。`artifact` item 的 `associations[]` 里放 `OaepResourceAssociation`：

```
relation:     "output_artifact"
resource:     { workspace_id, resource_type: "file", resource_id }
presentation: "card"
```

右侧栏预览（4.1）= 拿 `resource_id` 调 F2。工作区列表（2.3）= 调 F1，或聚合会话内全部 `output_artifact`。

---

## 7. 错误契约

所有非 2xx 响应统一：

```json
{
  "error": {
    "code": "session_not_found",
    "category": "runtime",
    "message": "面向用户的、已脱敏的一句话",
    "retryable": false,
    "recovery_actions": ["retry", "diagnostics"],
    "request_id": "req_xxx"
  }
}
```

- `category` ∈ `binding | auth | transport | contract | model | approval | resource | history | runtime | backend | unknown`
- `recovery_actions` ∈ `retry | login | sync | repair | new_task | select_model | remove_resource | reconnect | diagnostics`
- 沿用 `backend/runtime/error_contract.py` 的分类与脱敏逻辑（`message` 中不得出现 token、路径、命令、prompt、异常栈）。
- **前端只允许展示 `message` + 由 `recovery_actions[0]` 映射出的唯一 CTA。** 不向普通用户展示原始 code（诊断面板除外）。

---

## 8. Desktop 侧结构

### 8.1 目录

```
apps/desktop-v2/
├── protocol/                    # codegen 产物，禁止手改
│   ├── oaep.generated.ts        # 自 cores/protocol/oaep/oaep.schema.json
│   └── runtime-api.generated.ts # 自 cores/protocol/desktop-v2/runtime-v1.openapi.yaml
├── main/
│   ├── index.ts                 # 目标 < 500 行
│   ├── runtimeProcess.ts        # 启动 / 健康检查 / 退出
│   ├── oidcLogin.ts             # 交互式登录，产出 id_token
│   └── ipc.ts                   # channel 白名单，唯一注册处
└── renderer/
    ├── runtime/client.ts        # 42 个方法，与端点 1:1，无业务逻辑
    ├── store/
    │   ├── sessionStore.ts      # snapshot + event reducer
    │   └── reducer.ts           # (state, OaepEvent) => state，纯函数，单测覆盖
    └── features/
        ├── auth/        # 1、2.4
        ├── sidebar/     # 2.1 2.2 2.5
        ├── chat/        # 3.1 3.2 3.3 3.4
        ├── workspace/   # 2.3
        └── preview/     # 4.1
```

### 8.2 IPC 白名单（12 个，硬上限 15）

```
app:runtime-endpoint      → { baseUrl, token }
app:version
app:quit
auth:login                → 打开系统浏览器完成 OIDC，返回 id_token
auth:logout
window:minimize
window:maximize
window:close
dialog:open-directory     → 选择工作区目录
shell:open-path
shell:show-item-in-folder
clipboard:write
```

**任何业务数据都不走 IPC。** 对照现有 432 个 channel，减少约 97%。

### 8.3 状态管理

单一 store，唯一写入路径：

```
initial:    GET /snapshot        → state
live:       SSE OaepEvent        → reducer(state, event) → state
reconnect:  GET /events?after=   → 逐条 reducer；409 则回落 snapshot
```

reducer 是纯函数，必须有覆盖以下场景的单测：乱序到达、重复 `dedupe_key`、`delta` 早于 `item.created`、run 取消后仍有残余 delta。

---

## 9. 扩展点（可扩展性的三个 seam）

| Seam | 位置 | 加什么不用改契约 |
|---|---|---|
| **1. Agent Backend Adapter** | Python：`backend_id → OAEP item` 解码器，沿用现有 `AgentEventAdapterRegistry` 模式 | 接入新的 Agent 实现（Codex、其它 kernel），前端零改动 |
| **2. Tool Registry** | Python：Agent 可调用的工具表 | 联网搜索（Tavily）、代码执行、知识库检索——全部表现为 `tool_call` item |
| **3. Item Renderer Registry** | Renderer：`item.type → React 组件` | 启用保留的 `plan` / `command_execution` / `interaction` 等类型 |

**判定新需求是否属于"可扩展"范围的一句话标准：**

> 如果实现它需要新增 Runtime 端点，说明它落在 seam 之外，必须走架构评审。

被划掉的 Tavily 就是正例：它以后回来是 seam 2 的一个注册项，不是一个新端点。

---

## 10. 里程碑

| 阶段 | 交付 | 完成判据 |
|---|---|---|
| **M0 协议冻结** | `cores/protocol/desktop-v2/runtime-v1.openapi.yaml` + OAEP fixture 集 | 42 个端点定义完成；fixture 可回放出完整一轮对话 |
| **M1 垂直切片** | 登录 → 新建会话 → 发一句话 → 流式 token → 产出一个文件出现在工作区 | 端到端跑通；**接口在此刻才算真正定住** |
| **M2 会话管理** | 2.1 / 2.2 / 2.5 / 3.3 + 断线重连 | 拔网线 30s 恢复后无消息丢失、无重复 |
| **M3 工作区与预览** | 2.3 / 4.1 / F3 上传 | artifact → 卡片 → 右侧预览链路通 |
| **M4 模型选择** | 3.2 | 切模型对下一个 run 生效，不影响历史 |
| **M5 语音** | 3.4，能力位门控 | 关闭能力位时 UI 干净降级 |

**不要从侧边栏开始。** M1 这条垂直切片打通之前，不铺任何横向功能。

---

## 11. 接口冻结规则

M0 之后，v1 契约变更遵守：

1. **只增不改**：新增可选字段允许；改语义、改必填性、删字段，一律升 `protocol_version`。
2. **新增端点需评审**，评审第一个问题是"能否表达为新的 item 类型或 tool_call"。
3. **`cores/protocol/oaep/oaep.schema.json` 是唯一真源**，TS 类型必须由 codegen 产生，CI 校验 `OAEP_SCHEMA_SHA256` 与生成物一致。
4. 每个端点在 M0 就要有一条 fixture，作为 Runtime 与 Desktop 之间的联调基线。

---

## 12. 与现有分支的关系

- `feature/desktop` 继续维护现网，**不回合并 V2**，直到 M3 验收通过。
- V2 复用同一个 Python 包，但走独立 FastAPI app（`backend/desktop_v2/`），与 `gateway.py` 同进程不同挂载点或独立端口，两者可并存以便对比验证。
- 后端行为若涉及 TUI 共用的核心模块（Agent Kernel、`error_contract`），改动前需同步——Desktop 与 TUI 共享 Python 核心。
