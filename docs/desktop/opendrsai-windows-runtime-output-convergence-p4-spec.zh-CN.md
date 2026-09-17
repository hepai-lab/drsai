# OpenDrSai Windows Runtime 单次执行与权威输出收敛 P4 规格说明（SPEC）

状态：Draft  
版本：1.0  
日期：2026-08-21  
适用范围：Windows Desktop、共享 Renderer、Python Runtime、OAEP 事件桥接；涉及 TUI/WebUI 的内容仅限兼容性约束与回归验证

## 1. 文档目的

本规格定义 OpenDrSai Windows App 下一阶段的运行结果收敛工作。核心目标是建立并验证以下产品不变量：

> 一次用户提交只产生一个逻辑 Turn；一个 Turn 只提交一个权威回答；同一逻辑产物只展示一次。

本阶段以近期真实故障为主要输入：

- 一次“hepix2026 是什么”请求只创建了一个 Run，但首稿和引用修订稿被拼接为两段完整回答。
- 一次 Markdown 生成任务只执行了一个 Run，但显式交付副本和自动扫描发现的源文件分别注册，界面展示了两个内容相同的 Artifact。
- 工具执行前的模型说明、失败重试说明与最终答复混在同一个回答区，用户难以判断哪些内容是过程、哪些内容是最终结论。

本规格同时审计 Windows App 当前的功能完整性和易用性，明确本阶段应保留、移除、完善及暂不实施的能力。

## 2. 相关文档与关系

- `desktop-tui-agent-capability-adaptation-spec.zh-CN.md`：定义 Desktop/TUI 的共享能力与 surface 隔离原则。
- `opendrsai-windows-full-agent-runtime-phase3-product-completion-plan.md`：定义 Windows Runtime 产品闭环的上一阶段范围。
- `chat-streaming-rendering-smoothness-development-plan.md`：定义流式渲染的性能与视觉平滑策略。
- `grounded-answering-migration-to-shared.md`：定义检索、引用验证与共享 Kernel 的迁移边界。
- `windows-session-catalog-and-history-loading-performance-plan.zh-CN.md`：定义会话目录与历史加载性能治理。

本 P4 规格不替代上述文档，而是补齐其中缺失的“候选输出、最终提交、逻辑产物身份和 exactly-once 展示”语义。

## 3. 现状审计与结论

### 3.1 总体判断

Windows App 的总体架构方向合理：Desktop 通过 Runtime Session/Run 和 OAEP 事件消费共享 Agent Kernel，Runtime 负责 Workspace、审批、Artifact 和事件日志的权威状态，Renderer 负责展示。该架构应继续保留。

当前实现仍未达到完整产品闭环，主要缺口不是单个 UI 样式，而是运行输出的权威性没有贯穿 Model Attempt、Tool Loop、引用修订、Artifact 注册、事件重放和 Renderer 展示。界面能够流式显示内容，但无法可靠区分“候选内容”和“已接受的最终内容”。

### 3.2 已具备且应保留的能力

1. Runtime 的 Workspace、Session、Run、Event Journal 和终态管理。
2. OAEP 结构化事件作为 Desktop 运行过程与结果的主要传输语义。
3. 共享 Agent Kernel，以及 Desktop Host 对工具、审批和 Artifact 的受信任执行边界。
4. Artifact 显式交付能力、Workspace 路径校验、摘要记录和 Run 关联。
5. 检索结果的引用验证、来源保留和失败警告机制。
6. Desktop Renderer 已有的流式渲染与最终内容快速收敛能力。
7. TUI legacy 运行路径隔离。`kernel_surface == "tui"` 时不启用 Desktop shared Kernel，TUI 的 slash command 与独立 Artifact 适配不得被本阶段破坏。
8. 旧 WebUI 的独立 Agent/TeamManager 运行路径。本阶段不得用 Desktop 的实现细节反向约束旧 WebUI。

### 3.3 必须完善的问题

#### 3.3.1 回答缺少候选态与提交态

