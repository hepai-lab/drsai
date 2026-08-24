# OpenDrSai SSH 远程访问技术报告

> 生成日期: 2026-08-17  
> 涉及版本: OpenDrSai TUI Gateway SSH Remote Access

---

## 1. 架构总览

OpenDrSai 的 SSH 远程访问功能允许用户从本地 TUI 连接到远程服务器（如 3090 GPU 服务器），在远程工作目录上运行 AI 编程助手。整体架构如下：

```
┌─────────────────────────────────────────────────────────────┐
│  本地机器 (Local Machine)                                    │
│                                                              │
│  ┌──────────────┐    JSON-RPC    ┌──────────────────────┐   │
│  │  Ink/React   │ ◄──────────► │  Local Gateway        │   │
│  │  TUI (Node)  │    stdio/ws   │  (Python subprocess)  │   │
│  │              │               │                       │   │
│  │  gatewayClient│              │  handlers/remote.py   │   │
│  │  .ts          │              │  ├── SSHTunnelManager │   │
│  └──────────────┘               │  │   ├── paramiko SSH │   │
│         │                       │  │   ├── port forward │   │
│         │ switchToWebSocket()   │  │   └── tunnel worker│   │
│         ▼                       │  └── handlers/session │   │
│  ┌──────────────┐               └──────────────────────┘   │
│  │  WebSocket   │ ◄─── port forwarding (127.0.0.1:local_port) │
│  │  to tunnel   │                                          │
│  └──────────────┘                                          │
└─────────────────────────────────────────────────────────────┘
                         │
                    SSH Tunnel (paramiko)
                         │
┌─────────────────────────────────────────────────────────────┐
│  远程机器 (Remote Machine, e.g. 3090 Server)                 │
│                                                              │
│  ┌──────────────────────┐    WebSocket     ┌────────────┐   │
│  │  Remote Gateway      │ ◄─────────────► │ WS Server  │   │
│  │  opendrsai tui-gateway│   127.0.0.1:    │ (aiohttp)  │   │
│  │  --enable-ws          │   remote_port   │            │   │
│  │                       │                 └────────────┘   │
│  │  handlers/session.py  │                                   │
│  │  handlers/slash.py    │                                   │
│  │  AI Agent (LLM)       │                                   │
│  └──────────────────────┘                                   │
└─────────────────────────────────────────────────────────────┘
```

**核心设计思路：**
- 本地 TUI 通过 stdio 启动一个本地 Python Gateway 子进程
- 用户触发 `/remote` 连接时，本地 Gateway 通过 paramiko 建立 SSH 连接到远程
- 远程启动一个 WebSocket 模式的 Gateway 实例
- 本地通过 SSH 端口转发将 WebSocket 流量隧道化
- TUI 的 `gatewayClient` 从 stdio 模式切换到 WebSocket 模式，直接与远程 Gateway 通信

---

## 2. 连接流程详解（逐步）

### Step 1: 用户触发 `/remote` 命令

**文件:** `apps/ui-tui/src/components/composerPane.tsx` L1006-1008

用户在 TUI 中输入 `/remote`，渲染 `SshRemotePanel` 组件：

```tsx
if (remotePanelOpen) {
    return (
      <SshRemotePanel
        gw={controller.gw}
        onDismiss={() => setRemotePanelOpen(false)}
        onRemoteConnect={async (result) => { ... }}
        onRemoteDisconnect={async () => { ... }}
      />
    )
}
```

### Step 2: SSH 配置面板

**文件:** `apps/ui-tui/src/components/sshRemotePanel.tsx` L1-82

`SshRemotePanel` 提供 4 个视图：
- **list**: 显示已保存的 SSH 配置，支持连接/断开/测试/删除
- **edit**: 添加/编辑 SSH 配置（host, port, user, key, workdir）
- **dirs**: 浏览远程目录选择工作目录
- **status**: 显示当前连接状态

配置字段 (`EditForm` L48-56):
```typescript
interface EditForm {
  name: string           // 唯一标识符
  host: string           // IP 或主机名
  port: string           // 默认 22
  username: string
  password: string       // 或使用私钥
  private_key_path: string  // ~/.ssh/id_rsa
  remote_workdir: string    // 远程工作目录
}
```

