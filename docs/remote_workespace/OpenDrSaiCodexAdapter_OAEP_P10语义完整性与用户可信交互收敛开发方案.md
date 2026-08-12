# OpenDrSai Codex Adapter OAEP P10：语义完整性与用户可信交互收敛开发方案

状态：重新验收中（实现已完成；当前源码快照尚未形成新的 60/60 发布证据）  
制定日期：2026-08-05  
阶段：Codex Adapter 第 10 阶段（P10）  
上游基线：`OpenDrSaiCodexAdapter_OAEP_P9真实增量与恢复闭环开发方案.md`（48/48 已完成）

> 2026-08-12 复核说明：Codex App Server 已升级到 `0.147.0-alpha.6.6`，Stable Contract
> 已在规范化 Schema 差异审计后升级为 v5；新版本仅新增 4 个当前未调用的 Section 管理方法，
> 已审核的 15 个 Client 方法、70 个通知、10 个 Server Request 及其 OAEP 语义未发生破坏性变化。P10
> 源码闭包发生变化。2026-08-05 生成的 60/60 结果及源码摘要仅作为历史证据，不能证明
> 当前工作区可发布。必须在源码停止变化后重新完整执行
> `npm run verify:codex-adapter:release`，由生成器更新台账后才能恢复“已完成”状态。

当前重新验收进展（2026-08-12）：Contract v5 的 47 项协议测试和真实 Codex 30 轮连续
会话验收已通过；Contract、输入/Session、错误、Snapshot、审批、历史、资源压力、Bridge
单元测试、架构边界及 Electron 套件已生成当前源码证据。最终 SSH→Linux loopback Bridge
等价验收因本机 Docker Desktop Linux Engine 未启动而失败关闭；在 Engine 启动并完成整套
release runner 前，历史 60/60 台账不得作为当前发布结论。

## 1. 阶段结论

P8 建立了 Codex 原生协议到 OAEP 的可靠映射和证据闭环，P9 完成了真实增量、权威 Session Binding、Snapshot/Patch 恢复以及 Electron 实际链路。当前主架构是合理的，不需要重写。

P10 解决的是上一轮代码审计暴露出的深层问题：Stable Contract 中仍有原生语义未形成闭环；部分输入资源会被静默忽略；同一 Session 的并发 Turn、重复审批、过期 Snapshot 等边界仍可能破坏用户预期；错误、模型、账户和后端就绪状态还没有形成统一的用户可操作契约；历史加载、缓存和内部状态的资源占用缺少明确上限；部分 Codex 专用逻辑仍侵入 Runtime Core；本地与远程 Host Bridge 的身份和安全约束尚未完全一致。

因此，P10 的定位是“语义完整性与用户可信交互收敛”，不是继续增加表层入口。完成 P10 后，用户在 OpenDrSai 中使用 Codex 时，看到的输入、处理中间态、审批、文件与工具活动、最终回答、错误和恢复动作，都必须与真实后端状态一致；任何无法适配的语义必须显式拒绝或诊断，不能静默丢失、猜测或伪造。

## 2. 总体目标

P10 完成时必须同时满足：

1. Stable Contract 中的全部 23 个语义通知均被明确分类为“映射到 OAEP”“经审查忽略”或“阻断发布”，覆盖率可由机器重算。
2. 文件、文件夹、选区、终端和浏览器上下文均通过统一 OAEP Input Resource 进入 Adapter，不再依靠后端专用字符串拼接，也不允许静默忽略。
3. 一个 OpenDrSai Session 仍只绑定一个 Codex Thread；同一 Session 任意时刻最多运行一个 Codex Turn，其余请求按明确队列策略处理。
4. 已绑定 Session 的模型从 Runtime 权威绑定恢复，用户不能因默认模型变化而无感切换后端模型。
5. 错误、账户、连接、协议兼容和可执行性均使用结构化契约；UI 不再从英文错误文本或正则表达式猜测原因。
6. Snapshot 补水必须跨过请求 waterline；过期缓存不得冒充新快照，连续失败必须进入明确的可操作终态。
7. 重复审批请求只产生一个 OAEP 审批项、一个用户决定和一条审计结果，同时能正确回复所有原生等待方。
8. 历史会话按最近内容优先、可继续加载、可取消的方式展示；超大历史不再阻塞首次可用界面。
9. Main、Renderer 和 Backend 内部缓存、锁、队列及终态集合均有容量、生命周期和可观测指标。
10. Reasoning 只传递允许公开的摘要或处理说明；隐藏推理不得进入 UI、导出、日志或诊断。
11. Runtime Core 只依赖通用 Backend 接口，不直接导入 `codex_adapter` 实现。
12. 本地进程和远程 SSH Tunnel 复用同一 Adapter/Runtime 语义；Host Bridge 具备版本、Schema、主机和进程身份校验。
13. 60 个功能点均由当前源码、当前构建和实际测试证据计算状态，不能人工填写为通过。

## 3. 范围与边界

### 3.1 保留的架构

