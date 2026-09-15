# Codex、Hermes 与主流智能体安全控制调研

> 调研日期：2026-08-16  
> 调研范围：OpenAI Codex、Nous Research Hermes Agent、Claude Code、Gemini CLI  
> 文档性质：外部产品与运行时机制研究，不代表 OpenDrSai 当前已经实现全部能力  
> 信息时效：智能体产品迭代较快，涉及默认模式、配置项和底层实现时，应以链接的一手文档为准

## 1. 结论摘要

智能体安全不能简化为“执行前是否弹出确认框”。一个完整的安全控制体系至少包含四层：

1. **模型策略层**：通过系统提示、工具描述和风险分类器约束模型想做什么。
2. **能力边界层**：通过操作系统沙箱、容器、目录权限、网络策略和低权限身份限制模型实际上能做什么。
3. **授权决策层**：由用户、规则引擎或独立审查模型决定哪些越界或高风险动作可以放行。
4. **审计恢复层**：通过结构化日志、Git diff、快照、checkpoint、幂等执行和回滚处理错误动作。

其中，真正能够对抗失控进程或恶意代码的安全边界主要来自第二层。提示词、危险命令匹配和模型审查适合降低误操作概率，但不能替代内核或容器强制执行的隔离。

主流产品正在收敛到类似的纵深防御模型：

- 默认最小权限；
- 文件、网络和外部副作用分开授权；
- 工作区内常规操作可自主完成；
- 越界或危险动作需要人工或独立审查；
- 不可信项目不能自动加载本地配置、钩子和环境变量；
- 无人值守场景默认 fail-closed；
- 完全访问只适合外层已有一次性容器、虚拟机或等价隔离的环境。

## 2. 威胁模型

### 2.1 智能体不是普通聊天模型

具有终端、文件系统、浏览器、MCP、云凭据或消息账号访问能力的智能体，是一个能够持续读取外部输入并代表用户产生副作用的执行主体。它面临的风险包括：

- 误解用户目标或错误估计命令副作用；
- 被仓库文件、网页、邮件、Issue、日志或工具结果中的提示注入影响；
- 把不可信数据误当作高优先级指令；
- 读取本地凭据并通过网络、DNS、浏览器或外部工具外泄；
- 修改自己的配置、规则、技能或持久记忆，影响后续会话；
- 反复改写被拒绝的命令以绕过简单字符串规则；
- 在批准与实际执行之间发生参数变化、重复执行或状态竞争；
- 对外发送消息、部署生产、修改权限或付款，造成不可逆影响。

### 2.2 Confused Deputy 问题

智能体典型地处在以下信任链中：

```text
用户身份与权限
      ↓
   智能体运行时  ←  不可信仓库、网页、消息、工具返回值
      ↓
文件 / 网络 / Git / 云平台 / 浏览器 / 消息系统
```

用户把权限交给了智能体，但影响智能体决策的内容不都来自用户。不可信内容可能诱导智能体使用用户权限完成用户并未真正授权的事情。这就是智能体安全必须同时区分“输入来源”“能力范围”“批准主体”和“副作用对象”的原因。

## 3. 通用安全控制模型

### 3.1 沙箱与批准是两个正交维度

应明确区分：

| 维度 | 核心问题 | 典型实现 |
| --- | --- | --- |
| 沙箱 / Permissions | 动作在技术上能否执行 | OS sandbox、容器、只读挂载、目录 allowlist、网络代理 |
| Approval Policy | 哪些动作需要停下来授权 | on-request、manual、规则匹配、风险标签 |
| Approval Reviewer | 谁来做授权判断 | 用户、管理员策略、独立 reviewer 模型 |
| Recovery | 已执行动作出错后怎么办 | Git、快照、事务、checkpoint、幂等键 |

即使设置“不询问”，仍可保留严格沙箱；反之，即使每个动作都询问，如果最终命令以当前用户身份直接运行在宿主机上，批准系统也不是可靠隔离边界。

### 3.2 文件读取、写入与联网需要分离控制

“只读”不天然等于安全。若一个智能体能够读取 SSH key、浏览器 Cookie、云凭据或客户数据，同时拥有任意出网能力，它无需修改任何文件就可以完成数据外泄。因此成熟实现通常分别控制：

