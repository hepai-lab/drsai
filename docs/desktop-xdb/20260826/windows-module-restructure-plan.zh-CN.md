# Windows 模块重构方案（复制重建策略）

> 日期：2026-08-26（更新于同日）
> 策略变更：从"原地删减 legacy"改为"复制参考 + 重建全新 `apps/desktop`"
> 目标：按照 `v2-minimal-surface.zh-CN.md` 前端规范，从 `apps/desktop_legacy` 中选取需要的文件，
> 构建一个干净的 `apps/desktop` 目录，不包含任何 legacy 代码。

---

## 一、策略说明

### 1.1 旧策略 vs 新策略

| 维度 | 旧策略（原地删减） | 新策略（复制重建） |
|------|---------------------|---------------------|
| 操作方式 | 在 `apps/desktop` 中逐批删除 legacy 文件 | 从 `apps/desktop_legacy` 中选择性复制到新 `apps/desktop` |
| 风险 | 分批删除时 import 断裂，typecheck 雪崩 | 新目录零 legacy 依赖，干净构建 |
| 回退 | 难以回退（已删除） | `desktop_legacy` 始终保留作为参考 |
| 完成度 | 需要多轮删除 + 修复 | 一次性构建，逐文件验证 |

### 1.2 已完成

- ✅ `apps/desktop` 已完整复制到 `apps/desktop_legacy`（27,906 个文件）

### 1.3 V2 规范要求（来自 v2-minimal-surface.zh-CN.md）

| 维度 | 数量 | 说明 |
|------|------|------|
| 后端路由 | 17 条 | 6 个文件（runtime, workspaces, sessions, runs, models, audio） |
| IPC 方法 | 19 个 + 1 事件通道 | `contextBridge.exposeInMainWorld("drsaai", ...)` |
| 用户功能 | 11 项 | 会话管理、消息收发、模型选择、文件读写、语音输入/输出 |
| 铁律 | 3 条 | 渲染层不发起网络请求、不处理 token、单一状态源 |
| 渲染层架构 | features/ + store/ | 快照 + 事件 reducer 模式 |

---

## 二、目标目录结构

从 `desktop_legacy` 中选择性复制，构建以下干净结构：

