# DrSai Desktop — 开发环境搭建指南

支持 **Linux / macOS / Windows** 三平台。

## 两种安装方式

| 方式 | 适用场景 | 脚本 |
|------|---------|------|
| **完整安装** | 首次使用 / 正式部署 | `scripts/install.sh` / `scripts/install.ps1` |
| **轻量桩安装** | 已有 Python 环境，跳过 venv | `desktop/scripts/setup_dev.sh` / `setup_dev_stubs.ps1` |

## 快速开始

### 方式一：完整安装（推荐）

**Windows** (PowerShell):
```powershell
# 开发模式：直接指向你的本地仓库（不克隆，不建 venv）
.\scripts\install.ps1 -DevSource D:\work\DrSai\drsai

# 正式安装：从 GitHub 克隆 + 创建 venv + pip install
.\scripts\install.ps1
```

**Linux / macOS**:
```bash
# 开发模式：指向本地仓库
./scripts/install.sh --dev-source /home/user/work/drsai

# 正式安装
curl -fsSL https://.../install.sh | bash
```

### 方式二：轻量桩安装（已有 Python 环境）

前提：`drsai` 包已在 `PYTHONPATH` 中，只需要让 Electron 找到 Python。

**Windows**:
```powershell
.\desktop\scripts\setup_dev_stubs.ps1
```

**Linux / macOS**:
```bash
./desktop/scripts/setup_dev.sh
```

## 日常开发启动

| 场景 | Windows | Linux/macOS |
|------|---------|-------------|
| **日常开发** (hot reload) | `.\desktop\scripts\dev.ps1` | `./desktop/scripts/dev.sh` |
| **快捷启动** | `.\launch_desktop.ps1` | `./desktop/scripts/start.sh` |
| **仅 API Gateway** | `python -m drsai.backend.gateway` | 同左 |
| **仅 Electron** | `cd desktop/drsai-desktop && npm run dev` | 同左 |

## 目录结构

```
├── scripts/
│   ├── install.sh           # Linux/macOS 完整安装
│   └── install.ps1          # Windows 完整安装
├── launch_desktop.ps1       # Windows 快捷启动
└── desktop/scripts/
    ├── README.md            # 本文件
    ├── setup_dev.sh         # Linux/macOS 轻量桩
    ├── setup_dev_stubs.ps1  # Windows 轻量桩
    ├── dev.sh               # Linux/macOS 开发模式 (hot reload)
    ├── dev.ps1              # Windows 开发模式 (hot reload)
    └── start.sh             # Linux/macOS 一键启动
```

## 启动架构

```
dev.ps1 / dev.sh / launch_desktop.ps1 / start.sh
  │
  ├─→ 设置环境变量 (PYTHONPATH, DRSAI_HOME, DRSAI_API_PORT)
  │
  ├─→ [dev 模式] 启动 API Gateway (uvicorn --reload, port 8642)
  │   [launch 模式] Electron 内部 spawn: python -m drsai.backend.gateway
  │
  └─→ npm run dev (Electron + Vite)
```

## API Gateway 端点一览

| 端点 | 用途 |
|------|------|
| `GET /health` | 健康检查 |
| `POST /v1/chat/completions` | SSE 流式聊天 |
| `GET /v1/threads` | 会话列表 |
| `GET /v1/threads/{id}` | 会话消息 |
| `GET /v1/threads/search` | 搜索会话 |
| `POST /v1/threads/{id}/pause` | 暂停 |
| `POST /v1/threads/{id}/resume` | 恢复 |
| `POST /v1/threads/{id}/stop` | 停止 |
| `GET /v1/skills` | Skills 列表 |
| `GET /v1/memory` | 记忆/用户资料 |
| `GET/PUT /v1/config/user-name` | 用户名 |

## 前置条件

- **Python 3.10+** + `drsai` 包
- **Node.js 18+** + npm

## 常见问题

**Q: `DRSAI_PYTHON` 找不到 (ENOENT)?**
运行对应的桩安装脚本。或使用完整安装。

**Q: `No module named 'drsai'`?**
确保 `PYTHONPATH` 包含 `python/packages/drsai/src`。

**Q: gateway 连不上?**
检查: `curl http://127.0.0.1:8642/health`

**Q: session/skills 侧边栏为空?**
确认 `~/.drsai/workspace/drsai/drsai.db` 存在。
