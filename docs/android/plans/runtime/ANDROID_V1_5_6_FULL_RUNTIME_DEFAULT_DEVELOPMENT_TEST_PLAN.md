# OpenDrSai Android v1.5.6：移除 Kotlin Lite、默认绑定 Full Runtime 开发测试方案

> 文档版本：V1.0  
> 产品版本：v1.5.6（versionCode 10506）  
> 首个实施渠道：`OpenDrSai.Debug` / `ai.drsai.remote.debug`  
> 发布基线：v1.5.5 已发布版本  
> 状态：待实施  
> 制定日期：2026-08-04  
> 协议基线：OAEP Stable 1.0 / `oaep.session-stream/1`

## 1. 版本与范围结论

本轮开发版本确认是 **Android v1.5.6**，不是 v1.6.0。

- v1.5.5 是已经发布的稳定基线，不修改、不覆盖其正式签名产物。
- v1.5.6 是当前调试版本，第一阶段只在 `OpenDrSai.Debug` 上启用。
- 此前生成的 v1.6.0 APK、manifest 和验收结果视为开发试验材料；可以复用测试方法，但不能替代 v1.5.6 的重新构建和重新验收。
- v1.5.6 Debug 通过后，是否进入 Internal/MVP/Release 由单独的 Go/No-Go 决策决定，不在本方案中自动放量。

## 2. 产品目标

v1.5.6 的唯一核心目标是：

> **移除 Android 本地纯 Kotlin Lite Agent Loop，使本地 OpenDrSai Agent 默认且唯一绑定 Android Full Agent Runtime。**

本文中的 **Android Full Runtime** 指 APK 内 `:runtime` 进程承载的共享 Python Agent Core；**Remote Full Runtime** 指经 Relay 连接的 Desktop/服务器 Runtime。两者必须在代码、UI、诊断和证据中使用不同 authority，不得混称。

目标运行链固定为：

```text
OpenDrSai.Debug
  -> FullRuntimeBindingCoordinator
  -> PythonRuntimeClient
  -> non-exported :runtime Service
  -> shared Python Agent Core
  -> Android Host Ports
       Model / Tool / Approval / Artifact / Lifecycle / Checkpoint
  -> Normalized Agent Event
  -> Android OAEP Writer
  -> OAEP Journal + Snapshot + Projection
  -> Android UI / Recovery / Relay
```

本地对话不得再出现以下生产路径：

```text
AppViewModel -> SelectableLocalChatEngine -> Kotlin LocalAgentRuntime
Full Runtime failure -> automatic Kotlin Lite fallback
signed policy off -> Kotlin Lite
model tool error -> silently become an unlabelled pure-chat Agent
```

## 3. 当前问题基线

当前 v1.6.0 Debug 试验包暴露了五个必须在 v1.5.6 修复的问题：

1. APK 打包了 Chaquopy/Python，但生成常量为 `PYTHON_LOCAL_RUNTIME_ENABLED=false`；“已打包”不等于“已运行”。
2. Debug 没有 Runtime policy 公钥，灰度偏好为空；四条件选择器确定性进入 `KOTLIN_LITE`。
3. `DEFAULT_AGENT.description` 固定显示“轻量智能 Agent”，与真实执行路由无关。
4. Full Runtime 的 Skill schema 使用空能力集筛选，能力型 Skill 会被错误排除。
5. Tool schema 在多个位置重复维护；模型返回不兼容错误时，Kotlin 路径会自动退成纯对话，用户只看到“没有工具能力”。

因此 v1.5.6 不采用“把 feature flag 改成 true 就结束”的做法，而是同时关闭路由、能力、UI、恢复、工具和验收缺口。

## 4. 架构不变量

