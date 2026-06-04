# DrSai 子智能体系统设计文档

> 代码文件：`python/packages/drsai/src/drsai/modules/agents/skills_agent/drsai_assistant.py`
> 总行数：~3100 行

---

## 一、总体架构

```
┌──────────────────────────────────────────────────────────────────┐
│                    DrSaiAssistant (主智能体)                       │
│                                                                  │
│  on_messages_stream():           L979                             │
│    ├─ _run_startup_checks()      L595  (子智能体跳过: L1010)       │
│    ├─ 默认子智能体模式检查        L1051                            │
│    │   └─ _handle_default_subagent_mode()  L1398                  │
│    │       └─ _execute_subagent()  L2426  ← 统一入口               │
│    │                                                              │
│    └─ while turn < max_turn:                                      │
│        ├─ _call_llm()            L1324                             │
│        └─ _process_model_result() L1608                            │
│            ├─ Pre-scan: 收集 Delegate 调用  L1651-1660             │
│            ├─ ≥2 Delegate → _execute_subagents_parallel() L2504    │
│            └─ 单 Delegate → _execute_subagent()  L1823-1845        │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│                   子智能体基础设施 (L2173-2586)                     │
│                                                                  │
│  _execute_subagent()          L2426  ← 统一入口                    │
│    ├── _check_delegate_depth() L2184  (深度检查)                   │
│    ├── _create_local_subagent() L2241 (本地) 或                    │
│    │   _create_remote_subagent() L2328 (远程)                      │
│    ├── _build_subagent_messages() L2359 (Hermes风格: 无父历史)     │
│    ├── subagent.on_messages_stream() (执行)                        │
│    └── finally: _safe_close_subagent() L2395 (安全关闭+清理)       │
│                                                                  │
│  _execute_subagents_parallel() L2504 ← 并行执行 (asyncio.Queue)    │
│    ├── asyncio.Semaphore(max_concurrent) 并发控制                  │
│    ├── 每子智能体独立 asyncio.Task                                │
│    └── asyncio.Queue 合并输出流                                    │
└──────────────────────────────────────────────────────────────────┘
```

---

## 二、内置子智能体定义

**文件位置**：`L104-155`

### 2.1 explore（只读代码探索器）

```python
"explore": {
    "name": "explore",
    "type": "DrSaiAgent",
    "description": "...",
    "tools": ["run_read", "run_glob", "run_grep"],
    "disallowed_tools": ["Delegate", "ScheduledTaskManager", "UpdateUserConfig"],
    "mode": "multi",
    "max_turns": 50,
    "timeout": 300,
    "role": "leaf",
}
```

### 2.2 general（通用子智能体）

```python
"general": {
    "name": "general",
    "type": "DrSaiAgent",
    "tools": "*",     # 全部工具
    "disallowed_tools": ["Delegate", "ScheduledTaskManager", "UpdateUserConfig"],
    "mode": "multi",
    "max_turns": 50,
    "timeout": 1200,
    "role": "leaf",
}
```

### 2.3 工具阻止列表

**文件位置**：`L157-170`

```python
# 所有子智能体默认阻止
_DEFAULT_DISALLOWED_FOR_SUBAGENTS = {
    "Delegate",              # 防止递归委托
    "ScheduledTaskManager",  # 防止定时任务副作用
    "UpdateUserConfig",      # 防止修改用户配置
}

# 只读子智能体额外阻止
_READONLY_DISALLOWED_TOOLS = _DEFAULT_DISALLOWED_FOR_SUBAGENTS | {
    "run_write", "run_edit", "run_bash", "run_bash_background",
}
```

---

## 三、触发方式（3 种）

### 方式 1：LLM 主动 Delegate（最核心）

**位置**：`_process_model_result()` L1608-1855

LLM 调用 `Delegate` 工具时：
- **单 Delegate** → `_execute_subagent()` (L1823-1845)
- **≥2 Delegate 同轮** → `_execute_subagents_parallel()` (L1662-1685)

