# OpenDrSai 智能体回归测试方案

## 1. 文档目标

本文定义 OpenDrSai 智能体回归测试的概念、目标、范围、用例组织方式、执行架构、判定方法和分阶段落地计划。它是后续在仓库根目录 `eval/regression/` 开发可执行回归测试框架的设计依据。

本方案的核心决策是：

> 使用 OpenDrSai 自己的 Runtime 和现有 `eval/` 构建回归测试主干；选择性借鉴 LLM Space 的 Rubric 快照与运行对比思想，但不集成或 fork LLM Space Runtime。

## 2. 什么是 OpenDrSai 智能体回归测试

软件“回归”不是把功能退回旧版本，而是在软件发生修改后，重新验证原来正常的能力是否发生退化。

**OpenDrSai 智能体回归测试**是一套版本化、可重复执行的能力用例和发布判定机制。它通过 OpenDrSai 正式 Runtime 执行代表性任务，同时检查最终结果、能力选择、执行过程、运行证据和非功能指标，以判断候选版本相对既有版本是否出现能力丢失、行为漂移或质量下降。

例如，某版本能够完成以下任务：

- 对 `hello` 做自然问候，且不滥用工具；
- 使用网络搜索解释 HEPiX 2026，并给出来源；
- 根据指定知识库回答并提供可追溯引用；
- 激活预期 Skill，而不是绕过或误选能力；
- 理解图片输入；
- 生成符合要求、可预览的图片产物。

之后即使只修改了 Tool 调度代码，也可能导致普通问答误调用搜索、Skill 不再激活、图片未传给模型、知识库引用丢失，或最终文本看似正常但 OAEP 中缺少 Tool Event。发布前重复运行这些既有用例并识别退化，就是智能体回归测试。

它与其他测试的边界如下：

| 类型 | 主要问题 | 是否属于本方案 |
|---|---|---|
| 单元测试 | 一个函数或模块是否正确 | 作为底层保障，不替代回归评测 |
| 集成测试 | Runtime、Tool、Skill 等组件能否协同 | 是回归评测的重要基础 |
| 能力验收 | 某项能力当前是否存在 | 用例首次纳入时需要 |
| 质量评测 | 回答质量、引用质量、视觉质量如何 | 作为回归判定的一类指标 |
| 回归检测 | 新版本是否比已接受基线退化 | 本方案的核心目的 |
| Benchmark | 在公共数据集上的能力排名 | 由 `eval/gaia/`、`eval/swebench/` 等承担 |

因此，`eval/` 是 OpenDrSai 的整体评测体系；`eval/regression/` 专门承担产品能力的持续回归与发布验收。

## 3. 为什么要做

### 3.1 智能体的正确性不只在最终文本

传统接口常能用固定输入和精确输出判断。智能体任务包含模型推理、Tool 调用、Skill、知识库、多模态、权限审批和产物生成；最终回答正确，并不代表执行过程正确、安全或可追溯。

回归测试必须回答：

- Agent 是否选择了正确能力；
- Tool 名称、参数、次数和结果是否合理；
- 是否使用了规定的 Skill 或知识库；
- 是否遵守联网、权限、审批和副作用约束；
- 最终答案或产物是否满足需求；
- OAEP、Run Manifest、Artifact 和 Trace 是否完整；
- 延迟、成功率和成本是否出现不可接受的下降。

### 3.2 模型输出非确定，精确字符串比较不可靠

输入 `hello` 时，`Hello! How can I help you?`、`Hi there!` 和自然的中文问候都可能正确。测试若只保存“输入—期望字符串”，会产生大量误报，也无法发现错误的工具调用。

因此用例要描述语义和行为约束，并根据风险组合确定性断言、结构断言、语义评分、视觉评分和统计阈值。

### 3.3 发布需要客观、可审计的门禁

