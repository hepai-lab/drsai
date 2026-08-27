# OpenDrSai Codex Adapter OAEP 重构开发方案 V2

状态：规划完成，待实施  
日期：2026-08-02  
协议基线：OAEP v1.0  
适用范围：本地 Windows Codex，兼容未来远程 Linux Codex

## 1. 结论：当前阶段与下一阶段

### 1.1 阶段编号

本方案把 Codex Backend 的演进重新编号如下：

| 阶段 | 名称 | 状态 | 结论 |
| --- | --- | --- | --- |
| P0 | Codex App Server 可行性验证 | 已完成 | 已证明 Windows 本机可以启动 App Server、建立 Thread/Turn、接收流式输出 |
| P1 | OAEP Runtime 基础设施 | 基本完成 | 已有 OAEP Schema、Event Journal、Item Projection、Gateway snapshot/events 路由 |
| **P2** | **旧 Codex Adapter 向 OAEP 的过渡投影** | **当前阶段，部分完成** | Codex 仍先产生松散 `agent.*` Runtime Event，再由启发式 OAEP Projector 转换；核心语义未闭合 |
| **P3** | **Codex Adapter OAEP 契约重构** | **下一阶段** | 建立强类型 Codex Native Event → Normalized Agent Event → OAEP Writer 主链路，冻结身份、顺序与终态规则 |
| P4 | Codex 全量结构化语义 | 未开始 | 补齐 Message、Reasoning、Plan、Command、File、Tool、Subtask、Notice |
| P5 | Approval、恢复与安全闭环 | 未开始 | 审批、断线、重放、取消、故障恢复和脱敏全部以 OAEP 为事实来源 |
| P6 | 客户端切换与兼容投影 | 未开始 | Desktop/Android 只消费 OAEP，旧 conversation/chat_completion 从 OAEP 投影 |
| P7 | 自动验收与发布门禁 | 未开始 | Fake、真实 Codex、重连、压力、跨端、Schema drift 全部自动验收 |

因此，**现在是 P2，下一阶段是 P3**。旧方案中 Codex 传输、进程、Thread/Turn、多轮、审批等功能已经完成，不应推倒重写；需要重写的是 Adapter 的语义出口和验收基准。

### 1.2 当前完成事实

已经存在：

- `CodexJSONRPCClient`：JSONL、请求/响应、通知、Server Request、超时、EOF、重连 generation。
- `CodexAppServerProcess`：App Server 生命周期、重启与 stderr 管理。
- `CodexBackendClient`：Thread/Session、Turn/Run、多轮复用、终态和恢复。
- `CodexApprovalBridge`：command、file change、permissions 三类审批。
- `CodexEventMapper`：部分消息 Delta、命令 Delta、Reasoning Delta、Item started/completed。
- OAEP v1 Schema、examples、Runtime projector、snapshot、event replay API。

当前验证命令：

```powershell
$env:PYTHONPATH='cores\python\packages\drsai\src'
.\.venv\Scripts\python.exe -m pytest -q `
  cores\python\packages\drsai\tests\test_oaep_protocol.py `
  cores\python\packages\drsai\tests\test_codex_event_mapper.py `
  cores\python\packages\drsai\tests\test_codex_backend_client.py `
  cores\python\packages\drsai\tests\test_gateway_session_events.py
```

基线结果：**25 passed，1 failed**。失败为 `mcpToolCall.output` 未进入 OAEP `tool_call.content.result`。

### 1.3 当前架构缺口

当前链路是：

```text
Codex App Server
  -> CodexEventMapper
  -> 松散 agent.* Runtime Event
  -> 启发式 OAEP Projector
  -> OAEP Event / Item
```

主要问题：

