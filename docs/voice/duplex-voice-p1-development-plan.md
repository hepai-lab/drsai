# Windows 全双工语音路线 P1 完整开发方案

最后更新：2026-08-12

技术路线：`duplex`

路线阶段：P1

首发 Provider：智增增 OpenAI-compatible Realtime

首发模型：智能体配置中的 `realtime_voice_model`，当前候选 `gpt-realtime-2`

## 1. 决策、基线与总体目标

产品停止继续扩展 `streaming/P2` 的级联半双工主线，直接建设独立的 `duplex/P1`。已有串行语音继续保留为可靠、可审核的降级路径；已有流式代码和测试暂时冻结，不能把全双工语义追加到 `voice/streaming` 内。

P1 的总体目标是：用户显式进入实时语音会话后，麦克风输入与 AI 音频输出能够持续并发；用户可以自然插话，系统能够及时停止旧输出、保持会话上下文一致，并把输入转录、输出转录、工具调用和最终聊天历史投影到现有 OpenDrSai 会话。

P1 必须完成以下结果：

1. 使用设置中独立的 `realtime_voice_model`，不覆盖普通 `text_to_speech_model`。
2. Main Process 与智增增 Realtime WebSocket 建立受认证的长连接，Provider 密钥不进入 Renderer。
3. 麦克风 PCM 持续上行，模型音频增量持续下行并低延迟播放。
4. AI 播放期间麦克风继续采集；有效用户插话触发本地立即停播和 Provider 取消。
5. 精确记录“模型已生成、客户端已接收、本地已排队、本地已播放”四种输出进度，打断后不重复播放。
6. 输入、输出转录按事件身份去重后进入可见会话；原始音频默认不持久化。
7. Realtime Function Calling 可以受控桥接到现有 Agent 工具体系，并具有审批、幂等和取消语义。
8. 弱网、Provider 错误、设备变化、睡眠恢复和窗口关闭均产生唯一终态并释放资源。
9. 串行路线保持零回归；Realtime 不可用时给出明确原因并允许用户切换串行模式。
10. 用自动化、真实 Provider、打包应用和 Windows 物理设备证据共同完成发布验收。

## 2. P1 能力分层与完成口径

全双工不能只用“支持打断”定义。P1 分两层验收：

### 2.1 P1 必须交付：可打断实时双向会话

- 输入与输出音频链路同时保持活动。
- AI 说话时可以检测新的用户发言。
- 有效插话后，本地输出立即停止，Provider 回复被取消或截断。
- 打断前用户实际听到的内容与后续上下文一致。
- 附和、环境噪声不会仅凭单帧能量机械触发取消。

### 2.2 P1 研究门禁：重叠语义理解

- 区分“嗯、对、继续”等附和与抢占发言权。
- 识别用户是在补充、纠正、停止还是提出新问题。
- 在不取消 AI 的情况下保留非抢占式附和。

如果首发 Provider 无法提供足够的重叠语义事件或模型能力，P1 可以发布为“可打断实时语音”，但不得把该能力标记为“严格语义全双工完成”；对应功能点保持未验收，并进入 `duplex/P2`。

## 3. 非目标

P1 不包含：

- 删除串行语音路线。
- 将 streaming 状态机改造成 duplex 状态机。
- 自研端到端语音基础模型。
- 多人说话人分离和会议转录。
- 电话、SIP、视频或屏幕实时输入。
- 任意 Provider 自动切换；首发只保证一个经过真实验证的 Realtime Provider。
- 断线期间无限缓存原始音频，或跨新 Provider 精确恢复旧模型的隐藏语音状态。
- 默认后台监听。麦克风只能在用户显式开始会话后启用。

## 4. 总体解决方案

```text
设置 / 智能体配置
  realtime_voice_model = zhizengzeng / gpt-realtime-2
                         |
Renderer                 | Main Process                         Provider
-------------------------+--------------------------------------+----------------------
getUserMedia              | DuplexSessionRegistry               |
AEC/NS/AGC                | RealtimeProviderAdapter             |
AudioWorklet PCM -------->| 有界上行队列 ---------------------->| input_audio_buffer
                          |                                      | VAD / response
播放水位与 AudioContext <---- 规范化 audio delta <---------------| response.audio.delta
输入/输出转录 UI <----------- 规范化 transcript event <----------| transcription events
插话检测 ---------------->| 本地 stop + response.cancel ------->| cancel / truncate
工具审批与结果 UI <---------- Tool Bridge ---------------------->| function call/result
会话历史投影 <-------------- Session Projector                  |
```

