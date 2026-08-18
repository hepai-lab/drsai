## 21 Subagent（子智能体 / Delegate）

> **实现状态**：核心功能已实现（2026-06）。相关文件：`drsai_assistant.py:_execute_subagent`、`managers/get_managers_tools.py:get_subagent_tools`、`daemon_subagent.py`、`slash.py:cmd_agent/cmd_delegate`、`createGatewayEventHandler.ts:subagent.*`。

### 21.1 概念

**Subagent（子智能体）** 是 OpenDrSai CLI 的分层任务委派机制。当主智能体遇到复杂任务时，可将子任务委派给专门的子智能体执行。子智能体具有以下特性：

- **隔离上下文**：子智能体拥有独立的对话上下文，**看不到**父智能体的对话历史（Hermes 风格）。必须在 `prompt` 和 `context` 字段中提供完整信息
- **独立工具集**：每个子智能体可使用不同的工具白名单/黑名单
- **独立模型**：可指定与父智能体不同的模型配置
- **超时控制**：子智能体有独立的超时时间限制
- **深度限制**：防止无限递归委派

**两种调用路径**：

| 路径 | 触发方式 | 说明 |
|------|---------|------|
| **Delegate 工具** | LLM 自动调用 `Delegate` tool | AI 自主判断何时委派、选择哪个子智能体类型 |
| **默认路由** | `/agent <name>` 设置 + 用户提问 | 所有用户消息直接路由到指定的默认子智能体 |

### 21.2 内置子智能体类型

系统内置两种子智能体类型（定义在 `drsai_assistant.py:BUILTIN_SUBAGENTS`）：

| 类型 | 名称 | 工具集 | 说明 |
|------|------|--------|------|
| `explore` | Read-only code explorer | `run_read`、`run_glob`、`run_grep` | 只读代码探索，禁止任何写入/执行操作 |
| `general` | General-purpose subagent | `*`（全部工具） | 通用子智能体，拥有完整工具访问权 |

**内置子智能体配置项**：

| 参数 | `explore` | `general` | 说明 |
|------|-----------|-----------|------|
| `max_turns` | 200 | 200 | 最大对话轮数 |
| `timeout` | 3600s (1h) | 3600s (1h) | 子任务超时 |
| `role` | `leaf` | `leaf` | 叶节点角色，禁止递归委派 |
| `disallowed_tools` | `Delegate`, `ScheduledTaskManager`, `UpdateUserConfig` | 同左 | 禁止递归委派、修改配置、创建定时任务 |

> ⚠️ **安全机制**：所有内置子智能体默认禁止使用 `Delegate` 工具，防止子智能体继续委派导致无限递归。叶节点角色（`role: "leaf"`）强制追加 `Delegate` 到黑名单。

### 21.3 自定义子智能体（SUBAGENT_CONFIG.json）

用户可通过 `SUBAGENT_CONFIG.json` 自定义子智能体，配置文件路径：

```
~/.drsai/workspace/runs/<user_id>/configs/SUBAGENT_CONFIG.json
```

支持四种子智能体类型：

| 类型 | 说明 | 运行模式 |
|------|------|---------|
| **DrSaiAgent** | 普通 Autogen Assistant，可使用工具 | 本地实例化 |
| **CodeExecutorAgent** | Docker / .venv 沙箱代码执行 | 本地沙箱 |
| **HepAIWorkerAgent** | 链接远程智能体（HepAI 服务） | 远程 API |
| **RemoteAgent** | 链接远程 OpenAI ChatCompletions 格式的代理（如 OpenClaw） | 远程 API |
| **DaemonAgent** | 运行中的后台 daemon 实例（由系统自动注入） | WebSocket |

**配置格式示例**：

```json
{
    "code_runner": {
        "type": "CodeExecutorAgent",
        "description": "沙箱代码执行子智能体",
        "tools": [],
        "prompt": "你是一个代码执行专家，在沙箱环境中运行代码并返回结果。",
        "venv_path": "/path/to/venv"
    },
    "pdf_searcher": {
        "type": "DrSaiAgent",
        "description": "PDF 文档检索子智能体",
        "tools": ["pdf_manual_search"],
        "prompt": "你是一个 PDF 文档检索智能体，基于 pdf_manual_search 工具查询手册内容。",
        "model": "openai/gpt-5.2",
        "model_type": "openai",
        "base_url": "https://aiapi.ihep.ac.cn/apiv2"
    },
    "remote_boss": {
        "type": "HepAIWorkerAgent",
        "description": "可执行 BOSS 作业提交的远程智能体",
        "tools": [],
        "prompt": "你是一个 BOSS 作业提交专家。",
        "model_remote_configs": {
            "name": "BOSS8Agent",
            "url": "https://aiapi.ihep.ac.cn/apiv2"
        }
    },
    "openclaw_agent": {
        "type": "RemoteAgent",
        "description": "连接到 OpenClaw 的远程智能体",
        "prompt": "",
        "tools": [],
        "model_remote_configs": {
            "model": "openclaw",
            "url": "http://127.0.0.1:18789/v1/chat/completions",
            "headers": {
                "Authorization": "Bearer <token>",
                "Content-Type": "application/json",
                "x-openclaw-agent-id": "main"
            }
        }
    }
}
```

