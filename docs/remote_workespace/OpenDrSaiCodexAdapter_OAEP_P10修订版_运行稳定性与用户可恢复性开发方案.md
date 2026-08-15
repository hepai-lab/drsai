# OpenDrSai Codex Adapter OAEP P10 修订版：运行稳定性与用户可恢复性开发方案

状态：已完成并通过当前证据验收（48/48）  
制定日期：2026-08-14  
阶段：Codex Adapter P10 重新打开（P10-R）  
上游基线：`OpenDrSaiCodexAdapter_OAEP_P10语义完整性与用户可信交互收敛开发方案.md`  
适用范围：先完成 Windows 本地 OpenDrSai Desktop + 本地 Codex App Server；远程 Linux 复用同一状态、协议和验收模型，仅替换 Transport。

> 本文不是另起一套 Codex 架构，也不把 Codex App Server 直连到 Desktop。现有 P10 曾标记为 60/60 完成，但 2026-08-14 的真实开发版运行暴露出 Runtime 短暂探测超时后长期显示 `fault`、开发版实际 Codex 版本与发布证据版本不一致、重负载下 `/health` 被延迟、就绪状态被过度合并等问题。这些问题直接违反旧 P10 的 M04-F05、M05、M08、M10-F04～F06 退出条件，因此 P10 必须重新打开，不能以增加 P11 表层功能绕过。

## 1. 审计结论

### 1.1 总体判断

Codex Adapter 的主架构是合理的，应当保留：

```text
OpenDrSai Desktop
  → Runtime Client
  → OpenDrSai Gateway / Runtime Engine
  → Agent Backend SPI
  → Codex Adapter
      → Stable Contract / JSON-RPC Client
      → Native Decoder / OAEP Mapper
      → Session Binding / Turn Coordinator
      → Approval / History / Finalizer
      → Codex App Server Supervisor
  → Codex App Server（本地 stdio；未来可为远程 Host Transport）
```

合理之处包括：

1. Desktop 不直接连接 Codex App Server，Session、Run、Event 和 Workspace 仍由 OpenDrSai Runtime 统一管理。
2. Codex 原生 JSON-RPC、Thread、Turn、Item 只存在于 Adapter 边界，OAEP Runtime 与 UI 使用后端中立对象。
3. Stable Contract 由协议源生成，具备方法方向、参数白名单、通知分类和版本兼容策略。
4. `Session ↔ Codex Thread`、`Run ↔ Codex Turn` 的持久绑定方向正确，能够支撑历史导入、重启继续和多轮单线程。
5. Turn Coordinator、Approval Singleflight、Delta Coalescer、Run Finalizer 和历史 mappingVersion 都是应继续演进的正确组件。
6. 本地与远程只应改变 Supervisor/Transport，不应复制第二套 Adapter、OAEP 映射或 UI。

当前不合理之处不是“Adapter 是否存在”，而是运行就绪、负载隔离、版本身份、恢复状态和发布证据没有形成真正闭环。

### 1.2 现场证据与代码事实

