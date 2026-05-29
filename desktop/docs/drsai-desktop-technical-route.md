# DrSai Desktop 技术路线说明

> 适用范围：`desktop/drsai-desktop` Electron 桌面客户端，以及它通过 `desktop/drsai_api_server.py` / `drsai.backend.gateway` 访问的本地 DrSai Gateway。

## 1. 总体定位

DrSai Desktop 是 DrSai 的桌面客户端，目标是把 DrSai Agent 的安装、配置、模型管理、会话、技能、记忆、工具、计划任务和看板等能力封装为跨平台 GUI。当前实现以 **Electron 主进程作为安全边界和适配层**，渲染进程只通过 preload 暴露的 `window.drsaiAPI` 调用能力；主进程再通过本地 HTTP/SSE 与 Python FastAPI Gateway 通信。

核心链路如下：

```text
React Renderer
  │  window.drsaiAPI（contextBridge）
  ▼
Electron Preload
  │  ipcRenderer.invoke / ipcRenderer.on
  ▼
Electron Main
  │  Node http.request / child_process.spawn
  ▼
DrSai Gateway（FastAPI, 127.0.0.1:8642）
  │  create_agent / AgentManager.run_stream / DatabaseManager
  ▼
DrSai Assistant（autogen_agentchat + tools + memory + skills）
```

这种路线的关键收益是：

- GUI 与 DrSai Python 运行时解耦，桌面端无需直接链接 Python 代码。
- 聊天使用 SSE 流式输出，交互体验接近原生 Chat UI。
- 配置、模型、技能、记忆等管理能力统一经 Gateway 落盘，避免 UI 与 Agent 并发修改文件造成不一致。
- Electron 安全模型清晰：渲染进程不开放 Node 能力，IPC API 是显式白名单。

## 2. 技术选型

| 层级 | 技术/库 | 作用 | 选型理由 |
| --- | --- | --- | --- |
| 桌面容器 | Electron 39 | 跨平台桌面窗口、菜单、系统能力 | 成熟跨平台方案，方便复用 Web UI 与 Node 生态 |
| 构建工具 | electron-vite 5 + Vite 7 | 主进程、preload、renderer 分包构建与开发热更新 | Electron 项目结构清晰，开发体验好 |
| UI 框架 | React 19 + React DOM | 渲染进程组件化 UI | 生态成熟，适合状态驱动的聊天和配置界面 |
| 样式 | Tailwind CSS 4 + 项目 CSS | 页面样式和主题 | 快速构建一致 UI；现有组件已有 CSS 类体系 |
| 图标 | lucide-react + 自定义 icons | 导航和操作图标 | 轻量、统一、React 友好 |
| Markdown | react-markdown + remark-gfm + react-syntax-highlighter | Agent 消息、代码块和 GFM 渲染 | 支持富文本会话输出 |
| 国际化 | i18next + react-i18next | 多语言文案 | 已覆盖 `en`、`zh-CN`、`ja`、`es`、`id`、`pt-BR` 等 locale |
| 类型系统 | TypeScript 5 | 主进程、preload、renderer 类型约束 | IPC 边界复杂，类型声明能降低集成错误 |
| 测试 | Vitest + Testing Library + jsdom | 单元测试/组件测试 | 与 Vite/React 生态一致 |
| 打包 | electron-builder | Windows/macOS/Linux 安装包 | 支持 NSIS、DMG、AppImage、deb、rpm、snap 等产物 |
| 本地数据依赖 | better-sqlite3（外部化） | 历史遗留/可能的本地缓存依赖 | 当前大量状态已转向 Gateway；构建中 external，安装可能需要 native 编译 |
| 后端服务 | FastAPI + uvicorn | 本地 HTTP API Gateway | Python 端更贴近 DrSai Agent、数据库、技能、记忆和调度运行时 |
| Agent 框架 | autogen_agentchat | DrSai Assistant 对话和工具事件 | 支持流式 chunk、工具调用事件和任务结果 |

## 3. 目录与分层