**配置热加载**：修改 `SUBAGENT_CONFIG.json` 后，CLI 在每次对话轮次 `lazy_init()` 中通过文件修改时间自动检测变更并热重载（`update_user_subagents()`），**无需重启 TUI 或 gateway**。

**Daemon 自动注入**：如果后台有运行中的 daemon 进程，它们会被自动注入为 `daemon:<name>` 格式的子智能体类型：

```
子智能体列表:
- explore: Read-only code explorer...
- general: General-purpose subagent...
- daemon:research-bot: 运行中的后台 daemon (port=8765, type=DaemonAgent)
```

### 21.4 命令

#### `/agent` — 设置/清除默认子智能体

```
/agent                    # 等同于 /agent list
/agent list               # 列出所有可用子智能体
/agent <name>             # 设置默认子智能体（case-insensitive 匹配）
/agent clear              # 清除默认子智能体设置
```

**设置默认子智能体后**，所有用户消息将直接路由到该子智能体处理，主智能体不再参与 LLM 推理。子智能体的响应作为 `AssistantMessage` 写入对话上下文。

**默认子智能体优先级**（`on_messages_stream` 中）：
1. `_thread_state.default_subagent`（通过 `/agent` 命令设置，内存级，最高优先级）
2. `THREAD_CONFIG.json` 中持久化的 `default_subagent`（跨会话恢复）

```
# 将代码探索子智能体设为默认
/agent explore
# → Default subagent set to: explore

# 将 daemon 设为默认
/agent daemon:research-bot
# → Default subagent set to: daemon:research-bot

# 清除默认，恢复主智能体模式
/agent clear
# → Default subagent cleared
```

#### `/delegate` (别名 `/sub`) — 手动委派任务

```
/delegate <agent_type> <prompt>
/sub <agent_type> <prompt>
```

示例：
```
/delegate general 帮我用 Python 写一个快速排序并测试
/sub explore 搜索所有包含 "TODO" 的 Python 文件
```

手动委派触发 `subagent.delegate` 事件，由 TUI 前端处理。

#### `/max_concurrent` (别名 `/mc`) — 子智能体并发控制

```
/max_concurrent             # 查看当前并发设置
/max_concurrent 3           # 设置最大并行数为 3
/mc status                  # 查看状态（别名）
```

设置子智能体的最大并行执行数量，**全局持久化**（保存到 `cli_config.json`）。默认值为 5。

- 值范围：1–256
- 同时影响当前 session 的 agent 和全局默认配置
- 在 `/status` 中可查看当前值

### 21.5 Delegate 工具（LLM 自动调用）

子智能体系统通过 `Delegate` 工具暴露给 LLM，使 AI 能够**自主判断**何时委派子任务。

**工具 Schema**（`get_subagent_tools()` 生成）：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `description` | `string` | ✅ | 简短任务描述（3-5 词） |
| `prompt` | `string` | ✅ | 具体任务描述，包含代码、路径、约束等 |
| `agent_type` | `enum` | ✅ | 子智能体类型（所有可用类型枚举） |
| `context` | `string` | 可选 | 背景信息（文件路径、错误信息、项目结构等） |

**工具描述**包含所有可用子智能体类型的说明，使 LLM 能够正确选择合适的子智能体。

### 21.6 执行流程

#### Delegate 工具调用流程

```
LLM 调用 Delegate(prompt="...", agent_type="explore", context="...")
  ↓
_process_model_result() 检测到 Delegate 工具调用
  ↓
_execute_subagent(sub_agent_name="explore", prompt="...", context="...")
  ├── 1. _check_delegate_depth()  → 防止超过最大深度（默认 99）
  ├── 2. 根据 agent_type 创建子智能体:
  │       ├── DrSaiAgent → _create_local_subagent()（实例化新 DrSaiCLIAssistant）
  │       ├── DaemonAgent → _create_daemon_subagent()（WebSocket 连接 daemon）
  │       └── RemoteAgent  → _create_remote_subagent()（远程 API）
  ├── 3. _build_subagent_messages()  → 构造 Hermes 风格消息（不含父历史）
  ├── 4. subagent.on_messages_stream()  → 流式执行，带独立 Timeout + CancellationToken
  ├── 5. _tag_message()  → 给输出标记来源（如 "sub:explore"）
  └── 6. _safe_close_subagent()  → 清理独立 model_client 连接
  ↓
结果作为工具调用返回注入主智能体上下文
```

