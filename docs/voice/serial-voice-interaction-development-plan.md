# Windows App 串行语音路线 P1 完整开发方案

最后更新：2026-08-10

技术路线：`serial`

路线阶段：P1

方案状态：P1 权威开发与回归基线
适用范围：`apps/desktop/windows`

## 1. 目标

在 Windows App 中完成一条稳定、可审计、可取消的串行语音交互闭环：

```text
录音 -> 整段 STT -> 审核 -> 发送 -> 完整文本回复 -> 整段 TTS -> 播放
```

这里的“串行”有三条硬约束：

1. 用户语音采集和助手语音播放不能同时处于活动状态。
2. STT 在完整录音停止后执行，TTS 在完整助手回复生成后执行。
3. 任一时刻，每个窗口最多有一个活动语音任务和一个明确的状态所有者。

完成后，用户既可以把语音作为可审核的输入方式，也可以朗读助手完整回复；失败、取消、切换会话或退出应用时，系统都能回到可继续工作的状态。

## 2. 范围边界

### 2.1 本方案包含

- 用户主动触发的麦克风录音。
- 真实音量波纹、时长和设备状态。
- 整段音频编码、校验、IPC 和临时存储。
- 在线整段 STT、Fixture STT 和可扩展本地 STT。
- 转写审核、编辑、重试、丢弃和发送。
- 与现有文本聊天和 Agent 工具执行链路衔接。
- 助手完整回复的整段 TTS。
- 系统 TTS、Fixture TTS 和可扩展 Provider TTS。
- 播放、暂停、继续、停止、速度和声音选择。
- 严格的录音与播放互斥。
- 设置、隐私披露、诊断、自动化测试和发布门禁。

### 2.2 本方案不包含

- Streaming ASR、临时转写和自动语义端点。
- LLM Token 级 TTS 和边生成边播放。
- AI 播放时持续监听麦克风。
- 插话打断、重叠语音理解和全双工。
- 唤醒词、后台录音和无人值守录音。
- 声纹识别、说话人鉴权和声音克隆。

## 3. 当前基线

### 3.1 已完成能力

| 能力 | 代码位置 | 当前结论 |
| --- | --- | --- |
| 麦克风入口和状态 UI | `ChatWorkspace.tsx` | 已实现 |
| `MediaRecorder` 整段录音 | `ChatWorkspace.tsx` | 已实现 |
| 真实振幅波纹 | `ChatWorkspace.tsx` | 已实现 |
| 设备和语言选择 | `ChatWorkspace.tsx` | 已实现，尚需持久化加固 |
| 二进制语音 IPC | `desktopApi.ts`、`preload/index.ts`、`main/index.ts` | 已实现 |
| STT 异步任务、事件和取消 | `main/voice.ts` | 已实现 |
| 音频边界和签名校验 | `main/voice.ts` | 已实现 |
| 临时音频和 TTL 清理 | `main/voice.ts` | 已实现 |
| Gateway Provider STT | `main/voice.ts`、`gateway.py` | 已实现 |
| Fixture STT | `main/voice.ts`、`mockDesktopApi.ts` | 已实现 |
| 转写审核和插入 | `ChatWorkspace.tsx` | 已实现 |
| 已审核转写交接 | `voice.ts`、`channelAdapters.ts` | 已实现 |
| STT 契约和 Provider 验证 | `scripts/verify-voice-*` | 已实现基础门禁 |

### 3.2 当前实现结论

串行语音交互的应用代码和确定性自动化已经完成，录音、识别、审核、聊天、朗读和播放由独立控制器管理：

- `VoiceCaptureController` 持有 `MediaRecorder`、轨道、计时器、120 秒截止、设备断开和过期权限请求清理。
- `VoiceTranscriptionController` 持有 STT 请求 ID、事件订阅、取消、旧事件隔离和单一终态。
- `VoicePlaybackController` 持有系统 TTS、Provider TTS、`Audio`、Blob URL、暂停、继续、停止和单实例播放。
- `voiceTurnReducer` 定义完整串行回合状态和录音/播放互斥规则。
- `ChatWorkspace` 只负责组合 Hook、关联当前会话和渲染语音组件；切换会话会停止录音、识别和播放。
- 真实音量波纹使用固定历史采样窗口，新采样从右侧进入并向左移动；振幅来自时域 RMS，宽度随输入框伸缩。
- STT/TTS 在线能力分别要求显式授权；未授权的 STT 预检发生在申请麦克风权限之前，在线 TTS 未授权时强制使用 Windows 本地朗读。

### 3.3 2026-07-18 实施进度

当前总体进度为 **98%**。12 个模块的应用实现、本机自动化门禁和 Windows 解包产物 Smoke 已完成；剩余 2% 是必须依赖真实 Provider 凭证、授权音频以及 Windows 10/11 物理输入输出设备执行的发布验证，不能由开发机 Fixture 代替。

已完成能力：

