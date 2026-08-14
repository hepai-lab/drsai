# OpenDrSai macOS v1.5.7 Windows 功能补齐方案

> 文档状态：Draft for implementation
>
> 基线日期：2026-08-11
>
> 目标版本：macOS Desktop v1.5.7（Apple Silicon）
>
> 对照版本：Windows Desktop v1.5.7

## 0. 执行摘要

本轮审计的结论不是“macOS 已与 Windows 等价”，而是：macOS 已复用完整的共享 renderer、preload 和大部分 shared main 服务，但平台主进程组合层落后于 Windows。

当前可重复验证的静态基线为：

- Desktop preload API：**374 个 IPC 通道**；
- Windows main：**374/374**，接线覆盖率 **100%**；
- macOS main：**304/374**，接线覆盖率 **81.28%**；
- macOS 明确缺失：**70 个 IPC 通道**；
- 产品级验收目录仍冻结为 **12 个模块、72 个一级功能点**；
- 70 个 IPC 缺口集中在 **6 个既有模块、9 个补齐工作包**，不另造一套功能编号；
- `npm run typecheck`（macOS node/web 两套配置）在本次审计工作区通过；
- 2026-07-29 的 `macos-feature-acceptance.json` 虽记录 72/72 accepted，但它绑定旧提交 `5d400030`，当时 inventory 仅为 275/275/275。该证据不能证明当前 374 通道基线，也不能用于 v1.5.7 放行。

v1.5.7 的最低发布目标是：

1. macOS inventory 达到 **374/374，missing=0**；
2. 70 个通道不能只“注册占位”，必须完成服务注入、能力声明、权限与路径策略、错误/取消/幂等语义；
3. 12 模块、72 功能点在当前提交重新生成 L0～L6 证据；
4. Windows 已有的新能力在 macOS 完成 contract、集成、真实 Electron、packaged app、Apple 平台和签名升级验收；
5. 发布证据必须绑定同一 clean commit、同一 v1.5.7 产物哈希，禁止沿用旧 receipt。

## 1. 审计范围与事实来源

本方案以仓库当前代码为准，重点核对以下来源：

- `apps/desktop/shared/api`：跨平台类型、能力和协议契约；
- `apps/desktop/shared/main/preload.ts`：renderer 可调用 API 的事实全集；
- `apps/desktop/shared/main`：可复用业务服务及状态机；
- `apps/desktop/shared/renderer`：共享 UI、入口和能力门禁；
- `apps/desktop/windows/src/main/index.ts`：Windows 完整组合根；
- `apps/desktop/windows/scripts` 与 `docs/desktop/evidence`：Windows 新功能测试和发布证据；
- `apps/desktop/macos/src/main`：macOS bootstrap、服务容器、IPC registrar 和平台服务；
- `apps/desktop/shared/test-kit`：macOS catalog、inventory、contract、coverage 和 release decision；
- `apps/desktop/macos/build/acceptance`：既有 L3～L6 证据及其 commit/time 绑定。

审计采用三层口径，三者不能混用：

| 层级 | 数量口径 | 当前结论 | 用途 |
|---|---:|---|---|
| 产品能力层 | 12 模块 / 72 一级功能点 | catalog 结构仍有效，但旧验收已过期 | 产品范围、owner、最终验收 |
| 平台契约层 | 374 IPC 通道 | macOS 304，缺 70 | 判断 UI 到 main 是否可达 |
| 发布证据层 | L0～L6 | 旧证据覆盖 275 通道旧提交 | 判断能否发布，不以源码存在代替证据 |

## 2. 架构判断

Windows 新功能大部分已经进入共享 renderer/preload，但实现并未完全下沉为可直接复用的 shared main 服务。当前 Windows `index.ts` 仍承担较多业务 handler、服务构造和平台适配。macOS 则采用 `createAppServices`、`registerAllIpc` 和多个领域 registrar 的组合方式。

