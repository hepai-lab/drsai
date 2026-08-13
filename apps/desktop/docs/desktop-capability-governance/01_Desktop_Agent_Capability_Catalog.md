# Desktop Agent 理想能力全集（Capability Catalog）

> 文档定位：Desktop Agent Capability Baseline + Project Capability Status Map  
> 状态：Baseline Draft / 可持续维护  
> 适用对象：以 Electron、Tauri、Qt 等桌面壳承载 Agent/LLM 能力的桌面客户端  
> 范围原则：仅描述 **Desktop 负责或必须对用户负责的能力**；Agent Runtime 内部算法与业务语义不纳入本目录。

> **Current implementation baseline**
> - Last full audit: 2026-08-13
> - Audited commit: `2069d9d4c50ad3c01515de479a6a3b3d93ef54c4`
> - Audit mode: Full baseline
> - Audit scope: `apps/desktop/` Windows Electron mainline + `shared/`
> - Working-tree state at audit: **commit + uncommitted refinements** to grounded-answering / attachment-coverage / citation-projection pipeline (`shared/main/chat.ts`, `shared/main/threadRuntimeProjection.ts`, `shared/renderer/src/adapters/useDesktopChatAdapter.ts`, `shared/api/citations.ts`). Reviewed; no Catalog state change — all touched features were already ≥🟨 before these edits.
> - Status totals: 🟩 313 · 🟨 118 · 🟥 73 · ➖ 3 · ⬜ 5 (total 512)
> - Next incremental audit baseline: `2069d9d4c50ad3c01515de479a6a3b3d93ef54c4`

---

## 0. 文档目的

本文件定义一个“理想 Desktop Agent”可能需要具备的候选能力全集，并在每个能力后维护当前项目的**粗粒度实现状态**，用于持续回答三个问题：

1. **理想情况下，桌面端可能需要哪些能力？**
2. **当前项目实际上已经实现了哪些能力，还缺哪些？**
3. **已经实现的能力，哪些已经被可靠验证？**

整个治理过程按三层展开：

```text
Ideal Capability Baseline
        ↓
Project Implementation Mapping
        ↓
Verification / Regression Status
```

本文件主要负责前两层中的粗粒度部分：**Ideal Capability Baseline + Project Capability Status**。

后续项目映射时，每个能力应进一步维护：

- 是否适用于当前项目；
- 优先级；
- 实现状态；
- 实现证据；
- 验证状态；
- 验证版本 / Commit；
- 测试证据。

---

## 1. 范围边界

### 1.1 纳入范围

本目录纳入：

- Desktop Application 生命周期；
- Electron/Tauri/Qt 等客户端 Shell；
- 用户界面与交互；
- Chat / Session 的桌面表现层；
- Agent 状态、Tool Call、Approval、Clarification 等桌面交互面；
- 文件、附件和生成物；
- Desktop ↔ Runtime / Backend 的客户端侧通信；
- 本地配置和持久化；
- OS 集成；
- 安装、升级、版本管理；
- 网络与离线状态；
- 日志、诊断与恢复；
- Desktop 侧安全与隐私控制；
- 企业/内网部署相关客户端能力。

### 1.2 不纳入范围

以下内容不属于本 Desktop Capability Catalog：

- Agent Loop；
- Planning / Reasoning；
- Prompt 构造；
- Context 选择策略；
- Memory 检索逻辑；
- RAG 检索质量；
- Tool 内部业务执行逻辑；
- MCP Server 内部实现；
- 模型推理质量；
- 模型路由策略；
- Agent Retry / Reflection 等 Runtime 内部策略；
- 后端数据库、服务端业务逻辑；
- “Agent 为什么做出某个决定”的语义正确性。

对于跨 Desktop / Runtime 的能力，只验证桌面端责任边界。例如：

```text
Runtime 发出 approval_request
        ↓
Desktop 正确展示审批 UI
        ↓
用户点击 Approve
        ↓
Desktop 正确发送审批响应
```

Desktop 不负责验证 Runtime **为什么**发起审批，也不负责 Tool 后续业务语义是否正确。

---

## 2. 能力条目定义原则

一个能力应单独成为 Feature，当且仅当它至少满足以下一项：

- 可以独立实现；
- 可以独立缺失；
- 可以独立关闭；
- 可以独立失败；
- 可以独立验证；
- 可以独立在版本中发生变化。

### 合理粒度示例

```text
DESK-SES-001 新建会话
DESK-SES-002 切换会话
DESK-SES-003 重命名会话
DESK-SES-004 删除会话
```

### 过粗示例

```text
会话管理
```

因为“新建已实现，但搜索未实现”时无法准确表达。

### 过细示例

```text
点击删除按钮后按钮变灰
```

这是测试步骤或 UI 细节，不应成为独立能力。

---

## 3. 功能状态标识

本文件只维护“当前项目是否具备该能力”的**粗粒度状态**，不在这里维护详细测试结果。

每个 Feature 前使用以下标识：

| 标识 | 状态 | 含义 |
|---|---|---|
| `⬜` | 未确认 | 尚未调查当前项目是否实现 |
| `🟩` | 已实现 | 已确认当前项目具备该能力 |
| `🟨` | 部分实现 | 已有实现，但功能链路不完整 |
| `🟥` | 未实现 | 已确认当前项目没有该能力 |
| `➖` | 不适用 | 已确认该能力不适用于当前项目 |

### 3.1 使用原则

- 初始状态统一为 `⬜ 未确认`。
- 只有在确认代码、界面或实际行为后，才更新为 `🟩 / 🟨 / 🟥 / ➖`。
- `🟩 已实现` **不等于** “已经测试通过”。
- 测试通过、失败、Stale、版本、Commit、证据等详细信息将在后续 Verification 文档中维护。
- 本文件的目标是快速形成当前项目的 **Capability Gap**。

粗粒度判断关系：

```text
理想能力全集
    ↓
当前项目状态
    ├── 🟩 已实现
    ├── 🟨 部分实现
    ├── 🟥 未实现
    ├── ➖ 不适用
    └── ⬜ 未确认
```

# 4. Desktop Agent 能力总地图

```text
Desktop Agent Capability Catalog
│
├── 01. 应用生命周期与首次使用
├── 02. 窗口、导航与 Desktop Shell
├── 03. 消息输入与用户操作
├── 04. 对话内容展示
├── 05. 会话与历史管理
├── 06. Agent 运行状态与人机交互
├── 07. 文件、附件与生成物
├── 08. Agent 资源管理界面
├── 09. 设置与个性化
├── 10. 身份、账户与 Workspace
├── 11. Desktop ↔ Runtime / Backend Bridge
├── 12. 本地状态、数据持久化与数据生命周期
├── 13. 通知与后台行为
├── 14. 网络连接与离线状态
├── 15. 操作系统集成
├── 16. 安装、升级与版本管理
├── 17. 日志、诊断与故障恢复
├── 18. 安全与隐私控制
└── 19. 企业 / 内网部署能力
```

---

# 5. 01 应用生命周期与首次使用

## 5.1 应用启动与退出

