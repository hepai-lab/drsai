# OpenDrSai macOS 第二阶段开发计划

状态：待实施；本机无 Developer ID 签名，正式发布验收受限
制定日期：2026-07-23
适用分支：`feature/desktop`
技术方向：**Electron 为主框架，Swift 原生辅助层按需增强**
工程范围：**N=10 个模块、M=50 个功能点**

## 0. 定位与范围口径

本计划是现有 macOS 全功能计划之后的第二阶段工程计划，解决三个已经确认的问题：

1. `src/main/index.ts` 同时承担窗口、服务装配、IPC 注册和业务编排，已经成为高耦合组合根。
2. Electron 对 Keychain、TCC、通知、睡眠唤醒和系统交接等 macOS 能力的表达不够稳定，需要受控的原生辅助层。
3. 当前 Apple Silicon 开发机没有 Developer ID 签名，必须将“无签名开发验收”和“正式签名发布验收”严格分开。

第二阶段不重写共享 React renderer，不创建第二套 SwiftUI 产品界面，不把 Python Runtime 移入 Swift，也不以原生 Helper 绕过现有审批、安全 IPC 或 Workspace 边界。

现有产品验收范围仍由 `macosFeatureCatalog.mjs` 定义为 **12 个产品模块、72 个产品功能点**。本计划的 `P2-MOD-xx` / `P2-Fxx.y` 是第二阶段的工程交付键：

- `N = 10`：十个可独立开发、测试和退出的工程模块。
- `M = 50`：每模块五个功能点，共五十个可追踪交付项。
- 每个 P2 功能必须映射一个或多个既有 `Fxx.y`，或者标记为 `architecture-only`。
- P2 功能通过不自动把既有产品功能提升为 `accepted`；原产品仍按 L0～L6 证据判定。

## 1. 目标架构

```text
shared/renderer (React)
        │ Desktop API
        ▼
shared/preload
        │ 受保护 Electron IPC
        ▼
macos/src/main
  ├── bootstrap/        组合根、窗口、生命周期
  ├── ipc/              按领域注册 handler
  ├── services/         macOS 平台服务适配
  └── native/           原生桥接客户端与降级策略
        │ 固定 schema；无任意命令
        ▼
macos/native/OpenDrSaiNativeHelper (Swift)
  ├── Keychain / LocalAuthentication
  ├── TCC / 系统设置定位
  ├── UserNotifications
  ├── Workspace / Sleep / Wake 事件
  └── 必要的 LaunchServices 与系统诊断
```

### 1.1 Electron 保留职责

- React UI、路由、状态管理、聊天和流式展示。
- Thread、Agent、Workspace、Git、MCP、SSH、Workflow 等跨平台业务。
- Electron 窗口、菜单、协议唤起和 preload API。
- Node 文件操作、`node-pty` 终端和 Python Runtime/Gateway 管理。
- 统一审批中心、路径策略、审计日志和安全 IPC。

### 1.2 Swift Helper 首批职责

- Keychain 的增删查改和访问状态诊断。
- 麦克风、辅助功能、屏幕录制与 Automation 权限状态；只在用户显式操作后发起允许的请求。
- 原生通知授权、发送、点击回传和前台聚焦。
- 睡眠、唤醒、会话锁定等原生生命周期事件。
- LaunchServices/system settings 跳转和少量 Electron 无法稳定表达的系统能力。

### 1.3 明确不进入 Helper 的能力

- 任意 shell、任意文件读写、Git、SSH、MCP 或网络代理。
- API Key、OAuth token 的明文跨进程日志或落盘。
- Python Runtime 安装、Gateway 业务和 Agent 执行。
- React 页面或整套 SwiftUI UI。
- 能被现有 Node/Electron API可靠完成、且原生收益不明确的能力。

## 2. N=10 个模块 / M=50 个功能点

