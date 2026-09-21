# OpenDrSai 智能体安全 P3：Runtime 安全控制收敛与产品发布规格说明（SPEC）

状态：Draft  
版本：1.0  
日期：2026-08-21  
适用范围：Python Runtime、Windows Security Host、Windows Desktop、OAEP 安全事件与兼容适配；TUI、旧 WebUI 和 Android 原则上仅做兼容回归  
取代关系：本规格是后续安全开发的唯一执行计划；P0、P1、P2 保留为历史设计与需求追溯文档，不再分别排期或统计

## 1. 文档目的

本规格把以下三份历史方案收敛为一个可以直接开发、测试和发布验收的 P3：

- [P0：真正安全边界实施方案](./opendrsai-agent-security-p0-capability-boundary-plan.md)
- [P1：降低 Approval 控制面方案](./opendrsai-agent-security-p1-approval-control-plane-plan.md)
- [P2：三种权限模式产品化方案](./opendrsai-agent-security-p2-permission-modes-productization-plan.md)

P3 不表示 P0、P1、P2 已经完成，也不豁免其中尚未通过的安全门禁。P3 的作用是：

1. 停止同时维护三套阶段计划和 30 个分散进度口径。
2. 固定一个 Runtime-owned 安全权威链路。
3. 把现有实现、剩余风险、产品模式和发布证据统一到一个规格中。
4. 以打包 Windows 应用中的真实强制边界和端到端证据作为完成标准。
5. 尽量不修改 Agent Core，不以改造 TUI、旧 WebUI 或 Android 作为主路径。

P3 的核心产品不变量是：

> 任何模型、Agent、客户端、Approval 或兼容开关都不能直接产生执行权限；所有副作用只能由 Runtime 根据不可变策略签发单次能力，并在已证明有效的隔离边界中执行和留痕。

## 2. 当前基线与结论

### 2.1 正式进度基线

以 2026-08-16 第 68 轮安全实施台账为正式基线：

- P0/P1/P2 合计进度：**72%**，即 `2162 / 3000`。
- 完全验收：**0 / 30**。
- 未通过的原生测试、缺少管理员权限的测试和未执行的打包 E2E 均不计为完成。
- 第 68 轮之后尚未完整跑通并登记的工作不得计入本基线。

从 P3 开始不再更新 30 项等权百分比。P3 使用本规格第 15 节的 12 个发布能力域统计：

- `implemented`：代码与单元测试完成。
- `integrated`：接入正式 Runtime/Host 路径。
- `verified`：自动集成、崩溃和攻击测试通过。
- `accepted`：打包应用、兼容矩阵和发布证据全部通过。

P3 总进度只按 12 个能力域的四个阶段计算；没有 `accepted` 证据的能力域不得标记为 100%。

### 2.2 已经具备的主要能力

当前代码库已经形成以下基础：

1. 不可变 `ActionProposal`、`ResolvedCapabilityProfile` 和原始参数摘要。
2. deny-first Policy、不可覆盖的 hard-deny 规则和版本化 Profile 事实。
3. 单次、过期、精确绑定并可原子消费的 Authorization Grant。
4. Grant 消费与 Effect claim 同事务，以及 `outcome_unknown` 崩溃语义。
5. append-only、链式摘要、可检测篡改的安全审计事件。
6. Windows Job Object、受限身份/AppContainer 相关实现与隔离证明框架。
7. Workspace 文件代理、路径规范化、reparse/symlink/越界防护。
8. DNS/IP/重定向重验的 Network Egress Broker。
9. 引用式 Credential Broker、用途/目标/TTL/次数绑定与秘密清零。
10. 独立 Approval Request/Decision、Reviewer adapter、Grant 与 EffectExecution 模型。
11. 三种稳定 Permission Profile、模式切换、工作区信任和管理员策略基础。
12. Windows 安装器 journal、filesystem/SCM action、DPAPI envelope、service activation、single coordinator、fail-safe repair 与恢复租约。
13. 安全指标、SLO evaluator、host-local exporter 和默认关闭的本地传输基础。

### 2.3 尚未形成最终验收的关键缺口

1. 打包 Windows 应用中的真实 restricted identity/AppContainer、ACL、网络和凭据联合逃逸测试尚未形成完整发布门禁。
2. 仍需证明所有发布包副作用工具都经过统一 Broker；历史裸执行例外尚不能仅凭静态扫描视为清零。
3. Approval 新控制面尚缺全部正式路径迁移和多客户端 contract suite；兼容状态不能成为第二授权事实源。
4. AutoReviewer 尚缺正式签字数据集、误批阈值、模型/规则 pin 和灰度证据，不能对外宣称“帮我批准”已安全开放。
5. `isolated_full_access` 尚缺打包环境持续证明、失效降级和产品 E2E，不能把宿主裸权限包装为完全访问。
6. 安装器尚缺管理员 runner 上的真实 CreateService/StartService/consume/claim 全阶段强杀矩阵和正式 repair host entrypoint。
7. 审计外部锚定、正式运维告警、灾难恢复演练和签名 runbook 尚未闭环。
8. TUI、旧 WebUI、Android/OAEP 的兼容回归尚未成为统一发布门禁。

## 3. P3 总体目标

### 3.1 安全目标

