# OpenDrSai Android P9：Desktop Full Agent Runtime 能力对等开发与测试方案

> 阶段编号：Android P9（第 9 阶段）  
> 阶段名称：Desktop Full Agent Runtime Kernel 统一与 Android 能力对等  
> 文档状态：待评审、待实施  
> 制定日期：2026-08-05  
> 开发基线：Android v1.5.6 Debug（`ai.drsai.remote.debug`，versionCode 10506）  
> 候选版本：由 P9 S0 评审冻结；P9 是阶段号，不复用或擅自变更既有 v1.6.0 试验版本  
> 前置阶段：P8 Android Agent Runtime OAEP 化、v1.5.6 Full Runtime 默认绑定  

## 1. 阶段结论

本方案确认下一阶段为 **Android P9**。

P8 和 v1.5.6 已完成 Python `:runtime` 进程、模型/工具循环、审批、恢复及 OAEP 生命周期，但当前 Android 实际实例化的是精简的 `MobileAgentCore`，并未实例化 Desktop 使用的完整 `DrSaiAssistant`/Agent Kernel。当前“Full Runtime”证明的是移动端 Python/OAEP 执行链完整，不代表 Desktop 智能体功能已经对等。

P9 的唯一总方向是：

> **Desktop、TUI 与 Android 从同一份生产 Agent Kernel 创建 Agent；Prompt、Context、Memory、Tool Policy、Skill、Subagent、模型工具循环和 OAEP 语义共享；平台差异只允许存在于经过能力协商的 Host Adapter。**

P9 完成后，“Android Full Agent Runtime”必须是可由代码路径、能力清单、自然任务 E2E 和跨端行为差异报告共同证明的事实，不能再由 APK 大小、Python 进程存在、人工强制工具调用或 UI 标签推断。

## 2. 当前基线与问题定义

### 2.1 已完成基础

1. Debug APK 默认绑定非导出的独立 `:runtime` Python Service；
2. 本地生产路由已移除纯 Kotlin Lite Agent Loop 和静默回退；
3. Kotlin Host 已具备 Model、Tool、Approval、Artifact、Lifecycle、Checkpoint Port；
4. Tool call、恢复、副作用 receipt、审批和 OAEP Journal/Snapshot 已有基础；
5. 智增增 `deepseek-v4-flash` 已证明兼容 OpenAI-style function calling；
6. Android 已有时间、私有记忆、安全设备信息和 SAF 工作区工具；
7. P8/v1.5.6 已形成构建、模拟器、真机、安全、性能和跨端 OAEP 证据框架。

### 2.2 已确认的核心缺口

1. Android APK 只打包 `drsai/backend/runtime` 子树，未加载 Desktop 实际使用的完整 Agent 实现；
2. `MobileAgentCore` 与 `DrSaiAssistant` 是两套不同执行内核；现有 Desktop parity fixture 只比较 `DesktopMobileCoreAdapter` 测试适配器，不比较 Desktop 生产 Agent；
3. `DEFAULT_AGENT.systemPrompt` 没有注入 Android Full Runtime 模型请求；
4. Core 产生的 `skills` 在 Kotlin `HostModelRequest` 边界被丢弃，当前 Skill 主要是 UI/诊断元数据；
5. Android 没有 `web.search`、`web.fetch`、浏览器、MCP 或 Connector 检索能力；
6. `tool_choice=auto` 缺少“最新、陌生、专有名词、可验证事实必须检索”的策略；
7. 当前真实模型验收使用 `acceptance_tool_1..5` 和强制提示，只证明协议兼容，不证明自然任务会选择生产工具；
8. Android 子智能体是简化逻辑任务，不具备 Desktop 的上下文、工具约束、Skills 和可观测性；
9. ContextAssembler、项目指令、长期记忆、Token Budget 与 Desktop 实际实现未统一；
10. 当前 60/60 v1.5.6 账本没有证明 Desktop 功能对等，不得作为 P9 完成证据复用。

### 2.3 “能力对等”的定义

P9 的能力对等分为三类：

| 类型 | P9 要求 | 示例 |
|---|---|---|
| 内核语义完全共享 | Android 与 Desktop 必须执行同一生产代码 | Agent Loop、Prompt、Context、Memory、Tool Policy、Skill、Subagent、重试、终态 |
| 平台安全等价 | 工具名称和目标语义一致，宿主实现按平台变化 | Desktop 文件系统对应 Android SAF；Desktop 浏览器对应 Android 受控浏览器/HTTP Host |
| 显式远程委派 | Android OS 无法安全本地实现时，能力必须显示为 remote-required | PowerShell、PTY、Docker、Desktop Git Worktree、Codex CLI、stdio MCP |

“能力对等”不意味着在 Android 上伪造 Windows、PowerShell 或任意 Shell。模型只能看到当前运行位置真实可执行的 schema；不可用能力必须在规划前被标记为 `remote-required` 或 `unsupported`，不得调用后才静默失败。

## 3. 总体目标

### 3.1 产品目标

