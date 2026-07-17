# OpenDrSai Android 远程工作区开发进度

> 基准方案：[Android 远程工作区开发方案 V1](./ANDROID_REMOTE_WORKSPACE_DEVELOPMENT_PLAN_V1.md)  
> 统计规则：只有实现、自动化测试和对应验收证据同时存在的功能点才标记完成。  
> 当前范围：移除真机验收，Codex 真实 Backend E2E（M11-F03）延期，OpenDrSai E2E 使用本仓库 `apps/desktop/windows`。  
> 更新时间：2026-07-17

## 总体状态

| 指标 | 当前值 |
| --- | ---: |
| 功能点总数 | 96 |
| 当前验收范围 | 95 |
| 已完成 | 95 |
| 进行中 | 0 |
| 未开始 | 0 |
| 受阻 | 0 |
| 延期 | 1 |
| 当前范围完成率 | 100% |

当前阶段：95 项当前范围全部完成。真实 E2E 只包含 `apps/desktop/windows` OpenDrSai Backend，Codex E2E 延期且不设真机门禁。

## 模块进度

| 模块 | 名称 | 完成/总数 | 状态 |
| --- | --- | ---: | --- |
| M01 | 架构、领域模型与产品边界 | 8/8 | 完成 |
| M02 | Relay Runtime Protocol 与 Schema | 8/8 | 完成 |
| M03 | Runtime 注册、发现与连接 | 8/8 | 完成 |
| M04 | 身份、票据、权限与安全存储 | 8/8 | 完成 |
| M05 | Android 本地数据与非权威缓存 | 8/8 | 完成 |
| M06 | Runtime、Workspace 与 Session 体验 | 8/8 | 完成 |
| M07 | Run、聊天与流式 Event | 8/8 | 完成 |
| M08 | Approval、用户决策与 Audit 投影 | 8/8 | 完成 |
| M09 | 只读 Files、Git 与 Artifact | 8/8 | 完成 |
| M10 | 移动网络、后台与可靠性 | 8/8 | 完成 |
| M11 | Backend 无关兼容与 OpenDrSai 验收 | 7/7 当前 + 1 延期 | 完成 |
| M12 | 自动化、模拟器、构建与发布验收 | 8/8 | 完成 |

## 已完成证据

