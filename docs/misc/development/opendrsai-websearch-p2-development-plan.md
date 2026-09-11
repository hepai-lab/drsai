# OpenDrSai WebSearch P2 开发方案：可插拔 Search/Extract Provider 架构

> 阶段：WebSearch P2  
> 状态：待 P1 完成后实施  
> 日期：2026-08-08  
> 适用平台：Desktop、TUI、Android、Remote Runtime  
> 前置阶段：[OpenDrSai WebSearch P1](./opendrsai-websearch-p1-development-plan.md)  
> 架构决策：[网络搜索与浏览器工具架构决策](./opendrsai-web-search-and-browser-tool-architecture.md)

## 1. 阶段结论

P2 将 P1 的单一 Playwright/Bing 实现升级为 Provider-neutral 的网络检索平台，同时保持模型侧 `web_search` 契约稳定。

目标架构：

```text
Agent
  -> web_search
       -> Search Router
            -> Managed Gateway
            -> SearXNG
            -> Brave Search
            -> DDGS
            -> Tavily / Exa / Firecrawl / Parallel
            -> Provider-native Search
            -> Playwright Search Fallback

  -> web_fetch
       -> Extract Router
            -> Direct HTTP + Readability
            -> Firecrawl / Tavily / Exa / Parallel
            -> Playwright Dynamic Fetch Fallback
```

Search 和 Extract 是不同能力，可以独立选择 Provider。浏览器自动化是动态页面升级路径，不是默认搜索底座。搜索配置属于 Tool Resource，并由具体 Agent 显式引用；不得形成“所有智能体隐式共享一个不可审计默认搜索工具”的产品语义。

## 2. P2 目标

### 2.1 产品目标

1. 用户可为具体 Agent 启用一个或多个 Web Search Tool Resource。
2. 搜索与网页提取可分别选择最合适的 Provider。
3. Provider 失败时按明确策略切换备用 Provider，用户能看到发生了 fallback。
4. 搜索结果、正文提取和浏览器升级在 UI 中语义分离。
5. Desktop、TUI、Android 和远程 Runtime 使用同一 Kernel 契约，平台仅通过 Host Adapter 提供实现。
6. 回答中的来源可追溯到真实 Search/Fetch Tool Receipt。

### 2.2 工程目标

1. 建立稳定的 `SearchProvider`、`ExtractProvider` 和 Router 接口。
2. 统一 Provider 能力、配置、凭据、健康状态、限流和错误分类。
3. 新增一等 `web_fetch` Tool。
4. Run Snapshot 固化本次实际使用的 Provider、配置 revision 和策略。
5. 支持开发环境免费/自建路径和生产托管路径。
6. 形成 Provider contract test，新增 Provider 不修改 Agent Kernel。

## 3. 范围

### 3.1 包含

- 多 Search Provider；
- 多 Extract Provider；
- Search/Extract 独立配置；
- Primary、fallback 和自动健康路由；
- Provider 凭据安全存储；
- Provider 配置测试与诊断；
- 结构化 Search Result；
- 规范化 Fetched Document；
- 缓存、去重、超时、重试和限流；
- 域名、时间范围、语言和地区参数；
- 引用证据与内容哈希；
- Playwright 动态页面 fallback；
- Desktop/TUI/Android Host 能力协商；
- 管理界面和 Agent Tool 绑定。

### 3.2 不包含

- 通用互联网爬虫平台；
- 不受限的递归 Crawl；
- 绕过登录、付费墙、验证码或 robots 策略；
- 把网页内容写入长期知识库的自动摄取；
- 搜索广告优化；
- 自建通用搜索索引；
- 把 Search Provider 绑定到某个模型 Provider 的全局默认配置。

## 4. 能力模型

### 4.1 Tool 与 Provider 分层

```text
Tool Resource          Agent 可启用的稳定能力
Tool Contract          模型可见 schema
Tool Router            选择 Provider 与 fallback
Provider Adapter       调用具体服务或本地实现
Host Capability        当前平台真实可执行条件
Run Snapshot           本次解析结果与配置 revision
Receipt/Evidence       实际调用及来源证据
```

Tool、Skill、Provider 必须区分：

