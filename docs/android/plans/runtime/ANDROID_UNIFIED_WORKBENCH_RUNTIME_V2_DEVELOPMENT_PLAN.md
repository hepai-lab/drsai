# OpenDrSai Android 第 5 阶段：统一工作台与混合 Runtime V2 开发计划

> 版本：V1.0  
> 状态：规划完成，待开发  
> 统计：**12 个模块、96 个功能点**

## 1. 阶段定位

Android 既有开发已推进到第 4 阶段：原生 MVP、HAI 平台 Agent、附件闭环和远程工作区均已有实现；其中第 4 阶段按专项验收口径为 96/96 完成。

第 5 阶段不重写已有登录、聊天、附件或 Relay，而是在同一领域模型上完成两项升级：

1. 把 Windows 端成熟的左侧工作台体验适配到手机和平板，包括 Workspace/Session 树、搜索、结果、Agent/Skill 和会话管理。
2. 把当前简单的 Kotlin Lite Agent Runtime 升级为可恢复、可审计、可扩展的 Runtime V2，并与远程 Full Runtime 做能力协商和任务委派。

总体架构：

```text
Compose UI（聊天 + 自适应侧栏）
              |
统一 Workspace / Session / Run / Event / Approval 领域层
              |
       Runtime Coordinator
          /             \
Kotlin Lite Runtime V2   Relay RuntimeConnection
（Android 本地）          （Windows/远程 Full Runtime）
```

### 1.1 明确边界

- Android 本地负责：稳定聊天、上下文与记忆、附件、安全设备工具、短任务、离线查看和恢复。
- 远程 Full Runtime 负责：Shell、Git/Worktree、Codex、MCP、任意项目文件和长时后台任务。
- Android 不嵌入 Python Full Runtime，不开放任意 Shell、任意路径文件访问或无授权后台执行。
- 每个 Run 创建时绑定唯一执行 Runtime；运行中不得静默切换执行端。
- UI 只消费统一 Event 投影，不分别维护本地聊天和远程聊天两套状态机。

## 2. 统计与交付定义

| 模块 | 名称 | 功能点 |
|---|---|---:|
| M01 | 统一领域模型与架构边界 | 8 |
| M02 | 自适应 Android 左侧工作台 | 8 |
| M03 | Workspace 与 Session 树 | 8 |
| M04 | 导航、搜索与会话操作 | 8 |
| M05 | Kotlin Lite Runtime V2 核心 | 8 |
| M06 | 上下文、记忆、指令与摘要 | 8 |
| M07 | Tool Registry、Skill 与工具结果 | 8 |
| M08 | Permission、Approval、Audit 与安全策略 | 8 |
| M09 | Android 本地设备与文件能力 | 8 |
| M10 | 本地/远程能力协商与任务委派 | 8 |
| M11 | 后台、恢复、幂等、资源与错误治理 | 8 |
| M12 | 数据迁移、自动化与发布验收 | 8 |
| **合计** |  | **96** |

“完成”必须同时满足：实现代码合入、对应自动化测试通过、人工/模拟器验收达到表中标准、验收报告记录证据。只有页面或接口存在不计为完成。

## 3. 模块与逐项测试验收

### M01 统一领域模型与架构边界（8）

| ID | 功能点 | 测试与验收方法 |
|---|---|---|
| M01-F01 | 统一 `Workspace`，同时表达本地虚拟工作区和远程工作区 | Repository 单测分别载入 local/remote fixture；验收两类工作区使用同一列表和稳定 ID，重启后 ID 不变。 |
| M01-F02 | 统一 `Session`，替代 UI 对本地 Conversation 与远程 Session 的分支依赖 | 映射器单测覆盖新旧对象；验收同一聊天页可无条件打开两种 Session。 |
| M01-F03 | 建立 `Run` 聚合，包含状态、Runtime 归属、时间和失败原因 | 状态构造/序列化单测；验收数据库、详情页和恢复流程读取结果一致。 |
| M01-F04 | 统一 `Event` envelope、序号、游标、时间和 payload 版本 | Codec 与乱序/重复属性测试；验收重复事件不重复显示、断线按游标续传。 |
| M01-F05 | 统一 `Approval` 与 `AuditEntry` 领域对象 | JSON/Room round-trip 单测；验收批准、拒绝和过期均生成可追溯记录。 |
| M01-F06 | 为对象标记 Runtime authority 与 source，避免缓存成为权威状态 | Repository 冲突测试；验收远程新事件能覆盖投影，本地缓存不能反向伪造远程状态。 |
| M01-F07 | Room schema 与从既有会话/远程缓存到统一模型的迁移 | 导出旧库运行 MigrationTest；验收消息数、附件、Agent 绑定和会话标题零丢失。 |
| M01-F08 | 建立模块依赖守卫，UI 不直接依赖具体 Runtime 实现 | Gradle/静态架构测试扫描依赖；验收 UI 仅经 use case/repository/runtime port 调用。 |

