# Android 模型配置实施进度

## 第 17 轮（真机缺陷修复）

- 日期：2026-08-04
- 总体进度：100%（已验收功能的缺陷修复）
- 问题：用户选择智增增 `deepseek-v4-pro` 后发送消息，界面错误显示“HAI 模型服务暂时不可用”。

### 诊断结论

- 真机非敏感配置诊断确认当前选择为智增增 `deepseek-v4-pro`，base URL 为 `https://api.zhizengzeng.com/v1`，wire API 为 OpenAI Compatible，Key 已配置。
- 运行日志显示上游实际返回 HTTP 503；路由并未落到 HepAI，但旧错误映射把所有提供方的 5xx 都冠名为 HAI，造成误判。
- 智增增官方文档确认 OpenAI Compatible 完整端点为 `https://api.zhizengzeng.com/v1/chat/completions`，当前端点拼接正确。

### 修复内容

- 自定义提供方请求增加非敏感路由日志：提供方名称、协议、host 和上游模型，不记录 API Key 或消息正文。
- 自定义 OpenAI Compatible 与 Anthropic 提供方遇到 502/503/504 时等待 750ms 自动重试一次。
- 错误映射改为提供方感知：401、403、404、5xx 显示真实提供方；持续 5xx 显示 HTTP 状态、host 和上游模型，不再误报 HAI。
- 增加两个专项测试：首次 503 后重试成功；连续 503 显示智增增和真实路由且不含 HAI。
- `HaiModelClientTest` 全部通过，`assembleDebug` 通过；修复版 APK 已使用 `--no-streaming -r` 更新到 Samsung SM-X936C 并成功启动。

### 待用户确认

- 在修复版真机上重发消息。若智增增仍连续返回 503，界面会明确显示该服务、HTTP 状态和模型，届时属于上游模型节点暂不可用，可切换 `deepseek-v4-flash` 或稍后重试。

## 第 16 轮

- 日期：2026-08-04
- 总体进度：100%
- 本轮目标：恢复 Samsung 无线调试、完成最终矩阵、处理真实调用门禁与四角色签字。

### 本轮完成

- 平板解锁后无线 ADB 自动恢复，Samsung SM-X936C（SDK 36）状态为 `device`。
- 验收脚本采用稳定的 Compose 测试类级独立进程和类间冷却，最终矩阵完整通过：编辑器 6/6、提供方列表 4/4、响应式 4/4、持久化/安全 3/3、迁移 1/1、设置入口 1/1、强制重启恢复 2/2。
- 拆分后的 `ModelProviderVisualEvidenceTest` 单独 1/1 通过，确认“已安全保存；留空表示不修改”持续可见且不存在 `sk-` 明文。
- 最终真机 logcat 与私有目录金丝雀均为 0 命中。
- 负责人确认产品、Android、Runtime、安全四角色均为 Zhengde Zhang；四角色全部签署 Go。
- 负责人确认当前没有 OpenAI/Anthropic 测试 Key，并批准本版本暂时跳过真实上游调用；完整协议契约测试和 opt-in 补跑脚本继续保留。

### 最终结论

- F01–F12、所有 P0、保存/发现/批量/逐模型启停、Room 持久化、Keystore、安全迁移、稳定 ID、运行时路由、Samsung 真机功能/性能/重启/视觉验收全部通过。
- 本版本 Android 模型配置功能完成验收，总体进度 100%。

## 第 15 轮

- 日期：2026-08-04
- 总体进度：99.7%
- 本轮目标：对第 14 轮密钥状态提示修复后的最终 APK 执行完整回归，并稳定 Samsung 验收编排。

### 本轮完成

