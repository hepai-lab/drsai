# Desktop/TUI Agent 能力适配规格说明（SPEC）

状态：Draft
版本：1.0
日期：2026-08-21
适用范围：Windows Desktop、macOS Desktop、共享 Renderer、Python Runtime、TUI 兼容适配层

## 1. 文档目的

本规格定义 Desktop 吸收 TUI 与共享 Agent Core 更新时必须完成的高优先级和中高优先级适配。目标不是统一界面或强制统一传输协议，而是保证 Desktop 获得稳定、安全、可诊断的 Agent 能力，并防止 Desktop、TUI 和其他 Runtime surface 在模型、工具、审批及远程运行能力上发生无声漂移。

本规格覆盖四个能力域：

1. Desktop 工具审批闭环。
2. 跨 surface 的版本化 Agent capability contract 与一致性验证。
3. Desktop 原生模型配置、能力发现和故障诊断。
4. Desktop/TUI 可复用的远程 Gateway 底层服务，同时保留 Desktop 的安全与生命周期边界。

## 2. 背景与现状

Desktop 与 TUI 都通过 `run_drsai_agent_factory.create_agent()` 和 `DrSaiAssistant` 使用共享 Agent 实现，但外层运行路径不同：

```text
Desktop → Runtime HTTP/SSE Gateway → shared Agent Kernel → Desktop Host ports
TUI     → TUI JSON-RPC Gateway     → legacy AgentSession → DrSaiAssistant
```

Desktop 已使用 shared Agent Kernel，并具备 Workspace、Session、Run、Event Journal、审批和 Artifact 权威状态。TUI 当前仍保留 legacy executor，且拥有独立的 JSON-RPC、SSH remote 和模型编辑界面。因此，本规格以“共享领域语义与底层服务、保留 surface 适配器”为原则，不以复用 TUI UI 或迁移 Desktop 协议为前提。

当前主要风险如下：

- 同一个工具调用可能同时经过 Kernel 审批和 legacy operator 审批，造成重复确认或错误要求 Desktop 用户输入 TUI 的 `/dangerous on`。
- 模型、工具、Skills、Artifact、审批模式和并行上限虽来自共享代码，但没有一个可被各 surface 对照验证的完整、稳定合同。
- Desktop 模型选择与 Runtime 实际路由之间可能出现 provider、model alias、wire API、reasoning 或 capability 状态不一致。
- TUI 与 Desktop 各自实现远程 Gateway 安装、探测和连接逻辑，容易形成版本判断、恢复策略和安全策略漂移。

## 3. 术语

- **Surface**：使用 Agent Runtime 的产品表面，包括 `desktop`、`tui`、`android`、`worker`。
- **Host**：承载工具执行、审批、Artifact 和状态持久化的受信任 Runtime。
- **Capability Contract**：一次运行可用的模型、工具、Skills、审批、Artifact 和限制的版本化快照。
- **Exact-call approval**：绑定到规范化工具名、参数摘要、Run ID 和 call ID 的单次审批。
- **Approval proof**：Host 对 exact call 作出允许决定后，由 Kernel 生成、仅在受信任执行链内部传递的证明。
- **Remote Gateway Service**：不依赖 Desktop 或 TUI UI 的远程 Gateway 预检、安装、版本探测和健康检查服务。

## 4. 设计原则

1. Runtime Gateway 继续作为 Desktop Workspace、Session、Run、审批和事件的唯一权威来源。
2. Renderer 不得构造 approval proof、能力摘要、远程命令或凭据载荷。
3. Capability Contract 必须由 Runtime 根据实际解析后的模型、工具和策略生成，不能由 UI 声明。
4. 能力未知时 fail closed；仅展示缓存时必须明确标记 stale/offline，不能假装可执行。
5. 共享领域服务，保留 Desktop/TUI 各自的 transport 和 presentation adapter。
6. 审批必须 exactly once：同一 side effect 只允许一次有效授权和一次执行。
7. 所有版本、摘要和审计字段必须确定性生成，不能包含密钥、绝对用户路径或不稳定时间字段。

## 5. 范围

### 5.1 必须实现（高优先级）

