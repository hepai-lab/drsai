# 常见问题排查

> 优先用 `./drsai-dev.sh verify` 一键定位问题，它会逐项检查端口、登录、JWT、CORS。

## 登录与访问问题

### 本地登录报 `Unexpected end of JSON input`

**现象**：本地登录后页面报 `Unexpected end of JSON input`，进不去。

**根因**：前端把 API 请求打到了**错误的地址**（通常是相对路径 `/api`，落到前端自己 8001 端口），
后端返回 404 HTML 页面，前端对它调 `response.json()` 解析失败。

**排查**：
```bash
# 1) 确认后端在 8086 且本地登录可用
curl -s -X POST "http://localhost:8086/api/umtlocal/login?user_id=admin&password=admin123456"
# 期望: {"status":true,...,"access_token":"..."}

# 2) 看前端是否把 /api 错误指向自身（返回 HTML 即为问题）
curl -s -i "http://localhost:8001/api/auth/me" | head -5
# 若 Content-Type: text/html → 前端 API 地址配错
```

**修复**：
1. **不要**在 `frontend/.env.development` 里硬编码 `GATSBY_API_URL`。DEV 下前端会自动按
   `window.location.hostname` 推导后端地址（`src/components/utils.ts` 的 `getServerUrl()`）。
   删除/注释该行后重启前端：
   ```bash
   grep -n GATSBY_API_URL frontend/.env.development   # 应无未注释的该项
   ./drsai-dev.sh restart frontend
   ```
2. 确认后端监听 `0.0.0.0:8086`（而非 `127.0.0.1:8081`）：`./drsai-dev.sh status`
3. 一键复验：`./drsai-dev.sh verify`

---

### 外部 IP 访问失败 / CORS 被拦

**现象**：用 `localhost` 能登录，但用独立 IP（如 `10.5.8.104:8001`）访问时请求失败，控制台报 CORS。

**根因**：后端 CORS `allow_origin_regex` 未放行该来源 IP。

**修复**：后端 `python/.../ui_backend/backend/web/app.py` 的 CORS 已放行私网段
（`10.x` / `192.168.x` / `172.16-31.x`）与 `localhost`。若访问 IP 不在其中，扩展该正则后重启后端：
```bash
./drsai-dev.sh restart backend
curl -s -i -X OPTIONS "http://<你的IP>:8086/api/version" \
  -H "Origin: http://<你的IP>:8001" -H "Access-Control-Request-Method: GET" \
  | grep -i access-control-allow-origin
```

---

### 后端绑到 `127.0.0.1:8081` 而非 `0.0.0.0:8086`

**根因**：`drsai-ui ui` 的 host/port 是 CLI 参数且**不读环境变量**，默认 `127.0.0.1:8081`。
启动命令没带 `--host 0.0.0.0 --port 8086` 就会绑错地址。

**修复**：用 `./drsai-dev.sh start backend`（已内置正确参数），或手动
`drsai-ui ui --host 0.0.0.0 --port 8086 --reload`。

---

### 本地登录提示用户不存在 / 密码错误

**原因**：默认账号未播种，或密码被改过。默认账号在后端启动时由 `_seed_default_users` 创建。

**解决**：
- 默认账号：`admin/admin123456`（管理员）、`dev/dev123456`（开发者）。
- 确认 `.env` 中 `SERVICE_MODE="DEV"`，重启后端触发播种：`./drsai-dev.sh restart backend`
- 自定义默认账号：在 `.env` 设 `DRSAI_UI_DEFAULT_ADMIN_USER/PASSWORD` 等。

---

## 后端问题

### `drsai-ui: command not found`

**原因**：仓库根 `.venv` 未创建，或 `drsai_ui` 未 editable 安装。脚本只认 `$REPO_ROOT/.venv/bin/drsai-ui`，不走 conda。

**解决**：
```bash
# 确认 venv 里有 drsai-ui
ls /path/to/drsai/.venv/bin/drsai-ui

# 没有则创建 venv 并源码安装
cd /path/to/drsai
python3 -m venv .venv
.venv/bin/pip install -e apps/webui/backend
```

---

### 后端启动报 `HEPAI_API_KEY not set` 或 401 错误

**原因**：API Key 未配置或已过期。

**解决**：
1. 编辑 `.env` 文件，设置 `HEPAI_API_KEY=your_key`
2. 到 https://aiapi.ihep.ac.cn 获取有效 Key
3. 重新启动后端

---

### 后端端口 8086 已被占用

```bash
# 查看占用进程
lsof -i :8086

# 终止占用进程
kill $(lsof -t -i :8086)

# 或换端口启动（同时前端需用同端口：DRSAI_BACKEND_PORT 也会被脚本读取）
drsai-ui ui --host 0.0.0.0 --port 4391 --reload
```

---

### 后端启动后立即退出

```bash
# 查看 pm2 日志
pm2 logs drsai-dev-backend --lines 100

# 直接前台运行查看错误输出
drsai-ui ui
```

常见原因：`.env` 文件格式错误、数据库路径不可写、依赖包版本冲突。

---

## 前端问题

### `gatsby: not found`

**原因**：`node_modules` 未安装，本地 gatsby 不存在。

**解决**：
```bash
cd /path/to/drsai/frontend
yarn install --legacy-peer-deps
```

---

### `yarn install` 报依赖冲突

**原因**：部分包存在 peer dependency 不兼容，这是已知问题。

**解决**：始终使用 `--legacy-peer-deps` 标志：
```bash
yarn install --legacy-peer-deps
```

---

### 前端编译极慢或卡住

Gatsby 首次编译需要 1-5 分钟，属于正常现象。如果超过 10 分钟：

```bash
# 清理缓存后重试
cd /path/to/drsai/frontend
yarn clean
yarn dev
```

---

### 前端端口 8001 已被占用

```bash
# 换端口启动
DRSAI_FRONTEND_PORT=8002 ./drsai-dev.sh restart frontend
# 或手动
GATSBY_DEV_PORT=8002 yarn dev
```

---

### `.env.development` 缺失导致前端报错

```bash
cd /path/to/drsai/frontend
cp .env.example .env.development
```

---

### nvm 导致 node/yarn 在脚本中找不到

**原因**：nvm 通过 shell 配置加载，`bash script.sh` 不会执行 `~/.bashrc`。

**解决**：在脚本中显式加载 nvm（`run_drsai_frontend.sh` 已处理此问题）：
```bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
```

---

## pm2 问题

### pm2 进程状态为 `errored`

```bash
# 查看详细错误日志
pm2 logs drsai-dev-backend --err --lines 100
pm2 logs drsai-dev-frontend --err --lines 100

# 重启
pm2 restart drsai-dev-backend
pm2 restart drsai-dev-frontend
```

### pm2 进程列表中找不到目标进程

```bash
pm2 list    # 查看所有进程名称
pm2 status  # 同上
```

如果进程不在列表中，说明从未通过 pm2 启动，需要重新执行 `pm2 start` 命令。