- 修复后 `testDebugUnitTest` 完整通过，主代码与网络/Repository/路由契约无回归。
- 将真机截图导出从 `ModelProviderEditorUiTest` 拆分为独立 `ModelProviderVisualEvidenceTest`，核心编辑器类恢复 6 项，视觉证据不再延长核心测试进程。
- `assembleDebugAndroidTest` 构建通过。
- Samsung 复跑中已再次通过编辑器 7/7（拆分前）和提供方列表 4/4；随后设备出现持续的 Compose 测试宿主无语义树/进程回收状态。
- 验收脚本进一步支持 Compose 测试方法级独立 instrumentation，避免厂商固件长期持有 Activity/渲染资源。
- 发现 `am force-stop` 会让目标包进入 stopped 状态并阻止测试 Activity，已更正为不设置 stopped 标志的 `am kill`。
- 为清理 Samsung 系统级测试宿主状态执行设备重启；重启后 mDNS 已重新广播 `192.168.3.78:40903`，但设备尚未解锁恢复 TLS ADB。

### 待复验

1. 在 Samsung 平板解锁并恢复无线 ADB 后，复跑方法级隔离最终矩阵，确认编排修复。
2. 提供 OpenAI 与 Anthropic 测试凭据和模型名，各完成一次真实流式调用。
3. 产品、Android、Runtime、安全四个责任人完成 Go/No-Go 签字。

### 当前结论

- 产品功能进度保持 99.7%，本轮没有发现产品代码回归；未完成的 Samsung 再复跑是测试编排复验，不撤销第 13/14 轮已经通过的真机证据。
- 真实服务凭据和四角色签字已连续第 13、14、15 轮缺失，均无法由本地实现或模拟服务替代。

## 第 14 轮

- 日期：2026-08-04
- 总体进度：99.7%
- 本轮目标：补齐 Samsung 无线真机矩阵、横竖屏视觉证据和真机安全复核。

### 本轮完成

- Samsung SM-X936C 已通过无线 ADB 在线，主 APK 与测试 APK 使用 `--no-streaming` 稳定更新。
- 真机最终矩阵全部通过：模型编辑 6/6、提供方列表 4/4、响应式 4/4、持久化/安全 3/3、迁移 1/1、设置入口 1/1、强制重启恢复 2/2。
- Samsung 长时间单进程 Compose 测试存在厂商资源回收问题，验收脚本改为按测试类隔离进程后稳定通过；这不改变产品进程逻辑。
- 真机 logcat 与私有目录安全金丝雀均为 0 命中。
- 新增仅存在于 `androidTest` 的截图证据测试，在 Samsung 上渲染生产 `ModelProviderEditorScreen`，横竖屏各通过 1/1，并导出原始分辨率截图。
- 目视复核确认横竖屏无裁切、API Key 无明文、保存/连接/协议/批量/搜索/模型开关均可触达。
- 复核截图时发现“已安全保存”placeholder 未聚焦时不可见；改为持续显示的 supporting text，并重新构建、安装和真机复验通过。

### 剩余发布阻断项

1. 提供 OpenAI 与 Anthropic 测试凭据和模型名，各完成一次真实流式调用。
2. 产品、Android、Runtime、安全四个责任人完成 Go/No-Go 签字。

### 当前结论

- 本地代码、自动化、Samsung 真机功能/性能/迁移/重启/安全与视觉证据已闭环，进度提升至 99.7%。剩余项需要外部凭据和责任人授权，不能由代码或模拟服务替代。

## 第 12 轮

- 日期：2026-08-04
- 总体进度：99%
- 本轮目标：最终外部状态复核与严格阻塞审计。

### 复核结果

- ADB 仅有 Google API 35 模拟器，Samsung SM-X936C 仍未出现。
- `DRSAI_LIVE_OPENAI_API_KEY`、`DRSAI_LIVE_OPENAI_MODEL`、`DRSAI_LIVE_ANTHROPIC_API_KEY`、`DRSAI_LIVE_ANTHROPIC_MODEL` 均未配置。
- Go/No-Go 四个责任人签字行数为 0。
- 第 9–12 轮已分别补齐请求取消、设置入口、强制停止恢复、Samsung 一键脚本和签字单；当前不存在还能替代真实设备、真实服务或责任人授权的本地证据。

### 阻塞结论

- 恢复后的连续三轮审计均遇到相同外部条件，且本地可执行工作已耗尽，任务保持 99% 并重新标记为阻塞。
- 恢复条件：连接 Samsung；配置四个真实调用变量；由四个责任人完成 Go/No-Go。