Runtime 当前可在模型完成前持续发送 `message.delta`。当模型完成后发现需要工具调用或引用修订时，已经显示的文本不能被可靠废弃；后续修订继续写入同一回答，形成两段完整回答。

#### 3.3.2 过程说明与最终回答混合

“我先检查环境”“我换一个路径重试”等文字可能只是模型在工具调用前的 preamble。它们对调试有价值，但不应默认成为最终回答正文。过程区、状态提示和最终答复必须有清晰边界。

#### 3.3.3 Artifact 仅按路径去重

Runtime 在 Run 结束后扫描 `artifacts/` 下的变化文件，并仅用 `relative_path` 排除已经注册的 Artifact。显式 `deliver_artifact` 可能把源文件复制为另一个展示路径；扫描随后将源路径再次注册，造成同内容双卡片。

#### 3.3.4 Exactly-once 只覆盖局部链路

审批和部分 IPC 已有幂等键，但用户提交、Run 建立、终态提交、Artifact 注册和事件重放之间缺少统一的 Turn 级幂等约束。网络重连、重复事件或 UI 重试仍可能生成重复展示。

#### 3.3.5 Renderer 仍承担过多运行语义

Renderer 应投影 Runtime 权威状态，不应自行推断哪段回答有效、哪个 Artifact 是重复项、Run 是否已完成。客户端启发式去重只能作为防御，不能成为正确性的来源。

#### 3.3.6 前端模块继续偏大

当前 `App.tsx` 约 382 KB、6675 行，`ChatWorkspace.tsx` 约 275 KB，`SettingsPanel.tsx` 约 235 KB，`WorkspaceShell.tsx` 约 178 KB。`App.tsx` 已低于 Babel 500 KB 警戒线，但核心页面仍混合状态协调、数据适配、业务规则和展示。后续功能继续堆叠会增加循环更新、重复订阅和回归风险。

### 3.4 应移除或停止依赖的行为

1. 移除“首稿已经写入最终回答，验证失败后再追加修订稿”的行为。
2. 移除工具 preamble 默认进入最终回答正文的行为。
3. 停止将 Artifact 路径作为唯一逻辑身份。
4. 移除同一 Run、同一内容、同一逻辑角色的重复 Artifact 卡片。
5. 移除失败的交付尝试在 UI 中形成可用 Artifact 的可能性。
6. Desktop 不再提示用户执行 TUI 专属 `/dangerous on`；Desktop 必须使用原生审批组件。
7. 停止由 Renderer 根据零散事件自行推断最终权威回答或 Run 终态。
8. 停止用模糊文本相似度在客户端全局去重；该方式会误删用户确实要求的两个文件或两段内容。

## 4. 目标与成功指标

### 4.1 功能目标

1. 一个用户提交在重复点击、IPC 重试和 Runtime 重连时至多建立一个逻辑 Turn。
2. 一个 Turn 可以有多个模型尝试，但最多提交一个最终回答。
3. 候选回答可流式预览，但能在工具调用或引用修订时被替换或废弃，不污染最终回答。
4. 一个逻辑 Artifact 默认只展示一张卡片；显式交付优先于自动发现。
5. 过程、审批、错误、回答和 Artifact 分区清晰，同时保留可展开的诊断信息。
6. Runtime 日志、恢复和重放得到与实时运行一致的最终结果。
7. 不改变 TUI legacy 和旧 WebUI 的现有命令、传输及展示行为。

### 4.2 量化指标

- 简单问答：每个提交恰好一个 Run、一个用户消息、一个已提交回答。
- 引用修订：最终回答中不得出现首稿与修订稿拼接。
- 单文件生成：同内容同角色仅一个 Artifact；重复卡片率为 0。
- 重连重放：同一事件重放任意次数，最终消息数和 Artifact 数不增加。
- Run 终态后 100 ms 内完成最终内容投影；不包含模型或网络耗时。
- 提交后 250 ms 内出现运行状态反馈；不要求此时已有模型文本。
- 100 KB 流式回答处理不得出现随累计文本长度增长的明显二次方耗时。

