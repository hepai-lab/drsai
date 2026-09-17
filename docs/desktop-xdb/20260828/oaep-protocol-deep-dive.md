# OAEP 协议深度解析报告

> **日期**: 2026-08-28
> **协议全称**: OpenDrSai Agent Event Protocol (OAEP)
> **当前版本**: 1.0
> **Schema文件**: `cores/protocol/oaep/oaep.schema.json` (765行, JSON Schema Draft 2020-12)

---

## 1. OAEP 是什么

OAEP (OpenDrSai Agent Event Protocol) 是 OpenDrSai 桌面端的**会话流式传输协议**。
它定义了一套基于事件溯源 (Event Sourcing) 的会话数据模型，将 Agent 的执行过程
建模为 **Session → Run → Item** 三层结构，通过 **Event** 序列来驱动状态变化。

简而言之，OAEP 解决了一个核心问题：

> 当用户发一条消息后，AI Agent 的回复、推理过程、工具调用、命令执行等
> 各种类型的内容，如何以统一的、可流式传输的、可恢复的方式从后端传递到前端？

OAEP 的答案是：把一切建模为**事件**，通过 SSE (Server-Sent Events) 流式传输，
前端通过 reduce 事件来重建完整的会话状态。

---

## 2. 协议定义位置

OAEP 是一个**多语言、多层**的协议体系，定义分布在以下位置：

### 2.1 协议源头 (Single Source of Truth)

| 文件 | 说明 |
|------|------|
| `cores/protocol/oaep/oaep.schema.json` | **JSON Schema 定义** (765行), 所有类型的权威定义 |
| `cores/protocol/oaep/examples.json` | 完整示例 (1个Session, 1个Run, 10个Items, 11个Events) |
| `cores/protocol/oaep/snapshot-window.examples.json` | 分页快照示例 |
| `cores/protocol/oaep/parity-v1.json` | 一致性验证 fixture |
| `cores/protocol/oaep/conversation-resources-p1.fixture.json` | P1资源 fixture |
| `cores/protocol/oaep/conversation-resources-p2.fixture.json` | P2资源 fixture |

### 2.2 Python 后端代码生成与实现

| 文件 | 说明 |
|------|------|
| `drsai/oaep/generated.py` | 从 schema 自动生成的 TypedDict 类型定义 + 3个常量 |
| `drsai/oaep/__init__.py` | 公开导出口 (`from .generated import *`) |
| `drsai/oaep/protocol.py` | `OAEPProtocol` 验证器 (JSON Schema 验证) + `OAEPStreamValidator` (流式状态机) |
| `drsai/oaep/selection.py` | 协议选择逻辑 (`select_conversation_protocol()`) — 能力协商 |
| `drsai/oaep/digest.py` | OAEP Item 摘要计算 (完整性校验) |
| `drsai/oaep/compatibility.py` | OAEP ↔ Legacy 兼容层 |
| `drsai/oaep/resource_associations.py` | P1 → P2 资源关联迁移 |
| `drsai/oaep/usage.py` | OAEP 用法追踪 |
| `drsai/backend/runtime/oaep.py` | **OAEP 投影层** — 将内部 journal 数据投影为 OAEP 格式 |
| `drsai/backend/runtime/journal.py` | **持久化事件日志** — SQLite 存储所有 Session 事件 |
| `drsai/backend/runtime/desktop_oaep_bridge.py` | 桌面端 OAEP 桥接器 — 将 agent 事件镜像到 journal |
| `drsai/backend/desktop_gateway/_oaep.py` | 网关层 P1→P2 迁移 |

### 2.3 TypeScript 前端代码生成与实现

