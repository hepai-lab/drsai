# OpenDrSai 回归测试 P4 开发方案：Desktop 可观察回归测试控制台

## 1. 定位与背景

P1 建立了案例 Schema、Suite、Runner、断言和证据框架；P2 验证了 OpenDrSai 绑定模型的能力与调用协议；P3 定义了真实 Desktop 聊天路径、运行关联、截图和用户体验验收。P4 在这些基础上，把回归测试变成 Desktop 内可发现、可观察、可操作的产品能力：用户从右侧栏查看动态案例目录，展开案例理解输入和预期，点击“开始测试”后亲眼看到输入进入聊天框、被发送、由 Agent 处理，并在同一界面看到自动判定和证据。

P4 不新建第二套案例或断言系统。`eval/regression/cases/**/*.yaml`、`eval/regression/suites/*.yaml` 和现有 Python 回归引擎仍是唯一事实源；Desktop 只通过受控接口读取目录、发起真实聊天运行并展示由回归引擎生成的结果。

## 2. 总体目标

1. 在 Desktop 右侧栏新增“回归测试 / Regression”Tab。
2. 默认加载 `p3-desktop` Suite，按 Suite 顺序动态展示全部代表性案例及简要说明。
3. 新增或更新 YAML 后，开发版 Desktop 无需修改前端代码即可刷新目录和详情。
4. 展开案例后展示输入消息、附件、环境要求、预期输出、行为断言、超时和隔离方式。
5. 点击单个案例的“开始测试”后，Desktop 创建或选中受控测试会话，把输入可见地写入聊天框，再通过现有聊天发送链路提交。
6. 用户能够观察输入、发送、流式回复、工具调用、审批、产物和最终状态的全过程。
7. 运行结束后自动收集关联 Run 证据，复用现有断言引擎判定通过或失败，并在右栏展示逐项结果。
8. 失败时给出业务可理解的原因、失败断言、关联 Run 和“打开运行/调试”入口；不得只显示笼统的模型错误。
9. 每次测试形成可追溯记录；案例修订后不能误用旧 revision 的结果。

## 3. 产品形态与交互

### 3.1 右侧栏入口

在现有 `运行 / 文件 / 浏览器 / 终端 / 调试` 右侧栏标签中加入：

```text
运行 | 文件 | 浏览器 | 终端 | 回归测试 | 调试
```

“回归测试”是开发者能力，P4 默认在开发版启用；正式版通过显式 Feature Flag 或开发者设置启用。未启用时不加载回归目录、不启动辅助服务，也不显示空标签。

### 3.2 案例列表

顶部提供：

- Suite 选择器，P4 默认 `p3-desktop`；
- 搜索框，可按 ID、标题、说明和标签过滤；
- 状态过滤：全部、未运行、运行中、通过、失败；
- 刷新按钮和“案例来源/更新时间”提示；
- 汇总：案例总数、通过数、失败数、未运行数。

每个折叠条目显示：

- 案例标题、稳定 ID、revision 和标签；
- 来自 YAML `description` 的简要说明；
- 最近一次结果、耗时和执行时间；
- “开始测试”按钮；运行中显示进度和“停止测试”。

首批目录动态读取以下 12 项，而不是在 React 中硬编码：

| ID | 列表简要说明 |
|---|---|
| `qa.greeting.hello` | 验证自然问候、基础流式回复且不滥用工具。 |
| `qa.constraints.json` | 验证严格、可解析的受约束 JSON 输出。 |
| `tool.web.hepix` | 验证 Web 检索、HEPiX 2026 事实和可交互引用。 |
| `tool.failure.recovery` | 验证首次工具失败后的有限重试、恢复和友好提示。 |
| `knowledge.grounded` | 验证基于指定知识库证据回答并正确引用。 |
| `knowledge.absent` | 验证知识缺失时明确说明不足且不编造。 |
| `skill.presentation` | 验证 Presentation Skill、PPTX 产物和 Desktop 展示。 |
| `image.input.ui_error` | 验证错误截图上传、图像理解和问题分析。 |
| `image.output.simple` | 验证图片生成、产物保存和 Desktop 预览。 |
| `workspace.readonly.diagnose` | 验证只读工作区工具调用和文件证据诊断。 |
| `safety.write_approval` | 验证写操作审批、审批前无副作用和幂等执行。 |
| `run.inspect_compare` | 验证两个 Run 的读取、比较和可追溯诊断。 |

表中的文字是首批产品文案基线；实际 UI 应优先使用 YAML 的 `title` 和 `description`。需要修改文案时更新案例 YAML，前端不维护映射表。

### 3.3 展开后的案例详情

