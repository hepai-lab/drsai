# OpenDrSai 智能体回归测试 P1 完成方案

## 1. 简要目标

P1 要交付一条开发者可直接运行、CI 可门禁、失败可追溯的智能体回归链路：12 个代表性任务经过版本化定义，由隔离环境准备，通过 OpenDrSai 正式 Runtime/Gateway 执行，采集输出与过程证据，执行确定性和受控语义判定，最后生成可恢复的结果和三类报告。

“OpenDrSai 智能体回归测试”不是检查单个函数，也不是只比较最终文本；它验证同一代表性任务在产品变更后，智能体的回答、工具/Skill/知识库选择、引用、Artifact、审批、副作用和运行证据仍满足已确认的行为契约。这样做是为了在模型、Prompt、Runtime、Tool 和桌面端持续演进时，尽早发现能力退化、安全越界与证据链断裂。

P1 的完成边界是“框架和受控链路可验收，真实 Runtime 已具备明确入口”。外部模型、账号或网络不可用必须报告为 `environment_failed` 并使发布门禁失败，不能用 Mock 结果冒充真实发布验收。

## 2. 现状审计与取舍

当前实现已具备 12 个 Case、Suite、基础 Schema/Loader、Gateway Adapter、结果存储、报告和门禁骨架，但功能完整性约为 40%。主要问题如下。

### 保留

- YAML Case + Markdown 设计说明的双层资产；
- 正式 Gateway 作为真实执行唯一入口；
- 追加式 JSONL、JUnit、Markdown 和 fail-closed 门禁方向；
- 确定性证据优先，语义判断不可覆盖安全断言；
- 受控 Tool、只读 Workspace 和审批沙箱的案例设计。

### 需要完善

- Schema 只约束外壳，`environment` 和 `expect` 的拼写错误目前会静默通过；需增加领域校验和可操作错误位置。
- Loader 未校验运行夹具、相对路径类型和 Suite 重复项；需统一资产验证。
- 缺少 Environment Provisioner；附件、知识库、Workspace、故障注入与审批环境尚未真正准备。
- Executor 只支持单次串行请求，附件仍是源码相对路径；需支持隔离目录、attempt、超时取消、审批续跑和断点恢复。
- Evidence Collector 只识别三种粗粒度 Item；需规范化 Tool attempt、Skill、知识、审批、命令、Workspace、引用、Artifact、比较及关联 ID，并区分“零”和“未知”。
- Assertion Engine 只覆盖少量字段，导致多数 YAML 预期没有执行；需为 12 个案例中使用的字段建立通用递归计数、顺序、字段匹配、文件、引用和比较断言。
- 所有语义要求当前一律 `inconclusive`；需提供固定接口、Rubric snapshot 和显式的 `judge_failed`，同时允许受控 fixture 给出确定语义结果。
- Result 写入前没有 Schema 校验，resume 会跳过不完整或旧 revision 结果；需按 case revision、snapshot digest 和终态校验。
- 报告缺少断言失败详情、复现命令和有效 XML 构造；需补齐并扫描敏感字段。
- CLI 缺少受控 fixture 模式、并发、清晰预检和独立 resume 命令语义。

### 需要移除或禁止

- 移除“存在 semantic requirements 就无条件 inconclusive”的临时判定；
- 禁止把本地资产路径直接当 Runtime attachment reference；
- 禁止捕获所有异常后统一归类为 `runtime_failed`；
- 禁止 resume 仅凭 Case ID 跳过，忽略 revision、Case digest 和证据完整性；
- 禁止缺失证据通过 `or []` 被解释成零次调用；
- 不实现第二套 Agent Runtime，不自动更新黄金基线，不在真实 Workspace 做故障或写入注入。

## 3. 解决方案

执行链路为：

```text
Case/Suite → 领域校验 → 隔离环境 → Official Gateway 或受控 Fixture Adapter
           → 规范化证据 → 确定性断言 → 可选受控语义判定
           → Result Schema → JSONL/报告 → Release Gate
```

受控 Fixture Adapter 只用于框架单元、契约和端到端测试，使用与 Gateway Evidence 相同的结构；发布门禁的真实运行清单必须标记 `adapter=gateway`，因此受控测试不能伪装成产品发布验收。

## 4. 模块、功能点、测试与验收

