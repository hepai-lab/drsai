# OpenDrSai Agent 运行时可追溯、可复现第四阶段开发方案

状态：实施中  
适用范围：Windows Desktop、OpenDrSai Runtime、OAEP 运行投影、`eval/regression` 证据  
上游参考：LLM Space `v4.6.3`（仅借鉴交互和数据语义，不形成运行时依赖）

## 1. 阶段判断与代码审计结论

P1～P3 已经形成三条主体链路：

1. OAEP/journal 驱动的只读 Run History、Run Inspector 与 Tool Call 检查；
2. 版本化实验草稿、Replay Plan、安全审批、隔离执行和选择性采纳；
3. 基线 Run 与候选 Run 的不可变比较，以及 `eval/regression` 的发布回归数据。

现有实现的总体方向合理：它没有嵌入或 fork LLM Space，也没有引入第二套 Agent Runtime；原始 Run 不可变，重放创建新 Run，工具副作用仍受策略和审批约束。这些边界必须保留。

代码审计同时确认四个产品缺口：

- **A/B 只有 Comparison，没有 Evaluation**：用户能看差异、采纳文件，却不能保存“为什么候选更好”的人工评分、结论和证据引用；LLM Space 三项高价值能力中的评测闭环尚未完成。
- **关系标签不诚实**：`SessionRunHistory` 仅凭 `parent_run_id` 把子 Agent Run 也显示为“重放”，而 Runtime 已有 `runtime_run_relations.relation_type` 可作为权威依据。
- **执行后恢复不完整**：实验面板只恢复 `draft`；候选已经执行、但比较生成或 Desktop 会话中断时，用户无法从原入口继续。
- **比较可读性不足**：步骤只显示类型配对，自动指标没有统一摘要，也不能从差异直接跳回两侧 OAEP 证据。

P3 的真实 OIDC/模型和发布签署证据仍需补齐；P4 不以新增功能替代这些门禁。P4 的实现和自动测试可以并行推进，最终发布验收必须同时引用有效的 P3 基线证据。

## 2. 奥卡姆剃刀约束

### 2.1 保留

- OAEP/journal、Runtime Run、Manifest、Comparison 和 `eval/regression` 继续是权威事实。
- LLM Space 只作为参考源码；不引入 Pi Agent Core、Thread JSON、Electrobun、Langfuse 数据副本或上游同步任务。
- 任意实验执行都创建新 Run；不得截断、覆盖或恢复到原 Run。
- 未知、不可逆或无法证明幂等的 Tool 不自动重放。
- Desktop 只写用户发起的实验与评价，不自行持久化第二份运行事实。

### 2.2 移除或停止暴露

- 移除“存在 `parent_run_id` 就是 Replay”的 UI 推断。
- 从 Desktop 的公开实验编辑类型中移除当前执行器不支持的 Prompt、Agent、Skill、Tool、Resource、Credential 和模型采样参数；Runtime 可保留 fail-closed 兼容校验，但不得让 UI 或类型提示暗示可用。
- 不建设独立 Rubric Studio、第二个回归测试控制台、参数矩阵、自动调参器或趋势数据库。
- 不允许编辑原始 Tool Result，不把 synthetic 结果伪装成真实事件。

### 2.3 本阶段唯一新增实体

新增 `runtime_run_comparison_evaluations`，保存一次 Comparison 的人工评价修订。Rubric 作为每条评价的不可变快照嵌入，不再增加 rubric、rubric revision、score 等多张表。

## 3. 总体目标

用户应能在 Desktop 完成以下闭环：

1. 准确区分根 Run、子 Agent Run 与实验重放 Run；
2. 从基线创建实验，执行中断后可重新打开并继续；
3. 在一屏内读取结果、自动指标、步骤/文件/产物差异；
4. 对基线和候选按同一份固定 Rubric 打分，保存 verdict、备注和 OAEP 证据引用；
5. 从比较项直接返回对应 Run/Item；
6. 评价、比较和原始运行均可追溯、可重新读取且不修改历史。

## 4. 总体解决方案

