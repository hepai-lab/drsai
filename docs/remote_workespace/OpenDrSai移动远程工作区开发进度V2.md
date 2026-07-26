# OpenDrSai 移动远程工作区开发进度 V2

> 对应方案：[OpenDrSai 移动远程工作区开发方案 V2](./OpenDrSai移动远程工作区开发方案V2.md)
> 最近更新：2026-07-26
> 总规模：10 个模块、80 个功能点
> 最终全链路验收：**0/80**（尚未完成 ai-dev + Windows + Android 真机门禁）

## 进度口径

- “本地通过”表示代码、合同及本地 Runtime/Relay/Android 自动测试已通过。
- “全链路通过”必须同时有 ai-dev 部署、Windows Runtime 出站连接和 Android 真机证据。
- Mock、参考 Relay 或同账号自动可见不计入最终 80 项完成数。

## 第 1 轮：P0 合同与 Windows 已有会话可见性

状态：**本地实现和回归通过，等待 Android/HAI 联调。**

### 已实现

- [x] `ResourceLifecycle = active | archived | removed` 进入 Relay 领域模型。
- [x] Workspace DTO 增加 lifecycle、revision、updated_at。
- [x] Runtime DTO 增加 last_seen_at。
- [x] Workspace 默认只列 active；archived/removed 不可执行，removed 墓碑不会进入默认目录。
- [x] Runtime association 成为 Session 可见性边界。
- [x] Relay 不再用 `relay_sessions.subject` 过滤 Windows 已有 Session。
- [x] Full Runtime 新增按 Session 列出已有 Run 的接口。
- [x] Relay 可列出 Windows 预创建的 active Session 和历史 Run。
- [x] 新增分页 Conversation Projection 合同与 Runtime/Gateway 实现。
- [x] Conversation 按 Run 创建顺序和 Event sequence 排序，不依赖不可靠的墙钟时间。
- [x] Relay Schema 升级为 2.0.0，并补齐 association、Runtime WSS、Session read、conversation、run list、event stream、Approval 合同。
- [x] Python/Kotlin 生成合同和 FastAPI OpenAPI 已重新生成并通过零漂移检查。
- [x] 修复 `RuntimeRunExecuteRequest.metadata` 未声明导致远程 Run 永久 queued 的执行阻塞。
- [x] Gateway 保存有界 execution failure 诊断，避免后台执行错误完全静默。

### 本轮覆盖的方案功能

以下功能已达到本地实现门槛，但在三端真实验收前不计入最终 80 项：

| 功能 | 本地状态 | 尚缺证据 |
| --- | --- | --- |
| M01-F04 Workspace 生命周期/墓碑 | 通过 | ai-dev 持久化和真机过滤 |
| M01-F05 Session active 过滤 | 通过 | Android Room/真机 removed 同步 |
| M01-F07 关联后访问已有 Session | 通过 | ai-dev 强制扫码关联 |
| M02-F01 V2 生命周期 Schema | 通过 | HAI 部署同版本合同 |
| M02-F03 active Workspace 列表 | 通过 | ai-dev 公网分页/过滤 |
| M02-F04 Windows 已有 Session 可见 | 通过 | 真实 Windows→ai-dev→真机 |
| M02-F05 Conversation Projection | 通过 | 大历史分页和 Android UI |
| M02-F07 Event sequence 恢复基础 | 回归通过 | ai-dev SSE gap/expired |
| M02-F08 合同生成零漂移 | 通过 | HAI/Android 同 revision |
| M03-F04 Workspace 生命周期发布 | 通过 | Windows 对 ai-dev 实际发布 |
| M03-F05 已有 Session 发布 | 通过 | 真机读取 Windows 存量 |
| M03-F06 Conversation Projection | 通过 | Desktop/Android transcript hash |

### 自动测试证据

Python Relay/Runtime/Windows E2E：

```text
76 passed, 1 skipped
```

覆盖：

- 全部 `test_relay_*.py`
- `test_runtime_engine.py`
- `test_runtime_registry.py`
- `test_remote_workspace_gateway.py`
- `test_android_windows_runtime_e2e.py`

