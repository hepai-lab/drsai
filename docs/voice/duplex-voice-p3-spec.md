# Windows 全双工实时对话 P3 规格说明（SPEC）

状态：Draft

版本：P3.0

最后更新：2026-08-16

适用范围：OpenDrSai Windows Desktop，开发环境 `.drsai-dev:28642`；生产环境 `.drsai:18642`

前置文档：

- [P1 实现审计](./duplex-voice-p1-implementation-audit.md)
- [P2 开发方案](./duplex-voice-p2-development-plan.md)
- [P2 进度](./duplex-voice-p2-progress.md)

## 1. 文档目的

本 SPEC 定义全双工实时对话 P3 的产品行为、工程边界、数据契约、异常策略和测试标准。P3 不以增加更多语音能力为目标，而是把 P2 已实现的 52 项能力收敛为普通用户能理解、能启动、能持续使用、出错后能自行恢复的产品。

P2 的自动化实现状态为 52/52，但严格验收仍为 0/52。该事实说明“功能代码存在”不等于“产品体验已经完整”。P3 必须把实现完整性、用户可理解性和故障可恢复性作为同等重要的交付物。

## 2. 当前实现审查结论

### 2.1 总体判断

当前技术架构整体合理，核心链路已经较完整，不应推倒重做：

- Renderer 使用 AudioWorklet 获取低延迟 PCM，Main/Gateway 持有 Provider 凭据，安全边界正确。
- 上行 credit、下行确认、抖动缓冲、设备切换和有界队列已经覆盖长连接的基本可靠性。
- 插话被建模为 duck、候选判断、Provider cancel、回滚的事务，而不是简单停止播放器。
- 转录以稳定事件进入 Thread，并区分生成内容、实际播放范围和中断状态。
- 工具调用接入正式审批门，保留 `call_id` 幂等和时间线。
- Readiness、占用接管、生命周期恢复和临时诊断已经形成独立能力。

因此，P3 应保留现有 `voice/duplex` 领域边界、Main/Gateway 凭据边界和协议 v2，不进行大规模协议重写。

### 2.2 功能完整性缺口

| 编号 | 当前问题 | 影响 | P3 决策 |
| --- | --- | --- | --- |
| G-01 | Renderer 本地采集异常仍可被统一归类为 `audio`，UI 依赖错误字符串 | 用户只看到模糊原因；恢复动作可能不准确 | 引入分阶段、结构化本地错误契约 |
| G-02 | 启动事务没有向 UI 暴露当前阶段 | “正在连接”无法区分授权、音频引擎、Provider 和播放准备 | 增加可观察的启动阶段及超时 |
| G-03 | `useDuplexVoiceInput` 同时承担资源、协议、历史、工具、UI 状态 | 竞态难审计，任一改动影响面过大 | 拆成会话编排器、媒体控制器和投影 store |
| G-04 | `ChatWorkspace` 同时保留 serial、streaming、duplex 分支 | 旧半双工路线仍扩大主页面复杂度和回归面 | 完成迁移后删除运行时 streaming 分支 |
| G-05 | `DesktopVoiceInteractionMode` 仍公开 `streaming` | 新代码仍可能重新写入已下线模式 | vNext 类型仅保留 `serial | duplex`，旧值只在迁移器中出现 |
| G-06 | `realtimeEnabled` 与 `interactionMode` 可形成组合状态 | 设置与输入栏容易不同步或出现不可达状态 | 改为单一规范化选择模型，保留一次性兼容读取 |
| G-07 | Provider session 建立后才创建部分播放对象 | 后半段失败会产生短暂计费 Session 和复杂回滚 | 播放设备预检前移，Provider 只在本地媒体准备完成后启动 |
| G-08 | 真实 Chromium 音频调用缺少跨版本契约测试 | `Illegal invocation` 一类问题无法被纯 Fake 测试发现 | 增加 Electron 真实页面媒体 smoke test |
| G-09 | 文本、工具、音频、终态逻辑集中在一个事件循环 | 重复终态和异步清理的正确性依赖多个 ref | 使用单一 session reducer 和幂等终态闩锁 |
| G-10 | 设置同步依赖同页面 CustomEvent 和跨页面 StorageEvent | 多窗口同时修改时缺少版本冲突语义 | 偏好增加 revision，由 Main 统一持久化和广播 |