### M02 自适应 Android 左侧工作台（8）

| ID | 功能点 | 测试与验收方法 |
|---|---|---|
| M02-F01 | 手机采用模态侧栏，保留悬浮标题栏和聊天可视面积 | API 30/35 手机尺寸 Compose 测试；验收按钮打开/关闭侧栏且聊天位置恢复。 |
| M02-F02 | 平板和宽屏采用可折叠常驻侧栏 | 600dp/840dp 截图测试；验收窗口缩放跨断点时选中会话不丢失。 |
| M02-F03 | 顶部展示新任务、当前范围及侧栏开关的准确状态 | Semantics 点击测试；验收新任务只创建一次，开关图标与侧栏状态同步。 |
| M02-F04 | 工作台分区可折叠并持久化展开状态 | ViewModel 与 SavedState 单测；验收进程重建后各分区展开状态恢复。 |
| M02-F05 | 长列表虚拟化、稳定 key 和滚动位置恢复 | 1000 Session 基准与 Compose 测试；验收滚动无明显卡顿，返回后位置误差不超过一项。 |
| M02-F06 | 沿用白色/半透明表面、深浅色和动态字体设计规范 | Golden screenshot 覆盖主题与 1.0/1.5/2.0 字号；验收无截断、遮挡和灰色整块背景回归。 |
| M02-F07 | Back、预测返回、scrim 点击和 IME 与侧栏协同 | Instrumentation 手势测试；验收优先关闭键盘/侧栏，不误退出当前会话。 |
| M02-F08 | TalkBack、触控尺寸、焦点顺序和横竖屏无障碍 | Accessibility Scanner 与语义断言；验收按钮均有名称、触控区至少 48dp、焦点顺序合理。 |

### M03 Workspace 与 Session 树（8）

| ID | 功能点 | 测试与验收方法 |
|---|---|---|
| M03-F01 | 提供本地虚拟 Workspace，承载 Android 本地会话 | Repository 单测；验收离线启动仍能进入本地工作区并创建会话。 |
| M03-F02 | 按 Runtime 分组展示远程 Workspace | 双 Runtime fixture UI 测试；验收同名 Workspace 不串组且状态标识正确。 |
| M03-F03 | Workspace 下分页/懒加载 Session，支持嵌套来源展示 | Paging 单测和滚动测试；验收翻页无重复、无漏项、父子层级正确。 |
| M03-F04 | 当前 Workspace/Session 选中态与聊天页双向同步 | Navigation 集成测试；验收侧栏点击、通知深链和聊天切换均高亮同一项。 |
| M03-F05 | 每个 Workspace 支持在正确 Runtime 新建 Session | Fake Runtime 调用断言；验收新会话 runtimeId/workspaceId 正确且只创建一次。 |
| M03-F06 | 支持置顶优先、最近活动排序和稳定次序 | 排序属性测试；验收相同时间戳结果稳定，刷新不跳动。 |
| M03-F07 | 展示连接、离线、运行中、待审批、未读和 stale 状态 | Event projection 单测；验收注入每种事件后徽标及时出现并能被清除。 |
| M03-F08 | Workspace 详情和受控操作，危险动作不在 Android 静默执行 | 权限矩阵 UI 测试；验收无能力时隐藏/禁用，危险动作必须转远程审批。 |

### M04 导航、搜索与会话操作（8）

