# OpenDrSai 远程工作区实现方案 V1

> 总体架构基线：[OpenDrSai 总体架构 V1](../OpenDrSai总体架构V1.md)  
> 方案状态：架构决策已冻结，现有实现需要按本文重新核对和验收。

## 1. 目标与定义

远程工作区是 OpenDrSai Full Agent Runtime 和 Workspace 部署在远端主机上的一种部署形态，不是远程目录挂载，也不是另一套 Agent 架构。

用户在 Desktop 选择远端目录后，可以查看该工作区的历史 Session、创建新 Session 并发起 Run。文件、Git、Shell、构建、测试和 Agent 工具均在远端执行；Desktop 只负责连接、显示、输入、审批和事件订阅。

```text
Remote Workspace
= Remote Host
+ Full Agent Runtime
+ Canonical Workspace
+ Session / Run / Event
+ Permission / Approval / Audit
```

## 2. 总体架构

```text
OpenDrSai Desktop
├─ Workspace UI
├─ Runtime Client
└─ SSH Manager
   ├─ Host Discovery / Authentication
   ├─ Runtime Install / Upgrade / Rollback
   ├─ SSH Tunnel / Reconnect
   └─ Host Connection State
              │
              │ SSH Local Port Forward
              ▼
Remote Host
└─ OpenDrSai Full Agent Runtime（一个系统用户一个）
   ├─ Gateway / Protocol
   ├─ Session / Run / Event → Runtime Engine
   ├─ OpenDrSai Workspace Operation Protocal
   │  ├─ Files / Search / Watch
   │  ├─ Git / Process / PTY
   │  └─ Checkpoint / Artifact
   ├─ Agent Core
   │  ├─ Agent Backend Router
   │  ├─ OpenDrSai Agent Backend
   │  └─ Codex Agent Backend（扩展）
   │     ├─ Codex Adapter
   │     └─ Codex App Server
   └─ Workspace Registry
      ├─ Workspace A
      ├─ Workspace B
      └─ Workspace N
```

正式名称如下：

- 产品能力：**Remote Workspace / 远程工作区**；
- 远端执行服务：**OpenDrSai Full Agent Runtime**；
- Runtime 网络入口：**Gateway / Protocol**；
- Desktop 连接组件：**SSH Manager**。
- 统一工作区操作语义：**OpenDrSai Workspace Operation Protocal（OWOP）**；
- Agent Core 内的可替换执行实现：**Agent Backend**；
- Codex 接入实现：**Codex Agent Backend = Codex Adapter + Codex App Server**。

不再使用“Remote Runtime Gateway”指代整个远端 Runtime。

命名边界必须保持一致：外层执行平台称为 Runtime，Agent Core 内的执行实现只称为 Backend，不使用“OpenDrSai Agent Runtime”或“Codex Agent Runtime”指代 Backend。

## 3. 核心架构决策

1. V1 主链路使用 SSH Tunnel + REST/SSE/WebSocket，不依赖 DDF。
2. 一台远端主机的一个系统用户运行一个 Full Agent Runtime。
3. 一个 Runtime 管理多个 Workspace，不为每个 Workspace 启动独立 Runtime。
4. 远程 Session 和 Run 必须绑定 Workspace；Run 创建后不得隐式切换。
5. 实际执行 Run 的 Runtime 是 Run、Event 和 Checkpoint 的唯一权威来源。
6. Runtime 采用用户级、版本隔离安装，健康检查成功后切换，失败自动回滚。
7. V1 首先支持 Desktop；Mobile 跨网络访问不扩大本方案范围。
8. DDF 未来只用于发现、中继或调度，不成为运行状态的权威来源。
9. 本地和远程 Workspace 使用同一套 OpenDrSai Workspace Operation Protocal；Local IPC、SSH、HepAI IF、MCP 和未来 DDF 只作为不同 Binding，不定义 Workspace 业务语义。

### 3.1 Agent Backend 扩展架构

