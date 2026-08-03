# OAEP v1 Runtime Bridge 实现方案

## 1. 背景与目标

OpenDrSai v1.5.3 已经具备流式输出、结构化会话、Runtime 持久事件、断线恢复、Codex Backend、OpenDrSai Backend、本地/远程工作区和 Desktop 消费链路。但当前输出语义仍分散在多套协议与投影模型中：

- Backend 私有事件：OpenDrSai Agent、Codex App Server、未来 Hermes 等各自不同。
- Runtime Run Event：如 `agent.message.delta`、`tool.started`、`run.completed`。
- Runtime Conversation Journal：如 `conversation.item.created`、`conversation.item.delta`、`conversation.item.upsert`。
- Desktop StructuredTurn：Renderer 侧结构化渲染模型。
- 兼容输出：OpenAI-compatible SSE、旧 Desktop AgentRunEvent。

OAEP v1 的目标是把这些输出统一收敛为：

```text
Session
└─ Run
   └─ Item

event.session.*
event.run.*
event.item.*
```

本方案的目标是在不改动 TUI 直接执行链路的前提下，先在 **Desktop 使用的 Runtime Gateway + Desktop 消费链路** 中实现 OAEP v1，使 Desktop 成为第一个 OAEP 客户端，并为后续 Android、TUI、Relay 和自动验收统一协议打基础。

## 2. 命名与范围

方案名称：**OAEP v1 Runtime Bridge 实现方案**

这里的 Runtime Bridge 不是临时前端适配，而是指 Runtime 内部从 Backend 私有事件到 OAEP 领域模型的规范化实现层。

### 2.1 本期包含

- Runtime 内部 OAEP v1 数据模型。
- Backend 私有事件到 OAEP Event/Item 的一次性规范化映射。
- Runtime OAEP Projection 和 Snapshot。
- Runtime OAEP HTTP/SSE API。
- Desktop 优先消费 OAEP 的订阅与渲染链路。
- 旧协议兼容投影。
- 测试、契约、自动验收和开发模式跑通。

### 2.2 本期不包含

- 不改 `run_drsai_agent_factory.py`。
- 不改 `DrSaiCLIAssistant` 的核心运行逻辑。
- 不改 TUI 的 `tui_gateway`、`AgentSession` 和 `CLISessionStore`。
- 不要求 TUI 立刻消费 OAEP。
- 不删除旧 `/v1/chat/completions`、旧 Runtime Run Events 或 Desktop StructuredTurn。

## 3. 设计原则

1. OAEP 是 Runtime 层事实，不是 Agent Factory 层事实。
2. Agent Core 继续产生原始事件，Adapter/Runtime 负责规范化。
3. Runtime Event Journal 和 OAEP Projection 是 Desktop 的新事实来源。
4. 旧协议只能作为兼容投影，不能继续扩展为新的事实来源。
5. 同一 Backend 私有事件只映射一次，避免 Runtime、Desktop、Renderer 多次有损翻译。
6. TUI 暂不改动；后续迁移时作为 Runtime/OAEP 客户端接入。
7. Schema、fixture、类型生成、契约测试必须和代码一起演进。
8. Desktop 先支持 OAEP capability，缺失时回落到旧 conversation snapshot/events。

## 4. 当前协议基线

### 4.1 OAEP 协议定义

现有协议源：

- `cores/protocol/oaep/README.md`
- `cores/protocol/oaep/oaep.schema.json`

OAEP v1 已定义：

- 领域资源：Session、Run、Item。
- 事件信封：Event。
- Delta 仅存在于 `event.item.delta.data.delta` 中。
- Item 类型：
  - `message`
  - `reasoning`
  - `plan`
  - `command_execution`
  - `file_change`
  - `tool_call`
  - `artifact`
  - `interaction`
  - `subtask`
  - `notice`
- Event 类型：
  - `event.session.*`
  - `event.run.*`
  - `event.item.*`

### 4.2 当前 Desktop Runtime 链路

```text
Desktop Renderer
  -> Electron Main
  -> RuntimeClient
  -> drsai.backend.gateway
  -> RuntimeAgentService
  -> GatewayOpenDrSaiAgentBackend / Codex Backend
  -> Runtime Event Store
  -> Conversation Journal
  -> Desktop subscription/projection
  -> StructuredTurn UI
```

### 4.3 当前 TUI 链路

