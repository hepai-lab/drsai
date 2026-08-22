# OpenDrSai Codex Adapter OAEP P9：真实增量与恢复闭环开发方案

状态：已完成（48/48）  
制定日期：2026-08-04  
完成日期：2026-08-05  
阶段：Codex Adapter 第 9 阶段（P9）  
上游基线：`OpenDrSaiCodexAdapter_OAEP_P8可靠性与证据闭环开发方案.md`

## 1. 阶段结论

P8 已经建立 Codex 原生协议边界、Stable Contract、Native Decoder、OAEP Mapper、增量合并器、统一终态器、Session/Run 持久绑定和 Desktop Snapshot/Patch 通道。P9 不改变这些架构边界，也不增加新的表层入口；本阶段负责把“形式上的增量与恢复”收敛为“真实可证明的增量与恢复”。

P9 的完成不能由功能文件存在、测试脚本退出码为零或人工修改账本证明。每一个功能点必须绑定当前源代码、当前构建、实际执行结果；需要宿主机 Codex 的功能必须由当前主机上的真实 Codex App Server 完成。

## 2. 总体目标

P9 完成时必须同时满足：

1. 一个 OpenDrSai Session 持久对应一个 Codex Thread，多轮消息只增加 Turn。
2. Codex 原生事件只由 Adapter 解码，Desktop 只消费 OAEP 和后端中立的 View Patch。
3. 普通实时事件只发送目标 Item/Part 的增量，Patch 大小不随当前 Run 已有正文线性增长。
4. Snapshot、Replay、SSE 和主动补水共享同一个 `generation + sessionSequence` 事务边界。
5. 断线、Runtime 重启、Codex App Server 重启和旧请求迟到不会造成重复、丢失、乱序或永久拒绝后续 Patch。
6. 会话是否可继续由 Runtime 持久绑定状态决定，Desktop 不再根据线程名称、归档来源或 `lastRunId` 猜测。
7. Codex 模型、登录状态和协议兼容性在发送前可发现；已有 Session 的模型不会静默变化。
8. 历史同步可取消、可失效、可重入，展示的进度必须来自真实阶段。
9. 本地和远程 Runtime Client 都在握手后使用权威 `runtime_id + instance_id + transport_generation`。
10. P9 账本从执行证据计算状态；任何缺失、过期、摘要不匹配或真实在线测试缺失都不得标记 `accepted`。

## 3. 保留、更新与移除边界

### 3.1 保留

- Codex App Server → Native Decoder → Event Mapper → OAEP 的适配边界。
- OAEP Journal 作为 Session/Run/Item/Event 权威事实源。
- `delta_coalescer.py`、`run_finalizer.py`、诊断隔离和 Stable Contract。
- Runtime Session/Run 与 Codex Thread/Turn 的持久绑定模型。
- Runtime Client 的本地进程与远程 SSH 传输抽象。
- 显式 Legacy rollback 能力，直到真实遥测满足退场门槛。

### 3.2 更新

- View Patch 从“按 Run 重投影”更新为按 Item/Part 的真实增量操作。
- Snapshot IPC 更新为携带游标与 generation 的 Envelope。
- Session Binding 增加模型、工作区指纹和恢复状态。
- Model Catalog 增加主动刷新、最近成功缓存和发送前校验。
- Runtime Client 增加临时身份到权威身份的升级。
- 登录、合同兼容、模型、连接和恢复错误更新为发送前可操作状态。
- P8/P9 证据生成器更新为 fail-closed。

### 3.3 移除

- 正常实时流中的整 Run `messages` 替换式 Patch。
- `requiresCodexSessionResume()` 中基于线程 ID、归档来源和 `lastRunId` 的业务判断。
- Renderer 的 `opendrsai.threadSnapshots` localStorage 第二事实源。
- `CodexModelCapability.raw` 原始响应保留。
- 历史同步完成后一次性伪造的 `read/projected/persisted` 进度。
- 账本生成器无条件写入 `accepted` 的逻辑。
- Adapter 对 JSON-RPC Client/Supervisor 私有成员的直接访问。

Legacy Conversation Adapter 本阶段不硬删除。只有连续两个正式发布环真实使用量为零、受支持 Runtime 不再要求 Legacy、升级/降级/显式回滚测试全绿后才允许进入后续删除阶段。

## 4. 整体架构

