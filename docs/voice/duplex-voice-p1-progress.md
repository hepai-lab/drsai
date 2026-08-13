# Windows 全双工语音 P1 实施与验收台账

最后更新：2026-08-12

对应方案：[Windows 全双工语音路线 P1 完整开发方案](./duplex-voice-p1-development-plan.md)

统计口径：只有实现完成且方案规定的自动化证据通过，才计入“已验收”。部分实现、仅有类型声明、Live/硬件证据缺失均不计入完成百分比。

## 总体进度

| 统计项 | 当前值 |
| --- | ---: |
| 执行轮次 | 10 |
| 功能点总数 | 68 |
| 已验收 | 8 |
| 部分完成 | 60 |
| 待实施 | 0 |
| 完成百分比 | 11.76% |

## 模块进度

| 模块 | 已验收/总数 | 百分比 | 状态 |
| --- | ---: | ---: | --- |
| M1 路线边界、配置与公共契约 | 7/7 | 100% | 已验收 |
| M2 Provider 能力探针与 Realtime Adapter | 0/8 | 0% | 进行中（8 项 Fixture 完成，Live 待验收） |
| M3 Main 会话内核与 IPC | 0/7 | 0% | 进行中（7 项自动化通过，打包/真实验收待执行） |
| M4 Renderer 采集、AEC 与设备生命周期 | 0/7 | 0% | 进行中（7 项 Fixture/UI 自动化通过，硬件验收待执行） |
| M5 增量播放、抖动缓冲与听到位置 | 0/7 | 0% | 进行中（7 项 Fixture/浏览器管线完成，真实音频验收待执行） |
| M6 轮次、插话与重叠仲裁 | 0/8 | 0% | 进行中（8 项状态机/语义 Fixture 完成，真人重叠语音验收待执行） |
| M7 转录、聊天历史与上下文投影 | 0/6 | 0% | 进行中（6 项投影/持久化自动化完成，多语言真人验收待执行） |
| M8 Tool Calling、审批与副作用 | 0/6 | 0% | 进行中（6 项 Bridge/幂等自动化完成，真实审批工具验收待执行） |
| M9 重连、隐私、诊断与成本 | 0/7 | 0% | 进行中（7 项恢复/隐私/指标自动化完成，Live 账单与长会话验收待执行） |
| M10 测试体系与发布门禁 | 1/5 | 20% | 进行中（Fixture 聚合门禁已验收；打包/Live/硬件真实证据待签入） |

## M1 功能点状态

| ID | 状态 | 本轮实现 | 验收证据 |
| --- | --- | --- | --- |
| M1-F1 | 已验收 | Main/Renderer Duplex 独立公开入口；路线间禁止导入 | `verify-voice-route-boundaries.mjs`：检查 28 个路线文件通过 |
| M1-F2 | 已验收 | 模式枚举、归一化、偏好持久化、能力门禁及 Composer 的 Realtime 选择均接入 Duplex Runtime | 模式/偏好测试及 `verify-duplex-voice-ui.mjs` 通过 |
| M1-F3 | 已验收 | `realtime_voice_model`、`effective_realtime_voice_ref`、TOML 编解码、Gateway 更新与桌面校验完成 | Python policy/Gateway 定向测试 21 passed，包含 `gpt-realtime-2` 往返 |
| M1-F4 | 已验收 | Duplex 协议版本、格式、采样率、转录、VAD、取消、截断、工具、恢复和水位能力契约完成 | `test-duplex-voice-contracts.mjs` 通过 |
| M1-F5 | 已验收 | Session、连接、上下行、转录、Response、Tool、插话及三终态事件联合类型完成 | `test-duplex-voice-contracts.mjs` 全事件清单通过 |
| M1-F6 | 已验收 | auth/model/protocol/network/device/audio/rate_limit/policy/cancelled/internal 错误分类完成 | `test-duplex-voice-contracts.mjs` 错误清单通过 |
| M1-F7 | 已验收 | `OPENDRSAI_ENABLE_DUPLEX_VOICE=1` Feature Flag；Windows 平台能力默认关闭并受环境控制，macOS 明确关闭 | Feature Flag 正反测试与 Windows 平台源码门禁通过 |

## 第 1 轮记录

目标：建立持续验收台账，完成 M1 路线边界、配置和公共契约。

本轮新增或更新：

