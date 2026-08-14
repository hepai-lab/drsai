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
2. 在远程以 `nohup` 后台启动 `tui_gateway`（WebSocket 模式）
3. 通过 paramiko `direct-tcpip` 建立本地端口 → 远程端口的转发
4. 本地 `GatewayClient` 切换到 WebSocket attach 模式，连接隧道
5. 之后所有对话、工具调用、文件操作都在远程服务器上执行

---

## 文件清单

### 后端 (Python)

| 文件 | 说明 |
|------|------|
| `cores/python/packages/drsai/src/drsai/backend/tui_gateway/ssh_tunnel.py` | SSH 隧道管理器：paramiko 连接、远程 gateway 启动、端口转发、配置持久化 |
| `cores/python/packages/drsai/src/drsai/backend/tui_gateway/handlers/remote.py` | 10 个 JSON-RPC 方法（`remote.connect` / `remote.disconnect` / `remote.status` 等） |
| `cores/python/packages/drsai/src/drsai/backend/tui_gateway/handlers/__init__.py` | 注册 `remote` handler 模块（已修改） |
| `cores/python/packages/drsai/src/drsai/backend/tui_gateway/server.py` | 将 `remote.connect/test/exec` 加入 `_LONG_HANDLERS`（已修改） |

### 前端 (TypeScript / React / Ink)

| 文件 | 说明 |
|------|------|
| `apps/ui-tui/src/components/sshRemotePanel.tsx` | SSH 远程管理面板 UI（配置列表 / 编辑 / 目录浏览 / 状态查看） |
| `apps/ui-tui/src/gatewayTypes.ts` | 新增 `SSHConfigEntry`、`RemoteConnectionResult` 等类型（已修改） |
| `apps/ui-tui/src/gatewayClient.ts` | 新增 `switchToWebSocket()` / `switchToSubprocess()` 方法（已修改） |
| `apps/ui-tui/src/components/composerPane.tsx` | 新增 `/remote` 命令 + `remote.panel` 事件 + 面板渲染（已修改） |

### Demo (概念验证)

| 文件 | 说明 |
|------|------|
| `test/ssh_remote/ssh_remote_demo.py` | 独立 demo，可在 Windows 上直接运行测试 |

---

## 部署步骤

### 1. 远程服务器准备

在远程服务器上安装 DrSai 及其依赖：

```bash
# 克隆代码（或通过 git pull 更新）
git clone <drsai-repo> ~/drsai_dev
cd ~/drsai_dev

# 安装 Python 依赖
cd cores/python/packages/drsai
pip install -e ".[all]"

# 验证 gateway 可以独立启动
python -m drsai.backend.tui_gateway --help
# 或直接测试（会等待 stdin 输入，Ctrl+C 退出）
DRSAI_TUI_ENABLE_WS=1 DRSAI_TUI_WS_PORT=9999 python -m drsai.backend.tui_gateway
```

> **注意：** 远程服务器需要能访问 LLM API（配置好 API Key 或本地模型）。
> 远程的 DrSai 配置独立于本地，需要在远程单独运行 `opendrsai config` 设置。

### 2. 本地机器准备

```bash
# 安装 Python 依赖（paramiko 用于 SSH 隧道）
pip install paramiko

# 构建 TUI 前端
cd apps/ui-tui
pnpm install   # 或 npm install
pnpm build     # 或 npm run build

# 验证 TUI 可以启动
cd ../..
drsai chat     # 或 python -m drsai.backend.run_cli chat
```

### 3. 验证安装