1. **单一执行权威**：Policy、Proposal、Grant、EffectExecution 和 Receipt 只由 Runtime security boundary 持久化和解释。
2. **真实强制边界**：文件、进程、网络、凭据和资源限制必须由 OS/Host/Broker 强制，不能依赖提示词、正则或 UI。
3. **Approval 最小控制面**：Approval 只记录 reviewer 对不可变 Proposal 的决定，不直接结束 Run、放行裸执行或伪造回执。
4. **三模式同一安全底座**：`manual_safe`、`auto_reviewed`、`isolated_full_access` 只改变 reviewer 路由和能力上限，不改变 hard deny、Grant 或隔离要求。
5. **Exactly-once 副作用**：Grant 消费、Effect claim、外部调用和回执恢复具备确定语义；结果未知时不盲目重放。
6. **Fail closed**：策略、隔离、身份、审计、数据库、adapter 或证明不可用时不扩大权限。
7. **可发布证据**：源码开发模式和安装版都通过攻击、崩溃、升级、性能和多 surface 回归。

### 3.2 产品目标

1. 用户只看到三种稳定权限模式及其真实有效权限。
2. 用户未批准时没有需批准的副作用；拒绝操作不等于取消 Run。
3. AutoReviewer 只处理策略允许的灰区，强制人工类别永远升级用户。
4. 完全访问只表示已证明隔离环境内的广泛能力。
5. 客户端只能选择、展示和提交决定，不能修改安全事实或恢复权限。
6. 安全故障提供稳定错误码、可执行的安全替代和 host-only 运维修复路径。

### 3.3 架构目标

```text
Client / Agent / Model
        |
        v
Action Proposal -----> Policy Resolver -----> Review Requirement
        |                                        |
        |                                 Reviewer Decision
        |                                        |
        +----------> Grant Issuer <--------------+
                           |
                           v
                    Effect Claim Store
                           |
                           v
         Filesystem / Process / Network / Credential Brokers
                           |
                           v
                    Isolation Backend
                           |
                           v
                 Execution Receipt + Audit
```

依赖方向必须始终从产品 surface 指向安全边界。安全边界不得调用 Renderer、TUI 命令或模型文本来决定授权。

## 4. 范围与实施优先级

### 4.1 P3.0：事实源冻结与发布 fail-closed

- 建立 P3 capability inventory 和所有副作用入口清单。
- 固定唯一 Profile/Proposal/Decision/Grant/Effect/Receipt schema。
- 发布构建中禁止未登记的裸副作用入口。
- 旧 Approval、dangerous 和兼容状态只能作为输入 adapter，不得作为授权事实。

### 4.2 P3.1：Windows 强制边界闭环

- 完成打包 worker 的 restricted identity/AppContainer 证明。
- 完成文件投影、Job、句柄、网络、凭据和资源限制联合测试。
- 建立签名 worker/catalog/policy/installation metadata 验证链。
- 安装器和安全服务完成真实 elevated 生命周期与崩溃恢复。

### 4.3 P3.2：Approval 与 Effect 控制面收敛

- 所有正式工具统一产生 Proposal，经 Policy/Reviewer/Grant/Effect 路径执行。
- 删除或只读化第二事实源和内存放行缓存。
- 完成并发 pending、拒绝/取消解耦、重启恢复和 exactly-once。
- 客户端 adapter 只做协议转换。

### 4.4 P3.3：三模式产品化

- 稳定 mode descriptor 与 effective permissions。
- 完成 AutoReviewer 签名策略、评测、强制人工升级和 kill switch。
- 完成 isolated full access attestation、失效降级和醒目标识。
- 完成工作区信任、管理员约束、模式切换和旧配置安全迁移。

### 4.5 P3.4：观测、运维和发布验收

- 审计链外部锚定、低基数指标、SLO、告警和签名 runbook。
- 磁盘、SQLite、进程死亡、断电和升级回滚演练。
- Windows 安装版、TUI、旧 WebUI、Android/OAEP 统一兼容门禁。
- 安全评审签字后才允许开放 AutoReviewer 或 isolated full access。

## 5. 输入与输出

### 5.1 输入

P3 安全边界接受以下输入：

- `run_id`、Workspace identity、Session identity 和调用 principal。
- 用户选择的 permission mode 及来源。
- 系统、管理员、Workspace、用户和模式策略。
- 规范化前的工具名称和真实工具参数。
- Workspace 信任证明、Isolation Attestation 和 Runtime build identity。
- Reviewer Decision，包括 human、Codex adapter 或 AutoReviewer。
- 凭据引用、目标 origin、网络目标和用途，不接受调用方直接提供秘密值。
- Effect idempotency key、恢复状态和已有 execution receipt。
- Windows package catalog、service identity、installation metadata 和 bootstrap envelope。

所有客户端字段、模型文本、工具声明、路径、摘要、风险标签和 capability 声明默认不可信，必须由 Runtime/Host 重新计算或验证。

### 5.2 输出

P3 产生以下权威输出：

- `ResolvedCapabilityProfileV1`：Run 的实际有效权限和版本。
- `ActionProposalV1`：不可变操作身份、原始参数摘要和脱敏展示。
- `PolicyDecisionV1`：allow、review 或 hard deny 及稳定原因码。
- `ApprovalRequestV1` / `ApprovalDecisionV1`：reviewer 控制面事实。
- `AuthorizationGrantV1`：短期、单次、精确绑定的执行能力。
- `EffectExecutionV1`：副作用 claim、执行、恢复和终态。
- `IsolationAttestationV1`：隔离后端、身份、挂载、网络、资源和有效期证明。
- `ExecutionReceiptV1`：实际执行身份、结果摘要和安全证明引用。
- `EffectivePermissionsV1`：供客户端只读展示的脱敏权限摘要。
- `SecurityAuditEventV1`、低基数指标、告警状态和发布证据。

输出不得包含 access token、API Key、Authorization header、原始隐藏推理或未经脱敏的工具参数。

## 6. 权威模型与核心不变量

