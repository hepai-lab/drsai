# OpenDrSai 回归测试 P3 开发方案：真实 Desktop 端到端验收

## 1. 定位与背景

P1 建立了 12 个代表性任务、Case/Suite、Gateway Runtime 执行器、证据收集和断言框架；P2 验证了智增增 Provider 下绑定模型的能力与路由。P3 不重复这两层，而是验证用户真正使用的路径：启动开发版 Desktop，在聊天栏发送任务，Agent 选择模型和工具、完成工作、在 UI 中显示可理解结果，并留下可审计的截图和运行证据。

P3 的直接动因是：模型能力探针与 Gateway API 冒烟可以通过，但 Desktop Agent 仍可能因工具面、协议兼容、UTF-8 输入、运行时状态、错误映射或 UI 投影而失败。P3 以真实用户体验为准，不允许用 API 成功替代 Desktop 成功。

## 2. 总体目标

在 OpenDrSai-Dev 中逐一完成首批 12 个典型任务，并对每项形成以下闭环：

1. 自动启动或重启到当前工作树对应的 Desktop 与 Gateway；
2. 通过可审计的 Desktop UI 自动化聚焦聊天栏、输入任务并发送；自动化传输层可使用 Computer Use、Windows 原生 UI Automation/SendInput 或 Electron E2E/Playwright；
3. 监测 Run、UI 状态、诊断事件和产物；
4. 成功时保存 UI 截图、Run/Manifest/OAEP 摘要和断言结果；
5. 失败时保留安全脱敏诊断，定位到模型、路由、工具、策略、Runtime 或 UI 层；
6. 修复代码并补自动化测试，再从真实 Desktop 重跑该案例；
7. 12 项均满足业务断言、产品可用性断言和视觉可见性断言后，生成 P3 验收报告。

完成标准不是“模型返回任意文本”，而是“用户在聊天栏得到正确、可理解、可操作的结果”。

## 3. P3 范围

### 3.1 12 个案例

| ID | 代表任务 | P3 UI 验收重点 |
|---|---|---|
| `qa.greeting.hello` | 自然问候 | 不滥用工具；正常流式回答 |
| `qa.constraints.json` | 受约束 JSON 输出 | UI 中内容完整、可解析且无额外文字 |
| `tool.web.hepix` | 搜索并引用 HEPiX 2026 | 正确检索工具、可点击引用、来源可交互 |
| `tool.failure.recovery` | 首次工具失败后的恢复 | 明确进度与恢复结果；不泄露内部异常 |
| `knowledge.grounded` | 固定知识库问答 | 知识工具证据、引用和答案一致 |
| `knowledge.absent` | 知识缺失 | 明确说明不足，不编造来源 |
| `skill.presentation` | 创建演示文稿 | Skill 流程、可打开 PPTX、结果卡片和截图 |
| `image.input.ui_error` | 分析错误截图 | 附件上传可见、图像理解正确、无幻觉 |
| `image.output.simple` | 生成简单图片 | 图片产物可在 UI 预览或打开 |
| `workspace.readonly.diagnose` | 探索并诊断当前工作区 | 实际调用只读工作区工具；答案有文件证据 |
| `safety.write_approval` | 需审批写操作 | 审批前无副作用；审批 UI 清晰；完成一次 |
| `run.inspect_compare` | 检查并比较两个 Run | Run ID、差异和可导航检查证据正确 |

### 3.2 不在 P3 内的事项

- 不重写 P1 Case Schema、P2 Provider 探针或模型目录；P3 只补充其 Desktop 适配和验收证据。
- 不把真实 Desktop UI 操作替换成仅 HTTP/Gateway 调用。HTTP 可作诊断通道，不能作最终 UI 证据。
- 不以隐藏思维链、明文密钥、完整上游响应或私人工作区内容作为证据。

## 4. 解决方案

```text
P3 Case + 隔离/受控数据
  -> Desktop Dev Launcher
  -> Desktop UI Automation: 定位聊天、输入、发送、等待、截图
  -> Desktop UI / Runtime Run
  -> Run Monitor: UI 状态 + Gateway events + Manifest + OAEP
  -> Assertions: 业务 + 工具/安全 + UX + 截图
  -> 成功证据包 | 失败诊断包
  -> 修复 + 单元/集成测试 + 重启 Desktop + 原 UI Case 重跑
```

### 4.1 Desktop 控制与启动

新增 `DesktopDevController`，统一处理：

- 调用 Windows 开发启动脚本，确认 Gateway 由当前工作树启动；
- 健康检查、实例 Token 获取和旧进程受控关闭；
- 等待 Electron 主窗口、目标聊天窗口和 Gateway 均就绪；
- 为每次 P3 Run 生成关联 ID，避免将旧会话状态误判为新结果；
- 失败时收集日志尾部和进程/端口元信息（全部脱敏）。

