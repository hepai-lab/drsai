# OpenDrSai 智能体安全 P2：三种权限模式产品化方案

> 状态：Proposal  
> 优先级：P2（依赖 P0 安全边界和 P1 Approval 解耦）  
> 基线调研：[agent-security-controls-research-2026.md](./agent-security-controls-research-2026.md)  
> 前置方案：[P0 真正安全边界](./opendrsai-agent-security-p0-capability-boundary-plan.md) · [P1 Approval 控制面](./opendrsai-agent-security-p1-approval-control-plane-plan.md)

## 1. 总体目标

将“请求批准、帮我批准、完全访问权限”从三个模糊开关产品化为三个可解释、可验证、跨客户端一致的权限配置。模式决定 reviewer 和能力上限，但不得覆盖系统硬禁止；用户始终能看到当前有效权限，而不是只看到模式名称。

### 1.1 三种模式的正式定义

| 产品名称 | 内部 ID | reviewer | 默认能力 | 强制人工项 |
|---|---|---|---|---|
| 请求批准 | `manual_safe` | 用户 | 工作区受限、默认无网、最小凭据 | Policy 标记需批准的副作用 |
| 帮我批准 | `auto_reviewed` | 自动 reviewer，必要时升级用户 | 与请求批准相同的 P0 边界 | 不可逆外部写、身份/权限变化、生产环境、敏感凭据、规则不确定项 |
| 完全访问权限 | `isolated_full_access` | 默认不逐项批准 | **隔离环境内部**广泛文件/进程/网络能力 | 宿主挂载扩展、真实身份凭据、生产/高价值目标；硬禁止永不放行 |

“完全访问权限”不等于当前宿主用户权限。没有有效 `IsolationAttestation` 时该模式必须不可选。若未来提供宿主裸权限，只能作为受管理员策略约束、逐会话明确确认、不可保存为默认值的实验性高危模式，且不属于本 P2 三模式范围。

## 2. 解决方案

### 2.1 PermissionProfile

以版本化 `PermissionProfile` 替代散落的 `approval_policy`、`dangerous` 和工具级模式开关。Profile 包含：

- `mode_id` 与 schema/policy 版本；
- P0 Capability 上限与默认值；
- P1 reviewer 路由、升级规则和超时策略；
- 工作区信任、网络、凭据、外部写及生产目标规则；
- 管理员限制和用户本次选择；
- UI 可展示的 `effective_permissions` 和限制原因。

最终有效策略遵循：系统硬禁止 ∩ 管理员上限 ∩ 平台隔离能力 ∩ 工作区信任 ∩ 模式配置 ∩ 会话临时授权。

### 2.2 自动 reviewer

“帮我批准”使用独立 `AutoReviewer`，输入只能是结构化 Proposal、有效策略和最小必要上下文；输出为 approve、deny 或 escalate，并记录模型/规则版本、置信度和理由码。它不能批准超出 profile 的能力、不能覆盖硬禁止，也不能把解析失败视为允许。

优先采用确定性规则处理已知类别，模型仅处理规则允许的灰区。以下至少升级人工：不可逆外部发布/消息/删除、权限或身份变更、生产环境操作、首次使用敏感凭据、扩大工作区/网络范围、低置信度或 Proposal 展示不完整。

### 2.3 隔离完全访问

进入 `isolated_full_access` 前验证 `IsolationAttestation`：隔离后端类型和版本、非管理员身份、挂载清单、网络策略、凭据范围、资源限制、快照/销毁策略和健康测试时间。模式内可减少逐项 Approval，但仍经过 Proposal、Policy、Grant 和审计。

## 3. 模块变更清单

### 3.1 新增模块

建议新增 `backend/runtime/permission_modes/`：

- `profiles.py`：三种内置 profile 及 schema。
- `resolver.py`：系统、管理员、平台、工作区、用户配置合并。
- `auto_reviewer.py`：确定性规则、模型 reviewer、升级和 fail-closed。
- `isolation_attestation.py`：完全访问可用性验证。
- `mode_transitions.py`：模式切换、降权、提权和 Run 继承规则。
- `explanations.py`：统一 reason code 和多语言展示数据。

新增设置/API：profile 列表、有效权限预览、会话选模、管理员策略、工作区默认值和隔离证明查询。

### 3.2 更新模块

- Desktop/WebUI 设置页和 Run 创建页：模式卡片、有效权限预览、风险说明和当前状态常驻标识。
- `agent_kernel.py`：仅消费 resolved profile，不从多个旧字段自行推断模式。
- P1 Policy/Reviewer 服务：按 profile 路由人工或自动 reviewer。
- Codex adapter：把 Codex 三档语义映射到统一 profile，但继续拒绝 Agent 自行请求 bypass/full-access。
- Android/OAEP：共享 mode ID、展示 schema、切换约束和 Approval 升级事件。
- 审计与遥测：记录选择来源、有效权限摘要、模式切换、auto-review 结果和隔离证明 ID。

### 3.3 移除与兼容

- 废弃散落的 `always/never/auto-conservative/auto-permissive`、`approval_policy=never`、`/dangerous on` 等用户可见控制；提供确定的旧值映射并提示迁移。
- 删除“名称相同但客户端语义不同”的本地枚举；所有客户端读取服务端 profile descriptor。
- 禁止把模式保存在仓库可执行配置中并自动生效；工作区只能建议，用户/管理员配置才有权选择。
- 完全访问不得静默回退为宿主裸执行；隔离不可用时降级需要用户明确选择其他模式。

## 4. 功能点、测试与验收

### P2-F01 三种 Profile 的稳定契约

功能：提供稳定 ID、版本、能力矩阵、reviewer 路由和 reason codes；各客户端只消费同一 descriptor。

