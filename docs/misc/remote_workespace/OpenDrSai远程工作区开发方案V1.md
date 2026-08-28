# OpenDrSai 远程工作区开发方案 V1

> 总体架构：[OpenDrSai 总体架构 V1](../OpenDrSai总体架构V1.md)  
> 技术方案：[OpenDrSai 远程工作区实现方案 V1](./OpenDrSai远程工作区实现方案V1.md)  
> 开发目标：以 OpenDrSai Full Agent Runtime 作为远端执行端，完成 Desktop 本地/远程统一体验。  
> 统计口径：共 **12 个模块、110 个功能点**；每个功能点均有独立验收条件。
> Windows 干净环境基线：[Windows Sandbox 调用、验收与关闭规范](../../apps/desktop/windows/docs/WINDOWS_SANDBOX_OPERATIONS.md)

## 1. 范围与完成定义

### 1.1 V1 范围

- Desktop 顶层运行位置只保留“本地”和“远程”；
- 远程连接使用 SSH，远端运行 OpenDrSai Full Agent Runtime；
- 一个远端系统用户运行一个 Runtime，一个 Runtime 管理多个 Workspace；
- Session、Run、Event、Files、Git、PTY、Checkpoint 全部由目标 Runtime 提供；
- Remote Run 在远端执行，Desktop 断线不取消 Run；
- 打包后的 Desktop 必须在 Windows Sandbox 干净环境中连接可控 Linux SSH Runtime 完成自动验收；
- HepAI 提供身份、组织和模型服务，DDF 不进入 V1 核心链路；
- Codex App Server Adapter 不属于本期交付，只保留 Agent Backend 扩展接口。

### 1.2 不在 V1 范围

- Mobile 直接通过 SSH 打开远程工作区；
- DDF Relay、穿透和平台托管中继；
- Codex App Server 作为远端权威 Runtime；
- 跨 Runtime 的实时 Session 双向同步；
- 多用户同时编辑同一文件的协同编辑协议。

### 1.3 功能点完成标准

每个功能点必须同时满足：

1. 代码实现进入正式模块，不以 Mock 或源码字符串检查代替；
2. 对应自动化测试通过；
3. 错误路径、权限路径和重连路径有覆盖；
4. 协议或数据模型变更同步更新 Schema 和文档；
5. 验收证据包含测试名称、日志摘要或截图；
6. 不依赖未声明的本地回落行为。

## 2. 模块与功能点统计

| 模块 | 名称 | 功能点数 | 当前基础 | 开发性质 |
| --- | --- | ---: | --- | --- |
| M01 | Desktop 本地/远程信息架构 | 8 | 部分存在 | 重构 |
| M02 | 统一 Runtime Client 与协议 | 8 | 部分存在 | 重构 |
| M03 | SSH Manager | 9 | 主体存在 | 复用并拆分 |
| M04 | Remote Runtime 生命周期 | 9 | 主体存在 | 复用并增强 |
| M05 | Runtime 身份与 Workspace Registry | 8 | 基础薄弱 | 重点重构 |
| M06 | Session / Run / Event Runtime Engine | 12 | 尚未成型 | 新建核心 |
| M07 | OpenDrSai Agent Core 远程执行 | 8 | 部分存在 | 重构接入 |
| M08 | Workspace Files / Git / PTY / Version | 12 | 主体存在 | 复用并模块化 |
| M09 | Identity / Permission / Approval / Audit | 10 | 部分存在 | 新建与整合 |
| M10 | 可靠性、重连与恢复 | 8 | 部分存在 | 增强 |
| M11 | 兼容迁移、可观测性与代码整理 | 7 | 部分存在 | 重构 |
| M12 | Windows Sandbox、测试、打包与发布验收 | 11 | 测试骨架存在 | 补齐门禁 |
|  | **合计** | **110** |  |  |

### 2.1 强制验收拓扑

Windows Sandbox 用于提供可销毁、无开发依赖的 Windows 客户端环境；它不替代 Linux 远端 Runtime。自动验收采用以下拓扑：

```text
Windows Host（验收控制器）
├─ windows-sandbox-session.ps1
├─ 只读 PackageDir
├─ 可写 EvidenceDir
└─ Controllable Linux SSH Target
   ├─ sshd
   ├─ ordinary test user
   ├─ OpenDrSai Full Agent Runtime
   └─ N test workspaces
          ▲
          │ SSH
Windows Sandbox（干净客户端）
└─ Packaged OpenDrSai Desktop
```

环境分工：

- **Windows Host**：构建 MSI/Runtime 制品，创建 Linux 测试目标，生成临时 SSH 凭据，启动/停止 Sandbox 并收集证据；
- **Windows Sandbox**：离线安装打包 Desktop，执行本地/远程 UI 流程，不依赖主机开发工具；
- **Controllable Linux Target**：Docker Linux、专用 Linux VM 或等价可控主机，允许启停 sshd/Runtime、暂停网络、清理工作区和回滚版本；
- **`remote_3090`**：使用专用低权限账户执行最终真实环境烟测，不承担需要 root、重启整机或破坏网络的自动故障注入。

本轮固定验收参数：

