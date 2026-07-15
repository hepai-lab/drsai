# OpenDrSai 远程工作区技术方案

## 1. 定义

远程工作区不是远程文件夹挂载，而是绑定到远程计算机的一套完整开发与 Agent 执行环境：

```text
远程工作区 = 远程主机 + 工作目录 + 运行时 + 会话 + 权限
```

用户入口可称为“添加远程工作区”，连接类型为“Remote SSH”。代码、Git、Shell、Agent 和会话状态均在远程主机执行或保存，Desktop 只负责连接、展示与审批。

工作区必须使用稳定身份，不能只用路径：

```text
workspace_id = hash(SSH 主机身份 + 远程用户 + 规范化路径)
```

因此，两台主机上相同的 `/home/vscode` 属于两个不同工作区。

## 2. 系统分层

```text
Desktop Remote Workspace UI
        │
SSH Workspace Manager
        │ SSH 加密隧道
        ▼
Remote OpenDrSai Gateway
├── Workspace Registry
├── Session / Agent Run Manager
├── File / Git API
├── PTY Manager
├── Approval / Audit
└── HepAI Worker Adapter
        │
        ▼
远程文件、Git、Shell、模型与工具
```

### Desktop UI

- 发现 OpenSSH 主机并选择远程目录。
- 展示工作区、会话、文件、Git、终端、运行进度和审批。
- 不直接读取远程文件，也不在 Windows 上代替远端 Agent 执行工具。

### SSH Workspace Manager

- 复用系统 `ssh.exe`、`~/.ssh/config`、ssh-agent、ProxyJump 和硬件密钥。
- 负责认证、主机密钥确认、目录浏览、Gateway 运维、端口转发和自动重连。
- 每台主机维护一个连接对象，同一主机的多个工作区复用 Gateway 和 SSH 隧道。

### Remote OpenDrSai Gateway

- 是远程工作区的唯一执行入口和权威状态源。
- 注册多个 `workspace_id`，并对所有文件、Git、PTY 和 Agent 请求强制工作区隔离。
- 管理会话、Agent Run、审批、审计、断线恢复和能力协商。
- 仅监听远端 `127.0.0.1`，不向局域网或公网开放端口。

### HepAI Worker

- 作为 Agent 的可选模型或工具能力，由 Gateway 发现并注册。
- 不负责 SSH、工作区、会话或文件管理。
- Worker 超时或故障时降级，不能影响文件、Git、终端等核心能力。

## 3. 跨网络连接

Desktop 与 Gateway 不需要处于同一网络。Desktop 只需能够通过 SSH 到达远程主机：

```text
Desktop 请求本机 127.0.0.1:随机端口
        │
本机 ssh.exe
        │ 加密 SSH 连接，可经过 ProxyJump
        ▼
远程 SSH Server
        │
远端 127.0.0.1:18642
        ▼
OpenDrSai Gateway
```

典型隧道：

```powershell
ssh -N -L 127.0.0.1:49152:127.0.0.1:18642 remote_3090
```

SSH 提供网络可达性、主机认证和加密；Gateway 随机实例令牌提供应用层认证。HTTP 使用请求头传递令牌，WebSocket 使用连接后的首帧认证，令牌不得进入 URL 或日志。

## 4. Workspace、Agent 与 OpenDrSai

OpenDrSai 是运行和治理 Agent 的平台，不是某一个 Agent。

### Agent Definition

Agent Definition 是可跨工作区复用的执行策略，定义：

- 身份、名称和版本；
- instructions；
- 模型选择；
- 可申请的工具；
- 权限与上下文策略。

Agent Definition 本身不绑定工作区。

### Agent Run

一次实际执行必须绑定一个且仅一个主工作区：

```text
Agent Run = agent_id + workspace_id + thread_id + prompt + 有效权限
```

Gateway 创建 Agent Run 后，将抽象工具绑定到目标工作区：

```text
workspace.read_file  → 指定 workspace_id 下的相对路径
workspace.write_file → 工作区内写入与哈希冲突检查
git.diff             → 目标工作区仓库
terminal.execute     → 目标工作区远程 Shell
```

