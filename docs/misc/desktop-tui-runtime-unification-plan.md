# Desktop/TUI Runtime 统一方案

## 背景

现在 Windows/macOS Desktop 和 TUI 都可以访问 OpenDrSai，但它们还没有使用同一个外层执行后端。

我们期望的未来状态是：Desktop 和 TUI 只是同一个 Runtime Workspace、同一个 Runtime Session 的两个客户端视图。最基础的用户可见表现应该是：

1. 用户在某个文件夹中启动 TUI，这个文件夹对应一个 Runtime Workspace。
2. 用户在 TUI 中发送消息。
3. Desktop 在同一个 Workspace/Session 中同步看到同一段对话，包括流式输出、工具调用、审批、运行完成和失败状态。
4. 发送、取消、审批、重命名、归档、恢复等操作都收敛到同一个 Runtime 权威状态。

这意味着后面的执行层必须统一。TUI 不应该在 Desktop 使用 Runtime Gateway 的同时，为同一个逻辑 Workspace/Session 再单独执行一个 Agent 实例。

## 当前实现

### Desktop My DrSai

当前 Desktop My DrSai 调用链：

```text
Electron Renderer
  -> Electron Main chat.ts
  -> runRuntimeBackendChat()
  -> connectRuntimeClientForWorkspace()
  -> RuntimeClient.createAgentRun()
       POST /v1/sessions/{session_id}/runs
  -> RuntimeClient.executeAgentRun()
       POST /v1/runs/{run_id}/execute
  -> drsai.backend.gateway
  -> runtime_run_execute()
  -> RuntimeAgentService.execute()
  -> AgentBackendRouter
  -> GatewayOpenDrSaiAgentBackend.execute()
  -> AgentManager.run_stream()
  -> AgentManager.get_or_create()
  -> run_drsai_agent_factory.create_agent()
  -> agent.run_stream(task=...)
```

关键文件：

- `apps/desktop/shared/main/chat.ts`
- `apps/desktop/shared/main/runtimeClient.ts`
- `cores/python/packages/drsai/src/drsai/backend/gateway.py`
- `cores/python/packages/drsai/src/drsai/backend/runtime/agent.py`
- `cores/python/packages/drsai/src/drsai/backend/run_drsai_agent_factory.py`

Desktop 调用的是 Runtime Gateway。这个 Gateway 持有 Workspace、Session、Run 和 Event Journal 等 Runtime 状态。OpenDrSai Agent 是 Runtime 合同后面的一个 backend，而不是整个 gateway 本身。

### TUI

当前 TUI 调用链：

```text
TUI Node/Ink frontend
  -> gatewayClient.ts
  -> spawn python -m drsai.backend.tui_gateway
  -> tui_gateway JSON-RPC/stdin/stdout
  -> session.create/session.resume/prompt.submit handlers
  -> CLISessionStore / Thread DB
  -> AgentSession._async_init()
  -> run_drsai_agent_factory.create_agent()
  -> AgentSession.run_turn()
  -> agent.run_stream(task=...)
```

关键文件：

- `apps/ui-tui/src/gatewayClient.ts`
- `cores/python/packages/drsai/src/drsai/backend/tui_gateway/server.py`
- `cores/python/packages/drsai/src/drsai/backend/tui_gateway/handlers/session.py`
- `cores/python/packages/drsai/src/drsai/backend/tui_gateway/adapter/agent_runner.py`
- `cores/python/packages/drsai/src/drsai/backend/run_drsai_agent_factory.py`

TUI 最终也会进入同一个 `run_drsai_agent_factory.create_agent()`，但它当前有自己的 gateway、session store、内存态 `AgentSession`、事件协议和生命周期。

## 为什么 Desktop Gateway 更适合叫 Runtime Gateway

`drsai.backend.gateway` 不只是一个聊天 gateway。它是 Runtime Host 的 HTTP API 表面，负责或暴露：

- Runtime Workspace registry。
- Runtime Session 和 Run 生命周期。
- Runtime Event Journal 和 conversation snapshot。
- 工具分发和审批。
- 本地/远程 Workspace 访问。
- Android/Relay 集成。
- Agent backend 路由。

所以 OpenDrSai Agent 是 Runtime 合同后面的 backend 插件，不是整个 gateway。Desktop 的 gateway 被称为 Runtime Gateway，是因为它首先是 Runtime Host，而不是单纯的 Agent chat endpoint。