Android JVM：

```text
182 passed, 0 failed, 0 skipped
BUILD SUCCESSFUL
```

合同门禁：

```text
generate_relay_contract.py --check  PASS
generate_relay_openapi.py --check   PASS
git diff --check                    PASS
```

### 本轮发现并修复的关键缺陷

1. **Windows 已有 Session 被 Relay 私有表过滤**
   修复后，Runtime 关联用户可以读取该 Runtime 下的全部 active Session；Relay 表只用于创建幂等和元数据。

2. **Conversation 使用时间戳排序不稳定**
   相同或粗粒度时间戳会造成助手消息先于用户消息。现改为 Runtime Run 顺序 + Event sequence。

3. **远程 Run 永久停留 queued**
   `/v1/runs/{run_id}/execute` 读取 `request.metadata`，但请求模型没有该字段。补齐后，Android→Relay→Windows Runtime→Approval→Tool E2E 恢复通过。

### 已发起的协作任务

- Android：`019f4fa6-b70a-7a53-a9a9-018a11e0a836`
  - M06 导航和 lifecycle；
  - M07 Conversation Projection；
  - M08 Android 消息/Approval；
  - Kotlin/Compose/Room/真机验收。

- HAI 平台（`ai-dev.ihep.ac.cn`）：`019f5208-0f19-7883-b3e2-4dcc8ffa4b61`
  - M04 ai-dev Relay；
  - M05 enrollment/association 分离；
  - 持久化、Runtime 出站 WSS、多实例路由和公网 smoke。
- `019f9a52-b494-7461-a589-27e24d64e526` 仅管理
  `opendrsai-dev.ihep.ac.cn`，不承担本方案的 ai-dev 变更。
- 2026-07-26 环境归属纠错后，正确的 ai-dev 任务完成只读权威审计：
  Backend checkout 为 `hai-ai-platform-backend`、基线 HEAD 为 `e32de807`，
  历史 revision 均为其线性祖先，Alembic 为 `9a06b67b28bf`，公网
  health/OpenAPI/401 合同存在；账本的 `hai_revision` 因而恢复为
  `e32de807d25263ea2550212b0b3177f132ae4855`。
- 误投任务本轮产生的未提交 fault-injection/route-pause 改动不属于上述基线，
  不计入验收；已要求正确任务隔离并核对自动热加载影响。

## 下一轮

1. 完成 Runtime Session 的 authoritative lifecycle 持久化和 removed 墓碑迁移；
2. 为 Conversation Projection 增加稳定 opaque cursor、超过 200 Run/2000 Event 的无上限分页；
3. 增加 Session 绑定的 Agent Definition/Backend 元数据，消除既有空 Session 的隐式默认选择；
4. 接收 Android/HAI 协作实现并执行合同对齐；
5. 启动 Windows Runtime 对 ai-dev 的真实出站 WSS 和 Workspace/Session 发布联调。

## 第 2 轮：权威 Session、HAI 双栈 WSS 与 Android V2 投影

状态：**三端代码与单端测试完成；Windows 已注册并连接 ai-dev，等待真实代理请求、扫码 association 和 Android 端到端复验。**

### Windows Runtime / Relay

- [x] Session 持久化 `lifecycle/revision/removed_at`，removed 为不可复活墓碑。
- [x] Session 持久化根 Agent Definition 与 Agent Backend；普通 Run 不得切换绑定。
- [x] Subagent Run 以 `parent_run_id` 显式建模，可使用子 Agent Definition，但继承同一 Session/Workspace。
- [x] Run 持久化用户输入、attachment refs 和 correlation id，Conversation 不再依赖 Relay 私有表。
- [x] Runtime 原生提供 `/v1/sessions/{session_id}/conversation`，opaque cursor 跨 652 项分页无重无漏，全局 sequence 连续。
- [x] Relay Conversation 直接代理 Runtime 权威投影，不再固定读取 200 Run × 2000 Event。
- [x] Windows 对 HAI `f303b504` 增加双栈 WSS：保留旧 operation 帧，同时支持 HAI HTTP request/response 帧。
- [x] HAI 模式使用 query 参数和 `X-Runtime-Token` 握手、15 秒 heartbeat、Runtime 主动 Event 帧及 per-run sequence 恢复。
- [x] HAI 代理的 `/v1/runtime` 以 Relay enrollment 身份归一化，避免泄露相冲突的 loopback 安装身份和包版本。
- [x] Access grant 100 路并发消费严格单赢家；Heartbeat nonce 100 路并发严格单赢家。
- [x] 一次性 registration code 已消费；长期 token 仅存 Windows DPAPI。
- [x] 真实源码 Runtime 已启动并启用 ai-dev bridge：
  `runtime-112c4d3c7bea3b29d631a5f8450c80df`。