```text
desktop/
├── drsai_api_server.py                 # Gateway 薄启动器：from drsai.backend.gateway import main
├── scripts/                            # start/dev/install 等脚本
├── docs/                               # 桌面端技术文档
└── drsai-desktop/
    ├── package.json                    # Electron/React 依赖和 npm scripts
    ├── electron.vite.config.ts         # 主进程、preload、renderer 构建配置
    ├── electron-builder.yml            # 桌面安装包配置
    └── src/
        ├── main/                       # Electron 主进程：窗口、IPC、Gateway 适配
        │   ├── index.ts                # BrowserWindow、安全策略、IPC handlers
        │   ├── drsai.ts                # Gateway 生命周期 + Chat SSE 核心链路
        │   ├── config.ts               # 连接配置、用户身份、env/cli config API
        │   ├── model-catalog.ts        # 模型配置 CRUD API
        │   ├── sessions.ts             # 会话/线程查询 API
        │   ├── memory.ts               # MEMORY.md / USER.md 管理 API
        │   ├── skills.ts               # 技能列表/安装/卸载 API
        │   ├── tools.ts                # TOOLS_CONFIG.json 管理 API
        │   ├── cronjobs.ts             # 计划任务 API
        │   ├── kanban.ts               # 看板 API
        │   └── security.ts             # 导航、外链、webview 白名单
        ├── preload/
        │   ├── index.ts                # contextBridge 暴露 window.drsaiAPI
        │   └── index.d.ts              # 渲染进程全局类型声明
        ├── renderer/src/
        │   ├── App.tsx                 # 启动状态机：splash/welcome/install/setup/main
        │   ├── screens/                # Chat/Sessions/Models/Skills/Memory/... 页面
        │   ├── components/             # Markdown、主题、错误边界、通用组件
        │   └── assets/                 # 图标和品牌资源
        └── shared/i18n/                # 多语言资源和类型
```

## 4. 功能模块

### 4.1 启动、安装和配置引导

- `App.tsx` 启动后先进入 splash，再执行安装/连接检查。
- 本地模式下调用 `checkInstall()` 判断 DrSai 是否安装、是否配置 API Key。
- 未安装进入 Welcome/Install；缺少 API Key 进入 Setup；检查通过进入主界面。
- `installer.ts` 负责 DrSai 版本、doctor、update、backup/import/dump 等安装维护动作。
- 连接配置持久化在 DrSai home 下的 `drsai.json`，包括 `connectionMode`、远程 URL/API Key、SSH 参数和桌面用户名称。

### 4.2 主界面导航

`Layout.tsx` 维护当前视图和已访问视图，导航项包括：

- Chat：核心聊天界面。
- Sessions：历史会话/线程列表与恢复。
- Agents、Office：Agent/办公相关页面入口。
- Kanban：任务看板。
- Models：模型配置管理。
- Providers：Provider/API Key 配置。
- Skills：技能浏览、安装、卸载和查看。
- Soul：Agent persona/AGENTS.md 类配置。
- Memory：长期记忆和用户画像。
- Tools：MCP server 与本地工具描述配置。
- Schedules：计划任务/cron job。
- Gateway：当前实现为 stub，相关生命周期管理主要在 `drsai.ts` 和 IPC 中。
- Settings：语言、连接、维护等设置。

页面采用 lazy-mount：首次访问后保持挂载，通过 `display:none` 切换，减少频繁切换 tab 时的 IPC 重拉取和 DOM 重建。

### 4.3 Chat

Chat 是桌面端最核心链路：

1. 用户在 `ChatInput` 输入文本。
2. `useChatActions` 将用户消息写入本地 React state，并调用 `window.drsaiAPI.sendMessage()`。
3. Preload 通过 IPC 调用主进程 `send-message` handler。
4. 主进程 `drsai.ts` 确认 Gateway 可用；不可用时 `spawn(python -m drsai.backend.gateway)` 启动。
5. 主进程向 `/v1/chat/completions` 发起 POST，并解析 SSE。
6. chunk、done、error、tool progress、usage 分别通过 IPC event 推回渲染进程。
7. `useChatIPC` 监听这些事件，增量更新消息气泡、工具进度和 token usage。

支持能力：