### 4.1 传输决定

P1 由 Main Process 直接维护 Provider WebSocket。这样可以复用现有模型提供方配置和凭据存储，避免 Provider 密钥进入 Renderer，也便于统一连接超时、证书、限流、日志脱敏和关闭语义。

如果智增增后续只在 WebRTC 路径支持必需能力，应先形成书面 ADR，再改为“Main 签发短期会话凭据、Renderer 建立 WebRTC”；不得把长期 API Key 传给 Renderer。

### 4.2 音频决定

- Renderer 使用 `getUserMedia` 显式申请麦克风。
- 优先启用浏览器媒体约束 `echoCancellation`、`noiseSuppression`、`autoGainControl`。
- AudioWorklet 输出统一单声道 PCM；格式和采样率由能力协商确定。
- 下行音频使用有界抖动缓冲和单调序号播放，禁止 Base64 在 Renderer IPC 契约中反复复制大块音频。
- P1 不在磁盘保存完整会话音频；诊断只保存计数、时延、水位和错误分类。

### 4.3 会话状态机

```text
idle
  -> requesting_permission
  -> connecting
  -> listening
  -> user_speaking
  -> responding
  -> overlapping
  -> interrupting
  -> listening

任一活动状态
  -> reconnecting -> listening/responding
  -> stopping -> completed
  -> failed
```

终态只能是 `completed`、`cancelled` 或 `failed` 之一。模式切换、窗口关闭、注销、Provider 配置变化和应用退出都必须先终止活动 Duplex Session。

### 4.4 插话与上下文一致性

插话是跨层原子操作：

1. 记录当前本地播放游标。
2. 立即停止并清空尚未播放的本地音频。
3. 向 Provider 发送取消/截断事件。
4. 忽略旧 response ID 的迟到音频。
5. 把“用户实际听到的输出范围”写入会话投影。
6. 继续接收用户输入并开启下一响应。

不得只停止 `<audio>` 或 AudioContext 而让旧 Provider response 继续生成；也不得把模型完整输出文本伪装成用户已经听到的内容。

### 4.5 历史、工具与安全

- Realtime Session 是短期运行状态，OpenDrSai Thread 是权威可持久化历史。
- 输入/输出 completed transcript 按稳定 item ID 投影到 Thread；delta 只用于实时显示。
- 工具调用通过现有审批体系执行，`call_id` 是幂等键。
- 用户打断语音输出不自动撤销已经产生外部副作用的工具；必须在 UI 中明确显示工具状态。
- Provider 不可用时不自动把未确认的实时音频转交另一 Provider。

## 5. 模块与功能点

P1 规划 **10 个模块、68 个功能点**。每个功能点只有在实现、自动化测试和规定的人工/真实验收均完成后才能标记完成。

### M1 路线边界、配置与公共契约（7 项）

| ID | 功能 | 实现要求 | 自动化测试 | 人工/真实验收 |
| --- | --- | --- | --- | --- |
| M1-F1 | 独立路线入口 | `voice/duplex` 建立 Main、Preload、Renderer 公共入口，不导入 serial/streaming 内部状态机 | 架构扫描阻断跨路线内部导入 | 代码评审确认路线所有权 |
| M1-F2 | 模式枚举 | `DesktopVoiceInteractionMode` 增加 `duplex`，旧偏好仍安全归一到 serial | 旧值、未知值、迁移和模式切换测试 | 设置中可明确选择实时语音 |
| M1-F3 | 实时模型槽位 | 使用 `realtime_voice_model` 和 `effective_realtime_voice_ref`，与 TTS/STT 独立 | TOML/API/IPC 往返和乐观并发测试 | 可选择并保存 `gpt-realtime-2` |
| M1-F4 | Duplex 能力契约 | 声明格式、采样率、输入/输出转录、VAD、取消、截断、工具、恢复能力 | 缺失、矛盾、未知版本 fail-closed | UI 能解释能力不足原因 |
| M1-F5 | 事件契约 | 定义 session、speech、response、audio、transcript、tool、connection、terminal 事件 | 序列化快照、非法联合类型和旧版本测试 | 诊断导出可读且不含正文 |
| M1-F6 | 错误分类 | 区分 auth、model、protocol、network、device、audio、rate_limit、policy、internal | Provider 错误映射矩阵 | 用户看到可执行恢复建议 |
| M1-F7 | Feature Flag | Duplex 未验收前默认关闭，可在开发/验收环境显式启用 | 环境、配置和打包开关测试 | 正式包不会误开放未验收入口 |