| 模块 | 功能范围 | 数量 | 主题 | 主要退出门禁 |
|---|---|---:|---|---|
| P2-MOD-01 | P2-F01.1～P2-F01.5 | 5 | 基线、ADR 与范围治理 | 文档/清单/基线一致 |
| P2-MOD-02 | P2-F02.1～P2-F02.5 | 5 | Main 组合根拆分 | IPC 等价、入口瘦身 |
| P2-MOD-03 | P2-F03.1～P2-F03.5 | 5 | 原生 Helper 与协议 | 可构建、可超时、可降级 |
| P2-MOD-04 | P2-F04.1～P2-F04.5 | 5 | 凭据与本机身份 | Keychain 无明文泄漏 |
| P2-MOD-05 | P2-F05.1～P2-F05.5 | 5 | TCC、通知与系统集成 | 无签名/签名双轨证据 |
| P2-MOD-06 | P2-F06.1～P2-F06.5 | 5 | 生命周期与进程治理 | 退出零残留、恢复有界 |
| P2-MOD-07 | P2-F07.1～P2-F07.5 | 5 | 安全边界与威胁治理 | IPC/Helper/路径负向测试 |
| P2-MOD-08 | P2-F08.1～P2-F08.5 | 5 | macOS 体验与无障碍 | 原生行为和 A11y 门禁 |
| P2-MOD-09 | P2-F09.1～P2-F09.5 | 5 | 构建、无签名开发与发布准备 | unsigned 可测、signed 待签 |
| P2-MOD-10 | P2-F10.1～P2-F10.5 | 5 | 自动化、真机和发布验收 | CI 分层、证据可追溯 |
| **合计** | **P2-F01.1～P2-F10.5** | **50** | **第二阶段工程交付** | **50/50 通过** |

### P2-MOD-01 基线、ADR 与范围治理（5 点）

| ID | 功能 | 验收要点 |
|---|---|---|
| P2-F01.1 | 建立第二阶段 source、IPC、进程与性能基线 | 保存 commit、IPC 数量、启动时间、空闲内存、退出残留和现有验证结果 |
| P2-F01.2 | 编写 Electron+Swift Helper ADR | 记录选择、非目标、信任边界、替代方案和撤销条件 |
| P2-F01.3 | 建立 P2 功能机器清单 | 50 个 ID 唯一、映射既有产品 featureId、测试与 owner |
| P2-F01.4 | 建立平台能力决策表 | 每项能力标为 Electron、Node、Swift Helper、capability-gated |
| P2-F01.5 | 修正文档事实漂移 | IPC 数量、Mac 可用性、CI、签名与验收状态以当前仓库为准 |

### P2-MOD-02 Main 组合根拆分（5 点）

| ID | 功能 | 验收要点 |
|---|---|---|
| P2-F02.1 | 抽取 `bootstrap/createWindow` | 窗口、安全选项、导航和恢复行为不变 |
| P2-F02.2 | 按领域拆分 IPC 注册器 | Core、Workspace、Agent、Remote、Automation、Media 等独立注册 |
| P2-F02.3 | 建立显式 service container | 服务依赖从构造参数进入，禁止模块加载时隐式启动重资源 |
| P2-F02.4 | 拆分启动/退出编排 | 初始化顺序、部分失败降级和逆序 shutdown 可测试 |
| P2-F02.5 | 设置组合根预算 | `index.ts` 目标不超过 350 行；单个注册器不超过 300 行，超限需 ADR |

拆分必须是行为保持型重构：IPC channel、preload API、错误码和持久化格式不得因搬迁隐式改变。每批迁移都需通过 inventory 和共享 Windows 回归。

### P2-MOD-03 原生 Helper 与协议（5 点）

| ID | 功能 | 验收要点 |
|---|---|---|
| P2-F03.1 | 建立 Swift Package/Helper 工程 | Apple Silicon Debug 构建可重复；不要求开发阶段 Developer ID |
| P2-F03.2 | 定义版本化协议 | JSON/JSON Lines 或 XPC 固定 schema，包含 protocolVersion、requestId、operation |
| P2-F03.3 | 实现进程监督 | 启动、握手、超时、取消、崩溃重启和退出清理有界 |
| P2-F03.4 | 实现能力协商和降级 | Helper 缺失/不兼容时返回 unavailable，不阻断核心 Chat/Workspace |
| P2-F03.5 | 实现协议生成与契约测试 | TypeScript/Swift fixture 双向一致，未知字段和未知操作失败关闭 |