1. 一个 Run 在任意时刻只绑定一个当前 Profile version；旧版本只读保留。
2. Proposal 创建后不可修改；任何实质参数变化产生新 Proposal digest。
3. Approval Decision 不能直接执行工具，只能作为 Grant Issuer 的输入。
4. Grant 必须绑定 `run + proposal + profile + operation + expiry + nonce`，默认一次消费。
5. Grant 消费与 Effect claim 必须在同一数据库事务。
6. Effect terminal 不可反转；`outcome_unknown` 不得自动当作失败后重试。
7. hard deny 在所有 mode、reviewer、旧配置和开发提示之前执行。
8. 隔离证明无效、过期、降级或与请求不匹配时不得启动 worker。
9. 客户端、Agent、模型和插件不能调用模式提权、Grant 签发、Effect claim 或 recovery owner API。
10. 降权立即撤销未消费 Grant；提权创建新 Profile version 并重新评估 pending Proposal。
11. 子 Agent、后台任务和计划任务不得继承比父 Run 更宽的权限。
12. 审计失败不能被解释为执行成功；关键安全事实与审计事件同事务或使用可证明的恢复协议。
13. 安装器 `recovery_required` 持续占有 install root；新操作不能绕过故障 owner。
14. 安全缓存只能提高读取速度，不能成为第二事实源。

## 7. 功能行为和业务规则

### 7.1 Profile 解析

1. 按系统硬限制、组织策略、Workspace 策略、用户偏好、模式规则顺序求交集。
2. 任意下层只能收紧，不能放宽上层。
3. 未知 schema/version、签名错误、过期策略或冲突配置 fail closed。
4. 无法安全迁移的旧配置映射到 `manual_safe`。
5. Profile digest 由 canonical payload 计算，不使用脱敏展示内容。

### 7.2 Proposal 与 Policy

1. 工具执行前由可信 Runtime 对真实参数规范化并计算摘要。
2. `display_payload` 独立脱敏，仅用于用户展示。
3. Policy 输出仅为 `allow_without_review | require_reviewer | hard_deny`。
4. 工具或模型提供的 risk/approval 标签只作为提示，不能覆盖 Runtime registry。
5. hard deny 不创建可批准 Request。

### 7.3 Approval

1. Request 状态为 pending、approved、denied、expired 或 cancelled。
2. 同值决定幂等；冲突决定返回稳定错误。
3. 一个 Run 可以有多个 pending Request；每个只阻塞依赖该结果的 operation。
4. deny 返回结构化工具结果，不自动 cancel Run。
5. cancel Request、cancel Run 和 revoke Grant 是不同操作和权限。
6. Approval UI 必须展示目标、影响、范围、不可逆性、能力变化和批准一次边界。
7. adapter 断线、超时或解析失败保持未授权。

### 7.4 Grant 与 Effect

1. allow_without_review 或有效 approve 才能尝试签发 Grant。
2. 签发时重新验证当前 Profile、Policy、Proposal 和 reviewer requirement。
3. 执行前用实际参数重新计算 Proposal digest。
4. 单事务消费 Grant 并 claim Effect。
5. 本地可证明幂等的操作可按恢复协议继续；外部结果未知进入 `outcome_unknown`。
6. 补偿必须是独立 Proposal/Grant/Effect，不能修改原终态。

### 7.5 文件系统

1. 所有路径相对于已验证 Workspace root 或显式 mount。
2. 拒绝 `..`、绝对路径逃逸、UNC、设备路径、ADS、reparse point 和符号链接穿越。
3. 校验必须针对实际打开的句柄和最终文件 identity，避免 TOCTOU。
4. 写入使用受控 staging、原子替换和可恢复 journal。
5. Workspace 外访问只有显式能力和 Host broker 才能执行。

### 7.6 进程与资源

1. worker 使用非管理员受限身份或 AppContainer。
2. 先 suspended 创建、加入 Job、验证约束，再 resume。
3. 不继承无关句柄、环境、token 或父进程权限。
4. 强制进程树、CPU、内存、时间、输出和退出清理上限。
5. 隔离后端不能证明约束时不得回退到宿主裸执行。

### 7.7 网络与凭据

1. 默认无网络；每个连接按 scheme、host、port、DNS 结果和最终 peer IP 授权。
2. 拒绝 loopback、private、link-local、metadata、保留地址和 DNS rebinding。
3. 每次 redirect 重新授权；凭据不自动跨跳重放。
4. 凭据使用引用和短期 lease，绑定 Run、Profile、用途、origin、TTL 和次数。
5. 秘密只在 transport boundary 短时物化并清零，不进入 argv、普通环境、日志或事件。

### 7.8 三种权限模式

#### `manual_safe`

- 默认模式。
- 低风险只读能力可按 Policy 无打扰执行。
- 需要 reviewer 的 Proposal 必须由用户决定。
- 无决定、断线或超时均不执行。

#### `auto_reviewed`

- 使用签名、版本固定的 AutoReviewer policy。
- 确定性规则优先；模型只处理允许的灰区。
- 不可逆发布/消息/删除、权限身份变化、生产操作、首次敏感凭据、范围扩大和低置信度必须升级人工。
- AutoReviewer 不可覆盖 hard deny 或 Profile 上限。

#### `isolated_full_access`

- 只有有效 Isolation Attestation 时可进入。
- “完全”只表示隔离环境内的广泛开发能力。
- 宿主挂载、真实凭据、网络和高价值外部目标仍按 Policy/Grant 管理。
- 证明失效立即停止新 Effect、撤销未消费 Grant，并降级为安全状态。

### 7.9 模式切换与 Workspace 信任