- 会话恢复：传入 `thread_id`，并把历史 messages 合并进请求。
- 用户隔离：请求中带 `user_id: getUserName()`。
- 模型选择：主进程从 `/v1/models/config` 获取默认 alias，再作为 OpenAI `model` 字段传给 Gateway。
- 工具进度：解析 `event: tool.progress` / `event: drsai.tool.progress`。
- 停止生成：渲染进程调用 `abortChat()`，主进程通过 AbortController 取消当前 HTTP 请求。
- Thread 控制：pause/resume/stop 调用 `/v1/threads/{thread_id}/{action}`。

### 4.4 会话与线程

- `sessions.ts` 通过 `/v1/threads`、`/v1/threads/{thread_id}`、`/v1/threads/search` 读取后端线程。
- 返回数据在主进程归一化为 renderer 需要的 `SessionSummary` / `SessionMessage`。
- 标题更新通过 session-cache 或 Gateway rename 相关接口衔接。

### 4.5 模型与 Provider

- 模型列表和 CRUD 走 `/v1/models/config*`：
  - `GET /v1/models/config`
  - `GET /v1/models/config/{alias}`
  - `POST /v1/models/config`
  - `PUT /v1/models/config/{alias}`
  - `DELETE /v1/models/config/{alias}`
  - `PUT /v1/models/config/default/{alias}`
- Gateway 负责读写 DrSai 的 LLM mode config，并在配置变更后让下一轮对话使用新模型配置。
- Provider/API Key、平台开关和 CLI config 相关设置走 `/v1/config/env`、`/v1/config/cli`、`/v1/config/platforms`。

### 4.6 Memory / Soul / Tools / Skills

- Memory：`/v1/memory*` 管理 `MEMORY.md` 和 `USER.md`，包括条目增删改、用户画像写入和字符限制。
- Soul：通过 `/v1/config/agents-md`、`/v1/config/user-md` 等配置类接口管理 Agent persona/user markdown。
- Tools：`/v1/config/tools*` 管理 `TOOLS_CONFIG.json`，支持 MCP server 和本地工具描述。
- Skills：`/v1/skills*` 管理已安装技能、内置可用技能、技能内容、安装和卸载。

### 4.7 Schedules 与 Kanban

- Schedules：`cronjobs.ts` 走 `/v1/cronjobs*`，Gateway 包装 DrSai ScheduledTaskManager；计划任务触发后进入与交互聊天相同的 Agent 执行管线。
- Kanban：`kanban.ts` 走 `/v1/kanban/*`，当前说明为 per-user JSON store，便于 desktop/future TUI/future CLI 共享同一 Gateway 的任务状态。

### 4.8 安全与 WebView

- BrowserWindow 启用 `contextIsolation`，renderer 通过 preload API 调用主进程。
- `security.ts` 限制：
  - 外链仅允许 `http:`、`https:`、`mailto:`，并通过 `shell.openExternal` 打开。
  - 应用自身导航只允许开发服务器 origin 或打包后的本地 `index.html`。
  - webview 仅允许本机 `http://localhost|127.0.0.1|::1:<1024-65535>`，并关闭 Node integration、启用 sandbox/contextIsolation/webSecurity。

## 5. 与后端通信方案

### 5.1 通信拓扑

当前主通道是 **Electron Main → DrSai Gateway 的本地 HTTP**：

```text
Renderer ──IPC invoke/event── Main ──HTTP JSON / SSE── FastAPI Gateway
```

渲染进程不直接请求 `127.0.0.1:8642`，原因是：

- 集中封装错误处理、超时、流式解析和 Gateway 生命周期。
- 避免 renderer 暴露过多本地端口/API 细节。
- 通过 preload 类型定义形成稳定前端 API。
- 为未来 remote/SSH/权限控制保留主进程适配层。

### 5.2 Gateway 生命周期

- 默认端口：`DRSAI_API_PORT`，缺省 `8642`。
- 健康检查：`GET /health`，主进程 `isApiServerReady()` 1.5s 超时。
- 自动启动：如果 Gateway 不可用，`startGateway()` 使用 `child_process.spawn(resolvePython(), ['-m', 'drsai.backend.gateway'])` 启动。
- Python 选择优先级：
  1. `installer.ts` 中 DrSai venv 的 `DRSAI_PYTHON` 存在时使用它。
  2. 否则使用 PATH 上的 `python`，方便开发模式。
- 主进程会捕获 stdout/stderr 输出到 Electron 日志，进程关闭后恢复 health polling。

