# OpenDrSai macOS 下一阶段实施进度

## R34：v1.5.1 发布收口与 v1.5.3 开发版本启动

### 已完成

- 核验发布线程 `019f8aea-154f-7d03-8604-491848ca81ba`：v1.5.1 Developer ID 签名、公证、DMG、更新 ZIP、stable feed、OSS/CDN 与不可变 `release-info.json` 已发布并回读验证。
- 当前 `feature/desktop` 已同步到发布提交 `d2bbd033`，工作区无未合并发布改动。
- macOS 开发版本提升到 `1.5.3`，与 Windows 对照版本一致；workspace lockfile 同步更新。
- Runtime 可复现性脚本移除 `1.5.1` 硬编码，按受限文件名模式清理任意语义版本的 manifest、SBOM、provenance 和 archive，防止版本升级后旧工件污染双构建。

### 自动化结果

- TypeScript typecheck：通过。
- 更新 feed 策略契约：通过。
- 完整 `verify:contract`：通过，包含安全 IPC、恢复、Keychain、系统权限、Runtime、文件与 workspace registry 并发原子性。

### 当前进度

- v1.5.1 已完成生产发布；v1.5.3 已进入开发与重新验收阶段。
- 模块：3/4（75.00%）。
- 功能点：10/11（90.91%）。
- 下一步：提交版本升级，基于 clean v1.5.3 revision 重建 Runtime，生成新的 source/L4/L5/L6 证据并验证从 v1.5.1 到 v1.5.3 的签名更新链。

更新时间：2026-07-29<br>
当前轮次：R34（进行中）<br>
范围：完整开发与发布验收，共 4 个模块、11 个功能点<br>
发布基线：v1.5.1 已完成 Developer ID 签名、公证与生产 stable 首发；v1.5.3 正在开发

## 当前汇总

| 指标 | 完成 | 总数 | 进度 |
| --- | ---: | ---: | ---: |
| 模块 | 3 | 4 | 75.00% |
| 功能点 | 10 | 11 | 90.91% |

| 模块 | 功能点 | 状态 |
| --- | ---: | --- |
| M1 Runtime Conversation 与 Remote Workspace 对齐 | 5/5 | completed |
| M2 macOS packaged 等价验收 | 3/4 | in_progress |
| M3 clean L4 | 1/1 | completed |
| M4 full unsigned L5 | 1/1 | completed |

## R7：真实 OpenSSH transport 与长驻隧道修复（阶段报告 6）

### 本轮完成

- 新增非特权本机 `sshd` 回环验收，临时生成 host/client Ed25519 key、隔离 SSH config/known_hosts/control socket，不依赖开发机既有 SSH 配置。
- 真实验证未批准 Host Key 必须拒绝、`ssh-keyscan` 审阅后才能连接、ControlMaster 建立以及 TCP 数据经 SSH Port Forward 往返。
- 发现并修复真实产品缺陷：Port Forward 和 Remote Workspace tunnel 复用 ControlMaster 时，`ssh -N -L` 会把转发注册给 master 后以 0 退出，Registry 随即把成功转发误判为失败。
- 两类长驻隧道改为 `-S none`，保留 ControlMaster 作为主机连通性前置条件，但让 tunnel 子进程拥有可观测、可暂停、可恢复、可清理的完整生命周期。
- macOS 契约新增防回归断言：长驻隧道必须独立持有 SSH 进程，并启用 `ExitOnForwardFailure=yes`。

### 自动化结果

- `verify:ssh-loopback`：通过；Host Key 拒绝/批准、ControlMaster、真实 TCP Forward 均成立。
- `verify:ssh-hosts`：通过。
- `verify:port-forwards`：通过；启动、端口冲突重分配、断线重连、持久化、审计和 shutdown 均成立。
- `verify:remote-workspace`：通过；生命周期、远端 Thread 搜索、文件事件、启动恢复、文件/Git/checkpoint/worktree 路由和断连失效均成立。
- TypeScript typecheck：通过。

### 进度口径