1. 新或来源变化的 Workspace 默认不可信并进入 `manual_safe`。
2. 信任 Workspace 与选择 mode 是两个独立、可撤销的决定。
3. 降权立即生效；提权要求显式确认和新 Profile version。
4. Agent 工具不得触发模式切换或信任决定。
5. `isolated_full_access` 不得保存为跨 Workspace 默认。

### 7.10 安装器、安全服务与恢复

1. package catalog、release pins、installation metadata、binary 和 SCM identity 全部验真。
2. 安装时服务先 disabled/stopped，再执行 filesystem 和 SCM action。
3. 提交前失败组合回滚；提交后只允许同身份前向恢复或保持 fail-safe。
4. bootstrap 使用 publish-first/record-second，避免孤儿 authority。
5. StartService 前持久化 start intent；重启后根据 authority、SCM 和 PID 对账。
6. `recovery_required` 持有 root fence；repair 使用 host-only lease 和 fencing token。
7. repair 不补发 consumed authority，不接受客户端调用。

### 7.11 审计、指标和告警

1. 关键状态变化写入 append-only hash-chain journal。
2. 指标和标签使用固定 allowlist、低基数和秘密扫描。
3. exporter 默认不开放网络，仅允许受认证的 host-local transport。
4. SLO policy 必须签名、版本固定并由 Runtime owner 加载。
5. 告警 raise/clear 去重且与状态同事务。
6. 审计链损坏时停止安全评估结果发布并产生不可静默清除的故障。

## 8. 接口与数据结构

以下是 P3 稳定领域合同；可以先作为 Python 内部 frozen dataclass 实现。提升为 OAEP/API 前必须版本化并通过兼容测试。

### 8.1 `ResolvedCapabilityProfileV1`

```json
{
  "profile_id": "profile-id",
  "version": 3,
  "run_id": "run-id",
  "mode_id": "manual_safe",
  "workspace_identity_sha256": "sha256:...",
  "read_mounts": ["workspace"],
  "write_mounts": ["workspace/artifacts"],
  "process_capabilities": ["process.spawn.restricted"],
  "network_rules": [],
  "credential_refs": [],
  "hard_deny_policy_version": "2026-08-21",
  "isolation_requirement": "required",
  "expires_at": 1780000000,
  "profile_digest": "sha256:..."
}
```

### 8.2 `ActionProposalV1`

```json
{
  "proposal_id": "proposal-id",
  "run_id": "run-id",
  "operation": "filesystem.write",
  "canonical_payload_digest": "sha256:...",
  "profile_digest": "sha256:...",
  "display_payload": {"path": "artifacts/report.md"},
  "risk_class": "workspace_write",
  "created_at": 1780000000
}
```

### 8.3 `PolicyDecisionV1`

```json
{
  "proposal_id": "proposal-id",
  "decision": "require_reviewer",
  "reason_codes": ["workspace_write_requires_review"],
  "policy_digest": "sha256:...",
  "reviewer_requirement": "human"
}
```

### 8.4 `ApprovalRequestV1` 与 `ApprovalDecisionV1`

```json
{
  "request_id": "approval-id",
  "proposal_id": "proposal-id",
  "status": "pending",
  "reviewer_kind": "human",
  "deadline_at": 1780000300
}
```

```json
{
  "request_id": "approval-id",
  "decision": "approved",
  "reviewer_id_digest": "sha256:...",
  "reviewer_policy_digest": "sha256:...",
  "reason_code": "user_confirmed_once",
  "decided_at": 1780000010
}
```

### 8.5 `AuthorizationGrantV1`

```json
{
  "grant_id": "grant-id",
  "run_id": "run-id",
  "proposal_digest": "sha256:...",
  "profile_digest": "sha256:...",
  "operation": "filesystem.write",
  "nonce_digest": "sha256:...",
  "maximum_uses": 1,
  "expires_at": 1780000060,
  "status": "active"
}
```

### 8.6 `EffectExecutionV1`

```json
{
  "execution_id": "effect-id",
  "grant_id": "grant-id",
  "idempotency_key": "effect-key",
  "state": "claimed",
  "attempt": 1,
  "isolation_attestation_id": "attestation-id",
  "receipt_digest": null,
  "error_code": null
}
```

合法状态：`claimed | executing | succeeded | failed | timed_out | outcome_unknown | compensation_required`。终态不可反转。

### 8.7 `IsolationAttestationV1`

```json
{
  "attestation_id": "attestation-id",
  "backend": "windows_appcontainer",
  "backend_version": "1",
  "runtime_build_digest": "sha256:...",
  "identity": "appcontainer-sid-digest",
  "guarantees": [
    "non_admin_identity",
    "filesystem_enforced",
    "network_enforced",
    "process_tree_controlled"
  ],
  "mount_manifest_digest": "sha256:...",
  "network_policy_digest": "sha256:...",
  "expires_at": 1780000300
}
```

### 8.8 `ExecutionReceiptV1`

```json
{
  "execution_id": "effect-id",
  "outcome": "succeeded",
  "operation": "filesystem.write",
  "result_digest": "sha256:...",
  "profile_digest": "sha256:...",
  "attestation_id": "attestation-id",
  "started_at": 1780000011,
  "finished_at": 1780000012
}
```

### 8.9 `EffectivePermissionsV1`

```json
{
  "mode_id": "manual_safe",
  "mode_version": 1,
  "profile_digest": "sha256:...",
  "workspace": {"read": true, "write": "approval_required"},
  "network": {"default": "deny", "allowed_origins": []},
  "credentials": {"available_refs": 0},
  "reviewer": "human",
  "hard_denies": ["security_control_mutation", "credential_theft"],
  "restriction_sources": ["system", "organization", "workspace"]
}
```