```
用户: "帮我分析架构 + 修复bug"
  └─ LLM 推理: 两个独立任务
      ├─ Delegate(agent_type="explore", prompt="分析架构")
      └─ Delegate(agent_type="general", prompt="修复bug")
```

**Delegate 工具 Schema**：

| 参数 | 类型 | 说明 |
|------|------|------|
| `agent_type` | string | 子智能体类型 (explore/general/自定义) |
| `prompt` | string | 任务描述 |
| `context` | string | 背景信息（可选） |
| `mode` | string | "single" (单轮) / "multi" (多轮) |

### 方式 2：默认子智能体模式

**位置**：`on_messages_stream()` L1049-1068, `_handle_default_subagent_mode()` L1398-1435

用户设置默认子智能体后，所有消息直接路由：

```
用户: /agent explore
      → 当前 session 进入 explore 模式
用户: "找一下用了 deprecated API 的地方"
      → 直接路由给 explore 子智能体
```

### 方式 3：旧版 get_sub_agent_instance（遗留）

**位置**：`L2595-2671`

旧版 API，创建 `DrSaiAgent` 而非 `DrSaiAssistant`。保留用于兼容，但不再推荐使用。

---

## 四、工具过滤机制

**位置**：`_get_tools_for_subagent()` L2193-2226

### 过滤流程

```
1. 确定阻止列表
   ├─ explore/plan → _READONLY_DISALLOWED_TOOLS
   └─ 其他        → _DEFAULT_DISALLOWED_FOR_SUBAGENTS
   
2. 合并用户自定义阻止
   disallowed |= set(cfg.get("disallowed_tools", []))

3. leaf 角色强制阻止 Delegate
   if role == "leaf": disallowed.add("Delegate")

4. 应用允许列表
   ├─ tools="*" → 父智能体全部工具
   └─ tools=["run_read", ...] → 仅指定工具

5. 返回 tools \ disallowed
```

### 子智能体创建时的额外隔离

**位置**：`_create_local_subagent()` L2282-2325

```python
# ① 阻止 DrSaiAssistant.__init__ 额外注入 get_operator_funcs 工具
allolow_basic_tools=[]                     # L2305

# ② 清零所有 manager_tools（防止 _run_startup_checks 重新注入）
subagent._todo_tools = []                  # L2318
subagent._update_user_config_tools = []    # L2319
subagent._scheduled_task_tools = []        # L2320
subagent._subagent_tools = []              # L2321
subagent._agent_skills_tools = []          # L2322
subagent._user_sub_agents = {}             # L2323 (防 Delegate)

# ③ 跳过 _run_startup_checks（防 MCP/Delegate 重新注入）
subagent._skip_startup_checks = True       # L2315
```

---

## 五、上下文隔离策略

### 5.1 thread_id 隔离

**位置**：`_make_subagent_thread_id()` L2175-2181

```
格式: {parent_thread_id}/sub/{agent_name}/{6-char uuid}
示例: a1b2c3d4/sub/explore/x7k9p2
```

### 5.2 消息传递（Hermes 风格）

**位置**：`_build_subagent_messages()` L2359-2381

```python
# 只传递 task + context + work_dir
# 不传递父智能体对话历史
content = f"Your task:\n\n{prompt}"
if context:
    content = f"Background context:\n{context}\n\n{content}"
content += f"\n\nWork directory: {work_dir}"
```

### 5.3 model_client 深拷贝

**位置**：`_create_independent_model_client()` L2228-2239

```python
# dump_component → load_component 创建全新实例
# copy.deepcopy 确保 _model_info 不共享引用
model_config = self._model_client.dump_component()
independent = ChatCompletionClient.load_component(model_config)
independent._model_info = copy.deepcopy(self._model_client._model_info)
```

### 5.4 Context 策略

**位置**：`_create_local_subagent()` L2274-2280