详情按人能理解的顺序展示：

1. **输入**：角色、文本、附件名称与类型；敏感值和绝对路径脱敏。
2. **预期结果**：输出类型、长度/结构、语义要求、禁止声明、引用与产物要求。
3. **预期行为**：必须/禁止的工具、Skill、知识查询、审批和副作用。
4. **测试环境**：网络、工作区 Fixture、知识库、故障注入、权限与隔离策略。
5. **执行规则**：timeout、attempts、工具重试策略。
6. **最近结果**：每条断言的通过/失败、Run ID、模型快照、工具摘要、产物与证据入口。

`expect` 是结构化断言，不一定存在唯一“标准答案”。UI 需要由 Catalog API 返回人类可读的 `expectation_summary`，同时提供“查看原始 YAML”只读折叠区，不能把复杂断言误画成一段精确文本。

### 3.4 可观察的开始测试流程

单案例执行状态机：

```text
idle
  -> preflighting
  -> preparing_session
  -> filling_composer
  -> ready_to_send
  -> sending
  -> running
  -> collecting_evidence
  -> evaluating
  -> passed | failed | blocked | cancelled
```

交互要求：

- 点击“开始测试”后先进行环境预检；缺少模型、工具、Fixture 或权限时不发送，并明确指出缺项。
- 按案例 `environment.session` 创建全新测试会话或复用指定会话，标题带“回归测试 · 案例标题”。
- 切回聊天视图并保持右侧“回归测试”Tab 打开。
- 使用现有 `chat.setInput(...)` 把案例文本写入真实 Composer，使用户能够看到内容已经填入。
- 至少经过一个可见渲染周期后，调用与用户点击发送按钮相同的 `submit` Command；禁止直接从 Regression Panel 调 Gateway Run API。
- 附件通过现有 Composer 附件链路加载并显示；附件校验完成后才能发送。
- 发送后聊天区正常显示用户消息、Agent 流式输出、工具状态、审批卡片和产物卡片。
- 右栏同步显示案例阶段、耗时、关联 Run、已完成断言数和当前等待事项。
- P4 默认单并发，避免多个案例抢占聊天框、焦点、审批或会话关联。
- 在 `filling_composer` 或 `ready_to_send` 阶段提供取消；发送后使用现有 Run 停止语义取消，不伪装成未执行。

“可观察”不等于通过 DOM 模拟键鼠。P4 应复用 Composer 的状态和 Command，通过同一业务入口提交，这样既能让人看到，也能避免脆弱的坐标自动化；验收时仍需证明消息确实经过 Desktop 聊天层，而非后端直跑。

## 4. 数据与控制架构

```text
cases/*.yaml + suites/*.yaml + schemas/*.json
                 |
                 v
       Python CaseCatalog / validator
                 |
        Regression Control API
        catalog | detail | evaluate | history
                 |
          Electron main / preload
                 |
       RegressionPanel + TestController
                 |
   real Composer -> existing Chat submit -> Agent Run
                 |
       runtime events / manifest / OAEP
                 |
        evidence -> assertions -> result
```

### 4.1 唯一事实源与动态更新

- Suite 决定显示哪些案例以及显示顺序；不得使用 `CaseCatalog.resolve()` 当前按 ID 排序的结果作为 UI 顺序。
- Catalog 返回 `catalog_revision`，由 Suite、Case 内容和 Schema 的摘要组成。
- 每个案例返回 `id + revision + definition_sha256`。测试结果必须保存这三项，定义变化后旧结果显示为“历史版本”，不能继续计入当前通过率。
- 开发版监听 `eval/regression/cases`、`suites` 和 `schemas` 的文件变化并使 Catalog 缓存失效；同时保留手动刷新。
- YAML 修改不合法时保留上一次有效目录，并在 Tab 顶部显示具体文件与 Schema 错误，不让整个右栏崩溃。
- 正式包若启用该能力，使用构建时纳入并签名的只读 Catalog Snapshot；不从任意用户目录执行未知 YAML。

### 4.2 Regression Control API

建议在现有 Python 回归包之上新增控制面，而不是在 TypeScript 中复制 YAML 解析和断言：

```text
GET  /regression/v1/suites
GET  /regression/v1/suites/{suite_id}/cases
GET  /regression/v1/cases/{case_id}
POST /regression/v1/evaluations
GET  /regression/v1/evaluations/{evaluation_id}
GET  /regression/v1/evaluations/{evaluation_id}/events
POST /regression/v1/evaluations/{evaluation_id}/cancel
GET  /regression/v1/history
```

控制面职责：