- 🟩 `DESK-APP-001` 正常启动应用
- 🟨 `DESK-APP-002` 启动加载状态 / Splash — 仅在主壳内渲染 sessionRestoring，无独立 Splash 窗口
- 🟩 `DESK-APP-003` 正常退出应用
- 🟨 `DESK-APP-004` 后台退出 — 有活动任务时隐藏窗口继续后台运行，无 Tray 承接
- 🟨 `DESK-APP-005` 强制退出后的状态处理 — 有 workflow/approval/temp file 恢复，无异常退出对话提示
- 🟩 `DESK-APP-006` 应用内重启
- 🟩 `DESK-APP-007` 单实例运行
- 🟩 `DESK-APP-008` 第二实例唤醒已有实例
- 🟥 `DESK-APP-009` 启动失败提示 — 未见 dialog.showErrorBox 或独立启动失败对话
- 🟨 `DESK-APP-010` 异常退出后重新启动 — 有 workflow/approval/临时文件恢复，无崩溃对话
- 🟩 `DESK-APP-011` 当前版本显示
- 🟥 `DESK-APP-012` 架构/构建信息显示（如 x64/arm64） — 未在 UI 展示 arch/build info

## 5.2 首次使用与初始化

- 🟩 `DESK-APP-013` 首次启动初始化
- 🟥 `DESK-APP-014` Welcome / Onboarding — 已明确废弃 FirstRunSetup
- 🟥 `DESK-APP-015` 初始配置向导 — 项目已明确不做配置向导
- 🟩 `DESK-APP-016` 必要服务可用性检查
- ➖ `DESK-APP-017` 必要系统权限申请 — Windows 上麦克风/截屏权限不由应用申请
- 🟨 `DESK-APP-018` 首次空状态页面 — 各模块局部空态存在，无统一首次空页
- 🟨 `DESK-APP-019` 首次使用引导 — 仅 Codex 首次向导，无通用引导
- 🟥 `DESK-APP-020` 新版本 Release Notes / What's New — releaseNotesUrl 恒为 null

---

# 6. 02 窗口、导航与 Desktop Shell

## 6.1 窗口管理

- 🟩 `DESK-WIN-001` 最小化窗口
- 🟩 `DESK-WIN-002` 最大化窗口
- 🟩 `DESK-WIN-003` 恢复窗口
- 🟩 `DESK-WIN-004` 关闭窗口
- 🟩 `DESK-WIN-005` 全屏模式
- 🟩 `DESK-WIN-006` 调整窗口尺寸
- 🟩 `DESK-WIN-007` 最小窗口尺寸限制
- 🟩 `DESK-WIN-008` 记忆窗口尺寸
- 🟩 `DESK-WIN-009` 记忆窗口位置
- 🟩 `DESK-WIN-010` 多显示器窗口恢复
- 🟥 `DESK-WIN-011` 多窗口支持 — 当前仅单 mainWindow
- 🟥 `DESK-WIN-012` 窗口置顶（可选） — 未使用 setAlwaysOnTop

## 6.2 页面导航

- 🟩 `DESK-NAV-001` 主导航
- 🟩 `DESK-NAV-002` 侧边栏
- 🟩 `DESK-NAV-003` 页面切换
- 🟩 `DESK-NAV-004` 返回
- 🟩 `DESK-NAV-005` 前进
- 🟨 `DESK-NAV-006` 页面刷新 — 仅在恢复场景使用 window.location.reload，无普通刷新入口
- 🟩 `DESK-NAV-007` 当前页面状态保持
- 🟩 `DESK-NAV-008` Deep Link 页面定位
- 🟨 `DESK-NAV-009` 无效路由 / 页面不存在处理 — 依赖三元回落，无显式 404 页
- 🟩 `DESK-NAV-010` 全局搜索入口
- 🟩 `DESK-NAV-011` Command Palette（可选）

## 6.3 Desktop Shell

- 🟩 `DESK-SHELL-001` 标题栏
- 🟩 `DESK-SHELL-002` 状态栏
- 🟨 `DESK-SHELL-003` 全局 Loading — 仅 sessionRestoring 全屏态，无独立全局 Loading 组件
- 🟩 `DESK-SHELL-004` 全局错误提示
- 🟩 `DESK-SHELL-005` Toast / Snackbar
- 🟩 `DESK-SHELL-006` Modal / Dialog 管理
- 🟩 `DESK-SHELL-007` 全局快捷操作
- 🟩 `DESK-SHELL-008` Keyboard Shortcut 管理
- 🟨 `DESK-SHELL-009` Focus 管理 — 多处 autoFocus，无 focus-trap 工具

---

# 7. 03 消息输入与用户操作

## 7.1 文本输入

- 🟩 `DESK-INP-001` 单行/多行文本输入
- 🟩 `DESK-INP-002` Enter 发送
- 🟩 `DESK-INP-003` Shift+Enter 换行
- 🟩 `DESK-INP-004` 输入框自适应高度
- 🟩 `DESK-INP-005` 清空输入
- 🟩 `DESK-INP-006` 空消息拦截
- 🟩 `DESK-INP-007` 超长文本输入
- 🟩 `DESK-INP-008` 中文输入法
- 🟩 `DESK-INP-009` Unicode / Emoji / 特殊字符输入

## 7.2 编辑状态

- 🟥 `DESK-INP-010` 输入草稿保存 — 未见 draft 持久化键，切换会话即丢失
- 🟥 `DESK-INP-011` Session 切换后的草稿恢复 — 无 draft-by-thread 恢复
- 🟩 `DESK-INP-012` 粘贴文本
- 🟨 `DESK-INP-013` 撤销 — 依赖 textarea 原生 undo，无自定义栈
- 🟨 `DESK-INP-014` 重做 — 依赖 textarea 原生 redo，无自定义栈
- 🟩 `DESK-INP-015` 文本选择
- 🟩 `DESK-INP-016` 复制
- 🟨 `DESK-INP-017` 剪切 — 依赖 textarea 原生剪切，无显式代码

## 7.3 消息操作

- 🟩 `DESK-INP-018` 发送消息
- 🟩 `DESK-INP-019` 防止重复提交
- 🟩 `DESK-INP-020` Stop / Cancel
- 🟨 `DESK-INP-021` Retry — 仅在 reply-failed 场景暴露 onRetryMessage
- 🟥 `DESK-INP-022` Edit & Resend — 未见 editMessage/resend 实现
- 🟥 `DESK-INP-023` Regenerate — 无 regenerate 关键字

## 7.4 多模态输入候选能力

- 🟩 `DESK-INP-024` 图片粘贴
- 🟥 `DESK-INP-025` 截图输入 — 无 desktopCapturer/截图 API 入口
- 🟩 `DESK-INP-026` 文件拖入输入区
- 🟩 `DESK-INP-027` 图片拖入输入区
- 🟩 `DESK-INP-028` Voice Input
- 🟥 `DESK-INP-029` 屏幕内容选择 / Capture — 无 screen selection/capture 入口

---

# 8. 04 对话内容展示

## 8.1 消息类型

