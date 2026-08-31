# feature/desktop-v2 与 feature/desktop 分支差异分析

> 日期：2026-08-26
> 目标：对比 `feature/desktop-v2` 与 `origin/feature/desktop` 两个分支在 `apps/desktop/` 下的差异，
> 分析桌面启动后空白屏、OIDC 登录失败等问题的根因。

---

## 一、总体差异概览

```
git diff --stat origin/feature/desktop...origin/feature/desktop-v2 -- apps/desktop/
# 373 files changed, 8328 insertions(+), 52155 deletions(-)
```

| 目录 | 新增 (A) | 修改 (M) | 删除 (D) | 说明 |
|------|---------|---------|---------|------|
| `windows/` | 3 | 4 | 0 | 新增 workbench shell 入口 + 构建配置 |
| `shared/` | 24 | 0 | 0 | 新增完整 workbench 渲染层 + desktopGateway 桥接层 |
| 其他 (docs/v2, test-kit 等) | 大量 | — | — | 设计文档、验证脚本 |

**关键发现：没有删除任何文件。** `feature/desktop-v2` 是纯增量分支——它在保留原有 legacy shell
(`index.ts`, 7229 行) 的同时，新增了一套完整的 workbench shell 作为默认入口。
删除的 52155 行主要来自 `docs/` 下旧文档的替换和 `cores/` 后端迁移（不在本次对比范围内）。

---

## 二、windows/ 目录差异（3 新增 + 4 修改）

### 2.1 新增文件

#### `windows/src/main/workbench.ts`（127 行）— Workbench 主进程入口

```
对比: legacy 入口 index.ts = 7229 行
      workbench 入口 workbench.ts = 127 行 (缩减 98%)
```

**职责：**
- 创建 BrowserWindow（contextIsolation: true, nodeIntegration: false, sandbox: false）
- 调用 `createDesktopSurface()` 组装 IPC + Runtime 进程
- 开发模式加载 `${ELECTRON_RENDERER_URL}/workbench.html`
- 生产模式加载 `../renderer/workbench.html`

**⚠️ 缺陷 1：缺少 `import "./auth"`**

```typescript
// workbench.ts 的导入区:
import "./developmentLaunchEnvironment";
import { app, BrowserWindow, ipcMain, shell } from "electron";
import { createDesktopSurface } from "../../../shared/main/desktopGateway";
// ← 没有 import "./auth" !!
```

对比 legacy `index.ts` 的链：
```
index.ts → import "./bootstrap" → import "./auth" → 调用 configureAuthPlatform()
```

`configureAuthPlatform()` 做两件事：
1. 设置 `openExternalUrl` — OIDC 登录需要打开浏览器跳转到 HepAI 授权页
2. 设置 `credentialService` — 读写 OS 凭据存储 (Windows Credential Manager)

不调用它的后果：
- `openExternalUrl` 保持默认 throwing stub：`throw new Error("Desktop external URL service is not configured.")`
- `credentialService` 保持 null
- **OIDC 登录 100% 失败**

**修复方法：** 在 `workbench.ts` 的 `import "./developmentLaunchEnvironment"` 之后加一行：
```typescript
import "./auth";  // 调用 configureAuthPlatform()，配置 OIDC 所需的 openExternalUrl 和 credentialService
```

#### `windows/src/preload/workbench.ts`（9 行）— Workbench preload

导入 `shared/main/desktopGateway/preload.ts`，通过 `contextBridge.exposeInMainWorld("drsaai", ...)`
向渲染层暴露 19 个方法的桥接 API。

对比 legacy preload（`shared/main/preload.ts`，~100+ 方法）：workbench 只暴露 19 个方法，
但覆盖了 runtime/workspaces/sessions/runs/models/audio/chat/voice 全部功能。

#### `windows/electron.vite.workbench.config.ts` — Workbench Vite 配置

```typescript
export default defineConfig({
  main:    { build: { rollupOptions: { input: { index: resolve("src/main/workbench.ts") } } } },
  preload: { build: { rollupOptions: { input: { workbench: resolve("src/preload/workbench.ts") } } } },
  renderer: {
    root: resolve("../shared/renderer"),  // ← 渲染层根目录指向 shared/renderer
    server: { host: "127.0.0.1", hmr: { host: "127.0.0.1" } },
    build: { rollupOptions: { input: resolve("../shared/renderer/workbench.html") } },
    resolve: { alias: { "@renderer": resolve("../shared/renderer/src"), "@shared": resolve("../shared/api") } },
    plugins: [react()],  // ← 只有 React 插件，没有 Tailwind
  },
});
```