- `DesktopVoiceInteractionMode` 增加 `duplex`，偏好读取兼容旧版本并保持 `serial` 默认。
- 新增 Duplex capabilities、session start、PCM chunk、audio delta、transcript、tool call、event 和 error 契约。
- Main/Renderer `voice/duplex` 占位入口转为已实施公共边界。
- Windows 增加默认关闭的 Duplex Feature Flag 平台能力；macOS 明确为 false。
- `realtime_voice_model` 的 TOML、Gateway、桌面 API 和模型校验形成持久化闭环。
- 新增 `test:voice:duplex-contracts` 测试入口。

通过证据：

```text
Duplex voice M1 contracts verified
Voice mode verification passed
Voice preferences verification passed (19 checks)
Voice route boundaries verified across 28 route files
Python Agent model policy/Gateway: 21 passed
```

未通过但不属于本轮语音改动的全局门禁：

```text
typecheck:node / typecheck:web
apps/desktop/shared/api/runInspectionSafety.ts 缺少 relation_type
apps/desktop/shared/renderer/src/mockDesktopApi.ts 对应 Run Inspection fixture 缺少 relation_type
```

这两个错误来自工作树中并行的 Run Inspection 改动。本轮未修改其语义，也不把全局 TypeScript 门禁记为通过。M1-F2 因真实 UI/Runtime 能力尚未接通保持部分完成。

下一轮：先完成 M2-F1～M2-F3，建立智增增 Realtime URL/认证解析、`gpt-realtime-2` 模型绑定、Session 配置和脱敏 Fixture 握手；随后实现 M2 输入/输出事件映射。

## M2 功能点状态

| ID | 状态 | 第 2 轮实现 | 待验收项 |
| --- | --- | --- | --- |
| M2-F1 | 部分完成 | HTTPS→WSS URL 解析、受控 Authorization Header、凭据不进入 URL/Session/报告 | 使用真实智增增凭据完成 WebSocket 握手 |
| M2-F2 | 部分完成 | Provider 强绑定 `zhizengzeng`，模型强绑定 `gpt-realtime*`，覆盖 `gpt-realtime-2` | 真实 Session 回显所选模型 |
| M2-F3 | 部分完成 | GA Session 配置与显式 `legacy-beta` 兼容档位；音频、VAD、转录、工具配置 Fixture 通过 | 智增增接受配置并返回 `session.updated` |
| M2-F4 | 部分完成 | PCM Base64 append、commit、clear 与输入转录/VAD 事件归一化 | 真实麦克风输入产生有效事件 |
| M2-F5 | 部分完成 | GA/legacy 输出音频及转录事件归一化，含大小和格式校验 | 收到并播放真实首段音频 |
| M2-F6 | 部分完成 | `response.cancel` 与 `conversation.item.truncate` 事件生成 | 实际插话后确认旧响应不再继续 |
| M2-F7 | 部分完成 | Function Tool 参数完成事件与 Tool 输出事件归一化 | 完成一次真实 Tool 往返 |
| M2-F8 | 部分完成 | 能力探针与脱敏报告；仅保留布尔能力、事件数和错误码 | Live Probe 报告通过并签入证据 |

## 第 2 轮记录

目标：完成 M2 Provider 中立接口、智增增 Realtime Adapter、安全认证边界、GA/legacy 协议适配、事件归一化和能力探针。

本轮新增或更新：

- 新增 `DuplexRealtimeProviderAdapter`，隔离 Provider 连接、Session、音频、取消、截断、工具和事件解码。
- 新增 `ZhizengzengRealtimeAdapter`，默认使用当前 Realtime GA 协议；仅在显式配置时发送 legacy beta Header 和旧 Session 结构。
- 按当前官方协议使用 `session.type=realtime`、`session.audio.input/output`、`output_modalities`，同时兼容新旧输出音频事件名。
- 新增输入/输出转录、VAD、Response、Tool、错误码的统一事件映射及严格载荷上限。
- 新增脱敏 `DuplexCapabilityProbe`，不会保留音频、转录或认证密钥。
- 新增 `test:voice:duplex-provider` Fixture 门禁。

通过证据：

```text
Duplex Provider M2 fixture verified
Duplex voice M1 contracts verified
Voice mode verification passed
Voice preferences verification passed (19 checks)
Voice route boundaries verified across 31 route files
Python Agent model policy/Gateway: 21 passed
git diff --check: passed
```

全局 TypeScript 门禁仍只被并行 Run Inspection 改动阻塞：`runInspectionSafety.ts` / `mockDesktopApi.ts` 的 Fixture 缺少 `relation_type`。本轮新增 Duplex 文件没有 TypeScript 错误。

严格验收结论：M2 的 8 个功能点均已完成 Fixture 级实现，但真实凭据只存在于受保护配置边界，当前 Main 没有读取明文凭据的安全接口，尚未执行 Live WebSocket。故本轮不将 M2 计入“已验收”，总进度仍为 6/68（8.82%）。

