# OpenDrSai Android P9-E：模拟器连续开发与预验收方案

> 阶段编号：Android P9-E（P9 Emulator Continuation，P9 执行子阶段）  
> 所属总阶段：Android P9——Desktop Full Agent Runtime 能力对等  
> 产品基线：Android v1.5.6 Debug（`OpenDrSai.Dev` / `ai.drsai.remote.debug` / versionCode 10506）  
> 文档版本：V1.1  
> 制定日期：2026-08-12  
> 当前 P9 总账本：69/72（95.83%）  
> 当前 P9-E 预验收：33/40（82.5%）  
> 当前待验收：M04-F06、M09-F06、M12-F06  
> 文档状态：执行中（Emulator 主开发阶段）  

## 0. 当前执行快照（V1.1）

截至 2026-08-12，P9-E 已完成 33/40 个预验收功能点。当前候选已完成 API 26、30、35、36 Emulator 的同候选冒烟矩阵，Android JVM、instrumentation/Compose 与 P5 架构门禁已有全绿证据；正式 P9 总账本仍保持 69/72，不因模拟器结果提前接受真机门禁。

当前剩余工作按以下顺序推进：

1. 在 Emulator 的 `OpenDrSai.Dev` 内保存智增增 API Key，完成 `deepseek-v4-flash` 与 `deepseek-v4-pro` 的真实模型预跑和统计验收；
2. 完成全量 Python 回归的稳定复跑，并确保报告绑定当前 APK/Test APK、Kernel、Prompt、Tool 与 fixture digest；
3. 用户确认 P9 候选改动范围后，从干净 checkout 构建唯一候选，完成 E08-F02 与证据一致性检查；
4. P9-E 达到 40/40 后冻结候选与真机运行清单；待 ARM64 真机恢复，仅执行正式 180 次统计和 M04-F06、M09-F06、M12-F06，不在真机现场继续改代码。

当前人工前置条件只有两项：

- 真实模型预跑前：用户需在 Emulator 应用内录入 API Key；密钥不得通过聊天、脚本参数、日志或报告传递；
- 干净候选构建前：用户需确认 P9 改动范围，避免把共享工作区中的 Desktop、Python、文档或语音等无关改动混入候选。

ARM64 真机不是当前 P9-E 开发阻塞项，只是 P9 正式发布验收的延后门禁。

## 1. 阶段确认与结论

下一开发阶段确认是 **P9-E**，不是 P10，也不创建新的 Android 产品版本。P9-E 是在暂时没有 ARM64 真机时，以 Android x86_64 Emulator 推进 P9 剩余工作的开发与预验收阶段。

P9-E 的核心结论是：

> 在模拟器上把 Android Full Agent Runtime 的自然工具选择、模型/工具循环、OAEP 事件、错误正文、恢复和 UI 可观测性修到确定性测试全绿，并完成真实服务商的模拟器预跑；待真机恢复后，只执行候选 APK 绑定、180 次正式统计和最终 Go/No-Go，不再在真机上临时调代码。

模拟器能够证明代码路径和行为质量，但不能伪造物理设备证据。以下 P9 正式门禁保持不变：

1. M04-F06 的发布证据必须来自正式 M09-F06 中同一批 90 次 `deepseek-v4-flash` 真机观测；
2. M09-F06 必须在 ARM64 物理设备执行 `deepseek-v4-flash` 和 `deepseek-v4-pro` 共 180 次；
3. M12-F06 必须绑定干净 checkout 构建的唯一 APK SHA-256，并汇总全部正式证据；
4. P9-E 期间 P9 总账本保持 69/72，模拟器预验收结果不得把上述三项改为 `accepted`。

## 2. 当前基线与问题判断

### 2.1 已有能力

1. Android 默认绑定共享 Python Full Runtime，不再把 Kotlin Lite 作为生产回退；
2. Android 与 Desktop 已共享 Agent Kernel、Prompt、Tool Policy、Memory、Skill、Subagent 和 OAEP 基础语义；
3. OAEP Run/Item/Tool/Approval/Artifact/错误事件已有 Journal、Snapshot、Projection 和 UI；
4. 智增增预设已包含 `https://api.zhizengzeng.com/v1`、`deepseek-v4-flash` 和 `deepseek-v4-pro`；
5. 2026-08-08 已在 Samsung SM-X936C/API 36 完成 180 次真实调用，证明模型路由和凭据当时可用；
6. P9 已有 69 个功能点正式通过，剩余工作集中在真实自然工具选择及最终候选签发。

