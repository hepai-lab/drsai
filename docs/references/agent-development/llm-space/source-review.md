# LLM Space v4.6.3 源码审阅

## 审阅范围

- 上游仓库：<https://github.com/deer-flow/llm-space>
- 固定版本：`v4.6.3`
- 完整提交：`839b632c1562a60bcb19f43b75af2c8b5f77cae6`
- 审阅日期：2026-08-04
- 本地研究副本：`tmp/references/llm-space/`，由根仓库的 `tmp/` 规则忽略，不提交 Git

复现源码副本：

```shell
git clone --depth 1 --branch v4.6.3 \
  https://github.com/deer-flow/llm-space.git \
  tmp/references/llm-space
```

本次只进行静态源码审阅，没有安装依赖、启动应用或调用外部模型。

## 1. Thread 与持久化模型

核心类型定义位于上游 [`packages/core/src/types/threads/thread.ts`](https://github.com/deer-flow/llm-space/blob/839b632c1562a60bcb19f43b75af2c8b5f77cae6/packages/core/src/types/threads/thread.ts)。

Thread 主要持有：

- `model`
- `context.systemPrompt`
- `context.tools`
- `context.variables`
- `context.variableVariants`
- `context.snapshot`
- `context.messages`
- `runHistory`
- `evaluations`
- `evaluationRubrics`

源码为 Prompt 变量提供运行时 snapshot，并按稳定的 prompt place 保存已经使用过的变量值。这能避免旧对话前缀在变量改变后产生静默漂移，是值得借鉴的配置可复现设计。

`ThreadSnapshot` 明确排除 run history 和 evaluation metadata，避免历史递归嵌套。大图片在本地文件持久化时还会经过 blob table 去重。

## 2. Run History 的真实语义

实现位于：

- [`packages/core/src/thread/history.ts`](https://github.com/deer-flow/llm-space/blob/839b632c1562a60bcb19f43b75af2c8b5f77cae6/packages/core/src/thread/history.ts)
- [`packages/ui/src/components/thread-playground/stores/thread-store.ts`](https://github.com/deer-flow/llm-space/blob/839b632c1562a60bcb19f43b75af2c8b5f77cae6/packages/ui/src/components/thread-playground/stores/thread-store.ts)

关键行为：

1. `MAX_RUN_HISTORY = 20`。
2. 一条 RunSnapshot 保存稳定 ID、完成时间、去嵌套 ThreadSnapshot 和本次运行 usage。
3. Run 结束时只统计本次新增消息中的模型 usage。
4. 只有 `sawEvent && !failed` 才调用 `recordRun()`。
5. 运行前的 transport/auth/network 失败和运行中的模型失败不会作为失败快照进入 `runHistory`。

因此 Run History 更接近“最近成功实验快照”，而不是完整、可审计的运行历史。OpenDrSai 已有包含失败和取消状态的 append-only runtime events，不应退化成只保存成功结果。

## 3. Run From Message 与 Restore

`thread-store.ts` 中的 `run(fromMessageId)` 会：

1. 在当前消息数组中找到目标消息。
2. 用 `messages.slice(0, index + 1)` 截断后续消息。
3. 验证截断后的上下文。
4. 在当前 Thread 上继续流式运行。
5. 将截断和新生成消息合并为一个 undo step。

`restoreThread()` 则用一个历史 ThreadSnapshot 替换当前 Thread 内容，同时重新附加当前的 `runHistory`、`evaluations` 和 `evaluationRubrics`。

这是一种适合单机实验工作台的轻量实现，但不满足 OpenDrSai 对以下能力的要求：

- 原始运行不可变。
- 新运行具有独立 ID。
- 明确记录父运行、分叉事件和配置差异。
- 失败运行也保留证据。
- 工具副作用不会被无意重复。
- 多设备和远程 runtime 能对同一分支达成一致。

## 4. Tool Call 检查与执行

相关实现位于：

- [`packages/core/src/types/messages/tools.ts`](https://github.com/deer-flow/llm-space/blob/839b632c1562a60bcb19f43b75af2c8b5f77cae6/packages/core/src/types/messages/tools.ts)
- [`packages/ui/src/components/thread-playground/message/tool-call-list-item.tsx`](https://github.com/deer-flow/llm-space/blob/839b632c1562a60bcb19f43b75af2c8b5f77cae6/packages/ui/src/components/thread-playground/message/tool-call-list-item.tsx)
- [`packages/ui/src/components/thread-playground/message/use-tool-call-runner.ts`](https://github.com/deer-flow/llm-space/blob/839b632c1562a60bcb19f43b75af2c8b5f77cae6/packages/ui/src/components/thread-playground/message/use-tool-call-runner.ts)

ToolCall 的持久化结构较简单：`id + name + arguments + optional output`。Output 包含文本或图片内容以及 `isError`。

界面支持：

- 参数 JSON 预览与复制。
- 结果预览和文本编辑。
- 手工标记或清除错误。
- 单独执行一个可执行 Tool Call。
- ReAct 模式并行执行一组待处理 Tool Call。

自动执行会阻止检测为危险的 Bash 命令；Function stub 等不可执行工具会暂停循环等待人工结果。不过它没有通用的 `read_only / idempotent / side_effecting / forbidden` 工具分类。

OpenDrSai 已在 MCP bridge 中采用 at-most-once 恢复策略，并明确阻止无法查询 receipt 的通用 MCP Tool Call 自动重放。这一安全边界应优先于 LLM Space 的便捷执行行为。

## 5. Run Inspect 与 Trace

本地运行检查视图 [`run-trace-view.tsx`](https://github.com/deer-flow/llm-space/blob/839b632c1562a60bcb19f43b75af2c8b5f77cae6/packages/ui/src/components/thread-playground/run-trace-view.tsx) 实际展示的是只读 System Prompt、消息列表、模型标签、消息数和 usage。

上游另有独立的 Langfuse trace 导入和 workbench 实现，位于 [`packages/runtime/src/traces/trace-manager.ts`](https://github.com/deer-flow/llm-space/blob/839b632c1562a60bcb19f43b75af2c8b5f77cae6/packages/runtime/src/traces/trace-manager.ts)。它可以导入/同步 Langfuse observation，并投影为 Thread，但不等同于本地 Run History。

对 OpenDrSai 的启示是：运行检查器应直接建立在 OAEP/journal 权威事件上，不要同时维护“本地快照历史”和“外部 trace”两套互不一致的运行事实。

## 6. Evaluation 模型

评测类型和算法位于：

- [`packages/core/src/types/threads/thread.ts`](https://github.com/deer-flow/llm-space/blob/839b632c1562a60bcb19f43b75af2c8b5f77cae6/packages/core/src/types/threads/thread.ts)
- [`packages/core/src/thread/run-evaluation-utils.ts`](https://github.com/deer-flow/llm-space/blob/839b632c1562a60bcb19f43b75af2c8b5f77cae6/packages/core/src/thread/run-evaluation-utils.ts)
- [`packages/ui/src/components/thread-playground/run-evaluation-dialog.tsx`](https://github.com/deer-flow/llm-space/blob/839b632c1562a60bcb19f43b75af2c8b5f77cae6/packages/ui/src/components/thread-playground/run-evaluation-dialog.tsx)

实现特征：

- 每个 Thread 最多保存 20 个 rubric、50 个 evaluation。
- rubric 包含 2–6 个标准，并有 revision。
- 每个标准对每个 Run 评分 1–5。
- 保存 evaluation 时复制不可变 rubric snapshot。
- 计算 Run A、Run B 的未加权平均分和 `B - A`。
- verdict 独立保存，可为 left/right better、tie、pass 或 fail。
- A/B 顺序反转仍会更新同一比较记录，避免重复。

rubric snapshot 和稳定 Run ID 是值得保留的设计；Thread 文件内存储、固定未加权平均和纯人工输入则不宜成为 OpenDrSai 的最终评测架构。

## 7. 对三个目标的结论

| OpenDrSai 目标 | 可借鉴 | 不能照搬 |
| --- | --- | --- |
| 运行轨迹与 Tool Call 检查 | 可展开消息/工具、只读历史视图、参数和结果预览 | 只保存成功 ThreadSnapshot，缺少失败事件和审批证据 |
| 分支重放 | 从任意消息继续、恢复历史配置的交互入口 | 截断并覆盖当前 Thread，没有不可变分支和副作用模型 |
| A/B 评测 | 稳定 Run ID、rubric revision、不可变 rubric snapshot、方向无关配对 | 客户端文件存储、只支持人工 1–5 分、未接入批量 benchmark |