- 🟩 `DESK-MSG-001` 用户消息展示
- 🟩 `DESK-MSG-002` Assistant 消息展示
- 🟥 `DESK-MSG-003` System 消息展示 — 无 role==="system" 渲染分支
- 🟩 `DESK-MSG-004` Error 消息展示
- 🟩 `DESK-MSG-005` Loading 消息展示
- 🟩 `DESK-MSG-006` Streaming 消息展示

## 8.2 Streaming

- 🟩 `DESK-MSG-007` 增量文本更新
- 🟩 `DESK-MSG-008` 首 Token / 首内容状态
- 🟩 `DESK-MSG-009` Streaming 完成
- 🟨 `DESK-MSG-010` Streaming 中断 — cancel/abort 转为 cancelled，未细分服务端断开
- 🟩 `DESK-MSG-011` Streaming 错误
- 🟩 `DESK-MSG-012` Streaming 自动滚动
- 🟩 `DESK-MSG-013` 用户主动滚动后停止自动滚动
- 🟩 `DESK-MSG-014` 新消息提示 / 回到底部

## 8.3 Rich Content

- 🟩 `DESK-MSG-015` Markdown
- 🟩 `DESK-MSG-016` 标题
- 🟩 `DESK-MSG-017` 列表
- 🟩 `DESK-MSG-018` 引用
- 🟩 `DESK-MSG-019` 表格
- 🟥 `DESK-MSG-020` 数学公式 — 未启用 katex/rehype-katex/math
- 🟩 `DESK-MSG-021` 行内代码
- 🟩 `DESK-MSG-022` 代码块
- 🟥 `DESK-MSG-023` Syntax Highlight — 无 hljs/shiki/prism 依赖
- 🟩 `DESK-MSG-024` 图片
- 🟩 `DESK-MSG-025` 文件 Card
- 🟩 `DESK-MSG-026` 链接
- 🟩 `DESK-MSG-027` Citation
- 🟩 `DESK-MSG-028` 可折叠区域
- 🟩 `DESK-MSG-029` Progress / Status Card

## 8.4 消息级操作

- 🟩 `DESK-MSG-030` Copy
- 🟩 `DESK-MSG-031` Select
- 🟨 `DESK-MSG-032` Retry — 仅 reply-failed 消息可 retry
- 🟥 `DESK-MSG-033` Delete — 无 deleteMessage 引用
- 🟥 `DESK-MSG-034` Feedback — 无 thumbs up/down UI
- 🟩 `DESK-MSG-035` 查看详情
- 🟩 `DESK-MSG-036` 展开 / 折叠
- 🟥 `DESK-MSG-037` 时间戳 — 消息 UI 无时间戳呈现
- 🟩 `DESK-MSG-038` 跳转到引用消息 / 上下文

---

# 9. 05 会话与历史管理

## 9.1 Session 生命周期

- 🟩 `DESK-SES-001` 新建会话
- 🟩 `DESK-SES-002` 打开会话
- 🟩 `DESK-SES-003` 切换会话
- 🟨 `DESK-SES-004` 关闭当前会话 — 无独立关闭动作，仅通过切换到本地新会话
- 🟩 `DESK-SES-005` 重命名会话
- 🟩 `DESK-SES-006` 删除会话
- 🟩 `DESK-SES-007` Archive
- 🟩 `DESK-SES-008` 恢复 Archive

## 9.2 Session 浏览

- 🟩 `DESK-SES-009` 会话列表
- 🟩 `DESK-SES-010` 会话排序
- 🟩 `DESK-SES-011` 会话搜索
- 🟨 `DESK-SES-012` 会话 Filter — 支持 workspace/all + Archived 页，无 status 维度筛选
- 🟩 `DESK-SES-013` Pin
- 🟩 `DESK-SES-014` 最近使用
- 🟥 `DESK-SES-015` 按时间分组 — 无 Today/Yesterday 分组

## 9.3 Session 状态

- 🟩 `DESK-SES-016` 当前 Session 标识
- 🟩 `DESK-SES-017` 未读状态
- 🟩 `DESK-SES-018` Running 状态
- 🟨 `DESK-SES-019` Failed 状态 — thread.status="error" 存在，UI 无 failed 视觉分支
- 🟩 `DESK-SES-020` Session 切换时 UI 状态保持
- 🟩 `DESK-SES-021` 多 Session 状态隔离
- 🟩 `DESK-SES-022` 历史消息恢复
- 🟩 `DESK-SES-023` Session 空状态
- 🟩 `DESK-SES-024` Session 异常/不可恢复状态

---

# 10. 06 Agent 运行状态与人机交互

> 只定义 Desktop Surface，不定义 Agent Runtime 内部策略。

## 10.1 Run 状态

- 🟩 `DESK-RUN-001` Idle
- 🟩 `DESK-RUN-002` Starting
- 🟩 `DESK-RUN-003` Running
- 🟩 `DESK-RUN-004` Waiting
- 🟩 `DESK-RUN-005` Completed
- 🟩 `DESK-RUN-006` Failed
- 🟩 `DESK-RUN-007` Cancelled
- 🟩 `DESK-RUN-008` Run Duration / 运行时长展示
- 🟩 `DESK-RUN-009` 当前 Run 与 Session 绑定展示

## 10.2 Tool Call 展示

- 🟩 `DESK-TOOL-001` Tool Call 开始
- 🟩 `DESK-TOOL-002` Tool 名称
- 🟨 `DESK-TOOL-003` Tool 参数摘要 — 结构里有 input 字段，UI 未渲染参数摘要
- 🟩 `DESK-TOOL-004` Running 状态
- 🟩 `DESK-TOOL-005` Success 状态
- 🟩 `DESK-TOOL-006` Failed 状态
- 🟨 `DESK-TOOL-007` Tool Result 摘要 — 结构里有 output，UI 仅提示"执行记录已保存"
- 🟩 `DESK-TOOL-008` 展开详情
- 🟩 `DESK-TOOL-009` 折叠详情
- 🟩 `DESK-TOOL-010` 多 Tool Call 顺序展示
- 🟥 `DESK-TOOL-011` 并行 Tool Call 展示 — 无 parallel 分组/标记

## 10.3 Approval

- 🟩 `DESK-APR-001` Approval Request 展示
- 🟩 `DESK-APR-002` Approve
- 🟩 `DESK-APR-003` Reject
- 🟥 `DESK-APR-004` 修改参数后 Approve — 无参数编辑 UI，仅审核清单
- 🟩 `DESK-APR-005` Pending 状态
- 🟨 `DESK-APR-006` 已处理状态 — approvalStore 有 decisions 记录，UI 移除后不展示历史
- 🟨 `DESK-APR-007` 已失效状态 — ambiguous 分支存在，未提供独立"已失效"UI
- 🟩 `DESK-APR-008` 超时状态
- 🟩 `DESK-APR-009` Session 切换后的 Approval 保持
- 🟩 `DESK-APR-010` 多 Approval 排队/区分

## 10.4 Clarification

- 🟩 `DESK-CLR-001` Clarification Question 展示
- 🟩 `DESK-CLR-002` 用户回复
- 🟨 `DESK-CLR-003` 取消 — 通过整体 abort 触发，无独立取消按钮
- 🟩 `DESK-CLR-004` Pending
- 🟩 `DESK-CLR-005` 已回答
- 🟥 `DESK-CLR-006` 超时 — 无 clarification 超时逻辑
- 🟨 `DESK-CLR-007` 多 Clarification 区分 — 只维护单个 activeInputRequest

