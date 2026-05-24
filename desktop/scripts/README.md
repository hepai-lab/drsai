# DrSai Desktop — 本地开发指南

支持 **Linux / macOS / Windows**。本文档面向"已有 Python 环境，准备在本机跑 Electron + Gateway 联调"的开发者。

---

## 1. 准备

| 要求 | 备注 |
|------|------|
| Python 3.10+ | 需要能 `import drsai`（项目根的 `python/packages/drsai/src` 在 `PYTHONPATH` 中或已 `pip install -e`）|
| Node.js 18+ + npm | 用于 `drsai-desktop` 的 vite / electron-vite |
| 系统包 | Linux 上需要 `xdg-utils` / `libgtk-3` 等 Electron 依赖 |

确认 Python 能导入 drsai：

```bash
python -c "import drsai, drsai.backend.gateway; print('ok')"
```

若失败，先解决 PYTHONPATH 或安装 drsai 包再继续。

---

## 2. 安装方式（二选一）

### 方式 A：轻量桩（推荐用于"已有 Python 环境，只想让 Electron 找到 Python 二进制"）

不创建 venv、不克隆，仅在 `~/.drsai/` 下挂软链接和 `drsai` CLI 入口。

```bash
# Linux / macOS
./desktop/scripts/setup_dev.sh
```

```powershell
# Windows
.\desktop\scripts\setup_dev_stubs.ps1
```

完成后 `DRSAI_PYTHON` (`~/.drsai/drsai-agent/venv/bin/python`) 指向当前 shell 的 python；`drsai` CLI 入口写到 `~/.local/bin/drsai`。

### 方式 B：完整安装

从 GitHub 克隆 + 建 venv + `pip install`：

```bash
# Linux / macOS
./scripts/install.sh

# Windows (PowerShell)
.\scripts\install.ps1
```

开发模式让安装脚本指向你本地仓库（避免重新克隆）：

```bash
./scripts/install.sh --dev-source /home/you/drsai
```

---

## 3. 启动

### 日常开发（热更新 — 改 Python 自动 reload）

```bash
# Linux / macOS
./desktop/scripts/dev.sh
```

```powershell
# Windows
.\desktop\scripts\dev.ps1
```

`dev.sh` 会做：
1. `uvicorn drsai.backend.gateway:app --reload` 启动 gateway（默认 8642）
2. 等 `/health` 返回 200
3. `cd drsai-desktop && npm run dev` 起 Electron + Vite

### 快捷启动（一键，不开 reload）

```bash
./desktop/scripts/start.sh                # 默认 8642
DRSAI_API_PORT=18642 ./desktop/scripts/start.sh
```

```powershell
.\launch_desktop.ps1
```

### 分步调试

```bash
# 终端 1 — 只起 gateway
PYTHONPATH=python/packages/drsai/src python -m drsai.backend.gateway

# 终端 2 — 只起 Electron
cd desktop/drsai-desktop && npm run dev
```

---

## 4. 验证 gateway

```bash
curl -s http://127.0.0.1:8642/health | jq .
# {"status":"ok","agent":"ready","sessions":0,"db":"sqlite:///...","user":"xiongdb"}
```

> **首启提示**：第一次访问 `/health` 会触发数据库初始化 + alembic 迁移，可能花 1–3 秒。

---

## 5. API 接口全表

所有接口以 `127.0.0.1:8642` 为前缀。`user_id` query 默认取 `DRSAI_DESKTOP_USER`（环境变量）或系统 `USER`。

### 基础

| 端点 | 用途 |
|------|------|
| `GET /health` | 健康检查 |
| `GET /v1/models` | 模型 alias 列表 |

### Chat / Sessions

