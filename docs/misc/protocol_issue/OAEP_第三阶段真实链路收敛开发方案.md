# OAEP 第三阶段真实链路收敛开发方案

## 1. 背景

OAEP 前两阶段已经完成 Runtime Gateway、Desktop 消费链路、Relay/Android 基础读取链路，以及 Agent Core 到 OAEP 的核心语义投影。第二阶段重点解决了 Run 终态、tool/command、approval、file/artifact、input/attachment、snapshot/replay、legacy chat completion 文本投影等 Runtime 侧能力。

第三阶段的目标不再是继续扩大协议字段，而是把这些能力放到真实 Desktop、Android、未来 TUI 一致访问 OpenDrSai 的场景中验证和收敛。核心问题是：同一个 Windows Runtime 中，同一个 Workspace、Session、Run 的消息流、工具调用、审批、文件变更、失败/取消状态，必须能被 Desktop 和 Android 按同一套 OAEP snapshot/events 稳定看到；旧 `chat_completion` 继续兼容，但不再作为事实来源扩张。

## 2. 阶段目标

1. 在 Windows Desktop 开发版中真实跑通 OAEP 消费链路，解决流式输出、工具调用、失败提示等 UI 表现问题。
2. 在 Android 远程 Workspace 中真实消费同一套 OAEP session snapshot/events，保证刷新、断线恢复和 streaming replay 一致。
3. 收敛 `/v1/chat/completions` 与 OAEP 的关系：旧接口只承担文本兼容输出，新语义必须进入 Runtime Journal/OAEP。
4. 规范 Agent Factory / Codex Adapter / OpenDrSai Backend 原始事件，减少 Runtime Normalizer 猜测。
5. 建立 Desktop + Runtime + Relay + Android 的真实 E2E 验收脚本和人工 smoke 流程。
6. 保证公开 DTO 不泄露绝对路径、PID、端口、token、完整 traceback、内部 subject 或敏感网络信息。

## 3. 非目标

1. 不要求 TUI 在第三阶段立刻切换到 OAEP，但方案必须不阻断未来 TUI 接入。
2. 不删除现有 `chat_completion` 接口。
3. 不在 Desktop/Android 前端硬编码 backend 私有事件。
4. 不用 WSS 连接数、UI 状态或模型名推断 Agent/Run/Device 的真实状态。
5. 不把 Agent Factory 改造成直接依赖 OAEP 协议类型；Agent Core 仍输出领域事件，由 Runtime 规范化。

## 4. 总体架构

```text
Agent Factory / Codex Adapter / OpenDrSai Backend
        |
        | normalized backend events
        v
Runtime Journal
        |
        +--> OAEP snapshot/events/SSE
        +--> legacy chat_completion text projection
        |
        v
Runtime Gateway
        |
        +--> Desktop local client
        +--> Relay public projection
                  |
                  v
              Android remote client
```

关键原则：

- Runtime Journal 是会话事实来源。
- OAEP 是跨端完整语义协议。
- `chat_completion` 是兼容视图，只表达文本流。
- Desktop、Android、未来 TUI 都应最终读取同一套 Session/Run/Item/Event。
- 所有“真实状态”必须来自 Runtime/Platform 权威数据，不来自 UI 猜测。

## 5. 模块拆分

第三阶段拆为 **8 个模块，合计 46 个功能点**。

### M01 Desktop OAEP 真实消费闭环（7 项）

| 编号 | 功能点 | 说明 |
| --- | --- | --- |
| M01-F01 | 开发版 Runtime 启动核验 | 使用 `windows-desktop-dev.cmd` 启动时确认只连接一个 Runtime owner |
| M01-F02 | OAEP 能力探测 | Desktop 根据 Runtime capabilities 选择 OAEP snapshot/events |
| M01-F03 | 文本 streaming | assistant delta 按 OAEP `event.item.delta` 流式显示 |
| M01-F04 | 工具/命令显示 | `tool_call`、`command_execution` 不再混入 assistant 正文 |
| M01-F05 | 失败/取消提示 | `event.run.failed/cancelled` 显示结构化错误，不再只有 “No response content” |
| M01-F06 | 刷新恢复 | 页面刷新后由 OAEP snapshot 恢复同一最终状态 |
| M01-F07 | 调试入口 | “查看调试”展示 OAEP event/run/item 摘要和安全错误码 |