| mode | context 类型 | DB 隔离 |
|------|-------------|---------|
| `"single"` | `BufferedChatCompletionContext(buffer_size=50)` | 纯内存，不写 DB |
| `"multi"` | `DrSaiSQLiteChatCompletionContext` | 共享 DB 连接，但独立 thread_id |

### 5.5 结果摘要化（Tagged Messages）

**位置**：`_tag_message()` L2382-2393

子智能体的消息被打上 `source="sub:{name}"` 标签，父智能体看到的是标记后的输出，不看到原始 tool_call 中间过程。

---

## 六、并行执行

**位置**：`_execute_subagents_parallel()` L2504-2584

### 架构

```
                    asyncio.Queue
                    ┌─────────┐
  Task(t1) ───────→ │  msg1   │──→ yield msg1
  Task(t2) ───────→ │  msg2   │──→ yield msg2
  Task(t3) ───────→ │  msg3   │──→ yield msg3
       ...           │  DONE   │──→ done_count++
       Semaphore(3)  └─────────┘
```

### 执行流程

```python
queue = asyncio.Queue()
semaphore = asyncio.Semaphore(max_concurrent)  # 并发上限

async def run_one(call_id, name, prompt, context, mode):
    async with semaphore:
        async for msg in self._execute_subagent(...):
            await queue.put((name, msg))
    await queue.put((None, _DONE))  # 完成信号

# 启动所有任务
tasks = [asyncio.create_task(run_one(...)) for _ in delegate_calls]

# 按到达顺序消费
while done_count < total:
    name, message = await queue.get()
    if message is _DONE:
        done_count += 1
    else:
        yield self._tag_message(message, name)
```

### 结果收集

每个子智能体完成后，结果存入 `subagent_results[name]`，最后以 `TextMessage(metadata={"subagent_result": name})` 格式 yield 给调用方，用于填充 `exec_results`。

---

## 七、清理机制

### 7.1 安全关闭

**位置**：`_safe_close_subagent()` L2395-2411

```python
async def _safe_close_subagent(subagent, name):
    await subagent.close()                    # 关闭 model_client HTTP session
    if cleanup and context_type == "sqlite":
        _delete_subagent_messages(thread_id)  # 清理 SQLite 消息
```

### 7.2 消息清理

**位置**：`_delete_subagent_messages()` L2413-2424

```python
# 通过 DatabaseManager.delete() 删除子智能体的 SessionMessage 行
self._db_manager.delete(
    model_class=SessionMessage,
    filters={"thread_id": thread_id},
)
```

### 7.3 超时控制

**位置**：`_execute_subagent()` L2475-2484

```python
timeout = cfg.get("timeout", self._subagent_timeout)  # 默认 600s
try:
    async with asyncio.timeout(timeout):
        ...
except asyncio.TimeoutError:
    yield TextMessage(content="⚠️ Subagent timed out...")
```

### 7.4 深度限制

**位置**：`_check_delegate_depth()` L2184-2191

```python
# 子智能体不允许再次委托
if self._delegate_depth >= self._max_delegate_depth:  # 默认 max=1
    raise DelegateDepthExceededError(...)
```

---

## 八、关键数据流

```
用户消息
  │
  ▼
on_messages_stream()                          L979
  ├── 是默认子智能体模式？
  │   └── YES → _handle_default_subagent_mode()  L1398
  │              └── _execute_subagent()          L2426
  │
  └── NO  → _call_llm()                          L1324
              └── _process_model_result()         L1608
                    │
                    ├── 发现 ≥2 Delegate 调用
                    │   └── _execute_subagents_parallel()  L2504
                    │         ├── asyncio.create_task(run_one) × N
                    │         └── asyncio.Queue → 合并输出
                    │
                    └── 发现 1 个 Delegate 调用
                        └── _execute_subagent()           L2426
                              │
                              ├── _check_delegate_depth()  L2184
                              ├── _create_local_subagent() L2241
                              │     ├── _get_tools_for_subagent() L2193
                              │     ├── _create_independent_model_client() L2228
                              │     ├── DrSaiAssistant(tools=..., allolow_basic_tools=[])
                              │     ├── 清零 manager_tools (_todo_tools 等)
                              │     └── _skip_startup_checks = True
                              │
                              ├── _build_subagent_messages() L2359
                              ├── subagent.on_messages_stream()  → 迭代输出
                              └── finally: _safe_close_subagent() L2395
                                    ├── subagent.close()
                                    └── _delete_subagent_messages() L2413
```

