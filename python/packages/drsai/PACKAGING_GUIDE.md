# DrSai-Tray Windows 打包发布手册

> 版本: v1.2.3 | 工具链: PyInstaller (onedir) + NSIS | 目标平台: Windows 10/11

---

## 1. 总体架构

```
┌─────────────────────────────────────────────────────────────┐
│                    构建流水线                                  │
│                                                             │
│  drsai 源码 (pip install drsai[tray])                       │
│        │                                                    │
│        ▼                                                    │
│  PyInstaller (--onedir)                                     │
│        │                                                    │
│        ▼                                                    │
│  dist/drsai-tray/   (含 drsai-tray.exe + 依赖文件夹)         │
│        │                                                    │
│        ▼                                                    │
│  NSIS installer.nsi                                         │
│        │                                                    │
│        ▼                                                    │
│  DrSai-Setup-v1.2.3.exe   (最终安装包)                       │
│                                                             │
│  用户安装后:                                                  │
│  C:\Program Files\DrSai\                                    │
│    ├── drsai-tray.exe                                       │
│    ├── _internal/   (PyInstaller 打包的所有依赖)              │
│    └── uninstall.exe   (NSIS 自动生成的卸载程序)               │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. 环境准备

### 2.1 基础环境

```powershell
# 1. 创建干净的打包环境（避免开发环境的脏依赖）
conda create -n drsai_pack python=3.12 -y
conda activate drsai_pack

# 2. 安装 drsai 及 tray 依赖
pip install drsai[tray] 
或者：pip install ".[tray]"

# 3. 安装打包工具
pip install pyinstaller

# 4. 安装 NSIS
#    下载: https://nsis.sourceforge.io/Download
#    推荐版本: NSIS 3.09+
#    安装后确保 makensis.exe 在 PATH 中:
makensis /VERSION   # 验证安装
```

### 2.2 验证 drsai-tray 可正常运行

```powershell
# 先验证 pip 安装的 drsai-tray 能正常启动
drsai-tray
# 或者
python -m drsai.backend.gui.run_tray
```

> ⚠ 如果这里不能正常运行，打包后也一定不能运行。先解决运行问题再打包。

---

## 3. PyInstaller 打包

### 3.1 关键挑战

drsai-tray 依赖链极深，PyInstaller 自动分析会漏掉大量隐式导入。以下是已知需要手动处理的类别：

| 类别 | 隐式导入 | 原因 |
|------|---------|------|
| **autogen** | `autogen_agentchat`, `autogen_core`, `autogen_ext` | 动态注册机制，`__init__.py` 中延迟导入 |
| **autogen-ext 子模块** | `autogen_ext.models.openai`, `autogen_ext.models.anthropic`, `autogen_ext.models.docker`, `autogen_ext.models.mcp` | 通过 `autogen-ext[openai,anthropic,mcp,docker]` extras 安装，PyInstaller 不跟踪 extras |
| **hepai** | `hepai`, `damei` | hepai 拉入了大量子模块，动态 client 加载 |
| **sqlmodel/alembic** | `sqlmodel`, `alembic.migration` | alembic 的模板和版本管理是隐式加载 |
| **tiktoken** | `tiktoken_ext.openai_public` | tiktoken 在运行时从远程加载编码器，但本地也需要 `_tiktoken` C 扩展 |
| **PIL/pystray** | `PIL._tkinter_finder` | tkinter + PIL 的交叉依赖 |
| **prompt_toolkit** | `prompt_toolkit.output.win32` | Windows 特定后端 |
| **dotenv** | `python_dotenv` | 需确保 `.env` 文件查找逻辑 |

### 3.2 .spec 文件

参见同目录下的 `drsai-tray.spec` 文件。核心要点：

```python
# drsai-tray.spec 核心配置
a = Analysis(
    ['src/drsai/backend/gui/run_tray.py'],    # 入口文件
    hiddenimports=[
        # autogen 全链路
        'autogen_agentchat',
        'autogen_core',
        'autogen_ext',
        'autogen_ext.models',
        'autogen_ext.models.openai',
        'autogen_ext.models.anthropic',
        'autogen_ext.models.docker',
        'autogen_ext.models.mcp',
        'autogen_ext.agents',
        'autogen_ext.agents.file_surfer',
        'autogen_ext.agents.web_surfer',
        'autogen_ext.agents.mcp_server',
        'autogen_core.models',
        # drsai 内部模块
        'drsai.backend.cli',
        'drsai.backend.cli.commands',
        'drsai.backend.cli.config',
        'drsai.backend.cli.history',
        'drsai.backend.cli.reasoning',
        'drsai.backend.cli.stats',
        'drsai.backend.gui',
        'drsai.backend.gui.chat_window',
        'drsai.backend.gui.gui_renderer',
        'drsai.backend.gui.icon_generator',
        'drsai.backend.gui.shortcut_installer',
        'drsai.backend.gui.tray_icon',
        'drsai.backend.run_drsai_agent_factory',
        'drsai.modules.agents.skills_agent',
        'drsai.modules.managers.database',
        'drsai.modules.managers.datamodel',
        'drsai.modules.managers.datamodel.db',
        'drsai.modules.managers.messages',
        'drsai.modules.components.model_client',
        'drsai.modules.components.model_client.anthropic',
        'drsai.utils',
        'drsai.utils.utils',
        'drsai.utils.fastapi2tools',
        'drsai.utils.message_convert',
        'drsai.configs',
        'drsai.configs.constant',
        # 第三方隐式导入
        'hepai',
        'damei',
        'tiktoken',
        'tiktoken_ext',
        'tiktoken_ext.openai_public',
        'sqlmodel',
        'alembic',
        'alembic.migration',
        'alembic.config',
        'prompt_toolkit',
        'prompt_toolkit.output',
        'prompt_toolkit.output.win32',
        'pystray',
        'pystray._win32',
        'PIL',
        'PIL.Image',
        'PIL.ImageDraw',
        'PIL.ImageFont',
        'PIL._tkinter_finder',
        'pyperclip',
        'qrcode',
        'schedule',
        'croniter',
        'aiohttp',
        'dotenv',
        'pydantic',
        'pydantic_settings',
        'loguru',
        'fastapi',
        'uvicorn',
    ],
    # 数据文件：icon 资源、配置模板等
    datas=[
        # 如有打包的图标文件，添加到此处
        # ('src/drsai/backend/gui/icons', 'drsai/backend/gui/icons'),
    ],
    # 二进制数据：tiktoken 的 C 扩展
    binaries=[
        # tiktoken 的 _tiktoken.so/.pyd 会由 PyInstaller 自动发现
        # 但需要确保 tiktoken_data 也被收集
    ],
    noarchive=False,
)
```

### 3.3 打包命令

```powershell
# 方法 A: 直接用 .spec 文件（推荐）
pyinstaller drsai-tray.spec

