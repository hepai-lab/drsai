# SSH Remote TUI — 远程 SSH 隧道使用指南

通过 SSH 隧道在本机启动并操控远程服务器上的 DrSai TUI，实现"本地输入、远程执行"。

---

## 架构

```
本地机器 (你的电脑)                        远程服务器 (GPU 服务器)
┌─────────────────────────────┐           ┌──────────────────────────────┐
│  DrSai TUI (apps/ui-tui)    │           │  tui_gateway (WebSocket)     │
│    ├─ /remote → SSH Panel   │           │    ws://127.0.0.1:{port}     │
│    └─ GatewayClient         │           │    (nohup 后台运行)           │
│        ↓ switchToWebSocket()│           │                              │
│  ssh_tunnel.py              │── SSH ──→ │  drsai.backend.tui_gateway   │
│    ├─ paramiko SSH 连接     │  隧道     │    ├─ AI 对话 / 工具调用      │
│    ├─ 远程 gateway 启动     │  端口     │    ├─ 文件读写 (远程)        │
│    └─ direct-tcpip 端口转发 │  转发     │    └─ 所有操作在远程执行     │
└─────────────────────────────┘           └──────────────────────────────┘
```

**核心流程：**

1. 本地 TUI 通过 SSH 连接远程服务器
2. 在远程以 `nohup` 后台启动 `tui_gateway`（WebSocket 模式，stdin 重定向到 `/dev/null`）
3. 通过 paramiko `direct-tcpip` 建立本地端口 → 远程端口的转发
4. 本地 `GatewayClient` 切换到 WebSocket attach 模式，连接隧道
5. **UI 状态切换**：清除本地 transcript/session，从远程 gateway 解析最近 session 并加载远程聊天历史
6. 状态栏显示 `● SSH: {hostname}`，之后所有对话、工具调用、文件操作都在远程服务器上执行

---

## 文件清单

### 后端 (Python)

| 文件 | 说明 |
|------|------|
| `cores/python/packages/drsai/src/drsai/backend/tui_gateway/ssh_tunnel.py` | SSH 隧道管理器：paramiko 连接、远程 gateway 启动、端口转发、配置持久化 |
| `cores/python/packages/drsai/src/drsai/backend/tui_gateway/handlers/remote.py` | 11 个 JSON-RPC 方法（`remote.connect` / `remote.disconnect` / `remote.status` / `remote.browse_dirs` 等） |
| `cores/python/packages/drsai/src/drsai/backend/tui_gateway/handlers/__init__.py` | 注册 `remote` handler 模块（已修改） |
| `cores/python/packages/drsai/src/drsai/backend/tui_gateway/server.py` | 将 `remote.connect/test/exec/browse_dirs` 加入 `_LONG_HANDLERS`（已修改） |
| `cores/python/packages/drsai/src/drsai/backend/tui_gateway/entry.py` | Gateway 入口：WS 模式下 stdin EOF 不退出（`threading.Event().wait()` 永久阻塞）；`setup_status()` 供 ws.py 导入（已修改） |
| `cores/python/packages/drsai/src/drsai/backend/tui_gateway/ws.py` | WebSocket `/attach` 端点：`gateway.ready` 事件携带完整 skin + setup（已修改） |
| `cores/python/packages/drsai/src/drsai/backend/cli/commands.py` | 注册 `/remote` 命令到 `COMMAND_REGISTRY`（已修改） |

### 前端 (TypeScript / React / Ink)

| 文件 | 说明 |
|------|------|
| `apps/ui-tui/src/components/sshRemotePanel.tsx` | SSH 远程管理面板 UI（配置列表 / 编辑 / 目录浏览 / 状态查看） |
| `apps/ui-tui/src/gatewayTypes.ts` | 新增 `SSHConfigEntry`、`RemoteConnectionResult`、`remote.lost` 事件等类型（已修改） |
| `apps/ui-tui/src/gatewayClient.ts` | 新增 `switchToWebSocket()` / `switchToSubprocess()` / `handleRemoteLost()` 方法（已修改） |
| `apps/ui-tui/src/components/composerPane.tsx` | `/remote` 命令 + `remote.panel` 事件 + 面板渲染 + `onRemoteConnect`/`onRemoteDisconnect` 回调（切换后清除本地状态、解析远程 session、加载远程历史）（已修改） |
| `apps/ui-tui/src/app.tsx` | `remote_lost` 断链提示界面（已修改） |
| `apps/ui-tui/src/app/createGatewayEventHandler.ts` | `remote.lost` 事件处理（清空 `$remoteHost`）（已修改） |
| `apps/ui-tui/src/app/uiStore.ts` | `remote_lost` 连接状态 + `$remoteHost` atom（远程主机名，供状态栏显示）（已修改） |
| `apps/ui-tui/src/components/statusBar.tsx` | 远程模式显示 `● SSH: {hostname}`，本地模式显示 `● connected`（已修改） |

### Demo (概念验证)

