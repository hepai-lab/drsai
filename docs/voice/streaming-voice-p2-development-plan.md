# Windows 流式语音路线 P2 完整开发方案

最后更新：2026-08-10

技术路线：`streaming`

路线阶段：P2

## 1. 基线与总体目标

P1 的 Fixture 级流式输入、回复、分段 TTS 和顺序播放已经存在，但当前 partial 主要显示在独立的流式采集区域，最终文本才进入审核流程；生产流式 STT、会话恢复、真实打包流式回合和物理设备矩阵也尚未形成有效证据。P2 不重写 P1，而是在 `voice/streaming` 内完成以下总体目标：

1. 用户讲话时，识别文字同步出现在 Composer 输入框的可见区域内。
2. 使用“稳定前缀 + 临时后缀”模型持续修订，不破坏光标、选择区、IME 或用户手写文字。
3. 利用当前语音段后文、对话上下文、工作区术语和用户词典提出自动修复。
4. 修复必须可解释、可比较、可撤销；低置信度内容默认进入审核，不静默自动发送。
5. 补齐生产 Streaming ASR、会话恢复、自适应延迟以及真实发布证据。

P2 保持半双工。AI 播放期间持续监听、重叠语义理解、回声消除和发言权仲裁属于 `duplex/P1`。

这里允许的“重叠语义”仅指同一用户语音回合内，后续语音与前文、已有对话上下文联合消歧；不包括用户语音与 AI 输出音频同时发生时的双路语义理解。

## 2. 总体解决方案

```text
麦克风 PCM
  -> Streaming ASR partial/final
  -> Transcript Reconciler（稳定前缀 / 临时后缀）
  -> Composer Projection（输入框内视觉投影，不直接覆盖用户文本）
  -> Context Repair（后文 + 对话摘要 + 允许的术语上下文）
  -> Repair Diff（原文、建议、置信度和原因）
  -> 用户确认 / 策略允许的自动接受
  -> 正式 Composer 文本
```

Composer 内部模型采用三个互不混写的区段：

```text
userText             用户已经输入或编辑的正式文字
stableVoiceText      已稳定但仍可撤销的语音文字
provisionalVoiceText 当前可能被下一次 partial 替换的临时文字
```

上下文修复只能读取经过边界控制的上下文，不得把未提交 provisional 文本写入聊天历史、Agent 上下文或持久化记录。修复后的文字必须保留原始 final、修复版本和差异，发送时只使用用户最终确认的 Composer 文本。

## 3. 模块与功能验收

P2 规划 **8 个模块、50 个功能点**。

### M1 路线边界与版本化契约

| 功能 | 实现 | 测试与通过标准 |
| --- | --- | --- |
| M1-F1 路线公共入口 | Main、Renderer 只从 `voice/serial` 或 `voice/streaming` 导入核心 | 架构脚本扫描跨路线导入并阻断 |
| M1-F2 共享契约 | 把 DTO、错误、能力声明放入 `voice/shared` | Node/Web 类型与契约快照通过 |
| M1-F3 P2 能力协商 | 增加 resume、adaptiveEndpoint、providerFailover 等能力位 | 缺失、矛盾和旧版本响应测试 |
| M1-F4 协议版本 | 为音频帧、事件和恢复游标增加显式版本 | 新旧协议兼容矩阵测试 |
| M1-F5 兼容入口 | 旧路径只做 re-export，记录迁移期限 | 生产 bundle 与串行回归均通过 |

### M2 生产 Streaming ASR 闭环

| 功能 | 实现 | 测试与通过标准 |
| --- | --- | --- |
| M2-F1 Gateway WebSocket | 增加认证的流式音频入口，不把 Provider 凭据暴露给 Renderer | 未认证、过期、来源和速率限制测试 |
| M2-F2 Provider Adapter | 将统一 PCM/事件协议映射到首个生产 Provider | Mock Provider 覆盖握手、partial、final、endpoint |
| M2-F3 音频确认 | ACK 明确已消费序号和缓冲水位 | 丢包、重复、乱序和超水位测试 |
| M2-F4 终态唯一 | completed/cancelled/failed 只能出现一次 | 随机竞态和断线终态测试 |
| M2-F5 安全与脱敏 | URL、Token、原始音频和转写不进入普通日志 | 敏感值扫描和诊断 Schema 测试 |