本轮补强了 M2-F01 的真实 transport 证据并修复了阻断产品旅程的隧道生命周期缺陷，但尚未取得打包 `.app` 内 Remote Gateway、Remote Workspace、Port Forward 联合旅程收据，因此 M2-F01 暂不计为 completed。汇总保持 1/4 模块、7/11 功能点、63.64%。

### 下一步

把隔离 `sshd` fixture 接入 packaged L5，依次验证 Host Key、Remote Gateway、Remote Workspace 文件/Git/checkpoint/worktree、Thread/搜索/mobile 同 Session、Port Forward 暂停/恢复/重启和退出零残留。

## R8：packaged OpenSSH 产品旅程（阶段报告 7）

### 本轮完成

- 新增 `ssh-loopback` packaged smoke 场景，通过真实打包 preload/IPC 调用 SSH、Remote Gateway 和 Port Forward 产品 API。
- 新增独立验收驱动，启动非特权隔离 `sshd`、Ed25519 Host/Client key、SSH config、known_hosts、Remote Workspace owner fixture 和 TCP echo server。
- 打包 App 验证未批准 Host Key 拒绝连接，展示真实指纹并批准后恢复可达。
- 打包 App 通过 SSH 执行 Remote Gateway preflight，验证远端操作系统、架构、Python 和兼容性响应。
- 打包 App 建立 ControlMaster，创建 Port Forward，完成 pause/resume 和真实 TCP payload 往返。
- 通过产品 API 删除 Port Forward、断开 SSH，App 退出后检查除测试自身 `sshd` 外的隔离目录关联进程为零。
- 写入结构化 acceptance receipt：`build/acceptance/packaged-ssh-loopback.json`。

### 自动化结果

- unsigned arm64 `.app` 重建并开发态封装：通过。
- `verify:packaged-ssh-loopback`：通过；5 条真实 packaged journey、unexpected side effects 0、residual processes 0。
- TypeScript typecheck：通过。
- macOS contract：通过。
- `git diff --check`：通过。

### 进度口径

M2-F01 已取得 Host Key、Remote Gateway preflight、SSH connection 和 Port Forward 的真实 packaged 证据，但 Remote Gateway install/upgrade/cancel/failure recovery 以及 Remote Workspace 文件/Git/checkpoint/worktree/Thread/mobile 同 Session 仍未形成联合 packaged receipt，因此暂不提前计为 completed。汇总保持 1/4 模块、7/11 功能点、63.64%。

### 下一步

在隔离远端 HOME 中安装受信 Runtime artifact，启动真实 Remote Gateway，再通过打包 App 覆盖 Remote Workspace 全链路、Port Forward 重启恢复和关闭清理。

## R9：真实 Remote Gateway 与 Remote Workspace packaged 核心旅程（阶段报告 8）

### 本轮完成

- 通过打包 App 内置约 4GB Runtime archive 建立隔离 Python 3.11 Runtime 缓存，Remote Gateway 使用与本地端一致的 `drsai.backend.gateway`。
- SSH authorized key 使用强制命令把远端 `HOME`、工作目录和 `PATH` 隔离到 fixture，避免污染开发机真实 HOME。
- 修复 Remote Workspace 远端端口硬编码导致本机回环验收与既有 Gateway 冲突的问题：新增严格校验的 `OPENDRSAI_REMOTE_GATEWAY_PORT`，生产默认值保持 18642，验收使用随机端口。
- 打包 App 完成真实 Remote Gateway handshake，验证 runtime ID、instance ID、protocol 和 capabilities，并取得 authoritative remote Workspace ID。
- 打包 App 通过正式 Workspace API 完成远端文件树、文本预览、显式 overwrite 写入、Git diff 和 Remote Thread 列表。
- Port Forward owner 从预置占位记录升级为真实 Remote Workspace；继续验证 pause/resume、TCP payload 和产品 API 清理。
- 失败路径增加 Gateway SIGTERM 有界等待及 SIGKILL 回退；最终验收 residual process 为 0，原有本地开发 Gateway PID 43933 未受影响。

### 自动化结果