### Step 3: 发起 `remote.connect` RPC

**文件:** `apps/ui-tui/src/components/sshRemotePanel.tsx` L131-155

用户选择一个配置并按 `c` 连接，调用 `connect()` 函数：

```typescript
const connect = async (cfg: SSHConfigEntry) => {
    setView('connecting')
    const res = await gw.request<RemoteConnectionResult>('remote.connect', {
      name: cfg.name,
    })
    if (res.connected) {
      // 连接成功，调用 onRemoteConnect 回调
      try {
        await onRemoteConnect?.(res)
      } catch (e) {
        // 回滚面板状态
        setStatus(null)
        setView('list')
      }
    }
}
```

**关键点：** `gw.request()` 此时处于 stdio 模式，RPC 通过 `proc.stdin` 发送给**本地** Gateway 子进程。

### Step 4: 本地 Gateway 处理 `remote.connect`

**文件:** `cores/python/packages/drsai/src/drsai/backend/tui_gateway/handlers/remote.py` L130-185

本地 Gateway 收到 `remote.connect` RPC 后：

```python
# L42-55: 全局单例隧道管理器
_tunnel: SSHTunnelManager | None = None
_tunnel_lock = threading.Lock()

# L130-185: remote.connect handler
async def handle_remote_connect(params):
    global _tunnel
    # 1. 加载 SSHConfig（从配置名或内联参数）
    cfg = SSHConfig(...)
    
    # 2. 断开已有隧道
    if _tunnel:
        _tunnel.disconnect()
    
    # 3. 创建新的 SSH 隧道管理器并连接
    _tunnel = SSHTunnelManager()
    status = await _tunnel.connect(cfg)
    
    # 4. 返回连接结果（包含 ws_attach_url）
    return {
        "connected": True,
        "ws_attach_url": f"ws://127.0.0.1:{status.local_port}/attach",
        "remote_hostname": status.remote_hostname,
        "remote_port": status.remote_port,
        "local_port": status.local_port,
        "remote_cwd": status.remote_cwd,
    }
```

### Step 5: `SSHTunnelManager.connect()` — 核心连接逻辑

**文件:** `cores/python/packages/drsai/src/drsai/backend/tui_gateway/ssh_tunnel.py` L113-175

```python
async def connect(self, cfg: SSHConfig) -> TunnelStatus:
    # 5a. 建立 SSH 连接
    self.ssh_client = paramiko.SSHClient()
    self.ssh_client.connect(hostname, port, username, password, key_filename)
    
    # 5b. 解析远程 opendrsai 路径
    opendrsai_path = self._resolve_opendrsai()  # which opendrsai
    
    # 5c. 查找本地空闲端口
    self.local_port = self._find_free_port()
    
    # 5d. 启动远程 Gateway（WebSocket 模式）
    remote_port = await self._start_remote_gateway(opendrsai_path, cfg)
    
    # 5e. 启动本地端口转发隧道
    self._start_tunnel(remote_port)
    
    # 5f. 返回隧道状态
    return TunnelStatus(local_port, remote_port, ...)
```

### Step 5d: 启动远程 Gateway

**文件:** `cores/python/packages/drsai/src/drsai/backend/tui_gateway/ssh_tunnel.py` L280-400

这是最复杂的部分，需要解决多个问题：

```python
async def _start_remote_gateway(self, opendrsai_path, cfg):
    # 1. 查找远程空闲端口
    remote_port = self._find_remote_free_port()
    
    # 2. 构建环境变量
    env_updates = {
        "DRSAI_TUI_ENABLE_WS": "1",           # 启用 WebSocket 模式
        "DRSAI_TUI_WS_PORT": str(remote_port), # WS 监听端口
    }
    if cfg.remote_workdir:
        env_updates["DRSAI_USER_CWD"] = cfg.remote_workdir  # 远程工作目录
    
    # 3. 构建 base64 编码的启动脚本
    #    使用 base64 避免转义问题
    launcher_script = f"""
import base64, subprocess, os, sys
cmd = base64.b64decode("{b64_cmd}").decode()
env = dict(os.environ)
env.update({env_updates})
# 关键: close_fds=True + start_new_session=True
# 防止 SSH channel fd 被 inherit 导致 hang
proc = subprocess.Popen(
    cmd, shell=True, env=env,
    stdin=subprocess.DEVNULL,
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
    close_fds=True,
    start_new_session=True
)
print(proc.pid, flush=True)
"""
    
    # 4. 通过 SSH exec 执行启动脚本
    stdin, stdout, stderr = self.ssh_client.exec_command(
        f"python3 -c '{launcher_script}'"
    )
    remote_pid = int(stdout.readline().strip())
    
    # 5. 端口就绪探测
    #    通过 SSH channel 发送 HTTP upgrade 请求验证端口可用
    #    （而非仅 open_channel + close，后者会产生 false positive）
    await self._probe_port_ready(remote_port)
    
    return remote_port
```

