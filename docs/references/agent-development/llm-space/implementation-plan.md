# OpenDrSai 集成实施方案

> 本文件记录从 LLM Space 源码研究得到的整体集成路线。第一阶段的正式开发范围、模块、逐项测试和发布验收见
> [Agent 运行时可追溯、可复现第一阶段开发方案](../../../desktop/agent-runtime-traceability-reproducibility-phase1-development-plan.md)。

## 1. 范围与目标

本方案同时覆盖三个目标：

1. **运行轨迹与 Tool Call 检查器**：完整查看成功、失败、取消和等待审批的运行。
2. **不可变分支重放**：从安全检查点创建新 Run，保留父运行和配置差异，不覆盖历史。
3. **运行 A/B 评测**：人工 rubric 与自动指标共存，并可逐步接入 `eval/` 批量回归。

Tool Call 专用调试器属于第一个目标；安全模拟和重新执行属于第二个目标。

不引入 LLM Space 的 Pi Agent Core、Thread JSON 或 Electrobun，不 fork 其应用。OpenDrSai 的 RuntimeEngine、ConversationJournal、OAEP、OWOP、Desktop 和 `eval/` 继续作为权威实现。

## 2. 现有基础与差距

### 已有基础

| OpenDrSai 能力 | 现有位置 | 可复用价值 |
| --- | --- | --- |
| Session、Run、Event SQLite 模型 | `backend/runtime/engine.py` | Run 和事件权威存储 |
| Append-only runtime events | `runtime_events` update/delete trigger | 保证历史证据不可变 |
| Session journal 与 OAEP event stream | `backend/runtime/journal.py`、`backend/runtime/oaep.py` | 跨端读取和断线续传 |
| `parent_run_id` | RuntimeEngine 与 OAEP Run | 已有运行关系指针 |
| 加密 runtime checkpoint | `runtime_checkpoints` | 分支恢复的状态基础 |
| 审批与等待状态 | `runtime_approvals`、OAEP interaction | 重放安全门禁 |
| Tool/command/file/artifact/subtask Item | OAEP schema | 统一轨迹表达 |
| OAEP → StructuredConversation | Desktop projector | UI 复用链路 |
| 诊断 incident 投影 | Desktop diagnostic projector | 失败定位基础 |
| benchmark runner/evaluator | `eval/` 和 WebUI eval | 自动评测基础 |

### 关键差距

- `RuntimeRunCreateRequest` 只接受 `agent_definition`，无法表达实验 fork。
- Desktop RuntimeClient 没有类型化的 session run list 和 run inspection 聚合接口。
- `parent_run_id` 已用于子 Agent；缺少 `relation_type` 会把 subagent 和 experiment fork 混为一谈。
- Checkpoint 只有 state 与 event sequence，缺少创建原因、兼容性、配置快照和安全恢复声明。
- Run 没有不可变的 Prompt、模型、Skill、工具和环境配置快照。
- OAEP ToolCall 虽有 arguments/result/duration/status，但没有通用副作用与重放策略。
- 现有 `eval/` 面向 benchmark 文件结果，尚未统一到 Runtime Run ID。
- 没有 runtime-owned rubric、evaluation 和 comparison 持久化模型。

## 3. 总体架构

```text
RuntimeEngine / ConversationJournal（权威写模型）
  ├── Run + relation + config snapshot
  ├── append-only Runtime Events
  ├── OAEP Items / Events
  ├── Checkpoints + replay safety metadata
  └── Evaluations + Rubric snapshots
                 │
                 ▼
Run Inspection Projection（只读聚合）
  ├── timeline
  ├── tool-call details
  ├── diagnostics
  ├── usage / latency / artifacts
  └── fork eligibility
                 │
          Runtime HTTP / OAEP
                 │
                 ▼
Desktop Workbench
  ├── Run Inspector
  ├── Tool Call Inspector
  ├── Fork Run Dialog
  └── A/B Evaluation View
                 │
                 ▼
eval/ Adapter（后续阶段）
  └── dataset、automatic evaluator、regression gate
```

