# Stream v2 协议

> **版本**: 2 | **状态**: WebUI 默认协议
>
> **相关代码**:
> - 后端投影器: `apps/webui/backend/.../web/stream_protocol.py`
> - 后端连接管理: `apps/webui/backend/.../web/managers/connection.py`
> - 前端 reducer: `apps/webui/frontend/.../chat/chatStreamReducer.ts`
> - 类型定义: `apps/webui/frontend/.../types/datamodel.ts`

---

## 1. 设计目标

旧协议把传输细节暴露给浏览器: `start_flag`、` ImmutableList`<think>` 标签、两条 TextMessage(流式+最终)。

v2 把这些投影成 **一条稳定的逻辑消息**，拥有:
- 独立的 `reasoning` 和 `content` 通道（前端不再自己剥 `<think>` 标签）
- 单调递增的 `seq` 序号（支持断线重连 + 历史回放）
- 稳定的 `message_id`（一个气泡一个 ID，全生命周期不变）
- 每帧 `event_id`（与 `seq` 组合实现「恰好一次」语义）

---

## 2. 事件类型总览

### 消息生命周期事件

| 事件 | 说明 | 必有字段 | 可选字段 |
|---|---|---|---|
| `message.started` | 新气泡创建 | `source`, `status="streaming"` | — |
| `message.delta` | 增量 token | `source`, `channel`, `delta` | — |
| `message.snapshot` | 推理快照（非增量） | `source`, `snapshot` | `status` |
| `message.completed` | 气泡封口 | `source`, `snapshot`, `status` | — |

### 回合控制事件

| 事件 | 说明 | 必有字段 | 可选字段 |
|---|---|---|---|
| `turn.ready` | 回合结束，可继续聊天 | `status="ready"`, `interaction` | `final_message_id` |
| `interaction.required` | 阻塞交互（审批/显式提问） | `status="awaiting_input"`, `interaction` | — |
| `agent.working` | 后端正在工作 | `status="active"`, `working` | — |

---

## 3. 事件帧结构

所有帧共享基础结构，通过 `type: "stream.v2"` 标识:

```json
{
  "type": "stream.v2",
  "protocol_version": 2,
  "event_id": "uuid（去重用）",
  "run_id": "run ID",
  "stream_id": "气泡流 ID",
  "message_id": "气泡唯一身份证",
  "seq": 1,
  "event": "message.started",
  "source": "Assistant"
}
```

### 字段说明

| 字段 | 类型 | 说明 |
|---|---|---|
| `type` | `"stream.v2"` | 固定值，前端据此进入 v2 reducer |
| `event_id` | `string(uuid4)` | **帧指纹** — 后端每发一帧 `uuid4()` 生成；写入 journal 后重放**不换 ID**；前端 `seenEventIds` 去重 |
| `run_id` | `string` | 本次 run 归属 |
| `stream_id` | `string(uuid4)` | **流级 ID** — 与 hop 一起在 `_ensure()` 生成；见 §3.1（现与 `message_id` 1:1） |
| `message_id` | `string(uuid4)` | **气泡身份证** — 同一个 message_id 的所有帧归到同一个聊天气泡（reducer 主键） |
| `seq` | `int` | **位置游标** — 单调递增，从 1 开始；检测乱序、断线重连 offset |
| `source` | `string` | `Assistant`, `user_proxy`, `user`, `system` 等 |
| `channel` | `"reasoning" \| "content"` | 仅 `message.delta`：增量属于哪个通道 |
| `delta` | `string` | 仅 `message.delta`：增量文本 |
| `snapshot` | `object` | `{reasoning, content, status}` |
| `status` | `string` | `streaming` / `completed` / `interrupted` / `ready` / `awaiting_input` / `active` |
| `interaction` | `object` | `turn.ready` / `interaction.required`：`{kind, interaction_type, prompt, request_id?}` |
| `working` | `object` | `agent.working`：`{phase, detail}` |
| `final_message_id` | `string` | 仅 `turn.ready`：本回合终稿气泡的 message_id |

### 3.1 身份字段怎么排（讲清「谁干什么」）

| 字段 | 粒度 | 一句话 |
|---|---|---|
| `run_id` | 整次 run | 哪一次对话 |
| `stream_id` | 「一段流」 | 设计上是流级 ID；**实现上每次开 hop 都与 `message_id` 成对新建，生命周期 1:1** |
| `message_id` | 一个气泡 | 真正的归并主键（`byId[message_id]`） |
| `seq` | 位置 | 「我该从哪一格继续？」— 乱序 / 补缺 / `resume_after_seq` |
| `event_id` | 一帧 | 「这一格我吃过没有？」— 至多一次去重 |

**`seq` + `event_id` 合起来才是「恰好一次」：**

- `seq` + journal 回放 → **至少一次**（帧丢了能补回来）
- `event_id` 去重 → **至多一次**（同一帧不会生效两次）

日常路径里 `lastSeq` 与 `seenEventIds` 锁步前进，所以多数重复会被 `seq <= lastSeq` 先拦住；`event_id` 是游标与「真实已见」脱钩时的保险（见 §13.4）。

**关于 `stream_id`：** 前端主路径不靠它做归并/去重；物化时写入 `metadata.stream_id`，持久化 `_persist_v2_hop` 也会带上。唯一逻辑消费在 `chatMessagePipeline.ts`：折叠「流式草稿 vs 终稿」时，若 `message_id` 缺失，用 `stream_id` 相等当兜底认「同一逻辑消息」。

**关于碰撞：** `event_id` / `message_id` / `stream_id` 都是随机 UUID，碰撞概率可忽略。要防的不是「两帧碰巧同 ID」，而是「同一帧被重发两次」（断线重放）——那本来就该撞上 `seenEventIds`。

---

## 4. 消息生命周期

一个气泡从创建到封口:

```
message.started → message.delta(*) → [message.snapshot?] → message.completed
```

### 4.1 message.started

新气泡创建。后端 `active` 里没有该 source 的 hop 时触发。

前端：创建新 `StreamMessageEntity`，`plane = "final"`，`status = "streaming"`。

### 4.2 message.delta

增量 token，`channel` 区分推理和正文:

```json
{"event": "message.delta", "channel": "reasoning", "delta": "用户"}
{"event": "message.delta", "channel": "content", "delta": "你好"}
```

前端：追加到 `entity[channel]`。如果 `status === "completed"`（迟到 token），降级回 `"streaming"` 继续追加。

### 4.3 message.snapshot

推理快照（非增量），由 `ThoughtEvent` 触发。

前端：取 `max(snapshot.content, entity.content)` — **快照不能让可见内容变短**。

### 4.4 message.completed

气泡封口，两种 status:

- `"completed"` — 正常完成（终稿或用户消息）
- `"interrupted"` — 工具边界打断（当前气泡先结束，后续 token 开新气泡）

前端行为:
- `completed` 且非 user 源 → 加入 `sealedFinalIds`，`plane = "final"`
- `interrupted` → `plane = "process"`（进处理过程框）
- user/user_proxy 的 completed → 不 seal，设 `status = "active"` + `agent_working = {phase: "model"}`（agent 即将工作）

---

## 5. 回合控制

### 5.1 turn.ready

回合正常结束，等待用户下一条消息。

后端流程:
1. `seal_active_assistant()` — 封口所有未封的 assistant hop
2. `emit_turn_ready()` — 发 `turn.ready`，带 `final_message_id`
3. `close_turn()` — 清空 `active` 和 `latest_by_source`

前端流程:
1. `sealTurnPlanes()` — 把 `final_message_id` 标为 `final` + `completed` + seal；其余未 seal 的 final 候选降级为 `process`
2. 设 `status = "ready"`，清 `agent_working`

### 5.2 interaction.required

阻塞交互（审批/显式提问）。与 `turn.ready` 互斥。前端设 `status = "awaiting_input"`。

### 5.3 agent.working

后端正在工作，前端应显示 loading。`phase` 取值: `model`（等模型响应）、`tool`（执行工具）、`orchestrator`（编排器决策）。

助手 `message.completed(keep_open=True)` **不是**回合结束。多 hop（planner 派活 → 子智能体工具）中间若无 token，必须补发本事件，否则前端会把 hop 封口当成 `turn.ready` 并清掉 loading。见 [`stream-v2-planner-hop-loading-gap.md`](./stream-v2-planner-hop-loading-gap.md)。

---

## 6. turn_plane: process vs final

| plane | 含义 | 渲染位置 |
|---|---|---|
| `final` | 回合终稿回复 | 主线程，全宽气泡 |
| `process` | ReAct 中间步骤 | 可折叠「处理过程」框 |

### 赋值规则

| 条件 | plane |
|---|---|
| 新建 entity | `final` |
| `message.completed` status=`interrupted` | `process` |
| `message.completed` status=`completed` 且非 user 源 | `final` + seal |
| `turn.ready` 时未被选为 final 的候选 | 降级为 `process` |
| 已 seal 的 entity | 不变（不会被降级） |

前端 `buildTurnSegments()` 按 `turn_plane` 分配槽位，**忽略数组顺序** — 只要 `turn_plane` 正确，渲染就是对的。

一个用户回合的固定布局:

```
用户消息 (turn lead)
├── 处理过程框 (process[])
│   ├── 思考 / 工具调用 / 旁白 / 日志
└── 终稿 (final) — assistant 完整回复
```

---

## 7. 后端投影器 StreamProjector

### 核心数据结构

```
active: Dict[source, _MessageState]         # 当前活跃 hop（可继续追加 token）
snapshots: Dict[message_id, _MessageState]   # 所有 hop 快照（用于回放）
latest_by_source: Dict[source, _MessageState] # 每个 source 最近的 hop
journal: Deque[event]                        # 事件日志（断线重放）
```

### 关键方法

| 方法 | 说明 |
|---|---|
| `begin_turn()` | 回合开始: 标记 active 为 interrupted, 清空 active + latest_by_source |
| `ingest_chunk(source, chunk)` | 处理流式 token: 拆 ` ImmutableList` 标签, 分发到 reasoning/content 通道 |
| `ingest_thought(source, thought)` | 处理 ThoughtEvent: 更新 reasoning 快照 |
| `complete(source, content, keep_open)` | 封口气泡; `keep_open=True` 时留在 active 供迟到 token 追加 |
| `interrupt()` | 工具边界: 把所有 active hop 标为 interrupted 并封口 |
| `seal_active_assistant()` | 封口所有非 user 的 active hop |
| `close_turn()` | 清空 active + latest_by_source（turn.ready 后调用） |
| `replay_after(last_seq)` | 断线重连: 回放 journal 中 seq > last_seq 的事件 |

### ingest_chunk 的 hop 选择逻辑

```
1. 从 active[source] 取 hop
2. 如果没有, 从 latest_by_source[source] 取
3. 如果 latest 的 status 是 interrupted/completed → 视为已关闭, state = None
4. state = None → _ensure() 创建新 hop（新 message_id）
5. 否则复用现有 hop（追加 token）
```

> **注意**: `active` 里的 hop 不检查 status。`keep_open=True` 的 completed hop 留在 active 里，
> 同回合的迟到 token 仍然追加到它。回合边界由 `close_turn()` 或 `seal_active_assistant()` 清除。

### complete 的去重逻辑

- hop 已 completed 且内容相同且 `keep_open=False` → 返回 `[]`（不重复发 completed）
- hop 已 completed 且内容相同且 `keep_open=True` → 从 active 弹出, 返回 `[]`

---

## 8. 后端事件路由 (connection.py)

Agent 事件 → StreamProjector → WS 帧:

| Agent 事件 | v2 投影 | 是否落库 |
|---|---|---|
| `ModelClientStreamingChunkEvent` | `ingest_chunk` → `message.started` + `message.delta` | 否 |
| `ThoughtEvent` | `ingest_thought` → `message.snapshot` | 可选 |
| `TextMessage` (user/user_proxy) | `complete` → `message.completed` | 是 |
| `TextMessage` (assistant) | `complete(keep_open=True)` → `message.completed` | 是 |
| `ToolCallRequestEvent` 等 | `interrupt()` → `message.completed(interrupted)` + 旧格式帧 | 是 |
| `UserInputRequestedEvent` | 丢弃 | — |
| `CheckpointEvent` | 不发前端, 压缩进 `run.state` | 状态 |

### 用户消息的特殊处理

当 `user_proxy` 的 TextMessage 到达时（新回合开始）:
1. **先 `seal_active_assistant()`** — 清掉上一轮残留的 keep_open assistant hop
2. `complete(user_proxy, content)` — 创建用户气泡
3. **发 `agent.working phase=model`** — 通知前端 agent 开始工作（避免首 token 前无反馈）

---

## 9. 前端 reducer (chatStreamReducer.ts)

### 状态

```typescript
interface ChatStreamState {
  lastSeq: number;                    // 最后处理的 seq
  seenEventIds: Set<string>;           // 去重
  byId: Record<message_id, StreamMessageEntity>;
  order: string[];                    // 气泡出现顺序
  pending: Map<seq, StreamV2Event>;    // 乱序事件缓冲
  needsResume: boolean;               // 需要发 stream.resume
  sealedFinalIds: Set<string>;        // 已 seal 的 final 气泡
}
```

### 事件处理流程

```
reduceStreamEvent(state, event):
  1. 去重: event_id 已见过 / seq <= lastSeq → 丢弃
  2. 乱序: seq > lastSeq + 1 → 进 pending, 发 stream.resume
  3. snapshot 可以打破乱序: 直接应用, 清 pending
  4. applyOrderedEvent:
     - turn.ready → sealTurnPlanes（选定 final, 其余降级 process）
     - interaction.required / agent.working → 只推进 lastSeq
     - message.started → demoteUnsealedCandidates
     - message.delta → 追加到 entity[channel]
     - message.snapshot/completed → 取 max(快照, 现有) 更新
  5. 按序消费 pending 中连续的事件