| 文件 | 说明 |
|------|------|
| `apps/desktop/shared/api/oaep.generated.ts` | 从 schema 自动生成的 TS 接口 + 3个常量 |
| `apps/desktop/shared/main/runtimeProtocolSelection.ts` | 前端协议选择逻辑 (与 Python `selection.py` 镜像) |
| `apps/desktop/shared/main/oaepSessionStream.ts` | **前端 OAEP 状态机** — snapshot/replay/stream 生命周期 |
| `apps/desktop/shared/main/oaepIntegrity.ts` | 前端 OAEP 完整性断言 |
| `apps/desktop/shared/main/oaepDigest.ts` | 前端 OAEP 摘要计算 |
| `apps/desktop/shared/main/oaepAgentRunBridge.ts` | Agent Run 桥接 |
| `apps/desktop/shared/main/oaepPresentationProjector.ts` | 演示投影 |
| `apps/desktop/shared/main/oaepOwopResources.ts` | OWOP 资源关联 |

### 2.4 独立运行时包 (drsai_dsh_runtime)

| 文件 | 说明 |
|------|------|
| `opendrsai_dsh_runtime/contracts.py` | 独立常量副本 (防止运行时依赖产品包) |
| `opendrsai_dsh_runtime/oaep.py` | OAEP 验证 |
| `opendrsai_dsh_runtime/registration.py` | 协议注册 |
| `opendrsai_dsh_runtime/control.py` | 控制协议 |

> **注意**: `drsai_dsh_runtime` 中的 `OAEP_SCHEMA_SHA256` 值与主包不同
> (`e207c75c...` vs `154cac08...`)，因为它是独立维护的桥接包，可能使用
> 了不同的 schema 版本或计算方式。主桌面端使用的是 `drsai.oaep.generated`
> 中的值。

---

## 3. 三个核心常量

这些常量在 Python、TypeScript、JSON Schema 中完全一致，是协议协商的基础：

```python
# Python: drsai/oaep/generated.py
OAEP_VERSION = '1.0'
OAEP_PROFILE = "oaep.session-stream/1"
OAEP_SCHEMA_SHA256 = '154cac089e8d0f243e3f42a56187061cd821b648416df2ccf4224cd47003e184'
```

```typescript
// TypeScript: apps/desktop/shared/api/oaep.generated.ts
export const OAEP_VERSION = "1.0" as const;
export const OAEP_PROFILE = "oaep.session-stream/1" as const;
export const OAEP_SCHEMA_SHA256 = "154cac089e8d0f243e3f42a56187061cd821b648416df2ccf4224cd47003e184" as const;
```

```json
// JSON Schema: cores/protocol/oaep/oaep.schema.json
{
  "version": "1.0",
  "x-oaep-profiles": {
    "oaep.session-stream/1": {
      "event_sequence_scope": "session",
      "item_sequence_scope": "run",
      "cursor_semantics": "exclusive"
    }
  }
}
```

### 常量含义

| 常量 | 值 | 含义 |
|------|-----|------|
| `OAEP_VERSION` | `"1.0"` | 协议版本号，前后端必须一致 |
| `OAEP_PROFILE` | `"oaep.session-stream/1"` | Profile 标识，定义事件/项的序列范围和游标语义 |
| `OAEP_SCHEMA_SHA256` | `"154cac08..."` | schema JSON 文件的 SHA-256 哈希，用于版本锁定 |

### Profile 语义

`oaep.session-stream/1` profile 定义了三个关键语义：

1. **`event_sequence_scope: "session"`** — Event 的 sequence 是 Session 级别的连续整数，不是 Run 级别
2. **`item_sequence_scope: "run"`** — Item 的 sequence 是 Run 内部的序列号
3. **`cursor_semantics: "exclusive"`** — 游标是排他的：`GET /oaep-events?after_sequence=N` 返回 sequence > N 的事件

---

## 4. OAEP 数据模型

### 4.1 三层资源结构

```
Session (会话)
  ├── Run 1 (一次 Agent 执行)
  │     ├── Item: message (用户消息)
  │     ├── Item: reasoning (推理过程)
  │     ├── Item: command_execution (命令执行)
  │     ├── Item: tool_call (工具调用)
  │     ├── Item: message (助手回复)
  │     └── Item: artifact (产出物)
  │
  ├── Run 2 (另一次 Agent 执行)
  │     ├── Item: message (用户消息)
  │     └── Item: message (助手回复)
  │
  └── Event Stream (事件序列, 贯穿所有 Run)
        event.session.created → event.run.created → event.run.started →
        event.item.created → event.item.delta → event.item.completed →
        event.run.completed → ...
```

