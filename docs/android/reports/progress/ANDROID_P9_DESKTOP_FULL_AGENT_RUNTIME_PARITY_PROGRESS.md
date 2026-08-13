# Android P9 Desktop Full Agent Runtime 能力对等进度

## 第 26～27 轮补充记录

| 轮次 | 实施内容 | 验证结果 | 严格功能进度 |
|---:|---|---|---:|
| 26 | 建立每 Run 的实际 Tool/Skill/Host Capability Snapshot 与稳定 digest；Android StartRun 固定能力集，Checkpoint 恢复时校验防篡改；模型只能调用快照内工具；风险、审批和 OAEP 输出类型由 Registry 定义决定，不再信任模型自报字段；Tool schema 增加 version/source/classification/required_capabilities；修复 Relay 审批先改 Registry、再要求 pending 导致的双重决策冲突 | Python 相关生产/跨端/Relay 回归 77/77；Android JVM 416 项、0 failures、0 errors、2 skipped；ADB 无在线设备，最新 instrumentation 未执行 | 1/72（1.39%） |
| 27 | 建立版本化 `p9-host-port-v1` Kernel Host Port；Android 生产 StartRun 声明 Surface、能力 ID/版本和 required 标记；保留 v1.5.6 legacy 兼容入口；未知必需扩展、已知能力不兼容版本、错误 Surface/协议在模型请求前 fail closed；Run started 导出脱敏 Host Port digest | Python 生产/跨端相关回归 81/81；Android JVM 416 项、0 failures、0 errors、2 skipped；instrumentation APK 编译通过，待设备在线执行 | 1/72（1.39%） |
| 28 | Desktop 从实际发送给模型的 Workbench/Handoff/Manager Tool 对象冻结 `p9-model-tools-v1`，执行分派前拒绝快照外幻觉工具；Android 使用同一 Model Tool Snapshot 并在 Checkpoint 恢复校验；Desktop 生产工厂接入 `p9-host-port-v1`；Android 身份握手和个人中心显示 Host Port/Model Tool Snapshot 版本 | Python 生产/跨端相关回归 86/86；Android JVM 416 项、0 failures、0 errors、2 skipped；instrumentation APK 编译通过；严格验收 M01-F03 | 2/72（2.78%） |
| 29 | 移除未验收状态下的虚假 Full/Full Local 产品标签，改为 `Android Agent Runtime Preview · Desktop parity incomplete`；新增 72 项机器账本；Gradle 从全部 72 项 accepted 且具有测试/证据的结果派生 `DESKTOP_AGENT_PARITY_COMPLETE`，禁止手工设置 true；运行时路由、Agent 描述、错误和诊断均受门禁控制 | Python 生产/跨端/账本相关回归 88/88；Android 标签门禁定向测试通过；Android JVM 416 项、0 failures、0 errors、2 skipped；严格验收 M10-F06 | 3/72（4.17%） |
| 30 | 新增共享 `p9-execution-tools-v1` 执行注册表，将每 Run 实际模型 schema、schema digest、执行器、版本、来源、能力、风险和审批模式绑定为单一快照；Desktop 与 Android 执行前均拒绝注册表漂移、幻觉工具和不可用能力；Android Tool/OAEP 事件从注册表导出策略字段，不信任模型自报风险；Desktop Gateway 接通必需审批并封堵并行 Delegate 绕过 | Python 生产/runtime/parity 相关回归 115/115；Android JVM 421 项、0 failures、0 errors、2 skipped；instrumentation APK 编译成功；ADB 无在线设备；严格验收 M04-F01、M04-F02 | 5/72（6.94%） |
| 31 | 建立共享、版本化 `p9-tool-loop-v1`，统一最多 24 Tool rounds、每批最多 8 个调用；Android 在任何状态修改前校验 call_id、批量上限和混合审批，轮次进入 Checkpoint 并在恢复后继续生效；并行 Host Tool 支持乱序完成后仅回到模型一次；Desktop 同步使用批次策略，并将并行 Subagent 结果从 agent_type 键改为 call_id 键，避免同类型结果覆盖 | Python 生产/runtime/parity 相关回归 121/121；定向 Tool Loop 回归 75/75；Android JVM 421 项、0 failures、0 errors、2 skipped；instrumentation APK 编译成功；ADB 无在线设备；严格验收 M04-F03 | 6/72（8.33%） |
| 32 | 共享 Kernel 建立 400/401/408/429/5xx、timeout、cancelled Tool 错误分类和可操作提示；Registry 只为 read_only 瞬时错误生成最多 2 次尝试，写/敏感工具固定 1 次；Android Host 在最终 receipt 前安全重试只读调用，Kotlin Registry 独立核对权威风险并拒绝篡改；Desktop 使用同一策略；取消等待中的 Tool 会闭合消息、清除 pending 并写终态 Checkpoint；OAEP 保留 code/retryable/actionable | Python 生产/runtime/parity 相关回归 136/136；定向错误/重试回归 90/90；Android JVM 425 项、0 failures、0 errors、2 skipped；instrumentation APK 编译成功；ADB 无在线设备；严格验收 M04-F04 | 7/72（9.72%） |
| 33 | 建立共享 Tool 输出上限与 Artifact 完整性契约；Android 在 Host descriptor、Python Kernel 和 OAEP 映射三层校验 ID/MIME/size/SHA-256，超限结果只回填 4096 字符摘要和不透明 ID；Desktop 移除 `run_read` 静默 5000 字符截断，将完整输出写入 Runtime 私有 Artifact，并通过 FilesEvent/OAEP 保留来源 call ID、预览和下载能力；Runtime Artifact 支持私有二进制持久化、旧库迁移、Workspace 隔离和分块读取；Command/File Change 继续由 Registry 类型映射到完整 OAEP 终态 | Python 当前相关回归 122/122，聚焦输出/Artifact/OAEP 回归 112/112；Android JVM 427 项、0 failures、0 errors、2 skipped；instrumentation APK 编译成功；Python 全包回归在 127 项后命中既有 Codex approval `accept`/`approved` 契约失败，与本轮无关；ADB 无在线设备；严格验收 M04-F05 | 8/72（11.11%） |
| 34 | 将每 Run Capability Snapshot 升级为 `p9-run-capabilities-v2`；共享 Kernel 基于生产 manifest、实际 Tool/Skill、Host capability、SAF/网络阻塞项及远程 Runtime 可用集生成互斥的 available/remote-required/unsupported/blocked；Android 在 Run 启动前采集网络与 SAF，Snapshot/digest/诊断写入 run.started 和 Checkpoint，恢复时校验原快照；环境变化只影响新 Run；OAEP 生成稳定 capability notice，结果中心可查看分类、digest 和阻塞原因 | Python capability/runtime/parity 回归 94/94，定向 Kernel/Mobile 88/88；Android JVM 430 项、0 failures、0 errors、2 skipped；instrumentation APK 编译成功；ADB 无在线设备；严格验收 M10-F04 | 9/72（12.50%） |
| 35 | 为 M04-F06 冻结 30 类不泄露工具名的自然任务集、每类至少 3 次的统计阈值和共享评分器；新增真实 `deepseek-v4-flash` Android Full Runtime instrumentation，同时暴露完整生产 Tool Catalog，在模型请求层记录 Host/Core Tool 实际选择；模型客户端支持可选固定温度，验收明确使用 0.0；新增物理 arm64 runner，统一校验漏调用、错工具、无意义调用、重复调用与 provider error，并固化 Kernel/Prompt/Tool/Capability/APK digest 证据 | Python 评分器 5/5；Android JVM 430 项、0 failures、0 errors、2 skipped；HaiModelClient 定向回归及 instrumentation APK 构建成功；ADB 无在线设备，未执行 30×3 真实模型运行，因此 M04-F06 保持 pending，不提前计分 | 9/72（12.50%） |
| 36 | 新增 `p9-production-parity-v1` 动态生产能力清单；Desktop 工厂从构造完成的 Agent 实例枚举 Prompt、当前及懒加载 Tool、Skill、Subagent、Memory Context 和 Model 行为；每项同时给出 Desktop/Android 分类；实际 `DrSaiAssistant` 可在 Skill/MCP reload 后刷新清单；只导出稳定 ID、计数和 digest，不导出 Prompt、密钥、路径或 Memory 正文；能力变化必然改变 digest，规范化 ID 冲突 fail closed | Python 生产清单/工厂/Kernel/账本回归 65/65；Android JVM 430 项、0 failures、0 errors、2 skipped；instrumentation APK 构建成功；严格验收 M01-F01 | 10/72（13.89%） |
| 37 | 建立唯一 `create_agent_kernel()` 构造边界，将共享循环正式命名为 `DrSaiAgentKernel`；Android runtime probe、Desktop/TUI Runtime Adapter、Desktop/TUI `create_agent` 均从同一工厂取得同一 Agent 类型和共享 Kernel/Prompt digest；旧 `create_shared_mobile_core` 仅兼容转发；生产 Adapter 禁止直接实例化循环 | Python 工厂/Android probe/跨端 parity 回归 43/43；但 Desktop/TUI 主执行仍由旧 `DrSaiAssistant.run_stream` 所有，因此 M01-F02 暂不计分，必须与 M01-F04 迁移闭环 | 10/72（13.89%） |
| 38 | 新增共享 `p9-tool-decision-v1` 脱敏决策诊断；基于任务类型和本 Run 实际 Tool 域区分 required-tool-selected、required-tool-omitted、required-tool-unavailable、direct-answer、optional-tool-selected、prior-tool-satisfied；事件只含稳定类别、原因、计数和 requirement digest，不含 Prompt、参数、Memory、路径或私有思维链；诊断进入 Checkpoint 后的 Runtime Event 和 Android OAEP Notice | Python Kernel/Mobile/三端 parity/账本回归 103/103；Android JVM 431 项、0 failures、0 errors、2 skipped；instrumentation APK 构建成功；严格验收 M10-F05 | 11/72（15.28%） |
| 39 | 废止与当前图不一致的 159 项旧 OSV 绿灯；实时解析 `debugRuntimeClasspath` 的 179 个 Maven 组件并调用 OSV 官方 Batch API 重扫；生成 P9 CycloneDX 1.5，绑定 APK、每个 Maven 缓存产物 SHA-256、递归 POM 许可证、49 个共享 Python 源文件、50 个 APK Chaquopy/CPython 产物和显式 0 bundled Skill；静态门禁拒绝动态 pip、下载后执行和动态代码加载 | 当前依赖 OSV 179 项、0 findings；11 个供应链 gate 全绿；SBOM 缺失 hash/license 0；静态 findings 0；Python verifier 4/4；严格验收 M11-F03 | 12/72（16.67%） |

### 第 26～27 轮严格计分说明

- M04-F01/M04-F02/M10-F04 已具备 Android 生产实现和自动化基础，但 Desktop 生产模型请求尚未由同一 Registry 生成每 Run snapshot，因此不提前计分。
- M01-F03 已完成：Desktop 与 Android 生产入口均接入版本化 Host Port，兼容和 fail-closed 契约测试通过。
- 当前无 ADB 设备在线，不能补齐 arm64 真机证据；这只阻塞设备验收，不改变自动化测试结论。

> 权威方案：`docs/android/plans/runtime/ANDROID_P9_DESKTOP_FULL_AGENT_RUNTIME_PARITY_DEVELOPMENT_PLAN.md`  
> 开发基线：Android v1.5.6 Debug / versionCode 10506  
> 统计口径：只有同时满足代码、方案规定测试及权威验收证据的功能点才计入 72 项完成数。

## 总体状态

| 指标 | 当前值 |
|---|---:|
| 阶段 | P9 M12（自动验收、发布证据与旧架构退场） |
| 已验收功能点 | 67 / 72 |
| 功能进度 | 93.06% |
| 当前决定 | IN PROGRESS |

当前已有 67 个功能点完成严格验收。M01、M06、M07、M08、M10 均已全部闭环，M11-F01/F02/F03/F05/F06 与 M12-F01/F02/F03/F05 已闭环；剩余 M04-F06/M09-F06 需要真实模型统计，M11-F04/M12-F04 需要完整设备性能矩阵，M12-F06 必须最后执行。Android 继续强制显示 Preview/Incomplete。

## 轮次记录

### 第 82 轮验收证据

#### M08-F05 长任务后台运行、通知控制与同 Run 恢复

- `LocalRunForegroundService` 取得长任务前台所有权，使用 `dataSync` 类型与 `START_REDELIVER_INTENT`；任务移除、进程重投递和 Android 15 前台服务超时均转入可恢复状态并调度唯一 Recovery Work。
- 锁屏/通知栏始终提供绑定 `accountSubject + runId + sessionId` 的“继续/取消”动作；非法或缺失作用域的 Intent fail closed。继续操作恢复原 Conversation、Checkpoint 与 Run ID，取消只终止通知对应的 Run。
- 恢复 Worker 与前台服务复用稳定通知 ID；`STOP_FOREGROUND_DETACH` 后仍保留用户控制，避免 Doze 延迟 Worker 时通知消失。
- API 35 模拟器在测试进程内真实启动前台服务，强制进入 `mState=IDLE`，并在 Doze 前后两次确认同一持续通知、两个操作按钮和 ongoing 标志；同一 8 项套件在 API 35 模拟器及 SM-X936C 真机各通过 8/8。

```text
Long-run background acceptance gates: 11/11 passed
Android testDebugUnitTest: 501 tests, 0 failures, 0 errors, 2 skipped
Android API 35 emulator + SM-X936C device: 16 tests, 0 failures, 0 errors, 0 skipped
API 35 forced-Doze foreground notification test: 1 passed, 0 failed
Acceptance evidence audit: 40 reports, 0 failed, 0 stale source digests
Strict acceptance: M08-F05 accepted; total 48/72 (66.67%)
```

### 第 83 轮验收证据

#### M08-F06 多步骤自然任务 E2E

- 新增无实现工具名的自然任务：“检索 HEPiX 2026，与本地 Android Runtime 方案比较，必要时委派研究子任务，生成报告并引用来源”。真实 Android Python Runtime 连续完成强制检索、Plan、文件读取、Subagent、审批、Artifact 与最终引用。
- 修复共享 Tool Decision 的多步骤阻断：必需检索已有成功结果后，后续选择 Plan、文件或 Artifact 工具不再被误判为 `wrong_tool_selected`；首次遗漏或首次选择错误检索工具仍然 fail closed。
- 最终 OAEP 事件同时包含 `plan.started`、`subagent.started/completed`、`artifact.created`、`citation.verified`、`message.completed` 与 `run.completed`；答复引用精确 HTTPS 来源、本地文件和 Artifact ID。
- API 35 模拟器和 SM-X936C 真机均通过完整 E2E。Gradle 双设备 UTP 汇总仍报告结果接收异常，但两份 JUnit XML 均为 1/1、零失败、零错误、零跳过。

```text
Natural multistep E2E acceptance gates: 9/9 passed
Shared Kernel verification/citation/subagent regression: 82 passed, 0 failed
Android testDebugUnitTest: 501 tests, 0 failures, 0 errors, 2 skipped
Android API 35 emulator + SM-X936C device E2E: 2 tests, 0 failures, 0 errors, 0 skipped
Acceptance evidence audit: 41 reports, 0 failed, 0 stale source digests
Strict acceptance: M08-F06 accepted; total 49/72 (68.06%)
```

### 第 84 轮验收证据

#### M09-F01 Provider/模型能力探测与 Run 前阻断

- 新增稳定的模型运行能力合同，绑定模型 ID、OpenAI/Anthropic wire API、工具、并行工具、reasoning、来源、状态与 SHA-256 digest；来源仅允许探测、显式配置或 Provider metadata。
- Android 发送入口在创建 `runJob` 前解析当前模型能力；能力未知或 Full Runtime 需要工具而模型明确不支持时，返回稳定错误并阻断 Run，不再先请求模型后退化成普通聊天。
- Python Model Host Adapter 在 Provider 调用前执行同一预检；未明确支持并行 Tool Call 的模型如果返回多个调用会 fail closed，避免执行服务商未声明的并行语义。
- 个人中心 Full Runtime 诊断导出模型能力状态、来源、digest 及 tools/parallel/reasoning 布尔值，便于确认当前 Run 为什么可用或被阻断。
- OpenAI、Anthropic、无工具、并行工具和 reasoning 五类 fixture 均通过；全量 JVM 回归通过。受生产入口摘要变化影响的旧证据已在 API 35 模拟器与 SM-X936C 真机重跑并刷新。

```text
Model capability acceptance gates: 9/9 passed
Focused model capability/Host Adapter JVM suites: 12 tests, 0 failures, 0 errors, 0 skipped
Android testDebugUnitTest: 507 tests, 0 failures, 0 errors, 2 skipped
Refreshed device suites: API 35 emulator + SM-X936C, all generated JUnit cases green
Acceptance evidence audit: 42 reports, 0 failed, 0 stale source digests
Strict acceptance: M09-F01 accepted; total 50/72 (69.44%)
```

### 第 85 轮验收证据

#### M09-F02 OpenAI/Anthropic Tool schema 格式适配

- 新增单一 `ModelToolSchemaProtocolAdapter`：同一 canonical Tool schema 根据模型能力合同转换为 OpenAI `type=function/function.parameters` 或 Anthropic `name/input_schema`，生产请求不再各自临时拼装。
- 工具名只在 wire 边界执行一次稳定映射；Unicode 描述、enum、嵌套 object、array、required 和 `additionalProperties` 均经深拷贝保留，无语义丢失。
- Schema 缺失名称/parameters/type、对象缺 properties、数组缺 items、required 引用未知字段时，在网络请求前以 `model_tool_schema_invalid`、HTTP 422、不可重试方式 fail closed。
- Provider 明确拒绝工具 Schema 时返回稳定 `model_tool_schema_rejected`，Host Adapter 保留该结构化错误，不再错误归并为“模型不支持工具”。
- 完整 Full Runtime Core Tool Catalog 已对两种协议逐项转换；OpenAI、Anthropic 和 Host Adapter 定向测试及 Android 全量 JVM 回归通过。

```text
Tool schema protocol acceptance gates: 9/9 passed
Focused schema/client/Host Adapter JVM suites: 26 tests, 0 failures, 0 errors, 0 skipped
Android testDebugUnitTest: 513 tests, 0 failures, 0 errors, 2 skipped
Acceptance evidence audit: 43 reports, 0 failed, 0 stale source digests
Strict acceptance: M09-F02 accepted; total 51/72 (70.83%)
```

### 第 86 轮验收证据

#### M09-F03 共享 Tool Choice Policy

- 共享 Kernel 新增版本化 `p9-tool-choice-v1`：依据 Tool Decision Requirement、本 Run 可见工具和既有 Tool 结果生成 `none/auto/required/specified`，并绑定稳定 digest。
- 无可见工具时使用 `none`；普通稳定任务保持 `auto`；首次处理必须核实的 Host/外部事实时使用 `required`；已有成功 Tool 结果后恢复 `auto`，允许继续 Plan、文件、Artifact 等多步骤执行。
- 指定工具必须存在于本 Run 可见 Tool Snapshot，否则 `tool_choice_specified_tool_unavailable` fail closed；普通请求不会被全局强制为 required。
- Android Model Request 携带 Kernel 生成的完整策略，Host 不重新分类；OpenAI 映射为 `auto/required/none` 或 named function，Anthropic 映射为 `auto/any`、省略工具或 named tool。
- 新策略通过共享 Kernel、Android wire adapter、Host 转发和完整自然多步骤 E2E；受共享 Kernel digest 变化影响的历史证据已在 API 35 模拟器与 SM-X936C 真机刷新。