## 10.5 Agent Control

- 🟩 `DESK-CTL-001` Stop
- 🟩 `DESK-CTL-002` Cancel
- 🟩 `DESK-CTL-003` Retry
- 🟥 `DESK-CTL-004` Resume — 无 resumeAgentRun 接口
- 🟥 `DESK-CTL-005` Restart Run — 无重启 run 入口
- 🟩 `DESK-CTL-006` 查看 Run 详情

---

# 11. 07 文件、附件与生成物

## 11.1 输入附件

- 🟩 `DESK-FILE-001` 系统文件选择器
- 🟩 `DESK-FILE-002` Drag & Drop
- 🟩 `DESK-FILE-003` 多文件选择
- 🟩 `DESK-FILE-004` 删除附件
- 🟨 `DESK-FILE-005` 替换附件 — 仅支持重排/删除，无替换动作
- 🟩 `DESK-FILE-006` 附件列表
- 🟨 `DESK-FILE-007` 文件图标 — 通过 data-file-category 数据属性，无专用图标组件
- 🟨 `DESK-FILE-008` 文件大小展示 — 有 data-size-bytes 字段，UI 未直接展示
- 🟩 `DESK-FILE-009` 文件类型展示
- 🟩 `DESK-FILE-010` 上传/处理状态展示
- 🟥 `DESK-FILE-011` 文件大小限制提示 — 后端有 MAX 常量，前端未提示
- 🟨 `DESK-FILE-012` 文件类型限制提示 — status="unsupported" 分支存在但提示较弱

## 11.2 文件路径与兼容能力

- 🟩 `DESK-FILE-013` 中文文件名
- 🟩 `DESK-FILE-014` 空格路径
- 🟨 `DESK-FILE-015` 特殊字符路径 — 无显式转义/校验，依赖 OS
- ⬜ `DESK-FILE-016` 超长文件名 — 未见截断/换行处理
- ⬜ `DESK-FILE-017` 长路径 — 未见 Windows 长路径特殊处理
- 🟩 `DESK-FILE-018` 同名文件
- 🟨 `DESK-FILE-019` 文件不存在 — 依赖通用 catch，无专门 UI 分支
- 🟨 `DESK-FILE-020` 文件被占用 — DesktopFailureKind "file_busy" 定义，无 UI 特化
- 🟨 `DESK-FILE-021` 权限不足 — 归入通用 failure
- ⬜ `DESK-FILE-022` 网络盘 — 未见 UNC/net drive 逻辑
- ⬜ `DESK-FILE-023` 可移动磁盘 — 未见检测

## 11.3 Preview

- 🟩 `DESK-FILE-024` 图片预览
- 🟨 `DESK-FILE-025` PDF 预览 — inline 关闭，提示用系统打开
- 🟩 `DESK-FILE-026` 文本预览
- 🟨 `DESK-FILE-027` Office 文件信息/预览 — 依赖后端文本抽取，无原生预览
- 🟩 `DESK-FILE-028` 不支持预览时的 fallback

## 11.4 Generated Artifact

- 🟩 `DESK-ART-001` 输出文件 Card
- 🟩 `DESK-ART-002` 保存
- 🟩 `DESK-ART-003` 另存为
- 🟩 `DESK-ART-004` 打开文件
- 🟨 `DESK-ART-005` 打开所在目录 — 主进程 IPC 存在，ArtifactsPanel 未接入按钮
- 🟨 `DESK-ART-006` 下载/导出 — 仅共享/实验路径可导出，ArtifactsPanel 无按钮
- 🟨 `DESK-ART-007` 文件生成进度 — 目录导入有阶段进度，通用生成进度较弱
- 🟨 `DESK-ART-008` 文件生成失败提示 — 通用 failureRecovery 提示
- 🟩 `DESK-ART-009` 同名输出文件处理
- 🟩 `DESK-ART-010` Artifact 历史列表
- ⬜ `DESK-ART-011` 删除本地 Artifact — ArtifactsPanel 未见 delete 按钮

---

# 12. 08 Agent 资源管理界面

> 这里只记录 Desktop 对资源的展示、配置和管理界面；资源内部语义由 Runtime / Backend 负责。

## 12.1 Model UI

- 🟩 `DESK-RES-001` 模型列表
- 🟩 `DESK-RES-002` 当前模型
- 🟩 `DESK-RES-003` 模型切换
- 🟩 `DESK-RES-004` 模型状态
- 🟩 `DESK-RES-005` Endpoint 配置
- 🟩 `DESK-RES-006` 连接测试
- 🟩 `DESK-RES-007` 模型不可用提示

## 12.2 Tool / MCP UI

- 🟩 `DESK-RES-008` Tool 列表
- 🟩 `DESK-RES-009` MCP Server 列表
- 🟩 `DESK-RES-010` Enabled / Disabled
- 🟩 `DESK-RES-011` Connection Status
- 🟩 `DESK-RES-012` 添加配置
- 🟩 `DESK-RES-013` 删除配置
- 🟩 `DESK-RES-014` 编辑配置
- 🟩 `DESK-RES-015` 错误状态
- 🟨 `DESK-RES-016` 查看 Tool / MCP 详情 — Tool 详情较全，MCP 详情仅在 Approval 面板

## 12.3 Skill UI

- 🟩 `DESK-RES-017` Skill 列表
- 🟩 `DESK-RES-018` Skill 启用/禁用
- 🟩 `DESK-RES-019` Skill 详情
- 🟨 `DESK-RES-020` Skill 状态 — 元数据可见，无显式 loaded/failed 状态

## 12.4 Knowledge UI

- 🟩 `DESK-RES-021` Knowledge Source 列表
- 🟩 `DESK-RES-022` 添加文档/数据源
- 🟩 `DESK-RES-023` 删除数据源
- 🟩 `DESK-RES-024` 状态展示
- 🟩 `DESK-RES-025` 错误展示

## 12.5 Memory UI

- 🟩 `DESK-RES-026` Memory 查看
- 🟩 `DESK-RES-027` Memory 删除
- 🟨 `DESK-RES-028` Memory 开关 — 通过 preferences toggle-list 间接控制
- 🟨 `DESK-RES-029` Memory 状态展示 — 仅通过 save 后简单文字提示

---

# 13. 09 设置与个性化

## 13.1 设置基础能力

- 🟩 `DESK-SET-001` 设置页面
- 🟩 `DESK-SET-002` 设置读取
- 🟩 `DESK-SET-003` 设置修改
- 🟩 `DESK-SET-004` 设置保存
- 🟨 `DESK-SET-005` Cancel — 仅 Model Provider 局部 Cancel，无全局
- 🟨 `DESK-SET-006` Restore Default — 仅偏好可重置，无全局 restore default
- 🟥 `DESK-SET-007` 设置搜索 — 未见搜索输入

## 13.2 Appearance

