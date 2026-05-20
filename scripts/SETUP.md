# DrSai Desktop — 开发者安装指南

支持 **Linux / macOS / Windows** 三平台。

## 核心原则

**项目目录不固定** — 所有脚本通过自身位置自动推导项目根目录，无需修改任何路径。

```
假设你把项目 clone 到 /home/me/work/drsai

desktop/scripts/dev.sh
  → SCRIPT_DIR = /home/me/work/drsai/desktop/scripts/
  → PROJECT_DIR = /home/me/work/drsai/      ← 自动推导
```

## 方式一：完整安装（推荐）

创建 venv + pip install -e，Electron 通过 `DRSAI_PYTHON` 找到 venv Python。

### Linux / macOS

```bash
# 假设项目在 /home/you/drsai
bash scripts/install.sh \
    --dev-source /home/you/drsai \
    --skip-setup
```

这条命令做四件事：
1. `ln -s /home/you/drsai ~/.drsai/drsai-agent`
2. `python -m venv ~/.drsai/drsai-agent/venv`
3. `venv/bin/pip install -e python/packages/drsai`
4. 写 `drsai` CLI wrapper

完成后 `~/.drsai/drsai-agent/venv/bin/python` 可用，Electron 的 `startGateway` 直接使用。

> **注意**：venv 会创建在项目目录下（因为是软链接），确保 `.gitignore` 有 `venv/`。

### Windows

```powershell
# 假设项目在 D:\work\drsai
.\scripts\install.ps1 -DevSource D:\work\drsai -SkipSetup
```

等效操作，`DevSource` 参数指定你的项目路径。

## 方式二：轻量桩（已有 Python 环境）

不创建 venv，只在 `~/.drsai/` 下放桩文件指向系统 Python。

前提：`drsai` 包已在 `PYTHONPATH` 中，依赖已安装。

### Linux / macOS

```bash
./desktop/scripts/setup_dev.sh
```

### Windows

```powershell
.\desktop\scripts\setup_dev_stubs.ps1
```

## 日常启动

安装完成后，日常开发二选一：

| 模式 | Windows | Linux/macOS |
|------|---------|-------------|
| **Hot Reload** (改 Python 自动重启) | `.\desktop\scripts\dev.ps1` | `./desktop/scripts/dev.sh` |
| **快速启动** (Electron 内部 spawn) | `.\launch_desktop.ps1` | `./desktop/scripts/start.sh` |

详细命令见 `desktop/scripts/README.md`。

## 完整流程（从零开始）

```bash
# ========== Linux/macOS ==========

git clone https://github.com/hepai-lab/drsai.git
cd drsai

# 安装 uv (Python 包管理器)
curl -LsSf https://astral.sh/uv/install.sh | sh
uv sync --directory python/packages/drsai

# 开发者安装
bash scripts/install.sh --dev-source $(pwd) --skip-setup

# 启动
./desktop/scripts/dev.sh
```

```powershell
# ========== Windows ==========

git clone https://github.com/hepai-lab/drsai.git
cd drsai

# 开发者安装
.\scripts\install.ps1 -DevSource (Get-Location) -SkipSetup

# 启动
.\desktop\scripts\dev.ps1
```

## 验证

```bash
# 检查 DRSAI_PYTHON 是否存在
ls -la ~/.drsai/drsai-agent/venv/bin/python    # Linux/macOS
Test-Path ~\.drsai\drsai-agent\venv\Scripts\python.exe  # Windows

# 检查 gateway 能否启动
python -m drsai.backend.gateway &
curl http://127.0.0.1:8642/health
# → {"status":"ok","agent":"ready",...}
```
