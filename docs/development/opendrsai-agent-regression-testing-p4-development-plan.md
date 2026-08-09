# OpenDrSai 回归测试 P4 开发方案：Agent 原生回归测试 Skill

## 1. 定位

P4 不再建设 Desktop 右侧栏或独立回归测试控制台。回归测试应当是 OpenDrSai Agent 的原生能力：用户在普通聊天中表达意图，OpenDrSai 自动发现并使用 `opendrsai-regression-testing` Skill，动态读取案例、执行测试、收集证据、自动断言，并把过程与结论作为正常 Agent 回复呈现。

典型对话：

- “有哪些回归测试？”
- “介绍一下 `tool.web.hepix` 的输入和通过标准。”
- “开始执行问候案例。”
- “运行全部回归测试，失败时停下来。”
- “刚才为什么失败？给我看断言和证据。”
- “只重跑上次失败的案例。”

P4 复用 P1 的 YAML、Suite、Runner、断言与证据，P2 的模型能力结果，以及 P3 的真实 Agent/Runtime 路径。`eval/regression/cases/**/*.yaml` 和 `eval/regression/suites/*.yaml` 仍是唯一事实源；Skill 不复制 12 项清单或断言。

## 2. 总体目标

1. 实现并给 OpenDrSai 搭载 `opendrsai-regression-testing` Skill。
2. 让模型从自然语言正确识别“列出、查看、运行、停止、续跑、重跑、解释结果”等意图。
3. 通过受控工具动态查询 Suite 与案例详情，不依赖前端硬编码。
4. 通过受控执行工具启动单案例或 Suite，并由确定性执行内核完成预检、运行、证据收集和自动断言。
5. Agent 在对话中持续呈现当前案例、阶段、Run、工具/审批等待项和阶段性结果，让人能够观察。
6. 最终回复给出通过/失败/阻塞汇总、逐项依据、引用形式的证据链接和建议动作。
7. 案例新增或更新后无需修改 Skill；Skill 读取最新合法 Catalog revision。
8. 不允许 Agent 伪造执行、跳过断言后宣称通过，或直接执行案例 YAML 中的任意命令。

## 3. 产品交互与意图契约

### 3.1 查询案例

用户询问有哪些测试时，Agent 调用目录工具并返回 Suite 中的动态列表。每项至少包括：标题、稳定 ID、简要说明、标签和最近状态。用户追问某项时，再读取详情，呈现：

- 输入消息与附件；
- 预期输出和结构化断言摘要；
- 必需/禁止的工具、Skill、知识库和审批行为；
- 环境、隔离、attempt 和 timeout；
- 当前 revision/hash 与最近同版本结果。

首批 `p3-desktop` Suite 仍包含 12 项：`qa.greeting.hello`、`qa.constraints.json`、`tool.web.hepix`、`tool.failure.recovery`、`knowledge.grounded`、`knowledge.absent`、`skill.presentation`、`image.input.ui_error`、`image.output.simple`、`workspace.readonly.diagnose`、`safety.write_approval`、`run.inspect_compare`。这个列表只用于 P4 验收说明，运行时必须动态查询。

### 3.2 启动测试

对于明确、安全且无歧义的单案例请求，Agent 可直接启动。以下情况先确认：

- 用户要求运行整个 Suite 或多个可能耗时/付费的案例；
- 案例会触发写操作、审批、外部副作用或真实资源消耗；
- 名称匹配到多个案例；
- 环境不完整，需要用户选择模型、工作区或 Fixture。

启动后返回 evaluation ID，并以正常 Agent 运行事件持续展示：预检、环境准备、执行、证据收集、断言、终态。用户不需要打开额外产品入口。

### 3.3 运行中交互

执行是可观察、可中止、可恢复的。Agent 应：

- 在每个案例开始和结束时给出简短进度；
- 工具调用、审批卡片、生成产物和失败恢复沿用现有聊天投影；
- 等待审批时明确说明等待什么，绝不自动批准；
- 用户询问进度时查询真实 Evaluation，不凭上下文猜测；
- 收到停止意图时调用取消工具，报告已经产生的副作用和证据；
- Desktop/Runtime 重启后根据 evaluation ID 恢复查询，而非重新发送。

### 3.4 结果表达

最终回复必须包含：

