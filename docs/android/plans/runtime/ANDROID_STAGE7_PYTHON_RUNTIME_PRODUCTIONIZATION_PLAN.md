# OpenDrSai Android 第 7 阶段完整开发方案

> 阶段名称：共享 Python Runtime 生产化恢复、可信发布与 Beta 灰度  
> 状态：待实施  
> 制定日期：2026-08-02  
> 前置阶段：第 6 阶段“共享 Python Agent Runtime 原型”  
> 基线结论：第 6 阶段 40/40 功能点通过，三星 arm64 真机验收通过，Go/No-Go 为 `GO`

## 1. 阶段编号与定位

本方案是 **Android 第 7 阶段**。

第 5 阶段完成统一工作台与混合 Runtime V2；第 6 阶段完成共享 Python Agent Core、Android Kotlin Host Adapter、独立 `:runtime` 进程、跨端语义一致性及原型级真机 Go/No-Go。因此下一阶段不再重复实现 Agent Loop，也不继续无边界扩张 Tool 或 Skill，而是把已经通过原型验收的 Python Local Runtime 收敛为可在真实用户环境中灰度运行的生产能力。

第 7 阶段解决五个核心问题：

1. `:runtime` 或应用进程被系统杀死后，Run 能否从持久化 checkpoint 真正接回原聊天并达到唯一合法终态；
2. 工具、审批、Artifact 等副作用在崩溃、重试、恢复和升级期间能否严格保持最多一次用户可见效果；
3. 每一份发布证据能否与唯一源码提交、APK、设备和测试执行强绑定；
4. Python Local 能否从开发开关进入可观测、可暂停、可回滚的小流量 Beta；
5. 出现资源、兼容性或安全问题时，系统能否自动降级到 Kotlin Lite 或 Remote Full，而不丢失用户数据。

## 2. 开发原则与边界

### 2.1 架构原则

- Room `workbench_runs`、Run Journal 和 Audit 继续作为持久化事实来源，不建立第二套 Run 数据库。
- Python Core 保存平台无关的逻辑状态；Kotlin Host 保存 Android 生命周期、权限、Tool Receipt 和 UI 接回信息。
- 恢复必须显式使用版本化 `ResumeRun`，不得把恢复伪装成新的 `StartRun`。
- 幂等身份固定为 `subject + session_id + run_id + operation/call_id`，不能只依赖内存缓存。
- 已发生外部副作用的 Run 禁止静默切换 Runtime 后重跑。
- Kotlin Lite、Python Local、Remote Full 共用 Runtime V2/OAEP 领域语义；平台差异只存在于能力和 Host Adapter。
- Beta 默认关闭，必须由签名配置和服务端策略共同开启；紧急关闭不依赖发布新 APK。

### 2.2 本阶段不做

- 不在手机本地运行大语言模型。
- 不向 Python 开放任意 Shell、任意文件系统或任意网络。
- 不把 Desktop 专属 Tool 复制到 Android。
- 不下载或动态安装 Python 包、Wheel 或可执行代码。
- 不删除 Kotlin Lite 回退路径。
- 不以单一设备一次通过替代设备矩阵和持续 Beta 观测。
- 不在本阶段重做聊天 UI 或建立新的账户、会话、审批体系。

## 3. 交付范围：8 个模块、48 个功能点

### M01 生产恢复编排（6）

- **M01-F01**：将 `PythonRunRecovery.resumeEnvelope()` 接入实际恢复入口，而不只保留为测试辅助类。
- **M01-F02**：`RunRecoveryWorker` 读取 Run、subject、session、RuntimeBinding 和最新 checkpoint，构造可执行恢复任务。
- **M01-F03**：应用冷启动、通知点击和聊天页重新进入均能发现并接回同一个可恢复 Run。
- **M01-F04**：恢复协调器重新绑定 `:runtime` Service，提交 `ResumeRun`，并把后续事件投影回原聊天流。
- **M01-F05**：对 Waiting Model、Waiting Tool、Waiting Approval、Running、Paused 分别实现确定性恢复；终态不得恢复。
- **M01-F06**：恢复失败形成明确错误、可重试状态和用户操作，不得永久停留在 `RUNNING`。

### M02 副作用一致性与事务（6）