- unsigned arm64 `.app` 重建：通过。
- `verify:packaged-ssh-loopback`：通过；9 条真实 packaged journey、unexpected side effects 0、residual processes 0。
- Remote Workspace controller 回归：通过。
- Port Forward 回归：通过。
- TypeScript typecheck、macOS contract、`git diff --check`：通过。

### 本轮发现并修复的真实问题

1. 长驻 tunnel 复用 ControlMaster 会立即退出（R7 已修复）。
2. Remote Gateway 固定使用 18642，导致同机真实回环与现有 Gateway 串线、旧 token handshake 永久失败（R9 已修复）。
3. 失败 fixture 只清理 App/SSH、未保证远端 Gateway 退出（R9 已增加有界强制清理）。

### 进度口径

M2-F01 已取得真实 packaged Host Key、SSH、preflight、Gateway handshake、Remote Workspace 文件/Git/Thread 和 Port Forward 核心证据。尚缺 Remote Gateway install/upgrade/cancel/failure recovery、checkpoint/worktree、mobile 同 Session 和 Port Forward App 重启恢复的联合 receipt，因此仍不提前计为 completed。汇总保持 1/4 模块、7/11 功能点、63.64%。

### 下一步

复用 Windows 的临时 Ed25519 artifact 信任流程，生成 macOS 本地受信 wheel，补齐 Gateway install/upgrade/cancel/failure recovery；随后扩展 checkpoint/worktree、mobile 同 Session 和 App 重启恢复。

## R10：Remote Gateway 安装事务与 Remote checkpoint/worktree（阶段报告 9）

### 本轮完成

- 复用 Windows Remote SSH 验收的跨平台最小协议 wheel 结构，在 macOS 用 Runtime Python 离线生成四个临时 artifact。
- 每轮生成一次性 Ed25519 key pair、publisher trust store、SHA-256 和签名；私钥、wheel、trust store 随 fixture 删除，不进入仓库或用户 HOME。
- 打包 App 通过真实 Approval Center 执行 Remote Gateway install、upgrade 和 rollback。
- 验证 upgrade 原子切换 current、保留 previous；不兼容协议 artifact 健康检查失败且 current 不变；主动 cancel 产生 cancelled event 且 current 不变；rollback 后 current/previous 正确互换。
- 发现并修复 macOS Remote Gateway Approval 的非法策略配对：`network + external.service` 改为安全策略允许的 `connector + external.service`，并加入静态契约防回归。
- 真实 Remote Workspace packaged 旅程新增 checkpoint create/preview/Approval Center restore/content verification。
- 新增 remote worktree 创建，验证派生 Workspace 继承 SSH transport、复用父 Runtime，并能读取 worktree 文件。
- cleanup 同时断开派生 worktree、父 Workspace、Port Forward、SSH 和远端 Gateway，最终残留 0。

### 自动化结果

- `verify:packaged-ssh-loopback`：16 条真实 packaged journey 全部通过；unexpected side effects 0、residual processes 0。
- `verify:remote-gateway`：preflight、trust、upload、atomic switch、rollback、cancellation、recovery 通过。
- `verify:remote-workspace`：生命周期、Thread、文件事件、恢复、文件/Git/checkpoint/worktree 通过。
- `verify:port-forwards`：启动、冲突重分配、重连、持久化、审计、shutdown 通过。
- unsigned arm64 `.app`、TypeScript typecheck、macOS contract、`git diff --check`：通过。

### 进度口径

M2-F01 的 Host Key、Remote Gateway 安装事务、Remote Workspace 文件/Git/Thread/checkpoint/worktree 和 Port Forward 核心路径已有真实 packaged receipt。仍缺 mobile 同 Session 与 Port Forward 跨 App 重启恢复，因此暂不计为 completed。汇总保持 1/4 模块、7/11 功能点、63.64%。

### 下一步

补齐 Remote Workspace mobile 同 Session 证据和两阶段 App 重启场景，验证持久化 Workspace、ControlMaster 重建、Port Forward Registry restore、TCP 恢复与最终零残留；完成后重新审计 M2-F01 是否可计为 completed。