下一轮：进入 M3，先实现 Session Registry、状态机、单实例仲裁、WebSocket Runtime 与 IPC 生命周期；同时设计不向 Renderer 暴露明文密钥的 Main 认证注入路径，为 M2 Live Probe 解锁。

## M3 功能点状态

| ID | 状态 | 第 3 轮实现 | 待验收项 |
| --- | --- | --- | --- |
| M3-F1 | 部分完成 | 每窗口单 Session、全局并发上限、重复 Start 幂等、Owner 隔离与 sender 销毁清理 | 打包应用第二窗口占用提示 |
| M3-F2 | 部分完成 | start/update/push/interrupt/tool/stop/cancel/dispose 状态机与幂等行为 | 打包应用连续开始/结束无僵尸会话 |
| M3-F3 | 部分完成 | 单调音频序号、2 秒高低水位、逐帧 Gateway ACK、总时长和字节硬上限 | 真实弱网内存观测 |
| M3-F4 | 部分完成 | 64 KiB 音频拆分、24 事件/256 KiB IPC 批次上限与慢消费隔离 | 长回复打包 IPC 流畅度 |
| M3-F5 | 部分完成 | `secureHandle`、可信 sender、MessagePort 音频、精确 Agent 模型策略绑定；密钥仅在 Gateway | 安全评审签核 |
| M3-F6 | 部分完成 | 连接关闭、失败、停止、取消和 Dispose 竞争只产生一个终态 | 打包链路无 Session 停留在 stopping |
| M3-F7 | 部分完成 | Socket、队列、Timer、Port、listener 和认证临时引用清理；10,000 轮压力测试 | 30 分钟反复会话资源观测 |

## 第 3 轮记录

目标：完成 Main Session Registry、Duplex Runtime、受限 IPC 和不向 Renderer 暴露 Provider 凭据的安全连接链路。

本轮新增或更新：

- 新增 `DuplexVoiceRuntime`：状态机、有界上行、逐帧 ACK、Session 更新、插话、Tool Result、唯一终态和清理。
- 新增 `DuplexSessionRegistry`：窗口所有权、全局容量、批量下行、终态自动移除和 sender 生命周期绑定。
- Desktop API / Preload / Windows Main 新增独立 Duplex 控制接口；PCM 使用 MessagePort，事件按有界批次下发。
- 新增 Gateway `/v1/audio/duplex` WebSocket 中继；Gateway 读取受保护模型凭据并精确校验 `realtime_voice_model`，Renderer 不接触密钥。
- 新增 Python `OpenAIRealtimeAudioAdapter`，仅允许安全 Provider URL，限制事件大小并在关闭时释放 ClientSession/Socket。
- Provider 上行事件加入本机逐帧 ACK；大输出音频在 Main 内拆成不超过 64 KiB 的 delta。
- 新增 10,000 次终态竞态、批次上限、多窗口隔离、错误模型、错误令牌及凭据脱敏测试。

通过证据：

```text
Duplex voice M1 contracts verified
Duplex Provider M2 fixture verified
Duplex Voice M3 runtime verified (... unique terminal x10000 ...)
Duplex Voice M3 IPC security verified
Voice route boundaries verified across 34 route files
typecheck:node passed
typecheck:web passed
Python Realtime adapter/Gateway + policy: 28 passed
Duplex 范围 git diff --check passed
```

Live 状态：`http://127.0.0.1:18642/health` 当前不可连接，未启动的开发 Gateway 无法提供真实智增增握手证据。因此 M2/M3 保持“部分完成”，总严格验收进度仍为 6/68（8.82%）。

下一轮：进入 M4，实现显式麦克风权限、AudioWorklet PCM、AEC/NS/AGC 实际约束、设备选择/拔插、睡眠恢复和本地 VAD 辅助；同时建立 Renderer Fixture 页面，为 M3 打包人工验收准备入口。

## M4 功能点状态

