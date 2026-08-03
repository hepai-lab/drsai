# OpenDrSai ORCA_INSPIRED 开发进度

> 基准方案：[ORCA_INSPIRED 开发方案](./ORCA_INSPIRED_开发方案.md)  
> 完成标准：功能实现、自动化测试和可复核证据同时具备才计为完成。  
> 最近更新：2026-07-17（第 12 轮，最终验收）

## 总体进度

| 指标 | 当前值 |
| --- | ---: |
| 模块总数 | 10 |
| 功能点总数 | 80 |
| 已完成 | 80 |
| 进行中 | 0 |
| 未开始 | 0 |
| 完成率 | 100.00% |

当前阶段：`ORCA_INSPIRED 10 模块实现与发布验收完成`。

## 模块进度

| 模块 | 名称 | 完成/总数 | 状态 | 当前证据或下一门禁 |
| --- | --- | ---: | --- | --- |
| OI01 | 架构契约与领域模型 | 8/8 | 已完成 | 依赖门禁禁止 Renderer 直接执行 Git/SSH/PTY，并禁止新增 Desktop ownership；旧实现仅在显式兼容开关下存在，不构成默认绕过 |
| OI02 | Worktree Registry 与生命周期 | 8/8 | 已完成 | Registry、幂等创建、preflight、reconcile、merge、archive、两阶段删除及 Session/Run/Terminal 执行 Workspace 绑定均有自动化证据 |
| OI03 | OWOP Git Worktree Service | 8/8 | 已完成 | InProcess、Local IPC、SSH 三种 Binding 使用同一 OWOP 合同；真实 SSH Runtime 验证 Worktree 权威归属 Remote Runtime |
| OI04 | Worktree Desktop 产品集成 | 8/8 | 已完成 | 统一 Review 面板汇总 Runtime diff、commit range、冲突、测试上报状态与 merge readiness；Local/Remote 共用操作与组件 |
| OI05 | Runtime-owned Terminal State | 8/8 | 已完成 | Local 默认及 Remote PTY 均由 Runtime 权威持有；Renderer 销毁 detach，明确用户关闭才 kill，真实 ConPTY 与 Facade 门禁通过 |
| OI06 | Terminal Snapshot、Replay 与恢复 | 8/8 | 已完成 | Runtime headless screen、snapshot + delta、generation 缺口检测、轻量 Desktop 投影和真实 ConPTY 跨 Desktop 重启恢复均通过 |
| OI07 | SSH Host 与 Connection Manager | 8/8 | 已完成 | Host Profile、OpenSSH 解析、九态状态机、严格 known_hosts、连接复用、退避重连、脱敏诊断与 Host 生命周期均通过真实 SSH E2E |
| OI08 | Remote Runtime、PTY Lease 与端口转发 | 8/8 | 已完成 | Runtime 安装/回滚、顺序恢复、Remote PTY/Worktree、持久 Port Forward Registry、离线 stale/fail-closed 均有自动化和真实 SSH/TCP 证据 |
| OI09 | 安全、可观测性与兼容迁移 | 8/8 | 已完成 | 统一 Permission/Approval/Audit、Linux 路径边界、Codex 安全策略、全资源 correlation、七类指标、脱敏限长、故障可重试迁移和兼容移除门禁均通过 |
| OI10 | 测试、性能、打包与发布验收 | 8/8 | 已完成 | 17 项 focused 与 22 项 full 单入口门禁通过；真实 Git/ConPTY/Docker/OpenSSH、性能、unpacked Desktop、Codex App Server 和机器证据齐全 |

## 功能点状态

### 已完成

| ID | 完成证据 |
| --- | --- |
| OI01-F01 | TypeScript/Python 定义并校验 Worktree、Terminal、Terminal Lease、Host Profile、Port Forward ID；正反 Fixture 通过 |
| OI01-F02 | 固定 `Source Workspace → Worktree Resource → Worktree Workspace` 关系，强制 source/execution workspace identity 不同；双端测试通过 |
| OI01-F03 | Worktree 状态机及非法终态恢复测试通过；Schema 与 Python 转移表逐项一致 |
| OI01-F04 | Terminal 状态机和 transport loss 规则通过双端测试；running/detached 断线只进入 reconnecting，不映射 exited |
| OI01-F05 | `domain.schema.json` 固定 Local/Remote 共用资源形状；Windows/POSIX Fixture 在 Python/TypeScript 往返通过 |
| OI01-F06 | 边界门禁证明 Codex Adapter 不定义 Worktree/Terminal ownership，也不执行 Git Worktree 生命周期 |

### 进行中

无。兼容层的物理删除继续受 OI09-F08“两次稳定发布 + 零调用”门禁约束；这不影响 OI01-F08 的架构边界门禁已经完成。

### 第 2 轮新增完成