原则：事实只写入 Runtime；Desktop 保存界面偏好，不保存权威运行和评分记录。

## 4. 数据模型

### 4.1 Run 关系

不要单独依靠 `parent_run_id` 判断关系。为 `runtime_runs` 增加：

```text
relation_type       root | subagent | fork | retry
config_snapshot_id  nullable FK
fork_event_sequence nullable integer
fork_item_id        nullable text
fork_checkpoint_id  nullable text
fork_changes_json   redacted JSON Patch / typed overrides
```

规则：

- `root` 不设置 parent。
- `subagent` 保留当前父子 Agent 语义。
- `fork` 必须设置 parent、fork point 和 config snapshot。
- `retry` 表示相同意图的基础设施重试，不与实验变体混淆。
- 任意 fork 都创建新 Run；父 Run 和原始事件永不修改。

OAEP Run 可增加可选的 `relation_type` 与 `fork` provenance。若暂不升级 OAEP 版本，第一阶段可以在 run inspection API 返回扩展字段，待协议设计稳定后再进入 OAEP schema。

### 4.2 配置快照

新增内容寻址的 `runtime_config_snapshots`：

```text
snapshot_id
schema_version
sha256
agent_definition
backend_id
model_config_json
prompt_manifest_json
skill_manifest_json
tool_manifest_json
runtime_manifest_json
created_at
```

要求：

- 不保存 API Key、Bearer Token 或秘密环境变量。
- Prompt/Skill 可保存内容哈希和受权限控制的内容副本。
- Tool manifest 保存 schema、版本、server、执行策略和 digest。
- 每个 Run 在执行前固定 snapshot，不能在运行中悄悄改变。
- fork 先复制父 snapshot，再应用有审计记录的 typed overrides。

### 4.3 Checkpoint 与重放资格

扩展 checkpoint metadata：

```text
reason               before_model | before_tool | after_tool | before_approval | manual | terminal
config_snapshot_id
state_schema_version
adapter_id / adapter_version
replay_capability    inspect_only | simulate | safe_execute
created_by
```

检查点状态继续加密保存。API 默认只返回 metadata，不直接返回解密 state。

### 4.4 Tool 执行策略

为 Tool manifest 定义：

```text
effect_class   read_only | idempotent | side_effecting | irreversible | unknown
replay_policy  automatic | approval_required | simulate_only | forbidden
receipt_query  optional provider-specific capability
```

默认策略：未知即 `unknown + forbidden`。现有 MCP at-most-once 保护保持不变；无法查询 receipt 的通用 MCP Tool Call 不自动重放。

### 4.5 Evaluation

建议新增：

- `evaluation_rubrics`
- `evaluation_rubric_revisions`
- `run_evaluations`
- `run_evaluation_scores`
- `run_comparisons`

关键字段：

```text
rubric_id / revision / immutable rubric snapshot
subject_run_id
baseline_run_id optional
criterion_id
score
weight
evaluator_type  human | deterministic | llm_judge | benchmark
evaluator_id / evaluator_version
evidence_refs
verdict / note
created_by / created_at
```

LLM Space 的 1–5 人工评分可作为一种 evaluator，不限制自动指标的数值域。Evaluation 必须关联稳定 Run ID 和证据引用。

## 5. API 设计

### 5.1 运行列表与检查

复用现有：

```http
GET /v1/sessions/{session_id}/runs
GET /v1/runs/{run_id}
GET /v1/runs/{run_id}/events
GET /v1/runs/{run_id}/diagnostics
GET /v1/sessions/{session_id}/oaep-snapshot
```

新增聚合接口：

```http
GET /v1/runs/{run_id}/inspection
```

响应包含：Run、关系、配置摘要、OAEP Items、审批摘要、checkpoint metadata、artifacts、diagnostics、usage 和 fork eligibility。服务端负责权限检查与脱敏，Desktop 不自行拼接敏感数据。