关键点：
- 渲染层入口 HTML 在 `shared/renderer/workbench.html`
- 渲染层入口脚本在 `shared/renderer/src/workbench/main.tsx`
- **无 Tailwind 插件** — workbench 使用纯 CSS (`styles.css`)

### 2.2 修改文件

#### `windows/package.json` — 脚本变更

```diff
- "dev": "set OPENDRSAI_DESKTOP_DEV=1&& node scripts/run-branded-electron-vite.mjs dev"
+ "dev": "set OPENDRSAI_DESKTOP_DEV=1&& node scripts/run-branded-electron-vite.mjs dev --config electron.vite.workbench.config.ts"
+ "dev:workbench": "npm run dev"           // 别名
+ "dev:legacy": "set OPENDRSAI_DESKTOP_DEV=1&& node scripts/run-branded-electron-vite.mjs dev"  // 原行为保留
+ "build:workbench": "electron-vite build --config electron.vite.workbench.config.ts"
+ "verify:desktop-surface": "node ../shared/test-kit/run-typescript-test.mjs ../shared/test-kit/verify-desktop-surface.mts"
```

**变更效果：**
- `npm run dev` → 默认启动 workbench (desktop_gateway 端口 28643)
- `npm run dev:legacy` → 启动 legacy shell (gateway_legacy 端口 28642)
- 两种 shell 共存，可随时切换

#### `windows/scripts/dev.ps1` — 启动脚本变更

| 变更项 | 原值 | 新值 |
|--------|------|------|
| `$GatewayPort` | `28642` (或 `18642` 生产) | `28643` |
| `$env:DRSAI_DESKTOP_GATEWAY_HOME` | 未设置 | `~/.drsai-workbench` |
| `-HotLoad` | 启动 legacy 热重载 | **抛出异常**（拒绝 legacy 热重载） |
| `$env:DRSAI_GATEWAY_DEV_MANAGED` | 热重载时设为 `"1"` | **始终删除** |
| `$env:DRSAI_GATEWAY_HOT_RELOAD` | 热重载时设为 `"1"` | **始终删除** |
| `$env:OPENDRSAI_WORKBENCH_EXTERNAL_RUNTIME` | — | **始终删除**（确保 Electron 自管 Runtime） |

dev.ps1 设置的环境变量（给 Electron 子进程）：
```
$env:DRSAI_HOME              = $DrsaiHome         # ~/.drsai-dev
$env:DRSAI_REPO              = $RepoRoot          # D:\work\projects\drsai
$env:OPENDRSAI_RUNTIME_ROOT  = $InstallDir        # ~/.drsai-dev/drsai-agent
$env:DRSAI_DESKTOP_GATEWAY_PORT = "28643"
$env:DRSAI_DESKTOP_GATEWAY_HOME  = "~/.drsai-workbench"
```

#### `windows/tsconfig.node.json` 和 `windows/scripts/verify-dev-workspace-startup.mjs`

小量修改，添加 workbench 相关路径引用。

---

## 三、shared/ 目录差异（24 新增）

### 3.1 shared/main/desktopGateway/ — 主进程桥接层（10 个文件）

| 文件 | 行数 | 职责 |
|------|------|------|
| `index.ts` | ~100 | `createDesktopSurface()` — 组装 client + identity + runtime + service + IPC |
| `client.ts` | ~200 | `DesktopGatewayClient` — 17 个操作的 HTTP 客户端，处理 auth headers |
| `runtimeProcess.ts` | ~250 | `DesktopRuntimeProcess` — spawn Python, 轮询就绪, token 管理 |
| `identity.ts` | ~175 | `DesktopIdentity` — 缓存 auth session, `legacyAuthBackend()` / `offlineAuthBackend()` |
| `service.ts` | — | `BridgeService` — IPC 调用路由到 client 操作 |
| `ipc.ts` | — | `registerBridge()` — 注册 `ipcMain.handle` 通道 |
| `preload.ts` | ~80 | `contextBridge.exposeInMainWorld("drsaai", ...)` — 19 方法 |
| `sessionStream.ts` | — | `SessionStreamRegistry` — OAEP SSE 事件流管理 |
| `eventDispatcher.ts` | — | `BoundedEventDispatcher` — 事件分发 |
| `runtimeProcess.ts` | — | (见上) |

