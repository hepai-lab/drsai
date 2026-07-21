# OpenDrSai ORCA_INSPIRED 开发方案

> 状态：设计草案  
> 日期：2026-07-17  
> 适用范围：OpenDrSai Desktop、Local/Remote Full Agent Runtime、OWOP、SSH Manager  
> 参考：Orca 的 Worktree-native 工作模式、主进程持有终端状态、SSH 远程体验  
> 明确排除：Orca CLI Orchestration、多 Agent Task/Dispatch/Decision Gate

## 1. 目标与结论

本方案吸收 Orca 的三个设计方向：

1. 每个开发任务可以拥有独立 Git Worktree，并具有可审查、可合并、可归档的完整生命周期；
2. 终端状态由 Runtime 权威持有，Renderer 只负责显示，页面重载、窗口重建和网络重连不再等价于终端退出；
3. 本地与远程 Workspace 使用相同的 Worktree、Files、Git、Process、PTY 和 Event 语义，仅底层 Binding 不同。

本方案不修改 OpenDrSai 已确定的核心架构：

```text
Codex Agent Backend = Codex Adapter + Codex App Server

OpenDrSai Runtime Protocol
├─ Session / Run / Agent Event
├─ Permission / Approval / Audit
└─ OpenDrSai Workspace Operation Protocal（OWOP）
   ├─ Workspace / Worktree
   ├─ Files / Search / Watch
   ├─ Git
   ├─ Process / PTY
   └─ Checkpoint / Artifact
```

Orca 的 PTY + Hook + Transcript Agent 接入方式不进入 Codex Agent Backend。PTY 仍是 Workspace 能力和通用 CLI 兼容能力，不是 Codex 的主控制协议。

## 2. 当前实现基线

### 2.1 已有能力

当前代码已经具备以下可复用基础：

- `WorkspaceOperationsClient`、OWOP 1.0 Schema、Python/TypeScript 生成类型；
- Local InProcess、Local IPC 和 Remote Runtime 调用路径；
- Files、Git、Watch、Checkpoint、Process、PTY 的基础操作；
- Windows `node-pty/ConPTY` Provider 和 Runtime 进程树清理；
- `LocalRuntimeClient` 与 `RemoteRuntimeClient` 统一接口；
- SSH 隧道、Remote Runtime、远程 Workspace 注册和断线重连基础；
- 本地和远程 Worktree 创建能力；
- Fork Worktree 的 merge-back、冲突保留、分支归档和清理审批；
- Codex Adapter + Codex App Server 的 Session/Run/Event/Approval/Cancel 映射。

### 2.2 现有差距

| 领域 | 当前实现 | 目标状态 |
| --- | --- | --- |
| Worktree 模型 | 主要挂在 Desktop Thread 的 `fork` metadata 上 | Runtime Registry 中的一等 `Worktree` 资源 |
| Worktree 执行 | 本地主要由 `forkWorktrees.ts` 直接执行 Git；远程另走 Gateway 路径 | Local/Remote 都通过同一组 OWOP Worktree 操作 |
| Worktree 生命周期 | create/merge/cleanup 已存在，但缺少统一状态机和恢复扫描 | create → active → review → merged/archived → removed |
| 终端所有权 | Electron Main 内存 Map，按 Renderer `ownerId` 绑定 | Full Agent Runtime 权威持有，Desktop 只是订阅者 |
| Renderer 销毁 | 当前会调用 `killTerminalsForOwner` | 默认 detach，不终止 PTY |
| 输出恢复 | 20 万字符字符串缓冲；远程重连传整段 buffer | sequence + bounded journal + snapshot + delta replay |
| 终端屏幕状态 | Renderer xterm 自己重建 | Runtime 维护 headless screen snapshot |
| SSH 状态 | 已有主机连接与隧道，但状态和错误来源较分散 | 主机级连接状态机、复用隧道、诊断和恢复策略统一 |
| Remote 体验 | Files/Git/PTY/Runtime 已可用 | Worktree、PTY lease、端口转发和重连形成完整产品闭环 |

### 2.3 复用与迁移边界

直接复用：

