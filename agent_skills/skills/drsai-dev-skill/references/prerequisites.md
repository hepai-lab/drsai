# 启动前提条件检查与修复

在启动任何服务之前，按以下顺序检查并修复环境问题。

## 检查清单

### 1. 确认项目根目录

```bash
# 找到 drsai 项目根目录（包含 frontend/ 和 python/ 的目录）
ls /path/to/drsai/frontend /path/to/drsai/python
```

### 2. 检查后端 `.env` 文件

```bash
ls /path/to/drsai/.env
```

**不存在时**：
```bash
cp /path/to/drsai/.env.example /path/to/drsai/.env
```

然后提示用户编辑 `.env`，至少设置：
```
HEPAI_API_KEY=your_api_key_here
SERVICE_MODE=DEV
```

### 3. 检查 `HEPAI_API_KEY`

```bash
grep "HEPAI_API_KEY" /path/to/drsai/.env
```

如果值为空或是占位符，提醒用户到 https://aiapi.ihep.ac.cn 获取 API Key。

### 4. 检查 `drsai-ui` 命令

```bash
which drsai-ui
drsai-ui --help 2>&1 | head -5
```

**不可用时**，引导安装：
```bash
# 源码安装（推荐）
cd /path/to/drsai/python/packages/drsai_ui
pip install -e .

# 或 pip 安装
pip install drsai_ui -U
```

### 5. 检查 Node.js 和 yarn

```bash
node --version    # 需要 >= 18
yarn --version
```

**node 不可用时**：
```bash
# 通过 nvm 安装（如果 nvm 已安装）
export NVM_DIR="$HOME/.nvm"
source "$NVM_DIR/nvm.sh"
nvm install 22
nvm use 22
```

**yarn 不可用时**：
```bash
npm install -g yarn
```

### 6. 检查前端依赖

```bash
ls /path/to/drsai/frontend/node_modules 2>/dev/null | wc -l
```

**node_modules 为空时**：
```bash
cd /path/to/drsai/frontend
yarn install --legacy-peer-deps
```

### 7. 检查前端 `.env.development`

```bash
ls /path/to/drsai/frontend/.env.development
```

**不存在时**：
```bash
cp /path/to/drsai/frontend/.env.example /path/to/drsai/frontend/.env.development
```