- 本机 Docker Desktop 自动创建和销毁 Linux SSH/Runtime 目标，作为主要可控远端；
- 本机 Windows Sandbox 作为隔离的干净 Windows 客户端，现阶段不要求另备持久化自托管 Windows 验收机；
- 允许验收脚本按测试需要启用网络，但防火墙放行必须限制到测试端口和 Sandbox 子网，验收后恢复；
- SSH 密钥、Runtime Token 等均由脚本生成并明确标记为临时凭据，测试结束必须删除；
- Platform 登录测试使用人工提供的测试账号，密码仅通过进程环境或交互输入传入，不得写入仓库、配置、日志、Event、诊断包或验收证据；
- 需要跨系统重启、长期驻留或并行多实例的发布测试，后续再补持久化自托管 Windows 验收机，不阻塞 V1 功能开发。

Windows Sandbox 控制必须遵守操作手册：

1. 使用 [windows-sandbox-session.ps1](../../apps/desktop/windows/scripts/windows-sandbox-session.ps1) 的 `Diagnose/List/Start/Stop`；
2. 以 `wsb list` 返回的会话 ID 作为唯一活动会话依据；
3. 启动前关闭既有会话并等待 ID 消失，因为 Windows Sandbox 只允许一个实例；
4. `.wsb` 必须是合法 XML，映射目录必须使用存在的绝对路径；
5. `LogonCommand` 只调用一个映射脚本，复杂逻辑写入脚本文件；
6. PackageDir 只读映射，EvidenceDir 独立可写映射；
7. 离线验收关闭 Sandbox 网络，并将 MSI 与 `OpenDrSaiRuntime-win-x64.zip` 放在同一 PackageDir；
8. 客体结束时优先执行 `shutdown.exe /s /t 0`，主机继续轮询会话 ID；
9. 正常关闭超时后使用 `wsb stop --id`，只有再次超时才允许 Force；
10. 不使用 `WindowsSandbox.exe` 退出码、Client/Server 进程是否存在判断启动或关闭成功；
11. 不为关闭 Sandbox 重启 HNS、`vmcompute`，也不批量终止 SandboxServer。

## 3. 详细功能点与验收

## M01 Desktop 本地/远程信息架构（8 项）

| ID | 功能点 | 验收方法 |
| --- | --- | --- |
| M01-F01 | 添加工作区入口只显示“本地”和“远程” | Renderer 组件测试断言只有两个顶层选项；打包应用截图复核 |
| M01-F02 | 本地选项打开系统文件夹选择器并创建 Local Workspace | Electron E2E 选择临时目录，Workspace 持久化且 `location=local` |
| M01-F03 | 远程选项进入“计算机 → 目录”二级选择流程 | Fake SSH E2E 完成主机选择、目录浏览和工作区创建 |
| M01-F04 | 工作区标题统一显示运行位置、主机和路径 | UI 测试分别验证“本地 · path”和“远程 · host · path” |
| M01-F05 | 主界面移除 Gateway、Remote Gateway、Remote SSH 等产品级术语 | 文案快照和可访问性树检查；技术词只允许出现在连接详情 |
| M01-F06 | Workspace 数据模型改为 `location=local|remote`，远程传输单列 `transport=ssh` | TypeScript 类型测试和持久化往返测试通过 |
| M01-F07 | Agent 来源与 Runtime Location 分离 | 选择任意 Agent Definition 后切换 Local/Remote，Agent ID 不变、Runtime Target 正确变化 |
| M01-F08 | Worktree 继承父 Workspace 的 Runtime Location | 本地和远程各创建 Worktree；路径和执行均发生在父 Runtime 所在机器 |

## M02 统一 Runtime Client 与协议（8 项）

| ID | 功能点 | 验收方法 |
| --- | --- | --- |
| M02-F01 | 定义统一 `RuntimeClient` 接口 | 编译期契约测试覆盖 Runtime、Workspace、Session、Run、Event、Files、Git、PTY |
| M02-F02 | 实现 `LocalRuntimeClient` | 本地集成测试通过统一接口创建 Workspace、Session 和 Run |
| M02-F03 | 实现 `RemoteRuntimeClient` | SSH 隧道后的集成测试通过同一套接口完成同样操作 |
| M02-F04 | 实现 `/v1/runtime` 与 `/v1/capabilities` 握手 | 协议测试验证 runtime/instance ID、版本和能力列表 |
| M02-F05 | 实现协议版本协商和不兼容拒绝 | Desktop 与旧/新不兼容 Runtime 组合测试返回明确错误且不执行任务 |
| M02-F06 | 统一结构化错误模型 | 所有失败响应包含 `code/message/correlation_id/retryable`；契约测试通过 |
| M02-F07 | OpenAPI/Schema 生成客户端及 drift check | 重新生成后仓库零差异；CI 修改 Schema 不生成客户端时必须失败 |
| M02-F08 | 禁止 Remote 失败时静默回落 Local | 故障注入关闭隧道，断言本地 Runtime 未收到请求、UI 明确提示远程不可用 |

## M03 SSH Manager（9 项）

