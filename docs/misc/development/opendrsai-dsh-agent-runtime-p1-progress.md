# DSH 作为 OAEP Agent Runtime P1 开发进度

> 关联方案：[DSH 作为 OAEP Agent Runtime 的集成方案 P1](./opendrsai-dsh-agent-runtime-integration-p1-plan.md)
> 机器可读台账：[P1 Acceptance Ledger](./opendrsai-dsh-agent-runtime-p1-acceptance-ledger.json)

## 统计规则

- 共 10 个模块、50 个功能点，每个功能点权重相同；
- 只有实现、聚焦自动测试和权威证据齐全的功能点才计入百分比；
- `partial` 不计入完成百分比；
- 模块的全部 5 个功能点 accepted 后，该模块才算 accepted；
- 真实 DSH、打包和跨端证据缺失时，不以 Fake/Unit 测试替代。

## 第 1 轮（2026-08-16）

进度：**26%（13/50 功能点 accepted，0/10 模块 accepted）**。

本轮完成：

1. 新建独立 `opendrsai-dsh-runtime` distribution，不依赖 `drsai`、Runtime Engine、Agent Kernel 或 Codex Adapter；
2. 固定 Runtime Control/OAEP 版本和 schema digest，并建立仓库源漂移测试；
3. 建立严格 JSON-RPC peer，覆盖乱序响应、notification、Server Request、remote error、EOF 和 malformed frame；
4. 建立无 shell 子进程 Supervisor、generation fence、环境 allowlist、stderr 有界脱敏和关闭阶梯；
5. 建立当前 DSH SDK Native Driver，支持 initialize、prompt receipt 和 notification，同时明确拒绝伪造 cancel；
6. 建立 DSH Protocol Profile、版本/contract digest/capability fail-closed 判断；
7. 建立首份 event disposition 清单，未知事件默认 `release_blocked`；
8. 建立无副作用的本地安装发现和机器可读 `status` CLI，Windows 缺少官方 carrier 时诚实返回 remote/WSL 动作。
9. 建立独立 SQLite authority store，覆盖 Session、Run、native Session/message/Turn 强绑定；
10. 建立幂等 Control operation ledger、generation 校验、单 Session 单 active Run 和唯一 terminal 状态机；
11. 验证数据库关闭重开后绑定与冻结 mapping 仍可恢复。

自动验证：

```text
29 passed in 0.42s
```

本轮未完成且不计入进度：

- 当前上游 SDK 仍把 cwd/provider/model 固定为进程级，并缺 Run cancel、Approval、History/Resume 和强 Turn binding，因此 profile 只能 probe，不能显示为可用 Runtime；
- Control state store、OAEP Journal/Projection、Relay、设置 UI、本地智能体目录和真实 DSH E2E 尚未实现；
- wheel 构建工具 `hatchling` 当前虚拟环境未安装，未将源码测试冒充制品验收。

下一轮优先级：

1. 实现 SQLite operation/binding store 和 Runtime Control service；
2. 实现 Fake DSH 的 Run/Turn 强绑定扩展合同；
3. 开始 OAEP Writer、Snapshot/Event Page；
4. 为设置集成定义 generic DSH Runtime status IPC，不侵入 Agent Kernel。

## 第 2 轮（2026-08-16）

进度：**38%（19/50 功能点 accepted，0/10 模块 accepted）**。

本轮完成：