- 录音入口位于推理选择右侧，与发送按钮同组；录音态显示响应真实输入的经典波纹、时长和停止按钮。
- 支持设备和语言选择、120 秒自动停止、权限拒绝、设备拔出、快速重复点击、丢弃、重试和转写审核。
- 转写只能由用户确认后插入输入框，不自动发送，也不覆盖用户已有输入。
- 完整串行回合可从录音走到最终助手回复，并按需使用系统或 Provider TTS 朗读。
- 支持朗读、暂停、继续、停止、单实例播放、会话切换清理和失败恢复。
- 自动朗读默认关闭，只处理新完成且成功的助手最终回复，不朗读流式内容、历史消息、隐藏推理或失败消息。
- 统一 `VoiceTurnState` 已接入录音、STT、审核、提交、最终回复和自动朗读运行路径；非法转换记录脱敏诊断，完整 E2E 不产生非法转换。
- TTS 共享契约、Preload/Main IPC、Fixture Runtime、Gateway Provider Runtime 和有界二进制结果已实现。
- Gateway `/v1/audio/speech` 限制 12000 字符、0.5-2.0 倍速和超时；Main 流式限制 10 MB TTS 响应，并校验 MP3/WAV/Opus MIME 与音频魔数。
- Provider TTS 不可用时显示明确错误，不会静默切换 Windows 系统声音或跨越用户选择的隐私边界。
- 设置可持久化自动朗读、引擎、语速、系统音色、识别语言、麦克风 ID，以及在线 STT/TTS 两项独立授权。
- 设置已具有显式 schema 版本，支持旧版迁移、损坏 JSON 和未知新版安全回退。
- Main 会在 STT/TTS 终态解绑窗口监听，应用退出时主动取消任务；清除全部应用数据会清理语音临时文件和诊断保留项，不触碰工作区材料。
- 20 轮 capture、STT、playback 压力测试验证 track、timer、订阅和 Blob URL 全部归零，GC 后堆变化低于 4 MB 阻断阈值。
- `axe-core` 已覆盖录音、审核和播放状态，无 serious/critical 问题；减少动画模式关闭波纹过渡和合成旋转动画。
- Windows 解包产物通过真实 Main/Preload IPC 的 STT 成功、STT 取消、TTS 成功和 10 MB 上限音频 Smoke，且未残留临时文件、输出语音正文日志或非法状态转换。

模块结项状态：

| 模块 | 当前结论 | 剩余外部门禁 |
| --- | --- | --- |
| M1 共享契约与状态机 | 运行时接入、全相位矩阵和非法转换诊断完成 | 无 |
| M2 麦克风与设备生命周期 | Mock/控制器完成 | Windows 10/11 物理设备矩阵 |
| M3 录音交互与波纹 | 视觉、焦点、axe、减少动画完成 | 物理麦克风主观检查 |
| M4 音频、IPC 与临时资源 | 五种格式边界、10 MB 打包 IPC 和清理完成 | 目标硬件内存/句柄复核 |
| M5 STT 编排 | 成功、失败、取消、1,000 次竞态和 20 轮压力完成 | 无 |
| M6 STT Runtime 与 Gateway | Fixture/Fake Provider 完成 | Live Provider STT |
| M7 审核与 Composer | E2E 完成 | 无 |
| M8 回合与串行仲裁 | 最终回复、互斥、导航和隐藏清理完成 | 无 |
| M9 TTS Runtime | 系统、Fixture、Gateway Provider、有界流读取和 1,000 次竞态完成 | Live Provider TTS |
| M10 播放与消息控件 | 控制、资源清理和无障碍完成 | 物理扬声器/系统音色 |
| M11 设置、隐私与诊断 | 版本迁移、授权、清理和日志检查完成 | Live 日志复核 |
| M12 发布门禁 | 自动化、视觉、压力、解包 Smoke 完成 | Live 和物理设备证据 |

自动化验收证据：

```text
npm run test:voice
npm run verify:voice-visual
npm run smoke:voice-windows-packaged
npm run smoke:voice-provider
npm run verify:voice-release-ready
```

其中 `test:voice` 汇总 18 个语音命令，覆盖 22 项基础单元检查、IPC、11 个 Provider 场景、17×17 状态转换矩阵、朗读文本、16 项偏好与迁移、14 项采集安全、10 个录音行为场景、6 个 STT 行为场景、8 个播放行为场景、STT/TTS 各 1,000 次同步终态竞态、STT/TTS 字节与格式边界、临时文件安全、8 个光标与选区场景、结构化最终正文过滤和 20 轮资源压力。

`verify:voice-visual` 使用 Playwright 走完录音 -> STT -> 审核 -> 插入 -> 发送 -> 最终回复 -> TTS -> 暂停 -> 继续 -> 停止，并断言完整回合状态轨迹、零非法转换、150%/200% 长错误布局、reduced motion 和 axe。视觉实测桌面波纹宽度为 706 px，窄窗口为 506 px，最大振幅为 30 px；6 张截图和 JSON 报告位于 `apps/desktop/windows/out/verification/voice-visual/`。

`verify:voice-release-ready` 是最终阻断门禁。当前它准确地因以下两份证据缺失而失败：

- `release/voice-provider-live-evidence/report.json`：配置 `OPENDRSAI_VOICE_LIVE_FIXTURE` 和 Provider API Key 后执行 `npm run smoke:voice-provider`。
- `release/voice-windows-hardware-evidence/report.json`：Windows 10/11 上使用内置、USB、蓝牙设备验证权限拒绝、睡眠恢复、热插拔、断网和系统音色。

## 4. 目标用户流程

### 4.1 标准流程

1. 用户点击麦克风按钮。
2. 应用请求权限并打开选定麦克风。
3. 输入区切换为录音条，显示真实波纹和时长。
4. 用户点击停止，应用关闭麦克风并形成完整音频。
5. Main 校验并提交整段 STT。
6. 用户查看、编辑或重试转写结果。
7. 用户确认插入输入框并主动发送。
8. 应用等待助手完成文本回复和工具调用。
9. 用户点击朗读；若已主动开启自动朗读，则在完整回复后自动开始。
10. TTS 完成整段合成后开始播放。
11. 用户可以暂停、继续或停止。
12. 播放结束后回到可录音状态。

### 4.2 失败恢复

- 权限失败：保留文本输入，展示权限帮助，不创建 STT 任务。
- 录音失败：释放设备，允许重新录音。
- STT 失败：保留短期音频，允许重试或丢弃。
- 聊天失败：保留已发送用户消息，不启动 TTS。
- TTS 失败：保留完整文字回复，允许重试或改用系统声音。
- 播放失败：释放音频资源，文字回复仍可阅读和复制。
- 导航或退出：取消活动任务，停止播放并清理临时文件。

