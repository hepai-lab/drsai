# OpenDrSai BAMS 资源配置架构方案

> 状态：方案草案  
> 日期：2026-08-09  
> 范围：Desktop、TUI、Android 与 Remote Runtime 共享的智能体资源配置  
> 关联方案：[智能体工具知识库 P1](./智能体工具知识库P1.md)、[WebSearch P2](./opendrsai-websearch-p2-development-plan.md)

## 1. 结论

OpenDrSai 的设置体系按 BAMS 形成四类资源，并由“智能体配置”引用：

```text
设置
├─ 智能体配置
├─ 模型提供方        Brain
├─ 感知器配置        Sensing / Perception
├─ 执行器配置        Action / Execution
└─ 记忆器配置        Memory
```

设置负责创建、测试和管理可复用资源；智能体配置只保存资源引用与 Agent 级策略。连接信息、API Key、存储位置和运行环境不得复制进 Agent 配置。

Tavily 属于公共网络感知器。大装置实时数据、历史数据、实验元数据和数据产品也属于感知器；任何会改变装置状态的控制操作不属于感知器，必须作为高风险执行器独立建模。

## 2. 设计原则

1. 采用“资源注册表 + Agent 引用 + Run 不可变快照”，不建立与现有配置系统平行的实现。
2. BAMS 是能力和产品语义分类；底层 Adapter 可复用同一 Host Runtime，但感知与执行权限必须分离。
3. 模型看见稳定的 Tool 契约，不直接看见 Tavily、EPICS、数据库等 Provider 私有接口。
4. 全局资源描述“如何连接和具备什么能力”；Agent 绑定描述“是否允许使用、预算、范围与 fallback”。
5. 凭据只保存为安全凭据引用；Renderer、日志、OAEP、导出和 Run Snapshot 不出现明文。
6. 所有外部数据均按不可信输入处理，不得改变 System Prompt、Tool Policy、Approval 或长期记忆策略。

## 3. 资源关系

```text
模型提供方 ─┐
感知器资源 ─┼─> 智能体配置 ─> 运行时解析 ─> Run Snapshot ─> Agent Kernel
执行器资源 ─┤
记忆器资源 ─┘
```

统一引用格式：

```text
model:<provider-id>/<model-id>
perceptor:<perceptor-id>
executor:<executor-id>
memory:<memory-id>
knowledge:<knowledge-id>
tool:<tool-id>
```

建议的物理配置结构：

```text
configs/
├─ agents/agent_<agent_id>.toml
├─ models/provider_<provider_id>.toml
├─ perceptors/perceptor_<perceptor_id>.toml
├─ executors/executor_<executor_id>.toml
├─ memories/memory_<memory_id>.toml
├─ tools/tool_<tool_id>.toml
└─ knowledge/knowledge_<knowledge_id>.toml
```

每个资源独立 revision，便于引用检查、凭据轮换、导入导出和历史 Run 解释。

## 4. 感知器配置

### 4.1 定义

感知器向智能体提供外部世界的只读信息。首期类型包括：

```text
公共网络       Tavily、Playwright Search，未来可接 Brave、SearXNG
大装置数据     实时量测、历史归档、告警事件、实验元数据、数据产品目录
工作区文件     文件发现和只读内容获取
屏幕视觉       Screenshot、UI 状态识别
音频           Speech-to-Text
外部数据       MCP、数据库、知识检索
```

感知器可以提供一个或多个能力，Agent Kernel 再把能力映射为模型可见 Tool。例如 Tavily 提供 `web.search` 与 `web.extract`，模型看到的是 `web_search` 和 `web_fetch`。

### 4.2 通用资源契约

```toml
schema_version = 1
perceptor_id = "resource-id"
name = "显示名称"
kind = "public_web"
adapter = "tavily"
enabled = true
capabilities = ["web.search", "web.extract"]
credential_ref = "drsai-credential:..."

[connection]
timeout_seconds = 15
```

通用状态：

```text
configured
available
degraded
credential_required
runtime_unavailable
unsupported_platform
disabled
```

### 4.3 Tavily 公共网络感知器

```toml
schema_version = 1
perceptor_id = "web-tavily-main"
name = "Tavily 网络感知"
kind = "public_web"
adapter = "tavily"
enabled = true
capabilities = ["web.search", "web.extract"]
credential_ref = "drsai-credential:..."

[connection]
base_url = "https://api.tavily.com"
project_id = ""
timeout_seconds = 15

[search]
depth = "basic"
max_results = 8
auto_parameters = false

[extract]
depth = "basic"
format = "markdown"
max_chars = 20000
timeout_seconds = 15
```

Tavily 资源保存连接、能力和 Provider 默认值，不保存某个 Agent 的调用次数、业务域名范围、上下文预算、审批策略或 fallback 顺序。