## 主要问题

Desktop 和 TUI 最后都会使用同一个 Agent factory，但它们没有共享同一个 Runtime 权威状态。

当前分叉点如下：

| 维度 | Desktop | TUI |
| --- | --- | --- |
| 外层后端 | `drsai.backend.gateway` | `drsai.backend.tui_gateway` |
| 传输协议 | HTTP/SSE Runtime APIs | JSON-RPC over stdio/WebSocket |
| Session 权威源 | Runtime Session table 和 Event Journal | `CLISessionStore` / Thread DB |
| Run 权威源 | Runtime Run table | TUI `AgentSession.run_turn()` |
| 流式事件权威源 | Runtime Run/Session events | TUI gateway event frames |
| Agent 执行位置 | Runtime `GatewayOpenDrSaiAgentBackend` | TUI `AgentSession` |
| 最终 Agent factory | `run_drsai_agent_factory.create_agent()` | `run_drsai_agent_factory.create_agent()` |

因为 Session/Run/Event 的权威源是分裂的，所以 TUI 里发送的消息不会天然变成 Desktop 可订阅的 Runtime conversation events。

## 目标架构

TUI 应该变成 Runtime client adapter。可以保留 `tui_gateway` 作为面向 TUI UI 的本地协议适配层，但正常 Workspace 聊天时，`tui_gateway` 不应该再直接执行 OpenDrSai Agent turn。

目标 TUI 调用链：

```text
TUI Node/Ink frontend
  -> tui_gateway
  -> RuntimeClient adapter
  -> drsai.backend.gateway
  -> Runtime Workspace / Session / Run / Event Journal
  -> GatewayOpenDrSaiAgentBackend
  -> AgentManager
  -> run_drsai_agent_factory.create_agent()
  -> agent.run_stream(task=...)
```

目标 Desktop 调用链保持为：

```text
Desktop
  -> RuntimeClient
  -> drsai.backend.gateway
  -> same Runtime Workspace / Session / Run / Event Journal
```

这样 Desktop、TUI 和 Android 都可以订阅或刷新同一个 Runtime 状态。

## 期望共享行为

- TUI 发送 prompt 时，在同一个 Runtime Session 中创建 Runtime Run。
- Desktop 通过 Runtime Session events 接收用户消息和 assistant 流式 delta。
- tool start/output/completion 只写入一次 Runtime Event Journal。
- approval 是 Runtime approval，任一授权客户端都可以响应。
- cancel/interrupt 映射到 Runtime run cancellation。
- session rename/archive/delete 映射到 Runtime Session lifecycle。
- Workspace 身份基于 Runtime `workspace_id`，不是文件夹 basename 或 UI display name。
- 对话恢复使用 Runtime snapshot 和 event cursor。
- 任何客户端都不从另一个客户端的 UI 本地 buffer 推断权威状态。

## 实施阶段

### Phase 1：让 TUI 使用 Runtime 读模型

让 TUI 能够读取当前文件夹对应的 Runtime Workspaces 和 Sessions。

工作项：

- 在 `tui_gateway` 内部或旁边增加 Python Runtime client。
- 通过 Runtime Gateway 将当前文件夹解析为 Runtime Workspace。
- 将 TUI 的 `session.list`、`session.resume`、`session.history` 映射到 Runtime APIs。
- 将 Runtime conversation snapshot 投影成现有 TUI message model。
- 这个阶段 `CLISessionStore` 只读或只作为 legacy 来源。

验收标准：

- Desktop 创建的 sessions 能出现在 TUI。
- TUI 可以 resume 一个 Desktop Runtime Session 并渲染历史。
- 暂时不迁移 Agent 执行路径。

### Phase 2：让 TUI prompt 走 Runtime 写路径

将普通 TUI `prompt.submit` 移到 Runtime Run 执行。

工作项：

- 用以下流程替换普通聊天中的 `AgentSession.run_turn()`：
  - 创建或解析 Runtime Session；
  - 使用 `opendrsai@1` 创建 Runtime Run；
  - 携带 prompt、attachments 和 provenance 执行 Runtime Run；
  - 订阅 Runtime Session events 或轮询 Runtime Run events。
- 将 Runtime events 翻译成当前 TUI event frames。
- 为重试和恢复保留稳定的 idempotency key。
- 如果需要，增加 `source_client="tui"`；否则明确复用现有 client identity。