## 5. 目标状态机

```text
idle
  -> requesting_permission
  -> recording
  -> preparing_audio
  -> transcribing
  -> reviewing
  -> ready_to_send
  -> submitting
  -> awaiting_response
  -> response_ready
  -> synthesizing
  -> ready_to_play
  -> playing
  -> completed
  -> idle

playing <-> paused

recording -> cancelling -> idle
preparing_audio/transcribing/synthesizing -> cancelling -> idle
requesting_permission/recording/preparing_audio/transcribing/
submitting/awaiting_response/synthesizing/playing -> failed
failed -> retrying | idle
```

状态机约束：

- `recording` 时不得进入 `playing`。
- `playing` 或 `paused` 时点击麦克风，必须先显式停止播放并完成清理，再请求录音。
- 助手消息 `streaming === true` 时不得进入 `synthesizing`。
- 聊天工具调用未形成最终可展示回答时不得启动 TTS。
- 每个请求 ID 只能产生一个终态。
- 过期请求、旧会话事件和重复完成事件必须被忽略。

## 6. 目标模块划分

完整串行语音交互拆分为 **12 个模块**：

| 编号 | 模块 | 核心职责 |
| --- | --- | --- |
| M1 | 共享契约与语音回合状态机 | 定义状态、事件、错误和串行约束 |
| M2 | 麦克风采集与设备生命周期 | 权限、设备、录制和资源释放 |
| M3 | 录音交互与波纹组件 | 录音 UI、真实波纹、时长和无障碍 |
| M4 | 音频封装、IPC 与临时资源 | 整段二进制传输、校验和清理 |
| M5 | STT 任务编排 | 请求注册、取消、超时、重试和终态 |
| M6 | STT Runtime 与 Gateway | Fixture、在线 Provider 和本地扩展位 |
| M7 | 转写审核与 Composer 集成 | 编辑、插入、发送和交接 |
| M8 | 聊天回合与串行仲裁 | 连接输入、模型回复和 TTS 触发条件 |
| M9 | TTS Runtime 与合成任务 | 系统、Fixture、Provider 合成和错误边界 |
| M10 | 语音播放与消息控件 | 播放、暂停、继续、停止和清理 |
| M11 | 设置、隐私与诊断 | 偏好、披露、日志和数据保留 |
| M12 | 测试、性能与发布门禁 | 自动化、真机矩阵和发布判定 |

## 7. 模块详细方案

说明：以下各表的“当前状态”是方案建立时用于估算工作量的基线快照，不再作为结项状态。2026-07-18 的实际实现结论、自动化证据和剩余发布验证以 3.2、3.3 节为准；验收方式仍保留为长期回归清单。

### M1：共享契约与语音回合状态机

建议位置：

```text
src/shared/voiceContracts.ts
src/renderer/src/voice/voiceTurnReducer.ts
```

| ID | 功能点 | 当前状态 | 验收方式 |
| --- | --- | --- | --- |
| M1-F1 | 定义完整 `VoiceTurnState` 和允许的状态转换 | 未实现 | Reducer 表驱动单元测试覆盖每条合法转换；所有非法转换保持原状态并记录诊断事件 |
| M1-F2 | 定义 STT、TTS、播放、设置和统一错误契约 | STT 已有，TTS 缺失 | `npm run typecheck` 通过；Renderer 不直接导入 Main 类型；契约不包含 `any` 和未约束字符串错误码 |
| M1-F3 | 每个语音回合生成稳定 `turnId`，STT/TTS 生成独立 `requestId` | 部分实现 | 测试连续 100 个回合 ID 不重复；旧 request 事件不能修改新回合状态 |
| M1-F4 | 建立录音与播放互斥守卫 | 未实现 | 状态测试证明 `recording + playing`、`recording + paused` 永远不可同时成立 |
| M1-F5 | 为状态变化定义统一副作用入口 | 未实现 | Reducer 保持纯函数；麦克风、IPC 和播放器副作用由 Hook/Controller 执行并可替换为 Fixture |
| M1-F6 | 规范化用户错误和诊断错误 | STT 部分实现 | 每个错误码均有中英文用户操作建议；诊断对象包含阶段、Runtime 和 request ID，但不含正文 |

模块完成标准：状态机测试全部通过，并能用确定性事件回放一次成功回合、STT 失败、聊天失败、TTS 失败和用户取消。

### M2：麦克风采集与设备生命周期

建议位置：

```text
src/renderer/src/voice/useVoiceCapture.ts
src/renderer/src/voice/audioCapture.ts
```

| ID | 功能点 | 当前状态 | 验收方式 |
| --- | --- | --- | --- |
| M2-F1 | 仅在用户点击后调用 `getUserMedia` | 已实现 | Mock 统计初始渲染、会话切换和自动朗读均不调用权限 API；点击麦克风后只调用一次 |
| M2-F2 | 支持默认、内置、USB 和蓝牙麦克风选择 | 已实现基础 | Windows 10/11 真机逐项录制 10 秒；设备标签、选择结果和录音来源一致 |
| M2-F3 | MIME 能力协商和 Runtime 兼容检查 | 部分实现 | 单元测试覆盖 WebM/Opus、Ogg、MP4/M4A 和无支持格式；不兼容时在录音前给出错误 |
| M2-F4 | 点击停止、取消和 120 秒自动截止 | 已实现基础 | Fake timer 验证 120 秒只触发一次停止；取消不启动 STT；自动截止生成可转写 Blob |
| M2-F5 | 处理权限拒绝、无设备和设备中途断开 | 部分实现 | Mock `NotAllowedError`、`NotFoundError`、track `ended`；状态回到可恢复错误且输入文本不丢失 |
| M2-F6 | 处理组件卸载、窗口销毁、导航和睡眠恢复 | 部分实现 | 每种场景后断言所有 track 为 `stopped`，无活动 `MediaRecorder`、定时器和事件监听 |
| M2-F7 | 防止重复点击和并发录音 | 部分实现 | 50 次快速点击只创建一个 Recorder；第二窗口按全局策略获得明确忙碌提示或独立许可 |
| M2-F8 | 录音结果包含可信时长、MIME 和字节数 | 已实现基础 | 对固定 5 秒 Fixture 验证时长误差在允许范围；零字节和明显异常时长被拒绝 |

