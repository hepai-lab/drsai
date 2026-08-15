# Windows 全双工语音 P2 开发方案

最后更新：2026-08-14

技术路线：`duplex/P2`

前置文档：[P1 实现审计](./duplex-voice-p1-implementation-audit.md)

## 1. 总体目标

P2 把 P1 的“可连接、可双向传输、可插话”技术骨架，升级为可作为默认入口候选的可靠实时语音体验。完成后应满足：

1. 正常弱网、短暂离线、窗口隐藏、设备切换和系统休眠不会无解释地结束会话。
2. 上下行全链路有真实背压，不通过丢失关键 PCM 或取消会话来处理正常拥塞。
3. 插话先快速降低旧输出，再基于多信号决定是否取消；附和、回声和环境噪声不会频繁误打断。
4. Thread 中只保存稳定、可解释的内容；“已听到”有对齐证据，没有证据时不伪造。
5. 用户只面对“实时对话”和“单次语音输入”，无需理解 Serial/Streaming/Duplex 技术名词。
6. 启动前即可知道是否可用、为什么不可用、使用哪个 Provider/model、会发送和保存什么。
7. 语音中可以安全使用文字和工具；审批、取消、副作用和历史均可追踪。
8. 自动化、故障注入、真实 Provider、打包应用和 Windows 硬件矩阵共同证明发布质量。

## 2. 非目标

- 不做多人说话人分离、会议纪要或电话/SIP。
- 不持久化整场原始音频。
- 不把旧 Streaming 状态机改造成 Duplex；旧路线只做迁移和下线。
- 不在 Renderer 保存长期 Provider 密钥。
- 不承诺跨 Provider 无损恢复隐藏的模型音频状态。
- 不在 P2 引入任意第三方写工具；先完成现有审批体系的安全桥接。

## 3. 解决方案概览

```text
启动预检 / Readiness
  ├─ rollout + Agent realtime model + Gateway + credential + live capability
  └─ device permission + input/output readiness
                         │
Renderer                 │ Main/Gateway                       Provider
-------------------------+------------------------------------+------------------
Capture Worklet          │ credit-based uplink               │ input buffer
pause/resume by credits ─┼─ bounded queue + ack ─────────────>│
local VAD + echo ref      │                                    │ server VAD/ASR
duck first ──────────────>│ interruption transaction ────────>│ cancel/truncate
playback timeline <───────┼─ downlink credits/ack <────────────│ audio delta
stable item journal ─────>│ revisioned Thread append          │ transcripts/tools
Realtime Voice HUD        │ metrics + reason codes             │
```

协议从 v1 升级到 v2。v2 明确以下不变量：

- 音频帧的 `accepted`、`queued`、`played`、`discarded` 含义不同。
- 正常高水位只改变 credit，不产生 terminal。
- terminal 前必须经过 drain 或明确 cancel。
- 每个 interrupt 有独立 `interruptId` 和最终 outcome。
- 稳定历史以 item revision 写入，不以 Renderer 当前数组整体覆盖。

## 4. 模块与功能点

P2 规划 10 个模块、52 个功能点。每项均包含自动化测试和人工/真实验收；两类证据都满足后才算完成。

### M1 产品入口、Readiness 与旧路线收敛（6 项）