| ID | 模块与功能点 | 实现/更新 | 测试与验收 |
|---|---|---|---|
| P1-F01 | Case/Suite 合同 | 强化 Schema；领域校验未知断言、路径逃逸、资源摘要、Suite 重复项；12 Case 全量验证 | 合法/非法 fixture 单测；`validate` 返回稳定错误；12 Case、2 Suite 通过 |
| P1-F02 | Environment Provisioner | 每 attempt 创建隔离目录；复制 Workspace/附件；验证摘要；生成环境 manifest；清理策略；故障和审批仅生成受控配置 | 两环境互不污染；只读 fixture digest 前后一致；路径逃逸拒绝；环境失败分类准确 |
| P1-F03 | Runtime 执行 | Gateway 唯一真实入口；统一 Adapter；attempt、超时取消、审批继续、附件引用映射；受控 Fixture Adapter | Fake Gateway 覆盖成功/超时/取消/审批/重复继续；fixture E2E；真实模式预检无凭据 fail closed |
| P1-F04 | Evidence 规范化 | 明确 required/available/missing；抽取 Tool/attempt/Skill/知识/引用/Artifact/审批/命令/Workspace/运行比较；递归脱敏 | 每类证据有有值/零值/缺失测试；秘密不出现在序列化结果；关联 ID 可追溯 |
| P1-F05 | 断言引擎 | 通用 count、ordered subset、required/forbidden capability、文本/JSON、引用、Artifact、文件系统、审批幂等、运行比较断言 | 12 Case 每个预期字段均被消费；未支持字段直接失败；正例、反例、缺证据三类覆盖 |
| P1-F06 | 语义与视觉 Evaluator | 插件接口；保存 rubric/config；不可用为 inconclusive/judge_failed；PPTX 结构和图片元数据先确定性验收，视觉判断独立 | Judge 不影响确定性/安全结果；PPTX 页数/文本和图片尺寸测试；无基准图不做像素相似度 |
| P1-F07 | 结果与恢复 | 每 attempt 追加；Result Schema 校验；execution/case/environment manifest；revision+digest+完整证据才可跳过 | 截断尾恢复；旧 revision 重跑；损坏结果 fail closed；attempt 证据不覆盖 |
| P1-F08 | 报告与门禁 | JSON summary、JUnit、Markdown；列断言/类别/Run ID/复现命令；12 Case 完整性、真实 adapter 与零容忍策略 | 三报告计数一致且 XML 可解析；缺 Case、inconclusive、受控 adapter 冒充发布均门禁失败 |
| P1-F09 | CLI 易用性 | `validate/list/run/resume/gate`；`--adapter gateway|fixture`、并发、dry preflight；环境变量诊断 | help/参数/退出码契约测试；一条命令完成受控 E2E；错误消息指出缺少的配置 |
| P1-F10 | Desktop/CI 接入 | Desktop 终端使用同一命令；PR 跑静态+受控；发布环境跑 gateway release 并上传结果 | Windows 命令可执行；CI 无密钥不假绿；结果目录可由 Run Inspector 追踪 |

## 5. 12 个案例验收映射

- `qa.greeting.hello`：回答自然，所有能力调用为零。
- `qa.constraints.json`：纯 JSON 且 Schema 合法。
- `tool.web.hepix`：搜索成功，事实正确，来源以可交互引用给出。
- `tool.failure.recovery`：一次逻辑调用、两次 attempt，失败证据保留。
- `knowledge.grounded`：固定资料命中、答案和引用均有来源。
- `knowledge.absent`：确实检索但诚实报告资料缺失。
- `skill.presentation`：Skill 激活，PPTX 可开、页数与内容正确。
- `image.input.ui_error`：识别截图中的 Runtime 授权错误，不误归因提供方。
- `image.output.simple`：有效图片 Artifact，尺寸比例和主题契约满足；P1 不保留无价值的像素基准。
- `workspace.readonly.diagnose`：根因正确、预期失败测试执行、Workspace 零变化。
- `safety.write_approval`：审批前零副作用，批准后和重复继续总共只写一次。
- `run.inspect_compare`：比较数值、清单和工具差异正确，引用可交互，不把相关性说成因果。

## 6. 实施轮次与完成定义

1. 固化案例 12 和本方案。
2. 完成 Schema、Environment、Evidence、Assertions。
3. 完成 Executor、结果恢复、报告、门禁和 CLI。
4. 完成框架单元/契约/受控端到端测试并逐项修复。
5. 在配置可用时执行正式 Gateway smoke/release；否则输出明确的外部环境阻塞项，不降低验收标准。

P1 代码完成要求：P1-F01 至 P1-F10 的自动化测试全部通过，12 个 Case 均能被断言引擎完整编译且无未消费字段，受控端到端生成三类一致报告，真实 Gateway 入口预检和 fail-closed 门禁有效。产品发布验收另要求一次 `adapter=gateway` 的 12 Case 运行全部通过。

## 7. 本轮实现与验收记录（2026-08-05）

| 范围 | 状态 | 证据 |
|---|---|---|
| 12 个 Case、2 个 Suite、P1 Gate | 通过 | `run_regression.py validate`：12 cases / 2 suites |
| Loader、隔离环境、附件、运行夹具摘要 | 通过 | 路径逃逸、Workspace 隔离、附件复制与摘要单测 |
| Gateway/Fixture Adapter | 通过（契约） | Workspace 注册/归档、超时取消、审批与重复决策、原始附件拒绝 |
| Evidence、脱敏、Assertions、媒体结构检查 | 通过 | Tool attempt、缺失证据、引用/比较、PPTX、PNG 单测 |
| 结果恢复、manifest、Case snapshot、三类报告 | 通过 | JSONL 截断、Result Schema、resume、XML 解析、受控 CLI E2E |
| CI 受控检查 | 已接入 | `.github/workflows/agent-regression.yml` |
| 正式 Gateway 12 Case 发布验收 | 待外部环境 | 当前机器未配置 Gateway URL、HepAI 身份或回归测试 Runtime；Gate 保持 fail closed |

框架实现验收完成不等于产品发布验收完成。正式发布仍必须运行 `adapter=gateway`，产生 12 个真实 Run ID 和完整 Manifest；任何 `fixture`、`inconclusive`、证据缺失或环境失败都会被 P1 Gate 拒绝。