| 发现 | 当前实现 | 影响 | 结论 |
| --- | --- | --- | --- |
| Runtime 假故障会持续 | `gatewayProbeCache` 被一次超时覆盖；常规 `getDesktopHealth()` 只读 Snapshot，不主动复测 | Runtime 已恢复，UI 仍长期显示 `fault` | 必须完善 |
| 健康探测过于脆弱 | 单次 `/health` 超过默认 2.5 秒即变为失败 | 会话/历史同步忙碌被误报为断线 | 必须完善 |
| `/health` 与重任务共用事件循环 | 会话发现、历史映射、SQLite、OAEP 投影与健康请求共进程执行 | 大工作区打开时健康请求饥饿、侧栏卡顿 | 必须完善 |
| Desktop 把 Runtime 与 Codex 合并 | `gatewayReady=false` 时直接构造 Codex `fault`，且动作固定为 `restart` | 无法区分 Runtime 忙、Adapter 不兼容、App Server 停止、账号异常 | 必须移除该直接映射 |
| Readiness DTO 未完成 | Adapter `health()` 中 account/executable 仍固定为 `unknown/not_probed` | “已安装、已连接、可发送”语义混乱 | 必须完善 |
| 开发版 Codex 选择不一致 | 开发 Gateway 静默优先项目 `node_modules/.bin/codex.cmd` | 当前实际使用 0.144.5，而证据声称 0.147.0-alpha.6.6 | 必须移除静默优先级 |
| Schema 身份证明不足 | 无 `schema_digest` 时 `compatibility_for_identity()` 退化为版本判断 | 同版本不同 Schema 仍可能进入执行路径 | 必须完善 |
| 会话发现过重 | 活跃、归档各自最多 100 页串行扫描，然后逐条导入、绑定和读取消息数量 | 首次打开大工作区延迟高，放大 Runtime 忙碌 | 必须完善 |
| JSON-RPC Reader 会被处理器拖慢 | 通知在 stdout reader 中逐个 `await handler` | 慢 Mapper/持久化可阻塞后续响应和终态 | 必须完善为有界有序分发 |
| App Server 自愈偏被动 | 连接失败后通常等待下一次业务操作触发 reconnect；UI 先进入 fault | 用户需要重试或重启才能恢复 | 必须完善 |
| Runtime 实例难识别 | 安装版 18642 与开发版 28642 可同时存在，UI 未显示 home/port/instance/binary | 用户和开发者容易检查错进程、错日志、错版本 | 必须完善 |
| HMR 可保留异常 Hook 状态 | Hook 依赖数组结构变化后热更新出现 React 警告 | 开发版状态链可能与完整重启不同 | 必须增加强制重载边界 |
| 旧 P10 证据闭包不完整 | release runner 的 source entries 未覆盖 `gateway.ts`、`status.ts`、`App.tsx` 等关键状态链路 | 关键缺陷存在时 ledger 仍能 60/60 passed | 必须移除旧通过结论的权威性 |
| 部分测试只检查源码文本 | Snapshot 验收包含注释/正则存在性断言 | 证明“写过代码”，不能证明故障后能自愈 | 必须降级为静态辅助测试 |

### 1.3 功能完整性判断

已经具备且应保留的能力：稳定 JSON-RPC 边界、OAEP 事件映射、Reasoning 可见性隔离、单 Session Turn 串行、审批、取消、历史导入与归档、模型目录、账户接口、进程监督、本地/远程 Supervisor 抽象。

尚未真正闭环的能力：

1. Runtime、Adapter、App Server、Account、Models 五层独立且可恢复的 Readiness。
2. 短暂超时不降级为持久故障，真实故障又能在有限时间内被确认。
3. 大工作区历史同步期间，健康探测、发送消息和 UI 交互仍然可用。
4. 实际运行 Codex 二进制、Stable Contract 和验收证据三者身份一致。
5. App Server 退出、stdio EOF、Runtime 重启、Desktop 重启后的自动收敛。
6. 旧 P10 每个“通过”结论能由当前源码、当前构建和当前实际进程重新证明。

### 1.4 用户易用性判断

用户不应看到一个含义模糊的 `fault`。用户真正需要知道的是：

- 当前是否还能继续查看历史；
- 当前是否可以发送；
- 如果暂时不能发送，是正在恢复、需要登录、版本不兼容、模型不可用，还是 Runtime 已停止；
- 是否会丢失当前输入、当前会话和已经接收的内容；
- 系统会不会自动恢复，若不能，唯一推荐动作是什么。

因此 UI 应遵循：保持内容、分层状态、延迟宣告故障、自动恢复优先、只给一个主动作、诊断细节按需展开。

## 2. 保留、移除与完善

### 2.1 明确保留

1. `Codex Adapter = Adapter 代码 + Codex App Server` 的 Backend 实现方式。
2. Gateway / Runtime Engine / Agent Backend SPI 的原有层次，不让 Desktop 直连 App Server。
3. OAEP 作为 Desktop 与所有 Agent Backend 的统一会话、运行、事件和渲染协议。
4. Stable Contract、Native Decoder、Normalized Event、Event Mapper 的单向边界。
5. Session/Thread、Run/Turn 的权威绑定和同 Session 单 Turn 串行规则。
6. 四层输出结构：单行运行状态、可折叠处理过程、最终回答、后续操作。
7. 本地 Process Transport 与未来 Remote Host Transport 共用同一 Adapter 语义。

### 2.2 明确移除