首选低权限、随 App 打包的独立 Helper。只有确需双向事件或系统隔离时采用 XPC；无签名开发阶段可以使用普通子进程协议验证业务，正式发布前再完成签名身份与 XPC 审核。禁止为了规避签名问题放宽生产协议。

### P2-MOD-04 凭据与本机身份（5 点）

| ID | 功能 | 验收要点 |
|---|---|---|
| P2-F04.1 | Keychain CRUD 原生适配 | account/service/accessGroup 输入受限，重复写和删除幂等 |
| P2-F04.2 | 凭据迁移兼容 | 从现有 `security` CLI 引用安全迁移，失败保留旧数据 |
| P2-F04.3 | 锁定/拒绝/不可用处理 | 明确区分 user-cancelled、interaction-not-allowed、not-found |
| P2-F04.4 | 敏感数据最小暴露 | renderer 永不获得长期 token；日志、crash、IPC 审计全部脱敏 |
| P2-F04.5 | 身份生命周期恢复 | 登录、刷新、退出、Keychain 被删和 Mac 锁定后状态一致 |

### P2-MOD-05 TCC、通知与系统集成（5 点）

| ID | 功能 | 验收要点 |
|---|---|---|
| P2-F05.1 | TCC 状态统一模型 | microphone/accessibility/screen-recording/automation 返回统一状态与来源 |
| P2-F05.2 | 显式权限请求 | 只允许用户操作触发；启动时不得批量弹窗 |
| P2-F05.3 | 系统设置精确跳转 | 支持系统版本差异，失败时提供人工路径而非循环打开 |
| P2-F05.4 | 原生通知闭环 | 授权、发送、点击、聚焦和任务路由；拒权时 UI 安全降级 |
| P2-F05.5 | LaunchServices 与系统交接 | URL scheme、PDF/文件打开和应用激活具有正反向测试 |

无签名 Debug 构建只能证明协议、状态映射和部分系统行为。TCC 授权的持久性、身份稳定性与升级保持必须由具有稳定 Bundle ID 和签名身份的 RC 完成。

### P2-MOD-06 生命周期与进程治理（5 点）

| ID | 功能 | 验收要点 |
|---|---|---|
| P2-F06.1 | 统一子进程注册表 | Gateway、PTY、Browser worker、Helper、更新 watchdog 均有 owner 和状态 |
| P2-F06.2 | 有序 shutdown | 停止接收新任务、取消活动任务、flush journal、终止子进程、超时强杀 |
| P2-F06.3 | 崩溃与强杀恢复 | renderer crash、Helper crash、Gateway crash、App SIGKILL 后状态可解释 |
| P2-F06.4 | 睡眠/唤醒/锁屏恢复 | 网络、端口转发、计划任务、通知和活动会话按策略恢复 |
| P2-F06.5 | 残留与泄漏预算 | 正常退出子进程残留为 0；100 次循环无持续 fd/内存增长 |

### P2-MOD-07 安全边界与威胁治理（5 点）

| ID | 功能 | 验收要点 |
|---|---|---|
| P2-F07.1 | IPC 注册器统一策略 | 所有 renderer 可达 handler 经可信 sender、payload 限制、超时和审计 |
| P2-F07.2 | Helper allowlist | operation、参数、路径、URL 均白名单；不存在任意 shell 能力 |
| P2-F07.3 | 开发 URL 和导航防护 | 生产包拒绝开发 URL；CSP、popup、will-navigate 有负向测试 |
| P2-F07.4 | 路径和文件授权 | Workspace 外访问默认拒绝；系统选择器结果一次授权、范围最小 |
| P2-F07.5 | 威胁模型和安全回归 | 覆盖 XSS→IPC、协议注入、路径穿越、符号链接、secret leakage |

`sandbox: false` 在第二阶段暂不直接改变，但必须形成 ADR：记录依赖、攻击面、缓解措施和重新评估日期。若 Helper 能承接高权限能力，应试验 renderer sandbox，但不得以破坏 PTY/文件/更新能力为代价直接切换。

### P2-MOD-08 macOS 体验与无障碍（5 点）

