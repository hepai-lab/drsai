# OpenDrSai 网络搜索与浏览器工具架构决策

> 状态：已形成结论，待进入实现计划  
> 日期：2026-08-08  
> 适用范围：OpenDrSai Agent Runtime、Desktop、TUI、Android Host Adapter  
> 关联能力：Tool Registry、Skill Registry、Run Capability Snapshot、OAEP citation evidence

实施方案：

- [OpenDrSai WebSearch P1：复用 WebUI 的 Playwright 搜索闭环](./opendrsai-websearch-p1-development-plan.md)
- [OpenDrSai WebSearch P2：可插拔 Search/Extract Provider 架构](./opendrsai-websearch-p2-development-plan.md)

## 1. 决策摘要

OpenDrSai 不应把 `playwright-cli` Skill 当作默认网络搜索能力。

目标架构应明确拆分为三个一等能力：

```text
web_search          发现候选网页，返回结构化搜索结果
web_fetch           读取指定 URL，提取正文与引用证据
browser_automation  处理登录、JavaScript、交互和动态页面
```

`playwright-cli` 的最终定位是 `browser_automation` 的一种 Desktop Host 实现，以及 `web_fetch` 遇到动态页面时的升级路径。它不应直接声明为通用 `web_search`，也不应因为 Agent 具有 Shell 权限就推断该 Agent 具有可靠检索能力。

短期可以复用旧 WebUI 的实现思路：对模型暴露稳定的 `web_search` 工具，由 Adapter 内部暂时通过 Playwright 打开 Bing 并解析结果；中长期把底层替换为 SearXNG、Brave、Firecrawl、Tavily、Exa 等 Provider，不改变模型工具协议和上层策略。

## 2. 问题背景

Desktop Agent 已能发现仓库中的 `skills/skills/playwright-cli/SKILL.md`，因此模型能够列出 `playwright-cli` 技能。但是“Skill 已发现”只表示 Agent 看到了技能名称和使用说明，不表示本次 Run 已注册其依赖的可执行工具。

在“HEPiX2026 是什么”案例中，Runtime 将任务判定为必须使用 `retrieval`，但本次模型 Tool Snapshot 中不存在被分类为 retrieval 的工具，最终产生：

```text
required_tool_unavailable
required_capability_not_available
```

模型没有调用 `Skill("playwright-cli")`，也没有运行 Playwright 命令。当前链路存在以下断点：

1. `playwright-cli` 是技能名称，不是模型可调用的 `web_search` 工具。
2. Skill frontmatter 使用 `allowed-tools`，当前 `SkillLoader` 只解析 `required_tools`。
3. `Bash(playwright-cli:*)` 是 Claude Code 风格权限语法，不能直接映射为 Windows Runtime 的 `run_powershell`。
4. Tool Decision Policy 只按实际 Tool 名称计算 retrieval domain，不计算尚未激活的 Skill 可能贡献的能力。
5. 当 retrieval 不可用时，Kernel 在模型有机会加载 Skill 前就 fail-closed。

## 3. Playwright CLI 是否适合网络搜索

### 3.1 适合的场景

`playwright-cli` 适合以下任务：

- 操作必须执行 JavaScript 的动态网页；
- 使用登录态、Cookie 或本地浏览器 Profile；
- 点击、输入、滚动、分页、上传和下载；
- 浏览器端功能测试、视觉检查、截图和 Trace；
- Search/Fetch Provider 无法读取页面时进行升级处理；
- 用户明确要求在可见浏览器中完成操作。

微软将 Playwright CLI 定位为面向编码 Agent 的浏览器自动化接口，重点能力是页面操作、测试、快照、调试和持久会话，而不是搜索引擎 API：

- https://github.com/microsoft/playwright-cli
- https://playwright.dev/

### 3.2 不适合作为默认搜索底座的原因

| 维度 | Playwright 搜索页方案 | 一等 Search Provider |
|---|---|---|
| 启动成本 | 需要浏览器进程和页面加载 | 单次 HTTP/API 请求 |
| 延迟 | 较高且波动明显 | 通常较低、可超时控制 |
| 结果结构 | 依赖搜索页 DOM 解析 | 稳定的 title/url/snippet/date |
| 稳定性 | 受 DOM、弹窗、地区和 A/B 测试影响 | Provider 契约稳定 |
| 并发 | 需要管理浏览器与 Session | 易做连接池、限流和缓存 |
| 引用证据 | 需要自行重建来源元数据 | 可保留 Provider 原始结果 |
| 安全边界 | 浏览器、Shell、下载能力较宽 | 可限制为只读 Search/Fetch |
| 反自动化 | 容易遇到验证码和 Headless 检测 | Search API 通常避免该问题 |
| 可替换性 | 与具体搜索页强绑定 | Provider Adapter 可热替换 |

因此：

> Playwright 适合做浏览器执行器和搜索兜底，不适合做基础搜索引擎。

## 4. 主流 Agent 的搜索架构

