# OpenDrSai Desktop 下一阶段诊断重构方案

## 1. 文档信息

- 阶段名称：诊断体验收敛与双域重构阶段
- 适用产品：OpenDrSai Desktop
- 文档状态：已实施并通过验收
- 制定日期：2026-08-02
- 完成日期：2026-08-02
- 核心目标：让开发者看清 Agent 运行状态，并在 Agent 或 App 出错时快速溯源

## 2. 背景

当前诊断系统已经具备事件持久化、Trace、组件健康、错误栈、源码定位、OAEP Runtime 日志、Agent 活动、根因分析、交互调试和诊断包导出等能力。

现有默认界面同时展示概览、链路、错误、根因、交互调试、治理、活动、运行日志和原始记录。功能覆盖较全，但 Agent 状态、App 错误和底层协议证据没有形成清晰的信息层级，开发者需要在多个页面之间判断：

1. Agent 当前运行到哪里。
2. Agent 为什么失败。
3. OpenDrSai Desktop 自身是否发生故障。
4. 哪些内容只是 OAEP、Trace 或性能等底层证据。

下一阶段不推倒现有诊断基础设施，而是在现有实现上完成数据分类、状态投影、错误聚合和默认界面收敛。

## 3. 核心需求

### 3.1 Agent 运行诊断

开发者需要实时看到：

- Agent 总体状态。
- 当前运行阶段。
- 当前正在执行或等待的动作。
- Backend、模型和连接状态。
- 总耗时和当前阶段耗时。
- 当前工具及其执行状态。
- 失败原因、错误码、调用栈和源码位置。
- 错误发生前后的关键运行事件。

### 3.2 App 运行诊断

开发者需要独立看到：

- Electron Main 和 Renderer 异常。
- IPC 调用失败。
- Runtime 进程启动、退出、重启和不可用。
- SSH、Gateway 和网络连接异常。
- 文件读写、持久化和权限错误。
- 关键组件健康状态。
- App 错误的影响范围、代码位置和建议动作。

### 3.3 运行日志

开发者需要类似终端的精简日志：

- 默认一行一个事件。
- 按时间、协议、阶段、上下文、级别和消息排列。
- 点击单行展开完整字段及 OAEP 数据。
- 支持当前任务、全部 Agent、App 和全部日志范围。
- 支持级别和关键词筛选。
- 高频流式增量自动合并。

## 4. 范围

### 4.1 本阶段包含

- Agent、App、Protocol 三类诊断领域划分。
- Agent 运行状态投影。
- Agent 错误和 App 错误的统一事件包。
- 默认调试栏收敛为 Agent、App 错误、运行日志三个页面。
- 现有高级能力迁移至高级诊断入口。
- 诊断数据去重、降噪、脱敏和兼容迁移。
- 自动化、真实 Runtime 和 UI 验收。

### 4.2 本阶段不包含

- 删除 Trace、根因分析、交互调试或生产治理能力。
- 修改 OAEP v1 协议定义。
- 改变 Agent、Runtime 或 Backend 的业务执行语义。
- 将诊断系统改造成通用日志平台。
- 引入远程集中日志服务。

## 5. 产品信息架构

调试栏默认只保留三个一级页面。

### 5.1 Agent

顶部固定显示：

- 状态。
- 当前阶段。
- 当前动作。
- Backend 和模型。
- 总耗时。
- 当前阶段耗时。
- 连接状态。

下方显示当前任务的精简时间线。成功事件保持单行，失败事件自动展开。

### 5.2 App 错误

只展示 OpenDrSai Desktop 自身错误。相同错误按指纹合并，显示次数、首次发生时间和最近发生时间。

### 5.3 运行日志

保留终端式单行日志。OAEP sequence、dedupe key、Event 数据及协议字段只在展开后显示。

### 5.4 高级诊断

以下能力移入右上角高级诊断入口：

- Trace 瀑布图。
- 根因分析和候选推断。
- 错误聚类管理。
- 交互式断点调试。
- 生产诊断治理。
- 性能和资源指标。
- 原始事件。

## 6. 总体架构

诊断系统划分为三层：

```text
事实层
├── Diagnostic Event
├── Chat / Structured Activity
├── OAEP Event
├── Runtime diagnostics
└── Error / Stack / Source

投影层
├── AgentRunDiagnosticState
├── DiagnosticIncident
├── AppErrorGroup
└── RuntimeLogLine

界面层
├── Agent
├── App 错误
├── 运行日志
└── 高级诊断
```

Main 进程中的 DesktopDiagnostics 继续作为持久化事实来源。Renderer 日志 Store 只承担显示缓存，不再成为第二套诊断事实来源。

## 7. 数据模型调整

### 7.1 DiagnosticEvent 扩展

在现有事件结构上增加可选字段，保持旧记录可读取：

```text
domain
├── agent
├── app
└── protocol

agentPhase
├── preparing
├── connecting
├── waiting_model
├── reasoning
├── calling_tool
├── waiting_approval
├── responding
├── completed
├── failed
└── cancelled

visibility
├── milestone
├── detail
└── raw
```