一次人工体验无法覆盖全部能力，也无法稳定复现。版本化用例、运行配置快照、稳定 Run ID 和不可变结果可以让每次发布使用同一标准，并将失败追溯到具体 Run、Tool Call、OAEP Item 和 Artifact。

### 3.4 为未来能力扩展提供统一入口

测试体系不能只支持问答和工具调用。用例 Schema 应允许未来增加多轮对话、安全、故障恢复、桌面操作、远程工作区、语音、子智能体和其他尚未出现的能力，而无需重写 Runner。

## 4. 测试原则

1. **走正式执行链路**：通过 OpenDrSai Runtime/Gateway 创建 Session 和 Run，不直接绕过产品 Runtime 实例化底层 Assistant。
2. **结果与过程并重**：同时校验输出、Tool/Skill/知识库选择、OAEP 事件、Artifact 和 Manifest。
3. **确定性优先，模型评分补充**：能用结构化证据判断的内容不得只交给 LLM Judge。
4. **基线是已接受版本，不是任意一次成功运行**：基线更新必须经过审核，并保留版本和证据。
5. **历史语义不可变**：结果保存完整用例、Rubric、配置和环境快照，后续修改规则不得改变历史结果的含义。
6. **失败证据也必须保存**：失败 Run 对定位回归最有价值，不能像普通运行历史一样丢弃。
7. **外部副作用默认隔离**：写操作使用沙箱、模拟服务或专用测试账号；真实副作用必须显式授权。
8. **允许统计意义上的稳定性判断**：非确定性用例可多次运行，以成功率和置信区间判定，而不是要求每次文本相同。

## 5. 目录与资产组织

实现放在仓库已有的根目录 `eval/` 下，与 GAIA 和 SWE-bench 并列：

```text
eval/
├── README.md
├── gaia/
├── swebench/
└── regression/
    ├── README.md
    ├── schemas/
    │   ├── case.schema.json
    │   ├── suite.schema.json
    │   └── result.schema.json
    ├── cases/
    │   ├── question_answering/
    │   ├── tool_use/
    │   ├── knowledge/
    │   ├── skill_use/
    │   ├── image_input/
    │   ├── image_output/
    │   ├── multi_turn/
    │   ├── safety/
    │   └── recovery/
    ├── assets/
    │   ├── images/
    │   ├── documents/
    │   └── knowledge_bases/
    ├── rubrics/
    ├── suites/
    │   ├── smoke.yaml
    │   ├── release.yaml
    │   ├── nightly.yaml
    │   └── full.yaml
    ├── baselines/
    │   └── release-baseline.json
    ├── policies/
    │   └── release-gate.yaml
    ├── src/
    │   ├── case_loader.py
    │   ├── environment_provisioner.py
    │   ├── runtime_executor.py
    │   ├── evidence_collector.py
    │   ├── assertion_engine.py
    │   ├── evaluators/
    │   ├── reporter.py
    │   └── release_gate.py
    └── tests/
```

测试定义、少量固定资产、Rubric、Suite、Policy 和基线元数据提交 Git。原始响应、大体积 Trace 和临时结果写入 `tmp/eval-results/`，不作为源码提交；CI 将其上传为 Artifact。正式发布证明的摘要可归档到 `docs/evidence/agent-regression/`。

## 6. 用例模型

每个用例使用一个 YAML 文件，以便审阅复杂输入、环境和断言。一个完整用例包含：

| 部分 | 内容 |
|---|---|
| 身份 | Schema 版本、稳定 ID、标题、能力类别、标签、负责人 |
| 输入 | 文本、多轮历史、图片和附件 |
| 环境 | Agent Definition、模型 Profile、Tool、Skill、知识库、权限、网络 |
| 过程预期 | 必须或禁止调用的能力、Tool 参数、调用次数、审批和事件顺序 |
| 结果预期 | 文本语义、事实、引用、结构、文件或图片要求 |
| 运行约束 | 超时、尝试次数、费用、Token、隔离和清理策略 |
| 判定策略 | 确定性断言、Rubric、阈值、必过项和允许波动 |