## R11：Remote Workspace 联合 packaged 闭环（阶段报告 10）

### 本轮完成

- 打包 App 完成 20 条联合旅程：Host Key、Remote Gateway 安装事务、Remote Workspace、移动端同 Runtime、文件并发冲突、Git 审批提交、Thread 流/快照/搜索、checkpoint/worktree、Port Forward 和 App 重启恢复。
- 移动端配对控制器按 `workspaceId + workspacePath` 路由到所选远端 Runtime；回执校验 `gateway_runtime_id` 与 Remote Workspace Runtime ID 一致，并证明本地 Gateway 未被意外启动。
- Remote Thread 迁移到 Runtime Session/Run 接口，持久化显示 Thread ID 到 Runtime Session ID 的绑定；远端事件、快照和搜索均来自同一 Runtime。
- 修复全新 Runtime 首次创建 Run 时尚未初始化内置 `opendrsai@1` 的首启缺陷。
- Runtime 执行链路传递离线/登录身份和桌面请求元数据，远端恢复夹具不再被本地 RuntimeClient 截获。
- Remote Git 审批提交改为在远端 Gateway 执行，不再错误落到本机路径与本机 Git executor。
- Remote Workspace 预览返回完整文件 SHA-256；陈旧哈希写入明确返回 conflict，避免静默覆盖外部修改。
- Remote Gateway 替换、关闭和 App shutdown 增加在途连接等待、TERM/KILL 有界收敛；重启后重建 ControlMaster 和 Port Forward，最终残留进程为 0。

### 自动化结果

- `verify:packaged-ssh-loopback`：20 条真实 packaged journey 全部通过，App restart 1、unexpected side effects 0、residual processes 0。
- `verify:remote-workspace`：生命周期、Runtime Thread、文件事件、恢复、文件/Git/checkpoint/worktree 路由通过。
- TypeScript typecheck、unsigned arm64 `.app` 构建和开发态封装通过。
- Runtime 归档包含本轮 Python 修复，SHA-256：`a068f9ed9653135ebd39645fe7e978fb0ee5bd90266803f1775050dcda781dc6`。

### 进度口径

M2-F01 的全部完成标准已有同一打包 App、同一隔离 SSH/Remote Runtime 场景的联合收据，正式计为 completed。累计完成 1/4 模块、8/11 功能点，总体进度 72.73%。签名、公证和 signed L6 继续排除。

### 下一步

进入 M2-F04，统一执行 Keychain、TCC、通知、LaunchServices、睡眠/唤醒系统能力矩阵；之后推进 clean L4 和完整 unsigned L5。

## R12：macOS 系统能力矩阵（进行中）

### 已完成证据

- Native Helper 7 项 XCTest、Swift/TypeScript 协议与 allowlist、真实进程 handshake/timeout/cancel/degrade、arm64 Debug 字节可复现构建全部通过。
- 打包产品旅程已有 Keychain CRUD/幂等删除、原生通知点击回跳、Finder/PDF/IDE LaunchServices 交接。
- `packaged-system-events.json` 已验证显示器变化后的窗口恢复、网络 offline/online 后 Gateway 恢复。
- `sleep-wake-real-device.json` 已在 Apple Silicon 真机验证 lock → suspend → resume → unlock 顺序、Gateway 恢复和残留进程 0。
- TCC 打包产品路径三次均成功返回：麦克风 granted、automation granted、通知 canRequest、Files 设置页打开。
- 修复 TCC 验收最终确认框未置前和 AppleEvent 默认超时问题；确认框现使用前台激活与 610 秒 AppleEvent timeout。

### 尚未完成

- 最终“通知可见且 Files 设置页已打开”人工确认三次均超时，未生成 `tcc-real-device.json`；因此 M2-F04 仍不得计为 completed。
- 汇总保持 1/4 模块、8/11 功能点、72.73%。待操作者在真机确认框点击 `Confirmed` 后再推进 clean L4。

## R1：Runtime Conversation 与 Remote Workspace 对齐

### 本轮完成

