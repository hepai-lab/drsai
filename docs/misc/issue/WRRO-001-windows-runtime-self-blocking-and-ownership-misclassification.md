# WRRO-001：Windows Runtime 自阻塞与所有权误判故障

## 状态

- 严重级别：S1（本地核心能力不可用，工作树和 Workspace 操作持续失败）
- 影响平台：Windows Desktop，开发版和持久化 Runtime 模式
- 首次确认：2026-08-04
- 修复阶段：Windows Runtime 单主控与 Relay 隔离治理阶段
- 用户可见错误：`LocalRuntimeUnavailableError (gateway_probe_timeout)`，并误报“非 OpenDrSai 进程占用 Runtime 端口”

## 一句话定义

Windows Runtime Relay 在 Gateway 的交互事件循环中同步扫描大体量 SQLite、通过 HTTP 回环调用同一个 Gateway，并逐事件提交游标，导致 Gateway 自阻塞；Desktop 又把受管 Runtime 的瞬时探测超时误判为外部端口冲突，轮询重试进一步放大故障。

## 现场证据

2026-08-04 的故障现场满足以下条件：

| 证据 | 观察值 | 结论 |
| --- | ---: | --- |
| 18642 监听者 | OpenDrSai 启动的 `C:\Python311\python.exe` | 不是陌生进程占端口 |
| 带实例 Token 的 `/health` | HTTP 200，曾耗时约 917ms | Gateway 存活但繁忙 |
| Desktop 探测超时 | 1200ms | 繁忙时容易产生假阴性 |
| `engine.sqlite3` | 约 1.58GB | 历史 Journal 已异常膨胀 |
| Session Journal / OAEP | 各 680,008 行 | 投影事件被大量重复追加 |
| OAEP Relay 待处理 | 11,162 条 | 新 Relay 激活后追赶旧积压 |
| Relay 游标 | 观察期间不前进 | 不是正常的短时追赶 |
| Python 主线程 | 接近占满一个 CPU 核 | 交互事件循环被同步工作挤占 |
| TCP 状态 | 大量 `TIME_WAIT` 和并行 Electron→Python 连接 | Desktop 重复探测形成放大器 |
| Electron 警告 | `MaxListenersExceededWarning` | WebContents 订阅销毁监听器重复注册 |

历史事件主要集中于 2026-07-17 至 2026-07-21：`session.updated` 476,960 条，`session.archived` 162,565 条。部分归档 Session 产生约 10,840 次 archive 事件。事件的 dedupe key 包含 revision，因而每次更新都天然唯一，无法阻止状态抖动。

## 根因

### R1：Relay 和交互 Gateway 共用事件循环

Runtime Relay 在 FastAPI/Uvicorn 所在 Python 进程中启动。三个事件转发循环每秒独立执行，SQLite 访问为同步调用。OAEP provider 一页最多获取 2,000 条事件，没有字节预算、时间片或交互优先级。

### R2：Relay 通过 HTTP 调用自身

`AiohttpGatewayTransport` 为每次请求创建新的 `ClientSession`，Relay 再通过 `127.0.0.1:18642` 调用同一个 Gateway。OAEP 路由还会触发 Desktop Session 同步，造成不必要的目录扫描、序列化和连接生命周期成本。

### R3：OAEP 游标逐事件持久化

每写出一个 WSS OAEP frame 就打开 SQLite、更新一行并提交一次事务。大积压时，写放大与上下文切换直接占用 Gateway 的事件循环。

### R4：升级水位不完整

首次创建 Relay 控制库时会把历史 Session 水位设为当前快照，但已经存在的 `relay_oaep_event_cursors=0` 使用 `ON CONFLICT DO NOTHING`，升级后不会被重新基线化，导致新版本自动重放任意久远的历史投影。

### R5：Session 投影缺少业务 no-op