### M02 Android 远程 OAEP 消费闭环（6 项）

| 编号 | 功能点 | 说明 |
| --- | --- | --- |
| M02-F01 | 远程 session snapshot | Android 默认优先读取 OAEP snapshot |
| M02-F02 | 远程 event stream | Android 支持 OAEP SSE 和 `after_sequence` 恢复 |
| M02-F03 | Room replace/replay | snapshot 和 replay 结果写入同一 Room 投影 |
| M02-F04 | streaming UI | Android 中途打开 session 能看到历史和继续流式输出 |
| M02-F05 | 工具/审批/文件展示 | Android 不再只显示 assistant 文本 |
| M02-F06 | 断线恢复 | Relay/Runtime 短断后最终收敛到 Runtime 权威状态 |

### M03 chat_completion 兼容收敛（5 项）

| 编号 | 功能点 | 说明 |
| --- | --- | --- |
| M03-F01 | 文本-only 投影 | 旧 OpenAI SSE 只由 OAEP message delta 投影文本 |
| M03-F02 | 旧接口 session 绑定 | 可识别 session/run 的旧请求写入 Runtime Journal |
| M03-F03 | 无 session 的兼容路径 | 不具备 Runtime 上下文时保留现有直通行为，并记录边界 |
| M03-F04 | 工具语义不下沉 | tool/approval/file/error 不通过 chat_completion 扩展表达 |
| M03-F05 | 回归兼容 | 旧 WebUI/TUI 脚本仍能收到文本流 |

### M04 Agent 原始事件规范化（7 项）

| 编号 | 功能点 | 说明 |
| --- | --- | --- |
| M04-F01 | 事件字段清单 | 固化 message/tool/command/approval/file/artifact/error 的原始事件字段 |
| M04-F02 | item_id 稳定性 | 同一工具、命令、文件变更必须复用稳定 item_id |
| M04-F03 | phase/status 统一 | started/running/completed/failed/cancelled 语义统一 |
| M04-F04 | command stream | stdout/stderr/combined 明确进入原始事件 |
| M04-F05 | artifact metadata | artifact id、name、mime、size、sha256、preview/download flag 标准化 |
| M04-F06 | error envelope | code、message、retryable、source、safe_details 标准化 |
| M04-F07 | adapter fixture | Codex/OpenDrSai 原始事件 fixture 驱动 Runtime 投影测试 |

### M05 Relay 公共投影与安全（5 项）

| 编号 | 功能点 | 说明 |
| --- | --- | --- |
| M05-F01 | OAEP public DTO 校验 | Relay 只返回脱敏 OAEP DTO |
| M05-F02 | subject 授权 | Android 只能读取授权 workspace/session |
| M05-F03 | cursor expired | 历史截断时明确要求客户端重新 snapshot |
| M05-F04 | stream timeout | SSE timeout 不破坏 Runtime 主控制通道 |
| M05-F05 | 敏感字段扫描 | path/token/port/PID/traceback 泄漏自动失败 |

### M06 跨端一致性与多入口（6 项）

| 编号 | 功能点 | 说明 |
| --- | --- | --- |
| M06-F01 | Desktop 发起，Android 观察 | Desktop 发送消息，Android 看到同一 Run |
| M06-F02 | Android 发起，Desktop 观察 | Android 发送消息，Desktop 看到同一 Run |
| M06-F03 | 工具调用一致 | 两端显示同一 tool/command item 状态 |
| M06-F04 | 审批一致 | 一端审批，另一端刷新/订阅后看到结果 |
| M06-F05 | 文件变更一致 | 文件变更只显示安全相对路径 |
| M06-F06 | TUI 预留 | TUI 后续接入不得引入第二套 session/run 身份 |

### M07 自动化与开发体验（5 项）

| 编号 | 功能点 | 说明 |
| --- | --- | --- |
| M07-F01 | Runtime scoped tests | 覆盖 OAEP projection、replay、security |
| M07-F02 | Desktop verifier | 覆盖 RuntimeClient、subscription、UI projection |
| M07-F03 | Android unit tests | 覆盖 Repository、SSE、Room、UI state |
| M07-F04 | E2E smoke script | 自动创建临时 workspace/session/run，不破坏用户数据 |
| M07-F05 | dev owner guard | 避免开发版和安装版争抢同一个 runtime_id |

