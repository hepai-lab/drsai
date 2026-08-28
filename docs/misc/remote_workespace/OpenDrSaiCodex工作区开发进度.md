# OpenDrSai Codex 工作区开发进度

> 基准方案：[OpenDrSai Codex 工作区开发方案 V1](./OpenDrSaiCodex工作区开发方案V1.md)  
> 统计规则：只有同时具备实现、自动化测试和方案中指定验收证据的功能点才记为完成。

## 总体状态

| 指标 | 当前值 |
| --- | ---: |
| 功能点总数 | 96 |
| 已完成 | 96 |
| 进行中 | 0 |
| 未开始 | 0 |
| 完成率 | 100% |

当前阶段：`L5 发布交付`已完成。C01-C12 全部关闭；Windows 本地 Codex Workspace V1 的 96 个功能点均已具备实现、测试和验收证据。

## 模块进度

| 模块 | 名称 | 完成/总数 | 状态 | 当前证据或下一门禁 |
| --- | --- | ---: | --- | --- |
| C01 | 统一架构、命名与领域模型 | 8/8 | 已完成 | 术语、统一 Workspace、共置、版本、Binding、路径和依赖边界门禁全部通过 |
| C02 | Agent Backend 契约与路由 | 8/8 | 已完成 | 真实 Windows Codex 进程死亡且 OpenDrSai fallback 调用为零 |
| C03 | Windows Local Full Agent Runtime | 8/8 | 已完成 | 10 Workspace 的 Session/Event/Watch/ConPTY/Codex Thread 联合隔离通过 |
| C04 | OWOP 核心协议与 Schema | 8/8 | 已完成 | 单一 Schema、强类型 operation、Event/cursor 与 Python/TypeScript 零漂移门禁通过 |
| C05 | OWOP Local Binding 与工作区能力 | 8/8 | 已完成 | Windows Process、真实 ConPTY、有限缓冲、游标、resize/attach/kill 与进程树清理全部通过 |
| C06 | Codex 制品、版本与进程生命周期 | 8/8 | 已完成 | 受管制品、Windows 启动、共享单实例、退避熔断、资源清理与真实 App Server 烟测通过 |
| C07 | Codex JSON-RPC 与兼容性 | 8/8 | 已完成 | 稳定 JSONL、并发路由、Server Request、generation、model/list 与真实协议烟测通过 |
| C08 | Session/Run 到 Thread/Turn 映射 | 8/8 | 已完成 | 正式 Runtime 流程、持久化 Binding、幂等故障和 20 Session 隔离通过 |
| C09 | Event 映射、持久化与恢复 | 8/8 | 已完成 | Event Mapper、去重、截断、断线/重启恢复与确定性收敛通过 |
| C10 | 认证、权限、审批、取消与审计 | 8/8 | 已完成 | Runtime 账户 API、权限/审批顺序、取消恢复、审计脱敏通过 |
| C11 | Desktop 集成与迁移 | 8/8 | 已完成 | 两类 Workspace 入口、Backend 选择、状态/登录、统一 UI 投影、迁移与边界通过 |
| C12 | 测试、打包、发布与远程就绪 | 8/8 | 已完成 | 本机隔离安装使用打包 Runtime/受管 Codex，真实 Run、连续审批、取消和重启恢复全部通过 |

## 已完成功能点