### M2 Provider 能力探针与 Realtime Adapter（8 项）

| ID | 功能 | 实现要求 | 自动化测试 | 人工/真实验收 |
| --- | --- | --- | --- | --- |
| M2-F1 | 安全握手 | 从模型提供方配置解析 Realtime URL 和认证，密钥只在 Main/Gateway | 无凭据、错凭据、错误域名和重定向测试 | 智增增真实握手成功且日志无密钥 |
| M2-F2 | 模型绑定 | 只使用当前 Agent 的 `realtime_voice_model`，禁止回退主模型或 TTS 模型 | 模型缺失、下线、跨 Provider 引用测试 | 会话诊断显示 `gpt-realtime-2` |
| M2-F3 | Session 配置 | 映射音频格式、voice、语言、VAD、转录、工具和指令 | 请求快照及不支持字段降级测试 | 智增增接受 session 配置 |
| M2-F4 | 输入事件映射 | PCM append、commit/clear、speech started/stopped 映射为统一事件 | Fixture 覆盖乱序、重复和非法事件 | 真实麦克风触发用户语音事件 |
| M2-F5 | 输出事件映射 | response、audio delta/done、transcript delta/done 统一解码 | 分块边界、迟到事件和未知事件测试 | 真实音频连续可播放 |
| M2-F6 | 取消与截断 | 映射 `response.cancel`、buffer clear 和已播放位置截断 | 取消竞态与旧 response 隔离测试 | 插话后旧输出不恢复 |
| M2-F7 | Tool 事件映射 | function arguments delta/done 和 result 关联稳定 `call_id` | JSON 分块、重复 done、非法参数测试 | 真实工具回合恢复语音回答 |
| M2-F8 | 能力探针报告 | 生成脱敏的握手、事件和能力报告，作为实施前 Go/No-Go | Fixture 正负报告 Schema 测试 | 智增增 live 报告由负责人签核 |

### M3 Main 会话内核与 IPC（7 项）

| ID | 功能 | 实现要求 | 自动化测试 | 人工/真实验收 |
| --- | --- | --- | --- | --- |
| M3-F1 | Session Registry | 每窗口至多一个活动 Duplex Session，全局并发有硬上限 | 多窗口、重复 start、销毁 sender 测试 | 第二窗口得到明确占用提示 |
| M3-F2 | 生命周期 | start、update、push、interrupt、stop、cancel、dispose 全部幂等 | 属性测试和随机事件序列 | 连续开始/结束无僵尸会话 |
| M3-F3 | 有界上行队列 | 音频帧包含序号与捕获时间；高低水位控制内存 | 慢 Provider、断网和超水位测试 | 弱网不导致进程内存持续增长 |
| M3-F4 | 有界下行通道 | 批量传输音频 delta，限制单批大小和待消费水位 | 大响应、慢 Renderer 和取消测试 | 长回复无明显 IPC 卡顿 |
| M3-F5 | 来源校验 | 仅允许受信窗口调用 Duplex IPC，不暴露通用 Socket/File 能力 | 非法 sender、参数、大小和频率测试 | 安全评审通过 |
| M3-F6 | 唯一终态 | 连接关闭、取消、窗口销毁和 Provider done 竞争时只发一个终态 | 10,000 次竞态 Fixture | 无会话永久停留在 stopping |
| M3-F7 | 资源清理 | 关闭 Socket、队列、定时器、监听器、ArrayBuffer 和任务引用 | 1,000 会话句柄/heap 压力测试 | 30 分钟反复会话资源稳定 |

### M4 Renderer 采集、AEC 与设备生命周期（7 项）

