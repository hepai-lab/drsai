# OpenDrSai Tavily 搜索工具集成 P1 方案

> 状态：待实施  
> 日期：2026-08-09  
> 范围：Python Core、Desktop/TUI Runtime、感知器配置、Run Inspector  
> 上游方案：[BAMS 资源配置架构](./opendrsai-bams-resource-configuration-architecture.md)  
> 关联方案：[WebSearch P2](./opendrsai-websearch-p2-development-plan.md)

## 1. 阶段结论

P1 将现有以 Playwright/Bing 为唯一实现的 `web_search` 升级为 Provider-neutral 搜索工具，并接入 Tavily 作为首个主要公共网络感知器。模型可见工具名称保持稳定：

```text
web_search    发现和排序网页来源
web_fetch     按需读取选定网页正文
```

Tavily 属于 `public_web` 感知器，提供 `web.search` 和 `web.extract` 两项能力。Tool 不直接依赖 Tavily，必须经 Router 和 Provider 契约调用。Playwright 保留为明确的备用搜索和动态网页读取能力。

```text
Agent
  -> web_search
       -> Search Router
            -> Tavily Search Provider
            -> Playwright Search Provider (fallback)

  -> web_fetch
       -> Extract Router
            -> Tavily Extract Provider
            -> Playwright Dynamic Fetch Provider (fallback)
```

P1 以“真实改善公共网络搜索质量，并形成可继续扩展的最小 Provider 架构”为完成目标，不实现完整的多 Provider 管理平台。

## 2. 当前问题

现有代码位于：

```text
cores/python/packages/drsai/src/drsai/backend/runtime/web_search/
├─ bing_playwright.py
├─ contracts.py
├─ tool.py
└─ url_safety.py
```

当前主要问题：

1. `tool.py` 直接依赖 `search_bing_with_playwright`，Tool 与实现绑定。
2. 搜索依赖 Bing 页面 DOM、地区、反爬和浏览器运行时，稳定性与质量不足。
3. 搜索发现 URL 与读取网页正文耦合，模型不能先选择来源再 Fetch。
4. `WebSearchResult.content` 同时表达摘要和正文，证据语义不清。
5. Provider 错误没有统一分类，无法安全决定 fallback。
6. Tavily 凭据、成本策略、运行证据和 Agent 绑定尚无正式配置路径。

## 3. P1 范围

### 3.1 包含

- `SearchProvider` 与 `ExtractProvider` 最小契约；
- Tavily REST Client；
- Tavily Search Adapter；
- Tavily Extract Adapter；
- Search/Extract Router 的最小实现；
- 一等 `web_fetch` Tool；
- Playwright 现有实现适配到 Provider 接口；
- Tavily 感知器配置、凭据引用和连接测试；
- Agent 感知器绑定；
- 超时、取消、错误归一化和受控 fallback；
- Search/Fetch receipt、OAEP 和 Run Inspector；
- 单元、契约、集成和真实网络验收。

### 3.2 不包含

- Brave、SearXNG、DDGS、Exa、Firecrawl 等新增 Provider；
- Tavily Answer、Images、Crawl、Map 和 Research；
- Tavily `auto_parameters`；
- Search 内嵌完整网页正文；
- 批量模型可见 `web_fetch`；
- 通用网页爬虫；
- 完整的感知器市场或自动 Provider 选择；
- HepAI 托管搜索网关；
- 大装置数据感知器实现。

## 4. 模块布局

目标目录：

```text
cores/python/packages/drsai/src/drsai/backend/runtime/web_search/
├─ __init__.py
├─ contracts.py
├─ errors.py
├─ router.py
├─ tool.py
├─ url_safety.py
├─ providers/
│  ├─ __init__.py
│  ├─ tavily/
│  │  ├─ __init__.py
│  │  ├─ client.py
│  │  ├─ config.py
│  │  ├─ mapping.py
│  │  ├─ search.py
│  │  └─ extract.py
│  └─ playwright/
│     ├─ __init__.py
│     ├─ search.py
│     └─ extract.py
```