```text
TUI Node/Ink frontend
  -> tui_gateway JSON-RPC
  -> AgentSession
  -> run_drsai_agent_factory.create_agent()
  -> agent.run_stream()
```

本期不修改 TUI 链路。

## 5. 总体架构

```text
OpenDrSai Backend ─┐
                   ├─ Backend Adapter
Codex Backend ─────┘
        │
        ▼
Backend Private Events
        │
        ▼
OAEP Normalizer
        │
        ├─ OAEP Event Journal
        ├─ OAEP Item Projection
        └─ Legacy Projection
              ├─ Runtime Conversation Item
              ├─ Desktop StructuredTurn
              └─ OpenAI-compatible SSE
        │
        ▼
Runtime OAEP APIs
        │
        ▼
Desktop OAEP Consumer
```

关键点：

- Backend Adapter 只负责把私有事件转换为 OAEP。
- Runtime 保存 append-only OAEP Event，并维护最终 OAEP Item。
- Desktop 消费 OAEP Snapshot/Event Stream。
- 旧 Desktop StructuredTurn 暂时由 OAEP Item 投影生成。

## 6. 模块拆分

本方案拆分为 **11 个模块，共 60 个功能点**。

### M01 OAEP 协议基线与类型生成（6 项）

| 编号 | 功能点 | 说明 |
| --- | --- | --- |
| M01-F01 | 冻结 OAEP v1 schema | 以 `cores/protocol/oaep/oaep.schema.json` 为单一协议源 |
| M01-F02 | 增加协议 fixture | 覆盖 message、reasoning、tool、command、approval、failure |
| M01-F03 | Python 类型定义 | Runtime 内部使用 typed dataclass/Pydantic model |
| M01-F04 | TypeScript 类型定义 | Desktop RuntimeClient 与 Renderer 使用统一类型 |
| M01-F05 | Schema drift check | 生成类型与 schema 零漂移 |
| M01-F06 | 版本能力声明 | Runtime capability 增加 `oaep.v1` |

### M02 Runtime OAEP 数据模型（6 项）

| 编号 | 功能点 | 说明 |
| --- | --- | --- |
| M02-F01 | OAEP Session 投影 | 从 Runtime Session 生成 OAEP Session |
| M02-F02 | OAEP Run 投影 | 从 Runtime Run 生成 OAEP Run |
| M02-F03 | OAEP Item 存储模型 | 保存最终 Item 状态 |
| M02-F04 | OAEP Event 信封 | event_id、sequence、dedupe_key、source |
| M02-F05 | Delta 模型 | 只允许作为 `event.item.delta.data.delta` |
| M02-F06 | 错误模型 | 统一 code、message、retryable、details |

### M03 OAEP Journal 与 Projection（6 项）

| 编号 | 功能点 | 说明 |
| --- | --- | --- |
| M03-F01 | append-only Event 写入 | Event 不更新、不删除 |
| M03-F02 | Run 内 sequence 连续 | 同一 Run sequence 严格递增 |
| M03-F03 | Session sequence 支持 | 支持跨 Run 的 Session 事件游标 |
| M03-F04 | Item 状态机 | pending/running/waiting/completed/failed/cancelled |
| M03-F05 | completed Item 校准 | completed 携带最终 Item，校准之前 delta |
| M03-F06 | 幂等去重 | dedupe_key 重放不生成重复 Item/Event |

### M04 OpenDrSai Backend OAEP Adapter（5 项）

| 编号 | 功能点 | 说明 |
| --- | --- | --- |
| M04-F01 | message delta 映射 | `agent.message.delta` → message Item delta |
| M04-F02 | reasoning 映射 | 可展示推理摘要 → reasoning Item |
| M04-F03 | tool/command 映射 | Shell 映射 command_execution，其他工具映射 tool_call |
| M04-F04 | approval 映射 | approval/clarify 映射 interaction Item |
| M04-F05 | completion/error 映射 | completed/failed/cancelled 映射 run/item 终态 |

### M05 Codex Backend OAEP Adapter（7 项）

| 编号 | 功能点 | 说明 |
| --- | --- | --- |
| M05-F01 | Thread/Turn/Item 身份映射 | Codex Thread → Session，Turn → Run，Item → Item |
| M05-F02 | agent message delta | `item/agentMessage/delta` → `message.text.append` |
| M05-F03 | reasoning delta | Codex reasoning events → reasoning Item |
| M05-F04 | command output | commandExecution output → command_execution Item |
| M05-F05 | file change | Codex file diff/change → file_change Item |
| M05-F06 | approval server request | Codex approval request → interaction Item + run.waiting |
| M05-F07 | cancel/failure | interrupted/failed → OAEP cancelled/failed |