## 5. 范围与优先级

### 5.1 P4.0：正确性止血，必须完成

- Runtime 内部缓存候选文本，完成模型决策和引用验证后才提交最终回答。
- 工具调用 preamble 转为过程摘要，不进入最终回答。
- 引用重试显式废弃旧 attempt，修订稿覆盖而非追加。
- Artifact 以 Run、内容摘要和逻辑角色去重。
- 为上述问题增加 Python 单元测试和 Runtime 集成测试。

### 5.2 P4.1：事件语义与恢复，必须完成

- 建立 Turn、Attempt、Commit 的内部数据结构。
- 定义提交幂等键和事件幂等规则。
- 验证断线、恢复、取消、审批暂停后的 exactly-once 行为。
- Renderer 只消费 committed answer 作为最终回答。

### 5.3 P4.2：Desktop 交互完善，应完成

- 运行中可以显示紧凑的候选预览或过程摘要。
- 工具过程默认折叠，运行中自动展开必要状态，完成后自动折叠。
- Artifact 卡片只显示逻辑交付结果，并提供来源路径等可展开详情。
- 错误提示提供原生重试、审批或配置入口，不展示 TUI 命令。

### 5.4 P4.3：模块拆分，应完成但不得阻塞 P4.0

- 从 `ChatWorkspace.tsx` 抽取 Turn 投影、流式内容提交、Artifact 投影和滚动控制 hooks。
- 从 `SettingsPanel.tsx` 按设置域继续拆分页面容器和数据 controller。
- `App.tsx` 仅保留顶层路由、窗口级状态和跨页面协调。
- 每个拆分模块应有明确输入、输出和独立测试，不进行无行为收益的纯目录重排。

### 5.5 P4.4：观测与发布门禁，应完成

- 增加 `turn_id`、`attempt_id`、`commit_id`、Artifact 内容摘要的脱敏诊断字段。
- 增加重复提交、废弃 attempt、Artifact 合并和重放命中的指标。
- 将核心验收用例加入 Windows 开发启动和安装版发布门禁。

## 6. 核心业务不变量

1. **单提交**：相同 `submission_id` 在同一 Session 内只创建一个 Turn。
2. **单终态**：一个 Run 只能进入一次 `completed`、`failed` 或 `cancelled` 终态。
3. **单回答**：一个 Turn 最多存在一个 `committed` assistant answer。
4. **多尝试可追踪**：工具决策、工具后续、引用修订等 attempt 可存在，但只能是 `provisional`、`discarded` 或唯一的 `committed`。
5. **显式交付优先**：`deliver_artifact` 成功后，自动扫描不得再注册同一逻辑内容。
6. **失败不产出**：失败、拒绝或越界的交付调用不得创建 Artifact。
7. **权威在 Runtime**：Renderer 不决定最终文本、Artifact 身份或 Run 终态。
8. **重放幂等**：同一事件重复、乱序到达或断线重放后，投影结果不变。
9. **Surface 隔离**：Desktop/OAEP 的内部收敛不得改变 TUI legacy 或旧 WebUI 的行为。
10. **不暴露原始推理**：过程区只显示可公开的 reasoning summary、工具状态和诊断摘要，不显示隐藏 chain-of-thought。

## 7. 输入与输出

### 7.1 输入

- 用户文本、附件及客户端生成的 `submission_id`。
- 当前 Workspace、Session、Thread、Agent 和具体智能体模型策略。
- Runtime capability snapshot、可用工具和 Skills。
- 模型流式 delta、模型完成结果、工具调用和工具结果。
- 审批决定、取消请求、网络重连与事件重放游标。
- Workspace 基线文件快照和显式 Artifact 交付记录。

### 7.2 输出

- 一个权威 Turn 状态和唯一终态。
- 零或一个已提交 assistant answer；失败或取消时允许没有回答。
- 可折叠的过程摘要，包括工具阶段、审批和可公开诊断。
- 去重后的逻辑 Artifact 列表。
- 结构化错误、恢复动作和脱敏诊断引用。
- 可重放的 OAEP/Runtime 事件和确定性 UI 投影。

