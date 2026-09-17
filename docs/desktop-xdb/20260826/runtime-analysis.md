# `backend/runtime` 在 Desktop 前端与智能体之间的作用分析

> **路径**: `cores/python/packages/drsai/src/drsai/backend/runtime/`  
> **文档版本**: 2026-08-26  
> **核心问题**: `runtime` 在前端 Desktop 与后端智能体 (`DrSaiAssistant`) 之间起什么作用？

---

## 目录

1. [一句话总结](#1-一句话总结)
2. [runtime 的角色定位](#2-runtime-的角色定位)
3. [runtime 子系统全景图](#3-runtime-子系统全景图)
4. [核心子系统详解](#4-核心子系统详解)
5. [数据流：Desktop → runtime → Agent](#5-数据流desktop--runtime--agent)
6. [关键设计：Agent Kernel 双层架构](#6-关键设计agent-kernel-双层架构)
7. [附录：文件索引](#7-附录文件索引)

---

## 1. 一句话总结

> **`runtime` 是 Desktop 前端和智能体之间的"执行运行时"** — 它不负责消息路由（那是 `gateway` / `tui_gateway` 的职责），而是负责**智能体执行过程中的所有"非 LLM"逻辑**：安全边界、权限审批、工具注册、沙箱隔离、会话状态持久化、实验回放、Web 搜索、移动端适配等。它是一个 **横切关注点容器 (cross-cutting concerns container)**。

---

## 2. runtime 的角色定位

### 在架构中的位置

```
Desktop 前端 (Electron / TUI)
       ↓ HTTP / JSON-RPC
  网关层 (gateway / tui_gateway)    ← 消息路由、协议转换
       ↓
  ╔══════════════════════════════╗
  ║  backend/runtime              ║  ← 本文档焦点
  ║  • 安全边界 / 权限 / 沙箱     ║
  ║  • Agent Kernel (执行引擎)    ║
  ║  • 状态持久化 / 会话管理       ║
  ║  • 工具注册 / Web 搜索         ║
  ║  • 实验回放 / 回归测试         ║
  ╚══════════════════════════════╝
       ↓
  DrSaiAssistant (智能体)
  • run_stream() → on_messages_stream() → _call_llm()
```

### runtime 的三大职责

| 职责 | 说明 | 关键模块 |
|------|------|---------|
| **执行引擎** | `DrSaiAgentKernel` — 不直接调用 LLM, 而是编排"模型请求→工具调用→审批→产物"的完整循环 | `mobile_core/engine.py`, `desktop_agent_kernel_adapter.py` |
| **安全与权限** | 控制智能体能做什么、不能做什么 — 文件系统隔离、命令审批、网络限制 | `security.py`, `security_boundary/`, `permission_modes/` |
| **状态与可观测性** | 会话持久化、对话日志、实验回放、指标收集 | `engine.py`, `journal.py`, `observability.py`, `experiments.py` |

---

## 3. runtime 子系统全景图

`runtime/` 包含 **120+ 个 Python 文件**, 分为以下子系统:

```
backend/runtime/
├── 📦 核心引擎层
│   ├── agent_kernel.py              ← Kernel 契约（提示、工具策略、能力清单）
│   ├── agent_kernel_factory.py       ← Kernel 工厂（唯一构造入口）
│   ├── mobile_core/                  ← DrSaiAgentKernel 实现（跨平台执行引擎）
│   │   ├── engine.py                ← 核心循环：start_run→model→tool→approval→complete
│   │   ├── protocol.py              ← RuntimeEnvelope 消息协议
│   │   ├── context.py               ← 上下文组装（记忆、引用、工具注册）
│   │   ├── plan_state.py            ← 任务规划状态
│   │   ├── subagents.py             ← 子智能体调度策略
│   │   ├── ports.py                 ← 端口抽象（模型、工具、审批、产物）
│   │   └── factory.py                ← 移动端 Kernel 工厂
│   │
├── 📱 Desktop 适配层
│   ├── desktop_agent_kernel_adapter.py   ← Kernel ↔ DrSaiAssistant 桥接（关键!）
│   ├── desktop_kernel_coordinator.py     ← Desktop 协调器（模型/工具/审批回调）
│   ├── desktop_kernel_run_stream.py      ← 流式运行包装器
│   ├── desktop_kernel_events.py          ← 事件翻译
│   ├── desktop_autogen_ports.py           ← autogen 端口适配
│   ├── desktop_manager_ports.py           ← AgentManager 端口
│   ├── desktop_oaep_bridge.py             ← OAEP 资源桥接
│   ├── desktop_security_binding.py        ← 安全执行绑定
│   └── mobile_adapter.py                  ← 移动端适配器
│
├── 🔒 安全边界层
│   ├── security.py                   ← 基础安全（审批注册、审计日志、工作区FS）
│   ├── security_boundary/            ← 高级安全边界（30+ 文件）
│   │   ├── models.py                ← ActionProposal, ResolvedCapabilityProfile
│   │   ├── policy.py                ← 安全策略
│   │   ├── sandbox.py               ← 沙箱执行
│   │   ├── filesystem.py            ← 文件系统隔离
│   │   ├── filesystem_execution.py  ← 授权文件系统执行
│   │   ├── network.py               ← 网络隔离
│   │   ├── isolated_effect_execution.py ← 隔离效果执行
│   │   ├── isolated_effect_worker.py ← 隔离工作进程
│   │   ├── isolated_worker_artifact.py ← 隔离产物解析
│   │   ├── isolation_leases.py      ← 隔离租约
│   │   ├── hard_deny.py             ← 硬拒绝策略
│   │   ├── grants.py                ← 授权授予
│   │   ├── audit.py                 ← 审计
│   │   ├── credentials.py           ← 凭证管理
│   │   ├── effects.py               ← 效果系统
│   │   ├── storage.py                ← 安全存储
│   │   ├── tombstones.py            ← 墓碑（已删除资源标记）
│   │   ├── static_scan.py           ← 静态扫描
│   │   ├── metrics.py                ← 安全指标
│   │   ├── approval_slo_monitor.py  ← 审批 SLA 监控
│   │   ├── approval_slo_policy.py   ← 审批 SLA 策略
│   │   ├── security_metrics_exporter.py   ← 指标导出
│   │   ├── security_metrics_named_pipe.py ← 命名管道指标
│   │   ├── security_observability_*.py    ← 可观测性（部署/工厂/发布）
│   │   ├── windows_*.py             ← Windows 特定安全（30+ 文件）
│   │   │   ├── windows_backend.py
│   │   │   ├── windows_token.py     ← 限制令牌
│   │   │   ├── windows_job.py       ← Job 对象
│   │   │   ├── windows_appcontainer.py ← AppContainer 隔离
│   │   │   ├── windows_isolated_session.py ← 隔离会话
│   │   │   ├── windows_acl_projection.py ← ACL 投影
│   │   │   ├── windows_installer_*.py ← 安装器系列
│   │   │   ├── windows_service_bootstrap_envelope.py
│   │   │   └── ...
│   │   └── __init__.py
│   │
├── 🎛️ 权限模式层
│   ├── permission_modes/             ← 权限模式管理
│   │   ├── profiles.py              ← 权限配置文件
│   │   ├── resolver.py              ← 权限解析器
│   │   ├── service.py               ← 权限模式服务
│   │   ├── evaluation.py            ← 权限评估
│   │   ├── inheritance.py           ← 子权限继承
│   │   ├── auto_reviewer.py         ← 自动审核
│   │   ├── auto_review_coordinator.py ← 自动审核协调
│   │   ├── config_migration.py      ← 配置迁移
│   │   ├── kill_switch.py           ← 紧急停止
│   │   └── __init__.py
│   │
├── 🔐 授权层
│   ├── authorization/               ← 授权服务
│   │   ├── approval_service.py      ← 审批服务
│   │   ├── grant_service.py         ← 授予服务
│   │   ├── policy_decision_service.py ← 策略决策
│   │   ├── reviewers.py             ← 审核者
│   │   ├── run_coordinator.py      ← 运行协调
│   │   └── migration.py             ← 迁移
│   │
├── 📊 引擎状态层
│   ├── engine.py                    ← RuntimeEngine（SQLite 状态管理、会话、通道）
│   ├── journal.py                   ← 对话日志
│   ├── history.py                   ← 历史记录
│   ├── conversation.py              ← 对话管理
│   ├── observability.py             ← 可观测性
│   ├── operation_metrics.py         ← 操作指标
│   ├── real_model_statistics.py     ← 模型统计
│   ├── normalized_events.py         ← 标准化事件
│   ├── normalized_writer.py         ← 标准化写入
│   ├── sqlite_connection.py         ← SQLite 连接管理
│   └── migrations.py                ← 数据库迁移
│
├── 🌐 资源层
│   ├── resource_host.py             ← 租户文件系统资源主机
│   ├── artifact_host.py             ← 产物主机
│   ├── artifacts.py                 ← 产物管理
│   ├── adoptions.py                 ← 工作树/产物采纳
│   ├── oaep.py                      ← OAEP 事件投影/快照
│   ├── evidence.py                  ← 证据系统
│   ├── grounded.py                  ← 接地回答（基于证据）
│   ├── input_resources.py           ← 输入资源
│   ├── image_operations.py          ← 图像操作
│   └── capabilities/               ← 能力配置
│       ├── configuration.py
│       └── __init__.py
│
├── 🧪 实验与回放层
│   ├── experiments.py               ← 实验存储
│   ├── experiment_export.py         ← 实验导出
│   ├── experiment_overrides.py      ← 实验覆盖
│   ├── replay_planner.py            ← 回放规划
│   ├── replay_execution.py          ← 回放执行
│   ├── replay_policy.py             ← 回放策略
│   ├── run_comparison.py            ← 运行比较
│   ├── run_comparison_evaluation.py ← 比较评估
│   ├── run_inspection.py            ← 运行检查
│   ├── tool_selection_eval.py      ← 工具选择评估
│   └── goals.py                     ← 目标标准化
│
├── 🌍 Web 搜索层
│   ├── web_search/                  ← Web 搜索子系统
│   │   ├── contracts.py            ← 搜索契约
│   │   ├── tool.py                 ← 搜索工具
│   │   ├── tavily.py               ← Tavily 搜索
│   │   ├── hai_tavily.py           ← HepAI Tavily
│   │   ├── bing_playwright.py      ← Bing Playwright
│   │   ├── provider_policy.py      ← 提供商策略
│   │   ├── url_safety.py           ← URL 安全
│   │   ├── errors.py               ← 错误定义
│   │   └── __init__.py
│   │
├── 🖥️ 终端层
│   ├── terminal/                    ← 终端模拟
│   │   ├── screen.py               ← 屏幕模拟
│   │   ├── state_service.py        ← 状态服务
│   │   └── __init__.py
│   │
├── 📱 移动端核心
│   ├── mobile_core/                 ← 跨平台 Agent Kernel 实现
│   │   ├── engine.py               ← DrSaiAgentKernel（核心循环）
│   │   ├── protocol.py             ← RuntimeEnvelope 消息协议
│   │   ├── context.py              ← 上下文组装
│   │   ├── plan_state.py           ← 规划状态
│   │   ├── subagents.py            ← 子智能体调度
│   │   ├── ports.py                ← 端口抽象
│   │   ├── factory.py              ← 工厂
│   │   └── __init__.py
│   │
├── 🔄 其他
│   ├── work_scheduler.py            ← 有界工作调度器
│   ├── sandbox_compute.py          ← 声明式沙箱计算
│   ├── turn_coordinator.py        ← 轮次协调
│   ├── adapter_registry.py         ← 适配器注册
│   ├── agent.py                    ← Agent 定义
│   ├── agent_bindings.py           ← Agent 绑定
│   ├── registry.py                 ← 注册表
│   ├── error_contract.py           ← 错误契约
│   └── __init__.py
```

---

## 4. 核心子系统详解

### 4.1 Agent Kernel — 智能体执行引擎

**这是 runtime 最核心的子系统**, 它决定了智能体如何执行 LLM 循环。

#### 架构：Host-Driven 模式

```
┌─────────────────────────────────────────────────────────────┐
│  Host (DrSaiAssistant)                                      │
│  • 拥有 model_client, tools, workbench                     │
│  • 拥有 skills, memory, subagents                          │
│  • run_stream() 入口                                       │
└──────────────────┬──────────────────────────────────────────┘
                   │ run_agent_through_kernel()
                   ↓
┌─────────────────────────────────────────────────────────────┐
│  Kernel (DrSaiAgentKernel)                                  │
│  • 不直接调用 LLM — 编排决策循环                            │
│  • 决定：何时调用模型？调用哪些工具？需要审批？             │
│  • 通过 RuntimeEnvelope 消息协议与 Host 通信                │
│                                                             │
│  循环:                                                      │
│  1. START_RUN → 组装上下文 → MODEL_REQUEST                  │
│  2. MODEL_CHUNK → 流式输出                                  │
│  3. MODEL_COMPLETED → 检查工具调用                          │
│  4. TOOL_CALL_REQUEST → Host 执行工具 → TOOL_RESULT         │
│  5. APPROVAL_REQUEST → Host 请求审批 → APPROVAL_RESULT      │
│  6. ARTIFACT_REQUEST → Host 处理产物 → ARTIFACT_RESULT      │
│  7. 循环 2-6 直到 COMPLETED/CANCELLED/FAILED                │
└─────────────────────────────────────────────────────────────┘
```

#### 关键文件

**`agent_kernel.py`** — Kernel 契约（不含 I/O 逻辑）
- `AgentRunConfig` (第 1668 行) — 运行配置数据类
- `DEFAULT_SYSTEM_PROMPT` — 默认系统提示词
- `resolve_tool_decision()` (第 490 行) — 工具决策解析
- `build_tool_choice_policy()` (第 538 行) — 工具选择策略
- `normalize_tool_loop_policy()` (第 646 行) — 工具循环策略
- `validate_tool_call_batch()` (第 681 行) — 批量工具验证
- `classify_tool_error()` (第 727 行) — 工具错误分类
- `build_citation_evidence()` (第 900 行) — 引用证据构建
- `desktop_production_parity_manifest()` (第 1057 行) — 生产一致性清单
- `freeze_model_tool_snapshot()` (第 1494 行) — 模型工具快照
- `build_execution_tool_registry()` (第 1547 行) — 执行工具注册

**`agent_kernel_factory.py`** — 唯一构造入口
```python
def create_agent_kernel(*, surface: str) -> DrSaiAgentKernel:
    """surface: 'android' | 'desktop' | 'tui' | 'test'"""
    kernel = DrSaiAgentKernel()
    identity = agent_kernel_identity(surface=identity_surface)
    return kernel
```

**`mobile_core/engine.py`** — Kernel 实现（"mobile_core" 是历史名称, 实为跨平台核心）
- `DrSaiAgentKernel` (第 267 行) — 核心类
- `handle(command: RuntimeEnvelope)` (第 285 行) — 消息分发入口
- `_start_run()` (第 308 行) — 启动运行
- `_resume_run()` (第 521 行) — 恢复运行
- `_model_chunk()` (第 702 行) — 处理模型流式输出
- `_model_completed()` (第 926 行) — 模型完成处理
- `_tool_result()` (第 1402 行) — 处理工具结果
- `_approval_result()` (第 1563 行) — 处理审批结果
- `_artifact_result()` (第 1590 行) — 处理产物结果
- `_start_subagents()` (第 1634 行) — 启动子智能体
- `_execute_core_tools()` (第 1760 行) — 执行核心工具
- `_subagent_completed()` (第 1836 行) — 子智能体完成
- `_cancel_run()` (第 1976 行) — 取消运行

**`mobile_core/protocol.py`** — 消息协议
```python
class MessageType(StrEnum):
    # Host → Kernel
    START_RUN, CANCEL_RUN, RESUME_RUN
    MODEL_CHUNK, MODEL_COMPLETED, MODEL_FAILED
    TOOL_RESULT, APPROVAL_RESULT, ARTIFACT_RESULT
    LIFECYCLE_CHANGED
    # Kernel → Host
    MODEL_REQUEST, TOOL_CALL_REQUEST
    APPROVAL_REQUEST, CHECKPOINT_REQUEST, ARTIFACT_REQUEST
    # 通用
    RUNTIME_EVENT

@dataclass(frozen=True)
class RuntimeEnvelope:
    message_type, request_id, run_id, session_id
    sequence, idempotency_key, payload, protocol_version
```

#### Desktop Kernel 适配器

**`desktop_agent_kernel_adapter.py`** — Kernel ↔ DrSaiAssistant 桥接

```python
async def run_agent_through_kernel(agent, *, task, cancellation_token, ...):
    """引导真实 Agent Host 通过 Kernel 决策循环"""
    
    # 1. 安全绑定验证
    security_binding = agent._runtime_security_execution_binding
    validate_desktop_security_execution_binding(...)
    
    # 2. 任务标准化
    normalized_task = normalize_desktop_kernel_task(task)
    
    # 3. 暂停检查
    if agent.is_paused: yield paused message; return
    
    # 4. 工具提升（技能范围）
    agent._clear_elevated_tools()
    agent._elevate_tools_for_skill(controlled_basic_tools, ...)
    
    # 5. 初始化记忆
    await agent._init_memory_documents()
    
    # 6. 任务通知
    notifications = await task_manager.get_pending_notifications()
    
    # 7. 启动检查
    for warning in await agent._run_startup_checks(): yield warning
    
    # 8. 获取 Kernel 实例
    kernel = agent._shared_agent_kernel  # DrSaiAgentKernel
    
    # 9. 构建工具清单
    workbench_tools = await agent._workbench.list_tools()
    
    # 10. 进入 Kernel 决策循环
    #     Kernel 发出 MODEL_REQUEST → Host 调用 LLM
    #     Kernel 发出 TOOL_CALL_REQUEST → Host 执行工具
    #     Kernel 发出 APPROVAL_REQUEST → Host 请求用户审批
    #     所有事件通过 yield 流式返回
```

**`desktop_kernel_coordinator.py`** — Desktop 协调器
- `DesktopModelResult` / `DesktopModelDelta` — 模型结果数据
- `DesktopToolResult` — 工具结果
- `DesktopApprovalResult` — 审批结果
- `DesktopKernelCoordinator` — 协调 Kernel 与 Host 的回调

**`desktop_kernel_run_stream.py`** — 流式运行包装
- `build_desktop_start_envelope()` — 构建启动信封
- `DesktopKernelRunStream` — 管理流式运行生命周期

### 4.2 安全边界 — 控制智能体能做什么

#### 基础安全 (`security.py`)

```python
class RuntimePrincipal:      # 运行时主体（用户身份）
class OperationContext:       # 操作上下文（命令、参数、工作目录）
class WorkspacePermissionStore: # 工作区权限存储
class ApprovalRegistry:       # 审批注册表
class AuditLog:               # 审计日志
class RuntimeSecurity:       # 安全门面
    # → 检查操作是否允许
    # → 需要审批时抛出 ApprovalRequired
    # → 记录审计日志
class SecureWorkspaceFS:     # 安全工作区文件系统
    # → 路径限制在工作目录内
    # → 防止越权访问

def redact_sensitive(value, key, context): # 敏感信息脱敏
```

#### 高级安全边界 (`security_boundary/`)

这是一个 **30+ 文件的大型子系统**, 实现了企业级安全隔离:

| 模块 | 功能 |
|------|------|
| `models.py` | `ActionProposal`(操作提案), `ResolvedCapabilityProfile`(能力清单) |
| `policy.py` | 安全策略（允许/拒绝/条件） |
| `sandbox.py` | 沙箱执行环境 |
| `filesystem.py` | 文件系统隔离（工作目录边界） |
| `filesystem_execution.py` | 授权文件系统执行 |
| `network.py` | 网络隔离 |
| `isolated_effect_execution.py` | 隔离效果执行（独立进程） |
| `isolated_effect_worker.py` | 隔离工作进程 |
| `isolated_worker_artifact.py` | 隔离产物解析（Authenticode 签名验证） |
| `isolation_leases.py` | 隔离租约（attestation lease） |
| `hard_deny.py` | 硬拒绝策略（不可覆盖的禁止） |
| `grants.py` | 授权授予（AuthorizationGrant） |
| `audit.py` | 审计日志 |
| `credentials.py` | 凭证管理 |
| `effects.py` | 效果系统（副作用追踪） |
| `storage.py` | 安全存储 |
| `tombstones.py` | 墓碑（已删除资源标记, 防止复活） |
| `static_scan.py` | 静态扫描（执行前分析） |
| `metrics.py` | 安全指标收集 |
| `approval_slo_monitor.py` | 审批 SLA 监控（响应时间） |
| `approval_slo_policy.py` | 审批 SLA 策略 |
| `security_metrics_exporter.py` | 指标导出 |
| `security_metrics_named_pipe.py` | Windows 命名管道指标推送 |
| `security_observability_*.py` | 可观测性（部署/工厂/发布） |
| `windows_*.py` | Windows 特定安全（Job 对象、AppContainer、ACL、安装器等） |

**Windows 安全特化**:
- `windows_token.py` — 限制令牌（降权）
- `windows_job.py` — Job 对象（资源限制）
- `windows_appcontainer.py` — AppContainer 隔离
- `windows_isolated_session.py` — 隔离会话
- `windows_acl_projection.py` — ACL 投影
- `windows_installer_*.py` — 安装器系列（SCM 操作、文件系统操作、日志）
- `windows_installation_verifier.py` — 安装验证器
- `windows_service_bootstrap_envelope.py` — 服务引导信封
- `windows_package_catalog.py` / `windows_package_key_policy.py` — 包目录/密钥策略
- `windows_security_metrics_pipe_api.py` — 安全指标管道 API

### 4.3 权限模式 — 控制智能体的操作范围

**`permission_modes/`** 子系统:

```
权限决策流程:
用户配置 → profiles.py (权限配置文件)
         → resolver.py (解析器: 哪个配置适用?)
         → evaluation.py (评估: 操作是否允许?)
         → service.py (服务: 模式切换)
         → inheritance.py (继承: 子智能体权限)
         → auto_reviewer.py (自动审核: AI 辅助审批)
         → kill_switch.py (紧急停止: 一键禁用)
         → config_migration.py (配置迁移: 旧格式→新格式)
```

| 模块 | 功能 |
|------|------|
| `profiles.py` | 权限配置文件（只读、写入、危险命令等模式） |
| `resolver.py` | 根据上下文解析适用哪个权限配置 |
| `service.py` | 权限模式切换服务（`PermissionModeService`） |
| `evaluation.py` | 权限评估（操作 vs 配置） |
| `inheritance.py` | 子智能体/子进程权限继承 |
| `auto_reviewer.py` | AI 辅助审批（自动审核简单操作） |
| `auto_review_coordinator.py` | 自动审核协调器 |
| `config_migration.py` | 旧配置格式迁移 |
| `kill_switch.py` | 紧急停止（一键禁用所有危险操作） |

### 4.4 RuntimeEngine — 状态与持久化

**`engine.py`** — RuntimeEngine 类（第 309 行）

这是 runtime 的**状态管理核心**, 使用 SQLite 存储所有运行时状态:

```python
class RuntimeEngine:
    def __init__(self, db_path, *, workspace_root, instance_id, ...):
        # 初始化 SQLite 数据库
        # 创建安全边界存储
        # 创建授权服务
        # 创建权限模式服务
        # 创建实验/回放/比较存储
    
    # 会话管理
    def create_session(...)              # 创建会话
    def get_session(session_id)          # 获取会话
    def list_sessions(workspace_id, ...)  # 列出会话
    def update_session(...)              # 更新会话
    
    # 通道管理（微信等）
    def resolve_or_create_channel_session(...)
    def begin_channel_delivery(...)
    def complete_channel_delivery(...)
    
    # 安全
    def authorized_filesystem_execution(workspace_root)  # 授权文件系统执行
    
    # 实验与回放
    def record_tool_replay_evidence(...)
    def tool_replay_evidence(run_id)
    
    # 加密
    class _CheckpointCipher:  # 检查点加密（AES, 密钥轮换）
        def encrypt(state) / decrypt(value)
        def rotate() / prune_rotated_keys()
```

**关键特性**:
- `_CheckpointCipher` (第 221 行) — 检查点状态加密, 支持密钥轮换
- `_ClosingConnection` (第 152 行) — 自动关闭的 SQLite 连接
- 集成了所有子系统：安全边界、权限模式、授权、实验、回放

### 4.5 OAEP — 事件投影与安全输出

**`oaep.py`** — OpenDrSai Event Protocol

```python
def project_event(raw_event) → dict    # 将内部事件投影为安全的外部事件
def project_snapshot(state) → dict      # 将运行状态投影为安全快照
def safe_error(value) → dict            # 错误信息脱敏
```

这个模块负责**数据出口安全** — 确保内部状态推送到前端时不泄露敏感信息（API key、文件路径、凭证等）。

### 4.6 Web 搜索 — 智能体的信息获取

**`web_search/`** 子系统:

| 模块 | 功能 |
|------|------|
| `contracts.py` | 搜索契约（接口定义） |
| `tool.py` | 搜索工具（供智能体调用） |
| `tavily.py` | Tavily 搜索 API |
| `hai_tavily.py` | HepAI Tavily（内部服务） |
| `bing_playwright.py` | Bing Playwright 搜索 |
| `provider_policy.py` | 提供商策略（选择哪个搜索引擎） |
| `url_safety.py` | URL 安全检查 |
| `errors.py` | 错误定义 |

### 4.7 资源主机 — 文件与产物管理

**`resource_host.py`** — 租户文件系统资源主机
```python
class TenantResourceContext:      # 租户资源上下文
class TenantFilesystemResourceHost: # 租户文件系统资源主机
    # 管理工作区文件
    # 产物注册与解析
    # OWOP (OpenDrSai Workspace Object Protocol) 集成
```

**`artifact_host.py`** — 产物主机（智能体生成的文件）
**`artifacts.py`** — 产物管理逻辑
**`adoptions.py`** — 工作树/产物采纳

### 4.8 实验与回放 — 可重现性

| 模块 | 功能 |
|------|------|
| `experiments.py` | 实验存储（保存运行配置和结果） |
| `experiment_export.py` | 导出实验包 |
| `replay_planner.py` | 回放规划（从实验创建回放计划） |
| `replay_execution.py` | 回放执行（重现运行） |
| `run_comparison.py` | 运行比较（对比多次运行） |
| `run_comparison_evaluation.py` | 比较评估 |
| `run_inspection.py` | 运行检查（查看运行详情） |
| `goals.py` | 目标标准化 |

### 4.9 移动端适配

**`mobile_adapter.py`** — 移动端适配器
**`mobile_core/`** — 跨平台核心（Android Chaquopy 兼容）

这个子系统的特殊性：`mobile_core/` 的代码被设计为**可被 Android 的 Chaquopy 直接加载** — 它只依赖 Python 标准库, 不依赖服务器/数据库/UI 包。这是 `agent_kernel.py` 注释中说明的: "intentionally lives at the Runtime root so the same source can be loaded both from the regular drsai package and from Android's Chaquopy source set."

### 4.10 终端模拟

**`terminal/`** 子系统:
- `screen.py` — 终端屏幕模拟
- `state_service.py` — 终端状态服务

用于在智能体执行命令行操作时模拟终端输出。

---

## 5. 数据流：Desktop → runtime → Agent

### 完整执行流程

```
1. Desktop 前端发送 HTTP 请求
   POST /v1/.../run { task, thread_id, user_id, work_dir, ... }
       ↓
2. HTTP Gateway (gateway_legacy.py)
   AgentManager.run_stream(task, thread_id, user_id, ...)
       ↓
3. AgentManager.get_or_create()
   → create_agent() → DrSaiAssistant 实例
   → agent.lazy_init() → 加载技能/工具/记忆
   → agent.load_state() → 恢复历史状态
       ↓
4. DrSaiAssistant.run_stream(task=task)
       ↓
5. 检查 _shared_agent_kernel 是否存在
   ├── 有 Kernel → 走 Kernel 路径 (Runtime V2)
   │   ↓
   │   6a. run_agent_through_kernel(agent, task, ...)
   │       ↓
   │   7a. 安全绑定验证 (desktop_security_binding.py)
   │   8a. 工具提升 (_elevate_tools_for_skill)
   │   9a. 记忆初始化 (_init_memory_documents)
   │  10a. 启动检查 (_run_startup_checks)
   │  11a. 获取 kernel = agent._shared_agent_kernel
   │  12a. 构建 DesktopKernelRunStream
   │  13a. Kernel.handle(START_RUN envelope)
   │       ↓
   │  14a. DrSaiAgentKernel._start_run()
   │       → 组装上下文 (context.py)
   │       → 构建工具决策需求 (build_tool_decision_requirement)
   │       → 发出 MODEL_REQUEST envelope
   │       ↓
   │  15a. DesktopKernelCoordinator 处理 MODEL_REQUEST
   │       → 调用 agent._call_llm()
   │       → 返回 MODEL_CHUNK / MODEL_COMPLETED
   │       ↓
   │  16a. Kernel 检查工具调用
   │       → 发出 TOOL_CALL_REQUEST envelope
   │       ↓
   │  17a. DesktopKernelCoordinator 处理 TOOL_CALL_REQUEST
   │       → 检查权限 (security_boundary/policy.py)
   │       → 需要审批? → APPROVAL_REQUEST
   │       → 执行工具 (agent._workbench)
   │       → 返回 TOOL_RESULT
   │       ↓
   │  18a. 循环 15a-17a 直到 COMPLETED
   │       ↓
   │  19a. yield 所有事件到 run_stream() 调用者
   │
   └── 无 Kernel → 走直接路径 (Runtime V1, legacy)
       ↓
       6b. on_messages_stream() 直接循环
       → _call_llm() → _process_model_result()
       → 工具执行 → 子智能体 → 循环
       → yield 事件
       ↓
       7b. yield 所有事件
       ↓
8. StreamingResponse (SSE/NDJSON) → HTTP 响应流
       ↓
9. Desktop 前端渲染流式输出
```

### 安全检查拦截点

```
智能体请求执行操作 (如 run_bash)
    ↓
security_boundary/policy.py → 检查操作是否允许
    ├── 允许 → 直接执行
    ├── 需要审批 → approval_slo_monitor.py → 发送审批请求到前端
    │   ↓ 用户在 Desktop UI 点击批准/拒绝
    │   ↓ HTTP 响应返回
    │   └── 继续/中止执行
    └── 硬拒绝 (hard_deny.py) → 直接拒绝, 不可覆盖
```

### 状态持久化流程

```
每轮对话结束后:
    agent.save_state() → 导出智能体状态
        ↓
    RuntimeEngine._CheckpointCipher.encrypt(state) → 加密
        ↓
    SQLite 存储到 Thread.state
        ↓
会话恢复时:
    SQLite 读取 Thread.state
        ↓
    _CheckpointCipher.decrypt(value) → 解密
        ↓
    agent.load_state(state_dict) → 恢复智能体状态
```

---

## 6. 关键设计：Agent Kernel 双层架构

### 设计理念

OpenDrSai 采用了 **Host-Driven Kernel** 架构, 这是一个非常独特的设计:

```
传统架构:                    OpenDrSai 架构:
┌─────────────┐              ┌─────────────────────┐
│ Agent       │              │ Host (DrSaiAssistant)│ ← 拥有 LLM/工具/技能
│ - LLM 调用  │              │  ↕ RuntimeEnvelope   │
│ - 工具执行  │              ├─────────────────────┤
│ - 循环控制  │              │ Kernel              │ ← 编排决策循环
│ 全部在一起  │              │ - 何时调模型?       │
└─────────────┘              │ - 调哪些工具?       │
                             │ - 需要审批?         │
                             │ - 产物处理?         │
                             └─────────────────────┘
```

### 为什么这样设计?

1. **跨平台一致性**: `mobile_core/engine.py` 在 Desktop/Android/TUI 三个平台共享同一个决策逻辑, 只有 Host 适配器不同
2. **可测试性**: Kernel 是纯逻辑, 不含 I/O, 可独立单元测试
3. **可观测性**: 所有决策通过 `RuntimeEnvelope` 流转, 可被检查/回放/比较
4. **安全控制**: Kernel 不直接执行任何操作 — 它只能"请求"Host 执行, Host 可以拒绝或附加审批
5. **实验回放**: 由于决策与执行分离, 可以记录 Kernel 的所有决策信封, 然后精确回放

### RuntimeEnvelope 消息流

```
Host → Kernel:
  START_RUN { task, tools, context }
  MODEL_CHUNK { delta_text }          ← LLM 流式输出
  MODEL_COMPLETED { full_response }   ← LLM 完成
  TOOL_RESULT { tool_id, result }     ← 工具执行完成
  APPROVAL_RESULT { approved }        ← 用户审批结果
  ARTIFACT_RESULT { artifact_id }     ← 产物处理完成
  CANCEL_RUN                          ← 取消运行

Kernel → Host:
  MODEL_REQUEST { messages, tools }   ← 请求调用 LLM
  TOOL_CALL_REQUEST { tool, args }    ← 请求执行工具
  APPROVAL_REQUEST { command, desc }  ← 请求用户审批
  ARTIFACT_REQUEST { artifact }       ← 请求处理产物
  CHECKPOINT_REQUEST                  ← 请求保存检查点
  RUNTIME_EVENT { event_data }        ← 运行时事件推送
```

---

## 7. 附录：文件索引

### 核心引擎
| 文件 | 关键符号 | 行号 |
|------|---------|------|
| `agent_kernel.py` | `AgentRunConfig` | 1668 |
| `agent_kernel.py` | `DEFAULT_SYSTEM_PROMPT` | ~70 |
| `agent_kernel.py` | `resolve_tool_decision()` | 490 |
| `agent_kernel.py` | `build_tool_choice_policy()` | 538 |
| `agent_kernel.py` | `desktop_production_parity_manifest()` | 1057 |
| `agent_kernel.py` | `build_execution_tool_registry()` | 1547 |
| `agent_kernel_factory.py` | `create_agent_kernel()` | ~20 |
| `mobile_core/engine.py` | `DrSaiAgentKernel` | 267 |
| `mobile_core/engine.py` | `handle()` | 285 |
| `mobile_core/engine.py` | `_start_run()` | 308 |
| `mobile_core/engine.py` | `_model_completed()` | 926 |
| `mobile_core/engine.py` | `_tool_result()` | 1402 |
| `mobile_core/protocol.py` | `MessageType` | ~20 |
| `mobile_core/protocol.py` | `RuntimeEnvelope` | ~35 |

### Desktop 适配
| 文件 | 关键符号 | 行号 |
|------|---------|------|
| `desktop_agent_kernel_adapter.py` | `run_agent_through_kernel()` | 821 |
| `desktop_kernel_coordinator.py` | `DesktopKernelCoordinator` | 60 |
| `desktop_kernel_run_stream.py` | `DesktopKernelRunStream` | 55 |
| `desktop_autogen_ports.py` | autogen 端口适配 | - |
| `desktop_security_binding.py` | `validate_desktop_security_execution_binding()` | - |

### 安全
| 文件 | 关键符号 | 行号 |
|------|---------|------|
| `security.py` | `RuntimeSecurity` | 241 |
| `security.py` | `SecureWorkspaceFS` | 335 |
| `security.py` | `redact_sensitive()` | 304 |
| `security_boundary/models.py` | `ActionProposal` | - |
| `security_boundary/policy.py` | 安全策略 | - |
| `security_boundary/sandbox.py` | 沙箱执行 | - |
| `security_boundary/hard_deny.py` | 硬拒绝 | - |
| `security_boundary/filesystem_execution.py` | `AuthorizedFilesystemExecutionService` | - |

### 权限
| 文件 | 关键符号 |
|------|---------|
| `permission_modes/profiles.py` | 权限配置 |
| `permission_modes/resolver.py` | 权限解析 |
| `permission_modes/service.py` | `PermissionModeService` |
| `permission_modes/kill_switch.py` | `PermissionKillSwitchService` |
| `permission_modes/auto_reviewer.py` | `AutoReviewerService` |

### 状态与持久化
| 文件 | 关键符号 | 行号 |
|------|---------|------|
| `engine.py` | `RuntimeEngine` | 309 |
| `engine.py` | `_CheckpointCipher` | 221 |
| `engine.py` | `create_session()` | 851 |
| `oaep.py` | `project_event()` | - |
| `oaep.py` | `safe_error()` | 56 |
| `journal.py` | `RuntimeConversationJournal` | - |
| `observability.py` | 可观测性 | - |

### 资源
| 文件 | 关键符号 |
|------|---------|
| `resource_host.py` | `TenantFilesystemResourceHost` |
| `artifact_host.py` | 产物主机 |
| `artifacts.py` | 产物管理 |
| `evidence.py` | 证据系统 |
| `grounded.py` | 接地回答 |
| `input_resources.py` | `autogen_input_task()` |

### Web 搜索
| 文件 | 功能 |
|------|------|
| `web_search/tool.py` | 搜索工具 |
| `web_search/tavily.py` | Tavily API |
| `web_search/hai_tavily.py` | HepAI Tavily |
| `web_search/provider_policy.py` | 提供商选择 |
| `web_search/url_safety.py` | URL 安全 |

---

> **总结**: `backend/runtime` 是 OpenDrSai 的**执行运行时层**, 位于网关（消息路由）和智能体（LLM 调用）之间。它的核心是 **Agent Kernel** — 一个 Host-Driven 的决策编排引擎, 通过 `RuntimeEnvelope` 消息协议控制"模型请求→工具调用→审批→产物"的完整循环。围绕 Kernel, runtime 提供了安全边界（控制智能体能做什么）、权限模式（控制操作范围）、状态持久化（加密存储会话）、实验回放（可重现性）、Web 搜索（信息获取）等横切关注点。这个设计使得 OpenDrSai 能在 Desktop、TUI、Android 三个平台共享同一套决策逻辑, 同时保持安全可控。