- Tool：可执行契约，例如 `web_search`、`web_fetch`；
- Skill：指导何时、如何组合 Tool；
- Provider：Tool 的底层实现；
- Browser：遇到动态页面时的 Host 能力。

### 4.2 模型工具

P2 保留 P1 的 `web_search`，扩展可选参数但保持向后兼容：

```json
{
  "query": "string",
  "max_results": 8,
  "allowed_domains": ["example.com"],
  "blocked_domains": [],
  "freshness": "day|week|month|year|null",
  "locale": "zh-CN"
}
```

新增：

```json
{
  "name": "web_fetch",
  "parameters": {
    "type": "object",
    "properties": {
      "url": {"type": "string"},
      "extraction": {
        "type": "string",
        "enum": ["readable_markdown", "text", "metadata"]
      },
      "max_chars": {
        "type": "integer",
        "minimum": 1000,
        "maximum": 50000
      }
    },
    "required": ["url"],
    "additionalProperties": false
  }
}
```

Provider 名称、API Key 和内部路由参数不进入模型 Tool Schema。

## 5. Provider 接口

### 5.1 SearchProvider

```python
class SearchProvider(Protocol):
    provider_id: str

    async def capabilities(self) -> SearchCapabilities: ...
    async def health(self) -> ProviderHealth: ...
    async def search(self, request: SearchRequest) -> SearchResponse: ...
```

`SearchCapabilities` 至少包含：

- domain filter；
- freshness filter；
- locale/location；
- safe search；
- maximum result count；
- raw snippets；
- publication date；
- citation metadata；
- whether server-side synthesis is used。

### 5.2 ExtractProvider

```python
class ExtractProvider(Protocol):
    provider_id: str

    async def capabilities(self) -> ExtractCapabilities: ...
    async def health(self) -> ProviderHealth: ...
    async def fetch(self, request: FetchRequest) -> FetchedDocument: ...
```

能力至少包含：

- static HTML；
- JavaScript rendering；
- PDF；
- maximum document size；
- readable Markdown；
- metadata extraction；
- batch fetch；
- authenticated session；
- robots/policy behavior。

### 5.3 标准结果

所有 Provider 必须转换为统一结构，不把 Provider 私有响应直接暴露给模型。

```json
{
  "rank": 1,
  "title": "...",
  "url": "https://...",
  "snippet": "...",
  "published_at": null,
  "source_domain": "example.com",
  "provider": "provider-id",
  "provider_result_id": "optional",
  "score": null
}
```

```json
{
  "requested_url": "https://...",
  "final_url": "https://...",
  "title": "...",
  "content": "...",
  "content_type": "text/html",
  "retrieved_at": "...",
  "provider": "provider-id",
  "content_sha256": "sha256:...",
  "truncated": false,
  "warnings": []
}
```

## 6. 配置设计

### 6.1 Tool Resource

建议继续使用现有 Tool Registry，而不是新建平行配置系统。示例：

```toml
tool_id = "web-search-main"
type = "web-search"
name = "网络搜索"
enabled = true

[config]
search_provider = "searxng-main"
extract_provider = "direct-readability"
fallback_search_providers = ["brave-main", "bing-playwright"]
fallback_extract_providers = ["dynamic-playwright"]
max_results = 8
timeout_seconds = 15
cache_ttl_seconds = 900
```

Agent 只引用 Tool Resource ID：

```toml
[tools]
mode = "explicit"
enabled = ["web-search-main"]
```

允许存在多个搜索资源，例如：

- `web-search-public`：公共网络；
- `web-search-research`：高质量学术检索；
- `web-search-intranet`：受控内网搜索。

具体 Agent 选择具体资源，不设隐式全局默认搜索工具。

### 6.2 Provider Resource

建议新增 Provider Registry，或以严格子资源形式归属于 Tool Registry：

```toml
provider_id = "searxng-main"
kind = "search"
adapter = "searxng"
enabled = true

[config]
base_url = "https://search.example.com"
credential_ref = "drsai-credential:..."
```

凭据必须进入现有系统安全存储，Renderer、日志、TOML 公共响应和 Run Snapshot 只保留 credential reference 或是否已配置，不返回明文。

### 6.3 Search/Extract 独立选择

必须支持：

