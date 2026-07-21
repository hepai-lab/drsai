# OpenDrSai 桌面端跨平台重构方案

状态：本阶段完成（macOS 真机与正式发布验收延期）  
适用分支：`feature/desktop`  
基线：`origin/merge_latest`（方案编写时为 `12617d6f`）  
目标平台：Windows、macOS  

## 实施进度（2026-07-22）

范围调整：当前没有可用的 macOS 设备，因此本阶段以“跨平台代码重构、Windows 回归、macOS 工程与 CI 准备完成”为终点。macOS 真机运行、Apple 凭据签名、公证、DMG 安装、系统权限、升级和回滚不作为本阶段完成阻塞项，也不得据此宣称 macOS 已达到正式发布条件；这些项目统一移入 M7。

- M0：完成。重构工作位于 `feature/desktop`，基线与 Windows 回归门禁已冻结。
- M1：完成。`shared/api`、`shared/test-kit`、迁移清单和架构边界验证已落地。
- M2：完成。Windows/macOS 共用一个 renderer 和 preload API。
- M3：完成。40 个主进程公共模块已迁入 `shared/main`，Windows 保留带删除标记的兼容入口；完整 verify、unpacked packaging、真实 packaged IPC smoke、安装检查和更新回滚 E2E 已通过。
- M4：按本阶段范围完成。macOS 壳已接入 Keychain、通知、node-pty zsh/bash、认证、Gateway、聊天、Agent run、线程、工作区、文件安全写入和基础语音；跨主机类型检查、构建与契约通过，真机公共 E2E 和进程残留检查移入 M7。
- M5：按本阶段范围完成。已提供 arm64 Runtime artifact 构建脚本、SHA-256 校验与原子安装、签名更新、降级阻止、启动健康 watchdog/自动 App 回滚、DMG/ZIP、hardened runtime、entitlements 及签名公证 CI；真实制品生成与验证移入 M7。
- M6：完成。旧客户端已移动到 `legacy/drsai-desktop` 并退出 workspace、版本同步、开发脚本、CI 和正式文档入口；最终删除时间随 macOS 发布切换决定。
- M7：延期，不属于当前任务。恢复条件是具备 Apple Silicon macOS 设备或 runner 以及正式发布所需 Apple 凭据。

当前 Windows 全量 `npm run verify` 已通过（含 66 项 renderer UI、16 张结构化视觉截图、真实 Python DAP 与 Gateway smoke）。这不替代 macOS 真机的 Keychain、TCC、PTY、签名、公证、安装、升级及回滚验收。

## 1. 背景与结论

当前仓库同时存在两套 Electron 桌面实现：

- `apps/desktop/windows` 是正式 Windows 产品主线，包含完整的聊天、Agent、工作区、文件、终端、语音、远程 Runtime、安装和更新能力。
- `apps/desktop/legacy/drsai-desktop` 是已归档的 Hermes 派生旧客户端，不作为 macOS 基线，也不参与正式构建。

本次重构采用“共享桌面能力 + 独立平台壳”的结构：

```text
apps/desktop/
├── README.md
├── docs/
├── shared/
│   ├── api/
│   ├── main/
│   ├── renderer/
│   └── test-kit/
├── windows/
└── macos/
```

Windows 和 macOS 是独立构建、签名和发布的产品壳；IPC 契约、平台无关主进程业务和 React 产品界面只有一个事实来源。重构必须保持 Windows 可持续发布，不采用复制 `windows` 全目录后再去重的方式。

## 2. 目标与非目标

### 2.1 目标

1. 建立清晰、可强制检查的跨平台依赖边界。
2. 保持 Windows 现有功能、数据和发布链路不回归。
3. 完成 macOS Apple Silicon 的开发、构建、签名、公证和 DMG 发布工程准备；真实发布验收延期到 M7。
4. 让 Windows 与 macOS 共享同一套 renderer、IPC 契约和平台无关业务。
5. 为平台能力建立契约测试，避免实现随时间分叉。
6. 归档旧 `drsai-desktop`，消除文档和开发入口歧义。

### 2.2 非目标

- 不重写 `cores/python/packages/drsai` 中的 Agent Runtime 或 Gateway。
- 不把 macOS 改为 SwiftUI/AppKit 原生客户端。
- 不在首个阶段同时重做桌面 UI。
- 不要求首个 macOS MVP 立即支持 Intel；首发以 arm64 为门禁，universal/x64 作为后续里程碑。
- 不在重构初期改变用户数据格式、OWOP/Relay 协议或 Gateway API。