因此补齐必须遵守以下边界：

- 纯业务状态机、数据转换、Runtime 协议、持久化模型下沉 `shared/main`；
- 对话框、Finder、Keychain、TCC、通知、Dock、系统重启等留在 macOS platform adapter；
- macOS registrar 只做安全注册、输入输出适配和服务调用，不复制 Windows 大段 handler；
- preload/API 不新增平台分叉；真正不适用的能力必须写入 capability 和验收例外，而不是静默缺 handler；
- 所有新 handler 继续经过统一 secure registrar，继承 sender/frame 校验、schema、超时、取消、幂等、错误脱敏和审计。

## 3. 模块总表：12 个模块、72 个一级功能点

以下是 v1.5.7 必须重新验收的完整产品模块，不因本轮只有 6 个模块出现 IPC 缺口而缩减回归范围。

| 模块 | 6 个一级功能点 | 当前增量影响 |
|---|---|---:|
| MOD-01 工程基线与契约 | 干净构建；Apple 资源；IPC inventory；API owner/status/testId；共享依赖边界；版本与产物元数据 | 基线重验 |
| MOD-02 IPC 安全与能力治理 | secureHandle；输入输出 schema；超时/取消/幂等；审计脱敏；capability registry；路径/URL 策略 | 70 通道横切重验 |
| MOD-03 macOS 生命周期与系统集成 | 单实例；deep link/Finder；菜单/Dock；末窗/退出；崩溃恢复；系统事件恢复 | **缺 1 通道** |
| MOD-04 Runtime、Gateway 与本地基础设施 | Runtime 可复现；安装修复；内容校验；Gateway 生命周期；唤醒重连；辅助进程清理 | 回归重验 |
| MOD-05 身份、凭据与权限 | OIDC/SSO/微信；Codex 登录；Keychain 生命周期；Keychain 恢复；TCC；秘密隔离 | **缺 4 通道** |
| MOD-06 Chat、Agent、Thread 与审批 | Chat 流；Chat 恢复；Agent 生命周期；Thread；统一审批；异常与重启一致性 | **缺 25 通道** |
| MOD-07 Workspace、文件、Git 与终端 | Workspace；Git；checkpoint；fork/worktree；IDE/PDF 交接；PTY | **缺 3 通道** |
| MOD-08 Browser、Debugger、MCP 与诊断 | Browser 生命周期；Browser 审批；DAP/CDP；MCP；诊断/源码导航；诊断隐私 | 回归重验 |
| MOD-09 SSH、远程工作区与端口转发 | SSH inventory；host key；远端 Gateway；远端路由；远端旅程；端口转发 | 回归重验 |
| MOD-10 自动化、配置、记忆与技能 | 偏好/命令；项目/团队记忆；项目技能；Workflow；计划/复用任务；后台任务 | **缺 23 通道** |
| MOD-11 协作、渠道、展示、语音与通知 | 分享；敏感信息；Channel adapter；Manager presentation；语音；通知 | **缺 14 通道** |
| MOD-12 打包、签名、更新与发布 | App/DMG/ZIP；hardened runtime；公证；安装卸载；签名更新；健康标记/回滚 | 基线重验 |

统计校验：`1 + 4 + 25 + 3 + 23 + 14 = 70`。MOD-01/02/04/08/09/12 虽无独占缺失通道，仍受 shared 代码变化、Runtime、权限和发布链影响，不能跳过。

## 4. 70 个缺失 IPC 的完整清单

### WP-01 运行可追溯、检查、比较、实验与可编辑回放（25 个，MOD-06）

目标：补齐 Windows Phase 1～3 已有的 Run manifest、检查、关系、比较、实验、采纳和回放闭环，并将 Runtime 两类审批接入统一审批中心。