### 2.2 上轮真实模型结果

| 指标 | 当前结果 | P9 门槛 | 结论 |
|---|---:|---:|---|
| 总请求数 | 180 | 180 | 数量满足 |
| 最终任务成功率 | 97.0% | ≥ 85% | 通过 |
| 工具选择正确率 | 61.7% | ≥ 85% | 失败 |
| 参数正确率 | 61.7% | ≥ 85% | 失败 |
| Runtime/Provider 错误率 | 7.2% | ≤ 5% | 失败 |

13 次被旧报告归入 `provider_error` 的失败实际是 Runtime 内部错误，而不是已经证明的 API Key、额度或网络错误：

- `memory_explicit_intent_required`；
- `context_active_chain_budget_overflow`；
- `subagent_tool_whitelist_denied`。

因此 P9-E 的重点不是放宽评分器，而是修复 Agent 对自然意图的映射、工具参数、活动工具链预算和 Subagent 白名单语义。

### 2.3 当前高风险自然任务

重点回归以下任务族：

1. `memory.save_preference`、`memory.find_preference`；
2. `workspace.list_docs`、`workspace.read_readme`、`workspace.read_config`；
3. `workspace.find_settings`、`workspace.find_gradle`；
4. `workspace.create_note`、`workspace.change_endpoint`；
5. `plan.create`；
6. `delegate.compare`、`delegate.research`；
7. `unavailable.latest_news`、`unavailable.shell`；
8. `HEPiX 2026 是什么？` 等必须检索和引用来源的自然问题；
9. `Hello` 等无需工具的普通消息。

## 3. 总体目标

### 3.1 产品目标

1. Android 对普通聊天、需检索任务、记忆任务、工作区任务、规划和委派任务作出与 Desktop Full Agent Runtime 等价的工具决策；
2. 需要工具时不得直接凭模型记忆回答，不需要工具时不得无意义调用；
3. Runtime 的每个模型请求、工具调用、审批、工具结果、错误和终态均可在 Android UI 中按 OAEP 顺序看到；
4. 错误提示展示稳定错误码和经过脱敏的真实正文，不再统一显示“Python Runtime unavailable”；
5. Emulator 上形成可重复、可诊断的真机前预验收闭环。

### 3.2 工程目标

1. 建立不覆盖正式 M04/M09 报告的 Emulator preflight runner；
2. 对 30 类自然任务提供单用例、单模型和全量运行入口；
3. 将模型行为失败、Provider HTTP 失败和 Runtime 内部失败分开计数；
4. 修复 Memory 意图、Context active-chain、Subagent whitelist 和 unavailable capability 语义；
5. 对 OAEP 事件序列、错误正文和用户可见 UI 建立自动回归；
6. 输出“真机就绪包”，使恢复真机后只需一次干净候选构建和正式重跑。

### 3.3 非目标

1. 不用 Emulator 结果替代 ARM64 物理设备证据；
2. 不修改 M04/M09 的正式统计阈值；
3. 不把单工具强制调用或在 Prompt 中出现工具名计作自然选择成功；
4. 不在测试代码、日志、报告或 APK 中写入智增增 API Key；
5. 不为通过测试恢复 Kotlin Lite、静默纯聊天或伪造工具结果；
6. 不在 P9-E 自动发布 Stable/Release 包。

## 4. 目标开发与验证链

```text
Natural Prompt / Hello / HEPiX / Workspace / Memory / Delegate
        |
        v
Shared Desktop Full Agent Kernel
  Prompt + Verification Policy + Context + Tool Policy
        |
        v
Android :runtime Python process
        |
        v
Kotlin Host Ports
  Model / Tool / Approval / Artifact / State / Lifecycle
        |
        v
OAEP Writer -> Journal/Snapshot -> Projection -> Compose UI
        |
        +--> deterministic fixture tests
        +--> x86_64 Emulator instrumentation
        +--> Emulator real-provider preflight (non-release evidence)
        `--> deferred ARM64 physical-device formal acceptance