**关键设计决策：**
- **base64 编码启动脚本**：避免 SSH exec 命令中的 shell 转义问题
- **`close_fds=True, start_new_session=True`**：防止远程 Gateway 进程继承 SSH channel 的文件描述符，否则 SSH channel 关闭时 Gateway 会 hang
- **HTTP upgrade 端口探测**：仅打开 SSH channel 再关闭会返回 false positive（SSH channel 成功即使 TCP 端口没有监听器），必须发送实际的 HTTP upgrade 请求并读取响应

### Step 5e: 启动本地端口转发隧道

**文件:** `cores/python/packages/drsai/src/drsai/backend/tui_gateway/ssh_tunnel.py` L420-460

```python
def _start_tunnel(self, remote_port):
    # 1. 创建本地 TCP socket
    self.tunnel_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    self.tunnel_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    self.tunnel_socket.bind(("127.0.0.1", self.local_port))
    self.tunnel_socket.listen(5)
    
    # 2. 启动隧道工作线程
    self.tunnel_thread = threading.Thread(
        target=self._tunnel_worker,
        args=(remote_port,),
        daemon=True
    )
    self.tunnel_thread.start()
```

**隧道工作线程** (L420-460):
```python
def _tunnel_worker(self, remote_port):
    while not self._stop_event.is_set():
        # 接受本地连接
        local_conn, _ = self.tunnel_socket.accept()
        
        # 通过 SSH 打开 direct-tcpip channel 到远程端口
        remote_channel = self.ssh_client.get_transport().open_channel(
            "direct-tcpip",
            ("127.0.0.1", remote_port),
            local_conn.getpeername()
        )
        
        # 双向转发
        self._forward_pair(local_conn, remote_channel)
```

**双向转发** (L465-485):
```python
def _forward_pair(self, src, dst):
    def forward(s, d):
        try:
            while True:
                data = s.recv(65536)
                if not data:
                    break
                d.sendall(data)
        except OSError:
            pass
        finally:
            try: s.close()
            except: pass
            try: d.close()
            except: pass
    
    # 两个 daemon 线程分别转发 src→dst 和 dst→src
    t1 = threading.Thread(target=forward, args=(src, dst), daemon=True)
    t2 = threading.Thread(target=forward, args=(dst, src), daemon=True)
    t1.start()
    t2.start()
```

### Step 6: TUI 切换到 WebSocket 模式

**文件:** `apps/ui-tui/src/components/composerPane.tsx` L1020-1060

`onRemoteConnect` 回调被调用：

```typescript
onRemoteConnect={async (result) => {
    // 6a. 切换 GatewayClient 到 WebSocket 模式
    await controller.gw.switchToWebSocket(result.ws_attach_url)
    $remoteHost.set(result.remote_hostname || '')
    
    // 6b. 清除本地会话状态
    $transcript.set([])
    $current.set(null)
    $sessionMeta.set(null)
    
    // 6c. 从远程 Gateway 解析会话
    const recent = await controller.gw.request<{
      session: SessionInfo | null
    }>('session.most_recent', {})
    
    let sid = recent.session?.session_id ?? null
    if (!sid) {
      // 没有最近会话，创建新会话
      const created = await controller.gw.request<SessionCreateResult>('session.create', {})
      sid = created.session?.session_id ?? null
    }
    
    if (sid) {
      await switchSession(sid)
    }
    
    // 6d. 显示成功消息
    showSlashOutput(
      `✅ Connected to ${result.remote_hostname} via SSH tunnel` +
      (result.remote_cwd ? `\n   Remote workdir: ${result.remote_cwd}` : ''),
      4000,
    )
}}
```