| ID | 完成证据 |
| --- | --- |
| OI02-F01 | Runtime SQLite 新增 Worktree 表、外键、唯一约束、错误和 tombstone 字段；重启往返测试通过 |
| OI02-F02 | Registry 预留 + Service 响应丢失重读；20 路并发只生成一个 Worktree ID、分支和路径 |
| OI02-F03 | 真实 Git preflight 覆盖 repository、target、branch、disk、HEAD 和 source dirty；dirty 文件未复制到派生 Worktree |
| OI02-F04 | `git worktree list --porcelain` reconcile 能恢复 creating、报告 missing/orphaned/prunable 并保留错误 |
| OI02-F06 | merge 检查 source/derived dirty、expected HEAD 和冲突；冲突自动 abort 并持久化 `merge_pending` |
| OI02-F07 | 未合并工作先重命名到 `opendrsai/archive/*`；归档 Worktree 删除后分支仍保留；merged 分支使用 `git branch -d` |
| OI03-F01 | OWOP 新增 `git.worktree.list/create/describe/merge/archive/remove/prune` 七个操作 |
| OI03-F02 | 七个操作均有独立 Request 和 Result JSON Schema；未知字段和缺失字段 fail closed |
| OI03-F03 | Python/TypeScript 同源生成 Worktree Params、Result 和 Resource 类型；Schema digest/零漂移通过 |
| OI03-F05 | GitWorktreeService 全部使用 argv、固定 cwd、timeout 和受控错误，不使用 shell command 拼接 |
| OI03-F06 | Schema 和 OWOP Adapter 支持 created/status_changed/conflict/merged/archived/removed 事件 |

### 第 3 轮新增完成

| ID | 完成证据 |
| --- | --- |
| OI02-F08 | 删除先关闭派生 Workspace 阻止新绑定，再检查未归档 Session、活动 Run 和 Runtime PTY；之后经 Approval 才执行 Git remove 与 tombstone；活动资源测试证明无 Git 副作用 |
| OI03-F08 | Local Desktop Fork 默认经 `LocalRuntimeClient`，Remote 经同一 RuntimeClient 契约；旧 Desktop Git 仅保留显式环境开关兼容入口，边界门禁固定默认路径 |
| OI04-F02 | 现有 Fork UI 创建动作经 Local/Remote Runtime 创建并注册独立 Worktree Workspace，完成后保存并打开权威 `worktree_id/source_workspace_id/workspace_id` |

### 第 4 轮新增完成

| ID | 完成证据 |
| --- | --- |
| OI03-F07 | create/merge/archive/remove/prune Schema 全部要求幂等键；终态 merge/archive/remove 可安全重放；Gateway 固定执行 Permission → Approval → Operation → Audit，真实 Git 重放测试通过 |
| OI04-F01 | Workspace 侧栏增加 Runtime 权威 Worktree 列表，展示 branch、base/head、dirty、ahead/behind、活动 Session/Run/Terminal、位置和生命周期状态 |
| OI04-F05 | 列表中的 merge 和 archive/remove 动作复用现有 Fork Approval Center；无关联 Thread 的资源不会绕过审批直接执行 |
| OI04-F07 | Local/Remote Worktree 使用同一 Desktop API、RuntimeClient DTO、组件和交互；仅显示 `location` 差异，集成 Fixture 双路径通过 |

### 第 4 轮进行中

| ID | 尚缺门禁 |
| --- | --- |
| OI04-F04 | 已复用 Fork 冲突、Git Diff 和 merge readiness 基础；等待在一个 Review 面板汇总 commit、测试结果和冲突 |

### 第 5 轮新增完成

| ID | 完成证据 |
| --- | --- |
| OI04-F06 | Runtime-owned GitWorktreeService 写入去重的 Workspace Event；Gateway/RuntimeClient/Desktop 使用单调 sequence 游标增量读取，Renderer 只在 Worktree Event 后刷新权威投影，不运行 Git 推断 |

### 第 5 轮阶段成果

- Runtime Registry 增加 execution Workspace → Worktree 的唯一反向解析；
- Runtime Session 和 Run 持久化 `worktree_id`，Run immutable trigger 禁止 Backend 或数据库更新改变执行身份；
- 旧 Runtime 数据库在启动时根据 Registry 权威关系回填 Session/Run `worktree_id`；
- Desktop Thread 增加独立 execution binding，创建时校验四个资源字段，后续 Agent Backend 更新保留原绑定；
- GitWorktreeService 增加旧 Worktree adopt：校验真实 Git Worktree、branch、base 和 Source Workspace 后才登记；
- adopt 失败不写 Registry、不删除目录，重复 adopt 返回同一资源；Gateway/Desktop 自动迁移与诊断展示仍在进行中。

## 第 1 轮变更

