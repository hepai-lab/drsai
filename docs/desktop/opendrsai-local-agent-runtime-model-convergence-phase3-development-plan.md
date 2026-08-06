# OpenDrSai 本地 Agent Runtime 模型收敛 P3 专项开发方案

> 2026-08-06 权威来源修订：移除 `inherit_provider_default` 及全部全局默认模型语义。每次 OpenDrSai 运行只解析所选智能体明确配置的 `primary_model` 与各能力模型；Runtime 拒绝策略缺失/无效以及裸 `model` 覆盖。旧顶层字段只允许在能唯一解析提供方与模型时迁移，迁移完成后删除。

> 状态：实施中（P3-MC01～P3-MC05 已完成本地验收，5/8，62.5%）  
> 制定日期：2026-08-05  
> 阶段：Windows Full Agent Runtime 第三阶段（P3）专项  
> 关联总计划：`opendrsai-windows-full-agent-runtime-phase3-product-completion-plan.md`  
> 适用范围：本地 OpenDrSai Agent Backend、模型提供方配置、Windows/macOS 共享 Desktop 代码  
> 明确排除：Codex 自有模型目录、HAI 平台远程 Agent 自有模型、STT/TTS 专用模型

## 1. 结论与阶段判断

下一阶段应定为 **P3：模型目录与智能体配置收敛专项**，不应另起 P4。

原因是模型选择仍未形成“配置—选择—执行—证据”的闭环，它直接阻断现有 P3 总计划所要求的首次使用、真实任务和可追溯运行。当前实现已经具备 Provider 安全配置、模型发现、Runtime model override 和配置 revision 等基础，但还不能称为功能完整：

1. 文本模型可以从 Desktop 传到 Runtime，但只传裸 `model` 字符串，Provider、模型能力和目录 revision 丢失；
2. Provider 模型目录、旧 `llm_mode_config` 目录和账号 `/v1/models` 目录同时存在，合并规则只按字符串去重；
3. “图像模型”是固定的 `nano-banana-2-lite` 前端偏好，没有 Provider 来源，也没有进入任何 Runtime 请求；
4. 当前没有可确认的生产图像生成/编辑执行适配器，原生多模态图片输入链路也没有完整的请求形态与验收证据；
5. Runtime Manifest 把模型 Provider 记录成 Agent Backend `opendrsai`，无法证明实际调用了哪个模型服务。

因此，P3 的完成标准不是“下拉框能列出模型”，而是：

> 本地 OpenDrSai Agent 的每一种模型用途，都只能引用模型提供方目录中的可用模型；Runtime 在执行前按能力校验，按 Provider 构建客户端，并把最终 Provider、模型、能力来源和配置 revision 写入运行证据。

## 2. 审计范围与术语边界

本专项将模型分成三类用途，禁止继续用一个含义模糊的 `vision` 布尔值代替：

| 用途 | 最低能力 | 产品含义 |
| --- | --- | --- |
| 主文本模型 | 文本输入、文本输出；Agent 模式还需工具调用 | 对话、推理、计划和工具调用 |
| 多模态理解模型 | 图片输入、文本输出，可与主文本模型为同一个模型 | 理解截图、照片和图片附件，不等于生成图片 |
| 图像生成/编辑模型 | 图片输出；编辑还需图片输入和明确的编辑 operation | 生成或编辑图片，必须有专用执行适配器和 Artifact 输出 |

以下服务不纳入本专项目录：

- Codex Backend 的模型由 Codex Backend catalog 和账户状态管理；
- HAI 平台远程 Agent 的模型由平台 Agent 描述符管理；
- 语音识别和语音合成目前走独立 Voice Runtime/环境变量，应在后续“AI 服务目录”专项处理，不能伪装成本地 Agent 模型；
- 模型能力注册表可以补充元数据，但不能再作为用户可选择模型的独立来源。

## 3. 当前代码实现盘点

### 3.1 当前模型来源

| 来源 | 主要模块 | 当前职责 | 问题 |
| --- | --- | --- | --- |
| Provider 配置 | `drsai/config/schema.py`、`loader.py`、`resolver.py` | 保存当前 Provider、默认模型、`models` 字符串列表和别名 | 只有字符串列表；无输入/输出模态、operation、状态和能力来源 |
| Provider 发现 | `drsai/config/model_discovery.py` | 请求 `{base_url}/models`，返回模型 ID 和部分内建能力 | `model_details` 未进入 Desktop 类型和选择链；未知模型使用过于乐观的通用能力 |
| 旧本地 LLM 目录 | `drsai/backend/run_drsai_agent_factory.py` | 内置 `DEFAULT_LLM_MODE_CONFIG`，读取 `llm_mode_config.yaml` | 与新 Provider 目录并存，仍是 Runtime fallback 和 `/v1/models/config` 的来源 |
| HAI 账号目录 | Gateway `/v1/models`、Desktop `getGatewayModels()` | 使用登录 access token 获取账号可用模型 | Desktop 只保留 `id/name`，Provider 和能力信息丢失 |
| Desktop 合并目录 | `apps/desktop/shared/main/myDrSaiConfig.ts` | 合并 `/v1/models/config` 与账号 `/v1/models` | 按 alias/model 字符串拼接，可能混合不同 Provider 和不同可信度的数据 |
| Backend 专属目录 | `apps/desktop/shared/main/agents.ts` | Codex/平台 Agent 提供自己的模型列表 | 合理，但当前共用设置 UI 容易被误认为 Provider 模型 |
| 图像模型常量 | `apps/desktop/shared/renderer/src/App.tsx` | 固定显示 `nano-banana-2-lite` | 无配置来源、无能力描述、无 Runtime 消费，是未接线 UI |