- **M01-F01**：`RemoteContractCodecTest` 对 Runtime/Workspace/Session/Run 权威字段逐字段往返，未知 `mobile_run_id` fail closed；`AppRouteTest` 验证权威 ID 路由。
- **M01-F02**：`RemoteModelsTest` 验证 Android projection 永远非权威，离线只改变连接状态，跨 Workspace Event 被拒绝。
- **M01-F03**：`RuntimeConnectionContractTest` 对 Local Fixture、SSH Fixture 和 RelayRuntimeConnection 运行相同 identity/workspace/session/run 契约。
- **M01-F04**：OWOP Schema 新增 `relay` Binding；Gradle 从唯一 Schema 生成 `OwopSchemaGenerated.kt`，`verifyAndroidOwopBindings` 已绑定 `preBuild` 并通过。
- **M01-F05**：`RemoteArchitectureBoundaryTest` 验证 Workspace 无 Backend/SSH 私有身份，Android remote 主代码无 Codex thread/turn/item/App Server 私有依赖。
- **M01-F06**：`RemoteRunIdentity` 不提供 data-class copy/component，字段 final；Relay 对 Runtime/Workspace/Session/Backend scope 逐层 fail closed。
- **M01-F07**：`RelayRuntimeConnectionTest.remoteFailureHasNoFallbackPath` 验证 Relay 失败只有一次远程调用，Local fallback 调用为零。
- **M01-F08**：`RemoteArchitecturePolicy`、OWOP `relay` Binding、只读 operation 白名单和 Compose 入口共同落实三项 ADR；`OwopRelayClientTest` 与 UI 仪器测试通过。
- **M06-F01**：Drawer 增加独立“远程工作区”产品入口，进入真实空状态页面；`MainInterfaceTest.drawerExposesRemoteWorkspaceAsAProductEntry` 通过。
- **M02-F02～F03**：FastAPI Relay 提供 Runtime identity/capabilities 等价握手及按 subject 授权的 Runtime/Workspace 分页搜索；严格请求拒绝 canonical path/permission。
- **M02-F04～F05**：`IdempotencyLedger` 保存 succeeded/failed/unknown 结果并可按键查询；Relay 错误体带来源和 correlation_id，传输超时保留为 unknown。
- **M02-F06**：`RelayEventStore` 强制完整资源身份、单调 sequence、event_id 去重及 after_sequence/cursor 续传。
- **M02-F07**：`RawStreamGateway` 实现授权、offset/length、SHA-256 digest、取消和 4 MiB 上限，传输对象为原始 bytes。
- **M02-F08**：Relay Schema、生成的 Kotlin/Python 契约、OpenAPI 和兼容性基线均有零漂移测试；Gradle `preBuild` 已绑定 Relay 契约校验。
- **M03-F02**：Runtime Ed25519 私钥由 Windows Current User DPAPI 保护，Relay 仅存公钥；旧钥签名轮换、坏签名和 nonce 重放测试通过。
- **M03-F03**：`RuntimeOutboundConnector` 只接受 `wss://` 并主动连接 Relay WebSocket；源码门禁确认不存在 bind/listen/server socket，服务端真实握手测试通过。
- **M03-F04～F05**：签名心跳驱动 online/degraded/offline 和 connection generation；稳定 runtime_id、变化 instance_id 由 Android 解析，已有投影测试证明断线不改变 Run 业务状态。
- **M03-F08**：管理端吊销立即使 Runtime token、用户授权和新连接失效并写入 Audit。
- **M04-F01～F02**：远程目录复用现有 HAI OIDC/PKCE；EdDSA Relay ticket 限时并绑定 subject、organization、runtime、workspace、scope、expiry、jti、device/session。
- **M04-F04～F06**：Principal 仅由已验证票据构造，严格模型拒绝客户端权威字段，Runtime 二次权限检查；Android 对 401 只刷新并重放一次，票据过期/吊销/偏差错误可区分。
- **M05-F01～F04**：Room v5 增加 7 类账户隔离投影，所有主键带 subject/organization/runtime scope，并显式保存 `authoritative=false`、同步时间、连接状态和 capabilities snapshot。
- **M05-F05～F06**：`RemoteCacheRepository` 在同一事务写 Event 与 cursor；Reducer 对重复、乱序、缺口和跨 Runtime/Run 输入确定性 fail closed。
- **M06-F02**：Runtime 卡片由真实 Relay 目录驱动，展示名称、online/degraded/offline、版本和最近连接标签；错误以 correlation-safe banner 展示，不暴露主机地址或凭据。

## 测试结果

- `testDebugUnitTest`：50/50 通过，0 failed，0 skipped。
- `verifyAndroidOwopBindings`：通过；生成文件包含 `relay` Binding。
- `lintDebug`：通过。
- Android Debug 主代码和测试代码编译：通过。
- `connectedDebugAndroidTest`（API 35）：26/26 通过，0 failed，0 skipped。
- Relay Python 专项：37/37 通过；另有 371 项非 Relay 测试未在本轮专项命令中执行。
- `verifyAndroidRelayBindings`：通过；`lintDebug` 与 API 35 17/17 回归通过。

## 第 2 轮结论（2026-07-17）

完成数由 9 增至 16。M02-F01 暂不标记：当前 Schema 已生成 Kotlin/Python 契约目录，但服务端 Pydantic 数据类仍有手写部分；下一轮会改为完整类型生成后再验收。M03 的注册、短码、签名心跳、发现和吊销已有代码与测试基础，但其各功能点包含桌面客户端、密钥轮换、出站隧道或 Android 端验收，因此暂不提前计数。

## 第 3 轮结论（2026-07-17）

完成数由 16 增至 21。新增 Runtime 设备身份、密钥轮换、主动 WSS 隧道、连接状态/代次和吊销闭环；Android 已使用生产环境 `RELAY_BASE_URL` 与 HAI Bearer Token 获取授权 Runtime/Workspace，并展示真实版本与状态。Android JVM 全套、API 35 17/17 与 lint 通过。M03-F01、F06、F07 仍分别缺扫码关联 UI、完整分页搜索交互和跨所有资源的隔离矩阵，继续保留未完成。

