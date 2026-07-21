# Windows 流式语音交互完整开发方案

最后更新：2026-07-18

阶段：第二阶段规划

目标应用：`apps/desktop/windows`

前置基线：[串行语音交互完整开发方案](./serial-voice-interaction-development-plan.md)

## 1. 文档目的

本方案定义 Windows App 第二阶段“流式语音交互”的产品范围、系统边界、模块拆分、功能清单、测试方案、指标和发布门禁。

第二阶段不是对第一阶段的替换。应用必须长期同时提供两种模式：

| 模式 | 稳定标识 | 链路 | 主要价值 |
| --- | --- | --- | --- |
| 串行语音 | `serial` | 完整录音 -> 整段 STT -> 审核 -> LLM -> 整段 TTS | 可靠、可审核、可降级、便于精确输入 |
| 流式语音 | `streaming` | 音频分块 -> 临时/最终 STT -> LLM Token -> 分段 TTS -> 队列播放 | 更早看到转写、更早听到回复、降低等待感 |

任何第二阶段改动都不得删除、隐式改写或降低串行模式能力。串行模式的现有测试是第二阶段发布的强制回归门禁。

## 2. 范围与非目标

### 2.1 本阶段目标

- 用户可以在串行和流式模式之间明确选择。
- 流式模式下，说话期间持续显示可修订的临时转写。
- VAD、端点检测和手动停止共同决定输入结束，但默认仍保留审核发送。
- 现有 LLM 流式文本被切分为适合朗读的语义片段。
- 第一段 TTS 完成后立即播放，不等待完整回答结束。
- 用户可以暂停、继续、停止和取消整个流式回复。
- 弱网、Provider 不支持或流式任务失败时，用户可以明确切回串行模式。
- 两种模式使用统一的诊断和指标，可进行正确性、延迟、资源和稳定性对比。

### 2.2 非目标

- 不持续同时采集用户麦克风和播放 AI 音频。
- 不理解用户与 AI 的重叠语音。
- 不把简单的“检测开口后停止播放”描述为全双工。
- 不在第二阶段默认接入语音原生 Speech-to-Speech 模型。
- 不取消转写审核、隐私披露或用户主动发送控制。
- 不用流式实现替换现有整段 STT/TTS Provider 契约。

### 2.3 完成效果

```text
用户选择“流式”
-> 明确点击麦克风并授权
-> PCM 音频分块上传，界面显示临时转写
-> 检测端点或用户手动停止
-> 最终转写进入现有审核界面
-> 用户编辑并发送
-> LLM 流式返回文本
-> 文本按语义片段进入 TTS
-> 首段音频完成后立即播放，后续片段连续排队
-> 回答完成且音频队列排空
-> 回到可录音状态
```

## 3. 关键架构决策

### 3.0 实施进度

2026-07-19 第一轮已完成 P0“串行基线冻结与双模式骨架”：

- 新增共享模式类型 `serial | streaming`，默认值固定为 `serial`。
- 语音偏好 schema 从 v2 升级到 v3；v1、v2 和无版本历史数据均保留原偏好并补入串行模式，未知未来版本安全回退默认值。
- 新增模式能力推导、可用性判断和活动回合切换保护；P0 时流式 ASR 未就绪，选项明确禁用，不伪装为可用能力。
- 设置页和输入框均加入模式入口；输入框入口在高缩放紧凑布局下隐藏，设置页始终保留。
- 新增 `test:voice-mode` 和 `test:voice:serial`，并将模式测试纳入现有 `test:voice` 强制回归。
- `test:voice`、`typecheck:web`、`verify:voice-feature` 和 `verify:voice-visual` 全部通过；视觉验收覆盖默认串行、流式禁用、完整串行回合、150%/200% 错误布局和资源状态轨迹。

当前功能状态：M1-F1 已完成；M1-F2、M1-F3、M1-F4、M1-F5 已完成骨架，需随 Streaming Runtime 接入补充可用态验收；M1-F6 尚未开始。M2-M12 尚未按第二阶段功能完成，既有第一阶段能力仅作为可复用基线，不计为第二阶段完成。

2026-07-19 第二轮已完成 P1 的共享契约与离线内核第一批实现：

- `desktopApi.ts` 新增流式能力、PCM16 音频块、ACK、partial/final/endpoint、TTS 文本片段和有序音频片段契约，所有流式事件携带 session、turn 和 sequence。
- 新增流式请求与音频块严格校验：安全 ID、单声道、PCM16、16/24/48 kHz、10-200 ms 分块、字节/时长一致性和单块上限。
- 新增事件游标，拒绝跨会话、重复、跳号、倒序和终态后的晚到事件。
- 新增有界音频队列及高低水位、ACK 释放、显式 backpressure、终态拒绝和清理。
- 新增每窗口单活动会话注册表、全局并发上限、所有者取消和单一终态保护。
- 新增确定性 Fixture Streaming ASR Runtime，覆盖 accepted、audio ACK、可修订 partial、endpoint、final、completed 和 cancelled。
- 新增 `test:voice:streaming-contracts`、`test:voice:streaming`、`test:voice:all`；双模式全测试和 Node/Web 类型检查通过。

第二轮功能状态：M2-F1、M2-F3、M2-F4、M2-F5 的类型和离线验证完成；M2-F2 完成会话控制契约但尚未接入 IPC；M2-F6 尚未开始。M4-F1 完成离线有界队列内核；M4-F2 完成 ACK/序号离线内核；M5-F2 完成基础 Fixture Runtime。以上功能在真实 Main/Preload/Renderer 通路完成前不计整模块完成。

2026-07-19 第三轮已完成 P1 的 Electron 集成通路：

