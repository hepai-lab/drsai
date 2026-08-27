# OpenDrSai Codex Adapter OAEP V3 用户产品化开发方案

版本：V3 Draft 1  
阶段定位：V2 协议重构后的用户可用性、可恢复性与安装版交付阶段  
范围：Windows 本地 Codex 优先，同时保持未来远程 Linux Codex 使用同一 OAEP/OWOP 上层协议

## 1. 阶段结论

V2 第二阶段已经证明底层链路正确：Codex 原生事件可以转换为 OAEP；同一 OpenDrSai 会话可以连续执行多个 Codex Turn；实时、重放和快照能够收敛；审批、重启和跨端协议均已通过测试。

但从普通用户视角，产品仍有以下风险：

1. 用户不知道 Codex 是否已安装、登录、兼容或只是暂时启动失败。
2. Codex Desktop 已经能使用，不代表 OpenDrSai 一定能自动找到其可启动的 CLI 路径。
3. 添加已有项目后，用户期望自动看到该项目的有效 Codex 历史会话，而不是得到一个空工作区。
4. “新建会话”入口、当前会话绑定的 Backend、是否继续原 Thread 等关键状态不够显性。
5. 流式输出、结构化 Item、审批、重连虽然底层存在，但缺少统一、容易理解的用户反馈。
6. 开发环境测试通过不等于安装版升级、首次启动和真实用户数据迁移可靠。
7. 出错后用户仍可能只能看到技术错误，不能一键检查、修复、重试或导出诊断。

因此 V3 不再重构 OAEP 核心，而是在现有架构上增加产品化层。原有 OpenDrSai Agent Backend、Codex Backend、Runtime、Workspace Registry、OAEP 和 OWOP 架构保持不变。

本方案共 **9 个模块、54 个功能点**。

## 2. 用户目标体验

### 2.1 第一次使用

用户安装并启动 OpenDrSai 后，应用自动完成 Runtime 与 Codex 检查，并给出以下一种明确结果：

- Codex 已就绪，可以直接使用；
- 找到了 Codex，但需要登录；
- 找到了 Codex，但版本不兼容，可以升级或切换入口；
- 未找到 Codex，可以按向导安装；
- Codex 暂时故障，可以一键重启并查看安全诊断。

用户不需要理解 app-server、JSON-RPC、OAEP、进程路径或环境变量。

### 2.2 添加已有项目

用户选择 `C:\Users\win11\VSProjects\drsai` 后，OpenDrSai：

1. 注册或复用同一个 Workspace；
2. 显示扫描进度；
3. 同步与该规范化路径匹配的 Codex 活跃会话；
4. 将 Codex 已归档会话放入“设置 → 已归档会话”；
5. 合并已经存在的 OpenDrSai/Codex 映射，不产生重复会话；
6. 给出“找到 N 个活跃会话、M 个归档会话”的结果。

### 2.3 新建与连续对话

工作区标题区始终有显式“新建会话”按钮。用户选择 Codex 后创建一个 OpenDrSai Session 和一个 Codex Thread；后续每次发送只新增 Run/Turn，不新增 Thread。界面显示当前 Backend、模型、连接状态和会话来源。

### 2.4 任务执行

模型文字按 token/片段持续显示；Reasoning、Plan、Command、Tool、File Change、Artifact、Subtask、Notice 使用稳定的结构化卡片。长任务持续显示正在做什么、是否等待审批、是否正在重连，而不是长时间无反馈。

### 2.5 故障与恢复

断网、Codex 退出或 OpenDrSai 重启后，应用自动恢复同一 Session/Thread。失败时显示用户能采取的操作：重试本轮、检查 Codex、重新登录、复制诊断编号或切换到 OpenDrSai Backend。

## 3. 保持不变的架构

```text
OpenDrSai Desktop
├─ Workspace UI
├─ Runtime Client
├─ Backend Setup & Health UX          [V3 增强]
└─ Workspace/Session Sync UX          [V3 增强]
             │
             │ Local HTTP / Future SSH Tunnel
             ▼
OpenDrSai Full Agent Runtime
├─ Gateway / Protocol
├─ Session / Run / Event Runtime Engine
├─ Agent Core
│  ├─ OpenDrSai Agent Backend
│  └─ Codex Agent Backend
│     ├─ Codex Adapter
│     └─ Codex app-server
└─ Workspace Registry

统一语义：OAEP
统一工作区操作：OpenDrSai Workspace Operation Protocol（OWOP）
底层传输：本地进程/HTTP；未来远程 SSH 隧道
```