| ID | 完成证据 |
| --- | --- |
| C01-F04 | `RuntimeRunContext` 显式保存 `agent_backend_runtime_id` 与 `workspace_runtime_id`；不相等时返回 `distributed_backend_not_supported`；聚焦测试通过 |
| C01-F05 | Agent Definition 必须使用精确版本，拒绝 `latest`、缺失版本、未知 Backend 和身份篡改；生产默认 Backend 白名单为 `opendrsai|codex`；固定版本回放测试通过 |
| C01-F06 | 新增 SQLite Session/Run Binding、共置约束、唯一约束和不可变触发器；重启往返、幂等、跨 Workspace 冲突及 Windows 文件句柄清理测试通过 |
| C01-F03 | Python/TypeScript 使用同一 Local/Remote Workspace Target 形状；Local 强制 `in-process` 且无 SSH metadata，Remote 强制 `transport=ssh` 与 host alias；JSON 往返及非法 Fixture 通过 |
| C01-F02 | OpenDrSai/Codex 使用完全相同的 Workspace Domain；执行差异只存在于独立 `agentBackend` metadata；Python 与 TypeScript 对称 Fixture 通过 |
| C01-F01 | 产品代码统一为 Full Agent Runtime、Agent Backend、Codex Agent Backend、Codex Adapter、Codex App Server 和 OWOP；新增代码/Schema/UI/文档术语扫描门禁并通过 |
| C01-F07 | `workspace_paths.py` 统一识别 Windows drive/UNC、POSIX absolute 和混合分隔符；Runtime 业务 cwd 已接入 Registry 根下相对路径解析，绝对路径与 traversal Fixture 均被拒绝 |
| C01-F08 | 新增依赖边界门禁：Desktop/Gateway 不得直接使用 Codex JSON-RPC，Codex Adapter 不得依赖 Desktop/Renderer，Workspace 服务不得依赖 Desktop；扫描通过 |
| C02-F01 | 统一异步契约正式命名为 `AgentBackend`；OpenDrSaiAgentBackend、CodexAdapter 和 TestBackend 编译/反射合规测试通过 |
| C02-F02 | 六方法 `execute/cancel/respond_approval/recover/health/close` 已实现；委派、错误、非法审批和关闭幂等测试通过 |
| C02-F03 | `AgentBackendRouter` 按精确 Backend 路由；同 Workspace 的 OpenDrSai/Codex Run 分别到达对应实现且 Workspace identity 不变 |
| C02-F05 | Gateway 使用进程级 RuntimeAgentService；20 个并发 Codex Run 共享一个 Adapter/Client，Runtime shutdown/重复 close 只关闭一次 |
| C02-F06 | Runtime Run 持久化不可变 backend_id/runtime_id/workspace_id/agent_definition；SQLite trigger、幂等冲突和重启恢复测试通过 |
| C02-F07 | `/v1/capabilities` 暴露 Agent Backend health；可用、未配置、版本不兼容、未登录四类 Fixture 及真实 Gateway 响应通过；字段对旧 TS Client 可选 |
| C02-F08 | OpenDrSai Backend Python 回归通过；独立 Docker Full Agent Runtime 的 Gateway、Session/Run/Event、Tool/Skill/MCP/Subagent、防伪与越界真实验证通过 |
| C03-F01 | Desktop 从无 Runtime 状态启动 Windows Local Full Agent Runtime；20 个并发/重复连接只产生一个 PID 与 instance_id，真实握手通过 |
| C03-F02 | `LocalRuntimeClient` 与 `RemoteRuntimeClient` 实现相同 RuntimeClient；同一 Workspace/Session/Run/Files/Git 契约套件及错误协议测试通过 |
| C03-F03 | `runtime_id` 跨 Desktop/Runtime 重启保持稳定，`instance_id` 每次进程启动旋转；新状态目录生成新 runtime_id |
| C03-F04 | Desktop 本地 Workspace 创建改为调用 Runtime Registry，不再生成权威 UUID；drive/UNC/junction/不存在/无权限路径与持久化 ID 测试通过 |
| C03-F06 | Desktop 模块重载和 Runtime 重启后恢复相同 Workspace/Session/Run ID、终态与完整 Event 历史 |
| C03-F07 | 强制终止 Windows Runtime 进程后 Desktop 检测退出、重新启动、获得新 instance_id，并恢复 Registry；旧进程状态不复用 |
| C03-F08 | 默认 managed 策略关闭 Runtime 且 PID/ready 状态清空；external 策略保留 Runtime 且 Desktop 不终止其进程；启动超时自等待死锁已修复 |
| C04-F01 | 定义 OWOP 1.0、九类 capability、六种 Binding；JSON Schema 与版本/capability 协商测试通过 |
| C04-F02 | Request/Success/Failure/Error 统一信封；错误固定包含 code/message/correlation_id/retryable/details，未知 operation 标准化返回 |
| C04-F03 | Workspace/Files/Search/Watch 强类型 operation 全量 Fixture 通过，所有 operation 禁止额外 arbitrary_json 字段 |
| C04-F04 | Git status/diff/file-at-ref/stage/unstage/revert/commit 强类型 Schema 通过 |
| C04-F05 | Process/PTY start/write/attach/resize/kill 强类型 Schema 通过；argv 必须为非空数组，shell 字符串被拒绝 |
| C04-F06 | Workspace Checkpoint 与 Artifact metadata/chunk 强类型 Schema 往返通过 |
| C04-F07 | Workspace Event sequence/resource_sequence/cursor/dedupe；乱序、重复、缺口、续传、跨 Workspace 和 unknown Event 测试通过 |
| C04-F08 | 从同一 `owop.schema.json` 生成 Python/TypeScript 类型；Schema SHA-256、零漂移和破坏 Schema 的负向门禁通过，Schema 纳入 Wheel |
| C05-F01 | InProcess 与认证 length-framed loopback Local IPC Binding 对全部 31 个 operation 运行同一套件，成功和错误逐字段一致 |
| C05-F02 | 相对路径根边界、drive/UNC/traversal、Windows junction、symlink、大小写前缀和提交前竞态替换攻击均被拒绝 |
| C05-F03 | 文件树分页、忽略目录、文本/二进制搜索预览、真实 100,000 文件首屏和 10 MB 分块重组/摘要通过 |
| C05-F04 | 同目录临时文件+fsync+os.replace 原子写；stale digest 返回 `owop_conflict`，原文件完整且无临时残留 |
| C05-F05 | SQLite Watch journal 支持批量事件、limit 限流、dedupe、持久化 after_sequence 续传和跨 Workspace 隔离 |
| C05-F06 | 真实 Git 仓库覆盖 status/diff/file-at-ref/stage/unstage/revert/commit、stale diff hash 和 pre-commit Hook 失败 |
| C05-F08 | Workspace Checkpoint 覆盖修改/新增/删除/大文件跳过、preview digest、stale restore、restore/accept；ID/Schema/存储与 Runtime Checkpoint 隔离 |
| C05-F07 | Runtime 托管 Process 与 `node-pty/ConPTY` Provider；真实 Windows 验证 argv/cwd、stdin、stdout/stderr、超时、有限缓冲、游标续读、resize/attach/kill，并用 Job Object 证明整棵进程树清理 |
| C06-F01 | `CodexBinaryProvider` 产品模式只解析受管制品并忽略 PATH/CODEX_BIN；开发模式允许 CODEX_BIN，但明确标记 `release_safe=false` 且不能通过发布兼容门禁 |
| C06-F02 | Ed25519 发布者信任链覆盖 manifest、binary/schema SHA-256；正确签名安装，未知发布者、错误签名、篡改 binary/schema 和错误平台均被拒绝 |
| C06-F03 | 制品按版本进入不可变目录，current/previous 使用同卷临时文件+fsync+os.replace 原子切换；切换前故障保持旧 current，两个版本互不覆盖 |
| C06-F04 | Backend 启动兼容门禁同时核验真实 `--version`、manifest version 和已安装 App Server Schema digest；开发 override、版本漂移和 Schema 漂移均拒绝 |
| C06-F05 | Windows Supervisor 覆盖 npm/cmd wrapper、WindowsApps alias 可操作错误和签名受管 exe；本机真实 `codex-cli 0.142.5 app-server` 启动并完成 Turn |
| C06-F06 | Runtime 级 Supervisor/JSONL Client 在 50 并发连接及 10 Workspace/Thread 路由中只启动一个进程，交错通知不串线 |
| C06-F07 | 启动失败、立即退出、受控重启、指数退避、最大失败窗口和熔断测试通过；连续失败不形成重启风暴 |
| C06-F08 | Windows Job Object 清理 App Server 进程树；stderr 有界并脱敏 Token/Cookie/API key；关闭清理 reader/wait task、pipe 和临时文件 |
| C07-F01 | 正式 Client 每 connection 只执行一次 initialize→initialized，clientInfo 为 OpenDrSai；初始化前和重复 initialize 均拒绝 |
| C07-F02 | JSONL reader 支持分片/合并行、ID Future、100 并发乱序响应、重复/未知响应安全忽略及无效 JSON 失败收敛 |
| C07-F03 | Notification 按 threadId/turnId 路由；10 Thread 逆序 completed 仍分别进入唯一订阅者，未知通知只保留无敏感字段摘要 |
| C07-F04 | Server Request 支持异步 handler；已知请求返回 result，未知请求返回 -32601，handler 异常也保证最终 response |
| C07-F05 | 单请求 timeout 不影响其他请求；EOF 失败全部 Future；重连旋转 generation，旧 generation 消息被丢弃且新连接正常 |
| C07-F06 | initialize 不发送 experimentalApi；服务端声明 experimentalApi 时生产 Client 立即拒绝；仅使用官方稳定方法 |
| C07-F07 | 使用稳定 `model/list(includeHidden=true)` 建立能力目录；显式 `gpt-5.4` 成功，`gpt-5.6-sol` 在旧 CLI Fixture 返回可操作 incompatibility，绝不静默换模型 |
| C07-F08 | 真实 Windows App Server 自动完成 initialize→thread/start→turn/start→message delta→turn/completed，保存 Thread/Turn/Notification 结构化输出 |
| C02-F04 | 杀死本机真实 Codex App Server 后 Runtime Run 确定性失败；`opendrsai_fallback_calls=0`，无隐式切换 |
| C03-F05 | 10 Workspace 联合运行 Session、Runtime Event、OWOP Watch、真实 ConPTY 与 Codex Thread/Turn，所有 identity、输出和事件互不串线 |
| C08-F01 | Runtime Session 与 Codex Thread、Runtime Run 与 Codex Turn 分层映射并持久化，Runtime ID 与 Backend ID 均不可混用 |
| C08-F02 | `thread/start` 只使用 Runtime 权威 Workspace cwd，模型/指令/审批/沙箱配置确定性映射，未知配置 fail closed |
| C08-F03 | `turn/start` 使用固定 Thread、文本输入、模型和 reasoning effort，结果回写 backend metadata |
| C08-F04 | Session/Run Binding operation 记录 pending/requesting/response_received/unknown/bound，覆盖请求前后存储故障与响应丢失 |
| C08-F05 | 同 Session 跨 App Server generation 使用 `thread/resume`；恢复后 Thread identity 不变 |
| C08-F06 | 10 Workspace、20 Session 并发映射得到唯一 Thread/Turn，Workspace 与 Session 无交叉 |
| C08-F07 | Codex completed/failed/interrupted 分别映射 Runtime completed/failed/cancelled，并保留终态时间和 metadata |
| C08-F08 | 正式 `RuntimeAgentService` 端到端通过 Codex Adapter 执行，不存在旁路或 OpenDrSai fallback |
| C09-F01 | Codex Turn、Item、delta 和未知通知统一映射为 Runtime Event，Runtime sequence 为唯一权威顺序 |
| C09-F02 | command/file/tool/reasoning/message Item 映射完整；未知 Item 仅保存脱敏摘要 |
| C09-F03 | 大 delta 按阈值批处理，单 Event 有界；64KB 上限与明确 truncation marker 已实现 |
| C09-F04 | backend event key 唯一索引保证重放、重叠页和重复终态不重复落库 |
| C09-F05 | Event 在订阅者存在与否时均先持久化，断线后按 Runtime sequence 续传 |
| C09-F06 | 重启后使用 `thread/read(includeTurns=true)` 恢复，completed/failed/interrupted 确定性收敛 |
| C09-F07 | Backend in-progress 或 Turn 缺失按 `backend_interrupted` fail closed，无永久 running |
| C09-F08 | 10 Workspace 联合 Event/Watch/PTY/Codex 测试验证每条事件只归属其 Run 与 Workspace |
| C10-F01 | `account/read` 映射未登录、ChatGPT、API key、过期与刷新失败；状态响应不含原始凭据 |
| C10-F02 | Desktop `RuntimeClient` 通过统一 Runtime API 发起浏览器/设备码登录、取消和登出；Local/Remote 同契约集成测试通过 |
| C10-F03 | owner/editor/viewer/denied 全权限矩阵以及 Codex command/file permission 集合测试通过，无权限不产生审批 |
| C10-F04 | 官方稳定 Command/File/Permissions Server Request 接入 Approval Bridge；同意、拒绝、超时和 session scope 恰好响应一次 |
| C10-F05 | Codex Approval Bridge 固定先检查 Runtime permission；拒绝路径 `approval_created=false` |
| C10-F06 | cancel_requested 先持久化，再发 `turn/interrupt`；running/waiting/terminal/连接丢失及重复 cancel 幂等通过 |
| C10-F07 | 重启时孤儿 Approval fail-closed timeout；cancel_requested 恢复先 interrupt 再 thread/read，无永久等待或重复响应 |
| C10-F08 | 审计关联 principal/runtime/workspace/session/run/backend/turn/operation/correlation；Token/API key canary 零泄漏 |
| C11-F01 | “添加工作区”仍只有本地/远程两个入口；源码/可访问性标记检查无 Codex Workspace 第三类型 |
| C11-F02 | `WorkspaceExecutionTarget` 将 Workspace Domain 与 Agent Backend metadata 分离；同一 Workspace ID 切换 OpenDrSai/Codex 仅改变 Backend |
| C11-F03 | Desktop 状态面板通过 Runtime capability 展示 available/not_installed/version_incompatible/not_logged_in/fault 五态及修复动作 |
| C11-F04 | `my-codex` 通过正式 Runtime Session/Run/Event 接入现有 Chat，delta、Item、文件变化和终态投影为既有 Chat/AgentRun 类型 |
| C11-F05 | Codex 审批投影为现有 shell/workspace Approval Center 数据，包含 Workspace、Run、operation、reason、risk 并回传正式 Run |
| C11-F06 | 既有取消/错误 UI 复用正式 Runtime cancel；未登录、版本不兼容、Backend 崩溃有动作，unknown operation 明确禁止复用旧 key |
| C11-F07 | 旧 Workspace 备份/迁移保留 legacy ID 与 createdAt；旧 OpenDrSai 数据不改写，选择 Codex 时只新增持久化 Binding |
| C11-F08 | Desktop RuntimeClient 仅调用 Runtime HTTP；依赖扫描确认 Desktop/Main/Renderer 不含 Codex JSON-RPC、进程启动或凭据逻辑 |
| C12-F01 | Codex/Agent Backend/OWOP/Runtime 聚焦回归 115 passed、71 subtests passed、2 个预期平台 skip；Desktop node/web typecheck 全通过 |
| C12-F02 | `generate-owop-types.py --check` 与 `verify-codex-adapter-schema.py` 均通过，OWOP 和稳定 App Server 契约零漂移 |
| C12-F03 | Fake App Server 覆盖乱序、未知消息、审批、EOF、超时、崩溃、stderr 与受控重连；全部 Future 和进程可收敛 |
| C12-F04 | 本机 Windows `codex-cli 0.142.5 app-server` 真实完成 initialize、Thread、Turn、流式消息和 completed，模型为 `gpt-5.4` |
| C12-F05 | OWOP Local 合规测试及 10 Workspace 的 Session/Event/Watch/ConPTY/Codex Thread 联合隔离通过 |
| C12-F06 | 最新 Runtime ZIP 安装到全新 InstallRoot/DRSAI_HOME/Workspace；使用安装产物内置 Python Gateway 和受管 Codex 0.142.5，经正式 Runtime Protocol 完成 completion、连续审批、取消与重启恢复，终态为 completed/completed/cancelled，重启后 Event 数为 20/36/26；证据见 `apps/desktop/windows/release/product-evidence/codex-local-product/codex-local-product-final.json` |
| C12-F07 | 10,000 Event 重放去重、1M 字符长 delta 截断、Secret canary、100/100 受控重连和进程清理通过 |
| C12-F08 | Windows cmd/exe 与 Fake Linux direct launcher 通过同一 Binary/Path/Workspace Target 契约；领域 Schema 无平台实现泄漏 |

