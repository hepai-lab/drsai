# OpenDrSai macOS Desktop

该目录是正式 macOS 产品壳。业务 API、主进程公共逻辑和 React UI 分别来自 `../shared/api`、`../shared/main` 与 `../shared/renderer`；这里仅维护 macOS 窗口、菜单、Keychain、通知、进程/终端适配和 Apple 发布配置。

当前阶段只完成工程实现、跨主机静态门禁和 CI 准备。因暂无可用 macOS 设备，真机运行、签名、公证、DMG 安装、系统权限、升级和回滚验收已延期；完成这些验收前不得宣称 macOS 已达到正式发布条件。

## 开发与验证

平台脚本位于 `scripts/`：`dev.sh` 启动本地 Gateway 与 Electron 热更新，`start.sh` 启动正式 macOS workspace，`setup-dev.sh` 准备本地开发桩。

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