模块完成标准：采集逻辑从 `ChatWorkspace` 抽离，真机矩阵通过，所有终态均无麦克风资源泄漏。

### M3：录音交互与波纹组件

建议位置：

```text
src/renderer/src/components/voice/VoiceCaptureBar.tsx
src/renderer/src/components/voice/VoiceReviewPanel.tsx
src/renderer/src/voice/useVoiceLevelMeter.ts
```

| ID | 功能点 | 当前状态 | 验收方式 |
| --- | --- | --- | --- |
| M3-F1 | 麦克风和发送按钮位于“推理”选择器右侧 | 已实现 | Playwright 桌面和窄窗口截图；控件不换位、不遮挡、不改变输入框高度 |
| M3-F2 | 录音时输入区切换为录音条 | 已实现 | 组件测试验证输入文字被保留且不可被波纹覆盖；停止后进入处理或审核状态 |
| M3-F3 | 波纹只响应真实音频输入 | 已实现 | 注入静音、低音量和高音量 PCM；静音平直，柱高随 RMS/峰值单调增加 |
| M3-F4 | 波纹从右向左移动并响应容器宽度 | 已实现基础 | 使用 320、640、1200px 容器截图和采样历史断言；最新值始终位于最右侧 |
| M3-F5 | 显示录音时长、停止、取消和处理状态 | 已实现基础 | Fake timer 验证时间显示；按钮在各状态下可用性和操作结果正确 |
| M3-F6 | 支持键盘、屏幕阅读器和减少动画 | 部分实现 | axe 无严重问题；Tab 可到达所有操作；状态变化通过 `aria-live` 播报；reduced motion 下不出现无意义动画 |
| M3-F7 | 长错误文本和中英文布局稳定 | 部分实现 | 中文、英文最长错误在 100%/150%/200% 缩放下不溢出或遮挡 |
| M3-F8 | 处理状态不伪造波纹或百分比 | 已实现基础 | 停止采集后波纹静止；无 Provider 进度时只显示阶段文本，不显示虚假进度 |

模块完成标准：组件从业务工作区解耦，视觉、响应式和无障碍测试覆盖全部状态。

### M4：音频封装、IPC 与临时资源

建议位置：

```text
src/main/voice/audioValidation.ts
src/main/voice/tempAudioStore.ts
src/main/voice/ipc.ts
```

| ID | 功能点 | 当前状态 | 验收方式 |
| --- | --- | --- | --- |
| M4-F1 | 使用 `Uint8Array` 传输整段音频，不使用 Base64 | 已实现 | IPC 契约测试断言存在二进制字段且不存在 `audioBase64` |
| M4-F2 | 校验最大 10 MB、最大 120 秒和 MIME 白名单 | 已实现 | 边界测试覆盖上限减一、等于上限、超过上限；错误码分别正确 |
| M4-F3 | 校验音频魔数与声明 MIME 一致 | 已实现 | Fixture 覆盖 WebM、Ogg、WAV、M4A、MP3、伪造 MIME 和损坏文件 |
| M4-F4 | 临时文件使用 UUID，不使用用户文件名 | 已实现 | 路径测试断言文件仅位于应用 temp 目录，名称符合白名单且不可目录穿越 |
| M4-F5 | 完成、取消、失败、超时和退出时清理文件 | 已实现基础 | 每个终态后断言文件不存在；强制终止后重启执行 TTL 清理 |
| M4-F6 | 限制 IPC 来源、窗口并发和响应大小 | 部分实现 | 非受信 Renderer 调用被拒；单窗口重复请求被拒；超大 Provider 响应不进入 Renderer |
| M4-F7 | 控制内存峰值 | 未验证 | 10 MB 录音 E2E 记录 Renderer/Main 峰值；连续 20 次录音后内存无持续线性增长 |

模块完成标准：所有格式、边界和清理行为有自动化测试，临时资源审计无残留。

### M5：STT 任务编排

建议位置：

```text
src/main/voice/stt/requestRegistry.ts
src/main/voice/stt/orchestrator.ts
src/main/voice/errorNormalization.ts
```

| ID | 功能点 | 当前状态 | 验收方式 |
| --- | --- | --- | --- |
| M5-F1 | 请求注册、唯一 request ID 和单窗口并发限制 | 已实现 | 并发测试验证同窗口第二任务失败，全局超过上限失败，终态后可再次发起 |
| M5-F2 | `accepted`、`progress`、`completed`、`failed`、`cancelled` 事件 | 已实现 | IPC 行为测试验证事件顺序，且每个请求只有一个终态 |
| M5-F3 | 用户取消、窗口销毁和应用退出取消 | 已实现基础 | 在准备、上传和转写阶段分别取消，底层 `AbortSignal` 被触发且资源清理完成 |
| M5-F4 | 60 秒超时和一次有界网络重试 | 已实现 | Fake clock 和 Mock HTTP 验证超时；网络错误最多重试一次；用户取消不重试 |
| M5-F5 | 完成与取消竞态处理 | 已实现基础 | 重复 1,000 次竞态测试，不出现双终态、未处理 Promise 或残留注册表项 |
| M5-F6 | 可重试错误保留短期音频 | 已实现基础 | 网络、限流、超时失败后无需重新录音可重试；丢弃后立即删除音频 |
| M5-F7 | 结构化诊断事件 | 部分实现 | 日志只含 request ID、阶段、Runtime、MIME、字节、时长、耗时和错误码 |