1. 总体结论：passed、failed、blocked 或 cancelled；
2. 通过数、失败数、阻塞数、耗时和 attempt；
3. 每个失败/阻塞案例的失败断言、预期、实际值和下一步；
4. 模型、case revision/hash、evaluation/thread/run 关联；
5. Result、Evidence Manifest、产物或引用的可交互链接；
6. 明确区分“运行失败”和“无法判定”。

证据必须以 OpenDrSai 可正确交互的引用形式给出，不以不可点击的绝对路径或裸 ID 代替。

## 4. Skill 设计

建议目录：

```text
skills/opendrsai-regression-testing/
  SKILL.md
  agents/openai.yaml
  references/
    result-interpretation.md
```

`SKILL.md` 保持精简，只描述意图路由和不可违反的执行流程：

1. 查询 Catalog，禁止凭记忆列案例；
2. 解析用户选择并展示预计范围/风险；
3. 必要时请求确认；
4. 调用预检；
5. 调用执行工具并记录 evaluation ID；
6. 轮询或订阅事件，向用户投影关键阶段；
7. 查询最终结果，按结果 Schema 汇报；
8. 引用证据；
9. 只有所有必需断言通过才能称为“通过”。

Skill 不内嵌 Python runner，不把所有案例内容加载进模型上下文。重复且脆弱的逻辑放在受控工具/脚本中；模型负责意图理解、范围确认、过程说明和结果解释。

## 5. Agent 工具面

P4 应向 OpenDrSai 暴露窄而语义化的工具，而不是让 Skill 执行任意 shell：

```text
regression_list_suites()
regression_list_cases(suite_id, filters?)
regression_get_case(suite_id, case_id)
regression_preflight(suite_id, case_ids, agent_context)
regression_start(suite_id, case_ids, options, confirmation_token?)
regression_get(evaluation_id)
regression_events(evaluation_id, after_cursor?)
regression_cancel(evaluation_id)
regression_history(filters?)
```

工具返回稳定 JSON DTO 和稳定 `regression_*` 错误码。`regression_start` 内部调用现有运行路径和断言引擎；不能把“如何调用 Gateway、如何拼输入、如何找 Run”交给模型临场发挥。

### 5.1 执行状态机

```text
preflighting -> awaiting_confirmation? -> preparing_environment
-> running -> collecting_evidence -> evaluating
-> passed | failed | blocked | cancelled
```

Suite 默认串行执行。每个 attempt 独立保存；失败是否继续由用户选项和 Suite policy 决定。

### 5.2 精确关联

每次运行必须保存：

```json
{
  "source": "agent_regression_skill",
  "evaluation_id": "eval-...",
  "suite_id": "p3-desktop",
  "case_id": "qa.greeting.hello",
  "case_revision": 1,
  "definition_sha256": "...",
  "input_sha256": "...",
  "thread_id": "...",
  "run_id": "..."
}
```

元数据随 Run、Manifest 和 Result 保存，不拼入案例用户输入。禁止用“最近 Run”推断关联。

## 6. 数据、断言与证据

- Catalog 保持 Suite 顺序，返回 `catalog_revision`、case revision 和 definition hash。
- YAML 无效时返回可定位错误并保留 last-known-good Catalog；不让 Agent 自行修补定义后继续运行。
- 断言顺序：运行终态 → 环境/输入 → 工具/Skill/审批/副作用 → 输出结构/内容 → 引用/产物 → 必要的语义/媒体判定。
- Judge 不可用且案例依赖 Judge 时结果为 `blocked`，不能降级为 passed。
- Result 和 Evidence Manifest 必须脱敏、可校验 Hash、可通过 OpenDrSai 引用打开。
- 案例定义改变后旧结果标为历史版本，不计入当前 revision 的通过率。
- 测试工作区、故障注入和写操作只允许在白名单 Fixture/隔离根中进行。

## 7. 需要实现、更新或移除的模块