### 4.2 Session (会话)

```json
{
  "id": "session-1",
  "workspace_id": "workspace-1",
  "title": "OAEP fixture session",
  "status": "active",       // active | archived | deleted
  "backend": "opendrsai",
  "created_at": "2026-08-02T10:00:00Z",
  "updated_at": "2026-08-02T10:00:12Z"
}
```

Session 是顶层容器，绑定到一个 Workspace。状态可以是 active、archived 或 deleted。

### 4.3 Run (执行)

```json
{
  "id": "run-1",
  "session_id": "session-1",
  "parent_run_id": null,      // 可选, 用于子任务嵌套
  "sequence": 1,               // Run 在 Session 内的显示顺序
  "source": {
    "backend": "opendrsai",
    "backend_run_id": "ext-run-123",
    "backend_run_index": 0,
    "mapping_version": "1.0"
  },
  "status": "completed",      // queued | running | waiting | completed | failed | cancelled
  "created_at": "2026-08-02T10:00:00Z",
  "updated_at": "2026-08-02T10:00:12Z",
  "completed_at": "2026-08-02T10:00:12Z"
}
```

Run 代表 Agent 的一次执行。用户每发一条消息触发一次 Run。
`waiting` 状态表示需要用户审批（交互式确认）。

### 4.4 Item (对话项)

Item 是最丰富的资源类型，有 **10 种类型**：

| 类型 | 说明 | 对应内容 |
|------|------|----------|
| `message` | 用户/助手消息 | `role`, `text`, `parts`, `citations` |
| `reasoning` | 推理过程 | `segments[]` (含 id, text, kind, visibility) |
| `plan` | 执行计划 | `text`, `steps[]` (含 id, title, status) |
| `command_execution` | 命令执行 | `command[]`, `display_command`, `cwd`, `output`, `exit_code` |
| `tool_call` | 工具调用 | `tool_kind`, `tool_name`, `call_id`, `arguments`, `result` |
| `file_change` | 文件变更 | `changes[]` (含 operation, path), `summary` |
| `artifact` | 产出物 | `artifact_id`, `artifact_type`, `name`, `path`, `sha256` |
| `interaction` | 交互请求 | `interaction_type`, `prompt`, `options[]`, `response` |
| `subtask` | 子任务 | `title`, `summary`, `child_run_id`, `result` |
| `notice` | 通知/错误 | `level` (info/warning/error), `code`, `message` |

每种类型有独立的 `content` JSON Schema 定义，使用 `if/then` 条件 schema
根据 `type` 字段选择对应的 content 验证。

Item 有 **6 种状态**：`pending` → `running` → (`waiting` → `running`) → `completed` / `failed` / `cancelled`

#### Item 结构示例

```json
{
  "id": "command-1",
  "session_id": "session-1",
  "run_id": "run-1",
  "type": "command_execution",
  "status": "completed",
  "sequence": 3,
  "created_at": "2026-08-02T10:00:03Z",
  "updated_at": "2026-08-02T10:00:05Z",
  "source": { "backend": "opendrsai", "backend_item_id": "command-1" },
  "content": {
    "command": ["pytest", "-q"],
    "display_command": "pytest -q",
    "cwd": ".",
    "output": "15 passed",
    "exit_code": 0,
    "duration_ms": 1200
  }
}
```

---

## 5. OAEP 事件模型

### 5.1 事件类型 (19种)