- `cores/python/packages/drsai/src/drsai/owop/`
- `cores/python/packages/drsai/src/drsai/backend/runtime_registry.py`
- `cores/python/packages/drsai/src/drsai/backend/runtime_engine.py`
- `apps/desktop/windows/src/main/runtimeClient.ts`
- `apps/desktop/windows/src/main/remoteWorkspace.ts`
- `apps/desktop/windows/src/main/runtimeReliability.ts`
- `apps/desktop/windows/src/main/sshExecutable.ts`
- `apps/desktop/windows/src/main/remotePtyLifecycle.ts`
- `apps/desktop/windows/src/renderer/src/components/TerminalPanel.tsx`
- 现有 Fork Worktree UI、Approval Center、Git Diff 和 Workspace UI。

迁移后保留兼容入口：

- `forkWorktrees.ts` 逐步变为 OWOP Worktree Client 的兼容 Facade，不再直接拥有权威状态；
- `terminal.ts` 逐步变为 Runtime PTY Client 和 Renderer 投影层，不再拥有 PTY 生命周期；
- `remoteWorkspace.ts` 继续承载 Desktop SSH 编排，但 Files/Git/Worktree/PTY 业务语义全部经 Runtime/OWOP；
- 旧 `DesktopThreadForkMetadata` 在迁移期保存 `worktree_id` 投影，禁止继续扩展第二套生命周期字段。

## 3. 目标架构

```text
OpenDrSai Desktop
├─ Workspace / Worktree UI
├─ Source Control / Diff / Review UI
├─ Terminal Renderer（xterm.js）
├─ Runtime Client
└─ SSH Manager
   ├─ OpenSSH Config / Host Profile
   ├─ Host Connection State Machine
   ├─ Runtime 安装、升级、健康检查
   ├─ SSH Tunnel Pool / Reconnect
   └─ Port Forward Manager
              │
              │ Local IPC 或 SSH Local Port Forward
              ▼
OpenDrSai Full Agent Runtime（Local Windows / Remote Linux）
├─ Gateway / Runtime Protocol
├─ Workspace Registry
│  ├─ Workspace
│  └─ Worktree Registry
├─ Workspace Operation Service（OWOP）
│  ├─ Git Worktree Service
│  ├─ Files / Git / Watch
│  ├─ Process / PTY
│  └─ Checkpoint / Artifact
├─ Terminal State Service
│  ├─ PTY Lifecycle
│  ├─ Output Journal
│  ├─ Headless Screen Model
│  ├─ Snapshot / Replay
│  └─ Lease / Attach / Detach
├─ Session / Run / Event Runtime Engine
└─ Agent Core
   ├─ OpenDrSai Agent Backend
   └─ Codex Agent Backend
      ├─ Codex Adapter
      └─ Codex App Server
```

### 3.1 状态权威

| 状态 | 权威来源 |
| --- | --- |
| Workspace / Worktree identity | Workspace Registry |
| Worktree 生命周期 | Runtime Worktree Registry + Git 实际状态 |
| Files / Git 状态 | Workspace 所在 Runtime |
| PTY 进程与输出 sequence | Terminal State Service |
| Renderer 画面 | Runtime snapshot + replay 的本地投影 |
| SSH 主机连接与隧道 | Desktop SSH Manager |
| Session / Run / Agent Event | Runtime Engine |
| Codex Thread / Turn | Codex Agent Backend |

### 3.2 本地与远程统一

```text
Local Workspace
Desktop → RuntimeClient → Local Runtime → OWOP InProcess/Local IPC

Remote Workspace
Desktop → RuntimeClient → SSH Tunnel → Remote Runtime → OWOP InProcess
```

Desktop 不通过 SSH 命令、SFTP 或本地 Git 另行实现一套 Worktree/Files/Git/PTY 业务语义。SSH 只负责连接、部署、隧道和恢复；Workspace 操作由远端 Runtime 权威执行。

## 4. 模块与功能点统计

本方案共 **10 个模块、80 个功能点**。

| 模块 | 名称 | 功能点 |
| --- | --- | ---: |
| OI01 | 架构契约与领域模型 | 8 |
| OI02 | Worktree Registry 与生命周期 | 8 |
| OI03 | OWOP Git Worktree Service | 8 |
| OI04 | Worktree Desktop 产品集成 | 8 |
| OI05 | Runtime-owned Terminal State | 8 |
| OI06 | Terminal Snapshot、Replay 与恢复 | 8 |
| OI07 | SSH Host 与 Connection Manager | 8 |
| OI08 | Remote Runtime、PTY Lease 与端口转发 | 8 |
| OI09 | 安全、可观测性与兼容迁移 | 8 |
| OI10 | 测试、性能、打包与发布验收 | 8 |
| **合计** |  | **80** |