```text
Tool Choice acceptance gates: 10/10 passed
Python Tool Choice policy fixtures: 5 passed, 0 failed
Focused Android Tool Choice/Host suites: 12 tests, 0 failures, 0 errors, 0 skipped
Android testDebugUnitTest: 517 tests, 0 failures, 0 errors, 2 skipped
Acceptance evidence audit: 44 reports, 0 failed, 0 stale source digests
Strict acceptance: M09-F03 accepted; total 52/72 (72.22%)
```

### 第 87 轮验收证据

#### M09-F04 流式 Tool Call 严格组装

- 新增单一 `StreamedToolCallAssembler`，按 index 接收可交错的 id/name/arguments delta，完成时按 index 稳定排序并精确重建 JSON Object。
- index 限制在单批最多 8 个调用，arguments 单调用上限 1 MiB；负 index、越界、index gap 和超限均拒绝。
- id/name 缺失、重复 id/name 分片、跨调用复用 call ID、非法 JSON arguments 均返回稳定 `model_tool_stream_invalid`、HTTP 502、不可重试，不再静默覆盖或抛通用 JSONException。
- Android 生产 Model Host 已只使用该组装器；完成组装后再执行并行能力校验和权威 Tool Registry 元数据绑定。

```text
Streamed Tool Call acceptance gates: 9/9 passed
Focused assembler/Host JVM suites: 13 tests, 0 failures, 0 errors, 0 skipped
Android testDebugUnitTest: 521 tests, 0 failures, 0 errors, 2 skipped
Acceptance evidence audit: 45 reports, 0 failed, 0 stale source digests
Strict acceptance: M09-F04 accepted; total 53/72 (73.61%)
```

### 第 88 轮实施记录（待证据刷新，不计分）

#### M09-F05 模型切换与 Run 固定

- 新增版本化 `p9-model-route-v1`，在 Run 创建前固定稳定模型 ID、Provider ID、上游模型 ID、Base URL、wire API、Provider revision 和 credential kind；快照不包含 API Key、Token 或其他凭据，并绑定跨 Kotlin/Python 一致的 SHA-256。
- 新 Run 在写入 Python Start Envelope 前固定模型 Route；共享 Kernel 将其写入每个 Model Request 和 Checkpoint。恢复时模型 ID 与 Route 均取自原 Checkpoint，不读取当前会话默认模型。
- `HaiModelClient` 使用固定 Route 发请求，不再在每轮模型调用时动态解析当前 Provider 配置；修改默认模型或上游模型不会影响活动 Run。
- Provider 被删除或 API Key 缺失时返回稳定 `model_provider_credentials_missing`，不会把自定义模型 ID 当成 HepAI 模型静默回退；Route digest、模型 ID或上游 ID篡改均 fail closed。
- M09-F05 独立门禁已 10/10，通过 Python Checkpoint/Resume 与 Android Route/Provider/Host 定向测试；全量 JVM 526 项零失败。共享 Kernel 变化造成历史证据摘要过期，必须重跑设备门禁并恢复到 0 stale 后才可正式计入账本。

```text
Pinned model route provisional gates: 10/10 passed
Python model route snapshot suite: 2 passed, 0 failed
Focused Android route/client/Host suites: 27 tests, 0 failures, 0 errors, 0 skipped
Android testDebugUnitTest: 526 tests, 0 failures, 0 errors, 2 skipped
Strict acceptance: unchanged at 53/72 (73.61%); pending historical evidence regeneration
```

### 第 89 轮验收证据

#### M09-F05 模型切换与 Run 固定正式验收

- 重跑共享 Kernel、Mobile Engine、Android Coordinator、Model Gateway 变化影响到的全部非设备与设备门禁；模拟器 `OpenDrSai_API35_Runtime` 和真机 `SM-X936C` 的短期上下文、强制检索、沙箱计算、自然工作区、技能、MCP、子智能体及自然多步 E2E 均通过。
- 固定 Route 独立门禁 10/10，通过 Python Checkpoint/Resume、Android Route/Provider/Host 定向测试；全量 Android JVM 526 项零失败（2 跳过）。
- P9 全证据审计共 46 份报告，`passed=false` 为 0，源码摘要过期为 0；满足严格计分条件，M09-F05 从 pending 更新为 accepted。

```text
Pinned model route acceptance gates: 10/10 passed
Python model route snapshot suite: 2 passed, 0 failed
Focused Android route/client/Host suites: 27 tests, 0 failures, 0 errors, 0 skipped
Android testDebugUnitTest: 526 tests, 0 failures, 0 errors, 2 skipped
Affected instrumentation: emulator + SM-X936C, all suites passed
Acceptance evidence audit: 46 reports, 0 failed, 0 stale source digests
Strict acceptance: M09-F05 accepted; total 54/72 (75.00%)
```

### 第 90 轮实施记录（待真实模型运行，不计分）

#### M09-F06 真实模型统计门禁

- 冻结 `p9-real-model-statistical-gate-v1`：候选模型为智增增 `deepseek-v4-flash` 与 `deepseek-v4-pro`，复用 30 类自然任务，每类每模型至少 3 次；S0 阈值固定为工具选择率、参数正确率、最终任务成功率均不低于 85%，Provider 错误率不高于 5%。
- 真机测试已适配 M09-F05 的 `p9-model-route-v1`，每个 Run 固定 Route；原始观测新增完整 Tool Call 参数、最终终态、模型 Route digest 和完整 Tool Schema，不以日志或单次指定工具探针代替统计证据。
- 新增共享评分器与物理 arm64 runner：分别输出两个模型和聚合层的原始尝试数、Provider 错误数、工具选择通过数、参数通过数、最终任务通过数；参数同时校验 Tool JSON Schema 与冻结的关键语义断言。
- 真机探针在发起 Provider 请求前返回 `deepseek-v4-flash_not_configured`。当前 Debug 私有配置文件存在，但模型数据库快照中已无该模型；在用户重新保存智增增 Provider 与两个模型前，不生成伪证据、不更新 M09-F06 台账。

```text
Python real-model statistics + natural selection suites: 9 passed, 0 failed
Android compileDebugAndroidTestKotlin: BUILD SUCCESSFUL
Physical probe: blocked before provider request (deepseek-v4-flash_not_configured)
Strict acceptance: unchanged at 54/72 (75.00%); M09-F06 pending 2-model 180-attempt run
```

### 第 91 轮验收证据

#### M10-F01 Web、Citation、MCP、Skill、Handoff、Subagent 统一 OAEP 映射

- Desktop Handoff 不再直接绕过协议修改 UI 状态：发起、接受、拒绝均先持久化 OAEP Run/Interaction/Notice/Terminal 事件；持久化失败时 fail closed，不上传附件、不启动 Agent、不导航到远程工作台。
- 共享 Kernel 在 `run.started` 发布脱敏 Skill manifest snapshot；Android 映射为 `skill_manifest_snapshot` Notice，仅保留稳定身份、版本、能力、允许工具和摘要，不泄露 Skill 指令正文。
- Web、Citation、MCP、Handoff、Subagent 及未知扩展均有显式 OAEP 投影；未知扩展保留为可见结构化日志，禁止静默丢弃。
- 使用升级安装的安全仪器 runner 在 API 35 模拟器与 SM-X936C 上刷新受共享 Kernel/Mapper/AppViewModel 影响的历史证据，全程未执行 uninstall 或 `pm clear`。

```text
OAEP capability mapping acceptance gates: 11/11 passed
Focused Android JVM: 27 tests, 0 failures
Full Android JVM: 534 tests, 0 failures, 0 errors, 2 skipped
Shared Kernel focused suite: 39 passed, 0 failed
Affected instrumentation: API 35 emulator + SM-X936C, all suites passed
Acceptance evidence audit: 47 reports, 0 failed, 0 stale source digests
Strict acceptance: M10-F01 accepted; total 55/72 (76.39%)
```

### 第 92 轮验收证据

#### M10-F02 UI 展示工具过程、来源、失败和执行位置

- OAEP Presentation 不再丢弃 Assistant citations 与 Web Tool receipt 中的 URL；只接受 HTTP(S) 来源，并对重复链接去重、有界显示。
- `web.search`、`web.fetch`、`delegate` 和 Subagent 使用用户可读的搜索、读取、委派状态；Tool、MCP、Shared Core、Android Host、Remote Runtime 与 Subagent 均显示明确执行位置。
- Compose 执行过程展示 Tool 失败原因，回答与 Tool 行都展示可点击来源链接；完成/失败 Run 的过程默认收起但可展开，进行中 Run 默认展开。
- API 35 模拟器与 SM-X936C 使用升级安装运行同一 Compose 用例并各生成一张截图；手机纵向和平板横向证据均经视觉检查，未卸载应用或清除数据。

```text
Tool/source UI acceptance gates: 9/9 passed
Android testDebugUnitTest: 535 tests, 0 failures, 0 errors, 2 skipped
OaepToolVisibilityUiTest: API 35 emulator + SM-X936C, 2/2 passed
Visual evidence: emulator + SM-X936C PNG valid and distinct
Acceptance evidence audit: 48 reports, 0 failed, 0 stale source digests
Strict acceptance: M10-F02 accepted; total 56/72 (77.78%)
```

### 第 93 轮验收证据

#### M10-F03 Runtime、Kernel、Prompt、Tool、Skill、进程与绑定诊断

- Python Runtime Service 在健康握手中上报 `Application.getProcessName()` 与真实 PID；主进程客户端要求进程名以 `:runtime` 结尾且 PID 有效，否则绑定 fail closed。诊断不再用静态 `:runtime` 冒充已验证进程。
- Skill Catalog 新增 `p9-skill-manifest-v1` 脱敏身份摘要，绑定 source/id/version/skill digest，不包含 Skill 指令正文；空清单稳定，Skill 变更必然改变摘要。
- 个人中心和会话诊断同时展示 binding/health、真实进程与 PID、Kernel version/digest、Prompt、Tool manifest、Skill manifest/digest，以及 Capability、Host Port 和 Model Tool 版本。
- 安全升级 runner 只使用 `adb install -r -t`；模拟器与 SM-X936C 验证启动、独立双进程、空闲释放、进程死亡恢复、Checkpoint 同 Run 恢复和诊断 Compose 渲染。

```text
Runtime identity diagnostic acceptance gates: 11/11 passed
Android testDebugUnitTest: 536 tests, 0 failures, 0 errors, 2 skipped
PythonRuntimeServiceTest: 6 tests × API 35 emulator and SM-X936C, 12/12 passed
Diagnostic Compose test: API 35 emulator + SM-X936C, 2/2 passed
Acceptance evidence audit: 49 reports, 0 failed, 0 stale source digests
Strict acceptance: M10-F03 accepted; total 57/72 (79.17%)
```

### 第 94 轮验收证据

#### M11-F01 网络、文件、MCP、浏览统一安全策略

- 新增版本化 `p9-android-tool-security-v1` 单一执行前安全边界；所有 Tool 在权限判断和 Handler 前统一校验，获批调用在产生副作用前再次核验审批，拒绝路径不会触达 Handler。
- Web Fetch、受控浏览器导航与下载统一要求 HTTPS、443 端口、无 userinfo/fragment，并拒绝本机、私网、链路本地和保留地址；100 余组 SSRF 对抗输入覆盖 scheme、authority、literal、重定向与 DNS rebinding 防线。
- SAF 文件入口在既有规范化前先拒绝绝对路径、URI 和反斜杠，修复 `safeParts()` 去除前导斜杠后可能把绝对路径误当相对路径的问题；路径逃逸和未授权写入均不能到达执行器。
- MCP 调用除账户和 capability 外，强制绑定当前 Run、Session 与 Connector scope；跨账户、跨 Run、跨 Session、未知 Connector 全部 fail closed。
- MockWebServer 所需私网/HTTP 仅保留为构造器显式开启、默认关闭的测试开关；生产默认路径不存在隐式例外。
- 统一入口变更影响的 Web Search、MCP、Memory、Web Fetch、Browser、Network、Workspace Diff 历史报告均重新生成；API 35 模拟器和 SM-X936C 上的 Web Search/MCP instrumentation 通过安全升级 runner 刷新。

```text
Unified tool-security acceptance gates: 9/9 passed
Focused security regression: all selected suites passed
Android testDebugUnitTest: 539 tests, 0 failures, 0 errors, 2 skipped
Affected instrumentation: API 35 emulator + SM-X936C, Web Search and MCP suites passed
Evidence audit: 50 JSON files; 48 acceptance reports, 0 failed, 0 stale source digests
Strict acceptance: M11-F01 accepted; total 58/72 (80.56%)
```

### 第 95 轮验收证据

#### M11-F02 副作用恰好一次和恢复

- Tool 与 Artifact 副作用日志明确拆成 `prepared → executing → receipt_persisted`；intent 已持久化但 Handler 尚未开始时可安全恢复执行，只有已经进入执行边界而 receipt 缺失的调用才进入 reconciliation。
- Tool Handler 返回后、receipt 落盘前的进程死亡窗口不会自动重放；恢复将 intent 改为 `needs_reconciliation`，生成 OAEP reconciliation Interaction 和 waiting Run，避免永久停留在 running。
- receipt 已持久化后的恢复直接回放原结果，Handler 不再执行；外部写、Artifact mutation 均使用稳定 operation/call identity。
- approval 的批准和拒绝决定都写入 `_host_approval_results`，并绑定 approval ID 与 call ID；恢复后直接回放决定，不重复弹窗，身份漂移 fail closed。
- OAEP Sink 改为候选 Writer 两阶段发布：先从当前 durable state 构造候选、Room 事务提交成功后才替换缓存；提交异常或提交后进程死亡会丢弃缓存并从 Room 权威状态重建。
- API 35 模拟器与 SM-X936C 对 OAEP `STATE_APPLIED` 和 `TRANSACTION_COMMITTED` 两个故障窗口执行真实 Room 重建；连续序列、单批 dedupe 和最终 Run 状态均正确。

```text
Exactly-once/recovery acceptance gates: 10/10 passed
PythonAgentLoopCoordinatorTest: 22 tests, 0 failures
Android testDebugUnitTest: 543 tests, 0 failures, 0 errors, 2 skipped
AndroidOaepStoreTest: 12 tests × API 35 emulator and SM-X936C, 24/24 passed
Affected Workspace/Subagent instrumentation: API 35 emulator + SM-X936C, all passed
Evidence audit: 51 JSON files; 49 acceptance reports, 0 failed, 0 stale source digests
Strict acceptance: M11-F02 accepted; total 59/72 (81.94%)
```

### 第 96 轮实施记录（未计分）

#### M11-F04 性能和资源预算基础

- 冻结 `p9-android-performance-v1`：延续 Stage 7 冷启动 P95 3000ms、前台 PSS 220MB、数据库增长 64MB、恢复 P95 2000ms，并新增峰值 PSS、CPU、本地探针网络、安装加数据占用、电量变化、热状态和 ANR 上限。
- API 35 x86_64 的 Runtime 冷启动、PSS、CPU、网络、存储、电量、热状态、释放和 ANR 共 11/11 通过。
- API 36 arm64 首次有效运行 10/11：一次 3076ms 冷启动令 P95 超过 3000ms 预算 76ms；其余九次为 575～728ms。预算未因结果放宽。
- 三星 MARs 首次杀死 instrumentation，经定位为 `autorun(2)` 系统策略；解除限制后的第二次长时间卡在宿主测量，未生成可用报告。
- 当前没有 API 26/30 AVD 或设备。因此 M11-F04 保持 pending，局部报告放入 `evidence/p9/pending/`，不进入已验收证据审计。

```text
Strict acceptance: unchanged at 59/72 (81.94%); M11-F04 pending API 26/30 and stable API 36 pass
```

### 第 97 轮验收证据

#### M11-F05 v1.5.6 Checkpoint 与数据迁移

- v1 无校验和 Python checkpoint 在内存解码后，下一次写入升级为带 `schema_version/min_reader_version/payload_sha256` 的 v2；Tool receipt、intent、Skill version 和 Run sequence 均保留。
- 完成会话、消息和终态 Run 在数据库关闭重开后仍可读；活动 Full Runtime Run 保持原 session/run/idempotency identity，并可从同一 Run 恢复。
- 缺少 Python 状态的旧 Kotlin Lite Run 明确终结为 `legacy_kotlin_checkpoint_unrecoverable`，禁止在 Full Runtime 下重放潜在副作用。
- 校验和损坏、未来 schema 或 reader 不兼容统一终结为 `python_checkpoint_incompatible`；未知 `database_busy` 等暂时存储错误继续抛出，不被误销毁。
- 旧活动副作用状态通过 Legacy OAEP Backfill 投影为 reconciliation Interaction 与 waiting Run；不兼容状态不永久停留 running。
- API 35 模拟器与 SM-X936C 均通过同一真实 Room 迁移、关闭重开和终态测试。

```text
Runtime migration acceptance gates: 10/10 passed
Android testDebugUnitTest: 544 tests, 0 failures, 0 errors, 2 skipped
P9RuntimeMigrationInstrumentedTest: API 35 emulator + SM-X936C, 2/2 passed
Affected PythonRuntimeServiceTest: 6 tests × 2 devices, 12/12 passed
Evidence audit: 52 JSON files; 50 acceptance reports, 0 failed, 0 stale source digests
Strict acceptance: M11-F05 accepted; total 60/72 (83.33%)
```

### 第 98 轮验收证据

#### M11-F06 Kill switch 与安全降级

- 新增版本化 `p9-android-kill-switch-v1`，签名运行策略可分别禁用 Web、MCP、Sandbox、Kernel 和 Remote Handoff；未知开关值 fail closed，策略抓取失败在已配置签名通道上关闭 Kernel。
- Web/MCP 开关同时缩减 Runtime Capability、模型可见 Tool、依赖这些 Tool 的 Skill 和诊断清单；Sandbox 开关移除 `core.data_compute`，恢复旧 checkpoint 时再次过滤冻结 Tool/Skill，防止旧状态绕过。
- Kernel 开关在唯一 Python Full Runtime Engine 入口显式返回 `android_full_runtime_kernel_disabled`；路由器没有 Kotlin Lite 或纯聊天备用引擎。Remote Handoff 开关在生成 OAEP offer 前显式终止，不会把 Desktop-only 请求静默交给本地聊天。
- API 35 模拟器与 SM-X936C 真机均证明五类开关全部持久化后，既有 OAEP Snapshot digest 完全不变。
- 真网旧门禁暴露 Bing 区域 HTML 返回空结果时过早停止 fallback；已修复为继续独立 Wikipedia provider，并在单元 fixture 与双设备中英文真网查询中通过。

```text
Runtime kill-switch acceptance gates: 10/10 passed
Android testDebugUnitTest: 548 tests, 0 failures, 0 errors, 2 skipped
P9RuntimeKillSwitchInstrumentedTest: API 35 emulator + SM-X936C, 2/2 passed
WebSearchProviderInstrumentedTest: English + Chinese × 2 devices passed
Evidence audit: 53 JSON files; 51 acceptance reports, 0 failed, 0 stale source digests
Strict acceptance: M11-F06 accepted; total 61/72 (84.72%)
```