- Kernel 到 Desktop Host port 的 exact-call approval proof。
- 拒绝、过期、取消、恢复和重复事件下的审批状态机。
- 版本化 Agent Capability Contract 及 Desktop/TUI parity verifier。
- Desktop provider-aware 模型选择、reasoning 配置、能力状态和可恢复错误展示。
- 自动化测试覆盖共享 Core 更新对 Desktop 的真实执行链。

### 5.2 应实现（中高优先级）

- 抽取 Remote Gateway Service，供 Desktop 和 TUI adapter 复用。
- 统一远程 Gateway 的版本探测、兼容性判断、安装计划、健康检查和诊断码。
- Desktop 继续执行 known-host 审核、显式安装审批、ControlMaster/隧道管理和 Remote Workspace 生命周期。

## 6. 总体架构

```text
                          Shared Python Runtime
┌───────────────┐    ┌────────────────────────────────────────────┐
│ Agent factory │───▶│ Capability Contract Builder + Agent Kernel │
└───────────────┘    └──────────────┬─────────────────────────────┘
                                    │ exact call / approval proof
                         ┌──────────▼──────────┐
                         │ Desktop Host Ports  │
                         └──────────┬──────────┘
                                    │ Runtime events / OAEP
                 ┌──────────────────▼──────────────────┐
                 │ Desktop HTTP/SSE Runtime Gateway    │
                 └─────────────────────────────────────┘

┌──────────────────────────────────────────────────────┐
│ Shared Remote Gateway Service                        │
│ preflight / plan / install driver / probe / diagnose │
└───────────────┬───────────────────────┬──────────────┘
                │                       │
       Desktop adapter            TUI JSON-RPC adapter
```

## 7. 功能规格 A：Desktop 工具审批闭环

### 7.1 目标

保证所有需要审批的 Desktop 工具调用只显示一次确认、只消费一次授权、只执行一次；拒绝后不得通过另一 shell、别名工具或 legacy `/dangerous` 机制重试。

### 7.2 输入

- `run_id`、`turn_id`、`call_id`。
- 规范化 `tool_id`、工具参数和风险分类。
- Capability Contract 的摘要。
- 用户决定：`approved | rejected | cancelled | expired`。
- 可选恢复状态：pending call、approval ledger、side-effect ledger。

### 7.3 输出

- `approval.requested` 和 `approval.decided` Runtime 事件。
- 仅在允许时生成内部 approval proof。
- 工具结果或结构化阻断结果。
- 审计记录和可恢复 checkpoint。

### 7.4 功能行为与业务规则

1. Kernel 在执行前按照 Capability Contract 判断工具是否需要审批。
2. 审批请求必须绑定：
   - `run_id`；
   - `call_id`；
   - canonical `tool_id`；
   - 规范化参数的 SHA-256；
   - capability contract SHA-256；
   - 风险等级和 side-effect domain。
3. Host 只有在审批状态为 `approved` 且上述绑定完全一致时，才能生成 approval proof。
4. proof 必须在 Kernel 内存态或受控 checkpoint 中产生；模型输出、Renderer IPC 输入和工具参数中的同名字段一律删除并忽略。
5. Desktop workbench 接收到有效 proof 后，legacy operator 层不得再次发起 `/dangerous` 或其他审批。
6. `rejected`、`cancelled`、`expired` 均为终止决定。Agent 可以解释结果或提供不执行的替代方案，但不得改用等价工具绕过。
7. 同一 `call_id` 的重复批准、迟到批准和重放事件必须幂等，不得导致第二次执行。
8. 批量调用包含审批工具时，必须拆分为可独立审批的 exact call；不得用一次批准覆盖异质 side effects。
9. 应用重启后，已批准但尚未证明执行完成的调用必须通过 side-effect ledger 判定：已开始则恢复观察，未开始则要求重新确认或按策略安全取消；不得静默重放。

### 7.5 接口与数据结构

```ts
type ApprovalDecision = "approved" | "rejected" | "cancelled" | "expired";

interface RuntimeApprovalRequestV1 {
  schema_version: 1;
  request_id: string;
  run_id: string;
  turn_id: string;
  call_id: string;
  tool_id: string;
  arguments_sha256: string;
  capability_snapshot_sha256: string;
  risk: "read_only" | "local_write" | "external_write" | "sensitive";
  side_effect_domain: string;
  summary: string;
}

interface RuntimeApprovalDecisionV1 {
  schema_version: 1;
  request_id: string;
  decision: ApprovalDecision;
  decided_at: string;
}
```