- `Codex App Server → JSON-RPC Client → Native Decoder → Codex Event Mapper → OAEP Runtime` 的单向适配边界。
- OpenDrSai Session/Run 与 Codex Thread/Turn 的持久化绑定关系。
- OAEP Journal 作为 Session、Run、Item、Event 的权威事实源。
- P9 的 `generation + sessionSequence` Snapshot/Patch 水位模型和真实 Electron 增量链路。
- Delta Coalescer、Run Finalizer、Stable Contract、兼容版本白名单和未知事件诊断。
- Desktop、Runtime Client、SSH Manager 和 Host Bridge 的现有职责划分。
- 四层输出结构：单行运行状态、可折叠处理过程、最终回答、后续操作。
- 显式 Legacy rollback 能力，直到满足正式退场门槛。

### 3.2 本阶段更新

- Stable Contract 从“方法白名单”升级为“方法、参数、方向、映射处置和测试证据”的生成式语义注册表。
- Adapter 增加统一 Input Resource Encoder、Reasoning 可见性映射、单 Session Turn Coordinator 和审批 Singleflight。
- Runtime 增加通用 Backend History Capability、权威 Model Binding View 和结构化 Error/Readiness Envelope。
- Snapshot resync 增加 `forceFresh`、`minimumSequence`、`expectedGeneration` 约束。
- 历史同步升级为最近优先、分页/窗口化、可取消、可恢复的加载协议。
- Main、Renderer 和 Backend 的长期状态更新为有界缓存及显式清理。
- Host Bridge 增加远端证明、短期凭证、重放保护和 loopback/SSH Tunnel 安全约束。
- P10 ledger 和 release runner 增加协议覆盖、资源上限、用户动作以及真实 Codex/Bridge 证据。

### 3.3 需要迁移或移除

1. 将 `_legacy_message_parts` 从实时 Native Decoder 主路径移除，仅保留在明确版本化的历史迁移器中。
2. 移除 UI 对错误消息文本和正则表达式的业务判断，统一按结构化 `code` 与 `recoveryActions` 渲染。
3. 移除“非文件附件返回空 promptSuffix”的静默降级路径。
4. 移除 Main/Renderer 无上限 Snapshot 缓存，以及 Backend 无上限 entity lock、resumed generation、cancelled run 集合。
5. 移除 Runtime Core 对 `codex_adapter` 常量和历史迁移函数的直接导入。
6. 移除虚假的 `authenticated=null`、`executable=false` 健康占位，改为可区分未知、失败和不可执行的统一 Readiness DTO。
7. 移除 Host Bridge 默认监听 `0.0.0.0` 的生产配置；非 loopback 明文桥接默认拒绝。
8. 合并散落的 P3—P9 活跃发布脚本为稳定验证入口；历史文档和证据只读保留。

### 3.4 暂不移除

- Legacy Conversation Adapter：只有连续两个正式发布周期遥测为零、受支持 Runtime 不再依赖、升级/降级/回滚矩阵全部通过后，才能在后续版本删除。
- 最终回答 Terminal fallback：P10 修正其判定粒度，但在原生终态偶发缺少 final item 时仍作为受控恢复能力保留。
- 已审核兼容 Codex 版本白名单和 Host Bridge 抽象。
- Linux 主机发现、安装、升级和回滚仍属于远程工作区方案；P10 只完成 Bridge 运行契约、安全和可执行验收，不重做 SSH Manager。

## 4. 整体解决方案与架构

```text
Local Windows Codex App Server       Remote Linux Codex App Server
             │                                  │
      Local Process Transport             SSH Local Port Forward
             └──────────────┬───────────────────┘
                            ▼
                 Transport Identity / Attestation
                            ▼
                  Stable JSON-RPC Boundary
              ├─ Generated Method/Param Guard
              ├─ Frame Limit / Direction Guard
              └─ Compatibility & Schema Digest
                            ▼
                       Codex Adapter
              ├─ Native Decoder + Semantic Registry
              ├─ Input Resource Encoder
              ├─ Event / Reasoning OAEP Mapper
              ├─ Session Turn Coordinator
              ├─ Approval Singleflight Coordinator
              ├─ History Provider
              ├─ Delta Coalescer / Run Finalizer
              └─ Diagnostics / Redaction
                            ▼
             Backend-neutral Normalized Event / Resource
                            ▼
                   OAEP Runtime + Journal
              ├─ Session / Run / Item / Event
              ├─ Backend Binding / Model Binding
              ├─ Error / Readiness Envelope
              └─ Snapshot / Patch / History Window
                            ▼
                 Desktop Runtime Client / UI
              1. 单行运行状态
              2. 可折叠处理过程
              3. 最终回答
              4. 后续操作与恢复动作
```

核心设计规则：

