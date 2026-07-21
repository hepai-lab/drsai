# OpenDrSai Android 远程工作区界面方案 V1

> 上位方案：[Android 远程工作区开发方案 V1](./ANDROID_REMOTE_WORKSPACE_DEVELOPMENT_PLAN_V1.md)  
> 文档状态：产品与交互讨论稿  
> 日期：2026-07-17

## 1. 设计目标

远程工作区界面延续当前 Android 的简洁聊天体验，通过左侧栏进入一个独立但视觉一致的远程工作区流程。用户能够从“计算机 → 工作区 → 会话”逐层定位远端任务，在会话中查看消息、运行过程、审批和审计摘要，并发送新指令。

设计需要同时满足：

- 不把 Relay、Runtime、Gateway、DDF、SSH 等内部实现词汇暴露成主要产品概念；
- 不把平台智能体、Android 本地对话和远程工作区会话混在同一历史列表；
- 不因页面切换改变权威 `runtime_id/workspace_id/session_id`；
- 不依赖 Android 永久后台连接；
- 不在 Android V1 提供首次安装 Runtime、直接 SSH 或 Workspace 写操作；
- OpenDrSai 与 Codex Backend 使用相同页面、消息和审批组件。

## 2. 产品术语

| 架构对象 | Android 展示名称 | 说明 |
| --- | --- | --- |
| Full Agent Runtime | 计算机 | 可以是个人电脑、服务器或平台托管计算节点 |
| Runtime online/offline | 在线 / 离线 / 连接异常 | 不展示 Relay 连接细节 |
| Workspace | 工作区 | 远端项目及其执行上下文 |
| Session | 会话 | 工作区中的长期交互上下文 |
| Run | 任务 / 本轮运行 | 一次确定的 Agent 执行 |
| Event | 运行动态 | 消息、工具、文件变化、审批和终态 |
| Approval | 需要确认 | 对一次敏感操作的用户决定 |
| Audit | 操作记录 | 身份、审批和工具执行的只读摘要 |
| Agent Backend | 执行引擎 | 仅在详情中显示 OpenDrSai/Codex |

“主机”容易让用户联想到 hostname、SSH 和网络配置，主界面统一使用“计算机”。诊断页可以显示 Runtime ID 后缀、版本和连接代次，但不把这些内容放在日常入口。

## 3. 信息架构

```text
现有聊天主界面
└─ 左侧栏
   └─ 远程工作区
      └─ 远程工作区首页
         ├─ 计算机 A（可展开）
         │  ├─ 工作区 A1
         │  └─ 工作区 A2
         └─ 计算机 B（可展开）
            └─ 工作区 B1

工作区
└─ 会话列表
   ├─ 会话 1
   ├─ 会话 2
   └─ 新建会话

会话
├─ 消息与运行动态
├─ 输入栏
├─ Inline Approval
└─ 更多
   ├─ 会话信息
   ├─ 操作记录
   ├─ 文件
   └─ Git 变更
```

正式导航路由建议为：

```text
chat
remoteHome
workspaceSessions/{runtimeId}/{workspaceId}
remoteSession/{runtimeId}/{workspaceId}/{sessionId}
workspaceFiles/{runtimeId}/{workspaceId}
workspaceGit/{runtimeId}/{workspaceId}
runAudit/{runtimeId}/{workspaceId}/{sessionId}/{runId}
```

`runtimeId/workspaceId/sessionId` 必须由前一页面的权威对象传入并在 Repository 再校验。标题、路径和显示名称不能代替 ID 路由。

## 4. 左侧栏

当前侧栏顶部是品牌与“新对话”，中部混合智能体和本机会话，底部是账户。V1 调整为三个清晰区域：

```text
OpenDrSai
[ 新对话 ]

主要功能
  对话
  远程工作区                  [待确认数量]

智能体
  OpenDrSai
  平台智能体…

本机会话
  最近会话…

账户
```

“远程工作区”是一个产品入口，不是某个 Agent，也不放在“本机会话”标题下。右侧 badge 只展示需要用户处理的待审批数量；在线计算机数量不作为高优先级提醒。

点击后：