**⚠️ 缺陷 2：`identity.ts` 的 `legacyAuthBackend()` 不调用 `configureAuthPlatform()`**

```typescript
// identity.ts 中:
export async function legacyAuthBackend(): Promise<AuthBackend> {
  const auth = await import("../auth");  // ← 导入 auth 模块
  // 但 configureAuthPlatform() 是在 windows/src/main/auth.ts 中调用的
  // 这里只拿到了 startOidcLogin 等函数的引用，但 openExternalUrl 仍是默认 throwing stub
  const backend: AuthBackend = {
    login: () => auth.startOidcLogin({}),
    // ...
  };
  return backend;
}
```

`configureAuthPlatform()` 设置 `openExternalUrl` 和 `credentialService` 两个模块级变量。
`legacyAuthBackend()` 导入 `../auth`（即 `shared/main/auth.ts`），但该模块只是定义函数，
不执行配置。配置调用在 `windows/src/main/auth.ts`（已标记 `@deprecated M3 compatibility entrypoint`）。

在 legacy shell 中，链是 `index.ts → bootstrap → auth → configureAuthPlatform()`。
在 workbench shell 中，**没有等价的调用链**。

### 3.2 shared/api/ — API 契约（2 个文件）

| 文件 | 职责 |
|------|------|
| `desktopGateway.ts` | `DESKTOP_OPERATIONS` — 17 个操作的 TypeScript 契约，与 Python 路由 1:1 对应 |
| `desktopBridge.ts` | 渲染层桥接 API 类型定义（`window.drsai` 的类型） |

### 3.3 shared/renderer/ — Workbench 渲染层（12 个文件）

这是全新的 React 渲染层，位于 `shared/renderer/src/workbench/`：

| 文件 | 职责 | 实现状态 |
|------|------|---------|
| `workbench.html` | HTML 入口（CSP, div#root, script main.tsx） | ✅ 完整 |
| `main.tsx` | React 入口（检查 bridge → App / BridgeUnavailable） | ✅ 完整 |
| `App.tsx` | 三栏布局（Sidebar + 主区 + FilePane） | ✅ 完整 |
| `bridge.ts` | IPC 桥接封装（hasBridge, unwrap, attempt） | ✅ 完整 |
| `useDesktop.ts` | 非流式状态 hook（runtime/auth/workspaces/sessions/models） | ✅ 完整 |
| `useSessionStream.ts` | SSE 流式状态 hook（phase/entries/runs） | ✅ 完整 |
| `transcript.ts` | 纯函数（OAEP 事件折叠 → 排序条目） | ✅ 完整 |
| `styles.css` | 纯 CSS（亮/暗主题, 三栏 grid 布局） | ✅ 完整 |
| `components/Transcript.tsx` | 对话展示（markdown/reasoning/toolcall/artifact 等） | ✅ 完整 |
| `components/Composer.tsx` | 输入区（textarea + 模型选择 + 麦克风） | ✅ 完整 |
| `components/Sidebar.tsx` | 侧栏（workspace/session 列表 + 登录/登出） | ✅ 完整 |
| `components/FilePane.tsx` | 文件面板（递归文件树 + 预览） | ✅ 完整 |

**关键发现：渲染层代码是完整的，没有 stub/TODO/placeholder。** 所有 OAEP 条目类型都有真实渲染组件，
所有 IPC 方法都已接线，CSS 覆盖所有组件。空白屏**不是**因为渲染层代码缺失。

### 3.4 shared/test-kit/ — 验证工具（2 个文件）

| 文件 | 职责 |
|------|------|
| `verify-desktop-surface.mts` | 1252 行 — 59 项桌面表面验证测试 |
| `run-typescript-test.mjs` | 测试运行器 |

### 3.5 shared/renderer/package.json — 渲染层依赖

```json
{
  "dependencies": {
    "react": "19.2.1",
    "react-dom": "19.2.1",
    "react-markdown": "10.1.0",
    "remark-gfm": "4.0.1",
    "lucide-react": "1.7.0",
    "qrcode": "^1.5.4",
    "@xterm/xterm": "6.0.0",
    "@xterm/addon-fit": "0.11.0"
  }
}
```

所有依赖已声明，通过 monorepo hoisting 解析。React 19.2.1 是较新版本。