| ID | 功能点 | 验收方法 |
| --- | --- | --- |
| M03-F01 | 从 OpenSSH 配置发现具体 Host Alias | Fixture 覆盖默认配置、Include 和 pattern-only Host 过滤 |
| M03-F02 | 使用 OpenSSH 解析 HostName、User、Port、IdentityFile、ProxyJump | 与 `ssh -G` 输出对照测试全部一致 |
| M03-F03 | SSH 连通性测试 | 成功、拒绝、超时、DNS 失败分别返回结构化状态 |
| M03-F04 | 首次主机指纹展示和确认 | 新主机 E2E 显示指纹；拒绝后不得连接；确认后写入系统 known_hosts 流程 |
| M03-F05 | 使用系统 ssh-agent、硬件密钥和交互认证 | 集成夹具覆盖 agent key；交互认证不可用时给出可操作错误 |
| M03-F06 | 远端目录浏览和 canonical path 获取 | 目录、文件、无权限目录、符号链接目录测试符合预期 |
| M03-F07 | 建立随机本地端口 SSH Local Forward | 端口占用测试仍能成功；Runtime 只通过回环地址访问 |
| M03-F08 | 同一 HostConnection 复用隧道承载多个 Workspace | 同主机两个 Workspace 的 base URL 和连接实例相同 |
| M03-F09 | 最后一个 Workspace 关闭后清理隧道和临时凭证 | 进程、端口、Timer、Token 引用全部释放；无孤儿 SSH 进程 |

## M04 Remote Runtime 生命周期（9 项）

| ID | 功能点 | 验收方法 |
| --- | --- | --- |
| M04-F01 | 远端 OS、架构、Python 和 Runtime 预检 | Linux 夹具返回兼容性报告；缺失依赖给出安装建议 |
| M04-F02 | 用户级无 Root 安装 | 普通 SSH 用户从空环境完成安装，未写入系统目录 |
| M04-F03 | 安装制品摘要和签名校验 | 篡改摘要、错误签名、未知签发者均被拒绝 |
| M04-F04 | 独立版本目录和依赖环境 | 安装两个版本，文件和依赖互不覆盖 |
| M04-F05 | 候选 Runtime 启动及健康检查 | 候选版本无法启动或握手失败时不得切换 current |
| M04-F06 | `current/previous` 原子切换 | 升级中断故障注入后 current 始终指向完整可用版本 |
| M04-F07 | 一键回滚上一可用版本 | 升级后回滚，协议、版本和已有 Workspace 状态可读取 |
| M04-F08 | 用户级单实例锁与并发安装锁 | 两个 Desktop 同时连接/升级，只有一个 Runtime 和一个安装事务生效 |
| M04-F09 | Runtime 仅监听回环地址并使用短期实例 Token | 远端端口扫描确认无非回环监听；错误 Token 返回 401 |

## M05 Runtime 身份与 Workspace Registry（8 项）

| ID | 功能点 | 验收方法 |
| --- | --- | --- |
| M05-F01 | 首次安装生成并持久化稳定 `runtime_id` | Runtime 重启和升级后 ID 不变；重新安装数据目录后 ID 改变 |
| M05-F02 | 每次启动生成新的 `instance_id` | 连续两次启动 ID 不同，Desktop 能检测重启 |
| M05-F03 | Runtime 规范化用户提交的 Workspace Path | 相对路径、`~`、符号链接和不存在目录测试均有确定结果 |
| M05-F04 | `workspace_id` 由 Runtime 生成 | Desktop 请求不携带权威 ID；响应 ID 稳定且与 SSH alias 无关 |
| M05-F05 | Workspace Registry 持久化 | Runtime 重启后可以列出已打开 Workspace，无需依赖 Desktop 内存 |
| M05-F06 | 一个 Runtime 管理 N 个 Workspace | 同时打开至少 10 个 Workspace，Session、监听和 PTY 不串线 |
| M05-F07 | 实现 Workspace open/list/read/close 生命周期 | API 契约测试和数据库状态测试通过；关闭不删除历史数据 |
| M05-F08 | Local 与 Remote Workspace 使用同一领域模型 | 序列化 Schema 一致，差异只存在于 RuntimeConnection 元数据 |

## M06 Session / Run / Event Runtime Engine（12 项）

| ID | 功能点 | 验收方法 |
| --- | --- | --- |
| M06-F01 | 建立 Session 持久化模型 | 创建、读取、分页、重命名、归档、恢复测试通过 |
| M06-F02 | Remote Session 强制绑定 `workspace_id` | 缺失或未知 Workspace 创建 Session 返回明确 4xx 错误 |
| M06-F03 | 建立 Run 持久化模型 | Run 保存 executor Runtime、Workspace、Agent Definition 和时间戳 |
| M06-F04 | 实现 Run 状态机 | 非法状态迁移被拒绝；全部合法路径有参数化单测 |
| M06-F05 | 实现幂等 Run 创建 | 同一 Idempotency-Key 重试只产生一个 Run |
| M06-F06 | Run 与 HTTP/SSE 连接生命周期解耦 | 提交后关闭客户端，Run 继续并最终完成 |
| M06-F07 | 建立只追加 Event Store | Event 不支持 update/delete；数据库约束和测试验证 |
| M06-F08 | 实现统一 Event Envelope 和单调 `sequence` | 并发工具事件压力测试中无重复、倒序和缺号写入 |
| M06-F09 | 实现 Event 查询与 `after_sequence` 续传 | 随机断开 20 次后最终事件集合完整且有序 |
| M06-F10 | 实现显式 Run cancel | 只有 cancel API 终止 Run，终态及取消事件一致 |
| M06-F11 | 实现 `waiting_approval` 暂停与审批恢复 | 同意、拒绝、超时三条路径均有 E2E 覆盖 |
| M06-F12 | 实现 Runtime Checkpoint | 运行中保存并恢复 Agent/Tool/Subagent 必需状态；重启恢复测试通过 |