1. **单一本地 Runtime**：本地 Agent Run 只能由 Android Full Agent Runtime 执行。
2. **无 Kotlin Lite 回退**：Full Runtime 初始化、绑定或执行失败时，只允许重绑、恢复、显式失败或进入 reconciliation；不得切换 Kotlin Agent Loop。
3. **远程路径显式**：平台/远程 Full Runtime 仍可用，但必须由用户选择 Platform Agent 或明确路由，不能作为本地失败后的隐式替代。
4. **OAEP 唯一事实源**：Run、Item、Tool、Approval、Artifact、恢复和 UI 状态继续以 OAEP Journal/Snapshot 为权威。
5. **单一 Tool Registry**：Tool 定义、JSON Schema、能力、风险和执行器来自同一注册表，不在 Model Client 和 AppViewModel 各维护一份。
6. **能力真实可见**：Agent、Skill、Tool 与 Runtime 状态必须来自当前绑定和协商结果，不允许写死“轻量”或“完整”。
7. **副作用可恢复**：Full Runtime 失败后不能通过换执行器重放副作用；必须使用 checkpoint、receipt 和 reconciliation。
8. **Debug 先行**：本轮所有默认启用变更首先限定在 `.debug` 包，不改变 v1.5.5 正式包行为。
9. **数据兼容**：从 v1.5.5 升级到 v1.5.6 不删除 Conversation、OAEP Session/Run/Item、Checkpoint、Approval、Artifact、Memory 和 SAF 授权引用。
10. **状态可证明**：必须能从应用内诊断和自动证据证明“当前 Run 使用 Full Runtime”，不能再通过 APK 大小或内存占用推断。

## 5. 功能模块与验收项

本方案共 10 个模块、60 个功能点。

### M01 版本和 Debug 构建基线（6）

| 编号 | 功能 | 验收标准 |
|---|---|---|
| M01-F01 | 将开发版本统一为 v1.5.6 / 10506 | APK metadata、BuildConfig、应用内版本、更新 manifest 完全一致 |
| M01-F02 | 保留 v1.5.5 正式基线 | 保存 APK/hash/schema/DB 升级输入，禁止调试构建覆盖正式产物 |
| M01-F03 | 清理 v1.6.0 开发版本口径 | 活跃代码、OAEP 最低客户端门禁和新报告不再把 v1.6.0 当当前版本 |
| M01-F04 | Debug 明确启用 Full Runtime | 生成的 Debug `BuildConfig` 必须为 Full Runtime enabled |
| M01-F05 | Debug APK 包含完整 Runtime | arm64/x86_64 Python、Service、Core 和依赖完整，启动前做静态校验 |
| M01-F06 | 构建身份可追溯 | commit、dirty、APK、mapping（如有）、SBOM、OAEP Schema hash 关联 |

### M02 删除 Kotlin Lite 生产路由（6）

| 编号 | 功能 | 验收标准 |
|---|---|---|
| M02-F01 | 删除 `SelectableLocalChatEngine` 的生产选择 | `AppViewModel` 本地引擎直接依赖 Full Runtime engine |
| M02-F02 | 移除 `LocalAgentRuntime` 生产注入 | 生产依赖图和 APK class/reference gate 不存在 Kotlin Agent Loop 入口 |
| M02-F03 | 删除 build/user/policy → Lite 分支 | Debug 不因缺少签名灰度策略而进入 Lite；策略只控制 Full Runtime 是否可用或阻断 |
| M02-F04 | 删除 safe Python→Kotlin fallback | Python 首事件前失败也只能重绑 Full Runtime或显式失败 |
| M02-F05 | 删除 Lite pause/stop/recovery 路由 | 所有本地生命周期操作只发给 Full Runtime 和 OAEP coordinator |
| M02-F06 | 建立静态反回归门禁 | CI 扫描新增 Lite engine、fallback 或双本地 authority 即失败 |

说明：Kotlin 数据模型、Android Host Adapter、Room/OAEP Codec 可以继续保留；要删除的是“纯 Kotlin Agent 执行循环”和它的生产回退入口，而不是删除所有 Kotlin 代码。

### M03 Full Runtime 默认绑定与健康状态（6）

| 编号 | 功能 | 验收标准 |
|---|---|---|
| M03-F01 | 新增 `FullRuntimeBindingCoordinator` | 登录并进入主界面后主动绑定 `:runtime` Service |
| M03-F02 | 定义绑定状态机 | `UNINITIALIZED→BINDING→READY→RECOVERING/UNAVAILABLE` 状态合法且持久可诊断 |
| M03-F03 | 发送前 READY 门禁 | 未 READY 时禁用发送或排队等待绑定，不创建半个 Run |
| M03-F04 | Binder 死亡自动重绑 | 无副作用 Run 可继续；已有副作用 Run 进入 receipt/reconciliation 恢复 |
| M03-F05 | 前后台生命周期策略 | 活跃 Run 保持绑定；无 Run 可延迟释放，但下次仍只重绑 Full Runtime |
| M03-F06 | 账户隔离和退出 | 换账号/退出取消旧绑定、清理内存 capability，不读取另一账户 checkpoint |