- **M02-F01**：Tool 执行前持久化 intent，执行后先持久化完整 receipt，再向 Python 回送结果。
- **M02-F02**：相同 `call_id` 恢复或重放时直接使用 durable receipt，禁止再次执行 Tool。
- **M02-F03**：Approval decision 持久化并按 `approval_id` 幂等；重复点击、旋转和进程恢复不能重复授权。
- **M02-F04**：Artifact 创建、写入和外部分享使用稳定操作 ID，处理“成功后崩溃、响应前丢失”场景。
- **M02-F05**：对不可判定的外部副作用进入 `needs_reconciliation`，不得自动假设成功或失败。
- **M02-F06**：建立副作用审计链：intent、approval、execution、receipt、replay、terminal 可按 Run 查询。

### M03 恢复 UI 与生命周期体验（6）

- **M03-F01**：修复通知渠道及文案编码，统一迁移到 Android string resources。
- **M03-F02**：聊天页显示“正在恢复、等待审批、需要确认、恢复失败、已回退”等明确状态。
- **M03-F03**：恢复期间禁用冲突操作，但保留取消和查看详情；取消本身必须幂等。
- **M03-F04**：Activity 重建、旋转、分屏、前后台切换不会创建第二个协调器或第二个 Run。
- **M03-F05**：通知点击准确打开原 Workspace/Session/Run；无权限时在应用内保留可恢复入口。
- **M03-F06**：登出、切换账户和数据清理必须取消对应 subject 的 Run、停止 Runtime 并清除敏感缓存。

### M04 Runtime 路由、灰度与回退（6）

- **M04-F01**：建立签名的 Runtime Rollout Policy，维度至少含版本、渠道、设备、API、ABI、内存档位和账户桶。
- **M04-F02**：实现服务端紧急关闭开关；离线或策略损坏时采用 fail-safe 默认值。
- **M04-F03**：定义 Kotlin Lite、Python Local、Remote Full 的能力协商和确定性选择顺序。
- **M04-F04**：Python 初始化失败且尚无副作用时允许安全回退；存在副作用后只允许恢复或人工处理。
- **M04-F05**：灰度比例、暂停、扩大和回退均记录策略版本及原因，可在诊断页查看。
- **M04-F06**：旧版本无法理解新 checkpoint 时明确回退或拒绝恢复，不得破坏现有 Run 数据。

### M05 可信构建与验收证据（6）

- **M05-F01**：所有证据记录 Git commit、dirty 状态、构建 ID、variant、versionCode/versionName 和 APK SHA-256。
- **M05-F02**：真机验收生成唯一 `acceptance_run_id`，贯穿 instrumentation、性能、安全和关键旅程日志。
- **M05-F03**：证据复用必须校验 runner、包版本、APK 哈希、设备、执行时间窗和同一 run ID；禁止搜索任意旧 logcat 晋级。
- **M05-F04**：在干净 checkout 上可一键重建 APK、运行验证器并生成机器可读报告。
- **M05-F05**：证据 JSON 使用版本化 Schema，校验器对缺字段、旧格式、过期证据和不一致哈希 fail closed。
- **M05-F06**：发布候选形成不可变 manifest，关联源码、SBOM、APK、mapping、测试报告和回滚版本。

### M06 安全、隐私与可观测性（6）

- **M06-F01**：继续执行 APK、logcat、应用数据三源 secret scan，并增加 checkpoint/receipt 数据扫描。
- **M06-F02**：日志只保留脱敏 run/request/call ID；设备序列号写入公开证据前散列或脱敏。
- **M06-F03**：建立 Runtime 指标：启动、绑定、恢复时延、恢复成功率、重复副作用拦截和回退率。
- **M06-F04**：错误分类稳定区分 Python、Binder、模型、Tool、Approval、Room、策略和资源问题。
- **M06-F05**：诊断导出执行字段白名单、大小限制和用户确认，不包含 Token、正文、路径或原始 URI。
- **M06-F06**：安全审计覆盖动态代码、网络白名单、文件越权、Intent 注入、PendingIntent 和备份策略。

### M07 性能、资源与设备兼容（6）