- Codex 原生对象只能存在于 Adapter 边界内，OAEP Runtime 和 UI 不认识 Codex 方法名或原始响应。
- 每个原生语义必须有显式处置；未知语义只能诊断并按兼容策略阻断或隔离，不能无声吞掉。
- 输入资源、事件、错误、就绪状态和历史页均使用后端中立契约，使 OpenDrSai Backend 和未来 Backend 可复用。
- Session 是多轮上下文边界，Run 是一次用户提交边界；同一 Session 的 Run 严格串行，不同 Session 可并行。
- UI 只显示 `visibility=user` 的 reasoning；`diagnostic` 仅进入脱敏诊断，`hidden` 不出 Adapter 内存边界。
- resync 的新 Snapshot 必须满足请求 generation 和最低序列；否则返回结构化失败，不能回退到过期缓存。
- 所有缓存均由容量、字节数、活跃固定、TTL 和显式失效共同管理。
- 本地和远程只改变 Transport，不改变 Session、事件、审批、历史和 OAEP 映射语义。

## 5. 模块、功能点、测试与验收

### M01 Stable Contract 与原生语义全覆盖

主要更新：`codex-app-server-stable-contract.json`、JSON-RPC Client、Native Decoder、Event Mapper、契约生成器与兼容门禁。

| ID | 功能点与实现 | 自动测试 | 验收标准 |
| --- | --- | --- | --- |
| M01-F01 | 建立 23 个语义通知的机器可读处置矩阵，记录方向、参数 Schema、handler、OAEP 类型、可见性和处置原因 | 从 Stable Contract 生成矩阵并与 Decoder/Mapper 反射结果比对 | 23/23 均为 `mapped`、`reviewed_ignored` 或 `release_blocked`，不存在空白和隐式 fallback |
| M01-F02 | 补齐至少 8 个当前明确未映射语义：Hook start/complete、终端交互、FileChange delta/patch、MCP progress、Thread closed、Turn diff updated | 每个方法独立 golden fixture，覆盖 started/delta/completed/failed 顺序 | 所有可见语义形成稳定 OAEP Item/Part；不适合展示者有审查记录和诊断计数 |
| M01-F03 | Stable Contract 生成 Client method allowlist、Server request allowlist 和参数校验器，删除人工重复列表 | 生成物一致性测试；篡改任一手写列表或参数形状 | 生成检查失败即阻断构建；本地与 Bridge 使用完全相同的 Contract digest |
| M01-F04 | JSON-RPC 边界校验请求方向、参数、响应 id、通知方法和最大 frame，未知方法按版本策略隔离 | property/fuzz：未知方法、错参、重复 id、畸形 frame、超限 frame | 进程不崩溃、不越界调用；错误可诊断；不支持的必需语义阻断执行而非静默继续 |
| M01-F05 | 兼容策略区分 `exact`、`reviewed-compatible`、`blocked`，并绑定 Codex 版本、Schema digest 和 Adapter mapping version | 当前版本、已审核旧版、未知新版、同版本不同 Schema 四类 fixture | 只有 exact/已审核版本可执行；未知变化在发送前给出明确升级或降级动作 |
| M01-F06 | 输出协议覆盖报告和未知语义遥测，不记录用户正文、命令正文或 secret | canary 数据、路径、token、命令和用户文本脱敏测试 | 报告可定位方法、版本和次数；敏感正文命中为 0；覆盖变化会使 release gate 失败 |

### M02 OAEP 输入资源与 Reasoning 语义

主要更新：OAEP Input Envelope、Desktop attachment staging、Adapter Input Encoder、Reasoning Segment、结构化渲染器。

| ID | 功能点与实现 | 自动测试 | 验收标准 |
| --- | --- | --- | --- |
| M02-F01 | 定义后端中立 `InputResource`：`file/folder/selection/terminal/browser`，包含 id、mime、引用、范围、权限、大小和脱敏元数据 | Schema、序列化、版本兼容和 round-trip 测试 | 五类资源均可从 Desktop 进入 Runtime，再由 Adapter 编码；OAEP 中不出现 Codex 专用字段 |
| M02-F02 | 替换 promptSuffix 拼接和非文件空返回；每类资源必须 `encoded/rejected/unsupported` 三选一 | 五类附件矩阵，注入不支持类型、空引用和丢失文件 | 不存在静默丢失；发送前可见失败资源及删除、重选或新建任务动作 |
| M02-F03 | 文件和文件夹资源实施路径规范化、工作区边界、符号链接、大小、数量、二进制和敏感文件策略 | traversal、junction/symlink、超限、二进制、取消和 TOCTOU 测试 | 不能读取工作区外未授权内容；超限在发送前阻断；错误不泄露真实敏感路径 |
| M02-F04 | Selection、Terminal、Browser 使用显式来源与生命周期，不把陈旧上下文冒充当前状态 | 来源失效、窗口关闭、终端滚动、选择变化和重发 fixture | 用户能看见将发送的上下文摘要；失效资源必须确认或移除，不能后台换成新内容 |
| M02-F05 | 扩展 Reasoning Segment：`kind=summary/commentary/analysis`、`visibility=user/diagnostic/hidden`、`source=backend/adapter/runtime` | Codex、OpenDrSai Backend 和未来 Backend golden fixture；旧 OAEP 默认值迁移 | UI 只渲染 user；diagnostic 仅脱敏诊断；hidden 不进入 UI、持久化导出或日志 |
| M02-F06 | 真实 Codex 隔离目录端到端验证五类输入及 Reasoning 流式顺序 | 允许联网的合成提示、合成文件和受控工具调用 live suite | Codex 能识别已支持资源标记；处理说明先于最终回答增量出现；无重复、无字典字符串泄漏 |

