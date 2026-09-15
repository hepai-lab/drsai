# Android P10 用户友好的 Full Agent Runtime 产品化进度

> 权威方案：`docs/android/plans/runtime/ANDROID_P10_USER_FRIENDLY_FULL_AGENT_RUNTIME_PRODUCTIZATION_PLAN.md`  
> 产品版本：Android v1.5.7 / versionCode 10507  
> 统计口径：功能点必须同时具备生产实现、自动化测试和候选证据才计入完成。

## 总体状态

| 指标 | 当前值 |
|---|---:|
| P9 正式进度 | 69/72（95.83%） |
| P10 严格进度 | 41/60（68.33%） |
| 当前阶段 | P10-S0 完成，进入 P10-S1 |
| 当前决定 | IN PROGRESS |

## 第 1 轮

- 将 Android Debug/MVP 的默认开发版本从硬编码 v1.5.6 改为仓库统一 `cores/VERSION`，当前为 v1.5.7/10507；
- Android OAEP Runtime 当前版本更新为 1.5.7，最低兼容版本保持 1.5.6；
- 建立 60 项 P10 机器账本并在 Gradle 配置期校验编号、状态、测试和证据；
- 新增 `P10_PRODUCTIZATION_COMPLETE` 与 `P10_RELEASE_CANDIDATE_READY`，后者只能由 P9 72/72 与 P10 60/60 共同派生；
- Android 定向 JVM 测试通过；P9/P10 账本 pytest 为 4/4；Debug APK 构建成功；
- `aapt badging` 确认 APK 为 `ai.drsai.remote.debug`、v1.5.7、versionCode 10507；
- 接受 M01-F01、M01-F02，P10 严格进度更新为 2/60（3.33%）。

## 第 2 轮

- 新增统一 `AgentReadinessPolicy`，按模型、凭据、Provider、工具能力、Runtime、网络和工作区权限派生互斥状态与唯一主操作；
- 新增 `UserFacingFailureMapper`，覆盖配置、凭据、额度/限流、网络、模型能力、Runtime、权限、工具、审批、恢复和平台不支持 11 类错误；
- 技术详情限制为 512 字符，并修复 Authorization/Bearer/API Key 脱敏回归；
- 定向 Android JVM 测试 10/10 通过；接受 M03-F01、M06-F01；
- P10 严格进度更新为 4/60（6.67%），P9 保持 69/72（95.83%）。

## 第 3 轮

- 新增账户作用域的首次成功向导状态机，覆盖欢迎、模型服务、连接检查、Runtime 检查、第一次任务和完成；
- 已配置且有历史活动的升级用户自动标记完成，不被重复打扰；新用户按真实 Readiness 进入准确修复步骤；
- Readiness 接入 `AppState`、Full Runtime 绑定变化、模型刷新和本地发送前门禁，未就绪时不创建失败 Run；
- 首页新增单主操作健康卡，支持进入模型设置、重新启动 Runtime 和稍后处理；第一次任务成功后持久标记完成；
- 首次全量回归因 Gradle 旧构造签名缓存出现 1 个 `NoSuchMethodError`，执行 clean 后 648 项 JVM 测试零失败；
- API 35 Emulator 的 `MainInterfaceTest` 24/24 通过；接受 M01-F03、M03-F02；
- P10 严格进度更新为 6/60（10.00%），P9 保持 69/72（95.83%）。

## 第 4 轮

- Provider 连接检查不再只判断 HTTP 2xx；现在解析模型目录并验证所有已启用模型 ID 确实存在；
- 增加 DNS、TLS、超时、401、402、403、404、429、5xx、空响应、非法目录和模型不存在的稳定错误码；
- Provider 错误统一进入 `UserFacingFailureMapper`，设置页显示通俗摘要、唯一推荐下一步和稳定 code，不再误报 Runtime 故障；
- OpenAI/Anthropic 请求头、`/v1` 路径、目录去重排序和工具模型 ID 均完成回归；
- Provider 定向测试 14/14 通过，AndroidTest 编译通过；接受 M02-F03；
- P10 严格进度更新为 7/60（11.67%），P9 保持 69/72（95.83%）。

## 第 5 轮

- 新增 Provider 验证状态持久化：按账号保存 Provider 修订号、协议、地址、已验证模型集合和检查时间，不保存 API Key；
- Provider URL、协议、修订号或启用模型集合变化时，旧验证状态自动失效；草稿验证结果只在成功保存后绑定到正式 Provider；
- 应用重启后可恢复仍有效的验证结果，删除 Provider 时同步清理；
- 本轮属于 M02-F04 的前置基础设施，尚未覆盖其完整模型发现与推荐验收条件，因此严格进度维持 7/60（11.67%）。

## 第 6 轮

- 新增模型推荐策略：优先保留用户当前已启用、支持 tools 且 Provider 已验证的选择；否则只从已验证工具模型中推荐，未知能力、未验证、纯聊天或禁用模型不会成为默认值；
- 模型目录合并覆盖空列表、大小写重复 ID、1000 个模型和本地孤立选择，结果稳定且不会删除用户手工配置；
- Android 全量 JVM 回归 656 项零失败、2 项跳过；API 35 Emulator 的 `ModelSettingsScreenUiTest` 5/5 通过；
- 接受 M02-F04；P10 严格进度更新为 8/60（13.33%），P9 保持 69/72（95.83%）。

## 第 7 轮

- “稍后”会持久保持跳过状态；首页改为显示单一“完成模型配置”主操作，个人中心增加“继续完成 Agent 设置”入口；
- 用户尝试未就绪的本地任务时，统一 Run admission 在生成 Run ID、消息或 OAEP 事件之前返回 `DEFER_WITHOUT_RUN`，只更新就绪提示；
- 补充进程重建后保持跳过、显式恢复到当前安全步骤、未就绪不创建失败 Run 及首页恢复卡测试；
- Android 全量 JVM 回归 657 项零失败、2 项跳过；后续新增门禁定向测试 8/8 通过；API 35 Emulator 的 `MainInterfaceTest` 25/25 通过；
- 接受 M01-F05；P10 严格进度更新为 9/60（15.00%），P9 保持 69/72（95.83%）。

## 第 8 轮