| ID | 状态 | 第 4 轮实现 | 待验收项 |
| --- | --- | --- | --- |
| M4-F1 | 部分完成 | 麦克风只由 Composer 按钮调用 `startFromUserGesture` 后申请；拒绝进入可重试失败态 | Windows 权限允许、拒绝、撤销 E2E |
| M4-F2 | 部分完成 | AudioWorklet 单声道 PCM16、24 kHz 线性重采样、40 ms 有界分帧 | 真实 Provider 接收且无格式错误 |
| M4-F3 | 部分完成 | 请求 AEC/NS/AGC 并上报 `track.getSettings()` 的实际约束 | 扬声器与真实麦克风回声测试 |
| M4-F4 | 部分完成 | Auto/指定设备、设备枚举与 `devicechange` 更新已接入 Realtime UI | 内置、USB、蓝牙会话矩阵 |
| M4-F5 | 部分完成 | `track.ended` 与设备消失进入恢复/失败，禁止静默切换 | USB/蓝牙真实拔插矩阵 |
| M4-F6 | 部分完成 | suspend/lock 时 Main 清理 Session；Renderer 处理睡眠、恢复、失焦与页面销毁 | Windows 睡眠/锁屏打包验收 |
| M4-F7 | 部分完成 | 本地 RMS VAD 只发 UI 辅助信号，不提交/结束 Provider 轮次 | 噪声环境误触率硬件验收 |

## 第 4 轮记录

目标：完成 Renderer 采集管线、实际媒体约束、设备生命周期、本地辅助 VAD，并把 Realtime 模式接入聊天 Composer 的显式用户操作路径。

本轮新增或更新：

- 新增 `DuplexCaptureController`、AudioWorklet 处理器、PCM16 量化/重采样/分帧和 advisory-only 本地 VAD。
- 增加 Auto/指定麦克风、设备变化、活动 track 丢失、权限拒绝、AudioContext 恢复及完整资源清理。
- Windows Main 监听 suspend、resume、lock-screen、unlock-screen；挂起和锁屏时统一销毁 Duplex Session。
- 新增 `useDuplexVoiceInput`，绑定 Agent 的 `effective_realtime_voice_ref`，使用 MessagePort 上行并消费有界事件批次。
- Composer 增加 Realtime 模式、能力门禁、显式点击启动/停止、设备选择、状态、输入转录和流控提示。
- 新增采集 Fixture 与 UI 源码门禁，保证没有 effect 自动申请麦克风。

通过证据：

```text
Duplex Voice M4 capture verified (explicit permission, PCM, constraints, devices, lifecycle, and advisory-only VAD)
Duplex Voice M4 UI route verified (explicit click, availability gate, status, cancellation, and no automatic microphone start)
Duplex voice M1 contracts verified
Duplex Provider M2 fixture verified
Duplex Voice M3 runtime verified (... unique terminal x10000 ...)
Duplex Voice M3 IPC security verified
Voice route boundaries verified across 39 route files
typecheck:node passed
typecheck:web passed
Python Realtime adapter/Gateway: 7 passed
```

严格验收结论：M1-F2 因真实 Composer 选择与 Runtime 能力门禁接通，升级为已验收，M1 达到 7/7。M4 七项均完成自动化实现，但方案要求的 Windows 权限、真实麦克风/扬声器、USB/蓝牙、睡眠与噪声人工证据尚未产生，因此均保持“部分完成”。总严格验收进度为 7/68（10.29%）。

下一轮：进入 M5，完成 PCM 增量播放、抖动缓冲、下溢/溢出策略、Provider 音频格式适配、实际播放游标及会话级播放清理；随后把播放统计接入诊断与插话截断基础。

## M5 功能点状态

| ID | 状态 | 第 5 轮实现 | 待验收项 |
| --- | --- | --- | --- |
| M5-F1 | 部分完成 | Provider PCM16 delta 立即转 AudioBuffer 调度；短尾块在 response 完成时强制刷新 | 真实首音频延迟 SLO |
| M5-F2 | 部分完成 | 80 ms 启播水位、1 s 高水位、有界队列与 underrun 计数 | 弱网长会话无无限积压 |
| M5-F3 | 部分完成 | response 隔离，按 audio sequence 去重和单调调度，乱序 Fixture 通过 | 真实多轮无串音 |
| M5-F4 | 部分完成 | 游标基于 AudioContext 时钟与实际首个 source 起点计算，限制在已调度时长内 | 插话截断位置听感校准 |
| M5-F5 | 部分完成 | stop/cancel/dispose 同步停止所有 AudioBufferSource 并清空队列 | P95 实机停播延迟 |
| M5-F6 | 部分完成 | cancelled response 进入隔离集合，后续洪水 delta 全部丢弃 | 真实插话后旧声音不恢复 |
| M5-F7 | 部分完成 | suspended/interrupted AudioContext 映射为可恢复状态；closed 明确失败 | 蓝牙切换/设备占用矩阵 |

## 第 5 轮记录

目标：建立可直接消费 Realtime PCM delta 的浏览器增量播放路径，以及后续插话需要的实际播放游标。

本轮新增或更新：