- Main 注册受信任的 capabilities/start/stop/cancel 控制 IPC，并通过 `MessagePortMain` 接收高频 PCM 音频块。
- Preload 为每个 session 创建独立 `MessageChannel`，只向 Renderer 暴露类型化的 start/send/stop/cancel/event API，不暴露任意 IPC 通道。
- 音频 ArrayBuffer 通过 transferable 发送，避免高频复制；终态后 Preload 主动关闭并删除端口。
- Main 将 session 绑定到创建窗口的 `webContents.id`，拒绝跨窗口 stop/cancel、跨窗口端口、重复端口和重复活动会话。
- 窗口 destroyed、应用 before-quit、completed、cancelled、failed 均清理端口、队列、监听器和会话注册。
- Main Fixture 通路已经产生连续 accepted、audio_ack、partial、endpoint、final、completed 事件；能力协商已经成为设置页和输入框模式可用性的事实来源。
- 新增生产入口打包执行的 `test:voice:streaming-main`，验证所有权、单端口、顺序、停止、取消和窗口清理；更新 `verify-voice-ipc` 覆盖全部流式通道和 MessagePort 边界。
- `test:voice:all`、Node/Web 类型检查和 `verify:voice-visual` 均通过，第一阶段完整串行回合没有回归。

第三轮功能状态：M2-F2 已完成；M2-F6 的单端口绑定、窗口销毁和重复绑定完成，重连策略待 M4 弱网恢复阶段完成；M1-F5 的真实能力协商完成。下一步进入 Renderer PCM 采集和流式转写协调器，完成可操作的 Fixture 流式输入闭环。

2026-07-19 第四轮完成 P1 Renderer 输入内核并形成可操作的 Fixture 流式听写闭环：

- 新增 AudioWorklet PCM 采集控制器，支持多声道混合、连续线性重采样、PCM16 饱和转换、20 ms 分帧、约 100 ms 批处理和停止尾帧刷新。
- 新增 committed/unstable 转写协调器，处理 partial 替换、final 原子提交、revision、事件序号、endpoint、单一终态和晚到事件。
- 修复 start 接受事件早于 Renderer 保存 session 的竞态：`start()` 返回作为 sequence 0 接受边界，后续重复 accepted 安全忽略。
- 工作区接入独立流式输入 Hook 和实时转写栏；活动期间锁定模式、设备和语言选择，最终文本复用第一阶段 `VoiceReviewBar`，串行 MediaRecorder 路径保持不变。
- P2 输入里程碑不再被 P4 流式 TTS 阻塞：只要 AudioWorklet 和 Streaming ASR 可用即可选择流式听写；回复在 P4 前明确复用完整 TTS，流式输出能力仍独立报告为不可用。
- Mock Runtime 首个音频批次产生可区分的 unstable 文本，停止后依次产生 endpoint、final、completed；视觉验收验证串行→流式→串行切换、实时文字、审核复用和活动期切换保护。
- `test:voice:streaming`、`test:voice:all`、Node/Web 类型检查、生产构建和 `verify:voice-visual` 全部通过；生产 Renderer 从 2073 增至 2079 个模块，证明流式采集代码已进入实际产品 bundle。

第四轮功能状态：M3-F1、M3-F2、M3-F3、M3-F4 完成自动化内核验证和 Fixture UI 集成；M3-F5 完成双模式波形复用的浏览器验收；M3-F6 完成能力门禁。M6-F1、M6-F2、M6-F5 完成；M6-F3 完成不抢焦点的实时展示基础，IME 专项尚待补齐；M6-F4、M6-F6 尚待完成。下一轮进入 M4 完整背压/弱网恢复与 M7 流式回合状态机。

2026-07-19 第五轮完成 M4 可靠性内核和 M7 分层回合状态机第一批实现：

- 新增 `StreamingTransportReliability`，统一维护 connecting/connected/backpressured/reconnecting/terminal 状态以及活动时间、心跳和重连计数。
- 使用虚拟时间实现连接、空闲、总时长三类独立超时；任何超时只产生一次 terminal，Main session 每秒轮询并将超时归一为可重试或不可重试失败。
- 实现有限重连策略：能力不支持、超出时间窗、次数耗尽、失败后再试和成功恢复均有确定结果；当前 Fixture 能力明确声明不支持 resume，不伪造生产续传。
- 有界队列在高水位后拒绝继续增长，ACK 降到低水位后恢复；Main 将入队和 ACK 同步到 transport 状态，session 清理同时停止计时器。
- 新增分层 `StreamingVoiceTurnState`：顶层 user/review/assistant/cancelling/completed/failed，下含 capture/ASR/LLM/TTS/playback 子任务和单一终态。
- 播放启动必须同时满足采集和 ASR 已完成；取消和失败传播到所有活动子任务；终态后的晚到事件保持引用不变并被忽略。
- 流式输入 Hook 已接入该状态机的 begin、capture_started、stop_input、asr_completed、cancel/cancelled、fail/reset 事件，不是仅供测试的旁路模型。
- 新增 `test:voice:streaming-transport` 和 `test:voice:streaming-turn-state`；后者完成完整回合、取消、失败、互斥以及 1,000 轮×100 步随机事件压力测试。
- `test:voice:all`、Node/Web 类型检查和生产构建全部通过；Main/Renderer 新内核均进入生产 bundle，串行测试零回归。

第五轮功能状态：M4-F1、M4-F2、M4-F5 完成；M4-F3 完成高低水位强制内核，用户慢网提示和 Renderer 主动暂停仍待 UI 事件接入；M4-F4 完成有限重连策略内核，待生产 Provider 接入后验证真实续传；M4-F6 已有会话数、格式、时长和单块限制，累计字节及错误脱敏仍待补齐。M7-F1、M7-F2、M7-F3 完成内核；M7-F4 已接入输入侧，需在 LLM/TTS 阶段完成全链传播；M7-F5、M7-F6 尚待后续轮次。

2026-07-19 第六轮完成 M4 用户可见流控、安全配额和 M5 Streaming ASR Runtime/生产适配器边界：