1. 引入与仓库权威 OAEP schema digest 强绑定的独立 validator，schema 漂移或安装包缺失时 fail closed；
2. 实现 append-only OAEP Journal、Session 级连续 sequence、稳定 dedupe 与冲突检测；
3. 实现 Item 当前态原子投影、per-Run Item sequence 唯一约束、terminal 后禁止续写；
4. 实现 OAEP Snapshot、bounded Event Page、live wait、cursor expiration 与 snapshot recovery；
5. 实现 transport-neutral Runtime Control Service 的 initialize、health、shutdown 和精确协议协商；
6. 实现 production/probe-only admission gate，当前官方 rc.5 profile 继续诚实保持 probe-only；
7. 实现幂等 Session create、精确 resume，以及 Run start receipt 的持久化；
8. 实现 exact cancel 调用边界；cancel 响应不会伪造 terminal，Run 仍等待权威 native fact；
9. 实现“请求已发送但回执丢失”的 `outcome_unknown` 冻结，重复请求不会盲重发；
10. 验证 SQLite 关闭重开后的 OAEP projection、snapshot hash 和 replay waterline 等价。

自动验证：

```text
42 passed in 1.78s
```

本轮仍未完成且不计入进度：

- `session.archive` 尚未完成，因此 Session lifecycle 功能点仍为 partial；
- native committed fact mapper、terminal flush、approval server request 与 restart reconciliation 尚未完成；
- 当前官方 rc.5 SDK wire 仍缺少 production 所需的 exact cancel、approval、history/resume 和 Turn terminal 证明；
- Settings、本地 Agent catalog、Relay 注册、真实 DSH E2E 与打包制品验证尚未开始。

下一轮优先级：

1. 实现 native fact semantic mapper、Run/Turn finalizer 与 terminal flush；
2. 实现 approval/interaction authority 和 server-request handler；
3. 完成 Session archive 与 restart reconciliation；
4. 开始独立 carrier/registration 及 Settings/local Agent catalog 接线。

## 第 3 轮（2026-08-16）

进度：**56%（28/50 功能点 accepted，2/10 模块 accepted）**。

本轮完成：

1. 按 rc.5 真实持久事件顺序实现 `messageId → open Turn → committed user/message → Run` 强绑定，不依赖 `idle`；
2. 实现 user/assistant message、text delta、Tool call/result、Session title 和 Run terminal 的确定性 OAEP 映射；
3. 为 native Session source sequence 建立持久 waterline，支持精确 replay、gap 拒绝和 generation fence；
4. 建立 native Item alias binding，允许 `assistant-step` 与 committed message id 指向同一 OAEP Item；
5. 完成 Session archive，active Run 未收敛时拒绝归档；
6. 实现单一 approval answerer、Interaction waiting/completed、Run waiting/resumed 和首答获胜；
7. 实现多个并发审批的最后一个回答后才恢复 Run，shutdown 时 pending approval 收敛为 `unavailable`；
8. 建立完整的 rc.5 known SessionEvent disposition 清单；未实现的用户可见语义明确 `release_blocked`；
9. 实现 restart reconciliation：profile/digest 校验、generation 提升、历史重放和 operation ledger 修复；
10. 验证 history gap、stale generation、外部审批冲突和未知必需事件全部 fail closed。

自动验证：

```text
58 passed in 3.64s
```

本轮仍未完成且不计入进度：

- command/goal/plan/todo/subagent/tool-workflow 等 disposition 仍为 `release_blocked`，因此 mapper 功能点仍为 partial；
- rc.5 SDK 没有 approval server request、exact cancel 和 history/resume 方法，真实 profile 仍只能 probe-only；
- workspace containment 还缺发行载体级沙箱证据，未知副作用恢复还缺真实工具崩溃矩阵；
- Settings、本地 Agent catalog、Relay 注册、真实 DSH E2E 与制品构建仍未完成。

下一轮优先级：

1. 建立独立 carrier、安装状态服务和 generic Runtime registration；
2. 接入 Settings → Integrations 与 local Agent catalog；
3. 完成 side-by-side profile/canary/rollback；
4. 提供可运行的 loopback Control/OAEP transport 与 Fake DSH 产品 E2E。

## 第 4 轮（2026-08-16）

进度：**66%（33/50 功能点 accepted，2/10 模块 accepted）**。

本轮完成：