```
apps/desktop/                                    ← 新建，从 desktop_legacy 选择性复制
├── windows/
│   ├── src/
│   │   ├── main/
│   │   │   ├── workbench.ts                     ← 复制 + 修改（添加 import "./auth"）
│   │   │   ├── auth.ts                          ← 复制（V2 平台壳，10 行）
│   │   │   ├── platformCredentials.ts           ← 复制（Windows safeStorage 封装）
│   │   │   ├── windowsExternalUrl.ts            ← 复制（OIDC URL 打开）
│   │   │   ├── developmentLaunchEnvironment.ts  ← 复制 + 修改（process.defaultApp 守卫）
│   │   │   └── versionInfo.ts                   ← 复制（评估后决定）
│   │   └── preload/
│   │       └── workbench.ts                     ← 复制（V2 preload，9 行）
│   ├── electron.vite.config.ts                  ← 重写（合并为单一 V2 配置）
│   ├── electron.vite.workbench.config.ts        ← 删除（合并到上面）
│   ├── package.json                             ← 复制 + 修改（删除 dev:legacy, build:legacy）
│   ├── tsconfig.node.json                       ← 复制
│   ├── tsconfig.web.json                        ← 复制
│   └── scripts/
│       ├── dev.ps1                              ← 复制 + 修改（删除 legacy 分支）
│       ├── run-branded-electron-vite.mjs        ← 复制
│       └── verify-dev-workspace-startup.mjs    ← 复制（评估）
│
├── shared/
│   ├── main/
│   │   ├── auth.ts                              ← 复制 + 修改（settings.ts 依赖链修复）
│   │   ├── paths.ts                             ← 复制（50 行，路径解析）
│   │   ├── desktopPaths.ts                      ← 复制（49 行，路径服务）
│   │   ├── desktopPathPolicy.ts                 ← 复制（50 行，路径策略）
│   │   ├── desktopRuntimeMode.ts                ← 复制（3 行，运行模式）
│   │   ├── platformConfig.ts                    ← 复制（189 行，OIDC 配置）
│   │   ├── secretRedaction.ts                  ← 复制（25 行，URL 脱敏）
│   │   ├── userIdentity.ts                      ← 复制（139 行，用户身份）
│   │   ├── authGatewayCoordination.ts          ← 复制（31 行，auth↔gateway 协调）
│   │   ├── settings.ts                          ← 复制 + 修改（拆分：去掉 gateway.ts 依赖）
│   │   ├── desktopGateway/                      ← 复制整个目录（V2 桥接层）
│   │   │   ├── index.ts                         ←   createDesktopSurface 组合根
│   │   │   ├── client.ts                        ←   17 操作 HTTP 客户端
│   │   │   ├── runtimeProcess.ts               ←   Python 进程管理 (端口 28643)
│   │   │   ├── identity.ts                      ←   auth session 缓存 + legacyAuthBackend
│   │   │   ├── service.ts                       ←   IPC 路由 (363 行)
│   │   │   ├── ipc.ts                           ←   ipcMain.handle 注册
│   │   │   ├── preload.ts                       ←   contextBridge 19 方法 (92 行)
│   │   │   ├── sessionStream.ts                ←   SSE 事件流 (494 行)
│   │   │   └── eventDispatcher.ts              ←   事件分发 (129 行)
│   │   ├── browser/                             ← 评估保留（urlPolicy.ts 可能被 auth 用到）
│   │   └── README.md
│   │
│   ├── api/
│   │   ├── desktopGateway.ts                    ← 复制（417 行，17 操作契约）
│   │   ├── desktopBridge.ts                     ← 复制（395 行，桥接类型）
│   │   ├── platform.ts                          ← 复制（96 行，路径类型）
│   │   ├── index.ts                             ← 复制（barrel re-export）
│   │   ├── sensitiveData.ts                     ← 复制（66 行，被 secretRedaction.ts 引用）
│   │   ├── errorEnvelope.ts                     ← 评估保留
│   │   └── README.md
│   │
│   ├── renderer/
│   │   ├── workbench.html                      ← 复制（26 行，V2 HTML 入口）
│   │   ├── package.json                         ← 复制（React 19 等依赖）
│   │   ├── tsconfig.json                        ← 复制
│   │   ├── vite.config.ts                       ← 复制（如有）
│   │   └── src/
│   │       └── workbench/                       ← 复制整个目录（V2 渲染层，~1,500 行）
│   │           ├── App.tsx                      ←   V2 主组件
│   │           ├── main.tsx                     ←   V2 入口 + 修改（添加 Error Boundary）
│   │           ├── bridge.ts                    ←   IPC 桥接
│   │           ├── useDesktop.ts                ←   桌面 hook
│   │           ├── useSessionStream.ts          ←   会话流 hook
│   │           ├── transcript.ts                ←   消息格式化
│   │           ├── styles.css                   ←   样式
│   │           └── components/
│   │               ├── Transcript.tsx            ←   消息列表
│   │               ├── Composer.tsx             ←   输入框
│   │               ├── Sidebar.tsx              ←   会话列表
│   │               └── FilePane.tsx             ←   文件面板
│   │
│   └── test-kit/
│       ├── verify-desktop-surface.mts           ← 复制
│       └── run-typescript-test.mjs              ← 复制
│
└── docs/v2/                                     ← 复制（设计文档）
```

### 不复制的文件（留在 desktop_legacy 中作参考）

| 区域 | 不复制的文件 | 原因 |
|------|-------------|------|
| `windows/src/main/` | index.ts (6,981 行), e2eSmoke.ts (14,918 行), bootstrap.ts, backgroundTasks.ts, remoteWorkspace.ts, scheduledTasks.ts, workflowRuns.ts, workflowMarketplace.ts, terminal.ts, updates.ts, forkWorktrees.ts, projectSkills.ts, threadShare.ts, portForwardRegistry.ts, status.ts, install.ts, projectMemory.ts, customCommands.ts, windowState.ts, skills.ts, teamMemory.ts, gfs.ts, threadArchive.ts, remoteGatewayClient.generated.ts, runtimeReliability.ts, desktopApprovalState.ts, systemVoiceTts.ts, voicePreferences.ts, 及 ~50 个 re-export 桩 | legacy V1 功能，V2 不需要 |
| `windows/src/preload/` | index.ts (2 行, legacy) | V2 用 workbench.ts |
| `shared/main/` | preload.ts (1,498 行), runtimeClient.ts (1,758 行), oaepSessionStream.ts (674 行), chat.ts (3,321 行), gateway.ts (970 行), boundedEventDispatcher.ts (52 行), channelAdapters.ts (37,850 行!), gatewayEnvironment.ts (39 行), 及其余 ~150 个 legacy 文件 | V2 桥接层已取代 |
| `shared/renderer/src/` | App.tsx (6,688 行), index.html, mockDesktopApi.ts (7,051 行), components/, adapters/, containers/, auth/, assets/, fonts/, voice/, 及其余 ~180 个 legacy 文件 | V2 workbench/ 已取代 |
| `shared/api/` | desktopApi.ts (5,656 行), structuredConversation.ts, threadShareHtml.ts, owop.generated.ts, diagnostics.ts, runExperiment.ts, 及其余 ~28 个 legacy API 文件 | V2 desktopGateway.ts + desktopBridge.ts 已取代 |