### 4.4 大装置数据感知器

大装置数据不是一种单一协议，而是一个感知器领域。不同 Adapter 可以接入控制系统只读网关、时序归档、实验运行数据库、数据目录或受控 API。

首期能力命名建议：

```text
facility.telemetry.read       读取当前量测
facility.archive.query        查询历史时间序列
facility.events.query         查询告警与运行事件
facility.runs.query           查询实验 Run 和班次元数据
facility.catalog.search       检索数据产品和数据集目录
facility.metadata.read        获取设备、通道、单位和质量元数据
```

资源示例：

```toml
schema_version = 1
perceptor_id = "facility-data-main"
name = "大装置运行数据"
kind = "large_facility_data"
adapter = "facility_gateway"
enabled = true
capabilities = [
  "facility.telemetry.read",
  "facility.archive.query",
  "facility.events.query",
  "facility.runs.query",
  "facility.catalog.search",
  "facility.metadata.read",
]
credential_ref = "drsai-credential:..."

[connection]
base_url = "https://facility-gateway.example"
timeout_seconds = 10
tls_profile = "institution-managed"

[scope]
facility_ids = ["facility-main"]
namespaces = ["beam", "detector", "environment"]
classification_ceiling = "internal"

[limits]
max_channels_per_query = 100
max_time_range_seconds = 86400
max_points = 10000
max_catalog_results = 100
```

大装置数据响应必须保留：

- 装置、子系统、设备和通道标识；
- 事件时间、采集时间、时区和时钟来源；
- 数值、单位、量纲和精度；
- 数据质量标志、缺测、插值和降采样信息；
- 数据源、查询范围、Provider receipt 和配置 revision；
- 实验 Run、班次或数据集等领域关联标识；
- 是否为实时值、缓存值、归档值或模拟值。

禁止把缺测值、过期缓存、模拟数据或插值结果表现为实时真实量测。未经显式授权，不得把装置数据自动写入长期记忆或公共知识库。

### 4.5 大装置感知与控制边界

以下操作属于感知：

```text
读取通道值
查询历史曲线
读取告警和事件
检索实验元数据
查找数据文件和数据产品
读取设备拓扑与状态
```

以下操作属于执行，不能通过感知器实现：

```text
写入控制通道
修改设定值
确认或屏蔽告警
启动、停止或切换设备
提交采集任务
修改实验 Run 状态
移动、删除或发布数据产品
```

即使底层协议同时支持读写，也必须拆成独立 Adapter、独立资源和独立凭据。装置控制执行器默认不启用，并要求强审批、最小作用域、操作回执和不可抵赖审计。

## 5. 执行器配置

执行器负责运行操作或改变外部状态，例如：

```text
local_shell
sandbox_shell
workspace_files_write
browser_control
python_runtime
remote_runtime
mcp_action
facility_control
```

资源描述执行环境和能力，Agent 绑定描述权限：

```toml
[[execution.bindings]]
executor_ref = "executor:local-shell"

[execution.bindings.policy]
approval = "on_risk"
workspace_only = true
network_access = false
max_duration_seconds = 300
```

Browser Runtime 可以被读取页面的感知 Adapter 和点击、提交表单的执行 Adapter 复用，但二者必须分别授权。大装置读写同样不得因共用协议客户端而合并权限。

## 6. 记忆器配置

记忆器管理智能体从交互和任务中形成的状态：

```text
短期上下文记忆
会话摘要
用户长期偏好
情景记忆
语义向量记忆
任务状态记忆
```

```toml
schema_version = 1
memory_id = "personal-local"
name = "本地个人记忆"
kind = "semantic_memory"
adapter = "local_sqlite_vector"
enabled = true

[storage]
scope = "user"
database_ref = "local:personal-memory"

[policy]
retention_days = 365
max_items = 10000
encryption = true
```

知识库保存外部事实和文档；记忆器保存交互形成的用户、任务和情景状态。两者即使复用同一种向量存储，也不能合并产品语义和生命周期。

## 7. 智能体绑定

“设置 → 智能体配置”建议提供：

```text
基本信息 | 模型 | 感知 | 执行 | 记忆 | 技能 | 知识库
```

示例：