| ID | 功能点 | 实现/更新 | 自动化测试 | 验收方案 |
| --- | --- | --- | --- | --- |
| M1-F1 | 两种用户模式 | 设置和 Composer 仅显示“实时对话”“单次语音输入”；内部仍映射 duplex/serial | 偏好迁移、未知值、回滚快照 | 新用户无需解释即可选对；旧用户偏好不丢失 |
| M1-F2 | Streaming 下线迁移 | 从主 UI 移除 streaming；旧值迁到 serial，并记录一次迁移诊断；代码标 legacy | 配置迁移、无新引用架构扫描、Serial 零回归 | 升级后不出现失效模式，旧会话仍可读 |
| M1-F3 | Readiness 契约 | 新增 rollout/Gateway/credential/model/provider/device 分项状态和 reason code | 每种组合、超时、缓存失效、fail-closed | 未就绪时开始按钮禁用且原因准确 |
| M1-F4 | 动态能力交集 | 最终能力 = Adapter 静态上限 ∩ 模型配置 ∩ live probe | 能力缺失、矛盾、旧 probe、模型切换 | UI 仅承诺实测支持的转录/VAD/cancel/tool |
| M1-F5 | 一键修复动作 | reason code 映射到“打开智能体设置/重试 Gateway/切换单次输入” | 路由和动作映射测试 | 每个常见失败都有一个主操作和备用操作 |
| M1-F6 | 会话占用体验 | 多窗口冲突显示占用窗口、开始时间和安全接管选项 | registry 接管竞态、拒绝、原窗口销毁 | 第二窗口不会只看到技术错误 |

### M2 上行采集、重采样与信用流控（6 项）

| ID | 功能点 | 实现/更新 | 自动化测试 | 验收方案 |
| --- | --- | --- | --- | --- |
| M2-F1 | v2 上行 credit | Main 发布 frame/byte/ms credit；Renderer 只在额度内 postMessage | 虚拟时钟、乱序 ack、额度耗尽/恢复、属性测试 | 弱网 10 分钟无正常拥塞导致的会话取消 |
| M2-F2 | 采集暂停策略 | credit=0 时保留 VAD 观测但暂停上传；只可丢弃未承诺静音帧 | 语音/静音边界、暂停恢复、序号连续性 | 恢复后不重复、不把半句话拼错 |
| M2-F3 | 流式高质量重采样 | 以带抗混叠低通的流式 resampler 替换线性实现 | 44.1/48/96→24 kHz 频响、相位连续、长时漂移 | 真机无明显高频混叠或语速漂移 |
| M2-F4 | 采集质量监测 | clipping、静音、DC offset、实际采样率和约束降级事件 | 合成波形与阈值测试 | HUD 能提示“麦克风太小/削波/AEC 未生效” |
| M2-F5 | 启动顺序事务 | 先完成预检和用户授权，再开 Provider；失败反向释放所有资源 | 每一步故障注入与资源泄漏测试 | 拒绝麦克风不会创建计费 Session |
| M2-F6 | 输入设备热切换 | 会话中切换麦克风，使用 generation barrier，不混入旧设备帧 | devicechange、track ended、快速连切 | 内置/USB/蓝牙互切不需要结束整场会话 |

### M3 下行播放、真实游标与背压（6 项）

| ID | 功能点 | 实现/更新 | 自动化测试 | 验收方案 |
| --- | --- | --- | --- | --- |
| M3-F1 | 下行消费确认 | Renderer 按已接收/已排程/已播放回报 credit，Main 限制发送水位 | 慢 Renderer、突发音频、确认丢失 | 长回复不造成 IPC 堆积或直接丢帧 |
| M3-F2 | 缺口恢复 | 有界重排序窗口和 gap timeout；跳序必须产生日志与 UI 降级 | 乱序、重复、永久缺帧、跨 response | 缺一帧不会让整段后续音频永久静音 |
| M3-F3 | 真实播放时间线 | 记录每个 source 的 scheduled/start/end/cancel，计入 base/output latency | gap、suspend、clock drift、cancel 测试 | played cursor 与录音回放误差满足阈值 |
| M3-F4 | 自适应 jitter buffer | 根据网络抖动在低延迟和连续性之间调整 60–400 ms 水位 | 抖动模型、突发、稳定收敛 | Wi-Fi 弱网无频繁爆音，稳定网不显著增延迟 |
| M3-F5 | 输出设备与恢复 | 支持可用平台的 sink 选择；suspend/设备丢失显示恢复动作 | sink change、AudioContext suspend、占用错误 | 扬声器/USB/蓝牙切换行为可预测 |
| M3-F6 | 音量与 duck | 独立语音音量；候选插话先 80–120 ms duck，可撤销恢复 | gain envelope、重复 duck、cancel | 附和时 AI 短暂变轻但不被截断，抢话时迅速停声 |

