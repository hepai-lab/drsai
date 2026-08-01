# OpenDrSai Agent Event Protocol（OAEP）

状态：Draft v1.0
协议目录：`cores/protocol/oaep`

## 定义

OAEP（OpenDrSai Agent Event Protocol）定义 Session、Run、Item 发生变化时使用的统一事件名称与数据结构，例如 `event.run.started`、`event.item.delta` 和 `event.item.completed`。

OAEP 称为“事件协议”，因为它规定 Agent 输出及状态变化的语义，但不绑定具体通信方式。同一 OAEP Event 可以通过本地 IPC、HTTP/SSE、WebSocket、SSH 隧道或 Runtime Relay 传输；连接、认证、心跳、重连和请求响应属于 Transport 或 Runtime Relay Protocol 的职责。

## 为什么需要 OAEP

OpenDrSai 不仅需要同时接入 OpenDrSai、Codex、Hermes 等 Agent Backend，还可能运行在 Windows 或 macOS 本地主机、远程 Linux 主机、服务器和 Android 设备上，并由 Desktop、移动端或其他客户端访问。不同 Backend 对会话、单次执行、消息、推理、工具、文件修改和审批使用不同的私有事件格式；不同运行位置又可能采用本地 IPC、HTTP/SSE、WebSocket、SSH 或 Relay 等不同传输方式。如果客户端直接理解每个 Backend 和运行环境的协议，就会产生重复适配、结构化内容丢失，以及不同设备、Backend 和连接方式下展示与行为不一致的问题。

OAEP 在 Agent Runtime 与客户端之间提供统一边界：Adapter 只需把 Backend 私有输出转换为 `Session → Run → Item` 和对应 Event，Desktop、移动端、Relay 与自动验收只消费 OAEP。无论 Runtime 位于本地主机、远程主机、服务器还是 Android 设备，也无论底层使用何种传输，都可以复用相同的会话与输出语义，同时支持流式显示、历史读取、断线恢复、幂等去重、审批、错误处理和端到端测试，而不让运行位置、传输方式或 Backend 私有协议侵入上层产品架构。

## 1. 领域模型

OAEP 使用三层公开领域模型：

```text
Session
└─ Run
   └─ Item
```

- **Session**：一段长期、多轮会话，对应 Codex Thread。
- **Run**：一次用户请求及其 Agent 执行，对应 Codex Turn。
- **Item**：Run 中可展示、可查询的结构化内容，对应 Codex Item。
- **Event**：Session、Run 或 Item 变化的内部不可变记录，是传输、重放、审计和恢复机制，不是第四层领域资源。
- **Delta**：`event.item.delta` 内部的增量变化 payload，不是独立领域对象、独立事件或独立传输消息。

历史查询直接返回 Session、Run 和最终 Item；实时执行通过 Event 通知变化。

## 2. Item 公共字段

```json
{
  "id": "item-uuid",
  "session_id": "session-uuid",
  "run_id": "run-uuid",
  "type": "message",
  "status": "running",
  "sequence": 1,
  "created_at": "2026-08-02T10:00:00Z",
  "updated_at": "2026-08-02T10:00:01Z",
  "source": {
    "backend": "codex",
    "backend_item_id": "codex-item-id"
  },
  "content": {}
}
```

Item 状态：

- `pending`：已创建，尚未开始。
- `running`：正在执行或产生内容。
- `waiting`：等待用户输入或审批。
- `completed`：正常完成。
- `failed`：执行失败。
- `cancelled`：被取消或中断。

`sequence` 是 Item 在 Run 中的展示顺序，不是 Event sequence。

## 3. OAEP v1 Item 类型

### 3.1 `message`

用户或 Agent 消息。`role` 为 `user | assistant | system`；`phase` 为 `commentary | final`。

```json
{"role":"assistant","phase":"final","text":"问题出在事件映射。","citations":[]}
```

### 3.2 `reasoning`

允许向用户展示的推理摘要，不代表模型原始思维链。

```json
{"segments":[{"id":"segment-1","text":"首先检查事件路由。"}]}
```

### 3.3 `plan`