Windows 上 Gateway 无热重载；代码变更后 P3 必须使用受控重启，禁止继续验证旧 Python 进程。

### 4.2 Desktop UI 自动化适配器

新增 `DesktopUiAutomationAdapter`，封装可恢复的真实 Desktop UI 操作，并将具体控制方式作为可替换 Transport：

- `computer_use`：优先使用已安装的 Computer Use 运行时（当前实现为 `@oai/sky`）；
- `windows_native`：使用窗口句柄/PID 绑定、UI Automation、SendInput、剪贴板 UTF-8 输入和 Windows 屏幕捕获；
- `electron_e2e`：使用 Electron E2E/Playwright 连接真实 Electron 窗口，通过 DOM/可访问性定位聊天控件并截图；
- Transport 按可用性和稳定性选择，不把某个插件或包作为 P3 业务验收的硬依赖；每次 Run 必须记录实际 Transport 名称、版本和能力限制。

所有 Transport 统一满足：

- 绑定 OpenDrSai Desktop 窗口，发现/激活聊天输入框；
- UTF-8 粘贴或键盘输入，禁止依赖 PowerShell 控制台编码；
- 发送、等待流结束、处理审批弹窗和保存 UI 截图；
- 用可访问性树优先定位元素，坐标仅作受控后备；
- 每一步保存时间戳、截图路径、目标元素和重试次数；
- 发生窗口丢失、输入框不可用或发送未生效时，给出 `desktop_ui_*` 稳定错误码。

单个 Transport 初始化或权限不可用时，Runner 应记录 `desktop_automation_transport_unavailable` 并尝试下一个已配置 Transport；只有全部真实 UI Transport 都不可用时，P3 才显式失败为 `desktop_automation_unavailable`。任何情况下均不得把 Gateway API 结果冒充 UI 验收。

Transport 切换后仍必须操作同一个 OpenDrSai-Dev 实例或按受控流程重启的新实例。仅调用 renderer 内部业务函数、直接注入 Gateway 请求、写数据库或伪造 DOM 状态不属于 UI 验收。发送成功必须同时由输入前后 UI 状态变化、用户消息可见性和关联 Run 三项证明；仅执行键盘事件不算成功。

### 4.3 Run 与 UI 关联

Desktop 发送前创建/记录关联标记，Runner 从 Gateway 的会话、Run、OAEP 和 Manifest 解析对应 Run。关联必须同时匹配会话、时间窗口、输入摘要和客户端来源，禁止只依赖“最近一条 Run”。

每项案例的通过至少需要：

- Desktop UI 显示终态成功或规定的受控限制结果；
- 关联 Run 的状态、模型快照、工具/审批/产物事件符合预期；
- UI 截图可见用户输入、最终回复/产物/审批结果及没有错误横幅；
- 该 Case 既有 P1 断言继续通过，也有 P3 的用户体验断言通过。

### 4.4 错误分类与用户体验

Gateway 和 Desktop 统一映射下列错误，不再把本地策略、工具适配或 UI 错误显示成“模型服务暂不可用”：

- `model_*`：认证、配额、Provider/协议真实失败；
- `tool_*`：工具未配置、调用失败、结果无效、恢复失败；
- `verification_*`：需要来源/检索但缺少匹配能力或模型未正确调用；
- `workspace_*`：只读/写入权限、路径和工作区工具适配；
- `desktop_ui_*`：输入、发送、窗口、审批或投影失败；
- `artifact_*`：生成、发布、打开或渲染失败。

用户可见消息必须说明下一步，例如“当前工作区未连接”“检索工具未启用”或“请批准写入”，且诊断面板保留稳定 code 和关联 ID。

## 5. 需要实现、更新或移除的模块

| 模块 | 动作 | 目标 |
|---|---|---|
| `eval/regression` | 新增 | P3 Suite、Desktop Runner、UI 断言、截图证据和报告器 |
| `apps/desktop/windows/scripts/dev.ps1` | 更新 | 可查询、可重启、可验证当前源码 Gateway 的开发控制接口 |
| Desktop 主进程/共享聊天层 | 更新 | 暴露稳定会话/Run 关联及用户可见错误映射 |
| `backend/gateway.py` 与 Runtime adapter | 更新 | 透传策略/工具错误，支持关联元数据与诊断查询 |
| Desktop Agent/Kernel adapter | 更新 | 模型可见工具面与可执行工具面一致；工具协议兼容 Provider |
| 工作区工具 | 完善 | `run_glob`、`run_grep`、`run_read` 在 Desktop 只读探索中可用且受工作区约束 |
| Web/Knowledge/Skill/Image/Approval adapter | 完善 | 12 个任务所需真实能力均有 UI 可见完成路径 |
| 旧的泛化错误回退 | 移除/收紧 | 禁止把已知本地错误压平为 `upstream_unavailable` |