职责：

- `contracts.py`：Provider-neutral 请求、响应、能力和 receipt；
- `errors.py`：统一错误分类；
- `router.py`：能力选择、fallback、预算和调用记录；
- `tool.py`：模型可见 `web_search` 与 `web_fetch`；
- `providers/tavily/client.py`：HTTP、认证、超时、取消和响应解码；
- `mapping.py`：Tavily 私有结构到公共契约的转换；
- `search.py` / `extract.py`：Provider 接口实现；
- `providers/playwright/`：现有 P1 浏览器逻辑的 Adapter，不在本阶段重写全部浏览器实现。

Tavily 不放入 `drsai/tools/tavily`。它是感知 Provider，不是模型工具本身。

## 5. 最小公共契约

### 5.1 Search

```python
@dataclass(frozen=True)
class SearchRequest:
    query: str
    max_results: int = 8
    allowed_domains: tuple[str, ...] = ()
    blocked_domains: tuple[str, ...] = ()
    freshness: SearchFreshness | None = None


class SearchFreshness(str, Enum):
    DAY = "day"
    WEEK = "week"
    MONTH = "month"
    YEAR = "year"
```

```python
@dataclass(frozen=True)
class SearchResult:
    rank: int
    title: str
    url: str
    snippet: str
    score: float | None = None
```

```python
@dataclass(frozen=True)
class SearchResponse:
    query: str
    results: tuple[SearchResult, ...]
    provider: str
    retrieved_at: str
    partial: bool = False
    warnings: tuple[str, ...] = ()
    receipt: ProviderReceipt | None = None
```

`SearchResult` 不包含完整正文和正文 hash。Tavily `results[].content` 映射为 `snippet`，不得误标为已 Fetch 的页面正文。

### 5.2 Fetch

```python
class FetchFormat(str, Enum):
    MARKDOWN = "markdown"
    TEXT = "text"


@dataclass(frozen=True)
class FetchRequest:
    url: str
    format: FetchFormat = FetchFormat.MARKDOWN
    max_chars: int = 20_000
```

```python
@dataclass(frozen=True)
class FetchedDocument:
    requested_url: str
    final_url: str
    title: str
    content: str
    content_type: str
    format: FetchFormat
    provider: str
    retrieved_at: str
    content_sha256: str
    truncated: bool = False
    warnings: tuple[str, ...] = ()
    receipt: ProviderReceipt | None = None
```

`max_chars` 由 OpenDrSai 在 Provider 返回后执行。`content_sha256` 对规范化后的完整正文计算；模型上下文只接收有界的 `content`。

### 5.3 Provider 接口

```python
class SearchProvider(Protocol):
    provider_id: str
    capabilities: SearchCapabilities

    async def search(self, request: SearchRequest) -> SearchResponse: ...


class ExtractProvider(Protocol):
    provider_id: str
    capabilities: ExtractCapabilities

    async def fetch(self, request: FetchRequest) -> FetchedDocument: ...
```

P1 不要求每次调用前执行远程 `health()`。连接测试属于配置与诊断入口，Router 依据真实调用结果和短期故障状态路由。

## 6. Tavily 请求映射

### 6.1 Search 请求

```text
SearchRequest.query             -> query
SearchRequest.max_results       -> max_results
allowed_domains                 -> include_domains
blocked_domains                 -> exclude_domains
freshness                       -> time_range
Perceptor search.depth          -> search_depth
```

P1 固定：

```json
{
  "include_answer": false,
  "include_raw_content": false,
  "include_images": false,
  "auto_parameters": false
}
```

原因：

- 不把 Provider 生成答案混入来源证据；
- 保持 Search/Fetch 分离；
- 不为首期引入图片能力；
- 保持成本和行为可预测。

响应映射：

```text
results[].title    -> title
results[].url      -> url
results[].content  -> snippet
results[].score    -> score
数组顺序           -> rank
request_id         -> receipt.request_id
response_time      -> receipt.latency_ms
usage.credits      -> receipt.usage_units
```