| 文件 | 说明 |
|------|------|
| `test/ssh_remote/ssh_remote_demo.py` | 独立 demo，可在 Windows 上直接运行测试 |

---

## 部署步骤

### 1. 远程服务器准备

在远程服务器上运行安装脚本（唯一必需步骤）：

```bash
# Linux / macOS
curl -fsSL <URL>/install_drsai.sh | bash
# 或下载后执行
bash install_drsai.sh
```

安装完成后验证 `opendrsai` 可用：

```bash
opendrsai --version
# 如果提示找不到命令，重新登录 shell 或执行:
source ~/.bashrc

# 验证 gateway 可以独立启动（Ctrl+C 退出）
DRSAI_TUI_ENABLE_WS=1 DRSAI_TUI_WS_PORT=9999 opendrsai tui-gateway
```

> **注意：** 远程服务器需要能访问 LLM API（配置好 API Key 或本地模型）。
> 远程的 DrSai 配置独立于本地，需要在远程单独运行 `opendrsai config` 设置。

### 2. 本地机器准备

```bash
# paramiko 已包含在 drsai 主依赖中（pyproject.toml），无需单独安装
# 只需构建 TUI 前端
cd apps/ui-tui
pnpm install   # 或 npm install
pnpm build     # 或 npm run build

# 验证 TUI 可以启动
cd ../..
drsai chat     # 或 python -m drsai.backend.run_cli chat
```

### 3. 验证安装

```bash
# 检查 paramiko（已随 drsai 安装）
python -c "import paramiko; print(f'paramiko {paramiko.__version__} OK')"

# 检查 TUI 构建
ls apps/ui-tui/dist/entry.mjs

# 检查 SSH 连接（替换为你的服务器信息）
ssh <user>@<host> "hostname; python3 --version"
```

---

## 使用方法

### 启动 TUI

```bash
drsai chat
```

### 打开 SSH 远程面板

在 TUI 输入框中输入：

```
/remote
```

`/remote` 已注册到命令目录中，支持 Tab 补全，也会在 `/help` 中显示。

---

### 面板视图总览

SSH 远程管理面板包含 **4 个视图**，通过按键在不同视图间切换：

```
  List (配置列表)
    ├── n → Edit (新建配置)
    ├── e → Edit (编辑配置)
    ├── Enter → 连接远程 → Status (连接状态)
    └── s → Status (连接状态)

  Edit (配置编辑)
    ├── Enter (在 Workdir 字段) → Dirs (浏览远程目录)
    ├── Ctrl+S → 保存配置 → List
    └── Esc → 返回 List

  Dirs (目录浏览)
    ├── Enter → 进入子目录
    ├── s → 选定当前目录
    ├── Backspace → 返回上级目录
    └── q/Esc → 返回来源视图 (List 或 Edit)

  Status (连接状态)
    ├── x → 断开连接
    └── q/Esc → 返回 List
```

---

### 配置列表视图 (List)

面板的主视图，显示所有已保存的 SSH 配置。

```
🔌 SSH Remote Manager  ● gpu-server

  Name             Host                   User         Port   Workdir
▶ gpu-3090         192.168.32.192         xiongdb      22     /home/xiongdb/projects
  dev-server       10.0.1.100             admin        2222   ~

↑↓ nav · Enter connect · e edit · t test · d delete · n new · s status · x disconnect · q/Esc quit
```

| 按键 | 功能 | 说明 |
|------|------|------|
| `↑` / `↓` | 上下导航 | 在配置列表中移动光标 |
| `Enter` | **连接** | 连接选中的远程服务器（启动远程 gateway + 建立隧道） |
| `n` | **新建** | 创建新的 SSH 配置（进入 Edit 视图） |
| `e` | **编辑** | 编辑选中的配置（进入 Edit 视图） |
| `t` | **测试** | 测试 SSH 连接（只验证 SSH 是否能连通，不启动 gateway） |
| `d` | **删除** | 删除选中的配置 |
| `s` | **状态** | 查看当前连接状态（进入 Status 视图） |
| `x` | **断开** | 断开当前连接（仅在已连接时可用） |
| `r` | **刷新** | 重新加载配置列表 |
| `q` / `Esc` | **退出** | 关闭面板，返回 TUI 主界面 |

---

### 配置编辑视图 (Edit)

新建或编辑 SSH 连接配置。按 `n`（新建）或 `e`（编辑）进入。

```
New SSH Config

▶ Name                : (empty)
  Host                : (empty)
  Port                : 22
  Username            : (empty)
  Password            : (empty)
  Private Key Path    : (empty)
  Remote Workdir      : (empty)

Field: Name (unique identifier)

↑↓/Tab fields · type to edit · Enter next/browse (Workdir) · Ctrl+S save · Ctrl+U clear · Esc cancel
```