- 共享事件新增有序 `flow_control` 和 `connection_state`；Main 统一重排 Runtime 与基础设施事件序号，避免 ACK、流控和 Provider 文本事件互相争用 sequence。
- 高水位发出 pause、ACK 降至低水位发出 resume；Renderer Hook 保存流控状态，实时转写栏以 `role=status` 显示“连接较慢”，视觉 Fixture 已实际触发并验收。
- Main session 增加累计音频毫秒和累计 PCM 字节配额；120 秒边界测试发送 1,201 个批次，断言唯一 `duration_exceeded` 终态、端口关闭和错误无凭据/端点泄漏。
- 新增正式 `StreamingTranscriptionRuntime`/Factory 契约，覆盖 start/pushAudio/endInput/cancel/dispose、Runtime ID 和能力对象；Fixture 实现同一接口。
- 新增 WebSocket Streaming ASR 生产适配器：连接期有限缓冲、Main-only token 握手、PCM 元数据+二进制帧、ACK/partial/final/endpoint/error/completed 映射和取消/清理。
- Provider URL 只允许 `wss://` 或 loopback `ws://`，拒绝 URL 内嵌凭据、fragment、普通远程 WS；Provider 文本事件限制 256 KB。
- 生产能力协商改为诚实门禁：仅 Fixture 或配置了合法 `OPENDRSAI_STREAMING_STT_WS_URL` 时声明 Streaming STT；未配置时禁止启动，不再默认暴露 Fixture 能力。
- 新增稳定错误归一：认证、限流、网络、超时、格式、配额、Provider、取消；错误消息统一去除密钥、token、Authorization、端点和换行，并限制长度。
- 新增 `test:voice:streaming-runtime-errors`、`test:voice:streaming-provider`，覆盖握手、连接缓冲、PCM、协议事件、429、URL 安全及脱敏；`verify:voice-visual`、`test:voice:all`、类型检查和生产构建全部通过。

第六轮功能状态：M4-F3 的用户提示和有序流控事件完成，Renderer 对 Worklet 的真正暂停/无损续发仍需随异步 Provider 压测优化；M4-F6 完成。M5-F1、M5-F2、M5-F3、M5-F5、M5-F6 完成；M5-F4 已完成首个通用 WebSocket Provider 适配器及 Mock 协议验收，真实账号 Live Smoke 仍是发布门禁，不能在无凭据环境宣称完成。下一轮补齐 M6 VAD/空输入/IME，并进入 M8 LLM 文本语义切片。

2026-07-19 第七轮完成 M6 端点/审核边界和 M8 LLM 流式文本语义切片：

- 新增本地 PCM16 VAD：RMS 门限、最短有效语音、短停顿容忍、有效语音后静音端点、初始长静音空输入和可重置终态。
- AudioWorklet 批次在 transferable 发送前同步进入 VAD；本地端点通过扩展后的 stop IPC 以 `local_vad` 原因结束，Provider endpoint 到达时立即关闭采集并推进状态机。
- 明确端点优先级为 manual > provider > local_vad；单元测试覆盖静音、低幅噪声、短停顿、长停顿、有效语音和重复终态。
- completed 无有效文字时不创建 `VoiceReviewBar`，显示“No speech detected”；final confidence 低于阈值时保留审核但显示复核警告。
- 流式审核 Retry 已独立重启流式采集，不再错误调用串行 Blob 重试；审核 textarea 在 IME composition 期间禁用 Insert，compositionend 后恢复。
- 新增中英文语义切片器：句末标点、换行、英文缩写、小数、URL、首段低延迟、普通段阈值、最大长度和 final flush。
- fenced code 即使跨任意 SSE chunk 边界也被状态化过滤；reasoning、progress、tool 和隐藏结构事件不进入朗读流。
- 现有 legacy `chunk` 与 structured `markdown.append` 两条可见正文路径统一发布 speech stream；done flush 尾段，aborted/error 清空，不重复消费 reasoning。
- ChatWorkspace 已订阅有序 speech segments，并暴露队列数量和完成状态供下一轮 TTS 调度；视觉 Fixture 真实提交一次 structured chat，验证 SSE 正文产生至少一个完成片段。
- 新增 `test:voice:streaming-vad`、`test:voice:streaming-segmenter`；随机 chunk 边界、代码跨块、IME、Mock SSE 集成、`test:voice:all`、类型检查、视觉和生产构建全部通过。

第七轮功能状态：M6-F1、M6-F2、M6-F3、M6-F4、M6-F5、M6-F6 的代码与离线/Fixture 验收完成；真实设备 VAD 语速矩阵留在 M12 Windows 门禁。M8-F1、M8-F2、M8-F3、M8-F4、M8-F5、M8-F6 完成代码与确定性测试，最终文本一致性哈希报告将在 M12 对比工具中生成。下一轮进入 M9 Streaming TTS Runtime/调度器和 M10 有序播放队列。

2026-07-19 第八轮完成 M9 分段 TTS 调度和 M10 有序播放产品闭环：

- 新增 `StreamingTtsRuntime` 与 Desktop task adapter，把每个 M8 文本片段映射到现有受信任 Main TTS Runtime；Provider request ID 与 session/turn/message/segment identity 严格对应。
- 新增一合成中+一待合成的硬上限调度器；拒绝重复 segment ID/index，完成后按输入顺序推进，不因长回复无界并发。
- 片段级重试仅处理 retryable 错误，逻辑 segment identity 保持不变；认证等不可重试错误立即失败；取消同时 abort 活动任务、删除 pending 并 dispose Runtime。
- Fixture 复用现有确定性 WAV Main Runtime；故障注入覆盖 429 两次失败后恢复、认证失败、取消和同步终态竞态。
- 生产 Streaming TTS 能力独立协商：仅显式配置 fixture 或 gateway-provider task Runtime 时为 true；系统 TTS 不伪装成远程分段合成。
- 新增严格有序播放队列：乱序片段先缓存，只播放连续 index；缺段进入 draining，重复和晚到片段拒绝，buffer 数量有硬上限。
- Browser adapter 使用 Blob URL 播放，支持暂停/继续、停止归零、播放失败和 URL exactly-once 回收；同步 `onended` 也不会留下 stale handle。
- ChatWorkspace 只有“流式听写→审核插入→成功发送”的回合才 arm 自动流式输出；普通键盘提问不会意外朗读。
- 新增生成/缓冲/播放/暂停状态条及 pause/resume/stop 控件；播放中的合成事件不会覆盖 playback UI 状态。
- 视觉 Fixture 实际完成流式听写、审核、发送、structured SSE 切片、Main Fixture TTS、Audio 播放、暂停、继续和排空；随后仍可切回串行完成原回合。
- 新增四套测试：scheduler、ordered playback、Desktop TTS adapter、browser audio adapter；`test:voice:all`、视觉、类型检查和生产构建全部通过。