1. Android 默认本地 Agent 与 Desktop 使用同一个生产 Agent Kernel；
2. 用户提出知识、文件、规划、检索、分析和多步骤任务时，Android 能自主选择真实工具并完成多轮闭环；
3. 对最新事件、陌生专有名词和可验证外部事实，Agent 必须检索、引用来源或明确说明无法检索；
4. Skills、Memory、Subagent、MCP/Connector、Artifact 和 Approval 在 Android 上具有真实执行语义；
5. Android 与 Desktop 对同一能力集、模型、Prompt 和 fixture 产生语义等价的计划、工具选择与 OAEP 结果；
6. 平台差异对用户、模型、诊断和验收均可见；
7. 不以牺牲 Android 权限、网络、文件、后台或供应链安全换取“功能完整”。

### 3.2 工程目标

1. 建立独立、依赖可裁剪的 `drsai-agent-kernel`；
2. Desktop 生产 Runtime 和 Android `:runtime` 同时从该 Kernel 工厂创建 Agent；
3. `MobileAgentCore` 退化为协议/兼容适配层，移除其独立 Agent 决策逻辑；
4. 建立统一 Prompt/Context/Skill/Tool 描述和能力协商契约；
5. Android 通过 Kotlin Host Ports 提供网络、SAF、审批、Artifact、生命周期和安全存储；
6. 建立 Production Desktop vs Production Android 行为对等测试，而不是 Adapter vs Adapter 自证；
7. 形成可追溯的 72 项功能账本和 Go/No-Go。

### 3.3 非目标

1. 不在手机本地运行大语言模型；
2. 不向 Python 或模型暴露 Android Keystore Token、Room 文件、任意 `content://` URI 或绝对路径；
3. 不在 Android 开放任意 Shell、root、PowerShell、PTY、Docker 或动态下载代码；
4. 不把 Desktop 专属工具注册成会在 Android 本地失败的假工具；
5. 不用 WebView 任意 JavaScript 桥绕过 Tool Registry、Approval 或域名策略；
6. 不以 Remote Runtime 替代本地能力而不告知用户；
7. 不把模型“直接回答碰巧正确”视为检索能力通过；
8. 不使用只含一个工具、并明确命令模型必须调用的测试作为自然工具选择验收。

## 4. 目标架构

```text
Compose / Android OAEP Projection
        |
        v
FullRuntimeBinding + Android Runtime Client
        |
        v
non-exported :runtime process / Chaquopy
        |
        v
drsai-agent-kernel  <---------------- Desktop/TUI production adapters
  |-- Agent Loop / Turn policy
  |-- Prompt + Context + Token budget
  |-- Memory policy
  |-- Tool planning + result feedback
  |-- Skill loader + instruction injection
  |-- Subagent scheduler
  |-- Model compatibility policy
  `-- Normalized/OAEP semantic events
        |
        v
Capability Broker / Host Ports
  |-- ModelHostPort
  |-- ToolHostPort
  |-- WebHostPort
  |-- Workspace/ArtifactHostPort
  |-- SkillManifestHostPort
  |-- MCP/ConnectorHostPort
  |-- Approval/AuditHostPort
  |-- Memory/StateHostPort
  `-- Lifecycle/ResourceHostPort
        |
        v
Kotlin Android implementations
  OkHttp / Room / SAF / Keystore / WorkManager / WebView or Custom Tabs
```

### 4.1 强制不变量

1. Desktop、TUI、Android 生产入口只能通过同一个 `create_agent_kernel()` 创建 Agent；
2. Agent 决策代码中不得出现 `if surface == "android"` 的行为分叉；平台差异通过 Capability 描述；
3. System Prompt 必须是每次 Run 的第一层权威上下文，并在诊断中记录脱敏 digest；
4. 模型收到的 Tool schema 必须与当前 Host 可执行、权限可满足的工具集合一致；
5. Skill 必须包含版本、来源、指令、所需能力、允许工具和内容 digest；
6. 所有外部网络、文件写入、MCP 写操作和浏览器敏感操作必须经过策略与必要审批；
7. Tool、Subagent、Interaction、Artifact、Command/File Change 全部写入 OAEP；
8. 不支持的能力在规划前可见，不能发生静默纯聊天降级；
9. 对同一 Run 的重试、恢复和回放不得重复外部副作用；
10. P9 parity 必须比较真实 Desktop Agent 与真实 Android Agent。

## 5. 解决方案

### 5.1 Kernel 抽取与双端迁移

从 `DrSaiAssistant` 中抽取与桌面 OS、进程、文件路径、TUI/Gateway 无关的 Agent Kernel。Desktop 先接入新 Kernel 并保持行为兼容，Android 再以相同工厂和同一配置装配。现有 `MobileAgentCore` 中的模型/工具/子智能体决策逐步删除，只保留 IPC envelope、恢复兼容和旧 checkpoint 迁移。

### 5.2 统一 Prompt、Context 与 Tool Policy