- 新增 `DuplexPlaybackController`，实现有界水位、乱序整理、重复丢弃、跨 response 隔离、短尾刷新和迟到数据封锁。
- 新增 `BrowserPcmPlaybackSink`，把 PCM16LE 转换为 Web Audio 单声道 AudioBuffer，并按 AudioContext 时钟连续调度。
- `useDuplexVoiceInput` 消费 response start/audio delta/audio completed/interrupted 事件，统一管理采集与播放资源。
- 播放游标不按“已收到字节”推算，而以第一个实际 source 起点和 AudioContext 当前时钟计算。
- 新增 M5 合成时钟 Fixture，覆盖突发、乱序、重复、格式错误、高水位、取消后洪水、恢复和立即清理。

通过证据：

```text
Duplex Voice M5 playback verified (incremental PCM, jitter watermark, ordering, real clock cursor, immediate stop, late isolation, and recovery)
typecheck:node passed
typecheck:web passed
Duplex Voice M4 capture verified
Duplex Voice M4 UI route verified
Duplex voice M1 contracts verified
Duplex Provider M2 fixture verified
Duplex Voice M3 runtime verified
Duplex Voice M3 IPC security verified
Voice route boundaries verified across 41 route files
```

严格验收结论：M5 七项的代码与自动化 Fixture 已完成，但首音频、弱网听感、停止延迟、真实插话和蓝牙输出切换仍要求打包应用/真实 Provider 证据，故保持“部分完成”。严格已验收仍为 7/68（10.29%），部分完成增至 29，待实施降至 32。

下一轮：进入 M6，建立 Duplex turn reducer、插话候选与附和保护、调用 interrupt+truncate、输出/输入重叠仲裁和 Stop 语义；使用 M5 的实际播放游标产生截断位置。

## M6 功能点状态

| ID | 状态 | 第 6 轮实现 | 待验收项 |
| --- | --- | --- | --- |
| M6-F1 | 部分完成 | Reducer 覆盖 idle/listening/user_speaking/responding/overlapping/interrupting/stopping/terminal，终态 10,000 次不可变 | UI 与真人听说状态对照 |
| M6-F2 | 部分完成 | 本地 VAD 时长、Provider speech signal、播放状态和稳定转录共同形成候选 | 噪声、口音和真人快速抢话 |
| M6-F3 | 部分完成 | Coordinator 固定执行本地停播、清空旧输出、Provider cancel+truncate，重复提交幂等 | 真实 Provider 原子插话 |
| M6-F4 | 部分完成 | 中英文短附和分类为 acknowledgement，不触发抢占 | 真人附和误打断率 |
| M6-F5 | 部分完成 | “停/别说了/stop/quiet/cancel”锚定识别；否定句与 stopwatch 不误判 | 中英文真人停止指令 |
| M6-F6 | 部分完成 | interrupt 保留 response/item/content 身份并携带实际已听毫秒；新输入仍进入 Provider 当前 item 流 | 打断后上下文不重复旧回答 |
| M6-F7 | 部分完成 | 手动 Stop 递增仲裁 generation，覆盖尚未完成的自动插话决策 | UI/Provider 竞态实机矩阵 |
| M6-F8 | 部分完成 | 25 条标注语料分别统计附和、抢占、纠正、停止准确率，四类均须 ≥90% | 扩展真实录音标注集并达到阈值 |

## 第 6 轮记录

目标：完成全双工轮次状态、重叠语音仲裁、语义插话和基于真实播放游标的 Provider 截断。

本轮新增或更新：

- 新增 `duplexTurnReducer.ts`，非法迁移保持原状态，终态只能由 reset 退出。
- 新增 `bargeInPolicy.ts`，区分 none、acknowledgement、barge_in、correction、stop，并提供严格语义评分门禁。
- 新增 `DuplexBargeInCoordinator`，固定跨层操作顺序并确保同一 response 只提交一次。
- `useDuplexVoiceInput` 接通 Provider speech、VAD、输入稳定转录、播放状态和 interrupt API。
- 手动停止优先于异步自动插话，旧决策完成后不会覆盖用户控制。
- Composer Realtime 状态改为显示 Duplex turn reducer 的真实阶段。

通过证据：

```text
Duplex Voice M6 turns verified (state machine x10000, barge-in/ack/stop semantics, atomic order, cursor identity, idempotency, and manual priority)
Duplex Voice M5 playback verified
Duplex Voice M4 capture verified
Duplex Voice M4 UI route verified
Duplex voice M1 contracts verified
Duplex Provider M2 fixture verified
Duplex Voice M3 runtime verified
Duplex Voice M3 IPC security verified
Voice route boundaries verified across 44 route files
typecheck:node passed
typecheck:web passed
```

