# 模型服务配置下一阶段完善开发计划

## 1. 文档目的

本文定义 OpenDrSai 模型服务配置的下一阶段完善工作。在现有 `~/.drsai/config.toml`、统一 Resolver、Gateway API、CLI/TUI 和 Windows/macOS 桌面接入基础上，同时从两个方向继续建设：

- **工程可靠性**：保证配置修改具备事务性、并发安全、失败回退、凭据生命周期完整和跨平台一致性。
- **用户易用性**：让用户无需理解 Provider、协议和凭据存储细节，也能完成配置、测试、选模、诊断和恢复默认。

本阶段不扩大 TOML 字段数量。Provider 预设、错误指导、诊断规则和模型展示信息继续保存在程序内置注册表或独立服务层中。

## 2. 当前基础与主要问题

当前已经具备：

- 精简 TOML、内置 Provider/模型注册表和未知模型兜底；
- OpenAI-compatible、Anthropic-compatible 和无 Key 本地服务；
- Windows DPAPI、macOS Keychain 和本地加密凭据引用；
- Gateway、CLI、TUI、Windows/macOS 桌面配置入口；
- 配置热更新、旧 Client 回退、旧配置迁移和脱敏输出；
- Provider 连接测试和完整自动化回归。

下一阶段需要解决的核心问题：

1. 配置可能在完整验证前写入磁盘，失败时存在部分生效风险。
2. 多进程或多个前端同时修改 TOML 时可能发生丢失更新。
3. 凭据引用损坏、缺失和替换失败需要更清晰的恢复机制。
4. TUI 某些模型切换路径没有严格检查实际切换结果。
5. `/models` 探测不适用于所有兼容服务，模型调用探测又可能产生费用。
6. 桌面“测试连接”会先保存草稿，不符合用户对“试一下”的预期。
7. 用户仍需理解 Provider、协议、Key 来源和 Base URL 等技术概念。
8. 错误提示缺少可执行的修复建议，当前生效状态也不够集中。

## 3. 阶段目标

### 3.1 工程目标

- 所有配置修改遵循“内存合并 → 完整校验 → 原子提交”，失败不改变磁盘状态。
- 同一配置文件的并发写入可检测、串行化或返回明确冲突，不静默覆盖。
- Provider、模型选择和凭据替换作为一个事务提交。
- 新配置运行失败时保留最后已知可用配置和 Client。
- 凭据引用在保存前验证，损坏时返回脱敏、可恢复的错误。
- 配置测试支持无副作用的草稿模式，并区分基础连接与真实模型调用。
- 所有前端消费同一错误码、修复建议和有效配置快照。

### 3.2 用户目标

- 常见 Provider 通过预设完成配置，默认只显示必要字段。
- Key 来源改为互斥选择：“系统安全存储”“环境变量”“无需 Key”。
- 测试草稿不修改当前配置，测试成功后可一键保存并使用。
- 用户能看到当前实际生效的模型服务、Key 来源和最近测试状态。
- 错误提示包含原因、建议操作和可展开的技术详情。
- 能从 Provider 获取模型列表并搜索，同时保留任意模型 ID 输入能力。
- 恢复 HepAI 默认值时明确区分“切换默认”和“删除自定义配置”。
- CLI 提供交互式设置向导和统一诊断命令。

## 4. 总体架构

```text
Desktop / TUI / CLI
        │
        ▼
Model Configuration API / RPC
        │
        ├── Provider Preset Registry
        ├── Draft Validation & Connection Probe
        ├── Model Discovery
        ├── Error Guidance / Doctor
        │
        ▼
Transactional Config Service
        ├── Merge + Validate
        ├── Revision / Conflict Check
        ├── Credential Transaction
        ├── Atomic TOML Commit
        └── Last-known-good Snapshot
        │
        ▼
Unified Resolver → Runtime Client Factory
```

核心原则：所有修改入口只调用 `TransactionalConfigService`，不再分别调用 `upsert_provider()` 和 `update_model_selection()` 完成多步写入。