## 3. 架构边界

### 3.1 `cores` 与 `apps/desktop/shared` 的关系

`cores/` 是整个 OpenDrSai 产品族共享的 Python Runtime、Agent 和 Gateway 核心。`apps/desktop/shared/` 只共享 Windows/macOS Electron 产品代码。

```text
Windows Desktop ─┐
                 ├─ apps/desktop/shared ── Electron/React 公共能力
macOS Desktop ───┘
        │
        └─ cores/python/packages/drsai ── Runtime/Gateway/Agent
```

不把 Python Runtime 复制进 `shared`，也不把 Electron UI 代码放入根 `cores`。

### 3.2 目录职责

#### `shared/api`

- main、preload、renderer 共用的 TypeScript 类型。
- IPC channel、请求、响应和事件契约。
- OWOP、Relay、Workspace 等生成类型的桌面绑定。
- 平台能力接口，如 Installer、Updater、Terminal、CredentialStore、PermissionProvider。
- 不包含 Electron 主进程实现、React 组件或平台命令。

#### `shared/main`

- 平台无关的 Electron 主进程业务服务。
- Gateway、Runtime、Chat、Agent Run、Workspace、任务、记忆、分享、恢复和诊断编排。
- 通过构造参数接收平台能力，不直接调用 PowerShell、Keychain、注册表或 macOS 命令。
- 允许依赖 `shared/api`，禁止依赖 `windows` 或 `macos`。

#### `shared/renderer`

- Windows/macOS 共用的 React UI、状态模型、hooks、样式和前端适配器。
- 只通过 preload 暴露的统一桌面 API 访问系统能力。
- 不判断 PowerShell、zsh、MSI、DMG 等平台实现细节。
- 可读取展示层的平台 capability 信息，以隐藏当前平台不支持的功能。

#### `shared/test-kit`

- 平台契约测试套件、fixtures、mock preload、假 Gateway 和 E2E 公共场景。
- 不放产品运行时代码。
- Windows/macOS 都必须调用同一套契约测试。

#### `windows`

- Windows Electron 入口和平台装配。
- PowerShell/CMD/WSL、DPAPI、Toast、MSI/NSIS、Windows updater、签名和 Sandbox 验收。
- Windows 专属资源、IDE 集成和硬件证据。

#### `macos`

- macOS Electron 入口和平台装配。
- zsh/bash、Keychain、Notification Center、TCC 权限、codesign、notarization、stapling 和 DMG。
- macOS 专属资源、entitlements 和硬件验收。

### 3.3 依赖规则

```text
windows ─┐
         ├──> shared/renderer ──> shared/api
         ├──> shared/main ──────> shared/api
macos ───┘

shared -X-> windows
shared -X-> macos
renderer -X-> Electron main internals
api -X-> renderer/main platform implementations
```

必须增加静态边界检查，拒绝：

- `shared/**` 导入 `windows/**` 或 `macos/**`。
- `shared/main/**` 出现 `powershell.exe`、`cmd.exe`、`wsl.exe`、`security` CLI 等平台命令。
- renderer 直接使用 Node API、`ipcRenderer` 或 Gateway 网络连接。
- 平台目录复制一份共享 renderer 后自行修改。

## 4. 平台能力模型

平台差异通过显式接口装配：

```ts
export interface DesktopPlatform {
  readonly id: "windows" | "macos";
  readonly capabilities: DesktopCapabilities;
  readonly paths: PlatformPaths;
  readonly installer: BackendInstaller;
  readonly terminal: TerminalProvider;
  readonly credentials: CredentialStore;
  readonly updater: RuntimeUpdater;
  readonly notifications: NotificationProvider;
  readonly permissions: PermissionProvider;
}
```

平台入口只负责创建实现并启动公共应用：

```ts
startDesktop(createWindowsPlatform());
startDesktop(createMacOSPlatform());
```

所有可选能力必须通过 capability 声明表达。UI 不根据 `process.platform` 猜测功能是否可用。

## 5. 现有内容迁移映射