## 5. 模块详细设计与测试验证

## OI01 架构契约与领域模型（8 项）

### 功能点

- **OI01-F01**：定义 `WorktreeId`、`TerminalId`、`TerminalLeaseId`、`HostProfileId` 和 `PortForwardId`，所有 ID 由权威服务生成。
- **OI01-F02**：定义 `Source Workspace → Worktree Resource → Worktree Workspace → Session/Run/Terminal` 关系；Worktree Workspace 有独立 `workspace_id`，但不是第三种 location，而是同一 Local/Remote Workspace 模型的 Git 派生实例。
- **OI01-F03**：定义 Worktree 状态机：`creating → active → review → merge_pending → merged | archived → removing → removed`，失败状态保留可恢复信息。
- **OI01-F04**：定义 Terminal 状态机：`starting → running → detached → reconnecting → exited | lost`，Transport 断开不能直接映射为 `exited`。
- **OI01-F05**：冻结 Local/Remote 相同的 Worktree、PTY、Event 和 Error Schema；Binding 差异不能进入 UI 领域模型。
- **OI01-F06**：明确 Worktree 生命周期属于 OWOP/Workspace Runtime，不属于 Agent Backend；Codex Adapter 只接收已解析的 Workspace/Worktree cwd。
- **OI01-F07**：明确 Terminal State Service 属于 Full Agent Runtime；Electron Main 只保存订阅游标和 UI 投影。
- **OI01-F08**：增加依赖边界门禁，禁止 Renderer 直接执行 Git/SSH/PTY，禁止 Desktop Worktree 代码绕过 OWOP。

### 测试验证

- Python/TypeScript 对同一组领域 Fixture 完成 JSON 往返；
- 非法状态迁移、跨 Workspace 引用、Local/Remote 字段混用全部失败；
- 依赖扫描确认 Renderer 无 `child_process`、SSH 和 Git lifecycle 调用；
- Codex Adapter 测试确认不依赖 Worktree/Terminal 的 Desktop 实现。

## OI02 Worktree Registry 与生命周期（8 项）

### 功能点

- **OI02-F01**：在 Runtime Registry 增加 Worktree 持久化表，保存 source workspace、repo root、path、branch、base commit、状态和时间戳。
- **OI02-F02**：Worktree 创建采用幂等键；重复请求返回同一资源，不重复创建分支或目录。
- **OI02-F03**：创建前校验 Git repository、目标路径、分支名、磁盘空间、现有 worktree 冲突和 source dirty 状态。
- **OI02-F04**：Runtime 启动时执行 reconcile，将 Registry 与 `git worktree list --porcelain` 对账，识别 missing、orphaned 和 prunable 项。
- **OI02-F05**：为 Worktree 注册独立执行 `workspace_id`，并保存 `source_workspace_id + worktree_id` 关系；Session、Run 和 Terminal 绑定执行 Workspace，不能继续写入 Source Workspace。
- **OI02-F06**：merge-back 前检查 source/fork dirty、HEAD 漂移和冲突；发生冲突进入 `merge_pending`，不得静默覆盖。
- **OI02-F07**：未合并分支清理时先归档分支；已合并分支只能使用安全删除，禁止默认强删未合并工作。
- **OI02-F08**：Worktree 删除采用两阶段流程：停止新绑定 → 检查活动资源 → Approval → Git remove/prune → Registry tombstone。

### 测试验证

- 临时真实 Git 仓库验证 create/list/reconcile/merge/archive/remove 全生命周期；
- 注入创建响应丢失、Runtime 重启和数据库写入失败，验证幂等恢复；
- 构造 source dirty、fork dirty、HEAD 漂移和 merge conflict，确认状态可恢复且文件不丢失；
- 20 个并发创建请求不产生重复 ID、分支或路径。

## OI03 OWOP Git Worktree Service（8 项）

### 功能点