## 6. 功能点、测试与验收

| 功能点 | 自动化测试 | P3 验收 |
|---|---|---|
| Dev 启动/重启 | 进程、端口、源码路径、健康检查测试 | Desktop 打开并连到当前源码 Gateway |
| Desktop UI 自动化聊天 | 各 Transport 的窗口/元素发现、UTF-8 输入、发送、等待、切换和失败分类测试 | 截图证明消息由聊天栏发送，非 API 伪造；证据注明 Transport |
| Run 关联 | 多会话并发、旧 Run、重试 Run 测试 | 截图与唯一 Run/Manifest 对得上 |
| 截图证据 | 文件存在、尺寸、Hash、敏感区检查 | 每个成功 Case 至少一张可人工阅读截图 |
| 工作区探索 | 工具快照、权限、中文意图、Provider 工具兼容测试 | `workspace.readonly.diagnose` 有真实只读工具事件和文件依据 |
| 检索与引用 | 受控检索、链接/引用投影测试 | HEPiX Case 的引用在 Desktop 可点击/交互 |
| 工具失败恢复 | 故障注入、有限重试、用户提示测试 | 不显示假模型错误，最终结果易理解 |
| 知识库正/负例 | 文档版本、召回、无证据拒答测试 | UI 显示依据或明确不足 |
| PPTX/图片 | 文件/媒体可打开与渲染测试 | UI 产物卡片和实际预览截图 |
| 审批 | 前后副作用、幂等、取消测试 | 审批提示、结果和副作用次数正确 |
| Run 检查比较 | 方向、ID、差异项测试 | UI 可导航到正确 Run/差异 |
| 失败呈现 | 错误分类及本地化消息测试 | 用户看到可执行下一步，而不是内部术语 |

## 7. 执行节奏与通过门槛

### 阶段 A：P3 基础设施

完成 Desktop 启动控制、至少一个真实 UI Automation Transport、Transport 切换、关联、截图和 P3 报告。验收：`qa.greeting.hello` 与 `qa.constraints.json` 能在 UI 自动通过并保存截图。

### 阶段 B：只读和检索能力

完成工作区、Web 和知识库链路。验收：`tool.web.hepix`、`tool.failure.recovery`、两个 Knowledge Case 和 `workspace.readonly.diagnose` 通过。

### 阶段 C：产物、多模态与安全

完成 Presentation、图片、审批与 Run Comparison。验收：所有产物可打开/预览，审批和 Run 比较可交互。

### 阶段 D：完整回归与可用性审计

从干净启动执行 12 项；每项要求一次成功的 UI Run、P1 行为断言、P3 UX 断言、截图和可追溯证据。失败不允许跳过或以 API 结果替代。

## 8. 产物与目录建议

```text
eval/regression/
  desktop_p3/
    suites/p3-desktop.yaml
    scenarios/<case-id>.yaml
    evidence/<timestamp>/<case-id>/ui-final.png
    evidence/<timestamp>/<case-id>/run-summary.json
    reports/p3-desktop-acceptance.md
docs/development/
  opendrsai-agent-regression-testing-p3-development-plan.md
  opendrsai-agent-regression-testing-p3-progress.md
  opendrsai-agent-regression-testing-p3-real-acceptance.md
```

截图为验收资产，应压缩到可读且不过大的 PNG；报告只引用路径、Hash、Run ID 和脱敏摘要。

## 9. 风险与约束

- 真实 Desktop UI 可控性、窗口焦点和可验证截图是 P3 的硬依赖；Computer Use、`@oai/sky` 或任一单独 Transport 不是硬依赖。一个 Transport 不可用时允许切换，但必须记录失败原因与实际采用的 Transport。
- Windows 原生坐标点击只允许作为窗口句柄绑定后的受控后备方案；优先使用 UI Automation、DOM 或可访问性定位。坐标操作必须在操作前后截图，并验证目标窗口 PID、输入可见性和发送结果。
- 外部 Web 与 Provider 不稳定性必须与产品回归分开记录；但用户可见错误与工具缺失仍属于产品问题。
- 不得用无限重试掩盖缺陷；每种可重试错误都有上限、退避和可见状态。
- 真实工作区案例仅使用指定的只读受控目录；写入案例只在隔离工作区并经审批执行。

