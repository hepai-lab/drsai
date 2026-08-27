# OpenDrSai Codex Agent Backend 实现计划 V1

> 架构基线：[OpenDrSai 远程工作区实现方案 V1](./OpenDrSai远程工作区实现方案V1.md)  
> 完整交付方案：[OpenDrSai Codex 工作区开发方案 V1](./OpenDrSaiCodex工作区开发方案V1.md)  
> 计划日期：2026-07-16  
> 目标：在不改变 Desktop、SSH Manager、Runtime Protocol、Runtime Engine 和 Workspace Registry 架构的前提下，实现 `Codex Agent Backend = Codex Adapter + Codex App Server`。  
> 范围说明：本计划属于当前远程工作区 V1 之后的扩展交付，不回写既有 107/110 验收统计。

## 1. 可行性结论

Codex Adapter 具备实现基础，但必须采用风险优先、分阶段放行，不能直接进入完整产品接入。

已在当前开发环境验证：

- `codex-cli 0.142.5` 提供 `codex app-server`；
- App Server 支持 `stdio://`，并提供 daemon、proxy 和 Unix control socket 管理能力；
- CLI 可以生成与当前 Codex 版本精确匹配的 JSON Schema 和 TypeScript bindings；
- 稳定 Schema 包含 `initialize`、`thread/start`、`thread/resume`、`turn/start`、`turn/interrupt`、`turn/completed`、Agent message delta、Item started/completed；
- 稳定 Schema 包含命令执行、文件修改等 Server Request 审批结构；
- Thread、Turn 和通知中包含 Adapter 映射所需的 `threadId`、`turnId`、`itemId`。

仍需通过真实 Linux Runtime 验证的关键风险：

1. Runtime 重启后，Adapter 能否重新连接 daemon 并恢复对活动 Turn 的订阅；
2. Codex Server Request 是否能无损桥接到现有 Permission、Approval 和 Audit 链路；
3. App Server 升级后的 Schema 漂移是否能被生成门禁和兼容矩阵阻止；
4. 远端普通用户的 Codex 登录、凭据存储、刷新和日志脱敏是否满足发布要求；
5. 同一 Codex App Server 管理多 Workspace、多 Thread 和并发 Turn 时是否完全隔离。

只有 P0 可行性尖峰全部通过，才进入正式实现。

## 2. 架构约束

```text
OpenDrSai Full Agent Runtime
├─ Gateway / Protocol
├─ Session / Run / Event Runtime Engine
├─ Agent Core
│  ├─ Agent Backend Router
│  ├─ OpenDrSai Agent Backend
│  └─ Codex Agent Backend
│     ├─ Codex Adapter
│     └─ Codex App Server
└─ Workspace Registry
```

必须遵守：

- Runtime 是外层平台；Agent Core 内只使用 Backend 命名；
- Codex Adapter 是 Codex Agent Backend 对 OpenDrSai 的唯一代码边界；
- Supervisor、JSON-RPC Client、Mapper 和 Approval Bridge 只作为 Adapter 私有实现；
- Desktop 和 Gateway 不得直接连接 Codex App Server；
- 不增加 Codex 专用 SSH 隧道或对外监听端口；
- Workspace、Session、Run、Event sequence、Permission、Approval decision、Audit 仍以 OpenDrSai Runtime 为权威；
- Codex Thread、Turn、Item 和 Codex 内部上下文以 Codex App Server 为权威；
- Adapter 只保存 `session_id ↔ thread_id` 和 `run_id ↔ turn_id` 等关联，不创建第二套产品领域模型；
- 第一版只使用 Codex 稳定协议，不设置 `experimentalApi=true`；
- 不直接使用 `thread/shellCommand` 承担产品终端能力，Desktop Files、Git、PTY 继续使用现有 Runtime 服务。

## 3. 交付范围

### 3.1 第一版必须支持

- Codex 可用性和版本探测；
- 启动或连接 Codex App Server；
- 初始化 JSON-RPC 连接；
- 创建、恢复 Codex Thread；
- 创建 Turn 并流式接收消息、命令、文件修改和终态事件；
- OpenDrSai Session/Run 与 Codex Thread/Turn 的持久映射；
- Codex Event 到统一 Runtime Event 的转换和持久化；
- 显式 Run cancel 到 `turn/interrupt` 的映射；
- 命令和文件修改审批桥接；
- Desktop/SSH 断线后 Turn 继续，重连后从 Runtime Event Store 补取；
- Runtime 重启后的 Thread 恢复和确定性 Run 收敛；
- 多 Workspace 隔离；
- Codex 版本、能力和错误通过 Runtime capabilities/统一错误模型暴露；
- 打包、安装、升级、回滚和验收证据。

