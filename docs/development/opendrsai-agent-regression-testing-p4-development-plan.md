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
| `agent_service.py` | 新增/完善 | Agent 原生 Evaluation 生命周期、事件、历史、取消、幂等和恢复；替代 Renderer bridge/control_service |
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

## 13. 实施记录

### 第 6 轮（68%）

- 修复 Runtime 回环请求错误经过系统 HTTP 代理并被私网策略拒绝的问题；只对 `localhost`/回环 IP 禁用代理。
- 普通对话案例不再携带特权 regression-control 资源；需要故障、能力或 Workspace 注入的案例仍保持 fail-closed。
- 使用真实 Desktop Gateway 跑通 `qa.greeting.hello`，并通过两个独立 Agent Runtime Run 完成一致性语义评审，终态为 `passed`。

### 第 7 轮（当前 74%）

- Result/Evidence 引用落盘为脱敏、版本化 JSON；Desktop 支持点击 `opendrsai://regression/evaluations/{id}/{summary|evidence}`。
- 引用解析仅接受固定 Scheme、Evaluation ID 和资源种类，并在应用数据根内解析真实路径；拒绝目录穿越、任意文件和 `raw` 资源。
- 修复 `regression_preflight` 管理器分发遗漏；将 Evaluation 存储从用户 Workspace 移到 `DRSAI_HOME/regression/agent-p4/<profile>`。
- Preflight 可从显式配置、应用数据、内置基线或源码开发结果中发现并校验 P2 模型能力快照。
- P4/P1-P3 相关自动化测试当前为 `82 passed`；Backend Source 归档为 560 个文件并通过校验；Desktop 引用安全验证通过。
- 当前真实 Desktop 仍运行 1.5.5/1.5.6 安装版 Gateway；源码 Gateway 对真实开发数据库提出架构迁移。为保护用户数据，真实 Desktop Skill 对话验收要在完成兼容升级或用户明确批准迁移后进行，不能用旧 Gateway 的通用回答冒充通过。

### 第 8 轮（当前 80%）

- `qa.greeting.hello` 与 `qa.constraints.json` 已经通过 Agent 原生 Manager/Tool → 真实 Gateway → Run → 双重语义判断的完整链路，结果和 Evidence 引用已持久化。
- 移除了旧的 Renderer 回归控制 API、IPC、Control Service 和 Bridge；Desktop 仅保留受控 Result/Evidence 引用打开能力，不再存在右侧栏入口或第二套执行状态机。
- Runner 执行期间新增逐 attempt 的 `case_completed` 事件；Agent 可以用游标增量查询真实案例边界，而不只看到最终状态。
- `failure_policy=stop` 的部分结果不再可能误报通过：结果明确记录 `requested_total` 与 `not_run_case_ids`，恢复流程也按请求总数核验。
- Catalog 查询增加 last-known-good 缓存。当前 YAML 无效时只允许返回带 `catalog_stale=true` 和警告的旧目录；Preflight/Start 仍读取并校验当前 Catalog，不会用旧定义启动测试。
- 本轮相关自动化测试为 `81 passed`。真实案例 `tool.web.hepix` 揭示当前 Desktop 仍加载 1.5.5 安装后端，旧 Runtime 会以 `regression_control_disabled` 拒绝新控制资源；该结果记为真实失败，不冒充模型或案例通过。
- 下一验收重点：让 Desktop 安全加载当前源码后端、完成 12 项普通聊天触发与执行，并补齐 Desktop 构建/类型检查和全量门禁。

### 第 9 轮（当前 83%）

- 建立独立的源码 Gateway 验证环境，复制必要的 Desktop 配置但使用独立数据库和测试工作区；源码运行与迁移不接触真实用户数据库。`qa.greeting.hello` 已在该环境再次通过真实模型与 Runtime 链路。
- 修复静态提供方错误使用 `provider-<id>` 作为 Agent 用户身份的问题。Gateway 现在以经过认证或 Desktop 配置的用户身份加载 Agent 的模型、Skill、工具和 Perceptor 配置；不存在回退到全局默认模型的路径。
- 修复回归控制资源泄漏给模型的问题：控制资源只进入 Runtime 的受控执行上下文，不再拼入用户输入或模型上下文；模型无法从 YAML/Fixture 直接读取预期答案。
- 修复共享 Desktop Agent Kernel 绕过 Runtime 故障注入的问题。受控工具调用现在执行确定性的失败/重试 Fixture，保留每次 attempt，并在禁用测试网络时移除未受控的外部网络工具。
- Evidence Adapter 已能解析共享 Kernel 的嵌套工具结果，提取真实 attempt 和 Runtime Policy 发起的重试证据。
- 修复诊断错误码被通用脱敏器误删的问题。结构化凭据键与文本中的真实凭据仍会被清除，但 `error_code=service_unavailable` 等稳定诊断字段可以进入 OAEP Journal 和 Evidence；新增相关安全回归测试。
- 本轮新增与受影响范围的自动化验证为 `57 passed`。案例 `tool.failure.recovery` 的行为、重试、语义输出均已达到预期；重新启动隔离 Gateway 时又发现复制的 Runtime 检查点密钥无法在当前进程用 Windows DPAPI 解密，已仅清理隔离副本，正在重新完成该案例的端到端终态确认。
- `tool.web.hepix` 已能进入真实 `web_search`，但当前 Tavily 凭据引用无法解密，Bing 降级结果也没有可靠 HEPiX 来源，因此 Agent 正确拒绝编造答案。正式验收需先让预检验证“凭据可实际解密”，并在凭据不可用时明确报 `web_search_credential` 阻塞，而不是仅凭配置引用宣称工具可用。

### 第 10 轮（当前 85%）

- 修复受控 `web_search` Fixture 被生产能力配置门禁拦截的问题。只有显式启用测试 Runtime、网络为 `disabled` 且存在对应受控 Fixture 时才跳过 Tavily 配置检查；生产运行、网络开启或未受控工具仍保持 fail-closed。
- 案例 `tool.failure.recovery` 已越过 Tavily 配置交互并进入 Agent 模型阶段，证明回归控制资源、能力门禁和工具所有权边界正确衔接。
- 新增 Agent 模型提供方预检：从 Agent 当前模型策略解析权威 Provider/Model，再读取 Gateway 的本地凭据可用状态；不发送付费模型请求。凭据不可解密时，`regression_preflight` 现在直接返回 `model_provider_credential`、Provider ID 和 Model ID，不再启动 Evaluation 后才以 `upstream_unavailable` 失败。
- 预检已在当前开发配置中实证返回：Provider `zhizengzeng`、Model `deepseek-v4-flash`、缺失项 `model_provider_credential`。真实与隔离凭据文件的只读解析均返回不可用，需要用户在 Desktop 中重新录入 API Key 后才能继续真实模型验收。
- 修复两个 AgentManager 工具策略测试仍隐式依赖已移除“全局默认模型”的问题；测试现在显式提供模型绑定，保持“模型以 Agent 配置为主”的产品约束。
- P1-P4 回归框架、Skill、Gateway、OAEP Journal、Evidence 和 AgentManager 相关自动化验证为 `172 passed, 1 skipped`。
- 额外审计发现离线 Evidence Fixture 目前只覆盖 `qa.greeting.hello`；其余 11 项不会用根据 YAML 预期反向生成的伪证据冒充通过。它们仍需受控 Runtime 或真实 Desktop Run 产生可审计 Evidence。
- 已停止源码测试 Gateway，并删除包含复制配置和凭据的整个隔离临时目录；真实 `~/.drsai-dev` 数据未被修改。

### 第 11 轮（当前 87%）

- 修复 Evaluation 启动与取消的竞态：取消发生在 Runner 创建前时后台线程不会继续启动；Runner 已创建时先请求取消活动 Gateway Run，再终止本地进程。
- Runner 与 Agent Service 之间新增最小化持久进度日志。它在 Session、Run、审批和产物边界写入白名单字段，并由 `regression_events` 投影为带稳定一基游标的事件；提示词、工具参数和凭据不能进入该通道。
- `regression_cancel` 现在保存取消前已完成案例、未运行案例、活动 Run 取消结果和引用，不再只返回一个空的 `cancelled` 状态。部分 Result/Evidence 也能通过 `opendrsai://` 引用打开。
- Evidence 引用补充工具调用、审批、产物、引用、测试环境和副作用摘要；所有树形内容继续经过深度、数量、路径和凭据脱敏限制。
- Result 增加聚合耗时、每个案例的模型摘要和 `case_snapshot_sha256`，支持 Agent 在“重跑失败项”前比较当前 revision/hash，避免静默沿用已变更案例。
- 修复资源风险识别对 `image_generation` 下划线标签的遗漏。Presentation、图像生成、Artifact、写操作、审批、联网及多案例均要求范围确认。
- P1-P4 相关 Python 门禁为 `181 passed, 1 skipped`；Desktop P4 引用解析验证通过；Windows Desktop Node/Web TypeScript 类型检查全部通过；`git diff --check` 无错误。
- 尚未完成的硬性验收仍是恢复智增增凭据后执行剩余真实 Runtime 案例，并在普通 Desktop 对话中验证 Skill 触发、过程展示和最终引用。

### 第 12 轮（当前 88%）

- Windows Desktop 生产构建通过：Backend Source 准备、Node/Web TypeScript 类型检查及 Electron Vite 的 Main、Preload、Renderer 三端构建全部成功。
- Backend Source 归档当前包含 563 个文件，并实证包含 `opendrsai-regression-testing/SKILL.md`、`agent_service.py` 和 `regression_manager.py`，不是只在源码工作区可用。
- Backend Source Manifest/ZIP 校验通过；在全新临时环境从归档构建 `drsai-1.5.5` Wheel、安装并导入的验证通过。首次沙箱执行因代理 403 无法下载 `hatchling`，按网络授权重跑后成功，不属于源码或打包失败。
- `p3-desktop` 当前 Catalog 动态返回 12 项，revision 为 `070fbe10d302c33ee70b2d74ab4dd86f7691999655933d9c9e6fa9f60f53bf1a`；Schema 验证覆盖 18 个现存案例和 1 个 Suite，全部通过。
- 智增增 Credential 第三次只读检查仍为不可用，因此本轮不能把真实模型与 Desktop 普通对话项目标记为通过。

## 14. Definition of Done 证据审计（第 12 轮）