| 当前路径 | 目标路径/处理 | 说明 |
|---|---|---|
| `windows/src/shared` | `shared/api` | 先迁纯类型和生成契约 |
| `windows/src/renderer` | `shared/renderer` | Windows 先改为消费共享 UI |
| `windows/src/main` | 拆到 `shared/main` 与 `windows/src/main` | 按平台依赖逐文件判断 |
| `windows/tests` 通用部分 | `shared/test-kit` | 平台专项测试继续留在 Windows |
| `windows/installer` | 保留原位 | Windows MSI、安装、卸载和 Runtime 打包，与 Windows 产品壳同生命周期 |
| `windows/installer/contract/manifest.schema.json` | 保留原位 | 当前 schema 绑定 `windows-x64` 与 Windows 入口路径，归 Windows 所有；未来只有真正平台无关的契约才进入 `shared/api` |
| `windows/scripts/dev.ps1` | 保留原位 | Windows 开发、Runtime 与 Electron/Vite 启动实现；仓库级入口只允许薄 wrapper |
| `macos/scripts/*.sh` | 保留原位 | macOS 开发、环境准备、Runtime 制品与 packaged smoke 脚本 |
| `drsai_gateway_server.py` | 归档/删除 | 改用 `drsai.backend.gateway` 正式入口 |
| `legacy/drsai-desktop` | 已归档 | 已退出 workspace、正式启动、构建和发布路径 |
| `docs/drsai-desktop-technical-route.md` | 标记 legacy | 新架构以本文为准 |

### 5.1 `windows/src/main` 初步分类

适合优先抽取：Chat、Gateway/Runtime 客户端、Agent Runs、Workspace domain、任务、记忆、分享、SSE、恢复、可靠性和大部分浏览器策略。

必须留在 Windows 或先抽象接口：安装、更新、终端 shell 枚举、凭据、通知、权限、路径发现、进程树终止、IDE 系统集成和 Windows 发布诊断。

每次抽取以行为等价为准，不因目录调整顺便改业务语义。

## 6. 实施阶段

### M0：基线与边界冻结

- 保存 Windows 当前 `typecheck`、`verify`、UI、packaged smoke 和安装验收结果。
- 建立迁移清单，记录每个源文件的 owner、目标目录和平台依赖。
- 增加架构边界检查脚本。
- 冻结 IPC 契约变更流程：迁移期间任何 IPC 改动必须同步契约测试。

退出条件：基线证据完整，CI 能拒绝新平台耦合。

### M1：抽取 `shared/api` 与 `shared/test-kit`

- 迁移 `desktopApi`、Workspace/Agent/诊断等纯类型。
- 建立平台能力接口和 capability 模型。
- 迁移 mock preload、fixtures 和契约测试工具。
- Windows import 改为共享入口，旧路径保留短期 re-export 时必须标记删除里程碑。

退出条件：Windows 构建和 IPC 契约测试通过；无循环依赖。

### M2：抽取 `shared/renderer`

- 移动 React UI、样式、前端状态和 adapters。
- 保持 Windows UI 像素与交互行为一致。
- 将平台差异转为 capability 驱动。
- 建立公共 renderer 的视觉快照与无障碍测试。

退出条件：Windows UI、视觉、键盘、缩放、无障碍和流式聊天验收无回归。

### M3：抽取 `shared/main`

- 先迁纯逻辑，再迁通过依赖注入可复用的服务。
- 将终端、安装、更新、凭据、通知、权限和路径封装为平台接口。
- Windows 实现保持原行为；每迁一项即运行相应现有 verifier。

退出条件：Windows 完整 `verify`、packaged smoke、安装/更新回滚和 Runtime E2E 通过。

### M4：建立 macOS MVP

- 创建 macOS Electron 入口、窗口、菜单和 preload。
- 实现路径、zsh/bash 终端、进程生命周期、Keychain、通知和基础权限。
- 接入共享 renderer/main 和本地 Gateway。
- 支持登录、聊天、工作区、文件、Agent Run、终端和基础语音。

本阶段退出条件：跨主机类型检查、构建、平台契约和发布配置静态检查通过，公共 E2E 与退出清理脚本已进入 macOS CI。arm64 真机执行结果移入 M7。

### M5：macOS 安装与发布

- 明确后端交付方式，优先使用受控、可校验的 Runtime artifact，避免依赖系统 Python。
- 配置 entitlements、hardened runtime、codesign、notarization、stapling 和 DMG。
- 实现 macOS 签名更新包、原子切换、启动健康检查和回滚。
- 完成干净机器安装、升级、降级阻止和卸载数据策略。