| ID | 功能点 | 测试与验收方法 |
|---|---|---|
| M04-F01 | 新任务入口支持选择本地或远程 Workspace | Navigation/ViewModel 单测；验收默认值可解释且不会跨 Workspace 建错会话。 |
| M04-F02 | 定时任务入口按 Runtime capability 显示并只读/跳转 | Capability UI 测试；验收不支持时不伪造功能，支持时打开正确远程页面。 |
| M04-F03 | 结果入口聚合 Artifact、导出物和已完成后台任务 | Repository 聚合测试；验收按 Session/Run 可定位并可重新打开。 |
| M04-F04 | Agent 与 Skill 入口统一展示本地及远程来源和能力 | 双来源 fixture 测试；验收来源、版本、可用状态和权限信息准确。 |
| M04-F05 | 全局搜索 Workspace、Session 标题和已落库消息 | FTS 单测覆盖中文、英文、空白和特殊字符；验收结果可定位原消息且账户隔离。 |
| M04-F06 | 会话重命名、置顶、归档、恢复和未读管理 | Repository/UI 测试覆盖成功、冲突、离线；验收刷新/重启后状态一致。 |
| M04-F07 | 底部账户、设置、Runtime 状态和退出入口 | Compose 导航测试；验收退出清除敏感凭据并回到 OIDC 登录页。 |
| M04-F08 | 深链与返回栈支持通知直达 Session/Run/Approval/Artifact | Deep-link instrumentation；验收冷启动和热启动均直达目标，返回到合理父级。 |

### M05 Kotlin Lite Runtime V2 核心（8）

| ID | 功能点 | 测试与验收方法 |
|---|---|---|
| M05-F01 | 定义 Runtime port 和 `RuntimeCoordinator`，替换 UI 直连旧 LocalAgentRuntime | Fake local/remote 单测；验收切换实现无需改 Compose 页面。 |
| M05-F02 | 持久化 `queued/running/waiting_approval/paused/completed/failed/cancelled` 状态机 | Reducer 全转移表测试；验收非法转移被拒绝并记录诊断。 |
| M05-F03 | 本地 Run 产生带序号的统一流式 Event | 顺序、重复、缺口测试；验收流式文本、工具和终态可从事件完全重建。 |
| M05-F04 | 支持多轮模型/工具循环并配置轮次、调用数和预算上限 | Fake model/tool 边界测试；验收达到每种上限时安全终止并给出明确原因。 |
| M05-F05 | 支持停止、暂停和恢复，取消信号传播到网络及工具 | Coroutine cancellation 测试；验收 1 秒内停止可取消调用且不再追加文本。 |
| M05-F06 | 在消息、工具调用和审批边界写入 checkpoint | Room 故障注入测试；验收杀进程后从最后完整边界恢复，不重复副作用。 |
| M05-F07 | 同 Session 单活跃 Run、发送幂等键和并发互斥 | 并发压力测试；验收快速双击发送只创建一个 Run/用户消息。 |
| M05-F08 | 冷启动扫描并恢复可恢复 Run，终结不可恢复 Run | Process-death instrumentation；验收恢复策略可预测且聊天无永久“思考中”。 |

### M06 上下文、记忆、指令与摘要（8）

| ID | 功能点 | 测试与验收方法 |
|---|---|---|
| M06-F01 | 按系统、Agent、Project、用户偏好、会话层组装提示词 | Golden prompt 单测；验收层级顺序固定且低优先级不能覆盖安全策略。 |
| M06-F02 | 使用模型元数据进行 token 预算和消息裁剪 | 多模型边界单测；验收请求不超模型窗口且保留当前问题和必要工具上下文。 |
| M06-F03 | 长会话生成可持久化摘要并保留来源范围 | Fake summarizer 单测；验收压缩后关键事实可回答，摘要可追溯到消息区间。 |
| M06-F04 | Session 记忆仅在当前会话生效 | 隔离单测；验收两个会话使用相同关键词时互不泄漏。 |
| M06-F05 | 用户长期记忆按 OIDC subject 隔离并支持查看/删除 | Room DAO 和登出测试；验收切换账户不可读取，删除后检索无结果。 |
| M06-F06 | Project instructions 可来自本地 SAF 或远程 Workspace 快照 | 两来源解析测试；验收版本变化时提示用户刷新，不静默混用旧指令。 |
| M06-F07 | 附件文本、图片描述和结果 Artifact 纳入受预算控制的上下文 | 附件 fixture 测试；验收失败附件不进入模型，超限内容以摘要/引用替代。 |
| M06-F08 | 提供敏感内容排除、记忆开关和调试视图脱敏 | 隐私策略单测；验收关闭记忆后不写库，Token/密钥不出现在日志与导出中。 |