第八轮功能状态：M9-F1、M9-F2、M9-F3、M9-F4、M9-F5 完成；M9-F6 已接入现有 gateway-provider 分段任务路径并具备明确 system fallback 门禁，真实 Provider Live 仍归 M12。M10-F1、M10-F3、M10-F4、M10-F6 完成；M10-F2 已做到 ended 回调立即无缝推进，但 Web Audio 预解码与实际段间隙阈值尚待补齐；M10-F5 已能从播放错误释放资源且不锁 UI，设备切换事件和恢复验收尚待完成。下一轮完成 M7 全链状态/取消以及 M11 UI、诊断和无障碍。

### 3.1 双模式隔离

统一偏好只负责选择控制器，不在串行控制器内部散布 `if (streaming)`：

```ts
type VoiceInteractionMode = "serial" | "streaming";

interface VoiceModeController {
  readonly mode: VoiceInteractionMode;
  startTurn(): Promise<void>;
  stopInput(): Promise<void>;
  cancelTurn(): Promise<void>;
  dispose(): Promise<void>;
}
```

共享设备、权限、波形、错误、诊断和消息模型；串行与流式分别拥有采集、转写协调和播放调度实现。模式只能在无活动语音回合时切换。

### 3.2 级联、半双工

第二阶段继续采用可审计的级联架构：

```text
Renderer AudioWorklet
  -> MessagePort 音频通道
  -> Main Streaming ASR Runtime
  -> Gateway/Provider
  -> 临时与最终转写事件
  -> 现有聊天 SSE
  -> 语义切片器
  -> Streaming TTS Runtime
  -> 有序音频播放队列
```

用户输入与 AI 输出严格互斥。播放期间默认不打开麦克风；简单插话只能作为后续可选能力，在检测用户明确开口后终止旧输出并开始新回合。

### 3.3 PCM 音频契约

流式采集使用 `AudioWorklet` 输出单声道 PCM16。目标采样率默认 16 kHz，每帧 20 ms，合并约 100 ms 后发送。不得假设 `MediaRecorder.start(timeslice)` 产生的每个 WebM/Ogg 块都能被 Provider 独立解码。

串行模式继续使用现有 `MediaRecorder` 完整 Blob，不因流式采集器加入而改变。

### 3.4 传输与背压

高频音频使用 Electron `MessageChannel`/`MessagePort`，控制命令和低频状态继续使用类型化 IPC。每个音频块包含 `sessionId`、`turnId`、`sequence`、时间戳和格式信息。

发送队列必须有上限。达到高水位后暂停读取或丢弃尚未提交的最旧临时帧并产生可观测事件；不得无限积压或静默丢失最终音频。

### 3.5 转写文本模型

实时转写由两部分组成：

```ts
interface StreamingTranscriptState {
  committedText: string;
  unstableText: string;
  revision: number;
}
```

`unstableText` 可以被 Provider 后续结果替换；只有 final 事件才能进入 `committedText`。用户手动编辑过的已提交文本不得被晚到的 partial 覆盖。

### 3.6 流式回复模型

现有聊天 SSE `chunk` 是唯一 LLM 文本事实来源。TTS 只消费已经显示或即将显示的助手正文，不朗读 reasoning、工具参数、隐藏结构事件或尚未确认的内容。

文本切片和音频片段都使用递增序号。播放器只能按序提交，晚到的旧会话片段必须丢弃。

## 4. 目标目录和代码边界

建议增量结构如下；第一轮开发不强制移动现有串行文件：

```text
src/shared/
  desktopApi.ts                         # 双模式、能力、流式事件契约

src/renderer/src/voice/
  serial/                               # 后续仅做无行为变化的归档
  streaming/
    pcmCaptureWorklet.ts
    streamingCaptureController.ts
    transcriptReconciler.ts
    streamingVoiceSessionReducer.ts
    speechSegmenter.ts
    streamingPlaybackQueue.ts
    useStreamingVoiceInput.ts
    useStreamingVoiceReply.ts
  shared/
    voiceMode.ts
    voiceMetrics.ts

src/main/voiceStreaming/
  sessionRegistry.ts
  audioPort.ts
  backpressureQueue.ts
  streamingAsrRuntime.ts
  streamingTtsRuntime.ts
  ttsSegmentScheduler.ts
  fixtureStreamingRuntime.ts

cores/python/packages/drsai/src/drsai/backend/
  gateway.py                            # 或拆出受限 streaming voice router

scripts/
  test-streaming-voice-*.mjs
  verify-streaming-voice-*.mjs
  verify-voice-mode-comparison.mjs
```

## 5. 模块与逐项验收

完成状态只能按功能 ID 标记。功能必须同时满足实现、自动化测试和所需人工/真机验收，才能记为完成。

### M1 双模式产品入口与偏好

目标：让串行和流式成为明确、稳定、可恢复的并行模式。

| ID | 功能 | 实现要求 | 自动化测试 | 人工/真机验收 |
| --- | --- | --- | --- | --- |
| M1-F1 | 模式类型与默认值 | 增加 `serial/streaming` 类型；新安装和迁移失败时默认 `serial` | 单元测试缺省值、未知值、旧偏好迁移 | 清理用户数据后首次启动显示串行模式 |
| M1-F2 | 设置页模式选择 | 语音设置提供“串行（可靠）”“流式（低延迟）”及简短差异说明 | 组件测试选中、保存、重启恢复 | 150%/200% 缩放下文案和控件不溢出 |
| M1-F3 | 输入框快捷选择 | 麦克风附近可查看和切换模式，不占用发送按钮语义 | Playwright 验证键盘、鼠标、读屏名称和焦点顺序 | 窄窗口下不遮挡推理、麦克风和发送控件 |
| M1-F4 | 活动回合切换保护 | 录音、转写、生成或播放时禁止直接切换；可先取消再切换 | 状态测试覆盖所有活动相位和取消后切换 | 播放中切换时提示明确且无残留音频 |
| M1-F5 | 能力感知与不可用状态 | Provider 不支持 Streaming ASR/TTS 时禁用相应模式并显示原因 | Fixture 能力矩阵测试四种组合 | 无密钥、网关离线和 Provider 不支持场景正确显示 |
| M1-F6 | 显式降级 | 流式失败后提供“重试流式”与“下一回合使用串行”，不静默改模式 | 错误恢复测试验证选择和持久化范围 | 断网后可以无重启切回串行完成一轮 |