#### 并行子智能体执行

当 LLM 在同一轮中调用多次 `Delegate`（不同 agent_type），系统自动**并行执行**（通过 `_execute_subagents_parallel()`）：

- **并发控制**：`asyncio.Semaphore(max_concurrent=3)` 限制最多 3 个并行子智能体
- **结果合并**：`asyncio.Queue` 按到达顺序流式输出，每条消息标记来源
- **独立取消**：每个子智能体拥有独立 `CancellationToken`，父取消时通过 watcher 传播

### 21.7 委派深度限制

为防止无限递归委派，系统实施了委派深度检查：

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `_delegate_depth` | 从 0 开始 | 当前委派深度 |
| `_max_delegate_depth` | 99 | 最大允许深度 |

每次 `_execute_subagent()` 调用 `_check_delegate_depth()`，超限时抛出 `DelegateDepthExceededError`：

```
⚠️ Cannot delegate further: max depth (99) exceeded (current: 99).
   This subagent is at the deepest allowed level.
```

`Delegate` 工具被列入 `_DEFAULT_DISALLOWED_FOR_SUBAGENTS` 黑名单，所有子智能体默认禁止再委派。

### 21.8 工具过滤

子智能体的工具列表通过以下机制确定：

```
1. cfg.tools (allowlist):
     "*" → 继承父智能体的全部工具
     ["run_read", "run_grep"] → 仅允许指定工具

2. cfg.disallowed_tools (blocklist) + 系统默认黑名单:
     _DEFAULT_DISALLOWED_FOR_SUBAGENTS = {Delegate, ScheduledTaskManager, UpdateUserConfig}
     叶节点角色 (role: leaf) → 追加 Delegate

3. agent_type 特殊规则:
     explore / plan → _READONLY_DISALLOWED_TOOLS（禁止所有写入/执行工具）
```

### 21.9 TUI 状态栏集成

子智能体执行时，TUI 底部状态栏实时显示子智能体信息：

| 状态 | StatusBar 显示 |
|------|---------------|
| 子智能体启动 | `⚡ explore: Searching for config files…` |
| 子智能体工作中 | `⚡ general: Writing test cases for module X…` |
| 子智能体完成 | 自动清除（恢复为空字符串） |
| 多个子智能体并行 | 按完成顺序逐个显示，最后完成的清除状态栏 |

详见 [17.4 子智能体 TUI 渲染行为](#174-子智能体-tui-渲染行为)。

### 21.10 Daemon 作为子智能体

运行中的 daemon 会自动注入为子智能体类型（`daemon:<name>`），可以通过以下方式调用：

```bash
# 查看可用的 daemon 子智能体
/agent list
# → - daemon:research-bot: 运行中的后台 daemon (port=8765, type=DaemonAgent)

# 设为默认子智能体
/agent daemon:research-bot

# 手动委派
/delegate daemon:research-bot 帮我分析这个数据集
```

**协议**：Daemon 子智能体通过 WebSocket JSON-RPC 与 daemon 通信：

```
DrSaiCLIAssistant (主智能体)
  ↓
DaemonSubagent (包装器)
  ↓  WebSocket ws://127.0.0.1:<port>/ws?token=<token>
Daemon Process (独立进程)
  ├── gateway.ready → 握手
  ├── session.create → 创建临时会话
  ├── prompt.submit → 提交任务
  └── message.delta / message.complete → 流式返回
```

详见 [19.8 作为子智能体被调用](#198-作为子智能体被调用)。

### 21.11 配置参考

| 参数 | 位置 | 说明 |
|------|------|------|
| `BUILTIN_SUBAGENTS` | `drsai_assistant.py` | 内置子智能体定义（explore、general） |
| `SUBAGENT_CONFIG.json` | `~/.drsai/workspace/runs/<user_id>/configs/` | 用户自定义子智能体 |
| `THREAD_CONFIG.json` | 同上 | 线程级默认子智能体（`/agent` 持久化） |
| `_thread_state.default_subagent` | 内存 | 会话级默认子智能体（`/agent` 设置，最高优先级） |

**环境变量**：

| 变量 | 说明 | 默认值 |
|------|------|-------|
| — | 子智能体超时（per subagent） | `600s` (10 分钟) |
| — | 最大并行子智能体数 | `3` |
| — | 委派深度上限 | `99` |

---

---

