# OpenDrSai Android 远程工作区开发方案 V1

> 架构基线：[OpenDrSai 总体架构 V1](../OpenDrSai总体架构V1.md)  
> 远程工作区基线：[OpenDrSai 远程工作区实现方案 V1](../remote_workespace/OpenDrSai远程工作区实现方案V1.md)  
> Codex 基线：[OpenDrSai Codex 工作区开发方案 V1](../remote_workespace/OpenDrSaiCodex工作区开发方案V1.md)  
> 界面方案：[Android 远程工作区界面方案 V1](./ANDROID_REMOTE_WORKSPACE_UI_DESIGN_V1.md)  
> 文档状态：已完成，三项产品架构决策已冻结  
> 统计口径：共 **12 个模块、96 个功能点**；当前验收范围 **96 项，全部完成**  
> 更新日期：2026-07-19

## 1. 目标与完成定义

Android 远程工作区是在现有 OpenDrSai 统一架构中，为 Android Lite Agent Runtime 增加委托 Full Agent Runtime 的移动端连接能力。它不创建新的 Workspace、Agent 或 Session 体系，也不把 Codex 暴露为 Android 专用服务。

用户在 Android 登录 HAI 后，可以访问已经注册且已获授权的 Full Agent Runtime 和 Workspace，查看历史 Session、创建 Run、接收流式事件、发送后续指令、取消任务、处理 Approval，并只读查看文件、Git Diff 和 Artifact。

完成 Android 远程工作区 V1 必须同时满足：

1. Android、Relay 和 Full Runtime 使用统一的 Runtime、Workspace、Session、Run、Event 和 Approval 对象；
2. Android 通过 Relay 连接 Full Runtime，不保存 SSH 私钥，也不负责 Runtime 安装和升级；
3. Runtime Client 和 UI 保持 Backend 无关；OpenDrSai 与 Codex Agent Backend 均完成真实 E2E；
4. Full Runtime 始终是 Run、Event、Checkpoint 和 Workspace 状态的权威来源；
5. 断网、切后台和进程重建后能够补取事件，不重复创建 Run；
6. 只读 Workspace 能力经过 OWOP Relay Binding，不出现 Android 私有文件协议；
7. 96 个功能点均具备实现、自动化测试和验收证据；
8. 使用 Android 模拟器矩阵与可重复的受控环境完成端到端验收，不将真机测试作为当前发布门禁；
9. 真实 OpenDrSai Full Runtime/Backend 固定使用本仓库 `apps/desktop/windows`，不使用另外搭建的 Backend Fixture 替代最终 E2E。

### 1.1 当前验收范围修订（2026-07-19）

- 移除所有真机强制验收项；多设备、Android 版本、网络变化和进程恢复由模拟器/受控客户端矩阵覆盖。
- Codex 真实 Backend E2E 已完成；M11-F03 纳入本次 96 项验收。
- OpenDrSai 真实 E2E 的 Full Runtime 及 Agent Backend 以本仓库 `apps/desktop/windows` 为唯一验收实现。

## 2. 已冻结的三项架构决策

### ADR-ARW-001：Android 使用 Relay，不直接使用 SSH

Android 只使用 HAI OIDC、HTTPS、SSE 和必要的受控流式通道访问 Relay。Runtime 主动建立到 Relay 的出站连接，不要求远端主机开放公网端口。

禁止事项：

- 不在 Android 保存 SSH 私钥、`known_hosts` 或 SSH Agent 状态；
- 不在 Android 实现 Runtime 安装、升级、回滚、端口转发或 ProxyJump；
- 不因 Relay 不可用而静默改用 SSH、Desktop 代理或本地 Runtime 执行同一个远程 Run。

### ADR-ARW-002：V1 只连接已注册的 Runtime 和 Workspace

Runtime 注册、安装和 Workspace 首次打开由 Desktop、Web 管理端或 Runtime CLI 完成。Android V1 只发现和连接当前 HAI 用户已经获得访问权限的 Runtime/Workspace。

Android 可以扫描“关联已有计算机”二维码，但该二维码只包含由已注册 Runtime/管理端生成的一次性 Access Grant Code，用于向当前 HAI 账户授予或确认访问权。它不负责首次注册 Runtime，也不包含 IP、SSH 信息或长期凭据。

Android 不接受用户输入 hostname、SSH 地址或远端绝对路径来创建 Workspace，也不自行生成权威 `runtime_id` 或 `workspace_id`。

### ADR-ARW-003：V1 为“聊天控制 + 只读工作区”

