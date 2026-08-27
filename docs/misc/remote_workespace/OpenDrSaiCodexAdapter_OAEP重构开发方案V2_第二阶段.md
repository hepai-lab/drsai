# OpenDrSai Codex Adapter OAEP 重构开发方案 V2：第二阶段

状态：待实施  
日期：2026-08-02  
上游方案：`OpenDrSaiCodexAdapter_OAEP重构开发方案V2.md`  
协议基线：OAEP Stable v1.0 / `oaep.session-stream/1`  
目标平台：本地 Windows Codex；语义兼容未来远程 Linux Codex  

## 1. 阶段结论

第一阶段已经建立了正确的重构主干：

```text
Codex App Server
  -> CodexNativeEventDecoder
  -> NormalizedAgentEvent
  -> Runtime Normalized Writer
  -> OAEP Journal / Snapshot / Replay
  -> Desktop OAEP Consumer
```

但当前仍处于“新主链可运行、旧桥尚未完全退出”的过渡状态。第二阶段不重写 Codex Backend，也不改变既定架构：

```text
Codex Agent Backend = Codex Adapter + Codex App Server
```

第二阶段的核心目标是把过渡实现收敛为唯一权威实现：

1. 所有 Codex 稳定事件只经过强类型 Adapter 出口。
2. Runtime 直接把 `NormalizedAgentEvent` 原子写入 OAEP，不再以 `agent.*` 为中间事实源。
3. Thread、Turn、Item、Approval、终态、重放和客户端消费形成完整闭环。
4. 使用真实 Windows Codex 验证同一 Thread 的连续多轮会话。
5. 建立逐功能点、可机器验证、失败即阻止发布的验收证据。

本方案共 **10 个模块、58 个功能点**。进度只按 58 个功能点的验收状态计算，不使用开发轮次估算完成率。

## 2. 第一阶段基线

### 2.1 已有能力

- `NormalizedAgentEvent`、Backend Binding、Delta Kind、Terminal Status 强类型约束。
- `CodexNativeEventDecoder`，覆盖主要 Codex Item、Delta、Thread 和 Turn 通知。
- Runtime 侧 Normalized Writer 兼容桥。
- OAEP Stable v1.0 Schema、examples、Snapshot、Event Page、Session sequence。
- OAEP Item revision、dedupe、snapshot/replay 和递归脱敏。
- Plan、Reasoning、Command、File、Tool、Web、Image、Subtask、Notice 映射。
- Codex Approval Bridge、超时、拒绝、取消、孤儿审批 fail-closed。
- Desktop 历史、实时输出与重连开始消费 OAEP。
- Android 已具备 OAEP 事件、snapshot sequence 和 item revision 数据模型。
- Fake App Server、100 次重连、压力测试和 Schema drift 基础门禁。

### 2.2 已知过渡缺口

当前仍存在以下非最终形态：

- Agent Message Delta 为了批量缓冲仍可绕过 `CodexNativeEventDecoder`。
- `turn/completed` 在 Mapper 中存在特殊排除路径。
- Normalized Writer 仍把事件转换为内部 `agent.*`，再由旧 Runtime 逻辑生成 OAEP。
- Thread archive/unarchive/delete 暂时可能降级成 Notice，而非直接更新 Session。
- Desktop 实时 OAEP 映射缺少完整的专用行为测试。
- OAEP 写入前缺少统一的 Schema fail-closed 验证。
- 真实 Codex App Server 的联网、双轮同 Thread 验收尚未完成。
- 58 项第二阶段发布证据尚未生成。

## 3. 第二阶段目标架构

```text
OpenDrSai Desktop / Android / Relay
                 |
                 | OAEP v1 only
                 v
OpenDrSai Runtime
├─ OAEP Command/API Boundary
├─ OAEP Writer
│  ├─ Schema Validator
│  ├─ Identity Binder
│  ├─ Sequence / Revision Allocator
│  ├─ Event Journal
│  └─ Item Materializer
├─ Legacy Projection
│  ├─ conversation/1
│  └─ OpenAI-compatible SSE
└─ Codex Agent Backend
   ├─ Codex Adapter
   │  ├─ App Server Supervisor
   │  ├─ JSON-RPC Client
   │  ├─ Native Event Decoder
   │  ├─ Delta Batcher
   │  ├─ Semantic Mapper
   │  └─ Approval Bridge
   └─ Codex App Server
```