```toml
search_provider = "searxng-main"
extract_provider = "firecrawl-main"
```

搜索只负责发现 URL；正文提取根据目标页面特性选择独立 Provider。禁止因为一个 Provider 只支持 Search 就把整个 Tool 标为不可用。

## 7. Router 与 Fallback

### 7.1 路由输入

Router 根据以下信息选择 Provider：

- Agent Tool Resource；
- 当前平台 Host Capabilities；
- Provider enabled/health/credential 状态；
- 请求需要的 domain/freshness/locale 能力；
- 网络策略和域名策略；
- Provider 限流与最近错误；
- Run 固定的路由策略 revision。

### 7.2 Fallback 原则

只对安全、幂等、只读错误 fallback：

- timeout；
- 429；
- 5xx；
- DNS/连接失败；
- Provider 暂时不可用；
- Provider 不支持请求能力。

以下情况不 fallback：

- URL/域名被安全策略拒绝；
- Agent 未启用工具；
- 用户或管理员明确禁止；
- 凭据被撤销且没有配置备用 Provider；
- 请求参数无效；
- 内容策略拒绝。

每次 fallback 必须形成 receipt，UI 可展开查看，不得静默掩盖。

### 7.3 浏览器升级

默认顺序：

```text
Direct HTTP/Extract Provider
  -> 检测需要 JS、登录或交互
  -> Browser capability negotiation
  -> Playwright Dynamic Fetch
```

浏览器升级必须记录原因。普通 Search Provider 失败不能无限制启动浏览器重试。

## 8. 缓存、去重与预算

### 8.1 Search Cache

缓存键至少包含：

```text
provider_id
provider_config_revision
normalized_query
locale
freshness
allowed_domains
blocked_domains
max_results
```

时效性查询可使用较短 TTL；明确要求 live/最新时允许绕过缓存。缓存命中也必须保留原始 retrieval time 和 cache age。

### 8.2 Fetch Cache

按 canonical URL、Provider revision 和 extraction mode 缓存。保留 ETag、Last-Modified 时支持条件请求。

### 8.3 去重

- URL canonicalization；
- 移除常见 tracking 参数；
- 规范化 host 与 fragment；
- 标题/内容哈希辅助去重；
- 同域名结果保留多样性上限；
- 不合并内容不同但 URL 相近的页面。

### 8.4 Run 预算

每个 Run 设置：

- 最大搜索轮次；
- 最大 Fetch 页面数；
- 最大外部正文字符数；
- 最大浏览器升级次数；
- 最大总检索时间；
- 最大 Provider 费用预算（若适用）。

预算耗尽应返回结构化限制原因，不继续循环搜索。

## 9. 安全设计

### 9.1 网络边界

- 默认只允许公共 HTTP/HTTPS；
- 拒绝 localhost、私网、link-local、保留 IP 和云元数据；
- DNS 解析前后均检查，防止 DNS rebinding；
- 校验全部重定向；
- 限制响应大小、压缩比和读取时间；
- 拒绝危险 MIME 和自动下载；
- 内网搜索必须使用独立 Tool Resource 和显式策略。

### 9.2 Prompt Injection

- Search snippet 和页面正文标记为不可信外部数据；
- 外部内容不得修改 System Prompt、Agent Policy、Tool Policy 或 Approval；
- 页面要求执行命令、上传文件、泄露凭据时必须忽略并记录；
- Search/Fetch Tool Result 与模型指令层分离；
- 引用内容不自动进入长期 Memory 或 Knowledge Base。

### 9.3 凭据

- Provider Key 仅在 Host Adapter 内解析；
- 不进入模型上下文；
- 不写日志、OAEP、Renderer 或 Run Snapshot；
- 支持凭据轮换和删除引用检查；
- Provider 测试结果不得回显响应中的敏感 Header。

## 10. Run Snapshot 与 OAEP

每次 Run 固化：

```json
{
  "tool_id": "web-search-main",
  "tool_contract_version": 2,
  "search_provider": "searxng-main",
  "extract_provider": "direct-readability",
  "fallback_policy_revision": "sha256:...",
  "provider_config_revisions": {
    "searxng-main": "sha256:...",
    "direct-readability": "sha256:..."
  }
}
```

