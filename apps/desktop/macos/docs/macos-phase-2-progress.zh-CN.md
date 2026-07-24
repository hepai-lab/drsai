# OpenDrSai macOS 第二阶段实施进度

更新时间：2026-07-24
当前轮次：P2-R034
范围：10 个模块、50 个功能点
总体状态：实施中；未达到 signed release 验收条件

## 当前汇总

| 状态 | 数量 |
|---|---:|
| accepted | 30 |
| implemented_unsigned | 8 |
| in_progress | 10 |
| not_started | 0 |
| blocked_on_signing | 2 |
| 合计 | 50 |

## P2-R034：50 点机器状态台账与计数纠偏

### 本轮结果

- 新增 `macosPhase2Status.mjs`，按稳定功能 ID 保存全部 50 点当前状态；新增 `record-macos-phase-2-acceptance.mjs`，把 catalog、owner、required levels、test IDs、原产品映射、commit 和 worktree fingerprint 聚合为机器回执。
- catalog 校验现在强制要求状态台账恰好 50 条、ID 唯一并与功能清单完全一致；新增状态或改功能 ID 时无法静默漏记。
- 修正 R031 以来人工总数漂移：MOD-09/10 的一个 `in_progress` 曾被计为 `not_started`，F10.3 从 `not_started` 推进后也未同步总计。逐功能重算结果为 30/8/10/0/2。
- unsigned 与 signed CI 都在最终发布判定前生成 P2 acceptance 回执；发布判定器不再长期因“缺少 P2 聚合文件”而得到模糊结论。

| 范围 | 当前状态 | 说明 |
| --- | --- | --- |
| P2 50 点清单 | accepted 30 / implemented_unsigned 8 / in_progress 10 / not_started 0 / blocked 2 | 机器重算、总和 50 |
| P2-MOD-09 | accepted 2 / implemented_unsigned 1 / in_progress 1 / blocked 1 | unsigned 构建、Helper、隔离已形成真实包证据 |
| P2-MOD-10 | accepted 1 / in_progress 3 / blocked 1 | PR 门禁通过；unsigned/Nightly/聚合待 clean/signed evidence |

### 下一轮

1. 在不伪造 clean revision 的前提下继续加强 P2 acceptance 的证据绑定与状态迁移规则。
2. 用户授权提交后生成 clean L4/L5 聚合，并重新计算 F01.1/F06.3/F06.5/F08.5/F09.1/F10.2/F10.3。
3. 完整 Xcode 与 Developer ID/公证凭据到位后完成剩余 XCTest、稳定身份和 signed L6。

## P2-R033：真实隔离 unsigned 构建与 fuse 后签名闭环

### 本轮结果

- 真实构建发现并修复静态契约遗漏：`identity: null` 或 `CSC_IDENTITY_AUTO_DISCOVERY=false` 会让 electron-builder 26 跳过签名阶段及 `afterSign`，fuse 修改后的 App 因此无法通过严格验证；`identity: "-"` 又会被当作 Keychain 身份名称，同样不可用。
- unsigned 流程改为两段式：electron-builder 明确不发现身份并完成打包/fuse，随后 `seal-unsigned-development.mjs` 对最终 App 执行 ad-hoc deep sealing、`codesign --deep --strict`、身份反校验、开发 Bundle ID 校验及 0600 回执写入。
- 真实产物 `CFBundleIdentifier=com.hepai.opendrsai.macos.development`；`codesign --verify --deep --strict` 通过；未出现 Developer ID Authority/TeamIdentifier。
- 固定资源路径中的 Native Helper 与协议 dylib 均为 arm64，真实握手通过；Helper SHA-256 为 `97f7a0ac…fce15176`，协议库 SHA-256 为 `df65b6a7…a2d2e68`。
- 隔离后的真实 App 完成 renderer/preload/IPC、4 GiB Runtime、并发 Gateway single-flight、zsh PTY 与退出零残留 smoke。

| 功能 | 旧状态 | 新状态 | 证据/剩余门禁 |
| --- | --- | --- | --- |
| P2-F09.1 无签名 Debug/dir 构建 | in_progress | in_progress | 隔离 Bundle ID、fuse 后严格 ad-hoc sealing 与核心 smoke 通过；clean-source L4 聚合待补 |
| P2-F09.2 Helper 打包与架构检查 | implemented_unsigned | accepted | 固定资源路径、arm64、可执行权限、hash、真实协议握手、严格 App sealing 全部通过 |
| P2-F09.3 开发/RC 配置隔离 | accepted | accepted | 真实构建确认开发 Bundle ID 与编译期独立 userData 标记 |
| P2-F10.2 unsigned packaged 门禁 | in_progress | in_progress | 新隔离包核心 smoke 通过；clean revision 的正式 L4 聚合待补 |

本轮汇总为 **30 accepted、8 implemented_unsigned、10 in_progress、0 not_started、2 blocked_on_signing**。R031 起 MOD-09/10 的人工总计曾把一个已进入 `in_progress` 的功能计为 `not_started`，并遗漏 F10.3 的状态迁移；P2-R034 以逐功能机器清单纠正，不代表本轮凭空提升验收等级。

### 自动化结果

- `npm run build:mac:dir:unsigned --workspace opendrsai-macos-desktop`：通过。
- `codesign --verify --deep --strict --verbose=4 OpenDrSai.app`：通过。
- `npm run verify:native-helper-package --workspace opendrsai-macos-desktop`：通过。
- `npm run verify:packaged --workspace opendrsai-macos-desktop`：通过，残留进程 0。

### 下一轮

1. 运行并维护 50 点逐功能机器状态台账；当前已无 `not_started`。
2. clean revision 授权后生成 source snapshot，聚合当前隔离包 L4/L5。
3. 完整 Xcode、Developer ID 与公证凭据到位后执行 XCTest 和 signed L6。

## P2-R032：开发/RC 隔离、签名预检与发布判定

### 本轮结果

- unsigned dir 包改用 `com.hepai.opendrsai.macos.development`，编译期固化 `development` channel，并把数据目录隔离到 `OpenDrSai Development`；同时禁用公证与发布源，避免污染正式 Bundle ID、TCC、Keychain、用户数据和更新状态。
- 新增只读 release preflight：枚举 Developer ID Application 身份、检查 App Store Connect API 凭据，并输出 inside-out 签名图。本机实测为 `blocked-on-signing`：Developer ID 0 个、公证凭据 false。
- 新增 fail-closed 发布判定器：clean source、L4/L5/L6、P2 50 点、原产品 72 点、P0/P1 和 evidence hash/commit 任一不满足，均不得输出 `releasable`。`--require-releasable` 负向测试以退出码 2 正确拒绝。
- unsigned CI 使用隔离构建入口并生成发布判定；signed RC 在构建前执行凭据预检，在 L6 后必须通过 `--require-releasable` 才允许进入 publish job。

| 功能 | 旧状态 | 新状态 | 证据/剩余门禁 |
| --- | --- | --- | --- |
| P2-F09.3 开发/RC 配置隔离 | not_started | accepted | 独立 appId、编译期 channel、独立 userData、无 notarize/publish；release readiness 契约与 production build 通过 |
| P2-F09.4 签名图谱与脚本预检 | not_started | implemented_unsigned | inside-out 图与真实 Keychain identity/凭据预检通过；Developer ID 实签 L5 待补 |
| P2-F10.1 PR 静态与单元门禁 | implemented_unsigned | accepted | catalog/architecture/security/contract/UX/coverage/defect/release-contract 已进入 PR job |
| P2-F10.5 证据聚合与发布判定 | not_started | in_progress | commit/source/evidence/acceptance/defect 强绑定和负向拒绝已实现；完整 signed L6 聚合待补 |

本轮汇总为 **29 accepted、9 implemented_unsigned、8 in_progress、2 not_started、2 blocked_on_signing**。发布判定器当前明确输出 `blocked-on-signing`，不会把本机 unsigned 结果误报为正式可发布。

### 自动化结果

- `npm run typecheck --workspace opendrsai-macos-desktop`：通过。
- `npm run verify:release-contract --workspace opendrsai-macos-desktop`：通过；包含开发隔离、签名预检/判定与 Runtime relocation。
- `npm run build --workspace opendrsai-macos-desktop`：通过。
- `npm run preflight:release --workspace opendrsai-macos-desktop`：通过，结论 `blocked-on-signing`。
- `npm run decide:release --workspace opendrsai-macos-desktop -- --require-releasable`：按设计拒绝，退出码 2。

### 下一轮

1. 审计并推进最后 2 个 `not_started`，建立机器可校验的逐功能状态台账。
2. 获得 clean revision 授权后聚合 unsigned L4/L5，令判定器输出 `unsigned-validated`。
3. 完整 Xcode 补 F03.5 XCTest；Developer ID 与公证凭据补 F09.4/F09.5/F10.4/F10.5 signed L6。

## P2-R031：MOD-08 macOS 体验、IME 与系统外观

### 本轮交付

- 修复中文/日文等 IME composition 的 Enter 误触发：聊天输入、会话搜索和命令面板在 `isComposing=true` 或 Chromium 兼容 `keyCode=229` 时不发送、不选择结果、不执行命令；普通 Enter 发送、Shift+Enter 换行保持不变。
- 修复多显示器变化时的系统窗口状态破坏：窗口处于 macOS full screen、simple full screen 或 maximized 时不再被 display recovery 强制 `setBounds`；普通离屏窗口仍按当前 display work area 有界收回。
- 补齐 macOS 字体栈，优先 `-apple-system`/`BlinkMacSystemFont`/SF Pro，再回退 Open Sans；保留 hiddenInset、traffic lights、titlebar drag/no-drag 和原生 App/File/Edit/View/Window/Services 菜单语义。
- 将 Reduce Motion 从少数语音/旋转组件扩展到全产品 surface：动画和 transition 降至单次 1 ms，禁用 smooth scroll；避免遗漏新增组件。
- 新增 Increase Contrast 与 forced-colors 响应：移除弱阴影依赖、增强边界和 3 px focus-visible，高对比选中/当前/按下状态继续可辨。
- 新增 `verify:macos-ux`，统一执行窗口/菜单/显示、IME、主题/motion/contrast 静态行为契约与真实 Electron Renderer L3；unsigned PR CI 已接入且不重复运行 L3。

### 功能进度变化

| 功能 | 上轮 | 本轮 | 证据 |
|---|---|---|---|
| P2-F08.1 窗口与菜单行为 | not_started | accepted | hiddenInset/traffic lights、drag/no-drag、原生 menu roles/Cmd+,、full/maximized 保持、多 display bounds、真实 Electron L3 |
| P2-F08.2 键盘与输入法 | not_started | accepted | IME composing/229 正反向单测，聊天/搜索/命令三入口接入，普通 Enter/Shift+Enter 与键盘-only L3 |
| P2-F08.3 VoiceOver 和键盘导航 | implemented_unsigned | accepted | 真实 Electron 键盘遍历、ARIA/focus、capability fail-closed、axe WCAG 2A/AA serious/critical=0 |
| P2-F08.4 外观与系统偏好 | not_started | accepted | system dark change listener、colorScheme、macOS 字体、全局 Reduce Motion、Increase Contrast、forced colors 与 focus-visible 契约 |
| P2-F08.5 性能预算 | in_progress | in_progress | 冷/warm/CPU/RSS、2 小时 soak、真实睡眠恢复均通过；仍待 clean-source L4 聚合 |

P2-MOD-08 当前 **4 accepted + 1 in_progress**。本轮汇总为 **27 accepted、9 implemented_unsigned、7 in_progress、5 not_started、2 blocked_on_signing**。

### 自动化结果

- IME policy：普通 Enter=true；Shift+Enter、composition、keyCode 229、Process key 均不提交。
- macOS UX contract：窗口/菜单/display、IME、theme、motion、contrast、focus 全部通过。
- TypeScript、production main/preload/renderer build：通过。
- 真实登录会话 Renderer L3：keyboard-only、capability fail-closed、responsive overflow、axe serious/critical=0 全部通过并重写 L3 回执。
- P2 catalog：10 modules、50 features，F08 映射通过。

### 下一轮

1. 审计并推进剩余 5 个可实施 `not_started`，重点是 MOD-09/10 的发布准备与证据判定，而非等待签名。
2. 获得 clean revision 授权后聚合 F06.3/F06.5/F08.5/F09.1/F10.2/F10.3 的 unsigned L4/L5。
3. 完整 Xcode 与 Developer ID 环境下完成 XCTest、原生通知身份和 signed L6。

## P2-R030：MOD-07 安全边界闭环与生产导航修复

### 本轮交付

- 新增正式 macOS Desktop 威胁模型，覆盖资产、六类信任边界、XSS→IPC、开发 URL/导航、Helper 协议注入、路径/符号链接、secret、审批重放、子进程和工件替换八类威胁，以及控制、失败策略、自动化证据和 signed 边界。
- 为 `sandbox: false` 记录明确剩余风险、即时复评触发条件和 2026-10-01 强制复评日期；ADR 链接到威胁模型，不再只有无期限文字豁免。
- 修复生产导航边界：packaged App 现在无条件忽略 `ELECTRON_RENDERER_URL`，开发 renderer 仅允许 localhost/127.0.0.1/IPv6 loopback 的同源 URL；远程配置源、端口替换和 malformed URL 均拒绝。
- 增加 `will-navigate` 策略：生产仅允许当前 packaged `index.html`（可含 query/hash），开发仅允许已批准 loopback origin；popup 继续永远 deny，合法 HTTPS 只通过显式外部打开路径交给系统。
- 新增统一 `verify:security-p2`：威胁模型、renderer navigation、secure IPC、路径/audit、secret redaction、Helper allowlist、文件变更与符号链接边界形成单一机器门禁。
- P2 catalog 的 F07.1～F07.5 全部映射 `p2:security`，unsigned PR CI 已强制运行该门禁。

### 功能进度变化