```

调用链：`useChatWebSocket` 收到 WS 帧 →（可选 `LegacyStreamAdapter`）→ `reduceStreamEvent` → 写回 `streamStateRef`。新 run 时 `createChatStreamState` 清空 `seenEventIds` / `lastSeq`。

### 「见过」是什么意思（`seenEventIds`）

**不是「WS 收到就算见过」，而是「已经成功 `applyOrderedEvent` 过」才算见过。**

| 时机 | 代码行为 |
|---|---|
| **判定丢弃** | `reduceStreamEvent` 入口：`state.seenEventIds.has(event.event_id)` 或 `event.seq <= state.lastSeq` → `return state` |
| **写入** | 仅在 `applyOrderedEvent` 开头：`seenEventIds.add(event.event_id)`，并推进 `lastSeq` |
| **乱序缓冲** | `seq > lastSeq + 1` 时只进 `pending`，**不**写入 `seenEventIds`；缺口补齐后再 apply 才记 |

```
WS onmessage → reduceStreamEvent
  ├─ seenEventIds.has(event_id)? ──是──→ 丢（至多一次）
  ├─ seq <= lastSeq?              ──是──→ 丢
  ├─ seq > lastSeq+1?             ──是──→ pending（还不算见过）
  └─ applyOrderedEvent → add(event_id) + lastSeq = seq