结构化执行计划。Step 状态为 `pending | running | completed | failed | cancelled`。

```json
{"explanation":"先定位问题，再修改并测试。","steps":[{"id":"step-1","title":"检查事件路由","status":"running"}]}
```

普通进度由 Plan Step、Subtask 或执行类 Item 的状态表达，不单独定义 `progress` Item。

### 3.4 `command_execution`

Shell、进程或测试命令执行。

```json
{"command":["pytest","-q"],"display_command":"pytest -q","cwd":".","output":"42 passed","exit_code":0,"duration_ms":1250}
```

### 3.5 `file_change`

工作区文件创建、修改、删除或重命名。`operation` 为 `create | modify | delete | rename`。

```json
{"changes":[{"path":"src/event_mapper.py","operation":"modify","diff":"@@ ..."}],"summary":"完善事件映射"}
```

### 3.6 `tool_call`

非 Shell 类工具调用。`tool_kind` 为 `tool | mcp | web_search | browser | workspace | image_view | dynamic`。

```json
{"tool_kind":"mcp","tool_name":"github.search_code","server":"github","call_id":"call-1","arguments":{},"result":{},"duration_ms":320}
```

### 3.7 `artifact`

Agent 产生的持久化交付物。`artifact_type` 为 `file | image | document | spreadsheet | presentation | report | patch | web`。

```json
{"artifact_id":"artifact-1","artifact_type":"report","name":"测试报告","path":"reports/test.md","mime_type":"text/markdown","summary":"自动验收结果"}
```

`file_change` 描述工作区变化；`artifact` 描述可交付结果。

### 3.8 `interaction`

等待用户输入、确认或审批。`interaction_type` 为 `approval | confirmation | choice | text_input`。

```json
{"interaction_type":"approval","prompt":"是否允许执行 pytest？","options":[{"id":"accept","label":"允许"},{"id":"decline","label":"拒绝"}],"related_item_id":"command-1","response":null}
```

审批是 Interaction Item，不是独立顶层领域对象。

### 3.9 `subtask`

子 Agent 或委派任务。

```json
{"title":"检查协议兼容性","agent_name":"protocol-reviewer","child_run_id":"run-child-1","summary":"正在检查事件类型。","result":null}
```

### 3.10 `notice`

非对话型信息、警告或错误。`level` 为 `info | success | warning | error`。

```json
{"level":"warning","code":"model_rerouted","message":"请求已切换到其他可用模型。","details":{}}
```

Citation 默认作为 Message、Artifact 或 Tool Call 的附属数据；调试 Log 保留在内部诊断数据中，需要面向用户展示时投影为 Notice。

## 4. Event 公共字段

所有 Event 类型必须以 `event.` 开头。

```json
{
  "version": "1.0",
  "event_id": "event-uuid",
  "session_id": "session-uuid",
  "run_id": "run-uuid",
  "sequence": 12,
  "type": "event.item.delta",
  "timestamp": "2026-08-02T10:00:00Z",
  "item_id": "item-uuid",
  "dedupe_key": "codex:turn:item:delta:12",
  "source": {
    "backend": "codex",
    "backend_event_id": "codex-event-key"
  },
  "data": {}
}
```

规则：

- Event append-only，已经提交的 Event 不更新、不删除。
- `sequence` 在一个 Run 中严格递增；Session 级 Event 可以不携带 `run_id`，由 Session Journal 分配顺序。
- `event_id` 全局唯一；`dedupe_key` 在其生产者作用域内稳定。
- Item Event 必须携带 `item_id`。
- Delta 用于实时显示，最终 `event.item.completed.data.item` 是权威状态。

## 5. Event 类型

### 5.1 Session Event

```text
event.session.created
event.session.updated
event.session.archived
event.session.unarchived
event.session.deleted
```

### 5.2 Run Event

```text
event.run.created
event.run.started
event.run.waiting
event.run.resumed
event.run.completed
event.run.failed
event.run.cancelled
```

`event.run.waiting` 应携带等待原因及关联的 Interaction Item；恢复执行时发送 `event.run.resumed`。

