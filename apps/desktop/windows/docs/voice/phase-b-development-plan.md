# Windows App Voice Phase B Development Plan

Last updated: 2026-07-11

Implementation status: completed in code on 2026-07-11. The Windows renderer now uses binary audio IPC, asynchronous request events, cancellation, runtime health disclosure, language and microphone selection, progress/error recovery, and editable transcript review. The main process provides a bounded request registry, `VoiceRuntime` selection, deterministic fixture runtime, gateway-provider runtime, timeout/retry/error normalization, temporary audio TTL cleanup, and single-terminal-state handling. The bundled Python gateway exposes a bounded authenticated `/v1/audio/transcriptions` proxy. Standard verification is network-independent; the optional live-provider and physical-microphone smoke tests still require configured credentials and Windows audio hardware at release time.

## 1. Phase B 定位

Phase B 的任务是把当前“真实录音 + mock 占位文本”升级为“真实录音 + 可取消的真实语音转写”。本阶段只负责 STT（Speech-to-Text）生产链路，不包含本地 Whisper 模型安装和 TTS；二者仍属于 Phase D。

当前基础：

- Renderer 已能使用 `getUserMedia` 和 `MediaRecorder` 录音。
- `AudioContext + AnalyserNode` 已提供真实、响应式波纹。
- Shared API、Preload、Main 已有 `transcribeVoiceRecording` IPC 骨架。
- `src/main/voice.ts` 已有大小、时长、工作区和交接文件校验。
- 当前唯一运行时是 `mock-local`，不会读取语音内容。

## 2. 目标

### 2.1 产品目标

用户停止录音后，应用通过已配置的真实转写运行时识别中文、英文或中英混合语音，返回可编辑文本；用户可以取消、重试或丢弃，不影响原有输入内容。

### 2.2 工程目标

- 建立独立于供应商的 `VoiceRuntime` 抽象。
- 建立带 `requestId`、事件、超时和取消的异步任务模型。
- 接入一个真实 gateway/provider STT 适配器。
- 保留确定性的 fixture runtime，用于无网络 CI。
- 统一输入格式、结果结构和错误代码。
- 默认不持久化原始音频，任务结束后可靠清理。
- Renderer 不接触供应商地址、密钥或响应格式。

### 2.3 非目标

- 不在本阶段打包本地 Whisper 模型。
- 不实现助手朗读、自动播放或全双工语音通话。
- 不做唤醒词、后台监听或自动开始录音。
- 不承诺实时流式字幕；若供应商支持，只保留扩展接口。
- 不自动发送转写文本，最终发送仍由用户确认。

## 3. 最终用户流程

1. 用户点击麦克风，应用请求权限并开始录音。
2. 波纹根据真实输入变化，输入框原有文字保持不变。
3. 用户点击停止，界面进入“正在准备音频”。
4. Main 创建转写任务并返回 `requestId`。
5. 界面显示“正在转写”，允许取消。
6. 成功后显示可编辑的转写结果。
7. 用户选择插入、替换当前选区、重试或丢弃。
8. 插入后恢复普通输入框，用户仍需主动点击发送。

异常流程：

- 权限、设备和录音错误在 Renderer 阶段处理。
- 编码、大小和格式错误在 Main 校验阶段处理。
- 鉴权、网络、限流、超时和供应商错误由 runtime 归一化。
- 可重试错误保留临时音频至短期 TTL；取消或丢弃立即删除。

## 4. 状态机

```text
idle
  -> requesting_permission
  -> recording
  -> preparing
  -> transcribing
  -> reviewing
  -> inserted
  -> idle

recording -> cancelled -> idle
preparing/transcribing -> cancelling -> idle
requesting_permission/recording/preparing/transcribing -> failed
failed -> retrying -> transcribing
failed -> discarded -> idle
```

约束：

- 同一 composer 同时最多有一个录音或转写任务。
- 所有异步回调都必须校验当前 `requestId`，忽略过期事件。
- 终态必须关闭轨道、定时器、动画帧、AudioContext、AbortController 和临时文件。
- 转写失败不得覆盖用户原有输入。

## 5. 功能点

### 5.1 真实转写运行时

- `fixture`：读取固定音频 fixture 或测试指令，返回确定结果，只用于测试和开发。
- `gateway-provider`：通过现有本地 gateway 调用真实 STT 服务。
- `mock-local`：仅保留在显式开发模式，生产构建不得自动回退到占位文本。
- `local-whisper`：只定义 runtime ID 和扩展位，不在 Phase B 实现。

### 5.2 任务控制

- 开始任务后立即获得唯一 `requestId`。
- 支持 accepted、progress、completed、failed、cancelled 事件。
- 支持用户取消、超时取消、窗口销毁取消和应用退出清理。
- 对网络临时错误最多做有限重试，并使用退避；用户取消时不得继续重试。
- 相同任务只能产生一个终态事件。

