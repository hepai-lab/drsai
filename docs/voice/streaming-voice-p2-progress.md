# Streaming/P2 实施与验收台账

统计口径：以 [P2 完整开发方案](./streaming-voice-p2-development-plan.md) 的 50 个功能点为分母。只有实现存在且对应测试与通过标准有直接证据时记为“已验收”；仅有代码、间接测试或待打包/真机验证时记为“进行中”。

## 总体进度

| 轮次 | 日期 | 已验收 | 进行中 | 未开始 | 验收进度 |
| --- | --- | ---: | ---: | ---: | ---: |
| 第 1 轮 | 2026-08-10 | 20 | 6 | 24 | 40% |
| 第 2 轮 | 2026-08-10 | 29 | 8 | 13 | 58% |
| 第 3 轮 | 2026-08-10 | 48 | 0 | 2 | 96% |
| 第 4 轮 | 2026-08-10 | 48 | 0 | 2 | 96% |
| 第 5 轮 | 2026-08-10 | 48 | 0 | 2 | 96%（外部阻塞） |

## 第 5 轮

重新审计外部状态，代码和自动化进度不变：48/50（96%）。

- 当前进程不存在 `OPENDRSAI_VOICE_LIVE_FIXTURE`、`OPENDRSAI_STREAMING_STT_WS_URL`、`HEPAI_API_KEY`、`OPENAI_API_KEY` 或 `OPENDRSAI_VOICE_HARDWARE_RESULTS`。
- 现有 Live 报告虽然 `ok:true`，但实际为 `mode:serial`、`streamingStt:false`，没有流式完整回合，不能验收 M8-F4。
- 当前硬件报告为 schemaVersion 2、`ok:false`、0 个物理运行、0 个测试者签署、0 个通过检查，不能验收 M8-F5。
- 同一外部条件已连续阻塞第 3、4、5 轮；代码、Fixture、沙盒或自动化不能替代授权生产 Provider 与 Win10/11 多设备实测。

解除阻塞需要：

1. 提供授权音频文件、生产流式 STT WebSocket、生产模型凭证，然后执行 `npm run verify:voice:streaming-live`。
2. 在要求的 Win10/11 与内置/USB/蓝牙设备上完成运行，把逐运行附件和测试者声明写入 `OPENDRSAI_VOICE_HARDWARE_RESULTS`，执行硬件证据生成与验证。
3. 重新执行 `npm run verify:voice:streaming:p2-acceptance`；只有输出 50/50 才能标记 P2 完成。

## 第 4 轮

本轮没有把外部门禁伪计为完成，进度保持 48/50（96%），但修复了两项验收基础设施缺陷：

- `verify:voice:streaming-live` 现在强制同时使用 `--streaming --full-round`。打包应用中的完整回合偏好改为 `interactionMode: streaming`，并按流式 capture/stop 控件与状态验收。
- M8-F4 的报告验证现在必须同时满足：Live 模式、streamingStt/streamingTts、partial/final/completed、流式输入、自动提交、LLM 回复、Provider TTS、播放完成和诊断隐私。
- Windows 硬件证据升级到 schemaVersion 2。18 项检查必须由具名物理运行覆盖，每个运行必须包含 OS、输入/输出设备、检查项、通过状态和附件引用。
- 硬件证据必须包含测试者姓名、签署时间、声明，以及绑定完整报告的 SHA-256 摘要；不能再仅靠 18 个布尔值通过。
- 当前机器只生成 pending 模板，`ok` 保持 false；旧的 serial Live 报告继续被拒绝。

本轮验证：

```text
..\node_modules\.bin\tsc.cmd --noEmit -p tsconfig.node.json --composite false
node --check scripts/prepare-voice-windows-hardware-evidence.mjs
node --check scripts/verify-voice-windows-hardware-evidence.mjs
..\node_modules\.bin\electron-vite.cmd build
npm run verify:voice:streaming:p2-acceptance  # 按设计退出 2：48/50，2 pending
```

## 第 3 轮

完成代码：

- Gateway 新增独立 `/v1/audio/transcriptions/stream`，完成实例 token、v2 协商、Agent 模型绑定、帧边界、双向转发、敏感字段剔除和资源清理。
- 新增生产 `OpenAIStreamingTranscriptionAdapter`；凭证只保留在 Gateway，通过 WSS 连接 Provider，不用串行上传伪装流式。
- Desktop Main 自动连接已启动的本地 Gateway，同时保留显式远程 WS 配置。
- 新增噪声底估计、动态 speech threshold、语言/语速端点窗口和固定 VAD 兼容模式。
- 新增有界预热 Socket 池、15 秒空闲过期和 URL 隔离。
- 新增自适应 TTS 预取水位、播放 underrun 恢复、Provider 能力注册、确定性路由、隐私门禁 failover 和显式串行降级。
- 新增分阶段 SLO、质量比率、成本预算和可行动诊断。
- 完成生产构建，并在打包后的 `OpenDrSai.exe` 中强制执行流式 Main/Preload IPC。