### M2 共享契约、能力协商与 IPC

目标：形成可版本化、可校验、不会混淆不同回合的流式协议。

| ID | 功能 | 实现要求 | 自动化测试 | 人工/真机验收 |
| --- | --- | --- | --- | --- |
| M2-F1 | Runtime 能力契约 | 分别声明 serial/streaming STT/TTS、格式、采样率和限制 | 契约测试覆盖完整、缺失和矛盾能力响应 | Provider 切换后设置页能力即时更新 |
| M2-F2 | 会话控制契约 | 定义 start/stop/cancel/status，所有操作包含 session/turn ID | IPC 测试验证请求来源、字段和单一终态 | DevTools 不暴露任意文件、URL 或命令能力 |
| M2-F3 | 音频块契约 | 定义 sequence、timestamp、PCM 格式和 transferable buffer | 边界测试覆盖零长度、超限、错格式、重复序号 | 长录音期间 Renderer 无明显卡顿 |
| M2-F4 | 转写事件契约 | 定义 partial/final/endpoint/completed/failed/cancelled | 事件解析测试覆盖乱序、重复、晚到和未知事件 | UI 状态与诊断事件一致 |
| M2-F5 | TTS 片段契约 | 定义 text/audio segment index、格式、终态和取消 | 契约测试覆盖缺段、重复段、跨会话污染 | 快速连续两轮不会播放上一轮音频 |
| M2-F6 | MessagePort 生命周期 | 端口仅绑定一个窗口和会话，销毁窗口时主动关闭 | IPC 集成测试覆盖窗口销毁、重连和端口重复绑定 | 关闭窗口后麦克风和网络连接立即释放 |

### M3 PCM 采集、重采样与波形复用

目标：稳定获得适合 Streaming ASR 的音频帧，同时不影响串行采集。

| ID | 功能 | 实现要求 | 自动化测试 | 人工/真机验收 |
| --- | --- | --- | --- | --- |
| M3-F1 | AudioWorklet 采集 | 在用户授权后创建 Worklet；输出 Float32 帧 | 合成正弦、静音、削波输入测试帧数和数值范围 | 内置、USB、蓝牙麦克风均可启动和停止 |
| M3-F2 | 单声道混合 | 多声道输入按确定规则混合为单声道 | 左/右单独信号、反相信号和单声道测试 | 立体声设备说话不会出现明显音量异常 |
| M3-F3 | 重采样与 PCM16 | 将设备采样率转换为协商采样率，饱和转换为 PCM16 | 44.1/48/96 kHz fixture 测时长误差、边界和频率 | 录制固定时长，Provider 报告时长误差在阈值内 |
| M3-F4 | 分帧与批处理 | 20 ms 帧、约 100 ms 发送批次，停止时刷新尾帧 | 单元测试验证各种长度无重复、无遗漏 | 慢速 CPU 下不产生周期性爆音或大块延迟 |
| M3-F5 | 波形共享 | 波形继续使用真实振幅；串行和流式外观一致 | 现有波形测试分别在两种模式运行 | 静音平直、右进左移、宽度响应输入框 |
| M3-F6 | 兼容降级 | AudioWorklet 不可用时明确提示使用串行，不伪造流式 | 能力注入测试覆盖缺少 Worklet/AudioContext | 受限环境中仍可切回串行录音 |

### M4 音频传输、背压与弱网恢复

目标：在网络和 Provider 处理速度波动时保持有界资源和明确行为。

| ID | 功能 | 实现要求 | 自动化测试 | 人工/真机验收 |
| --- | --- | --- | --- | --- |
| M4-F1 | 有界发送队列 | 定义低/高水位、最大缓冲毫秒数和队列指标 | 压力测试让消费端变慢，断言内存与队列上限 | 网络限速时界面保持可操作 |
| M4-F2 | ACK 与序号 | Main/Provider 确认已消费序号，过滤重复或倒退 ACK | 属性测试生成乱序、重复、缺失序号 | 诊断面板能看到最后发送/确认序号 |
| M4-F3 | 背压策略 | 高水位时暂停批次提交或执行显式丢弃策略并告警 | 慢消费者测试验证无静默丢帧和无无限增长 | 极弱网时用户收到“连接较慢”提示 |
| M4-F4 | 短暂重连 | 未终止回合可在有限窗口内重连；不支持续传时明确终止 | Fixture 模拟断开、恢复、续传支持/不支持 | Wi-Fi 短断后结果无重复文本 |
| M4-F5 | 超时与心跳 | 区分连接、空闲、端点和总时长超时 | 虚拟时钟测试各超时只有一个终态 | Provider 无响应时可立即取消或切回串行 |
| M4-F6 | 安全限制 | 限制会话数、采样率、比特率、时长和累计字节 | 滥用测试覆盖超限、跨窗口和伪造 session | 超限错误不泄露密钥或内部地址 |

### M5 Streaming ASR Runtime 与 Gateway

目标：通过统一适配器支持 Fixture 和至少一个生产 Streaming ASR Provider。