测试：schema、向前/向后兼容、golden policy matrix；Desktop、WebUI、Android、OAEP、Codex adapter contract test。

验收：同一 Run 在任意客户端看到的模式、能力和限制一致；未知版本 fail closed 并提示升级。

### P2-F02 请求批准模式

功能：P0 边界默认开启；只读低风险操作无打扰，需副作用能力时由用户审批；批准一次严格绑定单一 Proposal。

测试：文件、shell、网络、MCP、委派、计划任务和外部写矩阵；批准、拒绝、超时、修改后重批和多 pending。

验收：用户未作决定时无副作用；拒绝后任务可继续寻找安全替代；Approval 卡片准确显示影响范围。

### P2-F03 帮我批准模式

功能：AutoReviewer 对允许自动处理的 Proposal 进行风险判定；输出 approve/deny/escalate；人工升级项始终弹给用户。

测试：

- 建立带期望结果的对抗语料，包括命令混淆、提示注入、数据外传、间接外部写、生产目标和秘密使用。
- 确定性规则 100% 覆盖强制升级项；模型离线评测统计误批、误拒和升级率。
- reviewer 超时、模型不可用、输出格式错误、版本回滚全部升级人工或拒绝，不得自动允许。

验收：硬禁止误批率为 0；强制人工类别误批率为 0；普通评测集达到安全评审设定阈值后才开放，阈值和数据版本进入发布证据；每次自动决定可解释、可审计、可复现到策略/模型版本。

### P2-F04 隔离完全访问模式

功能：只有 P0 `IsolationAttestation` 有效时可进入；隔离内允许广泛开发操作，宿主挂载、真实凭据和外部高价值目标仍显式授权。

测试：伪造/过期证明、Broker 降级、隔离启动失败、挂载变化、网络扩大和凭据请求；完整 P0 逃逸套件在此模式再次执行。

验收：隔离不可用时按钮禁用并解释原因；进入后有持续醒目标识；无宿主越界、无静默提权、会话结束按策略销毁或保留快照。

### P2-F05 有效权限预览与可解释 UI

功能：模式选择前展示可读/可写范围、网络、凭据、外部操作、人工升级项和硬禁止；Run 中常驻显示实际生效模式。

测试：UI snapshot、窄屏、键盘/读屏、中文/英文、超长路径和管理员限制；前端展示与后端 `/effective-permissions` 响应比对。

验收：用户能在选择前回答“能访问哪里、能否联网、谁来批准、哪些永远不允许”；UI 不把期望配置误报为已生效配置。

### P2-F06 安全的模式切换

功能：降权即时生效并撤销未消费 Grant；提权创建新 profile 版本、取消受影响 pending Request，并要求明确确认；子 Agent 不得继承更高权限。

测试：执行中切换、多个 pending、自动 reviewer 正在处理、断线重连、父子 Agent、后台任务和计划任务。

验收：不存在旧 Grant 在提/降权后越权执行；历史回执保留当时 profile；模式切换不可由 Agent 工具自行触发。

### P2-F07 工作区信任与默认模式

功能：新/不可信工作区固定从 `manual_safe` 最小能力开始；用户可设置受管理员约束的个人默认；完全访问不保存为跨工作区默认。

测试：仓库配置注入、复制/移动工作区、Git 来源变化、多人账户、设置同步和撤销信任。

验收：恶意仓库不能改变模式或 reviewer；信任与模式是两个独立、可撤销的选择。

### P2-F08 管理员与组织策略

功能：管理员可禁用模式、限制网络/凭据/目标、强制人工类别、锁定 auto-reviewer 版本和审计保留；下层只能收紧。

测试：策略优先级、签名/来源、离线缓存、撤销、冲突和旧客户端；随机组合证明用户配置不能扩大管理员上限。

验收：每个限制在 UI 有来源说明；策略不可用或验证失败时使用最后可信且不更宽的版本，否则 fail closed。

### P2-F09 旧配置迁移

功能：提供明确映射，例如保守 auto -> `auto_reviewed` 加更严格升级规则；`never`/dangerous 不直接映射为完全访问，而是要求重新选择和隔离检查。

测试：各历史版本配置、损坏值、同时存在多处配置、升级/回滚和用户选择保留。

验收：迁移绝不扩大权限；所有无法安全映射的值进入 `manual_safe` 并给出一次性说明。

### P2-F10 产品遥测、灰度和安全回滚

功能：收集不含秘密的模式采用率、人工升级率、auto-review 决策、撤销、事故和隔离失败；提供 feature flag 和 kill switch。

测试：遥测脱敏/低基数、开关传播、离线状态、kill switch 演练和回滚后 pending Request 处理。

验收：可单独关闭 AutoReviewer 或完全访问而不影响 `manual_safe`；关闭后未执行 Grant 失效；发布负责人可从证据面板判断是否扩大灰度。

## 5. 发布阶段与门禁

1. **内部阶段**：只开放 `manual_safe`，验证 profile/UI/跨端一致性。
2. **受控预览**：向内部测试开放 `auto_reviewed`，跑固定评测集和人工复核。
3. **隔离预览**：仅在有效 Windows 隔离证明设备开放 `isolated_full_access`。
4. **小流量灰度**：分别配置 AutoReviewer 和完全访问 kill switch，监控升级率与安全事件。
5. **正式发布**：旧开关只读迁移，文档和 UI 统一使用三种模式。

P2 完成门禁：P2-F01～F10 全部通过；P0、P1 无未解决高危问题；自动 reviewer 达到预先签字的误批门槛；完全访问在隔离失效时不可选择且不可执行；所有客户端对同一 profile 的行为通过统一 contract suite。

