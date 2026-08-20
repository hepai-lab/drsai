# OpenDrSai Codex Adapter OAEP P10-C：多版本协议兼容与能力协商规格说明

文档类型：软件规格说明（SPEC）  
状态：待实施  
制定日期：2026-08-21  
阶段标识：P10-C（P10 Compatibility）  
适用产品：OpenDrSai Desktop、OpenDrSai Full Agent Runtime、Codex Adapter  
首要平台：Windows 本地 Desktop + 本地 Codex App Server  
后续平台：远程 Linux Codex App Server，复用相同协议判定，仅替换 Transport  
上游基线：

- `OpenDrSaiCodexAdapter_OAEP_P10语义完整性与用户可信交互收敛开发方案.md`
- `OpenDrSaiCodexAdapter_OAEP_P10修订版_运行稳定性与用户可恢复性开发方案.md`
- `cores/protocol/codex-app-server-stable-contract.json` Contract v6
- OAEP 1.0 与现有 Agent Backend SPI

> P10-C 是 P10 的多版本兼容专项，不创建第二套 Adapter，不改变 Desktop → Runtime → Agent Backend → Codex Adapter → Codex App Server 的既有架构。P10-C 解决的是“如何在保持安全、语义完整和可诊断的前提下兼容多个 Codex App Server 版本”，不是无条件接受任意版本。

## 1. 规范用语

本文使用以下规范性关键词：

- **必须（MUST）**：实现和发布验收不可省略。
- **禁止（MUST NOT）**：任何实现均不得出现。
- **应该（SHOULD）**：除非有记录充分的技术原因，否则必须实现。
- **可以（MAY）**：可选能力，不影响本阶段退出。

文中的“Codex 版本”指 Codex CLI/App Server 报告的协议实现版本，不指 Codex Desktop 商店包的营销版本；“Schema”指 `codex app-server generate-json-schema` 导出的 App Server 协议 Schema；“必需协议子集”指 OpenDrSai 当前实际调用、映射和依赖的请求、通知、字段、枚举及终态语义。

## 2. 背景与问题定义

### 2.1 当前事实

截至 2026-08-21：

- 本机 Codex Desktop 内置 CLI 报告 `codex-cli 0.148.0-alpha.15`。
- OpenDrSai Stable Contract 基线是 `0.147.0-alpha.6.6`。
- 当前审核名单包含 `0.142.5`、`0.144.5`、`0.146.0-alpha.9.2`、`0.147.0-alpha.1.2`，并以 `0.147.0-alpha.6.6` 为精确基线。
- `compatibility_for_version()` 对名单外版本直接返回 `blocked`。
- Windows Codex Desktop 的未知版本无法从 `REVIEWED_SCHEMA_SHA256` 取得 Schema 摘要，因此 `compatibility_for_identity()` 也直接返回 `blocked`。
- Desktop 把 Contract `blocked` 映射为“当前 Codex 版本与 OpenDrSai 不兼容”，并提供“更新 Codex”动作；当 Codex 比 Adapter 更新时，该动作方向错误。

### 2.2 根因

当前实现把三个不同概念合并成了一个结果：

1. 版本尚未审核；
2. 协议身份无法证明；
3. 协议确实破坏性不兼容。

这导致新增但向后兼容的 Codex 版本被整体禁用，也导致用户无法判断应该更新 OpenDrSai、切换 Codex，还是仅等待自动检查完成。

### 2.3 本阶段判断

严格契约边界必须保留，但兼容单位必须从“完整版本号白名单”升级为“可信二进制身份 + Schema 身份 + 必需协议子集 + 初始化能力 + 运行期守卫”。未知版本不等于不兼容；未证明兼容也不等于可以无条件执行。

## 3. 总体目标

P10-C 必须实现以下目标：

1. 同一个 Codex Adapter 能安全支持多个已审核 Codex App Server 版本。
2. 对新版本执行确定性的 Schema 获取、规范化、差异分析和能力协商。
3. 区分 `exact`、`reviewed_compatible`、`capability_compatible`、`blocked`、`unknown` 五种状态。
4. 仅当 OpenDrSai 必需协议子集保持兼容时允许新版本运行。
5. 新增字段、新增可忽略通知等加法变化不得无理由阻断整个 Backend。
6. 方法移除、必填参数变化、终态语义变化、请求方向变化等破坏性变化必须阻断执行。
7. Desktop 必须向普通用户说明“是否可用、为什么、系统在做什么、唯一推荐动作”，不得仅显示泛化 fault。
8. Codex 原生协议兼容逻辑必须留在 Codex Adapter；OAEP Runtime 和通用 UI 不得依赖具体 Codex 版本。
9. 本地与未来远程 Codex 使用同一兼容判定和缓存格式。
10. 当前 `0.148.0-alpha.15` 必须作为首个 P10-C 真实版本完成 Schema 审核和端到端验收。

## 4. 范围与总体架构

### 4.1 保留架构