内部 approval proof 不对 Renderer 或公共 HTTP API 暴露。Python 内部载荷至少包含 `call_id`、两个摘要、决定和不可伪造的 Host generation；现有 `runtime_approval_granted: true` 只能作为受控内存对象中的执行标记，不能作为外部可接受证明。

### 7.6 边界条件与异常处理

- call 不存在或已结束：返回 `tool_call_not_pending`。
- 参数摘要变化：返回 `approval_binding_mismatch`，阻断执行。
- capability snapshot 变化：原审批失效，产生新请求。
- approval channel 不可用：Desktop fail closed，返回可恢复错误；不得沿用 TUI legacy 放行规则。
- 用户拒绝后模型重复同一调用：自动阻断并产生一次诊断事件，不重复打扰用户。
- proof 存在但 side-effect ledger 已完成：返回先前结果或 `already_completed`，不得再执行。

## 8. 功能规格 B：Agent Capability Contract

### 8.1 目标

为每个 Run 生成确定、可验证、可持久化的能力合同，使 Desktop 和 TUI 即使使用不同 transport，也能证明它们对共享 Agent Core 的模型和工具语义理解一致。

### 8.2 输入

- `surface` 和 Runtime/Kernel 版本。
- 解析后的 provider/model route。
- 可执行工具 schema 与执行元数据。
- Skills policy 与启用的 skill manifest。
- approval、Artifact、memory、citation、context budget 能力。
- tool loop、并行调用和 inline output 限制。

### 8.3 输出

- `AgentCapabilityContractV1`。
- canonical JSON SHA-256。
- 可展示的 capability diagnostics。
- Run、checkpoint 和事件中的 contract version/hash。

### 8.4 数据结构

```ts
interface AgentCapabilityContractV1 {
  schema_version: 1;
  contract_version: string;
  surface: "desktop" | "tui" | "android" | "worker";
  kernel: {
    id: string;
    version: string;
    sha256: string;
  };
  model: {
    provider_id: string;
    model_id: string;
    route_sha256: string;
    wire_api: "openai" | "anthropic" | "gemini";
    operations: string[];
    reasoning_efforts: string[];
    vision: boolean;
  };
  tools: {
    manifest_version: string;
    registry_sha256: string;
    entries: Array<{
      tool_id: string;
      schema_sha256: string;
      risk: string;
      approval_mode: "none" | "required";
      required_capabilities: string[];
    }>;
  };
  skills: {
    policy_revision: string;
    manifest_sha256: string;
  };
  host: {
    approval: boolean;
    artifacts: boolean;
    checkpointing: boolean;
    memory: boolean;
    citations: boolean;
  };
  limits: {
    max_tool_rounds: number;
    max_parallel_tool_calls: number;
    max_inline_tool_output_chars: number;
  };
  diagnostics: Array<{
    code: string;
    severity: "info" | "warning" | "error";
    message: string;
  }>;
  sha256: string;
}
```

### 8.5 功能行为与业务规则

1. 合同必须在模型路由、工具资源和 Skills policy 完成解析之后、第一次模型调用之前生成。
2. canonical JSON 使用固定字段、排序键、UTF-8 和无空白编码；`sha256` 自身不参与摘要。
3. 密钥、token、原始系统提示、绝对路径和用户输入不得进入合同。
4. 恢复 Run 时必须验证持久化合同；影响执行语义的变化必须阻止静默恢复并返回 `run_capability_snapshot_mismatch`。
5. Surface 差异必须显式体现在 `host` 或 `diagnostics` 中。TUI legacy 缺少 Desktop fail-closed 能力时不得伪装相同。
6. parity verifier 比较共享维度：kernel identity、model route、tool schema/risk、Skills manifest 和 limits。允许列表只能包含经过评审的 host/presentation 差异。
7. 合同 schema 只允许向后兼容地新增可选字段；删除、改名或改变既有字段语义必须升级 `schema_version`。

### 8.6 异常处理