权威边界：

- Codex Adapter 只理解 Codex 私有协议并输出 `NormalizedAgentEvent`。
- Runtime OAEP Writer 是公开 ID、sequence、revision、journal 和 projection 的唯一生产者。
- Desktop、Android、Relay 不解析 Codex method、Thread/Turn 私有 DTO 或 `agent.*`。
- Legacy API 只能从 OAEP 投影，不能反向成为事实来源。
- 本地 Windows 和远程 Linux 复用同一 Decoder/Mapper/Writer；只替换 Process Host 与 Transport。

## 4. 模块与功能点

### S2-M01 强类型 Adapter 唯一路径（7 项）

| 编号 | 功能点 | 验收标准 |
| --- | --- | --- |
| S2-M01-F01 | Agent Message Delta 进入 Native Decoder | 不再直接调用 `emit_backend(agent.message.delta)` |
| S2-M01-F02 | Delta Batcher 输出 typed Delta | 缓冲、截断和 flush 后仍为 `NormalizedAgentEvent` |
| S2-M01-F03 | `turn/completed` 进入 typed terminal 路径 | completed/failed/interrupted 无特殊旁路 |
| S2-M01-F04 | 所有稳定 Item 通知只使用 typed mapper | 新路径不存在自由组合的 `kind/payload` |
| S2-M01-F05 | Unknown method 使用有界 Diagnostic/Notice | 原始 payload 不进入公开 DTO |
| S2-M01-F06 | 删除 Codex Adapter 对旧 `_item_type()` 的依赖 | 类型完全由 Native Schema 和 mapper 决定 |
| S2-M01-F07 | 禁止 Codex 新代码写 `agent.*` | 静态门禁扫描和单元测试阻止回归 |

### S2-M02 原生 OAEP Writer（7 项）

| 编号 | 功能点 | 验收标准 |
| --- | --- | --- |
| S2-M02-F01 | 定义 `append_normalized_event()` 原子事务 | Event、Item、sequence、revision 同事务提交 |
| S2-M02-F02 | Runtime 分配 OAEP Session/Run/Item ID | Adapter 只提供 backend binding |
| S2-M02-F03 | Session 级 Event sequence 严格递增 | 并发写入无重复、无倒退 |
| S2-M02-F04 | Item revision 严格递增 | started/delta/updated/completed 指向同一 Item |
| S2-M02-F05 | completed Item 权威校准 | 最终 Item 替换累计态且不重复文本 |
| S2-M02-F06 | OAEP Event 与 Item 物化原子一致 | 任一失败均不产生半条记录 |
| S2-M02-F07 | 删除 Normalized→`agent.*` 临时转换 | `normalized_writer.py` 不再是兼容桥 |

### S2-M03 Thread/Turn/Item 身份与生命周期（6 项）

| 编号 | 功能点 | 验收标准 |
| --- | --- | --- |
| S2-M03-F01 | Thread→Session binding 持久化 | Runtime/Desktop 重启后仍绑定原 Session |
| S2-M03-F02 | Turn→Run binding 持久化 | 同 Thread 每轮产生新 Run，不产生新 Session |
| S2-M03-F03 | Item binding 持久化 | started/delta/completed 始终命中同一 OAEP Item |
| S2-M03-F04 | thread started/archived/unarchived | 直接更新 OAEP Session 生命周期 |
| S2-M03-F05 | thread deleted 策略 | Session 标记 deleted，历史保留且默认不展示 |
| S2-M03-F06 | 用户输入去重 | Desktop outbox 与 Codex userMessage 只形成一个用户 Item |

### S2-M04 Delta、终态与结构化校准（6 项）

| 编号 | 功能点 | 验收标准 |
| --- | --- | --- |
| S2-M04-F01 | 七类 OAEP Delta 全量 typed | message/reasoning/plan/command/tool/subtask 全覆盖 |
| S2-M04-F02 | 相同内容相邻 Delta 不误去重 | ordinal 不同，dedupe key 不同 |
| S2-M04-F03 | 重连重放 Delta 可重复识别 | 同一次原始通知重放得到相同 dedupe key |
| S2-M04-F04 | commentary/final 分区 | UI 不把 commentary 当最终答复重复展示 |
| S2-M04-F05 | Run 三终态互斥 | completed/failed/cancelled 精确且只出现一次 |
| S2-M04-F06 | 悬挂 Run 自动收敛 | EOF、进程死亡、恢复失败后无永久 running |