| 模块 | 动作 | 职责 |
|---|---|---|
| `skills/opendrsai-regression-testing/SKILL.md` | 新增 | 意图路由、确认策略、执行协议、汇报规范 |
| `skills/.../agents/openai.yaml` | 新增 | Skill 展示名、简述和默认提示 |
| OpenDrSai 默认 Agent 配置 | 更新 | 搭载并允许调用回归测试 Skill 与工具 |
| Skill/Tool discovery | 更新 | 让自然语言请求稳定触发该 Skill，保持最小工具授权 |
| `catalog_api.py` | 新增/完善 | 动态 Suite/Case DTO、顺序、摘要、版本 Hash、安全投影 |
| `control_service.py` | 新增/完善 | Evaluation 生命周期、事件、历史、取消、幂等和恢复 |
| Agent regression tool adapter | 新增 | 将窄工具映射到 Catalog/Control/Runner，执行参数校验 |
| `runtime_executor.py` | 更新 | 真实 Agent/Runtime 执行、精确 Run 关联和 Evidence Adapter |
| `result_store.py` | 更新 | 保存 revision/hash、thread/run、断言明细和引用资源 |
| `assertions.py`/媒体与语义 evaluator | 完善 | 复用 P1-P3 判定并支持 blocked 语义 |
| 对话事件/引用投影 | 更新 | 把进度、审批、Result、Evidence 和产物投影到聊天 |
| Desktop Regression Tab/Panel/样式 | 移除/不实现 | 不再提供侧栏入口或 UI 专用控制器 |
| Composer 自动填充/自动发送 | 移除/不实现 | Skill 运行是 Agent 工具调用，不模拟用户再次发消息 |
| 前端硬编码案例数组 | 禁止 | Catalog 是唯一事实源 |

现已实现的 Catalog、Control 和 IPC/桥接代码需要在开发中审计：能被 Agent Tool Adapter 复用的保留；只服务 Renderer Tab 的 API/IPC 应移除，避免形成第二入口和多余攻击面。

## 8. 功能点、测试与验收

| 功能点 | 自动化测试 | 对话验收 |
|---|---|---|
| Skill 触发 | 中英文/简称/反例意图集，检查触发与不误触发 | “有哪些回归测试”能自动使用 Skill；普通“什么是回归”不启动测试 |
| 动态目录 | 新增、更新、删除 YAML；Suite 顺序与 hash 测试 | 新增案例后再次询问即可看到，无需改 Skill |
| 案例详情 | DTO、脱敏、附件和断言摘要测试 | 追问案例能看懂输入、预期、环境和版本 |
| 范围解析 | ID、标题、序号、标签、全部、失败项匹配测试 | “跑第三个”“跑工具类”“重跑失败项”选择准确 |
| 风险确认 | 多案例、付费、写操作、外部副作用策略测试 | 高风险/大范围先确认，安全单案例不反复确认 |
| 预检 | 模型、工具、Skill、Fixture、网络、Judge 缺失测试 | 缺项时不启动并具体说明，不返回笼统模型错误 |
| 执行与幂等 | 单案例/Suite、重复调用、超时、重试、取消测试 | 同一确认只启动一次；可停止并报告已完成项 |
| 真实 Runtime 路径 | 请求、事件、工具、审批、产物集成测试 | 聊天能观察真实工具/审批/产物，不是 Runner 伪造文本 |
| Run 精确关联 | 并行旧 Run、重试、重启恢复和错绑测试 | 回复中的 evaluation/thread/run 与证据一致 |
| 自动断言 | 12 类断言、故意破坏预期、Judge 不可用测试 | 失败指出具体断言；无法判定显示 blocked |
| 过程投影 | 事件游标、乱序、断线重连、节流测试 | 长任务有阶段更新但不过度刷屏，询问进度得到真状态 |
| 结果解释 | Result Schema、汇总计数、错误文案测试 | 结论先行，逐项给预期/实际/建议，不只给红绿状态 |
| 引用与产物 | 引用 URI、权限、Hash、失效链接测试 | 来源、Result、Evidence 和产物可从聊天点击打开 |
| 历史与续跑 | revision 变化、失败过滤、分页、重启测试 | “上次结果”“重跑失败项”准确且不继承旧 revision 绿灯 |
| 安全 | 工具参数 fuzz、目录逃逸、恶意 YAML、任意命令测试 | Agent 无法借 Skill 读取任意文件或绕过审批 |

## 9. 开发阶段

### A. Skill 与只读目录

创建并校验 Skill，接入 `list_suites/list_cases/get_case/history` 工具，搭载到 OpenDrSai 默认 Agent。