### M04 Full Runtime 执行和 OAEP 闭环（6）

| 编号 | 功能 | 验收标准 |
|---|---|---|
| M04-F01 | 本地 Run 只经 `PythonSharedCoreChatEngine` | 每个 Run 产生 Runtime start/bind 指标和 OAEP source 证明 |
| M04-F02 | 完整 Host Port 注入 | Model、Tool、Approval、Artifact、Lifecycle、Audit、Checkpoint 均非空且账户绑定 |
| M04-F03 | Normalized/OAEP 单一出口 | Python 私有 Envelope 不被 UI、Legacy Message 或 Relay 直接消费 |
| M04-F04 | 首事件前故障处理 | 重绑/有限重试不产生第二 Run、不重复用户 Item |
| M04-F05 | 首副作用后故障处理 | 使用 checkpoint/receipt 恢复或进入 waiting reconciliation，不回退其他引擎 |
| M04-F06 | 终态闭包 | completed/failed/cancelled 后不能继续写 Delta、Tool 或 Artifact |

### M05 Tool、Skill 和能力闭环（6）

| 编号 | 功能 | 验收标准 |
|---|---|---|
| M05-F01 | 合并 Tool schema 单一来源 | Model 请求中的 schema 与实际 `ToolRegistry` 定义逐字段一致 |
| M05-F02 | 基础工具默认可用 | 时间、设备信息、保存记忆、搜索记忆在无 SAF 权限时可调用 |
| M05-F03 | 工作区工具按授权开放 | SAF 授权后 list/read/search/write 出现；撤销后立即消失且 fail closed |
| M05-F04 | 修复 Skill capability pinning | 使用当前 Run 的真实 capabilities，不再以 `emptySet()` 过滤 |
| M05-F05 | 审批与副作用 | write/sensitive Tool 显示 OAEP Interaction；首个决定胜出且副作用一次 |
| M05-F06 | 模型工具兼容性可见 | HAI 模型拒绝 tools 时记录 model/status/code，Run 明确失败或提示，不静默纯对话 |

v1.5.6 Debug 基础 Tool 清单：

```text
get_current_time
get_device_info
save_memory
search_memory
workspace.list       （需要 SAF_READ）
workspace.read       （需要 SAF_READ）
workspace.search     （需要 SAF_READ）
workspace.write      （需要 SAF_WRITE + Approval）
core.text_stats
core.update_plan
delegate             （最多 3 个逻辑子任务）
```

### M06 UI、个人中心和诊断（6）

| 编号 | 功能 | 验收标准 |
|---|---|---|
| M06-F01 | 移除“轻量智能 Agent”固定文案 | Debug 本地 Agent 显示“Android Full Agent Runtime”或真实状态 |
| M06-F02 | 展示当前执行路由 | 每个 Run 可见 `Full Local` / `Remote Platform`，不得用包渠道代替路由 |
| M06-F03 | 个人中心 Runtime 诊断 | 显示 build enabled、binding、health、policy、process、starts/binds/fallbacks |
| M06-F04 | 工具能力清单 | 显示可用/缺权限/模型不支持的 Tool 和 Skill，不把“未授权”显示成“不存在” |
| M06-F05 | 明确不可用状态 | Full Runtime 未 READY 时显示原因、重试和导出脱敏诊断入口 |
| M06-F06 | 无 Kotlin fallback 指标 | UI 和诊断固定显示 `kotlin_fallback_available=false`，发现 fallback 立即阻断验收 |

### M07 v1.5.5→v1.5.6 数据与运行迁移（6）

| 编号 | 功能 | 验收标准 |
|---|---|---|
| M07-F01 | 历史数据升级 | v1.5.5 Conversation/Message/OAEP/Memory/Artifact 全部可读 |
| M07-F02 | 已完成 Run | Snapshot digest 升级前后相同 |
| M07-F03 | running/waiting Run | 可恢复则绑定 Full Runtime 恢复；否则明确 paused/failed，不永久 running |
| M07-F04 | 旧 Lite checkpoint | 一次性转换为 Full Runtime 可识别恢复描述或明确不可恢复终态 |
| M07-F05 | Tool receipt 与 Approval | 已执行副作用不重放；pending Approval 仍绑定原 Run/Interaction |
| M07-F06 | 降级/回滚策略 | v1.5.6 Debug 回滚到基线时不破坏 OAEP 数据；不得靠 Kotlin fallback 实现回滚 |

