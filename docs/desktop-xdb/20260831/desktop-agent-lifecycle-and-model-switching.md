# 桌面版 DrSaiAssistant 实例管理与模型切换完整数据流报告

> **生成时间**：2026-08-31  
> **分析范围**：桌面版 Desktop Gateway 如何管理后端 `DrSaiAssistant` 实例的完整生命周期（创建、缓存、销毁、状态持久化），以及模型切换如何触发 Agent 重建  
> **关键发现**：桌面 Gateway **不使用 `switch_model()`** 切换模型，而是在模型 alias 变化时*销毁旧 Agent 并重建全新 Agent*

---

## 目录

1. [架构总览](#一架构总览)
2. [DrSaiAssistant 实例管理](#二drsaiassistant-实例管理)
3. [模型切换数据流](#三模型切换数据流)
4. [状态持久化机制](#四状态持久化机制)
5. [`switch_model()` 的存在场景](#五switch_model-的存在场景)
6. [设计决策分析](#六设计决策分析)
7. [关键文件索引](#七关键文件索引)

---

## 一、架构总览

### 1.1 桌面 Gateway 四层架构

```
┌─────────────────────────────────────────────────────────────┐
│  前端 (Renderer / React)                                     │
│  ChatWorkspace → useDesktopChatAdapter → desktopApi          │
└─────────────────────────┬───────────────────────────────────┘
                          │ HTTP (localhost)
┌─────────────────────────▼───────────────────────────────────┐
│  Layer 1: FastAPI Application (app.py)                        │
│  ├── lifespan: 启动/关闭 RuntimeEngine                       │
│  └── routes/ (runs, config, config_agents, ...)              │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│  Layer 2: RuntimeAgentService (runtime/agent.py)              │
│  ├── execute(): 接收 model_override → 构造 AgentDefinition    │
│  └── 事件流翻译 → SSE                                        │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│  Layer 3: DesktopAgentBackend (_agent_backend.py)            │
│  ├── execute(): 调用 agent_manager.run_stream()               │
│  ├── _stream(): model_alias → agent_manager                   │
│  └── close(): 关闭所有 Agent                                  │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│  Layer 4: DesktopAgentManager (_agent_manager.py)             │
│  ├── _agents: dict[str, Any]  ← Agent 实例缓存                │
│  ├── _aliases: dict[str, str] ← 每个会话的当前 alias           │
│  ├── get_or_create(): 复用 / 重建决策                          │
│  ├── run_stream(): per-session 锁 + 执行 + 状态保存            │
│  ├── evict_user(): 驱逐用户所有 Agent                          │
│  └── close(): 关闭所有缓存的 Agent                              │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 `_state.py` 单例工厂

桌面 Gateway 使用惰性单例模式管理所有核心组件：

```python
# _state.py — 模块级单例访问器
def runtime_registry() -> DesktopRuntimeRegistry: ...   # 运行时注册表
def runtime_engine() -> RuntimeEngine: ...               # 引擎（管理 Session/Run）
def agent_manager() -> DesktopAgentManager: ...          # Agent 管理器
def agent_service() -> RuntimeAgentService: ...          # Agent 服务层
```

### 1.3 `app.py` lifespan 上下文管理

```python
# app.py L75-93 — FastAPI lifespan
@asynccontextmanager
async def lifespan(app: FastAPI):
    # --- 启动 ---
    engine = _state.runtime_engine()
    await engine.start()                          # 初始化 SQLite + 运行时
    yield
    # --- 关闭 ---
    await _state.agent_manager().close()           # 关闭所有 Agent
    await engine.stop()                            # 关闭数据库连接
```

---


## 二、DrSaiAssistant 实例管理

### 2.1 DesktopAgentManager 缓存结构

```python
# _agent_manager.py
class DesktopAgentManager:
    def __init__(self, ...):
        self._agents: dict[str, Any] = {}      # key="{user_id}::{session_id}" → Agent 实例
        self._aliases: dict[str, str | None] = {}  # key → 当前 alias
        self._locks: dict[str, asyncio.Lock] = {}  # key → per-session 锁
```

### 2.2 `get_or_create()` — 复用 / 重建决策

**文件**：`_agent_manager.py` L84-111

```python
async def get_or_create(
    self, user_id, session_id, *, model_alias=None, ...
) -> DrSaiAssistant:
    key = f"{user_id}::{session_id}"
    agent = self._agents.get(key)
    alias = model_alias or DEFAULT_CONFIG_NAME

    # 复用检查：已有 Agent 且 alias 相同 → 直接复用
    if agent is not None and self._aliases.get(key) == alias:
        return agent

    # alias 不同（或首次创建）→ 销毁旧 Agent + 创建新 Agent
    agent = await create_agent(
        defult_config_name=alias,       # ← 新 alias
        ...
    )
    await agent.lazy_init()             # 初始化
    state = await self._load_state(session_id, uid)
    if state and hasattr(agent, "load_state"):
        await agent.load_state(state)    # 恢复对话历史（restore_model=False）

    # 关闭旧 Agent
    previous = self._agents.get(key)
    if previous is not None and hasattr(previous, "close"):
        await previous.close()

    # 缓存新 Agent
    self._agents[key] = agent
    self._aliases[key] = alias
    return agent
```

### 2.3 `create_agent()` 工厂函数

**文件**：`run_drsai_agent_factory.py` L407

```python
async def create_agent(
    *,
    defult_config_name: str = DEFAULT_CONFIG_NAME,
    set_model_client=None,
    ...
) -> DrSaiAssistant:
    # 1. 解析模型配置名
    resolved_config_name = defult_config_name or DEFAULT_CONFIG_NAME

    # 2. 构建 set_model_client 闭包（如果未传入）
    if set_model_client is None:
        set_model_client = _build_set_model_client(resolved_config_name)

    # 3. 构建初始 model_client
    model_client = set_model_client(resolved_config_name)

    # 4. 构建 DrSaiAssistant 实例
    agent = DrSaiAssistant(
        model_client=model_client,
        set_model_client=set_model_client,  # 传给实例，供将来可能的 switch_model 使用
        defult_config_name=resolved_config_name,
        ...
    )
    return agent
```

### 2.4 `set_model_client()` 闭包工厂

**文件**：`run_drsai_agent_factory.py` L650-720

```python
def _build_set_model_client(config_name: str):
    """返回一个闭包函数，用于从 DEFAULT_LLM_MODE_CONFIG 查找配置并构建 client"""

    def set_model_client(name: str | None = None):
        resolved = name or config_name
        entry = DEFAULT_LLM_MODE_CONFIG.get(resolved)
        if entry is None:
            raise ValueError(f"Unknown model config: {resolved}")

        # 从 ModelEntry 构建 ChatCompletionClient
        client = ChatCompletionClient(
            model=entry.model_id,
            base_url=entry.base_url,
            api_key=entry.api_key,
            max_tokens=entry.max_context,
            ...
        )
        return client

    return set_model_client
```

### 2.5 DrSaiAssistant 构造函数初始化

**文件**：`drsai_assistant.py` L351

```python
class DrSaiAssistant(DrSaiAgent):
    def __init__(
        self,
        *,
        model_client: ChatCompletionClient,
        set_model_client=None,        # 闭包：用于将来 switch_model
        defult_config_name: str = DEFAULT_CONFIG_NAME,
        ...
    ):
        super().__init__(model_client=model_client, ...)
        self._set_model_client = set_model_client
        self.defult_config_name = defult_config_name
        # 初始化：ModelContext, SystemMessages, Tools, Skills, AgentKernel
        #         UserProfileManager, MEMORY.md 快照, ...
```

### 2.6 Per-Session 锁 — 并发控制

**文件**：`_agent_manager.py` L133-180

```python
async def run_stream(self, task, *, user_id, session_id, ...):
    key = f"{user_id}::{session_id}"
    lock = self._locks.setdefault(key, asyncio.Lock())

    # 尝试获取锁（不等待 — 拒绝并发）
    if lock.locked():
        raise AgentRuntimeError("session_busy", "该会话正在生成中...")

    async with lock:
        agent = await self.get_or_create(user_id, session_id, ...)
        try:
            yield event  # 流式事件
        finally:
            await self._save_state(session_id, user_id, agent)
```

> **设计选择**：使用"拒绝并发"策略而非"排队等待"。如果用户在生成过程中再次发送消息，直接返回 `session_busy` 错误，前端可提示"正在生成中..."。

### 2.7 `evict_user()` — 驱逐机制

**文件**：`_agent_manager.py` L260-274

```python
async def evict_user(self, user_id: str):
    """清除指定用户的所有缓存 Agent"""
    keys_to_remove = [k for k in self._agents if k.startswith(f"{user_id}::")]
    for key in keys_to_remove:
        agent = self._agents.pop(key, None)
        self._aliases.pop(key, None)
        if agent and hasattr(agent, "close"):
            await agent.close()
```

**触发场景**：

| 路由 | 触发条件 |
|------|----------|
| `PUT /v1/config/agents/{id}/tools` | 工具配置变更 |
| `PUT /v1/config/agents/{id}/skills` | 技能配置变更 |
| `PUT /v1/config/agents/{id}/knowledge` | 知识库配置变更 |
| `PUT /v1/config/agents/{id}/strategy` | Agent 策略变更 |

> **目的**：配置变更后清除旧 Agent，下次发消息时重建并加载最新配置。

### 2.8 `close()` — 关闭时机

**文件**：`_agent_manager.py` L197

| 时机 | 触发者 | 行为 |
|------|--------|------|
| 应用关闭 | `app.py` lifespan shutdown | `agent_manager.close()` → 逐个 `agent.close()` |
| 会话切换模型 | `get_or_create()` alias 变化 | `previous.close()` 关闭旧 Agent |
| 用户配置变更 | `evict_user()` | 逐个 `agent.close()` |

```python
async def close(self):
    for key, agent in list(self._agents.items()):
        if hasattr(agent, "close"):
            await agent.close()
    self._agents.clear()
    self._aliases.clear()
```

---


## 三、模型切换数据流

### 3.1 第一阶段：前端选择模型 → 持久化策略

```
ChatWorkspace.tsx: 用户点击模型选择器
  │
  ▼
handleChatModelSelect(model, providerId)              [App.tsx L2125]
  │ 如果是 OpenDrSai agent
  ▼
configureAgentModel()                                 [App.tsx L2167]
  │
  ▼
desktopApi.updateMyDrSaiAgentModelPolicy()            [App.tsx L2170]
  │
  ▼ HTTP PUT
PUT /v1/config/agents/{agent_id}/models                [config.py L459-506]
  │
  ▼
put_agent_model_policy()                               [config.py L459]
  │ 仅持久化到 Agent TOML 文件
  ▼
commit_agent_model_policy(policy, expected_revision)   [config.py L502]
  │
  ▼
setSelectedChatModel(effectiveRef.model_id)            [App.tsx L2188]
  → 前端 state 更新完成
```

> **关键点**：这个 PUT 请求只把模型策略写入 Agent TOML 文件，**不触发 `switch_model()`，也不重建 Agent**。真正的切换发生在下一次发消息时。

### 3.2 第二阶段：发送消息 → model_alias 传递

```
ChatWorkspace.tsx: 用户输入消息并发送
  │ selectedModelName 传递
  ▼
useDesktopChatAdapter.startChat()
  │ model: options?.model?.trim() || undefined          [useDesktopChatAdapter.ts L730]
  │ metadata: { thinking_effort, reasoning_effort }    [L738]
  ▼
client.executeRun(model_alias: model)                  [client.ts L262-270]
  │
  ▼ HTTP POST /v1/runs/{run_id}/execute
runs.py: run_execute()
  │ engine.set_run_input(model=request.model_alias)     [runs.py L94]
  │ _state.agent_service().execute(model_override=...)   [runs.py L108]
  ▼
RuntimeAgentService.execute()
  │ if model_override:
  │   definition = replace(definition, model=model_override) [agent.py L1118-1124]
  ▼
DesktopAgentBackend.execute()
  │ self._stream(model_alias=definition.model)           [_agent_backend.py L192]
  ▼
agent_manager.run_stream(model_alias=...)                [_agent_backend.py L199]
  ▼
DesktopAgentManager.get_or_create(model_alias=alias)     [_agent_manager.py L89]
```

### 3.3 第三阶段：Agent 重建（核心机制）

```python
# _agent_manager.py L89-111 — get_or_create()
alias = model_alias or DEFAULT_CONFIG_NAME

# 复用检查：如果已有 agent 且 alias 相同 → 直接复用
if agent is not None and self._aliases.get(key) == alias:
    return agent

# alias 不同 → 销毁旧 agent，创建新 agent
agent = await create_agent(
    defult_config_name=alias,       # ← 新 alias 作为模型配置键
    ...
)
# 初始化 + 从数据库恢复状态
await agent.lazy_init()
state = await self._load_state(session_id, uid)
if state and hasattr(agent, "load_state"):
    await agent.load_state(state)    # ← 恢复对话历史和配置

# 关闭旧 agent
if previous is not None and hasattr(previous, "close"):
    await previous.close()
```

在 `create_agent()` 内部：

```python
# run_drsai_agent_factory.py L889-892
model_client = set_model_client(resolved_config_name)
    # ↑ 从 DEFAULT_LLM_MODE_CONFIG 查找配置，构建新 ChatCompletionClient

agent = DrSaiAssistant(
    model_client=model_client,
    set_model_client=set_model_client,  # 传给实例，供将来可能的 switch_model 使用
    defult_config_name=alias,
    ...
)
```

### 3.4 完整数据流图

```
┌─────────────────────────────────────────────────────────────────────┐
│                    前端 (Renderer)                                    │
│  handleChatModelSelect → configureAgentModel → PUT /models          │
│                                                                     │
│  startChat → model_alias via POST /v1/runs/{id}/execute              │
└──────────────────────────────────┬──────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│  桌面 Gateway                                                        │
│                                                                     │
│  routes/runs.py: run_execute()                                      │
│    ├─ engine.set_run_input(model=request.model_alias)                │
│    └─ agent_service().execute(model_override=request.model_alias)    │
│                                                                     │
│  RuntimeAgentService.execute()                                       │
│    ├─ definition = replace(definition, model=model_override)          │
│    └─ backend.execute(context, definition, prompt, services)          │
│                                                                     │
│  DesktopAgentBackend.execute()                                       │
│    └─ _stream(model_alias=definition.model)                         │
│        └─ agent_manager.run_stream(task, model_alias=alias, ...)     │
│                                                                     │
│  DesktopAgentManager.run_stream()                                    │
│    ├─ get_or_create(model_alias=alias)                               │
│    │   ├─ alias 不变 → 复用缓存 Agent ✅                              │
│    │   └─ alias 变化 → create_agent(defult_config_name=alias)        │
│    │       → lazy_init() → load_state() → close(previous)  ❌ 重建   │
│    └─ agent.run_stream(task)                                        │
│        → finally: save_state()                                       │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│  DrSaiAssistant.run_stream()                                         │
│    ├─ ModelContext (对话历史)                                         │
│    ├─ SystemMessages (系统提示词)                                     │
│    ├─ Tools + Skills                                                 │
│    └─ AgentKernel (流式执行)                                          │
│        └─ _model_client.create_stream() → LLM API                    │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.5 推理强度（Reasoning Effort）数据流

推理强度参数有独立的传输路径，不经过模型 alias：

```
前端 ChatWorkspace.tsx
  │ reasoning_effort (e.g. "high", "medium", "low")
  ▼
useDesktopChatAdapter.ts L738
  │ metadata: { thinking_effort, reasoning_effort }
  ▼
POST /v1/runs/{run_id}/execute (metadata 字段)
  ▼
DesktopAgentBackend._stream()
  │ reasoning_effort = context.metadata.get("reasoning_effort")
  ▼
agent_manager.run_stream(reasoning_effort=...)
  ▼
DrSaiAssistant → LLM API 请求参数
```

**推理强度格式由 `param_type` 决定**：

| param_type | 适用模型 | 传输格式 |
|------------|----------|----------|
| `reasoning_effort` | OpenAI o-series | `reasoning_effort: "high"` |
| `deepseek_reasoning_effort` | DeepSeek | `deepseek_reasoning_effort: "high"` |
| `zhipu_format` | GLM | `thinking: {type: "enabled", budget_tokens: ...}` |
| `adaptive` | Gemini/Claude | 自适应（思维预算等） |
| `none` | 不支持的模型 | 不传该参数 |

`param_type` 唯一数据源是 `DEFAULT_LLM_MODE_CONFIG` 中的 `ModelEntry.reasoning_config.param_type`，通过 `find_model_capabilities()` 查找。

---


## 四、状态持久化机制

### 4.1 状态存储结构

桌面版的 Agent 状态存储在 **SQLite Thread 表**中。每个 `(session_id, user_id)` 对应一条 Thread 记录：

```
runtime.sqlite3
  └─ Thread 表
      ├─ session_id (主键)
      ├─ user_id
      ├─ workspace_id
      └─ state (BLOB, 压缩的 JSON)

engine.sqlite3
  ├─ Session 表 (会话元数据)
  ├─ Run 表 (运行记录 + input/output)
  └─ JournalEntry 表 (事件日志/SSE 回放)
```

### 4.2 `save_state()` — 每个 turn 结束后保存

**调用链**：`run_stream()` 的 `finally` 块 → `_save_state()` → `agent.save_state()` → 压缩 → 写入 Thread 表

```python
# DrSaiAgent.save_state() — drsaiagent.py L1436-1440
async def save_state(self):
    return DrSaiAgentState(
        llm_context=self._model_context,
        agent_kernel_checkpoint=...,
    )
```

**DrSaiCLIAssistant 的 save_state() 重写**（`drsai_cli_assistant.py` L137）保存更多字段：

```python
# 保存内容：llm_context + defult_config_name + injected prompts
#          + reasoning_effort + workspace config
```

### 4.3 `load_state()` — 创建/重建 Agent 时恢复

```python
# _agent_manager.py L84-111 — get_or_create() 内部
state = await self._load_state(session_id, uid)
if state and hasattr(agent, "load_state"):
    await agent.load_state(state)
```

**DrSaiCLIAssistant.load_state() 重写**（`drsai_cli_assistant.py` L152）：

```python
# restore_model=True (默认): 如果 saved_config != current → switch_model()
# restore_model=False (桌面版): 跳过模型恢复，保持 create_agent() 时传入的 alias
```

**桌面版传 `restore_model=False` 的原因**：`get_or_create()` 在创建 Agent 时已经使用了正确的 alias（从 `model_alias` 参数获取），如果 `load_state()` 再恢复旧模型会覆盖用户刚选择的模型。

### 4.4 状态压缩

```python
# _agent_manager.py — _save_state / _load_state
import zlib, json

async def _save_state(self, session_id, user_id, state_obj):
    raw = json.dumps(state_obj, default=str)
    compressed = zlib.compress(raw.encode("utf-8"))
    # 写入 Thread.state BLOB

async def _load_state(self, session_id, user_id):
    # 从 Thread.state 读取 BLOB
    decompressed = zlib.decompress(blob)
    return json.loads(decompressed.decode("utf-8"))
```

---


## 五、`switch_model()` 的存在场景

### 5.1 方法定义

**文件**：`cores/python/packages/drsai/src/drsai/modules/baseagent/drsaiagent.py` L1170-1230

```python
async def switch_model(self, new_model_client):
    # 1. 替换 model client
    old = self._model_client
    self._model_client = new_model_client
    # 2. 更新 model context 中的 client 引用
    self.model_context.update_model_client(new_model_client)
    # 3. 关闭旧 client（释放 HTTP 连接）
    if self._owns_model_client and old is not None:
        await old.close()
    # 4. 清理消息历史中的无效 tool calls/results
    await self._sanitize_api_messages()
    logger.info(f"Switched model to {new_model_client.model_info}")
```

### 5.2 Legacy Daemon / TUI Gateway 路径

`switch_model()` 在 **Legacy Daemon 和 TUI Gateway** 中被直接调用：

```python
# Legacy 路径 (非桌面 Gateway)
POST /api/model {model: "deepseek-v4-pro"}
  │
  ▼
sess.switch_model(new_model_client)
  │ 直接替换现有会话的 model client
  │ 不销毁/重建 Agent 实例
```

### 5.3 DrSaiCLIAssistant.load_state() 内部调用

当 `restore_model=True` 且保存的模型名与当前不同时：

```python
# drsai_cli_assistant.py L161-174
async def load_state(self, state, *, restore_model=True):
    ...
    if restore_model and saved_config and saved_config != self.defult_config_name:
        await self.switch_model(self._set_model_client(saved_config))
```

### 5.4 桌面版为何不使用 `switch_model()`

桌面 Gateway 选择**重建 Agent** 而非调用 `switch_model()` 的原因：

| 方面 | `switch_model()` | 重建 Agent |
|------|-------------------|------------|
| **模型 client** | 替换 `_model_client` | 全新 `create_agent()` |
| **工具/技能配置** | 不会重新加载 | 从最新 TOML 加载 |
| **系统提示词** | 不更新 | 重新构建（含 MEMORY.md 快照） |
| **AgentKernel** | 保持旧实例 | 全新 kernel |
| **UserProfileManager** | 保持旧实例 | 重新初始化 |
| **状态一致性** | 仅模型层一致 | 全部一致 |
| **性能开销** | 低（仅替换 client + 清理消息） | 高（完整构建流程） |

**结论**：桌面版选择重建是为了**确保所有 Agent 内部状态一致**，代价是较高的重建开销。但 `load_state()` 恢复对话历史后，用户体验等效于"换模型+恢复上下文"。

---


## 六、设计决策分析

### 6.1 Agent 缓存策略

**设计选择**：`(user_id, session_id)` 联合键 + alias 变化检测

**优势**：
- 每个 session 有独立的 Agent 实例，对话历史互不干扰
- alias 变化时自动重建，保证模型一致性
- 长生命周期 Agent 避免每次 turn 都走完整 `create_agent()` 流程

**代价**：
- Agent 实例常驻内存（直到关闭/驱逐）
- 模型切换时需重建整个 Agent（包括重新加载工具/技能/系统提示词）

### 6.2 并发控制策略

**设计选择**：per-session `asyncio.Lock` + **拒绝并发**（不排队）

**对比**：许多实现选择"排队等待"（第二个请求等待第一个完成）。桌面版选择"直接拒绝"（返回 `session_busy` 错误），前端可以提示用户"正在生成中..."。

**优势**：避免用户排队等待未知时间，提供即时反馈

### 6.3 状态持久化策略

**设计选择**：每个 turn 的 `finally` 块中保存 + 创建时恢复 + `restore_model=False`

**优势**：
- 异常也能持久化（`finally` 块）
- 重启后能恢复对话（`load_state`）
- 模型切换不被旧状态覆盖（`restore_model=False`）

### 6.4 驱逐策略

**设计选择**：策略变更后 `evict_user()` 清除该用户所有缓存 Agent

**优势**：用户修改工具/技能/知识库后，下次发消息时自动加载新配置

**代价**：驱逐后第一次 turn 会走完整 `create_agent()` 流程（有性能开销）

---


## 七、关键文件索引

### 后端核心文件

| 文件 | 职责 | 关键行 |
|------|------|--------|
| `backend/desktop_gateway/_state.py` | 单例工厂（RuntimeEngine, AgentManager, AgentService） | 全文件 |
| `backend/desktop_gateway/_agent_manager.py` | Agent 实例缓存 + 生命周期管理 | L84-111 (get_or_create), L133-180 (run_stream), L260-274 (evict_user), L197 (close) |
| `backend/desktop_gateway/_agent_backend.py` | AgentBackend 协议实现 + 事件翻译 | L185-199 (_stream), L306 (close) |
| `backend/desktop_gateway/app.py` | FastAPI 应用 + lifespan | L75-93 (lifespan) |
| `backend/desktop_gateway/routes/runs.py` | Run 生命周期入口 | L94 (set_run_input), L108 (execute) |
| `backend/desktop_gateway/routes/config.py` | 模型策略持久化 | L459-506 (put_agent_model_policy) |
| `backend/desktop_gateway/routes/config_agents.py` | Agent 配置 + evict 触发 | L474, L493, L672 (evict_user) |
| `backend/desktop_gateway/routes/config_tools.py` | 工具配置 + evict 触发 | L197, L229, L252 (evict_user) |
| `backend/desktop_gateway/routes/config_knowledge.py` | 知识库配置 + evict 触发 | L204, L222 (evict_user) |
| `backend/run_drsai_agent_factory.py` | Agent 工厂函数 | L407 (create_agent), L650-720 (set_model_client), L889-912 (实例化) |
| `backend/runtime/agent.py` | RuntimeAgentService | L1067 (class), L1095 (execute), L1118-1124 (model_override), L1170 (backend.execute) |

### Agent 类层级

| 文件 | 类 | 职责 |
|------|------|--------|
| `modules/baseagent/drsaiagent.py` | `DrSaiAgent` | 基类：switch_model, close, save_state, load_state, lazy_init, _sanitize_api_messages |
| `modules/agents/skills_agent/drsai_cli_assistant.py` | `DrSaiCLIAssistant` | 状态持久化重写：save_state (L137), load_state (L152, restore_model 参数) |
| `modules/agents/skills_agent/drsai_assistant.py` | `DrSaiAssistant` | 桌面版主类：构造函数 (L351), run_stream (L1534) |

### 配置文件

| 文件 | 职责 |
|------|------|
| `config/model_defaults.py` | `DEFAULT_CONFIG_NAME`, `DEFAULT_LLM_MODE_CONFIG`（16个模型条目）, `ModelEntry`, `ReasoningConfig` |
| `config/defaults.py` | `DEFAULT_MODEL = DEFAULT_CONFIG_NAME`（从 model_defaults.py 导入） |

### 前端核心文件

| 文件 | 职责 | 关键行 |
|------|------|--------|
| `apps/desktop/shared/renderer/src/App.tsx` | 模型选择 UI + configureAgentModel | L2125 (handleChatModelSelect), L2167 (configureAgentModel) |
| `apps/desktop/shared/renderer/src/components/ChatWorkspace.tsx` | 聊天界面 + model 传递 | L1999, L2044 (model: selectedModelName) |
| `apps/desktop/shared/renderer/src/adapters/useDesktopChatAdapter.ts` | model + reasoning_effort 发送 | L730 (model), L738 (metadata) |

---

## 附录：Agent 生命周期时序图

```
App 启动
  │
  ├─ lifespan startup
  │    └─ ensure_desktop_runtime_config()
  │
  ├─ 用户选择模型
  │    └─ PUT /v1/config/agents/{id}/models → TOML 持久化
  │
  ├─ 用户发送消息
  │    └─ POST /v1/runs/{run_id}/execute
  │         └─ RuntimeAgentService.execute(model_override=alias)
  │              └─ DesktopAgentBackend._stream(model_alias=alias)
  │                   └─ DesktopAgentManager.run_stream()
  │                        ├─ get_or_create(alias)
  │                        │    ├─ [新建] create_agent(alias) → lazy_init() → load_state()
  │                        │    ├─ [复用] 直接返回缓存 Agent
  │                        │    └─ [重建] create_agent(alias) → load_state() → close(previous)
  │                        │
  │                        ├─ agent._runtime_workspace_path = work_dir
  │                        ├─ agent.run_stream(task) → 流式事件
  │                        └─ finally: _save_state() → Thread.state (压缩 BLOB)
  │
  ├─ 用户修改工具/技能/知识库
  │    └─ evict_user(user_id) → 清除所有缓存 Agent → close()
  │
  └─ App 关闭
       └─ lifespan shutdown
            ├─ backend.close() (取消 cancellation tokens)
            └─ agent_manager.close() (逐个 agent.close())
```

---

> **报告完成**。本文档覆盖了桌面版 DrSaiAssistant 的完整生命周期管理和模型切换数据流分析。