```

强制不变量：

1. Emulator 和真机执行同一生产 Kernel、同一 Tool manifest 和同一 Prompt version；
2. 测试只允许替换 Host 工具结果，不允许替换 Agent 决策逻辑；
3. `run.completed`、`run.failed`、`run.cancelled` 必须且只能出现一个合法终态；
4. 错误必须保留来源类别、稳定码、retryable 和脱敏正文；
5. 任何 preflight 文件必须带 `evidence_tier=emulator_preflight`，不得写入正式 M04/M09 路径；
6. 正式验收脚本继续 fail closed 地拒绝 Emulator。

## 5. 需要新增、更新或移除的模块

### 5.1 新增模块

| 模块 | 用途 |
|---|---|
| `scripts/run_android_p9_emulator_preflight.py` | 启动/复用 AVD、安装 APK、执行确定性和真实模型预跑，输出统一摘要 |
| `scripts/score_android_p9_emulator_preflight.py` | 使用正式 scorer 计算选择率、参数率、终态率，但标记为非发布证据 |
| `docs/android/reports/preflight/p9-emulator/` | 保存 Emulator 预跑 JSON、JUnit、logcat 和脱敏截图 |
| Android `P9AgentEventVisibilityInstrumentedTest` | 验证事件顺序、错误正文、终态和 Compose 投影 |
| Android `P9NaturalTaskPreflightInstrumentedTest` | 支持按 case/model/attempt 运行 30 类自然任务 |
| Python/Kotlin failure taxonomy fixtures | 区分 model behavior、provider HTTP、runtime policy、host execution 和 OAEP projection 失败 |

### 5.2 更新模块

| 模块 | 更新内容 |
|---|---|
| `P9NaturalToolSelectionInstrumentedTest.kt` | 抽取可复用运行器；保留正式模式的 physical gate；增加独立 preflight 输出身份 |
| `PythonAgentLoopCoordinator.kt` | 保留 `ApiException` 与 Runtime 错误类型；修复 active-chain、审批和终态传播 |
| `PythonRuntimeEventMapper.kt` | 错误 message/detail 非空回退；补齐模型、工具、审批、恢复和终态事件 |
| Shared Agent Kernel Memory Policy | 将明确自然偏好识别为合法保存意图，拒绝隐式敏感记忆 |
| Shared Context/Token Budget | 工具链输出采用有界摘要，保证活动 call/result 不因预算错误中断 |
| Shared Subagent Policy | 统一委派工具白名单、继承能力和 unavailable capability 处理 |
| Tool/Verification Policy | 强化陌生实体、最新信息、工作区定位、规划和委派的自然选择规则 |
| `HaiModelClient.kt` | 细分 401/403/408/429/5xx、流式 schema 和错误正文，不泄露 Token |
| OAEP Diagnostics/Compose UI | 展示事件类型、执行位置、tool name、错误码、retryable 和脱敏正文 |
| P9 scorer/report schema | Provider 失败与 Runtime/行为失败分列；保留原始次数和失败 case |

### 5.3 移除或禁止的模块/行为

| 模块或行为 | 要求 |
|---|---|
| 统一包装为 `python_runtime_unavailable` | 移除；必须保留可操作的根因分类 |
| 空错误正文或只显示异常类名 | 移除；使用稳定回退正文并保留 OAEP Error Item |
| Memory 明确意图被二次策略误拒绝 | 修复并加入回归，不能通过关闭 Memory 安全策略绕过 |
| Subagent 运行时使用与声明不一致的工具白名单 | 移除双重来源，收敛到 capability snapshot |
| active-chain 固定小预算导致合法工具链溢出 | 替换为有界裁剪/摘要，系统策略和活动 tool receipt 不得丢失 |
| Emulator preflight 覆盖正式 evidence 文件 | 静态禁止并由报告路径测试拦截 |
| Emulator 伪装 physical device | 正式 runner 继续检查 serial、`ro.kernel.qemu` 和 ABI |

## 6. 功能点、测试与验收

P9-E 设置 8 个执行模块、40 个预验收功能点。它们是 P9 的实施清单，不新增或替代原 72 项正式账本。

### E01 Emulator 与候选身份（5）

| 编号 | 功能点 | 测试方案 | 预验收标准 |
|---|---|---|---|
| E01-F01 | 固定主 AVD | API 35 x86_64 冷启动、重启、快照关闭测试 | ADB 进入 `device`；启动超时和离线状态结构化失败 |
| E01-F02 | 扩展 API 矩阵 | API 26/30/36 各执行 Runtime 冒烟 | 四个 API 均可安装、绑定和完成 Hello；允许按顺序复用单端口 |
| E01-F03 | Debug 应用身份 | 读取 package/version/ABI/Runtime identity | 必须为 `ai.drsai.remote.debug`、v1.5.6、x86_64 Full Runtime |
| E01-F04 | APK/Test APK 身份绑定 | 计算 SHA-256 并写入 preflight manifest | 所有子报告引用同一 APK/Test APK hash |
| E01-F05 | 正式证据隔离 | 对输出路径和 `evidence_tier` 做负向测试 | Emulator 报告不能写入 `evidence/p9/m04-f06*` 或 `m09-f06*` |

### E02 Full Runtime 基础消息与生命周期（5）

| 编号 | 功能点 | 测试方案 | 预验收标准 |
|---|---|---|---|
| E02-F01 | Hello 普通消息 | 新会话发送 `Hello` 和中文问候 | 不需要工具；收到非空流式正文和唯一 `run.completed` |
| E02-F02 | 连续消息 | 同会话连续发送三条普通消息 | 前一 Run 终态不阻塞下一 Run；无残留 outbox/running |
| E02-F03 | 冷启动绑定 | force-stop 后启动并发送 Hello | `BINDING→READY` 后执行；不进入 Kotlin Lite |
| E02-F04 | Runtime 进程死亡恢复 | 在等待模型/工具阶段终止 `:runtime` | 可恢复阶段接回同一 Run；不可恢复阶段明确失败，无重复副作用 |
| E02-F05 | 取消与后台 | 流式中取消、切后台和恢复前台 | 取消产生合法终态；UI 与 OAEP 状态一致；无 ANR |

### E03 OAEP 事件与错误真实性（5）

| 编号 | 功能点 | 测试方案 | 预验收标准 |
|---|---|---|---|
| E03-F01 | 模型事件链 | 成功、空流、断流 fixture | started/delta/completed 或 failed 顺序合法，无重复 |
| E03-F02 | 工具事件链 | 单工具、多轮工具、工具失败 fixture | tool call、result、Error Item 和 Run 终态全部可重放 |
| E03-F03 | HTTP 错误分类 | 注入 400/401/403/408/429/500 | code、retryable、status 和脱敏正文准确；仅重试可重试错误 |
| E03-F04 | Runtime 错误分类 | 注入 Memory、Context、Subagent 和 schema 错误 | 不再统一成 provider error；根因正文出现在诊断和 UI |
| E03-F05 | Compose 事件展示 | UI test + 截图 + OAEP snapshot 比对 | UI 展示每个关键事件、工具名、状态和错误正文；不展示密钥/原始思维链 |

### E04 Memory、Context 与恢复（5）

| 编号 | 功能点 | 测试方案 | 预验收标准 |
|---|---|---|---|
| E04-F01 | 明确偏好保存 | 三种自然表达、三次重复运行 | 正确选择保存工具和字段；不再触发 `memory_explicit_intent_required` |
| E04-F02 | 偏好检索 | 有结果、无结果、冲突结果 fixture | 正确选择搜索工具；回答只使用返回内容并标记来源 |
| E04-F03 | 敏感记忆拒绝 | 密码、Token、健康隐私对抗用例 | 不保存敏感正文；产生安全说明且 Run 合法完成 |
| E04-F04 | active-chain 预算 | read/edit、多工具长结果和 Unicode 压力测试 | 无 `context_active_chain_budget_overflow`；活动 call/result/receipt 不丢失 |
| E04-F05 | Checkpoint 重放 | 在模型前后、工具前后、OAEP 写入前后故障注入 | 恢复幂等；工具副作用最多一次；上下文顺序合法 |

### E05 Workspace、Plan 与 Subagent（5）

| 编号 | 功能点 | 测试方案 | 预验收标准 |
|---|---|---|---|
| E05-F01 | Workspace 查找 | list docs、find settings/gradle 自然任务 | 首选正确 search/glob/list 工具和参数，不用模型编造路径 |
| E05-F02 | Workspace 读取 | README/config 自然任务，Host 返回稳定 fixture | 选择 read 且 path 正确；工具结果回填后回答，不发生预算溢出 |
| E05-F03 | Workspace 写入 | create note/change endpoint，自动审批 fixture | search/read→preview/approval→write/edit 顺序正确；参数与 diff 正确 |
| E05-F04 | Plan 创建 | 单步无需计划、多步骤必须计划任务 | 只在复杂任务创建计划；步骤状态合法、无重复 Plan Item |
| E05-F05 | Subagent 委派 | compare/research、白名单缺失和父任务取消 | 合法委派成功；不再 `subagent_tool_whitelist_denied`；越权仍 fail closed |

### E06 Web、不可用能力与自然工具选择（5）

| 编号 | 功能点 | 测试方案 | 预验收标准 |
|---|---|---|---|
| E06-F01 | HEPiX 2026 | 受控搜索 fixture + Emulator UI E2E | 首轮调用 `web.search`；需要时 fetch；最终答案含与结果一致的引用 |
| E06-F02 | 最新信息 | latest news/version/date-sensitive fixture | Web 可用时必须检索；不可用时产生 Capability Notice，不直接编造 |
| E06-F03 | Shell 请求 | Android 本地无 Shell、无 Remote、已绑定 Remote 三种状态 | 本地不伪造执行；分别明确 unavailable 或产生可见 Handoff |
| E06-F04 | 30 类确定性自然任务 | 固定模型响应/Host fixture，三次重复 | 工具选择、参数、终态和 OAEP 100% 通过 |
| E06-F05 | 工具滥用负例 | Hello、常识、主观问题和澄清问题 | 不调用无关工具；需要澄清时先交互，不制造假调用 |

### E07 Emulator 真实服务商预跑（5）

| 编号 | 功能点 | 测试方案 | 预验收标准 |
|---|---|---|---|
| E07-F01 | 智增增配置读取 | 在 App 内配置后由 instrumentation 读取 provider/model | URL 和两个 upstream ID 正确；API Key 只验证存在，不输出正文 |
| E07-F02 | Flash 单例快速循环 | 先运行失败 case，每类 1 次 | 无 Runtime 内部错误；失败报告包含 case、选择、参数和正文 |
| E07-F03 | Pro 单例快速循环 | 同上 | 无 Runtime 内部错误；与 Flash 使用同一 Prompt/Tool digest |
| E07-F04 | 双模型全量预跑 | 30 类 × 3 次 × 2 模型，共 180 次 Emulator preflight | 选择率≥85%、参数率≥85%、最终成功率≥85%、非行为错误率≤5% |
| E07-F05 | 统计可信性 | 校验原始 observation、重复数、模型和错误分类 | 正好 180 条；不丢弃失败；Provider/Runtime/行为失败分列 |

说明：E07-F04 达标只表示“具备上真机条件”，不接受 M04-F06 或 M09-F06。

### E08 真机就绪与移交（5）

| 编号 | 功能点 | 测试方案 | 预验收标准 |
|---|---|---|---|
| E08-F01 | 全量本地回归 | Android JVM、Python、instrumentation、Compose tests | 全绿；无新增 P0/P1；测试数量不低于冻结基线 |
| E08-F02 | 干净候选预构建 | 在独立 clean worktree 构建 Debug/Test APK | commit、dirty 状态、APK hash、测试结果完整可复现 |
| E08-F03 | 真机运行清单 | dry-run 正式 runner 参数、路径和报告校验 | 恢复真机后只需授权 ADB、确认 provider 配置并运行脚本 |
| E08-F04 | 证据一致性检查 | 将 preflight hash 与待签发候选 manifest 比对 | Prompt/Tool/Kernel/Test fixture digest 无漂移 |
| E08-F05 | Go-to-device 决策 | 汇总 E01-E08 和遗留风险 | 40/40 才进入真机正式验收；否则保持 P9-E 开发状态 |

## 7. 实施顺序与出口条件

| 里程碑 | 范围 | 出口条件 |
|---|---|---|
| P9-E0 环境冻结 | E01 | API 35 主 AVD可重复启动；APK/Test APK 和报告身份固定 |
| P9-E1 基础链路 | E02、E03 | Hello、连续消息、错误正文和 OAEP UI 全绿 |
| P9-E2 Kernel 修复 | E04、E05 | Memory、Context、Workspace、Plan、Subagent 确定性回归全绿 |
| P9-E3 工具决策 | E06 | 30 类确定性任务三次重复 100%；HEPiX/不可用能力行为正确 |
| P9-E4 真实模型预跑 | E07 | Emulator 双模型 180 次达到正式统计阈值，且错误分类可信 |
| P9-E5 真机就绪 | E08 | 40/40 通过，形成唯一候选和真机命令清单 |
| P9-D 正式真机验收（延后） | 原 M04-F06/M09-F06/M12-F06 | ARM64 真机正式 180 次通过，全部报告绑定同一干净 APK，72/72 GO |

每轮执行继续汇报：

- 总轮次；
- P9 正式进度：当前固定从 69/72 起；
- P9-E 预验收进度：`已通过功能点/40`；
- 本轮新增通过、失败和阻塞；
- 下一轮目标。

## 8. 测试策略

### 8.1 测试层级

1. Python Kernel 单元、属性、状态机和 scorer 测试；
2. Kotlin JVM 的 Host Port、事件映射、错误分类和 Tool Registry 测试；
3. Android instrumentation 的 Binder、`:runtime`、Room/OAEP、恢复和真实生产入口测试；
4. Compose UI 的事件列表、错误卡片、Runtime identity 和终态测试；
5. API 26/30/35/36 Emulator 兼容矩阵；
6. 智增增双模型 Emulator preflight；
7. 延后的 ARM64 真机正式统计和 Go/No-Go。

### 8.2 失败分类

所有 observation 必须归入且只归入以下一类：

| 类别 | 示例 | 是否计 Provider 错误 |
|---|---|---|
| `model_behavior` | 未调用、错工具、错参数、无意义调用 | 否 |
| `provider_http` | 401、403、408、429、5xx、断流 | 是 |
| `runtime_policy` | Memory intent、Context budget、Subagent whitelist | 否 |
| `host_execution` | SAF、工具执行器、审批、Artifact 错误 | 否 |
| `oaep_projection` | 事件丢失、错误卡片缺失、非法终态 | 否 |
| `environment` | Emulator 离线、安装失败、ABI/版本错误 | 否，单独阻断运行 |

### 8.3 回归原则

1. 先使用单 case/单 attempt 快速定位，再运行 30 类确定性套件，最后才进行付费真实模型预跑；
2. 任一 Runtime 内部错误必须先修复，不能靠重复请求稀释错误率；
3. 任何 Prompt 或 Tool schema 改动必须重新运行全部 30 类任务；
4. 正常 Hello、无需工具问题必须与强制检索问题同时回归，避免“所有问题都调用工具”的反向回归；
5. 截图只作为 UI 辅证，OAEP Journal/Snapshot、JUnit 和原始 observation 才是机器证据。

## 9. 人工配置与自动化边界

### 9.1 P9-E 可自动完成

1. 创建、启动和关闭 API 26/30/35/36 AVD；
2. 构建并使用 `adb install -r -t` 安装 Debug/Test APK；
3. 运行 Hello、确定性工具、OAEP、恢复、UI 和矩阵测试；
4. 生成 Emulator preflight 报告和失败分类；
5. 建立独立干净 worktree 并预构建候选。

### 9.2 可能需要人工一次性配置

1. 若 Emulator 中没有智增增凭据，需要用户在 `OpenDrSai.Dev` 设置页录入 API Key；
2. 若 API 返回 401/403/402/429，需要用户确认 Key、账户状态、额度或服务商限流；
3. 最终候选提交前，需要确认 P9 代码的提交范围，不能夹带或覆盖当前 Desktop 未提交改动。

### 9.3 P9-E 不要求的人工配置

1. 确定性自然任务使用稳定 Host fixture，不要求 SAF 目录授权；
2. 正式 preflight instrumentation 不要求 OpenDrSai 业务登录；
3. 不要求物理 USB 设备、厂商调试选项或真机通知权限。

## 10. 证据与文件约定

P9-E 证据统一保存到：

```text
docs/android/reports/preflight/p9-emulator/
  manifest.json
  environment-api26.json
  environment-api30.json
  environment-api35.json
  environment-api36.json
  hello-and-lifecycle.json
  oaep-event-visibility.json
  deterministic-natural-tasks.json
  real-model-flash.json
  real-model-pro.json
  real-model-statistics.json
  screenshots/
  junit/
  logs/
  go-to-device-readiness.json
