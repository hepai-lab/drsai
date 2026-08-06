# LLM Space 分析

## 核心工作模型

LLM Space 的基本单元是 Thread，可视为一个持久化的 Agent 实验文件。它把输入、配置、执行轨迹和评测结果放在同一上下文中：

```text
Thread
├── Model 与运行参数
├── System Prompt 与变量
├── Tools 与 MCP 配置
├── User / Assistant Messages
├── Tool Calls 与 Tool Results
├── Run History
└── Evaluations
```

这种模型的主要价值不是“让 Agent 跑起来”，而是保留足够证据回答：哪一步发生了什么、为什么失败、修改哪个变量后结果发生了怎样的变化。

## 调试与调优能力

| 对象 | 能力 | 判断 |
| --- | --- | --- |
| System Prompt | 编辑、保存、重放 | 强 |
| 模型与参数 | 切换 provider/model，修改 temperature、max tokens、reasoning effort 等 | 强 |
| 工具集合 | 调整工具定义并观察模型决策变化 | 强 |
| Tool Call | 检查和修改调用参数，单独或批量执行 | 强 |
| Tool Result | 修改返回结果以模拟失败与边界情况 | 强 |
| Agent 轨迹 | 单步执行、自动 ReAct、从消息继续运行 | 强 |
| 运行对比 | 保存运行历史并比较 | 中等偏强 |
| 评测 | 2–6 项 rubric、1–5 分人工评分、计算差值 | 中等 |
| 自动 Prompt 搜索 | 未发现系统化优化循环 | 弱 |
| 权重训练或 RL | 不属于项目范围 | 不支持 |
| 生产监控 | 不是集中式线上可观测平台 | 弱 |

因此，“调优”主要是人工参与的 harness optimization，而不是自动训练。

## 源码核对后的关键修正

对 `v4.6.3` 源码进行核对后，需要对产品描述作以下更精确的解释：

- `runHistory` 不是完整事件日志，而是一次成功运行结束时保存的去嵌套 `ThreadSnapshot`；默认最多保留 20 条。
- 当前实现只有在运行产生事件且未失败时才写入 `runHistory`。模型或执行失败的运行不会进入这套历史，因而它不能替代故障事件日志。
- “Run from this message” 会截断当前消息数组，再在同一个 Thread 上继续运行。它不是不可变的父子分支，也没有保存明确的 fork point。
- “Restore run” 会将旧 ThreadSnapshot 恢复成当前 Thread，同时继续携带当前的 run history 和 evaluations；它不是基于事件日志重建新 Run。
- Tool Call 的参数和返回值可查看，返回值可编辑；可执行工具可以单独运行，自动 ReAct 模式还会并行执行一组待处理 Tool Call。
- 自动执行对一部分危险 Bash 命令有前置阻断，但没有通用、跨工具的幂等性和副作用分类模型。
- rubric 评测是 Thread 文件中的本地人工 A/B 记录，不是批量评测服务或 CI 门禁。
- 项目另有 Langfuse trace 导入能力，但它与本地 `runHistory` 是两条不同的数据链。

这些限制不削弱其交互设计的参考价值，但说明 OpenDrSai 不应直接复制其存储与重放语义。

## 评测机制

上游文档描述的评测是两个持久化运行之间的比较。一个 rubric 包含 2–6 个有序标准，每个运行在每个标准上获得 1–5 分，系统计算未加权平均分和 `B - A` 差值；最终 verdict 仍由人决定。

评测快照保存在本地 Thread JSON 中，不会为了评分再调用模型。这有利于可解释性和成本控制，但不适合直接替代批量 benchmark、LLM-as-judge、统计显著性分析或 CI 回归门禁。

## 技术栈

- TypeScript 与 Bun monorepo。
- Electrobun 桌面容器。
- React、Tailwind CSS 与 shadcn/ui。
- Pi Agent Core 作为轻量 Agent 框架。
- `packages/core` 保存共享类型、Agent loop 和 Thread storage。
- `apps/desktop` 提供桌面应用。

其核心数据和 UI 思路具有参考价值，但运行时与 OpenDrSai 当前的 Python、AutoGen、OAEP 和跨端体系并不相同。

## 成熟度信号

- 项目始于 2023 年，当前已到第四次主要迭代。
- 上游持续发布 v4.x 版本；本次调研固定在 v4.6.3。
- DeerFlow 团队声明其内部持续使用该工具。
- 采用 MIT 许可证。
- 上游当前只接受 DeerFlow 核心团队成员的 Pull Request，外部主要通过 Issue 贡献反馈。

快速迭代和内部使用是积极信号；贡献策略、格式稳定性和跨平台支持仍需在集成前验证。

## 平台限制

v4.6.3 的公开下载说明主要提供 macOS Apple Silicon 和 Intel 的 DMG。源码构建依赖 Bun 和 Electrobun。Windows 是否能达到正式支持水平，应以本地构建和运行验证为准，不应由源码存在推断为已支持。

## 隐私与遥测

上游声明 Thread、文件和 API Key 保存在本地。应用默认发送匿名行为遥测到 PostHog EU Cloud，包括应用版本、平台、模型运行结果、时长、消息数、工具数等。

上游明确声明不会发送 Prompt、消息正文、System Prompt、模型响应、工作区文件、API Key、Base URL 或请求头。遥测可以通过设置或 `LLM_SPACE_ANALYTICS_DISABLED=1` 关闭。

若借鉴其本地优先设计，OpenDrSai 仍应独立完成威胁模型、凭据存储、敏感事件脱敏和遥测 opt-in/opt-out 设计，不能直接继承上游结论。

## 优势

- Agent 中间状态可见且可编辑。
- 从失败位置重放，减少重复运行和 Token 成本。
- 工具调用调试体验集中，适合定位 schema、参数和返回值问题。
- Thread 文件模型便于复制实验和保留证据。
- 对产品经理、测试人员等非 runtime 开发者相对友好。

## 局限与风险

- 不是自动 Agent 优化器。
- 人工 rubric 难以覆盖大规模回归评测。
- 不等同于生产 tracing、告警或多租户评测平台。
- OpenDrSai 若直接引入其 runtime，会与现有架构形成重复抽象。
- 上游迭代较快，数据格式和接口兼容性需要持续确认。
- 官方二进制发行目前明显偏向 macOS。

## 尚待验证

- Thread JSON 的完整 schema 和版本迁移策略。
- LangGraph 导出的代码质量、可维护性和能力覆盖。
- MCP 的 transport、权限和错误恢复机制。
- 超长 Thread 的性能、压缩和存储表现。
- 多模态 Tool Result 的数据表达方式。
- 是否提供适合 CI 使用的无界面执行或评测接口。
- Windows 源码构建与运行状态。

已完成的源码证据索引见 [source-review.md](./source-review.md)。
