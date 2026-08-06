# OpenDrSai 回归测试 P2 真实环境验收记录

更新时间：2026-08-06

## 1. 验收环境与原则

- 环境：本机 `OPENDESAI-DEV`，Gateway `127.0.0.1:28642`。
- 智能体：`my-drsai`；Provider：`zhizengzeng`。
- 模型以智能体模型策略中的精确绑定为准，不使用全局默认模型，也不以其他模型代替失败模型。
- OpenAI 兼容模型先试 Responses；只有端点缺失或协议不支持时才尝试 Chat Completions。Gemini 图片生成模型按 Profile 使用原生 `generateContent`。
- 真实媒体只用于瞬时验证，不进入公开报告；凭据、完整请求体、推理正文和二进制媒体均不落入验收文档。
- P2 Gate 为 fail-closed：Provider 探针与正式 Runtime 证据缺一不可。

## 2. Provider 真实能力探针

最终证据目录：`tmp/eval-results/regression/model-capabilities/20260806T060637Z-66c5406b`；能力快照 digest：`sha256:b70ca6e148238c2fd829a4d7e4be765fe4039a1b1b0cc0d291e375f09da73fee`。

| 智能体角色 | 精确模型 | 操作/协议 | 结果 | 结论 |
|---|---|---|---|---|
| 主模型 | `deepseek-v4-flash` | chat / Responses | 通过 | 文本生成可用 |
| 主模型 | `deepseek-v4-flash` | reasoning / Responses | 通过 | 可观察到推理能力；不保存完整推理正文 |
| 主模型 | `deepseek-v4-flash` | tool calling / Responses | 通过 | 结构化函数名和参数断言通过 |
| 图片理解 | `gpt-5.6-luna` | Responses `input_image` | 通过 | 红底、中央蓝色圆形三项语义断言通过；返回有效 Response ID |
| 图片理解/函数 | `gpt-5.6-luna` | Responses tools | 通过 | `calculator_add` 的结构化函数名和精确参数断言通过 |
| 图片生成 | `gemini-3.1-flash-lite-image` | Gemini `generateContent` | 通过 | 返回有效图片载荷；公开证据仅保存摘要 |
| 文字转语音 | `tts-1` | Audio Speech | 通过 | 返回有效音频 |
| 语音转文字 | `whisper-1` | Audio Transcriptions | 通过 | 固定语义断言通过 |

结论：智能体当前绑定的 5 个精确模型、8 个必验 operation 已全部通过真实 Provider 探针。图片理解绑定由用户显式更新为 `gpt-5.6-luna`；OpenDrSai 未进行静默替换。

## 3. 正式产品接口与 Runtime 验收

### 3.1 已通过

| 场景 | 真实证据 | 结果 |
|---|---|---|
| 主模型基础 Run | Run `run-25bb1fa8-c3da-4cd4-b2c9-6d408d0a91c5`；Manifest digest `e3b54c56dd9f5b1bc25b9712ea0ee5a553fa07f83f080b31d725854da3c58fd1` | `completed` |
| 主模型工具闭环 | Run `run-47981638-fb7c-49b4-8d1e-0fa1668536d2`；1 次工具调用；Manifest digest `d4cb044854725c6fea466c3bd5c89493cde9fa4fca6541643840d40dd35e4829` | `completed` |
| 图片理解闭环 | Run `run-8fc32de0-eb23-4e3b-888d-bb38b6b5dc7b`；图片模型 `gpt-5.6-luna`；协议 `openai_responses`；1 张图片；safe Manifest digest `0cbc142c446556440adad87ee9fa862b224c023effad17c53355f1fc178f390a` | `completed` |
| 图片生成闭环 | Run `run-a4f770cb-b4f9-4559-b91d-0c1db044e631`；正式审批；1 次工具调用；1 个 Artifact；safe Manifest digest `e306911931575679969fdab00bf91e69a2b3a0b5f998f5d9866d19c1a92c9f85` | `completed` |
| TTS→STT 产品闭环 | `/v1/audio/speech` 返回 36,480 字节；响应头模型 `tts-1`；`/v1/audio/transcriptions` 返回模型 `whisper-1`，文本非空且命中 “42” | 通过；临时音频已删除 |

这也确认了外部静态 Provider 的正式 Runtime 不应要求 HepAI 身份：`zhizengzeng` 使用自身安全凭据；只有 HepAI 类型 Provider 才要求 HepAI 登录身份。

三个主模型 operation、Luna 图片理解和图片生成已通过 `model-runtime-verify` 从 Gateway 校验并绑定到能力快照。图片理解校验读取 Manifest 中独立的 `image_understanding` 证据，不能把主模型冒充为图片模型。TTS/STT 通过 `model-audio-runtime-verify` 亲自执行正式产品闭环，只写入 operation ID/evidence digest，不保存音频。两种路径都拒绝未完成 Run、模型/Provider/协议不匹配、缺少安全摘要或损坏快照。

### 3.2 已解决的中间问题

1. 旧绑定 `gemini-3.6-flash` 曾在三种协议上持续返回 HTTP 502；用户随后显式将图片理解角色改为 `gpt-5.6-luna`。Luna 的 Responses Provider 探针和正式 Runtime 均已通过。
2. 中间验收曾发现两项图片审批编排缺陷：真实 registry 记录缺少可选诊断字段导致 `KeyError`，以及 start-before-approval 且 callback 无 call ID 时副作用账本未闭合。两项均已修复并由真实 completed Run 验收，不再是发布阻塞。
3. 模型目录有 60 秒新鲜度约束。正式 Run 前必须显式刷新 Provider catalog；过期目录必须 fail-closed，不能静默使用旧能力声明。

## 4. Gate 判定

当前判定：**P2 Gate 通过，模型基础允许进入下一阶段的 12 项正式回归**。

- 5 个模型、8 个必验 operation 均有真实 Provider 证据；
- 7 个产品 Runtime 必验 operation 已绑定 Run 或 operation 证据；Luna `tool_calling` 是候选路由探针，不要求伪造不存在的独立产品 Runtime；
- 快照未过期、Profile revision 匹配、canonical digest 有效；
- `model-gate` 返回 `PASS`，P1 Runner 的图片输入预检已映射到 `gpt-5.6-luna/chat`。

## 5. 已确认的工程结论

- Responses 是 OpenAI 兼容文本模型的首选协议，但不是所有模型/操作的通用协议；图片和音频必须按 operation 选择专用协议。
- “Provider 探针通过”不等于“OpenDrSai 正式 Runtime 通过”。图片生成实例证明二者必须分别验收。
- Desktop 应同时展示 Provider verified 与 Runtime verified，避免用户把模型可达性误认为智能体任务可执行性。
- 真实失败需要保留稳定错误码、HTTP 状态、候选协议和 Run/Manifest 关联，但不得保存密钥、完整推理或大媒体。