1. 移除“单次探测失败立即成为权威离线状态”的规则。
2. 移除 `gatewayReady=false → Codex fault + restart` 的直接 UI 映射。
3. 移除使用一个 `available` 布尔值同时表示安装、进程、协议、账户、模型和可执行性的做法。
4. 移除开发版静默优先项目旧版 `node_modules` Codex 的策略；任何 override 必须显式、可见、可验证。
5. 移除打开工作区时立即全量扫描活跃与归档全部分页并逐会话计算完整消息数量的路径。
6. 移除在 Gateway 主事件循环执行大批同步 SQLite、哈希、JSON 序列化和历史投影的路径。
7. 移除 JSON-RPC stdout reader 直接等待慢业务处理器完成的路径。
8. 移除只靠源码注释、字符串或正则存在性判定功能通过的发布验收。
9. 移除旧 P10 ledger 对当前版本的权威发布资格；保留为历史证据，不得继续显示“当前 60/60”。
10. 移除 `codex=null`、`fault`、`unknown` 之间无期限停留且没有刷新时间和恢复阶段的状态。

### 2.3 必须完善

1. 增加带迟滞、重试、最后成功值和明确终态的 Runtime Liveness State Machine。
2. 建立完整 Backend Readiness Aggregate，但保留每个层次的独立事实和错误码。
3. 历史同步改为最近优先、活动优先、按需归档、分页、可取消、限并发。
4. CPU/SQLite 密集工作移出事件循环，并为同步任务设置预算和背压。
5. App Server Supervisor 增加自动恢复、断路器状态、失败代际清理与用户可见恢复阶段。
6. 二进制身份增加 path/source/version/schema digest/release safety，并贯穿进程、能力、诊断和证据。
7. UI 增加 `正在连接/可用/忙碌恢复中/需要操作/故障`，保留历史和输入，不因控制面抖动清空数据。
8. 开发模式增加实例身份与完整重启提示，防止 HMR 和双 Runtime 造成误判。
9. 发布门禁覆盖真实重负载、故障注入、恢复时间、交互延迟和实际二进制，而非只验证 happy path。

## 3. P10-R 总体目标

P10-R 完成时必须同时满足：

1. 一次或两次 Runtime 探测超时不会让 Codex 显示持久 `fault`；Runtime 恢复后无需用户操作即可恢复可发送状态。
2. 真正的 Runtime 退出、认证错误、端口冲突、Contract 不兼容和 App Server 崩溃能够在有界时间内被准确区分。
3. 打开包含大量活动和归档 Codex 会话的工作区时，`/health` P99、首屏可用时间、侧栏交互和发送操作满足预算。
4. Desktop、Runtime、Adapter、App Server、Account、Models 六层状态均有独立事实、刷新时间、失败计数和恢复动作。
5. 当前实际执行的 Codex path、source、version、Schema digest 与 release evidence 完全一致。
6. App Server 意外退出或 stdio 断开后自动恢复；未确认 Turn 不重复，已绑定 Session 不产生新 Thread。
7. 历史同步、实时流和恢复流继续使用同一 OAEP Mapper，消息不丢失、不重复、不乱序、不显示原始字典。
8. UI 在控制面降级时继续显示已有历史、已接收内容和用户草稿；只禁用确实不能执行的动作。
9. 新 P10-R 48 个功能点都由当前源码和实际测试生成证据，任何缺失、阻塞或失败均不能标记完成。

## 4. 目标架构

```text
Desktop Renderer
  ├─ Conversation View（保留最后已知数据）
  └─ Layered Readiness View
       Runtime / Adapter / App Server / Contract / Account / Models
                    │ IPC
Desktop Main        ▼
  ├─ Runtime Liveness State Machine
  │    lastKnownGood + attempt + hysteresis + background reprobe
  ├─ Runtime Instance Registry
  └─ Backend Readiness Aggregator（不篡改单层事实）
                    │ loopback HTTP
OpenDrSai Runtime   ▼
  ├─ Lightweight Control Plane: health / identity / readiness
  ├─ Bounded Work Scheduler
  │    session discovery / history import / hashing / SQLite projection
  ├─ Agent Backend SPI
  └─ Codex Adapter
       ├─ Verified Binary Identity
       ├─ App Server Supervisor / Circuit Breaker
       ├─ JSON-RPC Reader + bounded ordered dispatch queues
       ├─ Stable Contract / Native Decoder / OAEP Mapper
       ├─ Session Binding / Turn Coordinator / Finalizer
       └─ Account / Models / History / Approval
                    │ local stdio（未来为受证明的远程 Transport）
Codex App Server    ▼
```

设计原则：