| ID | 功能 | 实现要求 | 自动化测试 | 人工/真实验收 |
| --- | --- | --- | --- | --- |
| M4-F1 | 显式权限 | 只有用户点击开始才请求麦克风；拒绝后可恢复 | 权限允许/拒绝/撤销 E2E | Windows 隐私设置行为正确 |
| M4-F2 | AudioWorklet PCM | 重采样、单声道、帧时长和量化符合协商契约 | 正弦波、静音、削波、采样率 Fixture | 真实 Provider 无格式错误 |
| M4-F3 | 浏览器 AEC/NS/AGC | 请求并记录实际生效的媒体约束，不伪造 AEC 能力 | 约束支持/降级测试 | 扬声器播放时回声可接受 |
| M4-F4 | 设备选择 | 支持 Auto、内置、USB、蓝牙；显示设备变化 | mock devicechange 和偏好迁移测试 | 三类麦克风均完成会话 |
| M4-F5 | 设备拔插 | 活动设备丢失时进入恢复或明确失败，不静默换错设备 | track ended/devicechange 竞态测试 | USB/蓝牙拔插矩阵通过 |
| M4-F6 | 睡眠与失焦 | 睡眠恢复重新校验 track、AudioContext 和连接 | 虚拟生命周期和恢复超时测试 | Windows 睡眠恢复可继续或安全结束 |
| M4-F7 | 本地 VAD 辅助 | 只用于 UI、插话候选和保护，不与 Provider 端点重复提交 | 噪声、附和、快速语速 Fixture | 噪声环境误触率达到阈值 |

### M5 增量播放、抖动缓冲与听到位置（7 项）

| ID | 功能 | 实现要求 | 自动化测试 | 人工/真实验收 |
| --- | --- | --- | --- | --- |
| M5-F1 | 增量解码播放 | 支持协商的 PCM/音频 delta，不等待完整回复 | 多分块、尾块和格式错误测试 | 首音频达到 SLO |
| M5-F2 | 有界抖动缓冲 | 启播、低水位、高水位和 underrun 策略确定 | 延迟、突发、丢块虚拟时钟测试 | 弱网无无限积压 |
| M5-F3 | 单调播放序号 | response/item/content/sequence 共同确定顺序 | 乱序、重复、跨 response 测试 | 不串轮、不重复 |
| M5-F4 | 已播放游标 | 以 AudioContext 时钟记录实际播放毫秒数 | pause/resume/clock drift 测试 | 打断位置与听感一致 |
| M5-F5 | 立即停播 | 插话或停止后在延迟预算内断开节点并清空队列 | 合成时钟测量停止延迟 | P95 停止延迟达标 |
| M5-F6 | 迟到数据隔离 | 被取消 response 的后续 delta 不得再次入队 | cancel 后洪水事件测试 | 真实插话后旧声音不恢复 |
| M5-F7 | 输出设备异常 | AudioContext suspended、设备占用、播放失败均显式恢复 | suspend/resume/error 测试 | 蓝牙切换行为可解释 |

### M6 轮次、插话与重叠仲裁（8 项）

| ID | 功能 | 实现要求 | 自动化测试 | 人工/真实验收 |
| --- | --- | --- | --- | --- |
| M6-F1 | Duplex Reducer | 实现 listening/user_speaking/responding/overlapping/interrupting 等状态 | 状态迁移表、非法迁移和属性测试 | UI 状态与真实听说一致 |
| M6-F2 | 插话候选 | 结合本地 VAD、Provider speech event、持续时间和播放状态形成候选 | 单帧噪声、短附和、连续发言 Fixture | 噪声不机械打断 |
| M6-F3 | 插话提交 | 候选满足策略后执行跨层原子取消 | stop/audio-clear/provider-cancel 顺序测试 | 用户抢话能稳定生效 |
| M6-F4 | 附和策略 | 短附和默认不抢占；Provider 有语义信号时可继续 AI 输出 | “嗯/对/继续”中英文 Fixture | 人工附和误打断率达标 |
| M6-F5 | 停止意图 | “停、别说了、stop”等高置信意图优先停止 | 同音词、否定和噪声安全测试 | 中英文停止指令通过 |
| M6-F6 | 补充/纠正 | 插话内容进入下一用户 item，旧回答按已听位置截断 | transcript/item 身份测试 | 打断后上下文不重复旧回答 |
| M6-F7 | 手动控制优先 | UI 停止、静音、结束会话优先于模型自动行为 | 用户事件与 Provider 事件竞态测试 | 所有按钮响应确定 |
| M6-F8 | 严格语义全双工门禁 | 单独统计附和、抢占、纠正和重叠理解准确率 | 标注语料离线评分 | 未达阈值不得标记严格全双工完成 |

### M7 转录、聊天历史与上下文投影（6 项）