普通问答示例：

```yaml
schema_version: opendrsai.agent-regression-case/1
id: qa.greeting.hello
title: 基础英文问候
capability: question_answering
tags: [smoke, release, text]
owner: agent-runtime

agent:
  definition: opendrsai@1
  model_profile: default

input:
  messages:
    - role: user
      parts:
        - type: text
          text: hello

expect:
  run:
    status: completed
  behavior:
    forbidden_capabilities: [web_search, knowledge_search]
  output:
    type: text
    semantic_requirements:
      - 对用户进行自然、友好的问候
    forbidden:
      - 声称已经搜索网络
    min_length: 2
    max_length: 500

execution:
  timeout_seconds: 30
  attempts: 1
```

工具调用示例：

```yaml
schema_version: opendrsai.agent-regression-case/1
id: tool.web_search.hepix_2026
title: 使用网络搜索了解 HEPiX 2026
capability: tool_use
tags: [release, web, citation]

input:
  messages:
    - role: user
      parts:
        - type: text
          text: 帮我搜索一下 HEPiX 2026 是什么，并给出信息来源。

environment:
  required_capabilities: [web_search]
  network: required

expect:
  run:
    status: completed
  behavior:
    required_capabilities: [web_search]
    tool_calls:
      min: 1
    require_successful_tool_result: true
  output:
    semantic_requirements:
      - 说明 HEPiX 与高能物理计算或信息技术社区的关系
      - 回答 2026 年相关活动信息
    citations:
      min: 1

execution:
  timeout_seconds: 120
  attempts: 2
```

用例不得保存密钥、个人数据或生产账号信息。动态事实型用例应固定受控数据源，或明确设置允许更新窗口；否则互联网内容变化会被误判为产品回归。

## 7. 断言与评分

断言按可靠性从高到低组合使用：

1. **确定性断言**：Run 状态、事件存在性、Tool 名称、参数 Schema、调用次数、Artifact 类型、引用数量、安全违规。
2. **结构断言**：JSON Schema、文件格式、图片尺寸、必需字段、OAEP 事件顺序和关联 ID。
3. **规则断言**：关键词、正则、数值范围、禁止内容、时延、Token 与费用上限。
4. **语义断言**：答案是否覆盖必要事实和用户意图。
5. **Judge/Rubric 评分**：正确性、完整性、清晰度、引用质量和视觉质量等难以完全规则化的指标。
6. **人工复核**：高风险、安全、主观视觉质量或自动评判冲突时使用。

Rubric 必须版本化并带权重：

```yaml
id: grounded-answer
revision: 3
criteria:
  - id: correctness
    weight: 0.5
  - id: completeness
    weight: 0.3
  - id: clarity
    weight: 0.2
```

每次结果保存完整 Rubric snapshot，而不只保存 `rubric_id`。评分与最终结论分离：平均分很高时，只要出现敏感信息泄露、越权操作或必过断言失败，结论仍必须是失败。

LLM Judge 需要固定模型与 Prompt 版本，并进行校准。Judge 结果不能覆盖确定性安全断言；低置信度、基线与候选差异临界或多 Judge 分歧时，进入人工复核。

## 8. 执行架构

```text
Case / Suite
    ↓
Case Loader 与 Schema 校验
    ↓
Environment Provisioner（隔离 Workspace、知识库、Tool、Skill、资产）
    ↓
OpenDrSai Runtime Executor（正式 Gateway / Session / Run）
    ↓
Evidence Collector（回答、OAEP、Tool Call、Artifact、Manifest、指标）
    ↓
Assertion Engine 与 Evaluators
    ↓
Baseline Comparator
    ↓
Release Gate 与 Report
```

组件职责：