### 6.2 Extract 请求

```text
FetchRequest.url             -> urls
FetchRequest.format          -> format
Perceptor extract.depth      -> extract_depth
Perceptor timeout            -> timeout
```

P1 模型 Tool 一次 Fetch 一个 URL。Tavily Adapter 可以按单元素 URL 请求调用，不向模型暴露批处理契约。

响应映射：

```text
results[].url          -> final_url
results[].raw_content  -> content
failed_results         -> 标准 ProviderError 或 partial warning
```

Tavily 未提供可靠标题时 `title` 保持空字符串，不由 Adapter 猜测或生成。

## 7. Tavily Client

P1 默认使用现有 `aiohttp` 直接调用 Tavily REST API，不增加 `tavily-python` 必选依赖，理由：

- 当前 Core 已依赖 `aiohttp`；
- 可显式控制连接、超时、取消和响应上限；
- 减少桌面打包与供应链变化；
- Adapter 只使用 Search/Extract 的有限字段；
- 更容易执行 Header、异常和日志脱敏。

Client 必须：

- 使用 `Authorization: Bearer <key>`；
- 可选发送 `X-Project-ID`；
- API Key 仅在 Host 内从 `credential_ref` 解析；
- 限制 JSON 响应体大小；
- 不记录请求 Header、API Key 或原始敏感异常；
- 支持 asyncio 取消；
- 为 Search 和 Extract 设置独立超时；
- 捕获无效 JSON、缺失字段和类型错误；
- 从响应 Header 或 body 中尽可能保留 request ID。

## 8. 感知器配置

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

P1 设置界面最少支持：

- 新建和编辑 Tavily 感知器；
- 安全保存或替换 API Key；
- 显示凭据是否已配置，不回显明文；
- 测试搜索；
- 测试网页读取；
- 显示能力、延迟、最近错误和引用该资源的 Agent；
- 删除前引用检查。

## 9. Agent 绑定与 Tool 暴露

```toml
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
```

Tool 暴露规则：

```text
存在可用 web.search 绑定   -> 暴露 web_search
存在可用 web.extract 绑定  -> 暴露 web_fetch
只有动态浏览能力           -> web_fetch 可用，但 Inspector 标记 dynamic
无真实可执行 Provider      -> 不暴露 Tool，并给出配置恢复路径
```

Provider 名称、API Key、search depth 和 fallback 列表不进入模型 Tool Schema。

## 10. 模型可见 Tool

### 10.1 web_search

P1 保持名称和基础字段兼容，并增加可选过滤字段：

```json
{
  "name": "web_search",
  "parameters": {
    "type": "object",
    "properties": {
      "query": {"type": "string", "minLength": 1, "maxLength": 500},
      "max_results": {"type": "integer", "minimum": 1, "maximum": 10},
      "allowed_domains": {"type": "array", "items": {"type": "string"}},
      "blocked_domains": {"type": "array", "items": {"type": "string"}},
      "freshness": {"type": ["string", "null"], "enum": ["day", "week", "month", "year", null]}
    },
    "required": ["query"],
    "additionalProperties": false
  }
}
```

### 10.2 web_fetch

```json
{
  "name": "web_fetch",
  "parameters": {
    "type": "object",
    "properties": {
      "url": {"type": "string"},
      "format": {"type": "string", "enum": ["markdown", "text"]},
      "max_chars": {"type": "integer", "minimum": 1000, "maximum": 50000}
    },
    "required": ["url"],
    "additionalProperties": false
  }
}
```

模型策略应要求先 Search、审阅标题/URL/摘要，再对少量高价值来源 Fetch；禁止恢复“自动读取前三个搜索结果”的隐式行为。

## 11. Router 与 fallback

P1 Router 输入：

- Agent 已绑定感知器；
- 所需能力；
- 优先级与 `fallback_only`；
- 当前平台能力；
- 调用预算；
- Provider 短期故障状态。

