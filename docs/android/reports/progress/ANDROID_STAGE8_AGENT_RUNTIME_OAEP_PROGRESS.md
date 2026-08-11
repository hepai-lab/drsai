# Android 第 8 阶段 Agent Runtime OAEP 化进度

> 目标：Android v1.6.0 / OAEP Stable 1.0 / `oaep.session-stream/1`  
> 总口径：12 个模块、72 个功能点  
> 当前轮次：第 23 轮（最终）  
> 更新时间：2026-08-04

## 总进度

- 已验收：72/72
- 实现中：0/72
- 未开始或证据不足：0/72
- 严格完成率：**100%**

“已验收”只统计具备代码/契约产物及自动测试证据的项目；既有能力在完成第 8 阶段专项核验前不预先计入。

## 第 23 轮结果（最终 Go）

### 新增已验收

- M12-F01：系统版本升至 Android Agent Runtime v1.6.0（versionCode 10600）；生成可追溯 MVP/acceptance 候选、R8 mapping、CycloneDX 1.5 SBOM 和发布 manifest。manifest 关联 commit、dirty tree 摘要、APK SHA-256 `5f3e49b2…a4824`、mapping SHA-256 `881b9cc3…f26e`、OAEP Schema SHA-256 `92020971…11ae` 及全部前置证据。
- M12-F02：新增不可变 `AndroidOaepReleaseGate` 并接入生产 `RelayRemoteRepository`；仅 Android Runtime ≥1.6.0、OAEP 1.0、`oaep.session-stream/1` 与五项必需 capability 全部满足时启用完全 OAEP，部分声明 fail closed，无 OAEP 的既有 Relay 仅允许安全远程降级。
- M12-F03：Internal/Canary/Beta 1/5/20/50/100 七档样本量与 48–336 小时窗口固化；样本不足/窗口不足 hold，崩溃率超限自动 pause，重复副作用、数据破坏或安全事件立即 kill switch。七个决策场景全部通过且与生产 Kotlin 策略一致。
- M12-F04：Samsung SM-X936C 真机完成 v1.5.4（10504）→v1.6.0（10600）→v1.5.4（10504）真实 APK 升级/降级；kill switch 前后及降级后同一 Session/Run/Message 均可读，Snapshot digest 始终为 `2cabdb96…f8a8`。
- M12-F05：发布事实权威永久固定为 `OAEP_SNAPSHOT`，不存在可变/可启用的 legacy/private fact authority；既有 Legacy 代码只保留单向迁移、审计和从 OAEP Snapshot 到旧 UI 模型的只读投影。
- M12-F06：最终聚合器确认计划 72 个唯一功能点、九类发布/真机/跨端/安全/性能证据均通过，结论为 `GO`。

### 本轮实现与修复

- 新增 OAEP 发布契约、最低版本/能力协商、唯一事实源锁定及三项 JVM 专项测试；生产 Relay 协商不再维护第二套隐式判断。
- 新增 v1.6.0 候选 manifest/SBOM、灰度策略、事实源退场、真机 APK 回滚及最终 Go/No-Go 五个自动验收器。
- 新增持久化真机回滚测试夹具；同签名双版本在保留 app data 的条件下验证 OAEP Room 数据跨升级和降级兼容。
- 在 v1.6.0 源码上重跑 Android→Desktop、Desktop→Android SSE 断线续传及跨端审批竞态 E2E。

### 本轮自动测试证据

1. Android Debug JVM 完整回归：344 passed，0 failed。
2. Python OAEP Protocol/Digest/Delta/Relay/Four-path：53 passed，0 failed；OAEP codegen drift check 通过。
3. Samsung 真机 APK 回滚：3 passed，0 failed；版本转换 1.5.4→1.6.0→1.5.4，OAEP digest 不变。
4. Samsung 真机跨端 E2E：双向各 9 Event；SSE cursor=4 重连后实时接收 5 Event；四次审批竞态仅 1 次迁移、1 次副作用、1 个 receipt。
5. 发布/灰度/事实源/最终聚合自动门禁全部通过；最终证据为 `android-agent-runtime-final-go-no-go.json`。
6. 当前累计有效自动测试证据：434 passed，0 failed；设备矩阵、属性生成、压力 Run 与灰度决策子场景另行记录，不重复计入唯一测试数。

### 最终结论

- Android Agent Runtime 的确认发布版本为 **v1.6.0**。
- 第 8 阶段 72/72 已验收，S1–S6 全部门禁关闭；当前结论为 **GO**。
- 发布 manifest 如实记录当前工作树 `dirty=true`，因此该候选可追溯但不是“干净提交”产物；正式分发前仍应在目标提交的 clean CI 中复现同一 manifest，不影响本开发阶段功能验收结论。

## 第 22 轮结果

### 新增已验收

- M11-F01：新增 400 组确定性属性场景；100 组随机语义流验证重复幂等与实时/重放 digest，100 组乱序、100 组缺口均 fail closed，100 组批事务崩溃点全量回滚，并覆盖 completed/cancelled/failed 后续写拒绝。
- M11-F02：共享 `examples.json` 的 OAEP Snapshot、11 Event 数组和完整文档分别产生固定 canonical SHA-256；Python/Desktop 生成 parity manifest，Android 独立 canonicalizer 对三组 hash 全部精确匹配。
- M11-F03：API 26/30/35 x86_64 模拟器及 API 36 arm64 Samsung SM-X936C 均执行完整 11 项 OAEP Store 套件；44/44 通过，覆盖最低 API、目标 API、两种 ABI 和物理设备。
- M11-F04：真机完成 500 Run、50 Tool、20 Recovery 持久化压力；side-effect execution=50、duplicate=0、data corruption=0、permanent running=0。
- M11-F05：同一真机候选冷启动 P95 449 ms、前台 PSS 99.132 MB、20 次恢复 P95 9.925 ms、500 Run 数据库 4,120,576 bytes；全部优于第 7 阶段 3 s/220 MB 门槛及本阶段 2 s/64 MB 恢复存储门槛。
- M11-F06：动态 Token、绝对路径、私有正文及跨账户 canary 真机注入后，OAEP/Checkpoint/Receipt、主 APK、完整 logcat 和流式 app data 扫描均 0 命中；通用 Private Key/Bearer/API Key/JWT APK 扫描 0 命中，跨账户读取 0。

### 本轮实现与修复

- 新增 Android OAEP property suite、共享 cross-runtime parity manifest/collector、四设备自动 AVD 矩阵脚本、真机压力/性能 collector 和动态安全 canary collector。
- 压力数据库使用真实文件 Room，逐 Run 验证 Snapshot 终态；20 个尾部 Run 在中途销毁 Writer、从 Room 重建后继续同一 Run/sequence。
- 冷启动使用 Android 16 `WaitTime`/旧系统 `TotalTime` 兼容采集，10 次均先 force-stop；PSS 来自真实主进程 `dumpsys meminfo`。
- 安全门禁将 Runtime credential 留在 `EncryptedSharedPreferences` 供扫描，OAEP 未知事件只持久化脱敏 Notice；app data 通过 `run-as tar` 流式扫描，不在主机落原始用户数据。

### 本轮自动测试证据

