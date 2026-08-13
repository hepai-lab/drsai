# Desktop → DDF → Remote Agent 联调验收报告

更新时间：2026-07-29
目标智能体：`drsai_v3_test`
开发平台：`https://ai-dev.ihep.ac.cn/apiv2`

## TODO：跨入口工具审批通道

`DrSaiAssistant` 同时由 Desktop、TUI、WebUI 和 DDF 直连 Worker 等入口消费。目前只有部分 Runtime 路径会注入 `_tool_approval_handler`，并完整投影审批请求和审批结果。在所有受支持入口实现统一、可恢复的审批合同以前，无处理器按兼容模式默认放行；一旦入口安装了处理器，其决定仍然具有权威性，明确拒绝必须阻断执行。

- 定义与传输无关的审批端口，稳定绑定 run、tool call 和 approval 身份，并明确超时、取消和断线重连语义。
- 为 Desktop OAEP、TUI、WebUI 和 DDF 远程 Worker 补齐请求/决定双向投影及逐入口一致性测试。
- 外部写操作获批恢复执行前，补齐持久化副作用账本、幂等与重放保护。
- 所有入口都能声明并通过审批能力测试后，在各入口集成边界恢复“缺失审批能力即拒绝”，不要在共享 Agent 内核中假定某一种 UI。

## 当前结论

- F01–F20：20/20 已完成。
- T01–T35：自动化、组件和真实链路证据已覆盖。
- Gate A–F：协议与真实链路均通过；Gate F 20/20 无悬挂。
- 最终 Windows UI 复核已通过：真实 `tool start → result` 使用稳定 ID 原位更新，完成态与结果可见，无重复工具卡，loading 已停止。
- 综合完成度：100%。

## 网络与配置

- worker Pod 独立地址：`http://10.5.8.180:42810/apiv2`。
- DDF → worker `/health`：HTTP 200；无需 NodePort 或 SSH 反向隧道。
- Development Desktop 使用 `portal_url` 和 `base_url` 指向 ai-dev。
- DDF heartbeat TTL fencing 默认 180 秒；过期 worker 不进入目录可用态或调度。

## Gate 结果

| Gate | 结果 | 主要证据 |
|---|---|---|
| A 目录合同 | PASS | 唯一公开 DTO；4 个中英文案例；敏感字段过滤 |
| B Worker 黄金流 | PASS | 19 项 worker 测试；status/step/tool/terminal/cancel 合同 |
| C DDF 转发 | PASS | 字段透传、SSE 原序转发、结构化错误、幂等、取消 |
| D Desktop 解析 | PASS | catalog、route、SSE、step/tool、error 合同测试及类型检查 |
| E 真实开发环境 | PASS | 目录、流式文本、多轮、幂等、工具、三端取消 |
| F 回归 | PASS | 20 请求、20 completed、20 唯一 invoke、无异常或迟到 |

## 关键真实链路证据

### 目录与示例

- `drsai_v3_test` 恰好 1 条且 `available=true`。
- capabilities 4 项，`examples.zh=4`、`examples.en=4`。
- Windows UI 已目视确认 4 个专属中文案例；点击案例只填充，不自动发送。
- DTO 未包含 worker URL、地址、token、secret、config 或 prompt。

### 流式过程与终态

- Desktop live smoke：HTTP 200，SSE 增量到达，status 与完整 step 生命周期存在。
- 一次增强 smoke：首事件 379ms，总时长 45.349s，216,594 bytes，4 个完成步骤，terminal 与 `[DONE]` 均存在。
- Windows UI 已目视确认真实过程文本、步骤表和最终结果，结束后 loading 停止。

### 真实只读工具

精确提示：

```text
请运行只读 Worker 健康检查工具。
```

真实链路结果：

