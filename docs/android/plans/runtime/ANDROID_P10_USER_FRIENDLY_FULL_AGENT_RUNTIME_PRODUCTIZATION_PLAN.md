# OpenDrSai Android P10：用户友好的 Full Agent Runtime 产品化开发与测试方案

> 阶段编号：Android P10（第 10 阶段）  
> 阶段名称：Full Agent Runtime 用户产品化与易用性  
> 目标产品版本：Android v1.5.7（versionCode 10507）  
> 首个实施渠道：`OpenDrSai.Dev` / `ai.drsai.remote.debug`  
> 制定日期：2026-08-14  
> 文档状态：待评审、待实施  
> 开发基线：P9 Android/Desktop 共享 Agent Kernel、OAEP 1.0、Android Full Runtime 默认绑定  
> P9 当前权威进度：69/72；M04-F06、M09-F06、M12-F06 尚未验收  

## 1. 阶段与版本结论

下一阶段确认是 **Android P10**，目标产品版本确认是 **v1.5.7**。

P8 解决 Android Agent Runtime 的 OAEP 化，v1.5.6 解决移除 Kotlin Lite 并默认绑定 Python Full Runtime，P9 解决 Desktop 与 Android 共享生产 Agent Kernel、自然工具选择和能力对等。P10 不再新建第三套 Agent 内核，也不以增加更多底层工具为主要目标，而是把现有 Full Runtime 变成普通用户能够首次配置、理解当前状态、放心授权、处理中断并长期使用的 Android 产品。

当前 `cores/VERSION` 已是 `1.5.7`，因此 P10 以 v1.5.7 为产品目标；Android Debug 仍存在 `developmentVersion=1.5.6` 的覆盖值，必须在 P10 S0 统一后再生成候选。P10 阶段号与产品版本号是两套口径：P10 不等于 v1.10，也不复用此前 v1.6.0 试验包。

P10 可以在 Emulator 上并行推进不改变 Kernel 语义的引导、展示和可用性工作，但 **P10 Release Candidate 不得在 P9 72/72 前签发**。P9 的三项待验收不能迁入 P10、改名或按 UI 结果提前接受。

## 2. 总体目标

### 2.1 唯一总目标

> 用户安装并登录 OpenDrSai 后，不需要理解 Python、OAEP、Tool schema、Host Port 或 Runtime 进程，也能在 3 分钟内配置可用模型并完成第一次真实 Agent 任务；后续能看懂 Agent 正在做什么、为什么需要授权、失败后如何恢复，以及哪些能力只能交给 Desktop。

### 2.2 产品目标

1. 首次使用从“空配置”到“第一次成功任务”形成连续、可恢复的引导；
2. 默认界面只显示用户决策所需信息，技术细节收进可展开的高级诊断；
3. 工具调用以“目的—操作—结果”表达，不向普通用户直接暴露内部工具名和 JSON；
4. 所有错误都提供通俗原因、影响范围和下一步操作，同时保留可复制的脱敏技术详情；
5. 长任务在前后台、锁屏、进程回收和网络切换后仍可观察、取消或恢复；
6. 模型、工作区、网络、审批和 Desktop Handoff 的能力边界在执行前可理解；
7. 默认保护凭据、文件和隐私；任何敏感操作均以最小权限和清楚授权完成；
8. 小屏、平板、深色模式、动态字体、TalkBack 和中英文环境均可正常使用；
9. 建立可量化的首次成功率、任务成功率、恢复率和错误可解决率门禁；
10. 完全移除仍会让用户误解为 Lite、Preview 或两套本地 Runtime 的生产入口与文案。

### 2.3 工程目标

1. 在 OAEP Projection 之上建立稳定的用户展示模型，不让 Compose 直接解释底层事件字符串；
2. 建立 `Readiness`、`UserFacingFailure`、`ActionConsent` 和 `TaskProgress` 四个产品契约；
3. 将当前集中在 `OpenDrSaiApp.kt` 的设置、模型、诊断、审批和会话 UI 拆成可测试模块；
4. Provider 配置、连接测试、模型能力探测和默认模型选择形成原子状态机；
5. 所有用户操作绑定稳定 Run/Interaction/Tool ID，旋转、重建和重复点击不产生重复副作用；
6. 建立 60 项 P10 功能账本、自动证据和基于真实用户旅程的 Go/No-Go；
7. 保持共享 Agent Kernel、Tool Registry、OAEP Journal/Snapshot 为唯一事实源；
8. 不降低 P9 的真实工具选择、安全、恢复和跨端对等门槛。

### 2.4 非目标

1. 不重新实现 Kotlin Lite Agent Loop，也不加入 Full Runtime 失败后的纯聊天静默回退；
2. 不在手机本地开放任意 Shell、root、PowerShell、PTY、Docker 或动态代码下载；
3. 不在 P10 重写共享 Agent Kernel、OAEP 协议或 Desktop Runtime；仅允许向后兼容的展示字段扩展；
4. 不要求用户理解或手工编辑 Tool schema、Capability digest、Prompt digest；
5. 不以隐藏错误、无限自动重试或自动授权来换取“看起来简单”；
6. 不把 API Key、Token、原始 Prompt、私有思维链、绝对路径写入日志、OAEP 或诊断导出；
7. 不用 APK 大小、内存占用或“Full Runtime”标签替代真实能力验收；
8. 不把 Emulator 证据伪装为 P9/P10 物理设备发布证据。

## 3. 当前实现基线与主要体验缺口

### 3.1 可复用的现有实现