### M4 重叠语义与插话事务（6 项）

| ID | 功能点 | 实现/更新 | 自动化测试 | 验收方案 |
| --- | --- | --- | --- | --- |
| M4-F1 | 多信号候选器 | 融合本地 VAD、Provider VAD、ASR prefix、播放参考与持续时长 | 回声/键盘/咳嗽/说话 fixture | 扬声器外放下误触率达标 |
| M4-F2 | 意图决策器 | 区分附和、停止、纠正、补充、新问题；规则仅做快速停止词 | 中英文语料、混合语、口头禅、否定句 | 盲测集按意图分别达到门槛 |
| M4-F3 | Interrupt transaction | `interruptId` 串联 duck、local stop、cancel、truncate、ack、outcome | 各步骤延迟/失败/重复/乱序 | 每次插话在诊断中只有一个明确结果 |
| M4-F4 | 可撤销附和 | acknowledgement 不 cancel，恢复音量并保留附和转录策略 | “嗯/对/继续”与长句歧义测试 | 自然附和不中断 AI 主句 |
| M4-F5 | 停止词极速路径 | 明确停止词可在 transcript final 前 commit，但需声纹时长/回声保护 | stop prefix、回声复读、短噪声 | “停/别说了”P95 停声延迟达标 |
| M4-F6 | 手动优先级 | 点击停止/键盘快捷键覆盖自动事务，幂等结束本地与 Provider 输出 | 自动与手动竞态 10,000 次 | 连点不会恢复旧音频或产生双终态 |

### M5 生命周期、重连与会话结束（5 项）

| ID | 功能点 | 实现/更新 | 自动化测试 | 验收方案 |
| --- | --- | --- | --- | --- |
| M5-F1 | 生命周期策略表 | hidden、pagehide、offline、suspend、lock、window close 分别处理 | 浏览器/Windows 生命周期状态表 | 切应用不掉线，关窗必释放麦克风 |
| M5-F2 | 有界重连 | 断线期停止上传旧音频，保留有限新语音提示；新 Provider session 显式分段 | 多断点、重连耗尽、无旧帧重放 | Wi-Fi 闪断后用户知道丢失范围并可继续 |
| M5-F3 | 三种结束动作 | finish turn、end session、cancel session 契约分离 | drain deadline、final transcript、cancel race | “结束”不会吞掉最后一句，“取消”立即停止 |
| M5-F4 | 暂停/继续 | 用户可暂停麦克风而保留会话；暂停时有强视觉提示 | pause/resume、工具在途、超时 | 临时静音不必重新连接 Provider |
| M5-F5 | 资源与电源预算 | 前后台、长会话、重连周期的 CPU/内存/句柄上限 | 1,000 session、60 分钟 soak、heap/handle | 笔记本运行 30 分钟无持续增长和异常耗电 |

### M6 转录、听到范围与 Thread 一致性（6 项）

| ID | 功能点 | 实现/更新 | 自动化测试 | 验收方案 |
| --- | --- | --- | --- | --- |
| M6-F1 | 按 item 的 draft store | 输入/输出按 item/response/content 管理，不跨轮拼接 | 并行 response、乱序 delta、重复 final | HUD 始终只显示当前轮且无串词 |
| M6-F2 | 稳定事件 journal | 只追加本次 revision，序列化写入 Thread，支持失败重试 | CAS 冲突、崩溃恢复、重复写、I/O 失败 | 重启后稳定历史完整且无重复 |
| M6-F3 | heard alignment | 使用 Provider 时间戳或词级对齐；无证据时不生成精确 heard text | 中英语速、停顿、gap、cancel | Thread 展示与用户实际听感一致 |
| M6-F4 | 中断消息模型 | 保存 generated、heard、interruptedAt、alignmentConfidence | schema 迁移和旧消息兼容 | UI 能解释“生成了但未听完”，模型上下文只取 heard |
| M6-F5 | 会话上下文接续 | 新 Realtime session 只注入受限的稳定 Thread 摘要/近期消息 | token/字符预算、敏感字段、长 Thread | 结束重开后能自然续聊且不泄漏隐藏内容 |
| M6-F6 | 删除与隐私一致性 | 删除 Thread/消息时同步移除语音投影；不留旁路 journal | 删除、撤销、崩溃中断测试 | 用户删除后本地搜索与诊断均不可恢复正文 |