## 10. Definition of Done

P3 完成需要同时满足：

1. OpenDrSai-Dev 可由自动化启动/重启并确认使用当前源码；
2. 可审计的真实 Desktop UI 自动化实际在聊天栏逐项发送 12 个任务，并为每项记录所用 Transport；
3. 12 项均通过业务、行为、用户体验和截图断言；
4. 每项均有正确关联的 Run、Manifest、OAEP/事件摘要和 UI 截图；
5. 所有失败均有稳定分类、可理解提示和修复后的真实 UI 重跑；
6. 全量 P3 报告和 12 项证据包写入规定目录；
7. 相关单元、集成、P1/P2 门禁和 P3 Desktop Suite 全部通过。

## 11. Windows Sandbox 纯净环境（P3 强制验收环境）

P3 的最终验收必须在 Windows Sandbox 中完成。宿主机仅用于编写代码、运行静态/单元测试和生成 Sandbox 配置；宿主机上的 Desktop 进程、`DRSAI_HOME`、浏览器 cookie、OIDC 会话、缓存、模型配置、端口占用和历史证据一律不得作为 P3 验收证据。

### 11.1 环境边界

- 每一轮正式 P3 回归启动一个新的 Windows Sandbox；Sandbox 关闭即销毁其本机磁盘、用户数据和登录态。
- 宿主机必须先从当前工作树构建 Runtime 与 MSI，并记录 Git 提交、工作树摘要、Runtime SHA-256、MSI SHA-256 和 Runtime manifest；Sandbox 只读映射这组本轮新生成的安装产物为 `C:\OpenDrSaiPackage`。这既保证运行的是最新源码，又避免在纯净 Sandbox 内下载/安装开发依赖而引入不稳定性。
- 仅将宿主机的 `tmp\eval-results\p3-sandbox` 以可写方式映射为 `C:\P3\evidence`。该目录只接收脱敏后的报告、截图、Run/Manifest/OAEP 摘要和日志尾部，不接收令牌、cookie、完整模型响应或用户工作区内容。
- Sandbox 内使用独立 `C:\P3\profile`、独立 Electron user-data 和固定 Gateway 端口 `28643`。测试前验证该目录不存在宿主机挂载路径，测试结束后只保留证据目录。
- 允许在该受控 Sandbox 的浏览器中由用户完成 HepAI/OIDC 登录；登录只用于当前 Sandbox 实例，测试脚本不得复制、读取、导出或复用认证材料。

### 11.2 启动与执行协议

1. 宿主机执行 `apps/desktop/windows/scripts/start-p3-windows-sandbox.ps1`，生成并启动 `.wsb` 配置。
2. Sandbox 登录命令从 `C:\OpenDrSaiPackage` 安装本轮 MSI；安装器仅可读取同目录的本轮 Runtime，不得访问发布站或宿主开发环境。安装后启动该已安装 Desktop，并使用独立 `C:\P3\profile`。
3. 用户在 Sandbox 中完成登录后，Runner 只对该 Sandbox 中可见的 Desktop 窗口执行聊天操作；不得将 Gateway/HTTP 调用冒充 UI 操作。
4. 每个 Case 采集 UI 截图和关联 Runtime 摘要，写入映射证据目录；如 Sandbox 被关闭、登录失效或窗口不可见，记录稳定的 `desktop_ui_sandbox_*` 失败码，而非回退到宿主机。
5. 12 项 Case 全部在同一个新建 Sandbox 中完成后，关闭 Sandbox；下一次正式全量回归必须新建 Sandbox，不得复用该实例。

### 11.3 Sandbox 验收附加门槛

除第 10 节外，最终报告还必须包含 Sandbox 实例标识、启动时间、源树提交/摘要、Sandbox 内 `DRSAI_HOME` 路径、传输方式、证据目录和“未复用宿主机会话”的断言。缺失任一项时，Case 仅能标为 `inconclusive`，不能标为通过。
### 11.4 Developer-mode model regression (authorized iteration path)

For repeatable P3 iteration, a developer identity may be created only by clicking the visible `developer-workspace-login` control in the installed Desktop. The runner must record `authMode=developer_bypass`; it must not label that identity as an OIDC sign-in.

When the user authorizes use of a locally saved model Provider, the host may resolve the Provider credential only into a newly created, read-only, temporary Sandbox mapping. The Sandbox copies that configuration to its isolated `C:\P3\profile` before launch. Provider secrets, tokens, raw responses, and the private staging directory must never enter the evidence mapping or reports; the staging directory is removed after the Sandbox closes. A configuration that names models but has no decryptable credential is a blocking `model_provider_credential_unavailable` result, not a substitute pass.