### M03 Session、模型绑定与 Turn 串行协调

主要更新：Agent Binding、Backend Binding View、Turn Coordinator、发送路由和会话标题栏状态。

| ID | 功能点与实现 | 自动测试 | 验收标准 |
| --- | --- | --- | --- |
| M03-F01 | Runtime 提供权威 `BackendBindingView`，包含 backend、thread、model、workspace fingerprint、状态和可用动作 | API/IPC contract、SQLite migration、重启恢复 | 打开已有任务后 UI 显示真实绑定模型和线程状态，不再重置为 Agent 默认值 |
| M03-F02 | 已绑定 Session 的模型不可静默改变；选择其他模型必须明确新建任务或执行受支持迁移 | 默认模型变化、模型下线、用户切换和取消确认矩阵 | 继续消息始终使用绑定模型；没有确认不会创建新 Thread 或修改绑定 |
| M03-F03 | 增加按 backend session id 的 Turn Coordinator，同一 Session 只允许一个 active Turn | 100 个并发发送、随机调度和重复 run id property test | 同一 Session `activeTurn≤1`、FIFO 稳定、每个请求恰好一个 Run；不同 Session 保持并行 |
| M03-F04 | 定义排队、取消、替换策略：默认排队；用户可取消排队项；替换运行中任务需显式操作 | queued/running/completing 三阶段取消与替换竞态 1,000 轮 | 无幽灵 Turn、无双终态；UI 明确显示“排队中/正在取消/已取消”及队列位置 |
| M03-F05 | Turn start 具备 run id 幂等性；断线重试不能重复创建 Codex Turn | 超时后重试、响应丢失、重复 IPC、Runtime 重启恢复 | 同一 run id 最多一个 Codex Turn；恢复后队列与 Journal 收敛，无重复用户消息 |
| M03-F06 | Terminal final fallback 按 item id、phase、final visibility 跟踪，替代 `_message_seen_runs` 粗粒度布尔值 | commentary 后缺 final、已有 final、取消、失败和 terminal 内嵌回答矩阵 | 缺失 final 时可恢复；已有 final 不重复；取消/失败不伪造最终回答 |

### M04 结构化错误、就绪状态与用户恢复动作

主要更新：Error Envelope、Backend Readiness DTO、ChatEvent/IPC、UI error boundary 和操作按钮。

| ID | 功能点与实现 | 自动测试 | 验收标准 |
| --- | --- | --- | --- |
| M04-F01 | 定义 `ErrorEnvelope{code,category,retryable,userMessageKey,recoveryActions,diagnosticReference,redactedDetails}` | Python/TypeScript Schema、IPC round-trip、未知字段前后兼容 | Backend code 从产生点到 UI 保持不变；消息文本不再承担控制逻辑 |
| M04-F02 | 建立稳定错误分类：binding、auth、transport、contract、model、approval、resource、history、runtime、backend | 每类至少成功/失败/重试 fixture，校验动作白名单 | 每个公开错误码都有用户文案、影响和至少一个适用动作；未知错误安全降级为诊断动作 |
| M04-F03 | 移除 UI 的错误字符串/正则判断，按 code 与 recoveryActions 渲染重试、同步、新建、登录、选择模型等 | 静态扫描与 Renderer action matrix | 业务判断中无错误英文片段；修改后端 message 不影响按钮和恢复流程 |
| M04-F04 | 账户状态采用 `signed_in/signed_out/unavailable/unknown`，把查询失败与登出分离 | 网络断开、App Server 未启动、真正登出、超时矩阵 | 连接错误不会误报“请登录”；只有 confirmed signed_out 才展示登录主动作 |
| M04-F05 | Readiness DTO 分离 transport、installed、contract、account、models、executable，并提供原因和刷新时间 | 冷启动、缓存过期、部分失败、进程重启和恢复测试 | “已安装”不等于“可发送”；发送按钮状态能指向唯一阻塞层和下一步 |
| M04-F06 | 所有诊断引用和错误详情统一脱敏；用户可复制诊断 id 而非原始堆栈与 secret | token、路径、环境变量、命令、prompt canary | UI 默认不暴露内部堆栈；日志和导出无明文 secret；诊断 id 可关联证据事件 |

### M05 Snapshot 恢复、缓存一致性与增量 UI

主要更新：Main Snapshot service、Renderer Coordinator、Session View Store、resync API 和性能指标。