- 向导全部活动步骤、跳过态和完成态均通过 Android 持久化边界重建测试；新 Store 实例可恢复原步骤，覆盖进程被系统回收后的恢复路径；
- 旋转由同一 ViewModel 状态承接，若进程同时被回收则回落到已验证的 Store 恢复路径；Reducer 只消费 readiness 和向导元数据，不写 Provider、模型或凭据配置；
- 持久化内容扫描确认不包含 API Key 或 Bearer 凭据，向导 Store 仅保存步骤、状态、时间和稳定原因码；
- SetupJourney JVM 定向测试 7/7、API 35 Emulator 持久化仪器测试 2/2 通过；
- 接受 M01-F04；P10 严格进度更新为 10/60（16.67%），P9 保持 69/72（95.83%）。

## 第 9 轮

- 智增增、HepAI、OpenAI 预设现在均由不可编辑的固定 URL/协议和推荐模型驱动；预设流程只要求用户提供必要凭据并确认模型，不暴露协议手工配置；
- 修复 API Key 草稿生命周期：保存或放弃编辑时立即清空，配置变化不进入 `rememberSaveable`，Activity 重建后不恢复密钥正文；
- Provider 编辑期间启用 Android `FLAG_SECURE` 阻止系统截图/最近任务预览，离开后恢复原窗口策略；API Key 默认密码遮挡；
- 新增剪贴板不改写、EncryptedSharedPreferences、Room、日志、备份目录和 `allowBackup=false` 的 canary 扫描；13/13 API 35 安全矩阵通过；
- Android 全量 JVM 回归 659 项零失败、2 项跳过；模型设置 UI 9/9 通过；接受 M02-F01、M02-F02；
- P10 严格进度更新为 12/60（20.00%），P9 保持 69/72（95.83%）。

## 第 10 轮

- 新增产品级 Full Runtime 功能检查，不再把 Python Runtime 绑定成功或 Provider 目录连接成功误报为“Agent 可用”；
- 检查通过真实共享 Python Kernel 和 Host Port 执行无副作用时间工具，严格要求模型请求、工具调用、成功工具结果、基于结果的第二次模型请求、最终回答和 `run.completed` 全部出现；
- 模型直接回答、不调用工具的负例会被 Kernel 纠偏并最终 fail closed，不能写入可用证明；只有完整报告可持久化；
- 证明绑定账号、Provider 修订、模型、Runtime 版本和凭据检查代次；任一变化后 readiness 回到“检查 Agent 功能”；
- Android 全量 JVM 回归 660 项零失败、2 项跳过；API 35 Emulator 真实共享 Runtime 正负冒烟 2/2、首页与功能检查 UI 合计 28/28 通过；
- 接受 M02-F05；P10 严格进度更新为 13/60（21.67%），P9 保持 69/72（95.83%）。

## 第 11 轮

- 修复首次任务步骤 READY 时只显示禁用“继续”的死路，改为普通聊天、带来源联网检索、本机只读设备工具三类明确示例；
- 示例按当前 Full Runtime 工具能力动态过滤，不向用户展示不可执行的检索或设备工具承诺；任选一项即可完成首次成功；
- 只有生产 Run 正常完成才调用 `firstTaskCompleted`；失败仍保持 FIRST_TASK 和当前账号，不重置登录或要求重走模型配置；
- API 35 Emulator 通过共享 Python Kernel 顺序执行三类示例，验证检索调用 `web.search` 且答案带来源、本机任务调用 `get_device_info`，三条均 `run.completed` 且总耗时低于 3 分钟；
- Android 全量 JVM 回归 663 项零失败、2 项跳过；MainInterfaceTest 27/27、首次任务 E2E 1/1 通过；
- 接受 M02-F06；P10 严格进度更新为 14/60（23.33%），P9 保持 69/72（95.83%）。

## 第 12 轮

- 将个人中心 Runtime 技术字段收进默认折叠的“高级诊断”，默认只保留 route、绑定和健康摘要，避免普通用户首屏看到 digest/计数器；
- 展开后完整显示版本、route、绑定、进程、Run/error ID、Kernel、Prompt、Tool、Skill、Capability 版本与 digest，以及工具/Skill 能力清单；
- 增加独立复制和分享操作；分享使用 `ACTION_SEND text/plain`，复制和分享均经过用户主动写入策略及最终敏感数据脱敏；
- `FullRuntimeDiagnosticUi.exportText()` 自身改为 fail-safe 脱敏，Authorization、Bearer、API Key 即使从错误原因意外进入也不会进入剪贴板或分享 Intent；
- Android 全量 JVM 回归 664 项零失败、2 项跳过；API 35 高级诊断 UI、折叠、复制和分享 Intent 28/28 通过；
- 接受 M03-F03；P10 严格进度更新为 15/60（25.00%），P9 保持 69/72（95.83%）。

## 第 13 轮
- 新增统一 `CapabilityGuidancePolicy`，由同一份投影同时驱动发送前能力清单和模型可见工具 schema，避免 UI 与 Runtime 边界分叉。
- 首页增加可折叠“当前能做什么”，区分本地可用、需要本地权限、需要 Desktop、当前模型不支持，并提供工作区授权、Desktop 连接和更换模型入口。
- 模型 schema 采用 fail-closed 过滤：只有 `LOCAL_AVAILABLE` 工具可见，需权限、需 Desktop 和不支持项均不能进入模型请求。
- Android 全量 JVM 回归 666 项零失败、2 项跳过；API 35 Emulator `MainInterfaceTest` 29/29 通过。
- 接受 M03-F04；P10 严格进度更新为 16/60（26.67%），P9 保持 69/72（95.83%）。

## 第 14 轮
- 网络 validated capability、SAF 授权、模型配置与 Runtime binding 变化现在会实时刷新能力投影和 readiness，且刷新不会写入临时错误状态。
- 新增 `RunEnvironmentSnapshot`，在 Run 开始边界按值冻结工具 schema、Skill schema 与 Host capability；运行中的任务不受后续网络或授权变化影响，下一 Run 才读取新状态。
- Android 全量 JVM 回归 668 项零失败、2 项跳过；API 35 Emulator `MainInterfaceTest` 29/29 通过。
- 接受 M03-F05；P10 严格进度更新为 17/60（28.33%），P9 保持 69/72（95.83%）。

## 第 15 轮
- Full Runtime 冷启动、Binder death 与 `:runtime` 进程回收统一走最多 2 次的有界重绑；连续失败明确进入 `UNAVAILABLE`，不改变执行 authority。
- 修复执行中 Runtime 丢失后的恢复语义：尚无副作用时发布 `run.waiting` 并保留 checkpoint；已观察到副作用时强制生成 `side_effect.reconciliation_required`，禁止盲重放。
- 修复生命周期物理验收的非确定测试顺序，API 35 Emulator 实际终止/重启隔离 Runtime 后 6/6 通过且 0 跳过，验证同 Run 恢复和 waiting-tool 单次重放。
- Android 全量 JVM 回归 672 项零失败、2 项跳过；Kotlin Lite fallback 始终关闭。
- 接受 M03-F06；P10 严格进度更新为 18/60（30.00%），P9 保持 69/72（95.83%）。