| 按键 | 功能 | 说明 |
|------|------|------|
| `↑` / `↓` | 切换字段 | 在表单字段间移动光标 |
| `Tab` | 下一个字段 | 快速跳到下一个字段 |
| `Enter` | 下一个/**浏览远程目录** | 非 Workdir 字段：跳到下一个字段；在 `Remote Workdir` 字段：通过临时 SSH 连接直接打开远程目录浏览器，选中后自动填回 |
| 可打印字符 / 粘贴 | 输入文本 | 直接键入或粘贴到当前字段；支持多字符粘贴 |
| `Backspace` / `Delete` | 删除字符 | 删除当前字段末尾一个字符 |
| `Ctrl+U` | 清空字段 | 清空当前字段内容 |
| `Ctrl+S` | **保存配置** | 在任意字段保存并返回列表 |
| `Esc` | 取消 | 放弃编辑，返回列表视图 |

#### 字段详细说明

| 字段 | 必填 | 说明 | 示例 |
|------|------|------|------|
| **Name** | ✅ | 配置的唯一标识名称，用于在列表中区分多个服务器 | `gpu-server`、`dev-3090` |
| **Host** | ✅ | 远程服务器的 IP 地址或域名 | `192.168.32.192`、`gpu.example.com` |
| **Port** | ✅ | SSH 服务端口号，默认 `22` | `22`、`2222` |
| **Username** | ✅ | SSH 登录用户名 | `xiongdb` |
| **Password** | 二选一 | SSH 密码。**与私钥二选一**，都填则优先用私钥 | （不填则用私钥） |
| **Private Key Path** | 二选一 | 本地 SSH 私钥文件路径。Windows 用户注意路径格式 | `~/.ssh/id_rsa`、`C:\Users\HP\.ssh\id_rsa` |
| **Remote Workdir** | 推荐 | 远程工作目录。远程 gateway 以此作为 `cwd`，AI 的文件操作都在此目录下。**在此字段按 `Enter` 可浏览选择** | `/home/xiongdb/projects` |

> **不需要配置远程 Python 路径**：远程服务器通过 `scripts/install_drsai.sh/ps1` 安装后，`opendrsai` 命令即可在命令行使用。后端连接时自动通过 `command -v opendrsai` 定位启动器（PATH 查不到时兜底 `~/.drsai/bin/opendrsai`），启动器脚本内部会处理好 venv Python、PYTHONPATH 等一切环境。

#### 关于密码 vs 私钥

- **推荐私钥**：更安全，且不需要在配置中存储密码
- **Windows 私钥路径**：使用完整路径如 `C:\Users\HP\.ssh\id_rsa`
- **PuTTY 格式私钥**：需要转换为 OpenSSH 格式（`puttygen id_rsa.ppk -O private-openssh -o id_rsa`）
- **两者都不填**：尝试使用 SSH Agent 或默认密钥（`~/.ssh/id_rsa` 等）

#### 远程环境要求

远程服务器只需满足一个条件：**能通过命令行执行 `opendrsai`**。

安装方式（在远程服务器上执行一次）：

```bash
# Linux / macOS
curl -fsSL <URL>/install_drsai.sh | bash
# 或 Windows 远程桌面
# powershell -File install_drsai.ps1
```

安装脚本会：
1. 把 OpenDrSai 安装到 `~/.drsai`（含便携 Python/Node、venv、启动器）
2. 创建启动器 `~/.drsai/bin/opendrsai`
3. 把 `~/.drsai/bin` 写入 `~/.bashrc` / `~/.zshrc` 的 PATH

后端连接远程时按以下顺序定位 `opendrsai`：

1. `command -v opendrsai` — 远程 PATH 查找
2. `~/.drsai/bin/opendrsai` — 默认安装目录兜底

两种方式都找不到时，连接/测试会给出明确错误提示。

> 远程 gateway 通过 `opendrsai tui-gateway` 子命令启动（`drsai` CLI 内置），
> 启动器脚本会自动设置 venv Python、`DRSAI_PYTHON_SRC_ROOT` 等环境变量，
> 因此 SSH 配置中**不需要**任何 Python 路径相关字段。

#### 关于 Remote Workdir

- 这是远程 gateway 启动时的 **工作目录**（`cwd`）
- AI 对话中的文件读写、代码执行等操作都以此为基准目录
- **推荐填写**，避免默认 home 目录下文件混乱
- 在 `Remote Workdir` 字段按 **`Enter`** 键可以通过 SSH 浏览远程目录，选中后自动填入

---

### 目录浏览视图 (Dirs)

浏览远程服务器的目录结构，用于选择工作目录。

**打开方式：**

在编辑视图的 `Remote Workdir` 字段按 **`Enter`** 键，通过**临时 SSH 连接**浏览远程目录（不需要已连接），选中后自动填回。

```
📁 Remote Directory: /home/xiongdb

▶ 📁 drsai_dev
  📁 projects
  📁 data
  📁 .ssh
  📄 .bashrc
  📄 .bash_profile

↑↓ nav · Enter open dir · s select this dir · Backspace parent dir · q/Esc back
```

| 按键 | 功能 | 说明 |
|------|------|------|
| `↑` / `↓` | 上下导航 | 在文件/目录列表中移动光标 |
| `Enter` | 进入子目录 | 打开选中的目录，继续浏览 |
| `s` | **选定当前目录** | 将**当前浏览路径**设为 `remote_workdir`，返回来源视图 |
| `Backspace` / `-` | 上级目录 | 返回上一级目录 |
| `q` / `Esc` | 返回 | 返回来时的视图（Edit 或 List） |

**典型操作：**

1. 在编辑视图填好 Host、Username、Private Key Path
2. 光标移到 `Remote Workdir` 字段
3. 按 `Enter` → 等待几秒（临时建立 SSH 连接）
4. 看到远程 home 目录 → `Enter` 进入 `projects` 子目录
5. 按 `s` 选定 `/home/xiongdb/projects` 为工作目录
6. 自动返回编辑视图，`Remote Workdir` 已填好

---

### 连接状态视图 (Status)

显示当前远程连接的详细信息。按 `s` 从列表视图进入。

```
Remote Connection Status

  ● Connected
  Host:          gpu-server-01
  Remote CWD:    /home/xiongdb/projects
  Remote Port:   39127
  Local Port:    51234
  Remote PID:    12345
  Python:        Python 3.12.3
  WS URL:        ws://127.0.0.1:51234/attach

x disconnect · q/Esc back
```

| 按键 | 功能 | 说明 |
|------|------|------|
| `x` | **断开连接** | 断开 SSH 隧道，清理远程 gateway 进程 |
| `q` / `Esc` | 返回 | 返回列表视图 |

---

### 断链提示界面

当远程 SSH WebSocket 连接意外断开时，TUI **不会退出**，而是显示断链提示：

```
⚠  Remote connection lost

WebSocket connection closed

Choose an action:
  [R] — Reconnect (switch to local, then open /remote panel)
  [L] — Switch to local mode
  [Ctrl+D] — Exit
```

| 按键 | 功能 | 说明 |
|------|------|------|
| `R` | 重连 | 先切回本地模式，然后手动用 `/remote` 重新连接 |
| `L` | 切回本地 | 切换到本地 gateway，创建新的本地 session |
| `Ctrl+D` | 退出 | 关闭 TUI |

> **注意：** 断链后切换回本地会创建**新的本地 session**，之前的远程 session 上下文不会保留。SSH 连接已启用 keepalive（每 30 秒），可以有效防止 NAT/防火墙静默断开。

---

## 完整实验流程

### 场景：在本地 Windows 笔记本上操控远程 Linux GPU 服务器

#### Step 1: 确认远程服务器就绪

```bash
# 在远程服务器上执行
ssh xiongdb@192.168.32.192

# 检查 DrSai 已安装
opendrsai --version

# 检查 API Key 已配置
cat ~/.drsai/configs/cli_config.json | grep api_key

# 如果没有配置，先配置
opendrsai config
```

#### Step 2: 本地启动 TUI

```bash
# 在本地 Windows 上
cd C:\drsai_dev
drsai chat
```

#### Step 3: 配置 SSH 连接

1. 在 TUI 中输入 `/remote`（可按 Tab 补全）
2. 按 `n` 新建配置
3. 依次填写各字段（↑↓ 切换，Tab 下一个）：
   - Name: `gpu-3090`
   - Host: `192.168.32.192`
   - Port: `22`
   - Username: `xiongdb`
   - Password: 留空
   - Private Key Path: `C:\Users\HP\.ssh\id_rsa`
   - Remote Workdir: 光标停在此字段，按 **`Enter`** 浏览远程目录选择
4. 按 `Ctrl+S` 保存

#### Step 4: 测试连接

1. 选中刚创建的 `gpu-3090` 配置
2. 按 `t` 测试连接
3. 应看到：`✅ gpu-server-hostname\nPython 3.12.x`

#### Step 5: 连接远程服务器

1. 选中配置，按 `Enter`
2. 等待显示：`✅ Connected to gpu-server (port XXXX→YYYY)`
3. TUI 自动切换到远程 gateway，执行以下状态切换：
   - **清除本地状态**：transcript、current session、sessionMeta、memoryPreview、lastUsage 全部重置
   - **解析远程 session**：调用 `session.most_recent` 获取远程工作目录的最近 session
   - **创建 session**：若无最近 session → `session.create` 新建
   - **加载远程历史**：`switchSession(sid)` → `session.resume` → 加载远程聊天历史填入 transcript
   - **设置状态栏**：显示 `● SSH: 192.168.32.192`
4. 此时所有操作都在远程服务器上执行，聊天历史来自远程 session 数据库

#### Step 6: 在远程进行 AI 对话

```
> 帮我查看当前目录下的文件
> 读取 /home/xiongdb/data/experiment.csv 的前10行
> 在当前目录创建一个 Python 脚本，画一个正弦波图
> 运行 python plot.py
```

这些操作全部在远程服务器上执行，文件读写、代码运行都在远程。

#### Step 7: 断开连接

1. 输入 `/remote`
2. 按 `x` 断开
3. TUI 自动切换回本地 gateway，执行与连接时对称的状态切换：
   - **清除远程状态**：transcript、current session 等全部重置
   - **解析本地 session**：`session.most_recent` → `session.create`（如无）
   - **加载本地历史**：`switchSession(sid)` → `session.resume` → 恢复本地聊天历史
   - **状态栏恢复**：显示 `● connected`

---

## 独立 Demo 测试

如果只想快速验证 SSH 隧道功能，不集成到完整 TUI 中：

```bash
# 在本地机器上
cd test/ssh_remote
# paramiko 已随 drsai 安装，无需单独安装
python ssh_remote_demo.py
```

Demo 提供交互式 UI，可以：
- 配置 SSH 连接
- 连接远程服务器
- 发送 JSON-RPC 请求
- 查看远程响应

> **Windows 用户：** 只需 `python ssh_remote_demo.py`（paramiko 已随 drsai 安装）

---

## 技术细节

### SSH 隧道原理

```
本地 GatewayClient                    远程 tui_gateway
    │                                      │
    │ ws://127.0.0.1:{local_port}/attach   │
    │                                      │
    ▼                                      ▼
本地 TCP socket ──→ paramiko direct-tcpip ──→ 远程 TCP socket
  (listen)            (SSH channel)            (ws server)
```

1. `paramiko.SSHClient.connect()` 建立 SSH 连接
2. `client.get_transport()` 获取底层 Transport，并设置 `set_keepalive(30)` 防止静默断开
3. 远程 `nohup opendrsai tui-gateway` 启动 gateway
4. `transport.open_channel("direct-tcpip", ...)` 创建端口转发通道
5. 本地 TCP socket 接受连接，双向转发数据到 SSH channel
6. WebSocket 升级在隧道上透明完成

### 远程 gateway 启动命令

后端通过 SSH 定位远程 `opendrsai` 启动器（`command -v opendrsai`，兜底 `~/.drsai/bin/opendrsai`），然后执行：

```bash
cd {remote_workdir} && \
DRSAI_TUI_ENABLE_WS=1 \
DRSAI_TUI_WS_PORT={port} \
DRSAI_USER_CWD={remote_workdir} \
setsid nohup opendrsai tui-gateway \
  < /dev/null > /tmp/drsai_ssh_tui/gateway_{port}.log 2>&1 &
```

> `opendrsai tui-gateway` 是 `drsai` CLI 内置子命令，用于以独立进程启动
> JSON-RPC TUI gateway。启动器脚本自身会导出 venv Python、`DRSAI_PYTHON_SRC_ROOT`
> 等环境变量，因此不需要在 SSH 配置中填写任何 Python 路径。
>
> **`setsid` 进程隔离**：`setsid` 将 gateway 进程放入新的 session，
> 完全脱离 SSH 通道。这避免了 `bash -c` 包装进程在 SSH 通道关闭后
> 残留为孤儿进程（PPID=1）的问题。
>
> **Port 级文件隔离**：日志和 PID 文件按端口唯一命名
> （`gateway_{port}.log`、`gateway_{port}.pid`），支持多并发接入，
> 不同连接互不干扰。
>
> **stdin 重定向到 `/dev/null`**：远程 gateway 以 WebSocket 模式运行时，
> stdin 不用于接收命令（命令通过 WS `/attach` 端点接收）。
> 显式重定向 `< /dev/null` 避免 nohup 挂起，同时 gateway 在检测到 stdin EOF 后
> 会调用 `threading.Event().wait()` 永久阻塞，保持进程存活以服务 WS 客户端。

### 断链检测机制

1. **SSH keepalive**：`transport.set_keepalive(30)` 每 30 秒发送 keepalive 包，防止 NAT/防火墙断开空闲连接
2. **WebSocket close 事件**：前端 `GatewayClient` 检测到 WebSocket 断开时，区分是远程 SSH 模式还是普通 attach 模式
3. **远程 SSH 模式断链**：发出 `remote.lost` 事件，清空 `$remoteHost`，TUI 显示断链提示界面，不退出
4. **普通 attach 模式断链**：发出 `gateway.exit` 事件，TUI 正常退出

### 连接后的 UI 状态切换

连接远程 gateway 成功后，TUI 执行完整的状态切换以提供与 VS Code Remote-SSH 一致的体验：

```
remote.connect 成功
  ↓
switchToWebSocket(ws://127.0.0.1:{local_port}/attach)
  ↓
gateway.ready 事件（携带完整 skin + setup 从远程返回）
  ↓
清除本地状态: transcript / current / sessionMeta / memoryPreview / lastUsage
  ↓
解析远程 session: session.most_recent → session.create（如无）
  ↓
switchSession(sid) → session.resume → 加载远程聊天历史
  ↓
$remoteHost.set(hostname) → 状态栏显示 ● SSH: {hostname}
```

断开连接时执行对称操作：`switchToSubprocess()` → 清除远程状态 → 解析本地 session → 加载本地历史 → `$remoteHost.set('')`。

### WebSocket 模式下的 gateway 存活机制

远程 gateway 以 WebSocket 模式运行时，命令通过 WS `/attach` 端点接收，不依赖 stdin。但 `nohup` 将 stdin 重定向到 `/dev/null`，导致 `for raw in sys.stdin` 循环立即收到 EOF。

**修复方案**（`entry.py`）：

```python
ws_mode = os.environ.get("DRSAI_TUI_ENABLE_WS") == "1"
# stdin 循环结束后...
if ws_mode:
    logger.info("stdin EOF in WebSocket mode; keeping gateway alive for WS clients")
    threading.Event().wait()  # 永久阻塞，保持进程存活
```

同时，WS 模式下 `gateway.ready` 事件写入失败时只记录日志、不退出进程。

### gateway.ready 事件 payload

WS `/attach` 端点在客户端连接后发送 `gateway.ready` 事件，携带完整初始化数据：

```python
skin = server.resolve_skin()      # 完整主题（branding + colors）
server._emit("gateway.ready", None, {
    "skin": skin,
    "setup": setup_status(),       # config_exists + has_api_key + setup_required
})
```

确保远程连接后 UI 主题与远程配置一致，而非被重置为空。

### 配置存储

SSH 配置保存在 `~/.drsai/configs/ssh_configs.json`：

```json
[
  {
    "name": "gpu-3090",
    "host": "192.168.32.192",
    "port": 22,
    "username": "xiongdb",
    "password": "",
    "private_key_path": "~/.ssh/id_rsa",
    "remote_gateway_port": 0,
    "remote_workdir": "/home/xiongdb/projects"
  }
]
```

> **安全说明：** `password` 字段在列表 API 中以 `***` 脱敏返回。`private_key_path` 指向的私钥文件仅在本机使用，不会上传到远程。

### JSON-RPC 方法列表

| 方法 | 说明 | 耗时 | 需要已连接 |
|------|------|------|-----------|
| `remote.config.list` | 列出已保存配置（脱敏） | 短 | 否 |
| `remote.config.save` | 保存/更新配置 | 短 | 否 |
| `remote.config.delete` | 删除配置 | 短 | 否 |
| `remote.test` | 测试 SSH 连接 | 长（线程池） | 否 |
| `remote.connect` | 连接 + 启动远程 gateway + 建立隧道 | 长（线程池） | 否 |
| `remote.disconnect` | 断开 + 清理远程进程 | 短 | — |
| `remote.cleanup` | 清理所有残留 gateway 进程和文件 | 短 | — |
| `remote.status` | 获取连接状态 | 短 | 否 |
| `remote.list_dirs` | 列出远程目录 | 短 | ✅ |
| `remote.list_files` | 列出远程文件 | 短 | ✅ |
| `remote.exec` | 远程执行 shell 命令 | 长（线程池） | ✅ |
| `remote.browse_dirs` | 临时 SSH 连接浏览远程目录 | 长（线程池） | 否 |

> `remote.browse_dirs` 与 `remote.list_files` 的区别：`browse_dirs` 使用临时 SSH 连接，不需要已建立隧道，用于配置阶段选择 workdir；`list_files` 使用已有隧道，速度更快，用于已连接后浏览。
>
> **`name 不能为空` 校验**：`remote.browse_dirs` 在编辑视图调用时，配置尚未保存（无 name）。后端过滤掉 `name 不能为空` 校验项：`errs = [e for e in cfg.validate() if e != "name 不能为空"]`，只校验 Host、Username、认证信息等连接必需字段。

---

## 故障排查

### `opendrsai --version` 报 `No such option: --version`

**原因：** CLI 入口 `run()` 将所有以 `-` 开头的参数自动路由到 `chat` 子命令，导致 `--version` 被传给 `chat`（不支持此选项）。

**修复：** `run()` 现在排除 `--version` 和 `-V`，让它们由 typer callback 处理。同时 callback 新增 `--version` / `-V` eager option。

**验证：**
```bash
opendrsai --version    # 应输出: version: x.x.x
opendrsai -V           # 同上
opendrsai version      # 子命令方式，同上
```

### `paramiko 未安装`

```
❌ paramiko 未安装。请运行: pip install paramiko
```

**解决：** paramiko 已包含在 `pyproject.toml` 主依赖中，正常安装 drsai 后自动可用。若仍报错，手动安装：`pip install paramiko>=3.0`

### SSH 连接失败（空错误信息）

**原因：** 私钥格式问题或网络不通。

**排查：**
```bash
# 1. 确认可以手动 SSH
ssh -i ~/.ssh/id_rsa xiongdb@192.168.32.192

# 2. 确认私钥格式正确（不是 PuTTY 格式）
head -1 ~/.ssh/id_rsa
# 应该是: -----BEGIN OPENSSH PRIVATE KEY-----
# 或:     -----BEGIN RSA PRIVATE KEY-----

# 3. 如果是 PuTTY 格式，转换：
# puttygen id_rsa.ppk -O private-openssh -o id_rsa
```

### 测试连接报 `Authentication failed`

**原因：** 后端 `remote.test` 未从已保存配置加载连接参数（已修复）。

**修复后：** `remote.test` 现在与 `remote.connect` 一样，通过 `name` 从 `ssh_configs.json` 加载完整配置（host、username、password/private_key_path 等），再执行测试。

**如果仍报错：**
1. 确认配置已保存（在编辑视图按 `Ctrl+S` 保存）
2. 确认保存的密码/私钥路径正确（浏览目录使用的是表单中的值，测试使用的是已保存的值）
3. 如果修改了配置但未保存，浏览会用新值成功，但测试/连接仍用旧值

### 远程 gateway 启动失败

```
❌ 远程 tui_gateway 进程已退出
```

**排查：**
```bash
# 手动在远程测试 gateway 启动
ssh xiongdb@192.168.32.192
DRSAI_TUI_ENABLE_WS=1 DRSAI_TUI_WS_PORT=9999 opendrsai tui-gateway

# 查看远程日志
cat /tmp/drsai_ssh_tui/gateway_9999.log

# 常见原因：
# 1. opendrsai 未安装 → 在远程运行 install_drsai.sh 安装
# 2. API Key 未配置 → 远程运行 opendrsai config
# 3. opendrsai 不在 PATH → 确认 ~/.drsai/bin/opendrsai 存在
# 4. gateway 因 stdin EOF 退出 → 已在 WS 模式下修复，gateway 会保持运行
#    若仍出现，确认远程 opendrsai 版本为最新（entry.py WS 模式不退出）
```

### 目录浏览失败（编辑视图 Workdir 字段按 Enter 无反应）

**可能原因：**
1. Host 或 Username 未填写 — 先填写这两个字段
2. SSH 认证信息不正确 — 确认 Password 或 Private Key Path 正确
3. 网络不通 — 先按 `t` 在列表视图测试连接

**排查：**
```bash
# 手动测试 SSH 连接
ssh -i ~/.ssh/id_rsa xiongdb@192.168.32.192 "ls ~"
```

### 连接成功但 TUI 无响应

**原因：** WebSocket 隧道建立但 gateway 未就绪。

**排查：**
```bash
# 在远程检查 gateway 进程
ssh xiongdb@192.168.32.192
ps aux | grep tui_gateway
ss -tlnp | grep 9999   # 检查端口

# 检查日志
cat /tmp/drsai_ssh_tui/gateway_9999.log
```

### 连接报 `TimeoutError()`

**原因：** SSH 连接或远程命令执行超时。

**常见原因：**
1. **保存的配置与编辑表单不一致** — 浏览目录使用表单中的值（正确），但连接使用已保存配置中的值（可能过期）。在编辑视图按 `Ctrl+S` 重新保存后再连接。
2. **`opendrsai --version` 执行缓慢** — 远程 venv 加载慢。已将此步骤超时从 15s 提高到 30s。
3. **远程 gateway 启动超时** — 远程端口未在 6s 内就绪。检查远程日志：`ssh <host> "cat /tmp/drsai_ssh_tui/gateway_{port}.log"`

**排查：**
```bash
# 手动测试 SSH 连接（使用保存的配置中的 host/user/key）
ssh -i ~/.ssh/id_rsa xiongdb@192.168.32.192 "hostname; opendrsai --version"

# 如果 opendrsai --version 很慢，检查 venv
ssh xiongdb@192.168.32.192 "time ~/.drsai/bin/opendrsai --version"
```

### 远程连接意外断开

TUI 会显示断链提示界面，不会直接退出。你可以选择：
- `R` — 重连（切回本地，然后用 `/remote` 重新连接）
- `L` — 切回本地模式
- `Ctrl+D` — 退出

如果频繁断连，检查网络稳定性，或确认中间是否有防火墙/NAT 超时。SSH keepalive（30s）已默认启用。

### Windows 特定问题

| 问题 | 解决 |
|------|------|
| 私钥路径含空格 | 使用完整路径：`C:\Users\My Name\.ssh\id_rsa` |
| PuTTY 格式私钥 | 转换为 OpenSSH 格式 |
| CRLF 编码问题 | 已修复，SFTP 使用二进制模式上传 |
| 远程路径显示 `\` | 已修复，使用 `posixpath` 处理远程路径 |

### 断开后远程进程残留

**已自动管理**：`disconnect()` 会杀掉远程 gateway 进程组（`kill -- -PID`）并清理
对应的 PID/log 文件。`connect()` 前也会自动清理同 port 上的残留进程。

如果因网络异常或 TUI 崩溃导致自动清理未执行，可通过以下方式手动清理：

```bash
# 方式 1: 通过 TUI RPC 调用 remote.cleanup（推荐）
# 在 TUI 中执行，会扫描所有 gateway_*.pid 文件，杀残留进程并清理文件

# 方式 2: SSH 登录后手动清理
ssh xiongdb@192.168.32.192
pkill -f tui_gateway
rm -rf /tmp/drsai_ssh_tui
```

### 多并发接入支持

每个连接使用 **port 级唯一的日志和 PID 文件**（`gateway_{port}.log`、`gateway_{port}.pid`），
不同端口的连接互不干扰，天然支持多并发接入。

但需注意：当前 TUI 前端为**单连接模式**（同一时间只维护一个 SSH 隧道），
多并发场景主要指多个 TUI 客户端同时连接同一远程服务器的不同 gateway 端口。

### 进程管理机制

**三层清理保障：**

1. **连接前清理**（`_start_remote_gateway`）：启动新 gateway 前，`pkill -f 'tui_gateway.*{port}'` 杀掉同 port 残留进程，删除旧 PID 文件。
2. **断开时清理**（`disconnect`）：`kill -- -PID` 杀整个进程组（`setsid` 启动的进程自成 session），`kill -9` 兜底，删除 PID/log 文件。
3. **手动清理**（`remote.cleanup` RPC）：扫描所有 `gateway_*.pid` 文件，杀残留进程，清理所有 PID/log 文件。可在已连接或未连接状态下调用。

**`setsid` 的作用：**

`setsid nohup opendrsai tui-gateway` 将 gateway 进程放入新的 session，完全脱离 SSH 通道。
这解决了之前 `bash -c` 包装进程在 SSH 通道关闭后残留为孤儿进程（PPID=1）的问题：
- `setsid` 创建新 session → gateway 进程的 PGID = PID
- `kill -- -PID` 可以杀掉整个进程组（包括 gateway 及其子进程）
- SSH 通道关闭时不会向 gateway 发送 SIGHUP（因为不在同一 session）

**文件生命周期：**

| 文件 | 创建时机 | 清理时机 |
|------|---------|---------|
| `gateway_{port}.pid` | gateway 启动时 `echo $! > pid_file` | disconnect / cleanup_stale / 连接前清理 |
| `gateway_{port}.log` | gateway 启动时 `> log_path 2>&1` | disconnect / cleanup_stale |

---

## 开发调试

### 查看详细日志

```bash
# 本地：设置日志级别
DRSAI_LOG_LEVEL=DEBUG drsai chat

# 远程：查看 gateway 日志
ssh <host> "cat /tmp/drsai_ssh_tui/gateway_{port}.log"
```

### 手动测试 SSH 隧道

```python
import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect("192.168.32.192", username="xiongdb", key_filename="~/.ssh/id_rsa")

# 测试命令执行
stdin, stdout, stderr = client.exec_command("hostname; python3 --version")
print(stdout.read().decode())

# 测试端口转发
transport = client.get_transport()
transport.set_keepalive(30)  # 启用 keepalive
channel = transport.open_channel("direct-tcpip", ("127.0.0.1", 9999), ("127.0.0.1", 0))
print("Channel created:", channel)

client.close()
```

### 重新构建前端

```bash
cd apps/ui-tui
pnpm build    # 生产构建
# 或
pnpm dev      # 开发模式（热重载）
```

---

## 安全注意事项

1. **SSH 私钥安全：** 私钥文件仅在本机使用，不上传到远程。配置文件中密码以 `***` 脱敏显示。
2. **端口转发范围：** 隧道仅绑定 `127.0.0.1`（本地回环），不暴露到网络。
3. **远程进程清理：** 断开时自动 `kill` 远程 gateway 进程组（`kill -- -PID`）并清理 PID/log 文件。连接前自动清理同 port 残留进程。异常退出时可通过 `remote.cleanup` RPC 方法或手动 `pkill -f tui_gateway` 清理。
4. **API Key 隔离：** 远程使用远程自己的 DrSai 配置和 API Key，与本地完全独立。
5. **SSH Keepalive：** 默认每 30 秒发送 keepalive 包，防止 NAT/防火墙静默断开，同时也能更快检测到断链。
6. **Session 隔离：** 远程 gateway 有独立的 session 数据库。切换到远程后，本地 transcript 被清除，聊天历史从远程 session 加载。断开时反向操作，恢复本地 session。
7. **文件系统隔离：** 远程 gateway 进程在远程服务器上运行，`Path.cwd()` 天然指向远程工作目录。所有文件操作（读写、代码执行）都在远程执行，不存在本地/远程路径混淆。
8. **多并发支持：** 每个连接使用 port 级唯一的日志和 PID 文件（`gateway_{port}.log`、`gateway_{port}.pid`），不同连接互不干扰。`setsid` 确保进程完全脱离 SSH 通道，避免残留。