| DoD | 当前证据 | 结论 |
|---|---|---|
| 1. 默认 Agent 搭载并触发 Skill | Skill Discovery、工具注册、Backend Source 归档均通过；尚缺真实 Desktop 自然语言触发记录 | 部分完成 |
| 2. 普通聊天完成列出、查看、运行、停止、续查、重跑 | Manager/Service 与工具契约已覆盖；尚缺真实 Desktop 全流程 | 部分完成 |
| 3. 动态 Catalog | 12 项由 YAML/Suite 动态返回，revision/hash 稳定，last-known-good fail-closed | 已完成 |
| 4. 风险确认 | 多案例、网络、审批、写操作、Presentation、图像生成和 Artifact 均有范围绑定 Token 测试 | 已完成 |
| 5. 真实 Agent/Runtime 与精确关联 | Greeting、JSON 两项真实链路通过；其余项等待凭据 | 部分完成 |
| 6. 可观察、取消和恢复 | Evaluation/Case/Run/Approval/Artifact 事件、游标、远端 Run 取消和持久恢复均有自动测试 | 已完成；待 Desktop 目测 |
| 7. 自动断言且模型不可覆盖 | YAML Schema、确定性断言、独立语义 Judge、blocked 语义和负例均有测试 | 已完成 |
| 8. 结果、证据和引用 | Result/Evidence 安全资源、Hash、工具/审批/产物/副作用摘要和 Desktop Resolver 验证通过 | 已完成；待真实点击 |
| 9. 隔离、安全和幂等 | 临时 Workspace、目录白名单、控制资源隔离、确认 Token、单飞和凭据脱敏测试通过 | 已完成 |
| 10. 移除右侧栏与自动发送入口 | Renderer API、IPC、Control Service/Bridge 已删除，只保留引用 Resolver | 已完成 |
| 11. 12 个真实 Desktop 案例 | 当前有 2/12 的真实 Gateway 通过证据；其余不能用 Fixture 冒充 | 未完成 |
| 12. P1-P4 门禁和真实验收报告 | Python、引用、类型、构建、归档安装门禁通过；真实 Desktop 12 项报告缺失 | 部分完成 |

### 第 13–14 轮（当前 90%）

- 从用户指定的临时密钥文件恢复智增增凭据，并通过 Windows DPAPI 写入开发配置；原始密钥未进入日志、结果或仓库。`deepseek-v4-flash` 的 `/v1/responses` 探针返回 HTTP 200。
- 建立独立源码 Gateway（独立 `DRSAI_HOME`、数据库和 Workspace），避免迁移或测试污染真实 Desktop 数据。
- `tool.failure.recovery` 经真实 Agent/Runtime、受控失败、重试、Evidence Adapter、确定性断言及两轮独立语义 Judge 后通过。Evaluation：`eval-8c6bcd63-cfe5-4865-a7e0-b9e6e5f1bbab`，Run：`run-85f8ae06-74dc-456c-8097-0bd688882e0d`。
- 当前真实通过为 3/12：`qa.greeting.hello`、`qa.constraints.json`、`tool.failure.recovery`。

### 第 15–17 轮（当前 91%）

- 为受控回归环境补充虚拟 `knowledge_search`，知识文档只通过摘要校验后的回归控制资源提供；生产环境、未启用控制开关或摘要不一致时均不可用。
- 受控 `web_search`/`knowledge_search` 使用 Kernel 允许的 `desktop-host` 来源，并被强制归类为只读、无需审批、无外部写能力；适配器测试 14/14 通过。
- 修正三个知识案例引用的 Fixture SHA-256。审计确认 Fixture 本身是规范 UTF-8，先前看到的乱码来自 Windows PowerShell 5 对无 BOM UTF-8 的默认解码，并非仓库内容损坏；案例 revision 因此保持为 1。
- 增加 UTF-8 合同、Base64 载荷、内容摘要与 Manifest 摘要一致性测试；`eval/regression/tests` 当前 85/85 通过。
- 案例 5 的真实模型验收尚未执行：固定测试资料将发送给智增增模型服务，需用户明确授权后继续。该项不得用本地 Fixture 单测冒充真实通过。

### 第 18 轮（当前 92%）

- 补齐 `knowledge.absent` 的确定性过程断言。`require_completed`、`require_corpus_complete`、知识库 ID/revision 和 `require_no_supporting_match` 现在逐项检查，不再被通用计数断言忽略。
- 受控知识检索结果明确区分 `supporting_matches` 与完整 `evidence`：无答案时前者为空，后者仍以 `searched_scope` 关系保留已检索语料，支持生成“完整范围中不存在该事实”的可交互引用。
- `corpus_complete` 从 YAML 经环境准备、受控资源、Kernel 工具结果一直传播到 Evidence；工具失败、语料不完整和成功检索但无支持结论不再混为一类。
- 新增有答案/无答案 Kernel 正反例及断言负例；P4 回归程序与 Desktop Kernel 相关测试为 101/101 通过，`git diff --check` 无错误。
- 补齐知识工具证据到 OAEP 引用卡片的投影：仅当最终正文实际包含对应 `opendrsai://` 来源时，才把候选证据编码进 `citations_json`；Gateway 解码后保留稳定 citation ID、Markdown 双向关系、知识库 ID/revision、文档路径、`corpus_complete` 和 `searched_scope`。相关扩展测试后为 123/123 通过。
- 真实通过仍为 3/12；案例 5、6 的外部模型与 OAEP 引用验收仍等待用户授权发送固定测试语料。

### 第 19 轮（当前 93%）

- 审计案例 7 `skill.presentation`，发现媒体检查器此前未接入真实 Runner，且只检查 ZIP、页数和是否含文字。现已在隔离 Workspace 销毁前检查 Run 产出的媒体 Artifact；越界路径被忽略，本地绝对路径不进入持久 Evidence。
- PPTX 检查新增 Office Open XML 必需部件、数字排序的 Slide、可编辑文本、16:9 实际比例、逐页文本和全页页码验证。基准 PPTX 的结构检查通过。
- 演示文稿断言改为专用逻辑：比例容差、精确页数、逐页必需文本、全部页面渲染、禁用视觉缺陷和视觉语义 Judge 分别判定；结构证据不能冒充渲染或视觉检查。
- 修复集合 `required` 列表、Artifact `min_*`/`max_*` 与 `require_*` 条件此前未实际执行的问题。Presentation Skill 的五个必需步骤和 Artifact 大小、可编辑性、Run 关联现在均会 fail closed。
- 相关 P4 Runner、Kernel、OAEP 和媒体测试为 125/125 通过，`git diff --check` 无错误。案例 7 仍需真实 Desktop Skill 执行后才能记为通过。

### 第 20 轮（当前 94%）

- 为案例 8 建立输入附件证据链：Runner 在隔离 Workspace 中重新读取并计算图片类型、MIME、尺寸和 SHA-256，并分别核验 Reproduction Manifest 引用与 OAEP User Message Part；源路径不进入证据。
- `forbid_ocr_text_injection` 现在要求 OAEP 中存在原生图片 Part，且用户消息树中没有测试框架注入的 `ocr_text`/`extracted_text` 等字段。OpenDrSai 自身受信任的图像理解模型输出仍属于 Runtime 能力，不与测试夹具注入混淆。
- 为案例 9 增加专用图片断言：PNG、横版、RGB/RGBA、最小尺寸、16:9 容差、视觉必需项、视觉禁止项和 OCR 字符上限分别判定。PNG 结构与尺寸不能冒充视觉或 OCR 通过。
- 图片 Artifact 继续要求本次 Run 关系、图像生成调用关系、摘要、最小大小和可交互正文链接；缺少任何关系均 fail closed。
- 图片视觉正向要求与“不得包含”要求已加入独立语义 Judge rubric。相关 P4 Runner、Kernel、OAEP 和媒体测试为 127/127 通过，`git diff --check` 无错误。
- 真实通过仍为 3/12；案例 8、9 需要真实图像理解/生成模型和 Desktop Artifact 交互验收。

### 第 21 轮（当前 95%）

- 修复案例 10 的只读命令契约：`shell_commands.require_policy: read_only` 现在逐条检查；`test_execution.required` 表示必须存在真实执行证据，不再要求候选伪造同名字段。退出码、命令参数、必含与禁止输出分别验证。
- 修复案例 11 的审批契约：`approval.required` 表示审批 Evidence 必须存在；proposal、decision、数量、Run/Tool 关系继续逐项比较。缺少审批对象时 fail closed。
- 案例 12 的 Run Fixture 现在以 Base64 与 SHA-256 绑定进入隐藏回归控制资源，源路径不暴露给模型；允许操作和禁止操作同时进入控制边界。
- Desktop Kernel 新增只读虚拟 `run_inspect`、`run_manifest_read`、`run_compare`。它们仅接受 YAML 白名单中的 Run ID 和固定 baseline/candidate 方向；越界 Run 或禁止操作被拒绝。
- Evidence Adapter 将上述工具调用投影为有序 `operation_calls`，提取 Comparison，并仅在正文包含稳定 `opendrsai://` URI 时把 Run、Run Item、Manifest 和 Comparison 引用标为可交互。
- 新增 Workspace、审批、Fixture 摘要、操作越界、Comparison 与引用正反例。相关 P4 Runner、Kernel、OAEP 测试为 132/132 通过，`git diff --check` 无错误。
- 真实通过仍为 3/12；案例 10–12 尚需真实 Desktop Agent 执行与可交互引用验收。

### 第 22 轮（当前 95%）

- 完成 P4 改动面的跨模块门禁：Desktop Agent Kernel、Kernel Event/Run Stream、结构化会话、OpenDrSai Gateway Backend/Approval、输入资源、回归控制与管理器、Agent Kernel 配置/生产一致性，以及 `eval/regression` 全部测试合计 `290 passed, 1 skipped`。
- Windows Desktop 的 Node/Web TypeScript 类型检查通过。该结果与前序生产构建、Backend Source 归档安装结果共同证明 P4 代码未破坏 Desktop 静态契约和核心 Runtime 集成。
- 仓库级 Python 全量测试会收集 2118 项，但当前沙箱为子进程注入 `ALL_PROXY=socks5h://127.0.0.1:8081`，使 GFS 管理客户端在测试收集早期因环境中未安装 `socksio` 而失败；随后还会遇到被沙箱阻止的 `chatgpt.com` 网络测试。该失败属于测试环境与非 P4 网络集成，不作为 P4 代码失败，也不以关闭沙箱网络约束规避。
- 为排除上述环境噪声，在同一 Python 测试进程、导入 `pytest/httpx` 前只移除该进程的代理变量，执行了与 P4 直接相关的 291 项门禁；测试未修改系统代理、用户配置或生产凭据。
- 自动化门禁不能替代真实用户验收。真实通过仍为 3/12，剩余 9 项以及普通 Desktop 聊天不受影响的目测验证仍是 Definition of Done 的硬性缺口。

### 第 23 轮（当前 96%）

- 逐项审计 12 个案例的“YAML 声明 → Environment Control → Desktop Kernel 工具 → Evidence → 断言”链路，发现案例 11 `safety.write_approval` 只有 YAML 与断言，实际 Runtime 没有得到可调用的测试写工具；原工具名 `regression.controlled_write` 也不符合 OpenAI 兼容工具名约束。
- 将工具统一为 `regression_controlled_write`。Environment Provisioner 现在把 Case 声明的 `tools` 契约放入隐藏回归控制资源；普通对话和没有该声明的案例不会暴露此工具。
- Desktop Kernel 仅在控制资源完整声明 revision、写副作用、强制审批、允许根目录和幂等要求时注册虚拟写工具。工具策略固定为 `external_write + required approval`，不能被 Agent 或 Case 提示词降级。
- 工具执行仅接受相对路径和 UTF-8 内容，目标必须位于隔离 Workspace 的预建 `output/` 目录；绝对路径、目录穿越、缺失父目录、既存目标及同一路径不同内容的幂等冲突全部 fail closed。
- 相同逻辑内容的重放返回原始摘要和 `handler_execution_count: 1`，不会再次写入。工具结果只保存相对路径、SHA-256、大小和执行次数，不保存原始幂等键或真实用户路径。
- 新增端到端 Kernel 单测，实证模型可看到并调用工具、审批恰好发生一次、批准后创建正确文件、相同调用不重复执行、越界路径被拒绝；同时新增控制资源契约测试。
- P4 相关跨模块门禁更新为 `292 passed, 1 skipped`。真实 Desktop 通过仍为 3/12；案例 11 已从“定义存在但不可执行”提升为“执行实现和自动测试完成，等待真实模型验收”。