1. OAEP 属性与 Android parity：5 passed，0 failed；内部覆盖 403 个生成/终态场景。
2. 设备矩阵：4 台配置 × 11 tests = 44 passed，0 failed。
3. Samsung 真机压力/性能：1 passed，0 failed；500/50/20 全门禁通过。
4. Samsung 真机安全 canary：1 passed，0 failed；三源动态扫描与 APK 通用扫描通过。
5. 证据：`android-agent-runtime-oaep-parity.json`、`android-agent-runtime-device-matrix.json`、`android-agent-runtime-stress-performance.json`、`android-agent-runtime-security.json`。
6. 当前累计有效自动测试证据：412 passed，0 failed；设备/生成子场景另按上述矩阵记录，不重复计入唯一测试数。

### 仍未计为完成

- M12 六项发布门禁尚待关闭；当前 debug APK 文件名仍显示 v1.5.4，必须先形成真实 v1.6.0 可追溯候选，不能用本轮测试包冒充发布候选。

## 第 21 轮结果

### 新增已验收

- M02-F02：新增 `BackendItemId`、`AndroidRuntimeScopeId`、`OaepRuntimeId`、`OaepItemId` 四种不可互换的 Kotlin value class；Writer 的 Backend→OAEP binding 改为强类型 Map，Android 本地数据库 scope 与 Relay/OAEP source 在 Scope 构造时分别验证。错误指向不存在 OAEP Item 的 binding 在产生任何新 Event 前失败并回滚 Writer state。
- M02-F05：未知 Runtime 事件只允许输出固定 category 和 64 字符安全标签；路径、空格正文、超长值以及 bearer/token/secret/credential/api_key 样式直接变为 `redacted`，原始 payload 的 token、path 和敏感正文不进入 OAEP Notice。

### 本轮实现与修复

- Room 仍保存稳定字符串 wire/storage 格式，只在 Store load/write 边界转换强类型 ID，因此无需数据库迁移且冷启动 binding 可无损恢复。
- 增加错误 binding 原子回滚和五组敏感诊断输入专项测试；测试覆盖 Windows/Unix 绝对路径、Bearer、用户正文和超长字段。
- 更新第 18 轮引入 `event.session.created` 后遗留的 7 个真机 Store 水位断言；修正内容均为 sequence +1、首事件类型和对应 compaction 边界，未放宽连续性或 digest 门禁。

### 本轮自动测试证据

1. Android Debug JVM 完整回归：336 passed，0 failed。
2. 新增强类型错误 binding 与诊断泄漏专项：2 passed，0 failed。
3. Samsung SM-X936C `AndroidOaepStoreTest`：11 passed，0 failed；强类型 binding 经 Room 写入、重开、续写、压缩和 Relay enrollment source 边界全部通过。
4. 当前累计有效自动测试证据：405 passed，0 failed。

### 仍未计为完成

- M11/M12：属性、parity、设备矩阵、压力、性能、安全、候选构建、灰度、回滚、兼容桥退场与最终 Go/No-Go 尚未逐项关闭。

## 第 20 轮结果

### 新增已验收

- M09-F06：同一 Samsung SM-X936C/Desktop/Relay harness 中，Android 与 Desktop 对同一 Runtime Approval 并发提交决定。Runtime 为四次到达（两端竞争、同键重放、晚到重放）分配统一顺序，只产生一次 Approval 状态迁移和一个 `approval.resolved`；获胜授权只执行一次外部副作用并持久化一个 receipt，恢复重放命中 receipt、不再次执行。

### 本轮实现与修复

- 三端 harness 新增跨端 Approval race barrier；Android 使用生产 `RelayRemoteRepository.decide`，Desktop 使用标准 Relay HTTP decision API，二者共享同一 Runtime authority 和 subject association。
- Runtime 验收 authority 新增串行决策账本、idempotency result、Approval transition/event 计数和 side-effect receipt；相同幂等键与不同晚到键均返回首个终态，不追加第二次语义事件。
- 增加恢复故障注入：终态后重新进入 side-effect replay，耐久 receipt 阻止外部执行，记录一次 receipt replay。
- 证据文件新增 `cross_end_approval_race`，保留四次统一到达顺序、两端结果、迁移/Event/副作用/receipt/replay 精确计数。

### 本轮自动测试证据

1. Android Debug AndroidTest Kotlin 编译：通过。
2. Samsung SM-X936C 三端双向与审批竞争 E2E：1 passed，0 failed。
3. Approval 竞争：4 次统一排序、1 次状态迁移、1 个 resolved Event、1 次外部副作用、1 个 receipt、1 次恢复 receipt replay。
4. 同轮双向 OAEP 回归继续通过：Android→Desktop P95 94.840 ms；Desktop→Android cursor=4 重连后实时接收 5 Event，最终 digest 一致。
5. 当前累计有效自动测试证据：403 passed，0 failed。

### 仍未计为完成

- M02-F02/F05：需要补齐 ID 类型层隔离专项与诊断元数据泄漏/边界专项，既有运行时校验尚不足以满足硬门禁口径。
- M11/M12：测试、性能、安全、候选构建、灰度、回滚、兼容桥退场与最终 Go/No-Go 尚未逐项关闭。

## 第 19 轮结果

### 新增已验收

- M09-F05：Samsung SM-X936C 真机使用生产 `RelayRemoteRepository` 和 `RelaySseClient` 消费 Desktop Runtime OAEP。首连接接收 sequence 1..4 后主动取消，第二连接从 cursor=4 恢复；Relay 仅在第二连接建立后实时发布剩余 5 个 Event。Android 最终收到 1..9 无重无漏，Event replay、Desktop Snapshot 和预期 Item digest 完全一致。

### 本轮实现与修复

- 扩展物理三端 harness，注册独立 Desktop Runtime/Workspace/Android subject association，并由真实 Relay OAEP replay hub 发布 Desktop 原生 Event、提供标准 Snapshot API 和 SSE。
- Android 真机测试新增反向链路，直接调用生产 Repository/SSE，不使用 MockWebServer 或测试替身传输；首段有限收集会取消底层 HTTP call，重连使用最后已提交 Session sequence。
- 第二段 Event 在重连 `onConnected` 后才进入 Relay live fan-out，区分了缓存回放与实时消费；最终由 Android `AndroidOaepProjector` 从 sequence 1 独立重放并提交消费证明。
- 证据文件 `docs/android/reports/evidence/android-agent-runtime-oaep-local-e2e.json` 现在同时记录 `android_to_desktop` 和 `desktop_to_android`，包括 disconnect cursor、realtime event 数、watermark 和 digest。

### 本轮自动测试证据

1. Android Debug AndroidTest Kotlin 编译：通过。
2. Samsung SM-X936C（Android 16/API 36）三端双向真机 E2E：1 passed，0 failed。
3. Desktop→Android：9 Event，cursor=4 重连，重连后实时接收 5 Event，最终 Snapshot sequence=9 且 digest 一致。
4. Android→Desktop 回归：9 Event，五类结构化 Item 完整，P95 108.494 ms，digest 一致。
5. 当前累计有效自动测试证据：403 passed，0 failed。

### 仍未计为完成

- M09-F06：跨端并发排序、Approval 首决定胜出及 receipt 副作用恰好一次仍需三端故障注入。

## 第 18 轮结果

### 新增已验收

- M09-F03：Samsung SM-X936C 真机 Android Runtime 与主机 Desktop verifier 同时观察同一 Relay Session；9 个 OAEP Event 的结构化 Item 首次出现 P95 为 108.167 ms，低于 2 秒门槛。
- M09-F04：Android 发起的 Message、Tool Call、Approval Interaction、Artifact、Subtask 五类完整语义均由 Desktop Snapshot 和 Event replay 恢复；Android Snapshot、Desktop Snapshot、Desktop replay 的 Item digest 完全一致。