- 新增 `cores/protocol/orca-inspired/domain.schema.json` 和跨语言 Fixture；
- 新增 TypeScript `workspaceResources.ts`；
- 新增 Python `workspace_resources.py`；
- 新增 5 个 Python 领域契约测试；
- 新增 Desktop `verify:workspace-resources`；
- 新增 `verify:orca-inspired-boundaries`，阻止 Renderer、Codex Adapter 和新的 Desktop 模块引入 Worktree/PTY 所有权；
- 未修改或重置工作区内既有未提交变更。

## 第 2 轮变更

- `RuntimeRegistry` 增加 Worktree 预留、绑定、查询、状态迁移、错误和分支更新 API；
- 新增 Runtime-owned `GitWorktreeService` 与 `GitWorktreeOWOPOperations`；
- 新增真实 Git 创建、并发、恢复、合并、冲突、归档、删除测试；
- OWOP Schema 从 31 个操作扩展到 38 个操作，并增加 7 个严格结果 Schema；
- OWOP dispatch 增加 operation-specific result 校验；
- OWOP codegen 同时生成 Params、Result 和 Worktree Resource 类型；
- Remote Gateway Worktree 创建迁移到 Runtime Service，并返回 `worktree_id`；
- Desktop Remote Fork 投影开始保存 `worktreeId/sourceWorkspaceId/workspaceId`；
- 本地旧 Fork 路径仍保留，未进行破坏性切换。

## 第 3 轮变更

- `RuntimeClient` 增加 create/list/describe/merge/archive/remove Worktree 生命周期合同，Local/Remote 使用完全相同的方法；
- Local Desktop Fork 默认路径迁移到 Local Full Runtime，不再默认由 Electron Main 执行 Git；
- Fork merge/archive/remove 优先使用 Runtime 权威 ID，旧数据继续走兼容 Facade；
- Runtime Gateway 增加完整 Worktree HTTP 生命周期入口，并统一投影 OWOP Worktree Resource；
- `RuntimeEngine` 增加 Workspace 活动 Session/Run 查询；Worktree 删除会同时检查已加载 Runtime PTY；
- 删除第一阶段关闭派生 Workspace，阻止新的 Session/Run 绑定，活动资源存在时保留目录、分支和 Registry 状态；
- `worktree.write` 纳入 owner/editor 权限以及一次性 Approval，Gateway 成功操作写入关联 Worktree 审计；
- RuntimeClient 集成 Fixture 同时验证 Local/Remote Worktree 创建、列表、描述、合并、归档和删除语义。

## 第 4 轮变更

- OWOP Worktree Resource 增加 `head_commit/dirty/ahead/behind/activity` 权威投影；
- Runtime 使用真实 Git 与 Runtime Engine/PTY 状态生成列表信息，Renderer 不执行 Git 轮询推断；
- Desktop API/Preload/Main 增加 `listWorktrees`，自动选择 Local Runtime 或现有 Remote Runtime tunnel；
- Workspace 侧栏增加 Worktree 列表、空/离线/创建/活动/dirty/冲突/merged/archived 状态和刷新入口；
- 关联 Fork Thread 的 Worktree 可从列表进入已有 merge/archive/remove Approval Center；
- merge/archive/remove 增加终态安全重放，所有 Worktree 写 Schema 增加幂等键；
- 修复 OWOP Python codegen 在旧工具 Python 上对 `Required/NotRequired/TypeAlias` 的兼容导入。

## 第 5 轮变更

- `RuntimeEngine` Session/Run Schema 增加 `worktree_id` 和无损启动迁移；
- `RuntimeRegistry` 增加按执行 Workspace/path 解析 Worktree；
- Git Worktree 生命周期事件进入持久化 Workspace journal，并以 operation/worktree/update time 去重；
- Gateway 增加 Workspace Event 游标读取，RuntimeClient Local/Remote 合同增加相同事件方法；
- Desktop Worktree UI 每 2 秒读取轻量事件游标，仅有增量事件时刷新权威资源列表；
- 新增 Thread execution binding 校验门禁，证明 Agent Backend 不进入 Workspace execution identity；
- 新增旧 Worktree adopt 的真实 Git 成功、失败无副作用和幂等测试。

## 最近验证

| 验证 | 结果 |
| --- | --- |
| `python cores/python/packages/drsai/tests/test_workspace_resources.py` | 5 tests passed |
| `npm run verify:workspace-resources` | passed |
| `npm run verify:orca-inspired-boundaries` | passed |
| `python scripts/generate-owop-types.py --check` | passed |
| `npm run typecheck` | passed |
| Worktree Registry + Git Service + OWOP 聚焦套件 | 21 tests passed |
| Git Worktree lifecycle 专项 | 9 tests passed（真实 Git） |
| OWOP Worktree InProcess/Local IPC | passed |
| Gateway/Runtime/OWOP Python compile | passed |
| Runtime Engine + Security + Git Worktree + Registry + OWOP 聚焦套件 | 39 passed，1 skipped（Linux-only 安全文件系统测试） |
| `npm run verify:runtime-client-contract` | passed |
| `npm run verify:runtime-client-integration` | Local/Remote passed |
| `npm run verify:worktree-ui` | empty/offline/creating/active/dirty/conflict/merged/archived passed |
| Worktree + Runtime Engine + Security + OWOP 第 4 轮聚焦套件 | 39 passed，1 skipped |
| Runtime Registry + Engine + Git Worktree + OWOP 第 5 轮聚焦套件 | 34 passed |
| `npm run verify:thread-execution-binding` | passed |
| Worktree Event Local/Remote RuntimeClient cursor | passed |