1. 关闭 Drawer；
2. 导航到 `remoteHome`；
3. 保留当前本地聊天状态，不停止正在远端执行的 Run；
4. 如果已有未决 Approval，远程首页优先显示提醒；
5. 系统返回键或顶部返回键回到进入远程工作区前的页面。

## 5. 通用页面框架

远程工作区复用当前悬浮视觉语言，但不能继续把所有页面塞进现有 `ChatScreen`。应抽取：

```text
OpenDrSaiPageScaffold
├─ FloatingPageHeader
├─ PageContent
├─ Optional Error/Connection Banner
├─ Optional Floating Composer
└─ Optional Bottom Sheet
```

### 5.1 标题栏

远程页面使用三槽、真正居中的悬浮标题栏：

```text
[返回]              标题              [更多]
```

- 左右操作区固定相同宽度，标题使用独立居中层，不能因右侧按钮有无而偏移；
- 标题最多一行，超长省略，完整名称在页面详情中显示；
- 背景沿用当前白色 60% 半透明 Surface；
- 只有按钮和标题各自拥有小型 Surface，不使用覆盖整行的大背景框；
- 列表滚动时标题栏保持悬浮，内容从其下方滚过；
- 返回键与系统返回行为完全一致。

页面标题：

| 页面 | 标题 | 右侧操作 |
| --- | --- | --- |
| 远程首页 | 远程工作区 | 更多 |
| 工作区会话 | Workspace display_name | 新建会话或更多 |
| 远程会话 | Session title | 更多 |
| 文件 | 文件 | 搜索/更多 |
| Git | 变更 | 刷新/更多 |
| 操作记录 | 操作记录 | 筛选/更多 |

### 5.2 返回行为

```text
remoteSession → workspaceSessions
workspaceFiles/Git/Audit → 发起该页面的 Session 或 Workspace 页面
workspaceSessions → remoteHome
remoteHome → 进入远程工作区前的 Chat 页面
```

返回时保留上一页滚动位置、展开的计算机、搜索条件和已加载分页，不因 Compose 重组重新请求全部内容。

## 6. 远程工作区首页

### 6.1 页面结构

```text
悬浮标题栏

待处理提醒（仅有待审批时显示）

最近使用
  Workspace 快捷卡片

全部计算机
  ComputerCard
    在线状态 / 最近在线 / 版本异常
    展开后的 WorkspaceRow
  ComputerCard
    ...

底部安全间距
```

计算机卡片字段：

- 用户设置的显示名称；
- 在线、离线、连接异常、版本不兼容等状态；
- 最近在线时间；
- 工作区数量；
- 展开/收起按钮；
- 必要时显示“需要重新登录”“需要在电脑端更新”等可操作提示。

不在卡片上显示：

- hostname、IP 和 SSH 端口；
- Relay URL；
- 完整 Runtime Token、registration ID；
- canonical path 全文；
- Codex Thread/Turn ID。

Workspace 行字段：

- `display_name`；
- 可选的安全短路径摘要；
- 最后会话时间；
- 当前运行/待审批 badge；
- capability 异常，例如“只读不可用”或“执行引擎需要登录”。

点击 Workspace 行直接进入会话列表，不再强制进入单独的“计算机详情 → 工作区详情”页面，以减少导航层级。计算机详情通过卡片更多菜单或管理页打开。

### 6.2 页面状态

- **首次加载**：显示骨架屏，不显示“没有连接”；
- **空状态**：解释“还没有关联的计算机”，提供明显的“扫码关联已有计算机”按钮；
- **部分加载失败**：保留缓存卡片并标记“上次同步”，顶部提供重试；
- **全部离线**：允许查看缓存的 Workspace 和 Session，但发送、审批和刷新权威内容禁用；
- **权限被移除**：从可访问列表移除，缓存进入待清理状态，不继续展示敏感内容；
- **版本不兼容**：卡片禁用进入，提示在电脑端更新 OpenDrSai Runtime。

## 7. 扫码关联

### 7.1 正确语义

右上角更多菜单可以包含“扫码关联”，但产品文案必须是：

```text
扫码关联已有计算机
```

二维码不能用于 Android 首次安装、注册或维修 Runtime。Runtime 必须已经通过 Desktop、Web 管理端或 CLI 注册到 Relay。

二维码承载的是一次性 Access Grant Code，而不是连接配置：