```bash
# 检查 paramiko
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

### 面板操作快捷键

#### 配置列表视图 (List)

| 按键 | 功能 |
|------|------|
| `↑` / `↓` | 上下导航 |
| `Enter` | 连接选中的远程服务器 |
| `n` | 新建 SSH 配置 |
| `e` | 编辑选中的配置 |
| `t` | 测试 SSH 连接（不启动 gateway） |
| `d` | 删除选中的配置 |
| `s` | 查看当前连接状态 |
| `x` | 断开当前连接 |
| `r` | 刷新配置列表 |
| `q` / `Esc` | 退出面板 |

#### 配置编辑视图 (Edit)

| 按键 | 功能 |
|------|------|
| `↑` / `↓` | 切换字段 |
| `Tab` | 跳到下一个字段 |
| `Enter` | 保存（在最后一个字段）或跳到下一个字段 |
| `q` / `Esc` | 取消编辑 |

需要填写的字段：

| 字段 | 说明 | 示例 |
|------|------|------|
| Name | 配置名称（唯一标识） | `gpu-server` |
| Host | 远程服务器 IP 或域名 | `192.168.32.192` |
| Port | SSH 端口 | `22` |
| Username | SSH 用户名 | `xiongdb` |
| Password | SSH 密码（与私钥二选一） | `***` |
| Private Key Path | SSH 私钥路径 | `~/.ssh/id_rsa` |
| Remote Python | 远程 Python 命令 | `python3` |
| Remote PYTHONPATH | 远程 drsai src 目录（可选） | `/home/xiongdb/drsai_dev/cores/python/packages/drsai/src` |
| Remote Workdir | 远程工作目录 | `/home/xiongdb/projects` |

#### 目录浏览视图 (Dirs)

| 按键 | 功能 |
|------|------|
| `↑` / `↓` | 上下导航 |
| `Enter` | 打开子目录 |
| `s` | 选定当前目录作为工作目录 |
| `q` / `Esc` | 返回编辑视图 |

#### 连接状态视图 (Status)

| 按键 | 功能 |
|------|------|
| `x` | 断开连接 |
| `q` / `Esc` | 返回列表视图 |

---

## 完整实验流程

### 场景：在本地 Windows 笔记本上操控远程 Linux GPU 服务器

#### Step 1: 确认远程服务器就绪

```bash
# 在远程服务器上执行
ssh xiongdb@192.168.32.192

# 检查 DrSai 已安装
python3 -c "import drsai; print('OK')"

# 检查 API Key 已配置
cat ~/.drsai/configs/cli_config.json | grep api_key

# 如果没有配置，先配置
drsai config
```

#### Step 2: 本地启动 TUI

```bash
# 在本地 Windows 上
cd C:\drsai_dev
drsai chat
```

#### Step 3: 配置 SSH 连接

1. 在 TUI 中输入 `/remote`
2. 按 `n` 新建配置
3. 填写：
   - Name: `gpu-3090`
   - Host: `192.168.32.192`
   - Port: `22`
   - Username: `xiongdb`
   - Private Key Path: `C:\Users\HP\.ssh\id_rsa`
   - Remote Python: `python3`
   - Remote PYTHONPATH: `/home/xiongdb/drsai_dev/cores/python/packages/drsai/src`
   - Remote Workdir: `/home/xiongdb/projects`
4. 按 `Enter` 保存

#### Step 4: 测试连接

1. 选中刚创建的 `gpu-3090` 配置
2. 按 `t` 测试连接
3. 应看到：`✅ zzd-3090\nPython 3.12.x`

#### Step 5: 连接远程服务器

1. 选中配置，按 `Enter`
2. 等待显示：`✅ Connected to zzd-3090 (port XXXX→YYYY)`
3. TUI 自动切换到远程 gateway
4. 此时所有操作都在远程服务器上执行

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
3. TUI 自动切换回本地 gateway

---

## 独立 Demo 测试

如果只想快速验证 SSH 隧道功能，不集成到完整 TUI 中：

```bash
# 在本地机器上
cd test/ssh_remote
pip install paramiko
python ssh_remote_demo.py
```

Demo 提供交互式 UI，可以：
- 配置 SSH 连接
- 连接远程服务器
- 发送 JSON-RPC 请求
- 查看远程响应

> **Windows 用户：** 只需 `pip install paramiko && python ssh_remote_demo.py`

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
2. `client.get_transport()` 获取底层 Transport
3. 远程 `nohup python -m drsai.backend.tui_gateway` 启动 gateway
4. `transport.open_channel("direct-tcpip", ...)` 创建端口转发通道
5. 本地 TCP socket 接受连接，双向转发数据到 SSH channel
6. WebSocket 升级在隧道上透明完成

### 远程 gateway 启动命令

```bash
cd {remote_workdir} && \
PYTHONPATH={src_root}:$PYTHONPATH \
DRSAI_TUI_ENABLE_WS=1 \
DRSAI_TUI_WS_PORT={port} \
DRSAI_USER_CWD={remote_workdir} \
nohup {python} -m drsai.backend.tui_gateway > /tmp/drsai_ssh_tui/gateway.log 2>&1 &
```

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
    "remote_python": "python3",
    "remote_python_src_root": "/home/xiongdb/drsai_dev/cores/python/packages/drsai/src",
    "remote_gateway_port": 0,
    "remote_workdir": "/home/xiongdb/projects"
  }
]
```