模块完成标准：STT 生命周期在 Fixture 和本地 Mock HTTP 下可确定重放，不依赖外部网络。

### M6：STT Runtime 与 Gateway

建议位置：

```text
src/main/voice/stt/runtimes/fixtureRuntime.ts
src/main/voice/stt/runtimes/gatewayProviderRuntime.ts
src/main/voice/stt/runtimes/localWhisperRuntime.ts
```

| ID | 功能点 | 当前状态 | 验收方式 |
| --- | --- | --- | --- |
| M6-F1 | `VoiceRuntime` 抽象和显式 Runtime 选择 | 已实现基础 | 类型测试确保 Runtime 不直接访问 Composer；未知 Runtime 不得静默回退到 Mock |
| M6-F2 | Fixture Runtime 提供成功、空音频、失败、超时和取消 | 已实现基础 | 标准 CI 对每种结果做确定性断言 |
| M6-F3 | Gateway Provider 使用现有认证调用整段 STT | 已实现 | 本地 Fake Provider 验证 multipart、鉴权、模型、语言和响应归一化 |
| M6-F4 | 区分认证、限流、网络、超时、格式和 Provider 错误 | 已实现基础 | 401/403/413/429/5xx/非 JSON/截断响应均映射到指定错误码 |
| M6-F5 | Runtime 健康状态和 Provider 披露 | 已实现基础 | 未登录、Gateway 未启动、Provider 不可用和 ready 状态均有稳定 UI 文案 |
| M6-F6 | 中文、英文和中英混合识别 | 需 Live 验证 | 发布凭证下使用授权 Fixture；结果达到项目约定 CER/WER 或人工可用门槛 |
| M6-F7 | 本地 Whisper 扩展位 | 仅预留 | 本阶段不阻塞发布；若实现，断网转写、模型校验、取消和 CPU/GPU 路径必须独立验收 |
| M6-F8 | Provider 不可用时不返回占位文字 | 已实现 | 生产环境关闭 Provider 后返回可操作错误，结果中不得出现 Fixture/Mock 文本 |

模块完成标准：在线 Runtime 可生产使用，标准 CI 使用 Fixture，发布前 Live Smoke 通过。

### M7：转写审核与 Composer 集成

建议位置：

```text
src/renderer/src/components/voice/VoiceReviewPanel.tsx
src/renderer/src/voice/useVoiceTranscription.ts
```

| ID | 功能点 | 当前状态 | 验收方式 |
| --- | --- | --- | --- |
| M7-F1 | 完整转写进入可编辑审核状态 | 已实现 | Provider 完成后文本可编辑，且不会自动发送或覆盖原输入 |
| M7-F2 | 按原光标插入或替换原选区 | 已实现基础 | 测试空输入、行首、行中、行尾、多行选区和 Unicode 光标位置 |
| M7-F3 | 重试不要求重新录音 | 已实现基础 | 可重试错误后点击重试复用同一音频；成功后旧错误和旧 request 被清理 |
| M7-F4 | 丢弃审核结果和临时音频 | 已实现基础 | 丢弃后输入恢复、审核面板消失、Blob 引用和 Main 临时文件均释放 |
| M7-F5 | 审核后由用户主动发送 | 已实现 | 转写完成、插入后均不触发 `onSubmit`；只有发送按钮或 Enter 触发聊天 |
| M7-F6 | 保留原附件、模型、Agent 和推理设置 | 已实现聊天基础 | 语音插入前后提交参数快照一致，除输入文本外不改变 Composer 状态 |
| M7-F7 | 可选写入已审核语音交接 | 已实现 | 只写入用户确认后的文字；路径限制在工作区；符号链接穿越被拒 |
| M7-F8 | 审核界面无障碍和焦点恢复 | 部分实现 | 转写完成后焦点进入审核区；插入或丢弃后回到输入框；屏幕阅读器播报结果状态 |

模块完成标准：审核流程不丢输入、不自动发送，并覆盖所有光标、错误和焦点场景。

### M8：聊天回合与串行仲裁

建议位置：

```text
src/renderer/src/voice/useSerialVoiceTurn.ts
src/renderer/src/voice/voiceTurnSelectors.ts
```

| ID | 功能点 | 当前状态 | 验收方式 |
| --- | --- | --- | --- |
| M8-F1 | 把语音输入关联到具体用户消息和助手回复 | 未实现 | 语音 turn ID 只绑定提交后产生的那条回复，不会朗读其他会话或后台任务消息 |
| M8-F2 | 等待助手完整回复后才允许 TTS | 未实现 | `message.streaming === true` 时朗读按钮禁用；最终事件后才进入 `response_ready` |
| M8-F3 | 工具调用和结构化消息只朗读最终用户可见回答 | 未实现 | Fixture 覆盖 reasoning、tool status、引用和最终正文；合成文本不包含隐藏推理或调试信息 |
| M8-F4 | 会话切换、消息重试和回复替换的关联处理 | 未实现 | 切换会话停止当前语音任务；重试回复只允许朗读最新完成版本 |
| M8-F5 | 录音与播放严格互斥 | 未实现 | 播放中点击麦克风先停止并清理播放器，然后才请求权限；录音中朗读按钮不可启动 |
| M8-F6 | 聊天失败不触发 TTS | 未实现 | 网络、取消、Provider 和工具失败场景保持文字错误状态，不创建合成任务 |
| M8-F7 | 自动朗读只在用户开启时触发 | 未实现 | 默认设置下 100 次回复均不自动播放；开启后只有完整成功回复触发一次 |
| M8-F8 | 用户手动文本输入仍可使用朗读 | 未实现 | 串行语音不是封闭模式；任何完整助手消息均可手动朗读，且遵守互斥规则 |