## M07 OpenDrSai Agent Core 远程执行（8 项）

| ID | 功能点 | 验收方法 |
| --- | --- | --- |
| M07-F01 | 定义可扩展 `AgentBackend` 接口 | OpenDrSai Backend 通过契约测试；测试 Backend 可替换运行 |
| M07-F02 | OpenDrSai Agent Core 作为 V1 默认 Backend | 远端真实模型或受控 Stub 完成 Agent Loop 并生成统一 Event |
| M07-F03 | Run Context 强制包含 Runtime、Workspace、Session、Run ID | Tool 调用审计中四类 ID 完整且不可由模型覆盖 |
| M07-F04 | Agent Definition 作为 Asset 加载 | 指定版本的 Agent Definition 可重现；缺失版本拒绝运行 |
| M07-F05 | Tool / Skill / MCP 在远端 Runtime 调度 | 探针工具返回远端 hostname/cwd；Desktop 本地无对应进程 |
| M07-F06 | Subagents 继承父 Run Workspace 和权限 | 子 Agent Event 关联 parent ID；越权切换 Workspace 被拒绝 |
| M07-F07 | Shell、Process 和测试命令全部在远端执行 | 创建远端标记文件并读取 hostname；本机确认无标记文件 |
| M07-F08 | HAI Model API 身份和错误映射 | 有效、过期、无权限、限流和上游故障映射到统一 Runtime Error |

## M08 Workspace Files / Git / PTY / Version（12 项）

| ID | 功能点 | 验收方法 |
| --- | --- | --- |
| M08-F01 | 文件树、分页搜索和忽略规则 | 大目录 Fixture 验证分页、截断、排序和忽略目录 |
| M08-F02 | 文本、二进制和富媒体预览 | MIME、大小限制、截断和非法编码测试通过 |
| M08-F03 | 大文件分块流式读取 | 多分块合并摘要等于远端原文件，内存上限满足指标 |
| M08-F04 | 原子写入、摘要校验和并发冲突 | 并发写入旧摘要返回 409，原文件不损坏、不残留临时文件 |
| M08-F05 | 文件监听、限流和重连续订 | 批量修改、删除、重命名和断线恢复无跨 Workspace 事件 |
| M08-F06 | Git status、diff 和 file-at-ref | 干净、修改、未跟踪、重命名和历史版本测试通过 |
| M08-F07 | Git stage、unstage、revert 和 hunk 操作 | Diff Hash 不匹配拒绝；匹配时结果与 Git CLI 一致 |
| M08-F08 | Git commit | 空消息、无变更、Hook 失败和成功提交均返回结构化结果 |
| M08-F09 | PTY create/write/resize/kill | 真实 Linux PTY E2E 验证 cwd、尺寸、输入输出和退出状态 |
| M08-F10 | PTY attach 和有限输出缓冲 | 断开后重新 attach 可恢复缓冲；超限按策略截断 |
| M08-F11 | Workspace Checkpoint 创建、预览、恢复和确认 | 文件修改、增加、删除及大文件跳过场景全部验证 |
| M08-F12 | Workspace Version 与 Runtime Checkpoint 分离 | Schema、目录和 API 不混用；分别恢复时互不影响 |

## M09 Identity / Permission / Approval / Audit（10 项）

| ID | 功能点 | 验收方法 |
| --- | --- | --- |
| M09-F01 | SSH 主机身份验证 | 主机密钥变更必须阻断连接并显示安全告警 |
| M09-F02 | Runtime 短期 Token 验证 | 缺失、错误、过期和撤销 Token 均无法调用 API/WS |
| M09-F03 | HepAI OIDC Identity 映射到 Runtime Principal | 用户、组织、会话声明验证；伪造和过期 Token 被拒绝 |
| M09-F04 | Workspace Permission 模型 | owner/editor/viewer/denied 矩阵测试覆盖读写、Git、PTY 和 Run |
| M09-F05 | 文件根目录和符号链接边界 | 相对穿越、绝对路径、软链接、竞态替换攻击测试被阻止 |
| M09-F06 | Runtime Sandbox 与远端 OS 用户权限叠加 | Runtime 授权但 OS 拒绝时操作失败；不得提权绕过 |
| M09-F07 | 敏感操作 Approval | Shell、写文件、Git 推送及恢复操作按 Policy 触发审批 |
| M09-F08 | Permission 与 Approval 顺序固定 | 无 Permission 请求不得进入 Approval；有 Permission 才可审批 |
| M09-F09 | 完整 Audit 关联链 | 每条敏感操作包含 principal/runtime/workspace/session/run/tool/correlation ID |
| M09-F10 | 凭据和日志脱敏 | 自动扫描日志、诊断包和 Event，确认无私钥、Token、密码和原始 Secret |

