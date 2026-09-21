# OpenDrSai 智能体安全 P1：降低 Approval 控制面方案

> 状态：Proposal  
> 优先级：P1（依赖 P0 的 Capability/Grant 基础）  
> 基线调研：[agent-security-controls-research-2026.md](./agent-security-controls-research-2026.md)  
> 前置方案：[P0 真正安全边界](./opendrsai-agent-security-p0-capability-boundary-plan.md)

## 1. 总体目标

把当前同时承担授权、Run 生命周期、副作用状态、交互、事件和封存职责的 Approval 拆成小而明确的控制面。Approval 仅回答“谁对哪一个不可变 Proposal 作出了什么决定”；是否允许执行由 Policy + Capability Grant 决定，实际副作用由隔离执行器负责，Run 是否继续由协调器负责。

目标指标：

1. Approval 拒绝默认返回结构化工具结果，不再取消整个 Run。
2. 同一 Run 可存在多个独立 pending Proposal；互不覆盖、互不串权。
3. 决定、Grant、执行和恢复均幂等，崩溃后最多产生一次副作用。
4. Runtime、Codex Bridge、Magentic-One、Android/OAEP 使用同一协议和状态模型。
5. Approval UI/传输故障不会扩大权限；控制面不可用时 Proposal 保持未授权。

## 2. 解决方案

### 2.1 拆分领域对象

| 对象 | 含义 | 是否可变 |
|---|---|---|
| `ActionProposal` | 工具、规范参数摘要、展示内容、风险和所需能力 | 创建后不可变 |
| `ApprovalRequest` | 需要哪个 reviewer、原因、到期、展示 schema | 仅状态迁移 |
| `ApprovalDecision` | reviewer 对 Proposal 的 approve/deny/cancel 事实 | 追加式不可变 |
| `AuthorizationGrant` | Policy 综合 Decision 后签发的精确执行凭证 | 不可变、可原子消费 |
| `EffectExecution` | 一次副作用 claim、运行、回执和恢复状态 | 受状态机约束 |

Approval Decision 不直接等于 Grant：硬禁止、能力上限、过期或模式变化均可让“已批准”仍不能执行。

### 2.2 服务边界

- `ProposalService`：生成规范 Proposal 和显示数据。
- `PolicyDecisionService`：判断无需 Approval、需要何种 reviewer 或硬拒绝。
- `ApprovalService`：创建请求、接受 reviewer 决定、超时和撤销；不修改 Run。
- `GrantService`：综合策略与决定签发/消费 Grant。
- `EffectExecutor`：持 Grant 在 P0 隔离后端中执行并写回执。
- `RunCoordinator`：根据可运行工作、pending interaction 和终止请求推导 Run 状态。
- `ApprovalAdapter`：Codex、TUI、Android/OAEP 只负责协议转换和展示。

### 2.3 状态原则

- 工具调用进入 `proposed -> policy_checked -> awaiting_decision -> authorized -> claimed -> executing -> succeeded|failed`，拒绝进入 `denied`。
- Run 仅在“当前没有可运行步骤且至少一个请求等待用户”时投影为 `waiting_approval`；该字段不再是 Approval 数据真相。
- `deny` 是工具级业务结果；`cancel_run`、`stop_agent` 是独立命令。
- reviewer 断开、超时或重启均保持未授权；客户端重试使用 idempotency key。

## 3. 模块变更清单

### 3.1 新增模块与存储

建议新增 `backend/runtime/authorization/`：

- `proposal_service.py`
- `policy_decision_service.py`
- `approval_service.py`
- `grant_service.py`
- `effect_executor.py`
- `state_machines.py`
- `adapters/{codex,tui,oaep}.py`

新增或迁移表：

- `runtime_action_proposals`
- `runtime_approval_requests`
- `runtime_approval_decisions`
- `runtime_authorization_grants`
- `runtime_effect_executions`

所有表使用稳定 ID、版本、idempotency key、创建/决定/过期时间和外键；执行 claim 与 Grant 消费必须在同一事务中。

### 3.2 更新模块

- `backend/runtime/engine.py`：把 `request_approval`、`resolve_approval` 和 `claim_side_effect` 拆为服务调用；Run 状态由 Coordinator 投影。
- `backend/runtime/security.py`：删除 Approval Registry 作为第二事实源；安全策略只提供 Policy/Grant 能力。
- `backend/codex_adapter/security.py`：`CodexApprovalBridge` 变成 adapter，沿用 fail-closed 传输，但不维护独立授权语义。
- `backend/codex_adapter/backend_client.py`：保留拒绝 Agent 自定义 bypass 策略；改为提交标准 Proposal。
- `agent_kernel.py`：每次工具调用走统一 proposal/policy/grant/execution 管线。
- Gateway、OAEP、Android：列表、详情、决策和订阅都以 ApprovalRequest/Decision 为标准资源。
- event journal、checkpoint、manifest：监听领域事件，不由 `resolve_approval()` 直接串行编排全部写入。

### 3.3 移除与兼容

- 删除 `resume_on_denied` 特例；拒绝是否继续由工具结果和 Agent 策略决定。
- Magentic-One `ActionGuard` 改为兼容 adapter，迁移完成后删除其独立 always/maybe/never 状态机和模型回调事实源。
- 删除 `_approved_effects` 等内存授权权威；缓存只能加速，数据库 Grant 才是事实源。
- 旧 `runtime_approvals`/`runtime_side_effects` 保留只读兼容视图一个发布周期，禁止双写作为长期方案。
- 旧 TUI callback 不能直接放行执行，只能提交 Decision。