Agent Core 通过 Agent Backend Router 选择具体执行实现。增加 Codex 不改变 Desktop、Runtime Client、SSH Manager、Gateway / Protocol、Runtime Engine 或 Workspace Registry；它只是在 Agent Core 内增加一个与 OpenDrSai Agent Backend 并列的 Codex Agent Backend。

```text
Agent Core
├─ Agent Backend Router
├─ OpenDrSai Agent Backend
└─ Codex Agent Backend
   ├─ Codex Adapter
   └─ Codex App Server
```

统一关系为：

```text
Agent Backend
├─ OpenDrSai Agent Backend
└─ Codex Agent Backend
   = Codex Adapter + Codex App Server
```

其中：

- **Agent Backend Router** 根据精确版本的 Agent Definition 中的 `backend` 字段选择 Backend；
- **OpenDrSai Agent Backend** 复用 OpenDrSai Agent Core、模型适配、Tool、Skill、MCP 和 Subagent 执行能力；
- **Codex Agent Backend** 是 Agent Core 看到的一个完整 Backend；
- **Codex Adapter** 是 OpenDrSai 自有适配代码，负责 Codex App Server 的进程生命周期、协议通信、对象映射、事件转换、审批桥接、取消、恢复、版本兼容和错误脱敏；
- **Codex App Server** 是 Codex Agent 的实际执行引擎；Desktop、Gateway 和 Runtime Engine 均不得直接连接或调用它。

Supervisor、JSON-RPC Client、Session/Thread Mapper、Run/Turn Mapper、Event Mapper、Approval Bridge 等可以在代码中拆分为 Codex Adapter 的内部类或内部模块，但不得作为独立架构组件暴露。Codex Adapter 是 Codex Agent Backend 对 OpenDrSai 的唯一边界。

Backend 使用统一契约：

```text
AgentBackend
├─ backend_id
├─ execute
├─ cancel
├─ respond_approval
├─ recover
└─ close
```

Runtime 继续保持以下权威关系：

- Workspace、Session、Run、Event sequence、Permission、Approval decision 和 Audit 以 OpenDrSai Full Agent Runtime 为权威；
- Codex Thread、Turn、Item 和 Codex 内部 Agent 状态以 Codex App Server 为权威；
- Codex Adapter 只维护两套模型之间必要的 `session_id ↔ thread_id`、`run_id ↔ turn_id` 映射，不建立第二套产品级 Session、Run 或 Event Store；
- Codex 通知必须经 Adapter 转换为统一 Runtime Event 并写入现有 Event Store，Desktop 仍按现有 Runtime Protocol 订阅和续传；
- Codex 的 Workspace `cwd` 必须来自 Runtime 已验证的 `workspace_id` 和 canonical path，客户端或模型不得直接覆盖；
- Permission 必须先于 Approval，Codex 发起的审批请求必须经 Adapter 接入 Runtime 现有审批与审计链路。

部署与通信关系为：

```text
OpenDrSai Full Agent Runtime
└─ Agent Core
   └─ Codex Agent Backend
      ├─ Codex Adapter
      │  └─ stdio JSON-RPC
      └─ Codex App Server
```

Codex App Server 默认由 Adapter 作为 Runtime 内部受管进程启动，并优先通过 stdio 通信，不新增 Desktop 到 Codex 的连接、不新增 SSH 隧道，也不对外开放 Codex 专用端口。Codex 版本或内部协议变化应被限制在 Adapter 内部，不得导致统一 Runtime Protocol 随之漂移。

本节定义扩展架构和复用边界，不改变当前 V1 将 Codex App Server Adapter 排除在本期交付范围之外的范围约束；进入后续交付时，应在保持上述边界的前提下增加对应功能点和验收门禁。

具体的风险验证、分阶段实现和验收安排见 [OpenDrSai Codex Agent Backend 实现计划 V1](./OpenDrSaiCodexAgentBackend实现计划V1.md)。