```toml
[brain]
model = "model:qwen-main/qwen3"

[[perception.bindings]]
perceptor_ref = "perceptor:web-tavily-main"
capabilities = ["web.search", "web.extract"]
priority = 100

[perception.bindings.policy]
max_search_calls = 3
max_fetch_calls = 5
max_results = 8
max_document_chars = 20000

[[perception.bindings]]
perceptor_ref = "perceptor:web-playwright-local"
capabilities = ["web.search", "web.extract.dynamic"]
priority = 10
fallback_only = true

[[perception.bindings]]
perceptor_ref = "perceptor:facility-data-main"
capabilities = [
  "facility.telemetry.read",
  "facility.archive.query",
  "facility.runs.query",
]
priority = 100

[perception.bindings.policy]
allowed_facility_ids = ["facility-main"]
allowed_namespaces = ["beam", "detector"]
max_time_range_seconds = 3600
allow_live_data = true
allow_archived_data = true

[[memory.bindings]]
memory_ref = "memory:personal-local"
access = "read_write"

[memory.bindings.policy]
automatic_recall = true
automatic_write = false
max_recalled_items = 8
```

fallback 顺序、调用预算、数据范围和审批策略属于具体 Agent，不属于 Tavily 或大装置连接资源。

## 8. 设置界面

### 8.1 感知器列表

感知器列表参考“模型提供方”页面，展示：

- 名称、类型和 Adapter；
- 提供的能力；
- 配置、凭据、运行时和平台状态；
- 最近连接测试和延迟；
- 被哪些智能体引用；
- 编辑、测试和删除前引用检查。

Tavily 提供独立的“测试搜索”和“测试网页读取”。大装置数据提供按能力分开的只读诊断，例如“测试实时量测”“测试历史查询”“测试数据目录”，测试结果不得回显凭据或超出用户数据权限。

### 8.2 智能体感知页

感知页负责：

- 选择一个或多个感知器；
- 勾选允许能力；
- 设置优先级和 fallback；
- 配置调用次数、结果数量、时间范围和上下文预算；
- 对大装置数据配置装置、命名空间、实时/历史范围和数据分级上限；
- 显示当前平台是否能真实提供对应能力。

## 9. Runtime、证据与安全

每次 Run 固化：

```json
{
  "perceptors": [
    {
      "perceptor_id": "web-tavily-main",
      "adapter": "tavily",
      "revision": "sha256:...",
      "capabilities": ["web.search", "web.extract"]
    },
    {
      "perceptor_id": "facility-data-main",
      "adapter": "facility_gateway",
      "revision": "sha256:...",
      "capabilities": ["facility.telemetry.read", "facility.archive.query"]
    }
  ]
}
```

Receipt 至少包含 Provider、request ID、开始/结束时间、延迟、结果规模、截断或降采样信息、数据时间范围和错误分类。凭据、原始认证 Header 和敏感连接参数不得进入 Snapshot、OAEP、Renderer 或日志。

大装置数据还必须满足：

- 用户身份、Agent 身份和数据权限共同参与授权；
- 默认只读、最小范围、最短时间窗和有界结果；
- 明确实时性、数据质量、单位、时区和来源；
- 支持查询审计、访问撤销和跨用户隔离；
- Android 等无本地接入条件的平台返回 `remote-required`，不得伪装成本地能力；
- 感知数据中的文本均按外部不可信内容处理。

## 10. 分阶段实施

### P1：感知器基础

1. 定义 `PerceptorResource`、能力命名和引用格式。
2. 建立 Perceptor Registry、独立 revision、凭据引用和删除前引用检查。
3. 增加“设置 → 感知器配置”与“智能体配置 → 感知”标签。
4. Run Snapshot 固化感知器及实际能力。

### P2：公共网络感知

1. 实现 Tavily Search/Extract Adapter。
2. 接入 `web_search` 与 `web_fetch`。
3. 将 Playwright 改造为备用公共网络感知器。
4. 完成测试、fallback、OAEP 和 Run Inspector。

### P3：大装置数据感知

1. 冻结量测、历史、事件、Run、目录和元数据的最小公共契约。
2. 实现一个只读大装置数据 Gateway Adapter。
3. 完成时间、单位、质量标志、降采样和数据来源规范化。
4. 接入 Agent 能力绑定、数据范围限制和真实权限校验。
5. 完成模拟数据、过期数据、缺测、越权和远程平台验收。

### P4：执行器与记忆器

1. 在感知器资源模型稳定后复用相同注册表模式。
2. 建立执行审批和感知/控制强隔离。
3. 建立记忆生命周期、自动召回和显式写入策略。

## 11. 完成标准

- Tavily 和大装置数据均作为感知器资源存在，不与模型 Tool 或 Agent 配置硬绑定。
- Agent 可独立选择感知器、能力、预算、数据范围和 fallback。
- 模型只看到稳定的 Tool 契约，Provider 私有字段不泄漏到公共契约。
- 大装置读取与控制在资源、凭据、能力、审批和审计上完全分离。
- Run Snapshot、OAEP 和 Inspector 能追溯实际感知器、revision、数据来源和质量状态。
- 所有密钥和敏感连接信息只通过安全凭据引用解析。
- Desktop、TUI、Android 和 Remote Runtime 对不可用能力给出真实状态和恢复路径。