1. `agent.*` payload 没有强类型契约，字段含义依赖 Projector 猜测。
2. Codex 原始 Item 的最终权威状态可能在二次投影中丢字段。
3. Delta 的类型、顺序、分段和最终 Item 校准尚未统一。
4. `plan`、commentary/final phase、subtask、context compaction、model reroute 等语义覆盖不足。
5. Approval 已能运行，但还没有严格产生 OAEP Interaction Item 与 waiting/resumed 序列。
6. 未知 Codex 事件仍可能降级为宽泛 `agent.item.unknown`，缺少稳定诊断策略。
7. OAEP 文档仍标记 `Draft v1.0`，与“协议已经定稿”的产品决定不一致，应在 P3 基线提交中同步为正式状态。

## 2. 目标架构

```text
OpenDrSai Desktop / Android
             |
             | OAEP snapshot + event stream
             v
OpenDrSai Runtime
├─ OAEP Writer
│  ├─ Event Journal
│  ├─ Item Projection
│  └─ Legacy Projection
└─ Codex Agent Backend
   ├─ Codex Adapter
   │  ├─ App Server Supervisor
   │  ├─ JSON-RPC Client
   │  ├─ Native Event Decoder
   │  ├─ Identity Binder
   │  ├─ Semantic Mapper
   │  └─ Approval Bridge
   └─ Codex App Server
```

严格边界：

- Codex App Server 只输出 Codex 原始协议。
- Codex Adapter 理解 Codex 私有协议，但不分配 OAEP `event_id` 和全局 `sequence`。
- Adapter 输出强类型 `NormalizedAgentEvent`，不得继续输出任意字典形态的 `agent.*` 事件。
- Runtime OAEP Writer 是 OAEP ID、sequence、revision、journal 和 projection 的唯一权威生产者。
- Desktop、Android、Relay 不理解 `threadId`、`turnId`、Codex method 或 Codex Item type。
- Legacy chat/conversation/SSE 只能从 OAEP 或同源 journal 投影，不再成为事实来源。

## 3. 内部适配契约

P3 新增内部强类型记录，不把 Codex 原始对象直接写入 OAEP：

```json
{
  "kind": "item.delta",
  "backend": "codex",
  "session_binding": "codex-thread-id",
  "run_binding": "codex-turn-id",
  "item_binding": "codex-item-id",
  "semantic_type": "message",
  "phase": "final",
  "dedupe_key": "codex:thread:turn:item:method:ordinal",
  "payload": {
    "delta_kind": "message.text.append",
    "text": "..."
  }
}
```

规则：

- `NormalizedAgentEvent` 是 Runtime 内部契约，不是新的公开协议。
- OAEP 仍然只有 Session、Run、Item 和 Event；Delta 只存在于 `event.item.delta.data.delta`。
- Adapter 保留 Backend ID 作为 binding/source metadata，但公开 OAEP ID 由 Runtime 管理。
- 原始 Codex payload 只进入有界诊断日志，不进入公开 OAEP DTO。

## 4. 模块与功能点

本方案共 **11 个模块、71 个功能点**。

### M01 OAEP/Codex 契约基线（6 项）

| 编号 | 功能点 | 验收 |
| --- | --- | --- |
| M01-F01 | 将 OAEP v1 状态从 Draft 同步为正式协议状态 | README、Schema `$id`、版本常量一致 |
| M01-F02 | 固定 Codex App Server 受支持版本范围 | manifest、实际 `--version`、Schema digest 三方一致 |
| M01-F03 | 生成并保存该版本原始 JSON Schema/TS 类型 | `generate-json-schema`、`generate-ts` 可重复 |
| M01-F04 | 建立 Codex method/item/delta/approval 全量目录 | 自动从生成 Schema 检查，不靠手工清单 |
| M01-F05 | 建立 Codex → OAEP 映射矩阵 | 每个稳定事件明确 map/ignore/diagnostic |
| M01-F06 | 建立 OAEP 兼容性决策记录 | 新字段、未知事件、降级和版本升级规则冻结 |

### M02 强类型 Adapter 出口（7 项）