| ID | 功能点与实现 | 自动测试 | 验收标准 |
| --- | --- | --- | --- |
| M05-F01 | resync API 增加 `forceFresh/minimumSequence/expectedGeneration`，返回来源和实际 waterline | API/IPC contract，旧客户端兼容测试 | forceFresh 不返回未经验证的旧缓存；响应 sequence 必须达到 minimumSequence，否则结构化失败 |
| M05-F02 | Main 缓存接收 Patch 时同步推进 Snapshot，或明确标记 stale 并绕过缓存 | snapshot→patch→resync、交错多 Session property test | 任意时刻缓存声明的 sequence 与内容一致；不存在“新水位+旧正文”或反向组合 |
| M05-F03 | gap、重复、乱序和 generation 变化统一由原子 reducer 处理 | 丢失/重复/乱序/延迟全排列以及 Runtime restart fixture | 最终 digest 与权威 Snapshot 一致；旧 generation 永不覆盖新内容 |
| M05-F04 | resync 最多自动尝试三次，退避且可取消，之后进入 action-required | 连续 stale、超时、断线、切换会话和恢复矩阵 | 不无限循环、不持续占用 UI；失败后提供重试连接或重新加载动作 |
| M05-F05 | Patch 合并保持稳定 item/part key 和结构共享，侧栏、输入框和历史列表不因正文流式更新整树重渲染 | 1,000 delta production Renderer 性能与 render-count 测试 | Patch apply P95 <16ms、无 >200ms 长任务；侧栏开合在长会话流式期间仍可交互 |
| M05-F06 | 暴露 transport/apply/render/resync 分段指标并脱敏采样 | 指标 Schema、采样率、禁用遥测和 canary 测试 | 可区分卡顿发生在 IPC、reducer 或 render；指标不含用户正文和资源内容 |

### M06 审批、工具与副作用安全

主要更新：Approval Bridge、OAEP Approval Item、工具/文件操作详情、超时和审计。

| ID | 功能点与实现 | 自动测试 | 验收标准 |
| --- | --- | --- | --- |
| M06-F01 | 审批按 backend request key 做 singleflight，重复原生请求共享一个决策 Future | 100 个重复请求并发、重复 id 和不同 waiter 测试 | UI 只出现一个审批项、用户只决定一次、所有合法 waiter 获得同一结果 |
| M06-F02 | 审批状态机覆盖 pending/approved/denied/cancelled/expired/disconnected，终态唯一 | approve/cancel/timeout/disconnect 竞态 1,000 轮 | 恰好一个终态和一条审计结果；无 Future 覆盖、悬挂或重复副作用 |
| M06-F03 | UI 展示结构化 operation、命令/文件摘要、作用域、风险、来源和“仅本次/会话”能力 | Renderer golden、a11y 和长路径/多文件 fixture | 用户在不展开诊断的情况下能判断将发生什么；敏感参数被遮蔽但风险不被隐藏 |
| M06-F04 | reconnect 后通过请求 identity 恢复或明确失效审批，旧决定不能作用于新请求 | Bridge 重连、Runtime 重启、request id 复用和 nonce 变化 | 不跨 generation 复用审批；过期决定不能触发工具或文件修改 |
| M06-F05 | 命令、文件修改、MCP progress 和 Hook 事件形成可折叠 OAEP 处理过程并保持因果顺序 | command/file/MCP/hook golden replay 与 live tool suite | started→delta/progress→completed 顺序稳定；最终回答与工具过程不混为字典文本 |
| M06-F06 | 副作用执行前后记录脱敏审计摘要和结果，不保存 secret 或完整用户内容 | approve/deny/fail/cancel 审计矩阵和 canary scan | 每次副作用可追溯到 Session/Run/approval；未批准或过期请求执行次数为 0 |

### M07 历史同步、归档与渐进加载

主要更新：通用 Backend History Capability、Codex History Provider、Runtime import、Desktop history window。

| ID | 功能点与实现 | 自动测试 | 验收标准 |
| --- | --- | --- | --- |
| M07-F01 | Runtime 定义通用 `HistoryCapability/readNormalizedHistory/planHistoryMigration`，Codex 作为一个实现 | Fake Backend、Codex Backend 和类型边界测试 | Runtime Core 无需认识 Codex 方法或常量，也能导入、分页和迁移历史 |
| M07-F02 | 最近 Turn 优先生成首屏 History Window，返回 cursor、total/estimated、truncated 和 mappingVersion | 0/1/59/633/10,000+ Turn fixture | 首屏无需等待全部投影；显示“已加载 X/Y”或未知总量，不误称全部加载完成 |
| M07-F03 | 支持加载更早内容、取消、继续和幂等重入；若 App Server 无原生分页，由 Adapter 内部窗口化且不阻塞 UI | cancel/resume、重复 cursor、失效 cursor 和后台投影测试 | 顺序与 Codex 一致，无重复/缺失；切换会话立即取消无用工作 |
| M07-F04 | 历史导入、实时消息和 Snapshot 使用同一 OAEP Mapper 与排序键 | history/live 交界、同 timestamp、多 item 和迟到事件 property test | 静态加载与实时继续后的展示结构一致；不会再次出现消息顺序混乱或列表字典正文 |
| M07-F05 | 归档状态与 Codex 对齐，查询明确区分 active/archived/all，支持归档和取消归档 | 633 条混合归档 fixture、双向同步、冲突和重启 | 默认工作区只显示未归档；设置页可查看并恢复；重复同步不改变用户选择 |
| M07-F06 | mappingVersion 变化先 dry-run，再增量迁移；失败可回滚到旧投影而不修改原生 Codex 历史 | 旧 P8/P9 fixture、部分失败、断电和恢复测试 | 原始历史只读；迁移失败不丢会话；成功后顺序、角色、处理过程和最终回答一致 |