模块完成标准：用一次包含工具调用的完整聊天 Fixture 证明录音、发送、最终回复和朗读关联正确。

### M9：TTS Runtime 与合成任务

建议位置：

```text
src/shared/voiceContracts.ts
src/main/voice/tts/orchestrator.ts
src/main/voice/tts/runtimes/fixtureRuntime.ts
src/main/voice/tts/runtimes/gatewayProviderRuntime.ts
src/renderer/src/voice/systemSpeechRuntime.ts
```

| ID | 功能点 | 当前状态 | 验收方式 |
| --- | --- | --- | --- |
| M9-F1 | 定义 TTS 请求、事件、结果、Runtime 状态和错误契约 | 未实现 | TypeScript 类型检查通过；请求限制文本长度、语言、voice ID 和 rate 范围 |
| M9-F2 | 系统 `speechSynthesis` Runtime | 未实现 | Mock voices 测试中文、英文、无匹配声音、voices 异步加载、完成、错误和取消 |
| M9-F3 | Fixture TTS Runtime | 未实现 | 标准 CI 返回固定授权音频或确定性播放事件，不依赖系统声音和网络 |
| M9-F4 | Gateway Provider TTS 适配器 | 未实现 | 本地 Fake Provider 验证鉴权、请求字段、音频 MIME、大小边界、超时和错误映射 |
| M9-F5 | 整段合成，只接受完整助手正文 | 未实现 | 输入包含 Markdown、代码块和链接时按朗读规则规范化；不得传入隐藏推理和工具日志 |
| M9-F6 | 合成任务请求 ID、取消和单一终态 | 未实现 | 取消、超时和完成竞态各执行 1,000 次，只有一个终态且无残留任务 |
| M9-F7 | TTS 音频大小、时长和临时资源边界 | 未实现 | 超限响应被拒；完成、停止、失败和退出后删除临时音频及撤销 Blob URL |
| M9-F8 | Runtime 降级策略 | 未实现 | Provider 失败时只在用户允许的策略下切换系统 TTS；不得静默改变隐私边界 |
| M9-F9 | 长回复处理 | 未实现 | 超过单次 Provider 限制时给出明确提示或按完整段落顺序分段合成；播放仍保持串行且可取消 |

模块完成标准：至少一个生产可用 TTS Runtime 和 Fixture Runtime 完成，Provider Runtime 可按产品配置列入同一契约。

### M10：语音播放与消息控件

建议位置：

```text
src/renderer/src/components/voice/VoicePlaybackControls.tsx
src/renderer/src/voice/useVoicePlayback.ts
```

| ID | 功能点 | 当前状态 | 验收方式 |
| --- | --- | --- | --- |
| M10-F1 | 每条完整助手消息提供朗读图标 | 未实现 | Streaming 消息无可用朗读操作；完成消息显示 Lucide 图标、Tooltip 和可访问名称 |
| M10-F2 | 播放和停止 | 未实现 | 点击播放后状态为 playing；停止后音频回到起点并释放当前播放资源 |
| M10-F3 | 暂停和继续 | 未实现 | 暂停时间点保持；继续后从允许误差范围内恢复；系统 TTS 和音频 Runtime 行为一致 |
| M10-F4 | 同一窗口同时只播放一条回复 | 未实现 | 播放第二条自动停止第一条；不会出现两个 Audio 或两个 Utterance 同时活动 |
| M10-F5 | 播放结束恢复状态 | 未实现 | `ended` 或系统 TTS `onend` 后回到 completed/idle，按钮和麦克风恢复可用 |
| M10-F6 | 导航、删除消息、窗口隐藏和退出清理 | 未实现 | 每个场景停止播放、解绑事件、撤销 Blob URL；后台无残留声音 |
| M10-F7 | 播放错误可恢复 | 未实现 | 解码失败、设备缺失和 Runtime 错误只影响朗读，不破坏消息正文和聊天输入 |
| M10-F8 | 速度和声音选择立即作用于新任务 | 未实现 | 0.75、1.0、1.25、1.5 倍速验证；切换声音后下一次朗读使用新声音 |
| M10-F9 | 可见状态和无障碍 | 未实现 | 播放、暂停、处理中和错误不能只靠颜色；键盘可操作；状态通过 `aria-live` 提示 |

模块完成标准：系统 TTS 和 Fixture 音频两种播放来源的控制行为一致，资源泄漏测试通过。

### M11：设置、隐私与诊断

建议位置：

```text
src/shared/voiceContracts.ts
src/main/voice/settings.ts
src/renderer/src/components/settings/VoiceSettings.tsx
```

| ID | 功能点 | 当前状态 | 验收方式 |
| --- | --- | --- | --- |
| M11-F1 | 持久化 STT Runtime、语言和麦克风偏好 | 部分实现 | 重启应用后恢复；设备不存在时回退默认设备并保留可见提示 |
| M11-F2 | 持久化 TTS Runtime、声音和速度 | 未实现 | 重启恢复合法值；旧声音不存在时选择同语言默认声音 |
| M11-F3 | 自动朗读默认关闭 | 未实现 | 新安装、升级和设置缺失时均为 false；只有明确用户操作才能开启 |
| M11-F4 | 原始音频保留默认关闭 | 已有原则 | STT/TTS 成功后检查 temp 无文件；开启诊断保留时显示期限和清理入口 |
| M11-F5 | 首次远程 STT/TTS 前展示 Provider 披露 | STT 部分实现 | 首次使用前可看到音频或文字将离开设备；拒绝后不发出网络请求 |
| M11-F6 | 设置版本和迁移 | 未实现 | 空设置、旧版本、损坏 JSON 和未知字段测试；迁移失败回到安全默认值 |
| M11-F7 | 隐私安全日志 | 部分实现 | 自动扫描日志，禁止密钥、音频字节、Blob URL、完整 transcript 和完整回复正文 |
| M11-F8 | 诊断指标 | 部分实现 | 记录 capture、STT、chat、TTS、playback 耗时、错误码和 Runtime，不记录内容 |
| M11-F9 | 用户清理入口 | 未实现 | 清理操作删除语音缓存、临时文件和诊断保留项，不删除聊天正文和普通设置 |