### S2-M05 Desktop、Android 与 Relay OAEP 消费（6 项）

| 编号 | 功能点 | 验收标准 |
| --- | --- | --- |
| S2-M05-F01 | Desktop 实时消息只消费 OAEP | 不读取 `agent.*` 和 Codex item type |
| S2-M05-F02 | Desktop 结构化卡片完整 | Plan/Reasoning/Command/Tool/File/Subtask/Notice 均可展示 |
| S2-M05-F03 | Desktop 重连 cursor 正确 | 从 Session sequence 恢复，无丢失、无重复 |
| S2-M05-F04 | Android snapshot/event 收敛 | 刷新前后 Item 数量、状态和 revision 一致 |
| S2-M05-F05 | Relay 保持 OAEP 透明传输 | 不重写 Backend 私有语义，不改变 sequence |
| S2-M05-F06 | 客户端未知可选字段兼容 | 忽略未知字段但拒绝未知必需枚举 |

### S2-M06 Approval 与跨端 Interaction（5 项）

| 编号 | 功能点 | 验收标准 |
| --- | --- | --- |
| S2-M06-F01 | 三类审批原生 Interaction | command/file/permissions 字段完整 |
| S2-M06-F02 | waiting 顺序固定 | target waiting→interaction waiting→run waiting |
| S2-M06-F03 | decision 顺序固定 | interaction completed→run resumed→target running |
| S2-M06-F04 | 超时/拒绝/取消确定终态 | 无永久 waiting、无重复 JSON-RPC response |
| S2-M06-F05 | Desktop/Android 同一审批事实 | 任一端决定后另一端通过 OAEP 收敛 |

### S2-M07 重放、重启与故障恢复（6 项）

| 编号 | 功能点 | 验收标准 |
| --- | --- | --- |
| S2-M07-F01 | JSON-RPC generation 隔离 | 旧进程迟到消息不能写入新 Run |
| S2-M07-F02 | response 前通知暂存 | Turn binding 建立后按原顺序处理 |
| S2-M07-F03 | App Server 重启恢复 Thread | `thread/read(includeTurns=true)` 恢复 Item 与终态 |
| S2-M07-F04 | Runtime 重启恢复 OAEP cursor | snapshot 后继续 replay，无序列断层 |
| S2-M07-F05 | cursor expired 策略 | 强制重新获取 snapshot 后继续订阅 |
| S2-M07-F06 | snapshot/replay 强等价 | 任意 cursor 回放后与最终 snapshot 一致 |

### S2-M08 Schema、安全与诊断门禁（5 项）

| 编号 | 功能点 | 验收标准 |
| --- | --- | --- |
| S2-M08-F01 | 写入前 OAEP Schema 验证 | 非法 Event/Item fail closed |
| S2-M08-F02 | Codex Schema digest/version 固定 | CLI version、Schema digest、生成类型可追踪 |
| S2-M08-F03 | 递归 Secret canary 扫描 | Event、Snapshot、日志、错误零泄漏 |
| S2-M08-F04 | Workspace 路径边界 | OAEP 不暴露工作区外绝对路径 |
| S2-M08-F05 | 结构化安全诊断 | 保留 method、关联 ID、安全错误码，不保留原始敏感 payload |

### S2-M09 真实 Windows Codex 验收（5 项）

| 编号 | 功能点 | 验收标准 |
| --- | --- | --- |
| S2-M09-F01 | App Server initialize smoke | 本机已安装 Codex 能启动、握手和完成 Turn |
| S2-M09-F02 | 真实流式输出 | 首个 Delta 在 completed 前到达并持续更新 |
| S2-M09-F03 | 双轮同 Thread | 一个 Session/Thread、两个 Run/Turn，第二轮保留上下文 |
| S2-M09-F04 | 真实重启恢复 | 重启 App Server 后恢复同 Thread 并完成第三轮 |
| S2-M09-F05 | 真实终态与快照收敛 | 实时、replay、snapshot 三者一致 |

真实联网测试必须使用固定、无敏感信息的提示；禁止要求 Codex 读取文件或调用工具，除非该用例明确处于受控临时工作区并已获得授权。

### S2-M10 自动验收与发布证据（5 项）