### M3 实时 Composer、上下文修复与自适应端点

| 功能 | 实现 | 测试与通过标准 |
| --- | --- | --- |
| M3-F1 噪声底估计 | 会话前段估计环境噪声并限制漂移 | 静音、风扇、人声和突发噪声 Fixture |
| M3-F2 动态 VAD | 按噪声、语速和语言调整阈值 | 中英文快慢语速端点误差测试 |
| M3-F3 Provider/本地仲裁 | 定义两个 endpoint 信号的优先级和去重 | 同时、先后和冲突事件矩阵 |
| M3-F4 Partial 稳定 | 限制 UI 抖动并保留 revision 单调性 | 随机修订、标点和回滚测试 |
| M3-F5 审核策略 | 保持默认审核，可配置明确的自动发送策略 | 设置迁移、IME 和误触发送 E2E |
| M3-F6 输入框实时投影 | partial 在 Composer 内可见，但不直接覆盖正式 input 值 | DOM 测试验证视觉同步且正式值未被污染 |
| M3-F7 稳定/临时分层 | stable prefix 与 provisional suffix 独立更新 | revision、回滚、final 和多段拼接状态测试 |
| M3-F8 编辑锚点 | 录音开始时记录插入范围，用户编辑其他位置不被覆盖 | 光标、选择区、头尾插入和并发编辑测试 |
| M3-F9 IME 兼容 | compositionstart 到 compositionend 期间冻结语音提交，仅更新视觉缓冲 | 中文、日文输入法组合事件 E2E |
| M3-F10 同段后文修复 | 后续 partial/final 可以修订当前语音段前文 | 同音字、否定词、数字、标点和专名 Fixture |
| M3-F11 对话上下文修复 | 使用有界对话摘要、用户词典和工作区术语消歧 | 上下文命中、无关上下文和冲突上下文测试 |
| M3-F12 修复策略与置信度 | 只有高置信、非敏感、非意图改变的修复可建议自动接受 | 阈值边界、否定反转、金额日期和命令文本安全测试 |
| M3-F13 差异与来源展示 | 展示原始 final、建议文本、变化范围和上下文来源类型 | UI 快照、键盘导航和屏幕阅读器验收 |
| M3-F14 接受与撤销 | 支持逐项/全部接受、拒绝及撤销到原始 final | reducer、撤销栈和重复操作幂等测试 |
| M3-F15 提交门禁 | provisional、修复中或低置信冲突时禁止自动发送 | 点击、Enter、快捷键和程序化提交 E2E |

### M4 会话复用、重连与恢复

| 功能 | 实现 | 测试与通过标准 |
| --- | --- | --- |
| M4-F1 预热连接池 | 有界复用连接，空闲超时后释放 | 虚拟时钟验证复用和清理 |
| M4-F2 恢复游标 | 记录最后 ACK 音频与最后应用事件 | 重连后无重复 partial/final |
| M4-F3 有界补发 | 仅补发 Provider 未确认的短窗口音频 | 断线点随机化与字节上限测试 |
| M4-F4 恢复决策 | 能恢复则续传，否则显式重试或切回串行 | 能力与故障矩阵测试 |
| M4-F5 生命周期清理 | 导航、窗口关闭、取消和超时释放所有资源 | 1000 次重连压力与句柄稳定测试 |

### M5 自适应切片、TTS 与播放缓冲

| 功能 | 实现 | 测试与通过标准 |
| --- | --- | --- |
| M5-F1 动态语义切片 | 按生成速率、标点和语言调整片段长度 | 随机 Token 边界保持最终文本一致 |
| M5-F2 TTS 预取水位 | 根据合成速度和播放消耗动态调整 | 快慢 Provider 与网络抖动虚拟测试 |
| M5-F3 首段优先 | 首段使用更短阈值，后续兼顾自然度 | TTFA 与片段自然度 Fixture 对比 |
| M5-F4 卡顿恢复 | underrun 后平滑恢复且不乱序 | 暂停、失败、延迟和重试矩阵 |
| M5-F5 有界资源 | 限制待合成、已合成和对象 URL 数量 | 长回复压力测试无残留资源 |