不保存明文凭据。历史 Run 的可解释性依赖 revision 和 receipt，不要求按历史配置重新访问外网。

OAEP 至少表达：

- `tool.call.started`；
- `tool.call.completed/failed`；
- search results summary；
- fetch document evidence；
- provider fallback；
- browser escalation；
- citation evidence；
- budget/limit reached。

## 11. Desktop 配置与用户体验

### 11.1 设置入口

网络搜索作为 Tool Resource 在具体智能体的“工具”中启用。Provider 的全局资源管理入口负责连接信息和凭据，但不产生隐式 Agent 默认绑定。

建议界面：

```text
网络搜索
  搜索服务        SearXNG
  网页读取        直接读取
  备用搜索        Brave、浏览器搜索
  动态网页备用    Playwright
  状态            可用
  最近测试        搜索 OK · 读取 OK
```

支持：

- 新建/编辑/删除 Provider；
- 搜索测试；
- Fetch 测试；
- 显示能力与限制；
- 配置 fallback 顺序；
- 查看引用此 Tool Resource 的 Agent；
- 凭据只显示“已安全保存”。

### 11.2 Run 状态

统一阶段：

```text
正在搜索网络
正在读取网页
正在切换备用搜索服务
正在使用浏览器读取动态网页
已找到 8 个结果 · 已读取 3 个来源
```

Provider 细节默认折叠，Run Inspector 中完整展示。

## 12. API 建议

沿用 Tool Registry 入口并补充专用操作：

```text
GET/POST       /v1/config/tools
GET/PUT/DELETE /v1/config/tools/{tool_id}
POST           /v1/config/tools/{tool_id}/test
GET             /v1/config/tools/{tool_id}/capabilities
```

Provider Registry：

```text
GET/POST       /v1/config/web-providers
GET/PUT/DELETE /v1/config/web-providers/{provider_id}
POST           /v1/config/web-providers/{provider_id}/test-search
POST           /v1/config/web-providers/{provider_id}/test-fetch
GET             /v1/config/web-providers/{provider_id}/capabilities
```

运行时 API 不允许 Renderer 直接调用 Provider；所有真实搜索必须经过 Runtime Tool 执行和审计。

## 13. 模块更新

建议新增：

```text
cores/python/packages/drsai/src/drsai/backend/runtime/web_search/
  contracts.py
  router.py
  normalization.py
  cache.py
  security.py
  evidence.py
  providers/
    searxng.py
    brave.py
    ddgs.py
    direct_fetch.py
    playwright.py
```

建议更新：

- `drsai/config/tool_registry.py`：Web Tool Resource；
- 新增 `drsai/config/web_provider_registry.py`：Provider 配置和凭据引用；
- `drsai/backend/runtime/agent_kernel.py`：`web_search`、`web_fetch` 能力域和策略；
- `drsai/backend/runtime/desktop_autogen_ports.py`：Tool Schema/Result；
- `drsai/backend/runtime/desktop_kernel_coordinator.py`：路由、执行、取消；
- `drsai/backend/runtime/oaep.py`：Search/Fetch/fallback evidence；
- `drsai/modules/agents/skills_agent/drsai_assistant.py`：具体 Agent Tool 装配；
- `apps/desktop/shared/main/myDrSaiConfig.ts`：配置 IPC；
- `apps/desktop/shared/api/desktopApi.ts`：配置类型；
- Desktop Renderer 智能体工具与 Provider 管理界面；
- Android Host Adapter：本地 HTTP、托管 Gateway 或 `remote-required` 协商。

## 14. 分批实施

### P2-A：Provider 契约

- [ ] 定义 Search/Extract 请求、响应、能力和错误模型。
- [ ] 建立 contract tests。
- [ ] P1 Playwright 实现适配到新接口。
- [ ] 保证 P1 模型 Tool Schema 不变。

### P2-B：Search Provider

- [ ] 实现至少一个免费/自建 Provider。
- [ ] 实现至少一个带凭据 Provider。
- [ ] 实现 Router、health、fallback 和 receipt。
- [ ] 实现缓存与去重。

### P2-C：Extract Provider