### 4.1 Codex

Codex 将 Web Search 作为独立的一等工具，并把 Browser、Computer Use、Shell 和 Skills 作为不同能力。官方配置提供 `disabled`、`cached`、`indexed`、`live` 搜索模式，还能配置允许域名、上下文大小和近似位置：

- https://learn.chatgpt.com/docs/config-file/config-reference

其能力关系可以概括为：

```text
Web Search            发现信息
Browser/Computer Use  操作网页和应用
Shell                 执行本地命令
Skills                指导现有工具如何组合
```

### 4.2 Claude Code

Claude Code 提供独立的 `WebSearch` 和 `WebFetch`：前者查找标题与 URL，后者读取页面。Skill 是可复用工作流说明，通过既有 `Skill` 工具加载，不会自动新增搜索工具。

- https://code.claude.com/docs/en/tools-reference
- https://code.claude.com/docs/en/agent-sdk/agent-loop

### 4.3 Gemini CLI

Gemini CLI 提供 `google_web_search` 和 `web_fetch`，并与 `run_shell_command` 分离。`google_web_search` 使用 Gemini API 的 Google Search grounding 返回摘要、来源和引用，再由 `web_fetch` 深入读取指定 URL。

- https://google-gemini.github.io/gemini-cli/docs/tools/web-search.html
- https://google-gemini.github.io/gemini-cli/docs/tools/web-fetch.html

### 4.4 Hermes Agent

Hermes Agent 对模型暴露 `web_search` 和 `web_extract`，底层可选择 Firecrawl、SearXNG、Brave、DDGS、Tavily、Exa、Parallel 或 xAI，并允许 Search 与 Extract 使用不同 Provider。

- https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/web-search.md

Hermes 的 Provider 分层最适合作为 OpenDrSai 的直接参考：

```yaml
web:
  search_backend: searxng
  extract_backend: firecrawl
```

### 4.5 共同结论

上述 Agent 的共同设计不是“让模型通过 Shell 模拟搜索”，而是：

1. 对模型暴露稳定、结构化、可审计的一等 Search Tool；
2. 将 URL 内容提取设计成独立 Fetch/Extract Tool；
3. 将浏览器用于动态页面、登录态和交互升级；
4. Skill 负责工作流知识，不冒充基础执行能力；
5. Tool 能力、权限、Provider 和运行状态在 Run 前完成解析。

## 5. 旧 WebUI 的实现结论

旧 WebUI 并不是简单加载 `playwright-cli` Skill。它向模型注册了专用 `web_search` Tool Schema，然后在 WebSurfer 内部通过 Playwright 访问 Bing：

- `apps/webui/backend/src/drsai_ui/agent_factory/magentic_one/agents/web_surfer/_tool_definitions.py`
- `apps/webui/backend/src/drsai_ui/agent_factory/magentic_one/agents/web_surfer/_web_surfer.py`

实际架构为：

```text
Model -> web_search Tool -> WebSurfer Adapter -> Playwright -> Bing
```

这个设计虽然仍有浏览器搜索的性能和稳定性问题，但它保留了正确的模型工具边界：模型只依赖 `web_search` 契约，底层实现可以被替换。

Desktop 当前退化成了：Skill 可见，但 retrieval Tool 不可用。应恢复“一等 Tool + 可替换 Adapter”的边界，而不是把 Shell 或 Skill 名称直接归类为 retrieval。

## 6. OpenDrSai 目标架构

### 6.1 Tool 契约

建议至少提供以下工具：

```python
web_search(
    query: str,
    max_results: int = 8,
    allowed_domains: list[str] | None = None,
    blocked_domains: list[str] | None = None,
    freshness: str | None = None,
    locale: str | None = None,
) -> SearchResponse

web_fetch(
    url: str,
    extraction: str = "readable_markdown",
    max_chars: int | None = None,
) -> FetchedDocument
```

`web_search` 返回结构：

```json
{
  "query": "HEPiX 2026",
  "provider": "searxng",
  "retrieved_at": "2026-08-08T00:00:00Z",
  "results": [
    {
      "rank": 1,
      "title": "...",
      "url": "https://...",
      "snippet": "...",
      "published_at": null
    }
  ]
}
```

`web_fetch` 至少保存：

- 最终 URL 与重定向链；
- 页面标题；
- 获取时间；
- MIME type、HTTP 状态和内容长度；
- 规范化正文；
- 内容哈希；
- Provider/Extractor 标识；
- citation evidence 所需来源信息。

### 6.2 Provider Adapter

```text
WebSearchTool
  -> SearchProvider
       -> Managed Gateway
       -> SearXNG
       -> Brave
       -> DDGS
       -> Tavily / Exa / Firecrawl
       -> PlaywrightSearchFallback

WebFetchTool
  -> ExtractProvider
       -> Direct HTTP + Readability
       -> Firecrawl / Tavily / Exa
       -> PlaywrightDynamicFetchFallback
```