```text
https://<trusted-hai-host>/opendrsai/associate?code=<opaque-one-time-code>
```

二维码中不得包含：

- SSH 私钥或密码；
- Runtime Token；
- OIDC Token；
- IP、端口或内网 URL；
- canonical Workspace path；
- 长期可复用授权。

### 7.2 交互流程

```text
更多
→ 扫码关联已有计算机
→ 首次使用时请求相机权限
→ 扫描一次性二维码
→ Android 校验 scheme/issuer/environment
→ 使用当前 OIDC 身份向 Relay 兑换预览
→ 显示确认页
   ├─ 计算机名称
   ├─ 所属用户/组织
   ├─ 授予的 Workspace 范围
   ├─ 权限摘要
   └─ 有效期
→ 用户确认关联
→ Relay 单次消费 code
→ 刷新远程首页并高亮新增计算机
```

扫码后不能直接进入工作区或自动批准长期权限。确认页必须允许取消。二维码过期、已使用、环境不一致、账户不匹配和权限不足均返回不同提示。

### 7.3 更多菜单

远程首页右侧更多菜单建议为：

- 扫码关联已有计算机；
- 刷新；
- 管理已关联计算机；
- 帮助与安全说明。

“扫码关联”虽然可出现在更多菜单，但空状态必须同时提供可见的主按钮，否则新用户难以发现核心入口。

## 8. 工作区会话列表

### 8.1 页面内容

```text
悬浮标题栏：返回 / Workspace 名称 / 新建会话

WorkspaceStatusCard
  计算机名称
  在线状态
  执行引擎状态
  当前分支 / 变更数量（有 Git 能力时）

搜索和筛选

会话列表
  SessionRow
```

SessionRow 展示：

- 会话标题；
- 执行引擎 OpenDrSai/Codex；
- 最后一条安全摘要；
- 最后更新时间；
- 最后 Run 状态；
- running、waiting approval、failed badge。

新建会话时先选择精确 Agent Definition；如果 Workspace 只有一个默认 Agent，可以直接创建并在会话详情中展示所选执行引擎。请求超时不能产生第二个 Session。

### 8.2 快捷入口

Workspace Status 卡片提供只读快捷入口：

- 文件；
- Git 变更；
- 当前运行；
- 待确认。

快捷入口只在 Runtime 声明对应 capability 时显示。

## 9. 远程会话页

远程会话复用现有消息列表和底部 Composer 的视觉形式，但数据源从本地 `Conversation/ChatMessage` 分离为 Runtime Session/Run/Event 投影。

### 9.1 内容层级

```text
悬浮标题栏

连接状态提示（仅异常时）

消息时间线
  User Message
  Agent Message
  Tool/Progress Card（可折叠）
  Workspace Change Card（只读）
  Approval Card（需要操作时展开）
  Artifact Card
  Run Terminal Card

悬浮输入栏
```

主时间线以对话为主。工具输出、文件变化和详细 Audit 默认折叠，避免远程工作区看起来像终端日志。

### 9.2 输入栏

- 复用当前浮动 Composer、输入法 `adjustResize/imePadding` 和消息同步上移行为；
- 正在 Run 时发送按钮切换为停止按钮，或按 Runtime capability 支持 queue/follow-up；
- 离线时保留草稿但禁用发送，不建立离线 Run 队列；
- 附件入口仅在 Remote Runtime 声明兼容附件能力时显示；
- 输入框 placeholder 显示“向当前工作区发送指令”，不显示内部 Runtime 名称；
- 发送请求包含稳定 Idempotency-Key。

### 9.3 Approval

Approval 必须内联显示在产生它的 Run 附近：

```text
需要确认
Codex 请求修改 3 个文件
Workspace: OpenDrSai
风险: 文件写入
[查看详情] [拒绝] [允许]
```

详情页显示命令、目标相对路径、权限范围、过期时间和 correlation ID。重复点击、另一设备已经处理、Approval 过期时，卡片转换为权威最终状态。

### 9.4 Audit

不建议把完整 Audit 直接插入聊天正文。推荐两层展示：

1. 时间线中的安全摘要：谁请求了什么、用户如何决定、执行结果；
2. 右上角更多 →“操作记录”：按 Run/operation 筛选的完整只读列表。

