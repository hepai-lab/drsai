# OpenDrSai 安装脚本说明

> 自包含安装器 — 便携 Python 3.12 + Node.js v22 + 源码，零系统污染。

## 文件清单

| 脚本 | 平台 | 用途 |
|------|------|------|
| `install_drsai.sh` | Linux (x64/arm64) + macOS (x64/arm64) | Bash 安装脚本，兼容 macOS 自带 bash 3.2 |
| `install_drsai.ps1` | Windows 10 1803+ (x64) | PowerShell 5.1+ 安装脚本 |

## 快速使用

### Linux / macOS

```bash
# 一行安装 (推荐)
curl -fsSL <ihepbox_url>/install_drsai.sh | bash

# 下载后运行
curl -fsSL <ihepbox_url>/install_drsai.sh -o install_drsai.sh
bash install_drsai.sh

# 指定安装目录
bash install_drsai.sh --install-dir /opt/drsai

# 强制覆盖已有安装
bash install_drsai.sh --force

# 查看帮助
bash install_drsai.sh --help
```

### Windows (PowerShell)

```powershell
# 一行安装
iwr -UseBasicParsing <ihepbox_url>/install_drsai.ps1 | iex

# 下载后运行
iwr -UseBasicParsing <ihepbox_url>/install_drsai.ps1 -OutFile install_drsai.ps1
.\install_drsai.ps1

# 指定安装目录
.\install_drsai.ps1 -InstallDir "C:\drsai"

# 强制覆盖
.\install_drsai.ps1 -Force
```

## 安装后

将 `~/.drsai/bin`（Windows 为 `%USERPROFILE%\.drsai\bin`）加入 PATH：

```bash
# Linux/macOS — 添加到 ~/.bashrc 或 ~/.zshrc
export PATH="$HOME/.drsai/bin:$PATH"
```

```powershell
# Windows PowerShell
setx PATH "%USERPROFILE%\.drsai\bin;%PATH%"
```

然后运行：

```bash
opendrsai
```

首次运行会触发 API 密钥配置向导。

## 目录结构

安装完成后，`~/.drsai`（或用户指定目录）结构如下：

```
~/.drsai/
├── packages/
│   ├── python/              # 便携 Python 3.12.13
│   ├── node/                # 便携 Node.js v22.22.3 (含 pnpm)
│   ├── src/                 # 源码 (从 drsai.zip 解压)
│   │   ├── apps/ui-tui/     # TUI 前端 (含构建产物 dist/entry.mjs)
│   │   └── cores/python/packages/drsai/  # Python 后端
│   └── venv/                # Python 虚拟环境
├── bin/
│   ├── opendrsai            # 启动脚本 (Linux/macOS)
│   ├── opendrsai.cmd        # 启动脚本 (Windows CMD)
│   └── opendrsai.ps1        # 启动脚本 (Windows PowerShell)
└── .download/               # 临时下载目录 (安装后自动删除)
```

## 安装流程 (10 步)

```
1. 平台检测        → 检测 OS + ARCH，匹配下载链接
2. 安装目录选择    → 默认 ~/.drsai，检测 ≥2GB 磁盘空间
3. 已有安装检测    → 检测 bin/opendrsai 是否已存在，提示覆盖
4. 下载文件        → 从 ihepbox 下载 3 个压缩包
5. 解压            → Python → packages/python/，Node → packages/node/，源码 → packages/src/
6. Python 环境配置 → 创建 venv，pip install -e 安装后端 (跳过 TUI 构建)
7. Node 环境配置   → npm install -g pnpm 到本地 node 目录
8. 构建 TUI        → cd apps/ui-tui && pnpm install (3次重试) && pnpm build
9. 创建启动脚本    → 生成 bin/opendrsai，硬编码环境路径
10. 验证           → 检查 drsai 导入、版本、TUI bundle、Python、Node
```

## CONFIG 配置区

脚本顶部有统一的配置区，**修改 ihepbox 链接只需改这一处**：

### Bash (`install_drsai.sh`)