### 8.10 Host-only repair contract

```json
{
  "operation": "windows_security_installation.reconcile",
  "coordinator_id": "windows-coordinator-id",
  "catalog_digest": "sha256:...",
  "expected_state": "recovery_required",
  "operator_identity_digest": "sha256:..."
}
```

该接口只能由安装器/安全服务 Host 调用，不进入 Workspace API、Agent tool registry、TUI slash command 或普通 Desktop IPC。

## 9. 模块变更范围

### 9.1 主要更新模块

| 模块 | P3 目标 | 约束 |
|---|---|---|
| `backend/runtime/security_boundary/` | 保持安全领域唯一事实源并完成真实后端 | 不依赖 Renderer、TUI 或模型文本 |
| `backend/runtime/permission_modes/` | 三模式 descriptor、解析、切换和有效权限 | 只能收紧 Profile，不直接执行 |
| `backend/runtime/approval_*` | Request/Decision/Reviewer adapter | Decision 不直接放行工具 |
| `backend/runtime/effect_*` | Grant 消费、claim、恢复和 receipt | 终态不可反转，不盲目重放 |
| Windows security host/installer | 安装、启动、repair、观测 transport | host-only，不暴露给 Agent |
| `backend/gateway.py` | 窄 adapter 与只读 API | 不保留第二授权事实源 |
| OAEP adapter | additive request/decision/effective-permissions 投影 | 未协商版本时保持兼容 |
| Desktop Renderer | 展示模式、Approval 和安全错误 | 不计算权限或决定是否执行 |

### 9.2 尽量不修改的模块

- Agent Core：只允许增加最小的 Proposal/Effect hook 或 adapter 注入点；不得把安全状态机移入 Agent Core。
- TUI：保留现有 surface 和命令兼容；底层执行仍必须服从 P3 hard deny 和 Broker。
- 旧 WebUI：不迁移到 Desktop 安全 UI，只做正式路径回归。
- Android：公共 OAEP 字段仅 additive，未知版本 fail closed 或降级只读展示。

### 9.3 必须移除或只读化的行为

1. 内存 `_approved_effects` 或等价缓存作为执行授权。
2. `resolve_approval()` 直接结束 Run、执行工具或封存全部事件。
3. `approval_policy=never`、`/dangerous on` 或客户端布尔值解除 hard deny/隔离。
4. 发布包中的未登记裸 subprocess、shell、socket、直接凭据读取或任意文件访问。
5. 隔离失败后回退到宿主执行。
6. 客户端传入摘要、风险标签、路径检查结果或 attestation 后直接信任。
7. 通过清除错误状态、删除 journal 或新建 operation 绕过 `recovery_required`。

## 10. 边界条件与异常处理

### 10.1 策略与 Profile

- 策略缺失、签名错误、版本未知：`security_policy_unavailable`，不签发 Grant。
- 多层规则冲突：选择更严格结果并记录来源；无法确定时 deny。
- Profile 过期：停止新 claim，撤销未消费 Grant，正在执行的 Effect 按恢复协议处理。

### 10.2 Approval

- 重复同值决定：返回原 Decision。
- 冲突决定：`approval_decision_conflict`，不创建第二 Grant。
- 超时/断线/adapter 失败：保持未授权或 expired，不默认 approve。
- reviewer 输出格式错误或低置信度：升级 human 或 deny。
- deny 后 Agent 可选择只读替代，但必须是新 Proposal。

### 10.3 Effect 与崩溃

- claim 事务前崩溃：Grant 保持 active，可安全重试 claim。
- claim 提交后、外部调用前崩溃：按 operation recovery contract 判断。
- 外部调用后、receipt 前崩溃：不能证明结果时 `outcome_unknown`。
- 双 worker：只有一个成功 claim；另一个观察现有 execution。
- compensation 失败：保留原 receipt 和独立失败事件，不能覆盖历史。

### 10.4 文件系统

- symlink/junction/reparse/identity 变化：拒绝并记录低基数错误。
- 文件在校验与使用间变化：句柄 identity 不匹配，操作失败。
- 磁盘满或 fsync 失败：不提交成功 receipt；根据 journal 恢复或 fail closed。
- rollback 无法证明：进入 `recovery_required`，保留 root fence。

### 10.5 进程与隔离

- restricted token/AppContainer 创建失败：不启动工具。
- Job assignment、ACL projection 或 handle audit 失败：终止 suspended worker。
- worker 超时或失联：关闭 Job，证明进程树退出；无法证明时 outcome unknown/安全告警。
- attestation 过期或 build digest 不匹配：拒绝执行并要求重建。

### 10.6 网络与凭据

- DNS 混合公私地址、peer IP 漂移或 redirect 未授权：拒绝整个请求。
- 凭据 lease 已消费、过期、撤销或目标变化：拒绝，不重新物化秘密。
- transport 抛错：清零秘密；不在错误正文中包含 header/body。
- 系统代理或调用方 Authorization header：拒绝。

### 10.7 模式与信任

- unknown mode/version：降级 `manual_safe` 或拒绝创建 Run。
- isolation 在 full access 中失效：停止新 Effect、撤销未消费 Grant并显示降级。
- 组织策略不可用：使用最后可信且不更宽版本；没有可信版本则 fail closed。
- Workspace fingerprint 变化：撤销信任并回到最小能力。

### 10.8 安装器与 repair

