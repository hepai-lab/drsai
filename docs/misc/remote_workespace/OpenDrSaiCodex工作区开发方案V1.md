# OpenDrSai Codex 工作区开发方案 V1

> 架构基线：[OpenDrSai 远程工作区实现方案 V1](./OpenDrSai远程工作区实现方案V1.md)  
> OWOP 定义：[OpenDrSai Workspace Operation Protocal](./OpenDrSai远程工作区实现方案V1.md#54-opendrsai-workspace-operation-protocalowop)  
> Codex Backend 预研计划：[OpenDrSai Codex Agent Backend 实现计划 V1](./OpenDrSaiCodexAgentBackend实现计划V1.md)  
> 开发目标：使用统一 Runtime Protocol、OWOP 和 Agent Backend 架构，先交付 Windows 本地 Codex Workspace，后续以同一架构扩展 Linux 远程 Codex Workspace。  
> 统计口径：共 **12 个模块、96 个功能点**；每个功能点均有独立验收条件。

## 1. 范围与完成定义

### 1.1 统一目标架构

```text
OpenDrSai Desktop
├─ Workspace UI
├─ Runtime Client
└─ Runtime Connection
   ├─ Local Connection
   └─ SSH Connection
              │
              ▼
OpenDrSai Full Agent Runtime
├─ Gateway / Runtime Protocol
├─ Session / Run / Event Runtime Engine
├─ Workspace Registry
├─ OpenDrSai Workspace Operation Protocal
└─ Agent Core
   ├─ Agent Backend Router
   ├─ OpenDrSai Agent Backend
   └─ Codex Agent Backend
      ├─ Codex Adapter
      └─ Codex App Server
              │
              ▼
          Workspace
```

本地阶段：

```text
Windows Desktop
  → Local Runtime Connection
  → Windows Local Full Agent Runtime
  → Codex Adapter
  → Windows Codex App Server
  → Windows Local Workspace
```

未来远程阶段：

```text
Windows Desktop
  → SSH Runtime Connection
  → Linux Remote Full Agent Runtime
  → Codex Adapter
  → Linux Codex App Server
  → Linux Remote Workspace
```

两阶段共享 Runtime Protocol、OWOP、Agent Backend 契约、Session/Run/Event 模型、Codex Adapter 语义和 Desktop UI。差异只允许存在于 Runtime Connection、Codex Binary Provider、本地 IPC 和平台路径/进程实现中。

### 1.2 本期交付范围

- Windows Desktop 连接 Windows Local Full Agent Runtime；
- Local Runtime 管理 Windows Local Workspace；
- Agent Definition 可以选择 `backend=codex`；
- Codex Agent Backend 由 Codex Adapter 和受管 Windows Codex App Server 组成；
- Workspace 操作统一经过 OWOP Local Binding；
- OpenDrSai Session/Run/Event 映射到 Codex Thread/Turn/Item；
- 支持 Codex 登录状态、真实 Turn、流式事件、文件/命令审批、显式取消和历史恢复；
- 打包后的 Windows Desktop 在干净环境完成 Local Workspace + Codex Backend 验收；
- 所有抽象和 Schema 必须通过 Remote-ready 合规测试，保证后续 Linux 实现不修改产品领域模型。

### 1.3 不在本期交付范围

- Linux Codex Binary Provider 和 Linux Codex App Server 正式交付；
- Windows Codex Backend 跨 Runtime 直接操作 Linux Workspace；
- `agent_backend_runtime_id != workspace_runtime_id` 的分布式 Backend 模式；
- Codex experimental API；
- Desktop 直接连接 Codex App Server；
- Codex Plugin、Marketplace、Apps 管理 UI；
- 用 Codex 内部 Files/Git/PTY API 取代 OWOP；
- DDF Relay 或 HepAI Worker 进入 Codex 本地主链路。

### 1.4 共置约束

本期和下一阶段默认保持：

```text
agent_backend_runtime_id = workspace_runtime_id
```

Codex Backend、Workspace 和 WorkspaceOperationsService 必须位于同一个 Full Agent Runtime。Local Workspace 使用 Windows Local Runtime；未来 Remote Workspace 使用 Linux Remote Runtime。

### 1.5 功能点完成标准

每个功能点必须同时满足：

1. 实现进入正式模块，不以 Mock、源码字符串检查或人工口头结论代替；
2. 对应自动化测试通过；
3. 成功、错误、权限和恢复路径均有覆盖；
4. 协议或数据模型变化同步更新 Schema、生成代码和文档；
5. 验收证据包含测试名称、日志摘要、结构化 JSON 或截图；
6. 不依赖未声明的本机回落、用户 PATH 或 Desktop 私有状态；
7. 不破坏现有 OpenDrSai Agent Backend 和远程工作区门禁。

## 2. 模块与功能点统计

| 模块 | 名称 | 功能点数 | 交付性质 |
| --- | --- | ---: | --- |
| C01 | 统一架构、命名与领域模型 | 8 | 架构冻结 |
| C02 | Agent Backend 契约与路由 | 8 | 重构扩展点 |
| C03 | Windows Local Full Agent Runtime 与连接 | 8 | 本地运行基础 |
| C04 | OWOP 核心协议与 Schema | 8 | 新建统一协议 |
| C05 | OWOP Local Binding 与工作区能力 | 8 | 本地实现 |
| C06 | Codex 制品、版本与进程生命周期 | 8 | 新建 Adapter 基础 |
| C07 | Codex JSON-RPC 与协议兼容 | 8 | 新建协议适配 |
| C08 | Session/Thread、Run/Turn 执行映射 | 8 | 新建核心映射 |
| C09 | Event 映射、持久化与恢复 | 8 | 新建可靠性核心 |
| C10 | Auth、Permission、Approval、Cancel 与 Audit | 8 | 安全整合 |
| C11 | Desktop 产品集成与兼容迁移 | 8 | UI/产品接入 |
| C12 | 测试、打包、发布与 Remote-ready 门禁 | 8 | 交付验收 |
|  | **合计** | **96** |  |

## 3. 详细功能点与验收

## C01 统一架构、命名与领域模型（8 项）

| ID | 功能点 | 测试与验证 |
| --- | --- | --- |
| C01-F01 | 正式命名固定为 Full Agent Runtime、Agent Backend、Codex Agent Backend、Codex Adapter、Codex App Server 和 OWOP | 术语扫描覆盖代码、Schema、UI 和文档；禁止在 Agent Core 内使用 Codex Agent Runtime/OpenDrSai Agent Runtime |
| C01-F02 | Workspace 继续使用统一领域模型，不创建 Codex Workspace 类型 | Local OpenDrSai Backend 与 Codex Backend 序列化同一 Workspace Schema；差异只存在于 Backend metadata |
| C01-F03 | Workspace Target 支持 `location=local|remote` 和独立 transport metadata | TypeScript/Python Schema 往返测试；Local 不携带 SSH，Remote 可携带 `transport=ssh` |
| C01-F04 | Run Context 明确 Backend Runtime 与 Workspace Runtime 身份 | 本期断言两者相等；构造不相等的 Run 返回 `distributed_backend_not_supported` |
| C01-F05 | Agent Definition 使用精确版本和 `backend=opendrsai|codex` | 缺失版本、未知 Backend、`latest` 和篡改 Asset 均被拒绝；两个固定版本可独立重现 |
| C01-F06 | 定义持久化 Backend Session/Run Binding 领域模型 | SQLite 迁移、唯一约束、重启往返和跨 Workspace 冲突测试通过 |
| C01-F07 | 路径类型支持 Windows 与 POSIX，但业务 API 只接受 Workspace 相对路径 | Windows drive/UNC、POSIX path 和混合分隔符 Fixture；协议层拒绝未经 Registry 解析的绝对业务路径 |
| C01-F08 | 架构约束形成 Schema、文档和依赖边界门禁 | 所有权扫描确认 Desktop 不依赖 Codex JSON-RPC，Codex Adapter 不直接依赖 Renderer，Workspace 服务不依赖 Desktop |

## C02 Agent Backend 契约与路由（8 项）

| ID | 功能点 | 测试与验证 |
| --- | --- | --- |
| C02-F01 | 将统一契约命名为 `AgentBackend` | 编译期/类型契约测试覆盖 OpenDrSaiAgentBackend、CodexAdapter 和 TestBackend |
| C02-F02 | Backend 契约支持 execute、cancel、respond_approval、recover、health 和 close | 参数化契约测试验证每个 Backend 的方法、错误和关闭幂等性 |
| C02-F03 | Backend Router 按 Agent Definition 的精确 `backend` 选择实现 | 同 Workspace 分别执行 OpenDrSai/Codex Agent Definition，断言路由准确且不修改 Workspace Target |
| C02-F04 | 禁止 Backend 失败时静默回落其他 Backend | 关闭 Codex App Server，断言 OpenDrSai Backend 未收到请求，Run 返回明确 `codex_backend_unavailable` |
| C02-F05 | Backend 实例由 Runtime 生命周期管理，不按 HTTP 请求重复创建 | 并发 20 个请求断言只创建一个 Codex Adapter/共享连接；Runtime shutdown 后恰好关闭一次 |
| C02-F06 | Run 创建后固定 backend_id、runtime_id 和 workspace_id | 数据库约束和非法更新测试；恢复后绑定保持不变 |
| C02-F07 | `/v1/capabilities` 暴露可选 Agent Backend 能力和不可用原因 | Codex 可用/缺失/版本不兼容/未登录四类 Fixture；旧客户端忽略新增字段 |
| C02-F08 | OpenDrSai Agent Backend 行为无回归 | 现有 `test_agent_runtime.py`、真实 Runtime Agent 验证和新增统一 Backend 合规测试全部通过 |

## C03 Windows Local Full Agent Runtime 与连接（8 项）

| ID | 功能点 | 测试与验证 |
| --- | --- | --- |
| C03-F01 | Desktop 可以启动或连接 Windows Local Full Agent Runtime | Electron/Main 集成测试从无 Runtime 状态启动并握手；重复连接不产生重复实例 |
| C03-F02 | 实现 `LocalRuntimeConnection`，对上满足统一 RuntimeClient | Local 与现有 Remote RuntimeClient 运行同一 Session/Run/Workspace 契约套件 |
| C03-F03 | Local Runtime 提供稳定 runtime_id 和每次启动变化的 instance_id | 重启、升级和清空状态目录测试分别验证 ID 稳定/旋转规则 |
| C03-F04 | Local Workspace 由 Runtime Registry 规范化、生成 workspace_id 并持久化 | drive、UNC、符号链接/junction、不存在目录和无权限目录测试；Desktop 不生成权威 ID |
| C03-F05 | 一个 Local Runtime 管理多个 Workspace 并复用连接 | 同时打开至少 10 个 Workspace，Session、Event、Watch、PTY 和 Codex Thread 不串线 |
| C03-F06 | Desktop 重启不删除 Local Runtime 的 Workspace/Session/Run 历史 | 运行后关闭并重开 Desktop，读取相同 ID、终态和 Event |
| C03-F07 | Local Runtime 异常退出后 Desktop 检测 instance_id 变化并恢复 Registry | 故障注入终止 Runtime，重启后重新握手并恢复全部 Workspace，不复用旧连接状态 |
| C03-F08 | 最后一个 Desktop 连接关闭时按策略保留或关闭 Runtime，无孤儿进程 | 两种生命周期策略 Fixture；发布默认策略下进程、端口、句柄和临时文件均符合预期 |

## C04 OWOP 核心协议与 Schema（8 项）

| ID | 功能点 | 测试与验证 |
| --- | --- | --- |
| C04-F01 | 定义 OWOP 版本、capability、operation 和 Binding 模型 | JSON Schema 校验有效/无效样例；版本和 capability 协商测试通过 |
| C04-F02 | 定义统一 Request/Response/Error 信封 | 所有错误包含 code/message/correlation_id/retryable/details；未知 operation 返回标准错误 |
| C04-F03 | 定义 Workspace/Files/Search/Watch 强类型 operation | Schema Fixture 覆盖 list/stat/read/write/move/remove/search/watch，禁止 arbitrary_json 逃逸 |
| C04-F04 | 定义 Git 强类型 operation | status/diff/file-at-ref/stage/unstage/revert/commit Schema 和 Git Fixture 契约通过 |
| C04-F05 | 定义 Process 与 PTY 强类型 operation | start/write/attach/kill、create/write/resize/attach/kill Schema；argv 禁止退化为任意 shell 字符串 |
| C04-F06 | 定义 Checkpoint 与 Artifact 强类型 operation | create/preview/restore/accept、artifact metadata/chunk Schema 往返通过 |
| C04-F07 | 定义 Workspace Event、resource sequence、cursor 和去重语义 | 乱序、重复、缺口、续传和未知 Event Fixture 通过 |
| C04-F08 | 从同一 OWOP Schema 生成 Python/TypeScript 类型并执行 drift check | CI 重新生成零差异；破坏 operation/字段/错误/Event 的测试修改必须使门禁失败 |

## C05 OWOP Local Binding 与工作区能力（8 项）

| ID | 功能点 | 测试与验证 |
| --- | --- | --- |
| C05-F01 | 实现 InProcess/Local IPC WorkspaceOperationsClient | 两种 Local Binding 运行同一 OWOP 合规套件，响应和错误逐字段一致 |
| C05-F02 | 实现路径根边界、相对路径和 Windows junction/symlink 防越界 | `..`、绝对路径、junction、symlink、竞态替换和大小写边界攻击均被拒绝 |
| C05-F03 | 实现文件树、分页搜索、预览和大文件分块读取 | 10 万文件 Fixture 首屏分页、忽略规则、文本/二进制、10 MB 分块摘要验证通过 |
| C05-F04 | 实现原子写、摘要校验和并发冲突 | 旧 digest 返回 409 等价错误，原文件不损坏且无临时文件残留 |
| C05-F05 | 实现 Watch journal、限流和断线续传 | 批量创建/修改/删除/重命名，after_sequence 补取无跨 Workspace Event |
| C05-F06 | 实现 Git read/write operation | 真实 Git 仓库覆盖 status/diff/stage/unstage/revert/commit、Hook 失败和 stale diff hash |
| C05-F07 | 实现 Process/PTY 生命周期和有限缓冲 | cwd、argv、stdout/stderr、输入、resize、attach、kill、超限截断和进程树清理测试通过 |
| C05-F08 | 实现 Workspace Checkpoint 并与 Runtime Checkpoint 隔离 | 修改/新增/删除/大文件跳过、preview/restore/accept；两类 Checkpoint ID/Schema/存储互不影响 |

## C06 Codex 制品、版本与进程生命周期（8 项）

| ID | 功能点 | 测试与验证 |
| --- | --- | --- |
| C06-F01 | 定义 `CodexBinaryProvider`，开发模式允许 `CODEX_BIN`，产品模式只使用受管制品 | PATH 中放置错误/恶意版本，产品模式仍选择受管二进制；开发 override 明确显示非发布状态 |
| C06-F02 | Codex Windows 制品进入 Runtime 摘要和签名信任链 | 正确签名安装成功；篡改摘要、错误签名、未知发布者均被拒绝 |
| C06-F03 | Codex 按版本独立目录安装并维护 current/previous | 安装两个版本互不覆盖；原子切换中断后 current 始终完整可用 |
| C06-F04 | Codex CLI 版本与生成 App Server Schema 精确匹配 | 二进制版本、manifest 和 schema_digest 三方校验；任一不一致 Backend 不启动 |
| C06-F05 | Codex Adapter 在 Windows 正确启动 App Server | npm wrapper、WindowsApps alias 和受管 exe Fixture；Node 直启 EPERM 场景有平台化可操作错误 |
| C06-F06 | 一个 Runtime 只维护一个共享 App Server/daemon 连接 | 多 Workspace/Session 并发测试只存在一个受管实例，Thread 路由不串线 |
| C06-F07 | 实现 health、受控重启、指数退避和最大失败窗口 | 启动失败、立即退出、stderr 洪水和连续崩溃 Fixture；无重启风暴 |
| C06-F08 | Runtime 关闭、升级和卸载时清理 Codex 资源并脱敏日志 | 进程、pipe、Future、Timer、临时文件全部释放；日志扫描无 Token、Cookie、API key 和授权码 |

## C07 Codex JSON-RPC 与协议兼容（8 项）

| ID | 功能点 | 测试与验证 |
| --- | --- | --- |
| C07-F01 | 完成 initialize/initialized 握手并发送 OpenDrSai clientInfo | 真实 App Server 与 Fake Server 验证初始化前请求被拒绝、重复 initialize 被拒绝、正常握手成功 |
| C07-F02 | 实现 JSONL framing、Request ID、Response Future 和并发路由 | 分片行、合并行、乱序响应、重复 ID、无效 JSON 和 100 并发请求压力测试 |
| C07-F03 | 实现 Notification 按 threadId/turnId/itemId 分发 | 两 Thread/Turn 交错通知仍投递到正确 Run；未知通知不终止 reader |
| C07-F04 | 实现 Server Request 路由和 Response | 命令、文件、patch、用户输入和未知请求 Fixture；每个请求最终响应且无永久悬挂 |
| C07-F05 | 实现短请求超时、Turn 长等待、EOF 和连接 generation | 超时只失败对应请求；EOF 清理全部 Future；重连后旧 generation 消息不污染新连接 |
| C07-F06 | 固定使用稳定 App Server API，不启用 experimentalApi | 生成 Schema 和初始化能力断言；生产配置出现 experimental 字段立即失败 |
| C07-F07 | 实现模型列表/能力检查和显式兼容模型选择 | 默认 `gpt-5.6-sol` 要求更高 CLI 的真实失败回归；显式兼容模型成功且错误可操作 |
| C07-F08 | 建立真实 App Server 协议烟测 | 自动完成 initialize→thread/start→turn/start→message delta→turn/completed，并保存结构化证据 |

## C08 Session/Thread、Run/Turn 执行映射（8 项）

| ID | 功能点 | 测试与验证 |
| --- | --- | --- |
| C08-F01 | 新 Session 首次执行时创建 Codex Thread 并原子保存 Binding | 注入保存前/后故障，最终只有一个有效绑定或进入可恢复未知状态 |
| C08-F02 | 已绑定 Session 使用 thread/resume 恢复历史 | Desktop/Runtime 重启后继续相同 Session，Codex Thread ID 和历史保持一致 |
| C08-F03 | Thread cwd 只能来自 Runtime Registry 的 canonical Workspace path | 客户端/模型伪造 cwd 被忽略或拒绝；Thread 返回路径与 Workspace Handle 一致 |
| C08-F04 | 创建 Run 时调用 turn/start 并原子保存 Run/Turn Binding | 正常响应、响应丢失、超时和重复 idempotency key Fixture 不产生重复产品 Run |
| C08-F05 | Agent Definition 映射 model、instructions、personality 和 policy | 两个精确版本产生确定配置；不支持字段返回 capability 错误而非静默忽略 |
| C08-F06 | Codex Thread/Turn ID 仅作为 Backend metadata | Runtime Session/Run/Event ID 不被 Codex ID 替代；Desktop API 不接受客户端提交 Codex ID |
| C08-F07 | 多 Workspace、多 Session 和并发 Turn 完全隔离 | 至少 10 Workspace、每个 2 Session 并发执行；cwd、Thread、Turn、Event、Approval 不串线 |
| C08-F08 | Turn 终态映射到 Runtime Run result | completed/failed/interrupted 四类真实或受控 Fixture；Run result、时间戳和错误模型一致 |

## C09 Event 映射、持久化与恢复（8 项）

| ID | 功能点 | 测试与验证 |
| --- | --- | --- |
| C09-F01 | 映射 turn/started、Agent message delta 和 turn/completed | 真实 App Server 流式烟测断言内容、顺序和终态完整 |
| C09-F02 | 映射 item started/completed、命令、文件变化和工具输出 | Schema Fixture 覆盖已支持 Item 类型；Runtime Event type 和 Backend metadata 正确 |
| C09-F03 | Runtime Event Store 生成权威 event_id 和单调 sequence | Codex 不同 Item ID/通知乱序下，Runtime sequence 连续且无重复 |
| C09-F04 | 使用稳定 Backend event key 去重 | 重放相同通知、重连重叠页和重复 completed，最终每个逻辑 Event 只出现一次 |
| C09-F05 | Desktop 断线后 Turn 继续且 Event 可补取 | Turn 中关闭 Renderer/Desktop 订阅，重连后 after_sequence 获得完整结果 |
| C09-F06 | Runtime 重启后读取 Binding、Thread/Turn 状态并确定性收敛 Run | completed 可恢复；in-progress/unknown 根据已声明策略恢复或标记 backend_interrupted，不重复 prompt |
| C09-F07 | 未知 Codex Notification/Item 保存安全摘要 | 升级 Fixture 添加未知类型，Run 不崩溃且生成 `agent.item.unknown`，payload 通过脱敏 |
| C09-F08 | Event 流具备背压、批量和内存上限 | 大量 delta/命令输出压力测试；无无限队列，内容按策略合并/截断并保留显式标记 |

## C10 Auth、Permission、Approval、Cancel 与 Audit（8 项）

| ID | 功能点 | 测试与验证 |
| --- | --- | --- |
| C10-F01 | Codex Adapter 读取 account 状态并映射未登录/ChatGPT/API key 等状态 | Logged in/Not logged in/过期/刷新失败 Fixture；不向 Desktop 返回原始凭据 |
| C10-F02 | Desktop 通过 Runtime 发起登录、取消和登出 | 本地浏览器/设备码流程 E2E；授权码和 Token 不写入仓库、Event、日志和证据 |
| C10-F03 | Codex 操作继承 Workspace Permission 与远端/本地 OS 权限 | owner/editor/viewer/denied 矩阵覆盖读、写、命令、Git 和 Run；不得提权绕过 |
| C10-F04 | Codex Command/File/Patch Server Request 接入 Runtime Approval | 同意、拒绝、超时三条路径，原 JSON-RPC Server Request 恰好完成一次 |
| C10-F05 | Permission 固定先于 Approval | 无写权限请求直接拒绝，Approval 计数不增加；有权限才创建 Approval |
| C10-F06 | Run cancel 映射到 turn/interrupt 并等待一致终态 | running、waiting_approval、已完成和连接丢失 Fixture；重复 cancel 幂等 |
| C10-F07 | 未决 Approval 和 cancel_requested 在重启后确定性恢复 | Adapter/Runtime 重启测试无永久 waiting_approval、无误执行、无重复响应 |
| C10-F08 | 完整 Audit 与 Secret redaction | 每个敏感操作关联 principal/runtime/workspace/session/run/backend/turn/operation/correlation ID；Secret canary 扫描零泄漏 |

## C11 Desktop 产品集成与兼容迁移（8 项）

| ID | 功能点 | 测试与验证 |
| --- | --- | --- |
| C11-F01 | 添加 Workspace 仍只显示本地/远程，不增加 Codex Workspace 顶层类型 | Renderer 快照、可访问性树和打包应用截图只有两个运行位置入口 |
| C11-F02 | Agent Definition/Backend 选择与 Runtime Location 分离 | 同一 Local Workspace 切换 OpenDrSai/Codex Agent Definition，Workspace ID 不变、Backend 路由变化 |
| C11-F03 | Codex Backend 状态、版本、安装和登录以 Runtime capability 展示 | 可用/未安装/版本不兼容/未登录/故障五类 UI Fixture，有明确修复动作 |
| C11-F04 | 复用现有 Session/Run/Chat UI 展示 Codex 流式结果 | message delta、Item、工具、文件变化和终态渲染测试；无 Codex 专用聊天数据模型 |
| C11-F05 | 复用现有 Approval Center | 命令/文件/patch 审批展示 Workspace、operation、reason 和风险；决定回传正确 Run |
| C11-F06 | 复用现有 Run Cancel、重试和错误 UI | cancel/失败/未登录/模型不兼容/Backend 崩溃 E2E；重试不复用未知 idempotency key |
| C11-F07 | 旧 Local Workspace/Session 数据无损兼容 | 真实旧数据 Fixture 升级后仍可用 OpenDrSai Backend；选择 Codex 时新增 Binding 而不改写历史 ID |
| C11-F08 | Desktop 不包含 Codex JSON-RPC、进程和凭据逻辑 | 模块所有权扫描、IPC 合约和打包产物检查；Renderer/Main 只能调用 RuntimeClient |

## C12 测试、打包、发布与 Remote-ready 门禁（8 项）

| ID | 功能点 | 测试与验证 |
| --- | --- | --- |
| C12-F01 | Python/TypeScript 单元、类型和覆盖率门禁 | Agent Backend、OWOP、Adapter、Binding、UI 测试零失败、零意外 skip；新增核心代码达到约定覆盖率 |
| C12-F02 | OWOP、Runtime Protocol、Codex Schema 生成与 drift 门禁 | 重生成零差异；修改必需 operation/App Server 字段但不更新 Adapter 时 CI 失败 |
| C12-F03 | Fake Codex App Server 集成门禁 | 覆盖乱序响应、未知通知、审批、EOF、超时、崩溃、重连和 stderr；无悬挂 Future/进程 |
| C12-F04 | 真实 Windows Codex CLI/App Server 烟测 | 登录测试账号下完成 CLI 只读 Turn和 App Server Thread/Turn/Event；默认模型不兼容回归用例通过 |
| C12-F05 | OWOP Local 合规与多 Workspace E2E | InProcess/Local IPC 同套合规测试；10 Workspace Files/Git/Process/PTY/Checkpoint/Codex 隔离通过 |
| C12-F06 | Windows 本机隔离安装和本地产品 E2E | 使用独立 InstallRoot、DRSAI_HOME 和测试 Workspace，仅凭打包制品完成 Desktop/Runtime/Codex 安装；真实登录后完成 Local Workspace、Codex Run、Approval、Cancel 和恢复 |
| C12-F07 | 故障注入、性能、长稳和安全证据 | Runtime/Codex/pipe 故障、100/100 重连、长 Turn、事件压力、进程清理和 Secret 扫描通过 |
| C12-F08 | Remote-ready 平台抽象门禁 | Windows 实现不得渗入领域 Schema；Fake Linux Binary/Path/IPC Provider 通过同一契约，未来 Linux 只新增平台实现和 SSH Connection |

## 4. 开发阶段与依赖

| 阶段 | 模块 | 交付结果 | 进入下一阶段条件 |
| --- | --- | --- | --- |
| L0 架构冻结 | C01、C02 | 统一领域模型、AgentBackend 契约、路由和共置约束 | OpenDrSai Backend 回归与无回落测试通过 |
| L1 本地 Runtime 与 Workspace | C03、C04、C05 | Local RuntimeConnection、OWOP Schema 和 Local Binding | Local Workspace 全部 OWOP operation 合规测试通过 |
| L2 Codex 连接基础 | C06、C07 | 受管 Codex 制品、App Server 生命周期和 JSON-RPC | 真实 initialize/Thread/Turn 烟测通过 |
| L3 执行与恢复 | C08、C09 | Session/Thread、Run/Turn、Event Store 和恢复 | Desktop 断线、Runtime 重启和多 Workspace 隔离通过 |
| L4 安全与产品 | C10、C11 | Auth、Approval、Cancel、Audit 和 Desktop UI | 安全矩阵、登录和打包 UI E2E 通过 |
| L5 发布交付 | C12 | 干净安装、真实 Codex、故障注入和 Remote-ready 门禁 | 96/96 功能点关闭，无 P0/P1 缺陷 |

不得绕过 C03-C05 直接让 Codex Adapter 使用绝对路径或直接文件系统实现完整产品功能；否则未来 Remote Workspace 将无法复用同一 OWOP 契约。

## 5. 强制验收拓扑

### 5.1 本地产品验收

```text
Windows Host（验收控制器）
├─ 只读 PackageDir
├─ 可写 EvidenceDir
└─ 隔离的本机验收目录
   ├─ 独立 InstallRoot
   ├─ 独立 DRSAI_HOME
   ├─ Packaged OpenDrSai Desktop
   ├─ Windows Local Full Agent Runtime
   ├─ Managed Codex CLI/App Server
   └─ Local Test Workspaces
```

验收拆成两段：

1. **隔离安装段**：使用全新的 InstallRoot、DRSAI_HOME 和 Workspace，仅使用签名 Desktop、Runtime 和 Codex 制品完成安装、版本/摘要校验和 Local Runtime 启动；安装解析不得依赖 PATH、全局 npm Codex 或现有 Workspace 状态；
2. **在线功能段**：仅在登录和真实模型 Turn 所需范围使用网络，使用测试账号完成 Codex Auth、Thread/Turn、Event、Approval 和 Cancel；测试结束清理临时状态并扫描证据。

Windows Sandbox 不属于本方案的强制验收环境。已有 Sandbox 脚本可以保留为可选诊断工具，但不得作为功能点关闭、构建通过或发布交付的必要条件。不得把 npm 全局安装、Codex Desktop 内置二进制或 PATH 中的 Codex 当作受管制品安装成功的证据；真实账户状态仅可用于在线功能段，不得参与制品解析和信任校验。

### 5.2 Remote-ready 契约验收

本期不交付 Linux Codex，但必须使用平台 Fixture 验证：

```text
RuntimeConnection
├─ LocalRuntimeConnection（真实 Windows）
└─ SshRuntimeConnection（已有远程工作区实现/Fixture）

CodexBinaryProvider
├─ WindowsManagedCodexProvider（真实）
└─ FakeLinuxCodexProvider（契约）

CodexProcessTransport
├─ WindowsStdioTransport（真实）
└─ FakeUnixSocketTransport（契约）

WorkspaceOperationsClient
├─ Local Binding（真实）
└─ SSH Runtime Binding（已有实现/合规套件）
```

Remote-ready 只证明架构和契约未绑定 Windows，不计为 Linux Codex 产品交付完成。

## 6. 非功能指标

| 指标 | 本地 V1 门槛 |
| --- | --- |
| Local Runtime 握手 | 启动后 3 秒内完成，P95 |
| 已安装 Codex Backend 健康检查 | 2 秒内完成，P95 |
| Workspace 打开 | 2 秒内完成，P95 |
| 首个 Agent message delta | turn/start 成功后 5 秒内出现，排除模型上游排队，P95 |
| Event 展示延迟 | Runtime 写入到 Desktop 展示小于 300 ms，P95 |
| Event 可靠性 | 重连后零丢失；按 event_id 去重后零重复 |
| 文件树 | 10 万文件首屏 2 秒内返回，使用分页和截断 |
| 大文件 | 不一次性加载超过协议上限；分块读取内存有界 |
| 多 Workspace | 一个 Local Runtime 稳定管理至少 100 个注册 Workspace |
| 并发隔离 | 至少 10 个活跃 Workspace 的 Thread/Turn/Event/Approval 不串线 |
| 长运行 | Desktop 断线 30 分钟后可读取 Run/Turn 终态和完整 Event |
| 稳定性 | 1 小时无 Runtime/Codex/PTY/pipe 句柄持续增长 |
| 安全 | 日志、Event、数据库、诊断包和证据 Secret 扫描零泄漏 |
| 安装 | 全新隔离 InstallRoot/DRSAI_HOME 中仅凭打包输入完成 Desktop + Runtime + Codex 制品安装 |

## 7. 最终用户验收流程

1. 创建全新的隔离 InstallRoot、DRSAI_HOME 和测试 Workspace；
2. 仅从打包输入安装 Desktop、Local Runtime 和受管 Codex 制品，确认解析结果不来自 PATH 或 npm 全局安装；
3. 启动 Desktop，Local Runtime 完成 handshake/capabilities；
4. 添加两个 Local Workspace，确认获得不同 workspace_id；
5. 选择 `backend=codex` 的精确版本 Agent Definition；
6. UI 显示 Codex 受管版本、Schema 兼容状态和登录状态；
7. 完成测试账号登录，或验证隔离在线功能阶段可读取的既有测试登录；
8. 创建 Session，Codex Adapter 创建并绑定 Thread；
9. 创建 Run，Codex Adapter 创建 Turn，UI 显示流式消息和 Item；
10. 触发只读 Workspace 操作，确认经过 OWOP Local Binding；
11. 触发文件写入、命令和 patch 审批，分别验证同意、拒绝和超时；
12. 运行中关闭 Desktop 订阅，重新打开后查看完整 Event 和终态；
13. 创建长 Turn 并显式 Cancel，确认调用 turn/interrupt 且 Run 进入 cancelled；
14. 终止 Codex App Server 和 Local Runtime，验证错误区分、受控恢复和不重复 Turn；
15. 在两个 Workspace 并发运行，确认 cwd、Thread、Turn、Event、Approval 和文件变化不串线；
16. 切换 OpenDrSai Agent Backend，确认既有行为无回归且 Codex 失败不触发回落；
17. 导出日志、Event、数据库摘要和诊断包，Secret 扫描零泄漏；关闭验收进程并确认 Runtime、Codex、PTY、pipe 和临时状态全部清理。

上述流程、全部自动化门禁和 **96/96 功能点**通过后，Windows 本地 Codex Workspace V1 才能标记完成。Linux 远程 Codex Workspace 作为下一阶段，必须复用本文冻结的 Runtime Protocol、OWOP、AgentBackend 和 Codex Adapter 语义，不得另建一套产品领域模型。

## 8. 当前预研基线与已知风险

截至 2026-07-16，开发机已验证：

- Windows 本机 `codex-cli 0.142.5` 可以启动；
- `codex login status` 显示当前开发用户通过 ChatGPT 登录；
- 显式模型 `gpt-5.4` 的最小只读 CLI Turn 成功；
- App Server 完成 initialize、thread/start、turn/start、Agent message delta 和 turn/completed；
- Node 在 Windows 直接 spawn Codex 执行别名可能返回 EPERM，平台 Process Provider 必须处理受管 exe/启动包装；
- 用户默认模型 `gpt-5.6-sol` 对当前 CLI 返回“需要更新 Codex”，因此 Adapter 必须做模型/CLI 能力检查，不能盲信默认配置；
- Linux x64 独立 Codex 二进制可以无 Root 安装到普通用户目录，但远程认证和真实 Turn 尚未作为产品交付验证。

这些结果是预研证据，不替代 C12 的干净环境、固定制品和专用测试账号验收。
