# DrSaiAssistant 工具体系架构分析报告

> **分析范围**: `run_drsai_agent_factory.py` (智能体实例化工厂) + `drsai_assistant.py` (DrSaiAssistant 智能体)
> **核心关注**: 从智能体自身管理工具 → 基础操作系统工具 → 外部自定义工具的完整工具生态
> **日期**: 2025-07-23

---

## 目录

1. [架构总览](#1-架构总览)
2. [工具分层体系](#2-工具分层体系)
3. [第一层：智能体管理工具 (Manager Tools)](#3-第一层智能体管理工具-manager-tools)
4. [第二层：基础操作系统工具 (Basic/OS Tools)](#4-第二层基础操作系统工具-basicos-tools)
5. [第三层：外部自定义工具 (External Custom Tools)](#5-第三层外部自定义工具-external-custom-tools)
6. [第四层：记忆与上下文工具 (Memory & Context Tools)](#6-第四层记忆与上下文工具-memory--context-tools)
7. [工具执行流程](#7-工具执行流程)
8. [动态更新与维护机制](#8-动态更新与维护机制)
9. [子智能体工具隔离](#9-子智能体工具隔离)
10. [外部使用方式总结](#10-外部使用方式总结)

---

## 1. 架构总览

DrSaiAssistant 的工具体系采用 **分层注册 + 动态合并 + 统一调度** 的架构模式。所有工具最终汇聚到一个统一的工具列表，在 LLM 调用时合并传递给模型。

```
┌──────────────────────────────────────────────────────────────────┐
│                     DrSaiAssistant 工具生态                      │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────┐  ┌───────────┐ │
│  │ 管理工具     │  │ OS 基础工具  │  │ MCP 工具  │  │ 记忆工具   │ │
│  │ (ToolSchema)│  │(FunctionTool)│  │(MCP Adapter)│ │(Context)  │ │
│  ├─────────────┤  ├─────────────┤  ├──────────┤  ├───────────┤ │
│  │• Skill      │  │• read   │  │• mcp-std │  │• memory    │ │
│  │• Delegate   │  │• write  │  │• mcp-sse │  │• retrieve  │ │
│  │• TodoWrite  │  │• edit   │  │          │  │• summry    │ │
│  │• UpdateUser │  │• grep   │  │          │  │• read_idx  │ │
│  │• SchedTask  │  │• exec   │  │          │  │            │ │
│  │  Manager    │  │• glob   │  │          │  │            │ │
│  │             │  │• exec_bg│  │          │  │            │ │
│  │             │  │• run_ps...  │  │          │  │            │ │
│  └──────┬──────┘  └──────┬──────┘  └────┬─────┘  └─────┬─────┘ │
│         │                │              │              │        │
│         ▼                ▼              ▼              ▼        │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │           all_tools = workbench.list_tools()              │   │
│  │               + handoff_tools                              │   │
│  │               + manager_tools (ToolSchema)                │   │
│  └──────────────────────────────────┬───────────────────────┘   │
│                                     ▼                           │
│                        LLM (ChatCompletionClient)              │
└──────────────────────────────────────────────────────────────────┘
```

### 关键设计原则

| 原则 | 说明 |
|------|------|
| **分层注册** | 不同来源的工具在不同初始化阶段注册，各司其职 |
| **动态合并** | 工具列表在运行时合并，支持热更新（文件变更触发重新加载） |
| **统一调度** | 所有工具通过统一的 `_process_model_result` 分发执行 |
| **权限隔离** | 子智能体场景下通过 allowlist/blocklist 进行工具过滤 |
| **安全优先** | 危险命令拦截、工作空间限制、危险命令审批机制 |

---

## 2. 工具分层体系

DrSaiAssistant 的工具按注册来源和执行方式分为四大层：

| 层级 | 工具类别 | 注册时机 | 执行方式 | 数据结构 |
|------|----------|----------|----------|----------|
| **L1** | 管理工具 | `__init__` + 启动检查 | 专用 handler（不走 workbench） | `ToolSchema` (仅 schema) |
| **L2** | OS 基础工具 | `__init__` (via `get_operator_funcs`) | `workbench.call_tool()` | `FunctionTool` (func + schema) |
| **L3** | 外部工具 | `update_user_tools()` + 工厂传入 | MCP adapter / 闭包函数 | `FunctionTool` / MCP Adapter |
| **L4** | 记忆工具 | `_register_context_tools()` | `workbench.call_tool()` | `FunctionTool` |

### 工具列表合并公式

```python
# 在 on_messages_stream 中（drsai_assistant.py:1285-1290）
manager_tools = (
    self._update_user_config_tools   # [UpdateUserConfig]
    + self._agent_skills_tools       # [Skill]
    + self._subagent_tools           # [Delegate]
    + self._todo_tools                # [TodoWrite]
    + self._scheduled_task_tools      # [ScheduledTaskManager]
)

# workbench._tools 包含:
#   self._tools (OS基础工具 + 记忆工具 + 外部MCP工具)
#   + elevated_tools (Skill 提升的工具)

# 最终传给 LLM:
all_tools = (await workbench.list_tools()) + handoff_tools + manager_tools
```

---

## 3. 第一层：智能体管理工具 (Manager Tools)

管理工具是 DrSaiAssistant 自身的行为控制工具，它们**不通过 workbench 执行**，而是在 `_process_model_result` 中通过 `if/elif` 分支专门处理。

### 3.1 工具清单

| 工具名 | 来源 | 功能 | Schema 定义位置 |
|--------|------|------|----------------|
| `UpdateUserConfig` | `UserProfileManager.get_user_config_tool()` | 更新用户名、智能体昵称、是否规划前询问 | `user_profile_manager.py:359` |
| `Skill` | `get_agent_skills_tool()` | 加载技能知识，注入到对话上下文 | `get_managers_tools.py:11` |
| `Delegate` | `get_subagent_tools()` | 将子任务委托给专门的子智能体 | `get_managers_tools.py:53` |
| `TodoWrite` | `get_todo_manager_tool()` | 创建/更新任务进度列表 | `get_managers_tools.py:37` |
| `ScheduledTaskManager` | `get_scheduled_task_tool()` | 管理定时任务（创建/查询/删除/启停） | `get_scheduled_task_tools.py:14` |

### 3.2 注册方式

管理工具使用 **`ToolSchema`**（纯 schema，不含执行函数），因为它们有专用的执行路径：

```python
# drsai_assistant.py:354, 478-506
self._update_user_config_tools = [self._user_profile_manager.get_user_config_tool()]
self._agent_skills_tools = []                    # 延迟加载
self._subagent_tools = []                         # 延迟加载
self._todo_tools = [get_todo_manager_tool()]      # 直接注册
self._scheduled_task_tools = []                   # 延迟加载，set_task_manager() 时激活
```

### 3.3 专用执行路径

在 `_process_model_result` 中，管理工具通过 `tool_name` 匹配进入专用分支：

```python
# drsai_assistant.py:2129-2483 (简化)
if tool_name == "Skill":
    skill_content = skills_loader.run_skill(arguments["skill"])
    self._elevate_tools_for_skill(required_tools, ...)
elif tool_name == "TodoWrite":
    self._todo_manager.update(arguments["items"])
elif tool_name == "Delegate":
    async for message in self._execute_subagent(...):
elif tool_name == "UpdateUserConfig":
    self._user_profile_manager.update_user_config(**arguments)
elif tool_name == "ScheduledTaskManager":
    # create/list/get/delete/toggle/get_results/get_outputs/read_output
else:
    # 普通工具走 workbench.call_tool()
```

### 3.4 管理工具的动态激活

| 工具 | 激活条件 | 代码位置 |
|------|----------|----------|
| `Skill` | `_run_startup_checks()` 检测到 skills 目录变化 → `update_user_skills()` | `drsai_assistant.py:966-988` |
| `Delegate` | `_run_startup_checks()` 检测到 SUBAGENT_CONFIG.json 变化 → `update_user_subagents()` | `drsai_assistant.py:1108-1122` |
| `ScheduledTaskManager` | `set_task_manager()` 被外部调用时 | `drsai_assistant.py:675` |
| `UpdateUserConfig` | `__init__` 时直接注册 | `drsai_assistant.py:354` |
| `TodoWrite` | `__init__` 时直接注册 | `drsai_assistant.py:500` |

---

## 4. 第二层：基础操作系统工具 (Basic/OS Tools)

### 4.1 工具来源：`get_operator_funcs()`

所有 OS 基础工具由 `get_operator_funcs()` 工厂函数生成（`operater_funs.py:188`），返回一组**闭包函数**列表，每个函数都绑定到特定的 `work_dir`、`thread_id` 和安全策略。

```python
# drsai_assistant.py:417-437
self._all_basic_funcs: List[Callable] = get_operator_funcs(
    work_dir,
    thread_id=self._thread_id,
    only_in_workspace=self._only_in_workspace,
    extra_dirs=self._extra_work_dirs,
    is_powershell=self._is_powershell,
    allolow_dangrous_cmd=allolow_dangrous_cmd,
    storage_dir=storage_dir,
)

self._all_basic_tools: List[FunctionTool] = [
    FunctionTool(func, description=func.__doc__)
    for func in self._all_basic_funcs
    if func.__name__ not in _TOGGLE_FUNC_NAMES
]
```

### 4.2 OS 工具清单

| 工具名 | 功能 | 安全特性 |
|--------|------|----------|
| `read` | 读取文件内容（支持行偏移） | 路径检查 |
| `write` | 写入文件 | 路径检查 |
| `edit` | 精确替换文件内容 | 路径检查 |
| `grep` | 正则搜索文件内容 | 路径检查 |
| `glob` | 文件模式匹配 | 路径检查 |
| `exec` | 执行 shell 命令（同步等待） | 危险命令拦截 + 脚本执行检测 |
| `exec_background` | 后台执行 shell 命令 | 同上，异步返回 task_id |
| `task_get` | 查询后台任务状态 | - |
| `task_list` | 列出所有后台任务 | - |
| `task_kill` | 终止后台任务 | - |
| `exec` | 执行 PowerShell 命令 | 同 exec（Windows 环境） |
| `task_get` | 查询 PS 任务状态 | - |
| `task_list` | 列出 PS 任务 | - |
| `task_kill` | 终止 PS 任务 | - |

### 4.3 安全机制

#### 4.3.1 工作空间限制 (Workspace Restriction)

```python
# operater_funs.py:267-280
def safe_path(p: str) -> Path:
    """所有文件操作工具都经过此检查"""
    path = Path(p)
    if _only_in_workspace[0]:
        if not any(path.resolve().is_relative_to(d) for d in ALLOWED_DIRS):
            raise PermissionError(f"Path {path} is outside allowed directories")
    return path
```

- `ALLOWED_DIRS = [WORKDIR] + [extra_dirs]` — 工具仅能访问白名单目录
- 可通过 `set_workspace_restriction(enabled)` 运行时切换（不暴露为 LLM 工具）

#### 4.3.2 危险命令拦截 (Dangerous Command Block)

```python
# operater_funs.py:1-82
_DANGEROUS_PATTERNS = [
    r'\bsudo\b', r'\brm\s+-[a-zA-Z]*r[a-zA-Z]*f\s+/',
    r'\bdd\b.+\bof=/dev\b', r'\bmkfs\b', ...
]
_SCRIPT_EXEC_PATTERNS = [
    r'\bpython[3]?\s+(?!-)[^\s;|&><]+\.py\b',
    r'\bbash\s+(?!-)\S+', ...
]
```

- `_dangerous_allowed[0]` 控制：`False` 时拦截危险命令 + 脚本执行；`True` 时仅跳过 `_DANGEROUS_PATTERNS`
- **审批机制**：`_request_dangerous_approval()` 通过 TUI gateway 向用户请求一次性审批
- 可通过 `set_dangerous_allowed(enabled)` 运行时切换

#### 4.3.3 PowerShell 检测

```python
# operater_funs.py:113-141
def _detect_powershell() -> Optional[str]:
    # 优先检测 pwsh (PowerShell Core)，回退到 Windows PowerShell
    pwsh_path = shutil.which("pwsh")
    if pwsh_path: return pwsh_path
    if platform.system() == "Windows":
        return shutil.which("powershell.exe")
    return None
```

### 4.4 权限分级机制 (Skill-Scoped Tool Elevation)

```python
# drsai_assistant.py:423-437
# allolow_basic_tools=None: 管理员模式（全部工具可见）
# allolow_basic_tools=["read"]: 用户模式（仅只读工具可见，Skill 可提升更多）

if allolow_basic_tools is None:
    self._default_visible_tools = list(self._all_basic_tools)
else:
    self._default_visible_tools = [
        t for t in self._all_basic_tools if t.name in allolow_basic_tools
    ]
```

**Skill 工具提升机制**：当 Skill 的 `SKILL.md` 中声明 `required_tools` 时，被声明的工具临时加入可见列表：

```python
# drsai_assistant.py:1222-1245
def _elevate_tools_for_skill(self, required_tools: list, skill_name: str = ""):
    if self._allolow_basic_tools_config is None: return  # 管理员模式无需提升
    for tool in self._all_basic_tools:
        if tool.name in required_tools and tool.name not in self._elevated_tool_names:
            self._elevated_tools.append(tool)
            self._tools.append(tool)
            if self._workbench._tools is not self._tools:
                self._workbench._tools.append(tool)

# 每轮对话开始时清除提升的工具
def _clear_elevated_tools(self):
    # 从 self._tools 和 self._workbench._tools 中移除
    self._elevated_tools.clear()
    self._elevated_tool_names.clear()
```

---

## 5. 第三层：外部自定义工具 (External Custom Tools)

外部工具通过三种途径注入：**MCP 协议工具**、**工厂传入的 extra_tools**、**GFS 工具集**。

### 5.1 MCP 工具 (TOOLS_CONFIG.json 驱动)

用户通过 `TOOLS_CONFIG.json` 文件配置 MCP 工具，支持两种类型：

```json
[
  {
    "type": "mcp-std",
    "config": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
    }
  },
  {
    "type": "mcp-sse",
    "config": {
      "url": "http://localhost:3000/sse",
      "headers": {"Authorization": "Bearer xxx"},
      "timeout": 20.0,
      "sse_read_timeout": 300.0
    }
  },
  {
    "type": "local-function",
    "config": "def my_func(x): return x * 2  # 通过 exec 执行"
  }
]
```

加载逻辑在 `update_user_tools()` 中（`drsai_assistant.py:992-1059`）：

```python
for tool in tools_config:
    tool_type = tool.get("type")
    if tool_type == "mcp-std":
        std_mcp_tools = await mcp_server_tools(StdioServerParams(
            command=config["command"], args=config["args"]
        ))
        user_mcp_tools.extend(std_mcp_tools)
    elif tool_type == "mcp-sse":
        sse_mcp_tools = await mcp_server_tools(SseServerParams(
            url=config["url"], headers=config.get("headers"),
            timeout=config.get("timeout", 20.0),
            sse_read_timeout=config.get("sse_read_timeout", 300.0)
        ))
        user_mcp_tools.extend(sse_mcp_tools)
    else:
        # local-function: 不注册为正式工具，而是拼成提示词
        # 告诉 LLM 可以通过 exec 执行
        user_local_tools.append(str(config) + "\n")

# 最终合并到 workbench
self._workbench._tools = self._tools + user_mcp_tools
```

**关键设计**：`local-function` 类型的工具不注册为正式 FunctionTool，而是以提示词形式注入，引导 LLM 通过 `exec` 执行。

### 5.2 工厂传入的 extra_tools

`run_drsai_agent_factory.py` 的 `create_agent()` 支持通过 `extra_tools` 参数直接传入工具函数列表：

```python
# run_drsai_agent_factory.py:825-829
gfs_tools = _build_gfs_tools(user_id, cli_cfg=cli_cfg)
if gfs_tools:
    final_tools = list(extra_tools or []) + gfs_tools
else:
    final_tools = list(extra_tools) if extra_tools else None

# 最终传给 DrSaiAssistant.__init__ 的 tools 参数
return assistant_cls(
    ...
    tools=final_tools,  # ← 外部工具函数列表
    ...
)
```

这些工具通过 `DrSaiAgent.__init__` 的 `tools` 参数注册，会被包装为 `FunctionTool` 并加入 `self._tools` 和 `self._workbench`。

### 5.3 GFS 工具集 (GFS File Storage Tools)

GFS 工具是一个完整的外部工具集示例，通过工厂函数生成：

```python
# run_drsai_agent_factory.py:_build_gfs_tools()
from drsai.modules.managers.gfs import make_gfs_tools_personal
from drsai.modules.managers.gfs.admin_client import GfsCredential
from drsai.modules.managers.gfs.user_client import GfsUserClient

cred = GfsCredential(access_key=ak, secret_key=sk, bucket=bucket, ...)
client = GfsUserClient(cred)
tools = make_gfs_tools_personal(client=client)
```

GFS 工具集包含 12 个工具（`agent_tools.py:_build_tools()`）：

| 工具名 | 功能 |
|--------|------|
| `gfs_ls` | 列出 bucket 内文件/目录 |
| `gfs_stat` | 查看文件元信息 |
| `gfs_read` | 读取文本文件 |
| `gfs_write` | 写入文本文件 |
| `gfs_upload` | 上传本地文件 |
| `gfs_download` | 下载文件到本地 |
| `gfs_delete` | 删除文件 |
| `gfs_share_url` | 生成临时预签名下载 URL |

**GFS 工具的特殊性**：
- 配置来源唯一：仅从 `cli_cfg["gfs"]` 读取（不读环境变量）
- 凭证不完整时静默跳过，不影响 agent 创建
- 使用闭包绑定 client，每个工具调用时延迟获取 client

### 5.4 外部工具注册方式总结

```
外部工具注入路径:

(1) TOOLS_CONFIG.json (MCP) ──→ update_user_tools() ──→ _workbench._tools
                                                                    ↓
(2) extra_tools (工厂参数)  ──→ DrSaiAgent.__init__   ──→ self._tools + _workbench
                                                                    ↓
(3) GFS tools (cli_cfg)    ──→ _build_gfs_tools()    ──→ 同 (2)
                                                                    ↓
(4) local-function (JSON)  ──→ 提示词注入 (不走工具注册)   → system_prompt
```

---

## 6. 第四层：记忆与上下文工具 (Memory & Context Tools)

### 6.1 记忆工具注册

在 `_register_context_tools()` 中根据上下文类型注册（`drsai_assistant.py:586-664`）：

```python
def _register_context_tools(self) -> None:
    funcs = []
    if hasattr(self._model_context, 'retrieve_from_memory'):
        funcs.append(self._model_context.retrieve_from_memory)
    if hasattr(self._model_context, 'summry_conversation_to_memory'):
        funcs.append(self._model_context.summry_conversation_to_memory)
    if hasattr(self._model_context, 'read_session_memory_by_index'):
        funcs.append(self._model_context.read_session_memory_by_index)
    
    for func in funcs:
        if func and callable(func):
            tool_name = getattr(func, '__name__', '')
            if tool_name not in existing_names:
                self._tools.append(FunctionTool(func, description=func.__doc__))
```

### 6.2 Curated Memory 工具

```python
# drsai_assistant.py:649-664
def memory(action: str, content: str = "", old_text: str = "") -> str:
    """Persistent curated memory across sessions."""
    if action == "add":
        return _json.dumps(store.add_entry(content))
    if action == "replace":
        return _json.dumps(store.replace_by_text(old_text, content))
    if action == "remove":
        return _json.dumps(store.remove_by_text(old_text))
    if action == "read":
        return _json.dumps({"entries": store.list_entries(), ...})
```

### 6.3 上下文类型决定工具集

| `context_type` | 实现类 | 记忆工具 |
|----------------|--------|----------|
| `"sqlite"` | `DrSaiSQLiteChatCompletionContext` | `retrieve_from_memory`, `summry_conversation_to_memory`, `read_session_memory_by_index` |
| `"ragflow"` | `DrSaiChatCompletionContext` | 同上（走 RAGFlow API） |
| `"buffered"` | `BufferedChatCompletionContext` | 无记忆工具 |
| `"custom"` | 用户传入 | 取决于实现 |

---

## 7. 工具执行流程

### 7.1 消息循环中的工具调度

```
用户消息 → on_messages_stream()
                    │
                    ▼
            ┌───────────────────┐
            │ _clear_elevated_  │  ← 清除上轮 Skill 提升的工具
            │ tools()           │
            └───────┬───────────┘
                    │
                    ▼
            ┌───────────────────┐
            │ _run_startup_     │  ← 检测配置文件变更，热更新工具
            │ checks()          │
            └───────┬───────────┘
                    │
                    ▼
            ┌───────────────────┐
            │ 合并 manager_tools │  ← Skill + Delegate + TodoWrite +
            │                   │     UpdateUserConfig + ScheduledTaskManager
            └───────┬───────────┘
                    │
                    ▼
            ┌───────────────────┐
            │ _call_llm()       │  ← workbench.list_tools() + handoff_tools
            │                   │     + manager_tools → LLM
            └───────┬───────────┘
                    │
                    ▼
            ┌───────────────────┐
            │ _process_model_   │  ← LLM 返回的 tool_calls
            │ result()          │
            └───────┬───────────┘
                    │
         ┌──────────┼──────────┐──────────┐──────────┐──────────┐
         ▼          ▼          ▼          ▼          ▼          ▼
    ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
    │ Skill  │ │TodoWrite│ │Delegate│ │Update  │ │Sched   │ │Normal  │
    │        │ │        │ │        │ │UserCfg │ │TaskMgr │ │(wb)    │
    └────────┘ └────────┘ └────────┘ └────────┘ └────────┘ └────────┘
         │          │          │          │          │          │
         ▼          │          ▼          ▼          ▼          ▼
    elevate_tools  │    _execute_   update_      8种      workbench
    + skill content│    subagent()  user_config operations  call_tool()
                    │
                    ▼
              TodoManager
              .update()
```

### 7.2 正常工具执行 (via Workbench)

```python
# drsaiagent.py:1057-1107
async def _execute_tool_call(tool_call, workbench, handoff_tools, ...):
    arguments = json.loads(tool_call.arguments)
    
    # 先检查 handoff tools
    for handoff_tool in handoff_tools:
        if tool_call.name == handoff_tool.name:
            result = await handoff_tool.run_json(arguments, cancellation_token)
            return (tool_call, FunctionExecutionResult(...))
    
    # 通过 workbench 执行
    result = await workbench.call_tool(
        name=tool_call.name,
        arguments=arguments,
        cancellation_token=cancellation_token,
    )
    return (tool_call, FunctionExecutionResult(content=result.to_text(), ...))
```

### 7.3 Workbench 的 call_tool 实现

```python
# _drsai_static_workbench.py (DrSaiStaticWorkbench)
async def call_tool(self, name, arguments, cancellation_token):
    tool = next((tool for tool in self._tools if tool.name == name), None)
    if tool is None:
        return ToolResult(name=name, result=[TextResultContent(...)], is_error=True)
    
    result = await tool.run_json(arguments, cancellation_token)
    
    # MCP adapter 特殊处理
    if isinstance(tool, (StdioMcpToolAdapter, SseMcpToolAdapter)):
        result_str = '\n'.join([str(r.text) for r in result])
    else:
        result_str = tool.return_value_as_string(result)
    
    return ToolResult(name=tool.name, result=[TextResultContent(content=result_str)])
```

---

## 8. 动态更新与维护机制

### 8.1 文件变更检测机制

DrSaiAssistant 使用 **mtime 缓存** 实现配置文件的热更新检测：

```python
# drsai_assistant.py:696-708
def _file_changed(self, path: Path) -> bool:
    try:
        mtime = path.stat().st_mtime
    except OSError:
        return True
    key = str(path)
    if self._config_mtimes.get(key) != mtime:
        self._config_mtimes[key] = mtime
        return True
    return False
```

### 8.2 启动检查流程 (`_run_startup_checks`)

每次 `on_messages_stream` 调用时触发（除非 `_skip_startup_checks=True`）：

```python
# drsai_assistant.py:719-813
async def _run_startup_checks(self) -> List[str]:
    warnings = []
    
    # 1. 检测 TOOLS_CONFIG.json 变化 → 重新加载 MCP 工具
    tools_changed = self._file_changed(self._user_profile_manager.tools_config_path)
    if tools_changed:
        tools_prompt, tool_errors = await self.update_user_tools()
        self._cached_tools_prompt = tools_prompt
    
    # 2. 检测 AGENTS.md 变化 → 更新系统提示词
    if tools_changed or self._file_changed(self._user_profile_manager.agents_md):
        self.update_system_prompt(additional_prompt=self._cached_tools_prompt)
    
    # 3. 检测 skills 目录变化 → 重新加载技能
    skills_changed = self._file_changed(self._user_profile_manager.skills_dir)
    if skills_changed or self._cached_skills_loader is None:
        skills_loader, skill_error = self.update_user_skills()
        self._cached_skills_loader = skills_loader
    
    # 4. 检测 SUBAGENT_CONFIG.json 变化 → 重新加载子智能体配置
    if self._file_changed(self._user_profile_manager.subagent_config_path):
        subagent_error = self.update_user_subagents()
    
    return warnings
```

### 8.3 各类工具的动态更新路径

| 工具类别 | 触发条件 | 更新方法 | 更新内容 |
|----------|----------|----------|----------|
| MCP 工具 | `TOOLS_CONFIG.json` mtime 变化 | `update_user_tools()` | 重新连接 MCP server，刷新 `_workbench._tools` |
| 技能工具 | `skills/` 目录 mtime 变化 | `update_user_skills()` | 重新加载 SKILL.md，更新 `_agent_skills_tools` |
| 子智能体 | `SUBAGENT_CONFIG.json` mtime 变化 | `update_user_subagents()` | 重新解析 JSON，更新 `_user_sub_agents` 和 `_subagent_tools` |
| 用户配置 | `UpdateUserConfig` 工具调用 | `update_user_config()` | 更新 `USER_CONFIG.json` + 同步 `AGENTS.md` |
| 系统提示词 | 上述任意变化 | `update_system_prompt()` | 重建 `_system_messages` |
| OS 基础工具 | 初始化时固定 | 不支持运行时更新 | 闭包绑定，不可热替换 |

### 8.4 技能同步机制

系统技能目录 → 用户技能目录的同步：

```python
# drsai_assistant.py:907-945
def update_user_skills(self):
    # 1. 比较系统 skills 目录和用户 skills 目录
    for system_skills_dir in self._skills_dir:
        for skill_folder in system_path.iterdir():
            # mtime 比较：系统版本更新时复制到用户目录
            if system_mtime > user_mtime:
                shutil.rmtree(user_skill_folder)
                shutil.copytree(skill_folder, user_skill_folder)
    
    # 2. 从用户目录加载
    skills_loader = SkillLoader(skills_dir=str(user_skills_dir))
    self._agent_skills_tools = [get_agent_skills_tool(
        descriptions=skills_loader.get_descriptions()
    )]
```

---

## 9. 子智能体工具隔离

### 9.1 工具过滤策略

子智能体通过 `_get_tools_for_subagent()` 获取过滤后的工具集：

```python
# drsai_assistant.py:2575-2604
def _get_tools_for_subagent(self, sub_agent_name: str) -> list:
    cfg = self._user_sub_agents.get(sub_agent_name, {})
    agent_type = cfg.get("type", "DrSaiAgent")
    
    # 根据类型确定 blocklist
    if agent_type in ("explore", "plan"):
        disallowed = _READONLY_DISALLOWED_TOOLS  # 包含所有写/执行工具
    else:
        disallowed = _DEFAULT_DISALLOWED_FOR_SUBAGENTS  # Delegate + SchedTask + UpdateConfig
    
    # 合并用户自定义 blocklist
    disallowed |= set(cfg.get("disallowed_tools", []))
    
    # leaf 角色总是禁止 Delegate
    if cfg.get("role", "leaf") == "leaf":
        disallowed.add("Delegate")
    
    # 应用 allowlist
    allowed = cfg.get("tools", "*")
    if allowed == "*":
        tools = list(self._tools)
    else:
        tools = [t for t in self._workbench._tools if t.name in allowed]
    
    return [t for t in tools if t.name not in disallowed]
```

### 9.2 内置子智能体定义

```python
# drsai_assistant.py:135-180
BUILTIN_SUBAGENTS = {
    "explore": {
        "type": "DrSaiAgent",
        "tools": ["read", "glob", "grep"],  # 白名单
        "disallowed_tools": ["Delegate", "ScheduledTaskManager", "UpdateUserConfig"],
        "role": "leaf",
    },
    "general": {
        "type": "DrSaiAgent",
        "tools": "*",  # 全部工具
        "disallowed_tools": ["Delegate", "ScheduledTaskManager", "UpdateUserConfig"],
        "role": "leaf",
    },
}
```

### 9.3 子智能体隔离保证

创建本地子智能体时（`_create_local_subagent`，`drsai_assistant.py:2630-2720`）：

| 隔离维度 | 措施 |
|----------|------|
| 上下文隔离 | 独立 `thread_id`（`{parent}/sub/{name}/{uuid}`），独立 SQLite context |
| 工具隔离 | `allolow_basic_tools=[]` — 不加载 OS 工具函数 |
| 管理工具清除 | `_todo_tools=[]`, `_update_user_config_tools=[]`, `_scheduled_task_tools=[]`, `_subagent_tools=[]`, `_agent_skills_tools=[]` |
| 配置检查跳过 | `_skip_startup_checks=True` |
| 递归委托阻止 | `_user_sub_agents={}` — 无子智能体配置 |
| 深度限制 | `_delegate_depth = parent._delegate_depth + 1`，超限抛 `DelegateDepthExceededError` |

---

## 10. 外部使用方式总结

### 10.1 实例化入口：`create_agent()`

```python
# run_drsai_agent_factory.py:create_agent()
assistant = create_agent(
    api_key="...",           # LLM API key
    thread_id="xxx",         # 会话 ID
    user_id="xxx",           # 用户 ID
    db_manager=db,           # 数据库管理器
    cli_cfg=cli_config,      # CLI 配置（含 gfs, plan_mode 等）
    assistant_cls=DrSaiCLIAssistant,  # 智能体类
    work_dir="/path/to/cwd", # 工作目录
    sub_agent_config={...},  # 自定义子智能体
    extra_tools=[func1, func2],  # 额外工具函数
    enable_security=False,   # 安全模式
)
```

### 10.2 外部动态维护工具的方式

#### 方式一：通过 TOOLS_CONFIG.json（用户级，热更新）

```json
// ~/.drsai/workspace/runs/<user_id>/configs/TOOLS_CONFIG.json
[
  {
    "type": "mcp-std",
    "config": {"command": "npx", "args": ["-y", "@mcp/server-xxx"]}
  }
]
```

- **适用场景**：用户自行添加 MCP 工具服务
- **热更新**：文件 mtime 变化后自动重新加载
- **局限**：仅支持 MCP 协议工具；local-function 类型仅作为提示词注入

#### 方式二：通过 extra_tools 参数（工厂级，实例化时）

```python
def my_custom_tool(param: str) -> str:
    """My custom tool description."""
    ...

assistant = create_agent(extra_tools=[my_custom_tool])
```

- **适用场景**：程序化注入自定义工具函数
- **局限**：实例化后不可变更（除非直接操作 `_tools` 列表）

#### 方式三：通过 GFS 配置（CLI 配置级）

```json
// cli_config.json
{
  "gfs": {
    "enabled": true,
    "access_key": "...",
    "secret_key": "...",
    "bucket": "...",
    "s3_endpoint": "https://fgws3-gfs.ihep.ac.cn"
  }
}
```

- **适用场景**：文件存储管理工具集
- **特性**：凭证不完整时静默跳过

#### 方式四：通过 SUBAGENT_CONFIG.json（用户级，热更新）

```json
// ~/.drsai/workspace/runs/<user_id>/configs/SUBAGENT_CONFIG.json
{
  "MyCustomAgent": {
    "type": "DrSaiAgent",
    "description": "Custom agent for ...",
    "prompt": "You are ...",
    "tools": ["read", "exec"],
    "disallowed_tools": ["Delegate"],
    "max_turns": 50
  }
}
```

- **适用场景**：定义可委托的子智能体
- **热更新**：文件 mtime 变化后自动重新加载

#### 方式五：通过 Skills 目录（用户级，热更新）

```
~/.drsai/workspace/runs/<user_id>/configs/skills/
├── my-skill/
│   └── SKILL.md    # YAML frontmatter + markdown instructions
```

SKILL.md 格式：
```yaml
---
name: my-skill
description: When to use this skill
required_tools: ["exec", "write"]  # 需要提升的 OS 工具
---

# Skill Instructions
...
```

- **适用场景**：注入领域知识 + 工具提升
- **热更新**：目录 mtime 变化后自动同步 + 重新加载
- **特性**：`required_tools` 可在受限模式下临时提升工具权限

#### 方式六：通过 set_task_manager()（运行时注入）

```python
# 外部代码创建 task_manager 后注入
from drsai.modules.agents.skills_agent.managers import ScheduledTaskManager
task_manager = ScheduledTaskManager(db_manager=db, ...)
assistant.set_task_manager(task_manager)
# 此时 ScheduledTaskManager 工具自动激活
```

### 10.3 运行时工具状态切换

| 方法 | 用途 | 可用性 |
|------|------|--------|
| `set_workspace_restriction(enabled)` | 开关工作空间限制 | CLI 命令 `/workspace on\|off` |
| `set_dangerous_allowed(enabled)` | 开关危险命令拦截 | CLI 命令 `/dangerous on\|off` |
| `switch_model(new_client)` | 切换 LLM 模型 | CLI 命令 `/model` |
| `inject_system_prompt(prefix, suffix)` | 注入额外提示词 | CLI 命令 `/inject`, `/plan_mode` |

---

## 附录 A：配置文件目录结构

```
~/.drsai/workspace/runs/<user_id>/
├── configs/
│   ├── AGENTS.md              # 统一系统提示词（System + User Profile + Skills + Tools）
│   ├── MEMORY.md              # 智能体笔记（CuratedMemoryStore 管理，≤2200 chars）
│   ├── TOOLS_CONFIG.json     # MCP 工具配置（数组，支持 mcp-std/mcp-sse/local-function）
│   ├── SUBAGENT_CONFIG.json   # 子智能体配置（对象，key=智能体名）
│   ├── USER_CONFIG.json       # 结构化用户配置（user_name, agent_name, ask_before_plan）
│   ├── THREAD_CONFIG.json     # 会话级配置（如默认子智能体）
│   ├── SCHEDULED_TASKS.json   # 定时任务配置
│   └── skills/                # 用户技能目录
│       └── <skill-name>/
│           └── SKILL.md
├── tmp/                       # 代码生成/测试临时目录
└── downloads/                 # 下载文件目录
```

## 附录 B：工具体系类关系图

```
                    ┌──────────────────┐
                    │  BaseTool[Any,T] │  (autogen_core)
                    │  (abstract)       │
                    └────────┬─────────┘
                             │
                    ┌────────┴─────────┐
                    │  FunctionTool     │  func + schema → LLM 可调用
                    └────────┬─────────┘
                             │
            ┌────────────────┼────────────────┐
            │                │                │
   ┌────────┴───┐  ┌────────┴───┐   ┌────────┴──────┐
   │ OS Tools    │  │ MCP Tools  │   │ Memory Tools  │
   │ (闭包函数)   │  │ (Adapter)  │   │ (Context方法) │
   └────────────┘  └────────────┘   └───────────────┘

                    ┌──────────────────┐
                    │  ToolSchema      │  (纯 schema，无执行函数)
                    │  name + desc +   │
                    │  parameters      │
                    └────────┬─────────┘
                             │
            ┌────────────────┼────────────────────┐
            │                │                    │
   ┌────────┴───┐  ┌────────┴───┐   ┌────────────┴───┐
   │ Skill      │  │ Delegate   │   │ TodoWrite /    │
   │ UpdateUser │  │            │   │ SchedTaskMgr   │
   └────────────┘  └────────────┘   └────────────────┘

                    ┌──────────────────┐
                    │  Workbench       │  (autogen_core)
                    │  _tools: List    │
                    │  call_tool()    │
                    │  list_tools()   │
                    └──────────────────┘
                    DrSaiStaticWorkbench (子类，增强 MCP 支持)
```

## 附录 C：关键代码位置索引

| 功能 | 文件 | 行号 |
|------|------|------|
| 智能体实例化工厂 | `backend/run_drsai_agent_factory.py` | `create_agent()` ~L825 |
| DrSaiAssistant `__init__` | `modules/agents/skills_agent/drsai_assistant.py` | ~L225 |
| OS 工具生成 | `modules/agents/skills_agent/managers/operater_funs.py` | `get_operator_funcs()` L188 |
| MCP 工具加载 | `drsai_assistant.py` | `update_user_tools()` L992 |
| 技能工具加载 | `drsai_assistant.py` | `update_user_skills()` L907 |
| 子智能体配置加载 | `drsai_assistant.py` | `update_user_subagents()` L1080 |
| 管理工具 Schema | `managers/get_managers_tools.py` | 全文件 |
| 定时任务工具 Schema | `managers/get_scheduled_task_tools.py` | `get_scheduled_task_tool()` L14 |
| 用户配置工具 Schema | `managers/user_profile_manager.py` | `get_user_config_tool()` L359 |
| 工具执行分发 | `drsai_assistant.py` | `_process_model_result()` L1984 |
| Workbench 执行 | `modules/components/tool/_drsai_static_workbench.py` | `call_tool()` |
| 子智能体工具过滤 | `drsai_assistant.py` | `_get_tools_for_subagent()` L2575 |
| Skill 工具提升 | `drsai_assistant.py` | `_elevate_tools_for_skill()` L1222 |
| 启动检查/热更新 | `drsai_assistant.py` | `_run_startup_checks()` L719 |
| GFS 工具生成 | `modules/managers/gfs/agent_tools.py` | `make_gfs_tools_personal()` L86 |
| 技能加载器 | `modules/components/skills/skill_loader.py` | `SkillLoader` L10 |
| 危险命令模式 | `managers/operater_funs.py` | `_DANGEROUS_PATTERNS` L4 |