### 2.3 用户易用性缺口

| 编号 | 当前问题 | 用户感受 | P3 决策 |
| --- | --- | --- | --- |
| U-01 | 活动 HUD 一次展示音量、输入输出转录、流控、网络、质量、费用、工具和五个按钮 | 信息密度失控，用户不知道主要动作 | 默认只显示状态、音量和结束；其他信息进入详情 |
| U-02 | 同时存在“结束本轮发言、暂停麦克风、立即打断、结束会话、立即取消” | 动作语义难区分，容易误结束 | 主界面只保留“暂停/继续”和“结束对话” |
| U-03 | 正常隐私确认复用错误区域 | 首次启动看起来像失败 | 使用轻量首次确认浮层，不进入错误状态 |
| U-04 | Readiness 与运行错误的中英文和技术层级不一致 | 用户看到 Provider、AudioWorklet、uplink 等内部词 | 主提示用户化，技术原因和 trace ID 折叠到详情 |
| U-05 | 设置项多且按技术能力组织 | 用户必须理解 Provider、转录策略和恢复策略 | 按“模式—设备—声音”组织，自动项默认隐藏 |
| U-06 | 切换模式时没有统一的活跃会话保护 | 可能在未理解的情况下终止会话 | 活跃时切换先确认结束，成功后再持久化新模式 |
| U-07 | 麦克风和扬声器问题只能在启动对话时暴露 | 排障成本高且可能启动计费 Session | 设置页提供不连接 Provider 的本地设备测试 |
| U-08 | 网络与质量提示可连续堆叠 | HUD 抖动、读屏重复播报 | 同类提示合并、节流并分级显示 |

### 2.4 与官方 Realtime 能力的校准

OpenAI 官方文档将 Realtime 定义为音频和文本实时输入输出，可通过 WebRTC、WebSocket 或 SIP 建立连接；PCM 输出固定为 24 kHz，并支持 function calling。当前 OpenDrSai 选择 Gateway WebSocket 是合理的，因为它需要在可信进程中统一管理 Provider 密钥、工具审批和多 Provider 适配；P3 不改为 Renderer 直连 Provider。

官方 Realtime API 同时提供 server VAD、自动生成响应和自动中断参数。P3 的原则是：Provider VAD 是主要轮次证据，本地 VAD 只负责即时视觉反馈、duck 和候选判断，不能单独宣布一轮完成或永久取消 Provider 回答。

参考：

- https://developers.openai.com/api/docs/models/gpt-realtime
- https://platform.openai.com/docs/api-reference/realtime

## 3. P3 总体目标

P3 完成后应满足：

1. 用户只看到“单次语音输入”和“全双工实时对话”两种模式，并且设置页与输入栏始终同步。
2. 新用户默认使用单次语音输入；未显式启用实时对话时，不在输入栏提供不可用的实时入口。
3. 实时对话从点击到可说话具有明确阶段、超时和可恢复结果，不出现无上下文的技术错误。
4. 活动界面只保留一个主状态和两个核心动作；高级信息按需展开。
5. 麦克风、扬声器、Provider、网络、协议和权限错误可被准确分类，并提供对应的一步恢复动作。
6. 全双工会话的启动、运行、插话、恢复、结束和历史写入只有一个权威状态机。
7. 旧 streaming 路线从产品运行时代码和公开类型中移除，仅保留有时限的读取迁移器。
8. 不降低 P2 已有的背压、隐私、工具审批、历史可信度和故障恢复能力。

## 4. 输入与输出

### 4.1 输入

- 用户动作：选择模式、首次启用确认、开始、暂停、继续、结束、重试、切换设备、发送文字。
- 媒体输入：系统麦克风 `MediaStream`，实际采样率可为 44.1/48/96 kHz。
- 配置输入：Agent 的 Realtime Provider/model 绑定、输入/输出设备、语言、音色、音量。
- Runtime 输入：Readiness、session events、credit、audio delta、transcript、tool call、usage、diagnostic。
- 生命周期输入：窗口隐藏、锁屏、挂起、恢复、网络离线/在线、设备插拔、窗口销毁。

### 4.2 输出