## 第 4 轮结论（2026-07-17）

完成数由 21 增至 32。安全层完成 OIDC 复用、短期 Relay ticket、Principal/Runtime 双重授权和单次 401 恢复；本地层完成 Room v5 远程投影、账户复合隔离及事务性 Event cursor。Relay 29/29、Android JVM 全套、API 35 17/17 和 lint 通过；其中仪器测试实际覆盖 Room 2→5、3→5 迁移链。M04-F03/F07/F08 与 M05-F07/F08 尚未满足完整验收，未提前计数。

## 第 5 轮结论（2026-07-17）

完成数由 32 增至 36，M04 达到 8/8。Relay ticket 使用 Keystore 支持的加密区保存，Android/Python 均执行秘密脱敏；退出登录同步取消 subject 订阅、清票据，并事务清除该账户远程投影而保留其他账户。Runtime 卡片真实展示状态/版本且不暴露连接秘密。Android JVM 58/58、API 35 19/19、lint 和 Relay 29/29 通过。

## 第 6～7 轮结论（2026-07-17）

完成数由 36 增至 53。Full Runtime Authority 与 Relay API 已覆盖精确 Agent Definition、Session/Run 幂等、附件引用、取消、审批和 Audit；Event 同时提供 `after_sequence` 补取及真实 `text/event-stream`，Android SSE 客户端逐事件验证四级身份。Compose 新增 Workspace capability、Session metadata、统一远程聊天和 Approval 卡片，离线状态禁止发送、停止和审批。Relay 37/37、Android JVM 64/64、API 35 22/22、lint 全通过。M07 达到 8/8；尚未把这些页面接入生产导航/Repository 的项目继续保留未完成。

## 第 8 轮阶段结论（2026-07-17）

完成数由 53 增至 54。新增生产 `RelayRemoteRepository`，Session 分页/搜索、精确 Definition 创建、Run/附件引用、Cancel 和审批响应均携带 Runtime/Workspace 身份与 HAI Bearer Token；测试验证跨 scope fail closed。M09 已完成 OWOP 只读客户端和边界模型骨架，包括文件分页/深度、服务端搜索、Git baseline、Artifact 分块、SHA-256 与有界缓存，但因 Files/Git/Artifact Compose 页面尚未完成，M09 暂不提前计数。Android JVM 当前 72/72。

## 第 9 轮结论（2026-07-17）

完成数由 54 增至 62，M09 达到 8/8。Compose 文件树支持按需展开、分页、搜索、元数据、忽略/截断提示；预览真实解码有界图片字节，并覆盖文本、二进制摘要与系统外部打开。Git 页面展示结构化 status、bounded diff、binary/truncated/stale 状态，仪器测试确认不存在 stage/revert/commit 控件。Artifact 使用固定分块、协程取消点、scope 校验、SHA-256 和 FileProvider。API 35 26/26、lint 与 Android JVM 全套通过。

## 第 10 轮阶段结论（2026-07-17）

完成数由 62 增至 68。新增六态连接状态机与 Relay/Runtime/Business 错误分类；`ConnectivityManager.NetworkCallback` 已接入生产 RemoteHomeViewModel，Wi‑Fi/蜂窝/VPN 变化只重建 Transport 并复用幂等命令。instance generation 变化触发重新核对，Event gap/cursor expiry/history truncation 进入补取或全状态恢复。指数退避带抖动、上限和永久错误停止条件；10,000 Event 压测保持 512 条有界缓冲，文件 IO 固定在 Dispatchers.IO。Android JVM 81/81、API 35 26/26 与 lint 通过。后台/进程死亡恢复尚未接入生产 Session ViewModel，因此 M10-F03/F04 暂不计数。

## 第 11 轮结论（2026-07-17）