Android V1 支持 Session、Run、Event、Cancel、Approval、只读文件、Git 状态/Diff 和 Artifact。以下能力延期：

- 文件写入、移动和删除；
- Git stage、unstage、revert、commit 和 push；
- Process/PTY 交互终端；
- Checkpoint restore/accept；
- Worktree 创建和删除；
- Runtime 安装、升级、回滚和维修。

Approval 仍然必须支持，因为 Agent 在远端执行时可能请求文件修改或命令权限；“只读工作区”限制的是 Android 直接操作入口，不代表 Agent 永远只能读取 Workspace。

## 3. 总体架构

```text
OpenDrSai Android
├─ Chat / Workspace UI
├─ Embedded Lite Agent Runtime
└─ Runtime Client
   ├─ Local Lite Execution
   └─ RelayRuntimeConnection
              │
              │ HAI OIDC + HTTPS / SSE
              ▼
       HepAI Workspace Relay
              ▲
              │ Full Runtime 主动建立出站连接
              │
OpenDrSai Full Agent Runtime
├─ Gateway / Runtime Protocol
├─ Session / Run / Event Runtime Engine
├─ Workspace Registry
├─ Agent Core
│  ├─ OpenDrSai Agent Backend
│  └─ Codex Agent Backend
│     ├─ Codex Adapter
│     └─ Codex App Server
└─ OWOP WorkspaceOperationsService
   └─ Workspace
```

统一连接抽象为：

```text
RuntimeConnection
├─ LocalRuntimeConnection
├─ SshRuntimeConnection
└─ RelayRuntimeConnection
```

统一 Workspace Binding 为：

```text
OWOP Binding
├─ InProcess Binding
├─ Local IPC Binding
├─ SSH Runtime Binding
├─ HepAI IF Binding
└─ Relay Binding
```

Relay 可以使用 HepAI/DDF 的发现、路由或 Worker 基础设施，但 Relay、DDF 和 HepAI Worker 均不成为 Runtime 状态的权威来源。

## 4. 状态权威与安全边界

| 数据 | 权威来源 | Android 行为 |
| --- | --- | --- |
| Identity / Organization | HepAI Platform Services | 保存加密 Token 和只读身份投影 |
| Runtime 在线状态 | Runtime + Relay 当前连接 | 缓存最后状态并显示可能过期 |
| Workspace Registry | Full Runtime | 只保存 `runtime_id/workspace_id` 引用 |
| Session 元数据 | 管理该 Session 的 Full Runtime | 分页缓存，不自行改写远端事实 |
| Run / Event / Checkpoint | 执行 Run 的 Full Runtime | 保存非权威投影和最后 sequence |
| Workspace Files / Git | Workspace 所在机器 | 通过只读 OWOP operation 获取 |
| Codex Thread / Turn / Item | Codex App Server | Android 不可见其私有 ID |
| Permission / Approval / Audit | Full Runtime / Governance | Android 仅提交用户决定 |

安全顺序固定为：

```text
HAI Identity
→ Relay Authentication
→ Runtime Principal
→ Workspace Permission
→ Runtime Policy
→ Approval（必要时）
→ Workspace Operation
→ Audit + Event
```

## 5. 模块与功能点统计

| 模块 | 名称 | 功能点数 | 主要交付物 |
| --- | --- | ---: | --- |
| M01 | 架构、领域模型与产品边界 | 8 | 统一对象、委托模型、边界门禁 |
| M02 | Relay Runtime Protocol 与 Schema | 8 | Relay Binding、事件和错误契约 |
| M03 | Runtime 注册、发现与连接 | 8 | 出站连接、目录、吊销和多 Runtime 隔离 |
| M04 | 身份、票据、权限与安全存储 | 8 | OIDC、短期票据、Principal 和脱敏 |
| M05 | Android 本地数据与非权威缓存 | 8 | Room 迁移、远程引用、游标和账户隔离 |
| M06 | Runtime、Workspace 与 Session 体验 | 8 | 远程入口、列表、状态和 Session 管理 |
| M07 | Run、聊天与流式 Event | 8 | 创建、流式展示、取消、补取和幂等 |
| M08 | Approval、用户决策与 Audit 投影 | 8 | 审批卡片、拒绝、超时和重复响应治理 |
| M09 | 只读 Files、Git 与 Artifact | 8 | 文件树、预览、搜索、Diff 和结果文件 |
| M10 | 移动网络、后台与可靠性 | 8 | 网络切换、恢复、实例变化和资源控制 |
| M11 | Backend 无关兼容与 OpenDrSai/Codex 验收 | 8 | Backend 无关客户端及两种真实 Backend E2E |
| M12 | 自动化、模拟器、构建与发布验收 | 8 | 测试矩阵、证据、Beta 和发布门禁 |
|  | **合计** | **96** |  |