```bash
IHEPBOX="https://ihepbox.ihep.ac.cn/ihepbox/index.php/s"

# 源码包
SRC_URL="${IHEPBOX}/hv9iGTJHvuQbRxE/download"

# Python — 在 get_python_url() 函数中
#   linux-x64    → ${IHEPBOX}/GQtYPVjmhn3RV2X/download
#   linux-arm64  → ${IHEPBOX}/QcqYLu2a5Nq1BD9/download
#   macos-x64    → ${IHEPBOX}/G9kgRSzhqpLldaX/download
#   macos-arm64  → ${IHEPBOX}/K0DCIdm9qpiBgKq/download
#   windows-x64  → ${IHEPBOX}/ZjS6pFmcXbnjeaD/download

# Node — 在 get_node_url() 函数中
#   linux-x64    → ${IHEPBOX}/6pM9SJSTj2bLxZu/download
#   linux-arm64  → ${IHEPBOX}/EmgmxX1I2XHd5oW/download
#   macos-x64    → ${IHEPBOX}/qwrMnqbzusemhUi/download
#   macos-arm64  → ${IHEPBOX}/70RiQ8Hzn0ZjjlO/download
#   windows-x64  → ${IHEPBOX}/SwjEFncFIEqOXYK/download
```

### PowerShell (`install_drsai.ps1`)

```powershell
$IHEPBOX = "https://ihepbox.ihep.ac.cn/ihepbox/index.php/s"

$SRC_URL    = "$IHEPBOX/hv9iGTJHvuQbRxE/download"     # 源码
$PYTHON_URL = "$IHEPBOX/ZjS6pFmcXbnjeaD/download"     # Python (windows-x64)
$NODE_URL   = "$IHEPBOX/SwjEFncFIEqOXYK/download"     # Node (windows-x64)
```

## ihepbox 下载清单

需上传到 ihepbox 并创建分享链接的文件：

| 文件 | 来源 | 大小(约) | 分享 token |
|------|------|----------|------------|
| `drsai.zip` | 完整项目结构 (不含 dist/) | ~5MB+ | `hv9iGTJHvuQbRxE` |
| `python-3.12.13-linux-x64.tar.gz` | python-build-standalone | ~40MB | `GQtYPVjmhn3RV2X` |
| `python-3.12.13-linux-arm64.tar.gz` | python-build-standalone | ~35MB | `QcqYLu2a5Nq1BD9` |
| `python-3.12.13-macos-x64.tar.gz` | python-build-standalone | ~40MB | `G9kgRSzhqpLldaX` |
| `python-3.12.13-macos-arm64.tar.gz` | python-build-standalone | ~35MB | `K0DCIdm9qpiBgKq` |
| `python-3.12.13-windows-x64.tar.gz` | python-build-standalone | ~40MB | `ZjS6pFmcXbnjeaD` |
| `node-v22.22.3-linux-x64.tar.xz` | nodejs.org | ~25MB | `6pM9SJSTj2bLxZu` |
| `node-v22.22.3-linux-arm64.tar.xz` | nodejs.org | ~25MB | `EmgmxX1I2XHd5oW` |
| `node-v22.22.3-darwin-x64.tar.xz` | nodejs.org | ~25MB | `qwrMnqbzusemhUi` |
| `node-v22.22.3-darwin-arm64.tar.xz` | nodejs.org | ~25MB | `70RiQ8Hzn0ZjjlO` |
| `node-v22.22.3-win-x64.zip` | nodejs.org | ~30MB | `SwjEFncFIEqOXYK` |
| `install_drsai.sh` | 本项目 scripts/ | ~17KB | (自定) |
| `install_drsai.ps1` | 本项目 scripts/ | ~19KB | (自定) |

## 源码包 `drsai.zip` 要求

- 格式：`.zip`
- 内容：完整项目结构，解压后顶层含 `apps/` 和 `cores/` 目录
- **不含** `apps/ui-tui/dist/entry.mjs`（安装时自动构建）
- 脚本会自动检测解压后的顶层目录名（可能是 `drsai/` 或直接展开）

## 关键设计决策