## 第 16 轮
- 建立确定性的 OAEP 用户任务步骤模型，覆盖消息、Web、文件、Plan、Subagent、Artifact 与未知 Notice fixture。
- 内部 reasoning 改为“分析任务”且不展示私有思维链正文；Web 搜索/读取、本地文件、委派和计划均映射为用户可理解阶段。
- 未知或未来 OAEP Notice 安全显示为“处理中”，原始 level/code 只保留在高级详情，保证协议扩展不会导致空白或泄漏内部名。
- Android 全量 JVM 回归 673 项零失败、2 项跳过；API 35 `OaepToolVisibilityUiTest` 1/1 通过。
- 接受 M04-F01；P10 严格进度更新为 19/60（31.67%），P9 保持 69/72（95.83%）。

## 第 17 轮
- OAEP 时间线改为三级渐进披露：默认只显示人类步骤摘要，活动 Run 也不再自动暴露执行详情；展开后显示目的、安全输入摘要、耗时、结果、执行位置和来源。
- 内部 Tool 名、MCP server 与错误诊断只在用户主动打开“高级详情”后显示；默认和普通展开态均不显示 JSON 或内部 Tool 名。
- API 35 Compose 验收生成默认、展开、高级三态截图，并验证高级详情开关与敏感数据不出现。
- Android 全量 JVM 回归 673 项零失败、2 项跳过；API 35 `OaepToolVisibilityUiTest` 1/1 通过。
- 接受 M04-F02；P10 严格进度更新为 20/60（33.33%），P9 保持 69/72（95.83%）。

## 第 18 轮
- 时间线不再在每次 OAEP delta 到达时强抢滚动；用户触摸上滚后锁定当前位置，新内容继续合并但不改变阅读位置。
- 增加明确的“回到最新”入口；键盘出现时保证 Composer 与最新内容可见，同一条流式消息采用合并后的即时定位，避免重复动画抖动。
- API 35 长时间线测试连续注入 20 次快速更新，验证无丢字、用户位置保持、显式回底；状态恢复测试验证旋转式重建后仍保持上滚偏好。
- Android 全量 JVM 回归 675 项零失败、2 项跳过；API 35 `OaepTimelineScrollUiTest` 2/2 通过。
- 接受 M04-F03；P10 严格进度更新为 21/60（35.00%），P9 保持 69/72（95.83%）。

## 第 19 轮
- 建立统一来源模型，明确区分网页、本地文档和 Artifact；网页可点击，本地来源和产物以类型标签展示而不伪造 URL。
- URL 只接受带有效 host 且无 user-info 的 HTTP/HTTPS；拒绝 JavaScript、畸形 URL 和含凭据 URL，并按规范化来源去重。
- 模型引用的格式有效 URL 不自动标“已核验”；只有成功工具结果、OAEP 本地资源和完成 Artifact 才显示已核验，避免把不可验证引用误报为证据。
- Android 全量 JVM 回归 676 项零失败、2 项跳过；API 35 来源 UI 1/1 通过。
- 接受 M04-F04；P10 严格进度更新为 22/60（36.67%），P9 保持 69/72（95.83%）。

## 第 20 轮
- OAEP Plan 映射为用户任务进度，展示总目标、已完成/进行中/等待/失败计数和逐步状态，不再只显示一段内部计划文本。
- 并行 Subagent 作为独立子任务显示；完成与失败并存时明确标记“部分步骤失败，其余结果仍已保留”。
- reasoning 仅映射为“分析任务”阶段，不展示私有思维链正文；fixture 明确验证敏感 reasoning 文本未进入投影。
- Android 全量 JVM 回归 677 项零失败、2 项跳过；API 35 计划与部分失败 UI 1/1 通过。
- 接受 M04-F05；P10 严格进度更新为 23/60（38.33%），P9 保持 69/72（95.83%）。

## 第 21 轮
- 新增由 OAEP Snapshot Run 状态派生的唯一用户结果：已完成、执行失败、已取消、部分完成、已暂停可继续；未知状态安全显示为处理中。
- 每个 Run 只投影一个 `AssistantTurn` 和一个带稳定 test tag 的结果标签；部分完成必须同时存在已完成与失败步骤，可恢复必须来自 waiting/paused/recovering。
- JVM fixture 逐项核对 completed/failed/cancelled/recoverable 与 Snapshot，Compose 同屏验证五类结果每 Run 恰好一个。
- Android 全量 JVM 回归 678 项零失败、2 项跳过；API 35 终态 UI 2/2 通过。
- 接受 P10 M04-F06；P10 严格进度更新为 24/60（40.00%），P9 的同名功能点是不同的真机自然任务统计门禁，仍保持 pending，P9 仍为 69/72（95.83%）。

## 第 22 轮

- 新增由 Android Host 持有的 `ToolHumanPresentationCatalog`，为生产 Tool Registry 的时间、设备、记忆、联网、工作区、浏览器、委派与 MCP 工具统一提供动作、对象、执行中、成功和失败模板；
- OAEP 时间线的工具标题只依据受信任的工具 ID、状态和本地模板生成，不采纳模型提供的显示文案；未知工具固定显示“正在处理任务步骤”等安全通用文本，不泄露内部 ID，也不允许模型伪造用途；
- snapshot 单元测试覆盖全部生产工具族、动态 MCP 前缀和未知工具注入负例；Android 全量 JVM 回归 680 项零失败、2 项跳过，API 35 `OaepToolVisibilityUiTest` 2/2 通过；
- 接受 P10 M05-F01；P10 严格进度更新为 25/60（41.67%），P9 保持 69/72（95.83%）。

## 第 23 轮

- 新增 Host 持有的 `ApprovalRiskSummaryPolicy`，按只读、本地写入、敏感网页提交、MCP 和 Desktop Handoff 生成稳定的审批标题、原因、对象、风险和可撤销性；
- 未识别操作采用高风险 fail-closed 摘要，不使用模型文本推断安全性；审批中心默认不显示 Tool、Approval、Runtime、Session 等内部 ID，只有用户主动展开“高级详情”才显示；
- 首页内联审批卡和审批中心使用同一份摘要，保留拒绝、允许一次和会话授权的精确决策语义；
- Android 全量 JVM 回归 682 项零失败、2 项跳过；API 35 `MainInterfaceTest` 29/29 通过；
- 接受 P10 M05-F02；P10 严格进度更新为 26/60（43.33%），P9 保持 69/72（95.83%）。