### 5.3 结果能力

- transcript：必需，空文本按 `empty_audio` 处理。
- language：供应商返回时保留，否则使用 language hint 或 `unknown`。
- durationSeconds：使用录音侧可信时长并与运行时结果交叉校验。
- confidence：仅在运行时真实提供时返回，不虚构。
- segments：作为可选扩展，Phase B UI 暂不依赖。
- runtimeId、providerDisclosure、createdAt、latencyMs、truncated。

### 5.4 用户控制

- 转写中显示取消按钮。
- 失败时显示重试和丢弃。
- 成功后进入编辑确认状态，不直接发送。
- 支持插入光标位置和替换当前选区。
- 明确显示“在线服务处理”或对应运行时披露。

### 5.5 设置与健康状态

- Runtime：Phase B 默认 `gateway-provider`，开发环境可选 fixture。
- Language：Auto、zh-CN、en-US。
- 超时：默认 60 秒，受安全范围约束。
- Runtime status：ready、unavailable、auth_required、degraded。
- 能力：支持 MIME、最大字节数、最大时长、语言和是否支持 partial。

## 6. 架构设计

### 6.1 目录建议

```text
src/main/voice/
  index.ts
  contracts.ts
  requestRegistry.ts
  tempAudioStore.ts
  errorNormalization.ts
  runtimes/
    fixtureRuntime.ts
    gatewayProviderRuntime.ts
    mockRuntime.ts
```

现有 `src/main/voice.ts` 拆分后，handoff 逻辑可以保留为 `handoff.ts`。拆分应分提交完成，避免一次性同时改协议、运行时和 UI。

### 6.2 VoiceRuntime 接口

```ts
interface VoiceRuntime {
  readonly id: DesktopVoiceRuntimeId;
  getStatus(): Promise<DesktopVoiceRuntimeStatus>;
  transcribe(
    input: VoiceRuntimeInput,
    context: { signal: AbortSignal; emit: (event: VoiceRuntimeProgress) => void },
  ): Promise<VoiceRuntimeResult>;
}
```

运行时输入包含：临时音频引用、MIME、字节数、时长、language hint 和 source label。运行时不能直接写 composer 或 workspace 文件。

### 6.3 Shared API

新增或调整：

```ts
type DesktopVoiceErrorCode =
  | "permission_denied"
  | "device_missing"
  | "empty_audio"
  | "audio_too_large"
  | "duration_exceeded"
  | "unsupported_format"
  | "runtime_unavailable"
  | "auth_required"
  | "network_error"
  | "rate_limited"
  | "timeout"
  | "provider_error"
  | "cancelled"
  | "internal_error";

interface DesktopVoiceTranscriptionStartResult {
  requestId: string;
  acceptedAt: string;
}

type DesktopVoiceTranscriptionEvent =
  | { requestId: string; type: "accepted"; runtimeId: DesktopVoiceRuntimeId }
  | { requestId: string; type: "progress"; stage: "uploading" | "transcribing"; message: string }
  | { requestId: string; type: "completed"; result: DesktopVoiceTranscriptionResult }
  | { requestId: string; type: "failed"; error: DesktopVoiceError }
  | { requestId: string; type: "cancelled" };
```

Desktop API：

- `startVoiceTranscription(request)`
- `cancelVoiceTranscription(requestId)`
- `onVoiceTranscriptionEvent(listener)`
- `getVoiceRuntimeStatus()`

兼容策略：开发期间保留旧 `transcribeVoiceRecording`，新链路稳定后删除。不要长期维护两套生产路径。

### 6.4 音频传输

Phase B 推荐使用 Main 管理的临时文件或分块二进制 IPC，停止继续扩大 Base64 方案。

实现顺序：

1. Renderer 录制为 Blob。
2. 通过受限 chunk IPC 传输 ArrayBuffer；单块建议 256 KB。
3. Main 按 `requestId` 写入应用 temp 目录。
4. Main 校验累计大小、声明 MIME、魔数和时长边界。
5. runtime 从临时文件读取或构造 multipart 请求。
6. 完成、取消、超时和启动清理时删除文件。

临时文件不得使用用户提供的文件名，不得写入 workspace，不得跟随符号链接。文件名使用 UUID，TTL 建议 15 分钟，应用启动时清理过期文件。

如果首个实现为降低改动暂时保留 Base64，必须标记为过渡方案，并继续维持 10 MB 限制；上线前完成二进制迁移和内存压力测试。

### 6.5 Gateway Provider Runtime

开发前先确认 gateway 是否提供 STT endpoint、鉴权方式、请求格式、最大尺寸和响应格式。目标优先采用 OpenAI-compatible multipart 语义，例如 `/v1/audio/transcriptions`，但最终路径以 gateway 实际契约为准。