## 未完成证据

- 无。Windows Sandbox 已按方案变更移出强制验收门禁；相关脚本仅作为可选诊断工具保留。验收制品使用 `acceptance_only=true` 临时签名验证安装与信任链机制，beta/stable 安装器仍会拒绝它，正式公开发布必须由 CI 注入发布私钥。

## 最近一次验证

```text
Python C08-C10 focused Backend/Runtime/Security: 41 passed, 1 Linux-only skip, 7 subtests passed
Python OWOP protocol/bindings/files/git/checkpoint/process/ConPTY: 18 passed, 36 subtests passed；100,000-file slow fixture 单独通过
Python Codex managed artifact/binary provider: 4 passed
Python Codex artifact/factory/supervisor/JSON-RPC/security/runtime final regression: 40 passed, 12 subtests passed
Python Codex App Server supervisor: 5 passed
Python Codex JSONL/model capability: 8 passed
Python C12 focused gate: 115 passed, 2 expected platform skips, 71 subtests passed
Python Codex stress: 10,000 events, 1M-char delta, secret canary and 100/100 reconnect passed
TypeScript/Node: workspace-domain passed
TypeScript/Node: workspace-location-roundtrip passed
TypeScript/Node: codex-architecture-terminology passed
TypeScript/Node: codex-dependency-boundaries passed
TypeScript/Node: Windows Local Runtime lifecycle passed
TypeScript/Node: Local/Remote RuntimeClient shared contract passed
TypeScript/Node: Backend account Local/Remote RuntimeClient integration passed
TypeScript/Node: Codex Desktop 五态、统一 Chat/Event、Approval、Cancel/Retry 产品集成通过
TypeScript/Node: node/web typecheck、OWOP drift、Codex stable schema drift 全通过
Python compile: agent_runtime.py, agent_backend_bindings.py, gateway.py passed
Codex Windows CLI/App Server spike: previously passed with codex-cli 0.142.5 and gpt-5.4
Docker Full Agent Runtime: passed on isolated Linux container
```