## 第 24 轮

- “允许一次”改为默认主操作且不会创建持久授权；“本会话允许”精确绑定账户、组织、Runtime、Session 和 Tool，拒绝与到期继续保持终态；
- 审批中心新增“本会话已授权”列表和“撤销授权”入口，授权由 Room 持久化，进程重建后仍可查看；撤销后下一次相同工具调用必须重新审批；
- 扩展状态机测试，验证授权不跨账户、组织、Runtime、Session 或 Tool，覆盖允许一次、会话允许、拒绝竞态、到期与撤销；
- 修复回归暴露的 v14→v15 `sourceJson` 迁移非幂等问题，使部分升级/恢复数据库不会因重复列崩溃；
- Android 全量 JVM 回归 682 项零失败、2 项跳过；API 35 `LocalStoreTest + MainInterfaceTest` 57/57 通过，并新增进程式数据库重建定向用例 1/1 通过；
- 接受 P10 M05-F03；P10 严格进度更新为 27/60（45.00%），P9 保持 69/72（95.83%）。

## 第 25 轮

- 页面、通知和远端审批入口继续汇聚到同一 Room 条件更新或远端幂等账本；只有首个与完整 binding 匹配且未过期的决定能从 `PENDING` 进入终态；
- 重复点击、相反决定和延迟清理均不能覆盖胜出决定；Room Flow/持久账本让其他入口观察同一终态，不依赖单页面内存状态；
- OAEP 压力 fixture 与 Python durable receipt 共同验证批准后的副作用至多执行一次，进程死亡或重复投递只重放收据，不重放外部写入；
- Android 全量 JVM 基线 682 项零失败、2 项跳过；API 35 远端审批与 OAEP 压力 4/4、Room 首决定胜出定向测试 1/1 通过；
- 接受 P10 M05-F04；P10 严格进度更新为 28/60（46.67%），P9 保持 69/72（95.83%）。

## 第 26 轮

- 新增 `ApprovalChangePreviewPolicy`，把文件创建/更新、设置修改、多文件和 MCP fixture 投影为受限的目标与变更摘要；仅 allowlist 字段可落库，正文参数、令牌和 API Key 不进入审批记录；
- Room schema 升级到 v16，`workbench_approvals.previewJson` 持久化安全预览；v15→v16 迁移保留既有审批并为旧记录提供安全默认值，所有应用、恢复 Worker 和测试数据库均注册完整迁移链；
- 审批中心与首页卡片显示实际目标和变更摘要；内部 ID 仍只在高级详情显示；
- SAF 提交后强制核对 receipt 的路径与 mutation token 是否属于批准预览，范围不一致时以 `workspace_receipt_outside_approved_scope` fail closed；
- Android 全量 JVM 回归 685 项零失败、2 项跳过；API 35 数据库迁移、脱敏持久化与审批 UI 34/34 通过，receipt 定向回归通过；
- 接受 P10 M05-F05；P10 严格进度更新为 29/60（48.33%），P9 保持 69/72（95.83%）。

## 第 27 轮

- 新增 `ToolOperationOutcomePolicy`，把工具结果统一拆分为“已完成”“未执行”“可用补救”和“不可撤销说明”，部分成功不会被误报为整体成功或整体回滚；
- 工作区写入只有在成功 receipt 含真实 `mutation_token` 时才出现“撤销此修改”，点击后发起新的 `workspace.undo` 意图并再次经过审批；失败、缺少 token 或外部操作不伪造撤销入口；
- MCP、网页提交和 Handoff 成功后明确提示通常不可撤销，只建议新的反向操作；失败且无 receipt 时明确“未确认产生新的外部结果”；
- Android 全量 JVM 回归 689 项零失败、2 项跳过；API 35 操作结果与补救 UI 3/3 通过；
- 接受 P10 M05-F06；P10 严格进度更新为 30/60（50.00%），P9 保持 69/72（95.83%）。

## 第 28 轮

- Provider 401、403、402、408、429、5xx 和流式断连现在具有互不混淆的标题、影响和下一步：分别更新 Key、检查模型访问权限、检查余额/计费、检查网络、安全稍后重试；
- 修复 Provider 403 被误分为普通配置错误、5xx 被误分为 Runtime/配置错误的问题；服务端异常明确归因到模型服务，不再暗示 Android Full Runtime 损坏；
- 模型目录连接会保留服务商 JSON 的真实 error.message 供诊断，同时通过统一秘密扫描脱敏并限制长度；空 `{}` 仍使用稳定友好文案；
- 408/429/5xx/断流仅在其模型阶段标记可重试，401/403/402 不做盲重试；所有 fixture 验证正文保留、凭据删除和稳定 action；
- Android 全量 JVM 回归 691 项零失败、2 项跳过；
- 接受 P10 M06-F02；P10 严格进度更新为 31/60（51.67%），P9 保持 69/72（95.83%）。

## 第 29 轮

- 新增 `CapabilityRepairPolicy`，将 SAF 授权撤销、网络关闭、模型无工具能力和 Desktop 离线分别路由到“重新选择工作区”“打开网络设置”“选择支持工具的模型”“连接 Desktop”；
- 能力缺失错误不再显示普通“重试”按钮，ViewModel 同时拒绝该状态下的 retry 请求，避免在修复前重复创建 Run；原 Run/checkpoint 被保留；
- 工作区重新授权或更换模型成功后才清除对应修复状态；发送入口原有 `DEFER_WITHOUT_RUN` 门禁继续保证未就绪时不生成 Run ID、消息或 OAEP 事件；
- Android 全量 JVM 回归 693 项零失败、2 项跳过；API 35 `MainInterfaceTest` 31/31 通过；
- 接受 P10 M06-F03；P10 严格进度更新为 32/60（53.33%），P9 保持 69/72（95.83%）。

## 第 30 轮

