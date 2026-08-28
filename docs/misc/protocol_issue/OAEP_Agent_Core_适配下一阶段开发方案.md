# OAEP Agent Core 适配下一阶段开发方案

## 1. 背景

上一阶段已经完成 OAEP v1 在 Runtime Gateway、Desktop 消费链路、Relay 公开路由和 Android 远程会话读取链路中的基础闭环。当前事实来源开始从旧的 `chat_completion`/私有 backend event 收敛到 Runtime 维护的 OAEP Event 与 OAEP Item。

下一阶段的重点不是再增加一种传输格式，而是完善现有 Agent Core 输出到 OAEP 的语义覆盖，使真实运行过程中的消息、工具、审批、文件、错误、输入上下文和恢复状态都能稳定落盘、重放、跨端显示。

## 2. 核心目标

1. 保持 Agent Core 不直接依赖 OAEP 协议细节。
2. 由 Backend Adapter / Runtime Normalizer 负责把 Agent Core 原始事件规范化为 OAEP。
3. 保证 Desktop、Android、未来 TUI 看到同一套 Session / Run / Item / Event。
4. 保证 `chat_completion` 只作为兼容输出层，不继续承担事实来源职责。
5. 补齐复杂 Agent 运行能力：工具调用、命令输出、审批、文件变更、附件、失败、取消、恢复。
6. 建立自动化验收，证明 snapshot 与 event replay 等价，流式过程可恢复，敏感字段不泄露。

## 3. 非目标

1. 不要求把 `run_drsai_agent_factory.py` 改造成 OAEP 原生实现。
2. 不删除现有 `chat_completion` 接口。
3. 不要求 TUI 立刻切换到 OAEP。
4. 不在 Android 或 Desktop 各自硬编码 backend 私有事件。
5. 不把绝对路径、API Key、内部端口、完整 traceback 暴露到 OAEP DTO。

## 4. 目标架构

```text
Agent Core / Agent Factory
        |
        | backend native events
        v
Backend Adapter
        |
        | normalized semantic records
        v
Runtime OAEP Normalizer
        |
        +--> OAEP Event Journal
        +--> OAEP Item Projection
        +--> Legacy chat_completion / conversation projection
        |
        v
Desktop / Android / future TUI
```

关键原则：

- Agent Core 只需要稳定输出足够完整的原始事件。
- OAEP 领域模型由 Runtime 维护。
- 旧接口从 OAEP 或同源 journal 投影生成。
- 新语义只能先进 OAEP，再按需投影给旧接口。

## 5. 模块拆分

本阶段拆分为 **9 个模块，共 48 个功能点**。

### M01 Run 生命周期完整化（6 项）

| 编号 | 功能点 | 说明 |
| --- | --- | --- |
| M01-F01 | Run 状态机冻结 | 明确 `queued/running/waiting_approval/completed/failed/cancelled` |
| M01-F02 | started 事件 | Run 开始执行时生成 `event.run.started` |
| M01-F03 | waiting approval | 审批等待时生成 `event.run.waiting` 或等价状态事件 |
| M01-F04 | completed 终态 | 正常结束必须生成 completed 终态 |
| M01-F05 | failed 终态 | backend 异常、模型异常、工具异常必须生成 failed 终态 |
| M01-F06 | cancelled 终态 | 用户取消、系统取消、超时取消必须生成 cancelled 终态 |

### M02 Tool / Command 语义增强（7 项）

| 编号 | 功能点 | 说明 |
| --- | --- | --- |
| M02-F01 | tool_call item | 普通工具调用独立成为 OAEP item |
| M02-F02 | command_execution item | shell/command 类工具独立成为 command item |
| M02-F03 | started/completed/failed | 工具生命周期不能只靠文本描述 |
| M02-F04 | stdout/stderr delta | 命令输出支持分片流式 |
| M02-F05 | exit_code | 命令结束记录退出码 |
| M02-F06 | argument redaction | 参数只保存脱敏投影 |
| M02-F07 | result summary | 工具结果保存安全摘要，避免大对象直接进 UI |

### M03 Approval / Human Interaction 一等化（5 项）

| 编号 | 功能点 | 说明 |
| --- | --- | --- |
| M03-F01 | interaction item | 审批请求投影为 OAEP interaction item |
| M03-F02 | approval.created | 审批创建事件标准化 |
| M03-F03 | approval.decided | 用户决策事件标准化 |
| M03-F04 | run resume | 审批通过后 Run 恢复事件可追踪 |
| M03-F05 | cross-device approval | Desktop 与 Android 对同一 approval 使用同一事实 |

### M04 File Change / Artifact 结构化（6 项）

| 编号 | 功能点 | 说明 |
| --- | --- | --- |
| M04-F01 | workspace-relative path | OAEP 只允许 workspace 相对路径 |
| M04-F02 | change kind | 支持 created/modified/deleted/renamed |
| M04-F03 | diff summary | 保存可展示 diff 摘要 |
| M04-F04 | artifact metadata | 支持 artifact id、mime、size、sha256 |
| M04-F05 | preview/download flag | 标记是否可预览或下载 |
| M04-F06 | no sensitive leak | 测试覆盖 path、pid、port、token 不泄露 |