1. 新增无框架依赖的 loopback HTTP Runtime carrier，覆盖 Control、Session、Run、Approval、OAEP Snapshot/Event Page 和有界 SSE long-poll；所有接口使用独立 Bearer token，且仅允许 loopback 监听。
2. 建立独立 Bridge composition root：启动受管 DSH JSON-RPC 进程、真实 `initialize` 探测、严格 profile 决策、SQLite authority、OAEP projector、approval server-request handler、HTTP carrier 与有界关闭。
3. 建立原子 Runtime registration：manifest 与 token 分文件、权限收紧、协议摘要固定、端点仅 loopback、退出时可恢复清理；probe-only Runtime 会注册诊断信息但不会被产品误标为可用。
4. Desktop 增加通用外部 OAEP Runtime 注册表和客户端；只有 `availability=production` 且 Control/OAEP identity、generation、mapping、capability 与实时探测全部通过的 Runtime 才进入本地 Agent catalog。
5. Desktop 聊天主进程增加 `oaep-runtime` 执行路由，Session/Run 由外部 Runtime 单一持有，Desktop 只消费连续 OAEP sequence，并复用现有 OAEP → Structured Conversation projector。
6. 取消与审批按外部 Runtime 的精确 Run/Approval identity 回送；取消后等待权威 OAEP terminal，不把 HTTP 接受响应伪装成终态。
7. Settings → Integrations 增加 DeepSeek Harness 固定入口，展示“可用”或“未安装或不兼容”；Agent Square 仅在实时兼容性探测通过后显示 DeepSeek Harness。
8. Agent 配置、默认模型判定与卡片操作排除了 DSH 对 OpenDrSai 内核配置的误路由，DSH 保持相对独立的外围集成边界。

自动验证：

```text
71 passed in 3.85s
Desktop node typecheck: passed
Desktop renderer typecheck: passed
DSH external OAEP Runtime registration and client contract: passed
```

本轮仍未完成且不计入进度：

- 当前上游 rc.5 SDK 仍缺 exact cancel、approval、history/resume 与完整 Turn 终态扩展，所以真实 profile 继续是 probe-only；Settings 会诚实显示“未安装或不兼容”，不会出现在本地 Agent 列表。
- Desktop 的断电后外部 Runtime Run 恢复、cursor-expired 后从 Snapshot 重建 UI、跨客户端 TUI/Android/SDK 消费和完整 Fake production journey 仍缺专项 E2E。
- signed carrier 安装、side-by-side profile、candidate canary/rollback、真实 DSH matrix、压力/安全与打包发布证据尚未完成。

下一轮优先级：

1. 建立可发布的 DSH Runtime extension/profile，使 cancel、approval、history/resume 与强 Turn binding 可进入 production，而不是降低门禁。
2. 完成 Fake production native server 的多轮、Tool、Approval、Cancel、断线、重启和 cursor recovery 产品 E2E。
3. 实现 side-by-side profile/carrier 安装、canary、active pointer 和 rollback。
4. 补齐 TUI 与 SDK 通用 OAEP client，随后进行真实 DSH 与打包载体矩阵。

## 第 5 轮（2026-08-16）

进度：**76%（38/50 功能点 accepted，5/10 模块 accepted）**。

本轮完成：

1. 新增权威 Runtime Control v1 JSON Schema，并由该 schema 确定性生成 Python TypedDict DTO；测试会重新生成并逐字节比较，避免手写类型与协议漂移。
2. Control schema 与 OAEP schema 一同进入独立 wheel，运行时协商改为使用真实 Control schema SHA-256，而不是把 protocol-suite 描述文件冒充 command schema。
3. 新增 Ed25519 签名 carrier manifest 验证、受信 key id、artifact size/SHA-256、平台/架构和路径 containment 门禁。
4. carrier 按 release id side-by-side 安装；相同 release 幂等、同名异内容 fail closed，旧 release 不因升级或回滚被删除。
5. candidate 只有在真实 canary callback 返回 accepted evidence 后才能原子切换 active pointer；失败不改变 active，rollback 只交换新 Session 默认指针。
6. 本地 discovery 能解析已激活的托管 carrier，并在不启动第三方进程的情况下复核 artifact digest；随后仍需真实 Runtime initialize 才可能标记 available。
7. 独立 wheel 已真实构建，并验证所有 RECORD digest/size、协议资源、profile、依赖元数据以及禁止导入 OpenDrSai 产品内核。

