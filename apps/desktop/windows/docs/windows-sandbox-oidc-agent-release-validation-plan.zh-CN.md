# Windows Sandbox：OIDC 登录与本地智能体发布验收方案

## 1. 背景与目标

当前已出现真实用户故障：在一台新的 Windows 11 x64 电脑上安装已发布客户端，HepAI OIDC 登录成功，但本地 OpenDrSai 智能体未正确配置，无法发送消息。

本方案的目标是建立发布前的强制验收闭环：

1. 在完全干净的 Windows 11 Sandbox 中复现用户的实际下载、安装、登录和聊天路径。
2. 在 Sandbox 关闭前自动收集足以定位问题的安装、配置、认证、Gateway、模型和系统证据。
3. 修复首次启动初始化、配置迁移和运行时日志缺陷。
4. 对修复候选包执行全新安装、升级、重启和故障注入测试。
5. 只有真实 OIDC 登录和真实模型回复均通过，才允许发布或更新稳定频道。

不以开发机可运行、Fake Gateway、注入假认证、单元测试通过作为发布验收的替代。

## 2. 当前证据与根因假设

### 2.1 已确认事实

- 桌面端认证文件位于 `%USERPROFILE%\.drsai\auth\auth.json`。
- OpenDrSai 用户配置位于 `%USERPROFILE%\.drsai`。
- 主进程诊断目录为 `%USERPROFILE%\.drsai\desktop\diagnostics`。
- 智能体遥测位于 `%USERPROFILE%\.drsai\logs\agent-telemetry.jsonl`。
- 安装器日志位于 `C:\ProgramData\OpenDrSai\Installer\logs`。
- 安装状态位于 `C:\Program Files\OpenDrSai\install-state.json`。
- 聊天逻辑在找不到当前智能体时会报错 `No current Agent is configured.`。
- 调研时线上基线 Runtime ZIP 包含旧格式 `drsai-home\config.yaml`，其内容使用 `provider: anthropic` 和 HepAI Anthropic URL；具体基线版本必须在每轮验收中从频道 manifest 解析，不得硬编码。
- Runtime 打包脚本未显式指定默认配置目录时，会从构建机临时 `.drsai` 目录复制 `.env` 和 `config.yaml`，发布内容因此不是完全由版本库确定。
- 持久化 Gateway 进程目前使用忽略标准输出和标准错误的方式启动，部分启动失败无法留下有效日志。

### 2.2 高置信度根因候选

首次安装把旧格式 `config.yaml` 当作种子配置。Python 配置迁移可能将其转换为 `legacy-anthropic` Provider，并要求 `ANTHROPIC_API_KEY`，而不是使用 OIDC 的 `hepai` Provider；同时首次启动没有可靠地生成并绑定 `opendrsai` 默认智能体。结果是“登录成功”与“本地智能体可聊天”之间出现断层。

该结论必须由 Sandbox 中导出的实际 `config.toml`、智能体配置、Gateway 状态和模型状态完成证据闭环，不能只根据源码推断。

## 3. 验收原则

### 3.1 两条测试线

| 测试线 | 输入 | 目的 |
| --- | --- | --- |
| A：线上已发布版复现 | 开发站实际下载入口及其最终 CDN 文件 | 重现真实用户故障，确认故障层级和实际根因 |
| B：本地修复候选版 | 只读映射到 Sandbox 的新 MSI/Runtime 包 | 验证修复并阻止问题再次发布 |

测试线 A 必须先执行并保留证据。测试线 B 通过后，还要把候选包上传到预发布频道，再从网络重新执行一次，避免“本地包正确、线上对象错误”。

### 3.2 干净环境要求

- 使用 Windows 11 主机自带 Windows Sandbox，不复用以前的 Sandbox 状态。
- Sandbox 内不得预装 Node.js、Python、Git 或开发版 OpenDrSai。
- 不注入开发机的 `%USERPROFILE%\.drsai`。
- 不注入 API Key，不设置旧 API Key 兜底环境变量。
- Sandbox 内由应用申请设备码并轮询；用户只在宿主机可信浏览器中登录并明确批准，不复制密码、Cookie 或 Token。
- 网络使用 Sandbox 自身网络；`localhost` 指向 Sandbox，不指向宿主机代理。
- 输入目录只读映射，证据目录可写映射。
- 每次验收使用独立 `runId`，例如 `20260810-153000-v157-online`。

