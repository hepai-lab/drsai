# OpenDrSai 回归测试 P2 实施进展

更新时间：2026-08-06

## 当前结论

P2 的操作级路由、五模型 Profile、流式/非流式协议 Adapter、能力探针、快照、CLI、Desktop 状态、报告、P2 Gate、图片理解预处理链和 P1 Runner 预检已经实现并完成真实验收。用户显式将图片理解角色改绑为 `gpt-5.6-luna` 后，Responses 图片理解、结构化函数探针和正式 Runtime 均通过。当前 5 个模型、8 个必验 operation 全部具备真实 Provider 证据，7 个产品 Runtime 必验 operation 全部具备 Run/operation 证据，P2 Gate 为 `PASS`，可以进入下一阶段 12 项正式回归。

## 功能台账

| 功能 | 状态 | 验收证据 |
|---|---|---|
| P2-F01 操作级路由合同 | 已完成 | 路由单测；五模型 Profile |
| P2-F02 Agent 精确模型/凭据解析 | 已完成 | 无全局模型回退、角色不匹配和缺凭据反例 |
| P2-F03 Responses Adapter | 已完成并真实验收 | 非流式/流式合同；`deepseek-v4-flash` 文本、推理、工具真实通过 |
| P2-F04 Chat Adapter 收敛 | 已完成 | 非流式/流式统一结果、工具 delta 拼接与推理脱敏测试 |
| P2-F05 多模态 Adapter | 已完成并真实验收 | Luna Responses `input_image` 与工具调用；Gemini 图片输入、函数、混合图片输出契约测试 |
| P2-F06 图片 Runtime | 已完成并真实验收 | 修复真实工具注册元数据缺失和 start-before-approval 账本顺序；正式 Run 完成且产生 1 个 Artifact |
| P2-F07 音频 Runtime | 已完成并真实验收 | 正式 TTS→STT 产品接口闭环通过，临时媒体已删除 |
| P2-F08 能力探针 | 已完成同步最小探针 | 七类 operation、确定性断言、稳定错误码测试 |
| P2-F09 快照与失效 | 已完成 P2 所需核心 | 稳定 digest、原子写、时效 Gate |
| P2-F10 正式 Runtime 闭环 | 已完成并真实验收 | 主模型文本/工具、Luna 图片理解、图片生成、TTS→STT 全部通过 |
| P2-F11 P1 Runner 预检 | 已完成 | Case capability 到模型 operation 映射、fail-closed 测试 |
| P2-F12 CLI/Desktop/报告 | 已完成 | probe/list/show/model-runtime-verify/model-audio-runtime-verify/gate、JSONL/JSON/Markdown/JUnit、Desktop 可见状态、IPC/typecheck |
| P2-F13 安全/成本/可靠性 | 已完成核心 | token/字节/媒体上限、无自动副作用重试、公开结果脱敏 |
| P2-F14 P2 Gate | 已完成并通过 | 五模型、Provider、Profile revision、时效、digest、断言和按产品路径要求的 Runtime 证据均通过；反例保持 fail-closed |

## 测试轮次

