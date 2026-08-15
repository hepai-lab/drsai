# 全双工语音 P1 代码实现审计

最后更新：2026-08-14

审计范围：Windows Desktop 的 `voice/duplex` 公共契约、Main Runtime、智增增 Realtime Adapter、Preload/IPC、Renderer 采集与播放、插话、转录投影、工具桥、ChatWorkspace 入口、恢复与诊断。

## 1. 结论

P1 的总体架构方向合理：凭据留在 Main/Gateway、Duplex 与 Serial/Streaming 路线隔离、使用 MessagePort 传输上行 PCM、增量播放、稳定转录投影、工具调用幂等和唯一终态，这些边界值得保留。

但当前实现仍是技术骨架，不建议在 P2 之前直接成为默认语音体验。主要原因不是功能数量不足，而是以下五个基础行为尚未闭环：

1. 上下行背压会以丢帧或取消整场会话结束，弱网下不够健壮。
2. 本地 500 ms 插话路径绕过语义判断，且 Provider speech 标志在转录完成前被清除。
3. 页面隐藏或短暂离线会被 ChatWorkspace 直接取消，会覆盖底层已经实现的恢复逻辑。
4. “已听到内容”按字符比例估算，而不是按真实播放时间与词/音频对齐，可能污染后续上下文。
5. UI 暴露了 Serial、Streaming、Realtime 三种技术模式，且隐私确认、错误、恢复、工具状态和设备选择都挤在 Composer 附近，用户难以理解。

因此，P2 应先做可靠性和交互收敛，再做更聪明的重叠语义、多 Provider 或高级工具。

## 2. 值得保留的实现

| 模块 | 保留理由 | P2 处理 |
| --- | --- | --- |
| `voice/duplex` 独立所有权 | 避免把全双工语义塞进旧 Streaming 状态机 | 保留并继续禁止跨路线内部导入 |
| Main/Gateway 持有凭据 | Renderer 不接触长期 API Key | 保留，增加短期会话诊断而不泄密 |
| 公共事件联合类型 | session/audio/transcript/tool/terminal 边界清楚 | 升级协议版本并增加可用性、背压、恢复事件 |
| Session Registry | 每窗口唯一会话、全局上限、唯一终态 | 保留，改进占用提示和会话接管 UX |
| AudioWorklet PCM 采集 | 适合低延迟、单声道、固定帧 | 保留，替换线性重采样并加入静音/削波监测 |
| `call_id` 工具幂等 | 防止 Provider 重放造成重复副作用 | 保留，接入正式审批 UI 和可取消执行器 |
| 原始音频默认不落盘 | 隐私边界正确 | 保留，只允许用户显式开启短期诊断采样 |
| Serial 路线 | 是明确、可靠、可解释的降级路径 | 保留为用户可选的“按住说话/单次输入” |

## 3. 必须完善的问题

### 3.1 P0：会导致错误、卡死或意外结束

#### A-01 上行流控没有形成闭环

- Main Runtime 达到高水位时 `pushAudio()` 返回 `false`。
- Preload 的 `postMessage()` 总是返回 `true`，Renderer 无法知道某帧是否被 Main 接受。
- Main 端收到被拒绝帧后直接 `cancel()` 整场会话。
- Renderer 虽显示 `flow_control.paused`，采集控制器仍持续发送。

结果：弱网或 Provider 暂停消费时，会话可能突然结束；“上行暂缓”只是显示，不是真正背压。

P2 必须改为信用/窗口式流控：Main 明确发布可发送额度，Renderer 在边界暂停向 MessagePort 投递；允许有界丢弃“尚未承诺”的最新静音帧，但不得因正常高水位取消会话。

#### A-02 下行高水位丢帧后可能永久卡住

`DuplexPlaybackController.enqueue()` 超过高水位时直接丢弃 delta。后续 `#pump()` 仍等待缺失的单调序号，缺口之后的音频无法继续排程。

P2 必须采用以下一种确定策略：

- Main 到 Renderer 的消费确认和背压，不发送超过播放容量的数据；或
- 有界重排序窗口配合缺口超时，超时后明确跳序并记录丢帧，而不是永久等待。

首选前者，后者只作为异常恢复。

#### A-03 插话的快速路径绕过语义门

本地 VAD 连续 500 ms 后直接 `commitInterrupt("user_speech")`，没有区分“嗯、对、继续”等附和。另一方面，`input_speech_stopped` 先把 `providerSpeechRef` 设为 `false`，随后 completed transcript 才调用语义判断，导致 Provider 佐证经常失效。