Windows 本地优先、未来 Linux 远程复用同一架构的完整模块、功能点和验收方案见 [OpenDrSai Codex 工作区开发方案 V1](./OpenDrSaiCodex工作区开发方案V1.md)。

## 4. 对象模型

### 4.1 HostConnection

HostConnection 只存在于 Desktop，描述如何连接远端主机，不属于 Runtime 业务状态。

```text
connection_id
display_name
hostname
port
remote_user
ssh_auth_ref
host_key_fingerprint
```

SSH 私钥不得进入该对象、应用数据库、日志或诊断包；`ssh_auth_ref` 只引用系统 SSH 配置或安全凭据存储。

### 4.2 Runtime

```text
runtime_id
instance_id
host_id
version
protocol_version
capabilities
started_at
```

- `runtime_id` 是远端主机及系统用户范围内的稳定 Runtime 身份。
- `instance_id` 每次进程启动时重新生成，用于判断 Runtime 是否重启。
- `capabilities` 用于协商 Files、Git、PTY、MCP、Subagents、Checkpoint 等能力。

### 4.3 Workspace

```text
workspace_id
runtime_id
canonical_path
display_name
created_at
last_opened_at
```

建议唯一约束：

```text
runtime_id + canonical_path
```

`canonical_path` 必须由远端 Runtime 使用 `realpath` 解析。`workspace_id` 由 Runtime 生成并返回，Desktop 不得根据 alias 或路径自行猜测。

### 4.4 Session、Run 与 Event

```text
Runtime   1 ── N Workspace
Workspace 1 ── N Session
Session   1 ── N Run
Run       1 ── N Event
```

Session：

```text
session_id
runtime_id
workspace_id
title
created_by
created_at
updated_at
```

Run：

```text
run_id
session_id
workspace_id
executor_runtime_id
agent_definition_id
status
created_at / started_at / finished_at
```

`workspace_id` 和 `executor_runtime_id` 在 Run 创建后不可变。状态机为：

```text
queued
  → running
  → waiting_approval
  → running
  → completed / failed / cancelled
```

Event 是只追加的运行事实。一个 Run 内的 `sequence` 单调递增，历史 Event 不得被覆盖或改写。

## 5. Runtime Protocol V1

### 5.1 通道职责

- **REST**：资源查询和控制命令；
- **SSE**：Run Event 实时传输和断线续传；
- **WebSocket**：PTY 和交互式进程；
- **SSH**：远端认证、Runtime 运维和端口转发，不定义业务语义。

```text
Desktop Runtime Client
  → SSH Tunnel
      ├─ REST       Workspace / Session / Run
      ├─ SSE        Runtime Event
      └─ WebSocket  PTY
  → Remote Full Agent Runtime
```

### 5.2 V1 API

```text
GET  /v1/runtime
GET  /v1/capabilities

GET  /v1/workspaces
POST /v1/workspaces/open
GET  /v1/workspaces/{workspace_id}

GET  /v1/workspaces/{workspace_id}/sessions
POST /v1/sessions

POST /v1/sessions/{session_id}/runs
GET  /v1/runs/{run_id}
POST /v1/runs/{run_id}/cancel
POST /v1/runs/{run_id}/approve

GET  /v1/runs/{run_id}/events
GET  /v1/runs/{run_id}/events/stream

WS   /v1/workspaces/{workspace_id}/pty
```

所有 API 使用结构化错误，至少包含 `code`、`message`、`correlation_id` 和 `retryable`。OpenAPI 是 REST 客户端的契约来源，生成客户端必须通过 drift check。

### 5.3 统一事件信封

```json
{
  "event_id": "evt_xxx",
  "sequence": 42,
  "runtime_id": "rt_xxx",
  "workspace_id": "ws_xxx",
  "session_id": "ses_xxx",
  "run_id": "run_xxx",
  "type": "tool.started",
  "timestamp": "2026-07-16T10:00:00Z",
  "payload": {}
}
```

断线重连使用 `after_sequence` 补取事件。Desktop 缓存只是非权威副本，不得自行推进 Run 状态。