### M08 有界资源、生命周期与长会话性能

主要更新：Main/Renderer LRU、Backend lock/state registry、队列清理和资源指标。

| ID | 功能点与实现 | 自动测试 | 验收标准 |
| --- | --- | --- | --- |
| M08-F01 | Main Snapshot cache 使用可配置 LRU、字节上限、TTL 和 active pinning | 10,000 Session churn、超大 Snapshot 和并发读取 | 容量不越界；活跃 Session 不被驱逐；被驱逐会话可从 Runtime 正确补水 |
| M08-F02 | Renderer ThreadSnapshotStore 使用相同 ownership 规则，切换/关闭/归档时释放订阅和历史页 | 反复切换 1,000 次、窗口重载和归档测试 | listener、timer、AbortController 数量回到基线；无后台 Patch 写入已关闭任务 |
| M08-F03 | entity lock、resumed generation、cancelled run 和审批记录按活跃引用及 TTL 回收 | 100,000 Run 压力、终态和异常退出测试 | 非活跃内部状态有稳定上限；仍在运行或恢复中的对象不会被提前回收 |
| M08-F04 | Turn Queue 具备长度/字节限制和背压，超限返回结构化可操作错误 | 消息突发、超长资源、慢 Backend 和取消测试 | 不因无限排队耗尽内存；用户能取消、等待或拆分任务，不会静默丢消息 |
| M08-F05 | 长历史和长 Run 分离预算，流式 delta 不随累计正文线性复制 | 20MB 回答、5,000 工具事件、10,000 历史 Run 性能测试 | 单次 Patch 大小随本次 delta 增长；强制 GC 后 heap 增量在既定预算内，无 O(n²) 趋势 |
| M08-F06 | 输出 cache hit/miss/eviction、队列深度、活跃锁和历史窗口指标 | 指标一致性、禁用遥测和高压测试 | 资源泄漏可被自动门禁发现；指标不含用户文本、文件内容、命令或 secret |

### M09 Host Bridge、远程身份与安全边界

主要更新：Runtime Client、Remote Codex Supervisor、Bridge handshake、SSH Tunnel transport 和 token 管理。

| ID | 功能点与实现 | 自动测试 | 验收标准 |
| --- | --- | --- | --- |
| M09-F01 | 统一 Local/Remote Supervisor 的 active backend identity，Remote 不再因 `binary=None` 被错误判为不可执行 | local process、remote bridge、断连和重连 contract test | 上层只依赖统一 identity/readiness；远端已证明进程可实际执行 turn/start |
| M09-F02 | Bridge handshake 返回 `codexVersion/schemaDigest/binaryDigest/adapterProtocol/hostId/nonce` | 正确、缺字段、篡改、旧协议和重复 nonce fixture | 身份未完整证明时不能发送；UI 能区分版本、主机和连接问题 |
| M09-F03 | token 短期化、可轮换、单连接/作用域限制并防重放 | 过期 token、重复 nonce、跨主机复用、并发轮换测试 | 旧凭证不能建立新执行通道；日志、命令行和错误中不出现明文 token |
| M09-F04 | 生产 Bridge 默认只监听 loopback，经 SSH Local Port Forward 访问；非 loopback 明文模式仅显式开发配置可用 | bind address、配置升级、远端扫描和负向测试 | 默认不存在 `0.0.0.0` 暴露；产品模式拒绝无隧道明文连接 |
| M09-F05 | transport generation 参与 Session route、审批和 resync 身份，旧隧道事件全部失效 | 端口复用、retunnel、双主机同 thread id 和迟到响应测试 | 不把旧隧道或其他主机的事件写入当前 Session；新连接可继续权威绑定 |
| M09-F06 | 通过 Windows 本地 Codex 与 Linux/Bridge fixture 执行同一协议验收套件 | 本地真实 App Server、loopback Bridge、SSH Tunnel/远端受控环境 | 除 Transport 证据外，事件、审批、历史、错误和最终 OAEP digest 一致 |

### M10 架构收敛、兼容治理与最终证据

主要更新：依赖边界、Legacy 迁移、稳定测试入口、P10 ledger、release runner 和人工可用性验收。