- `desktop:run-list`
- `desktop:run-manifest`
- `desktop:run-manifest-export`
- `desktop:run-inspection`
- `desktop:run-item-locator`
- `desktop:run-relations-get`
- `desktop:run-comparison-create`
- `desktop:run-comparison-get`
- `desktop:run-experiment-capabilities`
- `desktop:run-experiment-create`
- `desktop:run-experiment-get`
- `desktop:run-experiment-update`
- `desktop:run-experiment-delete`
- `desktop:run-experiment-export`
- `desktop:run-experiment-candidate-snapshot`
- `desktop:experiment-release-gate`
- `desktop:run-adoption-preview`
- `desktop:run-adoption-apply`
- `desktop:run-adoption-discard`
- `desktop:replay-boundaries-get`
- `desktop:replay-plan-create`
- `desktop:replay-plan-get`
- `desktop:replay-plan-execute`
- `desktop:runtime-run-approval-decision`
- `desktop:runtime-security-approval-decision`

实现要求：优先把 Windows 组合根内的领域逻辑抽到 shared service；manifest/export 必须稳定排序、带 schema/version/hash；locator 禁止越过 workspace；apply/execute 必须校验快照、diff/hash、workspace identity 和审批状态；重复 operationId 不得重复产生副作用；discard 只撤销本次草稿/采纳事务。

### WP-02 Worktree 采纳与默认工作区（3 个，MOD-07）

- `desktop:worktree-adoption-preview`
- `desktop:worktree-adoption-apply`
- `desktop:create-default-workspace`

实现要求：复用已有 workspace registry、worktree migration 和原子持久化；default workspace 必须稳定、幂等并绑定用户 identity；采纳前后二次校验 source workspace、worktree、HEAD/diff hash；禁止隐式 stage、覆盖用户未提交更改或越界写入。

### WP-03 Agent 工具/技能/知识策略（10 个，MOD-10，关联 MOD-06）

- `desktop:get-my-drsai-agent-tool-policy`
- `desktop:preview-my-drsai-agent-tools`
- `desktop:update-my-drsai-agent-tool-policy`
- `desktop:test-agent-tool`
- `desktop:get-my-drsai-agent-skill-policy`
- `desktop:preview-my-drsai-agent-skills`
- `desktop:update-my-drsai-agent-skill-policy`
- `desktop:get-my-drsai-agent-knowledge-policy`
- `desktop:preview-my-drsai-agent-knowledge`
- `desktop:update-my-drsai-agent-knowledge-policy`

实现要求：读取、preview、commit 三阶段分离；preview 不产生持久副作用；update 使用 revision/hash 乐观锁；工具测试进入风险策略和审批；Agent/模型/工具/技能 identity 在 UI、Runtime 和审计中一致。

### WP-04 技能管理（7 个，MOD-10）

- `desktop:list-available-skills`
- `desktop:list-installed-skills`
- `desktop:get-skill-content`
- `desktop:install-skill`
- `desktop:update-skill`
- `desktop:uninstall-skill`
- `desktop:reload-skills`

实现要求：区分 bundled、user、project 来源；安装源、目录穿越、符号链接、manifest、大小和哈希全部校验；更新失败原子回滚；卸载不得删除 bundled 或越出受管目录；reload 与活动 run 的快照语义明确。

### WP-05 知识库生命周期（6 个，MOD-10）

- `desktop:list-knowledge-bases`
- `desktop:create-knowledge-base`
- `desktop:index-knowledge-base`
- `desktop:search-knowledge-base`
- `desktop:test-knowledge-base`
- `desktop:delete-knowledge-base`

实现要求：明确 macOS Runtime 的实际 provider/索引依赖，不使用仅返回成功的假实现；覆盖大文件、异常编码、重复索引、取消、部分失败恢复、删除中的活动引用以及隐私数据不进入诊断包。

### WP-06 GFS 文件服务（9 个，MOD-11）

- `desktop:gfs-healthcheck`
- `desktop:gfs-list`
- `desktop:gfs-stat`
- `desktop:gfs-read`
- `desktop:gfs-write`
- `desktop:gfs-upload-file`
- `desktop:gfs-download-file`
- `desktop:gfs-delete`
- `desktop:gfs-share-url`