## 4. Sandbox 生命周期标准流程

统一使用：

`apps/desktop/windows/scripts/windows-sandbox-session.ps1`

禁止直接结束 `WindowsSandboxServer.exe`、`vmcompute`、HNS 等系统进程。

### 4.1 启动前

1. 执行 `Diagnose`，确认 Sandbox 功能、虚拟化、相关服务和磁盘空间正常。
2. 执行 `List`，以 `wsb list` 返回的会话 ID 为唯一事实来源。
3. 如有旧会话，按会话 ID 正常停止并确认消失。
4. 校验 `.wsb` 文件为合法 XML，所有 HostFolder 均存在。
5. 创建空的宿主机证据目录：

```text
artifacts/sandbox/<runId>/
```

### 4.2 运行中

- 不关闭 Sandbox，直到证据清单和 `acceptance-result.json` 已复制到宿主机。
- 人工只负责在宿主机浏览器完成 OIDC 登录和设备授权同意，以及确认必要界面现象。
- 其余下载、哈希、安装、状态采集和日志导出由脚本完成。

### 4.3 关闭

1. Guest 内先正常退出 OpenDrSai。
2. Guest 内执行正常关机。
3. 宿主机轮询会话 ID 是否消失。
4. 超时后才使用会话脚本的 `Stop -Id <id>`。
5. 只有正常停止继续超时，才允许使用文档规定的强制关闭手段。

详细生命周期约束以 `WINDOWS_SANDBOX_OPERATIONS.md` 为准。

## 5. 单次端到端验收步骤

### 阶段 0：生成测试清单

在宿主机生成 `run-manifest.json`，至少记录：

- `runId`、开始时间、测试线 A/B；
- Windows 主机版本和 Sandbox 版本；
- 期望应用版本、架构、频道；
- 下载入口 URL、最终跳转 URL；
- MSI、Runtime ZIP、Android/Mac 资产不参与本轮时的明确说明；
- 文件长度、SHA-256、签名状态；
- Git commit、工作树状态和构建命令（测试线 B）。

### 阶段 1：验证真实下载链路

测试线 A 必须在 Sandbox 内从开发站所使用的实际入口获取 Windows 下载信息，不得由宿主机手工复制线上 MSI 冒充用户下载。

保存以下证据：

- 下载接口响应的脱敏副本；
- HTTP 跳转链、状态码、Content-Length、Content-Type、ETag；
- 下载后的文件名、长度、SHA-256；
- Authenticode 签名结果；
- 下载耗时和平均速度。

检查线上命名必须符合：

- `OpenDrSai-Windows-Installer-x64.msi`
- `OpenDrSai-Windows-v{version}-x64.zip`

若下载入口返回错误版本、错误对象或哈希不符，立即判为“发布链路故障”，不要继续把后续安装错误误判为应用故障。

### 阶段 2：安装

1. 以普通用户双击 MSI，保留管理员权限申请路径。
2. 记录安装器每个阶段：连接、下载、校验、提取、安装、完成。
3. 记录下载速度、下载进度以及阶段进度是否真实变化。
4. 同时生成详细 MSI 日志。
5. 验证：
   - `C:\Program Files\OpenDrSai` 存在；
   - 主程序和 Setup 位于预期目录；
   - 开始菜单存在 OpenDrSai；
   - `install-state.json` 的版本、Runtime URL、长度和哈希正确；
   - 安装器日志完整；
   - Runtime 自带 Python 和必要模块可用。

任何安装失败都应先导出 MSI 日志、安装器日志、事件日志、下载文件哈希，再关闭提示框或 Sandbox。

### 阶段 3：首次启动、登录前快照

首次启动后、点击登录前采集：

- OpenDrSai、Gateway、Python 相关进程及命令行的脱敏摘要；
- Gateway 监听端口和进程 PID；
- `%USERPROFILE%\.drsai` 文件树，仅记录路径、长度、修改时间和哈希；
- `config.toml`、`config.yaml`、默认智能体文件的脱敏内容；
- Gateway 健康状态和诊断码；
- UI 截图。