- 新增统一 `SafeRetryPolicy`，覆盖模型阶段、只读工具、外部写入/敏感工具、副作用已开始和 durable receipt 已存在的组合；
- 模型与只读工具优先在原 Run 重试；写/敏感工具仅允许在副作用开始前从检查点继续；副作用结果未知必须进入 reconciliation，禁止重放；已有 receipt 只重放收据；
- 终态 Run 不会被含糊地当作原 Run 恢复：只有用户明确点击“新建 Run 重试”才创建新 Run；恢复候选继续显示“正在恢复”并沿用原 Run；
- ViewModel 对无恢复候选的 side-effect 错误拒绝创建新 Run，Python Host 的 `tool_side_effect_retry_forbidden` 与 durable receipt 门禁继续作为执行层兜底；
- Android 全量 JVM 回归 697 项零失败、2 项跳过；API 35 `MainInterfaceTest` 31/31 通过；
- 接受 P10 M06-F04；P10 严格进度更新为 33/60（55.00%），P9 保持 69/72（95.83%）。

## 第 31 轮

- 新增账户隔离的恢复中心，集中展示当前账户仍合法的暂停、等待审批、失败和可恢复 Run；30 天前的过期记录、其他账户记录及已归档记录不会进入候选；
- 超过 15 分钟仍处于 `QUEUED/RUNNING` 的 Run 会原子转换为 `PAUSED + stale_running_recovered`，避免永久 running；恢复中心提供按状态约束的继续、取消和归档操作；
- 归档通过持久化审计记录生效，并改用 `subject + runId` 查询，防止不同账户同名 Run 被误归档；首页提供恢复摘要入口；
- 修复回归暴露的 v15→v16 `previewJson` 迁移非幂等问题，部分升级/恢复数据库不会重复加列；
- Android 全量 JVM 回归 697 项零失败、2 项跳过；API 35 `LocalStoreTest` 42/42、`MainInterfaceTest` 32/32 通过。首次合并运行在 38/62、0 失败时模拟器进程退出，重启后拆分复测全部通过；
- 接受 P10 M06-F05；P10 严格进度更新为 34/60（56.67%），P9 保持 69/72（95.83%）。

## 第 32 轮

- 将高级诊断的复制/分享升级为同一份结构化诊断反馈包，包含应用版本与构建类型、设备厂商/型号、Android API、稳定错误码、脱敏 Run 引用、Run 状态、最近事件类型摘要和运行时/清单 digest；
- Run ID 仅以 SHA-256 短引用出现，事件摘要只接收 sequence/type/source/errorCode 元数据，不接收事件 ID、消息正文、Prompt、Reasoning 或错误正文；反馈包自身附带稳定 SHA-256 `feedback_digest`；
- 新增独立秘密扫描器，复制和分享前必须扫描通过；覆盖 Bearer、常见 API Key、Token/Password/Cookie 赋值、私钥以及正文/思维链字段，失败时 fail closed；
- JVM 隐私负例注入 Key、私密正文和 reasoning，确认均不出包；Android 全量 JVM 回归 699 项零失败、2 项跳过；API 35 复制/分享界面与 Intent 32/32 通过；
- 接受 P10 M06-F06；P10 严格进度更新为 35/60（58.33%），P9 保持 69/72（95.83%）。

## 第 33 轮

- 将 SAF 能力修复改成任务内授权旅程：先展示范围说明，再由用户主动打开系统目录选择器；明确只授予所选目录，不获得其他位置权限；
- 授权旅程绑定当前可恢复 Run ID；系统选择器拒绝/取消时清空临时旅程但保留原任务，并显示可重新授权提示；成功授权后刷新能力并自动继续同一原 Run，不创建新 Run；
- SAF 已被撤销时能力门禁仍会回到同一授权旅程，未经过范围说明无法直接进入选择器；
- Android 全量 JVM 回归 701 项零失败、2 项跳过；API 35 范围说明、主操作与回调 UI 33/33 通过；
- 接受 P10 M07-F01；P10 严格进度更新为 36/60（60.00%），P9 保持 69/72（95.83%）。

## 第 34 轮

- SAF 授权时只保存安全目录显示名，主任务界面持续显示“当前工作区”及“工具只能访问此目录中的相对路径”；清除授权时同步清除名称；
- 工作区路径入口现在显式拒绝 Unix/Windows 绝对路径、`content://`/`file://` URI、遍历、空段与 NUL，越界一律 fail closed，不再把 `/etc` 静默解释成工作区内 `etc`；
- 解析每级目录时检测同名项，多项同名不再任取第一个而是以 `saf_path_ambiguous` 失败；搜索、glob、grep、receipt 和模型工具输出只保留工作区相对路径，不暴露底层 URI/绝对路径；
- Android 全量 JVM 回归 703 项零失败、2 项跳过；API 35 工作区名称与边界提示 UI 34/34 通过；
- 接受 P10 M07-F02；P10 严格进度更新为 37/60（61.67%），P9 保持 69/72（95.83%）。

## 第 35 轮

- 图片与文档草稿在发送前显示名称、类型对应预览、大小与状态；草稿由 ViewModel 持有，Compose 重建/旋转不会触发重新准备或重复上传；
- 失败附件现在同时提供“重试”和独立“移除”，不会迫使用户删除其他已就绪草稿；其他成功上传的草稿保留 `remoteId`，重试时直接复用，不再次上传；
- 上传幂等键稳定绑定附件草稿 ID，而非 Run ID；跨重试/新 Run 使用相同键，服务端可去重；上传中显示独立进度，失败保留本地缓存供重试；
- Android 全量 JVM 回归 704 项零失败、2 项跳过；API 35 原 35 项合并运行仅新用例因横向列表语义定位失败，改用稳定 tag 后该定向用例 1/1 通过，其余 34 项已在同轮通过；
- 接受 P10 M07-F03；P10 严格进度更新为 38/60（63.33%），P9 保持 69/72（95.83%）。

## 第 36 轮

- 结果页 Artifact 卡现在显示用户可读类型（文本/图片/PDF/二进制）、本地化大小、来源、会话与关联 Run；
- 打开和分享继续统一经过账户范围、应用私有存储、256 MB 上限、实际大小与 SHA-256 校验，只有校验成功才签发只读 `content://` Intent；
- 新增稳定失败投影：内容缺失显示“结果已过期”，digest 不符显示“校验失败”，超限/大小异常给出明确原因；可恢复情况提供“重新生成”，未知失败不伪造可恢复操作；
- Android 全量 JVM 回归 705 项零失败、2 项跳过；首次 API 合并运行因新测试 Kotlin 末表达式返回 Boolean 导致 JUnit 初始化失败并污染后续 Activity，修正为 `Unit` 后 Artifact 数据校验 3 项与结果卡 UI 1 项共 4/4 通过；
- 接受 P10 M07-F04；P10 严格进度更新为 39/60（65.00%），P9 保持 69/72（95.83%）。