| ID | 功能点与实现 | 自动测试 | 验收标准 |
| --- | --- | --- | --- |
| M10-F01 | Runtime Core 通过通用 Backend SPI 获取历史、能力、模型和迁移计划，移除对 `codex_adapter` 的直接导入 | AST/import graph/rg 门禁和 Fake Backend 集成测试 | Runtime Core 到 Codex Adapter 的直接依赖数为 0；替换 Backend 不修改 Runtime 主流程 |
| M10-F02 | `_legacy_message_parts` 迁入版本化 History Migrator，实时用户/助手文本一律按字面值处理 | 看似 Python list/dict 的真实正文、旧历史损坏样本和迁移回放 | 实时正文不被误解析；旧数据仍能修复；迁移行为有 mappingVersion 和证据 |
| M10-F03 | 合并 P3—P10 活跃验证脚本为 `verify:codex-adapter`、`verify:codex-adapter:live`、`verify:codex-adapter:release` 等稳定入口 | 命令发现、重复脚本和旧引用扫描 | CI、本地和发布使用同一入口；历史证据只读保留，失效脚本不再被调用 |
| M10-F04 | 建立 60 点 P10 feature ledger，证据绑定 source/dirty/build/Codex/schema/host/test digest 和 observedAt | 篡改源码、构建、测试输出、环境或时间戳 | 任何不一致使对应功能变为 failed/missing/blocked，不能人工覆盖 accepted |
| M10-F05 | 全链路自动验收覆盖 Unit、Contract、Property、Electron、Live Codex、Bridge、Stress 和 Upgrade | 从干净构建运行 release runner，模拟未登录、无网络和缺远端环境 | 可运行项全部通过；环境缺失只能标 blocked；fixture 不能冒充 Live/Bridge accepted |
| M10-F06 | 小白用户手工旅程：添加工作区、导入会话、打开历史、多轮继续、附件、审批、取消、错误恢复、归档/恢复、重启继续 | 自动化视觉/可访问性检查加固定手工清单，记录截图和操作结果 | 用户无需理解 Thread/Turn/OAEP 即可完成旅程；无重复任务、无假状态、无不可解释卡死 |

## 6. 实施顺序与阶段门禁

### P10.1 协议和输入闭环（M01、M02）

- 先固定 23 个语义处置矩阵和生成式 Contract，再补 Decoder/Mapper。
- 随后落地 InputResource 和 Reasoning 可见性，避免继续在旧 promptSuffix 路径上增加分支。
- 门禁：语义处置 23/23；五类资源无静默丢失；hidden reasoning 泄漏为 0。

### P10.2 单会话执行与用户恢复（M03、M04、M06）

- 完成模型绑定恢复、单 Session Turn Queue、细粒度 final fallback。
- 贯通 Error/Readiness Envelope 和 Approval singleflight。
- 门禁：同 Session 并发 active Turn 不超过 1；重复审批仅一个决定；UI 不再解析错误文本。

### P10.3 恢复、历史和资源边界（M05、M07、M08）

- 修复 stale resync，再做渐进历史和缓存有界化。
- 门禁：乱序/丢包/重启最终 digest 一致；10,000+ 历史可渐进使用；压力后资源回到预算。

### P10.4 Transport 与架构收敛（M09、M10）

- 完成 Bridge attestation、loopback/SSH 安全边界和 Runtime 通用 Backend SPI。
- 最后运行稳定 release runner 和真实用户旅程。
- 门禁：本地/Bridge OAEP digest 一致；Runtime Core 无 Codex 直接依赖；60/60 证据可重算。

若任一阶段发现现有账本与真实行为不一致，必须以真实结果为准降低状态；不得修改断言、删除失败样本或改写证据来迎合账本。

## 7. 测试层级与统一验收规则

| 层级 | 作用 | 不可替代的证明 |
| --- | --- | --- |
| L0 Static/Architecture | 依赖边界、生成物、禁用路径和危险配置扫描 | Runtime Core 无 Codex 直接依赖，Contract 无手写漂移，生产 Bridge 不监听非 loopback |
| L1 Unit/Property/Fuzz | 状态机、排序、分片、竞态和畸形输入 | 单函数和随机时序的确定性、终态唯一、无崩溃 |
| L2 Contract/Component | Python、TypeScript、SQLite、IPC、OAEP 和 Bridge 契约 | 字段、版本、错误码、水位和持久化跨层不丢失 |
| L3 Electron | Main→Preload→Renderer→Reducer→UI 真实链路 | 增量渲染、交互响应、恢复动作和可访问性真实有效 |
| L4 Live Codex | 当前宿主机真实 Codex App Server | 多轮、输入资源、工具、文件、审批、Reasoning 和最终回答来自真实后端 |
| L5 Host Bridge | loopback Bridge 及 SSH Tunnel/远端受控环境 | 本地与远端 Transport 身份、安全和 OAEP 结果一致 |
| L6 Stress/Upgrade | 超长历史、长 Run、重启、版本升级/降级 | 容量有界、迁移可回滚、兼容路径可持续运行 |

统一规则：