---

## 九、完整代码位置索引

### 9.1 定义区

| 代码 | 行号 | 说明 |
|------|------|------|
| `BUILTIN_SUBAGENTS` | L105-155 | 内置子智能体定义 (explore, general) |
| `_DEFAULT_DISALLOWED_FOR_SUBAGENTS` | L158-163 | 所有子智能体默认阻止列表 |
| `_READONLY_DISALLOWED_TOOLS` | L164-170 | 只读子智能体额外阻止列表 |
| `DelegateDepthExceededError` | L172 | 深度超限异常 |
| `DrSaiAssistantConfig` | L177 | 配置模型 |
| `DrSaiAssistant` | L194 | 主类 |
| `__init__` 参数 `allolow_basic_tools` | L244 | 控制基础工具注入 |
| `__init__` 参数 `sub_agent_config` | L250 | 用户自定义子智能体配置 |
| `__init__` 参数 `only_system_message` | L241 | 跳过 UserProfileManager |
| `__init__` 参数 `max_turn_count` | L247 | 最大轮次 |
| `__init__` 参数 `allolow_dangrous_cmd` | L243 | 危险命令开关 |

### 9.2 初始化逻辑

| 代码 | 行号 | 说明 |
|------|------|------|
| `self._user_sub_agents.update(BUILTIN_SUBAGENTS)` | L406-407 | 合并内置 + 用户配置 |
| `self._subagent_tools = []` | L408 | 子智能体工具注册 |
| `self._delegate_depth = 0` | L411 | 委托深度 |
| `self._max_delegate_depth = 1` | L412 | 最大深度（禁止嵌套委托） |
| `self._subagent_timeout = 600` | L413 | 默认超时 |
| `self._cleanup_subagent_messages = True` | L414 | 是否清理 DB 消息 |
| `self._todo_tools = [get_todo_manager_tool()]` | L418 | TodoWrite 工具 |
| `self._config_mtimes = {}` | L439 | 配置文件 mtime 缓存 |
| `self._skip_startup_checks = False` | L442 | 跳过 _run_startup_checks 标志 |

### 9.3 用户配置管理

| 代码 | 行号 | 说明 |
|------|------|------|
| `get_subagent_descriptions()` | L880 | 生成子智能体描述文本 |
| `update_user_subagents()` | L887 | 重新加载子智能体配置 |
| `_run_startup_checks()` | L595 | 启动时检查配置变更 |
| L657-672 | 子智能体配置重载触发 `update_user_subagents()` |

### 9.4 核心子智能体基础设施（L2173-2586）

| 代码 | 行号 | 说明 |
|------|------|------|
| `# ── Subagent Infrastructure ──` | L2173 | 基础设施起点标记 |
| `_make_subagent_thread_id()` | L2175-2181 | 生成隔离 thread_id |
| `_check_delegate_depth()` | L2184-2191 | 深度超限检查 |
| `_get_tools_for_subagent()` | L2193-2226 | 工具过滤 (allowlist + blocklist) |
| `_create_independent_model_client()` | L2228-2239 | model_client 深拷贝 |
| `_create_local_subagent()` | L2241-2326 | 创建本地子智能体 |
| `_create_remote_subagent()` | L2328-2357 | 创建远程子智能体 |
| `_build_subagent_messages()` | L2359-2381 | 构建任务消息 (Hermes 风格) |
| `_tag_message()` | L2382-2393 | 标记子智能体来源 |
| `_safe_close_subagent()` | L2395-2411 | 安全关闭 + 可选清理 |
| `_delete_subagent_messages()` | L2413-2424 | 删除 SQLite 消息 |
| `_execute_subagent()` | L2426-2502 | 统一执行入口 |
| `_execute_subagents_parallel()` | L2504-2584 | 并行执行器 |
| `# ── End Subagent Infrastructure ──` | L2586 | 基础设施结束标记 |