自动 fallback 仅用于：

```text
timeout
rate_limited
quota_exhausted（仅当存在不共享该额度的备用 Provider）
upstream_unavailable
invalid_response
runtime_unavailable
```

以下情况不自动 fallback：

```text
invalid_request
authentication_failed
policy_denied
unsafe_url
cancelled
正常的零结果
```

零结果先返回模型；查询改写由受控 Query Planner 或模型下一步决定，不能被伪装成 Provider 故障。

## 12. 错误契约

```python
class ProviderErrorCode(str, Enum):
    INVALID_REQUEST = "invalid_request"
    AUTHENTICATION_FAILED = "authentication_failed"
    RATE_LIMITED = "rate_limited"
    QUOTA_EXHAUSTED = "quota_exhausted"
    TIMEOUT = "timeout"
    UPSTREAM_UNAVAILABLE = "upstream_unavailable"
    INVALID_RESPONSE = "invalid_response"
    RUNTIME_UNAVAILABLE = "runtime_unavailable"
    POLICY_DENIED = "policy_denied"
    CANCELLED = "cancelled"
```

错误包含：

```text
code
provider
retryable
status_code（可选）
request_id（可选）
safe_message
```

不得把 Tavily 原始响应、认证 Header 或可能含凭据的异常直接返回 Renderer 或模型。

## 13. URL 与内容安全

- `web_fetch` 在请求前执行现有 SSRF URL admission；
- 只允许 HTTP/HTTPS；
- 禁止 URL 内嵌凭据、localhost、私网、link-local 和非法端口；
- 对重定向后的最终 URL 再校验；
- 限制响应和正文大小；
- Search snippet、Fetch 正文和页面元数据均标记为外部不可信数据；
- 页面指令不得修改 System Prompt、Tool Policy、Approval 或凭据；
- Fetch 内容不自动写入长期 Memory 或 Knowledge Base；
- 引用只能来自真实 Search/Fetch receipt 中出现的 URL。

## 14. Run Snapshot、OAEP 与 Inspector

Run Snapshot 固化：

```json
{
  "perceptor_id": "web-tavily-main",
  "adapter": "tavily",
  "revision": "sha256:...",
  "capabilities": ["web.search", "web.extract"],
  "fallback_policy_revision": "sha256:..."
}
```

OAEP 至少记录：

```text
tool.call.started
tool.call.completed / tool.call.failed
web.search.completed
web.fetch.completed
perceptor.fallback
web.fetch.browser_escalated
budget.exhausted
citation.evidence
```

Inspector 展示：

- 用户原始查询和实际查询；
- 实际感知器及是否发生 fallback；
- Provider request ID、延迟和积分使用量；
- Search 候选、接受结果与拒绝原因；
- Fetch URL、最终 URL、正文 hash 和截断状态；
- 安全拒绝、超时、限流、凭据和运行时错误；
- 不展示明文凭据和原始认证信息。

## 15. 实施批次

### P1-A：契约与目录

- [ ] 冻结 Search/Fetch/Receipt/Error 最小契约；
- [ ] 建立 `providers/` 目录；
- [ ] 将现有 Playwright 实现包装为 Provider；
- [ ] 保证现有 `web_search` 基础参数兼容。

### P1-B：Tavily Adapter

- [ ] 实现异步 REST Client；
- [ ] 实现 Search 映射；
- [ ] 实现 Extract 映射；
- [ ] 实现超时、取消、响应上限和 secret redaction；
- [ ] 实现 Provider contract tests。

### P1-C：配置与绑定

- [ ] 建立 Tavily Perceptor Resource；
- [ ] 接入现有安全凭据存储；
- [ ] 增加 Search/Extract 独立测试；
- [ ] 智能体配置增加感知器绑定；
- [ ] 删除、替换和凭据轮换执行引用检查。

### P1-D：Router 与 Tool

- [ ] 实现最小 Search/Extract Router；
- [ ] `web_search` 改为 Router 驱动；
- [ ] 新增一等 `web_fetch`；
- [ ] 实现预算、fallback 和取消传播；
- [ ] 停止 Search 自动读取结果正文。