建立分层 Prompt：System → Safety/Tool Policy → Agent Profile → Skill → Project → Memory Summary → Conversation。Prompt 组装在共享 Kernel 完成；Android Host 仅提供经过授权的 Project、Memory 和 Capability 数据。对时效性、陌生实体、引用请求和高风险答案增加确定性检索策略。

### 5.3 Android Host 能力补齐

通过受控 Host Port 增加 Web 搜索/读取、受控浏览、SAF 工作区、Artifact、沙箱计算、MCP HTTP/Connector、系统分享等能力。Android 无法安全等价的 Desktop 工具通过 OAEP Handoff 明确委派给已绑定 Remote Runtime。

### 5.4 Skills 与 Subagents 实体化

Skill 不再只是名称清单；Kernel 读取签名 Manifest 和指令内容，按能力筛选并注入 Prompt。Subagent 使用同一 Kernel 的受限 Session，继承必要上下文、获得显式工具白名单，并通过 OAEP Subtask 展示生命周期和结果。

### 5.5 真实行为验收

验收从“schema 存在、接口返回 200”提升为“自然问题触发正确生产工具并得到有来源结果”。测试固定模型、温度、Prompt digest、Tool catalog digest、网络 fixture 和期望行为；对真实模型使用统计门禁而不是单次碰运气。

## 6. 模块增、改、删清单

### 6.1 新增模块

| 模块 | 目的 |
|---|---|
| `cores/python/packages/drsai_agent_kernel/`（最终路径在 S0 冻结） | 平台无关的生产 Agent Kernel |
| `agent_kernel/prompt/` | Prompt 分层、策略和 digest |
| `agent_kernel/context/` | Context、Token Budget、Memory/Project 装配 |
| `agent_kernel/capabilities/` | Tool/Skill/Host 能力协商 |
| `agent_kernel/subagents/` | 统一 Subagent 调度与限制 |
| Android `runtime/web/` | Web 搜索、读取、引用和网络安全 Host |
| Android `runtime/mcp/` | Streamable HTTP/SSE MCP 与 Connector Host |
| Android `runtime/sandbox/` | 无网络、无任意文件的受限计算 Host |
| `tests/agent-parity/` | 真实 Desktop/Android 行为对等 fixture 与 runner |
| `docs/android/reports/evidence/p9/` | P9 唯一验收证据目录 |

### 6.2 更新模块

| 模块 | 更新内容 |
|---|---|
| `run_drsai_agent_factory.py` | 改为装配共享 Kernel，不再承载核心行为 |
| `DrSaiAssistant` | 保留 Desktop Adapter；通用决策下沉 Kernel |
| `PythonSharedCoreChatEngine.kt` | 传入完整 AgentRunConfig、Prompt/Capability/Skill digest |
| `PythonRuntimeHostPorts.kt` | 增加 Skill、Web、MCP、Memory、Sandbox、Handoff Port |
| `PythonAgentLoopCoordinator.kt` | 不再丢弃 Skills；支持统一 Kernel 请求和结构化响应 |
| `HaiModelClient.kt` | 模型能力探测、tool policy、并行调用、结构化错误和使用量 |
| `ToolRegistry.kt` | 统一命名、版本、风险、来源、能力和 OAEP 输出类型 |
| `SkillCatalog.kt` | 从元数据目录升级为版本化 Manifest/Instruction Registry |
| `ContextAssembler.kt` | 与 Kernel 统一上下文层级、预算和摘要协议 |
| `AppViewModel.kt` | 删除 Agent 决策；只负责命令、OAEP Projection 和 UI action |
| OAEP Writer/Projection/UI | 增加 Web citation、MCP、Handoff、Subtask 和 Capability Notice |
| 构建与 SBOM | 打包移动依赖锁、Kernel digest、Skill digest 和许可证 |

### 6.3 移除或退役模块

| 模块/行为 | 退役要求 |
|---|---|
| `MobileAgentCore` 独立 Agent Loop | 迁移后只保留协议兼容层，最终删除独立决策代码 |
| `FullRuntimeToolCatalog` 手工 Core Tool 副本 | Tool schema 改由共享 Kernel + Host Registry 生成 |
| `DEFAULT_AGENT.systemPrompt` 旁路定义 | Prompt 移入共享版本化 Prompt Registry |
| 只展示不执行的 Skill 路径 | 未接入 Kernel 的 Skill 不得显示为 available |
| `DesktopMobileCoreAdapter` 自证 parity | 不再作为生产 parity 通过条件 |
| `acceptance_tool_1..5` 发布门禁 | 可保留为协议冒烟，但不得计入功能对等验收 |
| 静默 direct-answer 降级 | 需要检索但无能力时必须产生明确 Capability Notice |
| 重复 Tool schema/风险定义 | 收敛到唯一 Tool Registry/Manifest |

## 7. 功能模块、测试与验收

P9 共 **12 个模块、72 个功能点**。每个功能点必须同时具有实现、自动化测试和可追溯证据；仅代码存在或 UI 可见不算完成。

### M01 生产 Agent Kernel 与对等契约（6）

