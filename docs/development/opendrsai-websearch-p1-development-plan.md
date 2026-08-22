# OpenDrSai WebSearch P1 开发方案：复用 WebUI 的 Playwright 搜索闭环

> 阶段：WebSearch P1  
> 状态：已完成  
> 日期：2026-08-08  
> 目标平台：Windows Desktop 本地 OpenDrSai Agent Runtime  
> 后续阶段：[OpenDrSai WebSearch P2](./opendrsai-websearch-p2-development-plan.md)  
> 架构决策：[网络搜索与浏览器工具架构决策](./opendrsai-web-search-and-browser-tool-architecture.md)

## 1. 阶段结论

P1 的目标不是建设完整的多 Provider 搜索平台，而是以最短、可验证的路径恢复 Desktop OpenDrSai Agent 的真实网络搜索能力：

```text
Agent Model
  -> web_search Tool
  -> Desktop Runtime WebSearch Port
  -> 受控 Playwright
  -> Bing 搜索结果页
  -> 结构化结果 + citation evidence
  -> Agent 最终回答
```

P1 复用旧 WebUI 已验证的思路和关键实现：

- `web_search` 作为模型可调用的一等 Tool；
- Playwright 打开 Bing 搜索页；
- 从页面 Markdown/DOM 提取候选链接；
- 受控读取少量结果页面；
- 禁止下载、限制权限、设置超时；
- 将检索结果回送模型生成有来源的答案。

P1 不直接复用完整 `WebSurfer` Agent、Magentic 编排器和 WebUI 状态管理。生产 Runtime 也不得从 `apps/webui` import 代码，因为独立 Desktop 后端的源码归档和安装环境不保证包含 WebUI 包。应把最小、无 UI 依赖的搜索实现下沉到 `drsai` 核心包。

## 2. 背景与问题

当前 Desktop 能发现 `skills/skills/playwright-cli/SKILL.md`，但本次 Run 的 Tool Snapshot 中没有 retrieval Tool。对于陌生实体、年份或明确核实类任务，Tool Decision Policy 会要求 retrieval；当 `web_search` 不存在时，Run 直接得到：

```text
required_tool_unavailable
required_capability_not_available
```

问题不是模型不会使用 Playwright，而是执行契约没有接通：

1. Skill 可见不等于 Tool 可执行；
2. Shell 不应自动等价为 retrieval；
3. Runtime 缺少模型可见、执行端同源的 `web_search`；
4. 失败结果被映射成普通“已完成”，用户无法区分限制性结束；
5. 旧 WebUI 能搜索，但其实现没有进入新的统一 Agent Runtime。

旧 WebUI 参考实现：

- Tool Schema：`apps/webui/backend/src/drsai_ui/agent_factory/magentic_one/agents/web_surfer/_tool_definitions.py`
- WebSurfer 搜索：`apps/webui/backend/src/drsai_ui/agent_factory/magentic_one/agents/web_surfer/_web_surfer.py`
- 独立 Bing 搜索与页面提取：`apps/webui/backend/src/drsai_ui/agent_factory/magentic_one/tools/bing_search.py`
- Playwright Controller：`apps/webui/backend/src/drsai_ui/agent_factory/magentic_one/tools/playwright/playwright_controller.py`

## 3. 实现目标

### 3.1 产品目标

1. 用户询问“HEPiX2026 是什么”等陌生或时效性问题时，OpenDrSai 自动搜索，不要求用户手工点击或启用 Skill。
2. 搜索过程在 Desktop 中显示为“正在搜索网络”，最终回答包含可点击来源。
3. 无浏览器、无网络、被策略拦截和搜索无结果时，返回具体、可修复的原因。
4. 搜索是具体 Agent 的 Tool 能力，由 Agent Tool Policy 决定是否启用。
5. P1 不要求用户配置 Search API Key。

### 3.2 工程目标

1. 在 Runtime 注册稳定的模型工具名 `web_search`。
2. Tool Registry 使用稳定资源 ID，建议为 `builtin.web-search`；模型工具名与资源 ID 分离。
3. 模型可见 Tool Snapshot 与执行 Tool Registry 来自同一个解析结果。
4. 将 WebUI 的最小搜索逻辑迁入核心包，清除 WebUI、Electron 和 Magentic 编排依赖。
5. 生成规范化搜索结果和 OAEP citation evidence。
6. 为 P2 保留 Adapter 边界，模型工具契约不再变化。

## 4. P1 范围

### 4.1 包含

- Bing 搜索结果页访问；
- 最多返回 8 条结构化候选结果；
- 默认读取前 3 条结果的有限正文；
- Chromium Headless 执行；
- 查询、页面和总 Run 超时；
- URL 安全检查；
- OAEP Tool Call、Tool Result、citation evidence；
- Desktop 搜索状态和来源展示；
- 开发环境与生产打包依赖验证；
- Agent Tool Policy 开关；
- 明确的限制性终态。