| 功能点 | 结果 | 主要证据 |
| --- | --- | --- |
| M1-F01 Runtime Thread 实时订阅 | completed | macOS 注册 subscribe/unsubscribe；snapshot、catalog、重复取消和 WebContents cleanup 测试通过 |
| M1-F02 Runtime/Remote Thread 首次快照 | completed | Remote → Runtime → local fallback 已接入 |
| M1-F03 远程消息搜索 | completed | 远端快照搜索、本地合并、去重、排序和 limit 已接入 |
| M1-F04 Remote Workspace 自动恢复 | completed | 只恢复显式 autoReconnect，host/path 去重，失败状态发布和 shutdown cleanup 已实现 |
| M1-F05 远程文件变化事件 | completed | WebSocket 鉴权、cursor 去重、事件发布、断线重试和关闭清理已实现 |

### 代码变化

- 新增 `MacosThreadSnapshotController`，按 `webContents + threadId` 管理 Runtime Session 订阅和 catalog 同步。
- macOS Catalog IPC 从 273/275 提升到 275/275。
- `get-thread-snapshot` 增加 Remote/Runtime fallback。
- `search-thread-messages` 增加 Remote 查询和本地结果合并。
- `RemoteWorkspaceController` 增加 Thread binding、远端快照/搜索、持久连接恢复和文件变化 WebSocket。
- App ready 后异步恢复 Remote Workspace；App shutdown 停止 subscription、watcher、retry timer 和 SSH session。
- unsigned CI 新增 `verify:runtime-remote-parity`。

### 自动化结果

- `verify:runtime-remote-parity`：通过。
- IPC inventory：`preload=275 / windows=275 / macOS=275`，缺失 0。
- Remote Workspace controller：生命周期、Thread 搜索、文件事件、启动恢复、文件/Git 路由和断连失效均通过。
- TypeScript typecheck：通过。
- 完整 `verify:contract`：通过。
- production Electron/Vite build：通过。
- architecture boundaries 和 platform contract：通过。

### 未计入完成的内容

- 当前工作树包含本轮修改，production build metadata 正确标记为 dirty；这不是 clean L4 证据。
- Remote Workspace、Debugger、任务恢复和 macOS 系统能力的真实 packaged 等价旅程属于 M2。
- Runtime 双构建、clean source snapshot 和 L4 聚合属于 M3。
- 100 次重启和 2 小时 soak 属于 M4。
- 所有签名、公证和 L6 项目继续排除。

## 下一轮

R2 进入 M2，按四个功能点推进：

1. Remote Workspace checkpoint/worktree/commit、移动端同 Session 和 Port Forward packaged 旅程。
2. 真实 DAP/CDP、诊断包和进程清理旅程。
3. Chat/Agent/Presentation/结果/计划任务恢复旅程。
4. Keychain、TCC、通知、LaunchServices 和睡眠唤醒系统旅程。

## R2：macOS packaged 等价验收（阶段报告 1）

### 本轮完成

- 对既有 L5 场景做了逐项审计：确认 Keychain、TCC/通知、LaunchServices、睡眠/唤醒已有自动化或真机入口，避免重复建设。
- 补齐 macOS Remote Workspace checkpoint 的 list/create/preview/restore/accept 远端路由。
- 补齐远端 fork worktree 创建与派生 Workspace session 注册；派生 session 复用父 SSH transport。
- 父 Remote Workspace 断开时，派生 worktree session、Thread binding、文件 watcher 和恢复标记会一并失效；关闭派生 session 不会误关共享隧道。
- 扩充 Remote Workspace controller 回归，覆盖文件/Git/checkpoint/worktree 路由和共享 transport 清理。

### 自动化结果

- TypeScript typecheck：通过。
- `verify:runtime-remote-parity`：通过。
- IPC inventory：`preload=275 / windows=275 / macOS=275`，缺失 0。
- 完整 `verify:contract`：通过。
- architecture boundaries：通过。
- platform contract：通过。
- `git diff --check`：通过。

### 进度口径

M2-F01 的实现和组件回归已经完成，但尚未执行包含真实 SSH host、Port Forward 和打包 App 的完整旅程，因此暂不把该功能点计为 completed。汇总仍为 1/4 模块、5/11 功能点、45.45%。