- Control Plane 与 Work Plane 分离；历史同步不能让健康探测失去调度机会。
- `lastKnownGood` 只用于保持界面和短暂降级，不可伪装成最新探测成功。
- 单层状态不覆盖其他层状态；聚合结果必须能追溯到具体 blocker。
- 自动恢复不允许重复创建 Thread、Turn、审批或副作用。
- 本地和远程的差异只放在 Transport Identity，不复制状态机和 UI。

## 5. 模块、功能点、测试与验收

P10-R 共 8 个模块、48 个功能点。

### M01 Runtime Liveness 与状态迟滞

主要更新：`apps/desktop/shared/main/gateway.ts`、`apps/desktop/windows/src/main/status.ts`、Runtime Client。

| ID | 功能点与实现 | 自动测试 | 验收标准 |
| --- | --- | --- | --- |
| M01-F01 | 定义 `RuntimeLivenessState`：`unknown/probing/ready/degraded/reconnecting/action_required/stopped`，记录 lastSuccessAt、lastAttemptAt、consecutiveFailures、generation | 状态转移表 property test，覆盖成功、超时、401、端口关闭、乱序结果 | 所有转移确定且终态可解释；旧探测结果不能覆盖新 generation |
| M01-F02 | 2 秒健康轮询执行真实、singleflight 的轻量探测，不再只读 Snapshot | fake Gateway 计数、并发 100 个读取、TTL 过期测试 | 每周期最多一个实际请求；健康恢复后下一周期自动转为 ready |
| M01-F03 | 增加迟滞：单次超时进入 degraded，连续 3 次或持续 10 秒才 action_required | 1/2/3 次超时、慢响应后恢复、持续失败虚拟时钟测试 | 一次和两次失败不显示 fault；持续失败在预算内准确确认 |
| M01-F04 | 确定性故障快速失败：unauthorized、错误实例 token、明确进程退出、非 OpenDrSai 端口占用不等待迟滞 | 401/403、进程退出、TCP occupant、错误 instance id | 2 秒内进入正确状态，且不会杀死非本实例进程 |
| M01-F05 | Snapshot 同时返回 `observed`、`lastKnownGood` 和 `effective`，调用方不得混用 | TypeScript contract、序列化、stale/last-good 测试 | UI 能保持历史但明确标注状态陈旧；发送前必须使用 observed/effective gate |
| M01-F06 | 进程重启、端口复用和 watcher 重启时递增 generation 并清除不适用失败 | watcher kill/restart、同端口新实例、迟到探测竞态 | 新实例首次成功后旧 fault 完全消失；迟到响应不污染当前状态 |

### M02 Runtime 工作负载隔离与历史同步治理

主要更新：Gateway、`runtime/agent.py`、Runtime State/SQLite、Session discovery/history sync。

| ID | 功能点与实现 | 自动测试 | 验收标准 |
| --- | --- | --- | --- |
| M02-F01 | 将历史哈希、JSON 序列化、批量投影和可安全迁移的 SQLite 工作放入有界 worker/to_thread | 事件循环延迟探针、CPU fixture、取消测试 | 10,000 Turn 投影期间 loop lag P99 <100ms，`/health` P99 <250ms |
| M02-F02 | Session discovery 改为活动优先；归档只在设置页或后台低优先级按需加载 | 活跃/归档混合 633、10,000 Thread fixture | 工作区首屏不等待归档；默认列表只出现活动会话 |
| M02-F03 | discovery/history 设置全局和每工作区并发上限、队列字节限制及优先级 | 多工作区并发、慢 App Server、突发打开 100 会话 | 无无限任务增长；当前会话和发送请求优先于后台归档同步 |
| M02-F04 | 移除逐 Session 全量 `oaep_snapshot()` 计算消息数，改用持久计数或分页元数据 | 1/100/10,000 Session 性能与一致性测试 | discovery 成本不随每个会话完整历史大小线性增长 |
| M02-F05 | 历史同步支持取消、切换会话中断、断点继续和幂等批次 | cancel/resume、重复 cursor、Runtime 重启、部分批次提交 | 无后台写入已关闭会话；继续后 digest 与一次性导入一致 |
| M02-F06 | 建立 control/work 预算指标：loop lag、队列深度、worker 时长、SQLite lock、首屏时间 | 指标 schema、脱敏、阈值失败测试 | 性能门禁可定位阻塞来源，指标不含用户文本和文件内容 |

### M03 Codex 二进制、Schema 与 Contract 身份闭环

主要更新：Gateway 开发环境选择、`binary_provider.py`、Stable Contract、Supervisor handshake。