| ID | 功能 | 实现要求 | 自动化测试 | 人工/真机验收 |
| --- | --- | --- | --- | --- |
| M5-F1 | Runtime 接口 | 定义 connect/pushAudio/endInput/cancel/events/dispose | 适配器契约测试对 Fixture 和生产适配器运行同一套案例 | Runtime 状态和 Provider 披露准确 |
| M5-F2 | Fixture Runtime | 可编排 partial 修订、final、endpoint、错误和延迟 | 固定脚本结果完全确定，可在 CI 离线运行 | 开发模式可完整演示流式输入 |
| M5-F3 | Gateway 认证 | 密钥只在 Main/Gateway 使用，Renderer 不接触凭据 | 安全测试扫描 preload API、日志和错误体 | DevTools 和诊断导出中无密钥 |
| M5-F4 | 首个生产适配器 | 只选一个 Provider 完成协议映射、错误归一和取消 | Mock WebSocket/HTTP 测握手、事件、错误和关闭码 | 使用真实账号完成中英文 Live Smoke |
| M5-F5 | Provider 能力映射 | 映射采样格式、语言、partial、endpoint 和续传能力 | 能力快照测试防止字段变化静默降级 | 不支持能力在 UI 中被准确禁用 |
| M5-F6 | 错误归一化 | 认证、限流、网络、音频、Provider、超时均映射为稳定错误码 | 错误矩阵逐项断言 retryable 和 userAction | 用户看到可行动提示而非原始协议错误 |

### M6 临时转写协调、审核与端点

目标：正确处理会被修订的实时文本，并复用第一阶段审核发送流程。

| ID | 功能 | 实现要求 | 自动化测试 | 人工/真机验收 |
| --- | --- | --- | --- | --- |
| M6-F1 | committed/unstable 模型 | partial 只替换 unstable，final 原子提交并清空 unstable | 中英文标点、空白、重复前缀和完全改写测试 | 临时文字视觉上可区分但不闪烁 |
| M6-F2 | 修订与版本 | revision 单调递增；旧 revision 和旧 session 事件被忽略 | 乱序/重复/晚到事件属性测试 | 快速停止再重录不会串入旧文字 |
| M6-F3 | 光标稳定 | 流式文本显示不抢用户输入焦点；审核阶段才允许自由编辑 | DOM 测试选择区、组合输入和光标位置 | 中文输入法编辑审核文本正常 |
| M6-F4 | VAD 与端点 | 支持 Provider 端点、本地 VAD 提示和手动停止；优先级明确 | 虚拟音频测试静音、短停顿、长停顿和背景噪声 | 不同语速下不会频繁截断句子 |
| M6-F5 | 审核复用 | 最终转写进入现有 `VoiceReviewBar`，默认不自动发送 | Playwright 验证编辑、插入、丢弃、重试、发送 | 与串行审核体验和快捷键一致 |
| M6-F6 | 空输入与低置信度 | 无有效语音不创建消息；低置信度提示复核 | Fixture 测空白、噪声、低置信度和无 final | 安静环境和纯噪声不会误发消息 |

### M7 流式会话与回合状态机

目标：表达内部并行处理，同时保持用户与 AI 的半双工发言权。

| ID | 功能 | 实现要求 | 自动化测试 | 人工/真机验收 |
| --- | --- | --- | --- | --- |
| M7-F1 | 分层状态 | 顶层 user/review/assistant/cancelling/failed；采集、识别、输出为子状态 | Reducer 表驱动测试所有合法和非法转换 | 诊断轨迹可还原完整回合 |
| M7-F2 | 输入输出互斥 | 播放前确认采集和 ASR 已终止；录音前停止所有播放 | 竞态测试覆盖双击、快速停止、自动朗读和新录音 | 无麦克风与扬声器同时活动 |
| M7-F3 | 单一终态 | 每个子任务及整个回合只允许 completed/cancelled/failed 之一 | 1,000 次随机事件压力测试零双终态 | 快速操作不产生卡死控件 |
| M7-F4 | 统一取消 | 一次取消传播到采集、ASR、LLM、TTS 和播放器 | 集成测试在每个阶段取消并检查资源 | 任意阶段点击停止后能开始新回合 |
| M7-F5 | 重试边界 | ASR 可重连、TTS 片段可有限重试；不得重复提交聊天消息 | 故障注入测试请求计数和消息唯一性 | Provider 抖动时不重复朗读整段 |
| M7-F6 | 窗口与应用生命周期 | 刷新、关闭、休眠和恢复触发明确清理或恢复策略 | 窗口销毁和模拟 suspend/resume 测试 | Windows 睡眠恢复后可重新录音 |

### M8 LLM 流式文本与语义切片

目标：复用现有聊天 SSE，把可朗读正文稳定切为 TTS 片段。

| ID | 功能 | 实现要求 | 自动化测试 | 人工/真机验收 |
| --- | --- | --- | --- | --- |
| M8-F1 | 正文事件接入 | 只消费当前助手消息的可见正文 `chunk` | SSE Fixture 测跨消息、重连、重复 chunk | 屏幕文字与朗读内容一致 |
| M8-F2 | 中英文切片器 | 支持句末标点、换行、缩写、小数、URL、代码和长度阈值 | 语料表驱动测试中英文及混合文本 | 常见回复停顿自然，不逐 Token 朗读 |
| M8-F3 | 首段低延迟策略 | 首段使用较小阈值，设置最小字符/等待时间避免碎片 | 虚拟时钟测试首段触发点和短句结束 | 首音频明显早于完整回复完成 |
| M8-F4 | 结构化内容过滤 | 不朗读 reasoning、工具参数、隐藏元数据；代码块按策略处理 | 结构化消息 Fixture 逐类验证 | 工具调用时不读出 JSON 或内部事件 |
| M8-F5 | Final flush | `done` 时刷新剩余文本；error/aborted 时按策略保留或丢弃 | 流尾无标点、错误、取消测试无文本遗漏 | 短回答和无标点回答均可完整朗读 |
| M8-F6 | 文本去重与一致性 | TTS 片段拼接规范化后等于允许朗读的最终正文 | 属性测试随机 chunk 边界下保持一致 | 对比报告记录文本一致性哈希 |

### M9 Streaming TTS Runtime 与片段调度

目标：按序合成多个语义片段，尽快产生首段音频并保持资源有界。