- 每个功能点必须至少有一条正向测试、一条边界或负向测试，以及可机器判断的验收断言。
- UNIT 和 fixture 不能替代 Electron、Live Codex 或 Host Bridge 证据。
- Live 测试必须只在隔离目录发送合成提示与合成文件，不访问用户真实项目内容。
- 真实网络、登录或远端主机不可用时标记 `blocked`，不得用 mock 改写成 `accepted`。
- 所有证据必须绑定 feature id、命令、断言集合、源码 digest、dirty digest、构建 digest、Codex/Schema digest、host id 和时间。
- 性能阈值在同一硬件与固定 fixture 下测量；报告 transport、apply、render 三段，不用单一总耗时掩盖卡顿来源。
- 安全测试中的 secret、token、路径和命令 canary 一旦在日志、UI、导出或证据中明文命中，整个发布失败。
- 一票否决：重复创建 Codex Thread/Turn、用户输入或最终回答丢失/乱序、隐藏推理泄漏、未授权副作用、过期 Snapshot 覆盖新内容、旧隧道串写、账本与真实执行不一致。

## 8. 用户验收旅程

1. 用户添加已有 Codex 工作区，未归档会话最近内容优先出现，旧内容可继续加载。
2. 点击历史会话立即恢复真实标题、绑定模型、轮数和上下文，不显示空白初始输入页。
3. 连续发送多轮消息只增加 Turn，不增加 Thread；并发点击发送时明确排队而不是创建多个任务。
4. 回复期间单行状态持续更新，展开可查看处理说明、公开推理摘要、工具、文件和子任务，最终回答独立流式显示。
5. 添加文件、文件夹、选区、终端或浏览器上下文时，发送前可看到资源摘要和不支持/超限原因。
6. 工具或文件修改需要审批时，用户能看到操作、范围和风险；重复请求不会出现多个审批框。
7. 登录、网络、模型、协议、绑定和历史错误给出不同且正确的恢复动作，不显示误导性“Codex 未安装/未登录”。
8. 切换侧栏、展开处理过程和输入消息在长历史、长输出期间保持响应。
9. 归档后会话从默认列表消失，在设置中可查看并取消归档；与 Codex 再同步不反复出现。
10. 重启 Desktop、Runtime 或 Codex App Server 后继续同一任务，内容、水位、模型和审批状态不串线。

## 9. 交付物

1. 本 P10 方案文档。
2. `codex-adapter-p10-feature-ledger.json`，固定 10 个模块、60 个功能点。
3. Stable Contract 语义注册表、生成器、23 项处置矩阵和覆盖报告。
4. OAEP InputResource、Reasoning Segment、Error Envelope、Readiness DTO、Backend History SPI 契约与迁移。
5. Turn Coordinator、Approval Singleflight、fresh resync、History Window 和有界缓存实现。
6. Host Bridge attestation、短期凭证、loopback/SSH Tunnel 安全实现。
7. 稳定的 Unit、Contract、Property、Electron、Live、Bridge、Stress 和 Upgrade 验收入口。
8. `.artifacts/codex-p10/manifest.json` 及每个功能点的机器可重算证据。
9. 每轮进度报告、阻塞记录、性能报告和最终用户旅程验收记录。

只有 M01-F01 至 M10-F06 全部具有当前源码和当前环境的有效证据时，P10 才能标记完成。任何 `missing/failed/blocked` 都必须保留真实状态并说明原因。

## 10. 完成进度与验收证据

| 阶段 | 模块 | 功能点 | 完成状态 |
| --- | --- | ---: | --- |
| P10.1 | M01—M02 | 12 | 已完成 |
| P10.2 | M03、M04、M06 | 18 | 已完成 |
| P10.3 | M05、M07、M08 | 18 | 已完成 |
| P10.4 | M09—M10 | 12 | 已完成 |
| 总计 | 10 个模块 | 60 | 已完成（60/60，100%） |

最终验收命令：`npm run verify:codex-adapter:release`。2026-08-05 在同一稳定源码快照上完整通过，耗时 601.3 秒，源码摘要为 `5fef5d90023802d8bbc4dfbf498360699faa1f815f28ab5f19354d0696caa711`。验收覆盖 Contract、Unit/Property、TypeScript、Electron Main→Preload→Renderer、真实 Codex 30 轮连续会话、五类输入资源、流式增量、审批、取消、归档/恢复、Runtime 重启、Windows SSH Local Port Forward→Linux loopback Bridge、20 MB/5,000 Tool/10,000 History 压力和架构边界。

机器可重算状态见 `codex-adapter-p10-feature-ledger.json`，60 个功能点均为 `passed`；发布摘要见 `.artifacts/codex-p10/manifest.json`；13 项普通用户旅程证据见 `.artifacts/codex-p10/user-journey.json`；20 张视觉截图与可访问性结果见 `apps/desktop/windows/out/verification/structured-visual/report.json`。`CodexAdapter_P10用户旅程验收清单.md` 保留为发布人员和产品人员的可读索引，不再以人工勾选替代自动验收。
