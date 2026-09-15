# OpenDrSai Tavily 网页搜索集成 P2：按需配置与运行恢复方案

> 状态：待实施
> 日期：2026-08-10
> 前置阶段：[Tavily 搜索工具集成 P1](./opendrsai-tavily-web-search-p1-integration-plan.md)
> 上游架构：[BAMS 资源配置架构](./opendrsai-bams-resource-configuration-architecture.md)
> 适用范围：Desktop 优先，契约覆盖 TUI、Android 和 Remote Runtime

## 1. 阶段结论

P2 解决“能力已经存在，但新用户尚未配置”的首次使用问题。

OpenDrSai 当前没有自有搜索代理服务，不提供共享 Tavily Key，也不静默调用第三方公共搜索。用户第一次提出需要近期公共网络信息的问题时，系统应当：

1. 判断本次任务需要 `web.search` 或 `web.extract`；
2. 发现没有可用的网页搜索感知器；
3. 将运行暂停在可恢复状态；
4. 在对话中解释为什么需要联网；
5. 引导用户配置自己的 Tavily API Key；
6. 验证成功后自动恢复原运行，无需重新提问；
7. 最终回答继续使用统一来源和运行证据展示。

用户界面的一级名称统一使用“网页搜索”，Tavily 只作为服务提供方出现。内部资源仍使用 `adapter = "tavily"`，模型工具仍为 `web_search` 和 `web_fetch`。

## 2. 产品前提与边界

### 2.1 明确前提

- OpenDrSai 没有自有 Tavily 代理或托管搜索网关；
- 用户必须提供自己的 Tavily API Key；
- API Key 使用本机安全凭据存储，不写入对话、日志、Run Snapshot 或明文 TOML；
- OpenDrSai 不内置共享 Key，不代用户注册 Tavily，不承诺第三方免费额度；
- 配置前不得把查询内容发送给 Tavily；
- 用户必须能拒绝联网并选择基于已有知识回答。

### 2.2 P2 包含

- 网页搜索需求识别与能力预检；
- 结构化“能力未配置”事件；
- 对话内配置引导卡；
- 轻量网页搜索配置面板；
- Tavily Key 保存、最小连接测试与状态反馈；
- 配置完成后的原运行恢复；
- Run Inspector 完整记录暂停、配置和恢复过程；
- 缺失、不可解密、无效、限额、断网和超时等状态的差异化引导；
- Desktop 完整体验和跨端公共契约。

### 2.3 P2 不包含

- OpenDrSai 官方托管搜索；
- OpenDrSai 共享 Tavily Key；
- 自动注册或代购 Tavily 服务；
- Brave、SearXNG、Exa、Firecrawl 等新增 Provider；
- 未经用户确认自动降级到浏览器搜索；
- 长期知识库自动抓取；
- Tavily Images、Crawl、Map、Research 等扩展 API。

## 3. 目标体验

验收主场景：全新安装 OpenDrSai，没有配置任何网页搜索感知器，用户直接询问：

> HEPiX 2026 是什么？

系统不应输出 `API key missing`、`perceptor unavailable` 或 Python 异常。推荐交互如下：

```text
需要网页搜索

“HEPiX 2026”可能涉及近期活动信息。连接网页搜索后，我可以查询
官方网站、会议页面和最新日程。

[配置网页搜索]  [暂不联网，基于已有知识回答]
```

点击“配置网页搜索”后，在对话侧边抽屉或轻量弹窗中展示：

```text
网页搜索

服务提供方：Tavily
OpenDrSai 会将搜索请求发送给 Tavily。API Key 将加密保存在本机。

API Key  [________________________]
[如何获取 API Key]

[取消]  [保存并继续搜索]
```

配置成功后系统自动继续原问题，最终回答附带来源。用户不需要重新输入“HEPiX 2026 是什么”。

## 4. 体验原则

### 4.1 解释任务需要，而不是暴露技术故障

提示应先回答“为什么现在需要联网”，再说明“由 Tavily 提供服务”。禁止把 Provider 异常原文直接显示给普通用户。

### 4.2 配置是运行的一部分

能力缺失不是终态失败。当前运行进入 `awaiting_capability_configuration`，配置成功后从原检查点恢复。

### 4.3 明确的数据边界

配置确认前不向 Tavily发送查询。配置界面明确展示服务提供方、将发送的数据类型和本机凭据存储方式。

### 4.4 用户始终拥有选择权

用户可以：

- 配置并继续；
- 暂不联网，允许模型基于已有知识谨慎回答；
- 取消本次运行；
- 前往完整“设置 → 感知器配置 → 网页搜索”管理资源。