- publish 前崩溃：没有可消费 authority。
- envelope 已发布、record 前崩溃：恢复同一 token 后 record。
- StartService 后 phase commit 前崩溃：用 authority 状态、SCM identity 和 PID 对账。
- repair owner 死亡：lease 到期前拒绝第二 owner，到期后用新 fencing token 接管。
- stale repair owner 恢复：phase commit 因 owner/expiry 不匹配被拒绝。
- consumed authority 且服务不可证明：保持 disabled/stopped 和 recovery_required，不补发 token。

### 10.9 数据库、审计和观测

- SQLite BUSY：有界重试；不得改为内存授权。
- FULL/IOERR/CORRUPT：停止新权限签发，保留可诊断错误，不输出部分成功。
- 审计 append 失败：与关键状态事务一起回滚。
- journal hash-chain 验证失败：停止安全评估/导出并提升 host 告警。
- exporter/transport 不可用：不影响 deny 语义，也不能扩大权限。

## 11. 非功能要求

### 11.1 性能

- Profile/Policy/Proposal 纯计算路径 P95 小于 20 ms，不含外部 reviewer。
- 本地 Grant claim + Effect journal P95 小于 50 ms，SQLite 正常负载下不得全表扫描。
- 只读 effective-permissions P95 小于 50 ms。
- host-local metrics scrape P95 小于 200 ms，且并发 scrape 不修改安全状态。
- 安全事件和指标标签保持固定低基数，不包含 Run/Workspace/path/secret 作为标签值。
- 文件摘要和 Artifact 检查按流式 O(n) 处理，设置单文件和单 Run 上限。

### 11.2 可靠性

- 所有权威状态存储支持进程重启恢复。
- 关键状态机以数据库约束和 CAS/fencing 保证，不只依赖进程锁。
- 终态、Decision、Grant 消费、Effect claim 和 installer phase 均幂等。
- 任何恢复路径必须产生与实时路径相同的最终安全事实。
- 数据迁移必须支持旧记录只读、进行中状态恢复和明确回滚边界。

### 11.3 安全与隐私

- 不保存原始秘密、Authorization header、未脱敏参数或隐藏 chain-of-thought。
- 授权摘要和展示脱敏严格分离。
- 使用 constant-time secret digest 比较和受控内存生命周期。
- 所有 host-only API 使用 OS identity、ACL、服务 SID 或等价本机认证，不复用 Workspace bearer token。
- 默认不监听公网或 LAN；诊断传输默认关闭。
- 安全控制文件、policy、journal、binary 和 envelope 由受信任 writer ACL 保护。
- hard deny 攻击语料和逃逸 canary 在所有产品 mode 下运行。

### 11.4 可维护性

- 安全状态机保持在 `security_boundary`/专属服务内，不散落在 Renderer 或 Agent prompt。
- frozen dataclass、canonical serialization 和稳定 reason code 必须有 contract test。
- 新增副作用工具必须同时登记 risk、operation、Broker、recovery contract 和测试。
- 临时兼容 adapter 必须有 owner、删除条件和 CI 门禁。

### 11.5 兼容性与可访问性

- Desktop、TUI、旧 WebUI、Android 对同一 Approval/Mode 只做投影，不各自发明授权语义。
- 新 OAEP 字段 additive；未知安全 schema 不得被解释为允许。
- Approval、权限预览、错误和降级状态支持键盘、屏幕阅读器、中英文和窄屏。
- TUI `/dangerous` 可保持命令兼容，但不能保持绕过 P3 边界的旧语义。

## 12. 测试策略

### 12.1 单元测试

- canonicalization、secret redaction、digest collision 和 schema validation。
- deny-first Policy、层级求交、unknown version 和过期。
- Approval 状态竞争、重复/冲突 Decision 和多 pending。
- Grant 绑定、单消费、撤销、过期和实际参数重验。
- Effect 状态机、终态不可反转、outcome_unknown 和补偿。
- mode descriptor、switch、Workspace trust 和管理员约束。

### 12.2 集成测试

- Runtime 正式工具 registry 到 Broker 的完整调用。
- 文件、进程、网络、凭据在同一隔离 worker 中的联合 canary。
- human/Codex/AutoReviewer adapter 共享同一 Request/Decision API。
- OAEP/Desktop 恢复原 Approval 和 Effect，不重复执行。
- installer/service 的 package→filesystem→SCM→envelope→start→claim 全链路。

### 12.3 攻击测试

- Workspace traversal、symlink/junction/reparse、UNC、ADS 和 TOCTOU。
- 进程注入、句柄继承、管理员 token、breakaway process 和 Job 逃逸。
- DNS rebinding、redirect、peer drift、代理绕过和元数据访问。
- credential exfiltration 到日志、argv、环境、临时文件、crash dump 和子进程。
- Proposal/display digest 混淆、Approval replay、Grant replay 和 mode escalation。
- 审计篡改、数据库替换、control-file overwrite 和服务 identity drift。

### 12.4 崩溃与故障注入

- Grant consume/Effect claim 事务前后。
- 外部调用前后和 receipt commit 前后。
- filesystem stage/promote、SCM register、child commit。
- envelope publish/record、finalize、start、consume、claim。
- recovery lease claim、owner kill、精确到期接管和 stale owner commit。
- SQLite BUSY/FULL/IOERR/CORRUPT、磁盘满、进程 kill 和主机重启。

### 12.5 发布与兼容测试

- Windows 源码开发模式与安装版相同安全场景。
- 管理员安装、普通用户运行、服务 SID/ACL 和卸载/repair/upgrade。
- TUI 问答、文件、工具、Approval 和 `/dangerous` surface 回归。
- 旧 WebUI 普通问答和工具冒烟。
- Android/OAEP Approval、mode descriptor、未知版本和断线恢复。
- AutoReviewer 离线评测、shadow、灰度和 kill switch。