### M07 Tool Registry、Skill 与工具结果（8）

| ID | 功能点 | 测试与验收方法 |
|---|---|---|
| M07-F01 | 建立带 ID、版本、schema、风险和 capability 的 Tool Registry | Registry 重复/版本单测；验收冲突工具拒绝注册并报告原因。 |
| M07-F02 | 调用前校验 JSON Schema、大小和必填参数 | 合法/非法参数表驱动测试；验收非法调用不进入工具实现。 |
| M07-F03 | 工具执行产生 started/progress/result/error 统一事件 | Fake tool 集成测试；验收聊天只显示一个执行状态且终态唯一。 |
| M07-F04 | Skill 定义支持内置、平台和远程只读来源 | Parser/来源隔离测试；验收 UI 明确来源且 Android 不执行不受支持脚本。 |
| M07-F05 | Skill/Tool 版本固定和变更刷新 | 版本升级单测；验收进行中的 Run 保持原版本，新 Run 使用新版本。 |
| M07-F06 | 按 Runtime、Agent、权限和网络状态过滤可用工具 | 能力矩阵测试；验收模型看不到不可执行工具。 |
| M07-F07 | 大工具输出截断、持久化为 Artifact 并保留摘要 | 大输出压力测试；验收 UI/上下文不爆内存，完整结果可从 Artifact 打开。 |
| M07-F08 | 将现有时间、记忆和附件工具迁移到 Registry，行为兼容 | 回归 golden 测试；验收旧会话重试结果与迁移前语义一致。 |

### M08 Permission、Approval、Audit 与安全策略（8）

| ID | 功能点 | 测试与验收方法 |
|---|---|---|
| M08-F01 | 工具按只读、写入、外发、敏感和禁止等级分类 | Policy 表驱动单测；验收未分类工具默认拒绝。 |
| M08-F02 | 高风险工具进入持久化 Approval 等待态 | Runtime 集成测试；验收审批前工具零副作用，进程重启仍可处理。 |
| M08-F03 | Approval 精确绑定 runId/toolCallId/参数摘要/作用域 | 篡改与重放安全测试；验收任何字段不匹配均拒绝执行。 |
| M08-F04 | 支持允许一次、会话内允许、拒绝和取消 | 决策矩阵测试；验收授权范围不扩散到其他 Session 或工具。 |
| M08-F05 | 审批过期、幂等和多设备竞争采用首个有效决定 | 并发/虚拟时钟测试；验收晚到决定不触发第二次执行。 |
| M08-F06 | 决策、执行、失败和操作者写入只追加 Audit | DAO 防更新测试；验收普通代码路径无法修改既有审计项。 |
| M08-F07 | 日志、事件、审批参数和导出统一脱敏 | Secret corpus 扫描测试；验收 Token、Cookie、密钥和已标记字段无明文。 |
| M08-F08 | 聊天审批卡片与集中待审批列表保持一致 | Compose + repository 集成测试；验收任一入口处理后另一入口即时终态化。 |

### M09 Android 本地设备与文件能力（8）

| ID | 功能点 | 测试与验收方法 |
|---|---|---|
| M09-F01 | 提供时间、时区、语言、网络类型等安全设备信息工具 | Robolectric 单测；验收不返回硬件标识符或未经授权位置。 |
| M09-F02 | 通过 SAF 授权目录进行列出、读取和搜索 | Fake ContentResolver + 模拟器测试；验收仅能访问持久授权 URI。 |
| M09-F03 | SAF 写入使用显式审批、临时文件和原子提交 | 故障注入测试；验收取消/写入失败不破坏原文件。 |
| M09-F04 | 复用拍照、相册和文件选择作为工具输入 | ActivityResult instrumentation；验收权限拒绝、取消和成功均返回明确终态。 |
| M09-F05 | Artifact 支持系统分享、保存和受校验打开 | MIME/URI 测试；验收 FileProvider 无路径泄露且外部应用只能读授权文件。 |
| M09-F06 | 本地 Run 通过通知展示进度并可停止 | API 30/35 通知测试；验收通知操作命中正确 Run，权限拒绝不导致崩溃。 |
| M09-F07 | 剪贴板读取需用户动作，写入需提示并执行脱敏 | Instrumentation 与策略测试；验收后台不静默读取剪贴板。 |
| M09-F08 | 对 Shell、任意路径、浏览器自动化和隐式外发保持硬边界 | 静态扫描 + 恶意工具 fixture；验收本地 Registry 无此能力且请求只能显式委派远程。 |