---

## 三、文件修改方案（关键文件逐个分析）

### 3.1 workbench.ts — 复制 + 修改

**来源**: `desktop_legacy/windows/src/main/workbench.ts` (112 行)
**问题**: 缺少 `import "./auth"` 导致 OIDC 登录失败
**修改**:

```diff
  import "./developmentLaunchEnvironment";
+ import "./auth";  // 调用 configureAuthPlatform()，初始化 credentialService + openExternalUrl
  import { createDesktopSurface } from "../../shared/main/desktopGateway";
```

**原因**: `configureAuthPlatform()` 设置 `credentialService`（Windows safeStorage 封装）和 `openExternalUrl`（浏览器打开 OIDC 回调 URL）。不调用则 `openExternalUrl` 保持抛出异常的默认 stub，OIDC 登录会失败。

### 3.2 developmentLaunchEnvironment.ts — 复制 + 修改

**来源**: `desktop_legacy/windows/src/main/developmentLaunchEnvironment.ts` (58 行)
**问题**: `if (!input.defaultApp) return {};` 守卫导致 electron-vite 直接启动时环境变量不设置
**修改**:

```diff
- if (!input.defaultApp) return {};
+ // electron-vite 不设置 process.defaultApp，改为检查 DRSAI_HOME 是否已存在
+ if (process.env.DRSAI_HOME && !input.defaultApp) return {};
+ if (!input.defaultApp && !process.env.DRSAI_HOME) {
+   // 开发模式下手动设置默认值
+   process.env.DRSAI_HOME = process.env.DRSAI_HOME || join(homedir(), ".drsai-dev");
+ }
```

**原因**: `dev.ps1` 会预设置环境变量所以能正常工作，但直接 `npm run dev` 时 electron-vite 不设置 `process.defaultApp`，导致整个环境初始化被跳过。

### 3.3 auth.ts — 复制 + 修改

**来源**: `desktop_legacy/shared/main/auth.ts` (1,484 行)
**问题**: `auth.ts` 导入 `settings.ts`，而 `settings.ts` 导入 `gateway.ts`（legacy V1 网关进程管理器，端口 28642）和 `gatewayEnvironment.ts`（legacy 端口解析），导致 V2 包中引入了 legacy 代码。
**auth.ts 的 9 个直接导入**:

| # | 导入路径 | 文件行数 | V2 处理 |
|---|---------|---------|---------|
| 1 | `"../api"` (index.ts) | ~50 | ✅ 复制 |
| 2 | `"../api/desktopApi"` | ~200+ | ⚠️ 仅复制 auth 相关类型，或改为从 desktopBridge.ts 引用 |
| 3 | `"./paths"` | 50 | ✅ 复制 |
| 4 | `"./desktopRuntimeMode"` | 3 | ✅ 复制 |
| 5 | `"./platformConfig"` | 189 | ✅ 复制 |
| 6 | `"./settings"` | 98 | ⚠️ 复制 + 修改（去掉 gateway.ts 依赖） |
| 7 | `"./secretRedaction"` | 25 | ✅ 复制 |
| 8 | `"./userIdentity"` | 139 | ✅ 复制 |
| 9 | `"./authGatewayCoordination"` | 31 | ✅ 复制 |

**传递依赖分析**:

```
auth.ts → settings.ts → gateway.ts (970 行, legacy V1 网关!) ⛔
                        → gatewayEnvironment.ts (39 行, 端口 28642) ⛔
auth.ts → secretRedaction.ts → sensitiveData.ts (66 行) ✅
auth.ts → paths.ts → desktopPaths.ts (49 行) ✅
auth.ts → platformConfig.ts → (无新依赖) ✅
auth.ts → userIdentity.ts → paths.ts (已计数) ✅
auth.ts → authGatewayCoordination.ts → (仅 type import) ✅
```

**settings.ts 修改方案**（3 选 1）:

**方案 A（推荐）: 拆分 settings.ts**
```
新建 settings.ts (V2 安全版):
  - 保留 saveApiKey() — 仅写文件，不导入 gateway.ts
  - 保留 DRSAI_ENV_FILE 常量
  
删除（不复制到新 desktop）:
  - saveApiKeyAndSync() — 含 HTTP PUT 到 legacy 网关
  - syncRunningGatewayConfig() — 向 28642 端口同步
  - putGatewayConfig() — legacy 网关配置
  - import { getGatewayRequestHeaders } from "./gateway" ⛔
  - import { resolveGatewayPort } from "./gatewayEnvironment" ⛔
```

**方案 B: 修改 auth.ts 的调用**
```diff
- import { saveApiKeyAndSync } from "./settings";
+ import { saveApiKey } from "./settings";  // 仅写文件，不同步到 legacy 网关
```
然后在 auth.ts 中将所有 `saveApiKeyAndSync()` 调用改为 `saveApiKey()`。

**方案 C: 接受传递导入**（不推荐）
`.catch(() => undefined)` 会让运行时不崩溃，但 legacy gateway.ts 会被打包进 V2 bundle。

**推荐**: 方案 A（拆分 settings.ts），最干净，完全切断 legacy 依赖链。

### 3.4 desktopGateway/ 目录 — 复制（无需修改）

整个 `desktopGateway/` 目录（9 个文件，~4,800 行）是 V2 新增代码，完全干净：

| 文件 | 行数 | 导入来源 | V2 状态 |
|------|------|---------|---------|
| `index.ts` | ~100 | 全部来自 desktopGateway/ 内部 | ✅ 干净 |
| `client.ts` | ~200 | `../../api/desktopGateway` + 内部 | ✅ 干净 |
| `runtimeProcess.ts` | ~223 | `../paths` (已复制) + `../../api/desktopGateway` | ✅ 干净 |
| `identity.ts` | ~175 | `../../api/desktopBridge` + `../auth` (已复制) | ✅ 干净 |
| `service.ts` | 363 | 内部 + `../../api/desktopBridge` | ✅ 干净 |
| `ipc.ts` | ~150 | 内部 | ✅ 干净 |
| `preload.ts` | 92 | `../../api/desktopBridge` | ✅ 干净 |
| `sessionStream.ts` | 494 | 内部 + `../../api/desktopBridge` | ✅ 干净 |
| `eventDispatcher.ts` | 129 | 内部 | ✅ 干净 |

### 3.5 renderer/src/workbench/ — 复制 + 修改

**来源**: `desktop_legacy/shared/renderer/src/workbench/` (11 个文件，~1,500 行)
**状态**: 代码完整，无 stub/TODO

**需要修改的文件**:

| 文件 | 修改内容 | 原因 |
|------|---------|------|
| `main.tsx` | 添加 React Error Boundary | 当前任何渲染时异常 = 白屏；React 19.2.1 + react-markdown 10.x 兼容性风险 |
| `App.tsx` | 评估是否需要增强 | V2 组件功能完整，但 legacy 组件有更丰富的 UI（消息渲染、文件预览等） |

**main.tsx 修改方案**:

```diff
+ class ErrorBoundary extends React.Component<{children: React.ReactNode}, {hasError: boolean; error?: Error}> {
+   state = { hasError: false, error: undefined as Error | undefined };
+   static getDerivedStateFromError(error: Error) { return { hasError: true, error }; }
+   render() {
+     if (this.state.hasError) {
+       return <div style={{padding: 40}}>
+         <h2>渲染出错</h2>
+         <pre>{this.state.error?.stack}</pre>
+       </div>;
+     }
+     return this.props.children;
+   }
+ }

  ReactDOM.createRoot(document.getElementById("root")!).render(
-   <React.StrictMode>
+   <ErrorBoundary>
+     <React.StrictMode>
        <App />
      </React.StrictMode>
+   </ErrorBoundary>
  );
```