事件还应支持错误指纹、影响范围和可验证的错误上下文引用。

### 7.2 AgentRunDiagnosticState

统一描述一次 Agent Run：

- Session、Run、Request、Backend 和模型标识。
- 总状态和当前阶段。
- 当前动作和当前工具。
- 开始时间、阶段开始时间和最近事件时间。
- 总耗时和阶段耗时。
- 连接状态。
- 首个失败事件。
- 最近关键事件。

### 7.3 DiagnosticIncident

统一描述一次可排查故障：

- Agent 或 App 领域。
- 错误摘要、错误码和原始错误。
- 失败阶段和来源组件。
- 文件、函数、行号及调用栈。
- 错误前后的事件引用。
- 影响说明和建议动作。
- 错误指纹、重复次数、首次及最近发生时间。

## 8. 事件映射原则

| 原始事件 | 领域 | Agent 阶段 | 默认可见性 |
| --- | --- | --- | --- |
| Chat 请求开始 | Agent | preparing | milestone |
| Runtime Run 创建 | Agent | connecting | milestone |
| OAEP stream connected | Protocol | connecting | detail |
| 等待首个模型事件 | Agent | waiting_model | milestone |
| reasoning delta | Agent | reasoning | 合并后的 detail |
| tool started | Agent | calling_tool | milestone |
| tool delta | Protocol | calling_tool | raw |
| approval requested | Agent | waiting_approval | milestone |
| message delta | Agent | responding | 合并后的 detail |
| run completed | Agent | completed | milestone |
| run failed | Agent | failed | milestone，自动展开 |
| Renderer/Main exception | App | 不适用 | milestone，自动展开 |
| IPC、存储、网络失败 | App | 不适用 | milestone，自动展开 |
| OAEP cursor、sequence | Protocol | 不适用 | detail 或 raw |

## 9. 开发模块

### M1：诊断领域分类器（5 个功能点）

1. Agent、App、Protocol 自动分类。
2. 旧事件兼容分类。
3. 严重程度标准化。
4. visibility 判定。
5. 错误指纹生成。

验收：所有已知事件类型都能稳定分类，相同错误获得相同指纹。

### M2：Agent 状态投影器（7 个功能点）

1. Run 生命周期投影。
2. 当前阶段投影。
3. 当前动作投影。
4. Backend、模型和连接状态投影。
5. 当前工具投影。
6. 总耗时和阶段耗时计算。
7. 首个失败和最近事件投影。

验收：一次正常 Run 和一次失败 Run 都能得到唯一、连续的状态结果。

### M3：错误事件聚合器（6 个功能点）

1. Error、Runtime diagnostics 和工具错误关联。
2. 调用栈标准化。
3. Source Map 和源码位置关联。
4. 错误前后事件截取。
5. 影响说明生成。
6. 建议动作生成。

验收：Agent 失败后，一个 Incident 即可提供错误、阶段、堆栈、源码和上下文。

### M4：App 错误采集与聚合（5 个功能点）

1. Main/Renderer 异常归类。
2. IPC、Runtime、SSH、网络、存储和权限错误归类。
3. 相同错误合并计数。
4. 首次和最近发生时间维护。
5. 组件健康与错误影响关联。

验收：App 错误不进入 Agent 时间线，相同错误不重复刷屏。

### M5：运行日志投影（5 个功能点）

1. 单行终端格式。
2. 当前任务和来源范围切换。
3. 流式增量合并。
4. 高频日志节流。
5. 单行展开和完整日志复制。

验收：窄侧栏下一行一个事件，展开后可以看到完整 OAEP 数据。

### M6：调试栏界面重构（6 个功能点）

1. Agent 页面。
2. App 错误页面。
3. 运行日志页面。
4. 高级诊断入口。
5. 当前任务自动选择。
6. 错误自动展开和源码跳转。

验收：默认界面只保留三个一级页面，并能在一屏内看到 Agent 状态或错误核心信息。

### M7：诊断数据通道收敛（4 个功能点）

1. Main Diagnostics 成为唯一持久化事实来源。
2. 移除 Renderer 收到事件后的重复回写。
3. Activity 和 OAEP 在生产侧直接规范化。
4. 旧日志和旧诊断记录兼容读取。

验收：相同事件只持久化一次，刷新或重启后诊断结果保持一致。

### M8：源码溯源与诊断操作（5 个功能点）

1. 查看源码上下文。
2. 编辑器打开、系统打开和显示文件。
3. 复制脱敏诊断。
4. 定位到对应对话。
5. 重新运行入口。

验收：存在源码信息的错误可以一键打开；不存在源码信息时给出明确原因。

## 10. 实施阶段

### P1：数据分类与去重

- 扩展诊断事件模型。
- 实现领域分类器。
- 标记现有事件生产者。
- 移除 Renderer 到 Main 的重复诊断回写。
- 保持旧界面继续工作。

完成条件：事件不丢失、不重复，旧记录仍可读取。

### P2：Agent 状态闭环

- 实现 AgentRunDiagnosticState。
- 接入 Chat、Structured Activity、工具、连接和 OAEP 事件。
- 实现 waiting_model 和阶段计时。
- 实现当前动作、工具和首次失败。