此时重点确认首次启动是否已经确定性生成：

- 当前智能体：`opendrsai`；
- 智能体配置：`configs/agents/agent_opendrsai.toml`；
- Provider：`hepai`；
- 认证模式：OIDC；
- `requires_api_key = false`；
- 不存在 `legacy-anthropic`、`ANTHROPIC_API_KEY` 等新安装依赖。

### 阶段 4：真实 OIDC 登录

Sandbox 内 OpenDrSai 发起 Device Authorization Grant，宿主机只接收经校验的 HTTPS 验证地址并打开可信浏览器；用户在宿主机完成 HepAI 登录和明确批准。自动化程序不得把 access token、refresh token、device code、user code、授权码或 Cookie 写入证据目录。

登录后只记录：

- 认证文件是否存在、ACL 是否合理；
- issuer、client ID、subject 的不可逆短哈希；
- token 是否存在、到期时间和 scope 名称；
- OIDC discovery/JWKS 是否可达；
- 登录完成时间和应用状态变化。

如诊断必须调用本地受保护接口，脚本只在内存中读取 token，请求结束后立即释放；输出中仅保留状态码、耗时和脱敏响应摘要。

### 阶段 5：登录后的本地智能体与模型验证

登录完成后，按顺序验证：

1. Gateway 进入 `ready`，且不是外部端口冲突实例。
2. OIDC access token 已同步到 Gateway 使用路径。
3. 当前智能体仍为 `opendrsai`，智能体配置文件可读取。
4. 有效 Provider 为 `hepai`，认证模式为 OIDC，不要求 API Key。
5. 模型目录请求使用 `Authorization: Bearer <OIDC access token>`。
6. `/v1/models` 返回非空模型列表。
7. 当前模型在可用模型列表中；如果默认模型不可用，使用确定性回退规则选取一个 HepAI 可用模型并持久化。
8. UI 不出现“缺少 api-key”“本地智能体未配置”或泛化的“聊天失败”提示。

诊断脚本应通过应用内部的脱敏诊断 IPC 获取状态；在该 IPC 尚未实现前，可在 Guest 内临时读取 instance token 和 OIDC token 并只在内存中发请求，严禁导出原始 token。

### 阶段 6：真实聊天

发送带 `runId` 的唯一消息，例如：

```text
SANDBOX-E2E-20260810-153000：请只回复 READY-20260810-153000
```

通过条件：

- 请求成功发出；
- 120 秒内收到非空回复；
- 回复与本轮会话关联；
- Gateway 和 Agent 遥测中能用同一 `runId` 关联请求；
- 没有 API Key 兜底；
- 没有把 access token 或用户隐私写入日志。

### 阶段 7：重启与持久化

1. 正常关闭 OpenDrSai，不关闭 Sandbox。
2. 从开始菜单重新打开。
3. 确认仍保持登录状态。
4. 确认当前智能体、Provider 和模型保持有效。
5. 发送 `重启后测试-<runId>` 并收到回复。
6. 验证 Gateway 无孤儿进程，端口和 PID 状态一致。

### 阶段 8：导出证据与关机

运行证据收集器并生成：

```text
artifacts/sandbox/<runId>/
  run-manifest.json
  acceptance-result.json
  screenshots/
  installer/
  app/
  gateway/
  agent/
  config-sanitized/
  network/
  windows-events/
  checksums.txt
  summary.md
```

`acceptance-result.json` 必须包含每个检查项的 `PASS/FAIL/SKIP`、时间、证据路径和失败诊断码。只有完成复制和哈希校验后才能关闭 Sandbox。

## 6. 错误捕获设计

### 6.1 全链路关联

所有日志、状态快照和聊天测试统一携带：

- `runId`：单次 Sandbox 验收；
- `launchId`：单次应用启动；
- `requestId`：单次模型请求。

日志采用带时间戳的 JSON Lines。错误至少包含阶段、组件、错误码、可操作说明和根异常链，但不得包含 token、Cookie、密码、完整个人标识或 API Key。

### 6.2 必须补齐的日志