实现要求：统一认证和 endpoint readiness；本地路径走 macOS 文件选择/访问策略；远端 key/path 规范化；上传下载支持取消、进度、大小限制、hash 校验和临时文件清理；share URL 只允许受信 origin 且不得泄露 token。

### WP-07 Thread 分享（3 个，MOD-11，关联 MOD-06）

- `desktop:create-thread-share`
- `desktop:open-thread-share`
- `desktop:reveal-thread-share`

实现要求：复用 shared HTML/share sensitivity；导出前执行秘密扫描和用户确认；文件写入原子化；open/reveal 使用 macOS Shell/Finder adapter；撤销、过期或缺文件返回稳定可恢复错误。

### WP-08 Codex workspace session 与恢复（3 个，MOD-05）

- `desktop:sync-codex-workspace-sessions`
- `desktop:cancel-codex-workspace-session-sync`
- `desktop:restart-codex-backend`

实现要求：与现有 Codex login/status/logout 和 session resume policy 合并；同步可取消、单飞、有界并发且按 workspace/user 隔离；restart 必须先排空或安全终止活动请求，完成 readiness 后再恢复订阅，不允许产生重复 session。

### WP-09 移动远程、模型探测与应用重启（4 个，MOD-03/MOD-05/MOD-11）

- `desktop:mobile-remote-diagnose`
- `desktop:mobile-runtime-rename`
- `desktop:probe-my-drsai-provider-model`
- `desktop:restart-application`

实现要求：移动 Runtime rename/diagnose 复用 pairing controller 的会话、权限和审计边界；模型 probe 使用 Keychain credential 引用，不回传秘密；应用重启走统一 shutdown plan，等待日志、Gateway、PTY、voice、browser worker 和临时文件收敛后 relaunch。

## 5. 非 IPC 但必须同步补齐的功能

仅补齐 70 个通道仍不足以达到 Windows v1.5.7 的产品等价。以下能力已有共享或 Windows 代码变化，必须纳入回归：

1. **OAEP/runtime 协议选择与 session stream**：握手、版本选择、legacy 回退遥测、outbox 终止清理、thread subscription、snapshot 水位线、附件 item parity。
2. **运行控制与恢复 UX**：OperationalStateBar、取消、重启、OAEP gap recovery、runtime restart recovery、失败原因和恢复动作必须在 macOS 可见且可执行。
3. **模型管理收敛**：provider discovery/probe、默认模型、commit activation、preview、用户 identity 传播和凭据不落明文。
4. **语音链**：串行/流式输入、TTS、预热连接、failover、取消、临时文件生命周期、麦克风 TCC 和签名 Runtime 交付。
5. **附件与结果来源**：拖放/选择、上传上下文不污染聊天正文、结果 provenance、定位、manifest 导出和敏感信息处理。
6. **首启和默认工作区**：不得出现假默认列表；无配置首启、升级首启、重启和登录用户切换都必须稳定。
7. **平台打包资源**：原生 helper、arm64 Python Runtime、图标、entitlements、usage descriptions、codesign/notarization、DMG/ZIP/update metadata 必须与 v1.5.7 同版本同哈希。

## 6. 实施分阶段

### P0：冻结事实基线与防倒退（0.5～1 天）

- 保存当前 inventory 结果到新的 v1.5.7 evidence，不覆盖旧证据；
- 给 inventory 增加 release 模式：macOS `missingOnMacos.length !== 0` 直接失败；
- 更新 macOS feature catalog/suites，使新增 Windows 功能进入对应 Fxx.x，而不是只由 IPC inventory 覆盖；
- 所有 receipt 增加 commit、dirty、source fingerprint、inventory count 和产物 hash；
- 建立 70 通道到 work package、owner、test ID 的机器可读 ledger。