- 未知模型能力：标记 error，禁止作为主 Agent 模型启动。
- 工具 schema 重名或摘要冲突：启动失败，错误为 `tool_registry_invalid`。
- 旧 checkpoint 无合同：仅允许通过显式迁移器恢复，并记录 degraded event。
- 不支持的 schema：拒绝恢复，不尝试猜测字段含义。

## 9. 功能规格 C：Desktop 模型配置与诊断

### 9.1 目标

让用户在 Desktop 中看到并选择 Runtime 实际可用的 provider-aware 模型、reasoning effort 和专项模型角色，并能理解不可用原因，而不是复制 TUI 的 YAML 编辑体验。

### 9.2 输入

- Runtime Model Catalog 与 revision。
- Agent Model Policy 与 expected revision。
- capability probe 状态和 provenance。
- Provider credential readiness。
- 当前 Workspace/Agent/Run 状态。

### 9.3 输出

- 可选择的主模型和角色模型列表。
- Provider、model、operation、reasoning 和状态展示。
- 原子更新的 Agent Model Policy。
- 结构化错误与恢复动作。

### 9.4 功能行为与业务规则

1. 模型身份必须使用 `(provider_id, model_id)`；alias 只能作为显示或兼容查找键。
2. 主模型只展示或启用支持完整 Agent primary runtime 的模型；当前已选但能力过期的模型可以展示，但必须明确不可重新选择。
3. reasoning effort 选项只能来自当前模型 capability；模型切换后，不兼容的 effort 必须清空或要求用户重新选择。
4. 保存使用 optimistic concurrency；revision 冲突时重新加载并提示用户复核，不得覆盖其他窗口更新。
5. 能力状态至少区分 `fresh | stale | offline | unauthorized | error | unknown`。
6. `stale` 数据可供展示，不得作为新增高风险能力的授权依据。
7. API key 只通过安全 credential service 写入，Renderer 不回读明文；日志和错误不得包含 key。
8. 保存成功只代表策略持久化成功；若当前 Session 不能热切换，UI 必须提示“新会话生效”。
9. Run 启动事件必须携带最终有效 model ref、reasoning effort 和 capability contract hash，供结果追踪。

### 9.5 边界条件与异常处理

- Provider 未认证：禁用选择或运行，提供“配置凭据”恢复动作。
- 模型从目录消失：保留只读引用并提示选择替代模型。
- capability probe 超时：保留最近缓存并标 stale；没有缓存则 fail closed。
- 保存后 Runtime 路由与选择不一致：Run 启动失败并报告 `model_route_snapshot_mismatch`。
- 不支持 vision 的模型收到图片：提交前阻断，或要求切换图像理解模型；不得静默丢弃图片。

## 10. 功能规格 D：共享 Remote Gateway Service

### 10.1 目标

统一 Desktop/TUI 的远程 Gateway 预检、版本判断、安装计划、健康探测和诊断语义，同时保留各 surface 的认证、审批、进程与 UI 管理。

### 10.2 服务边界

共享服务负责：

- 远程平台、架构、Python 和磁盘空间预检。
- 已安装 Gateway 的版本、协议和 capability contract 支持探测。
- 生成声明式安装/升级计划。
- 执行由 Host adapter 授权的安装步骤。
- 健康检查、兼容性判断和结构化诊断。

Desktop adapter 继续负责：

- SSH config 和 known-host 审核。
- 用户身份、密钥代理和 credential 边界。
- 安装/升级审批。
- ControlMaster、端口隧道、Remote Workspace 和窗口生命周期。

TUI adapter 继续负责 JSON-RPC 命令、终端展示和 attach 切换。

### 10.3 接口与数据结构

```ts
interface RemoteGatewayTargetV1 {
  host_id: string;
  platform?: string;
  arch?: string;
  requested_channel: "stable" | "preview";
}

interface RemoteGatewayPreflightV1 {
  schema_version: 1;
  reachable: boolean;
  platform: string;
  arch: string;
  python_version?: string;
  installed_version?: string;
  protocol_versions: string[];
  capability_contract_versions: number[];
  disk_free_bytes?: number;
  action: "none" | "install" | "upgrade" | "repair" | "unsupported";
  diagnostics: Array<{ code: string; severity: string; message: string }>;
}

interface RemoteGatewayPlanV1 {
  schema_version: 1;
  operation_id: string;
  target_version: string;
  artifact_sha256: string;
  steps: Array<{
    id: string;
    kind: "upload" | "verify" | "install" | "probe" | "rollback";
    mutating: boolean;
    timeout_ms: number;
  }>;
  requires_approval: boolean;
}
```