| ID | 功能 | 验收要点 |
|---|---|---|
| P2-F08.1 | 窗口与菜单行为 | traffic lights、拖拽区、全屏、多显示器、重开窗口符合 macOS 习惯 |
| P2-F08.2 | 键盘与输入法 | 菜单快捷键、焦点、中文输入法、组合文本和编辑命令稳定 |
| P2-F08.3 | VoiceOver 和键盘导航 | 主旅程无严重/关键 axe 问题，原生弹窗和 Electron UI 焦点连续 |
| P2-F08.4 | 外观与系统偏好 | 深浅色、Reduce Motion、Increase Contrast、缩放有明确响应 |
| P2-F08.5 | 性能预算 | 冷启动、窗口可交互、空闲 CPU/内存、长会话和睡眠唤醒有基线与阈值 |

第二阶段不追求把全部 Web 控件替换为 AppKit；只有系统弹窗、权限和通知等原生收益明确的交互使用原生实现。

### P2-MOD-09 构建、无签名开发与发布准备（5 点）

| ID | 功能 | 验收要点 |
|---|---|---|
| P2-F09.1 | 无签名 Debug/dir 构建 | `CSC_IDENTITY_AUTO_DISCOVERY=false` 可构建并运行核心旅程 |
| P2-F09.2 | Helper 打包与架构检查 | Helper 位于固定资源路径，arm64、权限和 hash 与 manifest 一致 |
| P2-F09.3 | 开发/RC 配置隔离 | Debug 与 Release Bundle ID、数据目录、更新源和权限证据不混用 |
| P2-F09.4 | 签名图谱与脚本预检 | 主 App、Helper、Framework、node-pty、XPC/Extension 的签名顺序明确 |
| P2-F09.5 | 正式发布阻塞声明 | 缺 Developer ID/公证凭据时流水线输出 `unsigned-validated`，绝不输出 releasable |

本机当前可完成 P2-F09.1～P2-F09.4 的无签名部分。以下结论必须保留为 blocked：Developer ID 签名、notarization、stapling、Gatekeeper、签名更新和跨版本 TCC 保持。

### P2-MOD-10 自动化、真机和发布验收（5 点）

| ID | 功能 | 验收要点 |
|---|---|---|
| P2-F10.1 | PR 静态与单元门禁 | 类型、架构、IPC、Helper protocol、renderer、安全负向测试全绿 |
| P2-F10.2 | macOS unsigned packaged 门禁 | dir 包启动、核心旅程、Helper、PTY、退出清理和性能 smoke |
| P2-F10.3 | Nightly 真机稳定性 | 故障注入、100 次重启、2 小时 soak、睡眠唤醒和无残留 |
| P2-F10.4 | Signed RC 门禁 | codesign、公证、stapling、TCC、DMG、更新、回滚和旧数据兼容 |
| P2-F10.5 | 证据聚合与发布判定 | P2 50 点、原 72 点、缺陷、artifact hash 和 commit 强绑定 |

## 3. 自动化测试验收方案

### 3.1 测试层级

| 层级 | 环境 | 覆盖 | 是否需要签名 |
|---|---|---|---|
| P2-L0 | 任意 Node/macOS host | 文档、清单、依赖边界、schema、静态安全策略 | 否 |
| P2-L1 | macOS Node + Swift toolchain | TypeScript 单元、Swift XCTest、协议 fixture、错误映射 | 否 |
| P2-L2 | Electron development | preload/IPC、窗口、mock/fake Helper、renderer 旅程 | 否 |
| P2-L3 | macOS unsigned dir package | 真 Helper、PTY、Gateway、文件、退出清理、性能 smoke | 否 |
| P2-L4 | macOS unsigned nightly | 故障注入、重启、睡眠唤醒、长稳和权限有限验证 | 否，但 TCC 证据有限 |
| P2-L5 | Developer ID signed RC | Keychain/TCC/通知/签名身份/DMG/升级 | 是 |
| P2-L6 | notarized release candidate | Gatekeeper、stapling、在线更新、失败回滚、发布证据 | 是 |

### 3.2 自动化套件

第二阶段至少建立以下机器可执行套件；套件名称可在实现时调整，但功能映射不可删除：