| 范围 | 事件类型 | 说明 |
|------|----------|------|
| Session | `event.session.created` | 会话创建 |
| | `event.session.updated` | 会话更新 (如标题修改) |
| | `event.session.archived` | 会话归档 |
| | `event.session.unarchived` | 会话取消归档 |
| | `event.session.deleted` | 会话删除 |
| Run | `event.run.created` | Run 创建 |
| | `event.run.started` | Run 开始执行 |
| | `event.run.waiting` | Run 等待审批 |
| | `event.run.resumed` | Run 恢复执行 (审批通过后) |
| | `event.run.completed` | Run 完成 |
| | `event.run.failed` | Run 失败 |
| | `event.run.cancelled` | Run 被取消 |
| Item | `event.item.created` | Item 创建 (含完整 Item 数据) |
| | `event.item.started` | Item 开始执行 |
| | `event.item.delta` | **增量更新** (流式文本/输出) |
| | `event.item.updated` | Item 更新 |
| | `event.item.completed` | Item 完成 |
| | `event.item.failed` | Item 失败 (含 error) |
| | `event.item.cancelled` | Item 被取消 |

### 5.2 事件结构

```json
{
  "version": "1.0",
  "event_id": "event-4",
  "session_id": "session-1",
  "run_id": "run-1",
  "item_id": "command-1",
  "sequence": 4,
  "type": "event.item.delta",
  "timestamp": "2026-08-02T10:00:05Z",
  "dedupe_key": "run-1:command-1:stdout:1",
  "source": { "backend": "opendrsai", "backend_item_id": "command-1" },
  "data": {
    "delta": {
      "kind": "command.output.append",
      "stream": "stdout",
      "text": "15 passed"
    }
  }
}
```

### 5.3 Delta (增量) — 流式传输的核心

**Delta 永远不是顶层消息**，只能作为 `event.item.delta` 的 `data.delta` 存在。

7 种 Delta kind：

| Delta Kind | 适用 Item 类型 | 含义 |
|------------|---------------|------|
| `message.text.append` | message | 追加消息文本 |
| `reasoning.segment.added` | reasoning | 添加推理段 |
| `reasoning.text.append` | reasoning | 追加推理文本 |
| `plan.text.append` | plan | 追加计划文本 |
| `command.output.append` | command_execution | 追加命令输出 (stdout/stderr) |
| `tool.output.append` | tool_call | 追加工具输出 |
| `subtask.summary.append` | subtask | 追加子任务摘要 |

Delta 的设计要点：
- Delta 没有独立的 ID、sequence、timestamp — 它们完全依附于父 Item
- Delta 的 sequence 来自父 Event 的 sequence (Session 级别)
- 前端维护 `deltaShadows` — 在正式 Item created 之前先接收 delta 的"影子"

### 5.4 事件状态机约束

`OAEPStreamValidator` (protocol.py) 强制执行以下不变量：

1. **Sequence 连续性**: `sequence` 必须严格递增 +1
2. **Session 一致性**: 所有事件的 `session_id` 必须一致
3. **Item 身份**: `event.item.*` 事件必须包含 `run_id` 和 `item_id`
4. **终态后无事件**: Item 进入 completed/failed/cancelled 后不能再有事件
5. **Delta 前置条件**: `event.item.delta` 之前必须有 `event.item.created` 或之前的 delta
6. **Item 类型不可变**: 同一 item_id 的 type 不能改变
7. **Delta 类型匹配**: Delta kind 必须与 Item type 对应 (如 `command.output.append` → `command_execution`)
8. **Run 状态机**: `event.run.resumed` 前必须是 `waiting` 状态

---

## 6. Snapshot 与 Event Page

### 6.1 Snapshot (快照)

用于初始加载和重连恢复：

```json
{
  "version": "1.0",
  "session": { /* OaepSession */ },
  "runs": [ /* OaepRun[] */ ],
  "items": [ /* OaepItem[] */ ],
  "snapshot_sequence": 11,
  "mapping_version": "1.0",
  "checkpoint": {
    "sequence": 11,
    "snapshot_hash": "abc123...",  // 所有 Items 的 SHA-256 摘要
    "item_count": 10
  },
  "window": {
    "limit": 100,
    "has_more": false,
    "next_cursor": null
  }
}
```

- `snapshot_sequence`: 此快照对应到的事件序列号
- `checkpoint.snapshot_hash`: 所有 Items 的规范化 JSON 的 SHA-256，用于完整性校验
- `window`: 分页窗口 (Item 数量过多时)