```text
OpenDrSai Desktop
  └─ Runtime Client
      └─ Gateway / Runtime Engine
          └─ Agent Backend SPI
              └─ Codex Adapter
                  ├─ Binary Identity Provider
                  ├─ Schema Acquisition + Canonicalization
                  ├─ Compatibility Analyzer + Policy
                  ├─ JSON-RPC Initialize Negotiation
                  ├─ Native Decoder + OAEP Mapper
                  ├─ Runtime Protocol Guards
                  └─ Local/Remote Supervisor
                      └─ Codex App Server
```

### 4.2 兼容判定流水线

```text
发现可信 Codex 二进制
  → 获取 CLI 版本和二进制摘要
  → 获取或命中缓存的 Schema
  → Schema 规范化并计算摘要
  → 与必需协议子集做语义差异分析
  → 启动 App Server 并执行 initialize
  → 核对运行期能力与声明身份
  → 生成 CompatibilityDecision
  → 允许、降级允许或阻断
  → 持续执行运行期事件守卫
```

### 4.3 模块边界

- Desktop 只读取后端中立 Readiness、兼容状态和用户动作，不读取 Codex Schema。
- Gateway 只传递 Agent Backend capability，不自行判断 Codex 版本。
- Codex Adapter 是 Codex 版本、Schema、方法、通知和字段差异的唯一权威解释者。
- Stable Contract Manifest 是已审核契约和必需子集的唯一可编辑协议源。
- 生成文件不得手工维护。
- OAEP Mapper 只接收已经通过 Native Decoder 和协议守卫的标准化事件。

## 5. 输入与输出

### 5.1 输入

兼容判定必须接受以下输入：

| 输入 | 必需 | 来源 | 说明 |
| --- | --- | --- | --- |
| `binary_path` | 是 | Binary Provider | 本地或远程 Supervisor 最终选中的真实二进制 |
| `binary_source` | 是 | Binary Provider | `managed`、`codex-desktop`、`development`、`remote-managed` |
| `binary_digest` | 发布模式是 | SHA-256 | 证明实际启动字节身份 |
| `reported_version` | 是 | `codex --version` | 必须符合受限版本格式 |
| `schema_bundle` | 是，除受控缓存命中 | `generate-json-schema` 或受信制品 | 原始 Schema 文件集合 |
| `schema_digest` | 是 | Canonicalizer | 规范化 Schema 的整体摘要 |
| `initialize_result` | 是 | JSON-RPC | App Server 初始化结果和能力声明 |
| `contract_manifest` | 是 | Stable Contract | 必需方法、字段、通知和策略 |
| `adapter_mapping_version` | 是 | Adapter | Native → OAEP 映射版本 |
| `execution_mode` | 是 | Runtime | `product` 或 `development` |
| `transport_identity` | 是 | Supervisor | 本地进程或远程主机身份，不得参与语义放宽 |

### 5.2 输出

兼容判定必须输出单一、可序列化的 `CompatibilityDecision`，至少包含：

```json
{
  "state": "exact | reviewed_compatible | capability_compatible | blocked | unknown",
  "executable": true,
  "reason": null,
  "reported_version": "0.148.0-alpha.15",
  "baseline_version": "0.147.0-alpha.6.6",
  "binary_digest": "sha256:...",
  "schema_digest": "sha256:...",
  "contract_version": 7,
  "mapping_version": "...",
  "required_surface_digest": "sha256:...",
  "checked_at": "2026-08-21T00:00:00Z",
  "cache": {"hit": false, "expires_at": "..."},
  "changes": {
    "compatible_additions": [],
    "warnings": [],
    "blocking": []
  },
  "feature_gates": {},
  "recommended_action": "none | update_opendrsai | switch_codex | retry_check | view_diagnostics"
}
```

规则：

- `executable=true` 仅允许出现在 `exact`、`reviewed_compatible`、`capability_compatible`。
- `blocked` 必须至少有一个结构化 `blocking` 差异和稳定错误码。
- `unknown` 表示检查未完成或证据不足，不得伪装成“不兼容”。
- 对外结果不得泄露敏感绝对路径、认证信息、提示内容或命令输出；诊断视图可以显示脱敏版本和摘要。

### 5.3 Schema 差异输出

每一项差异必须包含：

```ts
type ProtocolDifference = {
  kind:
    | "method_added" | "method_removed"
    | "parameter_added_optional" | "parameter_added_required" | "parameter_removed"
    | "field_added_optional" | "field_added_required" | "field_removed" | "field_type_changed"
    | "enum_value_added" | "enum_value_removed"
    | "notification_added" | "notification_removed"
    | "request_direction_changed" | "terminal_semantics_changed"
    | "schema_unreadable" | "identity_mismatch";
  path: string;
  severity: "info" | "warning" | "blocking";
  requiredByOpenDrSai: boolean;
  rationale: string;
};
```

## 6. 功能行为与业务规则

### 6.1 二进制发现与身份