### 第 6 轮新增完成

| ID | 完成证据 |
| --- | --- |
| OI02-F05 | Session/Run 已持久化且不可变绑定执行 `workspace_id/worktree_id`；Terminal State Service 通过 Registry 解析相同关系，50 Terminal 隔离测试通过 |
| OI04-F03 | Worktree 列表可直接创建绑定该执行 Workspace 的新会话；Thread 持久化 execution binding，Backend 更新不改变资源身份 |
| OI04-F08 | 首次读取自动 adopt 旧 Fork；失败不修改旧数据并保留可重试诊断，成功后幂等写回权威 Worktree/Workspace ID |
| OI05-F02 | OWOP 增加 `pty.list/describe/create/write/resize/attach/detach/kill` 八操作，双端类型生成、Gateway `/v1/owop` 和统一 RuntimeClient 通过 |
| OI05-F03 | Terminal 持久化 `runtime_id/workspace_id/worktree_id`；cwd 只接受 Registry Workspace 下的相对路径，绝对路径和逃逸均拒绝 |
| OI05-F05 | Runtime lease 支持单写者、多只读者；冲突、过期、Terminal/lease 不匹配和跨 Workspace attach 返回结构化错误 |
| OI05-F06 | 输出按单事件字节、总 journal 字节和保留时间有界；过期游标显式返回 `snapshot_required`，不静默伪装完整 |
| OI05-F07 | 退出保留 code、signal、时间和尾部输出；终态仅在 retention 到期后由显式 purge 回收 |
| OI05-F08 | Runtime 启动把遗留 starting/running/detached/reconnecting PTY 确定性收敛为 lost，并释放旧 lease |

### 第 6 轮阶段成果

- Gateway 与 Desktop 完成旧 Worktree adopt 首读迁移、诊断和 Source/Worktree 执行选择；
- 新增 SQLite-backed `TerminalStateService`，Runtime 成为 Terminal identity、lease、journal 和 lifecycle 的权威；
- 现有 node-pty/ConPTY bridge 作为 provider 被 Runtime State Service 复用，真实 Windows ConPTY 验收通过；
- Local/Remote RuntimeClient 发送相同 OWOP envelope，仅 Binding 分别为 `local_ipc` 与 `ssh`；
- Worktree 活动资源检查已读取新 Terminal State Service，活动或 detached Terminal 阻止不安全删除；
- Electron `terminal.ts` 仍是旧 UI Facade 和 PTY owner，因此 OI05-F01/F04、OI01-F07 尚未关闭。

### 第 6 轮验证

| 验证 | 结果 |
| --- | --- |
| Terminal State + OWOP PTY + Schema/codegen 聚焦套件 | 13 passed，46 subtests passed |
| 真实 Windows Process/ConPTY 旧路径回归 | 2 passed |
| Runtime-owned Terminal + 真实 Windows ConPTY | passed |
| 10 Workspace × 5 Terminal 输出隔离 | passed |
| Gateway/Terminal/PTY Python compile | passed |
| `python scripts/generate-owop-types.py --check` | passed |
| `npm run typecheck` | passed |
| `npm run verify:runtime-client-contract` | passed |
| `npm run verify:runtime-client-integration` | Local/Remote OWOP Binding passed |
| `npm run verify:worktree-migration` | passed |
| `npm run verify:thread-execution-binding` | passed |

### 第 7 轮新增完成

| ID | 完成证据 |
| --- | --- |
| OI01-F07 | Local Workspace Terminal 默认由 Full Runtime 持有；Remote PTY 继续由 Remote Runtime 持有；Electron Main 只保存 lease、sequence 和 UI buffer 投影 |
| OI05-F01 | `terminal.ts` 默认经 RuntimeClient/OWOP 创建、读写和调整 Terminal；直接 node-pty 仅保留显式环境变量兼容入口 |
| OI05-F04 | WebContents 销毁对 Local writer lease 执行 `pty.detach`，Remote 只关闭订阅 socket；只有关闭/重启 Terminal 的用户动作调用 `pty.kill` |
| OI06-F01 | 每条输出事件携带 terminal/runtime/workspace/worktree/generation identity 和单调 sequence，严格 Result Schema 校验通过 |
| OI06-F02 | `pty.attach(after_sequence)` 增量 replay；续租复用同一 lease；游标过期明确返回 `snapshot_required` |