1. `verify:p2-catalog`：验证 N=10、M=50、唯一 ID、owner、测试和原 featureId 映射。
2. `verify:main-composition`：检查 `index.ts` 预算、注册器边界、循环依赖和加载时副作用。
3. `test:native-helper`：Swift XCTest 覆盖协议解析、Keychain/TCC/通知 adapter 和错误码。
4. `verify:native-protocol`：TypeScript 与 Swift 共用 golden fixtures，覆盖版本不兼容、超时和畸形输入。
5. `verify:secure-ipc`：可信 sender、payload 上限、超时、去重、错误脱敏和审计。
6. `verify:native-negative`：未知 operation、路径穿越、超长参数、协议注入、secret leakage 全部失败关闭。
7. `verify:unsigned-packaged`：真实 unsigned dir App 启动、Helper 握手、Gateway/PTY/Chat/Workspace smoke。
8. `verify:process-lifecycle`：正常退出、强杀、Helper/Gateway crash、重启恢复和残留检查。
9. `verify:macos-ux`：窗口、菜单、快捷键、中文 IME、VoiceOver/axe 和系统外观。
10. `verify:performance-budget`：冷启动、可交互时间、空闲 CPU/内存、长会话和循环稳定性。
11. `verify:signed-rc`：签名图、TCC、Keychain、通知、DMG、协议唤起和数据兼容。
12. `verify:update-rollback`：旧签名版→新版本、坏版本→自动回滚、用户数据不回退。

### 3.3 必测场景

每项必须至少包含成功、拒绝/失败、取消、超时和重启恢复中适用的分支：

1. Helper 缺失、版本过旧、输出畸形、挂起、崩溃时，核心 Electron UI 可启动并显示可操作的降级状态。
2. Keychain 写入后 renderer、日志和证据文件中无凭据明文；用户拒绝访问不会触发登录循环。
3. TCC 权限只由显式用户动作触发；拒权后不重复弹窗，设置跳转可恢复到正确页面。
4. 通知点击只激活对应任务；伪造 task/thread ID 不得打开越权内容。
5. renderer crash、Gateway crash、Helper crash、SIGTERM、SIGKILL 后 journal 和审批状态一致。
6. 正常退出后 Gateway、PTY、Browser worker、Helper、watchdog 残留进程为 0。
7. 睡眠唤醒和断网恢复不得重复执行计划任务、重复发送消息或重复消费审批。
8. 外部 URL、文件、PDF、protocol URL、Workspace 路径必须包含正向和越界负向测试。
9. 100 次启动/退出无持续资源增长；2 小时 soak 无未处理拒绝和失控重启。
10. signed RC 更新失败时只恢复 App，不删除或降级用户数据。

### 3.4 自动判定规则

P2 功能状态固定为：

- `not_started`
- `in_progress`
- `implemented_unsigned`
- `blocked_on_signing`
- `accepted`

自动化规则：

- 代码存在但没有所需测试回执，只能是 `in_progress`。
- 只通过 P2-L0～L4 的签名相关功能最多为 `implemented_unsigned` 或 `blocked_on_signing`。
- 需要 P2-L5/L6 的功能必须使用稳定 Bundle ID、Developer ID 签名和当前 artifact hash，才能 `accepted`。
- 任意 required suite 失败、skip、flaky retry 后才通过或证据 commit 不一致，功能不得 `accepted`。
- 模块只有 5/5 功能 accepted 才通过；第二阶段只有 10/10 模块、50/50 功能通过才完成。
- 原有 12/72 产品验收继续独立计算；P2 报告不得覆盖原报告。

CI 需要生成：

- `macos-p2-acceptance.json`
- `macos-p2-summary.md`
- `native-helper-test-results.json`
- `process-lifecycle-evidence.json`
- `performance-budget-evidence.json`
- signed 阶段的 `codesign-graph.json`、notarization 与更新回滚证据

## 4. CI 与本机执行策略

### 4.1 PR-fast

- 全平台 TypeScript 类型和共享契约。
- P2 catalog、架构边界、IPC inventory、安全负向测试。
- Swift 文件存在性/schema 静态检查；非 macOS runner 不伪造 Swift 真机成功。
- Windows 共享层回归继续作为强制门禁。