### 4.2 不包含

- 多 Search Provider；
- Search/Extract 分别配置；
- Search API Key 管理；
- 登录态和持久浏览器 Profile；
- 用户现有 Chrome Session；
- 通用浏览器交互 Tool；
- 图片、视频和新闻垂直搜索；
- 大规模 Crawl；
- Android 本地 Playwright；
- 搜索 Provider UI。

## 5. 核心设计

### 5.1 模型 Tool Schema

P1 注册以下稳定契约：

```json
{
  "name": "web_search",
  "description": "Search the public web for current or verifiable information and return cited results.",
  "parameters": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "description": "A concise search query."
      },
      "max_results": {
        "type": "integer",
        "minimum": 1,
        "maximum": 10,
        "default": 8
      }
    },
    "required": ["query"],
    "additionalProperties": false
  }
}
```

P1 不把 `max_pages`、浏览器类型、Headless、超时等 Host 实现参数暴露给模型。这些属于受控 Runtime 配置。

### 5.2 返回结构

```json
{
  "version": 1,
  "query": "HEPiX 2026",
  "provider": "bing-playwright",
  "retrieved_at": "2026-08-08T00:00:00Z",
  "results": [
    {
      "rank": 1,
      "title": "...",
      "url": "https://...",
      "snippet": "...",
      "content": "受长度限制的正文，可为空",
      "content_sha256": "sha256:..."
    }
  ],
  "partial": false,
  "warnings": []
}
```

必须返回结构化 JSON，不再把多个页面拼接成无边界的大字符串。正文内容应逐结果归属，避免模型无法判断来源。

### 5.3 代码下沉与复用策略

新增建议模块：

```text
cores/python/packages/drsai/src/drsai/backend/runtime/web_search/
  __init__.py
  contracts.py
  bing_playwright.py
  page_markdown.py
  url_safety.py
  tool.py
```

复用原则：

1. 复用 `bing_search.py` 的查询 URL、Headless Chromium、禁止下载、空权限 Context、超时和并行读取思路。
2. 复用 `PlaywrightController.get_page_markdown()` 中与 UI 无关的页面 Markdown 提取算法。
3. 不复制完整 `WebSurfer`、聊天历史、截图推理、Tab 编排、用户代理和 Orchestrator。
4. 抽取代码时保留原始版权/来源说明，并补充针对 Runtime 的测试。
5. 不从核心包反向 import `apps/webui`。

### 5.4 Runtime Tool 装配

需要更新：

- `cores/python/packages/drsai/src/drsai/config/tool_registry.py`
  - 注册 `builtin.web-search` 内置资源；
  - 提供 availability：`available`、`runtime_unavailable`、`network_unavailable`、`disabled`。
- `cores/python/packages/drsai/src/drsai/modules/agents/skills_agent/drsai_assistant.py`
  - 将 `web_search` FunctionTool 加入具体 Agent 的 Workbench；
  - 只在 Agent Policy 启用且 Host 能力通过时装配。
- `cores/python/packages/drsai/src/drsai/backend/runtime/agent_kernel.py`
  - `web_search` 继续映射为 retrieval domain；
  - 移除生产代码中针对单个测试词的硬编码；
  - 保留通用陌生实体、年份、时效词和核实请求策略。
- `cores/python/packages/drsai/src/drsai/backend/runtime/desktop_autogen_ports.py`
  - 确保模型可见 schema 与执行端为同一 Tool；
  - Tool Result 进入标准 Kernel Loop。
- `cores/python/packages/drsai/src/drsai/backend/runtime/desktop_kernel_coordinator.py`
  - 执行、取消、超时、错误分类与 receipt。
- `cores/python/packages/drsai/src/drsai/backend/runtime/oaep.py`
  - 输出 Tool Call、Tool Result 和 citation evidence。

实际实施时应以当前 Tool Registry/Workbench 代码为准，禁止再建一套绕过 Run Snapshot 的平行工具表。

### 5.5 Tool Policy

建议元数据：

```text
tool_id: builtin.web-search
model_name: web_search
domain: retrieval
risk: read_only
approval_mode: none
required_capabilities:
  - host:web_search
  - network:public_https
```

普通公开网页搜索不要求逐次确认。若未来升级到登录态、下载、上传或连接现有浏览器，应转入 `browser_automation` 的更高权限策略。

### 5.6 Playwright 生命周期

P1 使用每个 Tool Call 独立的临时 Browser Context：

```text
launch Chromium
  -> isolated context
  -> accept_downloads=false
  -> permissions=[]
  -> search page
  -> top result pages
  -> close context
  -> close browser
```