### M08 可靠性、性能和资源（6）

| 编号 | 功能 | 验收标准 |
|---|---|---|
| M08-F01 | 进程启动/杀死循环 | 100 次 bind/kill/rebind，无永久挂起、无重复协调器 |
| M08-F02 | 长 Run 与后台 | 旋转、分屏、锁屏、后台、系统回收后恢复同一 Run |
| M08-F03 | 压力矩阵 | 500 Run、50 Tool、20 Recovery，0 重复副作用、0 数据损坏 |
| M08-F04 | Runtime bind 性能 | 真机 bind P95 ≤2 秒，受控本地首事件 P95 ≤5 秒 |
| M08-F05 | 内存与包体预算 | 主进程+Runtime PSS 不超过既有 220 MB 门禁；记录 APK/安装体积增量来源 |
| M08-F06 | 数据库增长与压缩 | 500 Run 后保持既有 64 MB 门禁，Snapshot/Replay digest 不变 |

### M09 安全和权限（6）

| 编号 | 功能 | 验收标准 |
|---|---|---|
| M09-F01 | Runtime Service 隔离 | `exported=false`、独立 `:runtime`、外部 Intent/绑定全部拒绝 |
| M09-F02 | Host Port 最小权限 | Python Core 不直接获得 Context、任意路径、Shell、Token 或数据库句柄 |
| M09-F03 | Tool capability fail closed | 未授权 SAF、跨账户、未知 Tool、非法参数均在执行前拒绝 |
| M09-F04 | 敏感数据扫描 | APK、logcat、OAEP、checkpoint、receipt、诊断中 Token/绝对路径 0 命中 |
| M09-F05 | 审批抗竞态 | 重复点击、跨端竞争、进程重启后只有一个授权结果和一个副作用 |
| M09-F06 | 依赖与供应链 | CycloneDX SBOM、Python wheels/native libs hash、许可证和漏洞门禁通过 |

### M10 Debug 发布和最终验收（6）

| 编号 | 功能 | 验收标准 |
|---|---|---|
| M10-F01 | 生成 v1.5.6 Debug 候选 | 包名 `.debug`、version 1.5.6/10506、Full Runtime enabled |
| M10-F02 | 真机默认绑定证明 | 冷启动后 `:runtime` READY；首次本地 Run 的 starts/binds >0 |
| M10-F03 | 真机基础 Tool E2E | 时间、设备、记忆、SAF read/write、approval 均产生规范 OAEP Tool Item |
| M10-F04 | 真机故障恢复 E2E | bind death、Python crash、网络中断、进程回收均不进入 Kotlin |
| M10-F05 | 跨端 OAEP 回归 | Android→Desktop、Desktop→Android、SSE 重连和审批竞态通过 |
| M10-F06 | Debug Go/No-Go | 60/60、自动化、真机、安全、性能、迁移全部通过才标记 Debug Ready |

## 6. 关键实现改造

### 6.1 构建配置

Debug 必须明确生成：

```kotlin
buildConfigField("boolean", "FULL_AGENT_RUNTIME_ENABLED", "true")
buildConfigField("boolean", "KOTLIN_LITE_RUNTIME_ENABLED", "false")
```

不建议继续使用含义模糊的 `PYTHON_LOCAL_RUNTIME_ENABLED` 作为唯一产品开关。过渡期可以保留兼容字段，但两者必须由 drift test 证明一致，随后删除旧字段。

Debug 不依赖远程签名策略才能进入 Full Runtime。签名策略可以决定“允许/暂停 Full Runtime”，但当策略拒绝时结果必须是 `FULL_RUNTIME_BLOCKED`，不是 `KOTLIN_LITE`。

版本修正必须原子更新并由单测锁定：

- 系统版本源和 Android variant output：`1.5.6` / `10506`；
- `AndroidOaepReleaseGate` 的 Android Runtime 当前版本与最低版本；
- Relay OAEP version matrix、capability 响应和最低 Android 客户端声明；
- 更新 manifest、应用内个人中心、SBOM、发布证据和升级 fixture；
- v1.5.5 仍保持可识别的已发布基线，服务端不得错误要求其具备 v1.5.6 新能力。

### 6.2 生产依赖图

目标构造应从：

```text
SelectableLocalChatEngine(kotlin, python, rollout)
```