### 3.2 当前文本模型调用链

```text
Provider/旧目录/账号目录
  -> getMyDrSaiConfig().mergeModels()
  -> App.getAgentModelOptions()
  -> localStorage agentConfigurations[agentId].model
  -> startChat({ model: string })
  -> Runtime executeAgentRun({ model: string })
  -> RuntimeAgentService model_override
  -> GatewayOpenDrSaiAgentBackend definition.model
  -> AgentManager.run_stream(model_alias)
  -> create_agent()/resolve_model_config()
  -> HepAI/OpenAI/Anthropic client
```

这条链可以让模型字符串到达生产 Agent，但有五处语义降级：

1. `model` 没有携带 `provider_id`，同名模型无法唯一定位；
2. Agent 配置只保存在 Renderer `localStorage`，没有服务端校验、revision 或跨窗口一致性；
3. `ProviderConfig.models` 没有约束最终选择，`model_aliases` 仅用于展示/存储，没有参与实际模型解析；
4. Runtime 接收 override 时不校验模型是否仍在当前账号或 Provider 目录中；
5. Run Manifest 的 Provider 当前取 `run.backend_id`，最终会记录为 `opendrsai`，不是 `hepai`、`openai` 或自定义 Provider。

### 3.3 当前图片输入链

Desktop 会把附件暂存到 Workspace，并把路径提示加入 Agent prompt。模型目录中的 `vision` 主要用于展示和上下文预算；当前代码不能证明图片附件被转换为 Provider 原生的多模态 content block。

这意味着：

- 模型可能通过文件工具间接读取图片，但这不等于原生图片理解；
- 将模型标记为 `vision=true` 不会自动形成多模态请求；
- 非视觉模型和视觉模型目前缺少明确的提交前校验与降级说明。

### 3.4 当前图片生成/编辑链

当前生产代码中只有 Renderer 的 `imageModel` 偏好和固定选项；没有发现：

- Provider 图像生成/编辑 operation 配置；
- Desktop 请求中的 `imageModel` 字段；
- Runtime 的 image model selection；
- `/images/generations`、图片编辑或等价 Provider adapter；
- 图片结果转成 Runtime Artifact/OAEP Event 的闭环。

因此该功能当前应判定为 **未实现**，不能以设置页下拉框作为已支持能力。

## 4. 合理且应保留的实现

以下基础设计正确，应增量演进而不是推倒重写：

1. `config.toml` 的事务提交、revision、跨进程锁、last-known-good 和凭据安全存储；
2. HepAI 使用请求作用域 OIDC access token，不把 token 写入 Provider 配置；
3. Provider 的 OpenAI/Anthropic 协议适配和基础/真实模型两级测试；
4. 配置更新后当前生成不中断、下一轮原子创建新 Client 的策略；
5. Runtime Session/Run、Agent Definition、OAEP、Manifest 和 Run Inspection 作为唯一执行及证据链；
6. Codex 和平台 Agent 的 Backend-owned model catalog 边界；
7. 模型能力注册表作为“补充与覆盖元数据”的机制；
8. Desktop 共享 API、main 和 renderer 分层，Renderer 不直接读取凭据。

## 5. 必须修复的问题

### 5.1 P0：阻断模型收敛和真实性的问题

| ID | 问题 | 影响 | 处理决定 |
| --- | --- | --- | --- |
| P3-MC-P0-01 | 图像模型固定项没有执行链 | 用户以为已支持图片生成 | 立即隐藏未接线选项；完成真实 adapter 后再按能力显示 |
| P3-MC-P0-02 | Runtime 只接收裸模型字符串 | 同名模型冲突、选错 Provider、证据不完整 | 引入不可歧义的 `ModelRef` |
| P3-MC-P0-03 | 三套可选择目录并存 | 空列表、重复、陈旧或不可用模型 | 新建唯一 `RuntimeModelCatalogService`；旧目录只做迁移输入 |
| P3-MC-P0-04 | Provider `models` 与 `model_aliases` 不参与执行解析 | UI 保存内容与真实调用不一致 | resolver 必须校验成员关系并解析真实 upstream ID |
| P3-MC-P0-05 | 未知模型默认 `vision=True`，Client 又默认工具/JSON 能力 | 运行时才失败，可能构造错误请求 | 未知能力改为 fail-closed；只能显式探测、用户覆盖或受信注册表补全 |
| P3-MC-P0-06 | Agent 配置只存 `localStorage` | 跨窗口、重启、Provider 删除和 revision 变更时不可靠 | Gateway 持久化本地 OpenDrSai Agent model policy，并做乐观并发控制 |
| P3-MC-P0-07 | 本地 Agent catalog 硬编码 `deepseek-v4-pro` | Provider 默认变更后 Agent Square 仍显示旧模型 | 改为读取有效 Agent model policy/Provider 默认 |
| P3-MC-P0-08 | Run Manifest Provider 写成 `opendrsai` | 无法复现和审计真实模型调用 | 记录 effective Provider、upstream model ID、catalog/config revision 和能力摘要 |
| P3-MC-P0-09 | 思考强度不按模型能力过滤 | 模型拒绝不支持的参数 | 选项来自能力目录；不支持时隐藏或禁用并说明原因 |
| P3-MC-P0-10 | 原生多模态输入没有明确协议 | 图片附件可能被错误声称为视觉输入 | 建立 content-block adapter 与提交前能力校验；未支持时明确走文件工具或拒绝 |