1. 产品模式必须只选择受信的 Managed Artifact 或通过 OpenAI Authenticode 验证的 Codex Desktop 二进制。
2. 禁止执行 WindowsApps execution alias；必须使用可执行的真实 Codex Desktop CLI 路径。
3. 开发模式可以通过 `CODEX_BIN` 指定二进制，但状态必须标记为 `development`，不得生成发布兼容证据。
4. 版本、二进制摘要、Schema 摘要和实际启动实例必须属于同一身份记录。
5. 二进制在检查后发生变化时，已有兼容缓存立即失效。

### 6.2 Schema 获取

1. 优先使用受信制品随附且摘要已签名的 Schema。
2. Codex Desktop 二进制必须通过受控子进程执行 `app-server generate-json-schema --out <temporary-directory>`。
3. Schema 导出必须设置超时、输出大小、文件数量和目录逃逸限制。
4. Schema 只能写入 OpenDrSai 管理的临时或状态目录，不得写入用户工作区。
5. 原始 Schema 可以作为开发/审核证据进入 `cores/protocol/codex-app-server/<version>`；运行期只持久化规范化摘要、必需差异和最小缓存，不复制无界文件。
6. 导出失败时状态为 `unknown/schema_export_failed`，在重试预算耗尽前不得显示“版本不兼容”。

### 6.3 Schema 规范化

规范化必须：

- 使用 UTF-8；
- 对对象键稳定排序；
- 对无语义顺序的文件和定义稳定排序；
- 保留数组、联合类型和枚举的协议语义；
- 排除生成时间、绝对路径等非协议元数据；
- 生成完整 Schema 摘要和必需协议子集摘要；
- 在 Windows、本地 Linux 和 CI 上对相同输入生成相同摘要。

### 6.4 必需协议子集

Stable Contract 必须明确列出：

- OpenDrSai 调用的 Client Methods；
- 每个方法的必填参数、可选参数和允许发送参数；
- App Server 可能发起且 OpenDrSai 支持的 Server Requests；
- 语义通知、用户通知、诊断通知、已知忽略通知和致命通知；
- Thread、Turn、Item、Approval、Account、Model 的必需字段；
- `turn/started`、`turn/completed`、错误、取消和进程退出的终态规则；
- Native Item → OAEP Item 的覆盖关系；
- 每项能力的 feature gate 和缺失时的降级规则。

### 6.5 差异分类规则

以下变化默认兼容：

- 新增 OpenDrSai 不发送的可选请求参数；
- 新增 OpenDrSai 不依赖的可选响应字段；
- 新增可安全记录并忽略的诊断或通知；
- 枚举新增值且 Decoder 有明确 `unknown` 分支；
- 新增 OpenDrSai 未启用的方法。

以下变化默认阻断：

- 移除 OpenDrSai 必需方法或通知；
- 新增 OpenDrSai 调用方法的必填参数；
- 移除或改变 OpenDrSai 依赖字段的类型；
- Client Request 与 Server Request 方向变化；
- Run/Turn 完成、失败、取消语义变化；
- Approval 默认从“拒绝未知”变为可能自动允许；
- 无法证明实际 Schema 与被分析 Schema 属于同一二进制；
- OAEP 必需语义无法由新协议表达。

可能降级的变化必须绑定 feature gate。例如某个非核心 Item 类型消失时，可以禁用对应 UI 能力，但不得伪造该 Item；核心消息、Run 终态、Session/Thread 和审批不可降级缺失。

### 6.6 兼容状态决策

| 状态 | 条件 | 是否可执行 | 用户表达 |
| --- | --- | --- | --- |
| `exact` | 版本、二进制/Schema 身份和基线完全匹配 | 是 | 已连接 |
| `reviewed_compatible` | 命中仓库审核版本及摘要，相关测试通过 | 是 | 已连接 |
| `capability_compatible` | 未登记新版本，但可信 Schema 的必需子集兼容，initialize 成功，运行守卫可用 | 是 | 已连接；诊断中提示兼容模式 |
| `blocked` | 存在破坏性差异或身份不匹配 | 否 | 需要更新 OpenDrSai或切换 Codex |
| `unknown` | 正在检查、导出失败、超时或证据不足 | 否，保留历史只读 | 正在检查或暂时无法确认，可重试 |

`capability_compatible` 不得自动升级为 `reviewed_compatible`；只有 Schema 快照、差异审查和规定测试进入版本库后才能成为已审核版本。

### 6.7 Initialize 能力协商

1. Schema 静态兼容后必须实际启动 App Server 并完成 `initialize`/`initialized`。
2. Adapter 必须发送稳定的 clientInfo 和最小能力声明，禁止把未知实验能力默认开启。
3. initialize 返回的能力与 Schema 分析冲突时，运行期声明优先收紧，不得放宽。
4. initialize 未声明但实际必需的核心能力必须通过最小无副作用探测确认，或阻断使用。
5. 协商结果必须进入 `CompatibilityDecision.feature_gates`。