### M10 本地/远程能力协商与任务委派（8）

| ID | 功能点 | 测试与验收方法 |
|---|---|---|
| M10-F01 | Runtime 发布版本化 CapabilitySet、限制和在线状态 | 契约/兼容测试；验收未知字段可忽略、必需能力缺失可解释。 |
| M10-F02 | 用确定性规则从工具、Workspace 和任务需求推导所需能力 | 规则表单测；验收相同输入永远得到相同路由建议。 |
| M10-F03 | 新任务允许显式本地/远程选择，并在必要时给出自动建议 | UI 矩阵测试；验收建议可被用户覆盖且显示原因。 |
| M10-F04 | Run 创建后固定 runtimeId 和 authority | Repository 不变量测试；验收掉线后进入等待/失败，不静默切到本地。 |
| M10-F05 | 远程 Workspace/Session 使用本地非权威缓存支持离线查看 | Offline 集成测试；验收离线不可写操作被禁用，恢复联网后按游标同步。 |
| M10-F06 | 不可用能力返回结构化 `capability_required` 和可行动入口 | 错误映射测试；验收用户可连接 Runtime 或改用支持范围内方案。 |
| M10-F07 | 本地任务可创建经用户确认的 handoff package 委派到远程 | 序列化/脱敏/E2E 测试；验收上下文、附件引用、指令可追踪且不含未授权数据。 |
| M10-F08 | 本地和远程事件经同一 reducer 呈现聊天、工具、审批和结果 | 双后端 golden event 测试；验收相同事件语义得到相同 UI，无两套“思考中”。 |

### M11 后台、恢复、幂等、资源与错误治理（8）

| ID | 功能点 | 测试与验收方法 |
|---|---|---|
| M11-F01 | 可延迟/可恢复任务通过 WorkManager 调度并带唯一工作键 | WorkManager TestDriver；验收重启/重复入队只执行一次。 |
| M11-F02 | 用户可见长任务使用合规前台服务和可取消通知 | API 30/35 instrumentation；验收启动时限、通知渠道和停止动作符合系统限制。 |
| M11-F03 | 网络切换、断线重连和 Event cursor 续传 | 网络故障代理测试；验收 Wi-Fi/蜂窝切换不重复消息，恢复后补齐事件。 |
| M11-F04 | 根据电量、温度、内存和后台限制降级本地执行 | Fake constraints 单测；验收受限时暂停/委派/提示，不强行常驻。 |
| M11-F05 | 消息、事件、工具输出、附件缓存和日志均有硬上限与淘汰策略 | 边界/压力测试；验收达到上限仍可创建新会话且无 OOM。 |
| M11-F06 | 网络、模型和工具调用使用分类重试、指数退避和幂等键 | 虚拟时钟单测；验收不可重试错误立即终止，可重试错误不产生重复副作用。 |
| M11-F07 | Token 和敏感数据加密存储，备份策略排除凭据 | Keystore/backup rules 测试；验收备份包与数据库导出中无可用凭据。 |
| M11-F08 | 统一可理解错误、诊断包和恢复操作，诊断默认脱敏 | 错误目录覆盖测试；验收每个终态错误均有用户动作和可关联 request/run ID。 |

### M12 数据迁移、自动化与发布验收（8）