| ID | 功能 | 实现要求 | 自动化测试 | 人工/真机验收 |
| --- | --- | --- | --- | --- |
| M9-F1 | Runtime 接口 | 定义 synthesizeSegment/cancel/status/dispose 和格式能力 | Fixture、生产适配器运行统一契约套件 | Runtime/声音/语言披露准确 |
| M9-F2 | Fixture TTS | 可配置片段延迟、错误、乱序和确定性 WAV | 音频签名、时长、顺序和故障注入测试 | 离线环境可演示完整流式回复 |
| M9-F3 | 有界调度器 | 默认一个合成中、一个待合成，可按能力配置但保持上限 | 长回复压力测试队列和内存上限 | 10 分钟回复不会持续积压 |
| M9-F4 | 严格片段顺序 | 每段带 index；晚到片段缓存或丢弃，绝不越序播放 | 乱序完成、重复完成和缺段超时测试 | 人耳验证段落不倒序、不重复 |
| M9-F5 | 片段级重试 | 只对可重试错误有限重试，保持同一逻辑 segment ID | 429/5xx/超时/认证错误矩阵测试 | 临时失败恢复后不重复朗读已播内容 |
| M9-F6 | Provider 适配与降级 | 接入至少一个支持低延迟输出的生产 TTS；系统 TTS 仅作为明确降级 | Mock Provider 和系统降级路径测试 | Live Provider 中英文声音与语速可用 |

### M10 音频播放队列与控制

目标：连续、可控地播放分段音频，并在停止时快速清空所有状态。

| ID | 功能 | 实现要求 | 自动化测试 | 人工/真机验收 |
| --- | --- | --- | --- | --- |
| M10-F1 | 有序播放队列 | 只播放连续 index；区分 buffering/playing/draining/completed | Fake AudioContext 测排队、缺段和最终排空 | 首段播放时后续仍可合成 |
| M10-F2 | 连续衔接 | 预解码下一段并减少非语义空隙，不截断音素 | 合成音频测段间隙和重复采样阈值 | 耳听无明显点击声和异常长停顿 |
| M10-F3 | 暂停与继续 | 暂停保持当前进度和队列，不继续提交无限音频 | 虚拟播放器测试时间偏移和队列水位 | 暂停数秒后从正确位置继续 |
| M10-F4 | 停止与取消 | 停止当前节点、清空队列、取消 TTS/LLM，目标延迟可测 | 高分辨率计时测试 P95 停止延迟 | 点击停止后无尾音和后续复播 |
| M10-F5 | 输出设备变化 | 设备丢失时失败可恢复；支持系统默认设备变化 | Mock devicechange 和播放错误测试 | 蓝牙断连、切换扬声器后 UI 不锁死 |
| M10-F6 | 自动朗读策略 | 复用现有偏好；默认关闭；仅流式语音回合自动进入队列 | 偏好和消息来源矩阵测试 | 普通文字提问不会被意外自动朗读 |

### M11 UI、可访问性、隐私与诊断

目标：让用户清楚当前模式、临时状态、数据去向和恢复操作。

| ID | 功能 | 实现要求 | 自动化测试 | 人工/真机验收 |
| --- | --- | --- | --- | --- |
| M11-F1 | 模式和阶段可见 | 显示正在聆听、实时转写、审核、生成、缓冲和播放 | Playwright 断言状态轨迹和无非法转换 | 状态变化易理解且不造成布局跳动 |
| M11-F2 | 临时转写视觉 | unstable 与 committed 有非颜色唯一的区分，减少闪烁 | DOM、reduced motion、对比度和 axe 测试 | 高对比度和浅/深色主题均清晰 |
| M11-F3 | Provider 与隐私披露 | 开始前可知音频/文本发送位置、保留策略和降级模式 | 文案契约与 Runtime ID 映射测试 | 不同 Runtime 下披露与实际链路一致 |
| M11-F4 | 可行动错误 | 错误展示阶段、原因、重试、切串行和设置入口 | 错误矩阵截图测试 100/150/200% 缩放 | 长中英文错误不溢出、不遮挡按钮 |
| M11-F5 | 诊断事件 | 记录序号、水位、partial/final 计数、端点、片段和延迟，不记录原始音频 | 诊断 schema、脱敏和导出测试 | 用户可导出报告且不存在音频/密钥 |
| M11-F6 | 无障碍控制 | 所有模式、录音、停止、审核和播放控件支持键盘与读屏 | axe、焦点顺序、ARIA live 节流测试 | Narrator 可读出关键状态但不逐字轰炸 |

### M12 测试体系、对比评测与发布门禁

目标：证明流式模式有效，同时证明第一阶段没有被冲掉。

| ID | 功能 | 实现要求 | 自动化测试 | 人工/真机验收 |
| --- | --- | --- | --- | --- |
| M12-F1 | 串行强制回归 | 保留现有 `test:voice`、视觉、打包和发布门禁 | 每个流式 PR 必须运行串行单元/IPC/状态/E2E | 串行模式真机完成完整回合 |
| M12-F2 | 流式单元套件 | 覆盖 PCM、背压、协调器、状态机、切片器和队列 | `npm run test:voice:streaming` 全部离线确定性通过 | 无 |
| M12-F3 | 流式 IPC/集成套件 | 真实 Main/Preload/Renderer 契约配 Fixture Runtime | `npm run verify:voice:streaming-ipc` | 打包应用内事件、取消和清理一致 |
| M12-F4 | 沙箱全回合 | 模拟点击、音频输入、partial/final、审核、LLM、分段 TTS 和播放 | Playwright 验证完整轨迹、文本与音频顺序 | 截图和 JSON 报告可复查 |
| M12-F5 | 双模式对比 | 同一音频/回答 Fixture 运行两种模式，输出正确性与延迟报告 | `npm run verify:voice:comparison` 生成机器可读报告 | 人工复听同一语料，记录质量差异 |
| M12-F6 | 压力与泄漏 | 长会话、反复取消、慢消费者和多轮执行 | 100/1,000 轮测试检查内存、句柄、监听器和临时文件 | 30 分钟真实会话无持续资源增长 |
| M12-F7 | Live Provider 门禁 | 生产 ASR/TTS 各完成真实凭据 Smoke，证据不入库敏感数据 | 受环境控制的 live 脚本输出脱敏报告 | 中英文、弱网、取消和限流场景通过 |
| M12-F8 | Windows 设备矩阵 | Windows 10/11，内置/USB/蓝牙输入输出，睡眠和设备切换 | 自动收集环境与结果，不能伪造硬件通过 | 矩阵负责人签字并附脱敏证据 |