## 第 37 轮

- Desktop Handoff 从自动选择首台设备改为显式向导：先解释为何需要电脑、执行位置、所需能力和将传递的任务说明/附件引用与 digest/指令版本，再要求用户选择目标；
- Planner 返回全部在线且能力满足的 Desktop 候选，按名称/Runtime ID 稳定排序；离线或能力不足设备不进入合法候选，UI 中离线 fixture 不可选择；
- `pendingDesktopHandoffDraft` 在用户选择前不含目标；“创建 Handoff”按钮在未选择时禁用，ViewModel 也有 null 目标 fail-closed 门禁；只有选择合法目标并再次确认后才调用 `HandoffPackageFactory.create`；
- JVM 覆盖无设备、单设备、多设备、离线和权限/能力不足，Android 全量 JVM 回归 706 项零失败、2 项跳过；API 35 传递摘要与目标选择 UI 1/1 通过；
- 接受 P10 M07-F05；P10 严格进度更新为 40/60（66.67%），P9 保持 69/72（95.83%）。

## 第 38 轮

- Handoff offer OAEP 事件不再在用户选择前写入自动推荐目标，只记录有序候选 Runtime ID；accepted 事件才绑定最终目标、package digest 与 source Run；
- 新增 Android→Desktop→Android 连续性 reducer，强制同一 Handoff/Session/source Run/target Run 绑定，回放中任何关联漂移 fail closed；消息、Artifact、side-effect receipt 与事件 ID 均集合去重；
- 审批竞态采用首个终态决定胜出，相反决定和反向/重复回放不能覆盖；同一 receipt 不会造成副作用重复，Android 回看仍保留 source/target Run、Session 与 Artifact 关联；
- Android 全量 JVM 回归 708 项零失败、2 项跳过；API 35 本地 OAEP/Relay 测试任务构建通过，真实 Relay 子场景因未提供 `relayBaseUrl/registrationCode` 按测试契约跳过，确定性往返与竞态 fixture 已全部通过；
- 接受 P10 M07-F06；P10 严格进度更新为 41/60（68.33%），P9 保持 69/72（95.83%）。

## 第 39 轮

- 新增长任务单一状态投影，页面状态条与前台通知消费同一个 `LongTaskSnapshot`，步骤 ID、用户文案、Run 与 Session 导航范围保持一致；
- 5/15/30 分钟使用虚拟时钟验收；前后台切换不改变当前步骤，点击通知仍携带原始 Run/Session，乱序 checkpoint 会 fail closed；
- 通知心跳最低间隔 15 秒，真实步骤变化可立即发布；实现不包含阻塞等待、忙轮询或主线程 sleep，避免以高频唤醒维持假在线；
- Android 全量 JVM 回归 712 项零失败、2 项跳过；定向 `LongTaskStateProjectorTest` 4/4 通过；
- 接受 P10 M08-F01；P10 严格进度更新为 42/60（70.00%），P9 保持 69/72（95.83%）。

## 第 40 轮

- 继续与取消通知动作现在必须同时携带账户、Run 和 Session；MainActivity 与 ViewModel 双层校验当前登录账户及实际 checkpoint，跨账户、跨 Run 或跨 Session 请求静默 fail closed；
- 审批与结果动作契约额外强制 Interaction 范围，缺失 Interaction 无法构造；OAEP 打开 Intent 同样加入账户绑定和动作 allowlist；唯一导出的外部入口继续不转发任何控制 action/extras；
- API 35 模拟器 `OaepRunNotificationIntentTest` 3/3 通过，验证显式内部 Intent、完整范围和非法动作拒绝；策略测试 3/3 通过；
- Android 全量 JVM 回归 715 项零失败、2 项跳过；
- 接受 P10 M08-F02；P10 严格进度更新为 43/60（71.67%），P9 保持 69/72（95.83%）。

## 第 41 轮

- 新增与实际 Full Runtime Run 生命周期绑定的网络连续性状态机，覆盖 Wi-Fi、蜂窝、离线、恢复与受限网络；Android 默认网络回调会实时更新当前 Run 的连接阶段；
- OAEP checkpoint 的已完成 sequence 在网络切换中保持单调，任何游标回退均 fail closed；恢复沿用同一 Run，不重复已完成步骤；
- 重连限制为最多 5 次、最长 120 秒，指数退避封顶 30 秒；预算耗尽后明确显示“网络已恢复，但 Runtime 重连失败”，与“等待网络，已保留进度”严格区分；
- Android 全量 JVM 回归 718 项零失败、2 项跳过；`NetworkRunContinuityTest` 3/3 通过；
- 接受 P10 M08-F03；P10 严格进度更新为 44/60（73.33%），P9 保持 69/72（95.83%）。

## 第 42 轮

- 新增后台执行约束策略，覆盖 Doze、省电模式、系统后台限制、缺失前台服务和前台服务超时；无法合法继续时统一转为可恢复暂停并保留原 Run；
- 前台服务启动时读取 Android `PowerManager`、进程重要级别和 `ActivityManager.isBackgroundRestricted`，受到约束时先发布暂停通知、写入恢复调度再安全退出；现有 FGS 超时回调沿用同一恢复链路；
- 所有暂停/受限决策明确不设置周期性高频唤醒，Doze 只交给带系统约束的 WorkManager，避免伪造持续在线；
- Android 全量 JVM 回归 720 项零失败、2 项跳过；`BackgroundExecutionPolicyTest` 2/2 通过；
- 接受 P10 M08-F04；P10 严格进度更新为 45/60（75.00%），P9 保持 69/72（95.83%）。

## 第 43 轮

- 会话日常管理补齐搜索、重命名、归档、继续和永久删除；删除必须经过包含对象名称与不可撤销说明的二次确认，运行中的 Run 会阻止删除并要求先取消或等待完成；
- 本地删除在单一 Room 事务内清理 Session、Run、Event、审批、授权、审计和旧会话消息；所有查询和删除均绑定账户，测试确认不会删除另一账户的同名或相邻数据；
- 模型切换明确只作用于下一次发送创建的 Run；活动 Run 保留已固定模型，历史 Run/路由快照仍可按原模型重放，界面提示“下一次发送时生效，历史记录保持不变”；
- API 35 模拟器会话数据与删除确认定向验收 2/2 通过；Android 全量 JVM 回归 721 项零失败、2 项跳过；
- 接受 P10 M08-F05；P10 严格进度更新为 46/60（76.67%），P9 保持 69/72（95.83%）。