1. `FullRuntimeBindingCoordinator`、`PythonRuntimeClient` 和非导出 `:runtime` Service 已提供 Full Runtime 绑定、重绑与诊断；
2. Android 与 Desktop 已共享 Agent Kernel、Prompt、Tool Policy、Memory、Skill、Subagent 和 OAEP 基础语义；
3. `AndroidOaepProjector` 和现有时间线能投影消息、过程项、来源、审批、Artifact、错误和终态；
4. `LocalRunForegroundService`、恢复 Worker 和通知动作已覆盖长任务后台与取消；
5. Provider 设置已支持预设、自定义 URL、API Key 安全保存、模型发现、连接测试和模型能力字段；
6. 智增增预设已包含 `https://api.zhizengzeng.com/v1`、`deepseek-v4-flash` 和 `deepseek-v4-pro`；
7. 个人中心已有版本、构建渠道、Runtime route/health、Kernel/Prompt/Tool/Skill digest 和脱敏诊断；
8. SAF 工作区、Web 搜索/读取、受控浏览、MCP、审批、Artifact 和 Desktop Handoff 已有生产实现；
9. P9 Emulator 双模型 180 次预跑已达到工具选择 100%、参数正确 98.3%、最终成功 93.9%、Provider 错误 0%；
10. API 26/30/35/36 Emulator 已具备安装、绑定和基础回归框架。

### 3.2 需要 P10 解决的体验缺口

1. 首次登录后没有统一的“模型—Runtime—权限—首次任务”就绪旅程，用户容易进入一个能打开但不能完成 Agent 任务的首页；
2. 模型设置暴露 Provider、wire API、upstream ID、tools/reasoning 等工程概念，预设用户仍需完成过多选择；
3. 当前连接测试主要证明 HTTP 可达，不能直观证明所选模型确实支持 Full Runtime 工具循环；
4. Runtime 诊断默认展示大量内部字段，适合开发者但不适合作为普通用户的健康状态；
5. 对话区同时存在技术状态条、时间线过程项和错误条，信息层级没有统一；
6. 工具审批展示 Runtime ID、scope 等内部词汇，缺少“将读取/修改什么、为什么、能否撤销”的风险说明；
7. Full Runtime 不可用、Provider 失败、模型行为失败、权限缺失和网络中断在用户视角下仍不够容易区分；
8. SAF 工作区授权没有围绕具体任务进行引导，拒绝或撤销后缺少直接修复路径；
9. Android 本地能力与 Desktop 专属能力虽已可协商，但 Handoff 仍偏技术化；
10. 设置导航中多项仍显示“将在 Android 端逐步保持一致”，不是可完成的产品页面；
11. `OpenDrSaiApp.kt` 承载过多页面和业务展示逻辑，影响可测性、可访问性和持续迭代；
12. 缺少面向真实用户旅程的可用性指标、无障碍门禁和发布前体验验收。

## 4. P10 产品原则与强制不变量

1. **先完成任务，再解释技术**：默认展示“正在搜索资料”“等待你允许修改文件”，而不是 Tool/OAEP/Runtime 内部名；
2. **渐进披露**：普通状态、操作详情、高级诊断分三级，任何底层信息仍可追溯；
3. **失败可行动**：错误卡必须至少包含“发生了什么、当前任务怎样、现在能做什么”；
4. **授权可理解**：同意前明确目标、范围、风险、持续时间和撤销方式；默认只允许一次；
5. **不静默换路由**：Run 创建后固定 Runtime 与模型；变更只影响新 Run；
6. **不静默降级**：需要工具却不可用时，显示能力缺口或 Handoff，不能直接伪装成普通回答；
7. **OAEP 唯一事实源**：用户进度、审批、错误、恢复和终态只能由 OAEP/权威状态机派生；
8. **技术详情可验证**：高级诊断保留稳定错误码、Run ID、版本和 digest，但默认脱敏；
9. **敏感信息不出安全边界**：凭据只在 Android 加密存储和 Host 边界使用；
10. **一条主要操作**：每个阻塞页面只突出一个推荐动作，次要动作降低视觉权重；
11. **中断可恢复**：页面重建、进程死亡和网络恢复不得丢失用户已作决定或重复副作用；
12. **P9 不倒退**：任何易用性改造都必须继续通过共享 Kernel、自然工具选择、OAEP 和安全门禁。

## 5. 目标用户旅程

```text
安装 / 登录
  -> 欢迎与隐私说明
  -> 选择“使用预设模型”或“连接已有服务”
  -> 安全录入 API Key
  -> 自动发现并推荐支持工具的模型
  -> 执行 Full Runtime 就绪检查
  -> 发送第一个示例任务
  -> 看到简明任务进度
  -> 必要时理解并确认操作
  -> 获得带来源 / Artifact 的结果
  -> 可在历史中继续、重试或恢复
```

异常旅程固定为：

```text
识别阻塞类别
  -> 给出用户语言摘要
  -> 保留当前 Run 与已完成结果
  -> 推荐一个直接修复动作
  -> 修复后从安全检查点继续
  -> 高级详情可复制且已脱敏
```

## 6. 目标架构

```text
Compose Screens
  |-- Setup Journey
  |-- Conversation + Task Progress
  |-- Consent Center
  |-- Recovery Center
  `-- Profile / Health / Advanced Diagnostics
            |
            v
Android Product Presentation Layer
  |-- AgentReadiness
  |-- TaskProgressPresenter
  |-- UserFacingFailureMapper
  |-- ActionConsentPresenter
  `-- CapabilityGuidance
            |
            v
App Commands + OAEP Projection
  |-- AndroidOaepProjector
  |-- Provider Configuration State Machine
  |-- FullRuntimeBindingCoordinator
  |-- ApprovalRepository
  `-- Run Recovery / Notifications
            |
            v