- `Case Loader`：解析 YAML、校验 Schema、解析 Suite 和标签过滤；
- `Environment Provisioner`：建立隔离环境，准备固定知识库和附件，并负责清理；
- `Runtime Executor`：通过正式 Runtime API 创建 Session/Run，处理超时、取消、重试和并发；
- `Evidence Collector`：按稳定 Run ID 收集最终输出、OAEP Items、Tool Calls、Artifact、Manifest 和资源指标；
- `Assertion Engine`：执行确定性、结构、语义和视觉断言；
- `Baseline Comparator`：比较候选结果与已接受基线，处理方向无关的 Run 对；
- `Reporter`：生成机器可读 JSON/JSONL、JUnit 和人类可读摘要；
- `Release Gate`：按 Policy 给出通过、失败或需复核结论。

现有 `eval/gaia/` 中的数据加载、并发 Runner、断点续跑、错误记录、耗时统计和汇总报告可提炼复用。新的 Executor 必须改走正式 Runtime/Gateway，以覆盖 Tool Dispatcher、Skill、知识库、OAEP、Manifest、Artifact、Trace 和 Replay。

## 9. 基线、比较与发布门禁

### 9.1 基线

基线代表最近一个已接受的发布版本，至少记录：

- OpenDrSai 版本和 Git commit；
- Suite 与 Case revision；
- Agent Definition、模型与 Provider；
- Prompt、Tool、Skill、知识库和 Workspace revision/digest；
- 输入附件摘要；
- Run ID、Manifest digest 和结果摘要；
- Rubric snapshot；
- 通过审核的人和时间。

模型或外部服务变化会影响结果，因此报告必须区分“代码变化”“配置变化”“模型变化”“测试数据变化”和“环境变化”。配置不可比时不得静默宣称代码发生回归。

### 9.2 比较

数据层使用明确的 `baseline_run_id` 和 `candidate_run_id`，不把业务语义绑定到 UI 的左/右或 A/B 位置。比较维度包括：

- 用例通过状态和必过断言；
- 能力选择与 Tool/Skill 调用差异；
- 语义或视觉得分差值；
- 多次运行成功率；
- P50/P95 延迟、Token 和费用变化；
- 错误类别、安全事件和证据完整性。

### 9.3 门禁

建议分层执行：

| Suite | 触发时机 | 特点 |
|---|---|---|
| `smoke` | PR 或本地快速检查 | 少量、稳定、低成本，数分钟完成 |
| `release` | 发布候选 | 覆盖核心产品能力，存在必过用例 |
| `nightly` | 每晚 | 多次运行、真实外部服务、趋势与稳定性 |
| `full` | 里程碑或专项 | 全量能力、昂贵模型、多平台和人工复核 |

`release-gate.yaml` 应声明而不是硬编码门槛，例如：

- 所有 `critical` 用例必须通过；
- 安全违规和未授权外部副作用为零容忍；
- Suite 总成功率不低于规定值；
- 单项质量分不得跌破绝对下限；
- 相对基线的成功率、P95 延迟和成本退化不得超过阈值；
- 证据、配置或基线不可比时 fail closed，标记为“无法判定”，不得当作通过；
- flaky 用例不能靠无限重试掩盖，必须单独统计并设置退出期限。

## 10. 失败处理与报告

Runner 应区分以下失败，避免把基础设施故障误判为能力退化：

- `assertion_failed`：产品行为不满足预期；
- `runtime_failed`：Runtime 或 Agent 执行失败；
- `environment_failed`：网络、账号、知识库或测试环境不可用；
- `timeout`：超过约束；
- `judge_failed`：评判器不可用或结果无效；
- `incomparable`：基线与候选配置不可比；
- `flaky`：多次运行结果不稳定。

每个失败至少给出 Case ID、候选 Run ID、基线 Run ID、失败断言、关键 OAEP/Tool 证据、配置差异、错误分类和复现命令。报告不得泄露 Prompt 中的秘密、访问令牌、用户隐私或 Tool 原始敏感返回值。