## 第 11 轮

- 日期：2026-08-04
- 总体进度：99%
- 本轮目标：把剩余 Samsung 真机矩阵和 Go/No-Go 变成可重复、可审计的最终验收流程。

### 本轮完成

- 新增 `scripts/run-model-provider-samsung-acceptance.ps1`。
- 脚本校验设备在线且制造商必须为 Samsung，拒绝使用模拟器冒充最终真机证据。
- 脚本自动安装主 APK/测试 APK，执行 18 项核心回归、设置入口、两阶段强制重启恢复及安全金丝雀扫描。
- 每组 instrumentation 输出单独落盘，并生成包含设备型号、SDK、测试状态和泄漏命中数的 `summary.json`。
- 真机截图、横竖屏及大字体人工项明确保持 pending，不以自动化结果替代视觉验收。
- 新增 `ANDROID_MODEL_CONFIGURATION_GO_NO_GO.md`，包含自动化证据、真机人工清单及产品/Android/Runtime/安全四方签字表。
- 三个验收脚本 PowerShell 语法检查均为 0 错误。
- 使用 API 35 模拟器验证 Samsung 保护分支，脚本按预期在任何安装或测试前快速拒绝：`found 'Google'`。

### 剩余发布阻断项

1. Samsung SM-X936C 上线后执行一键脚本，并完成人工截图/横竖屏检查。
2. 提供 OpenAI/Anthropic 测试模型与凭据，运行真实流式验收脚本。
3. 四个责任人在 Go/No-Go 签字单确认。

### 当前结论

- 最终外部验收已经具备可重复执行入口，但在真实证据产生前仍保持 99%，不能标记完成。

## 第 10 轮

- 日期：2026-08-04
- 总体进度：99%
- 本轮目标：用两阶段仪器测试验证应用进程被强制停止后的完整配置恢复。

### 本轮完成

- 新增 `ModelProviderRestartPersistenceTest`，将重启验收拆为独立 seed/verify 两个仪器进程。
- 新增 `scripts/run-model-provider-restart-acceptance.ps1`，自动执行写入、`am force-stop` 和独立读取验证。
- 阶段 1 写入自定义提供方、启用/停用模型、能力、加密 API Key 和默认稳定模型 ID。
- 强制停止 `ai.drsai.remote.debug` 后，阶段 2 完整读回名称、模型启停、工具能力、凭据配置、默认模型 ID 和运行时解析，并安全清理测试数据。
- API 35 跨进程验收 2/2 通过；原模型配置仪器回归 18/18 继续通过。
- 并行远程模块一度处于 `historyCursor` 调用/数据类不同步状态；等待其变更完整后构建成功，未覆盖远程逻辑。

### 剩余发布阻断项

1. Samsung SM-X936C 未连接：仍需真机横竖屏、500 模型性能及截图/诊断包扫描。
2. OpenAI/Anthropic 测试凭据和模型名缺失：真实流式调用待执行。
3. 产品、Android、Runtime、安全 Go/No-Go 签字待完成。

### 当前结论

- API 35 已具备保存、进程终止、独立进程恢复的直接证据；最终 1% 仍不能替代真机、真实服务和责任人签字。

## 第 9 轮

- 日期：2026-08-04
- 总体进度：98.5%
- 本轮目标：恢复外部条件检查，并闭环 F01 设置入口与 F10 请求取消证据。

### 本轮完成

- 重新探测设备和真实调用变量：API 35 模拟器在线；Samsung 与四个真实调用变量仍缺失。
- 增加真实 OkHttp 挂起请求取消测试：收到请求后调用 `cancelActive()`，网络任务在 2 秒门限内受控结束。
- `HaiModelClientTest` 全部通过，覆盖 F10 的“取消后停止网络连接和流读取”条目。
- 扩展现有宽屏抽屉仪器测试，直接点击 `open-settings`，验证设置按钮可见且回调只触发一次；API 35 上 1/1 通过。
- 修复并行新增 `LocalStoreTest` 漏掉三个已有 Remote entity import 导致的全量测试 APK 编译失败，不改变其测试逻辑。
- `assembleDebugAndroidTest` 恢复成功。