```

典型第二次撞上 `has(event_id)`：断线后 `stream.resume` 把 journal 原件（同一 `event_id`）再推一遍，而该帧此前已 apply。

### materializeStreamMessages

把 entity 转成 `Message[]` 供渲染。`plane === "final"` 时 content 为纯正文; `plane !== "final"` 且有 reasoning 时 content 包成 ` ImmutableList... ImmutableList`。

### reconcilePersistedMessages

DB 持久化消息与 live 状态合并。用持久化顺序做骨架，避免 DB 用户行追加到 live assistant 回复之后（"答案在上/问题在下"）。

---

## 10. 断线重连

1. 前端 WebSocket 重连后发 `stream.resume`，带 `resume_after_seq = lastSeq`（`useChatWebSocket` 的 `onopen` / `needsResume`）
2. 后端 `replay_after(last_seq)`:
   - journal 中有 seq > last_seq 的事件 → **按序回放原件**（同一 `event_id`、同一 `seq`，不重新生成）
   - journal 不够（太老，超出 `journal_size=512`）→ 回退到当前 snapshots 的 `message.snapshot`
3. 前端收到回放后：`seq <= lastSeq` 与 `seenEventIds` 双闸去重，只 apply 未见过的

**为何需要 `event_id` 而不只靠 `seq`：** 若客户端报的 `resume_after_seq` 偏旧（例如 ref 竞态），后端会重放已消费过的帧；`seq <= lastSeq` 通常已能拦，但游标与真实已见脱钩、或将来重发路径重编 seq 时，只有稳定的 `event_id` 仍能认出「这帧吃过」。

---

## 11. 旧协议兼容

前端未声明 `stream_protocol: 2` 时走旧协议（`message_chunk` / `message` / `message_thinking` 等）。

v2 客户端收到旧帧时，`LegacyStreamAdapter` 把它改编成 v2 事件再进同一个 reducer:
- `message_chunk` → `message.delta` (content)
- `message_thinking` → `message.snapshot` (reasoning)
- `message` → `message.completed`

---

## 12. 时序图

### 12.1 正常单回合

```
前端                    后端(connection)           StreamProjector          Agent
 │                         │                          │                     │
 │── stream.start ────────►│                          │                     │
 │                         │── begin_turn() ─────────►│                     │
 │                         │── run_agent ─────────────────────────────────►│
 │                         │                          │   ◄── chunk ─────────│
 │                         │◄── ingest_chunk ─────────│                     │
 │◄── message.started ─────│                          │                     │
 │◄── message.delta ───────│   ◄── chunk (×N) ────────│   ◄── chunk ─────────│
 │   ...                    │                          │                     │
 │                         │                          │   ◄── TextMessage ───│
 │                         │◄── complete(keep_open=T)─│                     │
 │◄── message.completed ───│                          │                     │
 │                         │── input_func ─────────────────────────────────►│
 │                         │   (UserInputRequested)    │                     │
 │                         │◄── emit_turn_ready ──────│                     │
 │◄── turn.ready ──────────│                          │                     │
 │                         │── close_turn() ─────────►│                     │