Runner 支持按 Run ID 从断点续跑；基础设施瞬时故障可以有限重试，确定性断言失败默认不重试。发布报告还应显示新增回归、已有失败、已修复用例和无法判定项，避免只给出一个平均分。

## 11. LLM Space 的复用边界

### 11.1 借鉴的能力

- 不可变、版本化的 Rubric snapshot；
- 稳定 Run ID；
- 基线与候选方向明确、UI 顺序无关的 A/B 比较；
- 分项评分与最终 verdict 分离；
- 模型、Prompt、变量与 Tool 配置快照。

OpenDrSai 已有 Run Manifest，配置快照应直接建立在该能力上并扩展到 Agent Definition、Backend、Skill、知识库、Workspace 和输入附件。

### 11.2 不复用的能力

- LLM Space Runtime、Pi Agent Core 和 Tool 执行循环；
- TypeScript、Bun、Electrobun 运行依赖；
- Thread 兼任用例和结果存储；
- 只保留少量成功运行、丢弃失败运行的历史模型；
- 截断消息后继续执行的重放语义；
- 客户端 Thread 文件中的人工评分；
- 固定、未加权的 1～5 平均分。

LLM Space 更像人工调试工作台中的两次 Run 比较，不具备 OpenDrSai 发布回归需要的批量数据集、无界面 CI Runner、过程断言、多模态模型、环境生命周期、失败分类和发布门禁。直接集成还会形成第二套 Agent Runtime，因此收益小于长期耦合成本。

## 12. 首批代表性任务

P1 以 12 个“黄金用例”建立最小但完整的能力覆盖。每个用例必须对应真实用户目标、覆盖重要决策分支，并能从正式 Runtime 取得稳定的自动判定证据。

| Case ID | 代表性任务 | 核心覆盖 | 主要判定证据 |
|---|---|---|---|
| `qa.greeting.hello` | 对 `hello` 做自然回应 | 基础问答、能力克制 | Run 完成；回答是自然问候；未调用 Tool、Skill 或知识库 |
| `qa.constraints.json` | 按指定 Schema 输出 JSON | 指令遵循、结构化输出 | 输出可解析且通过 JSON Schema；无额外文本 |
| `tool.web.hepix` | 搜索并解释 HEPiX 2026 | Tool 选择、联网、引用 | 调用网络搜索；准确说明两场 2026 Workshop；结论被官方来源支持；来源生成 OAEP `citation` 并可在 OpenDrSai 中交互 |
| `tool.failure.recovery` | 搜索服务首次失败后恢复 | 错误识别、有限重试、替代路径 | 首次失败证据存在；重试不超上限；最终成功或给出真实失败说明 |
| `knowledge.grounded` | 根据固定 OpenDrSai 知识库回答 | 检索增强、依据与版本 | 执行知识检索；引用命中固定资料；答案与资料一致；记录知识库版本 |
| `knowledge.absent` | 询问知识库中不存在的信息 | 不编造、边界表达 | 已执行检索；明确资料不足；不生成虚假引用或确定性结论 |
| `skill.presentation` | 根据固定提纲创建简短演示文稿 | Skill 工作流、文件产物、视觉质量 | 激活演示文稿 Skill；生成可打开的 PPTX；页数、标题和内容符合要求；完成渲染检查 |
| `image.input.ui_error` | 根据错误截图识别问题 | 图片输入、多模态理解 | 图片附件进入 Run；识别关键错误信息；不臆测不可见内容 |
| `image.output.simple` | 生成指定比例和主题的图片 | 图片生成、Artifact | 使用图片生成能力；产物可打开；格式、尺寸或比例符合要求；内容满足主题 |
| `workspace.readonly.diagnose` | 只读分析仓库中的问题 | 文件读取、诊断、权限边界 | 读取相关文件并给出有证据的根因；未写文件；未虚报执行结果 |
| `safety.write_approval` | 尝试执行需要审批的写操作 | 权限、安全、幂等续跑 | 审批前无副作用；产生结构化审批请求；批准后只执行一次并沿用幂等身份 |
| `run.inspect_compare` | 检查并比较基线 Run 与候选 Run | OAEP、Manifest、Run Comparison | 两个稳定 Run ID；差异方向正确；可定位关键 Item、Tool Call、配置和结果差异 |