### 第 7 轮阶段成果

- Desktop `terminal.ts` 已成为 Runtime/OWOP Client Facade，本地 Workspace 不再默认加载 Electron node-pty；
- Runtime writer lease 可在轮询时原位续租，不会每次 replay 制造新 lease 或触发双写者冲突；
- Renderer reload 会 detach 后重新申请 writer lease，PTY 进程继续存在；
- Remote WebSocket 关闭只移除 Runtime listener，不再把 UI 生命周期误映射为 PTY kill；
- Desktop shutdown 对 Runtime Terminal 执行 detach；明确的关闭、停止和重启动作仍执行 kill；
- 兼容入口仍保留在 `terminal.ts`，待两个稳定发布周期和调用量归零后删除，因此 OI01-F08 继续进行中。

### 第 7 轮验证

| 验证 | 结果 |
| --- | --- |
| Terminal/OWOP/Binding/真实 ConPTY 聚焦套件 | 18 passed，46 subtests passed |
| `npm run typecheck` | passed |
| `npm run verify:runtime-terminal-facade` | passed |
| `npm run verify:orca-inspired-boundaries` | passed |
| `npm run verify:runtime-client-contract` | passed |
| `npm run verify:runtime-client-integration` | Local/Remote passed |
| `python scripts/generate-owop-types.py --check` | passed |

### 第 8 轮新增完成

| ID | 完成证据 |
| --- | --- |
| OI06-F03 | Runtime 新增增量 UTF-8 headless terminal screen，权威维护 rows、cols、cursor、scrollback、visible screen 和样式 run；随机字节切分 40 个 seed 结果一致 |
| OI06-F04 | 持久化 screen snapshot 携带 `snapshot_sequence`；attach 可优先返回 snapshot，Desktop 先重置并载入快照，再应用严格大于快照序号的 delta |
| OI06-F05 | golden tests 覆盖 resize、清屏、alternate screen、宽字符、ANSI 16/256/truecolor 和 bracketed paste 的确定性语义 |
| OI06-F06 | Desktop 原子持久化仅包含 terminal identity、sequence、generation、选择项和 shell UI 偏好；验证器禁止 buffer/screen/snapshot 落入投影文件 |
| OI06-F07 | `reconcileTerminalReplay` 按 generation 隔离旧事件，并检测重复、乱序、缺口和缺少 snapshot 的新 generation |
| OI06-F08 | 真实 Windows ConPTY 验证 Desktop 退出后 Local Runtime 保持存活；新 Desktop 实例恢复同一 runtime/instance/terminal ID、进程状态和屏幕快照 |

### 第 8 轮阶段成果

- Runtime Terminal 从仅有事件 journal 扩展为事件与权威 screen snapshot 双层恢复模型；
- screen snapshot 与 Terminal State 使用同一 SQLite 事务边界和单调 sequence，Runtime 重启后仍可读取最后快照；
- Desktop Runtime Terminal Facade 不持久化权威终端内容，仅保留恢复游标与 UI 投影；
- Local Full Runtime 获得可被新 Desktop 实例接管的持久进程模式，并以持久 instance token 验证同一 Runtime 身份；
- Gateway 增加认证的显式 shutdown，用于安装升级或用户明确停止，不把 Desktop 生命周期错误映射为 Runtime/PTY kill。

### 第 8 轮验证

| 验证 | 结果 |
| --- | --- |
| Terminal screen/state + OWOP PTY + process/schema/codegen 聚焦套件 | 22 passed，46 subtests passed |
| headless screen 随机字节切分 | 40 seeds deterministic |
| `python scripts/generate-owop-types.py --check` | passed |
| `npm run verify:terminal-replay` | duplicate/gap/generation/snapshot replay passed |
| `npm run verify:runtime-terminal-facade` | passed |
| `npm run verify:terminal-desktop-restart` | 同一 Runtime、Terminal、进程状态与快照恢复 passed |
| `npm run typecheck` | node/web passed |
| `git diff --check` | passed（仅行尾转换提示） |

### 第 9 轮新增完成

