# OpenDrSai macOS Desktop

该目录是正式 macOS 产品壳。业务 API、主进程公共逻辑和 React UI 分别来自 `../shared/api`、`../shared/main` 与 `../shared/renderer`；这里仅维护 macOS 窗口、菜单、Keychain、通知、进程/终端适配和 Apple 发布配置。

当前已有 Apple Silicon macOS 开发机，可以执行无签名开发、目录包、原生 Helper、PTY、生命周期和部分系统能力验证；但本机尚无 Developer ID 签名。签名身份相关的 Keychain/TCC 持久性、公证、stapling、Gatekeeper、正式 DMG、在线升级和回滚仍未验收；完成这些门禁前不得宣称 macOS 已达到正式发布条件。

当前能力审计、与 Windows 的差距以及达到完整产品功能的分阶段计划见 [macOS 全功能开发计划](docs/macos-full-function-development-plan.zh-CN.md)。

在全功能产品范围之上，第二阶段将保持 Electron/React 为主要框架，拆分主进程组合根，并按需引入 Swift 原生辅助层。固定工程范围、无签名开发边界和自动化验收方案见 [macOS 第二阶段开发计划](docs/macos-phase-2-development-plan.zh-CN.md)。

第二阶段逐轮实现、测试证据、模块燃尽和签名阻塞状态见 [macOS 第二阶段实施进度](docs/macos-phase-2-progress.zh-CN.md)。

跨机器继续开发前，请先阅读 [macOS 开发交接与恢复说明](docs/macos-development-handoff.zh-CN.md)。该文档标记了最后一次全绿基线、当前未验收的 R113 修改、工作树迁移风险以及 Apple Silicon 上的恢复与验收顺序。

## 开发与验证

平台脚本位于 `scripts/`：`dev.sh` 启动本地 Gateway 与 Electron 热更新，`start.sh` 启动正式 macOS workspace，`setup-dev.sh` 在 `~/.drsai/drsai-agent` 创建隔离 venv、以 editable 模式安装真实 Python Runtime、验证 CLI/import，并安装和 typecheck Desktop 依赖。它不再创建可误报就绪状态的开发桩。

GitHub Channel 真实授权使用 Device OAuth。开发/打包环境必须提供 OAuth App 的 `OPENDRSAI_GITHUB_CLIENT_ID`；未配置时授权入口失败关闭。Device code 和 access token 不写入 Channel JSON，macOS 仅保存 Keychain reference；授权完成前 adapter 保持 `config_required`。

在 `apps/desktop` 目录运行：

```bash
npm ci
npm run dev --workspace opendrsai-macos-desktop
npm run verify --workspace opendrsai-macos-desktop
npm run build --workspace opendrsai-macos-desktop
```

`verify` 包含 TypeScript、macOS 壳层 IPC/平台契约和发布配置静态检查。Windows 上可以运行这些跨主机门禁，但不能据此宣称真机能力通过。

## 打包与发布

PR 的 macOS runner 使用无签名的目录包做 packaged smoke：

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false npm run build:mac:dir --workspace opendrsai-macos-desktop
```

正式 arm64 制品：

```bash
npm run prepare:runtime:macos --workspace opendrsai-macos-desktop
npm run build:mac:arm64 --workspace opendrsai-macos-desktop
```

Runtime artifact 只能在 Apple Silicon macOS 构建。它包含隔离的 Python venv 和 DrSai 包，生成 SHA-256 manifest；首次安装会在 `~/.drsai` 内校验、解包、执行 `import drsai` 健康检查并以 rename 原子切换，失败时恢复 `.previous` 备份，不依赖用户的系统 Python 包环境。

发布 job 必须提供 `MACOS_CSC_LINK`、`MACOS_CSC_KEY_PASSWORD`、`APPLE_API_KEY`、`APPLE_API_KEY_ID` 和 `APPLE_API_ISSUER` secrets。产出的 DMG/ZIP 还必须在干净 Apple Silicon 机器验证：

- `codesign --verify --deep --strict` 与 `spctl --assess`；
- Apple notarization ticket 和 stapling；
- DMG 安装、首次启动、协议唤起、退出清理；
- Keychain 登录态、通知权限、TCC 提示、zsh/bash 与 PTY；
- 睡眠唤醒、升级、失败更新回滚和数据兼容。

卸载应用只移除 `/Applications/OpenDrSai.app`，默认保留 `~/.drsai` 中的工作区、用户材料和登录外的本地数据；用户明确选择“删除全部本地数据”后才允许清理应用数据。更新器禁止降级安装，自动回滚只恢复上一个已签名 App，不回退或删除用户数据格式。

应用更新使用 `electron-updater` 和签名 GitHub release 元数据，支持检查、下载、取消与退出安装。上一稳定版本回装、失败更新恢复和数据降级兼容仍必须在干净真机演练；静态契约不等于回滚验收已交付。

## 权限原则

entitlements 仅包含 Electron/V8 所需的 JIT 与 unsigned executable memory。当前没有声明 App Sandbox；在 Runtime、PTY、文件访问完成兼容性和威胁评审前，不得擅自增加 sandbox、网络服务端或宽泛文件权限。

## 架构范围

首发目标是 Apple Silicon arm64。Intel/universal 需要单独构建 x64 Runtime venv、双架构 node-pty 原生模块并重新完成签名、公证、性能和安装体积验收；在这些证据完成前不宣称支持 Intel，也不使用 Rosetta 作为正式交付方案。