完成条件：正常、等待、失败、取消和恢复 Run 都有准确状态。

### P3：双域错误闭环

- 实现 DiagnosticIncident。
- Agent 与 App 错误隔离。
- Runtime diagnostics 扩展到所有 Backend。
- 实现指纹、合并、源码和上下文。

完成条件：Agent 和 App 故障可以分别查看并快速溯源。

### P4：默认界面收敛

- 实现三个默认页面。
- 高级功能迁移到高级诊断。
- 拆分现有大型 DebugPanel。
- 完成窄侧栏、自适应和交互优化。

完成条件：默认导航只包含 Agent、App 错误和运行日志。

### P5：兼容清理与发布验收

- 清理重复 Store 和旧过滤逻辑。
- 完成旧事件兼容测试。
- 完成真实 Runtime、真实 OAEP 和沙盒失败测试。
- 完成性能、隐私和发布门禁。

完成条件：全部自动化与真实环境验收通过。

## 11. 测试与验收

### 11.1 单元测试

- OAEP 和 Chat 事件映射到正确 Agent 阶段。
- Agent、App、Protocol 分类准确。
- 流式 delta 合并和日志节流准确。
- 错误指纹稳定。
- 敏感内容正确脱敏。
- 旧事件兼容分类。

### 11.2 集成测试

- 正常 Agent Run：准备、模型、工具、回复、完成。
- 等待模型超过阈值后，状态和计时准确。
- 工具失败形成完整 Incident。
- Codex 和 My DrSai 失败进入相同错误模型。
- Renderer 错误只进入 App 错误。
- OAEP 重连只进入协议日志，不污染 Agent 里程碑。
- 相同 App 错误自动合并。

### 11.3 真实 Runtime 测试

- 启动真实本地 Runtime。
- 创建真实 Session 和 Run。
- 订阅真实 OAEP SSE。
- 执行正常任务。
- 注入工具失败。
- 重启 Runtime 验证恢复。
- 验证错误上下文、调用栈和源码位置。

### 11.4 UI 验收

- Agent 启动后 1 秒内显示状态。
- 等待模型时明确显示等待对象和等待时长。
- 一屏内看清当前阶段和当前动作。
- Agent 错误一屏内看到原因、阶段和代码位置。
- App 错误不会出现在 Agent 时间线。
- 运行日志在窄侧栏保持一行一个事件。
- 点击日志后显示完整协议数据。
- 1000 条日志下滚动和筛选保持可用。

### 11.5 隐私与可靠性验收

- Token、Authorization、Cookie、API Key 和密码脱敏。
- 诊断失败不能中断产品主流程。
- 清空诊断不会影响会话数据。
- 诊断导出内容经过二次脱敏检查。
- 重启后持久化记录可恢复且不会重复。

## 12. 迁移策略

- DiagnosticEvent 新字段全部为可选字段。
- 旧事件在读取时通过分类器补充领域和可见性。
- 旧 Trace、Root Cause、Interactive Debug 和 Governance 组件暂不删除。
- 新界面稳定前，高级诊断直接复用旧组件。
- Main Diagnostics 完成收敛后，再删除 Renderer 的重复事实写入逻辑。
- 所有清理必须在新旧路径对照测试通过后进行。

## 13. 风险与控制

| 风险 | 控制措施 |
| --- | --- |
| Agent 阶段映射不准确 | 使用明确映射表，并保留原始事件作为证据 |
| 流式事件数量过大 | delta 合并、节流和 visibility 分级 |
| 旧事件缺少分类字段 | 读取时兼容推断 |
| 错误聚合误合并 | 指纹包含领域、组件、操作、错误码和首个源码位置 |
| 高级能力迁移后难以发现 | 提供固定的高级诊断入口和错误页跳转 |
| 诊断数据泄露敏感信息 | Main 侧脱敏、Renderer 再检查、导出前二次扫描 |
| 状态投影影响主流程 | 投影器只读、失败隔离、不得阻塞 Agent 执行 |

## 14. 完成定义

本阶段只有在以下条件全部满足时完成：

1. 默认调试栏仅保留 Agent、App 错误和运行日志三个一级页面。
2. Agent 运行时可以实时看到阶段、动作、Backend、模型和耗时。
3. Agent 失败后可以看到错误、阶段、调用栈、源码和上下文。
4. App 错误与 Agent 错误完全分离。
5. 相同错误自动合并，不重复刷屏。
6. OAEP 底层字段默认折叠，展开后完整可查。
7. Main Diagnostics 成为唯一持久化诊断事实来源。
8. 旧诊断记录和高级诊断能力仍然可用。
9. 自动化、真实 Runtime、沙盒失败和 UI 验收全部通过。
10. 构建、类型检查和发布诊断门禁通过。

## 15. 方案统计

- 核心需求域：2 个。
- 默认一级页面：3 个。
- 高级诊断入口：1 个。
- 开发模块：8 个。
- 功能点：43 个。
- 实施阶段：5 个。
- 测试类别：5 类。
- 完成条件：10 项。