Audit 页面不得显示 Token、环境变量密文、内部路径、Codex 原始 Server Request ID 或未脱敏命令参数。

## 10. 不合理点与调整结论

### 10.1 “扫码添加连接”语义过重

问题：如果二维码负责注册 Runtime、配置网络或安装服务，Android 就实际承担了运维和 SSH Manager 职责。

调整：二维码只关联“已经注册的计算机”，兑换一次性访问授权。首次注册仍由 Desktop/Web/CLI 完成。

### 10.2 “主机 → 工作区 → 会话”层级偏深

问题：为每个对象设置独立中间页，需要四到五次点击才能进入最近会话。

调整：远程首页的计算机卡片直接展开 Workspace；点击 Workspace 进入会话列表。计算机详情不是必经页面，并增加“最近使用 Workspace”快捷入口。

### 10.3 更多菜单不适合作为唯一新增入口

问题：空页面中把核心动作藏进三点菜单，可发现性差。

调整：保留右上角更多菜单，同时在空状态展示“扫码关联已有计算机”主按钮。

### 10.4 Relay 列表不能冒充权威 Workspace Registry

问题：Relay 缓存可能过期。如果 Android 把 Relay 目录直接作为 Workspace 权威，就违反 Runtime 权威原则。

调整：Relay 负责发现和路由；在线时 Workspace/Session 来自 Full Runtime。离线缓存必须显示“上次同步”，并禁用控制操作。

### 10.5 不能继续扩展单一 ChatScreen/AppState

问题：当前 `AppDestination` 只有 Splash/Login/Chat，`AppViewModel` 同时管理认证、Agent、会话、附件和流式状态。继续加入计算机、Workspace、Session、Files、Git、Approval 会导致状态串线和难以测试。

调整：复用视觉组件，拆分导航、Repository 和页面 ViewModel；不要复制或继续膨胀现有 ChatScreen。

### 10.6 Audit 不应与聊天正文同权重

问题：把所有工具和审计事件平铺在对话中会破坏简洁性。

调整：消息优先，工具/变化默认折叠，Approval 内联，完整 Audit 放独立只读页面。

## 11. Android 实现结构

建议新增目录：

```text
ai.drsai.remote
├─ navigation/
│  ├─ AppRoute.kt
│  └─ OpenDrSaiNavHost.kt
├─ remote/
│  ├─ data/
│  │  ├─ RelayApi.kt
│  │  ├─ RelayRuntimeConnection.kt
│  │  ├─ RemoteWorkspaceRepository.kt
│  │  ├─ RemoteSessionRepository.kt
│  │  └─ RemoteAuditRepository.kt
│  ├─ model/
│  │  ├─ RemoteRuntime.kt
│  │  ├─ RemoteWorkspace.kt
│  │  ├─ RemoteSession.kt
│  │  ├─ RemoteRun.kt
│  │  ├─ RemoteEvent.kt
│  │  └─ RemoteApproval.kt
│  ├─ ui/
│  │  ├─ RemoteHomeScreen.kt
│  │  ├─ WorkspaceSessionsScreen.kt
│  │  ├─ RemoteSessionScreen.kt
│  │  ├─ WorkspaceFilesScreen.kt
│  │  ├─ WorkspaceGitScreen.kt
│  │  ├─ RunAuditScreen.kt
│  │  └─ AssociateRuntimeScreen.kt
│  └─ viewmodel/
│     ├─ RemoteHomeViewModel.kt
│     ├─ WorkspaceSessionsViewModel.kt
│     ├─ RemoteSessionViewModel.kt
│     └─ WorkspaceResourceViewModel.kt
└─ ui/components/
   ├─ OpenDrSaiPageScaffold.kt
   ├─ FloatingPageHeader.kt
   ├─ RuntimeCard.kt
   ├─ WorkspaceRow.kt
   ├─ SessionRow.kt
   ├─ ApprovalCard.kt
   └─ ConnectionBanner.kt
```

当前 AppViewModel 可以继续服务本地聊天，远程页面通过独立 ViewModel 和 Repository 工作。跨页面共享当前账户、TokenCoordinator 和 Room Database，但不共享可变的“当前 Workspace/Session”全局字段。

