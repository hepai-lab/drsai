# DrSai WebUI 前后端安装文档

本文档涵盖 **开发环境** 和 **生产环境** 的完整安装与启动流程。

---

## 目录

- [1. 环境要求](#1-环境要求)
- [2. 后端（FastAPI）安装](#2-后端fastapi安装)
- [3. 前端（Gatsby）安装](#3-前端gatsby安装)
- [4. 配置文件](#4-配置文件)
- [5. 启动运行](#5-启动运行)
  - [5.1 开发模式（两个终端）](#51-开发模式两个终端)
  - [5.2 开发模式（pm2 一键脚本）](#52-开发模式pm2-一键脚本)
  - [5.3 生产模式（pm2 一键脚本）](#53-生产模式pm2-一键脚本)
  - [5.4 只跑后端（托管已打包的前端）](#54-只跑后端托管已打包的前端)
- [6. 默认端口速查](#6-默认端口速查)
- [7. 验证方法](#7-验证方法)
- [8. 常见问题](#8-常见问题)
- [9. 目录结构](#9-目录结构)

---

## 1. 环境要求

| 组件 | 要求 | 说明 |
|------|------|------|
| **Python** | 3.12（3.11 也可） | 推荐用 conda 或 venv |
| **Node.js** | ≥ 20（推荐 22） | 仓库根 `.nvmrc` 写的是 `22` |
| **yarn** | v1（classic） | 前端锁文件是 `yarn.lock` v1 |
| **pnpm** | 可选 | 源码安装 `drsai` 时会用它编译 TUI；不装也可以跳过 |
| **网络** | 能访问 [HepAI](https://ai.ihep.ac.cn/) | 用于申请 `HEPAI_API_KEY` |
| **pm2** | 可选 | 仅在用 `drsai-dev.sh` / `drsai-prod.sh` 托管进程时需要 |
| **Docker** | 可选 | 仅在需要浏览器 VNC / Python 沙盒（DrSai-General agent）时需要 |

**Windows 用户**：建议在 WSL2 里按 Linux 步骤操作。

---

## 2. 后端（FastAPI）安装

### 2.1 创建虚拟环境

```bash
# 方式一：conda
conda create -n drsai python=3.12
conda activate drsai

# 方式二：venv
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
```

### 2.2 安装核心包（按顺序）

```bash
# 1. 智能体核心框架（安装时会尝试用 pnpm 编译 TUI）
pip install -e cores/python/packages/drsai

# 2. drsai 扩展库
pip install -e cores/python/packages/drsai_ext

# 3. WebUI 后端
pip install -e apps/webui/backend
```

### 2.3 如果 TUI 编译失败

源码安装 `drsai` 时会自动跑 `pnpm install && pnpm build`。如果暂时不需要 TUI：

```bash
mkdir -p apps/ui-tui/dist && touch apps/ui-tui/dist/entry.mjs
pip install -e cores/python/packages/drsai
```

### 2.4 验证安装

```bash
which drsai-ui
drsai-ui --help
```

> **注意**：WebUI 后端的启动命令是 **`drsai-ui ui`**。`opendrsai` / `drsai` 启动的是终端 TUI，不是网页后端。

---

## 3. 前端（Gatsby）安装

### 3.1 确认 Node.js 版本

```bash
node --version   # 应 ≥ 20，推荐 22
```

### 3.2 安装 yarn 和依赖

```bash
cd apps/webui/frontend

# 安装 yarn（如果还没有）
npm install -g yarn

# 安装依赖（必须加 --legacy-peer-deps）
yarn install --legacy-peer-deps
```

> **为什么加 `--legacy-peer-deps`**：Gatsby 5 的部分插件 peer dependency 版本范围较宽，不加这个参数会报错。

### 3.3 主要 npm scripts

| 命令 | 说明 |
|------|------|
| `yarn dev` | 启动 Gatsby 开发服务器（HMR，默认端口 8000） |
| `yarn build` | 生产构建 → 输出到 `public/` → 自动同步到后端的 `web/ui/` |
| `yarn build:dev` | 开发模式构建（不压缩） |
| `yarn serve` | 用 gatsby serve 托管已构建的静态页面 |
| `yarn clean` | 清空 Gatsby 缓存 |

---

## 4. 配置文件

### 4.1 后端环境变量：`apps/webui/.env`

从仓库根目录的模板创建：

```bash
cp .env.example apps/webui/.env
```

至少配置这两项：

```bash
SERVICE_MODE="DEV"                       # DEV 模式启用本地账号登录
HEPAI_API_KEY="sk-你的密钥"              # 从 https://ai.ihep.ac.cn/ 个人中心获取
```

**关键变量说明：**

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `SERVICE_MODE` | DEV | `DEV`=本地账号登录；`PROD`=OIDC/IHEP SSO 登录 |
| `HEPAI_API_KEY` | 无 | 访问 LLM 和文件系统的 API 密钥，**必填** |
| `DRSAI_CONTEXT_TYPE` | sqlite | 对话记忆存储；可选 `ragflow` |
| `DRSAI_UI_DEFAULT_ADMIN_USER` | admin | DEV 模式自动创建的管理员账号 |
| `DRSAI_UI_DEFAULT_ADMIN_PASSWORD` | admin123456 | DEV 模式管理员密码 |
| `DRSAI_UI_DEFAULT_DEV_USER` | dev | DEV 模式自动创建的开发者账号 |
| `DRSAI_UI_DEFAULT_DEV_PASSWORD` | dev123456 | DEV 模式开发者密码 |

> **加载顺序**：后端优先读 `apps/webui/.env`，仓库根的 `.env` 只作补充（已存在的变量不会被覆盖）。

### 4.2 前端环境变量：`apps/webui/frontend/.env.development`

```bash
cp apps/webui/frontend/.env.example apps/webui/frontend/.env.development
```

**重要：不要写入 `GATSBY_API_URL`！**

默认注释掉 `GATSBY_API_URL`。开发模式下浏览器请求同源 `/api`，由 Gatsby 的 `gatsby-node.ts` 自动代理到本机后端（默认 `127.0.0.1:8086`）。

写死成 `https://drsaiv2.ihep.ac.cn/api` 或其它远程地址会导致登录打到错误环境。

**可用变量：**

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `GATSBY_CPU_COUNT` | 16 | Gatsby 并行编译核数 |
| `GATSBY_DEV_API_PORT` | 8086 | 前端代理到的后端端口 |
| `GATSBY_ENABLE_LOCAL_REGISTRATION` | false | 是否显示本地注册入口 |
| `GATSBY_ALLOW_REGISTER` | false | 同上（任一为 true 即显示） |

### 4.3 平台配置：`~/.drsai/config.toml`

后端通过该文件确定 HepAI 平台地址：

```toml
active_platform = "production"

[platforms.production]
portal_url = "https://ai.ihep.ac.cn"
base_url = "https://aiapi.ihep.ac.cn/apiv2"

[platforms.development]
portal_url = "https://ai-dev.ihep.ac.cn"
base_url = "https://ai-dev.ihep.ac.cn/apiv2"
```

---

## 5. 启动运行

### 5.1 开发模式（两个终端）

**端口约定：后端 8086，前端 8000。**

#### 终端 1：启动后端

```bash
conda activate drsai   # 或 source .venv/bin/activate
cd /path/to/drsai

drsai-ui ui --host 0.0.0.0 --port 8086 --reload
```

- `--reload`：Python 代码变更后自动重载
- `--host 0.0.0.0`：允许浏览器 WebSocket 连接（不只绑 127.0.0.1）
- 数据默认写在 `~/.drsai_ui/`

自定义数据目录：

```bash
drsai-ui ui --host 0.0.0.0 --port 8086 --reload --appdir "$HOME/.drsai_ui_dev"
```

#### 终端 2：启动前端

```bash
cd /path/to/drsai/apps/webui/frontend
yarn dev
```

第一次 Gatsby 编译通常需要 **1–5 分钟**。看到 `You can now view ... in the browser.` 后打开：

> **http://localhost:8000**

登录页选**「本地登录」**，用 `admin` / `admin123456`。

#### 改端口示例

```bash
# 后端改到 4391
drsai-ui ui --host 0.0.0.0 --port 4391 --reload

# 前端跟上
cd apps/webui/frontend
GATSBY_DEV_API_PORT=4391 GATSBY_DEV_PORT=8002 yarn dev
```

然后访问 **http://localhost:8002**。

---

### 5.2 开发模式（pm2 一键脚本）

仓库提供了 `apps/webui/drsai-dev.sh` 脚本，用 pm2 托管前后端进程。

**前提条件：**

```bash
npm install -g pm2
cp .env.example apps/webui/.env   # 填写 HEPAI_API_KEY、SERVICE_MODE=DEV
```

**使用方式：**

```bash
cd apps/webui

# 启动全部
./drsai-dev.sh start all          # 后端 8086 + 前端 8001

# 分别启动
./drsai-dev.sh start backend
./drsai-dev.sh start frontend

# 查看状态
./drsai-dev.sh status

# 健康检查
./drsai-dev.sh verify

# 查看日志
./drsai-dev.sh logs backend
./drsai-dev.sh logs frontend

# 重启
./drsai-dev.sh restart all

# 停止
./drsai-dev.sh stop all
```

**默认端口：** 后端 `8086`，前端 `8001`

可覆盖的环境变量：

| 变量 | 默认 | 说明 |
|------|------|------|
| `DRSAI_BACKEND_PORT` | 8086 | 后端端口 |
| `DRSAI_FRONTEND_PORT` | 8001 | 前端端口 |
| `DRSAI_APPDIR` | `~/.drsai_ui_8086` | 后端数据目录 |
| `DRSAI_VENV_DIR` | `仓库根/.venv` | 虚拟环境路径 |
| `DRSAI_ADMIN_USER` | admin | 本地管理员账号 |
| `DRSAI_ADMIN_PASS` | admin123456 | 本地管理员密码 |

---

### 5.3 生产模式（pm2 一键脚本）

生产模式使用 `apps/webui/drsai-prod.sh`，与开发模式的主要区别：

- 后端端口默认 **8081**（非 8086），前端 **8000**
- 后端不带 `--reload` 热重载（除非设 `DRSAI_BACKEND_RELOAD=1`）
- 前端用 `yarn build` + `yarn serve`（静态构建），不走 HMR
- 数据目录默认 `~/.drsai_ui`
- `.env` 中 `SERVICE_MODE` 设为 `PROD`

**使用方式：**

```bash
cd apps/webui

# 启动
./drsai-prod.sh start all

# 验证
./drsai-prod.sh verify

# 查看状态 / 日志
./drsai-prod.sh status
./drsai-prod.sh logs backend

# 停止
./drsai-prod.sh stop all
```

可覆盖的环境变量与 dev 脚本一致，多一个：

| 变量 | 默认 | 说明 |
|------|------|------|
| `DRSAI_BACKEND_RELOAD` | 0 | 设为 1 时后端启用热重载 |

---

### 5.4 只跑后端（托管已打包的前端）

如果不需要前端热更新，可以把前端构建结果嵌入到后端，只起一个进程：

```bash
cd apps/webui/frontend
cp .env.example .env.development     # 同样不要写 GATSBY_API_URL
yarn install --legacy-peer-deps
yarn build                           # 构建 + 自动同步到 backend/.../web/ui/

cd /path/to/drsai
drsai-ui ui --host 0.0.0.0 --port 8081
```

浏览器打开 **http://localhost:8081**。

> `yarn build` 会自动将 `public/` 目录同步到 `apps/webui/backend/src/drsai_ui/ui_backend/backend/web/ui/`。

---

## 6. 默认端口速查

| 脚本 / 场景 | 后端端口 | 前端端口 | 前端启动方式 |
|-------------|---------|---------|-------------|
| 手动 `drsai-ui ui --port 8086` + `yarn dev` | 8086 | 8000 | `yarn dev`（HMR） |
| `drsai-dev.sh`（开发 pm2） | 8086 | 8001 | `yarn dev`（HMR） |
| `drsai-prod.sh`（生产 pm2） | 8081 | 8000 | `yarn build` + `yarn serve` |
| 只跑后端（托管静态前端） | 8081 | 同后端 | `yarn build` → 嵌入后端 |
| `scripts/run_webui_*_dev.sh` | 4291 | 4290 | `yarn dev`（HMR） |

---

## 7. 验证方法

### 7.1 后端健康检查

```bash
# 版本接口
curl -s http://localhost:8086/api/version

# 期望：返回 JSON（HTTP 200），不是 HTML
```

### 7.2 本地登录测试

```bash
# DEV 模式下测试登录
curl -s -X POST 'http://localhost:8086/api/umtlocal/login?user_id=admin&password=admin123456'

# 期望：返回 JSON 含 access_token
```

### 7.3 前端代理验证

浏览器 DevTools → Network 面板：

- 页面请求应是 `localhost:8000/api/...`
- 状态码 200
- 响应 Content-Type 为 `application/json`

如果 `/api/auth/me` 返回 HTML，说明前端没有正确代理到后端。

### 7.4 一键验证（pm2 脚本）

```bash
cd apps/webui
./drsai-dev.sh verify

# 输出示例：
# [ok] 后端端口 8086 监听中
# [ok] 前端端口 8001 监听中
# [ok] GET /api/version == 200
# [ok] 本地登录 (admin) → 取得 token
# [ok] GET /api/auth/me (Bearer) → user_id
# [ok] CORS 预检 → allow-origin 匹配
# 结果: 5 通过, 0 失败
# 访问地址: http://192.168.x.x:8001
```

---

## 8. 常见问题

### 8.1 `drsai-ui: command not found`

当前 Python 环境没装 `drsai_ui`：

```bash
conda activate drsai       # 或 source .venv/bin/activate
pip install -e apps/webui/backend
which drsai-ui
```

### 8.2 登录后 `Unexpected end of JSON input`

前端把 `/api` 打到了自己或错误主机，拿到 HTML 而非 JSON。

检查：

1. `apps/webui/frontend/.env.development` 中 `GATSBY_API_URL` 必须是**注释掉的**
2. 后端确实在 **8086**（或你设的 `GATSBY_DEV_API_PORT`）
3. 改过环境变量后**必须重启 Gatsby**（变量在编译时被打进 bundle）

验证：

```bash
curl -s -i http://localhost:8000/api/version | head
# Content-Type 应为 application/json
```

### 8.3 页面能开，聊天连不上

WebSocket 直连 `主机:8086`，不走 Gatsby 代理。确认：

- 后端 `--port 8086 --host 0.0.0.0`
- 本机防火墙放行该端口

### 8.4 `yarn install` 报 peer dependency

始终加 `--legacy-peer-deps`：

```bash
yarn install --legacy-peer-deps
```

### 8.5 Gatsby 卡住超过 10 分钟

```bash
cd apps/webui/frontend
yarn clean
yarn dev
```

### 8.6 默认账号登不上

1. 确认 `apps/webui/.env` 中 `SERVICE_MODE="DEV"`
2. 重启后端
3. 账号只在数据库中还没有时自动播种；如果已被修改过密码，不会被覆盖

### 8.7 模型调用 401 / 提示没有 API Key

- `HEPAI_API_KEY` 为空、过期
- `.env` 放错了位置（应在 `apps/webui/.env`）
- 修正后重启 `drsai-ui`

### 8.8 端口被占用

```bash
# 检查
ss -ltnp | grep -E '8000|8086'

# 杀进程（先确认 PID）
kill $(ss -ltnp | awk '/:8086 /{print}')
```

---

## 9. 目录结构

```text
drsai/                                             # 仓库根
├── .env.example                                   # 后端环境变量模板
├── .nvmrc                                         # Node 版本：22
├── apps/webui/
│   ├── .env                                       # 后端配置（自己复制 .env.example，勿提交）
│   ├── .drsai-prod.local.env                      # 生产环境本地覆盖（可选）
│   ├── drsai-dev.sh                               # 开发环境 pm2 管理脚本
│   ├── drsai-prod.sh                              # 生产环境 pm2 管理脚本
│   ├── backend/                                   # FastAPI 后端
│   │   ├── pyproject.toml                         # Python 包定义（入口：drsai-ui）
│   │   └── src/drsai_ui/
│   │       ├── ui_backend/backend/web/            # Web API 路由
│   │       ├── ui_backend/backend/web/ui/         # 前端构建产物（yarn build 同步到此处）
│   │       ├── agent_factory/                     # Agent 工厂
│   │       └── drsai_adapter/                     # SSO、平台适配
│   ├── frontend/                                  # Gatsby 前端
│   │   ├── .env.example                           # 前端环境变量模板
│   │   ├── .env.development                       # 前端开发配置（自己复制）
│   │   ├── package.json                           # Node 依赖
│   │   ├── gatsby-config.ts                       # Gatsby 配置
│   │   ├── gatsby-node.ts                         # Dev 代理 + Webpack 别名
│   │   └── src/                                   # 前端源码
│   └── scripts/
│       ├── run_webui_backend_dev.sh               # 独立后端启动脚本
│       └── run_webui_frontend_dev.sh              # 独立前端启动脚本
├── cores/python/packages/drsai/                   # 智能体核心
├── cores/python/packages/drsai_ext/               # drsai 扩展
└── docs/webui/                                    # WebUI 文档
    ├── local-dev.md                               # 本地开发（英文版，内容较简略）
    └── install.md                                 # 本文档
```