Shared Agent Kernel + Android Host Ports
  Model / Tool / Web / SAF / Skill / MCP / Artifact / Handoff
```

展示层不得成为新的业务事实源：它只能把 Provider、Runtime、Capability 和 OAEP 权威状态转换成稳定的用户展示模型，并把用户操作转换成带作用域的命令。

## 7. 解决方案

### 7.1 首次成功向导

登录成功后执行轻量 readiness 检查。未配置工具模型的用户进入可跳过但持续可恢复的向导；使用预设时只需选择服务商、录入 Key、接受推荐模型。向导在保存前做本地校验，保存后做连接、模型能力和一次无副作用 Tool Loop 冒烟。成功后直接提供“查时间”“检索并引用”“总结工作区文档”三个按当前能力过滤的示例任务。

### 7.2 双层健康状态

普通用户只看到“可以使用、需要配置、需要权限、暂时中断”及推荐动作；开发者从“高级诊断”查看进程、Kernel、Prompt、Tool/Skill、Capability、模型路由、错误码和 digest。个人中心继续提供版本信息，但不再把内部 starts/binds/fallbacks 作为首屏内容。

### 7.3 用户语言的任务过程

将 OAEP Event 归并为稳定步骤：理解任务、查找资料、读取文件、准备修改、等待允许、生成结果、完成。默认折叠重复 delta 和低层协议事件；用户展开步骤后可看到工具显示名、输入摘要、来源、耗时和结果摘要；高级模式才显示内部名称与 ID。

### 7.4 风险分级与审批

审批卡由 Tool Registry 的权威风险、目标摘要和可撤销性生成，禁止使用模型自报风险。只读低风险操作按策略自动执行；写入、敏感网络、MCP 写操作和 Desktop Handoff 显示清晰审批。重复点击、旋转、通知与页面同时操作继续使用同一 Interaction 决胜。

### 7.5 错误、重试和恢复

建立 `UserFacingFailure` 分类：配置、凭据、额度/限流、网络、模型能力、Runtime、权限、工具、审批、恢复和平台不支持。每类绑定稳定标题、简述、是否可重试、主操作、次操作和高级详情；重试前先检查是否已有副作用 receipt，禁止盲目重放。

### 7.6 本地能力与 Desktop Handoff

当任务需要 Shell、Git Worktree、Desktop Browser 或 stdio MCP 时，在创建 Run 前给出“此任务需要电脑端”的说明、目标设备/工作区、将传递的数据摘要和审批。若无 Desktop 可用，保留任务草稿并提供绑定入口；不显示不可执行的假工具。

### 7.7 模块化与设计系统

拆分 `OpenDrSaiApp.kt`，把设置、模型、个人中心、诊断、审批、时间线和输入器迁入独立 package；建立统一状态色、图标、卡片、空状态、错误文案和 TalkBack 语义。业务状态与可组合函数分离，支持 JVM presenter 测试、Compose screenshot 和 instrumentation journey 测试。

## 8. 模块增、改、删清单

### 8.1 新增模块

| 建议模块 | 责任 |
|---|---|
| `ui/setup/` | 首次成功向导、步骤恢复和示例任务 |
| `runtime/readiness/` | Provider、模型、Runtime、网络、权限的统一就绪合同 |
| `ui/progress/` | OAEP → 用户任务步骤与渐进披露 |
| `runtime/errors/UserFacingFailure.kt` | 稳定错误分类、动作和脱敏详情 |
| `ui/consent/` | 人类可读审批、通知审批和授权历史 |
| `ui/recovery/` | 中断任务、恢复候选和副作用状态 |
| `ui/capabilities/` | 本地/远程/缺权限能力说明与修复入口 |
| `ui/diagnostics/` | 普通健康状态与高级技术诊断分层 |
| `ui/components/agent/` | 统一状态、步骤、错误、来源和 Artifact 组件 |
| `testing/journeys/p10/` | P10 用户旅程 fixture、机器人操作和证据聚合 |
| `docs/android/reports/evidence/p10/` | P10 唯一发布证据目录 |

### 8.2 更新模块

| 现有模块 | P10 更新 |
|---|---|
| `OpenDrSaiApp.kt` | 只保留应用壳和路由；逐页迁出大型 Composable |
| `AppViewModel.kt` | 暴露命令和权威状态；移除 UI 文案拼接与页面展示判断 |
| `ModelProviderPersistence.kt` | 保存 readiness、能力探测、推荐模型和最近成功状态，不保存 Key 明文 |
| `ModelProviderDraftClient.kt` | 连接测试升级为分阶段探测并提供稳定失败类型 |
| `HaiModelClient.kt` | 用户可行动的 Provider/模型错误映射；保留服务端脱敏正文 |
| `FullRuntimeBindingCoordinator.kt` | 输出面向产品的 readiness、恢复建议和状态变化原因 |
| `RunCapabilityDiagnostics.kt` | 提供普通能力摘要与高级能力详情两个投影 |
| `AndroidOaepProjector.kt` | 生成稳定 TaskProgress、错误动作和审批展示数据 |
| `ApprovalRepository.kt` | 支持人类可读目标摘要、授权范围、到期与撤销状态 |
| `LocalRunNotifications.kt` | 通知展示当前步骤、等待原因、继续/取消/审批动作 |
| `WorkspaceMutationPlanner.kt` | 输出具体文件、变更摘要、可撤销性和审批说明 |
| `ChatExecutionRouter.kt` | Run 前给出本地/远程能力指导，不静默改路由 |
| `Models.kt` | 用 sealed UI state 替代易漂移的自由字符串状态 |
| `strings.xml` | 收敛用户文案、复数、无障碍说明和中英文资源键 |
| Android 测试与构建脚本 | 增加 P10 journey、无障碍、性能、泄露和证据门禁 |
| `docs/android/overview/ANDROID_PRODUCT_OVERVIEW.md` | 移除“本机精简 Runtime”“第一版不包含 Python”等过期口径，改为 P10 Full Runtime 产品边界 |
| `docs/android/design/MAIN_INTERFACE_DESIGN.md` | 补充首次向导、任务步骤、审批、错误恢复、健康状态和大字体/平板交互规范 |

### 8.3 移除或退役

| 模块或行为 | 退役要求 |
|---|---|
| 生产 UI 中的“轻量 Agent”文案 | 全部移除；历史数据只在兼容诊断中出现 |
| P9 完成后的 `Preview / parity incomplete` 标签 | 仅在 P9 未完成构建保留；P9 72/72 后由账本派生正式身份 |
| `toolDowngraded` 纯对话状态条 | 替换为明确的能力缺口和修复动作；禁止静默降级语义 |
| UI 直接拼接 Runtime/Provider 异常正文 | 统一经 `UserFacingFailureMapper` |
| 审批页面直接突出 Runtime ID、scope、内部 Tool ID | 移到高级详情，默认展示目的、目标和风险 |
| 设置中的占位页 | P10 范围内实现；范围外入口暂时隐藏，不显示不可操作承诺 |
| 同一状态在 Banner、ErrorBar、RuntimeBar 重复展示 | 由单一优先级规则合并 |
| Compose 根据 OAEP 原始字符串猜测业务状态 | 使用版本化 presentation model |
| 首次使用即展示 Kernel/Prompt/digest | 移入高级诊断 |
| 自动无限重试、重新创建 Run 或重放写工具 | 静态与状态机测试禁止 |

## 9. 功能点、测试与验收

P10 设置 **10 个模块、60 个功能点**。每项只有同时具备生产实现、自动化测试和绑定候选身份的证据才可接受。

### M01 版本、基线与首次启动（6）

| 编号 | 功能点 | 测试方案 | 验收标准 |
|---|---|---|---|
| M01-F01 | v1.5.7 身份统一 | 比较 `cores/VERSION`、Gradle、APK badging、个人中心和证据 manifest | 全部为 1.5.7/10507；Debug 为 `.debug`；无 1.5.6 开发覆盖漂移 |
| M01-F02 | P9 前置门禁 | 对 69/72、72/72 和伪造账本构建 fixture | P10 RC 只在 P9 72/72 且每项有测试/证据时可签发 |
| M01-F03 | 首次启动判定 | 新装、升级、已配置、向导中断四类状态测试 | 仅未就绪用户进入向导；完成用户不被重复打扰 |
| M01-F04 | 向导断点恢复 | 每一步旋转、杀进程、重启 | 回到安全步骤；API Key 输入不明文持久化；已保存配置不重复写入 |
| M01-F05 | 跳过与稍后继续 | 跳过向导后进入首页并尝试任务 | 明确显示“完成模型配置”主操作；个人中心可继续，不创建失败 Run |
| M01-F06 | 升级兼容 | 从 v1.5.5/v1.5.6 数据快照升级 | 会话、OAEP、模型、凭据引用、SAF、Memory 和 Artifact 可读且无重复向导 |

### M02 模型服务与首次成功（6）

| 编号 | 功能点 | 测试方案 | 验收标准 |
|---|---|---|---|
| M02-F01 | 预设快速配置 | 智增增、HepAI、OpenAI 预设 UI journey | 预设用户只需 Key 和推荐模型；URL/协议默认正确且无需手改 |
| M02-F02 | 密钥安全录入 | 截图、剪贴板、日志、Room、saved state 和备份扫描 | 默认遮挡；离开不保留草稿；明文不进入日志/OAEP/数据库/备份 |
| M02-F03 | 分阶段连接检查 | DNS、TLS、401、402/429、模型不存在、成功 fixture | 页面准确显示失败阶段和一个推荐动作；不把额度错误写成 Runtime 错误 |
| M02-F04 | 模型发现与推荐 | 空列表、重复 ID、1000 模型、能力未知和工具模型 fixture | 保留用户选择；默认推荐已验证支持 tools 的模型；列表可搜索且不卡顿 |
| M02-F05 | Full Runtime 冒烟 | 用无副作用时间/受控 fixture 完成真实 Tool Loop | 只有模型请求、工具调用、工具结果和最终回答全部成功才标记“Agent 可用” |
| M02-F06 | 第一次示例任务 | 新装用户依次完成普通聊天、检索引用和本地安全工具任务 | 3 分钟内至少完成一项；失败可从当前步骤修复，不要求重新登录 |

### M03 Runtime 就绪、健康与能力引导（6）

| 编号 | 功能点 | 测试方案 | 验收标准 |
|---|---|---|---|
| M03-F01 | 统一 readiness | Provider/模型/Runtime/网络/权限组合属性测试 | 状态互斥、稳定、可恢复；发送前可确定是否能执行当前任务 |
| M03-F02 | 用户健康卡 | READY、配置缺失、绑定中、可恢复、不可用 Compose 测试 | 默认只显示通俗状态、影响和推荐动作，不显示 digest/计数器 |
| M03-F03 | 高级诊断 | 展开、复制、分享、脱敏测试 | 可见版本、route、Run/error ID、Kernel/Prompt/Tool/Skill/Capability digest；秘密 0 命中 |
| M03-F04 | 能力清单 | 本地可用、需权限、需 Desktop、不支持组合测试 | 用户能在执行前看到分类及开启方法；不可用工具不进入模型 schema |
| M03-F05 | 状态实时更新 | 网络、SAF、模型配置和 Runtime 状态切换 | 只影响新 Run；活动 Run 保持原 snapshot；UI 不闪烁为错误中间态 |
| M03-F06 | 绑定自愈 | 冷启动、Binder death、进程回收、连续失败测试 | 有界重绑；无副作用任务恢复；有副作用任务进入 reconciliation；无 Kotlin fallback |

### M04 对话与任务过程可理解（6）

| 编号 | 功能点 | 测试方案 | 验收标准 |
|---|---|---|---|
| M04-F01 | 用户任务步骤模型 | 对消息、Web、文件、Plan、Subagent、Artifact OAEP fixture 做映射测试 | 同一事件序列产生确定性步骤；未知事件安全落入“处理中”且高级详情可见 |
| M04-F02 | 渐进披露时间线 | 默认、展开步骤、高级模式 screenshot/Compose 测试 | 默认无 JSON/内部 Tool 名；展开后可查目的、输入摘要、耗时、结果和来源 |
| M04-F03 | 流式与滚动 | 长回答、快速 delta、用户上滚、键盘和旋转测试 | 不强抢滚动；回到底部入口明确；合并刷新无明显抖动或丢字 |
| M04-F04 | 来源与证据 | 有效/无效 URL、本地文档、Artifact、重复来源测试 | 引用可点开并标示类型；无法验证不显示为已验证来源 |
| M04-F05 | 计划与子任务 | 多步骤、并行子任务、部分失败 fixture | 显示总目标、已完成/进行中/等待和部分失败；不暴露私有思维链 |
| M04-F06 | 完成状态 | completed/failed/cancelled/partial/recoverable 终态测试 | 每 Run 只有一个用户可见终态；状态与 OAEP Journal/Snapshot 一致 |

### M05 工具、审批与安全感（6）

| 编号 | 功能点 | 测试方案 | 验收标准 |
|---|---|---|---|
| M05-F01 | 工具人类显示名 | 全量 Tool Registry snapshot 测试 | 每个生产工具均有动作、对象和结果模板；未知工具不得用模型文本伪造说明 |
| M05-F02 | 审批风险摘要 | read/write/sensitive/MCP/Handoff fixture | 显示为什么、操作对象、风险、是否可撤销；内部 ID 收进高级详情 |
| M05-F03 | 授权范围 | 允许一次、本会话允许、拒绝、到期和撤销状态机测试 | 默认允许一次；会话授权不跨账户/Runtime/Tool；可随时查看并撤销 |
| M05-F04 | 审批抗竞态 | 页面、通知、远端同时决定及重复点击 | 首个合法决定胜出；只执行一次副作用；其他入口立即同步终态 |
| M05-F05 | 修改前预览 | 文件创建/更新、设置修改和多文件 fixture | 审批前显示目标与摘要；敏感内容脱敏；实际 receipt 与批准范围一致 |
| M05-F06 | 操作结果与补救 | 成功、部分成功、失败、不可撤销 fixture | 明确哪些已完成、哪些未执行；可撤销时给出入口，不承诺不存在的回滚 |

### M06 错误、重试与任务恢复（6）

| 编号 | 功能点 | 测试方案 | 验收标准 |
|---|---|---|---|
| M06-F01 | 稳定错误分类 | 11 类错误 × retryable/terminal 属性测试 | 每个错误唯一归类；含标题、摘要、影响、主操作和稳定 code |
| M06-F02 | Provider 可行动错误 | 401/403/402/408/429/5xx/断流真实正文 fixture | 分别引导改 Key、检查权限/额度、稍后重试；正文脱敏且不错误归因 |
| M06-F03 | 权限与能力错误 | SAF 撤销、网络关闭、模型无工具、Desktop 离线测试 | 直接跳到正确配置或 Handoff；修复前不重复创建 Run |
| M06-F04 | 安全重试 | 模型、只读工具、写工具及已有 receipt 组合测试 | 只重试允许的阶段；写/敏感副作用不盲重放；沿用原 Run 或明确新 Run |
| M06-F05 | 恢复中心 | 多个暂停/等待/失败 Run、跨账户和过期测试 | 只显示当前账户合法候选；可继续、取消或归档；无永久 running |
| M06-F06 | 诊断反馈包 | 复制/分享失败报告并做秘密扫描 | 包含版本、设备/API、稳定码、Run/事件摘要与 digest；不含 Key、Token、正文隐私和思维链 |

### M07 工作区、附件、Artifact 与 Desktop Handoff（6）

| 编号 | 功能点 | 测试方案 | 验收标准 |
|---|---|---|---|
| M07-F01 | 任务内 SAF 引导 | 未授权读取/写入、拒绝、撤销、重新授权 journey | 从当前任务直接选择目录；解释只授予所选范围；返回后继续原 Run |
| M07-F02 | 工作区边界可见 | 多目录、同名文件、超大文件、无权 URI 测试 | 始终显示当前工作区名称；越界 fail closed；不向模型泄露绝对路径 |
| M07-F03 | 附件体验 | 图片/文档、上传中、失败重试、删除草稿和旋转 | 发送前可预览/移除；失败附件不阻塞其他草稿；无重复上传 |
| M07-F04 | Artifact 结果卡 | 文本、二进制、超限、过期、校验失败 fixture | 显示类型/大小/来源；打开与分享前校验；失败可重新生成或明确过期 |
| M07-F05 | Handoff 向导 | 无 Desktop、单设备、多设备、离线、权限不足测试 | 解释为何需要电脑、将传递什么；用户选择目标后才创建 Handoff |
| M07-F06 | 本地/远程连续性 | Android→Desktop→Android OAEP 回放与审批竞态 | Run/Session/Artifact 关联不丢失；不重复消息、副作用或授权 |

### M08 长任务、通知与日常可用性（6）

| 编号 | 功能点 | 测试方案 | 验收标准 |
|---|---|---|---|
| M08-F01 | 长任务状态 | 5/15/30 分钟受控任务，前后台切换 | 页面与通知显示同一步骤；回到 App 定位原 Run；无 ANR |
| M08-F02 | 通知操作 | 继续、取消、审批、打开结果及非法 Intent 测试 | 操作绑定账户/Run/Interaction；非法作用域 fail closed；结果即时同步 |
| M08-F03 | 网络切换 | Wi-Fi/蜂窝/离线/恢复/受限网络 fixture | 保留已完成步骤；有界重连；用户知道是等待网络还是 Runtime 失败 |
| M08-F04 | 电量与后台约束 | Doze、省电、后台限制、前台服务超时 | 不能继续时明确暂停；恢复后同 Run 继续；不通过高频唤醒维持假在线 |
| M08-F05 | 会话日常管理 | 搜索、重命名、归档、删除、继续、模型切换测试 | 操作对象清楚；删除二次确认；模型切换只影响新 Run；历史仍可重放 |
| M08-F06 | 空状态与示例 | 无会话、无结果、无网络、无模型、能力变化测试 | 每个空状态只有一个推荐主操作；示例任务按当前能力动态过滤 |

### M09 可访问性、国际化与性能（6）

| 编号 | 功能点 | 测试方案 | 验收标准 |
|---|---|---|---|
| M09-F01 | TalkBack 语义 | Accessibility Scanner + 人工遍历核心 journey | 控件有名称/角色/状态；时间线阅读顺序正确；纯图标均有说明 |
| M09-F02 | 动态字体与触控 | 100%/150%/200% 字体、小屏/平板、最小触控检查 | 核心内容不裁切；横向滚动不阻塞主操作；触控目标至少 48dp |
| M09-F03 | 颜色与动效 | 深浅色、对比度、色盲模拟、关闭动画测试 | 状态不只靠颜色；正文达到 WCAG AA；减少动画设置有效 |
| M09-F04 | 中英文与格式 | zh-CN/en-US、长文案、复数、时区和 RTL 压力 fixture | 用户文案全部资源化；无截断占位键；日期、大小、数量本地化 |
| M09-F05 | 页面性能 | Macrobenchmark 冷启动、向导、500 项时间线、1000 模型列表 | 冷启动和关键页面满足冻结预算；滚动无严重卡顿；内存不随重组持续增长 |
| M09-F06 | Runtime 资源预算 | APK、PSS、CPU、电量、数据库增长矩阵 | 相对 P9 候选增量有归因；不得突破 P9 既有 220MB PSS/64MB 数据门禁 |

### M10 安全、真实旅程与发布（6）

| 编号 | 功能点 | 测试方案 | 验收标准 |
|---|---|---|---|
| M10-F01 | 隐私与凭据门禁 | APK/Room/logcat/OAEP/checkpoint/诊断/截图自动扫描 | API Key、Authorization、Token、私有正文、绝对敏感路径 0 命中 |
| M10-F02 | 关键用户旅程自动化 | 新装首次成功、回访任务、权限修复、错误恢复、Handoff 五条 E2E | API 26/30/35/36 Emulator 全绿；每条生成视频/截图、JUnit 和 OAEP 摘要 |
| M10-F03 | 真实模型体验统计 | Flash/Pro 各执行 30 类自然任务并加入首次配置/恢复 journey | 不丢失败样本；任务成功≥90%、工具选择≥90%、参数≥90%、非行为错误≤3% |
| M10-F04 | 真机与形态矩阵 | 至少 ARM64 手机 + 平板；API 30/35/36 或当前发布矩阵 | 登录、首次成功、工具、审批、后台、恢复、无障碍关键路径全部通过 |
| M10-F05 | 可用性验收 | 5 名非开发参与者执行首次配置、检索、文件任务和错误修复 | 4/5 无协助完成；首次成功中位≤3 分钟；关键误授权 0；问题有记录和闭环 |
| M10-F06 | 最终 Go/No-Go | 从干净 checkout 构建唯一候选并聚合 P9/P10 证据 | P9 72/72、P10 60/60、无 P0/P1、身份/签名/hash 一致方可 GO |

## 10. 重点端到端验收场景

### 10.1 新用户三分钟首次成功

1. 全新安装 `OpenDrSai.Dev` 并登录；
2. 选择“智增增”，输入测试 Key；
3. App 自动检查连接并推荐 `deepseek-v4-flash`；
4. App 完成 Runtime 和无副作用 Tool Loop 检查；
5. 用户选择“HEPiX 2026 是什么？请检索并给出来源”；
6. 时间线显示“正在搜索资料—正在阅读来源—整理答案”；
7. 最终答案包含可点击来源，OAEP 有唯一完成终态；
8. 全程不要求用户理解 tools、wire API、OAEP 或 Python。

### 10.2 文件修改与审批

1. 用户要求读取工作区配置并修改 endpoint；
2. 未授权时从任务内触发 SAF 目录选择并解释权限边界；
3. Agent 先读取并给出修改预览；
4. 审批卡显示目标文件、变更摘要、风险与“允许一次”；
5. 用户批准后只写一次，生成 receipt 和结果卡；
6. 拒绝、重复点击、旋转或进程回收均不产生额外写入。

### 10.3 Provider 错误修复

1. Key 错误返回 401，页面提示“密钥无效”，主操作为“更新密钥”；
2. 429 提示额度/限流并保留任务，不能错误显示“Python Runtime unavailable”；
3. 更新配置后重新执行连接与工具冒烟；
4. 从安全检查点继续，原失败 Run 保持可追溯且不重复副作用。

### 10.4 Android 无法本地完成的任务

1. 用户要求运行 PowerShell 或创建 Git worktree；
2. 能力协商在执行前识别为 Desktop-required；
3. UI 解释原因、展示可用电脑/工作区和将传递的数据；
4. 无 Desktop 时保留草稿并引导绑定；有 Desktop 时经用户确认创建 Handoff；
5. Android 不注册或伪造本地 Shell 工具。

### 10.5 长任务中断与恢复

1. 多步骤研究任务执行中锁屏并切换网络；
2. 通知展示当前步骤和取消入口；
3. 系统回收进程后由 checkpoint 恢复同一 Run；
4. 已完成 Web/文件/审批结果不重复；
5. 用户回到 App 后定位到原任务并看到清楚的恢复说明。

## 11. 测试体系与证据

### 11.1 自动化层级

1. Shared Kernel/Python：P9 自然任务、工具决策、错误和恢复回归；
2. Kotlin JVM：Readiness、Presenter、Failure、Consent、Capability 和状态机属性测试；
3. Compose：小屏/平板、动态字体、深浅色、TalkBack 语义和 screenshot；
4. Instrumentation：真实 `:runtime`、Room/OAEP、SAF、通知、进程死亡和完整用户旅程；
5. Emulator：API 26/30/35/36，冷启动、升级、离线、旋转和后台矩阵；
6. 真实 Provider：智增增 Flash/Pro，保留全部原始 observation 并分类失败；
7. ARM64 真机：手机、平板、后台、电量、性能和系统权限行为；
8. 人工可用性：非开发用户完成固定任务，记录时间、求助、误操作和退出点。

### 11.2 P10 核心质量指标

| 指标 | 发布门槛 |
|---|---:|
| 首次配置完成率 | ≥ 90% |
| 首次成功中位耗时 | ≤ 3 分钟 |
| 真实自然任务最终成功率 | ≥ 90% |
| 工具选择 / 参数正确率 | 均 ≥ 90% |
| 可恢复中断恢复成功率 | ≥ 95% |
| Provider/Runtime 错误正确归类率 | 100%（确定性 fixture） |
| 用户可自行修复的已知错误 | ≥ 90% |
| 审批重复副作用 | 0 |
| 凭据/隐私泄露 | 0 |
| P0/P1 缺陷 | 0 |
| 非开发者无协助完成关键旅程 | ≥ 4/5 |

### 11.3 证据目录

```text
docs/android/reports/evidence/p10/
  manifest.json
  acceptance-ledger.json
  setup-journey/
  provider-readiness/
  conversation-progress/
  consent-and-tools/
  failure-and-recovery/
  workspace-and-handoff/
  accessibility/
  performance/
  emulator-matrix/
  physical-device-matrix/
  real-model/
  usability/
  security/
  final-go-no-go.json