## 13. 验收标准与测试案例

| ID | 场景 | 操作 | 验收结果 |
|---|---|---|---|
| P3-AC-01 | 无 Approval | 对需 review 的文件写入不作决定 | 无文件变化、无 Grant、无 Effect claim |
| P3-AC-02 | Proposal 篡改 | Approval 后改变任意真实参数 | 原 Grant 拒绝，新参数必须新 Proposal |
| P3-AC-03 | 双 worker | 两进程同时消费同一 Grant | 仅一个 claim，至多一个副作用 receipt |
| P3-AC-04 | 外部结果未知 | 调用后、receipt 前强杀 Runtime | 状态为 outcome_unknown，不自动重放 |
| P3-AC-05 | 文件逃逸 | traversal、junction、reparse、UNC、ADS | 全部拒绝，Workspace 外 canary 不变 |
| P3-AC-06 | 进程逃逸 | worker 启动子孙进程并尝试 breakaway | 非管理员、受 Job 控制，退出后零遗留 |
| P3-AC-07 | 网络逃逸 | 私网、metadata、DNS rebinding、redirect | 全部被 Broker 拒绝并有低基数事件 |
| P3-AC-08 | 凭据泄漏 | 扫描 prompt、日志、环境、argv、临时文件 | 零明文 secret；越权用途拒绝 |
| P3-AC-09 | hard deny | 在三种 mode、Approval approve、dangerous 下请求关闭审计 | 全部拒绝，不能生成 Grant |
| P3-AC-10 | deny/cancel | 拒绝一个工具但保留 Run | 仅该 operation 被拒绝，Run 可走安全替代 |
| P3-AC-11 | 多 pending | 同一 Run 同时等待 A/B | A 的决定不改变 B，无 Run 级错误放行 |
| P3-AC-12 | AutoReviewer 强制人工 | 删除、发布、生产、权限变化 | 100% escalate human，误批为 0 |
| P3-AC-13 | AutoReviewer 普通集 | 运行签字评测数据 | 达到预设阈值并可复现 policy/model version |
| P3-AC-14 | 隔离完全访问 | attestation 有效/失效各运行一次 | 有效时仅隔离内放宽；失效时不可选择/执行 |
| P3-AC-15 | 模式降权 | active Run 从高模式降至 manual | 未消费 Grant 撤销，旧 Grant 不可执行 |
| P3-AC-16 | 模式提权 | Agent 自行请求切换 | 拒绝；只有用户/管理员显式入口可创建新 Profile |
| P3-AC-17 | 不可信 Workspace | 打开含恶意配置和启动脚本的仓库 | 默认最小只读，不加载其安全控制配置 |
| P3-AC-18 | Approval 重启恢复 | pending 时重启 Renderer/Runtime | 原 Request 恢复，不产生第二 Grant/Effect |
| P3-AC-19 | Installer 强杀矩阵 | 每个 durable checkpoint 后 kill | 恢复到唯一安全结果，无双服务/双 authority |
| P3-AC-20 | Repair owner kill | claim lease 后强杀，精确到期接管 | 到期前 busy，到期后 successor 接管，stale owner fenced |
| P3-AC-21 | 审计篡改 | 修改/删除/重排安全事件 | 验证失败、告警 raised，不输出可信 SLO |
| P3-AC-22 | SQLite 故障 | BUSY/FULL/IOERR/CORRUPT 注入 | 不扩大权限、不产生部分成功或内存放行 |
| P3-AC-23 | 发布包静态门禁 | 扫描所有副作用入口 | 无未登记裸执行；例外为零或签字开发专用且不打包 |
| P3-AC-24 | Surface 兼容 | Desktop/TUI/WebUI/Android 合同套件 | 同一安全事实一致；未知字段不导致放行 |
| P3-AC-25 | 安装版联合逃逸 | 打包 worker 运行完整攻击套件 | 零成功逃逸，失败时不回退宿主执行 |
| P3-AC-26 | 安全关闭 | 关闭 AutoReviewer/full access kill switch | manual_safe 可用，未消费高权限 Grant 失效 |

P3-AC-01 至 P3-AC-12、P3-AC-14 至 P3-AC-26 全部是发布阻断项。P3-AC-13 必须在开放 AutoReviewer 前由安全负责人签字；未签字时只能保持 disabled/shadow。

## 14. 明确不做什么

1. 不把 P3 当作 P0/P1/P2 已完成的证明。
2. 不降低或删除历史方案中的安全门禁；只把它们映射到 P3。
3. 不把宿主裸权限定义为产品“完全访问”。
4. 不通过提示词、模型自报、正则命令检查或 UI 隐藏建立安全边界。
5. 不让 Approval Decision、Turn commit、模型最终回答或 Artifact 卡片直接代表执行成功。
6. 不在 Agent Core 中重新实现 Policy/Grant/Effect 状态机。
7. 不把 TUI 迁移到 Desktop shared Kernel，不重写旧 WebUI。
8. 不为了 P3 同时重做聊天 UI、导航、设置架构或输出收敛 P4。
9. 不把 AutoReviewer 在无签字评测时默认开启。
10. 不在隔离证明缺失时显示或启用 isolated full access。
11. 不自动重放 `outcome_unknown` 外部副作用。
12. 不自动删除历史 Approval、Receipt、Artifact 或审计记录。
13. 不通过清库、改状态、重置 lease 或新建 operation 绕过 recovery_required。
14. 不记录或展示 access token、API key、原始隐藏推理和未经脱敏参数。
15. 不因本机缺管理员权限而把 skipped 原生测试计作通过。

## 15. P3 能力域、迁移映射与进度口径