### 6.8 运行期协议守卫

1. 所有出站方法和参数必须继续经过 Stable Contract 校验。
2. 已知兼容的新可选字段可以保留在原始诊断中，但不得未经 Decoder 直接进入 OAEP。
3. 未知通知默认进入有界诊断通道；禁止因此杀死健康连接。
4. 未知 Server Request 必须默认拒绝并返回协议允许的错误，禁止自动批准。
5. 未知终态、关键 Item 或改变安全含义的事件必须结束当前 Run 为明确失败，并将 Backend 标记为需要兼容性复核。
6. 单个未知非关键事件不得让整个 Backend 永久 fault。

### 6.9 缓存与重新验证

缓存键必须至少包含：

```text
binary_digest + reported_version + schema_digest + contract_version + mapping_version
```

规则：

- 任一键变化必须重新验证。
- `exact` 和 `reviewed_compatible` 可以持久缓存；`capability_compatible` 必须设置有限有效期并在进程重启或版本变化时复核。
- `blocked` 可以短期缓存，但用户主动重试、OpenDrSai 更新或 Codex 更新后必须立即失效。
- `unknown` 不得长期缓存。
- 本地与远程缓存不可仅按版本号共享。

### 6.10 用户界面行为

Desktop 必须区分：

- 正在读取 Codex 能力；
- 已连接；
- 以兼容模式连接；
- 暂时无法确认兼容性；
- 确认不兼容；
- Codex 未安装；
- Codex 需要登录；
- Runtime/App Server 连接异常。

用户动作规则：

- Codex 比 Adapter 更新且被阻断：主动作“更新 OpenDrSai”，次动作“查看兼容详情”。
- Codex 比最低支持版本更旧：主动作“更新 Codex”。
- Schema 检查超时：主动作“重新检查”，不得建议更新软件。
- 身份不匹配：主动作“修复或重新安装 Codex”，并显示安全说明。
- `capability_compatible`：不打断发送；普通界面只显示已连接，兼容模式详情放入设置/诊断。
- 所有状态下历史会话保持可浏览；只有执行能力受限。

## 7. 接口与数据结构

### 7.1 Stable Contract Manifest v7

`cores/protocol/codex-app-server-stable-contract.json` 必须升级为 Contract v7，并新增：

```json
{
  "compatibilityPolicy": {
    "requiredSurfaceVersion": 1,
    "allowCapabilityCompatible": true,
    "unknownNotificationPolicy": "diagnostic",
    "unknownServerRequestPolicy": "deny",
    "unknownTerminalPolicy": "block_run"
  },
  "requiredSurface": {
    "methods": {},
    "serverRequests": {},
    "notifications": {},
    "entities": {},
    "terminalSemantics": {}
  },
  "reviewedVersions": {
    "0.148.0-alpha.15": {
      "schemaDigest": "sha256:...",
      "requiredSurfaceDigest": "sha256:...",
      "mappingVersion": "...",
      "evidence": "..."
    }
  }
}
```

旧字段在一次迁移窗口内可以保留用于生成器兼容，但不得存在两套互相独立的审核事实源。

### 7.2 Python 内部接口

建议新增以下边界：

```python
class CodexSchemaProvider(Protocol):
    async def acquire(self, binary: CodexBinary) -> CodexSchemaBundle: ...

class CodexSchemaCanonicalizer:
    def canonicalize(self, bundle: CodexSchemaBundle) -> CanonicalCodexSchema: ...

class CodexCompatibilityAnalyzer:
    def analyze(
        self,
        identity: CodexBinaryIdentity,
        schema: CanonicalCodexSchema,
        contract: StableContract,
    ) -> CompatibilityDecision: ...

class CodexCompatibilityService:
    async def evaluate(self, binary: CodexBinary, *, force: bool = False) -> CompatibilityDecision: ...
```

`CodexAgentBackendClient` 只消费最终 Decision，不自行重复版本判断。必须移除 `execute_turn()`、`model_catalog()`、`health()` 中各自独立且不一致的版本判断。

### 7.3 Runtime Capability 输出

Agent Backend capability 应新增或规范化：

```ts
type BackendContractCapability = {
  state: "ready" | "compatible" | "checking" | "blocked" | "unknown";
  compatibility: "exact" | "reviewed_compatible" | "capability_compatible" | "blocked" | "unknown";
  actual_version?: string;
  baseline_version?: string;
  schema_digest?: string;
  required_surface_digest?: string;
  reason?: string;
  retryable: boolean;
  actions: Array<"retry_check" | "update_opendrsai" | "update_codex" | "switch_codex" | "view_diagnostics">;
};
```

Gateway 必须透明传递该对象；Desktop 负责用户文案，不得反向推断版本相对新旧。

### 7.4 稳定错误码