严格验收结论：M6 八项自动化实现完成；但真人噪声、附和、纠正、重叠发言和真实 Provider 截断尚无签入证据，全部保持“部分完成”。严格已验收仍为 7/68（10.29%），部分完成 37，待实施 24。

下一轮：进入 M7，建立输入/输出转录投影、稳定 item/message 映射、历史去重、上下文预算、隐私过滤及断线恢复的草稿/已提交边界。

## M7 功能点状态

| ID | 状态 | 第 7 轮实现 | 待验收项 |
| --- | --- | --- | --- |
| M7-F1 | 部分完成 | event sequence 去重；delta 只进入草稿，completed 才生成稳定用户消息 | 中文/英文/混合真人转录 |
| M7-F2 | 部分完成 | 输出草稿与 response/item 关联，completed 后进入稳定助手消息；音频/文本先后均可 | 可见文本与真实语音语义比对 |
| M7-F3 | 部分完成 | `duplex:{session}:{role}:{item}` 稳定 ID；独立安全 IPC 原子 upsert Thread shard | 重启应用后的真实 Thread 恢复 |
| M7-F4 | 部分完成 | 中断消息保留完整生成文本，并按音频总时长/播放游标单独标记 heardContent | 真人打断后的 UI 听感核对 |
| M7-F5 | 部分完成 | 60 分钟/600 轮 Fixture 使用有界摘要和最近 12 条，不包含原始音频 | 长会话主题保持人工检查 |
| M7-F6 | 部分完成 | Realtime 活动期间中央提交入口明确拒绝文字发送并保留 Composer 草稿 | 输入/发送/结束会话 E2E |

## 第 7 轮记录

目标：让 Realtime 临时转录、稳定聊天消息、实际已听范围和 Thread 持久化形成一致投影。

本轮新增或更新：

- 新增 `DuplexTranscriptProjection`，处理输入/输出草稿、稳定提交、事件重放去重和音频时长投影。
- Provider item 派生稳定本地消息 ID；同一 completed 重放只更新，不产生重复历史。
- 新增 `appendDuplexVoiceHistory` Desktop API、Preload IPC 和 Main 原子 shard 写入，并校验 Thread ID、消息 ID、长度和角色。
- ChatWorkspace 合并 Realtime 历史；中断消息以独立状态显示已听范围，不把完整生成内容误称为已听。
- 上下文仅保留有界文本摘要和最近消息，测试 60 分钟会话且明确不持久化 PCM。
- Realtime 活动期所有中央文字提交路径均拒绝发送但不清空草稿。

通过证据：

```text
Duplex Voice M7 transcript verified (draft/stable boundary, replay dedupe, output sync, heard range, bounded 60-minute context, privacy, and text coexistence)
Duplex Voice M7 history verified (atomic shard append, stable-ID replay upsert, persisted heard boundary, and path/input validation)
Duplex Voice M6 turns verified
Duplex Voice M5 playback verified
Duplex Voice M4 capture verified
Duplex Voice M4 UI route verified
Duplex Voice M3 IPC security verified
Voice route boundaries verified across 45 route files
typecheck:node passed
typecheck:web passed
```

严格验收结论：M7 六项自动化实现完成，但真实多语言转录、重启恢复、长会话主题保持和 Composer 竞态 E2E 尚无打包证据，均保持“部分完成”。严格已验收仍为 7/68（10.29%），部分完成 43，待实施 18。

下一轮：进入 M8，实现 Realtime Tool Bridge、call_id 幂等、现有审批复用、副作用隔离、tool result 回传及插话/取消时的工具生命周期。

## M8 功能点状态

| ID | 状态 | 第 8 轮实现 | 待验收项 |
| --- | --- | --- | --- |
| M8-F1 | 部分完成 | Realtime 暴露只读 Thread 搜索和 Voice Runtime 状态 schema；Bridge 校验 JSON 对象/大小/深度 | 查询工具真实回合 |
| M8-F2 | 部分完成 | `call_id` 映射到唯一 Promise，重放并发只执行/回写一次 | Provider 重连重放实测 |
| M8-F3 | 部分完成 | 非只读工具强制 Approval Gate；拒绝/超时/取消不执行并回写明确结果 | 现有键鼠审批入口 E2E |
| M8-F4 | 部分完成 | waiting_approval/running/completed 等状态显示在 Realtime 状态区 | 长工具真人等待体验 |
| M8-F5 | 部分完成 | 插话仅停止语音；工具继续并保留 sideEffectCommitted 真相；结束 Session 后结果 detached | 工具各阶段真人打断矩阵 |
| M8-F6 | 部分完成 | 结果仅在原 Session 活跃时按 call ID 回写；敏感键脱敏且限制 16 KB | 真实模型根据工具结果续答 |