| ID | 功能点 | 测试与验收方法 |
|---|---|---|
| M12-F01 | 从当前生产 APK 原位升级并迁移会话、附件、登录和远程缓存 | 旧 APK→候选 APK 模拟器升级；验收数据计数/抽样哈希一致且能继续对话。 |
| M12-F02 | 建立领域、状态机、策略、Registry、路由和 Repository JVM 测试套件 | CI 执行 testDebugUnitTest；验收新增核心类有对应测试且全绿。 |
| M12-F03 | API 30/API 35 的手机、平板、横竖屏 Compose/Instrumentation 套件 | 托管模拟器矩阵；验收导航、IME、侧栏、审批和通知用例全绿并留截图。 |
| M12-F04 | 本地 Lite Runtime V2 端到端覆盖聊天→工具→审批→恢复→结果 | 确定性 Fake 模型 + 模拟器 E2E；验收事件序列、Room 数据和 UI 终态一致。 |
| M12-F05 | 远程 Full Runtime 端到端覆盖 Workspace→Run→Approval→Artifact | 使用本仓库 Windows Runtime 测试夹具；验收断线恢复、审批和结果链闭环，Codex 后端可按发布门禁选择执行。 |
| M12-F06 | 验证数据库升级失败保护、重新启动恢复和不可逆迁移门禁 | 破损/旧 schema 测试；验收不清库、不静默降级，失败提供安全恢复说明。 |
| M12-F07 | Release APK 执行 R8、Lint、依赖/密钥扫描、启动/内存基准和签名校验 | CI 产物扫描与 Macrobenchmark；验收零阻断问题，阈值写入报告并与基线对比。 |
| M12-F08 | 生成版本说明、功能矩阵、测试报告、APK/SHA-256 和自动更新清单 | 发布脚本 dry-run + 安装验收；验收版本号/文件名/签名/哈希/下载地址完全一致。 |

## 4. 实施顺序与里程碑

| 里程碑 | 范围 | 退出条件 |
|---|---|---|
| S5-P0 契约冻结 | M01、M10 契约草案 | 统一模型、Event、Capability 和 authority 规则通过评审 |
| S5-P1 数据与侧栏骨架 | M01、M02、M03、M04 | 旧数据迁移通过，手机/平板侧栏可完整导航 |
| S5-P2 Runtime 核心 | M05、M11 的状态与恢复部分 | 本地 Run 可持久化、停止、崩溃恢复且无重复副作用 |
| S5-P3 上下文与工具安全 | M06、M07、M08、M09 | 工具注册、审批、审计、记忆和 SAF 闭环通过安全矩阵 |
| S5-P4 混合执行 | M10、M11 | 本地/远程显式路由、离线缓存和 handoff 闭环通过 |
| S5-P5 发布验收 | M12 与全部回归 | 96/96 有实现、自动化结果和验收证据，Release APK 可安装更新 |

依赖关系不是简单按模块号串行：M01/M10 的契约必须先冻结；UI 与 Runtime 可并行；M12 的测试骨架从 P0 开始建设，而不是最后补测试。

## 5. 总体发布门禁

- **功能门禁**：96 个功能点全部有代码、测试和证据，不接受“接口预留”计为完成。
- **兼容门禁**：OIDC 登录、HAI Agent、附件、自动更新和第 4 阶段远程工作区全量回归通过。
- **数据门禁**：从当前生产版本覆盖安装后，会话、附件、Agent 绑定、账号隔离和远程缓存无丢失。
- **安全门禁**：Android 本地无 Shell/任意路径能力；审批绑定不可绕过；凭据不进入日志、备份、Audit 明文或 handoff。
- **可靠性门禁**：进程终止、网络切换、重复点击、重复事件和低资源场景均不产生重复副作用或永久运行态。
- **体验门禁**：手机/平板、横竖屏、IME、大字体和 TalkBack 均通过；侧栏不会遮断聊天关键内容。
- **发布门禁**：Release APK 使用既有测试签名/正式签名策略，文件名遵循 `OpenDrSai-Android-v{version}.apk`，自动更新清单与 GitHub 资产一致。

## 6. 验收证据目录约定

实施时在 `docs/android/testing/acceptance/stage5/` 维护以下证据：

- `feature-matrix.md`：96 项状态、提交和测试用例映射。
- `unit-test-results/`：JVM、Room migration、contract 和 policy 报告。
- `emulator-results/`：API 30/API 35 手机和平板日志、截图和视频。
- `e2e-results/`：Local Runtime、OpenDrSai Full Runtime 及按门禁启用的 Codex E2E。
- `security-release/`：R8/Lint/扫描、签名、SHA-256、更新清单和安装结果。

专项进度只能从“未开始 → 开发中 → 自动化通过 → 验收通过”推进；任何回归失败应将受影响功能点退回“开发中”。