### JSON-RPC 方法列表

| 方法 | 说明 | 耗时 |
|------|------|------|
| `remote.config.list` | 列出已保存配置（脱敏） | 短 |
| `remote.config.save` | 保存/更新配置 | 短 |
| `remote.config.delete` | 删除配置 | 短 |
| `remote.test` | 测试 SSH 连接 | 长（线程池） |
| `remote.connect` | 连接 + 启动远程 gateway + 建立隧道 | 长（线程池） |
| `remote.disconnect` | 断开 + 清理远程进程 | 短 |
| `remote.status` | 获取连接状态 | 短 |
| `remote.list_dirs` | 列出远程目录 | 短 |
| `remote.list_files` | 列出远程文件 | 短 |
| `remote.exec` | 远程执行 shell 命令 | 长（线程池） |

---

## 故障排查

### `paramiko 未安装`

```
❌ paramiko 未安装。请运行: pip install paramiko
```

**解决：** `pip install paramiko`

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

### 远程 gateway 启动失败

```
❌ 远程 tui_gateway 进程已退出
```

**排查：**
```bash
# 手动在远程测试 gateway 启动
ssh xiongdb@192.168.32.192
DRSAI_TUI_ENABLE_WS=1 DRSAI_TUI_WS_PORT=9999 \
  python3 -m drsai.backend.tui_gateway

# 查看远程日志
cat /tmp/drsai_ssh_tui/gateway.log

# 常见原因：
# 1. drsai 未安装 → pip install -e .
# 2. API Key 未配置 → drsai config
# 3. PYTHONPATH 不对 → 检查 remote_python_src_root
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
cat /tmp/drsai_ssh_tui/gateway.log
```

### Windows 特定问题

| 问题 | 解决 |
|------|------|
| 私钥路径含空格 | 使用完整路径：`C:\Users\My Name\.ssh\id_rsa` |
| PuTTY 格式私钥 | 转换为 OpenSSH 格式 |
| CRLF 编码问题 | 已修复，SFTP 使用二进制模式上传 |
| 远程路径显示 `\` | 已修复，使用 `posixpath` 处理远程路径 |

### 断开后远程进程残留

```bash
# 手动清理
ssh xiongdb@192.168.32.192
pkill -f tui_gateway
rm -rf /tmp/drsai_ssh_tui
```

---

## 开发调试

### 查看详细日志

```bash
# 本地：设置日志级别
DRSAI_LOG_LEVEL=DEBUG drsai chat

# 远程：查看 gateway 日志
ssh <host> "cat /tmp/drsai_ssh_tui/gateway.log"
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
3. **远程进程清理：** 断开时自动 `kill` 远程 gateway 进程。异常退出时可能残留，需手动清理。
4. **API Key 隔离：** 远程使用远程自己的 DrSai 配置和 API Key，与本地完全独立。