## 第 8 轮记录

目标：将 Provider function call 映射为受控、幂等、可审批的 Desktop 工具生命周期，并隔离迟到结果和副作用。

本轮新增或更新：

- 新增 `DuplexToolBridge`，包括参数校验、风险分类、审批状态、执行状态、call_id 去重和结果回传。
- Realtime Session 注册 `search_thread_messages`、`get_voice_runtime_status` 两个真实只读工具及严格 JSON schema。
- ChatWorkspace 将两个工具连接到现有 Desktop API；未知工具不会执行。
- 高风险名称必须经过 Approval Gate，默认无审批适配器时拒绝，不能因语音绕过。
- 工具结果递归脱敏 token/authorization/api key/secret/password，并限制回写长度。
- 语音插话不伪装撤销工具副作用；Session 结束后迟到结果不再投递给新会话。

通过证据：

```text
Duplex Voice M8 tools verified (schema, safe reads, approval, call_id idempotency, status, redaction, side-effect truth, and late-session isolation)
Duplex Voice M7 transcript verified
Duplex Voice M7 history verified
Duplex Voice M6 turns verified
Duplex Voice M5 playback verified
Duplex Voice M4 capture verified
Duplex Provider M2 fixture verified
Duplex Voice M3 runtime verified
Voice route boundaries verified across 46 route files
typecheck:node passed
typecheck:web passed
```

严格验收结论：M8 六项自动化实现完成，但现有键鼠审批 UI 的真实工具 E2E、Provider 续答和阶段打断人工矩阵尚未签入，均保持“部分完成”。严格已验收仍为 7/68（10.29%），部分完成 49，待实施 12。

下一轮：进入 M9，完成心跳/空闲时限、有界重连、稳定状态恢复、隐私披露、日志脱敏、诊断指标和会话成本预算。

## M9 功能点状态

| ID | 状态 | 第 9 轮实现 | 待验收项 |
| --- | --- | --- | --- |
| M9-F1 | 部分完成 | Gateway Provider WS 20 秒 heartbeat；Desktop 5 分钟空闲结束、30 分钟硬上限和虚拟时钟 watchdog | 30/60 分钟真实会话 |
| M9-F2 | 部分完成 | 最多 3 次、500/1000/2000 ms 指数退避；新连接重新配置 Provider Session | Wi-Fi/有线切换实测 |
| M9-F3 | 部分完成 | 断线前 unacked 音频不重放；仅缓存断线后新采集的有界帧；转录/tool 由稳定 ID/call_id 去重 | 多断线点真实恢复 |
| M9-F4 | 部分完成 | 首次启动前显示精确 Provider、模型、音频发送范围和稳定转录保存范围，并要求明确确认 | 设置/UI 人工签核 |
| M9-F5 | 部分完成 | 二进制、密钥字段、完整 transcript 脱敏；普通诊断仅写数值指标 | 真实诊断导出 canary 扫描 |
| M9-F6 | 部分完成 | 连接、首输入、TTFA、重连、打断、最大缓冲、输入/输出时长；P50/P95/P99 汇总 | Live 指标报告 |
| M9-F7 | 部分完成 | 输入/输出时长硬预算与 80% 预警；Provider token/成本缺失明确为 null，不伪造估算 | 与 Provider 账单抽样核对 |

## 第 9 轮记录

目标：补齐生产会话的保活、恢复边界、隐私确认、脱敏诊断和预算保护。

本轮新增或更新：

- 新增 `runtimePolicy.ts`：会话预算、分段指标、百分位汇总、指数退避和递归诊断脱敏。
- `DuplexVoiceRuntime` 增加 idle/max watchdog、三次有界重连、重连状态事件和新 Session 恢复边界。
- 不重发断线前未确认 PCM，避免重复语义；断线期间的新音频仍受原有水位/字节/时长上限约束。
- 增加 `usage_update` 和 numeric-only `diagnostic` 事件；Renderer 写入统一诊断系统并显示预算预警。
- ChatWorkspace 首次 Realtime 启动改为两步：先披露 Provider/model/发送范围，再由用户确认后申请麦克风。
- 新增随机断线虚拟时钟、服务端静默、最大时限、预算边界、百分位和 canary 脱敏门禁。

通过证据：