| 错误码 | 含义 | 可重试 |
| --- | --- | --- |
| `codex_contract_check_pending` | 检查尚未完成 | 是 |
| `codex_schema_export_failed` | Schema 导出失败 | 是 |
| `codex_schema_invalid` | Schema 不可解析或超限 | 视原因 |
| `codex_contract_identity_mismatch` | 二进制、版本和 Schema 身份不一致 | 否 |
| `codex_contract_required_surface_missing` | 必需协议成员缺失 | 否 |
| `codex_contract_breaking_change` | 存在破坏性变化 | 否 |
| `codex_contract_incompatible` | 对旧客户端保留的汇总错误 | 否 |
| `codex_contract_runtime_violation` | 运行期出现关键未审核语义 | 否，需升级 Adapter |

错误 detail 必须包含脱敏后的实际版本、基线版本、差异类别和推荐动作；禁止包含绝对二进制路径、用户提示、认证数据或完整命令输出。

## 8. 需要实现、更新或移除的模块

### M01：Stable Contract v7 与必需协议子集

需要更新：

- `cores/protocol/codex-app-server-stable-contract.json`
- Contract generator、verifier 和生成绑定
- `test_codex_stable_contract.py`

功能点：

- M01-F01：建立唯一 `requiredSurface` 定义。
- M01-F02：把版本数组升级为包含摘要、Mapping 和证据的版本记录。
- M01-F03：生成必需子集摘要。
- M01-F04：生成器漂移检查和旧字段迁移。

### M02：Schema 获取与规范化

建议新增：

- `schema_provider.py`
- `schema_canonicalizer.py`
- 对现有 `export_codex_app_server_schema.py` 做安全化和可测试化更新

功能点：

- M02-F01：Managed Artifact Schema 获取。
- M02-F02：Codex Desktop `generate-json-schema` 受控导出。
- M02-F03：跨平台确定性规范化和摘要。
- M02-F04：超时、大小、文件数、目录逃逸和清理。
- M02-F05：按二进制身份缓存。

### M03：兼容分析器与决策服务

建议新增：

- `compatibility_analyzer.py`
- `compatibility_service.py`
- `compatibility_models.py`

功能点：

- M03-F01：五态兼容决策。
- M03-F02：加法、破坏性和可降级差异分类。
- M03-F03：结构化 Decision 和 Difference。
- M03-F04：缓存、失效和强制复核。
- M03-F05：实际版本与基线新旧方向判断。

### M04：Initialize 协商与运行期守卫

需要更新：

- `jsonrpc_client.py`
- `native_decoder.py`
- `event_mapper.py`
- `security.py`
- `run_finalizer.py`

功能点：

- M04-F01：静态检查后完成 initialize 能力交叉验证。
- M04-F02：未知普通通知进入有界诊断。
- M04-F03：未知 Server Request 默认拒绝。
- M04-F04：未知关键终态/安全语义阻断当前 Run。
- M04-F05：feature gate 控制可选 Item 映射。

### M05：Backend Client 单一兼容入口

需要更新：

- `backend_client.py`
- `adapter.py`
- `factory.py`
- `binary_provider.py`

功能点：

- M05-F01：Factory 注入 Compatibility Service。
- M05-F02：`health()`、`execute_turn()`、`model_catalog()` 共享同一 Decision。
- M05-F03：移除分散的版本号白名单判断。
- M05-F04：历史只读与执行能力分离。
- M05-F05：二进制更新后自动失效并重新检查。

### M06：Runtime/Gateway 能力契约

需要更新：

- Agent Backend capability DTO
- `gateway.py` 对应接口与错误映射
- Runtime Client 类型定义

功能点：

- M06-F01：透传五态兼容性和推荐动作。
- M06-F02：`checking` 不得映射为 fault。
- M06-F03：Runtime、Transport、Contract、Account、Models 状态保持独立。
- M06-F04：兼容状态变化通过现有状态通道增量通知。

### M07：Desktop 用户状态与诊断

需要更新：

- `apps/desktop/shared/main/codexBackendStatus.ts`
- `CodexIntegrationSettings.tsx`
- 相关 Desktop API 类型与状态文案

功能点：

- M07-F01：显示检查中、兼容模式、已阻断和未知。
- M07-F02：根据推荐动作显示“更新 OpenDrSai”或“更新 Codex”。
- M07-F03：兼容详情显示版本、基线、检查时间、差异摘要，不泄露路径。
- M07-F04：兼容检查期间保持历史只读和输入草稿。
- M07-F05：状态稳定化，避免轮询造成连接/不兼容闪烁。

### M08：0.148.0-alpha.15 审核与发布证据

需要新增或更新：

- `cores/protocol/codex-app-server/0.148.0-alpha.15/`
- Stable Contract reviewed version 记录
- P10-C feature ledger、测试脚本和真实运行证据

功能点：

- M08-F01：从本机可信 Codex 导出原始 Schema。
- M08-F02：生成基线差异报告。
- M08-F03：补齐 Decoder、Mapper、Approval 和终态变化。
- M08-F04：完成单轮、多轮同线程、历史同步、流式输出、取消、审批和恢复验收。
- M08-F05：证明实际二进制、Schema、测试和运行实例身份一致。