## 5. 需要开发的模块

### 5.1 事务配置服务

建议新增：

```text
drsai/config/service.py
drsai/config/transaction.py
drsai/config/locking.py
drsai/config/revisions.py
```

主要接口：

```python
preview_update(request, expected_revision=None) -> ConfigPreview
commit_update(request, expected_revision=None) -> ConfigCommitResult
restore_last_known_good() -> ConfigCommitResult
```

功能点：

- 在内存中读取并合并 TOML，不直接写入；
- 对完整候选配置执行 schema、URL、Provider、模型和凭据校验；
- 一次提交 Provider、模型选择和配置版本；
- 提交前比较 revision、文件指纹和预期版本；
- 使用进程内路径锁和跨进程 lock file；
- 原子替换 TOML，并保留迁移前备份和最后已知可用快照；
- 提交失败清理新凭据，保留旧凭据和旧配置；
- 提交成功后再删除被替换的旧凭据；
- 返回 `revision`、`changed_fields`、`restart_required=false` 和生效策略。

冲突策略：

- API/UI 请求携带读取时获得的 `expected_revision`；
- revision 不一致时返回 `config_conflict`；
- UI 展示“配置已被其他窗口修改”，允许重新加载后再次提交；
- CLI 可提供 `--force`，但默认禁止静默覆盖。

### 5.2 凭据生命周期服务

扩展：

```text
drsai/config/credentials.py
drsai/config/credential_service.py
```

功能点：

- 保存前验证凭据引用格式及可读性；
- 将 Fernet `InvalidToken`、DPAPI 和 Keychain 错误转换成统一错误码；
- 引入 `prepare / commit / rollback` 三阶段凭据事务；
- 支持安全替换、删除、孤儿凭据扫描和手工清理；
- 不在日志、异常、进程参数、诊断包中暴露真实 Key；
- macOS 优先使用原生 helper 或 stdin 协议，避免 Key 出现在命令行参数；
- 提供“凭据存在但不可读取”“凭据不存在”“平台存储不可用”等独立状态；
- 明文 `api_key` 继续只作为手工 TOML 兼容能力，不作为 UI 默认路径。

### 5.3 Provider 预设注册表

建议新增：

```text
drsai/config/provider_presets.py
drsai/config/provider_guidance.py
```

首批预设：

- HepAI；
- OpenAI；
- Anthropic；
- DeepSeek；
- Ollama；
- 自定义 OpenAI-compatible；
- 自定义 Anthropic-compatible。

每个预设包含：

- 用户可见名称和说明；
- 默认 Base URL、协议和 Key 环境变量建议；
- 是否允许修改 Base URL；
- 推荐连接测试方式；
- 模型发现能力；
- 常见错误对应的修复建议；
- 文档链接标识，不将链接或展示文本写入用户 TOML。

### 5.4 草稿验证与连接测试服务

建议新增：

```text
drsai/config/probe.py
drsai/config/probe_errors.py
drsai/config/probe_guidance.py
```

提供两种模式：

1. **基础连接测试**：验证 URL、TLS、网络、鉴权和协议特征，尽量不产生模型调用费用。
2. **模型调用测试**：发送最小请求，验证指定模型确实可用；执行前明确提示可能产生少量费用。

功能点：

- 直接测试未保存的 Provider 草稿；
- 不创建凭据引用、不修改 TOML、不改变当前会话；
- OpenAI-compatible 服务按能力依次尝试模型目录和最小调用；
- Anthropic-compatible 服务区分端点错误与模型错误；
- 支持超时、取消和有限重试；
- 不返回上游响应正文、Header 或 Key；
- 记录最近测试时间、模式、耗时和脱敏结果；
- 错误码至少包括：
  - `dns_failed`
  - `tls_failed`
  - `timeout`
  - `connection_failed`
  - `authentication_failed`
  - `permission_denied`
  - `endpoint_not_found`
  - `protocol_mismatch`
  - `model_not_found`
  - `rate_limited`
  - `invalid_response`
  - `credential_unavailable`