`import_session` 把 `updated_at` 变化视为业务变化，`update_session` 即使状态完全相同也增加 revision 和追加 Journal。重复同步、时间戳格式差异或生命周期抖动会造成无界事件增长。

### R6：Desktop 所有权依赖健康探测结果

开发托管或 external Runtime 只有在 `probe.ready` 时才被标记为 managed。超时会把同一进程翻转成 unmanaged，随后 `portOpen && !managed` 被报告为外部冲突。`LocalRuntimeClient.connect()` 又连续执行启动和状态探测。

### R7：UI 轮询和 WebContents 生命周期放大故障

工作树事件每 5 秒轮询。Runtime degraded 后没有指数退避，连接失败会持续触发启动/探测。线程快照每次订阅都会添加一个 `destroyed` listener，重订阅后超过 EventEmitter 默认上限。

## 非解决方案

以下操作只能隐藏或延后故障，不作为验收通过条件：

- 只把 1200ms 调成更大的超时；
- 只杀掉 18642 的 Python 进程或重启 Desktop；
- 调用 `setMaxListeners()` 压制警告；
- 删除 Relay 凭据、关闭移动端能力或清空 `engine.sqlite3`；
- 在没有快照、备份和 Relay 水位校验的情况下直接删除 Journal 行。

## 一次性解决方案

### A. Desktop Runtime 单主控

1. Gateway 探测使用 single-flight 和短期缓存，所有并发调用共享一次结果。
2. 受管身份与健康状态正交：Desktop 子进程、显式 dev-managed、external 模式或曾通过实例 Token 验证的持久化 Runtime，在瞬时超时期间仍保持 managed。
3. 将状态区分为 ready、busy/degraded、unauthorized、foreign-port 和 unreachable；只有未经身份验证的端口占用才能报告 external conflict。
4. `startGateway()` 对已确认受管但繁忙的 Runtime 不启动第二进程，也不把它报告为陌生进程。
5. 探测超时可配置，默认提供足够的调度余量；缓存用于消除 `connect → start → status` 的重复探测，而不是掩盖长期延迟。

### B. Relay 有界化与交互隔离

本阶段采用可验证的进程内隔离，后续可平滑迁移为独立 Relay worker：

1. OAEP 热路径直接从只读 SQLite 投影读取，不再 HTTP 调用自身。
2. SQLite 扫描通过 `asyncio.to_thread` 离开 Gateway 事件循环。
3. 每个批次同时限制事件数和序列化字节数；限制并发 Session 数。
4. Run、legacy Session、OAEP 三类 provider 共享调度锁，不能同时扫描数据库和回环请求。
5. OAEP WSS 写出成功后按 Session 合并最高 sequence，以一个 SQLite 事务批量提交游标。
6. Relay 连接错误保持可恢复，但使用有界轮询和退避，不允许无上限追赶挤占健康检查。

最终架构目标仍是独立 Relay 进程：独立事件循环、受限 CPU/内存、只读数据通道和批量 ACK IPC。当前实现必须先满足同等的交互隔离验收指标，才允许发布。

### C. 升级基线和数据增长治理

1. Relay 控制库增加带版本的 OAEP baseline metadata。
2. 第一次升级到新 baseline 时，将已有 Session 的 OAEP cursor 单调提升到当前快照；远端通过 snapshot 建立状态，从 baseline 之后继续增量，不自动洪泛历史投影。
3. baseline 创建后，新 Session 仍从 sequence 0 增量发送；Runtime 重启不得跳过尚未 ACK 的新事件。
4. `import_session` 仅在 title、lifecycle、agent definition 或 backend 等业务投影变化时追加事件；单独的 `updated_at` 漂移是 no-op。
5. `update_session` 在事务内重新读取状态，相同 title/lifecycle 直接返回，不增加 revision。
6. 离线维护工具必须支持 dry-run、SQLite 一致性备份、checkpoint、按最小 Relay ACK 水位压缩、`integrity_check`、VACUUM 和原子替换；原数据库作为可恢复备份保留。