```text
Codex App Server
  └─ 原生 JSON-RPC 通知
       ↓
Codex Adapter
  ├─ Stable Contract / Compatibility
  ├─ Native Decoder
  ├─ OAEP Event Mapper
  ├─ Delta Coalescer
  ├─ Run Finalizer
  ├─ Session Binding Coordinator
  ├─ Model / Account Capability Service
  └─ Diagnostics Sink
       ↓ OAEP Session / Run / Item / Event
Runtime Engine + OAEP Journal
       ↓ Snapshot Envelope / Replay / SSE
Desktop Runtime Client
       ↓ Item/Part View Patch
Renderer Snapshot Coordinator
       ↓
统一四层任务输出
  1. 单行运行状态
  2. 可折叠处理过程
  3. 最终回答
  4. 后续操作
```

核心不变量：

- `Session = 1 Codex Thread`，`Run = 1 Codex Turn`。
- OAEP `session_sequence` 在一个 Session 内严格单调。
- View Patch 必须携带 `baseSequence/sessionSequence/generation`。
- `run.replace` 只允许用于首次加载、明确 resync 或版本迁移。
- 任一 Run 只允许一个终态。
- UI 不显示隐藏思维链，只显示后端允许公开的 reasoning summary。

## 5. 模块、功能点、测试与验收

### M01 证据真实性与发布账本

主要更新：P8/P9 ledger 生成器、验证器、release runner、artifact manifest。

| ID | 功能点与实现 | 自动测试 | 验收标准 |
| --- | --- | --- | --- |
| M01-F01 | 账本状态从对应 suite 结果计算，不预填 `accepted` | 失败、缺失、跳过三类 fixture | 任一证据不满足时状态为 `failed/blocked/missing` |
| M01-F02 | 每条证据绑定 feature id、命令、断言集合和 artifact digest | 篡改命令、结果或 artifact | 任一字段不一致时 verifier 非零退出 |
| M01-F03 | suite 结果绑定 source、dirty、build、Codex binary digest | 修改源文件后复验 | 旧证据不能验证新源代码 |
| M01-F04 | 真实 Codex 功能单列 live gate | 未登录、离线、成功三矩阵 | 未执行真实 App Server 时不得 accepted |
| M01-F05 | Electron 门禁测量真实 reducer/render，而不只测 IPC 传输 | 真实线程绑定与 1,000 增量 | 记录 transport、apply、render 三段 P95 |
| M01-F06 | release manifest 汇总每功能证据和环境身份 | manifest schema/hash test | 可由机器重新计算总体进度，无人工改状态 |

### M02 权威 Session Binding 与多轮连续性

主要更新：`agent_bindings.py`、Codex Backend Client、Runtime API、Desktop chat 路由。

| ID | 功能点与实现 | 自动测试 | 验收标准 |
| --- | --- | --- | --- |
| M02-F01 | Runtime 暴露 `unbound/bound/recovery-required/conflict/backend-missing` | 五状态 contract test | Desktop 不再猜测恢复状态 |
| M02-F02 | 移除线程命名、归档来源、`lastRunId` 恢复启发式 | 新建、导入、归档、旧 Run 矩阵 | 新建会话可直接发送；导入会话正确恢复 |
| M02-F03 | Session Binding 持久化 backend model、canonical workspace fingerprint | SQLite migration + restart | 重启后身份字段完整且不可静默改变 |
| M02-F04 | 一 Session 多轮只复用一个 Codex Thread | 30 轮真实/fixture 测试 | 1 Thread、30 Turn、30 Run，无重复 |
| M02-F05 | 恢复冲突提供明确的继续、重新绑定或新建任务动作 | conflict fault injection | 不覆盖已有绑定，不返回通用失败 |
| M02-F06 | workspace/cwd 不一致阻止错误恢复 | symlink、改名、远程路径矩阵 | 不把会话恢复到错误工作区 |

### M03 Snapshot Envelope 与事务恢复

主要更新：Desktop API、Preload/Main IPC、Session View Store、Renderer Snapshot Coordinator。

| ID | 功能点与实现 | 自动测试 | 验收标准 |
| --- | --- | --- | --- |
| M03-F01 | `getThreadSnapshotEnvelope` 返回 snapshot、sequence、generation、runtimeSessionId | API/IPC contract | push 与 pull 使用同一结构 |
| M03-F02 | 一个原子 reducer 同时应用 snapshot 和游标 | reducer property test | 不出现内容已更新但游标未更新 |
| M03-F03 | 补水成功时清空旧 Patch 队列并设置 accepted/applied | gap + hydrate test | 下一条连续 Patch 立即可应用 |
| M03-F04 | generation 改变时物理取消旧补水请求 | delayed IPC/Abort test | 旧结果不覆盖新 generation，旧操作终止 |
| M03-F05 | Snapshot、Replay、SSE 竞态按权威游标收敛 | 全排列与随机时序测试 | 最终 digest 相同、无重复、无丢失 |
| M03-F06 | resync 有界并显示用户可操作状态 | 连续 gap/重启故障矩阵 | 不无限循环；达到上限进入 action-required |