- **OI03-F01**：扩展 OWOP Schema：`git.worktree.list/create/describe/merge/archive/remove/prune`。
- **OI03-F02**：每个 operation 有独立 Request/Response Schema，禁止退化为 arbitrary JSON invoke。
- **OI03-F03**：从同一 Schema 生成 Python/TypeScript 类型，并建立 Schema digest 和零漂移门禁。
- **OI03-F04**：Local InProcess、Local IPC、SSH Runtime Binding 运行同一套 Worktree 合规测试。
- **OI03-F05**：所有 Git 命令使用 argv 数组、固定 cwd 和超时；不拼接 shell command。
- **OI03-F06**：Worktree 事件进入统一 Workspace Event：created/status_changed/conflict/merged/archived/removed。
- **OI03-F07**：写操作执行固定的 Permission → Approval → Operation → Audit 顺序，并支持 idempotency key。
- **OI03-F08**：把现有 `forkWorktrees.ts` 和 `/worktrees` Gateway 特例迁移到 OWOP Client，迁移期只保留薄兼容层。

### 测试验证

- Schema codegen 后工作树必须零 diff；
- 所有 Binding 对成功结果、错误码、事件顺序和审计字段逐字段一致；
- 参数注入、非法 branch、路径越界、junction/symlink 越界被拒绝；
- 旧 Desktop API 与新 OWOP API 在兼容期对同一 Fixture 返回等价结果。

## OI04 Worktree Desktop 产品集成（8 项）

### 功能点

- **OI04-F01**：Workspace UI 增加 Worktree 列表，显示 branch、base、dirty、ahead/behind、活动 Session/Run/Terminal 和生命周期状态。
- **OI04-F02**：支持从当前 Workspace 创建独立 Worktree，并在创建完成后自动注册和打开。
- **OI04-F03**：Thread/Session 可以选择 Source Workspace 或 Worktree Workspace；切换 Backend 不改变执行 `workspace_id` 和 `worktree_id`。
- **OI04-F04**：统一 Review 面板展示 Worktree diff、commit、冲突、测试结果和 merge readiness。
- **OI04-F05**：merge、archive、remove 使用 Approval Center；UI 明确说明影响的分支、目录和活动资源。
- **OI04-F06**：Worktree 状态由 Runtime Event 增量更新，Renderer 不通过轮询 Git 自行推断权威状态。
- **OI04-F07**：本地和远程 Worktree 使用同一组件和交互，仅展示位置、主机和连接状态差异。
- **OI04-F08**：兼容现有 Fork Thread 数据；首次读取生成 `worktree_id` 绑定，失败时保留旧数据并给出可操作诊断。

### 测试验证

- Component 测试覆盖 empty/creating/active/dirty/conflict/merged/archived/offline 状态；
- E2E 完成创建 → Codex Run → 查看 diff → commit → merge → cleanup；
- 相同 E2E 分别运行在 Local Runtime 和可控 Linux Remote Runtime；
- 迁移 Fixture 验证旧 Fork Thread 可打开、可审查、可继续完成生命周期。

## OI05 Runtime-owned Terminal State（8 项）

### 功能点

- **OI05-F01**：将 PTY 进程、metadata、buffer 和生命周期权威从 Electron Main 移入 Full Agent Runtime 的 Terminal State Service。
- **OI05-F02**：扩展 OWOP PTY 能力：`pty.list/describe/create/write/resize/attach/detach/kill`，复用现有 operation 而不建立第二套 Terminal 协议。
- **OI05-F03**：Terminal 与 `runtime_id/workspace_id/worktree_id` 绑定；cwd 必须由 Registry 解析，禁止客户端提交权威绝对路径。
- **OI05-F04**：Renderer/WebContents 销毁默认执行 detach，不再调用 kill；kill 必须是明确用户操作、策略或 Runtime shutdown policy。
- **OI05-F05**：一个 Terminal 支持单写者和多个只读订阅者；写租约冲突返回结构化错误。
- **OI05-F06**：Runtime 维护有界输出 journal，限制单条事件、总字节、保留时长和慢消费者 backlog。
- **OI05-F07**：PTY 退出保留 exit code、signal、结束时间和尾部输出；终态按 retention policy 回收。
- **OI05-F08**：Runtime 启动时将无法恢复的旧 PTY 收敛为 `lost/exited`，禁止永久显示 running。

### 测试验证

- Renderer reload、窗口重建和订阅者断开后 PTY 继续运行并可重新 attach；
- 双写者、慢订阅者、buffer 超限、kill 幂等和进程树退出测试通过；
- 10 Workspace × 5 Terminal 并发输出不串流；
- Runtime 被终止后重启，旧 Terminal 必须确定性进入 lost/exited 并保留诊断尾部。