约束：

- Tool Call 总超时默认 20 秒；
- 搜索页导航默认 8 秒；
- 单结果页默认 6 秒；
- 最多读取 3 个结果页；
- 单页正文上限 12,000 字符；
- Tool Result 总正文上限 24,000 字符；
- 取消 Run 时必须终止 Page、Context 和 Browser；
- finally 中强制释放资源；
- 不启用持久 Profile；
- 不允许下载、摄像头、麦克风、地理位置和剪贴板权限。

### 5.7 URL 安全

导航前和重定向后都必须检查：

- 仅允许 `http`、`https`；
- 拒绝 localhost、loopback、link-local、私网和保留地址；
- 拒绝云元数据地址；
- 限制重定向次数；
- 拒绝 `file:`、`data:`、`javascript:`、自定义协议；
- 禁止自动下载；
- 记录最终 URL；
- 页面正文作为不可信外部内容进入模型上下文。

### 5.8 Citation Evidence

每条有效结果生成独立 evidence：

```json
{
  "kind": "web",
  "title": "...",
  "url": "https://...",
  "retrieved_at": "...",
  "provider": "bing-playwright",
  "rank": 1,
  "content_sha256": "sha256:..."
}
```

最终回答只能引用 Tool Result 中真实存在的 URL。不得根据模型记忆补造标题、URL 或发布日期。

## 6. Desktop 用户体验

### 6.1 运行状态

OAEP/Renderer 统一展示：

```text
正在搜索网络：HEPiX 2026
正在读取 3 个结果
已找到 8 个结果 · 已读取 3 个来源
```

默认折叠，用户可展开查看查询、来源、耗时和警告；不得遮挡标题栏、头像或主操作。

### 6.2 错误文案

禁止继续使用笼统的：

```text
请连接 Desktop Runtime 或启用相应工具后重试
```

应区分：

- “网络搜索已被当前智能体禁用”；
- “未安装 Playwright Chromium”；
- “无法启动搜索浏览器”；
- “网络连接失败”；
- “搜索请求超时”；
- “未找到可用结果”；
- “目标页面被安全策略阻止”。

限制性结束不得显示为普通“已完成”。建议 OAEP 终态为 `completed_with_limitation`，Desktop 展示“未完成 · 搜索能力不可用”。

## 7. 安装与打包

需要检查和更新：

- Python 包依赖中是否包含兼容版本的 `playwright`；
- 开发后端安装脚本是否安装 Chromium；
- `windows-desktop-dev.cmd` 是否能检测并提示缺少浏览器；
- 独立开发后端 `.drsai-dev` 环境是否使用隔离的 browser cache；
- 生产安装包是否携带浏览器，或首次运行按明确步骤安装；
- `create-backend-source-archive.mjs` 是否包含新核心模块；
- 离线/内网安装如何失败并给出可修复提示；
- 升级时 Playwright 与 Chromium 版本是否一致。

P1 不允许运行时静默执行 `npm install -g` 或修改系统级环境。

## 8. 实施任务

### P1-A：契约与内核

- [x] 定义 `web_search` Schema 和标准结果结构。
- [x] 注册 `builtin.web-search`。
- [x] 接入 Agent Tool Policy、ResolvedToolSet 和 Run Snapshot。
- [x] 修复 retrieval capability 计算与限制性终态。
- [x] 删除 `hepix` 专用生产 fixture 分支。

### P1-B：搜索实现

- [x] 抽取 WebUI 的最小 Playwright/Markdown 逻辑。
- [x] 实现 Bing 结果解析与规范化。
- [x] 实现前 3 个结果页受控读取。
- [x] 实现超时、取消、资源释放和错误分类。
- [x] 实现 URL 安全策略。

### P1-C：证据与 UI

- [x] Tool Result 进入 OAEP。
- [x] 生成 citation evidence。
- [x] Renderer 展示搜索、读取和完成阶段。
- [x] 最终回答来源可点击。
- [x] Run Inspector 展示 query、provider、URL、耗时和错误。

### P1-D：开发与生产交付

- [x] 更新开发环境依赖与检测。
- [x] 更新生产源码归档和打包。
- [x] 验证开发版与生产版数据/浏览器缓存隔离。
- [x] 补充诊断命令和人工调试说明。

## 9. 测试方案

### 9.1 单元测试

- 查询 URL 编码正确；
- Bing 结果 Markdown/DOM fixture 能解析出稳定结果；
- 无效 URL、私网 URL 和危险协议被拒绝；
- max_results、正文长度和总长度限制有效；
- 超时、取消和空结果错误码正确；
- Browser/Context 在成功和异常路径都被关闭；
- citation evidence 与结果 URL 一一对应；
- Shell/Skill 存在但 `web_search` 未注册时，不宣称 retrieval 可用。