```text
Runtime Run + OAEP/journal + Manifest（既有、不可变）
                  │
                  ▼
Run Inspection ──┬── typed relation
                  └── aggregate metrics
                  │
                  ▼
Run Comparison（既有、内容寻址）
                  │
                  ├── evidence navigation
                  └── Comparison Evaluation revisions（唯一新增实体）
                                      │
                                      ▼
Desktop Run Inspector / Experiment / Comparison
```

内置 Rubric 只包含三个跨任务稳定维度：

- `outcome_quality`：最终结果是否正确、完整并满足目标；
- `execution_quality`：工具、步骤和产物是否有效且无不必要失败；
- `safety_reproducibility`：审批、安全边界和复现证据是否充分。

每个维度分别对 baseline/candidate 评分 `1..5`。verdict 为 `baseline_better | candidate_better | tie | inconclusive`。允许备注和有限数量的 OAEP Item 证据引用。保存新评价时追加 revision，不覆盖旧 revision。

## 5. 模块与功能点

P4 共 20 个功能点；进度百分比按“已通过全部指定验收的功能点 / 20”计算。

### M40：集成边界与关系诚实（4 点）

| ID | 功能点 | 实现或更新模块 | 测试与验收 |
| --- | --- | --- | --- |
| M40-01 | Run 列表返回权威 `relation_type` | `runtime/engine.py`、`runInspection.ts` | root/subagent/experiment replay fixture 分别断言；旧库无关系记录时兼容 |
| M40-02 | History 使用关系类型显示，不再推断 | `SessionRunHistory.tsx` | UI 静态测试和 GUI：子 Agent 不显示“重放”，实验显示“实验重放” |
| M40-03 | 收窄 Desktop 可编辑 override 类型 | `runExperiment.ts` | TypeScript 类型检查；后端继续对旧字段 fail-closed |
| M40-04 | 参考资料更新为实际集成状态 | `docs/references/.../llm-space/` | 文档链接、边界和当前模块名校验 |

### M41：Comparison 人工评价（4 点）

| ID | 功能点 | 实现或更新模块 | 测试与验收 |
| --- | --- | --- | --- |
| M41-01 | 单表、追加式评价存储 | 新增 `runtime/run_comparison_evaluation.py`，更新 `engine.py` | revision 单调、旧 revision 不变、数据库重开可读 |
| M41-02 | 评价校验与证据归属 | 同上 | 评分范围、verdict、备注上限、Rubric snapshot、跨 Comparison Item 引用负例 |
| M41-03 | 创建与读取 API | `gateway.py`、Desktop Runtime/API/IPC | 鉴权、Workspace 隔离、幂等、冲突和 round-trip 测试 |
| M41-04 | Comparison 内评分 UI | `RunComparisonView.tsx` | 三维双侧评分、verdict、备注、保存回执、重新打开恢复 |

### M42：自动指标与证据导航（4 点）

| ID | 功能点 | 实现或更新模块 | 测试与验收 |
| --- | --- | --- | --- |
| M42-01 | Comparison 汇总双方状态、时长、Token、Tool/错误/审批/产物数 | `run_comparison.py` | 数值和 unknown 语义、摘要不依赖首屏分页 |
| M42-02 | 自动计算候选相对 delta | `run_comparison.py` | 正、负、零、unknown 单元测试 |
| M42-03 | Desktop 以可读表格展示指标 | `RunComparisonView.tsx` | 不再直接显示原始 usage JSON；中英文和 unknown 文案验收 |
| M42-04 | 步骤和评价证据可跳转 Run/Item | Comparison/Experiment/Inspector/App 回调链 | 点击两侧 Item 后关闭实验并聚焦正确 Run/Item；不存在引用被拒绝 |

### M43：实验恢复与生命周期（4 点）

| ID | 功能点 | 实现或更新模块 | 测试与验收 |
| --- | --- | --- | --- |
| M43-01 | 恢复最近草稿或已执行实验 | `RunExperimentPanel.tsx` | draft 与 executed 两类重开 fixture |
| M43-02 | 已执行且终态的候选自动恢复 Comparison | 同上、既有 Comparison API | 模拟比较生成前关闭，重开后无需重跑即可恢复 |
| M43-03 | 非终态候选提供“查看候选运行” | 回调链 | running/waiting_approval 可直接进入 Inspector |
| M43-04 | 草稿可显式放弃，未保存编辑关闭前确认 | Experiment UI、既有 delete API | 删除后不再恢复；关闭确认键盘和 GUI 验收 |