1. **安装器日志**：下载 URL、HTTP 状态、字节进度、速度、校验、提取和子进程退出码。
2. **主进程日志**：首次启动状态机、配置初始化、认证状态变化、Gateway 启停、IPC 错误。
3. **Gateway 持久日志**：当前持久化模式不得丢弃 stdout/stderr；应写入 `%USERPROFILE%\.drsai\logs\gateway-YYYYMMDD.log`，限制大小并轮转。
4. **Agent 遥测**：选中的智能体、Provider、模型、请求阶段、HTTP 状态和耗时。
5. **配置诊断快照**：只输出有效配置的脱敏摘要，不输出秘密值。
6. **Windows 证据**：Application、Windows Installer、Code Integrity/Defender 相关事件，进程和监听端口。

### 6.3 一键支持包

桌面端增加“导出诊断包”能力，生成 ZIP 前执行强制脱敏：

- 删除 access token、refresh token、Authorization、Cookie、API Key；
- 用户名和 subject 只保留不可逆短哈希；
- 文件路径中的用户名替换为 `%USERPROFILE%`；
- 配置中的 secret 字段只保留“是否存在”；
- ZIP 内禁止包含原始 `auth.json` 和 `.env`。

导出后运行二次秘密扫描；扫描失败则不生成支持包。

## 7. 故障分类、证据和修复方向

| 故障层 | 典型现象 | 必须证据 | 修复模块 |
| --- | --- | --- | --- |
| 发布链路 | 页面下载到旧包、文件损坏 | URL 跳转、ETag、长度、SHA-256 | Release manifest、OSS/CDN、开发站下载接口 |
| MSI 安装 | 1603、自定义动作失败、一直停在校验 | MSI verbose log、安装器日志、事件日志 | Bootstrapper/MSI Custom Action |
| 首次配置 | 当前智能体为空、迁移成 legacy Provider | 安装前后配置快照、迁移日志 | Runtime 打包、Python config migration、first-run bootstrap |
| OIDC | 登录回调失败、token 无效 | discovery/JWKS 状态、脱敏 claims、回调日志 | Desktop auth、URL protocol |
| Gateway | 未启动、端口冲突、反复退出 | Gateway 文件日志、PID、端口、health | Desktop gateway supervisor、Python Gateway |
| 模型目录 | `/v1/models` 401/403/空列表 | 状态码、脱敏响应、token 到期信息 | Gateway OIDC headers、HepAI Provider |
| 聊天 | 泛化“聊天失败”、无回复 | requestId 全链路日志、HTTP/异常链 | Desktop chat、Agent、Provider adapter |
| 重启持久化 | 登录或智能体状态丢失 | 重启前后配置哈希、auth 状态、PID | Auth store、atomic config writes、startup repair |

UI 不应只显示“聊天失败，请稍后再试”。至少映射为稳定诊断码，例如：

- `AGENT_NOT_CONFIGURED`
- `PROVIDER_NOT_CONFIGURED`
- `OIDC_TOKEN_MISSING_OR_EXPIRED`
- `MODEL_CATALOG_UNAVAILABLE`
- `MODEL_NOT_AVAILABLE`
- `GATEWAY_NOT_READY`
- `GATEWAY_PORT_CONFLICT`
- `UPSTREAM_UNAUTHORIZED`
- `UPSTREAM_UNAVAILABLE`

用户界面提供可操作说明和“导出诊断包”，日志保留底层异常链。

## 8. 修复实施方案

### 8.1 确定性的 Runtime 默认配置

- 在版本库中建立唯一的 Runtime 默认配置源，不再从构建机临时 `.drsai` 目录复制文件。
- 新安装包不再携带旧格式 `config.yaml` 作为种子配置。
- 默认紧凑配置必须明确：
  - `current_agent = "opendrsai"`；
  - `provider = "hepai"`；
  - `auth_mode = "oidc"`；
  - `requires_api_key = false`；
  - 默认模型来自 HepAI 可用目录或采用明确回退规则。
- 包内必须包含 `configs/agents/agent_opendrsai.toml`。
- 包内不得包含开发者路径、真实 `.env`、API Key 或个人配置。

### 8.2 首次启动初始化与自修复

实现幂等的 first-run bootstrap：