### Step 6a: `switchToWebSocket()` — 模式切换核心

**文件:** `apps/ui-tui/src/gatewayClient.ts` L450-520

```typescript
switchToWebSocket(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // 标记远程 SSH 模式
      this.isRemoteSshMode = true
      
      // 关键: 不杀本地子进程！
      // 本地子进程持有 SSH 隧道 + 远程 Gateway PID
      // 只移除事件监听器，保留进程运行
      if (this.proc) {
        this.proc.removeAllListeners()
        // 注意: 不调用 this.proc.kill()
      }
      
      // 重置 ready 状态
      this.ready = false
      this.readyPromise = new Promise((res, rej) => {
        this.resolveReady = res
        this.rejectReady = rej
      })
      
      // 切换到 WebSocket 模式
      this.mode = 'websocket'
      
      // 创建 WebSocket 连接到本地隧道端口
      // ws://127.0.0.1:{local_port}/attach
      this.ws = new WebSocket(url)
      
      this.ws.on('open', () => {
        this.ready = true
        this.resolveReady()
      })
      
      this.ws.on('message', (raw) => {
        this.dispatch(JSON.parse(raw.toString()))
      })
      
      this.ws.on('error', (err) => {
        this.publish({ type: 'gateway.stderr', payload: { line: `[ws] ${err.message}` } })
      })
      
      this.ws.on('close', () => {
        if (this.isRemoteSshMode) {
          // 远程连接丢失 — 不退出 TUI，显示重连提示
          this.handleRemoteLost('WebSocket connection closed')
        } else {
          this.handleExit(0, 'WebSocket closed')
        }
      })
    })
}
```

**关键设计：** `switchToWebSocket()` **不杀本地子进程**。本地子进程持有 SSH 隧道和远程 Gateway PID，必须保持运行。仅移除事件监听器，防止旧子进程的 stdio 事件干扰新的 WebSocket 通信。

### Step 7: WebSocket 通信

此后，所有 RPC 请求通过 WebSocket 发送到远程 Gateway：

**文件:** `apps/ui-tui/src/gatewayClient.ts` L282-320

```typescript
request<T>(method: string, params: object): Promise<T> {
    const id = ++this._requestId
    const frame = { jsonrpc: '2.0', id, method, params }
    
    if (this.mode === 'websocket' && this.ws) {
      // WebSocket 模式: 发送到远程 Gateway
      this.ws.send(JSON.stringify(frame))
    } else if (this.proc?.stdin?.writable) {
      // stdio 模式: 发送到本地子进程
      this.proc.stdin.write(JSON.stringify(frame) + '\n')
    }
    
    return new Promise((resolve, reject) => {
      this._pending.set(id, { resolve, reject })
    })
}
```

---

## 3. 断开连接流程

### Step 1: 用户触发断开

**文件:** `apps/ui-tui/src/components/sshRemotePanel.tsx` L157-180

```typescript
const disconnect = async () => {
    // 关键: 不通过 WebSocket 发送 remote.disconnect
    // 因为 remote.disconnect 是本地 Gateway 的处理器
    // 通过 WebSocket 发送会到达远程 Gateway（没有此处理器）→ 30s 超时
    
    // 直接调用 onRemoteDisconnect 回调
    await onRemoteDisconnect?.()
}
```

### Step 2: `switchToSubprocess()` — 切换回本地模式

**文件:** `apps/ui-tui/src/gatewayClient.ts` L530-590

```typescript
switchToSubprocess(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.isRemoteSshMode = false
      
      // 关闭 WebSocket
      if (this.mode === 'websocket' && this.ws) {
        this.ws.close()
        this.ws = null
      }
      
      // 通过 stdin 向本地子进程发送 remote.disconnect
      // (fire-and-forget) 让本地 Gateway 清理远程进程和 SSH 连接
      if (this.proc) {
        const disconnectReq = JSON.stringify({
          jsonrpc: '2.0',
          id: `cleanup-${Date.now()}`,
          method: 'remote.disconnect',
          params: {},
        }) + '\n'
        this.proc.stdin?.write(disconnectReq)
        
        // 移除监听器并杀掉旧子进程
        this.proc.removeAllListeners()
        this.proc.kill('SIGTERM')
        this.proc = null
      }
      
      // 重置 ready 状态
      this.ready = false
      this.readyPromise = new Promise(...)
      
      // 切换回 stdio 模式并启动新子进程
      this.mode = 'stdio'
      this.startSubprocess()
    })
}
```