### 3.6 desktopApi.ts 的处理 — 拆分

**来源**: `desktop_legacy/shared/api/desktopApi.ts` (5,656 行)
**问题**: auth.ts 需要其中的类型定义（`AuthSession`, `LoginRequest`, `LoginResult`, `LogoutOptions`, `OidcLoginDebugEvent`, `DesktopCredentialService` 等），但整个 5,656 行文件包含大量 legacy 类型。
**方案**: 

1. 从 `desktopApi.ts` 中提取 auth 相关类型到新文件 `shared/api/authTypes.ts`（~200 行）
2. 或者直接将 auth 相关类型合并到 `desktopBridge.ts` 中
3. 修改 auth.ts 的导入路径

```diff
- import type { AuthSession, LoginRequest, LoginResult, LogoutOptions, OidcLoginDebugEvent } from "../api/desktopApi";
+ import type { AuthSession, LoginRequest, LoginResult, LogoutOptions, OidcLoginDebugEvent } from "../api/authTypes";
```

### 3.7 browser/ 目录 — 评估保留

**来源**: `desktop_legacy/shared/main/browser/` (5 个文件，~332 行)

| 文件 | 行数 | V2 评估 |
|------|------|---------|
| `browserTaskService.ts` | 104 | ❌ V2 无浏览器任务功能 |
| `workerClient.ts` | 76 | ❌ 同上 |
| `protocol.ts` | 68 | ❌ 同上 |
| `urlPolicy.ts` | 65 | ⚠️ 评估 — 可能被 `windowsExternalUrl.ts` 或 `auth.ts` 的 URL 验证用到 |
| `actionApproval.ts` | 19 | ❌ 同上 |

**决策**: 先不复制。如果 `auth.ts` 或 `windowsExternalUrl.ts` 有编译错误指向 `browser/urlPolicy.ts`，再按需复制该单个文件。

### 3.8 electron.vite.config.ts — 重写

**来源**: `desktop_legacy/windows/electron.vite.config.ts` + `electron.vite.workbench.config.ts`
**方案**: 合并为单一 V2 配置，删除 workbench 配置文件

```typescript
// electron.vite.config.ts (重写)
import { resolve } from "path";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: { index: resolve("src/main/workbench.ts") },
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: { workbench: resolve("src/preload/workbench.ts") },
      },
    },
  },
  renderer: {
    root: resolve("../shared/renderer"),
    server: { host: "127.0.0.1", hmr: { host: "127.0.0.1" } },
    build: {
      rollupOptions: {
        input: resolve("../shared/renderer/workbench.html"),
      },
    },
    resolve: {
      alias: {
        "@renderer": resolve("../shared/renderer/src"),
        "@shared": resolve("../shared/api"),
      },
    },
    plugins: [react()],
  },
});
```

### 3.9 package.json — 复制 + 修改

**来源**: `desktop_legacy/windows/package.json`
**修改**:

```diff
  "scripts": {
-   "dev": "set OPENDRSAI_DESKTOP_DEV=1&& node scripts/run-branded-electron-vite.mjs dev --config electron.vite.workbench.config.ts",
-   "dev:workbench": "npm run dev",
-   "dev:legacy": "set OPENDRSAI_DESKTOP_DEV=1&& node scripts/run-branded-electron-vite.mjs dev",
+   "dev": "set OPENDRSAI_DESKTOP_DEV=1&& node scripts/run-branded-electron-vite.mjs dev",
-   "build:workbench": "electron-vite build --config electron.vite.workbench.config.ts",
-   "build": "node scripts/run-branded-electron-vite.mjs build",
+   "build": "electron-vite build",
  }
```

### 3.10 dev.ps1 — 复制 + 修改

**来源**: `desktop_legacy/windows/scripts/dev.ps1` (966 行)
**修改**:
- 删除 `dev:legacy` 分支和 legacy 环境变量清理逻辑
- 删除 `-HotLoad` 相关逻辑
- 保留 28643 端口和 `DRSAI_DESKTOP_GATEWAY_HOME` 设置
- 保留 Electron mirror 设置（`$env:ELECTRON_MIRROR`）

---

## 四、复制执行计划

### 步骤 1：创建目录骨架