| P3 能力域 | 继承需求 | 当前基线判断 | P3 完成证据 |
|---|---|---|---|
| P3-F01 Profile/Policy 单一事实源 | P0-F01、P1-F02、P2-F01/F08 | 已有主要实现，未完全接管正式路径 | 全工具/Run 接入、迁移与打包合同 |
| P3-F02 文件系统强制边界 | P0-F02 | 高完成度，缺打包攻击门禁 | 安装版逃逸零成功 |
| P3-F03 Windows 隔离与资源 | P0-F03、P2-F04 | 有实现与专项测试，缺完整产品证明 | signed packaged worker 联合 E2E |
| P3-F04 网络与凭据 | P0-F04/F05 | Broker 基础成熟，缺所有工具接线 | 无直连/泄漏，真实 transport E2E |
| P3-F05 Hard deny 与不可信 Workspace | P0-F06/F08、P2-F07 | 规则和模型已实现，缺全产品攻击集 | 三 mode + 所有 surface 零绕过 |
| P3-F06 Proposal/Approval/Grant | P0-F07、P1-F01～F05/F07/F08 | 领域服务成熟，仍有兼容路径 | 无第二事实源，多客户端合同通过 |
| P3-F07 Exactly-once Effect | P1-F06 | 高完成度，缺全副作用/外部补偿 | 全 checkpoint fault matrix |
| P3-F08 三模式与安全切换 | P2-F02～F06/F09 | descriptor/切换基础存在，未产品验收 | 三 mode 产品 E2E、旧 Grant 零越权 |
| P3-F09 AutoReviewer 安全开放 | P2-F03/F10 | 未达到正式开放门禁 | 签字评测、shadow、灰度、kill switch |
| P3-F10 审计、SLO 与运维 | P0-F09、P1-F10、P2-F10 | 高完成度，缺外部锚定/演练 | 正式 transport、告警、runbook、灾备 |
| P3-F11 安装器与安全服务 | P0-F10 的 Windows 部署部分 | durable coordinator 已实现，缺 elevated E2E | 全阶段强杀、repair、升级/卸载门禁 |
| P3-F12 发布迁移与 Surface 兼容 | P0-F10、P1-F09、P2-F09 | 尚未形成统一发布门禁 | 裸入口清零、四 surface、安装版连续通过 |

每轮 P3 进展必须报告：

1. 轮次和日期。
2. 12 个能力域各自处于 implemented/integrated/verified/accepted 的哪个阶段。
3. 新增或失效的证据。
4. 测试通过、失败、skip 和未运行数量。
5. 当前发布阻断项。
6. P3 总进度：48 个阶段格中已完成格数；只有 accepted 格计入该能力域最终 25%。

## 16. 实施顺序

1. 冻结 capability inventory、正式副作用入口和 P3 schema。
2. 把现有 Runtime 正式工具逐一迁移到 Proposal→Policy→Grant→Effect→Broker。
3. 完成 packaged Windows worker 的文件/进程/网络/凭据联合强制证明。
4. 清除 Approval 第二事实源和裸执行发布例外。
5. 完成 installer/service 全 checkpoint 强杀与 host-only repair entrypoint。
6. 完成三模式 effective permissions、切换、Workspace trust 和管理员策略。
7. AutoReviewer 先 disabled，再 shadow，达到签字阈值后小流量灰度。
8. 接入审计外部锚定、正式指标传输、告警和签名 runbook。
9. 运行 Windows 安装版、TUI、旧 WebUI、Android/OAEP 统一门禁。
10. 独立安全评审签字后将 P3 标为 accepted。

## 17. 发布、灰度与回滚

- `manual_safe` 始终作为最小可用回退模式。
- AutoReviewer 和 isolated full access 使用独立 kill switch。
- kill switch 关闭后立即阻止新高权限 Grant，并撤销尚未消费的相关 Grant。
- 回滚不能恢复旧裸执行路径、旧 dangerous 越权语义或第二 Approval 权威。
- schema 回滚保持新安全事实只读，不删除审计或执行 receipt。
- 安装器回滚只允许已验证 snapshot 和 ownership marker，不接受路径/SCM 猜测。
- 发布观察至少包括 hard deny、reviewer escalation、Grant unused、outcome_unknown、isolation failure、recovery_required 和 adapter failure。

## 18. 完成定义（Definition of Done）

P3 只有在以下条件全部满足时完成：

1. P3-F01～P3-F12 全部达到 `accepted`。
2. P3-AC 发布阻断案例全部通过；没有用 skip、mock 或源码模式代替要求的安装版证据。
3. 发布包全部副作用入口经过统一 Broker，裸执行例外清零。
4. Approval Decision 无法绕过 Policy、Grant、Effect claim 和隔离执行器。
5. AutoReviewer 有签字评测、版本 pin、shadow/灰度和 kill switch；否则保持关闭。
6. isolated full access 在 attestation 失效时不可选择、不可执行且不回退宿主。
7. Windows 安装、升级、repair、启动、消费、恢复和卸载通过管理员 runner 全矩阵。
8. TUI、旧 WebUI、Android/OAEP 和 Desktop 对相同安全事实保持兼容，任何 surface 不拥有独立授权语义。
9. 审计链、外部锚定、指标、告警和签名 runbook 经故障演练验证。
10. 独立安全评审确认：即使所有 Approval 都被错误批准，P3 强制边界仍阻止 hard deny、宿主逃逸、凭据窃取和越权网络访问。

在以上证据齐备前，不得把 P3 标记完成，也不得把 `auto_reviewed` 或 `isolated_full_access` 宣布为默认安全可用。
