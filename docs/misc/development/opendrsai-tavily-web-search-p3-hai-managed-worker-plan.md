# OpenDrSai Tavily 网页搜索感知器 P3：HAI 托管 Worker 集成方案

> 状态：规划完成，待实施  
> 日期：2026-08-14  
> 前置阶段：[Tavily P1 集成方案](./opendrsai-tavily-web-search-p1-integration-plan.md)、[Tavily P2 引导配置方案](./opendrsai-tavily-web-search-p2-guided-configuration-plan.md)  
> 参考实现：[Desktop → HAI DDF → Remote Agent 联调方案](../desktop/remote-agent-ddf-worker-integration-plan.md)、[联调验收报告](../desktop/remote-agent-ddf-worker-integration-report.md)  
> 外部契约：[Tavily Search API](https://docs.tavily.com/documentation/api-reference/endpoint/search)、[Tavily Extract API](https://docs.tavily.com/documentation/api-reference/endpoint/extract)

## 1. 阶段结论

P3 将网页搜索从“用户自行配置 Tavily Key”升级为“登录 HAI 后默认使用平台托管 Tavily 服务”。调用链固定为：

```text
OpenDrSai Client
  → HAI DDF
  → IF / unified_gate
  → Tavily Worker
  → Tavily Search / Extract API
```

P3 不改变模型可见工具：

```text
web_search   # 搜索并排序公共网页来源
web_fetch    # 读取选中的公共网页正文
```

也不把 `unified_gate`、Worker 地址或 Tavily Key 暴露给模型。Python Core 的网页搜索 Router 根据登录状态、用户选择、平台权限和服务健康状态，将公共契约路由到以下感知器之一：

1. `hai_managed_tavily`：登录 HAI 后的默认方案，平台托管 Key；
2. `tavily`：现有 BYOK 方案，用户自行保存 Key；
3. `none`：不联网回答或能力不可用。

Playwright 不再作为无提示的搜索替代服务。动态网页读取若以后仍需浏览器能力，应作为独立、显式的感知器和策略处理，不得绕过 HAI/BYOK 选择。

## 2. 总体目标

### 2.1 用户目标

- 新用户登录 HAI 后，无需理解 Tavily、感知器或 API Key 即可直接搜索网页；
- 用户询问“HEPiX 2026 是什么”时，系统自动使用 HAI 托管搜索并返回可核验来源；
- 未登录时提供明确选择：登录并使用 HAI 托管搜索、配置自己的 Tavily Key、暂不联网；
- 平台服务不可用时显示可操作状态，不把 Worker、IF 或 Tavily 原始异常直接暴露给用户；
- 用户可在设置中明确看到当前搜索来源、托管主体、隐私边界和可用状态。

### 2.2 平台目标

- Tavily Key 仅存在于 Tavily Worker 的安全凭据环境中；
- DDF 统一完成用户认证、权限、路由、限流、额度和审计；
- DDF 与 Worker 之间使用 IF（Infinite Function）/ `unified_gate`；
- Search/Extract 函数参数和返回值保持 Tavily 兼容，避免重复定义私有搜索协议；
- 每次调用可按 HAI 用户、客户端、Run 和 Tavily request ID 关联，但日志不记录完整查询和返回正文；
- 支持灰度、配额保护、熔断、撤销 Key 和独立回滚。

### 2.3 工程目标

- 复用 P1 的 Provider-neutral 结果契约、URL 安全、来源展示和 Inspector；
- 复用 P2 的能力预检、暂停恢复和“不联网回答”语义；
- 复用 zhizzv3 Worker 已验证的注册、heartbeat TTL、DDF 路由、OIDC、幂等、取消、结构化错误和关联 ID 机制；
- 新增 HAI 托管 Provider Adapter，不在 Agent、Desktop Renderer 或 Tavily Worker 中复制业务路由逻辑。

## 3. 非目标

P3 不包含：

- 向客户端、DDF 响应或模型上下文下发 Tavily Key；
- 允许客户端指定任意 Worker URL、Tavily Base URL 或平台密钥；
- Tavily Crawl、Map、Research、Usage 和图片搜索；
- 把 Tavily Answer 直接当作 OpenDrSai 最终回答；
- 无限制透传 Tavily 新增参数；
- 未登录用户自动获得匿名共享额度；
- 取消 BYOK 能力；
- 用 HAI 托管额度静默替代用户明确选择的 BYOK，或反向静默切换；
- 将公共网页搜索与大装置数据感知器合并成同一个 Worker。

## 4. 总体架构与职责

```text
┌──────────────────────────────────────────────────────────────────┐
│ OpenDrSai Client / Runtime                                       │
│ web_search/web_fetch → Capability Preflight → Perceptor Router   │
│                         ├─ HAI Managed Adapter                    │
│                         └─ BYOK Tavily Adapter                    │
└──────────────────────────────┬───────────────────────────────────┘
                               │ OIDC Bearer + IF request
┌──────────────────────────────▼───────────────────────────────────┐
│ HAI DDF                                                          │
│ authenticate → authorize → quota/rate limit → route → audit      │
│ POST /apiv2/worker/unified_gate/?model=...&function=...           │
└──────────────────────────────┬───────────────────────────────────┘
                               │ trusted IF call
┌──────────────────────────────▼───────────────────────────────────┐
│ Tavily Worker                                                    │
│ validate frozen schema → inject managed Key → call Tavily        │
│ normalize safe errors → return Tavily-compatible response        │
└──────────────────────────────┬───────────────────────────────────┘
                               │ HTTPS + Worker-only Bearer Key
┌──────────────────────────────▼───────────────────────────────────┐
│ Tavily API: /search, /extract                                    │
└──────────────────────────────────────────────────────────────────┘
```

### 4.1 OpenDrSai Client / Runtime

- 使用已有 HAI 登录会话，不保存托管 Tavily Key；
- 判断任务是否需要 `web.search` / `web.extract`；
- 解析感知器策略并选择 `hai_managed_tavily` 或 BYOK；
- 调用 DDF IF 接口并将返回映射为 P1 公共契约；
- 保留 P2 暂停、登录、恢复和拒绝联网流程；
- 将来源、receipt、错误和 Provider 证据写入 OAEP/Inspector。

### 4.2 HAI DDF

- 校验 OIDC access token、用户状态和搜索服务 entitlement；
- 复用平台统一的、经过用户身份过滤的能力目录作为授权事实源；只有目录中对该用户 `available + enabled + ACL-visible` 的精确 Worker 资源才可授权；
- 只允许路由到该次授权决策绑定的精确 Tavily Worker ID 和白名单函数，不使用别名猜测、不在 DDF 中硬编码实例地址；
- 执行用户级、组织级、IP/设备级限流与额度检查；
- 生成或传递 `request_id`、`run_id`、`trace_id` 和幂等键；
- 使用 zhizzv3 已验证的 Worker heartbeat TTL fencing，过期 Worker 不参与路由；
- 重试必须沿用原始可信授权决策并再次校验新鲜 heartbeat；目录、ACL 或 heartbeat 查询失败时 fail closed；
- 将客户端取消传播给活动 IF invoke；
- 不记录 Authorization、Tavily Key、完整网页正文或原始 Tavily 错误体。

### 4.3 Tavily Worker

- 以 HAI Worker 身份注册，例如逻辑模型 ID `hepai/tavily-web-search-v1`；
- 公开 `search`、`extract` 两个 `@HRModel.remote_callable`；
- 从 Worker Secret 注入 Tavily Key 和可选 `X-Project-ID`；
- 对请求执行严格 schema、长度、域名、URL、响应体积和超时验证；
- 直接调用 Tavily，不保存用户查询和网页正文；
- 返回 Tavily-compatible JSON；
- 将 Tavily HTTP 错误映射为稳定 IF 错误，不透传响应 body 或 header；
- 输出健康、并发、额度和延迟指标，但健康接口不成为模型工具。

### 4.4 Tavily

- 只接收由 Worker 发出的请求；
- 只看到平台托管项目标识和为完成搜索所需的请求参数；
- 不接收 HAI access token、OpenDrSai 配置、对话历史或本地文件。

## 5. 身份、凭据和信任链

### 5.1 身份链

```text
用户登录 HAI
  → Client 获得短期 OIDC access token
  → DDF 验证 subject / audience / expiry / entitlement
  → DDF 生成可信调用上下文
  → Worker 只信任 DDF，不信任客户端自报 user_id
```

Worker 可获得用于配额和审计的不可伪造主体摘要，但不得获得或记录用户 access token。DDF 不得接受请求体中的 `user_id` 覆盖 token subject。OIDC token 不得导出到文件、临时目录或跨任务共享；日志和调试快照只保留不可逆主体摘要。

### 5.2 凭据归属

| 凭据 | 存储位置 | 可见方 | 禁止出现的位置 |
|---|---|---|---|
| HAI OIDC token | Client 安全会话 | Client、DDF | Worker 日志、Tavily、OAEP、模型上下文 |
| DDF→Worker 服务凭据 | DDF/Worker 运行环境 | DDF、Worker | Client、目录 DTO、Inspector |
| Tavily API Key | Worker Secret/KMS | Worker 进程 | Client、DDF 响应、配置文件、日志、Run Snapshot |
| BYOK Tavily Key | 用户本机安全凭据库 | 本机 Runtime | HAI、Worker、日志、对话 |

### 5.3 Key 运维要求

- 开发、预发布和生产使用不同 Key/Project；
- 支持双 Key 轮换窗口和无停机切换；
- 日志脱敏必须覆盖 `tvly-`、Authorization、Worker 服务凭据和错误 body；
- Worker 启动时只验证 Key 是否存在，不在健康响应返回 Key 状态细节；
- Key 撤销后 Worker 应快速熔断并上报 `provider_authentication_failed`，不得持续重试形成风暴。

## 6. IF / unified_gate 协议冻结

### 6.1 入口

```http
POST {hai_base_url}/worker/unified_gate/?model=hepai/tavily-web-search-v1&function=search
Authorization: Bearer <HAI OIDC access token>
Content-Type: application/json
Idempotency-Key: web-search-<run_id>-<tool_call_id>
X-OpenDrSai-Run-Id: <run_id>
X-OpenDrSai-Trace-Id: <trace_id>
```

`extract` 使用相同入口，仅将 `function` 改为 `extract`。Worker 真实地址、端口和服务凭据由 DDF 管理，不进入客户端配置。

### 6.2 兼容原则

“与 Tavily 相同”定义为：

1. 函数名对应 Tavily endpoint：`search`、`extract`；
2. 函数参数名、类型、枚举、默认值和成功返回结构与冻结的 Tavily API 版本一致；
3. `api_key`、`base_url`、`project_id` 不是函数参数，由 Worker 注入；
4. IF transport envelope 可由 HepAI 协议包装，但 Worker `result` 必须是 Tavily-compatible JSON；
5. 平台使用参数白名单和版本化 Worker ID，不自动接纳 Tavily 未来新增字段；
6. OpenDrSai Adapter 仍只发送完成当前产品功能所需的安全子集。

这样既保持 Tavily 兼容，也避免 `auto_parameters`、原始正文、图片或高成本参数在未评审时突破预算和数据边界。

### 6.3 `search` 冻结契约

Worker v1 接受 Tavily Search 当前字段：

```python
def search(
    query: str,
    search_depth: Literal["basic", "advanced", "fast", "ultra-fast"] = "basic",
    chunks_per_source: int = 3,
    topic: Literal["general", "news", "finance"] = "general",
    time_range: Literal["day", "week", "month", "year", "d", "w", "m", "y"] | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    max_results: int = 5,
    include_domains: list[str] = [],
    exclude_domains: list[str] = [],
    country: str | None = None,
    include_answer: bool | Literal["basic", "advanced"] = False,
    include_raw_content: bool | Literal["markdown", "text"] = False,
    include_images: bool = False,
    include_image_descriptions: bool = False,
    include_favicon: bool = False,
    auto_parameters: bool = False,
) -> dict:
    ...
```

OpenDrSai P3 默认强制：

- `include_answer=false`；
- `include_raw_content=false`；
- `include_images=false`；
- `include_image_descriptions=false`；
- `auto_parameters=false`；
- `max_results<=10`；
- `search_depth=basic`，除非未来预算策略明确允许 advanced；
- `include_domains<=50`、`exclude_domains<=50`，继续沿用 Core 的安全上限。

成功返回保持 Tavily Search 的 `query`、`results`、`response_time`、`usage`、`request_id` 等字段。OpenDrSai 只把允许字段映射到 `WebSearchResponse`，不把 Tavily `answer` 当最终回答。

### 6.4 `extract` 冻结契约

```python
def extract(
    urls: str | list[str],
    query: str | None = None,
    chunks_per_source: int = 3,
    extract_depth: Literal["basic", "advanced"] = "basic",
    include_images: bool = False,
    include_favicon: bool = False,
    format: Literal["markdown", "text"] = "markdown",
    timeout: float | None = None,
    include_usage: bool = True,
) -> dict:
    ...
```

OpenDrSai P3 第一阶段仍采用单 URL Fetch：

- Core 调用前执行公共 HTTP(S) URL、DNS、重定向和 SSRF 校验；
- Worker 再执行一次独立 URL 安全校验，不能信任客户端检查；
- `urls` 最多 1 个，后续批量 Extract 另行评审；
- `include_images=false`；
- `extract_depth=basic`；
- `timeout` 限制在 1–60 秒；
- Worker 响应大小有硬上限，Core 再按 `max_chars<=50_000` 截断。

### 6.5 IF transport envelope

建议 DDF 成功响应固定为：

```json
{
  "model": "hepai/tavily-web-search-v1",
  "function": "search",
  "invoke_id": "if-...",
  "result": {
    "query": "HEPiX 2026",
    "results": [],
    "response_time": 0.42,
    "usage": {"credits": 1},
    "request_id": "tavily-request-id"
  }
}
```

如果现有 IF 客户端已自动解包 `result`，OpenDrSai Adapter 直接接收内部对象；禁止同时兼容多种不确定 envelope。联调前必须用 zhizzv3 使用的 HepAI SDK 版本生成黄金 fixture，冻结实际 wire shape。

## 7. 感知器资源和路由策略

### 7.1 资源定义

平台托管感知器是“虚拟资源”，不包含用户密钥：

```toml
perceptor_id = "web-hai-tavily"
name = "网页搜索（HAI 托管）"
kind = "public_web"
adapter = "hai_managed_tavily"
capabilities = ["web.search", "web.extract"]
credential_mode = "platform_session"
```

该资源可以由 Runtime 根据平台能力动态物化，不要求首次登录时写入用户 TOML。资源状态至少包括：

- `login_required`
- `checking`
- `available`
- `permission_denied`
- `quota_exhausted`
- `worker_unavailable`
- `provider_unavailable`
- `offline`

### 7.2 选择优先级

默认策略：

```text
用户显式选择的 Provider
  → HAI managed（已登录且有权限）
  → BYOK Tavily（已配置且启用）
  → capability guidance
```

约束：

- 显式选择 BYOK 时，不因 BYOK 额度不足而自动消耗 HAI 托管额度；
- 显式选择 HAI 时，不因 HAI 故障而把查询发送给用户 BYOK；
- `auto` 模式可按上述优先级选择，但一次 Run 的 Provider 解析后写入 Snapshot，中途不静默切换；
- 重试只能在同一 Provider 内进行，并受幂等与预算约束；
- 用户选择“不联网”后，本 Run 不得调用 HAI、BYOK 或浏览器搜索。

### 7.3 P2 引导升级

未登录时，配置卡改为：

```text
需要网页搜索

登录 HAI 后可直接使用平台提供的网页搜索服务，无需配置 API Key。
搜索内容会发送给 HAI 托管服务和 Tavily。

[登录并继续] [使用自己的 Tavily Key] [暂不联网]
```

已登录但无权限时显示“当前账户未开通网页搜索”，不得再次要求登录。额度不足、Worker 不可用和 Tavily 故障分别显示不同操作。

## 8. 模块变更清单

### 8.1 新增模块

| 归属 | 建议模块 | 职责 |
|---|---|---|
| Tavily Worker | 独立 Worker 目录与启动入口 | 继承 HepAI Worker 基类，以 `HWorkerAPP` 启动、注册与心跳；部署配置只引用环境变量/Secret 名称 |
| Tavily Worker | `tavily_worker/model.py` | `HRModel`、`search`、`extract` remote callable |
| Tavily Worker | `tavily_worker/contracts.py` | 冻结 Tavily v1 参数与返回验证 |
| Tavily Worker | `tavily_worker/client.py` | Worker→Tavily HTTPS、Key 注入、超时、取消 |
| Tavily Worker | `tavily_worker/security.py` | URL、域名、响应体积、敏感字段校验 |
| Tavily Worker | `tavily_worker/errors.py` | Tavily→IF 稳定错误映射 |
| Tavily Worker | `tavily_worker/telemetry.py` | 非敏感指标、关联 ID、额度证据 |
| Python Core | `runtime/web_search/hai_tavily.py` | DDF IF Client 与 Tavily-compatible 解包 |
| Python Core | `runtime/web_search/provider_policy.py` | managed/BYOK/none 解析和 Snapshot |
| Python Core | `runtime/capabilities/platform_perceptors.py` | 动态 HAI 感知器状态 |
| Desktop | 托管网页搜索状态组件 | 登录、权限、额度、服务状态和 Provider 选择 |
| Tests | Worker/DDF/Core/Desktop fixtures | 黄金请求、响应、错误、取消和脱敏证据 |

Worker 代码应放在 HAI Worker 的部署仓库中，而不是放入 OpenDrSai Desktop 包。最终仓库与部署目录在 P3-A 开始前确定，并记录 owner、镜像、命名空间和回滚负责人。

### 8.2 更新模块

| 模块 | 更新内容 |
|---|---|
| `runtime/web_search/tool.py` | Tool 只依赖 Router，不直接决定 Tavily/Playwright |
| `runtime/web_search/tavily.py` | 保留 BYOK Adapter；抽取可复用 response mapping |
| `runtime/web_search/contracts.py` | 增加 provider mode、IF receipt、配额/计费元数据 |
| `runtime/web_search/errors.py` | 增加 DDF/Worker/auth/quota 错误分类 |
| `backend/gateway.py` | 能力预检、动态平台感知器、Provider 状态和运行证据 |
| `config/perceptor_registry.py` | 支持 `hai_managed_tavily` 与 `platform_session`，禁止保存平台 Key |
| `runtime/capabilities/configuration.py` | `login_required`、`permission_denied`、托管额度状态 |
| Desktop auth | 登录完成后刷新感知器能力并恢复原 Run |
| `PerceptorSettingsPanel.tsx` | 显示 HAI 托管资源、BYOK 高级选项和显式 Provider 选择 |
| `StructuredMessageParts.tsx` | P2 卡片增加登录并继续、账户权限和额度恢复动作 |
| OAEP/Inspector | 记录 provider、invoke ID、Tavily request ID、credits、延迟和错误分类 |
| DDF | Worker 注册、IF 白名单、OIDC entitlement、quota、幂等、取消、审计 |

### 8.3 移除或禁止的实现

- 移除“未配置 Tavily 但 Playwright 可用就把 `web.search` 标记可用”的判定；
- 移除登录用户首次搜索时强制输入 Tavily Key 的默认路径；
- 禁止在 Desktop/Gateway 配置中增加平台托管 Tavily Key 字段；
- 禁止模型直接调用 `unified_gate`；
- 禁止任意 `model`、`function`、Worker URL 和 Tavily Base URL 透传；
- 禁止 Search Router 在 managed/BYOK 之间因错误静默 fallback；
- 不移除 BYOK 的安全凭据、连接测试和显式选择能力。

## 9. 功能点、测试与验收

### 9.1 功能清单

| ID | 功能点 | 自动化测试 | 验收标准 |
|---|---|---|---|
| F01 | Worker 注册与 heartbeat | Worker 注册/TTL 单测，DDF 假时钟测试 | 唯一 Worker 可路由；过期后 180 秒内不可调度 |
| F02 | HAI 登录鉴权 | token 缺失、过期、subject 伪造测试 | 401 分类稳定；请求体不能覆盖 token subject |
| F03 | 搜索 entitlement | 统一能力目录的 available/enabled/ACL 矩阵测试 | 未开通或目录不可见用户 403 `permission_denied`，不调用 Worker；目录读取失败时 fail closed |
| F04 | `search` IF 契约 | Tavily 官方样例派生 schema/fixture | 字段、默认值、枚举和成功结果与冻结 v1 一致 |
| F05 | `extract` IF 契约 | 单 URL、数组拒绝、format/depth 测试 | P3 单 URL 成功；越界参数在 Worker 前拒绝 |
| F06 | Worker Key 注入 | fake Tavily server 捕获 header | Tavily 收到 Worker Key；Client/DDF 响应不含 Key |
| F07 | Worker 参数白名单 | fuzz 未知字段和高成本参数 | 未知字段 422；OpenDrSai 默认不启用 answer/raw/images/auto |
| F08 | Worker 响应映射 | Search/Extract 黄金响应测试 | Tavily-compatible result 完整；原始敏感 header/body 不返回 |
| F09 | Worker 错误映射 | 400/401/403/429/432/433/5xx/DNS/timeout | 每类得到稳定 code、retryable 和用户恢复动作 |
| F10 | DDF IF 路由 | 精确 Worker ID、function 白名单、心跳过期与重试测试 | 只能调用授权决策绑定且心跳新鲜的 Worker 的 `search`/`extract`；重试不漂移到未授权实例 |
| F11 | DDF 幂等 | 同 key 同 body、同 key 异 body | 同请求只消耗一次；冲突返回 409 |
| F12 | 取消传播 | Client 断开、Run cancel、Worker cancel | Worker 停止；无迟到结果和重复计费 |
| F13 | 用户级限流 | 并发、突发、滑窗测试 | 超限 429；其他用户不受串扰 |
| F14 | 用户/组织额度 | credits 模拟与边界测试 | 超额前不调用 Worker；返回 `quota_exhausted` |
| F15 | managed 感知器发现 | 登录状态矩阵单测 | 登录可用时动态资源为 available，无 Key 配置 |
| F16 | Provider 路由 | managed/BYOK/auto/none 矩阵 | 显式选择稳定；Run 中不静默切换 |
| F17 | P2 登录引导 | Renderer 组件测试 | 未登录出现三选项；不再默认只显示 Key 输入 |
| F18 | 登录后自动恢复 | auth callback + 同 Run 集成测试 | 登录成功后原 query 只执行一次，无需重输 |
| F19 | BYOK 保留 | 现有 P1/P2 回归 | BYOK 保存、测试、搜索仍通过，且不上传 Key |
| F20 | 拒绝联网 | managed/BYOK/browser spy | 三个 Provider 调用次数均为 0，回答注明可能过时 |
| F21 | Search 公共契约 | IF response→`WebSearchResponse` 合同测试 | 来源排序、标题、URL、snippet、score 正确 |
| F22 | Fetch 公共契约 | IF response→文档合同测试 | URL、正文、hash、截断和时间字段正确 |
| F23 | URL/SSRF 双重防护 | localhost、私网、重定向、DNS rebinding 测试 | Core 或 Worker 阻止，Tavily 不收到非法 URL |
| F24 | 来源 UI | Renderer/E2E | 只显示统一简要来源，无重复 `Sources:` 文本 |
| F25 | Inspector 证据 | OAEP snapshot 测试 | 可见 provider/invoke/request/credits/latency，不含 Key/正文 |
| F26 | 日志脱敏 | secret corpus 和查询隐私扫描 | token、Key、Authorization、网页正文命中数为 0 |
| F27 | 服务健康与熔断 | Worker/Tavily 故障注入 | 有界重试；熔断后快速失败；恢复后自动探活 |
| F28 | 多用户隔离 | 两用户并发与审计测试 | 配额、审计、幂等和缓存不串用户 |
| F29 | 多端契约 | Desktop/TUI/Android fixture | 使用同一 capability/provider/error 契约 |
| F30 | 真实开发环境 E2E | ai-dev 登录真实搜索与 extract | 回答含真实来源；调用、credits 和 UI 终态一致 |
| F31 | 20 轮稳定性 | 连续 20 次真实低成本 search | 20 terminal、20 唯一 invoke、无悬挂/重复计费 |
| F32 | Key 轮换 | 双 Key、旧 Key 撤销演练 | 无客户端更新；服务不中断或在目标窗口内恢复 |

### 9.2 错误契约

| 环节 | 条件 | 公共错误码 | Retryable | 用户动作 |
|---|---|---|---:|---|
| Client/DDF | 未登录/过期 | `login_required` | 否 | 登录并恢复 |
| DDF | 无 entitlement | `permission_denied` | 否 | 查看账户权限或使用 BYOK |
| DDF | 用户限流 | `rate_limited` | 是 | 稍后重试 |
| DDF | 平台额度不足 | `quota_exhausted` | 否 | 查看额度或选择 BYOK |
| DDF | 无健康 Worker | `worker_unavailable` | 是 | 稍后重试或选择 BYOK |
| Worker | Tavily Key 失效 | `provider_authentication_failed` | 否 | 平台运维处理，不要求用户输入 Key |
| Worker/Tavily | Tavily 限流 | `provider_rate_limited` | 是 | 有界退避 |
| Worker/Tavily | Tavily 额度不足 | `provider_quota_exhausted` | 否 | 平台运维处理 |
| Network | 超时 | `provider_timeout` | 是 | 有界重试 |
| Network | DNS/连接失败 | `provider_unavailable` | 是 | 熔断/稍后重试 |
| Worker | 返回格式错误 | `provider_invalid_response` | 是 | 记录 request ID，平台排障 |
| Security | URL 不安全 | `unsafe_web_url` | 否 | 更换公共 URL |

任何错误响应不得包含 Tavily 原始 body、Authorization、Worker URL、内部堆栈或 Key 片段。

## 10. 配额、成本和滥用防护

### 10.1 预算策略

- DDF 在调用 Worker 前做 entitlement 和额度预留；
- Worker 返回 Tavily `usage.credits` 后，DDF 完成实际结算；
- 调用失败、取消和超时需要明确预留释放/实际计费规则；
- 幂等重放不得二次预留或二次结算；
- `basic` Search 默认 1 credit，`advanced` 在 P3 默认关闭；
- Extract 按 Tavily 成功 URL 和深度规则记录实际 credits；
- 平台必须设置单用户日/月上限、组织上限、单 Run 工具调用上限和并发上限。

### 10.2 防滥用

- query 最大 500 字符；
- max_results、域名列表、URL 数量、响应大小和超时硬限制；
- 禁止任意函数名和未知字段；
- 对重复相似查询可观测但 P3 不默认做跨用户结果缓存；
- 若未来缓存，key 必须包含规范化请求、Provider 版本和安全策略版本，且不得跨权限边界泄露内容；
- 异常高频、域名扫描和批量 Extract 触发风控事件。

## 11. 隐私和用户说明

设置页和首次搜索提示必须说明：

- 服务由 HAI 平台托管，底层搜索提供方为 Tavily；
- 搜索词、过滤域名和待读取 URL 会发送给 HAI 和 Tavily；
- 对话历史、本地文件和模型提示不会随搜索请求发送；
- HAI 使用平台额度，用户无需提供 Tavily Key；
- 用户可以使用自己的 Key，或拒绝联网；
- 平台按账户记录调用次数、credits、时间、结果数量和错误类别，但不在普通日志保存完整查询或网页正文。

上线前需要 HAI/Tavily 数据处理、保留期限、地区合规和用户协议评审。技术实现完成不能替代该评审。

## 12. 可观测性与 Run Inspector

每次调用记录以下非敏感证据：

```json
{
  "capability": "web.search",
  "provider_mode": "hai_managed",
  "provider": "tavily",
  "worker_model": "hepai/tavily-web-search-v1",
  "function": "search",
  "invoke_id": "if-...",
  "tavily_request_id": "...",
  "latency_ms": 420,
  "usage_units": 1,
  "result_count": 5,
  "status": "completed"
}
```

不得记录：HAI token、Tavily Key、DDF→Worker secret、完整 query、网页正文、Tavily 原始错误 body。普通用户只看到“HAI 托管 · Tavily”及来源；技术详情在 Inspector 中按权限展示。

## 13. 分阶段实施

### P3-A：协议与 Worker 基线

- 确定 Worker 仓库、owner、镜像和环境；
- 冻结 `hepai/tavily-web-search-v1`、`search`、`extract` 和 IF wire fixture；
- 实现 Worker 参数验证、Key 注入、错误映射、取消和单测；
- 使用 fake Tavily server 完成零真实额度的合同测试。

**Gate A：** F01、F04–F09、F23、F26 通过，Worker 镜像不含明文 Key。

### P3-B：DDF 路由、鉴权与额度

- 注册 Worker 和 heartbeat；
- 配置 IF model/function 白名单；
- 接入 OIDC entitlement、用户限流、额度预留/结算、幂等和取消；
- 增加 DDF 假 Worker 集成测试和审计脱敏测试。

**Gate B：** F02、F03、F10–F14、F28 通过；未授权请求不会到达 Worker。

### P3-C：OpenDrSai Core Adapter 与路由

- 实现 HAI IF Client、response mapping 和 provider policy；
- 动态物化 HAI 托管感知器；
- 更新能力预检、Run Snapshot、OAEP 和错误契约；
- 保留 BYOK 并删除 Playwright 可用性旁路。

**Gate C：** F15、F16、F19–F23、F25 通过；Provider 在单 Run 内稳定。

### P3-D：Desktop 登录引导与设置体验

- P2 配置卡升级为登录/BYOK/不联网三路径；
- 登录成功刷新能力并自动恢复同一 Run；
- 设置页展示托管主体、权限、额度和健康状态；
- 更新来源和错误文案。

**Gate D：** F17、F18、F20、F24 通过；新用户无需输入 Key。

### P3-E：跨端、可观测性与安全

- TUI/Android 消费公共 capability 事件；
- 完成 Inspector、指标、告警、脱敏和多用户隔离；
- 执行 SAST、依赖、镜像和 secret 扫描。

**Gate E：** F25–F29 通过，安全审计无高危未关闭项。

### P3-F：ai-dev 真实联调、灰度和生产验收

- 使用 HAI 测试账户完成 Search→Extract→回答全链路；
- 执行未登录、无权限、限流、额度、Worker 故障、Tavily 故障和取消演练；
- 20 轮稳定性与计费一致性验证；
- Key 轮换与回滚演练；
- 小比例账户灰度后再扩大。

**Gate F：** F30–F32 通过，产品、平台、Worker、安全和运维共同签字。

## 14. 测试资产

建议建立：

```text
tests/tavily_worker/
├─ fixtures/
│  ├─ search.request.json
│  ├─ search.response.json
│  ├─ extract.request.json
│  ├─ extract.response.json
│  └─ errors/
├─ test_contract.py
├─ test_security.py
├─ test_errors.py
├─ test_cancellation.py
└─ test_secret_redaction.py

cores/python/packages/drsai/tests/
├─ test_hai_tavily_adapter.py
├─ test_web_search_provider_policy.py
├─ test_managed_perceptor_capability.py
└─ test_tavily_p3_e2e_contract.py

apps/desktop/windows/scripts/
├─ verify-tavily-p3-contract.mjs
├─ verify-tavily-p3-guidance.mjs
└─ verify-live-tavily-p3.ps1
```

所有真实链路脚本默认只运行低成本 `basic` Search，必须显式参数才能运行真实 Extract 或故障注入。生产环境禁止破坏性配额测试。

## 15. 迁移、兼容和回滚

### 15.1 迁移

- 已配置 BYOK 的用户保持原选择，不自动迁移到平台额度；
- 未配置 BYOK 且已登录的用户默认 `auto → hai_managed`；
- 未登录用户继续使用 P2 可恢复引导，但主操作变为登录；
- 旧 Run Snapshot 继续按当时 Provider 解释，不回写历史；
- 设置页把 BYOK 放入“使用自己的 Tavily Key”高级路径，不删除资源。

### 15.2 Feature Flags

```text
hai_tavily_worker_enabled
hai_tavily_ddf_route_enabled
hai_tavily_managed_perceptor_enabled
hai_tavily_default_for_logged_in_users
```

按 Worker→DDF→Core→UI→默认启用的顺序开放。每一层都能独立关闭。

### 15.3 回滚

- 关闭默认路由后，新 Run 回到 BYOK/P2 引导；
- 活动 Run 不切换 Provider，失败后给出重试或 BYOK 选择；
- 回滚 DDF 时先停止新流量，再等待活动 invoke 完成或取消；
- Worker Key 泄露时立即撤销 Key、关闭 route、轮换 secret、审计 request ID；
- 回滚不得删除用户现有 BYOK 配置。

## 16. 完成定义

P3 只有同时满足以下条件才完成：

- [ ] 登录 HAI 的新用户无需 Tavily Key 即可完成真实 Search 和 Extract；
- [ ] 未登录、无权限、额度不足和平台故障具有不同、可恢复的用户体验；
- [ ] Client、DDF DTO、日志、OAEP、Inspector 和模型上下文均不存在托管 Tavily Key；
- [ ] DDF 只允许白名单 Worker 和 `search`/`extract`；
- [ ] Worker 函数和冻结 Tavily v1 参数/返回合同测试通过；
- [ ] OpenDrSai 模型工具和 P1 公共响应契约保持稳定；
- [ ] managed、BYOK 和不联网三种策略没有静默跨 Provider fallback；
- [ ] 同一幂等请求只产生一次 Worker invoke 和一次额度结算；
- [ ] 取消后无迟到结果、无悬挂 Run、无重复计费；
- [ ] Search/Extract URL、响应大小、超时和 SSRF 双重防护通过；
- [ ] Desktop、TUI、Android 公共契约测试通过；
- [ ] ai-dev 真实 E2E、20 轮稳定性、Key 轮换和回滚演练通过；
- [ ] HAI 平台、Worker、OpenDrSai、安全、隐私和运维负责人完成验收签字。

## 17. 开发前必须确认的决策

以下项目必须在 P3-A 开始时落定，但不阻塞本方案进入评审：

1. Worker 最终逻辑 ID、仓库、镜像、命名空间和 owner；
2. zhizzv3 当前使用的 HepAI SDK/IF wire envelope 精确版本；
3. OIDC 用户如何获得托管搜索 entitlement；
4. 用户、组织和 Run 的默认额度与并发上限；
5. DDF 额度预留、失败释放和 Tavily 实际 credits 的结算规则；
6. HAI 对 query、URL、request ID 和使用记录的保留期限；
7. managed 与 BYOK 的默认选择是否对已有用户保持不变；
8. Tavily Worker 的开发、预发布和生产 Key/Project 轮换流程；
9. IF SDK 是否已原生支持客户端取消和幂等；若没有，需要在 DDF 层补齐；
10. Tavily API 合同升级时采用新 Worker ID 还是同 ID schema version 升级。推荐新主版本使用新 Worker ID。

## 18. P3-A 联调冻结记录（2026-08-14）

以下内容已经由 Worker、DDF 与 OpenDrSai Desktop/Core 联调冻结：

- 托管模型 ID：`hepai/tavily-web-search-v1`；
- 客户端只调用 DDF 专用 `/apiv2/v1/tools/web-search/*` 门面，不直接调用通用 `unified_gate`；
- 能力目录使用 `object=list`，并通过顶层 `status` 区分 `available`、`permission_denied` 和 `worker_unavailable`；无权和策略缺失时 `data=[]`，不暴露 Worker 信息；
- 公共错误码按 9.2 节执行，平台额度 `quota_exhausted` 与上游额度 `provider_quota_exhausted` 不得折叠；
- DDF 的 entitlement、用户/组织限流和额度检查发生在 Worker 调用前，`metadata.is_free` 不得旁路这些检查；
- DDF 的幂等键绑定认证主体、函数和请求体指纹，且不下发 Worker；取消按认证主体隔离；
- Worker 托管 Key 只从部署环境注入，Client、DDF 响应、OAEP、Inspector 和日志不得包含 Key 或上游原始错误体。

DDF 平台策略由下列部署配置提供：

```text
HAI_WEB_SEARCH_QUOTA_ENABLED
HAI_WEB_SEARCH_POLICY_VERSION
HAI_WEB_SEARCH_ENTITLED_USERS
HAI_WEB_SEARCH_ENTITLED_ORGS
HAI_WEB_SEARCH_USER_RPM
HAI_WEB_SEARCH_ORG_RPM
HAI_WEB_SEARCH_USER_CREDITS
HAI_WEB_SEARCH_ORG_CREDITS
HAI_WEB_SEARCH_CREDIT_WINDOW_SECONDS
HAI_WEB_SEARCH_SEARCH_COST
HAI_WEB_SEARCH_EXTRACT_COST
```

本方案没有冻结任何商业 RPM、每日请求数、credits 或组织额度数值。生产或开发部署若未显式提供完整策略，DDF 必须 fail closed：能力目录返回 `permission_denied` 空列表，调用返回 403 `permission_denied`，并保证 Worker invoke 为 0。具体数值仍由产品和 HAI 平台负责人确认，不得把测试 fixture 写成生产默认值。