## 12. 状态模型

```text
RemoteHomeUiState
├─ runtimes
├─ recentWorkspaces
├─ pendingApprovalCount
├─ expandedRuntimeIds
├─ loading/refreshing
└─ stale/error

WorkspaceSessionsUiState
├─ runtimeRef
├─ workspace
├─ sessions
├─ agentDefinitions
├─ search/pageCursor
└─ loading/stale/error

RemoteSessionUiState
├─ runtime/workspace/session refs
├─ timelineItems
├─ activeRun
├─ pendingApprovals
├─ lastSequence
├─ composerDraft
└─ connectionState/error
```

页面 state 只保存 UI 所需投影；权威对象来自 Repository/Runtime。每个加载和控制请求必须显式携带 runtime_id、workspace_id 和必要的 session_id/run_id。

## 13. 分阶段实现

### UI-P0：导航和视觉壳

- 抽取 `OpenDrSaiPageScaffold` 与 `FloatingPageHeader`；
- 引入类型安全路由；
- 在 Drawer 增加远程工作区入口；
- 使用 Fake Repository 完成页面切换、返回和状态恢复。

### UI-P1：远程首页和关联

- 实现 Runtime/Workspace 卡片、最近使用、空/错/离线状态；
- 实现更多菜单和扫码确认流程；
- 只兑换已注册 Runtime 的 Access Grant Code。

### UI-P2：Workspace 与 Session

- 实现 Workspace 状态、Session 列表、搜索、分页和新建；
- 完成多 Runtime/Workspace 导航身份隔离。

### UI-P3：远程会话

- 接入 Run/Event、统一消息投影、Composer、Stop 和恢复；
- 实现工具、Workspace Change、Approval、Artifact 卡片。

### UI-P4：Files、Git 和 Audit

- 实现只读文件树/预览/搜索、Git status/diff 和 Audit 页面；
- 大文件、Diff 和 Event 使用分页、分块和截断。

### UI-P5：可靠性与模拟器矩阵

- 使用独立模拟器/受控客户端实例覆盖前后台、进程重建、网络切换、多客户端审批和长 Run；不设真机门禁；
- 完成 TalkBack、动态字体、横屏、深色模式和小屏适配。

## 14. UI 测试验收

### Compose/仪器测试

- Drawer 中“远程工作区”独立于智能体和本机会话；
- remoteHome 返回后原本聊天状态仍存在；
- 计算机展开/收起和最近 Workspace 快捷入口；
- 空状态有可见扫码按钮，更多菜单也有扫码入口；
- QR 过期、已消费、错误环境和权限不足；
- Workspace/Session 分页、搜索、刷新和错误保留；
- 相同路径的两个 Runtime 在标题和数据上不串线；
- 远程会话输入法弹出后 Composer 和历史同步上移；
- 离线状态禁用发送/审批但保留草稿和缓存历史；
- Approval 同意、拒绝、重复处理、过期和另一设备已处理；
- 进程重建后恢复路由、滚动位置、草稿和 last_sequence；
- Files/Git/Audit 只读页面不存在写操作控件。

### 截图与可访问性门禁

- Android 10/11、Android 13+；
- 360dp 小屏、常规手机、横屏和大屏；
- 字体缩放 1.0、1.3、1.5；
- 明亮/深色模式；
- TalkBack contentDescription、焦点顺序和可点击区域至少 48dp；
- 长计算机名、Workspace 名和 Session 标题不挤压返回/更多按钮；
- running、waiting approval、offline 和 incompatible 状态不只依赖颜色区分。

## 15. 需要后续确认但不阻塞原型的产品细节

1. “计算机”是否允许用户在 Android 重命名，还是只显示管理端名称；
2. 最近使用 Workspace 显示 3 个还是 5 个；
3. 新建 Session 时总是选择 Agent，还是有默认 Agent 时一步创建；
4. Approval 高风险操作是否要求设备生物识别二次确认；
5. 后续推送通知是否仅包含“任务完成/等待确认”而不包含消息正文。

原型阶段按以下默认值推进：计算机名称只读、最近 3 个、默认 Agent 一步创建、高风险 Approval 预留生物识别接口但 V1 不强制、推送不包含消息正文。