### 5.4 OpenDrSai Workspace Operation Protocal（OWOP）

OpenDrSai Workspace Operation Protocal（以下简称 **OWOP**）是 Local Runtime、Remote Runtime、Desktop、Agent Backend 和 Codex Adapter 共同使用的统一工作区操作语义协议。OWOP 同时适用于本地和远程 Workspace，因此协议名称中不使用 Remote。

OWOP 统一的是操作、数据模型、安全和可靠性语义，不强制所有部署使用同一种传输：

```text
Desktop / Agent Backend / Codex Adapter
                  │
                  ▼
       WorkspaceOperationsClient
                  │
                  │ OWOP
                  ▼
       WorkspaceOperationsService
                  │
                  ▼
      Files / Git / Process / PTY /
      Watch / Checkpoint / Artifact
```

Binding 关系为：

```text
OpenDrSai Workspace Operation Protocal
├─ InProcess Binding
├─ Local IPC Binding
├─ SSH Runtime Binding
├─ HepAI IF Binding
├─ Codex Tool / MCP Binding
└─ Future DDF Relay Binding
```

必须遵守以下传输原则：

- 跨主机访问 Workspace 时使用 SSH Runtime Binding，或未来经过批准的 Relay Binding；
- 同主机调用优先使用 InProcess、stdio、Named Pipe 或 Unix Socket，不为统一形式强制经过 SSH；
- SSH 只负责主机认证、加密传输和 Runtime 端口转发，不定义 Files、Git、Process、PTY 等业务语义；
- 切换 Binding 不得改变 operation 名称、请求/响应 Schema、错误码、Permission、Approval、Audit 和 Event 语义；
- Binding 失败时不得把操作静默切换到另一台机器或另一个 Workspace 执行。

典型部署矩阵：

| 调用方 | Workspace 位置 | OWOP Binding |
| --- | --- | --- |
| Windows Codex Backend | Windows 本地 | InProcess / Local IPC |
| Windows Codex Backend | Linux 远程 | SSH Runtime Binding |
| Linux Codex Backend | 同一 Linux 主机 | InProcess / Unix Socket |
| Linux Codex Backend A | Linux Workspace B | SSH Runtime Binding 或 Future Relay |
| HepAI Worker | 任意 Runtime Workspace | HepAI IF Binding |

#### 5.4.1 协议范围

OWOP 负责：

```text
Workspace lifecycle
Files / Search / Watch
Git
Process / PTY
Workspace Checkpoint
Artifact
Workspace Event
```

OWOP 不负责 Agent Thread、Session、Run、模型调用、Codex Turn 或 Agent Event。这些对象继续属于 Runtime Engine 或对应 Agent Backend。Runtime Protocol 与 OWOP 的关系为：

```text
OpenDrSai Runtime Protocol
├─ Runtime / Capability
├─ Session / Run / Agent Event
├─ Permission / Approval / Audit
└─ OpenDrSai Workspace Operation Protocal
   ├─ Workspace
   ├─ Files / Search / Watch
   ├─ Git
   ├─ Process / PTY
   └─ Checkpoint / Artifact
```

#### 5.4.2 强类型操作模型

代码层定义统一客户端和服务端契约：

```text
WorkspaceOperationsClient
├─ capabilities
├─ open_workspace / describe_workspace / close_workspace
├─ list_files / stat_file / read_file / write_file / search_files / watch_files
├─ git_status / git_diff / git_stage / git_revert / git_commit
├─ start_process / write_process / attach_process / kill_process
├─ create_pty / write_pty / resize_pty / attach_pty / kill_pty
├─ create_checkpoint / preview_checkpoint / restore_checkpoint / accept_checkpoint
├─ approve
└─ subscribe
```

协议 operation 使用稳定命名空间：

