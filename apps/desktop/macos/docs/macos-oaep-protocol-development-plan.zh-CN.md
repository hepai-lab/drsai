# OpenDrSai macOS OAEP 协议阶段完整开发方案

## 1. 目标与完成定义

macOS Desktop 与 Windows Desktop 使用同一条 `Desktop API → shared chat/runtime client → OAEP Session Stream → shared projector → renderer` 回复链。协议阶段完成不以“窗口能显示文字”为标准，而以以下结果同时成立为标准：

1. Runtime 能力协商只接受完整的 OAEP v1.0 + `oaep.session-stream/1`，部分声明立即失败；旧协议仅用于显式回滚。
2. 新建会话、实时回复、历史恢复、取消、交互输入、断线重连都使用同一 Session/Run/Item/Event 身份模型。
3. 最终回答、进度、公开 reasoning summary、工具、文件、产物、交互和子任务均由 OAEP 投影，UI 不识别 Backend 私有事件。
4. 同一 Session 只有一个共享 SSE owner；事件严格单调、去重、可续传，cursor 失效后使用权威 snapshot 恢复。
5. 开发态、打包态和升级态均有 macOS 独立证据；Windows 通过不能替代 macOS 验收。

## 2. 当前基线与差距

- `shared/main/chat.ts` 已负责 Run 创建、OAEP 订阅、取消和 renderer 事件；macOS `registerExecutionIpc.ts` 已接入 `startChat/cancelChatTurn/recoverChatRun/respondChatInput`。
- `runtimeProtocolSelection.ts` 已锁定 OAEP 版本、profile、schema hash 和必需 capability。
- `oaepSessionStream.ts`、`oaepPresentationProjector.ts`、`threadRuntimeProjection.ts` 已提供实时与历史共用的 reducer/projector。
- macOS packaged smoke 已覆盖取消和断线续传，但尚需增加真实 OAEP final response、十类 Item、七类 Delta、交互恢复和升级/回滚矩阵。
- OAEP 核心测试过去只登记在 Windows package；macOS 现增加 `verify:oaep-protocol` 独立门禁。

## 3. 分阶段开发工作包

### P0：协议冻结与生成物一致性

- 冻结 OAEP v1.0、profile、schema SHA-256、capability 集与错误码。
- CI 执行 OAEP 类型生成器 `--check`，校验 TypeScript、Python、Kotlin 常量一致。
- 禁止 Desktop 手写第二套 Item/Event 类型；schema 变化必须先改协议源，再更新生成物与 fixtures。

验收：schema hash、版本、profile 和五个必需 capability 在 Runtime 与 Desktop 完全一致；任一缺失产生 `oaep_capability_partial`。

### P1：macOS Runtime/Gateway 握手

- Gateway ready 后读取 `/v1/capabilities`，记录 runtimeId、instanceId、generation、protocol selection。
- 登录身份同步、Gateway 启动和 Chat 启动共用协调锁，避免启动期间互相等待或使用旧 user ID。
- Runtime instance/generation 改变时，使旧 client、SSE owner、Thread hydration 立即失效并重新绑定。
- 提供仅含结构元数据的诊断事件，不记录 prompt、回复、命令输出或凭据。

验收：冷启动、并发启动、Gateway 崩溃重启、sleep/wake 后都能重新协商；旧 generation 不得继续写 UI。

### P2：发送与 Run 绑定

- `startChat` 先建立 Session 订阅，再创建权威 Run；Run 持久化后才向 renderer 发布 start。
- requestId、threadId、sessionId、runId、workspaceId 全链一致，取消请求在 Run 尚未绑定时也必须被记住并最终下发。
- 附件通过 `oaep.input/1` resource 传递，路径先经过 workspace trust/path policy，Backend 私有编码留在 adapter。
- `respondChatInput` 只回应当前 waiting interaction，过期、跨 Session 或 terminal 后输入必须拒绝。

验收：快速取消、重复发送、重复输入、跨工作区附件、Runtime 创建 Run 失败均有确定终态且不产生幽灵气泡。

### P3：Session Stream 可靠性

- 每个 endpoint + Session 仅保留一个 SSE owner，多 UI consumer 共享 snapshot、replay 和 stream。
- 建立 `snapshot → replay closing race → stream` 顺序；按 Session sequence 去重并检测 gap。
- 临时网络错误执行有界指数退避；cursor 过期进行 resnapshot；协议错误、身份错误和连续失败进入显式 degraded/fatal。
- renderer reload 只更换 subscriber；App/Runtime restart 从持久 journal 与 OAEP snapshot 恢复。