### 9.5 Delegate 工具处理

| 代码 | 行号 | 说明 |
|------|------|------|
| Pre-scan: 收集 Delegate 调用 | L1651-1660 | 扫描 model_result 中的 Delegate |
| 并行路径: ≥2 Delegates | L1662-1705 | 调用 `_execute_subagents_parallel` |
| 单 Delegate 分支 | L1823-1845 | 调用 `_execute_subagent` |

### 9.6 默认子智能体模式

| 代码 | 行号 | 说明 |
|------|------|------|
| 检查默认子智能体 | L1051 | `get_default_subagent(thread_id)` |
| `_handle_default_subagent_mode()` | L1398-1435 | 路由消息到默认子智能体 |

### 9.7 旧版 API（遗留）

| 代码 | 行号 | 说明 |
|------|------|------|
| `get_sub_agent_instance()` | L2595-2671 | 创建 DrSaiAgent 子智能体 |
| `handle_subagent_repsonse()` | L2673+ | 处理旧版响应 |
| `get_tools_for_agent()` | L2588-2592 | 按 agent_type 过滤工具 |

### 9.8 Context 管理

| 代码 | 文件 | 说明 |
|------|------|------|
| `_create_context()` | drsai_assistant.py L441 | 创建 model context |
| `_register_context_tools()` | drsai_assistant.py L500 | 注册 context 工具 |
| `_get_messages_with_compression_notification()` | drsai_assistant.py L1275 | 消息获取 + 压缩通知 |
| `DrSaiSQLiteChatCompletionContext` | model_context/drsai_model_context.py L103 | SQLite 持久化 context |
| `DrSaiChatCompletionContext` | model_context/drsai_model_context.py L103 | RAGFlow 集成 context |
| `BufferedChatCompletionContext` | autogen_core | 纯内存 buffer context |

---

## 十、设计原则

### 输入精简（学 Hermes）
子智能体只收 `prompt + context + work_dir`，不灌父智能体对话历史。

### 类型化创建（学 Claude Code）
预置 `explore` / `general` 内置类型，支持用户扩展自定义类型。

### 结果摘要化
父智能体只看到标记后的 stream 输出，不被子智能体内部 tool_call 细节淹没。

### 独立 model_client
每个子智能体通过 `dump_component → load_component` 创建独立的 `ChatCompletionClient`，`close()` 互不干扰。

### 深度限制
`max_delegate_depth = 1`，子智能体不能再委托子智能体（除非显式设为 orchestrator）。

### 工具最小化
默认阻止 `Delegate` / `ScheduledTaskManager` / `UpdateUserConfig`，explore 额外阻止所有写操作工具。

### DB 隔离
共享 SQLite 连接，但通过独立 `thread_id` 隔离会话数据。single mode 直接用内存 buffer。

---

## 十一、已修复的关键 Bug

### Bug #1：DatabaseManager.get_session() 不存在
- **位置**：`_delete_subagent_messages()` L2407
- **现象**：`'DatabaseManager' object has no attribute 'get_session'`
- **修复**：改用 `self._db_manager.delete(model_class=SessionMessage, filters={"thread_id": thread_id})`

### Bug #2：model_client fallback 返回父 client
- **位置**：`_create_independent_model_client()` L2239-2240
- **现象**：subagent.close() 关闭父智能体的 HTTP session
- **修复**：移除 try/except fallback，clone 失败直接 raise