```

### 12.2 多回合（含工具调用）

```
前端                    后端                    Projector             Agent
 │── "选线站" ───────────►│                        │                    │
 │                         │── begin_turn() ───────►│                    │
 │                         │── run_agent ──────────────────────────────►│
 │                         │                        │  ◄── chunk ────────│
 │◄── message.started/delta│◄── ingest_chunk ───────│                    │
 │                         │                        │  ◄── ToolCall ─────│
 │                         │◄── interrupt() ─────────│                    │
 │◄── message.completed(I) │                        │  ◄── ToolResult ───│
 │◄── tool.* (旧格式)      │                        │                    │
 │                         │                        │  ◄── chunk ────────│
 │◄── message.started/delta │◄── ingest_chunk ───────│                    │
 │                         │                        │  ◄── TextMessage ──│
 │                         │◄── complete(ko=T) ──────│                    │
 │◄── message.completed    │                        │                    │
 │                         │── input_func ──────────────────────────────►│
 │                         │◄── emit_turn_ready ─────│                    │
 │◄── turn.ready ──────────│── close_turn() ───────►│                    │
```

### 12.3 断线重连

```
前端                    后端                    Projector
 │   (WS 断开)            │                        │
 │── stream.start ───────►│                        │
 │   (resume_after_seq=N) │── replay_after(N) ────►│
 │                         │                        │
 │                         │   journal 中 seq>N 的事件按序回放
 │                         │   或 snapshots 的 message.snapshot
 │                         │◄── events ─────────────│
 │◄── message.* (重放) ────│                        │
 │   (event_id 去重)        │                        │