相关聚焦回归：

```text
runtime/relay/agent focused: 46 passed, 19 subtests passed
V2 relay/runtime matrix:     50 passed
latest V2 focused matrix:    92 passed, 7 subtests passed
full suite until env gate:   147 passed, then stopped by missing node-pty
```

Desktop 配对控制器、安全和 UI/二维码独立解码验证分别通过；Windows Node/Web
TypeScript 全量类型检查通过。

Desktop 现可列出仅含 `sub_<12 hex>` 的已关联 Android 设备、逐个断开关联，并在二次确认后
撤销整台 Runtime enrollment；Runtime 本地凭据在设备撤销成功后删除。关联管理、设备撤销、
IPC 最小暴露和 UI 静态验收均通过。

本轮最新 Python Relay/Runtime/配对/Windows E2E/账本/公网 smoke 聚焦矩阵：
121 passed、1 skipped（仅可选环境门禁），另有 7 个参数化 subtests passed。

全量 Python 中另有一个既有 GFS 文案断言失败；与远程工作区修改无关。Windows ConPTY 联合测试因
`apps/desktop/windows/node_modules/node-pty` 未安装而停止，不能计为功能失败或通过。

### HAI Platform M04/M05 第一阶段

第一阶段 revision：`f303b504673ff03a36ce9624cbba7adcb15db229`
Redis 多实例 revision：`1f36d4b03717ef2181ee5260ea19d4df5e7141f0`
撤销与游标合同 revision：`631d263bd1e091b0d424bfe81ef356d4d3d10f4a`
Scope 与安全命名 revision：`9e7bd9c965c6207849183c5a8fa3eb4212b29e32`
Opaque keyset cursor revision：`a0eeae1a7c47b9458ec283b948b0261c2c62a127`
幂等账本与指标 revision：`f354cdd3d33819ef915a6fc3ae8af3cc8342260a`
正式持久化迁移 revision：`969d53a5e29a22db37f5780b84e72bf336247c03`（Alembic head `9a06b67b28bf`）
全端点授权矩阵 revision：`ddf0aa665c6bb1fa2b37951db43ff0554546bd22`
安全负向矩阵与多 worker 压测 revision：`44af03ad013e4991bcdf11224026fabb3552d71c`