# 方法 B: 命令行参数（等同 .spec）
pyinstaller --onedir \
    --name drsai-tray \
    --icon src/drsai/backend/gui/icons/drsai_robot.ico \
    --hidden-import autogen_agentchat \
    --hidden-import autogen_ext.models.openai \
    # ... (大量 --hidden-import)
    src/drsai/backend/gui/run_tray.py
```

### 3.4 打包后验证

```powershell
# 进入 dist 目录直接运行
cd dist\drsai-tray
.\drsai-tray.exe

# 检查：
# 1. 是否弹出系统托盘图标？
# 2. 双击托盘图标能否弹出聊天窗口？
# 3. 聊天窗口能否发送消息并获得回复？
# 4. 关闭窗口能否最小化到托盘？
# 5. 右键托盘→退出能否正常关闭？
```

> ⚠ **打包后必须测试所有功能，不要直接做 NSIS 安装包。**

### 3.5 常见打包问题与修复

| 问题 | 原因 | 修复 |
|------|------|------|
| `ModuleNotFoundError: No module named 'xxx'` | PyInstaller 漏掉了隐式导入 | 在 `.spec` 的 `hiddenimports` 中添加该模块 |
| `FileNotFoundError: tiktoken data` | tiktoken 运行时从网络加载编码器，打包后没有缓存 | 需收集 tiktoken 的数据文件或首次运行联网下载 |
| 托盘图标不显示 | pystray 在打包环境中找不到 PIL | 添加 `--hidden-import PIL._tkinter_finder` |
| tkinter 窗口空白/崩溃 | tkinter 的 Tcl/Tk 库没有被收集 | 确保 `_tkinter.pyd` 和 `tcl/` 目录在 dist 中 |
| alembic 运行时报错 | alembic 需要模板文件 | 添加 `datas=[('alembic/templates', 'alembic/templates')]` |
| 启动时黑窗口闪现 | PyInstaller 默认创建 console 子系统 | `.spec` 中 `exe = EXE(..., console=False)` |

---

## 4. NSIS 安装器

### 4.1 安装器功能清单

NSIS 安装器应提供以下功能：

| 功能 | 说明 |
|------|------|
| ✅ 安装向导 | 标准的欢迎→许可→路径→安装→完成页面 |
| ✅ 安装路径选择 | 默认 `C:\Program Files\DrSai` |
| ✅ 桌面快捷方式 | 勾选创建桌面图标 |
| ✅ 开始菜单项 | 创建「DrSai」程序组 |
| ✅ 注册表写入 | 写入卸载信息到 `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\DrSai` |
| ✅ 自定义图标 | 使用 drsai_robot.ico 作为安装器和快捷方式图标 |
| ✅ 卸载程序 | 完整卸载：删除文件、快捷方式、注册表 |
| ✅ 安装完成启动 | 可选：安装完成后直接启动 drsai-tray |
| ✅ 版本检测 | 检测已有安装，提示升级/覆盖 |

### 4.2 NSIS 脚本

参见同目录下的 `installer.nsi` 文件。

### 4.3 编译安装器

```powershell
# 确保 makensis 在 PATH 中
makensis installer.nsi

