# 案例 8：根据 Desktop 截图诊断 Agent Runtime 授权失败

## 身份与目的

- Case ID：`image.input.ui_error`
- Revision：2
- 目的：验证图片确实进入模型，Agent 能理解 OpenDrSai Desktop 运行诊断界面、提取关键事实、区分诊断与未知信息，并避免用文件名或隐藏 OCR 答案通过。

## 基准图片

使用用户提供的真实 OpenDrSai Desktop 截图，原样保存卡通头像。图片为 1598×1021 PNG，SHA-256 为 `b3742a0f7997e8ef07fdba9fee167a4141088b5da779cc08056ae82c333e7919`。运行时将附件重命名为无语义的 `attachment-01.png`，不暴露源码资产名或本地路径。

## Codex 基准分析

截图显示用户在 `hello` 会话发送 `hello`，OpenDrSai Runtime 在少于一秒内停止；右侧为“调试 → 运行诊断 → Agent”。当前 Agent 状态失败，错误为 `model_unauthorized`，消息为 `A valid HepAI identity is required.`，Backend 为 `my-drsai`，模型为 `deepseek-v4-pro`，连接已断开，来源显示 `runtime-engine · chat.run · 2×`。

`2×` 只表示同类诊断事件计数，不能断言发出了两次真实模型请求。Run ID、部分影响字段、源码位置和诊断文字在截图中被截断；运行信息包含 `[REDACTED]`。不能恢复完整 Run ID 或被隐藏内容。

## 诊断与建议边界

合理结论是 Agent Runtime 执行 `chat.run` 时缺少有效 HepAI 身份或模型授权，导致运行失败。优先建议检查/重建 HepAI 登录身份、确认该身份拥有所选模型权限，再使用重新运行入口。

输入第 3 问同时询问优先检查项和身份恢复后的动作，使“恢复后重新运行”这一验收要求由用户意图直接触发，避免用未在输入中提出的建议项评价 Agent。

截图不能证明 API Key 或 Token 已过期、余额不足、服务宕机、网络失败、模型不存在、Backend 配置错误或 Desktop 崩溃。可以把“检查身份是否过期”作为可能的排查动作，但不能断言其已经过期。

## 输入完整性

Manifest 必须记录图片 MIME、尺寸和 SHA-256；OAEP User Message 必须包含 Image Part；附件必须关联本次 Run。测试框架不得把 OCR 文本拼入 Prompt。图片没有进入模型、但回答通过文件名猜中时属于 `test_integrity_failed`。

## 行为与验收

禁用网络、知识库和图片生成，不调用 Tool/Skill、不审批、不写入、不产生 Artifact。输出必须识别运行失败、错误类型、消息、Backend 和模型；给出身份、权限和重新运行建议；明确说明脱敏、截断和具体根因不可确认。缺少图片证据为 `input_pipeline_failed` 或 `incomplete_evidence`，模型识别或边界错误为 `assertion_failed`。