## 8. 功能行为和业务规则

### 8.1 用户提交与 Turn 建立

1. Renderer 每次发送生成 UUID `submission_id`，在自动重试时复用，不得重新生成。
2. Runtime 以 `(session_id, submission_id)` 建立唯一约束。
3. 重复提交返回原 Turn/Run 的当前快照，不能创建第二个用户消息或 Run。
4. 用户主动“重新生成”必须生成新的 `submission_id`，并通过 `parent_turn_id` 关联原 Turn。

### 8.2 模型 Attempt 生命周期

模型 Attempt 至少区分：

- `decision`：判断是否调用工具。
- `tool_followup`：消费工具结果后生成候选回答。
- `citation_revision`：引用或 claim support 验证失败后的修订。
- `finalization`：预算耗尽或工具关闭后的最终作答。

每个 Attempt 状态为：

- `provisional`：尚未通过工具决策和验证，可在过程区预览。
- `discarded`：被工具调用、引用修订、取消或错误取代。
- `committed`：唯一可以成为最终回答的 Attempt。

规则：

1. `MODEL_CHUNK` 先累计到当前 Attempt，不直接写入 canonical answer。
2. `MODEL_COMPLETED` 含工具调用时，当前文本标记为 `discarded`；非空 preamble 可压缩为过程摘要。
3. 引用验证失败时，当前 Attempt 标记为 `discarded`，创建新的 `citation_revision` Attempt。
4. 只有无待处理工具、通过验证且 Run 未取消时才能提交。
5. 提交必须原子地产生唯一 `message.completed` 和 Turn commit 记录。

### 8.3 流式展示

P4.0 默认采用服务端候选缓存，以最小协议变更先保证正确性。UI 立即展示状态和过程，但只有接受后的内容进入最终回答。

P4.2 可增加版本化的 provisional preview：

- preview 只能显示在当前运行卡片中。
- preview 可被清空、替换或折叠，不能被复制、分享或保存为最终消息。
- committed 内容到达时立即替换 preview，不按阅读节奏延迟播放。
- 旧客户端不识别 preview 事件时仍能仅依靠最终事件正确工作。

### 8.4 过程与回答分区

- 状态、工具、审批、重试和引用验证进入“过程”。
- 最终自然语言结论进入“回答”。
- 工具 preamble 不重复显示；合并为一条可展开的阶段摘要。
- 运行中显示必要进度，完成后过程默认自动折叠；失败和待审批时保持相关区块展开。
- 技术细节保留在 Run Inspector，不在主聊天卡片重复输出。

### 8.5 Artifact 发现、交付与去重

1. 显式 `deliver_artifact` 成功时记录源路径、交付路径、SHA-256、大小、逻辑角色和 association ID。
2. Run 结束自动扫描只补齐未被显式交付关联的新增或变化文件。
3. 默认逻辑身份：`(run_id, sha256, logical_role)`。
4. 同一 SHA、同一角色存在显式交付和自动发现时，保留显式交付，跳过自动发现。
5. 同一内容确需作为两个独立交付物时，调用方必须提供不同 `logical_role` 或显式 `allow_duplicate_content=true`；默认禁止。
6. 同一路径内容发生变化时视为新版本，而不是因路径相同被忽略。
7. 第一次绝对路径交付失败、第二次相对路径成功时，只能生成一个 Artifact。
8. 历史重复 Artifact 不在本阶段自动删除；仅保证新 Run 正确，并提供只读诊断/后续迁移工具接口。

### 8.6 终态、取消与恢复

- `completed`、`failed`、`cancelled` 互斥且只能提交一次。
- 取消发生在候选输出期间时，候选内容不得变成最终回答。
- 审批暂停不结束 Turn；恢复后继续原 Run 和原 Attempt 链。
- SSE 断线后按事件序号恢复；已应用事件不得重复创建消息或 Artifact。
- Runtime 重启后从 checkpoint 恢复 Attempt 状态；无法证明副作用结果时 fail closed。