### 3.2 第一版不支持

- Codex 实验性协议；
- Desktop 直接远程控制 Codex；
- Codex App Server 取代 Workspace Files、Git 或 PTY API；
- OpenDrSai Session 与 Codex Thread 的跨 Backend 双向迁移；
- OpenDrSai Agent Backend 与 Codex Agent Backend 在同一个 Run 内切换；
- Codex Plugin、Marketplace、Apps 管理 UI；
- 在 Codex App Server 崩溃后承诺无损恢复模型正在生成但尚未持久化的 token。

## 4. 代码边界

建议目录：

```text
cores/python/packages/drsai/src/drsai/backend/
├─ agent_runtime.py
└─ agent_backends/
   ├─ __init__.py
   ├─ base.py
   ├─ opendrsai.py
   └─ codex_adapter/
      ├─ __init__.py
      ├─ adapter.py
      ├─ _process.py
      ├─ _jsonrpc.py
      ├─ _bindings.py
      ├─ _events.py
      ├─ _approvals.py
      ├─ _errors.py
      └─ generated_schema/
```

对外只导出：

```python
from drsai.backend.agent_backends.codex_adapter import CodexAdapter
```

其他模块不得导入 `_process`、`_jsonrpc`、`_bindings` 等内部模块。

## 5. Backend 契约调整

当前 `AgentRuntimeBackend.execute()` 是同步、单次调用接口，Gateway 使用 `asyncio.to_thread()` 执行。Codex 需要一个 Runtime 级长驻连接、并发请求路由和 Server Request 回调，因此正式接入前先收敛为异步 Backend 契约：

```python
class AgentBackend(Protocol):
    backend_id: str

    async def execute(
        self,
        context: RuntimeRunContext,
        definition: AgentDefinition,
        prompt: str,
        services: AgentExecutionServices,
    ) -> dict[str, Any]: ...

    async def cancel(self, run_id: str) -> None: ...

    async def respond_approval(
        self,
        run_id: str,
        approval_id: str,
        decision: str,
    ) -> None: ...

    async def recover(self, run_id: str) -> None: ...

    async def close(self) -> None: ...
```

迁移规则：

- `AgentRuntimeBackend` 重命名为 `AgentBackend`；
- `OpenDrSaiAgentRuntimeBackend` 重命名为 `OpenDrSaiAgentBackend`；
- OpenDrSai Backend 先通过异步包装保持现有行为和测试结果不变；
- `RuntimeAgentService.execute()` 改为 async，Gateway 不再为每个 Run 新建 Backend；
- Backend Router 和 Backend 实例在 Runtime 生命周期内单例化；
- cancel、approval、shutdown 必须路由到创建该 Run 的 Backend。

## 6. Codex Adapter 内部设计

### 6.1 进程与连接模式

分两步实现：

```text
测试/MVP：Adapter → codex app-server --listen stdio://
生产候选：Adapter → codex app-server proxy → daemon Unix control socket
```

stdio 子进程模式用于快速验证协议、事件和审批。生产优先验证 daemon 模式，因为它可以把 Codex App Server 生命周期与 OpenDrSai Runtime 进程解耦，为 Runtime 重启后重连提供基础。

Adapter 内部进程管理必须提供：

- `ensure_available()`：检查 CLI、版本和 Schema 兼容性；
- `start_or_connect()`：启动子进程或连接 daemon proxy；
- `health()`：检查进程、连接、初始化状态和版本；
- `restart()`：有界重启，不重复提交未知状态 Turn；
- `close()`：关闭 Adapter 连接；只有 Runtime 明确卸载 Codex 时才停止共享 daemon；
- stderr 单独读取，经过脱敏后进入 Runtime 日志，不混入 JSONL stdout。

### 6.2 JSON-RPC 核心

`_jsonrpc.py` 维护：

```text
next_request_id
pending_requests[id] → Future
thread_subscribers[thread_id]
turn_subscribers[thread_id, turn_id]
pending_server_requests[id]
reader_task
stderr_task
connection_generation
```

强制行为：