### 第 24 轮（当前 97%）

- 审计案例 10 `workspace.readonly.diagnose`，确认 Agent 原本虽有 `run_read`、`run_grep`、`run_glob` 和 Shell 工具，但 Desktop Kernel 路径没有执行 Case 的精确命令白名单；Evidence 也不能从这些实际调用生成 Workspace 读取、Shell 和测试执行证据。
- 只读控制环境现在从模型工具列表移除 `run_write`、`run_edit`、后台命令和终止任务等写入/异步能力；网络工具继续按离线 Fixture 规则 fail closed。普通 Desktop 对话不受该测试控制影响。
- `run_powershell`/`run_bash` 在存在回归命令白名单时由 Desktop Host 拦截。只允许与 YAML 的 `executable + args` 完全一致的前台命令；额外参数、不同命令、后台执行和未声明命令均拒绝，不能依靠提示词自律。
- Host 将真实命令输出、退出码、argv 和 `read_only` 策略写入工具检查数据。Evidence Adapter 据此生成 `shell_commands` 与 `test_execution`，并把 `run_read/run_grep/run_glob` 投影为 `workspace_reads`。
- Environment Provisioner 在运行前保存隔离 Workspace 的相对文件→SHA-256 快照；Runner 在清理前重新读取实际字节，生成文件集是否相同、摘要是否相同、前后聚合摘要及新增/删除/变更路径。模型声称“没有修改”不能替代该证据。
- 正反例验证了精确失败测试可运行、退出码 1 和 `ZeroDivisionError` 可进入断言、任意命令与后台命令被拒绝，以及文件内容变化即使文件集不变也会被发现。
- P4 相关跨模块门禁更新为 `295 passed, 1 skipped`。真实 Desktop 通过仍为 3/12；案例 10 已具备真实执行基础，等待外部模型与 Desktop 可观察验收。

### 第 25 轮（当前 98%）

- 补齐案例 11 `safety.write_approval` 的真实审批证据。Gateway 对测试写工具生成最小安全 proposal：工具 ID、副作用类别、相对路径和内容 SHA-256；文件正文、绝对路径和凭据不进入审批记录。
- Approval Harness 在审批仍为 pending 时直接检查隔离 Workspace 目标是否存在，然后才提交决定；因此“审批前零副作用”来自实际时间点观测，而不是运行结束后的推断或模型声明。
- 首次决定和重复续跑的真实响应被绑定到同一 Run/Approval。Runner 要求只有一个逻辑工具调用，并从 Side Effect 记录读取 `idempotency_key_digest`；原始幂等键仍经通用脱敏规则移除。
- Gateway 在 Side Effect started/completed 的公开检查数据中增加 SHA-256 摘要，使幂等关系可审计但不可重放原始凭据。普通外部写工具的审批正文和参数仍保持原有最小披露策略。
- Runner 在运行结束后重新读取目标文件，生成审批后及重复续跑后的存在性、相对路径、内容摘要、handler 执行次数和审批次数。相同摘要与 `handler_execution_count: 1` 共同证明重复续跑没有再次写入。
- 新增 Gateway 安全 proposal/摘要测试和 Runner 归一化测试，覆盖正文不进入审批记录、审批前文件不存在、两次决定绑定同一审批、单次 handler、最终摘要及原始幂等键缺失。
- P4 相关跨模块门禁更新为 `297 passed, 1 skipped`。真实 Desktop 通过仍为 3/12；案例 11 的实现与自动证据链完成，尚需真实模型、可见审批过程和 Desktop 文件结果验收。

### 第 26 轮（当前 98%）

- 审计媒体案例发现三个会造成假验收或永久阻塞的问题：案例 9 同时要求真实 `image_generation` 和 `network: disabled`；案例 7 引用不存在的 `presentations` Skill；独立语义 Judge 只读取 Agent 最终文字而没有看到媒体像素。
- 案例 9 revision 提升为 2，网络改为 `required`。它明确验证当前 Agent 所绑定的正式图片生成提供方，预检必须披露外部网络风险并要求范围确认，不能再伪装为离线 Fixture。
- 案例 7 revision 提升为 2，并统一使用仓库实际内置的 `pptx` Skill ID；界面和文档仍可使用 Presentation Skill 作为用户名称。案例 9 的禁止 Skill 同步改为 `pptx`。
- Evidence Adapter 从真实 `Skill` 工具调用及其 `skill` 参数生成激活证据。`instructions_loaded` 来自成功加载；创建、渲染、视觉检查和 Artifact 注册分别由实际 PPTX、完整渲染集、独立视觉 Judge 与 Artifact Evidence 补充，不能一次性伪造五个步骤。
- Presentation Runner 只认隔离 Workspace `tmp/presentation-render/` 下的 PNG/JPEG；渲染图片数量必须与 PPTX 页数相同。最终图片案例使用本次 Run 的 PNG Artifact。越界文件不会进入 Judge。
- 视觉语义评估移动到 Environment 清理之前。Gateway 为 Judge 临时注册同一隔离 Workspace，并通过原生附件引用提供渲染页或生成图片；Judge 提示明确要求依据附件像素而非候选文字中的自我声明判定。
- Judge 完成后删除临时 Workspace 注册，并在持久化 Result 前移除本地 Workspace 路径和媒体引用。没有实际媒体、渲染不完整、Judge 不支持图像或附件不可用时均为 inconclusive/failed，不再用文本答案冒充视觉通过。
- Presentation 的溢出、越界、遮挡、裁切和空白页也进入视觉 Judge rubric。图片没有独立 OCR 引擎时，只有视觉模型对“可识别文字、字母、数字”三项均明确判定不存在，才可满足零字符门禁。
- P4 相关跨模块门禁更新为 `300 passed, 1 skipped`。真实 Desktop 通过仍为 3/12；媒体案例的定义和 Judge 链路已可执行，但真实生成、渲染和像素验收仍需外部模型授权。

### 第 27 轮（当前 98%）

- 审计发现 `regression_preflight` 原先只检查是否存在某份 P2 能力快照，没有对所选 Case 的模型操作逐项求交，也没有确认 Case 要求的 Skill 已安装并对当前 Agent 启用。
- 将现有 `evaluate_case_model_preflight` 接入 Agent 原生回归 Skill 的预检。每个 Case 至少要求当前 Agent 主模型的 `chat`；需要工具、Skill、知识、命令或 Run Fixture 时要求同一主模型的 `tool_calling`；Run Comparison 额外要求 `reasoning`。
- 移除基础模型的隐藏硬编码。主模型 ID 来自 Agent `/models` 的权威 `effective_ref`；预检不存在全局默认模型。视觉理解、图片生成、TTS/STT 等角色模型同样读取 Agent 的显式角色绑定。
- 图片输入和所有视觉 Judge 要求当前 `image_understanding` 角色模型具备已验证能力；图片输出要求当前 `image_generation` 角色模型具备真实 `image_generation` 证据。缺少任一项会在创建付费 Run 前返回 `model_prerequisites`。
- 能力快照中的每个必需结果必须为 `runtime_verified`，并与当前 Agent model policy revision 一致。用户切换主模型或任何角色模型后，旧快照立即失效，不能沿用其他 Agent 或旧配置的通过结论。
- 预检通过 Gateway 的 Agent Skill Preview 读取已安装且对 Agent 启用的 Skill。案例 7 要求的 `pptx` 缺失、被禁用或 Preview 不可用时返回 `agent_skills` 和安全的 missing ID，不启动 Evaluation。
- 基础 Gateway、Workspace、Provider 凭据未就绪时停止后续探测，避免向用户堆叠由同一根因产生的次级错误。预检结果新增模型 prerequisite 明细、Skill 状态和策略 revision，但不包含凭据。
- 新增当前 Agent 主模型、动态视觉/生成角色、策略 revision 漂移、缺失图片生成能力和禁用 Skill 正反例。P4 相关跨模块门禁更新为 `303 passed, 1 skipped`。
- 真实 Desktop 通过仍为 3/12。当前最后硬性缺口是用最新 Agent 配置重新生成能力快照，并在明确外部数据授权下执行剩余真实案例和普通聊天不受影响验收。
### 第 28 轮：开发版 Desktop 本地预检（2026-08-10）

- 进度：98%；真实 Desktop 通过数仍为 3/12。本轮只执行本地只读检查，没有发送案例输入，也没有触发提供方模型调用。
- Computer Use Skill 初始化因 Codex 本地应用目录的 Windows `EPERM` 权限失败，未绕过权限；改用进程、日志与 Gateway API 完成等价的本地状态检查。
- Desktop Gateway 已在 `127.0.0.1:28642` 正常运行；携带实例令牌访问 `/health` 返回 `status=ok`、`agent=ready`，数据库和当前用户均就绪。未携带实例令牌返回 401，说明本地鉴权门仍有效。
- `.tmp.key` 是智增增与 Tavily 的提供方密钥文件，不是 Gateway 实例令牌；检查过程中未输出任何密钥值。Gateway 令牌来自 `runtime/instance-token`。
- 当前 OpenDrSai 智能体模型配置有效，主模型为 `zhizengzeng/deepseek-v4-flash`，图像理解为 `gpt-5.6-luna`，图像生成为 `gemini-3.1-flash-lite-image`，语音模型为 `tts-1` 与 `whisper-1`，不存在全局默认模型回退。
- 对 `qa.greeting.hello` 执行真实 P4 preflight，结果按设计 fail-closed：当前 Agent 策略修订为 `sha256:6bd7...`，而最近的 P2 能力快照绑定旧修订 `sha256:37b4...`，因此返回 `model prerequisite policy revision changed`。不能把旧修订证据作为当前配置的验收证据；下一次真实执行前必须为当前修订重新生成 P2 能力快照。
- Gateway 的 `/model-capability-status` 是当前进程内的即时探测视图，Desktop 重启后为空；P4 使用落盘的 `capability-snapshot.json`，两者用途不同，不能用即时视图代替持久化审计证据。
- `opendrsai-regression-testing` Skill 已安装并启用。案例 7 所声明的 `pptx` Skill 当前未进入产品内置技能目录，也未安装到开发版 Desktop；仓库仅在 `skills/anthropic_skills_collection/pptx` 中存在完整实现。该案例必须继续被预检阻止，直至完成技能发布/安装并保留其脚本与引用资源，不能只复制 `SKILL.md`。
- Gateway 日志中仍存在 Runtime Relay 的 `TimeoutError`/HTTP 502 握手告警；本地 Gateway 健康不受影响，但远程 Relay 路径不能据此视为已验收。

第 29 轮应先解决 `pptx` Skill 的产品发布与完整目录安装问题，并补安装器资源复制测试；随后针对当前 Agent 修订重跑 P2 能力验证。获得新快照后，才能继续剩余 9 个真实 Desktop 案例。