`verify:agent-runtime-real` 已改用不依赖 SSH Fixture 的专用 Runtime 镜像，消除了无关 `known_hosts_fixture` ACL 耦合并通过。

说明：路径套件中真实 symlink 越界用例因当前 Windows 主机不允许创建 symlink 而跳过；等价的 Windows junction/reparse-point、相对路径、drive、UNC、POSIX absolute、混合分隔符和 traversal Fixture 均已通过。

## 变更记录

- 2026-07-16：建立 96 项严格验收账本；完成 C01-F03/F04/F05/F06；启动 Agent Backend 异步契约和 Gateway 生命周期迁移。
- 2026-07-16：C01 达到 8/8；C02 达到 7/8，剩余真实 Codex App Server 死亡无回落验收。
- 2026-07-16：C03 达到 7/8；修复 Gateway 启动失败自等待、DRSAI_HOME 隔离和 Desktop 自行生成 Local Workspace ID 三个架构问题。
- 2026-07-16：C04 达到 8/8，C05 达到 7/8；OWOP 单一 Schema、生成门禁和 Local Binding 主体完成。
- 2026-07-16：C05 达到 8/8；新增 Runtime 托管 Windows Process 与真实 node-pty/ConPTY Provider，并完成有限缓冲和 Job Object 进程树验收。
- 2026-07-16：C06 达到 4/8；完成受管 Codex 二进制选择、Ed25519 制品信任链、原子 current/previous 和 CLI/manifest/Schema 三方兼容门禁。
- 2026-07-16：C06/C07 达到 8/8；完成 Runtime 级 App Server Supervisor、稳定 JSONL Client、model/list 能力选择，并再次通过本机真实 Codex Thread/Turn 流式烟测。
- 2026-07-16：C02/C03 补齐真实进程死亡无 fallback 与 10 Workspace 联合隔离；C08/C09 达到 8/8。
- 2026-07-16：C10 达到 8/8；完成账户 Runtime API、Approval Bridge、取消/重启恢复、权限矩阵与全链路审计脱敏。
- 2026-07-16：C11 达到 8/8；Codex 作为 Agent Backend 接入现有 Workspace/Chat/Approval/Cancel UI，未新增工作区类型或 Desktop JSON-RPC。
- 2026-07-16：C12 达到 7/8；核心回归、Schema drift、Fake/真实 Codex、10 Workspace、压力/重连和 Remote-ready 门禁通过。
- 2026-07-16：完成官方 Codex 0.142.5 受管验收制品、Runtime ZIP、原子安装/信任校验和禁网 Windows Sandbox 干净安装；本机真实 Runtime Protocol 的 completion、连续审批、取消、重启恢复通过。联网 Sandbox 设备码 403 已降级为 Sandbox 内浏览器回调登录，待一次性授权后关闭 C12-F06。
- 2026-07-17：按产品决策移除 Windows Sandbox 强制验收，C12-F06 改为 Windows 本机隔离安装与产品 E2E；使用最新打包 Runtime 的全新 InstallRoot/DRSAI_HOME 通过 completion、连续审批、取消和重启恢复，C12 达到 8/8，总进度达到 96/96。