## 9. 接口与数据结构

以下结构为领域合同。P4.0 可先作为 Runtime 内部结构实现；若提升为 OAEP 公共事件，必须版本化并同步 Android/Desktop validator。

### 9.1 `TurnSubmissionV1`

```json
{
  "submission_id": "uuid",
  "session_id": "session-id",
  "thread_id": "thread-id",
  "parent_turn_id": null,
  "message": "用户输入",
  "attachment_ids": [],
  "agent_id": "agent-id",
  "capability_snapshot_sha256": "sha256"
}
```

### 9.2 `ModelAttemptOutputV1`

```json
{
  "attempt_id": "attempt-id",
  "run_id": "run-id",
  "turn_id": "turn-id",
  "phase": "citation_revision",
  "visibility": "provisional",
  "sequence": 2,
  "text_sha256": "sha256",
  "supersedes_attempt_id": "attempt-1",
  "discard_reason": null
}
```

约束：一个 `turn_id` 最多一个 `visibility=committed`；`sequence` 单调递增；discard 后不能恢复为 committed。

### 9.3 `TurnCommitV1`

```json
{
  "commit_id": "commit-id",
  "turn_id": "turn-id",
  "run_id": "run-id",
  "committed_attempt_id": "attempt-id",
  "answer_item_id": "message-item-id",
  "artifact_ids": ["artifact-id"],
  "status": "completed",
  "commit_sha256": "sha256"
}
```

### 9.4 `RuntimeArtifactIdentityV1`

```json
{
  "artifact_id": "artifact-id",
  "run_id": "run-id",
  "source_path": "artifacts/hepix2026/source.md",
  "delivered_path": "artifacts/HEPiX 2026 信息汇总.md",
  "sha256": "sha256",
  "logical_role": "primary_document",
  "registration_source": "explicit",
  "association_id": "delivery-call-id",
  "supersedes_artifact_id": null
}
```

### 9.5 事件兼容策略

- P4.0 保留现有 `message.completed`、`artifact.created` 和 `agent.completed` 终态事件，减少客户端破坏。
- 新增字段必须是 additive，旧客户端忽略后仍得到一个正确最终回答。
- 如增加 `message.preview.delta`、`attempt.discarded`、`turn.committed`，须提升 capability contract/OAEP minor version。
- Renderer 不得把 preview 事件持久化为普通 assistant message。

## 10. 模块变更范围

| 模块 | 变更目标 | 禁止事项 |
| --- | --- | --- |
| `runtime/mobile_core/engine.py` | Attempt 生命周期、候选缓存、引用修订替换、唯一提交 | 不修改通用模型 SDK；不改变 TUI legacy executor |
| `runtime/desktop_kernel_coordinator.py` | 传递 attempt 元数据、协调候选/完成事件 | 不让 coordinator 成为业务权威 |
| `backend/gateway.py` | Turn 提交幂等、Artifact 显式交付关联与摘要去重 | 不用客户端文本相似度补救 |
| `runtime/artifacts.py` | 扩展逻辑身份、幂等约束和版本关系 | 不自动删除旧 Artifact |
| OAEP adapter/validator | additive 事件与兼容校验 | 不在未版本化时更改既有字段语义 |
| `useDesktopChatAdapter.ts` | 按事件 ID/commit 投影，处理 preview 替换 | 不自行判断引用是否有效 |
| `ChatWorkspace.tsx` | 过程/回答/Artifact 分区和紧凑展示 | 不保存 Runtime 候选为最终消息 |
| `App.tsx` / `SettingsPanel.tsx` | 拆分控制器与页面组件 | 不借机重做全部导航和设置产品结构 |

## 11. 边界条件与异常处理

### 11.1 模型与网络

- 首个 delta 后 provider 断开：Turn 失败或按策略重试，旧 candidate 被废弃，不显示为完整答案。
- provider 返回空完成：返回结构化 `model_empty_response`，不得提交空回答。
- citation revision 仍失败：只提交一次带验证警告的最终答案，不附加首稿。
- 模型重复发送相同 chunk：按 attempt sequence/event ID 幂等消费。