### M08 文档与迁移（5 项）

| 编号 | 功能点 | 说明 |
| --- | --- | --- |
| M08-F01 | 协议覆盖矩阵 | 维护 Agent event -> OAEP item/event -> UI projection 表 |
| M08-F02 | chat_completion 边界文档 | 明确旧接口与 OAEP 的职责边界 |
| M08-F03 | Desktop/Android smoke 手册 | 给测试和研发可复现步骤 |
| M08-F04 | 已知缺口清单 | 对无法 E2E 的 Platform/设备条件明确标注 |
| M08-F05 | TUI 接入建议 | 形成后续 TUI 切换到 Runtime Journal/OAEP 的迁移说明 |

## 6. 关键数据契约

### 6.1 Run 终态事件

```json
{
  "type": "event.run.failed",
  "run_id": "run_...",
  "data": {
    "status": "failed",
    "reason": "agent_execution_failed",
    "error": {
      "code": "agent_execution_failed",
      "message": "Agent execution failed.",
      "retryable": true,
      "source": "agent_core",
      "safe_details": {}
    }
  }
}
```

### 6.2 Command Delta

```json
{
  "type": "event.item.delta",
  "item_id": "cmd_...",
  "item_revision": 2,
  "data": {
    "delta": {
      "kind": "command.output.append",
      "stream": "stdout",
      "text": "running tests..."
    }
  }
}
```

### 6.3 Tool Item

```json
{
  "type": "tool_call",
  "status": "completed",
  "content": {
    "tool_name": "files.read",
    "arguments": {
      "path": "README.md"
    },
    "result": {
      "summary": "read 42 lines"
    }
  }
}
```

### 6.4 Legacy Chat Completion Chunk

```json
{
  "choices": [
    {
      "delta": {
        "content": "text only"
      }
    }
  ]
}
```

## 7. 实施阶段

### P0 基线核验

目标：确认当前 Runtime、Desktop、Android、Relay 的实际行为。

交付：
- 当前 OAEP 能力矩阵。
- Desktop 发送消息失败/流式异常复现记录。
- Android 读取远程 session 的真实路径记录。
- `chat_completion` 当前调用链和 Runtime Journal 写入点说明。

验收：
- 能说明每个入口读取的是 OAEP、legacy conversation，还是旧 chat stream。

### P1 Desktop 开发版 OAEP 闭环

目标：先让 Windows Desktop 开发版真实按 OAEP 正常显示。

交付：
- Desktop OAEP subscription 修复。
- streaming 文本显示修复。
- tool/command/notice/error UI projection 修复。
- “No response content” 根因修复或结构化错误替代。

验收：
- 使用开发版发送普通消息可流式输出。
- 触发失败时显示结构化错误。
- 页面刷新后内容不丢、不重复。

### P2 Runtime/Agent 原始事件收敛

目标：减少 normalizer 猜测，提高 Agent Core 输出质量。

交付：
- Agent 原始事件字段规范。
- Codex/OpenDrSai event adapter fixture。
- item_id/phase/status/stream/exit_code 标准化。

验收：
- 同一命令从 started 到 delta 到 completed 保持同一 item_id。
- 工具失败和模型失败均有 OAEP failed item/run event。

### P3 Android 远程 OAEP 闭环

目标：Android 读取同一 session 的 OAEP 数据并正确落 Room。

交付：
- Android Repository OAEP snapshot/events 优先策略。
- Room projection 更新。
- remote session UI 状态覆盖。

验收：
- Desktop 发起消息，Android 刷新能看到同一 Run。
- Android 中途进入 session 能恢复历史和继续流式。
- 断线后用 `after_sequence` 恢复。

### P4 chat_completion 兼容收敛

目标：旧接口继续工作，但不再扩展新语义。

交付：
- 可绑定 Runtime session/run 的请求写入 Runtime Journal。
- OAEP message delta -> OpenAI SSE 文本投影接入可控路径。
- 无 Runtime 上下文请求保留旧路径并记录边界。

验收：
- 旧客户端仍收到文本流。
- 工具、审批、文件、错误只通过 OAEP 完整表达。

### P5 双端真实 E2E

目标：证明 Desktop 和 Android 看到同一套事实。

交付：
- 临时 Workspace/Session/Run E2E 脚本。
- Desktop -> Android 测试记录。
- Android -> Desktop 测试记录。
- 失败/取消/工具/文件变更专项记录。