- 复用 `CaseCatalog`、JSON Schema 和跨字段/资产校验；
- 输出安全的 UI DTO 和 `expectation_summary`；
- 接收 Desktop 已完成 Run 的关联信息，而不是替 Desktop 发送聊天；
- 收集并标准化 Manifest、OAEP、工具、审批、产物和输出；
- 调用现有确定性、媒体和语义 Evaluator；
- 持久化 Result、Evidence 和事件流；
- 所有错误使用稳定 `regression_*` code，内容脱敏。

开发版可由 `dev.ps1 -WithGateway` 一并启用控制面。未显式启用 P4 时，相关路由返回不可用且不暴露本地案例路径。

### 4.3 Desktop IPC 与安全边界

Renderer 不直接读取文件系统或访问本地 Regression HTTP Token。新增窄 IPC：

```text
regression.listSuites()
regression.listCases(suiteId)
regression.getCase(caseId)
regression.beginEvaluation(caseRef, desktopContext)
regression.attachRun(evaluationId, runIdentity)
regression.getEvaluation(evaluationId)
regression.subscribeEvaluation(evaluationId)
regression.cancelEvaluation(evaluationId)
regression.listHistory(filters)
```

Main/Preload 必须校验 suite/case ID、限制数据大小、删除秘密和任意文件路径，并只允许读取配置的 Regression Root。Renderer 不能向 Control API 提交任意命令、任意断言代码或任意 Fixture 路径。

### 4.4 Run 关联

在现有聊天/Agent Run 请求中增加可选内部元数据：

```json
{
  "source": "desktop_regression",
  "evaluation_id": "eval-...",
  "case_id": "qa.greeting.hello",
  "case_revision": 1,
  "definition_sha256": "..."
}
```

该元数据不拼入用户输入，不暴露给模型，但随 Desktop Session、Run、Manifest 和 Result 保存。关联同时校验 thread、run、evaluation、case revision 和输入摘要；禁止使用“数据库最新 Run”猜测结果。

## 5. 自动判定与结果展示

### 5.1 判定顺序

1. 运行终态和超时；
2. 输入、会话和环境证据；
3. 工具、Skill、知识库、审批和副作用行为；
4. 输出结构与确定性内容；
5. 引用、文件、Presentation、图片等产物；
6. 必要时执行语义判定；
7. Desktop 用户体验断言和截图证据。

所有必需断言通过才可标记 `passed`。语义 Judge 不可用时，依赖它的案例应为 `blocked`，不能把缺少判定误报为通过；不依赖语义 Judge 的确定性案例仍可正常完成。

### 5.2 结果 UI

结果卡显示：

- 总结：通过、失败、阻塞、取消；
- 案例版本、模型、耗时、attempt；
- 断言分组和每项实际值/预期值；
- 工具、引用、审批、产物和副作用摘要；
- 失败原因及可执行下一步；
- “打开聊天位置”“打开运行”“打开调试”“打开证据目录”操作。

失败不能自动修改案例基线，也不能自动重试到成功。只有 YAML 定义的 attempts/retry policy 可以触发受控重试；每次 attempt 独立保存。

### 5.3 截图与证据

P4 由 Desktop 在关键阶段通过受控的 Electron `capturePage` 保存应用内截图：发送后、终态、审批或产物关键态。截图范围和尺寸固定，进行敏感信息检查与压缩，并写入 Evidence Manifest。截图用于验收 UI 投影，不作为文本断言的唯一依据。

## 6. 需要实现、更新或移除的模块

| 模块 | 动作 | 主要职责 |
|---|---|---|
| `eval/regression/src/opendrsai_regression/catalog_api.py` | 新增 | Suite 顺序目录、详情 DTO、摘要、版本 Hash 和安全投影 |
| `eval/regression/src/opendrsai_regression/control_service.py` | 新增 | Evaluation 生命周期、事件、历史、Run 关联和取消 |
| `eval/regression/src/opendrsai_regression/runtime_executor.py` | 更新 | 接收真实 Desktop Run 证据进行评估，不重复发送聊天 |
| `eval/regression/src/opendrsai_regression/result_store.py` | 更新 | 保存 case revision/hash、Desktop thread/run 和 UI 证据 |
| `eval/regression/schemas/*.json` | 更新 | 补充 UI summary/visibility 等必要的向后兼容字段；不把 UI 文案另存一套 |
| Gateway/开发启动脚本 | 更新 | Feature Flag 下启动 Regression Control API、健康检查和受控目录定位 |
| `apps/desktop/shared/api/desktopApi.ts` | 更新 | Regression DTO、IPC、Run correlation 类型 |
| Windows/macOS main 与 preload | 更新 | 窄 IPC、控制面客户端、校验、事件订阅和截图证据 |
| `navigation.ts` | 更新 | `RightTab` 新增 `regression` 及中英文标签 |
| `components/RegressionPanel.tsx` | 新增 | 动态目录、筛选、详情、进度、断言结果和历史 |
| `components/RegressionTestController.ts` 或 hook | 新增 | 预检、会话准备、Composer 填充、发送、关联和状态机 |
| `App.tsx` | 更新 | 注入 Regression Panel，与现有 chat adapter、运行和调试导航衔接 |
| `useDesktopChatAdapter.ts` | 更新 | 暴露稳定的 prepare/submit Command 和内部 correlation；禁止 Panel 操作 DOM |
| 右栏样式与可访问性 | 更新 | 窄宽/宽屏、键盘、焦点、状态播报和长内容折叠 |
| 前端硬编码案例清单/断言 | 禁止新增/移除已有临时实现 | 避免 YAML、前端和后端三套定义漂移 |

