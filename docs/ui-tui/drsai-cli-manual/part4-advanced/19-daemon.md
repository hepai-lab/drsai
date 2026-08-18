## 19 Daemon 后台常驻服务

> **实现状态**：已实现。代码位于 `backend/daemon/`。本章记录用户侧接口与行为规范。

### 19.1 背景与动机

当前 TUI gateway 以**子进程模式**运行：TUI 启动时 spawn，TUI 退出时随之销毁。这导致：

- 用户关闭 TUI 后所有进行中的 Agent 会话立即中断
- 微信等外部渠道无法与 Agent 通信
- 长耗时任务（爬虫、代码生成等）无法后台持续运行

**Daemon 模式**将 gateway 提升为独立后台进程，TUI 作为其管理终端，随时可 attach/detach。

### 19.2 `opendrsai daemon` 命令

```bash
# 启动后台 daemon（首次启动或重启）
drsai daemon start [--name <name>] [--port <port>] [--model <alias>] [--wechat] [--wechat-port <port>] [--restart]

# 停止指定 daemon（或所有）
drsai daemon stop [--name <name>] [--all]

# 查看所有 daemon 运行状态
drsai daemon status

# 输出精简列表（适合脚本）
drsai daemon list [--json]

# 实时查看 daemon 日志
drsai daemon logs [--name <name>] [--tail 50] [--follow]

# 向 daemon 中的 session 发送消息（调试用，非 TUI 交互）
drsai daemon send --name <name> --session <sid> "消息内容"
```

**启动示例（含微信）**：
```
$ drsai daemon start --name research-bot --model claude-sonnet-4-5 --wechat

 微信凭据不存在或已过期，正在进入扫码登录流程...

 ==================================================
 微信 ilink Bot 登录
 ==================================================

 正在获取二维码...
 ██████████████████████████████████████████████████
 请用微信扫描上方二维码

 等待扫码...
   已扫码，请在手机上确认...
 ✅ 扫码成功！
 凭据已保存到: ~/.drsai/workspace/wechat/credentials.json

  启动 Daemon 'research-bot'...

  ✓ DrSai Daemon 'research-bot' 启动成功

  PID        : 42817
  模型       : claude-sonnet-4-5
  WebSocket  : ws://127.0.0.1:42500/ws
  管理 API   : http://127.0.0.1:42500/api
  微信接入   : ilink Bot 长轮询 (端口 9000)
  API Token  : dsk_XXXXXXXXXXXXXXXX
  日志文件   : ~/.drsai/logs/daemons/research-bot.log

在 TUI 中可使用 /daemons 命令查看和管理此 daemon。
```

