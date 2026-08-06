# LLM Space

## 项目卡

- 上游仓库：[deer-flow/llm-space](https://github.com/deer-flow/llm-space)
- 官方网站：[LLM Space](https://deer-flow.github.io/llm-space/)
- 许可证：[MIT](https://github.com/deer-flow/llm-space/blob/main/LICENSE)
- 调研日期：2026-08-04
- 调研版本：`v4.6.3`
- 对应提交：`839b632c1562a60bcb19f43b75af2c8b5f77cae6`
- 研究状态：`candidate`
- OpenDrSai 相关模块：`apps/desktop`、`eval`、Agent runtime 与事件协议

## 一句话结论

LLM Space 是一个本地优先的 Agent 桌面开发工作台，强项是把模型调用、工具调用和消息轨迹变成可观察、可编辑、可重放的实验；它适合作为 OpenDrSai 桌面调试与评测体验的设计参考，但不是自动 Prompt 优化、强化学习或模型权重微调框架。

## 项目定位

LLM Space 将一次 Agent 实验保存为 Thread。Thread 包含模型及参数、System Prompt、变量、工具、消息、Tool Call 结果、运行历史和人工评测。开发者可以逐步执行 ReAct Loop，也可以修改中间状态后从指定消息继续运行。

项目是 DeerFlow 的姊妹项目。上游称 DeerFlow 的各版本会使用 LLM Space 进行构建和调试。

## 重点能力

- 编辑和版本化 Prompt、System Message、工具与模型参数。
- 实时查看模型调用和工具执行。
- 从历史运行或指定消息重放 Agent。
- 单独执行某个 Tool Call，或并行执行多个待处理调用。
- 修改消息、Tool Call 参数和 Tool 返回结果以复现边界条件。
- 使用可复用 rubric 对两个运行进行人工评分和差异比较。
- 配置内置工具、Custom Function Tool 和 MCP 工具。
- 通过变量和模板复用实验内容。
- 将 Thread 生成可运行的 LangGraph Agent。
- 文件和 API Key 默认保存在本地。

## 当前判断

建议进入桌面端最小原型验证，但只参考交互范式和数据模型，不直接引入其完整代码或运行时。

OpenDrSai 已拥有自己的 BAMS 架构、AutoGen runtime、OAEP/relay 协议、桌面端和评测目录。更合适的方向，是让 OpenDrSai 原生运行事件支持类似 LLM Space 的轨迹检查、分支重放和对比评测，而不是增加另一套 Agent runtime。

源码级结论和具体落地方案见：

- [v4.6.3 源码审阅](./source-review.md)
- [OpenDrSai 集成实施方案](./implementation-plan.md)

## 来源

- [项目 README](https://github.com/deer-flow/llm-space/blob/v4.6.3/README.md)
- [快速入门](https://github.com/deer-flow/llm-space/blob/v4.6.3/docs/get-started.md)
- [核心概念](https://github.com/deer-flow/llm-space/blob/v4.6.3/docs/core-concepts.md)
- [用户手册索引](https://github.com/deer-flow/llm-space/blob/v4.6.3/docs/index.md)
- [Telemetry 说明](https://github.com/deer-flow/llm-space/blob/v4.6.3/TELEMETRY.md)
- [v4.6.3 Release](https://github.com/deer-flow/llm-space/releases/tag/v4.6.3)