### Step 3: 本地 Gateway 清理 SSH 隧道

**文件:** `cores/python/packages/drsai/src/drsai/backend/tui_gateway/handlers/remote.py` L188-195

```python
async def handle_remote_disconnect(params):
    global _tunnel
    if _tunnel:
        _tunnel.disconnect()
        _tunnel = None
    return {"disconnected": True}
```

**文件:** `cores/python/packages/drsai/src/drsai/backend/tui_gateway/ssh_tunnel.py` L560+

```python
def disconnect(self):
    # 1. 停止隧道线程
    self._stop_event.set()
    if self.tunnel_socket:
        self.tunnel_socket.close()
    
    # 2. 杀远程 Gateway 进程
    if self.remote_pid and self.ssh_client:
        self.ssh_client.exec_command(f"kill -9 {self.remote_pid}")
    
    # 3. 关闭 SSH 连接
    if self.ssh_client:
        self.ssh_client.close()
```

---

## 4. 传输路由机制

远程模式下，AI Agent 的响应事件需要正确路由到 WebSocket 传输。

### 4.1 ContextVar 传输绑定

**文件:** `cores/python/packages/drsai/src/drsai/backend/tui_gateway/transport.py` L62-75

```python
_current_transport: ContextVar[Transport | None] = ContextVar(
    'current_transport', default=None
)

def bind_transport(t: Transport) -> Token:
    return _current_transport.set(t)

def reset_transport(token: Token) -> None:
    _current_transport.reset(token)

def current_transport() -> Transport | None:
    return _current_transport.get()
```

### 4.2 会话级传输存储

**文件:** `cores/python/packages/drsai/src/drsai/backend/tui_gateway/handlers/session.py` L69-130

```python
def _ensure_agent_session(sid: str):
    if sid not in _sessions:
        _sessions[sid] = {
            "agent": ...,
            "transport": current_transport(),  # 存储当前传输
            ...
        }
```

**关键修复：** 守护线程（daemon thread）不继承 ContextVar 绑定。如果不显式存储传输，守护线程中的事件会 fallback 到 `_stdio_transport`（WS 模式下 stdout=/dev/null），导致聊天流式响应永远不返回。

### 4.3 `write_json()` 路由优先级

**文件:** `cores/python/packages/drsai/src/drsai/backend/tui_gateway/server.py` L162-178

```python
def write_json(sid: str, obj: dict):
    # 优先级 1: 会话存储的传输（守护线程事件）
    transport = _sessions.get(sid, {}).get("transport")
    
    # 优先级 2: ContextVar 当前传输
    if transport is None:
        transport = current_transport()
    
    # 优先级 3: stdio fallback
    if transport is None:
        transport = _stdio_transport
    
    transport.write(obj)
```

### 4.4 StdioTransport

**文件:** `cores/python/packages/drsai/src/drsai/backend/tui_gateway/transport.py` L78-170

```python
class StdioTransport(Transport):
    def write(self, obj: dict):
        try:
            line = json.dumps(obj, ensure_ascii=False, default=str)
            self._stdout.write(line + "\n")
            self._stdout.flush()
        except (BrokenPipeError, UnicodeEncodeError, OSError):
            # 对端关闭 — 静默处理
            pass
```

---

## 5. 远程工作目录解析

### 5.1 `_resolve_workdir()` 辅助函数

**文件:** `cores/python/packages/drsai/src/drsai/backend/tui_gateway/handlers/session.py` L57-65

```python
def _resolve_workdir() -> Path:
    """解析工作目录，优先使用 DRSAI_USER_CWD 环境变量。"""
    cwd_env = os.environ.get("DRSAI_USER_CWD")
    if cwd_env:
        return Path(cwd_env).resolve()
    return Path.cwd().resolve()
```

