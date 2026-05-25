# DrSai Desktop
跳过调试：```bash scripts/install.sh   --skip-setup   --dev-source /home/xiongdb/drsai```

> DrSai 桌面应用：Electron + React 前端，本地 Python FastAPI Gateway 后端  
> 渲染进程通过 `window.drsaiAPI` 调用 Electron 主进程，主进程通过 HTTP JSON / SSE 与 DrSai Gateway 通信

## 项目结构

```
desktop/
├── drsai_api_server.py          # 🔥 Python FastAPI 后端 (端口 8642)
├── drsai-desktop/               # Electron + React 前端 (fork of hermes-desktop)
│   ├── src/main/
│   │   ├── index.ts             #   窗口管理 + IPC handlers
│   │   ├── drsai.ts             #   Agent/Gateway 通信核心：健康检查、自动启动、SSE
│   │   ├── config.ts            #   连接配置、用户身份、env/cli config API
│   │   ├── model-catalog.ts     #   模型配置 CRUD
│   │   ├── sessions.ts          #   会话/线程查询
│   │   ├── memory.ts            #   MEMORY.md / USER.md 管理
│   │   ├── skills.ts            #   技能列表/安装/卸载
│   │   └── tools.ts             #   MCP server / 本地工具描述配置
│   ├── src/preload/             #   contextBridge API
│   │   └── index.ts             #   暴露 window.drsaiAPI IPC 白名单
│   ├── src/renderer/            #   React 渲染进程
│   │   └── src/screens/         #     Chat / Sessions / Models / Skills / Memory / ...
│   ├── package.json             #   npm scripts 与 Electron/React 依赖
│   └── electron-builder.yml     #   桌面端打包配置
├── scripts/
│   ├── start.sh                 # 一键启动 (API → Electron)
│   └── dev.sh                   # 开发模式 (hot reload)
└── README.md                    # 本文件
```

## 架构

详细技术路线见：[docs/drsai-desktop-technical-route.md](docs/drsai-desktop-technical-route.md)。

