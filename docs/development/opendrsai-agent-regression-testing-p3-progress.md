# OpenDrSai P3 Desktop 验收进度

状态：进行中。本文只记录已观察到的真实 Desktop 结果；`passed` 必须同时具备 UI、Run/Manifest/OAEP 与所有 P1/P3 断言，不能由 Gateway 调用替代。

## 已完成的基础设施

- 新增 `p3-desktop` Suite，串行覆盖 P1 的 12 个代表 Case。
- `desktop-run` 通过 Electron E2E 操作真实 OpenDrSai-Dev：填写可见聊天输入框、点击发送、等待终态、保存窗口截图，并记录窗口 PID、会话、Run、输入与截图摘要。
- 在 UI 出现结构化最终回答后，Electron 会在同一 Run 存活期间分页读取该 Run 的 Inspection、OAEP Snapshot 与 Reproduction Manifest；游标不前进、重复 Item 或 Snapshot checkpoint 改变均会使采集失败。原始响应只存为临时文件供断言器读取，随后立即删除；最终报告仅保留脱敏摘要。
- UI-only 结果会明确标记为 `inconclusive`；若 UI 输出本身违反 Case 输出契约则标记为 `failed`。尚缺 Run/Manifest/OAEP 时绝不标记 `passed`。
- 已验证 UTF-8 输入、空白规范化后的可见用户消息匹配，以及仅接受结构化“最终回答”层，避免把“正在连接”进度卡误当结果。
- 模型验证因身份失效时，Runner 现分类为 `desktop_ui_model_verification_requires_login`，不会用笼统的 Electron 退出错误掩盖用户可执行的恢复步骤。

## 真实 Desktop 执行记录

| 执行 | Case | UI 结果 | 结论 |
|---|---|---|---|
| `p3-hello-6` | `qa.greeting.hello` | 用户消息、最终回答、Run 和会话均可见；已保存截图 | UI 链路通过，但尚未绑定 Manifest/OAEP，不能作为全量验收通过 |
| `p3-json-1` | `qa.constraints.json` | 截图中用户消息和 JSON 回答可见 | 旧探针按原始换行匹配用户消息，造成误报；已修复 |
| `p3-json-2` | `qa.constraints.json` | 用户消息、Run、会话可见；界面显示“需要验证模型连接”与进行中状态 | 阻断：模型连接未验证。旧探针把进度卡当结果，已修复为只接受“最终回答”层 |
| `p3-model-verify-1..3` | `qa.greeting.hello` | 已从可见 Operational State 控件点击“验证模型连接” | 阻断升级为身份状态：本地遥测记录模型目录为 `requires_login`；需要重新登录后才可完成最小模型调用 |

证据位于 `tmp/eval-results/p3-desktop/<execution-id>/desktop-evidence/<case-id>/`；每个目录包含 `ui-final.png`、`electron-result.json` 与不含原文的 `run-summary.json`。

## 后续验收门槛

1. 在 Desktop 完成 HAI 重新登录，再配置并验证可用的模型连接。已只读确认 `C:\\Users\\win11\\.drsai-dev\\config.toml.last-good` 存在，记录的是 `zhizengzeng / deepseek-v4-pro`；当前运行时模型目录报告 `requires_login`。登录成功后应从 Desktop 的“模型配置诊断与恢复”界面恢复或重新验证，不能伪造通过状态。
2. 从 UI 收集对应 Run 的 Manifest、Inspection 与 OAEP 摘要，并核验会话、时间窗口与输入摘要关联。
3. 为附件、审批、产物预览和 Run 比较加入各 Case 的实际 UI 交互。
4. 逐项重跑 12 个 Case；只有全部业务、行为、UX 和截图断言成功，才生成 `opendrsai-agent-regression-testing-p3-real-acceptance.md`。