## 6. 详细功能点与验收条件

### M01 架构、领域模型与产品边界（8 项）

- [x] **M01-F01** Android 复用 `runtime_id/workspace_id/session_id/run_id/event_id/approval_id`，不得创建 Mobile 专用领域 ID；契约往返测试逐字段一致。
- [x] **M01-F02** Lite Runtime 委托只保存远程引用和非权威缓存；测试证明本地状态不能推进远端 Run 状态机。
- [x] **M01-F03** 新增 `RelayRuntimeConnection` 并实现统一 Runtime Client；Local、SSH Fixture 和 Relay 对公共 operation 运行同一契约套件。
- [x] **M01-F04** 新增 OWOP Relay Binding；operation、请求、响应、错误和 Event 与现有 OWOP Schema 一致。
- [x] **M01-F05** OpenDrSai/Codex 只作为 Agent Backend metadata，Android 不新增 Codex Workspace 类型或 Codex 私有连接。
- [x] **M01-F06** Run 创建后 `runtime_id/workspace_id/session_id/backend_id` 不可变；跨 Runtime 或 Workspace 篡改返回结构化错误。
- [x] **M01-F07** Remote 失败时不回落到本地 Lite Runtime、其他 Runtime 或其他 Backend；负向测试确认替代执行调用数为零。
- [x] **M01-F08** 三项 ADR 转换为代码、Schema 和 UI 静态门禁，禁止 SSH、首次注册和直接写操作入口进入 Android V1。

### M02 Relay Runtime Protocol 与 Schema（8 项）

- [x] **M02-F01** Relay 协议采用 Schema-first，从 Runtime Protocol/OWOP 单一来源生成 Kotlin、Python 和服务端类型。
- [x] **M02-F02** 通过 Relay 完成 `/v1/runtime` 与 `/v1/capabilities` 等价握手，核验 protocol version、runtime_id、instance_id 和 capabilities。
- [x] **M02-F03** 定义 Runtime/Workspace 发现资源及分页游标；Relay 不接受客户端提供 canonical path 或权威权限字段。
- [x] **M02-F04** 所有控制请求包含 request_id、correlation_id，创建类请求包含 idempotency key，并可查询不确定结果。
- [x] **M02-F05** 统一错误至少包含 `code/message/correlation_id/retryable/details`，Relay 不把传输异常伪装成 Runtime 业务错误。
- [x] **M02-F06** Run/Workspace Event 保留 event_id、sequence、resource identity 和 timestamp，支持 `after_sequence`/cursor 续传与去重。
- [x] **M02-F07** 大文件通过受认证的分块 Raw Stream 传输，支持 offset、length、digest、取消和大小上限，不进入 JSON Base64 主链路。
- [x] **M02-F08** CI 执行 Schema/OpenAPI 重新生成零差异、破坏性变更检测和 capability drift 门禁。

### M03 Runtime 注册、发现与连接（8 项）

- [x] **M03-F01** Desktop/Web/CLI 完成 Runtime 首次注册；Android 扫描的一次性 Access Grant Code 只能关联已注册 Runtime，注册码与关联码分离，且均短期、单次有效。
- [x] **M03-F02** Runtime 生成设备密钥并安全保存，Relay 只保存公钥或等价验证材料；密钥轮换和重放测试通过。
- [x] **M03-F03** Full Runtime 主动建立 Relay 出站连接，默认不新增公网监听端口；NAT/防火墙测试拓扑可连接。
- [x] **M03-F04** Runtime 心跳和连接代次驱动 online/degraded/offline 状态，Relay 超时不会把正在运行的 Run 标记失败。
- [x] **M03-F05** 稳定 runtime_id 与每次启动变化的 instance_id 均通过 Relay 暴露；重启后 Android 可识别实例变化。
- [x] **M03-F06** Android 只能列出当前用户/组织有权限的 Runtime 和已注册 Workspace，分页、搜索和空状态测试通过。
- [x] **M03-F07** 两个 Runtime 即使拥有相同 canonical path，也不会串 Workspace、Session、Event、Approval 或缓存。
- [x] **M03-F08** 管理端可吊销 Runtime 注册；吊销后新连接和既有票据均在规定时间内失效，并产生 Audit。

