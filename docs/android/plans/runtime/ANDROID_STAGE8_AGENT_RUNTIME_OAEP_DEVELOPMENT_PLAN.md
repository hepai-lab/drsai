# OpenDrSai Android 第 8 阶段：Android Agent Runtime 完全 OAEP 化开发计划

> 方案版本：V1.0  
> Android 目标版本：v1.6.0  
> 阶段编号：第 8 阶段  
> 状态：规划完成，待实施  
> 制定日期：2026-08-04  
> 前置阶段：第 7 阶段“Android Agent Runtime 生产化恢复、可信发布与 Beta 灰度”  
> 协议基线：OAEP Stable v1.0 / `oaep.session-stream/1`  
> 对齐基线：Desktop OAEP Writer、Journal、Snapshot、Replay 与结构化渲染主链

## 1. 版本与阶段结论

本方案是 **OpenDrSai Android 第 8 阶段**，目标产品版本为 **Android v1.6.0**。

- “第 8 阶段”是 Android 产品开发阶段编号。
- “V1.0”是本文档版本。
- “v1.6.0”是目标 Android 应用版本。
- OAEP 继续使用 Stable v1.0 及其向后兼容扩展，不创建 OAEP 2.0。
- “共享 Python Runtime”从本阶段起在产品、代码注释和文档中统一称为 **Android Agent Runtime**。

第 5 阶段完成统一工作台与 Runtime V2；第 6 阶段验证共享 Python Agent Core；第 7 阶段解决恢复、副作用一致性、可信构建和 Beta 灰度。第 8 阶段不再扩展另一套 Android 私有事件模型，而是把 Android Agent Runtime 的语义出口、持久化、恢复、UI、Relay 和兼容接口统一到 OAEP。

当前 Relay 契约已把 `oaep/1` 和 `oaep.session-stream/1` 的 Android 最低版本声明为 `1.6.0`，因此本阶段不能落入 v1.5.x 补丁版本。

## 2. 当前基线与核心缺口

### 2.1 已有基础

Android 已具备：

1. OAEP v1 生成模型、Schema 哈希和严格 JSON Codec；
2. Relay OAEP Snapshot、Event Page 和 Session SSE 消费；
3. Room 中的 OAEP Run、Item、Event 和 Session Cursor 投影；
4. Snapshot + Event 的重复、乱序、缺口和重建处理；
5. Android Agent Runtime 的 Python Core、Binder/JSON Envelope、Checkpoint、恢复、Tool、Approval、Artifact、Skill 和 Subagent；
6. Runtime V2 Journal、可靠性分类、灰度策略、安全与性能验收基础；
7. Desktop/Runtime 的 OAEP Writer、Normalized Event 与结构化投影参考实现。

### 2.2 当前不符合目标架构的事实

本地 Android Agent Runtime 仍经过以下兼容链路：

```text
Python Agent Core
  -> PythonRuntimeEnvelope
  -> PythonRuntimeEventMapper
  -> Android RuntimeEvent
  -> RuntimeV2EventRecorder / WorkbenchEvent
  -> AppViewModel 直接处理 RuntimeEvent
```

主要缺口：

1. `RuntimeEvent` 和 `WorkbenchEvent.kind` 仍是 `run.started`、`message.delta`、`tool.started` 等 Android 私有语义；
2. 本地执行没有权威 OAEP Session、Run、Item、Event Journal；
3. Message、Reasoning、Plan、Command、File Change、Tool、Artifact、Interaction、Subtask、Notice 未完整 Item 化；
4. Approval 请求在 Python Event Mapper 中被忽略，未形成 OAEP Interaction 与 Run waiting/resumed；
5. 本地 UI 直接消费瞬时 `RuntimeEvent`，刷新和恢复依赖另一套本地 Message 状态；
6. 本地、远程和 Desktop 的结构化渲染不能证明来自同一 OAEP Snapshot；
7. Legacy conversation/chat 接口尚未严格限定为 OAEP 的只读兼容投影。

## 3. 阶段目标与非目标

### 3.1 总目标

建立与 Desktop 相同的唯一权威主链：