改为：

```text
FullRuntimeChatEngine(
  bindingCoordinator,
  pythonRuntimeClient,
  hostPortsFactory,
  oaepSink,
  recoveryPolicy,
)
```

`LocalAgentRuntime`、`LocalChatEngine(LocalAgentRuntime)` 和 `safePythonFallback` 不得出现在 Debug 生产图。测试 fixture 如需对照旧数据，应放入 test source set，不能进入 APK。

### 6.3 失败状态

| 故障点 | 允许动作 | 禁止动作 |
|---|---|---|
| 首 Run 前 bind 失败 | 有界重试、显示 unavailable、用户重试 | 创建 OAEP Run 后切 Kotlin |
| Run 已创建但无副作用 | 重绑 Full Runtime、复用 Run/idempotency key | 新建第二 Run |
| Tool intent 已提交 | 查询 receipt、恢复或 reconciliation | 用 Kotlin 重放 Tool |
| Runtime 进程死亡 | 相同账户/Session/Run 重绑 | 静默变纯对话 |
| 模型拒绝 Tool schema | 显示模型兼容错误或明确禁用的 Tool 原因 | 无提示重试纯文本 |
| 策略紧急关闭 | 停止新 Run，进行中 Run 安全暂停/恢复 | 回退 Lite |

### 6.4 Tool schema 单一来源

`ToolRegistry` 应提供稳定的 `definitions(context)` 和 `toModelSchemas(context)`。Kotlin Model Gateway、Python Host Port、UI 能力页和测试 fixture 全部消费同一结果。

以下重复定义必须收敛：

- `HaiModelClient.toolDefinitions`；
- `AppViewModel.toolSchemas`；
- `defaultLocalToolRegistry`；
- Android device/SAF Tool 注册；
- UI Skill/Tool 展示清单。

## 7. 测试策略

### 7.1 静态和构建测试

1. 解析 Debug `BuildConfig`，断言 Full=true、Lite=false、版本=1.5.6/10506。
2. 解析 merged manifest，断言 Runtime Service 非导出且运行于 `:runtime`。
3. APK class/reference scan，禁止生产图引用 `SelectableLocalChatEngine`、`LocalAgentRuntime.run` 和 `safePythonFallback`。
4. APK native/runtime scan，确认目标 ABI、Python Core、依赖和 OAEP schema 完整。
5. Tool schema drift test，Registry、Model Gateway、Python Host、UI 四方 digest 相同。
6. OAEP codegen/schema drift check。

### 7.2 JVM 单元测试

| 测试组 | 必测场景 |
|---|---|
| Binding state machine | 首绑、并发绑、超时、Binder death、账户切换、重复回调 |
| Runtime route | Debug 永远 Full；policy off/health false 不产生 Lite 路由 |
| Tool Registry | 基础 Tool、SAF capability、参数、风险、审批、schema digest |
| Skill pinning | CHAT/FILES/APPROVALS 等真实能力包含与缺失 |
| Failure policy | 首事件前失败、首副作用后失败、receipt、reconciliation |
| OAEP | sequence、revision、dedupe、terminal、Snapshot/Replay digest |
| UI model | Full/Binding/Unavailable/Tool downgrade 映射，不出现固定 Lite 文案 |
| Migration | v1.5.5 fixture、旧 Lite checkpoint、pending Approval、幂等重复升级 |

### 7.3 Instrumentation 和真机测试

目标设备至少包括：

- API 26 x86_64 模拟器；
- API 30 x86_64 模拟器；
- API 35 x86_64 模拟器；
- Samsung SM-X936C Android 16/API 36 arm64 真机。

真机必须采集：

```text
package/version/build channel
main pid + :runtime pid
binding state and latency
runtime starts/bind attempts/bind successes
selected route per Run
available Tool/Skill ids and missing reasons
OAEP Run/Item/Event counts and digest
main/runtime PSS
APK/install/database sizes
fallback count（必须为 0，且代码路径不存在）
```

### 7.4 基础 Tool 真实 E2E

每个 Tool 必须由“模型生成结构化 Tool Call”触发，不能直接调用 executor 冒充 Agent E2E。

