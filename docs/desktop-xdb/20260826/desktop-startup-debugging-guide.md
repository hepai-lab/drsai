# DrSai Desktop 启动与调试指南

> **文档路径**: `docs/desktop-xdb/20262826/desktop-startup-debugging-guide.md`
> **适用分支**: `feature/desktop-v2`
> **分析日期**: 2026-08-26
> **入口脚本**: `apps/desktop/windows-desktop-dev.cmd`

---

## 目录

1. [启动链路总览](#1-启动链路总览)
2. [入口脚本分析](#2-入口脚本分析)
3. [核心启动脚本 dev.ps1 详解](#3-核心启动脚本-devps1-详解)
4. [环境变量配置全览](#4-环境变量配置全览)
5. [双前端模式：Workbench vs Legacy](#5-双前端模式workbench-vs-legacy)
6. [热重载机制](#6-热重载机制)
7. [Gateway 启动与调试](#7-gateway-启动与调试)
8. [调试方法大全](#8-调试方法大全)
9. [常见问题排查](#9-常见问题排查)
10. [快速启动速查](#10-快速启动速查)

---

## 1. 启动链路总览

```
windows-desktop-dev.cmd                    ← 用户双击/命令行入口
        │
        ▼
apps/desktop/windows/scripts/dev.ps1       ← 核心编排脚本 (966行)
        │
        ├── Step 1: 后端安装
        │   └── scripts/install.ps1 -DevSource $RepoRoot -DrsaiHome ~/.drsai-dev
        │       └── 创建 venv → pip install -e drsai → 写入 drsai.cmd 包装器
        │       └── 验证: Test-DeveloperBackendReady (python/drsai/import)
        │
        ├── Step 2: Gateway 启动
        │   ├── Workbench 模式: Electron 主进程自行启动 desktop_gateway (28643)
        │   └── Legacy 模式 + HotLoad: watch-gateway.ps1 监听 .py 变更 → 重启 uvicorn (28642)
        │
        └── Step 3: 前端启动
            └── npm install (如需) → 修复 Tailwind/Electron 原生绑定
            └── node scripts/run-dev-with-filter.mjs
                └── npm run dev → electron-vite dev
                    └── electron.vite.workbench.config.ts (Vite 构建)
                    └── Electron Main 进程启动
                        └── ipcMain.handle / BrowserWindow / Gateway spawn
```

### 进程模型

```
┌─────────────────────────────────────────────────────────────┐
│  Electron Renderer (React UI)                                │
│  - Vite Dev Server (HMR)                                     │
│  - 通过 ipcRenderer → ipcMain 通信                            │
└────────────────────────┬────────────────────────────────────┘
                         │ IPC
┌────────────────────────┴────────────────────────────────────┐
│  Electron Main (Node.js)                                     │
│  - gateway.ts: startGateway() → spawn python -m ...          │
│  - chat.ts: SSE 解析与事件分发                                │
│  - runtimeClient.ts: HTTP 客户端                              │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTP/SSE (127.0.0.1:28643)
┌────────────────────────┴────────────────────────────────────┐
│  Python Gateway (FastAPI/uvicorn)                            │
│  - desktop_gateway / drsai.backend.gateway                   │
│  - SSE 流式响应                                               │
└────────────────────────┬────────────────────────────────────┘
                         │ in-process
┌────────────────────────┴────────────────────────────────────┐
│  Runtime → DrSaiAssistant (Agent)                            │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. 入口脚本分析

### 2.1 `windows-desktop-dev.cmd`

**路径**: `apps/desktop/windows-desktop-dev.cmd`

这是一个简单的批处理包装器：

```batch
@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%windows\scripts\dev.ps1" -LaunchMode Development %*
```

**关键点**:
- `-NoProfile`: 不加载用户 PowerShell 配置文件，确保干净环境
- `-ExecutionPolicy Bypass`: 绕过执行策略限制
- `-LaunchMode Development`: 默认开发模式
- `%*`: 透传所有命令行参数给 `dev.ps1`

### 2.2 命令行参数传递

从 `dev.cmd` 可透传到 `dev.ps1` 的参数：

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `-LaunchMode` | `Development` | `Development` 或 `Production` |
| `-DrsaiHome` | 自动推导 | DrSai 数据根目录 |
| `-GatewayPort` | `28643` | Workbench 网关端口 |
| `-InstallPrerequisites` | `$false` | 仅安装前置依赖 |
| `-InstallOnly` | `$false` | 仅安装不启动 |
| `-ForceInstall` | `$false` | 强制重新安装后端 |
| `-SkipNpmInstall` | `$false` | 跳过 npm install |
| `-NoDevServer` | `$false` | 不启动 Electron dev |
| `-NoGateway` | `$false` | 不启动 Gateway |
| `-HotLoad` | `$false` | 启用 Python 热重载（仅 Legacy） |
| `-EnableRegressionControl` | `$false` | 启用回归测试控制 |
| `-PipIndexUrl` | 镜像地址 | pip 镜像源 |
| `-ShowLibPngWarnings` | `$false` | 显示 libpng 警告 |

---

## 3. 核心启动脚本 dev.ps1 详解

**路径**: `apps/desktop/windows/scripts/dev.ps1` (966 行)

### 3.1 环境推导

```powershell
# 推导仓库根目录
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")

# 推导 DrSai Home
# 开发模式: ~/.drsai-dev
# 生产模式: ~/.drsai-prod
$DrsaiHome = if ($IsProductionLaunch) {
    Join-Path $env:USERPROFILE ".drsai-prod"
} else {
    Join-Path $env:USERPROFILE ".drsai-dev"
}

# 端口
# Workbench (默认): 28643
# Legacy:           28642
# 生产:             18642
```

### 3.2 三步启动流程

#### Step 1: 后端安装

```powershell
# 调用 install.ps1 安装后端到 ~/.drsai-dev/drsai-agent
& $InstallScript -DevSource $RepoRoot -DrsaiHome $DrsaiHome -SkipSetup

# install.ps1 做的事:
# 1. 创建 venv: ~/.drsai-dev/drsai-agent/cores/python/.venv
# 2. pip install -e cores/python/packages/drsai (editable 模式)
# 3. 写入 drsai.cmd 包装器
# 4. 安装 playwright 浏览器
```

**验证函数 `Test-DeveloperBackendReady`** 检查：
- `venv\Scripts\python.exe` 存在
- `drsai.cmd` 可执行
- `python -c "import drsai; import playwright"` 成功

验证戳记写入 `~/.drsai-dev/cache/desktop-dev/backend-validation.txt`，避免重复安装。

#### Step 2: Gateway 启动

**Workbench 模式**（默认）：
- Electron 主进程通过 `gateway.ts` 的 `startGateway()` 自行启动 `desktop_gateway`
- 端口 28643
- `-HotLoad` 参数在此模式下会被拒绝并报错

**Legacy 模式 + HotLoad**：
- `watch-gateway.ps1` 启动并监听 Python 源文件变更
- 端口 28642
- 变更时自动重启 uvicorn 进程

#### Step 3: 前端启动

```powershell
# 1. npm install（如需要且未跳过）
if (-not $SkipNpmInstall) {
    npm install --workspace opendrsai-windows-desktop
}

# 2. 修复原生绑定
# - Tailwind CSS 原生 Node 绑定
# - Electron 二进制文件

# 3. 启动 Electron Dev
node scripts/run-dev-with-filter.mjs
# → npm run dev
# → node scripts/run-branded-electron-vite.mjs dev --config electron.vite.workbench.config.ts
# → electron-vite dev
```

### 3.3 开发环境隔离

| 环境 | Home 目录 | 端口 | 用途 |
|------|-----------|------|------|
| 开发 (Dev) | `~/.drsai-dev` | 28642/28643 | 日常开发 |
| 生产 (Prod) | `~/.drsai-prod` | 18642 | 生产发布 |
| 打包 (Packaged) | `~/.drsai` | 18642 | 安装包 |

**关键隔离点**:
- 开发使用独立的 `~/.drsai-dev` 目录，不影响生产环境
- Electron 用户数据目录: `$env:OPENDRSAI_ELECTRON_USER_DATA`（开发模式独立）
- 日志目录: `~/.drsai-dev/logs/desktop-dev/`
- 缓存目录: `~/.drsai-dev/cache/desktop-dev/`

### 3.4 启动配置摘要（dev.ps1 输出示例）

```
=== DrSai Desktop Development Launch ===
  Mode:        Development
  DrSai Home:  C:\Users\26364\.drsai-dev
  Repo Root:   D:\work\projects\drsai
  Skills:      D:\work\projects\drsai\skills\skills
  Gateway Port: 28643
  Platform:    https://ai-dev.ihep.ac.cn/apiv2/v1
  Profile:     desktop-dev
  Log Dir:     C:\Users\26364\.drsai-dev\logs\desktop-dev
  Cache Dir:   C:\Users\26364\.drsai-dev\cache\desktop-dev
```

---

## 4. 环境变量配置全览

### 4.1 dev.ps1 设置的核心环境变量

以下环境变量由 `dev.ps1` 在启动 Electron 前注入到子进程环境中：

#### 路径与目录

| 变量 | 值 (Dev) | 说明 |
|------|----------|------|
| `DRSAI_HOME` | `~/.drsai-dev` | DrSai 数据根目录 |
| `OPENDRSAI_LAUNCH_HOME` | `~/.drsai-dev` | 启动时的 Home |
| `OPENDRSAI_DEV_HOME` | `~/.drsai-dev` | 开发专用 Home |
| `DRSAI_REPO` | `D:\work\projects\drsai` | 仓库根目录 |
| `OPENDRSAI_RUNTIME_ROOT` | `~/.drsai-dev/runtime` | Runtime 根目录 |
| `OPENDRSAI_ELECTRON_USER_DATA` | `~/.drsai-dev/electron-userdata` | Electron 用户数据目录 |
| `DRSAI_DESKTOP_GATEWAY_HOME` | `~/.drsai-workbench` | Workbench Gateway Home |

#### 端口与网关

| 变量 | 值 (Dev) | 说明 |
|------|----------|------|
| `DRSAI_DESKTOP_GATEWAY_PORT` | `28643` | Workbench 网关端口 |
| `OPENDRSAI_LAUNCH_GATEWAY_PORT` | `28643` | 启动端口 |
| `OPENDRSAI_DEV_GATEWAY_PORT` | `28643` | 开发端口 |
| `OPENDRSAI_GATEWAY_STARTUP` | `eager` / `on-demand` | Gateway 启动策略 |
| `OPENDRSAI_RUNTIME_PERSIST` | `0` | 运行时持久化（开发关闭） |

#### 标识与模式

| 变量 | 值 (Dev) | 说明 |
|------|----------|------|
| `OPENDRSAI_DESKTOP_DEV` | `1` | 标记为开发模式 |
| `OPENDRSAI_DESKTOP_LAUNCH_MODE` | `Development` | 启动模式标识 |
| `SYSTEM_SKILLS_DIR` | `$RepoRoot\skills\skills` | 内置 Skills 目录 |

#### 平台与认证

| 变量 | 值 (Dev) | 说明 |
|------|----------|------|
| `OPENDRSAI_PLATFORM_BASE_URL` | `https://ai-dev.ihep.ac.cn` | 开发平台地址 |
| `OPENDRSAI_PLATFORM_API_BASE_URL` | `https://ai-dev.ihep.ac.cn/apiv2/v1` | API 地址 |
| `OPENDRSAI_MODEL_BASE_URL` | `https://ai-dev.ihep.ac.cn/apiv2/v1` | 模型地址 |
| `OPENDRSAI_OIDC_ONLY` | `1` | 仅 OIDC 登录 |
| `OPENDRSAI_ENABLE_DUPLEX_VOICE` | `1` | 双工语音（仅开发） |

#### 被清除的变量

`dev.ps1` 会主动从环境中删除以下变量，防止开发时误用生产凭证：

- `HEPAI_API_KEY`
- `OPENAI_API_KEY`
- `OPENAI_ADMIN_KEY`

### 4.2 `.env.example` 配置

**路径**: `D:\work\projects\drsai\.env.example`

`.env.example` 是后端 Python 的配置模板，关键字段：

```ini
# 上下文记忆类型
DRSAI_CONTEXT_TYPE="sqlite"          # sqlite (默认) 或 ragflow

# 开发模式
SERVICE_MODE="DEV"

# 本地开发账号 (DEV 模式自动创建)
# DRSAI_UI_DEFAULT_ADMIN_USER="admin"
# DRSAI_UI_DEFAULT_ADMIN_PASSWORD="admin123456"

# RAGFlow 知识库 (可选)
RAGFLOW_URL="https://ragflow.ihep.ac.cn"
RAGFLOW_TOKEN="ragflow-***"
MEMORY_DATASET_ID="***"

# GFS 文件系统集成 (可选)
# DRSAI_GFS_ENABLED=true
# DRSAI_GFS_MODE=personal
```

### 4.3 `developmentLaunchEnvironment.ts` — 开发/生产环境解析

**路径**: `apps/desktop/windows/src/main/developmentLaunchEnvironment.ts`

此文件在 Electron 主进程启动时解析环境：

```typescript
resolveDevelopmentLaunchEnvironment() {
  // 开发模式
  home: "~/.drsai-dev"
  port: 28642 (legacy) | 28643 (workbench)
  
  // 生产模式
  home: "~/.drsai-prod"
  port: 18642
  
  // 设置的变量与 dev.ps1 一致，作为 Electron 进程内部的兜底
}
```

### 4.4 Gateway 实例令牌

**路径**: `~/.drsai-dev/runtime/instance-token`

- Loopback 认证令牌，Gateway 启动时生成
- Electron 通过 HTTP header 携带此令牌访问 Gateway
- 每次 Gateway 重启会重新生成

### 4.5 `paths.ts` — 路径常量

**路径**: `apps/desktop/shared/main/paths.ts`

| 常量 | 值 | 说明 |
|------|-----|------|
| `DRSAI_HOME` | `$env:DRSAI_HOME` | 数据根目录 |
| `DRSAI_REPO` | `$env:DRSAI_REPO` | 仓库路径 |
| `DRSAI_VENV` | `$DRSAI_HOME/drsai-agent/cores/python/.venv` | Python venv |
| `DRSAI_PYTHON` | `$DRSAI_VENV/Scripts/python.exe` | Python 可执行文件 |
| `DRSAI_SCRIPT` | `$DRSAI_HOME/drsai-agent/drsai.cmd` | drsai 包装器 |
| `DRSAI_ENV_FILE` | `$DRSAI_HOME/.env` | 环境文件 |
| `DRSAI_CONFIG_FILE` | `$DRSAI_HOME/config.toml` | 配置文件 |

---

## 5. 双前端模式：Workbench vs Legacy

### 5.1 模式对比

| 特性 | Workbench (默认) | Legacy |
|------|-------------------|--------|
| 端口 | 28643 | 28642 |
| Gateway 模块 | `desktop_gateway` | `drsai.backend.gateway` |
| Gateway 启动者 | Electron 主进程 | dev.ps1 / watch-gateway.ps1 |
| Vite 配置 | `electron.vite.workbench.config.ts` | `electron.vite.config.ts` |
| Python 热重载 | 不支持 (-HotLoad 被拒) | 支持 (watch-gateway.ps1) |
| npm script | `dev:workbench` | `dev:legacy` |

### 5.2 package.json 脚本

**根 `apps/desktop/package.json`**:
```json
{
  "dev": "npm run dev --workspace opendrsai-windows-desktop",
  "dev:workbench": "...",
  "dev:legacy": "..."
}
```

**`apps/desktop/windows/package.json`**:
```json
{
  "dev": "set OPENDRSAI_DESKTOP_DEV=1&& node scripts/run-branded-electron-vite.mjs dev --config electron.vite.workbench.config.ts",
  "dev:legacy": "set OPENDRSAI_DESKTOP_DEV=1&& node scripts/run-branded-electron-vite.mjs dev",
  "dev:bootstrap": "...",
  "dev:install": "...",
  "dev:repair": "..."
}
```

### 5.3 `run-branded-electron-vite.mjs`

**路径**: `apps/desktop/windows/scripts/run-branded-electron-vite.mjs`

此脚本：
1. 对 Electron 开发运行时进行品牌化处理（通过 rcedit 设置图标等）
2. 定位 `electron-vite` 的 bin 文件
3. spawn `node electron-vite.js dev [args]`
4. 透传额外参数

### 5.4 切换到 Legacy 模式

```powershell
# 方式1: 直接用 dev.ps1 参数
.\windows-desktop-dev.cmd -GatewayPort 28642 -HotLoad

# 方式2: 直接 npm
cd apps\desktop\windows
set OPENDRSAI_DESKTOP_DEV=1
node scripts\run-branded-electron-vite.mjs dev
```

> ⚠️ **注意**: `-HotLoad` 仅在 Legacy 模式（端口 28642）下有效。Workbench 模式下传 `-HotLoad` 会触发错误：
> ```
> -HotLoad is only valid for the legacy gateway (port 28642).
> ```

---

## 6. 热重载机制

### 6.1 前端热重载 (TypeScript/React)

**技术**: Vite HMR (Hot Module Replacement)

**配置文件**: `electron.vite.workbench.config.ts` / `electron.vite.config.ts`

**工作流**:
1. `electron-vite dev` 启动 Vite Dev Server
2. 监听源文件变更（`.ts`, `.tsx`, `.css` 等）
3. 变更时通过 WebSocket 推送 HMR 更新到 Electron Renderer
4. Electron Main 进程变更时自动重启 Electron

**关键**: `electron-vite` 集成了三个 Vite 实例：
- **Main**: Electron 主进程代码 (`src/main/`)
- **Preload**: 预加载脚本 (`src/preload/`)
- **Renderer**: React UI (`src/renderer/`)

### 6.2 Python 后端热重载 (仅 Legacy)

**脚本**: `apps/desktop/windows/scripts/watch-gateway.ps1`

**为什么不用 `uvicorn --reload`?**

Windows 上 `asyncio.SelectorEventLoop` 与子进程后端不兼容。`uvicorn --reload` 使用的文件监听器在 Windows 上会导致子进程管理的 Agent 后端崩溃。因此 DrSai 实现了自定义的 `watch-gateway.ps1` 替代方案。

**工作原理**:

```
watch-gateway.ps1
    │
    ├── 指纹计算: 文件数量 + 最新 LastWriteTimeUtc
    │   监听目录: cores/python/packages/drsai/src/drsai/
    │   轮询间隔: 750ms
    │
    ├── 检测到变更 → Kill 子进程 → 重启
    │   启动命令: python -m uvicorn drsai.backend.gateway:app
    │             --host 127.0.0.1 --port $Port
    │   每次重启注入:
    │   - PYTHONPATH = 源码根目录
    │   - OPENDRSAI_GATEWAY_INSTANCE_TOKEN
    │
    └── 子进程意外退出 → 自动重启
```

### 6.3 启用 Python 热重载

```powershell
# 仅 Legacy 模式
.\windows-desktop-dev.cmd -GatewayPort 28642 -HotLoad
```

### 6.4 热重载对照表

| 层级 | 技术 | 文件类型 | 自动重启 | 配置 |
|------|------|----------|----------|------|
| React UI | Vite HMR | .tsx/.ts/.css | 部分（组件级） | electron.vite.*.config.ts |
| Electron Main | electron-vite | .ts (main) | 全重启 | electron.vite.*.config.ts |
| Preload | electron-vite | .ts (preload) | 全重启 | electron.vite.*.config.ts |
| Python Gateway | watch-gateway.ps1 | .py | Gateway 全重启 | 仅 Legacy + -HotLoad |
| Python Agent | 继承 Gateway | .py | 随 Gateway 重启 | 同上 |

---

## 7. Gateway 启动与调试

### 7.1 Electron 内启动 (Workbench)

**代码**: `apps/desktop/shared/main/gateway.ts`

```typescript
// gateway.ts 关键函数
function startGateway(): Promise<GatewayHandle> { ... }    // line 182
function startGatewayOnce(): Promise<GatewayHandle> { ... } // line 434

// 启动命令
// python -m drsai.backend.gateway (或 desktop_gateway)
// 等价于 spawn('python', ['-m', 'drsai.backend.gateway', ...])

// 健康检查
// GET http://127.0.0.1:PORT/health
// Header: Authorization: Bearer <instance-token>
```

**Gateway Base URL**:
```
GATEWAY_BASE_URL = http://${GATEWAY_HOST}:${GATEWAY_PORT}
// 通常: http://127.0.0.1:28643
```

### 7.2 Gateway 启动策略

`OPENDRSAI_GATEWAY_STARTUP` 控制启动时机：

| 值 | 行为 |
|----|------|
| `eager` | Electron 启动时立即启动 Gateway |
| `on-demand` | 首次需要时才启动 Gateway |

### 7.3 Gateway 健康检查

```powershell
# 获取实例令牌
$token = Get-Content "$env:USERPROFILE\.drsai-dev\runtime\instance-token"

# 健康检查
curl http://127.0.0.1:28643/health -H "Authorization: Bearer $token"
```

### 7.4 Gateway 日志

```
~/.drsai-dev/logs/desktop-dev/
├── gateway.log          # Gateway 主日志
├── gateway-stderr.log   # 标准错误
└── gateway-stdout.log   # 标准输出
```

---

## 8. 调试方法大全

### 8.1 Electron DevTools (前端调试)

**打开方式**:
- 开发模式下 Electron 窗口自动打开 DevTools
- 或在窗口中 `Ctrl+Shift+I` / `F12`

**用途**:
- React 组件调试
- IPC 消息检查
- 网络请求监控（Renderer → Main）
- Console 日志查看

### 8.2 VS Code 调试（全栈断点）

#### 方法 A: 调试 Electron Main + Renderer

创建 `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Electron: Main",
      "type": "node",
      "request": "launch",
      "runtimeExecutable": "${workspaceFolder}/apps/desktop/windows/node_modules/.bin/electron",
      "cwd": "${workspaceFolder}/apps/desktop/windows",
      "args": ["."],
      "env": {
        "OPENDRSAI_DESKTOP_DEV": "1",
        "DRSAI_HOME": "C:\\Users\\26364\\.drsai-dev",
        "DRSAI_REPO": "${workspaceFolder}",
        "DRSAI_DESKTOP_GATEWAY_PORT": "28643"
      },
      "sourceMaps": true,
      "outFiles": ["${workspaceFolder}/apps/desktop/windows/out/**/*.js"]
    },
    {
      "name": "Electron: Renderer (Attach)",
      "type": "chrome",
      "request": "attach",
      "port": 9222,
      "urlFilter": "http://localhost:*",
      "webRoot": "${workspaceFolder}/apps/desktop/windows/src/renderer"
    }
  ]
}
```

#### 方法 B: 调试 Python Gateway

创建 Python 调试配置：

```json
{
  "name": "Python: Gateway",
  "type": "debugpy",
  "request": "launch",
  "module": "uvicorn",
  "args": [
    "drsai.backend.gateway:app",
    "--host", "127.0.0.1",
    "--port", "28643"
  ],
  "env": {
    "DRSAI_HOME": "C:\\Users\\26364\\.drsai-dev",
    "PYTHONPATH": "${workspaceFolder}/cores/python/packages/drsai/src",
    "OPENDRSAI_DESKTOP_DEV": "1"
  },
  "python": "C:\\Users\\26364\\.drsai-dev\\drsai-agent\\cores\\python\\.venv\\Scripts\\python.exe",
  "justMyCode": false
}
```

#### 方法 C: 附加到运行中的 Gateway

```json
{
  "name": "Python: Attach to Gateway",
  "type": "debugpy",
  "request": "attach",
  "host": "127.0.0.1",
  "port": 5678,
  "pathMappings": [
    {
      "localRoot": "${workspaceFolder}/cores/python/packages/drsai/src",
      "remoteRoot": "${workspaceFolder}/cores/python/packages/drsai/src"
    }
  ]
}
```

需要在 Gateway 启动时添加 `--reload` 不适用的参数，改用：
```powershell
python -m debugpy --listen 5678 --wait-for-client -m uvicorn drsai.backend.gateway:app --port 28643
```

### 8.3 SSE 流调试

**查看 SSE 事件流**:

在 Electron DevTools 的 Network 标签中：
1. 找到 `POST /v1/chat/completions` 请求
2. 查看 EventStream 标签
3. 每条 SSE 帧的解析逻辑在 `apps/desktop/shared/main/sseParser.ts`:
   - `parseCompletionSseFrame()` (line 234)
   - `parseAgentLogSseFrame()` (line 266)

**手动测试 SSE**:

```powershell
$token = Get-Content "$env:USERPROFILE\.drsai-dev\runtime\instance-token"

# 发送测试请求
$body = @{
    model = "drsai"
    messages = @(@{ role = "user"; content = "Hello" })
    stream = $true
} | ConvertTo-Json

Invoke-WebRequest -Uri "http://127.0.0.1:28643/v1/chat/completions" `
    -Method Post `
    -Headers @{ "Authorization" = "Bearer $token"; "Accept" = "text/event-stream" } `
    -Body $body `
    -ContentType "application/json"
```

### 8.4 日志查看

#### 前端日志

```
~/.drsai-dev/logs/desktop-dev/
```

主要文件：
- `gateway.log` — Gateway 启动与运行日志
- `electron.log` — Electron 主进程日志
- `chat-*.log` — 聊天会话日志

实时查看：
```powershell
# 实时跟踪 Gateway 日志
Get-Content "$env:USERPROFILE\.drsai-dev\logs\desktop-dev\gateway.log" -Wait -Tail 50

# 实时跟踪 Electron 日志
Get-Content "$env:USERPROFILE\.drsai-dev\logs\desktop-dev\electron.log" -Wait -Tail 50
```

#### 后端日志

```powershell
# Python 日志
Get-Content "$env:USERPROFILE\.drsai-dev\logs\desktop-dev\gateway-stdout.log" -Wait -Tail 50
Get-Content "$env:USERPROFILE\.drsai-dev\logs\desktop-dev\gateway-stderr.log" -Wait -Tail 50
```

### 8.5 环境变量验证

```powershell
# 检查关键环境变量
$envVars = @(
    "DRSAI_HOME",
    "DRSAI_REPO",
    "OPENDRSAI_DESKTOP_DEV",
    "DRSAI_DESKTOP_GATEWAY_PORT",
    "OPENDRSAI_PLATFORM_BASE_URL",
    "OPENDRSAI_RUNTIME_ROOT",
    "SYSTEM_SKILLS_DIR"
)

foreach ($var in $envVars) {
    $val = [Environment]::GetEnvironmentVariable($var, "Process")
    Write-Host "$var = $val" -ForegroundColor Cyan
}
```

### 8.6 后端验证

```powershell
# 检查后端安装戳记
$stamp = "$env:USERPROFILE\.drsai-dev\cache\desktop-dev\backend-validation.txt"
if (Test-Path $stamp) { Get-Content $stamp }

# 检查 venv
$python = "$env:USERPROFILE\.drsai-dev\drsai-agent\cores\python\.venv\Scripts\python.exe"
if (Test-Path $python) {
    & $python -c "import drsai; print(drsai.__file__)"
    & $python -c "import playwright; print('playwright OK')"
}

# 检查 drsai.cmd
$drsaiCmd = "$env:USERPROFILE\.drsai-dev\drsai-agent\drsai.cmd"
if (Test-Path $drsaiCmd) { Write-Host "drsai.cmd found" }
```

### 8.7 IPC 通信调试

在 Electron DevTools Console 中：

```javascript
// 监听所有 IPC 事件
const { ipcRenderer } = require('electron');
ipcRenderer.on('desktop:chat-event', (event, data) => {
    console.log('[IPC] chat-event:', data);
});

// 检查 preload 暴露的 API
console.log('Desktop API:', window.desktopAPI);
```

### 8.8 调试检查清单

| 检查项 | 命令/方法 | 期望结果 |
|--------|----------|----------|
| Python venv | `Test-Path ~/.drsai-dev/drsai-agent/cores/python/.venv/Scripts/python.exe` | `True` |
| drsai.cmd | `Test-Path ~/.drsai-dev/drsai-agent/drsai.cmd` | `True` |
| import drsai | `& $python -c "import drsai"` | 无报错 |
| Skills 目录 | `Test-Path $RepoRoot\skills\skills` | `True` |
| Gateway 健康 | `curl http://127.0.0.1:28643/health` | `200 OK` |
| 实例令牌 | `Test-Path ~/.drsai-dev/runtime/instance-token` | `True` |
| 日志目录 | `Test-Path ~/.drsai-dev/logs/desktop-dev` | `True` |
| npm 依赖 | `Test-Path apps/desktop/windows/node_modules` | `True` |
| Electron 二进制 | `Test-Path apps/desktop/windows/node_modules/.bin/electron` | `True` |

---

## 9. 常见问题排查

### 9.1 后端安装失败

**症状**: `Test-DeveloperBackendReady` 验证失败

**排查**:

```powershell
# 1. 检查 Python 版本 (需要 3.10+)
python --version

# 2. 手动重新安装
.\windows-desktop-dev.cmd -ForceInstall

# 3. 检查 pip 镜像
.\windows-desktop-dev.cmd -PipIndexUrl "https://pypi.tuna.tsinghua.edu.cn/simple"

# 4. 检查 venv
$venv = "$env:USERPROFILE\.drsai-dev\drsai-agent\cores\python\.venv"
if (Test-Path $venv) { Write-Host "venv exists" }
else { Write-Host "venv missing — need install" -ForegroundColor Red }
```

### 9.2 Gateway 无法启动

**症状**: Electron 报 Gateway 健康检查失败

**排查**:

```powershell
# 1. 检查端口占用
netstat -ano | findstr "28643"

# 2. 手动启动 Gateway 测试
$python = "$env:USERPROFILE\.drsai-dev\drsai-agent\cores\python\.venv\Scripts\python.exe"
$env:PYTHONPATH = "D:\work\projects\drsai\cores\python\packages\drsai\src"
$env:DRSAI_HOME = "$env:USERPROFILE\.drsai-dev"
& $python -m uvicorn drsai.backend.gateway:app --host 127.0.0.1 --port 28643

# 3. 检查实例令牌
$tokenFile = "$env:USERPROFILE\.drsai-dev\runtime\instance-token"
if (Test-Path $tokenFile) { Get-Content $tokenFile }
else { Write-Host "Token file missing — Gateway not started?" -ForegroundColor Red }
```

### 9.3 前端构建错误

**症状**: electron-vite 构建失败

**排查**:

```powershell
# 1. 清理 node_modules
Remove-Item -Recurse -Force apps\desktop\windows\node_modules
npm install --workspace opendrsai-windows-desktop

# 2. 修复原生绑定
cd apps\desktop\windows
npm run dev:repair

# 3. 检查 Tailwind 原生绑定
# dev.ps1 会在启动前自动修复
```

### 9.4 -HotLoad 报错

**症状**: 
```
-HotLoad is only valid for the legacy gateway (port 28642).
```

**原因**: Workbench 模式（端口 28643）不支持 Python 热重载。

**解决**:
```powershell
# 切换到 Legacy 模式
.\windows-desktop-dev.cmd -GatewayPort 28642 -HotLoad
```

### 9.5 SSE 连接断开

**症状**: 聊天响应中断或无响应

**排查**:
1. 检查 Gateway 是否仍在运行（任务管理器中查找 python 进程）
2. 检查 Gateway 日志是否有异常
3. 在 DevTools Network 中检查 SSE 连接状态
4. 检查 `instance-token` 是否已更新（Gateway 重启后需要新令牌）

### 9.6 libpng 警告刷屏

**症状**: 控制台大量 libpng 警告

**解决**:
```powershell
# 默认已过滤，如需查看
.\windows-desktop-dev.cmd -ShowLibPngWarnings
```

`run-dev-with-filter.mjs` 默认会过滤已知的 libpng 警告。

### 9.7 Skills 目录缺失

**症状**: 
```
Cannot find the built-in Skills directory: D:\work\projects\drsai\skills\skills
```

**解决**:
```powershell
# 确认 skills 目录存在
Test-Path "D:\work\projects\drsai\skills\skills"

# 如果是 monorepo 子模块，确保已初始化
git submodule update --init --recursive
```

### 9.8 开发环境清理重置

```powershell
# ⚠️ 警告: 这会删除所有开发数据
# 完全重置开发环境
Remove-Item -Recurse -Force "$env:USERPROFILE\.drsai-dev"

# 重新启动会自动重新安装
.\windows-desktop-dev.cmd -ForceInstall
```

---

## 10. 快速启动速查

### 10.1 首次启动

```powershell
# 从仓库根目录
cd D:\work\projects\drsai

# 首次启动（会自动安装后端 + 前端依赖）
.\apps\desktop\windows-desktop-dev.cmd

# 如需指定 pip 镜像
.\apps\desktop\windows-desktop-dev.cmd -PipIndexUrl "https://pypi.tuna.tsinghua.edu.cn/simple"
```

### 10.2 日常开发启动

```powershell
# 最常用：Workbench 模式
.\apps\desktop\windows-desktop-dev.cmd

# Legacy + Python 热重载
.\apps\desktop\windows-desktop-dev.cmd -GatewayPort 28642 -HotLoad

# 仅安装不启动
.\apps\desktop\windows-desktop-dev.cmd -InstallOnly

# 强制重新安装后端
.\apps\desktop\windows-desktop-dev.cmd -ForceInstall

# 跳过 npm install
.\apps\desktop\windows-desktop-dev.cmd -SkipNpmInstall

# 仅安装前置依赖
.\apps\desktop\windows-desktop-dev.cmd -InstallPrerequisites
```

### 10.3 单独调试各层

```powershell
# --- 仅调试 Python Gateway ---

# 设置环境
$env:DRSAI_HOME = "$env:USERPROFILE\.drsai-dev"
$env:PYTHONPATH = "D:\work\projects\drsai\cores\python\packages\drsai\src"
$env:SYSTEM_SKILLS_DIR = "D:\work\projects\drsai\skills\skills"
$python = "$env:DRSAI_HOME\drsai-agent\cores\python\.venv\Scripts\python.exe"

# 启动 Gateway
& $python -m uvicorn drsai.backend.gateway:app --host 127.0.0.1 --port 28643

# --- 仅调试 Electron 前端 (Gateway 已运行) ---

cd D:\work\projects\drsai\apps\desktop\windows
set OPENDRSAI_DESKTOP_DEV=1
set DRSAI_HOME=%USERPROFILE%\.drsai-dev
set DRSAI_REPO=D:\work\projects\drsai
set DRSAI_DESKTOP_GATEWAY_PORT=28643
node scripts\run-branded-electron-vite.mjs dev --config electron.vite.workbench.config.ts

# --- 仅调试 npm 构建 ---

cd D:\work\projects\drsai\apps\desktop\windows
npm run dev:workbench
```

### 10.4 调试快捷命令

```powershell
# 查看 Gateway 日志（实时）
Get-Content "$env:USERPROFILE\.drsai-dev\logs\desktop-dev\gateway.log" -Wait -Tail 50

# 查看 Electron 日志（实时）
Get-Content "$env:USERPROFILE\.drsai-dev\logs\desktop-dev\electron.log" -Wait -Tail 50

# 检查 Gateway 健康
$token = Get-Content "$env:USERPROFILE\.drsai-dev\runtime\instance-token"
Invoke-RestMethod "http://127.0.0.1:28643/health" -Headers @{ "Authorization" = "Bearer $token" }

# 检查端口占用
netstat -ano | findstr "28643"

# 列出所有 DrSai 相关进程
Get-Process python, electron -ErrorAction SilentlyContinue | Format-Table Id, ProcessName, StartTime
```

---

## 附录 A: 完整文件索引

| 文件 | 路径 | 说明 |
|------|------|------|
| 入口脚本 | `apps/desktop/windows-desktop-dev.cmd` | 批处理包装器 |
| 核心脚本 | `apps/desktop/windows/scripts/dev.ps1` | 966 行启动编排 |
| 安装脚本 | `scripts/install.ps1` | 后端 venv + pip install |
| 热重载 | `apps/desktop/windows/scripts/watch-gateway.ps1` | Python 源码热重载 |
| 前端过滤 | `apps/desktop/windows/scripts/run-dev-with-filter.mjs` | libpng 警告过滤 |
| 品牌化启动 | `apps/desktop/windows/scripts/run-branded-electron-vite.mjs` | Electron 品牌化 + Vite |
| 环境解析 | `apps/desktop/windows/src/main/developmentLaunchEnvironment.ts` | 开发/生产环境解析 |
| Gateway 启动 | `apps/desktop/shared/main/gateway.ts` | Electron 内 Gateway spawn |
| 路径常量 | `apps/desktop/shared/main/paths.ts` | DRSAI_HOME/REPO/VENV 等 |
| Runtime 客户端 | `apps/desktop/shared/main/runtimeClient.ts` | HTTP 客户端 |
| 聊天逻辑 | `apps/desktop/shared/main/chat.ts` | SSE 解析与事件分发 |
| SSE 解析 | `apps/desktop/shared/main/sseParser.ts` | SSE 帧解析 |
| Vite 配置 (Workbench) | `apps/desktop/windows/electron.vite.workbench.config.ts` | Workbench Vite 配置 |
| Vite 配置 (Legacy) | `apps/desktop/windows/electron.vite.config.ts` | Legacy Vite 配置 |
| .env 模板 | `.env.example` | 后端环境配置模板 |

## 附录 B: 端口一览

| 端口 | 用途 | 模式 |
|------|------|------|
| 28643 | Workbench Gateway | 开发 (默认) |
| 28642 | Legacy Gateway | 开发 |
| 18642 | Gateway | 生产 |
| 9222 | Chrome DevTools Attach | 调试 |
| 5678 | debugpy (Python Attach) | 调试 |

## 附录 C: 目录结构

```
~/.drsai-dev/                           # 开发环境根目录
├── drsai-agent/                        # 后端安装
│   ├── cores/python/.venv/             # Python 虚拟环境
│   ├── cores/python/packages/drsai/    # drsai 源码 (editable)
│   └── drsai.cmd                        # 命令包装器
├── runtime/                            # 运行时数据
│   └── instance-token                  # Gateway 实例令牌
├── logs/
│   └── desktop-dev/                    # 开发日志
│       ├── gateway.log
│       ├── gateway-stdout.log
│       └── gateway-stderr.log
├── cache/
│   └── desktop-dev/                    # 开发缓存
│       ├── backend-validation.txt      # 后端验证戳记
│       └── frontend-validation.txt     # 前端验证戳记
└── electron-userdata/                  # Electron 用户数据
```

---

> **相关文档**:
> - [Desktop 前后端逻辑](./desktop-frontend-backend-logic.md) — 三进程模型、数据流、设计模式
> - [Desktop 到 Agent 架构](../../architecture-desktop-to-agent.md) — 四层架构与通信路径
> - [Runtime 分析](../../runtime-analysis.md) — Runtime 中间件角色分析