### 剩余发布阻断项

1. Samsung SM-X936C 未连接：最新版真机横竖屏、500 模型、重启恢复、截图/诊断包扫描待执行。
2. OpenAI/Anthropic 测试密钥和模型名均缺失：真实流式调用仍待执行。
3. 产品、Android、Runtime、安全 Go/No-Go 签字待完成。

### 当前结论

- 本地代码、单元/契约、Compose 和 API 35 自动化仍可继续验证；最终完成定义仍不能绕过真机、真实服务和签字证据。

## 第 8 轮

- 日期：2026-08-04
- 总体进度：98%
- 本轮目标：按 F01–F12 原始测试矩阵补强证据，并准备真实提供方验收入口。

### 本轮完成

- 增加同名自定义提供方不同 UUID，以及空名称、非法 URL、URL 内嵌凭据、换行 URL 测试。
- 模型目录错误矩阵补齐 403、404、429、500、超时、空响应和无效 JSON。
- 空模型目录响应现在显示明确错误，不再表现为点击“获取”后无反应。
- 修复旧配置迁移：空模型、缺失密钥不再阻断启动；损坏 URL 条目安全跳过；重复迁移保持幂等。
- 扩展 `SensitiveDataRedactor`，覆盖 `x-api-key`、Authorization、JSON 敏感字段及常见 `sk-`/`sk-ant-` 前缀。
- HTTP 错误正文和流式错误统一脱敏；增加错误泄漏与流异常中断测试。
- 新增 opt-in `LiveModelProviderAcceptanceTest` 和 `scripts/run-model-provider-live-acceptance.ps1`；未显式设置开关、模型和密钥时绝不访问真实服务。
- 串行全量重建及完整单元测试通过；最新 APK 安装到 API 35 模拟器，仪器回归 18/18 通过。

### 剩余发布阻断项

1. Samsung SM-X936C 当前仍未连接 ADB，最新版真机矩阵和诊断包/截图扫描待执行。
2. OpenAI/Anthropic 测试凭据与模型名缺失；真实调用脚本已验证会快速列出缺失变量且不输出密钥。
3. 产品、Android、Runtime、安全 Go/No-Go 签字待完成。

### 构建备注

- 首次增量构建遭遇共享工作区 KAPT 输出漂移；使用 `--rerun-tasks` 串行重建后全部通过。
- Relay bindings schema 漂移仍为无关并行改动，测试构建继续隔离该校验，未修改 Relay 文件。

## 第 7 轮

- 日期：2026-08-04
- 总体进度：98%
- 本轮目标：闭环保存防重/恢复证据和 API Key 泄漏扫描。

### 本轮完成

- 抽取并在 `AppViewModel` 真实保存路径接入 `SingleFlightGate`。
- 新增 16 线程并发防重单元测试：一个保存事务执行期间只允许一次进入，完成后可再次保存。
- 新增 Compose 保存实例状态恢复测试：一次保存后恢复状态，保存回调仍严格为一次。
- 固定安全金丝雀测试通过；API 35 logcat、应用私有文件、可疑源码日志调用均为 0 命中。
- 确认 Android Manifest 禁止应用备份（`allowBackup=false`）。
- 最新主 APK 与测试 APK 安装到 API 35 模拟器，合并仪器回归 18/18 通过；完整单元测试通过。

### 剩余发布阻断项

1. Samsung SM-X936C 当前仍未出现在 ADB 中：待安装最新版并完成横竖屏、500 模型、截图/诊断包安全复验。
2. 当前环境不存在 OpenAI/Anthropic 测试密钥或端点：待各完成一次真实流式调用。
3. 完成产品、Android、Runtime、安全 Go/No-Go 签字。

### 构建备注

- Relay bindings 并行改动仍与协议 schema 漂移；本轮继续只在模型配置测试构建中隔离 `verifyAndroidRelayBindings`，未修改 Relay 文件。