本轮新增验收功能：

| 功能 | 直接证据 |
| --- | --- |
| M2-F1 | Gateway WebSocket 集成测试验证鉴权、协议、二进制帧、事件顺序和清理 |
| M2-F2 | 生产 Adapter 测试验证 WSS、服务端凭证、上游协议映射和 TLS 策略 |
| M2-F3 | Desktop→Gateway→Provider JSON/PCM 双向映射和敏感字段剔除测试通过 |
| M3-F1 | 静音、风扇、不同噪声幅度 Fixture 的噪声底和阈值测试通过 |
| M3-F2 | 噪声、中文/英文和语音密度驱动动态 VAD，固定模式兼容测试通过 |
| M4-F1 | 有界预热、URL 隔离、租用、虚拟时钟过期和释放测试通过 |
| M4-F4 | 重试、隐私允许的 Provider 切换、串行降级和停止矩阵通过；UI 有显式重试/串行操作 |
| M5-F2 | 快/慢 Provider、网络抖动和 1–2 段有界动态预取测试通过 |
| M5-F4 | 150ms underrun 后严格按序恢复并完成播放测试通过 |
| M6-F1 | Provider 格式、语言、endpoint、resume、时长、延迟、成本和隐私能力快照测试通过 |
| M6-F2 | 用户优先、可用性、延迟、成本和稳定 tie-break 确定性路由测试通过 |
| M6-F3 | 同 Provider 有界重连、退避、耗尽和 1000 次清理测试通过 |
| M6-F4 | 显式许可、协议一致、隐私不降低、无 final 时跨 Provider 补发测试通过 |
| M6-F5 | 串行功能完整回归，流式失败保留显式串行模式切换 |
| M7-F1 | 音频 ACK、首 partial、final、首 TTS、首播放单调时钟测试通过 |
| M7-F2 | 修订率、端点错误率、卡顿率和恢复率计算测试通过 |
| M7-F3 | 连接、音频、TTS 字符成本边界及超限不变异测试通过 |
| M7-F5 | 阶段、错误码、重试和串行降级建议矩阵测试通过 |
| M8-F3 | 打包 exe 报告明确 `mode: streaming`，且 partial→final→completed、停止、取消均通过 |

尚未验收：

| 功能 | 状态 | 所需证据 |
| --- | --- | --- |
| M8-F4 Live Provider | 未开始 | 授权的生产 ASR/LLM/TTS 凭证、真实音频，以及 streamingStt/streamingTts 均为 true 的完整回合报告 |
| M8-F5 Windows 硬件矩阵 | 未开始 | Win10/11、内置/USB/蓝牙、睡眠、拔插、断网的签名人工/设备实验报告 |

本轮通过命令：

```text
npm run test:voice:streaming:p2
npm run test:voice:serial
npm run build:unpack
$env:OPENDRSAI_E2E_VOICE_STREAMING='1'; npm run verify:packaged-voice
```

打包流式证据：`apps/desktop/windows/release/voice-packaged-evidence/report.json`。报告中 `details.streaming.mode` 为 `streaming`，所有 checks 为 true。

## 第 2 轮

完成代码：

- WebSocket Runtime 新增恢复游标、事件序号去重与缺口检测、仅补发未 ACK 音频及 2 秒补发上限。
- 新增有界重连、延迟结束输入、旧 Socket 隔离，以及取消、失败和释放时的定时器清理。
- Provider 恢复测试扩展到重试耗尽、旧连接污染、乱序事件、补发上限及 1000 次重连清理压力。
- `test:voice:streaming:p2` 聚合执行架构、Composer、修复、音频、传输、Provider、VAD、切片、TTS、播放、诊断和压力测试。

本轮新增验收功能：

| 功能 | 直接证据 |
| --- | --- |
| M3-F3 | Provider/本地/manual endpoint 优先级与去重矩阵测试通过 |
| M4-F2 | ACK 音频游标、Provider 事件游标、重复事件过滤和事件缺口失败测试通过 |
| M4-F3 | 重连仅补发未 ACK 音频，2 秒窗口和字节帧边界测试通过 |
| M4-F5 | 旧连接隔离、取消/释放清理及 1000 次重连定时器压力测试通过 |
| M5-F1 | 中英文、缩写、数字、URL、代码过滤及随机 Token 边界一致性测试通过 |
| M5-F3 | 首段短阈值、首段最大等待时间和最终 flush 测试通过 |
| M5-F5 | TTS 一活跃一等待上限、重复抑制、取消释放和 Object URL 精确回收测试通过 |
| M7-F4 | 诊断字段白名单及原始音频、转写正文、凭证和端点排除测试通过 |
| M8-F2 | `test:voice:streaming:p2` 完整离线套件全绿 |