### 5.2 P1：功能完整性和易用性问题

1. Provider 发现只返回模型字符串给 Desktop，应返回稳定的模型描述符、能力来源、更新时间和可用状态；
2. 同一模型 ID 出现在多个 Provider 时，应分组显示 Provider 名，不得仅按小写字符串去重；
3. 删除或禁用 Provider 前，应列出引用它的 Agent 配置，并提供“改用默认模型”迁移操作；
4. 账号无权限、目录超时、离线缓存和空目录必须是不同状态，不能都显示为空列表；
5. 已选模型从目录消失时不得静默保留并继续发送；应标记“已不可用”，保留用户草稿并提供替代模型；
6. Provider 配置提交后，应原子失效 Desktop 目录缓存、Agent 配置选项和 Runtime Client；
7. 模型能力冲突时要有优先级：用户显式覆盖 > Provider 可信元数据 > 内建注册表 > 未知；同时显示 provenance；
8. Provider 协议不能继续只有 `openai|anthropic` 两值。图片生成需要独立 operation/endpoint 能力，不能假设所有 OpenAI-compatible 服务都支持 `/images`；
9. 本地 OpenDrSai、Codex、平台 Agent 设置页应各自使用所属 Backend 的模型源；不适用的“图像模型”与“思考强度”不得统一硬显示。

### 5.3 P2：发布质量和后续扩展

1. 缓存要有 `fresh/stale/offline/unauthorized/error` 状态、TTL 和显式刷新；
2. 目录应支持排序、搜索、Provider 分组、用途过滤和能力徽标；
3. 真实 Provider nightly 应验证发现元数据与实际最小调用一致，并记录脱敏漂移报告；
4. 模型下线、Provider 改名和能力变化要有迁移告警及回滚策略；
5. 运行指标只记录脱敏的 Provider ID、能力类别、错误码和 revision，不记录 token、Base URL 或响应正文。

## 6. 需要移除、迁移后移除和继续保留的部分

### 6.1 立即移除或隐藏

- `App.tsx` 中固定的 `DEFAULT_AGENT_IMAGE_MODEL` 和只含 `Nano Banana 2 Lite` 的选择器；在真实图片能力可用前不展示；
- 对未知模型自动声明 `vision=True`、工具调用和 JSON 输出的乐观默认；
- 本地 OpenDrSai Agent 的硬编码 `model: "deepseek-v4-pro"` 展示值；
- 对本地 OpenDrSai、Codex 和平台 Agent 无差别展示相同模型设置项的行为。

“移除”不表示删除用户历史偏好。旧 `imageModel` localStorage 字段应只读迁移并保留一个发布周期，不能继续驱动 UI 或 Runtime。

### 6.2 完成迁移后移除

| 旧对象 | 迁移用途 | 退场门槛 |
| --- | --- | --- |
| `/v1/models/config*` 旧 LLM CRUD 作为 Desktop 可选择目录 | 读取旧 alias、token limit 和能力覆盖，写入新目录覆盖项 | 两个稳定版本无新写入；旧配置迁移率 100%；回滚演练通过 |
| `DEFAULT_LLM_MODE_CONFIG` 作为可选择模型全集 | 仅提供已知模型能力补充和旧 alias 映射 | 所有选择来自 Provider 目录；未知模型不再 fallback 到首个内建项 |
| Renderer `agentConfigurations.model: string` | 转换为 Provider-aware `ModelRef` | 新 schema 持久化成功；旧字段只读兼容两个版本 |
| `getMyDrSaiConfig().mergeModels()` 字符串拼接 | 兼容期消费新 catalog API | 所有调用方切换到统一目录；契约扫描为零 |
| Runtime `model_override: str` | 兼容接收旧客户端 | Windows/macOS/Android 支持新选择对象；旧字段无新写入两个版本 |

### 6.3 继续保留但改变职责

- `model_registry.py`：从“模型来源”改为“能力补充注册表”；
- Provider `models`：从无结构字符串列表升级为已固定模型/用户覆盖，动态发现结果单独缓存；
- `model_aliases`：明确为显示名，新增独立的 upstream ID 映射字段，避免 alias 含义混乱；
- `/v1/models`：保留 OpenAI-compatible 兼容用途；Desktop 设置不再直接把它当统一模型目录；
- `llm_mode_config.yaml`：仅作为迁移源和高级能力覆盖文件，停止成为产品默认目录。

## 7. 目标数据模型

### 7.1 Canonical ModelRef

Desktop、Gateway、Runtime 和 Manifest 统一使用：

```json
{
  "provider_id": "hepai",
  "model_id": "deepseek-v4-pro",
  "catalog_revision": "sha256:..."
}
```

