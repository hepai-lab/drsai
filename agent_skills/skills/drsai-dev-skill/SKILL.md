---
name: drsai-dev-skill
description: 当用户需要启动、停止、重启 DrSai 前端或后端服务，或验证服务是否正常运行时立即使用。适用场景包括：初次部署、环境更换、服务异常排查、服务状态查询等。
allowed-tools: Bash(pm2:*) Bash(curl:*) Bash(yarn:*) Bash(node:*) Bash(drsai-ui:*) Bash(drsai:*) Bash(kill:*) Bash(lsof:*) Bash(bash:*)
---

# DrSai 前后端启动与验证指南

## 项目结构概览

```
drsai/                          # 项目根目录
├── .env                        # 后端环境变量（从 .env.example 复制）
├── frontend/                   # 前端 Gatsby 项目
│   ├── .env.development        # 前端开发环境变量（从 .env.example 复制）
│   ├── run_drsai_frontend.sh   # 前端一键启动脚本
│   └── package.json
└── python/packages/drsai_ui/   # 后端 Python 包
```

## 启动前提条件

启动前**必须**检查以下前提条件，缺少则引导用户修复：

1. **后端 `.env` 文件**：项目根目录下必须有 `.env`，可从 `.env.example` 复制
2. **`HEPAI_API_KEY`**：`.env` 中必须设置有效的 API Key
3. **前端依赖**：`frontend/node_modules` 存在且非空（否则需要先 `yarn install`）
4. **Python 包**：`drsai-ui` 命令可用（`drsai_ui` 包已安装）

具体的检查与修复流程见 [references/prerequisites.md](references/prerequisites.md)。

## 后端启动

### 开发模式（推荐）

```bash
cd /path/to/drsai
source .env 2>/dev/null || true
drsai-ui ui --host 0.0.0.0 --port 4291
```

后端默认监听 `0.0.0.0:4291`，提供 API 和静态前端服务。

### 用 pm2 后台运行

```bash
cd /path/to/drsai
pm2 start -n drsai_backend "drsai-ui ui --host 0.0.0.0 --port 4291 --reload"
```

### 常用参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--host` | `0.0.0.0` | 监听地址 |
| `--port` | `4291` | 监听端口 |
| `--reload` | 关闭 | 代码变更时自动重载（开发用） |
| `--agent-config` | `agent_config.yaml` | 智能体配置文件路径 |

## 前端启动

### 一键启动（推荐）

```bash
cd /path/to/drsai/frontend
bash run_drsai_frontend.sh
```

该脚本会自动完成：环境检测 → 安装依赖 → 初始化 `.env.development` → 启动开发服务器。

### 手动步骤

```bash
cd /path/to/drsai/frontend
yarn install --legacy-peer-deps          # 首次安装依赖
cp .env.example .env.development         # 首次初始化环境变量
GATSBY_DEV_PORT=4290 yarn develop        # 启动，端口 4290
```

### 用 pm2 后台运行

```bash
cd /path/to/drsai/frontend
pm2 start -n drsai_frontend "GATSBY_DEV_PORT=4290 yarn develop"
```

### 端口说明

| 命令 | 端口 |
|------|------|
| `GATSBY_DEV_PORT=4290 yarn develop` | 4290（项目约定端口） |
| `yarn develop` | 8000（默认） |
| `GATSBY_DEV_PORT=xxxx yarn develop` | 自定义 |

## 服务验证

启动后必须验证服务实际可用，详见 [references/verification.md](references/verification.md)。

### 快速验证命令

```bash
# 验证后端
curl -s -o /dev/null -w "%{http_code}" http://localhost:4291/

# 验证前端
curl -s -o /dev/null -w "%{http_code}" http://localhost:4290/

# 检查端口是否监听
ss -tlnp | grep -E "4290|4291"
```

## IP 与端口可达性验证

服务启动后，需确认从本机各网卡 IP 均可访问，并检查防火墙是否放行了对应端口。详见 [references/network.md](references/network.md)。

### 一键网络验证

```bash
# 获取本机 IP
hostname -I

# 从各 IP 测试后端可达性
for ip in $(hostname -I); do
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 3 "http://${ip}:4291/" 2>/dev/null)
    echo "http://${ip}:4291/ → HTTP $STATUS"
done

# 从各 IP 测试前端可达性
for ip in $(hostname -I); do
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 3 "http://${ip}:4290/" 2>/dev/null)
    echo "http://${ip}:4290/ → HTTP $STATUS"
done
```

## 停止服务

```bash
# pm2 管理的服务
pm2 stop drsai_backend
pm2 stop drsai_frontend
pm2 delete drsai_backend drsai_frontend

# 按端口强制停止
kill $(lsof -t -i :4291)
kill $(lsof -t -i :4290)
```

## 常见问题

详见 [references/troubleshooting.md](references/troubleshooting.md)。