```powershell
cd D:\work\projects\drsai\apps
# 创建新的 desktop 目录结构
$dirs = @(
  "desktop\windows\src\main",
  "desktop\windows\src\preload",
  "desktop\windows\scripts",
  "desktop\shared\main\desktopGateway",
  "desktop\shared\main\browser",
  "desktop\shared\api",
  "desktop\shared\renderer\src\workbench\components",
  "desktop\shared\test-kit",
  "desktop\docs\v2"
)
foreach ($d in $dirs) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
```

### 步骤 2：复制 Windows Shell 文件

```powershell
$src = "desktop_legacy\windows"
$dst = "desktop\windows"

# 复制修改后保留的文件
Copy-Item "$src\src\main\workbench.ts" "$dst\src\main\" -Force
Copy-Item "$src\src\main\auth.ts" "$dst\src\main\" -Force
Copy-Item "$src\src\main\platformCredentials.ts" "$dst\src\main\" -Force
Copy-Item "$src\src\main\windowsExternalUrl.ts" "$dst\src\main\" -Force
Copy-Item "$src\src\main\developmentLaunchEnvironment.ts" "$dst\src\main\" -Force
Copy-Item "$src\src\main\versionInfo.ts" "$dst\src\main\" -Force  # 评估后决定
Copy-Item "$src\src\preload\workbench.ts" "$dst\src\preload\" -Force
Copy-Item "$src\tsconfig.node.json" "$dst\" -Force
Copy-Item "$src\tsconfig.web.json" "$dst\" -Force
Copy-Item "$src\scripts\dev.ps1" "$dst\scripts\" -Force
Copy-Item "$src\scripts\run-branded-electron-vite.mjs" "$dst\scripts\" -Force
```

### 步骤 3：复制 shared/main/ 文件

```powershell
$src = "desktop_legacy\shared\main"
$dst = "desktop\shared\main"

# auth 依赖链文件（全部保留）
Copy-Item "$src\auth.ts" "$dst\" -Force
Copy-Item "$src\paths.ts" "$dst\" -Force
Copy-Item "$src\desktopPaths.ts" "$dst\" -Force
Copy-Item "$src\desktopPathPolicy.ts" "$dst\" -Force
Copy-Item "$src\desktopRuntimeMode.ts" "$dst\" -Force
Copy-Item "$src\platformConfig.ts" "$dst\" -Force
Copy-Item "$src\secretRedaction.ts" "$dst\" -Force
Copy-Item "$src\userIdentity.ts" "$dst\" -Force
Copy-Item "$src\authGatewayCoordination.ts" "$dst\" -Force
Copy-Item "$src\settings.ts" "$dst\" -Force  # 复制后需修改

# V2 桥接层（整个目录）
Copy-Item "$src\desktopGateway" "$dst\desktopGateway" -Recurse -Force
```

### 步骤 4：复制 shared/api/ 文件

```powershell
$src = "desktop_legacy\shared\api"
$dst = "desktop\shared\api"

Copy-Item "$src\desktopGateway.ts" "$dst\" -Force
Copy-Item "$src\desktopBridge.ts" "$dst\" -Force
Copy-Item "$src\platform.ts" "$dst\" -Force
Copy-Item "$src\index.ts" "$dst\" -Force
Copy-Item "$src\sensitiveData.ts" "$dst\" -Force
# 评估保留
if (Test-Path "$src\errorEnvelope.ts") { Copy-Item "$src\errorEnvelope.ts" "$dst\" -Force }
```

### 步骤 5：复制渲染层

```powershell
$src = "desktop_legacy\shared\renderer"
$dst = "desktop\shared\renderer"

Copy-Item "$src\workbench.html" "$dst\" -Force
Copy-Item "$src\package.json" "$dst\" -Force
Copy-Item "$src\tsconfig.json" "$dst\" -Force
# V2 workbench 渲染层（整个目录）
Copy-Item "$src\src\workbench" "$dst\src\workbench" -Recurse -Force
```

### 步骤 6：复制文档和测试

```powershell
$src = "desktop_legacy"
$dst = "desktop"

Copy-Item "$src\docs\v2" "$dst\docs\v2" -Recurse -Force
if (Test-Path "$src\shared\test-kit") {
  Copy-Item "$src\shared\test-kit" "$dst\shared\test-kit" -Recurse -Force
}
```

### 步骤 7：执行文件修改