```text
workspace.capabilities
workspace.open
workspace.describe
workspace.close

files.list
files.stat
files.read
files.write
files.move
files.remove
files.search
files.watch

git.status
git.diff
git.file_at_ref
git.stage
git.unstage
git.revert
git.commit

process.start
process.write
process.attach
process.kill

pty.create
pty.write
pty.resize
pty.attach
pty.kill

checkpoint.create
checkpoint.preview
checkpoint.restore
checkpoint.accept
```

统一请求可以使用通用信封，但每个 operation 必须有独立的请求和响应 JSON Schema。禁止只定义 `workspace.invoke(name, arbitrary_json)` 作为核心协议，因为它无法提供类型检查、兼容协商和 drift 门禁。

请求信封：

```json
{
  "protocol_version": "1.0",
  "request_id": "req_xxx",
  "workspace_id": "ws_xxx",
  "operation": "files.read",
  "arguments": {
    "path": "src/app.py",
    "offset": 0,
    "length": 1048576
  },
  "idempotency_key": null,
  "correlation_id": "corr_xxx"
}
```

成功响应：

```json
{
  "request_id": "req_xxx",
  "result": {
    "offset": 0,
    "eof": true,
    "digest": "sha256:..."
  }
}
```

失败响应：

```json
{
  "request_id": "req_xxx",
  "error": {
    "code": "workspace_path_outside_root",
    "message": "The path is outside the Workspace root.",
    "correlation_id": "corr_xxx",
    "retryable": false,
    "details": {}
  }
}
```

客户端不得提交权威 principal、canonical path、runtime ID、OS user 或 Permission 结果。服务端必须从已认证连接、Workspace Registry 和 Runtime Security 中获得这些字段。

#### 5.4.3 流式通道与 Event

OWOP 是统一语义协议，不要求所有数据经过单一 RPC 通道：

| 数据类型 | 推荐通道 |
| --- | --- |
| 小型查询和控制请求 | Request / Response |
| Workspace Watch 和 Process Event | SSE、流式通知或本地异步流 |
| PTY | WebSocket 或本地双向流 |
| 大文件 | 分块 Raw Stream，带 offset、length 和 digest |
| 同进程调用 | Python 方法和内存流 |

Workspace Event 使用统一信封：

```json
{
  "event_id": "evt_xxx",
  "workspace_id": "ws_xxx",
  "resource_id": "process_xxx",
  "sequence": 42,
  "type": "process.output.delta",
  "correlation_id": "corr_xxx",
  "timestamp": "2026-07-16T10:00:00Z",
  "data": {
    "stream": "stdout",
    "content": "..."
  }
}
```

要求：

- sequence 的范围必须由具体 operation/resource Schema 明确，不允许客户端自行推断；
- 断线后通过 `after_sequence` 或明确 cursor 续传；
- 使用 `event_id` 去重；
- Transport 断开不等于 Process、PTY 或 Watch 被取消；
- 大文件二进制不进入 IF/JSON base64 主链路，避免内存放大和额外编码开销。

#### 5.4.4 Permission、Approval 与 Audit

所有 Binding 必须保持同一安全顺序：

```text
Transport Authentication
  → Runtime Principal
  → Workspace Permission
  → Runtime Approval
  → Workspace Operation
  → Audit + Workspace Event
```

- Permission 失败不得创建 Approval；
- Approval 使用 Runtime 权威 `approval_id`，不得直接暴露 Binding 私有请求 ID；
- 写文件、启动命令、Git 写操作和 Checkpoint 恢复必须支持 policy 驱动的 Approval；
- 操作审计必须包含 principal、runtime、workspace、session、run、backend、operation 和 correlation ID；
- 本地 Binding 不得因为没有网络边界而跳过 Permission、Approval 或 Audit；
- HepAI IF、MCP 或 Codex 传入的 user、path 和权限声明均视为非权威输入。

#### 5.4.5 HepAI 无限函数协议（IF）边界

HepAI IF 适合作为 OWOP 的可选 Binding，不作为 OWOP 核心协议本身。

可以复用的 IF 能力：