# 输出: DrSai-Setup-v1.2.3.exe
# 大约 30-50 MB（取决于 dist 目录大小）
```

---

## 5. 完整构建流水线

### 5.1 一键构建脚本

参见同目录下的 `build.ps1` 文件。使用方式：

```powershell
# 完整构建（打包 + 安装器）
.\build.ps1

# 仅打包（跳过 NSIS）
.\build.ps1 -SkipInstaller

# 指定版本号
.\build.ps1 -Version "1.2.3"

# 清理重建
.\build.ps1 -Clean
```

### 5.2 构建步骤详解

```
Step 1: 环境检查
  ├── Python 3.11+ ✓
  ├── PyInstaller ✓
  ├── NSIS (makensis) ✓
  └── drsai[tray] pip 安装 ✓

Step 2: 生成图标文件
  ├── python -m drsai.backend.gui.icon_generator ".\build\icons" drsai_robot.ico
  └── 存放到 build/icons/

Step 3: 读取版本号
  └── 从 src/drsai/version.py 读取 __version__

Step 4: PyInstaller 打包
  ├── pyinstaller drsai-tray.spec
  └── 输出到 dist/drsai-tray/

Step 5: 打包后验证
  ├── dist/drsai-tray/drsai-tray.exe 能启动？ ← 手动测试
  └── 如果失败 → 修复 hiddenimports → 重新 Step 4

Step 6: NSIS 编译
  ├── makensis installer.nsi
  └── 输出: DrSai-Setup-v{VERSION}.exe

Step 7: 最终验证
  ├── 安装 DrSai-Setup-v{VERSION}.exe ← 在干净机器上测试
  ├── 检查安装路径、快捷方式、托盘图标
  ├── 检查卸载是否干净
```

---

## 6. 发布与分发

### 6.1 发布清单

发布前检查：

```
□ 在 Windows 10 上安装测试
□ 在 Windows 11 上安装测试
□ 非管理员用户安装测试（安装到用户目录）
□ 已有旧版本 → 升级安装测试
□ 完整卸载 → 重新安装测试
□ 无 Python 环境的机器上测试 ← 关键！
□ 首次启动 → API Key 配置流程测试
□ 托盘图标 → 聊天窗口 → 消息发送 全流程
□ 关闭窗口 → 最小化到托盘 → 恢复窗口
□ 右键托盘 → 退出
```

### 6.2 分发渠道

| 渠道 | 适合场景 | 操作 |
|------|---------|------|
| **GitHub Releases** | 开源社区分发 | 上传 `DrSai-Setup-v{VERSION}.exe` 到 Release 页面 |
| **内部服务器** | IHEP 内部分发 | 上传到 FTP/Web 服务器 |
| **未来: Microsoft Store** | 大规模公开分发 | 需要注册开发者账号，转换为 MSIX 包 |

### 6.3 版本更新策略

```
小版本更新 (1.2.3 → 1.2.4):
  - NSIS 安装器自动检测旧版本
  - 覆盖安装（保留用户配置 ~/.drsai/）
  - 用户数据不受影响

大版本更新 (1.x → 2.x):
  - NSIS 提示「建议卸载旧版本后重新安装」
  - 配置文件 ~/.drsai/configs/ 保留兼容
  - 数据库 ~/.drsai/workspace/runs/ 可能需要迁移