| ID | 功能 | 实现要求 | 自动化测试 | 人工/真实验收 |
| --- | --- | --- | --- | --- |
| M7-F1 | 输入转录 | delta 仅实时展示，completed 才成为稳定用户文本 | 修订、重复、乱序测试 | 中文、英文、中英混合正确可读 |
| M7-F2 | 输出转录 | 音频回复可显示同步文本，并关联 response ID | 文本先到/音频先到/缺失测试 | 可见文本与语音语义一致 |
| M7-F3 | 历史去重 | Provider item 与 OpenDrSai message 建立稳定映射 | 重连、重放和恢复测试 | Thread 中每轮只出现一次 |
| M7-F4 | 已听内容边界 | 中断回复保存完整生成文本与已听范围的区别 | 播放游标投影测试 | UI 不误称未播放内容已被听到 |
| M7-F5 | 会话摘要 | 长会话使用有界文本摘要或 Provider truncation，不持久化无限音频 | 60 分钟 Fixture 和上下文上限测试 | 长会话仍能保持主题 |
| M7-F6 | 手工文本共存 | 实时会话期间文本消息有明确排队/拒绝策略 | 输入、发送、会话结束竞态 E2E | 不覆盖用户 Composer 草稿 |

### M8 Tool Calling、审批与副作用（6 项）

| ID | 功能 | 实现要求 | 自动化测试 | 人工/真实验收 |
| --- | --- | --- | --- | --- |
| M8-F1 | Tool Bridge | 将 Realtime function call 映射到现有工具入口 | schema、参数和结果适配测试 | 查询类工具完成真实回合 |
| M8-F2 | 幂等执行 | `call_id` 去重，重连/重放不能重复副作用 | 重复 call/done/result 测试 | 同一工具只执行一次 |
| M8-F3 | 审批 | 高风险工具继续走现有审批，不因语音绕过 | 允许、拒绝、超时和取消 E2E | 用户可用键鼠明确审批 |
| M8-F4 | 等待反馈 | 工具运行期间播放简短状态或显示状态，不制造重复回答 | 长工具和并发插话测试 | 用户知道系统仍在工作 |
| M8-F5 | 插话与工具 | 插话可停止语音，但不能伪装撤销已执行副作用 | 工具各阶段打断矩阵 | UI 显示真实工具终态 |
| M8-F6 | 结果回写 | 工具结果只回写匹配的活动会话和 call ID | 旧会话、迟到结果和敏感结果测试 | 模型基于真实结果继续回答 |

### M9 重连、隐私、诊断与成本（7 项）

| ID | 功能 | 实现要求 | 自动化测试 | 人工/真实验收 |
| --- | --- | --- | --- | --- |
| M9-F1 | 连接保活 | 心跳、空闲超时和最大会话时长有明确策略 | 虚拟时钟与服务端静默测试 | 30/60 分钟会话符合限制 |
| M9-F2 | 有界重连 | 指数退避、有次数上限；恢复不了隐藏状态时开启新 Session | 断线点随机化测试 | 网络切换后恢复或明确结束 |
| M9-F3 | 恢复边界 | 不重发无限音频；稳定 transcript/tool 状态可重建 | 重连去重和上下文快照测试 | 恢复后不重复工具和消息 |
| M9-F4 | 隐私披露 | 开始前明确远程 Provider、模型和音频发送范围 | 设置迁移和 UI 快照测试 | 用户能在授权前看到说明 |
| M9-F5 | 日志脱敏 | 密钥、URL 查询密钥、原始 PCM、完整 transcript 不进普通日志 | canary 扫描和诊断导出测试 | 真实报告无敏感正文 |
| M9-F6 | 分段指标 | 记录连接、首输入事件、TTFA、缓冲、打断、重连和资源指标 | 指标公式与单调时钟测试 | Live 报告具备 P50/P95/P99 |
| M9-F7 | 成本上限 | 记录音频时长、Token/用量和会话预算，超限前提示 | 边界、缺失用量和超限测试 | 成本提示与 Provider 账单抽样一致 |

### M10 测试体系与发布门禁（5 项）