| 编号 | 功能点 | 验收 |
| --- | --- | --- |
| M02-F01 | 定义 `NormalizedAgentEvent` sealed union | 禁止任意 `kind/payload` 组合 |
| M02-F02 | 定义 Session/Run/Item binding 类型 | Backend ID 与 OAEP ID 不混用 |
| M02-F03 | 定义 typed delta union | 仅允许 OAEP v1 七种 delta kind |
| M02-F04 | 定义 typed terminal/error envelope | completed/failed/cancelled 必须互斥 |
| M02-F05 | 定义 typed interaction envelope | approval/options/response/related item 完整 |
| M02-F06 | 删除新路径对启发式 `_item_type()` 的依赖 | Codex 映射不再靠字段猜类型 |
| M02-F07 | 保留旧 `agent.*` 兼容入口并标记只读迁移 | 新功能不得继续写入旧入口 |

### M03 身份、生命周期与顺序（7 项）

| 编号 | 功能点 | 验收 |
| --- | --- | --- |
| M03-F01 | Codex Thread ↔ OAEP Session 持久化绑定 | 重启后不生成新 Session |
| M03-F02 | Codex Turn ↔ OAEP Run 持久化绑定 | 多轮同 Thread、每轮新 Run |
| M03-F03 | Codex Item ↔ OAEP Item 稳定绑定 | started/delta/completed 指向同一 Item |
| M03-F04 | `thread/started/archive/unarchive/delete` 映射 | Session 生命周期事件完整 |
| M03-F05 | `turn/started/completed` 三终态映射 | completed/failed/interrupted 精确对应 |
| M03-F06 | Runtime 分配严格递增 sequence/revision | 并发通知不乱序、不倒退 |
| M03-F07 | 用户输入 Item 与 Codex userMessage 去重 | 一条用户消息只产生一个 OAEP Item |

### M04 Codex Item 全量结构化映射（10 项）

| 编号 | Codex Item | OAEP |
| --- | --- | --- |
| M04-F01 | `userMessage` | `message(role=user)` |
| M04-F02 | `agentMessage` | `message(role=assistant, phase=commentary/final)` |
| M04-F03 | `reasoning` | `reasoning`，只映射允许公开的 summary |
| M04-F04 | `plan` | `plan`，最终 completed Item 权威 |
| M04-F05 | `commandExecution` | `command_execution` |
| M04-F06 | `fileChange` | `file_change`，路径必须 workspace-relative |
| M04-F07 | `mcpToolCall/dynamicToolCall` | `tool_call` |
| M04-F08 | `webSearch/imageView` | `tool_call` 对应 tool_kind |
| M04-F09 | `collabToolCall` | `subtask`，保留 child run/thread binding |
| M04-F10 | review/compaction/未知 Item | 已知语义映射 Notice；未知仅安全 Notice/diagnostic |

### M05 Delta 与最终状态校准（7 项）

| 编号 | 功能点 | 验收 |
| --- | --- | --- |
| M05-F01 | Agent message delta | `message.text.append` |
| M05-F02 | Reasoning summary/text delta | `reasoning.segment.added/reasoning.text.append` |
| M05-F03 | Plan delta | `plan.text.append` |
| M05-F04 | Command output delta | `command.output.append`，保留 stdout/stderr |
| M05-F05 | Tool output delta | `tool.output.append` |
| M05-F06 | Delta ordinal 与稳定 dedupe key | 内容相同但位置不同的 Delta 不误去重 |
| M05-F07 | `item/completed` 权威校准 | 最终 Item 替换/校准累计 Delta，不重复文本 |

### M06 Approval 与 Interaction（7 项）