- [x] `/api/runtime-relay/v1` 兼容并新增 `/v2` alias。
- [x] v2 health=200；OpenAPI=2.0.0、23 paths；v1/v2 未认证 runtimes=401。
- [x] enrollment/association 分表，同 owner 扫码前不可见。
- [x] grant consume/revoke、Workspace projection tombstone、单 active generation WSS hub。
- [x] HTTPS proxy、SSE replay/heartbeat、全部 active Session 实时转发。
- [x] agent definitions、files、Approval、cancel 路由。
- [x] Relay + OIDC：36 passed。
- [x] Redis presence、原子 generation 抢占、跨 worker request/response、Event replay 和 fencing。
- [x] 两个独立 Hub + 真实 Redis 验证跨 worker；真实 Windows WSS 的无副作用 GET 返回 200。
- [x] 真实 identity 出口对齐 enrollment runtime_id、instance、2.0.0、`owop/1`；重启后 generation 依次增至 3。
- [x] 真实 Workspace 出口返回 4 项，只含冻结合同字段和 `next_cursor`，序列化响应无 `path`。
- [x] Relay + OIDC 聚焦回归增至 39 passed。
- [x] 用户关联撤销、Runtime 侧关联查询/撤销和设备 enrollment 撤销均已实现，响应只含不可逆 subject summary。
- [x] 关联撤销跨 worker 立即终止既有 SSE；后续目录和控制请求统一返回 `403 association_required`。
- [x] Event 游标早于保留窗口时在建流前返回 `409 cursor_expired/history_truncated`。
- [x] Relay + OIDC 聚焦回归增至 49 passed；真实 Windows identity/Workspace 在热加载后仍返回 200。
- [x] 新 association 使用 10 项最小权限 scope；目录与控制路由在代理前分别校验，独立剥离矩阵通过。
- [x] Runtime 安全命名拒绝 IP、URL、绝对路径并支持关联用户 PATCH 重命名；历史不安全名称安全降级。
- [x] Relay + OIDC 聚焦回归增至 66 passed；真实 Windows presence generation=27，identity/Workspace 无回归。
- [x] Runtime/Workspace 使用 keyset 分页，实时代理游标经 HMAC 签名并绑定资源上下文；10k 目录 100 页无重无漏。
- [x] Relay + OIDC 聚焦回归增至 68 passed；真实 Windows presence generation=32，identity/Workspace 无回归。
- [x] Run create/Approval decision 使用 Redis 跨 worker 幂等账本；同键重放、不同语义冲突、owner 失败释放 lease 均已验证。
- [x] 幂等审计只记录脱敏 subject/key hash/correlation/latency，并新增 Prometheus metrics；Relay + OIDC 增至 73 passed。
- [x] Runtime enrollment、association、grant、Workspace tombstone、instance presence 与幂等审计已纳入正式 Alembic 迁移；PostgreSQL 16 fresh/legacy up、重启保留、有状态 down 拒绝和空表 down→up 均通过，ai-dev 已升级到 `9a06b67b28bf`。
- [x] 18 个 Runtime proxy/SSE/control 端点统一使用 token issuer + subject + enrollment + active association + required scope；跨 issuer/subject/runtime IDOR、独立 scope 剥离和副作用前拒绝矩阵通过，HAI OIDC/Relay 为 99 passed。
- [x] 24 个 FastAPI credential/IDOR/replay 负向矩阵覆盖 401/403/404，并验证拒绝发生在 body/proxy/ledger 副作用前；HAI OIDC/Relay 为 104 passed、1 optional PG skipped。
- [x] 真实 Redis + 2 个 Uvicorn worker、并发 64、100 Workspace/10k Session/10k Event 共 6000 请求压测通过；三类 P95 为 24.96/25.87/47.09ms，RSS 增量 1.93MiB。
- [x] Desktop eager 冷启动约 10.172 秒完成延迟任务并拉起持久 Full Runtime；ai-dev presence generation 从 66 增至 71，heartbeat、identity 与 4 项 Workspace 投影只读核验通过。
- [x] 真实 Redis + 双 Uvicorn worker 滚动重启与 Runtime owner generation 1→2 恢复通过；旧 generation Event 被 fencing，1..20 sequence 与 transcript/Event hash 均保持不变。
- [x] Run/Approval correlation 已贯通 HTTP、Redis、Runtime request/event/response、SQL 脱敏审计与 Prometheus 指标；敏感日志扫描 clean，HAI revision 为 `aad0ac27fa9c90f4c316d05e02871e8a128c7538`。
- [x] HAI/Relay 隔离 canary 门禁完成：5 类非空来源覆盖 Relay log、真实 Redis、一次性 PostgreSQL 五表、诊断与测试产物，扫描明文及常见编码变体均 clean；负向 scanner 6 passed、Relay/OIDC 110 passed，revision 为 `e32de807d25263ea2550212b0b3177f132ae4855`。
- [ ] 真实 OIDC 扫码与撤销全链路。

### Android M02/M06/M07 第一阶段