| ID | 功能点与实现 | 自动测试 | 验收标准 |
| --- | --- | --- | --- |
| M03-F01 | 定义确定性选择顺序：显式受审 override → 受管 artifact → 可信 Codex Desktop；项目 node_modules 只允许显式测试模式 | 路径矩阵、签名、缺文件、多版本、WindowsApps alias | 不再静默选择旧 node_modules；最终选择来源可预测 |
| M03-F02 | 启动前输出 `BinaryIdentity{path,source,version,binaryDigest,schemaDigest,releaseSafe}` | Python/TS contract、路径脱敏、重启一致性 | Settings/诊断和证据看到的是当前实际进程身份 |
| M03-F03 | Schema digest 缺失不得以“版本相同”冒充 exact；开发模式也必须是 reviewed fixture 或显式 unsafe 状态 | 同版本不同 Schema、无 Schema、受审兼容版、未知新版 | 可执行状态只对已证明身份为 ready；unsafe 不能进入 release evidence |
| M03-F04 | Runtime capabilities、Adapter health 和 release evidence 使用同一个 BinaryIdentity 实例 | 启动中切换文件、旧缓存、进程重启代际 | 三处 version/schema/path digest 完全一致，不允许声明版本与进程版本不同 |
| M03-F05 | `codex_contract_incompatible` 返回实际版本、基线、Schema、支持动作，不泄露敏感路径 | exact/reviewed/blocked 错误契约和 UI action 测试 | 用户看到“更新 OpenDrSai/切换受支持 Codex/查看诊断”，不显示泛化 fault |
| M03-F06 | 增加启动时和运行时身份漂移检测；二进制被更新后只在无活动 Turn 时安全换代 | 原地升级、活动 Turn、空闲重连、回滚 | 活动 Turn 不被中断；下一安全点切换并重新验证 Contract |

### M04 App Server Supervisor 与 JSON-RPC 自愈

主要更新：`app_server_process.py`、`jsonrpc_client.py`、Backend client、Run recovery。

| ID | 功能点与实现 | 自动测试 | 验收标准 |
| --- | --- | --- | --- |
| M04-F01 | Supervisor 暴露 `stopped/starting/initializing/ready/restarting/circuit_open/closed` 和最近失败摘要 | 启动、早退、EOF、手动停止、连续崩溃虚拟时钟 | 状态与实际 PID/stdio 一致，用户可区分未启动和故障 |
| M04-F02 | App Server 意外退出后按有界退避自动重启，达到阈值才打开断路器 | 1～6 次崩溃、恢复窗口、手动重试 | 短暂崩溃自动恢复；无限崩溃不形成重启风暴 |
| M04-F03 | 清理 `_failed_generations/_controlled_generations/job_handles/temp files` 等代际状态 | 100,000 次受控/失败代际压力测试 | 内存与句柄有稳定上限，无陈旧 generation 影响新进程 |
| M04-F04 | stdout reader 只做 frame 校验和路由，将通知送入按 Thread/Turn 有序的有界 mailbox | 慢 handler、响应与通知交错、10,000 delta、队列满 | RPC 响应不被慢 Mapper 阻塞；同 Turn 顺序不变；超限明确失败 |
| M04-F05 | 连接失败自动协调 pending RPC、active Turn、Approval 和 Binding；未知结果进入 recovery 而非重发 | EOF 位于 turn/start 前后、terminal 前后、审批中 | 不重复 Thread/Turn/副作用；每个 Run 最终只有一个终态 |
| M04-F06 | 自动恢复成功后恢复已订阅活动 Session；失败进入带主动作的 action_required | 多 Session、重启、archive、取消、旧通知迟到 | 当前会话无需新建 Thread 即可继续；旧 generation 事件被拒绝 |

### M05 分层 Readiness 与 Backend 能力聚合

主要更新：Agent Backend SPI、Codex Adapter health/account/models、capabilities DTO。