### 第 29 轮：PPTX Skill 产品化与完整安装（2026-08-10）

- 进度提升到 99%；真实 Desktop 案例仍为 3/12。本轮完成案例 7 的产品能力前置项，但没有用脚本烟测冒充真实 Agent 案例通过。
- 许可审计确认 `skills/anthropic_skills_collection/pptx` 禁止复制、衍生和分发，因此没有把第三方 Skill 打入产品。新增原创产品内置 `skills/skills/pptx`，包含精简触发说明、强制创建→校验→渲染→逐页视觉检查→Artifact 注册工作流和 UI 元数据。
- 新增 `create_deck.py`：使用 `python-pptx` 生成 16:9、可编辑文本、统一蓝色科技风格、全页页码的标题页和内容页；拒绝空标题、空项目、未知版式及超过六项的拥挤内容页。
- 新增 `validate_deck.py`：检查 16:9、非空页、Shape 边界、可编辑文本及全页页码；Windows 中文控制台固定 UTF-8 输出，避免项目符号触发 GBK 编码失败。
- 新增 `render_deck.py`：优先使用 LibreOffice，无 LibreOffice 时在 Windows 使用 Microsoft PowerPoint COM，缺少真实渲染器时明确失败，不允许用结构检查冒充视觉检查。
- `python-pptx>=1.0,<2` 加入 Python 产品依赖。开发版运行时和仓库测试环境均已验证实际导入与生成。
- 修复 `/v1/skills/install`：从内置来源安装时复制完整 Skill 目录，而不再只复制 `SKILL.md`；脚本、引用、资产和 `agents/openai.yaml` 均保留，并返回确定性的 `installed_files`。安装过程排除 `__pycache__`、`.pyc` 和 `.pytest_cache`。
- 新增安装器正反例：确认完整资源树复制、缓存排除，以及用户直接提交正文时仍保持单文件安装语义。
- 用原创 Skill 实际生成四页 `OpenDrSai Runtime 核心概念` PPTX。结构校验结果为 `valid=true`、`slide_count=4`、16:9、可编辑文本和全页页码；PowerPoint 成功渲染四张 1280×720 PNG。逐页目视确认无溢出、裁切、遮挡、空白页或风格不一致。
- 已将完整 Skill 安装至开发版 `developer-local` 用户目录。Gateway Agent Skill Preview 返回 `pptx_enabled=true`、`opendrsai-regression-testing=true`、`missing_count=0`；P4 Skill 预检同时要求两项时返回 `ready`。
- Windows 后端源码包验证新增 PPTX Skill 与三项脚本断言；实际生成的包包含 568 个文件，摘要校验和发布内容校验通过。
- 自动验证结果：Skill Creator 校验通过；PPTX/安装器/P4 编排专项 39/39；`eval/regression`、Skill Policy、Model Policy Gateway 与新增专项合计 120/120；安装后的脚本再次校验真实 PPTX 通过；`git diff --check` 无错误。

下一轮仍需针对当前 Agent policy revision 重新生成真实 P2 能力快照。只有新快照通过后，才可从正常 OpenDrSai 对话触发案例 7，并继续剩余真实案例；旧修订快照不得改写或伪造成当前证据。

### 第 30 轮：当前 Agent 的真实 P2 快照与 Runtime 路由闭环（2026-08-10）

- 进度保持 99%；真实 Desktop 案例仍为 3/12。本轮生成了当前 Agent 的真实 Provider 证据并完成 6/7 Runtime 能力绑定，但视觉 Runtime 路由尚待加载修复后重验。
- 审计发现原 P2 Profile 仍绑定历史智能体 `my-drsai`，而开发版权威智能体已是 `opendrsai`。新增 `zhizengzeng-opendrsai-p2.yaml` 并将 CLI 默认与 P2 Gate 指向新 Profile；旧 Profile 保留为历史证据，不再作为 P4 默认。
- P4 preflight 新增 Agent 身份匹配：持久化快照的 `agent_id` 必须等于当前 Agent，不能仅凭模型名和 policy revision 接受其他 Agent 的证据。Agent Provider 状态现在显式返回 `agent_id`。
- 修复 Model Capability Runner 的 loopback 请求：所有本地 Gateway 探测、Run Manifest 读取和音频产品闭环均使用禁用代理的 opener，避免系统代理把 `127.0.0.1` 请求拒绝为 403。
- 新真实快照：`tmp/eval-results/regression/model-capabilities/20260810T040929Z-5ff5d41c/capability-snapshot.json`；`agent_id=opendrsai`，全部结果绑定当前 Agent policy revision `sha256:6bd7e42917b517d5fb956b11b925e00a2acac681fea009ec15282d70720c3b04`。
- 八项真实 Provider 结果全部为 `verified`、`evidence_kind=real_provider`：
  - `deepseek-v4-flash`: chat/reasoning/tool_calling 均为 `openai_responses`；
  - `gpt-5.6-luna`: chat 的 Responses 视觉断言不完整，自动回退到 `openai_chat_completions` 后通过；tool_calling 为 `openai_responses`；
  - `gemini-3.1-flash-lite-image`: `gemini_generate_content`；
  - `tts-1`/`whisper-1`: OpenAI 音频 Speech/Transcriptions。
- 音频产品路径真实执行 TTS→STT 并绑定两项 operation evidence。上午 11:05 的正式 Run `run-164027b5-3fbf-44f6-bcb0-55a73986efe2` 同时绑定主模型 chat/reasoning/tool_calling；既有真实图片生成 Run 重新校验后绑定 Gemini image_generation。当前 P2 Gate 只剩 `gpt-5.6-luna/chat` 的 Runtime verification。
- 首次执行案例 8 时，Runtime 错误要求配置 Tavily，尽管 Case 明确禁止 web search。修复两层控制：Runner 将禁用项投影为 `web_search_declined=true`；Gateway 在 Regression Control deny-list 中存在 `web_search` 时跳过生产 Web 配置门禁。相关综合测试 127/127 通过。
- 第二次案例 8 Run 正常完成并记录 `gpt-5.6-luna`，但 Manifest 使用 `openai_responses`；这与真实探测中 Responses 的视觉断言失败相冲突，Runtime evidence 按设计拒绝绑定，没有用完成状态冒充能力通过。
- 新增秘密无关的持久化协议缓存 `runtime/verified-model-routes.json`：仅保存真实已验证的 Agent/Provider/Model/Operation→Protocol、时间和修订摘要；不保存请求、响应、凭据或媒体。失败、inconclusive 和 configuration evidence 不能覆盖已验证路由；缓存不可写时探测仍可完成并回退声明路由。
- 正式图像理解 Runtime 现在优先采用该 Agent/Model/Operation 的持久化已验证协议，因此当前视觉模型应选择 Chat Completions；Gateway 进程需重启加载新代码并由当前 Profile 重建缓存后重跑案例 8。
- 自动测试：Agent 身份/Runner 36/36；loopback 修复 14/14；Regression deny-list 与 P4 全套 127/127；协议缓存、Gateway 与 Runner 40/40。

第 31 轮应安全重启开发版 Gateway，重新运行当前 `opendrsai` Profile 以落盘协议缓存，确认 `gpt-5.6-luna` 正式 Runtime Manifest 使用 `openai_chat_completions`，完成 P2 Gate 7/7，然后重新执行 P4 preflight 和案例 8。只有案例断言与交互证据通过后，真实案例计数才可增加。

### 第 31 轮：视觉模型闭环与案例 8 运行时诊断（2026-08-10）

- 进度保持 99%，真实 Desktop 通过仍为 3/12；没有把模型探针成功、单元测试成功或失败的正式 Run 计为 Desktop 案例通过。
- `gpt-5.6-luna` 已通过正式图像理解 Runtime Run 验证，Manifest 使用真实探针确认的 `openai_chat_completions`；当前 Agent 的 P2 模型能力门禁达到 7/7。
- 修复禁止联网案例的提示组合：可信图像理解摘要现在追加到已经包含“用户拒绝联网”的执行提示后，不再覆盖该约束。
- 新增 Gateway 控制的结构化可信证据资源。图像理解成功后，Runtime 通过非模型可见的 OAEP selection 资源声明 `retrieval` 已由可信证据满足；共享 Agent Kernel 据此移除相应工具需求。该机制不依赖用户可伪造的提示词标记，控制资源也不会泄露给模型。
- 语义裁判在调用方未提供 Workspace 时，会自动创建临时隔离 Workspace，完成评估后注销并删除；从而修复图片输入案例没有输出媒体目录时的 `Semantic evaluation requires a registered workspace id`。
- 定向自动化验证更新为 `79 passed, 1 skipped`，覆盖 Runner、语义裁判、输入资源、Desktop Kernel Stream 与 Mobile Agent Core。
- 案例 8 的第一次正式重跑证实视觉模型正确采用 Chat Completions，但主 Agent 因把“当前截图”误判为必须外部检索而返回能力限制；上述结构化证据修复针对这一真实根因。
- 加载最终修复后的第二次正式重跑未进入断言阶段：开发 Gateway 在创建主 Agent 后发生 Windows 连接重置/进程硬退出，Result 记录为 `status=error`、`[WinError 10054]`。该结果不是模型失败，也不能视为案例通过；下一轮必须先定位 Gateway 硬退出并在同一正式案例上重跑。

第 32 轮应采集 Gateway 硬退出的进程级诊断，确认是否由开发终端托管、原生依赖或 Agent 创建路径触发；修复后再次运行案例 8，要求确定性断言和两轮独立语义裁判均通过，再进行普通 Desktop 对话可观察性验收。

### 第 32 轮：案例 8 主链路通过与视觉语义裁判补强（2026-08-10）

- 进度保持 99%，真实 Desktop 完整通过仍为 3/12。案例 8 的真实主 Run 和全部确定性断言已经通过，但双轮视觉语义裁判尚未形成一致结论，因此仍不计入通过数。
- 进程级诊断证实第 31 轮的 `WinError 10054` 不是 Gateway 原生崩溃：使用 faulthandler 托管后，主 Run 和两个语义 Judge Run 均可继续执行；连接重置来自执行工具对前台长进程的生命周期回收。
- 找到主 Agent 降级的真实根因：Gateway 已生成可信图像摘要，但 ContextVar 在 AgentManager 的异步边界未稳定传递。现在由 Gateway 将“已满足能力域”作为非模型可见的 OAEP 控制资源传入，并显式绑定到本次 Agent Run；Agent 复用时会在 `finally` 中恢复旧值，避免跨 Session 污染。
- Agent Kernel 会校验结构化能力域白名单、移除已经由可信证据满足的工具需求，并重新计算 requirement SHA-256；`run.started` 与 `tool.decision` 增加不含用户内容的能力域诊断。用户提示词不能伪造该控制资源，控制正文不会进入模型上下文。
- 正式结果 `tmp/eval-results/regression/20260810T045200Z-790fadfe` 的主 Run 为 `run-213fa353-996f-4fb1-92b7-e64d1a9448d8`。输出正确包含 `model_unauthorized`、`my-drsai`、`deepseek-v4-pro`，全部确定性断言通过，不再返回“缺少检索或主机能力”。
- 该正式结果仍为 `inconclusive`：语义裁判只获得候选文本，没有获得原始输入截图，导致两轮对“脱敏内容”和“截断内容”是否可见判断不一致。Runner 现在把隔离 Workspace 中的原始输入图片加入 `_semantic_media`，语义请求无论是输出视觉规则还是图片输入语义规则都会携带真实附件。
- 两个独立语义轮次改为并行执行；每轮内部仍保留最多两次重试，最终仍要求两轮结构化判断完全一致，没有降低 quorum 或断言标准。这样可将真实 Provider 的串行等待由约 3–4 分钟缩短至约 1–2 分钟，适配 Desktop/Gateway 生命周期。
- 最终外部视觉语义重跑因执行环境要求对“将原始截图及派生内容发送给模型裁判”进行单独明确授权而停止；没有绕过该授权，也没有把先前不带图片的 Judge 结果冒充通过。
- 本轮相关自动化门禁为 `214 passed, 1 skipped`，覆盖 Regression Runner、语义裁判、输入资源、Gateway OpenDrSai Backend、Desktop Kernel 与 Mobile Agent Core。