验收：断线重连无重复字符、无丢 Item、sequence 单调；listener 异常隔离；取消后不得自动复活。

### P4：投影与回复 UI

- 覆盖 message、reasoning、plan、command_execution、file_change、tool_call、artifact、interaction、subtask、notice 十类 Item。
- 覆盖 message/reasoning/plan/command/tool/subtask 的七类增量；未知类型只生成脱敏 protocol issue。
- 只有 `message.phase=final` 进入最终回答；hidden reasoning 永不进入 renderer。
- 实时事件和历史 snapshot 使用相同 reducer/projector，并用 golden fixtures 逐字段比对。

验收：真实完整回复可见；失败与取消有明确 UI 终态；历史重开与实时结束后的结构完全一致。

### P5：macOS 生命周期和打包态

- 在 Apple Silicon 打包 App 中验证 Runtime 安装、Gateway 启动、OAEP handshake、首 token、final response 和历史重开。
- 覆盖关闭窗口后 Dock 重建、renderer crash、Gateway SIGKILL、sleep/wake、离线/上线和 App 强退恢复。
- 签名包内 Runtime、协议 schema/fixtures 和 Desktop 生成物必须来自同一构建元数据。

验收：连续 100 轮回复/重开无残留 SSE owner、无孤儿 Gateway/PTY、无 sequence 回退，资源增长满足既有 L5 预算。

### P6：升级、回滚与发布

- 升级矩阵：旧 Desktop/新 Runtime、新 Desktop/旧 Runtime、新/新、OAEP capability 部分声明、schema hash 不一致。
- 默认策略为 OAEP；legacy 仅允许运维显式开关，并在 UI/诊断展示 `operator_rollback` 与升级动作。
- 正式版门禁包含 notarization、从上一正式版在线升级、会话数据迁移、失败回滚和升级后首次回复。

验收：不兼容组合 fail closed 并给出可操作提示；回滚不损坏 Thread/Session 数据；升级后实时与历史投影一致。

## 4. 测试矩阵与命令

| 层级 | 必测内容 | 门禁 |
|---|---|---|
| L1 类型/静态 | API、schema hash、capability、平台接线 | `npm run typecheck` |
| L2 协议单元 | reducer、十类 Item、七类 Delta、隐私过滤 | `npm run verify:oaep-protocol` |
| L3 集成 | Runtime contract、Session subscription、取消/输入/恢复 | `npm run verify:contract`；补建 macOS 专属 subscription composition test |
| L4 本机 | 开发 App + 真实 Gateway + 真实模型回复 | 新增 `verify:oaep-macos-live` |
| L5 打包 | arm64 App、崩溃/网络/睡眠/100 轮稳定性 | `npm run verify:packaged:l5` |
| L6 发布 | 签名、公证、在线升级、回滚、上一版本迁移 | `npm run verify:release:l6-auto` |

L4 live runner 必须输出脱敏 JSON evidence：构建版本、Runtime identity、协议版本/hash、Session/Run ID、事件计数、首/末 sequence、重连次数、终态和历史一致性 hash；不得保存对话正文或密钥。

## 5. 任务顺序与里程碑

1. M1（协议门禁）：P0 + P1，macOS `verify:oaep-protocol` 和 typecheck 通过。
2. M2（可回复）：P2 + P4，真实 macOS 开发态收到 OAEP final response，并可重开历史。
3. M3（可恢复）：P3，取消、输入、断网、Gateway/renderer 重启矩阵通过。
4. M4（可交付）：P5，打包 arm64 L5 与 100 轮稳定性通过。
5. M5（可发布）：P6，签名、公证、在线升级与回滚 L6 通过。

任何里程碑只有自动化结果和对应 macOS evidence 同时存在才可标记完成；字符串扫描、Windows 证据或 mock 成功只能作为 L1/L2 证据。

## 6. 发布阻断条件

- OAEP capability 部分声明或 schema hash 不一致仍被接受。
- final response 依赖 legacy chunk 才能显示，或历史与实时使用不同 projector。
- hidden reasoning、prompt、工具输出、路径或凭据进入诊断包。
- 断线、取消或 Runtime generation 切换后出现重复回复、幽灵运行或跨 Session 事件。
- 打包 App 未完成真实模型回复、升级后首次回复或资源稳定性验证。