---

## 四、启动链路完整分析

### 4.1 dev.ps1 → Electron → Runtime 的环境变量传递

```
dev.ps1 设置:
  DRSAI_HOME=~/.drsai-dev
  DRSAI_REPO=D:\work\projects\drsai
  OPENDRSAI_RUNTIME_ROOT=~/.drsai-dev/drsai-agent
  DRSAI_DESKTOP_GATEWAY_PORT=28643
  DRSAI_DESKTOP_GATEWAY_HOME=~/.drsai-workbench

→ npm run dev
  → run-branded-electron-vite.mjs (准备 branded Electron)
    → electron-vite dev --config electron.vite.workbench.config.ts
      → Vite dev server (renderer, http://127.0.0.1:随机端口)
      → spawn branded Electron (设置 ELECTRON_EXEC_PATH)
        → process.env 已包含 dev.ps1 设置的所有变量
```

### 4.2 workbench.ts 的执行流程

```
1. import "./developmentLaunchEnvironment"
   → resolveDevelopmentLaunchEnvironment({ defaultApp: process.defaultApp })
   → ⚠️ process.defaultApp === false (electron-vite 不设置此标志)
   → 函数返回 {} (不设置任何环境变量)
   → 但 dev.ps1 已设置了所需变量，所以不影响

2. createDesktopSurface()
   → new DesktopRuntimeProcess({ stateHome: WORKBENCH_STATE_HOME })
     → DRSAI_PYTHON = paths.DRSAI_PYTHON
       = desktopPaths.resolve({ DRSAI_HOME, OPENDRSAI_RUNTIME_ROOT }).pythonExecutable
       = ~/.drsai-dev/drsai-agent/venv/Scripts/python.exe
     → resolveInstanceToken() → 读取 ~/.drsai-dev/runtime/instance-token
   → legacyAuthBackend() (await import("../auth"))
     → ⚠️ 不调用 configureAuthPlatform()
   → new DesktopGatewayClient({ baseUrl, instanceToken, identity })

3. createWindow()
   → preload: join(__dirname, "../preload/workbench.js")
   → if (is.dev && rendererUrl) loadURL(`${rendererUrl}/workbench.html`)
   → else loadFile(join(__dirname, "../renderer/workbench.html"))

4. surface.start() (异步, 不 await)
   → runtime.ensureReady()
     → 检查 DRSAI_PYTHON 是否存在
     → spawn(DRSAI_PYTHON, ["-m", "drsai.backend.desktop_gateway"], { env: { ..., OPENDRSAI_GATEWAY_INSTANCE_TOKEN: token } })
     → 轮询 GET /v1/runtime (公开路由, 不需要 auth)
     → 就绪后 state = { status: "ready", identity }
```

### 4.3 渲染层的初始化流程

```
main.tsx 挂载
  → hasBridge()? → 检查 window.drsaiBridgeReady && window.drsai
    → true → 渲染 <App/>
    → false → 渲染 <BridgeUnavailable/>

App.tsx 渲染
  → useDesktop()
    → runtime.identity() → IPC → GET /v1/runtime (公开)
      → Runtime 未就绪 → reachable: false → 每 2s 轮询
      → Runtime 就绪 → reachable: true
    → auth.session() → IPC → identity.session()
      → 检查本地凭据缓存
      → 如果未登录 → 返回 null (正常, 离线模式)
    → workspaces.list() → IPC → GET /v1/workspaces (需要 gateway token)
    → models.catalog() → IPC → GET /v1/models (需要 gateway token)

  → useSessionStream(sessionId)
    → api.sessions.subscribe(sessionId) → IPC → SSE 流
```

---

## 五、空白屏根因分析

### 根因 1：缺少 `import "./auth"` (OIDC 登录失败)

**影响范围：** 登录按钮、凭据存储
**严重程度：** 高 — 用户无法登录

`workbench.ts` 没有 `import "./auth"`，导致：
- `openExternalUrl` = 默认 throwing stub
- `credentialService` = null

当用户点击 "登录" 时：
```
渲染层 api.auth.signIn() → IPC → identity.login() → auth.startOidcLogin({})
  → 调用 openExternalUrl(authorizeUrl)
  → throw new Error("Desktop external URL service is not configured.")
```

**修复：**
```typescript
// workbench.ts, 在 import "./developmentLaunchEnvironment" 之后添加:
import "./auth";
```