### 本轮实现与修复

- 新增可重复物理设备 harness `accept_android_agent_runtime_oaep_local_e2e.py`：自动构建/安装 APK、ADB reverse、启动真实 Uvicorn Relay、Android Runtime 注册/WSS、Desktop watcher、digest 与 P95 证据输出。
- 修复 Python/Desktop 与 Kotlin/Android digest 对可选空 `message.parts` 的规范化漂移；缺省与空数组现在视为同一 OAEP 语义。
- Android Writer 首次提交时新增 `event.session.created`，Journal 从零即可在 Desktop reducer 重建 Session，不再依赖调用方预置私有状态。
- Relay ACK 改为允许延迟重复 ACK 幂等 no-op；Android 新增连接内 in-flight watermark，同一连接每个 sequence 只发送一次，重连后才从 durable ACK cursor 重试，消除重复帧风暴且不丢 Event。
- 修正 E2E harness 的跨 event-loop 调用与跨设备时钟校准；P95 取 Desktop watcher 首次收到完整 Event page 的时刻，不混入后续 Snapshot 审计耗时。

### 本轮自动测试证据

1. Android Debug JVM 完整回归：334 passed，0 failed。
2. Python OAEP digest/delta parity：23 passed，0 failed。
3. Samsung SM-X936C 三端真机 E2E：1 passed，0 failed；证据文件 `docs/android/reports/evidence/android-agent-runtime-oaep-local-e2e.json`。
4. 当前累计有效自动测试证据：403 passed，0 failed。

### 仍未计为完成

- M09-F05：Desktop→Android 的 OAEP 实时消费、断线重连 cursor 与最终 Snapshot digest 尚未进入同一物理设备 harness。
- M09-F06：跨端并发排序、Approval 首决定胜出及 receipt 副作用恰好一次仍需三端故障注入。

## 第 17 轮结果

### 新增已验收

- M09-F01：Android 本地 Session 已可通过生产 `AndroidOaepRelayManager` 直接发布 Room 权威 OAEP Snapshot；Relay 查询由 `oaep_snapshot_for_subject` 返回规范 Snapshot，链路不读取或推断 Python/Runtime 私有事件。
- M09-F02：Android 已主动建立 Runtime WSS 并发布 OAEP Event 原生帧；只有 `runtime.connected` generation attach 后才发送，Relay 完成 schema/scope/runtime/sequence/generation fence 并返回持久 ACK，Android 仅在 ACK 后推进账户+Runtime+Session 持久 cursor。

### 本轮实现与修复

- 新增 Android Runtime registration client 和账户绑定的加密 credential store；注册使用设备 Ed25519 公钥，Runtime token 不写普通偏好、日志或 OAEP。
- 新增生产 `AndroidOaepRelayManager`：账户加载时自动恢复已注册 Runtime 的 WSS，断线自动重连，登出和 ViewModel 销毁时停止；始终为 Runtime 主动出站，不监听设备端口。
- 分离本地数据库 scope `android-local` 与 OAEP source Runtime identity。注册前历史保持原 source/digest；注册时以当前 Snapshot watermark 播种 cursor，后续 Event 使用服务端注册 Runtime ID，不就地改写 append-only Journal。
- Snapshot Run source 从各 Run 的权威 `event.run.created.data.run` 恢复，允许同一 Session 在注册边界前后保留可审计的两段 source identity。
- Relay 新增 `oaep.event.ack`；精确重传仍返回 ACK，使 Android 在“服务器已接收但客户端未收到 ACK”后可安全重发而不碰撞、不丢 Event。

### 本轮自动测试证据

1. Android Debug JVM 完整回归：333 passed，0 failed。
2. Samsung SM-X936C（Android 16/API 36）`AndroidOaepStoreTest`：11 passed，0 failed；新增真机覆盖注册前 Snapshot watermark、注册后 source Runtime、Session sequence 连续和本地 scope 不变。
3. Python Relay API：21 passed，0 failed；新增真实 WebSocket ACK/精确重传测试。
4. 新增 JVM 覆盖 registration body/public key/账户凭证、历史 Snapshot 播种、generation attach、ACK cursor 和自动发布。
5. 当前累计有效自动测试证据：401 passed，0 failed。

### 仍未计为完成

- M09-F03/F04/F05：仍需在同一真实 Relay 上同时运行 Desktop 与 Android，量化端到端 P95，并验证双向 Message/Tool/Approval/Artifact/Subtask、断线重连和最终 Snapshot digest。
- M09-F06：需把跨端审批竞争与外部副作用 receipt 放入同一三端 E2E；现有本地首决定胜出、Relay ordering 和 ACK 幂等是必要条件，但不是完整验收证据。
- Android Runtime registration 已有 ViewModel 生产入口，但设置界面的注册码交互仍需在发布 UX 阶段补齐；不影响已注册设备的 OAEP 发布协议验收。

## 第 16 轮结果

### 新增实现中（尚未计入已验收）

- M09-F01：新增 Android OAEP Relay authority/protocol，可直接从 Room OAEP Projection 生成规范 Snapshot，并响应 Relay `oaep_snapshot_for_subject` 请求；数据源不接受 Python/Runtime 私有事件。
- M09-F02：新增 Android Runtime 主动 WSS 连接器；完成 `runtime.hello`、Runtime credential header、OAEP capability、原生 Event frame 发布、Session cursor 和重连幂等基础。帧发送前严格校验 version、subject、runtime、workspace、session、连续 sequence 和 watermark。

### 本轮实现与修复

- `OaepJsonCodec` 新增规范 Snapshot/Event Page 编码，Android 本地权威数据不再需要 Relay 反向推断。
- 新增 `AndroidOaepRelayProtocol`，同时承担 Snapshot/Event page 查询和 OAEP Event frame 生成；Relay request 的 subject/workspace/session 任一漂移均 fail closed。
- 新增 `AndroidOaepRelayConnector`，只建立 Runtime 主动发起的 WSS，不监听本地端口；收到 generation attach 成功信号后才开始发送本地 OAEP Event。
- 新增 Runtime/source identity 硬门禁，发现当前生产本地 scope 使用固定 `android-local`，而 Relay 注册 Runtime 使用服务端分配 ID；在身份持久化与 OAEP source migration 完成前不把 M09-F01/F02 计为已验收。

### 本轮自动测试证据

1. Android Debug JVM 完整回归：331 passed，0 failed。
2. 新增 Android OAEP Relay 专项：4 passed，0 failed；覆盖规范 Snapshot、Event page、WSS hello、generation attach 后发布、cursor、账户/Runtime/scope/sequence 漂移拒绝。
3. Python Relay OAEP/API/10k 性能回归：24 passed，0 failed；确认 Relay generation fence、collision/gap、游标恢复、SSE fan-out 与 P95 replay 门槛继续有效。
4. 当前累计有效自动测试证据：397 passed，0 failed。

### 仍未计为完成