- 每行只解析一个 JSON 对象；
- Response 按 `id` 完成对应 Future；
- Notification 按 `threadId/turnId` 投递；
- Server Request 进入 Approval Bridge 或受支持的客户端处理器；
- 未识别的 Notification 记录类型和安全摘要，不导致连接退出；
- 未识别的 Server Request 返回明确的“不支持”错误，不能永久悬挂；
- EOF 使所有 pending Future 以统一 `codex_connection_lost` 失败；
- 请求必须有超时，但 Turn 执行等待不能使用普通短请求超时。

### 6.3 Schema 固定与漂移门禁

构建时执行：

```text
codex app-server generate-json-schema --out <generated_schema>
```

仓库记录：

```text
codex_cli_version
schema_digest
supported_protocol_surface
```

CI 门禁：

- 当前固定 Codex 版本重新生成 Schema 后仓库零差异；
- `initialize/thread/start/thread/resume/turn/start/turn/interrupt` 缺失时失败；
- 必需通知或审批请求字段改变时失败；
- Runtime 安装制品中的 Codex 版本与生成 Schema 的版本不一致时失败；
- 升级 Codex 必须先更新 Schema、兼容测试和事件映射，再更新 Runtime 制品。

### 6.4 Binding Store

在 Runtime 状态数据库增加 Backend 私有映射：

```text
agent_backend_sessions
├─ backend_id
├─ runtime_id
├─ workspace_id
├─ session_id
├─ backend_session_id       # Codex thread_id
├─ backend_version
├─ created_at
└─ updated_at

agent_backend_runs
├─ backend_id
├─ run_id
├─ backend_session_id       # Codex thread_id
├─ backend_run_id           # Codex turn_id
├─ connection_generation
├─ last_backend_status
├─ created_at
└─ updated_at
```

约束：

- `session_id` 只能绑定一个 Backend；
- Binding 必须同时校验 `runtime_id` 和 `workspace_id`；
- Codex Thread 恢复后的 cwd 必须与 Runtime canonical Workspace path 一致；
- 不允许客户端提供或修改 `thread_id/turn_id`；
- Binding 不是 Event Store，不能保存或覆盖产品事件。

### 6.5 执行流程

```text
RuntimeAgentService.execute(run_id)
  → Runtime 构造权威 RuntimeRunContext
  → CodexAdapter.ensure_available()
  → 查询 session_id 对应 thread_id
     ├─ 无绑定：thread/start(cwd, model, policy)
     └─ 有绑定：thread/resume(threadId)
  → 校验返回 Thread 的 cwd/身份
  → turn/start(threadId, input, cwd, policy)
  → 原子保存 run_id ↔ turn_id
  → 订阅该 Turn 通知
  → 通知经 Event Mapper 写入 Runtime Event Store
  → turn/completed 映射到 Run 终态
```

在 `turn/start` 请求成功但响应丢失时，不得盲目重试。Adapter 必须先使用 Thread 读取/状态接口确定是否已经产生 Turn；无法确定时将 Run 收敛为 `backend_state_unknown`，由恢复流程处理。

### 6.6 Event Mapper

第一版映射至少覆盖：

| Codex 事件 | Runtime Event |
| --- | --- |
| `turn/started` | `agent.started` |
| Agent message delta | `agent.message.delta` |
| `item/started` | `agent.item.started` 或 `tool.started` |
| Command output delta | `tool.output.delta` |
| File change delta | `workspace.change.delta` |
| `item/completed` | `agent.item.completed`、`tool.completed` 或 `tool.failed` |
| `turn/completed: completed` | `agent.completed` |
| `turn/completed: interrupted` | `agent.cancelled` |
| `turn/completed: failed` | `agent.failed` |

要求：

- Runtime Event Store 继续生成 `event_id` 和单调 `sequence`；
- Codex `threadId/turnId/itemId` 放入 Backend metadata，不能替代 Runtime ID；
- 重复通知使用稳定 Backend event key 去重；
- Event data 必须先经过 Secret redaction；
- 未知 Item 类型保留安全摘要并标记 `agent.item.unknown`，不得丢失整个 Turn。

### 6.7 Approval Bridge

```text
Codex Server Request
  → Adapter 根据 threadId/turnId 找到 Run
  → Runtime Permission 检查
  → 无权限：立即返回拒绝，不创建 Approval
  → 有权限：Run → waiting_approval
  → 创建 Runtime Approval + Audit + Event
  → Desktop 返回用户决定
  → Adapter 完成原 Server Request Response
  → Run → running / cancelled / failed
```

必须覆盖：