模块完成标准：设置迁移、披露和日志隐私测试通过，默认策略始终是不开麦、不自动朗读、不持久化原始音频。

### M12：测试、性能与发布门禁

建议位置：

```text
scripts/verify-voice-state.mjs
scripts/verify-voice-renderer.mjs
scripts/verify-voice-tts.mjs
scripts/verify-voice-e2e.mjs
scripts/smoke-voice-windows.ps1
```

| ID | 功能点 | 当前状态 | 验收方式 |
| --- | --- | --- | --- |
| M12-F1 | 保持现有 STT 契约、IPC 和 Provider 验证 | 已实现 | `verify:voice-feature`、`test:voice-unit`、`test:voice-ipc`、`test:voice-provider` 全通过 |
| M12-F2 | 状态机单元测试 | 未实现 | 新增 `test:voice-state`，覆盖全部合法转换、非法转换、竞态和旧事件 |
| M12-F3 | Renderer 组件行为测试 | 未实现 | 新增 `test:voice-renderer`，Mock mediaDevices、MediaRecorder、speechSynthesis 和 Audio |
| M12-F4 | TTS Runtime 和播放测试 | 未实现 | 新增 `test:voice-tts`，覆盖系统、Fixture、Provider、取消、超时和资源清理 |
| M12-F5 | 完整串行回合 E2E | 未实现 | 新增 `test:voice-e2e`：录音 Fixture -> STT -> 审核 -> 发送 -> 回复 -> TTS -> 播放完成 |
| M12-F6 | 视觉和无障碍回归 | 部分实现 | Playwright 覆盖录音、处理、审核、合成、播放、暂停和错误；axe 无严重问题 |
| M12-F7 | 性能和泄漏测试 | 未实现 | 连续执行 20 个完整回合；内存、句柄、Blob URL、track 和临时文件无持续增长 |
| M12-F8 | Provider Live Smoke | STT 部分实现 | 发布凭证下完成一次真实 STT 和一次真实 TTS；日志不保存正文 |
| M12-F9 | Windows 安装包真机矩阵 | 未完成 | Windows 10/11、内置/USB/蓝牙设备、权限关闭、睡眠恢复、断网和设备拔出通过 |
| M12-F10 | 发布阻断规则 | 未实现完整闭环 | 任一生产 Mock 回退、双重播放、录播并发、资源泄漏、隐私日志或无网络 CI 依赖均阻断发布 |

模块完成标准：所有必需自动化和真机门禁有可追踪结果，失败项不能通过文档声明豁免。

## 8. 建议目录重构

在保持小步提交的前提下，将当前单文件职责逐步拆分为：

```text
src/shared/
  voiceContracts.ts

src/main/voice/
  index.ts
  ipc.ts
  settings.ts
  errorNormalization.ts
  tempAudioStore.ts
  stt/
    orchestrator.ts
    requestRegistry.ts
    runtimes/
      fixtureRuntime.ts
      gatewayProviderRuntime.ts
      localWhisperRuntime.ts
  tts/
    orchestrator.ts
    requestRegistry.ts
    runtimes/
      fixtureRuntime.ts
      gatewayProviderRuntime.ts

src/renderer/src/voice/
  voiceTurnReducer.ts
  useSerialVoiceTurn.ts
  useVoiceCapture.ts
  useVoiceLevelMeter.ts
  useVoiceTranscription.ts
  useVoicePlayback.ts
  systemSpeechRuntime.ts

src/renderer/src/components/voice/
  VoiceCaptureBar.tsx
  VoiceReviewPanel.tsx
  VoicePlaybackControls.tsx
```

拆分原则：

- 先抽取并保持现有行为，再增加 TTS，不在同一提交同时重写 STT 和新增播放。
- Shared 只包含可序列化契约和纯类型。
- Main 持有 Provider 凭证、临时文件和网络任务。
- Renderer 持有浏览器媒体设备、系统 TTS 和 UI 状态。
- `ChatWorkspace` 只消费高层 Hook 和渲染专用组件。

## 9. 数据与 API 设计

### 9.1 保留的 STT API

```ts
startVoiceTranscription(request): Promise<{ requestId: string }>
cancelVoiceTranscription(requestId): Promise<boolean>
onVoiceTranscriptionEvent(listener): () => void
getVoiceRuntimeStatus(): Promise<DesktopVoiceRuntimeStatus>
```

### 9.2 新增的 TTS API

建议契约：

```ts
interface DesktopVoiceSynthesisRequest {
  messageId: string;
  text: string;
  language?: string;
  voiceId?: string;
  rate: number;
}

type DesktopVoiceSynthesisEvent =
  | { requestId: string; type: "accepted"; runtimeId: string }
  | { requestId: string; type: "progress"; stage: "preparing" | "synthesizing" }
  | { requestId: string; type: "completed"; result: DesktopVoiceSynthesisResult }
  | { requestId: string; type: "failed"; error: DesktopVoiceError }
  | { requestId: string; type: "cancelled" };
```

桌面 API：

```text
startVoiceSynthesis(request)
cancelVoiceSynthesis(requestId)
onVoiceSynthesisEvent(listener)
getVoiceSynthesisRuntimeStatus()
getVoiceSettings()
saveVoiceSettings(settings)
```

约束：