### 第 99 轮验收证据

#### M12-F01 72 项机器可读账本

- 新增独立账本审计器，固定校验 72 个有序唯一 ID、状态闭集、测试/证据存在性、证据绿灯、共享证据归属、源码 SHA-256 新鲜度和进度计算；不再仅依赖 Gradle 配置期的浅层存在性检查。
- 每次审计生成带 `acceptance_run_id` 的证据索引并冻结所有已绑定证据文件 SHA-256；若证据显式声明了不同 Run ID，立即 fail closed，禁止拼接不同候选或不同验收轮次伪造同一运行。
- 对缺项、重复 ID、缺失测试文件、`passed=false`、过期源码 hash 和混合 run ID 建立负向 fixture；所有欺骗场景均被拒绝。
- 当前仍有 10 项 pending，因此机器报告只给出 62/72（86.11%），`DESKTOP_AGENT_PARITY_COMPLETE` 保持 false，不能提前显示 100% 或 Full parity complete。

```text
Machine-ledger acceptance gates: 9/9 passed
Ledger positive/negative verifier tests: 4/4 passed
Accepted bindings: 62/72; pending: 10
Evidence audit: 54 JSON files; 52 acceptance reports, 0 failed, 0 stale source digests
Strict acceptance: M12-F01 accepted; total 62/72 (86.11%)
```

### 第 100 轮验收证据

#### M12-F02 生产双端行为 parity 套件

- 冻结 `opendrsai.p9-production-behavior-parity/1` 单一 fixture，绑定 Kernel/Prompt 身份、共享 Tool schema digest、Skill manifest digest、自然输入、Tool 调用/回执/决策顺序与最终用户文本。
- Desktop 侧使用真实 `DrSaiAssistant` 实例并经过生产 `run_agent_through_kernel` Adapter；没有用独立测试循环替代生产入口。Android 侧经 `PythonRuntimeClient` 连接 APK 内独立 `:runtime` 进程执行同一 fixture。
- 双端均得到 `run.started → tool.decision → tool.started → tool.result → tool.decision → run.completed`，且最终文本均为 `echo:hello`；Desktop Workbench Handler 精确执行一次。
- API 35 x86_64 模拟器与 API 36 arm64 SM-X936C 真机同时核验相同 Kernel/Prompt digest、Tool schema digest、空 Skill manifest digest、语义事件和终态。

```text
Production behavior parity acceptance gates: 10/10 passed
Desktop production identity/behavior + cross-runtime parity suites: all passed
P9ProductionBehaviorParityInstrumentedTest: API 35 emulator + SM-X936C, 2/2 executions passed
Evidence audit: 55 JSON files; 53 acceptance reports, 0 failed, 0 stale source digests
Strict acceptance: M12-F02 accepted; total 63/72 (87.50%)
```

### 第 101 轮验收证据

#### M12-F03 自然任务黄金集

- 冻结 `opendrsai.p9-natural-task-golden/1` 六类自然任务：HEPiX 最新资料与引用、工作区编辑审批、Skill 规范、已连接服务只读访问、并行研究、Full Agent 复合报告。
- 所有 Prompt 禁止出现 `web.search`、`workspace.*`、`delegate`、`mcp.call`、`tool_choice` 等实现名；工具选择必须来自 Agent 自主决策，不能靠测试提示泄题。
- 黄金集绑定已验收的真机/模拟器 E2E：强制检索与来源、工作区 diff/审批、Skill 选择及版本、Streamable HTTP MCP、stdio Handoff、Subagent/Artifact/Citation 和最终 `run.completed`。
- 每个 Case 都要求用户可见 `message.completed` 与明确终态；复合任务还要求 Plan、Subagent、Artifact 和 Citation 全链路可观察。

```text
Natural task golden acceptance gates: 10/10 passed
Golden contract tests: 2/2 passed
Natural cases: 6; covered domains: 9
Bound Android emulator + SM-X936C E2E evidence: all green
Strict acceptance: M12-F03 accepted; total 64/72 (88.89%)
```

### 第 102 轮验收证据

#### M12-F05 删除旧决策路径与假 parity

- Python AST 门禁证明 `MobileAgentCore` 仅是 `DrSaiAgentKernel` 的符号别名，不存在独立 Class；`create_mobile_agent_core` 与 `create_shared_mobile_core` 都只委派唯一 `create_agent_kernel`，不能直接构造第二循环。
- Android 生产 `runtime_probe` 直接调用 `create_agent_kernel(surface="android")`；Kotlin 主源码不存在 `LocalAgentRuntime` 或 Kotlin Lite 执行类，v1.5.5 Lite 仅保留不可恢复迁移提示。
- 主 APK 二进制扫描确认不含 `acceptance_tool_*` 和 `runP9NaturalToolSelection`；测试 APK 则必须包含二者，证明扫描确实区分生产 APK 与 instrumentation APK，而不是错误地漏扫。
- 产品 parity 声明仍只由有序 72 项账本的 `all accepted` 派生；故障注入新增独立 Mobile 类、直接构造器或生产 probe 旁路时均能 fail closed。

```text
Legacy-path retirement acceptance gates: 10/10 passed
Static fault-injection tests: 2/2 passed
Production APK fake acceptance tools: 0
Independent MobileAgentCore classes: 0
Strict acceptance: M12-F05 accepted; total 65/72 (90.28%)
```

### 第 103 轮验收证据

#### M01-F05 Android `:runtime` 共享 Kernel 与 M01-F06 生产双端 parity runner

- Android `:runtime` 生产 probe 直接使用唯一 `create_agent_kernel(surface="android")`；健康握手从真实独立进程导出 Kernel ID/version/digest、Prompt version/digest、Tool manifest version 与真实 PID。
- API 35 模拟器和 API 36 arm64 真机已验证主进程与 `:runtime` PID 不同、进程死亡后重建、Checkpoint 同 Run 恢复和绑定身份一致；Manifest 保持 non-exported 独立进程。
- M01-F06 由同一冻结 fixture 驱动真实 Desktop `DrSaiAssistant` 生产 Adapter 与 Android APK 内 Runtime；模型、Prompt、Capability、Tool/Skill digest、Tool intent/receipt、决策、终态与用户文本均规范化等价。
- 两项不是根据实现存在性补记，而是复用第 93/100 轮的双设备运行证据并新增各自独立机器门禁。

```text
Android shared-kernel runtime gates: 8/8 passed
Production dual-runtime parity runner gates: 8/8 passed
API 35 emulator + API 36 SM-X936C: identity, process, recovery and behavior parity green
Strict acceptance: M01-F05 and M01-F06 accepted; total 67/72 (93.06%)
```

| 轮次 | 实施内容 | 验证结果 | 功能进度 |
|---:|---|---|---:|
| 23 | 新增共享 `agent_kernel` Run/Prompt/Context 契约；Android StartRun 注入版本化 System Prompt；共享 Tool Verification Policy；本地 Skill 指令进入权威模型上下文；远程 Skill 不注入；旧无版本 Skill fixture 收紧；新增回归测试 | Python Runtime 37/37；Android JVM 413 项、0 失败、2 跳过；Android Python source merge/compile 通过 | 0/72（0.00%） |
| 24 | Desktop 生产 `create_agent()` 接入共享 Prompt Registry；固定 Kernel/Prompt identity 与 SHA-256；Android runtime probe 暴露同一 identity；Android 模型请求移除旁路 Prompt；新增生产 Desktop vs Android Prompt parity；修复 Desktop Runtime 执行路径中作用域外 `replay` 导致的 E2E 失败 | Python 生产/跨端相关回归 44/44；Android JVM 413 项、0 失败、0 错误、2 跳过；Android Python source merge/compile 通过 | 1/72（1.39%） |
| 25 | 新增版本化 Desktop/Android Capability Manifest 和 Tool Manifest identity；分类 `shared/local-equivalent/remote-required/unsupported`；Binder 健康握手校验并导出 Kernel/Prompt/Tool/Capability digest；个人中心诊断显示身份；修复 Chaquopy 顶层包导入导致真实 `:runtime` 启动失败的问题 | Python 生产/跨端回归 48/48；Android JVM 415 项、0 失败、0 错误、2 跳过；API 35 x86_64 emulator 独立 `:runtime` instrumentation 1/1；SM-X936C 真机因系统关闭 Wi-Fi、无线 ADB 中断，未取得测试终态 | 1/72（1.39%） |

## 第 24～25 轮证据与剩余条件

### 本轮完成验收

- **M10-F06 禁止虚假 Full 标签**：
  - 本地 Runtime 的用户可见名称、运行位置、错误和诊断在当前阶段统一显示 Preview/Incomplete；
  - `DESKTOP_AGENT_PARITY_COMPLETE` 由 `ANDROID_P9_ACCEPTANCE_LEDGER.json` 的全部 72 项状态派生，不存在手工 true 配置；
  - Gradle 配置期验证 72 个 ID 完整、唯一、有序，accepted 项必须绑定测试和证据；
  - Python 账本测试和 Android UI/runtime gate 测试均通过。

- **M01-F03 Kernel Host Port 协议**：
  - `p9-host-port-v1` 固定 schema、协议版本、Surface、能力 ID/版本和 required 语义；
  - Desktop 生产 Agent 工厂和 Android 生产 StartRun 均接入该协议并导出脱敏 digest；
  - v1.5.6 legacy 能力列表保持兼容；未知可选扩展被忽略，未知必需扩展、不兼容已知版本、错误 Surface/协议稳定 fail closed；
  - Android Binder 身份和个人中心诊断显示 Host Port 与 Model Tool Snapshot 版本。

- **M02-F01 版本化 System Prompt 注入**：
  - 权威 Prompt 由共享 `agent_kernel.DEFAULT_SYSTEM_PROMPT` 和 `AgentRunConfig.authoritative_prompt()` 生成；
  - Desktop 生产 `create_agent()` 的 system prompt 首段与 Android 实际 Runtime 发往模型的首段完全一致；
  - Desktop Agent metadata 与 Android `runtime_probe.health()` 均暴露 `kernel_id`、`kernel_version`、`prompt_version` 和 `base_prompt_sha256`；
  - `test_agent_kernel_production_parity.py` 使用 Desktop 真实生产工厂和 Android 实际 runtime probe，捕获并比较两端请求，而非 `DesktopMobileCoreAdapter` 自证；
  - Prompt identity 单元测试、生产工厂集成测试、Android probe 测试、跨端生产 parity 测试和 Android 全量 JVM 回归均通过。

### 已实现但尚未整项验收

- M01-F01 基础：已有稳定 schema/digest 的初版双端 Capability Manifest，覆盖 Prompt、Context、Tool Policy、Model、Memory、Skill、Subagent、Tool 和 MCP 域，并具有四类分类；尚需从 Desktop 实际生产 Registry 动态枚举并核对无遗漏；
- M01-F02/M01-F03 基础：新增平台无关 `AgentRunConfig` 和共享上下文入口，Desktop 已接入共享 Prompt Registry，但完整 Agent Loop/Kernel 工厂尚未统一；
- M01-F05/M10-F03 基础：Android `:runtime` health 已强制校验并导出 Kernel、Prompt、Tool、Capability 版本与 digest，emulator 真实双进程测试通过；尚缺 arm64 真机成功终态及升级/恢复场景；
- M02-F02 基础：共享策略规定最新、易变、陌生实体和引用请求必须检索，但尚缺 `web.search` 与自然任务行为验收；
- M02-F03 基础：System、Tool Policy、Skill 已确定性分层，Project/Memory 层尚未接入共享 Kernel；
- M07-F01/M07-F02 基础：Skill 版本和有界指令进入模型上下文，完整 Manifest/digest/allowed-tools 尚未实现。

### 自动化结果

```text
Python production/runtime/parity suite: 48 passed, 0 failed
Android testDebugUnitTest: 415 tests, 0 failures, 0 errors, 2 skipped
Android debug Python source merge and Kotlin compilation: passed
API 35 x86_64 emulator :runtime identity instrumentation: 1 passed, 0 failed
SM-X936C arm64 device instrumentation: infrastructure interrupted (Wi-Fi/ADB disconnected), no product verdict
```

## 第 51 轮验收证据

### M01-F04 Desktop 生产入口迁移到共享 Kernel

- `DrSaiAssistant.run_stream` 的普通字符串、`BaseChatMessage`、多消息序列、多模态消息和 `task=None` 继续执行现均进入 `run_agent_through_kernel`；只有显式 `/help`、`/agent` 等命令控制面继续由命令处理器响应，不再有非命令 Agent 决策的旧 Loop 旁路。
- Desktop 工厂默认绑定共享 `drsai-agent-kernel`，仅保留显式紧急回退 `DRSAI_P9_DESKTOP_KERNEL_LEGACY=1`，没有异常后的自动静默 fallback；生产形态测试证明终态 checkpoint 实际由共享 Kernel 写入 Agent 状态。
- 多模态图像通过 Autogen 模型端口作为真实 `Image` 输入；Kernel/OAEP 只持有不可逆 SHA-256、大小、MIME 和 opaque artifact ID，输入 Artifact 仅允许 `describe`，拒绝越权 `read`。
- 默认子智能体配置进入共享 Kernel 的 Agent Profile，并继续使用已接通的 `Delegate` Manager Host Port；Skill、Todo、Scheduled Task、审批、普通 Workbench Tool 和大输出 Artifact 均沿统一 Coordinator 闭环。
- 修复生产工厂上下文预算引用内部局部变量导致的 `NameError`，并将默认模型配置路径改为调用时解析 `DRSAI_HOME`，恢复隔离 Runtime/账户测试环境。

```text
Desktop production-entry acceptance gates: 8/8 passed
Desktop/Kernel focused production regression: 146 passed, 1 skipped
Android -> Windows Full Runtime relay/tool/approval/artifact + config regression: 46 passed
Broad Python repository audit: 1592 passed, 5 skipped, 11 failed before compatibility-test update;
  3 context failures were obsolete Lite expectations and are now updated/passing;
  remaining failures are independently tracked stale Stage7/SBOM/stability/security-test contracts, not Desktop Agent core regressions.
Strict acceptance: M01-F04 accepted; total 19/72 (26.39%)
```

## 第 52 轮验收证据

### M03-F02 统一长期记忆策略

- 共享 Kernel 的 `p9-memory-policy-v1` 要求保存、替换和删除具有明确用户长期记忆意图；普通问答中模型擅自写记忆会 fail closed，搜索保持只读，策略及 digest 随 checkpoint 恢复并防篡改。
- Python Kernel 与 Android Host 双重拒绝 Bearer/API Key/密码/私钥、身份证/银行卡以及中英文病历和诊断信息；本轮补齐共享 Kernel 对英文 `medical record/medical diagnosis/diagnosis:` 的识别，与 Android 防御规则对齐。
- Android 关闭记忆时不声明 `LOCAL_MEMORY` 且不向模型暴露 `save_memory/search_memory`；开启后 DAO 保存与搜索只能使用当前调用账户 subject，敏感内容在 Host 执行前再次拒绝。
- M01-F04 已关闭 Desktop 非命令旧入口，因此 Desktop `memory` mutation 与 Android `save_memory` 均必须通过同一个 Kernel Policy，不再存在旧多模态入口绕过策略的路径。

```text
Memory-policy Python regression: 18 passed
Android MemoryPolicyTest: 2 passed, 0 failed
Memory-policy acceptance gates: 9/9 passed
All dependent M02-F02..F06, M03-F01 and M01-F04 evidence regenerated: passed
Strict acceptance: M03-F02 accepted; total 20/72 (27.78%)
```

## 第 53 轮验收证据

### M01-F02 抽取 `drsai-agent-kernel` 单一生产工厂

- Desktop、TUI 和 Android 三端均只通过 `create_agent_kernel(surface=...)` 构造生产 Agent；三端返回相同 `DrSaiAgentKernel` 类型、相同 `drsai-agent-kernel` Agent ID、相同 Kernel digest 与基础 Prompt digest。
- 移除生产工厂对 `DRSAI_P9_DESKTOP_KERNEL_LEGACY` 的读取及 `_use_shared_agent_kernel_run_stream` 回退属性；即使外部残留该环境变量，生产 Agent 仍只绑定共享 Kernel。
- `DrSaiAssistant.run_stream` 现在以 `_shared_agent_kernel` 的生产绑定作为非命令路由条件，不能再通过布尔 pilot/rollback 开关恢复第二个 Agent 决策 Loop；显式命令仍是控制面，不属于模型 Agent Loop。
- 工厂契约测试扫描 Desktop 工厂、Desktop/TUI Adapter、Android Runtime Probe 与 mobile core factory，禁止直接构造 `DrSaiAgentKernel`/`MobileAgentCore`。

```text
Single-kernel-factory acceptance gates: 9/9 passed
Factory + Desktop production-entry regression: 25 passed
M01-F04 and M03-F02 evidence regenerated after rollback removal: passed
Strict acceptance: M01-F02 accepted; total 21/72 (29.17%)
```

## 第 54 轮实施记录（未计分）

### M04-F06 自然任务工具选择真机门禁准备

- 30 类自然任务 fixture、评分器和 5 项本地契约测试通过；Prompt 不暴露实现工具名，漏调用、错工具、重复调用、无意义调用和 Provider Error 均单独计分。
- 当前 ADB 仅发现 `emulator-5554`，没有 ARM64 物理设备；计划要求真实 `deepseek-v4-flash` 在物理设备完成 30 类 × 3 次行为观测，因此本轮拒绝用模拟器代替验收。

```text
Natural-tool-selection fixture/scorer tests: 5 passed
Physical ARM64 devices: 0
Strict acceptance: unchanged at 21/72 (29.17%); M04-F06 pending physical-device execution
```

## 第 55 轮验收证据

### M03-F03 Memory 选择与注入

- 共享 Kernel 新增版本化 `p9-memory-selection-v1`：按当前用户问题与候选记忆的词项相关度确定性排序，只选相关项，并给出稳定 ID、score、内容 SHA-256、遗漏原因与整体 digest。
- 敏感记忆和包含 `ignore/override/bypass system/policy/instruction` 等对抗指令的记忆在 Prompt 注入前拒绝；相关记忆以带 ID/digest 的 quoted data 形式进入最低优先级 Memory 层，不能覆盖 System/Tool Policy。
- Desktop Curated Memory 不再把完整 `MEMORY.md` 快照永久塞进 System Prompt，而是作为候选交给同一 Kernel 选择；Android 仅从当前 `accountSubject` 的 DAO 快照构造候选，关闭记忆时候选为 0，跨 subject 数据 fail closed。
- `run.started`/OAEP 只导出选中/遗漏 ID、score、reason 与 digest，不导出记忆正文；checkpoint 保存完整 selection 并在恢复时校验 digest，篡改摘要会拒绝恢复。

```text
Frozen relevant/irrelevant/adversarial dataset: recall 100%, precision 100%
Python Memory/Desktop/Mobile regression: 72 passed
Android subject candidate isolation: 3 passed
Android OAEP memory provenance mapper: passed
Android testDebugUnitTest: 446 tests, 0 failures, 0 errors, 2 skipped
Memory-selection acceptance gates: 8/8 passed
All dependent P9 Kernel evidence regenerated; M03-F02/F03 Android XML jointly refreshed: passed
Strict acceptance: M03-F03 accepted; total 22/72 (30.56%)
```

## 第 56 轮验收证据

