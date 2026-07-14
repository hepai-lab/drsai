# OpenDrSai Remote SSH 实现方案

## 目标与边界

Windows Desktop 只负责连接与展示；代码、Git、Shell、Agent 和会话状态均在远程 Linux 主机执行和保存。HepAI Worker 是 Gateway 可选调用的模型/工具能力层，不承担 SSH、工作区或会话管理。

## 分层

1. Desktop Remote Workspace UI：选择 OpenSSH 主机和远程目录，展示连接状态、会话与审批。
2. SSH Workspace Manager：复用 Windows `ssh.exe` 与 `~/.ssh/config`，负责发现、认证、目录浏览、Gateway 运维、端口转发和重连。
3. Remote OpenDrSai Gateway：工作区唯一执行入口和权威状态源，负责会话、Agent、文件、Git、PTY、审批与路径隔离。
4. HepAI Worker：由 Gateway 发现并注册为可选工具；不可用时不影响 Remote SSH 基础能力。

## 连接流程

1. 用 `ssh -G` 解析主机配置，以系统 OpenSSH 完成认证和主机密钥校验。
2. 在远端规范化并验证 Linux 工作区路径。
3. 检查 Python 与 Gateway 版本；安装/升级/回滚必须由显式操作触发。
4. Gateway 仅监听远端 `127.0.0.1`，Desktop 通过 `ssh -N -L` 建立本地隧道。
5. Desktop 携带随机实例令牌完成协议握手并注册稳定 `workspace_id`。
6. 会话、聊天、文件、Git 与终端请求按工作区路由至远端 Gateway；断线后指数退避重连并重新握手、注册和同步会话。

## 安全约束

- 不读取、复制或上传私钥，不默认开启 Agent Forwarding，不将 Gateway 暴露到公网。
- 主机别名、版本和路径均严格校验；Gateway 对工作区路径执行 `resolve/realpath` 和符号链接越界检查。
- Desktop 只持久化主机别名、规范路径和工作区 ID；令牌、本地端口与在线状态只保存在内存。
- 安装、升级、回滚、文件恢复、Git 写操作和工作区外写入必须经过显式操作或审批中心。
- 日志不得包含实例令牌、私钥或完整敏感环境变量。

## 远程 Gateway 运维

- 版本安装到 `~/.local/share/opendrsai/remote/releases/<version>` 的独立 venv。
- `current` 与 `previous` 使用原子符号链接切换，失败不覆盖现有可用版本；回滚交换二者。
- Gateway PID 与日志位于 `~/.local/share/opendrsai/remote/`；启动新实例前终止旧 PID。

## 验收

- 从 OpenSSH 配置发现主机，认证并浏览远程目录。
- 选择远程工作区后加载该工作区真实会话；聊天、文件、Git 和终端操作发生在远端。
- Gateway 只监听回环地址，令牌错误和路径越界请求被拒绝。
- SSH 中断时显示重连状态，恢复后重新以 Gateway 数据同步。
- Gateway 支持显式安装、升级和回滚；HepAI Worker 故障不影响核心功能。
- 单元、集成以及 Docker Linux OpenSSH 真实链路 E2E 全部通过。

## 后续开发路线

当前实现定位为已经打通核心链路的 MVP。继续开发应先处理正确性和连接模型，再扩展产品体验。

### P0：正确性与生产可用性

#### 主机级 Gateway 与多工作区

- 每台远程主机只运行一个 Gateway，并通过一条 SSH 隧道复用连接。
- Gateway 同时注册多个 `workspace_id`，所有请求必须显式携带工作区身份。
- Desktop 维护主机连接、工作区引用和窗口引用；关闭一个工作区不得影响同主机其他工作区。
- 最后一个引用释放后才允许关闭隧道；Gateway 可以按策略继续驻留或退出。
- 验收：同一主机同时打开两个目录，两者会话、文件、Git 和终端相互隔离且均可使用。

#### 完整断线恢复

- Desktop 启动时恢复持久化的远程工作区，并按需重新建立主机连接。
- SSH 或 Gateway 中断后指数退避重连，重新握手、注册全部工作区并同步会话。
- 连接状态通过事件推送给 Renderer，明确展示连接中、在线、重连中、失败和恢复。
- 连接失败必须清理残留隧道、计时器和内存记录。
- 验收：暂停网络、重启 SSH 服务和重启 Gateway 后均可自动恢复，不产生重复进程。

#### 补齐远程路由

- checkpoint 创建、列表、预览、接受和恢复全部在远端执行。
- folder summary、Git `file-at-ref`、附件内容、会话详情与搜索通过 Gateway 获取。
- Fork/Worktree 操作必须明确支持远端，或在能力协商中禁用，不得回落到本地路径。
- 验收：远程工作区的任何文件系统操作都不会访问 Windows 上的同名路径。

#### 安装、升级和回滚安全链路

- 检测 managed venv 的真实版本及协议兼容性。
- 支持固定制品或 Desktop 上传安装包，并校验 SHA-256/签名。
- 安装和升级先写入新版本目录，健康检查通过后原子切换；失败自动保留或回滚当前版本。
- 操作接入审批中心，展示可脱敏的进度和日志，不默认依赖远端公共 PyPI。
- 验收：安装中断、版本不兼容、制品损坏和启动失败均不会破坏当前可用版本。

### P1：完整产品体验

- 远程目录浏览器：目录树、面包屑、Home/父目录、最近路径、隐藏文件和权限提示。
- Gateway PTY：统一 create/write/resize/kill/reconnect 协议，支持审计、审批和断线恢复。
- 文件能力：元数据、Git 状态、分页搜索、文件监听、大文件流、二进制与富媒体预览、写入冲突检测。
- HepAI Worker：识别 `remote_callable`，注册 Agent 工具，支持启用/禁用、独立鉴权、超时、审计和降级。

### P2：工程、安全与可观测性

- 完整支持 OpenSSH `Include`、`Match`、ProxyJump、ssh-agent、硬件密钥和主机密钥交互。
- 独立协议类型包、能力协商、结构化错误码、关联 ID 和 OpenAPI 生成客户端。
- 主机级连接日志、阶段耗时、重连指标和一键脱敏诊断报告。
- 使用真实 OpenDrSai Gateway 的 Docker E2E，覆盖多工作区、断线、升级回滚、Git 变更和 PTY。
- 在真实 Linux 主机及打包后的 Windows 应用上进行最终人工验收。

### 推荐执行顺序

```text
主机级多工作区 Gateway
→ 完整断线恢复
→ checkpoint/附件/Git 等远程路由
→ 安装升级安全链路
→ Gateway PTY
→ HepAI Worker 工具注册
→ 完整生产 Gateway E2E
```

## 实施状态（2026-07-14）

- P0、P1、P2 的代码功能均已完成；真实 Gateway Docker E2E 已覆盖双工作区、断线恢复、升级回滚、Git、文件监听与 PTY。
- Remote SSH Node 类型检查、HepAI 降级单测、OpenAPI 生成漂移校验、契约/集成测试、checkpoint 测试、真实 Gateway E2E 及 Windows 打包烟测均已通过。
- WebSocket 令牌使用首帧认证，不进入 URL/访问日志；HTTP 错误统一携带结构化错误码和关联 ID。
- 尚待环境验收：当前 OpenSSH 配置中没有可连接的 `remote_3090` 别名，因此该指定物理主机上的人工验收需在主机配置恢复后执行。