| 端点 | 用途 |
|------|------|
| `POST /v1/chat/completions` | OpenAI 兼容 SSE 流式聊天，含 `tool.progress` / `tool.result` 自定义事件 |
| `GET /v1/threads` | 会话列表 |
| `GET /v1/threads/search?query=...` | 全文搜索会话 |
| `GET /v1/threads/{id}` | 单会话消息 |
| `POST /v1/threads/{id}/pause` | 暂停 agent，持久化 state |
| `POST /v1/threads/{id}/resume` | 恢复 |
| `POST /v1/threads/{id}/stop` | 停止并保存最终 state |
| `POST /v1/threads/{id}/rename?name=...` | 会话改名 |

### Models 配置

| 端点 | 用途 |
|------|------|
| `GET /v1/config/model-catalog` | 默认 catalog（含默认 alias） |
| `GET /v1/models/config` / `GET /v1/models/config/{alias}` | CRUD 读 |
| `POST/PUT/DELETE /v1/models/config[/{alias}]` | CRUD 写 |
| `PUT /v1/models/config/default/{alias}` | 设默认 alias |

### Skills

| 端点 | 用途 |
|------|------|
| `GET /v1/skills` | 用户已安装 skills |
| `GET /v1/skills/available` | bundled 可用 skills + `installed` 标记 |
| `GET /v1/skills/{path}` | 读 SKILL.md 内容 |
| `POST /v1/skills/install` | 安装（按 source 从 bundle 或直接传 content） |
| `DELETE /v1/skills/{name}` | 卸载 |

### Memory（hermes 风格 § entries + USER.md）

| 端点 | 用途 |
|------|------|
| `GET /v1/memory` | 完整状态：entries / charCount / charLimit / lastModified / stats |
| `POST /v1/memory/entries` body `{content}` | 追加一条 |
| `PUT /v1/memory/entries/{index}` body `{content}` | 替换某条 |
| `DELETE /v1/memory/entries/{index}` | 删除某条 |
| `PUT /v1/memory/user` body `{content}` | 整体写 USER.md |
| `GET /v1/memory/limits` | 字符上限常量 |

存储位置：`WORKDIR/<user_id>/configs/MEMORY.md` 和 `USER.md`，agent 启动会把内容 snapshot 进系统提示，LLM 也能通过 `memory` 工具读写。

### Soul (AGENTS.md)

| 端点 | 用途 |
|------|------|
| `GET /v1/config/agents-md` | 读 |
| `PUT /v1/config/agents-md` body `{content}` | 写 |
| `POST /v1/config/agents-md/reset` | 删除并重建默认模板，evict 缓存 agent |
| `GET /v1/config/user-md` / `PUT /v1/config/user-md` | USER.md 整体读写（与 `/v1/memory/user` 并存，便于不同 UI 入口） |

### Tools (MCP / 本地工具)

| 端点 | 用途 |
|------|------|
| `GET /v1/config/tools` | 列出 `TOOLS_CONFIG.json` 全部条目 |
| `POST /v1/config/tools` body `{type, config, name?, enabled?}` | 追加 |
| `PUT /v1/config/tools/{index}` | 替换某条 |
| `DELETE /v1/config/tools/{index}` | 删除某条 |

`type` 取值：`mcp-std` / `mcp-sse` / `local`（自由描述给 LLM 提示）。

### Env / CLI Config / Platforms

| 端点 | 用途 |
|------|------|
| `GET /v1/config/env?masked=true` | 读 `~/.drsai/.env`，默认遮蔽 `*_API_KEY/*_TOKEN/*_SECRET/*_PASSWORD` |
| `PUT /v1/config/env/{key}` body `{value}` | 写单 key，写后 `evict_user` 清缓存 agent |
| `DELETE /v1/config/env/{key}` | 删除 |
| `GET /v1/config/cli` | 读 `cli_config.json`，敏感字段遮蔽 |
| `PUT /v1/config/cli/{key}` body `{value}` | 白名单写：`user_id` / `defult_config_name` / `plan_mode` / `workspace_enabled` / `dangerous_allowed` |
| `GET /v1/config/platforms` | telegram/discord/slack/whatsapp/signal 开关状态 |
| `PUT /v1/config/platforms/{name}` body `{enabled}` | 写开关（持久化到 `cli_config.json[platforms]`，drsai 暂无 runtime） |
| `GET /v1/config/user-name` / `PUT /v1/config/user-name` | desktop user 覆盖 |