### D. Desktop 退化和监听器治理

1. 工作树轮询遇到可重试 Runtime degraded 后指数退避，恢复成功后重置。
2. UI 保留最后一次成功投影并显示“Runtime 正在恢复”，不能每次清空列表。
3. 每个 WebContents 只注册一个 Runtime subscription cleanup listener；销毁时集中清理订阅、timer 和 busy 状态。

## 数据安全不变量

- 不删除 Runtime Session、Run、Conversation Item 或 Workspace Registry。
- 只有存在 checkpoint 且压缩边界不超过 legacy 与 OAEP 两个 Relay ACK 水位时，才允许删除旧 Journal。
- 所有游标只能单调前进。
- WSS 写出失败不得提交对应 OAEP 游标。
- baseline 只执行一次；正常重启不能把未确认的增量提升到最新水位。
- 维护前后必须通过 `PRAGMA integrity_check`，失败时不能替换原数据库。

## 测试矩阵

| 层级 | 必测场景 |
| --- | --- |
| Desktop 单元/集成 | 慢但带正确 Token 的 Gateway、未经授权 Gateway、非 HTTP 端口占用、20 个并发 connect、瞬时 timeout 后恢复 |
| Relay 单元 | 旧 cursor=0 的一次性 baseline、重启保留未 ACK 增量、批量 ACK、WSS 中途失败不 ACK、事件数和字节预算 |
| Runtime Engine | import 仅时间戳变化不追加事件、重复 update no-op、并发重复 update 只产生一次 revision |
| 数据维护 | 合成大库 dry-run、备份、压缩、游标边界、完整性校验、恢复快照、过期游标返回 cursor_expired |
| 压力/浸泡 | 至少 70 万 Journal/OAEP 行、1.5GB 级数据、1.1 万模拟积压，同时执行 `/health` 和工作树轮询 |
| Electron 生命周期 | 同一 WebContents 重订阅超过 20 次，无 MaxListeners warning，销毁后无遗留订阅 |

## 发布验收标准

所有条件必须同时满足：

1. 有效受管 Runtime 在慢响应时显示 managed/degraded，不显示 external conflict。
2. `/health` 在 Relay 积压压力下 P99 小于 500ms，目标值 250ms。
3. Relay cursor 单调前进；网络失败时停在最后成功写出的位置。
4. Relay 单批不超过配置的事件数/字节预算，游标每批最多一次事务提交。
5. 空闲 CPU 低于 15%；积压追赶时 Relay 不长期占满单核，交互 API 保持可用。
6. 工作树轮询失败后发生退避，TCP `TIME_WAIT` 不持续线性增长。
7. 重复 Session 同步不会新增 Journal；无 `MaxListenersExceededWarning`。
8. 压缩前后 Session、Run、Conversation snapshot 和当前 OAEP snapshot 一致，SQLite 完整性校验通过。
9. Windows 开发版、非持久 Runtime、持久 Runtime 和 external Runtime 的生命周期测试全部通过。

## 实施顺序

1. Desktop 所有权状态机、single-flight 探测和慢 Gateway 回归测试。
2. OAEP baseline、水位迁移、直接有界读取和批量 ACK。
3. Session import/update no-op 与并发测试。
4. UI 轮询退避和 WebContents listener 去重。
5. 离线维护工具及合成大库验证。
6. Windows Runtime 集成、压力和故障恢复验收。

## 回滚策略

- Desktop 探测改动可独立回滚，不改变 Runtime 数据。
- Relay baseline 只做游标单调提升；回滚不会删除本地事件，远端可重新获取 snapshot。
- 数据维护工具执行后保留带时间戳的完整原库备份；若启动或完整性验证失败，停止 Runtime 后原子恢复备份。
- 不通过删除凭据回滚，因为这会破坏已注册移动端的控制平面身份。

## 2026-08-04 实施与验证记录

已完成的代码治理：