### 11.2 工具与审批

- 模型在 preamble 后发出工具调用：preamble 进入过程摘要，最终回答为空待后续 attempt。
- 审批拒绝：工具不执行；模型可基于拒绝结果给出一个最终答复。
- 审批超时或 app 重启：恢复原 approval ID，不生成第二次审批和第二个 Turn。
- 已批准副作用结果未知：不得自动重放，返回可诊断错误。

### 11.3 Artifact

- 相同内容、不同文件名：默认按同一逻辑角色合并；显式不同角色时允许并存。
- 同路径、内容变化：生成新版本并关联 `supersedes_artifact_id`。
- 零字节文件：不自动交付；显式交付时返回明确错误。
- 单 Run 超过 32 个候选文件：维持安全上限并返回结构化错误，不部分猜测交付。
- Workspace 外路径、目录穿越、符号链接逃逸：拒绝且不创建 Artifact。
- 文件在扫描中被删除或修改：跳过并记录诊断，不崩溃、不产生悬空卡片。

### 11.4 重连与并发

- Renderer 收到乱序 `message.completed` 和 preview：commit 优先，之后到达的 preview 丢弃。
- 两个窗口重复提交同一 `submission_id`：只返回同一 Turn。
- 用户明确并发发送两条消息：不同 `submission_id`，各自创建 Turn；Session 串行/并行策略按 Agent policy 执行。
- 用户点击停止后迟到的完成事件：若 cancel 已成为权威终态，则完成事件只记诊断，不改变 UI。

## 12. 非功能要求

### 12.1 性能

- chunk 累计使用分段缓冲或线性追加，禁止每个 token 重建完整大字符串。
- candidate 内存默认上限 2 MiB；超过后落盘到 Runtime 临时区或停止 preview，但不得截断最终 provider 结果。
- Artifact SHA-256 使用流式读取；对相同文件签名复用摘要，避免结束阶段重复全量哈希。
- Artifact 自动扫描继续限制在变更文件和最多 32 个候选，不扫描整个 Workspace 内容。
- Renderer 每帧最多提交一次可见文本更新，committed 内容不经过人为阅读节奏延迟。

### 12.2 可靠性

- Turn commit 和 Artifact 关联应在同一事务或可恢复的两阶段记录中完成。
- 所有终态和 Artifact 注册接口必须幂等。
- Runtime checkpoint 必须包含当前 attempt ID、状态、序号和 citation retry count。
- 事件日志可以重建与实时运行一致的最终投影。

### 12.3 安全与隐私

- 日志不得记录 access token、API Key、Authorization header、原始隐藏推理或未经脱敏的工具参数。
- UI 不展示本机绝对路径；仅显示 Workspace 相对路径或友好文件名。
- provisional 内容不得作为可分享、可朗读、可复制的正式回答持久化。
- Artifact 路径必须在受信任 Host 二次解析，Renderer 传入的摘要和路径声明不可直接信任。
- Desktop 审批只能通过原生审批合同完成，不能把 TUI 命令作为授权替代。

### 12.4 可维护性

- Runtime 正确性测试不得依赖 Renderer。
- Renderer projection 测试使用确定性事件 fixture。
- 新模块建议控制在 1000 行以内；超过时须在代码评审中说明领域边界和不可拆原因。
- 不以文件行数作为唯一验收指标，以依赖方向、职责和可独立测试为主。

### 12.5 可访问性与本地化

- 过程折叠、审批、错误和 Artifact 状态必须支持键盘与屏幕阅读器。
- 状态不可只依赖颜色表达。
- 用户文案本地化；错误 code 保持稳定英文标识，界面显示可翻译消息。

## 13. 数据迁移与兼容性