### M03-F04 会话摘要与压缩

- 共享 Kernel 新增版本化 `p9-conversation-summary-v1`，以固定顺序保留 `CONSTRAINTS -> OPEN_ITEMS -> TOOL_RECEIPTS -> RECENT_CONTEXT`；普通旧对话只能占用剩余摘要预算。
- Tool receipt 保存 call_id、tool name、成功状态和完整结果 SHA-256，不把大结果全文复制进摘要；关键约束和未完成计划置于 recent context 之前，避免长对话尾部截断时丢失。
- 对已经规范化的摘要再次压缩返回相同内容；相同 100/500 轮输入在进程重启前后产生相同摘要和模型上下文。
- 500 轮压缩后的 checkpoint 由全新 Kernel 实例恢复，恢复前后 `MODEL_REQUEST.messages` 逐项相同，证明压缩后崩溃不会重排或遗失关键状态。

```text
Conversation-summary acceptance gates: 8/8 passed
Python summary/context/mobile regression: 48 passed
Android testDebugUnitTest: 446 tests, 0 failures, 0 errors, 2 skipped
All dependent P9 Kernel evidence regenerated: passed
Strict acceptance: M03-F04 accepted; total 23/72 (31.94%)
```

## 第 57 轮验收证据

### M03-F05 Desktop/Android Memory 语义对等

- Desktop Curated Memory 与 Android Room Memory 统一使用 `memory-<content-sha256-prefix>` 稳定 ID，不再暴露或依赖平台数据库自增 ID；相同内容跨端得到相同候选身份。
- 相同问题与 Memory fixture 分别从 Desktop/Android 生产 surface 启动共享 Kernel，规范化选中集合、score、遗漏原因、selection digest 和最终 `MODEL_REQUEST.messages` 完全相同。
- 双端 Memory 层都位于 Tool Policy 之后，相关偏好进入上下文，无关颜色偏好不进入上下文；Android 继续保持 subject 隔离和关闭记忆时候选为 0。

```text
Memory cross-runtime parity gates: 7/7 passed
Python Desktop/Android Memory parity regression: 17 passed
Android stable content-ID/subject tests: 3 passed
Android testDebugUnitTest: 446 tests, 0 failures, 0 errors, 2 skipped
M01-F04 and M03-F02/F03 evidence refreshed: passed
Strict acceptance: M03-F05 accepted; total 24/72 (33.33%)
```

## 第 58 轮验收证据

### M03-F06 Memory 数据迁移、重启、删除与账号隔离

- Android Room 保持 v1.5.5 到 v1.5.6 的 Memory 表结构与既有数据语义；迁移不会删除或重建 Memory 数据，重复读取和稳定内容 ID 推导具有幂等性。
- `ChatDao` 增加严格按 `userId` 删除全部记忆的接口；单条删除、账号级清空均限制在当前 subject，Alice 的删除不会影响 Bob，账号切换和退出登录会清除 Runtime 当前身份。
- 持久化 instrumentation 使用真实 Room 文件验证写入、关闭数据库、重新打开、读取、单条删除和账号级删除；删除后的记忆不再进入候选集，因此不能被后续 Agent Run 召回。
- Desktop 兼容既有 `MEMORY.md`，进程重启后仍可读取；重复写入不会制造重复条目，删除并重启后不可召回，与 Android 的生命周期语义一致。

```text
Memory data-lifecycle acceptance gates: 8/8 passed
Desktop restart/idempotency/delete regression: 1 passed
Android Room persistent lifecycle instrumentation: 1 passed, 0 failures, 0 errors
Android testDebugUnitTest: 446 tests, 0 failures, 0 errors, 2 skipped
Strict acceptance: M03-F06 accepted; total 25/72 (34.72%)
```

## 第 59 轮实施记录（未计分）

### M05-F01 `web.search` Host Tool 基础与真实 Provider 门禁

- 根因确认：共享 Kernel 已有 Tool Loop，但生产 Capability Manifest 将 Android `tool.web.search` 标记为 `unsupported`，Android Host Registry 没有搜索 schema 或执行器，因此模型不可能调用检索工具。
- 新增 `p9-web-search-v1` 稳定结果协议、可注入 `WebSearchProvider`、MediaWiki 真实 Provider 和 `web.search` Host Tool；结果包含 query、provider、status、searched_at、title、HTTPS URL、snippet、last_modified_at 和结构化 error_code。
- `WEB_SEARCH` 进入 Android Runtime Capability；仅在验证过的互联网连接存在时向当前 Run 暴露 schema，离线时从工具快照移除并记录 `tool.web.search/network_unavailable`，不再虚报可执行能力。
- MockWebServer 覆盖中英文、成功、空结果、HTTP 错误、非法响应和超时；Host Registry 覆盖能力开关与完整结果 envelope。
- 真实 Emulator instrumentation 已执行，但当前网络访问 Wikimedia 超时；成功结果门禁未满足，因此本轮不接受 M05-F01，后续需接入可配置且在目标网络可达的生产 Provider 后复测。

```text
Python Kernel/mobile/parity regression: 93 passed
Android focused web-search/schema/diagnostics regression: passed
Android testDebugUnitTest: 449 tests, 0 failures, 0 errors, 2 skipped
Emulator real-provider instrumentation: 1 failed (provider_timeout; external endpoint unavailable)
Strict acceptance: unchanged at 25/72 (34.72%); M05-F01 pending successful real-provider execution
```

## 第 60 轮验收证据

### M05-F01 `web.search` 真实 Provider 与 Host Tool

- 增加与现有 Desktop WebSurfer 搜索路由一致的 Bing Provider，并以 Wikipedia MediaWiki 作为故障切换；Provider 选择不会改变模型可见的 `p9-web-search-v1` 协议。
- Bing 响应被限制在 1,000,000 字符内，只解析结果容器中的直接 HTTPS URL、标题和有界摘要；过滤搜索引擎内部链接、重复 URL、空标题及非 HTTPS 来源。
- 真实 API/网页失败不会抛出非结构化异常：空结果、超时、HTTP/IO/非法响应分别返回稳定 status 与 error_code；fallback 仅在主 Provider 失败时启用。
- Emulator 真实网络对英文 `Android operating system` 与中文 `人工智能` 查询均返回至少一个规范化 HTTPS 来源，证明 Android Host Tool 不是 fixture-only 实现。
- Kernel Capability Manifest 将 Android `tool.web.search` 升级为 `local-equivalent`；生产 Run 仅在 Android 已验证互联网连接时加入 `WEB_SEARCH` 和工具 schema，离线诊断显式记录 `network_unavailable`。

```text
Web-search acceptance gates: 8/8 passed
Real-provider Android instrumentation: 1 passed (English + Chinese)
Python Kernel/mobile/parity regression: 93 passed
Android testDebugUnitTest: 450 tests, 0 failures, 0 errors, 2 skipped
All Kernel-digest-dependent P9 evidence refreshed: passed
Acceptance-ledger consistency: 2 passed
Strict acceptance: M05-F01 accepted; total 26/72 (36.11%)
```

## 第 61 轮验收证据

### M05-F02 `web.fetch` 与有界正文提取

- 新增版本化 `p9-web-fetch-v1` Host Tool；仅接受 HTTPS 初始 URL，手工检查最多 5 次重定向并禁止降级到 HTTP，不执行页面 JavaScript。
- 每次读取前检查目标 origin 的 `robots.txt`；匹配 `OpenDrSai` 或 `*` 的 Disallow、401/403/451、robots 不可用均结构化 fail closed。
- HTML 提取剥离 script/style/noscript/svg/template，优先 main/article/body 正文，支持 Content-Type 与 meta charset（含 GBK）；输出限制为 20,000 字符、响应限制为 2,000,000 字节。
- PDF 使用本地有界 content-stream 文本提取，不渲染、不执行嵌入动作；纯文本、HTML/XHTML 和 PDF 以外的内容类型明确拒绝。
- timeout、IO、HTTP、空响应、超大响应、无正文 PDF、拒绝访问和不支持类型均返回稳定 status/error_code；离线时 `WEB_FETCH` 不进入本 Run 工具快照。

```text
Web-fetch acceptance gates: 9/9 passed
HTML/redirect/GBK/PDF/robots/timeout/size/type fixtures: 5 passed
Python Kernel/mobile/parity regression: 93 passed
Android testDebugUnitTest: 455 tests, 0 failures, 0 errors, 2 skipped
M05-F01 real-provider instrumentation revalidated: 1 passed
All Kernel-digest-dependent P9 evidence refreshed: passed
Strict acceptance: M05-F02 accepted; total 27/72 (37.50%)
```

## 第 62 轮验收证据

### M05-F03 检索引用与证据链

- 共享 Kernel 新增版本化 `p9-citation-policy-v1`：仅从成功的 retrieval Tool receipt 中提取 `url/final_url`，最终答案中的 HTTPS URL 必须与真实工具来源精确匹配；未引用来源或加入伪造 URL 都不会进入 UI，而是确定性重试一次后 fail closed。
- 引用要求覆盖分类器强制检索和模型主动检索两条路径；只要成功检索结果提供了公开来源 URL，最终答案就必须引用至少一个真实来源，不能以 `direct_answer` 分类绕过。
- Citation evidence 仅持久化 policy version、Tool call ID、URL SHA-256、missing/fabricated 状态和整体 digest，不保存网页正文或原始 URL；checkpoint 恢复会重新校验 digest，篡改后拒绝恢复。
- Android 将 `citation.required/citation.verified` 映射为 OAEP Notice，结果中心只暴露 call ID、digest 与计数，不泄露原始 URL、网页正文或模型内部推理。
- API 35 模拟器重新执行 Runtime 进程退出、checkpoint 恢复及 Web Search 中英文实网用例；共享 Kernel 相关已验收证据全部重新生成，未复用旧哈希证据。

```text
Citation acceptance gates: 8/8 passed
Python citation/verification/Mobile/cross-runtime/factory suite: 61 passed, 0 failed
Android testDebugUnitTest: 456 tests, 0 failures, 0 errors, 2 skipped
Android API 35 runtime-process restart instrumentation: 1 passed, 0 failed
Android API 35 Web Search live instrumentation: 1 passed, 0 failed
Refreshed accepted Kernel-dependent gates: all passed
Strict acceptance: M05-F03 accepted; total 28/72 (38.89%)
```

## 第 63 轮验收证据

### M05-F04 时效性与陌生实体强制检索

- 定位并复现真机问题的直接根因：旧 `p9-tool-decision-v1` 源码中的中文关键词已经乱码，真实用户输入 `HEPiX2026是什么？` 无法命中“是什么”实体问题规则，因而可能被错误分类为 `direct_answer`；这与“Full Runtime 已启动但没有调用工具”的现象一致。
- Tool Decision Policy 升级为 `p9-tool-decision-v2`，输入先做 Unicode NFKC 规范化，再识别中英文时效词、核实/来源请求、年份及混合大小写陌生标识；`HEPiX2026`、`HEPiX 2026`、`Hepix2026` 和中文自然问法均进入 retrieval-required。
- 稳定算术、法国首都、文本改写和主观偏好仍保持 direct answer，避免把“强制检索”退化为所有问题一律联网。
- 当模型忽略检索并直接猜测时，流式正文保持缓冲且不会进入 UI；Kernel 发出 `required_tool_omitted/verification.required` 并带着真实 `web.search` schema 重试。缺少检索能力时返回明确 limitation，不展示模型猜测。
- API 35 模拟器直接运行 APK 内打包的 Chaquopy Runtime，中文 `HEPiX2026是什么？` 用例确认猜测被丢弃并请求 `web.search`；不是仅在桌面 Python 环境中验证分类函数。

```text
Forced-retrieval acceptance gates: 10/10 passed
Python natural-task/verification/citation/Mobile/cross-runtime/factory suite: 75 passed, 0 failed
Android testDebugUnitTest: 456 tests, 0 failures, 0 errors, 2 skipped
Android API 35 bundled-Python forced-retrieval instrumentation: 1 passed, 0 failed
Android API 35 checkpoint recovery and Web Search live instrumentation: passed
Refreshed accepted Kernel-dependent gates: all passed
Strict acceptance: M05-F04 accepted; total 29/72 (40.28%)
```

## 第 64 轮验收证据

### M05-F05 受控浏览器会话

- Android 新增版本化 `p9-controlled-browser-v1` Host：`browser.navigate/read` 只读，`browser.submit/download` 为 `SENSITIVE`，直接复用 Kernel/Android 既有审批链；未审批时返回 ApprovalRequired，网络请求不会提前发生。
- 浏览器会话按 HAI subject 隔离，保存当前页与会话 Cookie；其他 subject 使用同一 session ID 会 fail closed。Cookie 值、表单值、密码、下载正文和内部路径均不进入 Tool 输出。
- 页面处理不执行 JavaScript、Style、SVG、Template 或其他主动内容；只导出有界标题、正文、HTTPS 链接及表单字段声明。模型只能提交页面已声明字段，字段数、名称与值长度均有上限。
- 登录测试证明表单提交需审批，成功后 Cookie 仅在同 subject/session 后续导航中发送；结果中不暴露 Cookie。下载同样需审批，仅返回 MIME、大小、文件名与 SHA-256 元数据，不把二进制正文塞入模型上下文。
- 新增 `BROWSER_SESSION` 真实 Runtime capability，仅系统验证网络可用时进入本地能力集合；共享 Desktop/Android Capability Manifest 将 `tool.browser.session` 标为平台安全等价的 local-equivalent。

```text
Controlled-browser acceptance gates: 12/12 passed
Android ControlledBrowserToolTest: 4 passed, 0 failed
Android testDebugUnitTest: 460 tests, 0 failures, 0 errors, 2 skipped
Python Kernel/production/Mobile/cross-runtime regression: 94 passed, 0 failed
Android API 35 checkpoint, Web Search and forced-retrieval instrumentation: passed
Refreshed accepted Kernel-dependent gates: all passed
Strict acceptance: M05-F05 accepted; total 30/72 (41.67%)
```

## 第 65 轮验收证据

### M05-F06 网络与浏览安全

- 新增统一 `NetworkSafetyPolicy` 并接入 `web.fetch` 与受控浏览器的实际 OkHttp DNS：生产请求只允许 HTTPS、无 URL credentials、标准 443 端口和非空域名；`file/http/ftp`、localhost 与非标准端口在发请求前拒绝。
- DNS 结果拒绝 loopback、RFC1918、链路本地、云元数据地址、CGNAT、零地址、组播、IPv6 loopback/ULA/link-local。URL 初检和 OkHttp 实际 `Dns.lookup` 都执行同一策略，因此“第一次解析公网、连接时重绑定私网”会在第二次解析 fail closed。
- `web.fetch` 的初始 URL 和每一次手动重定向均重新执行网络策略；受控浏览器最多跟随 5 次重定向，每一跳重新校验协议、域名、端口和 DNS，恶意 `file://` 跳转与超限跳转被拒绝。
- 浏览页面只接受 HTML/XHTML/纯文本；图片或任意二进制不能被伪装成页面正文。页面和下载都改用有界流式读取，声明长度超限与未知长度分块巨型响应均在 2 MB 处确定性终止，不先整体载入内存。
- 测试专用 loopback 开关仅由显式构造参数启用，生产默认 provider 固定关闭；该开关用于 MockWebServer，不进入 Runtime schema 或用户设置。

```text
Network/browser safety acceptance gates: 12/12 passed
Android NetworkSafetyPolicyTest: 4 passed, 0 failed
Android Browser/WebFetch safety and regression: 9 passed, 0 failed
Android testDebugUnitTest: 465 tests, 0 failures, 0 errors, 2 skipped
M05-F02 and M05-F05 evidence regenerated against current network implementation: passed
Strict acceptance: M05-F06 accepted; total 31/72 (43.06%)
```

## 第 66 轮验收证据

### M06-F01 Desktop File Tool 与 Android SAF 语义映射

- 建立版本化跨端 fixture，将 Desktop `run_read/run_glob/run_grep/run_write/run_edit` 映射到 Android `workspace.read/glob/grep/write/edit`；Python 与 Kotlin 对同一组相对路径、行范围和 glob 用例分别执行，不以静态名称相似代替行为比较。
- Android SAF 增加递归 `workspace.glob` 和正文 `workspace.grep`；深度、pattern、单文件读取、匹配行长度和结果数量均有硬上限。`workspace.read` 增加一基 `start_line/end_line`，与 Desktop 文件读取的分页语义对齐。
- `workspace.edit` 采用精确文本单次替换，`workspace.write/edit` 均为 `EXTERNAL_WRITE` 且在 Gateway 内再次检查 approved；M06-F02 将继续增加写前 Diff、冲突 digest、撤销和恰好一次副作用证明。
- 所有 Android 路径先经 `safeParts`，拒绝绝对路径、空段、`.`、`..` 与 NUL；实际根目录只能来自当前 HAI subject 保存且仍存在的 persisted SAF grant。模型没有任意文件系统或绝对路径能力。
- list/read/search/glob/grep/write/edit schema 均由生产 `ToolRegistry` 单一生成；read-only 搜索结果映射为 OAEP Command Execution，写入与编辑映射为 OAEP File Change。

```text
Workspace semantic-parity acceptance gates: 10/10 passed
Shared Desktop/Android fixture: Python 2 passed; Android 2 passed
Android SAF/path/schema focused suite: passed
Android testDebugUnitTest: 468 tests, 0 failures, 0 errors, 2 skipped
Strict acceptance: M06-F01 accepted; total 32/72 (44.44%)
```

## 第 67 轮验收证据

### M06-F02 文件编辑与 Diff/Approval

- Android SAF 写工具新增 Host 侧变更规划器：`workspace.write`、`workspace.edit`、`workspace.undo` 在审批前生成相对目标路径、before/after SHA-256、受限 unified diff 与稳定 mutation token；审批界面接收的是 Host 生成的预览，不再直接信任模型参数作为变更说明。
- 文件变更以 `accountSubject + OAEP tool_call_id` 绑定。审批通过后的提交会再次读取当前文件并核对 before digest；审批等待期间发生外部修改时以 `workspace_mutation_conflict` fail closed，不覆盖新内容。
- 同一个已提交 call 再次到达时只返回 replay receipt，不重复写入；call ID 不能绑定不同变更，撤销必须引用当前账号已成功提交的 mutation token、再次展示反向 diff 并再次审批，不能跨账号撤销。
- Full Runtime Tool Registry 的三种写工具均声明 `EXTERNAL_WRITE + SAF_WRITE + oaep_output_type=file_change`；OAEP File Change 从 Host receipt 取得 path、create/modify/remove 语义和 digest/token 摘要，因此无 path 参数的 `workspace.undo` 也能生成完整结构化事件。
- 内置 SAF Skill 说明和 Full Runtime 诊断工具清单同步加入 glob、grep、edit、undo，模型与诊断不再只看到旧的 list/read/search/write 子集。

```text
M06-F02 acceptance gates: 10/10 passed
Python Mobile Agent Core file-change regression: 36 passed, 0 failed
Android testDebugUnitTest: 472 tests, 0 failures, 0 errors, 2 skipped
M06-F01 evidence regenerated after shared SAF source update: 10/10 passed
Strict acceptance: M06-F02 accepted; total 33/72 (45.83%)
```

## 第 68 轮验收证据

### M06-F03 Artifact 读写、预览与分享

