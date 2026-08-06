# 案例 4：网络搜索工具临时失败后恢复

## 身份与目的

- Case ID：`tool.failure.recovery`
- Revision：1
- 目的：单独验证 Runtime 对可重试 Tool 错误的有限恢复，不重复验证真实互联网。

## 方案取舍

采用受控方案 B。Agent 看到正常的 `web_search` 定义；测试环境在 Tool Dispatcher 与 Handler 之间、仅对当前 Case 注入第一次 `service_unavailable`。Runtime Policy 自动重试一次，第二次返回固定 Fixture，不访问真实网络。

这里是一个逻辑 Tool Call、两个底层 Tool Attempt。不能把 Runtime 重试误记为 Agent 主动调用两次。未来另建案例验证 Agent 面对不可恢复错误时自主改换方案。

## 固定结果

Fixture 声明虚构测试活动 OpenDrSai Developer Summit 2026 于 2026-09-10 至 09-11 在上海举行，主题包括 Agent Runtime、OAEP 和 Tool Safety。保留域名 `regression.test` 明确其不是现实公开活动。

## 过程与禁止行为

首次 Attempt 必须失败且标记可重试；第二次成功后停止。禁止第三次尝试、并行重复搜索、真实联网、外部写入、审批、Artifact、内部堆栈泄露和失败后编造答案。成功不能覆盖首次失败证据。

## 验收

Run 完成；一个逻辑调用、两个有序 Attempt；重试发起者为 `runtime_policy`；回答准确使用固定结果；OAEP/Inspection 同时保留失败与成功证据。所有断言为确定性断言。