- M09-F01/F02：协议层和实际 WSS 连接器已完成，但生产尚缺 Android Runtime 注册凭证落盘、启动接线，以及 `android-local` → Relay Runtime ID 的无损 OAEP source identity 迁移。
- M09-F03/F04/F05：尚无真实 Desktop+Relay+Android 三端同时在线的双向语义、2 秒 P95、断线重连与最终 Snapshot digest 验收。
- M09-F06：Relay 已有 generation/sequence fence，本地已有首决定胜出和 receipt 幂等，但跨端审批竞争及副作用恰好一次仍缺同一 E2E 场景证据。

## 第 15 轮结果

### 新增已验收

- M08-F01：Python checkpoint 持久绑定 OAEP runtime/session/run、Run status 和 Snapshot watermark；恢复要求当前 OAEP 水位不低于 checkpoint，防止已提交 Item/副作用倒退。
- M08-F02：Workspace/Conversation 冷启动直接读取 Room OAEP Snapshot/Projection；真机 live Writer、冷 Snapshot 和 UI Projection digest/watermark 一致，不依赖内存 delta 缓冲。
- M08-F03：Runtime sink/service 重建从 Room 恢复同一 Writer binding、revision 和 sequence；审批等待后重绑继续同一 Run/Interaction，Tool receipt 不创建第二 Item。
- M08-F04：前台与恢复通知均绑定 Session+Run，恢复通知额外绑定 waiting Interaction；点击后校验账户 OAEP Snapshot 中的 Run/Interaction，错误 scope 不会打开或创建执行。
- M08-F05：配置变化沿用 Activity `viewModels`；多窗口或重复恢复由进程级 account+run coordinator lease 保证单协调器，后台由 foreground service 持有，进程重建由 durable checkpoint 接管。
- M08-F06：取消、暂停、恢复产生合法 OAEP terminal/waiting/resumed 序列；相同 Session/Run ID 在不同账户下独立存储、独立水位和独立终态。

### 本轮实现与修正

- 新增 `OaepBoundPythonCheckpointStore`，保存时读取 OAEP Session/Run 并嵌入 `_oaep_binding`；加载时 fail closed 校验 scope 和 watermark regression。
- App 生产 Python Host、后台 `RunRecoveryWorker` 均使用绑定后的 checkpoint store，避免 UI 恢复路径与 Worker 恢复路径采用不同权威。
- 新增统一 `oaepRunOpenIntent`；前台通知使用 OAEP Run deep link，恢复通知携带 Interaction ID，`AppViewModel.openOaepRun` 在打开前验证 owner/session/run/item 全部匹配。
- 新增 `RunCoordinatorLeaseRegistry`，同账户同 Run 只允许一个协调器；不同账户相同 Run ID 可并行，释放后可确定性恢复。
- 清理一次超时遗留的 Gradle/UTP 结果锁；清理后同一 checkpoint 真机专项 2/2 在 0.6 秒完成，确认超时不是运行时代码故障。

### 本轮自动测试证据

1. Android Debug JVM 完整回归：327 passed，0 failed。
2. Samsung SM-X936C（Android 16/API 36）M08 聚焦套件：13 passed，0 failed。
3. 真机覆盖 checkpoint scope/watermark 回退拒绝、通知三元 scope、重绑同 Run/Item、冷 Snapshot digest、paused/resumed/cancelled 合法序列以及跨账户相同 ID 隔离。
4. 当前累计有效自动测试证据：393 passed，0 failed。

### 仍未计为完成

- M09 Relay 跨端六项尚需 Android 本地 OAEP 发布、双向实时/重连 digest 和并发审批专项。
- M11 测试/性能/安全门禁与 M12 发布验收仍未逐项关闭。

## 第 14 轮结果

### 新增已验收

- M04-F02：真实 HAI Model Host 只读取显式公共 `reasoning_summary` 流字段并通过 Python Core 生成 Reasoning delta/completed；新增生产 `core.update_plan` 模型工具，发布并更新结构化 Plan steps，不使用或伪装私有思维链。
- M04-F03：Tool schema 新增受控 `oaep_output_type`；真实 `workspace.search` Host receipt 显式生成 Command Execution，`workspace.write` receipt 显式生成 File Change，类型来自注册 schema 而非工具名推断。

### 本轮实现与修正

- `ModelDelta`、Android Python Model Host 和 Agent Loop 增加独立 reasoning summary 通道；文本 answer 与公共摘要分开发送，Python Core 对类型和空值 fail closed。
- `core.update_plan` 对 step 数量、title、status 和字段长度做有界校验，输出 `plan.updated`/`plan.completed`，且完全在共享 Core 内执行，不发 Android Host 副作用请求。
- `ToolDefinition` 只允许 `command_execution`/`file_change` 两种显式 OAEP output 类型；模型工具调用携带 schema 元数据，Core 将成功 receipt 转换为专用规范事件。
- File Change 仅接受安全相对路径并拒绝绝对路径、UNC/反斜杠根路径和 `..` escape；Command 输出取自真实 Host receipt，保留 display command、cwd、exit code 与 duration。

### 本轮自动测试证据

1. Android Debug JVM 完整回归：326 passed，0 failed。
2. Python Mobile Core/Ports 聚焦回归：17 passed，0 failed；新增公共 reasoning、真实 model plan tool、command receipt、file receipt 四项。
3. Samsung SM-X936C（Android 16/API 36）嵌入式 `PythonRuntimeCriticalJourneyTest` + OAEP Store + Legacy backfill：12 passed，0 failed。
4. 真机 Python Core 覆盖 reasoning delta/completed、plan.updated、command.completed、file_change.completed，再由既有真机 Store 覆盖全部 Item 的 Room/Snapshot/Replay。
5. 当前累计有效自动测试证据：389 passed，0 failed。

### 仍未计为完成

- M08 恢复/生命周期/通知、M09 Relay 跨端、M11 测试性能安全门禁、M12 发布验收仍需逐项专项核验。

## 第 13 轮结果

### 新增已验收

- M10-F06：生产 UI 与协调层公开输出已删除 `RuntimeEvent` 语义旁路；私有事件仅存在于模块内部 Legacy Engine Adapter，OAEP 写入先于兼容 Workbench Journal，ViewModel 只消费 OAEP Projection 和非语义生命周期清理信号。

### 本轮实现与修正

- `JournaledChatExecutionCoordinator` 不再向上暴露 `RuntimeEvent`，改为 `JournaledChatUpdate(checkpoint, lifecycle, artifact)`；其中 lifecycle 只用于通知、skill/recovery 清理，不生成消息、Run 状态或错误文案。
- `AppViewModel` 删除全部 `RuntimeEvent` import 和分支，文本、工具降级 Notice、Run 状态、错误及恢复态均来自 OAEP Projection。
- 工具降级横幅改由 OAEP Notice `tool_downgraded` 推导；Artifact 兼容数据只执行本地接收副作用，结构化显示仍由 OAEP Artifact Item 负责。
- `ChatExecutionPort`、`ChatEngine`、Router、OAEP Normalizing Engine、Python Shared Core Engine 均收缩为模块内部兼容接口，防止私有事件类型重新成为应用层 API。

### 本轮自动测试证据

1. Android Debug JVM 完整回归：326 passed，0 failed。
2. Samsung SM-X936C（Android 16/API 36）`AndroidOaepStoreTest` + `LegacyOaepBackfillTest`：11 passed，0 failed。
3. `ChatExecutionRouterTest` 验证每个私有事件先写兼容 Journal，再只向上暴露 ACTIVE/terminal lifecycle；公开更新对象不存在消息 delta 或错误文本字段。
4. 当前累计有效自动测试证据：385 passed，0 failed（本轮扩展既有测试，不重复累计）。