## 第 44 轮

- 统一无会话、无结果、无网络、无模型和能力变化五类空状态，每类只返回一个稳定的推荐主操作，避免多个同权按钮让用户猜测下一步；
- 示例任务按当前 `chat`、`web_search`、`workspace_read` 能力动态过滤；不具备的工具能力不会出现在示例中，能力变化后重新计算；
- 会话抽屉与结果页已接入共享空状态组件，展示明确说明、能力许可的示例和唯一主按钮；
- API 35 空状态 UI 验收 1/1 通过；Android 全量 JVM 回归 723 项零失败、2 项跳过；
- 接受 P10 M08-F06；P10 严格进度更新为 47/60（78.33%），P9 保持 69/72（95.83%）。

## 第 45 轮

- 核心任务页补齐 TalkBack 语义：顶部图标按钮保留名称与启用状态，消息输入框报告目标 Agent、空白/字符数和不可编辑原因，执行过程报告按钮角色及展开状态；
- OAEP 时间线建立显式 traversal group 和单调 traversal index，用户消息与 Agent 回复含可区分的语义摘要；活动 Run 使用 polite live region 更新，不抢断当前朗读；
- OpenDrSai 标题标记为 heading，纯装饰图标保持不单独聚焦；附件、分享、保存、删除等可操作图标继续使用明确 content description；
- API 35 `CoreAccessibilitySemanticsTest` 3/3 通过，验证视觉与语义阅读顺序、输入控件以及禁用按钮状态；Android 全量 JVM 回归 723 项零失败、2 项跳过；
- 接受 P10 M09-F01；P10 严格进度更新为 48/60（80.00%），P9 保持 69/72（95.83%）。

## 第 46 轮

- 动态字体矩阵覆盖 100%、150% 和 200%，新增 320dp 小屏 200% 与 900dp 平板 150% 核心任务布局验收；标题、空状态主操作和输入框保持可见；
- 首次小屏测试发现 Composer 的附件按钮在 Row 压力下缩到不足 48dp，改为 `requiredSize(48.dp)`，并同步固定语音、发送和停止按钮，复测全部达标；
- 执行过程展开行增加最小 48dp 高度；附件横向滚动仍与消息输入和主操作分区，不会阻塞发送；
- API 35 新增字体/设备测试 2/2 通过，既有 150% 抽屉、200% Header/Composer 与触控检查继续通过；Android 全量 JVM 723 项零失败、2 项跳过；
- 接受 P10 M09-F02；P10 严格进度更新为 49/60（81.67%），P9 保持 69/72（95.83%）。

## 第 47 轮

- 扩展深浅色对比度矩阵，覆盖正文、背景、surface variant、Primary/Secondary/Tertiary/Error container 的正文组合，所有正文均达到 WCAG AA 4.5:1；主要非文本操作保持至少 3:1；
- 在线、离线、暂停、连接中、降级、不兼容和需登录状态均同时提供文字、动作与完整 accessibility description，不以绿色、黄色或红色作为唯一信息来源；
- 新增减少动画策略；Android 系统关闭动画或用户选择减少动画时，远程连接脉冲不再创建无限动画，状态保持静态可读；用户主动滚动也不会被非必要动画接管；
- Android 全量 JVM 回归 724 项零失败、2 项跳过；主题对比度、状态非色彩表达和 reduced-motion 测试全部通过；
- 接受 P10 M09-F03；P10 严格进度更新为 50/60（83.33%），P9 保持 69/72（95.83%）。

## 第 101 轮

- 将 Android 主代码中的中文展示字面量债务从 382 逐轮降至 0，并把 `LocalizationResourceGateTest` 升级为零容忍；中英文资源名称保持完全对等。
- 核心旅程、关联错误、运行状态、通知、恢复中心、工具结果、产物错误、远程会话、更新失败与模型切换均改由 Android 资源解析；协议值、隐私检测词和意图词保持稳定语义。
- API 35 模拟器 `LocalizationInstrumentedTest` 2/2 通过，覆盖 zh-CN/en-US、复数、RTL 和长文案；格式化测试覆盖日期、数量、大小和时区。
- Android 全量 JVM 回归 728 项零失败、2 项跳过；接受 P10 M09-F04，P10 严格进度更新为 51/60（85.00%），P9 保持 69/72（95.83%）。

## 第 107 轮

- 当前 v1.5.7 候选 APK 在 API 35 模拟器完成 Runtime 资源采集：Runtime 冷启动 P95 1115ms、PSS P95/峰值 124.39MB、CPU P95 4.09%、安装包加数据 75.87MB、网络增量 0、十次启动电量下降 0%、热状态 0、ANR 0，Runtime 进程可完整释放。
- 500 Run / 50 工具副作用 / 20 恢复压力套件通过；数据库 4.15MB、前台 PSS 101.03MB、UI 冷启动 P95 2542ms、恢复 P95 5.58ms，重复副作用、数据损坏和永久 RUNNING 均为 0。
- 两组采集绑定同一 APK SHA-256，11/11 聚合资源门禁通过；接受 P10 M09-F06，P10 严格进度更新为 52/60（86.67%），M09-F05 因当前 AVD 始终处于 `run-from-apk` 且 Macrobenchmark 页面帧/启动预算尚未可靠通过而保持 pending。

## 第 108 轮

- 当前 v1.5.7 候选 APK 完成设备级动态秘密扫描：APK、app 私有数据、logcat、OAEP、checkpoint/receipt、绝对敏感路径与跨账户读取均为 0 命中；Runtime Service 外部启动继续被系统拒绝。
- 诊断反馈、Full Runtime 高级诊断与审批变更预览 JVM 脱敏测试全绿；修复 OAEP Compose 截图测试仍使用硬编码本地化文案的问题，定向屏幕 canary 测试 1/1 通过并生成默认、展开、高级详情三张截图。
- M10-F01 聚合隐私与凭据门禁 7/7 通过；接受 P10 M10-F01，P10 严格进度更新为 53/60（88.33%），P9 保持 69/72（95.83%）。

## 第 109 轮