规则：

- `provider_id + model_id` 是唯一身份；显示名永远不是身份；
- Runtime 执行时重新解析并校验权限，不能盲信 Renderer；
- `catalog_revision` 用于检测陈旧选择；允许服务端返回新的有效 revision，但必须把最终值写入 Manifest；
- 兼容裸字符串时，只能在当前默认 Provider 内解析，歧义或不存在必须失败，不得回退到目录第一项。

### 7.2 ModelDescriptor

```json
{
  "ref": {"provider_id": "hepai", "model_id": "example"},
  "display_name": "Example",
  "input_modalities": ["text", "image"],
  "output_modalities": ["text"],
  "operations": ["chat", "tool_calling", "reasoning"],
  "reasoning_efforts": ["low", "medium", "high"],
  "token_limit": 128000,
  "max_output_tokens": 8192,
  "availability": "available",
  "capability_source": "provider",
  "capability_confidence": "verified",
  "updated_at": "..."
}
```

必需约束：

- 图片理解：`image` 在 input、`text` 在 output；
- 图片生成：`image` 在 output 且有 `image_generation` operation；
- 图片编辑：input/output 均含 `image` 且有 `image_edit` operation；
- Agent 主模型：含 `chat`；需要工具的 Agent 还必须含 `tool_calling`；
- 未知能力使用空集合，不得默认支持。

### 7.3 AgentModelPolicy

本地 OpenDrSai Agent 配置使用：

```json
{
  "agent_id": "my-drsai",
  "primary_model": {"mode": "explicit", "ref": {"provider_id": "hepai", "model_id": "deepseek-v4-pro"}},
  "image_model": null,
  "expected_revision": "sha256:..."
}
```

`primary_model` 和各能力模型只允许显式 `ModelRef`。提供方页面只管理连接与目录，不维护模型选择；智能体页面是唯一模型策略入口。多模态主模型可以同时承担文本和图片理解；只有图片输出能力明确存在时才显示图片生成模型配置。

## 8. 目标架构和调用链

```text
Provider config + request-scoped credential
  -> ProviderCatalogAdapter (discovery)
  -> RuntimeModelCatalogService
       - canonical identity
       - capability normalization/provenance
       - availability/cache/revision
  -> AgentModelPolicyService
       - inherit or explicit ModelRef
       - role/capability validation
  -> Desktop Agent configuration
       - provider grouping and capability filtering
  -> Runtime execute intent
       - primary/image ModelRef + expected revisions
  -> Runtime ModelResolver
       - revalidate provider, account permission and capability
       - create operation-specific client
  -> Agent Backend / multimodal adapter / image tool
  -> OAEP events + Artifact + Manifest effective model evidence
```

### 8.1 目录权威规则

1. 用户可选择项只来自已配置 Provider 的统一目录；
2. Provider 动态发现是可用性事实，内建注册表只能补充能力；
3. 配置中固定的模型允许在 Provider 不支持发现时出现，但必须标注 `configured_unverified`；
4. Provider 返回空目录不自动回填内建模型；
5. 账号目录失败时可展示最后缓存，但不可把 stale 模型标记为已验证可用；
6. Provider 配置、凭据主体或模型列表变化时都生成新 catalog revision。

### 8.2 执行规则

- 每次 Run 创建前解析 effective model selection；
- 创建 Run 后不得因为目录刷新而改变该 Run 的模型；下一 Run 使用新 revision；
- Provider 删除或模型失效时，显式 override 必须报可恢复错误，继承默认可提示用户选择新默认；
- 原生图片输入由 operation adapter 生成标准 content block；仅提供文件路径不计作多模态成功；
- 图片生成/编辑作为 Runtime Tool/operation 执行，输出受信任的 Artifact 引用和 OAEP tool/artifact 事件；
- 一个模型可以同时承担多个角色，但每个角色分别校验能力。

## 9. 实现或更新的模块

### 9.1 Python 配置与目录核心

更新：

- `cores/python/packages/drsai/src/drsai/config/schema.py`
- `model_discovery.py`、`model_registry.py`、`resolver.py`
- `loader.py`、`writer.py`、`service.py`、`provider_registry.py`

新增建议：

- `drsai/config/model_catalog.py`：统一目录、revision、缓存和 provenance；
- `drsai/config/model_selection.py`：`ModelRef`、Agent role 校验和旧 alias 迁移；
- `drsai/config/model_operations.py`：chat、multimodal、image generation/edit operation 描述。

### 9.2 Gateway API

更新 `cores/python/packages/drsai/src/drsai/backend/gateway.py`：

- 新增统一目录 `GET /v1/config/runtime-models`；
- 新增/更新本地 Agent policy API，例如 `GET/PUT /v1/config/agents/{agent_id}/models`；
- Provider discovery 返回完整 `ModelDescriptor`；
- Provider 删除增加引用预检和迁移参数；
- Runtime execute schema 支持 `model_selection`，兼容读取旧 `model`；
- 图片 operation 未实现前不发布对应 capability；实现后增加内部 adapter，不要求所有 Provider 共用同一路径。

### 9.3 Agent 工厂与 Runtime

更新：