- [ ] 实现 Direct HTTP + Readability。
- [ ] 实现至少一个动态/托管 Extract Provider。
- [ ] 新增 `web_fetch` Tool。
- [ ] 接入内容限制、SSRF 防护和 citation evidence。

### P2-D：配置与 UI

- [ ] Provider Registry 与安全凭据。
- [ ] Desktop 配置、测试和能力展示。
- [ ] Agent Tool Resource 绑定。
- [ ] Run 状态、fallback 和 Inspector。

### P2-E：跨平台与发布

- [ ] Desktop/TUI 同一契约验收。
- [ ] Android local/remote-required 策略验收。
- [ ] 开发版/生产版配置隔离。
- [ ] Provider 故障、限流和升级演练。

## 15. 测试方案

### 15.1 Provider Contract Test

每个 Provider 必须通过同一测试集：

- 基本查询；
- Unicode 查询；
- domain allow/deny；
- freshness；
- max_results；
- 空结果；
- 429、5xx、timeout；
- 错误响应格式；
- 重复结果；
- citation 元数据；
- 取消；
- secret redaction。

### 15.2 Router 测试

- Primary 健康时不 fallback；
- Primary 429/5xx/timeout 时切换；
- 安全策略拒绝时不切换；
- Provider 能力不匹配时选择兼容 Provider；
- fallback 顺序稳定；
- Run Snapshot revision 固定；
- 历史 Run 不受配置更新影响；
- 预算耗尽停止路由。

### 15.3 Search/Fetch 集成

- Search 结果 URL 可交给 Fetch；
- Search-only Provider 与独立 Extract Provider 组合成功；
- 静态 Fetch 成功时不启动浏览器；
- JS 页面按规则升级 Playwright；
- Fetch 结果生成内容哈希和 evidence；
- 模型只能引用真实 receipt 中的来源。

### 15.4 安全测试

- IPv4/IPv6 localhost；
- 私网和 link-local；
- DNS rebinding；
- 多次重定向到私网；
- 压缩炸弹和超大响应；
- 恶意 MIME/download；
- 网页 Prompt Injection；
- Provider 响应中的伪造系统指令；
- 凭据不进入日志、OAEP 和 Renderer。

### 15.5 产品验收

1. 普通知识问题无需搜索，可直接回答；
2. 陌生实体、最新信息和明确核实任务自动搜索；
3. 搜索后按需 Fetch，不无意义打开所有结果；
4. 来源可点击、可追溯；
5. Primary 故障时用户能看到备用服务接管；
6. 所有 Provider 不可用时给出具体配置入口；
7. 限制性结束不显示为普通“已完成”；
8. 两个 Agent 可绑定不同 Search Tool Resource，运行时不串配置；
9. 开发版和生产版并存时配置、缓存和凭据隔离；
10. Android 无本地实现时明确显示 remote-required，不伪装成本地能力。

## 16. 性能与可靠性门槛

- Search 首个状态事件：P95 小于 500 ms；
- 健康 Provider 基本查询：P95 小于 5 秒；
- Direct Fetch：P95 小于 5 秒；
- Provider fallback 决策：故障确认后 1 秒内开始备用调用；
- Run 取消后外部请求/浏览器：2 秒内停止；
- 缓存命中：P95 小于 100 ms；
- 无凭据泄漏；
- 无遗留浏览器进程；
- 真实网络稳定性测试中成功率达到发布门槛，具体数值由发布环境基线确定并写入验收账本。

## 17. P2 完成标准

- [ ] `web_search` 与 `web_fetch` 均为一等 Tool；
- [ ] Search/Extract Provider 可独立配置；
- [ ] 至少两个 Search 实现和两个 Extract 实现通过统一 contract tests；
- [ ] Router、fallback、缓存、去重和预算闭环；
- [ ] Playwright 仅作为明确的 fallback/动态页面实现；
- [ ] Tool Resource 由具体 Agent 引用，无隐式全局默认绑定；
- [ ] Run Snapshot 固化实际 Provider revision；
- [ ] OAEP、citation evidence 和 Run Inspector 可追溯；
- [ ] 安全与凭据测试通过；
- [ ] Desktop、TUI 和 Android 能力协商符合真实平台状态；
- [ ] 开发版与生产版隔离验收通过；
- [ ] P1 真实用户场景无回归。