1. 路由、模型解析和 Profile：通过。
2. Responses/Chat、Gemini 和 Audio Adapter：通过。
3. 图片与音频 Runtime 合同：通过。
4. 快照、CLI、P1 预检、报告和 Gate：通过。
5. P2 专项矩阵：52/52 通过；Windows Desktop TypeScript typecheck 通过。
6. 扩大兼容矩阵：旧测试已更新为 AgentModelPolicy 权威语义，配置与回归矩阵 138/138 通过。
7. 流式与图片理解链：Runtime/Adapter 定向矩阵 24/24 通过；Desktop P2 状态专项验证及 TypeScript typecheck 通过。
8. OPENDESAI-DEV Provider 探针：`deepseek-v4-flash` 三项、图片生成、TTS、STT 通过；`gemini-3.6-flash` 的 Responses、Chat、Gemini 三条候选协议均为 HTTP 502。
9. 正式 Runtime：文本 Run 与单工具闭环通过；TTS→STT 产品接口闭环通过；图片生成正确产生工具调用但审批编排失败。
10. 最终兼容矩阵发现并移除了 8 个仍依赖全局默认模型的旧测试假设，改为 Agent 模型策略权威语义与 Provider-only 原子更新语义。
11. 新增 `model-runtime-verify`：先向 Gateway 校验 completed Run、精确模型/Provider/operation 与 safe Manifest digest，再原子绑定到快照并重算 digest。三个主模型 operation 已绑定真实 Run；当前 Gate 不再报告主模型 Runtime 证据缺失。
12. 修复两项真实图片审批缺陷：可选 registry 诊断字段不再强索引；支持 `tool.started → approval callback（无 call ID）→ tool.completed` 的真实事件顺序。相关审批矩阵 55/55 通过。
13. 图片生成最终 Run `run-a4f770cb-b4f9-4559-b91d-0c1db044e631`：HTTP 200、`completed`、1 次工具调用、1 个 Artifact，safe Manifest digest `e306911931575679969fdab00bf91e69a2b3a0b5f998f5d9866d19c1a92c9f85`，已绑定快照。
14. 新增 `model-audio-runtime-verify`，正式执行 TTS→STT 并只持久化 operation ID/evidence digest，不保存音频；`tts-1` 与 `whisper-1` 已标记 `runtime_verified`。
15. 最新 P2 Gate 仅剩 `gemini-3.6-flash/chat` 的 Provider 能力、断言和 Runtime 三项失败。
16. 最终 P2/关联兼容 Python 矩阵 218/218 通过；Windows Desktop node/web TypeScript typecheck 与 P2 能力状态专项校验通过；相关文档与结果目录敏感凭据模式扫描零命中。
17. 完成审计发现原 Profile 漏掉方案中明确要求的 Gemini 函数调用确认。现已将 `gemini-3.6-flash/tool_calling` 加入必验矩阵，实现 Gemini 原生 function declaration 探针，并增加仅供能力发现使用的未声明 operation 探索模式；正式 Runtime 仍严格要求声明。真实探索请求返回 `provider_rejected / HTTP 502`。
18. 更新后的最终 P2/关联兼容 Python 矩阵 222/222 通过；Windows Desktop node/web TypeScript typecheck 与 P2 能力状态专项校验再次通过。
19. 增强 Responses/Chat/Gemini 的安全上游错误分类：在不持久化或显示上游正文的情况下识别模型不存在、operation 不支持、权限、认证、额度和上游不可达。第 18 轮真实复测的四条 `gemini-3.6-flash` 路径仍统一为 `provider_rejected / HTTP 502 / retryable=true`，没有可据以修正本地配置的稳定上游错误，确认需要智增增外部状态恢复。
20. 最终 P2/关联兼容 Python 矩阵 232/232 通过；Windows Desktop node/web TypeScript typecheck 与 P2 能力状态专项校验通过。相同外部502已连续3个目标轮次复现，P2目标按规则标记为受阻，待智增增恢复后从真实探针、图片理解 Runtime 和 Gate 继续。
21. 用户显式把图片理解角色改绑为 `gpt-5.6-luna`。修复图片理解能力探针无论声明协议都误用 Gemini Adapter 的缺陷，并取消非 Gemini 图片模型工具调用被强制路由到 Gemini 的错误；专项测试 24/24 通过。
22. Luna 真实 Responses 图片理解探针三项语义断言通过，Responses tools 的结构化函数名/参数三项断言通过；正式 Runtime Run `run-8fc32de0-eb23-4e3b-888d-bb38b6b5dc7b` 为 `completed`，Manifest 固定记录 Luna、`openai_responses` 和 1 张图片。
23. 新增图片理解 Manifest 证据绑定、Profile revision 失效检查和 `runtime_required_operations`，区分真实 Provider 候选能力与实际产品 Runtime 路径，避免为 Luna 候选工具路由伪造 Runtime。最终快照 digest 为 `sha256:b70ca6e148238c2fd829a4d7e4be765fe4039a1b1b0cc0d291e375f09da73fee`，`model-gate` 返回 `PASS`。
24. 清理 CLI/Doctor/Telemetry 中残留的全局默认模型写入与诊断假设；Provider setup 只保存 Provider，模型由 AgentModelPolicy 选择。相关测试 14/14、回归框架测试 47/47、扩大矩阵中的 264 项 Core 测试全部通过；Windows Desktop node/web typecheck 和 P2 状态校验通过。

## 最终验收结论

P2 已无剩余阻塞。精确模型绑定来自当前智能体配置；旧 `gemini-3.6-flash` 的 502 作为历史诊断保留，但不再是当前 Agent 模型矩阵的一部分。完整证据见 [P2 真实环境验收记录](opendrsai-agent-regression-testing-p2-real-acceptance.md)。当前实现完成度与真实验收完成度均为 100%，P2 Gate 已放行进入 12 项任务回归阶段。