### M06 Runtime OAEP API（6 项）

| 编号 | 功能点 | 说明 |
| --- | --- | --- |
| M06-F01 | capability | `/v1/capabilities` 返回 `oaep.v1` |
| M06-F02 | session snapshot | `GET /v1/sessions/{id}/oaep-snapshot` |
| M06-F03 | session events page | `GET /v1/sessions/{id}/oaep-events?after_sequence=` |
| M06-F04 | session events stream | `GET /v1/sessions/{id}/oaep-events/stream?after_sequence=` |
| M06-F05 | cursor expired | 游标过期返回结构化错误，客户端重新 snapshot |
| M06-F06 | legacy projection | 旧 conversation APIs 由 OAEP 或同源 projection 生成 |

### M07 Desktop OAEP Consumer（6 项）

| 编号 | 功能点 | 说明 |
| --- | --- | --- |
| M07-F01 | RuntimeClient 类型 | 增加 OAEP snapshot/events/stream 客户端 |
| M07-F02 | capability switch | 支持 OAEP 时优先消费 OAEP |
| M07-F03 | fallback | Runtime 不支持 OAEP 时回退旧链路 |
| M07-F04 | OAEP → StructuredTurn | 将 OAEP Item 投影为现有 UI 结构 |
| M07-F05 | streaming update | `event.item.delta` 实时更新 UI |
| M07-F06 | recovery | 按 OAEP sequence 恢复，不重复、不丢失 |

### M08 Relay/Android OAEP Public Consumer（6 项）

| 编号 | 功能点 | 说明 |
| --- | --- | --- |
| M08-F01 | Relay OAEP snapshot proxy | `GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/oaep-snapshot` 鉴权后穿透 Runtime |
| M08-F02 | Relay OAEP event page proxy | `GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/oaep-events` 按 session sequence 重放 |
| M08-F03 | Relay OAEP SSE proxy | `GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/oaep-events/stream` 支持 Android/远程端流式 |
| M08-F04 | Relay capability/profile | Relay schema 声明 `oaep/1` 与 `oaep.session.*` 能力 |
| M08-F05 | Android OAEP path preference | Android 远程会话 snapshot/events/SSE 默认访问 OAEP 路径 |
| M08-F06 | item identity preservation | Android DTO/解析层保留 `item_id`、`item_revision`，便于增量更新和调试 |

### M09 兼容层与旧协议收敛（4 项）

| 编号 | 功能点 | 说明 |
| --- | --- | --- |
| M09-F01 | 旧 Run Event 兼容 | `agent.message.delta` 等继续可读 |
| M09-F02 | 旧 Desktop AgentRunEvent | 由 OAEP 投影生成，不再扩展新语义 |
| M09-F03 | OpenAI SSE 兼容 | `/v1/chat/completions` 保留为兼容输出 |
| M09-F04 | 诊断标记 | 明确事件来源：oaep/native/legacy |

### M10 自动测试与验收（5 项）

| 编号 | 功能点 | 说明 |
| --- | --- | --- |
| M10-F01 | OAEP schema test | schema fixture 双向校验 |
| M10-F02 | Adapter unit tests | OpenDrSai/Codex 私有事件映射测试 |
| M10-F03 | Runtime journal tests | sequence、dedupe、snapshot、cursor |
| M10-F04 | Desktop/Android contract tests | RuntimeClient、subscription、projection、Android Repository/SSE |
| M10-F05 | E2E smoke | Desktop 开发模式真实发消息，验证 OAEP 流式 |

### M11 文档、研发与发布门禁（3 项）

| 编号 | 功能点 | 说明 |
| --- | --- | --- |
| M11-F01 | 协议文档更新 | README、实现方案、迁移说明同步 |
| M11-F02 | 开发调试脚本 | 一键检查 Runtime OAEP 能力与事件 |
| M11-F03 | Release gate | OAEP drift/typecheck/integration 进入发布门禁 |

## 7. API 草案

### 7.1 Capability

```json
{
  "capabilities": [
    "oaep.v1",
    "oaep.session.snapshot",
    "oaep.session.events",
    "oaep.session.events.stream"
  ]
}
```