- **M07-F01**：覆盖 API 26、30、35、36，以及 arm64 和 x86_64 ABI；允许由真机与模拟器组合完成覆盖。
- **M07-F02**：至少一台物理真机完成身份绑定的关键旅程、恢复、性能和安全验收；不限定厂商、ARM64 或 4 GB 内存档位。
- **M07-F03**：测试低内存、后台限制、Doze、电量优化、热限制、磁盘不足和进程回收。
- **M07-F04**：运行时空闲释放、并发子智能体降级及 Artifact 大小限制必须可测量。
- **M07-F05**：执行 500 短 Run、50 Tool Run、20 恢复 Run，并验证 0 重复用户可见副作用、0 数据损坏及资源指标达标。
- **M07-F06**：资源超限时先降并发或回退 Runtime，不申请 `largeHeap` 掩盖问题。

### M08 Beta 发布与运营闭环（6）

- **M08-F01**：建立 Internal、Canary、Beta 1%、5%、20%、50%、100% 分级发布流程。
- **M08-F02**：Canary/Beta 各档支持配置观察窗口和最小样本量；这些属于 Stage 7 通过后的运营策略，不作为本阶段等待型硬门槛。
- **M08-F03**：定义自动暂停指标：崩溃、ANR、恢复失败、重复副作用、数据损坏、资源异常和登录异常。
- **M08-F04**：演练远程关闭 Python Local、回退 Kotlin Lite 和回滚 APK，验证数据与 Run 可读性。
- **M08-F05**：建立用户反馈、诊断 ID、问题分级、负责人和修复版本的闭环。
- **M08-F06**：Beta 完成后生成生产 Go/No-Go；硬门禁未通过时保持默认关闭。

## 4. 实施顺序与阶段出口

| 里程碑 | 内容 | 主要出口条件 |
| --- | --- | --- |
| S0 基线冻结 | 清理变更边界、固定 commit、Schema、APK 和第 6 阶段证据 | 干净 checkout 可复现第 6 阶段核心回归 |
| S1 恢复接线 | M01、M03 的生产入口、通知和聊天接回 | 真机 kill-process 后回到原 Run 并完成 |
| S2 副作用事务 | M02 全量 intent/receipt/reconciliation | 所有崩溃窗口重复副作用为 0 |
| S3 策略与回退 | M04 Runtime Policy、kill switch、三路径路由 | 灰度和紧急回退演练通过 |
| S4 可信证据 | M05 可复现构建、run ID 和发布 manifest | 任意证据可反查唯一 commit/APK/run/device |
| S5 安全与兼容 | M06、M07 安全、设备矩阵和压力测试 | 安全、兼容、性能硬门禁全绿 |
| S6 Beta 运营 | M08 分档灰度、观测、暂停和回滚 | Beta 指标满足生产 Go 条件 |

每个里程碑单独提交、单独验收。S1 和 S2 是后续灰度的硬前置；恢复生产链路或副作用一致性未通过时，不得进入 S6。

## 5. 关键设计

### 5.1 恢复状态机

恢复入口先读取权威 Run 和 checkpoint，校验 subject、session、协议版本及终态，然后根据 phase 重新发出唯一 Host 请求：

- `waiting_model`：恢复模型请求或以已持久化响应继续；
- `waiting_tool`：先查 durable receipt，有则重放，无则依据 intent 状态执行或进入 reconciliation；
- `waiting_approval`：恢复同一个 approval，不创建新 ID；
- `running`：从最近完整 checkpoint 继续；
- `paused`：保持暂停，等待用户显式继续；
- `completed/cancelled/failed`：拒绝恢复。

恢复的提交顺序必须是“持久化状态 → 执行或发出请求 → 持久化结果 → 投影 UI”。任何一步崩溃后都能根据 Room 数据决定下一动作。

### 5.2 证据身份模型

每次验收至少携带：

- `acceptance_run_id`；
- Git commit 和 dirty 标志；
- APK/Test APK SHA-256；
- applicationId、versionCode、versionName、variant；
- runner 与测试过滤条件；
- 设备制造商、型号、API、ABI和脱敏设备 ID；
- UTC 开始/结束时间；
- 各子报告哈希。

最终审核器必须验证这些字段在功能、性能、安全、关键旅程和升级回滚报告中一致。

### 5.3 灰度安全模型