- `remote_callable` 函数暴露；
- 远程函数发现；
- 同步、异步和 generator 调用；
- HepAI 身份、Worker 注册和平台路由；
- 将离散 Workspace 操作暴露为 Agent Tool。

不能由 IF 取代的 OWOP 语义：

- 稳定 `workspace_id`、canonical path 和 Workspace Registry；
- 协议版本和 capability 协商；
- 每个 operation 的独立 Schema；
- 统一结构化错误；
- 幂等键和状态查询；
- Event sequence、续传和去重；
- PTY 双向交互；
- 大文件分块流；
- Permission → Approval → Audit 固定顺序；
- HepAI/DDF 不可用时核心 Local/SSH Binding 仍然工作。

实现关系：

```text
HepAI Client
  → IF remote_callable
  → OWOP HepAI IF Binding
  → WorkspaceOperationsService
```

IF Binding 应由 OWOP Schema 生成或薄包装，例如把 `files.read` 映射为 `wop_files_read`。IF Wrapper 不得自行实现文件、Git、PTY 或权限逻辑，也不得返回一套与 OWOP 不同的 `{status: false}` 错误语义。二进制继续通过 OWOP Raw Stream 端点传输，IF 只返回 metadata、handle 或受控 URL。

#### 5.4.6 Codex 与其他 Agent Backend

Agent Backend 通过 `WorkspaceOperationsClient` 使用 OWOP：

```text
Codex App Server
  → Codex Adapter
  → WorkspaceOperationsClient
     ├─ Local Workspace：InProcess / Local IPC Binding
     └─ Remote Workspace：SSH Runtime Binding
```

Codex Adapter 可以把 OWOP capability 转换为 Codex Tool 或 MCP Tool，但 Codex Tool/MCP 只是 Agent-facing Binding，不是 Workspace 权威协议。OpenDrSai Agent Backend、Codex Agent Backend 和未来 Backend 必须复用同一个 WorkspaceOperationsClient，禁止分别实现不兼容的 Files、Git、Process 或 PTY 远程调用。

当 Agent Backend 与 Workspace 不在同一 Runtime 时，Run Context 必须显式区分 `agent_backend_runtime_id` 与 `workspace_runtime_id`；在该分布式模式完成安全、恢复和一致性设计前，不得把跨 Runtime Backend 调用伪装成现有单 Runtime Run。

#### 5.4.7 Schema 与兼容门禁

OWOP 采用 Schema-first：

- operation、请求、响应、Event、Error 和 capability 使用版本化 JSON Schema/OpenAPI；
- 从同一 Schema 生成 Python、TypeScript、Local IPC、SSH Runtime 和 IF Binding 所需类型或包装器；
- CI 重新生成后必须零差异；
- 删除 operation、收紧字段或改变错误/事件语义属于破坏性变更；
- 新增可选 operation 通过 capability 协商；
- Client 遇到未声明 capability 时必须禁用对应功能，不得回落到本机执行；
- 所有 Binding 运行同一套 WorkspaceOperationsClient 合规测试。

## 6. 连接与运行生命周期

```text
1. Desktop 从 OpenSSH 配置发现或由用户添加主机
2. SSH 验证远端主机指纹和系统用户
3. SSH Manager 探测 OS、架构及 Runtime 版本
4. 缺失或不兼容时安装兼容版本
5. 启动只监听 127.0.0.1 的 Runtime
6. 建立本地随机端口到 Runtime 的 SSH 转发
7. 调用 /v1/runtime 和 /v1/capabilities 完成握手
8. Runtime 规范化并打开用户选择的目录
9. Desktop 保存 Runtime 返回的 workspace_id
10. 按 workspace_id 加载 Session 并订阅 Run Event
```

网络、SSH 或 Runtime 中断后，Desktop 使用指数退避重连。重连成功后必须重新握手、确认 `instance_id`、恢复全部已打开 Workspace，并从各 Run 的最后 `sequence` 继续订阅。

远端 Run 可以在 Desktop 断线后继续执行。Desktop 不得因连接超时自动重复提交 Run。