自动验证：

```text
77 passed in 4.67s（Control DTO 加入后）
76 passed in 4.13s（carrier 矩阵加入后；随后测试总数继续增长）
wheel: opendrsai_dsh_runtime-0.1.0.dev0-py3-none-any.whl
wheel sha256: 5c2131c57801fc21aa83a64b8ba6b96f4aebca335da81fbb323a289fa123eaa5
OAEP schema sha256: 9bc719bc34db0350acbbb4daed2a9a219bbedf52c5fd2055b0eb0d80527b9f69
Control schema sha256: 450d0f1487ef847d4ffe096d3f4972d9f70e2c6094b48832aa583a37b982510f
wheel RECORD/schema/profile/import verification: passed
```

本轮仍未完成且不计入进度：

- 当前可构建的是 Bridge wheel；真实 production DSH carrier/plugin 尚缺上游能力扩展和真实签名发布物，因此 rc.5 仍不会进入 Agent catalog。
- M02 的真实 DSH probe、M05 的剩余用户可见 native event mapper、M06 的发行载体沙箱/未知副作用矩阵仍未完成。
- TUI、SDK/Android、多轮 Fake production journey、真实 DSH、压力、安全和 packaged release 证据仍待完成。

下一轮优先级：

1. 实现 SDK/TUI 通用 OAEP client 与 Fake production Runtime E2E，覆盖多轮、Tool、Approval、Cancel、cursor recovery 和 restart。
2. 将剩余 release-blocked native event 分类为确定映射或明确不支持，完成 mapper 语义闭包。
3. 建立真实 DSH Runtime extension/carrier 的接口与 WSL/Linux 验证路径。
4. 完成安全、压力、真实载体与发布 go/no-go 证据。

## 第 6 轮（2026-08-16）

进度：**84%（42/50 功能点 accepted，6/10 模块 accepted）**。

本轮完成：

1. 新增独立、零产品内核依赖的 Python `OaepRuntimeClient`，覆盖 initialize、health、Session、Run、Cancel、Approval、Snapshot、Event Page、SSE 与 cursor-expired Snapshot recovery；端点只接受 loopback HTTP，所有 OAEP 响应通过固定 schema 校验。
2. TUI 新增显式 opt-in 的 OAEP Runtime Gateway Adapter。默认 Python Gateway 路径不变；设置 `OPENDRSAI_TUI_AGENT_RUNTIME_REGISTRATION` 后，从受约束注册目录读取独立 token、执行生产能力协商，并把 OAEP Message/Tool/Approval/Run terminal 翻译成现有 TUI 事件模型。
3. TUI Runtime 模式的 Session create/resume/archive、prompt submit/cancel、approval respond 均只调用公共 Runtime Control/OAEP，不导入或解析任何 DSH 私有协议字段。
4. 建立真实 loopback HTTP 的 Fake Production 产品旅程：同一 Session 三轮，覆盖流式回答、Tool call/result、Bridge 单审批者、Cancel acknowledgement 与权威 cancel terminal。
5. 产品旅程验证 Event Page 与 SSE 的 event identity/连续 sequence 等价；关闭 carrier 和 SQLite 后重开，Snapshot 完全一致；过期 cursor 自动从 Snapshot waterline 恢复并继续消费新事件。

自动验证：

```text
80 passed in 5.38s
TUI TypeScript type-check: passed
TUI production bundle: passed
TUI OAEP Runtime event translation: passed
```