| 编号 | 功能点 | 验收 |
| --- | --- | --- |
| M06-F01 | command approval → Interaction Item | options/reason/related command 完整 |
| M06-F02 | file change approval → Interaction Item | related file change 完整 |
| M06-F03 | permissions approval → Interaction Item | 权限集合使用安全枚举 |
| M06-F04 | 等待顺序 | command waiting → interaction waiting → run waiting |
| M06-F05 | 决策顺序 | interaction completed → run resumed → target item running |
| M06-F06 | 超时、拒绝、取消终态 | 无永久 waiting，无重复响应 |
| M06-F07 | Desktop/Android 同一审批事实 | 任一端决定后另一端 snapshot/event 收敛 |

### M07 重放、重连与恢复（7 项）

| 编号 | 功能点 | 验收 |
| --- | --- | --- |
| M07-F01 | request response 前通知暂存 | Turn ID 绑定后按原序处理 |
| M07-F02 | App Server generation 隔离 | 旧进程消息不得写入新 Run |
| M07-F03 | Backend event dedupe | 重复通知只生成一个权威 OAEP Event |
| M07-F04 | snapshot/replay 等价 | 任意 cursor 重放得到相同最终 Items |
| M07-F05 | `thread/read(includeTurns=true)` 恢复 | 重启后终态和 Item 恢复完整 |
| M07-F06 | 进行中 Turn 缺失处理 | fail closed 为 failed/cancelled，不永久 running |
| M07-F07 | cursor expired 和重订阅 | 强制 snapshot 后无缝继续事件流 |

### M08 安全、边界与诊断（5 项）

| 编号 | 功能点 | 验收 |
| --- | --- | --- |
| M08-F01 | Secret/credential 全字段递归脱敏 | canary 零泄漏 |
| M08-F02 | 路径归一化 | OAEP 不出现 Workspace 外绝对路径 |
| M08-F03 | 大字段有界化 | delta 分片；大结果变摘要或 Artifact |
| M08-F04 | Unknown event 安全处理 | 不向 UI 暴露任意 Backend payload |
| M08-F05 | 结构化诊断 | 保留 method、版本、关联 ID 和安全错误码 |

### M09 Runtime OAEP Writer 与兼容投影（5 项）

| 编号 | 功能点 | 验收 |
| --- | --- | --- |
| M09-F01 | Normalized Event 原子写 OAEP Journal/Item | Event 与 Projection 不分叉 |
| M09-F02 | OAEP Schema 写入前验证 | 非法事件 fail closed |
| M09-F03 | Legacy conversation 从 OAEP 投影 | 不再读 Codex 私有事件 |
| M09-F04 | OpenAI SSE/chat_completion 从 OAEP message 投影 | 文本兼容但不承载复杂事实 |
| M09-F05 | 迁移期双路径一致性审计 | 新旧结果差异可报告，OAEP 为权威 |

### M10 产品消费与真实场景（5 项）

| 编号 | 功能点 | 验收 |
| --- | --- | --- |
| M10-F01 | Desktop 结构化消息 | commentary/final 不重复、不覆盖错误 |
| M10-F02 | Command/Tool/File/Plan/Reasoning 卡片 | 刷新前后结构一致 |
| M10-F03 | 多轮连续会话 | N 次消息仍是一个 Session/Thread、N 个 Run/Turn |
| M10-F04 | 历史、归档、取消归档 | Codex 与 OAEP Session 状态一致 |
| M10-F05 | 本地/远程传输等价 | 同一 Adapter fixture 在 stdio/未来 SSH transport 语义一致 |

### M11 自动验收与发布门禁（5 项）

| 编号 | 功能点 | 验收 |
| --- | --- | --- |
| M11-F01 | Fake App Server 完整 Fixture | 覆盖乱序、重复、未知、审批、失败、EOF |
| M11-F02 | 真实 Windows Codex 自动 smoke | initialize/thread/两轮 turn/stream/completed |
| M11-F03 | 断线和压力验收 | 10k events、1M delta、100 次 reconnect |
| M11-F04 | Schema drift gate | Codex Schema 与 OAEP Schema 漂移均阻断 |
| M11-F05 | Release evidence | 生成机器可读功能矩阵、版本、hash、测试报告 |