```text
Android Agent Core
  -> versioned internal runtime envelope
  -> Android Normalized Agent Event
  -> Android OAEP Writer
  -> OAEP Event Journal + Item Projection
  -> Snapshot / Replay / Relay / Android UI / Legacy Projection
```

完成后，Android Agent Runtime 必须能够承载完整智能体语义，并满足：

- Android、Desktop 和 Relay 只消费 OAEP，不理解 Android/Python/Backend 私有事件；
- 实时、重放和 Snapshot 得到同一最终结果；
- 本地 Android Agent Runtime 与 Desktop Agent Runtime 对相同语义 fixture 产生等价 OAEP；
- 刷新、重启、断线、升级、审批和取消不改变 Session → Run → Item 身份；
- 新智能体能力通过 OAEP Item 扩展或兼容字段表达，不再增加 UI 专用事件旁路。

### 3.2 本阶段不做

- 不修改 OAEP 的 Session → Run → Item 三层领域模型；
- 不把 Binder、Service 生命周期、认证、心跳或文件传输塞入 OAEP；
- 不让 Python Core直接操作 Room、Android Context、SAF、通知或系统权限；
- 不复制 Desktop 的平台实现细节，只对齐公开 OAEP 语义和验收 fixture；
- 不保留双写作为长期架构；双写只允许用于迁移审计；
- 不以新增 Tool 数量代替协议闭环验收。

## 4. 必须冻结的架构不变量

1. **单一事实源**：已提交 OAEP Journal 是 Run/Item 状态、历史、恢复和跨端同步的唯一事实源。
2. **单一写入口**：只有 Android OAEP Writer 可以分配 OAEP ID、Event sequence、Item revision 和终态。
3. **Session 级游标**：Event sequence 在 Session 内严格递增，跨 Run 连续。
4. **稳定身份**：同一 Session、Run、Item 在 started/delta/completed、重放和重启后 ID 不变。
5. **原子提交**：Event append 与 Run/Item Projection 在同一 Room 事务内提交。
6. **最终 Item 权威**：Delta 仅用于实时显示，最终 Item 必须由 completed/failed/cancelled Event携带。
7. **私有协议止于 Adapter**：UI、Relay、缓存和验收不得依赖 `PythonRuntimeEnvelope`、`RuntimeEvent` 或 Python event kind。
8. **未知语义可观察**：未知 Backend/Agent 事件投影为有界 Notice 或诊断，不静默丢失、不泄露原始对象。
9. **副作用先持久化**：Tool、Approval、Artifact 在外部动作前后记录稳定 operation/call/approval ID 和 durable receipt。
10. **兼容接口单向投影**：Legacy conversation、Message 表和文本 SSE 只能从 OAEP 投影，不得反向成为权威状态。
11. **账户与工作区隔离**：所有写入和读取均绑定 subject、organization、runtime、workspace、session。
12. **默认安全关闭**：Schema 不兼容、sequence 冲突、身份错配和迁移失败均 fail closed。

## 5. 模块与功能点

本阶段共 **12 个模块、72 个功能点**。

### M01 协议基线与生成契约（6）

| 编号 | 功能 | 验收标准 |
|---|---|---|
| M01-F01 | 固定 OAEP Stable 1.0、profile、Schema hash 与 Android 最低版本 | Kotlin、Python、Relay、Desktop 常量一致，漂移测试通过 |
| M01-F02 | 生成完整 Kotlin OAEP 类型与严格 Codec | 所有 Item/Event/Snapshot fixture 正反序列化；未知必需版本拒绝 |
| M01-F03 | 冻结 Android Runtime Envelope 与 OAEP 的边界 | 文档明确 Envelope 只承担 IPC，不能成为 UI/Journal 事实源 |
| M01-F04 | 建立 Python event → Normalized event → OAEP 映射矩阵 | 每种事件明确 map/ignore/notice/diagnostic，无未分类事件 |
| M01-F05 | 建立 Desktop/Android 共享 OAEP fixture | 两端对同一输入生成规范化等价 Snapshot 和 Event digest |
| M01-F06 | 建立 Schema 与生成代码 drift gate | Schema 或生成文件单边变更时 CI 失败 |