| 功能 | 上轮 | 本轮 | 证据 |
|---|---|---|---|
| P2-F07.1 IPC 注册器统一策略 | not_started | accepted | 270/270 inventory、可信 sender/frame、schema、timeout/AbortSignal、去重策略、脱敏 audit 与 owner 负向回归 |
| P2-F07.2 Helper allowlist | not_started | accepted | protocolVersion、operation/逐操作参数、未知字段/操作、超限与 shell 注入拒绝；Swift/TS 静态和真实 fixture |
| P2-F07.3 开发 URL 和导航防护 | not_started | accepted | packaged 环境变量拒绝、loopback 同源 dev allowlist、popup deny、will-navigate 正反向测试、production build |
| P2-F07.4 路径和文件授权 | not_started | accepted | canonical roots、目录类型、workspace 外拒绝、乐观写入、save-as 隔离、Runtime symlink lexical+realpath 边界 |
| P2-F07.5 威胁模型和安全回归 | not_started | accepted | 8 类威胁、信任边界、控制/剩余风险、sandbox 复评日期、统一门禁与 PR CI |

P2-MOD-07 当前 **5/5 accepted**。本轮汇总提升为 **23 accepted、10 implemented_unsigned、7 in_progress、8 not_started、2 blocked_on_signing**。

### 自动化结果

- TypeScript 与 Electron production build：通过；main/preload/renderer 产物完整。
- `verify:security-p2`：通过；8-threat model、导航、IPC、路径、审计、secret、Helper allowlist、文件变更全部通过。
- P2 catalog：10 modules、50 features、F07 统一门禁映射通过。
- Main composition：index 347 行、16 个 registrar 预算内、IPC 270。
- 完整 `verify:contract`：通过。
- Release contract 与 Runtime venv relocation：通过。

### 下一轮

1. 推进不依赖签名的 P2-MOD-08 窗口/菜单、输入法、无障碍与系统外观专项验收。
2. 获得 clean revision 授权后聚合 unsigned L4/L5。
3. 完整 Xcode 与 Developer ID 环境下完成 XCTest 和 signed L6。

## P2-R029：Runtime 重定位可执行回归与权限收紧

### 本轮交付

- 将 Runtime venv 重定位逻辑从 Electron 安装器抽成无 Electron 依赖的纯 Node 模块，产品安装路径与验收测试共享同一实现，避免静态字符串门禁与实际行为漂移。
- 新增可执行回归，真实创建事务安装目录和 `venv`/`browser-venv` 两套元数据，执行第一次重定位、原子 rename、最终路径二次重定位，并验证旧事务路径完全消失。
- 校验改为完整字节匹配，不接受多余字段或追加的攻击者路径；非目标 `pyvenv.cfg` 失败关闭，普通 Runtime 文件保持不变。
- 回归发现已存在文件不会因 `writeFile({mode: 0o600})` 自动收紧权限；产品实现新增显式 `chmod(0600)`，两套重定位元数据均验证为 owner-only。
- 新回归接入 `verify:release-contract`，以后发布契约会执行事务路径、最终路径、双 venv、权限及篡改拒绝测试，而不是只搜索源代码字符串。

### 功能进度变化

| 功能 | 上轮 | 本轮 | 证据 |
|---|---|---|---|
| P2-F06.4 睡眠/唤醒/锁屏恢复 | accepted | accepted | 真机回执保持有效；本轮补强其冷安装前置 Runtime 的可重定位和权限回归 |
| P2-F04.4 敏感数据最小暴露 | accepted | accepted | 安装元数据从 0644 收紧到 0600，追加/非目标路径篡改均失败关闭 |
| P2-F10.2 自动验收流水线 | in_progress | in_progress | 新增可执行发布门禁；仍需 clean revision 聚合 L4/L5 |

本轮不改变状态数量：**18 accepted、10 implemented_unsigned、7 in_progress、13 not_started、2 blocked_on_signing**。

### 自动化结果

- TypeScript：通过。
- Runtime venv relocation：通过；覆盖 transaction、activation、dual venv、0600 permissions、unrelated-file preservation、tamper refusal。
- macOS Runtime contract：通过。
- macOS release contract：通过，且已串联上述可执行回归。

### 下一轮

1. 获得用户授权后整理当前 dirty worktree，或在 clean CI revision 上生成 source snapshot 并聚合 unsigned L4/L5。
2. 在完整 Xcode/xctest 环境完成 Native Helper XCTest。
3. 配置 Developer ID 后完成 signed L6。

## P2-R028：真机睡眠验收与 Runtime 可重定位修复

### 本轮交付

- 在用户明确授权后，以 sealed unsigned arm64 App 完成真实 `lock-screen → suspend → resume → unlock-screen` 设备验收；不是 timer、mock 或 display-change 模拟。
- 真机回执记录睡眠前后 Gateway 均健康且保持同一受管 PID；恢复后等待 2 秒再次查询健康状态，App 退出后观测进程树残留为 0。
- 修复 `sleep-wake` 冷启动验收遗漏 Runtime 安装的问题：全新隔离 HOME 会先安装并二次校验 4 GiB 内置 Runtime，再启动 Gateway 和发出 ready 信号。
- 修复 Runtime 工件的真实可重定位缺陷：归档内 `venv/pyvenv.cfg` 与 `browser-venv/pyvenv.cfg` 含打包机绝对路径。安装器现在先验证原始清单，再按事务路径重写用于 Python 探针，并在原子激活后按最终路径再次封装；已安装完整性检查对这两个受控可变文件执行精确语义验证，其余 26,863 个清单项继续执行大小与 SHA-256 校验。
- 改进设备验收失败诊断：收集 stdout/stderr 与场景结果，失败时保留隔离 fixture，成功时仍自动清理；设备隔离目录使用短 `/private/tmp/odsw-*` 路径。

### 功能进度变化

| 功能 | 上轮 | 本轮 | 证据 |
|---|---|---|---|
| P2-F06.4 睡眠/唤醒/锁屏恢复 | in_progress | accepted | Apple Silicon 真机观察到 4/4 原生事件且顺序有效；Gateway PID 17487 睡眠前后健康；10 个受管/子进程被观测，退出残留 0 |
| P2-F06.5 残留与泄漏预算 | in_progress | in_progress | 本轮真机睡眠路径残留 0，既有 100 次启停与 2 小时资源预算仍通过；尚缺 clean-source 聚合 |
| P2-F08.5 性能预算 | in_progress | in_progress | 真机实际睡眠约 286 秒后 2 秒内完成 Gateway 健康复核；既有预算均通过，尚缺 clean-source 聚合 |
| P2-F10.3 Nightly 真机稳定性 | in_progress | in_progress | 真实睡眠链补齐；100 次重启、2 小时 soak、故障注入与零残留均有回执，尚缺 clean revision 上的正式聚合 |

本轮将 F06.4 提升为 accepted，因此汇总为 **18 accepted、10 implemented_unsigned、7 in_progress、13 not_started、2 blocked_on_signing**。

### 自动化结果

- `sleep-wake-real-device.json`：`ok=true`、4/4 原生事件、`eventOrderValid=true`、`allExpectedEventsObserved=true`、Gateway before/after ready、observed process 10、residual 0。
- Runtime 安装器 TypeScript、Runtime contract、release contract：通过；契约新增虚拟环境双阶段重定位和安装后语义校验门禁。
- 全量 `verify:contract`：通过，覆盖 secure IPC、auth/approval/thread/chat/agent、checkpoint/worktree、macOS lifecycle/recovery/process/credentials/permissions、Runtime 与文件变更。
- 修复后重新构建 sealed unsigned arm64 App：Electron production bundle、Native Helper、build metadata 与严格 `codesign --verify --deep --strict` 通过。
- 修复后真实登录会话 packaged smoke：4 GiB Runtime 冷安装、renderer/preload/IPC、并发 Gateway start、zsh PTY 与零 orphan process 全部通过。

### 下一轮

1. 获得用户授权后整理当前 dirty worktree 或在 clean CI revision 上生成 source snapshot，正式聚合 unsigned L4/L5 回执。
2. 安装完整 Xcode/xctest 后补 Swift Package XCTest 正式回执。
3. 配置 Developer ID 后完成签名、公证、Gatekeeper、更新/回滚与 signed L6；在此之前不提升签名相关功能。

## P2-R027：真实锁屏生命周期与设备验收编排

### 本轮交付

- 补齐 Electron 主进程的原生会话事件：除既有 `suspend/resume` 外，正式监听 `lock-screen/unlock-screen`；锁屏记录 Gateway 中断前状态，解锁沿用有界、合并且关机抑制的恢复协调器，并触发幂等 scheduled-task 扫描。
- `InterruptionReason` 增加 `unlock`，生命周期事件与审计日志能够区分“机器唤醒”和“用户解锁”，不再用普通 timer 或 display-change 冒充会话恢复。
- 修复中断状态采集竞态：`lock/suspend/network-offline` 的 Gateway 状态查询纳入协调器，在 `unlock/resume/network-online` 恢复前等待全部在途采集；极快的事件切换不会漏恢复原本健康的 Gateway，采集失败仍保持失败关闭且不阻塞后续恢复。
- 修复睡眠期间网络轮询暂停造成的端口转发假活：`lock/suspend` 现在显式 suspend 全部受管 tunnel，`unlock/resume` 显式走幂等 resume；不再依赖 5 秒网络轮询碰巧观察到 offline 边沿。
- 新增 packaged `sleep-wake` 真机场景：在主进程直接监听四类 `powerMonitor` 事件，启动真实 Gateway 后才写 ready 信号；只有观察到 `lock → unlock` 与 `suspend → resume` 的有效顺序、恢复后 Gateway 健康，才写通过结果。
- 新增 `verify:sleep-wake:device` 设备入口和 `sleep-wake-real-device.json` 回执。入口本身不会让机器休眠；需用户在 ready 后执行真实睡眠、唤醒与解锁，超时或少任一事件均失败。

### 功能进度变化

| 功能 | 上轮 | 本轮 | 证据 |
|---|---|---|---|
| P2-F06.4 睡眠/唤醒/锁屏恢复 | in_progress | in_progress | lock/unlock 产品实现、恢复协调器单测和真机 packaged 编排已完成；尚待用户配合执行真实硬件回执 |
| P2-F08.5 性能预算 | in_progress | in_progress | 正式 2 小时 packaged soak 通过：交互 808 ms、5 次 warm p95 938 ms、空闲 CPU 平均/p95 0.54%/1.5%、max RSS 941552 KiB，全部在预算内；仍缺 R027 睡眠/唤醒性能回执与 clean 聚合 |
| P2-F10.3 Nightly 真机稳定性 | in_progress | in_progress | 100 次重启、故障恢复、7200003 ms/240 heartbeat soak、3704 个资源样本、fault injection 与零残留通过；真实睡眠/唤醒入口待人工设备动作 |

本轮状态数量不变。真机入口、产品监听和单元契约只能证明“可验收”，不能替代真实睡眠/锁屏证据。

### 自动化结果

- TypeScript：通过。
- macOS recovery coordinator：通过；新增 unlock 使用同一有界 Gateway 恢复路径，立即 unlock 与延迟状态采集竞态通过，shutdown 继续抑制恢复。
- P2 main composition：通过；`index.ts=350` 行，IPC `270`，新增 lock/unlock 监听纳入静态组合契约。
- Port Forward：验证、启动、端口冲突重分配、重连、持久化、审计与 shutdown 回归通过。
- `verify-sleep-wake-real-device.mjs`：Node 语法检查通过；尚未启动设备动作，因此没有伪造通过回执。
- 完整 packaged L5：通过；100 次 restart、App/Helper/Gateway 强杀恢复、`7200003 ms` stability、240 heartbeat、fault injection 全链成功。
- `packaged-resource-sampling.json`：3704 samples、max process 9、max RSS 941552 KiB、max fd 373、residual 0；首/尾 10 次 restart RSS 均值 547515/545059 KiB、斜率 -39.275 KiB/次，fd 292/289、斜率 -0.001/次，正式 100 次增长预算通过。
- `packaged-performance-budget.json`：cold interactive 808 ms（预算 45 s）、5 次 warm p95 938 ms（预算 10 s）、idle CPU 平均 0.54%/p95 1.5%（预算 15%/40%）、idle max RSS 941552 KiB（预算 1258291 KiB），`withinBudget=true`。
- 验收驱动退出后独立进程表复核：OpenDrSai、Native Helper、Gateway、L5 driver 残留均为 0。
- R027 unsigned arm64 dir 包重建通过；Swift Helper 为 Mach-O arm64，Electron production bundle 与 dirty build metadata 正常，严格 `codesign --verify --deep --strict` 满足 designated requirement。
- 修复 `verify-packaged-smoke.mjs` 的退出竞态：旧实现会在 `exit` listener resolve 后、Node 更新 `child.exitCode` 前误发 SIGKILL；现在等待进程和 stdio 的 `close`，且仅由真实 timeout 路径强杀，signal exit 明确失败。
- R027 sealed App 在真实登录会话 packaged smoke 通过：4 GiB Runtime、renderer/preload/IPC、Gateway concurrent single-flight、zsh PTY 与零 orphan process；sandbox 内 Electron SIGABRT 被准确识别为环境限制，没有降级断言。
- R027 完整契约与覆盖率回归通过：67/67 feature suites，IPC preload/Windows/macOS `270/270/270`、missing 0；共享业务行覆盖 93.74%、核心状态机分支 92.34%、adapter 行覆盖 59.37%，均超过门槛。
- R027 真实登录会话 Renderer L3 通过：键盘导航、capability fail-closed、响应式布局与 axe serious/critical=0；新增生命周期实现未改变 renderer 安全边界。

### 下一轮

1. 征得用户明确同意后，运行真实睡眠/唤醒/解锁验收。
2. 核验 `sleep-wake-real-device.json` 的原生事件顺序、Gateway 健康、进程树和零残留，并回写功能状态。
3. 获得 clean revision、完整 Xcode/xctest 与 Developer ID 后，分别完成 L4 聚合、Swift XCTest 和 signed L6。

## P2-R026：完整 unsigned packaged L5、恢复语义与资源采样

### 本轮交付