退出条件：基线明确显示 374/374/304、missing=70，且旧 275 通道 receipt 被判为 stale。

### P1：抽取共享服务并完成组合层（3～5 天）

- 先实施 WP-01、WP-02；这是运行可追溯/可编辑能力和工作区安全的主干；
- 从 Windows `index.ts` 抽离可复用服务，macOS/Windows 分别注入 platform adapter；
- 将 registrar 按领域拆分，避免继续扩大单文件；
- 每补一组即运行 inventory、node/web typecheck 和对应 contract。

退出条件：运行/回放/实验/worktree 28 个通道在 macOS 可达，正反路径 contract 通过。

### P2：资源与知识能力（3～5 天）

- 实施 WP-03～WP-06；
- Skills/KB/GFS 必须验证真实 Runtime 或明确 capability-gated，不接受 fake-only 完成；
- 补齐磁盘、权限、网络、取消、回滚和隐私策略；
- 更新 renderer capability，加载期间默认 fail-closed。

退出条件：32 个资源类通道完成；技能/知识/GFS 至少各有一条真实服务闭环。

### P3：协作、Codex 与平台恢复（2～3 天）

- 实施 WP-07～WP-09；
- 完成 Finder/系统重启、Codex 重启恢复、移动远程和模型 probe；
- 对 shutdown/relaunch、sleep/wake、offline/online 做组合测试。

退出条件：剩余 10 个通道完成，inventory 达到 374/374/374。

### P4：Electron/packaged/真机验收（2～4 天）

- 在真实 Apple Silicon 上运行共享 renderer E2E 和 macOS platform E2E；
- 使用 unpacked app 验证主进程组合，再用签名 packaged app 验证权限、路径和 helper；
- 执行干净安装、覆盖升级、自动更新、回滚、重启、睡眠唤醒和网络恢复；
- 对关键旅程录制截图、日志摘要和 JSON receipt。

退出条件：L0～L6 全部重新生成且绑定同一 release candidate。

## 7. 测试与验收方案

### 7.1 测试分层

| 层级 | 验证内容 | 强制门禁 |
|---|---|---|
| L0 静态 | typecheck、依赖边界、API/schema/codegen、inventory | 374/374/374，missing=0 |
| L1 单元/契约 | 状态机、正反输入、错误码、取消、幂等、回滚 | 每个新增通道至少正向+负向；副作用通道再加幂等/恢复 |
| L2 组合 | `createAppServices`、registrar、Runtime fake/real adapter、重启恢复 | 禁止 handler 存在但依赖未注入；capability 与 readiness 一致 |
| L3 Renderer Electron | 真实 Electron UI、入口门禁、键盘、可访问性、视觉状态 | 0 serious/critical axe；无未实现入口；恢复动作可达 |
| L4 macOS 平台 | Keychain、TCC、Finder、Dock/menu、PTY、sleep/wake、网络 | 必须 `darwin-arm64` 真机 receipt |
| L5 Packaged | `.app`/DMG、helper、Runtime、崩溃/重启、升级前后核心旅程 | 禁止用 dev server 代替 packaged app |
| L6 发布 | codesign、hardened runtime、公证、staple、Gatekeeper、签名更新/回滚 | 同一 commit/version/hash；P0/P1=0 |

### 7.2 70 通道的最低用例矩阵

每个工作包必须具备：

- happy path；
- schema/非法枚举/超大 payload；
- 未登录、凭据缺失、权限拒绝；
- workspace/path traversal/symlink/错误 identity；
- Abort/timeout/进程退出；
- 重复 requestId/operationId；
- 进程重启后的 pending/running/terminal 状态；
- 日志和导出秘密扫描；
- renderer reload 后订阅不重复、terminal 不丢失；
- Windows 原测试继续通过，防止共享抽取造成回归。

专项场景：