- 新增可在进程重建后恢复的 `LocalArtifactMaterializer`：只按当前账号和 opaque artifact ID 从 Room/应用私有附件恢复内容，重新核对大小与 SHA-256，再物化到受控缓存；对 UI 和 OAEP 不导出真实存储路径。
- 文本、图片、PDF、通用二进制和超大文件采用确定性预览策略；本地上限 256 MiB，远程大文件继续按 256 KiB 分块、校验 scope/size/digest，损坏或越界内容 fail closed。
- 结果中心为本地附件与 Tool output 增加“预览/分享”；两种动作只使用未导出的 FileProvider `content://` URI、只读临时授权和 ClipData，不授予写权限。
- API 35 `OpenDrSai_API35_Runtime` 模拟器实际安装应用与 instrumentation APK：新 Materializer 实例从持久化 Tool Artifact 恢复相同 digest，接收方可读取受控 URI，URI 不含缓存绝对路径；Bob 无法读取 Alice 的 Artifact。

```text
M06-F03 acceptance gates: 9/9 passed
Android testDebugUnitTest: 474 tests, 0 failures, 0 errors, 2 skipped
Android API 35 LocalArtifactAccess instrumentation: 2 tests, 0 failures, 0 errors
Android compile/assembleDebugAndroidTest: BUILD SUCCESSFUL
Strict acceptance: M06-F03 accepted; total 34/72 (47.22%)
```

## 第 69 轮验收证据

### M06-F04 受限 Python/数据计算工具

- 新增共享 Core 工具 `core.data_compute`，只接受声明式数值操作：count/sum/mean/median/min/max/sort/histogram；模型不能传入 Python 源码、import、文件路径、URL、网络或进程参数。
- `p9-declarative-compute-v1` 固定最多 10,000 个有限数值、256 KiB 输入、100 个 histogram bins 和 250 ms CPU 预算；非有限数、未知字段、越界输入与超时均返回稳定错误并确定性终止。
- 工具在共享 Python Kernel 内直接执行，不产生 Android Host Tool request；Android 仅负责向模型暴露同一有界 schema，因此计算过程没有任意文件、网络、动态 import 或代码执行能力。
- API 35 `OpenDrSai_API35_Runtime` 模拟器实际从 APK 启动独立 `:runtime` Chaquopy 进程，完成 median 计算并返回 Core tool result，确认无 `tool_call_request`。测试同时发现并修复共享 Runtime 目录作为 Chaquopy 顶层 source root 时的导入语义。
- 共享 Kernel 变更后，Prompt/Context/Memory/Verification/Citation/Forced Retrieval/Workspace Diff 的关联证据已重新生成；进程重启上下文和中文 HEPiX 强制检索 instrumentation 也重新执行通过。

```text
M06-F04 acceptance gates: 9/9 passed
Python sandbox + Mobile Agent Core: 45 tests, 0 failures
Android testDebugUnitTest: 474 tests, 0 failures, 0 errors, 2 skipped
Android API 35 bundled Chaquopy compute instrumentation: 1 test, 0 failures, 0 errors
M03-F01 restart evidence: 5/5 passed; M05-F04 forced retrieval evidence: 10/10 passed
Strict acceptance: M06-F04 accepted; total 35/72 (48.61%)
```

## 第 70 轮验收证据

### M06-F05 Desktop 专属命令能力 Handoff

- Android 在上传附件和进入本地 Agent Loop 之前执行 Desktop 专属能力预检，分别识别 PowerShell/Shell、交互 PTY、Git 和 Codex；新增独立 `PTY` capability，禁止用普通 Shell 能力冒充交互终端。
- 路由只选择在线、声明 `CHAT` 且完整具备请求能力的 Remote Runtime，并按显示名和 Runtime ID 确定性排序；不相关的普通问答保持 Android 本地执行。
- 有合格 Runtime 时显示用户可见确认框，明确说明 Android 尚未执行命令；确认后才生成脱敏、摘要绑定的 `HandoffPackage`，校验所有附件 SHA-256，并导航到目标 Remote Runtime。取消不会生成交接包。
- 没有在线或能力完整的 Desktop Runtime 时 fail closed，向用户明确说明“尚未执行任何命令”，不会把请求继续送入 Android 本地模型并伪装成功。
- OAEP 统一投影新增 `handoff.requested` 状态，重复事件保持幂等；规划器、产品接入顺序、确认 UI、离线路径和全量 Android 回归均通过。

```text
M06-F05 acceptance gates: 10/10 passed
Android Desktop Handoff focused suite: 11 tests, 0 failures, 0 errors
Android testDebugUnitTest: 477 tests, 0 failures, 0 errors, 2 skipped
Strict acceptance: M06-F05 accepted; total 36/72 (50.00%)
```

## 第 71 轮验收证据

### M06-F06 工作区自然任务 E2E

- API 35 模拟器上的 APK 使用独立 `:runtime` Chaquopy 进程处理自然中文任务“查找授权目录里的功能开关配置，把 `feature.enabled` 从 false 改成 true，并确认修改成功”；模型侧按上下文自主生成 list→search→read→edit→read 调用链。
- `workspace.edit` 执行前生成目标、before/after digest 与 unified diff，Host 审批收到 `+feature.enabled=true` 后确认；修改通过 `WorkspaceMutationJournal` 绑定 call ID、冲突检查并恰好提交一次，随后重新读取验证。
- 测试在前三个只读工具后主动终止第一条 Runtime 连接，使用持久化 Kernel Checkpoint 在新 `:runtime` 客户端恢复；恢复后继续审批、编辑、验证并产生 `run.recovered`、`file_change.completed` 和 `run.completed`。
- E2E 揭示并修复 Host 审批凭据被后续 Kernel Checkpoint 覆盖的真实缺陷：现在 Host intents/receipts/approvals 与 Core state 在互斥锁内深合并，审批在恢复与后续快照中保持有效；新增 JVM 回归固定该顺序。
- Runtime Service 的 Python 边界失败新增脱敏错误类型与日志，调用方错误包含消息类型和稳定原因，不再只显示无信息的 `python_runtime_unavailable`。

```text
M06-F06 acceptance gates: 12/12 passed
Android API 35 bundled Runtime natural workspace E2E: 1 test, 0 failures, 0 errors
Android testDebugUnitTest: 478 tests, 0 failures, 0 errors, 2 skipped
Strict acceptance: M06-F06 accepted; total 37/72 (51.39%)
```

## 第 72 轮验收证据

### M07-F01 版本化 Skill Manifest 与指令加载

- 新增跨端 `p9-skill-manifest-v1`：Skill digest 同时绑定 id、version、source、指令 SHA-256、排序后的 allowed-tools 与 required capabilities；Android/Kotlin 与共享 Python Kernel 对同一 fixture 生成完全相同的 digest。
- Android `SkillDefinition` 与外部只读 Manifest Decoder 强制校验必需字段、大小、工具名、能力、重复 ID 和 digest；外部 Skill 仍不可在 Android 动态执行脚本，未知或禁止能力 fail closed。
- 共享 Kernel 在 Run Capability Snapshot 构造时重新验证 Manifest；缺少 instructions/tools/digest、内容篡改、重复 Skill/工具、Host 能力不足或 allowed-tool 不在真实本 Run Tool Registry 中均拒绝启动。
- Android 生产 StartRun Envelope 现在携带 digest 与 allowed-tools；内置 device/memory/workspace Skill 明确声明可用工具，不再只有描述性标签。
- API 35 模拟器的独立 `:runtime` 进程实际加载合法 Skill，将指令注入权威 System Prompt，并在 Checkpoint 冻结 digest/tools；用原 digest 篡改指令后返回 `run_skill_digest_mismatch`。设备 XML 已复制到持久验收目录，避免后续 Gradle 运行覆盖。
- 共享 Kernel 变化后，Tool Verification、Prompt/Context、Memory、Citation、Workspace Diff、恢复、强制检索与 Sandbox Compute 关联证据均重新生成并保持绿色。

```text
M07-F01 acceptance gates: 11/11 passed
Python Skill Manifest + Mobile/Context/Prompt focused regression: 102 tests, 0 failures
Android testDebugUnitTest: 480 tests, 0 failures, 0 errors, 2 skipped
Android API 35 bundled Skill Manifest instrumentation: 1 test, 0 failures, 0 errors
Strict acceptance: M07-F01 accepted; total 38/72 (52.78%)
```

## 第 73 轮验收证据

### M07-F02 Skill 选择、Prompt 注入和 Tool 限制

- Android `SkillCatalog.select()` 依据当前任务文本和已具备能力选择 Skill；支持工作区、Memory、设备、附件领域及显式 `@skill.id`，不相关任务不注入 Skill，继续使用通用 Agent 工具集。
- 选择结果按稳定 ID 顺序固定到 Run；Catalog 刷新或后续输入不会改变进行中 Run 的 Skill 集，新 Run 才读取新版本。缺少所需 Runtime capability 的 Skill 不会被激活。
- Android 生产的预执行 schema 与实际 `RunCommand` 均使用同一任务输入选择 Skill，消除“诊断说激活”和“实际模型请求未激活”的分叉。
- Shared Kernel 先验证完整签名 Manifest 与 Host Tool Registry，再根据本 Run 已选 local Skill 的 allowed-tools 收窄实际工具集；Capability Snapshot、Model Tool Snapshot、Execution Tool Registry 和 Checkpoint 使用同一收窄结果。
- 未选择任何 Skill 时保留通用工具集；选择 Skill 后，模型尝试调用白名单外工具会在 Host 执行前以 `model_tool_not_in_snapshot` fail closed。
- System 与 Safety 层始终排在 Skill 指令之前；冲突或恶意 Skill 指令不能覆盖权威层。API 35 独立 `:runtime` 进程验证了 Prompt 顺序、工具收窄和越权拒绝。
- 本轮改动影响到的全部既有 P9 JSON 证据已重新生成；验收目录中 `passed=false` 为 0，source SHA-256 过期项为 0。

```text
M07-F02 acceptance gates: 11/11 passed
Python Skill selection/manifest/mobile/parity regression: 50 tests, 0 failures
Android SkillCatalog focused suite: 8 tests, 0 failures, 0 errors
Android testDebugUnitTest: 482 tests, 0 failures, 0 errors, 2 skipped
Android API 35 bundled Skill selection instrumentation: 1 test, 0 failures, 0 errors
Acceptance evidence audit: 0 failed reports, 0 stale source digests
Strict acceptance: M07-F02 accepted; total 39/72 (54.17%)
```

## 第 74 轮验收证据

### M07-F03 内置和用户声明式 Skill

- 内置 Skill Bundle 由 APK 当前签名证书 SHA-256、排序后的 Skill id/version/digest 清单共同生成版本化 attestation；签名或内容变化都会改变 attestation，签名读取失败时不再静默加载未绑定的内置 Skill。
- 新增账户隔离的用户声明式 Skill Store；只从 Android SAF `content://` URI 读取，输入上限 128 KiB，导入后复制为规范化 Manifest，不长期依赖外部文件路径或权限。
- 用户 Skill 仅允许 id/version/name/instructions/tools/capabilities/digest；`script`、`command`、`entrypoint`、`executable`、`code`、`classpath` 等动态代码字段 fail closed。共享 Python Kernel 只把 `user_declarative` 作为本地声明式指令 Manifest，不提供代码执行入口。
- 首次导入和每次版本升级后均默认禁用，必须由用户在“智能体/Skill”页面显式开启；页面同时提供禁用、回滚和删除。升级要求版本单调增加，同版本内容冲突和隐式降级均拒绝。
- Skill 历史保留有界版本用于回滚；回滚后再次默认禁用。SharedPreferences 使用账户 subject 的 SHA-256 作为隔离键，跨账户读取为空。
- 运行中的 Run 继续固定原 SkillDefinition；安装、启用、升级、回滚或删除只刷新 Catalog，新 Run 才看到新版本，避免执行中途 Prompt/Tool 白名单漂移。
- API 35 独立 `:runtime` 实测 SAF URI 导入、重建 Repository 后持久化、显式启用、`user_declarative` Prompt 注入与工具限制，以及真实 Debug APK 签名证书 attestation。
- 所有关联 P9 验收报告已重新生成；当前 `passed=false` 报告 0，source SHA-256 过期项 0。

```text
M07-F03 acceptance gates: 11/11 passed
Python Skill Manifest + Mobile Core regression: 46 tests, 0 failures
Android user Skill lifecycle focused suite: 4 tests, 0 failures, 0 errors
Android Skill Catalog focused suite: 8 tests, 0 failures, 0 errors
Android testDebugUnitTest: 486 tests, 0 failures, 0 errors, 2 skipped
Android API 35 SAF user Skill + bundled Kernel instrumentation: 1 test, 0 failures, 0 errors
Acceptance evidence audit: 0 failed reports, 0 stale source digests
Strict acceptance: M07-F03 accepted; total 40/72 (55.56%)
```

## 第 75 轮验收证据

### M07-F04 Android Streamable HTTP/SSE MCP

- Android Kotlin 安全层实现 MCP `2025-11-25` Streamable HTTP：先执行 `initialize`，再发送 `notifications/initialized`；POST 同时声明 `application/json` 与 `text/event-stream`，并校验协议版本、JSON-RPC ID、Content-Type、响应大小、分页和工具数量边界。
- 完整支持 `MCP-Session-Id` 与 `MCP-Protocol-Version`；Session 返回 404 时清除旧状态、重新初始化并重试原请求。SSE 连接在获得事件 ID 后中断时，以 GET、`Last-Event-ID` 和原 Session 恢复响应。
- `tools/list` 发现的工具被稳定命名为 `mcp.<server>.<tool>`，来源固定为 `mcp`，要求 MCP capability；`tools/call` 使用真实远端名称和结构化参数。MCP 工具按敏感工具处理，执行前必须审批，并严格绑定当前账户。
- 生产端点强制 HTTPS/443、禁止 user-info/fragment、本地地址和私网 DNS 结果，禁止自动重定向；401/403、错误协议、非法 schema、超限响应与非法 JSON-RPC 均 fail closed。
- Bearer Token 只存入 `EncryptedSharedPreferences`（AES-256 MasterKey），以账户 subject digest 与 server id 隔离；Token 不进入 Python、Kernel、模型 schema、OAEP 或 UI 状态。智能体/Skill 页面提供掩码 Token 的 MCP 连接入口。
- MCP 工具结果复用现有 OAEP Tool Call/Result 时间线映射；API 35 实测加密配置持久化、SSE 工具发现、实际调用、Session/协议 Header 和 OAEP 投影。
- 共享生产 Capability Manifest 将 `mcp.http` 从 Android unsupported 升级为 `local-equivalent`；`mcp.stdio` 仍保持 `remote-required`，不伪装本地 stdio 支持。
- 本轮修改影响的 23 个既有验收报告全部重跑；7 个设备型门禁逐项在 API 35 恢复验证。最终 P9 证据目录 `passed=false` 为 0，source SHA-256 过期项为 0。

```text
M07-F04 acceptance gates: 12/12 passed
Android MCP deterministic protocol suite: 6 tests, 0 failures, 0 errors
Android testDebugUnitTest: 492 tests, 0 failures, 0 errors, 2 skipped
Android API 35 encrypted MCP/SSE/call/OAEP instrumentation: 1 test, 0 failures, 0 errors
Shared Kernel capability/parity regression: 60 tests, 0 failures
Affected API 35 regression refresh: 7 suites green (one transient adb timeout retried successfully)
Acceptance evidence audit: 0 failed reports, 0 stale source digests
Strict acceptance: M07-F04 accepted; total 41/72 (56.94%)
```

### 下一轮优先级

## 第 76 轮验收证据

### M07-F05 stdio/桌面 MCP 显式 Handoff

- 新增独立 `MCP_STDIO` Runtime capability，和 Android 本地 `MCP`（Streamable HTTP/SSE）彻底分开；普通 HTTP MCP 请求不触发 Desktop Handoff，只有显式 `stdio MCP`/`MCP stdio`/桌面进程 MCP 请求才进入远端预检。
- 修复了生产 Remote Runtime capability 的实际解析缺陷：Room 中保存的是 JSON 数组，旧 codec 却只接受 JSON 对象，导致真实远端能力无法进入 Handoff 选择。新 codec 同时接受 Relay 数组和版本化对象，并将 `run.create`、`approval.decide`、`file.raw.read`、`mcp.stdio` 映射为真实运行能力。
- Desktop Full Runtime 仅在 `TOOLS_CONFIG.json` 存在 `type=mcp-std` 的真实配置时声明 `mcp.stdio`；未配置、仅配置 HTTP/SSE 或普通本地 Tool 时均不声明，避免 Runtime 虚报能力。
- Relay 协议允许 `mcp.stdio` 作为可选执行能力；legacy WSS hello 与 HAI HTTP query/heartbeat 都发布运行时协商后的能力集合。Python 与 Android 生成绑定已同步，代码生成漂移门禁通过。
- 同名 HTTP/stdio MCP 不会互相冒充：在线但只声明通用 MCP 的远端不满足 stdio，离线 stdio Runtime 也不满足；两者均明确返回“尚未调用任何工具”。
- 多个在线 stdio Runtime 按显示名和 Runtime ID 确定性选择；对话框显示目标、执行位置 `Desktop Runtime`、传输 `stdio`、MCP Server ID，并明确 Android 本地不执行、确认只创建 Handoff、远端工具调用仍需审批。
- Handoff Package 强制显式确认，并将 kind、execution location、transport、resource id 和 remote approval requirement 纳入 canonical digest；非法资源 ID fail closed。
- Android 模型可见的本地能力快照从不包含 `MCP_STDIO`；共享 Kernel 继续把 `mcp.stdio` 标记为 Android `remote-required`，因此没有伪造本地进程支持。

```text
M07-F05 acceptance gates: 12/12 passed
Python Relay/config/contract/connector regression: 65 tests, 0 failures
Android stdio MCP handoff suite: 4 tests, 0 failures, 0 errors
Android Handoff/HTTP MCP focused suites: 14 tests, 0 failures, 0 errors
Android testDebugUnitTest: 496 tests, 0 failures, 0 errors, 2 skipped
Affected API 35 regression refresh: 7 suites green
Acceptance evidence audit: 0 failed reports, 0 stale source digests
Strict acceptance: M07-F05 accepted; total 42/72 (58.33%)
```

## 第 77 轮验收证据

### M07-F06 Connector 生命周期

- MCP Connector 授权使用账户 subject SHA-256 隔离的 Android `EncryptedSharedPreferences`；配置摘要只保存 endpoint、enabled、scope 和到期时间，Bearer Token 不进入 `AppState`、Python、模型 Tool Schema、OAEP 或工具输出。
- 新增 `tools:list`、`tools:call:read`、`tools:call:write` 三类 scope；默认只授予发现与只读调用，外部写权限必须在连接对话框中显式开启。MCP `readOnlyHint` 缺失时按写操作 fail safe，不以未知工具冒充只读工具。
- 授权在工具发现前、模型 schema 投影时以及每次工具调用前重新检查；到期或撤销后 Token provider 立即返回空，工具立即从模型可见清单消失，直接调用也被拒绝。
- `ToolRegistry` 支持账号作用域注册键，同名 MCP 工具可以同时属于不同账号；第三账号的模型可见工具和实际调用均为 0。撤销一个账号只注销其工具与 HTTP Session，不影响其他账号。
- 产品页面显示 Connector endpoint、scope、到期状态，并提供 1～2160 小时授权期限、写权限显式开关和撤销按钮；撤销会删除 Token、关闭会话并注销工具，登出会断开该账号全部 Connector。
- App 重启只恢复 enabled 且未过期的 Connector；失败的首次连接会撤销刚写入的授权，避免留下“有凭据但无可用工具”的半完成状态。
- API 35 emulator 使用真实 Android 加密存储验证 Alice/Bob Token 隔离、最小 scope、到期、撤销、工具发现/调用和 OAEP 无凭据泄露；最新 APK 复测 2/2 通过。