P2 必须拆分为：立即本地 duck、候选确认、语义决策、Provider cancel 四阶段。附和只 duck 后恢复；停止词立即 cancel；普通抢话在 server VAD + ASR prefix 或持续时间门槛达到后 commit。

#### A-04 生命周期策略互相矛盾

Duplex capture/runtime 实现了 `resume`、`reconnecting` 和 AudioContext 恢复；但 ChatWorkspace 在 `visibilitychange(hidden)` 和 `offline` 时直接 `cancel()`。用户切到别的窗口、最小化或网络短暂闪断都会结束会话。

P2 应移除隐藏/离线的无条件取消：

- `pagehide`、窗口销毁、退出登录：结束会话；
- `hidden`：继续会话或根据设置暂停麦克风，不销毁；
- `offline`：进入有界 reconnecting，停止提交旧未确认音频；
- suspend/lock：安全暂停，解锁后询问恢复或自动恢复。

#### A-05 停止语义过早宣布 completed

Main `stop()` 发送 input commit 后立即发出 completed 并关闭 Socket，没有等待最终转录、Provider response done 或 commit ack。用户点击“结束”时，最后一句和最后一段 AI 回复可能丢失。

P2 需要区分：

- `finish_turn`：提交当前输入并等待最终响应；
- `end_session`：停止采集，等待稳定事件到达 drain deadline 后完成；
- `cancel_session`：立即丢弃未稳定内容。

### 3.2 P1：会降低内容正确性或长期可维护性

#### A-06 “已听到内容”是字符比例估算

当前用 `playedAudioMs / generatedAudioMs * transcript.length` 截断文本。中英文语速、停顿和标点都不线性，且播放游标把调度时间当成实际听到时间。

P2 应记录每个 AudioBufferSource 的实际开始/结束区间，扣除输出延迟和间隙；优先使用 Provider 的音频/词时间戳。没有对齐证据时只标记“回复在此处被打断”，不得伪造精确 heard text。

#### A-07 转录 UI 状态跨轮次累积

`inputTranscript` 对所有 delta 直接追加，completed 后也保留；下一轮 delta 会接在上一轮末尾。输出草稿把所有 response draft 拼接，也可能出现多个响应混杂。

P2 应按 `itemId/responseId/contentIndex` 管理 draft，并显式选出当前轮显示；stable 后清除对应 draft，不用单个字符串跨轮复用。

#### A-08 历史持久化过于频繁且错误不可恢复

每个 completed/interrupted 事件都会把全部 projected messages 再次写入 Thread。虽然 ID 合并可幂等，但 I/O 放大、并发顺序和失败重试没有明确队列；失败只在 UI 设置一条错误。

P2 应采用 append journal：只写本次稳定变更，按 session event sequence 串行提交，带 revision/CAS；失败进入可见重试队列，会话结束前 flush。

#### A-09 Realtime 可用性是假阳性

`getDuplexVoiceCapabilities()` 返回硬编码的智增增能力，ChatWorkspace 仅凭 capabilities 存在就启用“实时”选项；Feature Flag、Gateway、Agent 模型和凭据直到 start 才失败。

P2 应新增 readiness API，返回 `available`、`reasonCode`、Provider/model、Gateway、凭据、协议探针和设备能力。UI 只在 readiness 通过时允许开始，并提供可执行修复入口。

#### A-10 Adapter 能力硬编码且与真实探针脱节

智增增 Adapter 永远声明转录、VAD、取消、truncate、tools 全部可用；Provider 或模型差异只能在运行中暴露。

P2 应把静态上限、配置能力和 live probe 结果分开，最终能力取交集，并为每个降级项给出原因。

#### A-11 重采样和 VAD 仅适合原型

线性重采样在 44.1/48 kHz 到 24 kHz 时缺少抗混叠滤波；RMS VAD 不含频带、回声相关性和双阈值校准。扬声器回声或键盘噪声可能触发插话。

P2 应使用带低通的流式重采样器，并将 WebRTC 约束、能量、谱特征、Provider VAD 和播放参考信号融合；本地 VAD 只做候选，不单独决定 cancel。

#### A-12 工具桥未接正式审批体验

Bridge 有 approval 抽象，但 ChatWorkspace 没有提供 approval gate；当前只开放两个只读工具，因此暂时不出错，一旦增加写工具会默认拒绝。状态 UI 只显示最后一条 detail，不显示工具名、参数摘要、风险和结果。