```

每份报告至少包含：

- `evidence_tier=emulator_preflight`；
- UTC 时间、Git commit、dirty 状态；
- APK/Test APK 名称和 SHA-256；
- applicationId、versionName、versionCode；
- AVD、API、ABI、脱敏设备 ID；
- Kernel、Prompt、Tool、Skill 和 Capability digest；
- provider/model/upstream ID，不包含 API Key；
- 测试数、失败数、原始 observation 和失败分类。

## 11. P9-E 硬门禁

出现以下任一情况，P9-E 不得进入真机正式验收：

1. Hello 无法完成、出现空正文或后续会话被永久 running/outbox 阻塞；
2. Android 实际进入 Kotlin Lite 或未加载共享 Kernel；
3. Runtime 错误仍被统一包装、错误正文为空或 UI 看不到失败原因；
4. 30 类确定性任务任一失败；
5. HEPiX/最新信息在 Web 可用时直接回答，或无 Web 时伪造来源；
6. `memory_explicit_intent_required`、`context_active_chain_budget_overflow` 或合法委派的 `subagent_tool_whitelist_denied` 仍可复现；
7. 双模型 Emulator 全量预跑未达到 M09 阈值；
8. preflight 丢弃失败请求、重写原始 observation 或污染正式 evidence；
9. 测试报告泄露 API Key、Authorization、Token、绝对私有路径或原始思维链；
10. 候选 APK、Test APK、Prompt、Tool 或 Kernel digest 在子报告间不一致；
11. JVM、Python、instrumentation 或 Compose 回归存在失败；
12. 当前 Desktop 用户改动被覆盖、混入或未经确认提交。

## 12. 交付物

1. 本 P9-E 开发与预验收方案；
2. Emulator preflight runner、scorer 和自动化测试；
3. Memory、Context、Subagent、Tool Policy 和错误分类修复；
4. OAEP 事件与错误正文的 Android UI 回归；
5. API 26/30/35/36 Emulator 报告；
6. 30 类确定性自然任务报告；
7. 智增增 Flash/Pro 双模型 Emulator 180 次预跑报告；
8. 干净候选 manifest、APK/Test APK hash 和真机命令清单；
9. `go-to-device-readiness.json`；
10. 延后真机门禁和遗留风险清单。

## 13. 完成定义

P9-E 只有同时满足以下条件才算完成：

1. 40/40 个 P9-E 预验收功能点通过；
2. Hello、连续消息、绑定、取消和恢复在 API 26/30/35/36 Emulator 全绿；
3. OAEP 关键事件、错误码和脱敏正文可在 Journal、Snapshot 和 UI 一致观察；
4. 30 类确定性自然任务三次重复 100% 通过；
5. Flash/Pro Emulator 180 次预跑达到 M09 正式阈值；
6. 没有已知 Runtime 内部错误被错误统计为 Provider 失败；
7. 全量 JVM、Python、instrumentation 和 Compose 回归全绿；
8. 已形成可复现的干净候选和真机执行清单；
9. P9 正式账本仍诚实保持 69/72，直到 ARM64 真机证据通过；
10. 真机恢复后无需再修改候选代码即可执行 M04-F06、M09-F06、M12-F06。

P9-E 完成不等于 P9 发布完成。只有后续 ARM64 真机正式 180 次统计通过、全部候选证据绑定同一干净 APK，并由 M12-F06 汇总为 72/72，才能宣布 Android P9 达到 Desktop Full Agent Runtime 的正式完成条件。