## 4. 功能点、测试与验收

### P1-F01 标准 ActionProposal

功能：所有副作用工具生成相同 schema 的不可变 Proposal，包含 P0 原始摘要、脱敏显示、风险、能力和来源。

测试：schema/序列化契约测试；Runtime、Codex、MCP、legacy adapter 的 golden cases；修改 Proposal 后签名/摘要失效。

验收：发布路径不存在跳过 Proposal 直接进入副作用执行的工具；同一操作在各客户端显示语义一致。

### P1-F02 Policy 与 Approval 分离

功能：Policy 输出 `allow_without_review | require_reviewer | hard_deny` 及原因；Approval 仅记录 reviewer 决定；Grant 再次检查有效策略。

测试：决策矩阵覆盖风险、模式、工作区信任和管理员规则；在等待期间收紧策略后，即使 approve 也不得签发 Grant。

验收：能从审计中分别回答“策略要求什么”“reviewer 决定什么”“最终为何执行/拒绝”。

### P1-F03 独立 Approval 状态机

功能：Request 支持 pending、approved、denied、expired、cancelled；终态不可反转，重复同值决定幂等，冲突决定返回明确错误。

测试：状态迁移表、属性测试、并发 approve/deny、重复请求、时钟边界和客户端重试。

验收：任何竞争只能产生一个有效终态和至多一个 Grant；数据库约束而非仅应用锁保证。

### P1-F04 多 pending 与 operation-level blocking

功能：同一 Run 可并行等待多个 Proposal；仅依赖被阻塞工具结果的分支暂停，其他安全工作可继续。

测试：同 Run 两到十个请求的乱序决策、独立过期、部分拒绝和恢复；Run 状态投影一致性测试。

验收：批准 A 不会批准 B；拒绝一个请求不取消 Run；只有无可运行工作时 UI 才显示等待批准。

### P1-F05 拒绝、取消与终止解耦

功能：deny 返回带 reason code 的工具结果；cancel request 只撤销该请求；cancel run 独立鉴权并终止任务。

测试：Agent 收到拒绝后改用只读方案、请求用户澄清或结束；三种动作的事件和最终状态互不混淆。

验收：不再需要 `resume_on_denied`；所有客户端清楚区分“拒绝操作”和“停止任务”。

### P1-F06 Exactly-once Grant/副作用

功能：单事务消费 Grant 并 claim execution；执行使用 idempotency key；崩溃恢复根据回执协议判定重试、补偿或人工确认。

测试：在事务提交前后、外部调用前后和回执写入前后逐点 fault injection；双 worker 并发抢占；重放攻击。

验收：本地可幂等操作自动恢复且只执行一次；无法证明外部结果的操作进入 `outcome_unknown`，绝不盲目重放。

### P1-F07 统一 reviewer 与 adapter 协议

功能：定义 `Reviewer` 接口及人类、Codex、后续自动 reviewer 实现；TUI/OAEP/Android 共享 request/decision API 和事件。

测试：adapter contract suite 对所有实现复用；断线、超时、重连、旧客户端字段缺失及版本协商。

验收：任一 reviewer 不可绕开 Policy/Grant；断线默认未授权；客户端之间能接力处理同一 Request。

### P1-F08 Approval 展示与决策质量

功能：显示目标、具体影响、范围、风险、不可逆性、能力变化和“批准一次”的边界；禁止仅展示泛化工具名。

测试：高风险 Proposal 的 UI snapshot、脱敏测试、长参数/Unicode/控制字符注入、无障碍标签和本地化。

验收：验收人员只看卡片即可区分两条不同命令、两个路径和两个外部目标；秘密不出现在卡片或事件中。

### P1-F09 数据迁移与兼容视图

功能：将旧审批/副作用记录迁移或投影到新模型；进行中的请求可在升级后继续处理；提供回滚边界。

测试：从真实脱敏样本升级、重复迁移、旧/新版本客户端混用、进行中 Run、损坏记录隔离。

验收：升级不丢历史审计或 pending 请求；兼容期结束前有使用遥测和明确删除门禁。

### P1-F10 可观测性与 SLO

功能：指标包括请求率、待处理时间、拒绝率、超时、重复决定、Grant 未使用率、outcome_unknown 和 adapter 故障，不记录秘密。

测试：指标基数、日志脱敏、事件顺序、断电恢复和告警演练。

验收：能定位卡在 reviewer、Policy、Grant 还是执行器；控制面故障不导致执行权限扩大。

## 5. 实施顺序与门禁

1. 固化 Proposal/Decision/Grant/Execution schema 与状态机。
2. 新表和服务双读验证，不长期双写；先迁移 Agent Kernel 主路径。
3. 迁移 Codex、TUI、OAEP/Android adapter。
4. 迁移 legacy ActionGuard，关闭独立事实源。
5. 开启多 pending、operation-level blocking 和故障恢复。
6. 删除兼容开关与过期表写路径。

P1 完成门禁：P1-F01～F10 全部通过；并发、崩溃恢复、升级迁移和多客户端 contract suite 通过；`resolve_approval()` 不再直接承担 Run 终止、执行放行和全部事件封存；任何 Approval Decision 都不能绕开 P0 Grant 和隔离执行器。

