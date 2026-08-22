# Android Agent Runtime → OAEP 映射基线

状态：第 8 阶段 M01 冻结基线  
协议：OAEP Stable 1.0 / `oaep.session-stream/1`  
内部传输：Android Runtime Envelope v1

## 边界

Android Runtime Envelope 只负责 App 与 `:runtime` 进程之间的命令、Host 请求、生命周期和内部状态传输。公开执行语义必须先转成 `NormalizedAgentEvent`，再由 Android OAEP Writer 分配 OAEP ID、Session sequence、Item revision 并原子写入 Journal 与 Projection。

以下模块不得解析 Python `kind` 或依赖 `PythonRuntimeEnvelope`：UI、Room OAEP Projection、Relay、Legacy Projection、通知和自动验收。

## 当前 Python 事件映射

| Python kind | Normalized 语义 | OAEP 输出 | 处理 |
|---|---|---|---|
| `run.started` | RunStarted | `event.run.started` | map |
| `run.recovered` | RunResumed | `event.run.resumed` | map |
| `run.completed` | RunCompleted | `event.run.completed` | map |
| `run.cancelled` | RunCancelled | `event.run.cancelled` | map |
| `run.failed` | RunFailed | `event.run.failed` | map |
| `runtime.degraded` | Notice completed | `event.item.completed` / notice | map |
| `message.delta` | Message ItemDelta | `event.item.delta` / text | map |
| `message.completed` | Message ItemCompleted | `event.item.completed` / message | map |
| `tool.started` | Tool ItemStarted | `event.item.started` / tool_call | map |
| `tool.result` | Tool ItemCompleted | `event.item.completed` / tool_call | map |
| `tool.error` | Tool ItemFailed | `event.item.failed` / tool_call | map |
| `tool.downgraded` | Notice completed | `event.item.completed` / notice | map |
| `approval.requested` | Interaction ItemStarted + RunWaiting | `event.item.started`, `event.run.waiting` | map |
| `approval.decided` | Interaction ItemCompleted + RunResumed | `event.item.completed`, `event.run.resumed` | map |
| `artifact.created` | Artifact ItemCompleted | `event.item.completed` / artifact | map |
| `subagent.started` | Subtask ItemStarted | `event.item.started` / subtask | map |
| `subagent.thinking` | Subtask ItemDelta | `event.item.delta` / summary | map |
| `subagent.completed` | Subtask ItemCompleted | `event.item.completed` / subtask | map |
| `subagent.cancelled` | Subtask ItemCancelled | `event.item.cancelled` / subtask | map |
| `checkpoint.saved` | Host checkpoint | 无公开 Event | internal state |
| 未知 kind | Notice completed + bounded diagnostic | `event.item.completed` / notice | notice |

## Host 请求

| Envelope message type | OAEP 关系 | 规则 |
|---|---|---|
| `model_request/chunk/completed/failed` | 驱动 Message/Reasoning/Plan Item | 原始请求不是 OAEP Event；模型输出语义必须进入 Writer |
| `tool_call_request/tool_result` | 驱动 Tool Call Item | intent 与 receipt 先持久化，恢复时按 call ID 去重 |
| `approval_request/result` | 驱动 Interaction Item 与 Run waiting/resumed | approval/call ID 稳定，第一决定胜出 |
| `artifact_request/result` | 驱动 Artifact Item | operation ID 稳定，未知副作用进入 reconciliation |
| `checkpoint_request` | 绑定 OAEP Run 水位 | Checkpoint 不是公开 Item/Event |
| `lifecycle_changed` | 可能驱动 Run waiting/resumed | 只有用户可观察状态变化才写 OAEP |

## 身份与顺序

- Envelope `session_id`、`run_id` 必须与 Writer scope 完全一致。
- Backend `call_id`、`subagent_id` 等仅作为稳定 binding/source metadata，不充当 OAEP Event ID。
- Event sequence 由 Writer按 Session 分配；Envelope sequence 仅用于 IPC 去重和排序。
- 同一 Backend item 的 started/delta/completed 必须解析为同一 OAEP Item ID。
- 未知事件只记录 kind 的最多 128 个字符，不保存原始私有 payload。
