# 模型服务配置下一阶段实施与验证报告

本文对应 [下一阶段完善开发计划](model-provider-next-stage-improvement-plan.md)，记录当前实现证据和发布门禁。用户操作说明见 [模型服务配置手册](model-provider-config.md)。

## 已实现模块

| 领域 | 实现 |
|---|---|
| 事务与并发 | `config/service.py`、`locking.py`、`revisions.py`；完整候选验证、内容 revision、进程内及跨进程锁、原子替换、最后可用快照 |
| 凭据 | `credentials.py`、`credential_lifecycle.py`；平台存储、提交回滚、安全替换、孤儿扫描与显式清理 |
| 草稿与诊断 | `probe.py`、`connectivity.py`、`doctor.py`、`guidance.py`；basic/model 模式、稳定错误码、中英文建议、离线/在线 Doctor |
| 预设与发现 | `provider_presets.py`、`model_discovery.py`；七类预设、短期缓存、限长、去重排序、能力校准信息 |
| 状态与热更新 | Gateway `model-state` 和 AgentManager/TUI AgentSession；配置/运行 revision、下一轮原子替换、失败保留旧 Client |
| 用户入口 | Gateway、Desktop、TUI、CLI 共用事务服务；预设、互斥 Key 来源、草稿测试、模型发现搜索、状态与恢复 |
| 运维 | `telemetry.py` 仅记录分类计数；`DRSAI_MODEL_CONFIG_WRITES` 写入熔断开关 |

## 安全不变量

- Renderer、Gateway 状态、Doctor、探测结果、遥测和异常不返回 API Key。
- 草稿测试不写 TOML、不创建凭据、不切换会话。
- Provider、模型选择和凭据引用在同一事务提交。
- revision 冲突返回 409 或 CLI/TUI 可处理错误，不静默覆盖。
- 新 Client 构建失败不替换旧 Client。
- macOS Keychain 保存通过 stdin 传递 Key，不把 Key 放入进程参数。

## 自动验证范围

- Python：事务、线程/进程竞争、文件系统故障、凭据损坏与孤儿保护、协议探测、Gateway、CLI、TUI RPC、Runtime 回退。
- Desktop：Windows node/web TypeScript 类型检查和模型 Provider 契约验证。
- TUI：TypeScript 类型检查。
- Windows 解包生产产物执行真实 main/preload/IPC 冒烟；Gateway 通过真实 HTTP 进程覆盖配置预览、提交、revision 冲突、Doctor、鉴权和聊天 SSE。
- macOS 发布前仍应在真实签名产物上执行同等配置流程冒烟；该项依赖 macOS 签名和打包环境，不由 Windows 上的源码测试代替。

## 2026-08-02 门禁结果

| 门禁 | 结果 |
|---|---|
| 模型配置专项 Python | 95 passed |
| Python 全量 | 820 passed、4 skipped、81 subtests passed；4 个非本功能失败（OAEP 生成物漂移 2、Android 验收夹具 1、Codex 时序测试 1）；Codex 时序测试单独复跑通过 |
| Windows Desktop node/web typecheck | 通过 |
| TUI typecheck | 通过 |
| Desktop Provider/Secret 契约 | 通过 |
| Windows 生产构建与解包签名 | 通过；后端源码包 295 files |
| Windows 打包产物 main/preload/IPC 冒烟 | 通过 |
| Gateway 真实 HTTP 配置/聊天冒烟 | 通过 |
| macOS 全量类型解析（关闭未使用符号 lint） | 通过 |
| macOS 严格 typecheck | 被共享工作区中与本功能无关的既有未使用符号阻断；模型配置相关代码没有类型错误 |

真实 macOS 签名打包无法在 Windows 开发主机执行，macOS 打包产物配置冒烟仍属于发布流水线的设备门禁，不能以本地源码测试宣称替代。Windows 对应门禁已在最终生产构建产物上通过。

## 发布加固阶段进度

### 第1轮：Provider 删除交互安全

- 已用应用内 `alertdialog` 替换有歧义的 `window.confirm()`；
- 明确提供“删除 Provider 和凭据”“仅删除 Provider”“取消”三个动作；
- `Esc`、遮罩点击和取消按钮均只关闭对话框，不调用删除 API；
- 删除成功文案依据后端返回的实际 active Provider 生成，不再一律声称已恢复 HepAI；
- 增加稳定 `data-testid` 和静态契约门禁，防止重新引入二选一确认框；
- 补充对话框键盘焦点、危险动作和中英文说明样式。

验证：