验收标准：

- TUI 发送的 prompt 在流式输出期间能出现在 Desktop。
- Desktop 和 TUI 显示相同的 assistant delta 和工具调用。
- 任一 UI 刷新后，都能看到同一份最终 conversation。

### Phase 3：统一控制面

统一影响活跃任务的控制操作。

工作项：

- 将 TUI interrupt/cancel 映射到 Runtime run cancellation。
- 将 approval response 映射到 Runtime approval endpoints。
- 将 session rename/archive/delete 映射到 Runtime Session lifecycle。
- 保留 TUI 键盘体验，但状态变更必须通过 Runtime。

验收标准：

- TUI cancel 能停止 Desktop 中可见的同一个 run。
- Desktop approval 能解锁 TUI 发起的 run。
- TUI approval 能解锁 Desktop 中可见的 run。
- Session 生命周期变化在两个客户端收敛。

### Phase 4：Legacy 迁移与兼容

安全处理已有 TUI 历史。

工作项：

- 定义从 `CLISessionStore` 记录到 Runtime Sessions 的一次性迁移或懒迁移。
- 尽量保留 session 名称、时间戳、preview 和 workdir 关联。
- 不要为同一个已迁移 TUI session 创建重复 Runtime Session。
- 如果保留 legacy direct mode，只能作为显式兼容或调试模式。

验收标准：

- 旧 TUI sessions 可以被发现或迁移。
- 新 sessions 以 Runtime 作为唯一权威源。
- 旧本地状态不会覆盖更新的 Runtime 状态。

## 难度与风险

这是一个中等偏大的重构，但不需要替换 Agent 实现。

风险较低的部分：

- Desktop 已经有 Runtime Session、Run 和 Event Journal。
- Runtime Gateway 已经暴露 session events 和 conversation snapshots。
- Desktop 和 TUI 当前都已经收敛到同一个 Agent factory。

风险较高的部分：

- TUI 目前很多功能耦合在 `CLISessionStore` 和 `AgentSession` 上。
- TUI slash commands 可能直接检查或修改本地 Agent 实例。
- Runtime event 到 TUI event 的翻译必须保留流式输出、工具、审批和错误。
- 必须避免重复执行：一个逻辑 run 只能由 Runtime 执行一次。
- legacy session 迁移需要谨慎处理身份映射。

## 重要设计原则

1. Runtime Gateway 是正常 Workspace 聊天的唯一执行者。
2. Desktop、TUI 和 Android 都是 Runtime clients，不是各自的 Agent owners。
3. `workspace_id` 和 `session_id` 是身份；display name 和 folder basename 不是身份。
4. Runtime Event Journal 是 conversation display 的事实来源。
5. TUI 本地 buffer 只是视图，不是持久权威源。
6. 不做 TUI 和 Desktop conversation 的“复制同步”；使用单一写入者和共享 event stream。
7. 如果保留 legacy TUI direct Agent execution，必须明确标记为 compatibility/debug mode。

## 给 TUI 开发者的开放问题

- `tui_gateway` 应该连接已经运行的 Desktop Runtime Gateway，还是在 Desktop 未运行时也可以启动 Runtime Gateway？
- TUI 如何把当前文件夹解析为 Runtime Workspace：精确 canonical path、最近父级 Workspace，还是按需创建？
- 迁移时 TUI 是否保留现有 `session_id`，还是映射到新的 Runtime Session ID？
- 哪些 slash commands 现在必须直接访问 Agent，哪些可以改成 Runtime APIs？
- Runtime 是否需要新增 `source_client="tui"` 枚举值，还是复用现有 client identity？
- TUI 打开一个有运行中 Runtime Session 的文件夹时，是否默认 attach 到 active run？

## 建议的第一个里程碑

先做一个薄的 TUI Runtime adapter，不删除当前 TUI direct mode。

里程碑行为：

1. 启动 Runtime Gateway。
2. 在某个文件夹中启动 TUI。
3. TUI 解析或打开对应 Runtime Workspace。
4. TUI 创建 Runtime Session，并通过 `/v1/runs/{run_id}/execute` 提交 prompt。
5. Desktop 订阅同一个 Runtime Session，并显示流式输出。
6. TUI 仍然通过当前 UI event model 渲染，只是事件来源变成 Runtime events 的翻译结果。

这个里程碑可以先证明核心用户目标，再逐步迁移所有 TUI 功能。