- `drsai/backend/run_drsai_agent_factory.py`
- `drsai/backend/runtime/agent.py`
- `drsai/backend/runtime/engine.py`
- `drsai/backend/runtime/evidence.py`
- `GatewayOpenDrSaiAgentBackend` 与 `AgentManager`

目标：

- AgentManager 的缓存键包含 Provider、模型和 config/catalog revision；
- resolver 不再回退到 `next(iter(llm_mode_config))`；
- `model_aliases`/upstream ID 按定义执行；
- Runtime 在 Provider 调用前完成能力和授权校验；
- Manifest 记录真实 Provider 与模型 revision；
- 图片生成完成时落盘到 Workspace/Artifact Store，并产生结构化事件。

### 9.4 Desktop shared API、main 和 renderer

更新：

- `apps/desktop/shared/api/desktopApi.ts`
- `apps/desktop/shared/main/myDrSaiConfig.ts`
- `apps/desktop/shared/main/chat.ts`、`agentRuns.ts`、`runtimeClient.ts`
- `apps/desktop/shared/main/agents.ts`
- `apps/desktop/shared/renderer/src/App.tsx`
- 建议把模型设置拆成 `ModelProviderSettings`、`AgentModelSettings` 和 model catalog hooks，降低 `App.tsx` 耦合。

目标：

- Desktop 不再自行合并两套字符串目录；
- 本地 OpenDrSai 使用 Provider 统一目录；Codex/平台 Agent 保持各自 Backend 目录；
- 选择器按用途过滤并显示 Provider、模态、工具调用、推理和状态；
- 只有存在至少一个可用图片输出模型时才显示图像生成设置；
- Agent 配置持久化到 Gateway，localStorage 仅做一次迁移；
- Provider 保存、登录主体变化和目录刷新后，相关缓存同步失效；
- 发送前若选择陈旧或不兼容，保留输入和附件，显示直接修复动作。

### 9.5 协议与文档

更新：

- Desktop/Runtime TypeScript 与 Python 契约；
- OpenAPI 资源和 fake Gateway fixtures；
- `docs/model-provider-config.md`；
- P3 总计划的模型配置模块与验收台账；
- 用户文案：明确“图片理解”和“图片生成”的区别。

## 10. 功能点、测试与验收方案

### P3-MC01：统一模型目录和能力 schema（P0）

| 功能点 | 自动测试 | 验收标准 |
| --- | --- | --- |
| Canonical `ModelRef` 与跨语言类型 | Python unit + TS type/contract + OpenAPI snapshot | TS/Python 字段一致；同名不同 Provider 不冲突 |
| `ModelDescriptor` 模态与 operation | schema property tests | 非法组合被拒绝；未知能力为空集合 |
| 目录聚合、去重、排序与 revision | unit + deterministic fixture | 仅按 Provider+model 去重；输入不变 revision 稳定，能力/可用性变化 revision 改变 |
| 能力 provenance 优先级 | table-driven unit | 用户覆盖、Provider、注册表和未知按既定顺序生效并可解释 |
| 缓存状态 | fake provider integration | fresh/stale/offline/unauthorized/error 可区分，无静默空列表 |

### P3-MC02：Provider 配置与目录成为唯一模型来源（P0）

| 功能点 | 自动测试 | 验收标准 |
| --- | --- | --- |
| 已配置 Provider 模型进入统一目录 | Gateway integration | Provider 页面保存后目录和 revision 同步更新 |
| HepAI OIDC 目录 | fake OIDC + live gated smoke | 使用 request-scoped access token；配置和日志中无 token |
| 无 `/models` Provider 的固定模型 | integration | 显示 `configured_unverified`，真实模型测试后可升级状态 |
| Provider model membership 校验 | resolver unit + API negative tests | 目录外模型不能静默执行 |
| alias/upstream ID | unit + fake upstream request assertion | UI 显示名不发送给上游；实际请求使用正确 upstream ID |
| Provider 删除引用预检 | service + Desktop E2E | 用户看到受影响 Agent；取消零修改，迁移后无悬空引用 |

### P3-MC03：本地 OpenDrSai Agent 配置接入（P0）

| 功能点 | 自动测试 | 验收标准 |
| --- | --- | --- |
| 智能体显式主模型 | unit + Renderer E2E | Provider 变化不改写智能体策略；缺失或失效时阻止新 Run 并引导配置 |
| Agent 显式 override | Gateway/Runtime integration | Provider+model 精确到达 Runtime，不改变全局默认 |
| policy 持久化与 revision 冲突 | concurrent service tests + two-window E2E | 跨窗口不丢更新；冲突要求重载，不覆盖他人修改 |
| localStorage 一次迁移 | migration unit + upgrade E2E | 可解析旧值时迁移；不可解析时安全回默认并提示 |
| Codex/平台边界 | contract + Renderer E2E | 不把 Provider 模型注入 Codex/平台 Agent，不显示不适用选项 |
| 思考强度过滤 | capability matrix unit + UI | 只显示模型支持的等级，发送参数与选择一致 |

### P3-MC04：Runtime 精确解析和运行证据（P0）