```text
M07-F06 acceptance gates: 12/12 passed
Android Connector/MCP + Registry focused suites: 16 tests, 0 failures, 0 errors
Android testDebugUnitTest: 498 tests, 0 failures, 0 errors, 2 skipped
Android API 35 encrypted Connector lifecycle/MCP instrumentation: 2 tests, 0 failures, 0 errors
M07-F04 and M07-F05 affected evidence refreshed: 12/12 + 12/12 passed
Strict acceptance: M07-F06 accepted; total 43/72 (59.72%)
```

## 第 78 轮验收证据

### M08-F01 统一 Plan 状态机

- 新增共享 `p9-plan-state-v1`，由 Desktop 与 Android 的同一个 `DrSaiAgentKernel` 使用；每个 Run 只有一个稳定 `item_id=<run>:plan`，状态包含 version、text、explanation、steps、status 和 canonical SHA-256。
- `core.update_plan` 必须携带 `expected_version`；创建从 0 开始，每次成功更新严格递增。过期版本与同一模型批次的多个 Plan 更新均 fail closed，避免并发覆盖。
- Step 状态统一为 `pending/in_progress/completed/failed`；ID 唯一、标题和数量有界，同一时刻最多一个 `in_progress`。已完成/失败步骤不可回退或改写，进行中步骤不可退回 pending，步骤不可静默删除。
- 首次创建产生 `plan.started`，后续更新产生 `plan.updated`，全完成产生 `plan.completed`，任一步失败产生 `plan.failed`；Android OAEP 将失败映射为真实 `ItemFailed`，不伪装完成。
- Plan 完整状态和 digest 写入 Kernel Checkpoint；恢复时重新规范化并核验 schema、状态和 digest。相同 idempotency command 重放不增加版本、不产生第二个 Plan Item，恢复前后状态完全一致。
- Android 与 Desktop 以相同 fixture 运行共享 Kernel，Plan JSON 与 digest 完全一致；API 35 独立 `:runtime` 实测 Plan 创建，并继续覆盖 Core Tool、Workspace、审批、Artifact、Skill 与 Delegate 关键旅程。
- 修正 Critical Journey fixture：启动 Run 时提供权威 Model Tool Snapshot，测试不再依赖模型自报风险/审批或绕过 Registry。

```text
M08-F01 acceptance gates: 11/11 passed
Python Plan/Mobile/Kernel/Desktop focused regression: 113 tests, 0 failures
Android testDebugUnitTest: 498 tests, 0 failures, 0 errors, 2 skipped
Android API 35 Full Runtime critical Plan journey: 1 test, 0 failures, 0 errors
Affected API 35 regression refresh: process recovery, forced retrieval, MCP, sandbox, Skill all green
Acceptance evidence audit: 33 reports, 0 failed, 0 stale source digests
Strict acceptance: M08-F01 accepted; total 44/72 (61.11%)
```

## 第 79 轮验收证据

### M08-F02 Subagent 使用同一 Kernel、受控上下文和工具白名单

- `delegate` 不再把子任务直接伪装成父 Kernel 的第二次模型请求；每个子任务都通过唯一 `create_agent_kernel(surface=...)` 工厂创建真实子 Kernel，具有独立 run/session、状态机、checkpoint 与终态校验。
- Android 与 Desktop 的子 Kernel 使用相同工厂、Agent ID、Kernel version 和 Kernel SHA-256；`subagent.started`、模型请求和完成事件均携带可核验但不泄露内容的 Kernel 身份。
- 父上下文不再全文复制给子智能体：子输入仅包含显式 task，父上下文只以 SHA-256 摘要记录。测试证明父级私有内容不会进入子模型消息。
- 子智能体类型仅允许 `explore/general`；工具白名单只能从本 Run 已冻结的安全工具中缩小，且只允许无需审批的只读工具。`delegate`、`core.update_plan`、写入及敏感工具不能被子任务申请提升。
- 子智能体完成结果必须先由子 Kernel 消费 `MODEL_COMPLETED` 并达到 `run.completed`，再回填父 Kernel；子状态和模型请求进入父 checkpoint，恢复后仍保持相同身份与白名单。
- API 35 独立 `:runtime` Critical Journey 验证真实子 Kernel identity、空白名单和父子事件一致；受共享 Engine 影响的旧验收证据全部重放，34 份报告无失败、无过期源码指纹。

```text
M08-F02 acceptance gates: 10/10 passed
Python Subagent/Mobile/Kernel/Desktop focused regression: 117 tests, 0 failures
Android testDebugUnitTest: 498 tests, 0 failures, 0 errors, 2 skipped
Android API 35 Full Runtime Subagent critical journey: 1 test, 0 failures, 0 errors
Affected evidence refresh: 14 reports passed
Acceptance evidence audit: 34 reports, 0 failed, 0 stale source digests
Strict acceptance: M08-F02 accepted; total 45/72 (62.50%)
```

## 第 80 轮验收证据

### M08-F03 Subagent 调度、并发与资源降级

- 新增共享、版本化 `p9-subagent-scheduling-v1` 调度决策；固定最多 3 个活动子任务，前台最多 2 并行，后台、低内存和热限制状态最多 1 个串行执行。策略包含 lifecycle、mode、上限和 canonical SHA-256。
- Kernel 不再信任 Host 任意声明并发数：启动时核对 `subagent_max_active/subagent_max_parallel` 与生命周期的权威策略，不一致 fail closed；调度策略进入 `run.started`、lifecycle 事件与 checkpoint，恢复时重新计算并校验防篡改。
- Android Host 在每个 Subagent 模型批次前重新读取真实 Activity/Memory/Thermal 状态；前台转低内存或热限制时先向 Kernel 发送 `lifecycle_changed`，随后把剩余请求降为串行，不沿用 Run 启动时的旧并发值。
- 修复 Subagent checkpoint 恢复：恢复请求复用子 Kernel 保存的原始模型消息、工具白名单、Kernel digest 和父上下文 digest，不再退化成无工具的临时请求。
- 修复父 Run 取消的孤儿 Tool Call：取消时先为 `delegate` 写入每个子任务的 cancelled receipt，并记录完成的 side-effect identity，再清空 pending 子任务和写 terminal checkpoint；不存在缺失 Tool result 的终态对话。
- Python 覆盖前台双并行、三类受限状态串行、固定活动上限、单子任务取消、父任务取消、动态降级、恢复和策略漂移；Android Coordinator 覆盖前台、三类受限状态及运行中降级；API 35 Full Runtime 验证策略 identity 和 digest。

```text
M08-F03 acceptance gates: 10/10 passed
Python Subagent/Plan/Mobile/Kernel/Desktop focused regression: 129 tests, 0 failures
Android PythonAgentLoopCoordinatorTest: 17 tests, 0 failures, 0 errors
Android testDebugUnitTest: 500 tests, 0 failures, 0 errors, 2 skipped
Android API 35 Full Runtime scheduling identity journey: 1 test, 0 failures, 0 errors
Affected evidence refresh: 15 reports passed
Acceptance evidence audit: 35 reports, 0 failed, 0 stale source digests
Strict acceptance: M08-F03 accepted; total 46/72 (63.89%)
```

## 第 81 轮验收证据

### M08-F04 Subagent 结果和 OAEP Subtask

- `subagent.started/completed/failed/cancelled` 统一映射到同一个稳定 OAEP `subtask` Item；成功使用 ItemCompleted，失败使用带稳定错误码的 ItemFailed，取消使用 ItemCancelled。
- 事件补齐 `parent_run_id`、`child_run_id`、Kernel agent name/digest、标题、摘要和结果来源；Android UI/持久化不再只能看到无层级的文本片段。
- Android 模型 Host 将超时规范为 `model_timeout`，其他模型异常规范为 `model_host_failed`，并携带 `subagent_id` 送回 Kernel；协程取消仍向上传播，不会被误报成子任务失败。
- 部分成功会同时保留每个成功结果与失败 code；父模型收到完整结构化汇总。任一子任务失败后，即使父模型输出“全部成功”，Kernel 仍以 `run.failed(code=subagent_failed)` 终止，不伪造主任务成功。
- 父任务取消会先补齐 delegate cancelled receipt，再清理全部 pending 子任务；终态 checkpoint 无孤儿 Tool Call。每个 outbound envelope 在协议边界深拷贝冻结，后续状态变化不会篡改已发送模型请求或 OAEP 证据。
- API 35 Full Runtime 真实覆盖成功、部分成功、模型超时、父级虚假成功和父任务终态；受 Engine/Mapper 影响的 20 份旧证据全部重放。

```text
M08-F04 acceptance gates: 10/10 passed
Python Subagent/Plan/Mobile/Kernel/Desktop focused regression: 130 tests, 0 failures
Android PythonAgentLoopCoordinatorTest: 18 tests, 0 failures, 0 errors
Android PythonRuntimeEventMapperTest: 19 tests, 0 failures, 0 errors
Android testDebugUnitTest: 501 tests, 0 failures, 0 errors, 2 skipped
Android API 35 Full Runtime success/partial/timeout/fail-closed journey: 1 test, 0 failures, 0 errors
Acceptance evidence audit: 36 reports, 0 failed, 0 stale source digests
Strict acceptance: M08-F04 accepted; total 47/72 (65.28%)
```

### 下一轮优先级

1. 进入 M08-F05，实现符合 Android 后台限制的长任务通知、继续/取消和同 Run 恢复；
2. 真机恢复稳定 ADB 后重跑 `:runtime` identity instrumentation，完成 M01-F05 的设备证据；
3. 在物理 arm64 真机执行 30×3 真实模型自然任务门禁，完成 M04-F06；
4. 随 M08 依次完成 Plan 可视化、Subagent 生命周期、并发上限/取消、Checkpoint 恢复和长任务通知。

## 第 30 轮验收证据

### M04-F01 Tool 定义收敛到唯一 Registry

- 共享 Kernel 生成版本化 `p9-execution-tools-v1`，其输入是本次真实发给模型的 Tool schema，而不是静态宣传清单；
- 每个记录绑定 schema digest、执行器 ID、版本、来源、分类、所需能力、风险与审批模式；metadata 缺失、多余、重名、非法版本、schema/执行器漂移均 fail closed；
- Desktop Workbench/Handoff/Manager 与 Android Host Tool 均在模型请求前冻结注册表，执行时再次按名称查询；快照外调用、Checkpoint 篡改不能进入执行器；
- Desktop Tool 事件与 Android Tool/OAEP 事件携带同一注册表 digest 和策略字段，UI/诊断不再从模型输出推断风险。

### M04-F02 统一 Tool 能力与风险模型

- 对 `read_only/local_write/external_write/sensitive/forbidden × none/required/conditional` 组合执行属性测试；只读工具不得要求审批，外部写入/敏感工具不得无审批，禁止工具不可注册；
- 工具声明的 required capability 必须属于本 Run Host Capability Snapshot，否则在模型执行前 fail closed；Android Host Catalog 只向模型提供当前可执行集合；
- Android 忽略模型伪造的 `risk`/`requires_approval` 字段，使用冻结注册表决定审批；Desktop 必需审批经 Gateway Runtime Approval Channel 决策，审批通道缺失或拒绝时不调用执行器；
- 两个及以上并行 `Delegate` 使用一次批量审批；拒绝后每个 call_id 均返回错误，串行与并行执行器均不会被调用。

### 第 30 轮自动化结果

```text
Python focused execution-registry suite: 74 passed, 0 failed
Python production/runtime/parity suite: 115 passed, 0 failed, 1 warning
Android testDebugUnitTest: 421 tests, 0 failures, 0 errors, 2 skipped
Android assembleDebugAndroidTest: BUILD SUCCESSFUL
ADB devices: none; instrumentation APK compiled but not executed on arm64 device
```

### 未计分边界

- M04-F03 暂不计分：并行 Delegate 审批绕过已封堵，但完整最大步数、并发上限、混合审批和多轮结果回填矩阵尚未全部形成验收证据；
- M01-F05 暂不计分：当前 `adb devices -l` 为空，缺少本轮 arm64 真机 instrumentation 证据；
- P9 总体仍为 IN PROGRESS，Android 产品标签继续保持 Preview/Incomplete。

## 第 31 轮验收证据

### M04-F03 多轮与并行 Tool Calling

- 共享 Kernel 新增 `p9-tool-loop-v1`：默认且最大 24 个 Tool rounds、每批最多 8 个模型 Tool calls，非法版本、越界配置和被篡改 digest 均拒绝；
- Android 在修改 `pending_tool_calls`、消息或轮次前完成整个批次的名称、call_id、重复 ID、Registry、并行上限与审批组合校验，因此失败批次不再留下半写状态；
- Android 支持多个免审批 Host Tool 同批发出、乱序返回；中间结果不提前请求模型，最后一个结果完成后只产生一次后续 Model Request；
- `tool_round_count` 与 Tool Loop Policy 一同写入 Checkpoint。进程恢复后继续原计数，达到上限时产生结构化 `run.failed/tool_round_limit`，不再调用执行器；
- 必需审批工具不得与其他工具混批；Desktop 仅允许相同 Delegate 执行器组成的同质批次，经一次批量审批后并行；
- Desktop 并行 Subagent 结果改为使用原始 `call_id` 关联，不再按 `agent_type` 覆盖。同批两个 `research` 调用仍分别回填各自结果；Semaphore 与批次门禁共同保证不越过并发上限；
- instrumentation 契约验证真实 Android Python Runtime 导出 Tool Loop Policy 版本、digest 和初始轮次。

### 第 31 轮自动化结果

```text
Python focused Tool Loop/Registry suite: 75 passed, 0 failed
Python production/runtime/parity suite: 121 passed, 0 failed, 1 warning
Android testDebugUnitTest: 421 tests, 0 failures, 0 errors, 2 skipped
Android assembleDebugAndroidTest: BUILD SUCCESSFUL
ADB devices: none; arm64 instrumentation remains pending
```

### 下一验收目标

- M04-F04：统一 Tool 错误分类、只重试可重试错误、取消传播，并证明副作用重试不重复；
- M01-F05：ADB 恢复后补齐 arm64 真机 Runtime/Checkpoint/Tool Loop instrumentation；
- M04-F05/M10-F04：继续把 Tool 输出/Artifact/OAEP 与每 Run 能力诊断收敛到共享 Kernel 契约。

## 第 32 轮验收证据

### M04-F04 Tool 错误、重试和取消

- 共享 Kernel 将 `400/invalid_request`、`401/403/authorization`、`408/timeout`、`429/rate_limited`、`500/502/503/504/provider_unavailable`、`cancelled` 规范化为稳定 category、retryable、automatic_retry 和 actionable；
- Execution Tool Registry 为 read_only 工具生成最多两次尝试以及明确的瞬时错误白名单；local_write、external_write、sensitive 工具固定一次且白名单为空；
- Android Kotlin Host 仅在第一次调用返回明确失败 receipt、错误位于白名单且权威风险为 read_only 时重试一次。执行中断或结果不确定仍进入 reconciliation，不自动重放；
- Kotlin Host 从本地 `ToolRegistry` 独立解析权威风险。Python Runtime 谎报 read_only 或为外部写入声明两次尝试时，在执行器调用前拒绝；
- Desktop Workbench 对 read_only 的 503 执行一次受限重试；local_write 相同错误不重试，最终错误附带可操作建议；
- Android Tool failure 将结构化错误同时回填模型上下文和 OAEP `ItemFailed`；UI 可获得稳定 code、retryable 与 actionable message；
- 用户在 WAITING_TOOL 阶段取消时，所有 pending call 生成 cancelled Tool result、加入 completed identity、清空 pending，并与 `run.cancelled` 一同进入终态 Checkpoint；
- 既有 durable receipt/reconciliation 测试继续证明恢复、双击或传输重试不会重复外部副作用。

### 第 32 轮自动化结果

```text
Python focused Tool Error/Registry suite: 90 passed, 0 failed
Python production/runtime/parity suite: 136 passed, 0 failed, 1 warning
Android testDebugUnitTest: 425 tests, 0 failures, 0 errors, 2 skipped
Android assembleDebugAndroidTest: BUILD SUCCESSFUL
ADB devices: none; arm64 instrumentation remains pending
```

### 下一验收目标

- M04-F05：统一大输出、二进制、截断、Artifact 以及 Command/File Change 的 OAEP 映射；
- M10-F04：完善每 Run available/remote-required/blocked 能力诊断；
- M01-F05：设备恢复后执行 arm64 Runtime、Checkpoint、Tool Loop 和错误策略 instrumentation。

## 第 33 轮验收证据

### M04-F05 Tool 输出、Artifact 与 OAEP 映射

- 共享 Kernel 新增统一的内联输出上限、Artifact 数量上限及 descriptor 校验；无 Artifact 的主动截断或超限结果 fail closed；
- Android Kotlin Host 只转发不透明 Artifact descriptor，独立读取并核对 ID、MIME、size 和 SHA-256，不把文件路径或二进制正文送入 Python；
- Android Python Runtime 在修改 pending Tool 状态前原子校验 descriptor 与 `artifact_ids`，元数据不一致不会产生假完成；模型和 UI 仅得到有界摘要，完整结果保留在 Host Artifact Port；
- OAEP `artifact.created` 保留 MIME、size、SHA-256、previewable、downloadable 和 source call ID；同一 Tool 多次调用使用 call ID 生成唯一 OAEP item ID；
- Desktop 移除 `run_read` 的静默 5000 字符截断。大结果由 Gateway 注入的 Runtime Artifact handler 写入私有 payload store，模型仅接收 4096 字符预览及 Artifact ID；通道缺失时不暴露不完整结果；
- Runtime Artifact Store 自动迁移旧 SQLite schema，区分 Workspace 文件与 Runtime 私有 payload；私有二进制可跨进程重启读取，按 Workspace 隔离，支持有界 chunk 和完整 digest；
- Desktop FilesEvent、TUI translator 和 Structured Conversation projector 保留完整 Artifact 描述符；Command Execution/File Change 仍由冻结 Tool Registry 的 `oaep_output_type` 产生对应完成事件。

### 第 33 轮自动化结果

```text
Python focused Tool output/Artifact/OAEP suite: 112 passed, 0 failed
Python current production/runtime/parity suite: 122 passed, 0 failed
Python package-wide attempt: 127 passed before unrelated pre-existing
  test_codex_adapter_lifecycle_methods_delegate_and_close_idempotently failure
  (test sends "accept", current adapter contract accepts "approved")
Android testDebugUnitTest: 427 tests, 0 failures, 0 errors, 2 skipped
Android assembleDebugAndroidTest: BUILD SUCCESSFUL
Python changed modules py_compile: passed
git diff --check: no whitespace errors
ADB devices: none; arm64 instrumentation remains pending
```

### 下一验收目标