本轮仍未完成且不计入进度：

- 真实 DSH initialize/protocol probe 和真实 DSH 功能矩阵仍缺可发布的 v2 extension/carrier；当前 rc.5 profile 继续 fail closed 为 probe-only。
- Native event disposition 中仍有 release-blocked 的用户可见事件，M05 mapper 尚未语义闭包。
- carrier 级 Workspace containment 与未知工具副作用恢复矩阵尚未完成。
- 故障/压力、安全/secret scan 和最终 packaged go/no-go 证据尚未完成。

下一轮优先级：

1. 完成 disposition 语义闭包与 Workspace/unknown-side-effect 安全边界；
2. 建立 fault/restart/pressure 与 secret scan 自动验收器；
3. 探测本机 WSL/Linux 上的真实 DSH，并输出机器可读兼容矩阵；
4. 在全部门禁满足后重建 wheel、生成最终 release evidence 与 go/no-go。

## 第 7 轮（2026-08-16）

进度：**100%（50/50 功能点 accepted，10/10 模块 accepted）**。

本轮完成：

1. Native event disposition 完成语义闭包：所有已知 rc.5 事件均被确定映射、明确仅审计忽略，或由 P1 profile 显式禁止；未知事件继续 fail closed。
2. 新增 `WorkspaceBoundary` 与 `SandboxAttestation`，拒绝绝对路径、路径穿越和符号链接逃逸，并把 workspace、carrier digest 与 generation 绑定进可审计的隔离证明。
3. 新增工具副作用账本恢复：重启时对 pending/running/waiting 的未知副作用一律标记 `outcome_unknown` 并隔离，不生成重放命令。
4. 在固定 DSH 源码提交 `47f943859bef60e4160492346772ded9b24f765a` 上构建无工作区链接的真实 Node carrier，并通过真实 stdio JSON-RPC 完成 initialize；观测到 server `deepseek-harness-sdk-runtime/0.0.1`、实际方法/通知与固定协议摘要。
5. 真实矩阵确认 rc.5 当前只满足 `probe_only`：缺少 approval、exact cancel、authoritative terminal/turn binding、history/resume、tool side-effect ledger 和 workspace containment，因此生产部署继续 fail closed。
6. 新增 10,000 OAEP event 压力矩阵，验证有界分页、连续 cursor、关闭数据库后重开及完整 snapshot sequence；本轮实测 7.8784 秒、1269.29 events/s。
7. 新增 wheel/真实 probe 的 secret scan；只输出 finding 类型、位置与不可逆 fingerprint，不回显疑似 secret。本轮扫描通过。
8. 新增最终 release evidence builder，固定 real matrix、wheel verification、security、pressure 与 release report 摘要；交付验收和生产部署授权分开判定。
9. 修复真实 probe 的 PATH executable 解析和 DSH 官方 provider 路由默认值（`deepseek-official`），并完成 Desktop 设置页 Agent source 状态路由的类型收口。
10. 重建独立 wheel 并再次核验 RECORD、协议 schema、profile、依赖边界和 secret scan。

自动验证：

```text
Python: 87 passed, 1 skipped in 11.77s
Skipped: Windows 环境不允许普通用户创建 symlink；绝对路径、路径穿越和 attestation 测试均通过
Desktop Windows/macOS full typecheck: passed
Desktop DSH external OAEP Runtime contract: passed
TUI TypeScript type-check: passed
TUI production bundle: passed
TUI OAEP Runtime event translation: passed
Real DSH initialize/protocol probe: passed
Pressure matrix: 10,000 events, restart durability and bounded paging passed
Wheel sha256: 65f2ec2e7bb4a478fb32e2860f7d64d97e954f0532213b6e59563a3bcb7be02d
Wheel RECORD/schema/profile/import verification: passed
Wheel clean target install/import/profile discovery: passed
Security/secret scan: passed
```

最终判定分为两层：