- Desktop Gateway 所有权与健康状态解耦、探测 single-flight/缓存、慢受管 Runtime 分类；
- 工作树 degraded 指数退避并保留最后成功投影；
- WebContents 线程订阅销毁 listener 去重；
- OAEP 升级 baseline metadata 和旧 `0` cursor 一次性对账；
- Relay 工作区目录、Run Event、Session Journal 与 OAEP 全部改为本地只读 SQLite 通道，热路径不再回调本进程 HTTP 端口；
- SQLite 工作移出事件循环、三 provider 串行调度、空闲指数退避、OAEP 数量/字节双预算和 WSS 后批量 ACK；
- `import_session` 时间戳漂移 no-op、`update_session` 事务内并发 no-op；
- 离线修复工具 `cores/python/packages/drsai/scripts/repair_wrro_001_runtime.py`，默认 dry-run，apply 模式保留原库备份并校验关键投影 hash；
- 生产量级稳定性验证器 `cores/python/packages/drsai/scripts/verify_wrro_001_stability.py`。

生产量级合成验收结果：

| 项目 | 结果 |
| --- | ---: |
| 合成 SQLite 大小 | 2,879,184,896 bytes |
| 历史 OAEP 事件 | 680,000 |
| Session 数 | 181 |
| 新增 Relay 积压 | 11,162，全部推进 |
| Relay 批次数 | 112 |
| OAEP 回环 HTTP | 0 |
| 游标 | 全程单调 |
| 事件循环额外延迟 P99 | 1.102ms |
| 事件循环最大额外延迟 | 1.621ms |

代码级回归结果：

- Python WRRO-001 相关测试：71 passed；
- Desktop Runtime health、Worktree UI、Session subscription、Runtime client、Runtime reliability、OAEP 合约：全部通过；
- 本地数据通道回归明确断言 Workspace、Run、Session、OAEP 增量转发均不产生 Gateway 回环请求；
- Windows 生命周期矩阵此前已在提升权限环境通过；普通沙箱复跑只在测试清理阶段被 `taskkill` 权限拒绝，非产品断言失败。

真实用户库只读 dry-run 结果（未修改真实数据）：

| 项目 | 结果 |
| --- | ---: |
| `engine.sqlite3` | 1,579,036,672 bytes |
| `PRAGMA integrity_check` | `ok` |
| Journal / OAEP | 680,008 / 680,008 |
| 保留尾部 | 每 Session 100 条 |
| 可安全处理的 Session | 87 |
| 双 Relay ACK 水位内可压缩 Journal | 669,932 条 |
| 估算可移除 JSON payload | 703,192,007 bytes |

真实库 apply 必须在 Runtime 停止后进行。工具会先构建 staging 库、建立 checkpoint、验证关键 Session/Run/Event/Item 投影 fingerprint 和 SQLite 完整性，再将未修改的原数据库保留为 `*.pre-wrro-001.sqlite3`。这一步不能在 Runtime 在线时强行执行。

真实生产数据副本的完整 `--apply` 验收（在线原库未修改）：

| 项目 | 压缩前 | 压缩后 |
| --- | ---: | ---: |
| 数据库大小 | 1,579,089,920 bytes | 85,671,936 bytes |
| Journal | 680,008 | 10,076 |
| OAEP Event | 680,008 | 10,076 |
| Session / Run / Run Event | 181 / 299 / 32,277 | 181 / 299 / 32,277 |
| Conversation Item / OAEP Item | 3,315 / 3,315 | 3,315 / 3,315 |
| `PRAGMA integrity_check` | `ok` | `ok` |

实际安全移除 669,932 条历史事件，数据库缩小约 94.6%。工具生成的五组关键表 SHA-256 指纹在压缩前后完全一致，未压缩原副本作为 `engine.pre-wrro-001.sqlite3` 保留；随后又使用独立 SQLite 连接复核了压缩库和备份库的完整性与行数。