- 命令执行审批；
- 文件修改审批；
- apply patch 审批；
- 用户输入请求的支持或明确拒绝；
- Adapter/Runtime 重启时未决审批的确定性收敛；
- 超时、拒绝、连接丢失和重复响应。

Codex Server Request 原始 `id` 只能保存在 Adapter 私有状态中，Desktop 使用 Runtime `approval_id`，两者不得混用。

### 6.8 Cancel

```text
POST /v1/runs/{run_id}/cancel
  → Runtime 标记 cancel_requested
  → Backend Router 找到 CodexAdapter
  → 读取 run_id 对应 thread_id/turn_id
  → turn/interrupt
  → 等待 turn/completed: interrupted
  → Runtime Run → cancelled
```

若连接已丢失，Run 保持 `cancel_requested`，恢复连接后先读取 Turn 状态，再决定重发 interrupt 或直接收敛终态。

### 6.9 恢复语义

需要区分三类故障：

| 故障 | 预期行为 |
| --- | --- |
| Desktop/SSH 断线 | Runtime 和 Codex 继续，Desktop 从 Runtime Event Store 补取 |
| Adapter 连接断开、daemon 仍存活 | 重连、initialize、resume Thread、读取状态并恢复事件映射 |
| Codex App Server 进程死亡 | 已持久化 Thread 可恢复；活动 Turn 是否可继续以 P0 实测为准，不能假定 |

如果 P0 证明 daemon 重连不能恢复活动 Turn，则第一版正式语义为：

- 已完成 Turn 从 Codex Thread 和 Runtime Event Store恢复；
- 活动 Turn 收敛为 `failed/backend_interrupted`；
- 用户可在同一 Session/Thread 发起新 Run；
- 不把“重新发起 prompt”伪装成原 Run 的无损续跑。

## 7. 分阶段实施计划

### P0 可行性尖峰：不接产品代码

交付物：独立测试脚本和证据，不修改 Desktop 协议。

1. stdio 启动 App Server并完成 initialize；
2. 在临时 Workspace 创建 Thread 和一个只读 Turn；
3. 收集 Agent message、Item 和 turn/completed；
4. 发起长 Turn，验证 turn/interrupt；
5. 触发命令与文件审批，验证 Server Request/Response；
6. 启动 daemon，通过 proxy 连接；
7. Turn 运行中断开 proxy，再连接并验证 Turn 状态和通知恢复能力；
8. Turn 运行中重启 OpenDrSai 测试宿主但不停止 daemon，验证可恢复边界；
9. 两个 Workspace 同路径名、两个 Thread 并发，验证 cwd 和事件不串线；
10. 扫描 stdout、stderr 和测试证据，确认无凭据泄漏。

进入 P1 条件：Thread/Turn、事件、cancel、审批四条主链路全部有真实 Codex 证据；恢复能力的实际边界已记录并被产品语义接受。

### P1 Adapter 协议核心

- 实现私有 JSON-RPC Client；
- 实现进程/daemon 连接管理；
- 引入固定版本生成 Schema；
- Fake App Server 覆盖乱序响应、未知通知、Server Request、EOF、超时和 stderr；
- 建立 Adapter 健康状态和统一错误映射。

进入 P2 条件：协议单测零悬挂 Future、零未清理进程、Schema drift 门禁通过。

### P2 Thread/Turn 与 Event MVP

- 实现 CodexAdapter 的 execute；
- 建立 Binding Store；
- 完成 Session/Thread、Run/Turn 映射；
- 完成消息、Item、命令、文件和终态 Event Mapper；
- 将 Adapter 注册到 Backend Router；
- Agent Definition 支持 `backend=codex`；
- 保持 OpenDrSai Agent Backend 回归测试全部通过。

进入 P3 条件：真实 Linux Runtime 中 Codex Run 完成，Desktop 通过现有 Event API 看见完整结果，Desktop 不包含 Codex 专用调用。

### P3 Approval 与 Cancel

- 接入 Permission、Approval 和 Audit；
- 实现命令、文件、patch 审批；
- 实现 cancel_requested 和 turn/interrupt；
- 覆盖同意、拒绝、超时、重复响应、连接丢失；
- Secret 扫描覆盖 Server Request 和错误对象。

进入 P4 条件：全部敏感路径遵循 Permission → Approval，Run 终态与 Codex Turn 终态一致。

### P4 恢复与并发