本阶段退出条件：Runtime artifact、DMG/ZIP、签名、公证、更新与回滚的配置、实现和验证脚本齐备，并可由 macOS CI 调用。真实制品与 Gatekeeper 结果移入 M7。

### M6：收尾与旧客户端退出

- 审计并归档 `drsai-desktop`。
- 拆除顶层兼容脚本和旧 Gateway shim。
- 更新根 README、开发手册和发布文档。
- 评估 Intel/universal 构建及后续平台功能对齐。

退出条件：主产品文档只指向 Windows/macOS 新架构，仓库没有两个可被误认为正式主线的 Electron 客户端。

### M7：macOS 真机与正式发布验收（延期）

M7 不属于当前重构任务的完成范围。具备 Apple Silicon macOS 环境和 Apple 发布凭据后，单独排期完成：

- 构建并验证 arm64 Runtime artifact 与 packaged app，运行公共 E2E。
- 验证 Keychain、TCC、通知、zsh/bash PTY、睡眠唤醒和退出后的 Runtime/PTY 清理。
- 使用正式凭据完成 codesign、notarization、stapling 和 Gatekeeper 在线/离线校验。
- 在干净机器执行 DMG 安装、首次启动、协议唤起、升级、降级阻止、失败更新回滚和数据兼容验收。

M7 完成前，项目状态只能表述为“macOS 工程准备完成”，不能表述为“macOS 可正式发布”。

## 7. 测试与验收方案

### 7.1 测试层级

| 层级 | 目标 | 运行平台 |
|---|---|---|
| 静态检查 | TypeScript、导入边界、生成契约、无乱码 | Windows、macOS |
| 单元测试 | 纯业务、解析、状态机、策略 | Windows、macOS |
| 平台契约测试 | Installer、Updater、Terminal、Credentials、Permissions | 对应平台 |
| 集成测试 | main/preload/IPC/Gateway/Runtime | Windows、macOS |
| Renderer 测试 | 组件、键盘、无障碍、响应式、视觉 | Windows、macOS |
| Packaged smoke | 真实打包应用、资源定位、IPC、安全边界 | 对应平台 |
| E2E | 登录、聊天、Agent、Workspace、文件、终端、恢复 | Windows、macOS |
| 发布验收 | 安装、签名、更新、回滚、干净机器 | 对应平台 |

### 7.2 共享验收矩阵

Windows 和 macOS 都必须通过：

1. 应用启动、单实例和安全 BrowserWindow 配置。
2. preload API surface 与 `shared/api` 完全一致。
3. Gateway 健康检查、启动、认证头和异常恢复。
4. 流式 Chat 顺序、取消、网络中断恢复和错误呈现。
5. Agent Run 的进度、审批、取消、后台继续和重启恢复。
6. Workspace 创建/打开、文件树、预览、Git diff、checkpoint 和 worktree。
7. 本地与远程 Runtime、OWOP/Relay 契约和幂等恢复。
8. 终端创建、输入、resize、关闭、重连和进程清理。
9. 麦克风权限拒绝/允许、语音取消和临时文件清理。
10. 更新不可破坏用户数据；失败后回到上一健康版本。
11. renderer 无 Node 权限，IPC 参数验证和敏感信息脱敏。
12. 中英文、缩放、键盘导航、屏幕阅读器标签和窄窗口布局。

### 7.3 平台契约验收

每个 `DesktopPlatform` 实现必须运行同一测试套件：

- `paths`：返回绝对、用户范围、可创建且不越权的路径。
- `terminal`：支持平台默认 shell，PTY 生命周期和 owner 隔离正确。
- `credentials`：密文不落普通配置文件，读取失败不泄露内容。
- `installer`：可报告进度、取消、失败原因和日志位置；重复执行幂等。
- `updater`：验证大小、哈希、签名、版本和来源；支持健康回滚。
- `notifications`：未授权时安全降级，不阻塞任务完成。
- `permissions`：状态可查询，拒绝后有可操作指引，不绕过系统授权。

### 7.4 Windows 回归门禁

在 `apps/desktop/windows` 至少执行：

```powershell
npm ci
npm run typecheck
npm run verify
npm run verify:ui
npm run verify:visual
npm run build:unpack
npm run verify:packaged
npm run verify:install-check
```

发布候选还必须执行现有 Windows 安装、更新、签名、Sandbox、真实 Runtime 和硬件专项验证。重构 PR 不得以“只移动文件”为理由跳过受影响模块的 verifier。