- 修复打包 Runtime 位置：macOS 不再把首次安装目标指向只读且已密封的 `.app/Contents/Resources`，而是安装到隔离 `DRSAI_HOME/drsai-agent`；显式 `DRSAI_REPO` 仍优先，Windows packaged 路径契约保持不变。
- Runtime 安装的 tar 解压预算按归档大小扩展到 120～600 秒，并把“解压”和“清单验证”拆成可观察阶段；L5 core 冷安装预算按 4 GiB 工件扩展到 900 秒。
- 修复 Chat 终态日志与网络恢复：runId 在执行前固定，abort/error 终态携带 sessionId/runId；packaged fixture 同时安全覆盖 legacy `/v1/chat/completions` 与 Runtime execute，两端均要求双环境门禁、offline auth、固定用户、固定 request ID 和精确 attempt/cursor。
- 修复 Approval Center 跨进程幂等：可变审批提案 IPC 禁用 30 秒完成响应缓存，持久审批 store 继续拥有幂等语义；Git executor 接收审批 ID 并写入 `OpenDrSai-Approval:` commit trailer，重放不产生第二个提交。
- 修复检查点部分恢复的 macOS 路径语义：绝对/相对路径统一经过真实工作区边界和 canonical path 解析，兼容 `/var` 与 `/private/var`，越界仍失败关闭。
- 修复 Runtime worktree 信任边界：不扩大通用 allowed roots；队列审批、生命周期审批和实际 dispatch 均验证 source/worktree/workspace 三个 Runtime ID、active 状态和 canonical path，防止伪造 Thread 或审批后路径替换。
- packaged L5 增加 `/bin/ps` 与 `/usr/sbin/lsof` 采样：每 2 秒汇总 App 进程树 RSS/fd/进程数，记录全部观察 PID，并在正常退出和 SIGKILL 后执行 5 秒有界零残留断言。
- 新增仅在 packaged acceptance 环境启用的主进程故障编排：不向 renderer 暴露 kill 权限，主进程直接 SIGKILL 自己注册的 Native Helper 与 Gateway；两者必须可观察到 crash、以不同 PID 有界恢复、重新通过 ping/health，并在退出后零残留。

### 功能进度变化

| 功能 | 上轮 | 本轮 | 证据 |
|---|---|---|---|
| P2-F06.3 崩溃与强杀恢复 | in_progress | in_progress | renderer crash 契约、Native Helper/Gateway 真实 SIGKILL 新 PID 恢复、App SIGKILL 后审批/Thread/偏好恢复和零重复 Git 副作用均通过；尚缺 clean-source L4/L5 聚合 |
| P2-F06.5 残留与泄漏预算 | in_progress | in_progress | 最终包 100 次真实启停通过；首/尾 10 次 RSS 均值 550315/550840 KiB、斜率 -91.906 KiB/次，fd 292/293、斜率 -0.017/次，退出残留 0；尚缺 clean-source L4 聚合 |
| P2-F08.5 性能预算 | in_progress | in_progress | 100 次 RSS/fd 增长预算通过；冷启动/可交互、空闲 CPU 和 2 小时 soak 尚未形成完整性能预算证据 |
| P2-F10.2 macOS unsigned packaged 门禁 | in_progress | in_progress | 完整最小 L5 已通过 core/product/restart/crash/recovery/stability/fault；clean-source L4/L5 聚合证据尚缺 |
| P2-F10.3 Nightly 真机稳定性 | not_started | in_progress | 100 次重启、SIGKILL/recovery、60 秒 soak、fault injection 和零残留通过；2 小时与睡眠唤醒尚缺 |

状态数量不变：F10.3 从实现角度进入 `in_progress`，但本表总量此前已经把对应 Nightly/稳定性工作计入进行中范围；没有因为一次最小循环提前提升 `accepted`。

### 自动化结果

- TypeScript、secure IPC、Git approval、workspace checkpoint、fork queue/conflict、main composition 与 release contract：全部通过；组合根保持 350 行，macOS IPC inventory 约束未放宽。
- 完整共享回归在真实登录会话通过：67/67 feature suites，IPC 270/270/270、共享业务行覆盖 93.74%、核心状态机分支 92.34%、adapter 行覆盖 59.37%；Renderer L3 键盘/capability/响应式/axe serious/critical=0 通过，Native Helper 真 Keychain 与可复现 arm64 构建通过。
- unsigned arm64 dir 包：Native Helper、Electron production bundle、fuse 后严格 ad-hoc sealing 与 `codesign --verify --deep --strict` 通过。
- 完整最小 packaged L5：通过；core + 17 条 product-state journey + 1 次 restart + 1 次 SIGKILL/recovery + 60002 ms stability + fault injection。
- `managed-process-crash-recovery.json`：passed；Native Helper/Gateway 各 1 次真实强杀、均恢复、residualProcessCount=0。
- `packaged-resource-sampling.json`：passed；最终包 100 次 restart 均在场景完成时采到完整 Electron 进程树，sampleCount=295、maxProcessCount=9、maxRssKiB=939792、maxFdCount=378、residualProcessCount=0；首尾 RSS 增长 525 KiB、fd 增长 1，`formalHundredRestartBudgetSatisfied=true`。
- 最新 Runtime 工件使用官方 arm64 Python 3.11.9 从清空 staging 的两次完整构建得到完全相同 SHA-256：`ac938e5eb52afc9e9beb392c511489a6208d13701f3f65a0e14193c22533dfb5`；`runtime-reproducibility.json` 已绑定 first/second/manifest hash。

### 下一轮

1. 执行 2 小时 soak，并补睡眠/唤醒/锁屏真机证据；睡眠动作必须由设备级验收编排，不能用普通 timer 冒充。
2. 补齐冷启动/可交互与空闲 CPU 基线，完成 F08.5 的完整性能预算收据。
3. 获得用户提交授权或干净 CI revision 后再聚合 L4/L5，Developer ID 可用后执行最终 L6。

## P2-R025：packaged L5 工作区信任与冷安装预算校准

### 本轮交付

- 修复 L5 core 的工作区信任幂等缺口：同路径记录已存在但仍为 untrusted 时，场景现在通过正式 IPC 显式更新为 trusted，并在返回前再次断言；product-state 的失败信息同时报告 found/trusted 实际状态。
- L5 每个场景结果写入 `packaged-l5-last-scenario.json`，所有 `ok` 断言携带 renderer 侧错误，避免产品旅程只返回无上下文的布尔失败。
- L5 core 改为读取打包 Runtime manifest/归档大小计算冷安装预算；本机 4 GiB Runtime 在 225 秒预算下仍出现磁盘吞吐波动，因此 L5 专用上限校准为 360 秒。17 条 product-state 旅程另设 300 秒预算，不再与 Runtime 冷安装共用固定 120 秒。
- 一次重建后的真实 L5 已成功写出新的 `packaged-core-journeys.json`，证明 Runtime、Gateway、PTY、工作区信任和退出零残留通过；随后 product-state 触发旧 120 秒预算。后续两次全新隔离冷安装在 225 秒达到旧预算，未生成伪通过 L5 聚合回执，且超时后未发现 OpenDrSai/Gateway/Helper 遗留进程。

### 功能进度变化

| 功能 | 上轮 | 本轮 | 证据 |
|---|---|---|---|
| P2-F06.3 崩溃与强杀恢复 | in_progress | in_progress | L5 App 强杀/恢复场景已存在；完整链尚未越过冷安装与产品旅程预算门禁 |
| P2-F06.5 残留与泄漏预算 | in_progress | in_progress | core 真实退出零 Gateway/PTY 残留；100 次 RSS/fd 循环尚未执行 |
| P2-F10.2 macOS unsigned packaged 门禁 | in_progress | in_progress | core L5 子回执通过；product/restart/crash/stability/fault 尚未形成完整通过回执 |

本轮没有状态数量变化。无 Developer ID 的 ad-hoc 目录包只作为开发证据；L5、签名发布和 TCC 身份验收继续分层记录。

### 自动化结果

- arm64 dir 包重建：TypeScript、Electron production bundle、Native Helper 和 electron-builder 通过；构建元数据正确标记 dirty，未发现 Developer ID identity。
- release contract：通过；L5 driver JavaScript syntax check：通过。
- packaged L5：部分通过。core 子回执已更新并通过；完整命令未通过，最新阻塞为 4 GiB Runtime 在旧 225 秒预算下冷安装超时，stderr 为空，超时清理后无相关残留进程。

### 下一轮

1. 使用校准后的 360 秒冷安装预算跑通最小 L5，确认 17 条 product-state、1 次 restart、App SIGKILL/recovery、60 秒 stability 与 fault injection 全链。
2. 为 packaged 循环增加 App/关键子进程 RSS、fd 与退出残留采样；先用小迭代验证收据，再执行方案要求的 100 次正式循环。
3. 设计不暴露 renderer 测试特权的 main-side Helper/Gateway 强杀编排，并补 packaged recovery 回执；clean revision 后再生成 L4/L5 聚合证据。

## P2-R024：packaged 核心 smoke、Runtime 可复现性与完整回归

### 本轮交付

- 修复 packaged Gateway 验收与产品持久模式的冲突：smoke 显式设置 `OPENDRSAI_RUNTIME_PERSIST=0`，避免测试进程跨 App 生命周期遗留；核验并终止了由上一轮 smoke 产生、PPID=1 且占用 18642 的确切 Gateway PID。产品默认持久策略未被测试配置改变。
- 修复 packaged renderer 场景只序列化 `rendererScenario`、遗漏 `terminalRoundtrip` helper 的问题；helper 现在与场景一起注入隔离 renderer 脚本。
- 新增签名前 native 权限归一化 `afterPack` hook，将 `node-pty` arm64 `spawn-helper` 从 npm 工件的 0644 修正为 0755；`afterSign` 仍只负责 unsigned ad-hoc sealing。由此避免正式 Developer ID 签名后 chmod 导致签名失效。
- packaged smoke 的成功路径会清除有界 timeout，命令不再在所有断言通过后继续驻留；失败路径同时持久化 renderer scenario result 与 stderr。
- Runtime 可复现性验证改为流式 SHA-256，避免将约 4 GiB 归档整体读入内存；两次清空 staging 的完整构建得到完全相同 SHA-256：`2d7132d79b79db857ddd24d393a184fe144ccd4391b870e603d9430ee9e3eab7`。
- 更新 shell contract 对 packaged-safe asset path 的断言：preload/renderer 必须从 `app.getAppPath()/out/...` 解析，不再要求失效的 chunk 相对路径。

### 功能进度变化

| 功能 | 上轮 | 本轮 | 证据 |
|---|---|---|---|
| P2-F09.1 无签名 Debug/dir 构建 | in_progress | in_progress | dir 包严格 ad-hoc sealing，真实 Runtime/Gateway/PTY 核心 smoke 和零残留通过；clean-source L4 聚合回执尚缺 |
| P2-F10.2 macOS unsigned packaged 门禁 | in_progress | in_progress | renderer/preload/IPC、Runtime、Gateway single-flight、zsh PTY、退出零残留和有界超时均通过；Helper/性能与 clean-source L4 聚合尚缺 |

本轮仍不提前提升 accepted。功能行为证据已经通过，但开发方案要求的 L4 聚合器明确要求 `source-snapshot.clean=true`；当前实施位于未提交工作树，聚合器正确拒绝 dirty source。未获用户提交授权前不会伪造 clean evidence。

### 自动化结果

- packaged smoke：连续通过；renderer/preload/IPC、4 GiB Runtime 安装与健康检查、两次并发 Gateway single-flight、zsh PTY resize/write/read、App 退出后 Gateway/PTY 零残留。
- `codesign --verify --deep --strict`：通过；`node-pty` arm64 spawn helper 为 0755，权限修正发生在签名前。
- Runtime reproducibility：两次完整构建字节一致，first/second SHA-256 均为 `2d7132d79b79db857ddd24d393a184fe144ccd4391b870e603d9430ee9e3eab7`。
- Feature suites：67/67；新增 Runtime filesystem policy 通过，IPC inventory 270/270，coverage 100%、missing=0，release/build metadata 无回归。
- L4 子回执 `packaged-smoke.json` 与 `runtime-reproducibility.json` 均 passed；`macos-l4-evidence.json` 未生成，因为当前 source snapshot 为 dirty。

### 下一轮

1. 执行 packaged fault/recovery 场景：路径越界、unsafe URL、未注册 Workspace、Gateway/Helper 强杀与 App 重启，推进 F06.3。
2. 增加 packaged 循环的 RSS/fd/子进程残留预算，推进 F06.5；真实睡眠/锁屏仍单独保留为 F06.4 设备证据。
3. 在用户授权提交或干净 CI revision 后重新生成 source snapshot 并聚合 L4 evidence，再决定 F09.1/F10.2 是否提升 accepted。

## P2-R023：unsigned development sealing 与 packaged Runtime 首次安装

### 本轮交付

- 将 unsigned 目录包的 ad-hoc sealing 移到 Electron fuse 之后；仅在 `CSC_IDENTITY_AUTO_DISCOVERY=false` 时启用开发 entitlement，保留正式发布的 library validation。当前 App 通过 `codesign --verify --deep --strict`，且验收回执明确标记 `identity=adhoc`、`releaseIdentity=false`。
- 增加独立 bootstrap entry，捕获 packaged main import/startup 异常；修复 `electron-updater` ESM/CJS 装载、chunk 后 preload/renderer 路径、renderer load 竞态、验收专用 mock Keychain/userData 隔离，以及销毁 WebContents 后的 voice cleanup。
- 使用官方 Python 3.11.9 arm64 工具链生成哈希锁定 Runtime；修复 macOS lock 中的 Windows-only `pywin32` 和缺失 `uvloop==0.22.1`。安装仍保持 `--require-hashes`，没有降级供应链校验。
- Runtime 内置可移植 `python-runtime`，两个 venv 仅使用根内相对链接；Framework 链接仅在 lexical/canonical target 均位于 Runtime 根内时允许，绝对、越界、悬空链接全部拒绝。
- 构建时删除 `__pycache__`/`.pyc`，Runtime probe、Gateway 与 Browser worker 设置 `PYTHONDONTWRITEBYTECODE=1`；文件清单改由 Node 只读生成，消除归档后启动 Python 导致的 `.pyc` 哈希漂移。
- packaged smoke 的固定 45 秒改为按 Runtime 归档大小计算、最高 360 秒的有界预算；所有成功/失败路径都会终止 App、清理临时目录，失败时保留 renderer scenario 与 stderr 诊断。
- 当前 Runtime 工件 SHA-256：`2d7132d79b79db857ddd24d393a184fe144ccd4391b870e603d9430ee9e3eab7`。真实目录包已经完成 renderer/preload/IPC、Runtime 解压、文件级 SHA-256、Python arm64/3.11.9/import probe 与安装后健康检查；当前阻塞已推进到 packaged Gateway 并发启动未 ready。