## M10 可靠性、重连与恢复（8 项）

| ID | 功能点 | 验收方法 |
| --- | --- | --- |
| M10-F01 | Runtime 与 SSH 双层健康监控 | 分别终止 Runtime 和 SSH，状态机准确区分故障类型 |
| M10-F02 | 指数退避、抖动和最大重连窗口 | Fake Clock 单测验证延迟序列、取消和耗尽状态 |
| M10-F03 | Runtime 重启检测 | `instance_id` 变化后重新握手，不复用旧能力和连接状态 |
| M10-F04 | 重连后恢复全部 Workspace Registry 关联 | 同主机 N 个 Workspace 全部恢复且不重复创建 |
| M10-F05 | Desktop 断线时 Remote Run 继续 | 运行中关闭 Desktop，远端完成后重开可查看终态 |
| M10-F06 | Event 精确续传和前端去重 | 网络抖动 E2E 中 UI 最终只显示一次每个 `event_id` |
| M10-F07 | 请求超时后的幂等重试 | 在响应丢失后重试 create Run，Runtime 中仍只有一个 Run |
| M10-F08 | PTY 重连 attach | SSH/WS 中断后 PTY 进程继续，恢复后可读缓冲并继续输入 |

## M11 兼容迁移、可观测性与代码整理（7 项）

| ID | 功能点 | 验收方法 |
| --- | --- | --- |
| M11-F01 | 旧 `type=remote-ssh` Workspace 数据迁移 | 真实旧数据 Fixture 启动后转换成功且可回滚备份存在 |
| M11-F02 | 旧 `alias+path` ID 映射到 Runtime 权威 ID | 首次连接写回新 ID，重复启动不重复迁移、不丢历史 |
| M11-F03 | 旧 Session `workdir` 迁移到 `workspace_id` | 同路径跨主机 Fixture 不串 Session；未匹配记录进入待处理状态 |
| M11-F04 | 提供限期 Legacy API Adapter | 旧调用通过 Adapter 工作并输出弃用日志；新代码禁止新增旧接口依赖 |
| M11-F05 | 统一命名为 Runtime、Gateway Component、Remote Workspace | 代码、UI、Schema 和文档术语检查通过 |
| M11-F06 | 拆分巨型 Desktop/Runtime 模块 | SSH、Connection、Protocol、Workspace、Files、Git、PTY、Runtime Engine 各有独立边界和测试 |
| M11-F07 | 指标、日志、Trace 和安全诊断包 | 一次 Run 可按 correlation ID 串联全链路；诊断包通过 Secret 扫描 |

## M12 Windows Sandbox、测试、打包与发布验收（11 项）

| ID | 功能点 | 验收方法 |
| --- | --- | --- |
| M12-F01 | Python/TypeScript 单元测试门禁 | 核心新增代码达到约定覆盖率，CI 零失败、零意外 skip |
| M12-F02 | Protocol/OpenAPI/Event Schema 契约门禁 | Schema drift、破坏性变更和错误事件样例均能使 CI 失败 |
| M12-F03 | Desktop 全量类型检查、构建和制品完整性 | `typecheck:node/web`、构建、MSI/Runtime ZIP 哈希与版本一致性通过；无组织证书时制品必须明确标记为“内部测试、未签名”，签名合同及负向门禁通过 |
| M12-F04 | 可控 Linux SSH Runtime E2E | Docker/VM 覆盖安装、双主机、多 Workspace、Files、Git、PTY、Run/Event 和隔离 |
| M12-F05 | Windows Sandbox 控制器和会话生命周期 | `Diagnose→List→Start→ID→Stop→ID 消失` 自动通过；不得以进程存在判定结果 |
| M12-F06 | `.wsb` 配置、只读输入和可写证据目录 | XML 校验通过；PackageDir 不可写、EvidenceDir 可写；LogonCommand 只调用一个脚本 |
| M12-F07 | Windows Sandbox 离线干净安装 | Sandbox 禁网；仅凭映射的 MSI 与 Runtime ZIP 完成安装，确认无 Node/Python/Git 开发依赖 |
| M12-F08 | Sandbox 内打包 Desktop 远程工作区 E2E | 使用打包 Desktop 完成 Local/Remote、SSH 指纹、Runtime 安装、Session、Run、审批、重连和结果查看 |
| M12-F09 | 可控目标故障注入与恢复 | 启停 sshd/Runtime、暂停网络、破坏候选版本；验证 Run 继续、Event 续传和版本回滚 |
| M12-F10 | `remote_3090` 真实环境烟测 | 专用低权限账户完成远程目录、Runtime、Session、Run、Tool、Shell、Git 和长任务，不要求系统级破坏操作 |
| M12-F11 | 性能、长稳、证据与关闭门禁 | 达到第 6 节指标；证据 JSON/日志/截图齐全；客体 shutdown 后 `wsb list` 对应 ID 消失 |