### M02 Android Normalized Agent Event（6）

| 编号 | 功能 | 验收标准 |
|---|---|---|
| M02-F01 | 定义平台无关的 Normalized Event union | 覆盖 Session、Run、10 类 Item、Delta、Error 和终态 |
| M02-F02 | 分离 Backend ID、Android Runtime ID 与 OAEP ID | 类型层禁止混用；错误绑定在写入前拒绝 |
| M02-F03 | 将 Python Core输出严格解码为 Normalized Event | 缺字段、非法状态、超限正文和未知必需类型 fail closed |
| M02-F04 | Kotlin Lite 和 Platform Agent 接入相同 Normalized 出口 | 三种 Runtime authority 不再分别定义展示事件 |
| M02-F05 | 保留有界诊断元数据 | 不写 Token、绝对路径、原始私有 payload 或用户敏感正文 |
| M02-F06 | 移除 Mapper 中 Approval/Checkpoint 静默丢弃 | 每个语义事件产生 OAEP、内部状态动作或明确诊断 |

### M03 Android OAEP Writer（6）

| 编号 | 功能 | 验收标准 |
|---|---|---|
| M03-F01 | 实现 Android OAEP Writer 单一入口 | 业务代码不能直接写 OAEP Event/Item 表 |
| M03-F02 | 建立 Session/Run/Item 稳定绑定表 | 重启、恢复、重放后 ID 完全一致 |
| M03-F03 | 分配 Session 级 Event sequence | 并发 Run 下严格递增、无重复、无回退 |
| M03-F04 | 实现 Event dedupe 与 Item revision | 重复 Python/Binder 回调不重复 Item，旧 revision 不覆盖新状态 |
| M03-F05 | 原子写入 Journal 与 Projection | 任意注入崩溃后不存在只有 Event 或只有 Projection 的状态 |
| M03-F06 | 验证状态机和终态闭包 | completed/failed/cancelled 后拒绝非法 Delta 或状态回退 |

### M04 完整结构化 Item（6）

| 编号 | 功能 | 验收标准 |
|---|---|---|
| M04-F01 | Message 与多模态 parts | 文本、图片、音频、文件和 resource_ref 完整恢复 |
| M04-F02 | Reasoning 摘要与 Plan | 流式增量和最终结构一致，不暴露模型原始思维链 |
| M04-F03 | Command Execution 与 File Change | 命令、cwd、输出、exit code、diff 和状态完整展示 |
| M04-F04 | Tool Call | arguments、result、call_id、duration 和错误不丢失 |
| M04-F05 | Artifact、Subtask 与 Notice | 产物、子智能体层级、结果摘要和降级提示可查询可重放 |
| M04-F06 | 未知事件降级 | 生成 Notice + 有界诊断，Run 可以确定性继续或失败 |

### M05 Interaction、审批与副作用（6）

| 编号 | 功能 | 验收标准 |
|---|---|---|
| M05-F01 | Approval 生成 Interaction Item | `event.item.created` 与 `event.run.waiting` 顺序稳定 |
| M05-F02 | 审批决定更新同一 Interaction Item | 第一决定胜出；重复点击和跨端竞争不重复授权 |
| M05-F03 | 恢复执行产生 `event.run.resumed` | waiting → resumed → running 顺序合法 |
| M05-F04 | Tool intent/receipt 关联 OAEP Tool Item | 恢复重放复用 receipt，外部副作用恰好一次 |
| M05-F05 | Artifact operation 关联 OAEP Artifact Item | 成功后崩溃可恢复，不生成重复 Artifact |
| M05-F06 | reconciliation 可见 | 不可判定副作用投影为 waiting Interaction/Notice，不伪造终态 |

### M06 OAEP Journal、Snapshot 与 Replay（6）