### 下一步

继续补齐 M2-F02/M2-F03 的真实调试器、诊断包、Presentation/结果版本与任务恢复场景；随后生成 unsigned `.app`，统一执行 M2 packaged 证据矩阵。

## R3：unsigned packaged 产品旅程与生命周期加固（阶段报告 2）

### 本轮完成

- 产品态 packaged smoke 扩展到 18 条旅程，新增诊断源码上下文、加密诊断包预览、结果分享 owner/recipient 隔离、版本发布和撤销生命周期。
- CDP packaged 旅程增加 Workspace 源码断点往返，并验证关闭调试策略后 fail-closed。
- Runtime-authoritative Chat 增加事件轮询失败、重连、journal 去重和完成恢复的 packaged 故障夹具；恢复快照保留 desktop connection 事件。
- App 退出顺序调整为先停止 Gateway，再清理其余依赖；shutdown coordinator 使用 15 秒有界超时。
- 修复进程组 `SIGTERM` 失败后错误检查进程组、遗漏单 PID 回退的问题。
- 修复 packaged 场景失败时和 product-state 完成后可能遗留 Gateway 的清理路径。
- `crash-ready` 在 App 被强制 `SIGKILL` 前显式静默无关 Gateway，并新增零残留断言。
- L5 资源采样从 `ps %cpu` 生命周期平均值改为累计 CPU 时间差分，得到真实区间 CPU；稳定性场景在 Gateway 健康并预热后才开启 idle 采样窗口，性能预算未放宽。

### 自动化结果

- unsigned arm64 `.app` 重建：通过，build metadata 为 `1.5.1+3a6726cb217c (dirty)`。
- 缩短版 packaged L5：通过；18 条产品旅程、5 次热启动、1 次重启、1 次受管进程崩溃恢复、1 次 App 强制崩溃恢复、60,004 ms stability、3 项故障注入、性能预算和零残留进程均通过。
- 完整 `verify:contract`：通过。
- `verify:runtime-remote-parity`：通过。
- IPC inventory：`preload=275 / windows=275 / macOS=275`，缺失 0。
- Remote Workspace controller：文件/Git/checkpoint/worktree、Thread 搜索/恢复和断连失效回归通过。
- TypeScript typecheck、production build、`git diff --check`：通过。

### 进度口径

本轮形成了 M2-F02（CDP/诊断）和 M2-F03（Chat/结果分享）的大量真实 packaged 证据，但以下完成标准仍缺少直接证据，因此不提前计为 completed：

- M2-F01：真实 SSH host key、远端 Gateway 安装/升级、移动端同 Session 和 Port Forward packaged 旅程；
- M2-F02：真实 Python DAP 断点/异常退出旅程；
- M2-F03：Presentation/PDF 暂停、继续、取消、失败重试，以及定时任务真实触发/重启恢复；
- M2-F04：TCC/通知/LaunchServices/睡眠唤醒真机 packaged 矩阵尚未统一执行。

缩短版 L5 不是 M4 的正式证据；M4 仍要求 100 次重启和 2 小时 soak。汇总仍为 1/4 模块、5/11 功能点、45.45%。

### 下一步

R4 优先补齐 Presentation/PDF 和真实 Python DAP packaged 旅程，再执行 macOS 系统能力矩阵；Remote Workspace 的真实 SSH/移动端协作需要接入可控远端测试主机后完成。

## R4：Presentation/PDF、真实 Python DAP 与任务恢复（阶段报告 3）

### 本轮完成