- HTTP 200，首事件 264ms，总时长 302ms。
- 稳定 ID：`tool-worker-health-0001`。
- 生命周期：`start:in_progress → result:completed`。
- 结果：`{"status":"ok","agent":"drsai_v3_test"}`。
- terminal 与 `[DONE]` 均存在。
- Desktop parser 的真实事件形状测试和 renderer 时间线合同通过。
- Windows UI 真实复核通过：`Worker health check` 与 `Tool: worker_health_check` 均显示“已完成”，结果显示 `{"status":"ok","agent":"drsai_v3_test"}`。
- 最终 UI request/run：`12fab664-e13d-404b-a22a-e37974e3b085`；thread：`thread-4587a315-6666-4772-99e1-b72388f41044`。
- 持久化结构化状态包含 2 个完成活动、稳定工具 ID `tool-worker-health-0001`、`protocolIssues=[]`，不存在 `No response content`。
- UI 证据截图：`docs/desktop/evidence/remote-agent-tool-card-pass-2026-07-29.png`。

### 多轮与幂等

- 同一 thread 的两轮请求保持相同 chat ID；第二轮能使用第一轮上下文。
- 相同 `Idempotency-Key` 与相同请求体：第二次重放字节完全一致，只产生 1 个 invoke。
- 相同 key、不同请求体：HTTP 409 `idempotency_conflict`。

### 三端取消

- request：`req-f8d31a5d42d344aa`
- invoke：`9734516`
- chat：`gate-e-cancel-final-closed-loop`
- 首帧后客户端主动断开；DDF 7.3ms 内记录 499，invoke 状态为 failed。
- DDF 约 176ms 后收到 worker `cancel_active_chat` HTTP 200、`cancelled=true`。
- 10 秒内无 completed、terminal 或迟到 content。
- worker 当前公开 health 计数无法与该轮建立可靠关联，因此不把“计数 +1”作为证据；取消 RPC 结果和无迟到行为是已确认事实。

### Gate F 20 轮

| 指标 | 结果 |
|---|---:|
| 匹配请求 | 20 |
| terminal completed | 20 |
| failed | 0 |
| cancelled / 499 | 0 |
| HTTP 500 / 503 | 0 / 0 |
| invoke / 唯一 invoke | 20 / 20 |
| 单 request 多 invoke | 0 |
| 重复计费迹象 | 0 |
| 10 秒迟到新增或晚终态 | 0 |

## F01–F20

F01 平台配置、F02 OIDC、F03 目录、F04 公开元数据、F05 专属案例、F06 路由模型、F07 会话映射、F08 字段透传、F09 首包、F10 文本增量、F11 状态、F12 阶段、F13 步骤生命周期、F14 工具活动、F15 文件产物、F16 成功终态、F17 结构化错误、F18 有界恢复、F19 用户取消、F20 多轮与幂等均为 PASS。

## T01–T35

T01–T35 均已有自动化、组件或真实链路证据。重点真实项包括：

- T02/T03/T07/T11/T12/T21：真实目录、案例、OIDC、会话映射、文本流和终态。
- T18：真实工具 start/result 全链路、Desktop parser/renderer 合同及最终 Windows UI 目视复核全部通过。
- T25/T28/T29：503 retryable、无候选与 upstream timeout。
- T30/T31：三端取消与迟到事件抑制。
- T32/T33：真实多轮和 DDF 幂等单次执行。
- T34/T35：脱敏关联 ID 与 DTO/cache/log 敏感字段检查。

## 日常验收命令

```powershell
cd apps\desktop\windows
npm run verify:remote-agent-contract

cd ..
npm run typecheck:windows

cd windows
.\scripts\verify-live-remote-agent.ps1 -Iterations 1 -Scenario tool
.\scripts\verify-live-remote-agent.ps1 -Iterations 20 -Scenario analysis
```

## 最终补充修复

- worker 工具事件允许空 `timestamp`；Desktop 在结构化活动边界生成有效 ISO 时间，避免 `invalid_event`。
- 结构化活动的 `turnId` 使用当前 turn 的规范 ID，避免状态合并错位。
- 首条消息含 CR/LF 或 Unicode 行分隔符时，renderer 与主进程持久化边界都会生成合法单行任务标题，不再以 `Thread title is invalid.` 中断远程请求。
- 工具活动可在没有正文 part 时独立渲染，完成结果直接展示在同一稳定 ID 卡片内。

## 完成声明

截至 2026-07-29，F01–F20、T01–T35 与 Gate A–F 均有自动化、组件、真实链路或 Windows UI 证据支持；联调方案要求的功能和验收项已全部完成。