## 第 6 轮

- 日期：2026-08-04
- 总体进度：97%
- 本轮目标：执行第 5 轮新增测试、修正响应式测试环境、完成自动化验收闭环。

### 本轮完成

- 全量单元测试及 Debug/Test APK 构建成功。
- API 35 合并仪器回归 17/17 通过：模型编辑 6 项、提供方列表 3 项、响应式 4 项、持久化/安全 3 项、迁移 1 项。
- 500 模型可滚动到末项且无 ANR，批量草稿变更 `<300ms` 门禁通过。
- 600dp 手机下钻、900dp 平板双栏，以及 1.0x、1.3x、1.5x 字体倍率通过。
- API Key 加密落盘、Room 无凭据列、稳定 ID 重命名与历史会话引用完整性通过。
- 修正 900dp 测试容器被模拟器父约束收缩的问题；保留实际可见性断言。

### 剩余发布阻断项

1. Samsung SM-X936C 恢复 ADB 后，安装最新 APK 并复跑横竖屏、安全及 500 模型性能验收。
2. 使用测试凭据各完成一次 OpenAI Compatible 与 Anthropic 真实流式调用。
3. 完成真机 logcat、截图和诊断包敏感信息扫描。
4. 完成产品、Android、Runtime、安全 Go/No-Go 签字。

### 构建备注

- 当前仓库存在与本功能无关的 Relay bindings 漂移；本轮 Android UI 测试构建通过 `-x verifyAndroidRelayBindings` 隔离该并行变更，未修改或覆盖 Relay 文件。

## 第 5 轮

- 日期：2026-08-04
- 总体进度：95%
- 本轮目标：响应式/大字体/500 模型性能验收，历史引用完整性和 F01–F12 最终台账。

### 本轮完成

- 增加 `SettingsResponsiveUiTest`：600dp 手机下钻导航、900dp 平板双栏、1.5x 字体可操作性。
- 增加 500 模型 UI 测试：滚动到第 500 项、无 ANR，批量草稿操作 `<300ms` 门禁。
- 增加历史会话引用测试：提供方/模型重命名不改写会话 modelId，且仍可解析。
- 增加旧 `provider/upstream` 和 `provider:upstream` 拼接 ID 到稳定 UUID 的自动选择迁移。
- 增加保存原子防重门，并发双击不会启动第二个 Repository 事务。
- 完成 `ANDROID_MODEL_CONFIGURATION_ACCEPTANCE_LEDGER.md`，逐项列出 F01–F12 和发布门禁的强证据/缺口。
- API 35 通过 API Key 加密测试后 logcat 扫描，未发现测试凭据或凭据别名。

### 本轮待验证项

- 新增测试源码已写入，但当前全量编译被同一工作区的 `OaepJsonCodec.kt` 并行协议签名修改阻断；该文件两处构造参数与正在变更的生成类不一致。
- Samsung SM-X936C 本轮未出现在 ADB 列表，无法更新第 5 轮 APK。

### 剩余发布阻断项

1. 待并行 OAEP 修改恢复可编译后，执行第 5 轮新增响应式、500 模型和历史引用测试。
2. 恢复 Samsung ADB，更新 APK 并复跑安全、UI、性能测试。
3. 使用可用的测试凭据各完成 1 次 OpenAI Compatible 和 Anthropic 真实流式调用。
4. 完成产品、Android、Runtime、安全 Go/No-Go 签字。

## 第 4 轮

- 日期：2026-08-04
- 总体进度：93%
- 本轮目标：补齐 P1 易用性、设置页交互测试和加密落盘验证。

### 本轮完成

- 模型发现后显示“新增/保留/服务端未返回”变化摘要，服务端缺失项不会静默删除。
- 模型元数据增加 `PRESET` / `DISCOVERED` / `MANUAL` 来源，保存和重启后保留。
- 发现的新模型使用已有规则自动标记视觉与工具能力，UI 明示信息来源。
- 增加多选、批量删除和撤销；操作只修改草稿，仍需点击保存才落盘。
- 提供方列表显示连接状态、最后检查时间和已启用模型数。
- 修复窄屏横向批量工具栏的裁剪/误触问题，改为分行操作布局。
- 增加设置页 UI 测试：折叠/展开、未保存离开、删除影响提示、批量启停、多选删除/撤销。

