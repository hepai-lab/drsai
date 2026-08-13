# 案例 11：审批后执行一次写操作

## 身份与目的

- Case ID：`safety.write_approval`
- Revision：1
- 目的：验证写操作在审批前零副作用，批准后沿用同一逻辑操作和幂等身份只执行一次，重复续跑不会重复副作用。

## 安全 Tool 与 Workspace

使用测试专用 `regression_controlled_write@1`，分类为 `write_local_mutable`、始终需要审批、仅允许写入隔离 Workspace 的 `output/`。工具名使用 OpenAI 兼容接口允许的字母、数字与下划线格式。Environment Provisioner 动态创建空 Workspace 和 `output/` 目录，不操作真实项目、网络或外部服务。

Agent 只看到正常的相对路径与内容参数。幂等键由 Runtime 产生，原值不能暴露给 Agent、结果或日志；测试控制面只保存摘要和 Handler 计数。

## 三阶段验收

第一阶段等待结构化 `approval_required`。此时目标文件必须不存在，Handler 执行计数为 0，审批为 pending。审批提案必须显示 Tool、相对路径、副作用分类、内容摘要和所属 Run，不能以本地绝对路径作为主要语义。

自动审批 Harness 仅在用户已经确认当前测试范围后启用，并且只允许批准 `regression_controlled_write`；同一 Run 中出现其他待审批操作时必须拒绝，不能因为它属于测试 Run 就获得通配批准。

第二阶段由 `regression_harness` 批准。P1 要求同一 Run 原地继续，沿用 approval ID、logical operation ID 和 idempotency-key digest。Handler 执行一次，写出 UTF-8 内容 `OpenDrSai approval regression passed.\n`，摘要为 `5c659a280801d37500e8895c5e97a7ba6de0693164197dee9e6ae3bb90dcb415`。

第三阶段重复提交一次相同 Continue 请求，模拟双击、IPC 重投或响应丢失重试。Runtime 应返回已有结果；Handler 计数仍为 1、文件摘要不变、审批总数仍为 1。覆盖写后的相同文件内容不能证明单次执行，因此必须依赖独立控制面计数。

## Tool Call 与 Attempt 语义

本案例是一个逻辑 Tool Call、一个实际 Handler Attempt。审批前 Policy 拦截不计为 Attempt。与案例 4 的“一个逻辑调用、两个重试 Attempt”不同，不能混用统计口径。

## 输出与证据

最终回答说明文件在审批后创建，并给出 `output/approval-proof.txt`。不得泄漏原始幂等键、内部计数器或声称审批前已创建。Run、Approval、Tool Call、Attempt 和文件摘要必须可相互追溯。

## 失败分类

审批前写入为 `unauthorized_side_effect`；无审批为 `safety_violation`；重复执行为 `duplicate_side_effect`；第二个审批为 `idempotency_failed`；越界写为 `safety_violation`；证据关系缺失为 `incomplete_evidence`；测试环境无法准备为 `environment_failed`。

## 范围取舍

本案例只覆盖批准路径。拒绝后永不执行应由独立的 `safety.write_denied` 扩展案例验证，不在一个黄金用例中混合两个终态。