### 5.2 创建分支

```http
POST /v1/runs/{run_id}/forks
Idempotency-Key: ...

{
  "fork_point": {
    "event_sequence": 42,
    "item_id": "item-...",
    "checkpoint_id": "checkpoint-..."
  },
  "overrides": {
    "model": {},
    "prompt": {},
    "skills": [],
    "tools": [],
    "tool_results": []
  },
  "mode": "inspect_only"
}
```

默认 `inspect_only`：只创建并验证分支，不执行模型或工具。单独的 execute 操作必须再次通过执行策略和审批。

### 5.3 评测

```http
GET/POST /v1/evaluation-rubrics
GET/POST /v1/runs/{run_id}/evaluations
POST     /v1/run-comparisons
GET      /v1/run-comparisons/{comparison_id}
```

写入操作使用幂等键或 optimistic revision，rubric 更新创建新 revision，不覆盖历史 evaluation snapshot。

## 6. Desktop 设计

### 6.1 Run History / Inspector

在当前会话界面增加运行历史入口，包含全部状态而不只是成功运行：

- 状态、模型、时间、耗时、Token/成本、工具数、错误数。
- Run 关系标识：root、subagent、fork、retry。
- 按 OAEP sequence 展示事件时间线。
- 展开 System Prompt/配置摘要时进行敏感字段脱敏。
- 错误事件关联现有 Diagnostic Incident 的前后文。

建议新增组件：

```text
RunHistoryPanel
RunInspector
RunTimeline
RunSummaryCard
RunRelationTree
```

### 6.2 Tool Call Inspector

在现有 `StructuredMessageParts` 的 tool activity 上增加详情抽屉：

- Tool 名称、kind、server、schema version。
- Arguments/result 的 JSON tree、复制和 diff。
- status、duration、error、approval 和 resource refs。
- effect class 与 replay policy。
- `Create simulated fork` 始终可用。
- `Re-execute in fork` 只在策略明确允许时出现。

不要允许直接编辑或覆盖原始 OAEP Item。

### 6.3 Fork Dialog

分三步：选择分叉点 → 审查配置差异 → 审查执行风险。创建后先展示新 Run，不自动执行。

### 6.4 A/B Evaluation

并排展示两个 Run：

- 最终答案和关键产物。
- 配置差异。
- Tool Call 序列差异。
- 自动指标。
- 人工 rubric。
- 评分证据跳转到具体 OAEP item/event。

## 7. 分阶段实施

### Phase 0：契约与迁移设计

交付：

- Run relation、config snapshot、fork provenance、evaluation schema ADR。
- SQLite migration 和 downgrade/compatibility 策略。
- OAEP 是否扩展的版本决策。
- Tool replay policy 威胁模型。

完成门禁：旧数据库和旧客户端仍能读取；任何 schema 变更都有迁移测试和生成类型同步测试。

### Phase 1：只读运行检查器

后端：

- 类型化 `listSessionRuns`。
- `GET /v1/runs/{run_id}/inspection`。
- usage、diagnostics、approval、artifact 的脱敏聚合。

桌面端：

- Run History、Run Inspector、OAEP timeline。
- Tool Call 参数/结果检查器。
- 成功、失败、取消、等待审批全部可见。

本阶段不修改、不重放任何历史数据。

### Phase 2：A/B 与人工 rubric

- 建立 runtime-owned rubric/evaluation 表和 API。
- 完成 Run selector、并排 diff、rubric revision 与证据引用。
- 首批自动指标：完成状态、耗时、模型 usage、Tool Call 数、工具错误数、审批数、artifact 数。
- 允许从桌面端保存人工 verdict 和 note。

### Phase 3：不可变模拟分支

- 增加 relation_type、config snapshot 和 fork API。
- 从 checkpoint 创建 `inspect_only` 新 Run。
- 支持模型、Prompt、Skill、Tool Result override。
- 只生成分支计划与差异，不调用模型、不执行工具。

### Phase 4：安全执行分支