| 编号 | 功能点 | 测试方案 | 验收标准 |
|---|---|---|---|
| M01-F01 | 建立 Desktop Full Agent Runtime 能力清单和版本化 parity manifest | 从 Desktop 生产 Agent 枚举 Prompt、Tool、Skill、Subagent、Memory、Model 行为并生成 JSON | manifest 有稳定 schema/digest；所有能力有 `shared/local-equivalent/remote-required/unsupported` 分类 |
| M01-F02 | 抽取 `drsai-agent-kernel` 单一生产工厂 | Python 单测分别从 Desktop、TUI、Android Adapter 调用工厂 | 三端 Agent 类型和 Kernel digest 相同；不存在第二个生产 Agent Loop |
| M01-F03 | 建立 Kernel Host Port 协议 | 契约测试注入完整、缺失、旧版和未知能力 | 兼容版本可运行；未知必需能力 fail closed；错误结构稳定 |
| M01-F04 | Desktop 生产入口迁移到共享 Kernel | Desktop 全量 Agent 回归和 golden task | 既有 Desktop 核心任务无 P0/P1 回归；生产日志证明实际 Kernel 工厂被调用 |
| M01-F05 | Android `:runtime` 迁移到共享 Kernel | 真机启动并导出脱敏 runtime identity | identity 包含同一 Kernel digest、Prompt schema、Tool manifest version |
| M01-F06 | 建立真实生产双端 parity runner | 同一模型、Prompt、capability fixture 分别运行 Desktop 与 Android | 比较的入口是双方生产 Agent；计划、工具意图、终态和 OAEP 语义满足规范化等价 |

### M02 Prompt、策略与上下文装配（6）

| 编号 | 功能点 | 测试方案 | 验收标准 |
|---|---|---|---|
| M02-F01 | 版本化 System Prompt 注入 | 捕获脱敏模型请求并检查首条消息和 digest | 每个 Run 都有 System Prompt；Android 与 Desktop 同版本同 digest |
| M02-F02 | 建立 Tool/Verification Policy | 使用最新事件、陌生实体、算术、已知常识和主观问题 fixture | 需验证问题触发检索；简单稳定问题不被强制滥用工具 |
| M02-F03 | 分层 Agent/Skill/Project/Memory Prompt | 单测随机组合层级、优先级和冲突指令 | 顺序确定；低优先级不能覆盖安全/System 层；来源可诊断 |
| M02-F04 | 接入项目指令和 SAF 指令文件 | 授权/未授权、文件变化、恶意指令测试 | 仅授权文件进入上下文；digest 变化可见；越权读取为 0 |
| M02-F05 | 统一 Token Budget、裁剪与摘要 | 长对话、长工具输出、Unicode、多模态压力测试 | 不超过模型上下文；最近用户意图、系统策略和活动工具链不丢失 |
| M02-F06 | Prompt/Context 可观测性 | 应用内导出脱敏层级、token 估算和 digest | 不含正文/Token/绝对路径；可证明每层是否生效及被裁剪原因 |

### M03 Memory、会话与知识状态（6）

| 编号 | 功能点 | 测试方案 | 验收标准 |
|---|---|---|---|
| M03-F01 | 统一短期会话上下文 | 多轮 tool call、恢复、应用重启测试 | assistant/tool 消息顺序合法；恢复前后模型上下文语义一致 |
| M03-F02 | 统一长期记忆策略 | 保存、搜索、冲突、删除和账户切换测试 | 记忆按 subject 隔离；未经策略/用户意图不保存敏感信息 |
| M03-F03 | Memory 选择与注入 | 相关/无关/对抗记忆数据集 | 相关召回达到冻结阈值；无关记忆不污染回答；来源可追踪 |
| M03-F04 | 会话摘要与压缩 | 100/500 轮对话和中途崩溃测试 | 摘要幂等；关键约束、未完成计划和 Tool receipt 不丢失 |
| M03-F05 | Desktop/Android Memory 语义对等 | 相同 Memory fixture 双端运行 | 规范化选中集合、优先级和最终上下文一致 |
| M03-F06 | 数据迁移与删除闭环 | v1.5.5/v1.5.6 数据升级、退出登录和清除数据测试 | 历史可读；重复迁移幂等；删除后不可被 Agent 再召回 |

### M04 统一 Tool Registry 与执行闭环（6）

| 编号 | 功能点 | 测试方案 | 验收标准 |
|---|---|---|---|
| M04-F01 | Tool 定义收敛到唯一 Registry | schema drift、重复名称、版本冲突测试 | 模型 schema、执行器、审批和 UI 来源一致；单边修改 CI 失败 |
| M04-F02 | 统一 Tool 能力与风险模型 | 对每种 capability/risk 组合做属性测试 | 不可执行工具在请求前过滤；写/敏感/外部副作用按策略审批 |
| M04-F03 | 多轮与并行 Tool Calling | 单调用、连续调用、允许并行、禁止混合审批测试 | 结果正确回填；call_id 稳定；不越过最大步数和并发限制 |
| M04-F04 | Tool 错误、重试和取消 | 400/401/408/429/5xx、超时、用户取消测试 | 只重试可重试错误；副作用不重复；错误对用户可操作 |
| M04-F05 | Tool 输出、Artifact 与 OAEP 映射 | 大输出、二进制、截断、Command/File Change 测试 | 完整结果进入受控 Artifact；UI 有摘要；OAEP 类型和状态完整 |
| M04-F06 | 自然任务工具选择 | 固定 30 类真实任务，不显式告诉模型工具名 | 每类达到冻结成功率；错误选工具、漏调用和无意义调用均计失败 |