| 问题 | 解决方案 |
|------|----------|
| macOS bash 3.2 不支持关联数组 | 用 `case` 语句代替 `declare -A` |
| `curl \| bash` 模式下 stdin 被占用 | 交互输入从 `/dev/tty` 读取 |
| 系统无 `unzip` 命令 | 用便携 Python 的 `zipfile` 模块解压源码 |
| 源码无预构建 TUI bundle | 安装时执行 `pnpm install && pnpm build`，含 3 次重试 |
| `pip install -e` 触发 TUI 构建钩子 | 设 `DRSAI_SKIP_TUI_BUILD=1` 跳过，后续单独构建 |
| 启动脚本路径绑定 | 安装时硬编码 `DRSAI_UI_TUI_DIR` 绝对路径 |
| 零系统污染 | Python/Node 全部解压到 `~/.drsai/packages/`，不写系统 PATH |
| Windows ARM64 | 暂不支持（python-build-standalone 无 ARM64 Windows 构建） |

## 环境变量

启动脚本 `opendrsai` 会设置以下环境变量：

| 变量 | 说明 |
|------|------|
| `DRSAI_HOME` | 安装根目录 (默认 `~/.drsai`) |
| `DRSAI_UI_TUI_DIR` | TUI 前端目录 (指向 `packages/src/.../apps/ui-tui`) |
| `PATH` | 前置 `packages/node/bin` 以确保 node 可用 |

用户也可手动覆盖：

```bash
export DRSAI_HOME="/custom/path"
export DRSAI_UI_TUI_DIR="/custom/ui-tui"
export DRSAI_NODE="/usr/bin/node"   # 使用系统 node 而非便携版
opendrsai
```

## 命令行参数

### Bash (`install_drsai.sh`)

| 参数 | 说明 |
|------|------|
| `--install-dir <path>` | 指定安装目录 |
| `--force` | 强制覆盖已有安装（不提示） |
| `-h, --help` | 显示帮助 |

### PowerShell (`install_drsai.ps1`)

| 参数 | 说明 |
|------|------|
| `-InstallDir <path>` | 指定安装目录 |
| `-Force` | 强制覆盖已有安装（不提示 |

## 系统依赖

安装脚本本身只需要：

| 平台 | 依赖 | 说明 |
|------|------|------|
| Linux | `curl`, `tar` | 几乎所有发行版预装 |
| macOS | `curl`, `tar` | 系统自带 |
| Windows | 无额外依赖 | PowerShell 5.1+ 自带 `Invoke-WebRequest`, `Expand-Archive`, `tar` |

**不依赖**：系统 Python、系统 Node、sudo/admin 权限、系统包管理器。

## 故障排除

### TUI 依赖安装失败

`pnpm install` 需要从 npm registry 下载包。如果网络不通：

```bash
# 手动进入 TUI 目录重试
cd ~/.drsai/packages/src/*/apps/ui-tui
export PATH="$HOME/.drsai/packages/node/bin:$PATH"
pnpm install   # 或 npm install
pnpm build
```

### ihepbox 下载失败

ihepbox 分享链接可能过期。检查链接是否有效：

```bash
curl -fsSL "<url>" -o /dev/null -w "%{http_code}"
# 应返回 200，如果返回 404 或 403 则链接已失效
```

### 磁盘空间不足

```bash
# 查看默认安装目录可用空间
df -h ~

# 指定其他目录
bash install_drsai.sh --install-dir /data/drsai
```

### 验证安装

```bash
# 检查 Python
~/.drsai/packages/python/bin/python3 --version

# 检查 Node
~/.drsai/packages/node/bin/node -v

# 检查 drsai 导入
~/.drsai/packages/venv/bin/python -c "import drsai; print(drsai.__version__)"

# 检查 TUI bundle
ls -la ~/.drsai/packages/src/*/apps/ui-tui/dist/entry.mjs
```

## 版本信息

- DrSai 版本：`1.4.1`
- 便携 Python：`3.12.13` (python-build-standalone)
- 便携 Node.js：`v22.22.3` (nodejs.org 官方分发)