## 6. 测试命令规划

第二阶段实施时新增以下脚本，名称可以按仓库规范微调，但职责必须保持分离：

```text
npm run test:voice:serial
npm run test:voice:streaming
npm run test:voice:all

npm run verify:voice:streaming-ipc
npm run verify:voice:streaming-visual
npm run verify:voice:streaming-packaged
npm run verify:voice:comparison
npm run verify:voice:streaming-live

npm run verify:voice:serial-release-ready
npm run verify:voice:streaming-release-ready
npm run verify:voice:release-ready
```

最终 `verify:voice:release-ready` 必须先执行串行门禁，再执行流式门禁。不得因为流式模式仍处于实验状态而跳过串行回归。

## 7. 统一指标与验收阈值

每个回合记录模式、Runtime 和设备类别，但不得记录原始音频或完整敏感转写。

| 指标 | 定义 | 第二阶段目标 |
| --- | --- | --- |
| `timeToFirstTranscriptMs` | 首块有效音频到首个 partial | 正常网络 P95 <= 500 ms |
| `timeToFinalTranscriptMs` | 用户停说到 final | 正常网络 P95 <= 1,000 ms |
| `timeToFirstLlmTokenMs` | 发送到首个可见正文 chunk | 保持现有聊天基线且可观测 |
| `timeToFirstAudioMs` | 首个正文 chunk 到首段开始播放 | 正常网络 P95 <= 1,200 ms |
| `cancelLatencyMs` | 用户停止到采集/播放实际停止 | P95 <= 150 ms |
| `peakAudioBacklogMs` | 未被 Provider 消费的音频时长峰值 | 不超过配置硬上限，默认 2,000 ms |
| `peakTtsSegments` | 合成中、待合成和待播放片段峰值 | 不超过配置硬上限 |
| `transcriptConsistency` | final 转写与审核初始值的一致性 | 100%，除显式规范化 |
| `speechTextConsistency` | 已调度 TTS 文本与允许朗读正文的一致性 | 100% |
| `invalidTransitionCount` | 非法状态转换次数 | 0 |
| `resourceLeakCount` | 回合后残留轨道、端口、任务、节点、定时器 | 0 |

延迟阈值必须分别记录 Fixture、局域网 Live 和真实广域网结果。Fixture 用于回归，不能替代 Live 性能结论。

## 8. 实施里程碑与依赖

### P0 基线冻结

- 校准语音总览和串行完成状态。
- 为现有串行测试建立稳定入口和基线报告。
- 增加模式类型，但默认和行为保持 `serial`。

退出条件：现有串行门禁结果可复现，模式开关不会改变串行行为。

### P1 流式输入内核

包含 M1、M2、M3、M4 的基础能力，以及 M5 Fixture Runtime。

退出条件：离线 Fixture 下 PCM 分块、背压、取消、partial/final 事件稳定；串行回归全通过。

### P2 流式听写产品闭环

完成 M5 生产 ASR、M6、M7 输入侧和 M11 对应 UI。

退出条件：用户说话时看到实时文字，停止后进入原有审核发送；一个真实 Provider Live Smoke 通过。

### P3 流式回复内核

完成 M8、M9 Fixture Runtime、M10 播放队列。

退出条件：离线 Fixture 下 LLM 尚未完成时首段已经播放，顺序、取消和资源上限全部通过。

### P4 流式回复生产闭环

完成生产 TTS、UI、诊断、打包和 Live 验证。

退出条件：真实 Provider 达到首音频指标，完整回合和取消可用。

### P5 双模式对比与发布

完成 M12 全部门禁、Windows 设备矩阵和对比报告。

退出条件：串行与流式发布门禁同时通过；流式在首转写和首音频方面具有可量化优势，且最终文本正确性不退化。

## 9. 风险与控制

| 风险 | 影响 | 控制措施 |
| --- | --- | --- |
| WebM/Ogg 小块不能独立解码 | Provider 拒绝后续音频块 | 使用协商后的 PCM16；串行继续使用完整 Blob |
| partial 频繁修订 | 文本闪烁、覆盖用户编辑 | committed/unstable 分离；编辑只在审核阶段开放 |
| IPC 高频调用阻塞 Renderer | 波形和输入卡顿 | MessagePort、100 ms 批处理、transferable buffer |
| 弱网造成内存无限增长 | 崩溃或高延迟 | 有界队列、高低水位、超时和显式降级 |
| TTS 逐 Token 合成 | 碎片化、成本高、语音不自然 | 中英文语义切片、最小长度和最大等待时间 |
| TTS 片段乱序完成 | 朗读顺序错误 | segment index、有序提交和缺段超时 |
| 流式失败影响串行模式 | 丢失可靠降级路径 | 独立控制器、独立 Runtime、串行强制回归门禁 |
| Provider 协议快速变化 | 维护成本和行为漂移 | Runtime 适配层、能力快照、契约测试 |
| 把简单打断误认为全双工 | 产品承诺失真 | 第二阶段保持半双工；重叠理解另行立项 |

## 10. 开发完成定义

第二阶段只有同时满足以下条件才可标记完成：

- M1-M12 所有功能 ID 均有对应实现和自动化测试。
- 串行模式的录音、整段 STT、审核、聊天、整段 TTS 和播放能力完全保留。
- 两种模式可由用户明确选择，默认仍为串行，活动回合中不能误切换。
- 流式输入可以展示正确可修订的 partial，并生成稳定 final。
- 流式回复在 LLM 完成前开始播放，且最终朗读文本与可见正文一致。
- 背压、乱序、取消、重连和资源清理具有确定性测试。
- Fixture CI、打包应用、Live Provider 和 Windows 设备矩阵均形成证据。
- 统一指标达到本方案阈值，流式模式相对串行模式的低延迟收益可量化。
- 原始音频、密钥和敏感转写不进入普通日志或诊断导出。
- 不宣称具备全双工或重叠语音理解能力。

完成后的产品不是“新语音替换旧语音”，而是同时拥有可靠串行模式和低延迟流式模式，并能用同一套语料、指标和发布门禁持续比较两条链路。