在上述压缩后的真实生产副本上，连续执行 100 轮 Workspace/Run/Session/OAEP provider（共 400 次调用）：初始化 17.291ms，总耗时 836.143ms，事件循环额外延迟 P99 1.016ms，HTTP 回环调用为 0。空闲运行时实际采用最高 4 秒退避，不会以该无间隔压测频率持续执行。

## 真实 Windows App 最终闭环（2026-08-04）

首次对真实库执行压缩后，启动迁移曾把已经有意压缩的 `runtime-event:*` Journal 投影误判为缺失并重新生成，数据库从 86,577,152 bytes 回长到 198,172,672 bytes。进一步剖析还发现两个独立放大器：

1. OAEP Relay 将 31,018 条重建副本视为新 backlog；远端拒绝重复语义后，客户端整批不 ACK 并持续重试。
2. Desktop 的 Runtime Thread Catalog 每 5 秒遍历所有未归档历史任务，为每个任务执行完整历史同步、`/v1/capabilities`、OAEP snapshot/replay；20 秒剖析中产生 672 个 Runtime HTTP 请求，并重复启动 `codex --version` 探测。

最终治理补充如下：

- `runtime_session_journal_compacted_runtime_events` 精确保存被压缩 Runtime Event 的身份墓碑；重启迁移先检查墓碑，既不复活旧投影，也不阻止压缩后新增 Event。
- OAEP 自愈只跳过连续且同时满足 `migrated=true`、`runtime-event:*` 去重键、源 `runtime_events` 行存在的重建副本；遇到任何真实新事件立即停止跳过并正常发送。
- 不在 Relay 发布目录内的 Workspace Session 以本地完整 snapshot 建立水位，避免永久 pending 扫描。
- `AgentRunWorkspace` 不再为每个挂载实例启动独立 Gateway 轮询，统一消费顶层健康状态。
- Runtime Thread Catalog 只同步非当前且 `status=running` 的后台任务，周期从 5 秒调整为 15 秒；活动任务继续使用 OAEP 实时订阅，历史 idle 任务不参与轮询。

真实用户库最终离线压缩与重启验收：

| 项目 | 最终结果 |
| --- | ---: |
| 最终压缩前 / 后 | 184,066,048 / 87,756,800 bytes |
| 最终安全移除 | 28,893 条重建历史投影 |
| 重启后 Journal / OAEP | 10,076 / 10,076 |
| 压缩墓碑 | 29,439 |
| Session / Run / Run Event | 181 / 299 / 32,277，指纹不变 |
| Conversation Item / OAEP Item | 3,315 / 3,315，指纹不变 |
| SQLite | `PRAGMA integrity_check = ok` |
| Legacy / OAEP Relay lag | 0 / 0 |
| 重启后 45 秒数据库大小 | 87,756,800 → 87,756,800 bytes |
| Runtime 空闲单核 CPU | 0.59%（此前 33.75%） |
| 认证 `/health` 60 次 | P50 0.98ms，P95 1.59ms，P99/最大 81.70ms |
| TIME_WAIT | 不再线性增长；空闲样本由 611 回落到 378 |

最终回滚备份保留在：

- `C:\Users\win11\.drsai\runtime\engine.pre-wrro-001-20260804.sqlite3`（首次修复前完整原库）；
- `C:\Users\win11\.drsai\runtime\engine.pre-wrro-001-final-20260804.sqlite3`（复活问题分析现场）；
- `C:\Users\win11\.drsai\runtime\engine.pre-wrro-001-verified-20260804.sqlite3`（最终压缩前完整库）。

最终回归：Python 相关矩阵 76 passed；Desktop Runtime health、Worktree UI、Session subscription、Runtime Client、Runtime reliability、OAEP contract 全部通过；Node 主进程 typecheck 通过。完整 Renderer typecheck 仍被用户现有未跟踪文件 `RunInspectorPanel.tsx` 的既存 nullable 错误阻挡，该错误不属于 WRRO-001 修改范围。