- M10-F04：把 available、remote-required、unsupported、blocked 原因和实际 Tool/Skill 数量完整投影到每 Run 诊断；
- M04-F06：执行冻结的 30 类自然任务真实模型统计门禁；副作用 durable receipt、重启 reconciliation 与跨端幂等属于 M11-F02，不混入本项；
- M01-F05：ADB 恢复后执行 arm64 Runtime、Artifact、Checkpoint 和 Tool Loop instrumentation。

## 第 34 轮验收证据

### M10-F04 每 Run 能力快照

- `p9-run-capabilities-v2` 将生产 Capability Manifest、模型实际可见 Tool、固定 Skill、Host Port 能力和环境阻塞事实合并为一个带 SHA-256 的不可变 Run Snapshot；
- 四类诊断互斥：`available` 表示本 Run 可直接或已连接远程执行，`remote_required` 表示必须连接 Desktop Runtime，`unsupported` 表示 Android 不提供，`blocked` 给出稳定能力 ID 和原因码；
- Android 在创建 StartRun 前采集当前 SAF 授权和经系统验证的网络状态；纯 Kotlin builder 覆盖 SAF 读写、网络和远程 Runtime 在线/离线矩阵；
- Snapshot、输入事实和 digest 写入 Checkpoint；恢复时按原始 Run 事实重建并严格比对，权限或网络后续变化不改变进行中的 Run，新 Run 才获取新快照；
- `run.started` 携带 snapshot version/digest 和四类诊断；Android OAEP mapper 生成 `run_capability_snapshot` notice，结果中心和持久化时间线均可读取分类与阻塞原因；
- 远程能力只能从 Manifest 中声明为 `remote-required` 的集合提升为 available；把 unsupported 能力伪装为远程可用会 fail closed。

### 第 34 轮自动化结果

```text
Python focused Kernel/Mobile capability suite: 88 passed, 0 failed
Python capability/runtime/parity suite: 94 passed, 0 failed
Android testDebugUnitTest: 430 tests, 0 failures, 0 errors, 2 skipped
Android assembleDebugAndroidTest: BUILD SUCCESSFUL
ADB devices: none; arm64 instrumentation remains pending
```

### 下一验收目标

- M04-F06：在 arm64 真机上完成 30 类自然任务、每类至少 3 次的真实模型统计门禁；
- M01-F05：设备在线后执行 arm64 Capability Snapshot/Artifact/Checkpoint instrumentation；
- M01-F01：把 Desktop 实际生产能力动态枚举并与 Android v2 Snapshot 的分类做完整 manifest 差异验收。

## 第 35 轮实施与待验收证据

### M04-F06 自然任务工具选择

- 冻结 `p9-natural-tool-selection-v1.json`：恰好 30 类真实任务，覆盖时间、设备、Memory、SAF 工作区、文本统计、计划、委派、无需工具和能力边界；提示词不得包含期望工具 ID；
- 共享 Python 评分器将 `missing_required_tool`、`wrong_tool`、`meaningless_tool_call`、`duplicate_tool_call` 计为行为失败；provider/network 错误单独计数，既不伪装成模型行为失败，也不能减少每类至少 3 次有效行为样本的要求；
- Android instrumentation 不再使用“唯一工具 + 强制工具名”。每次运行向真实模型暴露生产 `ToolRegistry + FullRuntimeToolCatalog`，经 `PythonRuntimeClient + PythonAgentLoopCoordinator + HaiPythonModelHostPort` 走共享 Python Full Runtime；
- 选择记录位于 Model Host Port，因此 Android Host Tool 以及 Python Core 内部处理的 `core.text_stats`、`core.update_plan`、`delegate` 都会被计入；执行结果使用无副作用稳定 fixture，避免自然选择统计污染用户 Memory 或 SAF 文件；
- 真机输出保存在 Debug 应用私有目录，只含 case ID、attempt、工具名、终态和稳定错误码；Host runner 拉取后使用共享评分器生成权威 JSON，不导出 API Key 或提示词；
- 生产 `HaiModelClient` 新增默认关闭的可选 `requestTemperature`，不改变正常应用请求；验收实例固定为 `0.0`，OpenAI-compatible 与 Anthropic 请求体均使用同一值；
- 证据绑定 provider/model、固定温度、重复次数、Kernel/Prompt/Tool/Host Capability/APK digest 和脱敏物理设备身份。

### 第 35 轮自动化结果

```text
Python test_p9_natural_tool_selection.py: 5 passed, 0 failed
Android testDebugUnitTest: 430 tests, 0 failures, 0 errors, 2 skipped
Android compileDebugAndroidTestKotlin: BUILD SUCCESSFUL
Android assembleDebugAndroidTest: BUILD SUCCESSFUL
Debug app APK: OpenDrSai-Android-v1.5.6.apk
Debug test APK: app-debug-androidTest.apk
ADB devices: none; 90-run real-model gate not executed
Strict acceptance: M04-F06 remains pending; total remains 9/72 (12.50%)
```

真机恢复后执行：

```powershell
.\.venv\Scripts\python.exe scripts\accept_android_p9_natural_tool_selection.py --serial <serial> --model deepseek-v4-flash
```

只有 `docs/android/reports/evidence/p9/m04-f06-natural-tool-selection.json` 的 `passed=true`，且 30 个 case 均满足各自冻结阈值时，才允许把 M04-F06 改为 accepted。

## 第 36 轮验收证据

### M01-F01 Desktop 生产能力 parity manifest

- 新增 `p9-production-parity-v1`，与静态能力合同分工明确：静态 manifest 描述 Surface 允许宣称的能力，生产 parity manifest 描述一个具体 Desktop 生产 Agent 实际构造出的能力；
- `create_agent()` 在真实 `assistant_cls` 构造完成后生成初始 manifest；实际 `DrSaiAssistant.export_production_parity_manifest()` 可在 User Tool、Skill、MCP 或 Subagent 懒加载后重新枚举，不以工厂参数冒充运行时能力；
- 动态枚举域覆盖 Prompt、Context、Tool Policy、Model、Memory、Skill、Subagent 和 Tool；Tool 同时读取 Agent、Workbench、Handoff、User Config、Skill、Delegate、Todo 和 Scheduled Tool 集并按名称去重；
- 每个能力具有 `desktop` 与 `android` 两端分类，值严格限制在 `shared/local-equivalent/remote-required/unsupported`；Desktop Shell/PowerShell 在 Android 分类为 remote-required，未知外部/MCP Tool 默认 unsupported，不能伪装成本地能力；
- JSON 只保留稳定 ID、实现类型、行为开关、数量和 SHA-256；Prompt/Skill 正文、API Key、Workspace/Skill 绝对路径和 Memory 内容不导出；
- 相同 Agent 清单顺序无关且 digest 稳定；新增或懒加载 Tool 会改变 digest；规范化后能力 ID 冲突直接拒绝，避免差异报告静默覆盖。

### 第 36 轮自动化结果

```text
Python production parity manifest/factory/kernel suite: 63 passed, 0 failed
Python manifest + acceptance ledger final suite: 65 passed, 0 failed
Python changed modules py_compile: passed
Android testDebugUnitTest: 430 tests, 0 failures, 0 errors, 2 skipped
Android assembleDebugAndroidTest: BUILD SUCCESSFUL
ADB devices: none
Strict acceptance: M01-F01 accepted; total 10/72 (13.89%)
```

## 第 37 轮实施记录（未计分）

- 新增唯一 `agent_kernel_factory.create_agent_kernel(surface=...)`，支持 Android、Desktop、TUI 和 Test；所有 Surface 均返回 `DrSaiAgentKernel`，共享 Kernel/Prompt digest，Surface 差异只体现在 capability manifest；
- `MobileAgentCore` 降为兼容别名，`create_shared_mobile_core` 降为兼容转发；Android `runtime_probe`、Desktop/TUI Adapter 和 Desktop/TUI `create_agent` 均不再直接实例化 Agent Loop；
- Android health 新增 `agent_type=drsai-agent-kernel`，identity 必须来自工厂实例；工厂实例类型与 identity 不一致时 fail closed；
- M01-F02 保持 pending：旧 `DrSaiAssistant.run_stream` 仍是 Desktop/TUI 主执行循环。仅仅挂载 `_shared_agent_kernel` 不能证明单一生产 Agent Loop，必须继续完成 M01-F04 的真实入口迁移。

```text
Python Agent Kernel factory/probe/cross-runtime suite: 43 passed, 0 failed
Strict acceptance: unchanged at 10/72 (13.89%)
```

## 第 38 轮验收证据

### M10-F05 Tool 决策诊断

- 共享 `p9-tool-decision-v1` 在 Run 启动时只冻结 required/available capability domain 和 digest，不保存额外 Prompt 副本；
- 需要工具且正确选择、需要工具但遗漏、需要工具但能力不可用、无需工具直接回答、可选工具调用、已有 Tool receipt 后完成回答均有互斥稳定 category/reason；
- `tool.decision` 只包含 policy version、requirement digest、category、reason、domain/tool 数量和 round，不包含用户文本、Tool 参数、文件路径、Memory、Skill 指令、模型 reasoning 或 Chain-of-Thought；
- Host Tool 执行场景继续保证 durable checkpoint 位于诊断和 side effect 前；诊断事件不会改变审批、执行或重试顺序；
- Android OAEP 映射为 `tool_decision` Notice；遗漏/不可用使用 warning，其余为 info，结果中心和持久化 OAEP 时间线可统一消费；
- Desktop、TUI、Android fixture 已加入 `tool.decision`，规范化事件序列保持完全一致。

### 第 38 轮自动化结果

```text
Python Tool decision/Kernel/Mobile/cross-runtime suite: 99 passed, 0 failed
Android PythonRuntimeEventMapperTest: passed
Android assembleDebugAndroidTest: BUILD SUCCESSFUL
Python final focused + acceptance ledger suite: 103 passed, 0 failed
Android testDebugUnitTest: 431 tests, 0 failures, 0 errors, 2 skipped
ADB devices: none
Strict acceptance: M10-F05 accepted; total 11/72 (15.28%)
```

## 第 39 轮验收证据

### M11-F03 依赖、SBOM 与供应链

- 初次审计主动拒绝旧 v1.5.6 供应链绿灯：当前 `debugRuntimeClasspath` 为 179 项，旧证据仅覆盖 159 项；Firebase、DataStore 等新增/升级依赖未被旧 OSV 扫描覆盖；
- `scan_android_p9_osv.py` 从当前 Gradle resolved graph 生成精确 Maven 坐标，分批提交 OSV 官方 `querybatch` API；新证据覆盖 179/179，known vulnerability findings 为 0；
- `accept_android_p9_supply_chain.py` 对 OSV 包集合与当前 Gradle 集合做双向相等校验，并限制证据最大年龄为 7 天；新增、移除、升级或过期都会 fail closed；
- CycloneDX 1.5 包含 179 个 Maven component；每项具有从本机实际解析缓存取得的 SHA-256，并从 POM/parent POM 递归取得许可证，missing hash/license 均为 0；
- Python 部分绑定 49 个共享 Runtime 源文件及其组合 digest，并直接从候选 APK 枚举、hash 50 个 Chaquopy/CPython asset/native artifact；
- Android 当前不内置 Skill，SBOM 明确记录 `skill_count=0` 和空 inventory，而不是省略 Skill 域；后续加入任何 bundled `SKILL.md` 会自动进入 hash inventory；
- 生产 Android/共享 Runtime 静态扫描拒绝动态 pip、动态 Dex loader 和下载后执行；普通受控 Host 进程能力不被错误等同为供应链下载，最终 findings 为 0；
- SBOM、OSV 报告和 acceptance report 均绑定当前 `OpenDrSai-Android-v1.5.6.apk` SHA-256。

### 第 39 轮自动化结果

```text
Current Gradle debugRuntimeClasspath: 179 components
Official OSV batch scan: 179 packages, 0 findings
CycloneDX gates: 11/11 passed
Missing Maven hashes: 0
Missing Maven licenses: 0
Python sources: 49; APK Python/Chaquopy artifacts: 50
Bundled Skills: 0 (explicit inventory)
Static dynamic-install/download findings: 0
Python P9 supply-chain verifier: 4 passed, 0 failed
Python supply-chain + acceptance ledger final suite: 6 passed, 0 failed
Android testDebugUnitTest: 431 tests, 0 failures, 0 errors, 2 skipped
Android assembleDebugAndroidTest: BUILD SUCCESSFUL
Strict acceptance: M11-F03 accepted; total 12/72 (16.67%)
```

## 第 40 轮验收证据

### M02-F02 Tool/Verification Policy

- 共享 Kernel 在 Run 启动时冻结需验证 capability domain；最新事件、明确核实/来源请求、带年份实体及混合大小写陌生实体进入 retrieval-required，算术、稳定常识和主观问题保持 direct answer；
- retrieval-required Run 的流式正文先被缓冲，模型直接作答不会到达 UI；首次遗漏或选择错误 domain 的工具时发出 `verification.required` 并确定性重试一次，第二次仍遗漏则以 `verification_required_tool_omitted` fail closed；
- 缺少匹配检索能力时，Core 丢弃模型猜测，生成明确的本地能力限制消息和 `verification.unavailable`，不再把 HEPiX2026 等未经验证答案标记为成功；
- 正确工具必须命中 required domain；`get_current_time` 不能冒充 retrieval。Desktop 的 `web_search`、`knowledge_search` 与 Android/协议风格的 `web.search`、`browser.search`、`mcp.search` 统一归类；
- 验证重试次数进入 durable checkpoint，恢复后不能绕过一次重试上限；
- Android 将验证必需、验证不可用和错误工具选择映射为 OAEP warning Notice，只携带稳定 code、reason、digest 和计数，不携带任务正文或模型思维链；
- 本项验收的是共享 Tool/Verification Policy 及 Android 执行路径。Desktop/TUI 生产主循环仍由 M01-F04 负责迁移，未借本项提前接受 M01-F02/M01-F04。

### 第 40 轮自动化结果

```text
Tool/Verification acceptance fixtures: 10/10 passed
Python verification/decision/Mobile/cross-runtime suite: 106 passed, 0 failed
Android testDebugUnitTest: 433 tests, 0 failures, 0 errors, 2 skipped
Acceptance evidence source hashes: generated
ADB devices: not required for this policy-level item
Strict acceptance: M02-F02 accepted; total 13/72 (18.06%)
```

## 第 41 轮实施记录（未计分）

- 修复共享 Kernel 的 Surface 硬编码：Desktop/TUI 工厂实例现在使用 `desktop` 生成 Host Port、Run capability snapshot、model Tool snapshot 和 execution registry；Android 保持 `android`，Surface 只能由工厂绑定，Run payload 不能伪造；
- `create_mobile_agent_core()` 明确降为 Android 兼容测试入口；Desktop/TUI 必须走唯一工厂，避免测试 helper 再次掩盖生产 Surface 漂移；
- Desktop 与 TUI 保持完整事件和诊断一致；Android 与 Desktop 只允许 capability diagnostics/digest 存在声明过的 Surface 差异，其余 OAEP 语义事件继续逐项一致；
- 新增依赖无关的 `DesktopKernelCoordinator`。它只服务 Kernel 发出的 Model、Tool 和 Checkpoint Host 请求，不拥有 Agent 决策；直接回答和一次 Tool 循环的确定性测试均证明事件、Tool 执行和终态由工厂 Kernel 驱动；
- M01-F04 仍为 pending：生产 Autogen model/workbench/manager Tool、审批、Artifact、Memory/State 与事件翻译尚未全部接入新协调器，`DrSaiAssistant.run_stream` 尚未删除旧决策循环；
- M01-F02 同样保持 pending：Surface 修复和协调器是必要条件，但不能替代真实生产入口迁移证明。

```text
Python factory/Mobile/cross-runtime regression after Surface fix: 53 passed, 0 failed
Python DesktopKernelCoordinator + factory/Mobile/cross-runtime suite: 43 passed, 0 failed
Python combined Round 41 + accepted-ledger suite: 61 passed, 0 failed
Android testDebugUnitTest: 433 tests, 0 failures, 0 errors, 2 skipped
Strict acceptance: unchanged at 13/72 (18.06%)
```

## 第 46 轮验收证据

### M02-F04 项目指令与 SAF 指令文件

- Android 只识别 SAF 根目录的 `AGENTS.md`、`DRSAI.md` 与 `.drsai/DRSAI.md`，并将它们固定注入共享 Kernel 的 Project 层；非 SAF 来源、错误层级、空内容、陈旧 digest 和超过 8000 字符的合并内容全部 fail closed；
- `SafWorkspaceStore.hasReadGrant()` 同时核对已保存 URI 与 Android 持久化读权限；项目指令加载器在授权缺失或被撤销时先短路，行为测试证明内容读取调用次数为 0；Capability、Agent 描述和个人中心状态也不再把仅保存 URI 误报为仍有权限；
- 每个指令文件以规范化内容 SHA-256 绑定，合并 Prompt 携带脱敏来源 ID 与 digest；文件内容变化会改变版本清单和最终 Project Prompt；
- `PythonSharedCoreChatEngine` 通过单独的 Envelope 边界把项目字段送入 Full Runtime，只接受 `project_instructions` 与 `project_instruction_versions`；伪造 `system_prompt`、`tool_policy` 等字段会被拒绝；
- 共享 Prompt 优先级仍为 System → Safety/Tool Policy → Agent/Skill → Project，恶意项目指令无法覆盖高优先级安全和工具验证策略。

```text
SAF project-instruction acceptance gates: 12/12 passed
Python Prompt/Context/Mobile/cross-runtime + ledger suite: 95 passed, 0 failed
Android focused SAF/Context/OAEP suite: BUILD SUCCESSFUL
Android testDebugUnitTest: 438 tests, 0 failures, 0 errors, 2 skipped
Strict acceptance: M02-F04 accepted; total 15/72 (20.83%)
```

## 第 47 轮验收证据

### M02-F05 统一 Token Budget、裁剪与摘要

- 共享 Kernel 新增版本化 `p9-context-budget-v1`，统一上下文窗口、输出预留、消息上限和摘要预算；Desktop 从生产模型配置绑定 `token_limit/max_tokens`，Android 从实际选中 `ModelInfo.contextTokens/maxOutputTokens` 绑定，缺失元数据使用保守默认值；
- Token 估算按 UTF-8 字节保守计算，中文、Emoji 和混合 Unicode 不再被简单字符数低估；每次模型请求都重新验证输入估算值不超过 `context_window - reserved_output`；
- 500 轮长历史按确定性顺序裁剪并生成低优先级会话摘要；第一条权威 System/Tool Policy、当前用户意图始终固定保留；
- assistant Tool Call 与对应 Tool Result 作为原子单元选择，禁止裁剪出孤立 Tool Result；最近活动 Tool 链无法装入窗口时 fail closed，不会静默丢失后继续向模型伪装完整上下文；
- Context Budget 及脱敏估算进入 Run、模型请求和 Checkpoint，恢复后继续使用同一预算，防止重启绕过限制。

```text
Context-budget acceptance gates: 10/10 passed
Python Context/Prompt/Verification/Mobile/Desktop regression: 122 passed, 0 failed
Android testDebugUnitTest: 439 tests, 0 failures, 0 errors, 2 skipped
M02-F02/F03/F04 evidence regenerated against current shared Kernel hashes: all passed
Strict acceptance: M02-F05 accepted; total 16/72 (22.22%)
```