- Main 必须限制合成文本长度、响应大小、超时和并发。
- Provider TTS 返回的音频只能通过受限二进制结果或受管理资源 ID 暴露给 Renderer。
- 不允许 Renderer 提供任意输出路径。
- 系统 `speechSynthesis` 不经过 Main，但必须适配到同一高层播放状态。

## 10. 测试 Fixture

### 10.1 STT Fixture

- `zh-short.wav`：简短中文。
- `en-short.wav`：简短英文。
- `mixed-short.webm`：中英混合和 Chromium 实际格式。
- `silence.wav`：静音。
- `noise.wav`：背景噪声。
- `clipped.wav`：削波音频。
- `corrupt.webm`：损坏文件。

### 10.2 TTS Fixture

- 简短中文正文。
- 简短英文正文。
- 中英混合正文。
- Markdown、代码块、链接和引用混合正文。
- 空正文和只有格式符号的正文。
- 超长正文。
- 固定授权 WAV/MP3 合成结果。
- 损坏音频和超大音频响应。

### 10.3 完整回合 Fixture

至少包含：

1. 普通问答回合。
2. 含工具调用和最终总结的回合。
3. STT 失败后重试成功。
4. 聊天失败，不触发 TTS。
5. TTS 失败，回退到文字阅读。
6. 播放中用户停止后开始新录音。
7. 会话切换导致活动任务清理。

## 11. 实施里程碑

### S1：基线冻结与组件抽离

范围：M1、M2、M3、M7 的重构部分。

交付：

- 建立状态契约和现有 STT 回归 Fixture。
- 抽离录音、波纹和审核组件。
- 保持当前用户行为和视觉不变。

退出标准：现有语音验证、类型检查、Build 和视觉回归全部通过。

### S2：STT 生产闭环加固

范围：M4、M5、M6、M7。

交付：

- 补齐行为测试、设备异常、资源清理和性能测试。
- 完成真实 Provider 发布 Smoke 标准。
- 明确在线与本地 Runtime 披露。

退出标准：串行语音输入可以独立标记为生产可用。

### S3：完整语音回合与串行仲裁

范围：M1、M8、M11。

交付：

- 连接语音输入、用户消息和最终助手回复。
- 建立录音与播放互斥、会话切换清理和自动朗读策略。
- 增加语音设置契约和迁移。

退出标准：Fixture 能稳定走到 `response_ready`，且不会错误关联回复。

### S4：TTS 与播放

范围：M9、M10。

交付：

- 实现系统 TTS、Fixture TTS 和可配置 Provider TTS。
- 实现消息朗读、暂停、继续、停止、声音和速度。
- 实现 TTS 取消、错误恢复和临时资源清理。

退出标准：至少一个生产 TTS Runtime 完成整段中文、英文和混合回复朗读。

### S5：端到端质量与发布

范围：M11、M12。

交付：

- 完整回合 E2E、性能、泄漏、隐私和无障碍测试。
- Provider Live Smoke 和 Windows 安装包真机矩阵。
- 完成发布诊断和回滚策略。

退出标准：第 12 章全部验收标准通过。

## 12. 最终验收标准

### 12.1 功能验收

- 用户可以录制中文、英文和中英混合语音并得到真实转写。
- 用户可以编辑、重试、丢弃和发送转写。
- 助手完成回复后可以整段合成并播放。
- 播放支持暂停、继续、停止、声音和速度。
- 自动朗读默认关闭，开启后每条最终回复只触发一次。
- 录音和播放从不同时活动。
- 会话切换、窗口关闭和应用退出会停止所有语音活动。

### 12.2 可靠性验收

- 每个 STT/TTS 请求只有一个终态。
- 取消、超时、完成竞态无双终态和资源泄漏。
- 连续 20 个完整回合后内存和资源无持续增长。
- Provider 不可用时不返回 Mock 结果，不影响文本聊天。
- 任一阶段失败后用户可以继续输入或重试。

### 12.3 隐私验收

- 未经点击不启动麦克风。
- 自动朗读未经开启不启动。
- 远程 STT/TTS 前披露数据处理方。
- 原始音频默认不持久化。
- 日志不包含密钥、音频、完整转写和完整回复正文。
- 用户可清理语音缓存和诊断保留数据。

### 12.4 自动化门禁

现有命令：

```text
npm run typecheck
npm run verify:voice-feature
npm run test:voice-unit
npm run test:voice-ipc
npm run test:voice-provider
npm run verify:ui
npm run verify:visual
npm run build
```

规划新增命令：

```text
npm run test:voice-state
npm run test:voice-renderer
npm run test:voice-tts
npm run test:voice-e2e
npm run smoke:voice-provider
npm run smoke:voice-windows-packaged
```

### 12.5 发布阻断项

出现以下任一情况不得发布：

- 生产环境返回 Fixture 或 Mock 转写、合成结果。
- 麦克风可以在未点击的情况下启动。
- 录音和播放能够同时活动。
- 自动朗读默认开启或升级后被意外开启。
- 取消后仍有网络请求、麦克风轨道或音频播放。
- 临时 STT/TTS 音频无法清理。
- 日志出现密钥、音频字节或语音正文。
- 标准 CI 依赖真实网络或系统声卡。
- Windows 安装包无法通过物理麦克风和扬声器 Smoke。

## 13. 最终实现效果

完成本方案后，Windows App 将具备完整但严格串行的语音交互：用户点击麦克风后完成一段录音，看到与真实输入一致的波纹，停止后获得可编辑的真实转写；确认发送后等待助手完成文本回复，再按需使用系统或 Provider 声音整段朗读。用户可以控制播放，应用可以处理权限、设备、格式、认证、网络、超时和 Provider 错误。

整个回合始终保持明确的发言权：录音时不播放，播放时不录音；不监听重叠语音，也不把打断或全双工伪装成当前能力。该基线完成后，流式语音交互才能在稳定契约、真实测试和明确指标之上继续建设。