```

---

## 7. 目录结构总览

打包相关文件在项目根目录下：

```
drsai/                          # 项目根目录
├── PACKAGING_GUIDE.md           # ← 本手册
├── drsai-tray.spec              # PyInstaller 打包配置
├── installer.nsi                # NSIS 安装器脚本
├── build.ps1                    # 一键构建 PowerShell 脚本
├── src/
│   └── drsai/
│       ├── backend/gui/
│       │   ├── run_tray.py      # ← 打包入口点
│       │   ├── tray_icon.py     # 系统托盘图标
│       │   ├── chat_window.py   # tkinter 聊天窗口
│       │   ├── icon_generator.py# 机器人图标生成
│       │   └── shortcut_installer.py  # 桌面快捷方式
│       │   └── gui_renderer.py  # GUI 流式渲染
│       ├── version.py           # ← 版本号来源
│       └── configs/constant.py  # FS_DIR 等常量
├── build/                       # 构建临时目录（自动创建）
│   └── icons/                   # 生成的图标文件
├── dist/                        # 打包输出（自动创建）
│   └── drsai-tray/              # PyInstaller onedir 输出
│       ├── drsai-tray.exe       # ← 主程序
│       └── _internal/           # 所有依赖
└── DrSai-Setup-v1.2.3.exe      # ← 最终安装包（NSIS 输出）
```

---

## 8. 用户使用流程（安装后）

```
Step 1: 下载 DrSai-Setup-v1.2.3.exe
Step 2: 双击运行 → 安装向导
        ├── 选择安装路径（默认 C:\Program Files\DrSai）
        ├── 勾选「创建桌面快捷方式」
        └── 点击安装
Step 3: 安装完成 → 可勾选「立即启动 DrSai」
Step 4: drsai-tray.exe 启动 → 
        ├── 系统托盘出现 🤖 机器人图标
        ├── 首次使用 → 需要配置 API Key
        │     方式 A: 设置环境变量 HEPAI_API_KEY
        │     方式 B: 在聊天窗口中 /config 设置
        └── 双击托盘图标 → 打开聊天窗口
Step 5: 正常使用 → 对话、切换模型、管理会话
Step 6: 关闭窗口 → 最小化到托盘（不退出）
Step 7: 右键托盘→退出 → 完全关闭
Step 8: 下次启动 → 双击桌面快捷方式 或 开始菜单→DrSai
```

---

## 9. 故障排除

### 9.1 用户端常见问题

| 问题 | 原因 | 解决方案 |
|------|------|---------|
| 安装后启动无反应 | 缺少 API Key | 首次启动需配置 API Key，或程序静默退出。考虑添加首次配置向导 |
| 托盘图标不显示 | Windows 溢出区域 | 提示用户点击任务栏 ↑ 箭头查看溢出区域 |
| 聊天窗口空白/无响应 | tkinter Tcl/Tk 缺失 | 打包时确保收集了 Tcl/Tk 库 |
| 启动时闪现黑色窗口 | console=True | `.spec` 中设置 `console=False` |
| 安装后找不到程序 | 开始菜单未创建 | NSIS 脚本确认创建了开始菜单项 |

### 9.2 开发端常见问题

| 问题 | 修复 |
|------|------|
| PyInstaller 打包后体积过大 (>200MB) | 使用 `--exclude-module` 排除不需要的模块（如 `matplotlib`, `numpy` 等 autogen 拉入的附带依赖） |
| 打包后运行 `ModuleNotFoundError` | 添加 `--hidden-import` 到 `.spec` 文件 |
| tiktoken 报错 | 确保 `tiktoken` 和 `_tiktoken` 被正确收集 |
| autogen 的 MCP/Docker 组件报错 | 添加所有 `autogen_ext` 子模块的 `--hidden-import` |

---

## 10. 进阶优化（未来可做）

| 优化项 | 说明 | 优先级 |
|--------|------|--------|
| **首次配置向导** | 安装后弹出 API Key 配置窗口（类似 ChatGPT 首次登录） | P1 |
| **自动更新机制** | 安装包内嵌版本检测，提示用户下载新版本 | P2 |
| **MSIX 格式** | 未来考虑 Microsoft Store 分发，需转换为 MSIX | P3 |
| **体积优化** | 排除 autogen/docs/test 等无用模块，减小安装包 | P2 |
| **代码签名** | 使用数字签名消除 Windows SmartScreen 警告 | P2 |
| **开机自启** | NSIS 注册表写入 `HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Run` | P3 |

---

*文档版本: 2025-05 | 维护者: DrSai Team @ IHEP CAS*