### M05 Web 搜索、网页读取与受控浏览（6）

| 编号 | 功能点 | 测试方案 | 验收标准 |
|---|---|---|---|
| M05-F01 | 实现 `web.search` Host Tool | 本地搜索 fixture、真实搜索 provider、中文/英文查询 | 返回标题、URL、摘要、时间和 provider；超时/无结果结构化处理 |
| M05-F02 | 实现 `web.fetch` 与正文提取 | HTML、重定向、编码、超大页、PDF、robots/拒绝测试 | 有界正文和元数据可用；不执行页面脚本；下载大小/时间受限 |
| M05-F03 | 建立引用与证据链 | 回答 HEPiX 2026、最新版本、指定网页等任务 | 外部事实带可点击来源；引用 URL 与工具结果一致；禁止伪造引用 |
| M05-F04 | 时效性/陌生实体强制检索 | “HEPiX 2026 是什么”等自然问题批量回归 | 首轮产生 `web.search` 或明确澄清；不得无工具直接编造答案 |
| M05-F05 | 受控浏览器会话 | 导航、读取、表单、下载、登录态和敏感操作测试 | 只读操作按策略执行；登录/提交/下载等动作需要明确权限或审批 |
| M05-F06 | 网络与浏览安全 | SSRF、localhost、私网 IP、DNS rebinding、恶意重定向、巨型响应测试 | 私网/本机/禁用协议全部阻断；域名、流量、时间和内容类型门禁通过 |

### M06 Workspace、Artifact 与受限计算（6）

| 编号 | 功能点 | 测试方案 | 验收标准 |
|---|---|---|---|
| M06-F01 | Desktop File Tool 与 Android SAF 语义映射 | list/read/search/write/edit/glob fixture 双端比较 | 公共语义一致；Android 只访问用户授权树；相对路径稳定 |
| M06-F02 | 文件编辑与 Diff/Approval | 新建、覆盖、局部编辑、冲突、撤销测试 | 写前展示目标和 diff；审批后恰好一次；OAEP File Change 完整 |
| M06-F03 | Artifact 读写、预览与分享 | 文本、图片、PDF、大文件、进程恢复测试 | Artifact digest、MIME、大小正确；分享使用受控 URI；无内部路径泄露 |
| M06-F04 | 受限 Python/数据计算工具 | CPU、内存、超时、导入、文件和网络逃逸测试 | 仅允许白名单库/数据；无网络、无任意文件；超限确定性终止 |
| M06-F05 | Desktop 专属命令能力 Handoff | PowerShell/Git/PTY/Codex 请求在有/无 Remote Runtime 下测试 | 有 Runtime 时生成用户可见 Handoff；无 Runtime 时明确说明，不伪造执行 |
| M06-F06 | 工作区自然任务 E2E | “查找并修改授权目录中的配置”等自然任务 | Agent 自主 list/search/read/edit；审批、diff、结果和恢复完整通过 |

### M07 Skills、MCP 与 Connector（6）

| 编号 | 功能点 | 测试方案 | 验收标准 |
|---|---|---|---|
| M07-F01 | 版本化 Skill Manifest 与指令加载 | 合法、缺字段、篡改、重复、能力不足测试 | Skill 有 id/version/source/digest/instructions/tools；非法 Skill 拒绝 |
| M07-F02 | Skill 选择、Prompt 注入和 Tool 限制 | 任务匹配、冲突 Skill、越权指令测试 | 只注入匹配 Skill；工具白名单生效；System/Safety 不可被覆盖 |
| M07-F03 | 内置和用户声明式 Skill | APK 内置、SAF 用户 Skill、升级/删除测试 | 内置内容随 APK 签名；用户 Skill 不执行动态代码且需显式启用 |
| M07-F04 | Android Streamable HTTP/SSE MCP | tools/list、tools/call、断线、鉴权、版本错误测试 | 可发现并调用兼容 MCP；Token 只在 Kotlin 安全层；结果写 OAEP |
| M07-F05 | stdio/桌面 MCP 显式 Handoff | 同名 HTTP/stdio MCP、远程 Runtime 在线/离线测试 | Android 不伪装 stdio 支持；可委派时位置与审批清晰可见 |
| M07-F06 | Connector 生命周期 | 授权、撤销、过期、最小 scope、跨账户测试 | 凭据不进入 Python/OAEP；撤销立即生效；跨账户数据访问为 0 |

### M08 Planning、Subagent 与长任务（6）