## OI06 Terminal Snapshot、Replay 与恢复（8 项）

### 功能点

- **OI06-F01**：每个 Terminal 输出分配单调 `sequence`，事件包含 terminal/workspace/worktree/runtime identity。
- **OI06-F02**：`pty.attach(after_sequence)` 优先增量重放；游标过旧时返回 `snapshot_required`，不得假装数据完整。
- **OI06-F03**：Runtime 使用 headless xterm 兼容模型维护 rows、cols、cursor、scrollback 和可见屏幕快照。
- **OI06-F04**：快照包含 `snapshot_sequence`；Renderer 先载入 snapshot，再应用大于该序号的 delta，避免重复显示。
- **OI06-F05**：resize、清屏、alternate screen、宽字符、ANSI color 和 bracketed paste 具有确定性重放语义。
- **OI06-F06**：Desktop 仅持久化最后确认 sequence、选中 Terminal 和 UI 偏好，不持久化权威 PTY buffer。
- **OI06-F07**：重连采用 generation 防止旧连接事件污染新连接；重复、乱序和缺口均被检测。
- **OI06-F08**：支持 Terminal lease：Desktop 暂时关闭后 Terminal 在 Runtime 按策略继续存活，重新连接后恢复画面。

### 测试验证

- 随机切分 PTY 字节流，snapshot + replay 与连续 headless terminal 最终画面一致；
- 注入重复、乱序、丢帧、旧 generation 和过期 cursor，验证恢复或明确失败；
- 大输出、全屏程序、Unicode/中文、颜色、resize 和 alternate screen Golden 测试；
- Desktop 关闭再打开后恢复同一 Terminal ID、scrollback 和进程状态。

## OI07 SSH Host 与 Connection Manager（8 项）

### 功能点

- **OI07-F01**：建立持久化 Host Profile：alias、hostname、port、user、config source、auth preference 和 known-host fingerprint；不保存明文秘密。
- **OI07-F02**：兼容 OpenSSH Config、Include、Host alias、IdentityFile、ProxyJump 和 ssh-agent，优先使用系统 OpenSSH 解析结果。
- **OI07-F03**：主机连接状态机统一为 `disconnected/resolving/authenticating/connecting/runtime_check/ready/reconnecting/degraded/failed`。
- **OI07-F04**：严格 known_hosts 校验；首次指纹确认、指纹变化和认证失败使用不同错误及修复动作。
- **OI07-F05**：同一主机的多个 Workspace 复用 Host Connection 和 Runtime Tunnel，不重复创建 SSH 进程。
- **OI07-F06**：指数退避带 jitter、最大失败窗口和手动立即重试；网络恢复后从 Runtime handshake 重新确认 instance/capabilities。
- **OI07-F07**：连接诊断提供阶段、失败类别、最近成功时间、重试时间和脱敏 stderr，不暴露 token/key。
- **OI07-F08**：提供 Host 级 connect/disconnect/reconnect/remove；移除前检查活动 Workspace、PTY 和 Port Forward。

### 测试验证

- OpenSSH Config/Include/alias/ProxyJump Fixture 解析测试；
- fake SSH 注入 DNS、host-key、auth、tunnel、Runtime handshake 各阶段失败；
- 同主机 10 Workspace 只产生一个权威 Host Connection 和受控隧道集合；
- 日志 canary 验证 private key、passphrase、Runtime token 零泄漏。

## OI08 Remote Runtime、PTY Lease 与端口转发（8 项）

### 功能点

- **OI08-F01**：Remote Runtime 安装、版本协商、健康检查、升级和回滚继续复用现有机制，并纳入 Host 状态机。
- **OI08-F02**：连接恢复后按顺序执行 handshake → instance 检查 → Workspace reopen → Worktree reconcile → PTY reattach → Event replay。
- **OI08-F03**：远程 PTY 的进程和 lease 由 Remote Runtime 持有；SSH/WebSocket 断开不触发 kill。
- **OI08-F04**：Remote Worktree 只由 Remote Runtime 的 OWOP Git Worktree Service 创建和管理，Desktop 不执行远程 Git shell 命令。
- **OI08-F05**：增加 Port Forward Registry，保存 remote host/port、local bind policy、状态、owner workspace 和 reconnect policy。
- **OI08-F06**：端口转发支持 create/list/pause/resume/remove；重连后自动恢复，local port 冲突时返回新端口并发出事件。
- **OI08-F07**：端口转发默认只绑定本机 loopback；绑定非 loopback 必须经过权限策略和显式 Approval。
- **OI08-F08**：Remote Workspace 离线时保持只读缓存和明确 stale 标记；禁止静默回落到本地路径执行操作。