### 6.2 Event Page (事件页)

用于事件流分页 (REST 回拉)：

```json
{
  "version": "1.0",
  "object": "list",
  "data": [ /* OaepEvent[] */ ],
  "next_sequence": 12,
  "has_more": false
}
```

### 6.3 SSE Stream

SSE 端点 (`GET /v1/sessions/{id}/oaep-events/stream`) 持续推送事件：

```
data: {"version":"1.0","event_id":"event-1","type":"event.run.started",...}

data: {"version":"1.0","event_id":"event-2","type":"event.item.created",...}

data: {"version":"1.0","event_id":"event-3","type":"event.item.delta",...}

data: {"version":"1.0","event_id":"event-4","type":"event.item.completed",...}

data: {"version":"1.0","event_id":"event-5","type":"event.run.completed",...}
```

---

## 7. 前端流式订阅生命周期

`oaepSessionStream.ts` 实现了一个完整的状态机：

```
idle → snapshot → replay → connected → (retrying → resnapshot → replay → connected)* → closed/fatal/degraded
```

### 7.1 阶段说明

| 阶段 | 动作 |
|------|------|
| `idle` | 初始状态 |
| `snapshot` | 调用 `GET /v1/sessions/{id}/oaep-snapshot` 获取完整快照 |
| `replay` | 从 `snapshot_sequence` 开始拉取遗漏的事件 (`GET /v1/sessions/{id}/oaep-events?after_sequence=N`) |
| `connected` | 连接 SSE 流 (`GET /v1/sessions/{id}/oaep-events/stream`)，实时接收事件 |
| `retrying` | 网络错误后重试 (最多 120 次，3 分钟窗口) |
| `resnapshot` | cursor 过期后重新获取快照 |
| `degraded` | 多次重试失败，需要用户手动重连 |
| `closed` | 正常关闭 |
| `fatal` | 不可恢复的协议错误 |

### 7.2 事件处理 (Reduce)

前端通过 `reduceOaepEvent()` 函数将事件应用到本地状态：

- `event.item.created` → 将完整 Item 放入 `items` Map
- `event.item.delta` → 通过 `appendDelta()` 增量更新 Item 内容
- `event.item.completed/failed/cancelled` → 更新 Item 状态
- `event.run.*` → 更新 `runs` Map

### 7.3 Delta Shadow 机制

当 delta 在正式 item.created 之前到达时，前端创建一个 "delta shadow"：

```typescript
interface OaepDeltaShadow {
  id: string;
  sessionId: string;
  runId: string;
  type: OaepItem["type"];  // 从 delta kind 推断
  status: "running";
  content: Record<string, unknown>;  // 累积 delta 文本
  lastEventSequence: number;
}
```

当正式 `event.item.created` 到达时，shadow 被替换为正式 Item。

### 7.4 错误分类

`classifyOaepStreamError()` 将错误分为三类：

| 分类 | 条件 | 行为 |
|------|------|------|
| `retryable` | 一般网络错误 | 重试 (指数退避, 最多 120 次) |
| `cursor_expired` | 410 状态码或 `cursor_expired` 错误码 | 重新获取快照 |
| `fatal` | OAEP 协议违规 (`oaep_*` 错误)、401/403/404/422 | 终止订阅 |

---

## 8. 能力协商 (Capability Negotiation)

### 8.1 前端检查项

`selectRuntimeConversationProtocolResult()` 在 `runtimeProtocolSelection.ts` 中：

```typescript
const OAEP_REQUIRED = [
  "oaep.v1",
  "oaep.session.snapshot",
  "oaep.session.events",
  "oaep.session.events.stream",
  "event.cursor_expired",
];
```

检查条件：
1. `capabilities.protocols.oaep` 存在
2. `oaep.version === "1.0"`
3. `oaep.profiles` 包含 `"oaep.session-stream/1"`
4. `oaep.schema_sha256 === "154cac08..."`
5. `OAEP_REQUIRED` 中的每个能力名都在 `capabilities.capabilities` 列表中