| 场景 | 预期 |
|---|---|
| “现在几点？” | `get_current_time` Tool Item completed，回答引用结果 |
| “告诉我安全的设备环境信息” | `get_device_info`，不返回设备标识符 |
| “记住我偏好深色主题” | `save_memory`，形成本地写入审计 |
| “我之前偏好什么主题？” | `search_memory` 返回同账户内容 |
| 未授权时列目录 | Tool 显示缺 SAF_READ，不伪造空目录 |
| 授权后列/读文件 | `workspace.list/read` 返回授权树内内容 |
| 写文件 | 出现 Approval；批准后一次写入和一个 receipt |
| 重复审批/重放 | 不重复写文件 |
| 模型拒绝 tools | UI 显示 model compatibility failure，不变纯聊天 |

测试分两层：

1. 确定性模型 fixture：验证所有协议、Tool、OAEP 和故障注入；
2. 当前 HAI 开发环境真实模型：至少执行时间、设备、记忆、SAF read 和审批 write 五条主链。

### 7.5 故障注入矩阵

| 注入点 | 预期结果 |
|---|---|
| bind 前杀死 Runtime | 有界重绑，Run 尚未创建 |
| Run created 后杀死 Runtime | 恢复同一 Run/sequence |
| Tool intent 后杀死 Runtime | 查询 receipt，不重复执行 |
| Tool success 后、OAEP completed 前杀死 | receipt replay 完成同一 Tool Item |
| Approval waiting 时杀进程 | 重启仍显示同一 Interaction |
| SSE cursor=4 断线 | 从 4 恢复，无重无漏 |
| 模型流中断 | Run failed/recoverable 或 paused，不切 Lite |
| OAEP sequence gap | fail closed，Snapshot 恢复 |
| 账户切换时活跃 Run | 旧 Run 暂停/取消，另一账户不可见 |

### 7.6 v1.5.5 升级测试

使用真实或脱敏复制的 v1.5.5 数据库执行：

1. 安装 v1.5.5 基线并创建文本、多轮、附件、Tool、Memory、Approval 和 Artifact 数据；
2. 保留 app data 升级安装 v1.5.6 Debug-compatible fixture；
3. 校验全部历史 OAEP Snapshot digest；
4. 校验旧 running/waiting Run 的确定性迁移；
5. 使用 v1.5.6 Full Runtime 新建 Run 并调用 Tool；
6. 故障注入后重启，验证 receipt 和 Item identity；
7. 执行可恢复 APK 回滚演练，确认数据仍可读。

### 7.7 性能与稳定性

- 10 次冷启动和 20 次 Runtime bind/rebind，报告 P50/P95/max。
- 30 分钟连续对话、100 个短 Run、500 Run 压力三组分别执行。
- Tool 并发上限、Binder 消息上限、Runtime idle release、后台恢复分别采样。
- 分开记录主进程与 `:runtime` PSS，不能只报告合计或 APK 安装大小。
- 若超过 220 MB 既有门禁，必须提供归因和优化结果，不能以“Full Runtime 本来就大”豁免。

### 7.8 安全测试

- 外部应用绑定 Runtime Service：必须失败。
- Python 尝试访问任意路径、环境 Token、Android Context、Shell：必须失败。
- 动态 canary 注入 Token、私有正文和绝对路径，扫描 OAEP/Checkpoint/Receipt/logcat/diagnostic。
- 跨账户读取 Tool、Memory、Artifact、Checkpoint、OAEP Snapshot：返回 0 条或 scope mismatch。
- SAF symlink/traversal、超大文件、恶意 MIME、撤销授权全部 fail closed。
- Approval 过期、重复、冲突和重放全部只产生一次决定。

## 8. 实施轮次

### 第 1 轮：版本与可证明基线（M01）

- 修正 v1.5.6/10506；冻结 v1.5.5 fixture。
- 生成当前 Debug 路由、metrics、Tool schema 和 APK 依赖基线。
- 建立 Full=true/Lite=false 与版本 drift gate。

出口：Debug 构建身份正确，且能自动证明旧包为何进入 Lite。

### 第 2 轮：删除 Lite、默认绑定 Full（M02、M03）

- 改造生产依赖图和绑定 coordinator。
- 删除 Kotlin fallback、Lite 生命周期路由和隐式远程替代。
- 完成 Binder death、并发绑定、账户切换测试。

出口：静态扫描和运行时路由都不存在 Kotlin Agent Loop。

### 第 3 轮：Full Runtime/OAEP/恢复（M04、M07）

- 收敛执行入口、Host Ports、checkpoint/receipt/reconciliation。
- 完成 v1.5.5 数据和旧 Run 迁移。

