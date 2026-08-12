---
name: drsai-dev-skill
description: 当用户需要启动、停止、重启、验证 DrSai 前端或后端开发服务，或排查登录/访问/CORS 等开发环境问题时立即使用。适用场景包括：初次部署、环境更换、服务异常排查、服务状态查询、本地登录排错等。
allowed-tools: Bash(pm2:*) Bash(curl:*) Bash(yarn:*) Bash(node:*) Bash(drsai-ui:*) Bash(drsai:*) Bash(kill:*) Bash(lsof:*) Bash(ss:*) Bash(ip:*) Bash(bash:*) Bash(./drsai-dev.sh:*)
---

# DrSai 开发环境管理指南

## 首选入口：`drsai-dev.sh`

项目根目录提供统一管理脚本 `drsai-dev.sh`，**优先用它**管理开发环境，它封装了正确的
host/port、幂等预检和完整健康验证：

```bash
cd /path/to/drsai

./drsai-dev.sh start   [backend|frontend|all]   # 启动（默认 all）
./drsai-dev.sh stop    [backend|frontend|all]   # 停止
./drsai-dev.sh restart [backend|frontend|all]   # 重启（重新读取端口/.env）
./drsai-dev.sh status                            # 进程状态 + 端口监听
./drsai-dev.sh verify                            # 完整健康链路 + 推荐访问地址
./drsai-dev.sh logs    [backend|frontend]        # 查看日志
```

- 后端：`drsai-ui ui --host 0.0.0.0 --port 4291 --reload`（pm2 进程 `drsai-dev-backend`）
- 前端：`GATSBY_DEV_PORT=4290 yarn dev`（pm2 进程 `drsai-dev-frontend`）
- 端口/环境名可用 env 覆盖：`DRSAI_BACKEND_PORT`、`DRSAI_FRONTEND_PORT`、`DRSAI_CONDA_ENV`

> `run_drsai_ui.sh` 现已是转发到 `./drsai-dev.sh start all` 的薄壳，保留向后兼容。

## 访问地址与 IP（重要）

DEV 模式下前端(4290)与后端(4291)分离，前端如何找到后端：

- **自动推导（默认，推荐）**：前端 `getServerUrl()`（`frontend/src/components/utils.ts`）在 DEV
  下用 `window.location.hostname` —— 即**你浏览器地址栏里的 host** —— 拼出后端地址
  `http://<hostname>:4291/api`。所以：
  - 用 `http://localhost:4290` 访问 → 后端走 `localhost:4291`
  - 用 `http://10.5.8.104:4290` 访问 → 后端走 `10.5.8.104:4291`
  - **无需写死任何 IP**，跟随你访问用的地址自动适配。
- **不要**在 `frontend/.env.development` 里硬编码 `GATSBY_API_URL`，否则会覆盖上面的自动推导，
  导致从其他 IP 访问时后端地址错误（参见 troubleshooting 的 `Unexpected end of JSON input`）。

### 容器 / K8s 多网卡：用独立 IP

本项目常运行在 K8s Pod（Multus 多网卡）中：

| 网卡 | 示例 IP | MTU | 用途 |
|------|---------|-----|------|
| `eth0` | 10.42.x.x | 1450 | 集群 overlay 内网，**非对外** |
| `net1` | 10.5.x.x | 1500 | 独立网卡，**对外访问地址** |

`./drsai-dev.sh verify` 会自动选 MTU=1500 的独立网卡并打印推荐访问 URL。**从浏览器请用这个
独立 IP（如 `http://10.5.8.104:4290`）访问**，前端会自动把 API 指向同一 IP 的 4291。

> 容器内用 `curl http://<eth0_ip>:端口` 自测能通**不代表**外部可访问，详见
> [references/network.md](references/network.md)。

## 本地登录与默认账号

DEV 模式（`.env` 中 `SERVICE_MODE="DEV"`）走**本地账号登录**，不需要 IHEP 统一认证。

后端启动时自动播种两个默认账号（`deps.py::_seed_default_users`，账号已存在则跳过）：

| 账号 | 密码 | 角色 |
|------|------|------|
| `admin` | `admin123456` | 管理员 |
| `dev` | `dev123456` | 开发者 |

- 登录页（`/login`）选 **「本地登录」** Tab，填上面任一组即可。
- 默认值可在 `.env` 用 `DRSAI_UI_DEFAULT_ADMIN_USER/PASSWORD`、`DRSAI_UI_DEFAULT_DEV_USER/PASSWORD`
  覆盖（`config.py` 的 `Settings`，前缀 `DRSAI_UI_`）。
- 登录链路：前端 `LoginPage.tsx` → `authAPI.login()` → 后端 `POST /api/umtlocal/login` → 签发 JWT；
  之后 `RouteGuard` 用 `GET /api/auth/me` 校验 token。

## 启动前提条件

`drsai-dev.sh` 会自动预检，缺失项会明确报错。手动核对见
[references/prerequisites.md](references/prerequisites.md)。要点：

1. **后端 `.env`**：项目根必须有 `.env`（含密钥，**不会自动创建**），从 `.env.example` 复制并填 `HEPAI_API_KEY`
2. **`SERVICE_MODE="DEV"`**：启用本地登录与多用户
3. **conda 环境 `drsai`** + `drsai-ui` 命令可用（`drsai_ui` 包已 editable 安装）
4. **Node >= 18 + yarn**（脚本会自动 source nvm）
5. **前端依赖**：`frontend/node_modules`（脚本会在缺失时 `yarn install --legacy-peer-deps`）
6. **前端 `.env.development`**：缺失时脚本自动从 `.env.example` 复制（**不要**硬编码 `GATSBY_API_URL`）

## 服务验证

最简单：

```bash
./drsai-dev.sh verify
```

它按已验证的链路逐项检查并打印推荐访问地址：

1. 后端/前端端口监听
2. `GET /api/version` == 200
3. 本地登录 `admin` → 取得 JWT
4. `GET /api/auth/me`（Bearer）→ 返回 user_id
5. CORS 预检（`Origin: http://<独立IP>:4290`）→ allow-origin 匹配

逐步手动验证见 [references/verification.md](references/verification.md)。

## 手动命令参考

若不便用脚本，等价手动命令：

```bash
# 后端（开发，热加载）
cd /path/to/drsai
source .env
conda activate drsai
drsai-ui ui --host 0.0.0.0 --port 4291 --reload

# 前端（HMR）
cd /path/to/drsai/frontend
yarn install --legacy-peer-deps        # 首次
GATSBY_DEV_PORT=4290 yarn dev
```

| 后端参数 | 默认 | 说明 |
|---------|------|------|
| `--host` | `127.0.0.1`（CLI 默认）| 开发须显式设 `0.0.0.0` 才能外部访问 |
| `--port` | `8081`（CLI 默认）| 项目约定 `4291`，须显式指定 |
| `--reload` | 关 | editable 安装下代码变更自动重载 |

> ⚠️ 后端 host/port 是 CLI 参数，**不读环境变量**，必须显式 `--host 0.0.0.0 --port 4291`，
> 否则会绑到 `127.0.0.1:8081`，前端连不上。这是 `drsai-dev.sh` 帮你保证的关键点。

## 停止服务

```bash
./drsai-dev.sh stop all
# 或按端口强制
kill $(lsof -t -i :4291)
kill $(lsof -t -i :4290)
```

## 常见问题

详见 [references/troubleshooting.md](references/troubleshooting.md)，含：
- 登录报 `Unexpected end of JSON input`
- 外部 IP 访问 / CORS 被拦
- 后端绑错 host/port、`drsai-ui not found`、前端依赖与 nvm 等