| 编号 | 功能 | 验收标准 |
|---|---|---|
| M06-F01 | 建立本地 OAEP Event Journal | append-only，支持按 Session sequence 分页 |
| M06-F02 | 建立 Run/Item Projection | Snapshot 只读 Projection，不临时重放 Python 私有事件 |
| M06-F03 | 实现 Snapshot watermark | Snapshot sequence 与后续 Event 无缝衔接 |
| M06-F04 | 实现 replay、gap 和 cursor expired | 重放无重无漏；过期游标强制 Snapshot 恢复 |
| M06-F05 | 实现 Journal 压缩与保留策略 | 不删除 Snapshot 水位之后所需事件，不破坏审计和恢复 |
| M06-F06 | 建立 digest 与一致性校验 | 实时归约、完整 replay、冷启动 Snapshot digest 相同 |

### M07 Android UI 完全切换 OAEP（6）

| 编号 | 功能 | 验收标准 |
|---|---|---|
| M07-F01 | 本地聊天 UI 改读 OAEP Projection | `AppViewModel` 不再直接根据 RuntimeEvent 拼接最终消息 |
| M07-F02 | 统一本地与远程结构化渲染 | 相同 OAEP Item 在两入口生成相同语义组件 |
| M07-F03 | 按 Session → Run → Item 渲染 | 多轮顺序不按 Item sequence 跨 Run 错排 |
| M07-F04 | 支持 commentary/final 和流式 Delta | 刷新前后内容、阶段、状态和位置一致 |
| M07-F05 | 支持 Interaction、Tool、Command、File、Artifact、Subtask | 完整体智能体活动不降级为纯文本 |
| M07-F06 | 状态与错误完全来自 OAEP | running/waiting/recovering/failed/cancelled 无旁路 UI 状态 |

### M08 恢复、生命周期与通知（6）

| 编号 | 功能 | 验收标准 |
|---|---|---|
| M08-F01 | Checkpoint 绑定 OAEP Run 水位 | 恢复不会回放已提交副作用或丢失已完成 Item |
| M08-F02 | 冷启动从 OAEP Snapshot 恢复 UI | 不依赖内存 RuntimeEvent 缓冲或临时 Message 拼接 |
| M08-F03 | Runtime Service 重绑后续写同一 Run | 不创建第二 Run/Item，不重置 Event sequence |
| M08-F04 | 通知 deep link绑定 Session/Run/Interaction | 点击后打开相同 OAEP 事实，不创建新执行 |
| M08-F05 | 旋转、分屏、后台和进程回收 | 归约结果一致且无重复协调器 |
| M08-F06 | 取消、暂停、恢复和账户切换 | 每个动作产生合法 OAEP 序列并满足账户隔离 |

### M09 Relay 与跨端统一（6）

| 编号 | 功能 | 验收标准 |
|---|---|---|
| M09-F01 | Android 本地 Session 可发布 OAEP Snapshot | Relay 不从 Android 私有事件反向推断 OAEP |
| M09-F02 | Android 主动发送 OAEP Event 帧 | schema、scope、generation 和 sequence 验证通过 |
| M09-F03 | Desktop/Android 同时观看同一 Session | P95 2 秒内出现相同结构化 Item |
| M09-F04 | Android 发起、Desktop 接收完整语义 | Message、Tool、Approval、Artifact、Subtask 不丢失 |
| M09-F05 | Desktop 发起、Android 接收完整语义 | 实时、重连和 Snapshot 最终 digest 一致 |
| M09-F06 | 跨端并发和审批竞争 | Runtime 统一排序，审批和副作用只执行一次 |

### M10 数据迁移与兼容收敛（6）

| 编号 | 功能 | 验收标准 |
|---|---|---|
| M10-F01 | 设计旧 Conversation/Message/WorkbenchEvent 迁移 | 升级后历史文本、附件、状态和时间不丢失 |
| M10-F02 | 为旧记录生成稳定 OAEP binding | 重复迁移幂等，不能每次启动生成新 ID |
| M10-F03 | 迁移进行中 Run | 可安全恢复则恢复，否则明确 failed/paused，不永久 running |
| M10-F04 | 双写影子审计 | 迁移期比较 Legacy/OAEP，差异阻断切换但不双重展示 |
| M10-F05 | Legacy 只读投影 | conversation/chat/text SSE 全部从 OAEP 生成 |
| M10-F06 | 删除生产私有事件旁路 | 全量切换后 RuntimeEvent 仅限 Adapter 内部或彻底移除 |