### M7 混合文字输入与工具闭环（5 项）

| ID | 功能点 | 实现/更新 | 自动化测试 | 验收方案 |
| --- | --- | --- | --- | --- |
| M7-F1 | 移除假文字队列 | 删除 `queueManualText/drainManualText` 及未消费状态 | 无死引用、构建和旧测试迁移 | UI 不再宣称未实现的排队行为 |
| M7-F2 | 真实文字 item | 活动会话中文字通过 Provider conversation item 发送 | 顺序、重复、离线、大小限制 | 文字可触发实时语音回答并进入同一 Thread |
| M7-F3 | 文字发送策略 | 提供“立即打断并发送/当前回答后发送”，默认后者 | 自动/手动插话竞态、队列取消 | 草稿不丢，用户能预期何时生效 |
| M7-F4 | 正式工具审批 | 复用 Desktop approval UI，显示工具、参数摘要、风险和作用域 | allow/reject/timeout/cancel、重放幂等 | 写工具未经点击绝不执行，审批不靠语音绕过 |
| M7-F5 | 工具 timeline | waiting/running/result/side effect/late result 进入 Thread parts | session detach、晚到结果、敏感结果脱敏 | 用户能追溯工具做了什么及是否已产生副作用 |

### M8 Realtime Voice HUD 与可访问性（5 项）

| ID | 功能点 | 实现/更新 | 自动化测试 | 验收方案 |
| --- | --- | --- | --- | --- |
| M8-F1 | 启动预检面板 | 独立于 error banner，显示 Provider/model/发送/保存/工具权限 | disclosure 版本、记忆、配置变化 | 首次使用清楚，重复使用不反复打扰 |
| M8-F2 | 状态 HUD | 本地化显示正在连接/听/说/回答/插话/恢复/暂停 | reducer→文案快照、ARIA live 节流 | 用户无需看日志即可判断当前状态 |
| M8-F3 | 音量与连接反馈 | 展示输入级别、输出状态、网络质量和重连倒计时 | 指标映射、无障碍 reduced motion | 弱网和静音问题可自行判断 |
| M8-F4 | 错误恢复卡 | reason code 对应主操作、备用操作和 trace ID | 所有错误码覆盖、i18n 完整性 | auth/model/device/network/rate limit 均可自助恢复 |
| M8-F5 | 键盘与读屏 | 开始、暂停、停止、立即打断均有快捷键和可访问名称 | axe、键盘序列、焦点恢复 | 仅键盘和 Narrator 可完成完整会话 |

### M9 配置、质量与可观测性（4 项）

| ID | 功能点 | 实现/更新 | 自动化测试 | 验收方案 |
| --- | --- | --- | --- | --- |
| M9-F1 | Realtime 设置页 | 独立模型、voice、语言、设备、自动恢复、转录保存策略 | 设置往返、并发写、非法值、迁移 | 设置含义与实际 session payload 一致 |
| M9-F2 | 热更新矩阵 | 明确可热更新和需重启字段，更新有 ack/rollback | update 超时、部分拒绝、模型切换 | 会话中改 voice/instruction 结果可解释 |
| M9-F3 | 隐私安全诊断 | 默认仅数字指标和 reason code；显式短期诊断有到期清理 | canary、密钥/正文扫描、TTL | 导出诊断不含密钥、原始音频和完整转录 |
| M9-F4 | SLO 与成本 | TTFA、stop latency、interrupt accuracy、underrun、reconnect、audio seconds | 分位数、缺失值、Provider cost=null | HUD/诊断数值与真实测量抽样一致 |

### M10 测试、发布与删除门禁（3 项）