> **微信自动登录**：当 `--wechat` 启用但凭据文件（`~/.drsai/workspace/wechat/credentials.json`）不存在或已过期（>7天）时，`start` 命令会在父进程中自动触发终端二维码扫码登录。登录成功后凭据被持久化，后续重启无需重新扫码。详见 [20 微信接入](#20-微信接入)。

### 19.3 Daemon 运行状态

```
$ drsai daemon status

NAME            PID     WS PORT  MODEL               WECHAT PORT  UPTIME   SESSIONS  STATUS
research-bot    42817   8765     claude-sonnet-4-5   9000         2h 14m   3         running
coding-helper   23456   8766     gpt-4o              —            45m      1         running
old-bot         —       8767     —                   —            —        —         stopped (stale pid)
```

**状态说明**：

| 状态 | 含义 |
|------|------|
| `running` | PID 文件存在且进程活跃 |
| `stopped` | PID 文件不存在（正常退出） |
| `stale pid` | PID 文件存在但进程已死（崩溃） |

### 19.4 文件存储

| 文件 | 路径 | 说明 |
|------|------|------|
| PID 文件 | `~/.drsai/workspace/daemons/<name>.pid` | 进程 PID（纯数字） |
| State 文件 | `~/.drsai/workspace/daemons/<name>.json` | 端口、Token、启动时间等 |
| 日志文件 | `~/.drsai/logs/daemons/<name>.log` | stdout + stderr 合并 |

**State 文件格式**：
```json
{
  "name": "research-bot",
  "pid": 42817,
  "ws_port": 8765,
  "wechat_port": 9000,
  "wechat_enabled": true,
  "api_token": "dsk_XXXXXXXXXXXXXXXX",
  "model": "claude-sonnet-4-5",
  "started_at": 1748908800.0,
  "log_file": "/home/user/.drsai/logs/daemons/research-bot.log"
}
```

### 19.5 端口分配策略

| 参数 | 默认值 | 说明 |
|------|-------|------|
| `--port` | 自动从 42500 起扫描第一个可用端口 | WebSocket + HTTP 管理 API 端口 |
| `--wechat-port` | 自动从 9000 起扫描第一个可用端口 | 微信 ilink Bot 端口（仅 `--wechat` 时启用） |

如未指定 `--port`，daemon 自动扫描 `[42500, 43000)` 区间内第一个未被占用的端口；`--wechat-port` 自动扫描 `[9000, 9100)` 区间。多 daemon 实例互不冲突。

### 19.6 TUI 内 Daemon 管理面板（`/daemons`）

在 TUI 中输入 `/daemons` 打开 daemon 管理面板：

```
🖥 Daemons Manager
────────────────────────────────────────────────────────────
  NAME           PORT   WECHAT  STATUS   SESSIONS  UPTIME
▶ research-bot   8765   9000    running  3         2h 14m
  coding-helper  8766   —       running  1         45m
────────────────────────────────────────────────────────────
↑↓ navigate  Enter attach  s stop  l logs  q dismiss
```

**面板操作**：

| 按键 | 功能 |
|------|------|
| `↑` / `↓` | 移动光标 |
| `Enter` | 以 WebSocket 模式 attach 到高亮 daemon |
| `s` | 停止高亮 daemon（有确认） |
| `l` | 显示最近 50 条日志（实时更新） |
| `q` / `Esc` | 关闭面板 |

### 19.7 WebSocket 协议兼容性

Daemon 的 WebSocket 服务使用与现有 stdio 管道**完全相同**的 JSON-RPC 协议，所有现有 RPC 方法（`session.*`、`prompt.*`、`slash.exec`、`model.*` 等）均可通过 WebSocket 调用，TUI 无需修改业务逻辑。

```
TUI (Ink)
  ↕  JSON-RPC over WebSocket (ws://127.0.0.1:<port>/ws)
Daemon Process (独立进程，常驻后台)
  ├── AgentSession × N（多会话并发）
  ├── 微信 Webhook 适配层（可选）
  └── SQLite 持久化
```

### 19.8 作为子智能体被调用

> 关于子智能体系统的完整说明（内置类型、自定义配置、默认路由、委派深度限制等），请参见专门的 **[21 Subagent / 子智能体](#21-subagent子智能体delegate)** 章节。本节仅说明 daemon 作为子智能体的调用方式。

TUI 可将后台 daemon 作为子智能体，通过 `subagent.invoke` RPC 调用：

```json
{
  "method": "subagent.invoke",
  "params": {
    "daemon_name": "research-bot",
    "session_id": "parent-session-id",
    "prompt": "帮我分析这个数据集",
    "context": "背景信息…",
    "stream": true
  }
}
```

调用后 daemon 将结果通过 `subagent.delta` / `subagent.complete` 事件流式推回 TUI，显示效果与本地子智能体相同。

### 19.9 Daemon 模型独立配置

Daemon 可以独立于主智能体使用不同的模型。Daemon 的模型配置优先级为：

```
启动时 --model 参数  >  /api/model 运行时切换  >  全局 CLI config 文件
```

#### 启动时指定模型

```bash
# daemon 使用 claude-haiku，主智能体可以使用其他模型
drsai daemon start --name coder --model claude-haiku
```

参数 `--model` / `-m` 指定 daemon 的默认模型别名（与 `/model` 命令中的别名一致）。如果不指定，daemon 使用全局 CLI config 中的默认模型。

#### 运行时切换模型 (TUI)

在 TUI 中使用 `/daemon-model` 命令查看或切换 daemon 的模型：

```
# 查看 daemon 当前模型
/daemon-model coder
→ Daemon 'coder' 当前模型: claude-haiku

# 切换 daemon 模型（新 session + 已有 session 同步切换）
/daemon-model coder gpt-4o
→ ✓ Daemon 'coder' 模型已切换为 'gpt-4o'。
   2 个活跃 session 已同步切换。
   新 session 将默认使用此模型。
```

| 命令 | 别名 | 说明 |
|------|------|------|
| `/daemon-model <name>` | `/dmodel` | 查看 daemon 当前模型 |
| `/daemon-model <name> <model>` | `/dmodel` | 切换 daemon 模型 |

运行时切换通过 daemon 的 `POST /api/model` HTTP 接口实现，同时更新环境变量和所有活跃 session 的模型。

---

---

