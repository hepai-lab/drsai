# install_drsai_dev_tui.ps1 — 实时开发安装脚本 (Windows PowerShell)

把**本地仓库**的源码直接安装到 `~/.drsai`（即 `%USERPROFILE%\.drsai`），用于实时测试更新；运行时依赖（portable Python / Node）仍在线下载。

## 与 `install_drsai_tui.ps1` 的区别

| | `install_drsai_tui.ps1` | `install_drsai_dev_tui.ps1` |
|---|---|---|
| 源码来源 | 在线下载 `drsai.zip` | 从本地仓库 robocopy 拷贝 |
| 拷贝范围 | 整个仓库 | 仅 `apps/ui-tui`、`cores`、`skills/skills` |
| Python / Node | 在线下载 | 在线下载（相同） |
| 后端安装 | editable | editable |
| 实时同步 | 无 | `-Sync` 重新拷贝源码 + 重建 TUI |

## 用法

```powershell
# 首次安装到 ~\.drsai (即 %USERPROFILE%\.drsai)
.\scripts\install_drsai_dev_tui.ps1

# 自定义安装目录
.\scripts\install_drsai_dev_tui.ps1 -InstallDir "C:\drsai_dev"

# 覆盖已有安装
.\scripts\install_drsai_dev_tui.ps1 -Force

# 改完代码后同步到安装目录（重新拷贝源码 + 重建 TUI）
.\scripts\install_drsai_dev_tui.ps1 -Sync

# 只同步源码，不重建 TUI
.\scripts\install_drsai_dev_tui.ps1 -Sync -NoRebuild
```

## 选项

| 选项 | 说明 |
|---|---|
| `-InstallDir <path>` | 安装目录，默认 `%USERPROFILE%\.drsai` |
| `-Force` | 覆盖已有安装（只删 `bin/` 和 `venv`，保留源码、配置、数据） |
| `-Sync` | 重新从本地仓库拷贝源码并重建 TUI，不重装 venv |
| `-NoRebuild` | 跳过 TUI 重建（须与 `-Sync` 配合使用） |

## 安装后的目录结构

```
%USERPROFILE%\.drsai\
├── bin\
│   └── opendrsai.cmd          # 启动脚本（.cmd 批处理）
└── packages\
    ├── .download\              # 下载缓存（可删除）
    ├── python\                 # portable Python（若系统无合格 Python）
    ├── node\                   # portable Node（若系统无合格 Node）
    └── venv\                   # Python 虚拟环境（editable 安装 drsai）
├── apps\
│   └── ui-tui\                 # 从本地仓库拷贝的 TUI 源码（live）
│       └── dist\entry.mjs      # pnpm build 生成的入口文件
├── cores\                      # 从本地仓库拷贝的后端源码（live）
│   └── python\packages\drsai\
└── skills\
    └── skills\                 # 从本地仓库拷贝的 skills 目录
```

## 实时测试流程

1. 首次安装：
   ```powershell
   .\scripts\install_drsai_dev_tui.ps1
   # 安装完成后，打开一个新的 PowerShell 窗口
   ```

2. 运行：
   ```powershell
   opendrsai
   ```

3. 在仓库里修改代码后，同步到安装目录：
   ```powershell
   .\scripts\install_drsai_dev_tui.ps1 -Sync
   ```
   - **Python 代码**：后端是 editable 安装（`pip install -e`），`-Sync` 拷贝后立即生效，无需重装。
   - **TUI 代码**：`-Sync` 会重新 `pnpm build` 生成 `dist/entry.mjs`。

4. 重新运行 `opendrsai` 验证改动。

## 系统依赖检测

脚本会自动检测系统已有的 Python 和 Node，符合条件则跳过下载：

| 依赖 | 版本要求 | 不满足时 |
|---|---|---|
| Python | 3.11 ~ 3.13 | 下载 portable Python 3.12.13 |
| Node.js | >= 20 | 下载 portable Node v22.22.3 |

如果之前安装过 DrSai portable Python/Node，也会自动检测并复用。

## 注意事项

- 需要 Windows 10 1803+（内置 `tar` 命令用于解压 Python .tar.gz）。
- 源码拷贝使用 `robocopy`（Windows 内置），排除 `node_modules`、`__pycache__`、`*.pyc`、`dist` 等目录。
- `-Sync` 不会重新弹出 skill 选择菜单；skills 在首次安装时一次性安装到用户配置目录。
- 安装前会检测是否有 DrSai 进程在运行（通过 `Get-CimInstance Win32_Process`），如有会提示先关闭。
- 如果 PowerShell 执行策略限制了脚本运行，需先执行：
  ```powershell
  Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
  ```
- 安装完成后 `opendrsai` 命令通过 `bin\opendrsai.cmd` 启动，已自动添加到用户 PATH 环境变量（需打开新终端生效）。