选择“不联网回答”时，回答必须明确可能不完整或过时，且不得伪造已搜索状态或来源。

## 5. 能力预检

### 5.1 触发条件

以下情况应优先预检 `web.search`：

- 用户明确要求搜索、查询官网、查最新信息或提供来源；
- 问题包含明显时效性对象，如会议日程、新闻、价格、政策、版本或当前人物；
- Agent 规划阶段决定调用 `web_search`；
- 模型实际发起 `web_search` Tool Call。

前两项可用于提前引导，但最终安全边界必须位于 Tool Router：即使规划阶段没有识别，Tool 执行前仍必须检查能力。

### 5.2 可用性判定

`web.search` 可用需要同时满足：

- Agent 策略允许网页搜索；
- 存在启用的 `public_web` 感知器；
- 感知器声明 `web.search` 能力；
- Tavily 凭据可以解析；
- 当前 Host 允许网络访问；
- 没有被组织策略或运行策略禁止。

本地配置文件存在不等于能力可用；同样，凭据不可用也不应删除或隐藏感知器资源本身。

## 6. 结构化契约

### 6.1 能力配置请求

Kernel/Router 不返回供前端解析的异常字符串，而是产生结构化事件：

```json
{
  "type": "capability_configuration_required",
  "event_id": "evt_...",
  "run_id": "run_...",
  "capability": "web.search",
  "resource_kind": "public_web",
  "preferred_adapter": "tavily",
  "reason": "credential_missing",
  "resume_token": "opaque-short-lived-token",
  "resume_supported": true,
  "query_disclosed": false,
  "user_message": {
    "title": "需要网页搜索",
    "purpose": "查询近期公开信息和来源"
  }
}
```

允许的 `reason`：

- `resource_missing`
- `resource_disabled`
- `credential_missing`
- `credential_unavailable`
- `credential_invalid`
- `quota_exhausted`
- `network_unavailable`
- `provider_timeout`
- `policy_denied`

`preferred_adapter` 只是 UI 建议，不进入模型 Tool Schema。`resume_token` 不包含用户问题、API Key 或其他敏感信息。

### 6.2 配置完成事件

```json
{
  "type": "capability_configuration_resolved",
  "run_id": "run_...",
  "capability": "web.search",
  "resource_id": "web-tavily-main",
  "resource_revision": "sha256:...",
  "resume_token": "opaque-short-lived-token"
}
```

Runtime 收到后重新进行能力解析，不直接信任前端声称的“已配置”。只有后端能够解析凭据并完成最小连接测试，运行才可以恢复。

### 6.3 用户拒绝联网

```json
{
  "type": "capability_configuration_declined",
  "run_id": "run_...",
  "capability": "web.search",
  "action": "answer_without_network"
}
```

Kernel 将该决定写入本次 Run Snapshot，只对本次运行有效，不得静默修改 Agent 的长期工具策略。

## 7. 运行状态机

```text
created
  -> planning
  -> capability_check
  -> awaiting_capability_configuration
       -> configuring
       -> validating
       -> resuming
  -> running_tool
  -> composing_answer
  -> completed
```

其他终点：

```text
awaiting_capability_configuration
  -> answer_without_network
  -> composing_answer

awaiting_capability_configuration
  -> cancelled

validating
  -> awaiting_capability_configuration  (验证失败，可修复)
```

要求：

- 等待用户配置期间不占用模型生成连接；
- 暂停状态可跨页面导航保留；
- `resume_token` 有时效、绑定 `run_id`，且只能消费一次；
- 恢复前重新读取最新感知器 revision；
- 应用重启后可以显示“等待配置”，但过期运行不得自动发送旧查询；
- 同一能力的并发缺失请求合并为一个配置流程，成功后分别恢复仍有效的运行。

## 8. UI 设计

### 8.1 对话引导卡

卡片至少包含：

- 需要的能力：“网页搜索”或“网页读取”；
- 为什么本问题需要该能力；
- 第三方提供方：Tavily；
- 主操作：“配置网页搜索”；
- 次操作：“暂不联网”；
- 可选链接：“了解发送给 Tavily 的数据”。

卡片不能显示 Key、凭据引用、内部 Adapter 路径或原始异常。

### 8.2 轻量配置面板

复用“设置 → 感知器配置”的网页搜索编辑器，避免形成两套保存逻辑。首次配置只显示必要字段：

- 服务提供方：Tavily，只读；
- API Key；
- 服务地址，默认折叠在高级设置；
- 隐私说明；
- 获取 API Key 的外部链接；
- “保存并继续搜索”。

搜索深度、读取深度、超时和单页字符上限保留默认值，不阻塞首次配置。高级用户可以之后在完整设置页调整。