完成数由 68 增至 76，M10 达到 8/8。生命周期 observer 后台停止 SSE、前台先查询再补取；进程恢复从 Room 读取非权威引用，随后重新认证并校验 Runtime 权威身份。双 Backend 统一目录、health/error、timeline 和 session binding 已实现；Android remote 包及 Room 不依赖 Codex threadId/turnId/itemId，同 Workspace 并发 Backend 资源使用复合身份隔离。Python Relay/Codex/Agent Backend 105/105 与 7 subtests、Android JVM 87/87、API 35 26/26、lint 全通过。按当时口径 M11-F02/F03 等待真实 Full Runtime E2E；第 12 轮起改为只验收 M11-F02，M11-F03 延期。

## 第 12 轮结论（2026-07-17）

完成数由 76 增至 78。M02-F01 已由 Relay Schema 同步生成 Kotlin data class 与 Python/Pydantic 基类，服务端模型改为继承生成类；M03-F01 已增加 Desktop/CLI Runtime 注册、DPAPI 保护的凭据持久化，以及 Android Google Code Scanner 一次性 Access Grant 关联。注册码与关联码使用不同 API 和校验路径。Relay 专项 38/38、Android JVM 89/89、API 35 27/27 与 lint 通过。

本轮同时修订验收范围：真机测试从强制门禁移除，改为 API 29/30 与 API 33+ 模拟器/受控客户端矩阵；M11-F03 Codex 真实 Backend E2E 延期且不阻塞当前发布；M11-F02 的真实 OpenDrSai Full Runtime/Backend 固定使用本仓库 `apps/desktop/windows`。因此当前验收分母为 95，已完成 78，完成率 82.1%。

## 第 13 轮结论（2026-07-17）

完成数由 78 增至 80，当前范围完成率 84.2%。M03-F06 和 M06-F03 已完成：新增 `RemoteDirectoryLoader` 遍历 Runtime/Workspace 全部 cursor 页，对循环 cursor 和异常页数 fail closed；搜索同时覆盖计算机名和所有已授权 Workspace，并有可验证空状态。首页新增生产搜索框、250 ms 防抖、手动刷新和最近使用排序；最近记录以 `subject/runtime_id/workspace_id` 复合身份隔离，相同 `workspace_id` 的两个 Runtime 不会串线。

验收证据：Android JVM 92/92 通过；API 35 Compose/仪器测试 28/28 通过；`lintDebug`、`verifyAndroidOwopBindings` 和 `verifyAndroidRelayBindings` 通过。本轮 Relay Python 回归命令在 120 秒超时前未返回结果，未将其计为新的通过证据；本轮生产代码改动仅位于 Android 目录层。

## 第 14 轮结论（2026-07-17）

完成数由 80 增至 81，当前范围完成率 85.3%。M06-F06 已完成：Workspace 点击后进入按 `runtime_id/workspace_id` 固定的真实 Session 分页/搜索页；“新会话”必须显式选择 Runtime 返回的健康、精确版本 Agent Definition，`latest` 和不健康 Backend 均不能提交。Relay/Runtime 新增按 `subject + operation + idempotency_key` 查询已创建资源的端点；Android 遇到 Session 创建响应超时时先查询该结果，不盲目重发 POST。OpenAPI 已重新生成并通过零漂移/兼容性检查。

验收证据：Relay Python 38/38 通过；Android JVM 93/93 通过；API 35 Compose/仪器测试 29/29 通过；`lintDebug`、OWOP/Relay Binding 校验通过。

## 第 15 轮结论（2026-07-17）

完成数由 81 增至 82，M05 达到 8/8，当前范围完成率 86.3%。M05-F08 已补齐：Room 2→5、3→5 迁移链保留现有数据；高于当前 Schema 的数据库在无 destructive fallback 时明确拒绝降级；损坏或无法解析的非权威远程投影只清理当前账户/组织并等待 Runtime 重建，不影响其他账户。新增按账户执行的 Event TTL/容量上限、过期 Approval 和陈旧 cursor 清理，不会跨账户删除。账户切换、退出清理和进程恢复回归同时通过。

验收证据：Android JVM 93/93 通过；API 35 Room/Compose/仪器测试 32/32 通过；`lintDebug`、OWOP/Relay Binding 校验通过。

## 第 16 轮结论（2026-07-17）