DrSai Desktop 当前采用 **Electron + React 桌面壳 + 本地 Python FastAPI Gateway** 的分层架构。渲染进程不直接访问 Python 后端，而是通过 preload 暴露的 `window.drsaiAPI` 进入 Electron 主进程；主进程负责窗口、安全、IPC、Gateway 生命周期，以及 HTTP/SSE 协议适配。

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Renderer: React 19 UI                                                │
│ Chat / Sessions / Models / Providers / Skills / Memory / Tools /     │
│ Schedules / Kanban / Settings                                        │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ window.drsaiAPI (contextBridge)
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Preload: IPC API 白名单                                               │
│ ipcRenderer.invoke(...) / ipcRenderer.on(chat-chunk, chat-done, ...) │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ Electron IPC
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Main: Electron 主进程                                                 │
│ - BrowserWindow / 菜单 / 自动更新 / 安全策略                         │
│ - IPC handlers: install/config/models/sessions/memory/skills/tools   │
│ - drsai.ts: Gateway health check、自动启动、Chat SSE 解析、abort     │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ HTTP JSON + SSE, 127.0.0.1:${DRSAI_API_PORT:-8642}
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│ DrSai Gateway: FastAPI + uvicorn                                      │
│ desktop/drsai_api_server.py → drsai.backend.gateway                  │
│ /health /v1/chat/completions /v1/threads /v1/models/config           │
│ /v1/config/* /v1/memory* /v1/skills* /v1/config/tools*               │
│ /v1/cronjobs* /v1/kanban/*                                           │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ create_agent() / AgentManager.run_stream()
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│ DrSai Assistant Runtime                                               │
│ autogen_agentchat + tools + skills + memory + DatabaseManager        │
└──────────────────────────────────────────────────────────────────────┘
```

### 技术选型概览

| 层级 | 选型 | 说明 |
|:--|:--|:--|
| 桌面容器 | Electron 39 | 跨平台窗口、菜单、系统集成 |
| 构建 | electron-vite 5 / Vite 7 / electron-builder | 开发热更新、分包构建、安装包产物 |
| 前端 | React 19 / TypeScript 5 | 组件化 UI 与 IPC 类型约束 |
| 样式与渲染 | Tailwind CSS 4、react-markdown、remark-gfm、react-syntax-highlighter、lucide-react | 聊天 Markdown、代码高亮、图标和页面样式 |
| 国际化 | i18next / react-i18next | 多语言资源位于 `src/shared/i18n` |
| 后端 Gateway | FastAPI + uvicorn | 本地 HTTP API 和 SSE 流式输出 |
| Agent Runtime | DrSai + autogen_agentchat | Agent、工具调用、技能、记忆和线程状态 |

### 后端通信方案

- **Chat 流式通信**：主进程向 `POST /v1/chat/completions` 发送 OpenAI-compatible 请求，使用 SSE 解析 `data:` chunk、`event: tool.progress`、usage 和 `[DONE]`，再通过 IPC 推送到 React。
- **配置/管理通信**：模型、Provider、env、memory、skills、tools、cronjobs、kanban 等均由主进程通过 JSON HTTP API 调用 Gateway，Gateway 是配置和运行时状态的单一入口。
- **Gateway 生命周期**：`src/main/drsai.ts` 先访问 `/health`；不可用时自动 `spawn(python -m drsai.backend.gateway)`，端口默认 `8642`，可用 `DRSAI_API_PORT` 覆盖。
- **用户隔离**：桌面端通过 `getUserName()` 获取 `user_id`，随 chat、memory、skills、threads 等请求传给 Gateway。
- **Remote/SSH 状态**：代码保留 `local | remote | ssh` 配置入口，但当前 `drsai.ts` 主路线是本地 Gateway；SSH remote 模块多为 stub，应视为未来扩展而非稳定能力。

## 快速开始

### 前置条件

```bash
# Python 环境 (需已安装 drsai 包和依赖)
pip install fastapi uvicorn

# Node.js 环境 + 依赖
cd drsai-desktop && npm install --ignore-scripts
# --ignore-scripts 跳过 better-sqlite3 本地编译 (如系统 g++ 不支持 C++20)
```

<details>
<summary>🪟 Windows (PowerShell)</summary>

```powershell
# Python 环境 (需已安装 drsai 包和依赖)
pip install fastapi uvicorn

# Node.js 环境 + 依赖
cd drsai-desktop; npm install --ignore-scripts
# --ignore-scripts 跳过 better-sqlite3 本地编译 (需要 Visual Studio Build Tools)
```

</details>

### 一键启动

```bash
./scripts/start.sh
```

<details>
<summary>🪟 Windows (PowerShell)</summary>

```powershell
# Windows 下需手动分步启动，见下方「手动启动」章节
```

---

## 手动启动 (分步调试)

### 第一步：启动后端 API Server

```bash
# 终端 1
cd /home/xiongdb/drsai_dev/desktop
python drsai_api_server.py
```

<details>
<summary>🪟 Windows (PowerShell)</summary>

```powershell
# 终端 1
cd D:\work\DrSai\drsai\desktop
python drsai_api_server.py
```

</details>

启动成功标志：
```
INFO:     Started server process
INFO:     Uvicorn running on http://127.0.0.1:8642
```

### 第二步：验证 API Server

```bash
# 终端 2 — 健康检查
curl http://127.0.0.1:8642/health
# → {"status":"ok","agent":"ready","sessions":0}

# 模型列表
curl http://127.0.0.1:8642/v1/models
# → {"object":"list","data":[{"id":"claude-sonnet-4-6","object":"model"},...]}

# 发送消息测试 (流式) — 会消耗 LLM token
curl -N -X POST http://127.0.0.1:8642/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"drsai","messages":[{"role":"user","content":"say hi"}],"stream":true}'
# → data: {"choices":[{"delta":{"content":"Hi"},"index":0}]}
# → data: [DONE]
```

<details>
<summary>🪟 Windows (PowerShell)</summary>

```powershell
# 终端 2 — 健康检查
Invoke-RestMethod -Uri http://127.0.0.1:8642/health
# → status    agent  sessions
# → ------    -----  --------
# → ok        ready         0

# 模型列表
Invoke-RestMethod -Uri http://127.0.0.1:8642/v1/models
# → object data
# → ------ ----
# → list   {@{id=claude-sonnet-4-6; object=model}, ...}

# 发送消息测试 (流式)
$body = '{"model":"drsai","messages":[{"role":"user","content":"say hi"}],"stream":true}'
Invoke-WebRequest -Uri http://127.0.0.1:8642/v1/chat/completions `
  -Method POST `
  -ContentType "application/json" `
  -Body $body
# → data: {"choices":[{"delta":{"content":"Hi"},"index":0}]}
# → data: [DONE]
```

</details>

### 第三步：启动前端 Electron 应用

```bash
# 终端 2 (API Server 已就绪后)
cd /home/xiongdb/drsai_dev/desktop/drsai-desktop
npm run dev
```

<details>
<summary>🪟 Windows (PowerShell)</summary>

```powershell
# 终端 2 (API Server 已就绪后)
cd D:\work\DrSai\drsai\desktop\drsai-desktop
npm run dev
```

</details>

启动成功标志：
```
[electron-vite] dev server running at http://localhost:5173/
```

> **注意**：`better-sqlite3` 本地编译失败不影响 TypeScript 编译和构建，但 Electron 运行时会报错。见下方 [已知问题](#已知问题) 解决。

---

## 端口约定

| 服务 | 端口 | 说明 |
|:--|:--|:--|
| DrSai API Server | `8642` | FastAPI + uvicorn，可设 `DRSAI_API_PORT` 覆盖 |
| Electron Dev Server | `5173` | Vite 热更新开发服务器 |

---

## 当前模块状态

| 模块 | 状态 | 说明 |
|:--|:--|:--|
| Chat | ✅ 主链路 | `src/main/drsai.ts` 通过 Gateway `/v1/chat/completions` 做 SSE 流式聊天 |
| Models / Providers / Config | ✅ 主链路 | 经 `/v1/models/config*`、`/v1/config/*` 读写后端配置 |
| Sessions / Memory / Skills / Tools | ✅ 主链路 | 经 Gateway API 访问线程、长期记忆、技能和工具配置 |
| Schedules / Kanban | ✅ 已接入 | 经 `/v1/cronjobs*`、`/v1/kanban/*` 访问后端能力 |
| Gateway 页面 | ⚠️ Stub | 生命周期管理在主进程中，页面本身当前返回 `null` |
| Remote / SSH | ⚠️ 保留接口 | 配置和 IPC 入口存在，但 `drsai.ts` 当前以本地 Gateway 为稳定主路线 |
| Claw3D / Office / Agents | 🧪 扩展模块 | 代码入口存在，需按产品路线决定是否保留或隐藏 |

---

## 已知问题

### better-sqlite3 编译失败

**现象**：`npm install` 时 better-sqlite3 编译报错 `unrecognized command line option '-std=gnu++20'`

**原因**：系统 g++ 版本过旧，不支持 C++20

**解决方案**：

```bash
# Linux / macOS
npm install --ignore-scripts          # 跳过所有 postinstall (包括 better-sqlite3 编译)
rm -rf node_modules/electron          # 删除被跳过的 electron
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
npm install electron
```

```powershell
# Windows (PowerShell)
npm install --ignore-scripts          # 跳过所有 postinstall (包括 better-sqlite3 编译)
Remove-Item -Recurse -Force node_modules/electron  # 删除被跳过的 electron
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
npm install electron                  # 单独装 electron (需要下载 ~100MB, 等待几分钟)
```

> **说明**：`--ignore-scripts` 会同时跳过 better-sqlite3 的 C++ 编译 和 electron 的二进制下载。前者我们想跳过，后者必须执行。所以分两步。

**升级 g++（Linux 彻底解决）**：
```bash
sudo apt install g++-11
sudo update-alternatives --install /usr/bin/g++ g++ /usr/bin/g++-11 100
cd drsai-desktop && npm rebuild better-sqlite3
```

> **Windows 说明**：Windows 上 better-sqlite3 需要 Visual Studio Build Tools（含 C++ 工作负载）才能编译。如不想安装 VS Build Tools，使用上述 `--ignore-scripts` 方案即可。Electron 本身不依赖 better-sqlite3。