### M6 Provider 策略与可见降级

| 功能 | 实现 | 测试与通过标准 |
| --- | --- | --- |
| M6-F1 能力注册表 | 描述格式、语言、endpoint、resume 和限制 | Provider 能力快照测试 |
| M6-F2 路由策略 | 按用户选择、可用性、延迟和成本选择 Runtime | 确定性策略表测试 |
| M6-F3 同 Provider 重连 | 短暂故障优先恢复当前会话 | 故障注入验证上限和退避 |
| M6-F4 跨 Provider 回退 | 仅在协议与隐私策略允许时显式切换 | 禁止/允许矩阵及 UI 提示 E2E |
| M6-F5 串行降级 | 流式不可用时保留原串行模式和原始输入 | 打包应用完成降级回合 |

### M7 SLO、诊断、隐私与成本

| 功能 | 实现 | 测试与通过标准 |
| --- | --- | --- |
| M7-F1 分段延迟 | 记录首音频 ACK、首 partial、final、首 TTS、首播放 | 单调时钟和字段完整性测试 |
| M7-F2 质量指标 | 记录修订率、端点误差、卡顿和恢复率 | 指标计算 Fixture |
| M7-F3 成本预算 | 记录连接、音频和合成用量并设会话上限 | 边界与超限行为测试 |
| M7-F4 隐私等级 | 原始音频、转写和派生指标采用不同保留策略 | 导出、清理和敏感值扫描 |
| M7-F5 可行动诊断 | 错误附阶段、Provider、重试与降级建议 | 错误矩阵和多语言 UI 截图 |

### M8 测试、对比和发布门禁

| 功能 | 实现 | 测试与通过标准 |
| --- | --- | --- |
| M8-F1 串行零回归 | 每次执行串行完整套件 | `test:voice:serial` 必须先通过 |
| M8-F2 流式离线全套 | 聚合契约、状态、弱网、恢复和压力测试 | `test:voice:streaming:p2` 全绿 |
| M8-F3 真实打包流式 | 强制 `OPENDRSAI_E2E_VOICE_STREAMING=1`，禁止以 serial 跳过 | 报告 mode 必须为 streaming 且有 partial/final |
| M8-F4 Live Provider | 生产 ASR、LLM、TTS 完整流式回合 | 报告 streamingStt/streamingTts 均为 true |
| M8-F5 Windows 硬件矩阵 | Win10/11、内置/USB/蓝牙、睡眠/拔插/断网 | 签名证据全部为 true |

## 4. 需要新增、更新和移除的代码

### 4.1 新增模块

| 模块 | 位置 | 职责 |
| --- | --- | --- |
| `streamingComposerProjection.ts` | `renderer/src/voice/streaming/` | 管理 user/stable/provisional 三层文本和编辑锚点 |
| `contextualTranscriptRepair.ts` | `renderer/src/voice/streaming/` | 编排上下文修复请求、取消、版本和终态 |
| `transcriptRepairPolicy.ts` | `renderer/src/voice/streaming/` | 置信度、敏感字段、意图改变和自动接受规则 |
| `TranscriptRepairDiff.tsx` | `renderer/src/components/voice/` | 显示差异、来源、接受、拒绝与撤销操作 |
| Streaming repair Gateway/Adapter | `main/voice/streaming/` 与 Gateway | 提供有界、可取消、可审计的上下文修复能力 |

### 4.2 更新模块

| 现有模块 | 更新内容 |
| --- | --- |
| `transcriptReconciler.ts` | 输出稳定前缀、临时后缀、revision 和原始 final，不再只输出拼接显示文本 |
| `useStreamingVoiceInput.ts` | 暴露 projection、repair 状态以及接受/拒绝/撤销动作 |
| `streamingVoiceTurnReducer.ts` | 增加 `repairing`、`repair_review` 状态与提交门禁 |
| `ChatWorkspace.tsx` | 把投影渲染进 Composer，协调光标、IME、用户编辑和发送 |
| `voiceComposer.ts` | 增加基于锚点的原子提交，不使用每个 partial 直接改写字符串 |
| `StreamingVoiceCaptureBar.tsx` | 保留波形、状态和停止按钮；不再作为 partial 正文的唯一展示位置 |
| `desktopApi.ts` | 增加 repair 请求、候选、来源、置信度、取消和版本契约 |
| 流式诊断 | 增加 projection 延迟、修订率、修复接受率和撤销率，仍禁止记录正文 |