### 9.2 Runtime 集成测试

- Agent 启用 `builtin.web-search` 时，模型 Snapshot 与执行 Registry 同时包含 `web_search`；
- Agent 禁用后两者同时不包含；
- 模型选择 `web_search` 后 Tool Loop 能继续生成最终回答；
- Provider 失败进入明确的 Tool Error，不伪造回答；
- Run 取消能在规定时间内停止 Playwright；
- OAEP 回放后搜索状态与来源不丢失。

### 9.3 真实网络验收

至少执行：

1. `HEPiX2026 是什么`；
2. `OpenDrSai 最新版本是什么`；
3. `查找 Playwright CLI 官方文档并给出来源`；
4. 一个中文查询；
5. 一个含空格、符号和非 ASCII 字符的查询；
6. 一个无结果查询；
7. 一个超时/断网查询；
8. 一个指向 localhost 的恶意结果 fixture。

验收要求：

- 有结果任务至少返回 2 个结构化候选来源；
- 最终回答至少引用 1 个实际读取来源；
- 不出现模型虚构 URL；
- 普通查询无需用户确认；
- 资源释放后无遗留 Chromium 进程；
- 错误任务不显示为普通“已完成”。

### 9.4 Desktop E2E

- 自动触发搜索，无需点击“验证模型”或进入设置；
- 状态提示位于运行信息区域，可展开且不遮挡控件；
- 来源链接可打开；
- 切换会话、停止 Run、关闭窗口不会遗留浏览器；
- 开发版和生产版并存时，搜索 Session 与用户数据互不串用。

## 10. P1 完成标准

只有同时满足以下条件，P1 才可标记完成：

- [x] Desktop OpenDrSai Agent 能自然选择并真实执行 `web_search`；
- [x] 搜索不依赖用户手动加载 `playwright-cli` Skill；
- [x] 模型 Tool Snapshot 与执行 Registry 同源；
- [x] 搜索结果结构化并生成 citation evidence；
- [x] 安全、超时、取消和资源释放测试通过；
- [x] 开发版与生产包均通过真实网络验收；
- [x] “HEPiX2026 是什么”不再返回能力不可用；
- [x] 不可用时提供具体原因且不显示普通“已完成”；
- [x] P2 可在不改变 `web_search` 模型契约的情况下替换底层实现。

## 11. 实施结果（2026-08-08）

P1 已按本方案完成，主要实现证据如下：

- 核心实现：`drsai/backend/runtime/web_search/`；
- Agent Tool Resource：`builtin.web-search`；
- 模型 Tool：`web_search`；
- Runtime 接线：`gateway.py`、`run_drsai_agent_factory.py`、`desktop_autogen_ports.py`；
- 通用检索决策：`agent_kernel.py`，已移除事件专用关键词硬编码；
- Desktop 状态和设置入口：`StructuredMessageParts.tsx`、`webSearchPresentation.ts`、`App.tsx`；
- 开发环境就绪探针：`apps/desktop/windows/scripts/dev.ps1`；
- 生产依赖：核心包固定安装 `playwright==1.51`，Windows 优先使用系统 Edge；
- 自动化测试：`test_web_search.py`、`test_desktop_autogen_ports.py`；
- Desktop 专项门禁：`verify-web-search-p1.mjs`、`verify-web-search-presentation.mts`。

验收结果：

- [x] Agent 能看到并执行 `web_search`，模型快照与 Workbench 使用同一 Tool 实例；
- [x] Tool 只按具体智能体策略启用，禁用或运行环境不可用时不进入快照；
- [x] 查询和结果数量边界、结构化结果、正文归属及内容哈希已实现；
- [x] 浏览器使用临时 Context，禁止下载和权限，并启用 Chromium Sandbox；
- [x] URL scheme、凭据、私网地址、DNS 重绑定和重定向后地址均受校验；
- [x] 超时、取消和 Browser/Network/No Results/Policy 错误已分类；
- [x] 结果 URL 接入现有 citation evidence，伪造 URL 会被现有 Kernel 策略拒绝；
- [x] Desktop 展示搜索中、完成、失败和取消状态，设置页可按智能体开关；
- [x] `.drsai-dev` 隔离后端安装 Playwright 并识别系统 Edge；
- [x] 生产源码归档和 wheel 构建通过；
- [x] 真实 Edge/Bing 验收返回结构化结果并读取结果页正文；
- [x] 低相关或受搜索引擎污染的结果会被拒绝，不交给模型生成错误答案；
- [x] 未引入 Search API Key、Provider 配置 UI 或对 `apps/webui` 的生产依赖。