### M09：移除内容

必须移除：

1. “版本不在数组中立即全局 blocked”的唯一判断方式。
2. `backend_client.py` 多个入口各自执行不同兼容检查。
3. 未知版本自动显示“更新 Codex”的 UI 推断。
4. 把 Schema 获取超时显示成确定不兼容。
5. 同版本无 Schema 身份仍可进入发布执行路径的退化逻辑。
6. 未知普通通知导致连接永久 fault 的处理。
7. 仅凭源码字符串或名单存在性宣称某版本兼容的验收方式。

## 9. 边界条件与异常处理

| 场景 | 规定行为 |
| --- | --- |
| `codex --version` 无输出或格式未知 | `unknown/version_unreadable`，有限重试，不执行 Turn |
| Schema 导出超时 | 终止子进程、清理临时目录、`unknown`，允许手动重试 |
| Schema 超过大小/文件限制 | `blocked/schema_limit_exceeded`，记录计数，不读取剩余内容 |
| Schema 包含目录逃逸或链接 | 立即拒绝，标记安全错误 |
| 二进制检查后被替换 | 摘要变化，缓存失效，当前未开始 Run 禁止启动 |
| initialize 与 Schema 声明冲突 | 采用更严格结果，禁止放宽 |
| 新增未知可选通知 | 有界诊断并继续 |
| 未知 Server Request | 默认拒绝并继续；若无法安全回应则终止连接 |
| 未知 Turn 终态 | 当前 Run 明确失败，Backend 进入兼容复核状态 |
| 网络/远程传输断开 | 保留最后可信 Decision；Transport 独立恢复，不伪报 Contract blocked |
| Contract 在运行期间升级 | 新 Run 使用新 Contract；正在运行的 Run 固定原 Decision，除非发现安全违规 |
| 多个 Codex 版本并存 | 每个实际二进制独立身份、缓存和 Decision |
| 缓存损坏 | 丢弃并重新计算，不阻止历史只读 |
| 系统时钟回拨 | 缓存 TTL 不得无限延长，应结合单调时钟或启动代次 |
| 用户快速重复刷新 | Singleflight 合并同一身份检查，只执行一次 Schema 导出 |

## 10. 非功能要求

### 10.1 性能

1. 已审核版本且缓存命中时，兼容判定 P95 必须小于 100 ms，不含首次进程启动。
2. 同一二进制的并发兼容检查必须 Singleflight，Schema 导出次数为 1。
3. 首次 Schema 导出和分析在标准开发机上 P95 应小于 5 秒，硬超时不得超过 15 秒。
4. Schema 规范化不得阻塞 Gateway 主事件循环；CPU/文件工作应在线程或受控工作进程执行。
5. 状态轮询不得重复导出 Schema，不得反复启动 App Server。
6. 未知通知诊断队列必须有界；达到上限时聚合计数，禁止无限内存增长。

### 10.2 可靠性

1. 兼容检查、健康检查和账户检查必须是独立状态，任一短暂失败不得污染其他状态。
2. Decision 必须可复现：相同输入和 Contract 必须产生相同结果。
3. Run 一旦开始，必须固定对应 Compatibility Decision ID，便于审计。
4. App Server 重启但二进制身份不变时可以复用已验证 Decision；身份变化必须重验。
5. 任何失败路径都必须产生一个明确终态，不得无限显示“正在读取 Runtime 能力”。

### 10.3 安全

1. 产品模式只信任签名制品或经过发布者验证的 Codex Desktop。
2. Schema 导出必须使用参数数组调用，禁止 shell 字符串拼接。
3. 临时目录必须位于 OpenDrSai 管理范围，使用不可预测名称并在结束后清理。
4. Schema 解析必须限制总字节数、单文件大小、文件数、递归深度和 JSON 深度。
5. 未知 Server Request 和 Approval 必须 fail closed。
6. 兼容模式不得放宽 Workspace、审批、文件、命令或 Transport 安全边界。
7. 日志和 UI 不得暴露用户提示、令牌、Cookie、完整环境变量或敏感路径。
8. 远程主机提供的版本和 Schema 不得仅凭远端声明信任，必须绑定受信 Transport 身份和摘要证据。

### 10.4 可维护性与可观测性

1. 协议审核事实必须集中在 Stable Contract Manifest。
2. 每个差异分类规则必须有单元测试。
3. 每次兼容决策必须记录 Decision ID、状态、耗时、缓存命中和差异计数。
4. 指标至少包含检查成功率、耗时、Schema 导出失败、缓存命中、未知通知数、运行期违规数。
5. 生成物必须通过 deterministic check，CI 中禁止漂移。

### 10.5 用户易用性