### 根因 2：无 React Error Boundary (渲染崩溃 = 白屏)

**影响范围：** 任何渲染时异常
**严重程度：** 高 — 导致完全白屏

`main.tsx` 直接渲染 `<App/>`，没有 Error Boundary：
```typescript
createRoot(document.getElementById("root")!).render(
  hasBridge() ? <App/> : <BridgeUnavailable/>
);
```

如果 App 在渲染过程中抛出异常（例如 bridge 返回的类型与预期不符、React 19 API 变更、
react-markdown 10.x 与 React 19 的兼容性问题），React 19 会卸载整个组件树，**显示空白页面**。

**修复：** 在 `main.tsx` 中添加 Error Boundary：
```typescript
class ErrorBoundary extends React.Component<{children: React.ReactNode}, {error: Error | null}> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return <div style={{padding: 24, color: '#c00'}}>
        <h2>渲染错误</h2>
        <pre>{this.state.error.message}</pre>
        <pre>{this.state.error.stack}</pre>
      </div>;
    }
    return this.props.children;
  }
}
// 使用: <ErrorBoundary><App/></ErrorBoundary>
```

### 根因 3：Runtime (Python) 启动失败

**影响范围：** 所有后端调用
**严重程度：** 高 — 导致面板内容为空

`runtimeProcess.ts` L128-129:
```typescript
if (!existsSync(DRSAI_PYTHON)) {
  return this.fail(`The Runtime interpreter is missing: ${DRSAI_PYTHON}`);
}
```

`DRSAI_PYTHON` 解析路径：
```
DRSAI_HOME (~/.drsai-dev) → OPENDRSAI_RUNTIME_ROOT (~/.drsai-dev/drsai-agent)
  → venv/Scripts/python.exe
  → 完整路径: ~/.drsai-dev/drsai-agent/venv/Scripts/python.exe
```

如果 venv 不存在或 `pip install -e` 未执行，Runtime 无法启动。
渲染层会显示 "Starting OpenDrSai…" 横幅，但工作区/会话/模型列表全部为空。

**诊断方法：**
1. 检查 `~/.drsai-dev/drsai-agent/venv/Scripts/python.exe` 是否存在
2. 在终端手动运行：`~/.drsai-dev/drsai-agent/venv/Scripts/python.exe -m drsai.backend.desktop_gateway`
3. 检查 dev.ps1 控制台输出是否有 Runtime 错误日志
4. 打开 DevTools (Ctrl+Shift+I) 查看 Console 中的 IPC 错误

### 根因 4：`process.defaultApp` 保护导致环境变量缺失（仅 `npm run dev` 直跑时）

**影响范围：** 不通过 dev.ps1 直接 `npm run dev` 的场景
**严重程度：** 中

`developmentLaunchEnvironment.ts` 的保护条件：
```typescript
if (!input.defaultApp) return {};  // process.defaultApp === false → 返回空
```

electron-vite **不设置** `process.defaultApp`（已验证：electron-vite dist 中无 `defaultApp` 引用）。
因此 `developmentLaunchEnvironment.ts` 在 workbench 模式下始终返回 `{}`。

**场景 A：通过 dev.ps1 启动** → dev.ps1 已设置所有环境变量 → 不受影响
**场景 B：直接 `npm run dev`** → 环境变量未设置 → `DRSAI_HOME` 回退到 `~/.drsai`
→ Python 路径 `~/.drsai/drsai-agent/venv/Scripts/python.exe` 可能不存在 → Runtime 失败

### 根因 5：CSP 阻止 Vite HMR WebSocket（可能性低）

`workbench.html` 的 CSP：
```
connect-src 'self' ws://127.0.0.1:* http://127.0.0.1:*;
```

Vite HMR 使用 WebSocket。如果 HMR host 不是 `127.0.0.1`（例如 `localhost`），
CSP 可能阻止 HMR 连接。但这通常只影响热更新，不导致白屏。

`electron.vite.workbench.config.ts` 设置了 `server.host: "127.0.0.1"` 和 `hmr.host: "127.0.0.1"`，
与 CSP 的 `ws://127.0.0.1:*` 匹配。**可能性低。**

---

## 六、诊断清单

按优先级排序的排查步骤：

### 步骤 1：打开 DevTools 检查