## 7. 身份、安全与隔离

远程工作区使用三层验证和授权：

```text
SSH Host Authentication
  → OpenDrSai Runtime Authentication
  → Workspace Permission / Runtime Approval
```

强制要求：

- 严格校验 `known_hosts`，首次连接展示主机指纹；
- Runtime 只监听远端 `127.0.0.1`；
- SSH 隧道外仍使用短期、内存保存的 Runtime Token；
- Runtime Token 不进入 URL、持久化配置或日志；
- 所有业务 API 显式携带 `workspace_id`；
- 文件路径只允许使用 Workspace 根目录内的相对路径；
- Runtime 对规范化结果执行根目录边界和符号链接越界检查；
- Workspace 执行继承远端操作系统用户权限；
- Permission 先于 Approval；
- Shell、文件写入、Git 推送及审批结果进入 Audit；
- 不默认启用 SSH Agent Forwarding；
- 不支持的能力必须在 UI 禁用，不得静默回落到本地执行。

两台主机即使都打开 `/home/vscode`，也必须具有不同 `runtime_id` 和 `workspace_id`；同一主机的多个 Workspace 共享连接，但 Session、Run、Event、PTY、监听和缓存必须隔离。

## 8. Runtime 安装、升级与回滚

Runtime 采用无 Root 的用户级安装：

```text
~/.opendrsai/
├─ bin/
│  └─ opendrsai-runtime
├─ runtimes/
│  ├─ 1.0.0/
│  └─ 1.1.0/
├─ current
├─ state/
│  └─ runtime.db
├─ logs/
└─ locks/
```

- 安装制品必须校验摘要和签名；
- 新版本安装到独立目录，不覆盖当前版本；
- 新版本启动并通过健康检查后再切换 `current`；
- 启动或迁移失败时自动回滚；
- 数据库迁移前备份，并明确可回滚范围；
- Desktop 根据 `protocol_version` 和能力协商判断兼容性；
- Linux 可以支持 `systemd --user`，但不能作为唯一启动方式；
- 产品部署不依赖 Docker，也不要求远端管理员权限；自动验收可使用 Docker 或专用 VM 构造可控 Linux 目标。

## 9. SSH 与 DDF 边界

V1 仅支持 Desktop 可以通过 SSH 到达远端主机的场景，不把 DDF 加入核心链路。

连接层预留统一接口：

```text
RuntimeConnection
├─ SshTunnelConnection    // V1
└─ DdfRelayConnection     // Future
```

未来引入 DDF 时必须满足：

- DDF 只承担 Runtime 发现、中继或平台调度；
- Runtime 仍是 Run/Event 的权威来源；
- 一个 Run 同一时间只能选择一条活动通路；
- DDF 断线不能导致客户端在状态未知时重复提交 Run；
- HepAI Worker 可以承载或调度 Runtime，但不管理 Workspace 和 Session。

## 10. V1 功能范围

### Workspace 与 Session

- 打开、列出和关闭远端 Workspace；
- 按 Workspace 列出、搜索、创建和恢复 Session；
- 创建、取消、审批和恢复 Run；
- Event 续传和 Checkpoint 恢复。

### Files、Git 与 PTY

- 目录树、元数据、搜索、流式读取和文件监听；
- 原子写入、预期摘要和并发冲突检测；
- Git status、diff、stage、revert、commit 和 `file-at-ref`；
- PTY create、write、resize、kill、attach 和输出缓冲。

### 连接可靠性

- OpenSSH 配置、`ProxyJump`、ssh-agent 和硬件密钥兼容；
- 主机级 Runtime 和隧道复用；
- 多 Workspace 重新注册；
- Runtime 重启识别、网络重连和 Event 补取；
- 不含凭据的诊断信息。

## 11. 现有实现迁移重点

此前 Remote SSH 实现已覆盖主机发现、Runtime/Gateway 安装、工作区注册、会话、文件、Git、PTY、Checkpoint 和重连等主体能力，但需要按本方案重新核对，不能沿用旧文档中的“已完成”结论作为最终验收结果。