| 编号 | 功能点 | 测试方案 | 验收标准 |
|---|---|---|---|
| M08-F01 | 统一 Plan 状态机 | 创建、更新、完成、失败、恢复和并发更新测试 | Plan Item 单一、步骤状态合法、重放结果一致 |
| M08-F02 | Subagent 使用同一 Kernel | Desktop/Android 启动相同只读 explore/general task | 子 Agent Kernel digest 相同；继承受控上下文和工具白名单 |
| M08-F03 | Subagent 调度、并发与资源降级 | 前台/后台、低内存、热限制、取消测试 | 前台并发不超 2；资源受限时串行/暂停；无孤儿任务 |
| M08-F04 | Subagent 结果和 OAEP Subtask | 成功、部分成功、超时、失败、父任务取消测试 | 层级、状态、摘要和来源完整；失败不会伪造成主任务成功 |
| M08-F05 | 长任务后台与通知 | 锁屏、Doze、进程回收、通知继续/取消测试 | 符合 Android 后台限制；可恢复同一 Run；用户始终有可见控制入口 |
| M08-F06 | 多步骤自然任务 E2E | 检索→比较→读文件→生成 Artifact 的任务集 | Agent 能规划、调用多种工具、必要时委派并在最终答复引用结果 |

### M09 模型、Provider 与工具决策兼容（6）

| 编号 | 功能点 | 测试方案 | 验收标准 |
|---|---|---|---|
| M09-F01 | Provider/模型能力探测 | OpenAI、Anthropic、无工具、并行工具、reasoning 模型 fixture | 能力来自探测/配置并可诊断；不支持时在 Run 前明确阻断 |
| M09-F02 | Tool schema 格式适配 | OpenAI/Anthropic schema、Unicode、enum、嵌套对象测试 | 转换无语义丢失；服务商拒绝时返回稳定兼容错误 |
| M09-F03 | Tool Choice Policy | `auto/required/none` 和指定工具测试 | Kernel 可按任务策略选择；普通请求不被全局强制 required |
| M09-F04 | 流式 tool call 组装 | 分片 id/name/arguments、交错 delta、多调用测试 | JSON 精确重组；缺失/重复/非法分片 fail closed |
| M09-F05 | 模型切换与 Run 固定 | 会话中改默认模型、恢复、Provider 删除测试 | 活动 Run 固定原模型配置；恢复不静默切换；凭据缺失明确失败 |
| M09-F06 | 真实模型统计门禁 | `deepseek-v4-flash/pro` 等候选模型运行自然任务集多次 | 工具选择、参数正确率和最终任务成功率达到 S0 冻结阈值；报告原始计数 |

### M10 OAEP、UI 与诊断真实性（6）

| 编号 | 功能点 | 测试方案 | 验收标准 |
|---|---|---|---|
| M10-F01 | 新能力完整映射 OAEP | Web、Citation、MCP、Skill、Handoff、Subagent fixture | 每种能力有 Item/Event 映射；无私有事件旁路和静默丢弃 |
| M10-F02 | UI 展示工具与来源 | Compose UI 测试和截图比对 | 用户能看到正在搜索/读取/委派、来源链接、失败和执行位置 |
| M10-F03 | Runtime/Kernel 身份诊断 | 启动、升级、恢复、双进程测试 | 显示 Kernel digest、Prompt/Tool/Skill version、进程和 binding state |
| M10-F04 | 每 Run 能力快照 | 权限、SAF、网络、Remote Runtime 变化测试 | Run 固定 capability snapshot；诊断显示 available/remote-required/blocked |
| M10-F05 | Tool 决策诊断 | 需要工具、无需工具、缺少工具三类任务 | 记录脱敏 decision category 和原因；不记录原始思维链或敏感正文 |
| M10-F06 | 禁止虚假 Full 标签 | 静态扫描和运行时门禁 | Kernel/Prompt/Tool parity 未通过时 UI 显示 Preview/Incomplete，不得显示 Desktop Parity |

### M11 安全、可靠性、资源与迁移（6）

| 编号 | 功能点 | 测试方案 | 验收标准 |
|---|---|---|---|
| M11-F01 | 网络、文件、MCP、浏览统一安全策略 | 权限矩阵、对抗输入、跨账户和越权 fuzz | 未授权访问、秘密泄露、SSRF、路径逃逸和无审批写操作均为 0 |
| M11-F02 | 副作用恰好一次和恢复 | 在 intent/approval/execution/receipt/OAEP 各窗口杀进程 | 每个副作用最多一次；不可判定进入 reconciliation；无永久 running |
| M11-F03 | 依赖、SBOM 与供应链 | Python/Android/Maven/Skill 依赖扫描和 hash 校验 | 无动态 pip/可执行下载；高危漏洞 0 或有批准豁免；SBOM 完整 |
| M11-F04 | 性能和资源预算 | API 26/30/35/36、arm64/x86_64、低内存/热限制压力 | 冷启动、PSS、耗电、网络和存储达到 S0 冻结预算；ANR 0 |
| M11-F05 | v1.5.6 checkpoint/数据迁移 | 历史会话、活动 Run、Skill/Tool receipt 升级回滚测试 | 已完成数据可读；可恢复 Run 接回同一 ID；不兼容状态明确终结 |
| M11-F06 | Kill switch 与安全降级 | 分别禁用 Web、MCP、Sandbox、Kernel 和 Remote Handoff | 只缩小能力；不退回 Kotlin Lite、不静默纯聊天、不破坏 OAEP 数据 |