### 5.5 模型发现与能力展示

建议新增：

```text
drsai/config/model_discovery.py
drsai/config/model_display.py
```

功能点：

- 从支持的 Provider 获取模型列表；
- 对结果做大小限制、超时、去重和稳定排序；
- 合并内置模型注册表信息；
- 显示视觉、推理、上下文和能力是否已校准；
- 未知模型保留手工输入，不阻止保存；
- 发现失败不影响手工配置；
- 模型列表只做短期内存缓存，不写入主 TOML；
- 提供刷新按钮和最近更新时间。

### 5.6 配置诊断服务

建议新增：

```text
drsai/config/doctor.py
drsai/config/diagnostics.py
```

诊断项目：

- TOML 是否可解析、revision 是否一致；
- 当前 Provider 是否存在；
- Base URL 是否安全合法；
- Key 来源是否存在且可读取；
- 环境变量是否已设置，但不读取展示具体值；
- 协议与端点是否匹配；
- 当前模型是否能被发现或最小调用；
- 是否存在孤儿凭据、旧格式和可迁移配置；
- 最后已知可用配置能否恢复。

输出包含：状态、错误码、面向用户的说明、建议操作和脱敏技术详情。

### 5.7 Gateway API

建议新增或调整：

```text
GET  /v1/config/model-state
POST /v1/config/model/preview
PUT  /v1/config/model                  expected_revision
POST /v1/config/model-providers/test   测试草稿，不落盘
GET  /v1/config/model-providers/presets
POST /v1/config/model-providers/models
POST /v1/config/model/doctor
POST /v1/config/model/restore
```

`model-state` 返回：

- 当前有效模型和 Provider；
- revision 和配置路径；
- Key 来源与可用状态，不返回 Key；
- 是否为已知模型；
- 最近测试结果和时间；
- 是否存在未生效或损坏配置；
- 当前请求继续使用旧 Client 还是新配置已生效。

所有写接口：

- 使用 `extra="forbid"`；
- 支持 `expected_revision`；
- 错误响应使用稳定错误码；
- 绝不在错误详情中回显请求 Header、响应正文或敏感参数。

### 5.8 Runtime 热更新

扩展 AgentManager 和 TUI AgentSession：

- 只消费已提交且验证通过的 revision；
- 当前生成不被中断；
- 下一轮请求构建候选 Client；
- 新 Client 成功后原子替换；
- 失败时继续使用旧 Client，并记录 `new_config_not_applied`；
- 前端可以读取当前“配置 revision”和“运行中 revision”；
- TUI、CLI、Gateway 所有模型切换必须检查真实返回值；
- 会话恢复、子智能体和上下文压缩继续使用同一有效配置快照。

### 5.9 桌面设置体验

模型服务区域改成三层结构。

#### 第一层：当前状态卡

- 当前模型；
- 当前服务商；
- 连接地址；
- Key 来源；
- 协议；
- 最近测试状态和时间；
- 配置已保存/等待下一轮生效/回退到旧 Client。

#### 第二层：简化配置表单

- 先选择服务商预设；
- “服务商/连接”替代直接展示 Provider 术语；
- “模型 ID”明确为服务端真实模型名称；
- Key 来源使用单选：
  - 系统安全保存（推荐）；
  - 环境变量；
  - 无需 Key；
- 普通模式隐藏 `wire_api` 和 `requires_api_key`；
- 自定义服务才显示 Base URL；
- 高级设置可展开查看协议细节。

#### 第三层：操作流程

- “测试草稿”不保存；
- 测试成功后显示“保存并使用”；
- 测试失败仍允许“仍然保存”，但需明确警告；
- “恢复 HepAI 默认”与“删除自定义 Provider”分开；
- 删除凭据前说明是否可恢复；
- revision 冲突时提供“重新加载”和“查看差异”。