- Provider 上行：24 kHz、单声道、PCM s16le、有序且受 credit 控制的音频帧。
- 本地播放：有序 PCM、带确认游标、可 duck、可中断、可恢复。
- UI 输出：单一用户状态、音量反馈、稳定转录、必要恢复动作和折叠诊断。
- Thread 输出：仅稳定的用户/助手消息、工具时间线及可信的 voice metadata。
- 诊断输出：不含原始音频和凭据的结构化阶段、reason code、trace ID 和性能指标。

## 5. 产品行为与业务规则

### 5.1 模式与启用规则

1. 用户模式仅为：
   - `serial`：单次语音输入。
   - `duplex`：全双工实时对话。
2. 新安装默认：`realtimeOptIn=false`、`selectedMode=serial`。
3. 未启用实时对话时：设置页显示实时能力卡片和“启用”动作；输入栏模式菜单不显示 duplex。
4. 启用成功后：输入栏和设置页都可在两种模式间切换。
5. 任一入口修改模式后，所有窗口必须收到同一 revision 的偏好更新。
6. 活跃实时会话中切换为 serial，必须先确认“结束实时对话并切换”；取消确认不得修改偏好。
7. Readiness 失败不自动改写用户选择，只暂时禁用开始并提供恢复或切换动作。

### 5.2 启动规则

启动按以下顺序执行，每步必须可取消且有超时：

1. 刷新 Agent 模型绑定和 Readiness。
2. 校验隐私确认指纹；必要时展示首次确认。
3. 获取麦克风并验证存在 live audio track。
4. 创建并恢复 AudioContext，加载 AudioWorklet，构建但不接通采集图。
5. 创建播放上下文并验证选定输出设备；失败时回退系统默认设备并提示。
6. 启动 Provider Session。
7. 收到 session ready 和初始 credit 后激活采集图。
8. 进入 `listening`。

任何一步失败，必须逆序释放已创建资源；Provider 未启动前不得产生远端会话。Provider 已启动后的失败必须显式 cancel。

### 5.3 活动状态与主界面

主 HUD 状态只允许显示以下之一：

- 正在连接
- 正在听
- 你正在说话
- OpenDrSai 正在回答
- 正在恢复连接
- 麦克风已暂停
- 正在结束
- 需要处理

主 HUD 固定显示：状态、输入音量、暂停/继续、结束对话。

以下内容默认不显示，仅在状态异常或展开“详情”后出现：输入/输出设备、网络质量、缓冲、credit、费用、转录草稿、工具状态、trace ID、立即取消。

“结束本轮发言”仅在 Provider 不支持自动 VAD 或用户选择手动轮次时出现；默认 server VAD 模式不显示。独立“立即打断”按钮从主 HUD 移除，用户直接说话即触发插话。“立即取消”仅放在错误恢复或高级详情中。

### 5.4 插话规则

1. 本地检测到可能语音时，100 ms 内降低当前播放音量。
2. 只有 Provider speech event、有效 ASR 前缀、明确停止意图或持续语音证据达到策略阈值，才能提交中断。
3. 附和词、回声和短噪声只 duck，随后恢复原播放音量。
4. Provider 已自动中断时，本地不得再次发送重复 cancel。
5. 中断后的历史只声明已生成内容和可证明的播放范围；无词级时间戳时不得推断精确“已听文字”。

### 5.5 文字与工具规则

1. 活跃实时会话允许发送纯文字 item。
2. 默认策略为等待当前回答结束后发送；用户可选择“立即发送并打断”。
3. 同一时刻最多存在一条待发送文字；取消时恢复到输入框。
4. P3 不支持实时会话中的附件，必须在发送前明确阻止且保留草稿。
5. 工具调用沿用 Desktop 正式审批策略；写操作不得因来自语音而降低审批级别。
6. Session 结束或接管时，未开始工具必须取消；执行中的工具按正式执行器的取消和副作用规则处理。

### 5.6 生命周期与结束规则

- `hidden`：不结束 Session；按用户偏好继续或暂停麦克风。
- `offline`：停止提交新音频，进入有界恢复；不重放断线期间旧音频。
- `suspend/lock`：释放捕获图并保留可恢复 Session 状态。
- `resume/unlock`：重新建立本地媒体；若超出 Provider 恢复窗口，则明确开始新 Session，不伪装为原 Session 连续。
- “结束对话”：停止新采集，drain 稳定转录和最终响应至 deadline，再完成会话。
- “立即取消”：丢弃未稳定内容并立刻释放资源。
- 任一 terminal event 只能执行一次清理、一次历史 flush 和一次 UI 终态转换。