**关键修复：** 远程 Gateway 的 `cwd` 可能是用户的 home 目录（当 SSH 配置未设置 `remote_workdir` 时），而非用户的项目目录。使用 `Path.cwd().resolve()` 作为 workdir_filter 会导致 `/list` 命令过滤掉所有会话。

### 5.2 `/list` 命令在远程模式的行为

**文件:** `cores/python/packages/drsai/src/drsai/backend/tui_gateway/handlers/slash.py` L1067-1093

```python
async def cmd_list(...):
    workdir_filter = None
    cwd_env = os.environ.get("DRSAI_USER_CWD")
    
    if cwd_env:
        workdir_filter = Path(cwd_env).resolve()
    elif os.environ.get("DRSAI_TUI_ENABLE_WS") == "1":
        # WS 模式但没有 DRSAI_USER_CWD — 显示所有会话
        workdir_filter = None
    else:
        workdir_filter = Path.cwd().resolve()
    
    sessions = store.list(user_id=..., workdir=workdir_filter)
```

---

## 6. 远程目录浏览

**文件:** `cores/python/packages/drsai/src/drsai/backend/tui_gateway/handlers/remote.py` L280-350

在 SSH 配置编辑界面，用户可以按 Enter 浏览远程目录选择 `remote_workdir`：

```python
async def handle_remote_browse_dirs(params):
    # 创建临时 SSH 连接（不复用主隧道）
    client = paramiko.SSHClient()
    client.connect(hostname, port, username, ...)
    
    # 使用 SFTP 列出目录
    sftp = client.open_sftp()
    entries = []
    for attr in sftp.listdir_attr(path):
        entries.append({
            "name": attr.filename,
            "is_dir": attr.st_mode & 0o040000 != 0,
            "size": attr.st_size,
        })
    
    sftp.close()
    client.close()
    return {"entries": entries, "path": path}
```

---

## 7. `requestLocal()` — WS 模式下的本地 RPC

**文件:** `apps/ui-tui/src/gatewayClient.ts` L350-390

在 WebSocket 模式下，某些 RPC（如 `remote.connect`, `remote.disconnect`）需要发送给**本地** Gateway 而非远程。`requestLocal()` 方法解决此问题：

```typescript
requestLocal<T>(method: string, params: object): Promise<T> {
    // 即使在 WebSocket 模式下，也通过 proc.stdin 发送
    if (this.proc?.stdin?.writable) {
      const frame = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'
      this.proc.stdin.write(frame)
    }
    return new Promise(...)
}
```

---

## 8. 关键文件索引

| 文件 | 作用 | 关键行号 |
|------|------|----------|
| `apps/ui-tui/src/components/sshRemotePanel.tsx` | SSH 远程面板 UI | L1-82 (组件), L131-155 (connect), L157-180 (disconnect) |
| `apps/ui-tui/src/components/composerPane.tsx` | onRemoteConnect/Disconnect 回调 | L1006-1060 (connect), L1080-1110 (disconnect) |
| `apps/ui-tui/src/gatewayClient.ts` | Gateway 客户端 | L172-240 (startSubprocess), L242-280 (startWebSocket), L282-320 (request), L350-390 (requestLocal), L450-520 (switchToWebSocket), L530-590 (switchToSubprocess) |
| `cores/python/.../tui_gateway/ssh_tunnel.py` | SSH 隧道管理 | L57-86 (SSHConfig), L113-175 (connect), L280-400 (_start_remote_gateway), L420-460 (_start_tunnel), L465-485 (_forward_pair), L560+ (disconnect) |
| `cores/python/.../tui_gateway/handlers/remote.py` | 远程 RPC 处理器 | L42-55 (单例), L130-185 (connect), L188-195 (disconnect), L280-350 (browse_dirs) |
| `cores/python/.../tui_gateway/transport.py` | 传输抽象 | L62-75 (ContextVar), L78-170 (StdioTransport) |
| `cores/python/.../tui_gateway/server.py` | Gateway 服务器 | L162-178 (write_json 路由), L342-349 (_resolve_user_id) |
| `cores/python/.../tui_gateway/handlers/session.py` | 会话管理 | L57-65 (_resolve_workdir), L69-130 (_ensure_agent_session), L185-205 (session.list) |
| `cores/python/.../tui_gateway/handlers/slash.py` | 斜杠命令 | L1067-1093 (cmd_list) |
| `cores/python/.../run_cli.py` | CLI 启动 | L350+ (_launch_tui, 设置 DRSAI_USER_CWD) |