- 🟩 `DESK-SET-008` Light
- 🟩 `DESK-SET-009` Dark
- 🟩 `DESK-SET-010` Follow System
- 🟥 `DESK-SET-011` Zoom — 无 zoom setting/webContents.setZoomLevel
- 🟥 `DESK-SET-012` Font Size — 无字号偏好
- 🟥 `DESK-SET-013` UI Density — 无密度选项

## 13.3 Behavior

- 🟨 `DESK-SET-014` 启动行为 — 仅恢复上次会话/工作区两项开关
- 🟨 `DESK-SET-015` Close 行为 — 固定行为，无用户可选项
- 🟥 `DESK-SET-016` 开机启动 — 无 setLoginItemSettings
- 🟨 `DESK-SET-017` 默认保存路径 — 仅默认工作区路径
- 🟥 `DESK-SET-018` 自动打开生成文件 — 无 autoOpen 选项

## 13.4 Service / Agent Settings Surface

- 🟨 `DESK-SET-019` Endpoint — 仅 Model Provider api-host 输入
- 🟩 `DESK-SET-020` Model
- 🟩 `DESK-SET-021` API / Credential 配置入口
- 🟥 `DESK-SET-022` Proxy — 无代理设置 UI
- 🟥 `DESK-SET-023` Timeout — 仅通过环境变量配置
- 🟥 `DESK-SET-024` 高级连接参数 — 无 UI

## 13.5 Notification / Advanced

- 🟩 `DESK-SET-025` Desktop Notification 开关
- 🟨 `DESK-SET-026` Sound 开关 — 仅语音自动播报 toggle
- 🟨 `DESK-SET-027` Debug Mode — 有 developerMode toggle
- 🟥 `DESK-SET-028` 日志级别 — DebugPanel 仅过滤显示，不写入设置
- 🟨 `DESK-SET-029` 数据目录 — 只读展示 install.home + Open
- 🟩 `DESK-SET-030` Cache 清理

---

# 14. 10 身份、账户与 Workspace

## 14.1 Identity

- 🟨 `DESK-ID-001` 登录 — OIDC/WeChat 后端就绪，LoginScreen 未见 WeChat 入口
- 🟩 `DESK-ID-002` 登出
- 🟩 `DESK-ID-003` 当前用户展示
- 🟨 `DESK-ID-004` Token 失效提示 — 隐式 refresh，无独立提示
- 🟨 `DESK-ID-005` Session Expired 提示 — 有失效跳登录，提示较简
- 🟨 `DESK-ID-006` 权限不足提示 — unauthorized 通用提示，无细粒度
- 🟩 `DESK-ID-007` 重新认证入口
- 🟩 `DESK-ID-008` Credential 本地安全保存入口

## 14.2 企业身份与 Workspace

- 🟩 `DESK-ID-009` SSO
- 🟩 `DESK-ID-010` Workspace 选择
- 🟥 `DESK-ID-011` Tenant 选择 — 无 tenant 概念
- 🟥 `DESK-ID-012` Organization 展示 — 无组织 UI（仅 token claim 校验）
- 🟥 `DESK-ID-013` Account Switch — 需登出重登
- 🟥 `DESK-ID-014` Role 展示 — 无角色 UI
- 🟩 `DESK-ID-015` Workspace 切换后的状态刷新

---

# 15. 11 Desktop ↔ Runtime / Backend Bridge

## 15.1 Runtime Process

- 🟩 `DESK-BRG-001` Runtime 启动
- 🟩 `DESK-BRG-002` Runtime Ready 检测
- 🟩 `DESK-BRG-003` Runtime 关闭
- 🟨 `DESK-BRG-004` Runtime 重启 — 隐式重启存在，无 UI 手动重启入口
- 🟩 `DESK-BRG-005` Runtime Crash 检测
- 🟩 `DESK-BRG-006` Desktop Exit 时清理 Runtime
- 🟨 `DESK-BRG-007` Runtime 启动失败提示 — 有诊断代码，无专门 UI
- 🟩 `DESK-BRG-008` Runtime 进程残留处理

## 15.2 Transport

- 🟩 `DESK-BRG-009` 建立连接
- 🟩 `DESK-BRG-010` 正常断开
- 🟨 `DESK-BRG-011` 异常断开 — isRecoverableNetworkError 分类，无独立 UI
- 🟩 `DESK-BRG-012` Reconnect
- 🟩 `DESK-BRG-013` Request
- 🟩 `DESK-BRG-014` Response
- 🟩 `DESK-BRG-015` Notification / Event
- 🟩 `DESK-BRG-016` Request ID 匹配
- 🟨 `DESK-BRG-017` Pending Request 管理 — 靠 AbortSignal，无独立 pending Map
- 🟩 `DESK-BRG-018` Timeout
- 🟩 `DESK-BRG-019` Cancel
- 🟩 `DESK-BRG-020` 并发请求
- 🟨 `DESK-BRG-021` 消息串行化 / 写出顺序 — sequence pending Map 保证事件顺序

## 15.3 Protocol

- 🟩 `DESK-BRG-022` 协议消息解析
- 🟩 `DESK-BRG-023` 非法消息处理
- 🟨 `DESK-BRG-024` 未知 Event — 未知事件返回 null 忽略
- 🟩 `DESK-BRG-025` 重复 Event
- 🟩 `DESK-BRG-026` Event 顺序处理
- 🟩 `DESK-BRG-027` Runtime Version Compatibility
- 🟩 `DESK-BRG-028` 协议版本协商
- 🟨 `DESK-BRG-029` 不兼容协议提示 — 有 oaep_capability_partial 抛错，UI 提示不足

## 15.4 用户侧连接状态

- 🟨 `DESK-BRG-030` Runtime Starting — OperationalStateBar preparing 覆盖
- 🟩 `DESK-BRG-031` Runtime Ready
- 🟨 `DESK-BRG-032` Runtime Unavailable — 有诊断代码，无独立 UI
- 🟨 `DESK-BRG-033` Runtime Disconnected — 只有 reconnecting 复合态
- 🟨 `DESK-BRG-034` Runtime Reconnecting — connectionState="reconnecting"
- 🟥 `DESK-BRG-035` Runtime Version Incompatible — 无独立 UI 分支

---

# 16. 12 本地状态、数据持久化与数据生命周期

## 16.1 UI State

- 🟩 `DESK-DATA-001` Window State 持久化
- 🟩 `DESK-DATA-002` Sidebar State 持久化
- 🟩 `DESK-DATA-003` Theme 持久化
- 🟨 `DESK-DATA-004` 当前页面状态 — 仅存最近线程/工作区，不含更细页面状态
- 🟩 `DESK-DATA-005` 当前 Session 状态
- 🟥 `DESK-DATA-006` Input Draft 持久化 — 未见 DRAFT_STORAGE/inputDraft

## 16.2 Local Data

- 🟩 `DESK-DATA-007` Session Metadata
- 🟨 `DESK-DATA-008` Recent Files — 仅远端最近路径持久化
- 🟩 `DESK-DATA-009` User Preferences
- 🟨 `DESK-DATA-010` Cache — 依赖 Electron 会话缓存，无独立缓存层
- 🟨 `DESK-DATA-011` Local DB — 无 sqlite，仅 durableJsonStore
- 🟩 `DESK-DATA-012` 本地索引/元数据