- Desktop Provider/Secret 契约：通过；
- Windows Desktop node typecheck：通过；
- 配置事务、Gateway、凭据专项：`32 passed`；
- Windows Desktop web typecheck：被工作区既有 `useDesktopChatAdapter.ts` 两处三参数调用与二参数 API 契约不一致阻断；本轮未修改该并行开发路径。

### 第2轮：两级连接测试与 Electron UI E2E

- Desktop 将草稿测试拆分为“基础连接测试”和“模型调用测试”；
- 基础测试成功时明确说明尚未调用指定模型；
- 模型测试使用应用内费用确认对话框，取消不调用后端；
- 模型测试成功时明确说明草稿未保存且可能产生少量费用；
- 状态卡展示最近测试的 `basic` / `model` 模式，不再用同一个 `OK` 混淆语义；
- 新增 `verify:model-provider-ui-e2e`，启动真实 Electron Renderer，通过 DOM 操作验证基础测试、模型费用确认、模型测试、状态卡更新和 Provider 删除取消零副作用；
- E2E 使用可变 mock preload 记录调用次数，取消行为由后端调用计数证明，而非仅检查对话框消失；
- 补齐视觉测试桥缺失的 `onRuntimeLogEvent` 订阅契约。

验证：

- Electron 模型 Provider UI E2E：通过；
- Desktop Provider/Secret 契约：通过；
- Windows Desktop node typecheck：通过；
- Windows Desktop web typecheck：通过；
- 连接探测、Probe、Gateway 专项：`25 passed`；
- Electron production renderer build：通过。

### 第3轮：Desktop 配置事务用户旅程

- Electron E2E 新增失败草稿场景，证明探测失败时保存调用为0且 revision 不变；
- 新增正常保存场景，证明只提交一次、模型更新且 revision 变化；
- 新增 revision 冲突场景，证明冲突可见且当前模型不被覆盖；
- 冲突提示增加“重新加载配置”操作，E2E 验证能够读取后端最新快照并恢复表单；
- 新增“仅删除 Provider”执行路径，验证向后端传递 `deleteCredential=false`；
- 新增“删除 Provider 和凭据”执行路径，验证向后端传递 `deleteCredential=true`；
- E2E 使用调用计数、最后请求参数、当前模型和 revision 作为事务证据。

验证：

- Electron production renderer build：通过；
- Electron 模型 Provider UI E2E：通过；
- Desktop Provider/Secret 契约：通过；
- Windows Desktop node/web typecheck：通过。

### 第4轮：macOS 模型配置发布门禁

- 新增真实 macOS Keychain 生命周期脚本，覆盖保存、读取、替换、删除和进程参数 Secret 扫描；
- Keychain 测试使用每次唯一秘密并在 `finally` 中清理测试项；
- 新增签名产物模型配置门禁，强制 Apple Silicon、严格 deep codesign、Gatekeeper、stapler、ASAR 和 Runtime manifest；
- 签名门禁调用现有 packaged smoke，覆盖最终 App 的 Renderer/preload/IPC、Runtime、Gateway 与进程清理；
- 门禁生成 `build/acceptance/model-provider-release-gate.json`，记录可执行文件 SHA-256 和逐项结果；
- PR/unsigned macOS job 接入跨平台契约检查；signed RC job 在构建并公证后强制执行真实模型配置发布门禁；
- 非 macOS 环境执行真实门禁会直接失败，不能以 Windows 结果冒充 Keychain 或签名验收。

当前可执行验证：

- macOS 模型配置发布契约：通过；
- 模拟 macOS/平台凭据专项：`5 passed`；
- macOS 全量类型解析（关闭既有未使用符号 lint）：通过；
- macOS 严格 typecheck 仍被共享 Renderer 的既有未使用符号阻断；
- 真实签名、公证、Gatekeeper 和 Keychain 生命周期：脚本与 CI 门禁已完成，等待 macOS signed RC Runner 产生设备证据，不在 Windows 上宣称通过。

### 第5轮：Provider 兼容矩阵

- 新增本地确定性HTTP矩阵，直接运行产品 `probe_provider_draft()` / `test_provider_connection()`；
- 覆盖 OpenAI、Anthropic、DeepSeek、Ollama、仅聊天兼容服务和自定义代理；
- 覆盖401、429、模型不存在，以及 `/models` 不存在时的最小聊天回退；
- 本地矩阵共15次探测，检查Bearer、Anthropic Header、无Key和代理路径；
- 新增真实服务 `--real-env --require-all` 模式，六类服务任一未配置即退出2且不生成通过证据；
- 真实矩阵只从环境读取Key、地址和模型，证据不记录Key、Base URL、响应正文或Header；
- Windows CI接入本地确定性矩阵；macOS signed RC接入六类真实服务矩阵；
- 新增运行手册，要求低权限、低额度测试账号和平台费用上限。