- [x] Workspace/Session lifecycle 解析、服务端 active 参数及客户端防御过滤。
- [x] Room v7 保存 lifecycle 墓碑，按 issuer/subject/runtime 隔离。
- [x] Conversation endpoint 分页读取 Windows 已有 Session，不再用 Runs+Events 拼首屏。
- [x] Conversation 映射用户消息、助手增量和工具进度。
- [x] SSE sequence reducer 已接入 Room：重复丢弃、缺口补取、游标过期 snapshot、EOF/网络退避恢复。
- [x] 新 sequence 复用旧 event_id 时不推进游标，跨 scope Event fail closed。
- [x] `opendrsai://associate` Manifest/冷启动/onNewIntent 已接入严格校验与内存去重。
- [x] 架构规则测试确认 Android 无 SSH 依赖，二维码只有 version/environment/issuer/opaque code。
- [x] Python/Kotlin/TypeScript 使用同一 Runtime 目录 fixture，冻结 status/display_name/last_seen_at/capabilities。
- [x] Android 用户可在主机卡片确认解除关联；OIDC 401 只刷新一次，成功后立即从目录移除目标 Runtime。
- [x] user/assistant/system、reasoning 摘要、Markdown、Run 终态及未知事件安全降级已统一投影。
- [x] Android Emulator 经 Relay 与 Windows Full Runtime 直读同一 Session，16 个 Event 的跨语言语义 transcript SHA-256 完全一致。
- [x] M08-F03：批准分支由 Windows Full Runtime 在临时 Workspace 写入一次性 canary；Android target 的 files/cache/no-backup/Room/external 共 7 类、12 个文件扫描零命中。
- [x] M08-F07：approve 分支完成并产生 Windows Tool 副作用；reject 分支进入 cancelled、无 `tool.finished`、无文件副作用且存在 `approval.denied` 审计。
- [x] M09-F01：Android 在 Run 创建和 Approval 决策已提交到 Windows Runtime 后各丢弃一次响应；使用稳定幂等键恢复，最终 Run 绑定 1、批准事件 1、Artifact 副作用 1，未产生重复对象。
- [x] M09-F05：HAI/Relay 五类存储、Android APK/Room/cache/no-backup/logcat、Windows DPAPI/Runtime DB/Relay DB/log/诊断包完成 6 类 canary 及常见编码变体零泄漏扫描；Runtime checkpoint 改为 AES-GCM 加密且数据密钥由当前 Windows 用户 DPAPI 保护。
- [x] JVM 全回归 206/206；androidTest 编译通过；三星真机 Room lifecycle 1/1。
- [x] 三星真机 association Manifest 深链专项 1/1。
- [ ] 三星设备 Compose 测试 Activity 被系统暂停，尚缺 Compose 真机 UI 证据。

### 下一步门禁

1. Windows 创建 access grant，Android 使用真实 OIDC 扫码建立 association；
2. Android 真机读取 Windows 主机、active Workspace、存量 Session 和 Conversation；
3. 真机发送消息并完成 Approval，核验 Agent 只在 Windows 执行；
4. 在真实 bearer 上验证关联撤销立即断流、目录消失和重新扫码恢复；
5. 补 Compose 真机宿主和 1 小时稳定性。

### 机器可读验收账本