V3 不允许 Desktop 直连 Codex app-server，也不允许 Desktop 解析 Codex 私有事件。所有历史、实时、审批和恢复事实仍由 Runtime 通过 OAEP 提供。

## 4. 模块与功能点

### V3-M01 首次启动与 Codex 就绪向导（7 项）

| 编号 | 功能点 | 用户验收标准 |
| --- | --- | --- |
| V3-M01-F01 | 自动发现 Codex Desktop/CLI | 不设置 `CODEX_BIN` 也能发现 Windows 用户目录中的可启动入口 |
| V3-M01-F02 | 区分 WindowsApps 别名与真实可执行文件 | 不把 supervisor 无法启动的 App Execution Alias 错报为可用 |
| V3-M01-F03 | 版本与 Schema 兼容检查 | 界面显示版本、兼容状态和建议动作 |
| V3-M01-F04 | 登录状态检查 | 显示已登录账号、未登录和登录过期，不展示凭据 |
| V3-M01-F05 | 一键安装/升级/修复 | 操作带进度、失败原因和安全回滚 |
| V3-M01-F06 | 一键重启 Backend | 不重启整个 Desktop 即可恢复 app-server |
| V3-M01-F07 | 首次可用性向导 | 小白用户能在 3 个交互步骤内进入可发送状态 |

### V3-M02 工作区导入与 Codex 会话发现（7 项）

| 编号 | 功能点 | 用户验收标准 |
| --- | --- | --- |
| V3-M02-F01 | 规范化工作区身份 | 大小写、尾斜杠、符号链接不会创建重复 Workspace |
| V3-M02-F02 | 导入时自动扫描会话 | 添加已有文件夹后自动触发，不要求重新启动 |
| V3-M02-F03 | 仅同步路径匹配会话 | 不混入其他项目的 Codex Thread |
| V3-M02-F04 | 活跃/归档准确分类 | Codex 归档状态与 OpenDrSai 列表一致 |
| V3-M02-F05 | 增量同步与去重 | 重复添加/刷新不会重复创建会话 |
| V3-M02-F06 | 扫描结果反馈 | 显示活跃数、归档数、跳过数及安全错误摘要 |
| V3-M02-F07 | 手动“重新同步 Codex 会话” | 设置和工作区菜单均可触发，可取消 |

### V3-M03 会话导航与生命周期 UX（6 项）

| 编号 | 功能点 | 用户验收标准 |
| --- | --- | --- |
| V3-M03-F01 | 显式“新建会话”入口 | 工作区右侧不再只有省略号菜单 |
| V3-M03-F02 | Backend 选择与默认值 | 新建时清楚选择 Codex/OpenDrSai，并记住工作区偏好 |
| V3-M03-F03 | 会话来源标签 | 用户能区分 Codex 同步、OpenDrSai 创建和远程会话 |
| V3-M03-F04 | 重命名双向收敛 | 支持范围内同步；不支持时明确标为本地显示名 |
| V3-M03-F05 | 归档/取消归档双向收敛 | 设置页与 Codex 状态一致，失败可重试 |
| V3-M03-F06 | 删除语义保护 | 明确区分“从列表移除”“归档”“永久删除”，默认不破坏 Codex 历史 |

### V3-M04 连续对话与发送可靠性（6 项）

| 编号 | 功能点 | 用户验收标准 |
| --- | --- | --- |
| V3-M04-F01 | 同会话固定 Thread | 连续 20 轮仍只有一个 Codex Thread |
| V3-M04-F02 | 每次发送独立 Turn | 每条用户消息只创建一个 Run/Turn |
| V3-M04-F03 | 发送幂等 Outbox | 双击、超时重试、重启不会重复发送 |
| V3-M04-F04 | 明确发送状态 | 显示排队、已发送、生成中、等待审批、完成、失败 |
| V3-M04-F05 | 停止与重试 | 停止只取消当前 Turn；重试可选择复用会话或分支新会话 |
| V3-M04-F06 | 上下文可见性 | 显示本轮属于哪个会话，并提示上下文是否已恢复 |