### M44：质量、发布和真实验收（4 点）

| ID | 功能点 | 实现或更新模块 | 测试与验收 |
| --- | --- | --- | --- |
| M44-01 | Runtime/Store/Gateway 自动测试 | Python tests | 相关测试全绿，无 secret/路径泄漏 |
| M44-02 | Desktop 类型和交互契约测试 | Node verifier、TypeScript | Node/Web typecheck 与 UI verifier 全绿 |
| M44-03 | GUI 纵向闭环 | Windows Desktop E2E | History → Experiment → Comparison → Evaluation → evidence jump 可见且可操作 |
| M44-04 | OIDC 真实 Runtime 与发布证据；Live 入口按需启动并同步 App-owned Gateway | `index.ts` Live handler、P3/P4 evidence、release verifier | 无需额外 Live 环境变量；App 尚未聊天时也能启动 Gateway；五类真实 Agent 用例有效；P4 ledger 20/20 accepted |

## 6. API 与数据契约

### 6.1 Run 列表

每条 Run 增加：

```json
{
  "relation_type": "root | subagent | experiment_replay | retry"
}
```

`parent_run_id` 保留兼容，但 UI 不再据此猜测语义。

### 6.2 Comparison Evaluation

```http
GET  /v1/run-comparisons/{comparison_id}/evaluations
POST /v1/run-comparisons/{comparison_id}/evaluations
Idempotency-Key: ...
```

创建请求包含：

```json
{
  "expected_latest_revision": 0,
  "verdict": "candidate_better",
  "scores": {
    "outcome_quality": {"baseline": 3, "candidate": 5},
    "execution_quality": {"baseline": 3, "candidate": 4},
    "safety_reproducibility": {"baseline": 4, "candidate": 4}
  },
  "note": "候选答案更完整。",
  "evidence_refs": [
    {"run_id": "run-...", "item_id": "item-..."}
  ]
}
```

响应必须包含不可变 `rubric_snapshot`、revision、创建者、时间和内容摘要。服务端固定 Rubric，客户端不能用自由 JSON 改写评分含义。

## 7. 安全与兼容规则

- 评价只能引用 Comparison 的 baseline/candidate Run，Item 必须确实属于对应 Run。
- note 最多 4,000 字符，证据最多 20 条；任何自由文本经过现有凭据脱敏后才公开返回。
- 幂等键绑定请求摘要；同键不同内容返回冲突。
- `expected_latest_revision` 防止两个窗口静默覆盖彼此评价。
- Evaluation 只追加，不 update/delete；若需要纠正就创建新 revision。
- Comparison 的内容摘要变化后，旧评价仍可读，但 UI 必须标记它对应的 `comparison_digest`。
- 旧 Desktop 可忽略新字段；旧 Runtime 不支持 Evaluation 时，新 Desktop 显示明确不可用，不假装已保存。

## 8. 实施顺序

1. M40：先修正关系语义并收窄公开能力；
2. M41：建立最小评价 Store 和 API；
3. M42：补齐自动指标、表格和证据导航；
4. M43：完成执行后恢复、候选跳转和草稿生命周期；
5. M44：自动化、GUI、OIDC 真实 Runtime、ledger 和发布验收。

## 9. 完成定义

P4 只有在以下条件全部成立时完成：

- 20/20 功能点均有与其范围匹配的通过证据；
- P3 的有效真实 Runtime 基线和发布签署不再处于等待状态；
- 没有把 LLM Space Runtime、可变 Thread restore 或第二套运行事实带入产品；
- 用户可从一个失败或已完成 Run 出发，完成实验、比较、评价、证据回跳和选择性采纳；
- 原 Run、原 OAEP Item、旧 Evaluation revision 均保持不可变；
- 自动测试、Desktop GUI 和真实 OIDC 模型验收均通过。