### M04 身份、票据、权限与安全存储（8 项）

- [x] **M04-F01** 复用 Android 现有 HAI OIDC Authorization Code + PKCE，不新增远程工作区账号密码。
- [x] **M04-F02** Relay 为访问签发短期票据，绑定 subject、organization、runtime、workspace、scope、expiry、jti 和 device/session context。
- [x] **M04-F03** OIDC Token 和 Relay 凭据使用 Android Keystore 支持的加密存储，不进入 Room、URL、日志或诊断包。
- [x] **M04-F04** Runtime Principal 只能由已认证连接和票据构造；客户端提交的 user、role、canonical path 和 permission 被忽略或拒绝。
- [x] **M04-F05** Runtime 对每个 Workspace/Session/Run/OWOP 请求重新落实 Permission，Relay 授权不能替代 Runtime 权限判断。
- [x] **M04-F06** Access Token 401 只允许一次受控刷新与请求重放；票据过期、吊销和时钟偏差具有明确错误。
- [x] **M04-F07** Android、Relay、Runtime 的日志和错误执行 Secret redaction；Token、Cookie、授权码、文件正文和 Codex 凭据扫描为零泄漏。
- [x] **M04-F08** 退出登录或切换账户后断开订阅、清理票据和账户缓存；另一账户无法恢复前一账户的远程引用。

### M05 Android 本地数据与非权威缓存（8 项）

- [x] **M05-F01** 定义 RemoteRuntime、RemoteWorkspaceRef、RemoteSessionRef、RemoteRunRef、RemoteEventCursor 和 PendingApproval 投影模型。
- [x] **M05-F02** Room 从当前版本无损升级，新增远程引用、连接状态、capabilities snapshot 和 last_sequence 表/字段。
- [x] **M05-F03** 所有远程缓存按 HAI subject/organization 隔离，复合唯一约束阻止跨账户覆盖。
- [x] **M05-F04** 缓存显式保存 `authoritative=false/last_synced_at`，UI 能区分实时、正在同步和可能过期状态。
- [x] **M05-F05** 每个 Run/Workspace resource 独立保存 sequence/cursor，事务性提交 Event 与 cursor，崩溃后不跳过未入库事件。
- [x] **M05-F06** Event 按 event_id 去重；重复、乱序、缺口和跨 Run Event 均有确定性处理。
- [x] **M05-F07** 离线时只允许查看已缓存历史，发送、审批和控制按钮禁用并显示非权威状态，不建立离线 Run outbox。
- [x] **M05-F08** 覆盖数据库迁移、降级拒绝、损坏恢复、账户切换、进程死亡和缓存 TTL/容量清理测试。

### M06 Runtime、Workspace 与 Session 体验（8 项）

- [x] **M06-F01** 在侧栏增加“远程工作区”入口，不与当前“平台智能体”列表混合，也不暴露 Relay/Gateway 内部术语。
- [x] **M06-F02** Runtime 卡片展示名称、在线状态、版本、最近连接和可操作错误，不显示敏感主机连接信息。
- [x] **M06-F03** Workspace 列表支持分页、搜索、刷新和最近使用排序，只使用 Runtime 返回的 workspace_id。
- [x] **M06-F04** Workspace 页面展示 Runtime/Backend/Files/Git/Artifact 等 capability；未声明功能在 UI 禁用而非失败后回落。
- [x] **M06-F05** 按 Workspace 分页加载、搜索和恢复 Session，历史不与本地聊天或平台 Agent 会话串线。
- [x] **M06-F06** 创建 Session 必须绑定所选 Workspace 和精确 Agent Definition；请求超时后先按幂等键查询。
- [x] **M06-F07** Session 列表展示标题、Backend、最后 Run 状态和更新时间，并正确处理 archived/deleted/permission_lost。
- [x] **M06-F08** 快速切换两个 Runtime/Workspace 时，消息、Event、Approval、文件树和顶部标题保持身份隔离。

### M07 Run、聊天与流式 Event（8 项）