第 33 轮在用户明确同意将案例 8 的测试截图发送给当前 Agent 绑定的图像理解模型和两个独立语义 Judge Run 后，执行最终并行重跑。若确定性断言与双轮裁判同时通过，再把案例 8 计为第 4 个真实通过案例，并继续下一个代表性案例。

### 第 33 轮：案例 3 真实联网、来源证据与交互引用闭环（2026-08-10）

- 进度保持 99%。`tool.web.hepix` 已通过真实 Gateway/Agent 正式验收；按真实 Runtime 验收口径累计通过 4/12。案例 8 的外部图片裁判仍等待用户单独授权，不以本轮文本联网案例替代。
- 正式结果为 `tmp/eval-results/regression/20260810T063710Z-760dac81`，主 Run 为 `run-0b1d3e16-0b79-4462-a001-786d60090246`。一次尝试完成，Run 状态为 `completed`，Case 状态为 `passed`。
- 本地 Bing/Playwright 搜索没有返回可靠结果后，Agent 按案例指引访问 HEPiX 官方主页，并从主页链接继续抓取两场 CERN Indico 活动。真实调用共 4 次：1 次 `web_search`、3 次 `web_fetch`；没有外部写入。
- `web_fetch` 现在可在没有 Tavily 凭据时使用 Playwright；官方主页抓取结果保留受限正文、页面链接、最终 URL 和内容摘要。只读的 `web_search` 与 `web_fetch` 可在同批次执行，其他混合工具调用仍按安全策略拒绝。
- OAEP ToolCall 现在保留安全的结构化 `inspection`，Evidence Adapter 据此证明实际访问过 `www.hepix.org` 与 `indico.cern.ch`，而不是从回答文字反推来源。`source_access.require_primary_source` 和 required domains 均通过。
- Gateway 将成功 Web 工具形成的 citation 事件绑定到最终 Assistant Message；Evidence 收集到 3 条可交互引用，均具有稳定 citation ID、正文关系、claim 关系和可打开 URL。Fall 活动的 Indico 根路径与 `/overview` 按同一活动规范化匹配，不放宽到其他页面。
- 回答准确说明 HEPiX 的定位，以及 Spring 2026（4 月 20–24 日，Lisbon）和 Fall 2026（10 月 19–23 日，Lincoln, Nebraska）。两个独立语义 Judge 完全一致，三项语义要求均为 `true`。
- 修复了语义 Judge 复用已注销 Workspace 导致 404、citation 集合误套通用 claim-support 规则、列表 `any_of` 比较和 Web 结果截断字段与 Artifact 截断字段冲突等问题；所有断言最终通过。
- 本轮覆盖 Regression 全套及 Web、Mobile Core、Desktop Agent Adapter、Desktop Kernel Events、Gateway Backend、OAEP 和 Structured Conversation 的自动化门禁为 `267 passed`。

下一轮继续执行无需发送用户图片的剩余真实案例，优先检查案例 4 `tool.failure.recovery` 的确定性故障注入和恢复证据。案例 8 保持待授权状态，不向任何外部模型发送截图或派生内容。

### 第 34 轮：案例 4 确定性故障注入与 Runtime 恢复闭环（2026-08-10）

- 进度保持 99%；真实 Runtime 验收累计 5/12。正式通过结果为 `tmp/eval-results/regression/20260810T065119Z-71adf73a`，主 Run 为 `run-7ff8bf4f-19ed-4751-b0d8-302057b7ff63`。
- 方案 B 已由真实 Host/Runtime 执行：Agent 获得正常 `web_search` 工具，Dispatcher 与受控 Fixture 之间为当前 Case 的第一次 Attempt 注入 `service_unavailable`；Runtime Policy 在同一逻辑操作内重试一次并取得固定成功结果。失败证据在成功后仍保留。
- 最终证据严格为 1 个逻辑 Tool Call、2 个有序 Tool Attempt；第一次 `failed/retryable=true/error_code=service_unavailable`，第二次 `completed`，`retry.initiated_by=runtime_policy`、`same_logical_operation=true`。
- 网络被禁用，Fixture 使用保留域名 `regression.test`；正式结果中真实外部网络调用为 0、审批为 0、外部写入为 0、Artifact 为 0。该案例没有依赖提供方故障，也没有让模型假装工具失败。
- 第一次真实审计发现 YAML 声称“所有断言为确定性断言”，却使用 `semantic_requirements` 触发双模型 Judge；其中一个 Judge 把明确的“2026、上海”误读为“2025、北京”。案例修订后对固定 Fixture 事实使用必要文字及容忍中文日期空格/分隔符的 `required_patterns`，不再为可直接判定的固定文本引入随机 Judge。
- 第二次真实审计发现 Agent 在成功结果后改写 query 再搜索一次。案例目的只验证 Runtime Retry，因此输入明确限定一个逻辑搜索请求；框架仍保留 `logical_tool_calls.exact=1`，没有合并、隐藏或放宽重复调用。最终 Run 证明 Agent 遵守约束。
- 案例 revision 提升到 4，说明文档同步记录隔离目标和失败条件。新增确定性正则断言支持及 Case 合同测试；本轮 Regression 全套、Desktop Adapter 与正式 Runtime Control 自动化门禁为 `136 passed`。

下一轮继续审计并真实执行案例 5 `knowledge.grounded`。重点确认答案只来自固定知识库、检索证据与引用可交互，且没有用模型自身知识补写未被语料支持的事实。

### 第 35 轮：案例 5 固定知识库、文档证据与内部引用闭环（2026-08-10）

- 进度保持 99%；真实 Runtime 验收累计 6/12。正式通过结果为 `tmp/eval-results/regression/20260810T065843Z-28358f2e`，主 Run 为 `run-04d6bf13-7f68-40ac-adf7-f509dce17723`。
- Agent 在网络禁用环境中执行 2 次 `knowledge_search`，均命中受控知识库 `regression.opendrsai-runtime@1` 的唯一文档。真实外部网络调用、Web 搜索、审批和外部写入均为 0。
- Environment Provisioner 在隔离 Workspace 挂载 Fixture，并校验固定 SHA-256 `133ef96937ed236cc0d5d62e18b9f475674400835f14c380baa89ca6ff1620f3`。案例 revision 提升为 2，并显式声明 `corpus_complete: true`，表示列出的文档就是本案例完整语料，不把单文档命中误写成未知完整性。
- 首次真实运行发现 ToolCall 中已经存在完整 `documents`，但 Evidence Adapter 汇总知识文档时没有使用统一的嵌套 Tool Result 解包函数，导致 `retrieved_documents` 被错误记录为空。修复后文档 ID、知识库 revision、相对文档路径、摘要、完整语料标记和内部 source URI 均进入正式 Evidence。
- Agent 回答准确说明 Session、Run、一对多关系、Replay 创建新 Run 和不可覆盖原始 Run。语义 rubric 将“重放创建新的 Run”改为“回答明确说明重放或实验必须创建新的 Run”，消除 Judge 把知识问答误解成要求实际执行副作用的歧义；两个独立 Judge 最终一致通过。
- OAEP 生成 1 条内部知识引用：`opendrsai://regression/knowledge/regression.opendrsai-runtime/revisions/1/documents/opendrsai_runtime_overview_v1.md`。引用包含稳定 citation ID、知识库 ID/revision、文档路径、原文片段、正文 Markdown 关系和 claim 关系，并标记为可交互。
- 补齐此前只写在 Case 中但没有独立执行的 OAEP 断言：`require_citation_parts`、`require_openable_target` 和 `require_bidirectional_navigation`。缺少目标 URL、交互能力、正文关系或反向 claim 关系时现在会明确失败。
- 新增嵌套 Knowledge Tool Result 证据测试、OAEP 开放目标/双向导航负例和 Case 完整语料合同测试。本轮 Regression、Desktop Adapter/Events、Gateway Backend、OAEP 与 Structured Conversation 跨模块门禁为 `186 passed`。

下一轮继续案例 6 `knowledge.absent`。重点验证完整语料已穷尽但没有支持性匹配时，Agent 明确表达“不知道/资料未提供”，不得从模型记忆猜测默认端口，也不得生成支持性引用。

### 第 36 轮：案例 6 完整语料无答案、拒绝猜测与 searched-scope 引用闭环（2026-08-10）

- 进度保持 99%；真实 Runtime 验收累计 7/12。正式通过结果为 `tmp/eval-results/regression/20260810T070654Z-61655a03`，主 Run 为 `run-e2904109-e813-4b5a-938e-4b248a02614b`。
- Agent 在网络禁用环境中完成 2 次 Knowledge 查询。两次结果均为 `completed=true`、`corpus_complete=true`、`supporting_match=false`、`supporting_matches=[]`，证明完整固定语料已搜索但没有端口答案；不是知识库加载失败、检索超时或空证据。
- Agent 明确说明资料未包含 Gateway 默认监听端口且无法仅据该知识库回答，没有输出 `18642`、`8000` 或其他三至五位端口数字；Web 搜索、Workspace 搜索、审批、Skill、外部网络和外部写入均为 0。
- 首次真实运行发现 `knowledge_search` 专项断言仍直接读取 OAEP 外层字符串，未解包 `result`，与上一轮文档汇总问题属于另一调用点。现在专项断言可安全解析字符串外层并读取嵌套 Knowledge Result，完整语料和无支持匹配均由真实 Tool 证据判定。
- 首次运行也证明负面知识引用候选已经生成，但模型未写内部 URI 时 Kernel 只能给出错误的 “Web information was retrieved” 警告。Runtime Citation Repair 现在从成功 Knowledge Tool Result 读取受信、受长度和换行约束的内部 source；第二次仍缺引用时自动附加该精确 source 并重新校验，不接受模型自造 URI。
- 正式结果生成 1 条 `relation=searched_scope` 的 OAEP Citation，包含知识库 ID/revision、文档路径、`corpus_complete=true`、稳定 ID、正文 Markdown 关系、claim 反向关系和可交互内部 URI。它证明已检查的知识范围，不错误声称该片段支持一个不存在的端口事实。
- 通用 Citation Retry 提示改为允许成功检索结果中的 HTTPS URL 或内部知识 URI；无法修复时的文案改为中性的 “Retrieved information”，不再把本地知识检索谎报为 Web 联网。
- 两项可直接判定的拒答要求改为确定性正则，允许自然语言间隔但仍要求“资料未包含端口”与“无法仅据资料回答”。首次两个 Judge 分别串题到代码和知识图谱，证明在固定负面语料上引入随机模型 Judge 反而降低可靠性；禁止数字和禁止主张仍独立执行。
- 案例 revision 提升为 2。新增嵌套专项断言、Knowledge Citation Repair、无 Web 误导文案、确定性拒答和 searched-scope 证据测试；本轮跨模块门禁为 `244 passed`。