### 功能进度变化

| 功能 | 上轮 | 本轮 | 证据 |
|---|---|---|---|
| P2-F09.1 无签名 Debug/dir 构建 | not_started | in_progress | arm64 dir 包可构建、fuse 后 ad-hoc sealing 严格通过、真实 App 可启动并完成 Runtime 安装；Gateway 核心旅程尚未通过 |
| P2-F10.2 macOS unsigned packaged 门禁 | not_started | in_progress | renderer/preload/IPC、Runtime 安装与健康检查已通过；Gateway single-flight、PTY、退出残留尚未形成完整通过回执 |

P2-R023 没有把任何功能提前提升为 accepted。unsigned 包已从“系统拒绝启动”推进到“Runtime 安装健康，Gateway 启动待修”；F09.1/F10.2 只有完整核心旅程和零残留通过后才可验收。

### 自动化结果

- `p2:runtime-filesystem-policy`：Framework 根内相对链接通过；绝对、越界、悬空链接拒绝。
- TypeScript typecheck、production Electron build、Native Helper arm64 build、fuse 后严格 ad-hoc sealing：通过。
- packaged Runtime：哈希锁安装、SBOM/provenance、可移植 Python、逐文件清单、安装后 healthy：通过。
- packaged smoke：失败；精确结果为 `concurrent Gateway start did not converge to ready`。未生成伪通过 L4 回执。
- Runtime reproducibility、完整 67-suite 回归和当前 L4 evidence 尚未执行，不能沿用 R022 的 66/66 作为本轮结论。

### 下一轮

1. 为 packaged Gateway 保留受控 stderr/exit/health 诊断，修复可移植 Python 环境或启动参数问题，并验证两次并发 start single-flight。
2. Gateway ready 后继续 zsh PTY roundtrip、App 正常退出和 Gateway/PTY 零残留，完成 F09.1/F10.2 的 unsigned L4 回执。
3. 执行 Runtime 双构建可复现性、67-suite 全回归、L4 evidence 记录，再进入 F06.3～F06.5 故障注入与资源循环。

## P2-R022：统一子进程注册表与有序退出

### 本轮交付

- 新增 `ManagedProcessRegistry`，统一登记 Gateway、PTY、Browser worker、Native Helper、update watchdog；每条记录包含稳定 id、kind、owner、pid、state、时间、detached 与退出原因，快照不暴露 stop/forceStop 控制回调。
- 状态机覆盖 starting/running/stopping/exited/crashed/detached；拒绝非法 id/owner/pid、活动 id 冲突，以及关机 quiesce 后的新进程创建。
- Gateway、PTY、Browser worker、Native Helper 和 update watchdog 均在实际 spawn 点登记并在 exit/crash 路径结算；Helper 的一次有界自动恢复会生成新的进程记录。
- `MacosAppShutdownCoordinator` 从并行清理改为声明顺序执行，保持并发 quit 幂等与总超时边界；registry 在关键进程具名清理后执行兜底，按 Browser worker→PTY→Helper→Gateway 的依赖顺序停止。
- registry 对单进程设置优雅退出预算，超时或仍存活时执行 forceStop 并记录 SIGKILL；正常非 detached 退出要求 active snapshot 为 0。
- 系统 shutdown 和 `before-quit` 都先进入 quiesce；Browser、PTY、Helper、Gateway、watchdog 在 spawn 前再次检查 accepting，避免关机竞态产生孤儿进程。
- update watchdog 与显式持久 Gateway 以 detached 状态记录，作为跨 App 生命周期的有意交接，不计入普通非 detached 零残留；其真实升级/回滚和最终残留仍需 L4/L6 证据。
- 新增 `p2:process-lifecycle` suite，覆盖 owner/state、输入拒绝、重复登记、顺序停止、卡死强杀、detached 例外、quiesce 拒绝和非 detached 零残留。

### 功能进度变化

| 功能 | 上轮 | 本轮 | 证据 |
|---|---|---|---|
| P2-F06.1 统一子进程注册表 | not_started | accepted | 五类 spawn 接入、owner/state/exit reason、负向输入与重复登记、当前 L3、66/66 suites |
| P2-F06.2 有序 shutdown | not_started | accepted | 顺序 coordinator、具名 plan、quiesce、优雅退出→超时强杀、幂等 quit、当前 L3 |
| P2-F06.3 崩溃与强杀恢复 | not_started | in_progress | Helper SIGKILL 有界恢复、renderer/Gateway/App 恢复契约已通过；尚缺当前 unsigned packaged L4 故障注入回执 |
| P2-F06.4 睡眠/唤醒/锁屏恢复 | not_started | in_progress | suspend/resume、网络、port forward、scheduled task 恢复契约通过；尚缺真实睡眠/锁屏 packaged L4 回执 |
| P2-F06.5 残留与泄漏预算 | not_started | in_progress | registry 卡死强杀与非 detached active=0 通过；尚缺真实 App 退出残留扫描及 100 次 fd/内存循环 L4 回执 |

P2-MOD-06 当前 **2 accepted + 3 in_progress**。F06.3～F06.5 的实现基础和局部自动化已存在，但开发方案明确要求 packaged L4 故障、真实睡眠/锁屏及 100 次资源循环，当前证据不足，不能提升为 accepted。

### 自动化结果

- `p2:process-lifecycle`：owner/state、顺序、timeout force-stop、detached watchdog、quiesce 和零非 detached 残留全部通过。
- Native Helper：真实 handshake/Keychain、timeout/cancel/malformed、SIGKILL 恢复和可复现 arm64 build 通过；hash 仍为 `97f7a0acbf985592a3c03a923d50d62da047b764ba3add08b36ca423fce15176`。
- TypeScript、production build、Browser Task、PTY、Gateway/process lifecycle 和 bootstrap plan 专项通过。
- Feature suites：66/66；IPC inventory 270/270，architecture/release/build metadata 无回归。
- 当前 Electron L3：通过；键盘、capability、响应式与 axe serious/critical=0。

### 下一轮

1. 继续 P2-MOD-06，增加真实子进程循环与 `/proc` 等价的 macOS `ps/lsof` 残留、fd、RSS 预算回执，推进 F06.5。
2. 建立 packaged unsigned development sealing，修复 Electron fuse 后失效 ad-hoc signature，解除 F06.3～F06.5 所需 L4 smoke/fault-injection 前置阻塞。
3. 在可启动目录包上执行 Gateway/Helper 强杀、App 重启、睡眠/唤醒模拟，并将回执绑定当前 artifact hash。

## P2-R021：原生 TCC 状态、显式请求门禁与系统交接

### 本轮交付

- Swift Helper 新增 `permission.status/request/open-settings` 三个严格白名单操作和 `permissions.tcc.v1` capability；覆盖 microphone、notifications、files、automation、accessibility、screen-recording 六类统一结果，均返回 kind/state/canRequest/canOpenSettings/source。
- microphone 使用 AVFoundation，accessibility 使用 ApplicationServices，screen-recording 使用 CoreGraphics；Automation 仅执行固定 Finder AppleEvent。Helper 不接受任意目标、脚本、URL 或未知参数。
- 所有原生请求必须显式携带 `userInitiated="true"`；false/missing、未知权限、未知参数均 fail-closed。应用启动仅查询状态，不调用 request，避免批量 TCC 弹窗。
- System Settings 使用六个固定 `x-apple.systempreferences:` pane；原生打开失败时才由 Electron `shell.openExternal` 降级，不接受 renderer 提供的 URL。
- Electron 权限模型扩展至 accessibility 与 screen-recording，并标记 `source=native-helper`；Helper 缺失或协议不可用时保持既有 Electron/设置页降级。
- 实测确认命令行型 Helper 初始化 `UNUserNotificationCenter` 会因无 application Bundle proxy 崩溃，已移除该不安全路径并加入静态回归门禁。通知授权、投递、点击、聚焦和任务路由暂由 Electron 应用 Bundle 承担；真正原生通知闭环需有 Bundle 身份的 XPC/辅助 App，因此 F05.4 不提前验收。
- LaunchServices 的 URL scheme、Finder 文件、PDF 交接、second-instance、应用激活、非法输入与去重路径完成专项回归。

### 功能进度变化

| 功能 | 上轮 | 本轮 | 证据 |
|---|---|---|---|
| P2-F05.1 TCC 状态统一模型 | not_started | implemented_unsigned | 四类关键 TCC 原生查询、六类统一 schema/source、真实 Helper 状态回执；稳定签名身份 L5 待补 |
| P2-F05.2 显式权限请求 | not_started | implemented_unsigned | `userInitiated=true` 强门禁、false/missing/extra 负向 fixture、启动不请求；签名身份 L5 待补 |
| P2-F05.3 系统设置精确跳转 | not_started | implemented_unsigned | 固定 pane allowlist、非法 kind 拒绝、native→Electron 有界降级；真实签名 Bundle L5 待补 |
| P2-F05.4 原生通知闭环 | not_started | in_progress | Electron 通知授权/发送/点击/聚焦/任务路由回归通过；CLI Helper 的 UserNotifications 路径因 Bundle proxy 限制已安全撤回，原生闭环尚缺 |
| P2-F05.5 LaunchServices 与系统交接 | not_started | accepted | URL scheme/Finder/PDF/activate/second-instance 正反向测试、当前 Electron L3 与 65/65 suites |

P2-MOD-05 当前 **1 accepted + 3 implemented_unsigned + 1 in_progress**。前三项必须在稳定 Bundle ID、Developer ID 签名下补 TCC 授权持久性和升级保持证据；F05.4 必须先确定有 Bundle 身份的原生通知宿主，不能用命令行 Helper 冒充原生闭环。

### 自动化结果

- Native Helper：严格 TCC protocol fixture、真实无弹窗状态查询、未知 kind/parameter、用户手势拒绝、timeout/cancel/malformed、SIGKILL 恢复和真实随机 Keychain CRUD 全部通过。
- `test:native-helper`：通过；arm64 executable 连续构建字节一致，当前 hash `97f7a0acbf985592a3c03a923d50d62da047b764ba3add08b36ca423fce15176`。
- TypeScript typecheck、production build、系统权限、Completion Notification、Desktop Handoff 与 macOS Lifecycle 专项通过。
- Feature suites：65/65；IPC inventory 270/270，architecture/release/build metadata 无回归。
- 当前 Electron L3：通过；键盘、capability、响应式与 axe serious/critical=0。

### 下一轮

1. 进入 P2-MOD-06，建立统一子进程注册表，将 Gateway、PTY、Browser worker、Native Helper 与更新进程纳入 owner/state/shutdown 管理。
2. 为 Helper 补齐 registry ownership、退出顺序、残留检测和崩溃预算测试。
3. 保留 F05.4 的设计分支：评估签名 XPC/辅助 App 与 Electron Bundle 内通知桥接的成本，不在无签名 CLI Helper 上继续调用 UserNotifications。

## P2-R020：原生 Keychain CRUD 与旧引用兼容

### 本轮交付

- Swift Helper 新增 `keychain.put/get/delete` 白名单操作，使用 Security.framework `SecItemAdd/Update/CopyMatching/Delete`；service 固定为 `ai.drsai.desktop`，account 限 UUID，value 限 64 KiB，拒绝任意 accessGroup 和未知参数。
- 重复 put 使用 `SecItemUpdate`，delete 对 `errSecItemNotFound` 返回 `deleted=false`，Electron adapter 将其作为幂等成功处理。
- OSStatus 映射为 `user_cancelled`、`interaction_not_allowed`、`not_found`、`authentication_failed`、`keychain_unavailable`，不暴露原始 secret 或任意系统输出。
- 新增 `nativeCredentialService.ts`；保持同步 `DesktopCredentialService` 和 `keychain:<UUID>` reference 不变。原生 Helper 缺失/协议不可用时回退 legacy `security` CLI；用户取消、锁定或认证失败不回退，避免绕过拒绝或重复弹窗。
- legacy CLI adapter 拆到纯模块 `legacyCredentialService.ts`；旧 CLI 创建的同 service/account 条目可由 SecItem API直接读取，无需复制，迁移失败时旧 reference 原样保留。
- 产品 `MACOS_CREDENTIAL_SERVICE` 默认切换为 native hybrid；Auth、Provider、Approval 等共享调用方无需变更，renderer 仍只获得短期业务结果，不获得长期 token reference 对应明文。
- golden fixture 增加非法 service/account/accessGroup；真实随机 Keychain 条目完成 put/get/delete/重复 delete，测试后无残留。
- 新增 `p2:native-keychain` suite，覆盖 native/legacy routing、旧引用、锁定 fail-closed、固定 service 和幂等删除。

### 功能进度变化

| 功能 | 上轮 | 本轮 | 证据 |
|---|---|---|---|
| P2-F04.1 Keychain CRUD 原生适配 | not_started | implemented_unsigned | 真实 SecItem CRUD、重复写、幂等删除、输入白名单；稳定签名身份 L5 待补 |
| P2-F04.2 凭据迁移兼容 | not_started | implemented_unsigned | reference/service 兼容、Helper missing fallback、失败保留旧数据；签名升级证据待补 |
| P2-F04.3 锁定/拒绝/不可用处理 | not_started | implemented_unsigned | OSStatus 结构化映射、locked/cancel 不回退、not-found；真实锁屏/签名身份待补 |
| P2-F04.4 敏感数据最小暴露 | not_started | accepted | renderer 隔离、无 Helper 日志、secret redaction、非法参数/输出负向测试、65 suites |
| P2-F04.5 身份生命周期恢复 | not_started | implemented_unsigned | Auth refresh/logout/删除/rollback 与 native reference 回归；稳定 Bundle ID/签名升级待补 |