1. 普通用户最多看到一个主状态和一个主动作。
2. 技术差异默认折叠在“兼容详情”。
3. 检查中、可重试、确定阻断必须使用不同文案和视觉语义。
4. 状态变化不得清空当前会话、输入草稿或已加载历史。
5. 状态刷新应去抖；同一状态不得重复弹出通知。

## 11. 测试策略与测试案例

### 11.1 单元测试

| 编号 | 测试 | 预期 |
| --- | --- | --- |
| UT-01 | 基线版本、摘要完全匹配 | `exact/executable=true` |
| UT-02 | 已审核旧版本摘要匹配 | `reviewed_compatible` |
| UT-03 | 未登记新版本仅新增可选字段 | `capability_compatible` |
| UT-04 | 未登记版本移除必需方法 | `blocked`，差异指向该方法 |
| UT-05 | 新增必填请求参数 | `blocked` |
| UT-06 | 新增未知诊断通知 | 兼容，分类为 warning/info |
| UT-07 | 新增未知 Server Request | 决策不自动授权，运行时默认拒绝 |
| UT-08 | Schema 摘要与二进制记录不匹配 | `blocked/identity_mismatch` |
| UT-09 | Schema 键序和非语义元数据不同 | 规范化摘要相同 |
| UT-10 | Contract/Mapping 版本变化 | 缓存失效 |
| UT-11 | 并发 20 次检查 | Schema Provider 只调用一次 |
| UT-12 | 未知终态事件 | 当前 Run 失败一次，无双终态 |
| UT-13 | 未知普通事件洪峰 | 队列有界、聚合计数、连接继续 |
| UT-14 | 版本较新/较旧 | 推荐动作分别为更新 OpenDrSai/更新 Codex |
| UT-15 | Schema 导出超时 | `unknown`，不是 `blocked` |

### 11.2 集成测试

| 编号 | 场景 | 验收点 |
| --- | --- | --- |
| IT-01 | Fake App Server：基线协议 | 完成 initialize、模型读取、单轮 Turn |
| IT-02 | Fake App Server：兼容加法协议 | Backend 可执行，兼容模式可诊断 |
| IT-03 | Fake App Server：破坏性协议 | 发送前阻断，错误结构化 |
| IT-04 | Fake App Server：Schema/initialize 冲突 | 采用更严格状态 |
| IT-05 | Fake App Server：未知请求 | 默认拒绝，随后正常消息仍可到达 |
| IT-06 | 二进制热更新 | 旧缓存失效，只重验一次 |
| IT-07 | Gateway capability | 五态和 action 原样传递 |
| IT-08 | Desktop 状态投影 | checking 不显示 fault，较新版本提示更新 OpenDrSai |
| IT-09 | Transport 断连重连 | Contract 状态不被改写成 blocked |
| IT-10 | 历史只读 | blocked/unknown 时仍可加载已有会话 |

### 11.3 真实 Codex 验收

使用本机可信 `0.148.0-alpha.15`，仅在隔离测试工作区发送合成提示和合成文件：

| 编号 | 场景 | 验收点 |
| --- | --- | --- |
| LIVE-01 | 导出 Schema | 可重复生成，摘要稳定，来源身份一致 |
| LIVE-02 | initialize/account/model | 能力协商成功，不发生错误状态闪烁 |
| LIVE-03 | 新建会话单轮问答 | 用户消息、处理中、最终回答均正确 |
| LIVE-04 | 同会话连续三轮 | 复用同一个 Codex Thread，不新增三个线程 |
| LIVE-05 | 流式长回答 | 首个可见增量及时到达，无字典字符串泄漏 |
| LIVE-06 | 命令和文件修改 | OAEP 工具/文件 Item 结构化、审批正确 |
| LIVE-07 | 取消运行 | 单一 cancelled 终态，可继续下一轮 |
| LIVE-08 | App Server 退出恢复 | 自动重新连接并复核身份，历史不丢失 |
| LIVE-09 | Desktop 重启继续 | Session ↔ Thread 绑定保持，多轮继续同线程 |
| LIVE-10 | 归档/取消归档同步 | OpenDrSai 与 Codex 状态一致 |

### 11.4 性能与安全测试

| 编号 | 测试 | 门槛 |
| --- | --- | --- |
| NF-01 | 已审核缓存命中 1,000 次 | P95 < 100 ms，无额外导出 |
| NF-02 | 首次导出与分析 20 次 | P95 < 5 s，全部 < 15 s |
| NF-03 | 20 个并发调用 | 单次导出，调用方均得到同一 Decision |
| NF-04 | 超大 Schema | 在限制处终止，内存有界 |
| NF-05 | 路径逃逸/符号链接 | 被拒绝，无工作区写入 |
| NF-06 | 未知 Approval/Server Request | 全部默认拒绝 |
| NF-07 | 日志扫描 | 不含令牌、提示、敏感路径和完整环境变量 |
| NF-08 | Windows/Linux 规范化 | 同一 fixture 摘要一致 |

### 11.5 回归测试

必须继续通过：