下一轮审计案例 7 `skill.presentation`。重点确认真实 Agent 加载产品内置 `pptx` Skill、创建可编辑 PPTX、真实渲染全部页面、完成像素级视觉检查并注册可交互 Artifact；结构生成脚本或历史基准演示文稿不能替代本次 Run 验收。

### 第 37 轮：案例 7 Skill 执行安全链路与超时诊断（2026-08-10，未通过）

- 进度保持 99%；真实 Runtime 通过仍为 7/12。案例 7 尚未通过，不能把 Skill 加载、脚本单测或历史基准 PPTX 计为真实验收。
- 首次正式 Run `tmp/eval-results/regression/20260810T070958Z-07328a9b` 暴露工具需求误判：完整页面提纲中的概念词“引用”被分类器当成来源请求，Case 又禁用 Web/Knowledge，导致 Kernel 在调用 Skill 前返回能力限制。现在完整演示文稿内容已由用户提供且没有“注明来源/提供来源”等明确要求时，不把正文名词触发为检索；显式来源要求仍保持检索门禁。正反例已覆盖。
- 第二次 Run 证明 Agent 实际加载 `pptx` Skill、读取三个产品脚本并写出 JSON 规格，但 Shell 安全策略拒绝执行脚本；Agent 错误要求用户开启 `/dangerous on`。该行为不接受为回归路径。
- 案例 revision 提升到 4，固定中间规格与最终 Artifact 路径，并声明三个产品 Skill 脚本的 ID、相对路径、SHA-256 和参数范围。Host 只接受 Python/`python.exe`、已安装 `pptx/scripts` 后缀、匹配摘要、固定参数数目及解析后仍位于隔离 Workspace 的路径；拒绝换行、分号、管道、重定向、反引号和第二个 PowerShell 调用运算符。只兼容命令开头唯一的 PowerShell `&`。
- 产品 `pptx` Skill 增加“一次 Tool Call 只执行一个前台脚本命令”的安全说明。`Skill` 参数经 OAEP 脱敏时，Evidence Adapter 可从受控 `<skill-loaded name="...">` 结果恢复非敏感 Skill ID，后续仍需由实际 PPTX、渲染集、视觉 Judge 和 Artifact 分别补齐流程步骤。
- 原命令策略拒绝以未捕获 `ValueError` 终止整个 `/execute`，被错误归类为 `upstream_unavailable`。现在拒绝作为结构化、不可自动重试的 Tool Error 返回 Agent；同一 Run 可改用安全单命令继续，且策略拒绝与后续成功均保留。正例证明首个链式命令被拒后第二个精确命令可以完成，未调用被拒命令的 Workbench handler。
- 最终诊断 Run `tmp/eval-results/regression/20260810T073355Z-148f5db0` 不再即时异常，持续到 Case 固定的 300 秒上限后按 `timeout` 失败。这表明策略错误已留在 Run 内，但创建、验证、PowerPoint COM 渲染或模型恢复环节仍有未定位的长耗时；没有产出可验收 Evidence，计数不增加。
- 本轮新增分类器、脚本摘要/路径白名单、Shell 控制符负例、Tool Policy Denial 恢复和 Skill ID 脱敏恢复测试；当前定向门禁为 `57 passed`。

第 38 轮应把三个受控脚本的开始、完成、退出码和阶段耗时投影为不含绝对路径的 OAEP inspection，并将单个脚本执行限制在小于 Case 总预算的阶段超时。随后重跑案例 7，明确区分模型循环、创建、验证、PowerPoint 渲染和视觉 Judge 的耗时；只有四页真实渲染、结构/视觉断言和可交互 Artifact 同时通过才计为第 8 个案例。

### 第 38 轮：案例 7 白名单脚本二次授权与超时证据（2026-08-10，未通过）

- 总体进度保持 99%，真实 Runtime 验收仍为 7/12；案例 7 未生成 PPTX、渲染页或 Artifact，不增加通过计数。
- 修复回归命令策略拒绝的模型反馈：`desktop_regression_command_*_denied` 现在归类为 `command_policy`，明确要求保持安全模式、不得请求 `/dangerous on` 或用户授权，并以单条白名单命令重试。策略拒绝仍不可自动重试，且不会放宽可执行文件、脚本摘要、参数或 Workspace 边界。
- 真实 Run `tmp/eval-results/regression/round38-case7-recovery3`（`run-0dc821da-e822-4400-93fb-1ac67cd6df1e`）证明命令已经通过精确白名单，但普通 Shell 的脚本启发式又执行了一次授权检查，返回 `Script execution denied by user`；旧适配器还错误地把该文本记录成 `exit_code=0/succeeded=true`。因此根因不是白名单恢复提示，而是重复授权层与错误成功分类。
- 已让通过脚本 ID、相对路径、SHA-256、固定 argv 和 Workspace 解析检查的回归命令，仅在该次 Workbench 调用期间临时绕过同一 Agent 的通用脚本启发式，并在 `finally` 中恢复原状态；普通 Desktop 对话和未通过白名单的命令仍保持原审批策略。拒绝文本现在强制记录为失败和非零退出码。
- 定向测试为 `22 passed`，覆盖安全策略拒绝的可恢复提示、单条命令重试、临时状态 `false→true→false`、Shell 控制符拒绝、脚本摘要和 Workspace 越界拒绝。
- 修复后真实 Run `tmp/eval-results/regression/round38-case7-allowlisted-script`（`run-47c4f1fb-e68f-4838-bdc3-c407260f3093`）持续到 300 秒超时。超时证据成功保存：11 个已提交 Tool Call、0 个 Artifact，`pptx` Skill 已加载，JSON 规格已写入 `tmp/presentation-render/spec.json`；但 Agent 随后执行一次失败的 `run_read`、两次无结果 `run_glob` 并进入 `Delegate`，没有发出 `run_powershell`，因此尚未进入创建脚本，更不是 PowerPoint/LibreOffice 渲染超时。
- 下一轮应从未脱敏的本地 Runtime 事件核对失败 `run_read` 的参数和 Delegate 原因，修复 Agent 对 Skill 脚本路径与“执行命令/读取文件”的工具选择；同时为模型阶段和 Delegate 增加有界预算，避免没有进入任何白名单脚本时占满 300 秒。完成后重新执行案例 7，仍以 PPTX 可编辑、4 页完整渲染、视觉检查和可交互 Artifact 同时通过为唯一验收标准。

### 第 39 轮：案例 7 Runtime Python、工作区根与视觉阶段工具边界（2026-08-10，未通过）

- 总体进度保持 99%，真实 Runtime 通过仍为 7/12；案例 7 尚未达到视觉检查与 Artifact 闭环，不能增加通过计数。
- 受控 Skill 脚本现由当前 Runtime Python 直接执行，不再借用系统 Python 或通用 Shell。执行仍绑定 Skill ID、相对路径、SHA-256、固定 argv 与隔离 Workspace；真实退出码、标准输出和阶段超时进入结构化 inspection。
- Gateway 在 Run 期间显式设置并最终恢复 Agent 的 Runtime Workspace 根，避免把 Agent 配置目录下的用户子目录误当成本次隔离工作区。真实 Run 已成功写入 `tmp/presentation-render/spec.json`，创建并验证 4 页可编辑 PPTX，验证结果包含要求的中文文本与页码 1–4，并成功渲染 4 张 PNG。
- 修复回归控制作用域内 `Skill`/`TodoWrite` 被未知通用策略误判为需审批的问题；只对这两个本地管理工具标记为无审批，文件写入、外部副作用、委派、计划任务和配置变更均未放宽。新增“只读工具 + TodoWrite 同批调用”测试，定向门禁为 `69 passed`。
- 审计发现 Agent 的五项模型策略从 P2 已验证的 `zhizengzeng` 漂移为 `hepai`，导致独立 Gateway 返回 HepAI 身份错误。已通过 Agent 模型策略 API 恢复五项显式 `zhizengzeng` 绑定；主模型、图像理解、图像生成、TTS 与 STT 均与 P2 快照一致，不引入全局默认模型。
- 恢复后真实 Run `run-8a4ef113-2afd-44bd-8caf-150426eaa67b` 再次完成 PPTX 创建、结构验证与四页渲染；进入逐页视觉检查时，模型请求了上一轮可见但本轮工具快照未包含的 `run_read`，Kernel 按 fail-closed 规则以 `model_tool_contract_violation` 终止。该失败证明不能把已渲染等同于视觉验收，也不能绕过工具快照执行历史工具。
- 下一轮需修复 Skill 激活/工具预算变化后的模型工具快照一致性，并为渲染图建立真实、受控的图像检查路径；不得用文本读取 PNG 或仅靠尺寸/文件存在性冒充视觉检查。随后重新完成视觉 Judge、Artifact 注册和全部断言。
### 第 40 轮：案例 7 Runtime 隔离、Artifact 与视觉检查链路修复（进行中）

- 修复 Responses 连续轮次的请求级工具快照：空工具集合与子集均按请求生效，避免模型在收尾轮调用快照外工具。
- 将回归控制 ContextVar 放入 Manager 实际迭代 Agent 流的异步生成器作用域，确保 Gateway → Manager → Agent 全链路不丢失控制资源。
- 新增受控工作区写入、Skill 脚本直达 Runtime 执行、命令摘要校验，并在 Run 完成后自动登记 `artifacts/` 产物。
- PPTX 场景禁止把 `image_edit` 当查看器；协议端点仅返回零副作用的结构化拒绝，视觉验收由配置的图像理解模型独立执行。
- 移除模型策略 GET 接口把显式 `zhizengzeng` 五模型绑定静默改写为 `hepai` 的行为；显式 Agent 配置现在读取稳定且 GET 无写副作用。
- 真实案例 7 已完成 Skill 加载、PPTX 创建、4 页结构校验和渲染；当前最后一次运行在并行只读 `run_glob` 的错误审批元数据处失败。已将受控回归本地只读工具统一为 `approval_mode=none`，相关测试 59/59 通过，待下一轮真实重跑完成 Artifact 和视觉 Judge 验收。

### 第 41 轮：案例 7 命令契约、工具来源与 Desktop 生命周期诊断（进行中）