### 8.3 运行与调试面板

必须依次展示：

```text
已判断本问题需要近期公开信息
网页搜索尚未配置
等待用户配置网页搜索
网页搜索配置验证成功
已恢复原运行
正在搜索 HEPiX 2026
已获取 3 个来源
```

这些是运行事件，不是拼接到模型正文中的文本。调试详情可以显示 `capability`、`resource_id`、revision、耗时和结构化错误码，但不得显示凭据。

## 9. 状态与文案映射

| 状态 | 用户文案 | 主操作 |
|---|---|---|
| `resource_missing` | 尚未连接网页搜索 | 配置网页搜索 |
| `resource_disabled` | 网页搜索已关闭 | 启用并继续 |
| `credential_missing` | 网页搜索需要 API Key | 输入 API Key |
| `credential_unavailable` | 已保存的网页搜索凭据不可用 | 重新输入凭据 |
| `credential_invalid` | Tavily 未接受当前 API Key | 更新 API Key |
| `quota_exhausted` | Tavily 账户额度不足 | 查看 Tavily 账户 |
| `network_unavailable` | 当前无法连接网页搜索服务 | 重试 |
| `provider_timeout` | 网页搜索响应超时 | 重试 |
| `policy_denied` | 当前策略不允许网页搜索 | 查看策略 |

“未配置”和“凭据不可用”必须区分。已经存在的感知器配置、模型目录或其他非敏感元数据不因 Key 失效而隐藏。

## 10. 架构落点

### 10.1 Python Core

建议增加或扩展：

```text
backend/runtime/capabilities/
├─ contracts.py          # 配置请求、恢复结果和错误分类
├─ preflight.py          # Agent/Resource/Host 能力预检
└─ suspension.py         # 暂停、恢复和 token 生命周期

backend/runtime/web_search/
├─ router.py             # 在 Tool 执行边界产生能力缺失事件
└─ providers/tavily/     # P1 Adapter，不承载 UI 逻辑
```

依赖方向：

```text
Agent Run
  -> Capability Preflight
  -> Web Search Router
  -> Perceptor Registry
  -> Tavily Adapter
```

Tavily Adapter 只负责 Tavily API；它不决定是否弹窗、不生成用户文案，也不管理运行恢复。

### 10.2 Gateway API

建议提供：

```text
POST /v1/runs/{run_id}/capabilities/{capability}/resolve
POST /v1/runs/{run_id}/capabilities/{capability}/decline
GET  /v1/runs/{run_id}/pending-capabilities
```

感知器继续复用现有 CRUD 与测试接口。`resolve` 接口只接受资源 ID、revision 和恢复 token，不接受明文 API Key；Key 先通过感知器保存接口进入安全凭据存储。

### 10.3 Desktop

- Structured Message Renderer 增加能力引导卡；
- 复用 `PerceptorSettingsPanel` 的网页搜索表单；
- 配置成功后调用运行恢复接口；
- 同步刷新全局感知器列表和 Agent 能力预览；
- App 重载后从 Run 状态重建等待卡；
- IPC/Gateway 未就绪时展示可恢复状态，不向输出栏重复抛异常。

## 11. 安全与隐私

1. 用户确认配置并继续前，查询文本不得发送给 Tavily。
2. API Key 只能从 Renderer 提交到受控 IPC/Gateway 保存接口，不得进入 React 日志或分析事件。
3. 配置响应只返回 `has_credential`、`credential_status` 和 revision。
4. Tavily HTTP Header、原始错误体和响应调试信息必须脱敏。
5. “如何获取 API Key”打开 Tavily 官方页面前需要清楚表明将离开 OpenDrSai。
6. 运行证据记录 Provider ID 和请求结果，不记录 API Key。
7. 用户选择不联网时，不得通过其他隐式 Provider 或浏览器绕过选择。
8. 删除网页搜索感知器时继续清理其安全凭据引用。

## 12. 失败与恢复策略

### 12.1 保存失败

保留用户当前输入但不写日志，显示可操作错误。不得把运行标记为普通 Tool 失败；运行继续处于等待配置状态。

### 12.2 验证失败

- 401/403：提示更新 API Key；
- 429/配额错误：提示检查 Tavily 账户；
- DNS/断网：允许重试，不要求重新输入 Key；
- 超时：允许重试或进入高级设置调整超时；
- 服务端错误：保留配置，提示稍后重试。

### 12.3 恢复失败

若配置已经成功但原运行不可恢复：

- 保留已配置的网页搜索感知器；
- 清楚提示原运行已过期；
- 提供“重新运行原问题”，由用户确认后创建新 Run；
- 不自动复制或发送包含敏感信息的旧输入。