### 5.10 TUI 体验

- Provider 编辑器支持预设选择；
- Key 来源使用互斥选项，不同时展示多个输入框；
- `Ctrl+T` 改为测试草稿，不先保存；
- 显示最近测试结果和修复建议；
- 模型选择器支持模型发现、搜索和手工输入；
- 切换失败时不显示成功；
- 未知模型继续显示“能力未校准”；
- 保存后显示具体生效时机。

### 5.11 CLI 体验

新增：

```text
drsai provider setup
drsai provider test <name> --mode basic|model
drsai provider models <name>
drsai config doctor
drsai config status
drsai config restore
```

`provider setup` 向导流程：

```text
选择预设
→ 填写必要字段
→ 选择 Key 来源
→ 测试草稿
→ 选择或输入模型
→ 展示变更预览
→ 确认提交
```

非交互模式保留，便于脚本和自动化。输出支持人类可读格式和 `--json`。

### 5.12 错误指导与本地化

建立统一错误目录，由 Gateway、CLI、TUI 和桌面共同使用：

```text
error_code
title
user_message
recommended_actions[]
technical_detail
retryable
```

示例：

```text
authentication_failed
API Key 无效
请检查 Key 是否复制完整，以及该 Key 是否有访问当前模型的权限。
建议：重新输入 Key / 检查账户权限 / 切换环境变量来源
```

首阶段覆盖中英文，错误码保持语言无关。

## 6. 实施阶段

### Phase A：事务与凭据可靠性（P0）

- 实现事务配置服务、revision 和文件锁；
- 所有写入口迁移到统一服务；
- 实现完整候选配置预校验；
- 修复凭据损坏、引用校验和回滚；
- Provider 删除和恢复默认改为原子事务；
- Runtime 只消费已验证 revision。

完成标准：任何失败写入均不改变有效 TOML、凭据和运行中 Client；并发写入不会静默丢失。

### Phase B：无副作用测试与诊断（P0）

- 实现草稿连接测试；
- 拆分基础连接和模型调用模式；
- 实现统一错误码和修复建议；
- 实现 `config doctor/status/restore`；
- 加入最后已知可用配置状态。

完成标准：用户可以在不保存配置的情况下完成测试，并能从错误结果直接找到下一步操作。

### Phase C：预设与模型发现（P1）

- Provider 预设注册表；
- 模型列表获取、缓存、搜索和手工输入；
- 已校准/未校准能力展示；
- 预设驱动的最小字段表单。

完成标准：常见服务配置无需手工理解协议字段，自定义服务仍保持完整能力。

### Phase D：桌面/TUI/CLI 用户流程（P1）

- 桌面状态卡、Key 来源单选、测试后保存流程；
- TUI 草稿测试、预设和搜索；
- CLI `provider setup` 向导；
- 恢复默认、删除 Provider 和删除凭据的分离交互；
- revision 冲突处理。

完成标准：新用户可以只依赖界面或向导完成一次成功配置；高级用户仍可手工编辑 TOML。

### Phase E：发布、遥测与文档（P2）

- 更新使用手册、故障排查和迁移说明；
- 增加脱敏的失败分类计数，不采集 URL、模型内容或 Key；
- Windows/macOS 打包验证；
- 灰度开启新写入服务并保留回退开关；
- 删除已稳定替代的旧多步写入口。

## 7. 测试验证方案

### 7.1 配置事务单元测试

- 合法候选配置一次提交成功；
- 非法 URL、未知 Provider 和互斥 Key 来源不落盘；
- Provider 与模型选择同时提交，不出现半完成状态；
- 第二步、fsync、replace 或 chmod 失败时恢复原配置；
- 新凭据提交失败时删除新引用、保留旧引用；
- 提交成功后才删除旧凭据；
- `expected_revision` 匹配成功、不匹配返回冲突；
- 未知字段被拒绝；
- 注释、平台表和未知字段保持不变；
- 最后已知可用快照可恢复。