### Bug #3：_model_info 共享引用
- **位置**：`_create_independent_model_client()` L2236, `get_sub_agent_instance()` L2606, `__init__` L371
- **修复**：`independent._model_info = copy.deepcopy(parent._model_info)`

### Bug #4：子智能体 tools 重复
- **位置**：`_create_local_subagent()` L2282-2325
- **根因**：`DrSaiAssistant.__init__` 在 super().__init__ 之后通过 `get_operator_funcs()` 追加了全部基础工具
- **修复**：传 `allolow_basic_tools=[]` + 清零 `manager_tools` + `_skip_startup_checks = True`

---

## 十二、Daemon 模式子智能体调用

> 核心文件：`python/packages/drsai/src/drsai/backend/daemon/`
> RPC 注册：`python/packages/drsai/src/drsai/backend/tui_gateway/handlers/daemon.py`

### 12.1 架构概览

Daemon 模式提供了一种**独立于 TUI 进程**的后台常驻子智能体服务。与第 3 节中的远程子智能体（`HepAIWorkerAgent`）不同，daemon 子智能体通过 **WebSocket JSON-RPC 协议**与本机 TUI/CLI 通信，TUI 退出后 daemon 继续运行。

```
┌─────────────────────────────────────────────────────────────────┐
│  TUI (drsai chat) 或 CLI (drsai daemon start)                   │
│                                                                 │
│  /daemons → cmd_daemons (slash.py)                              │
│  /agent   → cmd_agent   (slash.py)                              │
│                 │                                                │
│  subagent.invoke RPC (daemon.py handler)                        │
│                 │                                                │
│  ┌──────────────▼──────────────────────────────────────────────┐│
│  │  Daemon 进程 (独立 subprocess, 脱离终端)                     ││
│  │                                                              ││
│  │  pid_manager.start_daemon()                                  ││
│  │    ├─ 分配空闲端口 (42500-43000)                             ││
│  │    ├─ 生成 API Token                                         ││
│  │    ├─ subprocess.Popen(                                      ││
│  │    │     python -m drsai.backend.daemon,                     ││
│  │    │     start_new_session=True,  ← 脱离父进程组              ││
│  │    │     close_fds=True,                                      ││
│  │    │  )                                                      ││
│  │    └─ 等待就绪 (_wait_for_ready, timeout=15s)                ││
│  │                                                              ││
│  │  daemon_server.py (FastAPI + WebSocket)                      ││
│  │    ├─ /api/health, /api/info, /api/sessions                  ││
│  │    └─ /ws?token=xxx                                          ││
│  │         ├─ session.create → 新建 Agent 会话                  ││
│  │         ├─ prompt.submit  → 提交任务                         ││
│  │         └─ 事件流: message.delta / message.complete / error  ││
│  └──────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

### 12.2 子智能体调用流程（subagent.invoke）

**文件位置**：`daemon.py` → `@method("subagent.invoke")` L138

```
TUI/CLI 调用 subagent.invoke({ daemon_name, message, caller_session_id })
  │
  ├─ 1. 读取 daemon state（PID 文件 + JSON 状态文件）
  │     pid_manager.read_state(daemon_name)
  │
  ├─ 2. 建立 WebSocket 连接
  │     ws://127.0.0.1:{port}/ws?token={api_token}
  │
  ├─ 3. 创建会话
  │     → session.create RPC
  │     ← session_id
  │
  ├─ 4. 提交提示词
  │     → prompt.submit RPC
  │
  ├─ 5. 流式接收响应（在后台线程中运行）
  │     while True:
  │       frame = ws.recv()
  │       switch frame.type:
  │         "message.delta"    → emit subagent.thinking (实时 chunk)
  │         "message.complete" → emit subagent.complete (最终结果)
  │         "error"            → emit subagent.complete (错误)
  │
  └─ 6. 关闭连接
        ws.close()
