# OpenDrSai ORCA_INSPIRED 开发方案更新：全自动验收

## 1. 已实现模块与功能点

| 模块 | 已实现功能点 | 状态 |
| --- | --- | --- |
| Runtime/Gateway | 生命周期、健康检查、能力发现、Session/Run/Event、恢复与重连 | 已实现 |
| Codex Agent Backend | Codex Adapter、App Server 进程管理、JSON-RPC、登录、模型、取消、审批、错误映射 | 已实现 |
| Codex 会话 | 多轮复用、Runtime Session 与 Codex Thread/Turn 绑定、流式事件 | 已实现 |
| 结构化输出 | reasoning、工具调用、命令、文件变更、状态事件、时间线映射 | 已实现 |
| Workspace Registry | 本地/远程注册、已有文件夹导入、路径规范化、状态刷新 | 已实现 |
| OWOP | Files、Search、Watch、Git、Process、PTY、Checkpoint、Artifact 基础操作 | 已实现基础能力 |
| SSH Manager | 主机发现、认证、Runtime 安装、隧道、重连、远程工作区注册 | 已实现 |
| Worktree | 创建、绑定、Diff、Review、Merge-back、冲突保留、归档与清理 | 已实现主要流程 |
| Desktop UI | 工作区切换、会话列表、结构化会话区、归档/取消归档、终端和诊断 | 已实现 |
| 稳定性 | Renderer reload、Desktop/Runtime 重启恢复、事件恢复、线程文件容错读取 | 已实现并持续回归 |

已有文件夹创建工作区后，Desktop 会重新读取线程索引，因此 OpenDrSai 自己保存的历史会话可以在工作区创建或切换后显示。Codex Desktop 原生 SQLite 历史线程导入仍是后续兼容导入功能，不作为本阶段隐式数据源。

## 2. 新增全自动验收模块

### 2.1 Acceptance Orchestrator

- 创建和销毁一次性验收环境；
- 编排 Sandbox、Runtime、Host Bridge、Codex App Server；
- 生成 run id、环境描述和能力快照；
- 支持 smoke、regression、release 级别；
- 关键依赖不可用时 fail closed。

### 2.2 OpenDrSai Acceptance Sandbox

- 在隔离目录启动 Desktop/Runtime/Test Runner；
- 提供临时 Workspace、Git 仓库和测试配置；
- 禁止测试进程直接读取宿主机 Codex 数据库或任意宿主机文件；
- 自动收集 Runtime、Desktop、Bridge 日志和测试证据；
- 验收结束自动清理临时目录、进程和端口。

### 2.3 Host Codex Bridge

- 在宿主机托管 Codex App Server；
- 仅暴露受控端口；
- 使用一次性 token、请求签名、能力白名单和来源校验；
- 仅转发 Session/Run/Event/Approval 所需操作；
- 不暴露任意命令执行、SQLite 写入或宿主机路径遍历；
- 支持 Codex 健康检查、版本检查和断线重连。

### 2.4 Fixture/Scenario Registry

- 已有文件夹工作区导入；
- Codex 首轮和多轮会话复用；
- 流式输出与结构化事件；
- reasoning、tool call、command、file change 映射；
- 归档和取消归档；
- Runtime、Desktop、Bridge 重启恢复；
- Sandbox 与宿主机 Codex 断线/恢复；
- 本地 Workspace 与远程 SSH Workspace 对称验证；
- 权限、审批、审计和 fail-closed。

### 2.5 Evidence Collector and Acceptance Gate

- 保存输入、输出、事件序列和状态转移；
- 校验 session/run/thread/turn/workspace 关联完整性；
- 生成 JSON 和 Markdown 报告；
- 对失败分类为环境、协议、功能或安全失败；
- 必选场景未全部通过时阻断 release-ready；
- 自动脱敏 token、凭据、宿主机路径和敏感内容。

## 3. 全自动验收流程

```text
prepare host Codex
  -> start Host Codex Bridge
  -> create isolated Sandbox
  -> start OpenDrSai Runtime/Desktop test target
  -> handshake and capability check
  -> run workspace/OWOP scenarios
  -> run Codex session/run/event scenarios
  -> inject restart/network/archive failures
  -> collect evidence
  -> evaluate acceptance gate
  -> cleanup processes, ports and temporary data
  -> publish report
```

## 4. 建议命令与通过标准

```text
npm run verify:sandbox-host-codex
npm run verify:sandbox-host-codex -- --level regression
npm run verify:sandbox-host-codex -- --level release --report .\\artifacts\\acceptance
```

通过标准：Sandbox 内 Desktop/Runtime 能启动并创建工作区；能通过 Bridge 调用宿主机 Codex 并收到连续流式事件；多轮消息保持同一 Session/Thread；结构化事件、文件变更和终态一致；重启/断线后不重复提交 Run；归档状态一致；Bridge 无越权访问；所有必选场景有脱敏证据；cleanup 后无残留进程和端口。

## 5. 实施阶段

| 阶段 | 模块 | 交付结果 |
| --- | --- | --- |
| A0 | Orchestrator、Fixture Registry | 单命令启动验收 |
| A1 | Host Codex Bridge | Sandbox 安全连接宿主机 Codex |
| A2 | Sandbox Harness | OpenDrSai 隔离启动 |
| A3 | Scenario Runner | 自动执行核心功能场景 |
| A4 | Fault Injection | 自动验证断线、重启和恢复 |
| A5 | Evidence/Gate | 自动报告并阻断不合格发布 |
| A6 | Packaged Acceptance | 对最终安装包执行完整验收 |

本文件是《ORCA_INSPIRED_开发方案》的验收扩展，原方案中的沙盒验证排除项仅指产品运行时安全沙盒，不影响本验收专用隔离环境。