### 8.2 后端检查项 (Python)

`select_conversation_protocol()` 在 `selection.py` 中，逻辑完全镜像前端：

```python
OAEP_REQUIRED = frozenset({
    "oaep.v1", "oaep.session.snapshot", "oaep.session.events",
    "oaep.session.events.stream", "event.cursor_expired",
})
```

### 8.3 协商结果

| 结果 | 条件 | 含义 |
|------|------|------|
| `"oaep"` | 所有 OAEP 条件满足 | 使用 OAEP 协议 |
| `"legacy"` | OAEP 不满足但 Legacy 能力满足 | 回退到旧协议 |
| `"unavailable"` | 两者都不满足 | **无法会话** — 这就是当前 bug |
| 异常 `oaep_capability_partial` | OAEP 信号存在但不完整 | 抛出异常 |

### 8.4 所需能力名

| 能力名 | 对应后端路由 | 说明 |
|--------|-------------|------|
| `oaep.v1` | (协议标识) | OAEP 协议版本标识 |
| `oaep.session.snapshot` | `GET /v1/sessions/{id}/oaep-snapshot` | 快照端点 |
| `oaep.session.events` | `GET /v1/sessions/{id}/oaep-events` | 事件分页端点 |
| `oaep.session.events.stream` | `GET /v1/sessions/{id}/oaep-events/stream` | SSE 流端点 |
| `event.cursor_expired` | (错误处理) | 游标过期错误支持 |

---

## 9. 持久化层

### 9.1 SQLite 表结构

`RuntimeConversationJournal` (journal.py) 使用 SQLite WAL 模式存储：

| 表名 | 说明 |
|------|------|
| `runtime_sessions` | Session 记录 |
| `runtime_runs` | Run 记录 |
| `runtime_session_sequences` | 每个 Session 的 sequence 计数器 |
| `runtime_session_journal` | 原始事件日志 (event_id, session_sequence, event_kind, payload_json) |
| `runtime_conversation_items` | P1 格式的 Item (原始) |
| `runtime_oaep_items` | P2 格式的 OAEP Item (投影后) |
| `runtime_oaep_events` | OAEP 格式的 Event 信封 |
| `runtime_oaep_item_event_refs` | Event → Item 的反向引用 |
| `runtime_oaep_snapshot_checkpoints` | 快照检查点 (snapshot_hash) |
| `runtime_oaep_run_summary` | Run 级别的汇总统计 (触发器维护) |
| `runtime_oaep_migration_state` | P1→P2 迁移状态 |

### 9.2 关键设计

- **Append-first**: 事件只追加不修改，保证重放确定性
- **Dedupe key**: 每个 Session 内 (session_id, dedupe_key) 唯一，防止重复
- **Item revision**: 每个 Item 有 revision 号，支持乐观并发
- **Checkpoint**: snapshot_hash 确保快照完整性
- **自动清理**: `max_events_per_session=100000`, `retained_events_per_session=90000`
- **触发器汇总**: `runtime_oaep_run_summary` 由 INSERT/UPDATE/DELETE 触发器自动维护

### 9.3 桌面端桥接

`DesktopOaepJournalBridge` (desktop_oaep_bridge.py) 将桌面 Agent 的原始事件
镜像到 OAEP journal：

```
Agent 执行 → emit(message.delta, {text: "Hello"})
    ↓
DesktopOaepJournalBridge.record("message.delta", {delta: "Hello"})
    ↓
_normalize() → "agent.message.delta" + 安全过滤
    ↓
engine.append_backend_event(run_id, "agent.message.delta", payload, dedupe_key)
    ↓
SQLite: runtime_session_journal INSERT
    ↓
project_event() → OAEP 格式的 event.item.delta
    ↓
SSE: GET /v1/sessions/{id}/oaep-events/stream → 推送到前端
```

---

## 10. 安全层

OAEP 投影层 (`runtime/oaep.py`) 包含全面的安全过滤：

