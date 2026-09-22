# Stream v2：planner hop 封口后的 loading 空窗

> **状态**: 待修  
> **协议**: [`stream-v2-protocol.md`](./stream-v2-protocol.md)  
> **相关代码**:
> - 前端 WS 状态: `apps/webui/frontend/src/pages/chat/hooks/useChatWebSocket.ts`
> - 前端 loading: `apps/webui/frontend/src/pages/chat/runview.tsx`
> - 后端连接: `apps/webui/backend/src/drsai_ui/ui_backend/backend/web/managers/connection.py`
> - 投影器: `apps/webui/backend/src/drsai_ui/ui_backend/backend/web/stream_protocol.py`

---

## 1. 现象

MagenticOne / `planner_agent` 多 hop 时，前端会出现一段 **十几到几十秒的静默**：planner 已经把任务派出去了，界面既没有新 token，也没有任何 loading。

典型帧（同一 `message_id` / `stream_id`）：

| seq | 时间 | event | snapshot.status | 含义 |
|---|---|---|---|---|
| 226 | 10:17:59 | `message.completed` | `completed` | planner `TextMessage` 封口（`keep_open=True`） |
| — | ~26s | **无任何 stream 事件** | — | orchestrator 非流式 JSON / 选 speaker / 远程 worker 首包 |
| 227 | 10:18:25 | `message.completed` | `interrupted` | 子智能体工具边界，`interrupt()` |

这两条不是两条不同回复，而是 **同一条 planner 气泡被封了两次**。

---

## 2. 根因

助手 `message.completed(keep_open=True)` 被前后端都当成了 `turn.ready`。多 hop 里这只是派活；后面几十秒没事件，loading 就被清光了。

### 2.1 后端：planner 封口后不发 `agent.working`

`connection.py` 对助手 `TextMessage` 走 `complete(..., keep_open=True)`，立刻发出 `message.completed(status=completed)`，hop 留在 `active` 里给迟到 token 追加。

随后只在 **user / user_proxy** 封口后补 `_emit_agent_working(phase="model")`。助手 / planner 封口后 **不发 working**。

真正的下一跳常常是：

1. Orchestrator `_get_json_response()` → `model_client.create()`（**不流式**）
2. `_request_next_speaker(data_explorer_agent)`
3. 远程 worker / 模型首包

直到子智能体打出 `ToolCallRequestEvent`（或 execution / summary），才 `interrupt()` + `_emit_agent_working(phase="tool")`。`agent.working` 出现在 seq 227 **之后**，226→227 之间是空窗。

### 2.2 前端：把助手 completed 映射成 `ready`

`useChatWebSocket.ts` 收到非 user、非 interrupted 的 `message.completed` 时：

- `nextAgentWorking = null`（无条件清 spinner）
- `nextStatus = "ready"`（当成整轮结束）

`runview.tsx` 的 loading 条件：

```ts
showAgentWorking =
  !hasLiveAssistantDraft &&
  (!!run.agent_working ||
    (run.status === "active" && !hasAssistantOutputAfterLastUser));
```

planner 正文已经上屏后，fallback 永远是 false。loading **只能**靠 `run.agent_working`。seq 226 把它清掉且把 status 打成 `ready`，所以完全没灯。

seq 227 `interrupted` 分支不会把 status 改回 `active`，也不会自己设 `agent_working`。要等紧跟着的 `agent.working(tool)` spinner 才回来。

### 2.3 因果链

```
planner TextMessage
  → message.completed (completed, keep_open)
  → 前端：ready + 清 loading          ← seq 226
  → 后端：选人 / 远程 worker / 模型首包（无 stream 事件）  ← ~26s
  → ToolCall*
  → message.completed (interrupted)   ← seq 227
  → agent.working(tool)               ← loading 这时才该出现
```

空窗不是 WebSocket 卡死，是 hop 被过早标成 completed，而真正干活的那段没有 working 事件。

---

## 3. 改完后必须成立的协议约定

1. **只有 `turn.ready` 表示这一轮结束。** 助手 `message.completed` 只是 hop 封口，不是回合结束。
2. `keep_open=True` 的语义：回合还在继续；composer 可以提前解锁，但 **必须还能显示 working**。
3. `interrupted` = 工具边界，回合继续。
4. 静默等待（无 token）必须有 `agent.working`，否则 UI 无法区分「结束了」和「还在算」。

不要改：

- `stream_protocol.py` 的 `complete(keep_open=True)` / `interrupt()` 语义
- `chatStreamReducer.ts` 把 `completed` hop seal 成 `final`（避免被下一跳推进「处理过程」）

---

## 4. 必改

### 4.1 前端：不要把助手 completed 当成 ready

文件：`apps/webui/frontend/src/pages/chat/hooks/useChatWebSocket.ts`  
位置：`handleWebSocketMessage` 里 `event.event === "message.completed"` 分支

**现在（错）：**