### 7.2 Snapshot

```text
GET /v1/sessions/{session_id}/oaep-snapshot
```

响应：

```json
{
  "version": "1.0",
  "session": {},
  "runs": [],
  "items": [],
  "snapshot_sequence": 42
}
```

### 7.3 Event Page

```text
GET /v1/sessions/{session_id}/oaep-events?after_sequence=42&limit=500
```

响应：

```json
{
  "version": "1.0",
  "data": [],
  "next_sequence": 43,
  "has_more": false
}
```

### 7.4 Event Stream

```text
GET /v1/sessions/{session_id}/oaep-events/stream?after_sequence=42
```

SSE event：

```text
event: oaep.event
data: {"version":"1.0","type":"event.item.delta",...}
```

### 7.5 Relay Public OAEP Routes

Runtime Gateway 是 OAEP 投影权威；Relay 只做 Android/远程端可访问的公开代理入口，先完成 subject、workspace、session 授权，再转发到当前 Runtime generation。

```text
GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/oaep-snapshot
GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/oaep-events?after_sequence=42&limit=500
GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/oaep-events/stream?after_sequence=42
```

兼容路由继续保留：

```text
GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/conversation-snapshot
GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/events
GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/events/stream
```

Android 新版本默认访问 OAEP 路径；旧路径只作为外部兼容面，不再扩展新语义。

## 8. 映射策略

### 8.1 OpenDrSai Backend

| 当前事件 | OAEP |
| --- | --- |
| `agent.message.delta` | `event.item.delta` + `message.text.append` |
| `thinking.delta` | `event.item.delta` + `reasoning.text.append` |
| `tool.started` | `event.item.started`，type=`tool_call` 或 `command_execution` |
| `tool.completed` | `event.item.completed` |
| `agent.completed` | assistant message completed + `event.run.completed` |
| backend error | notice/failed Item + `event.run.failed` |

### 8.2 Codex Backend

| Codex | OAEP |
| --- | --- |
| Thread | Session |
| Turn | Run |
| Item | Item |
| `turn/started` | `event.run.started` |
| `turn/completed: completed` | `event.run.completed` |
| `turn/completed: failed` | `event.run.failed` |
| `turn/completed: interrupted` | `event.run.cancelled` |
| `item/started` | `event.item.started` |
| `item/completed` | `event.item.completed` |
| `item/agentMessage/delta` | `event.item.delta` + `message.text.append` |
| `item/reasoning/*Delta` | `event.item.delta` + reasoning delta |
| `item/commandExecution/outputDelta` | `event.item.delta` + `command.output.append` |
| Approval server request | interaction Item + `event.run.waiting` |

### 8.3 Desktop StructuredTurn

| OAEP Item | Desktop 投影 |
| --- | --- |
| `message` assistant final/commentary | Markdown part |
| `reasoning` | Reasoning part |
| `command_execution` | Activity timeline command |
| `tool_call` | Activity timeline tool |
| `file_change` | File/diff activity |
| `interaction` | Approval/input request card |
| `notice` | Error/warning/info notice |

## 9. 实施阶段

### P0 协议冻结与基线检查

目标：确认 OAEP v1 当前 schema、README 和 examples 足够覆盖 Desktop 首个客户端。

交付：

- OAEP fixture 集。
- Python/TypeScript 类型生成或手写类型。
- drift check 脚本。
- 当前旧协议链路清单。

完成标准：

- schema fixture 校验通过。
- 类型与 schema 无漂移。
- 不修改 TUI。

### P1 Runtime OAEP 最小纵向闭环

目标：先打通 message delta。

链路：

```text
agent.message.delta
  -> event.item.delta + message.text.append
  -> oaep-events stream
  -> Desktop 显示流式文本
```

完成标准：

- Desktop 开发模式发送一条 My DrSai 消息，能通过 OAEP 流式显示。
- 旧 conversation snapshot/events 仍可用。

### P2 Runtime Journal 与 Snapshot

目标：建立可恢复、可重放的 OAEP Event/Item 投影。

完成标准：

- run sequence 连续。
- completed Item 能校准 delta。
- snapshot 能恢复完整对话。
- 断线后按 sequence 继续。

### P3 OpenDrSai Backend 完整映射

目标：覆盖 OpenDrSai Backend 的 message、reasoning、tool、approval、error。

完成标准：

