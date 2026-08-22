# LLM Space 集成评估

> 本文件保留集成判断摘要。源码核对后的具体协议、数据表、API、桌面组件、测试门禁和阶段任务见 [implementation-plan.md](./implementation-plan.md)。
>
> OpenDrSai 正式实施文档见 [Agent 运行时可追溯、可复现第一阶段开发方案](../../../desktop/agent-runtime-traceability-reproducibility-phase1-development-plan.md)。

## 集成目标

目标不是嵌入 LLM Space 应用，而是验证其高价值交互能否基于 OpenDrSai 现有 runtime、journal、OAEP、桌面端和 `eval/` 实现。

建议的初始集成级别为 `inspiration`，即设计参考，不形成运行时依赖。

## 候选路径

### 路径 A：桌面端轨迹检查器

在 OpenDrSai 桌面端读取标准化运行事件，按模型调用、消息、Tool Call、审批和产物分组展示。

优先级：高。

原因：与当前 OAEP 和桌面端方向一致，且不会引入新的 Agent runtime。

### 路径 B：检查点与分支重放

从持久化 journal 中选择安全检查点，复制运行配置并生成新的分支运行。允许替换模型、Prompt、工具返回值或用户消息。

优先级：中高。

前置条件：明确事件可重放语义、不可逆工具策略、幂等性和敏感数据处理。

### 路径 C：运行 A/B 评测

对两个运行应用统一 rubric，同时展示自动指标，包括成功率、成本、时延、工具错误和 Token 用量。

优先级：中高。

建议复用 `eval/` 的数据集和评测能力，避免只在桌面端形成孤立评分数据。

### 路径 D：直接嵌入或 fork LLM Space

优先级：低，不建议作为第一阶段方案。

原因：TypeScript/Bun/Electrobun/Pi Agent Core 与 OpenDrSai 当前技术栈和 runtime 存在重复；直接 fork 会带来长期同步和双 runtime 维护成本。

## 最小验证原型

建议只做一个只读原型：

1. 选择一条 OpenDrSai 已完成或失败的运行。
2. 将 OAEP/journal 事件投影为统一时间线。
3. 展开查看一次模型调用和一次 Tool Call 的输入、输出、耗时及错误。
4. 选择两个运行进行并排比较。
5. 保存一份人工 rubric 评分和备注。

第一阶段不执行重放、不修改历史、不重新调用外部工具，以降低安全和一致性风险。

## 验收指标

- 能完整展示模型、消息、工具、审批、错误和产物事件。
- 原始 journal 保持不可变，UI 投影可重新生成。
- 任一显示事件可追溯到稳定 event/run ID。
- 敏感字段默认脱敏，不在前端日志中泄露凭据。
- 两次运行能够按相同维度并排比较。
- 失败定位所需操作明显少于阅读原始日志。

## 第二阶段条件

只有满足以下条件后，才进入分支重放：

- OAEP 明确 checkpoint、parent run、fork point 和 replay provenance。
- 工具定义可标记为只读、幂等、可模拟或禁止重放。
- 用户能在执行外部副作用前审查差异并批准。
- 模型、Prompt、Skill 和工具版本均可固定。
- 重放产生的新事件不会覆盖原始证据。

## 风险与依赖

- 历史事件可能缺少重建完整模型上下文所需的信息。
- 工具调用可能含外部副作用，不能机械重放。
- 跨模型 provider 的参数并非完全等价。
- 长任务轨迹可能需要分页、索引和摘要。
- 桌面端、WebUI 和移动端若分别实现投影，可能出现语义漂移。
- 评测数据需要明确归属：Thread、run、benchmark case 或数据集。

## 初步决策

- 采用：可编辑实验、事件时间线、A/B 对比的设计思想。
- 验证：只读轨迹检查器与人工 rubric。
- 暂缓：分支重放和 Tool Result 模拟。
- 不采用：将 LLM Space runtime 直接作为 OpenDrSai runtime 依赖。

## 源码审阅后的决策更新

- 三项目标全部进入规划：运行轨迹与 Tool Call 检查、不可变分支重放、A/B 评测。
- 第一项可以直接复用现有 OAEP/journal/desktop projection，优先实施。
- 第二项不能照搬 LLM Space 的消息截断逻辑；必须新增 run relation、配置快照和 fork provenance，并采用新 Run 执行。
- 第三项不能把评价只保存在客户端 Thread 文件；应由 Runtime/Eval 层持久化，并允许桌面人工评分与 `eval/` 自动指标共存。
- `parent_run_id` 当前同时服务子 Agent 关系，不能在没有 `relation_type` 的情况下直接复用为实验分支关系。
- 实际 Tool Call 重放晚于只读检查和模拟结果分支，并受执行策略、审批和幂等性门禁控制。

## 实施后的收敛结论

- 轨迹检查、实验草稿、Replay Plan、隔离执行、Comparison 与 Adoption 已由 OpenDrSai 原生模块实现。
- `runtime_run_relations.relation_type` 是实验重放关系的权威来源；`parent_run_id` 仍用于子 Agent，不得在 UI 中直接等同于 Replay。
- A/B Evaluation 采用 Comparison 上的单表追加式评价修订：内置三维 Rubric 作为不可变 snapshot，不再创建独立 Rubric Studio 或多表评分平台。
- 自动批量回归继续使用根目录 `eval/regression`；人工 Comparison Evaluation 不复制 Case/Suite 或发布门禁。
- 当前正式计划见 [Agent 运行时可追溯、可复现 P4](../../../desktop/agent-runtime-traceability-reproducibility-phase4-development-plan.md)。