- 已生成 `release/product-evidence/mobile-remote-workspace-v2/acceptance.json`；
- 严格对应方案中的 80 个功能点，当前 `local_pass=71`、`full_pass=0`、`unverified=9`；
- 新增 `scripts/smoke_runtime_relay_public_v2.py`；ai-dev 匿名公网实测 health、V2 OpenAPI、v1/v2 401 错误信封及非法 WSS token 拒绝均通过，脱敏证据为 `ai-dev-public-smoke-anonymous.json`；
- M10-F03 暂不计通过：仍需 Android OIDC bearer 完成签名分页游标与真实 Runtime Workspace 的非破坏性认证探测；
- V2 WSS 无效 Runtime token 的 HTTP 500 已修复；v1/v2 公网复测均返回结构化 HTTP 401，匿名 smoke 当前全部通过；
- Python/Android/Desktop 已共用 `secret-redaction-fixtures.json` 并覆盖 OIDC、Runtime token、grant、消息和命令参数；新增可递归检查 APK/ZIP/DB/日志的 canary 扫描器，缺失或空产物会 fail closed，相关安全回归 19 passed、1 skipped；
- M09-F05 已完成本地三端门禁：HAI/Relay 部分与 Android、Windows 端侧证据合并后，APK/日志/Room/no-backup/Relay DB/Runtime DB/DPAPI/checkpoint/诊断包均为零泄漏；
- 新增 1 小时稳定性监控器，持续采集 Relay P95、Runtime generation、Android 进程、Windows 内存/句柄斜率和 transcript hash，并在每个采样周期原子更新证据；
- 1 小时监控器已改为 fail-closed：任何 probe error、空 Workspace、缺 Android/Windows 进程或资源计数、缺 transcript hash、P95≥2s、generation/hash 漂移均不得通过；
- 稳定性 transcript hash 已从 Event 元数据升级为 Android 实际 Conversation Projection 的确定性摘要，覆盖投影后的角色、正文和工具进度；报告仍只保存 SHA-256，不保存用户消息或模型输出；
- 真实设备验收驱动已改为仅调用受实例令牌保护的 Windows Gateway loopback 配对 API；验收进程不再直接解密或持有 Runtime DPAPI registration token，相关回归 6 passed；
- M10-F06 真机阶段已实现指定 Workspace/Agent Definition 的会话创建、唯一消息、SSE 实时事件、Approval 批准、Run 终态与 Conversation Projection 增量校验；报告仅保存消息 SHA-256，Android instrumentation 编译成功并已安装到三星真机；
- M10-F05/F06 不再仅以 Android Repository 调用作为 UI 证据：新增严格的 `opendrsai://remote`、Workspace、Session 路由，真机测试实际启动主 Activity 并从无障碍语义树断言主机、所有 active Workspace、Session 列表和交互会话可见；路由单测和 instrumentation 编译通过，最新 APK 已覆盖安装且保留应用数据；
- M10-F05 生命周期验收已加强：真实驱动从 Windows Runtime 权威接口脱敏统计 active/archived/removed；若缺 archived/removed 会创建并立即转入隐藏状态的临时 Workspace 夹具，最终要求 active≥2、archived≥1、removed≥1，同时 Android 公网目录只能返回 `active`；
- Windows Gateway 已新增实例令牌保护、无副作用的 `/v1/mobile-pairing/diagnostics/workspace-lifecycles`，只返回 lifecycle 聚合计数且不读取到驱动报告中的 path/ID；无令牌为 401。真实 Runtime 已准备 `active=4, archived=1, removed=1` 并重启加载该接口，runtime_id 保持不变；
- 正确的 ai-dev 管理任务确认：公网 Workspace GET 必须经过 OIDC association/scope，且会更新 projection，不适合作为“无副作用全生命周期诊断”；它只对外返回 active 且无 path。验收因此明确采用 Windows 本地权威聚合计数 + Android 公网 active-only UI 两侧交叉证明，不绕过 Relay 认证边界；
- Runtime 重启后的 ai-dev Redis presence 已由正确管理任务只读复核：generation=`90`、version=`2.0.0`，TTL 在 10 秒采样间隔内由 39 秒回升至 44 秒，证明 WSS 重连与 heartbeat lease 续租正常；未请求 Workspace 或读取/修改 association、enrollment、凭据；
- M10-F07 驱动已增加受控 Runtime shutdown、同状态目录重启、Gateway readiness、Android Relay 目录恢复，以及 ai-dev connection-owner restart 故障注入；故障后必须证明 generation 增长、单 Run、Event 数量与 SHA-256、Conversation Projection 均保持一致；
- M10-F07 断网阶段已由“任意 instrumentation 失败”收紧为 Android 发起真实无缓存 Relay 请求并且只接受 `IOException` 网络失败；报告仅保留 `network_failure=true` 与异常类名，其他崩溃不能冒充断网通过；
- ai-dev 受控故障注入已由正确管理任务 `019f5208-0f19-7883-b3e2-4dcc8ffa4b61` 提交为 `13965e453108cdd5d6f579fac794e60a2bd8e498`：默认关闭、固定 Runtime allowlist、Runtime Token 鉴权、TTL route pause、1012 detach 与结构化审计；独立回环 Redis 验收 `1 passed` 且 key/listener/临时目录清理完成；
- 正确的 ai-dev 管理任务已按实际 checkout、PM2、Git、PostgreSQL migration 和公开路由完成只读复核：当前 HEAD 为 `13965e453108cdd5d6f579fac794e60a2bd8e498`、Alembic current/head 均为 `9a06b67b28bf`，此前 Relay revisions 均为当前 HEAD 祖先；错误任务 `019f9a52-b494-7461-a589-27e24d64e526` 的 ai-dev 部署声明已作废，不再单独作为验收证据；
- 1 小时监控不再要求 Windows 持有 Android bearer：debug-only Android Receiver 从 `SecureTokenStore` 端内读取凭据，只向 ADB 输出 nonce、状态、generation、Workspace 数和 transcript SHA-256；监控器先启动主 Activity、使用 foreground receiver，并要求整个窗口 Android PID 与 Runtime generation 均严格不变。定向回归 `12 passed`，debug/main androidTest 均构建并覆盖安装；三星真机未登录探针得到脱敏 `stability_oidc_login_required`，未输出 bearer；
- 发布汇总器现在强制校验真机目录页和交互页 PNG 文件及 SHA-256，不再以 JSON 声明代替截图证据；同时强制校验后台、进程死亡、网络、Runtime、Relay 故障和重新关联的恢复证据；
- 撤销验收不再只检查 Runtime 从目录消失：真机还必须使用旧资源 ID 请求 Workspace 与 Conversation，两者均返回真实 `403` 后才能通过；
- M10-F08 发布汇总器已强制解析 Python/Android JUnit XML；缺报告、测试数不足、XML 损坏或任一 failure/error 均阻止 80 项升级。当前证据为 Python JUnit `537 testcases`（`534 passed, 3 skipped`、另有 `81 subtests passed`）和 Android JVM JUnit `208 tests, 0 failures, 0 errors`；
- 协议目录迁移到 `cores/protocol` 后的残留路径、monorepo `node-pty` 查找、GFS 截断元数据和 TUI 测试目录隔离已修复；
- Android JVM 全套 `207 passed`，androidTest 编译与打包成功，最新 main/test APK 已覆盖安装到三星真机；
- 三星真机已解锁验证过，但当前调试包的 OIDC access token 为空；已退出失效的残留用户状态并打开 HepAI 登录页。未完成真实重新登录前，M10-F04～F07 不提前计通过；
- M09-F08 暂不计通过：监控器须在真实 association 建立后完整运行 3600 秒。
- 新增真实设备配对驱动脚本：Runtime grant code/payload 只在进程内传给 ADB deep link，报告永不包含临时代码；登录完成后可自动等待 consumed 并输出脱敏证据。
- 新增真实设备完整驱动 `accept_mobile_remote_workspace_real_device_v2.py`：登录后自动执行清理旧关联、扫码前不可见、两次真实 Grant、目录/Session/Conversation、跨 Runtime/Workspace IDOR、后台、杀进程、断网恢复、撤销后不可见及重新关联；当前未登录探测按设计在创建 Grant 前失败。
- 新增单命令本地闭环 `scripts/accept_mobile_remote_workspace_local_e2e_v2.py`：Android API 35 Emulator 经真实 HTTP 连接本地 Relay 与 Windows Full Runtime，完成注册/心跳、grant association、Workspace/Session、Run、Approval、Tool 与 Artifact；脱敏报告为 `local-emulator-e2e.json`。
- `scripts/mobile_remote_workspace_acceptance_v2.py --check` 校验方案漂移、重复 ID、证据文件和 Secret；
- `--require-release-ready` 在未达到 80/80、缺三端证据或缺 1 小时稳定性时强制失败；
- 账本门禁专项测试：3/3 通过。