仍在进行中功能：M2-F1、M2-F2、M2-F3、M3-F1、M3-F2、M4-F1、M4-F4、M5-F2，共 8 项。Gateway 生产 WebSocket、真实 Provider Adapter、动态噪声/VAD、连接预热池、显式串行降级和动态 TTS 水位尚未达到验收定义。

本轮通过命令：

```text
..\node_modules\.bin\tsc.cmd --noEmit -p tsconfig.node.json --composite false
npm run test:voice:streaming-provider
npm run test:voice:streaming-main
npm run test:voice:streaming:p2
```

## 第 1 轮

完成代码：

- 建立 `serial/streaming/duplex/shared` 公共入口和禁止跨路线内部导入的门禁。
- 新增 Composer 三层投影、编辑锚点、IME 冻结、revision 和冲突检测纯核心。
- 录音期间在 Composer 内保留可编辑 textarea，并显示 stable/provisional 投影、波形和停止控制。
- 新增上下文词典修复、修复风险策略、候选状态、接受/拒绝/逐字节撤销核心。
- 新增修复差异组件和 Streaming P2 能力字段。
- 流式状态机新增 repairing/repair_review 与提交资格判断。

已验收功能：

| 功能 | 直接证据 |
| --- | --- |
| M1-F1 | `verify:voice-route-boundaries` 检查 27 个路线文件通过 |
| M1-F2 | 共享能力和 repair 契约通过 Node 类型检查、契约测试与生产构建 |
| M1-F3 | P2 capability 位由 Fixture/生产诚实声明，Main 集成测试通过 |
| M1-F4 | legacy/v2 请求兼容、非法版本和会话中版本变化测试通过 |
| M1-F5 | 兼容 re-export、生产构建、串行完整套件和视觉回归通过 |
| M2-F4 | 现有契约与随机状态测试证明单一终态和终态幂等 |
| M2-F5 | Runtime 错误脱敏、诊断正文排除测试通过 |
| M3-F4 | partial replacement、stale revision、final commit 测试通过 |
| M3-F5 | 默认审核、IME 后恢复 Insert 和误发送保护视觉 E2E 通过 |
| M3-F6 | Composer 内实时投影可见，正式 input 未被 provisional 污染，视觉 E2E 通过 |
| M3-F7 | stable/provisional 分层、revision、final commit 和 10,000 随机场景通过 |
| M3-F8 | 编辑锚点、前后编辑、冲突检测、随机测试及录音中编辑 E2E 通过 |
| M3-F9 | composition 期间冻结、compositionend 应用缓冲的单元和视觉 E2E 通过 |
| M3-F10 | partial 后文 revision 与 final 术语修复测试通过 |
| M3-F11 | 用户词典、工作区术语、无关上下文和来源元数据测试/E2E 通过 |
| M3-F12 | 置信度、金额、日期/数字、否定、路径、命令/代码风险策略测试通过 |
| M3-F13 | 原文、建议、变化范围、来源、置信度和无障碍视觉 E2E 通过 |
| M3-F14 | 接受、拒绝、撤销状态测试和逐字恢复视觉 E2E 通过 |
| M3-F15 | provisional commit、repairing 状态及程序化 form submit 门禁测试通过 |
| M8-F1 | `test:voice:serial` 完整套件与串行视觉回归通过 |

进行中功能：M2-F1、M2-F2、M2-F3、M4-F2、M4-F3、M4-F4，共 6 项。Main 已有直接 WebSocket Runtime、ACK 和恢复状态基础，但 Gateway 生产入口、真实 Provider、可恢复游标及补发闭环尚未完成，因此不计为已验收。

本轮通过命令：

```text
npm run verify:voice-route-boundaries
npm run test:voice:streaming-composer
npm run test:voice:streaming-context-repair
npm run test:voice:streaming-turn-state
npm run test:voice-mode
npm run test:voice:streaming-contracts
npm run test:voice:streaming-main
npm run test:voice:streaming-provider
npm run test:voice:serial
electron-vite build
node scripts/verify-voice-visual.mjs
```

环境说明：使用 `apps/desktop/node_modules` 中的既有工具链完成 Node 类型检查和生产构建。Web 类型检查当前仅被工作树中与语音无关的 `mockDesktopApi.probeMyDrSaiProviderModel` 缺失阻断；语音生产构建、视觉 E2E 和串行回归均已通过，但该无关错误仍不被忽略或伪报为全量类型检查通过。