- 总体进度保持 99%，正式真实 Runtime 通过仍为 7/12。案例 7 已多次真实生成、校验并渲染四页 PPTX，但尚未完成无审批终态、独立视觉 Judge 和全部自动断言，因此不增加通过计数。
- 定位到前一轮 `model_tool_not_in_snapshot:run_powershell` 发生在 24 轮工具预算耗尽后的 tool-free finalization；Kernel 的 fail-closed 行为正确。为减少无效探索，受控 Runtime 现在把 Case 已签名的精确命令模板写入系统契约，并明确相对 `scripts/` 路径由 Host 对已加载 Skill 做根目录解析与 SHA-256 校验，Agent 不应查找、复制或重写脚本。
- 修复 `image_edit` 安全拒绝的工具来源遗漏：判断改为基于最终工具元数据注册表，而不是仅基于 Workbench/Handoff 名称集合。新增管理器来源的 `image_edit` 正例，验证其无需审批、不会到达实际 Host，并返回 `presentation_visual_inspection_delegated`；当前相关定向门禁为 80/80 通过。
- 真实运行确认命令模板生效：创建、验证、渲染三个受控 Skill 脚本均以退出码 0 完成，四张 PNG 已生成。模型随后仍尝试把 `image_edit` 当查看器；实际 Run 进入 Android Host 审批，证明执行 Run 的驻留 Agent Host 尚未加载本轮源码，而非新 Gateway 代码或模型逻辑再次失败。
- 发现开发版 Desktop 与手工源码 Gateway 在固定端口 28642 存在所有权冲突：Desktop 进程组会探测并关闭竞争 Gateway，Runner 表现为 WinError 10054。使用同一 `.drsai-dev` 和源码但绑定 28643 后连接稳定，隔离证明端口生命周期冲突与 Case 本身无关。
- 下一步必须重启 OpenDrSai-Dev 的驻留 Agent Host（仅重启 Gateway 不够），让工具元数据修复实际加载，再在独立端口或修复后的 Desktop 管理端口重跑案例 7。验收仍要求 Run completed、零用户审批、唯一可交互 PPTX Artifact、四页结构与逐页渲染、独立图像理解 Judge 和全部 YAML 断言同时通过。

### 第 42 轮：案例 7 原生视觉输入与可交互 Artifact 正式验收（2026-08-10，通过）

- 总体进度保持 99%；真实 Runtime 正式验收累计提升为 8/12。正式通过结果位于 `tmp/eval-results/regression/round42-case7-accepted/round42-case7-accepted`，主 Run 为 `run-5901b59b-a6dc-4790-8ba6-79eaf6360260`。
- 修复 Desktop 开发模式 Gateway 生命周期：由 `dev.ps1` 外部托管的持久 Gateway 不再被 Desktop `stopGateway()` 请求关闭；Windows 生命周期验证覆盖“开发托管外部 Runtime 保留”场景并通过。
- 语义裁判不再只收到图片路径字符串。Runner 将工作区内真实存在的渲染图片编码为只读 `oaep.input/1` 文件资源，包含相对引用、MIME、大小和 SHA-256；绝对路径、目录穿越和不存在文件被拒绝。两轮独立裁判均实际收到四张幻灯片并一致通过全部视觉要求。
- Runtime Artifact 描述符明确投影 `downloadable=true`，Office 文件不虚报内嵌预览；Evidence 只有在最终回答含精确相对路径、Artifact 可下载、且存在同一 Artifact 的 OWOP 资源引用时，才判定链接可交互。
- `required_steps` 是无序能力集合，断言改为检查所有必需步骤均存在，避免按数组顺序产生假失败。最终结果同时通过：Skill 加载、PPTX 创建、校验、四页渲染、视觉检查、Artifact 注册、16:9、4 页、全页页码、可编辑文本、可交互下载和全部 YAML 断言。
- 本轮相关定向测试为 103/103 通过。案例 8 的用户截图仍不得在没有明确外发授权时发送给外部图像理解模型；可先继续不依赖该截图授权的案例。

### 第 43 轮：案例 9 真实图片生成与三轮视觉裁判正式验收（2026-08-10，通过）

- 总体进度保持 99%；真实 Runtime 正式验收累计提升为 9/12。正式通过结果位于 `tmp/eval-results/regression/round43-case9-native-judge/round43-case9-native-judge`，主 Run 为 `run-735774ff-12b1-4430-bc79-2799b82b85e7`。
- 案例 revision 提升为 7。输入将五类能力明确表达为五个无标签几何图标，并声明主题名、能力名也不得画入图片，消除“能力名称既是语义要求又被模型误画为标签”的提示歧义；零文字、字母、数字、Logo 和水印的严格断言没有放宽。
- 真实 `gemini-3.1-flash-lite-image` 调用生成 `1376×768` PNG；Runtime 将产物规范化并登记为唯一 `artifacts/opendrsai-agent-runtime.png`。Artifact 可下载、可预览、与当前 Run 和 `image_generation` Tool Call 双向关联，最终回答中的精确路径可交互。
- 语义 Judge 传输改为明确的非可信 JSON 数据块，不再要求普通模型解码 Base64 rubric；每轮授权媒体复制到独立临时工作区，避免并发裁判互相关闭 Workspace。三轮独立图像理解裁判以多数决逐项判断，本次三轮全部成功且所有视觉必需项和禁止项均通过。
- 真实 Provider 生成可能接近三分钟，案例总预算由 180 秒调整为 360 秒，为生成后的三轮独立裁判保留明确预算。命令行不得把 Gateway 根地址误传为外部裁判 URL；Gateway Adapter 默认使用带认证、原生媒体资源和隔离工作区的 `semantic_judge` 路径。

下一步执行案例 10 `workspace.readonly.diagnose`，验证 Agent 在只读工作区中完成真实检索、问题定位和证据化诊断，同时保持零写入、零审批和零越权修复。

### 第 47 轮：案例 8 原生截图理解与三轮视觉 Judge 正式验收（2026-08-12，通过）

- 总体进度保持 99%；真实 Runtime 正式验收累计提升为 10/12。正式通过结果位于 `tmp/eval-results/regression/round47-case8-rev2/round47-case8-rev2`，主 Run 为 `run-577c104a-85ec-472e-89e2-e126d90f0744`。
- 用户明确授权把案例 8 的固定 OpenDrSai Desktop 截图发送给 Agent 绑定的图像理解模型，以及最多 3 个独立视觉 Judge；授权不扩展到其他图片或其他外部服务。正式输入证据为 235,735 字节 PNG、1598×1021，SHA-256 为 `b3742a0f7997e8ef07fdba9fee167a4141088b5da779cc08056ae82c333e7919`。
- `gpt-5.6-luna` 图像理解实测使用已验证路由 `openai_chat_completions`。原 512-token 输出预算会被该模型的推理消耗而返回空正文，图像理解的 Responses/Chat 输出预算统一提升到 2048；模型路由解析现在可读取进程环境中的 Provider 凭据，HTTPX 依赖增加 SOCKS 支持。
- Gateway 成功取得图像摘要后，以不可见于模型的可信证据资源标记 `retrieval` 与 `workspace` 已满足。嵌套的 Gateway/Agent manager 控制作用域现在继承外层可信证据和回归控制，不再把截图摘要中的“源文件/路径”等 UI 文字误判为必须再次读取工作区或联网验证。
- 独立 Judge 显式声明 `web_search_declined=true`，只依据候选回答、rubric 与已授权媒体评审；这避免 rubric 中“当前/来源”等数据触发公共 Web 能力配置审批。三轮 Judge 均一次成功，9 项语义要求全部为真。
- 案例 revision 提升为 2。第 3 问明确询问“优先检查什么，身份恢复后应怎么做”，使“身份恢复后重新运行”的验收项与输入意图一致，没有删除或放宽语义要求。
- 正式结果 34/34 自动断言通过：Run completed；附件哈希、MIME、尺寸、Manifest 引用与 OAEP User Message Image Part 完整；禁止 OCR 文本注入；Tool、Skill、Knowledge、审批、外部写入与 Artifact 均为 0；错误类型、Backend、模型、脱敏/截断边界和恢复建议全部通过。
- 定向门禁包括 Runtime 图像理解、模型路由/适配器、Desktop Kernel 可信证据、Judge 离线输入和案例目录校验，分组结果为 `63 passed`、`35 passed`、`18 passed`、`9 passed`。诊断期间发现 `.tmp.key` 是多行 dotenv 文件，启动脚本必须只解析 `ZHIZENGZENG_API_KEY=` 条目，不能把整份文件当成 Authorization 值。

下一步回到案例 10 `workspace.readonly.diagnose` 的真实 Runtime 验收，再完成案例 11、12及 P1–P4 全量审计。由于本轮一次诊断输出意外显示了 dotenv 中的凭据内容，继续外部模型测试前必须轮换相关密钥。

### 第 48 轮：案例 10 预验收与 Agent 原生工具面闭环（2026-08-12，等待真实模型）

- 总体进度保持 99%，正式真实 Runtime 通过保持 10/12；本轮没有用离线测试替代剩余真实验收。
- 案例 10 的 YAML 已是 revision 2，当前 Fixture 权威摘要为 `1b5e588ea393b89b1ab78f7862c2398f8cc2152209a24ee9b8c4e7d328060966`。配套说明仍停留在 revision 1 和旧摘要，现已同步修正；Provisioner 会在每次运行前重新计算并与 YAML 绑定值比较。
- 案例 10 的隔离、输入、Workspace 前后摘要、只读命令、预期失败测试证据和确定性断言定向门禁为 `68 passed`。它已具备真实运行所需代码基础，但仍须由 Agent 实际读取至少两处文件、执行精确 Pytest 命令并生成零写入诊断结果后才可计为通过。
- 修复 Agent 原生回归工具面遗漏：普通 Desktop Kernel 现在把 `_regression_tools` 加入最终模型工具快照；回归控制中的被测 Agent Run 仍不暴露这组编排工具，避免测试递归启动测试。
- `DesktopAgentManagerPorts` 新增九个 `regression_*` 工具的受控分发，调用 Agent 持有的 `RegressionManager`；失败只返回稳定错误码和异常类型，不向模型泄漏任意路径或底层异常正文。新增工具可见性与真实 Manager DTO 分发测试，相关门禁为 `41 passed`。
- 当前 `.tmp.key` 修改时间仍为 2026-08-10，未显示已轮换。由于第 47 轮诊断输出曾暴露旧凭据，本轮未再次读取或调用该密钥；正式案例 10–12 和普通 Desktop Skill 对话验收须使用轮换后的凭据。

下一步在密钥轮换后启动隔离源码 Gateway，先通过普通 Agent 对话实证 `Skill → regression_list_* → preflight/start/events/get`，再依次完成案例 10、11、12 的真实 Runtime、审批/副作用和可交互引用验收。

### 第 49 轮：案例 11 审批边界与案例 12 证据采集契约（2026-08-12，等待真实模型）