## 13. 遥测与产品度量

仅记录非敏感聚合事件：

- `web_search_configuration_prompted`
- `web_search_configuration_started`
- `web_search_configuration_succeeded`
- `web_search_configuration_failed`，仅含错误类别
- `web_search_configuration_declined`
- `run_resumed_after_capability_configuration`

核心指标：

- 引导卡到配置开始的转化率；
- 配置开始到验证成功的完成率；
- 验证失败原因分布；
- 配置成功后原运行恢复率；
- 从引导出现到得到首个搜索结果的耗时；
- 用户选择“不联网回答”的比例。

严禁记录查询全文、API Key、凭据引用或 Tavily 原始响应。

## 14. 实施拆分

### P2-A：结构化能力缺失

- 定义事件、错误码和运行暂停状态；
- 在 Web Search Router 执行边界实施预检；
- Run Journal 和 Inspector 支持等待状态；
- 单元测试覆盖所有 `reason`。

### P2-B：对话内引导

- 新增“需要网页搜索”结构化卡片；
- 提供配置、暂不联网和取消操作；
- 解释 Tavily 数据边界；
- 支持刷新后恢复卡片。

### P2-C：轻量配置与验证

- 复用网页搜索感知器表单；
- 安全保存用户自己的 Tavily Key；
- 完成最小连接测试；
- 映射认证、配额、断网和超时错误。

### P2-D：运行恢复

- 生成并校验一次性恢复 token；
- 配置成功后重新解析能力；
- 从原 Tool 节点继续执行；
- 处理并发等待、过期和应用重启。

### P2-E：跨端与发布验证

- Desktop 完整 E2E；
- TUI 文本式配置引导；
- Android 使用同一公共事件契约；
- Remote Runtime 明确 Host/凭据归属；
- 隐私、脱敏、无共享 Key 和无隐式请求测试。

## 15. 测试矩阵

### 15.1 单元测试

- 没有感知器时产生 `resource_missing`；
- 感知器禁用时产生 `resource_disabled`；
- 凭据引用存在但不可解密时产生 `credential_unavailable`；
- Key 无效、配额、断网和超时映射正确；
- 不联网选择只作用于当前 Run；
- 恢复 token 过期、跨 Run 或重复消费均被拒绝；
- 任何公共响应和日志都不包含 API Key。

### 15.2 集成测试

- 保存 Key、测试连接、恢复原运行形成完整链路；
- 配置前 Tavily mock 未收到查询；
- 配置后原始 query 只执行一次；
- Renderer 刷新后仍能恢复等待卡；
- 多个运行同时等待网页搜索时不重复创建资源；
- Gateway 重启后感知器配置仍存在，过期 Run 不被自动发送。

### 15.3 端到端验收

全新 `DRSAI_HOME`：

1. 启动 OpenDrSai；
2. 不进入设置，不创建感知器；
3. 询问“HEPiX 2026 是什么？”；
4. 出现“需要网页搜索”卡片；
5. 确认此时 Tavily 未收到查询；
6. 点击“配置网页搜索”；
7. 输入用户自己的有效 Tavily API Key；
8. 点击“保存并继续搜索”；
9. 显示验证成功并自动恢复；
10. 得到包含真实来源的回答；
11. 设置页出现“网页搜索”，提供方为 Tavily；
12. Run Inspector 展示能力检查、等待配置、验证、恢复和搜索证据；
13. 所有日志和 UI 均不出现 API Key。

## 16. 完成定义

P2 完成必须同时满足：

- [ ] 新用户无需预先理解“感知器”或 Tavily，即可在首次需要联网时获得清楚引导；
- [ ] OpenDrSai 不包含、分发或调用共享 Tavily Key；
- [ ] 配置确认前不向 Tavily 发送用户查询；
- [ ] 用户可以拒绝联网，且系统不绕过选择；
- [ ] 配置成功后原问题自动继续，无需重新输入；
- [ ] 能力缺失是可恢复运行状态，不是普通错误；
- [ ] “未配置”“凭据不可用”“Key 无效”“额度不足”和“网络故障”有不同提示；
- [ ] 设置页和对话内配置复用同一保存与校验逻辑；
- [ ] Run Inspector 能完整解释暂停和恢复过程；
- [ ] Desktop E2E、契约测试、安全测试和脱敏测试通过。

## 17. 后续阶段

未来如果 OpenDrSai 提供官方托管搜索，应作为新的 Provider 和商业/隐私方案单独设计，不能把本 P2 的“用户自备 Tavily Key”静默替换为代理服务。届时至少需要补充账户配额、数据处理说明、地区合规、费用归属和显式 Provider 选择。