P2-MOD-04 当前 **1 accepted + 4 implemented_unsigned**。四项 Keychain/身份功能需要稳定 Developer ID/Bundle ID 下的锁屏、升级、删除与恢复证据后才能转 accepted；本机 unsigned 结果不会被提升为正式身份验收。

### 自动化结果

- Native Helper/Keychain：真实随机条目 CRUD、幂等删除、invalid service/account/accessGroup、locked fail-closed、legacy fallback 全部通过。
- `test:native-helper`：通过；新增 Security.framework 后 arm64 executable 仍字节可复现，当前 hash `7649b809933ee694410a50b1cea1ec1ba5fc9a67ba66aad2c4e14c53cee65fb6`。
- TypeScript、production build、P2 composition 与 IPC inventory：通过；`index.ts` 347 行，270/270 channel。
- Feature suites：65/65；secret redaction、Auth lifecycle、Provider credentials、Approval persistence 无回归。
- 真实 Electron L3：通过；键盘、capability、响应式与 axe serious/critical=0。
- 覆盖率：共享业务 93.71%、核心状态机分支 92.14%、adapter 59.37%。

### 下一轮

1. 进入 P2-MOD-05，扩展 Helper TCC 状态模型与精确 System Settings 跳转。
2. 将权限请求限制为显式用户操作，启动阶段只查询不触发系统弹窗。
3. 实现原生 UserNotifications capability/授权/点击降级，同时保留 Electron notification fallback。

## P2-R019：Swift Helper、版本化协议与有界监督

### 本轮交付

- 新建 `native/OpenDrSaiNativeHelper` Swift Package，包含 `OpenDrSaiNativeProtocol` library、`OpenDrSaiNativeHelper` executable 和 XCTest target；首版白名单仅含 `handshake/capabilities/ping/shutdown`。
- 实现 protocolVersion=1 的 JSON Lines 协议，包含 requestId/operation/parameters；限制单行 64 KiB，严格拒绝未知字段、未知操作、非整数/不兼容版本、非法 requestId、非空未知参数和畸形 JSON。
- 针对本机 Swift 5.5 与默认 SDK 12.3 不兼容，`build-debug.sh` 显式锁定兼容 macOS 11.3 SDK、arm64 deployment target、仓库内 module cache；移除随机 LC_UUID/Debug 时间性数据后，连续两次 executable/dylib SHA-256 完全一致。
- 新增 TypeScript `nativeProtocol.ts` 和 `nativeHelperSupervisor.ts`：固定 PATH、`shell:false`、握手、能力协商、请求超时、AbortSignal、输出上限、缺失/不兼容 unavailable、一次崩溃重启预算与有界 shutdown。
- app-ready 将 Helper handshake 作为非关键步骤；失败写 `STARTUP_DEGRADED` 后继续启动核心 Electron。shutdown plan 新增具名 `native-helper` 资源。
- 新增共享 golden fixture 与两套 suite：真实 Swift 输出验证 handshake/ping/unknown-operation/unknown-field/incompatible-version/shutdown；supervisor 验证缺失、挂起、取消、畸形输出及真实 SIGKILL 后新 PID 恢复。
- electron-builder 将 Helper executable 与 protocol dylib 放入 `Contents/Resources/native`；无签名目录包内二者均为 arm64 Mach-O、权限正确且独立握手通过。
- CI 新增 `test:native-helper`；生成 `build/acceptance/native-helper-test-results.json`，记录可复现 hash 与测试边界。

### 功能进度变化

| 功能 | 上轮 | 本轮 | 证据 |
|---|---|---|---|
| P2-F03.1 建立 Swift Package/Helper 工程 | not_started | accepted | Swift Package、两次字节一致 arm64 Debug build、Mach-O/file/hash receipt |
| P2-F03.2 定义版本化协议 | not_started | accepted | protocolVersion/requestId/operation、64 KiB、JSON Lines、真实正负 fixture |
| P2-F03.3 实现进程监督 | not_started | accepted | handshake、timeout、AbortSignal、malformed/oversize、真实 SIGKILL restart、新 PID、具名 shutdown |
| P2-F03.4 实现能力协商和降级 | not_started | accepted | capability handshake、missing/incompatible unavailable、app-ready optional degradation、Electron L3 |
| P2-F03.5 实现协议生成与契约测试 | not_started | in_progress | TypeScript/真实 Swift golden fixture 已通过；本机缺完整 Xcode/xctest，Swift XCTest receipt 尚缺 |

P2-MOD-03 当前 **4/5 accepted**。F03.5 尚不能验收：`swift test` 在本机 Command Line Tools 环境报 `unable to find utility "xctest"`；需要安装与 SDK 匹配的完整 Xcode 后执行 `swift test --package-path macos/native/OpenDrSaiNativeHelper`。真实 executable fixture 不替代方案指定的 XCTest 回执。

### 自动化结果

- `test:native-helper`：通过；arm64 Debug executable hash `7d300aca647381b96d1bad7fc968087e4178671b36c4ad72985b6210408f3594`，连续构建字节一致。
- Packaged Helper：通过；固定 `Resources/native` 路径、arm64、可执行权限、真实 handshake/shutdown 和 SHA-256。
- TypeScript、production build、P2 composition 与 IPC inventory：通过；`index.ts` 347 行，270/270 channel。
- Feature suites：64/64；新增 `p2:native-helper`、`p2:native-protocol` 均通过。
- 真实 Electron L3：通过；键盘、capability、响应式与 axe serious/critical=0。
- 覆盖率：共享业务 93.71%、核心状态机分支 92.14%、adapter 59.37%。

### 本轮外部证据边界

- 完整 Swift XCTest：本机仅有 Command Line Tools，缺 `xctest`；F03.5 保持 in_progress。
- 既有 packaged Electron smoke：禁用 Developer ID 后，electron-builder fuse 修改使主 App 留下失效 linker ad-hoc signature，macOS 以 SIGKILL 拒绝启动；`codesign --verify` 报 `code has no resources but signature indicates they must be present`。包内 Helper 自身验证通过；不得用临时签名结果冒充正式发布证据。

### 下一轮

1. 进入 P2-MOD-04，实现 Helper Keychain CRUD、错误码映射与旧 CLI 安全迁移。
2. 继续保持 renderer 不接触长期 token，补齐 secret redaction 与锁定/删除恢复测试。
3. 在 MOD-09 unsigned packaging 阶段正式解决 arm64 ad-hoc development sealing；不将其提升为 Developer ID/signed RC 证据。

## P2-R018：显式 app-ready 服务工厂与 350 行组合根

### 本轮交付

- 新增 `bootstrap/configurePlatformBindings.ts`，将 Terminal、Auth、Runtime Remote Routing、Channel Provider Auth、Chat Remote Routing 与 Workspace File Dialog 六类全局绑定从 import-time 迁到显式 `app.whenReady()` 阶段。
- 新增 `bootstrap/createAppServices.ts`，延迟创建 Browser Worker/Task、Interactive Debug Policy/Service、IPC Audit Writer 和 Approval Store；service container 仅在 factory 完成后创建。
- 新增 `bootstrap/createMcpCoordinators.ts`，迁移 MCP enumerate/tool approval 输入收敛、路径授权、幂等 approval 与 replay guard，并以显式依赖注入 Trust registrar。
- 新增 `ipc/registerAllIpc.ts`，集中装配 16 个领域 registrar；组合根仅传入受保护/原始 IPC、container 及最小 app-ready dependencies。
- 新增 `bootstrap/installAppIntegrations.ts`，集中安装 Completion Notification、Diagnostics/Debug Publisher、Menu/Dock、Power、Display、Network、GPU 恢复事件，并返回 network monitor disposer。
- `index.ts` 从 628 行降至 345 行；自动化门禁已从历史 1475 行预算收紧为 **350 行硬上限**。所有单 registrar 继续低于 300 行。
- 更新 Shell、Release、MCP、Process Lifecycle 等验证器，使断言绑定实际 service factory/integration/coordinator，而非假定实现仍内联于入口。

### 功能进度变化

| 功能 | 上轮 | 本轮 | 证据 |
|---|---|---|---|
| P2-F02.3 建立显式 service container | in_progress | accepted | app-ready service factory、platform bindings、container after-ready creation、零入口重服务构造、typecheck/build/62 suites/L3 |
| P2-F02.5 设置组合根预算 | in_progress（628 行） | accepted（345 行） | 自动化 `<=350` 门禁；16 个 registrar 均 `<=300`；270/270 inventory |

P2-MOD-02 的 F02.1～F02.5 现已全部 accepted。组合根保留单实例锁、窗口引用、最小 service/container 组装和 Electron lifecycle 顶层监听；业务 IPC、重服务构造、平台绑定及系统集成都已迁出。

### 自动化结果

- TypeScript 与 Electron production build：通过（Node 24）；main/preload/renderer 产物完整。
- P2 main composition：通过；`index.ts` 验证值 346（文件 345 行），硬门槛 350；各 bootstrap/IPC 文件预算通过。
- IPC inventory：preload=270、Windows=270、macOS=270、missing=0。
- Feature suites：62/62；Shell、MCP、Process Lifecycle、Release、Browser Runtime 与全部共享业务回归通过。
- 真实 Electron L3：通过；键盘、capability、响应式与 axe serious/critical=0。
- 覆盖率：共享业务 93.71%、核心状态机分支 92.14%、adapter 59.37%。

### 下一轮

1. 进入 P2-MOD-03，建立最小 Swift Helper 工程与 unsigned arm64 构建门禁（P2-F03.1）。
2. 定义版本化 JSON-lines stdin/stdout 协议、request ID、超时与结构化错误（P2-F03.2）。
3. 保持 Electron 为主框架；Helper 仅承载 Keychain/TCC/通知等白名单原生能力，不复制业务状态。

## P2-R017：可降级启动与具名逆序退出编排

### 本轮交付

- 新增 `bootstrap/appReadyPlan.ts`，建立有序 app-ready step runner；可选步骤失败记录 degraded 并继续，关键步骤失败立即停止后续初始化。
- 将通知偏好恢复、核心持久状态初始化、Workflow Run 恢复和 Background Task 恢复接入启动计划；核心状态保持 fail-closed，非关键恢复失败写入 IPC 审计后降级启动。
- 新增 `bootstrap/shutdownPlan.ts`，把 Scheduled Worker、PTY、Voice、Runtime Installer、Approval、Debugger、Browser、MCP、Port Forward、SSH、Remote Gateway/Workspace、Mobile Pairing、Agent/Chat Journal 和 Gateway 固化为 16 个唯一具名退出步骤。
- 组合根显式注入全部 shutdown dependency，由既有 bounded coordinator 顺序执行；并发 quit 继续复用单一 Promise，卡死资源继续受超时约束。
- 新增 `verify-macos-bootstrap-plans.mts`，执行验证初始化顺序、可选失败降级、关键失败中止、退出资源唯一性和声明顺序；修复 Process Lifecycle 与 MCP Session verifier 对旧内联退出链的单文件假设。

### 功能进度变化

| 功能 | 上轮 | 本轮 | 证据 |
|---|---|---|---|
| P2-F02.3 建立显式 service container | in_progress（13 个领域使用） | in_progress（13 个领域使用） | 启动/退出依赖显式注入；模块加载时配置与重服务构造仍待迁移 |
| P2-F02.4 拆分启动/退出编排 | in_progress | accepted | bootstrap plan 行为测试、process lifecycle、MCP shutdown、typecheck、build、62/62 suites、L3 |
| P2-F02.5 设置组合根预算 | in_progress（621 行） | in_progress（628 行） | 新增编排边界已完成；组合根注入仍待进一步收敛至 350 行 |

F02.4 已满足初始化顺序、部分失败降级和逆序 shutdown 可测试的验收要求。F02.3/F02.5 尚未验收：`index.ts` 仍在模块加载阶段配置 Auth/Remote/Chat/File Dialog 并构造 Browser/Debugger/Store 等服务，且 628 行高于 350 行预算。

### 自动化结果

- Bootstrap Plans 专项：通过；optional degradation、critical abort、16 个 shutdown resource 顺序与唯一性均通过。
- TypeScript 与 Electron production build：通过（Node 24）。
- P2 main composition、Process Lifecycle、MCP Session 与 IPC inventory：通过；preload/Windows/macOS 均为 270 channel。
- 真实 Electron L3：通过；键盘、capability、响应式与 axe serious/critical=0。
- Feature suites：62/62；共享业务 93.71%、核心状态机分支 92.14%、adapter 59.37%。

### 下一轮

1. 抽取模块加载阶段的平台配置和服务创建，消除 import-time 重资源副作用，完成 P2-F02.3。
2. 将 IPC registrar 装配与 app-ready 系统事件绑定迁入窄编排模块。
3. 把 `index.ts` 从 628 行压缩至不超过 350 行，完成 P2-F02.5 和 P2-MOD-02。

## P2-R016：Presentation/Execution IPC 完成领域拆分

### 本轮交付

- 新增 `src/main/ipc/registerPresentationIpc.ts`，迁移 Manager Presentation generate/cancel/pause/resume/requirement/recovery 共 7 个 handler，并将 owner-scoped run registry、暂停 waiter、active operation controller 与进度发布一并移出组合根。
- 新增 `src/main/ipc/registerExecutionIpc.ts`，迁移 Materials/Anomaly、Agent Run 与 Chat Run 共 11 个 handler；保留 workspace path 授权、A5 service guidance、sender ownership 与恢复路由。
- `index.ts` 由 750 行降至 621 行；所有 270 个 invoke handler 均位于独立领域 registrar，组合根不再直接注册 `desktop:*` invoke channel。
- composition gate 新增 Presentation/Execution 单文件预算、owner/path/A5/recovery 契约，以及组合根零 invoke 注册断言。
- 权威 IPC inventory 审计发现此前累计数重复记账 5 个 handler：P2-R015 实际为 252，而非 257；产品通道始终为 270/270，无缺失或重复。本轮迁移剩余 18 个后为 270/270。