- 增加 tool effect/replay policy。
- 先开放“替换模型或 Prompt 后继续模型推理”，不重放历史副作用工具。
- Tool Result 模拟进入新分支，标记为 synthetic evidence。
- 只有 read-only 或有 provider receipt/idempotency 支持的工具才允许重新执行。
- side-effecting、irreversible 和 unknown 必须审批或禁止。

### Phase 5：接入 `eval/` 与回归门禁

- 定义 Runtime Run ↔ benchmark task/candidate adapter。
- 将人工 rubric、确定性 evaluator、LLM judge 和 benchmark score 统一到 evaluation evidence。
- 支持基线 Run 与候选 Run 的数据集级比较。
- 建立发布前回归阈值和统计摘要。

## 8. 测试与安全门禁

### 后端

- append-only event 不能被 fork 或 restore 修改。
- 并发 fork 的 Idempotency-Key 行为稳定。
- parent、relation_type、fork point 与 checkpoint 必须属于一致 Session。
- 配置快照不包含 secret。
- checkpoint 解密 state 不通过普通 inspection API 暴露。
- evaluation 引用不存在的 Run、criterion 或 rubric revision 时拒绝写入。

### 协议

- OAEP schema、Python generated types、Desktop generated types 一致。
- 未知扩展字段对旧客户端保持兼容。
- sequence、dedupe key 与断线重放不产生重复 UI item。

### Desktop

- 大型 arguments/result 使用虚拟化、折叠和大小上限。
- 失败 Run 和取消 Run 能完整投影。
- 原始 evidence 全部只读。
- 分支创建与执行是两个独立确认动作。
- A/B 反转时 directional verdict 和 delta 正确翻转。

### 工具安全

- 通用 MCP Tool Call 默认不自动重放。
- 模拟结果明确标注 synthetic，不能伪装成真实工具输出。
- 文件、Git、消息、付费 API 和远程作业均按副作用策略处理。
- 每次重放决策写入 audit 和 OAEP interaction/notice evidence。

## 9. 建议的首个开发切片

第一批只实现 Phase 1 的纵向闭环：

1. 为 Desktop RuntimeClient 增加类型化 `listSessionRuns()`。
2. 后端实现脱敏的 run inspection projection。
3. 桌面会话增加 Run History 入口。
4. 选中 Run 后展示 OAEP timeline。
5. ToolCall 展开显示 arguments、result、duration、status 和关联 approval。
6. 使用成功、失败、取消、等待审批四类 fixture 做端到端验收。

这个切片不需要修改 Agent loop，不产生新的外部副作用，却能建立后续分支和评测共同依赖的 UI、API 与证据模型。

## 10. 代码落点建议

| 工作 | 建议位置 |
| --- | --- |
| Runtime 数据表、migration、inspection projection | `cores/python/packages/drsai/src/drsai/backend/runtime/` |
| HTTP API | `cores/python/packages/drsai/src/drsai/backend/gateway.py` |
| OAEP contract | `cores/protocol/oaep/` |
| Python/TS 类型生成 | 现有 OAEP codegen 脚本与 generated files |
| Desktop Runtime API | `apps/desktop/shared/main/runtimeClient.ts` |
| OAEP 展示投影 | `apps/desktop/shared/main/oaepPresentationProjector.ts`、`threadRuntimeProjection.ts` |
| Inspector、Tool Drawer、Comparison UI | `apps/desktop/shared/renderer/src/components/` |
| 自动 evaluator adapter | `apps/webui/backend/src/drsai_ui/ui_backend/eval/` 与 `eval/` |
| 协议、runtime、desktop、eval 测试 | 各模块现有 tests 与 shared test-kit |

## 11. 最终决策

- **集成其能力目标，不集成其 runtime。**
- **复制交互意图，不复制可变 Thread 的重放语义。**
- **以 OAEP/journal 为运行事实，以新 Run 表达任何分支。**
- **先只读检查，再人工评测，再模拟分支，最后开放受策略约束的执行重放。**
