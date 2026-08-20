# install_drsai_dev.sh — 实时开发安装脚本

把**本地仓库**的源码直接安装到 `~/.drsai`，用于实时测试更新；运行时依赖（portable Python / Node）仍在线下载。

## 与 `install_drsai.sh` 的区别

| | `install_drsai.sh` | `install_drsai_dev.sh` |
|---|---|---|
| 源码来源 | 在线下载 `drsai.zip` | 从本地仓库 rsync 拷贝 |
| 拷贝范围 | 整个仓库 | 仅 `apps/ui-tui`、`cores`、`skills/skills` |
| Python / Node | 在线下载 | 在线下载（相同） |
| 后端安装 | editable | editable |
| 实时同步 | 无 | `--sync` 重新拷贝源码 + 重建 TUI |

## 用法

```bash
# 首次安装到 ~/.drsai
bash scripts/install_drsai_dev.sh

# 自定义安装目录
bash scripts/install_drsai_dev.sh --install-dir /tmp/drsai_dev

# 覆盖已有安装
bash scripts/install_drsai_dev.sh --force

# 改完代码后同步到安装目录（重新拷贝源码 + 重建 TUI）
bash scripts/install_drsai_dev.sh --sync

# 只同步源码，不重建 TUI
bash scripts/install_drsai_dev.sh --sync --no-rebuild
```

## 选项

| 选项 | 说明 |
|---|---|
| `--install-dir <path>` | 安装目录，默认 `~/.drsai` |
| `--force` | 覆盖已有安装（只删 `bin/` 和 `venv`，保留源码、配置、数据） |
| `--sync` | 重新从本地仓库拷贝源码并重建 TUI，不重装 venv |
| `--no-rebuild` | 跳过 TUI 重建 |
| `-h`, `--help` | 显示帮助 |

## 安装后的目录结构

```
~/.drsai/
├── bin/opendrsai              # 启动脚本
└── packages/
    ├── src/                   # 从本地仓库拷贝的源码（live）
    │   ├── apps/ui-tui/
    │   ├── cores/
    │   └── skills/skills/
    ├── venv/                  # Python 虚拟环境（editable 安装 drsai）
    ├── python/                # portable Python（若系统无合格 Python）
    └── node/                  # portable Node（若系统无合格 Node）
```

## 实时测试流程

1. 首次安装：
   ```bash
   bash scripts/install_drsai_dev.sh
   source ~/.bashrc   # 或 ~/.zshrc
   ```

2. 运行：
   ```bash
   opendrsai
   ```

3. 在仓库里修改代码后，同步到安装目录：
   ```bash
   bash scripts/install_drsai_dev.sh --sync
   ```
   - **Python 代码**：后端是 editable 安装，`--sync` 拷贝后立即生效，无需重装。
   - **TUI 代码**：`--sync` 会重新 `pnpm build` 生成 `dist/entry.mjs`。

4. 重新运行 `opendrsai` 验证改动。

## 注意事项

- 需要安装 `rsync`（用于源码拷贝）。
- `--sync` 不会重新弹出 skill 选择菜单；skills 在首次安装时一次性安装到 `workspace/runs/<user>/configs/skills/`。
- 拷贝时排除 `node_modules`、`__pycache__`、`*.pyc`、`dist` 等大目录或生成物。
- 安装前会检测是否有 DrSai 进程在运行，如有会提示先关闭。