- 本机 My DrSai 对话、工具调用、失败均产生 OAEP。
- Desktop 展示与旧 structuredTurn 等价或更完整。

### P4 Codex Backend 映射

目标：Codex 私有协议转 OAEP。

完成标准：

- Codex 文本流式、reasoning、命令、文件变更、审批、取消、失败均映射。
- 同一 Session 多轮请求创建多个 Run，不创建多个 Codex Thread。

### P5 Desktop OAEP Consumer 默认启用

目标：Desktop 在 Runtime 支持 `oaep.v1` 时默认使用 OAEP。

完成标准：

- capability switch 生效。
- fallback 旧 Runtime 生效。
- UI 不丢失结构化内容。

### P6 兼容层收敛与门禁

目标：旧协议明确降级为兼容层。

完成标准：

- `/v1/chat/completions` 仍通过。
- 旧 Desktop AgentRunEvent 仍通过。
- 新语义只进 OAEP。
- release gate 包含 OAEP 验收。

## 10. 测试验收方案

### 10.1 L0 Schema 与静态检查

命令建议：

```text
python -m pytest cores/python/packages/drsai/tests/test_oaep_schema.py
npm --prefix apps/desktop run typecheck:node
npm --prefix apps/desktop run typecheck:web
```

覆盖：

- OAEP schema fixture。
- Python/TypeScript 类型。
- 未知 Event type fail closed。
- Delta 不能作为顶层消息。

### 10.2 L1 Runtime 单元测试

覆盖：

- Event append-only。
- sequence 连续。
- dedupe_key 去重。
- Item 状态机。
- completed Item 校准 delta。
- snapshot/page/stream 一致性。

### 10.3 L2 Adapter 契约测试

覆盖：

- OpenDrSai Backend 原始事件 → OAEP。
- Codex App Server 事件 → OAEP。
- approval request/response。
- cancel/failure/error。
- 未识别 Backend 事件只进入 notice 或诊断，不直接穿透 Desktop。

### 10.4 L3 Desktop 合约测试

覆盖：

- RuntimeClient OAEP API。
- session subscription。
- OAEP → StructuredTurn projection。
- fallback to legacy。
- disconnected/reconnect/replay。
- no duplicate delta。

### 10.5 L4 Desktop 开发模式 Smoke

场景：

1. 启动 `windows-desktop-dev.cmd`。
2. 打开一个本地 Workspace。
3. 使用 My DrSai 发送消息。
4. 验证 OAEP events stream 收到 message delta。
5. Desktop UI 实时显示。
6. 刷新 Desktop，按 OAEP snapshot 恢复。
7. 切换到 Codex，重复文本流式和命令工具场景。

### 10.6 L5 Release Gate

发布门禁必须覆盖：

- OAEP schema drift。
- Runtime OAEP 单元测试。
- OpenDrSai/Codex adapter 契约。
- Desktop node/web typecheck。
- Desktop OAEP subscription verifier。
- 兼容旧协议 verifier。
- mojibake/diff check。

## 11. 真实 Desktop 跑通标准

### 11.1 My DrSai

必须真实验证：

- Runtime capability 返回 `oaep.v1`。
- 新建 Session/Run 后产生：
  - `event.run.created`
  - `event.run.started`
  - `event.item.started`
  - `event.item.delta`
  - `event.item.completed`
  - `event.run.completed`
- Desktop UI 流式显示。
- 刷新后 snapshot 恢复。

### 11.2 Codex

必须真实验证：

- Codex app-server ready。
- 多轮复用同一 Session/Thread。
- 文本 delta、reasoning、command/file change 至少覆盖其中两类结构化 Item。
- 取消或失败能映射为 OAEP 终态。
- Desktop 不再依赖 Codex 私有事件渲染。

### 11.3 兼容性

必须真实验证：

- 旧 Runtime 不支持 OAEP 时 Desktop 回退旧链路。
- `/v1/chat/completions` 未破坏。
- TUI 当前 direct mode 不受影响。

## 12. 数据迁移与兼容

第一版不强制迁移旧 conversation journal。

推荐策略：

1. 新 Run 原生生成 OAEP Projection。
2. 旧 Run 在读取 snapshot 时可懒投影为 OAEP Item。
3. 无法无损投影的旧事件生成 `notice` 或 legacy message。
4. 不覆盖旧 Runtime Event Store。
5. 不改变现有 TUI `Thread` 表和 `CLISessionStore`。