| 编号 | 功能点 | 验收标准 |
| --- | --- | --- |
| S2-M10-F01 | 58 项机器可读验收矩阵 | 每项包含实现、测试、状态和证据路径 |
| S2-M10-F02 | Fake App Server 全量 Fixture | 覆盖乱序、重复、未知、失败、审批、EOF |
| S2-M10-F03 | 非功能压力门禁 | 10k Event、1M Delta、100 reconnect |
| S2-M10-F04 | 跨端契约门禁 | Python、Desktop TS、Android、Relay Schema 全通过 |
| S2-M10-F05 | 发布聚合器 fail closed | 任一必需功能非 accepted 即阻止发布 |

## 5. 实施阶段

### S2-P1：去旁路与 Writer 权威化

范围：S2-M01、S2-M02。  
目标：彻底删除 Codex→旧 `agent.*` 中间事实链。

实施顺序：

1. 把 Delta Batcher 的输出改为 typed delta。
2. 把 `turn/completed` 纳入 Decoder。
3. 新增 Runtime `append_normalized_event()` 事务入口。
4. 直接写 OAEP Event/Item/Binding 表。
5. 双路比较新旧最终 OAEP 结果，但只写一份 Journal。
6. 比较归零后删除 Codex 旧写入口。

完成门槛：14/14 accepted，代码静态扫描无 Codex `emit_backend("agent.*")`。

### S2-P2：身份、生命周期与终态闭环

范围：S2-M03、S2-M04。  
目标：保证多轮、重放和故障情况下身份与最终状态确定。

完成门槛：12/12 accepted；同一 Thread 两轮只产生一个 Session、两个 Run。

### S2-P3：客户端、审批与恢复闭环

范围：S2-M05、S2-M06、S2-M07。  
目标：Desktop、Android、Relay、审批和断线恢复全部只以 OAEP 为事实来源。

完成门槛：17/17 accepted；跨端刷新、重连和审批结果一致。

### S2-P4：Schema、安全与真实 Codex

范围：S2-M08、S2-M09。  
目标：完成协议 fail-closed 门禁与真实 Windows Codex 双轮/重启验证。

完成门槛：10/10 accepted；真实 smoke、双轮、重启恢复均生成证据。

### S2-P5：发布证据与收尾

范围：S2-M10。  
目标：生成 58 项验收账本，删除临时兼容开关和过期代码。

完成门槛：5/5 accepted；总计 58/58，发布聚合器返回 passed。

## 6. 测试与验证方案

### 6.1 单元测试

- Native method→Normalized kind/item/delta 映射表。
- 非法 binding、terminal、phase、stream、payload 组合拒绝。
- Delta batching、Unicode 边界、截断、ordinal 和 dedupe。
- Unknown event 安全降级。
- OAEP Schema 写入前验证。
- Session/Run/Item binding 持久化和唯一性。

### 6.2 Runtime 集成测试

- Normalized Event 原子写入 Event Journal 与 Item Materializer。
- 并发 sequence/revision。
- completed 对累计 Delta 的校准。
- Approval waiting/resumed 顺序。
- cursor replay、expired、snapshot 强等价。
- Runtime/App Server 重启和悬挂 Run 收敛。

### 6.3 Desktop/Android/Relay 契约测试

- Desktop OAEP mapper 的消息、推理和全部结构化卡片。
- commentary/final 不重复。
- Desktop 重连从 cursor 继续。
- Android Snapshot+Event reducer 收敛。
- Relay 不改变 OAEP event_id、sequence、revision 和 data。
- 客户端源码静态扫描：不得出现 Codex 私有 method/item 分支。

### 6.4 Fake App Server 验收

Fixture 至少覆盖：

- 正常 started→delta→completed。
- 相同内容连续 Delta。
- 重复通知和完整重放。
- response 前通知。
- 旧 generation 迟到通知。
- unknown method/item。
- command/file/permissions 审批接受、拒绝、超时、取消。
- EOF、进程死亡、重启恢复。
- archive、unarchive、delete。

### 6.5 真实 Windows Codex 验收

固定流程：