### M11 测试、性能与安全门禁（6）

| 编号 | 功能 | 验收标准 |
|---|---|---|
| M11-F01 | Mapper/Writer/Reducer 属性测试 | 重复、乱序、缺口、崩溃点和非法状态全覆盖 |
| M11-F02 | Desktop/Android 跨 Runtime parity | 规范化 OAEP Snapshot/Event SHA-256 一致 |
| M11-F03 | API 26/30/35/36 与 arm64/x86_64 | JVM、模拟器及至少一台 arm64 真机通过 |
| M11-F04 | 500 Run/50 Tool/20 Recovery 压力 | 0 重复副作用、0 数据损坏、0 永久 running |
| M11-F05 | 性能与存储预算 | 冷启动、恢复、PSS、数据库增长不劣于第 7 阶段门槛 |
| M11-F06 | 安全门禁 | OAEP、checkpoint、receipt、logcat、APK 无 Token、绝对路径和跨账户数据 |

### M12 发布、灰度与退场（6）

| 编号 | 功能 | 验收标准 |
|---|---|---|
| M12-F01 | 构建 v1.6.0 可追溯候选 | commit、dirty、APK、mapping、SBOM、Schema hash 全关联 |
| M12-F02 | OAEP capability 和最低版本门禁 | 不兼容 Relay/Runtime 明确拒绝或安全降级 |
| M12-F03 | Internal/Canary/Beta 分档 | 每档满足样本量、观察窗口和自动暂停条件 |
| M12-F04 | kill switch 与回滚演练 | OAEP 数据可读，回滚不破坏 Session/Run/Item |
| M12-F05 | 移除兼容桥和失效开关 | 生产代码不再存在可启用的私有事实源路径 |
| M12-F06 | 最终 Go/No-Go | 72/72、跨端 E2E、真机、安全、性能、迁移全部通过 |

## 6. 实施顺序

| 阶段 | 内容 | 出口条件 |
|---|---|---|
| S0 基线冻结 | M01；冻结 OAEP Schema、fixture、当前 APK 和迁移输入 | Desktop/Android 契约测试可重复 |
| S1 规范化出口 | M02；Python/Kotlin/Platform Runtime 统一 Normalized Event | 私有事件不越过 Adapter |
| S2 权威写入 | M03、M04；Writer、binding、完整 Item | 同一 fixture 生成稳定 Journal/Snapshot |
| S3 交互与恢复 | M05、M06、M08 | 审批、副作用、恢复和重放闭环 |
| S4 产品切换 | M07、M10 | 本地 UI 和 Legacy 接口只读 OAEP |
| S5 跨端统一 | M09 | Android/Desktop/Relay digest 一致 |
| S6 发布门禁 | M11、M12 | v1.6.0 最终 Go/No-Go |

不得先把 UI 切到未完成的 OAEP Projection；也不得在 Writer 未成为唯一入口前删除 Legacy 读取。推荐顺序为“影子比较 → OAEP 权威 → UI 切换 → Legacy 单向投影 → 删除双写”。

## 7. 关键状态与事件序列

### 7.1 普通消息

```text
event.run.created
event.item.completed    user message
event.run.started
event.item.started      assistant message
event.item.delta        text delta × N
event.item.completed    final assistant message
event.run.completed
```

### 7.2 Tool 与审批

```text
event.item.started      tool_call
event.item.started      interaction
event.run.waiting
event.item.completed    interaction response
event.run.resumed
event.item.completed    tool_call + receipt
```

### 7.3 恢复

```text
load OAEP snapshot at sequence N
load checkpoint bound to run/item/revision/N
rebind Android Agent Runtime
dedupe already committed effects
event.run.resumed at N+1
continue item delta/completion
```

## 8. 数据迁移策略

1. 新增数据库版本，只增表/索引和 binding，不原地破坏旧 Message 数据；
2. 首次升级按账户和 Session 分批迁移，记录 migration version、source digest 和完成水位；
3. 已完成历史转换为 OAEP Run/Message/Artifact；无法精确恢复的结构生成 Notice，不伪造 Tool 或 Approval；
4. 进行中记录只有在 checkpoint 与副作用状态可证明时恢复，否则转为 paused/failed；
5. 影子期继续读旧 UI，但后台生成 OAEP 并比较 digest；
6. OAEP 权威切换后，旧表只用于回滚窗口和审计；
7. 完成两个稳定版本观察后再制定物理删除计划，本阶段不直接破坏用户回滚能力。