出口：正常、崩溃、升级三条路径产生同一 OAEP 事实。

### 第 4 轮：Tool/Skill 完整体（M05）

- 合并 Tool schema；修复 capability pinning。
- 完成基础 Tool、SAF、Approval、Artifact、delegate E2E。
- 对真实 HAI 模型做 Tool API 兼容验证。

出口：基础 Tool 不是“代码存在”，而是模型可发现、可调用、可展示、可恢复。

### 第 5 轮：UI 与诊断（M06）

- 移除轻量固定文案。
- 显示实际绑定、执行路由、能力与降级原因。
- 建立用户可导出的脱敏诊断。

出口：用户无需 ADB 即可判断当前是否在用 Full Runtime。

### 第 6 轮：真机、压力、安全和 Debug Go（M08、M09、M10）

- 完成设备矩阵、真机 Tool、故障恢复、压力、性能、安全与跨端测试。
- 生成 v1.5.6 Debug manifest 和最终 60 项 ledger。

出口：60/60 后标记 `v1.5.6 Debug Ready`；不自动发布 Release。

## 9. CI 与证据产物

建议新增以下自动化入口：

```text
scripts/verify_android_v1_5_6_full_runtime_architecture.py
scripts/accept_android_v1_5_6_build_identity.py
scripts/accept_android_v1_5_6_tool_e2e.py
scripts/accept_android_v1_5_6_upgrade.py
scripts/accept_android_v1_5_6_runtime_recovery.py
scripts/accept_android_v1_5_6_security.py
scripts/accept_android_v1_5_6_performance.py
scripts/finalize_android_v1_5_6_debug_acceptance.py
```

证据统一写入：

```text
docs/android/reports/evidence/v1.5.6/
  build-identity.json
  architecture-gate.json
  runtime-binding.json
  tool-e2e.json
  oaep-parity.json
  upgrade-v1.5.5-to-v1.5.6.json
  recovery.json
  device-matrix.json
  performance.json
  security.json
  final-debug-go-no-go.json
```

每份 JSON 至少包含：schema version、UTC 时间、commit、dirty 状态、APK hash、包名、版本、设备、测试数、失败数和各 gate 布尔值。

## 10. Debug Go/No-Go 硬门禁

以下任一项不满足，结论必须是 No-Go：

1. APK 不是 v1.5.6/10506 或包名不是 `.debug`；
2. BuildConfig 没有明确 Full=true、Lite=false；
3. 生产依赖图仍能进入 `LocalAgentRuntime` 或 safe Kotlin fallback；
4. 真机本地 Run 的 Runtime starts/binds 为 0；
5. UI 仍固定显示轻量 Agent，或无法显示实际路由；
6. 基础四 Tool 任一不能由模型真实调用；
7. SAF Tool 未按授权动态出现或 write 未审批；
8. 模型 Tool 不兼容时静默降为纯聊天；
9. Binder/进程故障产生第二 Run、重复 Tool 或重复副作用；
10. v1.5.5 升级丢数据或留下永久 running；
11. OAEP 实时、Replay、Snapshot 或跨端 digest 不一致；
12. 安全、性能、设备矩阵或 60 项 ledger 未全部通过。

## 11. 完成定义

只有同时满足以下条件，才能说“v1.5.6 Debug 已实现默认 Full Runtime”：

- `OpenDrSai.Debug` 安装后无需隐藏开关或 ADB 修改即可绑定 Full Runtime；
- 本地每个新 Run 都有可查询的 Full Runtime identity、starts/binds 和 OAEP source；
- Kotlin Lite Agent Loop 和自动 fallback 不在生产 APK 的可达路径；
- Full Runtime 不可用时用户看到明确状态，数据和副作用保持一致；
- Tool、Skill、Approval、Artifact、Subagent、恢复均通过真机结构化 E2E；
- 个人中心与 Run UI 显示真实 Runtime 和能力，不再显示固定“轻量”描述；
- v1.5.5 数据升级无损；
- 10 模块 60 功能点全部具备代码、自动化和证据文件；
- 最终 `final-debug-go-no-go.json` 为 `passed=true`、`decision=GO`。

完成本方案只代表 **v1.5.6 Debug Ready**。进入 Internal/MVP/Release 前，应以相同 APK 源码、正式签名策略和 clean CI 再执行一次发布级验收。