### 仍未计为完成

- M04-F02/F03：真实 Model/Tool Host 的 Reasoning/Plan 与 Command/FileChange 结构化来源仍未闭环。
- M08 跨 Runtime 一致性、M09 安全、M11 测试矩阵与 M12 发布硬门禁尚未完成专项验收。

## 第 12 轮结果

### 新增已验收

- M07-F06：running/waiting/recovering/failed/cancelled 全部由本地 OAEP Run/Event Journal 投影；等待原因、恢复中状态和失败信息不再由 `RuntimeEvent` 文案直接写入 UI。

### 本轮实现与修正

- 本地 UI Projection 读取目标 Run 的 OAEP Journal，提取 `event.run.waiting` reason、`event.run.failed` error 及最后事件，区分审批等待、副作用 reconciliation、普通暂停和恢复中。
- `run.recovered` 同一规范化批次写入恢复 Notice 与 `RunResumed`；只有由 paused 等可恢复等待进入的 resumed 才显示“正在恢复”，审批或 reconciliation 的 resumed 不会误报。
- 主动后台暂停与停止分别持久化 `RunWaiting(paused)`、`RunCancelled`，包括冷启动后只有 recoverable checkpoint 的取消路径；ViewModel 随后重新读取 OAEP Projection。
- Workspace/Conversation 冷启动和消息重载优先使用 OAEP runtimeStatus、error 与 recovering；Legacy checkpoint 只在该 Session 尚无 OAEP Projection 时作为迁移兼容回退。

### 本轮自动测试证据

1. Android Debug JVM 完整回归：326 passed，0 failed。
2. Samsung SM-X936C（Android 16/API 36）`AndroidOaepStoreTest` + `LegacyOaepBackfillTest`：11 passed，0 failed。
3. 真机新增 paused → OAEP waiting reason → run.recovered → OAEP resumed/recovering 投影专项；JVM 新增 `run.recovered` 规范事件批次验证。
4. 当前累计有效自动测试证据：385 passed，0 failed。

### 仍未计为完成

- M10-F06：UI 已不再使用私有事件构造 OAEP 语义状态，但 `ChatEngine`、`ChatExecutionPort`、Journal coordinator 的公开生产签名仍是 `Flow<RuntimeEvent>`，尚未收缩为 Adapter 内部兼容类型。
- M04-F02/F03：真实 Model/Tool Host 的 Reasoning/Plan 与 Command/FileChange 结构化来源仍未闭环。

## 第 11 轮结果

### 新增已验收

- M07-F01：本地聊天界面新增 OAEP-native transcript 状态；`AppViewModel` 不再根据 `RuntimeEvent.TextDelta` 拼接 Assistant 文本，实时与冷启动均读取 OAEP Snapshot/Item Projection。
- M07-F02：本地与远端统一使用 `projectOaepMessages` 和同一个 `OaepSemanticItem` 组件；角色、Item 类型、状态、阶段、详情和资源元数据采用相同语义映射。
- M07-F03：Snapshot 投影先按 Run sequence/createdAt/id 排序，再按各 Run 内 Item sequence/createdAt/id 排序；本地界面按 Run 分组，避免多 Run 的相同 Item sequence 交叉错排。
- M07-F04：Message `commentary`/`final` phase 从 Runtime Envelope 保留到 OAEP Item 和 UI；流式 Delta 更新稳定 Item binding，完成态、冷启动 Snapshot 与实时位置保持一致。
- M07-F05：Interaction、Tool、Command Execution、File Change、Artifact、Subtask 以及其资源引用均由共享结构化组件显示，不再统一降级为纯文本消息。

### 本轮实现与修正

- `AppState` 增加 OAEP transcript、Run 状态、活动 Run 与 Snapshot watermark；Workspace/Conversation 加载、事件刷新及重载均通过本地 OAEP 只读投影更新。
- 远端 transcript 投影保留 `runId`、Message phase 与 resource metadata，并改为直接接收完整 Snapshot，统一处理 Session → Run → Item 顺序。
- `AppViewModel` 的兼容事件分支只保留通知、恢复 checkpoint、Artifact 接收等生命周期副作用；文本、运行状态和失败展示在每个事件后由 OAEP Projection 覆盖。
- Python Shared Core 非 reconciliation 异常先持久化规范 `event.run.failed`，再发出兼容 `RuntimeEvent.Failed`，防止 OAEP Run 永久停留在 running。
- 修正真机结构化投影夹具，使本地 Runtime 使用生产一致的 `android-local/local` OAEP scope。

### 本轮自动测试证据

1. Android Debug JVM 完整回归：325 passed，0 failed。
2. Samsung SM-X936C（Android 16/API 36）完整 `AndroidOaepStoreTest` + `LegacyOaepBackfillTest`：10 passed，0 failed。
3. JVM 专项覆盖跨 Run 顺序、commentary phase 与资源元数据保留；真机专项覆盖全部 10 类 Item 的 Room → Snapshot → 本地 UI Projection、watermark 和 Run binding。
4. 当前累计有效自动测试证据：383 passed，0 failed。

### 仍未计为完成

- M07-F06：running/waiting/failed/cancelled 已改读 OAEP；但 recovering 仍依赖兼容 checkpoint/`RuntimeEvent.Paused` 触发，尚未成为纯 OAEP 恢复状态投影。
- M10-F06：`RuntimeEvent` 已不再作为本地 UI 文本和 Run 状态权威，但生产协调层仍传递它以承载通知、恢复和旧 Journal 兼容，尚未限制到 Adapter 内。
- M04-F02/F03：真实 Model/Tool Host 的 Reasoning/Plan 与 Command/FileChange 结构化来源仍未闭环。

## 第 10 轮结果

### 新增已验收

- M02-F04：Kotlin Lite 与旧 Platform Agent 生产引擎均接入 `OaepNormalizingChatEngine`，所有 Run/Message/Tool/Artifact/Notice/终态先转换为 `NormalizedAgentEvent` 再进入对应 Runtime 的 OAEP Writer；Python Shared Core 继续直接使用同一 sink。
- M10-F04：新增 Legacy/OAEP 影子审计和 fail-closed cutover gate；逐 Session 比较消息、附件、Artifact、WorkbenchEvent、Run checkpoint 与 reconciliation，差异标记 `DIVERGED` 并阻断切换，审计接口只返回 verdict/digest，不返回混合内容。
- M10-F05：旧 Conversation/ChatMessage/附件和实时 assistant text 由 OAEP Snapshot/Item 单向生成；迁移 Session 仅在影子审计通过后切换，OAEP-native Session 直接以 OAEP 为权威，旧 UI 不合并两套列表。

### 本轮实现与修正

- `RoomAndroidOaepRuntimeSink` 按账户、组织、Runtime、Session、Run 组成 writer/lock key，消除跨账户或跨 Runtime 相同 Run ID 的内存串写风险。
- Platform compatibility 流使用 `hai-platform/platform` 权威域，本地流使用 `android-local/local`，两者不会写入同一 OAEP Session scope。
- UI 收到兼容 `RuntimeEvent.TextDelta` 后，不再以该 delta 累加结果为权威，而是读取刚刚持久化的 OAEP Message Item 文本；查询失败时仅保留迁移期兼容回退。
- Writer 将已处于 `running` 的重复 `RunStarted` 视为幂等，支持 Python 在未产生副作用前失败并安全回退 Kotlin 时继续同一 OAEP Run。
- 旧 Message 的原始状态写入 OAEP Message `phase`，避免历史状态在迁移中被硬编码为 `final`。