### Logs

| 端点 | 用途 |
|------|------|
| `GET /v1/logs?file=agent.log&lines=200` | 读 `FS_DIR/logs/` 末 N 行，白名单：`agent.log` / `errors.log` / `gateway.log` |
| `GET /v1/logs/list` | 列出存在的 log 文件 |

### Cron Jobs

| 端点 | 用途 |
|------|------|
| `GET /v1/cronjobs?include_disabled=true` | 列出 |
| `POST /v1/cronjobs` body `{schedule, prompt, name?, deliver?}` | 创建（schedule 自动识别 cron / interval / datetime） |
| `DELETE /v1/cronjobs/{id}` | 删除 |
| `POST /v1/cronjobs/{id}/{pause,resume,trigger}` | 控制 |

任务存储 `WORKDIR/<user_id>/scheduler/tasks/tasks_config.json`，输出在 `outputs/`。任务触发走和聊天同一条 `AgentManager.run_stream` 管线，共享 Thread state、memory、tools。

### Kanban

| 端点 | 用途 |
|------|------|
| `GET /v1/kanban/boards` | 列 board |
| `GET /v1/kanban/board` | 当前 board |
| `POST /v1/kanban/boards` body `{slug, name?, switch?}` | 新建 |
| `DELETE /v1/kanban/boards/{slug}?hard_delete=` | 归档或硬删 |
| `POST /v1/kanban/boards/{slug}/switch` | 切换当前 |
| `GET /v1/kanban/tasks?board=&status=&assignee=&include_archived=` | 列 task |
| `POST /v1/kanban/tasks` body `{title, body?, assignee?, priority?, skills?, ...}` | 新建 |
| `GET/PATCH /v1/kanban/tasks/{id}` | 单条读 / 增量改 |
| `POST /v1/kanban/tasks/{id}/comments` body `{body}` | 加评论 |

存储位置：`WORKDIR/<user_id>/kanban/store.json`（drsai 暂无 native kanban runtime，纯文件持久化）。

---

## 6. 端到端冒烟测试

任意时刻可以跑这一串确认 gateway 健康：

```bash
PORT=${DRSAI_API_PORT:-8642}
B=http://127.0.0.1:$PORT

curl -s $B/health
curl -s $B/v1/models
curl -s $B/v1/memory | jq '.memory.entries|length, .memory.charLimit'
curl -s -X POST $B/v1/memory/entries -H 'content-type:application/json' \
  -d '{"content":"prefer pytest over unittest"}' | jq '.memory.entries[-1].content'
curl -s $B/v1/config/tools
curl -s $B/v1/cronjobs
curl -s $B/v1/kanban/boards
curl -s $B/v1/logs/list
```

---

## 7. 端口 / 路径约定

| 名称 | 默认 | 覆盖方式 |
|------|------|---------|
| Gateway 端口 | `8642` | `DRSAI_API_PORT` env |
| Gateway host | `127.0.0.1` | `DRSAI_API_HOST` env |
| Vite dev server | `5173` | electron-vite 自己处理 |
| FS 根目录 | `~/.drsai` | `drsai.configs.constant.FS_DIR` 静态量；不要随意改 |
| Agent 存储 | `~/.drsai/workspace/runs/<user_id>/` | 由 `WORKDIR` 控制 |
| `.env` 文件 | `~/.drsai/.env` | gateway `_ENV_FILE` |
| Logs 目录 | `~/.drsai/logs/` | gateway `_LOG_DIR` |

---

## 8. 常见问题

**Q1. `python -m drsai.backend.gateway` 报 `No module named 'drsai'`**

```bash
export PYTHONPATH="$PWD/python/packages/drsai/src:$PYTHONPATH"
```

或 `pip install -e python/packages/drsai`。

**Q2. Electron 启动后 chat 提示 "API gateway is not ready"**