### 7.2 并发与文件系统测试

- 两个线程同时修改不同 Provider；
- Gateway 与 CLI 同时提交；
- 两个独立进程同时提交；
- 手工修改发生在 preview 和 commit 之间；
- lock 持有者崩溃后的超时恢复；
- Windows、macOS、Linux 文件锁行为；
- 网络盘或不支持原子替换文件系统的明确失败；
- 不允许死锁、无限等待和静默覆盖。

### 7.3 凭据测试

- DPAPI、Keychain、Fernet 正常保存、读取、替换和删除；
- 无效引用、丢失文件、损坏密文、错误主密钥；
- 平台安全存储不可用时的降级和用户提示；
- orphan 扫描不删除仍被 TOML 引用的凭据；
- 日志、异常、JSON、IPC、进程参数和诊断包扫描无明文 Key；
- Renderer 永远只获得状态与来源；
- 64 KiB 上限、空 Key 和异常 Unicode。

### 7.4 连接测试单元与契约测试

- OpenAI `/models` 可用和不可用；
- 只有聊天接口的 OpenAI-compatible 服务；
- Anthropic-compatible 最小调用；
- 无 Key 本地服务；
- DNS、TLS、代理、超时、断网和取消；
- 401、403、404、429、5xx 和非法 JSON；
- 模型不存在与端点不存在的区分；
- 基础测试不产生持久化变更；
- 模型测试明确标注可能产生费用；
- 返回值不包含响应正文和敏感 Header。

### 7.5 Runtime 热更新测试

- 当前生成期间提交新 revision，不中断生成；
- 下一轮使用新配置；
- 新 Client 创建失败继续使用旧 Client；
- 配置与运行中 revision 状态正确；
- 手工修改 TOML 的下一轮检测；
- 会话恢复、子智能体和上下文压缩使用一致配置；
- TUI 所有切换路径检查实际返回值；
- 多会话只在各自下一轮安全切换。

### 7.6 Gateway API 测试

- preview 不写文件、不创建凭据；
- commit 携带 revision 并返回有效快照；
- 冲突返回稳定的 409 错误；
- 草稿测试可接受一次性 Key，但响应和日志不回显；
- Provider 预设和模型列表响应限长；
- doctor、restore 和 model-state 全部脱敏；
- 未认证的非本地请求不可访问配置 API；
- 请求大小、字段长度和额外字段限制。

### 7.7 桌面 E2E

- 新用户选择预设、输入 Key、测试、选择模型并保存；
- 测试失败后当前配置保持不变；
- 测试成功后保存并在下一轮生效；
- Key 来源三种模式互斥；
- 未知模型警告但允许继续；
- revision 冲突提示和重新加载；
- 恢复 HepAI 不误删自定义 Provider；
- 删除 Provider 时可选择是否删除安全凭据；
- 重启后状态恢复；
- Windows/macOS Renderer 均无 Key。

### 7.8 TUI E2E

- 预设配置和高级自定义配置；
- `Ctrl+T` 测试草稿且不落盘；
- 模型搜索、手工输入和未校准提示；
- 切换失败显示失败并保留旧模型；
- 保存后显示 revision 和生效时机；
- 窄终端、键盘导航、取消和中断。

### 7.9 CLI 测试

- `provider setup` 各分支和取消流程；
- 非交互参数与向导生成相同候选配置；
- `config doctor/status/restore` 人类格式和 JSON 格式；
- `--force` 仅显式绕过 revision 冲突；
- stdin/TTY 缺失时行为明确；
- 命令输出和 shell 历史安全提示。

### 7.10 可用性验证

邀请首次使用用户完成以下任务：

1. 配置 DeepSeek；
2. 配置本地 Ollama；
3. 修复错误 Key；
4. 从测试失败恢复到 HepAI；
5. 找到并选择一个未登记模型。

观测指标：