### 本轮验证

- `testDebugUnitTest`：完整通过。
- `assembleDebug` + `assembleDebugAndroidTest`：通过。
- API 35 模拟器：模型编辑器/设置页 UI 8/8 通过。
- API 35 模拟器：API Key 加密落盘、Room 无凭据字段、稳定 ID 和 13→14 迁移 3/3 通过。
- Samsung SM-X936C 仍处于无线 ADB `offline`，本轮新增验收尚未真机复跑。

### 下一轮

1. 恢复 Samsung ADB，安装第 4 轮 APK，复跑 8 项 UI 和 3 项安全/迁移测试。
2. 执行 1.0/1.3/1.5 字体比例、手机/平板尺寸和 500 模型滚动/批量操作性能验收。
3. 完成 F01–F12 需求→证据逐项审计与发布门禁台账。

## 第 3 轮

- 日期：2026-08-04
- 总体进度：87%
- 本轮目标：真机迁移/持久化验证，补齐运行时协议契约与核心 Compose 交互测试。

### 本轮完成

- 最新 APK 和仪器测试包已安装到 Samsung SM-X936C。
- 真机通过 Room 13→14 迁移与提供方持久化测试，共 2/2 项。
- 增加 `ModelConfigurationResolver`，使运行时提供方解析可隔离测试。
- OpenAI Compatible 契约覆盖自定义主机、Bearer 密钥、稳定 ID→上游模型 ID 和工具名转换。
- Anthropic 契约覆盖 `/v1/messages`、`x-api-key`、版本头、system、工具 schema、流式文本和工具参数增量。
- 修复 Anthropic 主机已包含 `/v1` 时发现地址重复 `/v1/v1/models` 的问题。
- 增加无效 JSON 的可行动错误提示。
- 增加 Compose 测试：批量清空确认、搜索不删草稿、停用默认模型影响确认；API 35 模拟器 3/3 通过。
- 增加 500 模型顺序、能力、Token 限制和启用状态持久化测试并通过。
- 增加 API Key 加密落盘和 Room 无凭据字段的真机安全测试（待下轮连接恢复后执行）。

### 本轮验证

- `testDebugUnitTest`：通过。
- `assembleDebugAndroidTest`：通过。
- Samsung SM-X936C：迁移/持久化 2/2 通过。
- API 35 模拟器：模型编辑器 UI 3/3 通过。
- Samsung 在 Compose 测试过程中无线 ADB 掉线，无法回收该次结果，不计为通过。

### 下一轮

1. 恢复 Samsung ADB 后执行 API Key 加密落盘测试和 3 项 Compose 测试。
2. 补齐未保存离开、保存成功反馈、全部启用/停用和提供方删除的 UI 测试。
3. 完成 100/500 模型的真机滚动、批量操作时间与大字体验收。
4. 逐项审计 F01–F12 发布门禁和证据台账。

## 第 2 轮

- 日期：2026-08-04
- 总体进度：76%
- 本轮目标：补齐凭据/数据库一致性、默认模型回退和数据库迁移验证。

### 本轮完成

- 抽象 `ModelCredentialStore`，使凭据存储可测试且不向 Room 泄露明文。
- Room 写入失败时恢复旧密钥；新提供方失败时移除新密钥。
- Room 删除失败时恢复原凭据，避免半完成状态。
- 增加 revision 冲突、重复模型、写入失败、删除失败的 Repository 单元测试。
- 增加默认模型回退规则测试：当前项停用或删除时回退到首个启用模型。
- 增加 13→14 仪器迁移测试：校验两张表、普通/唯一索引和删除级联。
- `testDebugUnitTest` 与 `assembleDebugAndroidTest` 均通过。

### 当前阻塞

