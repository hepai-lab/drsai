# DrSai Desktop

> 基于 Hermes Desktop 改造的 DrSai 桌面应用  
> Python API Server + Electron 前端，通过 HTTP SSE 通信

## 项目结构

```
desktop/
├── drsai_api_server.py          # 🔥 Python FastAPI 后端 (端口 8642)
├── drsai-desktop/               # Electron + React 前端 (fork of hermes-desktop)
│   ├── src/main/
│   │   ├── index.ts             #   窗口管理 + IPC handlers
│   │   ├── drsai.ts             #   ✅ Agent 通信核心 (已从 hermes.ts 改造)
│   │   ├── config.ts            #   ⚠️ 待改造 (配置文件路径)
│   │   └── installer.ts         #   ⚠️ 待改造 (pip install drsai)
│   ├── src/preload/             #   contextBridge API
│   │   └── index.ts             #   ⚠️ 待改 API 命名 (hermesAPI → drsaiAPI)
│   ├── src/renderer/            #   React 渲染进程
│   │   └── src/screens/         #     Chat / Setup / Models / ...
│   ├── package.json             #   ⚠️ 待改名
│   └── electron-builder.yml     #   ⚠️ 待改配置
├── scripts/
│   ├── start.sh                 # 一键启动 (API → Electron)
│   └── dev.sh                   # 开发模式 (hot reload)
└── README.md                    # 本文件
```

## 架构

```
┌────────────────────────────┐     HTTP SSE      ┌──────────────────────┐
│  Electron + React 前端      │ ←───────────────→ │  DrSai API Server    │
│                            │  :8642            │  (FastAPI + uvicorn) │
│  drsai-desktop/            │                   │  drsai_api_server.py │
│                            │                   │                      │
│  Chat / Models / Sessions  │                   │  AgentManager        │
│  Setup / Settings / Skills │                   │  run_stream()        │
└────────────────────────────┘                   └──────────────────────┘
                                                          │
                                                          │ create_agent()
                                                          ▼
                                                 ┌──────────────────────┐
                                                 │  DrSai Assistant     │
                                                 │  (autogen_agentchat) │
                                                 └──────────────────────┘
```

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

## 改造进度

| 状态 | 文件 | 内容 |
|:--|:--|:--|
| ✅ 完成 | `src/main/drsai.ts` | hermes.ts → drsai.ts (863→383行, 缩减56%) |
| ✅ 完成 | `src/main/index.ts` | import "./hermes" → "./drsai" |
| ⚠️ 待改 | `src/main/installer.ts` | 改为 pip install drsai |
| ⚠️ 待改 | `src/main/config.ts` | 改配置文件路径 |
| ⚠️ 待改 | `src/preload/index.ts` | hermesAPI → drsaiAPI |
| ⚠️ 待改 | `package.json` | name / description |
| ⚠️ 待改 | `electron-builder.yml` | appId / productName |
| 📦 后续 | `src/renderer/.../App.tsx` | 删不需要的页面 |
| 📦 后续 | `src/renderer/.../Layout/` | 删不需要的菜单项 |
| 📦 后续 | 资源文件 | 替换 icon/logo/branding |

## 待删除模块

以下 hermes-desktop 模块在 DrSai Desktop 中不需要：

```
src/main/memory.ts, soul.ts, kanban.ts, cronjobs.ts
src/main/ssh-tunnel.ts, ssh-remote.ts, ssh-options.ts  
src/main/claw3d.ts, askpass.ts, sudoCreds.ts

src/renderer/.../Memory/, Soul/, Kanban/, Schedules/
src/renderer/.../Gateway/, Agents/, Office/
```

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