- API 26/30/35/36 四台模拟器统一运行 setup 恢复、首次任务、Full Runtime 关键能力与 500-run 错误恢复矩阵，共 20/20 通过；首次任务测试修复了 Android 字符串资源 ID 被误传为 prompt 整数的问题。
- Handoff 本地闭环最初并行运行时因四个脚本争用同一 Relay/端口产生 Desktop 投影 403；改为串行隔离后四档 API 全部通过，Android→Desktop 与 Desktop→Android 每台各 9 个 OAEP 事件，断线续传成功，跨端审批副作用每台恰好执行一次。
- 新增 fail-closed 关键旅程证据生成器；5 条旅程 × 4 API 均生成截图、MP4、instrumentation 原文和每 API JUnit XML。修复 Handoff UI 测试写死中文文案、未随资源化本地化更新的问题，并将 runner 改为安装后从 PackageManager 自动发现。
- M10-F02 聚合门禁 6/6 通过；接受 P10 M10-F02，P10 严格进度更新为 54/60（90.00%），P9 保持 69/72（95.83%）。

## 第 110 轮

- 新增 P10 真实模型体验门禁，智增增 Key 仅从用户授权的 `.tmp.key` 进程内读取；报告和 logcat 明文 Key 均为 0 命中，测试结束恢复设备原凭据。
- 首轮统计定位 `deepseek-v4-pro` thinking + Tool continuation 未回传 `reasoning_content`，导致三个工具后续请求失败；实现仅内存 opaque continuation，禁止投影到 UI/OAEP，并在 Python checkpoint 中剥离。定向 Kotlin 回归通过，mobile-core 49/49 通过。
- 修复真实模型首次配置测试未创建/启用智增增预设、首次任务固定 Run ID 在复跑时命中幂等缓存、以及 app/test APK 构建不一致三项验收基础设施问题；匹配产物上的首次配置/首次任务 3/3、Runtime 恢复 6/6 通过。
- 同一修复后 app/test 候选完成 60/60 真实样本：Flash 工具选择 100%、参数 96.67%、任务成功 90%、Provider 错误 0%；Pro 工具选择 96.67%、参数 96.67%、任务成功 93.33%、Provider 错误 0%。接受 P10 M10-F03，P10 严格进度更新为 55/60（91.67%），P9 保持 69/72（95.83%）。

## 第 111 轮

- 新增 v1.5.5 Schema 11 与 v1.5.6 Schema 13 升级兼容仪器测试，使用候选应用真实 Room 迁移链升级到当前 Schema 16；迁移不允许 destructive fallback。
- 两条升级路径 2/2 通过；会话与消息、OAEP、模型配置、凭据引用、SAF 工作区引用、Memory、Tool Artifact 以及已完成的首次设置状态均可读，未重复显示设置向导。
- 新增 fail-closed 聚合验收脚本，证据绑定 app/test APK 与仪器测试 SHA-256；接受 P10 M01-F06，P10 严格进度更新为 56/60（93.33%），P9 保持 69/72（95.83%）。

## 第 112 轮

- 在 API 35 x86_64 模拟器安装 release-like benchmark 候选与独立 Macrobenchmark APK，确认冷启动、首次向导、500 项时间线、1000 模型列表及重组内存稳定性五项测试入口均可执行。
- 首轮直接 instrumentation 因未传 Gradle 的 Emulator 预验收豁免而有 4 项被基准框架拒绝，内存稳定性 1/1 通过；显式以 `EMULATOR` 预验收模式复跑后，1000 模型列表完成 5 次 Perfetto 采样，但模拟器 P95 CPU 帧时 315.9ms、P95 overrun 433.7ms，不具备代表真实设备的性能可信度，未据此接受 M09-F05。
- M09-F05 仍需非 `run-from-apk` 的 profileable 环境或 ARM64 真机完成冻结预算验收；P10 严格进度保持 56/60（93.33%），P9 保持 69/72（95.83%）。

## 第 113 轮

- 审计最终 Go/No-Go 的 P9 前置项：M04-F06 与 M09-F06 必须在物理 ARM64 设备执行 Flash/Pro 共 180 次真实模型观测；当前 P10 Emulator 的 60 次样本既不满足次数也不满足设备层级，未复用为正式证据。P9 M12-F06 仍必须最后从干净 checkout 执行。
- 新增 P10 M10-F04 真机矩阵验收器，强制至少一台 ARM64 手机和一台 ARM64 平板、API≥30；自动运行登录、首次成功、Full Runtime、审批、后台、恢复、通知和无障碍测试，并要求每台设备附带七条现场 journey 全绿及截图/视频引用。
- 新增 P10 M10-F05 五人可用性评分器，严格校验恰好五名非开发参与者、四项完整任务、首次成功耗时、协助次数、关键误授权和问题闭环；门禁为 4/5 无协助、耗时中位≤180秒、误授权0。外部门禁单元测试 6/6 通过，并补充正式执行协议。
- 本轮完善的是正式验收基础设施，尚未产生真实设备或真人证据，因此不提前计分；P10 保持 56/60（93.33%），P9 保持 69/72（95.83%）。

## 第 114 轮

- 完成 P9 物理设备正式门禁 dry-run：绑定当前 app/test APK SHA-256、30 类冻结任务、每类3次、Flash/Pro 两模型共180次观测，以及 M04-F06/M09-F06 两份正式输出路径；dry-run 明确标记 `release_evidence=false`，不会污染正式台账。
- P9 物理设备 handoff 预检通过；P10 外部门禁与严格台账联合回归 8/8 通过。正式执行仍会校验非 Emulator、物理 ARM64、Provider 配置及每模型完整原始观测。
- 当前所有不依赖外部参与者或物理硬件的剩余门禁准备均已完成；P10 保持 56/60（93.33%），P9 保持 69/72（95.83%）。

## 第 115 轮

- 再次审计 ADB：仅有 API 26/30/35/36 四台 x86_64 Emulator，全部 `ro.kernel.qemu=1`；没有物理 ARM64 手机或平板，不能执行 P10 M09-F05/M10-F04 或 P9 M04-F06/M09-F06 的正式重跑。
- 仓库中的旧 P9 物理设备证据来自 Samsung SM-X936C/API36/arm64，共180次观测但 `passed=false`：聚合工具选择与参数正确率均为61.68%、Provider 错误率7.22%。此后已完成工具续传和真实模型路径修复，P10 Emulator 60次达到90%以上，但发布门禁要求在物理 ARM64 上重新采样，不能沿用旧失败证据或以 Emulator 替代。
- M10-F05 仍无五名非开发参与者原始记录。连续第三轮确认不存在可在当前环境继续完成的正式验收路径；P10 保持 56/60（93.33%），P9 保持 69/72（95.83%）。