### M12 自动验收、发布证据与旧架构退场（6）

| 编号 | 功能点 | 测试方案 | 验收标准 |
|---|---|---|---|
| M12-F01 | 建立 72 项机器可读账本 | 校验缺项、重复、假证据、过期 hash 和不同 run ID | 每项绑定测试和证据；任一缺失时总进度不得为 100% |
| M12-F02 | 生产双端行为 parity 套件 | Desktop 生产 Agent 与 Android 真机运行相同确定性 fixture | Kernel/Prompt/Tool/Skill digest 一致；规范化行为满足冻结阈值 |
| M12-F03 | 自然任务黄金集 | HEPiX、最新信息、工作区编辑、Skill、MCP、Subagent 等端到端测试 | 不含强制工具名提示；工具、来源、终态和用户可见结果全部正确 |
| M12-F04 | 模拟器与真机矩阵 | API 26/30/35/36，至少一台 arm64 真机完整回归 | JVM、Python、instrumentation、UI、安全、恢复、性能全绿 |
| M12-F05 | 删除旧决策路径与假 parity | 静态引用门禁、APK 内容检查、故障注入 | `MobileAgentCore` 无独立决策入口；临时 acceptance tools 不计发布分数 |
| M12-F06 | 最终 Go/No-Go | 从干净 checkout 构建候选并执行全部验收 | 72/72、自然任务、真实双端 parity、真机、安全、性能、迁移全部通过才为 GO |

## 8. 分阶段实施顺序

| 里程碑 | 范围 | 主要出口条件 |
|---|---|---|
| S0 基线与版本冻结 | M01-F01、当前 Desktop/Android golden、候选版本和预算 | 能力 manifest、P8 缺口、唯一 commit/APK/模型配置可复现 |
| S1 Kernel 抽取 | M01、M02 的工厂、Prompt 和 Host 契约 | Desktop 生产入口切换且无 P0/P1 回归 |
| S2 Android Kernel 接线 | M02、M03、M04、M09 | 真机运行共享 Kernel；System Prompt、Skills 和 Tool Policy 不再丢失 |
| S3 核心能力补齐 | M05、M06 | Web、引用、SAF、Artifact、Sandbox/Handoff 自然任务通过 |
| S4 扩展与多智能体 | M07、M08 | Skill、MCP、Connector、Subagent 和长任务闭环 |
| S5 OAEP 与产品真实性 | M10、M11 | 所有新能力可重放、可诊断、可恢复且安全门禁通过 |
| S6 退场与发布验收 | M12 | 旧 Agent 决策路径删除；72/72；最终 GO |

依赖关系：S1 是所有后续工作的硬前置；在 Desktop 生产入口尚未迁移到共享 Kernel 前，不允许用 Android Adapter fixture 宣布 parity。S3/S4 可部分并行，但必须在 S5 前收敛到统一 Tool/Skill/OAEP 契约。

## 9. 重点端到端验收场景

### 9.1 HEPiX 2026 检索场景

用户输入：`Hepix2026 是什么？`

预期序列：

1. Kernel 将其分类为陌生/时效性外部实体；
2. 产生 `web.search`，而不是直接凭模型记忆回答；
3. 搜索结果不足以区分春季/秋季时，继续 `web.fetch` 或向用户澄清；
4. 最终答案说明 HEPiX、2026 春秋会议，并附真实来源；
5. OAEP 中存在 Web Tool Item、Citation/Message Item 和合法终态；
6. Web 能力不可用时产生 Capability Notice，明确无法实时核验，不得编造。

通过标准：固定 fixture 100% 通过；真实候选模型按 M09-F06 的统计阈值通过；任何无工具直接编造均计失败。

### 9.2 工作区修改场景

用户输入：`在我授权的项目中找到默认 API 地址，改成测试地址并说明修改。`

预期：自主调用 workspace search/read/edit，展示 diff，写入前审批，写入后 Artifact/File Change 可查询；进程在写入前后被杀均不重复写。

### 9.3 Skill + MCP 场景

用户启用一个声明式研究 Skill，并配置只读 HTTP MCP。Agent 必须选择 Skill、遵守工具白名单、调用 MCP、引用结果；撤销 Connector 后下一 Run 不得继续使用缓存凭据。

### 9.4 Desktop 专属能力场景

用户要求运行 PowerShell 或 Codex CLI。Android 不得伪造本地执行；已绑定 Desktop Runtime 时显示 Handoff 目标和审批并远程执行，未绑定时给出明确能力缺失及绑定入口。

### 9.5 多智能体长任务场景

用户要求检索三个来源、比较方案并生成报告。主 Agent 建立 Plan，最多并发两个只读 Subagent，汇总来源，生成 Artifact；后台/进程回收后恢复同一 Run。