### 测试验证

- 可控 Linux Docker/VM 上完成 Runtime install/upgrade/rollback 和真实 SSH tunnel E2E；
- 在 Run、PTY、Worktree 操作期间中断 SSH，恢复后不重复提交、不串 Workspace、输出可续传；
- 真实 TCP echo/HTTP 服务验证 port forward 创建、冲突、重连和删除；
- 远程离线时 Files/Git/PTY 写操作全部 fail closed，不在 Windows 本地生成同名文件。

## OI09 安全、可观测性与兼容迁移（8 项）

### 功能点

- **OI09-F01**：Worktree merge/remove、PTY command、port forward 和远程写操作统一进入 Permission/Approval/Audit。
- **OI09-F02**：Worktree 不是安全沙箱；继续执行 Workspace root、canonical path、junction/symlink 和 OS user 权限边界。
- **OI09-F03**：禁止默认使用 `--dangerously-bypass-approvals-and-sandbox` 一类参数；Codex Approval Bridge 保持权威。
- **OI09-F04**：建立统一 correlation：host/runtime/workspace/worktree/terminal/session/run/operation/correlation_id。
- **OI09-F05**：指标覆盖连接成功率、重连次数、PTY replay lag、snapshot 大小、丢帧、Worktree 冲突和 reconcile 结果。
- **OI09-F06**：日志、snapshot、terminal tail 和 SSH stderr 执行长度限制及 secret redaction。
- **OI09-F07**：旧 Fork/Terminal/Remote Workspace 数据采用可重复 migration；失败不修改原数据，并输出修复报告。
- **OI09-F08**：设置兼容层移除门禁：新路径稳定两个发布周期且旧入口调用量为零后，才删除 Desktop 直连实现。

### 测试验证

- 权限拒绝必须先于 Approval 创建；所有成功写操作都有完整 Audit；
- 路径逃逸、恶意分支名、端口暴露、跨 Workspace Terminal attach 全部被拒绝；
- 日志和数据库使用 token/key/password canary 扫描；
- 旧数据库多次迁移结果一致，故障注入后可以回滚并重新执行。

## OI10 测试、性能、打包与发布验收（8 项）

### 功能点

- **OI10-F01**：建立 ORCA_INSPIRED 聚焦测试入口，串联领域、OWOP、Worktree、Terminal、SSH 和 Remote E2E。
- **OI10-F02**：扩充 Python 单元/集成测试，覆盖 Runtime Registry、OWOP、PTY journal、snapshot 和恢复状态机。
- **OI10-F03**：扩充 Desktop TypeScript 契约、Component 和 E2E 测试，覆盖统一 Local/Remote UI。
- **OI10-F04**：使用临时真实 Git 仓库、真实 ConPTY 和可控 Linux Docker/VM 验证，不用纯 Mock 代替关键链路。
- **OI10-F05**：建立故障注入矩阵：Renderer reload、Desktop restart、Runtime restart、SSH loss、响应丢失、事件重复和数据库故障。
- **OI10-F06**：性能门禁覆盖 100 Worktree 列表、50 并发 Terminal、10 MB 输出重放和 10 Workspace SSH 复用。
- **OI10-F07**：在打包后的 Windows Desktop 上使用隔离临时用户数据目录，完成 Local Runtime + Codex + Worktree + Terminal 验收。
- **OI10-F08**：发布门禁要求 Schema drift、回归测试、安装升级、真实远程主机非破坏性 smoke 和证据清单全部通过。

### 测试验证

- `pytest` 聚焦套件、Desktop typecheck、契约脚本和 E2E 均返回零；
- 打包应用不依赖源码目录、开发 PATH 或未打包资源；
- 可控 Linux Runtime 与至少一台真实低权限 Linux 主机完成非破坏性 smoke；
- 所有测试证据记录版本、runtime_id、instance_id、host profile、workspace_id、worktree_id 和 terminal_id。

## 6. 核心协议增量

### 6.1 Worktree 资源示例