| ID | 功能 | 实现要求 | 自动化测试 | 人工/真实验收 |
| --- | --- | --- | --- | --- |
| M10-F1 | Serial 零回归 | Duplex PR 必须先执行串行完整门禁 | `test:voice:serial` 全绿 | 串行真机完整回合通过 |
| M10-F2 | Duplex Fixture 全套 | 聚合契约、状态、音频、插话、工具、重连、隐私和压力测试 | `test:voice:duplex` 全绿 | 无 |
| M10-F3 | 打包应用 E2E | 强制 Duplex 模式，禁止以 serial/streaming 跳过 | 报告必须含双向音频、插话和唯一终态 | 打包应用完整回合录像/报告 |
| M10-F4 | Live Provider | 智增增 `gpt-realtime-2` 完成听、说、打断、转录和工具回合 | 脱敏 live runner 生成签名报告 | 负责人复听并签核 |
| M10-F5 | Windows 硬件矩阵 | Win10/11、内置/USB/蓝牙、扬声器/耳机、睡眠、拔插、弱网 | 自动采集环境和结果，禁止伪造硬件通过 | 每一矩阵项有责任人和附件 |

## 6. 需要新增的模块

| 模块 | 建议位置 | 职责 |
| --- | --- | --- |
| Duplex contracts | `apps/desktop/shared/api/desktopApi.ts` 或 `shared/voice/contracts/duplex.ts` | 会话、音频、事件、能力、工具和错误 DTO |
| `DuplexSessionRegistry` | `apps/desktop/shared/main/voice/duplex/` | 会话所有权、并发上限、唯一终态和清理 |
| `RealtimeProviderAdapter` | `apps/desktop/shared/main/voice/duplex/` | Provider 中立接口 |
| `ZhizengzengRealtimeAdapter` | `apps/desktop/shared/main/voice/duplex/providers/` | 智增增 OpenAI Realtime 协议映射 |
| `DuplexAudioUplinkQueue` | `apps/desktop/shared/main/voice/duplex/` | 有界上行 PCM 队列和水位 |
| `DuplexEventNormalizer` | `apps/desktop/shared/main/voice/duplex/` | Provider 事件验证、排序、去重和错误归一 |
| Duplex IPC registration | Main/Preload 对应 `voice/duplex` 目录 | 受限命令与事件桥接 |
| `duplexCaptureController.ts` | `apps/desktop/shared/renderer/src/voice/duplex/` | 麦克风、AudioWorklet、设备与本地 VAD |
| `duplexPlaybackController.ts` | 同上 | 增量播放、抖动缓冲、已播放游标和立即停止 |
| `duplexVoiceReducer.ts` | 同上 | 会话、听说、重叠、插话、重连和终态状态机 |
| `duplexArbitrationPolicy.ts` | 同上 | 插话候选、附和、停止意图和语义门禁 |
| `useDuplexVoiceSession.ts` | 同上 | Renderer 会话编排与 UI 动作 |
| `DuplexVoiceSessionBar.tsx` | `renderer/src/components/voice/` | 听说状态、静音、停止、结束、重连和错误 UI |
| `DuplexTranscriptView.tsx` | 同上 | 输入/输出实时转录与打断边界展示 |
| Realtime Tool Bridge | Main Agent/voice shared boundary | function call、审批、幂等和结果回写 |
| Live probe/runner | `apps/desktop/windows/scripts/` | 能力探针、真实回合和脱敏证据 |

## 7. 需要更新的模块

| 现有模块 | 更新内容 |
| --- | --- |
| `desktopApi.ts` | `duplex` 模式、能力、会话、音频、事件、工具、诊断契约 |
| `voiceMode.ts` | 三模式可用性、切换门禁和串行降级；活动会话禁止直接切换 |
| `useVoicePreferences.ts` | 增加 Duplex 明示偏好；旧偏好迁移保持 serial 默认 |
| `App.tsx` 智能体配置 | 保持独立的“实时”模型槽位并显示有效 Provider/模型 |
| Main 模型策略/Gateway | 读取 `effective_realtime_voice_ref`，提供受认证 Realtime 配置 |
| Preload | 增加最小 Duplex API，不暴露密钥、任意 URL 或原始 Socket |
| `ChatWorkspace.tsx` | 组合 Duplex Hook 和专用组件；不内嵌协议状态机 |
| Thread/message 投影 | 增加 Realtime item/response/call 到消息与工具状态的稳定映射 |
| 设置语音页 | 显示麦克风、输出设备、AEC、远程音频隐私和实时模式开关 |
| 诊断与更新日志 | 新增 Duplex SLO、Provider、设备和错误分类，保持正文脱敏 |
| `package.json` | 增加 Duplex 单元、IPC、E2E、Live、打包和 release-ready 命令 |
| 语音总览/发布文档 | 把 Duplex P1 纳入索引、状态、完成口径和回滚说明 |

