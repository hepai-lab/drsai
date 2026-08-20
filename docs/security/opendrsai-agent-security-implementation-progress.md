# OpenDrSai 智能体安全实施进展

> 统计口径：30 个功能点（P0/P1/P2 各 10 项）等权；单项按设计、实现、自动测试、集成测试、最终验收证据分段计分。只有全部验收门禁通过才记为 100%。

> **规划切换（2026-08-21）**：第 68 轮正式基线为 72%（2162/3000）、0/30 完全验收。后续开发统一按 [P3 Runtime 安全控制收敛与产品发布 SPEC](./opendrsai-agent-security-p3-runtime-security-convergence-spec.zh-CN.md) 执行；P0/P1/P2 及本台账保留为历史证据和需求追溯，不再分别排期。切换到 P3 不代表尚未验收的 P0/P1/P2 门禁被豁免。

## 第 1 轮

日期：2026-08-16  
总体进展：**4%**  
完全验收：**0 / 30**  
当前阶段：P0 安全领域基础与 Approval 精确绑定

### 本轮完成

- 新增不依赖 Agent Core/客户端协议的 `runtime.security_boundary` 包。
- 实现不可变 `ActionProposal` 与 `ResolvedCapabilityProfile`。
- 实现原始参数规范化摘要和独立脱敏展示，修复敏感字段脱敏后发生授权碰撞的问题。
- 实现 deny-first、多策略层只能收紧的 Capability Policy Resolver。
- 实现持久化、过期、精确作用域、单次原子消费和并发防重放的 Authorization Grant Store。
- 修复旧 `ApprovalRegistry._resource_hash()` 对脱敏资源计算授权哈希的问题。
- Runtime side-effect 改为保存原始请求摘要，并支持 claim 时通过 `actual_request` 重验实际请求；保持旧调用兼容。

### 功能点进展

| 功能点 | 进度 | 本轮证据 | 尚缺验收 |
|---|---:|---|---|
| P0-F01 不可变能力配置 | 45% | 模型、策略交集、拒绝优先及测试 | 接入全部 Run/工具；属性测试；profile 版本持久化 |
| P0-F06 硬禁止层 | 20% | Profile `hard_denies` 在 Grant 前拒绝 | 完整规则分类、不可绕过执行后端、攻击语料 |
| P0-F07 精确绑定 | 55% | 原始摘要、参数/Run/Profile/operation 绑定、过期与并发单消费测试 | 全部 claim 调用传实际请求；Grant 与 effect 同事务；崩溃恢复 |
| P0-F10 迁移/fail-closed | 10% | 新旧 API 保持兼容且无客户端改动 | 所有副作用迁移、禁止裸执行回退、发布扫描 |
| 其余 26 项 | 0% | 尚未开始或尚无足够验收证据 | 按三份方案推进 |

折算：`(45 + 20 + 55 + 10) / (30 × 100) = 4%`。

### 测试结果

- `test_security_boundary.py + test_runtime_security.py`：20 passed，1 skipped（既有 Linux-only `openat/O_NOFOLLOW` 用例）。
- `test_runtime_engine.py`：全部用例通过，包含新增 raw request digest/claim revalidation 回归。
- Ruff：当前 `.venv` 未安装 Ruff，未执行；后续使用项目工具环境补跑。该缺口不计为验收通过。

### 下一轮

1. 为 Proposal/Profile/Grant 增加正式持久化 schema 与迁移，不再只作为独立安全组件存在。
2. 将 Runtime 主执行路径传入 `actual_request`，消除兼容路径上的未重验窗口。
3. 建立 `SandboxBackend`/健康证明/fail-closed 接口，先让文件与进程工具具备可迁移执行边界。
4. 不修改 TUI/WebUI 协议；需要展示的新字段先以后端可选字段提供。

## 第 2 轮

日期：2026-08-16  
总体进展：**7%**（较上轮 +3 个百分点）  
完全验收：**0 / 30**  
当前阶段：P0 持久化事实源与隔离执行契约

### 本轮完成

- 新增 append-only `SecurityBoundaryStore`，持久化安全 Profile、Action Proposal 和 Run/Profile 版本绑定。
- Proposal 只持久化原始 payload digest 与脱敏展示数据，不保存原始秘密。
- Profile ID/version 内容冲突硬失败；Run Profile 只允许版本单调递增。
- Runtime `request_approval()` 在创建 Approval/side-effect 的同一事务中保存 Action Proposal。
- Runtime 提供 Profile 绑定/读取窄接口，不更改 TUI、WebUI、Android 或 OAEP 协议。
- 新增 `SandboxBackend`、`IsolationAttestation`、`SandboxExecutionRequest/Receipt` 和 `SandboxBroker`。
- Broker 在后端缺失、证明过期、隔离保证不足、环境污染或作用域不匹配时 fail closed，并且拒绝发生在消费 Grant 之前。
- 健康证明通过后才原子消费 Grant；回执必须绑定同一个 backend 和 attestation。

### 功能点进展

| 功能点 | 进度 | 累积证据 | 尚缺验收 |
|---|---:|---|---|
| P0-F01 不可变能力配置 | 65% | 策略解析、稳定摘要、append-only 持久化、Run 单调版本绑定、重启恢复 | 所有 Run 自动解析；属性测试；模式/管理员策略接入 |
| P0-F03 进程与资源隔离 | 20% | Backend/Broker/证明/请求/回执契约及 fail-closed 测试 | Windows 受限身份、Job Object、句柄与资源限制、逃逸 E2E |
| P0-F06 硬禁止层 | 20% | Profile/Grant 前置拒绝 | 完整规则、真实执行后端不可绕过、攻击语料 |
| P0-F07 精确绑定 | 60% | 原始摘要、Proposal 同事务持久化、Grant 精确作用域/单消费、Broker 二次绑定 | 所有执行调用实际参数重验；Grant/effect 同事务；崩溃结果协议 |
| P0-F09 安全回执与可观测性 | 15% | 标准隔离证明和执行回执模型 | append-only 执行事实、事件链、指标和篡改验证 |
| P0-F10 迁移/fail-closed | 25% | 无 Backend/弱证明时拒绝且不消费 Grant；客户端协议未变 | Broker 接管全部副作用；禁止裸执行回退；发布静态扫描 |
| 其余 24 项 | 0% | 尚未开始或尚无足够验收证据 | 按三份方案推进 |

折算：`(65 + 20 + 20 + 60 + 15 + 25) / (30 × 100) = 6.83%`，显示为 7%。

### 本轮测试

- `test_security_boundary.py`：15 passed。
- `test_security_boundary.py + test_runtime_engine.py`：53 passed。
- 覆盖重启恢复、不可变触发器、秘密不落库、版本冲突、隔离后端缺失、证明过期、保证缺失、环境污染、作用域不匹配和重复执行。

### 下一轮

1. 新增 append-only Effect Execution 状态与 `outcome_unknown` 崩溃语义，将 Grant 消费和 execution claim 合并为一个事务。
2. 为 Windows 隔离后端实现可探测的受限进程/Job Object 能力；无法证明文件系统强制边界时继续拒绝执行。
3. 建立禁止新增裸 `subprocess`/网络副作用的静态扫描基线和受控例外清单。
4. 逐条迁移 Runtime 执行路径，不触碰 Agent Core，并保持客户端可选字段兼容。

## 第 3 轮

日期：2026-08-16  
总体进展：**10%**（较上轮 +3 个百分点）  
完全验收：**0 / 30**  
当前阶段：Exactly-once Effect 状态与 Windows 隔离能力探测

### 本轮完成

- 新增 `EffectExecutionStore`，将 Authorization Grant 消费和 Effect Execution claim 合并到同一个 `BEGIN IMMEDIATE` 事务。
- Effect identity 为 append-only；终态限定为 `succeeded/failed/timed_out/outcome_unknown`，终态不可二次完成。
- Runtime 重启可将遗留 `executing` 原子收敛为 `outcome_unknown`，禁止在外部结果不确定时盲目重放。
- `SandboxBroker` 现在要求 execution ID、Proposal、Profile、Grant 和 attestation 全部精确绑定。
- Backend 启动后抛错、失联或返回不可信回执时，Broker 持久化 `outcome_unknown`。
- 新增 Windows 隔离能力探测：区分 restricted token、Job Object、AppContainer API 是否存在，以及文件/网络边界是否真正强制。
- Windows 后端当前明确标记为 `probe-only`；API 存在不转换为隔离保证，因此 Broker 会 fail closed。
- 新增 AST 静态扫描，阻止 Runtime/legacy operations 新增未经评审的裸 `subprocess`、shell 和 socket 调用。
- 现有裸调用形成带 owner、原因和数量的迁移基线；行号变化不会规避或误触规则，新增数量会使测试失败。

### 功能点进展

| 功能点 | 进度 | 累积证据 | 尚缺验收 |
|---|---:|---|---|
| P0-F01 不可变能力配置 | 65% | 策略解析、append-only Profile/Proposal、Run 单调版本 | 所有 Run 自动解析、属性测试、组织策略接入 |
| P0-F03 进程与资源隔离 | 30% | Broker 契约、隔离证明、Windows API/保证分离探测 | 受限 token、Job 强制、句柄/资源限制和逃逸 E2E |
| P0-F06 硬禁止层 | 20% | Profile/Grant 前置拒绝 | 完整规则、真实执行后端不可绕过、攻击语料 |
| P0-F07 精确绑定 | 70% | 原始摘要、持久 Proposal、Grant/effect 同事务、execution/attestation 绑定 | 所有真实执行路径提交实际参数；全链路迁移 |
| P0-F09 安全回执与可观测性 | 35% | append-only Effect identity、终态回执、断联/restart `outcome_unknown` | 事件链摘要、指标、完整篡改验证 |
| P0-F10 迁移/fail-closed | 40% | 后端缺失/弱证明拒绝、裸调用 AST 增量门禁与债务基线 | 清零危险例外、Broker 接管发布路径、打包验收 |
| P1-F06 Exactly-once Grant/副作用 | 35% | Grant 消费/effect claim 单事务；并发、防重放、崩溃不盲重试 | 外部幂等协议、补偿、Runtime 主表迁移和 E2E fault injection |
| 其余 23 项 | 0% | 尚无足够验收证据 | 按三份方案推进 |

折算：`(65 + 30 + 20 + 70 + 35 + 40 + 35) / (30 × 100) = 9.83%`，显示为 10%。

### 本轮测试

- 新安全域与静态扫描：22 passed。
- 覆盖事务回滚不消费 Grant、重启恢复、终态不可反转、Broker 断联、Windows API 不冒充保证，以及裸副作用增量检查。

### 下一轮

1. 实现 Windows Job Object 进程树和资源限制，并用 helper 子进程验证终止与无遗留进程。
2. 设计/实现 restricted token 或 AppContainer worker；不能证明文件边界前仍不开放执行。
3. 把 EffectExecution 领域事件接入 Runtime 审计链和指标。
4. 开始迁移 `desktop_controlled_command` 等低风险窄路径，逐步减少静态扫描例外。

## 第 4 轮

日期：2026-08-16  
总体进展：**12%**（较上轮 +2 个百分点）  
完全验收：**0 / 30**  
当前阶段：Windows 进程树强制边界与可验证安全审计链

### 本轮完成

- 新增 `SecurityEventJournal`，以 append-only SQLite 表记录安全事件，并通过 `previous_digest + event_digest` 形成可验证链。
- 事件 payload 在落库前独立脱敏；秘密不参与展示存储，但授权原始摘要仍保留在 Proposal/Grant 事实中。
- Effect `claimed`、`terminal` 和重启后的 `recovered_unknown` 与对应状态变更在同一事务写入。
- 审计链支持 sequence gap、前序摘要错误和内容离线篡改检测；数据库触发器拒绝正常 update/delete。
- 新增 Windows Job Object 启动器：进程以 `CREATE_SUSPENDED` 创建，成功加入 Job 后才恢复，消除先运行后分配的竞态。
- Job 强制 `KILL_ON_JOB_CLOSE`、活动进程数、单进程内存和 Job 总内存限制。
- 超时关闭 Job 并等待整个进程树退出；Windows 原生测试证明孙进程被终止且无活动遗留。
- 子进程只接收显式环境映射；测试证明宿主秘密环境变量不被继承。
- Windows attestation 只在调用方提供已验证证据时声明 `process_tree_controlled`，仍不声明 restricted identity 或 filesystem enforcement。

### 功能点进展

| 功能点 | 进度 | 累积证据 | 尚缺验收 |
|---|---:|---|---|
| P0-F01 不可变能力配置 | 65% | 策略解析、append-only Profile/Proposal、Run 单调版本 | 所有 Run 自动解析、属性测试、组织策略接入 |
| P0-F03 进程与资源隔离 | 45% | suspended→Job→resume、进程树终止、进程/内存限制、原生 Windows 测试 | restricted token/AppContainer、句柄验证、完整逃逸套件 |
| P0-F05 凭据与环境隔离 | 15% | Job 子进程使用显式环境且不继承 canary | Credential Broker、用途/域/TTL、日志和临时文件扫描 |
| P0-F06 硬禁止层 | 20% | Profile/Grant 前置拒绝 | 完整规则、真实执行后端不可绕过、攻击语料 |
| P0-F07 精确绑定 | 70% | 原始摘要、Grant/effect 同事务、execution/attestation 绑定 | 所有真实执行路径重验、全链路迁移 |
| P0-F09 安全回执与可观测性 | 60% | 同事务安全事件、链式摘要、脱敏、append-only 与篡改检测 | 指标/SLO、审计导出、跨日志锚定和高并发压力 |
| P0-F10 迁移/fail-closed | 40% | fail-closed Broker、裸调用门禁 | 清零危险例外、发布路径全面接管、打包验收 |
| P1-F06 Exactly-once Grant/副作用 | 45% | claim/消费/审计同事务，崩溃收敛且不可重放 | 外部幂等/补偿、主 Runtime 状态迁移、逐点 fault injection |
| 其余 22 项 | 0% | 尚无足够验收证据 | 按三份方案推进 |

折算：`(65 + 45 + 15 + 20 + 70 + 60 + 40 + 45) / (30 × 100) = 12%`。

### 本轮测试

- 安全域单元/集成测试：23 passed。
- Windows Job Object 原生验收：4 passed。
- 覆盖审计脱敏、链验证、离线篡改、Effect/事件同事务、suspended assignment、超时杀进程树、活动进程限制和环境不继承。

### 下一轮

1. 实现 Windows restricted token worker，验证非管理员 SID、禁用高权限组和 privilege。
2. 评估 AppContainer/独立低权限账户的文件系统投影；用工作区外 canary 做真实读写逃逸测试。
3. 新增 Credential Broker 的引用、用途、目标域、TTL 和一次性租约模型。
4. 将安全审计指标接入 Runtime observability，但保持客户端协议不变。

## 第 5 轮

日期：2026-08-16  
总体进展：**14%**（较上轮 +2 个百分点）  
完全验收：**0 / 30**  
当前阶段：Credential Broker 与 Windows 受限身份基础

### 本轮完成

- 新增 `CredentialBroker`，凭据以 `credential_ref` 进入 Capability Profile，秘密本体不进入 Profile、Proposal、数据库或审计事件。
- Credential lease 精确绑定 Run、Profile digest、用途、HTTPS origin、TTL 和最大使用次数；默认一次使用。
- 目标 origin 统一规范化为 `https://host:port`，拒绝 HTTP、内嵌身份、URL path/query/fragment 和 Profile network rules 之外的目标。
- lease 消费使用 `BEGIN IMMEDIATE` 与条件更新，并发消费者只能有一个成功；重放、跨 Run、跨用途、跨目标和 Profile 变化均拒绝。
- 支持 lease 到期和主动撤销；秘密解析发生在原子消费之后，解析失败不会让租约重新可用。
- `CredentialMaterial` 使用可清零 bytearray，并要求短生命周期 context manager；关闭后禁止再次读取。
- 凭据租约签发、消费、到期和撤销进入既有安全事件链，事件只包含 credential ref digest。
- 新增 Windows restricted token 工厂：请求禁用最大 privilege、LUA/write restrictions，并验证 elevation、管理员组、启用 privilege 数和 integrity level。
- 本机 `CreateRestrictedToken` 由 ctypes 和 pywin32 交叉验证均返回 Windows error 87；工厂严格 fail closed，未回退到调用者 token，`non_admin_identity` 不计为已实现。

### 功能点进展

| 功能点 | 进度 | 累积证据 | 尚缺验收 |
|---|---:|---|---|
| P0-F01 不可变能力配置 | 65% | Profile/Proposal 持久化、credential refs 纳入摘要与策略交集 | 所有 Run 自动解析、属性测试、组织策略接入 |
| P0-F03 进程与资源隔离 | 45% | Job 强制边界；restricted token 工厂严格校验但本机不可用 | 受限 token 实际启动、AppContainer、句柄与逃逸 E2E |
| P0-F05 凭据与环境隔离 | 60% | 显式环境、引用式凭据、用途/目标/TTL/次数 lease、并发单消费、清零与秘密不落库 | 接入真实工具/网络代理、子进程传递通道、全日志/崩溃扫描 |
| P0-F06 硬禁止层 | 20% | Profile/Grant 前置拒绝 | 完整规则、真实执行后端不可绕过、攻击语料 |
| P0-F07 精确绑定 | 70% | Proposal/Profile/Grant/Effect/attestation 精确绑定 | 所有真实执行路径重验、全链路迁移 |
| P0-F09 安全回执与可观测性 | 65% | Effect 与 credential 事件链、脱敏、篡改验证 | 指标/SLO、导出、跨日志锚定和压力测试 |
| P0-F10 迁移/fail-closed | 40% | 后端和 token 不可用均拒绝；裸调用门禁 | 清零危险例外、发布路径全面接管、打包验收 |
| P1-F06 Exactly-once Grant/副作用 | 45% | effect 与 credential 单次事务语义 | 外部幂等/补偿、主 Runtime 迁移、逐点 fault injection |
| 其余 22 项 | 0% | 尚无足够验收证据 | 按三份方案推进 |

折算：`(65 + 45 + 60 + 20 + 70 + 65 + 40 + 45) / (30 × 100) = 13.67%`，显示为 14%。

### 本轮测试

- Credential、安全域及 Windows token：28 passed。
- 覆盖 secret 不落库/审计、材料关闭、并发单消费、TTL、撤销、网络边界和受限 token 不可用时 fail-closed。

### 下一轮

1. 实现 Credential Broker 到受控 HTTP/network broker 的一次性注入，禁止进入命令参数和普通环境变量。
2. 实现 Network Egress Policy：DNS 解析后 IP/CIDR 判定、环回/私网/链路本地/元数据拒绝和重定向重验。
3. 将安全指标接入 Runtime observability，并建立低基数 SLO 指标测试。
4. 继续评估 AppContainer 或独立低权限 worker 作为本机受限身份/文件投影后端。

## 第 6 轮

日期：2026-08-16  
总体进展：**16%**（较上轮 +2 个百分点）  
完全验收：**0 / 30**  
当前阶段：DNS-aware Network Egress Broker 与一次性凭据注入

### 本轮完成

- 新增 `NetworkEgressBroker`：Profile 缺少 `network.connect` 或 origin allowlist 时默认拒绝。
- 仅允许无内嵌身份的 HTTPS URL；拒绝 HTTP、local/internal/metadata hostname 和未授权 origin。
- DNS 结果逐个解析并拒绝 loopback、private、link-local、multicast、reserved、unspecified、IPv4-mapped private IPv6；混合公私答案整体拒绝。
- 网络授权记录 hostname、port、全部解析 IP、选中 IP、Profile digest 和短期到期时间。
- 新增 pinned HTTP transport：TCP 连接到已审核 IP，TLS SNI/证书验证仍使用原 hostname，响应 peer IP 必须与授权 IP 一致。
- Transport 不读取系统代理配置；请求 URL、固定 IP、TLS name 三者作用域不一致时拒绝。
- 301/302/303/307/308 每一跳重新走 origin 与 DNS/IP 授权；未授权跳转和超限跳转拒绝。
- Caller 不能自行传入 Authorization、Proxy-Authorization、Host、Connection 或带 CR/LF 的 header。
- Credential lease 只在 transport boundary 消费并注入独立 `sensitive_headers`；Transport 返回或抛错后 bytearray 立即清零。
- 凭据不跨重定向自动重放，即使仍为同一 origin 也要求新 lease。
- 请求/响应 body、timeout、HTTP method 均设置确定性上限；网络审计不记录 headers、body 或秘密。
- 支持 IPv4、公共 IPv6 literal、IDNA hostname 规范化和默认 443 端口。

### 功能点进展

| 功能点 | 进度 | 累积证据 | 尚缺验收 |
|---|---:|---|---|
| P0-F01 不可变能力配置 | 65% | Profile/Proposal/credential/network rules 持久化与摘要 | 所有 Run 自动解析、属性测试、组织策略接入 |
| P0-F03 进程与资源隔离 | 45% | Job 强制边界；受限 token 不可用时 fail closed | 受限 worker、AppContainer、句柄与逃逸 E2E |
| P0-F04 网络出口边界 | 50% | 默认拒绝的受控 HTTP、DNS/IP 分类、固定 IP+TLS name、peer/redirect 重验 | OS/WFP/AppContainer 阻断自带 socket/DoH/代理绕过、真实 TLS E2E |
| P0-F05 凭据与环境隔离 | 70% | lease 到 transport 一次性注入、敏感头清零、不落库/审计 | 接入真实工具、全日志/崩溃扫描、子进程安全通道 |
| P0-F06 硬禁止层 | 20% | Profile/Grant 前置拒绝 | 完整规则、真实执行后端不可绕过、攻击语料 |
| P0-F07 精确绑定 | 70% | Proposal/Profile/Grant/Effect/attestation/network 精确绑定 | 所有真实执行路径重验、全链路迁移 |
| P0-F09 安全回执与可观测性 | 70% | Effect、credential、network 链式审计与篡改验证 | 指标/SLO、导出、跨日志锚定与压力测试 |
| P0-F10 迁移/fail-closed | 40% | 后端/token/network 缺失均拒绝；裸调用门禁 | 清零例外、发布路径全面接管、打包验收 |
| P1-F06 Exactly-once Grant/副作用 | 45% | Effect 与 credential 原子单次语义 | 外部幂等/补偿、主 Runtime 迁移、逐点 fault injection |
| 其余 21 项 | 0% | 尚无足够验收证据 | 按三份方案推进 |

折算：`(65 + 45 + 50 + 70 + 20 + 70 + 70 + 40 + 45) / (30 × 100) = 16.17%`，显示为 16%。

### 本轮测试

- Network 与安全域组合：47 passed。
- 本轮新增 Network 专项：20 passed。
- 覆盖 IPv4/IPv6、公私混合 DNS、metadata、peer mismatch、redirect 逐跳授权、header injection、credential 单次注入/清零和 transport IP/SNI 分离。

### 下一轮

1. 新增 Network authorization/response 低基数指标并接入 Runtime observability。
2. 实现硬禁止分类器，覆盖持久化、凭据窃取、安全控制修改、跨进程注入和生产高价值目标。
3. 把 `image_operations`/web search 等窄 HTTP 路径迁移到受控 transport，减少裸网络例外。
4. 继续实现 OS 级无网边界；在此之前不宣称 shell 网络已受控。

## 第 7 轮

日期：2026-08-16  
总体进展：**18%**（较上轮 +2 个百分点）  
完全验收：**0 / 30**  
当前阶段：不可覆盖 Hard Deny 与低基数安全指标

### 本轮完成

- `ActionProposal` 新增结构化 `effect_categories`，并纳入 append-only 持久化和 legacy SQLite schema 自动迁移。
- Profile `hard_denies` 同时匹配 operation 和 effect category，下层策略只能增加拒绝项。
- 新增版本化 `HardDenyPolicy hard-deny/1`，系统强制类别包括：安全控制篡改、凭据窃取、宿主持久化、跨进程注入、关闭审计和宿主控制面访问。
- Mandatory Hard Deny 在 Authorization Grant 签发之前执行，并在 Effect claim 时再次执行，防止等待期间策略变化或旧 Grant 绕过。
- 三种权限模式使用相同硬禁止层；测试证明 `manual_safe`、`auto_reviewed`、`isolated_full_access` 即使拥有相同全集能力也不能签发危险 Grant。
- 对明确 operation 名提供确定性映射；对 `schtasks/sc/reg Run`、`wevtutil/auditpol`、LSASS dump 和 mimikatz 提供 argv 级纵深检测。
- 命令检测不是沙箱替代品；无法结构化识别的 shell 仍须依赖 effect category 和 P0 隔离边界。
- Hard Deny 事件写入链式安全审计，仅包含 category、reason code、policy version 等脱敏事实。
- 新增 `SecurityMetricsCollector`，从已验证安全事件链投影固定指标。
- Metrics label 仅允许固定 `status/action/status_class/credential/category/valid`；未知攻击者输入统一折叠为 `unknown`，防止高基数和秘密泄漏。
- Runtime 增加内部 `security_metrics_snapshot()` 窄接口，不改变 TUI、WebUI、Android 或 OAEP 协议。

### 功能点进展

| 功能点 | 进度 | 累积证据 | 尚缺验收 |
|---|---:|---|---|
| P0-F01 不可变能力配置 | 70% | Profile/Proposal/category 持久化、schema 迁移和摘要 | 所有 Run 自动解析、属性测试、组织策略接入 |
| P0-F03 进程与资源隔离 | 45% | Windows Job 边界；受限 token fail closed | 受限 worker、AppContainer、句柄与逃逸 E2E |
| P0-F04 网络出口边界 | 50% | 受控 HTTP、DNS/IP/peer/redirect 重验 | OS 级 socket 阻断、真实 TLS E2E |
| P0-F05 凭据与环境隔离 | 70% | 引用 lease、一次性 transport 注入与清零 | 真实工具接入、全日志/崩溃扫描 |
| P0-F06 不可覆盖硬禁止层 | 60% | 版本化 mandatory categories、Grant+Effect 双重执行、三模式不可覆盖、命令纵深规则 | 全工具 category 注册、完整攻击语料、真实后端绕过测试和管理员变更流程 |
| P0-F07 精确绑定 | 70% | Proposal/Profile/Grant/Effect/attestation/network 精确绑定 | 所有真实执行路径重验、全链路迁移 |
| P0-F09 安全回执与可观测性 | 80% | 链式审计、篡改验证、固定低基数指标、Runtime 内部快照 | SLO/告警、导出、跨日志锚定与压力测试 |
| P0-F10 迁移/fail-closed | 45% | 各后端缺失拒绝、Hard Deny 前置、裸调用门禁 | 清零例外、发布路径全面接管、打包验收 |
| P1-F06 Exactly-once Grant/副作用 | 45% | Effect/credential 原子单次语义 | 外部幂等/补偿、主 Runtime 迁移和 fault injection |
| 其余 21 项 | 0% | 尚无足够验收证据 | 按三份方案推进 |

折算：`(70 + 45 + 50 + 70 + 60 + 70 + 80 + 45 + 45) / (30 × 100) = 17.83%`，显示为 18%。

### 本轮测试

- Hard Deny 与 Metrics 专项：35 passed。
- Runtime/安全域组合：66 passed。
- 覆盖三模式不可覆盖、六类 mandatory category、受保护 operation、argv 变形、schema 迁移、审计事件和 100 个攻击者 label 折叠。

### 下一轮

1. 为现有工具注册表生成/校验 effect category，未知副作用工具 fail closed。
2. 实现 P1 标准 Proposal/ApprovalDecision 服务与独立状态机，先以兼容 adapter 接现有 Runtime。
3. 将 deny 变为工具级结果而非 Run 取消的兼容路径，保持旧客户端可消费。
4. 扩展 fault injection，验证 Policy 在等待期间收紧后不能签发/消费 Grant。

## 第 8 轮

日期：2026-08-16  
总体进展：**26%**（较上轮 +8 个百分点）  
完全验收：**0 / 30**  
当前阶段：P1 Approval 独立事实模型与 operation-level blocking

### 本轮完成

- 新增独立 `backend.runtime.authorization` 包，不依赖 Agent Core 或客户端协议。
- 新增 `runtime_approval_requests` 和 append-only `runtime_approval_decisions`；与旧 `runtime_approvals` 并行存在，未改变旧客户端行为。
- Approval Request 精确绑定 Proposal、Run、Profile digest、policy version、reviewer kind、reason、deadline 和 idempotency key。
- Approval Decision 只记录 reviewer 的 approved/denied/cancelled 事实；不修改 Run、Effect、checkpoint、journal item 或 manifest。
- Request 支持 `pending/approved/denied/cancelled/expired`；终态不可反转，Decision 表禁止 update/delete。
- 重复同值/同 idempotency key 返回同一 Decision；相同 key 不同内容明确冲突。
- 32 路并发 approve/deny 由 `BEGIN IMMEDIATE + status='pending'` 数据库约束保证只有一个赢家和一条 Decision。
- 同 Run 支持多个 pending Request，10 个 Proposal 可乱序决定且互不串权。
- deadline 到达生成 `system/expired` Decision；reviewer 断线没有隐式批准或拒绝，Request 保持 pending 到过期/撤销。
- 新增 `PolicyDecisionService`，分别输出 `allow_without_review/require_reviewer/capability_denied/hard_deny`；Policy 结果与 Approval 事实分离。
- Policy 在当前 Profile 上重新检查 capability 和 mandatory hard deny；等待期间 Profile 收紧会得到 capability denied。
- 新增纯 `RunApprovalProjection`：只有“无 runnable step 且存在 pending”才投影 `waiting_approval`。
- deny/cancel/expired 生成 `run_action=continue` 的结构化工具结果；取消 Run 是独立 `run_command`。
- RuntimeEngine 新增内部 P1 request/decision 入口；测试证明 operation denial 前后 Run 均保持 `running`。
- TUI、WebUI、Android、OAEP 仍使用旧协议，本轮没有客户端改动。

### 功能点进展

| 功能点 | 进度 | 累积证据 | 尚缺验收 |
|---|---:|---|---|
| P0-F01 | 70% | 不变 | 见前轮 |
| P0-F03 | 45% | 不变 | 见前轮 |
| P0-F04 | 50% | 不变 | 见前轮 |
| P0-F05 | 70% | 不变 | 见前轮 |
| P0-F06 | 60% | 不变 | 见前轮 |
| P0-F07 | 70% | 不变 | 见前轮 |
| P0-F09 | 80% | Approval 事件也进入同一链式安全审计 | SLO/告警与跨日志锚定 |
| P0-F10 | 45% | 新 P1 路径并行兼容，旧客户端未受影响 | 发布路径全面迁移 |
| P1-F01 标准 Proposal | 40% | P1 Request 使用统一不可变 ActionProposal | Codex/MCP/legacy 全路径迁移和 golden contract |
| P1-F02 Policy/Approval 分离 | 45% | 独立 PolicyDecisionService 与 ApprovalService；Profile 收紧重验 | GrantService 串联、管理员/模式完整矩阵 |
| P1-F03 独立状态机 | 60% | 五状态、append-only Decision、幂等/冲突/32 并发/过期测试 | 数据库迁移、跨进程压力和最多一个 Grant |
| P1-F04 多 pending | 40% | 同 Run 10 个独立 Request、乱序决定、纯 Run 投影 | 接入实际调度分支与恢复 E2E |
| P1-F05 拒绝/取消/终止解耦 | 45% | 结构化拒绝工具结果、独立 cancel command、Runtime Run 不变测试 | 旧 `resume_on_denied` 删除和各 adapter 迁移 |
| P1-F06 Exactly-once | 45% | 前轮 Effect/Grant 事务证据 | 与 Approval Decision 串联、外部补偿/fault injection |
| 其余 16 项 | 0% | 尚无足够验收证据 | 按三份方案推进 |

折算：既有 P0/P1-F06 累积 535 分，本轮新增 `40+45+60+40+45=230` 分；`765 / (30 × 100) = 25.5%`，显示为 26%。

### 本轮测试

- Approval Service 专项：13 passed。
- RuntimeEngine + Approval Service：53 passed。
- 覆盖幂等、冲突、终态不可反转、32 路竞争、10 pending、乱序决定、deadline、reviewer mismatch、断线 fail-closed、Policy/Profile 收紧和拒绝不改变 Run。

### 下一轮

1. 实现 `GrantService`：只有 approved Decision 且 Profile/policy 未变化时才能签发一个 Grant。
2. 将 Approval Request 到 Grant 的映射设为唯一并与签发事务绑定，验证并发最多一个 Grant。
3. 定义统一 Reviewer protocol 和 Codex/TUI/OAEP 只转换协议、不拥有授权语义的 adapter contract。
4. 给 Approval 指标增加 pending latency、decision、timeout、duplicate/conflict 等低基数维度。

## 第 9 轮

日期：2026-08-16  
总体进展：**31%**（较上轮 +5 个百分点）  
完全验收：**0 / 30**  
当前阶段：Decision 到 Grant 的事务闭环与统一 Reviewer 适配协议

### 本轮完成

- 新增 `GrantService`，只有终态为 `approved` 的 Approval Request 才可能签发 Grant；denied、cancelled、expired 一律 fail closed。
- Grant 签发在一个 `BEGIN IMMEDIATE` 事务中重新读取 Request、Decision、Proposal、Capability Profile 与当前 Policy Decision，并重新执行 mandatory Hard Deny。
- Request、Decision、Grant 建立唯一映射；32 路并发签发返回同一个 Grant，数据库中只有一条映射和一条授权记录。
- 等待审批期间 Profile digest、能力、review requirement 或 policy disposition 发生变化时，旧批准不能签发 Grant，必须重新发起审查。
- 已存在且有效的 Grant 可幂等返回；不存在的 Request、未决定的 Request、过期 Request 和 reviewer/policy 不匹配全部拒绝。
- 新增版本化 `approval-review/1` Reviewer contract，以及 Codex、TUI、OAEP 三个语义一致的兼容适配器。
- Adapter 只负责展示 Request/Proposal 和提交 Decision 事实；测试确认 adapter 不创建 Grant 表、不签发 Grant，也不能修改 Run。
- 展示载荷经过脱敏和 Unicode 控制字符转义，避免终端/日志显示欺骗；协议版本、adapter kind、request id 不匹配均 fail closed。
- 新增 approval requested、approval decision、authorization grant issued 三类低基数指标；标签只允许固定 reviewer kind 和 decision 枚举，不暴露标识符或资源。
- 本轮只增加内部服务和兼容 contract，没有切换 Agent Core、TUI、WebUI、Android 或 OAEP 的现有调用路径。

### 功能点进展

| 功能点 | 进度 | 累积证据 | 尚缺验收 |
|---|---:|---|---|
| P1-F02 Policy/Approval 分离 | 65% | Grant 签发时重跑当前 Profile、Policy 与 Hard Deny | 管理员/组织策略矩阵、实际入口全迁移 |
| P1-F03 独立状态机 | 75% | Request/Decision/Grant 唯一映射与 32 路并发至多一个 Grant | 数据库升级/回滚、跨进程和长时压力测试 |
| P1-F06 Exactly-once | 65% | Decision→Grant 原子唯一映射，已有 Effect/credential 单次语义 | 外部副作用幂等/补偿与逐点 fault injection |
| P1-F07 多适配器统一 | 40% | Codex/TUI/OAEP 使用同一版本化 envelope 和决定语义 | 实际客户端接线、golden wire contract、兼容发布 |
| P1-F08 安全展示 | 45% | 脱敏、控制字符转义、协议/标识错配拒绝 | 各真实 UI 快照、截断策略与人工可读性验收 |
| P1-F10 Approval 可观测性 | 25% | 请求、决定、Grant 的低基数计数与审计完整性 | pending latency、timeout、冲突率、SLO/告警与仪表盘 |
| 其余既有功能点 | 不变 | 见前轮 | 继续按三份方案推进 |

折算：上轮累计 765 分；本轮增加 `20+15+20+40+45+25=165` 分；`930 / (30 × 100) = 31%`。

### 本轮测试

- 新增 Grant/Reviewer 专项：12 passed。
- Metrics 与 Grant/Reviewer 组合：14 passed。
- Runtime、Authorization、安全边界、Network、Windows Job、Codex security 综合回归：201 passed、1 skipped、12 subtests passed。
- 覆盖 32 路并发唯一 Grant、拒绝/取消/过期无 Grant、Profile/Policy/Hard Deny 等待期变化、审计、三个 adapter 语义一致、控制字符转义和断线/错配 fail closed。

### 下一轮

1. 给 RuntimeEngine 增加内部 Decision→Grant 编排入口，但继续保留旧客户端路径并做双轨兼容测试。
2. 为 Reviewer protocol 建立 golden JSON fixtures、schema migration 与向前/向后兼容测试。
3. 补齐 pending latency、timeout、duplicate/conflict 指标与 SLO；验证指标中不出现 run/request/user/resource 标识。
4. 回到 P0 Windows 真隔离缺口，优先解决 restricted token error 87，并实现 worker 启动、外部路径 canary 和 socket 绕过 E2E。

## 第 10 轮

日期：2026-08-16  
总体进展：**33%**（较上轮 +2 个百分点）  
完全验收：**0 / 30**  
当前阶段：Runtime 内部 Grant 编排、Reviewer wire contract 与 Approval SLO 基础

### 本轮完成

- RuntimeEngine 新增内部 `issue_authorization_grant()` 编排入口：先读取 Request 和当前 Run，再以 Run 当前绑定的 Capability Profile 调用 GrantService。
- 调用者传入的旧 Profile 快照与当前 Run Profile 不一致时立即拒绝；不能通过保留旧对象绕过等待期间的策略收紧。
- 内部编排保持 operation-level 语义：批准、签发和幂等重取 Grant 都不会改变 Run 状态。
- Runtime 初始化 GrantService，但未替换旧 Approval API，也未修改 Agent Core、TUI、WebUI、Android 或 OAEP 的现有调用路径。
- Reviewer request/decision 新增确定性 canonical JSON 序列化；相同 envelope 在不同进程和 adapter 中产生稳定 wire representation。
- 新增严格 Decision parser：64 KiB 上限、JSON object、精确字段集、协议版本、adapter、decision 枚举和非空 identity 校验；畸形、未知版本和额外字段均 fail closed。
- 新增 golden wire contract，锁定 `approval-review/1` 的字段、排序、脱敏展示、一次性 scope 与往返稳定性。
- Approval 指标增加固定桶 decision latency 和 pending age，以及 duplicate/conflict 计数。
- 重复幂等决定和同 key 不同内容冲突进入链式安全审计；指标标签仍只使用固定 reviewer kind、decision 和时间桶，不包含 Request/User/Run/Resource ID。

### 功能点进展

| 功能点 | 进度 | 累积证据 | 尚缺验收 |
|---|---:|---|---|
| P1-F01 标准 Proposal/contract | 50% | 不可变 Proposal、canonical digest、Reviewer golden JSON | Codex/MCP/legacy 全路径迁移和完整 contract suite |
| P1-F02 Policy/Approval 分离 | 70% | Runtime 只经 GrantService 签发；当前 Profile/Policy/Hard Deny 重验 | 组织策略矩阵与所有真实执行入口接管 |
| P1-F06 Exactly-once | 70% | Runtime 幂等重取唯一 Grant，既有原子 Effect claim | 外部副作用恢复/补偿和逐点崩溃注入 |
| P1-F07 多适配器统一 | 55% | 三 adapter 共享 canonical wire schema、strict parser 和 golden case | 实际客户端接线、跨客户端接力 E2E、版本升级策略 |
| P1-F08 安全展示 | 55% | 脱敏、控制字符转义、wire 大小/字段约束 | 真实 UI 快照、路径/命令差异可读性与截断提示 |
| P1-F10 Approval 可观测性 | 50% | 请求/决定/Grant、pending age、decision latency、timeout、duplicate/conflict | Grant 未使用率、adapter 故障、SLO/告警/仪表盘 |
| 其余既有功能点 | 不变 | 见前轮 | 继续按三份方案推进 |

折算：上轮累计 930 分；本轮增加 `10+5+5+15+10+25=70` 分；`1000 / (30 × 100) = 33.33%`，显示为 33%。

### 本轮测试

- Runtime operation-level Grant 接线：3 passed。
- Authorization、Approval、Metrics、Runtime 专项：45 passed。
- 安全相关综合回归：209 passed、1 skipped、12 subtests passed。
- 覆盖当前 Profile 防绕过、唯一 Grant 幂等返回、Run 状态不变、golden wire 往返、未知协议/非法枚举/超大载荷拒绝、pending/latency 固定桶与 duplicate/conflict 审计。

### 下一轮

1. 实现 P1 数据迁移/兼容视图：从旧 `runtime_approvals` 安全投影历史和 pending 项，迁移必须可重入、可中断恢复且不伪造 reviewer Decision。
2. 为新旧 Approval 双轨增加使用遥测和明确删除门禁；仍不切换现有客户端。
3. 补 Reviewer schema 的版本协商与跨 adapter 接力测试，并加入 adapter failure 指标。
4. 推进 P0 restricted worker 真启动与外部路径/网络 canary E2E；在 OS 边界通过前保持 fail closed。

## 第 11 轮

日期：2026-08-16  
总体进展：**36%**（较上轮 +3 个百分点）  
完全验收：**0 / 30**  
当前阶段：P1 旧 Approval 数据迁移、兼容视图与退役门禁

### 本轮完成

- 新增 `LegacyApprovalMigrationService legacy-approval/1`，逐行独立事务迁移旧 `runtime_approvals`，支持 limit 分批执行和 Runtime 重启后续跑。
- 迁移使用确定性 Request ID、source identity digest 和 append-only source revision；重复执行返回 already migrated，不产生重复 Request。
- 旧 pending 只有在结构化 Proposal 与 Run 当前 Capability Profile 都存在时才迁移；证据不足保持 deferred，补齐 Profile 后可重试恢复。
- 旧历史终态保留原状态，但明确使用 `legacy:historical-profile-unknown`；不伪造 reviewer Decision，因此即使旧状态为 approved 也不能签发 Grant。
- 已迁移 pending 在双轨期允许从旧控制面单向同步到一个终态；同步只追加 source revision 和审计事件，不创建 reviewer Decision。
- 禁止旧请求身份字段变化、终态反转和第二次不同终态；检测到此类变化时迁移 fail closed。
- 新增只读 `runtime_approval_compat_v1`，统一投影 legacy 与 native 条目，并显式显示 `native/migrated/deferred` 来源状态。
- 新增旧路径 requested/resolved 使用遥测，写入既有链式安全审计，不记录请求内容、决定 detail 或用户标识。
- 新增显式 legacy retirement gate：存在未迁移记录、pending 或 quiet cutoff 之后仍有旧路径调用时均不可删除旧控制面。
- RuntimeEngine 只增加内部 migrate、compatibility read 和 retirement status 入口；旧 Approval API、Agent Core 与各客户端协议保持不变。

### 功能点进展

| 功能点 | 进度 | 累积证据 | 尚缺验收 |
|---|---:|---|---|
| P1-F03 独立状态机 | 80% | 迁移可重入、跨重启续跑、终态单向同步、数据库约束 | 大规模跨进程压力与正式升级/回滚演练 |
| P1-F09 数据迁移与兼容视图 | 70% | 分批迁移、deferred 恢复、历史无伪造 Decision、只读视图、identity tamper 拒绝、退役门禁 | 真实旧库 fixture、版本回滚、发布双写周期和客户端切换 |
| P1-F10 Approval 可观测性 | 60% | 增加旧路径 requested/resolved 使用审计与 quiet-period gate | adapter 故障、Grant 未使用率、SLO/告警/仪表盘 |
| 其余既有功能点 | 不变 | 见前轮 | 继续按三份方案推进 |

折算：上轮累计 1000 分；本轮增加 `5+70+10=85` 分；`1085 / (30 × 100) = 36.17%`，显示为 36%。

### 本轮测试

- Legacy migration 专项：8 passed（其中本轮新增 5 个核心迁移场景，另含既有 legacy 兼容测试）。
- 安全相关综合回归：214 passed、1 skipped、12 subtests passed。
- 覆盖 pending 无 Decision、旧批准无 Grant、分批迁移跨重启、deferred 后恢复、pending 单向终态同步、身份篡改、只读视图和 quiet-period 退役门禁。

### 下一轮

1. 使用真实旧版数据库 fixture 做 schema upgrade/rollback 演练，并补大量记录与并发迁移 fault injection。
2. 实现 reviewer adapter failure 与 Grant unused 指标，形成能区分 reviewer、Policy、Grant、Executor 卡点的 SLO 快照。
3. 开始 P2 三权限模式的版本化 ModeDefinition/EffectiveProfile 服务，先保持内部并行路径，不切换客户端。
4. 继续 P0 Windows restricted worker：修复 token 创建参数并做进程身份、外部路径 canary 与直接 socket 绕过验收。

## 第 12 轮

日期：2026-08-16  
总体进展：**46%**（较上轮 +10 个百分点）  
完全验收：**0 / 30**  
当前阶段：P2 三权限模式稳定契约、Effective Profile 与安全切换基础

### 本轮完成

- 新增独立 `backend/runtime/permission_modes`，不依赖 Agent Core 或客户端本地枚举。
- 固化 `permission-mode/1` 三种内置 ModeDefinition：`manual_safe`、`auto_reviewed`、`isolated_full_access`，包含稳定 descriptor digest、默认能力、能力上限、reviewer route、强制人工类别、隔离要求和跨工作区默认约束。
- 未知 mode/schema version 一律 fail closed 并提示升级；三模式 descriptor 由 Runtime 唯一来源输出。
- 新增 `PermissionProfileResolver`，按系统硬禁止、管理员、平台、工作区信任、模式和会话请求逐层取交集，生成实际 `EffectivePermissionProfile`。
- 管理员策略必须 verified；下层请求不能扩大 capability、network、credential 或 hard-deny 上限，并通过组合测试验证集合单调性。
- Agent、repository、workspace config、tool 均不得作为选模来源；不可信工作区强制解析为 `manual_safe` 最小能力。
- `isolated_full_access` 要求明确确认和当前有效 IsolationAttestation；不得保存为个人跨工作区默认，也不回退宿主裸执行。
- `auto_reviewed` 内置不可逆外部写、身份/权限变化、生产目标、敏感凭据首次使用、范围扩大、Proposal 不完整和低置信度强制人工类别；管理员只能增加类别。
- 新增 append-only `runtime_permission_mode_bindings` 和 `PermissionModeService`，持久化实际生效 descriptor、Profile digest、选择来源、前序 binding 与 transition kind。
- 模式提权或 mixed transition 必须明确确认；降权即时撤销该 Run 所有未消费 Grant，并以 system Decision 取消所有 pending Request。
- Authorization Grant schema 新增 `revoked_at`；消费时重验撤销状态，模式切换撤销事件进入链式安全审计。
- 模式相同的版本更新不撤销 Grant；Profile 版本继续单调增长，历史 binding/receipt 保留当时 digest。
- RuntimeEngine 仅增加内部 descriptor、apply 和 effective preview 入口；Run 状态、Agent Core 和现有 TUI/WebUI/Android/OAEP 协议不变。
- 新增模式采用/切换与 Grant 撤销低基数指标；标签严格限制为三种 mode、五种 transition 和三个可信 selection source。

### 功能点进展

| 功能点 | 进度 | 累积证据 | 尚缺验收 |
|---|---:|---|---|
| P2-F01 三 Profile 稳定契约 | 55% | 稳定 schema/ID/digest、能力矩阵、reviewer route、Runtime 单一 descriptor | 各客户端 contract suite 与版本协商发布 |
| P2-F02 请求批准模式 | 30% | manual_safe 最小默认、human route、P0 Profile/Grant/Approval 绑定 | 文件/shell/network/MCP/委派/计划/外部写全矩阵与 UI |
| P2-F03 帮我批准模式 | 20% | auto route 与强制人工类别稳定契约 | AutoReviewer、对抗语料、离线评测、模型故障回退和发布阈值 |
| P2-F04 隔离完全访问 | 35% | 明确确认、attestation 验证、过期/缺失拒绝、不可设默认 | 真实隔离持续证明、挂载/网络/凭据变化与完整逃逸套件 |
| P2-F05 有效权限预览 | 25% | 后端 actual effective descriptor 与限制 reason | Desktop/WebUI/Android/OAEP UI、可访问性和多语言快照 |
| P2-F06 安全模式切换 | 45% | 提权确认、降权撤销 Grant、取消 pending、append-only 历史 | 全步骤单事务/崩溃恢复、AutoReviewer in-flight、父子/后台任务 E2E |
| P2-F07 工作区信任/默认 | 35% | 不可信强制 manual_safe，来源白名单，完全访问不可跨工作区默认 | Git 来源/复制移动/多人账户/同步/撤销信任 E2E |
| P2-F08 管理员组织策略 | 40% | verified gate、模式禁用、能力/网络/凭据交集、强制人工 union、组合单调测试 | 签名、最后可信缓存、撤销/冲突/旧客户端与 UI 来源解释 |
| P2-F09 旧配置迁移 | 0% | 尚未实现 | 历史值映射、损坏/冲突配置、升级回滚和一次性说明 |
| P2-F10 遥测/灰度/回滚 | 20% | 模式 transition 与 Grant revoked 低基数指标 | feature flags、AutoReviewer/full-access kill switch、回滚演练与证据面板 |

折算：上轮累计 1085 分；本轮新增 P2 累计 `55+30+20+35+25+45+35+40+0+20=305` 分；`1390 / (30 × 100) = 46.33%`，显示为 46%。

### 本轮测试

- P2 resolver、模式契约与策略交集：15 passed。
- P2 mode service、切换与 Grant 撤销：5 passed。
- P2/metrics/Runtime 专项组合：24 passed。
- 安全相关综合回归：236 passed、1 skipped、12 subtests passed。
- 覆盖未知版本、禁止 Agent/仓库选模、不可信工作区、管理员单调约束、隔离证明缺失/过期、完全访问不可默认、硬禁止不可覆盖、提权确认、降权撤 Grant/取消 pending、append-only 和低基数遥测。

### 下一轮

1. 实现 P2 AutoReviewer：确定性强制升级规则、结构化 approve/deny/escalate、超时/不可用/格式错误 fail closed 和可复现审计。
2. 建立初版对抗评测 fixture，覆盖命令混淆、提示注入、外传、间接外部写、生产目标和秘密使用，先只运行离线评测，不开放客户端。
3. 将模式切换改为数据库单事务状态机，并增加逐阶段 fault injection、自动 reviewer in-flight 和父子权限不升高测试。
4. 实现 P2 旧配置安全映射与 AutoReviewer/full-access kill switch；危险旧值只回落 manual_safe，不自动映射完全访问。

## 第 13 轮

日期：2026-08-16  
总体进展：**48%**（较上轮 +2 个百分点）  
完全验收：**0 / 30**  
当前阶段：P2 AutoReviewer、离线对抗评测与独立 kill switch

### 本轮完成

- 新增 `AutoReviewerService` 与稳定 `auto-review-rules/1` 决定契约，输出仅为 `approve/deny/escalate` 建议事实，不依赖或调用 Grant/Effect 服务。
- 确定性规则优先于模型：mandatory Hard Deny、Profile capability denied、凭据窃取、安全控制篡改、数据外传和提示注入执行在模型调用前 deny。
- `auto_reviewed` 的七类强制人工项在模型调用前 escalate；“全部批准”模型无法覆盖这些规则。
- 只有不属于拒绝/强制人工/确定性安全读取的灰区才进入模型 reviewer；模型输入仅包含脱敏 Proposal、实际能力和必要策略字段。
- 模型版本必须位于管理员固定 allowlist；未知模型版本不调用模型并升级人工。
- 模型超时、异常、缺字段、非法 outcome/reason/confidence、approve 低于置信度门槛全部 fail closed 为 escalate。
- reviewer disabled 时所有请求升级人工；`manual_safe` 和 `isolated_full_access` 不会误用 AutoReviewer。
- 自动决定按 Proposal digest、Profile digest 和 idempotency key 精确绑定；同 key 跨授权范围重用拒绝。
- 新增 append-only `runtime_auto_review_decisions` 与链式审计；数据库和审计不保存原始秘密、模型上下文或 Proposal payload。
- 新增版本化 `auto-review-adversarial/1` fixture（13 cases），覆盖命令混淆、提示注入执行、数据外传、生产目标、不可逆外部写、身份/权限变化、敏感凭据、范围扩大和 Proposal 不完整。
- 新增离线 evaluator 与发布门禁证据：恶意 approve-all 模型因灰区误批而评测失败；保守模型达到 hard-deny 0、mandatory-human 0、总体 0 误批。
- 新增 AutoReviewer outcome/source/confidence 低基数指标；reason、model version、Proposal/Run/Review ID 不进入 labels。
- 管理员策略增加 AutoReviewer 和 isolated full access 两个独立 kill switch；关闭二者不影响 `manual_safe`。
- 本轮没有把 AutoReviewer 接入现有客户端，也未自动把其建议转换为 Grant；Agent Core、TUI、WebUI、Android 和 OAEP 行为不变。

### 功能点进展

| 功能点 | 进度 | 累积证据 | 尚缺验收 |
|---|---:|---|---|
| P2-F01 三 Profile 稳定契约 | 60% | 增加版本化 AutoReviewer 决定与规则契约 | 各客户端 contract suite、版本协商和正式发布 |
| P2-F03 帮我批准模式 | 60% | 规则优先、模型灰区、七类人工升级、故障 fail closed、不可变审计、版本化对抗评测 | Request/Decision 编排、真实模型离线大样本、签字阈值、人工复核和灰度 |
| P2-F10 遥测/灰度/回滚 | 35% | AutoReviewer 低基数指标、AutoReviewer/full-access 独立 kill switch | 开关传播、关闭时未消费 Grant 失效、灰度证据面板和生产回滚演练 |
| 其余既有功能点 | 不变 | 见前轮 | 继续按三份方案推进 |

折算：上轮累计 1390 分；本轮增加 `5+40+15=60` 分；`1450 / (30 × 100) = 48.33%`，显示为 48%。

### 本轮测试

- AutoReviewer 专项：21 passed。
- P2/AutoReviewer/Metrics 组合：42 passed。
- 安全相关综合回归：259 passed、1 skipped、12 subtests passed。
- 对抗集 13 cases：恶意模型按预期未过发布门禁；保守模型 hard-deny、mandatory-human 和总体误批均为 0。
- 覆盖规则不可覆盖、七类强制升级、能力越界、模型超时/异常/非法格式/未固定版本/低置信度、幂等与跨 scope 冲突、秘密不落库、append-only、kill switch 和低基数指标。

### 下一轮

1. 实现 AutoReviewer 与 P1 Approval Request 的幂等编排：approve/deny 写 Decision，escalate 原子关闭 auto request 并创建 human request，始终不直接签 Grant。
2. 将模式切换改造成数据库可恢复状态机，加入每个故障点的 crash/fault injection；确保切换中间态只会更保守。
3. 实现旧 `always/never/auto-*`、dangerous 配置安全迁移；无法证明安全的值全部进入 manual_safe 并产生一次性解释。
4. 扩展对抗集和离线评测报告，加入 fixture digest、策略/模型版本、误拒/升级率及可签字发布证据。

## 第 14 轮

日期：2026-08-16  
总体进展：**52%**（较上轮 +4 个百分点）  
完全验收：**0 / 30**  
当前阶段：AutoReviewer→P1 Approval 可恢复编排与旧权限配置安全迁移

### 本轮完成

- 新增 `AutoReviewCoordinator`，其依赖只有 AutoReviewer 与 ApprovalService，模块层面不能访问 GrantService 或 EffectExecutor。
- auto `approve` 只写 reviewer_kind=`auto` 的 approved Decision；auto `deny` 只写 denied Decision；二者均不签发 Grant、不修改 Run。
- auto `escalate` 使用 system cancelled Decision 关闭原 auto Request，并为相同 Proposal/Profile/Policy 创建唯一 human pending Request。
- escalation 不把 auto 建议伪装成人类批准；human Request 在用户决定前没有 Decision，也没有 Grant。
- 新增 durable `runtime_auto_review_routes` 与 append-only route events，状态分为 reviewed/applied，可从“review 已写”“Decision 已写”或“human Request 已建”的崩溃点幂等恢复。
- route 精确绑定 Request、AutoReview Decision 和 idempotency key；同 key 跨 scope/route 重用 fail closed。
- 32 路并发重试只产生一个 AutoReview、一个 route、一个 Approval Decision 和两条 route phase event。
- Profile 在 review 前变化、非 auto Request、终态竞争或 Decision 内容冲突均拒绝，不会隐式扩大权限。
- 新增 `LegacyPermissionConfigMigrationService permission-config-migration/1`，覆盖 `always/ask/on-request/manual`、保守 auto、permissive、never、dangerous、full-access、bypass、损坏值和多来源冲突。
- 只有保守 auto 值可映射 `auto_reviewed`；`never`、dangerous、full-access、unrestricted、auto-permissive 等危险值全部回落 `manual_safe` 并要求重新选择，绝不自动进入 `isolated_full_access`。
- repository/workspace executable config 不是可信选模来源：值被忽略并记录一次性原因；可信个人值不会被仓库覆盖。
- 多个可信来源冲突、未知值、非字符串或缺少可信来源均回落 `manual_safe` 并要求重新选择。
- 迁移持久化只记录 source/value digest 与固定分类，不保存攻击者原始配置文本；migration key 幂等且跨输入复用拒绝。
- 一次性迁移说明支持 acknowledge；确认事实链式审计且重复确认不重复记事件。
- RuntimeEngine 新增内部配置迁移/确认入口，但迁移结果不会自动应用到 Run，避免升级时静默改变权限。
- 增加 auto route、route applied 和配置迁移低基数指标；Request/Review/Migration ID 和 reason 文本不进入 labels。
- Agent Core、TUI、WebUI、Android、OAEP 继续使用原路径，本轮无客户端协议切换。

### 功能点进展

| 功能点 | 进度 | 累积证据 | 尚缺验收 |
|---|---:|---|---|
| P1-F03 独立 Approval 状态机 | 85% | 增加 Auto route reviewed/applied 恢复状态与 32 并发唯一终态 | 跨进程长压、完整故障矩阵和发布迁移 |
| P1-F07 Reviewer/adapter 协议 | 65% | AutoReviewer 建议经统一 Approval Decision/human escalation API，不可直接 Grant | 真实客户端接力、Android/OAEP/Codex 全 contract suite |
| P2-F03 帮我批准模式 | 75% | Auto approve/deny/escalate 可恢复编排、Profile 重验、并发唯一、人类升级 | 真实模型大评测、签字阈值、客户端/人工复核 E2E 与灰度 |
| P2-F09 旧配置迁移 | 70% | 23 类/场景映射、危险值不提权、来源冲突/损坏/仓库注入、幂等、一次性说明 | 真实历史版本 fixture、设置同步、升级/回滚和客户端只读迁移 UI |
| P2-F10 遥测/灰度/回滚 | 45% | route/config migration 指标与既有两个 kill switch | 开关传播、kill 时 Grant 撤销、证据面板和生产回滚演练 |
| 其余既有功能点 | 不变 | 见前轮 | 继续按三份方案推进 |

折算：上轮累计 1450 分；本轮增加 `5+10+15+70+10=110` 分；`1560 / (30 × 100) = 52%`。

### 本轮测试

- AutoReviewer→Approval coordinator：6 passed。
- 旧权限配置迁移：22 passed。
- coordinator/config migration/metrics 专项组合：34 passed。
- 安全相关综合回归：289 passed、1 skipped、12 subtests passed。
- 覆盖 auto approve/deny 无 Grant、escalate 唯一 human Request、32 并发、Decision 后崩溃恢复、Profile/reviewer 错配、危险值不映射 full access、仓库注入、冲突/损坏值、秘密不落库和一次性说明。

### 下一轮

1. 把模式切换重构为数据库可恢复 transition journal，逐阶段 fault injection 验证崩溃后只会更保守并可自动完成/回滚。
2. 实现 AutoReviewer/full-access kill switch 激活时批量撤销相关未消费 Grant、取消/升级 pending，并记录传播确认。
3. 增加父子 Agent EffectiveProfile 继承服务，证明子 Agent 能力、网络、凭据和 reviewer 自主性均不高于父级。
4. 回到 P0 Windows restricted worker 真边界，解决 token error 87 并执行身份、文件系统、socket 和进程树 canary。

## 第 15 轮

日期：2026-08-16  
总体进展：**55%**（较上轮 +3 个百分点）  
完全验收：**0 / 30**  
当前阶段：可恢复模式切换、kill switch 实际撤权与父子权限单调继承

### 本轮完成

- `PermissionModeService` 从顺序调用升级为 durable transition journal，阶段为 `revoked → requests_cancelled → profile_bound → committed`。
- transition 身份精确绑定 Run、目标 Effective digest、目标 Profile digest/version、前序 binding 和 transition kind；同 Run 同时最多一个未完成 transition。
- 切换创建与旧未消费 Grant 撤销在同一 SQLite 事务提交；不存在“transition 已可见但旧 Grant 尚未撤销”的窗口。
- transition 未 committed 时，AuthorizationGrantStore、GrantService、Grant consume 和 EffectExecution claim 全部拒绝新授权或消费。
- 修复 Effect claim 原子路径此前未重验 `revoked_at` 的真实缺口；更新 Grant 消费使用 `revoked_at IS NULL` 条件更新。
- pending Request 取消、Profile 保存/绑定和最终 binding commit 均幂等；Profile 已绑定但阶段未更新时，重启可识别相同 digest 并继续。
- 为 `revoked`、`requests_cancelled`、`profile_bound` 三个持久阶段加入故障注入；每个阶段崩溃后旧 Grant 已不可执行、新 Grant 不可签发，重启可完成为唯一 binding。
- 新增 append-only transition events 与链式 transition started/changed/Grant revoked 审计。
- 新增 `PermissionKillSwitchService`，持久化 AutoReviewer 与 isolated full access 两个独立 append-only 开关事件。
- kill switch 激活事实先提交；从该时刻起 Grant issue、consume、Effect claim 同步拒绝，随后批量撤销受影响模式的未消费 Grant并取消 pending Request。
- kill switch 传播可重试；即使首次传播中断，开关 gate 已阻止执行，重试会补齐撤权与取消。
- 关闭 kill switch 不恢复旧 Grant、Decision 或 pending；只允许后续在当前策略下重新 Proposal/Review/Grant。
- active switch 阻止再次选择受影响模式，但 `manual_safe` 始终可用。
- 新增 `ChildPermissionResolver`：子 Agent capability、network、credential、writable roots 均取父级交集；workspace trust 不高于父级。
- 子级 reviewer 自主性高于父级时强制夹紧到父级 route/mode；hard denies 和 mandatory human categories 取并集，只能增加限制。
- 子工作区写根不在父级授权根中时不继承写根；组合测试覆盖所有子 capability 子集请求。
- 父子继承事实 append-only 持久化，绑定 parent/child Run、父 Effective digest、子 Profile/Effective digest 和 clamped dimensions。
- 修复多 Run 同 mode 时 Profile `(profile_id,version)` 可能冲突：持久化 Profile ID 现绑定 Run ID 的不可逆摘要。
- RuntimeEngine 新增内部 kill switch 与 child inheritance 管理入口；现有客户端协议未切换。
- 新增 transition started、kill switch change/propagation、permission inheritance 低基数指标，所有 Run/Profile/transition/parent ID 均不进入 label。

### 功能点进展

| 功能点 | 进度 | 累积证据 | 尚缺验收 |
|---|---:|---|---|
| P0-F07 精确绑定 | 75% | Grant/Effect 增加 transition、kill switch、revoked_at 最终执行重验 | 所有真实工具执行入口迁移与全链路绕过测试 |
| P1-F06 Exactly-once | 75% | Effect claim 原子重验撤销/transition/kill，条件消费不接受 revoked Grant | 外部副作用补偿、跨进程 crash matrix 与 outcome_unknown 运维流程 |
| P2-F06 安全模式切换 | 75% | 四阶段 journal、起始原子撤权、全执行入口 gate、三阶段 fault recovery | AutoReviewer in-flight、断线/后台/计划任务 E2E 和大并发压力 |
| P2-F07 工作区信任/继承 | 60% | 子能力/网络/凭据/写根/reviewer 单调夹紧、hard deny/人工项并集 | Git 来源变化、复制移动、多人账户、信任撤销传播和真实子 Agent 接线 |
| P2-F10 遥测/灰度/回滚 | 65% | 两 kill switch 持久状态、执行 gate、批量撤权、可重试传播、低基数指标 | 分布式开关传播确认、证据面板、生产演练与 SLO |
| 其余既有功能点 | 不变 | 见前轮 | 继续按三份方案推进 |

折算：上轮累计 1560 分；本轮增加 `5+5+30+25+20=85` 分；`1645 / (30 × 100) = 54.83%`，显示为 55%。

### 本轮测试

- transition fault injection、kill switch、父子继承组合：17 passed。
- Grant/Effect/transition/kill/inheritance 专项回归：62 passed。
- 安全相关综合回归：303 passed、1 skipped、12 subtests passed。
- 覆盖三处持久崩溃点、transition 中 Grant 全入口阻断、Effect revoked 绕过、kill 批量撤权/取消/重试/关闭不恢复、manual_safe 可用，以及父子 capability/network/credential/root/reviewer/hard-deny 单调性。

### 下一轮

1. 回到 P0 Windows：定位 `CreateRestrictedToken` error 87 的参数/结构问题，实现受限 token 真 worker 启动与身份 attestation。
2. 为 Windows worker 增加外部路径读写、注册表/命名管道/句柄继承、直接 socket 与子进程逃逸 canary；任一缺口保持 backend unavailable。
3. 将 P2 child inheritance 接入真实 Agent 调度边界，但继续让 Agent Core 只消费 resolved profile，不承担选模逻辑。
4. 增加 kill switch 与模式切换的跨进程压力测试和传播 SLO，建立可查询的未完成 transition/propagation 健康快照。

## 第 16 轮

日期：2026-08-16  
总体进展：**57%**（较上轮 +2 个百分点）  
完全验收：**0 / 30**  
当前阶段：Windows 非管理员 Low Integrity primary token 与真实 worker；文件/网络边界反证

### 本轮完成

- 对 `CreateRestrictedToken` 做逐 flag 诊断：flags 0、`DISABLE_MAX_PRIVILEGE`、`SANDBOX_INERT`、`LUA_TOKEN`、`WRITE_RESTRICTED` 及组合在本机均返回 Win32 error 87；pywin32 交叉验证同样返回 87。
- 证明确认该错误不是某个 flag 组合造成；当前宿主调用者是已隔离的非管理员 `CodexSandboxOffline` 账户，只有 `SeChangeNotifyPrivilege` 启用。
- 新增严格 fallback：只有源 token 已验证 non-elevated 且非 Administrators member 时，才允许 `DuplicateTokenEx` 生成 primary token；管理员/高权源 token 绝不使用 fallback。
- fallback token 随后使用 `AdjustTokenPrivileges(disableAll=True)` 禁用全部 privilege，并通过 `SetTokenInformation(TokenIntegrityLevel)` 降为 Low Integrity `S-1-16-4096`。
- 任一 Duplicate、privilege、SID、integrity 或最终 inspection 步骤失败都会关闭 token 并 fail closed。
- Token group 验证从不适用于显式 primary token 的 `CheckTokenMembership` 改为直接读取 `TokenGroups`，结合 `EqualSid`、ENABLED 与 DENY_ONLY attributes 判断管理员成员资格。
- 本机真实结果：elevated=false、administrator_member=false、enabled_privilege_count=0、integrity RID=4096、fallback restriction evidence flag 已记录。
- 新增 `WindowsRestrictedWorkerLauncher`：用受限 primary token 调用 `CreateProcessAsUser`，进程以 suspended 状态创建，先加入带 kill-on-close/进程数/内存限制的 Job Object，再恢复线程。
- 真实 worker 基础启动通过；token evidence 与 worker PID/exit status 一起返回，token、process/thread 和 Job handles 在所有路径关闭。
- Low Integrity 中等完整性写 canary 通过：worker 无法覆盖父进程创建的 medium-integrity 文件。
- 显式环境 canary 通过：宿主 secret 环境变量没有进入 worker。
- Job Object 既有真实测试继续覆盖 suspended assignment、超时杀死后代、active process limit 和显式环境。
- 文件系统负向 canary 明确失败边界：Low Integrity worker 仍能读取工作区外普通文件，因此 Low Integrity 不是 filesystem projection。
- 网络负向 canary明确失败边界：受限 worker 可用系统 `curl.exe` 直接连接本机 loopback 服务，因此 token restriction 不提供 network egress isolation。
- Python/PowerShell 通用 worker 在 Low Integrity 环境中尚不能可靠启动（Python exit 1；PowerShell `0xC0000142` DLL init failure），当前只证明基础系统 worker 身份链路，未宣称通用工具可用。
- Windows backend 可独立记录已验证 `non_admin_identity` 与 `process_tree_controlled`，但缺少 filesystem/network 等保证时 `IsolationAttestation.validate()` 仍拒绝。
- `WindowsRestrictedProcessBackend.execute()` 继续返回 `windows_isolation_not_enforced`；P2 `isolated_full_access` 仍不能基于本轮部分证明开放。

### 功能点进展

| 功能点 | 进度 | 累积证据 | 尚缺验收 |
|---|---:|---|---|
| P0-F02 文件系统边界 | 10% | medium write 拒绝与 external-read 反证 canary，边界缺口已可重复检测 | AppContainer/ACL 投影或独立账户文件系统、读写/重解析点/设备路径逃逸套件 |
| P0-F03 进程/资源隔离 | 70% | 真实 non-admin Low token primary worker、禁用 privilege、Low IL、suspended Job assignment、后代/资源限制 | 通用 worker 启动、句柄继承/命名对象/注册表/跨进程访问完整逃逸套件 |
| P0-F10 迁移/fail-closed | 55% | CreateRestricted 不可用时严格限定 fallback；文件/网络缺口使 backend 继续 unavailable | 打包环境验证、异常主机矩阵、无 fallback 高权测试与发布门禁 |
| P2-F04 隔离完全访问 | 45% | non-admin identity 与 process tree 可独立证明，缺项 attestation 仍拒绝 | filesystem/network/credential/mount/snapshot 全保证和持续健康证明 |
| 其余既有功能点 | 不变 | 见前轮 | 继续按三份方案推进 |

折算：上轮累计 1645 分；本轮增加 `10+25+10+10=55` 分；`1700 / (30 × 100) = 56.67%`，显示为 57%。

### 本轮测试

- Windows restricted token/worker 专项：6 passed。
- Windows token、Job、Sandbox 组合：35 passed。
- 安全相关综合回归：310 passed、1 skipped、12 subtests passed。
- 覆盖 token 创建/inspection、真实 worker、Low IL 写拒绝、环境清理、外部读反证、直接 socket 反证、Job 后代/资源控制、partial attestation 仍 fail closed。

### 下一轮

1. 评估 Windows AppContainer（优先）或独立低权限 worker 账户，建立真正的 workspace-only 文件可见性与 default-deny socket 边界。
2. 为 AppContainer 构造 capability SID、workspace ACL projection、无网/受控网络 profile，并以同一 canary 套件要求外部读与 direct socket 从“反证成功”变为“逃逸失败”。
3. 解决 Low Integrity Python/工具运行时依赖：明确只读 runtime mount、DLL/stdlib 可读与 workspace 单独可写，不通过提高 integrity 绕过。
4. 增加句柄继承、注册表写、命名管道、reparse point、设备路径和 Job breakaway canary；全部通过后才为 backend 添加 filesystem/network guarantees。

## 第 17 轮

日期：2026-08-16  
总体进展：**58%**（较上轮 +1 个百分点）  
完全验收：**0 / 30**  
当前阶段：Windows handle-backed 文件 Broker；AppContainer 运行环境门禁

### 本轮完成

- 按 P0 方案优先验证 AppContainer 路径；本机 `CreateAppContainerProfile` 生命周期探测返回 `0x80070002`，未把 API export 存在误判为 profile 可运行，也未退回宿主裸执行。
- 新增独立 `security_boundary/filesystem.py`，不修改 Agent Core、TUI、WebUI、Android 或 OAEP 协议。
- 新增 `WindowsWorkspaceFilesystem`，只暴露 `read_bytes` 与 `atomic_write` 操作，不向调用者返回可复用的已解析宿主路径。
- 路径规范化默认拒绝绝对路径、盘符路径、UNC、Win32 device namespace、空组件、`.`/`..`、ADS、尾随点/空格和保留设备名。
- projection root 在解析前以 `FILE_FLAG_OPEN_REPARSE_POINT` 打开；junction/symlink 不能通过先 `resolve()` 隐藏自身。
- 从 workspace root 到最终父目录的每一级均以 Win32 handle 打开并检查；handle 不包含 `FILE_SHARE_DELETE`，验证和实际操作期间目录不能被 rename/replacement。
- 所有目录组件和最终文件都拒绝 `FILE_ATTRIBUTE_REPARSE_POINT`，防止 symlink、junction 及其他 reparse tag 穿越。
- 最终普通文件要求 hard-link count 为 1；工作区内指向外部 sentinel 的 hardlink 在读和写两条路径均被拒绝。
- 读取使用已检查的 Win32 handle 与显式大小上限；超过上限结构化 fail closed，不返回截断后被误认为完整的内容。
- 写入在已固定父目录内使用不可预测临时名、`CREATE_NEW`、完整写校验、`FlushFileBuffers` 和 `MoveFileExW(REPLACE_EXISTING | WRITE_THROUGH)`，保留合法原子替换语义。
- 写入既有目标前重新以 `OPEN_REPARSE_POINT` 检查对象；拒绝通过 symlink/junction/hardlink 修改外部文件。
- 增加真实 junction fallback 测试，在普通 symlink 权限不可用的 Windows 主机也能验证 reparse 防线。
- 当前 Broker 只证明受管理文件操作，不证明任意 shell 的文件视图已隔离；`WindowsRestrictedProcessBackend` 未增加 `filesystem_enforced` guarantee，继续不可用于 `isolated_full_access`。

### 功能点进展

| 功能点 | 进度 | 累积证据 | 尚缺验收 |
|---|---:|---|---|
| P0-F02 文件系统边界 | 35% | Win32 handle-pinned 文件 Broker；namespace/ADS/device/reparse/hardlink 拒绝；读取上限；合法原子写 | shell/Python/Node/二进制的 OS 文件视图投影、大小写/长路径矩阵、TOCTOU 长压、打包应用 E2E |
| P0-F03 进程/资源隔离 | 70% | 上轮 restricted token/Job 证据不变；本轮确认不能以文件 Broker 代替进程隔离 | AppContainer 或独立账户 worker、通用运行时和完整逃逸套件 |
| P0-F10 迁移/fail-closed | 55% | AppContainer profile 不可运行时保持 backend unavailable；没有宿主执行 fallback | 可运行 AppContainer 打包环境、所有文件/进程工具接入统一 Broker、发布静态门禁 |
| P2-F04 隔离完全访问 | 45% | 未因部分文件 Broker 提前增加 attestation guarantee | 文件/网络/凭据/运行时全部隔离后才能开放 |
| 其余既有功能点 | 不变 | 见前轮 | 继续按三份方案推进 |

折算：上轮累计 1700 分；本轮 P0-F02 增加 25 分；`1725 / (30 × 100) = 57.5%`，显示为 58%。

### 本轮测试

- Windows 文件 Broker 专项：15 passed。
- Windows 文件 Broker、restricted token、Job、Sandbox 与静态扫描组合：55 passed。
- 安全域综合回归：324 passed、1 skipped。
- 覆盖路径 traversal、drive/UNC/device namespace、ADS、保留名、空组件、合法嵌套读写、原子替换、读取上限、junction/reparse、projection-root junction 及外部 hardlink sentinel。
- 综合回归首次收集因默认 `DRSAI_HOME` 位于不可写目录而失败；将测试数据根显式置于工作区临时目录后全部通过，临时目录已校验位于 workspace 后清理。

### 下一轮

1. 新增 AppContainer profile/derive/delete 生命周期组件与 `SECURITY_CAPABILITIES` worker launcher；profile 创建、ACL 或进程启动任一步失败均撤销临时授权并保持 backend unavailable。
2. 对临时 workspace 做 AppContainer SID ACL projection，运行同一 external-read、junction、hardlink 和 direct-socket canary；只有外部读与裸 socket 均被 OS 拒绝才签发 attestation guarantee。
3. 将文件读写工具的 runtime 内部适配器迁到 `WindowsWorkspaceFilesystem`，以 Proposal/Profile/Grant/Effect claim 精确绑定实际 relative path 与内容摘要，不改变客户端 wire contract。
4. 增加并发目录替换和目标替换 TOCTOU 压力测试、大小写/长路径/Unicode 等价矩阵以及 crash 后临时文件恢复策略。

## 第 18 轮

日期：2026-08-16  
总体进展：**58%**（折算分较上轮 +15；显示百分比不变）  
完全验收：**0 / 30**  
当前阶段：AppContainer profile 生命周期、零 capability worker launcher 与可运行性证明

### 本轮完成

- 新增 `windows_appcontainer.py`，将 AppContainer profile 生命周期和 worker 启动封装在 runtime security boundary 内；未修改 Agent Core 或任何客户端协议。
- `WindowsAppContainerProfileFactory` 为每次执行生成产品前缀、Run 不可逆摘要和随机后缀组成的唯一 profile name；名称不泄漏原始 Run ID，也不会复用共享 profile。
- profile name 明确限制在 Windows AppContainer 64 字符上限内；真实探测曾捕获实现自产生的 `0x80070057`，缩短名称后恢复为宿主真实 `0x80070002`，防止错误归因。
- Create 返回失败 HRESULT 或空 SID 时 fail closed；只释放确实返回的 SID，绝不按未取得所有权的名称调用 Delete，避免误删并发创建的 profile。
- profile close 先释放 SID，再删除唯一 profile；SID 只释放一次，Delete 失败结构化上报并允许重试，成功后 close 幂等。
- 新增 `WindowsAppContainerWorkerLauncher`，使用 `STARTUPINFOEXW` 和 `PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES` 启动 AppContainer 进程。
- `SECURITY_CAPABILITIES` 的 capability SID 数量为零，因此实现层没有授予 `internetClient`、private network 或其他隐式 capability；网络仍需真实 canary 后才能宣称 enforced。
- worker 使用显式 Unicode environment block，key/value 含 NUL、空 key 或 `=` key 均拒绝；不会隐式继承 PATH、代理或宿主秘密变量。
- 进程以 suspended 状态创建，配置 Job Object 后才 resume；保留 kill-on-close、进程数和内存限制。
- 修复关键失败窗口：若 `CreateProcessW` 成功后在 Job 创建/分配或 resume 前失败，launcher 主动 `TerminateProcess` 并等待，不留下未受 Job 管理的 suspended worker。
- attribute list、heap allocation、process/thread/Job handles 在所有终态清理；timeout 先关闭 Job 杀死进程树，再读取结果。
- `WindowsIsolationProbe` 新增 `appcontainer_profile_operational` 与 HRESULT 证据；API export 与 profile 实际可创建被明确区分。
- profile 可运行性探测结果在 probe 实例内缓存，避免每次 attestation 重复创建/删除系统 profile；注入测试证明两次 probe 只发生一次有状态生命周期。
- 本机证据：Windows/API 均存在、当前进程非管理员，但 `appcontainer_profile_operational=false`、HRESULT=`0x80070002`；所以 backend 继续不签发 filesystem/network guarantee，也不开放 `isolated_full_access`。

### 功能点进展

| 功能点 | 进度 | 累积证据 | 尚缺验收 |
|---|---:|---|---|
| P0-F03 进程/资源隔离 | 75% | restricted token/Job 真实链路；新增 AppContainer SECURITY_CAPABILITIES suspended→Job→resume launcher及 pre-Job 失败终止 | 可创建 profile 的打包主机真实启动、通用 runtime、句柄/命名对象/注册表/跨进程逃逸套件 |
| P0-F04 网络出口边界 | 55% | 受控 HTTP Broker；AppContainer worker 明确零 network capability，不继承代理环境 | OS canary 证明自带 socket/DoH/IPv4/IPv6/loopback 均失败；受控出口 E2E |
| P0-F10 迁移/fail-closed | 60% | API 与 profile operational 分离、HRESULT 证据、缓存探测、各生命周期失败无宿主 fallback | 打包 AppModel 环境、ACL rollback/crash recovery、所有执行路径迁移和发布门禁 |
| P2-F04 隔离完全访问 | 45% | operational=false 时仍不增加 attestation guarantee | AppContainer 文件/网络/凭据 canary 全通过及持续健康证明 |
| 其余既有功能点 | 不变 | 见前轮 | 继续按三份方案推进 |

折算：上轮累计 1725 分；本轮增加 `5+5+5=15` 分；`1740 / (30 × 100) = 58%`。

### 本轮测试

- AppContainer profile/worker 专项：10 passed。
- AppContainer、文件 Broker、restricted token、Job、Sandbox 与静态扫描组合：65 passed。
- 安全域综合回归：334 passed、1 skipped。
- 覆盖唯一且不泄漏 Run 的 profile name、64 字符门禁、失败 create 不误删、SID 单次释放、Delete 重试、close 幂等、真实 host unavailable、closed profile、环境注入拒绝、显式环境和 operational probe 缓存。
- 测试数据根继续显式置于 workspace 内临时目录；测试后校验绝对路径仍位于 workspace 再递归清理。

### 下一轮

1. 实现 AppContainer SID 的 workspace ACL projection 与逐对象原 DACL journal；授权、启动、撤销任一步崩溃后都能恢复到无残留授权。
2. 在支持 AppModel repository 的 Windows 打包/CI worker 运行真实 AppContainer cmd/Python canary；若 profile 创建仍失败，将主机标记 backend unavailable 而非使用受限 token 替代。
3. 运行 external read/write、junction、hardlink、device path、loopback、IPv4/IPv6 和自带 socket canary；只在全部逃逸失败后增加 `filesystem_enforced`/`network_egress_enforced`。
4. 将文件工具内部适配器接到 Proposal/Profile/Grant/Effect claim 与 `WindowsWorkspaceFilesystem`，保持现有 TUI/WebUI/Android/OAEP wire contract 不变。

## 第 19 轮

日期：2026-08-16  
总体进展：**59%**（较上轮 +1 个百分点）  
完全验收：**0 / 30**  
当前阶段：AppContainer SID workspace ACL projection 与 crash-safe 撤权

### 本轮完成

- 新增 `windows_acl_projection.py`，将 workspace ACL projection 独立放在 runtime security boundary；Agent Core、TUI、WebUI、Android、OAEP 均未改动。
- 新增 durable `runtime_acl_projections`、逐对象 `runtime_acl_projection_items` 和 append-only projection events。
- projection 精确绑定 Run ID、唯一 AppContainer profile name、SID、canonical workspace root、读写模式与对象数量。
- 同一 workspace root 同时只允许一个 applying/active/revoking/rollback-failed projection；并发重复授权 fail closed。
- 投影只接受普通目录和文件；root 或任一后代是 symlink、junction/reparse point、特殊对象时在修改 ACL 前拒绝。
- 增加最大对象数门禁，超大 workspace 在任何 ACL 变化前拒绝，避免不受控的授权/恢复事务。
- 原始 DACL 以 SDDL 持久化，且记录 Windows device/file identity；撤销前重新验证对象 identity，路径被替换时不会把旧 ACL 写到新对象。
- 实现严格两阶段应用：先遍历并持久化所有对象的原始 SDDL，再开始添加任何 AppContainer ACE。
- 真实测试发现并修复“先 grant root、再 snapshot child”会让继承 ACE 污染原始快照的安全缺陷。
- directory 使用可继承 ACE，既有对象逐一显式授权；read-only 使用 generic read/execute，writable projection 才授予 workspace 内 file all access。
- OS grant 前 item 已处于 `prepared`；即使崩溃发生在 ACL 修改后、数据库 applied 标记前，恢复仍会保守还原该对象。
- apply 任一步失败自动进入 revoking，并按 journal 撤销；rollback 自身失败进入 durable `rollback_failed`，不会伪装成功。
- `recover_incomplete()` 在重启后继续 applying/revoking/rollback-failed projection；已恢复对象不重复计数，失败对象可重试。
- 恢复显式保留 protected/unprotected DACL 语义；真实测试发现并修复只用 `SetFileSecurity` 会丢失 `AI` auto-inheritance 控制位的问题。
- 撤销先恢复 root，再恢复 descendants，使未保护子对象从已经清除 AppContainer ACE 的父级重新继承。
- worker 活跃期间新建的对象没有“原 ACL”；撤销时发现这些对象、持久化 `discovered` item，并只移除该 projection 唯一 SID，避免覆盖其他 ACL。
- discovered SID removal 在 OS 修改前 journal，崩溃后可幂等重试；完成后 item_count/restored_count 一致。
- Native Win32 验收实际修改临时 workspace/文件 DACL，确认 SID grant 可见，撤销后原始 SDDL（含继承控制）逐字恢复。
- 文件被删除并以相同路径替换时 identity check 触发 `rollback_failed`，不向替换对象写入 stale security descriptor。
- projection events 只记录低敏状态、数量和 root identity，不保存文件内容、凭据或原始 Run 文本。
- 当前 ACL projection 尚未与可运行 AppContainer profile 在打包环境联合 canary，因此 backend 仍不签发 `filesystem_enforced`，完全访问保持关闭。

### 功能点进展

| 功能点 | 进度 | 累积证据 | 尚缺验收 |
|---|---:|---|---|
| P0-F02 文件系统边界 | 50% | handle-backed 文件 Broker；durable SID ACL projection；reparse/identity/entry-limit；精确 SDDL 恢复；新对象 SID 清理 | AppContainer 联合 external read/write canary、保护路径、长路径/大小写/Unicode、TOCTOU 长压和打包 E2E |
| P0-F10 迁移/fail-closed | 70% | ACL 先 journal 后授权、apply 自动回滚、rollback_failed 持久化、重启重试、对象替换不误恢复 | worker/profile/ACL 单一编排事务、进程终止确认、崩溃租约、所有工具迁移和发布门禁 |
| P2-F04 隔离完全访问 | 50% | 新增可恢复 workspace projection 基础，但 operational attestation 仍 false | AppContainer+ACL+无网+凭据+snapshot 联合证明与持续健康门禁 |
| 其余既有功能点 | 不变 | 见前轮 | 继续按三份方案推进 |

折算：上轮累计 1740 分；本轮增加 `15+10+5=30` 分；`1770 / (30 × 100) = 59%`。

### 本轮测试

- ACL projection 专项：8 passed。
- ACL、AppContainer、文件 Broker、restricted token、Job、Sandbox 与静态扫描组合：73 passed。
- 安全域综合回归：342 passed、1 skipped。
- 覆盖三对象完整 apply/revoke、两阶段快照、grant 后/mark 前故障、失败恢复跨重启、对象 identity 替换、projection 冲突、entry limit、junction、真实 DACL/SDDL 精确恢复及运行中新对象清理 journal。
- 综合回归使用 workspace 内临时 `DRSAI_HOME`，结束后验证绝对清理目标仍在 workspace 内再删除。

### 下一轮

1. 新增单一 `WindowsIsolatedExecutionSession` 编排：profile create → ACL projection → worker → Job 终止确认 → ACL revoke → profile delete；每阶段持久化并做 fault injection。
2. 为 active session 增加租约与启动恢复；只有确认 Job 中无存活进程后才撤销 ACL，无法确认时保持更保守的 residual-access security incident。
3. 在支持 AppModel repository 的 Windows 打包/CI runner 执行 AppContainer+ACL 联合 canary，验证 workspace 可写、外部文件不可读写、裸 IPv4/IPv6/loopback socket 不可达。
4. 将受控文件工具迁至 Proposal/Profile/Grant/Effect claim + 文件 Broker，不改变客户端 wire contract，并开始清理对应 legacy 裸文件入口。

## 第 20 轮

日期：2026-08-16  
总体进展：**60%**（较上轮 +1 个百分点）  
完全验收：**0 / 30**  
当前阶段：Windows isolated execution durable Session 与逐阶段崩溃恢复

### 本轮完成

- 新增 `windows_isolated_session.py`，把 AppContainer profile、ACL projection、worker/Job、ACL revoke 和 profile delete 编排成单一 durable Session。
- 所有实现继续位于 runtime security boundary；Agent Core、TUI、WebUI、Android 和 OAEP wire contract 未变化。
- AppContainer profile factory 新增 `reserve_name(run_id)`：先生成并持久化唯一 profile name，再调用有状态 Windows API。
- 修复“OS profile 已创建、数据库尚不知道名称”时可能留下无法定位 orphan profile 的崩溃窗口。
- 新增 `create_reserved()` 和严格 owned-name 校验；重启删除只接受 `OpenDrSai.Worker.*`、合法字符且不超过 64 字符的产品自有 profile name。
- 新增原生 `ConvertSidToStringSidW`，在 SID 指针仍有效时生成稳定 SID string；Session 与 ACL journal 不依赖重启后失效的内存指针。
- SID 转换失败会释放 SID 并删除刚创建的 profile；转换与删除同时失败时返回独立 cleanup error，不继续启动 worker。
- 新增 `delete_owned_profile(..., allow_missing=True)`；恢复可幂等删除已不存在的 profile，但不会把任意外部名称当作自有对象删除。
- durable Session 阶段为 `profile_prepared → profile_created → acl_active → worker_starting → worker_terminal → acl_revoked → profile_deleted → completed`。
- Session 持久化 execution/run/request digest、profile name、SID、projection ID、workspace、读写模式、worker status/exit code和错误码；argv 与 environment 原文不落库。
- Session events append-only，只记录阶段和低敏固定 detail；测试秘密环境变量未出现在 SQLite bytes 中。
- 执行顺序强制为 profile create 后 ACL grant、ACL active 后 worker、worker terminal 后 ACL revoke、ACL revoked 后 profile delete。
- 正常异常路径会查找已知 projection；即使 Session 尚未写入 projection ID，也可按唯一 profile name 找到 ACL journal 并撤销。
- profile create、ACL create、worker run、ACL revoke 或 profile delete 任一步抛出普通异常时，统一尝试撤 ACL 和删 profile。
- cleanup 全部成功记为 `failed_cleaned`；任一 cleanup 不可证明成功记为 durable `cleanup_failed`，不伪装为安全终态。
- `recover_incomplete()` 扫描所有非 completed/failed_cleaned/recovered Session，继续 ACL rollback 与 owned profile delete；重复 recovery 无副作用。
- worker 处于 `worker_starting` 时发生进程级中断，恢复一律写 `outcome_unknown`；不重启命令，也不伪造失败或成功副作用回执。
- 具体 worker 仍使用 suspended→Job→resume 和 Job kill-on-close；Runtime 进程崩溃后 OS 关闭 Job handle 并终止已接管进程树，恢复再撤销 ACL。
- 对 7 个 durable phase 逐一注入绕过 finally 的模拟进程崩溃，重启均收敛到无 active projection、无 profile authority。
- 同 execution ID 的相同已完成请求幂等返回，不再次启动 worker；未完成请求拒绝并发重试；同 ID 不同 request digest/run scope 拒绝。
- worker 普通失败测试证明 ACL/profile 均清理、Session 进入 `failed_cleaned`，启动恢复不会重复执行命令。
- 当前宿主仍无法创建真实 AppContainer profile（`0x80070002`），故本轮状态机证据不等于真实 packaged worker E2E；filesystem/network guarantees 继续关闭。

### 功能点进展

| 功能点 | 进度 | 累积证据 | 尚缺验收 |
|---|---:|---|---|
| P0-F03 进程/资源隔离 | 80% | restricted token/Job 真实链路；AppContainer launcher；durable worker Session；崩溃后 Job close + outcome_unknown | 可用 AppModel 主机真实 AppContainer runtime、句柄/注册表/命名对象/跨进程逃逸和打包 E2E |
| P0-F10 迁移/fail-closed | 80% | profile 名预写、SID 稳定化、ACL/worker/profile 单一状态机、7 阶段 crash recovery、cleanup_failed | 活跃 lease/Job 无进程证明、跨进程并发压测、全部副作用迁移、打包发布门禁 |
| P2-F04 隔离完全访问 | 55% | 隔离组件已有统一生命周期和异常撤权，不完整状态不开放 | AppContainer+ACL+network+credential 联合 canary、持续 attestation 和产品 E2E |
| 其余既有功能点 | 不变 | 见前轮 | 继续按三份方案推进 |

折算：上轮累计 1770 分；本轮增加 `5+10+5=20` 分；`1790 / (30 × 100) = 59.67%`，显示为 60%。

### 本轮测试

- isolated Session 专项：10 passed。
- Session、ACL、AppContainer、文件 Broker、restricted token、Job、Sandbox 与静态扫描组合：83 passed。
- 安全域综合回归：352 passed、1 skipped。
- 覆盖成功顺序、幂等完成、秘密不落库、7 阶段进程崩溃、projection ID 写入窗口恢复、worker outcome_unknown、worker 普通失败清理、未完成重试和 execution scope 替换。
- 测试数据根位于 workspace 内，综合回归后按绝对路径前缀校验并清理。

### 下一轮

1. 为 Session 增加 owner process identity、heartbeat/lease 和 recovery claim，防止仍存活执行被另一 Runtime 实例误回滚；过期 lease 才允许单一恢复者接管。
2. 增加 Job empty/terminated attestation：ACL revoke 前必须证明 Job 无 active process；无法证明时保持 ACL 并进入 security-incident/quarantine，而不是边运行边撤权。
3. 在支持 AppModel repository 的打包 Windows CI 执行完整 Session，运行 workspace write、external read/write 和 raw socket canary。
4. 开始迁移文件写工具至 Grant/Effect claim + `WindowsWorkspaceFilesystem`，保持客户端协议不变，并为 legacy 裸入口加入发布构建拒绝门禁。

## 第 21 轮

日期：2026-08-16  
总体进展：**60%**（折算分较上轮 +20；显示百分比不变）  
完全验收：**0 / 30**  
当前阶段：Session owner lease、原子 recovery claim 与 Job empty 强证明

### 本轮完成

- 扩展 Windows Job Object 后端，增加 `QueryInformationJobObject(JobObjectBasicAccountingInformation)`，直接读取 `ActiveProcesses`。
- 新增 `terminate_and_verify_empty()`：调用 `TerminateJobObject` 后持续查询 accounting，只有 `ActiveProcesses == 0` 才返回成功。
- AppContainer worker 和 restricted-token worker 在正常完成与 timeout 两条路径都终止残余后代并验证 Job empty；结果新增 `process_tree_empty_verified`。
- worker 主进程已退出但孙进程仍驻留时，不再仅凭主进程 exit code 判断清理完成。
- Session 在 `worker_terminal` 前再次验证 worker result 的 Job-empty proof；伪造/弱 worker adapter 返回 false 时拒绝进入 ACL revoke。
- Job-empty 无法证明、Job accounting 失败或 Job 未能变空时，Session 进入 durable `quarantined`，worker status 为 `outcome_unknown`。
- `quarantined` 保留唯一 profile 与 ACL projection，不执行可能与活跃进程竞争的自动撤权；需要后续独立处置流程确认进程消失。
- 修正上一轮恢复策略：崩溃位于 `worker_starting` 且没有 Job-empty proof 时，不再自动 revoke ACL/delete profile，而是进入同一 quarantine 安全事件。
- Session 新增 `owner_id`、`lease_expires_at`、`recovery_token` 和 `job_empty_verified` 持久字段，并包含向已有 SQLite schema 的安全迁移。
- 每个 Runtime service instance 使用唯一 owner ID；所有状态 transition 都带 `WHERE owner_id=?`，失去 ownership 的旧实例无法继续写 Session。
- 新增 heartbeat；仅当前 owner 可延长非终态 Session lease，终态 heartbeat 不改变历史。
- `worker_starting` lease 至少覆盖请求 timeout 加 cleanup grace，避免正常长任务被恢复者提前接管。
- `recover_incomplete()` 只扫描 lease 已过期且非终态/非 quarantine Session；未过期的存活 owner 不受影响。
- recovery 使用 `BEGIN IMMEDIATE` 和条件 UPDATE 原子 claim，写入新 owner/recovery token/lease；两个恢复者竞争只有一个成功。
- recovery claim 后旧 owner 的 transition 返回 `isolated_session_lease_lost`，不能覆盖恢复终态。
- recovery 自身获得新 lease，避免多个恢复者在 ACL/profile 清理期间重复接管。
- Job proof 为 true 的 worker-terminal 后续崩溃仍可正常恢复 ACL/profile；无 proof 的 worker-starting 崩溃保持 quarantine。
- 新增真实 restricted worker 断言，确认基础 cmd worker 返回 `process_tree_empty_verified=true`。
- 数据库仍不保存 argv/environment 原文，lease/recovery 字段只包含随机 owner/token、时间和布尔证明。
- 当前 quarantine 尚缺管理员/自动化二次 Job 核验与强制处置 API，因此相关功能仍未完全验收。

### 功能点进展

| 功能点 | 进度 | 累积证据 | 尚缺验收 |
|---|---:|---|---|
| P0-F03 进程/资源隔离 | 85% | restricted identity、Job limits、terminate tree、ActiveProcesses=0 proof、Session 强制消费 proof | AppContainer packaged E2E、跨进程/句柄/注册表/命名对象/服务/计划任务完整逃逸套件 |
| P0-F10 迁移/fail-closed | 90% | owner lease、heartbeat、原子 recovery claim、旧 owner fencing、Job 未证明时 quarantine | quarantine 处置、跨进程长压、所有副作用入口迁移、发布包门禁与升级回滚 |
| P2-F04 隔离完全访问 | 60% | ACL revoke 前强制 Job empty；弱 proof/恢复不确定性进入 quarantine | AppContainer+ACL+无网+凭据真实联合 canary及持续 attestation |
| 其余既有功能点 | 不变 | 见前轮 | 继续按三份方案推进 |

折算：上轮累计 1790 分；本轮增加 `5+10+5=20` 分；`1810 / (30 × 100) = 60.33%`，显示为 60%。

### 本轮测试

- isolated Session 专项：13 passed。
- Session、ACL、AppContainer、文件 Broker、restricted token、Job、Sandbox 与静态扫描组合：86 passed。
- 安全域综合回归：355 passed、1 skipped。
- 覆盖 live lease 阻断、heartbeat 延期、过期接管、旧 owner fencing、双恢复者唯一 claim、7 阶段恢复差异、Job-empty false quarantine、真实 restricted worker empty proof。
- 综合测试结束后按 workspace absolute prefix 校验并清理临时 Runtime 数据根。

### 下一轮

1. 实现 quarantine resolution service：持久化处置 claim，重新验证 named Job/process identity；只有明确 empty 才撤 ACL/profile，否则延长隔离并产生高优先级安全事件。
2. 为 Job 使用不可预测但持久化的 name，记录 Job identity；恢复进程可 `OpenJobObject` 查询 active count，区分“Job 已销毁且 kill-on-close 生效”和“仍有进程”。
3. 增加进程 PID/create-time identity，防止 PID reuse；实现跨进程真实 Runtime crash harness，而不仅是同进程 fault injection。
4. 开始迁移文件工具至 Grant/Effect + handle-backed Broker，并为 legacy 裸文件写入口增加发布构建拒绝规则。

## 第 22 轮

日期：2026-08-16  
总体进展：**61%**（较上轮 +1 个百分点）  
完全验收：**0 / 30**  
当前阶段：持久化 named Job identity、跨进程 crash proof 与 quarantine resolution

### 本轮完成

- Windows Job Object 新增不可预测 `Local\\OpenDrSai.Job.<128-bit random>` owned identity；名称在任何 OS Job 创建前生成并持久化到 Session。
- owned Job name 仅接受固定产品 namespace 和 32 位小写 hex 随机后缀；任意外部名称不能用于 reopen/terminate。
- `_create_job(name)` 在调用前清零 LastError，并显式检查 `ERROR_ALREADY_EXISTS`；随机名称若碰撞或被抢占，关闭返回 handle 并 fail closed，绝不接管攻击者预建 Job。
- 新增 `open_owned_job()`，只申请 Query/Terminate 权限；Job 不存在与其他 OpenJob 错误被区分，访问错误不会误判为 empty。
- 新增 `verify_owned_job_empty()`：Job 仍存在时 reopen、TerminateJobObject、轮询 ActiveProcesses=0；Job 不存在时使用预写 identity + suspended→assign→resume + kill-on-close 协议证明安全。
- AppContainer worker 接收 Session 持久化 job_name，并以该名字创建 Job；worker adapter 不再自行生成不可恢复的匿名 Job。
- Session schema 新增非空 `job_name`，并为已有 SQLite 表提供保守 legacy migration；新 Session 在 `profile_prepared` 阶段已经拥有 Job identity。
- recovery 遇到过期 `worker_starting` 时先按持久化名称执行 Job recovery；只有 named Job 被确认 empty/absent 才撤 ACL 和 profile。
- named Job 仍活跃、无法查询或验证失败时继续进入 quarantine，不把 OS/API 错误当作进程已终止。
- recovery 通过 named Job absence 后将 `job_empty_verified=true` 写入最终 recovered Session，保留 `runtime_interrupted`/未知 worker outcome。
- 新增 `resolve_quarantined()`：仅 quarantine lease 过期后可原子 claim，随后重新执行 named Job empty proof。
- quarantine resolution 仍检测到 Job active 时只延长 quarantine lease并写 `job_still_active`，保留 ACL/profile。
- fresh proof 确认 empty 后，resolver 才按顺序 revoke ACL、delete owned profile，并收敛为 `recovered + outcome_unknown + job_empty_verified`。
- quarantine lease 活跃时处置请求返回 `isolated_quarantine_claim_denied`；避免两个处置者同时操作 Job/ACL/profile。
- ACL 或 profile cleanup 失败仍进入 `cleanup_failed`，不会因 Job 已空而掩盖残留授权。
- 真实 named Job 测试验证：可用第二 handle reopen；同名 Create 被拒绝；最后 handle 关闭后 Open 返回不存在。
- 新增真实跨进程 crash harness：辅助 Runtime 创建 named Job、挂入长寿命 child 并 resume；测试强制杀死辅助 Runtime。
- crash harness 证明辅助 Runtime 退出触发 Job `KILL_ON_JOB_CLOSE`、child PID 不再存活、Job name 不可 reopen，随后 `verify_owned_job_empty()` 返回 true。
- Session 测试证明 worker 实际收到与数据库相同的 job_name；同一个执行生命周期不使用匿名或替代 Job。
- 新增两条恢复分支测试：named Job absence 可自动恢复；首次 active 进入 quarantine、后续 empty proof 才允许处置。
- 当前仍缺 AppContainer profile 可用主机上的真实 worker+ACL+network 联合执行，所以未增加 filesystem/network backend guarantee。

### 功能点进展

| 功能点 | 进度 | 累积证据 | 尚缺验收 |
|---|---:|---|---|
| P0-F03 进程/资源隔离 | 90% | named Job、碰撞拒绝、跨进程 reopen、ActiveProcesses=0、真实 Runtime crash 后 kill-on-close/child PID 消失 | AppContainer packaged E2E；句柄/注册表/命名管道/服务/计划任务/调试逃逸全集 |
| P0-F09 安全回执与可观测性 | 85% | Session 持久 Job identity、lease/recovery/quarantine 事件与 outcome_unknown | 链式纳入 Session events、告警/SLO、审计导出、跨日志锚定和高并发压测 |
| P0-F10 迁移/fail-closed | 95% | named Job recovery、quarantine claim/复核/处置、OS crash harness、所有不确定状态保持权限更保守 | 所有副作用入口迁移、发布包静态门禁、升级/回滚和打包验收 |
| P2-F04 隔离完全访问 | 65% | 可跨进程证明 Job empty 后才撤权；quarantine 已有可恢复处置闭环 | AppContainer/ACL/network/credential 联合 canary与持续健康 attestation |
| 其余既有功能点 | 不变 | 见前轮 | 继续按三份方案推进 |

折算：上轮累计 1810 分；本轮增加 `5+5+5+5=20` 分；`1830 / (30 × 100) = 61%`。

### 本轮测试

- named Job + isolated Session 专项：20 passed。
- Session、ACL、AppContainer、文件 Broker、restricted token、Job、Sandbox 与静态扫描组合：90 passed。
- 安全域综合回归：359 passed、1 skipped。
- 覆盖 name 格式、碰撞、reopen、最后 handle 消失、跨进程 Runtime crash、child kill、Job absence recovery、active quarantine、lease-gated resolution 和 fresh empty proof。
- 综合回归临时 Runtime 数据根仍在 workspace 内，结束后验证 absolute prefix 并清理。

### 下一轮

1. 将 Session/ACL/Job events 接入统一 hash-chain SecurityEventJournal，增加 quarantine 高优先级指标、未解决时长 SLO 和可查询健康快照。
2. 建立文件工具 execution adapter：Proposal/Profile/Grant/Effect claim → `WindowsWorkspaceFilesystem` → receipt；保持现有客户端 wire contract 不变。
3. 为 legacy 裸文件写/rename/delete 入口扩展 AST 发布门禁，并逐个迁移，不先改 Agent Core 的规划/对话协议。
4. 在可用 Windows AppModel CI/打包 runner 运行完整 Session 和 filesystem/network escape suite，完成 P0-F02/F04 的 OS 级验收。

## 第 23 轮

日期：2026-08-16  
总体进展：**62%**（较上轮 +1 个百分点）  
完全验收：**0 / 30**  
当前阶段：Proposal/Profile/Grant/Effect 绑定的 handle-backed 文件写执行 adapter

### 本轮完成

- 新增 `filesystem_execution.py`，实现 Runtime 内部 `AuthorizedFilesystemExecutionService`；不新增客户端消息、Approval 类型或 Agent Core 决策分支。
- `file.write` Proposal 必须显式声明 `filesystem.write` capability；其他 operation 或缺少 capability declaration 在任何 Grant 消费前拒绝。
- 新增稳定 `write_payload()` 规范：只包含 canonical relative path、SHA-256 content digest 和 size，不把文件内容写入 Proposal/Grant/Effect 数据库。
- 实际执行前用真实 bytes 重新计算 content digest/size，并与 Proposal payload digest 比较；内容替换、路径替换均要求新授权。
- Windows `\` 与 `/` 路径统一规范为相同 canonical relative path，避免显示形式差异绕过授权绑定。
- adapter 验证 filesystem root 与 active Profile workspace root 完全一致；不能拿另一个 workspace 的 broker 消费当前 Grant。
- writable roots 支持 workspace 绝对根或 workspace-relative 子目录；configured root 必须自身位于 workspace 内，目标必须位于其中。
- 空 writable roots、其他卷、越界 root 或目标不在 allowed subtree 时，在 Effect claim/Grant consumption 前拒绝。
- `.git`、`.agents`、`.codex` 默认作为不可写 Agent/control prefixes；即使 Profile writable root 是整个 workspace、用户批准、Grant 有效也不能覆盖。
- adapter 使用 `EffectExecutionStore.claim()`，在同一个 SQLite transaction 中重新验证 hard deny、Profile、Proposal payload、Grant scope/expiry/revocation/mode transition/kill switch，并原子消费 Grant。
- Effect claim 成功后才调用 `WindowsWorkspaceFilesystem.atomic_write()`；实际文件操作继续使用 handle-pinned/reparse/hardlink 防线和 write-through 原子替换。
- 成功 receipt 只包含 execution ID、operation、relative-path digest、content digest、size、完成时间及 receipt digest，不返回原始路径或内容。
- receipt digest 同时绑定 backend ID/version、workspace root 和 Profile digest，不能移用于另一 workspace/profile。
- 文件写抛出异常时不假定“没有副作用”；Effect 进入 `outcome_unknown`，Grant 保持已消费，禁止盲目重放。
- 即使 outcome_unknown 状态写入自身失败，也保留原始 OS 异常，不用二次数据库异常掩盖调用故障。
- 32 路并发使用同一 Grant 时，只有一个 Effect claim 和一次 filesystem write 成功；其余均在 OS 写入前拒绝。
- 成功 execution ID 重试不会再次写文件；单次 Grant 与 unique Effect constraint 共同保证最多一次已知执行。
- 真实 Windows 测试通过 adapter 完成嵌套目录原子写，并核对文件 bytes、Grant consumed_at、Effect terminal receipt。
- post-write fault 测试证明秘密文件内容不出现在 SQLite bytes 中，Effect 为 outcome_unknown，后续同 Grant 重放拒绝。
- RuntimeEngine 仅新增一个窄内部 `authorized_filesystem_execution(workspace_root)` 工厂，复用 Runtime database 中的 Grant store；未改变现有 Run/Tool/客户端 API。
- 当前还没有把既有业务层 file edit/rename/delete 和所有 file.write 调用点切换到该 adapter，因此 legacy 路径仍在 P0-F10 待迁移清单中。

### 功能点进展

| 功能点 | 进度 | 累积证据 | 尚缺验收 |
|---|---:|---|---|
| P0-F02 文件系统边界 | 60% | Win32 handle Broker、ACL projection、authorized file.write adapter、writable-root/control-path enforcement、真实原子写 | edit/rename/delete/read adapter、业务工具接线、OS AppContainer view、路径矩阵/TOCTOU/打包 E2E |
| P0-F07 Proposal/Grant/执行绑定 | 85% | file.write path+content+size 精确摘要，Effect claim 原子消费，receipt 绑定 backend/root/profile | 所有真实工具参数规范化迁移、等价语义全集、跨工具端到端绕过测试 |
| P1-F06 Exactly-once | 80% | 文件写 32 并发唯一 claim/write；写后异常 outcome_unknown 且不可重放 | edit/rename/delete、外部系统补偿、跨进程 crash matrix和运维 reconciliation |
| P0-F10 迁移/fail-closed | 95% | Runtime 已有受控 file.write 工厂且不影响客户端 | 业务调用点迁移、legacy 裸入口清零/发布门禁、打包验收 |
| 其余既有功能点 | 不变 | 见前轮 | 继续按三份方案推进 |

折算：上轮累计 1830 分；本轮增加 `10+10+5=25` 分；`1855 / (30 × 100) = 61.83%`，显示为 62%。

### 本轮测试

- authorized filesystem execution 专项：8 passed。
- adapter、静态扫描与 RuntimeEngine 回归组合：59 passed。
- 安全域综合回归：367 passed、1 skipped。
- 覆盖真实原子写、slash canonicalization、路径/内容替换、control prefixes、writable subtree、32 并发、post-write outcome_unknown、Grant replay 和秘密不落库。
- 综合回归临时数据根在 workspace 内，结束后完成 absolute-prefix 校验与清理。

### 下一轮

1. 扩展 adapter 支持 `file.read`、`file.rename` 和 `file.delete`；rename 必须同时绑定 source/destination identity，delete 使用 tombstone/可恢复语义而非裸不可逆删除。
2. 搜索现有文件工具调用图，优先迁移实际 `write/edit` 入口到 Runtime adapter；保持 Agent Core 只声明 capability，不承担路径安全逻辑。
3. 扩展 AST 静态门禁覆盖裸 `Path.write_*`、`open(...,'w/a/x')`、`os.replace/rename/unlink`，采用明确例外清单并建立清零计划。
4. 将 filesystem execution events 接入统一 hash-chain journal和安全指标，增加 outcome_unknown reconciliation 查询。

## 第 24 轮

日期：2026-08-16  
总体进展：**63%**（较上轮 +1 个百分点）  
完全验收：**0 / 30**  
当前阶段：handle-based rename 与 recoverable tombstone delete

### 本轮完成

- `WindowsWorkspaceFilesystem` 新增 `atomic_rename()`；不使用“校验路径后关闭 handle，再调用裸 rename”的可交换窗口。
- source 以 `DELETE` access 和 `FILE_SHARE_DELETE` 打开，reparse/hardlink/object type 检查后，直接调用 `SetFileInformationByHandle(FileRenameInfo)` 移动同一内核对象。
- source/destination 的每一级父目录仍由不共享 DELETE 的 handle 固定，防止目录链在操作期间被 junction/rename 替换。
- rename 默认不覆盖 destination；目标已存在或是 symlink 时在源对象移动前拒绝，避免静默破坏未授权目标。
- source 或 destination 为盘符/UNC/device/ADS/traversal/ambiguous path 时复用统一规范化并 fail closed。
- 新增 `move_to_tombstone()`：`file.delete` 不调用 unlink，而是把已打开的确切源 handle 移到 workspace 内 `.opendrsai-trash/<id>.deleted`。
- tombstone ID 只接受 128-bit lowercase hex；目标 collision 时拒绝，不覆盖已有恢复记录。
- tombstone 目录本身由 handle/reparse 检查；若攻击者预建为 junction，操作拒绝而不会把文件移到 workspace 外。
- hardlink source 在 rename/delete 前继续因 link count != 1 被拒绝，外部 sentinel 不受影响。
- 修复真实 Win32 测试捕获的 `FILE_RENAME_INFO` 可变长度结构缺陷：仅按 `FileName.offset + bytes` 分配会导致目标名尾部出现随机 Unicode。
- 现按完整 `sizeof(FILE_RENAME_INFO) + filename bytes` 分配零初始化缓冲区，同时从正式 field offset 写入；重复真实 rename/delete 测试通过。
- `AuthorizedFilesystemExecutionService` 新增 `rename_payload()`，同时绑定 canonical source 与 destination；任一路径变化都会触发 Proposal digest mismatch。
- `file.rename` 必须声明 `filesystem.rename` capability，source/destination 均必须位于 Profile writable roots 且不能是控制路径。
- source 与 destination 相同直接拒绝，不消费 Grant，不制造无意义 Effect。
- `file.rename` 继续使用 Effect claim 原子消费单次 Grant；handle rename 成功后返回只含双路径 payload digest 的 receipt。
- 新增 `delete_payload()` 与 `file.delete` capability；删除 Proposal 精确绑定 canonical source path。
- delete tombstone ID 由 execution ID SHA-256 前 128 bit 确定；即使执行结果未知，reconciliation 也能计算唯一恢复位置，不依赖未持久化随机数。
- delete receipt 只返回 recovery reference digest，不向普通回执暴露 tombstone host path。
- `.opendrsai-trash` 加入默认不可写 control prefixes；普通 write/rename/delete Proposal 不能篡改、覆盖或清理 tombstone。
- rename/delete OS 调用抛错时统一写 `outcome_unknown`，Grant 不可重放；不能根据路径表象假设 source 未移动。
- 真实 adapter E2E 验证：source→destination handle rename、随后 delete→确定性 tombstone；原 bytes 在 tombstone 中可恢复，原路径消失。
- source/destination 参数替换测试均在 Effect claim 前拒绝且 Grant 未消费。
- Fake OS post-rename/post-delete fault 均产生 outcome_unknown 与已消费 Grant，建立后续 reconciliation 输入。
- 本轮仍未实现 tombstone restore/retention/secure purge 产品流程，也未迁移所有现有业务调用点，因此 file.delete 尚非完整产品验收。

### 功能点进展

| 功能点 | 进度 | 累积证据 | 尚缺验收 |
|---|---:|---|---|
| P0-F02 文件系统边界 | 70% | handle read/write/rename/tombstone delete、ACL projection、reparse/hardlink/control/writable-root、防源路径交换 | file.read/restore/purge、业务入口接线、AppContainer OS view、TOCTOU 长压/路径全集/打包 E2E |
| P0-F07 Proposal/Grant/执行绑定 | 90% | write content/path、rename source+destination、delete source、deterministic tombstone 与 receipt 精确绑定 | 所有工具迁移、语义等价规范和跨工具/跨平台完整绕过套件 |
| P1-F06 Exactly-once | 85% | write/rename/delete 单 Grant Effect claim；确定性 tombstone；未知结果不重放 | restore/purge 补偿状态机、跨进程崩溃矩阵和运维 reconciliation |
| P0-F10 迁移/fail-closed | 95% | Runtime adapter 覆盖三类 mutation，但仍与 legacy 并存 | 真实业务入口迁移、裸调用发布门禁清零和打包验收 |
| 其余既有功能点 | 不变 | 见前轮 | 继续按三份方案推进 |

折算：上轮累计 1855 分；本轮增加 `10+5+5=20` 分；`1875 / (30 × 100) = 62.5%`，显示为 63%。

### 本轮测试

- filesystem primitive + execution adapter 专项：31 passed。
- adapter、primitive、静态扫描和 RuntimeEngine 回归组合：82 passed。
- 安全域综合回归：375 passed、1 skipped。
- 覆盖真实 handle rename、destination collision、真实 tombstone、外部 hardlink、防 tombstone 篡改、双路径替换和 mutation outcome_unknown。
- 综合回归使用 workspace 内临时数据根，结束后验证 absolute prefix 并清理。

### 下一轮

1. 实现 durable tombstone catalog 与 `file.restore`/retention/purge 状态机；restore 精确绑定 tombstone execution、destination 和当前 Profile，purge 必须独立高风险授权。
2. 增加 mutation outcome_unknown reconciliation：根据 deterministic tombstone 和 source/destination identity 收敛 succeeded/failed/仍未知，不自动重复副作用。
3. 搜索并迁移现有 write/edit/rename/delete 工具调用点；先在 Runtime adapter 层接线，保持 Agent Core 和客户端协议不变。
4. 扩展 AST 发布门禁覆盖 `Path.write_*`、写模式 open、`os.replace/rename/unlink/remove`，逐步减少明确例外清单。

## 第 25 轮

日期：2026-08-16  
总体进展：**63%**（折算分较上轮 +25；显示百分比不变）  
完全验收：**0 / 30**  
当前阶段：durable tombstone catalog、授权 restore/purge 与无重放 reconciliation

### 本轮完成

- 新增 `tombstones.py`，建立 durable `runtime_filesystem_tombstones` 与 append-only tombstone events。
- Tombstone record 绑定 deterministic tombstone ID、deletion execution、Run、Profile digest 和 source payload digest；不保存原始文件内容或 source path。
- delete 在任何 OS move 前创建 `prepared` catalog record；即使 Runtime 在 Effect claim/OS 调用附近崩溃，确定性 execution identity 仍可定位恢复对象。
- 同 deletion execution/tombstone ID 的同 scope prepare 幂等；跨 Run/Profile/payload 复用同 identity 时 fail closed。
- delete handle move 成功后状态变为 `moved`；异常进入 `delete_unknown` 并保留原始错误码，不删除 catalog。
- catalog 状态迁移与事件分离；events 具备 no-update/no-delete trigger，删除、恢复和清除历史不可改写。
- `WindowsWorkspaceFilesystem` 新增 `restore_tombstone()`，通过既有 handle-based atomic rename 将确定 tombstone 移到明确批准的新 destination。
- restore 不依赖 catalog 中的明文原路径；用户/调用者必须提交新的 destination，Proposal 精确绑定 `deletion_execution_id + destination_relative_path`。
- `file.restore` 必须声明 `filesystem.restore`，destination 必须属于当前 Profile writable roots，且不能指向控制目录。
- restore 只接受同 Run 的 moved tombstone；跨 Run restore 在 Grant 消费前拒绝。
- restore claim 采用 moved→restoring 单赢家状态；Effect/Grant claim 失败时安全释放回 moved，不执行 OS 操作。
- 16 路并发 restore 只有一个 catalog claim、一个 Grant claim和一次实际 restore；其余不触碰 filesystem。
- restore OS 结果不确定时保留 restoring + Effect outcome_unknown，不自动再执行 rename。
- 新增 handle-based `purge_tombstone()`，使用 `SetFileInformationByHandle(FileDispositionInfo)` 对已检查的唯一 tombstone object 设置删除 disposition；不按裸 path unlink。
- purge source 继续拒绝 reparse point/hardlink，且只接受合法 deterministic tombstone ID。
- `file.purge` 使用独立 capability、独立 Proposal、独立 Grant 与 purging→purged catalog 状态；delete Grant 不能兼作永久清除权限。
- purge 必须声明 `risk=irreversible` 与 `irreversible_external_write`，使 AutoReviewer/模式规则进入 mandatory human 路径。
- 更进一步，purge 不信任 Proposal 自报：默认 verifier 查询 `runtime_approval_grants` 不可变链，要求 Request 和 approved Decision 的 reviewer_kind 均为 `human`。
- 直接用底层 `AuthorizationGrantStore.issue()` 生成的 Grant，即使 capability/risk/category 都正确，也无法执行 purge；测试确认 Grant 不消费、tombstone 不变化。
- Approval/Decision 表缺失、join 不完整、SQLite 错误或 reviewer 为 auto 时全部 fail closed。
- purge claim/Effect claim 失败可释放回 moved；OS 结果未知保留 purging/outcome_unknown，禁止重放。
- 新增 `tombstone_exists()`，通过 protected tombstone root、pinned parent 和普通单链接文件检查提供 reconciliation 事实。
- `reconcile_tombstone()` 从可观察状态单调收敛且从不重放副作用：delete_unknown+exists→moved；restoring+exists→释放为 moved；purging+exists→moved；purging+missing→purged。
- restoring 且 tombstone missing 时不会仅凭 destination digest 宣称成功，因为 catalog 不保存 destination 明文且尚未验证目标 identity；保持未知。
- 真实 Win32 E2E 完成 delete→moved→restore→restored，并再次 delete→human-gated purge→purged；原 bytes 在 restore 后正确恢复，purge 后 tombstone 消失。
- durable store 单测覆盖 prepare scope、restore/purge claim mismatch、状态冲突和 append-only event trigger。
- 当前 retention deadline、容量配额、安全 purge 批处理和 UI restore 入口尚未实现，故 tombstone 产品能力仍未完整验收。

### 功能点进展

| 功能点 | 进度 | 累积证据 | 尚缺验收 |
|---|---:|---|---|
| P0-F02 文件系统边界 | 80% | handle write/rename/tombstone/restore/purge；durable catalog；writable/control/reparse/hardlink enforcement；真实恢复 E2E | file.read、业务工具全面接线、retention/quota、AppContainer OS view、路径/TOCTOU/打包 E2E |
| P0-F07 Proposal/Grant/执行绑定 | 95% | delete execution→tombstone、restore deletion+destination、purge deletion identity/human Grant 精确绑定 | 所有实际工具迁移及跨平台/语义等价完整攻击套件 |
| P1-F06 Exactly-once | 95% | tombstone prepare/move/restore/purge 单赢家、deterministic reconciliation、未知状态不重放 | 跨进程逐阶段 crash harness、retention/purge batch补偿和运维工作流 |
| P0-F10 迁移/fail-closed | 95% | adapter/catalog 已覆盖 mutation lifecycle | 业务入口迁移、裸调用门禁清零、打包验收和升级回滚 |
| 其余既有功能点 | 不变 | 见前轮 | 继续按三份方案推进 |

折算：上轮累计 1875 分；本轮增加 `10+5+10=25` 分；`1900 / (30 × 100) = 63.33%`，显示为 63%。

### 本轮测试

- tombstone store + filesystem execution 专项：21 passed。
- filesystem primitive/adapter 组合：34 passed。
- 安全域综合回归：382 passed、1 skipped。
- 覆盖真实 restore/purge、deterministic catalog、scope reuse、append-only、并发 restore、delete_unknown reconciliation、irreversible declaration和 human-derived Grant。
- 综合回归数据根位于 workspace，结束后按绝对前缀校验并清理。

### 下一轮

1. 增加 tombstone retention policy、容量/数量 quota、到期 purge proposal 批次和明确 human review；后台任务不能自行永久删除。
2. 为 restoring missing 等未知状态记录 destination object identity/receipt proof，构建不重放的跨进程 reconciliation 与人工处置 API。
3. 实现授权 `file.read` receipt，并迁移现有 read/write/edit 工具调用点到 Runtime adapter；客户端协议保持不变。
4. 扩展 AST 发布门禁并盘点所有裸文件 mutation 调用，逐项建立 owner、迁移状态和发布例外到期日。

## 第 26 轮

日期：2026-08-16  
总体进展：**64%**（折算分较上轮 +10；`1910 / 3000 = 63.67%`，显示为 64%）  
完全验收：**0 / 30**  
当前阶段：授权 `file.read`、无内容 hash-chain 回执与真实调用链盘点

### 本轮完成

- `AuthorizedFilesystemExecutionService` 新增 `file.read` 执行路径；读取必须声明 `filesystem.read` capability，并由 active Profile 明确许可。
- `read_payload()` 将 canonical relative path 与 `max_bytes` 精确绑定到 Proposal；路径或大小替换均在任何文件 I/O 前拒绝。
- `max_bytes` 必须为正整数且不能超过 Runtime 16 MiB 上限；实际文件大于批准上限时由 handle-backed Broker 拒绝。
- read 不创建或消费 Approval Grant：安全、只读、Profile 已许可的动作无需人为批准，避免把 Approval 变成通用控制面。
- read 仍验证 filesystem broker root 与 Profile workspace root 完全一致，并拒绝 `.git`、`.agents`、`.codex`、`.opendrsai-trash` 控制路径。
- Windows 实际读取继续经过 `WindowsWorkspaceFilesystem.read_bytes()` 的 handle-pinned、reparse、hardlink 与对象类型检查。
- 新增 `FilesystemReadResult` 与 `FilesystemReadReceipt`；内容仅返回给调用方，receipt 只含路径摘要、内容摘要、大小、上限、Profile/backend 绑定和完成状态。
- 成功 read 写入统一 `SecurityEventJournal` hash chain；SQLite 不保存文件内容或明文相对路径，回执可验证前序链和内容摘要。
- 真实调用链盘点确认：新边界当前通过 `RuntimeEngine.authorized_filesystem_execution()` 暴露；历史 `runtime/security.py::SecureWorkspaceFS` 及 Runtime 自身工件/适配器的裸 `Path.read_bytes/write_bytes` 仍并存。
- 本轮没有把 Runtime 自身可信工件维护路径误当作 agent workspace 工具批量替换；实际 agent file tool 的业务入口尚未清晰集中，P0-F10 不虚增进度。
- 客户端 wire contract、Agent Core 决策分支和 Approval 类型均未改变。

### 功能点进展

| 功能点 | 进度 | 累计证据 | 尚缺验收 |
|---|---:|---|---|
| P0-F02 文件系统边界 | 85% | handle read/write/rename/delete/restore/purge；read path+limit/Profile 绑定；控制路径、reparse、hardlink 防线 | 实际业务工具全面接线、retention/quota、AppContainer OS view、TOCTOU 长压与打包 E2E |
| P0-F09 安全回执与可观测性 | 90% | read 成功回执进入统一 hash chain；只存路径/内容摘要和大小，不存内容 | mutation 全量入链、审计导出、告警 SLO、跨日志锚定与高并发压力 |
| P0-F10 迁移/fail-closed | 95% | Runtime 工厂已覆盖 read 与 mutation，调用图已盘点 | 找到并迁移真实 agent file tool 入口、legacy 裸入口发布门禁清零、打包与升级回滚验收 |
| 其余既有功能点 | 不变 | 见前轮 | 继续按三份方案推进 |

折算：上轮累计 1900 分；本轮增加 `5+5=10` 分；`1910 / (30 × 100) = 63.67%`，显示为 64%。

### 本轮测试

- authorized filesystem execution 专项：24 passed。
- 安全域综合回归：389 passed，1 skipped。
- 覆盖无 Grant 读取、路径/上限替换、Profile root/capability 拒绝、控制路径拒绝、过大文件、秘密不落库、hash-chain 校验和真实 Win32 handle-backed read。

### 下一轮

1. 为 legacy 裸文件 API 建立可执行静态发布门禁与带 owner/到期日的最小例外清单，先阻止新增绕过。
2. 沿 Tool Registry/agent tool dispatcher 继续定位真实 workspace file read/write/edit 入口；找到后只迁移该入口到 Runtime adapter，不改客户端消息协议。
3. 将 write/rename/delete/restore/purge 成功、失败和 outcome_unknown 事件统一纳入 hash-chain journal，并补 secret/path redaction 验收。
4. 增加 tombstone retention、容量/数量 quota 和人工批准的到期批量 purge 工作流。

## 第 27 轮

日期：2026-08-16  
总体进展：**64%**（折算分较上轮 +8；`1918 / 3000 = 63.93%`，显示为 64%）  
完全验收：**0 / 30**  
当前阶段：裸文件副作用发布门禁与真实 `run_read` 最小迁移

### 本轮完成

- 扩展 `security_boundary/static_scan.py`：除进程与网络 API 外，开始扫描 `Path.write_text/write_bytes/unlink/rmdir/rename`、`os.remove/unlink/rename/replace` 及写模式 `open/aiofiles.open`。
- `open(..., "r")` 等只读模式不会误报；`w/a/x/+` 模式统一归类为 `open[write-mode]`，避免通过换一种文件打开写法绕过发布门禁。
- 发布例外由原来的 count/owner/reason 扩展为强制 `expires_on`；日期格式非法或到期时整个门禁 fail closed。
- 重建当前例外清单，为每个裸入口记录精确 fingerprint、调用数量、`runtime-security` owner、迁移原因和到期日。
- `run_write` 与 `run_edit` 两个真实 agent 工具的裸 `aiofiles.open` 例外采用最短期限 2026-09-15；legacy `SecureWorkspaceFS` 例外到期 2026-09-30。
- Runtime artifact/image/key 等宿主维护路径与 agent workspace authority 分开登记，没有把所有文件 I/O 错误地视为同一权限域。
- 定位真实 agent 文件工具：`operater_funs.py` 中的 `run_read/run_write/run_edit`，且 Tool Registry 将其归入 workspace decision domain。
- 完成首个真实入口迁移：Windows 上的 `run_read` 不再使用路径解析后裸 `aiofiles.open`，而是调用 `WindowsWorkspaceFilesystem.read_bytes()`。
- `run_read` 的工具名、参数、返回字符串、Registry metadata 和客户端 wire contract 均未改变；TUI/WebUI 不需要适配。
- 真实入口现在继承 handle-pinned directory traversal、reparse-point、hardlink、对象类型和 16 MiB 上限防线。
- `run_read` 新增 `.git/.agents/.codex/.opendrsai-trash` 控制路径拒绝；错误只返回安全错误，不泄露被保护文件内容。
- 使用 lazy import 避免 Agent 模块初始化与 backend package 形成循环依赖；专项测试验证 import graph 正常。
- 非 Windows 路径暂保留原只读实现以保持平台兼容；因此跨平台统一 OS 边界尚未验收。
- `run_write/run_edit` 尚未直接替换：它们需要 Runtime 提供真实 Proposal/Profile/Grant/Effect 上下文，不能仅把 `aiofiles.open` 换成另一个裸写 API 后宣称完成授权闭环。

### 功能点进展

| 功能点 | 进度 | 累计证据 | 尚缺验收 |
|---|---:|---|---|
| P0-F02 文件系统边界 | 88% | 首个真实 agent `run_read` 已走 Windows handle Broker；控制路径、hardlink、reparse 与大小边界 | `run_write/run_edit` 授权接线、非 Windows 等价边界、retention/quota、AppContainer view、长压与打包 E2E |
| P0-F07 Proposal/Grant/执行绑定 | 97% | Registry 已识别真实 workspace 工具，裸 mutation 被静态门禁；adapter 覆盖完整文件操作语义 | `run_write/run_edit` 获得 Runtime Proposal/Grant/Effect 上下文及跨工具绕过全集 |
| P0-F10 迁移/fail-closed | 98% | 裸进程/网络/文件副作用统一门禁；例外具名、限量、带 owner/原因/到期日；真实 read 已迁移 | 两个真实 mutation 工具、其他到期例外清零、CI 发布任务/打包/升级回滚验收 |
| 其余既有功能点 | 不变 | 见前轮 | 继续按三份方案推进 |

折算：上轮累计 1910 分；本轮增加 `3+2+3=8` 分；`1918 / (30 × 100) = 63.93%`，显示为 64%。

### 本轮测试

- static gate + 真实 operator file boundary + filesystem execution 专项：30 passed。
- 扩展安全域/Agent Kernel 综合回归：504 passed，1 skipped。
- 覆盖写模式识别、只读模式不误报、过期例外 fail closed、完整 baseline 零新增、真实 run_read、控制路径拒绝、hardlink 拒绝，以及既有 Proposal/Profile/Grant/Effect 文件执行回归。

### 下一轮

1. 在 Desktop Runtime adapter 内建立不改变 Tool schema 的 workspace mutation execution context，把 Run/Profile/Proposal/Grant 传给真实 `run_write` special handler。
2. 明确 `run_edit` 的等价语义：handle-backed read 后绑定原内容摘要、唯一匹配位置和新内容摘要，再以单次 Grant 原子写入；拒绝 read-modify-write 竞争。
3. 将 mutation 成功、失败和 outcome_unknown 事件统一纳入 hash-chain journal，并把裸 `run_write/run_edit` 例外数量降为零。
4. 把静态门禁接入正式 CI/release verifier，而不只依赖 pytest 收集执行。

## 第 28 轮

日期：2026-08-16  
总体进展：**64%**（折算分较上轮 +8；`1926 / 3000 = 64.20%`）  
完全验收：**0 / 30**  
当前阶段：Permission Mode/Broker capability 对齐与文件 mutation 全量链式审计

### 本轮完成

- 核对 Desktop Kernel 完整审批时序：required tool 在 `APPROVAL_REQUEST → APPROVAL_RESULT(approved) → TOOL_CALL_REQUEST` 后才执行，special handler 仅收到原始 call payload。
- 发现并明确记录关键集成缺口：Desktop Agent Kernel 自建 `desktop-*` Run，而 Permission Mode binding 当前属于 RuntimeEngine Run；两者尚无不可伪造的同一 Run 身份绑定。
- 当前 Desktop metadata 将 `run_write/run_edit` 标为 `local_write + approval_mode=none`；在没有 effective profile 的情况下直接自签 Grant 会绕过 manual/auto/full-access 三种 reviewer route，因此本轮没有采用该不安全捷径。
- 修复 Permission Mode 与文件 Broker capability 命名不一致：稳定 Profile 现在同时包含产品语义 `file.*` 与执行边界语义 `filesystem.*`。
- `manual_safe` 默认只读能力新增 `filesystem.read`；development ceiling 新增 `filesystem.write/rename/delete/restore/purge`。
- writable root 解析同时识别 `file.write` 和 `filesystem.write`；由产品 Mode resolver 生成的 Profile 可直接传给 `AuthorizedFilesystemExecutionService`，无需旁路或临时扩权。
- 增加契约测试，证明 manual_safe 在用户明确请求 `filesystem.write` 后，生成的 Profile 可许可精确文件 Proposal，且 writable root 仍被限制为当前 Workspace。
- `file.write` 成功后新增 `filesystem.mutation_succeeded` hash-chain 事件，绑定 Run、Proposal、Profile、backend、路径摘要、内容摘要、大小和 receipt digest。
- rename/delete/restore/purge 成功事件统一进入相同事件类型，使用 resource digest 和可选 recovery-reference digest，不保存明文路径或 tombstone host path。
- 所有文件 mutation 的 OS 调用异常新增 `filesystem.mutation_outcome_unknown` 事件；记录错误类型和不可重放 receipt marker，不记录异常文本、文件内容或秘密。
- outcome_unknown 审计失败不会覆盖原始 OS 异常；Grant 仍保持已消费，Effect 仍保持不可重放。
- hash-chain 测试验证 write 与完整 rename→delete→restore→delete→purge 生命周期的事件顺序、receipt 对应关系和链完整性。
- 本轮未接真实 `run_write/run_edit`：前置条件是 Gateway/Runtime 为 Desktop Kernel Run 注入同一 Runtime Run ID、effective Profile digest 和 reviewer route，并在 tool approval 后生成可验证 Grant。

### 功能点进展

| 功能点 | 进度 | 累计证据 | 尚缺验收 |
|---|---:|---|---|
| P0-F09 安全回执与可观测性 | 95% | read 及全部文件 mutation 成功/outcome_unknown 已进入统一 hash chain；内容、路径和异常文本脱敏 | 审计导出、跨日志外部锚定、SLO/告警和高并发/磁盘故障压力 |
| P2-F01 三 Profile 稳定契约 | 63% | 产品 `file.*` 与 Broker `filesystem.*` capability 已对齐，Resolver Profile 可直接授权执行边界 | 客户端 contract suite、版本协商、正式发布及旧 descriptor 兼容验证 |
| P0-F10 迁移/fail-closed | 98% | 明确识别 Agent Run/Runtime Run 未绑定并拒绝自签 Grant 捷径 | Runtime identity/profile/reviewer context 接线后迁移真实 write/edit，清零例外并完成发布验收 |
| 其余既有功能点 | 不变 | 见前轮 | 继续按三份方案推进 |

折算：上轮累计 1918 分；本轮增加 `5+3=8` 分；`1926 / (30 × 100) = 64.20%`。

### 本轮测试

- filesystem execution + Permission Mode 专项：49 passed（综合集合中执行）。
- 扩展安全域/Agent Kernel 综合回归：505 passed，1 skipped。
- 覆盖 Profile capability 对齐、writable root、write/mutation success 事件、outcome_unknown、秘密不落库、事件顺序和 hash-chain 完整性。

### 下一轮

1. 建立 Gateway-owned Desktop security execution binding：Runtime Run ID、Workspace identity、effective Profile digest、mode/reviewer route 和 Runtime database 必须作为一个不可变 turn-scoped context 注入。
2. 让 Desktop tool registry 的 `run_write/run_edit` approval policy 从 effective mode 派生：manual=human、auto=AutoReviewer、isolated-full=仅 attestation 健康时 none。
3. 在批准或免批决策后由 Runtime authorization service 生成精确 Grant，special handler 只能消费 Grant，不能创建权限。
4. 完成真实 `run_write` 迁移；随后设计具备 source digest/唯一匹配/并发冲突拒绝的 `run_edit` compare-and-swap 语义。

## 第 29 轮

日期：2026-08-16  
总体进展：**65%**（折算分较上轮 +15；`1941 / 3000 = 64.70%`，显示为 65%）  
完全验收：**0 / 30**  
当前阶段：Gateway-owned Desktop security execution binding

### 本轮完成

- 新增 `desktop_security_binding.py`，定义 frozen `DesktopSecurityExecutionBinding`，作为一个 Desktop Agent turn 的 Runtime-owned 安全上下文。
- binding 绑定 schema/binding ID、Runtime Run、Session、Workspace、规范化 Workspace root、Runtime database、完整 frozen Profile、Mode、reviewer route、effective descriptor digest 和签发时间。
- `binding_digest` 对所有安全字段做 canonical digest；修改 workspace、mode、route、Profile、database 或任何身份字段都会在使用前被识别。
- 创建 binding 时重新读取 Runtime durable Run，验证 context 中的 session/workspace 与数据库一致。
- 创建 binding 时同时读取 active security Profile 和 effective Permission Mode descriptor，并验证 descriptor.profile_digest 与 active Profile 完全一致。
- Profile workspace root 必须与 RuntimeRunContext.workspace_path 一致；不能拿另一个 Workspace 的 Profile 给当前 Desktop turn 使用。
- validation 每次重新查询 `runtime_run_security_profiles` 和最新 Permission Mode binding，而不是只相信 turn 开始时的内存对象。
- Mode/Profile 在 turn 内发生切换时旧 binding 立即 stale；后续工具执行必须 fail closed，不可沿用旧能力。
- validation 重新查询 `runtime_runs`，仅 queued/running Run 可继续；终态 Run、换 Session/Workspace 或记录缺失均拒绝。
- `GatewayOpenDrSaiAgentBackend` 在生产 Runtime state 具备完整权威接口时创建 binding，并通过内部 `run_kwargs` 传给 AgentManager。
- AgentManager 仅把 binding 作为 turn-scoped 私有属性注入；finally 恢复旧值或删除属性，长寿命 Agent 不会把一个 Run 的权限泄露到下一 Run。
- Desktop adapter 在构建 Tool Registry 和调用模型前验证 binding；篡改/过期上下文在任何 Tool 暴露或执行前终止。
- 自定义/测试 Runtime state 若不实现完整 security authority 接口，不会被强行当作权威源；保持已有 Backend extension/测试 runner 兼容。
- 没有新增客户端字段、OAEP 消息、TUI/WebUI contract 或 Agent Core 决策分支；全部接线位于 Gateway、AgentManager turn scope 与 Desktop Runtime adapter。
- 旧 Run 若没有 active Profile 或 Permission Mode，暂不注入 binding；这保持现有兼容路径，但其 `run_write/run_edit` 还未允许进入新的 Grant 执行路径。

### 功能点进展

| 功能点 | 进度 | 累计证据 | 尚缺验收 |
|---|---:|---|---|
| P0-F01 不可变能力配置 | 80% | Runtime Run/Session/Workspace/Profile/Mode/reviewer route 形成不可变 turn binding，并在使用时重读持久状态 | 所有 Run 自动解析默认 Profile、组织策略签名、跨进程恢复和完整属性测试 |
| P2-F06 安全模式切换 | 80% | turn 内 Mode/Profile 改变会使 Desktop binding stale，旧权限不能继续执行 | AutoReviewer in-flight、断线/后台/计划任务、跨进程切换与大并发 E2E |
| P0-F10 迁移/fail-closed | 98% | Gateway→AgentManager→Desktop adapter 已有安全身份通道，且不改客户端协议 | reviewer route 驱动 registry/Grant，迁移 write/edit，清零 legacy 例外并完成发布验收 |
| 其余既有功能点 | 不变 | 见前轮 | 继续按三份方案推进 |

折算：上轮累计 1926 分；本轮增加 `10+5=15` 分；`1941 / (30 × 100) = 64.70%`，显示为 65%。

### 本轮测试

- RuntimeEngine/binding 专项：51 passed。
- Gateway Approval 专项：46 passed。
- Desktop Agent Kernel adapter 专项：34 passed。
- 安全域组合回归：505 passed，1 skipped。
- 覆盖 binding digest 篡改、跨 Session、Workspace root、缺失 Mode、Profile/Mode 切换 stale、Runtime durable identity 和既有 Approval/Kernel 兼容。
- 已知非本轮回归：`test_gateway_opendrsai_backend.py` 独立运行仍有 3 个既有失败——一个 logger/caplog 捕获不一致，两个 artifact 测试 mock 的 RuntimeEngine 缺少 `get_session`。因此未宣称全仓绿色。

### 下一轮

1. 从 binding.reviewer_route 动态派生 `run_write/run_edit` Registry policy：manual→required human，auto→Runtime AutoReviewer route，isolated-full→仅 isolation attestation 持续有效时 none。
2. 将 Kernel approval result 与 Runtime Approval Request/Decision/GrantService 关联；special handler 只能获得并消费既有精确 Grant。
3. 迁移真实 `run_write` 到 `AuthorizedFilesystemExecutionService.write()`，并删除对应裸 `aiofiles.open` 例外。
4. 修复或隔离三个现有 Gateway backend 测试基线问题，恢复更大组合回归的可信度。

## 第 30 轮

日期：2026-08-16  
总体进展：**65%**（折算分较上轮 +22；`1963 / 3000 = 65.43%`，显示为 65%）  
完全验收：**0 / 30**  
当前阶段：Desktop `run_write` 的真实 Runtime Approval/Grant/Effect 执行链

### 本轮完成

- Desktop adapter 对存在安全 binding 的 `run_write/run_edit` 强制标记为 `local_write + approval_mode=required`；不能沿用旧 Registry 中的免批配置。
- Gateway Approval 卡片不再只展示泛化工具名：`run_write` 绑定规范相对路径、内容摘要和字节数；明文文件内容不进入 Approval 数据库。
- `manual_safe` 路由形成真实链路：客户端一次批准 → 不可变 ActionProposal → Approval Request → human Decision → GrantService 重验并签发精确 Grant。
- Proposal ID 由 Runtime Run 与 tool call ID 确定性派生；Grant 绑定 Proposal、Run、Profile digest、reviewer kind、能力、路径、内容摘要和大小。
- 新增 `validate_desktop_authorization_grant()`，执行前从数据库联查 Request、Decision、Approval Grant 与 Authorization Grant，校验它们均属于当前不可变 Desktop binding。
- 直接由底层 Store 构造、没有合法 review 链的 Authorization Grant 会被拒绝；special handler 不能自行创造权限。
- Desktop `run_write` special handler 只消费 Gateway 交付的 `grant_id + proposal_id`，随后调用 `AuthorizedFilesystemExecutionService.write()`；生产绑定路径不再调用 Workbench 写文件。
- 写执行使用现有 handle-backed Windows filesystem primitive，并继承 exact Proposal/Profile/Grant、单次 Effect claim、安全回执和 hash-chain 审计。
- 工具 schema、模型 tool call 参数、OAEP、TUI/WebUI 消息协议均未改变；改动限制在 Gateway、Runtime binding、Desktop adapter 与授权服务边界。
- `auto_review` 与 `isolated_full` 当前在 Desktop workspace mutation 上保持 fail closed：在 reviewer route 真正接入 AutoReviewer 或 isolation attestation 之前，不会借用 human Approval 伪装为已授权。
- 共享 TUI/legacy `operater_funs.py` 中的 `run_write` 裸 `aiofiles.open` 仍存在，因此静态门禁例外尚不能删除；`run_edit` 也尚未迁移，不能宣称 P0 完成。

### 功能点进展

| 功能点 | 进度 | 累计证据 | 尚缺验收 |
|---|---:|---|---|
| P0-F02 文件系统边界 | 92% | 真实 Desktop `run_write` 已消费 Runtime Grant 并走 handle-backed write，Workbench 不可触达 | `run_edit`、TUI/legacy write、非 Windows 等价边界、retention/quota、AppContainer view 与打包 E2E |
| P0-F07 Proposal/Grant/执行绑定 | 99% | Desktop mutation 执行前联查 binding、Proposal、Request、Decision、Grant，参数替换或伪造 Grant 均 fail closed | 全部 mutation 工具和跨进程恢复验收 |
| P1-F01 标准 ActionProposal | 55% | 真实 Desktop write 已生成不可变 Proposal，绑定路径/内容摘要/大小且明文不落库 | Codex/MCP/全部 legacy 路径迁移、golden contract 与完整发布门禁 |
| P1-F02 Policy 与 Approval 分离 | 75% | UI Approval 只产生 human Decision；GrantService 依据当前 Profile/Policy/route 重验后签发，执行器只消费 Grant | auto/full reviewer、组织策略完整矩阵及所有真实入口接管 |
| P1-F07 统一 reviewer 与 adapter 协议 | 70% | Desktop human route 已进入统一 Request/Decision/Grant 链，route 不匹配拒绝 | AutoReviewer/isolated route 实接线、跨客户端接力和版本兼容 E2E |
| P0-F10 迁移/fail-closed | 99% | 真实 Desktop write 已迁移；缺少权威 binding、合法 reviewer 或精确 Grant 均不可执行 | `run_edit` 与 TUI/legacy write 迁移、静态例外清零、CI/打包/升级回滚验收 |
| 其余既有功能点 | 不变 | 见前轮 | 继续按三份方案推进 |

折算：上轮累计 1941 分；本轮增加 `4+2+5+5+5+1=22` 分；`1963 / (30 × 100) = 65.43%`，显示为 65%。

### 本轮测试

- RuntimeEngine/binding 专项：51 passed。
- Gateway Approval/authorization 专项：76 passed。
- Desktop Agent Kernel adapter 专项：35 passed。
- 扩展安全域/Agent Kernel 综合回归：506 passed，1 skipped。
- 新增 Windows 真实写入验收：模型发起 `run_write`，review handler 建立真实 Proposal/Request/Decision/Grant，special handler 写入文件；若调用 Workbench 测试立即失败。
- 新增伪造授权验收：绕过 Approval 链直接签发的 Authorization Grant 被 Desktop binding validator 拒绝。
- 已知非本轮回归仍为 `test_gateway_opendrsai_backend.py` 的 3 个既有失败：logger/caplog 捕获不一致，以及两个 artifact mock 缺少 `get_session`；未宣称全仓绿色。

### 下一轮

1. 为 `run_edit` 定义并实现 compare-and-swap Proposal：绑定源内容摘要、唯一匹配位置、新内容摘要与目标大小，冲突时拒绝而非覆盖。
2. 把 TUI/legacy `run_write/run_edit` 接入同一 Runtime binding/Grant execution service，随后删除两条裸文件写静态例外。
3. 接入真实 AutoReviewer route；auto 模式只能使用统一 reviewer 决策，不能经 human callback 或 adapter 自签 Grant。
4. 为 isolated-full 增加持续有效的 OS isolation attestation；attestation 缺失、过期或降级时回退为 fail closed。

## 第 31 轮

日期：2026-08-16  
总体进展：**66%**（折算分较上轮 +22；`1985 / 3000 = 66.17%`，显示为 66%）  
完全验收：**0 / 30**  
当前阶段：Desktop `run_edit` 的源版本绑定与 compare-and-swap 执行

### 本轮完成

- 为 `AuthorizedFilesystemExecutionService` 增加正式 `file.edit` 执行语义，不再把 edit 简化为普通覆盖写入。
- edit Proposal 精确绑定规范相对路径、源内容摘要、old/new 文本摘要、唯一匹配计数、结果内容摘要与结果字节数。
- old text 必须非空且在批准时读取的 UTF-8 源版本中恰好出现一次；0 次或多次均在请求 Approval 前拒绝，避免歧义替换。
- Approval 展示只包含路径、源版本摘要、结果摘要和大小；old text、new text、源文件内容与结果内容均不进入旧 Approval 或统一 authorization 数据库。
- Gateway 在显示 human Approval 前通过 Windows handle-backed Broker 读取源版本并生成不可变 Proposal；批准后由统一 Request/Decision/GrantService 签发精确 Grant。
- `run_edit` 与 `run_write` 共用 Desktop security binding 和 Grant route 校验；reviewer route 不是 human 时在创建 human Approval 前 fail closed，避免展示一个永远不能授权当前模式的无效批准框。
- Desktop adapter 新增 `run_edit` special handler；只接受 Approval callback 交付的既有 `grant_id + proposal_id`，重新验证 binding/reviewer/Grant 后调用授权文件服务。
- 生产绑定的 `run_edit` 不再调用 Workbench；工具名称、参数 schema、返回形态和 TUI/WebUI/OAEP 协议保持不变。
- Windows filesystem Broker 新增 workspace-scoped CAS：在 Runtime 内串行 edit，最终 handle-backed 读取必须仍匹配已批准源摘要，随后才执行原子替换。
- CAS 冲突在能够证明没有替换时记为确定性 `failed` Effect，并消费单次 Grant，要求重新 Proposal/Approval；不会覆盖新版本，也不会把旧 Grant 变回可重放。
- OS 调用开始后无法证明结果的异常仍进入 `outcome_unknown`，保持“不确定结果绝不盲目重放”的既有原则。
- 共享 TUI/legacy `operater_funs.py::run_edit` 仍保留裸 `aiofiles.open`，因此其静态例外仍存在；本轮只完成有权威 Runtime binding 的 Desktop 生产路径迁移。

### 功能点进展

| 功能点 | 进度 | 累计证据 | 尚缺验收 |
|---|---:|---|---|
| P0-F02 文件系统边界 | 95% | 真实 Desktop read/write/edit 均进入 handle-backed Broker；edit 绑定源摘要并 CAS 拒绝冲突 | TUI/legacy mutation、非 Windows 等价边界、跨进程/外部写入长压、retention/quota、AppContainer view 与打包 E2E |
| P0-F07 Proposal/Grant/执行绑定 | 99% | edit 绑定源、匹配、替换与结果摘要，执行前联查完整 reviewer/Grant 链 | 所有客户端 mutation 入口与跨进程恢复完整验收 |
| P1-F01 标准 ActionProposal | 60% | 真实 write/edit 均生成不可变精确 Proposal，原始秘密只存在内存且不落数据库 | Codex/MCP/全部 legacy 路径迁移、golden contract 与发布门禁 |
| P1-F02 Policy 与 Approval 分离 | 78% | human Approval 只形成 Decision；GrantService 重验；非 human route 不再错误弹出 human Approval | AutoReviewer/isolated attestation 实接线、组织策略完整矩阵及全部入口接管 |
| P1-F06 Exactly-once Grant/副作用 | 96% | edit CAS 冲突确定失败且 Grant 不可重放；OS 未知结果保持 outcome_unknown | 跨进程逐阶段 crash harness、外部系统补偿及完整运维 reconciliation |
| P1-F08 Approval 展示与决策质量 | 10% | edit 卡片后端载荷具备目标路径、源/结果摘要、大小且 secret-free | Desktop/TUI/WebUI snapshot、风险/不可逆性文案、Unicode/控制字符、无障碍与本地化验收 |
| 其余既有功能点 | 不变 | 见前轮 | 继续按三份方案推进 |

折算：上轮累计 1963 分；本轮增加 `3+5+3+1+10=22` 分；`1985 / (30 × 100) = 66.17%`，显示为 66%。

### 本轮测试

- 文件执行、真实 Windows Broker 与 Desktop adapter 专项：82 passed。
- Runtime/authorization/Desktop 组合专项：145 passed。
- Gateway Approval 全套：47 passed。
- 扩展安全域/Agent Kernel 综合回归：513 passed，1 skipped。
- 覆盖 edit 成功、路径/old/new 参数替换、0 次/多次匹配、源版本 CAS 冲突、Grant 单次消费、确定失败/outcome_unknown 区分、Workbench 不可触达和秘密不落库。
- Gateway 真实 Runtime 集成测试验证：human Approval 安全载荷 → immutable edit Proposal → Request/Decision/Grant，且源/替换文本均不落数据库。
- Python compileall 通过；全仓三个既有 Gateway backend 基线失败仍未计入绿色范围。

### 下一轮

1. 将 TUI/legacy `run_write/run_edit` 从 `operater_funs.py` 迁移到 Runtime authorization adapter，删除对应两条裸文件写静态例外。
2. 增加跨进程 edit CAS 压测与外部 writer 竞争测试；评估使用文件 identity/USN/oplock 进一步收紧最终摘要检查到原子替换之间的 Windows 竞争窗。
3. 接入真实 AutoReviewer route，使 `auto_reviewed` mutation 通过统一 reviewer 决策而非 human callback，并补 denial/escalation E2E。
4. 为 `isolated_full` 接入持续 isolation attestation 与过期/降级回退，随后开始三模式客户端 contract/snapshot 验收。

## 第 32 轮

日期：2026-08-16  
总体进展：**67%**（折算分较上轮 +20；`2005 / 3000 = 66.83%`，显示为 67%）  
完全验收：**0 / 30**  
当前阶段：`auto_reviewed` Desktop workspace mutation 的真实 Reviewer/Decision/Grant 路由

### 本轮完成

- RuntimeEngine 新增 durable effective Permission Profile 重建：从当前 mode descriptor 与 active Profile 恢复完整 `EffectivePermissionProfile`，并对 mode/profile/effective descriptor 做 canonical 一致性验证。
- RuntimeEngine 新增 `route_auto_authorization_review()` 编排入口：创建 reviewer_kind=`auto` Request，调用 AutoReviewCoordinator 写入 Decision；该入口仍不能直接签发 Grant。
- Gateway 对有 Desktop security binding 的 `run_write/run_edit` 在任何 reviewer 路由前先建立精确不可变 Proposal；human 与 auto 不再使用两套操作语义。
- `auto_reviewed` 不创建旧 human Approval：Gateway 调用 Runtime AutoReviewer，只有 auto Decision 为 approved 后才调用 GrantService，以 `review_requirement=auto` 二次重验并签发 Grant。
- 自动拒绝返回 tool-level denial，不取消 Run、不创建 human Approval、也不产生 Grant；受保护的 `.git/.agents/.codex/.opendrsai-trash` 路径会由规则直接拒绝。
- 自动升级路径保留：AutoReviewer 取消原 auto Request 并创建同 Proposal/Profile 的 human Request；用户批准后只能为该 escalation Request 签发 human Grant。
- Desktop Grant validator 支持两种可证明链：binding route=`auto` 的直接 auto Request/Decision，或 `runtime_auto_review_routes` 中状态为 applied 的 auto→human escalation；任意普通 human Grant 不能冒充 auto escalation。
- AutoReviewer 新增保守的 bounded local mutation 规则：仅 `file.write/file.edit`、仅 `filesystem.write`、无风险类别、且 Proposal 具备完整路径/内容或源版本/结果摘要字段时自动批准。
- 强制人工类别、Hard Deny、能力不足、Proposal 不完整、critical/production/irreversible/unknown 风险仍优先拒绝或升级；模型无法覆盖规则。
- `run_write` 和 `run_edit` 的真实 Desktop special handler 均新增 manual/auto 参数化 E2E：两条 route 最终都消费精确 Grant、走 handle-backed 文件边界且 Workbench 不可触达。
- 未修改 Agent Core、工具 schema、TUI/WebUI/OAEP 协议；`manual_safe` 行为保持兼容，`isolated_full_access` mutation 继续 fail closed。

### 功能点进展

| 功能点 | 进度 | 累计证据 | 尚缺验收 |
|---|---:|---|---|
| P1-F02 Policy 与 Approval 分离 | 83% | human/auto Policy route 分离；AutoReviewer 只写 Decision，GrantService 使用当前 Profile/Policy/kill switch 重验 | isolated attestation、组织策略全矩阵、所有 shell/network/MCP/legacy 入口接管 |
| P1-F07 统一 reviewer 与 adapter 协议 | 75% | Desktop human、direct auto、auto→human escalation 均进入同一 Request/Decision/Grant/validator 链 | 跨客户端接力、断线恢复、Android/OAEP/Codex contract suite 与版本升级 |
| P2-F03 帮我批准模式 | 85% | 真实 Desktop write/edit 自动批准/拒绝，无旧 human Approval；规则优先、控制路径拒绝、升级链可证明 | 真实独立 reviewer 模型、大样本签字阈值、完整 human escalation UI E2E、灰度/回滚 |
| 其余既有功能点 | 不变 | 见前轮 | 继续按三份方案推进 |

折算：上轮累计 1985 分；本轮增加 `5+5+10=20` 分；`2005 / (30 × 100) = 66.83%`，显示为 67%。

### 本轮测试

- AutoReviewer/Coordinator/Gateway/Runtime/Desktop 组合专项：171 passed。
- 自动路由核心专项：35 passed。
- 真实 Desktop `run_write` manual/auto：2 passed；真实 `run_edit` manual/auto：2 passed。
- 扩展安全域/Agent Kernel 综合回归：522 passed，1 skipped。
- 覆盖完整 bounded mutation 规则批准、受保护路径自动拒绝、强制人工类别升级、direct auto Grant、可证明的人类 escalation Grant、秘密不落库和 Workbench 不可触达。
- Python compileall 与 `git diff --check` 通过；仅有仓库既有 LF→CRLF 提示。
- 全仓三个既有 Gateway backend 基线失败仍未计入绿色范围。

### 下一轮

1. 完成 auto→human escalation 的 Gateway+真实 Desktop 执行 E2E，包括拒绝、超时、断线恢复和同一 Proposal 接力。
2. 在 mode transition/kill switch 发生于 AutoReviewer Decision 与 Grant/Effect 之间时做并发测试，证明旧 auto Decision 不会执行。
3. 接入 `isolated_full_access` 的持续 OS isolation attestation，使 reviewer route=`none` 只能在健康、未过期、scope 匹配的隔离会话内执行。
4. 继续迁移 TUI/legacy `run_write/run_edit`，但通过 Runtime adapter 保持客户端协议不变，并清零两条裸文件写静态例外。

## 第 33 轮

日期：2026-08-16  
总体进展：**68%**（折算分较上轮 +30；`2035 / 3000 = 67.83%`，显示为 68%）  
完全验收：**0 / 30**  
当前阶段：AutoReviewer in-flight 撤权与 auto→human escalation 终态闭环

### 本轮完成

- 增加真实 AutoReviewer Decision→Grant 竞争验收：auto Decision 已 approved 后切换到 `manual_safe`，旧 Profile 无法签发 Grant，Request 不会产生授权。
- 增加 Grant→Effect 模式切换验收：auto Grant 已签发但尚未执行时降级到 `manual_safe`，Grant 被撤销，Effect claim 返回 `grant_revoked`，文件系统调用次数为零。
- 增加 Grant→Effect kill switch 验收：auto Grant 签发后启用 `auto_reviewer` kill switch，受影响 Run 的未消费 Grant 被撤销；Effect claim 在 I/O 前拒绝。
- 上述 gate 同时依赖持久 mode binding、active Profile、transition journal、kill-switch event 和 Grant revoked 状态，不依赖 Desktop 内存缓存。
- 完成 Gateway auto→human escalation 接力 E2E：AutoReviewer 取消 auto Request，创建同 Proposal/Profile 的 human Request，旧客户端只看到一次兼容 Approval。
- human approve 后统一 human Request 进入 approved，GrantService 以 human requirement 重验；Desktop validator 证明其来源是 applied auto escalation，而不是普通 human Grant。
- human deny 后只把对应 human Request 置为 denied，不签发 Grant、不取消整个 Run，也不留下 pending authorization。
- human Approval timeout 后 legacy Approval 进入 timeout，统一 human Request 由 system cancellation 收敛为 cancelled，不签发 Grant。
- 修复 escalation 拒绝/超时的状态泄漏：此前 `_await_approval()` 抛错会跳过统一 Request 终态写入，导致 pending human Request 残留。
- RuntimeExecutionError 现在在内部携带本次 legacy approval identity，Gateway 可将拒绝 Decision 与实际兼容 Approval 关联；错误输出仍不包含操作秘密。
- approve/deny/timeout 三条路径均复用同一个 immutable Proposal；测试验证文件内容不进入 legacy Approval、authorization Request/Decision、Grant 或审计数据库。
- 未修改 Agent Core、工具 schema 或客户端协议；兼容 Approval 仅作为 human reviewer 输入桥，不再充当实际执行权限。

### 功能点进展

| 功能点 | 进度 | 累计证据 | 尚缺验收 |
|---|---:|---|---|
| P1-F03 独立 Approval 状态机 | 88% | auto cancelled→human pending→approved/denied/cancelled 完整终态；拒绝/超时不遗留 pending | 跨进程长压、全阶段 fault injection、正式数据库升级/回滚演练 |
| P1-F05 拒绝、取消与终止解耦 | 55% | escalation deny 只拒绝操作，timeout 只取消 Request；两者均不签发 Grant或停止 Run | Agent 收到结构化拒绝后的行为 E2E、所有 adapter 迁移及旧 `resume_on_denied` 清理 |
| P1-F07 统一 reviewer 与 adapter 协议 | 80% | Gateway 真实 auto→human approve/deny/timeout 接力，同 Proposal/Profile 且 validator 可证明 | 跨客户端接力、断线/进程重启恢复、Android/OAEP/Codex contract suite |
| P2-F03 帮我批准模式 | 90% | direct auto 与 human escalation 均有真实 Gateway 路径；批准/拒绝/超时终态闭环 | 独立 reviewer 模型与签字评测、UI E2E、灰度和紧急回滚演练 |
| P2-F06 安全模式切换 | 87% | AutoReviewer Decision→Grant、Grant→Effect 的 mode transition/kill switch 竞争均在 I/O 前阻断 | 后台/计划任务/子 Agent、跨进程并发、断线恢复和大规模压力 E2E |
| 其余既有功能点 | 不变 | 见前轮 | 继续按三份方案推进 |

折算：上轮累计 2005 分；本轮增加 `3+10+5+5+7=30` 分；`2035 / (30 × 100) = 67.83%`，显示为 68%。

### 本轮测试

- Gateway/Runtime/mode/kill-switch/Desktop 组合专项：155 passed。
- auto→human escalation approve/deny/timeout：3 passed。
- Auto Decision/Grant/Effect 竞争窗口：1 个组合测试覆盖三阶段，全部通过且零文件写。
- 扩展安全域/Agent Kernel 综合回归：525 passed，1 skipped。
- 覆盖 Proposal identity 接力、reviewer route 证明、拒绝/超时 terminalization、模式降级、kill switch、Grant revoke、I/O 前阻断与秘密不落库。
- 全仓三个既有 Gateway backend 基线失败仍未计入绿色范围。

### 下一轮

1. 实现 `isolated_full_access` mutation 的持续 OS attestation gate：binding、isolation session、workspace projection、network/credential guarantees 和 Effect 必须同 scope。
2. 在 attestation 过期、worker/Job 退出、ACL projection 降级、network policy 改变或 credential scope 改变时立即撤权并拒绝新 Effect。
3. 为 auto escalation 增加 Gateway/Runtime 进程重启恢复与重复客户端决定测试，避免旧 human Approval 和统一 Request 双重恢复。
4. 继续迁移 TUI/legacy 文件工具，删除 `run_write/run_edit` 裸 `aiofiles.open` 例外并接入正式发布静态门禁。

## 第 34 轮

日期：2026-08-16  
总体进展：**68%**（折算分较上轮 +16；`2051 / 3000 = 68.37%`，显示为 68%）  
完全验收：**0 / 30**  
当前阶段：`isolated_full_access` 的作用域化、持续有效 OS isolation attestation gate

### 本轮完成

- 新增 append-only `IsolationAttestationLeaseStore`：把隔离证明精确绑定到单个 Run、规范化 Workspace、不可变 Profile digest 与 attestation evidence digest；租约和状态事件均禁止更新/删除。
- 租约启用时重新验证证明时间窗与通用隔离保证；Profile 请求网络或凭据 scope 时，还必须分别具备 `network_egress_enforced`、`credential_isolated` 保证，否则 fail closed。
- 租约不能跨 Run、Workspace、Profile 或 evidence 复用；撤销后不能重新激活同一证明，防止旧 worker/旧证明复活权限。
- Runtime 模式应用接入租约：只有 `isolated_full_access` 绑定证明，切换到其他模式立即撤销；`isolated_full_access` kill switch 会撤销所有存量租约。
- 新增窄生命周期 API：执行边界可以重验 live authority，worker/Job/ACL/network/credential 健康丢失时可以用明确 reason code 撤销，而无需让 worker 直接访问底层数据库。
- Desktop security binding 纳入 attestation digest；创建 binding 和每次重验时都查询 live lease，因此证明过期、worker 退出、mode 改变或 kill switch 后，旧 binding 在工具/模型执行前失效。
- Gateway 集成测试证明：即使存在 live scoped lease，当前没有正式 isolated Effect executor 时，`reviewer_route=none` 的宿主 `run_write` 仍返回 `desktop_workspace_reviewer_unavailable`，不会创建 Approval/Request，也不会写文件。
- 明确未把现有单命令 `WindowsIsolatedExecutionSessionService` 冒充持续沙箱：它结束后会清理 AppContainer/ACL/worker，不能证明后续宿主工具仍隔离；因此本轮没有开放“完全访问”产品路径，也没有不安全的 host fallback。
- 未修改 Agent Core、工具 schema、TUI/WebUI/OAEP 协议或客户端行为。

### 功能点进展

| 功能点 | 进度 | 累计证据 | 尚缺验收 |
|---|---:|---|---|
| P0-F01 不可变能力配置 | 83% | Mode/Profile/Run/Workspace/attestation evidence 形成不可变 scoped lease，状态只追加 | 所有执行入口接管、组织策略签名、跨进程恢复与完整属性测试 |
| P0-F03 进程/资源隔离 | 93% | 既有 Windows worker/Job/ACL 生命周期上新增持续权限租约；worker 退出可立即撤权 | packaged AppContainer 真实通用 runtime、逃逸全集、真实 worker 与租约自动接线 |
| P2-F04 隔离完全访问 | 72% | attestation 现在绑定 scope、可过期、可撤销且每次 Desktop binding 重验；无隔离 executor 时继续拒绝 | 正式 isolated Effect executor、AppContainer/ACL/network/credential 联合 canary、产品 E2E |
| P2-F06 安全模式切换 | 90% | 模式降级与 isolated kill switch 均立即撤销租约并让旧 binding 失效 | 后台/计划任务/子 Agent、跨进程并发、断线恢复和大规模压力 E2E |
| 其余既有功能点 | 不变 | 见前轮 | 继续按三份方案推进 |

折算：上轮累计 2035 分；本轮增加 `3+3+7+3=16` 分；`2051 / (30 × 100) = 68.37%`，显示为 68%。

### 本轮测试

- Round 34 专项（lease/Runtime/mode/kill-switch/Windows isolated session/Gateway）：155 passed。
- 扩展安全域/Agent Kernel 综合回归：526 passed，1 skipped。
- 覆盖精确 scope、证明过期、撤销不可复活、network/credential guarantee 缺失、worker 退出、kill switch、旧 Desktop binding 失效与 Gateway 宿主执行 fail closed。
- 全仓三个既有 Gateway backend 基线失败仍未计入绿色范围；本轮未声称全仓绿色。

### 下一轮

1. 将真实隔离 worker 生命周期与 Runtime authority API 接线，让 worker terminal、Job empty/quarantine、ACL projection、network policy 与 credential scope 变化自动撤权。
2. 设计并实现只在隔离 worker 内消费 Proposal/Grant/Effect 的 executor；在此之前保持 `reviewer_route=none` mutation fail closed。
3. 为租约绑定增加崩溃窗口与数据库重启恢复测试，处理 mode descriptor 已提交但租约建立失败的产品状态一致性。
4. 继续迁移 TUI/legacy 文件工具，删除 `run_write/run_edit` 裸 `aiofiles.open` 例外并接入正式发布静态门禁。

## 第 35 轮

日期：2026-08-16  
总体进展：**69%**（折算分较上轮 +12；`2063 / 3000 = 68.77%`，显示为 69%）  
完全验收：**0 / 30**  
当前阶段：隔离 worker 生命周期自动撤权与隔离 scope 提交前验证

### 本轮完成

- `WindowsIsolatedExecutionSessionService` 新增 Runtime-owned `authority_revoker`，在 worker 已证明 Job process tree 为空、但尚未进入 `worker_terminal` 前撤销 Run 的隔离租约。
- worker 抛错、Job empty 无法证明而进入 quarantine、进程重启恢复未完成 Session，以及 quarantine 人工恢复时都会先撤销 Runtime authority；ACL/profile 是否暂时保留不再意味着旧 binding 可继续执行。
- 撤权结果写入 append-only isolated-session event，保留具体 reason code；原始 argv/environment 等秘密仍不落库。
- RuntimeEngine 新增隔离 Session 工厂并强制注入自己的撤权函数；调用方不能替换 `authority_revoker`，避免生产接线绕过 Runtime 权限域。
- 撤权存储失败时 Session 不得报告 `completed`：即使 ACL/profile 清理成功，也进入 `cleanup_failed` 并返回错误，防止把无法证明的权限终态误报为安全完成。
- 已完成 worker 成功、worker 失败、进程崩溃后 recovery、Job 未清空 quarantine、重复终态调用及撤权数据库故障测试；重复读取已完成 execution 不会重新执行 worker 或重新取得权限。
- 将 isolated-full 的网络与凭据隔离保证前移到 `PermissionProfileResolver`：effective network rules 需要 `network_egress_enforced`，effective credential refs 需要 `credential_isolated`；缺失时在任何 Mode/Profile 持久提交前拒绝。
- 保留现有产品门禁：这仍是单命令 Session 生命周期接线，不等于正式 isolated Effect executor；Gateway 的宿主 mutation 路径没有开放。
- 未修改 Agent Core、工具 schema、TUI/WebUI/OAEP 协议或客户端行为。

### 功能点进展

| 功能点 | 进度 | 累计证据 | 尚缺验收 |
|---|---:|---|---|
| P0-F01 不可变能力配置 | 85% | 网络/凭据隔离保证在 Mode/Profile 提交前校验，避免已提交 full mode 却无法建立 lease 的已知策略窗口 | 数据库故障下 mode+lease 原子提交、组织策略签名、所有入口与属性测试 |
| P0-F03 进程/资源隔离 | 95% | worker terminal/error/recovery/quarantine 已接入自动撤权，且撤权先于成功终态 | packaged AppContainer 通用 runtime、完整逃逸套件、真实生产执行器接线 |
| P0-F04 网络出口边界 | 81% | isolated-full effective network scope 必须具备 network egress attestation，提交前拒绝缺失保证 | AppContainer/WFP 实际出口执行器、DNS/代理/重定向/IPv6/QUIC 逃逸套件 |
| P0-F05 凭据与环境隔离 | 91% | isolated-full effective credential refs 必须具备 credential isolation attestation，提交前拒绝缺失保证 | worker 内真实 broker 注入、继承/日志/dump/崩溃转储完整 canary |
| P2-F04 隔离完全访问 | 76% | live scoped lease 与真实 worker 生命周期已有 Runtime-owned 撤权接线；失败不能误报 completed | 正式 isolated Effect executor、联合 canary、打包及产品 E2E |
| P2-F06 安全模式切换 | 92% | mode/kill switch/worker terminal/error/recovery/quarantine 均可使旧隔离 binding 失效 | 后台/计划任务/子 Agent、跨进程大并发与断线恢复 E2E |
| 其余既有功能点 | 不变 | 见前轮 | 继续按三份方案推进 |

折算：上轮累计 2051 分；本轮增加 `2+2+1+1+4+2=12` 分；`2063 / (30 × 100) = 68.77%`，显示为 69%。

### 本轮测试

- Permission modes、Runtime、lease 与 Windows isolated Session 专项：105 passed。
- 扩展安全域/Agent Kernel 综合回归：532 passed，1 skipped。
- 覆盖 worker terminal 前撤权、异常撤权、startup recovery、quarantine、重复终态、撤权故障 fail closed，以及 network/credential guarantee 提交前验证。
- Python compileall 与变更范围 `git diff --check` 通过；仅有仓库既有 LF→CRLF 提示。
- 全仓三个既有 Gateway backend 基线失败仍未计入绿色范围；本轮未声称全仓绿色。

### 下一轮

1. 设计并实现 isolated Effect executor：Proposal/Grant/Effect 必须在同一隔离 worker、同一 lease 与同一 workspace projection scope 内消费。
2. 将 network broker 与 credential broker 以 capability-scoped channel 注入隔离 worker，并使 policy/credential scope 变化触发实时撤权。
3. 消除 mode descriptor 与 lease 的剩余数据库故障原子性窗口，增加每一提交阶段的 fault injection 与重启恢复。
4. 继续迁移 TUI/legacy 文件工具并清零 `run_write/run_edit` 裸文件写例外，保持客户端协议不变。

## 第 36 轮

日期：2026-08-16  
总体进展：**69%**（折算分较上轮 +10；`2073 / 3000 = 69.10%`，显示为 69%）  
完全验收：**0 / 30**  
当前阶段：Grant-bound isolated Effect executor 与加密 worker protocol

### 本轮完成

- 新增 `IsolatedEffectExecutionService`：执行前同时验证 live isolation lease、Run、规范化 Workspace、Profile digest、attestation digest、Proposal payload 与单次 Grant；任一 scope 不一致都在 worker 启动前拒绝。
- Effect claim 与 Grant consumption 继续使用既有单 SQLite 事务；同一个 Grant 只能产生一个 Effect，重复 execution 或重放 Grant 不会再次写入。
- 副作用不在宿主 executor 内执行：服务只创建加密 request envelope、启动 AppContainer Session、验证 worker receipt 并终结 Effect；真正的 `atomic_write`/CAS 由隔离 worker entry point 调用 handle-backed Windows filesystem boundary。
- request envelope 使用随机 AES-256-GCM key 与 nonce；文件内容、edit 结果等敏感材料只以密文短暂存在 Workspace，密钥只进入隔离 worker environment，不进入 argv、数据库、Approval、Grant 或审计事件。
- worker receipt 使用同一临时 key 做 HMAC-SHA256，并绑定 schema、execution、operation、完整 request digest、result digest 与 receipt digest；宿主拒绝 MAC、digest、operation、request 或 OS terminal status 不一致的回执。
- Runtime 构造 executor 时必须显式提供受信任打包 worker 路径及预期 SHA-256；每次 Grant claim 前重新读取二进制并比较 digest，worker 被替换时不消费 Grant、不启动 Session。
- worker/transport 在 mutation 后丢失可信回执时，Effect 进入 `outcome_unknown` 且 Grant 保持已消费，禁止盲目重放；CAS 源版本冲突可由可信 worker 回执收敛为确定性 `failed`。
- 临时 request/response 控制文件使用随机名称并在所有终态清理；normal agent 不能把目标路径指向该控制前缀或既有 `.git/.agents/.codex/.opendrsai-trash`。
- RuntimeEngine 新增 Runtime-owned isolated executor 工厂，强制复用上一轮的 Session authority revoker；未配置 packaged worker 时直接 fail closed。
- 当前没有把 executor 接入 Gateway：尚缺打包 worker 的真实 AppContainer E2E 与发布身份清单，因此 `reviewer_route=none` 的现有宿主 mutation 仍保持拒绝，没有 host fallback。
- 未修改 Agent Core、工具 schema、TUI/WebUI/OAEP 协议或客户端行为。

### 功能点进展

| 功能点 | 进度 | 累计证据 | 尚缺验收 |
|---|---:|---|---|
| P0-F01 不可变能力配置 | 86% | isolated Effect 绑定 lease/Run/Workspace/Profile/attestation/worker binary digest | mode+lease 数据库原子提交、组织策略签名、所有入口与属性测试 |
| P0-F03 进程/资源隔离 | 96% | 正式 executor 协议只允许隔离 Session 执行 mutation，Runtime 无 host fallback | packaged AppContainer worker 真实 E2E、发布 ACL 与完整逃逸套件 |
| P0-F05 凭据与环境隔离 | 92% | mutation 敏感材料使用 AES-GCM envelope，key 不进入 argv/持久状态 | 真实 broker credential channel、内存/继承/dump/崩溃转储 canary |
| P1-F06 Exactly-once Grant/副作用 | 97% | isolated worker 复用事务 claim；无可信回执进入 outcome_unknown 且不可重放 | 跨进程 crash matrix、运营 reconciliation 与外部系统补偿 |
| P2-F04 隔离完全访问 | 82% | 已有 Runtime-owned isolated executor、worker identity、加密 envelope 与可信 receipt | packaged worker 真机运行、Gateway 接线、network/credential 联合 canary、产品 E2E |
| 其余既有功能点 | 不变 | 见前轮 | 继续按三份方案推进 |

折算：上轮累计 2063 分；本轮增加 `1+1+1+1+6=10` 分；`2073 / (30 × 100) = 69.10%`，显示为 69%。

### 本轮测试

- isolated Effect、Runtime、Session、lease、Effect 与 filesystem 组合专项：115 passed。
- 扩展安全域/Agent Kernel 综合回归：539 passed，1 skipped。
- 覆盖成功 write、CAS 冲突、payload/scope mismatch、lease revoke、worker binary 替换、receipt 篡改、transport crash、Grant 重放、密文 canary 与控制文件清理。
- Python compileall 与变更范围 `git diff --check` 通过；仅有仓库既有 LF→CRLF 提示。
- 全仓三个既有 Gateway backend 基线失败仍未计入绿色范围；本轮未声称全仓绿色或完全访问已可用。

### 下一轮

1. 将 isolated worker 构建为可发布的独立受签名 executable，生成受保护 manifest/hash，并完成真实 AppContainer write/edit E2E。
2. 在 packaged worker E2E 通过后，将 Gateway `reviewer_route=none` 路由接入 isolated executor，同时保留缺配置、身份不符或 attestation 降级时 fail closed。
3. 为 worker 增加 capability-scoped network/credential IPC，不允许继承宿主代理、环境凭据或通用网络权限。
4. 增加 Effect claim、Session create、worker terminal、receipt commit 每阶段 crash/fault injection 与进程重启 reconciliation。

## 第 37 轮

日期：2026-08-16  
总体进展：**69%**（折算分较上轮 +4；`2077 / 3000 = 69.23%`，显示为 69%）  
完全验收：**0 / 30**  
当前阶段：isolated worker 发布身份、manifest pin 与 Authenticode 门禁

### 本轮完成

- 新增 `IsolatedWorkerArtifactResolver`，将 packaged worker 的发布身份从调用方提供的裸路径/hash 升级为固定 manifest、二进制摘要、协议版本、平台和 Authenticode 的联合门禁。
- manifest 必须由受信任 Runtime 提供预期 `sha256:` pin；攻击者即使替换 worker 并同步修改 manifest hash，也会因 manifest pin 不一致而在构造 executor 前被拒绝。
- manifest 契约固定为 `isolated-effect-worker-manifest/1`、`isolated-effect/1`、`isolated-effect-receipt/1` 和 `windows-x64`；任一版本漂移都 fail closed，不能静默降级协议。
- executable 只能是 manifest 同目录的单个 `.exe` 文件名；绝对路径、父目录、子目录和脚本扩展均被拒绝，防止 manifest 把执行重定向到其他程序。
- worker 实际 SHA-256 必须与 pinned manifest 一致，随后必须通过 Windows Authenticode `Valid` 状态、非空 signer thumbprint 和精确 publisher subject 匹配；不接受正则或模糊发布者匹配。
- RuntimeEngine 的 isolated executor 工厂不再接受裸 worker 路径/hash；必须先解析受 pin 和签名保护的 artifact，再把已验证 executable identity 交给 executor。
- executor 每次执行仍重新计算 worker SHA-256，覆盖构造后替换；并新增约束禁止从 agent 可写 Workspace 加载 worker，即使调用方提供了匹配 hash。
- artifact identity 对象只暴露 manifest/executable digest、版本、发布者和 thumbprint，不把签名验证交给 Agent Core 或客户端。
- 本机执行真实 `CreateAppContainerProfile` 探测，宿主继续返回 `appcontainer_profile_create_failed / HRESULT 0x80070002`；因此没有用 mock、普通进程或 unsigned Python 入口冒充 packaged AppContainer E2E，Gateway 仍保持关闭。
- 本机没有 .NET SDK、Rust toolchain 或既有 PyInstaller 构建链；本轮没有提交未经正式构建/签名流程产生的伪 worker executable。
- 未修改 Agent Core、工具 schema、TUI/WebUI/OAEP 协议或客户端行为。

### 功能点进展

| 功能点 | 进度 | 累计证据 | 尚缺验收 |
|---|---:|---|---|
| P0-F01 不可变能力配置 | 87% | worker manifest digest 由 Runtime pin，协议/平台/二进制/发布者身份形成不可变 artifact binding | pin 注入正式 signed Runtime build、组织策略签名、数据库原子性与属性测试 |
| P0-F03 进程/资源隔离 | 97% | executor 只能接受已验证 artifact，且禁止从 Workspace 加载 worker；真实宿主不可用时 fail closed | 支持 AppModel 的发布机 packaged E2E、安装 ACL 与完整逃逸套件 |
| P2-F04 隔离完全访问 | 84% | packaged worker 身份门禁已覆盖 manifest pin、hash、协议、平台、路径和 Authenticode | 真正构建/签名工件、AppContainer write/edit、Gateway 接线及联合 canary |
| 其余既有功能点 | 不变 | 见前轮 | 继续按三份方案推进 |

折算：上轮累计 2073 分；本轮增加 `1+1+2=4` 分；`2077 / (30 × 100) = 69.23%`，显示为 69%。

### 本轮测试

- artifact/executor/Runtime/AppContainer 专项：87 passed。
- 扩展安全域/Agent Kernel 综合回归：553 passed，1 skipped。
- 覆盖 manifest pin 篡改、binary 替换、unsigned/wrong publisher、协议/平台降级、路径逃逸、Workspace worker、Runtime artifact 接线与真实 AppContainer capability probe。
- 本机真实探测结果：`CreateAppContainerProfile failed with HRESULT 0x80070002`；该结果明确计为 backend unavailable，不计为隔离成功。
- Python compileall 与变更范围 `git diff --check` 通过；仅有仓库既有 LF→CRLF 提示。
- 全仓三个既有 Gateway backend 基线失败仍未计入绿色范围；本轮未声称全仓绿色或完全访问已可用。

### 下一轮

1. 把 worker 独立构建步骤接入 Windows release runner，在签名后生成 manifest，并把 manifest digest pin 注入随后签名的 Runtime build metadata。
2. 在具备 AppModel repository 的 Windows runner 执行 signed worker + ACL projection + AppContainer write/edit/外部 canary E2E，保存结构化证据。
3. 只有上述 E2E 通过后才接入 Gateway `reviewer_route=none`；签名、pin、attestation 或 worker health 任一异常均继续 fail closed。
4. 实现 capability-scoped network/credential IPC 与实时撤权，不给隔离 worker 通用网络 capability 或宿主环境凭据。

## 第 38 轮

日期：2026-08-16  
总体进展：**70%**（折算分较上轮 +8；`2085 / 3000 = 69.50%`，显示为 70%）  
完全验收：**0 / 30**  
当前阶段：Permission Mode、Profile 与 isolation lease 原子提交及崩溃恢复

### 本轮完成

- 消除此前 `RuntimeEngine.apply_permission_mode()` 的双事务窗口：旧实现先提交 Mode/Profile binding，再单独 bind/revoke isolation lease；数据库错误可能留下已显示 full mode、但没有 live lease 的不一致状态。
- `IsolationAttestationLeaseStore` 新增 caller-owned transaction API：`bind_in_transaction()` 与 `revoke_run_in_transaction()` 只在调用方连接上 stage append-only lease/event，不自行 commit。
- 公共 `bind()`/`revoke_run()` 复用相同事务原语，避免形成两套校验语义；Workspace、Profile、attestation、network、credential 和 revoked-no-reactivation 规则保持一致。
- `PermissionModeService.apply()` 新增内部 `commit_hook`，在最终 Mode binding 的同一个 `BEGIN IMMEDIATE` 事务中 stage isolation authority；hook、binding、audit、transition committed event 任一步失败都会整体 rollback。
- RuntimeEngine 始终注入自己的 authority hook：目标是 `isolated_full_access` 时原子 bind lease，其他模式时原子 revoke 当前 Run 的所有 active isolation lease；调用客户端不能提供或替换该 hook。
- 新增 `authority_staged` fault injection：模拟 lease insert/revoke 已执行但 SQLite commit 前进程终止；测试证明 lease/event 与新 Mode binding 同时回滚，transition 保持 `profile_bound` 供重启后幂等恢复。
- isolated-full 首次升级在 `authority_staged` 崩溃后不会出现可见 mode descriptor，也没有 lease 行或 event；重试同一 selection 后原子产生 binding 与 active lease。
- full→manual 降级在撤权 staged 后崩溃时，旧 lease 因事务回滚仍保留以维持数据库事实一致性，但 active Profile 已切换使旧 Desktop binding 立即返回 `desktop_security_binding_stale`，不能执行；恢复 commit 后 lease 正式 append revoked event。
- 并发调用在进入最终事务后若发现同一 transition 已被另一进程提交，返回前仍执行 authority hook；避免竞争者只观察到 committed binding 却跳过本次 authority 一致性校验。
- full→full 重新解析产生新 Profile version 时，事务先建立目标 lease，再以 `keep_lease_id` 原子撤销该 Run 的其他 active lease；旧 Profile 的 attestation scope 不会作为孤立 live lease 长期残留，并发幂等 hook 也不会误撤当前目标 lease。
- transaction rollback 专项直接验证 lease 和 event 在 caller rollback 后均为零，并可随后正常重试绑定。
- 未修改 Agent Core、工具 schema、TUI/WebUI/OAEP 协议或客户端行为。

### 功能点进展

| 功能点 | 进度 | 累计证据 | 尚缺验收 |
|---|---:|---|---|
| P0-F01 不可变能力配置 | 90% | Mode binding、Profile identity、isolation lease/event 现在在最终提交阶段形成单事务 authority binding | 组织策略签名、所有执行入口、跨进程高并发与完整属性测试 |
| P2-F04 隔离完全访问 | 86% | full mode 不再能提交为“有 descriptor、无 lease”；旧库重入可 fail-closed repair | signed packaged worker 真机、Gateway 接线、network/credential 联合 canary |
| P2-F06 安全模式切换 | 95% | 升级 bind 与降级 revoke 和 Mode commit 原子；两侧 crash 窗口、stale binding、重启幂等恢复均验证 | 后台/计划任务/子 Agent、跨进程大并发、客户端断线与产品 E2E |
| 其余既有功能点 | 不变 | 见前轮 | 继续按三份方案推进 |

折算：上轮累计 2077 分；本轮增加 `3+2+3=8` 分；`2085 / (30 × 100) = 69.50%`，显示为 70%。

### 本轮测试

- mode/lease/Runtime 原子提交专项：71 passed。
- 扩展安全域、RuntimeEngine、isolation 与 Agent Kernel 综合回归：616 passed，1 skipped。
- 覆盖 bind staged rollback、revoke staged rollback、首次升级 crash、降级 crash、full→full 旧 lease 撤销、transition durable stage、旧 binding stale、幂等恢复与最终 active/revoked lease。
- Python compileall 与变更范围 `git diff --check` 通过；仅有仓库既有 LF→CRLF 提示。
- 全仓三个既有 Gateway backend 基线失败仍未计入绿色范围；本轮未声称全仓绿色或完全访问已可用。

### 下一轮

1. 为 Effect claim→Session create→worker terminal→receipt commit 增加同等级的 durable orchestration 与逐阶段 fault injection，避免两个现有状态机之间的恢复歧义。
2. 实现 isolated executor startup reconciliation：`executing` Effect 与 unfinished/quarantined Session 必须按 execution identity 联合恢复，不能各自独立猜测结果。
3. 继续准备 Windows release runner 的 signed worker build/manifest pin，并在可用 AppModel 主机运行真实 E2E。
4. packaged E2E 未通过前保持 Gateway `reviewer_route=none` fail closed；随后再做不影响 TUI/WebUI/OAEP 的内部路由接线。

## 第 39 轮

日期：2026-08-16  
总体进展：**70%**（折算分较上轮 +8；`2093 / 3000 = 69.77%`，显示为 70%）  
完全验收：**0 / 30**  
当前阶段：isolated Effect 与 Windows Session 联合持久化及逐阶段崩溃恢复

### 本轮完成

- 新增 durable `runtime_isolated_effect_attempts` 与 append-only attempt events，将 Effect execution、Run、Session execution identity、Workspace、Profile、attestation、worker digest 和加密控制文件名精确绑定。
- `EffectExecutionStore.claim()` 新增 caller-owned `commit_hook`；isolated executor 在 Effect claim 与 Grant consume 的同一 SQLite 事务中插入 attempt identity。attempt journal 写入失败会同时回滚 Effect 和 Grant consumption。
- attempt identity 字段不可更新、记录不可删除；状态机只允许 `claimed→dispatching→session_terminal→receipt_verified→committed` 及对应 fail/unknown 分支，terminal attempt 不能回到可执行状态。
- Windows isolated Session 新增公开 `by_execution()` 和 `reached_state()` 只读恢复接口；reconciler 不再依赖私有方法或用时间顺序猜测 Session 是否可能启动 worker。
- 新增五个 process-crash fault point：`effect_claimed`、`envelope_staged`、`session_terminal`、`receipt_verified`、`effect_committed`；测试 crash signal 故意绕过正常异常 terminalization 和控制文件清理，模拟真实进程消失。
- claim 后但无 Session row，或 envelope 已落密文但 Session 尚未建立时，重启能证明 OS worker 未启动，Effect 收敛为确定性 `failed / isolated_dispatch_not_started`；Grant 仍保持已消费并要求新授权，不恢复为可重放。
- Session 已达到 `worker_starting`、但没有 durable trusted receipt 时，任何 completed/recovered/quarantined 结果都收敛为 `outcome_unknown / isolated_worker_result_unrecoverable`；绝不依据 exit code 猜测副作用是否发生。
- receipt 只有在内存中完成 HMAC、schema、execution、operation、request digest 和 receipt digest 验证后，才把 terminal status/digest 写入 durable attempt；若随后崩溃，重启可安全完成同一 Effect，不重新运行 worker。
- Effect 已完成但 attempt 尚未写 committed 时，reconciler 读取 Effect terminal fact 并只补齐 attempt；不会再次消费 Grant或执行副作用。
- unfinished Session 会先调用其既有 lease-aware recovery；若仍非 terminal，则 reconciliation 返回 `pending`，不会抢占活 worker 或提前猜测结果。
- 崩溃遗留的 request/response 文件由 attempt 中持久化的 canonical Workspace 与随机受控文件名清理；request 始终是 AES-GCM 密文，密钥仍不落库。
- reconciliation 自身幂等：第二次运行得到全零计数，五个崩溃阶段均验证 worker 写入次数不增加、Grant 不重放、控制文件无残留。
- 未修改 Agent Core、工具 schema、TUI/WebUI/OAEP 协议或客户端行为；Gateway completely-full 路由仍未开放。

### 功能点进展

| 功能点 | 进度 | 累计证据 | 尚缺验收 |
|---|---:|---|---|
| P0-F09 安全回执与可观测性 | 97% | isolated attempt/Session/Effect 形成 durable identity 与 append-only stage events，可信 receipt 可恢复 | 外部审计锚定、告警/SLO、磁盘损坏与大并发压力 |
| P1-F06 Exactly-once Grant/副作用 | 99% | claim+attempt+Grant 原子；五阶段 crash matrix；可信 receipt 重放而 worker 不重放；未知结果不猜测 | 外部系统补偿、正式运维 reconciliation 演练与跨主机灾备 |
| P2-F04 隔离完全访问 | 89% | executor 已具备 Session 联合恢复和完整 crash semantics，不再依赖进程内状态 | signed packaged worker 真机、Gateway 接线、network/credential 联合 canary |
| P2-F06 安全模式切换 | 96% | mode/lease 原子性之外，in-flight isolated Effect 在重启后按 durable Session fact 收敛 | 后台/计划任务/子 Agent、跨进程高并发和产品断线 E2E |
| 其余既有功能点 | 不变 | 见前轮 | 继续按三份方案推进 |

折算：上轮累计 2085 分；本轮增加 `2+2+3+1=8` 分；`2093 / (30 × 100) = 69.77%`，显示为 70%。

### 本轮测试

- isolated Effect/Session/filesystem 专项：61 passed。
- 扩展安全域、RuntimeEngine、isolation 与 Agent Kernel 综合回归：622 passed，1 skipped。
- 覆盖 claim hook rollback、五阶段 crash、无 Session 确定失败、worker-started unknown、durable receipt 完成、Effect terminal 补账、幂等 reconciliation、零重放与密文文件清理。
- Python compileall 与变更范围 `git diff --check` 通过。
- 全仓三个既有 Gateway backend 基线失败仍未计入绿色范围；本轮未声称全仓绿色或完全访问已可用。

### 下一轮

1. 为 reconciliation 增加多进程 owner lease/claim，防止多个 Runtime startup 同时处理同一 isolated attempt，并做并发压力与 owner crash 接管。
2. 增加磁盘满、SQLite busy/corruption、attempt event 写失败和 Session recovery 失败矩阵，确保恢复失败继续 pending/fail closed 而不覆盖可信事实。
3. 推进 signed worker release runner 与真实 AppContainer E2E；本机 `0x80070002` 不作为成功证据。
4. 在真机门禁通过前继续保持 Gateway `reviewer_route=none` 关闭；之后以 Runtime 内部配置接线，不改变客户端协议。

## 第 40 轮

日期：2026-08-16  
总体进展：**70%**（折算分较上轮 +5；`2098 / 3000 = 69.93%`，显示为 70%）  
完全验收：**0 / 30**  
当前阶段：isolated Effect 多 Runtime 恢复 owner lease、heartbeat 与 fencing

### 本轮完成

- `runtime_isolated_effect_attempts` 新增 recovery owner、随机 fencing token 和租约到期时间；旧数据库通过幂等列迁移补齐，未终结 attempt 才可被恢复 owner claim。
- claim 使用 `BEGIN IMMEDIATE` 和带到期条件的单行更新：租约有效时其他 Runtime 只能返回 `pending`，租约过期后才允许新 owner 接管；同一时刻只有数据库确认的 owner 能推进恢复。
- 新增 token 绑定的 `heartbeat_recovery()`：当前 owner 可延长耗时恢复任务的租约，但过期、已被接管、token 不匹配或 attempt 已终结时统一返回 `isolated_effect_recovery_fenced`，不能复活旧 authority。
- Effect 的 `complete()` / `mark_outcome_unknown()` 支持 caller-owned commit hook；reconciler 把 Effect terminal、attempt terminal 和 attempt event 放入同一 SQLite 事务。
- terminal hook 同时校验 owner identity、fencing token 和未过期租约。旧 owner 即使已开始构造终结结果，只要租约过期或被接管，其 attempt 更新失败就会使 Effect terminal 更新整体回滚，避免 stale owner 覆盖新事实。
- Effect 已经终结而 attempt 尚未补账的分支同样受 fencing 保护；第二个 Runtime 不会重复终结、重复消费 Grant 或重放 worker。
- 新增双 Runtime 并发恢复测试：两个独立 service/owner 同时 reconcile 同一 claim 后 crash 的 attempt，只有一个返回 failed，Effect 只终结一次且没有 filesystem write。
- 新增 owner crash/takeover 测试：验证 heartbeat 延期、有效租约期间新 owner 等待、到期后接管、旧 token heartbeat 被拒绝，以及 stale owner 的 Effect 事务完整回滚。
- 未修改 Agent Core、工具 schema、TUI/WebUI/OAEP 协议或客户端行为；Gateway completely-full 路由继续关闭。

### 功能点进展

| 功能点 | 进度 | 累计证据 | 尚缺验收 |
|---|---:|---|---|
| P0-F09 安全回执与可观测性 | 98% | attempt journal 已有跨 Runtime owner lease、heartbeat、fencing 与原子 terminal event | 外部审计锚定、告警 SLO、磁盘损坏与更大并发压力 |
| P1-F06 Exactly-once Grant/副作用 | 99% | stale recovery owner 无法提交 Effect；并发 startup 只终结一次，Grant/worker 均不重放 | 外部系统补偿、正式运维演练与跨主机灾备 |
| P2-F04 隔离完全访问 | 91% | isolated executor 的重启收敛已具备多 Runtime 互斥、租约续期和过期接管 | signed packaged worker 真机、Gateway 接线、network/credential 联合 canary |
| P2-F06 安全模式切换 | 98% | mode/lease 原子提交和 in-flight Effect fenced recovery 已覆盖单机多 Runtime startup | 后台/计划任务/子 Agent、跨进程压力和产品断电 E2E |
| 其余既有功能点 | 不变 | 见前轮 | 继续按三份方案推进 |

折算：上轮累计 2093 分；本轮增加 `1+0+2+2=5` 分；`2098 / (30 × 100) = 69.93%`，显示为 70%。

### 本轮测试

- isolated Effect 恢复专项：16 passed。
- isolated Effect、Windows Session 与 filesystem 组合专项：63 passed。
- 扩展安全域综合回归：654 passed，1 skipped，1 个既有工具检索策略分类失败；该失败可独立稳定复现，路径不涉及本轮 security boundary 变更。
- 覆盖双 owner 并发 claim、有效租约等待、heartbeat 续租、过期接管、旧 token 拒绝、stale terminal 整体回滚和零副作用重放。
- Python compileall 通过；`git diff --check` 仅报告仓库既有 LF→CRLF 提示，没有 whitespace error。
- 本轮未声称全仓绿色、真实 AppContainer E2E 通过或完全访问已可用。

### 下一轮

1. 增加 SQLite busy、磁盘满、attempt event/terminal hook 写失败和 Session recovery 抛错矩阵，验证 owner 租约最终可接管且可信事实不被覆盖。
2. 增加多进程而非仅多线程的 startup 竞争与 owner 进程被强制终止测试，记录锁等待、接管延迟和重复终结计数。
3. 推进 signed worker release runner 与真实 AppContainer E2E；本机 `0x80070002` 继续只作为 backend unavailable 证据。
4. 真机门禁通过前保持 Gateway `reviewer_route=none` fail closed；通过后仅在 Runtime 内部接线，不扩大 Approval 或客户端控制面。

## 第 41 轮

日期：2026-08-16  
总体进展：**70%**（折算分较上轮 +3；`2101 / 3000 = 70.03%`，显示为 70%）  
完全验收：**0 / 30**  
当前阶段：isolated Effect 恢复故障隔离与 fail-closed 重试

### 本轮完成

- 将 startup reconciliation 从“一个 attempt 抛错即中断整批”改为逐 attempt 故障隔离；单个 Session、Effect terminal 或 SQLite 写入异常只把该项计为 `pending`，后续 attempt 继续恢复。
- attempt 增加 `recovery_failures`、`recovery_error_code` 和 `last_recovery_error_at`，并写入 append-only `recovery_deferred:*` 事件，为运维告警提供持久证据。
- 恢复诊断写入采用 best-effort 语义：数据库锁定、磁盘满或损坏导致诊断本身失败时只放弃诊断，不会降级 fencing、释放 Grant、猜测 worker 结果或覆盖 Effect 权威事实。
- terminal attempt hook 写入失败继续与 Effect terminal 位于同一事务；测试在 attempt 已更新后注入 `OperationalError`，验证 attempt、event 和 Effect 三者全部回滚，随后可安全重试。
- Session recovery 抛出异常时不把可能启动过 worker 的执行误判为成功或失败；Effect 保持 `executing`，恢复失败计数落库。Session 后续进入 quarantine 后收敛为 `outcome_unknown`，不重放副作用。
- 增加可配置但默认保持 30 秒的 SQLite connection timeout，专用于确定性验证锁竞争；真实 `BEGIN IMMEDIATE` 写锁期间 claim 返回 pending，锁释放后正常恢复。
- 增加批次隔离测试：第一个 attempt terminal 写入失败时，第二个 attempt 仍在同一轮被确定终结，证明坏记录不会阻塞整个 Runtime startup recovery。
- 未修改 Agent Core、工具 schema、TUI/WebUI/OAEP 协议或客户端行为；Approval 控制面没有扩大，Gateway completely-full 仍 fail closed。

### 功能点进展

| 功能点 | 进度 | 累计证据 | 尚缺验收 |
|---|---:|---|---|
| P0-F09 安全回执与可观测性 | 99% | recovery failure 已有持久计数、错误类别、append-only deferred event，且诊断失败不影响权威事实 | 外部审计锚定、告警 SLO、真实磁盘损坏演练 |
| P1-F06 Exactly-once Grant/副作用 | 99% | terminal journal 失败整体回滚；Session recovery 异常保持 unknown/pending；批次后续项不被阻塞 | 外部系统补偿、正式运维演练与跨主机灾备 |
| P2-F04 隔离完全访问 | 92% | isolated recovery 已覆盖 SQLite busy、terminal event 写失败和 Session recovery 异常 | signed packaged worker 真机、Gateway 接线、network/credential 联合 canary |
| P2-F06 安全模式切换 | 99% | in-flight Effect 的多 Runtime 恢复具备 fencing、错误隔离和可重试性 | 后台/计划任务/子 Agent、真正多进程终止和产品断电 E2E |
| 其余既有功能点 | 不变 | 见前轮 | 继续按三份方案推进 |

折算：上轮累计 2098 分；本轮增加 `1+0+1+1=3` 分；`2101 / (30 × 100) = 70.03%`，显示为 70%。

### 本轮测试

- isolated Effect 恢复专项：20 passed。
- isolated Effect、Windows Session 与 filesystem 组合专项：67 passed。
- 排除已知无关基线后的扩展安全域回归：645 passed，1 skipped。
- 覆盖真实 SQLite busy、terminal hook/event 写失败、原子回滚、错误诊断、Session recovery 异常、后续 quarantine 收敛、批次故障隔离和安全重试。
- Python compileall 与变更范围 `git diff --check` 通过。
- 本轮没有把模拟 `OperationalError` 等同于真实磁盘满/损坏演练，也未声称全仓绿色或完全访问可用。

### 下一轮

1. 使用独立进程竞争同一 SQLite attempt，并强制终止持有 recovery lease 的进程，验证到期接管、fencing 和 Effect 单次终结。
2. 增加真实临时数据库只读/容量限制或 SQLite fault adapter，覆盖诊断写失败、commit 失败与连接失败，避免仅依赖方法级异常注入。
3. 为 recovery failure/deferred events 接入 Runtime 内部指标与阈值告警，不把错误细节或控制能力暴露给客户端。
4. 继续推进 signed worker release runner 与真实 AppContainer E2E；门禁通过前 Gateway completely-full 保持关闭。

> 记录顺序说明：第 42～64 轮采用最新轮次在前的倒序排列；轮次编号和每轮累计分仍按实际执行顺序递增。

## 第 68 轮

日期：2026-08-16  
总体进展：**72%**（折算分较上轮 +1；`2162 / 3000 = 72.07%`，显示为 72%）  
完全验收：**0 / 30**  
当前阶段：`recovery_required` privileged repair、root fencing 与 reconciler lease

### 本轮完成

- `recovery_required` 被加入 install-root partial unique index；故障 coordinator 不再释放 root ownership，新的 install/upgrade/repair 不能绕过未解决的 privileged 状态。
- `start()` 在调用 installer journal `begin()` 之前先检查 active/recovery owner；拒绝路径不会创建新 operation，也不会撤销旧 bootstrap authority 后才发现冲突。
- 兼容旧 SQLite：启动时检测旧 index SQL；未包含 `recovery_required` 时原地重建 index，同时增量增加 `recovery_owner` 与 `recovery_expires_at` 列。
- 新增 host-only `reconcile_recovery()`；只接受同一 coordinator、committed operation、catalog digest、install root 与 service identity，且开始前必须由 installer safety controller 证明 disabled、stopped、process_count=0。
- 无 durable authorization ID 且 envelope 缺失时，只允许回到同一 operation 的 `committed` publish-first 阶段；不能直接完成、换包或绕过 verification。
- 已发布、尚未登记的同一 envelope 可由 repair 重新验真并 record 为 issued，然后回到 `envelope_published`；authorization ID 被写回 coordinator durable identity。
- 已有 authorization ID 时必须与 envelope 完全相同；不匹配、缺失、异常状态全部保持 `recovery_required` 并 fail-safe disable/stop。
- consumed/activated authority 且服务不可证明继续安全运行时不会生成替代 token；保持 recovery_required。由于 repair 首先建立 disabled/stopped 安全态，普通 repair 不把旧运行进程当成成功证据。
- recovery reconciler 使用 300 秒 host lease；claim 与 `recovery_claimed` 审计事件同事务。第二个并发 repair 被拒绝，所有 repair phase commit 同时校验 owner token 与未过期时间，陈旧 owner 不能提交。
- 每次成功、失败或重新进入 recovery_required 的 durable transition 都清除 lease；进程死亡时 lease 到期后才允许接管，避免两个 privileged repair 同时操作。
- 未修改 Agent Core、TUI、WebUI、OAEP wire、客户端权限入口或 Approval 决策语义。

### 功能点进展

| 功能点 | 进度 | 本轮证据 | 尚缺验收 |
|---|---:|---|---|
| P0-F09 安全回执与可观测性 | 99% | recovery claim/owner/expiry 与结果均 durable，故障状态不能静默清除 | lease-expiry process kill、磁盘错误与外部审计演练 |
| P1-F06 Exactly-once Grant/副作用 | 99% | consumed authority 不补发；并发 repair 只有一个 owner；新 operation 不撤销后再失败 | 全阶段真实强杀、跨主机灾备与正式补偿策略 |
| P2-F04 隔离完全访问 | 93% | repair authority 仅在 security-boundary host API，不进入客户端/Agent control plane | signed packaged worker、AppContainer 联合 canary与产品 E2E |
| P2-F06 安全模式切换 | 99% | recovery_required 持有 root fence，产品模式切换不能越过安装故障 | 后台/计划任务/子 Agent 与产品断电 E2E |
| 其余既有功能点 | 不变 | 见前轮 | 继续按三份方案推进 |

折算：本轮为 privileged recovery fencing 与同身份 repair 增加 1 分；缺少 lease-expiry 进程接管、真实 elevated service E2E 和完整 runbook，因此仍不标 100%。累计 `2162 / (30 × 100) = 72.07%`，显示为 72%。

### 本轮测试

- coordinator 专项：13 passed，包括并发 repair lease、新 operation 前置拒绝、published candidate 恢复、consumed 不补发、缺失 envelope 回到 committed 与旧 index migration。
- installer journal/filesystem/SCM/envelope/coordinator 组合：58 passed，1 skipped。
- 使用工作区可写 `DRSAI_HOME` 的扩展 security-boundary 回归：157 passed，1 skipped，2897 deselected。
- Python `compileall` 与本轮变更范围 `git diff --check` 通过。
- skipped 仍为特定 elevated SYSTEM-owner ACL 原生测试，不计为通过。

### 仍然明确未完成

1. 尚缺 recovery owner 进程被强杀、lease 到期、第二进程接管的真实 spawn 测试；目前并发 lease 与 fencing 为线程/SQLite 级证据。
2. repair API 尚未接入正式 installer/service host entrypoint，也未形成签名 runbook/运维告警；按设计不能由客户端接线。
3. 其余 coordinator checkpoint 和真实 elevated Windows service 强杀矩阵仍未完成。

### 下一轮

1. 增加 recovery lease owner spawned-process kill、精确到期接管与 stale-owner commit 拒绝测试。
2. 为 repair 定义 host command contract、低基数结果码、审计查询与默认关闭的运维入口。
3. 继续扩展 artifact/promote/SCM/publish/finalize/start/consume/claim 的强杀矩阵。
4. 准备管理员 runner 上真实 Windows service E2E，缺权限继续显式 skip。

## 第 67 轮

日期：2026-08-16  
总体进展：**72%**（折算分较上轮 +1；`2161 / 3000 = 72.03%`，显示为 72%）  
完全验收：**0 / 30**  
当前阶段：privileged installer child-action/phase-commit crash reconciliation

### 本轮完成

- filesystem 与 SCM action journal 新增按 durable `operation_id` 的恢复查询；恢复者不依赖死亡进程内存中的 action ID，也不会为同一 installer operation 创建第二个 privileged action。
- filesystem 暴露 canonical `validated_artifact_set_digest()`；coordinator 找回既有 action 时重新验证 package root 与排序后的 artifact set digest，不能用“恢复”名义切换安装输入。
- coordinator 的 `safe_disabled`、`filesystem_prepared`、`artifacts_staged`、`files_promoted`、`service_registered` 五个阶段改为 child action + installer journal 状态对账式推进。
- 若 filesystem 已 prepared/staged/promoted，SCM 已 prepared/registered，installer 已 artifacts_staged/service_registered/package_verified/committed，或 child action 已 committed，恢复者只补缺失的下一步，不重复已经证明完成的副作用。
- 每个阶段都要求 child action 与 installer journal 同时达到精确允许状态；任何不一致进入组合 rollback（提交前）或 fail-safe recovery（提交后），不会选择“较新状态”并静默继续。
- coordinator 增加低基数 fault checkpoints：filesystem prepare、artifact stage、file promote、SCM register、child commit、envelope record、SCM finalize、start intent、service start 后均可做精确 crash injection。
- 新增真正 Windows/Python `spawn` 双进程 phase race：两个独立进程、独立 SQLite connection 同时提交同一 coordinator phase，结果严格为一个 committed、一个 `windows_installer_coordinator_raced`。
- 新增真正 spawned-process kill：子进程在 child action 已可恢复、coordinator phase commit 前执行 `os._exit(77)`；后继进程确认 coordinator 仍在旧阶段，找回同一 action 后推进且 prepare 调用数为零。
- 未修改 Agent Core、TUI、WebUI、OAEP wire、客户端权限入口或 Approval 决策语义。

### 功能点进展

| 功能点 | 进度 | 本轮证据 | 尚缺验收 |
|---|---:|---|---|
| P0-F02 文件系统沙箱 | 99% | promoted/staged child action 可按 operation 恢复，输入 root/digest 必须完全一致 | elevated SYSTEM-owner、真实 release tree 逐阶段 kill 与逃逸套件 |
| P0-F09 安全回执与可观测性 | 99% | 九个 coordinator fault checkpoint 与真实 spawn phase-owner 证据 | 全矩阵、磁盘 FULL/IOERR/CORRUPT、外部审计演练 |
| P1-F06 Exactly-once Grant/副作用 | 99% | 双进程仅一 phase commit；child action 已完成/phase 未提交时不重放副作用 | 全阶段真实 action 强杀、服务 consume/claim 与跨主机灾备 |
| P2-F06 安全模式切换 | 99% | installer transition 的单 owner/陈旧 writer 已由真正独立进程验证 | 后台/计划任务/子 Agent 与产品断电 E2E |
| 其余既有功能点 | 不变 | 见前轮 | 继续按三份方案推进 |

折算：本轮为真正多进程 phase fencing 与 child-action reconciliation 增加 1 分；因强杀仅覆盖首个 child/phase 窗口且尚未使用真实 elevated action，相关功能仍不标 100%。累计 `2161 / (30 × 100) = 72.03%`，显示为 72%。

### 本轮测试

- coordinator 专项：8 passed；其中包含两个真正 `spawn` 多进程测试。
- installer journal/filesystem/SCM/envelope/coordinator 组合：53 passed，1 skipped。
- 使用工作区可写 `DRSAI_HOME` 的扩展 security-boundary 回归：152 passed，1 skipped，2897 deselected。
- Python `compileall` 与本轮变更范围 `git diff --check` 通过。
- skipped 仍为需要特定 elevated SYSTEM-owner ACL 的原生测试，本轮不计为通过。

### 仍然明确未完成

1. spawn kill 当前证明第一个 child-action/phase-commit 窗口；artifact copy、rename promote、SCM register、commit、publish/record、finalize/start/consume/claim 尚未全部逐点强杀。
2. child action 的真实 OS 副作用仍主要由专项 fault-hook/状态测试覆盖；尚缺管理员权限下真实 CreateService、StartService 与 SYSTEM-owner envelope 的同一矩阵。
3. `recovery_required` 尚无 privileged repair/reconcile API 与正式运维 runbook。

### 下一轮

1. 将 spawned-process harness 扩展到 artifact staged、promoted、SCM registered、actions committed 与 envelope recorded checkpoint。
2. 为 finalize/start/consume/claim 建立可启动的测试 service fixture，并验证 PID 与 authority 状态对账。
3. 增加 coordinator `recovery_required` 的身份固定 repair API、并发 fencing 与审计事件。
4. 继续准备 elevated Windows runner 门禁，所有缺权限证据保持显式 skip。

## 第 66 轮

日期：2026-08-16  
总体进展：**72%**（折算分较上轮 +1；`2160 / 3000 = 72.00%`）  
完全验收：**0 / 30**  
当前阶段：bootstrap publish/start 两个 privilege crash window 的 durable reconciliation

### 本轮完成

- 将 bootstrap authority 拆成 `prepare_bootstrap_authorization()` 与 `record_bootstrap_authorization()`：prepare 只生成绑定 committed operation 的短期 secret，不写可消费状态；record 才把 token digest 原子登记为 `issued`。
- coordinator 改为 publish-first/record-second：先把完整候选 authority 写入 DPAPI + service-SID ACL envelope，再登记 journal。发布前崩溃没有 authority；发布后、登记前崩溃可从 envelope 恢复同一 token 后登记；登记后崩溃可检查同一 issued authority，消除了 issued-without-envelope stranded token。
- 未登记的 envelope 即使被服务读取，也无法通过 `consume_bootstrap_authorization()`；测试证明状态为 `None`、消费 fail closed，record 后才变为 `issued`。
- 新增 privileged `bootstrap_authorization_status_by_identity()`，只接受 durable operation/authorization ID，只返回低基数状态，不返回 token、digest 或产品可用 authority。
- service start 前先 durable 推进到 `starting`；如果重启时 authority 仍为 issued，则对同一 envelope 幂等 StartService；如果已被服务消费/claim，则读取 SCM running state 与 PID，只有 pinned service 正在运行才提交 `completed`。
- consumed/activated authority 但服务未运行、PID 无效或身份不匹配时，调用 fail-safe disable/stop 并进入 `recovery_required`，不会重新发 authority 或把死亡服务误报完成。
- native SCM activation API 新增只读 `inspect_running()`；返回 service name、running 与 PID，且不改变 start type、服务状态或 authority。
- 兼容旧 coordinator 数据库：启动时检查 partial unique index 定义；旧索引未包含 `starting` 时重建，使升级后的 starting owner 仍阻止同一 install root 的第二协调器。
- 未修改 Agent Core、TUI、WebUI、OAEP wire、客户端权限入口或 Approval 决策语义。

### 功能点进展

| 功能点 | 进度 | 本轮证据 | 尚缺验收 |
|---|---:|---|---|
| P0-F09 安全回执与可观测性 | 99% | publish/record/start intent 都有 durable authority 状态与 fail-safe reconciliation | 全阶段 process-kill、磁盘 FULL/IOERR/CORRUPT 和外部审计演练 |
| P1-F06 Exactly-once Grant/副作用 | 99% | issued-without-envelope 与 StartService-after-crash 两个窗口已形成代码闭环 | 真多进程强杀矩阵、正式 Windows service 消费/claim E2E、跨主机灾备 |
| P2-F04 隔离完全访问 | 93% | service activation 恢复只读 SCM 状态，不把 start/reissue authority 暴露给客户端 | signed packaged worker、AppContainer 联合 canary 与产品 E2E |
| P2-F06 安全模式切换 | 99% | 安装服务的 starting owner 在旧库迁移后仍保持单实例互斥 | 后台/计划任务/子 Agent 与产品断电 E2E |
| 其余既有功能点 | 不变 | 见前轮 | 继续按三份方案推进 |

折算：本轮为 durable bootstrap/start reconciliation 增加 1 分，但没有把缺少真实 process-kill/elevated E2E 的 99% 功能提前标为 100%。累计 `2160 / (30 × 100) = 72.00%`。

### 本轮测试

- journal/envelope/coordinator 专项：29 passed，1 skipped。
- installer journal/filesystem/SCM/envelope/coordinator 组合：50 passed，1 skipped。
- 显式使用工作区可写 `DRSAI_HOME` 的扩展 security-boundary 回归：149 passed，1 skipped，2897 deselected。
- Python `compileall` 与本轮变更范围 `git diff --check` 通过。
- 覆盖 prepared authority 不可消费、record 后可消费、envelope 已发布但未 record 的恢复、stale phase writer、单 active root、consumed authority + running PID 收敛完成、consumed authority + stopped service fail-safe。
- skipped 仍是需要特定 elevated SYSTEM-owner ACL 环境的原生证据，本轮不把它计为通过。

### 仍然明确未完成

1. 尚未用真正独立 Windows 进程在每一个 coordinator durable phase 后强制终止；当前 crash-window 测试是状态级精确模拟。
2. 尚未在管理员 runner 上对真实 CreateService/ChangeServiceConfig/StartService、服务进程 consume/claim、SYSTEM-owner envelope ACL 做一条完整 E2E。
3. 普通 I/O 错误会 fail-safe 后进入 `recovery_required`，尚缺受控 repair 命令与运维 runbook；不能由客户端静默清除。

### 下一轮

1. 建立 coordinator fault hook 和 Windows spawned-process crash harness，逐阶段 kill 并由新进程恢复。
2. 覆盖 publish 前、publish 后/record 前、record 后、finalize 后、StartService 后、consume 后与 claim 后的精确矩阵。
3. 增加 `recovery_required` 的 privileged repair/reconcile API，只允许继续同一 identity 或保持禁用，不允许客户端重置 authority。
4. 准备 elevated Windows CI/本机管理员 E2E 门禁，并保持缺少权限时显式 skip 而非伪通过。

## 第 65 轮

日期：2026-08-16  
总体进展：**72%**（折算分较上轮 +1；`2159 / 3000 = 71.97%`，显示为 72%）  
完全验收：**0 / 30**  
当前阶段：Windows privileged installer single coordinator 与 bootstrap 前向恢复

### 本轮完成

- `WindowsServiceBootstrapEnvelopeChannel.inspect()` 可在不消费 journal authority、不删除 DPAPI ciphertext 的前提下完成 schema、catalog、runtime build、installation metadata、install root、service name 与 service SID 的全身份验真；恢复进程不再需要盲目重发 token。
- 新增 durable `WindowsInstallerCoordinator`，把 filesystem、SCM、installer journal、bootstrap envelope 与 service activation 串成固定阶段机；协调器身份永久绑定 operation、catalog digest、install root 与 binary filename。
- 同一 install root 只允许一个 active coordinator；阶段推进使用旧状态条件更新，陈旧/并发 writer 会收到 `windows_installer_coordinator_raced`，不能重复提交阶段。
- 提交前异常由 `_CompositeRollback` 在 installer journal 持有的同一 SQLite writer transaction 中按 SCM→filesystem 顺序回滚；避免恢复了文件、但旧 SCM 仍可引用攻击者或半安装 binary 的顺序错误。
- `committed` 之后禁止回滚新版本并假装恢复旧 authority；发布、finalize 或 start 失败会调用 SCM fail-safe disable/stop，并将 durable 状态推进为 `recovery_required`。
- 支持 envelope 已发布但 coordinator phase 尚未写入时的重新检查；支持 SCM finalization 已完成但 phase commit 前崩溃时，以完整 final installation verification 作为前向恢复证据。
- 未修改 Agent Core、TUI、WebUI、OAEP wire、客户端权限入口或 Approval 决策语义。

### 功能点进展

| 功能点 | 进度 | 本轮证据 | 尚缺验收 |
|---|---:|---|---|
| P0-F02 文件系统沙箱 | 99% | 文件 promote 与 SCM 变更首次由单一 durable phase owner 编排，提交前使用组合回滚 | elevated SYSTEM-owner、真实安装/升级/repair 全流程与逃逸套件 |
| P0-F09 安全回执与可观测性 | 99% | coordinator phase/identity 与 envelope inspect 均为 durable、可审计、fail-closed | coordinator 全阶段事件/指标、磁盘损坏与外部审计演练 |
| P1-F06 Exactly-once Grant/副作用 | 99% | bootstrap authority 可验真但不消费；并发 coordinator 的陈旧 phase commit 被拒绝 | start-intent 崩溃窗口、stranded issued-without-envelope 自动修复与真实多进程 E2E |
| P2-F04 隔离完全访问 | 93% | privileged installer side effects 已进入固定 coordinator，而不是由产品客户端拼装 | signed packaged worker、AppContainer 联合 canary 与产品 E2E |
| 其余既有功能点 | 不变 | 见前轮 | 继续按三份方案推进 |

折算：本轮为 P1-F06 的 installer exactly-once/recovery 证据增加 1 分；其余仍未跨越完整验收门槛。累计 `2159 / (30 × 100) = 71.97%`，显示为 72%。

### 本轮测试

- envelope inspect + coordinator 专项：12 passed，1 skipped。
- installer journal/filesystem/SCM/envelope/coordinator 组合：46 passed，1 skipped。
- 显式把 `DRSAI_HOME` 定位到工作区可写测试目录后的扩展 security-boundary 回归：145 passed，1 skipped，2897 deselected；首次全包收集失败确认是默认 feedback DB 路径不可写，不是测试断言回归。
- Python `compileall` 与本轮变更范围 `git diff --check` 通过。
- skipped 为需要特定 Windows elevated SYSTEM-owner ACL 环境的原生证据；本轮没有把它描述为通过。

### 仍然明确未完成

1. `issue_bootstrap_authorization()` durable commit 成功、但 envelope publish 前进程死亡时，token 只存在于死亡进程内；当前会 fail-safe 并要求恢复，尚不能自动重新构造 authority。
2. `StartService` 成功、但 coordinator 写 `completed` 前死亡时，仍缺 durable start-intent + running PID/authorization status reconciliation。
3. 尚未完成每个阶段注入 process kill 的真实新进程矩阵，也没有 elevated CreateService/restore/delete 的完整 coordinator E2E。

### 下一轮

1. 增加 bootstrap `publishing` intent 与可恢复的 envelope publication transaction，消除 issued-without-envelope stranded authority。
2. 增加 durable `starting` intent、SCM running evidence 与 issued/consumed/activated 状态 reconciliation，关闭 StartService 后崩溃窗口。
3. 用独立进程在每个 durable phase 后强制终止，验证单 owner、组合回滚、前向恢复和 fail-safe 状态。
4. 在具备管理员权限的 Windows runner 上执行真实 CreateService/ChangeServiceConfig/DeleteService 与 SYSTEM-owner envelope ACL E2E。

## 第 64 轮

日期：2026-08-16  
总体进展：**72%**（CreateService/snapshot/restore 代码已完成，但 elevated 真服务与 coordinator E2E 尚未验收；`2158 / 3000 = 71.93%`）  
完全验收：**0 / 30**  
当前阶段：Ownership-marked durable SCM registration、owned delete 与 exact restore

### 本轮完成

- 审计发现 begin 的 safety controller 会先把 automatic/manual service 改成 disabled，但旧 start type 未持久化；升级 rollback 因而无法知道修改前配置。本轮先修复该证据丢失。
- `WindowsInstallerServiceSafetyEvidence` 新增 `previous_start_type`；native controller 在 `ChangeServiceConfigW(disabled)` 前读取并限制为 automatic/manual/disabled，service 不存在时必须为 null。
- `WindowsInstallerOperation` 和 SQLite operation table 新增 `prior_service_registered/prior_service_start_type`；构造时有 additive migration，旧数据库不会因缺列启动失败。
- begin 在 service disable/stop/PID=0 与 operation insert 的同一逻辑链中持久化 pre-disable evidence；后续 safety probe 的临时 disabled 不再覆盖升级前事实。
- 新增 `windows_installer_scm_actions.py` 和 durable SCM action table，绑定 operation/service、prior missing/existing、完整 snapshot、desired disabled config、两个 canonical digest 与 operation-specific ownership marker。
- snapshot 包含 binary、account、pre-disable start type、service type、SID type、delayed-auto-start 和旧 description；desired 绑定 promoted install root 内现存 binary、LocalSystem/own-process、disabled、catalog SID type。
- SQLite trigger 禁止修改 SCM identity/snapshot/desired/marker；每次读取 action 重算 digest、验证 prior/snapshot 一致性和 marker 格式，不能通过直接改数据库重定义恢复目标。
- Native adapter 实现 `CreateServiceW`、`ChangeServiceConfigW`、`ChangeServiceConfig2W` description/SID/delayed-start、`DeleteService` 和有界删除确认；binary 拒绝参数、环境展开、相对路径和错误 quoting。
- 新服务和升级服务都写 `OpenDrSai installer ownership/<operation-id>` marker。Create/Change 完成但 DB commit 前崩溃时，只在 marker + desired config 全部精确匹配时采用。
- Existing service 在修改前必须等于 durable snapshot，仅允许 start type 是 safety controller 写入的 disabled；SID/account/binary/type/delayed/description 任一漂移时先 fail-safe disable+stop，再拒绝覆盖。
- 新安装 rollback 只有 marker 与全部 desired config 仍匹配时才删除；同名 collision、marker 丢失或 config drift 时保留未知 service，绝不因名称相同删除。
- 升级 rollback 只有 marker 匹配时恢复完整旧 snapshot。若 restore 完成后进程在 DB commit 前崩溃，下一次 safety recovery造成 start type=disabled 时，仅接受“除该 start type 外与旧 snapshot逐字段相同”的状态并再次恢复。
- restore/delete/register 任何错误都调用 safety controller并要求 disabled/stopped/PID=0；action 与 installer operation 使用同一 SQLite rollback transaction原子收敛。
- SCM action 只有在 installer package verification/commit 完成，且当前 service 仍为 exact disabled+marker config 时才能标记 committed，随后才进入 envelope/final activation链。
- Native 本机测试仅 inspect 随机不存在的 service，证明 missing path 不创建服务；当前进程未对真实 Windows service执行 Create/Change/Delete。
- 未修改 Agent Core、Gateway、Electron、TUI、WebUI、Android 或客户端协议。

### 功能点进展

| 功能点 | 进度 | 累计证据 | 尚缺验收 |
|---|---:|---|---|
| P0-F01 不可变能力配置 | 99% | SCM pre-change/desired config、digest 与 ownership marker 已持久不可重定义 | 组织 policy、正式 package/HSM、全入口与独立评审 |
| P0-F03 进程/资源隔离 | 99% | Create/change/delete/restore 均要求 disabled/stopped/PID=0 和精确 service ownership | elevated 真服务、signed AppContainer 与完整逃逸套件 |
| P0-F10 迁移/fail-closed | 99% | filesystem + SCM 两类真实 installer 副作用已有 durable crash recovery；未知 service 不删除 | single coordinator、全部入口、process-kill/断电和发布门禁 |
| P1-F10 Approval 可观测性 | 99% | observability host 的正式 service register/rollback 已有 native实现和 marker gate | elevated package/service、仪表盘/路由与演练 |
| P2-F04 隔离完全访问 | 99% | isolated host service 配置可在升级失败时恢复旧 build，半配置服务保持 disabled | signed AppContainer/service、network/credential canary 与产品 E2E |
| 其余既有功能点 | 不变 | 见前轮 | 继续按三份方案推进 |

折算：相关功能仍缺 elevated 真服务与跨 action coordinator E2E，本轮不把 99% 提前计为 100%；累计保持 `2158 / 3000 = 71.93%`，显示为 72%。

### 本轮测试

- SCM action 专项：9 passed。
- SCM + journal 最终专项组合：23 passed。
- Installer filesystem/ACL/SCM、journal、envelope、activation、deployment/factory/native pipe 组合：93 passed，2 skipped。
- Approval/capability/filesystem/network/credential/sandbox/isolation/Windows 扩展安全域：437 passed，2 skipped。
- 覆盖 existing snapshot/restore、新 service owned delete、unowned marker preservation、create后 crash adopt、pre-change drift、restore后/DB commit前 retry、identity trigger和 native missing service。
- Python compileall、新增文件行长检查通过；当前虚拟环境未安装 Ruff。
- 未运行 elevated CreateService/Change/Delete，因而未声称 native 正向 SCM 变更完成验收。

### 下一轮

1. 实现 single `WindowsInstallerCoordinator`，按 filesystem prepare/stage/promote → SCM register → installer verify/commit → envelope publish → SCM final verify/start 编排，并持久记录跨 action phase。
2. Coordinator recovery 按 filesystem/SCM/installer 三个 durable identity联合判断，禁止各 action独立猜测成功；任一步不确定先保持 service disabled/stopped。
3. 增加每个跨 action 边界的 process kill、双 coordinator竞争、SQLite FULL/IOERR/CORRUPT 和 disk-full fault injection。
4. 在专用 elevated runner 创建随机测试 service，验证 Create/restore/delete、SYSTEM owner、standard-user/其他 service denial 和 marked-for-delete handle长尾。

## 第 63 轮

日期：2026-08-16  
总体进展：**72%**（本轮补齐 production ACL 实现，但 elevated SYSTEM-owner/CreateService/E2E 门禁仍未完成；`2158 / 3000 = 71.93%`）  
完全验收：**0 / 30**  
当前阶段：Installer transaction/staging/promoted tree 的 trusted-writer/service protected DACL

### 本轮完成

- 新增 `NativeWindowsInstallerTreeAclApi`，通过 PyWin32 创建并回读 installer transaction、staging、artifact 和 promoted tree 的 owner/DACL；不再依赖 `chmod` 或继承 ACL 表示 Windows 安全边界。
- ACL policy 由排序后的 trusted writer SID 集合和精确 service SID 计算稳定 SHA-256，写入 filesystem action row；重启以不同 writer/service policy 接管时，在任何文件操作前拒绝。
- trusted writer 集合不能为空，且必须排除 Runtime service SID；service 不能同时成为安装树 writer。
- 若 SYSTEM 在 writer policy 中，owner 固定为 SYSTEM；否则 owner 必须是 pinned trusted writer。DACL 必须 protected，拒绝 inherited child DACL。
- transaction root 只允许 trusted installer writers full control，service 无访问权；staging/promoted root 和每个 artifact 允许 writers full control、service SID 仅 generic read/execute。
- exact ACL verifier 要求标准 allow ACE、无重复 SID、精确 access mask、目录精确 OI/CI flags、文件零 inheritance flags；额外 writer、Everyone write、未知/object ACE、service write 或 policy缺项均拒绝。
- 创建 transaction root 前检查 parent 不是 reparse point，并读取 parent owner/DACL；owner 只允许 pinned writer、SYSTEM、Administrators 或 Windows Modules Installer，任何其他 identity 具有 write/delete/ACL-takeover allow 权限时拒绝创建。
- existing install tree 在 action prepare 时递归复验；staging tree 在移动旧版本前递归复验；每次 atomic rename 后再次验证 destination root 和全部 artifacts。ACL 被替换时不会先 quarantine 旧安装。
- artifact copy+digest 后立即应用显式 protected file DACL；partial staging 重试只有 digest 和 ACL 同时精确匹配才采用。
- `WindowsSecurityInstallationVerifier` 现在把 `dacl_protected=false` 作为独立 fail-closed 错误；最终安装不能再依赖可能从未来可写 parent 继承的 ACL。
- 更新 native installation ACL 测试：在临时对象上显式建立 protected DACL 后做 baseline，再注入 Everyone write；测试结束逐对象恢复原 SDDL，不修改 workspace 或系统目录。
- 新增 native installer tree ACL 测试，使用当前用户作为临时 trusted writer实际执行 SetFileSecurity、精确 service read/execute、额外 Everyone writer 拒绝和 parent writer 拒绝。未把该测试声称为 SYSTEM-owner 证据。
- 新增 ACL policy digest 替换、staging ACL tamper-before-quarantine 和 transaction/service access policy测试。
- 未修改 Agent Core、Gateway、Electron、TUI、WebUI、Android 或客户端协议。

### 功能点进展

| 功能点 | 进度 | 累计证据 | 尚缺验收 |
|---|---:|---|---|
| P0-F01 不可变能力配置 | 99% | installer writer/service ACL policy 已持久摘要绑定，重启不能用不同 policy 接管 action | 组织 policy、正式 package/HSM、全入口与独立安全评审 |
| P0-F02 文件系统边界 | 95% | 安装树新增 native protected-DACL、parent writer、service read-only 和 rename 后复验 | AppContainer OS view、非 Windows 等价边界、TOCTOU/路径全集与打包 E2E |
| P0-F03 进程/资源隔离 | 99% | service SID 对 executable/policy tree 只有 RX，ACL tamper 在旧版本移动前拒绝 | CreateService/SCM snapshot、signed AppContainer 真机与逃逸套件 |
| P0-F10 迁移/fail-closed | 99% | durable filesystem action 已包含生产 ACL创建/复验，错误 ACL 不进入 promote | SCM register/restore、全部入口迁移、elevated installer与发布门禁 |
| P1-F10 Approval 可观测性 | 99% | observability service 可读 signed policy/build但不能写安装树，pipe bootstrap channel单独隔离 | 正式 service/package、仪表盘/路由与演练 |
| P2-F04 隔离完全访问 | 99% | isolated worker/service package 在升级全过程保持 writer/service 最小权限 | signed AppContainer/service、network/credential canary 与产品 E2E |
| 其余既有功能点 | 不变 | 见前轮 | 继续按三份方案推进 |

折算：native ACL 实现已补齐，但 P0-F02 仍缺完整 OS view/打包逃逸套件，其余相关项仍缺 SCM/正式 E2E；本轮累计保持 `2158 / 3000 = 71.93%`，显示为 72%。

### 本轮测试

- Filesystem action + installation ACL/verifier 专项：38 passed，1 skipped。
- Installer filesystem/ACL、journal、envelope、activation、deployment/factory/native pipe 组合：84 passed，2 skipped。
- Approval/capability/filesystem/network/credential/sandbox/isolation/Windows 扩展安全域：428 passed，2 skipped。
- 覆盖原生 SetFileSecurity/ACL readback、service RX、Everyone write、parent writer、protected-DACL、policy digest、staging tamper 和 rename后复验。
- Python compileall、新增文件行长检查通过；当前虚拟环境未安装 Ruff。
- skipped 仍包括非 elevated 测试进程无法创建 SYSTEM owner 的正式目录，以及既有 symlink 权限环境限制；没有降低生产 owner/DACL 要求。

### 下一轮

1. 实现 CreateService/register action 与 durable pre-change snapshot：missing/existing、binary、start/account/service type/SID type/delayed-auto-start全部持久绑定。
2. 新服务失败时只删除本 operation 创建且 identity仍匹配的 service；升级失败时恢复精确旧配置，并保持 disabled/stopped/PID=0。
3. 将 filesystem action、SCM action、installation verifier、envelope 和 final activation 编排成 single installer coordinator，做跨 action crash recovery。
4. 增加 elevated SYSTEM-owner/standard-user/other-service 双账户测试，以及 SQLite FULL/IOERR/CORRUPT、磁盘满和逐阶段外部 process kill。

## 第 62 轮

日期：2026-08-16  
总体进展：**72%**（本轮新增真实实现证据，但未跨越任何剩余 1% 的完整验收门槛；`2158 / 3000 = 71.93%`）  
完全验收：**0 / 30**  
当前阶段：Durable same-volume staging、atomic promote、identity-based rollback

### 本轮完成

- 新增 `windows_installer_filesystem_actions.py`，将 package copy、旧版本 quarantine、新版本 promote、rollback 和 filesystem commit 独立放在 Runtime security boundary；未修改 Agent Core 或任何客户端。
- 每个 action 精确绑定 installer operation、package/install/transaction/staging/quarantine/failed path、canonical artifact-set digest、原目录 identity 和 staging identity；同一 install root 只允许一个活跃 action。
- artifact 输入只接受唯一 basename 和 canonical SHA-256；inventory 按 filename 排序后计算稳定 digest，调用顺序不能改变 authority identity。
- package/staging/source/destination 必须是普通文件或目录；symlink、junction/reparse、特殊对象、额外 staging inventory 和错误 digest 全部拒绝。
- copy 使用 create-new、partial-write loop 和 file fsync；复制后证明 source device/file/size/mtime 未变，并同时校验 source/destination digest。崩溃留下的部分 staging 只有内容完全匹配时才幂等采用。
- staging 与 install root 固定为同级同卷；Windows promotion 使用 `MoveFileExW(MOVEFILE_WRITE_THROUGH)`，目标存在时绝不覆盖。package source允许从其他卷复制，但 rename 不能跨卷。
- 升级固定执行 old install→quarantine，再 staging→install；每次 rename 后验证目录 device/file identity。staging 被替换会在移动旧版本前拒绝，quarantine 被占用不会覆盖未知目录。
- promote 只有在 installer journal 已持久化 exact artifact-set digest 且处于 `artifacts_staged` 时允许；filesystem commit 还要求 installer operation 已 committed，并重新证明 install=staged identity、quarantine=original identity。
- SQLite writer transaction 覆盖每个 OS rename。进程在 rename 后、DB commit 前崩溃时，恢复不猜测旧 state，而是检查四个受控路径的持久 identity。
- rollback 对升级先把 promoted identity 移回 staging/failed，再把 original identity 从 quarantine 恢复；新安装 rollback 将 promoted 目录移回 staging，不递归删除内容。
- quarantine identity 被替换时 rollback 不会把未知目录恢复为正式安装；filesystem action 与 installer operation 在同一 SQLite transaction 中共同进入 rollback-failed，旧版本和攻击目录均保留供处置。
- 修复 installer rollback callback 的嵌套 SQLite writer 问题：具备 `rollback_in_transaction` 的 bound rollback handler 复用 installer 的 writer connection，避免 30 秒锁等待、锁反转和 action/operation 双状态部分提交；普通 callback 行为保持兼容。
- 两个进程/线程竞争同一 promote 时只有一个完成 rename，另一个在 durable state gate 拒绝；重复 rollback 幂等。
- append-only filesystem event table 禁止 update/delete，并同步写统一 SecurityEventJournal hash chain。

### 功能点进展

| 功能点 | 进度 | 累计证据 | 尚缺验收 |
|---|---:|---|---|
| P0-F01 不可变能力配置 | 99% | installer operation、artifact inventory 与实际 old/staged/promoted directory identity 已做持久交集 | 正式 package/ACL/组织 policy、断电灾备与独立评审 |
| P0-F03 进程/资源隔离 | 99% | service disabled 期间才可 stage/promote；旧/新 executable tree 以原子 rename 和 identity 绑定 | CreateService/register、signed service/AppContainer 真机与逃逸套件 |
| P0-F10 迁移/fail-closed | 99% | 真实 copy/rename/rollback 已进入 durable action journal；崩溃和路径不确定性不删除未知数据 | production ACL、SCM snapshot/restore、全部入口/发布/升级 E2E |
| P1-F10 Approval 可观测性 | 99% | observability service package 可经同一 durable promotion 后再进入 envelope/final-start 门禁 | 正式 installer/service、仪表盘/路由与演练 |
| P2-F04 隔离完全访问 | 99% | isolated worker/service 的升级目录切换具备 crash-safe rollback，不会启动半安装 build | signed AppContainer/service、network/credential canary 与产品 E2E |
| 其余既有功能点 | 不变 | 见前轮 | 继续按三份方案推进 |

折算：本轮没有把尚缺 production ACL/SCM/E2E 的 99% 功能提前计为 100%；累计保持 `2158 / (30 × 100) = 71.93%`，显示为 72%。

### 本轮测试

- Filesystem action 专项：9 passed。
- Installer filesystem、installation verifier、journal、envelope、activation、deployment/factory/native pipe 组合：81 passed，2 skipped。
- Approval/capability/filesystem/network/credential/sandbox/isolation/Windows 扩展安全域：425 passed，2 skipped。
- 覆盖真实文件 copy/digest/fsync、旧版本 quarantine、新版本 promote/commit、新安装 rollback、两个 rename 后 crash、retry、双 promote 竞争、partial staging、staging/quarantine replacement 和 append-only event。
- Python compileall、新增文件行长与 diff 检查通过；当前虚拟环境未安装 Ruff。
- 尚未运行 elevated Program Files ACL、真实磁盘满、SQLite IOERR/CORRUPT 和外部进程 kill，因此没有增加完整验收数或把任何 99% 功能记为完成。

### 下一轮

1. 为 transaction/staging/quarantine/failed 目录实现 SYSTEM/trusted-installer owner、protected DACL、精确继承和重启 ACL 复验，拒绝 standard user/service 写入安装树。
2. 实现 CreateService/register snapshot/restore action：记录 existing/missing、binary/start/account/SID/delayed config，失败时删除 owned 新服务或恢复升级前配置。
3. 将 filesystem action、SCM register、installation verifier、envelope 与 final start 编排为单一 installer coordinator，覆盖每阶段 process kill 和 recovery。
4. 增加 SQLite FULL/IOERR/CORRUPT、磁盘满、目录 fsync/MoveFileEx failure 与 elevated 双账户攻击 E2E。

## 第 61 轮

日期：2026-08-16  
总体进展：**72%**（折算分较上轮 +1；`2158 / 3000 = 71.93%`，显示为 72%）  
完全验收：**0 / 30**  
当前阶段：Installer-safe/final SCM 两阶段验证与 envelope-gated service activation

### 本轮完成

- 审计正式 SCM 接线时发现不可实现状态：journal 在 package verification/commit/issue 时要求 service disabled，而 installation verifier 同时要求同一 SCM service 已是 catalog final automatic。真实 service 无法同时满足两种 start type；此前 fake safety evidence 掩盖了该矛盾。
- `VerifiedWindowsSecurityInstallation` 新增明确 `service_configuration_phase`；默认 `final`，installer 路径必须显式取得 `installer_safe` evidence，避免把旧的 automatic evidence 当作当前 disabled 事实。
- `WindowsSecurityInstallationVerifier` 新增 `installer_safe_mode`：签名 metadata/catalog 仍固定最终 start type，但 OS evidence 必须是 disabled；binary、account、service SID/type、delayed-start、artifact、ACL 和 digest 仍按原规则完整验证。
- journal 的 `mark_package_verified()`、`commit()`、`issue_bootstrap_authorization()` 现在都只接受 exact `installer_safe` installation；仅 safety controller 声称 disabled、但 installation evidence 仍是 final/automatic 时拒绝。
- 新增 `PublishedWindowsServiceBootstrapEnvelope`，只有 DPAPI/ACL envelope 文件成功发布后返回，绑定 path、authorization/operation、catalog/build/metadata、service/SID 和 expiry，不含 token。
- 新增 `WindowsInstallerServiceActivationController`，固定顺序为 installer-safe verify → journal commit/issue → envelope publish → SCM final config → full final reverify → SCM start。
- finalize 前回查 authorization 仍 issued、TTL 未过期，且 published receipt 全 identity 精确匹配；伪造 receipt、错误 SID/build/root、过期或已 consumed token 均不能把 service 改为 final start type。
- final config 写入后立即回读 SCM；除 binary 由后续完整 final verifier绑定外，service name/SID/account/start/service type/SID type/delayed start 必须与 catalog 一致。
- start 只接受重新验证得到的 `final` installation，并在 `StartServiceW` 前再次读取 SCM，要求 evidence 与 final verifier 逐字段相等，封闭 verify/start 配置漂移窗口。
- native start 必须在有界时间证明 running 且 PID>0；final config 不匹配、SCM drift、start exception 或 running proof 不足时调用既有原生 safety controller disable+stop，并要求 stopped/PID=0。回退无法证明时返回独立 rollback-unproven 错误。
- Native adapter 的正向能力仅为修改已存在 pinned service 的 start type 和启动该 service；不创建任意 service，不接受 binary/arguments/account/SID 变更。本机测试只打开随机不存在的 service，确认 fail closed，未修改真实系统服务。
- 新测试覆盖 installer-safe→final 双验证、automatic evidence 不能提前 verify/commit/issue、published envelope gate、过期/伪造/consumed authority、final config drift、失败回退及 native missing-service 拒绝。
- 未修改 Agent Core、Gateway、Electron、TUI、WebUI、Android 或客户端协议。

### 功能点进展

| 功能点 | 进度 | 累计证据 | 尚缺验收 |
|---|---:|---|---|
| P0-F01 不可变能力配置 | 99% | SCM phase、signed final intent、published envelope 与 journal authority 已做确定性交集，fake disabled evidence 不再跨 phase 复用 | 正式 installer/service 接线、组织 policy、断电/灾备与独立评审 |
| P0-F03 进程/资源隔离 | 99% | 只有 final reverify 后可启动 pinned service；drift/start 异常强制 disable+stop/PID=0 | CreateService/register/restore、管理员 E2E、signed AppContainer 与完整逃逸套件 |
| P0-F10 迁移/fail-closed | 99% | 不可实现的 disabled/automatic 单阶段模型已拆分；所有 SCM 不确定结果回到更保守状态 | staging/promote/SCM register 真实 action、全部入口迁移和发布门禁 |
| P1-F10 Approval 可观测性 | 99% | observability service start 现绑定 envelope publish、issued TTL、final reverify 和 PID proof | 正式 service/package、production pipe、仪表盘/路由与演练 |
| P2-F04 隔离完全访问 | 99% | service/isolated host 不再能凭 stale final evidence 启动；verify/start drift 会撤回到 disabled/stopped | signed AppContainer/service、network/credential canary 与产品 E2E |
| 其余既有功能点 | 不变 | 见前轮 | 继续按三份方案推进 |

折算：上轮累计 2157 分；本轮增加 `0+0+0+0+1=1` 分；`2158 / (30 × 100) = 71.93%`，显示为 72%。

### 本轮测试

- Installation verifier、installer journal、envelope、activation、deployment/factory/native pipe 组合：72 passed，2 skipped。
- Approval/capability/filesystem/network/credential/sandbox/isolation/Windows 扩展安全域：416 passed，2 skipped。
- 覆盖 staged disabled evidence、final automatic reverify、phase confusion、receipt forge/expiry/consume、SCM drift、安全回退和 native nonexistent-service。
- Python compileall 通过；当前虚拟环境未安装 Ruff，未将 lint 记为通过。
- 两个 skipped 仍为 elevated SYSTEM-owner ACL 与 symlink 权限环境限制；没有用 current-user ACL 或弱路径检查替代。

### 下一轮

1. 实现 durable installer filesystem action journal：同卷 staging、旧版本 quarantine、新版本 atomic promote，每个 OS action 先写 intent，进程 kill 后按路径/file identity 确定性恢复。
2. 实现 CreateService/register snapshot/restore adapter：新安装失败删除 owned service；升级失败恢复原 binary/start/account/SID/delayed config；任何不确定性保持 disabled/stopped。
3. 把 protected ProgramData envelope directory、SCM register、finalize/start 与 installer operation 编排为单一 recovery transaction，并注入 rename/copy/SCM/SQLite FULL/IOERR 故障。
4. 在 elevated 双账户 runner 验证 Program Files、SYSTEM owner/service SID ACL、standard-user/其他 service/AppContainer access denied，再继续 network/credential 联合 canary。

## 第 60 轮

日期：2026-08-16  
总体进展：**72%**（折算分较上轮 +1；`2157 / 3000 = 71.90%`，显示为 72%）  
完全验收：**0 / 30**  
当前阶段：Machine-DPAPI + SYSTEM/service SID ACL bootstrap envelope 与 Runtime 端到端消费

### 本轮完成

- 新增独立 `windows_service_bootstrap_envelope.py`；仍位于 Runtime security boundary，未修改 Agent Core、Gateway、Electron、TUI、WebUI、Android 或客户端协议。
- installer authorization 以严格 schema canonical JSON 绑定 catalog/metadata、Runtime build、install root、service name/SID 和 expiry，再使用 `CRYPTPROTECT_LOCAL_MACHINE` DPAPI 加密；envelope 不含 token 明文。
- 明确 DPAPI machine scope 不是单独的进程权限边界；native file adapter 同时要求 envelope 目录和文件 owner=SYSTEM、protected DACL，且只允许 SYSTEM、Builtin Administrators、精确 service SID 三个 full-control ACE。
- 目录 ACL 使用 OI/CI 显式继承，文件 DACL 禁止继承；读取和删除前重新验证 owner、DACL、ACE type/mask/flags，错误 SID、额外 writer、继承 ACL 或未保护 DACL 均拒绝。
- installer 以 `CREATE_NEW`、exclusive handle、flush、write-through rename 发布；已有 envelope 不覆盖，bootstrap 目录 reparse point 拒绝。
- envelope 限制 64 KiB、严格拒绝未知字段和错误类型；Base64、DPAPI、entropy、schema、catalog/build/root/service identity 任一损坏均在 journal consume 前拒绝。
- 固定消费顺序为 ACL/read/decrypt/identity verify → durable `issued→consumed` → delete ciphertext → durable `consumed→activated`；客户端和环境变量不接触 token/receipt。
- journal 新增只读的 exact-secret `bootstrap_authorization_status()`，仅在 token、latest operation 和所有 installation identity 均匹配时返回状态，用于判断崩溃残留，不能生成 receipt 或改变权限。
- consume 后删除失败会显式失败且 authorization 保持 consumed；重启再次看到同一真实密文时只删除残留并返回 replay-cleaned，不重新派生 receipt。伪造 envelope 不会触发清理。
- 新增 `SecurityObservabilityRuntimeFactory.from_verified_service_envelope()`，直接消费 channel、生成 receipt 并立即 DB claim；enabled factory 不再需要任何客户端或普通调用方中转授权。
- native machine-DPAPI 在本机实际完成加解密往返。当前测试进程不是 elevated installer，无法为测试目录指定 SYSTEM owner；对应 native ACL 创建验收明确 skipped，没有以 current-user owner 降级安全要求。

### 功能点进展

| 功能点 | 进度 | 累计证据 | 尚缺验收 |
|---|---:|---|---|
| P0-F01 不可变能力配置 | 99% | enabled authority 已形成 signed install→journal token→DPAPI/service ACL envelope→consume/claim→one-shot factory 的完整代码路径 | 正式 elevated installer/service 接线、组织 permission policy、断电/灾备与独立安全评审 |
| P0-F03 进程/资源隔离 | 99% | bootstrap 文件身份由 SYSTEM owner + 精确 service SID DACL 控制，错 SID 无法通过 channel | 正式 signed service、管理员/非管理员双账户 ACL E2E、AppContainer 完整逃逸套件 |
| P1-F10 Approval 可观测性 | 99% | host observability factory 可直接消费 service-only envelope，环境变量与客户端不再承担授权传递 | 正式 package/service、production pipe、仪表盘/告警路由与演练 |
| P2-F04 隔离完全访问 | 98% | service host bootstrap transport 已具备 OS ACL、加密、不可重放和崩溃残留语义 | signed AppContainer/service、network/credential canary、正式产品 E2E |
| 其余既有功能点 | 不变 | 见前轮 | 继续按三份方案推进 |

折算：上轮累计 2156 分；本轮增加 `1+0+0+0=1` 分；`2157 / (30 × 100) = 71.90%`，显示为 72%。

### 本轮测试

- Envelope/journal/deployment/factory/native pipe 专项组合：42 passed，1 skipped。
- Approval/capability/filesystem/network/credential/sandbox/isolation/Windows 扩展安全域：410 passed，2 skipped。
- 覆盖 token 非明文、错误 service SID/entropy、密文篡改、严格 schema、单次消费/claim、delete failure、crash residual replay-cleanup 和 factory 端到端启动。
- Python compileall 通过；新增文件行长已修正。当前虚拟环境未安装 Ruff，未将 lint 记为通过。
- skipped 项包括普通测试进程不能创建 owner=SYSTEM 的 service-only 目录，以及既有 symlink 权限限制；二者都未通过放宽生产安全条件规避。

### 下一轮

1. 实现 privileged installer action adapter：创建受保护 ProgramData bootstrap 目录、写 envelope、配置正式 service SID/start ACL，并在 SCM 启动前完成 catalog/installation 二次验证。
2. 增加 elevated 双账户 E2E：installer/admin 可发布，精确 service SID 可读删，Desktop standard user、其他 service SID 和 AppContainer 均 access denied；覆盖目录/file replace、hardlink、junction 和 rename race。
3. 将 staging、atomic promote、quarantine、SCM register/enable/start 与 rollback handler 落为真实幂等动作，执行逐阶段 kill、磁盘满、SQLite IOERR/CORRUPT。
4. 继续 signed AppContainer、network/credential 联合 canary和告警演练；全部门禁通过前完全访问模式保持不可用。

## 第 59 轮

日期：2026-08-16  
总体进展：**72%**（折算分较上轮 +2；`2156 / 3000 = 71.87%`，显示为 72%）  
完全验收：**0 / 30**  
当前阶段：Consumed installer bootstrap receipt 与 enabled observability factory 强制门禁

### 本轮完成

- 审计发现既有 `SecurityObservabilityRuntimeFactory.from_verified_deployment()` 和公开 constructor 仍可使用 enabled config 直接构造 pipe，绕过第 58 轮 installer commit/bootstrap journal；本轮关闭该内部旁路。
- 新增 frozen `ConsumedWindowsServiceBootstrapReceipt`；journal 只有在 token、authorization、operation、catalog、metadata、service 和 TTL 全部匹配时，才原子执行 `issued → consumed` 并返回不含 token 的 receipt。
- receipt 精确绑定 authorization/operation ID、catalog digest、metadata digest、Runtime build digest、install root、service name/SID、consumed-at 和 expires-at。
- 新增 durable `claim_bootstrap_for_runtime()`：factory 不信任 dataclass 形状，而是回查 authorization+operation DB、最新 root operation、committed state、全部 identity/timestamp，并原子执行 `consumed → activated`。
- receipt 伪造、过期、已 claim、catalog/build/metadata/root/service mismatch、operation 非 committed 或不是该 root 最新 operation 均拒绝。
- 新 installer operation 现在撤销旧 `issued/consumed/activated` authorization；begin 已先原生 disable/stop 旧 service，所以进程内残留 receipt 不能在升级中重建旧 pipe。
- `from_verified_deployment()` 继续允许 disabled manifest 构造无 transport Runtime；enabled manifest 在 policy/数据库副作用前返回 `security_observability_bootstrap_required`。
- 新增 `from_verified_service_bootstrap()`：只接受 enabled verified deployment + consumed receipt，并再次绑定 install root、Runtime build digest 和 service SID，再 claim durable DB authority。
- 公开 `SecurityObservabilityRuntimeFactory(...)` constructor 对任意 `pipe_enabled=true` config 直接拒绝；测试或其他内部调用不能通过绕过 classmethod 开启 transport。
- enabled factory 实例只允许一次 `build()`；authority 在任何 policy/transport 工作前消耗，backend/policy/build 失败后不能重试或复用同一 factory。
- 不可信 native pipe backend 在 receipt claim 后仍于 SLO policy acceptance 前拒绝；bootstrap authority 不能放宽 Win32 backend identity 门禁。
- 测试覆盖 direct-constructor bypass、enabled deployment bypass、receipt DB claim、factory instance replay、receipt replay、forge/expiry/supersede、升级撤销和 untrusted backend 零 policy acceptance。
- 未修改 Agent Core、Gateway、Electron、TUI、WebUI 或客户端协议；host pipe 未接 production bootstrap。

### 功能点进展

| 功能点 | 进度 | 累计证据 | 尚缺验收 |
|---|---:|---|---|
| P0-F01 不可变能力配置 | 98% | enabled observability authority 现从 exact committed install→单次 token→durable consumed/activated receipt 派生，公开构造旁路关闭 | permission organization policy、正式 installer/HSM、全入口与断电/灾备验收 |
| P0-F03 进程/资源隔离 | 99% | 新 operation 先停 service 并撤销旧 activated receipt，旧宿主不能跨升级重启 | 正式 signed service、AppContainer 真机与完整逃逸套件 |
| P1-F10 Approval 可观测性 | 99% | host pipe 构造必须消费 installer bootstrap authority，receipt/backend 任一失败均不接受 policy或扩权 | service-only token channel、正式 package/service、仪表盘/路由与演练 |
| P2-F04 隔离完全访问 | 98% | service host bootstrap 也具备 exactly-once、跨升级撤销与 Runtime build/root/SID binding | 实际 token channel、signed AppContainer/service、network/credential canary 与产品 E2E |
| 其余既有功能点 | 不变 | 见前轮 | 继续按三份方案推进 |

折算：上轮累计 2154 分；本轮增加 `1+0+0+1=2` 分；`2156 / (30 × 100) = 71.87%`，显示为 72%。

### 本轮测试

- Installer receipt/factory/transport 专项及组合：35 passed。
- installer、key-policy、catalog、installation、observability 与 native pipe 扩大组合：72 passed，1 skipped。
- security/approval/permission/isolation/filesystem/network/credential/Windows 安全域回归：445 passed，1 skipped。
- 覆盖 token secret-at-rest、consume/activate 双阶段、direct factory/deployment bypass、factory replay、receipt forge/expiry/supersede、upgrade revoke 和 backend downgrade。
- Python compileall 与行长检查通过；当前虚拟环境仍未安装 Ruff，未将 lint 记为通过。
- installer→service token 仍没有实际 service-only ACL/IPC channel，正式 OpenDrSai service 也不存在，因此没有声称 P1-F10 或 P2-F04 完全验收。

### 下一轮

1. 实现 service-only bootstrap channel：installer 写入 DPAPI/ACL 保护的一次性 envelope，仅 SYSTEM/精确 service SID 可读取/删除；拒绝 Desktop user、继承 ACL、reparse 和路径替换。
2. service 读取并删除 envelope 后调用 journal consume/Runtime claim；崩溃在 read/delete/consume/claim 各阶段必须保持不可重放或明确恢复语义。
3. 实现真实 staging/atomic promote/quarantine/SCM rollback action adapter，并做逐动作 kill、磁盘满和 SQLite IOERR/CORRUPT。
4. 在正式 runner 完成 Program Files、signed service/AppContainer、network/credential、告警路由与 emergency drill。

## 第 58 轮

日期：2026-08-16  
总体进展：**72%**（折算分较上轮 +2；`2154 / 3000 = 71.80%`，显示为 72%）  
完全验收：**0 / 30**  
当前阶段：Crash-recoverable Windows installer journal、SCM safe state 与单次 bootstrap authority

### 本轮完成

- 新增 `WindowsInstallerOperationJournal`，把 install/upgrade/repair/rollback/uninstall 收敛为 Runtime/installer-owned durable state machine，不接受 Agent、Workspace、Gateway、Electron 或客户端 authority。
- 固定安全顺序：`safe_disabled → artifacts_staged → service_registered → package_verified → committed`；跳阶段或倒序转换拒绝。
- 修正真实依赖顺序：先将 service 注册为 disabled/stopped，随后 installation verifier 才能读取 SCM 并联合校验；不再允许“SCM 尚未注册却声称 package verified”。
- 每个 operation 精确绑定 install root、service name/SID、catalog ID/version/digest、Runtime build digest 和 installation metadata digest；catalog/metadata/root/service 任一替换均不能推进或提交。
- begin、stage、register、verify、commit 每一步都重新要求 service disabled、stopped 且 process count=0；未注册的新 service 仅能作为 begin/staging 的安全状态，`service_registered` 阶段必须证明注册真实存在。
- 新增 `NativeWindowsInstallerSafetyController`：通过 Advapi32 把已存在 service start type 设置为 disabled、请求 STOP、有界轮询 `QueryServiceStatusEx` 并证明 PID=0；权限、disable、stop、timeout 或状态读取失败均 fail closed。
- 原生测试只查询随机不存在的 service name，证明 `registered=false/disabled/stopped/no-process`；没有对 EventLog 或其他真实系统服务执行任何修改。
- operation current state 可推进，所有状态事实另写 append-only installer event 和统一安全哈希链；installer event 表禁止 update/delete。
- startup recovery 对 `safe_disabled/artifacts_staged/service_registered/package_verified/rolling_back/rollback_failed` 全部先重新停用 service，再进入 privileged rollback callback。
- SQLite writer transaction 覆盖整个 rollback callback，阻止两个 installer/recovery 进程并发执行同一回滚；进程崩溃释放事务并保留原阶段，要求 handler 幂等重试。
- rollback handler 失败持久为 `rollback_failed` 且 service 保持安全；后续启动可以再次恢复，不能因回滚失败转为启动 service。
- committed 本身不启动 service；新增一次性 `WindowsServiceBootstrapAuthorization`，使用 256-bit 随机 token、SQLite 仅存 token SHA-256、短 TTL、每 operation 最多签发一次且只能消费一次。
- token、authorization ID、catalog、metadata、service 或 operation 替换、过期和重放均拒绝；未 committed 或非该 root 最新 operation 不能取得 bootstrap authority。
- 新 install/upgrade/repair 开始时，同一事务撤销该安装根所有旧 issued bootstrap token；旧 committed install 不能在新 upgrade staging 期间复活旧 service。
- 未将 authorization 接入正式 service 或 host pipe；Electron/Gateway/TUI/WebUI/Agent Core 保持零改动。

### 功能点进展

| 功能点 | 进度 | 累计证据 | 尚缺验收 |
|---|---:|---|---|
| P0-F01 不可变能力配置 | 97% | signed package identity 之外，installer operation/commit/bootstrap authority 现有精确持久绑定和跨升级撤销 | permission organization policy、正式 installer/HSM、全入口与断电/灾备测试 |
| P0-F03 进程/资源隔离 | 99% | installer/recovery 可原生证明 service disabled/stopped/PID=0，任何非终态不启动宿主 | 正式 signed service、AppContainer 真机与完整逃逸套件 |
| P1-F10 Approval 可观测性 | 99% | observability service 只有 committed exact installation 才能取得单次 bootstrap token，旧升级 token 自动撤销 | 正式 service-only channel、package/key、仪表盘/路由与演练 |
| P2-F04 隔离完全访问 | 97% | isolated worker/service 的安装、SCM、commit 和 bootstrap 生命周期已持久收敛且 crash 默认停用 | 真实 rollback handler、signed AppContainer/service、network/credential canary 与产品 E2E |
| 其余既有功能点 | 不变 | 见前轮 | 继续按三份方案推进 |

折算：上轮累计 2152 分；本轮增加 `1+0+0+1=2` 分；`2154 / (30 × 100) = 71.80%`，显示为 72%。

### 本轮测试

- Windows installer journal 专项：12 passed。
- installer、key-policy、catalog、installation/SCM、deployment/factory 组合：59 passed，1 skipped。
- security/approval/permission/isolation/filesystem/network/credential/Windows 安全域回归：443 passed，1 skipped。
- 覆盖四阶段 crash、unsafe service、错误转换、双进程 rollback 互斥、rollback failure retry、身份替换、token secret-at-rest、过期/篡改/重放和升级撤销。
- Python compileall 与行长检查通过；当前虚拟环境仍未安装 Ruff，未将 lint 记为通过。
- 真实 staging/rename/service-register/uninstall rollback handler、service-only token channel 和正式 service E2E 尚未提供，因此没有完全验收。

### 下一轮

1. 实现 installer filesystem/service action adapter：同卷 staging、原子目录切换、旧版本 quarantine、SCM register/remove，所有动作按 operation identity 幂等并可由 journal 恢复。
2. 实现 service-only bootstrap token channel 与 Runtime factory gate；service 消费 token 后仍须重验当前 key-policy/catalog/installation，Electron env 永远不能携带 token。
3. 增加逐动作 process-kill、磁盘满、SQLite IOERR/CORRUPT 和 rollback 中再次崩溃矩阵，再进入管理员 Program Files runner E2E。
4. 继续外部审计锚定和 signed AppContainer worker network/credential 联合真机 E2E。

## 第 57 轮

日期：2026-08-16  
总体进展：**72%**（折算分较上轮 +2；`2152 / 3000 = 71.73%`，显示为 72%）  
完全验收：**0 / 30**  
当前阶段：Root-signed package catalog key lifecycle、不可复活吊销与 emergency disable

### 本轮完成

- 新增 `windows-package-catalog-key-policy/1`，将永久静态 catalog key map 改为“Runtime 固化少量离线 root public key → root-signed key policy → 短生命周期 catalog signing key”的分层信任链。
- policy canonical payload 绑定 policy ID/version、product/channel、有效期、emergency disable，以及按 ID 排序无重复的 catalog key public material、activation、retirement、revoked-at/reason。
- 新增 `SignedWindowsPackageKeyPolicyLoader`：root key pin、严格 envelope/schema/type、64 KiB、basename/reparse/Workspace、有效期与 Ed25519 signature 全部 fail closed。
- key ID 和 revocation reason 限制为低基数安全 code；控制字符、自由文本或秘密不能进入 key-state 表和安全审计事件。
- 新增持久不可逆规则：已出现 key 不能从后续 policy 消失；同 ID public key/activation 不可改变；retirement 只能缩短；一旦 revoked，时间和原因不可删除、移动或改写。
- policy 版本单调；低版本 rollback 和同版本不同内容 redefinition 拒绝。换 root key 或 catalog key 均不能重置 policy/catalog version。
- 新增 append-only `runtime_windows_package_key_policy_versions`，保留每个接受版本；current policy/key state、版本事实和哈希链事件同一 SQLite 事务提交。
- 新增独立 `windows_package.catalog_key_revoked` 与 emergency disabled/enabled 审计事件；新 policy 中首次出现即已吊销的 key 也会记录吊销事实。
- `VerifiedWindowsPackageKeyPolicy.trusted_catalog_keys()` 同时检查 policy 有效期、emergency 状态、key activation/retirement 和 revoked-at；只有当前 active/non-revoked key 才可验证 catalog。
- `SignedWindowsSecurityPackageCatalogLoader.from_verified_key_policy()` 成为 key-policy 生产接线入口；构造时没有 active key 立即拒绝，每次 `load()` 还会重新评估生命周期，缓存 loader 不能在 key 退役、policy 过期或 emergency disable 后继续使用旧 map。
- 测试完成 old/new overlap、new-key 切换、old-key compromise 吊销、cryptographically-valid 旧 catalog 拒绝、吊销复活、key substitution、lifetime expansion、key removal、policy rollback 和 emergency disable。
- 本轮没有改 Agent Core、Gateway、Electron、TUI、WebUI；未创建 service、未启用 pipe，key 均为测试临时 key。

### 功能点进展

| 功能点 | 进度 | 累计证据 | 尚缺验收 |
|---|---:|---|---|
| P0-F01 不可变能力配置 | 96% | package trust 已有离线 root→可轮换 catalog key policy→catalog→metadata/Profile 工件链，吊销持久不可复活 | permission organization policy、正式 HSM/root ceremony、全部执行入口与属性/灾备测试 |
| P0-F03 进程/资源隔离 | 99% | worker/service package catalog key 被吊销或 emergency disabled 后无法继续验证新安装身份 | 正式 signed service、AppContainer 真机与完整逃逸套件 |
| P1-F10 Approval 可观测性 | 99% | observability package signing key 具备可审计 rotation/revocation/emergency 原语且控制面故障不放宽权限 | 正式 key/package/service、仪表盘/路由与运维演练 |
| P2-F04 隔离完全访问 | 96% | isolated worker/service package identity 延续 signed catalog 与不可复活 key policy | signed AppContainer 真机、network/credential canary、Gateway 接线与产品 E2E |
| P2-F08 管理员与组织策略 | 不变 | release key policy 不等同于用户/组织 permission policy，未错误计分 | 继续按 P2 方案实现和验收 |
| 其余既有功能点 | 不变 | 见前轮 | 继续按三份方案推进 |

折算：上轮累计 2150 分；本轮增加 `2+0+0+0=2` 分；`2152 / (30 × 100) = 71.73%`，显示为 72%。

### 本轮测试

- Windows package key-policy 专项：6 passed。
- key-policy、catalog 与 installation/SCM 组合：31 passed，1 skipped。
- key-policy、catalog、installer、release、deployment 与 factory 组合：47 passed，1 skipped。
- security/approval/permission/isolation/filesystem/network/credential/Windows 安全域回归：431 passed，1 skipped。
- 覆盖 root signature、overlap、retirement、revocation、reactivation、removal、substitution、lifetime expansion、emergency、cached-loader expiry和安全 reason code。
- Python compileall 与行长检查通过；当前虚拟环境仍未安装 Ruff，未将 lint 记为通过。
- 正式 offline root/HSM ceremony、key-policy builder/distribution 和 emergency drill 尚未提供，因此 P0-F01/P1-F10 仍未验收。

### 下一轮

1. 增加 key-policy 离线 deterministic builder/verifier、root rotation overlap 和 policy distribution receipt；私钥只允许 HSM/offline signer，不落 package。
2. 实现 crash-recoverable installer operation journal：stage/verify/service-register/commit/rollback/uninstall 逐阶段事实；任何中断保持 service disabled/stopped 且 pipe 不可开启。
3. 将 catalog/key-policy 接入实际 Windows release runner和 signed package catalog，运行非管理员 Program Files install/upgrade/repair/rollback 与 emergency drill。
4. 继续 SQLite FULL/IOERR/CORRUPT、外部审计锚定和 signed AppContainer worker network/credential 联合真机 E2E。

## 第 56 轮

日期：2026-08-16  
总体进展：**72%**（折算分较上轮 +3；`2150 / 3000 = 71.67%`，显示为 72%）  
完全验收：**0 / 30**  
当前阶段：非循环 signed Windows package catalog、发布 builder 与 installation trust derivation

### 本轮完成

- 新增 `windows-security-package-catalog/1`，解决 installation metadata 不能自证可信、又不能把其摘要写回待计算 Runtime executable 形成循环 pin 的问题。
- 非循环发布顺序固定为：先构建 service executable 并计算 `runtime_build_digest`，再生成 policy/deployment/pins、installation metadata，最后由离线 release key 签 catalog；Runtime 只需内置 release public key、catalog ID/product/channel/minimum version。
- catalog Ed25519 canonical payload 精确绑定 catalog ID/version、product/channel/build、metadata filename/ID/digest/min-version、release-pins filename/file digest、service identity、writer SID allowlist 与有效期。
- 新增 `SignedWindowsSecurityPackageCatalogLoader`：release key pin、build/channel/product identity、64 KiB 上限、basename/reparse/Workspace 防线、严格类型与当前有效期校验全部 fail closed。
- catalog 要求 writer SID 有序且大小写归一后无重复；service SID 不能成为 writer，service SID type 必须为 unrestricted，boolean 不能由整数冒充。
- release-pins 完整文件 SHA-256 由 signed catalog 绑定；即使只添加空白、JSON 语义未变，也视为磁盘 package artifact 被替换并拒绝。
- 新增 durable `runtime_windows_package_catalogs`：保存最高接受 version/digest/key ID；低版本 rollback 和同版本不同内容 redefinition 拒绝，新版本接受与 `windows_package.catalog_accepted` 哈希链事件同事务提交。
- 验证 key rotation overlap：Runtime 同时 pin old/new key 时可用 new key 接受更高版本；随后旧 key 的低版本不能因签名仍有效而回滚；换 key 也不能重置 catalog version。
- 新增 `WindowsSecurityPackageCatalogTool` 离线 builder：product/channel/build、metadata/service identity 和两个文件 digest 均从实际 staging 文件派生，调用者不能手填；输出 create-new、不覆盖，生产 loader 自验失败时删除半成品。
- `WindowsSecurityInstallationVerifier.from_verified_catalog()` 成为生产派生入口：metadata digest/min-version、service config 和 writer allowlist来自 frozen verified catalog，而不是安装目录自声明值。
- installation verifier 重新解析磁盘 release pins 并与调用链 frozen pins 逐字段比较；catalog 与 pins 文件自身也进入 owner/DACL/reparse 门禁和最终安装证据。
- 测试覆盖 payload 篡改、合法签名但错误 build、service-as-writer、pins 文件跨包替换、版本回滚、同版本重定义、双 key rotation、builder 不覆盖和失败清理。
- 未修改或接入 Agent Core、Gateway、Electron、TUI、WebUI；没有创建/启动 service，也没有启用 host pipe。

### 功能点进展

| 功能点 | 进度 | 累计证据 | 尚缺验收 |
|---|---:|---|---|
| P0-F01 不可变能力配置 | 94% | installation authority 现由 signed catalog、内置 release key、build identity 和持久防回滚派生，不再由 metadata 自证 | permission organization policy、正式 key/catalog、全部入口、key revocation 与属性测试 |
| P0-F03 进程/资源隔离 | 99% | worker/service 安装身份已进入 signed catalog→metadata→ACL→SCM 联合链 | 正式 signed OpenDrSai service、AppContainer 真机与完整逃逸套件 |
| P1-F10 Approval 可观测性 | 99% | observability service/policy/deployment 的安装 authority 已有非循环 signed catalog 和 key rotation/rollback 原语 | 正式 key/package/service、仪表盘/告警路由与运维演练 |
| P2-F04 隔离完全访问 | 96% | isolated worker 与 service host 的 package identity 由 signed catalog 派生并防回滚/跨包替换 | signed AppContainer worker/service 真机、network/credential canary、Gateway 接线与产品 E2E |
| P2-F08 管理员与组织策略 | 不变 | package release catalog 不等同于 permission organization policy，未错误计分 | 继续按 P2 方案实现和验收 |
| 其余既有功能点 | 不变 | 见前轮 | 继续按三份方案推进 |

折算：上轮累计 2147 分；本轮增加 `2+0+0+1=3` 分；`2150 / (30 × 100) = 71.67%`，显示为 72%。

### 本轮测试

- Windows catalog/installation/SCM 专项：25 passed，1 skipped；跳过项仍仅为当前进程无文件 symlink 创建权限。
- catalog、installer、SCM、release、deployment、factory、worker artifact 与 ACL projection 组合：62 passed，1 skipped。
- security/approval/permission/isolation/filesystem/network/credential/Windows 安全域回归：425 passed，1 skipped。
- 覆盖 deterministic derivation、create-new、半成品清理、signature tamper、other-build、pins byte replacement、key rotation、rollback/redefinition 和 catalog-derived verifier。
- Python compileall 与行长检查通过；当前虚拟环境仍未安装 Ruff，未将 lint 记为通过。
- release/catalog key 仍为测试临时 key；本轮没有声称正式 package catalog、OpenDrSai service 或 AppContainer 产品验收通过。

### 下一轮

1. 实现 catalog key lifecycle：signed revocation/activation epoch、old/new overlap 截止和 emergency key kill switch；仅 key ID 删除不足以形成可审计吊销证据。
2. 定义 crash-recoverable installer operation journal：stage/verify/service-register/commit/rollback/uninstall 逐阶段事实，任何中断保持 service disabled/stopped 且不可开启 pipe。
3. 将 catalog builder 接入实际 Windows release runner/package catalog 签名，补 Authenticode/catalog chain 与非管理员 Program Files install/upgrade/repair/rollback E2E。
4. 继续 SQLite FULL/IOERR/CORRUPT、外部审计锚定和 signed AppContainer worker network/credential 联合真机 E2E。

## 第 55 轮

日期：2026-08-16  
总体进展：**72%**（折算分较上轮 +3；`2147 / 3000 = 71.57%`，显示为 72%）  
完全验收：**0 / 30**  
当前阶段：Windows SCM service registration 与安装工件/ACL/build identity 联合门禁

### 本轮完成

- 新增 `WindowsServiceConfigurationEvidence`、只读 protocol 与 `NativeWindowsServiceConfigurationApi`；通过 Advapi32 `OpenSCManagerW`、`OpenServiceW`、`QueryServiceConfigW/2W` 读取 SCM，不创建、修改、启动或停止服务。
- 原生 evidence 包含 service name、`NT SERVICE\\<name>` 派生 SID、binary command、start account、start type、service type、service SID type 和 delayed-auto 状态。
- `windows-security-installation/1` metadata 扩展为绑定 start account/type、SID type、delayed-auto，并将 Runtime service executable 加入第五个必需且不可重复的 artifact role。
- Runtime service executable 完整文件 SHA-256 必须等于 deployment、release pins 与 verifier 同时固定的 `runtime_build_digest`；metadata 不能用另一个合法文件摘要重定义 Runtime build。
- SCM service 必须是独占 `SERVICE_WIN32_OWN_PROCESS`；共享进程、未知 service type、错误 service SID、账户、启动类型、delayed-auto 或非 `SERVICE_SID_TYPE_UNRESTRICTED` 均 fail closed。
- binary command 只允许单个绝对 executable path；拒绝命令参数、相对路径、环境变量展开、异常引号和不存在目标，并要求 resolve 后精确等于 installation inventory 中已通过 digest/owner/DACL 验证的 service executable。
- 即使另一个 installed executable 本身合法且 ACL 安全，SCM 指向 isolated worker 而非 pinned service executable 仍拒绝，避免“同目录任意可信二进制”替换精确 service identity。
- metadata 新增强类型检查，`service_delayed_auto_start=0` 不再利用 Python bool/int 相等语义冒充 `false`；非字符串 identity、不可哈希 artifact role 等 malformed JSON 均进入结构化拒绝。
- 本机真实 SCM 测试成功读取 Windows `EventLog` service 的 service SID、binary path、账户、start type、SID type 和 delayed-auto，证明 native adapter 使用真实 SCM evidence；该证据不冒充 OpenDrSai service 已安装。
- 保留上一轮真实 Win32 ACL E2E：安装根被添加 `Everyone` writer 时，SCM 配置即使正确也不能越过安装 artifact 门禁。
- 未接入 Electron/Gateway/TUI/WebUI/Agent Core，也未创建或启用 OpenDrSai service/host pipe。

### 功能点进展

| 功能点 | 进度 | 累计证据 | 尚缺验收 |
|---|---:|---|---|
| P0-F01 不可变能力配置 | 92% | package metadata pins 已扩展绑定真实 SCM service account/type/SID type/binary 与 Runtime build digest | permission organization policy 签名、全部入口、正式 package catalog/key rotation 和属性测试 |
| P0-F03 进程/资源隔离 | 99% | worker/service executable 均进入安装 ACL/inventory；SCM 必须独占进程并精确指向不可写 pinned build | 正式 signed OpenDrSai service、AppContainer 真机 E2E 与完整逃逸套件 |
| P1-F10 Approval 可观测性 | 99% | host observability 的预期 service SID/binary/start identity 已可由真实 SCM 只读验证且不能降级 | 正式安装 service/key/package、仪表盘/告警路由与运维演练 |
| P2-F04 隔离完全访问 | 95% | isolated worker 与 service host 的安装/SCM identity 已联合绑定，错误宿主不能承载隔离执行 | signed AppContainer worker/service 真机、network/credential canary、Gateway 内部接线与产品 E2E |
| 其余既有功能点 | 不变 | 见前轮 | 继续按三份方案推进 |

折算：上轮累计 2144 分；本轮增加 `1+1+0+1=3` 分；`2147 / (30 × 100) = 71.57%`，显示为 72%。

### 本轮测试

- Windows installation/SCM verifier 专项：21 passed，1 skipped；跳过项仍仅为当前进程无文件 symlink 创建权限。
- SCM、installer、release、deployment、factory、worker artifact 与 ACL projection 组合：58 passed，1 skipped。
- security/approval/permission/isolation/filesystem/network/credential/Windows 安全域回归：421 passed，1 skipped。
- 覆盖 SCM 原生读取、参数/环境变量/相对 binary、错误 executable、service SID/account/start/type/SID type/delayed-auto、Runtime build digest 重定义及 metadata bool/int 类型混淆。
- Python compileall 与行长检查通过；当前虚拟环境仍未安装 Ruff，未将 lint 记为通过。
- 本机不存在正式 OpenDrSai service，因此没有声称 OpenDrSai service install/start/crash/uninstall E2E 通过。

### 下一轮

1. 定义可发布 Windows service artifact 与 installer operation journal；安装/升级/修复/回滚/卸载必须具备阶段化 crash recovery，且 service 未完全验证前保持 disabled/stopped。
2. 增加 service executable/installation metadata 的 Authenticode 或 signed package catalog verifier，并把 metadata digest/release pins 接入非循环的 catalog build identity。
3. 在管理员安装 runner 和非管理员测试账户运行真实 OpenDrSai service + Program Files ACL + pipe allow/deny E2E；正式证据前不启用 Desktop/Gateway fallback。
4. 继续 SQLite FULL/IOERR/CORRUPT、外部审计锚定和 signed AppContainer worker network/credential 联合真机 E2E。

## 第 54 轮

日期：2026-08-16  
总体进展：**71%**（折算分较上轮 +3；`2144 / 3000 = 71.47%`，显示为 71%）  
完全验收：**0 / 30**  
当前阶段：Windows installer artifact、owner/DACL 与 service package identity 门禁

### 本轮完成

- 新增只读 `WindowsSecurityInstallationVerifier`；它不修改 ACL、不授予权限，也不从 Agent、Workspace、Electron、Gateway 或客户端取得 trust input。
- 定义严格 `windows-security-installation/1` metadata，绑定 metadata ID/version、product/channel、稳定 Runtime build identity、service name/SID，以及 deployment manifest、SLO policy、isolated worker manifest/executable 四项无重复 inventory。
- metadata canonical digest、minimum version、产品/渠道/build/service identity 和 installer trusted-writer SID allowlist 均由 verifier 构造时 pin；安装目录里的 metadata 不能自我声明 trust root。
- service SID 明确禁止进入 trusted-writer allowlist；即使 DACL 误给 service SID 写权限，也使用独立错误码拒绝，避免 Runtime service 修改自身 policy/manifest/worker。
- 新增 `NativeWindowsInstallationSecurityApi`，通过 PyWin32 读取真实 Windows owner、DACL/control、ACE、object identity 和 reparse evidence，全程只读。
- install root、installation metadata 及全部 artifact 必须是普通目录/文件；unresolved path 和 resolved object 均拒绝 symlink、junction/reparse，禁止先 resolve 后漏掉链接本体。
- owner 必须属于 Runtime 固化的 installer writer allowlist；null DACL、未知 ACE 类型和任意非 allowlist SID 的 content write、child create/delete、DELETE、WRITE_DAC、WRITE_OWNER、Generic Write/All 均 fail closed。
- 不强制 DACL protected：允许 Program Files 的安全只读继承，但根据最终有效 DACL 判断是否存在非可信 writer，并在结果中保留 protected/inherited evidence。
- artifact 摘要前后验证 device/file identity、size 与 mtime，检测校验期间替换；metadata 在 ACL/identity 检查后重新解析并复核 canonical digest。
- 修正 release pins 摘要层级：新增完整签名 envelope 的 `manifest_file_digest`/`slo_policy_file_digest` 用于 installer file integrity；原 payload digest 继续只用于 policy/deployment semantic identity。
- 安装 inventory 与已经生产 loader 验证的 deployment/release pins、已通过 manifest pin/hash/Authenticode 的 worker identity逐项交叉校验；不同 root、build、service SID 或 artifact digest 均拒绝。
- 本机真实 Win32 ACL E2E 先读取临时安装树实际 owner/DACL并成功验证，再向根目录增加 `Everyone` 可写 ACE；verifier 立即拒绝，测试最终恢复原始 SDDL。
- 增加安装 verifier 使用说明，明确当前尚未查询 SCM service registration，因此不把 package SID 绑定误报为正式 Windows service 已验收。

### 功能点进展

| 功能点 | 进度 | 累计证据 | 尚缺验收 |
|---|---:|---|---|
| P0-F01 不可变能力配置 | 91% | observability/worker 安装 metadata、release/build/service identity 与 owner/writer ACL 已形成外部不可变门禁 | permission organization policy 签名、全部执行入口、跨进程属性测试及正式 package catalog |
| P0-F03 进程/资源隔离 | 98% | 已验证 worker 不仅绑定 manifest/hash/Authenticode，安装文件还要求可信 owner 且普通用户/service 不可写 | signed packaged AppContainer 真机 E2E、SCM service identity 与完整逃逸套件 |
| P1-F10 Approval 可观测性 | 99% | observability deployment/policy 的完整签名文件已进入安装 inventory、owner/DACL 和 service package SID 门禁 | SCM service、正式 key/package、仪表盘/告警路由与运维演练 |
| P2-F04 隔离完全访问 | 94% | isolated worker 安装身份新增 root/metadata/file digest/owner/DACL 防替换证据 | signed AppContainer worker 真机、network/credential 联合 canary、Gateway 内部接线与产品 E2E |
| 其余既有功能点 | 不变 | 见前轮 | 继续按三份方案推进 |

折算：上轮累计 2141 分；本轮增加 `1+1+0+1=3` 分；`2144 / (30 × 100) = 71.47%`，显示为 71%。

### 本轮测试

- Windows installation verifier 专项：9 passed，1 skipped；跳过项仅为当前进程无文件 symlink 创建权限，fake reparse 和真实 ACL 路径仍已覆盖。
- installer、release、deployment、factory、worker artifact 与 ACL projection 组合：46 passed，1 skipped。
- security/approval/permission/isolation/filesystem/network/credential/Windows 安全域回归：409 passed，1 skipped。
- 覆盖 owner、null DACL、reparse、Everyone writer、service writer、unknown ACE、Workspace install root、metadata 篡改、artifact 篡改、build/root/service/worker 交叉绑定和真实 SDDL 恢复。
- Python compileall 通过；当前虚拟环境仍未安装 Ruff，未将 lint 记为通过。
- 本轮没有修改 Agent Core、Gateway、TUI、WebUI 或客户端协议，也没有启用 host pipe/service bootstrap。

### 下一轮

1. 新增 SCM read-only verifier：绑定 service name、binary path、start account、start type 与 `SERVICE_SID_TYPE_UNRESTRICTED`，并拒绝参数/环境变量路径和 user-writable executable。
2. 将 installation metadata digest 与 release pins 接入受签名 package catalog/build metadata 生成流程，避免自签名 trust root和 digest 循环依赖，并补 key rotation overlap/revocation。
3. 在真实 Program Files/非管理员测试账户运行 install/upgrade/repair/rollback/uninstall ACL 矩阵；SCM 与正式 key 门禁通过前继续保持 service bootstrap 关闭。
4. 继续 SQLite FULL/IOERR/CORRUPT fault matrix、外部审计锚定和 signed AppContainer worker 真机 E2E。

## 第 53 轮

日期：2026-08-16  
总体进展：**71%**（折算分较上轮 +1；`2141 / 3000 = 71.37%`，显示为 71%）  
完全验收：**0 / 30**  
当前阶段：Security Observability 确定性离线发布、签名与联合验证工具链

### 本轮完成

- 新增独立 `SecurityObservabilityReleaseTool` 与 `drsai-security-observability-release` console entry point；工具只服务离线发布，不接入 Runtime bootstrap、Electron、Gateway、Workspace 或客户端配置。
- 定义严格 `security-observability-release-input/1`：输入只能提供完整 SLO policy 和 deployment 的发布身份字段，policy ID/digest/key/minimum version 由工具从真实 canonical policy 派生，调用者不能手工填入或覆盖。
- SLO policy 与 deployment 使用不同 Ed25519 key/ID 分别签名；输出同时生成 `runtime-security-observability-release-pins/1`，包含 manifest/policy minimum version、payload digest、product/channel/Runtime build identity、key ID 与 public-key digest，供随后签名的 Runtime build 固化。
- 签名输出采用 canonical UTF-8 JSON 和 create-new 语义；已有工件一律拒绝覆盖。输出目录不能是 symlink，filename/pins 只能是 JSON basename，避免发布路径逃逸和工件混名。
- build 完成前复用生产 `SignedSecurityObservabilityDeploymentLoader` 与 `SignedApprovalSloPolicyLoader` 做联合验证；不维护另一套宽松签名规则。输入无效或联合验证失败时删除本次半成品。
- verify 同时检查 release/SLO public-key digest、deployment signature、product/channel/build/min-version pins、manifest payload digest，以及 policy signature/ID/version/digest/有效期。
- 验证了合法同一 SLO key 重新签署不同 policy 后跨 bundle 替换：签名本身有效，但仍因 deployment/build pin 的 policy digest 不一致而 fail closed。
- 新增正式使用文档，明确 pins 文件不是自签名 trust root，必须进入随后签名的 Runtime build metadata；禁止从 `DRSAI_HOME`、Workspace、Gateway request 或 Electron env 读取 production authority。
- 本轮仍使用测试临时 key，没有生成正式组织签字工件，也没有 installer/service 或在线 transport 接线。

### 功能点进展

| 功能点 | 进度 | 累计证据 | 尚缺验收 |
|---|---:|---|---|
| P1-F10 Approval 可观测性 | 99% | policy/deployment/pins 已有确定性离线生成、双 key 签名、生产 loader 联合 verify、防覆盖与跨包替换拒绝 | 正式 key/HSM 流水线、Windows installer/service、仪表盘/告警路由与正式演练 |
| P0-F09 安全回执与可观测性 | 99% | release 工件 provenance 与 Runtime build pin 输入已可重复生成和验证 | 外部审计锚定、正式安装身份与 SQLite 磁盘损坏演练 |
| P2-F08 管理员与组织策略 | 不变 | 本轮 pins 仅保护 observability release，不等同于 permission organization policy | 继续按 P2 方案实现和验收 |
| 其余既有功能点 | 不变 | 见前轮 | 继续按三份方案推进 |

折算：上轮累计 2140 分；本轮增加 `1+0=1` 分；`2141 / (30 × 100) = 71.37%`，显示为 71%。

### 本轮测试

- release tooling 专项：6 passed。
- release、deployment、factory、signed policy 与 SLO monitor 组合：28 passed。
- security/approval/permission/isolation/filesystem/network/credential/Windows 安全域回归：400 passed。
- 覆盖字节级确定性输出、console PEM build/verify、不可覆盖、半成品回滚、pins 路径/版本降级、payload 篡改、合法签名跨包替换和错误 public key。
- Python compileall 与已跟踪变更范围 `git diff --check` 通过；当前虚拟环境未安装 Ruff，未将 lint 记为通过。
- 尝试全包回归时，15 个既有 Gateway 测试在收集阶段因默认 feedback SQLite 路径 `unable to open database file` 失败；测试体未执行，本轮不将其计入绿色范围，也未修改 Gateway 绕过该环境基线。

### 下一轮

1. 实现 Windows installer artifact verifier：验证 install root 及 manifest/policy/worker 的 owner、DACL、reparse 状态和普通用户不可写性，并绑定 service SID/package metadata。
2. 为 release pins 增加由正式 Runtime build metadata 消费的生成/校验入口和 key rotation overlap/revocation 测试；继续禁止运行时从用户路径加载 pins。
3. 在安装 verifier 与正式内置 key 可用前保持 Windows service bootstrap/host pipe 关闭；随后只接入 service，不接 Electron user process。
4. 继续完成 SQLite FULL/IOERR/CORRUPT fault matrix、外部审计锚定和 signed AppContainer worker 真机 E2E。

## 第 52 轮

日期：2026-08-16  
总体进展：**71%**（折算分较上轮 +1；`2140 / 3000 = 71.33%`，显示为 71%）  
完全验收：**0 / 30**  
当前阶段：签名安装 deployment manifest 与 release/policy/service identity 绑定

### 本轮完成

- 新增 `security-observability-deployment/1` 签名契约与 `SignedSecurityObservabilityDeploymentLoader`；manifest canonical payload 由独立 release Ed25519 key 签名，不复用 Workspace、Approval 或 SLO policy 本身作为部署信任根。
- manifest 精确绑定 manifest ID/version、product、release channel、Runtime build SHA-256、enabled 状态、service SID、pipe instance、SLO policy filename/ID/digest/key ID/minimum version 和有效期。
- loader 构造时 pin expected product/channel/build digest、manifest identity、minimum manifest version 与 release public keys；签名有效但属于其他 channel/build/product 的 manifest 仍 fail closed。
- install root 必须是预配置目录且不位于任一 Workspace；manifest 只能 basename 加载、解析后仍须留在 install root，并有 64 KiB 上限、精确字段集合、严格 bool/int/time/digest/SID/instance 校验。
- disabled manifest 必须同时使用空 service SID 与空 pipe instance；签名 manifest 不能表面关闭却保留 live transport identity。enabled manifest 则必须提供合法 SID 与 128-bit pipe identity。
- 新增 durable `runtime_security_observability_deployments`，保存已接受最高 version/digest；低版本 rollback 和同版本不同内容 redefinition 均拒绝。新版本接受与哈希链 `security_observability.deployment_accepted` 同事务，幂等重载不重复记录。
- 新增 frozen `VerifiedSecurityObservabilityDeployment`；`SecurityObservabilityRuntimeFactory.from_verified_deployment()` 只接受该类型，并将 manifest 中 policy ID/digest/key/min-version、install root、enabled、service SID 与 pipe identity逐项映射为 host config。
- SLO policy loader 新增 `expected_policy_digest`；manifest 与真实签名 policy payload digest 不一致时，在 `approval_slo.policy_accepted` 持久事务之前拒绝，避免错误 policy 被先接受再发现 deployment mismatch。
- factory 要求 manifest 指定的 SLO key ID 同时存在于 Runtime 的 pinned SLO public keys；manifest 不能自行携带新 public key 扩大 trust store。
- 测试覆盖默认关闭完整 build、enabled service SID/pipe 绑定、payload 篡改、错误 build、disabled live identity、持久 rollback、同版本 redefinition、Workspace install root 和 policy digest mismatch 零 policy-acceptance event。
- 仍未把 manifest path 从 Electron env、`DRSAI_HOME`、Workspace 或 Gateway request 接入；正式 installer/service 边界出现前 production bootstrap 保持不启用。

### 功能点进展

| 功能点 | 进度 | 累计证据 | 尚缺验收 |
|---|---:|---|---|
| P1-F10 Approval 可观测性 | 98% | deployment manifest 已签名绑定 release build/channel、service/pipe identity 与完整 SLO policy identity，且持久防回滚 | 正式 installer/service 产物、内置发布 key、仪表盘/路由与正式演练 |
| P0-F09 安全回执与可观测性 | 99% | observability transport/policy deployment 不再依赖用户环境路径，并具备 release-level manifest 原语 | 外部审计锚定、正式安装身份与磁盘损坏演练 |
| P2-F08 管理员与组织策略 | 不变 | deployment manifest 仅绑定可观测性，不等同于 permission organization policy | 继续按 P2 方案实现和验收 |
| 其余既有功能点 | 不变 | 见前轮 | 继续按三份方案推进 |

折算：上轮累计 2139 分；本轮增加 `1+0=1` 分；`2140 / (30 × 100) = 71.33%`，显示为 71%。

### 本轮测试

- deployment、factory 与 signed policy 专项：18 passed。
- deployment、factory、policy 与 SLO monitor 组合：22 passed。
- 扩展 security/approval/permission/isolation/metrics/policy 域回归：691 passed，1 skipped。
- 覆盖 release signature、product/channel/build pins、默认关闭、service SID/pipe identity、policy ID/digest/key/version、持久 rollback/redefinition、Workspace root、篡改和 mismatch 前置拒绝。
- Python compileall 与变更范围 `git diff --check` 通过。
- release/SLO keys 仍为测试临时 key，且没有 installer/service 产物，因此 P1-F10 仍未验收。

### 下一轮

1. 增加 release tooling：离线生成 canonical deployment/SLO payload、签名、联合 verify，并生成 Runtime build minimum-version/digest pin 输入，禁止手工 JSON 漂移。
2. 定义 Windows installer manifest/ACL verifier，验证 install root、manifest/policy/worker 文件 owner/DACL、普通用户不可写、service SID 与打包 metadata 一致。
3. 仅在上述离线 verifier 与正式 key pin 可用后接入 Windows service bootstrap；Electron user process 继续不启用 host pipe。
4. 继续推进 SQLite FULL/IOERR/CORRUPT fault matrix 和 signed AppContainer worker 真机 E2E。

## 第 51 轮

日期：2026-08-16  
总体进展：**71%**（折算分较上轮 +1；`2139 / 3000 = 71.30%`，显示为 71%）  
完全验收：**0 / 30**  
当前阶段：native pipe 故障/资源验收与 Windows host 接线边界审计

### 本轮完成

- 审计 Windows Desktop 启动链：当前宿主是 Electron main process 通过 shared `gateway.ts` 继承环境变量启动 Python Gateway，并非具有独立 service SID、安装 ACL 和 SCM 配置的 Windows Service。
- 明确拒绝在该启动点直接用环境变量接入 observability factory：用户可控制 Electron/Gateway 启动环境，把 manifest path、SID 或 enable flag 放入继承 env 会把安装级 authority 降级为用户配置，扩大而非降低控制面。
- 保持 Gateway、Electron renderer、Agent Core 和客户端零改动；正式接线前置条件改为“先建立安装级 manifest + service identity/ACL 边界”，而不是用现有 `DRSAI_HOME` 或 Workspace 配置冒充。
- 新增 `current_process_handle_count()`，使用 `GetProcessHandleCount` 读取真实 Win32 进程 handle 数，为 native resource leak 验收提供直接证据。
- 新增真实 client disconnect E2E：客户端连接后不发送请求直接关闭，server fail closed、session/pipe handle 清理，错误被归一化且无指标响应。
- 新增 partial request E2E：客户端只发送 `GET /met` 并保持连接，server 读取有界帧后确定返回 `security_metrics_pipe_request_invalid`，不等待额外内容、不调用 exporter。
- 新增真实 read-timeout E2E：允许 SID 的客户端连接但不写数据，server 在 100ms deadline 后关闭；随后使用同一 pipe instance identity 立即重新创建并成功 scrape，证明没有 stale handle/name lock。
- 新增 25 次真实 connect-timeout 压力：每次 `CreateNamedPipeW` 后无人连接，deadline 到期并清理；循环前后 `GetProcessHandleCount` 不增加超过 1 个 handle。
- 保留 `FILE_FLAG_FIRST_PIPE_INSTANCE` 与单并发限制；异常后的重建仍成功，不通过放宽 first-instance 防抢占门禁来解决资源恢复。
- 真实测试区分 TCP/mock 与 Win32 内核证据：所有新增用例都使用当前 Windows kernel pipe handles 和 CreateFile/ReadFile/WriteFile 客户端。

### 功能点进展

| 功能点 | 进度 | 累计证据 | 尚缺验收 |
|---|---:|---|---|
| P1-F10 Approval 可观测性 | 97% | native pipe 已覆盖断连、分片、read/connect timeout、同 identity 重建和 25 次 handle leak 压力 | 安装级 service SID/manifest wiring、签字工件、仪表盘/路由与正式演练 |
| P0-F09 安全回执与可观测性 | 99% | 明确拒绝从 Electron 继承 env/Workspace 配置建立宿主观测 authority | 外部审计锚定、安装级身份与磁盘损坏演练 |
| 其余既有功能点 | 不变 | 见前轮 | 继续按三份方案推进 |

折算：上轮累计 2138 分；本轮增加 `1+0=1` 分；`2139 / (30 × 100) = 71.30%`，显示为 71%。

### 本轮测试

- 真实 Win32 native pipe 场景：6 passed。
- native pipe、contract 与 factory 组合：16 passed。
- 扩展 security/approval/permission/isolation/metrics/policy 域回归：686 passed，1 skipped。
- 覆盖 allow/deny SID、disconnect、partial request、read timeout、同 identity restart、25 次 connect timeout、process handle count、session cleanup 与 exporter 零误调用。
- Python compileall 与变更范围 `git diff --check` 通过。
- 本轮没有为了追求接线进度而把用户可控 Electron env 当作安装 trust root；正式 service/installer 边界仍未完成。

### 下一轮

1. 设计签名 `security-observability-deployment/1` 安装 manifest：绑定 product/channel、Runtime build、service SID、pipe instance derivation、policy digest/key/version 与 enabled=false 默认值。
2. 实现 manifest loader 的 embedded release-key pin、Authenticode/package-root 约束和持久版本防回滚；不从 `DRSAI_HOME`、Workspace 或 Gateway request 读取。
3. 定义 Windows installer/service 产物与离线 verifier；在缺少正式 service 时保持 production bootstrap 不接线，而不是自动降级到 Desktop user SID。
4. 继续推进 SQLite FULL/IOERR/CORRUPT fault matrix 和 signed AppContainer worker 真机 E2E。

## 第 50 轮

日期：2026-08-16  
总体进展：**71%**（折算分较上轮 +2；`2138 / 3000 = 71.27%`，显示为 71%）  
完全验收：**0 / 30**  
当前阶段：Runtime-owned security observability factory 与部署输入收敛

### 本轮完成

- 新增 frozen `HostSecurityObservabilityConfig`，把 trusted policy root/filename、Ed25519 keys、expected policy identity、minimum version、Workspace roots 与可选 pipe deployment identity 收敛为宿主启动事实。
- trusted keys 使用不可变 tuple of `(key_id, raw key)`；重复 key ID、空 key 集、缺失 policy identity/version pin 或非 basename policy filename 在任何数据库副作用前拒绝。
- pipe 默认关闭；关闭时必须同时没有 instance ID 和 service SID，防止配置表面 disabled 却残留可被其他路径启用的 live transport identity。
- pipe enabled 时必须同时提供 128-bit instance identity、单一 host service SID 和安全 timeout；factory 不接受 Workspace bearer、Approval request、Run、Agent 或 client adapter 参数。
- 新增 `SecurityObservabilityRuntimeFactory`，按固定顺序构造 signed policy loader → verified policy → policy-bound SLO monitor → collector → allowlisted exporter → optional authenticated native pipe。
- pipe config 与 native backend identity 在 policy load/acceptance 之前预检；错误 backend version 时 database 文件都不会创建，避免留下“policy accepted 但 Runtime build 失败”的半成品运维事实。
- enabled 且未注入测试 provider 时 factory 只构造真实 `WindowsAuthenticatedNamedPipeApi`；非 Windows 或 native 能力不可用时直接失败，不回退 TCP/HTTP/匿名 pipe。
- 新增 frozen `SecurityObservabilityRuntime` bundle，显式包含 verified policy、monitor、collector、exporter 和 optional transport；客户端不能替换其中任一层后仍声称是 factory 输出。
- `ApprovalSecuritySloMonitor.from_signed_policy()` 从 duck typing 收紧为必须是 `SignedApprovalSloPolicy` 实例且有 digest；伪造 `SimpleNamespace(digest, thresholds)` 不再能绑定为 signed monitor。
- 测试验证默认关闭 build、签名 policy accepted metric、policy digest 绑定、enabled service SID→DACL、Workspace root 拒绝、签名篡改、缺失 key、disabled+SID 冲突、伪 signed object 和错误 backend 零数据库副作用。
- 未修改 RuntimeEngine 公共构造器、Gateway、Agent Core、TUI/WebUI/OAEP 或 Approval wire/decision；factory 仍是宿主内部组装原语。

### 功能点进展

| 功能点 | 进度 | 累计证据 | 尚缺验收 |
|---|---:|---|---|
| P1-F10 Approval 可观测性 | 96% | signed policy、SLO、collector、exporter、native pipe 已由单一默认关闭 host factory 组装，部署错误在持久化前拒绝 | 正式 Windows service wiring/安装 ACL、签字工件、仪表盘/路由与运维演练 |
| P0-F09 安全回执与可观测性 | 99% | observability 组件不再需要各调用方自行拼装或从客户端取得 authority 配置 | 外部审计锚定、正式 service 身份与磁盘损坏演练 |
| 其余既有功能点 | 不变 | 见前轮 | 继续按三份方案推进 |

折算：上轮累计 2136 分；本轮增加 `2+0=2` 分；`2138 / (30 × 100) = 71.27%`，显示为 71%。

### 本轮测试

- factory、signed policy 与 transport 专项：18 passed。
- factory、policy、SLO、contract 与真实 Win32 provider 组合：24 passed。
- 扩展 security/approval/permission/isolation/metrics/policy 域回归：682 passed，1 skipped。
- 覆盖默认关闭、frozen config/runtime、唯一 key pins、签名/版本链、service SID-only DACL、Workspace root、client-shaped partial authority、伪 signed policy、错误 native backend 与零数据库副作用。
- Python compileall 与变更范围 `git diff --check` 通过。
- factory 尚未接入正式 Windows service/installer 启动路径，故 P1-F10 未验收完成。

### 下一轮

1. 找到 Windows service/desktop host 的最小内部启动点，以环境不可变配置或签名安装 manifest 接入 factory；默认安装继续关闭 pipe。
2. 定义 service SID 与 policy/key pin 的安装 manifest，验证该文件不在 Workspace、不可由普通客户端写，并与发布工件版本绑定。
3. 增加 factory build/evaluate/serve 的进程重启、并发启动、部分 policy 升级 crash 和 handle leak 演练。
4. 继续推进 SQLite FULL/IOERR/CORRUPT fault matrix 和 signed AppContainer worker 真机 E2E。

## 第 49 轮

日期：2026-08-16  
总体进展：**71%**（折算分较上轮 +3；`2136 / 3000 = 71.20%`，显示为 71%）  
完全验收：**0 / 30**  
当前阶段：真实 ctypes/Win32 authenticated named-pipe provider 与内核 DACL E2E

### 本轮完成

- 新增 `WindowsAuthenticatedNamedPipeApi` 与 native session，使用 ctypes 直接调用 `CreateNamedPipeW`、`ConnectNamedPipe`、`ReadFile`、`WriteFile`、`DisconnectNamedPipe` 和 `CloseHandle`。
- SDDL 通过 `ConvertStringSecurityDescriptorToSecurityDescriptorW` 转换为 SECURITY_ATTRIBUTES；descriptor 在 pipe 创建后立即 `LocalFree`，pipe handle 在所有异常和正常路径确定性关闭。
- pipe 使用 `PIPE_REJECT_REMOTE_CLIENTS`、byte mode、`PIPE_NOWAIT` 和 `FILE_FLAG_FIRST_PIPE_INSTANCE`；拒绝远程客户端，并阻止较低权限进程预先占用固定 pipe identity。
- connect/read/write 使用 monotonic deadline 和 nonblocking Win32 polling；`ERROR_PIPE_LISTENING`/`ERROR_NO_DATA` 只在 deadline 内重试，超时后关闭 pipe，不留下永久阻塞 accept/read。
- 客户端先被限制读取最多 33 字节固定请求；随后服务端调用 `ImpersonateNamedPipeClient`、`OpenThreadToken(TOKEN_QUERY)`、`GetTokenInformation(TokenUser)` 和 `ConvertSidToStringSidW` 获取真实连接 token SID，最后始终 `RevertToSelf`。
- SID 验证发生在 exporter render/response 之前。Win32 要求 pipe server 至少读取一次客户端消息后才能 impersonate；因此允许读取严格上限的 verb，但未授权 peer 仍无法取得指标或触发 exporter。
- 增加 `current_process_sid()`，通过 `OpenProcessToken` 获取测试/宿主进程真实 SID；token、SID string 和 security descriptor 的 native allocation 均有对应 CloseHandle/LocalFree。
- 本机真实 E2E 使用 Win32 `CreateFileW/WriteFile/ReadFile` 客户端：当前 SID 在 protected DACL 下成功完成 `GET /metrics`；配置错误 SID 时当前进程在 CreateFile 阶段被内核拒绝，server 按 250ms deadline 退出。
- 保持每个 transport 单并发 slot。由于 `FILE_FLAG_FIRST_PIPE_INSTANCE` 用于防 name squatting，本版本明确拒绝 `max_concurrent_scrapes>1`，不虚构尚未实现的安全多实例 pipe pool。
- native provider 仅在 Windows 构造；其他平台直接不可用，没有 TCP/Unix socket/匿名 pipe fallback。
- 未进入 Gateway、Workspace API、Agent Core、TUI/WebUI/OAEP 或 Approval 决策控制面。

### 功能点进展

| 功能点 | 进度 | 累计证据 | 尚缺验收 |
|---|---:|---|---|
| P1-F10 Approval 可观测性 | 94% | host transport 已有真实 Win32 pipe、protected DACL、client token SID、remote reject、deadline 和本机 allow/deny E2E | 正式 Windows service SID/安装 ACL、签字 policy artifact、仪表盘/路由与运维演练 |
| P0-F09 安全回执与可观测性 | 99% | allowlisted metrics 已通过内核 DACL/SID 的 host-only transport，不复用客户端 token | 外部审计锚定、正式安装包身份与磁盘损坏演练 |
| 其余既有功能点 | 不变 | 见前轮 | 继续按三份方案推进 |

折算：上轮累计 2133 分；本轮增加 `3+0=3` 分；`2136 / (30 × 100) = 71.20%`，显示为 71%。

### 本轮测试

- 真实 Win32 named-pipe E2E：2 passed（当前 SID allow + 错误 SID DACL deny）。
- contract、native provider 与 exporter 组合：14 passed。
- 扩展 security/approval/permission/isolation/metrics/policy 域回归：677 passed，1 skipped。
- 覆盖真实 process SID、protected DACL、Win32 client exchange、peer impersonation/token SID、错误 SID CreateFile deny、connect deadline、session cleanup、single-instance squatting 防护和非安全并发配置拒绝。
- Python compileall 与变更范围 `git diff --check` 通过。
- 当前 E2E 使用开发进程 SID，不是正式 Windows service SID 或安装器生成 ACL，因此 P1-F10 仍未验收。

### 下一轮

1. 增加 Runtime factory：只从签名 SLO policy、宿主 service SID 和默认关闭部署配置构造 exporter/monitor/native transport；不允许 Workspace 或 Gateway request 注入。
2. 为 native provider 增加 client disconnect、partial request、read/write timeout、进程终止和 handle-count leak 压力测试。
3. 设计正式 Windows service SID/安装 ACL manifest 与打包验证，确保开发用户 SID 不进入发布工件。
4. 继续推进 SQLite FULL/IOERR/CORRUPT fault matrix 和 signed AppContainer worker 真机 E2E。

## 第 48 轮

日期：2026-08-16  
总体进展：**71%**（折算分较上轮 +2；`2133 / 3000 = 71.10%`，显示为 71%）  
完全验收：**0 / 30**  
当前阶段：默认关闭的 host-only Windows named-pipe metrics transport contract

### 本轮完成

- 新增 `HostLocalSecurityMetricsNamedPipeTransport` 与 frozen `HostMetricsNamedPipeConfig`；默认 `enabled=False`，关闭状态不能取得 pipe name 或处理 scrape。
- enabled transport 必须显式注入 identity 精确为 `windows-authenticated-named-pipe/1` 的 native provider；缺少 provider 或版本不匹配时构造即 fail closed，没有 socket、HTTP、`multiprocessing.connection` 或匿名 pipe fallback。
- pipe name 由固定前缀 `OpenDrSai.SecurityMetrics` 与 128-bit lowercase hex instance identity 派生，调用方不能注入任意路径、Workspace 名或控制字符。
- config 必须提供至少一个合法 SID；transport 生成 protected DACL SDDL，只给精确 allowlisted SID `GR/GW`，不默认加入 Everyone、Users、Administrators 或当前 Workspace 用户。
- native provider contract 必须在 accept 时使用该 SDDL 创建 pipe，并返回从连接 token 验证的 `peer_sid`；transport 再做一次大小写无关精确 SID 对比，未授权 peer 在 metrics render 前拒绝。
- wire protocol 只有精确 `GET /metrics\n`；没有 approve/deny、阈值更新、acknowledge、mode change、Grant 或通用 RPC。任何其他 verb/body 均在 exporter 调用前拒绝。
- 增加 request、response、timeout 和 concurrency 上限；请求多读一字节检测 overflow，response 超限不写，slot 耗尽不进行第二次 native accept。
- 每次 `serve_once()` 无论成功、身份拒绝、协议错误或 I/O 异常均关闭 session 并释放 slot；未知 native 错误被归一化，不向 peer 泄露路径、SID、数据库或异常正文。
- 多线程测试验证首个 scrape 阻塞时第二个请求立即 `security_metrics_pipe_busy`，不会排队占用更多 pipe/session 资源。
- 本轮只实现安全 contract 与 provider boundary，尚未提交真实 ctypes/Win32 provider；因此没有把 mock SID/ACL 测试冒充内核级 named-pipe E2E。
- 未新增 Gateway endpoint、远程绑定、Workspace bearer token、Agent Core 或 TUI/WebUI/OAEP wire 变化。

### 功能点进展

| 功能点 | 进度 | 累计证据 | 尚缺验收 |
|---|---:|---|---|
| P1-F10 Approval 可观测性 | 91% | host transport 已有默认关闭、固定 pipe identity、SID/ACL provider contract、只读协议、大小/并发/超时与错误语义 | 真实 Win32 provider、ACL/peer token E2E、正式阈值签字、仪表盘/路由与演练 |
| P0-F09 安全回执与可观测性 | 99% | exporter transport 不复用 Workspace API/token，身份拒绝发生在读取指标前 | 外部审计锚定、真实 Win32 transport 和磁盘损坏演练 |
| 其余既有功能点 | 不变 | 见前轮 | 继续按三份方案推进 |

折算：上轮累计 2131 分；本轮增加 `2+0=2` 分；`2133 / (30 × 100) = 71.10%`，显示为 71%。

### 本轮测试

- named-pipe transport 与 exporter 专项：12 passed。
- named-pipe、exporter、signed SLO policy、SLO monitor 与 metrics 组合：32 passed。
- 扩展 security/approval/permission/isolation/metrics/policy 域回归：675 passed，1 skipped。
- 覆盖默认关闭、缺失/错误 backend identity、固定 pipe name、protected SID-only SDDL、成功 scrape、peer 拒绝、非法 verb、request overflow、并发 slot、session cleanup、配置注入与无客户端控制方法。
- Python compileall 与变更范围 `git diff --check` 通过。
- 本轮没有真实 Win32 kernel pipe/ACL/token evidence，因此 P1-F10 只做有限增量，未验收完成。

### 下一轮

1. 实现 ctypes Win32 provider：`CreateNamedPipeW`、SDDL→security descriptor、overlapped connect/read/write timeout、client impersonation/token SID、disconnect/close。
2. 在真实 Windows 上验证 SYSTEM/指定 service SID 成功、普通用户/错误 SID 拒绝、DACL 不继承、超时取消和进程退出句柄清理。
3. 增加 native provider artifact identity/version 与 Runtime factory wiring，保持 transport 默认关闭且不进入 Gateway。
4. 继续推进 SQLite FULL/IOERR/CORRUPT fault matrix 和 signed AppContainer worker 真机 E2E。

## 第 47 轮

日期：2026-08-16  
总体进展：**71%**（折算分较上轮 +5；`2131 / 3000 = 71.03%`，显示为 71%）  
完全验收：**0 / 30**  
当前阶段：P1 SLO threshold policy 签名、版本 pin 与防回滚

### 本轮完成

- 新增 `SignedApprovalSloPolicyLoader`，只接受 Ed25519 签名的 canonical JSON envelope；payload 精确绑定 schema、policy identity、version、有效期和全部 SLO thresholds。
- trusted public key 由宿主以 `key_id -> raw Ed25519 public key` 映射 pin；envelope 中未知 key、错误 key、签名篡改或 payload 修改均在 monitor 构造前 fail closed。
- 增加构建/发布侧 `minimum_version` pin；即使攻击者提供签名有效的旧策略，只要低于 Runtime 要求版本仍拒绝加载。
- 新增 durable `runtime_approval_slo_policy_versions`：保存每个 policy identity 已接受的最高 version 与 digest。加载更旧版本被拒绝；同版本不同 digest 被视为 redefinition 并拒绝，不能通过重新签名静默放宽阈值。
- 新版本接受与 `approval_slo.policy_accepted` 哈希链事件在同一 SQLite 事务；相同 version+digest 重载幂等，不重复写接受事件。
- policy file 只能以 `.json` basename 从预配置 trusted root 加载；绝对路径、父目录逃逸和 trusted root 位于任一 Workspace 内均被拒绝。符号链接解析后的路径也必须留在 trusted root。
- 增加 64 KiB 文件上限、精确 envelope/payload/threshold 字段集合、整数与 bool 类型隔离、有限浮点和当前有效期检查；签名有效但包含 `true` 冒充整数、fractional count、NaN 或超大内容仍被拒绝。
- 新增 `ApprovalSecuritySloMonitor.from_signed_policy()`；verified policy digest 绑定 monitor，并写入每个 raise/clear 审计 payload，证明告警使用的策略版本；digest 不进入 Prometheus 标签。
- 新增无标签 `security_approval_slo_policy_accepted_total` 并加入 host-local exporter allowlist，保留低基数。
- 未启用 host transport，未新增 Gateway endpoint、客户端阈值设置、Agent Core 或 TUI/WebUI/OAEP 协议变化。

### 功能点进展

| 功能点 | 进度 | 累计证据 | 尚缺验收 |
|---|---:|---|---|
| P1-F10 Approval 可观测性 | 89% | SLO 阈值已有 Ed25519 key pin、policy/version identity、有效期、持久防回滚、同版本不可重定义和告警 digest 绑定 | 正式阈值签字/发布工件、宿主 transport、仪表盘、告警路由与演练 |
| P0-F09 安全回执与可观测性 | 99% | SLO 告警证据绑定不可静默降级的签名 policy digest | 外部审计锚定、正式宿主传输与磁盘损坏演练 |
| P2-F08 管理员与组织策略 | 不变 | 本轮仅为 SLO 运维策略原语，不将其误计为 permission organization policy | 继续按 P2 方案实现和验收 |
| 其余既有功能点 | 不变 | 见前轮 | 继续按三份方案推进 |

折算：上轮累计 2126 分；本轮增加 `5+0=5` 分；`2131 / (30 × 100) = 71.03%`，显示为 71%。

### 本轮测试

- signed policy 与 SLO monitor 专项：12 passed。
- signed policy、monitor 与 exporter 组合：19 passed。
- 扩展 security/approval/permission/isolation/metrics/policy 域回归：670 passed，1 skipped。
- 覆盖有效签名、幂等重载、policy digest 告警绑定、错误/未知 key、payload 篡改、过期、路径逃逸、Workspace root、minimum pin、持久 rollback、同版本 redefinition、bool/fraction/NaN 类型混淆和 64 KiB 上限。
- Python compileall 与变更范围 `git diff --check` 通过。
- 本轮签名 key 与 policy 仅由测试临时生成，尚未形成正式组织签字/发布工件，因此 P1-F10 仍未验收。

### 下一轮

1. 定义并实现默认关闭的 Windows named-pipe host transport：固定 pipe identity、ACL、peer SID 校验、只读单请求 scrape、大小/并发/超时限制。
2. 增加正式 SLO policy manifest 生成/签名 CLI 与 release verification，确保 policy artifact 和 Runtime minimum pin 在发布流程中联合验证。
3. 增加并发 policy load/evaluate、版本升级 crash、SQLite busy 和 alert state 重启恢复测试。
4. 继续推进 SQLite FULL/IOERR/CORRUPT fault matrix 和 signed AppContainer worker 真机 E2E。

## 第 46 轮

日期：2026-08-16  
总体进展：**71%**（折算分较上轮 +8；`2126 / 3000 = 70.87%`，显示为 71%）  
完全验收：**0 / 30**  
当前阶段：Runtime-owned P1 SLO evaluator 与原子去重告警

### 本轮完成

- 新增 `ApprovalSecuritySloMonitor` 与 frozen `ApprovalSecuritySloThresholds`；阈值只能由宿主构造，包括滚动 window、decision/effect 最小样本、timeout/expired Grant/unknown basis-points 上限和 adapter failure 次数。
- Approval timeout rate 仅统计窗口内 `approval.decided`，以全部 decision 为分母；Effect unknown rate 仅统计窗口内 `effect.terminal`，以全部 terminal Effect 为分母。
- timeout 与 unknown 两个比例必须先满足独立 minimum sample floor，避免单个失败把低流量环境误报为 100% SLO 事故；测试验证观察值仍为 10000 bp，但不会 raise。
- expired Grant rate 直接查询 `runtime_authorization_grants` 当前权威状态，只把未消费、未撤销且已过期的 Grant 计入分子；adapter failures 只读取共享 reviewer adapter 的哈希链失败事件。
- 四类固定告警为 `approval_timeout_rate`、`expired_grant_rate`、`outcome_unknown_rate`、`adapter_failures`；客户端不能新增类别、修改阈值、acknowledge 或 clear。
- durable SLO alert state 与 `approval_slo.alert_raised/cleared` 安全事件在同一 SQLite 事务；同状态重复 evaluate 零事件，越过阈值 raise，窗口恢复/Grant 撤销后 clear。
- evaluator 在读取事件前强制验证整个 `SecurityEventJournal` 哈希链；完整性失败直接拒绝评估且 alert state 零修改，不能让篡改日志伪造 SLO 恢复。
- security journal append 失败时 alert state 整体回滚；下次评估重新发出真实告警，不会因错误去重丢失事故。
- `SecurityMetricsCollector` 与 host-local exporter 新增 `security_approval_slo_alert_total`，标签只允许四种 alert 与 raised/cleared，不包含请求、Grant、Effect 或 adapter identity。
- 未增加 Gateway endpoint、客户端阈值设置、Agent Core 逻辑或 TUI/WebUI/OAEP wire 变化。

### 功能点进展

| 功能点 | 进度 | 累计证据 | 尚缺验收 |
|---|---:|---|---|
| P1-F10 Approval 可观测性 | 84% | 已有滚动窗口、最小样本、四类签名固定 SLO、原子去重 raise/clear、哈希链验证与 exporter 投影 | 正式阈值签字、宿主 transport、仪表盘、告警路由和运维演练 |
| P0-F09 安全回执与可观测性 | 99% | unknown SLO 告警基于已验证哈希链且不能由客户端清除 | 外部审计锚定、正式宿主传输与磁盘损坏演练 |
| P1-F06 Exactly-once Grant/副作用 | 99% | expired-unused 与 outcome_unknown 已进入宿主 SLO，仍不改变 Grant/Effect authority | 外部系统补偿、正式运维演练与跨主机灾备 |
| 其余既有功能点 | 不变 | 见前轮 | 继续按三份方案推进 |

折算：上轮累计 2118 分；本轮增加 `8+0+0=8` 分；`2126 / (30 × 100) = 70.87%`，显示为 71%。

### 本轮测试

- P1 SLO、exporter 与 metrics 专项：19 passed。
- P1 SLO、reviewer adapter、exporter、metrics 与 isolated recovery 组合：60 passed。
- 扩展 security/approval/permission/isolation/metrics 域回归：662 passed，1 skipped。
- 覆盖四告警同时 raise、重复 evaluate 去重、时间窗退出、全部未消费 Grant 撤销、四告警 clear、低样本不报警、frozen thresholds、哈希链 verify、audit append rollback 和 exporter secret-free 投影。
- Python compileall 与变更范围 `git diff --check` 通过。
- 本轮阈值尚未经过产品/安全负责人正式签字，也没有 Pager/仪表盘或宿主演练，因此 P1-F10 仍未验收。

### 下一轮

1. 实现默认关闭的 host transport contract，优先 Windows named pipe，要求 ACL/peer identity、只读 scrape、无 Workspace bearer token 和无远程绑定。
2. 增加 P1 SLO threshold policy 的签名/版本 pin 与启动时 fail-closed 校验，禁止部署时静默放宽阈值。
3. 增加滚动窗口边界、并发 evaluator、数据库 busy 和 process crash 后 alert state 恢复测试。
4. 继续推进 SQLite FULL/IOERR/CORRUPT fault matrix 和 signed AppContainer worker 真机 E2E。

## 第 45 轮

日期：2026-08-16  
总体进展：**71%**（折算分较上轮 +6；`2118 / 3000 = 70.60%`，显示为 71%）  
完全验收：**0 / 30**  
当前阶段：host-local security metrics pull exporter 与输出边界

### 本轮完成

- 新增 `HostLocalSecurityMetricsExporter`，把 `SecurityMetricsCollector` 的低基数快照渲染为确定性的 Prometheus text；类只提供 `render()`，不包含 HTTP server、socket、listen/bind/start 或 Gateway route。
- 建立显式 metric-name allowlist，覆盖 P0/P1/P2 已有 security counters、gauges、basis-point ratios 和 recovery alerts；任何未知指标名都会使整个 scrape fail closed，不输出部分结果。
- 为每个指标建立精确 label-key 与 label-value allowlist；不仅禁止额外的 Run/Workspace/execution 标签，也拒绝把 secret canary 塞进合法标签值，避免“键合法、值高基数”的绕过。
- 增加全 scrape series 上限、单 metric series 上限和 duplicate series 检测；高基数或重复 time series 不会被静默截断或生成有歧义的 Prometheus 文本。
- 指标值只允许非负有限 number；NaN、Infinity、负数、bool 和非数值均 fail closed，防止污染宿主监控计算与 SLO。
- snapshot/SQLite 不可用时统一返回 `security_metrics_unavailable`，不泄露数据库路径或原始异常，也不输出已渲染的前半段内容。
- exporter 完全无状态且 scrape 只读；32 次八线程并发 pull 输出逐字节一致，security journal event count 不变。
- secret canary 测试覆盖 event payload、subject identity 和 receipt digest，最终 Prometheus text 中均不可见。
- 宿主可在未来通过进程内调用、命名管道或 loopback sidecar 暴露该 renderer；本轮没有替宿主选择或开启传输，因此没有新增网络攻击面。
- 未修改 Agent Core、TUI/WebUI/OAEP wire contract、Gateway endpoint 或 Approval 决策行为。

### 功能点进展

| 功能点 | 进度 | 累计证据 | 尚缺验收 |
|---|---:|---|---|
| P0-F09 安全回执与可观测性 | 99% | 安全指标已有 host-local allowlisted pull renderer、秘密/注入/并发门禁 | 外部审计锚定、正式宿主传输、告警 SLO 与磁盘损坏演练 |
| P1-F10 Approval 可观测性 | 76% | Approval/Grant/unknown/adapter 指标可由宿主安全 pull，具备固定标签、基数和不可用语义 | 签字 SLO、去重告警规则、宿主 transport、仪表盘与运维演练 |
| P2-F05 有效权限预览与可解释 UI | 不变 | exporter 不进入客户端 UI，避免把运维可见性误当产品权限预览 | 继续按 P2 方案验收 |
| 其余既有功能点 | 不变 | 见前轮 | 继续按三份方案推进 |

折算：上轮累计 2112 分；本轮增加 `0+6=6` 分；`2118 / (30 × 100) = 70.60%`，显示为 71%。

### 本轮测试

- exporter 与 security metrics 专项：15 passed。
- exporter、P1 metrics/reviewer、isolated recovery 组合：56 passed。
- 扩展 security/approval/permission/isolation/metrics 域回归：658 passed，1 skipped。
- 覆盖确定性 Prometheus text、secret canary、未知指标、额外标签、恶意标签值、NaN、duplicate series、cardinality limit、数据库不可用、32 次并发只读 scrape。
- Python compileall 与变更范围 `git diff --check` 通过。
- 本轮没有开启 exporter transport，也没有签字 SLO 或告警演练，因此 P1-F10 仍未验收。

### 下一轮

1. 实现 Runtime-owned P1 SLO evaluator，覆盖 Approval timeout、Grant expired-unused、unknown ratio 和 adapter failure，并复用原子 raise/clear 去重事件。
2. 定义宿主 transport contract：Windows named pipe/Unix socket 或显式 loopback sidecar，要求 peer identity、只读、无 Workspace token 复用和默认关闭。
3. 为 exporter 做全量实际 collector corpus contract test，确保新增 security metric 必须同时更新 allowlist，否则 CI fail closed。
4. 继续推进 SQLite FULL/IOERR/CORRUPT fault matrix 和 signed AppContainer worker 真机 E2E。

## 第 44 轮

日期：2026-08-16  
总体进展：**70%**（折算分较上轮 +8；`2112 / 3000 = 70.40%`，显示为 70%）  
完全验收：**0 / 30**  
当前阶段：P1 Approval/Grant/Effect/adapter 运维指标闭环

### 本轮完成

- `SecurityMetricsCollector` 直接从 `runtime_authorization_grants` 权威表投影 Grant state gauge：`active`、`expired_unconsumed`、`consumed`、`revoked`；客户端事件或 Approval Decision 不能伪造消费状态。
- 新增 `security_authorization_grant_unused_ratio_basis_points`，以整数 basis points 表示全部已签发 Grant 中尚未消费的比例，避免浮点展示差异并保留低基数；过期和 revoked 仍明确计为 unused。
- 新增 `security_effect_outcome_unknown_ratio_basis_points`，只根据哈希链中的 `effect.terminal` 计算；没有 unknown 时不制造零值序列，有 unknown 时可直接用于 SLO/告警阈值。
- 新增显式 `security_approval_timeout_total`，由 `approval.decided` 的 `expired` 权威事实派生，并只保留 allowlisted reviewer kind。
- 共享 `ApprovalProtocolAdapter.submit()` 在协议或决策失败时追加 `approval.adapter_failed` 安全事件；原始 `ApprovalServiceError` 原样重新抛出，Approval 继续 pending，且不会创建 Decision 或 Grant。
- adapter failure 分类收敛到 `protocol`、`invalid_decision`、`expired`、`conflict`、`internal`，adapter 标签仅允许 `codex`、`tui`、`oaep`；request ID、reviewer ID、reason/error 正文均不会进入指标标签。
- adapter failure 审计采用 best-effort：指标数据库故障不能遮蔽原始 reviewer 异常，也不能被当作批准、拒绝或执行 authority。
- `SecurityMetric.value` 支持整数或浮点投影，但本轮比例采用整数 basis points；现有 Runtime snapshot/Gateway 只读序列化契约保持兼容。
- 未增加新的 Gateway endpoint，未修改 Agent Core、TUI/WebUI/OAEP wire contract 或 Approval 决策语义。

### 功能点进展

| 功能点 | 进度 | 累计证据 | 尚缺验收 |
|---|---:|---|---|
| P0-F09 安全回执与可观测性 | 99% | effect outcome_unknown 已有权威比例，且不暴露 execution identity | 外部审计锚定、正式 exporter/告警 SLO 与真实磁盘损坏演练 |
| P1-F10 Approval 可观测性 | 70% | 请求率、pending age、decision latency、timeout、duplicate/conflict、Grant state/unused、unknown ratio、adapter failure 已有低基数投影 | 正式 exporter、签字 SLO/阈值、去重告警、仪表盘与运维演练 |
| P1-F06 Exactly-once Grant/副作用 | 99% | 运维侧可区分 active/expired/consumed/revoked Grant，并关联 unknown 总体比例 | 外部系统补偿、正式运维演练与跨主机灾备 |
| 其余既有功能点 | 不变 | 见前轮 | 继续按三份方案推进 |

折算：上轮累计 2104 分；本轮增加 `0+8+0=8` 分；`2112 / (30 × 100) = 70.40%`，显示为 70%。

### 本轮测试

- P1 metrics 与 reviewer adapter 专项：25 passed。
- Approval、Grant、Effect、security metrics 与 isolated recovery 组合：90 passed。
- 排除已知无关基线后的扩展安全域回归：650 passed，1 skipped。
- 覆盖四种 Grant durable state、unused 7500 basis points、unknown 5000 basis points、显式 timeout、adapter protocol failure、Approval 保持 pending、零 Grant 生成和标签脱敏。
- Python compileall 与变更范围 `git diff --check` 通过。
- 本轮尚未提供正式 exporter、签字 SLO 或告警演练，因此 P1-F10 保持未验收。

### 下一轮

1. 实现 host-local pull exporter，将 security metrics 渲染为固定 allowlist 的 Prometheus text；只绑定 loopback/命名管道或由宿主进程直接调用，不增加 Workspace API。
2. 为 timeout、Grant unused、unknown ratio 和 adapter failure 配置 Runtime-owned SLO evaluator，复用第 43 轮的原子去重告警模式。
3. 增加 exporter 标签注入、秘密 canary、高基数攻击、并发 scrape 与数据库不可用测试。
4. 继续推进 SQLite FULL/IOERR/CORRUPT fault matrix 和 signed AppContainer worker 真机 E2E。

## 第 43 轮

日期：2026-08-16  
总体进展：**70%**（折算分较上轮 +2；`2104 / 3000 = 70.13%`，显示为 70%）  
完全验收：**0 / 30**  
当前阶段：isolated recovery 内部阈值、去重告警与低基数指标投影

### 本轮完成

- 新增 Runtime-owned `IsolatedEffectRecoveryMonitor`；直接读取 durable recovery metrics，不接受 Agent、Approval Decision、工具调用或客户端请求作为告警处置输入。
- 新增 frozen `IsolatedEffectRecoveryThresholds`，覆盖 nonterminal backlog、累计 recovery failures 和 oldest pending age；阈值在 Runtime 构造时固定，评估接口没有更新、关闭或 acknowledge 控制面。
- 新增 durable alert state 表，按 `backlog`、`recovery_failures`、`stale_attempt` 三种低基数类别保存 active、observed、threshold、changed/evaluated time；不保存 Workspace、Run、execution、路径或秘密作为告警标签。
- 告警只在 inactive→active 时写 `isolated_recovery.alert_raised`，active→inactive 时写 `isolated_recovery.alert_cleared`；相同状态的周期采样不会重复发事件，避免 startup/reconcile 循环制造告警风暴。
- alert state transition 与 `SecurityEventJournal` 哈希链事件在同一 SQLite 事务；审计 append 失败会整体回滚 alert state，下一次评估仍会重新发出真正告警，不会因错误去重而丢失事件。
- `SecurityMetricsCollector` 新增 `security_isolated_recovery_alert_total`，只允许 `alert={backlog,recovery_failures,stale_attempt}` 和 `state={raised,cleared}` 两个标签；execution ID、owner token、错误正文等均不会进入指标维度。
- 测试覆盖 backlog/stale 同时触发、重复采样零事件、Effect 收敛后双 clear、哈希链 verify、指标投影、frozen threshold 和审计失败事务回滚。
- 未增加 Gateway endpoint，未修改 Agent Core、TUI/WebUI/OAEP 或 Approval 协议；客户端不能修改阈值、清除告警、续租或 claim recovery authority。

### 功能点进展

| 功能点 | 进度 | 累计证据 | 尚缺验收 |
|---|---:|---|---|
| P0-F09 安全回执与可观测性 | 99% | recovery metrics 已有 Runtime-owned 阈值、去重状态转换、哈希链告警和低基数投影 | 外部审计锚定、正式 exporter/告警 SLO 与真实磁盘损坏演练 |
| P1-F10 Approval 可观测性 | 62% | 既有 Approval 指标之外，outcome/recovery backlog 已有内部告警原语与去重审计模式 | Grant 未使用率、adapter 故障、Approval SLO 配置、正式 exporter 与仪表盘 |
| P2-F04 隔离完全访问 | 93% | isolated execution 的恢复积压、失败和陈旧 attempt 可被内部检测且不能由客户端静默清除 | signed packaged worker 真机、Gateway 接线、network/credential 联合 canary |
| 其余既有功能点 | 不变 | 见前轮 | 继续按三份方案推进 |

折算：上轮累计 2102 分；本轮增加 `0+2+0=2` 分；`2104 / (30 × 100) = 70.13%`，显示为 70%。

### 本轮测试

- isolated Effect/monitor 专项：24 passed。
- isolated Effect、安全审计、低基数指标、Windows Session 与 filesystem 组合：106 passed。
- 排除已知无关基线后的扩展安全域回归：649 passed，1 skipped。
- 覆盖 alert raise/clear、重复采样去重、多条件并发 active、状态恢复、哈希链完整性、标签基数、阈值不可变与 journal append 故障整体回滚。
- Python compileall 与变更范围 `git diff --check` 通过。
- 本轮没有新增正式 exporter、Pager/告警系统或 Approval 专属 SLO，因此未将 P0-F09 或 P1-F10 标为完成。

### 下一轮

1. 补齐 P1-F10 的 Grant 未使用/过期、adapter failure、outcome_unknown rate 和 Approval timeout 指标，并复用相同低基数/去重告警原语。
2. 在 Runtime 内部提供 pull-based exporter adapter；默认不增加公网或 Workspace API endpoint，只允许宿主运维进程读取。
3. 增加 SQLite `FULL`、`IOERR`、`CORRUPT` fault adapter，覆盖 metrics read、alert state commit 和 security journal commit 的 fail-closed 行为。
4. 继续推进 signed worker release runner 与真实 AppContainer E2E；门禁通过前 Gateway completely-full 保持关闭。

## 第 42 轮

日期：2026-08-16  
总体进展：**70%**（折算分较上轮 +1；`2102 / 3000 = 70.07%`，显示为 70%）  
完全验收：**0 / 30**  
当前阶段：真实多进程 recovery 竞争、进程终止接管与内部健康指标

### 本轮完成

- 新增 Windows `spawn` 模式的真实独立进程测试；两个 Python Runtime 进程使用各自的 SQLite connection、service instance 和 recovery owner，同时竞争同一个 durable isolated attempt。
- 双进程竞争结果只允许一个 reconciler 报告 terminal failed；数据库中的 Effect 只终结一次，另一个进程只能观察到 terminal/no-op 或 pending，worker 与 filesystem 副作用均未重放。
- 新增 owner 进程强制终止测试：子进程成功 claim 并持有 recovery lease 后由父进程 `terminate()`，没有执行正常释放或析构路径，模拟 Runtime crash/kill。
- successor Runtime 在旧租约有效时只能返回 pending；等待数据库记录的精确 expiry 后可以 claim 新 fencing token，并把 Effect 确定收敛为 failed。被终止进程不能留下永久恢复锁。
- 新增只读 `IsolatedEffectRecoveryMetrics`，提供 nonterminal attempts、active leases、deferred attempts、累计 recovery failures 和 oldest pending age；接口只返回聚合健康数据，不提供 claim、续租、批准或 capability 修改能力。
- metrics 直接读取 durable attempt 表：terminal journal 故障后能观察到 deferred/failure，安全重试终结后 nonterminal 归零；不会把诊断能力暴露给 Agent Core、TUI、WebUI 或 OAEP。
- `database_timeout_seconds` 仍只影响 SQLite 等待上限，不改变默认 30 秒、authority 规则、lease duration 或客户端行为。
- 未修改 Agent Core、工具 schema 或任何客户端协议；Gateway completely-full 继续 fail closed。

### 功能点进展

| 功能点 | 进度 | 累计证据 | 尚缺验收 |
|---|---:|---|---|
| P0-F09 安全回执与可观测性 | 99% | durable deferred event 之外已有内部聚合 recovery metrics，且进程终止后可观测 active/pending/归零 | 外部审计锚定、指标 exporter、告警 SLO 与真实磁盘损坏演练 |
| P1-F06 Exactly-once Grant/副作用 | 99% | 真正 spawned 进程竞争只终结一次；强制 kill 后到期接管不重放副作用 | 外部系统补偿、正式运维演练与跨主机灾备 |
| P2-F04 隔离完全访问 | 93% | isolated executor 的 recovery authority 已通过独立进程竞争和进程终止接管 | signed packaged worker 真机、Gateway 接线、network/credential 联合 canary |
| P2-F06 安全模式切换 | 99% | in-flight isolated Effect 已覆盖真实多进程 startup 竞争和 owner kill | 后台/计划任务/子 Agent 与产品断电 E2E |
| 其余既有功能点 | 不变 | 见前轮 | 继续按三份方案推进 |

折算：上轮累计 2101 分；本轮增加 `0+0+1+0=1` 分；`2102 / (30 × 100) = 70.07%`，显示为 70%。

### 本轮测试

- isolated Effect 恢复专项：22 passed。
- isolated Effect、Windows Session 与 filesystem 组合专项：69 passed。
- 排除已知无关基线后的扩展安全域回归：647 passed，1 skipped。
- 覆盖 Windows spawn 双进程竞争、独立 SQLite connections、owner 强制终止、有效租约等待、精确到期接管、Effect 单次终结、metrics deferred/active/归零与零副作用重放。
- Python compileall 与变更范围 `git diff --check` 通过。
- 本轮证据仍是单主机共享 SQLite，不等同于跨主机共识、真实断电或 AppContainer 产品 E2E。

### 下一轮

1. 为 `IsolatedEffectRecoveryMetrics` 增加 Runtime 内部 exporter/threshold evaluator 和去重告警事件，保持客户端只读或完全不可见。
2. 使用 SQLite fault adapter 覆盖 connect、BEGIN、terminal commit、diagnostic commit 各阶段的 `FULL`、`IOERR`、`CORRUPT` 与 `BUSY`，验证可信事实和恢复可用性。
3. 审计并实现跨主机部署时的单写者约束；若数据库不能提供分布式 fencing，则明确拒绝多主机共享 authority，而不是假装本地 lease 足够。
4. 继续推进 signed worker release runner 与真实 AppContainer E2E；门禁通过前 Gateway completely-full 保持关闭。