- [x] **M07-F01** 从 Full Runtime 获取精确版本 Agent Definition 和 Backend health，禁止客户端使用 `latest` 或自行构造 Backend。
- [x] **M07-F02** 创建 Run 使用稳定 Idempotency-Key；响应丢失时查询现有 Run，自动重试不会产生第二个远程任务。
- [x] **M07-F03** 发送文字和现有附件引用时保持 Session/Workspace/Runtime 绑定，Android 本地路径不得进入远程 Run 请求。
- [x] **M07-F04** SSE Event 映射覆盖 queued、started、message delta、tool、workspace change、approval、artifact 和终态。
- [x] **M07-F05** 聊天界面统一展示 OpenDrSai/Codex 的消息、工具和进度，不显示 thread_id、turn_id 或 Codex JSON-RPC。
- [x] **M07-F06** completed/failed/cancelled 只能由 Runtime Event/状态查询收敛；网络断开显示“任务可能仍在运行”。
- [x] **M07-F07** Cancel 映射到 Runtime Run cancel，重复取消幂等；Codex 由远端 Adapter 转换为 `turn/interrupt`。
- [x] **M07-F08** 重新进入 Session 后按 last_sequence 补取完整 Event；失败后的“重试”创建显式新 Run，不伪装成原 Run 续跑。

### M08 Approval、用户决策与 Audit 投影（8 项）

- [x] **M08-F01** Approval 卡片显示 Runtime、Workspace、Agent、Backend、operation、风险摘要、范围和过期时间。
- [x] **M08-F02** Permission 失败直接拒绝且不创建 Approval；Android 只能看到 Runtime 已创建的 approval_id。
- [x] **M08-F03** 支持同意、拒绝和取消输入，响应通过一次性 approval_id 与 Run/Workspace 绑定。
- [x] **M08-F04** 重复点击、响应超时和网络重放保持幂等，另一设备已处理时显示权威最终决定。
- [x] **M08-F05** Approval 超时、Runtime 重启和 Backend 中断具有确定性终态，不永久停留在“等待审批”。
- [x] **M08-F06** Android 切后台不自动批准或拒绝；恢复后重新查询未决 Approval 并校验是否仍有效。
- [x] **M08-F07** 对命令、文件修改、patch、Git 写操作和用户输入请求使用不同风险展示，危险参数经过脱敏和长度限制。
- [x] **M08-F08** UI 可查看当前 Run 的 Audit 摘要和 correlation_id；完整 Audit 仍由 Runtime/Governance 保存且不可由 Android 修改。

### M09 只读 Files、Git 与 Artifact（8 项）

- [x] **M09-F01** 通过 OWOP `files.list` 展示按需展开的文件树，支持分页、深度限制、忽略规则和截断提示。
- [x] **M09-F02** 文件节点显示相对路径、类型、大小、修改时间和 Git 状态，不以客户端路径拼接访问文件。
- [x] **M09-F03** 通过 `files.stat/files.read` 显示有界文本、图片或二进制摘要；不支持格式提供系统打开/下载选项。
- [x] **M09-F04** 大文件使用分块读取、取消、digest 校验和有限缓存，内存峰值不随文件总大小线性增长。
- [x] **M09-F05** 通过 `files.search` 执行服务端搜索，支持分页、超时、截断和结果定位，不把整个 Workspace 下载到手机。
- [x] **M09-F06** 通过 `git.status` 展示分支和结构化变更列表，只读页面不出现 stage/revert/commit 控件。
- [x] **M09-F07** 通过 `git.diff/git.file_at_ref` 展示有界 Diff 和基线内容，二进制、大 Diff 和 stale revision 明确提示。
- [x] **M09-F08** Artifact 支持元数据、受认证分块下载、SHA-256、取消、重试和 FileProvider 打开，跨用户/Workspace 引用被拒绝。

### M10 移动网络、后台与可靠性（8 项）

- [x] **M10-F01** 建立 connecting/online/degraded/offline/auth_required/incompatible 状态机，并区分 Relay、Runtime 和业务错误。
- [x] **M10-F02** Wi-Fi、移动网络、VPN 和短时断网切换只重建 Transport，不重复 Session、Run 或 Approval 响应。
- [x] **M10-F03** App 进入后台后不依赖永久 SSE 保持 Run；回到前台查询状态并从 last_sequence 补取。
- [x] **M10-F04** 进程被系统回收后可从 Room 恢复远程引用，重新认证、握手和订阅，不把缓存当成权威终态。
- [x] **M10-F05** instance_id 变化触发重新握手、capability 更新和活动 Run 状态核对，不错误复用旧连接代次。
- [x] **M10-F06** Event 缺口、cursor 过期和历史截断触发明确的全量状态恢复流程，不静默跳过事件。
- [x] **M10-F07** 采用指数退避、抖动、最大重试窗口和用户主动重连；认证/权限/协议错误不进入无限重试。
- [x] **M10-F08** 网络、数据库、文件和 Event 处理均不阻塞主线程；长 Run、10,000 Event 和多 Workspace 下资源有界。

