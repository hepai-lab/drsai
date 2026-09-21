# 本地运行 WebUI 前后端

给刚 clone 仓库、想在本机同时跑 **FastAPI 后端** 和 **Gatsby 前端** 的人。

仓库里的静态前端（`apps/webui/backend/.../web/ui/`）默认不随源码提交。拉下来之后要自己起 Gatsby 开发服，或先 `yarn build` 再让后端托管打包结果。

跑通后：

| 服务 | 地址 |
|------|------|
| 前端（浏览器打开这个） | http://localhost:8000 |
| 后端 API | http://localhost:8086/api |
| 后端健康检查 | http://localhost:8086/api/version |

DEV 模式本地账号：`admin` / `admin123456`（管理员），`dev` / `dev123456`（开发者）。

---

## 1. 环境要求

- **Python 3.12**（3.11 也可以）
- **Node.js ≥ 20**（推荐 22）
- **yarn**（前端锁文件是 `yarn.lock`）
- **pnpm**（源码安装 `drsai` 时会编译 TUI；装不了可以跳过，见下文）
- 一台能访问 [HepAI](https://ai.ihep.ac.cn/) 的网络，用来申请 `HEPAI_API_KEY`

可选：

- **conda** 或 Python `venv`
- **Docker**：只在需要浏览器 VNC / Python 沙盒（DrSai-General）时才要
- **pm2**：只在用 `apps/webui/drsai-dev.sh` 托管进程时才要

Windows 建议在 WSL2 里按 Linux 步骤走。

---

## 2. 克隆仓库

```bash
git clone https://github.com/hepai-lab/drsai.git drsai
# 或所内 GitLab：
# git clone https://code.ihep.ac.cn/hepai/drsai drsai

cd drsai
```

下文把这个目录叫**仓库根**。

---

## 3. 安装 Python 包

```bash
conda create -n drsai python=3.12
conda activate drsai

# 核心框架（安装时会尝试用 pnpm 编译 apps/ui-tui）
pip install -e cores/python/packages/drsai

# WebUI 后端
pip install -e cores/python/packages/drsai_ext
pip install -e apps/webui/backend
```

没有 conda 时：

```bash
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -e cores/python/packages/drsai
pip install -e cores/python/packages/drsai_ext
pip install -e apps/webui/backend
```

确认入口存在：

```bash
which drsai-ui
drsai-ui --help
```

WebUI 后端命令是 **`drsai-ui ui`**。`opendrsai` / `drsai` 启动的是终端 TUI，不是网页。

### 编译 TUI 失败时

源码安装 `drsai` 会跑 `pnpm install && pnpm build`。如果暂时不需要 TUI：

```bash
mkdir -p apps/ui-tui/dist && touch apps/ui-tui/dist/entry.mjs
pip install -e cores/python/packages/drsai
```

---

## 4. 配置环境变量

### 4.1 后端：`apps/webui/.env`

后端优先读 **`apps/webui/.env`**，仓库根的 `.env` 只作补充（已存在的变量不会被覆盖）。

```bash
cp .env.example apps/webui/.env
```

至少改这两项：

```bash
SERVICE_MODE="DEV"
HEPAI_API_KEY="sk-你的密钥"
```

密钥在 [HepAI 个人中心](https://ai.ihep.ac.cn/) → API 密钥 创建。

`SERVICE_MODE="DEV"` 会启用本地账号登录，不走 IHEP / HepAI OIDC。不要把开发机随手改成 `PROD`，除非已经配好 OIDC。

### 4.2 前端：`apps/webui/frontend/.env.development`

```bash
cp apps/webui/frontend/.env.example apps/webui/frontend/.env.development
```

**不要**写入 `GATSBY_API_URL`。开发模式下浏览器走同源 `/api`，Gatsby 再代理到本机后端。写死成 `https://drsaiv2.ihep.ac.cn/api` 或其它远程地址，会导致登录打到别人的环境，或出现 `Unexpected end of JSON input`。

可选覆盖后端端口（默认 **8086**，必须和下面启动命令一致）：

```bash
# GATSBY_DEV_API_PORT="8086"
```

---

## 5. 启动（推荐：两个终端）

端口约定：

| 进程 | 端口 | 说明 |
|------|------|------|
| FastAPI | **8086** | 必须和 `GATSBY_DEV_API_PORT` 一致 |
| Gatsby | **8000** | `yarn dev` 默认值 |

`drsai-ui ui` 不指定 `--port` 时默认是 **8081**，而 Gatsby 代理默认是 **8086**。两边对不上，页面能开、登录会挂。本地开发请显式传 `--port 8086`。

### 终端 1：后端

```bash
conda activate drsai          # 或 source .venv/bin/activate
cd /path/to/drsai

drsai-ui ui --host 0.0.0.0 --port 8086 --reload
```

`--reload` 会在 Python 代码变更后自动重载。数据默认写在 `~/.drsai_ui/`。

想换数据目录：

```bash
drsai-ui ui --host 0.0.0.0 --port 8086 --reload --appdir "$HOME/.drsai_ui_dev"
```

自检：

```bash
curl -s http://localhost:8086/api/version
```

应返回 JSON（HTTP 200），不是 HTML。

### 终端 2：前端

```bash
# Node 若用 nvm：
# export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 22

cd /path/to/drsai/apps/webui/frontend
npm install -g yarn            # 已有可跳过
yarn install --legacy-peer-deps
yarn dev
```

第一次 Gatsby 编译通常要 **1–5 分钟**。看到 `You can now view ... in the browser` 后再打开：

[http://localhost:8000](http://localhost:8000)

登录页选 **「本地登录」**，用 `admin` / `admin123456`。

HTTP 请求走 `localhost:8000/api` → 代理到 `127.0.0.1:8086`。聊天 WebSocket 会直连 `hostname:8086`，所以后端必须监听 `0.0.0.0:8086`，不能只绑 `127.0.0.1` 以外的地址后却用别的端口。

---

## 6. 验证

```bash
# 后端活着
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8086/api/version
# 期望：200

# 本地登录能拿到 JWT
curl -s -X POST 'http://localhost:8086/api/umtlocal/login?user_id=admin&password=admin123456'
# 期望：JSON 里有 access_token
```

浏览器 DevTools → Network：页面请求应是 `localhost:8000/api/...`，状态 200，响应是 JSON。如果 `/api/auth/me` 返回 HTML，说明前端没代理到后端（常见原因：`GATSBY_API_URL` 写错，或后端没在 8086）。

---

## 7. 改端口

任何一边改了，另一边必须一起改。

```bash
# 后端改到 4391
drsai-ui ui --host 0.0.0.0 --port 4391 --reload

# 前端跟上
cd apps/webui/frontend
GATSBY_DEV_API_PORT=4391 GATSBY_DEV_PORT=8002 yarn dev
```

然后打开 http://localhost:8002 。

---

## 8. 可选：pm2 一键脚本

本仓库开发机常用 `apps/webui/drsai-dev.sh`（默认后端 **8086**、前端 **8001**）。需要先装 [pm2](https://pm2.keymetrics.io/)，并且 **`apps/webui/.env` 必须存在**（脚本不会自动创建）。

```bash
npm install -g pm2
cp .env.example apps/webui/.env   # 填 HEPAI_API_KEY、SERVICE_MODE=DEV

cd apps/webui
./drsai-dev.sh start all
./drsai-dev.sh verify
./drsai-dev.sh logs backend
./drsai-dev.sh stop all
```

该脚本默认找仓库根 `.venv/bin/drsai-ui`。如果你用的是 conda 而不是仓库根 `.venv`：

```bash
export DRSAI_VENV_DIR="$(dirname "$(dirname "$(which drsai-ui)")")"
./drsai-dev.sh start all
```

---

## 9. 可选：只跑后端（托管已打包的前端）

不需要热更新时，把 Gatsby 编进后端静态目录，只起一个进程：

```bash
cd apps/webui/frontend
cp .env.example .env.development   # 同样不要写 GATSBY_API_URL
yarn install --legacy-peer-deps
yarn build                         # 同步到 backend/.../web/ui/

cd /path/to/drsai
drsai-ui ui --host 0.0.0.0 --port 8081
```

浏览器打开 http://localhost:8081 。这是 README 里「一键启动」那条路径；源码树里如果还没 `yarn build` 过，页面会是空的。

---

## 10. 常见问题

### `drsai-ui: command not found`

当前 Python 环境没装 `drsai_ui`，或没用安装时的那个环境：

```bash
conda activate drsai
pip install -e apps/webui/backend
which drsai-ui
```

### 登录后 `Unexpected end of JSON input`

前端把 `/api` 打到了自己（8000）或错误主机，拿到的是 HTML。检查：

1. `apps/webui/frontend/.env.development` 里没有未注释的 `GATSBY_API_URL`
2. 后端确实在 **8086**（或你设的 `GATSBY_DEV_API_PORT`）
3. 改完环境变量后必须重启 Gatsby（环境变量编译进 bundle）

```bash
curl -s -i http://localhost:8000/api/version | head
# Content-Type 应是 application/json，不要是 text/html
```

### 页面能开，聊天连不上

WebSocket 直连 `主机:8086`，不走 Gatsby 代理。确认后端 `--port 8086 --host 0.0.0.0`，本机防火墙放行该端口。

### `yarn install` 报 peer dependency

始终加 `--legacy-peer-deps`：

```bash
yarn install --legacy-peer-deps
```

### Gatsby 卡住超过 10 分钟

```bash
cd apps/webui/frontend
yarn clean
yarn dev
```

### 默认账号登不上

确认 `apps/webui/.env` 里 `SERVICE_MODE="DEV"`，然后重启后端。账号只在库里还没有时播种；改过密码不会被脚本覆盖。

### 模型调用 401 / 提示没有 API Key

`HEPAI_API_KEY` 为空、过期，或 `.env` 放错目录。放到 `apps/webui/.env` 后重启 `drsai-ui`。

### 端口被占用

```bash
# Linux
ss -ltnp | grep -E '8000|8086'
kill $(ss -ltnp | awk '/:8086 /{print}')   # 先看清楚 PID 再杀
```

---

## 目录对照

```text
drsai/
├── .env.example                          # 后端环境变量模板
├── apps/webui/
│   ├── .env                              # 你复制出来的后端配置（勿提交）
│   ├── drsai-dev.sh                      # 可选：pm2 托管
│   ├── backend/                          # FastAPI，入口 drsai-ui
│   └── frontend/                         # Gatsby
│       ├── .env.example
│       └── .env.development              # 你复制出来的前端配置（勿提交）
├── cores/python/packages/drsai/          # 智能体核心
└── cores/python/packages/drsai_ext/
```