### M05 Input / Attachment 事实化（5 项）

| 编号 | 功能点 | 说明 |
| --- | --- | --- |
| M05-F01 | user input item | 用户输入进入 OAEP message item |
| M05-F02 | source_client | 标记 desktop/android/tui/runtime |
| M05-F03 | source_message_id | 支持幂等与乐观消息清理 |
| M05-F04 | attachment refs | 附件只保存引用，不保存本地绝对路径 |
| M05-F05 | retry_of | 重试 Run 与原 Run 建立关系 |

### M06 Reasoning / Notice / Error 分层（5 项）

| 编号 | 功能点 | 说明 |
| --- | --- | --- |
| M06-F01 | reasoning item | 思考过程与最终回复分离 |
| M06-F02 | hidden/public policy | 明确哪些 reasoning 可展示 |
| M06-F03 | notice item | 系统提示、兼容降级、非致命问题用 notice |
| M06-F04 | structured error | error 包含 code、message、retryable、source |
| M06-F05 | safe details | 错误详情脱敏，禁止完整 traceback 外发 |

### M07 Snapshot / Replay 一致性（6 项）

| 编号 | 功能点 | 说明 |
| --- | --- | --- |
| M07-F01 | session_sequence 单调 | 所有 session event 单调递增 |
| M07-F02 | item_revision 单调 | 同一 item 更新 revision 单调递增 |
| M07-F03 | delta replay | delta 重放结果等价最终 item |
| M07-F04 | cursor recovery | `after_sequence` 恢复不丢不重 |
| M07-F05 | cursor expired | 历史截断时要求客户端重新 snapshot |
| M07-F06 | snapshot equivalence test | snapshot 与 event replay 建立自动测试 |

### M08 Legacy Projection / chat_completion 收敛（4 项）

| 编号 | 功能点 | 说明 |
| --- | --- | --- |
| M08-F01 | OpenAI SSE projection | `chat_completion` SSE 从 OAEP message delta 投影 |
| M08-F02 | legacy conversation projection | 旧 conversation snapshot/events 从 OAEP 或同源 journal 投影 |
| M08-F03 | no new legacy semantics | 新语义不再只加到旧接口 |
| M08-F04 | compatibility tests | 旧客户端仍可收文本流，复杂语义只在 OAEP 完整表达 |

### M09 自动化与真实验收（4 项）

| 编号 | 功能点 | 说明 |
| --- | --- | --- |
| M09-F01 | adapter fixtures | OpenDrSai/Codex 原始事件到 OAEP fixture |
| M09-F02 | runtime integration tests | Runtime journal/projection/API 测试 |
| M09-F03 | desktop/android smoke | 双端读取同一 Session，流式与刷新一致 |
| M09-F04 | release gate | typecheck、schema drift、mojibake、sensitive leak、diff check |

## 6. 关键数据契约

### 6.1 Run 状态

```json
{
  "run_id": "run_...",
  "session_id": "session_...",
  "status": "running",
  "started_at": "2026-08-02T00:00:00Z",
  "completed_at": null,
  "source_client": "desktop",
  "source_message_id": "..."
}
```

### 6.2 Tool Item

```json
{
  "item_id": "tool_...",
  "type": "tool_call",
  "status": "running",
  "tool_name": "files.read",
  "arguments": {},
  "result": null,
  "error": null
}
```

### 6.3 Command Item

```json
{
  "item_id": "cmd_...",
  "type": "command_execution",
  "status": "completed",
  "command": "pytest ...",
  "stdout_tail": "...",
  "stderr_tail": "",
  "exit_code": 0
}
```

### 6.4 Error / Notice

```json
{
  "item_id": "error_...",
  "type": "notice",
  "severity": "error",
  "error": {
    "code": "backend_timeout",
    "message": "回复未完成",
    "retryable": true,
    "source": "agent_core",
    "safe_details": {}
  }
}
```

## 7. 实施阶段

### P0 基线核对

目标：确认当前 OAEP schema、Runtime projection、Desktop/Android 消费链路的现状。

交付：

- 当前事件覆盖矩阵。
- Agent Core 原始事件列表。
- chat_completion 与 OAEP 投影关系说明。

进入下一阶段条件：

- 明确哪些功能已有、哪些只是兼容投影、哪些缺失原始事件。

### P1 Run 终态与错误闭环

目标：先解决“回复未完成”“一直运行中”“失败不可恢复”。

交付：

- Run 状态机实现。
- failed/cancelled/completed 终态统一。
- structured error / notice item。

验收：

- 模型异常、工具异常、用户取消、超时均有 OAEP 终态。
- Desktop/Android 刷新后不再显示悬挂 Run。

### P2 Tool / Command 结构化

目标：工具调用不再混入 assistant 文本。

交付：

- tool_call item。
- command_execution item。
- stdout/stderr delta。
- exit_code/result/error。

验收：