| 安全措施 | 实现函数 | 说明 |
|----------|----------|------|
| 凭证脱敏 | `_safe_text()` | 移除 token/password/secret 等 |
| 路径相对化 | `_relative_path()` | 绝对路径 → 仅文件名 |
| 敏感键过滤 | `_is_sensitive_public_key()` | 匹配 token/password/secret/private_key/authorization/api_key/credential/cookie/idempotency_key/command/raw_arguments/file_content |
| 命令参数脱敏 | `_safe_command()` | 限制长度，脱敏 |
| 输出流脱敏 | `_safe_stream_output()` | 从多种字段提取输出并脱敏 |
| 附件引用脱敏 | `_safe_attachment_ref()` | 保留文件扩展名，脱敏路径 |
| OWOP 操作引用验证 | `_safe_operation_ref()` | 严格模式匹配操作名 |
| 资源引用验证 | `_safe_resource_refs()` | 验证 resource_type, workspace_id 等 |
| 交互选项脱敏 | `_safe_interaction_options()` | 递归脱敏选项对象 |

---

## 11. 完整性保证

### 11.1 Schema 哈希锁定

`OAEP_SCHEMA_SHA256` 是 `oaep.schema.json` 文件的 SHA-256 哈希。
任何对 schema 的修改都会改变此哈希，导致前后端协商失败。

代码生成器 (`generate-oaep-types.py`) 会在 `--check` 模式下验证
生成的 Python/TS 文件中的常量与 schema 文件一致。

### 11.2 流式状态机验证

`OAEPStreamValidator` (protocol.py) 在服务端实时验证事件流：
- sequence 连续性
- session_id 一致性
- item 生命周期状态机
- delta kind ↔ item type 匹配

### 11.3 快照检查点

`oaep_items_digest()` 计算所有 Items 的规范摘要。
快照返回的 `checkpoint.snapshot_hash` 可被客户端验证，
确保接收到的历史数据完整无篡改。

### 11.4 前端完整性断言

`oaepIntegrity.ts` 中的 `assertOaepEventIntegrity()` 和
`assertOaepSnapshotIntegrity()` 在前端对每个接收的事件和快照
进行结构验证。

---

## 12. OAEP 与 Legacy 协议对比

| 维度 | Legacy (conversation/1) | OAEP (1.0) |
|------|------------------------|------------|
| 资源模型 | session + conversation items | Session → Run → Item (三层) |
| Item 类型 | message, tool, approval, error, artifact | 10种类型 (message, reasoning, plan, command_execution, tool_call, file_change, artifact, interaction, subtask, notice) |
| 流式传输 | session.event.stream (SSE) | oaep-events/stream (SSE) |
| 快照 | conversation.snapshot | oaep.session.snapshot (含 checkpoint) |
| 事件恢复 | session.event.resume | oaep.session.events (分页 + cursor) |
| Delta | 无独立 delta (混合在事件中) | 7种 typed delta, 严格附着于 item |
| 状态机 | 无强制验证 | OAEPStreamValidator 强制 |
| 完整性 | 无校验 | snapshot_hash + checkpoint |
| 安全 | 基础脱敏 | 全方位投影层安全 |
| 资源关联 | 无 | OWOP resource_refs + associations |
| 重放策略 | 无 | replay_policy (pure/read_only/workspace_write/external_write) |

---

## 13. OAEP 事件流完整示例

以用户发送 "请检查项目并运行测试" 为例：