1. 新 Run 使用 Turn/Attempt/Commit 语义；旧 Run 继续按现有记录只读展示。
2. 不自动删除历史重复 Artifact，避免误删用户文件；可在诊断中标记 `possible_duplicate`。
3. Artifact 表新增字段须允许 null，以兼容旧记录，并通过后台惰性补全摘要。
4. P4.0 优先保持现有 OAEP 终态事件兼容；preview 协议仅在 capability 协商成功后启用。
5. TUI 继续使用 `kernel_surface="tui"` 的 legacy 路径和自身 Artifact adapter。
6. 旧 WebUI 不接入本阶段事件；只执行回归冒烟测试，确认共享底层改动未改变其行为。
7. Android 等共享 Runtime 客户端在不识别新增事件时仍必须收到兼容的单个最终回答。

## 14. 测试方案

### 14.1 Python 单元测试

- `test_mobile_agent_core.py`
  - 工具 preamble 后 tool call：preamble 不进入 committed answer。
  - citation retry：首稿 discarded，修订稿唯一 committed。
  - retry 仍失败：唯一 warning answer。
  - cancel：candidate 不提交。
  - 模型空完成和重复完成事件。
- `test_runtime_artifacts.py`
  - 显式交付与自动扫描同 SHA 去重。
  - 同路径新内容形成版本。
  - 同内容不同 logical role 显式允许并存。
  - 失败交付不注册。
- `test_runtime_engine.py` / Gateway 测试
  - 重复 `submission_id` 返回同一 Turn。
  - 终态、commit 和事件重放幂等。

### 14.2 OAEP 与跨 Runtime 测试

- `test_mobile_runtime_protocol.py`：additive schema 与旧客户端兼容。
- `test_mobile_cross_runtime_parity.py`：Windows/Android 对 committed answer 一致。
- `test_oaep_runtime_four_path.py`：聊天、工具、审批、Artifact 四路径均维持单终态。
- `test_android_windows_runtime_e2e.py`：未知 preview 事件不破坏 Android 最终结果。

### 14.3 Renderer 测试

- 重复事件、乱序事件、断线重放不增加消息或 Artifact。
- preview 被 committed 内容替换，不发生追加。
- 运行中过程可见，完成后自动折叠；失败/审批保持展开。
- 一份 MD 文件只显示一张 Artifact 卡片。
- 最终回答复制、朗读、重新生成只针对 committed 内容。

### 14.4 Surface 回归测试

- TUI：slash command、`/dangerous` 现有行为、legacy AgentSession 和 Artifact adapter 不变。
- 旧 WebUI：普通问答、工具调用和文件生成冒烟通过。
- Windows 源码开发模式与安装版：同一验收场景结果一致。

## 15. 验收标准与测试案例

| ID | 场景 | 操作 | 预期结果 |
| --- | --- | --- | --- |
| P4-AC-01 | 简单问答 | 发送 `hello` | 一个 submission、一个 Run、一个用户消息、一个 committed 回答 |
| P4-AC-02 | 引用修订 | 询问 `hepix2026 是什么` 并触发检索/引用校验 | 只显示修订后的完整答案；首稿不拼接、不进入复制内容 |
| P4-AC-03 | 工具 preamble | 要求生成文件，模型先说明再调用工具 | 说明进入过程摘要；最终回答只保留交付结论 |
| P4-AC-04 | 单文件交付 | 写入源 MD，再显式交付为友好文件名 | 仅一张 Artifact 卡片，指向显式交付结果 |
| P4-AC-05 | 交付重试 | 先用绝对路径失败，再用相对路径成功 | 失败尝试零 Artifact，最终恰好一个 Artifact |
| P4-AC-06 | 重复提交 | 对同一 `submission_id` 发两次 IPC 请求 | 返回同一 Turn/Run，不增加左侧会话或消息 |
| P4-AC-07 | 断线恢复 | 首个 delta 后断开并恢复 SSE | 最终内容无重复，过程和 Artifact 无重复 |
| P4-AC-08 | 取消 | 候选输出期间点击停止 | Run 唯一终态为 cancelled，不提交候选回答 |
| P4-AC-09 | 审批恢复 | 文件写入等待审批，重启 Renderer 后批准 | 使用原 approval/Run，只执行一次，只生成一个文件 |
| P4-AC-10 | 乱序事件 | committed 后注入迟到 preview | UI 保持 committed 内容不变 |
| P4-AC-11 | 大回答 | 输出 100 KB 文本 | 内存与渲染线性增长，完成后立即显示最终全文，无逐字补播 |
| P4-AC-12 | TUI 回归 | 在 TUI 执行问答、文件和 `/dangerous` 流程 | 行为与本阶段前一致，无 Desktop 审批文案渗透 |
| P4-AC-13 | WebUI 回归 | 旧 WebUI 执行问答和文件冒烟 | 独立运行路径正常，无事件协议回归 |
| P4-AC-14 | 安全 | 使用 Workspace 外路径和符号链接逃逸 | 请求被拒绝，无 Artifact、无绝对路径泄露 |