- gateway 日志看是否真的起来：`curl http://127.0.0.1:8642/health`
- 端口被占：`lsof -i :8642`
- gateway 进程内部抛异常：看 `dev.sh` 那个终端的 stderr

**Q3. 改了 `.env` 之后下一次对话没有用新值**

`PUT /v1/config/env/{key}` 后端会自动 `evict_user` 清掉缓存的 agent。如果你直接编辑了 `~/.drsai/.env` 文件，需要 restart gateway 或调一次 `PUT /v1/config/env/...`。

**Q4. `~/.drsai/workspace/drsai/drsai.db` 不存在导致 sessions/skills 空**

第一次启 gateway 时会自动建。如果你删过 `~/.drsai/`，重启 gateway 让 alembic 重新跑。

**Q5. Memory 屏看不到我手动塞到 `MEMORY.md` 的内容 / 报 drift 错误**

后端把它当成"外部改写"且加了一层 drift detection。两种解决：
- 在 UI 里走 add entry 接口（推荐）
- 把 `MEMORY.md` 改成纯 `\n§\n` 分隔的 entry 列表（每条独立），下次 `/v1/memory` 读取就会正常切

**Q6. cronjob trigger 之后输出在哪儿？**

`~/.drsai/workspace/runs/<user_id>/scheduler/outputs/`，每次执行一个 `.md` 文件。

**Q7. better-sqlite3 编译失败**

```bash
cd desktop/drsai-desktop
npm install --ignore-scripts
rm -rf node_modules/electron
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
npm install electron
```

Linux 上若要永久解决，升 g++ 到 ≥ 11 再 `npm rebuild better-sqlite3`。

**Q8. 想看 Python 端 SQL / agent 内部日志**

gateway 用 loguru 输出到 stderr。日志文件在 `~/.drsai/logs/` 里默认不会自动写入；若需要持久化，可以在 `gateway.py` lifespan 里 `logger.add("agent.log", ...)`。

---

## 9. 目录结构

```
drsai/
├── scripts/                     # 仓库级完整安装
│   ├── install.sh
│   └── install.ps1
├── launch_desktop.ps1           # Windows 顶层快捷启动
├── desktop/
│   ├── drsai_api_server.py      # 薄包装：调用 drsai.backend.gateway.main
│   ├── drsai-desktop/           # Electron + React 前端
│   │   ├── src/main/            # main 进程，所有 HTTP 包装 + IPC handlers
│   │   ├── src/preload/         # contextBridge API
│   │   └── src/renderer/        # React 屏幕
│   └── scripts/
│       ├── README.md            # 本文件
│       ├── setup_dev.sh         # Linux/macOS 轻量桩
│       ├── setup_dev_stubs.ps1  # Windows 轻量桩
│       ├── dev.sh / dev.ps1     # 开发模式（热更新）
│       └── start.sh             # 一键启动
└── python/packages/drsai/src/drsai/
    └── backend/
        ├── gateway.py           # FastAPI app — 上面所有 endpoints 都在这里
        ├── run_drsai_agent_factory.py  # AgentManager.create_agent 工厂
        ├── run_cli.py           # drsai CLI 入口
        └── ...
```

---

## 10. 改东西后该重启什么

| 改了 | 重启范围 |
|------|---------|
| `python/packages/drsai/src/drsai/` 下任何 .py | `dev.sh` 的 uvicorn `--reload` 会自动捕获；`start.sh` 启的需要 Ctrl+C 重起 |
| `desktop/drsai-desktop/src/main/**`、`src/preload/**` | electron-vite 会重启 main 进程；可能需要关掉 Electron 窗口让 vite 自动重启再打开 |
| `desktop/drsai-desktop/src/renderer/**` | 自动热更新，无需任何手动操作 |
| `~/.drsai/.env` | gateway 端 `evict_user` 会清缓存 agent；下次聊天即生效 |
| `cli_config.json` 中非白名单字段 | 手动重起 gateway |
| `llm_mode_config.yaml` | 通过 `/v1/models/config/*` 改时自动 evict；手动改文件需要重起 |