```
Ctrl+Shift+I 打开 DevTools
→ Console 标签：查看是否有 JS 异常（React 渲染崩溃）
→ Network 标签：查看 IPC 调用是否返回错误
→ Application 标签：检查 preload 是否加载
```

### 步骤 2：验证 Runtime 是否启动

```powershell
# 检查 Python 路径
$python = "$env:USERPROFILE\.drsai-dev\drsai-agent\venv\Scripts\python.exe"
Test-Path $python

# 手动启动 desktop_gateway
& $python -m drsai.backend.desktop_gateway

# 另一个终端检查
curl http://127.0.0.1:28643/v1/runtime
```

### 步骤 3：验证 Gateway Token

```powershell
# 检查 token 文件
$tokenFile = "$env:USERPROFILE\.drsai-dev\runtime\instance-token"
Test-Path $tokenFile
Get-Content $tokenFile
```

### 步骤 4：验证 Preload 加载

在 DevTools Console 中：
```javascript
console.log(window.drsaiBridgeReady);  // 应为 true
console.log(typeof window.drsai);       // 应为 "object"
console.log(Object.keys(window.drsai)); // 应列出 19 个方法
```

### 步骤 5：验证 Auth 配置

在 DevTools Console 中：
```javascript
// 尝试登录
window.drsai.auth.signIn()
  .then(r => console.log("登录结果:", r))
  .catch(e => console.error("登录错误:", e));
// 如果报 "Desktop external URL service is not configured." → 确认是 import "./auth" 缺失
```

---

## 七、修复方案汇总

| # | 问题 | 修复 | 文件 | 优先级 |
|---|------|------|------|--------|
| 1 | OIDC 登录失败 | 添加 `import "./auth"` | `windows/src/main/workbench.ts` | P0 |
| 2 | 渲染崩溃无 Error Boundary | 添加 React Error Boundary | `shared/renderer/src/workbench/main.tsx` | P0 |
| 3 | Runtime 启动失败 | 检查 venv + pip install | `~/.drsai-dev/drsai-agent/venv/` | P1 |
| 4 | `process.defaultApp` 保护 | 在 workbench.ts 中显式设置 env fallback | `windows/src/main/workbench.ts` | P2 |
| 5 | CSP 可能阻止 HMR | 确认 Vite host 为 127.0.0.1 | `electron.vite.workbench.config.ts` | P3 |

### 修复 1：添加 `import "./auth"` (P0)

```diff
// windows/src/main/workbench.ts
  import "./developmentLaunchEnvironment";
+ import "./auth";  // 配置 OIDC: openExternalUrl + credentialService
  import { app, BrowserWindow, ipcMain, shell } from "electron";
```

### 修复 2：添加 Error Boundary (P0)

```diff
// shared/renderer/src/workbench/main.tsx
+ class ErrorBoundary extends React.Component<
+   { children: React.ReactNode },
+   { error: Error | null }
+ > {
+   state = { error: null as Error | null };
+   static getDerivedStateFromError(error: Error) { return { error }; }
+   render() {
+     if (this.state.error) {
+       return (
+         <div style={{ padding: 24, fontFamily: "monospace" }}>
+           <h2 style={{ color: "#c00" }}>渲染错误</h2>
+           <pre>{this.state.error.message}</pre>
+           <pre style={{ overflow: "auto", maxHeight: 400 }}>
+             {this.state.error.stack}
+           </pre>
+         </div>
+       );
+     }
+     return this.props.children;
+   }
+ }

  createRoot(document.getElementById("root")!).render(
-   hasBridge() ? <App /> : <BridgeUnavailable />
+   <ErrorBoundary>
+     {hasBridge() ? <App /> : <BridgeUnavailable />}
+   </ErrorBoundary>
  );
```

### 修复 4：显式环境变量 fallback (P2)

```diff
// windows/src/main/workbench.ts, 在 import "./developmentLaunchEnvironment" 之后添加:

+ // developmentLaunchEnvironment 只在 process.defaultApp === true 时激活。
+ // electron-vite 不设置 defaultApp，所以这里显式确保关键变量存在。
+ if (!process.env.DRSAI_HOME) {
+   process.env.DRSAI_HOME = join(homedir(), ".drsai-dev");
+ }
+ if (!process.env.DRSAI_REPO) {
+   process.env.DRSAI_REPO = resolve(__dirname, "..", "..", "..", "..", "..");
+ }
+ if (!process.env.OPENDRSAI_RUNTIME_ROOT) {
+   process.env.OPENDRSAI_RUNTIME_ROOT = join(process.env.DRSAI_HOME, "drsai-agent");
+ }
```