### 本轮自动测试证据

1. Android Debug JVM 完整回归：323 passed，0 failed。
2. Samsung SM-X936C（Android 16/API 36）完整 `AndroidOaepStoreTest` + `LegacyOaepBackfillTest`：10 passed，0 failed。
3. 真机故障注入覆盖 OAEP Item 篡改后 `DIVERGED`、cutover 拒绝及两套视图不合并。
4. 真机兼容流覆盖 Kotlin Lite 与 Platform Runtime 的独立 OAEP 权威域、实时文本回读以及旧 Chat shape 单向生成。
5. 当前累计有效自动测试证据：381 passed，0 failed。

### 仍未计为完成

- M10-F06：生产协调层仍传递兼容 `RuntimeEvent`；需要将其限制在 Adapter 内，UI/Journal 改为直接消费 OAEP Event/Projection 后才能删除私有旁路。
- M04-F02/F03：真实 Model/Tool Host 的 Reasoning/Plan 与 Command/FileChange 结构化来源仍未闭环。
- M07：虽然旧 UI 数据形状已能从 OAEP 生成，但完整 Item renderer、Interaction、Run 状态和 Artifact UI 尚未全部切至 OAEP Projection。

## 第 9 轮结果

### 新增已验收

- M10-F03：旧 Workbench Run 按稳定 Run binding 迁移并保留终态；`COMPLETED/FAILED/CANCELLED` 映射为对应 OAEP 终态，`QUEUED/RUNNING/WAITING_APPROVAL/PAUSED` 一律转为 `waiting` Reconciliation Interaction，升级后不存在永久 `running`。

### 本轮实现与修正

- 每个旧 Workbench Run 获得独立且确定性的 OAEP Run ID 和 Session 内 `runSequence`，不会与历史消息承载 Run 或其他 Run 混写。
- 迁移 checkpoint 仅写入 Runtime ID、Run ID、状态和水位；失败码只保留 digest，旧 prompt、Python state、私有 payload 不进入 OAEP。
- 活动 Run 使用单次原子批提交生成 `run.started`、waiting Interaction 和 `run.waiting`，可由后续显式 reconciliation 决定恢复或失败。
- source digest 纳入旧 Workbench Run checkpoint 全量输入，迁移后状态变化会触发 `DIVERGED` 并阻断静默覆盖。

### 本轮自动测试证据

1. Android Debug JVM 完整回归：323 passed，0 failed。
2. Samsung SM-X936C（Android 16/API 36）Legacy OAEP backfill：1 passed，0 failed；同一 Session 覆盖 completed、failed、cancelled、running 四类旧 Run，OAEP Snapshot 中无永久 running。
3. 当前累计有效自动测试证据仍为 379 passed，0 failed（本轮扩展既有 backfill 验收用例，不重复累计用例数）。

### 仍未计为完成

- M10-F04：尚未实现 Legacy/OAEP 双写影子 digest 审计和切换阻断器。
- M10-F05/F06：Legacy API/UI 仍未全部改为 OAEP 只读投影，生产私有事件旁路尚未完全移除。
- M04-F02/F03 仍需真实 Model/Tool Host 的结构化来源；M07 UI 仍待 OAEP 权威切换。

## 第 8 轮结果

### 新增已验收

- M10-F01：实现旧 `Conversation` / `Message` / Attachment / Tool Artifact / `WorkbenchEvent` 按账户、Session 和稳定游标分批回填；历史文本、附件资源引用、Artifact 内容、Workbench 事件类型与时间进入 OAEP 权威 Snapshot，原始私有 payload 和本地绝对路径不写入 OAEP。
- M10-F02：迁移使用稳定 Run/Item binding、版本化 dedupe key、source SHA-256 digest 和完成水位；相同源重复运行直接 `SKIPPED`，源数据漂移标记 `DIVERGED` 并禁止覆盖既有 OAEP Snapshot。

### 本轮实现与修正

- `ChatDatabase` 升级至 v13，新增账户隔离的 `android_oaep_migrations` 权威表及 v12→v13 Migration；所有生产数据库构造入口均注册新 Migration。
- `LegacyOaepBackfill` 支持 1–100 个 Session 的有界分页，逐 Session 原子回填并记录 `RUNNING/COMPLETED/DIVERGED/FAILED`；错误信息有界，迁移内容不携带 Legacy 绝对路径或原始 Workbench payload。
- 修复同一 Session 多 Run：新 Run 会复用 Session watermark，但使用独立 Run/Item binding；`event.run.created` 按 Run 判定，用户输入 dedupe key 也按 Run 隔离。
- 补齐 DAO 测试替身对迁移分页接口的兼容，随后完成全量 JVM 回归。

### 本轮自动测试证据

1. Android Debug JVM 完整回归：323 passed，0 failed。
2. Samsung SM-X936C（Android 16/API 36）Legacy OAEP backfill：1 passed，0 failed；覆盖分页、文本、附件、Artifact、WorkbenchEvent、账户隔离、幂等与 drift 阻断。
3. 同一真机多 Run/单 Session 专项：1 passed，0 failed；两 Run、两用户消息、8 个连续 OAEP Event、单一 Session。
4. 同一真机 Room v11→v13 迁移：1 passed，0 failed；Legacy/Remote 数据保留、OAEP 权威表与迁移表可读写。
5. Python Mobile 26 项及 OAEP Protocol/Codegen/Relay 20 项沿用第 7 轮有效证据。
6. 当前累计有效自动测试证据：379 passed，0 failed。

### 仍未计为完成

- M10-F03：进行中 Workbench Run 尚未按原 Run 身份恢复或明确转为 failed/paused。
- M10-F04：尚未实现 Legacy/OAEP 双写影子 digest 审计和切换阻断器。
- M10-F05/F06：Legacy API/UI 仍未全部改为 OAEP 只读投影，生产私有事件旁路尚未完全移除。
- M04-F02/F03 仍需真实 Model/Tool Host 的结构化来源；M07 UI 仍待 OAEP 权威切换。

## 第 7 轮结果

### 新增已验收

- M05-F05：Artifact mutation receipt 在外部成功后持久化；模拟进程崩溃恢复时直接复用 receipt、外部 mutation 执行次数为 0，并确定性地产生同一 `artifact.created` → OAEP Artifact Item。
- M06-F05：新增本地 Journal 保留/压缩策略；默认只压缩全部 Run 已终态的 Session，只删除已由当前 Snapshot 水位覆盖的前缀，保留尾部事件，旧 cursor 强制返回 Snapshot。

### 本轮实现与修正

- Mobile Core 的 Tool result 保留 artifact IDs 并生成稳定 Artifact 事件，恢复重放不会创建第二个 Artifact binding。
- `RoomAndroidOaepStore.compact` 在单事务内校验 workspace、Run 终态、Snapshot watermark 和保留数量。
- 修复所有事件已被裁剪时的 replay 边界：`after < snapshotSequence` 不再返回空页，而是明确 `CursorExpired`。
- 压缩前后 Room Snapshot digest 保持一致，活动 Run 压缩请求 fail closed。

### 本轮自动测试证据

