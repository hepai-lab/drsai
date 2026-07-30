# OpenDrSai Desktop

OpenDrSai 桌面端采用 Electron + React，并通过本地或远程 OpenDrSai Runtime/Gateway 提供 Agent、工作区、终端、文件、语音和任务能力。

## 当前状态

- `windows/` 是当前正式 Windows 产品主线。
- `legacy/drsai-desktop/` 保存已退出产品主线的 Hermes 历史客户端，只用于考古，不参与 workspace、构建和发布。
- `shared/` 已承载统一 API、主进程公共业务、renderer 和跨平台契约测试。
- Channel 的 GitHub、Slack、Google Docs 和 Google Calendar connector 已具备真实 provider 读取链；前三者按各自产品语义提供审批后写入，Calendar 保持 inbound-only。所有凭据都进入平台凭据库，并执行 Workspace 隔离、scope/expiry 校验、秘密脱敏和幂等回执。`mobile-chat` 明确采用 Workspace-local reviewed snapshot；设备授权由独立 Mobile Pairing Runtime 契约负责，两者不虚构未定义的 Relay 消息协议。Channel 的 L0～L3 实现状态现为 implemented，Apple 真机验收仍待完成。
- `macos/` 已建立可类型检查、构建的正式壳层，并接入认证、Gateway、聊天、Agent、线程和工作区核心通道。由于当前没有可用 macOS 设备，本阶段不执行真机、签名、公证、DMG 安装和更新回滚验收；这些项目延期，不阻塞当前重构收尾，也不代表 macOS 已可正式发布。
- Python Agent Runtime 和 Gateway 位于仓库根目录 `cores/python/packages/drsai`，不属于桌面共享 TypeScript 代码。

完整方案见 [桌面端跨平台重构方案](docs/desktop-cross-platform-refactoring-plan.md)。旧客户端的历史技术说明见 [Legacy 技术路线](docs/drsai-desktop-technical-route.md)。

## 目标结构

```text
apps/desktop/
├── README.md
├── docs/                       # 双平台架构、迁移和决策记录
├── shared/
│   ├── api/                    # IPC、领域类型和平台能力契约
│   ├── main/                   # 平台无关 Electron main 业务
│   ├── renderer/               # Windows/macOS 共用 React UI
│   └── test-kit/               # 公共契约测试、fixtures 和 mocks
├── windows/
│   └── installer/              # Windows MSI、Runtime manifest、打包、安装和卸载实现
└── macos/                      # macOS 壳、安装、更新和系统集成
```

依赖只能从平台壳指向共享层：

```text
windows ─┐
         ├──> shared ──> cores/python/drsai（通过 Gateway/Runtime 边界）
macos ───┘
```

`shared` 不得反向依赖 `windows` 或 `macos`。Renderer 不直接使用 Node、Electron main 内部模块或 Gateway 网络连接。

## Windows 开发

在仓库根目录运行：

```powershell
.\apps\desktop\windows-desktop-dev.cmd
```

或者进入正式 Windows 工程：

```powershell
cd apps\desktop\windows
npm ci
npm run dev
```

常用验证：

```powershell
npm run typecheck
npm run verify
npm run verify:ui
npm run verify:visual
npm run build:unpack
npm run verify:packaged
```

Windows 的安装、更新和发布要求见 [Windows README](windows/README.md) 及其 `docs/` 目录。

## macOS 开发

进入 `apps/desktop` 后运行：

```bash
npm ci
npm run verify --workspace opendrsai-macos-desktop
npm run build --workspace opendrsai-macos-desktop
```

详细的开发、打包、签名与公证要求见 [macOS README](macos/README.md)。旧 `drsai-desktop` 不能代替 macOS 正式实现。

## 文档规则

- 双平台架构、迁移计划和跨平台契约放在 `apps/desktop/docs`。
- 平台专项开发、安装、签名和验收放在 `windows/docs` 或 `macos/docs`。
- 当前实现与目标结构必须明确标注，不把计划中的目录写成已经交付。
- 新平台能力先定义共享契约和测试，再实现 Windows/macOS adapter。