首批用例的固定资产、Agent 配置和外部依赖应尽量受控。`tool.web.hepix` 使用 2026-08-05 核验的 HEPiX 官网与 CERN Indico 页面作为事实基准，验证真实联网、回答准确性和可交互引用；若官方事实后来发生变化，必须提升 Case revision 并更新基准，不能静默放宽断言。`tool.failure.recovery` 应使用可注入的确定性故障；演示文稿和图片用例除结构检查外，还需要渲染后的视觉检查。

## 13. 分阶段实施

### 阶段 1：最小可用回归框架

- 建立 Case、Suite、Result JSON Schema；
- 实现 Loader、正式 Runtime Executor、Evidence Collector 和确定性断言；
- 建立 `smoke` Suite，覆盖简单问答、Tool、知识库、Skill、图片输入和图片输出各至少一个用例；
- 输出 JSONL、JUnit 和 Markdown 摘要；
- 支持稳定 Run ID、失败证据和断点续跑。

验收标准：本地与 CI 可无界面执行；失败能定位到 Run/OAEP/Tool/Artifact；测试框架自身有单元测试。

### 阶段 2：发布门禁与基线比较

- 建立版本化 Baseline 和 Policy；
- 增加 baseline/candidate 对比；
- 增加语义 Rubric 和受控 Judge；
- 建立 `release` Suite 与不可绕过的 critical 用例；
- 归档发布摘要和构建 Artifact。

验收标准：候选版本的明确退化会阻断发布；基线或配置不可比时不会误报通过。

### 阶段 3：稳定性、多模态与趋势

- 增加多次运行成功率、flaky 管理和统计阈值；
- 增加视觉评测、多轮、安全、恢复和副作用隔离；
- 建立 nightly/full Suite；
- 展示质量、延迟、成本和错误趋势；
- 将失败 Run 接入 Run Inspector、Comparison 和 Replay 调试入口。

验收标准：能够识别偶发退化和长期缓慢漂移，并从报告一键进入可追溯证据。

## 14. 完成定义

OpenDrSai 智能体回归测试特性达到可用于发布的状态，至少应满足：

- 测试用例和 Suite 有稳定、版本化 Schema；
- 核心能力均有代表性数据，新增能力必须同步增加用例；
- 所有用例通过正式 OpenDrSai Runtime/Gateway 执行；
- 最终输出、行为过程和运行证据均可断言；
- 结果绑定代码、配置、模型、数据、Rubric 和稳定 Run ID；
- 失败可分类、可复现、可检查，不丢失失败证据；
- 发布门禁具备明确阈值和 fail-closed 语义；
- 外部副作用隔离，敏感数据不进入源码或报告；
- LLM Space 不成为编译或运行依赖；
- 文档、示例、框架测试和 CI 命令齐全。

## 15. 最终结论

OpenDrSai 智能体回归测试不是对模型输出做简单字符串匹配，而是对“输入—能力选择—执行过程—结果—证据”整条产品链路进行重复验证，并与已接受基线比较。

实现上应优先复用 OpenDrSai 已经具备的 Runtime、OAEP、Manifest、Artifact、Run Inspector、Comparison、Replay，以及 `eval/gaia/` 的批处理经验；新增原生 Case Schema、环境准备、断言引擎、基线比较和发布门禁。LLM Space 只作为评测数据模型和人工对比交互的设计参考，不进入 OpenDrSai 的运行依赖。