适配器职责：

- 从 Main/gateway 配置获取地址和认证状态，不接收 Renderer 密钥。
- 使用 multipart 上传音频、模型、language hint 和可选 prompt。
- 使用 `AbortSignal` 支持取消和超时。
- 检查 HTTP 状态、Content-Type 和响应大小。
- 将供应商响应归一化为内部结果。
- 不记录 Authorization、原始音频和完整 transcript。

不得在应用中静默改用另一个外部供应商。Runtime 不可用时返回明确错误。

## 7. 错误与重试策略

| 类别 | 是否自动重试 | 是否保留音频 | 用户操作 |
| --- | --- | --- | --- |
| permission/device | 否 | 否 | 打开权限或选择设备 |
| empty/format/size | 否 | 可选短期 | 重新录音 |
| auth required | 否 | 短期 | 前往登录或设置后重试 |
| network/5xx | 最多 1 次 | 短期 | 重试或取消 |
| rate limited | 遵循 Retry-After，最多 1 次 | 短期 | 稍后重试 |
| timeout | 否 | 短期 | 重试或取消 |
| cancelled | 否 | 否 | 返回输入状态 |
| provider/internal | 否 | 短期 | 查看诊断并重试 |

错误消息包含用户可执行动作；诊断详情包含 request ID、stage、runtime 和 error code，但不包含隐私内容。

## 8. 安全、隐私和资源约束

- 录音只能由明确点击触发。
- 在线转写首次使用前显示音频将离开设备的披露。
- 原始音频默认短暂存在，完成或丢弃后删除。
- transcript 只有用户确认后才插入 composer 或写入 handoff。
- 最大录音 120 秒，最大原始音频 10 MB；gateway 限制更小时取更小值。
- 限制响应体、transcript 长度、事件频率和并发任务数。
- Main 同时只允许每个窗口一个任务，并设置全局并发上限。
- 窗口来源校验、workspace 校验和 preload context isolation 继续保留。
- 日志禁止写入音频 Base64、密钥和 transcript 正文。

## 9. 开发任务拆分

### B1：契约和 Fixture Runtime

- 新增任务、事件、错误和状态类型。
- 建立 runtime interface、registry 和 fixture runtime。
- 保持现有 UI 行为，先用 fixture 跑通异步生命周期。

完成标准：fixture 可产生成功、失败、超时和取消结果，类型检查通过。

### B2：Request Registry 和取消

- Main 使用 `Map<requestId, VoiceTask>` 管理 AbortController、状态和临时资源。
- 新增 preload start/cancel/event bridge。
- 处理重复取消、完成与取消竞争、窗口销毁和应用退出。

完成标准：每个请求仅一个终态，所有资源在终态后释放。

### B3：音频传输和临时存储

- 实现受限二进制 chunk IPC 或明确记录的 Base64 过渡版本。
- 完成临时文件存储、TTL、启动清理和格式校验。

完成标准：10 MB 边界、分块顺序、取消中断和异常清理测试通过。

### B4：Gateway Provider Runtime

- 确认并记录 gateway STT 契约。
- 实现 multipart 请求、认证、超时、取消和结果归一化。
- 增加 runtime health/status。

完成标准：fixture 测试全部通过；带凭证的可选 live smoke 能识别一段短音频。

### B5：Renderer Review UX

- 接入异步状态和事件。
- 增加取消、重试、丢弃和编辑确认。
- 保留原输入与选择范围，完成插入/替换。
- 展示运行时披露和可执行错误。

完成标准：所有状态可键盘操作，错误恢复不丢输入，不自动发送。

### B6：收尾和发布门禁

- 移除生产环境的静默 mock fallback。
- 补齐诊断、文档、设置迁移和 packaged smoke。
- 完成性能、隐私和资源泄漏审计。

## 10. 测试验证方案

### 10.1 单元测试

- Runtime registry：选择、不可用和显式 fixture。
- Error normalization：HTTP、网络、AbortError、timeout 和异常 payload。
- Provider parser：成功、空文本、超长文本、错误 Content-Type、恶意大响应。
- Request registry：唯一终态、取消幂等、超时、窗口销毁、竞态。
- Temp store：路径限制、chunk 顺序、大小上限、TTL、启动清理。
- MIME validation：WebM/Opus、WAV、MP4/M4A、伪造 MIME 和损坏文件。
- Transcript insertion：空输入、已有文本、光标插入、选区替换和 Unicode。

### 10.2 音频 Fixture

在测试资产中加入短小且授权明确的音频：

- `zh-short.wav`：简短中文。
- `en-short.wav`：简短英文。
- `mixed-short.webm`：中英混合，覆盖 Chromium 实际格式。
- `silence.wav`：静音。
- `noise.wav`：背景噪音。
- `clipped.wav`：削波输入。
- `corrupt.webm`：损坏文件。