## 16.3 Data Lifecycle

- 🟩 `DESK-DATA-013` 读取
- 🟩 `DESK-DATA-014` 保存
- 🟩 `DESK-DATA-015` Migration
- 🟩 `DESK-DATA-016` 清理
- 🟩 `DESK-DATA-017` Reset
- 🟩 `DESK-DATA-018` Clear Cache
- 🟩 `DESK-DATA-019` 数据损坏检测
- 🟩 `DESK-DATA-020` 数据损坏恢复
- 🟨 `DESK-DATA-021` 数据导出 — 仅内存打包 JSON，非用户导出入口
- 🟥 `DESK-DATA-022` 数据导入 — 未见 importLocalData 路径
- 🟨 `DESK-DATA-023` 本地数据备份 — 隐式单文件 .bak 备份
- 🟨 `DESK-DATA-024` 本地数据恢复 — .bak 回退存在，无用户级恢复入口
- 🟩 `DESK-DATA-025` 完整清除用户本地数据

---

# 17. 13 通知与后台行为

## 17.1 In-App Notification

- 🟩 `DESK-NTF-001` 完成通知
- 🟥 `DESK-NTF-002` 失败通知 — 仅 completed 状态触发通知
- 🟥 `DESK-NTF-003` Approval 通知 — 无 approval 专用通知
- 🟥 `DESK-NTF-004` Clarification 通知 — 无 clarification 通知
- 🟩 `DESK-NTF-005` 未读 Badge

## 17.2 OS Notification

- 🟩 `DESK-NTF-006` 系统通知
- 🟩 `DESK-NTF-007` 点击通知跳转对应 Session
- 🟨 `DESK-NTF-008` 通知权限处理 — 仅 isSupported 判定，无 Windows 权限引导
- 🟩 `DESK-NTF-009` 通知开关
- 🟩 `DESK-NTF-010` 后台任务结束通知

## 17.3 Background Behavior

- 🟩 `DESK-BG-001` 最小化后任务状态保持
- 🟩 `DESK-BG-002` 窗口关闭后是否继续运行
- 🟥 `DESK-BG-003` Tray Background — 无 Tray
- 🟨 `DESK-BG-004` Background → Foreground 状态同步 — 有 away summary 恢复
- 🟥 `DESK-BG-005` 系统休眠/唤醒后的状态恢复 — 未监听 powerMonitor
- 🟥 `DESK-BG-006` 锁屏/解锁后的状态恢复 — 未处理 lock/unlock-screen

---

# 18. 14 网络连接与离线状态

> 此模块是 v1.0 相对初稿新增的独立能力域。Desktop 不应把所有连接问题都混在 Runtime Bridge 中。

## 18.1 Connectivity

- 🟩 `DESK-NET-001` 网络可用性检测
- 🟩 `DESK-NET-002` 网络断开提示
- 🟩 `DESK-NET-003` 网络恢复检测
- 🟨 `DESK-NET-004` 网络恢复后的自动重连 — 通过 networkRecovery 退避重试
- 🟨 `DESK-NET-005` 服务端不可达与本地断网区分 — 分类存在，UI 未细分
- 🟨 `DESK-NET-006` DNS/连接失败可理解提示 — 靠通用错误分类，无友好 DNS 提示

## 18.2 Offline

- 🟩 `DESK-NET-007` Offline 状态展示
- 🟨 `DESK-NET-008` 离线可用功能明确化 — 未有明确 UI 说明
- 🟨 `DESK-NET-009` 离线时禁止不可用操作 — 靠 gateway 状态阻断，无统一禁用汇总
- 🟩 `DESK-NET-010` 离线状态下本地数据访问
- 🟨 `DESK-NET-011` 恢复联网后的状态同步 — 未主动触发 sync

## 18.3 Proxy / CA Surface

- 🟥 `DESK-NET-012` HTTP Proxy — 未处理 HTTP_PROXY
- 🟥 `DESK-NET-013` HTTPS Proxy — 未处理 HTTPS_PROXY，走 Node 系统代理
- 🟨 `DESK-NET-014` No Proxy — 强制环回 NO_PROXY 绕行
- 🟥 `DESK-NET-015` Proxy 连接状态 — 无 proxy 状态 UI
- 🟥 `DESK-NET-016` Custom CA 配置入口 — 未见 CA 配置入口
- 🟥 `DESK-NET-017` 证书错误提示 — 未拦截 certificate-error

---

# 19. 15 操作系统集成

## 19.1 常用 OS 能力

- 🟩 `DESK-OS-001` Clipboard
- 🟩 `DESK-OS-002` 外部浏览器打开链接
- 🟩 `DESK-OS-003` 文件管理器打开目录
- 🟩 `DESK-OS-004` 系统文件选择器
- 🟩 `DESK-OS-005` 系统通知
- 🟩 `DESK-OS-006` 系统默认应用调用

## 19.2 Desktop Integration

- 🟥 `DESK-OS-007` System Tray — 未使用 Tray 类
- 🟨 `DESK-OS-008` Dock / Taskbar — 使用系统默认任务栏，无 overlayIcon/thumbar
- 🟨 `DESK-OS-009` Desktop Shortcut — 靠 NSIS/WiX 默认创建
- 🟨 `DESK-OS-010` Start Menu — 靠 NSIS/WiX 默认创建
- 🟥 `DESK-OS-011` Global Shortcut — 无 globalShortcut 注册
- 🟥 `DESK-OS-012` Auto Start — 无 setLoginItemSettings

## 19.3 高级 OS 集成

- 🟩 `DESK-OS-013` URL Scheme
- 🟩 `DESK-OS-014` Deep Link
- 🟥 `DESK-OS-015` File Association — electron-builder 无 fileAssociations
- 🟨 `DESK-OS-016` Share To Agent — 仅出向分享，无入站 share 入口
- 🟨 `DESK-OS-017` Context Menu — 仅 HTML 自绘 context-menu，无原生 Menu
- 🟥 `DESK-OS-018` Screen Capture — 无 desktopCapturer/getDisplayMedia
- 🟥 `DESK-OS-019` System Search Integration — 无 Windows Search/JumpList
- 🟨 `DESK-OS-020` 多显示器 / DPI 感知 — screen.getAllDisplays 覆盖多屏，无 DPI 特化

---

# 20. 16 安装、升级与版本管理

## 20.1 Install

- 🟩 `DESK-PKG-001` 首次安装
- 🟩 `DESK-PKG-002` 自定义安装目录
- 🟩 `DESK-PKG-003` Shortcut 创建
- 🟨 `DESK-PKG-004` 安装失败处理 — 有失败日志，无自动回滚
- 🟩 `DESK-PKG-005` 重装
- 🟩 `DESK-PKG-006` Silent Install
- 🟩 `DESK-PKG-007` Offline Installer
- 🟩 `DESK-PKG-008` 安装包完整性校验

## 20.2 Upgrade

