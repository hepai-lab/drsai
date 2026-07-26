# OpenDrSai 总体架构 V1

## 1. 架构定位

OpenDrSai 采用“多客户端 + 可部署的 Agent Runtime + 工作区与资产管理”的统一架构。客户端负责交互，Agent Runtime 负责运行，Workspace & Asset Management 负责保存执行环境和可复用资产；身份、组织、模型与分布式计算由 HepAI Platform Services 提供。

本架构是逻辑架构，不要求每一部分都独立部署为一个进程。不同产品形态可以组合、嵌入或远程部署这些组件，但组件职责不随部署方式改变。

## 2. 总体结构

```text
┌──────────────────────── OpenDrSai ────────────────────────┐
│                                                           │
│  1. Client Applications                                   │
│     ├─ WebUI / Desktop                                    │
│     ├─ Android / TUI                                      │
│     └─ SDK / API Client                                   │
│                         │                                 │
│                         ▼                                 │
│  2. Agent Runtime                                         │
│     ├─ Gateway / Protocol                                 │
│     ├─ Session / Run / Event ──▶ Runtime Engine           │
│     └─ Agent Core                                         │
│        ├─ Agent Loop                                      │
│        ├─ Tool / Skill / MCP                              │
│        └─ Subagents                                       │
│                         │                                 │
│                         ▼                                 │
│  3. Workspace & Asset Management                          │
│     ├─ Workspace                                          │
│     │  ├─ Project / Files                                 │
│     │  ├─ Git / Worktree                                  │
│     │  └─ Execution Context                               │
│     ├─ Assets                                             │
│     │  ├─ Knowledge                                       │
│     │  ├─ Workflow                                        │
│     │  └─ Data / Artifact                                 │
│     └─ Governance                                         │
│        ├─ Permission                                      │
│        ├─ Version                                         │
│        └─ Audit                                           │
│                                                           │
└───────────────────────────┬───────────────────────────────┘
                            ▼
                 HepAI Platform Services
          Identity / Organization · HAI Model API
                    DDF / HepAI Worker
```

## 3. 三个组成部分

### 3.1 Client Applications

客户端负责界面呈现、用户输入、事件订阅和审批响应，不拥有权威运行状态，也不直接承担完整 Agent 执行逻辑。

- WebUI 后端是 BFF/Runtime Proxy，只负责认证衔接、接口适配、请求转发和事件中继，不运行 OpenDrSai Agent Runtime。
- Desktop 可以连接本地 Full Runtime，也可以通过 SSH 连接远端 Full Runtime。
- Android 后端内嵌 Lite Agent Runtime，可以本地执行轻量任务，也可以连接或委托 Full Runtime。
- TUI、SDK 和 API Client 通过标准协议访问 Runtime。

### 3.2 Agent Runtime

Agent Runtime 是会话与任务的实际执行者。

- **Gateway / Protocol**：提供 REST、SSE、WebSocket、JSON-RPC 等协议适配、认证衔接与能力协商。传输方式可以不同，领域语义必须一致。
- **Session / Run / Event 与 Runtime Engine**：Session 表示交互上下文，Run 表示一次确定的执行，Event 表示执行过程中的事实；Runtime Engine 负责调度、状态机、取消、恢复与检查点。
- **Agent Core**：通过 Agent Loop 组织推理，调度 Tool、Skill、MCP，并管理 Subagents。

Runtime 分为两种能力等级：

- **Full Agent Runtime**：支持完整 Agent Core、工作区、Shell、Git、Tool、Skill、MCP 和 Subagents。
- **Lite Agent Runtime**：面向 Android 等受限环境，支持轻量 Agent Loop 和安全工具；通过能力协商将超出本地能力的 Run 委托给 Full Runtime。

### 3.3 Workspace & Asset Management

该部分统一管理 Agent 的执行环境、可复用成果及治理规则。

- **Workspace**：保存项目文件、Git/Worktree 和 Shell、进程、环境变量等 Execution Context。
- **Assets**：保存 Knowledge、Workflow、Data/Artifact 等可复用、可共享、可版本化的资产。
- **Governance**：管理 Permission、Version 和 Audit。