| 功能点 | 自动测试 | 验收标准 |
| --- | --- | --- |
| execute 接收 `model_selection` | Runtime contract + compatibility tests | 新客户端走结构化对象；旧字符串仅在当前默认 Provider 内解析 |
| 执行前授权/能力复核 | fake revoked/removed model tests | 目录或权限失效在 Provider 调用前得到稳定错误码 |
| Client 缓存键与热更新 | concurrency + long-running stream tests | 当前 Run 不被中断；下一 Run 使用新 revision；无跨 Provider Client 复用 |
| Manifest effective model | Run Inspection integration | Provider、upstream model ID、config/catalog revision、能力来源准确，不再写 `opendrsai` 充当 Provider |
| 重放一致性 | replay tests | 精确重放需要相同 revision；不满足时明确降级原因，不伪称 exact |

### P3-MC05：原生多模态图片理解（P1）

| 功能点 | 自动测试 | 验收标准 |
| --- | --- | --- |
| 图片附件预检 | MIME/size/path security tests | 非图片、超限、越界和损坏内容在 Run 前拒绝 |
| 原生 content block adapter | fake OpenAI/Anthropic request assertions | Provider 收到正确图片块；不再仅以文件路径宣称视觉调用 |
| 非视觉模型行为 | Renderer + Gateway E2E | 保留输入和附件，提示改用兼容模型或明确选择文件工具降级 |
| 多模态主模型复用 | integration | 一个兼容主模型同时处理文本和图片，不强迫用户再选“视觉模型” |
| 隐私和证据 | security scan + Manifest assertion | 不记录图片正文/base64；只记录安全引用、摘要和有效模型证据 |

### P3-MC06：图片生成和编辑（P1，能力存在时启用）

| 功能点 | 自动测试 | 验收标准 |
| --- | --- | --- |
| operation-specific Provider adapter | fake image provider integration | 只对声明支持的 Provider/模型开放；错误协议不尝试猜测 endpoint |
| 图片模型选择 | Renderer E2E | 只列出 image output 模型；无可用模型时整个设置隐藏 |
| 生成/编辑能力区分 | capability unit + negative tests | 生成模型不能自动用于编辑；编辑必须满足图片输入、输出和 edit operation |
| Runtime Tool 与审批 | Runtime integration | 调用有 tool started/completed/failed 事件；需要时进入审批，不绕过权限 |
| Artifact 输出 | OAEP/Artifact E2E | 图片保存到受控位置，结果可预览、导出和恢复；失败不留下假成功 Artifact |
| 同一多模态模型承担多角色 | integration | 若能力明确，同一个 ModelRef 可用于主模型和图片模型，不重复配置凭据 |

### P3-MC07：易用性和恢复（P1）

| 功能点 | 自动测试 | 验收标准 |
| --- | --- | --- |
| Provider 分组和用途过滤 | visual + a11y + Renderer E2E | 用户能识别模型来源、用途和状态；键盘/读屏完整可用 |
| 陈旧/下线模型恢复 | E2E | 不静默替换；保留用户输入，提供刷新、重新登录、改用默认三类动作 |
| 配置后自动刷新 | main/renderer integration | 无需重启 App；Provider 保存后 Agent 选择器与 composer 一致 |
| 空目录原因 | state matrix tests | 无权限、离线、超时、未配置和真实空目录使用不同文案及动作 |

### P3-MC08：迁移、退场和发布门禁（P0/P1）

| 功能点 | 自动测试 | 验收标准 |
| --- | --- | --- |
| 旧配置非破坏迁移 | fixture matrix + upgrade E2E | TOML、YAML、CLI JSON 和 localStorage 均有确定迁移结果及备份 |
| 旧目录停止新写入 | static contract scan + telemetry fixture | Desktop 无旧 CRUD 新写入；兼容读可独立关闭 |
| Windows packaged E2E | packaged fake + real HAI gated smoke | 无 Codex 环境下完成登录、选模型、执行、重启恢复和证据检查 |
| macOS parity | shared contract + signed artifact gate | shared 行为一致；Keychain/OIDC 平台断言通过 |
| 密钥与日志扫描 | secret scan | token、API Key、图片正文和敏感 Header 不出现在日志、Manifest、截图和诊断包 |
| 回滚演练 | release rehearsal | 回滚版本可读迁移前配置；新版本恢复后无悬空 policy 或错误默认 |

## 11. 实施顺序与门禁

### P3.0：真实性止损与契约冻结

- 隐藏未接线的固定图像模型 UI；
- 冻结 `ModelRef`、`ModelDescriptor`、`AgentModelPolicy` 契约；
- 建立当前目录/选择/执行链的契约测试；
- 禁止新增裸模型字符串写入点。

门禁：UI 不再声称未实现能力；新旧客户端兼容方案评审通过。

### P3.1：文本模型完全收敛

- 上线统一目录服务；
- Provider 配置成为唯一选择来源；
- 本地 Agent policy 持久化；
- Runtime 精确解析、能力校验和 Manifest 证据闭环；
- Provider 更新、删除和登录主体切换完成缓存失效。

门禁：使用两个具有相同 model ID 的 fake Provider，选择任一方都能证明请求发往正确上游；真实 HAI smoke 通过。

### P3.2：原生多模态理解

- 建立图片附件 content-block adapter；
- 接入图片输入能力校验与用户恢复；
- 完成 OpenAI/Anthropic-compatible fake matrix 和至少一个真实 HAI 模型 smoke。