```
[1] event.run.created        — Run 创建
    data: {run: {id: "run-1", status: "queued"}}

[2] event.run.started        — Run 开始执行
    data: {}

[3] event.item.created       — 用户消息 Item 创建
    data: {item: {type: "message", content: {role: "user", text: "请检查项目并运行测试。"}}}

[4] event.item.completed     — 用户消息完成
    data: {item: {...}}

[5] event.item.created       — 推理 Item 创建
    data: {item: {type: "reasoning", content: {segments: []}}}

[6] event.item.delta         — 推理文本流式追加
    data: {delta: {kind: "reasoning.text.append", text: "先检查项目结构..."}}

[7] event.item.delta         — 推理文本继续追加
    data: {delta: {kind: "reasoning.text.append", text: "然后运行测试..."}}

[8] event.item.completed     — 推理完成
    data: {item: {type: "reasoning", content: {segments: [{id: "...", text: "先检查...然后运行测试..."}]}}}

[9] event.item.created       — 命令执行 Item 创建
    data: {item: {type: "command_execution", content: {command: ["pytest", "-q"], ...}}}

[10] event.item.delta        — 命令输出流式追加
     data: {delta: {kind: "command.output.append", stream: "stdout", text: "test_1 passed"}}

[11] event.item.delta        — 命令输出继续
     data: {delta: {kind: "command.output.append", stream: "stdout", text: "test_2 passed"}}

[12] event.item.completed    — 命令执行完成
     data: {item: {type: "command_execution", content: {exit_code: 0, output: "test_1 passed\ntest_2 passed"}}}

[13] event.item.created      — 助手回复 Item 创建
     data: {item: {type: "message", content: {role: "assistant", text: ""}}}

[14] event.item.delta        — 回复文本流式追加
     data: {delta: {kind: "message.text.append", text: "测试全部通过"}}

[15] event.item.completed    — 助手回复完成
     data: {item: {type: "message", content: {role: "assistant", text: "测试全部通过"}}}

[16] event.run.completed     — Run 完成
     data: {}
```

---

## 14. 代码生成工具链

OAEP 协议使用代码生成确保多语言一致性：

```
cores/protocol/oaep/oaep.schema.json  (Single Source of Truth)
        │
        ├── generate-oaep-types.py
        │     ├── drsai/oaep/generated.py       (Python TypedDict)
        │     ├── apps/desktop/shared/api/oaep.generated.ts  (TypeScript interface)
        │     └── (可能还有 Kotlin 等)
        │
        └── 测试验证
              ├── tests/test_oaep_codegen.py     (验证 Python 常量)
              ├── tests/test_oaep_selection.py   (验证协议选择)
              ├── tests/test_oaep_protocol.py    (验证 schema)
              └── tests/test_oaep_delta_parity.py (验证 delta 一致性)
```

生成的文件头部标注：`Generated from cores/protocol/oaep/oaep.schema.json; do not edit.`

---

## 15. 附录：关键文件索引

| 文件 | 行数 | 说明 |
|------|------|------|
| `cores/protocol/oaep/oaep.schema.json` | 765 | JSON Schema 权威定义 |
| `cores/protocol/oaep/examples.json` | ~200 | 完整示例 |
| `drsai/oaep/generated.py` | ~230 | Python TypedDict 生成代码 |
| `drsai/oaep/protocol.py` | ~120 | JSON Schema 验证 + 流式状态机 |
| `drsai/oaep/selection.py` | ~75 | 协议选择逻辑 |
| `drsai/backend/runtime/oaep.py` | ~500+ | OAEP 投影层 + 安全过滤 |
| `drsai/backend/runtime/journal.py` | ~500+ | SQLite 持久化事件日志 |
| `drsai/backend/runtime/desktop_oaep_bridge.py` | ~180 | 桌面 Agent → OAEP 桥接 |
| `drsai/backend/desktop_gateway/_oaep.py` | ~60 | P1→P2 迁移 |
| `drsai/backend/desktop_gateway/routes/capabilities.py` | 全文 | **能力声明 (需修复)** |
| `drsai/backend/desktop_gateway/routes/sessions.py` | 全文 | OAEP Session 路由 |
| `apps/desktop/shared/api/oaep.generated.ts` | ~50 | TypeScript 接口生成代码 |
| `apps/desktop/shared/main/runtimeProtocolSelection.ts` | ~75 | 前端协议选择 |
| `apps/desktop/shared/main/oaepSessionStream.ts` | ~500+ | 前端 OAEP 状态机 |
| `apps/desktop/shared/main/oaepIntegrity.ts` | - | 前端完整性断言 |
| `opendrsai_dsh_runtime/contracts.py` | ~50 | 独立运行时常量 |