模型不能选择任意主机或绝对路径，`workspace_id` 由运行上下文注入。有效权限取 Agent、用户、工作区信任策略、Gateway 安全策略和审批结果的交集。

一个工作区可以同时拥有多个会话和 Agent Run；并发写入通过 checkpoint、文件哈希、Git diff、文件事件和审批控制。

## 5. 连接流程

1. Desktop 解析 OpenSSH 配置，并用 `ssh -G` 获取最终主机参数。
2. 系统 OpenSSH 完成认证和主机密钥校验。
3. 在远端执行 `realpath`，验证目录存在并生成稳定 `workspace_id`。
4. 检查远端 Python、Gateway 版本、协议和能力版本。
5. 显式安装或升级 Gateway；健康检查通过后才原子切换版本。
6. 建立 SSH 本地端口转发，生成仅存于内存的随机实例令牌。
7. Desktop 与 Gateway 握手并注册工作区。
8. 从 Gateway 获取该工作区的会话、文件、Git 和运行状态。
9. 断线后进入重连状态，指数退避恢复隧道，重新握手并注册该主机全部工作区。

## 6. 功能协议

### 工作区与会话

- 打开、查询和关闭工作区；
- 会话列表、详情、搜索和消息流；
- Agent Run 创建、暂停、恢复、停止和状态事件；
- checkpoint 创建、预览、接受和恢复。

### 文件与 Git

- 目录树、元数据、分页搜索和文件监听；
- 大文件流、文本、二进制和富媒体预览；
- 原子写入、预期 SHA-256 和冲突响应；
- Git 状态、diff、stage、revert、commit 和 `file-at-ref`；
- 所有路径经过 `resolve/realpath` 与符号链接越界检查。

### PTY

- 统一 `create/write/resize/kill/attach` 协议；
- PTY 属于指定 `workspace_id`；
- 支持输出缓冲、重连 attach、审批和审计。

### 能力协商

- Desktop 和 Gateway 协商协议版本与各能力版本。
- 不支持的能力必须在 UI 禁用，禁止回落到本地路径。
- Fork/Worktree 等功能只有在远端明确支持时才可启用。

## 7. 安全与运维

- 不读取、复制或上传 SSH 私钥，不默认启用 Agent Forwarding。
- Desktop 只持久化主机别名、规范路径和工作区 ID；令牌、端口和在线状态仅在内存保存。
- Gateway 只监听回环地址，令牌错误、未知工作区和路径越界请求均拒绝。
- HTTP 错误返回结构化错误码、可重试标记和关联 ID。
- 安装包校验 SHA-256；版本安装到独立 venv。
- `current` 与 `previous` 使用原子符号链接，安装失败不得破坏当前版本。
- 安装、升级、回滚、文件恢复、Git 写入和高风险 Shell 操作接入审批中心。
- 日志和诊断报告必须脱敏，不记录令牌、私钥或完整敏感环境变量。

## 8. 验收标准

- 能从 OpenSSH 配置发现主机、完成认证并浏览远程目录。
- 同一主机同时打开两个目录时，共享主机连接但文件、Git、会话和 PTY 相互隔离。
- 不同主机上的相同路径不会被识别成同一工作区。
- 新建会话和发送指令后，Agent、Shell、文件修改和测试均发生在远端。
- 暂停网络、重启 SSH 服务或 Gateway 后能够自动恢复并重新注册全部工作区。
- 错误令牌、未知工作区、符号链接越界和写入冲突均被拒绝。
- 安装中断、制品损坏、协议不兼容和启动失败不会破坏当前可用 Gateway。
- HepAI Worker 故障时核心 Remote SSH 能力保持可用。
- 单元、契约、Docker OpenSSH、真实 Gateway E2E 和 Windows 打包烟测全部通过。
- 最终在真实 Linux 主机和打包后的 Windows Desktop 上完成人工验收。

## 9. 当前实施状态

- 主机级 Gateway、多工作区、远程路由、自动重连、PTY、文件能力、HepAI Worker、能力协商、结构化错误和安全升级链路已经实现。
- 自动化测试已覆盖双工作区、文件监听、Git、PTY、Gateway 重启、网络恢复、升级和回滚。
- 尚需在配置好的真实 SSH 主机上完成最终人工验收。