1. 检查 Codex CLI 版本及登录状态。
2. 启动 App Server 并完成 initialize。
3. 创建临时 Thread，第一轮记住随机非敏感 canary。
4. 第二轮询问 canary，证明 Thread 上下文复用。
5. 验证第一、第二轮 Turn ID 不同，Thread ID 相同。
6. 验证首个流式 Delta 早于 completed。
7. 重启 App Server，通过 `thread/read` 恢复 Thread。
8. 完成第三轮并比较实时、replay、snapshot。
9. 删除或归档临时验收 Thread，按产品策略保留最小证据。

### 6.6 非功能门禁

- 10,000 个 OAEP Event 重放。
- 1,000,000 字符 Delta 有界缓冲。
- 100 次 JSON-RPC/App Server 受控重连。
- 10 Workspace、50 Session 路由隔离。
- Secret、绝对路径、PID、端口、凭证和 traceback 扫描。
- 本方案不把 Windows Sandbox 作为必需门禁。

## 7. 兼容与迁移策略

1. 不修改 `Codex Agent Backend = Codex Adapter + Codex App Server` 架构。
2. 不新增 Codex 专用 Workspace；继续使用统一 Workspace Operation Protocol。
3. P1 期间允许旧投影作为比较器，不允许双写两个事实 Journal。
4. OAEP Writer 切换后，Legacy conversation 和 OpenAI SSE 只能从 OAEP 投影。
5. 旧客户端在一个兼容周期内继续工作，但不会获得新增结构化语义。
6. 远程 Linux Codex 不复制 Adapter，只实现相同 Process Host/Transport 接口。
7. 回滚只切换 Writer 入口，不回滚或删除已经提交的 OAEP Event。

## 8. 进度与证据模型

每个功能点只有四种状态：

- `not_started`
- `in_progress`
- `implemented`
- `accepted`

只有同时满足以下条件才能标记 `accepted`：

1. 实现代码存在。
2. 对应自动测试通过。
3. 证据记录了命令、时间、版本和结果。
4. 不依赖手工推断或开发轮次百分比。

进度计算：

```text
总体进度 = accepted 功能点数量 / 58 × 100%
```

机器可读证据建议写入：

```text
release/product-evidence/codex-adapter-oaep-v2-stage2/
├─ acceptance.json
├─ acceptance.md
├─ environment.json
├─ schema-digests.json
├─ fake-app-server.json
├─ real-codex-windows.json
├─ desktop-contract.json
├─ android-relay-contract.json
└─ stress.json
```

## 9. 风险与控制

| 风险 | 控制措施 |
| --- | --- |
| 新旧 Writer 双写导致 sequence 分叉 | 单 Journal、影子比较、禁止双写 |
| completed 与 Delta 重复文本 | 最终校准测试和 UI 去重测试 |
| Thread 恢复错误创建新会话 | 持久化 binding 唯一约束 |
| Codex Schema 升级漂移 | version+digest+generated types 发布门禁 |
| 未知原始 payload 泄漏 | 有界 Notice、递归脱敏、canary 扫描 |
| Desktop 实时与历史展示不同 | 实时 replay 与 snapshot 使用同一 OAEP reducer |
| 真实联网测试污染用户项目 | 临时 Thread、固定无工具提示、明确授权 |
| 远程 Linux 形成第二套 Adapter | 语义 Adapter 不变，只替换 Transport |

## 10. 完成定义

第二阶段只有在以下条件全部满足时才算完成：

- 58/58 功能点状态为 `accepted`。
- Codex Adapter 不再写自由结构的 `agent.*`。
- `NormalizedAgentEvent` 直接原子写 OAEP。
- Thread/Turn/Item/Interaction binding 均持久化且可恢复。
- 同一工作区会话连续多轮只复用一个 Codex Thread/OAEP Session。
- 每轮产生独立 Turn/OAEP Run，不产生新 Thread。
- Desktop、Android、Relay 不解析 Codex 私有协议。
- commentary/final、全部结构化 Item、审批和终态正确展示。
- 实时累计、任意 cursor replay 和最终 snapshot 一致。
- Fake、真实 Windows Codex、压力、重连、Schema、安全测试全部通过。
- 发布聚合器生成完整证据并返回 passed。

最终链路必须收敛为：

```text
Codex App Server native JSON-RPC
  -> Codex Native Event Decoder
  -> NormalizedAgentEvent
  -> Runtime OAEP Writer
  -> OAEP Event Journal + Item Materializer
  -> Desktop / Android / Relay

Legacy conversation / OpenAI-compatible SSE
  <- OAEP projection only
```