- 可读取路径；
- 可写路径；
- 保护路径；
- 继承的环境变量；
- 网络目的域名和私网地址；
- Unix socket 或本机服务；
- 外部账号的读、写和破坏性动作。

### 3.3 人工批准也存在安全上限

高频确认会造成 approval fatigue，用户最终可能机械地批准所有请求。自动审查器的价值是把人工注意力保留给不可逆、跨边界和高影响操作。但自动审查仍是概率系统，应当叠加确定性的沙箱、deny 规则和组织策略，而不是取代它们。

## 4. Codex 安全控制

### 4.1 产品选项与底层参数

Codex 界面中的“请求批准”“帮我批准”“完全访问权限”是产品预设，不是底层唯一的三态变量。底层主要由以下参数组合：

```toml
approval_policy   = "untrusted" | "on-request" | "never" | { granular = { ... } }
approvals_reviewer = "user" | "auto_review"
sandbox_mode      = "read-only" | "workspace-write" | "danger-full-access"
```

OpenAI 官方文档把安全控制明确分成两层：沙箱决定命令在技术上能访问什么；批准策略决定什么时候暂停并请求授权。默认本地模式使用 OS 强制沙箱，工作区外写入和网络访问受到限制。[Agent approvals & security](https://learn.chatgpt.com/docs/agent-approvals-security)

三个产品预设可以概念性地理解为：

| 产品选项 | 典型组合 | 含义 |
| --- | --- | --- |
| 请求批准 | `on-request`/`untrusted` + `user` + 受限沙箱 | 越界动作由用户判断 |
| 帮我批准 | `on-request` + `auto_review` + 受限沙箱 | 原本需要批准的动作由 reviewer agent 先审查 |
| 完全访问 | `never` + `danger-full-access` | Codex 不再提供常规批准和主机能力隔离 |

实际会话的精确组合仍取决于产品表面、工作区信任状态、管理员要求和用户配置，不能只根据 UI 标签推断全部权限。

### 4.2 请求批准

常用的自动开发模式类似：

```toml
approval_policy = "on-request"
sandbox_mode = "workspace-write"
approvals_reviewer = "user"
```

Codex 可以在工作区内读取、编辑和运行命令；写工作区外路径、访问被禁网络或触发受控外部副作用时请求升级。更严格的模式可配置为：

```toml
approval_policy = "untrusted"
sandbox_mode = "read-only"
```

此时只有已知安全的读取操作自动执行，修改状态或触发外部执行路径的命令需要批准。官方配置参考还支持 granular policy，分别控制 sandbox escalation、exec policy、MCP elicitation、permission request 和 skill script approval。[Codex Configuration Reference](https://learn.chatgpt.com/docs/config-file/config-reference)

### 4.3 帮我批准 / Auto-review

典型配置为：

```toml
approval_policy = "on-request"
approvals_reviewer = "auto_review"
sandbox_mode = "workspace-write"
```

Auto-review 并不是无条件替用户点击批准，而是让独立 reviewer agent 审查本来已经需要升级的动作。官方说明其策略关注：

- 数据外泄；
- 凭据探测；
- 持久化降低安全设置；
- 破坏性动作；
- 用户是否已明确授权高风险行为；
- 是否命中拒绝规则。

低、中风险动作在策略允许时可以通过；关键风险被拒绝；高风险需要足够的用户授权。审查会话构造、解析等失败时默认 fail-closed。沙箱内原本允许的动作不会因为开启 reviewer 而额外请求审查。[Codex Automatic approval reviews](https://learn.chatgpt.com/docs/agent-approvals-security)

因此，auto-review 的主要目标是降低审批疲劳，而不是扩大沙箱或提供确定性的安全证明。

### 4.4 完全访问

完全访问通常对应：

```text
sandbox_mode = danger-full-access
approval_policy = never
```

或使用 `--dangerously-bypass-approvals-and-sandbox`。此时模型生成的命令可能以运行 Codex 的 OS 用户身份访问工作区外文件、网络、本机服务、环境变量以及当前用户可用的 Git、SSH 和云工具。

官方建议只在外层已有可信容器或虚拟机隔离时使用。即使在 Dev Container 内，恶意项目仍可能外泄容器中可见的 Codex 凭据或其他秘密。因此“完全访问”应理解为安全责任转移到了外层执行环境，而不是风险消失。[Codex OS-level sandbox](https://learn.chatgpt.com/docs/agent-approvals-security)

### 4.5 OS 强制沙箱

Codex 当前文档描述的平台实现包括：

- macOS：Seatbelt / `sandbox-exec`；
- Linux：`bubblewrap` 加 `seccomp`；
- WSL2：Linux 沙箱语义；
- Windows 原生：Windows sandbox implementation，可配置非提升或提升模式及私有桌面。

这类机制的重要性在于：即使模型、脚本或依赖不遵守提示词，操作系统仍可拒绝越界访问。

### 4.6 工作区保护路径

默认 `workspace-write` 下，工作区内仍有递归只读的控制路径，包括：

- `.git`；
- `.git` 指针解析后的实际 Git 目录；
- `.agents`；
- `.codex`。

这样可以降低智能体直接修改 Git 控制数据、项目级代理指令和自身安全配置的风险，实现业务产物与控制平面的分离。

### 4.7 网络隔离

Codex 默认在 `workspace-write` 沙箱中关闭命令网络。显式打开后，还可启用网络代理与目的域名规则：

```toml
[sandbox_workspace_write]
network_access = true

[features.network_proxy]
enabled = true
domains = { "api.openai.com" = "allow", "example.com" = "deny" }
```

网络代理采用 allowlist 优先、deny 优先于 allow，并默认阻止 loopback、link-local 和私网目的地址。官方同时说明 DNS/IP 分类只能降低 DNS rebinding 风险，不能完全消除它；高威胁环境仍应采用更底层的 egress enforcement。[Codex Network isolation](https://learn.chatgpt.com/docs/agent-approvals-security)

### 4.8 云环境两阶段执行

Codex Cloud 使用隔离容器，并将执行分为：

1. setup 阶段：可联网安装指定依赖，配置的 secrets 可用；
2. agent 阶段：默认离线，setup secrets 在 agent 阶段前被移除。

这种设计把“需要联网的依赖准备”和“处理不可信源码的模型执行”分开，降低恶意仓库内容诱导模型读取并外传 setup secret 的风险。

### 4.9 不可信项目

Codex 可以把项目标记为 `trusted` 或 `untrusted`。不可信项目会跳过项目级 `.codex/` 配置、hooks 和 rules，避免 clone 或打开目录时自动激活仓库控制的执行配置。

## 5. Hermes Agent 安全控制

### 5.1 八层纵深防御

Hermes 官方安全文档列出八层边界：

1. 消息平台用户授权；
2. 危险命令批准；
3. 文件写安全；
4. Docker、Singularity、Modal 等容器隔离；
5. MCP 凭据过滤；
6. 项目上下文文件的提示注入扫描；
7. 跨会话隔离；
8. terminal backend 工作目录等参数的输入清洗。

来源：[Hermes Agent Security](https://hermes-agent.nousresearch.com/docs/user-guide/security/)

### 5.2 审批模式

Hermes 的 `approvals.mode` 支持：

| 模式 | 行为 |
| --- | --- |
| `smart` | 默认；辅助 LLM 审查已被危险模式识别的命令，低风险放行、危险拒绝、不确定时询问用户 |
| `manual` | 对命中的危险命令请求用户批准 |
| `off` | 关闭普通批准检查，等价于 YOLO |

Hermes CLI 支持单次、本会话、永久允许和拒绝。批准超时默认拒绝；无人值守 cron 默认可配置为拒绝；连续拒绝熔断器用于防止 agent 不断换一种命令写法重试。

### 5.3 Hardline blocklist 与用户 deny 规则

Hermes 有一层在 YOLO 下仍不可绕过的 hardline blocklist，用于阻止根文件系统删除、fork bomb、根磁盘格式化、破坏性块设备写入等灾难命令。用户还可以配置 `approvals.deny` glob，在 `mode: off` 或 YOLO 下继续阻止特定命令。

Hermes 官方明确界定了这层的威胁模型：命令检测与 deny 规则主要防范“诚实但犯错”的 agent，不是防范故意规避规则的恶意进程。对后者应使用 Docker、Modal 或其他真正隔离的 backend。

### 5.4 文件写保护及其边界

`write_file` 和 `patch` 会阻止写入 SSH、AWS、Kubernetes 凭据路径、Hermes 凭据文件以及任意位置的 `.env`，还可通过 `HERMES_WRITE_SAFE_ROOT` 限制写根目录。

但这些检查只覆盖相应文件工具。若 terminal 直接运行在宿主机，shell 仍可能读取或覆盖受保护路径。因此工具级路径检查是误操作护栏，不是进程级沙箱。

### 5.5 容器、资源和秘密控制

Hermes 的容器 backend 支持：

- CPU、内存和磁盘限制；
- 持久或临时文件系统；
- 显式环境变量 allowlist；
- 非 root 用户；
- 只读凭据挂载；
- 独立任务目录。

`docker_forward_env` 为空时不会把宿主环境变量批量注入容器。若用户主动转发 `GITHUB_TOKEN` 等变量，容器内代码就具备读取和外泄该秘密的能力。

### 5.6 消息网关身份控制

由于 Hermes 可由 Telegram、Discord、Slack 等远程消息平台驱动，它还需要控制“谁能向 agent 下指令”：

- 平台和全局用户 allowlist；
- 默认拒绝未知用户；
- 一次性 DM pairing code；
- 批准、撤销、速率限制和锁定；
- 配对文件权限保护。

这反映出智能体安全不仅是命令安全，还包括输入主体认证。

## 6. Claude Code 安全控制

Claude Code 提供更细的 permission mode：

| 模式 | 无提示执行范围 | 典型用途 |
| --- | --- | --- |
| Manual / `default` | 读取 | 敏感工作、逐项审查 |
| `acceptEdits` | 读取、工作目录内编辑及部分文件命令 | 日常代码迭代 |
| `plan` | 分析和规划，修改受限 | 先研究后变更 |
| `auto` | 由第二个 classifier 后台审查 | 长任务、降低提示疲劳 |
| `dontAsk` | 只运行预先批准的工具 | 锁定 CI 和脚本 |
| `bypassPermissions` | 几乎全部 | 仅隔离容器或 VM |

Claude Code 还支持工具级 allow、ask、deny 规则和 protected paths。`acceptEdits` 只自动放行工作目录或附加目录内的编辑；越界路径、保护路径和无法静态安全解析的命令仍会询问。[Claude Code permission modes](https://code.claude.com/docs/en/permission-modes)

Claude 的 `auto` 与 Codex `auto_review`、Hermes `smart` 使用相同的基本思想：用独立模型或分类器减少人工批准噪声，同时保留确定性规则和保护路径。

## 7. Gemini CLI 安全控制

Gemini CLI 的批准模式主要包括：

| 模式 | 行为 |
| --- | --- |
| `default` | 对敏感工具调用请求确认 |
| `auto_edit` | 编辑文件自动批准，其他敏感操作仍询问 |
| `yolo` | 自动批准工具调用 |

其沙箱是独立维度，可使用：

- macOS Seatbelt；
- Docker；
- Podman；
- 允许网络、禁止网络或代理联网的不同 profile。

Gemini 在 YOLO 模式下默认启用沙箱，这体现了“不再人工确认”不应自动等价为“解除技术隔离”。[Gemini CLI Sandboxing](https://google-gemini.github.io/gemini-cli/docs/cli/sandbox.html)

Gemini 还提供 Trusted Folders。不可信目录中：

- 项目 `.gemini/settings.json` 被忽略；
- `.env` 不加载；
- 扩展管理受限；
- tool auto-accept 被关闭；
- 自动 memory/context 加载被关闭。

来源：[Gemini CLI Trusted Folders](https://google-gemini.github.io/gemini-cli/docs/cli/trusted-folders.html)

## 8. 横向比较

| 系统 | 强制隔离 | 人工批准 | 自动审查 | 规则控制 | 不可信项目 | 最大权限模式 |
| --- | --- | --- | --- | --- | --- | --- |
| Codex | OS sandbox、云容器 | 有 | reviewer agent | granular policy、保护路径、网络域名、管理员 requirements | 有 | `danger-full-access` |
| Hermes | 可选 Docker/Modal 等；host terminal 边界较弱 | 有 | smart auxiliary LLM | 危险模式、hardline、deny glob | 注入扫描和上下文控制 | YOLO，hardline 仍保留 |
| Claude Code | 沙箱、工作目录与保护路径控制 | 有 | classifier | 工具 allow/ask/deny | 有配置控制 | `bypassPermissions` |
| Gemini CLI | Seatbelt、Docker/Podman，可选启用 | 有 | 主要是 auto-edit | 工具确认、sandbox profile | Trusted Folders | YOLO，通常结合 sandbox |

主要差异：

- **Codex**：最明确地把 OS 强制沙箱和审批 reviewer 建模为正交控制面。
- **Hermes**：危险命令、网关身份和运营控制丰富，但安全强度高度依赖 terminal backend 是否真正隔离。
- **Claude Code**：工具级 allow/ask/deny 和工作目录内自动编辑控制较细。
- **Gemini CLI**：容器与 Seatbelt 方案直观，但普通模式是否启用沙箱需要显式检查。

## 9. 为什么采用这些设计

### 9.1 模型不是可靠的安全执行器

模型会受到上下文、提示注入、歧义和概率输出影响。系统提示中的“不要删除文件”不是强制机制，必须由模型外部的权限系统执行。

### 9.2 默认关闭网络是为了切断外泄通道

本地文件读取与任意出网组合后，agent 就获得了完整的数据外泄能力。网络需要成为与文件写入独立的权限轴，并优先采用目标域名 allowlist。

### 9.3 控制平面必须与工作产物分离

如果 agent 可以修改自己的 rules、hooks、skills、memory 或批准配置，它可以无意或受注入影响地扩大未来权限。保护 `.git`、`.codex`、`.agents`、凭据和持久记忆等路径，是防止权限持久化的重要手段。

### 9.4 自动 reviewer 是人机注意力优化，不是安全证明

它能减少重复安装、测试和常规编辑造成的审批疲劳，但仍可能误判。因此关键风险必须由确定性 policy 阻断，或升级给人类。

### 9.5 无人值守必须 fail-closed

合理的默认包括：

- 审批超时即拒绝；
- reviewer 构造或解析失败即拒绝；
- 未配置网关 allowlist 时拒绝未知用户；
- 不可信目录不加载项目配置；
- 网络无匹配 allow 规则时拒绝；
- 定时任务命中高风险动作时默认停止。

### 9.6 权限控制必须配套恢复机制

权限控制回答“能不能做”，恢复机制回答“做错了怎么办”。生产级 agent runtime 还需要：

- Git worktree 和可审查 diff；
- 文件系统快照或 checkpoint；
- 数据库事务和备份；
- 工具调用幂等键；
- approval 与实际执行参数绑定；
- 结构化、脱敏、不可抵赖的审计记录；
- 对外副作用执行前后的状态验证。

## 10. 对 OpenDrSai 的设计启示

以下是基于上述产品比较得出的工程建议，不表示当前代码已经具备这些能力。

### 10.1 权限模型应拆成独立控制面

不要只存一个 `permission_mode`。建议至少显式建模：

```text
filesystem.read_scope
filesystem.write_scope
filesystem.protected_paths
network.enabled
network.destination_policy
process.execution_scope
credentials.exposure_policy
tools.allow / ask / deny
approval.reviewer
approval.risk_threshold
recovery.checkpoint_policy
```

产品 UI 可以继续提供三种简单预设，但运行时和审计记录应保存解析后的真实权限集合。

### 10.2 先确定能力边界，再决定由谁审批

建议执行顺序为：

```text
Tool proposal
  → 参数规范化与注入检查
  → 确定性 deny / protected-path 检查
  → 沙箱能力检查
  → 风险分类
  → 用户或 reviewer 审批
  → 将批准绑定到不可变参数摘要
  → 幂等执行
  → 结果与副作用验证
  → 审计 / checkpoint
```

审批不应允许绕过不可恢复操作的 hard deny，也不应只绑定自然语言摘要而不绑定最终工具、参数、工作目录、身份和目标资源。

### 10.3 建立不可信工作区模式

首次打开未知目录时应默认：

- 只读；
- 不加载项目级 agent 配置、hooks、skills 和 `.env`；
- 不向子进程注入长期凭据；
- 禁止命令直接联网；
- 对仓库指令文件显示来源与信任状态；
- 用户明确建立信任后再提升为 workspace-write。

### 10.4 自动审批必须具备独立审计身份

自动 reviewer 的 decision 应记录：

- reviewer 类型和版本；
- 输入 proposal hash；
- 风险类别；
- 命中的 allow/deny/policy；
- decision 与理由摘要；
- 失败、超时和 fallback 行为；
- 最终执行参数是否与 proposal 一致。

不得把自动 reviewer 的批准伪装成用户批准。

### 10.5 完全访问应要求外层隔离证明

完全访问模式至少应显示并检查：

- 是否处于容器、VM、Windows Sandbox 或等价边界；
- 是否以非管理员、非 root 身份运行；
- 可见挂载和凭据；
- 网络出口范围；
- 是否存在快照或可销毁环境；
- 是否涉及生产或外部账号。

若无法证明外层隔离，应把“完全访问”标记为高风险本机执行，而不是普通效率选项。

## 11. 推荐的使用基线

### 11.1 日常可信 Git 仓库

```text
workspace-write
+ 工作区外请求批准
+ 命令默认无网络
+ 按需开放具体域名
+ 用户批准或 auto-review
+ .git / agent 配置目录只读
+ 最终通过 git diff 审查
```

### 11.2 陌生或不可信仓库

```text
read-only
+ 不加载项目配置和 hooks
+ 禁止网络
+ 不注入主账号凭据
+ 先审查 AGENTS.md、安装脚本、依赖 hooks 和构建入口
```

### 11.3 长时间自主任务

```text
一次性容器或 VM
+ 非 root 用户
+ 只挂载单个工作区
+ 最小环境变量
+ 网络域名 allowlist
+ 临时、低权限服务账号
+ 自动 reviewer
+ checkpoint 和结构化日志
```

### 11.4 生产、付款、外部发信和权限变更

```text
agent 只生成计划或变更草案
+ 确定性策略检查
+ 人工最终批准
+ 短期凭据
+ 平台原生审批或双人审批
+ 执行后验证与审计
```

## 12. 最终判断

“请求批准”把越界风险判断主要交给用户；“帮我批准”用独立 reviewer 减少日常审批噪声，但仍依赖沙箱兜底；“完全访问”则把安全责任转移到外层容器、虚拟机、账号权限和网络边界。

合理的系统不是永远选择最严格或最宽松模式，而是让以下四项匹配：

1. 任务需要的最小能力；
2. 输入内容的可信程度；
3. 副作用的可逆性和影响范围；
4. 外层执行环境能够提供的隔离强度。

## 13. 一手资料

- OpenAI, [Agent approvals & security](https://learn.chatgpt.com/docs/agent-approvals-security)
- OpenAI, [Codex Configuration Reference](https://learn.chatgpt.com/docs/config-file/config-reference)
- Nous Research, [Hermes Agent Security](https://hermes-agent.nousresearch.com/docs/user-guide/security/)
- Nous Research, [Hermes Agent Configuration](https://hermes-agent.nousresearch.com/docs/user-guide/configuration/)
- Anthropic, [Claude Code permission modes](https://code.claude.com/docs/en/permission-modes)
- Google, [Gemini CLI configuration](https://google-gemini.github.io/gemini-cli/docs/get-started/configuration.html)
- Google, [Gemini CLI sandboxing](https://google-gemini.github.io/gemini-cli/docs/cli/sandbox.html)
- Google, [Gemini CLI Trusted Folders](https://google-gemini.github.io/gemini-cli/docs/cli/trusted-folders.html)

## 14. OpenDrSai 落地方案

- [P0：真正安全边界实施方案](./opendrsai-agent-security-p0-capability-boundary-plan.md)
- [P1：降低 Approval 控制面方案](./opendrsai-agent-security-p1-approval-control-plane-plan.md)
- [P2：三种权限模式产品化方案](./opendrsai-agent-security-p2-permission-modes-productization-plan.md)