```

### 12.3 远程子智能体 vs Daemon 子智能体对比

| 特性 | 远程子智能体 (HepAIWorkerAgent) | Daemon 子智能体 |
|------|-------------------------------|----------------|
| **通信协议** | HTTP REST API (`POST /worker/unified_gate/`) | WebSocket JSON-RPC |
| **发现机制** | `get_worker_sync_functions()` 获取远程函数列表 | 直接创建 session + 提交 prompt |
| **生命周期** | 每次调用创建新 Agent 实例，用完 close | 独立进程常驻，跨会话复用 |
| **配置位置** | `SUBAGENT_CONFIG.json` → `model_remote_configs` | `pid_manager` 状态文件 |
| **适用场景** | 调用外部部署的 AI 模型/智能体服务 | 本机后台常驻 Agent，TUI 退出后继续运行 |
| **流式输出** | 通过 `a_chat_completions(stream=True)` | 通过 WebSocket 事件流 |
| **启动方式** | 自动（发送消息时触发） | 手动 `drsai daemon start --name <name>` |

### 12.4 SUBAGENT_CONFIG.json 配置规范

**文件位置**：`~/.drsai/workspace/runs/{user_id}/configs/SUBAGENT_CONFIG.json`

```json
{
  "RongZai_Agent": {
    "type": "HepAIWorkerAgent",
    "description": "蓉仔——粉末中子衍射精修助手",
    "model_remote_configs": {
      "name": "RongZai_Agent",
      "url": "https://aiapi.ihep.ac.cn/apiv2"
    }
  }
}
```

> **⚠️ 命名约束**：`SUBAGENT_CONFIG.json` 的 key 和 `model_remote_configs.name` 必须使用
> `[a-zA-Z0-9_-]` 字符集。如果 key 中包含空格（如 `"RongZai Agent"`），`_tag_message()` 
> 方法会将空格替换为下划线生成 `source` 标记（见 `drsai_assistant.py` L2618），但
> `/agent` 命令也会因空格导致匹配失败。**推荐统一使用下划线**（如 `"RongZai_Agent"`）。

---

## 十三、/daemons 斜杠命令

**文件位置**：`slash.py` → `cmd_daemons()` L893, `SLASH_HANDLERS` L1058

### 13.1 命令用法

| 命令 | 功能 |
|------|------|
| `/daemons` | 列出所有 daemon（● 运行中 / ○ 已停止） |
| `/daemons <name>` | 查看单个 daemon 详情（状态、PID、端口、运行时间） |
| `/daemons logs <name>` | 查看 daemon 日志尾行（最近 20 行） |
| `/dm` | `/daemons` 的短别名 |

### 13.2 底层 RPC 方法

`/daemons` 命令直接调用 `pid_manager` 函数，同时 daemon 模块也注册了独立的 RPC 方法（`daemon.py`），供非 TUI 客户端调用：

| RPC 方法 | 说明 |
|----------|------|
| `daemon.list` | 列出所有 daemon + HTTP 获取 session_count |
| `daemon.start` | 启动 daemon |
| `daemon.stop` | 停止 daemon |
| `daemon.status` | 获取单个 daemon 状态 |
| `daemon.logs` | 读取 daemon 日志 |
| `subagent.invoke` | 向 daemon 提交子任务（WebSocket 流式） |

### 13.3 CLI 命令对照

| TUI 命令 | CLI 等价命令 |
|----------|-------------|
| `/daemons` | `drsai daemon status` |
| `/daemons <name>` | `drsai daemon status --name <name>` |
| `/daemons logs <name>` | `drsai daemon logs --name <name>` |
| 无直接 TUI 命令 | `drsai daemon start --name <name>` |
| 无直接 TUI 命令 | `drsai daemon stop --name <name>` |

### 13.4 已知问题：/daemons 曾缺失

**时间**：2026-06-03 前
**现象**：CLI `drsai daemon start` 提示用户"在 TUI 中使用 /daemons 命令查看和管理此 daemon"，但 `/daemons` 从未在 `SLASH_HANDLERS` 中注册，TUI 返回 `unknown slash command: daemons`。
**修复**：新增 `cmd_daemons()` 函数并注册到 `SLASH_HANDLERS`，同时添加短别名 `/dm`。

### 13.5 /daemon-run 命令

| 命令 | 功能 |
|------|------|
| `/daemon-run <name> <task>` | 向 daemon 提交一次性任务 |
| `/dr <name> <task>` | `/daemon-run` 的短别名 |

`/daemon-run` 内部调用 `subagent.invoke` RPC，通过 WebSocket 向 daemon 提交任务并流式返回结果。

---

## 十四、Daemon 与 Delegate/Agent 集成

> 实现时间：2026-06-03

### 14.1 概述

运行中的 daemon 进程现在可以作为标准的子智能体，通过两种方式被调用：

- **方式 1**：LLM 主动 Delegate — daemon 出现在 Delegate 工具的 agent_type 列表中
- **方式 2**：默认子智能体模式 — 通过 `/agent daemon:<name>` 设置

### 14.2 动态注入机制

在 `update_user_subagents()` 中（`drsai_assistant.py`），加载 `SUBAGENT_CONFIG.json` 后，自动扫描运行中的 daemon 并注入为子智能体：

```
list_daemons() → for each alive daemon:
    _user_sub_agents[f"daemon:{name}"] = {
        "type": "DaemonAgent",
        "description": "后台常驻 Daemon [name] — pid=...",
        "daemon_name": name,
        "daemon_ws_port": port,
        "daemon_api_token": token,
        ...
    }