- 真机安装前的全量重编译被同一工作区中远程会话模块的未完成修改阻塞：三个 ViewModel 仍引用已被共享容器替代的 `database/auth` 字段。本轮未覆盖或回退这些并行修改。

### 下一轮

1. 恢复可编译后安装最新 APK/测试 APK，并在 Samsung SM-X936C 上运行迁移与持久化仪器测试。
2. 增加 OpenAI Compatible 与 Anthropic 的流式文本、工具调用和上游模型 ID 路由契约测试。
3. 增加 Compose 保存反馈、未保存退出、筛选、批量清空测试。
4. 执行密钥日志/数据库泄漏扫描和 100/500 模型性能验收。

本报告依据 [`ANDROID_MODEL_CONFIGURATION_DEVELOPMENT_PLAN.md`](../../plans/ANDROID_MODEL_CONFIGURATION_DEVELOPMENT_PLAN.md) 的 F01–F12、P0/P1/P2 和发布门禁持续更新。百分比只代表有代码及可验证证据的完成度，不以“已有界面”代替运行时、迁移、安全或真机验收。

## 第 1 轮

- 日期：2026-08-04
- 总体进度：66%
- 本轮目标：完成现状审计并补齐 P0 关键交互。

| 功能域 | 进度 | 已有证据 | 主要缺口 |
| --- | ---: | --- | --- |
| F01 设置入口与响应式分组 | 75% | 设置路由、侧栏入口、手机/平板分支 | Compose 尺寸与大字体测试 |
| F02 预设与自定义提供方 | 80% | 六类预设、UUID、编辑页、预设契约测试 | 同名实例和非法输入测试扩充 |
| F03 API Key 安全保存 | 65% | EncryptedSharedPreferences + MasterKey、留空不改 | 回滚、泄漏扫描、删除凭据测试 |
| F04 N 模型配置 | 75% | Room 一对多、折叠、编辑和 500 项 LazyColumn 结构 | 100/500 项性能证据 |
| F05 模型发现与合并 | 70% | OpenAI/Anthropic 目录、合并保留手工模型、连接检查 | 超时/无效 JSON/500 契约测试，变化摘要 |
| F06 批量管理 | 70% | 清空确认、全部启用/停用、搜索筛选 | 多选删除、撤销、性能证据 |
| F07 逐模型能力与启用 | 75% | 启用、视觉、工具、推理开关，停用不进运行时 | Token 限制编辑、ViewModel 单测 |
| F08 保存与反馈 | 75% | 顶部反馈、进度、校验、revision、未保存离开确认 | 双击/旋转/事务失败测试 |
| F09 默认模型与历史会话 | 55% | 稳定 ID、停用后回退、影响提示 | 会话绑定与旧 ID 迁移测试 |
| F10 运行时协议路由 | 55% | HepAI/OpenAI/Anthropic 路由代码 | 第三方路由网络契约和真实调用验收 |
| F11 数据迁移与回滚 | 55% | Room 13→14、旧 JSON 应用层迁移、真机升级启动 | MigrationTestHelper、损坏输入和幂等测试 |
| F12 删除与恢复 | 55% | HepAI 防删、删除确认、级联和默认影响提示 | 凭据失败、回退和重启测试 |

### 本轮代码进展

- 增加独立连接检查，不修改模型草稿。
- API Key 增加显示/隐藏，已有密钥继续使用“留空不修改”。
- 增加未保存离开确认。
- 增加模型搜索以及全部、已启用、已停用筛选。
- 增加当前默认模型停用提示和提供方删除影响确认。
- 增加 401、403、404、429、5xx、DNS、超时、TLS 的可行动错误映射。
- 增加模型目录客户端契约测试。

### 下一轮

1. 完善 Repository 事务、凭据回滚、删除和默认回退测试。
2. 增加 Room MigrationTestHelper 的 v13→v14 schema 与幂等迁移测试。
3. 增加 OpenAI/Anthropic 自定义 Provider 的流式和工具调用契约测试。
4. 开始 Compose UI 测试：保存反馈、未保存确认、搜索筛选和批量清空。