```

所有证据必须包含 commit、dirty 状态、APK/Test APK SHA-256、应用身份、设备/API/ABI、Kernel/Prompt/Tool/Skill/Capability digest、测试数和失败数。Provider 报告记录 provider/model ID，但不得包含 Key。

## 12. 实施里程碑

| 里程碑 | 范围 | 主要出口条件 |
|---|---|---|
| P10-S0 基线与版本冻结 | M01-F01～F02、P9 状态、架构决策、体验基线 | v1.5.7 唯一版本口径；P9 遗留项不迁移；冻结 P10 60 项账本 |
| P10-S1 首次成功 | M01、M02 | 新装/升级/中断向导通过；预设模型至真实工具冒烟闭环 |
| P10-S2 健康与过程 | M03、M04 | 用户健康状态、能力引导、任务步骤和来源展示全绿 |
| P10-S3 授权与恢复 | M05、M06 | 审批 0 重复副作用；11 类错误可行动；恢复中心闭环 |
| P10-S4 工作区与长任务 | M07、M08 | SAF、Artifact、Handoff、通知、网络和后台 journey 全绿 |
| P10-S5 体验质量 | M09 | 无障碍、国际化、形态和性能达到门槛 |
| P10-S6 发布预验收 | M10-F01～F03 | Emulator 矩阵、真实模型统计、安全门禁全绿 |
| P10-S7 真机与发布 | M10-F04～F06 | P9 72/72、P10 60/60、真机和可用性验收后 GO |

推荐执行顺序是先建立 Presentation Contract 和测试 fixture，再拆 UI；不能先大规模重排 Compose 页面、最后才补状态契约。每轮汇报：总轮次、P9 正式进度、P10 严格进度、本轮通过/失败/阻塞、证据路径和下一轮目标。

## 13. 人工配置与阻塞项

### 13.1 开发前需要确认

1. P10 产品版本使用 v1.5.7/10507，并移除 Debug 的 v1.5.6 默认覆盖；
2. 首发真实模型验收继续使用智增增 `deepseek-v4-flash` 与 `deepseek-v4-pro`；
3. 是否提供可用于首次向导的测试账号/测试 Key，只能通过本地安全注入，不能提交仓库；
4. 可用性验收的 5 名非开发参与者和设备安排；
5. 最终 P9 三项 ARM64 真机验收时间窗口。

### 13.2 不阻塞 Emulator 开发

1. 无真机时可完成 M01～M09 的确定性实现、Compose、API 矩阵和预验收；
2. Provider 失败 fixture、SAF fixture、通知和 Handoff mock 不要求生产账号；
3. 可访问性自动检查和性能基线可先在 API 35 主 AVD 完成。

### 13.3 最终发布阻塞项

1. P9 M04-F06、M09-F06、M12-F06 必须先严格 accepted；
2. P10 M10-F03 需要有效但不入库的真实 Provider 凭据和额度；
3. P10 M10-F04 需要 ARM64 手机与平板；
4. P10 M10-F05 需要真实非开发用户参与；
5. 正式渠道需要签名、更新 manifest 和发布权限，这些不由 Debug 验收替代。

## 14. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 易用性层重新解释 Agent 语义导致与 OAEP 漂移 | Presentation model 只消费版本化 Projection；golden/属性测试比对 Journal |
| 为减少报错而引入静默降级 | 静态门禁扫描 fallback；能力缺口必须产生用户可见 Notice |
| UI 拆分引发大范围回归 | 按页面迁移、保持路由兼容；每步运行 screenshot 和 journey 回归 |
| 连接测试成功但真实工具调用失败 | readiness 必须包含一次无副作用完整 Tool Loop |
| 自动重试造成重复写入或费用 | 使用 receipt/idempotency；写/敏感操作禁止盲重试；展示重试影响 |
| 技术详情泄露密钥和隐私 | 所有导出统一经过 redaction；构建和运行期秘密扫描 fail closed |
| Android 后台策略因厂商差异失效 | 手机/平板与至少两个系统形态验证；不能继续时诚实暂停 |
| 大模型行为随机导致体验波动 | 确定性 fixture 保证状态机，真实双模型按统计门槛并保留失败样本 |
| P10 推进掩盖 P9 未完成 | 构建从 P9 权威账本派生 RC gate；最终报告同时列出两套账本 |
| “简单模式”隐藏必要授权信息 | 渐进披露不等于省略；风险、目标、范围和撤销始终在批准前可见 |

## 15. 发布硬门禁

出现以下任一情况，P10 不得发布：

1. P9 未达到 72/72 或仍显示 Desktop parity incomplete；
2. 生产路径存在 Kotlin Lite、静默纯聊天降级或 Run 中途换 Runtime/模型；
3. 新用户无法从空配置完成一次真实 Full Runtime Tool Loop；
4. 需要检索的问题在 Web 可用时直接编造回答或来源；
5. 错误没有用户可执行的下一步，或把 Provider/权限错误统一显示为 Runtime unavailable；
6. 审批信息缺少目标/风险/范围，或重复决定产生多次副作用；
7. 页面重建、后台或恢复会重复用户消息、工具调用、文件写入或费用请求；
8. API Key、Token、私有正文、绝对敏感路径或私有思维链出现在证据/日志/OAEP；
9. TalkBack 无法完成首次配置、发送、审批、错误修复或打开结果；
10. API 26/30/35/36 Emulator 或目标 ARM64 真机关键 journey 失败；
11. 真实模型统计、性能、资源或可用性指标未达门槛；
12. 候选来自 dirty/未知来源构建，或子报告使用不同 APK/Prompt/Tool/Kernel digest；
13. 存在未关闭的 P0/P1；
14. P10 账本未达到 60/60。

## 16. 交付物

1. 本 P10 开发与测试方案；
2. P10 60 项机器可读验收账本；
3. 首次成功向导和统一 Agent Readiness；
4. 用户任务进度、来源、计划、子任务和 Artifact 展示层；
5. 人类可读审批与授权中心；
6. 统一错误分类、错误卡和恢复中心；
7. SAF、附件、Artifact 和 Desktop Handoff 用户旅程；
8. 模块化 Compose 页面与 Agent UI 组件；
9. API 26/30/35/36 Emulator 自动化证据；
10. Flash/Pro 真实模型统计；
11. ARM64 手机/平板、无障碍、性能、资源和安全报告；
12. 非开发用户可用性验收报告；
13. v1.5.7 唯一候选 APK/Test APK、SBOM、hash 和签名身份；
14. P9 72/72 + P10 60/60 最终 Go/No-Go 报告。

## 17. 完成定义

Android P10 只有同时满足以下条件才算完成：

1. v1.5.7/10507 版本、包名、渠道、应用内信息和证据一致；
2. P9 已严格达到 72/72；
3. P10 60/60 功能点均有生产代码、自动化测试和候选证据；
4. 新用户可在 3 分钟内从空配置完成一次真实 Full Runtime Agent 任务；
5. 普通用户无需理解底层协议即可看懂任务步骤、授权、错误和恢复；
6. 所有技术状态仍能在高级诊断中脱敏、复制并与 OAEP 对账；
7. 工具、审批、工作区、Artifact、Handoff、后台和恢复无重复副作用；
8. API 26/30/35/36 Emulator、ARM64 手机和平板关键旅程全部通过；
9. 真实双模型、无障碍、性能、资源、安全和可用性指标达到发布门槛；
10. 从干净 checkout 构建唯一候选，全部报告绑定相同 APK、Kernel、Prompt、Tool 和 Capability 身份；
11. 无未关闭 P0/P1，已知 P2 有明确归属和发布决策；
12. 最终 Go/No-Go 明确为 GO。

达到以上条件后，Android “Full Agent Runtime”才不仅是技术上存在的执行链，也成为普通用户能配置、能理解、敢授权、可恢复并愿意长期使用的完整产品能力。