## 6. 接口与数据结构

### 6.1 偏好模型 vNext

```ts
type VoiceInteractionMode = "serial" | "duplex";

interface VoicePreferencesVNext {
  schemaVersion: 11;
  revision: number;
  realtimeOptIn: boolean;
  selectedMode: VoiceInteractionMode;
  serial: {
    inputDeviceId: string;
    language: "auto" | "zh-CN" | "en-US";
    confirmBeforeSend: boolean;
  };
  duplex: {
    inputDeviceId: string;
    outputDeviceId: string;
    language: "auto" | "zh-CN" | "en-US";
    voice: string;
    volume: number;
    autoRecovery: boolean;
    transcriptPolicy: "stable" | "none";
    disclosureFingerprint: string;
  };
}
```

规范化规则：`realtimeOptIn=false` 时 `selectedMode` 强制为 `serial`。旧 `interactionMode=streaming` 迁移为 `serial`；旧 `realtimeEnabled` 只参与一次迁移，写回后不再保留。

### 6.2 本地媒体错误

```ts
type DuplexLocalFailureStage =
  | "microphone_permission"
  | "microphone_device"
  | "audio_context"
  | "audio_worklet"
  | "audio_graph"
  | "output_device"
  | "audio_processing"
  | "audio_uplink";

interface DuplexLocalFailure {
  domain: "local_media";
  stage: DuplexLocalFailureStage;
  code: "permission_denied" | "device_missing" | "unsupported" |
    "timeout" | "invalid_invocation" | "resource_exhausted" | "unknown";
  retryable: boolean;
  userMessageKey: string;
  traceId: string;
  technicalDetail?: string;
}
```

禁止再将全部本地异常映射为 `{ code: "audio" }`。UI 不解析 `message` 决定动作。

### 6.3 启动状态

```ts
type DuplexStartupStage =
  | "checking_readiness"
  | "awaiting_disclosure"
  | "preparing_microphone"
  | "preparing_playback"
  | "connecting_provider"
  | "activating_audio";

interface DuplexSessionSnapshot {
  sessionId: string | null;
  phase: "idle" | "starting" | "active" | "recovering" | "ending" | "failed";
  startupStage?: DuplexStartupStage;
  turn: "listening" | "user_speaking" | "assistant_speaking" | "interrupting";
  microphone: "active" | "paused" | "unavailable";
  failure?: DesktopDuplexVoiceError | DuplexLocalFailure;
  revision: number;
}
```

### 6.4 模块调整

| 模块 | 操作 | 要求 |
| --- | --- | --- |
| `voice/duplex/useDuplexVoiceInput.ts` | 拆分 | Hook 只做 React 订阅；资源和事件编排迁入 `DuplexSessionCoordinator` |
| `voice/duplex/captureController.ts` | 完善 | 输出结构化阶段错误；增加真实 Web API receiver 回归测试 |
| `voice/duplex/browserPcmPlaybackSink.ts` | 完善 | 预检、输出回退、AudioContext 恢复和关闭幂等 |
| `voice/duplex/duplexTurnReducer.ts` | 扩展 | 升级为唯一 Session + turn reducer，拒绝非法状态跳转 |
| `voice/duplex/duplexUiModel.ts` | 完善 | 用户文案、恢复动作、提示合并和可访问性投影 |
| `components/ChatWorkspace.tsx` | 缩减 | 移出 Realtime HUD、首次确认、错误卡片和设备详情 |
| 新增 `components/voice/RealtimeVoiceHud.tsx` | 新增 | 只接收 view model 与用户 intent，不直接调用 desktopApi |
| 新增 `components/voice/RealtimeVoiceDisclosure.tsx` | 新增 | 非错误式首次确认 |
| `useVoicePreferences.ts` | 替换 | v11 规范化模型；Main 持久化、revision 广播，多窗口一致 |
| `DesktopVoiceInteractionMode` | 更新 | 产品类型移除 `streaming`；迁移输入另设 legacy type |
| streaming renderer/main modules | 移除 | 通过删除门禁后删除运行时、UI 分支和新配置入口 |
| P2 evidence/finalizer scripts | 归档 | 保留历史证据读取，不进入普通开发主测试链 |

