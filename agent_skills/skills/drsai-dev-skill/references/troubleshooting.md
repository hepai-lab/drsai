# 常见问题排查

## 后端问题

### `drsai-ui: command not found`

**原因**：`drsai_ui` Python 包未安装，或安装的 Python 环境与当前 shell 不一致。

**解决**：
```bash
# 确认当前 Python 环境
which python3 && python3 --version
pip show drsai_ui

# 安装（源码）
cd /path/to/drsai/python/packages/drsai_ui
pip install -e .

# 或 pip 安装
pip install drsai_ui -U
```

如果使用了 conda 环境，确保先激活：
```bash
conda activate drsai
```

---

### 后端启动报 `HEPAI_API_KEY not set` 或 401 错误

**原因**：API Key 未配置或已过期。

**解决**：
1. 编辑 `.env` 文件，设置 `HEPAI_API_KEY=your_key`
2. 到 https://aiapi.ihep.ac.cn 获取有效 Key
3. 重新启动后端

---

### 后端端口 8081 已被占用

```bash
# 查看占用进程
lsof -i :8081

# 终止占用进程
kill $(lsof -t -i :8081)

# 或换端口启动
drsai-ui ui --port 8082
```

---

### 后端启动后立即退出

```bash
# 查看 pm2 日志
pm2 logs drsai_backend --lines 100

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
yarn develop
```

---

### 前端端口 8000 已被占用

```bash
# 换端口启动
GATSBY_DEV_PORT=8001 yarn develop
# 或
yarn develop:8001
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
pm2 logs drsai_backend --err --lines 100
pm2 logs drsai_frontend --err --lines 100

# 重启
pm2 restart drsai_backend
pm2 restart drsai_frontend
```

### pm2 进程列表中找不到目标进程

```bash
pm2 list    # 查看所有进程名称
pm2 status  # 同上
```

如果进程不在列表中，说明从未通过 pm2 启动，需要重新执行 `pm2 start` 命令。