## 4. 现有实现复用与重构边界

### 4.1 可直接复用

- OpenSSH 配置发现、系统 SSH/SCP 调用；
- SSH Tunnel、KeepAlive、基础健康监控；
- 用户级版本隔离安装、候选健康检查、原子切换和回滚；
- Workspace path policy；
- Files、Git、PTY、Workspace Checkpoint 的核心操作；
- Fake SSH、Docker Runtime 和真实 SSH 测试骨架。
- Windows Sandbox 会话控制脚本、离线安装验收脚本和证据输出机制。

### 4.2 适配后复用

- HostConnection：从 SSH alias 键迁移到稳定 connection/runtime 身份；
- Workspace UI 和持久化：迁移为 `location + runtime_id + workspace_id`；
- Remote Chat：迁移为统一 RuntimeClient 和 Run API；
- Session Store：从 `workdir` 筛选迁移为显式 `workspace_id`；
- Runtime Token 和 Audit：增加 Principal、Permission 和关联 ID；
- 文件监听和 PTY：改为 workspace ID 路由并接入统一恢复逻辑。

### 4.3 必须重构或新建

- Runtime 权威 `runtime_id/instance_id/workspace_id`；
- 持久化 Workspace Registry；
- Session/Run/Event Runtime Engine；
- 后台 Run 与连接生命周期解耦；
- Event Store、`sequence` 和断线续传；
- Runtime Checkpoint；
- AgentRun 远程路由和禁止本地文件回落；
- Workspace Permission 与 Runtime Approval 整合。

## 5. 开发阶段与依赖

| 阶段 | 模块 | 交付结果 | 进入下一阶段条件 |
| --- | --- | --- | --- |
| P0 基线冻结 | M01、M02 | Desktop 两位置模型、RuntimeClient、协议骨架 | 类型、迁移和无回落测试通过 |
| P1 连接与安装 | M03、M04 | 可连接、安装和启动远端 Runtime | Fake SSH 安装/握手 E2E 通过 |
| P2 身份与运行核心 | M05、M06 | 权威 ID、Registry、Session/Run/Event | 断线 Run 继续及 Event 续传通过 |
| P3 Agent 与 Workspace | M07、M08 | OpenDrSai Agent 全远程执行和工作区能力 | 远端执行探针及 Files/Git/PTY 全通过 |
| P4 安全与可靠性 | M09、M10 | Permission、Approval、Audit、恢复 | 安全矩阵和故障注入通过 |
| P5 迁移与交付 | M11、M12 | 旧数据迁移、Windows Sandbox 干净验收、真实主机烟测 | 所有 110 项关闭且内部交付门禁通过；公开发布另过组织签名门禁 |

开发顺序不得绕过 M05/M06 直接扩展更多远程工具；否则会继续放大旧的路径路由和临时 SSE 状态问题。

## 6. 非功能指标

| 指标 | V1 门槛 |
| --- | --- |
| Runtime 握手 | SSH 隧道建立后 5 秒内完成，P95 |
| Workspace 打开 | 已安装 Runtime 场景 3 秒内完成，P95 |
| Event 展示延迟 | Runtime 写入到 Desktop 展示小于 500 ms，P95 |
| Event 可靠性 | 重连后零丢失；按 event_id 去重后零重复 |
| 文件树 | 10 万文件仓库首屏 2 秒内返回，采用分页/截断 |
| 文件读取 | 不一次性加载超过协议上限的大文件 |
| 重连 | 短暂网络故障恢复成功率不低于 99%，最长窗口 3 分钟 |
| 多 Workspace | 单 Runtime 至少稳定管理 100 个注册 Workspace |
| 长运行 | Desktop 断线 30 分钟后重连仍可恢复 Run/Event |
| 稳定性 | 1 小时长稳测试无孤儿 SSH/Runtime/PTY 进程持续增长 |
| 安全 | Runtime 无公共监听，诊断包 Secret 扫描零泄漏 |
| Sandbox 启动 | `Start` 后在超时内获得新的 `wsb` 会话 ID |
| Sandbox 关闭 | 客体 shutdown 或 `wsb stop` 后对应会话 ID 必须消失 |
| 离线安装 | Sandbox 禁网时 MSI + Runtime ZIP 完成安装和启动 |
| 测试清理 | 发布回归结束后系统 TEMP 中 `opendrsai-*` 测试目录为 0，相关 Python/OpenDrSai/Electron 进程为 0 |

1 小时任务运行中使用 `npm run monitor:remote-stability` 检查采样连续性、Runtime/Instance 身份以及 SSH、Runtime、PTY 进程计数；默认每 5 分钟采样，至少覆盖完整 3600 秒。每次 PTY 创建、断连重附和显式终止必须等到匹配 ID 的 Runtime `killed` 确认，并直接证明 Runtime 下零孤儿 PTY 子进程。正式 Runner 还必须绑定一个独立清理看门狗；看门狗以 Runner PID、精确容器 ID 和专用 SSH 配置为边界，即使 Runner 被强制终止，也只能清理本窗口资源并生成零残留证据。任务结束后必须由 `npm run verify:remote-stability-evidence` 严格确认完整采样窗口、全部样本 `ptyProcessCount=0`、最终成功标记、看门狗证据、零 SSH 隧道和零残留容器，不能仅凭进程退出或单个 `completed` 字段关闭验收点。