### 7.5 macOS 后续真机门禁（M7，延期）

目标脚本在 M4/M5 中建立，命名约定如下：

```bash
npm ci
npm run typecheck
npm run verify
npm run verify:ui
npm run verify:visual
npm run build:mac:arm64
npm run verify:packaged
npm run verify:signatures
npm run verify:notarization
npm run verify:install
npm run verify:update-rollback
```

以上命令不属于本阶段验收。M7 必须在真实 macOS runner/设备执行签名、公证、Keychain、TCC、PTY、通知、休眠唤醒和应用退出清理；这些项目不能由 Windows mock 代替。

### 7.6 CI 矩阵

| Job | Runner | PR 必跑 | 发布必跑 |
|---|---|---:|---:|
| Shared static/unit | Windows + macOS | 是 | 是 |
| Windows integration/UI | Windows | 是 | 是 |
| macOS integration/UI | macOS arm64 | M7 启用 | 是 |
| Windows packaged smoke | Windows | 影响桌面时 | 是 |
| macOS packaged smoke | macOS arm64 | M7 启用 | 是 |
| Windows install/update | 干净 VM/Sandbox | 否 | 是 |
| macOS sign/notarize/install/update | 干净 macOS | 否 | 是 |
| Shared real Runtime E2E | Windows；M7 后扩展 macOS | 夜间/候选 | 是 |

路径过滤只用于减少无关构建；`shared/**` 变化必须同时触发 Windows 和 macOS 作业。

### 7.7 验收证据

每个里程碑保留：

- 执行提交、平台、架构、Node/Electron/Python 版本。
- 命令、退出码和 JUnit/JSON 报告。
- UI/视觉截图。
- 安装包哈希、签名和公证结果。
- 干净机器安装、升级、回滚日志。
- 已知限制和被明确豁免的项目；豁免必须有 owner 和到期里程碑。

## 8. 数据、兼容与安全

- 默认继续使用兼容的 `~/.drsai` 数据布局；变更必须通过版本化迁移完成。
- Windows/macOS 同一账户数据格式必须兼容，但凭据只保存在各自系统安全存储中。
- 不允许 renderer 持有 HAI token、更新密钥或任意文件系统权限。
- 更新源必须有 host allowlist、TLS、哈希和平台签名验证。
- macOS entitlements 使用最小权限；新增 entitlement 必须有威胁说明和验收用例。
- 安装、更新和终端日志必须脱敏，不记录 token、密码或完整敏感命令环境。

## 9. 迁移与回滚策略

- 每个里程碑独立提交，先让 Windows 消费共享代码，再删除旧路径。
- 大规模 `git mv` 与业务修改分开提交，便于审查和回退。
- 短期 re-export/兼容 wrapper 必须注明删除里程碑，禁止永久双入口。
- 若某次抽取导致 Windows packaged smoke 或更新回滚失败，立即回退该模块抽取，不继续叠加 macOS 实现。
- macOS 未达到发布门禁前不改变 Windows 正式发布路径。

## 10. 完成定义

本阶段重构完成必须同时满足：

- 目标目录结构落地，依赖边界由 CI 自动验证。
- Windows 与 macOS 共享一套 API、main 公共业务和 renderer。
- Windows 现有发布门禁全部通过。
- macOS 工程通过跨主机类型检查、构建、架构契约和发布配置静态检查，真机脚本与 CI 入口齐备。
- Windows 通过共享核心 E2E 和平台契约测试；macOS 的真实运行结果明确登记为 M7 延期项。
- 旧 `drsai-desktop` 已归档或删除，不再出现在正式启动文档中。
- 顶层 README、架构、开发、安装和发布文档一致且无失效链接。

macOS 正式发布的完成定义由 M7 单独承担：arm64 签名、公证、DMG、安装、公共 E2E、系统集成、更新和回滚验收全部通过。在此之前不得用本阶段完成状态替代 macOS 发布结论。

## 11. 待决策事项

以下事项应在对应里程碑开始前形成 ADR：

1. macOS 后端采用捆绑 Python Runtime、独立 Runtime artifact，还是其他交付方式。
2. npm workspace 或 TypeScript project references 的具体组织方式。
3. macOS updater 是复用 electron-builder 更新能力，还是沿用统一 Runtime updater 协议。
4. 首发最低 macOS 版本，以及 Intel/universal 支持时间。
5. 旧客户端归档保留周期和独有能力迁移清单。