### 10.4 功能行为与业务规则

1. preflight 必须只读；不得安装包、修改 profile、杀进程或清理目录。
2. 安装计划必须固定目标版本和 artifact SHA-256，禁止执行浮动 `latest`。
3. Desktop 在任何 mutating step 前必须取得用户审批；TUI 也必须通过自身明确确认，不能因 legacy mode 自动放行。
4. 上传后必须在远端校验摘要，再执行安装。
5. 安装使用版本化目录和原子 active pointer；失败时回滚到最后已知健康版本。
6. 健康检查至少验证进程可达、协议版本、Runtime identity、capability contract schema 和最小只读调用。
7. 共享服务不得接受任意 shell 字符串。命令由平台 driver 以固定 executable 和参数数组构造。
8. 断线不等于卸载。重连应复用健康安装；只有显式清理操作才能删除受管版本。
9. Desktop 与 TUI 可以采用不同隧道实现，但必须消费相同 preflight/diagnostic schema。

### 10.5 边界条件与异常处理

- host key 变化：由 Desktop adapter 立即阻断，不能进入共享服务。
- 不支持的平台/架构：返回 `unsupported`，不尝试通用 shell 安装。
- 磁盘不足：计划不可执行，返回所需与可用字节数。
- 上传中断：保留或清理仅限 operation 临时目录，不影响 active 版本。
- 安装后 probe 失败：自动回滚并报告新旧版本和诊断码。
- 协议兼容但 capability schema 不兼容：连接状态为 incompatible，不启动 Agent Run。
- 多客户端并发安装：按 host + install root 加锁；后到请求读取当前 operation 状态。

## 11. 非功能要求

### 11.1 性能

- Capability Contract 构建 P95 小于 20 ms，10,000 个工具条目以内内存增量小于 20 MiB。
- Desktop 本地模型目录读取 P95 小于 200 ms；缓存命中 P95 小于 50 ms。
- 审批决定到已批准工具开始执行的本机额外开销 P95 小于 100 ms。
- Remote preflight 在网络可达时 P95 小于 5 秒，单项探测必须有独立超时，总时长不得无限延长。
- Renderer 不得因 capability probe、远程预检或摘要计算阻塞 UI 线程。

### 11.2 安全

- 所有审批默认 fail closed。
- approval proof 不得跨 Renderer IPC、公共 HTTP、模型上下文或日志传播。
- 模型 API key、SSH 私钥内容和远程 token 不得出现在 capability contract、遥测或错误文本。
- 远程命令使用参数数组和固定 driver；禁止 `shell: true` 和用户可控命令拼接。
- known-host 必须严格校验；首次信任和指纹变化需要独立审核。
- Artifact 和远程安装路径必须经过 canonical path 校验，禁止逃逸受管根目录。
- 审计记录必须包含 correlation/run/call/operation ID，但对用户输入和路径进行最小化与脱敏。

### 11.3 可靠性与可观测性

- 所有写操作具有 idempotency key 和 side-effect ledger。
- Runtime 重启后不得重复执行已开始或已完成的 side effect。
- 关键事件包含 contract hash、Kernel version 和 surface。
- 诊断码稳定、可检索，用户文案与内部异常分离。
- 缓存必须携带 revision、生成时间、来源和 freshness 状态。

### 11.4 兼容性

- Windows 和 macOS 共用 API 类型、Renderer 和 Python contract。
- 旧 TUI 在未迁移到 Runtime client 前继续工作，但必须明确报告 legacy host capability 差异。
- 新字段向后兼容；不识别的新 schema 必须拒绝，不能忽略关键安全字段。

## 12. 验收标准

### 12.1 审批闭环

- 一个需要审批的 Desktop shell/write 工具只出现一张确认卡。
- 批准后只执行一次，legacy operator 不再要求 `/dangerous on`。
- 拒绝、取消或过期后零 side effect，Agent 不通过别名工具绕过。
- 伪造 `runtime_approval_granted` 参数不能绕过审批。
- 重启、重复事件和迟到批准均不导致重复执行。