验证：

- 本地矩阵：15 probes passed；
- 兼容矩阵、连接探测和Probe专项：`11 passed`；
- 真实矩阵缺配置 fail-closed：通过；
- Windows/macOS workflow YAML解析：通过；
- 真实公网服务结果：等待受保护signed RC Runner及专用Secret，不在本地输出伪证据。

### 第6轮：全量回归与交付审计

- 当前模型配置专项重新收集并执行：`97 passed, 802 deselected`；
- 当前Python全量：`895 passed, 4 skipped, 81 subtests passed`，历史记录中的OAEP、Android夹具和Codex时序失败均未复现；
- 新增交付清单，将功能独占文件、共享重叠文件、生成证据和建议提交分组显式登记；
- 新增统一发布审计器，执行6个本地门禁并记录HEAD、49+源文件内容指纹、命令、退出码、耗时和输出SHA-256；
- 统一门禁覆盖模型专项、本地兼容矩阵、Desktop契约、真实Electron E2E、Windows双类型检查和macOS发布契约；
- 审计器区分 `localGatesPassed` 与 `releaseReady`，不会因本地全绿而掩盖脏工作区、macOS签名证据或真实Provider证据缺失；
- `--require-clean` 用于发布分支，只有清单范围干净且两项外部证据均通过时才允许release-ready。

当前审计结果：

- `localGatesPassed=true`；
- `releaseReady=false`；
- 清单范围仍有29个脏路径，其中多个共享文件包含并行开发改动；
- 待补外部证据：signed macOS模型配置门禁、真实Provider兼容矩阵；
- 当前结论是“本地功能门禁全绿”，不是“跨平台发布已完成”。

### 第7轮：Desktop剩余旅程与灰度回退演练

- Electron E2E验证安全存储、环境变量和无Key三个来源互斥，任何时刻只显示对应字段；
- 验证Ollama预设自动选择无Key、本地Base URL可见、模型发现成功；
- 验证未知模型允许保存并显示能力未校准警告；
- 验证Gateway不可用显示可恢复错误且保存调用次数不变；
- mock preload使用0600状态文件，验证保存后的模型在Renderer窗口重建后恢复；
- 遥测新增preview成功/失败、写入熔断、restore成功/失败/冲突、Client切换成功/失败/不可用分类；
- 灰度演练验证：正常preview/commit → 开启写入熔断 → 写入被拒且字节不变 → 解除熔断 → 人工损坏配置 → 按revision恢复last-good；
- 遥测只包含稳定分类计数，不包含模型、Provider、URL或Key。

验证：

- Electron production renderer build：通过；
- Electron模型Provider UI E2E：通过；
- Windows Desktop node/web typecheck：通过；
- 灰度、TUI Client切换和事务专项：`24 passed`，修正测试协程后单项无warning通过；
- 模型配置完整专项：`99 passed, 804 deselected`。

### 第8轮：双窗口冲突与最终审计

- 将原先特殊模型名触发的冲突fixture升级为两个真实Electron窗口；
- 两个窗口读取同一revision，先保存窗口写入共享0600状态，后保存窗口携带旧`expected_revision`并收到冲突；
- E2E证明后保存者不能覆盖胜出模型，重新加载后能读取胜出配置；
- 新增逐条审计矩阵，覆盖开发方案A～H工作包并区分complete、pending external和pending worktree stability；
- 发布审计器增加运行前后源码内容指纹，`--full`额外监控Python核心/测试、Android脚本和根脚本，执行期间任何改写都会拒绝签发收据。

最终全量尝试：

1. 第一次：902 passed、2 failed；失败来自测试运行期间Stage7脚本/测试并行更新，两个失败单独复跑均通过；
2. 第二次：`923 passed, 4 skipped, 81 subtests passed`，所有测试退出码为0；但运行期间11个OAEP、Android远程工作区和移动证据文件继续被修改，`sourceChangedDuringRun=true`，统一本地门禁按设计失败；
3. 模型配置专项保持`99 passed`，Electron UI E2E、Windows双类型检查、Desktop契约和macOS发布契约均通过。

当前不能宣称最终完成：

- 工作区存在持续并行写入，无法形成同一源码指纹下的全量测试收据或干净提交；
- signed macOS/Keychain设备证据尚未由Apple Silicon发布Runner生成；
- 六类真实Provider矩阵尚未由受保护Secret环境生成。