- 首次成功配置完成率；
- 从打开设置到首次成功测试的时间；
- 用户需要展开高级设置的比例；
- 错误后能够自行恢复的比例；
- 因 Provider、协议和模型 ID 概念产生的误操作数量。

目标建议：常见预设首次成功率不低于 90%，中位配置时间低于 3 分钟。

## 8. 发布门禁

发布前必须满足：

- 配置事务、并发和回滚测试全绿；
- Python 全量测试、TUI 类型检查、Windows/macOS 类型检查全绿；
- 桌面 Provider 契约和 Secret 扫描全绿；
- Windows/macOS 至少各完成一次打包后配置 E2E；
- 故障注入覆盖写入失败、凭据损坏和 Client 重建失败；
- 不存在任何已知的明文 Key 泄漏路径；
- 旧 TOML 和现有 CLI 参数兼容；
- 新写入服务具备功能开关和回退方案；
- 用户文档、CLI help 和界面文案保持一致。

## 9. 验收标准

### 9.1 工程可靠性

- 非法配置永不覆盖当前有效配置；
- 并发修改永不静默丢失；
- Provider、模型和凭据替换具备原子语义；
- 新配置失败不会中断当前生成或破坏旧 Client；
- 损坏凭据返回可处理错误，不产生未捕获异常；
- 所有状态和错误响应通过 Secret 扫描。

### 9.2 用户易用性

- 常见 Provider 配置默认不要求用户理解协议字段；
- 测试草稿不会改变当前配置；
- Key 来源在 UI 中始终互斥且含推荐项；
- 错误提示至少提供一个可执行修复建议；
- 当前有效配置、生效状态和最近测试结果集中可见；
- 模型可搜索、可发现，也可手工输入；
- 恢复默认、删除 Provider 和删除凭据是三个明确操作。

### 9.3 兼容性

- 现有 `~/.drsai/config.toml` 无需迁移即可继续工作；
- 手工编辑 TOML 仍受支持；
- 原有 CLI 参数和脚本保持兼容；
- HepAI 默认用户不增加强制配置步骤；
- OpenAI-compatible、Anthropic-compatible 和本地无 Key 服务均通过验收。

## 10. 推荐优先级与工作量

| 优先级 | 工作包 | 建议工作量 | 依赖 |
|---|---|---:|---|
| P0 | 事务配置服务、revision、文件锁 | 5–8 人日 | 无 |
| P0 | 凭据事务与损坏恢复 | 3–5 人日 | 事务配置服务 |
| P0 | 草稿测试、错误码、Doctor | 5–7 人日 | 事务预览接口 |
| P1 | Provider 预设与模型发现 | 4–6 人日 | Probe 服务 |
| P1 | 桌面设置流程重构 | 5–8 人日 | 新 Gateway API |
| P1 | TUI 与 CLI 向导 | 4–6 人日 | 新 Gateway/Config Service |
| P2 | E2E、故障注入、打包验证和文档 | 4–7 人日 | 前述全部 |

建议先完成 Phase A 和 Phase B，再并行推进桌面、TUI 和 CLI。总工作量预计约 30–47 人日，实际取决于跨平台凭据及桌面 E2E 基础设施的复用程度。

## 11. 建议的第一批开发任务

1. 建立 `TransactionalConfigService` 和候选配置内存合并模型。
2. 为所有现有写接口增加失败不落盘测试，再迁移实现。
3. 引入 revision、进程内锁和跨进程 lock file。
4. 将凭据写入改为 prepare/commit/rollback。
5. 新增草稿测试 API，桌面“测试连接”停止先保存。
6. 统一错误码和修复建议目录。
7. 修复 TUI 切换结果检查。
8. 增加 `drsai config doctor` 和 `drsai config status`。
9. 完成 P0 故障注入和并发测试后，再开始预设及界面重构。

这组任务能最先消除数据一致性风险，同时直接改善用户最容易感知的“测试失败却改坏当前配置”和“错误后不知道怎么办”两类问题。