### 12.2 Capability Contract

- 相同解析输入产生逐字节相同 canonical JSON 和 SHA-256。
- Desktop Run 的模型、工具、Skills 和 limits 与实际执行对象一致。
- TUI/Desktop parity verifier 对共享维度通过，对允许的 host 差异给出明确报告。
- 修改工具 schema、risk 或模型路由后，旧 checkpoint 恢复被阻断。
- 合同、日志和事件不包含 secret 或绝对用户路径。

### 12.3 模型体验

- 用户可按 provider + model 唯一选择主模型和角色模型。
- UI 只提供模型支持的 reasoning effort。
- offline/stale/unauthorized/unknown 状态和恢复动作可区分。
- revision 冲突不会覆盖其他窗口的模型策略。
- Run 证据能追踪最终 provider、model、reasoning 和 contract hash。

### 12.4 Remote Gateway

- Desktop 与 TUI 对同一探测 fixture 得到一致的 preflight 和兼容性结论。
- preflight 全程只读。
- 安装固定版本并校验 SHA-256；失败后 active 版本保持或回滚健康。
- host key 变化、磁盘不足、不支持平台和 schema 不兼容均 fail closed。
- 并发安装只产生一个有效 operation。

## 13. 测试案例

| ID | 场景 | 前置条件 | 操作 | 期望结果 |
| --- | --- | --- | --- | --- |
| APR-01 | 单工具批准 | write 工具 pending | 点击允许 | 一次决定、一次执行、一次结果 |
| APR-02 | 单工具拒绝 | write 工具 pending | 点击拒绝 | 无执行；返回 cancelled 语义 |
| APR-03 | proof 伪造 | 模型参数含同名字段 | 提交调用 | 字段被删除，仍要求审批 |
| APR-04 | 参数篡改 | 批准后改变参数 | 执行 | `approval_binding_mismatch` |
| APR-05 | 双击允许 | pending approval | 快速点击两次 | 第二次幂等，无重复执行 |
| APR-06 | 重启恢复 | 批准后、执行完成前退出 | 重启 | ledger 决定恢复观察或重新确认，不静默重放 |
| APR-07 | 拒绝后绕过 | 拒绝 shell 调用 | 模型改用等价工具 | 自动阻断并记录诊断 |
| CAP-01 | 摘要确定性 | 固定输入 fixture | 重复构建 100 次 | JSON 与摘要完全一致 |
| CAP-02 | 工具漂移 | 改变一个 schema 字段 | 恢复 checkpoint | mismatch，运行不恢复 |
| CAP-03 | Surface parity | 相同模型和工具 | 比较 Desktop/TUI | 共享维度一致；host 差异在允许列表 |
| CAP-04 | Secret 扫描 | 含 API key 的 provider | 构建合同 | 合同与日志无 key |
| CAP-05 | Legacy checkpoint | 无合同的旧状态 | 恢复 | 显式迁移或拒绝并记录 degraded |
| MOD-01 | Provider 重名模型 | 两 provider 同 model ID | 展开选择器 | 两项独立且标签明确 |
| MOD-02 | Reasoning 收敛 | 从 high-capable 切到无 reasoning 模型 | 保存 | effort 被清空/要求重选 |
| MOD-03 | stale cache | probe 超时且有缓存 | 打开设置 | 展示 stale，不授予新能力 |
| MOD-04 | 并发保存 | 两窗口同 revision | 依次保存 | 后者收到 conflict，不覆盖 |
| MOD-05 | 图片能力 | 当前模型无 vision | 添加图片并发送 | 提交前阻断并给出恢复动作 |
| REM-01 | 只读预检 | 可达 SSH fixture | preflight | 远端文件和进程无变化 |
| REM-02 | 摘要错误 | 上传包摘要不符 | 安装 | 安装前终止，active 不变 |
| REM-03 | 安装回滚 | 新版本 probe 失败 | 执行计划 | 回滚旧版本并报告诊断 |
| REM-04 | Host key 变化 | known-host 已记录 | 连接 | Desktop adapter 阻断 |
| REM-05 | 并发安装 | 两客户端同 host | 同时安装 | 一个 operation，另一方订阅状态 |
| REM-06 | Schema 不兼容 | 远端仅支持未知 contract schema | 连接 | incompatible，不启动 Run |