## 8. 需要移除、冻结或禁止的内容

### 8.1 冻结

- `streaming/P2` 不再新增 Provider Realtime transcription 适配和 Composer 修复功能。
- 已有 streaming Fixture、测试和代码保留，直到 Duplex 发布稳定且迁移评审完成。
- streaming 不作为 Duplex 的隐式降级；降级目标是可审核的 serial。

### 8.2 产品入口调整

- 正式产品主入口只展示“可靠语音（serial）”和“实时语音（duplex）”。
- streaming 若需保留，只能位于开发/实验开关下，并明确标记半双工实验能力。
- 不迁移或删除用户现有 streaming 偏好；读取时给出一次性说明并安全归一。

### 8.3 禁止实现

- 禁止 Renderer 持有长期 Provider API Key。
- 禁止把任意 Provider WebSocket URL 暴露为通用 IPC 参数。
- 禁止复用 `streamingVoiceTurnReducer` 承载重叠和仲裁状态。
- 禁止用“检测到人声就停止”代替有持续时间、状态和语义保护的插话策略。
- 禁止取消后继续播放旧 response 的迟到音频。
- 禁止把完整原始音频或敏感 transcript 写入普通日志和验收报告。
- 禁止以 Fixture、源码字符串检查或单次演示替代真实 Provider 与物理设备验收。

## 9. 测试命令规划

```text
npm run test:voice:duplex-contracts
npm run test:voice:duplex-provider
npm run test:voice:duplex-main
npm run test:voice:duplex-capture
npm run test:voice:duplex-playback
npm run test:voice:duplex-state
npm run test:voice:duplex-arbitration
npm run test:voice:duplex-transcript
npm run test:voice:duplex-tools
npm run test:voice:duplex-recovery
npm run test:voice:duplex-privacy
npm run test:voice:duplex-stress
npm run test:voice:duplex

npm run verify:voice:duplex-ipc
npm run verify:voice:duplex-visual
npm run verify:voice:duplex-packaged
npm run verify:voice:duplex-live
npm run verify:voice:duplex-windows-hardware
npm run verify:voice:duplex-release-ready

npm run test:voice:serial
npm run verify:voice:release-ready
```

最终聚合门禁必须先运行 serial，再运行 duplex。任何 Live 或硬件门禁缺失时，报告必须显示 pending/blocked，不能把未执行记为通过。

## 10. 统一 SLO 与验收阈值

指标分别报告 Fixture、局域网/代理环境和真实广域网结果，并至少包含 P50、P95、P99。

| 指标 | 定义 | P1 目标 |
| --- | --- | --- |
| `sessionConnectMs` | 点击开始到 Realtime Session 可发送音频 | 正常网络 P95 ≤ 2,000 ms |
| `inputEventLatencyMs` | 有效人声开始到 Provider/系统确认用户发言 | P95 ≤ 300 ms |
| `timeToFirstAudioMs` | 用户语义轮次结束到首段 AI 音频实际播放 | 正常网络 P95 ≤ 1,200 ms |
| `bargeInStopLatencyMs` | 有效插话开始到本地 AI 音频停止 | P95 ≤ 150 ms，P99 ≤ 250 ms |
| `lateAudioAfterCancelMs` | 取消后仍被本地播放的旧响应时长 | 0 ms |
| `duplicateMessageCount` | 重连/重放造成的重复稳定消息 | 0 |
| `duplicateToolExecutionCount` | 相同 call ID 的重复执行 | 0 |
| `invalidTransitionCount` | 状态机非法迁移 | 0 |
| `peakUplinkBacklogMs` | 未发送/未确认音频峰值 | ≤ 配置硬上限，默认 2,000 ms |
| `peakPlaybackBacklogMs` | 已接收未播放音频峰值 | ≤ 配置硬上限，默认 3,000 ms |
| `bargeInFalsePositiveRate` | 非抢占语音被错误判为插话 | 标注集 ≤ 5% |
| `bargeInMissRate` | 明确抢占未及时停止 | 标注集 ≤ 5% |
| `acknowledgementFalseInterruptRate` | 附和被误判抢占 | 研究门禁 ≤ 10% |
| `resourceLeakCount` | 会话结束后残留 track/socket/node/timer/listener | 0 |

严格语义全双工还需要“附和、补充、纠正、停止、抢占”分类准确率达到单独批准的标注集阈值；在数据集和阈值未冻结前不得宣称完成。

