## 15 中断与退出

### 15.1 Ctrl+C 中断

新版 TUI 的 Ctrl+C 行为与旧版单进程 REPL **不同**，具体取决于当前状态：

| 状态 | Ctrl+C 行为 | 说明 |
|------|------------|------|
| **streaming（LLM 流式输出中）** | 发送 `prompt.cancel` RPC，立即中断当前流 | TUI `useInput` 拦截 → `controller.cancel()` → `prompt.cancel` RPC → `agent.interrupt()` |
| **空闲（等待用户输入）** | 进程收到 SIGINT → **直接退出** | 无 `useInput` 拦截，`entry.tsx` 的 `process.once('SIGINT')` 触发 `process.exit(130)` |

> ⚠️ **注意**：空闲状态下按 Ctrl+C 会**立即退出进程**，不会保存对话状态。如需优雅退出，请使用 `/quit` 或 Ctrl+D。

**中断流程（streaming 期间）**：
```
Ctrl+C (streaming)
  → TUI composerPane useInput 捕获 → controller.cancel(sessionId)
  → JSON-RPC prompt.cancel {session_id}
  → Gateway AgentSession.interrupt()
      1. agent.pause()  — 设置 CancellationToken + is_paused=True
      2. loop.call_soon_threadsafe(_cancel_all_tasks)
             — 取消 agent 事件循环上所有正在等待的 asyncio Task
             — 即使 LLM HTTP 请求正在等待响应，也立即抛出 CancelledError
      3. sleep(0.2s) — 等待取消传播
  → _async_run_turn 捕获 CancelledError
      → await agent.resume()  — 重置 is_paused=False（关键！否则下次对话失效）
      → status = "interrupted"，发出 message.complete 事件
  → 用户可继续输入下一条消息
```

> 💡 **修复说明（2026-06）**：旧版 `interrupt()` 只做 `pause() + sleep(50ms) + resume()`，50ms 远不足以等待 LLM HTTP 响应，导致 Ctrl+C 实际无效。新版直接取消 asyncio Task，并在 `_async_run_turn` 的异常处理中重置 `is_paused`，确保中断后 agent 可正常接受下一条消息。

**Gateway 进程免疫 SIGINT**：Python gateway 子进程完全忽略终端 Ctrl+C 信号，取消只能通过 RPC `prompt.cancel` 发起。

### 15.2 退出命令

| 命令 | 别名 | 说明 |
|------|------|------|
| `/quit` | `/exit`, `/q` | 优雅退出：通知 gateway 保存所有 session 状态后退出 |
| Ctrl+D | — | 优雅退出：发送 `gateway.shutdown` RPC，等待 gateway 保存状态（最多 5 秒），超时后强制终止 |

**退出流程（`/quit`）**：
```
/quit → TUI slash 命令 → controller.gw.kill() → useApp().exit()
  → gateway 子进程终止（状态已在各轮对话后自动保存）
```

**退出流程（Ctrl+D）**：
```
Ctrl+D → App useInput 捕获 → isExitingRef 防重入
  → gw.request('gateway.shutdown', {})  [异步，不等待]
  → 启动 5 秒超时保底计时器
  → Python gateway 收到 gateway.shutdown RPC：
      1. 遍历所有活跃 AgentSession，逐一调用 save_state()
      2. emit "gateway.exit" 事件通知 TUI
      3. 0.5s 后 sys.exit(0)
  → TUI 收到 gateway.exit 事件 → clearTimeout(保底计时器) → exit()
  如果 5 秒内未收到 gateway.exit → 保底计时器触发 → gw.kill() → exit()
```

> 💡 **修复说明（2026-06）**：旧版 Ctrl+D 直接调用 `gw.kill(); exit()`，gateway 被强杀时 session 状态未保存，下次启动时对话历史丢失。新版通过 `gateway.shutdown` RPC 实现优雅退出，`gateway.exit` 事件确认后再退出 TUI。

---

---