Runtime 选择由“本地构建允许范围 ∩ 签名远程策略 ∩ 设备能力 ∩ 用户渠道”决定。远程策略只能缩小权限，不能开启构建中不存在的能力。策略过期、验签失败或解析失败时回到安全默认值。

## 6. 测试方案

### 6.1 自动化测试层级

1. **Python 单元测试**：恢复状态机、checkpoint 兼容、幂等键、事件重放和子智能体恢复。
2. **Kotlin JVM 测试**：Recovery Orchestrator、Room 事务、receipt、rollout policy、路由和错误映射。
3. **Room migration 测试**：从所有仍受支持的数据库版本升级到当前版本，并验证降级保护。
4. **进程级 instrumentation**：分别杀死 `:runtime`、应用 UI 进程和整个应用，再从真实 Room 恢复。
5. **用户级 UI E2E**：聊天发起、Approval、Tool、Artifact、子智能体、杀进程、恢复和最终消息完整可见。
6. **故障注入**：Binder 死亡、网络断流、Token 过期、磁盘满、低内存、重复/乱序消息和恢复中再次取消。
7. **发布证据测试**：篡改 commit、APK 哈希、run ID、时间窗或设备信息时审核器必须拒绝。
8. **升级回滚测试**：优先执行旧稳定版 → 第 7 阶段候选版 → 旧稳定版；若 OEM 平台无法创建回滚数据快照，则使用低版本号、当前 Schema 向前兼容的预构建回滚 APK，验证受控降级及数据可读。
9. **压力测试**：执行 500/50/20 基准，并核验副作用一致性、数据完整性和资源指标。
10. **Beta 观测验证**：策略发布、扩大、暂停、kill switch 和 APK 回滚演练。

### 6.2 必测崩溃窗口

- checkpoint 写入前、写入后；
- Model Request 发出前、响应收到后但落盘前；
- Tool intent 写入前后；
- Tool 外部副作用完成后、receipt 落盘前；
- receipt 落盘后、Python 收到结果前；
- Approval 展示前后、用户决策落盘前后；
- Artifact 写入完成后、引用写回前；
- Run 终态落盘前后；
- 恢复过程中再次被杀或用户取消。

## 7. 验收硬门槛

| 维度 | 第 7 阶段 Go 标准 |
| --- | --- |
| 功能 | 48/48 功能点具有代码、自动化测试和可追溯证据 |
| 恢复 | 必测 checkpoint/崩溃窗口全部达到唯一合法终态；恢复成功率 100% |
| 副作用 | 自动化、压力和真机测试中重复用户可见副作用为 0 |
| 用户 E2E | 至少一条完整 UI 旅程在真机杀进程后接回原聊天并完成 |
| 证据 | 全部报告与同一 commit、APK 哈希和 acceptance run ID 强绑定 |
| 回归 | Python、Android JVM、instrumentation、Lint、R8、Schema、SBOM 全绿 |
| 性能 | 冷启动 P95 ≤ 3 s；恢复到可交互 P95 ≤ 5 s |
| 内存 | 前台 PSS P95 ≤ 220 MB；压力峰值 ≤ 320 MB |
| 稳定性 | 500/50/20 压力基准：0 重复用户可见副作用、0 未恢复崩溃、0 数据损坏 |
| 安全 | Token/密钥泄漏、动态代码、越权文件/网络、高风险无审批均为 0 |
| 兼容性 | API 26/30/35/36、arm64/x86_64 和至少一台物理真机的目标设备矩阵通过 |
| 灰度 | kill switch、Kotlin Lite 回退和 APK 回滚演练全部通过 |
| 工程交付 | 干净工作区可复现构建；无意外删除；发布 manifest 完整 |

以下任一项失败均为 `NO_GO`：数据丢失、重复副作用、跨账户恢复、无法紧急关闭、证据无法绑定源码/APK、恢复死循环、安全泄漏、ANR 超门槛或回滚后数据不可读。

## 8. Beta 发布策略