### M04 Item/Part 真实增量 View Patch

主要更新：`sessionViewStore.ts`、Desktop API 类型、`threadSnapshotPatch.ts`、Frame Batcher、Renderer Store。

| ID | 功能点与实现 | 自动测试 | 验收标准 |
| --- | --- | --- | --- |
| M04-F01 | 定义 `item.upsert/item.delta/item.remove/run.state/connection.state` 精确载荷 | schema + type contract | 普通 Patch 不携带整个 Run messages |
| M04-F02 | `item.delta` 按 itemId/partId 追加或修正文本 | delta golden/property test | 分片任意组合得到同一最终文本 |
| M04-F03 | 工具、文件、reasoning summary、最终回答均使用稳定 Item/Part key | 10 类 Item golden replay | Snapshot/Replay/Live 投影一致 |
| M04-F04 | Renderer 使用结构共享局部更新 | 引用相等与 render count test | 未受影响消息引用不变，不重复渲染 |
| M04-F05 | `run.replace` 只在 hydrate/resync/migration 使用 | 静态扫描 + runtime assertion | 正常 1,000 增量中 replace 次数为 0 |
| M04-F06 | 长 Run 性能与内存门禁 | 20MB 回答、1,000 工具事件、5,000 历史 Run | Patch 大小随本次 delta 增长；apply P95 <16ms；无 >200ms 长任务 |

### M05 模型、账户与发送前可执行性

主要更新：Model Catalog、Account Manager、Backend health/capabilities、Desktop Agent Catalog 和状态 UI。

| ID | 功能点与实现 | 自动测试 | 验收标准 |
| --- | --- | --- | --- |
| M05-F01 | 独立刷新模型目录，不依赖首个 Turn | cold-start capability test | 发送前可得到模型或明确失败原因 |
| M05-F02 | 模型目录记录 lastSuccessfulAt、generation、stale/error | 断线和重启矩阵 | 最近成功数据可显示但不可冒充当前可执行 |
| M05-F03 | 已绑定 Session 的模型不可静默变化 | 默认模型变化/模型移除测试 | 继续原模型或要求用户明确新建/迁移 |
| M05-F04 | 移除 model `raw`，仅保留审查字段 | object/serialization scan | 内存、诊断、IPC 均无原始响应 |
| M05-F05 | health 分离 installed、available、authenticated、contractCompatible、executable | capability contract | UI 不再把“已安装”误报成“可发送” |
| M05-F06 | 登录、网络、过期认证提供发送前动作 | fixture + live account test | 用户可登录、重试或查看脱敏诊断，不先创建失败 Run |

### M06 历史同步与 Runtime 身份

主要更新：`sessionHistorySync.ts`、Runtime Client registry、local/remote handshake。

| ID | 功能点与实现 | 自动测试 | 验收标准 |
| --- | --- | --- | --- |
| M06-F01 | invalidate/evict 会中止 in-flight 同步 | AbortController 并发测试 | 无幽灵写入和重复同步 |
| M06-F02 | 缓存区分 in-flight 与 recent success | 128+ 会话压力测试 | 不淘汰活跃同步；缓存有界 |
| M06-F03 | 历史进度由 Runtime 真正阶段驱动 | read/project/persist fault injection | UI 不显示未发生的阶段 |
| M06-F04 | Client 从 provisional 身份升级为 runtime/instance/generation | local restart/remote retunnel test | 旧 Client 被失效，新 Client 唯一 |
| M06-F05 | 远程 route identity 包含 host/tunnel generation | 端口复用与隧道重建测试 | 不复用其他主机或旧隧道 Client |
| M06-F06 | 取消、重启、迟到结果均不能覆盖新 waterline | 随机并发与 restart test | watermark 单调且最终内容一致 |

### M07 用户体验、安全与代码收敛

主要更新：四层输出 UI、连接状态、用户错误映射、日志脱敏、Adapter/Renderer 协调器拆分。

| ID | 功能点与实现 | 自动测试 | 验收标准 |
| --- | --- | --- | --- |
| M07-F01 | 运行状态保持单行，展开后显示处理说明、推理摘要、工具、文件、子任务 | visual/a11y matrix | 100%–200% 缩放不换成重复状态行 |
| M07-F02 | 最终回答独立于处理过程，流式完成不折叠或重排历史 | golden screenshot + live stream | 内容顺序与 Codex/OAEP 序列一致 |
| M07-F03 | connection state 只保留一个 UI 事实源且不持久化 | restart/export test | 正常状态安静；异常状态有原因、影响、动作 |
| M07-F04 | 删除 localStorage Snapshot 第二事实源 | migration/static test | 旧缓存可安全忽略；Main/Runtime 为权威来源 |
| M07-F05 | 所有日志、错误、诊断共用内容无关的脱敏策略 | token/path/command canary | 明文 secret 命中为 0，用户正文不进诊断 |
| M07-F06 | 拆分 Backend Client、Subscription 和 App Snapshot 协调职责 | architecture/type/unit test | 无私有成员跨层访问；核心协调器可独立测试 |