1. Android Debug JVM 完整回归：323 passed，0 failed。
2. Python Mobile 完整组：26 passed，0 failed。
3. Samsung SM-X936C（Android 16/API 36）`AndroidOaepStoreTest`：6 passed，0 failed。
4. v11→v12 迁移和审批竞争真机专项各 1 项继续有效。
5. OAEP Protocol/Codegen/Relay 20 项继续有效。
6. 当前累计有效自动测试证据：377 passed，0 failed。

### 仍未计为完成

- M04-F02/F03 仍需真实 Model/Tool Host 结构化来源。
- M10 历史 Conversation/Message/WorkbenchEvent backfill、稳定 binding 与双读影子审计尚未实现。
- M07 UI 尚未切换为只读本地 OAEP Projection。

## 第 6 轮结果

### 新增已验收

- M05-F01：Approval 现在生成 `event.item.created`（Interaction status=waiting），并在同一 Runtime Envelope 原子提交后紧跟 `event.run.waiting`。
- M05-F02：审批决定更新同一 Interaction Item；Room 条件更新和 OAEP Writer 双层保证第一决定胜出，重复点击或后到竞争决定不追加事件、不覆盖授权结果。
- M05-F03：审批完成与 `event.run.resumed` 同事务提交；真机在 waiting 后销毁并重建 sink，仍继续同一 Run/Interaction、保持 sequence。
- M05-F04：Tool intent/result 使用相同 call_id→Item binding；进程重建后从 checkpoint 复用 durable receipt，不重新执行外部副作用，并只完成同一 Tool Item。
- M05-F06：不确定 Tool/Artifact 副作用不再投影为失败终态，而是生成 waiting Reconciliation Interaction；Legacy UI 收到 Paused，等待确定结果。

### 新增实现但尚未计入完成

- M05-F05：Artifact receipt 的持久化、重复外部 mutation 阻断和 `artifact.created` 映射均已存在；真实 Mobile Core artifact mutation 请求到 OAEP Artifact Item 的完整生产闭环仍需补齐。

### 本轮实现与修正

- 新增 `NormalizedAgentEvent.ItemCreated`，区分“待审批 Interaction 已创建”和“执行已开始”。
- 新增 Writer `applyAll`，一个 Runtime Envelope 产生的多个 OAEP Event 作为单个 Room 事务提交；中途异常会回滚 Writer 内存状态。
- 修复 `run.recovered`：恢复通知不再无条件伪造 `run.resumed`，避免 running/waiting 状态非法跳转。
- 新增 `PythonRuntimeReconciliation`，对 reconciliation 事件生成稳定有界 ID；长 Run/operation ID 不会突破 Runtime Envelope 限制。

### 本轮自动测试证据

1. Android Debug JVM 完整回归：323 passed，0 failed。
2. Python Mobile Core/Subagent：15 passed，0 failed；本阶段完整 Python Mobile 组仍为 26 passed。
3. Samsung SM-X936C（Android 16/API 36）OAEP Store：5 passed，0 failed。
4. 同一真机审批绑定、并发首决定胜出与审计专项：1 passed，0 failed。
5. OAEP Protocol/Codegen/Relay 20 项及 v11→v12 迁移 1 项继续有效。
6. 当前累计有效自动测试证据：376 passed，0 failed。

### 仍未计为完成

- M05-F05 需要由真实 Mobile Core 发起 Artifact create/write/share，并在 receipt replay 后生成同一 Artifact Item。
- M04-F02/F03 的真实 Model/Tool Host 结构化来源仍未闭环。
- M06-F05 Journal 保留策略、历史 Session backfill、OAEP UI 切换仍待实现。

## 第 5 轮结果

### 新增已验收

- M04-F01：用户 Message 支持文本、图片、音频、文件和规范 `resource_ref`；所有 parts/resource refs 已完成真机 Room 往返恢复。
- M04-F04：Tool Call 的 tool kind、name、call_id、arguments、result、server、duration 和 error 均进入结构化 OAEP；Android JSON 对象已归一化为平台无关 Map/List。
- M04-F05：Artifact、Subtask 与 Notice 可经生产 sink 持久化、查询并完整 Journal replay；Host Tool 产生的 artifact IDs 会生成 `artifact.created`。
- M04-F06：未知 Runtime 事件确定性降级为有界 Notice，不静默吞掉、不写入原始私有 payload，Run 可继续进入合法终态。

### 新增实现但尚未计入完成

- M04-F02：Reasoning 摘要与 Plan 的 Normalized 映射、Writer Delta、Room 持久化及 replay 已实现并通过测试；真实 Model Host 尚未提供结构化 reasoning/plan channel，因此仍按“实现中”统计。
- M04-F03：Command Execution 与 File Change 的完整字段映射、持久化及 replay 已实现并通过测试；真实 Host Tool 结果到这两类专用事件的生产分类仍待接入。

### 本轮实现与修正

- `NormalizedAgentEvent.ItemDelta` 增加明确 `itemType`，Writer 可正确初始化 Message、Reasoning、Plan、Command 和 Subtask。
- Python Mobile Core 在 Host Tool 执行前发送 `tool.started`，结果事件保留 arguments/result，并把关联 artifact 投影为结构化事件。
- OAEP Codec 递归规范化任意 Map/List/JSONObject/JSONArray，避免冷启动后内容类型依赖 Android JSON 实现。
- 新增全部 10 类 OAEP Item 的生产 sink → Room → Snapshot → Journal replay 真机覆盖。

### 本轮自动测试证据

1. Android Debug JVM 完整回归：320 passed，0 failed。
2. Python Mobile Core、Subagent、Protocol、Ports：26 passed，0 failed。
3. Samsung SM-X936C（Android 16/API 36）`AndroidOaepStoreTest`：5 passed，0 failed。
4. OAEP Protocol/Codegen/Relay 20 项及 v11→v12 真机迁移 1 项继续有效。
5. 当前累计有效自动测试证据：372 passed，0 failed。

### 仍未计为完成

- Reasoning/Plan 需要 Model Host 的安全摘要通道，禁止把模型原始思维链伪装成 reasoning summary。
- Command/File Change 需要依据 Tool schema/result 的显式 OAEP 类型声明生成，不能仅凭工具名称猜测。
- M05 Interaction 与副作用闭环、M06-F05 Journal 保留策略、历史 Session backfill 仍待专项实现。

## 第 4 轮结果

### 新增已验收

- M06-F01：本地 OAEP Event Journal 支持按 Session sequence 有界分页，事件保持 append-only，分页边界无重无漏。
- M06-F02：新增只读 Session Snapshot API，直接读取 Room Run/Item Projection，不依赖 Python 私有事件或 Legacy Message 临时重放。
- M06-F04：Journal replay 严格检查首事件及页内连续性；缺口 fail closed，超出水位或已被裁剪的游标明确返回权威 Snapshot。
- M06-F06：新增确定性 OAEP Journal Projector 与 Snapshot digest；实时 Writer、完整 Journal replay、Room 冷启动 Snapshot 三路 digest 真机一致。

### 新增实现与修正

- 新增 `AndroidOaepProjector`，可从规范 OAEP Event 独立归约 Run、Item、Delta 和终态。
- `event.run.created` 现在携带完整 Run 数据，使 Journal 本身具备完整重放能力。
- 修复 Writer 初始 Run 状态从非协议值 `pending` 改为 OAEP 合法值 `queued`。
- 修复 Kotlin OAEP Codec 对 Run sequence/source 以及 Source adapter、mapping、backend-run 字段的丢失。
- 新增 v11→v12 真机迁移测试，证明 Legacy Message 和 Remote Projection 保留，且迁移后的 Android OAEP 权威表可立即写入、读取。