### V3-M05 流式与结构化会话体验（6 项）

| 编号 | 功能点 | 用户验收标准 |
| --- | --- | --- |
| V3-M05-F01 | 首字节反馈 | 正常网络下首个状态反馈小于 1 秒，首个模型 Delta 有独立指标 |
| V3-M05-F02 | 无 Delta 终态兜底 | Backend 只返回 completed 时仍显示完整答案一次 |
| V3-M05-F03 | 结构化 Item 完整展示 | 10 类 OAEP Item 均有稳定、安全的 UI |
| V3-M05-F04 | commentary/final 分层 | 过程信息和最终答案视觉上可区分，不丢失 |
| V3-M05-F05 | 长输出性能 | 1 MB 文本与 10k Event 不冻结界面，支持虚拟化 |
| V3-M05-F06 | 未知 Item 降级 | 新 Codex 类型显示 Notice，不出现空白或崩溃 |

### V3-M06 审批、安全提示与用户控制（5 项）

| 编号 | 功能点 | 用户验收标准 |
| --- | --- | --- |
| V3-M06-F01 | 审批卡片说明白 | 显示要做什么、影响哪些文件/命令、风险和来源 |
| V3-M06-F02 | 一次/本会话允许 | 选项语义清楚且严格按范围生效 |
| V3-M06-F03 | 跨端审批收敛 | Desktop/Android 任一端决定后另一端立即更新 |
| V3-M06-F04 | 超时与失效反馈 | 不永久显示等待；可重新发起安全操作 |
| V3-M06-F05 | 操作后结果可追踪 | 用户能从审批卡跳到 Command/File Change/审计结果 |

### V3-M07 连接状态、自愈与诊断（6 项）

| 编号 | 功能点 | 用户验收标准 |
| --- | --- | --- |
| V3-M07-F01 | 分层健康状态 | 区分 Desktop→Runtime、Runtime→Codex、Codex→账号/模型 |
| V3-M07-F02 | 无噪声自动重连 | 短暂中断自动恢复且不重复消息 |
| V3-M07-F03 | 长时间等待看门狗 | 30/60/120 秒提供阶段提示，不把正常长任务误判失败 |
| V3-M07-F04 | 用户可执行错误卡 | 提供检查、登录、重启、重试和切换 Backend 按钮 |
| V3-M07-F05 | 安全诊断包 | 一键导出版本、关联 ID 和脱敏日志，不包含提示词/凭据/绝对隐私路径 |
| V3-M07-F06 | 启动后自动恢复 | Desktop/Runtime/Codex 任一重启后恢复同一会话和游标 |

### V3-M08 本地/远程统一与迁移准备（5 项）

| 编号 | 功能点 | 用户验收标准 |
| --- | --- | --- |
| V3-M08-F01 | Transport 无关 Workspace 操作 | UI 只调用 OWOP，不判断本地路径或 SSH |
| V3-M08-F02 | Transport 无关 OAEP 会话 | 本地和远程使用相同 reducer、cursor 和审批模型 |
| V3-M08-F03 | 能力协商 | 远程 Runtime 缺能力时禁用对应 UI 并说明原因 |
| V3-M08-F04 | 本地到远程迁移提示 | 不错误地把本地 Thread 绑定到远程 Workspace |
| V3-M08-F05 | 远程故障语义预留 | 离线、认证失效、隧道重连与 Codex 故障可区分 |

### V3-M09 安装版质量与用户验收（6 项）

| 编号 | 功能点 | 用户验收标准 |
| --- | --- | --- |
| V3-M09-F01 | 干净 Windows 首装验收 | 无开发环境变量即可完成首次 Codex 对话 |
| V3-M09-F02 | 从当前稳定版升级 | 保留工作区、会话映射、归档和登录状态引用 |
| V3-M09-F03 | 真实历史项目导入 | `drsai` 等已有项目能准确同步活跃/归档会话 |
| V3-M09-F04 | 20 轮真实连续对话 | 一个 Thread、20 个 Turn、无重复/丢失消息 |
| V3-M09-F05 | 故障注入验收 | 覆盖断网、杀 Codex、杀 Runtime、重启 Desktop、cursor expired |
| V3-M09-F06 | 54 项发布账本 | 每项有实现、自动测试、安装版证据和状态；任一失败阻止发布 |