## 7. 边界条件与异常处理

1. 麦克风权限拒绝：不得启动 Provider；提示打开系统麦克风设置、重试、切换单次输入。
2. 麦克风在会话中拔出：暂停上行，尝试系统默认设备；失败则保持会话并请求用户选择，不无限重试。
3. 输出设备拔出：自动回退系统默认输出并显示一次非阻断提示。
4. AudioContext 被系统挂起：最多自动恢复 3 次；指数退避后转为用户可操作失败。
5. Provider 能力在 Readiness 后变化：启动再次校验；不满足时 fail-closed，不偷偷关闭转录或工具安全能力。
6. credit 长时间为零：继续本地 VAD；语音仅有界缓存，超限时提示用户重复，不拼接过期语音。
7. 下行缺帧：有界等待后跳过缺口并继续播放，记录 degradation，不永久卡住。
8. 多窗口竞态：接管必须携带 expected session ID；不匹配时刷新占用信息。
9. 历史写入失败：稳定消息保留 dirty revision；结束前重试，失败时明确提示但不得把未保存内容标为已保存。
10. Provider error：可恢复错误不得默认关闭 Session；只有协议不兼容、鉴权失败和显式 terminal 才终止。
11. 文本输入超限、重复 item ID、非法 tool arguments：本地拒绝，不进入 Provider。
12. 应用退出或窗口销毁：执行幂等 dispose；不得残留麦克风占用、MessagePort、timer 或 Registry owner。

## 8. 非功能要求

### 8.1 性能

- 点击开始到 `listening`：本地媒体准备 P95 ≤ 800 ms；Provider 连接后整体 P95 ≤ 2.5 s，不含首次人工授权时间。
- 用户开口到本地音量反馈：P95 ≤ 80 ms。
- 用户插话到本地 duck：P95 ≤ 100 ms；到 Provider cancel 提交：有充分证据后 P95 ≤ 250 ms。
- 首个 Provider 音频到可听播放：P95 ≤ 180 ms。
- 连续 30 分钟会话：Renderer heap 增长 ≤ 30 MB，AudioContext、track、timer 和 port 数量无单调增长。
- UI 状态更新最高 10 Hz；音量计可 20 Hz，但不得触发整个 ChatWorkspace 重渲染。

### 8.2 可靠性

- Session 清理、终态、接管和历史 flush 全部幂等。
- 正常拥塞不得导致 Session cancel。
- 10 分钟 5% 丢包、200 ms 抖动模拟下不得永久静音或永久等待缺失序号。
- 同一错误自动重试有上限，不允许无限连接或权限弹窗循环。

### 8.3 安全与隐私

- Provider 长期凭据不得进入 Renderer、日志、Thread 或诊断导出。
- 原始音频默认不落盘；临时诊断也只保存指标和 reason code。
- 首次远端传输前必须完成与 Provider/model/policy 指纹绑定的明确确认。
- 工具审批策略与文字会话一致，语音不能绕过风险分级、allow once、reject 和 cancel。
- 所有跨 IPC 数据设置大小、深度、序列和会话所有权限制。

### 8.4 可访问性与本地化

- 所有核心动作支持键盘且有可见焦点。
- 状态变化使用单一 `aria-live=polite` 区域；音量变化不得持续播报。
- 错误使用 `alert`，但同一错误不重复播报。
- 中英文文案均不得直接暴露内部枚举；技术详情例外。
- 200% 缩放和 320 px 宽度下主操作不溢出。

### 8.5 可观测性

- 每次启动生成 trace ID，贯穿 Renderer、IPC、Main、Gateway 和 Provider adapter。
- 记录阶段耗时、重连次数、音频输入/输出时长、丢帧/跳帧、插话结果和最终 reason code。
- 不记录原始音频、完整工具敏感参数、API key 或未经用户选择的完整临时转录。

## 9. 功能点、测试案例与验收标准

### P3-F1 两模式单一真源

测试案例：