按 §三 中列出的修改方案，逐个修改：
1. `workbench.ts` — 添加 `import "./auth"`
2. `developmentLaunchEnvironment.ts` — 修复 `process.defaultApp` 守卫
3. `settings.ts` — 拆分：删除 `saveApiKeyAndSync` + gateway.ts/gatewayEnvironment.ts 导入
4. `auth.ts` — 将 `saveApiKeyAndSync()` 调用改为 `saveApiKey()`（方案 B）
5. `main.tsx` — 添加 Error Boundary
6. `electron.vite.config.ts` — 重写为单一 V2 配置
7. `package.json` — 删除 legacy 脚本
8. `dev.ps1` — 删除 legacy 分支

### 步骤 8：创建 authTypes.ts（如果方案是拆分 desktopApi.ts）

从 `desktop_legacy/shared/api/desktopApi.ts` 中提取 auth 相关类型到 `desktop/shared/api/authTypes.ts`，然后修改 `auth.ts` 的导入路径。

### 步骤 9：验证

```powershell
cd D:\work\projects\drsai\apps\desktop\windows
# 1. TypeScript 类型检查
npx tsc --noEmit -p tsconfig.node.json
npx tsc --noEmit -p tsconfig.web.json
# 2. 启动验证
npm run dev
```

---

## 五、auth.ts 依赖链详图

这是整个迁移中最关键的依赖分析。`auth.ts` 是唯一从 legacy 复用的模块，必须确保其依赖链干净：

```
workbench.ts
  └─ import "./auth"
      └─ configureAuthPlatform()  ← 设置 credentialService + openExternalUrl
          │
          ├─ import { DRSAI_HOME } from "./paths"              ✅ 复制
          │     └─ import { createDesktopPathService } from "./desktopPaths"  ✅ 复制
          │
          ├─ import { isDesktopDevelopment } from "./desktopRuntimeMode"  ✅ 复制 (3 行)
          │
          ├─ import { getActivePlatformConfig } from "./platformConfig"  ✅ 复制 (189 行)
          │     └─ (仅依赖 paths + desktopRuntimeMode，已计数)
          │
          ├─ import { saveApiKeyAndSync } from "./settings"   ⚠️ 需修改
          │     ├─ import { DRSAI_ENV_FILE } from "./paths"    ✅ 已复制
          │     ├─ import { getGatewayRequestHeaders } from "./gateway"  ⛔ 不复制 (970 行 legacy)
          │     └─ import { resolveGatewayPort } from "./gatewayEnvironment"  ⛔ 不复制 (39 行 legacy)
          │
          │  修改后:
          │  settings.ts (V2 版)
          │     └─ import { DRSAI_ENV_FILE } from "./paths"  ✅
          │     └─ saveApiKey() — 仅文件写入，无 gateway 依赖  ✅
          │
          ├─ import { sanitizeDiagnosticUrl } from "./secretRedaction"  ✅ 复制 (25 行)
          │     └─ import { redactSensitiveData } from "../api/sensitiveData"  ✅ 复制 (66 行)
          │
          ├─ import { getOrCreateStableLocalUserId, rememberUserIdAlias } from "./userIdentity"  ✅ 复制 (139 行)
          │     └─ (仅依赖 paths，已计数)
          │
          ├─ import { registerAuthContextProvider, syncCoordinatedGatewayIdentity } from "./authGatewayCoordination"  ✅ 复制 (31 行)
          │     └─ import type { AuthContext } from "./auth"  (仅类型，无循环)
          │
          ├─ import type { DesktopCredentialService } from "../api"  ✅ 复制 (index.ts barrel)
          │
          └─ import type { AuthSession, LoginRequest, LoginResult, LogoutOptions, OidcLoginDebugEvent } from "../api/desktopApi"
                                                                                                        ⚠️ 需拆分类型
             修改后: from "../api/authTypes"  ✅ 新建
```

---

## 六、其他需要评估的文件

### 6.1 versionInfo.ts (45 行)

| 评估项 | 结论 |
|--------|------|
| 是否被 V2 代码引用？ | 需检查 `workbench.ts` 和 `desktopGateway/` 是否导入 |
| 如果被引用 | 复制 |
| 如果未被引用 | 不复制 |

### 6.2 secureIpc.ts (224 行)

| 评估项 | 结论 |
|--------|------|
| 是否被 `desktopGateway/ipc.ts` 导入？ | 需检查 |
| 如果是 | 复制 |
| 如果 V2 有自己的 sender 验证 | 不复制 |