---

## 八、架构对比总结

### 8.1 双 Shell 并存架构

```
feature/desktop-v2 分支:
┌─────────────────────────────────────────────────────────────┐
│  apps/desktop/windows/                                       │
│  ├── src/main/                                               │
│  │   ├── index.ts          (7229 行, legacy shell)          │
│  │   ├── workbench.ts      (127 行, workbench shell)  ← 新增│
│  │   ├── bootstrap.ts      (legacy 依赖)                    │
│  │   └── auth.ts           (调用 configureAuthPlatform)     │
│  ├── src/preload/                                            │
│  │   ├── index.ts          (legacy preload)                 │
│  │   └── workbench.ts      (workbench preload)        ← 新增│
│  ├── electron.vite.config.ts          (legacy 构建配置)     │
│  ├── electron.vite.workbench.config.ts (workbench 配置)← 新增│
│  └── package.json                                          ← 修改│
│      ├── dev   → workbench (28643)                          │
│      └── dev:legacy → legacy (28642)                        │
├─────────────────────────────────────────────────────────────┤
│  apps/desktop/shared/                                        │
│  ├── main/                                                   │
│  │   ├── auth.ts             (configureAuthPlatform 定义)   │
│  │   ├── paths.ts            (DRSAI_HOME/Python 解析)       │
│  │   ├── desktopPaths.ts     (路径服务)                      │
│  │   ├── preload.ts          (legacy preload API)           │
│  │   └── desktopGateway/     (workbench 桥接层)       ← 新增 │
│  │       ├── index.ts        (createDesktopSurface)         │
│  │       ├── client.ts       (17 操作 HTTP 客户端)           │
│  │       ├── runtimeProcess.ts (Python 进程管理)            │
│  │       ├── identity.ts     (auth session 缓存)            │
│  │       ├── service.ts      (IPC 路由)                     │
│  │       ├── ipc.ts          (ipcMain.handle 注册)          │
│  │       ├── preload.ts      (contextBridge 19 方法)        │
│  │       ├── sessionStream.ts (SSE 事件流)                  │
│  │       └── eventDispatcher.ts (事件分发)                  │
│  ├── api/                                                    │
│  │   ├── desktopGateway.ts   (17 操作 TS 契约)       ← 新增│
│  │   └── desktopBridge.ts    (渲染层桥接类型)         ← 新增│
│  ├── renderer/                                               │
│  │   ├── src/workbench/      (React 渲染层)           ← 新增│
│  │   │   ├── App.tsx         (三栏布局)                     │
│  │   │   ├── main.tsx        (React 入口)                    │
│  │   │   ├── bridge.ts       (IPC 封装)                     │
│  │   │   ├── useDesktop.ts   (状态 hook)                     │
│  │   │   ├── useSessionStream.ts (流式 hook)                │
│  │   │   ├── transcript.ts   (事件折叠)                     │
│  │   │   ├── styles.css      (纯 CSS)                       │
│  │   │   └── components/     (Transcript/Composer/Sidebar/FilePane)│
│  │   ├── workbench.html      (HTML 入口)              ← 新增│
│  │   └── package.json        (React 等依赖)           ← 新增│
│  └── test-kit/                                        ← 新增│
│      ├── verify-desktop-surface.mts (59 项验证)             │
│      └── run-typescript-test.mjs                           │
├─────────────────────────────────────────────────────────────┤
│  cores/python/.../backend/                                   │
│  ├── gateway_legacy.py      (13076 行, 214 路由, 端口 28642)│
│  ├── gateway/               (Phase 0, exec 重跑 legacy)     │
│  └── desktop_gateway/       (V2, 17 路由, 端口 28643) ← 迁移 │
│      ├── app.py             (create_app, DEFAULT_PORT)      │
│      ├── __main__.py        (python -m 入口)               │
│      ├── _state.py          (懒加载单例)                     │
│      ├── _auth.py           (中间件: token + OIDC)          │
│      ├── _agent_backend.py  (DesktopAgentBackend)          │
│      └── routes/            (runtime/workspaces/sessions/runs/models/audio)│
└─────────────────────────────────────────────────────────────┘
```

### 8.2 两种 Shell 的对比