### 本轮自动测试证据

1. Android Debug JVM 完整回归：319 passed，0 failed。
2. Samsung SM-X936C（Android 16/API 36）`AndroidOaepStoreTest`：4 passed，0 failed。
3. 同一真机 v11→v12 专项迁移：1 passed，0 failed。
4. 前轮 Python Mobile/跨 Runtime parity 12 项及 OAEP Protocol/Codegen/Relay 20 项继续有效。
5. 当前累计有效自动测试证据：356 passed，0 failed。

### 仍未计为完成

- M06-F05：Journal 压缩和保留策略尚未实现，当前只实现了裁剪后游标恢复语义。
- 数据迁移策略中的历史 Session 分批 OAEP backfill、source digest、双读影子校验与回滚窗口仍未实现。
- M04 完整结构化 Item 尚缺 Reasoning、Plan、Command Execution 与 File Change 的 Android Agent Runtime 生产映射。

## 第 3 轮结果

### 新增已验收

- M03-F01：Android Agent Runtime 的 Python 生产执行流已先解码为 `NormalizedAgentEvent`，再统一进入 `AndroidOaepWriter`；兼容 `RuntimeEvent` 仅作为下游旧 UI 投影。
- M03-F05：新增 Room OAEP 权威表、DAO 和事务 Store，Event、Run/Item Projection、binding、revision、dedupe 与 watermark 在同一事务提交；真机冲突注入证明不会出现半提交。
- M06-F03：Snapshot watermark 已持久化到 Room，真机关闭并重建 Writer 后 Event sequence、Item binding、revision 与 Snapshot 状态连续。

### 新增实现

- 新增 `RoomAndroidOaepRuntimeSink`，将用户输入以及每个 Python Runtime 规范化事件写入 OAEP Writer/Store，并按 Run 串行化并发提交。
- `ChatDatabase` 升级到版本 12，新增 Session、Run、Item、Event 四张 OAEP 表及索引，所有生产数据库入口均注册 `MIGRATION_11_12`。
- `PythonSharedCoreChatEngine` 生产构造已注入 Room sink，写入顺序为用户 Item、Run 生命周期、Assistant/Tool/Approval/Subtask/Artifact Item 生命周期。
- Writer 支持在首个语义事件不是 `RunStarted` 时补发且仅补发一次 `event.run.created`，保证用户输入可先于 Runtime 启动事件持久化。

### 本轮自动测试证据

1. Android Debug Kotlin、AndroidTest Kotlin 编译：通过。
2. Android Debug JVM 完整回归：318 passed，0 failed。
3. Samsung SM-X936C（Android 16/API 36）instrumentation：`AndroidOaepStoreTest` 3 passed，0 failed。
4. 真机覆盖生产 sink 完整流、数据库重开恢复、过期 Writer 冲突与 Event/Projection 原子回滚。
5. 前两轮 Python/OAEP/Relay 32 项测试证据继续有效；累计自动测试证据 353 passed。

### 仍未计为完成

- M02-F04：Kotlin Lite 与 Platform Agent 尚未接入相同 Normalized 出口。
- M04 全模块：虽然 `MIGRATION_11_12` 已实现并完成新库真机测试，但旧版本真实数据库升级、双读校验、回滚与破坏性迁移防护尚未完整验收。
- M06 其余功能：断点恢复、pending Interaction/Tool 状态恢复及恢复后去重仍需专项故障注入。

## 第 2 轮结果

### 新增已验收

- M02-F01：新增覆盖 Run 与完整 Item 生命周期的 `NormalizedAgentEvent` union。
- M02-F03：冻结的 Python Runtime 语义事件全部具有显式 Normalized 映射；未知事件走 Notice，不静默吞掉。
- M02-F06：Approval、Subagent、Runtime degraded/recovered/lifecycle 和 checkpoint 均已明确 map 或 internal-state 处理。
- M03-F02：Writer 建立 Backend Item ID → OAEP Item ID 稳定 binding，同一 Item 生命周期 ID 不变。
- M03-F03：Writer 分配 Session 级严格递增 Event sequence，并生成 Snapshot watermark。
- M03-F04：Writer 实现输入 dedupe、Item revision 和类型冲突拒绝。
- M03-F06：Writer 验证 Run/Item 状态和终态闭包，终态自动关闭未完成 Item并拒绝后续写入。

### 新增实现

- 新增纯状态转换 `AndroidOaepWriter`，作为后续 Room 原子持久化的唯一语义引擎。
- Approval 一条内部事件可规范化为 Interaction + Run waiting/resumed 的 OAEP 序列。
- Python Core 的 Approval 和 Subagent 事件补齐稳定 ID、标题、摘要和结果。
- 修复 Android OAEP digest 对可选空 `message.parts` 的规范化，使其重新与 Python/Desktop fixture digest 对齐。

### 本轮自动测试证据

1. Android Debug JVM 完整回归：318 passed，0 failed。
2. Android Writer/Mapper/Digest 聚焦测试：全部通过。
3. Python Mobile Agent Core 与跨 Runtime parity：12 passed。
4. 第 1 轮 OAEP Protocol/Codegen/Relay：20 passed，继续有效。

### 仍未计为完成

- M02-F04：Kotlin Lite 与 Platform Agent 尚未接入相同 Normalized 出口。
- M03-F01/M03-F05：Writer 尚未成为生产唯一入口，Room 原子事务仍待接入。
- M06-F03：Snapshot watermark 已在 Writer 内通过测试，但尚未由生产 Room 数据证明。

## 第 1 轮结果

### 已验收

- M01-F01：OAEP Stable 1.0、profile、Schema hash 与 Android v1.6.0 最低版本已冻结。
- M01-F02：Python、TypeScript、Kotlin 生成契约和严格 Android Codec 已存在并通过 codegen/protocol 测试。
- M01-F03：Android Runtime Envelope 仅作为内部 IPC 的边界已经文档化并由新 Normalized 类型落实。
- M01-F04：Python/Host event → Normalized → OAEP 映射矩阵已经建立。
- M01-F05：共享 OAEP Schema/examples/fixture 被 Python、Android 和 Relay 契约测试共同消费。
- M01-F06：`generate-oaep-types.py --check` 和 Schema/codegen drift 测试通过。

### 当轮实现中

- M02-F01：新增覆盖 Run 与 Item 生命周期的 `NormalizedAgentEvent` union。
- M02-F02：正在从 Python/Android 私有 ID 分离 OAEP Writer ID/binding。
- M02-F03：Python Runtime Event 已开始严格解码到 Normalized Event，完整类型仍需补齐。
- M02-F06：Approval 不再静默丢弃，未知事件转为有界 Notice；其他 Host 事件继续收敛。

## 第 1 轮自动测试证据

1. OAEP 生成检查：`scripts/generate-oaep-types.py --check`，通过。
2. Python OAEP/Relay 契约：20 passed。
3. Android `PythonRuntimeEventMapperTest`：4 passed。
4. Android Debug Kotlin 主代码与测试代码编译成功。

## 阶段状态

第 23 轮计划已全部执行并由本文顶部的最终结果关闭；无剩余未验收功能点。