```

### 14.3 执行流程

```
/agent daemon:default  或  LLM Delegate→{agent_type:"daemon:default"}
  │
  ▼
_execute_subagent(sub_agent_name="daemon:default")
  │
  ├── agent_type = "DaemonAgent"
  ├── _create_daemon_subagent("daemon:default")
  │     └── DaemonSubagent(ws_port, api_token, daemon_name)
  │
  ├── _build_subagent_messages(prompt, work_dir, context)
  │
  └── subagent.on_messages_stream(messages, ct)
        │
        │  [后台线程]                  [异步主循环]
        │  WebSocket connect ──→      asyncio.Queue
        │  session.create    ──→      │
        │  prompt.submit     ──→      │
        │  message.delta ────→ queue ─→ yield TextMessage(chunk)
        │  message.complete ─→ queue ─→ yield Response(...)
        │
        └── close()
```

### 14.4 DaemonSubagent 类

**文件**：`python/packages/drsai/src/drsai/modules/agents/skills_agent/daemon_subagent.py`

轻量包装器，实现 `on_messages_stream()` 和 `close()` 接口。使用 `threading.Thread` + `asyncio.Queue` 桥接同步 WebSocket 和异步生成器。

### 14.5 使用示例

```bash
# 1. 启动 daemon（shell）
drsai daemon start --name default

# 2. 在 TUI 中查看
/daemons                    # → ● daemon:default  pid=...  port=42500

# 3. 设置为默认子智能体
/agent daemon:default       # → Default subagent set

# 4. 之后所有消息自动路由到 daemon
帮我分析项目结构

# 或通过 LLM Delegate（在普通模式下）
"Please delegate to daemon:default to analyze the codebase"
```

### 14.6 关键文件

| 文件 | 说明 |
|------|------|
| `daemon_subagent.py` | DaemonSubagent 类（WebSocket→asyncio.Queue 桥接） |
| `drsai_assistant.py` L1010 | `update_user_subagents()` 动态注入 daemon |
| `drsai_assistant.py` L2595 | `_create_daemon_subagent()` |
| `drsai_assistant.py` L2758 | `_execute_subagent()` 中 DaemonAgent 分支 |
| `slash.py` L893 | `cmd_daemons()` 和 `cmd_daemon_run()` |
| `slash.py` L1058 | SLASH_HANDLERS 注册 |