- 🟩 `DESK-PKG-009` 手动检查更新
- 🟩 `DESK-PKG-010` 自动检查更新
- 🟩 `DESK-PKG-011` 更新下载
- 🟩 `DESK-PKG-012` 更新安装
- 🟩 `DESK-PKG-013` 更新后 Restart
- 🟩 `DESK-PKG-014` 升级后用户数据保留
- 🟨 `DESK-PKG-015` 配置 Migration — 仅 defaults 首次复制，无版本迁移逻辑
- 🟩 `DESK-PKG-016` Upgrade Failure
- 🟩 `DESK-PKG-017` 更新回滚
- 🟩 `DESK-PKG-018` 更新渠道 / Channel

## 20.3 Compatibility

- 🟩 `DESK-PKG-019` 旧版本升级
- 🟨 `DESK-PKG-020` 跨大版本升级 — semver 比较通过，无 DB 迁移证据
- 🟩 `DESK-PKG-021` Runtime Version Compatibility
- 🟩 `DESK-PKG-022` Backend Version Compatibility

## 20.4 Uninstall

- 🟩 `DESK-PKG-023` 正常卸载
- 🟩 `DESK-PKG-024` 配置保留策略
- 🟩 `DESK-PKG-025` 用户数据删除策略
- 🟨 `DESK-PKG-026` 残留文件处理 — Remove-Safely 重试，无孤立文件扫描

---

# 21. 17 日志、诊断与故障恢复

## 21.1 Logs

- 🟩 `DESK-DIAG-001` Desktop 日志生成
- 🟩 `DESK-DIAG-002` 日志查看
- 🟩 `DESK-DIAG-003` 打开日志目录
- 🟩 `DESK-DIAG-004` 日志导出
- 🟨 `DESK-DIAG-005` 日志轮转 — 按大小/时间保留，无标准 rotation
- 🟥 `DESK-DIAG-006` 日志级别切换 — 未见 LogLevel 切换代码

## 21.2 Diagnostics

- 🟩 `DESK-DIAG-007` App Version
- 🟩 `DESK-DIAG-008` Runtime Version
- 🟨 `DESK-DIAG-009` OS Version — 仅 platform 字段
- 🟨 `DESK-DIAG-010` Architecture — 仅在诊断包中
- 🟨 `DESK-DIAG-011` Environment — 仅通过 gatewayEnvironment 判定模式
- 🟩 `DESK-DIAG-012` Service Status
- 🟩 `DESK-DIAG-013` Copy Diagnostic Info
- 🟩 `DESK-DIAG-014` Export Diagnostic Bundle
- 🟩 `DESK-DIAG-015` Request / Session / Run 关联标识展示或导出

## 21.3 Recovery

- 🟨 `DESK-REC-001` Restart Runtime — stopGateway 仅在 clean up 使用，无独立入口
- 🟥 `DESK-REC-002` Restart App — 无 restart-app IPC
- 🟥 `DESK-REC-003` Reset Settings — 未见 resetSettings
- 🟩 `DESK-REC-004` Clear Cache
- 🟥 `DESK-REC-005` Safe Mode — 未见 safeMode
- 🟨 `DESK-REC-006` Local DB Recovery — atomicFileReplace + quarantine 覆盖局部
- 🟨 `DESK-REC-007` Crash Recovery — 有 trace 级恢复，无 crashReporter
- 🟩 `DESK-REC-008` 未完成任务恢复/标记

## 21.4 Problem Reporting

- 🟥 `DESK-REC-009` Crash Report — 未注册 crashReporter
- 🟩 `DESK-REC-010` Copy Error Details
- 🟩 `DESK-REC-011` 一键收集诊断信息
- 🟥 `DESK-REC-012` 用户主动问题反馈入口 — 未见反馈入口

---

# 22. 18 安全与隐私控制

> “安全”同时也是后续验证维度；这里仅列 **Desktop 自身需要提供的安全/隐私功能面**。

## 22.1 Credential / Secret

- 🟩 `DESK-SEC-001` Credential 安全存储
- 🟩 `DESK-SEC-002` Secret 不明文展示
- 🟨 `DESK-SEC-003` Secret 修改/清除 — 仅 logout 或全局清理触发
- 🟨 `DESK-SEC-004` API Key 掩码 — 有渲染层脱敏，未统一策略
- 🟨 `DESK-SEC-005` Credential 失效处理 — 静默失败 + logout

## 22.2 Permission / Consent

- 🟩 `DESK-SEC-006` 敏感操作确认
- 🟨 `DESK-SEC-007` 文件访问权限提示 — 只写入 ms-settings 跳转
- 🟩 `DESK-SEC-008` 麦克风权限
- ➖ `DESK-SEC-009` 屏幕录制/截屏权限 — Windows 无系统级授权流程
- 🟨 `DESK-SEC-010` 通知权限 — 引导 ms-settings:notifications
- 🟨 `DESK-SEC-011` 权限被拒后的可恢复入口 — 打开系统设置手动前往

## 22.3 External Content / Navigation

- 🟩 `DESK-SEC-012` 外部链接安全打开
- 🟩 `DESK-SEC-013` 危险 URL / Scheme 拦截
- 🟨 `DESK-SEC-014` 下载文件风险提示 — 浏览会话直接 preventDefault，无风险提示
- 🟩 `DESK-SEC-015` 不可信内容与本地执行边界

## 22.4 Privacy Controls

- 🟥 `DESK-SEC-016` Telemetry 开关 — 未实现遥测开关
- 🟥 `DESK-SEC-017` Crash Report 数据说明/控制 — crashReporter 未启用
- 🟩 `DESK-SEC-018` 日志敏感信息脱敏
- 🟩 `DESK-SEC-019` 清除本地历史数据
- 🟩 `DESK-SEC-020` 清除缓存
- 🟩 `DESK-SEC-021` 清除账户凭据
- 🟩 `DESK-SEC-022` 数据目录可见性/定位
- 🟥 `DESK-SEC-023` Privacy / Data Usage 信息入口 — 无 Privacy 页/入口

---

# 23. 19 内网部署能力

> 对消费者产品可整体标记为 `Not Applicable`；对科研院所、企业内网、离线部署场景建议重点保留。

## 23.1 内网网络环境

- ➖ `DESK-ENT-001` Internal DNS 适配 — 依赖系统 DNS
- 🟨 `DESK-ENT-002` HTTP Proxy — net.fetch 遵循系统代理，无显式 HTTP_PROXY 处理
- 🟨 `DESK-ENT-003` HTTPS Proxy — 靠 Node 系统代理，updater 只走 https 白名单
- 🟥 `DESK-ENT-004` No Proxy — 未处理 NO_PROXY
- 🟥 `DESK-ENT-005` Custom CA — 未见 NODE_EXTRA_CA_CERTS 处理
- 🟥 `DESK-ENT-006` 自签名证书 — 无自定义 CA 代码
- 🟩 `DESK-ENT-007` 固定内网 Endpoint
- 🟨 `DESK-ENT-008` 禁止公网依赖时可运行 — Bundled backend 离线可用，更新仍依赖内网源

## 23.2 部署