## 7. 统一验收矩阵

| 验收层级 | 必须通过的证据 |
| --- | --- |
| 功能点 | 对应 ID 的自动化测试及验收记录 |
| 模块 | 模块内全部功能点完成，无 P0/P1 缺陷 |
| 协议 | Schema、生成客户端和实现零 drift |
| 安全 | 身份、ACL、Approval、路径和 Secret 测试通过 |
| 可靠性 | Runtime/SSH/网络三类故障注入通过 |
| 跨主机隔离 | 两主机同路径完整业务链路不串数据 |
| 干净打包产品 | Windows Sandbox 内离线安装并连接可控 Linux Runtime 完成全流程 |
| 真实环境 | `remote_3090` 专用低权限账户完成非破坏性烟测 |
| Sandbox 生命周期 | 以 `wsb` 会话 ID 证明启动和关闭，输入只读、证据可写 |
| 内部交付 | 110/110 功能点完成，测试报告和已知限制归档；未签名制品明确标记为内部测试包 |
| 公开发布 | 必须额外具备组织代码签名、RFC 3161 时间戳、签名证据和已发布资产验证 |

远程工作区 V1 的功能完成与 Windows 公开发布分层验收。当前没有组织代码签名证书时，允许完成内部开发验收，但 MSI、Runtime ZIP 和 Desktop 必须明确归类为未签名内部测试制品，不得进入公开稳定版发布、自动更新或对外下载渠道。`npm run verify:internal-release-ready` 验证内部交付；获得组织证书后，必须再运行 `npm run verify:windows-public-release`，其失败不得降级为警告。

正式签名前必须先执行不修改制品的证书预检。PFX 密码只能通过临时环境变量传入，不得出现在命令参数、日志或证据中：

```powershell
$env:OPENDRSAI_WINDOWS_SIGNING_PASSWORD = "<由安全凭据存储注入>"
apps\desktop\windows\scripts\sign-windows-release.ps1 `
  -PfxPath "<组织代码签名 PFX>" `
  -ValidateOnly
```

预检必须确认私钥、证书有效期及 Code Signing EKU；正式执行时，每个产物在签名后立即通过 `signtool verify /pa`，且 `Get-AuthenticodeSignature` 必须返回实际 `TimeStamperCertificate`，不能只记录时间戳URL。随后再次通过发布制品签名门禁。

不可导出的 USB Key/HSM 证书使用证书存储模式，不要求 PFX 或密码：

```powershell
apps\desktop\windows\scripts\sign-windows-release.ps1 `
  -CertificateThumbprint "<组织证书 SHA-1 Thumbprint>" `
  -CertificateStoreLocation CurrentUser `
  -ValidateOnly