## 9. 自动验收矩阵

### 9.1 单元与属性测试

- Envelope、Normalized Event、OAEP Codec；
- binding、ID、sequence、revision、dedupe；
- Writer 事务崩溃点；
- Item reducer 与 Snapshot；
- Approval/Tool/Artifact 幂等；
- Legacy Projection；
- 未知事件、非法状态和 Schema drift。

### 9.2 Android instrumentation

- 本地完整智能体关键旅程；
- 旋转、分屏、后台、Doze、kill process、Service 重启；
- Tool、Approval、Artifact、Skill、两个以上 Subagent；
- 冷启动 Snapshot、Event replay、cursor gap；
- 升级迁移与降级回滚；
- 多账户和跨 Workspace 隔离。

### 9.3 跨端 E2E

同一测试至少产生两个连续 Run，并比较 Android、Desktop、Relay 三份规范化结果：

- Session/Run/Item ID 与层级；
- Event sequence；
- Message parts 与最终文本；
- Plan、Reasoning、Command、File Change、Tool、Artifact、Interaction、Subtask、Notice；
- Run/Item 终态；
- Snapshot digest；
- 断线重放后的 digest。

## 10. 发布硬门禁

以下任一项失败，v1.6.0 Android Agent Runtime OAEP 模式不得进入下一灰度档：

1. 72 个功能点未全部通过；
2. Android UI 或 Relay 仍读取 Python/Android 私有事件；
3. Event 与 Projection 不能原子收敛；
4. 实时、replay、Snapshot digest 不一致；
5. Desktop/Android 同一 fixture 语义不一致；
6. Approval、Tool 或 Artifact 出现重复副作用；
7. 重启后 Session/Run/Item ID 改变；
8. 迁移造成历史、附件、审批或运行状态丢失；
9. Schema drift、未知必需版本或身份错配未 fail closed；
10. 真机完整旅程、安全、性能或升级回滚失败；
11. Release APK 未绑定唯一 commit、OAEP Schema hash 和验收 run ID；
12. OAEP kill switch 和 APK 回滚未完成演练。

## 11. 交付物

- Android Normalized Agent Event 类型和 Python/Kotlin 映射；
- Android OAEP Writer、Journal、Projection、Snapshot 和 Replay；
- 完整 OAEP Item 生产与 Android 结构化渲染；
- OAEP 化的 Approval、Tool、Artifact、Subtask 和恢复链路；
- 旧数据迁移器与 Legacy 单向投影；
- Desktop/Android/Relay 共享 fixture 和 parity 报告；
- v1.6.0 APK、mapping、SBOM、Schema hash、测试和真机证据；
- 第 8 阶段进度报告、迁移报告及最终 Go/No-Go。

## 12. 完成定义

第 8 阶段只有同时满足以下条件才算完成：

1. Android Agent Runtime 的所有公开执行事实均写为 OAEP；
2. Android 本地和远程 UI 只从 OAEP Snapshot/Event Projection 渲染；
3. Legacy 接口只从 OAEP 单向投影；
4. Android、Desktop、Relay 对同一 Session 的规范化 Snapshot digest 一致；
5. 完整智能体能力均有结构化 OAEP Item，不以纯文本或 UI 私有状态替代；
6. 实时、刷新、重放、冷启动、进程恢复和升级迁移收敛到同一结果；
7. Approval 和外部副作用满足幂等、审计与恢复要求；
8. 72/72 功能点及所有发布硬门禁通过；
9. 私有 `RuntimeEvent`/`WorkbenchEvent` 不再是生产事实源；
10. v1.6.0 完成受控灰度并取得最终 `GO`。

达到以上条件后，才能宣称：**Android Agent Runtime 与 Desktop Runtime 一样完成 OAEP 化，并在 Android 端支持完整体智能体功能。**