### 5.3 Item Event

```text
event.item.created
event.item.started
event.item.delta
event.item.updated
event.item.completed
event.item.failed
event.item.cancelled
```

- `created`：Item 已持久化，通常为 `pending`。
- `started`：Item 开始执行或产生内容。创建后立即开始时可携带完整 Item 并省略 `created`。
- `delta`：可追加的流式增量。
- `updated`：非追加式结构化更新。
- `completed`：携带最终完整 Item。
- `failed`：携带失败后的完整 Item 和结构化 Error。
- `cancelled`：Item 被取消或因 Run 终止而中断。

## 6. Delta 类型

### 6.1 Delta 与 Event 的关系

Delta 保留，但必须位于 Event 内部：

```text
Session → Run → Item       公开领域模型
Event                      内部变化记录
└─ Delta                   event.item.delta 的内部 payload
```

因此不存在脱离 Event 单独传输或持久化的 Delta。合法结构是：

```json
{
  "type": "event.item.delta",
  "item_id": "message-1",
  "data": {
    "delta": {
      "kind": "message.text.append",
      "text": "新增内容"
    }
  }
}
```

以下结构不属于 OAEP：

```json
{
  "type": "message.text.append",
  "text": "新增内容"
}
```

Event 回答“哪个 Session、Run、Item 在什么顺序发生了变化”；其内部 Delta 回答“这次对 Item 追加了什么内容”。Delta 没有自己的 `event_id`、`sequence`、`timestamp` 或重放游标，这些全部由外层 Event 提供。

`event.item.delta.data.delta.kind` 的 v1 稳定枚举：

```text
message.text.append
reasoning.segment.added
reasoning.text.append
plan.text.append
command.output.append
tool.output.append
subtask.summary.append
```

示例：

```json
{
  "kind": "command.output.append",
  "stream": "stdout",
  "text": "test_example passed\n"
}
```

`file_change`、`artifact`、`interaction` 和 `notice` 默认不使用 Delta，使用 `event.item.updated` 或终态事件。

## 7. 标准 Run 事件序列

```text
event.run.created
event.item.created       User Message
event.item.completed     User Message
event.run.started
event.item.started       Reasoning / Plan / Tool / Command / Message
event.item.delta         zero or more
event.item.updated       zero or more
event.item.completed
event.run.completed
```

审批流程：

```text
event.item.started       Command，status=waiting
event.item.started       Interaction，status=waiting
event.run.waiting
event.item.completed     Interaction，包含用户决定
event.run.resumed
event.item.started       Command，status=running
event.item.completed     Command
event.run.completed
```

## 8. Codex App Server 映射

| Codex | OAEP |
|---|---|
| Thread | Session |
| Turn | Run |
| Item | Item |
| `thread/started` | `event.session.created` |
| `thread/archived` | `event.session.archived` |
| `turn/started` | `event.run.started` |
| `turn/completed: completed` | `event.run.completed` |
| `turn/completed: failed` | `event.run.failed` |
| `turn/completed: interrupted` | `event.run.cancelled` |
| `item/started` | `event.item.started` |
| `item/completed` | `event.item.completed` |
| `item/agentMessage/delta` | `event.item.delta` + `message.text.append` |
| `item/reasoning/*Delta` | `event.item.delta` + `reasoning.*` |
| `item/commandExecution/outputDelta` | `event.item.delta` + `command.output.append` |
| `turn/plan/updated` | Plan 的 `event.item.updated` |
| Approval server request | Interaction Item + `event.run.waiting` |
| Approval response | `event.item.completed` + `event.run.resumed` |

## 9. 兼容性原则

- 未识别的 Backend 私有事件不得直接暴露给 Desktop，应由 Adapter 映射为已知 Item、Notice，或仅进入诊断日志。
- 消费者必须忽略对象中其不理解的可选字段，但不得把未知 `type` 当成已知语义处理。
- v1 新增可选字段兼容；修改字段含义、删除枚举值或改变事件排序要求需要升级协议版本。
- OpenAI-compatible SSE 是兼容输出层，不是 OAEP 的事实来源。