验收：
- 不移除用户已有 Workspace。
- 不启动两个 Runtime owner。
- 两端最终 item 集合一致，sequence 单调，敏感字段无泄漏。

### P6 Release Gate 与文档收尾

目标：形成可合入、可回归、可交接的工程闭环。

交付：
- Python Runtime/Relay tests。
- Desktop typecheck/verifier。
- Android unit/scoped tests。
- schema drift check。
- mojibake/diff check。
- 开发与测试手册。

验收：
- 所有 gate 通过，未通过项有明确阻塞原因和复现命令。

## 8. 测试矩阵

| 类型 | 覆盖内容 | 建议命令/位置 |
| --- | --- | --- |
| Runtime OAEP | run/item/event projection、snapshot/replay、安全脱敏 | `test_runtime_conversation_journal.py` |
| Agent Adapter | Codex/OpenDrSai 原始事件到 normalized event | `test_codex_native_decoder.py`、`test_normalized_agent_events.py` |
| Gateway API | OAEP snapshot/events/SSE/cursor | `test_gateway_session_events.py` |
| Relay API | public OAEP route、授权、脱敏 | `test_relay_api.py`、`test_relay_gateway_control.py` |
| Desktop | RuntimeClient、subscription、UI projection | `npm --prefix apps/desktop/windows run verify:oaep-release` |
| Android | Repository、SSE、Room、UI state | scoped `:app:testDebugUnitTest` |
| Security | path/token/PID/port/traceback leak | fixture grep + DTO tests |
| E2E | Desktop/Android 同一 session | 临时 workspace smoke |

## 9. 验收标准

1. Desktop 开发版发送消息不再出现无原因的 “No response content”。
2. Desktop 能流式显示 OAEP message delta。
3. Android 能读取同一 Runtime session 的 OAEP snapshot/events。
4. Desktop 和 Android 对同一 Session 的最终消息、工具、审批、文件、错误状态一致。
5. 页面刷新、Android 重新进入、SSE 断线恢复后最终状态一致。
6. 旧 `chat_completion` 文本流保持兼容。
7. 新语义不再只存在于 `chat_completion` 或前端私有状态。
8. 公开 DTO 不泄露绝对路径、PID、端口、token、完整 traceback、完整 subject、公钥或凭据。
9. 自动测试和真实 smoke 均给出证据边界，不把 mock 结果误报为真实 E2E。

## 10. 风险与控制

| 风险 | 影响 | 控制 |
| --- | --- | --- |
| Desktop 仍走旧 conversation projection | OAEP 修复无法体现在 UI | capabilities + route trace + verifier 强制确认 |
| chat_completion 与 OAEP 双事实源 | 多端显示不一致 | 新语义只进入 Runtime Journal/OAEP，legacy 只投影文本 |
| Agent 原始事件字段不足 | Runtime normalizer 继续猜测 | 补 adapter fixture 和字段规范 |
| Android Room 缓存未替换 | Relay 已正确但 UI 仍显示旧数据 | snapshot replace 测试和真实 Room 清理验证 |
| 开发版/安装版抢占 runtime_id | Relay owner 混乱 | 启动前 owner guard 和 generation 核验 |
| 真实 E2E 破坏用户数据 | 删除真实 Workspace/Session | 只创建专用临时对象，测试结束归档 |
| 敏感信息泄漏 | 安全事故 | DTO 脱敏测试、diff grep、人工抽样 |

## 11. 推荐优先级

第一优先级：

1. Desktop 开发版 OAEP streaming 和 “No response content” 修复。
2. Runtime Gateway route trace，确认真实走 OAEP。
3. Agent failed/cancelled 在 UI 中的结构化展示。

第二优先级：

1. Android OAEP Room projection 和 SSE 恢复。
2. Desktop -> Android 同一 session 真实 smoke。
3. Android -> Desktop 同一 session 真实 smoke。

第三优先级：

1. `chat_completion` 可控收敛到 OAEP 文本投影。
2. Agent 原始事件字段进一步标准化。
3. TUI 接入迁移说明和最小 PoC。

## 12. 完成定义

第三阶段完成时，应满足：

```text
Desktop / Android
      |
      v
Runtime Gateway OAEP snapshot/events
      |
      v
Runtime Journal
      |
      v
Agent Factory / Codex Adapter / OpenDrSai Backend
```