- 补齐 packaged Presentation/PDF 旅程：真实多页演示 PDF 经 bundled Python/pypdf 分析，覆盖暂停、继续、取消、failed 终态、同 requestId 重试和最终可编辑 PPTX 质量检查。
- 修复 macOS packaged Runtime 缺少 `drsai.content.pdf.presentation` 导致 Presentation 实际不可用的问题：App 额外打包 `cores/python` 的同源解析脚本，产物与源文件 SHA-256 一致。
- 补齐 packaged PPTX 模板资源，并修复 packaged 模式错误从 `app.asar/resources` 读取外部资源的问题。
- 修复 PDF 解析返回 `null` 时无上限重启 Python 子进程的问题；解析失败现在有界、明确失败。
- 补齐真实 Python DAP：debugpy 启动、入口暂停、Workspace 断点、栈帧、作用域、变量、敏感变量脱敏、只读求值、terminate 和异常 debuggee 退出。
- 定时任务在 product-state 创建并执行安全 due 检查后保持 paused，独立 App restart 场景验证其持久恢复。
- packaged L5 临时目录清理增加 ENOTEMPTY 竞态重试。

### M2-F02 完成判定

M2-F02 `Debugger 与诊断` 现有直接证据覆盖：

- 真实 Python/debugpy DAP 启动、断点、停止与异常退出；
- CDP attach、Workspace 源码断点、disconnect 和策略关闭后的 fail-closed；
- 诊断源码导航、加密诊断包、秘密脱敏和完整性哈希；
- App 退出后的 DAP/CDP/debuggee 零残留进程。

因此 M2-F02 从 pending 调整为 completed。

### 自动化结果

- unsigned arm64 `.app` 重建：通过。
- packaged product-state：20 条真实 preload/IPC 旅程通过。
- 缩短版 L5：通过；1 次重启、1 次强制 App 崩溃恢复、1 次 Gateway/Native Helper 强制崩溃恢复、60,002 ms stability、故障注入、性能预算和零残留进程均通过。
- Presentation Python 资源 SHA-256 与 `cores/python` 源文件一致；PPTX 资源 SHA-256 与产品模板一致。
- 完整 `verify:contract`：通过。
- TypeScript typecheck、production build、`git diff --check`：通过。

### 进度口径

- 模块：1/4（25.00%）；M2 尚有 F01/F03/F04 未完成，因此模块数不增加。
- 功能点：6/11（54.55%）。
- M2-F03 已补齐 Presentation、结果版本/分享和定时任务跨重启证据，但仍缺“active Chat/Agent run 在 App 强杀时的 packaged 恢复”，暂不计 completed。
- 缩短版 L5 仍不等于 M4 的 100 次重启和 2 小时正式证据。

### 下一步

R5 先补 active Chat/Agent run 强杀恢复，争取完成 M2-F03；随后执行 Keychain/TCC/通知/LaunchServices/睡眠唤醒系统能力 packaged 矩阵，推进 M2-F04。

## R5：active run 崩溃恢复与原生系统能力（阶段报告 4）

### 本轮完成

- Runtime Chat 增加可持续运行的打包态崩溃夹具；强杀 App 后，恢复进程能从 journal 读回崩溃前内容，并以明确 `run.failed` 收敛，不伪造 `done`。
- Agent run 增加 active start journal 崩溃夹具；恢复进程保留 start 事件并追加 interrupted error，不伪造完成事件。
- 定时任务绑定真实 workflow，验证到期仅触发一次、重复扫描幂等、任务暂停、任务与 workflow run 跨 App 重启恢复。
- L5 强杀测试改为采样并终止完整 App 进程树，恢复后验证零残留。
- product-state 增加打包内 Native Helper 的真实 Keychain put/get/delete/幂等 delete；账户标识遵循生产协议的 UUID 约束。
- 后台任务旅程补全 `queued → running → cancelled → retry → running → completed`，真实触发 Electron 原生通知并验证 click 回调。
- LaunchServices 的 IDE context、原生图标、编辑命令和 PDF 打开旅程继续通过。
- 产品态 packaged 旅程从 20 条扩展为 22 条。

### M2-F03 完成判定

M2-F03 `任务与结果恢复` 已有直接打包态证据覆盖 active Chat、active Agent、Presentation/PDF、结果分享版本、定时任务真实触发/幂等和跨重启恢复，因此从 pending 调整为 completed。

### 自动化结果