P2 应复用 Desktop 正式审批组件，支持 allow once/reject/cancel、超时、执行中取消和 side-effect truth，并把工具事件写入 Thread timeline。

#### A-13 会话更新 API 没有产品入口

Main 提供 `updateDuplexVoiceSession()`，但 UI 不支持会话中切换语言、声音、指令或工具策略，也没有声明哪些字段可热更新。无效更新失败时没有回滚反馈。

P2 应限定热更新字段；模型、Provider、音频格式和设备切换走受控重启，voice/instructions/tool policy 走带 ack 的原子更新。

### 3.3 P2：主要是易用性问题

#### A-14 三模式选择器暴露技术实现

“串行/流式/实时”需要用户理解内部路线。Streaming 是冻结的半双工路线，继续出现在主入口会增加错误选择。

建议主入口只保留：

- `实时对话`：Duplex；
- `单次语音输入`：Serial。

旧 Streaming 从新 UI 移除，代码先标记 legacy，只用于迁移和回归；确认无持久偏好依赖后在后续版本删除。

#### A-15 隐私确认被当成错误显示

首次启动把 disclosure 写入 `voiceError`，再在错误区域展示确认按钮。这会让正常授权流程看起来像失败，并且每个 Thread 都重复确认。

P2 应使用专门的启动预检面板：显示 Provider、模型、是否保存转录和工具权限；按 Provider/model/policy 版本记住选择，配置变化时重新确认。

#### A-16 活动状态不可理解

UI 直接显示 reducer 内部英文 phase，缺少“正在听/你正在说/正在回答/检测到插话/正在恢复”的本地化文案、音量反馈、连接质量和恢复倒计时。

P2 应提供统一 Realtime Voice HUD，技术诊断折叠到详情区。

#### A-17 文本输入策略自相矛盾

Hook 暴露 `queueManualText()`，但 ChatWorkspace 在 Realtime 活动期间禁止文本发送，且队列从不提交给 Provider。这是死代码和误导性状态。

P2 应选择并完整实现一种行为：推荐允许用户在实时会话中发送文字，作为新的 conversation item，具有“立即打断回答/等当前回答结束”选项。实现前移除当前本地假队列。

#### A-18 设备选择只在会话启动后才容易获得标签

Duplex 的设备列表由 capture start 后刷新；开始前下拉可能没有完整设备和标签。输出设备也不可选。

P2 应提供显式“检查麦克风”动作，授权后持久枚举输入设备；支持输出 sink（平台允许时），展示实际 AEC/NS/AGC 和测试音量。

#### A-19 错误信息不可操作

底层错误多为英文技术字符串，UI 没有按 auth/model/device/network/rate_limit 给出“去设置、重试、切换单次输入”等动作。

P2 应建立 reason code → 本地化文案 → 主操作 → 备用操作映射，保留 trace ID 供诊断。

## 4. 需要移除、替换或冻结的部分

| 当前部分 | 决策 | 时机 |
| --- | --- | --- |
| 主 UI 中的旧 Streaming 选项 | 从主入口移除；保留 legacy 偏好迁移 | P2-M1 |
| `queueManualText()` 本地假队列 | 移除，替换为真实 Realtime text item | P2-M7 |
| `visibilitychange/offline => cancel` | 移除，交由 Duplex 生命周期策略处理 | P2-M5 |
| 播放高水位直接 drop | 移除，替换为消费确认/背压 | P2-M3 |
| 上行正常高水位导致 cancel | 移除，替换为 pause/resume credit | P2-M2 |
| 500 ms 本地 VAD 直接 cancel | 移除，替换为 duck + 多信号决策 | P2-M4 |
| 字符比例 heard text | 移除精确性声明；无对齐时仅标 interrupted | P2-M6 |
| capabilities 即 availability | 移除，新增 readiness contract | P2-M1 |
| 隐私 disclosure 复用 error banner | 移除，改为启动预检面板 | P2-M8 |
| 硬编码 Provider 能力作为最终事实 | 替换为静态声明 ∩ 配置 ∩ live probe | P2-M1 |

## 5. P2 优先顺序

1. 先修 A-01～A-05；这些是正确性和会话存活问题。
2. 再修 A-06～A-10；这些决定历史是否可信、入口是否可用。
3. 然后完成 A-11～A-13；提高音频质量和工具可扩展性。
4. 最后以 A-14～A-19 收敛产品体验。

详细拆解、测试与验收口径见 [duplex-voice-p2-development-plan.md](./duplex-voice-p2-development-plan.md)。