- TC-F1-01：全新配置启动，只显示单次语音输入。
- TC-F1-02：启用实时对话后，设置页和输入栏均出现两模式。
- TC-F1-03：任一入口切换，另一入口和第二窗口在一次广播内同步。
- TC-F1-04：v1～v10 及 `streaming` 旧值迁移后均得到合法 v11 状态。

验收：不存在 `enabled=true + selectedMode=serial/duplex` 的歧义组合；公开产品类型不再包含 streaming。

### P3-F2 渐进式设置页

测试案例：

- TC-F2-01：默认仅显示模式卡、当前设备和声音。
- TC-F2-02：高级设置折叠后仍可访问自动恢复、转录策略和诊断。
- TC-F2-03：本地麦克风测试不调用 Provider start API。
- TC-F2-04：设备标签、权限拒绝、设备拔出均有明确反馈。

验收：5 名首次用户中至少 4 名可在 30 秒内完成模式选择和设备测试，无需解释 Provider/duplex/VAD。

### P3-F3 启动状态与结构化错误

测试案例：

- TC-F3-01～08：分别注入 readiness、permission、AudioContext、Worklet、graph、output、Provider、activation 失败。
- TC-F3-09：模拟 Web API receiver 丢失，必须归类 `invalid_invocation` 并显示阶段。
- TC-F3-10：每阶段超时后资源计数归零。

验收：所有失败都有唯一阶段、reason code、主操作、备用操作和 trace ID；不得只显示 `audio` 或原始 `Illegal invocation`。

### P3-F4 极简活动 HUD

测试案例：

- TC-F4-01：八种主状态分别做视觉快照、键盘和读屏测试。
- TC-F4-02：网络、质量、费用和工具事件并发时只显示一个主状态，详情不推动输入框跳动。
- TC-F4-03：主界面仅有暂停/继续和结束对话；高级取消可在两步内到达。

验收：常态 HUD 不超过两行状态信息和两个动作；320 px/200% 缩放无溢出。

### P3-F5 单一会话状态机

测试案例：

- TC-F5-01：对每个状态生成所有事件，非法转换必须拒绝并记录。
- TC-F5-02：completed、cancelled、failed 乱序重复 10,000 次，清理和历史 flush 各执行一次。
- TC-F5-03：启动中取消、恢复中结束、工具审批中接管均无资源泄漏。

验收：Session 的权威 phase 只存在于 reducer；React refs 不再各自决定终态。

### P3-F6 媒体兼容与设备恢复

测试案例：

- TC-F6-01：Electron 真实页面执行 getUserMedia、AudioContext、AudioWorklet、MessagePort 首帧闭环。
- TC-F6-02：44.1/48/96 kHz 输入和默认/USB/蓝牙设备矩阵。
- TC-F6-03：会话中拔插输入输出设备、系统锁屏和睡眠恢复。

验收：支持矩阵中无 `Illegal invocation`；失败时可恢复且不产生孤儿 Provider Session。

### P3-F7 插话和轮次自然性

测试案例：

- TC-F7-01：正常抢话在目标时延内停止旧回答。
- TC-F7-02：“嗯、对、继续”等附和只 duck 后恢复。
- TC-F7-03：扬声器回声、键盘声和背景电视不触发永久中断。
- TC-F7-04：Provider 自动中断与本地中断竞态不重复 cancel。

验收：真人 50 次正常抢话成功率 ≥ 95%；50 次附和/噪声误中断率 ≤ 5%。

### P3-F8 可信历史、文字与工具

测试案例：

- TC-F8-01：跨轮次、并发 response 和中断的稳定转录顺序正确。
- TC-F8-02：无词级时间戳时不生成 heardContent。
- TC-F8-03：待发文字取消恢复草稿；附件阻止但不丢草稿。
- TC-F8-04：工具 allow/reject/timeout/cancel、重复 call ID 和进程崩溃恢复。

验收：Thread 重开后稳定内容、voice metadata 和工具时间线一致；未听内容不进入后续模型上下文。

### P3-F9 Streaming 删除门禁

测试案例：

- TC-F9-01：扫描公开类型、UI、Main 注册和新配置写入，无 streaming 运行时引用。
- TC-F9-02：旧配置迁移、旧 Thread 读取和 serial 回归通过。
- TC-F9-03：删除后构建体积和初始化 handler 数减少，未出现失效 import。