### M11 Backend 无关兼容与 OpenDrSai 验收（8 项）

- [x] **M11-F01** Agent Definition 目录统一展示 Backend 名称、版本、health 和 capabilities，选择结果固定到 Session/Run。
- [x] **M11-F02** 使用本仓库 `apps/desktop/windows` 的真实 Full Runtime + OpenDrSai Agent Backend 完成远程 Session、Run、Tool、Approval、Artifact 和恢复 E2E。
- [x] **M11-F03** 使用真实 Full Runtime + Codex Agent Backend 完成 Thread/Turn 映射后的相同 Android E2E；Codex 私有标识仅保留在 Runtime metadata。
- [x] **M11-F04** Codex threadId/turnId/itemId 只存在于 Runtime Backend metadata；Android API、Room 和日志扫描不得出现权威依赖。
- [x] **M11-F05** Codex 未登录、版本不兼容、App Server 死亡和 Schema 漂移映射为统一 Backend health/error，不触发 OpenDrSai fallback。
- [x] **M11-F06** OpenDrSai/Codex 的 message、tool、workspace change、approval、cancel 和 terminal Event 映射到同一 Android UI 模型。
- [x] **M11-F07** 同一 Workspace 的两个 Backend Session 并发运行时，Run、Event、Approval、Artifact 和缓存完全隔离。
- [x] **M11-F08** Backend 切换只能新建或使用绑定到该 Backend 的 Session，不支持在同一 Run 内切换或迁移私有上下文。

### M12 自动化、模拟器、构建与发布验收（8 项）

- [x] **M12-F01** Android JVM 单测覆盖领域模型、状态机、幂等、Event 去重/缺口、错误映射、票据和缓存策略。
- [x] **M12-F02** Runtime Protocol/OWOP/Relay Schema 合规测试分别运行于 Local、SSH Fixture 和 Relay Binding，并执行生成零漂移。
- [x] **M12-F03** Relay/Runtime 集成测试覆盖注册、发现、双 Runtime、双 Workspace、OIDC Principal、权限和出站重连。
- [x] **M12-F04** Android 仪器/Compose 测试覆盖入口、状态、Session、聊天、Approval、文件树、Diff、Artifact 和进程重建。
- [x] **M12-F05** 安全测试覆盖票据重放、跨用户/组织/Runtime/Workspace 引用、路径越界、Secret 泄漏和权限绕过。
- [x] **M12-F06** 故障注入覆盖 Relay 断开、Runtime 重启、响应丢失、Event 缺口、网络切换、后台回收和 Backend 崩溃。
- [x] **M12-F07** 使用至少两个独立 Android 模拟器/受控客户端实例覆盖 API 29/30 与 API 33+，完成网络切换、多客户端、后台回收和长 Run 验收；不要求真机。
- [x] **M12-F08** 本地开发环境 OpenDrSai/Codex Backend E2E、生产配置、R8 测试签名 APK、升级安装、SHA-256、Release Notes 与发布验收证据已完成；GitHub 资产同步属于外部发布操作，不影响本地功能验收。

## 7. 协议与连接生命周期

### 7.1 Runtime 注册

```text
1. Desktop/Web/CLI 请求一次性配对码
2. 用户使用 HAI 身份确认 Runtime 所属用户/组织
3. Runtime 生成设备密钥并提交公钥和 capabilities
4. Relay 返回稳定 registration_id
5. Runtime 使用设备凭据建立出站连接
6. Relay 验证 runtime_id、instance_id 和连接代次
7. Runtime 定期发送 heartbeat/capabilities
8. Android 的目录接口开始显示该 Runtime
```

### 7.2 Android 连接

```text
1. Android 完成 HAI OIDC 登录
2. 查询用户有权访问的 Runtime
3. 选择 Runtime 和已注册 Workspace
4. Relay 签发短期 scoped ticket
5. 通过 Relay 调用 Runtime identity/capabilities
6. Runtime 从票据建立 Principal 并再次检查 Permission
7. Android 加载 Session 和权威 Run 状态
8. 按 last_sequence 订阅 Event
```

### 7.3 Run 与恢复

```text
1. Android 生成 Idempotency-Key
2. Full Runtime 创建并持久化 Run
3. Agent Backend 在目标 Runtime/Workspace 执行
4. Runtime Event Store 生成 event_id + sequence
5. Relay 只中继 Event
6. Android 事务性保存 Event + last_sequence
7. 断线后 Run 继续
8. 重连后查询 Run 并使用 after_sequence 补取
```