| 工作包 | 必验场景 |
|---|---|
| WP-01 | manifest hash、locator 越界、比较异构 run、experiment rollback、replay 计划过期、审批拒绝、执行中取消、重启续接 |
| WP-02 | dirty tree、HEAD 漂移、重复 apply、默认 workspace 重启保持、用户切换隔离 |
| WP-03/04 | preview 无副作用、revision 冲突、恶意 skill 包、符号链接、更新回滚、活动 run 快照 |
| WP-05 | 重复索引、大/坏文件、取消后清理、搜索隔离、删除活动 KB |
| WP-06 | 断点/取消、hash 不符、磁盘不足、临时文件清理、过期 share URL、token 脱敏 |
| WP-07 | 分享敏感内容拦截、文件被移除、Finder reveal、导出原子性 |
| WP-08 | sync 单飞、cancel、backend crash、restart readiness、重复 session 去重 |
| WP-09 | pairing 过期、未授权 rename、provider 401/429/timeout、活动任务下 app restart |

### 7.3 核心用户旅程验收

必须至少覆盖以下 12 条 packaged 用户旅程：

1. 干净安装 → 登录 → 创建默认工作区 → 新建 thread → 完成一次 Agent run；
2. 打开历史 thread → 增量 hydration → 继续对话，无重复消息；
3. 运行中取消 → terminal 状态落盘 → 重启后可继续新任务；
4. 打开 Run Inspector → 定位 item → 导出 manifest；
5. 创建比较与实验 → candidate snapshot → release gate；
6. 创建 replay plan → 用户审阅 → 执行 → 结果 provenance 完整；
7. worktree adoption preview → approval → apply，且 dirty tree 安全；
8. 安装/更新/卸载 skill，Agent policy preview/update 生效；
9. 建 KB → 索引 → 搜索 → Agent 使用 → 删除；
10. GFS 上传 → 读取 → 下载 → 分享 → 删除；
11. Codex workspace session sync → cancel/retry → backend restart 后恢复；
12. v1.5.6 → v1.5.7 签名升级 → 健康标记；失败时自动回滚且用户数据不丢失。

### 7.4 建议命令门禁

开发阶段每个 PR 至少执行：

```bash
cd apps/desktop/macos
npm run typecheck
npm run verify:inventory
npm run verify:contract
npm run verify:oaep-protocol
npm run verify:renderer-l3
```

合并前增加对应领域专项，如 `verify:workspace-*`、`verify:project-skills`、`verify:mcp-sessions`、`verify:voice-streaming`、`verify:runtime-remote-parity`。Release Candidate 必须运行：

```bash
cd apps/desktop/macos
npm run verify
npm run verify:release-contract
npm run verify:packaged:l5
npm run preflight:release
npm run decide:release
```

现有 `verify:inventory` 在报告缺失时仍返回成功，v1.5.7 release pipeline 必须增加 strict 参数或独立 parity gate；否则 81.28% 也可能绿灯。

## 8. 发布验收阈值

| 指标 | v1.5.7 门槛 |
|---|---:|
| macOS IPC inventory | 374/374，100% |
| 未登记/缺失 handler | 0 |
| 12 模块 / 72 功能点 | 当前 commit 72 accepted，partial/notTested=0 |
| 新增副作用通道幂等与恢复覆盖 | 100% |
| shared business line coverage | ≥ 90% |
| core state-machine branch coverage | ≥ 90% |
| integration adapter line coverage | ≥ 60%，且本轮新增分支 ≥ 80% |
| Renderer axe serious/critical | 0 |
| Packaged 12 条核心旅程 | 12/12 |
| crash/restart/sleep-wake/network recovery | 全通过，无孤儿 Gateway/PTY/helper |
| P0/P1 | 0 |
| 签名、公证、Gatekeeper、更新回滚 | 全通过 |

旧 coverage receipt 中 integration adapter 为 59.37%，低于本方案 60% 门槛；应通过新增 macOS adapter 测试提升，而不是下调阈值。