## 5. 实施顺序

### V3-P1：用户能进入可用状态

范围：M01、M03-F01/F02。  
目标：解决“未知版本”“Codex Backend 未安装”“找不到新建会话”等最直接问题。

### V3-P2：已有项目与历史会话可用

范围：M02、M03 其余功能。  
目标：添加已有文件夹后自动获得准确、去重、可归档的历史会话。

### V3-P3：日常连续对话体验

范围：M04、M05、M06。  
目标：连续对话、流式结构化输出、审批和停止/重试达到用户可长期使用水平。

### V3-P4：自愈与远程准备

范围：M07、M08。  
目标：故障可理解、可自助恢复；本地实现不阻碍未来远程 Linux Codex。

### V3-P5：安装版发布收口

范围：M09。  
目标：开发环境通过之外，干净安装、升级、真实历史与故障注入全部形成证据。

## 6. 测试与验证方案

### 6.1 用户旅程自动化

至少建立以下端到端旅程：

1. 首次启动 → 自动发现 Codex → 登录状态检查 → 新建会话 → 收到流式答案。
2. 添加已有 `drsai` 文件夹 → 同步活跃会话 → 打开历史 → 继续同 Thread 对话。
3. 打开设置 → 查看归档 → 取消归档 → 工作区列表出现 → 再次归档。
4. 连续发送 20 轮 → 验证一个 Thread、20 个 Turn、20 条用户消息各自唯一。
5. 命令审批 → Desktop 批准 → Android 收敛 → 结果卡可追踪。
6. 输出中杀死 Codex → 自动重启 → 同 Turn 确定失败或恢复，不产生幽灵消息。
7. 输出中重启 Desktop → snapshot+replay 恢复 → 最终结果与未重启基线一致。

### 6.2 分层测试

- 单元测试：路径发现、状态投影、会话去重、归档映射、Outbox、错误动作。
- Runtime 集成：Workspace→Session→Thread、20 Turn、多 generation、审批、恢复。
- Desktop 组件测试：新建入口、状态徽标、流式卡片、错误卡、归档设置。
- Android/Relay 契约：不解析 Codex 私有字段，严格使用 OAEP/OWOP。
- 安装版 E2E：使用真实安装包、真实 Codex Desktop 登录态，不设置开发环境变量。
- 可用性测试：邀请不了解 Runtime/Codex CLI 的用户按屏幕文字完成首次对话。

### 6.3 性能指标

- 应用启动后 3 秒内给出 Backend 初步状态。
- 添加普通工作区 2 秒内显示扫描进度，后台同步不阻塞 UI。
- OAEP 10k Event 重放期间 UI 可交互。
- 1 MB 消息滚动和增量更新不产生明显卡顿。
- 短暂断线恢复后零重复消息、零重复 Run。

### 6.4 发布门禁

发布聚合器必须 fail closed，并至少验证：

- 54/54 功能点为 accepted；
- Windows 干净安装和稳定版升级均通过；
- 真实 Codex 三轮和 20 轮测试通过；
- 历史会话活跃/归档分类人工抽样与机器结果一致；
- Desktop、Android、Relay OAEP/OWOP 契约无漂移；
- 诊断证据通过 Secret canary 和路径隐私扫描。

## 7. 不在本阶段范围

- 不重写 Codex app-server。
- 不让 Desktop 直连 Codex app-server。
- 不为远程 Linux 再实现一套 Codex Adapter。
- 不将 SSH 固化为本地 Workspace 的必经传输。
- 不把 Codex 的内部 Thread/Turn 数据直接暴露给普通用户。
- 不删除 V2 的 Legacy 只读投影，除非生产遥测满足单独移除门禁。

## 8. 完成定义

V3 只有在以下条件全部满足时完成：

- 54/54 功能点 accepted；
- 小白用户无需配置环境变量即可使用本机 Codex；
- 添加已有项目能准确同步活跃与归档会话；
- 工作区有显式新建会话入口；
- 连续 20 轮保持一个 Codex Thread；
- 流式、结构化输出、审批、停止、重试和恢复均可从 UI 理解并操作；
- Windows 安装版和升级版真实验收通过；
- 本地实现继续遵守 OAEP/OWOP，未来远程 Linux 只替换 Transport 与部署位置。