### M08 兼容、性能和最终验收

主要更新：Legacy telemetry、P9 release runner、Electron/live harness、功能台账。

| ID | 功能点与实现 | 自动测试 | 验收标准 |
| --- | --- | --- | --- |
| M08-F01 | Legacy 遥测持久化为无内容聚合数据 | restart/two-release fixture | 可证明连续发布环使用量，且不记录用户内容 |
| M08-F02 | 正常路径只走 OAEP，显式 rollback 仍可用 | dual-protocol matrix | 不静默回退；未知 Runtime 给出明确错误 |
| M08-F03 | 失败、取消、超时、审批拒绝均唯一终态 | 终态竞态 100 轮 | 每 Run 恰好一个终态，无残留 running |
| M08-F04 | 真实 Electron 贯通 Main→Preload→Renderer→Reducer→UI | production renderer E2E | 1,000 增量无丢失，侧栏/输入框交互无明显阻塞 |
| M08-F05 | 真实宿主机 Codex 多轮、工具、文件、重启验收 | 当前主机 live suite | 登录有效；同 Thread 多轮；处理过程和最终回答及时正确 |
| M08-F06 | 48 点 P9 ledger 与 release manifest fail-closed | fresh release verifier | 48/48 且所有 digest/环境/断言可重算后才完成 P9 |

## 6. 实施顺序

1. P9.1：M01、M02、M03——先恢复证据真实性和权威会话/游标边界。
2. P9.2：M04——完成真正 Item/Part 增量和长 Run 性能门禁。
3. P9.3：M05、M06——完成模型、账户、历史同步和 Runtime 身份。
4. P9.4：M07、M08——完成 UX、安全、兼容治理和正式验收。

任何阶段发现现有账本与真实结果不一致时，以真实结果为准，账本降级，不允许修改测试结果来迎合账本。

## 7. 统一验收规则

- UNIT 证明纯函数、状态机和边界条件；不能替代真实进程。
- CONTRACT 证明 API、IPC、OAEP 和 SQLite 迁移；不能替代 UI 行为。
- GOLDEN/PROPERTY 证明事件顺序、分片组合和投影确定性。
- PERFORMANCE 必须同时测历史规模和当前活跃 Run 规模。
- ELECTRON 必须运行 production renderer，并测 reducer/render，不只测 IPC。
- LIVE 必须使用当前宿主机真实 Codex App Server；Fixture 不能标记 live 功能 accepted。
- EVIDENCE 必须绑定 feature、assertions、source/dirty/build/Codex digest、host 和 observedAt。
- 未登录、外部网络不可用或缺少受支持 Codex 版本应标记 `blocked`，不得改为 accepted。

一票否决项：重复创建 Codex Thread、用户消息或最终回答丢失/乱序、终态重复、未授权副作用、明文 secret 泄漏、旧 generation 覆盖新内容、账本与实际结果不一致。

## 8. 交付物

1. 本方案文件。
2. `codex-adapter-p9-feature-ledger.json`，固定 48 个功能点。
3. P9 Snapshot Envelope、真实 View Patch 和 Runtime Binding API。
4. P9 Model/Account Capability 与 Runtime Identity 实现。
5. P9 单元、合同、属性、性能、Electron 和 Live 验收套件。
6. `.artifacts/codex-p9/manifest.json` 及逐功能结果。
7. 逐轮进度报告和最终逐项完成审计。

只有 M01-F01 至 M08-F06 全部具有当前状态的有效证据时，P9 才可标记完成。

## 9. 最终验收记录

- 功能账本：48 项全部为 `accepted`，无 `missing/failed/blocked`。
- Stable Contract：真实 Codex Desktop `0.146.0-alpha.9.2`，schema、二进制和通知/请求覆盖审查通过；`0.144.5` 保留为已审查兼容版本。
- 多轮连续性：真实 Codex Live 30 轮均复用同一 Thread，Turn ID 唯一且上下文保留。
- 增量链路：production Electron Main → Preload → Renderer → Reducer → UI 的 1,000 个增量无丢失，最终内容一致。
- 恢复与终态：Runtime 重启恢复、审批、取消、归档往返、文件操作和唯一终态验收通过。
- 发布证据：以 `.artifacts/codex-p9/manifest.json` 和 `codex-adapter-p9-feature-ledger.json` 为机器可复算的最终依据。