全部 P4-AC-01 至 P4-AC-10、P4-AC-12、P4-AC-14 为发布阻断项；性能和旧 WebUI 冒烟失败同样阻止安装版发布。

## 16. 实施顺序

1. 先用现有事件格式在 Runtime 内实现 candidate 缓冲、discard 和单次 commit，修复双回答。
2. 扩展 Artifact 交付关联和 SHA/角色去重，修复双卡片。
3. 建立提交、终态和重放幂等测试，确保恢复路径一致。
4. 更新 Renderer 投影与过程/回答分区；保留对旧 Runtime 的兼容降级。
5. 仅在需要实时候选预览时增加版本化 OAEP preview 事件。
6. 拆分 `ChatWorkspace`、`App` 和设置控制器，并运行视觉、键盘与安装版回归。
7. 加入发布门禁和脱敏指标，完成灰度验证后默认启用。

## 17. 发布与回滚

- P4.0 通过 Runtime 内部 feature flag 灰度，但生产默认不得长期保留两套回答权威逻辑。
- 新旧客户端协议协商失败时关闭 preview，仅发送 committed answer。
- Artifact 新去重逻辑仅影响新 Run；回滚不修改或删除既有文件。
- 若发生结果丢失风险，应回滚 preview 展示而非回滚单次 commit 和 Artifact 幂等约束。
- 发布观察指标：每 Turn committed answer 数、discarded attempt 数、重复 submission 命中数、Artifact 合并数、终态冲突数。

## 18. 明确不做什么

本阶段不实施：

1. 不把 TUI 迁移到 Desktop shared Kernel，也不移除 TUI 的 `/dangerous` 等命令。
2. 不重写旧 WebUI，不要求其消费 Desktop 的 preview 事件。
3. 不更换模型提供方、搜索供应商或搜索排序算法。
4. 不重新设计全部设置、导航、智能体广场和 Workspace 产品结构。
5. 不新增云端 Artifact 存储、跨设备同步或历史文件自动清理。
6. 不展示模型隐藏 chain-of-thought；只展示可公开的过程摘要。
7. 不使用语义相似度或模型判断对历史回答和文件做全局去重。
8. 不在通用 `LLMClient` 或所有 surface 的 `DrSaiAssistant.run_stream` 中做未经隔离的全局改动。
9. 不把前端文件拆分数量或行数作为独立产品目标。
10. 不自动删除当前数据库中的旧重复记录；测试环境若需要清理，应使用显式一次性维护操作。

## 19. 完成定义（Definition of Done）

P4 只有在以下条件全部满足时完成：

- 核心业务不变量由 Runtime 自动测试证明，而非仅依赖 UI 观察。
- “HEPiX 引用修订”和“Markdown 显式交付”两个真实复现用例通过。
- Windows 开发模式和安装版均通过验收矩阵。
- TUI legacy、旧 WebUI 和 Android 兼容测试通过。
- 事件与数据库迁移有回滚策略，安全审计无 token、绝对路径或隐藏推理泄露。
- Renderer 只展示一个权威回答和一个逻辑 Artifact，过程信息可查看但不干扰最终结果。
- 相关模块职责、接口和测试已同步更新到开发文档。
