# 全双工实时对话 P3 实施进度

权威规格：[duplex-voice-p3-spec.md](./duplex-voice-p3-spec.md)

权威验收账本：[duplex-voice-p3-acceptance-ledger.json](./duplex-voice-p3-acceptance-ledger.json)

## 计分规则

- 总权重为 100。
- 单个功能点只有在实现、列出的自动化测试和要求的验收证据全部通过后才获得完整权重；部分实现不计分。
- 真人易用性、真人复听、物理硬件和稳定发布证据不能由自动化推断。
- 不得通过删除、跳过、放宽断言或扩大白名单制造通过。

## 第 1 轮

- 已通过权重：0/100。
- 进度：0%。
- 本轮变更：
  - 建立 P3-F1～P3-F10、总权重 100 的机器可读验收账本，并写明全量通过、外部证据和禁止弱化测试的计分规则。
  - 完成十项功能基线审计；确认公开 `streaming` 类型、偏好双真源、ChatWorkspace 巨型 HUD、分散终态和真实媒体测试缺口。
  - P3-F3 开始实施：本地媒体异常改为 `domain/stage/code/retryable/userMessageKey/traceId/technicalDetail` 结构；权限、设备、兼容性、超时、非法调用、资源耗尽分类；UI 恢复动作兼容本地错误；原始 `Illegal invocation` 仅进入技术详情。
  - Chromium 原生媒体方法继续显式绑定 receiver，防止 Web API 非法调用。
- 测试证据：
  - `P3 ledger valid: 10 features, weight=100`。
  - `test:voice:duplex-capture` 通过，新增 `invalid_invocation` 精确分类断言。
  - `test-duplex-voice-ui-model.mjs` 通过。
  - `verify:voice:duplex-ui` 通过。
  - `typecheck:web` 通过。
  - `typecheck:node` 通过。
  - `git diff --check` 通过；仅输出工作区既有 LF/CRLF 警告。
- 未计分原因：P3-F3 仍缺启动阶段、分阶段超时、播放预检顺序和真实 Electron 媒体 smoke；按全量通过规则不得获得部分权重。
- 剩余事项：P3-F1～P3-F10 均未达到完整验收；P3-F3 为进行中。
- 下一轮：完成 P3-F3 的启动阶段与回滚契约，并实现 P3-F5 单一 Session reducer 基础；随后进入 P3-F1 偏好 v11。

## 第 2 轮

- 已通过权重：0/100。
- 进度：0%。
- 本轮变更：
  - 启动事务升级为“准备麦克风 → 准备播放 → 连接 Provider → 激活音频”的显式阶段；UI 展示对应本地化状态。
  - 每个启动阶段具有独立的默认 10 秒超时和可配置测试超时。
  - 播放 AudioContext、输出设备回退和 resume 预检移到 Provider Session 创建前；播放失败不产生远端 Session。
  - 回滚顺序固定为 cancel Provider → release playback → release capture。
  - 新增 `duplexSessionReducer.ts`，定义 Session phase、session owner、首次 terminal、cleanup/history flush 一次性 claim 和非法转换计数。
- 测试证据：
  - `test:voice:duplex-capture` 通过，覆盖启动阶段顺序、播放超时和逆序回滚。
  - `test:voice:duplex-turns` 通过，新增 10,000 次重复/乱序 terminal 与一次性 claim 模型测试。
  - `test-duplex-voice-ui-model.mjs` 通过，覆盖启动阶段本地化投影。
  - `verify:voice:duplex-ui` 通过。
  - `typecheck:web`、`typecheck:node` 通过。
- 未计分原因：P3-F3 尚缺真实 Electron media smoke；P3-F5 reducer 尚未接管 Hook，旧 terminal refs 仍存在。按整项通过规则均不计权重。
- 剩余事项：P3-F3、P3-F5 进行中；其余八项待实施。
- 下一轮：让 Session reducer 正式接管 Hook 的 phase、terminal 和 cleanup 所有权，移除 `terminalizingSessionRef`/`phaseRef` 的决策职责；随后实施偏好 v11。

## 第 3 轮

- 已通过权重：14/100。
- 进度：14%。
- 本轮通过：P3-F5（单一会话状态机，权重 14）。
- 本轮变更：
  - `useDuplexVoiceInput` 的 phase 与 startupStage 改由 `duplexSessionReducer` 派生。
  - Session ID 所有权、首次 terminal、结束请求、恢复、启动失败、cleanup 和 history flush 全部通过 reducer 事件。
  - 删除 `terminalizingSessionRef` 和 `phaseRef`；资源 ref 仅保留对象句柄，不再决定业务状态。
  - completed/cancelled/failed 乱序到达时只有首个终态获得处理权；历史写入和媒体释放各自最多 claim 一次。
  - UI 静态门禁新增“必须使用 session reducer、不得恢复旧终态 ref”的断言。
- 测试证据：
  - `test:voice:duplex-turns` 通过：10,000 次重复终态与 claim 竞态。
  - `test:voice:duplex-runtime` 通过：Registry、生命周期、边界、隔离、10,000 次唯一终态和 cleanup。
  - `test-duplex-voice-fault-properties.mjs` 通过：固定 seed、10,000 个生成故障案例。
  - `test:voice:duplex-recovery`、`test:voice:duplex-history`、`test:voice:duplex-tools` 通过。
  - `verify:voice:duplex-ui`、`typecheck:web` 通过。
- 基线异常：`typecheck:node` 被工作区中本轮未修改的 `shared/main/threadRuntimeProjection.ts` 联合类型错误阻断；上一轮该检查通过。该文件显示为已有修改，本轮未覆盖用户改动。此问题与 P3-F5 不相关，但必须在最终完整回归前消除。
- 剩余事项：P3-F3 进行中；P3-F1/F2/F4/F6/F7/F8/F9/F10 待完成。
- 下一轮：实施 P3-F1 偏好 v11 单一真源和迁移测试；随后抽离/精简 HUD，为 Streaming 删除建立类型和引用门禁。