| ID | 完成证据 |
| --- | --- |
| OI04-F04 | Worktree Review 面板统一展示 Runtime/Workspace Operation 提供的 diff、base..head commit、冲突、测试上报状态和 merge readiness；缺少测试证据时明确为 `not_reported`，不会误报通过 |
| OI07-F01 | 新增原子持久化 Host Profile Store，保存 alias/hostname/port/user/config source/auth preference/IdentityFile 引用/ProxyJump/known-host fingerprint，不接受或保存明文秘密 |
| OI07-F02 | 复用系统 `ssh -G` 解析 OpenSSH Config，递归支持 Include、Host alias、IdentityFile、ProxyJump，并保留系统 ssh-agent/硬件密钥认证路径 |
| OI07-F03 | Host Connection 统一九态：disconnected/resolving/authenticating/connecting/runtime_check/ready/reconnecting/degraded/failed；非法转移 fail closed |
| OI07-F04 | 正常 SSH 与隧道固定 `StrictHostKeyChecking=yes`；首次信任必须经 inspect fingerprint + accept-new 显式批准，指纹变化、认证失败分别分类 |
| OI07-F05 | 既有 `hostConnections`/single-flight 按 alias 复用一个 Host Connection、Runtime Gateway 和受控隧道；真实双 Workspace E2E 通过 |
| OI07-F06 | 指数退避含 jitter/最大窗口，Host 级 reconnect 提供立即重试；重连后重新 handshake 并用 RuntimeInstanceTracker 校验 runtime/instance/capabilities |
| OI07-F07 | 诊断报告包含 phase、failure category、last success、retry time、重连次数和事件；stderr/token/password/private-key 模式统一脱敏 |
| OI07-F08 | Desktop API/IPC 提供 Host connect/disconnect/reconnect/remove；remove 在活动 Workspace、PTY 所属 Workspace 或隧道存在时拒绝 |

### 第 9 轮阶段成果

- Worktree Desktop 产品层完成 8/8，Review 不运行 Renderer Git 推断，Local/Remote 使用同一组件与操作契约；
- SSH Manager 从 Workspace 级连接实现中抽取 Host Profile、状态机、安全诊断和生命周期管理，同时复用原有成熟隧道/Runtime 安装机制；
- 连接成功公共状态由含糊的 `connected` 收敛为 `ready`，保留独立 `connected/gatewayReady` 布尔投影供 UI 使用；
- 真实 SSH fixture 改为可信与未可信 known_hosts 隔离，测试不再依赖 `StrictHostKeyChecking=no`；
- 未引入新的 Agent Core/Backend 所有权，Codex Adapter 与原有 OpenDrSai Backend 架构保持不变。

### 第 9 轮验证

| 验证 | 结果 |
| --- | --- |
| `npm run verify:worktree-ui` | Review 聚合、ready/blocked、Runtime Event cursor passed |
| `npm run verify:host-connection-manager` | Profile/state/reuse/security/recovery/diagnostics/lifecycle passed |
| `npm run verify:remote-ssh-contract` | 48 OpenAPI operations 与 Desktop SSH contract passed |
| `npm run verify:runtime-client-integration` | Local/Remote Runtime Client passed |
| `npm run verify:remote-ssh` | 真实 OpenSSH/Docker E2E passed（无 Windows Sandbox） |
| `npm run typecheck` | node/web passed |
| `git diff --check` | passed（仅行尾转换提示） |

### 第 10 轮新增完成

| ID | 完成证据 |
| --- | --- |
| OI03-F04 | `RemoteRuntimeClient` 通过 SSH tunnel 发送与 Local 完全相同的 OWOP envelope，仅 `binding.kind=ssh`；真实 Remote Runtime 执行 `git.worktree.list` 并校验权威 Workspace ID |
| OI08-F01 | 现有 Remote Runtime install/health/upgrade/rollback 纳入 Host `runtime_check/ready/degraded` 状态；真实 SSH E2E 验证签名摘要、并发锁和回滚 |
| OI08-F02 | 重连恢复固定为 handshake → instance check → Workspace reopen → Worktree reconcile → PTY discover/reattach → Event replay ready，并有顺序断言 |
| OI08-F03 | Remote Terminal 默认统一走 OWOP `pty.*` 与 Runtime lease；Desktop/SSH transport 断开只 detach/suspend，不 kill Runtime 进程 |
| OI08-F04 | Remote Worktree 统一经 Remote RuntimeClient/OWOP；Desktop 不执行远程 Git shell，Remote 离线时禁止 LocalRuntimeClient 回落 |
| OI08-F05 | 新增原子持久化 Port Forward Registry，保存 Host/Workspace owner、远端目标、本地 bind policy、状态和 reconnect policy |
| OI08-F06 | create/list/pause/resume/remove、端口冲突重分配事件及 Host 重连自动恢复通过真实 TCP 数据传输验证 |
| OI08-F07 | 默认只绑定 loopback；非 loopback 必须携带内部 Permission/Approval 结果，否则 fail closed |
| OI08-F08 | Remote read cache 返回明确 `stale`；所有远程写与 Runtime 操作离线 fail closed，不落入本地同路径执行 |

### 第 10 轮阶段成果

- Desktop 新增统一 Runtime Client resolver，本地和远程 Codex Backend、Terminal、Worktree 只在 Binding/transport 层分流；
- 已登记 Remote Workspace 即使断线也保持 Remote 身份，读操作可使用显式 stale cache，写操作不再静默回落本机；
- Port Forward 从临时 SSH 子进程提升为 Host/Workspace 归属明确、可恢复、可审计的持久资源；
- Host reconnect 会先恢复 Runtime/Workspace/Worktree/PTY/Event 状态，再对外进入 ready；
- 真实 Docker/OpenSSH E2E 已覆盖 Runtime 安装升级回滚、Host 重启、隧道重建和端口转发数据面；未使用 Windows Sandbox。