- 现有 15 个 `test_codex_*.py` 测试集合；
- Stable Contract generator/verifier；
- OAEP Session Stream、Presentation Projector、Structured Renderer；
- P7/P8/P9/P10/P10-R 中仍适用的发布门禁；
- Windows Desktop 类型检查、主进程测试和渲染测试；
- 远程 SSH Fake Codex App Server 合约测试。

静态源码字符串检查只可作为辅助，不得作为兼容通过的唯一证据。

## 12. 验收标准

P10-C 仅在以下条件全部满足时完成：

1. Stable Contract v7 是唯一协议审核事实源，生成物无漂移。
2. Adapter 实现五态兼容决策，不再把未知版本直接等同于不兼容。
3. `health()`、`execute_turn()` 和 `model_catalog()` 使用同一个 Compatibility Decision。
4. 新增可选协议成员可以通过能力兼容模式运行。
5. 破坏性协议变化在发送用户 Turn 前被阻断。
6. 未知 Server Request 默认拒绝，未知普通通知不会导致永久 fault。
7. Desktop 正确区分检查中、兼容模式、确定阻断，并给出方向正确的动作。
8. 当前 `0.148.0-alpha.15` 完成 Schema 快照、差异审核、映射修订和真实端到端验收。
9. 同一 OpenDrSai 会话连续多轮仍复用同一 Codex Thread。
10. 首次检查、缓存命中、并发 Singleflight、资源限制达到非功能门槛。
11. 本地实际启动二进制、Schema 摘要、Contract 记录和验收报告身份一致。
12. 全部测试案例有机器可读结果；失败、跳过和环境未执行不得记为通过。
13. 回滚开关可以恢复为“仅 exact/reviewed 允许”，但不得恢复错误 UI 文案或分散判断。
14. 文档、错误码、诊断和用户说明同步完成。

## 13. 发布、迁移与回滚

### 13.1 迁移顺序

1. 先引入数据结构、Schema Provider 和 Analyzer，不改变现有放行行为。
2. 导入 `0.148.0-alpha.15` Schema，建立差异测试。
3. 将三个 Backend 入口切换到统一 Compatibility Service。
4. 开启 `reviewed_compatible`，完成回归。
5. 以发布开关启用 `capability_compatible`，先在开发版收集证据。
6. 完成真实验收后在产品模式启用。
7. 最后移除旧数组式运行判断和错误 UI 推断。

### 13.2 回滚

必须提供一个运维级回滚开关，将执行策略收紧为只允许 `exact` 和 `reviewed_compatible`。回滚：

- 不得改变 Stable Contract 数据；
- 不得删除缓存或用户会话；
- 不得让 Desktop 直连 Codex；
- 不得关闭历史只读；
- 必须在 capability 中说明策略性阻断，而不是伪报协议破坏。

## 14. 明确不做什么

P10-C 不包括：

1. 不保证兼容任意未来 Codex 版本。
2. 不按宽松 SemVer 范围无条件放行 Alpha 版本。
3. 不修改 Codex App Server 本身，也不 fork Codex CLI。
4. 不让 Desktop 绕过 Runtime 直接连接 Codex App Server。
5. 不把 Codex 原生 Thread、Turn、Item 类型泄漏到 OAEP 或通用 UI。
6. 不为每个 Codex 版本复制一套完整 Adapter。
7. 不自动下载、降级或替换用户 Codex，除非未来另有明确安装策略和用户授权。
8. 不在用户工作区生成协议 Schema、缓存或兼容证据。
9. 不记录或展示模型隐藏推理；只映射后端明确提供、符合 OAEP 可见性规则的处理说明或推理摘要。
10. 不在本阶段增加新的聊天表层功能、Agent 能力或 Codex 专属 UI 组件。
11. 不以网络在线测试替代 Fake Server、单元测试和协议静态验证。
12. 不把远程 Linux Transport 的部署、升级和 SSH 管理作为本阶段退出条件；但本阶段的数据结构和判定服务必须可被远程 Transport 复用。
13. 不把测试未执行、环境不可用或人工观察等同于验收通过。

## 15. 阶段交付物

P10-C 完成时必须交付：

- Stable Contract v7 Manifest 和确定性生成绑定；
- Schema Provider、Canonicalizer、Compatibility Analyzer/Service；
- 统一 Backend compatibility 接入；
- Runtime/Gateway/Desktop 五态能力契约；
- `0.148.0-alpha.15` 原始 Schema 快照与语义差异报告；
- 单元、集成、Desktop、性能、安全和真实 Codex 验收结果；
- P10-C feature ledger 与机器可读证据索引；
- 用户文案、诊断说明、升级与回滚说明。

本规格的最终产品结果应是：用户更新 Codex 后，只要必需协议仍兼容，OpenDrSai 可以自动确认并继续使用；确实发生破坏性变化时，OpenDrSai 能在执行前安全阻断，并准确告诉用户应该更新哪一方及如何恢复。