搜索 Provider 与模型 Provider 必须解耦。某个模型是否支持 Provider-native Web Search 可以作为一种 Adapter，但不应成为 OpenDrSai 搜索能力的唯一来源。

### 6.3 Playwright Skill 的能力声明

`playwright-cli` 建议声明：

```yaml
capabilities:
  - browser_automation
  - dynamic_web_fetch
  - authenticated_web_session
```

不建议直接声明：

```yaml
capabilities:
  - web_search
```

如果 Search Adapter 选择 Playwright fallback，应由 Adapter 负责调用受控浏览器能力，而不是让模型自由拼接 Shell 命令。

## 7. 分阶段落地建议

### 阶段 A：恢复功能闭环

1. 注册真实的 `web_search` Tool，并进入 Tool Registry、Agent Policy 和 Run Tool Snapshot。
2. 临时复用旧 WebSurfer/Playwright Bing Adapter，返回统一结构化结果。
3. 修复 `completed_with_limitation` 在 OAEP/Desktop 中被展示为“已完成”的语义问题。
4. 删除生产策略中针对 `hepix` 的硬编码 fixture；保留通用的陌生实体、年份、时效性和明确核实规则。

### 阶段 B：引入 Provider 分层

1. 建立 `SearchProvider` 和 `ExtractProvider` 接口。
2. 开发环境接入 DDGS 或 SearXNG。
3. 生产环境接入托管 Gateway 或可配置商业 Provider。
4. 实现缓存、超时、重试、限流、结果去重和 Provider 健康检查。
5. 引入 `web_fetch`，把搜索发现与正文读取拆开。

### 阶段 C：浏览器升级路径

1. 将 `playwright-cli` 接入受控的 `browser_automation` Host Port。
2. 仅在 JS、登录、交互或普通 Fetch 失败时升级。
3. 支持可见/无头、临时/持久 Session 策略。
4. 加入浏览器进程回收、Session 隔离和用户停止能力。

## 8. 安全与可观测性要求

### 8.1 安全

- Search 与 Fetch 默认只读；
- 拦截 localhost、私网、云元数据地址和危险协议；
- 支持 allow/deny domain；
- 限制响应大小、重定向次数、下载类型和请求时间；
- 网页内容必须标记为不可信外部输入；
- 不允许网页文本扩大 Tool 权限或自动授权写操作；
- Playwright 下载、上传、持久 Profile 和连接现有浏览器应使用更高权限等级；
- 不把通用 Shell 自动等价为 retrieval。

### 8.2 可观测性

每次调用至少记录：

- Tool 名称、Provider、query/url 摘要；
- 开始/结束时间、延迟、状态、重试次数；
- 返回结果数、Fetch 字符数和内容哈希；
- 是否发生 Provider fallback 或浏览器升级；
- citation evidence ID；
- 安全策略拒绝原因；
- Run Capability Snapshot 中的能力来源。

## 9. 测试与验收

### 9.1 单元测试

- Tool Decision 能将陌生实体和时效问题路由到 `web_search`；
- Skill 存在但 Tool 不存在时，不得宣称 retrieval 可用；
- Shell 存在时，不得自动宣称 retrieval 可用；
- Search Provider 结果统一化、去重、域名过滤和时间过滤正确；
- Fetch 的 SSRF、重定向、大小和 MIME 限制正确；
- `completed_with_limitation` 不映射为普通完成。

### 9.2 集成测试

- “HEPiX2026 是什么”能自然选择 `web_search`，返回至少一个可访问来源；
- 搜索后能调用 `web_fetch` 读取主要来源；
- Search Provider 不可用时切换备用 Provider，并记录 fallback；
- 静态 Fetch 失败而页面可由浏览器访问时，升级 Playwright；
- Playwright 不在 PATH 或浏览器未安装时返回具体配置错误，不返回“Desktop Runtime 未连接”；
- Agent 禁用 `web.search` 后，模型 Tool Snapshot 与执行注册表都不包含它。

### 9.3 Desktop E2E

- UI 展示“正在搜索”“正在读取网页”“正在使用浏览器”三个不同阶段；
- 最终回答中的来源可点击，并能追溯到 Run evidence；
- 浏览器升级不遮挡主界面，用户可以展开状态并停止；
- Run Inspector 能显示 Provider、查询、URL、耗时和 fallback；
- 无检索能力时显示“需要配置网络搜索”，不得错误显示“已完成”。

## 10. 最终结论

OpenDrSai 应采用：

> 一等 `web_search + web_fetch` 作为基础检索能力，以 `playwright-cli` 作为动态网页、登录态和交互任务的浏览器升级路径。

旧 WebUI 的“稳定 `web_search` Tool + Playwright Adapter”可以作为短期过渡，但不能作为长期唯一 Provider。Tool 是可执行契约，Skill 是工作流知识，两者必须在配置、能力协商、权限和 Run Snapshot 中保持清晰边界。