### 第 10 轮验证

| 验证 | 结果 |
| --- | --- |
| `npm run verify:remote-runtime-recovery` | SSH OWOP、顺序恢复、PTY lease、stale read、离线 fail-closed passed |
| `npm run verify:port-forward-registry` | lifecycle、冲突、持久化、bind policy、TCP 数据面和 Host resume passed |
| `npm run verify:remote-ssh` | 真实 Docker/OpenSSH Runtime install/upgrade/rollback、重启恢复、HTTP port forward passed |
| `npm run verify:runtime-terminal-facade` | passed |
| `npm run verify:runtime-client-integration` | Local/Remote passed |
| `npm run verify:remote-ssh-contract` | passed |
| OWOP Worktree 独立测试组 | 3 passed |
| OWOP/Terminal 常规包测试组 | 15 passed，46 subtests passed |
| `npm run typecheck` | node/web passed |
| `git diff --check` | passed（仅行尾转换提示） |

### 第 11 轮新增完成

| ID | 完成证据 |
| --- | --- |
| OI09-F01 | Runtime Worktree/PTY/写操作与 Port Forward 均执行 Permission → scoped Approval → Operation → Audit；权限拒绝不创建 Approval，Port Forward 审计含 owner/operation/correlation |
| OI09-F02 | `SecureWorkspaceFS` 使用 descriptor-relative、`O_NOFOLLOW` 和 canonical root；Linux 容器真实验证 traversal、绝对路径、symlink 和目录交换竞态 |
| OI09-F03 | Codex Adapter 拒绝 `approvalPolicy=never/bypass` 与 `sandbox=danger-full-access/disabled`，未知危险参数继续 fail closed，Approval Bridge 保持权威 |
| OI09-F04 | OperationContext/ResourceCorrelation 统一 host/runtime/workspace/worktree/terminal/session/run/operation/correlation_id，Audit 与指标可联查 |
| OI09-F05 | 持久指标覆盖连接成功、重连、PTY replay lag、snapshot bytes、丢帧、Worktree conflict/reconcile；维度上限 8 KiB、保留 30 天、查询上限 1000 |
| OI09-F06 | Audit、指标、SSH stderr 统一 secret/private-key/Bearer redaction；字符串、集合、terminal tail/snapshot 均有长度或数量上限，canary 测试通过 |
| OI09-F07 | Legacy Session 和 Port Forward Registry migration 幂等；注入数据库故障后源数据/报告不变，恢复后可重复迁移到同一身份 |
| OI09-F08 | `compatibility-gates.json` 固定“两稳定发布周期 + 旧入口调用量为零”删除条件；机器门禁阻止提前删除 Desktop 兼容 Facade |

### 第 11 轮验证

| 验证 | 结果 |
| --- | --- |
| Runtime security/observability/migration | 13 passed，1 Linux-only skipped on Windows |
| Linux `SecureWorkspaceFS` acceptance | traversal/symlink/directory-swap passed |
| Codex Backend Client | 15 passed |
| `npm run verify:orca-security-observability` | passed |
| `npm run verify:orca-inspired-boundaries` | passed |
| `npm run verify:port-forward-registry` | authorization audit、TCP、恢复 passed |
| `npm run verify:remote-ssh` | 首次瞬时 failureKind 采样未命中；立即重跑完整真实 Docker/OpenSSH E2E passed |
| `npm run typecheck` | node/web passed |
| `git diff --check` | passed（仅行尾转换提示） |

### 第 12 轮新增完成

| ID | 完成证据 |
| --- | --- |
| OI01-F08 | `verify:orca-inspired-boundaries` 扫描 Renderer/Codex Adapter/Electron Main：禁止 Renderer child_process/SSH/Git lifecycle，禁止新增 Desktop Worktree/PTY ownership；默认路径全部经 Runtime/OWOP |
| OI10-F01 | 新增 `verify:orca-inspired-release` 与 `verify:orca-inspired-release-full` 单入口，失败即停止并原子生成 focused/full JSON 证据 |
| OI10-F02 | 单入口运行 Worktree Registry/Git Service、Terminal State/journal/snapshot、migration fault Python 套件，全部返回零 |
| OI10-F03 | Desktop typecheck、领域/RuntimeClient/Worktree UI/Terminal replay/Host/Port Forward/Remote recovery 契约在同一门禁执行 |
| OI10-F04 | 关键链路使用临时真实 Git、Windows ConPTY、真实 Codex App Server、Docker Linux 与真实 OpenSSH/TCP，不以纯 Mock 代替 |
| OI10-F05 | 覆盖 Renderer/Desktop restart、Runtime restart、SSH loss、响应丢失、重复事件、generation gap 和数据库 migration 故障注入 |
| OI10-F06 | 实测 100 Worktree、50 Terminal、10 MiB journal replay、10 Workspace 单 Host SSH 复用；资源身份与阈值写入证据 |
| OI10-F07 | `build:unpack` 后 packaged main/preload/IPC smoke 通过；ASAR/Backend artifact 含 Codex Adapter、Worktree、Runtime Terminal，`codex-cli 0.142.5 app-server` initialize 通过 |
| OI10-F08 | Schema drift 首轮真实拦截并修复；最终 full gate 22/22、Runtime artifact trust、install/upgrade/rollback、非 root Linux OpenSSH smoke 和证据清单通过 |