### 6.3 browser/urlPolicy.ts (65 行)

| 评估项 | 结论 |
|--------|------|
| 是否被 `windowsExternalUrl.ts` 或 `auth.ts` 导入？ | 需检查 |
| 如果是 | 仅复制该文件 |
| 如果否 | 不复制 |

### 6.4 errorEnvelope.ts (58 行)

| 评估项 | 结论 |
|--------|------|
| 是否被 `desktopGateway/client.ts` 导入？ | 需检查 |
| 如果是 | 复制 |
| 如果否 | 不复制 |

---

## 七、删减前后对比

| 维度 | desktop_legacy（参考） | desktop（重建后） | 削减 |
|------|------------------------|-------------------|------|
| windows/src/main/ 文件数 | 97 | 5-6 | 94% |
| windows/src/main/ 行数 | ~35,000 | ~300 | 99% |
| shared/main/ 文件数 | 169 | ~20 | 88% |
| shared/main/ 行数 | 79,213 | ~7,000 | 91% |
| shared/renderer/src/ 文件数 | 191 | 11 | 94% |
| shared/renderer/src/ 行数 | 99,698 | ~1,500 | 98% |
| shared/api/ 文件数 | 36 | 5-6 | 86% |
| shared/api/ 行数 | 11,998 | ~960 | 92% |
| **总计** | **~225,000 行 / 493 文件** | **~9,760 行 / ~42 文件** | **96%** |

---

## 八、执行注意事项

### 8.1 执行顺序

1. **创建目录骨架** → §四 步骤 1
2. **复制 V2 原生文件**（desktopGateway/, workbench/, desktopGateway.ts, desktopBridge.ts）→ 无需修改
3. **复制 auth 依赖链文件** → 需修改 settings.ts
4. **复制 Windows Shell 文件** → 需修改 workbench.ts, developmentLaunchEnvironment.ts
5. **执行文件修改** → §四 步骤 7
6. **TypeScript 类型检查** → 修复编译错误
7. **启动验证** → `npm run dev`

### 8.2 验证清单

- [ ] `npm run dev` 能启动 Electron 窗口
- [ ] OIDC 登录流程正常（`import "./auth"` 已添加）
- [ ] Python desktop_gateway 在端口 28643 启动
- [ ] 渲染层显示 workbench 界面（非白屏）
- [ ] Error Boundary 能捕获渲染异常并显示错误信息
- [ ] `npx tsc --noEmit` 通过（无类型错误）
- [ ] 消息发送/接收正常（SSE 事件流）

### 8.3 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| auth.ts 导入断裂（缺少类型） | 中 | 编译失败 | 提前提取 authTypes.ts |
| settings.ts 拆分遗漏函数 | 中 | 运行时错误 | 对比新旧 settings.ts 导出列表 |
| desktopApi.ts 类型提取不完整 | 中 | 编译失败 | 逐个类型检查，确保全部提取 |
| V2 渲染层缺少 legacy 功能 | 高 | 用户体验降级 | 确认 V2 11 项功能满足需求 |
| React 19 + react-markdown 10 兼容 | 低 | 白屏 | Error Boundary 兜底 |
| process.defaultApp 守卫修复不当 | 低 | 环境变量缺失 | dev.ps1 已预设环境变量 |

### 8.4 desktop_legacy 的后续处理

`apps/desktop_legacy` 保留为永久参考。在新 `apps/desktop` 稳定运行后：
- 如果需要从 legacy 提取特定功能（如语音输入、设置面板），从 `desktop_legacy` 中查找参考实现
- 如果新 `desktop` 完全满足需求，可以归档或删除 `desktop_legacy`

---

## 九、总结

本方案的核心变化：

1. **从"删减"变为"重建"** — 不在旧目录中删除，而是从 `desktop_legacy` 选择性复制到新 `desktop`
2. **auth.ts 依赖链已完全分析** — 9 个直接导入中 8 个干净，1 个（settings.ts）需要拆分以切断 gateway.ts 依赖
3. **明确的文件修改清单** — 8 个文件需要修改，每个都有具体的 diff
4. **V2 渲染层完整** — 11 个文件 ~1,500 行，仅需添加 Error Boundary
5. **目标：42 个文件 / ~9,760 行** — 从 493 文件 / ~225,000 行削减 96%
