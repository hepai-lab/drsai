# DrSai TUI Gateway 架构分析报告

> **分析日期**: 2025-07-24  
> **分析范围**: `tui_gateway/` ↔ TUI 前端 (`apps/ui-tui`) ↔ `run_drsai_agent_factory.py`  
> **核心问题**: TUI 网关如何与后端智能体进行 Session 管理、状态管理、配置管理及数据库交互

---

## 目录

1. [架构总览](#1-架构总览)
2. [分层组件详解](#2-分层组件详解)
3. [Session 管理](#3-session-管理)
4. [状态管理](#4-状态管理)
5. [配置管理](#5-配置管理)
6. [数据库交互](#6-数据库交互)
7. [事件流与消息协议](#7-事件流与消息协议)
8. [交互式回调机制](#8-交互式回调机制)
9. [端到端调用链路](#9-端到端调用链路)
10. [架构评价与改进建议](#10-架构评价与改进建议)

---

## 1. 架构总览

DrSai 的 TUI 系统采用 **三层架构**，通过 JSON-RPC 协议在进程间通信：

```
┌──────────────────────────────────────────────────────────────────────┐
│                        TUI 前端 (React/Ink)                           │
│                     apps/ui-tui/src/*.tsx                             │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────────────┐ │
│  │GatewayClient│──│TurnController│  │createGatewayEventHandler    │ │
│  │ (WebSocket/ │  │ (提交/取消)   │  │ (事件分发→Store突变)         │ │
│  │  stdio 通信) │  │              │  │                             │ │
│  └──────┬──────┘  └──────────────┘  └─────────────────────────────┘ │
└─────────┼────────────────────────────────────────────────────────────┘
          │ JSON-RPC over WebSocket / stdio
          │ {jsonrpc:"2.0", method, params, id} / {method:"event", params}
┌─────────┼────────────────────────────────────────────────────────────┐
│         ▼          TUI Gateway (Python WebSocket 服务)                 │
│              cores/python/.../backend/tui_gateway/                     │
│  ┌──────────────┐  ┌─────────────────┐  ┌──────────────────────────┐ │
│  │  server.py   │  │  transport.py   │  │  handlers/ (RPC 路由)     │ │
│  │ (WS服务+RPC  │  │ (stdio/WS适配)  │  │  session / prompt /      │ │
│  │  分发+阻塞回调)│  │                 │  │  slash / gfs / tools ... │ │
│  └──────┬───────┘  └─────────────────┘  └──────────────────────────┘ │
│         │                                                              │
│  ┌──────┴──────────────────────────────────────────────────────────┐ │
│  │                    adapter/ (适配层)                              │ │
│  │  ┌──────────────┐  ┌───────────────┐  ┌────────────────────────┐│ │
│  │  │ AgentSession │  │event_translator│  │  callbacks.py          ││ │
│  │  │ (智能体生命周期│  │(autogen事件→  │  │(approval/clarify/      ││ │
│  │  │  线程桥接)    │  │ 网关事件转换)  │  │ secret/sudo 阻塞回调)  ││ │
│  │  └──────┬───────┘  └───────────────┘  └────────────────────────┘│ │
│  └─────────┼────────────────────────────────────────────────────────┘ │
└────────────┼───────────────────────────────────────────────────────────┘
             │ create_agent() — 唯一接口
┌────────────┼───────────────────────────────────────────────────────────┐
│            ▼          后端智能体工厂                                    │
│     run_drsai_agent_factory.py (956 行)                                │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │  create_agent() → DrSaiCLIAssistant                              │ │
│  │  · 配置解析 (cli_config.json + 环境变量 + 默认值)                  │ │
│  │  · 模型客户端构建 (Anthropic / OpenAI)                            │ │
│  │  · 系统提示词生成 (工作目录感知)                                   │ │
│  │  · 工具集构建 (基础工具 + GFS 工具)                                │ │
│  │  · 工作空间策略 (Plan-C: 项目目录 + 存储目录)                      │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                    │                                                   │
│  ┌─────────────────▼───────────────────────────────────────────────┐ │
│  │  DrSaiCLIAssistant (autogen Agent)                               │ │
│  │  · run_stream() → 异步生成 autogen 事件流                         │ │
│  │  · save_state() / load_state() → 状态序列化                       │ │
│  │  · pause() / resume() → 中断控制                                  │ │
│  │  · switch_model() → 运行时模型切换                                 │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                    │                                                   │
│  ┌─────────────────▼───────────────────────────────────────────────┐ │
│  │  DatabaseManager (SQLite ORM)                                    │ │
│  │  · Thread 表: session 元数据 + 压缩状态                           │ │
│  │  · SessionMessage 表: 消息持久化                                  │ │
│  │  · SessionSummary 表: 会话摘要 (FTS5 全文索引)                    │ │
│  └─────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────┘
```

### 核心设计原则

| 原则 | 实现 |
|------|------|
| **单一接口** | 网关仅通过 `create_agent()` 一个函数与智能体工厂交互 |
| **事件驱动** | autogen 事件流 → 翻译为 JSON-RPC 事件 → WebSocket 推送至前端 |
| **线程隔离** | 每个 `AgentSession` 拥有独立 asyncio 事件循环（daemon 线程） |
| **关注点分离** | 工厂负责构造，网关负责 I/O/线程/持久化/协议 |

---

## 2. 分层组件详解

### 2.1 TUI 前端 (`apps/ui-tui/src/`)

| 文件 | 职责 |
|------|------|
| `gatewayClient.ts` | JSON-RPC 客户端：spawn 子进程(stdio模式) 或 WebSocket 连接(attach模式)；管理请求-响应映射；事件分发 |
| `turnController.ts` | 单轮对话编排：提交(`prompt.submit`)→流式渲染→完成(`message.complete`事件触发finalize) |
| `createGatewayEventHandler.ts` | 事件中心分发器：将网关事件路由到 nanostore 状态突变，触发 React 重渲染 |
| `turnStore.ts` | 全局对话状态：`$current`（当前流式回复）、`$isStreaming`、`appendTurn()` |
| `uiStore.ts` | UI 元状态：连接状态、session 元信息、用户 ID、状态栏 |
| `overlayStore.ts` | 覆盖层状态：审批弹窗、澄清请求、密码输入、sudo 确认 |
| `types.ts` | 领域类型：`AssistantTurn`、`UserTurn`、`ToolCall`（与网关协议类型分离） |

**通信模式**:
- **stdio 模式** (默认): TUI spawn `python -m drsai.backend.tui_gateway`，通过 stdin/stdout 交换 newline-delimited JSON
- **WebSocket 模式** (attach): 通过 `DRSAI_TUI_ATTACH_URL=ws://host:port/attach` 连接已运行的网关

### 2.2 TUI Gateway (`tui_gateway/`)

#### 核心文件

| 文件 | 行数 | 职责 |
|------|------|------|
| `server.py` | 366 | WebSocket 服务、RPC 方法注册(`@method`装饰器)、全局 `_sessions` 字典、`_emit()`/`_block()` 原语 |
| `transport.py` | 211 | 传输层抽象：stdio ↔ WebSocket 统一接口，帧序列化/反序列化 |
| `ws.py` | 179 | WebSocket 路由处理器，连接生命周期管理 |
| `entry.py` | 255 | 网关启动入口：参数解析、信号处理、stdio/WS 模式选择 |
| `__main__.py` | 6 | `python -m drsai.backend.tui_gateway` 入口 |

#### Adapter 适配层

| 文件 | 行数 | 职责 |
|------|------|------|
| `adapter/agent_runner.py` | 690 | **AgentSession 类**：智能体生命周期管理，asyncio 线程桥接，状态加载/保存 |
| `adapter/event_translator.py` | 532 | **纯翻译器**：autogen 消息 → 网关事件，维护 `TurnState` 跨消息上下文 |
| `adapter/callbacks.py` | 233 | **阻塞式回调**：approval/clarify/secret/sudo，通过 `server._block()` 等待 UI 响应 |

#### Handlers 处理器

| 文件 | 行数 | 职责 |
|------|------|------|
| `handlers/session.py` | 702 | Session CRUD、搜索、标签、置顶、归档、历史 |
| `handlers/prompt.py` | 201 | `prompt.submit`/`prompt.cancel`：提交/中断对话轮次 |
| `handlers/slash.py` | 2256 | Slash 命令处理（`/model`、`/tools`、`/clear` 等） |
| `handlers/gfs.py` | 335 | GFS 文件系统操作 |
| `handlers/skills.py` | 288 | 技能加载与管理 |
| `handlers/scheduler.py` | 262 | 定时任务管理 |
| `handlers/daemon.py` | 216 | 守护进程模式管理 |
| `handlers/setup.py` | 111 | 初始化配置引导 |
| `handlers/tools.py` | 54 | 工具列表查询 |
| `handlers/paste.py` | 61 | 粘贴处理 |
| `handlers/wechat.py` | 207 | 微信集成 |

### 2.3 后端智能体工厂 (`run_drsai_agent_factory.py`)

**纯工厂模式** — 仅负责构造 `DrSaiCLIAssistant` 实例，不管理其生命周期。

核心函数: `create_agent(api_key, thread_id, user_id, db_manager, cli_cfg, ...)`

工厂步骤:
1. 加载 CLI 配置 (`cli_config.json`)
2. 解析模型配置 (`llm_mode_config.yaml/JSON`)
3. 构建 `set_model_client()` 闭包（支持运行时模型切换）
4. 生成工作目录感知的系统提示词
5. 构建工具集（基础工具 + GFS 工具）
6. 设置工作空间策略（Plan-C: 项目目录 + 存储目录）
7. 构造并返回 `DrSaiCLIAssistant` 实例

---

## 3. Session 管理

### 3.1 Session 数据模型

Session 在数据库中对应 `Thread` 表：

```python
# Thread 模型 (SQLite)
{
    thread_id:    str       # 主键，唯一会话 ID
    user_id:      str       # 所有者
    title:        str       # 显示名称（默认为工作目录名）
    state:        blob      # zlib 压缩的智能体状态
    meta:         JSON      # 元数据: workdir, model_alias, plan_mode, tags, pinned, archived
    updated_at:   datetime  # 最后活动时间
    created_at:   datetime  # 创建时间
}
```

### 3.2 Session 生命周期

```
                    ┌─────────────────┐
                    │  session.create │  RPC: 创建新 Thread 记录
                    │  (handlers/     │  → db_manager.create(Thread, {...})
                    │   session.py)   │  → cli_config.set_workdir_session()
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │ AgentSession    │  创建 AgentSession 实例
                    │ .__init__()     │  → 新建 asyncio 事件循环 (daemon 线程)
                    │ .init()         │  → _async_init():
                    │                 │    1. create_agent() 构造智能体
                    │                 │    2. agent.lazy_init() 异步初始化
                    │                 │    3. _load_thread_state_async() 从 DB 加载状态
                    │                 │    4. agent.load_state(state) 恢复状态
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
    ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
    │ prompt.submit│ │session.list  │ │session.switch│
    │ (对话轮次)    │ │ (列表查询)    │ │_model(切换)  │
    │              │ │              │ │              │
    │ sess.run_turn│ │ db.query     │ │ agent.       │
    │ (阻塞daemon  │ │ (Thread)     │ │ _set_model_  │
    │  线程)       │ │              │ │ client()     │
    └──────┬───────┘ └──────────────┘ └──────────────┘
           │
           ▼
    ┌──────────────┐
    │sess.save_    │  每轮结束后持久化
    │state()       │  → agent.save_state() 序列化
    │              │  → compress_state() zlib 压缩
    │              │  → db_manager.upsert(Thread, {state, updated_at})
    └──────┬───────┘
           │
           ▼
    ┌──────────────────┐
    │ session.delete   │  RPC: 删除 Thread 记录
    │                  │  → db_manager.delete(Thread, thread_id)
    │                  │  → _sessions.pop(session_id) 清理内存
    └──────────────────┘
```

### 3.3 Session 内存管理

网关通过全局 `_sessions` 字典在内存中维护活跃会话：

```python
# server.py
_sessions = {
    "session-uuid-1": {
        "agent_session": AgentSession,   # 智能体运行时实例
        "user_id": "xiongdb",
        "history_lock": threading.Lock(), # 消息历史并发锁
        "running": False,                 # 是否正在执行对话轮次
        "transport": Transport,           # 传输通道引用 (WS/stdio)
    },
    ...
}
```

**关键设计**: `AgentSession` 被惰性创建（首次 `prompt.submit` 或 `session.resume` 时），而非在 `session.create` 时立即创建。这避免了空会话的资源浪费。

### 3.4 Session 恢复 (Resume)

```python
# handlers/session.py — session.resume
@method("session.resume")
def _resume(rid, params):
    session_id = params["session_id"]
    # 1. 获取或创建 AgentSession (触发 _async_init)
    sess = _ensure_agent_session(session_id, user_id)
    #    └── _async_init() 中:
    #        ├── create_agent() 构造空白智能体
    #        ├── _load_thread_state_async() 从 DB 读取压缩状态
    #        ├── decompress_state() zlib 解压
    #        └── agent.load_state(state_dict) 恢复对话历史 + 工具状态
    
    # 2. 加载消息历史
    store = _get_store(user_id)
    messages = store.get_messages(session_id)
    
    # 3. 推送 session.info 事件
    _emit("session.info", session_id, sess.info())
    
    # 4. 推送历史消息
    _emit("session.history", session_id, {"messages": messages})
```

---

## 4. 状态管理

### 4.1 三层状态架构

```
┌─────────────────────────────────────────────────────────────────────┐
│  Layer 1: 前端状态 (React nanostores)                                │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ turnStore:  $current (流式文本) | $isStreaming | turns[]      │ │
│  │ uiStore:    $connectionStatus | $sessionMeta | $userId       │ │
│  │ overlayStore: $approval | $clarify | $secret | $sudo         │ │
│  └───────────────────────────────────────────────────────────────┘ │
│  生命周期: 进程内 (TUI 关闭即丢失)                                     │
└─────────────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────────────┐
│  Layer 2: 网关运行时状态 (内存)                                       │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ _sessions dict:                                               │ │
│  │   agent_session.agent (DrSaiCLIAssistant) — 活跃智能体实例     │ │
│  │   agent_session._loop (asyncio.EventLoop) — 独立事件循环       │ │
│  │   running (bool) — 是否正在执行轮次                             │ │
│  │   history_lock (threading.Lock) — 消息并发锁                   │ │
│  └───────────────────────────────────────────────────────────────┘ │
│  生命周期: 网关进程内 (网关退出即丢失)                                 │
└─────────────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────────────┐
│  Layer 3: 持久化状态 (SQLite)                                        │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ Thread.state (zlib blob):                                     │ │
│  │   ├── 完整对话历史 (messages list)                             │ │
│  │   ├── 工具状态 (tool call records)                             │ │
│  │   └── 智能体配置快照 (model alias, plan_mode, ...)             │ │
│  │                                                               │ │
│  │ SessionMessage 表:                                            │ │
│  │   逐条消息记录 (role, content, timestamp)                     │ │
│  │                                                               │ │
│  │ Thread.meta (JSON):                                           │ │
│  │   workdir, model_alias, plan_mode, tags, pinned, archived    │ │
│  └───────────────────────────────────────────────────────────────┘ │
│  生命周期: 永久 (直到显式删除)                                        │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.2 状态序列化/反序列化

```python
# adapter/agent_runner.py — AgentSession

async def _async_save_state(self):
    """每轮对话结束后调用"""
    state_dict = self.agent.save_state()        # 智能体 → dict
    compressed = compress_state(state_dict)     # dict → zlib blob
    await self.db_manager.upsert(
        Thread,
        {
            "thread_id": self.session_id,
            "state": compressed,
            "updated_at": datetime.now(),
        }
    )

async def _load_thread_state_async(self):
    """Session 恢复时调用"""
    thread = await self.db_manager.get(Thread, self.thread_id)
    if thread and thread.state:
        state_dict = decompress_state(thread.state)  # zlib blob → dict
        return state_dict
    return None
```

### 4.3 运行时状态控制

| 操作 | 触发方式 | 实现 |
|------|----------|------|
| **暂停/中断** | `prompt.cancel` RPC | `agent.pause()` + 取消所有 asyncio tasks |
| **恢复** | 中断后自动 | `agent.resume()` (在 CancelledError 捕获中) |
| **模型切换** | `session.switch_model` RPC | `agent._set_model_client(alias)` → `agent.switch_model(new_client)` |
| **Plan 模式** | `session.set_state` RPC | `agent.set_state_value("plan_mode", True/False)` |
| **工作空间限制** | `session.set_state` RPC | `agent.set_state_value("only_in_workspace", True/False)` |

---

## 5. 配置管理

### 5.1 三层配置解析优先级

```
环境变量 (最高优先级)
    ↓ fallback
cli_config.json (~/.drsai/cli_config.json)
    ↓ fallback
内置默认值 (DEFAULT_LLM_MODE_CONFIG)
```

```python
# run_drsai_agent_factory.py
def _resolve(env_key, cfg_key, default, cast=str):
    """三层配置解析器"""
    val = os.environ.get(env_key)
    if val is not None:
        return cast(val)
    if cli_cfg and cfg_key in cli_cfg:
        return cast(cli_cfg[cfg_key])
    return default
```

### 5.2 配置文件体系

| 配置源 | 路径 | 内容 | 加载时机 |
|--------|------|------|----------|
| `cli_config.json` | `~/.drsai/cli_config.json` | api_key, base_url, user_id, default_model, gfs 配置, ragflow 配置, 安全开关 | 网关启动 + 每次 AgentSession 创建 |
| `llm_mode_config.yaml` | `~/.drsai/llm_mode_config.yaml` | 模型目录 (alias → model/token_limit/client_type/reasoning/vision) | `create_agent()` 内 `load_llm_mode_config()` |
| 环境变量 | - | `DRSAI_API_KEY`, `DRSAI_USER_ID`, `DRSAI_BASE_URL`, `DRSAI_RAGFLOW_URL` 等 | 覆盖所有配置 |

### 5.3 模型目录 (ModelEntry)

```python
@dataclass
class ModelEntry:
    model: str                    # 完整 API 模型名
    token_limit: int              # 上下文窗口大小
    max_tokens: int               # 最大输出 token
    client_type: str              # "anthropic" | "openai"
    reasoning: ReasoningConfig    # 推理能力配置
    vision: bool                  # 是否支持视觉
```

内置模型包括: `deepseek-v4-pro`(默认), `deepseek-v4-flash`, `gpt-5.4`, `gpt-5.5`, `glm-5.1`, `glm-5.2`, `minimax-m2.7-highspeed`, `claude-sonnet-4-6`, `claude-opus-4-7`, `claude-haiku-4-5`。

### 5.4 模型切换机制

工厂在 `create_agent()` 内构建 `set_model_client()` **闭包**，注入智能体实例：

```python
def set_model_client(alias: str):
    """运行时模型切换闭包"""
    entry = llm_mode_config.get(alias)
    if entry.client_type == "anthropic":
        client = HepAIAnthropicChatCompletionClient(
            model=entry.model,
            api_key=resolved_api_key,
            base_url=anthropic_base_url,
            max_tokens=entry.max_tokens,
            ...
        )
    else:
        client = HepAIChatCompletionClient(
            model=entry.model,
            api_key=resolved_api_key,
            base_url=openai_base_url,
            ...
        )
    return client

# 注入智能体
return assistant_cls(
    ...,
    set_model_client=set_model_client,    # 闭包
    llm_mode_config=llm_mode_config,      # 完整目录
    defult_config_name=resolved_alias,    # 默认别名
    ...
)
```

### 5.5 工作空间策略 (Plan-C)

```python
work_dir = cwd                                    # 用户当前项目目录
storage_dir = WORKSPACE_DIR / user_id             # DrSai 内部存储
only_in_workspace = True                          # 限制写入范围
extra_work_dirs = [storage_dir]                   # 允许访问存储目录
```

---

## 6. 数据库交互

### 6.1 数据库架构

```python
# server.py — 惰性单例
def _get_db_manager():
    engine_uri = f"sqlite:///{WORKSPACE_DIR}/drsai/drsai.db"
    db = DatabaseManager(engine_uri=engine_uri, base_dir=str(dataset))
    db.initialize_database()
    return db
```

### 6.2 数据表结构

| 表 | 用途 | 关键字段 |
|----|------|----------|
| `Thread` | Session 元数据 + 压缩状态 | thread_id, user_id, title, state(blob), meta(JSON), updated_at |
| `SessionMessage` | 逐条消息持久化 | message_id, thread_id, role, content, timestamp |
| `SessionSummary` | 会话摘要 + FTS5 全文索引 | summary_id, thread_id, summary_content, keywords, questions |
| `SessionSummaryFTS` | 摘要全文搜索 | FTS5 虚拟表，BM25 排序 |

### 6.3 数据库操作分布

```
┌─────────────────────────────────────────────────────────────────────┐
│  handlers/session.py — Session CRUD                                  │
│  ├── session.create  → db_manager.create(Thread, {...})             │
│  ├── session.list    → db_manager.query(Thread, filters, order_by)  │
│  ├── session.delete  → db_manager.delete(Thread, thread_id)         │
│  ├── session.rename  → db_manager.update(Thread, {title})           │
│  ├── session.search  → CLISessionStore.search(keyword)              │
│  ├── session.history → CLISessionStore.get_messages(thread_id)      │
│  └── session.tag/pin/archive → db_manager.update(Thread, {meta})    │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  adapter/agent_runner.py — 状态持久化                                 │
│  ├── _load_thread_state_async() → db_manager.get(Thread, id)        │
│  │   └── decompress_state(thread.state) → agent.load_state()        │
│  └── _async_save_state()                                            │
│      └── db_manager.upsert(Thread, {state: compressed, updated_at}) │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  DrSaiCLIAssistant (智能体内部) — 消息持久化                          │
│  └── agent.run_stream() 内部通过 db_manager 写入 SessionMessage 表   │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  retrieve_from_memory / summry_conversation_to_memory — 会话摘要     │
│  ├── 写入 SessionSummary 表 + FTS5 索引                             │
│  └── BM25 全文搜索 (支持 CJK trigram 回退)                          │
└─────────────────────────────────────────────────────────────────────┘
```

### 6.4 状态压缩策略

```python
# 使用 zlib 压缩智能体状态，减少 SQLite blob 体积
compress_state(state_dict)    # → zlib.compress(json.dumps(state_dict).encode())
decompress_state(blob)       # → json.loads(zlib.decompress(blob))
```

---

## 7. 事件流与消息协议

### 7.1 JSON-RPC 消息格式

**请求 (前端 → 网关)**:
```json
{
    "jsonrpc": "2.0",
    "method": "prompt.submit",
    "params": {"session_id": "xxx", "text": "Hello"},
    "id": 1
}
```

**响应 (网关 → 前端)**:
```json
{
    "jsonrpc": "2.0",
    "result": {"status": "streaming"},
    "id": 1
}
```

**事件推送 (网关 → 前端)**:
```json
{
    "jsonrpc": "2.0",
    "method": "event",
    "params": {
        "type": "message.delta",
        "session_id": "xxx",
        "payload": {"text": "Hello"}
    }
}
```

### 7.2 事件类型映射表

| autogen 事件 | 网关事件 | 用途 |
|-------------|---------|------|
| `ModelClientStreamingChunkEvent` | `message.delta` | LLM 流式文本块 |
| `TextMessage` (assistant) | `message.complete` | 回复完成 |
| `ToolCallRequestEvent` | `tool.start` | 工具调用开始 |
| `ToolCallExecutionEvent` | `tool.complete` | 工具调用完成 |
| `ThoughtEvent` | `thinking.delta` | 思维链/推理过程 |
| `UserInputRequestedEvent` | `interaction.request` | 请求用户输入 |
| `FilesEvent` | `artifact.created` | 生成文件 |
| `BackgroundTaskEvent` | `tool.progress` | 后台任务进度 |
| 子智能体输出 (`sub:*` source) | `subagent.thinking` | 子智能体思考 |
| - | `gateway.ready` | 网关就绪 |
| - | `gateway.exit` | 网关退出 |
| - | `session.info` | 会话信息更新 |

### 7.3 事件翻译器 (event_translator.py)

```python
@dataclass
class TurnState:
    """跨消息上下文，在单轮对话中累积"""
    streamed_visible: bool = False              # 是否已发送可见文本
    streamed_sources: set[str] = set()          # 已发送的来源标签
    pending_tool_calls: list[FunctionCall] = []  # 待处理的工具调用
    prompt_tokens: int = 0                       # 累计输入 token
    completion_tokens: int = 0                   # 累计输出 token
    last_model: str = ""                         # 最后使用的模型
    last_reasoning: str = ""                     # 最后推理内容
    citation_ids: set[str] = set()               # 引用 ID 集合

def translate(message: Any, state: TurnState) -> list[tuple[str, dict]]:
    """纯函数：autogen 消息 → [(event_type, payload), ...]"""
    # 无副作用，所有状态通过 TurnState 参数传递
```

### 7.4 前端事件处理 (createGatewayEventHandler.ts)

前端采用 **节流合并** 策略处理高频流式事件：

```typescript
// LLM 以 100-200Hz 发送 message.delta，React/Ink 无法跟上
// 合并到缓冲区，每 80ms 刷新一次 (~12fps)
const FLUSH_MS = 80
let textBuf = ''
let flushTimer: ReturnType<typeof setTimeout> | null = null

function flushBuffers() {
    if (textBuf) {
        updateCurrent(c => ({ ...c, text: c.text + textBuf }))
        textBuf = ''
    }
}
```

---

## 8. 交互式回调机制

### 8.1 阻塞式 RPC 模式

当智能体需要用户交互时（审批工具调用、请求澄清、输入密码、sudo 确认），通过 `server._block()` 机制实现**同步阻塞等待**：

```
智能体线程                         网关主线程                    前端
    │                                 │                           │
    │  approval_callback(             │                           │
    │    tool_name, args)             │                           │
    │────────────────────────────────▶│                           │
    │                                 │  _block("tool.approve",   │
    │                                 │    sid, {tool_name, args})│
    │                                 │──────────────────────────▶│
    │  (线程阻塞, 等待 Event)          │                           │
    │  ev.wait(timeout=300)           │                           │
    │                                 │                           │
    │                                 │     用户点击"批准"         │
    │                                 │◀──────────────────────────│
    │                                 │  approval.respond RPC     │
    │                                 │  → _answers[rid] = answer │
    │                                 │  → ev.set()               │
    │                                 │                           │
    │  ◀──────────────────────────────│                           │
    │  return answer ("approved")     │                           │
    │                                 │                           │
    │  继续执行工具...                 │                           │
```

### 8.2 四种交互回调

| 回调 | 触发场景 | 事件 | 响应方法 |
|------|---------|------|----------|
| `approval_callback` | 危险工具调用 | `tool.approve` | `approval.respond` |
| `clarify_callback` | 智能体需要澄清 | `clarify.request` | `clarify.respond` |
| `secret_callback` | 需要密码/API key | `secret.request` | `secret.respond` |
| `sudo_callback` | 需要 sudo 权限 | `sudo.request` | `sudo.respond` |

### 8.3 会话上下文传递

回调使用 `ContextVar` + 线程映射表确保多会话隔离：

```python
# adapter/callbacks.py
_current_session_id = ContextVar("session_id", default="")
_thread_session_map = {}  # fallback

def _resolve_session_id() -> str:
    sid = _current_session_id.get()
    if sid:
        return sid
    # Fallback: 线程 → session 映射
    tid = threading.current_thread().ident
    return _thread_session_map.get(tid, "")
```

---

## 9. 端到端调用链路

### 9.1 完整对话轮次

```
用户输入 "分析这段代码"
    │
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 1. 前端: TurnController.submit()                                     │
│    a. appendTurn({role: "user", text: "分析这段代码"})                │
│    b. setCurrent(newAssistantTurn())  — 创建空白助手轮次             │
│    c. $isStreaming.set(true)                                         │
│    d. gw.request("prompt.submit", {session_id, text})  — 异步发送    │
└──────────────────────────┬──────────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 2. 网关: handlers/prompt.py — prompt.submit                          │
│    a. _ensure_agent_session() — 获取/创建 AgentSession               │
│    b. 更新 Thread.updated_at                                         │
│    c. session.running = True                                         │
│    d. 绑定交互回调 (approval, clarify, secret, sudo)                 │
│    e. 启动 daemon 线程 → _run_turn_in_background()                   │
│    f. 立即返回 {status: "streaming"}                                 │
└──────────────────────────┬──────────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 3. Daemon 线程: _run_turn_in_background()                            │
│    a. 绑定 ContextVar (session_id) — 供回调使用                      │
│    b. sess.run_turn(text, _on_event, images) — 阻塞调用              │
└──────────────────────────┬──────────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 4. AgentSession.run_turn() — 跨线程提交协程                          │
│    self._run_coro(self._loop, _async_run_turn(...))                 │
│    将协程提交到 agent 的 asyncio 事件循环 (daemon 线程)              │
└──────────────────────────┬──────────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 5. AgentSession._async_run_turn() — agent 的事件循环上执行           │
│    async for message in agent.run_stream(task=text):                │
│        events = event_translator.translate(message, turn_state)     │
│        for evt_type, payload in events:                             │
│            on_event(evt_type, payload)  → server._emit()            │
│    return "complete"                                                │
└──────────────────────────┬──────────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 6. agent.run_stream() — DrSaiCLIAssistant 执行                      │
│    a. 应用系统提示词 + 工作空间上下文                                │
│    b. 调用模型客户端 (流式响应)                                      │
│    c. yield ModelClientStreamingChunkEvent → message.delta          │
│    d. 工具调用:                                                     │
│       - approval_callback() ← 阻塞等待用户审批                      │
│       - yield ToolCallRequestEvent → tool.start                     │
│       - 执行工具 (可能触发 sudo_callback)                            │
│       - yield ToolCallExecutionEvent → tool.complete                │
│    e. yield TextMessage → message.complete                          │
│    f. 持久化消息到 SessionMessage 表                                 │
└──────────────────────────┬──────────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 7. 事件推送 → 前端                                                   │
│    server._emit() → transport.send() → WebSocket/stdio              │
│    → GatewayClient 事件分发 → createGatewayEventHandler              │
│    → nanostore 突变 → React 重渲染                                   │
│                                                                      │
│    message.complete 触发:                                            │
│    → controller.finalize() → appendTurn() → $isStreaming.set(false) │
└──────────────────────────┬──────────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 8. 状态持久化                                                        │
│    sess.save_state():                                               │
│    → agent.save_state() → compress_state() → db_manager.upsert()    │
└─────────────────────────────────────────────────────────────────────┘
```

### 9.2 中断流程

```
用户按 Ctrl+C 或点击取消
    │
    ▼
前端: TurnController.cancel(sessionId)
  → gw.request("prompt.cancel", {session_id})
    │
    ▼
网关: handlers/prompt.py — prompt.cancel
  → sess.interrupt()
    │
    ▼
AgentSession.interrupt():
  ├── agent.pause()                          # 设置取消令牌
  ├── _loop.call_soon_threadsafe(task.cancel)  # 取消所有 asyncio 任务
  └── _clear_pending(sid)                    # 释放阻塞的回调
    │
    ▼
_async_run_turn() 中捕获 CancelledError:
  → agent.resume()                           # 重置暂停状态
  → return "interrupted"
    │
    ▼
daemon 线程:
  → session.running = False
  → 前端收到 interrupted 事件 → controller.finalize()
```

---

## 10. 架构评价与改进建议

### 10.1 优点

1. **清晰的关注点分离**: 工厂（构造）↔ 网关（I/O/线程/持久化）↔ 前端（渲染/交互）
2. **单一接口约束**: `create_agent()` 是工厂与网关之间的唯一契约，降低了耦合
3. **线程隔离设计**: 每个 AgentSession 独立 asyncio 循环，会话间互不阻塞
4. **事件驱动流式**: 从 LLM 到前端的全链路流式传输，用户体验流畅
5. **阻塞回调创新**: `_block()` 机制优雅地解决了智能体交互需求（审批/澄清/密码）
6. **状态压缩持久化**: zlib 压缩 + SQLite blob，兼顾效率和可靠性
7. **前端节流优化**: 80ms 合并刷新避免了高频流式事件导致 React/Ink 卡顿

### 10.2 潜在风险

| 风险 | 位置 | 影响 |
|------|------|------|
| **内存泄漏**: `_sessions` 字典无上限，长期运行会累积大量 AgentSession | `server.py` | OOM |
| **线程爆炸**: 每个会话 1 个 daemon 线程 + asyncio 循环，大量并发会话时线程过多 | `agent_runner.py` | 线程饥饿 |
| **阻塞回调超时**: `_block()` 默认 300s 超时，用户不响应会长时间占用线程 | `callbacks.py` | 线程泄露 |
| **状态反序列化失败**: 智能体版本升级后 `load_state()` 可能不兼容旧状态 | `agent_runner.py` | 会话恢复失败 |
| **SQLite 并发写入**: 多会话同时 `upsert` Thread.state 可能触发锁竞争 | `server.py` | 写入超时 |
| **ContextVar 回退**: `_thread_session_map` 作为 fallback 可能在复杂线程场景下不准确 | `callbacks.py` | 回调路由错误 |

### 10.3 改进建议

1. **会话 LRU 淘汰**: 为 `_sessions` 添加最大容量限制 + LRU 淘汰策略，避免内存无限增长
2. **线程池复用**: 考虑共享 asyncio 事件循环池而非每会话独占，降低线程开销
3. **状态版本化**: 在 `Thread.state` 中嵌入版本号，`load_state()` 时做兼容性迁移
4. **WAL 模式**: SQLite 启用 `PRAGMA journal_mode=WAL` 减少写锁竞争
5. **回调心跳**: `_block()` 增加心跳机制，前端可定期续期而非固定 300s 超时
6. **指标可观测性**: 添加会话数、线程数、回调等待时长的 metrics 暴露

---

## 附录: 关键文件索引

| 层级 | 文件路径 | 行数 |
|------|---------|------|
| **前端** | `apps/ui-tui/src/gatewayClient.ts` | ~350 |
| | `apps/ui-tui/src/app/turnController.ts` | ~100 |
| | `apps/ui-tui/src/app/createGatewayEventHandler.ts` | ~300 |
| | `apps/ui-tui/src/app/turnStore.ts` | ~60 |
| | `apps/ui-tui/src/app/types.ts` | ~100 |
| **网关核心** | `cores/.../tui_gateway/server.py` | 366 |
| | `cores/.../tui_gateway/transport.py` | 211 |
| | `cores/.../tui_gateway/ws.py` | 179 |
| | `cores/.../tui_gateway/entry.py` | 255 |
| **网关适配层** | `cores/.../tui_gateway/adapter/agent_runner.py` | 690 |
| | `cores/.../tui_gateway/adapter/event_translator.py` | 532 |
| | `cores/.../tui_gateway/adapter/callbacks.py` | 233 |
| **网关处理器** | `cores/.../tui_gateway/handlers/session.py` | 702 |
| | `cores/.../tui_gateway/handlers/prompt.py` | 201 |
| | `cores/.../tui_gateway/handlers/slash.py` | 2256 |
| **智能体工厂** | `cores/.../backend/run_drsai_agent_factory.py` | 956 |

---

*本报告基于代码静态分析生成，反映截至 2025-07-24 的代码状态。*