标准 CI 使用 fixture runtime 验证生命周期和规范化，不依赖真实网络，也不要求真实 STT 对所有机器产生完全一致文本。

### 10.3 IPC 集成测试

- Renderer start -> Preload -> Main accepted -> completed。
- 上传中取消、转写中取消和完成瞬间取消。
- Renderer reload/window close 后 Main 清理。
- 重复事件和过期 request ID 被忽略。
- 未选择 workspace 时仍可完成普通 composer dictation；handoff 写入仍要求 workspace。
- 非受信 renderer 不能调用 voice IPC。

### 10.4 Provider Adapter 测试

- 本地 mock HTTP server 验证 multipart 字段、认证头、timeout 和 AbortSignal。
- 200 正常响应、400 格式错误、401/403 鉴权、413 过大、429 限流、5xx、非 JSON 和截断响应。
- 可选 live smoke 使用独立测试凭证，默认不在普通 CI 执行。
- Live smoke 只断言非空、语言结构和合理延迟，不记录 transcript 正文。

### 10.5 Renderer 测试

- preparing、transcribing、reviewing、failed、cancelling 全状态。
- 取消和重试按钮状态。
- 长中文/英文错误信息、窄宽输入框、深浅主题和高 DPI。
- 键盘焦点、ARIA live region、减少动画设置。
- 录音结束后波纹停止，转写期间不伪造波纹。

### 10.6 性能和泄漏测试

- 连续录音和转写 20 次，内存无持续增长。
- 10 MB 边界音频的 renderer/main 峰值内存。
- 取消后无活动 fetch、AbortController、文件句柄和临时文件。
- 应用崩溃重启后可清理过期音频。
- 记录 capture、prepare、upload、STT 和 total latency，不记录内容。

### 10.7 Windows 手工验证

- Windows 10/11。
- 内置、USB 和蓝牙麦克风。
- 麦克风权限关闭、设备拔出、睡眠恢复和网络断开。
- 开发模式和 packaged app。
- 中文、英文、中英混合、静音和噪声场景。

### 10.8 自动化命令与门禁

- `npm run typecheck`
- `npm run verify:voice-feature`
- 新增 `npm run test:voice-unit`
- 新增 `npm run test:voice-ipc`
- 新增 `npm run test:voice-provider`
- `npm run verify:ui`
- `npm run verify:visual`
- `npm run build`
- 可选 `npm run smoke:voice-provider`
- 发布前 packaged microphone smoke

任何以下情况阻止发布：生产走 mock、取消泄漏任务、失败覆盖输入、临时音频未清理、密钥或正文进入日志、无网络 CI 依赖外部服务。

## 11. 验收标准

功能验收：

- 用户录制真实中文、英文或中英混合语音后获得对应文本。
- 转写中可取消，失败后可重试，成功后可编辑和确认。
- 原有输入不丢失，转写不会自动发送。
- Runtime、隐私披露和错误原因清晰可见。

工程验收：

- UI、Preload、Main 和 runtime 之间只有类型化契约。
- 生产环境不返回 mock 占位结果。
- 所有任务只有一个终态并可证明资源清理。
- 标准 CI 不依赖网络；provider adapter 有完整本地 HTTP 测试。
- 完整 build、UI、visual、voice unit、IPC 和 provider 测试通过。

安全验收：

- 无后台录音。
- 无默认原始音频持久化。
- 无密钥、Base64 音频和 transcript 正文日志。
- 路径、尺寸、时长、响应体、并发和超时均有边界。

## 12. 最终实现效果

完成 Phase B 后，Windows App 的语音按钮不再是录音演示入口，而是一条可生产使用的语音转文字链路：用户能看到真实输入波纹，停止后由明确披露的在线运行时识别语音，可随时取消或在失败后重试，并在发送前编辑确认识别结果。系统能区分设备、权限、格式、认证、网络、限流、超时和供应商错误；任务可观测、可取消、可测试，原始音频按默认隐私策略及时清理。

Phase B 同时为后续能力建立稳定边界：Phase D 的本地 Whisper 只需新增一个 `VoiceRuntime` 适配器，TTS 则可独立接入，不需要重写录音 UI、IPC 生命周期或错误处理。

## 13. 建议实施顺序和里程碑

- Milestone 1：B1 + B2，异步任务、fixture、事件和取消闭环。
- Milestone 2：B3，二进制音频和临时存储闭环。
- Milestone 3：B4，真实 gateway STT 和 provider 测试闭环。
- Milestone 4：B5，review UX 和错误恢复闭环。
- Milestone 5：B6，性能、隐私、packaged smoke 和发布门禁。

每个 milestone 独立合并并保持 `npm run build` 与现有验证绿色。真实 provider 未通过 Milestone 3 验收前，不把当前 Stage 1 标记为生产可用。