## 7. 功能点、测试与验收方案

| 功能点 | 自动化测试 | 产品验收 |
|---|---|---|
| 动态案例目录 | 新增/删除/修改 YAML、Suite 顺序、revision/hash、缓存失效测试 | 新增合法案例后刷新即可出现，更新说明后 UI 同步 |
| 无效定义容错 | Schema、重复 ID、缺少资产、非法路径和超大字段测试 | 显示具体定义错误并保留上次有效目录 |
| 右栏 Tab | 导航类型、显隐 Flag、持久化、窄屏和切换测试 | “回归测试”可发现，切换不影响聊天运行 |
| 案例详情 | 各 Part/Expect/Environment 的 DTO 和渲染快照测试 | 输入、预期、行为和环境可理解，复杂断言不被误导性简化 |
| Composer 可见填充 | Adapter 单测、Unicode、多行、长文本和焦点测试 | 点击开始后用户能看到真实聊天框被填充 |
| 同链路发送 | Command 集成测试，断言只触发一次 submit | 聊天中出现真实用户消息，Run source 为 `desktop_regression` |
| 附件准备 | Hash、缺失、上传失败、图片/文件类型测试 | 附件先显示且校验完成，再发送；失败不发空任务 |
| 会话隔离 | new/reuse、旧消息、并发和取消测试 | 新会话案例不受历史污染，当前人工会话不被覆盖 |
| Run 精确关联 | 并行旧 Run、重试、重启恢复和错误关联测试 | 右栏、聊天、Run Inspector 展示同一 Run ID |
| 可观察进度 | 状态机、事件乱序、断线重连和恢复测试 | 用户能看到填充、发送、运行、判定全过程，无瞬间后台跳过 |
| 自动断言 | 复用 P1/P2/P3 测试，补 Desktop Evidence adapter 测试 | 结果逐项说明预期与实际，不能只给一个绿/红图标 |
| 语义判定降级 | Judge 可用/不可用/超时测试 | 不可判定显示阻塞，不误报通过 |
| 审批和副作用 | 隔离根、审批前后、取消、幂等测试 | 写测试只影响 Fixture；审批由用户在聊天中观察和处理 |
| 截图证据 | capture、尺寸、压缩、Hash、敏感信息和 Manifest 测试 | 成功/失败均能从结果打开对应 UI 截图 |
| 历史与版本 | revision 变化、旧结果、分页和清理测试 | 新定义不继承旧绿灯；可查看历史版本结果 |
| 可访问性 | Tab/Accordion/Button 键盘、ARIA live、焦点恢复测试 | 全流程可用键盘操作，状态变化可被读屏感知 |
| 安全边界 | IPC fuzz、目录逃逸、恶意 YAML、任意命令/路径测试 | Renderer 不能借回归功能读取任意文件或执行任意命令 |

## 8. 开发阶段与每阶段门槛

### 阶段 A：动态目录与只读详情

实现 Catalog API、窄 IPC、Feature Flag、右栏 Tab、Suite/Case 列表和详情。

验收：`p3-desktop` 的 12 项按 Suite 顺序出现；修改一个 YAML 的 title/description/revision 后刷新即更新；无效 YAML 给出可定位错误。

### 阶段 B：真实 Composer 驱动

实现 TestController、测试会话、可见填充、附件准备、同链路发送、单并发、取消与 correlation metadata。

验收：`qa.greeting.hello` 和 `qa.constraints.json` 均由按钮触发，用户可观察聊天框填充和发送，聊天记录与 Run 可精确关联。

### 阶段 C：自动判定与证据

实现真实 Run Evidence Adapter、断言执行、结果事件、截图、历史和失败导航。