```json
{
  "worktree_id": "wt_01J...",
  "source_workspace_id": "ws_source_01J...",
  "workspace_id": "ws_worktree_01J...",
  "repo_root": ".",
  "canonical_path": "C:\\Users\\user\\.opendrsai\\worktrees\\task-123",
  "branch": "opendrsai/task/task-123",
  "base_commit": "abc123...",
  "status": "active",
  "location": "local",
  "created_at": "2026-07-17T10:00:00Z"
}
```

`workspace_id` 是 Worktree Workspace 的执行身份，`source_workspace_id` 只表达来源关系。对于 Remote Workspace，Desktop 可以展示 Runtime 返回的 canonical remote path，但协议调用仍以 `workspace_id + worktree_id` 为权威，不接受 Desktop 伪造 canonical path。

### 6.2 PTY attach 示例

```json
{
  "protocol_version": "1.1",
  "request_id": "req_01J...",
  "workspace_id": "ws_01J...",
  "operation": "pty.attach",
  "arguments": {
    "pty_id": "pty_01J...",
    "after_sequence": 4812,
    "mode": "read_write"
  }
}
```

增量可用：

```json
{
  "pty_id": "pty_01J...",
  "generation": 3,
  "replay_from": 4813,
  "last_sequence": 4920,
  "snapshot_required": false
}
```

游标过旧：

```json
{
  "pty_id": "pty_01J...",
  "generation": 3,
  "snapshot_required": true,
  "snapshot_sequence": 4900
}
```

### 6.3 恢复顺序

```text
Transport reconnected
  → Runtime handshake
  → compare runtime_id / instance_id / protocol / capabilities
  → reopen Workspace registrations
  → reconcile Worktree Registry
  → list Terminal leases
  → load screen snapshot
  → replay PTY delta after snapshot_sequence
  → resume Workspace Watch after_sequence
  → resume Run Event after_sequence
  → mark UI ready
```

任何阶段失败都必须暴露具体 degraded 状态；不得把尚未确认的 Worktree、PTY 或 Run 显示成正常，也不得重新提交 Run。

## 7. 分阶段实施计划

### P0 契约冻结与基线测试

- 完成 OI01；
- 为现有 Fork、Terminal 和 SSH 行为建立回归 Fixture；
- 冻结 Worktree/PTY 增量 Schema 和迁移策略。

退出条件：新旧边界明确，现有行为有自动化证据，Schema 可以生成双端类型。

### P1 Local Worktree 正式化

- 完成 OI02、OI03 的 Local Binding；
- 将 `forkWorktrees.ts` 收敛为 OWOP Facade；
- 完成 OI04 的本地 Worktree UI。

退出条件：本地 Worktree 全生命周期不再依赖 Desktop 直连 Git，Codex Run 可以稳定绑定 Worktree。

### P2 Local Runtime-owned Terminal

- 完成 OI05、OI06 的本地路径；
- `terminal.ts` 改为 Runtime Client；
- Renderer reload/Desktop restart 恢复测试通过。

退出条件：Renderer 销毁不杀 PTY，sequence/snapshot/replay 可证明无重复和无静默缺口。

### P3 SSH Manager 收敛

- 完成 OI07；
- 收敛现有 remote connection、reliability 和 ssh executable 状态；
- 建立主机级复用和诊断。

退出条件：同主机多 Workspace 只使用一套权威连接状态，常见失败有明确修复动作。

### P4 Remote Worktree、PTY Lease 与端口转发

- 完成 OI03 Remote Binding、OI04 Remote UI 和 OI08；
- 本地/远程运行同一合规套件；
- 完成网络中断恢复验证。

退出条件：Remote Worktree/PTY/Port Forward 在 SSH 重连后确定性恢复，无本地静默回落。

### P5 安全、迁移与发布

- 完成 OI09、OI10；
- 完成旧 Fork/Terminal 数据迁移；
- 在打包 Windows Desktop、可控 Linux Runtime 和真实低权限远程主机上验收。

退出条件：80 个功能点全部具备实现、自动化测试和验收证据。

## 8. 统一测试矩阵