| ID | 功能点与实现 | 自动测试 | 验收标准 |
| --- | --- | --- | --- |
| M05-F01 | 定义后端中立 Readiness：runtime、transport、installed、contract、process、account、models、executable | Python/TS Schema、Fake Backend、Codex、旧客户端兼容 | OpenDrSai Backend 和未来 Backend 可复用，Runtime Core 不认识 Codex 字段 |
| M05-F02 | 每层包含 state、reason、observedAt、lastSuccessAt、retryable、actions；禁止固定 unknown 占位伪装完成 | 冷启动、未探测、失败、stale、恢复矩阵 | `unknown` 只能短暂存在且有刷新动作；不无限“正在读取能力” |
| M05-F03 | 聚合 executable 由明确规则计算，并返回 blockers，不能反写单层事实 | 所有层笛卡尔组合 property test | 任意不可发送状态都能指出唯一或有序 blocker |
| M05-F04 | account/model 探测 singleflight、带 TTL、可强制刷新，并与 generation 绑定 | 100 个并发查询、重连、登出、模型更新 | 不产生请求风暴；旧 generation 账号/模型不覆盖新状态 |
| M05-F05 | Runtime 短暂 degraded 时保留最后已知 Codex 能力，但发送前做快速权威 gate | 负载超时、恢复、真实退出三类 E2E | 历史和设置不闪空；不可执行时不会误发请求 |
| M05-F06 | 区分“功能可浏览”和“可执行”：历史、归档、诊断可在部分降级时使用 | 各层故障下 action availability 测试 | 用户仍可查看已有内容和复制诊断，只有相关动作被禁用 |

### M06 Desktop 用户体验与恢复动作

主要更新：`App.tsx`、Chat Workspace、Settings/About、错误与状态组件。

| ID | 功能点与实现 | 自动测试 | 验收标准 |
| --- | --- | --- | --- |
| M06-F01 | 用 `正在连接/可用/忙碌恢复中/需要操作/已停止` 替代通用 fault；运行状态保持单行 | Renderer golden、窄窗口、缩放、a11y | 普通用户能判断是否等待或操作；不显示内部枚举 |
| M06-F02 | degraded/reconnecting 时保留会话历史、已接收流、滚动位置和输入草稿 | Electron 故障注入、切换侧栏、重连 | 内容不闪烁、不清空、不回到初始输入页 |
| M06-F03 | 每种 action_required 只显示一个推荐主动作，次要诊断折叠：重试、登录、更新、同步、新建任务 | 错误动作矩阵、按钮行为 E2E | 主动作确实改变对应阻塞层；不再所有问题都推荐重启 |
| M06-F04 | 标题栏/Settings 显示简洁实例信息，诊断展开显示 Runtime home/port/instance、Codex source/version/PID | 双 Runtime、开发/安装版、远程 fixture | 用户不会把 18642 与 28642、旧版与当前版混淆 |
| M06-F05 | 设置“上次刷新”和手动刷新；手动刷新执行真实探测而非重读缓存 | fake Gateway 请求计数、离线恢复 E2E | 点击刷新后状态基于新观测，不能原样返回锁住的 fault |
| M06-F06 | 长历史和流式输出期间维持侧栏、处理过程、输入框交互预算 | 10,000 Turn + 20MB stream Electron 性能测试 | 侧栏点击反馈 <100ms，主线程无 >200ms 长任务，输入不卡顿 |

### M07 实例治理、开发模式与可观测性

主要更新：dev bootstrap、Gateway watcher、diagnostics、About/Settings。

| ID | 功能点与实现 | 自动测试 | 验收标准 |
| --- | --- | --- | --- |
| M07-F01 | Runtime Instance Registry 记录 mode/home/port/pid/instanceId/owner/startTime | 安装版+开发版并存、端口复用、陈旧 PID | 每次请求和日志都能关联唯一实例 |
| M07-F02 | 开发版检测同仓库重复 Desktop/Watcher 和错误 Runtime home，给出非破坏性提示 | 两次启动、残留 watcher、安装版并存 | 不误杀其他实例；用户知道当前连接哪一个 Runtime |
| M07-F03 | Hook 结构变化或 Main/Preload 协议变化时触发完整 Renderer/Electron reload，不依赖 HMR 保留旧状态 | 修改 effect 依赖和 IPC schema 的开发测试 | 不再出现依赖数组长度变化警告；重载后状态一致 |
| M07-F04 | 诊断事件记录分层状态转移、探测耗时、失败次数、recovery duration、binary identity | 脱敏 canary、事件关联、容量测试 | 可从一个 diagnostic id 还原状态变化，不含 prompt/secret/文件正文 |
| M07-F05 | 健康面板区分当前观测与历史错误，恢复后旧错误归档而非继续显示当前 fault | timeout→ready、crash→ready、contract blocked | 当前状态永远反映最新 generation，历史可追溯但不误导 |
| M07-F06 | 为本地与未来远程使用统一 TransportIdentity；远程只增加 host/tunnel generation | local、loopback bridge、SSH fixture contract | 上层 Readiness/UI 不因 Transport 类型分叉，旧隧道事件不串入当前实例 |