- 采用 P0 选定的 daemon/proxy 或受管子进程模式；
- 实现 connection generation 和重连；
- 实现 Runtime 启动时 Binding 审计与 Run 收敛；
- 验证 Desktop/SSH 断线、Adapter 断线、Runtime 重启和 Codex 崩溃；
- 验证至少 10 Workspace、并发 Thread/Turn 和审批隔离；
- 验证 Event 去重和 sequence 连续性。

进入 P5 条件：没有重复 Turn、跨 Workspace 事件或悬挂 Run。

### P5 安装、升级与能力协商

- Runtime 制品包含或可安装固定 Codex CLI 版本；
- Codex 制品摘要和签名进入现有安装信任链；
- `/v1/capabilities` 增加可选 `agent_backends`；
- Codex 不可用时 `opendrsai` Backend 不受影响；
- Codex 升级先验证新 Schema，失败不切换 current；
- 回滚恢复旧 Codex 版本及兼容 Binding。

进入 P6 条件：安装、升级、失败候选和回滚均有自动化证据。

### P6 打包产品验收

- Windows Sandbox 安装打包 Desktop；
- 通过现有 SSH 链路连接可控 Linux Runtime；
- 选择 `backend=codex` 的 Agent Definition；
- 完成 Thread/Turn、消息流、命令、文件修改、审批和取消；
- Desktop 断线后恢复；
- 双 Workspace 隔离；
- 导出无 Secret 的日志、事件、截图和诊断证据；
- 清理 proxy、临时凭据、测试 Workspace 和容器。

完成条件：所有 Codex Backend 新增功能点关闭，无 P0/P1 缺陷，且原远程工作区 110 项门禁无回归。

## 8. 测试矩阵

| 层级 | 测试重点 |
| --- | --- |
| Unit | JSONL framing、RPC ID、Mapper、错误、去重、Binding、审批状态机 |
| Contract | 固定 Codex Schema、必需方法/字段、生成零 drift |
| Fake App Server | 乱序、慢响应、未知通知、Server Request、EOF、崩溃 |
| Real Codex | initialize、Thread、Turn、Event、cancel、approval |
| Runtime Integration | Backend Router、Run 状态、Event Store、Permission、Audit |
| Linux E2E | 普通用户、真实 Workspace、daemon/proxy、重启、双 Workspace |
| Packaged E2E | Windows Sandbox Desktop → SSH → Runtime → Codex Backend |
| Security | cwd 越界、权限绕过、审批顺序、Token/日志/诊断包脱敏 |
| Reliability | 重连、重复响应、Turn 创建响应丢失、Runtime/Codex 崩溃 |

## 9. 关键验收条件

Codex Adapter 可以标记完成，必须同时满足：

1. Desktop 不存在 Codex 专用网络客户端；
2. Runtime Protocol 仅以向后兼容方式增加 Backend capability；
3. `backend=codex` 可以完成真实 Thread/Turn；
4. Session/Run ID 始终由 Runtime 权威生成；
5. Codex 通知完整写入统一 Event Store；
6. Desktop 断线不终止 Codex Turn；
7. cancel 最终触发 `turn/interrupt` 并得到一致终态；
8. Codex 敏感操作先检查 Permission，再进入 Runtime Approval；
9. 两个 Workspace 的 cwd、Thread、Turn、Event 和审批不串线；
10. Codex 或 Adapter 故障不会静默回落到 OpenDrSai Backend；
11. 固定 Codex 版本与生成 Schema 一致，升级和回滚门禁通过；
12. 日志、Event、数据库、诊断包和验收证据无 Token、密码和私钥。

## 10. Go / No-Go 决策点

P0 完成后做一次明确决策：

**Go：**

- Thread/Turn/通知/审批/cancel 均可通过稳定 Schema实现；
- daemon/proxy 或子进程模式至少有一种满足已声明恢复语义；
- 多 Workspace 隔离成立；
- 凭据可以在远端普通用户范围内安全管理。

**No-Go 或缩减范围：**

- 必需链路只能依赖 experimental API；
- Server Request 无法与现有 Approval 状态机可靠关联；
- Turn 创建响应丢失后无法确定是否已经创建，且没有可接受的收敛策略；
- Codex 进程或 daemon 无法在普通用户权限下稳定安装和管理；
- Codex 版本升级无法通过 Schema 固定获得可维护兼容边界。

No-Go 不影响现有 OpenDrSai Agent Backend；Codex capability 保持不可用并返回明确原因，不允许静默回落执行。