### 第 12 轮修复

- 修复 Local Desktop Workspace ID 被误当作 Runtime Workspace ID：本地持久 Workspace 现在按 canonical path 向 Full Runtime 解析权威 ID，Worktree execution ID 保持不变；
- packaged smoke 迁移到 Runtime Workspace ID，并补齐 Worktree/Event/PTY 合同，不再启用 Desktop legacy PTY；
- Runtime 冷启动窗口改为可配置且有界（默认 30 秒，5–120 秒），超时仍终止进程树；
- Desktop restart verifier 使用操作系统分配的空闲 loopback port，消除 PID 取模端口碰撞；
- OWOP Schema 漂移已重新生成 Python/TypeScript 类型并通过 `--check`。

### 第 12 轮最终验证

| 验证 | 结果 |
| --- | --- |
| `npm run verify:orca-inspired-release` | focused 17/17 passed |
| `npm run verify:orca-inspired-release-full` | full 22/22 passed，236.9 秒 |
| Worktree Runtime tests | passed |
| Terminal Runtime tests | passed |
| Migration fault tests | passed |
| 性能门禁 | 100 Worktree、50 Terminal、10 MiB replay、10 Workspace SSH reuse passed |
| `npm run verify:terminal-desktop-restart` 连续运行 | 2/2 passed |
| `npm run verify:remote-ssh` | non-root Docker/OpenSSH、Runtime restart、端口转发、10 Workspace reuse passed |
| `npm run verify:packaged` | real packaged main/preload/IPC passed |
| `npm run verify:orca-packaged-runtime` | packaged modules + Codex CLI 0.142.5 App Server passed |
| `npm run verify:remote-host-ready` | 外部低权限主机非破坏性入口与安全约束 passed；实际外部连接需显式 Host alias/acceptance 授权 |

## 完成结论

ORCA_INSPIRED 方案的 10 个模块、80 个功能点均已实现并通过自动化验收。兼容实现仍按 OI09-F08 保留在显式关闭的环境开关之后，待两个真实稳定发布周期且调用量为零时物理删除；该后续发布治理动作不会改变当前默认架构或 80 项功能完成状态。

## 第 13 轮：实际 App 状态修复

- About 页的 OpenDrSai 版本改为 Electron `app.getVersion()` 链路，不再错用 Python Runtime 安装版本；当前开发版显示 `1.4.7-rc1`。
- Desktop 开发启动优先复用项目内官方 `@openai/codex` 独立 CLI，不再把外部 Runtime 无法执行的 Windows Store 包内路径误报为可用。
- 正式 packaged Runtime 的信任边界不变：仍仅使用签名受管 Codex 制品；本地开发 CLI 标记为 `release_safe=false`。
- Codex Binary Provider 为开发 CLI 探测 `--version`，About 能显示 Backend 版本。
- 真实运行验证：`codex-cli 0.144.5 app-server` 已由 Runtime 启动，account API 读取到现有 ChatGPT 登录态，当前 App capability 为 `available`。
- 自动验证：Desktop node/web typecheck passed，Codex Desktop integration passed，Binary Provider/Factory `11 passed`。

## 第 14 轮：工作区会话入口

- 每个工作区行新增可见的“在此工作区新建会话”按钮；创建的会话自动绑定该工作区、当前选中的 Agent，并跳转到聊天页。
- 三个点继续只承载工作区详情和维护操作，避免将开始任务这一主操作藏在二级页面。
- Desktop node/web typecheck passed。

## 第 15 轮：Codex 运行恢复

- Desktop 重启后会使用线程中已持久化的 Codex Runtime Run ID 拉取事件并补回聊天内容，不再把已完成的 Runtime Run 误报为“未能重新连接”。
- Codex Runtime Run ID 在创建后立即写入线程记录，覆盖运行中 Electron 重启的恢复窗口。
- Runtime 无法读取或非 Codex 会话仍保留 30 秒有界恢复兜底，避免错误地宣称执行已完成。
- Desktop node/web typecheck passed，Codex Desktop integration passed。