## 5. 分阶段实施顺序

### P3：契约重构（下一阶段）

范围：M01、M02、M03。

交付物：

- 正式 OAEP v1 状态与版本基线。
- 当前 Codex 版本的生成 Schema 和稳定事件目录。
- `NormalizedAgentEvent` 强类型定义。
- Thread/Turn/Item 三层 binding 和顺序规则。
- 新旧 Adapter 出口并行比对测试。

P3 完成门槛：

- Codex Adapter 新路径不再依赖启发式 `_item_type()`。
- 多轮会话身份测试通过。
- started/delta/completed 全部绑定同一 OAEP Item。
- 现有 OAEP/Codex focused tests 全绿，包括当前 `mcpToolCall.result` 失败。

### P4：全量结构化语义

范围：M04、M05。

交付物：所有稳定 Codex Item、Delta 和最终校准映射。

P4 完成门槛：

- 映射矩阵中没有“未决定”的稳定 Codex 事件。
- `item/completed` 与 Delta replay 最终结果一致。
- UI 所需消息、计划、命令、工具、文件、Reasoning、Subtask 全部为 OAEP 原生结构。

### P5：交互、恢复与安全

范围：M06、M07、M08。

交付物：Interaction 生命周期、断线恢复、重放一致性、脱敏和诊断。

P5 完成门槛：

- 审批顺序完全符合 OAEP。
- App Server/Runtime 重启后无悬挂 Run/Item。
- canary、绝对路径、token、完整 traceback 零泄漏。

### P6：Runtime 与产品切换

范围：M09、M10。

交付物：OAEP Writer 权威化、Legacy Projection、Desktop/Android 产品消费。

P6 完成门槛：

- Desktop/Android 不再解析 Codex 私有事件。
- 多轮、刷新、归档、跨端审批全部从 OAEP 收敛。
- legacy 文本接口继续工作，但新语义只写 OAEP。

### P7：全自动验收与发布

范围：M11。

P7 完成门槛：

- 11/11 模块通过。
- 71/71 功能点 accepted。
- Fake + 真实 Windows Codex + 重连压力 + 跨端测试全部生成证据。
- Schema drift、敏感信息、协议非法状态任何一项失败均阻断发布。

## 6. 测试与验证方案

### 6.1 单元测试

- 每种 Codex Item 至少包含 started、delta/update、completed/failed Fixture。
- 每种 Delta 验证 kind、stream、ordinal、dedupe 和最终校准。
- 每种 Approval 验证 accept/session/decline/cancel/timeout。
- Unknown method/item 验证 Notice/diagnostic 和敏感字段过滤。

### 6.2 契约测试

- OAEP Schema 验证所有生成 Event/Item。
- Codex 生成 Schema 与受支持 manifest hash 对比。
- 映射矩阵必须覆盖生成 Schema 中全部稳定 notification/server request/item type。
- 删除、重命名或改变字段含义时必须显式升级 Adapter compatibility version。

### 6.3 集成测试

- Runtime Engine：Journal、Projection、sequence、revision、dedupe。
- Gateway：snapshot、events、subscribe、cursor expired。
- Codex Backend：Thread/Turn/Item、审批、取消、恢复。
- Legacy：conversation/chat_completion 与 OAEP message 的一致性。

### 6.4 真实 Codex 自动验收

固定场景：

1. 创建 Workspace 和 Session。
2. 第一轮要求记住随机 canary 的非敏感值。
3. 第二轮询问该值，证明复用同一 Codex Thread。
4. 执行一个可控命令，验证 command output 与 exit code。
5. 产生文件修改或 Diff，验证 file_change。
6. 触发一次审批并接受，再触发一次并拒绝。
7. 中断一轮，验证 cancelled。
8. 重启 Runtime/App Server，恢复 Session 并继续第三轮。
9. 比较实时累计状态、event replay 和最终 snapshot。