| 阶段 | 建议范围 | 最短观察窗口 | 扩大条件 |
| --- | ---: | ---: | --- |
| Internal | 开发与测试账户 | 本轮身份绑定技术验收 | 全部恢复、回退、安全与数据完整性演练通过 |
| Canary | 指定内部真实设备 | 3 天 | 无硬门禁事件，指标完整 |
| Beta 1% | 符合能力条件的 Beta 用户 | 3 天且满足最小样本量 | 崩溃/ANR/恢复/回退指标达标 |
| Beta 5% | 同上 | 5 天 | 无数据一致性和安全事件 |
| Beta 20% | 同上 | 7 天 | 指标趋势稳定，无版本集中异常 |
| Beta 50% | 同上 | 7 天 | 回滚演练仍有效，支持负载可承受 |
| Beta 100% | Beta 渠道 | 14 天 | 生产 Go/No-Go 审核通过 |

Canary/Beta 观察窗口是 Stage 7 通过后的运营策略，不阻塞本阶段签发；任一档出现重复副作用、数据损坏、跨账户访问或安全泄漏，立即关闭 Python Local 并停止扩大；崩溃、ANR、恢复失败或资源异常超过阈值时自动暂停，负责人完成分析后才能恢复。

## 9. 交付物

- 生产恢复编排器及与 `RunRecoveryWorker`、聊天入口的接线；
- durable Tool/Approval/Artifact receipt 与 reconciliation 实现；
- Runtime Rollout Policy、签名验证、kill switch 和诊断界面；
- 修复后的通知与恢复 UI；
- 版本化验收 Schema、可信证据收集器和最终审核器；
- 设备矩阵、恢复矩阵、安全、性能、压力和升级回滚报告；
- 不可变 release manifest、SBOM、mapping、APK 哈希和回滚说明；
- 第 7 阶段进度报告、Beta 运营看板定义及最终 Go/No-Go 报告。

建议证据目录为：

```text
docs/android/testing/acceptance/python-runtime-production/
  feature-evidence.json
  recovery-matrix.json
  side-effect-consistency.json
  ui-critical-journey.json
  device-matrix.json
  device-performance.json
  security-scan.json
  upgrade-rollback.json
  rollout-drill.json
  release-manifest.json
  acceptance-verification.json
  go-no-go.md
```

## 10. 风险与缓解

| 风险 | 影响 | 缓解措施 |
| --- | --- | --- |
| 恢复构件存在但生产入口未调用 | Run 永久停留或只能人工重试 | S1 首先完成真实入口接线和 kill-process E2E |
| Tool 成功后 receipt 前崩溃 | 外部副作用状态不确定 | intent/receipt 两阶段记录并进入 reconciliation |
| 旧 logcat 被复用为新证据 | 错误发布结论 | acceptance run ID、时间窗、APK 哈希和 runner 强绑定 |
| 灰度策略损坏或被篡改 | 错误开放 Runtime | 签名、有效期、最小权限和安全默认值 |
| 低内存设备频繁杀进程 | 恢复风暴、ANR | 设备能力门槛、并发降级和 Kotlin/Remote 回退 |
| checkpoint Schema 演进不兼容 | 升级后无法恢复 | 版本化 Schema、向前迁移、旧版本拒绝策略 |
| 工作区混入无关改动 | 发布不可审查、误删文件 | S0 清理边界、分提交、干净 checkout 重建 |
| 诊断数据包含敏感信息 | 隐私或安全事故 | 字段白名单、脱敏 ID、三源 secret scan |

## 11. 完成定义

第 7 阶段只有同时满足以下条件才算完成：

1. 48/48 功能点全部具备可追溯证据；
2. `PythonRunRecovery` 已被生产恢复链路实际调用；
3. 真机用户级旅程证明进程死亡后回到原 Run，且副作用没有重复；
4. 所有证据与唯一干净 commit、APK 哈希及 acceptance run ID 一致；
5. 设备、安全、性能、压力和升级回滚硬门禁通过；
6. Runtime kill switch、Kotlin Lite 回退和 APK 回滚均完成演练；
7. Internal 身份绑定技术验收、kill switch、Kotlin Lite 回退、APK 回滚和数据可读演练通过；Canary/Beta 时间窗口转入通过后的运营策略；
8. 发布候选已形成可审查提交和不可变 release manifest。

在此之前，第 6 阶段的 `GO` 只代表共享 Python Runtime 原型及其真机技术门禁通过；Python Local 仍应保持 Beta 默认关闭。第 7 阶段通过后，才允许将其作为受策略控制的正式 Android Runtime 选项逐步推广。