请求超时发生在“Run 已创建、响应未到达”窗口时，Android 必须先按幂等键或权威查询确认，不得盲目再次提交。

## 8. 开发阶段与依赖

| 阶段 | 模块 | 交付结果 | 进入下一阶段条件 |
| --- | --- | --- | --- |
| P0 架构冻结 | M01 | 三项 ADR、统一对象和边界门禁 | 现有 Runtime/OWOP/Codex 回归通过 |
| P1 Relay 契约 | M02、M03 | Schema、注册、发现、出站连接和握手 | 双 Runtime/同路径隔离与重连通过 |
| P2 身份与数据 | M04、M05 | OIDC 票据、权限、本地投影和迁移 | 跨账户/重放/崩溃恢复测试通过 |
| P3 聊天控制 | M06、M07、M08 | Workspace/Session/Run/Event/Approval MVP | OpenDrSai Backend 开发环境 E2E 通过 |
| P4 只读工作区 | M09、M10 | Files/Git/Artifact 与移动可靠性 | OWOP 合规、网络切换和后台恢复通过 |
| P5 Backend E2E | M11 | Backend 无关流程 + `apps/desktop/windows` 真实实现 | OpenDrSai 与 Codex 真实 E2E 且无 fallback |
| P6 发布验收 | M12 | 模拟器矩阵、生产配置、APK 和发布证据 | 96/96 且无 P0/P1 缺陷 |

## 9. 测试与验收方案

### 9.1 自动化分层

| 层级 | 测试对象 | 必须覆盖 |
| --- | --- | --- |
| L1 单元测试 | Kotlin/Python/Relay 核心 | 状态机、幂等、票据、缓存、Event、错误和脱敏 |
| L2 Schema/契约 | Runtime Protocol、OWOP、Relay | 生成零漂移、破坏变更、capability、统一错误 |
| L3 Binding 合规 | Local、SSH Fixture、Relay | 同一 operation 的请求、响应、错误和 Event 语义 |
| L4 服务集成 | Relay + Full Runtime | 注册、OIDC、权限、连接代次、多 Runtime/Workspace |
| L5 Android 仪器测试 | 模拟器/受控设备 | Compose、Room、进程重建、网络状态和系统打开 |
| L6 E2E | Android → Relay → `apps/desktop/windows` | OpenDrSai、Codex、Approval、Cancel、Files/Git/Artifact |
| L7 故障与安全 | 全链路 | 断网、重启、响应丢失、越权、重放、泄漏和资源上限 |
| L8 模拟器与发布 | API 29/30 与 API 33+ 模拟器 | 网络切换、后台、长 Run、升级、签名和生产配置 |

### 9.2 强制验收拓扑

确定性自动化拓扑：

```text
Android Emulator / Instrumented Device
              │
              ▼
      Controllable Relay Fixture
              │
              ▼
  apps/desktop/windows Full Runtime
     ├─ Workspace A
     ├─ Workspace B
     └─ OpenDrSai Agent Backend
```

开发环境真实拓扑：

```text
Android Emulator
  → ai-dev.ihep.ac.cn / HAI OIDC
  → Development Workspace Relay
  → Registered apps/desktop/windows Full Runtime
      └─ OpenDrSai Agent Backend
  → Test Workspace
```

多客户端拓扑（可使用两个独立模拟器实例）：

```text
Android Client A ─┐
                  ├─ Relay ─ Runtime A ─ Workspace / Run
Android Client B ─┘

Android Client A ─ Relay ─ Runtime B ─ same canonical path text
```

必须证明同一 Run 的 Event 和 Approval 在多客户端实例间一致、重复响应幂等，并证明两个 Runtime 的相同路径不会串线。

### 9.3 功能验收场景

1. 使用 HAI 账号登录，看到当前账号已授权 Runtime，不看到其他账号 Runtime；
2. 选择两个不同 Runtime 中显示路径相同的 Workspace，身份和历史完全独立；
3. 使用本仓库 `apps/desktop/windows` 创建 OpenDrSai Backend Session，完成消息、Tool、Approval、Artifact 和终态；
4. 在受控网络注入下让 Run 经历断网/恢复并切后台，远程继续执行，返回后 Event 无缺失和重复；
5. 在 Run 创建响应丢失时恢复，确认只存在一个 Run；
6. Runtime 重启产生新 instance_id，Android 重新握手并恢复权威终态；
7. 查看 100,000 文件 Workspace 的首屏文件树、搜索、文本预览和大文件分块；
8. 查看 Git status、Diff 和 file-at-ref，确认无任何直接写操作入口；
9. 两个独立 Android 模拟器实例同时打开一个待审批 Run，一个批准后另一个显示已处理且不能重复执行；
10. Relay 断开时 UI 不把 running Run 标记 failed，也不回落到本地执行；
11. 退出账号后切换另一账号，前一账户缓存、票据和 Workspace 均不可访问。