1. 仅在全新或未配置的用户目录中创建默认智能体和 HepAI Provider。
2. 对已有用户自定义智能体、Provider 和模型不做覆盖。
3. 发现“登录成功但智能体为空”时，安全补建默认智能体并记录修复事件。
4. 配置写入使用临时文件加原子替换，失败时保留旧配置。
5. 配置迁移前自动备份；迁移失败回滚并显示明确诊断码。

### 8.3 登录后的状态协调

将以下过程变为可观测状态机：

```text
OIDC authenticated
  -> token synchronized
  -> Gateway ready
  -> agent resolved
  -> provider resolved
  -> model catalog loaded
  -> current model validated
  -> chat ready
```

任一步失败都返回对应诊断码，不进入“看似登录成功但不可聊天”的半就绪状态。

### 8.4 Gateway 可观测性

- 持久 Gateway 的 stdout/stderr 写入轮转日志，而不是 `ignore`。
- 记录启动时间、PID、退出码、重试次数、端口、配置路径和诊断码。
- 命令行和环境变量写日志前进行秘密过滤。
- 设置有限次指数退避，达到上限后向 UI 返回稳定错误码。

### 8.5 打包时的强制验证

Runtime ZIP 验证器必须解包检查并在下列情况失败：

- 存在旧的首次安装 `config.yaml`；
- 缺少 `config.toml` 或默认智能体文件；
- 默认 Provider 不是 `hepai`；
- 默认配置要求 API Key；
- 当前智能体不存在或文件名不匹配；
- 包内出现 `.env` 秘密、用户目录、开发机绝对路径；
- Runtime 版本与桌面版本不一致。

## 9. 自动化测试矩阵

### 9.1 单元与集成测试

- 全新用户目录生成默认智能体、Provider 和模型。
- first-run bootstrap 重复执行不改变已有有效配置。
- 已知由旧安装包写入的默认 `config.yaml` 可迁移到 HepAI OIDC 配置，不生成意外的 API Key 依赖；用户主动配置的自定义旧 Provider 必须保留并明确提示认证要求。
- 已有自定义 Provider/智能体不被覆盖。
- 配置损坏时备份、回滚和诊断码正确。
- OIDC token 同步后模型目录刷新。
- token 过期后的刷新与重新登录路径。
- Gateway 启动失败和退出日志可读取。
- 日志及支持包秘密扫描通过。

### 9.2 Packaged E2E

- Fake OIDC/Fake Gateway：用于稳定覆盖状态机和异常分支。
- Packaged app + 真实本地 Runtime：覆盖默认配置、Gateway 和 Agent 启动。
- 不允许 Fake 测试替代真实 Sandbox OIDC 验收。

### 9.3 Sandbox 真实验收

至少覆盖：

1. 当前频道 manifest 指向的线上基线版本全新安装复现。
2. 修复候选版全新安装。
3. 线上基线版本升级到修复候选版，保留登录和用户数据。
4. 修复候选版关闭并从开始菜单重新打开。
5. 预发布 CDN 上的候选版网络安装。

### 9.4 故障注入

- 安装下载中断和 CDN 连接失败；
- Runtime 长度或 SHA-256 不符；
- OIDC discovery/JWKS 不可达；
- token 过期、audience 错误、上游返回 401/403/5xx；
- Gateway 端口被占用；
- Gateway 启动后崩溃；
- `config.toml` 损坏；
- 默认智能体文件缺失；
- 模型目录为空或默认模型下线；
- 应用在初始化中被强制关闭后重新启动。

每个故障都必须得到明确诊断码、可操作 UI 信息和完整脱敏日志。

## 10. 发布阻断条件

以下任一条件不满足，不得更新稳定频道：

- Windows 11 x64 干净 Sandbox 能通过线上安装。
- MSI 和 Runtime 的版本、名称、长度、SHA-256 与发布 manifest 一致。
- Runtime ZIP 不包含秘密、开发机路径或不受控的构建机配置。
- 首次启动自动得到 `opendrsai` 智能体和 HepAI OIDC Provider。
- 登录后 Gateway 在 30 秒内进入 ready。
- 模型目录非空，当前模型有效，不要求 API Key。
- 首次聊天在 120 秒内收到回复。
- 关闭并从开始菜单重启后保持登录且仍可聊天。
- 支持包脱敏扫描通过。
- `acceptance-result.json` 所有必选项均为 `PASS`。