并且真实场景中：

- Desktop 发送消息可以稳定流式输出。
- Android 能看到同一会话、同一 Run、同一工具调用。
- 失败和取消都有明确终态与结构化错误。
- 文件变更和 artifact 可安全展示。
- 旧 `chat_completion` 仍能服务文本兼容客户端。
- 刷新、断线、重进页面不会改变最终会话事实。
- 后续 TUI 接入时不需要重新定义另一套会话事实源。

## 13. 第三阶段真实 E2E Readiness 入口

新增轻量预检命令：

```powershell
npm --prefix apps\desktop\windows run verify:oaep-stage3-readiness
```

该命令不替代真机 E2E。它用于在研发机或测试机上快速确认：

- Android `RealRemoteWorkspaceE2ETest` 已包含 `windows-two-runs-monitor`、`android-two-runs`、`oaep-session-proof` 三个真实阶段。
- V4 real-device finalizer 要求 `windows_to_android_two_runs`、`android_to_windows_two_runs`、`oaep_hash_convergence` 三项 release evidence。
- Runtime snapshot、Android proof、Desktop OAEP digest、截图证据链都已接入。
- 自动发现 `ANDROID_HOME`、`ANDROID_SDK_ROOT` 或 `%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe`。
- 当未连接或未授权物理 Android 设备时，报告 `ready_for_real_device_e2e=false` 和结构化 blocker；emulator 只作为局部 instrumentation 证据，不把预检通过误报为真机 E2E 通过。

新增 emulator instrumentation 命令：

```powershell
npm --prefix apps\desktop\windows run verify:oaep-android-instrumentation
```

该命令会启动或复用 `OpenDrSai_API_35` AVD，强制重跑 `kaptDebugKotlin --rerun-tasks`，然后执行 `RemoteSessionSyncStoreTest`。它用于证明 Android OAEP Room snapshot/event/delta/cache 事务能在设备运行时通过，但仍不替代物理 Android 与真实 Relay/Runtime 的双向 E2E。

真实 E2E 仍必须运行：

```powershell
python scripts\accept_mobile_remote_workspace_real_device_v4.py `
  --runtime-id <runtime_id> `
  --workspace-id <workspace_id> `
  --session-id <session_id> `
  --expected-source-message-id <source_message_id>
```

验收时必须拿到 Desktop、Runtime、Android 三端一致的 `oaep_sha256`，并保留截图和双向 Run evidence。

## 14. 第三阶段完成审计入口

新增机器可读审计命令：

```powershell
npm --prefix apps\desktop\windows run verify:oaep-stage3-audit
```

该命令把本方案中的 8 个模块、46 个功能点映射为 `passed_local`、`documented`、`needs_physical_e2e` 三类状态。默认模式用于生成进度证据：只要审计结构完整就返回成功，但不会把 `needs_physical_e2e` 误报为完成。

发布完成门禁可使用：

```powershell
python scripts\verify_oaep_stage3_completion_audit.py --require-complete
```

在尚未连接并授权物理 Android 设备、且未跑通真实 Desktop/Runtime/Relay/Android 双向 E2E 前，`--require-complete` 必须失败。当前必须保留的真机项包括 Android streaming UI、断线恢复、subject 授权、Desktop->Android、Android->Desktop、工具/审批/文件跨端一致性，以及真实 E2E smoke 脚本执行证据。

审计器会自动读取默认真实证据：

```text
release/product-evidence/mobile-remote-workspace-v4/real-device-oaep-e2e.json
```

也可以显式传入：

```powershell
python scripts\verify_oaep_stage3_completion_audit.py `
  --real-report <real-device-oaep-e2e.json> `
  --require-complete
```

只有该报告包含通过的 `pair_and_catalog`、`two_device_isolation`、`windows_to_android_two_runs`、`android_to_windows_two_runs`、`oaep_hash_convergence`、`approval_single_decision`、`file_change_safe_paths`、`revocation_stream_closed`，并且至少两个脱敏 device proof 存在时，9 个真机项才会从 `needs_physical_e2e` 升级为 `passed_real`。`file_change_safe_paths` 必须证明至少一个文件变更被两端看到，且只包含安全相对路径、无绝对路径、无敏感字段。报告缺失时保持未完成；报告存在但不完整时 fail closed。