```

### 12.4 "答案在上" bug 触发场景（已修复）

```
回合1: assistant TextMessage keep_open=True, status=completed 留在 active
         │
         │  (input_func 未触发 → close_turn 未执行 → active 未清)
         │
回合2: user_proxy TextMessage 到达
         │
  修复前: 直接 complete(user_proxy) → 新用户气泡用新 message_id
          → 回合2 reasoning 到达 → ingest_chunk 从 active[assistant] 取到旧 hop
          → 复用旧 message_id → reasoning 渲染在回合1位置（用户气泡之上）
         │
  修复后: user_proxy 到达 → 先 seal_active_assistant() 封口旧 hop
          → complete(user_proxy) → 新用户气泡
          → 回合2 reasoning → active[assistant] 已空 → _ensure() 新 message_id
          → reasoning 渲染在用户气泡之下 ✓
```

---

## 13. 已知问题与设计权衡

### 13.1 keep_open 的必要性

Agent 的 `TextMessage` 完成后，流式 chunk 可能还有迟到的 token（网络抖动、缓冲）。`keep_open=True` 让这些迟到 token 追加到原 hop 而不是开新气泡。代价是: 必须在回合边界主动清理 active，否则下一回合会复用旧 hop。

### 13.2 input_func 与 turn.ready 的耦合

`turn.ready` 只在 `input_func` 被调用时发出。如果 round-robin 没有轮到 user_proxy（agent 自行结束），`input_func` 不触发，`turn.ready` 不会发出，`close_turn()` 也不会执行。这是 "答案在上" bug 的触发条件之一。修复方案在 `user_proxy` 消息到达时主动 `seal_active_assistant()`，不再依赖 `close_turn()`。

### 13.3 乱序与 snapshot

网络可能导致 WS 帧乱序。reducer 用 `pending` 缓冲 + `stream.resume` 补帧。`message.snapshot` 可以打破乱序（直接覆盖），用于断线重连后快速同步状态。

### 13.4 去重与「恰好一次」

- **前端双闸**（`reduceStreamEvent`）: `seenEventIds.has(event_id)` **或** `seq <= lastSeq`，任一命中就丢
- **后端**: `complete()` 的内容比对防止重复发 `message.completed`
- **诚实说明**: 正常单连接路径下 `lastSeq` 与 `seenEventIds` 同步推进，多数重复被 `seq` 闸拦住；`event_id` 是幂等保险，不是日常主路径。它单独发力的情形包括：
  1. 重连 `resume_after_seq` 偏旧，journal 重放已消费帧
  2. `message.snapshot` 大跳游标后，回放链路上身份与位置脱钩
  3. `LegacyStreamAdapter` 重建后私有 `seq` 可能撞号，只剩 UUID 可靠
  4. 将来发送层「至少一次」重试且重编了 `seq`

### 13.5 planner hop 封口后的 loading 空窗

助手 `TextMessage` 的 `complete(keep_open=True)` 会先发 `message.completed(status=completed)`。前端若把它映射成 `status=ready` 并清 `agent_working`，MagenticOne / planner 下一跳（非流式 JSON、选 speaker、远程 worker 首包）会静默十几到几十秒，直到工具 `interrupt()`。修复说明见 [`stream-v2-planner-hop-loading-gap.md`](./stream-v2-planner-hop-loading-gap.md)。

### 13.6 stream_id 与 message_id

设计上「流」可比「气泡」更粗（例如多个 interrupted hop 共享一个 stream）。当前实现每次 `_ensure()` 都新开一对 UUID，因此 **一个 hop = 一个 `message_id` = 一个 `stream_id`**。讲协议时勿把 `stream_id` 说成与 `seq`/`event_id` 同级的运行时机制。

---

## 附录 A: 事件字段速查

```typescript
interface StreamV2Event {
  type: "stream.v2";
  protocol_version: 2;
  event_id: string;         // uuid4, 帧指纹；重放不换
  run_id: string;
  stream_id: string;        // uuid4, 现与 message_id 1:1
  message_id: string;       // uuid4, 气泡归并主键
  seq: number;              // 单调递增位置游标
  event: "message.started" | "message.delta" | "message.snapshot" |
         "message.completed" | "turn.ready" | "interaction.required" |
         "agent.working";
  source: string;
  channel?: "reasoning" | "content";
  delta?: string;
  snapshot?: { reasoning: string; content: string; status: string };
  status?: string;
  interaction?: object;
  working?: { phase: string; detail?: string };
  final_message_id?: string;
}
```

## 附录 B: 文件索引

| 文件 | 职责 |
|---|---|
| `backend/web/stream_protocol.py` | StreamProjector — 流投影、hop 管理、journal |
| `backend/web/managers/connection.py` | 事件路由、input_func、turn 控制 |
| `backend/web/routes/ws.py` | WebSocket 路由、stream.resume |
| `frontend/src/pages/chat/chatStreamReducer.ts` | 前端 reducer、乱序处理、materialize |
| `frontend/src/pages/chat/chatTurnDocument.ts` | buildTurnSegments — 回合分段渲染 |
| `frontend/src/pages/chat/hooks/useChatWebSocket.ts` | WS 事件分发、状态联动 |
| `backend/tests/test_stream_protocol.py` | 协议回归测试 |