| ID | 功能点 | 实现/更新 | 自动化测试 | 验收方案 |
| --- | --- | --- | --- | --- |
| M10-F1 | 故障注入总套件 | 网络、Provider、IPC、设备、AudioContext、I/O、审批全矩阵 | 固定种子 + 属性测试 + 10,000 race | CI 可重复，失败能定位到 reason code |
| M10-F2 | 真实发布矩阵 | Serial 零回归、Duplex packaged/live/hardware、无 fixture 冒充 | 报告 schema、哈希、附件和防回退 | Win10/11、内置/USB/蓝牙、弱网和睡眠签核 |
| M10-F3 | Legacy 删除门禁 | Streaming 无 UI/新配置引用；遥测和迁移窗口满足后才删代码 | 架构扫描、旧偏好 fixture、回滚构建 | 一个稳定发布周期后删除不影响历史与 Serial |

## 5. 关键测试策略

### 5.1 自动化层级

1. 纯函数：resampler、VAD 特征、credit、jitter、intent、alignment、reason mapping。
2. 虚拟时钟：播放、插话、drain、重连、暂停、超时。
3. 属性测试：任意乱序/重复/丢失事件下不重复终态、不负水位、不越 credit。
4. Main/Renderer 集成：真实 MessagePort、AudioWorklet fixture、Thread revision journal。
5. Provider contract：GA 事件快照、未知事件、能力降级、真实 probe。
6. Packaged E2E：实际 Electron、麦克风、扬声器、权限和生命周期。

### 5.2 必须建立的量化门槛

门槛在 P2-M0 校准后锁定，至少包括：

- 正常网络首音频 P50/P95；
- 明确停止词到本地静音 P95；
- 普通抢话到 Provider cancel P95；
- 附和误取消率、回声误取消率、抢话漏检率；
- 播放 underrun/minute 与永久 gap 数（必须为 0）；
- 断网恢复成功率及用户可解释的丢失范围；
- 30/60 分钟 CPU、内存、句柄和 AudioContext 稳定性；
- Thread 重复消息、错序 revision 和未对齐 heard text 数（必须为 0）。

### 5.3 验收证据

每个真实验收报告必须包含：构建哈希、协议版本、Provider/model、设备、OS、测试人、时间、步骤、指标、附件哈希和结论。以下证据不得互相替代：

- fixture 证明逻辑确定性；
- live Provider 证明协议与模型行为；
- packaged app 证明真实产品入口；
- hardware matrix 证明 Windows 音频和生命周期；
- 人工盲听证明回声、插话和听感。

## 6. 实施顺序与里程碑

### P2-A：可靠传输（M1～M3）

完成 readiness、模式收敛、上行 credit、下行消费确认、真实播放时间线。退出条件：弱网不会因正常水位取消，序号缺口不会永久卡死。

### P2-B：自然插话与恢复（M4～M5）

完成 duck-first、多信号决策、interrupt transaction、生命周期和三种结束。退出条件：附和不误取消，停止词低延迟，切窗口/短断网不无故结束。

### P2-C：可信历史与混合交互（M6～M7）

完成 revision journal、heard alignment、上下文续接、真实文字 item 和正式工具审批。退出条件：Thread 可作为权威历史，不存在假排队和未审批副作用。

### P2-D：默认体验候选（M8～M10）

完成 HUD、设置、可访问性、SLO、发布矩阵和 Streaming 删除门禁。退出条件：真实用户无需理解技术路线即可完成、恢复和结束会话。

## 7. Definition of Done

P2 只有在以下条件全部成立时完成：

1. 52 个功能点均有实现代码、自动化测试和要求的真实验收证据。
2. P1 审计中的 A-01～A-19 均关闭或有书面豁免及风险负责人。
3. Serial 全套回归通过，旧 Streaming 不再出现在主入口。
4. 三类外部报告通过防 Fixture、防回退和附件完整性校验。
5. 安全扫描确认 Renderer/日志/诊断无长期凭据、原始音频或非必要完整转录。
6. 产品、工程、QA 对量化 SLO、硬件矩阵和隐私文案共同签核。