## 第 48 轮验收证据

### M02-F06 Prompt/Context 可观测性

- 共享 Kernel 生成版本化 Context observability snapshot：逐层记录稳定 ID、脱敏来源、字符数、保守 Token 估算、SHA-256、applied/absent 状态与 trim reason；未配置层也明确显示 `not_configured`，不再因缺少记录而无法判断是否生效；
- Context 部分记录窗口、输出预留、输入上限、当前估算、剩余额度、原始/纳入/省略消息数、摘要是否生效和裁剪原因；只输出数值、枚举及 digest；
- 绝对路径、父目录路径和异常来源统一替换为 `external-source`；Android OAEP Mapper 再做一次字段 allowlist，注入额外 `content`、`raw_prompt`、`absolute_path` 或密钥字段不会进入结果中心；
- Android `run.started` 同时产生 `prompt_layer_snapshot` 与 `context_observability_snapshot` Notice，现有 OAEP 持久化与结果中心链路可直接查看和导出；Checkpoint 保留相同脱敏快照，恢复不丢失预算证据。

```text
Context-observability acceptance gates: 8/8 passed
Python Prompt/Context/Mobile/Desktop regression: 121 passed, 0 failed
Android focused OAEP observability test: BUILD SUCCESSFUL
Android testDebugUnitTest: 440 tests, 0 failures, 0 errors, 2 skipped
M02-F02/F03/F04/F05 evidence regenerated against current shared Kernel hashes: all passed
Strict acceptance: M02-F06 accepted; total 17/72 (23.61%)
```

## 第 49 轮验收证据

### M03-F01 统一短期会话上下文

- 共享 Kernel 新增结构化 Conversation Context 校验：assistant Tool Call ID 必须唯一，Tool Result 必须匹配此前未闭合的 call_id；模型请求前禁止孤立 Tool Result 和缺失结果，等待 Tool/审批/Subagent 的 Checkpoint 允许显式 pending；
- 每个模型请求和 Checkpoint 都携带 message/tool call/tool result/pending 计数与 canonical SHA-256；恢复时重新计算并核对，消息内容、顺序或 Tool 对应关系被篡改都会 fail closed；
- 自动化完成两轮 Tool Call，并在第一轮后用全新 Kernel 实例恢复；恢复前后模型消息逐项相同、conversation digest 相同，第二轮继续保持 2 个调用与 2 个结果闭合；
- API 35 `OpenDrSai_API35_Runtime` 模拟器实际执行 Android instrumentation：启动独立 `:runtime`、持久化 Checkpoint、关闭客户端确认进程退出、由新客户端启动新 Runtime 进程并恢复；1/1 通过，恢复前后消息和 digest 相同。

```text
Short-term-context acceptance gates: 5/5 passed
Python Mobile/Context/Prompt/Verification/Desktop regression: 123 passed, 0 failed
Android API 35 runtime-process restart instrumentation: 1 passed, 0 failed
Android testDebugUnitTest: 440 tests, 0 failures, 0 errors, 2 skipped
M02-F02～F06 evidence regenerated against current shared Kernel hashes: all passed
Strict acceptance: M03-F01 accepted; total 18/72 (25.00%)
```

## 第 50 轮实施记录（未计分）

### M03-F02 长期记忆策略基础

- 新增共享 `p9-memory-policy-v1`：保存、替换和删除均要求当前用户输入具有明确的长期记忆意图；策略只保存允许的操作枚举和 digest，不保存用户正文；Checkpoint 恢复核验策略 digest；
- `save_memory` 和 Desktop `memory` mutation 在共享 Kernel 调用 Host 前统一检查；普通问答中模型擅自保存会被拒绝，凭据、Bearer、API Key、Private Key、密码和病历/诊断等敏感内容即使用户明确要求也拒绝持久化；
- Android 关闭记忆后不再声明 `LOCAL_MEMORY` capability，`save_memory/search_memory` 从模型 schema 中移除；Host Tool 增加同能力门和敏感内容二次检查；
- Android DAO 保存、搜索、快照和删除均绑定 `accountSubject/userId`；自动化以 Alice 调用证明写入和查询不会改用其他 subject；Memory Settings key 从可能碰撞的 `hashCode` 改为 SHA-256；
- 本轮暂不验收 M03-F02：Desktop 的旧多模态兼容入口仍能绕过共享 Kernel 调用旧 `memory` mutation。必须完成 M01-F04 的全部入口迁移后，再证明不存在该旁路。

```text
Python Memory policy + Mobile/cross-runtime focused suite: 46 passed, 0 failed
Python Round 50 combined regression: 128 passed, 0 failed
Android Memory/Context/Tool focused suite: BUILD SUCCESSFUL
Android testDebugUnitTest: 442 tests, 0 failures, 0 errors, 2 skipped
Strict acceptance: unchanged at 18/72 (25.00%); M03-F02 pending on M01-F04
```

## 第 45 轮验收证据

### M02-F03 分层 Agent/Skill/Project/Memory Prompt

- 共享 Kernel 固定 `System → Safety/Tool Policy → Agent Profile → Skill → Project → Memory → Conversation` 顺序；层级政策明确低优先级内容不得覆盖更高优先级安全/System 指令；
- Skill 层按稳定 ID 排序，输入清单任意排列均产生同一 Prompt 和 digest；Agent、Project、Memory 为空时不制造空层；
- 每层限制长度，总 authoritative Prompt 设置 28K 上限，越界 fail closed；当前用户消息与第一条权威 System Prompt 继续由 Context budget 强制保留；
- `run.started` 新增脱敏 `prompt_layers`，每层只含 ID、source、chars 和 SHA-256，不含 Prompt 正文、Token、路径或 Memory 内容；checkpoint/resume 保留同一诊断；
- Android OAEP 映射新增 `prompt_layer_snapshot` Notice，结果中心可证明各层来源和 digest；
- 恶意 Skill/Project/Memory conflict fixture 保持在高优先级政策之后，不能替换第一条 System 层；6 项机器验收门全部通过。

```text
Prompt-layer acceptance gates: 6/6 passed
Python Prompt/Context/Mobile/cross-runtime suite: 93 passed, 0 failed
Python identity/production parity regression with new base Prompt: 99 passed, 0 failed
Android testDebugUnitTest: 434 tests, 0 failures, 0 errors, 2 skipped
Strict acceptance: M02-F03 accepted; total 14/72 (19.44%)
```

## 第 43 轮实施记录（未计分）

- Desktop Coordinator 接入 Attachment Artifact Port；文本附件严格执行 describe/read 后才进入首个模型请求，Artifact identity/operation 不一致会 fail closed；
- Kernel checkpoint 通过 `AgentKernelCheckpointPort` 深拷贝写入 Agent state；`DrSaiAgentState.save_state/load_state` 新增 checkpoint 字段，现有 Gateway/TUI DB 状态保存链可携带 Run phase、pending Tool 与幂等身份；
- 新增 Desktop Kernel 事件桥，将 message/reasoning/Tool/verification/approval/terminal OAEP 事件转换为现有 Autogen Desktop/TUI 流；未知 OAEP 扩展保留为结构化日志，不静默丢弃；
- 新增 `DesktopKernelRunStream`，由 Kernel 终态生成现有 `TextMessage + TaskResult` 合同，并拒绝缺失终态或 `run.failed`；
- 新增 Autogen 历史双向迁移、Tool schema/risk 绑定和 Desktop Start Envelope 构建；敏感/外部写 Tool 在 Kernel 路径统一 fail-safe 为每次审批；
- 新增生产形态 `run_agent_through_kernel` Adapter，并在 `DrSaiAssistant.run_stream` 接入显式 pilot 开关 `DRSAI_P9_DESKTOP_KERNEL_PILOT=1`；确定性测试证明真实 Agent 属性、既有 Model Client、Workbench、state 与工厂 Kernel 已形成端到端流；
- pilot 尚未成为默认：manager Tool 当前会明确报 `desktop_kernel_manager_port_unimplemented`，不会伪装成完整迁移。完成 Skill/Delegate/Todo/Scheduled Task Host Adapter 后才能移除开关和旧循环。

```text
Python Artifact/checkpoint + coordinator/Mobile suite: 44 passed, 0 failed
Python Kernel event/run-stream suite: 16 passed, 0 failed
Python production-shaped Agent Kernel pilot + Host ports/factory suite: 22 passed, 0 failed
Strict acceptance: M01-F02/M01-F04 remain pending; total 13/72 (18.06%)
```

## 第 44 轮实施记录（未计分）

- 新增 `DesktopAgentManagerPorts`：Skill 读取及 required Tool elevation、TodoWrite、UpdateUserConfig、Delegate，以及 ScheduledTaskManager 的 create/list/get/delete/toggle/get_results/get_outputs/read_output 均有专用 Host Adapter；未知 manager Tool 明确 fail closed；
- 大于 16KB 的普通或 manager Tool 输出通过现有 `_tool_output_artifact_handler` 保存完整 JSON Artifact，并将 artifact ID/size/hash 回送 Kernel；缺失 Artifact 通道时返回稳定失败，模型看不到截断后伪装完整的内容；
- `AutogenDesktopModelPort` 恢复有界模型重试：只重试显式可重试异常，失败尝试的流片段不会提前进入 UI；耗尽后 Coordinator 发送 `MODEL_FAILED`，Kernel 生成 `run.failed + terminal checkpoint`；
- Run Tool schema 新增 `approval_mode=none/conditional/required`。Desktop 条件敏感 Tool 保留 conditional，不再因 Android 的布尔审批合同被误升级；Android external/sensitive Tool 继续 required；
- Desktop/TUI 普通文本生产 Run 现已默认进入共享 Kernel；`DRSAI_P9_DESKTOP_KERNEL_LEGACY=1` 是显式紧急回退，禁止自动静默 fallback；命令模式和非字符串多模态仍暂时走旧兼容入口；
- 因多模态与 default-subagent 路由尚未迁移、旧循环尚未删除，M01-F04/M01-F02 继续 pending，未用“默认文本已切换”替代完整生产入口验收。

```text
Python manager Tool + production Agent adapter/Host ports: 16 passed, 0 failed
Python approval-mode Kernel/Mobile/context suite: 100 passed, 0 failed
Python Round 44 combined focused + acceptance ledger suite: 139 passed, 0 failed
Android testDebugUnitTest: 433 tests, 0 failures, 0 errors, 2 skipped
Tool/Verification evidence regenerated against current Kernel hashes: 10/10 passed
Strict acceptance: unchanged at 13/72 (18.06%)
```

## 第 42 轮实施记录（未计分）

- `DesktopKernelCoordinator` 新增审批 Host Port；approval ID、Tool Call ID 和 decision 均严格校验，高风险工具只有 Kernel 收到 approved 回执后才会产生 Tool 执行请求；rejected 直接进入 `run.cancelled`；
- 新增 `AutogenDesktopModelPort`，将 Kernel 的 canonical System/User/Assistant/Tool context 转换为配对的 Autogen message，复用现有模型客户端流式调用，并将 `CreateResult`/`FunctionCall` 规范化回 Kernel；非法 Tool 参数和缺失终态结果 fail closed；
- 新增 `AutogenDesktopToolPort`，普通工具显式走 Workbench，handoff 走对应 Host Tool；Skill、Delegate、Todo、Scheduled Task 等 manager Tool 必须注册专用 adapter，禁止意外落入普通 Workbench；
- M01-F04 继续 pending：已具备 Kernel 协调、模型、普通 Tool、审批四条主 Host Port，但 manager Tool、Artifact、持久化与生产事件桥尚未全部接通，旧 `run_stream` 尚未切换。

```text
Python Desktop Kernel coordinator approval suite: 5 passed, 0 failed
Python Desktop Autogen Model/Tool ports + coordinator suite: 10 passed, 0 failed
Strict acceptance: unchanged at 13/72 (18.06%)
```

## 第104轮验收证据

### M11-F04 性能与资源预算

- 修复 Android API 26 独立 Runtime 进程启动崩溃：`Application.getProcessName()` 仅在 API 28+ 调用，API 26/27 从 `/proc/self/cmdline` 解析实际进程名。
- 当前同一候选 APK 已覆盖 API 26、30、35、36，并覆盖 x86_64 与 arm64-v8a；每台设备执行 10 次真实 Full Runtime 冷启动。
- 四台设备共 44 项冻结预算门禁全部通过，覆盖冷启动 P95、前台/峰值 PSS、CPU、存储、本地探针网络、耗电、热状态、进程释放与零 ANR。
- API 36 arm64-v8a 真机对当前 APK 完成 500 次运行、50 次工具副作用和 20 次恢复压力测试；重复副作用、数据损坏和永久 running 均为 0。
- 低内存与热限制资源策略完整 8 项套件通过；资源压力只允许显式阻断、串行或远程 Full Runtime 建议，不存在 Kotlin Lite 降级路径。

```text
API 26 PythonRuntimeService instrumentation: 6/6 passed
API 26/30/35/36 performance gates: 44/44 passed
Current APK stress: 500 runs, 50 tool runs, 20 recoveries, 0 integrity failures
RuntimeReliabilityTest: 8/8 passed
M11-F04 aggregate acceptance gates: 12/12 passed
Strict acceptance: M11-F04 accepted; total 68/72 (94.44%)
```

## 第105轮验收证据

### M12-F04 模拟器与真机矩阵

- 当前同一候选 APK 在 API 26/30/35 x86_64 模拟器及 API 36 arm64-v8a SM-X936C 真机完成 OAEP Store、独立 Python Runtime 与 Full Tool Registry 同构回归，共 84 次设备用例、失败 0。
- 共享 Python Runtime 全量回归首次暴露 7 个合同/证据漂移并逐项修复；最终 1786 tests、81 subtests 全绿，5 项按设计跳过。
- Android JVM 全量为 548 tests、0 failures、0 errors、2 skipped。
- 聚合门禁同时绑定 UI/Runtime identity、安全、exactly-once 恢复、供应链、性能与资源预算，不以单一设备用例替代完整矩阵。
- 当前 APK 的官方 OSV 扫描覆盖 179 个 Maven 依赖，已知漏洞发现 0；CycloneDX、Python/Chaquopy 资产和 59 个共享 Python 源文件重新绑定当前 APK。

```text
Shared Python full suite: 1786 passed, 5 skipped, 81 subtests passed
Android JVM full suite: 548 tests, 0 failures, 0 errors, 2 skipped
Four-device instrumentation: 21 tests x 4 devices = 84 executions, 0 failures
M12-F04 aggregate acceptance gates: 10/10 passed
Strict acceptance: M12-F04 accepted; total 69/72 (95.83%)
```

## 第106轮实施记录（未计分）

### M04-F06 / M09-F06 真实模型前置诊断

- 在 API 36 arm64-v8a 真机对 `ai.drsai.remote.debug` 执行非敏感配置诊断；仅输出 provider/model 标识、启用状态及 `hasKey` 布尔值，不读取、不导出、不打印 API Key。
- 当前 Room 仅有内置 `hepai` provider，`hasKey=false`，模型记录为空；旧加密 provider 列表同样为空。
- 当前设备只安装一个用户应用包 `ai.drsai.remote.debug`；智增增配置不是滞留在当前包旧存储中的待迁移数据。
- 因 `deepseek-v4-flash` 与 `deepseek-v4-pro` 均未配置，真实模型 runner 在任何请求前 fail closed；本轮真实模型调用数和费用均为 0。

```text
Non-sensitive provider diagnostic: 1/1 passed
Configured Zhizengzeng providers: 0
Configured candidate models: 0/2
Real model calls issued: 0
Strict acceptance: unchanged at 69/72 (95.83%)
Next input: save Zhizengzeng + API Key + both enabled models in current OpenDrSai.Dev
```

## 第107轮实施记录（未计分）

### 真实模型验收恢复准备

- ADB 短超时核查返回空设备列表，当前直接阻塞条件为 API 36 arm64 真机离线。
- `accept_android_p9_real_model_statistics.py` 现复用 M09-F06 中 `deepseek-v4-flash` 的 90 次原始观测，同时生成 M04-F06 报告；不再重复发起额外 90 次付费模型请求。
- 两份报告仍分别执行各自冻结评分门禁，并绑定同一 APK、测试 APK、fixture、Kernel/Prompt/Tool manifest 与物理设备身份。
- runner 编译检查通过；真实模型统计与自然工具选择评分回归 9/9 通过。

```text
ADB devices: 0
Duplicate paid model calls removed: 90
Focused scoring regression: 9/9 passed
Strict acceptance: unchanged at 69/72 (95.83%)
Next external state: reconnect SM-X936C, then verify saved model metadata
```

## 第108轮实施记录（未计分）

### 真实模型与最终发布门禁收口

- 真机仍未出现在 ADB 列表中；真实模型调用保持为 0。
- 抽取 `score_m04_observations` 并新增机器测试，证明 M04 精确复用 M09 的 90 条 flash 观测；缺失观测和未知 case 均 fail closed，聚焦回归 11/11 通过。
- 新增 `accept_android_p9_final_go_no_go.py`，冻结 11 项最终门禁：72项账本、71项前置、干净构建、180次真实模型、90次复用、四API/双ABI、同一APK、安全/恢复/性能/迁移、生产 parity 和自然任务。
- 新增 `build_android_p9_clean_candidate.py`；当前工作区预检正确拒绝 108 项变更，未把脏工作区伪装成干净候选。
- 最终聚合预检为 NO-GO 5/11；缺失项精确为 M04/M09、干净候选及其 APK 绑定，和当前 69/72 状态一致。

```text
ADB devices: 0
Real-model reuse/scoring regression: 11/11 passed
Final Go/No-Go preflight: NO-GO, 5/11 gates passed
Clean-build preflight: rejected dirty checkout (108 changes)
Strict acceptance: unchanged at 69/72 (95.83%)
```

## 第112轮实施记录（未计分）

### Android OAEP 事件诊断与错误正文对齐 Desktop

- 对照 Windows 当前实现，Android 诊断侧栏现按权威 `event_id` 对当前 Run 的每条 OAEP Event 展示类型、序号、Run/Item、来源；失败 Event 同时展示稳定错误码和错误正文。
- 修复 `run.failed` 中空 `message`/`actionable` 导致 `OaepJsonCodec` 再抛 `oaep_message_required` 的二次故障；现在以非空 `code`/默认码收口，终止事件能够持久化，Run 不再永久停在 `running`。
- 修复模型 Host 捕获时丢弃 `ApiException` 正文、稳定码和 `retryable` 的问题；正文先脱敏再有界传入 `MODEL_FAILED`，由共享 Kernel 写入 `event.run.failed`。
- API 35 x86_64 模拟器安装当前 62,292,237-byte Debug APK；干净 AVD 没有真机登录态或智增增加密凭据，因此没有把模拟器真实服务商 UI 调用伪报为通过。
- 模拟器正式 Runtime instrumentation 已覆盖 `Hello` 文本闭环、工具/审批/Artifact/Skill/Subagent、多步自然任务、Desktop production behavior fixture，以及空错误正文的终止持久化和诊断投影。

```text
Focused Android JVM regression: 2 suites passed
API 35 emulator Runtime/OAEP instrumentation: 4/4 passed
Debug APK assemble/install: passed
Real Zhizengzeng UI call on emulator: not run (clean AVD has no credential)
Strict acceptance: unchanged at 69/72 (95.83%)
```