验收：前两个案例自动给出逐项通过/失败；故意破坏预期时稳定失败并指向对应断言和 Run。

### 阶段 D：12 项完整能力

完成附件、Web、Knowledge、Presentation、Image、Workspace、Approval 和 Run Comparison 的环境预检与 Evidence Adapter。

验收：从干净 Desktop 依次执行 12 项，每项都有可观察聊天过程、唯一 Run、自动结论和证据；失败必须修复后从 UI 重跑。

### 阶段 E：可用性与发布门禁

完成键盘/读屏、窄屏、错误恢复、版本历史、安全测试和开发文档。

验收：P1/P2/P3 门禁、P4 单元/集成/真实 Desktop Suite 全通过；开发版默认可用，正式版仅在显式启用时暴露。

## 9. 建议目录

```text
eval/regression/
  cases/**
  suites/p3-desktop.yaml
  schemas/**
  src/opendrsai_regression/
    catalog_api.py
    control_service.py
    desktop_evidence_adapter.py
  results/<evaluation-id>/
    result.json
    evidence-manifest.json
    ui/*.png

apps/desktop/shared/
  api/regression.ts
  main/regressionControlClient.ts
  renderer/src/components/
    RegressionPanel.tsx
    regression/useRegressionTestController.ts

docs/development/
  opendrsai-agent-regression-testing-p4-development-plan.md
  opendrsai-agent-regression-testing-p4-progress.md
  opendrsai-agent-regression-testing-p4-real-acceptance.md
```

## 10. 明确不做或需要移除的部分

- 不在前端硬编码 12 项清单、输入、预期或断言。
- 不让 Regression Panel 直接调用 Gateway 创建 Agent Run；必须经过真实 Composer/Chat Command。
- 不通过 `querySelector`、模拟点击或固定坐标控制聊天框。
- 不以“Run completed”代替行为、输出、引用、产物和 UX 断言。
- 不允许用户提供任意 YAML 路径并由 Desktop 执行。
- 不自动接受审批、不放宽工作区权限、不把测试 Fixture 写入真实用户工作区。
- 不用最新 Run、时间最接近 Run 等启发式关联测试。
- 不在案例定义变化后沿用旧版本通过状态。
- 若现有分支中存在临时前端案例数组或简化判定，应在迁移到 Catalog API 后移除。

## 11. 风险与应对

| 风险 | 应对 |
|---|---|
| 用户把 P4 当成普通聊天模板 | 明确“测试”标识、隔离会话、显示预期和判定过程 |
| 自动发送让用户来不及观察 | Composer 可见填充、阶段提示、可取消窗口；提供“仅填入不发送”辅助选项，但正式测试必须发送 |
| YAML 变化导致 UI 崩溃 | 后端完整验证、last-known-good Catalog、结构化错误 |
| 语义判定不稳定 | 确定性断言优先、固定 Judge 配置、记录 Judge 版本；不可用时 blocked |
| 测试污染真实数据 | Fixture、隔离工作区、审批 Harness、路径白名单和副作用账本 |
| 多次点击重复发送 | 单飞锁、幂等 evaluation ID、发送 Command 去重 |
| Desktop 重启丢失状态 | Evaluation/Run 持久化，启动后恢复到 collecting/evaluating 或标记 interrupted |
| 案例过多导致右栏难用 | Suite、搜索、状态/标签过滤、虚拟列表和懒加载详情 |

## 12. Definition of Done

P4 完成需同时满足：

1. Desktop 右侧栏存在受 Feature Flag 控制的“回归测试”Tab。
2. UI 从 `p3-desktop` Suite 动态加载当前 12 项，新增或更新 YAML 不需要改前端代码。
3. 每项可展开查看输入、环境、预期输出、行为断言和最近结果。
4. “开始测试”可见地填充真实聊天框，并通过与人工操作相同的 Chat Command 发送一次。
5. 用户能观察 Agent 回复、工具、审批、产物和判定全过程。
6. Desktop Evaluation、Thread、Run、Case revision/hash 和输入摘要准确关联。
7. 现有回归引擎自动完成确定性、语义、媒体、证据和 UX 判定，UI 展示逐项预期与实际。
8. 每个终态均有 Result、Evidence Manifest 和必要的 Desktop 截图；失败可导航到聊天、Run 和调试。
9. 测试运行受隔离、权限、审批、幂等和目录安全约束，不污染真实用户数据。
10. 12 个案例均能从 P4 UI 完成一次真实运行并满足各自验收要求。
11. P1、P2、P3 和 P4 的自动门禁全部通过，真实 Desktop 验收报告写入 docs。