优先修正：

1. 将旧的“Remote Gateway”整体命名统一为“Remote Full Agent Runtime”，Gateway 只表示网络入口。
2. 所有路由、监听、缓存和连接状态从绝对路径键迁移到 `workspace_id`。
3. 冻结 Session、Run、Event 和统一事件信封，补充 `sequence` 断线续传。
4. 重新生成 OpenAPI 客户端并恢复协议 drift check。
5. 核对 Runtime 安装目录、版本切换、健康检查和数据迁移回滚。
6. 移除核心流程对 DDF/HepAI Worker 的依赖，保留可选适配边界。
7. 将现有 Files、Git、Process、PTY、Checkpoint 调用收敛到 OWOP Schema 和 WorkspaceOperationsClient，Local、SSH 与 IF Binding 运行同一套合规测试。

## 12. 测试与验收

Windows 干净环境验收遵循 [Windows Sandbox 调用、验收与关闭规范](../../apps/desktop/windows/docs/WINDOWS_SANDBOX_OPERATIONS.md)。Windows Sandbox 运行打包后的 Desktop 客户端，可控 Linux Docker/VM 运行远端 Full Agent Runtime；`remote_3090` 使用专用低权限账户进行最终非破坏性烟测。

### 自动化测试

- 数据模型和 Run 状态机单元测试；
- OpenAPI、事件信封及错误模型契约测试；
- OWOP operation Schema、生成客户端和 Local/SSH/IF Binding 一致性测试；
- 同一套 WorkspaceOperationsClient 合规用例分别运行在 InProcess、Local IPC 和 SSH Runtime Binding；
- Fake SSH 双主机、多 Workspace、重连和失败注入 E2E；
- 真实 Runtime 安装、升级、回滚和重启 E2E；
- 文件并发冲突、符号链接越界和错误 Token 安全测试；
- PTY 断线 attach 和 Event `after_sequence` 补取测试；
- Windows Sandbox 内离线安装打包 Desktop，并连接可控 Linux Runtime 完成端到端验收；
- 使用 `windows-sandbox-session.ps1` 按 `Diagnose/List/Start/Stop` 控制会话，以 `wsb` 会话 ID 证明启动和关闭；
- PackageDir 只读、EvidenceDir 可写，Sandbox 禁网时仅凭 MSI 和 Runtime ZIP 完成安装；
- `remote_3090` 专用低权限账户真实环境烟测。

### 最终验收条件

- [ ] 两台主机相同路径不会串路由、Session、Event、监听或 PTY。
- [ ] 同一 Runtime 的多个 Workspace 共享连接且状态完全隔离。
- [ ] Agent、文件、Git、Shell 和测试均在指定远端 Workspace 执行。
- [ ] Desktop 断线不终止远端 Run，重连后无事件丢失或重复提交。
- [ ] 非法 Token、未知 Workspace、越界路径和并发写冲突均被拒绝。
- [ ] Runtime 安装或升级失败不破坏当前可用版本和状态数据。
- [ ] HepAI Worker 或 DDF 不可用不影响 V1 核心功能。
- [ ] Local 与 Remote Workspace 通过同一 OWOP operation、Schema、错误和 Event 语义完成 Files、Git、Process、PTY 和 Checkpoint 操作。
- [ ] HepAI IF 仅作为 OWOP Binding；关闭 IF/DDF 后 Local IPC 与 SSH Runtime Binding 仍完整可用。
- [ ] OpenAPI drift check、契约测试、安全测试和 E2E 全部通过。
- [ ] Windows Sandbox 内使用打包 Desktop 连接可控 Linux Runtime 完成全流程验收。
- [ ] Sandbox 客体关闭后，对应 `wsb` 会话 ID 已从 `wsb list` 消失。
- [ ] `remote_3090` 专用低权限账户完成非破坏性真实环境烟测。

只有以上验收项全部通过，远程工作区 V1 才能标记为正式完成。