## 11. 实施里程碑与退出条件

### Duplex-P1-S0 基线冻结与能力探针

- 冻结 serial 和 streaming 当前回归基线。
- 智增增 `gpt-realtime-2` 完成握手、双向音频、转录、取消和工具能力探针。
- 冻结 P1 契约与 Provider 差异表。

退出条件：真实能力报告证明基础 Realtime Speech-to-Speech 可用；否则停止实施并记录 Go/No-Go。

### Duplex-P1-S1 契约、Main Runtime 与 Fixture

- 完成 M1、M2、M3。
- 离线 Fixture 支持正常回合、插话、工具、断线和错误注入。

退出条件：Main/IPC/Provider Adapter 单元和压力测试全部通过，密钥不进入 Renderer。

### Duplex-P1-S2 双向音频产品闭环

- 完成 M4、M5 和基础 M6。
- 用户可开始会话、连续听说、手动停止和结束。

退出条件：打包 Fixture 中输入输出同时活动，播放顺序、清理和唯一终态通过。

### Duplex-P1-S3 插话、历史与工具

- 完成 M6、M7、M8。
- 打断后历史一致，工具调用受审批和幂等保护。

退出条件：自动化插话矩阵全绿；真实 Provider 完成一次普通回合、一次插话回合和一次工具回合。

### Duplex-P1-S4 恢复、隐私与长会话

- 完成 M9。
- 完成弱网、网络切换、30/60 分钟会话、睡眠和设备变化验证。

退出条件：无重复消息/工具、无敏感日志、无资源持续增长，指标达到阈值。

### Duplex-P1-S5 发布验收

- 完成 M10。
- 串行零回归、打包 E2E、Live Provider 和 Windows 物理矩阵全部有证据。

退出条件：68 个功能点逐项有实现、测试和验收证据；未完成的严格语义全双工项必须明确转入 P2，产品命名不得超出实际能力。

## 12. 风险与控制

| 风险 | 影响 | 控制措施 |
| --- | --- | --- |
| 智增增协议与 OpenAI Realtime 存在差异 | 握手成功但关键事件不可用 | S0 真实探针先行，适配器隔离差异 |
| `gpt-realtime-2` 模型元数据不完整 | 设置中候选或校验错误 | 模型 ID 兼容识别 + 最终以 live capability probe 为准 |
| Electron Main WebSocket 增加音频复制 | 延迟和内存增长 | transferable/batch、有界队列和压力门禁 |
| AEC 在部分设备失效 | AI 声音触发自我打断 | 记录实际约束、耳机建议、误打断保护和硬件矩阵 |
| 简单 VAD 被误认为语义全双工 | 产品能力失真 | M6-F8 独立研究门禁和严格命名规则 |
| 打断后上下文包含未听内容 | 回答重复或逻辑跳跃 | 已播放游标、Provider truncate 和历史双边界 |
| 工具在语音取消后重复执行 | 外部副作用 | call ID 幂等、审批、状态可见和结果归属校验 |
| 长会话上下文/成本增长 | 延迟、失败和费用失控 | 会话时长、摘要、用量预算和显式续会 |
| streaming 与 duplex 互相污染 | 回归和维护成本失控 | 路线依赖门禁、独立状态机和组合层切换 |

## 13. 开发完成定义

`duplex/P1` 只有在以下条件同时满足时才可标记完成：

- M1-M10 共 68 个功能点均有明确状态和证据。
- 智增增 `gpt-realtime-2` 真实完成双向音频会话。
- AI 播放期间麦克风持续采集，有效插话可在延迟预算内停止旧输出。
- 取消后的旧音频不恢复，历史不重复，工具不重复执行。
- 输入和输出转录可见且与正确的 Provider item/response 关联。
- 真实工具调用遵循审批、幂等和副作用边界。
- 弱网、重连、睡眠、设备拔插、窗口关闭和应用退出均有唯一终态。
- 原始音频、密钥和完整敏感转录不进入普通日志或验收报告。
- 30/60 分钟长会话和 1,000 次 Fixture 会话无资源持续增长。
- Windows 打包应用、真实 Provider 和物理设备矩阵形成可复查证据。
- 串行语音完整回归通过，Realtime 不可用时能够安全切换串行。
- 如果 M6-F8 未达到严格重叠语义阈值，产品只能称为“可打断实时语音”，不能宣称严格语义全双工。