```text
Duplex Voice M9 recovery verified (watchdogs, bounded exponential reconnect, no unacked replay, redaction, segment metrics, percentiles, and budgets)
Duplex Voice M9 privacy verified (exact Provider/model disclosure, explicit pre-start confirmation, numeric-only diagnostics, and no raw voice logging)
Duplex Voice M3 runtime verified (... unique terminal x10000 ...)
Duplex voice M1 contracts verified
typecheck:node passed
typecheck:web passed
```

严格验收结论：M9 七项自动化实现完成，但长会话、真实网络切换、诊断导出、Live 指标与 Provider 账单尚未签入，均保持“部分完成”。严格已验收仍为 7/68（10.29%），部分完成 56，待实施仅剩 M10 的 5 项。

下一轮：进入 M10，建立聚合 Duplex 门禁、Serial 零回归、强制打包 E2E、脱敏 Live Provider runner 和 Windows 硬件矩阵证据规范。

## M10 功能点状态

| ID | 状态 | 第 10 轮实现 | 待验收项 |
| --- | --- | --- | --- |
| M10-F1 | 部分完成 | `test:voice:duplex-release` 强制先跑完整 Serial 再跑 Duplex；Serial 全套通过 | 串行真机完整回合 |
| M10-F2 | 已验收 | `test:voice:duplex` 聚合 M1–M9、Python Gateway、路由边界和 Node/Web 类型门禁，完整通过 | 无 |
| M10-F3 | 部分完成 | 打包报告强制 `mode=duplex`、Feature Flag、双向帧、插话、唯一终态、附件和签名；拒绝 fallback | 真实打包应用报告/录像 |
| M10-F4 | 部分完成 | Live 报告锁定 `zhizengzeng/gpt-realtime-2`，要求听说、转录、插话、工具、脱敏、附件、签名 | 授权凭据运行及负责人复听 |
| M10-F5 | 部分完成 | 硬件报告强制 Win10/11、内置/USB/蓝牙、AEC、权限、睡眠、拔插、弱网覆盖及每项附件 | 多机多设备签名矩阵 |

## 第 10 轮记录

目标：把全双工实现转化为不可绕过、不可用 Fixture 冒充真实设备的发布门禁。

本轮新增或更新：

- 新增 `test:voice:duplex`，聚合契约、Provider、Runtime、IPC、Python Gateway、采集、播放、轮次、历史、工具、恢复、隐私、路由和类型检查。
- 新增 `test:voice:duplex-release`，固定执行顺序为完整 Serial 门禁后再执行 Duplex 门禁。
- 修正 Serial 入口验证以识别 Duplex 过渡态，同时保留 Serial 行为；更新 Provider Fixture 适配 Gateway 实例认证。
- 新增三类严格外部证据校验器：packaged、live、hardware；全部要求 SHA-256 完整性、测试人签名和附件。
- 打包证据必须证明双向音频、插话和唯一终态，且 `mode` 必须为 `duplex`。
- Live 证据精确绑定智增增 `gpt-realtime-2`；硬件矩阵每项必须由通过的物理运行和附件覆盖。
- 新增防伪自测，验证有效报告通过，而 serial fallback、错误模型和篡改摘要必然失败。
- 已从当前工作树成功生成 `release/win-unpacked/OpenDrSai.exe`；ASAR 检查确认包含 Duplex Main/Renderer、隐私确认、Realtime model family 和 AudioWorklet 处理器。

通过证据：

```text
test:voice:duplex-release passed (Serial -> Duplex)
Serial voice full suite passed, including 20-cycle resource stress
test:voice:duplex passed (M1-M9 + route boundaries + typecheck)
Python Realtime adapter/Gateway: 7 passed
Duplex Voice M10 evidence gates verified (packaged, Live, hardware, anti-fallback, attestation, attachments, and tamper detection)
Current unpacked artifact contains the Duplex Main route, Renderer privacy/UI route, Realtime model-family binding, and AudioWorklet asset
Voice route boundaries verified across 47 route files
```

真实发布门禁当前结果（正确保持失败）：

```text
packaged-report.json: missing
live-report.json: missing
hardware-report.json: missing
```

严格验收结论：M10-F2 无人工验收要求且聚合门禁完整通过，升级为已验收。其余四项已有实现和机器校验，但方案明确要求真实打包应用、Live Provider、物理硬件和负责人附件，因此保持“部分完成”。总体严格进度为 8/68（11.76%），部分完成 60，待实施 0；不把缺失外部证据伪造成完成。

下一轮：执行外部验收准备与完成审计。若本机已有可运行 Gateway、授权智增增凭据、打包应用及麦克风/扬声器，可依次生成并签核 packaged/live/hardware 报告；否则发布门禁继续保持红色。