Agent Definition、Skill Definition、Workflow Definition 以及 Tool/MCP 注册配置属于 Assets；它们的加载、实例化和执行属于 Agent Core。Subagent Definition 是资产，Subagent Run 是 Runtime 状态。

## 4. 核心对象关系

```text
Workspace 1 ── 0..N Session
Session   1 ── 0..N Run 1 ── 0..N Event
                         │
                         └── 由一个确定的 Runtime 执行
```

- 每个 Session 最多绑定一个 Workspace；`Session.workspace_id` 可以为空，以支持普通问答和不依赖项目的任务。
- 文件、Git、Shell、代码修改和测试等 Run 必须绑定 `workspace_id`。
- 远程工作区中的 Session 和 Run 均应绑定 `workspace_id`。
- Run 创建后固定 `workspace_id`，执行过程中不得隐式切换工作区。

## 5. 状态权威与远程委托

采用“执行 Runtime 权威”原则：Run 在哪个 Runtime 执行，哪个 Runtime 就是该 Run、Event 和 Checkpoint 的权威来源。

| 数据                             | 权威来源                      |
| -------------------------------- | ----------------------------- |
| Session 元数据                   | 创建并管理 Session 的 Runtime |
| Run / Event / Checkpoint         | 实际执行 Run 的 Runtime       |
| Workspace 文件与 Git             | Workspace 所在机器            |
| Client、BFF 和 Lite Runtime 缓存 | 非权威副本                    |
| 身份与组织                       | HepAI Platform Services       |

Lite Runtime 将任务委托给 Full Runtime 时，只保存 `runtime_id`、`remote_session_id` 和 `remote_run_id` 等远程引用。它可以缓存远端事件用于展示和离线访问，但不能改写远端 Run 的权威状态。

## 6. Permission、Approval 与 Audit

- **Permission** 是长期授权，决定某个主体能否访问 Workspace 或 Asset，属于 Governance。
- **Approval** 是某次 Run 执行敏感操作前的动态决策，属于 Agent Runtime。
- **Audit** 记录身份、权限判断、审批和最终工具执行结果，属于 Governance。

标准执行顺序为：

```text
Identity
   → Permission Check
   → Runtime Policy
   → Approval（必要时）
   → Tool Execution
   → Audit
```

## 7. 部署形态

```text
WebUI
  → WebUI Backend / Runtime Proxy
  → Full Agent Runtime

Desktop
  → Local Full Runtime
  或 SSH → Remote Full Runtime → Remote Workspace

Android
  → Embedded Lite Agent Runtime
       ├─ Local Lightweight Execution
       └─ Full Agent Runtime Delegation

TUI / SDK / API Client
  → Full Agent Runtime
```

远程工作区不是另一套 Agent 架构，而是 Full Agent Runtime 和 Workspace 部署在远端主机上的一种部署形态。SSH Manager 位于 Desktop 侧，负责身份验证、主机连接、Runtime 安装/启动、端口转发和连接恢复；它不是 Agent Runtime 的组成部分。

## 8. HepAI Platform Services 边界

HepAI Platform Services 位于 OpenDrSai 系统边界之外，提供：

- Identity、Organization 和 OIDC；
- HAI Model API；
- DDF 和 HepAI Worker 等分布式基础设施。

OpenDrSai 使用 HepAI 提供的身份声明和平台能力，但由自身负责 Runtime 执行、Workspace 权限落实和 Asset 治理。HepAI Worker 可以承载或调度 OpenDrSai Runtime，但 HepAI Worker 不等于 OpenDrSai Agent Runtime。

## 9. 架构约束

1. Client 不拥有权威运行状态，Runtime 拥有。
2. Run 在哪里执行，哪里就是运行事实的权威来源。
3. Agent、Skill 和 Workflow 的定义属于 Assets，其加载和执行属于 Agent Core。
4. Permission 管理长期访问权，Approval 管理单次敏感操作。
5. 不同客户端可以使用不同传输协议，但必须共享 Session、Run、Event 的统一模型和生命周期语义。
6. 部署方式不得改变组件职责；代理、缓存和索引不得被描述为 Runtime 的权威状态。