### 功能进度变化

| 功能 | 上轮 | 本轮 | 证据 |
|---|---|---|---|
| P2-F02.2 按领域拆分 IPC 注册器 | in_progress（14 个领域/252 handlers） | accepted（16 个领域/270 handlers） | typecheck、build、composition、270/270 inventory、Presentation/Agent/Chat/Anomaly 契约、62/62 suites、L3 |
| P2-F02.3 建立显式 service container | in_progress（11 个领域使用） | in_progress（13 个领域使用） | Presentation/Execution workspace capability injection、结构契约 |

F02.2 已满足领域独立注册、IPC 等价和共享 Windows 回归要求，正式验收。F02.3 尚未验收：组合根仍存在模块加载时配置和重服务实例化，需随 F02.4 启动/退出编排消除隐式副作用。F02.5 的 `index.ts <= 350` 行预算也仍未达到。

### 自动化结果

- TypeScript 与 Electron production build：通过（Node 24）。
- P2 main composition、IPC inventory：通过；`index.ts` 621 行、Presentation 43 行、Execution 22 行，preload/Windows/macOS 均为 270 channel。
- 真实 Electron L3：通过；键盘、capability、响应式与 axe serious/critical=0。
- Feature suites：62/62；Manager Presentation recovery、Agent/Chat recovery、Anomaly、A5 guidance 与路径/owner 边界通过。
- 覆盖率：共享业务 93.71%、核心状态机分支 92.14%、adapter 59.37%。

### 下一轮

1. 抽取 app-ready bootstrap 和模块加载时配置，继续 P2-F02.3。
2. 拆分恢复、系统事件与 shutdown orchestration，使初始化顺序、降级和逆序退出可独立测试，推进 P2-F02.4。
3. 将 `index.ts` 从 621 行继续压缩至不超过 350 行，完成 P2-F02.5。

## P2-R015：Catalog/Mobile Pairing IPC

### 本轮交付

- 新增 `src/main/ipc/registerCatalogIpc.ts`，迁移 Mobile Pairing、Thread、Agent、Workspace Catalog 与 My DrSai Config 共 22 个 handler。
- `mobilePairingControllerFor(sender)` 作为显式 factory 注入，readiness/create/read/revoke 每次按调用方 WebContents 解析 controller，避免 grant 跨窗口共享。
- Agent list 继续只接受布尔 `refresh === true`；agent ID 非字符串收敛为空字符串交由共享服务拒绝/处理。
- My DrSai workspace path 复用 container registration gate；remote Workspace 不向本地配置读取器传递远程路径。
- `index.ts` 由 802 行降至 750 行；累计拆出 14 个领域、252 个 handler，macOS/preload IPC 保持 270/270。该累计数经 P2-R016 权威 inventory 审计修正，原记录重复计入 5 个 handler。
- composition gate 新增 Catalog 预算、sender-scoped pairing factory、agent refresh 收敛、remote config routing 与 channel 不得回流约束。

### 功能进度变化

| 功能 | 上轮 | 本轮 | 证据 |
|---|---|---|---|
| P2-F02.2 按领域拆分 IPC 注册器 | in_progress（13 个领域/235 handlers） | in_progress（14 个领域/252 handlers；P2-R016 审计修正） | typecheck、build、composition、270/270 inventory、Catalog/Pairing 契约、62/62 suites、L3 |
| P2-F02.3 建立显式 service container | in_progress（10 个领域使用） | in_progress（11 个领域使用） | sender factory injection、workspace assert/find capability、结构契约 |

F02.2/F02.3 尚未验收：Manager Presentation、Materials/Anomaly、Agent/Chat Run 等最后领域仍位于组合根，最终 350 行预算尚未达到。

### 自动化结果

- TypeScript 与 Electron production build：通过（Node 24）。
- P2 main composition、IPC inventory：通过；`index.ts` 750 行、Catalog 46 行，270 channel 无重复或缺失。
- 真实 Electron L3：通过；键盘、capability、响应式与 axe serious/critical=0。
- Feature suites：62/62；Thread persistence/search/snapshot、Workspace/Agent catalog、My DrSai、Mobile Pairing race/ownership 与 16 项安全检查通过。
- 覆盖率：共享业务 93.71%、核心状态机分支 92.14%、adapter 59.37%。

### 下一轮

1. 迁移 Manager Presentation 领域及其 owner-scoped run registry/helper。
2. 迁移 Materials/Anomaly 与 Agent/Chat Run 最后领域。
3. 完成 F02.2/F02.3 后继续抽取 app bootstrap/lifecycle，使组合根逼近 350 行预算。

## P2-R014：Auth/Cleanup/Browser/Codex/Gateway IPC

### 本轮交付

- 新增 `src/main/ipc/registerRuntimeServicesIpc.ts`，迁移 Auth/OIDC/SSO、Local Data Cleanup、Browser Task、Codex Backend、Gateway、Provider Analytics、Remote SSH Diagnostics 与 API Key 共 30 个 handler。
- `BrowserTaskService` 作为显式实例注入；Browser start 复用 container workspace registration gate。
- Local cleanup 保留 active Chat/Agent 拒绝、先停 Gateway、全量范围清除 diagnostics/auth/Electron cache/storage 的顺序。
- Codex backend 保留 capability presentation、login type 限制、external URL allowlist、cancel/logout；packaged build 继续拒绝本地 API key。
- `index.ts` 由 883 行降至 802 行；累计拆出 13 个领域、235 个 handler，macOS/preload IPC 保持 270/270。
- Codex backend verifier 改为绑定 `registerRuntimeServicesIpc.ts`，不再假设 channel 位于组合根。

### 功能进度变化

| 功能 | 上轮 | 本轮 | 证据 |
|---|---|---|---|
| P2-F02.2 按领域拆分 IPC 注册器 | in_progress（12 个领域/205 handlers） | in_progress（13 个领域/235 handlers） | typecheck、build、composition、270/270 inventory、Auth/Browser/Backend 契约、62/62 suites、L3 |
| P2-F02.3 建立显式 service container | in_progress（9 个领域使用） | in_progress（10 个领域使用） | Browser instance injection、workspace registration capability、结构契约 |

F02.2/F02.3 尚未验收：Thread/Workspace Catalog、Mobile Pairing、Agent/Chat/Presentation/Materials 等领域仍位于组合根，最终 350 行预算尚未达到。

### 自动化结果

- TypeScript 与 Electron production build：通过（Node 24）。
- P2 main composition、IPC inventory：通过；`index.ts` 802 行、Runtime Services 76 行，270 channel 无重复或缺失。
- 首次全量回归暴露 Codex verifier 只读 `index.ts`；改为绑定实际领域注册器后专项与全量复跑通过。
- 真实 Electron L3：通过；键盘、capability、响应式与 axe serious/critical=0。
- Feature suites：62/62；Auth session、Cleanup、Browser URL/approval/owner、Codex backend lifecycle、Gateway lifecycle 与 A5 guidance 场景通过。
- 覆盖率：共享业务 93.71%、核心状态机分支 92.14%、adapter 59.37%。

### 下一轮

1. 迁移 Thread/Workspace Catalog、Agent Catalog 与 Mobile Pairing 领域。
2. 保持 thread snapshot/search、remote My DrSai routing、agent refresh 输入收敛和 pairing sender ownership。
3. 继续压缩组合根并保持 270 IPC、62 suites 与 L3 不变式。

## P2-R013：Terminal/Voice IPC 与 MessagePort Trust Boundary

### 本轮交付

- 新增 `src/main/ipc/registerTerminalIpc.ts`，迁移 Terminal create/list/buffer/rename/write/resize/kill 共 7 个 handler；本地 cwd 继续校验 allowed roots，远程 cwd 保留 remote shell 语义。
- 新增 `src/main/ipc/registerVoiceIpc.ts`，迁移 transcription、streaming、synthesis、handoff 共 11 个 invoke handler，以及 `voice-streaming-audio-port` raw MessagePort channel。
- raw IPC 依赖收窄为 `Pick<IpcMain, "on">`；主窗口 WebContents 和 development renderer URL policy 显式注入。
- MessagePort 继续执行 trusted sender、session ID 和 port 完整性校验；失败时主动 close port，成功时按 sender 绑定 streaming session。
- `index.ts` 由 931 行降至 883 行；累计拆出 12 个领域、205 个 invoke handler，macOS/preload IPC 保持 270/270。
- composition gate 新增 Terminal/Voice 预算、sender event 传递、raw-on 最小能力、trusted WebContents/URL policy、invalid port close 和 channel 不得回流约束。

### 功能进度变化

| 功能 | 上轮 | 本轮 | 证据 |
|---|---|---|---|
| P2-F02.2 按领域拆分 IPC 注册器 | in_progress（10 个领域/187 handlers） | in_progress（12 个领域/205 handlers） | typecheck、build、composition、270/270 inventory、PTY/Voice 契约、62/62 suites、L3 |
| P2-F02.3 建立显式 service container | in_progress（8 个领域使用） | in_progress（9 个领域使用；Voice 使用显式 app-ready trust dependencies） | Terminal roots capability、Voice raw-on/WebContents/URL policy injection |

F02.2/F02.3 尚未验收：Auth/Core、Browser/Codex/Gateway、Thread/Workspace Catalog、Agent/Chat/Presentation 等领域仍位于组合根，最终 350 行预算尚未达到。

### 自动化结果

- TypeScript 与 Electron production build：通过（Node 24）。
- P2 main composition、IPC inventory：通过；`index.ts` 883 行、Terminal 24 行、Voice 37 行，270 invoke channel 无重复或缺失。
- 真实 Electron L3：通过；键盘、capability、响应式与 axe serious/critical=0。
- Feature suites：62/62；PTY owner isolation/detach/reclaim/replay/cleanup，Voice bounded queue/session owner/single port/ordered events/stop/cancel/cleanup/single terminal state 场景通过。
- 覆盖率：共享业务 93.71%、核心状态机分支 92.14%、adapter 59.37%。

### 下一轮

1. 迁移 Auth/Local Data Cleanup 与 Browser/Codex Backend/Gateway 领域。
2. 保持 OIDC debug sender、清理前 active task gate、session/storage 清理、Browser approval 和 external URL policy。
3. 继续压缩组合根并保持 270 IPC、62 suites 与 L3 不变式。

## P2-R012：Trust/Approval/MCP IPC

### 本轮交付

- 新增 `src/main/ipc/registerTrustIpc.ts`，迁移 Approval Center、Shell/Git Commit、Fork Lifecycle/Queue/Conflict Draft 与 MCP Context/Live Session 共 18 个 handler。
- 扩展 container approvals capability 为 `propose/list/decide`；MCP enumerate/execute app-level coordinator 作为显式函数依赖注入。
- 保留 Terminal sender ownership、Shell 输入上限与幂等键，Git commit roots/checklist/argv 执行，Fork lifecycle 状态二次读取与 queue 单源 workspace 约束。
- 保留 conflict draft hash 幂等键与 atomic write；MCP context/audit/session 路径授权、already-executed replay guard、cancel/close 和 shutdown cleanup 语义不变。
- `index.ts` 由 1069 行降至 931 行；累计拆出 10 个领域、187 个 handler，macOS/preload IPC 保持 270/270。
- 修复 MCP session verifier 的单文件假设，并单独约束 Trust 注册器中的 workspace authorization。

### 功能进度变化

| 功能 | 上轮 | 本轮 | 证据 |
|---|---|---|---|
| P2-F02.2 按领域拆分 IPC 注册器 | in_progress（9 个领域/169 handlers） | in_progress（10 个领域/187 handlers） | typecheck、build、composition、270/270 inventory、Trust/MCP 契约、62/62 suites、L3 |
| P2-F02.3 建立显式 service container | in_progress（7 个领域使用） | in_progress（8 个领域使用） | approvals propose/list/decide、MCP coordinator injection、allowed roots |

F02.2/F02.3 尚未验收：Terminal、Auth/Core、Thread/Workspace Catalog、Voice/Agent/Presentation 等领域仍位于组合根，最终 350 行预算尚未达到。

### 自动化结果

- TypeScript 与 Electron production build：通过（Node 24）。
- P2 main composition、IPC inventory：通过；`index.ts` 931 行、Trust 85 行、container 19 行，270 channel 无重复或缺失。
- 首次全量回归暴露 MCP verifier 只读 `index.ts`；改为统一 IPC 源及领域授权断言后专项与全量复跑通过。
- 真实 Electron L3：通过；键盘、capability、响应式与 axe serious/critical=0。
- Feature suites：62/62；Approval、Shell/Git/Fork、Fork Queue/Conflict Draft、MCP enumerate/execute/replay/session/cancel/audit/shutdown 场景通过。
- 覆盖率：共享业务 93.71%、核心状态机分支 92.14%、adapter 59.37%。

### 下一轮

1. 迁移 Terminal IPC 与 Voice IPC/MessagePort owner 路由，收敛 raw IPC 特例。
2. 保持 PTY sender ownership、detach/reclaim、voice session owner、单终态和 shutdown cleanup。
3. 继续压缩组合根并保持 270 IPC、62 suites 与 L3 不变式。

## P2-R011：Diagnostics/Interactive Debug/Handoff IPC

### 本轮交付

- 新增 `src/main/ipc/registerDiagnosticsIpc.ts`，迁移 Desktop/Production Diagnostics、Source Navigation、Interactive Debug、Edit/PDF/IDE Handoff、File Icon 与 File/Folder Picker 共 28 个 handler。
- `DiagnosticSourceNavigator`、`InteractiveDebuggerService` 与 `InteractiveDebugPolicyStore` 作为 app-ready 实例显式注入，未重复创建状态服务。
- 诊断导出继续使用独占临时文件、原子替换、0600 权限与 finally 清理；production 包保留加密导入导出和 preview。
- Source editor 继续使用 `execFile`、JSON string-array 模板、参数数量/长度边界；breakpoint、PDF、IDE 与 icon 路径复用 container allowed roots。
- `index.ts` 由 1183 行降至 1069 行；累计拆出 9 个领域、169 个 handler，macOS/preload IPC 保持 270/270。
- 修复 Interactive Debug verifier 的单文件假设：macOS 使用统一 `macosIpcSource`，Windows 仍读取自身组合根。