- 真实 shell 命令流式显示。
- 刷新后工具状态与输出一致。
- 敏感参数不外泄。

### P3 Approval 一等化

目标：审批状态跨 Desktop/Android 一致。

交付：

- interaction item。
- approval.created/decided。
- waiting/resume run state。

验收：

- Android 远程审批后 Desktop 立即收敛。
- Desktop 审批后 Android 刷新显示同一结果。

### P4 File / Artifact 结构化

目标：文件变化和产物可安全展示。

交付：

- file_change item。
- artifact metadata。
- workspace-relative path 校验。

验收：

- 文件创建/修改/删除有结构化记录。
- Android/Relay DTO 不包含绝对路径。

### P5 Input / Attachment 事实化

目标：多端同步时能看到完整用户输入上下文。

交付：

- user input item。
- attachment_refs。
- retry_of/source_message_id。

验收：

- Android 发消息，Desktop 能看到用户输入与后续 assistant 输出。
- 重试不会生成重复用户消息。

### P6 Snapshot / Replay 强一致

目标：流式、刷新、断线恢复显示一致。

交付：

- event replay 测试。
- snapshot equivalence 测试。
- cursor expired recovery。

验收：

- 任意中途断线后按 `after_sequence` 恢复。
- 清缓存后 snapshot 与历史最终状态一致。

### P7 chat_completion 收敛

目标：旧接口保留，但事实来源降级为 OAEP 投影。

交付：

- OAEP -> OpenAI SSE 投影。
- 旧接口兼容测试。

验收：

- 旧脚本继续收到文本流。
- 工具、审批、文件等复杂语义不依赖 chat_completion。

## 8. 测试矩阵

| 类型 | 覆盖内容 | 命令/位置 |
| --- | --- | --- |
| OAEP schema | 新 item/event 字段合法性 | `cores/protocol/oaep` fixture/schema tests |
| Adapter unit | OpenDrSai/Codex 原始事件映射 | `cores/python/packages/drsai/tests/test_*adapter*` |
| Runtime journal | sequence、revision、dedupe、snapshot | `test_runtime_conversation_journal.py` |
| Runtime API | snapshot/events/SSE/cursor expired | `test_gateway_session_events.py` |
| Relay API | public OAEP routes、鉴权、脱敏 | `test_relay_api.py` |
| Desktop | RuntimeClient、subscription、projection | `npm --prefix apps/desktop/windows run verify:oaep-release` |
| Android | Repository/SSE/Room projection | `apps/android :app:testDebugUnitTest` scoped tests |
| Security | path/token/port/traceback leak | schema + API + fixture grep |
| E2E | Desktop/Android 同一 session 流式与刷新 | 手动或自动 smoke |

## 9. 验收标准

1. Run 不允许无终态悬挂。
2. Tool、command、approval、file_change、artifact、error 都有一等 OAEP 表达。
3. Desktop 和 Android 对同一 Session 的 snapshot 显示一致。
4. Event stream 中断后能从 `after_sequence` 恢复。
5. Snapshot 与 replay 最终 Item 等价。
6. `chat_completion` 继续兼容文本流，但不再承载新语义。
7. 所有公开 DTO 不泄露绝对路径、token、端口、PID、完整 subject、完整 traceback。
8. 新增能力均有 fixture、单测、集成测试和 release gate。

## 10. 风险与控制

| 风险 | 影响 | 控制 |
| --- | --- | --- |
| Agent Core 原始事件信息不足 | OAEP 映射只能猜测 | 先补原始事件字段，不在前端硬推断 |
| OAEP 与 legacy 双写漂移 | 多端显示不一致 | 单一 journal，legacy 由投影生成 |
| 工具输出过大 | UI 卡顿、数据库膨胀 | delta 分片、tail、artifact 化 |
| 错误详情泄露 | 安全问题 | safe error envelope + 脱敏测试 |
| Android/TUI 与 Desktop 展示差异 | 产品行为不一致 | 同一 snapshot/event fixture 驱动多端测试 |
| 过早改 TUI | 扩大改动面 | 先完成 Runtime 权威事实，再迁移 TUI |

## 11. 推荐优先级

第一优先级：

1. Run 终态完整化。
2. structured error / notice。
3. tool/command 结构化。
4. snapshot/replay 等价测试。

第二优先级：

1. approval 一等化。
2. file_change/artifact 结构化。
3. input/attachment 事实化。

第三优先级：

1. chat_completion 从 OAEP 投影。
2. Android/TUI 更完整消费。
3. 历史数据迁移与性能压测。

## 12. 完成定义

本阶段完成时，应满足：

```text
Agent Core 原始事件
  -> Runtime OAEP Normalizer
  -> OAEP Event Journal
  -> OAEP Item Projection
  -> Desktop / Android / future TUI

legacy chat_completion
  <- OAEP projection
```

并且真实 My DrSai / Codex 场景中：

- 文本流式正常。
- 工具调用可见。
- 命令输出可见。
- 审批可跨端处理。
- 文件变更可安全展示。
- 失败和取消有终态。
- 刷新和断线恢复不改变最终会话内容。