### M08 测试证据、发布门禁与回归治理

主要更新：P10 runner、ledger、source closure、Live/Stress/Electron suites。

| ID | 功能点与实现 | 自动测试 | 验收标准 |
| --- | --- | --- | --- |
| M08-F01 | 新建 P10-R 48 点 ledger；旧 P10 ledger 标记 historical/superseded，不自动继承 passed | ledger schema、状态迁移、篡改测试 | 初始 0/48；只有当前证据可使功能变 passed |
| M08-F02 | 源码闭包纳入 gateway/status/App/dev scripts/package lock/Runtime sync/Adapter 全路径 | 修改每个关键文件的 mutation test | 任一相关字节变化都会使证据 digest 失效 |
| M08-F03 | 静态文本检查只作为 L0，不得单独证明用户功能；每项至少有行为断言 | 删除实现保留注释、伪造字符串、测试自检 | 仅源码文本匹配不能产生 passed |
| M08-F04 | 建立真实故障矩阵：慢 Runtime、event-loop starvation、App Server crash、EOF、401、Contract mismatch、双实例 | Component + Electron + 本地真实进程故障注入 | 状态准确、自动恢复有界、无数据丢失和重复执行 |
| M08-F05 | 真实 Codex 验收必须记录实际 PID/path/source/version/schema，使用隔离目录合成提示与文件 | 本地 Live 多轮、工具、历史、重启、身份校验 | 证据身份与 Settings/Runtime 完全一致；30 轮仍为一个 Thread |
| M08-F06 | 发布总门禁覆盖 Unit/Property/Contract/Electron/Live/Stress/Upgrade，并输出恢复与性能预算 | 一键 runner，模拟缺网络/缺登录/缺环境 | 任一 required suite missing/blocked/failed 均不得发布；报告可机器重算 |

## 6. 实施顺序与轮次

### P10-R.1：状态真实性（M01、M03、M05）

- 先修 Runtime liveness 和二进制身份，再定义完整 Readiness。
- 门禁：一次超时不 fault；恢复无需用户操作；实际 Codex 身份与能力一致。
- 进度目标：18/48。

### P10-R.2：运行自愈与负载隔离（M02、M04）

- 将重历史工作移出控制面，完成 App Server/JSON-RPC 自动恢复。
- 门禁：重负载 `/health` P99 达标；崩溃/EOF 不重复 Turn。
- 进度目标：30/48。

### P10-R.3：用户恢复与实例治理（M06、M07）

- 更新 UI 状态、保留内容、恢复动作和开发实例诊断。
- 门禁：用户能区分等待与操作；双 Runtime 和版本来源可见；长会话交互达标。
- 进度目标：42/48。

### P10-R.4：证据闭环（M08）

- 重建 source closure、ledger、真实故障和 Live/Stress 证据。
- 门禁：48/48 当前证据通过；旧 P10 不再作为当前发布证明。
- 进度目标：48/48。

## 7. 测试层级

| 层级 | 证明内容 | 不能被什么替代 |
| --- | --- | --- |
| L0 Static/Architecture | 依赖边界、源码闭包、危险旧路径已移除 | 不能证明运行恢复 |
| L1 Unit/Property | 状态机、迟滞、代际、队列、竞态 | 不能证明 Electron 用户体验 |
| L2 Contract/Component | Python/TS/IPC/HTTP/OAEP/Readiness 字段和错误码 | 不能证明真实 Codex 身份 |
| L3 Fault Injection | 慢响应、饥饿、崩溃、EOF、401、端口冲突 | happy path 不能替代 |
| L4 Electron | 状态显示、内容保留、按钮恢复、交互延迟 | 源码正则和 mock DOM 不能替代 |
| L5 Live Codex | 实际 path/version/schema、单 Thread 多轮、重启恢复 | fake App Server 不能替代 |
| L6 Stress/Upgrade | 大历史、长流、反复重启、版本切换和资源上限 | 单次小样本不能替代 |

统一验收规则：

1. 每个功能点至少一条正向、一条边界/负向和一条恢复断言。
2. 所有异步状态测试使用虚拟时钟或事件条件，不用不稳定的固定长 sleep。
3. Live Codex 只允许在隔离临时目录中发送合成提示和合成文件，不访问用户真实项目内容。
4. 测试环境不可用必须标记 `blocked`，不能用 fixture 伪装成 Live passed。
5. 性能阈值固定硬件、fixture 和采样方式，报告 P50/P95/P99 及长任务。
6. 验收期间源码、构建、Codex 进程或 Schema 身份变化，整轮证据作废。