### 功能进度变化

| 功能 | 上轮 | 本轮 | 证据 |
|---|---|---|---|
| P2-F02.2 按领域拆分 IPC 注册器 | in_progress（8 个领域/141 handlers） | in_progress（9 个领域/169 handlers） | typecheck、build、composition、270/270 inventory、Diagnostics/Debug/Handoff 契约、62/62 suites、L3 |
| P2-F02.3 建立显式 service container | in_progress（6 个领域使用） | in_progress（7 个领域使用） | app-ready diagnostics dependencies、allowed roots capability、结构契约 |

F02.2/F02.3 尚未验收：MCP/Approvals/Terminal、Auth/Core、Voice/Agent/Presentation 等领域仍位于组合根，最终 350 行预算尚未达到。

### 自动化结果

- TypeScript 与 Electron production build：通过（Node 24）。
- P2 main composition、IPC inventory：通过；`index.ts` 1069 行、Diagnostics 93 行，270 channel 无重复或缺失。
- 首次全量回归暴露 Interactive Debug verifier 只读 `index.ts`，修正统一 IPC 源后专项及全量复跑通过。
- 真实 Electron L3：通过；键盘、capability、响应式与 axe serious/critical=0。
- Feature suites：62/62；诊断持久化/脱敏/加密包、源码映射、Debug policy/CDP/DAP/只读求值、IDE/PDF handoff 和路径边界场景通过。
- 覆盖率：共享业务 93.71%、核心状态机分支 92.14%、adapter 59.37%。

### 下一轮

1. 迁移 Approval/Shell/Git/Fork/MCP 领域，复用 approval 与 allowed roots capability。
2. 保持 secure IPC sender ownership、幂等键、MCP session cancellation/audit 和 fork conflict atomic write。
3. 继续压缩组合根并保持 270 IPC、62 suites 与 L3 不变式。

## P2-R010：Remote Access IPC

### 本轮交付

- 新增 `src/main/ipc/registerRemoteAccessIpc.ts`，迁移 SSH、Remote Gateway、Remote Workspace/HepAI Worker 与 Port Forward 共 26 个 handler。
- SSH disconnect/reconnect 继续联动 suspend/resume 对应 Port Forward；删除 host 前继续拒绝存在关联 forward 的 profile。
- Remote Gateway 安装继续强制 Approval Center，保留规范化请求、稳定幂等键、高风险审批、可取消安装与直接 install channel fail-closed。
- Port Forward create 继续校验 owner Workspace、remote 属性与 hostAlias 一致性，防止跨 workspace/host 绑定。
- `index.ts` 由 1231 行降至 1183 行；累计拆出 8 个领域、141 个 handler，macOS/preload IPC 保持 270/270。
- composition gate 新增 Remote Access 预算、显式审批注入、Gateway 幂等键、forward suspend/resume 与 workspace ownership 约束。

### 功能进度变化

| 功能 | 上轮 | 本轮 | 证据 |
|---|---|---|---|
| P2-F02.2 按领域拆分 IPC 注册器 | in_progress（7 个领域/115 handlers） | in_progress（8 个领域/141 handlers） | typecheck、build、composition、270/270 inventory、Remote 契约、62/62 suites、L3 |
| P2-F02.3 建立显式 service container | in_progress（5 个领域使用） | in_progress（6 个领域使用） | Remote Access approval capability、共享 singleton 生命周期与结构契约 |

F02.2/F02.3 尚未验收：Diagnostics、MCP/Approvals、Auth/Core、Voice/Agent 等领域仍位于组合根，最终 350 行预算尚未达到。

### 自动化结果

- TypeScript 与 Electron production build：通过（Node 24）。
- P2 main composition、IPC inventory：通过；`index.ts` 1183 行、Remote Access 57 行，270 channel 无重复或缺失。
- 真实 Electron L3：通过；键盘、capability、响应式与 axe serious/critical=0。
- Feature suites：62/62；SSH host-key/private known_hosts、Gateway preflight/trust/upload/atomic switch/rollback/cancel、Remote Workspace/HepAI lifecycle、Port Forward 冲突重分配/恢复/持久化/审计场景通过。
- 覆盖率：共享业务 93.71%、核心状态机分支 92.14%、adapter 59.37%。

### 下一轮

1. 迁移 Diagnostics/Interactive Debug/Handoff 领域，注入 allowed roots 与主窗口发送 capability。
2. 保持诊断加密导入导出、源码映射、debug policy 与 session owner 边界。
3. 继续压缩组合根并保持 270 IPC、62 suites 与 L3 不变式。

## P2-R009：Workspace Checkpoint/Worktree 历史域

### 本轮交付

- 新增 `src/main/ipc/registerWorkspaceHistoryIpc.ts`，迁移 Checkpoint list/create/accept/preview/restore 与 Worktree prepare/list/events/migration diagnostics 共 9 个 handler。
- 扩展 `MacosServiceContainer.workspace.allowedRoots()`，将 desktop roots 作为显式 capability 注入；所有目录请求继续经过 canonical path 与 directory 边界校验。
- Checkpoint restore 的请求完整性、checkpoint/operation ID、includePaths 上限、agent baseline review 状态、高风险审批、稳定幂等键和等待审批响应整体迁移。
- `index.ts` 由 1286 行降至 1231 行；累计拆出 7 个领域、115 个 handler，macOS/preload IPC 保持 270/270。
- composition gate 新增 Workspace History 预算、显式 roots/approval 注入、review gate、restore 幂等键和 channel 不得回流约束。

### 功能进度变化

| 功能 | 上轮 | 本轮 | 证据 |
|---|---|---|---|
| P2-F02.2 按领域拆分 IPC 注册器 | in_progress（6 个领域/106 handlers） | in_progress（7 个领域/115 handlers） | typecheck、build、composition、270/270 inventory、Checkpoint/Worktree 契约、62/62 suites、L3 |
| P2-F02.3 建立显式 service container | in_progress（4 个领域使用） | in_progress（5 个领域使用，增加 allowed roots） | `allowedRoots()` contract、path boundary、approval 注入与恢复回归 |

F02.2/F02.3 尚未验收：Remote/Terminal、Diagnostics、Auth/Core、Voice/Agent 等领域仍位于组合根，最终 350 行预算尚未达到。

### 自动化结果

- TypeScript 与 Electron production build：通过（Node 24）。
- P2 main composition、IPC inventory：通过；`index.ts` 1231 行、Workspace History 50 行、container 19 行，270 channel 无重复或缺失。
- 真实 Electron L3：通过；键盘、capability、响应式与 axe serious/critical=0。
- Feature suites：62/62；Checkpoint create/list/preview/restore/accept、review 状态、Worktree prepare/list/events/migration、审批和 realpath 场景通过。
- 覆盖率：共享业务 93.71%、核心状态机分支 92.14%、adapter 59.37%。

### 下一轮

1. 迁移 Remote SSH/Gateway/Workspace/Port Forward 领域，收敛 remote controller 与安装审批依赖。
2. 保持 host-key trust、安装校验、原子切换/回滚、端口冲突重分配和断连恢复语义。
3. 继续压缩组合根并保持 270 IPC、62 suites 与 L3 不变式。

## P2-R008：Workspace Files/Git 与显式远程路由

### 本轮交付

- 新增 `src/main/ipc/registerWorkspaceIpc.ts`，迁移 Workspace Overview、Files、Folder Summary、Preview、Save/Write、Git Diff/Ref、Stage/Revert File/Hunk 共 12 个 handler。
- 扩展 `MacosServiceContainer.workspace`，增加 `isRemoteTarget` 与 `isRemotePath` capability；远程离线继续 fail-closed，在线请求路由 Remote Gateway，本地请求保留 shared service。
- 将 `isRemoteWorkspaceTarget`/`isRemoteFolderTarget` 从组合根移除；Workspace 注册器只依赖 container 的 workspace capability。
- `index.ts` 由 1339 行降至 1286 行；累计拆出 6 个领域、106 个 handler，macOS/preload IPC 保持 270/270。
- composition gate 新增 Workspace 注册器预算、显式注入、路由 capability 与 helper/channel 不得回流约束。
- 修复 `verify-macos-contract.mjs` 的单注册器假设，统一通过 `desktopIpcSource.mjs` 扫描全部 `ipc/*.ts`，后续领域拆分无需逐文件维护 contract。

### 功能进度变化

| 功能 | 上轮 | 本轮 | 证据 |
|---|---|---|---|
| P2-F02.2 按领域拆分 IPC 注册器 | in_progress（5 个领域/94 handlers） | in_progress（6 个领域/106 handlers） | typecheck、build、composition、270/270 inventory、Workspace/Remote 契约、62/62 suites、L3 |
| P2-F02.3 建立显式 service container | in_progress（3 个领域使用） | in_progress（4 个领域使用，增加 remote routing） | `isRemoteTarget`/`isRemotePath` contract、离线 fail-closed、本地/远程路由回归 |

F02.2/F02.3 尚未验收：Checkpoint/Worktree、Remote/Terminal、Auth/Core 等领域仍位于组合根，最终 350 行预算尚未达到。

### 自动化结果

- TypeScript 与 Electron production build：通过（Node 24）。
- P2 main composition、shell contract、IPC inventory：通过；`index.ts` 1286 行、Workspace 53 行、container 18 行，270 channel 无重复或缺失。
- 首次全量回归暴露 shell contract 仅拼接 Platform 注册器，修正为全部 IPC 源后复跑通过。
- 真实 Electron L3：通过；键盘、capability、响应式与 axe serious/critical=0。
- Feature suites：62/62；文件写入冲突、Git diff/stage/ref/revert、stale review、本地/远程路由、冲突保护和断连失效场景通过。
- 覆盖率：共享业务 93.71%、核心状态机分支 92.14%、adapter 59.37%。

### 下一轮

1. 迁移 Workspace Checkpoint/Worktree 领域，注入路径 roots 与审批 capability。
2. 保持 restore 幂等键、review 状态约束、atomic restore 和 Worktree realpath 边界。
3. 继续压缩组合根并保持 270 IPC、62 suites 与 L3 不变式。

## P2-R007：Connections/Channel Adapters IPC

### 本轮交付

- 新增 `src/main/ipc/registerConnectionsIpc.ts`，迁移 Channel Adapters、Provider Auth/Token、Context Import/Sync、Inbound/Outbound 和 External Connection Readiness 共 14 个 handler。
- 将 `proposeChannelOutboundDraft` 完整迁入领域注册器，而非仅搬运 IPC 壳；保留审批回调交付、already-executed 幂等保护、即时已批准交付和异常 fail-closed 响应。
- Connections 通过统一 container 的 `workspace` 与 `approvals` capability 运行，provider 模块继续动态导入，避免增加冷启动装载。
- `index.ts` 由 1364 行降至 1339 行；累计拆出 5 个领域、94 个 handler，macOS/preload IPC 保持 270/270。
- composition gate 新增 Connections 注册器 300 行预算、显式注入、outbound helper 不得回流、审批/交付/fail-closed 语义约束。

### 功能进度变化

| 功能 | 上轮 | 本轮 | 证据 |
|---|---|---|---|
| P2-F02.2 按领域拆分 IPC 注册器 | in_progress（4 个领域/80 handlers） | in_progress（5 个领域/94 handlers） | typecheck、build、composition、270/270 inventory、Connector 契约、62/62 suites、L3 |
| P2-F02.3 建立显式 service container | in_progress（2 个领域使用） | in_progress（3 个领域使用） | Connections capability `Pick`、workspace/approval 注入、helper 移出组合根 |

F02.2/F02.3 尚未验收：仍有多数领域 handler 和平台闭包位于组合根，最终 350 行预算尚未达到。

### 自动化结果

- TypeScript 与 Electron production build：通过（Node 24）。
- P2 main composition、IPC inventory：通过；`index.ts` 1339 行、Connections 50 行，270 channel 无重复或缺失。
- 真实 Electron L3：通过；键盘、capability、响应式与 axe serious/critical=0。
- Feature suites：62/62；416 种 connector 格式与截断可达性、恶意/超限/资源攻击输入、凭据、同步、审批、幂等、撤销和 realpath 场景通过。
- 覆盖率：共享业务 93.71%、核心状态机分支 92.14%、adapter 59.37%。

### 下一轮

1. 迁移 Workspace Files/Git/Checkpoint/Worktree 领域，抽象本地/远程路由 capability。
2. 将 remote target/path 判断从组合根迁入领域服务，继续 P2-F02.3。
3. 继续压缩组合根并保持 270 IPC、62 suites 与 L3 不变式。

## P2-R006：统一 Service Container 与 Automation IPC

### 本轮交付

- 新增 `src/main/serviceContainer.ts`，定义统一 `MacosServiceContainer`：workspace 授权/查询、审批能力及 automation 运行时。
- Customization 注册器改为复用 container 的 `workspace` 与 `approvals` capability，不再维护领域私有服务形状。
- 新增 `src/main/ipc/registerAutomationIpc.ts`，迁移 Workflow Marketplace/Run、Background Tasks、Reusable Tasks、Scheduled Tasks 和完成通知共 27 个 handler。
- Scheduled worker 通过 `getScheduledTaskWorkerStatus()` 动态查询当前实例，避免 container 初始化时冻结空值；run-due 复用显式注入的 `ScheduledTaskRuntime`。
- `index.ts` 由 1389 行降至 1364 行；累计拆出 4 个领域、80 个 handler，macOS/preload IPC 保持 270/270。
- composition gate 新增 container 160 行预算、Automation 注册器 300 行预算、显式注入、动态 worker 和 channel 不得回流约束。

### 功能进度变化

| 功能 | 上轮 | 本轮 | 证据 |
|---|---|---|---|
| P2-F02.2 按领域拆分 IPC 注册器 | in_progress（3 个领域/53 handlers） | in_progress（4 个领域/80 handlers） | typecheck、build、composition、270/270 inventory、Automation 契约、62/62 suites、L3 |
| P2-F02.3 建立显式 service container | in_progress（单领域接口） | in_progress（统一 container，2 个领域使用） | `MacosServiceContainer`、capability `Pick`、动态 worker 查询、composition contract |