---

## 9. 已修复的关键问题

### 9.1 聊天流式响应永远不返回

- **根因：** 守护线程不继承 ContextVar 传输绑定，事件 fallback 到 `_stdio_transport`（WS 模式下 stdout=/dev/null）
- **修复：** 在 `_ensure_agent_session()` 中存储 `current_transport()` 到 `_sessions[sid]["transport"]`
- **文件：** `session.py` L69-130, `server.py` L162-178

### 9.2 `/list` 显示无会话

- **根因：** `cmd_list` 使用 `Path.cwd().resolve()` 作为 workdir_filter，远程 Gateway cwd 是 home 目录而非项目目录
- **修复：** 添加 `_resolve_workdir()` 辅助函数优先使用 `DRSAI_USER_CWD`；WS 模式无 CWD 时显示所有会话
- **文件：** `session.py` L57-65, `slash.py` L1067-1093

### 9.3 断开连接 30s 超时挂起

- **根因：** `disconnect()` 通过 WebSocket 发送 `remote.disconnect` RPC 到远程 Gateway（没有此处理器）→ 30s 超时
- **修复：** `sshRemotePanel.disconnect()` 直接调用 `onRemoteDisconnect()`，触发 `switchToSubprocess()` 通过 `proc.stdin` 发送给本地 Gateway
- **文件：** `sshRemotePanel.tsx` L157-180, `gatewayClient.ts` L530-590

### 9.4 端口探测 false positive

- **根因：** `open_channel` + `close` 即使 TCP 端口没有监听器也会成功（SSH channel 层成功）
- **修复：** 发送 HTTP upgrade 请求并读取响应验证端口实际可用
- **文件：** `ssh_tunnel.py` L363-410

### 9.5 远程 Gateway 启动 hang

- **根因：** 远程 Gateway 进程继承 SSH channel 的文件描述符，SSH channel 关闭时 Gateway hang
- **修复：** 使用 `subprocess.Popen(close_fds=True, start_new_session=True)` 避免 fd 继承
- **文件：** `ssh_tunnel.py` L280-400

### 9.6 `switchToWebSocket()` 杀死本地子进程

- **根因：** 切换到 WebSocket 模式时杀掉本地子进程，导致 SSH 隧道断开
- **修复：** `switchToWebSocket()` 仅移除事件监听器，保留子进程运行
- **文件：** `gatewayClient.ts` L450-520

### 9.7 `onRemoteConnect` 失败不回滚

- **根因：** `onRemoteConnect` 失败后面板仍显示 "connected" 状态
- **修复：** `await onRemoteConnect` 包裹在 try/catch 中，失败时 `setStatus(null)` + `setView('list')`
- **文件：** `sshRemotePanel.tsx` L143-155

---

## 10. 数据流总结

```
用户输入消息
    │
    ▼
TUI (Ink/React)
    │ gw.request("prompt.submit", {message})
    ▼
gatewayClient.ts  ── WebSocket ──►  本地隧道端口 (127.0.0.1:local_port)
    │                                       │
    │                              SSH 端口转发 (paramiko direct-tcpip)
    │                                       │
    │                                       ▼
    │                              远程 Gateway WebSocket Server (127.0.0.1:remote_port)
    │                                       │
    │                              handlers/session.py → prompt.submit
    │                                       │
    │                              AI Agent (LLM) 处理
    │                                       │
    │                              write_json() → transport.write()
    │                              (优先级: session transport → ContextVar → stdio)
    │                                       │
    │                              WebSocket 发送事件
    │                                       │
    │                              SSH 隧道转发回本地
    │                                       │
    ▼                                       ▼
TUI 收到事件 ◄── WebSocket on('message') ◄── 本地隧道端口
    │
    ▼
渲染响应
```

---

*报告结束。如需进一步了解某个组件的细节，请参考上述文件路径和行号。*