## 9. 证据与交付物

v1.5.7 应新增独立目录或统一前缀，至少输出：

- `macos-v1.5.7-ipc-parity.json`：374 通道逐项状态、owner、testId；
- `macos-v1.5.7-feature-acceptance.json/.md`：12 模块、72 功能点；
- `macos-v1.5.7-test-results.json`：suite、输入维度、结果、耗时；
- `macos-v1.5.7-coverage.json`：范围、阈值、source hash；
- `macos-v1.5.7-packaged-journeys.json`：12 条旅程和截图索引；
- `macos-v1.5.7-platform-evidence.json`：Keychain/TCC/Finder/PTY/sleep-wake；
- `macos-v1.5.7-release-attestation.json`：commit、dirty=false、版本、App/DMG/ZIP/runtime/helper SHA-256、签名、公证、更新和回滚结果；
- `macos-v1.5.7-defect-register.json`：P0～P3、owner、状态、验证用例和例外审批。

任何“通过”必须可追溯到测试源文件 hash 和产物 hash。截图只能作为 UX 辅证，不能替代状态机、文件、进程和安全断言。

## 10. 风险与控制

| 风险 | 影响 | 控制 |
|---|---|---|
| 直接复制 Windows `index.ts` handler | 双端漂移、不可维护 | 业务下沉 shared，平台仅 adapter/registrar |
| 只追求 374/374 数字 | 空 handler 或 fake 实现被误判完成 | contract + real adapter + packaged 三重门禁 |
| 旧 72/72 receipt 被复用 | 错误放行 | commit/source/inventory/产物四重绑定，stale 自动失败 |
| Skills/KB/GFS Runtime 依赖未进入 macOS 包 | dev 可用、packaged 失败 | runtime manifest/SBOM/import smoke + packaged 真链路 |
| Keychain/TCC/Finder 行为被 Node fake 掩盖 | 真机权限失败 | L4 真机与 L5 signed package 强制证据 |
| Run adoption/replay 越界或重复副作用 | 用户数据损坏 | workspace identity、hash 乐观锁、审批、operationId、原子替换 |
| restart/cancel 引发状态重复 | 对话阻塞或重复执行 | terminal outbox 清理、订阅去重、journal 恢复矩阵 |
| 当前工作区已有未提交修改 | 证据不可复现 | 实施时分离变更，RC 必须 dirty=false；本方案不覆盖现有修改 |

## 11. Definition of Done

macOS v1.5.7 只有同时满足以下条件才算补齐：

- 70 个缺失 IPC 全部有真实实现或经产品批准的明确“不适用”契约；本版本目标为不适用项 0；
- Windows/macOS/preload inventory 为 374/374/374；
- 12 模块、72 一级功能点对当前 RC 重新验收为 accepted；
- shared renderer 在 macOS 不显示不可用或尚未 ready 的敏感入口；
- Run trace/replay/experiment、worktree adoption、Agent resource policy、Skills、KB、GFS、Thread share、Codex session sync 和 restart 均完成 packaged 闭环；
- macOS 原生权限、Keychain、Finder、Dock/menu、PTY、睡眠唤醒和应用重启完成真机验证；
- `.app`、DMG、ZIP、Runtime、native helper 均签名一致，公证/staple/Gatekeeper 通过；
- 从上一正式版升级和失败回滚均不丢用户数据；
- release decision 绑定 clean commit，P0/P1 为 0，无 stale evidence。

## 12. 最终建议

建议按“运行追溯主干 → 资源能力 → 协作与恢复 → packaged 发布”顺序推进，不按 70 个通道逐个零散复制。第一优先级是把 Windows 新增业务从平台组合根中抽成共享服务；第二优先级是补齐 macOS registrar 与真实平台 adapter；第三优先级才是更新验收证据。这样 v1.5.7 不只是达到静态通道数量一致，也能避免下一轮 Windows 继续演进后 macOS 再次大幅落后。
