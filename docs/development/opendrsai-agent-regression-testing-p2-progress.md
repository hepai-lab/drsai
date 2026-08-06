# OpenDrSai 回归测试 P2 实施进展

更新时间：2026-08-06

## 当前结论

P2 的操作级路由、五模型 Profile、流式/非流式协议 Adapter、能力探针、快照、CLI、Desktop 状态、报告、P2 Gate、图片理解预处理链和 P1 Runner 预检已经实现。OPENDESAI-DEV 真实验收已覆盖 5 个模型，并完成正式文本、工具、图片生成和音频链路。发布门禁保持 fail closed：唯一剩余模型阻塞是精确绑定的 `gemini-3.6-flash`，其图片理解在三种候选协议上持续返回 502，Gemini 原生函数调用也返回 502，因此不得开始正式 12 项回归。

## 功能台账

| 功能 | 状态 | 验收证据 |
|---|---|---|
| P2-F01 操作级路由合同 | 已完成 | 路由单测；五模型 Profile |
| P2-F02 Agent 精确模型/凭据解析 | 已完成 | 无全局模型回退、角色不匹配和缺凭据反例 |
| P2-F03 Responses Adapter | 已完成并真实验收 | 非流式/流式合同；`deepseek-v4-flash` 文本、推理、工具真实通过 |
| P2-F04 Chat Adapter 收敛 | 已完成 | 非流式/流式统一结果、工具 delta 拼接与推理脱敏测试 |
| P2-F05 Gemini Adapter | 已完成 | 图片输入、函数、混合图片输出契约测试 |
| P2-F06 图片 Runtime | 已完成并真实验收 | 修复真实工具注册元数据缺失和 start-before-approval 账本顺序；正式 Run 完成且产生 1 个 Artifact |
| P2-F07 音频 Runtime | 已完成并真实验收 | 正式 TTS→STT 产品接口闭环通过，临时媒体已删除 |
| P2-F08 能力探针 | 已完成同步最小探针 | 七类 operation、确定性断言、稳定错误码测试 |
| P2-F09 快照与失效 | 已完成 P2 所需核心 | 稳定 digest、原子写、时效 Gate |
| P2-F10 正式 Runtime 闭环 | 除图片理解外均通过 | 主模型文本/工具、图片生成、TTS→STT 通过；图片理解受 Provider 502 阻塞 |
| P2-F11 P1 Runner 预检 | 已完成 | Case capability 到模型 operation 映射、fail-closed 测试 |
| P2-F12 CLI/Desktop/报告 | 已完成 | probe/list/show/model-runtime-verify/model-audio-runtime-verify/gate、JSONL/JSON/Markdown/JUnit、Desktop 可见状态、IPC/typecheck |
| P2-F13 安全/成本/可靠性 | 已完成核心 | token/字节/媒体上限、无自动副作用重试、公开结果脱敏 |
| P2-F14 P2 Gate | 已完成代码；真实环境正确拒绝放行 | 五模型、Provider、时效、digest、断言和 Runtime 证据均 fail-closed |

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

## 真实验收阻塞

1. 精确绑定的 `gemini-3.6-flash` 图片理解在智增增的 Responses、Chat Completions 与 Gemini `generateContent` 上均返回 HTTP 502；Gemini 原生函数调用探索也返回 HTTP 502。重复调用仍失败，不能用另一个模型静默替换。
   第 18 轮启用安全的502正文分类后重新验证，四条路径仍为 `provider_rejected` 且 `retryable=true`，未呈现 `model_not_found`、`operation_unsupported`、认证、权限或额度类别，因此当前没有可在 OpenDrSai 本地修正的确定性配置项。
完整证据与放行条件见 [P2 真实环境验收记录](opendrsai-agent-regression-testing-p2-real-acceptance.md)。当前实现完成度为 100%，真实验收完成度为 75%（8 个必验 operation 中 6 个通过）；P2 Gate 必须继续拒绝正式 12 项回归，直至智增增恢复该精确模型的图片理解与原生函数调用。