### 4.2 PR-mac-unsigned

在当前无签名 Apple Silicon Mac 上执行：

```bash
cd apps/desktop
npm ci
npm run typecheck --workspace opendrsai-macos-desktop
npm run verify --workspace opendrsai-macos-desktop
swift test --package-path macos/native/OpenDrSaiNativeHelper
CSC_IDENTITY_AUTO_DISCOVERY=false npm run build:mac:dir --workspace opendrsai-macos-desktop
npm run verify:unsigned-packaged --workspace opendrsai-macos-desktop
npm run verify:process-lifecycle --workspace opendrsai-macos-desktop
```

上述命令是第二阶段目标接口；在相应脚本实现前，CI 必须明确报 `not implemented`，不得静默跳过。

### 4.3 Nightly-unsigned

- 真实 Helper、Runtime、Gateway、PTY 和 Browser worker。
- 100 次启动/退出、故障注入、2 小时 soak。
- 睡眠/唤醒测试在专用 runner 执行，虚拟机不替代真实硬件证据。
- 输出 `implemented_unsigned`，不得输出可发布结论。

### 4.4 RC-signed

获得 Apple 凭据后启用：

- Developer ID 签名图完整性。
- notarization、stapling、`spctl`。
- 稳定 Bundle ID 下 Keychain/TCC/通知。
- DMG 安装、首次启动、覆盖升级和卸载保留数据。
- 上一稳定版本在线升级、新版本健康确认和失败回滚。

## 5. 实施顺序与依赖

| 里程碑 | 模块 | 预计 | 退出条件 |
|---|---|---:|---|
| P2-M0 | MOD-01 | 1 周 | ADR、清单、基线和事实修正完成 |
| P2-M1 | MOD-02、MOD-07 | 2～3 周 | index 拆分、安全边界和 IPC 等价通过 |
| P2-M2 | MOD-03 | 2～3 周 | Helper 骨架、协议、监督和降级通过 |
| P2-M3 | MOD-04、MOD-05 | 3～4 周 | Keychain/TCC/通知 unsigned 实现完成 |
| P2-M4 | MOD-06 | 2～3 周 | 生命周期、恢复、残留和稳定性通过 |
| P2-M5 | MOD-08 | 2～3 周 | macOS UX、A11y 和性能预算通过 |
| P2-M6 | MOD-09、MOD-10 unsigned | 2～3 周 | 无签名 packaged/Nightly 证据完整 |
| P2-M7 | MOD-09、MOD-10 signed | 2～4 周 | 签名、公证、更新和回滚全部通过 |

单人顺序开发约 16～23 工程周；2～3 人可将 Main 重构、Helper、自动化分轨并行，但 MOD-03 协议冻结前不得并行实现多个原生能力。

建议实施顺序是先拆 `index.ts`、稳定 service/IPC 边界，再接入 Helper。否则会把现有组合根耦合复制到新的原生协议中。

## 6. 完成定义

第二阶段完成必须同时满足：

- 10 个模块、50 个 P2 功能全部 accepted，报告与当前 commit/artifact hash 绑定。
- `index.ts` 成为不超过 350 行的组合根，业务 IPC 按领域注册且 inventory 100% 一致。
- Swift Helper 只包含批准的 macOS 原生能力，不存在任意命令、任意路径或隐式网络能力。
- Helper 缺失、崩溃或不兼容时，Electron 核心功能安全降级，不出现启动死循环。
- 正常退出子进程残留为 0；100 次循环与 2 小时 soak 达到预算。
- Keychain、TCC、通知、睡眠唤醒和系统交接在真实 Apple Silicon 上通过。
- signed RC 完成 codesign、公证、stapling、Gatekeeper、DMG、更新与回滚。
- 原有 macOS 12/72 产品验收中所有受本阶段影响的功能重新取得证据。
- Windows 共享层和正式发布门禁无回归。

在当前没有 Developer ID 签名的前提下，本阶段最多达到：

> `unsigned implementation complete / release blocked on signing`

这不是失败，而是证据边界。不得使用 `xattr -cr`、临时自签名或关闭 Gatekeeper 的结果替代正式发布验收。