## 13. 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| OAEP 与旧 Conversation Journal 双写不一致 | Desktop 显示漂移 | 同源写入，测试 snapshot 与 event replay |
| Desktop 过早删除 legacy | 旧 Runtime 断裂 | capability fallback |
| Adapter 多次翻译 | 重复或丢结构 | 规定私有事件只在 Runtime Adapter 映射一次 |
| TUI 被误伤 | TUI 回归 | 禁止修改 `tui_gateway` 和 Agent factory |
| Codex 协议变化 | OAEP 事件缺失 | Codex adapter fixture + 真实 smoke |
| 大量 delta 性能问题 | UI 卡顿 | batch/limit，completed Item 校准 |
| 历史数据无法无损迁移 | 旧会话显示不完整 | 懒投影 + notice 标记 |

## 14. 研发工作流

建议每个阶段提交前运行：

```text
git diff --check
python -m pytest <oaep/runtime/adapter tests>
npm --prefix apps/desktop run typecheck:node
npm --prefix apps/desktop run typecheck:web
npm --prefix apps/desktop run <oaep verifier>
```

开发调试建议新增脚本：

```text
npm --prefix apps/desktop run verify:oaep-runtime-contract
npm --prefix apps/desktop run verify:oaep-desktop-consumer
python scripts/verify-oaep-runtime-online.py
```

当前 Windows Desktop 已落地的 OAEP 发布门禁入口：

```text
npm --prefix apps/desktop/windows run verify:oaep-release
```

该入口串联：

- `verify:oaep-runtime-contract`：静态检查 Runtime Gateway capability、OAEP API、RuntimeEngine projection、Desktop RuntimeClient/订阅/投影和本方案文档。
- `verify:session-conversation-subscription`：验证 Desktop 旧 conversation 与 OAEP fixture 投影不会漂移。
- `scripts/verify-oaep-runtime-online.py`：使用临时 Runtime 通过 Gateway HTTP 验证 capability、OAEP snapshot、event page、SSE 首帧和敏感字段不泄露。

脚本输出应包含：

- Runtime id。
- capability。
- session_id/run_id。
- OAEP event count。
- final item count。
- replay/dedupe 结果。
- Desktop projection 摘要。

不得输出：

- access token。
- API key。
- 绝对敏感路径。
- Codex 私有原始 payload 中的凭据。

## 15. 与 TUI 的关系

本期不改 TUI。

短期状态：

```text
Desktop -> Runtime Gateway -> OAEP
TUI     -> tui_gateway     -> direct AgentSession
```

后续目标：

```text
TUI -> tui_gateway Runtime adapter -> Runtime Gateway -> OAEP
```

因此本方案要保证：

- OAEP 不进入 `run_drsai_agent_factory.py`。
- OAEP 不要求 Agent Core 直接维护 Session/Run/Item/Event。
- TUI 未来只需要消费 Runtime/OAEP，不需要对齐 Desktop 私有 UI 模型。

## 16. 完成定义

本方案完成时，应满足：

1. OAEP v1 schema、fixture、Python/TypeScript 类型和 drift check 完整。
2. Runtime Gateway 可生成并持久化 OAEP Event/Item。
3. Runtime 提供 OAEP snapshot/events/stream API。
4. Desktop 默认优先消费 OAEP，旧 Runtime 自动 fallback。
5. My DrSai 和 Codex 均能产生 OAEP 流式消息。
6. 工具、命令、审批、失败、取消至少完成首批稳定映射。
7. Desktop 开发模式真实跑通 My DrSai 与 Codex 两条链路。
8. 旧协议保留但定位为兼容投影。
9. TUI 测试不受影响。
10. Release gate 中包含 OAEP 契约与 Desktop 消费验证。

## 17. 总结

OAEP v1 Runtime Bridge 的实施重点不是增加一个新的前端事件格式，而是在 Runtime 层建立统一事实来源：

```text
统一数据模型：Session → Run → Item
统一变化语义：event.session.* / event.run.* / event.item.*
统一事实来源：OAEP Event + 最终 OAEP Item
旧协议定位：兼容投影层
```

第一阶段以 Desktop 为首个客户端落地，TUI 暂不改动。这样可以先在真实 Runtime Gateway、真实 Desktop UI 和真实 Backend 执行中验证协议，再把同一套 OAEP 语义推广到 Android、Relay、TUI 和自动验收。