- TypeScript typecheck：通过。
- Completion notification 专项测试：通过。
- unsigned arm64 `.app` 构建与 ad-hoc development seal：通过。
- 缩短版 packaged L5：通过；22 条产品旅程、1 次正常重启、1 次 App 强制崩溃、Gateway/Native Helper 强制崩溃恢复、60,002 ms stability、性能预算和零残留进程均通过。
- 完整 `verify:contract`：通过；包含 Keychain 生命周期、系统权限、LaunchServices、恢复协调器、进程清理和 IPC 安全回归。
- Native Helper XCTest/协议/真实 Keychain CRUD/可复现构建：通过。

### 进度口径

- 模块：1/4（25.00%）。
- 功能点：7/11（63.64%）。
- M2：2/4；F02、F03 completed，F01、F04 in progress。
- M2-F04 的 Keychain CRUD、锁定 fail-closed、legacy reference 兼容、通知展示/点击和 LaunchServices 已有自动化证据；TCC 权限提示/拒绝状态以及睡眠、唤醒、锁屏的完成标准要求操作者在真实 packaged App 上执行物理交互，尚未计 completed。
- 本轮 L5 使用缩短参数，不替代 M4 要求的 100 次重启和 2 小时正式 soak。
- Developer ID、公证、signed update 与 signed L6 继续排除。

### 下一步

R6 执行未签名真实设备 TCC 与睡眠/唤醒旅程，补齐显示器变化和网络恢复的 packaged IPC 证据，争取完成 M2-F04；随后接入可控 SSH 主机完成 M2-F01。

## R6：真实设备系统能力与生命周期恢复（阶段报告 5，进行中）

### 已完成

- 修复 Native Helper 自动化权限请求成功后又返回 `unknown` 的状态机缺陷；Apple Events 使用系统权限 API，并在无法建立授权时 fail-closed。
- 修复主进程用新 Helper 的 `unknown` 覆盖本次 Finder 自动化请求结果的问题；明确请求结果保持为 granted/denied。
- 修复通知权限状态被 Native Helper 标记为不可请求的问题。
- 修复 TCC 人工确认框声明等待 600 秒、测试进程却在 60 秒提前终止的超时冲突。
- 新增真实 packaged `system-events` 场景：Renderer 通过 preload 订阅生命周期事件，实际集成层执行 display change 窗口恢复、network offline→online、Port Forward suspend/resume 和 Gateway 恢复。
- 修复 system-events 监听注册时序、重复 Runtime 安装和瞬时安装状态误判。
- 修复睡眠/唤醒真机驱动的 Gateway 返回值误判、首次启动健康轮询和默认端口依赖；脚本现在使用独立随机 loopback 端口。
- 修复 Native Helper Mach-O 嵌入工作区绝对 dylib 路径的问题；Helper 依赖和 protocol dylib install name 均改为 `@rpath`，为 clean L4 的可重定位包验证清除前置缺陷。

### 自动化结果

- 缩短版 packaged L5：通过；新增 `packaged-system-events` 两条旅程，1 次正常重启、1 次 App 强制崩溃、60,003 ms stability 和零残留进程通过。
- 完整 `verify:contract`：通过。
- `verify:release-contract`：通过。
- Native Helper XCTest、协议、Keychain 和字节可复现构建：通过。
- 实际 `.app` 内 Native Helper 的 `@rpath`/dylib identity、arm64 架构和独立 handshake：通过。
- TypeScript typecheck、unsigned arm64 App 构建和 `git diff --check`：通过。

### 尚待完成

- TCC 状态/请求和设置跳转已越过自动断言，但操作者未在 10 分钟内点击最终通知可见性确认，因此尚未生成 `tcc-real-device.json`。
- 睡眠/唤醒测试已成功进入 READY 并保持 App/Gateway 健康 15 分钟，但期间未发生物理“睡眠→唤醒→解锁”，因此按时限退出且未生成真机回执；未取得物理事件前不把 M2-F04 计为 completed。

### 当前进度

- 模块：1/4（25.00%）。
- 功能点：7/11（63.64%）。
- M2-F04 保持 in_progress；显示器和网络恢复已完成，TCC 人工确认与睡眠/唤醒真机回执待完成。