- **P1 实现与测试交付：ACCEPTED（50/50，100%）**。计划内接口、适配、产品消费、兼容治理、故障/压力/安全测试及发布证据均已完成。
- **将原生 DSH rc.5 作为 production Agent Runtime 部署：NO-GO**。这是实测得到的上游能力结论，不是通过降低门禁换取的“完成”。只有新的 DSH extension/profile 同时提供报告中列出的 8 项能力，并以自包含签名 carrier 重新通过真实矩阵后，部署判定才可变为 GO。

## 第 8 轮（2026-08-16）

进度：**100%（50/50 功能点 accepted，10/10 模块 accepted）**。本轮不增加功能点，只关闭原生 rc.5 与可投产适配之间的最后一段证据链。

本轮完成：

1. 为精确固定的 DSH `v0.1.0-rc.5`/`47f943…` 新增 Cordis 边缘扩展 profile `dsh-sdk/0.1.0-rc.5+opendrsai.1`，在不修改 OpenDrSai Kernel 的前提下补齐 8 项生产门禁能力。
2. 扩展实现强 Turn/Message 绑定、active/queued exact cancel、审批反向 JSON-RPC、session history/resume、工具副作用账本，以及基于实际 `sandboxPolicy.resolve`/`sandbox.confine` 的运行时证明。
3. 新增确定性扩展 staging 和单文件 carrier 资产布局；Bridge 可从 wheel 自动物化 Cordis 配置。未来 DSH 版本通过独立的 profile、extension bundle 与 driver 增量适配，不使用“最近版本”回退。
4. 真实行为矩阵通过：首轮完成、精确取消产生权威 `aborted/user` terminal、17 条历史事件、进程重启后恢复为同一 Session 并继续到 22 条事件和完成 terminal。
5. 真实产品链通过：DSH rc.5 → Cordis 扩展 → Runtime Bridge → 本地 Runtime registration → Desktop Agent catalog → `ExternalOaepRuntimeClient` → OAEP completed terminal；Agent ID 为 `runtime:deepseek-harness`。
6. 当前 Windows DSH 沙箱如实报告 `enforcement=partial`、`contained=false`。P1 因而不暴露不安全的本地 shell，仅启用 workspace 约束的文件工具；Linux/正式 carrier 必须继续以 attestation 决定能力，而不能把“支持证明接口”误写成“已完全隔离”。
7. 使用当前 OAEP schema 摘要 `e207c75c2f37e121dc613aec040c24fd5bd2c6f4f005826c8996a6bb848770b7` 重建并验证独立 wheel；扩展合同摘要为 `70f0f05b1cca8a37f4dedc92150bd78832bee540c4ad7dbbdb3885d77d2d4909`。

最终验证：

```text
Python: 91 passed, 1 skipped in 13.80s
Desktop node typecheck: passed
Desktop DSH external OAEP Runtime contract: passed
TUI TypeScript type-check: passed
TUI production bundle: passed
TUI OAEP Runtime event translation: passed
Real DSH extension strict probe: production-compatible, no missing methods/capabilities/notifications
Real DSH behavior matrix: accepted
Real DSH → Bridge → registration → Desktop product matrix: accepted
Wheel sha256: c3ae78bea93a028e423e543f8cf3d90ff081e988689f35aefa5a39d2a2aaa472
Wheel RECORD/schema/profile/extension/import verification: passed
Wheel clean target install/import/profile discovery: passed
```

判定：

- **P1 功能与真实产品链：ACCEPTED（50/50，100%）**。
- **原生未扩展 DSH rc.5：NO-GO**，继续保留 probe-only profile 作为诚实的兼容性事实。
- **OpenDrSai rc.5 扩展 profile：GO（功能兼容性）**。正式对外分发还必须由发布流水线对自包含 carrier 签名；当前探测载体是 development Node，因此 probe 的 `production_eligible=false` 只描述载体来源，不否定扩展合同的 production compatibility。
