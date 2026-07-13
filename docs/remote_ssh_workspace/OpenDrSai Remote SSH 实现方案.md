# OpenDrSai Remote SSH 实现方案

## 1. 目标

在 OpenDrSai Desktop 中增加 Codex 风格的 Remote SSH 工作区：

- 从 OpenSSH 配置发现远程主机。
- 选择远程主机上的目录作为工作区。
- Agent、文件操作、Shell、Git、会话和凭据均位于远程主机。
- Desktop 作为薄客户端，展示事件、终端输出、审批和会话历史。
- HepAI Worker 负责可注册、可共享的远程模型和科学工具，不承担工作区管理。

## 2. 分层架构

```text
OpenDrSai Desktop
├── Remote Workspace UI
└── SSH Workspace Manager
    ├── SSH Config Discovery
    ├── Remote Directory Browser
    ├── Gateway Bootstrap
    └── SSH Port Forwarding
                 │
                 ▼
Remote OpenDrSai Gateway
├── Workspace Context
├── Session Lifecycle
├── Agent Runtime
├── File / Shell / Git Tools
├── Event and Approval Protocol
└── SQLite Session Store
                 │
                 ▼
HepAI Worker（可选）
├── GPU 模型
├── 科学工具
├── DDF 注册与发现
└── 统一鉴权和权限控制
```

### 2.1 SSH Workspace Manager

运行在 Desktop 主进程，负责建立和维护远程工作区连接，不执行 Agent 任务：

- 解析 `~/.ssh/config`，支持别名、端口、用户、密钥和 `ProxyJump`。
- 通过 SFTP 或受控远程命令浏览目录。
- 检查远程 Python、OpenDrSai 版本和 Gateway 状态。
- 按需安装或升级兼容版本的远程 Gateway。
- 在远程回环地址启动 Gateway。
- 建立本地端口到远程 Gateway 的 SSH 隧道。
- 监测 SSH、隧道和 Gateway 健康状态并负责重连。

### 2.2 OpenDrSai Gateway

Gateway 是远程环境的唯一执行入口和状态权威来源。复用现有 `drsai.backend.tui_gateway`，保留 JSON-RPC 2.0、WebSocket、事件流和交互式审批机制：

- 创建、列出、恢复、中断和关闭会话。
- 维护每个会话的工作目录和 Agent 生命周期。
- 在远程主机执行文件、Shell、Git、构建和测试操作。
- 持久化会话、消息、任务状态和工作区元数据。
- 推送流式输出、工具事件、错误和审批请求。
- 校验所有文件路径不越过授权的工作区根目录。

### 2.3 HepAI Worker

HepAI Worker 作为 Gateway 可调用的能力层，而不是 Remote SSH 的连接层。

适合承载：

- GPU 推理服务和专业模型。
- 可独立部署、注册和共享的科学工具。
- 需要 DDF 服务发现、API Key 或用户组权限的能力。

不负责 SSH 主机发现、目录浏览、工作区文件系统、Shell 和 Desktop 会话恢复。

## 3. 核心连接流程

1. Desktop 读取 OpenSSH 配置并展示可用主机。
2. 用户选择主机，Desktop 使用现有 SSH 凭据建立连接。
3. Desktop 浏览远程目录，用户选择工作区根目录。
4. Workspace Manager 检查远程 Gateway 版本和运行状态。
5. 未运行时，在远程主机启动：

   ```text
   python -m drsai.backend.tui_gateway --workspace /home/vscode --ws-host 127.0.0.1
   ```

6. Desktop 建立 SSH 本地端口转发，Gateway 不直接暴露公网端口。
7. Desktop 通过隧道连接 Gateway WebSocket，完成版本、能力和工作区握手。
8. Desktop 调用 `workspace.open` 和 `session.list` 加载远程会话。
9. 用户提交指令后，Gateway 在远程工作区内运行 Agent 并实时返回事件。

## 4. 协议设计

沿用现有 JSON-RPC 2.0，补充工作区能力。

### 4.1 握手

```json
{
  "method": "gateway.handshake",
  "params": {
    "client_version": "...",
    "protocol_version": 1,
    "workspace_path": "/home/vscode"
  }
}
```

返回 Gateway 版本、协议版本、平台、能力列表和规范化后的工作区路径。不兼容时拒绝连接。

### 4.2 工作区接口

- `workspace.open`：打开并验证工作区。
- `workspace.info`：返回路径、Git 根目录和能力信息。
- `workspace.list_directory`：浏览允许范围内的目录。
- `workspace.close`：释放当前客户端的工作区引用。