已发布版本发现缺陷时，不覆盖同版本资产；修复应使用下一个版本，并先进入预发布频道。稳定频道 manifest 只有在全部门禁通过后更新。

## 11. 需要新增或更新的实现项

建议按以下顺序落地：

1. 修复 Runtime 默认配置来源和首次启动 bootstrap。
2. 新增 Runtime ZIP 内容与秘密扫描验证器。
3. 补齐 Gateway 持久日志和统一诊断码。
4. 新增脱敏诊断快照 IPC 与“一键导出诊断包”。
5. 新增线上版 Sandbox 复现脚本和修复候选版验收脚本。
6. 更新 `verify:release-ready`，将打包内容验证设为阻断项。
7. 在真实 Sandbox 依次执行复现、修复版全新安装、升级和预发布 CDN 验收。

拟新增或改造的脚本：

- `scripts/invoke-online-sandbox-acceptance.ps1`
- `scripts/invoke-candidate-sandbox-acceptance.ps1`
- `scripts/guest/Invoke-OpenDrSaiAcceptance.ps1`
- `scripts/collect-windows-sandbox-diagnostics.ps1`
- `scripts/verify-runtime-defaults.mjs`
- `scripts/verify-diagnostic-bundle-redaction.mjs`

现有 `run-windows-sandbox-acceptance.ps1` 可复用安装和基础检查能力，但它使用假认证与 Fake Gateway，必须升级或拆分，不能继续代表真实 OIDC 聊天验收。

## 12. 最终交付效果

完成后，每次 Windows 发布都应产生一份可审计的 Sandbox 验收包。发布负责人可以明确回答：用户实际下载了哪个文件、首次启动生成了什么配置、OIDC token 是否进入正确链路、Gateway 和智能体选择了哪个 Provider/模型、聊天请求在哪一层失败，以及修复候选版是否在干净 Windows 11 环境真正可用。

人工参与被压缩为一次宿主机浏览器 OIDC 设备授权确认和必要界面确认；复现、采证、判定、脱敏与发布阻断均由脚本完成。

## 13. 已固化的发布与恢复流程

稳定版采用两阶段发布，禁止构建完成后直接公开：

1. `windows-desktop.yml` 只创建 GitHub Draft Release，不设为 latest。
2. 依次运行 `invoke-online-sandbox-acceptance.ps1`、`invoke-candidate-sandbox-acceptance.ps1`、`invoke-upgrade-sandbox-acceptance.ps1` 和 `invoke-network-candidate-sandbox-acceptance.ps1`。候选新装场景同时覆盖开始菜单重启。
3. 运行 `npm run verify:sandbox-oidc-evidence`；四种模式、逐项 PASS、截图、聊天关联、脱敏扫描和校验和缺一不可。
4. 运行 `npm run seal:sandbox-oidc-evidence`，得到 `windows-sandbox-oidc-evidence-v{version}.zip`，上传到 Draft Release。
5. `windows-release-promote.yml` 下载并重新验证密封证据后，才允许把 Draft 转为正式 Release。

Sandbox 统一由 `windows-sandbox-session.ps1` 管理。若完整候选配置和最小空配置都无法建会，且 AppX 已注册、`vmcompute`/HNS 正常，则执行 `RepairRegistration`；执行别名仍未恢复时，注销或重启 Windows 后再试。启动超时只清理由控制器本次创建的 launcher PID，不结束 `WindowsSandboxServer.exe`、`vmcompute` 或 HNS。

## 14. 沙盒交互约束

- 验收人员只操作 OpenDrSai 界面和宿主机 OIDC 授权页面，不点击沙盒中的 `.cmd`、PowerShell 或终端窗口。
- `watch-windows-sandbox-acceptance.ps1` 在后台自动验证登录、重启前后聊天、Tavily、注销，并调用最终验收器。
- 成功自动生成 PASS 证据；超时或失败自动收集脱敏诊断。不得用人工点击脚本补齐缺失证据。
- 升级验收根据基线版本的成功聊天遥测自动进入候选版本，不再使用“继续”CMD。