门禁：图片内容确实进入上游多模态字段；非视觉模型不会收到图片请求。

### P3.3：图片生成和编辑

- 只有确认 Provider 具备图片 operation 后才实施；
- 建立 image adapter、Runtime Tool、审批、Artifact 和 OAEP 闭环；
- 重新启用动态图片模型配置 UI。

门禁：真实图片 Artifact 可恢复、可导出、可审计；无图片 Provider 时 UI 无死入口。

### P3.4：旧实现退场

- 停止旧 LLM CRUD 和 Renderer localStorage 的新写入；
- 完成两版本兼容观察、迁移率统计和回滚演练；
- 删除旧 fallback、固定默认和无效 `imageModel` 驱动逻辑。

门禁：静态扫描无旧写入；所有 P3-MC01～08 台账通过。

## 12. P3 完成定义

本专项只有同时满足以下条件才可标记完成：

1. 本地 OpenDrSai Agent 的所有可选择模型均来自已配置 Provider 的统一目录；
2. Agent 设置、composer 和实际 Runtime 使用同一个 Provider-aware 模型身份；
3. 文本、图片理解、图片生成/编辑按输入/输出模态和 operation 分开校验；
4. 没有 Provider 图片能力时，不展示图片模型假入口；
5. Provider、模型或账号权限变化后，不重启 App 即可得到一致且可解释的状态；
6. 同名跨 Provider 模型不会误路由；Provider 删除不会产生悬空 Agent 配置；
7. Runtime Manifest 能证明实际 Provider、upstream model ID、config/catalog revision 和能力来源；
8. 未知模型不再默认拥有视觉、工具调用或结构化输出能力；
9. Windows packaged 环境在不运行 Codex 的条件下通过完整真实 HAI 任务；
10. 旧配置迁移、两版本兼容、回滚和密钥扫描全部通过。

P3-MC01～P3-MC08 的本地实现与自动化闭环现已完成；图片生成/编辑设置仍只对 Provider 明确声明的兼容模型显示。P3 RC 发布门禁继续要求真实 HAI Provider 的 discovery、文本、视觉、生成与编辑 smoke，以及 macOS 签名产物验证，不以 fake Provider 或 Windows 上的静态 macOS 契约证据替代。

## 13. 实施进度