### 6.5 非功能测试

- 10,000 Event 重放。
- 1M 字符 Delta 有界处理。
- 100 次受控重连。
- 10 Workspace / 50 Session 并发路由隔离。
- Secret canary、绝对路径、PID、端口、凭证和 traceback 扫描。
- 本方案不把 Windows Sandbox 作为强制验收门禁。

## 7. 进度计量

新版进度只按本方案计数，不继承旧方案“96/96”的完成率。

当前估算：

| 模块 | 当前状态 | 已有基础 | 主要缺口 |
| --- | --- | --- | --- |
| M01 | partial | OAEP/Codex schema 验证脚本已有 | OAEP 正式状态、生成 Schema 全量覆盖 |
| M02 | not_started | 松散 `agent.*` 事件可作为迁移输入 | 强类型出口尚无 |
| M03 | partial | Thread/Turn binding 已有 | OAEP Item binding、用户消息去重、顺序冻结 |
| M04 | partial | message/command/reasoning/file/tool 部分存在 | plan/subtask/phase/完整字段 |
| M05 | partial | message/command/reasoning delta 部分存在 | ordinal、plan/tool delta、最终校准 |
| M06 | partial | Codex Approval Bridge 已有 | OAEP Interaction 与 waiting/resumed 顺序 |
| M07 | partial | generation、dedupe、thread/read 恢复已有 | snapshot/replay 强等价与 cursor expired |
| M08 | partial | 基础 secret redaction 和 buffer cap 已有 | 路径、大结果、unknown 全面策略 |
| M09 | partial | OAEP Projector/Journal 已有 | typed Writer 权威化、legacy 单向投影 |
| M10 | partial | Desktop OAEP subscription 已有 | 全结构化消费和真实跨端一致性 |
| M11 | partial | Fake/真实/压力测试基础已有 | 新 71 点证据与发布聚合器 |

由于当前主链仍是旧 `agent.*` → 启发式 OAEP Projection，**总体状态记为 P2 partial，不计算为 P3 已开始，也不声明任何模块 accepted**。

## 8. 兼容与迁移策略

1. 第一阶段保留旧 Adapter 路径，使用同一 Codex Fixture 同时运行 old/new mapper，比较 OAEP 结果。
2. 新路径通过全部 Fixture 后，Runtime 默认切换到 typed mapper；旧路径仅作为短期回滚开关。
3. 一个发布周期内记录差异但禁止双写两个 Journal。
4. 差异归零后删除 Codex 对旧 `agent.*` 写入口；其他 Backend 不受影响。
5. 不修改 `Codex Agent Backend = Codex Adapter + Codex App Server` 的既定架构。
6. 不新增 Codex 专用 Workspace 类型；本地 Windows 与未来远程 Linux 复用相同 Adapter，只替换 Transport/Process Host。

## 9. 完成定义

本方案完成后，必须满足：

```text
Codex App Server native JSON-RPC
  -> Codex Native Event Decoder
  -> typed NormalizedAgentEvent
  -> Runtime OAEP Writer
  -> OAEP Event Journal + Item Projection
  -> Desktop / Android / Relay

Legacy conversation / chat_completion
  <- OAEP projection
```

同时满足：

- 同一会话多轮对话只使用一个 Codex Thread/OAEP Session。
- 每条用户消息产生一个新 Codex Turn/OAEP Run，而不是新 Thread。
- 流式文本、Reasoning、Plan、Command、Tool、File、Subtask、Approval 都结构化。
- 最终 Item、snapshot 和 replay 一致。
- 失败、取消、审批等待和恢复均有确定终态。
- 本地 Windows 与未来远程 Linux 不需要两套语义 Adapter。
- 71/71 功能点均有自动化证据，未验证项不得标记完成。