| 层级 | Local Windows | Remote Linux Docker/VM | 真实低权限 Linux 主机 |
| --- | --- | --- | --- |
| Domain/Schema | 必测 | 同一 Fixture | 不重复 |
| Worktree lifecycle | 真实 Git 必测 | 真实 Git 必测 | 非破坏 smoke |
| Codex in Worktree | 真实 App Server 必测 | 具备 Codex 时必测 | 可选 smoke |
| PTY create/write/resize | 真实 ConPTY | 真实 PTY | smoke |
| snapshot/replay | 必测 | 必测 | smoke |
| Renderer/Desktop reconnect | 必测 | 必测 | smoke |
| Runtime restart reconcile | 必测 | 必测 | smoke |
| SSH failure injection | 不适用 | 必测 | 非破坏验证 |
| Port forwarding | loopback 服务 | 真实 TCP/HTTP | 非破坏 smoke |
| Permission/Approval/Audit | 必测 | 必测 | 抽查证据 |
| Packaged Desktop | 必测 | 通过打包 Desktop 连接 | 最终 smoke |

## 9. 非功能指标

- Worktree 创建成功请求的重复重试不得产生重复资源；
- 100 个 Worktree 首屏列表目标小于 1 秒，不扫描全部文件内容；
- PTY 正常增量事件端到端显示 P95 小于 150 ms；
- 10 MB 连续输出时 Runtime 和 Renderer 内存有明确上限，不出现无界字符串增长；
- snapshot + replay 后最终屏幕与连续连接结果一致；
- SSH 短暂中断恢复后不得重复提交 Run、重复创建 Worktree 或重复执行 Git 写操作；
- 同主机 10 Workspace 复用主机连接，Workspace/Worktree/PTY/Event 不串路由；
- 所有秘密在日志、事件、数据库和测试证据中零明文泄漏；
- 不支持的 capability 必须禁用并解释，不得静默使用 Desktop 本地实现代替。

## 10. 最终验收流程

1. 在打包后的 Windows Desktop 中打开本地 Git Workspace；
2. 创建 Worktree，绑定 Codex Agent Backend 并完成一次真实 Run；
3. 在 Worktree 内查看文件变化、Git diff、终端输出和测试结果；
4. Reload Renderer，确认同一 Terminal 和 Run 状态恢复；
5. 关闭并重新打开 Desktop，确认 Runtime lease 策略下 Terminal snapshot/scrollback 恢复；
6. 提交 Worktree 修改，经 Approval merge-back，再安全清理 Worktree；
7. 连接可控 Linux Remote Runtime，重复 Worktree + Codex/Agent + PTY 流程；
8. 在 PTY 输出期间中断并恢复 SSH，确认 snapshot/replay 无静默缺口；
9. 创建远程 HTTP 服务 Port Forward，中断 SSH 后确认自动恢复；
10. 验证远程离线时所有写操作 fail closed，没有落到 Windows 本地执行；
11. 检查 Audit、指标和脱敏诊断能够关联 host/runtime/workspace/worktree/terminal/run；
12. 执行完整聚焦回归和打包验收，归档机器可读结果及人工检查清单。

只有以上流程和 80 个功能点全部具备实现、自动化测试与可复核证据，本方案才标记完成。

## 11. 明确不在本方案范围

- Orca CLI Orchestration；
- Coordinator/Worker 自动分发；
- 多 Agent Task/Dispatch/Decision Gate；
- 用 PTY/TUI 替代 Codex App Server；
- 通过 Hooks 或 transcript 推断 Codex 权威状态；
- 把 Git Worktree 当作安全沙箱；
- 默认绕过 Codex approval 或 OpenDrSai Permission；
- DDF/HepAI IF 成为 Local/SSH 核心依赖；

## 12. 参考资料

- [Orca GitHub Repository](https://github.com/stablyai/orca)
- [Orca Worktrees](https://www.onorca.dev/docs/model/worktrees)
- [Orca SSH Worktrees](https://www.onorca.dev/docs/ssh)
- [Orca Main-owned Terminal State](https://github.com/stablyai/orca/blob/main/docs/terminal-main-owned-state.md)
- [Orca Codex Native Chat / App Server 演进说明](https://github.com/stablyai/orca/blob/main/docs/native-chat-codex-tui-parity.md)
- [OpenDrSai 远程工作区实现方案 V1](./OpenDrSai远程工作区实现方案V1.md)
- [OpenDrSai Codex 工作区开发方案 V1](./OpenDrSaiCodex工作区开发方案V1.md)
- [OpenDrSai Codex Agent Backend 实现计划 V1](./OpenDrSaiCodexAgentBackend实现计划V1.md)