测试层级必须包括：

1. Python 单元测试：Kernel、contract builder、审批绑定、remote service。
2. TypeScript 单元测试：模型选项、状态映射、IPC 数据验证。
3. Python/Node 合同测试：canonical JSON、schema 和诊断码一致。
4. Desktop 集成测试：真实 Runtime fake tool、确认卡、拒绝与重启恢复。
5. TUI/Desktop parity 测试：同一 fixture 经两个 adapter 后比较共享维度。
6. Packaged smoke：Windows 和 macOS 至少覆盖模型选择、一次审批和 remote preflight。

## 14. 交付阶段

### 阶段 P0：冻结合同与回归基线

- 固化审批 request/decision、Capability Contract 和 Remote preflight schema。
- 为当前 shared Core 与 Desktop 执行链建立 fixture。
- 将现有审批 proof 修复纳入正式测试，不再依赖源码文本断言。

### 阶段 P1：审批闭环

- 完成 Host 生成 proof、参数绑定、side-effect 幂等和拒绝后防绕过。
- 完成 Renderer 一次确认体验和重启恢复测试。

### 阶段 P2：能力合同与模型体验

- 接入 Run 创建、checkpoint、事件和诊断。
- 完成 Desktop provider-aware 模型、reasoning、freshness 和 revision conflict UI。
- 上线 parity verifier 作为合并门禁。

### 阶段 P3：远程底层服务

- 从两端适配器抽取 preflight/plan/probe/diagnostics。
- Desktop 保留安全边界并接入共享 schema。
- 完成版本固定、摘要验证、回滚和并发锁。

## 15. 完成定义

只有同时满足以下条件，才能将本 SPEC 标记为完成：

- 第 12 节所有验收标准通过。
- 第 13 节所有高风险案例 `APR-*`、`CAP-02/04`、`MOD-04/05`、`REM-02/03/04/06` 有自动化证据。
- Windows 和 macOS packaged smoke 通过；若平台能力不同，差异已在 contract diagnostics 中声明。
- Desktop/TUI parity verifier 进入 CI，并对共享 Core、Agent factory、Assistant、工具元数据或模型路由变更强制运行。
- 安全评审确认 Renderer 无 approval proof、模型密钥和 SSH 私钥内容。
- 运维文档包含稳定诊断码和恢复动作。

## 16. 明确不做什么

- 不把 Desktop 迁移到 `tui_gateway` JSON-RPC，也不以此作为本规格前置条件。
- 不让 TUI legacy AgentSession 成为 Desktop Runtime 权威状态。
- 不复制 TUI Ink 组件、streaming 绘制或键盘交互到 Desktop。
- 不在 Desktop 提供 `/dangerous on`；Desktop 高风险操作始终使用原生确认卡。
- 不要求 Desktop 与 TUI 使用相同 SSH 隧道或进程管理实现。
- 不允许 TUI 的 legacy “缺少审批 handler 时兼容放行”规则进入 Desktop。
- 不在 Renderer 直接编辑 `llm_mode_config.yaml`、读取 API key 或执行远程命令。
- 不在本规格中统一所有聊天历史、Session 或 OAEP transport；这些属于 Runtime 统一方案。
- 不新增任意 shell 形式的远程安装接口。
- 不通过放宽 Desktop fail-closed 策略来制造表面 parity。

## 17. 与既有方案的关系

- 本规格补充 `docs/desktop-tui-runtime-unification-plan.md`，不替代其 Session/Runtime 权威统一目标。
- 模型数据结构应复用现有 Runtime Model Catalog 和 Agent Model Policy，不建立第三套模型目录。
- Remote Gateway 应复用现有 Desktop `RemoteGatewayPreflight`、安装审批和 SSH Host Service，并将可共享逻辑下沉，不推翻现有 Desktop 安全实现。
- Capability Contract 应建立在现有 `build_run_capability_snapshot()`、工具 registry、model route snapshot 和 Kernel identity 上扩展，而不是并行复制摘要算法。