- 🟩 `DESK-ENT-009` Offline Install
- 🟩 `DESK-ENT-010` Silent Install
- 🟨 `DESK-ENT-011` 批量部署 — 支持 msiexec /qn 脚本，未见 MST/GPO
- 🟨 `DESK-ENT-012` Managed Configuration — 仅诊断策略可管
- 🟩 `DESK-ENT-013` 固定配置模板
- 🟩 `DESK-ENT-014` 内部更新源
- 🟨 `DESK-ENT-015` Controlled Upgrade — 仅通过环境变量关闭自动更新
- 🟩 `DESK-ENT-016` 安装包离线依赖完整性

## 23.3 数据与策略

- 🟩 `DESK-ENT-017` 自定义数据目录
- 🟨 `DESK-ENT-018` 自定义日志目录 — 日志目录随 DRSAI_HOME，无独立 LOG_DIR
- 🟨 `DESK-ENT-019` 禁止公网访问 — 有 fuse/URL 白名单，无强制离线开关
- 🟥 `DESK-ENT-020` Telemetry 强制关闭 — 无遥测代码
- 🟨 `DESK-ENT-021` 数据清除策略 — dataCleanup + uninstall 参数存在，未策略化
- 🟨 `DESK-ENT-022` 管理员锁定设置 — 仅诊断项 locked 策略
- 🟨 `DESK-ENT-023` Tool / Model 配置策略 — 内置 provider 模板
- 🟩 `DESK-ENT-024` Update Channel 管理

---

# 24. Cross-cutting Quality Baseline

以下内容 **不是与 Feature 平级的功能项**，而是之后验证每个 Feature 时需要施加的质量维度。

```text
Capability × Quality Dimension
```

## 24.1 Functional Correctness

关注：

- 正常路径；
- 输入/输出正确；
- 状态转换正确；
- 用户操作结果正确。

## 24.2 Reliability & Recovery

关注：

- Crash；
- 重复操作；
- Cancel；
- Timeout；
- 断连；
- 恢复；
- 幂等；
- 残留资源；
- 异常退出。

## 24.3 Performance

关注：

- 启动时间；
- 首屏时间；
- UI 响应；
- Streaming 渲染；
- 大列表；
- 大文件；
- CPU；
- 内存；
- 长时间运行。

## 24.4 Security

关注：

- IPC 边界；
- Renderer/Main 隔离；
- 外部 URL；
- Secret；
- 文件权限；
- 路径遍历；
- 本地执行；
- 下载内容；
- 危险 Scheme。

## 24.5 Privacy

关注：

- 日志脱敏；
- 本地数据生命周期；
- Telemetry；
- Crash Report；
- Credential；
- 用户数据清理。

## 24.6 Compatibility

关注：

- Windows / macOS / Linux；
- x64 / arm64；
- DPI；
- 多显示器；
- 不同分辨率；
- 网络环境；
- Proxy；
- 安装/升级路径。

## 24.7 Accessibility

关注：

- 键盘操作；
- Focus；
- Screen Reader；
- 可见焦点；
- 对比度；
- 缩放；
- 非鼠标操作。

## 24.8 Internationalization

关注：

- 中文；
- 英文；
- Unicode；
- 时区；
- 日期；
- 路径字符；
- 文本布局；
- 长文本。

## 24.9 Usability

关注：

- 状态是否可理解；
- 错误是否可恢复；
- 用户是否知道当前 Agent 在做什么；
- 长任务是否有反馈；
- 危险操作是否明确；
- 不可用操作是否正确解释。

---

# 25. 不应直接写成 Capability 的内容

以下条目应进入验证矩阵，而不是作为顶层 Feature：

```text
启动速度 < 3 秒
不会崩溃
内存占用合理
1 GB 文件不会卡死
没有 XSS
中文不乱码
支持 Windows 11
按钮可通过键盘访问
断网后不丢消息
```

正确表达方式应为：

```text
DESK-FILE-001 文件选择
    × Performance
    × Reliability
    × Security
    × Compatibility
```

---

# 26. 后续详细映射建议

本文件当前只维护 Feature 的粗粒度状态。后续如果需要进一步形成结构化项目映射表，可增加：

| 字段 | 说明 |
|---|---|
| Feature ID | 本目录稳定 ID |
| 一级模块 | Capability Domain |
| 二级模块 | Sub-domain |
| Feature | 功能名称 |
| Description | 功能说明 |
| Applicability | TBD / Applicable / N/A |
| Priority | P0–P3 |
| Ownership | Desktop / Shared / External |
| Implementation | Unknown / Not Implemented / Partial / Implemented / Deprecated / Removed |
| Implementation Evidence | 代码 / PR / Commit |
| Notes | 备注 |

测试结果、验证版本、Commit 和证据不在本文件维护，统一放入后续 Verification 文档。

---

# 27. 维护规则

## 27.1 Feature ID 稳定

已经进入 Catalog 的 Feature ID 不重复使用。

即使功能删除，也保留历史 ID，并将其标记为：

```text
Removed / Deprecated
```

## 27.2 不因当前项目没有实现而删除

本文件描述的是 **理想候选全集**，不是当前产品菜单。

当前项目不需要的能力应标记：

```text
Not Applicable
```

而不是从 Catalog 中删除。

## 27.3 新能力只追加，不轻易重定义

如果以后出现：

- 新 Agent 交互模式；
- 新 OS 能力；
- 新文件类型；
- 新部署要求；

优先新增 Feature ID。

只有在原有条目定义明显错误时才修改定义。

## 27.4 本文件只维护实现状态，不维护验证状态

本文件中的：

```text
🟩 已实现
```

只表示当前项目已经具备该能力，不代表该能力已经被可靠验证。

详细验证结果应绑定：

```text
Feature ID
Version / Commit
Environment
Test / Evidence
Date
```

并在后续 Verification 文档中维护。

## 27.5 实现状态与验证状态必须分离

```text
Implemented ≠ Passed
```

第一阶段先解决：

```text
What should exist?
What exists?
What is missing?
```

第二阶段再解决：

```text
What has been verified?
On which version?
With what evidence?
```

---

# 28. 建议的完整治理目录

后续可以围绕本文件逐步形成：

```text
desktop-capability-governance/
│
├── 01_Desktop_Agent_Capability_Catalog.md
│      理想能力全集，本文件
│
├── 02_Project_Capability_Mapping.*
│      当前项目详细能力映射 + Capability Gap（可选深化）
│
├── 03_Test_Case_Catalog.*
│      Feature → Test Case
│
├── 04_Verification_Matrix.*
│      Test × Version × Commit × Environment
│
├── 05_Change_Log.md
│      能力/实现/验证基线变更
│
└── evidence/
       screenshots/
       logs/
       reports/
       ci/
```

---

# 29. v1.0 完整性审计结论


当前 v1.0 已覆盖从：

```text
Install
  ↓
First Run
  ↓
Configure
  ↓
Chat / Session
  ↓
Agent Interaction
  ↓
Files / Artifacts
  ↓
Background / Notification
  ↓
Failure / Recovery
  ↓
Upgrade
  ↓
Uninstall
```

这一完整用户生命周期中的主要 Desktop 能力域。

后续如果新增能力，优先判断其能否归入现有 19 个 Domain；只有出现新的稳定职责边界时，再新增一级能力域。