完成数由 82 增至 84，M08 达到 8/8，当前范围完成率 88.4%。M08-F06 和 M08-F08 已完成：Workspace Session 页在 `ON_START`/回到前台时使用 GET 重新查询 Runtime 当前未决 Approval，过期项由 Runtime 收敛并不再返回；后台路径不调用任何决策 API。Runtime 新增只追加的不可变 Audit 条目，覆盖 Run 创建/取消、Approval 请求/决策，并保留 runtime/workspace/session/run/subject/timestamp/correlation_id。Android 只读 Audit 页展示安全摘要和关联 ID，没有修改或删除端点/控件。

验收证据：Relay Python 38/38 通过，OpenAPI 零漂移与兼容性检查通过；Android JVM 94/94 通过；API 35 Compose/Room/仪器测试 33/33 通过；`lintDebug`、OWOP/Relay Binding 校验通过。

## 第 17 轮结论（2026-07-17）

完成数由 84 增至 85，M03 达到 8/8，当前范围完成率 89.5%。M03-F07 已完成全资源隔离验收：在同一 subject/organization 下，向两个 Runtime 写入完全相同的 workspace_id、session_id、run_id、event_id 和 approval_id，Workspace 名称、Session 标题、Event 以及 Approval operation 均按 runtime_id 独立读回，无覆盖和串线。目录最近使用排序也按 `subject/runtime_id/workspace_id` 隔离。

验收证据：API 35 Room/Compose/仪器测试 34/34 通过；`lintDebug`、OWOP/Relay Binding 校验通过。

## 第 18 轮结论（2026-07-17）

完成数由 85 增至 86，M06 达到 8/8，当前范围完成率 90.5%。M06-F08 已完成：生产导航已接入真实远程 Session/Run/Event、Approval/Audit 以及只读 Files/Git OWOP；所有 ViewModel 和界面临时状态均以 `runtime_id/workspace_id/session_id` 完整作用域绑定。使用相同 Workspace、Session 和资源 ID 在两个 Runtime 间快速切换时，消息、Event、Approval、文件树、标题、输入草稿和文件搜索均不会沿用前一 Runtime 的状态。

验收证据：Relay Python 39/39 通过；Android JVM 98/98 通过；API 35 Compose/Room/仪器测试 36/36 通过；`lintDebug`、OWOP/Relay Binding 校验通过。当前发布门禁继续排除真机与 Codex 真实 Backend E2E；后续 M11-F02 只使用本仓库 `apps/desktop/windows` 作为真实 OpenDrSai Full Runtime/Backend。

## 第 19～20 轮结论（2026-07-17）

完成数由 86 增至 95，当前范围完成率 100%。M11-F02 已使用本仓库 `apps/desktop/windows` 的实际 Gateway/Full Runtime 完成 Session、Run、OpenDrSai Tool、Approval、Artifact、Files OWOP、幂等恢复及 Runtime 重启 E2E。生产桥接新增 Runtime 主动 WSS 控制 RPC、握手后 Workspace 自动发布和 Backend health；HAI Bearer Token 被转发到 OpenDrSai Backend，但不落库。

发布前审计修复了四项真实缺口：Windows `agent.message.delta`/`tool.completed` 统一投影为 Android 契约事件；Relay Event 补齐 `timestamp`；Android 文件点击接入有界预览/完整 digest 下载，Artifact 接入会话卡片和 FileProvider；OIDC subject、Workspace、Session、Run、Approval 与 Audit 改为逐层 fail-closed 授权。Approval deadline 在等待超时和前台查询两条路径都收敛为权威 `timeout`。

最终证据：Relay/OpenDrSai Windows E2E 47 passed；Runtime/OWOP/Artifact 74 passed、58 subtests passed、1 platform skip；Windows Workspace/Git/Terminal 36 passed；Android JVM 99/99、API 30 37/37、API 35 37/37、Lint/Lint Vital/双 Schema binding 全通过。最终测试签名 APK 已 R8 构建、覆盖安装并启动，SHA-256 为 `ACE7B01C48DE3F1BF393B3D54F06A364AA93A87058F6FB21CAB7B9018E5DDF81`，已发布到 GitHub Release `android-v1.4.6`。

公开 GitHub API 复核确认 `android-v1.4.6` 已创建，资产 `OpenDrSai-Android-v1.4.6.apk` 已上传，GitHub digest 与本地 SHA-256 一致。