F02.3 尚未验收：统一 container 已落地，但仍需让更多有平台依赖的领域接入并清除组合根中的隐式全局装配。

### 自动化结果

- TypeScript 与 Electron production build：通过（Node 24）。
- P2 main composition、IPC inventory：通过；`index.ts` 1364 行、Automation 53 行、container 16 行，270 channel 无重复或缺失。
- 真实 Electron L3：通过；键盘、capability、响应式与 axe serious/critical=0。
- Feature suites：62/62；Workflow、Scheduled/Background/Reusable Tasks、worker lifecycle、恢复、重试、审批保留、镜像与完成通知场景通过。
- 覆盖率：共享业务 93.71%、核心状态机分支 92.14%、adapter 59.37%。

### 下一轮

1. 迁移 Channel Adapters/External Connections 领域并复用 container workspace/approval capability。
2. 将 `proposeChannelOutboundDraft` 从组合根迁入领域服务，继续消除模块级闭包与推进 P2-F02.3。
3. 继续压缩组合根并保持 270 IPC、62 suites 与 L3 不变式。

## P2-R005：Workspace Customization 与显式服务边界

### 本轮交付

- 新增 `src/main/ipc/registerCustomizationIpc.ts`，迁移 Preferences、Custom Commands、Project/Team Memory 和 Project Skills 共 17 个 handler。
- 新增 `MacosCustomizationIpcServices`，只注入 `assertWorkspacePath` 与 Approval Store 的 `propose` 能力，首次把组合根服务依赖收敛为显式最小接口。
- 保持 Project Skill 安装/发布的稳定幂等键、高风险审批、等待审批响应和本地原子安装/发布语义。
- `index.ts` 由 1421 行降至 1389 行；累计拆出 3 个领域、53 个 handler，macOS/preload IPC 保持 270/270。
- composition gate 新增 Customization 注册器 300 行预算、显式服务注入、最小接口字段和 channel 不得回流约束。

### 功能进度变化

| 功能 | 上轮 | 本轮 | 证据 |
|---|---|---|---|
| P2-F02.2 按领域拆分 IPC 注册器 | in_progress（2 个领域/36 handlers） | in_progress（3 个领域/53 handlers） | typecheck、build、composition、270/270 inventory、62/62 suites、L3 |
| P2-F02.3 建立显式 service container | not_started | in_progress | `MacosCustomizationIpcServices` 最小接口、组合根显式注入、composition contract |

F02.3 尚未验收：当前只覆盖 Customization 领域，仍需建立统一 container 并迁移其他领域的闭包/全局依赖。

### 自动化结果

- TypeScript 与 Electron production build：通过（Node 24）。
- P2 main composition、IPC inventory：通过；`index.ts` 1389 行，Customization 注册器 55 行，270 channel 无重复或缺失。
- 真实 Electron L3：通过；键盘、capability、响应式与 axe serious/critical=0。
- Feature suites：62/62；Preferences、Commands、Memory 与 Project Skills 的隔离、并发、审批、原子安装/修复、发布完整性和迁移场景通过。
- 覆盖率：共享业务 93.71%、核心状态机分支 92.14%、adapter 59.37%。

### 下一轮

1. 将显式服务接口提升为统一 `MacosServiceContainer`，继续 P2-F02.3。
2. 迁移 Workflow/Background/Scheduled Tasks 领域，继续 P2-F02.2 并复用 workspace 授权服务。
3. 继续压缩组合根并保持 270 IPC、62 suites 与 L3 不变式。

## P2-R004：Sharing/Collaboration IPC 注册器

### 本轮交付

- 新增 `src/main/ipc/registerSharingIpc.ts`，迁移 Sharing/Collaboration 的 19 个 handler；注册器只依赖安全 IPC 包装器实际提供的 `handle` 能力。
- 覆盖分享创建、权限、撤销、版本、评论、评论任务、继续任务、审计、收发件箱、对象打开与制品下载。
- `index.ts` 由 1439 行降至 1421 行；累计拆出 2 个领域、36 个 handler，macOS/preload IPC 保持 270/270。
- composition gate 新增 Sharing 注册器 300 行预算、显式装配和 channel 不得回流组合根约束。

### 功能进度变化

| 功能 | 上轮 | 本轮 | 证据 |
|---|---|---|---|
| P2-F02.2 按领域拆分 IPC 注册器 | in_progress（1 个领域/17 handlers） | in_progress（2 个领域/36 handlers） | typecheck、build、composition、270/270 inventory、Sharing 完整契约、L3、62/62 suites |

F02.2 尚未验收：仍需迁移其余领域，并将组合根降到 P2-F02.5 的最终预算。

### 自动化结果

- TypeScript 与 Electron production build：通过（Node 24）。
- P2 catalog、main composition、IPC inventory：通过；无重复或缺失 channel。
- 真实 Electron L3：通过；键盘、capability、响应式与 axe serious/critical=0。
- Feature suites：62/62；Sharing 权限、下载完整性、评论任务、版本冲突、审计和撤销场景通过。
- 覆盖率：共享业务 93.71%、核心状态机分支 92.14%、adapter 59.37%。

### 下一轮

1. 继续 P2-F02.2，迁移 Preferences/Memory/Skills 等具备统一 workspace 校验依赖的领域。
2. 为 workspace path 断言建立显式 service container 接口，开始 P2-F02.3。
3. 继续压缩组合根并保持 270 IPC、62 suites 与 L3 不变式。

## P2-R003：领域 IPC 注册器第一批

### 本轮交付

- 新增 `src/main/ipc/registerPlatformIpc.ts`，迁移 Platform/System 的 17 个 handler，覆盖平台描述、系统权限、运行时安装、更新、剪贴板、外部 URL、路径与日志操作。
- `index.ts` 改为显式调用领域注册器；组合根由 1470 行降至 1439 行，macOS/preload IPC 总量继续保持 270/270。
- 新增 `desktopIpcSource.mjs`，使 inventory、feature acceptance、baseline 与 contract 从单文件假设升级为扫描 `index.ts` 和全部 `ipc/*.ts`。
- 强化 `verify-macos-main-composition.mjs`：约束注册器显式装配、Platform handler 不得回流组合根、单注册器 300 行预算、跨文件 channel 重复注册和总量漂移。

### 功能进度变化

| 功能 | 上轮 | 本轮 | 证据 |
|---|---|---|---|
| P2-F02.2 按领域拆分 IPC 注册器 | not_started | in_progress | Platform/System 第一批 17 个 handler；typecheck、build、composition、270/270 inventory、L3、62/62 suites |

F02.2 仍保持 `in_progress`：当前只完成首个领域注册器，必须继续拆分其余业务域并满足组合根预算后才能验收。

### 自动化结果

- TypeScript 与 Electron production build：通过。
- P2 main composition、shell、system permissions、runtime contract：通过。
- 真实 Electron L3：通过；键盘、capability、响应式与 axe serious/critical=0。
- Feature suites：62/62。
- IPC：preload=270、Windows=270、macOS=270、missing=0，且无重复 channel。
- 覆盖率：共享业务 93.71%、核心状态机分支 92.14%、adapter 59.37%。

### 下一轮

1. 继续 P2-F02.2，按依赖关系迁移 Core/Workspace 或 Preferences/Memory 等下一批 handler。
2. 为每个领域注册器补充独立装配契约，逐步降低 `index.ts` 至 P2-F02.5 的 350 行预算。
3. 启动 P2-F02.3 service container，消除领域注册器对组合根闭包状态的隐式依赖。

## P2-R002：窗口组合根拆分

### 本轮交付

- 新增 `src/main/bootstrap/createWindow.ts`，集中管理 BrowserWindow 构造、安全 webPreferences、popup URL 限制、renderer crash 监听、无响应恢复和加载路径。
- `index.ts` 不再直接构造 BrowserWindow，只负责注入 open-request、更新健康、恢复协调、PTY/voice owner 清理和主窗口引用。
- 新增 `verify-macos-main-composition.mjs` 和 `verify:p2-main-composition`，锁定窗口边界、当前 1470 行阶段预算、180 行窗口模块预算及 270 IPC 不变式。
- 更新 shell/release contract，使测试跟随新的模块职责，而非强制所有逻辑继续堆在 `index.ts`。

### 功能进度变化

| 功能 | 上轮 | 本轮 | 证据 |
|---|---|---|---|
| P2-F02.1 抽取 `bootstrap/createWindow` | not_started | accepted | typecheck、build、main composition、shell/release contract、Electron L3、62/62 suites |

组合根由 **1503 行降至 1470 行**；窗口模块为 **71 行**；macOS/preload IPC 继续保持 **270/270**。最终 350 行预算属于 P2-F02.5，尚未完成。

### 自动化结果

- TypeScript 与 Electron production build：通过。
- P2 main composition：通过。
- macOS shell/release contract：通过。
- 真实 Electron L3：通过；键盘、capability、响应式与 axe serious/critical=0。
- Feature suites：62/62。
- IPC：preload=270、Windows=270、macOS=270、missing=0。
- 覆盖率：共享业务 93.71%、核心状态机分支 92.14%、adapter 59.37%。

### 下一轮

1. P2-F02.2：建立按领域 IPC 注册器，先迁移低耦合 Platform/System/Core handler。
2. P2-F02.3：建立显式 service container，逐步消除模块加载时装配副作用。
3. 建立 P2 acceptance 聚合器，机器计算每个功能的实际状态。

## P2-R001：机器清单、基线与本机门禁恢复

### 本轮交付

- 建立 `macosPhase2Catalog.mjs`：10 个模块、50 个唯一功能点，包含 owner、P2 层级、测试入口和原 12/72 产品功能映射。
- 建立 `verify-macos-phase-2-catalog.mjs` 和 npm 入口 `verify:p2-catalog`。
- 建立 `record-macos-phase-2-baseline.mjs` 和 npm 入口 `record:p2-baseline`。
- 新增 ADR-0001，固定 Electron 主框架、Swift Helper 白名单边界及 `sandbox: false` 的重新评估条件。
- 新增 `.github/workflows/macos-desktop.yml`，拆分 unsigned PR、unsigned Nightly、signed RC L6 和发布阶段。
- 安装锁定依赖并在 Node 24/darwin-arm64 上恢复全量测试。
- 修复 macOS `/var` → `/private/var` canonical path 导致的路径、Worktree、Fork、PDF handoff、诊断源码、Workflow marketplace/run 测试和产品行为问题。

### P2 功能状态

| 模块 | accepted | implemented_unsigned | in_progress | not_started | blocked_on_signing | 说明 |
|---|---:|---:|---:|---:|---:|---|
| P2-MOD-01 | 4 | 0 | 1 | 0 | 0 | F01.2～F01.5 通过 L0；F01.1 尚缺真实进程/性能基线 |
| P2-MOD-02 | 0 | 0 | 0 | 5 | 0 | 下一轮开始组合根拆分 |
| P2-MOD-03 | 0 | 0 | 0 | 5 | 0 | Swift Helper 尚未创建 |
| P2-MOD-04 | 0 | 0 | 0 | 5 | 0 | 尚未实施原生 Keychain |
| P2-MOD-05 | 0 | 0 | 0 | 5 | 0 | 尚未实施原生 TCC/通知 |
| P2-MOD-06 | 0 | 0 | 0 | 5 | 0 | 既有测试通过，但 P2 子进程注册表尚未实施 |
| P2-MOD-07 | 0 | 0 | 1 | 4 | 0 | ADR 和路径修复完成；完整威胁回归未建立 |
| P2-MOD-08 | 0 | 1 | 0 | 4 | 0 | F08.3 的既有 L3 renderer/axe 门禁通过，P2 专项仍待建 |
| P2-MOD-09 | 0 | 1 | 1 | 2 | 1 | unsigned build/工作流已建立；正式签名门禁无凭据 |
| P2-MOD-10 | 0 | 1 | 1 | 2 | 1 | PR/unsigned CI 已定义；signed RC/L6 无凭据 |
| **合计** | **4** | **3** | **3** | **38** | **2** | **50 个功能点** |

`accepted` 仅用于本轮已经满足全部 P2-L0 要求的范围治理功能，不代表原产品 72 点通过；签名相关功能在 Developer ID、公证和真实更新证据出现前保持 `blocked_on_signing`。

### 自动化证据

| 门禁 | 结果 |
|---|---|
| P2 catalog | 10/10 模块、50/50 功能、唯一 ID 和映射通过 |
| TypeScript | 通过 |
| Electron build | 通过；main/preload/renderer 产物完整 |
| Renderer L3 | 通过；键盘导航、capability fail-closed、响应式、axe serious/critical=0 |
| IPC inventory | preload=270、Windows=270、macOS=270、missing=0 |
| 共享 feature suites | 62/62 通过 |
| 共享业务行覆盖 | 93.71%，门槛 80% |
| 核心状态机分支覆盖 | 92.14%，门槛 90% |
| adapter 行覆盖 | 59.37%，门槛 55% |
| P0/P1 缺陷 | 0 open |
| 原产品 acceptance | 0 accepted / 72 partial；缺 L4～L6 clean/signed evidence |

当前基线：`darwin-arm64`、main index 1503 行、macOS/preload IPC 270/270。工作树为 dirty，证据仅用于开发轮次，不得提升为发布证据。

### 本轮发现但未擅自处理

- `npm ci` 报告 10 个 high、1 个 critical 依赖漏洞；需要独立审计依赖链和兼容升级，不使用 `npm audit fix --force`。
- 本机没有 Developer ID 签名、公证凭据；P2-L5/L6 不能验收。
- `index.ts` 仍为 1503 行，P2-MOD-02 尚未开始，350 行预算未达到。

### 下一轮

1. 补齐 P2 acceptance 聚合器和真实进程/性能基线，使 F01.1 可判定。
2. 开始 P2-MOD-02：先抽取 `bootstrap/createWindow` 和 IPC 注册基础设施，保持 270 channel 完全等价。
3. 为组合根行数预算、加载时副作用和注册器 inventory 增加自动化测试。