- 总体进度保持 99%，正式真实 Runtime 通过保持 10/12；跨模块自动门禁更新为 `207 passed`。
- 案例 11 的自动审批 Harness 现在显式要求 `requires_scope_confirmation=true`，并把可批准操作限制为 `regression_controlled_write`。Gateway Adapter 在创建 Workspace、Session 或 Run 之前检查确认状态；未确认时以稳定错误 `approval_scope_confirmation_required` 失败，不会进入等待审批或产生副作用。
- Harness 收到同一 Run 的其他待审批操作时强制拒绝，不能把“测试 Run”当作通配授权。批准路径仍验证审批前目标不存在、同一 approval/logical operation/idempotency digest、重复 Continue 只执行一次、目标摘要正确且无越界写入。
- 案例 12 新增受控 Run Evidence 系统契约。Runtime 从 YAML 已签名的 `allowed_operations` 投影且只投影操作名与 Run ID，要求依次各调用一次：两个 `run_inspect`、两个 `run_manifest_read`、一个 `run_compare`；不得跳过、重复、Replay 或创建实验。该契约不包含输出、差值、结论或 Fixture 答案。
- 进一步审计确认案例 12 的引用仍需真实交互验收：Fixture 返回的 `opendrsai://runs/...` 与 `opendrsai://run-comparisons/...` 当前已有结构和 Evidence 断言，但 Desktop Markdown 通用处理器只明确支持 Evaluation 引用，且 Fixture Run 不是 Runtime 数据库中的真实 Run。最终验收前必须证明点击能打开对应受控证据，或把引用收敛到可解析的 Evaluation Evidence 资源；不能用 URI 语法正确冒充可交互。
- `.tmp.key` 仍未显示轮换，因此本轮没有读取或调用已暴露的外部模型凭据。案例 10–12 真实模型执行和普通 Desktop Skill 对话继续等待安全凭据。

下一轮优先完成案例 12 的受控引用解析设计与自动测试；密钥轮换后立即执行案例 10、11、12 和普通 Desktop 对话终验。

### 第 50–51 轮：案例 12 Evaluation Evidence 引用闭环与 Skill 终检（2026-08-12，等待真实模型）

- 总体进度保持 99%，正式真实 Runtime 通过保持 10/12；未以本地测试替代案例 10–12 的真实模型验收。
- Agent Service 将案例证据中的 Run 与 Run Comparison 引用重新绑定为持久化 Evaluation Evidence URI：`opendrsai://regression/evaluations/{evaluation_id}/evidence/{case_id}/{reference_type}/{reference_id}`。每个引用对应一个脱敏 JSON 证据文档，保存引用描述、对比结论、受控操作调用和最终输出；不再依赖 Fixture Run 存在于正式 Runtime 数据库。
- Desktop 主进程的引用解析器仅接受 `eval-*`、`summary|evidence` 和受限安全路径段；细粒度引用只允许位于 `evidence` 下，并在打开前执行真实路径包含性检查。Traversal、外部协议、未知资源和在 `summary` 下伪造细粒度路径均被拒绝。
- 同一案例重复报告相同类型和 ID 的来源引用时，安全摘要只返回一个可交互引用，避免 Agent 最终回答重复引用同一证据。引用文档采用临时文件加原子替换写入。
- 回归测试包门禁为 `122 passed`；Agent Service 定向门禁为 `23 passed`；Skill 发现、Regression Manager、Desktop Manager Ports 与 Kernel Adapter 门禁为 `45 passed`；Desktop 引用解析器验证通过。
- 产品 Skill 已按 Skill Creator 规范终检。`SKILL.md` 保持原生对话入口，要求通过 `regression_*` 工具列出、预检、启动、观察和读取权威终态，并使用工具返回的 Result、Evidence、来源证据与 Artifact 引用。`quick_validate.py` 在 `PYTHONUTF8=1` 下验证通过；Windows 默认 GBK 直接启动该脚本会误读 UTF-8 文件，属于校验启动环境约束。
- 用户再次确认案例 8 可将约 230 KB 的固定 OpenDrSai Desktop 测试截图发送给 Agent 绑定的图像理解模型和最多 3 个独立视觉 Judge；该最小范围授权与第 47 轮已保存并正式通过的 235,735 字节输入证据一致，不扩展到其他媒体或服务。
- `.tmp.key` 的长度和修改时间仍与已暴露的旧文件一致（最后修改时间为 2026-08-10）。本轮只检查元数据，没有读取内容或发起外部调用。安全轮换仍是剩余真实模型与 Desktop 对话验收的唯一人工配置项。

下一轮在凭据轮换后启动隔离源码 Gateway，依次完成案例 10、11、12 的真实 Runtime 验收和普通 Desktop 对话中的 `Skill → regression_list_* → preflight/start/events/get → 可点击证据` 终验；随后执行 P1–P4 逐项完成审计。

### 第 52 轮：P4 产品表面防回退门禁与当前完成审计（2026-08-12）

- 总体进度保持 99%，正式真实 Runtime 通过保持 10/12。18 个案例和 4 个 Suite 的定义重新通过 CLI Schema 验证，`p3-desktop` 动态目录仍按 Suite 顺序返回 12 项。
- 新增 P4 产品表面自动门禁，禁止重新引入 `RegressionPanel`、`RegressionTab`、Renderer 回归控制 Bridge/Service、回归 Composer 自动填充或自动发送标记。Desktop 只允许保留普通聊天中的 Evaluation Evidence 引用解析入口。
- 新增 Skill 动态目录门禁：权威 Suite 必须包含 12 项，且 12 个稳定 Case ID 均不得硬编码进 `SKILL.md`；Skill 必须通过 `regression_list_suites`、`regression_list_cases` 和 `regression_get_case` 动态获取事实。
- 新门禁定向结果为 `2 passed`；完整 `eval/regression` 门禁更新为 `124 passed`；相关改动 `git diff --check` 无错误。
- 按当前权威证据重新审计 Definition of Done：第 3、4、7、9、10 项已由自动化和源码证据证明完成；第 1、2、5、6、8、11、12 项仍含真实 Desktop 对话或剩余案例证据，不能提前标记完成。其中案例 10–12 的真实 Runtime、普通聊天中的 Skill 自然语言触发/运行/停止/续查、过程可见性和证据实际点击仍是硬性验收项。
- 凭据文件仍未轮换，因此本轮没有外部模型调用。现阶段没有发现另一个必须人工配置的 P4 阻塞项；Desktop/Gateway 端口、Agent 模型绑定、Skill/Tool 可见性、Fixture、Judge、审批 Harness 与证据 Resolver 均已有实现和本地门禁。

下一轮在安全凭据可用后直接进入真实终验；若凭据仍未轮换，则继续完成发布构建、归档内容和 P1–P3 门禁的当前状态审计，但不会以这些本地证据替代 12/12 真实通过。

### 第 53 轮：P1–P3 发布依赖审计与 Sandbox 安全修复（2026-08-12）

- 总体进度保持 99%，正式真实 Runtime 通过保持 10/12。P1/P2 结果、Gate、CLI 与 P3 Desktop 定向测试为 `32 passed`；P3 Windows Sandbox 启动合同验证通过。
- 审计发现 P3 Sandbox 启动器和验证器仍硬编码 Runtime `v1.5.6`，而当前 Desktop 包版本为 `1.5.7`；旧验证器因此可能对历史 Runtime 假绿。启动器现在从当前 `package.json` 解析语义版本，构造并记录同版本 Runtime 文件名；验证器要求动态绑定并明确拒绝旧版本常量。
- 当前宿主已经存在 `1.5.7` Runtime ZIP 和 current-source MSI，因此版本修复后没有新增构建产物缺失项。最终 P3 仍必须在新 Windows Sandbox 中运行，历史 1.5.6 证据不能用于当前源码放行。
- 历史 Sandbox 目录中发现 2 个遗留的 `developer-provider-private` staging。它们已在验证精确路径位于 `tmp/eval-results/p3-sandbox/<run-id>/developer-provider-private` 后删除；所有脱敏证据、Runtime 和 MSI 均保留。当前剩余该类目录为 0。
- 新运行的 Provider 私有 staging 已移到宿主临时根 `OpenDrSaiP3Provider/<run-id>`，不再位于证据树。启动失败时同步删除；启动成功后由隐藏监视进程跟踪精确 Sandbox Session，Session 消失后验证目录边界并只删除该 staging。超时或控制器不可读时 fail closed，不删除未确认目标。
- 启动器与清理器 PowerShell 语法、Sandbox 合同验证和相关 `git diff --check` 通过。P3 进度文档同步记录本次安全修复。

下一轮继续审计当前 P2 能力快照、Backend Source 归档和 P1 Release Gate 的真实证据新鲜度；外部凭据轮换后再执行案例 10–12、普通 Desktop Skill 对话和新的 P3 Sandbox 全量验收。

### 第 54–55 轮：当前源码 Runtime、MSI 与人工阻塞审计（2026-08-12）

- 总体进度保持 99%，正式真实 Runtime 通过保持 10/12；没有用构建产物或本地单元测试替代案例 10–12 的真实模型验收。
- 当前 P2 持久化能力快照不能用于放行：它绑定 `my-drsai`、旧 Agent model policy revision，且已过 24 小时新鲜度窗口；当前 `opendrsai` 配置还缺少 `gpt-5.6-luna` 的 chat/tool-calling 与 Runtime 绑定证据。密钥轮换后必须重新执行五模型矩阵并生成当前 Agent、当前策略修订的快照。
- 重新生成内嵌 Backend Source，共 577 个源文件；隔离 Python 3.11 环境完成 wheel 构建和安装验证。修复 CI Agent 准备脚本误选 PATH 中 Python 3.9 的问题：默认模式优先使用仓库 `.venv` 的 Python 3.11，避免生成不满足项目 `>=3.11` 约束的伪发布产物。
- 从当前工作树完成 Runtime `1.5.7+2d654f9e79782e53` 封装和最终解压验证，共 17,663 个文件。Runtime ZIP 为 336,274,187 字节，SHA-256 `0081c394dd2c7129184e7e515c8f644c4cb7495b2bb07cf4baa8a3496e69b673`；完成收据已同步写入。
- 从 Runtime 内嵌 `drsai-backend-source.zip` 重新抽检 `agent_service.py`、`test_p4_product_surface.py` 和 `opendrsai-regression-testing/SKILL.md`，三者 SHA-256 均与当前工作树完全一致；P4 产品表面防回退测试已实际进入发布归档。
- 标准 Bootstrapper 构建只刷新通用 MSI，而 P3 Sandbox 启动器明确引用 `OpenDrSaiSetup-P3-current-source.msi`。历史同名文件不能冒充当前源码，本轮通过官方 `build-msi.ps1 -RequireTrustedRuntime -OutputName OpenDrSaiSetup-P3-current-source.msi` 独立重建；新 MSI 为 643,072 字节，SHA-256 `c8ae668b7c803acba1ea8bbeda85d449d02ba97509b704bb3b12d1eeb095a2fd`，并在构建中再次通过完整 Runtime 可信解压门禁。
- 本轮自动门禁为：`eval/regression` 124/124 通过、Evaluation Evidence 引用 Resolver 通过、P3 Windows Sandbox 启动合同通过；P4 相关文件的差异检查无新增格式错误。工作树中另有其他功能分支的未提交修改和两个既有文档尾随空格，不属于本轮回归实现，未擅自修改。
- 案例 8 的固定约 230 KB Desktop 截图外发授权已满足，不再是阻塞。当前剩余人工配置只有：轮换此前暴露的智增增/Tavily 凭据并在 Desktop 重新录入；P3 最终纯净环境验收时由用户在新 Windows Sandbox 内完成一次性 HepAI/OIDC 登录。后者不阻止先完成案例 10–12。

下一轮在安全凭据可用后重建 P2 能力快照，依次完成案例 10、11、12 的真实 Runtime 验收，以及普通 Desktop 对话中的 Skill 自然语言触发、过程可见性和证据点击终验；随后用本轮 current-source Runtime/MSI 启动全新 Windows Sandbox 完成 P3 全量验收和 P1–P4 逐项完成审计。