验收：streaming 仅允许出现在 migration fixture、历史文档和删除门禁白名单中。

### P3-F10 非功能与发布门禁

测试案例：

- TC-F10-01：30 分钟真实设备 soak 和 10 分钟弱网。
- TC-F10-02：凭据、原始音频、敏感参数 canary 扫描。
- TC-F10-03：Windows 10/11，内置/USB/蓝牙，扬声器/耳机矩阵。
- TC-F10-04：开发 28642 与生产 18642 数据域隔离。

验收：第 8 节全部指标通过，并附当前候选构建、环境、测试人和时间戳证据。

## 10. 实施顺序

### P3-A：状态与错误收敛

- P3-F1、P3-F3、P3-F5。
- 先建立新契约和兼容适配器，再迁移 UI。

### P3-B：界面与设置收敛

- P3-F2、P3-F4。
- 抽离 HUD 和 disclosure，减少 ChatWorkspace 语音分支。

### P3-C：真实媒体与自然交互

- P3-F6、P3-F7、P3-F8。
- 重点补真实 Chromium/Electron 与物理硬件覆盖。

### P3-D：删除与发布门禁

- P3-F9、P3-F10。
- streaming 删除必须在迁移、Serial 回归和候选包验证通过后执行。

## 11. 明确移除的内容

1. 主 UI 中的 streaming/半双工入口、状态条和选择逻辑。
2. `DesktopVoiceInteractionMode` 产品类型中的 `streaming` 成员。
3. `realtimeEnabled` 与 `interactionMode` 双字段作为运行时真源的设计。
4. 常态 HUD 中的“结束本轮发言、立即打断、立即取消”三个常驻按钮。
5. 常态 HUD 中直接展示 uplink、buffer、jitter、usage 和内部英文 phase。
6. 将首次隐私确认写入 error banner 的行为。
7. 本地错误全部降格为 `code=audio` 的兜底映射。
8. ChatWorkspace 对 Realtime 资源和协议事件的直接编排职责。
9. 已完成 P2 的日常 evidence/finalizer 脚本进入普通单元测试主链；这些脚本归档到发布审计链。

## 12. 明确保留并完善的内容

1. Serial 单次语音输入作为默认模式和可靠降级路径。
2. `voice/duplex` 独立领域模块及协议 v2。
3. Main/Gateway 凭据所有权和 MessagePort PCM 通道。
4. credit/ack 背压、抖动缓冲、播放游标和有界恢复。
5. Provider VAD + 本地候选 VAD 的多信号插话。
6. 稳定转录、revision/CAS、可信 heard metadata。
7. 正式工具审批、幂等 call ID 和 Thread timeline。
8. Readiness、占用接管、生命周期恢复和隐私默认不落原始音频。

## 13. P3 明确不做

- 不支持多人说话人分离、会议纪要或电话/SIP。
- 不持久化整场原始音频，不提供后台录音。
- 不把 Provider API key 下发到 Renderer。
- 不在 P3 引入新的第三方 Realtime Provider；只完善现有 adapter 契约。
- 不把 Gateway WebSocket 改为 Renderer 直连 WebRTC。
- 不支持实时会话中的图片、文件或其他附件。
- 不提供自定义 VAD 阈值、jitter 数值、PCM 格式等普通用户设置。
- 不承诺断网期间音频无损补传；恢复后明确要求重复未确认内容。
- 不在缺少词级对齐证据时推断用户实际听到的精确文本。
- 不将自动化通过等同于真人听说、物理硬件或稳定发布周期验收。

## 14. Definition of Done

P3 只有同时满足以下条件才算完成：

1. P3-F1～P3-F10 的自动化测试全部通过。
2. Windows 10/11 和内置、USB、蓝牙设备矩阵完成实名测试。
3. 真实 Provider 完成开始、连续多轮、插话、文字、工具、弱网恢复和结束闭环。
4. 新用户测试达到模式选择和设备测试目标。
5. streaming 删除门禁通过，Serial 零回归。
6. 安全扫描确认无凭据、原始音频和敏感工具参数泄漏。
7. 性能与资源指标满足第 8 节要求。
8. 生产仍默认单次语音输入；是否扩大实时对话启用范围由独立 rollout 决策决定。