### P1-E：证据与发布

- [ ] 接入 Run Snapshot、OAEP 和 Inspector；
- [ ] 完成 Desktop/TUI 真实网络验收；
- [ ] 验证 Android local/remote-required 能力真实性；
- [ ] 完成安全、凭据和回归测试；
- [ ] 记录真实 Tavily 积分、P50/P95 延迟和失败率基线。

## 16. 测试方案

### 16.1 单元与契约测试

- Search/Fetch 正常响应映射；
- Unicode 和中英文查询；
- max results、domain filter 和 freshness；
- 空结果、重复 URL 和缺失可选字段；
- Search content 只进入 `snippet`；
- Fetch 正文规范化、hash 和截断；
- 400、401、429、5xx、timeout 和无效 JSON；
- 取消传播；
- API Key、Bearer Header 和异常脱敏；
- Provider 能力不匹配。

### 16.2 Router 测试

- Tavily 健康时不调用 fallback；
- timeout、429、5xx 和无效响应触发 Playwright；
- 认证失败、安全拒绝、取消和零结果不 fallback；
- fallback 顺序稳定；
- 调用预算耗尽后不再执行 Provider；
- Run 使用启动时冻结的配置 revision。

### 16.3 集成测试

- Agent 自然选择 `web_search`；
- Search 后按需调用 `web_fetch`；
- 未绑定感知器时不暴露工具；
- 只有 Search 能力时不暴露 `web_fetch`；
- Tavily Key 替换后旧 Key 不可恢复；
- 删除被 Agent 引用的感知器被阻止或明确迁移；
- Renderer 和 API 全链路无凭据泄漏。

### 16.4 真实质量验收

固定场景至少包括：

```text
HEPiX 2026
近期新闻或时间敏感事实
中文查询与对应英文实体查询
指定官方域名查询
无结果查询
需要先搜索再读取两份来源的核实任务
```

记录：

- Top 5 官方来源命中率；
- 有效 URL 比例；
- Search 零结果率；
- Fetch 成功率；
- P50/P95 延迟；
- 每次任务积分消耗；
- fallback 率及原因；
- 引用与真实 receipt 一致率。

## 17. 发布与回退策略

P1 使用功能开关分阶段启用：

```text
未配置 Tavily       Playwright 保持现有可用路径
配置并测试成功       Tavily 成为 Primary
Tavily 暂时故障      按 Agent 策略切换 Playwright
Tavily 认证失败      明确提示修复凭据，不静默掩盖
关闭 Tavily 感知器   不再解析或使用其凭据
```

首次发布不移除旧 Playwright 代码。完成真实稳定性观测后，再决定是否降低其默认安装和启动成本。

## 18. P1 完成标准

- [ ] Tavily 以 `public_web` 感知器资源存在，并由具体 Agent 显式引用；
- [ ] Tool、Router、Provider 三层依赖方向成立，`tool.py` 不直接依赖 Tavily；
- [ ] `web_search` 只返回结构化搜索结果，不隐式 Fetch 正文；
- [ ] `web_fetch` 是一等模型工具，并能使用 Tavily Extract；
- [ ] Playwright 已适配为明确 fallback，不再是唯一搜索底座；
- [ ] Tavily Search/Extract 均通过统一契约测试；
- [ ] 凭据只经安全引用解析，日志、API、OAEP、Snapshot 和 Renderer 无明文泄漏；
- [ ] timeout、429、5xx、认证失败、零结果和取消行为符合 Router 策略；
- [ ] Search/Fetch receipt、Provider revision、fallback 和 citation evidence 可追溯；
- [ ] Desktop/TUI 真实质量验收显示相对现有 Bing/Playwright 有明确改善；
- [ ] Android 和 Remote Runtime 的能力状态与真实执行位置一致；
- [ ] 现有 Agent、模型提供方、工具、技能和知识库配置无回归。