```ts
} else if (event.event === "message.completed") {
  nextAgentWorking = null;
  const completedStatus =
    event.status || event.snapshot?.status || "completed";
  if (completedStatus !== "interrupted") {
    if (event.source === "user" || event.source === "user_proxy") {
      nextStatus = "active";
      nextAgentWorking = { phase: "model" };
    } else {
      nextStatus = "ready";
    }
  }
}
```

**改成：**

```ts
} else if (event.event === "message.completed") {
  const completedStatus =
    event.status || event.snapshot?.status || "completed";
  const isUser =
    event.source === "user" || event.source === "user_proxy";

  if (isUser) {
    nextStatus = "active";
    nextAgentWorking = { phase: "model" };
  } else if (completedStatus === "interrupted") {
    // 工具边界：回合未结束。不要 ready，不要清 working。
    // 后端紧跟着会发 agent.working(tool)；若迟到，先占位。
    nextStatus = "active";
    if (!nextAgentWorking) {
      nextAgentWorking = { phase: "tool" };
    }
  } else {
    // 助手 hop 封口（含 planner keep_open completed）。
    // 不是 turn.ready：保持 active，并显示 working，
    // 覆盖「下一跳 LLM / 选人 / 远程 worker」的无事件空窗。
    nextStatus = "active";
    nextAgentWorking = { phase: "orchestrator" };
  }
}
```

保持不变：

- `turn.ready` → `ready` + 清 `agent_working`
- `message.delta` / `snapshot` / `started` → 有可见 token 时清 working
- reducer 的 seal / plane 逻辑

### 4.2 后端：助手 hop 封口后补发 `agent.working`

文件：`apps/webui/backend/src/drsai_ui/ui_backend/backend/web/managers/connection.py`  
位置：`TextMessage` 处理，`projector.complete(..., keep_open=True)` 并 send / persist 之后

**现在：** 只在 `source in _USER_SOURCES` 时 `_emit_agent_working(phase="model")`。

**改成：** user 仍发 `model`；非 user 的 keep_open complete 之后也发：

```python
for event in events:
    await self._send_message(run_id, event)
# ... persist ...

if source in _USER_SOURCES:
    await self._emit_agent_working(run_id, phase="model", detail="")
else:
    # keep_open completed ≠ turn.ready。下一跳可能是
    # orchestrator 非流式 JSON / 选 speaker / 远程 worker 首包，
    # 中间可以几十秒没有任何 stream 事件。
    await self._emit_agent_working(
        run_id,
        phase="orchestrator",
        detail=source,
    )
continue
```

工具路径已有 `interrupt()` + `_emit_agent_working(phase="tool")`，不要删。

### 4.3 前端 loading 条件：相信 `agent_working`

文件：`apps/webui/frontend/src/pages/chat/runview.tsx`

`showAgentWorking` **不用改公式**。planner 正文上屏后 fallback 永远 false，所以空窗必须靠 `run.agent_working` 非空（§4.1 + §4.2）。

`turnSettledVisually` 依赖 `!run.agent_working`。有 working 时：

- 显示「正在调度智能体…」
- 不要把 process group / status icon 伪装成 ready

**不要**再加「有助手正文就藏 spinner」——那会把 planner 派任务后的空窗再次藏掉。

单智能体最终答案出完到 `turn.ready` 之间可能短暂出现 spinner。默认接受；若不可接受见 §5。

---

## 5. 可选（非必须）

MagenticOne `Orchestrator._get_json_response` 用 `model_client.create()`，不走流式。不要在 orchestrator 里塞 UI 协议；working 仍由 connection 的 stream loop 发。

若单智能体「答案已经完整却闪一下调度中」不可接受：后端只对 metadata `type in {plan_message, step_execution}`，或 source 匹配 `planner` / `orchestrator` 的 hop 发 `phase=orchestrator`。

**默认仍建议所有非 user keep_open complete 都发**，空窗一定有灯，逻辑更简单。

---

## 6. 验收

1. planner `completed` 之后、子 agent 工具事件之前：必须出现 AgentWorkingIndicator（「正在调度智能体…」），不能静默。
2. 同一 `message_id` 后续 `interrupted`：气泡还在，loading 切到「正在调用工具…」，不能变 `ready`。
3. 真正结束：只有 `turn.ready` 后 `status=ready`、spinner 消失、composer 解锁。
4. 单智能体正常问答：最终答案出完到 `turn.ready` 可以有短暂 working；**不能**再把中间 hop 的 completed 当成整轮结束。
5. 回归：用户消息发出后仍立即有 loading（user completed → `agent.working model`）。

---

## 7. 排查信号

同一 `message_id`，seq N `message.completed(completed)`，seq N+1 隔几十秒 `message.completed(interrupted)`，中间没有 `agent.working` / `message.delta`。修完后 N 与 N+1 之间至少应有一条 `agent.working(phase=orchestrator)`。