### 5.3 Chat SSE 协议

请求：

```http
POST /v1/chat/completions
Content-Type: application/json

{
  "model": "<default_alias 或 drsai>",
  "messages": [
    {"role": "user", "content": "..."},
    {"role": "assistant", "content": "..."}
  ],
  "stream": true,
  "thread_id": "可选，会话恢复",
  "user_id": "桌面端用户标识"
}
```

响应：

```text
data: {"choices":[{"delta":{"content":"..."}}]}

event: tool.progress
data: {"tool":"...","arguments":{...}}

data: {"choices":[{"delta":{},"usage":{"total_tokens":42}}]}

data: [DONE]
```

会话 ID 通过响应头 `X-Drsai-Session-Id` 返回；主进程在 `onDone(sessionId)` 中通知渲染进程持久化当前会话。

### 5.4 JSON API 分类

| 能力 | 主进程模块 | Gateway API |
| --- | --- | --- |
| 健康检查 | `drsai.ts` | `GET /health` |
| 聊天流式 | `drsai.ts` | `POST /v1/chat/completions` |
| Thread 管理 | `drsai.ts`, `sessions.ts` | `/v1/threads*` |
| 模型配置 | `model-catalog.ts` | `/v1/models`, `/v1/models/config*` |
| env/cli config/platform | `config.ts` | `/v1/config/env*`, `/v1/config/cli*`, `/v1/config/platforms*` |
| 用户身份 | `config.ts` | `/v1/config/user-name` |
| Skills | `skills.ts` | `/v1/skills*` |
| Memory | `memory.ts` | `/v1/memory*` |
| Soul/Prompt | `soul.ts` | `/v1/config/agents-md`, `/v1/config/user-md` |
| Tools | `tools.ts` | `/v1/config/tools*` |
| Logs | `installer.ts`/IPC | `/v1/logs*` |
| Cron jobs | `cronjobs.ts` | `/v1/cronjobs*` |
| Kanban | `kanban.ts` | `/v1/kanban/*` |

### 5.5 Remote / SSH 状态

代码中保留了 `local | remote | ssh` 的连接配置和 UI/IPC 入口，但当前 `src/main/drsai.ts` 明确返回：

- `isRemoteMode() === false`
- `isRemoteOnlyMode() === false`
- SSH remote 相关实现多数为 stub

因此当前可认为 **主路线是本地 Gateway 模式**；remote/SSH 是历史兼容或未来扩展接口，不应作为现阶段稳定能力描述。

## 6. 构建、运行与打包

常用 npm scripts：

```bash
cd desktop/drsai-desktop
npm run dev              # electron-vite 开发模式
npm run typecheck        # node + web TS 类型检查
npm run test             # Vitest
npm run build            # typecheck + electron-vite build
npm run build:linux      # Linux 安装包
npm run build:mac        # macOS 安装包
npm run build:win        # Windows 安装包
```

打包由 `electron-builder.yml` 控制：

- appId：`com.hepai.drsai`
- productName：`DrSai`
- Windows：NSIS，一键安装。
- macOS：DMG，hardened runtime + notarize。
- Linux：AppImage、snap、deb、rpm。

## 7. 演进建议

1. **抽取 Gateway HTTP client**：当前多个主进程模块重复实现 `http.request`、超时和 JSON 错误处理，可统一为 `src/main/gateway-client.ts`。
2. **明确 remote/SSH 策略**：如果近期不支持，应在 UI 上隐藏或标记实验；如果要支持，应让 `drsai.ts` 根据 connection config 路由到 remote URL/SSH tunnel。
3. **统一 API 命名**：README 中历史 `hermes`/待改标记已过时，建议持续清理残留命名和 stub 页面。
4. **增强 SSE 事件模型**：当前只向 UI 暴露 tool progress，后续可结构化展示 tool result、thinking、memory query 等事件。
5. **减少 native 依赖风险**：如果不再需要本地 SQLite，可评估移除 `better-sqlite3`，降低 Windows/Linux 编译门槛。
6. **增加契约测试**：为 `window.drsaiAPI` 类型、IPC handler 和 Gateway API schema 建立轻量集成测试，避免前后端接口漂移。