### 4.3 会话接口

复用并完善：

- `session.list`
- `session.create`
- `session.resume`
- `session.interrupt`
- `session.close`
- `prompt.submit`
- `approval.respond`

每个会话至少持久化 `session_id`、`workspace_id`、`workspace_path`、`user_id`、时间、状态、模型配置和消息。会话列表必须由远程 Gateway 按工作区过滤，不能以 Desktop 缓存为准。

## 5. 数据归属

- 源码、Git 仓库、Shell 进程和项目凭据位于远程主机。
- 会话数据库和运行状态由远程 Gateway 持有。
- Desktop 只保存主机配置、工作区书签和可重建的展示缓存。
- 重连后以 Gateway 数据重新同步，Desktop 缓存不是权威来源。
- HepAI Worker 保存自身服务配置和执行状态，不保存 Remote SSH 工作区会话。

## 6. 安全设计

- Gateway 默认仅监听 `127.0.0.1`，远程访问必须经过 SSH 隧道。
- 不复制或上传用户私钥，认证完全交给本机 OpenSSH。
- 不默认启用 SSH Agent Forwarding。
- 远程安装、升级、sudo 和工作区外写入必须单独审批。
- 对路径执行 `realpath` 校验，防止 `..` 和符号链接越界。
- Gateway 以普通 SSH 用户运行，禁止默认使用 `root`。
- 握手时校验 Gateway 身份令牌。
- 日志不得返回私钥、令牌或环境变量完整值。
- HepAI Worker 调用继续使用其 API Key、用户和用户组权限体系。

## 7. 代码改造

### 可复用

- `cores/python/packages/drsai/src/drsai/backend/tui_gateway/`
  - JSON-RPC 分发、WebSocket Transport、会话、事件和审批机制。
- Desktop 已有 Gateway API、会话 UI 和事件展示逻辑。
- HepAI `HWorkerAPP`、`HRModel.remote_callable` 和 DDF 接入机制。

### 需要重写

- `apps/desktop/drsai-desktop/src/main/ssh-remote.ts`
- `apps/desktop/drsai-desktop/src/main/ssh-tunnel.ts`
- `apps/desktop/drsai-desktop/src/main/ssh-options.ts`

这些文件当前是 stub。应重新实现独立的 SSH Workspace Manager，让 Desktop 通过统一 Gateway Client 访问本地和远程环境。

### 建议新增

```text
src/main/remote-workspace/
├── ssh-config.ts
├── ssh-client.ts
├── directory-browser.ts
├── gateway-bootstrap.ts
├── port-forwarder.ts
├── connection-manager.ts
└── types.ts

tui_gateway/handlers/workspace.py
tui_gateway/workspace_context.py
tui_gateway/security/path_policy.py
```

## 8. 分阶段实施

### 阶段一：最小闭环

- 手工填写 SSH 主机参数。
- 连接远程主机并检查 OpenDrSai。
- 启动远程 Gateway 和本地端口转发。
- 从远程 Gateway 加载会话并发送指令。
- 验证文件和 Shell 操作确实发生在远程主机。

### 阶段二：远程工作区

- 解析 OpenSSH 配置。
- 增加远程目录浏览器。
- 会话按工作区过滤和持久化。
- 增加版本协商、断线重连和健康检查。

### 阶段三：安全与维护

- 工作区路径隔离和审批策略。
- Gateway 安装、升级和版本回滚。
- 主机密钥变化提示及连接审计。
- 多窗口、多工作区和并发会话测试。

### 阶段四：HepAI 集成

- 在远程 Gateway 中发现允许使用的 HepAI Worker。
- 将 Worker 的 `remote_callable` 注册为 Agent 工具。
- 保持工作区权限与 Worker 权限相互独立。
- UI 明确区分远程主机操作和 HepAI 服务调用。

## 9. 验收标准

- 选择 `remote_3090:/home/vscode` 后，可以列出该远程工作区的真实会话。
- 新建会话、修改文件、运行命令和测试均发生在 `remote_3090`。
- 关闭 Desktop 后重新连接，远程会话可以恢复。
- Gateway 端口不对远程主机公网网卡开放。
- 工作区路径逃逸请求被拒绝并记录。
- SSH 断开时 UI 明确显示离线，重连后从 Gateway 重新同步状态。
- HepAI Worker 不可用时，Remote SSH 基础功能仍能正常工作。

