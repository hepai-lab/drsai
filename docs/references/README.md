# OpenDrSai References

`docs/references/` 是 OpenDrSai 的外部项目研究与技术决策知识库，用于记录可能参考、适配或集成的仓库、工具、论文和协议。

这里保存的是经过整理的研究材料，不是第三方源码仓库，也不是 OpenDrSai 的正式实现目录。

## 目录边界

| 内容 | 存放位置 |
| --- | --- |
| 外部项目链接、分析、架构图和少量必要代码片段 | `docs/references/` |
| 临时克隆的完整外部仓库 | `tmp/references/`，不提交 Git |
| 需要随项目保存的外部或派生代码 | `misc/extend/` |
| 已正式吸收的产品实现 | 对应的 `apps/`、`cores/`、`skills/` 或 `eval/` |
| OpenDrSai 自身的正式设计和用户文档 | `docs/` 下对应主题目录 |

第三方完整源码默认不得复制到本目录。确需保存代码时，应先确认许可证、上游版本、维护方式和安全扫描边界。

## 分类

- `agent-development/`：Agent 构建、调试和开发工作台。
- `agent-optimization/`：Prompt、Skill、轨迹或模型优化工具。
- `evaluation/`：评测、基准和回归测试。
- `memory/`：上下文、记忆和知识管理。
- `observability/`：Tracing、监控和运行分析。
- `runtimes/`：Agent runtime、协议和执行环境。
- `user-interfaces/`：桌面端、Web、TUI 和交互范式。

一个项目可以关联多个分类，但只选择一个主目录，其他分类通过 `catalog.yaml` 中的标签表达，避免重复维护。

## 项目材料规范

每个项目使用稳定、全小写的目录名，例如：

```text
docs/references/agent-development/llm-space/
```

至少包含：

- `README.md`：项目卡、来源、版本、许可证和结论。
- `analysis.md`：能力、架构、成熟度、限制和风险分析。
- `inspirations.md`：对 OpenDrSai 的可借鉴设计。
- `integration.md`：候选集成点、路径、成本和决策条件。

可选包含：

- `links.md`：文档、论文、Issue、讨论和相关项目。
- `artifacts/`：小型截图、图表或合规的研究附件。

新项目可从 [`_template/`](./_template/) 复制。所有项目还必须登记到 [`catalog.yaml`](./catalog.yaml)。

## 研究状态

- `discovered`：已发现，尚未系统评估。
- `researching`：正在分析或验证。
- `candidate`：值得进行原型验证。
- `adopted`：部分能力已被 OpenDrSai 正式采用。
- `watching`：暂不集成，持续观察。
- `rejected`：当前不采用，并记录原因。
- `archived`：上游停止维护或研究材料已失效。

状态只描述 OpenDrSai 的内部判断，不代表对外部项目质量的绝对评价。

## 更新与引用规则

1. 记录上游仓库的规范 URL、许可证、调研日期和已检查的 tag 或 commit SHA。
2. 区分“上游明确声明”“本地验证结果”和“研究者推断”，不要把推断写成事实。
3. 重要结论尽量链接到上游 README、文档、源码或 Issue。
4. 不提交 API Key、访问令牌、个人数据、内部服务地址或受限材料。
5. 不大段复制上游文档；优先概括并链接来源。
6. 引用代码时保持最小范围，并注明文件、版本和许可证。
7. 项目发生重要版本变化、进入集成阶段或结论改变时，更新 `reviewed_at` 和 `reviewed_revision`。
8. 正式集成后，在项目材料中链接 OpenDrSai 的实现位置和设计决策，但不要把本目录变成第二份实现文档。

## 推荐研究流程

```text
发现项目 → 登记 catalog → 固定上游版本 → 能力与风险分析
         → 提炼启发 → 设计最小原型 → 决定采用、观察或拒绝
```