### 9.4 非功能门槛

| 指标 | V1 门槛 |
| --- | --- |
| Runtime 目录加载 | Relay 已连接时 P95 小于 2 秒 |
| Runtime 握手 | P95 小于 2 秒 |
| Session 首屏 | P95 小于 2 秒，分页加载 |
| Event 展示延迟 | Runtime 写入到前台 Android 展示 P95 小于 500 ms |
| Event 可靠性 | 10,000 Event 补取后零缺失；按 event_id 去重后零重复 |
| Run 幂等 | 100 次响应丢失/重试故障注入零重复 Run |
| 文件树 | 100,000 文件 Workspace 首屏 P95 小于 2 秒，必须分页/截断 |
| 大文件 | 分块读取，Android 内存不随文件总大小线性增长 |
| 后台恢复 | 后台或断网 30 分钟后可恢复权威 Run 终态和完整 Event |
| 多客户端 | 两个独立模拟器实例的 Event/Approval 一致，无重复操作 |
| 稳定性 | 连续 1 小时无连接、协程、文件句柄或缓存持续增长 |
| 安全 | APK、日志、Room、Event、诊断包和证据 Secret 扫描零泄漏 |

## 10. 发布门禁

以下条件全部满足后，Android 远程工作区 V1 才能进入正式 Release：

- [x] 96/96 功能点完成；M11-F03 Codex 真实 E2E 已通过且不破坏三项 ADR；
- [x] Runtime Protocol、OWOP 和 Relay Schema 无 drift；
- [x] 本仓库 `apps/desktop/windows` 的 OpenDrSai 真实 Backend 完成 Android E2E；
- [x] Relay 故障、Runtime 重启、网络切换和进程回收不产生重复 Run；
- [x] Permission、Approval、Audit 顺序和跨账户隔离测试通过；
- [x] API 29/30 与 API 33+ 模拟器矩阵通过，不设真机发布门禁；
- [x] 生产 APK 不包含开发 Relay/API 地址、测试证书或测试凭据；
- [x] 使用测试签名构建并验证升级安装（组织 Release Keystore 由正式发布流程替换）；
- [x] GitHub Release 中 APK、版本号、SHA-256、Release Notes 和测试证据一致。

## 11. 主要风险

1. **Relay 成为第二权威状态源**：必须通过代码边界和测试确保 Relay 只路由，Run/Event 以 Full Runtime 为准。
2. **Runtime 出站连接不稳定**：连接代次、heartbeat、重连和请求幂等必须先于产品 UI 完成。
3. **多设备重复控制**：Cancel 和 Approval 必须由 Runtime 实现幂等与最终决定查询。
4. **Android 后台限制**：不得依赖永久后台 SSE；恢复必须基于权威状态和 sequence。
5. **Codex 远程可用性**：Android 保持 Backend 无关；真实 Codex E2E 已通过，后续仍需持续监控 Provider 可用性。
6. **大 Workspace 移动端资源峰值**：文件、Diff、Event 和 Artifact 必须分页、分块、截断和限额。
7. **平台耦合**：HepAI 是首个 Relay Provider，但 RuntimeConnection、OWOP 和领域模型不得写死平台私有语义。

## 12. 与现有 Android 功能的关系

- 现有 HAI OIDC 登录、EncryptedSharedPreferences、Room、Compose 聊天 UI 和附件卡片可复用；
- 当前本地 Kotlin Runtime 保留，远程工作区通过显式运行位置选择进入 Full Runtime 委托；
- 当前 `/api/native/v1` 平台智能体功能继续存在，但不承担 Remote Workspace Runtime Protocol；
- Android 远程工作区使用独立的 RelayRuntimeConnection，不能把平台 Agent 会话伪装成 Workspace Session；
- v1.4.6 附件 Beta 的生产验收可独立延期，不改变本方案的架构设计，但发布时需要统一处理版本、数据库迁移和签名升级链路。