| 维度 | Legacy Shell (index.ts) | Workbench Shell (workbench.ts) |
|------|------------------------|-------------------------------|
| 入口 | `index.ts` (7229 行) | `workbench.ts` (127 行) |
| Vite 配置 | `electron.vite.config.ts` | `electron.vite.workbench.config.ts` |
| Preload | `shared/main/preload.ts` (~100+ 方法) | `shared/main/desktopGateway/preload.ts` (19 方法) |
| 后端 | `gateway_legacy.py` (214 路由, 28642) | `desktop_gateway/` (17 路由, 28643) |
| 渲染层 | `src/renderer/` (复杂 SPA, Tailwind) | `shared/renderer/src/workbench/` (精简, 纯 CSS) |
| Auth | `bootstrap → auth → configureAuthPlatform()` | ⚠️ **缺少** `configureAuthPlatform()` |
| IPC | ~200 个 `ipcMain.handle` | 1 个 `ipcMain.handle` (路由分发) |
| Chat 执行 | `/v1/chat/completions` (SSE) | `POST /v1/runs/{id}/execute` + OAEP SSE |
| 状态隔离 | `~/.drsai-dev` | `~/.drsai-workbench` (DRSAI_DESKTOP_GATEWAY_HOME) |
| 启动命令 | `npm run dev:legacy` | `npm run dev` |
| dev.ps1 端口 | 28642 | 28643 |

### 8.3 后端路由对比

| 维度 | gateway_legacy.py | desktop_gateway/ |
|------|-------------------|------------------|
| 路由数 | 214 | 17 |
| 端口 | 28642 | 28643 |
| 文件数 | 1 (13076 行) | 6 (runtime/workspaces/sessions/runs/models/audio) |
| Chat 执行 | 693 行 (`/v1/chat/completions`) | ~30 行 (`POST /v1/runs/{id}/execute`) |
| OIDC 路由 | 有 (登录/回调/刷新等) | 0 (中间件 only) |
| Auth 模式 | 路由级 | 中间件级 (gateway token + bearer) |

---

## 九、结论

### 空白屏的最可能原因（按概率排序）

1. **Runtime (Python) 启动失败** → 所有后端调用返回错误 → 面板为空
   - 诊断：检查 `~/.drsai-dev/drsai-agent/venv/Scripts/python.exe` 是否存在
   - 诊断：手动运行 `python -m drsai.backend.desktop_gateway` 看是否报错

2. **渲染层 JS 异常 + 无 Error Boundary** → React 崩溃 → 白屏
   - 诊断：DevTools Console 查看异常
   - 修复：添加 Error Boundary

3. **缺少 `import "./auth"`** → OIDC 登录失败 → 但不直接导致白屏
   - 修复：添加一行 import

### 迁移状态评估

| 维度 | 状态 |
|------|------|
| Python 后端 (desktop_gateway) | ✅ 完成 — 17 路由, 59 项验证测试通过 |
| TS 契约对齐 (DESKTOP_OPERATIONS) | ✅ 完成 — 17/17 操作 1:1 对应 |
| 主进程桥接层 (desktopGateway/) | ✅ 完成 — 10 个文件, 完整 IPC + Runtime 管理 |
| 渲染层 (workbench/) | ✅ 完成 — 12 个文件, 所有组件实现 |
| 构建配置 | ✅ 完成 — workbench Vite config + package.json scripts |
| dev.ps1 启动链 | ✅ 完成 — 端口/环境变量/legacy flag 清理 |
| **OIDC 配置** | ❌ **缺失** — workbench.ts 缺少 `import "./auth"` |
| **Error Boundary** | ❌ **缺失** — main.tsx 无错误边界 |
| **真实模型对话验证** | ❌ **未验证** — startup-and-test 文档指出此项未测 |
| **Electron 真实启动验证** | ❌ **未验证** — startup-and-test 文档指出此项未测 |

### 建议的修复顺序

1. 添加 `import "./auth"` 到 `workbench.ts` (1 行, P0)
2. 添加 Error Boundary 到 `main.tsx` (~30 行, P0)
3. 运行 `dev.ps1 -InstallOnly` 确保 venv + pip install -e 完成 (P1)
4. 启动后打开 DevTools Console 检查异常 (P1)
5. 验证 Runtime 手动启动: `python -m drsai.backend.desktop_gateway` (P1)
6. 验证真实模型对话 (P2)