| 日期 | 功能点 | 状态 | 实现与证据 |
| --- | --- | --- | --- |
| 2026-08-05 | P3-MC01：统一模型目录和能力 schema | 已完成 | 新增 Python `model_catalog.py` 与 Desktop `RuntimeModelRef`、`RuntimeModelDescriptor`、`AgentModelPolicy`、`RuntimeModelCatalog` 契约；Gateway OpenAPI 固化 Provider-aware discovery response；目录按 Provider+model 去重并生成确定性 revision；能力 provenance、非法图片 operation、缓存 `fresh/stale/offline/unauthorized/error` 均有测试；未知能力 fail-closed；证据见 `evidence/opendrsai-windows-phase3-model-convergence-mc01.json`。 |
| 2026-08-05 | P3.0 真实性止损 | 本地验收完成 | 固定 `nano-banana-2-lite` 图像生成/编辑入口及新写入已移除；旧 `imageModel` 只读兼容保留一个版本；未知模型不再默认拥有 vision、tool calling 或 JSON output。结构化 `model_selection`、Agent policy 一次迁移与本地执行链均已接通；旧裸 `model` 仅保留在当前默认 Provider 内的兼容解析，不再跨 Provider 搜索。 |
| 2026-08-05 | P3-MC02：Provider 配置与目录成为唯一模型来源 | 本地验收完成 | 新增 `/v1/config/runtime-models` 唯一权威目录；固定模型与精确 Provider 动态发现缓存合并并区分 `fresh/stale`；Desktop 停止消费旧模型 CRUD 和兼容 `/v1/models`；Runtime 使用 `provider_id + model_id` 精确解析、成员校验和 upstream ID 映射；同名跨 Provider fake 路由通过；Provider 删除增加引用预检、零修改取消、显式默认迁移动作和后端 fail-closed。证据见 `evidence/opendrsai-windows-phase3-model-convergence-mc02.json`。真实 HAI discovery smoke 保留为具备可用登录身份时的发布门禁。 |
| 2026-08-05 | P3-MC03：本地 OpenDrSai Agent model policy | 本地验收完成 | 原子 `agent-model-policies.json`、SHA-256 revision、乐观并发 GET/PUT/迁移 API、默认继承/显式 `ModelRef`、Runtime 精确 `effective_ref`、Agent Square 动态展示、Provider 引用预检与 Codex/平台边界均已完成。思考强度按精确模型能力过滤，Gateway 二次校验后以 Run 级字段进入 AgentManager 和上游模型请求；双窗口 stale revision、结构化恢复按钮、升级 localStorage 一次迁移及 Renderer E2E 通过。证据见 `evidence/opendrsai-windows-phase3-model-convergence-mc03.json`。 |
| 2026-08-05 | P3-MC04：Runtime 精确解析和运行证据 | 本地验收完成 | Run admission 以当前权威目录复核 catalog revision、模型可用性、账号状态和 Full Agent 所需能力；稳定区分 `model_catalog_changed`、`model_unavailable`、`model_unauthorized`、`model_catalog_unavailable` 和 `model_capability_unsupported`。Provider、canonical/upstream model、config/catalog revision 作为请求级不可变绑定进入 Agent 工厂；AgentManager 不跨 Provider/revision 复用客户端，配置变更不打断当前流且下一 Run 生效。Manifest 记录真实 Provider、上游 ID、revision 和能力 provenance；Replay 保留 Provider-aware selection，并明确 exact revision match 或降级原因。证据见 `evidence/opendrsai-windows-phase3-model-convergence-mc04.json`。 |
| 2026-08-05 | P3-MC05：原生多模态图片理解 | 本地验收完成 | Desktop 在 Session/Run 创建前对 PNG/JPEG/GIF/WebP 执行 20 MiB 上限、结构、扩展名/内容一致性和可读性预检，并把探测 MIME 写入 OAEP；Runtime 再以 Workspace 边界、size/digest 和 Pillow 解码复核尺寸、像素数与损坏内容。图片进入 AutoGen `Image`，OpenAI/Anthropic adapter 分别生成原生 `image_url`/`image` content block；非视觉主模型在 Provider 调用前以 `model_image_input_unsupported` 拒绝，Renderer 保留输入和附件并引导重选兼容模型。Agent 已移除静默 `remove_images` 降级；Manifest 仅记录 resource ID、MIME、大小、SHA-256、尺寸和有效模型，不记录路径、文件名、正文或 base64。证据见 `evidence/opendrsai-windows-phase3-model-convergence-mc05.json` 与 `evidence/opendrsai-windows-phase3-model-convergence-mc05-attachments.json`。真实 HAI 视觉模型 smoke 仍为 RC 环境门禁。 |
| 2026-08-05 | P3-MC06：图片生成和编辑 | 本地验收完成 | Provider `model_operations` 成为唯一能力开关，生成与编辑独立声明且仅支持已实现的 OpenAI-compatible 协议；Agent policy 使用显式图片 `ModelRef`，Renderer 只在存在可用图片输出模型时显示设置并允许关闭。`image_generation` / `image_edit` 已注入生产 Full Agent Runtime，真实 Tool 先 started 后审批的时序以 Runtime `call_id` 绑定审批和副作用账本；取消、断线、失败和未知结果不产生假 Artifact 或自动重放。输出经大小、尺寸、像素、格式与 base64 校验后写入现有 Artifact/OAEP；编辑再次校验 Workspace 引用、digest 和解码，单附件无需手填 ID。143 项聚焦测试、类型检查、Electron Renderer E2E、内置 wheel 安装、Windows unpack 和 packaged real IPC smoke 通过。证据见 `evidence/opendrsai-windows-phase3-model-convergence-mc06.json`；真实 HAI 图片生成与编辑 smoke 仍为 RC 门禁。 |
| 2026-08-05 | P3-MC07：易用性和恢复 | 本地验收完成 | Agent 文本模型按 Provider 分组；只有 `available` / `configured_unverified` 可用于新任务，当前陈旧、离线、未授权或下线选择仍显示但禁止误选并保留完整 `ModelRef`。目录状态区分未配置、真实空目录、未授权、离线、超时、陈旧、所选模型下线和一般错误，提供刷新、重新登录或显式改用 Provider 默认模型动作；Runtime 其余配置可用时，目录失败不再错误地锁死整个设置。Provider 保存后先标记目录陈旧再自动重载，真实 Electron E2E 验证发生了重新读取；native select/optgroup、可访问名称、live status 和键盘按钮完成可访问性闭环。类型检查、状态矩阵、既有模型契约、Electron E2E、Windows unpack 与 packaged real IPC smoke 全部通过。证据见 `evidence/opendrsai-windows-phase3-model-convergence-mc07.json`。 |
| 2026-08-05 | P3-MC08：迁移、退场和发布门禁 | 本地实现验收完成；外部 RC 门禁待执行 | 环境变量、CLI JSON、YAML、旧模型目录的迁移优先级固定，旧源字节不变，TOML `.bak` 和 localStorage 迁移前快照支持旧版本回滚与重复升级。OpenDrSai 不再向 `defaultModel`、旧 `model` 或 `imageModel` 写入本地模型选择；旧 CRUD 不再被生产 Desktop 使用，兼容路由标记 deprecated，读取可独立关闭并返回稳定替代入口。结构化诊断按字段清除凭据和图片正文；172 passed、1 skipped。Windows 包在无法解析 `codex` 的隔离 PATH 中完成 27/27、2 Sessions、2 Runs，旧 chat/旧目录调用均为 0；packaged real main/preload/IPC 通过。macOS shared shell、Runtime、Keychain/签名策略契约通过。证据见 `evidence/opendrsai-windows-phase3-model-convergence-mc08.json`；真实 HAI 矩阵和 macOS 签名产物仍为 RC 外部门禁。 |

下一闭环：完成 P3 RC 外部门禁，并继续固定 50 点产品台账中尚未验收的功能。当前机器没有可用的 OIDC 登录或 HAI Provider 密钥，因此真实 HAI discovery、文本、视觉、图片生成/编辑不得标记通过；macOS 签名/公证产物必须在 macOS 发布环境验证。