## 10. 测试体系

### 10.1 自动化层级

1. Python Kernel 单元、属性和状态机测试；
2. Desktop 生产 Agent golden regression；
3. Kotlin JVM Host Registry、策略、Codec 和安全测试；
4. Python/Kotlin Bridge 契约与错误注入；
5. Android instrumentation、Compose UI 和进程级测试；
6. 受控 Web/MCP/Provider fixture 服务；
7. 真实 Provider 统计测试；
8. Desktop production vs Android production parity E2E；
9. API/ABI/真机矩阵；
10. 安全、性能、迁移、回滚和供应链门禁。

### 10.2 确定性与真实模型测试分工

- 确定性 fixture 用于协议、状态机、工具参数、OAEP、恢复和安全，必须 100% 通过；
- 真实模型用于自然工具选择和任务成功率，必须记录模型、provider、Prompt digest、Tool digest、温度、重复次数和原始成功计数；
- 真实模型门禁不得只运行一次；不得把强制调用唯一工具的测试计入自然选择成功率；
- Provider 网络失败与模型行为失败分开统计，避免用重试掩盖错误工具决策。

### 10.3 证据身份

所有 P9 证据必须绑定：

- `acceptance_run_id`；
- Git commit 与 dirty 状态；
- Android APK/Test APK SHA-256；
- Desktop Runtime build/kernel digest；
- applicationId、versionName、versionCode、variant；
- OAEP Schema、Prompt、Tool、Skill、Capability manifest digest；
- Provider/model/upstream ID 和非敏感参数；
- 设备 API/ABI、脱敏设备 ID；
- UTC 时间窗和各子报告 hash。

## 11. 发布硬门禁

出现以下任一情况，P9 必须判定 `NO-GO`：

1. 72 个功能点任一缺少代码、自动化测试或证据；
2. Android 和 Desktop 未从同一生产 Agent Kernel 工厂创建；
3. Android 模型请求缺少 System Prompt，或 Skill 在 Host 边界丢失；
4. “HEPiX 2026”一类时效性任务在可检索时无工具直接回答；
5. Web 结果无来源、引用伪造或 URL 与工具结果不一致；
6. 模型看到 Host 实际不可执行的工具；
7. 未授权网络、SSRF、路径逃逸、跨账户读取或秘密泄露非 0；
8. 外部副作用重复、审批绕过或出现永久 running；
9. Skills/MCP 仅有 UI 元数据而没有实际 Kernel 执行；
10. Subagent 使用不同简化 Agent Loop 或绕过工具权限；
11. parity runner 比较的是测试 Adapter 而非生产 Desktop/Android Agent；
12. 使用 `acceptance_tool_1..5` 冒烟结果替代自然任务验收；
13. Runtime 失败后静默回退 Kotlin Lite 或未标记纯聊天；
14. 性能、设备、迁移、安全、SBOM 或真机矩阵未通过；
15. UI 宣称 Desktop Parity，但 capability manifest 或行为门禁未通过。

## 12. 交付物

1. 本 P9 开发方案及评审记录；
2. Desktop Full Runtime versioned capability manifest；
3. `drsai-agent-kernel` 源码、版本和移动依赖锁；
4. Desktop/TUI/Android 生产 Adapter；
5. Android Web、Workspace、Sandbox、Skill、MCP、Connector、Handoff Host；
6. Prompt/Tool/Skill/Capability manifest 与 digest；
7. P9 自然任务黄金集和真实双端 parity runner；
8. 72 项机器可读验收账本；
9. 模拟器、真机、安全、性能、恢复、迁移、供应链报告；
10. 候选 APK、Desktop Runtime build、SBOM、release manifest；
11. 旧架构退场报告；
12. 最终 Go/No-Go 报告。

## 13. 完成定义

只有同时满足以下条件，才能宣布“Android 已实现 Desktop Full Agent Runtime”：

1. Android、Desktop、TUI 使用同一生产 Agent Kernel 源码、工厂和版本；
2. Prompt、Context、Memory、Tool Policy、Skill、Subagent 和模型循环共享；
3. Android 具备真实 Web 检索/读取、引用、SAF、Artifact、受限计算、MCP/Connector 能力；
4. Desktop 专属能力具有明确、安全、用户可见的 Remote Handoff；
5. 新能力全部进入 OAEP，支持审批、恢复、重放、诊断和跨端展示；
6. 自然问题能够自主选择正确生产工具，无法使用时明确说明；
7. 真实 Desktop/Android 生产行为 parity 达到冻结门槛；
8. 旧 `MobileAgentCore` 独立决策路径和虚假 parity 门禁完成退场；
9. 72/72 功能点、真机、安全、性能、迁移和供应链全部通过；
10. 最终证据与唯一 commit、APK、Desktop build、Kernel digest 和 acceptance run ID 强绑定。

P9 未达到上述条件前，产品文案只能使用“Android Full Runtime Preview”或准确能力状态，不得宣称已经与 Desktop Full Agent Runtime 完全对等。