### 4.3 移除或禁止的实现

- 移除“每个 partial 直接 `setInput()`”式方案；它会破坏光标、IME 和用户编辑。
- 修复上线后，移除采集条中重复的完整 partial 正文，只保留简短状态或无障碍摘要。
- 禁止把 provisional 文本写入聊天历史、持久化、诊断或 Agent 上下文。
- 禁止无差异提示地覆盖 Provider final。
- 禁止在修复未完成或存在低置信冲突时自动发送。
- 不移除任何串行路线模块；串行继续作为默认模式和可靠降级路径。

### 4.4 新增测试入口

| 命令 | 覆盖范围 |
| --- | --- |
| `test:voice:streaming-composer` | 三层文本、编辑锚点、partial/final、撤销和随机事件 |
| `test:voice:streaming-context-repair` | 同段后文、对话摘要、术语、冲突上下文和取消 |
| `test:voice:streaming-repair-policy` | 置信度、敏感值、否定、金额、日期、命令和自动接受边界 |
| `verify:voice:streaming-composer-visual` | Composer 投影、差异组件、缩放、主题和无障碍 |
| `verify:voice:streaming-ime-e2e` | 中文/日文 IME、光标、选择区与录音并发编辑 |
| `verify:voice:streaming-repair-privacy` | provisional、原始转写和上下文不得泄漏到日志或持久化 |
| `test:voice:streaming:p2` | 聚合 P1 流式回归及所有 P2 离线测试 |

### 4.5 关键量化验收标准

- ASR partial 事件到 Composer 可见投影的本地 P95 延迟不超过 150 ms。
- 10,000 组随机 revision/编辑事件中，正式用户文本、光标和选择区损坏次数为 0。
- IME composition 期间正式文本被语音提交覆盖的次数为 0。
- provisional 写入聊天历史、持久化、诊断和 Agent 上下文的次数为 0。
- 金额、日期、否定词、路径、命令和代码片段不得在无用户确认时发生语义改变。
- 接受后撤销必须逐字节恢复原始 Provider final 与原 Composer 文本。
- 20 回合打包流式测试中无重复提交、无跨回合文本串扰、无残留修复任务。

## 5. 实施顺序

1. P2-S0：冻结 P1 证据，完成路线入口和架构门禁。
2. P2-S1：完成 Composer Projection、编辑锚点、IME 与 partial/final 分层。
3. P2-S2：完成上下文修复、差异审核、撤销和提交门禁。
4. P2-S3：完成 Gateway WebSocket 与首个生产 Provider Adapter。
5. P2-S4：完成自适应 endpoint、会话恢复和弱网闭环。
6. P2-S5：完成动态切片、TTS 缓冲和 Provider 策略。
7. P2-S6：完成 SLO、真实打包、Live Provider 和硬件矩阵。

进入下一里程碑前，串行测试和已经通过的流式 P1 Fixture 测试不得退化。

## 6. 完成定义

只有以下条件同时满足，才能把 `streaming/P2` 标记完成：

- 用户讲话期间，Composer 内实时显示 provisional，并在 final 后稳定提交。
- 光标、选择区、IME 和用户并发编辑不会被 partial 覆盖。
- 同段后文和允许的对话上下文能够生成可解释的修复建议。
- 原始 final、修复差异、接受/拒绝和撤销链路完整可用。
- provisional 或低置信冲突不会被自动发送或进入 Agent 上下文。
- 真实流式打包报告、生产 Provider 完整回合、恢复/弱网指标和物理设备矩阵全部通过。

仅有 Fixture、源代码存在或串行 Live 报告不能替代上述证据。