## 8. 用户验收旅程

1. 启动开发版，状态从“正在连接”稳定进入“可用”，不会在“可用/fault”之间闪烁。
2. 打开含大量 Codex 历史的工作区，最近活动会话先出现；归档会话按需加载，侧栏仍可立即操作。
3. 历史同步期间发送消息，消息进入当前 Thread，不创建新 Thread，不被后台同步长期阻塞。
4. 人为让 Runtime 健康响应延迟一次，界面显示“忙碌恢复中”，历史和草稿保留，随后自动恢复。
5. 结束 Codex app-server 进程，界面显示“正在重新连接”；自动恢复后在同一 Session 继续。
6. 使用不兼容 Codex 版本，界面明确显示版本问题和推荐动作，不误报 Runtime 未连接或 Codex 未安装。
7. 登出 Codex，只显示登录动作；网络或 Runtime 故障不会误显示“请登录”。
8. 安装版与开发版 Runtime 同时存在时，能够看清当前实例、端口和 Codex 来源。
9. 长输出期间展开右侧栏和处理过程、输入文字，交互无明显卡顿。
10. 完整重启 Desktop 和 Runtime 后，工作区、历史、Thread 绑定和模型保持一致。

## 9. 交付物

1. 本 P10-R 开发方案。
2. `codex-adapter-p10r-feature-ledger.json`，8 个模块、48 个功能点。
3. Runtime Liveness State Machine 与分层 Readiness Schema。
4. Bounded Work Scheduler、渐进 Session discovery/history sync。
5. Verified Binary Identity 与开发版确定性 Codex 选择策略。
6. App Server Supervisor/JSON-RPC ordered mailbox 自动恢复实现。
7. Desktop 分层状态、内容保持、恢复动作和实例诊断 UI。
8. Unit、Property、Contract、Fault Injection、Electron、Live、Stress、Upgrade 验收入口。
9. `.artifacts/codex-p10r/manifest.json`、性能报告、恢复报告和用户旅程证据。

## 10. 进度与完成定义

| 阶段 | 模块 | 功能点 | 当前进度 |
| --- | --- | ---: | ---: |
| P10-R.1 | M01、M03、M05 | 18 | 18/18 |
| P10-R.2 | M02、M04 | 12 | 12/12 |
| P10-R.3 | M06、M07 | 12 | 12/12 |
| P10-R.4 | M08 | 6 | 6/6 |
| 总计 | 8 个模块 | 48 | 48/48（100%） |

P10-R 只有在以下条件同时满足时才可关闭：

- 48/48 具有当前源码、当前构建和当前实际运行身份的有效证据；
- Runtime 短暂超时自动恢复，真实故障准确分层；
- 大历史与长流性能预算通过；
- 本地真实 Codex 多轮、崩溃恢复和版本不兼容旅程通过；
- 没有重复 Thread/Turn、消息丢失/乱序、隐藏推理泄漏、未授权副作用或错误实例串写；
- 旧 P10 ledger 已被标记为历史证据，不再代表当前版本发布状态。

## 11. 实施与验收结果

完成日期：2026-08-14。

- 当前功能账本：`docs/remote_workespace/codex-adapter-p10r-feature-ledger.json`，48/48 passed。
- 当前证据清单：`.artifacts/codex-p10r/manifest.json`；行为测试证据：`.artifacts/codex-p10r/acceptance.json`。
- 旧 `codex-adapter-p10-feature-ledger.json` 已标记为 `historical_superseded`，不能再作为当前版本的通过证明。
- Python 定向回归：113 passed，另有 7 个 subtests passed。
- Desktop 行为验收：Gateway 瞬时故障恢复、Runtime 健壮性、Codex 产品集成全部通过。
- TypeScript：Main/Node 与 Renderer/Web 两套类型检查通过。
- 真实 Codex：Windows Codex Desktop `0.147.0-alpha.6.6`，30 轮保持同一 Thread、Turn 唯一；流式 OAEP、审批、取消、归档、重启恢复通过。
- 实际身份：`codex-desktop` source、binary digest 与 schema digest 已写入 Live evidence；Stable Contract compatibility 为 `exact`。