```

机器级证书把位置改为 `LocalMachine`；签名时会自动使用 `signtool /sm`。PFX 与证书存储参数互斥，证据必须记录实际证书来源和存储位置。

CI 中 `WINDOWS_CERTIFICATE_PASSWORD` 只能由 Secret 环境变量注入。Bootstrapper 签名脚本必须先校验证书并以不可导出方式导入 CurrentUser 证书存储，在启动 `signtool` 前删除临时 PFX，再按 Thumbprint 签名；禁止使用会把密码暴露到子进程命令行的 `signtool /p`。

稳定版 CI 必须在签名后运行 `generate:signing-evidence` 和 `verify:signing-evidence`：证据以独立配置的 Thumbprint/Subject 固定签名者，验证 Runtime ZIP 内的 `OpenDrSai.exe` 与已签 Desktop 可执行文件逐字节一致，并绑定 MSI、Runtime ZIP、更新清单、发布摘要和版本。`windows-signatures.json` 必须随发布制品上传；草稿提升流程必须重新下载并验证该证据和内嵌可执行文件，不能只相信构建任务或发布页面声称“已签名”。

## 8. 最终用户验收流程

1. 主机运行 `windows-sandbox-session.ps1 -Action Diagnose`，确认现代 `wsb` CLI 可用；
2. `List` 并正常关闭已有 Sandbox，会话列表清空后再继续；
3. 准备只读 PackageDir、可写 EvidenceDir、合法 `.wsb` 和可控 Linux SSH Runtime；
4. Sandbox 禁网启动，以新返回的会话 ID 证明启动成功；
5. 客体脚本从 MSI 与同目录 Runtime ZIP 离线安装 OpenDrSai Desktop；
6. 添加一个 Local Workspace，创建 Session 并完成一次 Run；
7. 选择“远程”，从 SSH 配置发现可控 Linux 主机并验证指纹；
8. 在普通用户权限下自动安装或启动 OpenDrSai Full Agent Runtime；
9. 选择 `/home/vscode/project-a`，查看该 Workspace 的历史 Session；
10. 创建 Run，验证模型、Tool、Skill、Shell、文件和 Git 均在远端执行；
11. 中断 Desktop/SSH/Runtime/网络，确认 Run、Event、Workspace 和 PTY 按方案恢复；
12. 打开同主机第二个 Workspace及另一主机相同路径，确认连接复用和完整隔离；
13. 触发文件冲突、路径越界、无权限操作和敏感命令审批；
14. 升级 Runtime、破坏候选版本并验证保留当前版本和回滚；
15. 导出证据 JSON、日志、截图和诊断包，确认无 Token、密码、私钥和敏感内容；
16. 客体执行 `shutdown.exe /s /t 0`，主机确认对应 `wsb` 会话 ID 消失；
17. 在 `remote_3090` 专用低权限账户重复非破坏性真实环境烟测。

`remote_3090` 使用统一的受保护入口执行，不接受密码参数，也不会把凭据写入证据：

```powershell
$env:OPENDRSAI_REMOTE_HOST_ALIAS = "remote_3090"
$env:OPENDRSAI_REMOTE_BOOTSTRAP_ALIAS = "<已通过 known_hosts 验证且可预置临时凭据的 SSH Alias>"
$env:OPENDRSAI_REMOTE_HOST_ACCEPTANCE = "1"
$env:OPENDRSAI_REMOTE_HOST_NAME = "<HostName 或 IP>"
$env:OPENDRSAI_REMOTE_HOST_USER = "<专用低权限用户名>"
$env:OPENDRSAI_REMOTE_HOST_PORT = "22"
$env:OPENDRSAI_REMOTE_HOST_IDENTITY_FILE = "<标记为临时凭据的 Ed25519 私钥绝对路径>"
$env:OPENDRSAI_REMOTE_HOST_FINGERPRINT = "SHA256:<经可信渠道核对的主机密钥指纹>"
$env:OPENDRSAI_REMOTE_HOST_EVIDENCE = "<remote_3090 最终证据绝对路径>"
npm run verify:remote-3090-final
```

Remote Runtime 的 Python 最低版本必须与 `drsai` 包契约一致为 **3.11**；候选版本使用隔离 venv 并安装声明依赖，不得依赖 `--system-site-packages` 或 `--no-deps` 掩盖空环境缺包。受保护的 `remote_3090` 编排器可在用户目录临时安装经过官方 SHA-256 校验的 Python 3.11，并以所有权令牌约束清理范围。

也可以只设置已经严格验证主机密钥的 `OPENDRSAI_SSH_CONFIG`。直接参数模式必须先扫描主机密钥并与可信渠道提供的 SHA-256 指纹匹配，只把匹配的密钥写入一次性 `known_hosts`；匹配前不得建立 SSH 会话。临时 SSH config、known_hosts 和发布信任材料在结束后全部删除。入口必须拒绝 root、使用 `BatchMode`、只在 `~/.cache/opendrsai/acceptance` 下创建唯一临时目录，并在 Runtime、Workspace、Files、Git、Session、Run、Tool、Approval、Checkpoint、PTY 长命令和重连全部通过且清理成功后才生成通过证据。`verify:remote-3090-final` 在烟测后删除临时 Python、公钥和测试前不存在的首次 Runtime，再用独立验证器核对目标别名、低权限用户、可信指纹、权威 ID、全部检查项、Secret 扫描和零遗留隧道，不能只信任证据中的 `passed` 字段。

上述流程、全部自动化门禁以及 **110/110 功能点**均通过后，OpenDrSai 远程工作区 V1 才能标记为功能完成并可内部交付。该结论不等同于 Windows 公开稳定版已经获得发布许可。

最终完成只能由统一门禁确认：

```powershell
$env:OPENDRSAI_EXPECTED_REMOTE_HOST_USER = "<经独立渠道确认的低权限用户名>"
$env:OPENDRSAI_EXPECTED_REMOTE_HOST_FINGERPRINT = "SHA256:<经独立渠道确认的主机指纹>"
npm run verify:remote-workspace-final
```

该门禁首先验证开发方案中的 110 个 ID 必须在“已验收”和“已知失败”之间形成无重复、无交叉、无遗漏的完整分区，并通过重复项、交叉标记、遗漏项和未知 ID 的负向回归；随后要求状态索引恰好为 110/110 且无已知失败，再顺序复验 `remote_3090`、完整 1 小时长稳、PTY/看门狗、内部制品完整性、签名流水线合同和零临时目录。未签名状态必须被明确报告，不能被误判为公开发布通过。

Windows 公开发布使用独立硬门禁：

```powershell
$env:EXPECTED_WINDOWS_SIGNER_THUMBPRINT = "<组织证书指纹>"
$env:EXPECTED_WINDOWS_SIGNER_SUBJECT = "<组织证书主题>"
$env:OPENDRSAI_RELEASE_BASE_URL = "<待验证的正式发布地址>"
npm run verify:windows-public-release
```

公开发布门禁要求当前 MSI、Runtime ZIP 内嵌 EXE 和独立 Desktop EXE 均由固定组织身份签名、存在真实 RFC 3161 时间戳、哈希与版本和发布证据完全一致，并能从正式发布地址重新验证；缺少证书、签名证据或发布地址时必须失败。