验收：在 Desktop 普通聊天中询问案例、Suite 和详情，返回动态 12 项及正确说明、版本和最近状态。

### B. 受控单案例执行

实现 preflight/start/get/events/cancel，打通 `qa.greeting.hello` 和 `qa.constraints.json` 的真实 Runtime、Run 关联、结果与引用。

验收：仅通过对话启动、观察、停止和查询；两个案例能自动判定，故意破坏预期后稳定失败。

### C. Suite 编排与恢复

实现串行 Suite、范围确认、失败策略、attempt、事件游标、Desktop/Runtime 重启恢复和失败项重跑。

验收：“运行全部，失败即停”和“重跑上次失败项”行为准确且幂等。

### D. 12 项能力与证据

完成 Web、工具故障、Knowledge、Presentation、图像、Workspace、Approval 和 Run Comparison 的 Fixture、Evidence Adapter 和断言。

验收：12 项均能从普通对话启动，每项都有真实 Run、自动结论和可交互证据。

### E. 安全、可用性与门禁

完成提示/工具注入防护、隔离、权限、错误恢复、引用可用性、Skill 触发评测和发布门禁。

验收：P1-P4 自动测试与真实 Desktop 对话验收全部通过。

## 10. 明确移除或不做

- 移除/停止开发 Desktop 右侧栏“回归测试”Tab、RegressionPanel、UI 专用状态与样式。
- 移除 Composer 自动填充、延迟自动发送和模拟用户输入的方案。
- 不让 Skill 直接读写任意 YAML 路径、执行 shell 或调用任意 Gateway 参数。
- 不在 Skill 或前端硬编码 12 项的输入、预期和断言。
- 不让模型自行判断“看起来正确”后标记 passed；终态来自断言引擎。
- 不自动接受审批，不把测试副作用写入真实用户工作区。
- 不以 Run completed 代替引用、产物、行为和副作用验收。
- 不使用最近 Run 等启发式关联，不沿用旧 revision 结果。

## 11. 风险与应对

| 风险 | 应对 |
|---|---|
| 模型未触发 Skill 或误触发执行 | 强触发描述、意图评测集、只读查询与执行工具分离 |
| 模型编造案例/结果 | 强制先查询 Catalog/Result；工具返回可引用事实；Skill 明令禁止凭记忆 |
| 大范围测试意外消耗 | 预检给出范围/风险/预计资源，多案例必须确认 |
| 长任务刷屏或失联 | 事件节流、阶段更新、随时 get/cancel、持久化 evaluation |
| 重复工具调用导致重复运行 | confirmation token、evaluation 幂等键和单飞锁 |
| Prompt injection 改写断言 | YAML/证据作为不可信数据；断言只由确定性引擎解析 |
| 测试污染真实数据 | 白名单 Fixture、隔离根、审批与副作用账本 |
| 结果链接不可用 | 受控 resource URI、权限检查、失效提示和 Hash 校验 |

## 12. Definition of Done

P4 完成必须同时满足：

1. OpenDrSai 默认 Agent 已搭载并能稳定触发 `opendrsai-regression-testing` Skill。
2. 用户只通过普通聊天即可列出、筛选、查看、运行、停止、续查和重跑回归测试。
3. Skill 动态读取 Catalog；案例变更无需修改 Skill 或 Desktop UI。
4. 大范围或有副作用的测试经过明确确认，安全单案例可直接执行。
5. 每次运行经过预检和真实 Agent/Runtime 路径，并精确关联 evaluation、case revision/hash、thread、run 和 input hash。
6. 聊天中可观察阶段、工具、审批、产物和当前等待项；重启后可恢复查询。
7. 断言引擎自动给出 passed/failed/blocked/cancelled，模型不能覆盖结论。
8. 最终回复逐项说明预期、实际、失败原因和下一步，并以可交互引用给出 Result、Evidence、来源和产物。
9. 执行受隔离、权限、审批、幂等、目录白名单和提示注入防护约束。
10. 右侧栏 Tab、RegressionPanel、Composer 自动填充/发送等旧 P4 UI 方案已移除。
11. 12 个代表性案例均能从 Desktop 普通对话完成真实运行并通过各自验收。
12. P1、P2、P3、P4 自动门禁和真实 Desktop 对话验收报告全部通过。
