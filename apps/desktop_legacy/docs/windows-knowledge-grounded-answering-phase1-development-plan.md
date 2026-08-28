# OpenDrSai Windows 桌面端知识依据回答（knowledge.grounded / knowledge.absent）第一阶段开发方案

> 状态：待开工（调查完成，边界已确认）
> 制定日期：2026-08-12
> 阶段：桌面端 Agent 能力验收第一阶段
> 核心范围：`knowledge.grounded`（清单第 5 条）与 `knowledge.absent`（清单第 6 条）两项能力验收
> 交付目标：Windows 桌面端（`apps/desktop/windows` + `apps/desktop/shared` + 随桌面启动的本地 drsai gateway）
> 明确排除：embedding、向量库、混合检索、重排、增量索引、文件监听、云盘/云文件接入、OCR

关联基线：

- `eval/regression/cases/knowledge/grounded_runtime_knowledge.yaml`（验收定义，revision 2）
- `eval/regression/cases/knowledge/absent_gateway_port.yaml`（验收定义，revision 2）
- `eval/regression/assets/knowledge_bases/opendrsai_runtime_overview_v1.md`（固定语料）
- `eval/regression/README.md`（Runner 使用方式）
- `docs/desktop/opendrsai-windows-full-agent-runtime-phase3-product-completion-plan.md`

---

## 1. 任务定位与边界

### 1.1 这个功能是什么

第 5、6 条不是两个独立功能，也不是一个"文件知识库"产品模块。看清单自身的措辞——第 5 条"验证知识检索、依据约束和知识引用"，第 6 条"验证资料不足时明确说明并拒绝猜测"——与兄弟项（第 10 条"验证代码读取、失败测试、根因诊断以及工作区不被修改"）结构一致：**每一条都是"某项能力 + 若干行为约束"**。

因此本方案的定位是：

> 给定一份边界闭合、版本固定的语料，Agent 必须先检索再回答；只使用检索到的内容，每条结论可追溯到原文位置；检索不到就明确说明没有，并且不做推测。

主要工作量在**回答行为契约**，不在文件解析。

### 1.2 语料的来源形态（关键澄清）

验收中的"固定 Runtime 知识库"**既不是用户在会话中上传的文件，也不是通过 `/v1/config/knowledge-bases` 注册的持久知识库**。

`eval/regression/src/opendrsai_regression/environment.py:108` `_prepare_knowledge` 的行为：

1. 将 `opendrsai_runtime_overview_v1.md` 复制到 `<workspace>/.opendrsai/regression/knowledge/<kb_id>/`
2. 校验 sha256，不匹配直接抛 `EnvironmentError`
3. 下发控制块：`{knowledge_base_id, knowledge_base_revision, document_path, sha256, corpus_complete, content_base64}`

即：会话开始前已就位、内容已知、版本固定、并被显式声明为"这就是全部语料"的一份材料。

### 1.3 三层拆解

| 层 | 内容 | 受控/评测路径 | Windows 生产路径 |
| --- | --- | --- | --- |
| ① 语料 | 材料 + 版本 + 完整性声明 | 已通 | 缺失 |
| ② 检索 | 必须经 `knowledge_search`，1–3 次 | 已通 | 工具存在，输出字段不达标 |
| ③ 回答契约 | grounded + 可交互引用 / 三态 + 拒答 | 缺失 | 缺失 |

③ 是本阶段的主要交付物。

### 1.4 明确排除

- 用户会话内上传文件构建知识库（产品形态，本阶段两条验收不涉及）
- embedding / 向量库 / 混合检索 / 重排 / 分块索引优化 / 增量更新 / 文件监听
- 云盘、云文件接入（清单作者已明确为第二阶段）
- 扫描件 OCR（解析失败按"无文本层"处理，计入完整性判定）

---

## 2. 代码实现现状审计

### 2.1 可直接复用

| 能力 | 位置 | 说明 |
| --- | --- | --- |
| 受控语料通道 | `cores/python/packages/drsai/src/drsai/backend/runtime/desktop_agent_kernel_adapter.py:449` `_controlled_knowledge_result` | 校验 sha256、整份文档作为单个 evidence 返回、计算 `supporting_match`、给出 `relation` 与 `corpus_complete`。其注释明确写明"This is not a production retriever" |
| 虚拟 `knowledge_search` 注册与派发 | 同文件 `:809`、`:1059` | 仅在 `_REGRESSION_CONTROL` 存在且 `network == "disabled"` 时生效 |
| 生产侧知识库工具 | `cores/python/packages/drsai/src/drsai/backend/gateway.py:866` `_build_agent_knowledge_tool` | 按 `AgentKnowledgePolicy`（mode / retrieval_policy / top_k / score_threshold / require_citations）构建 |
| 知识库注册表 | `cores/python/packages/drsai/src/drsai/config/knowledge_registry.py` | local-files / ragflow 两类，sqlite 索引，配置校验与原子写 |
| PDF 页级解析 | `apps/desktop/shared/main/presentationPdf.ts` → `python -m drsai.content.pdf.presentation` | 输出带 `page`、版式、agenda / 数字亮点均携带页码 |
| 引用渲染链路 | `apps/desktop/shared/api/structuredConversation.ts:55` `CitationPart`；`apps/desktop/shared/renderer/src/components/StructuredMessageParts.tsx:162` | 内联 `[n]` 按钮、`focusPart` 双向定位、`onOpenCitation` 回调均已就位 |
| 引用后置校验骨架 | `cores/python/packages/drsai/src/drsai/backend/runtime/agent_kernel.py:702` `build_citation_evidence` | `CITATION_POLICY_VERSION = "p9-citation-policy-v2"`，已含 knowledge 分支，全部 sha256 化不落原文 |
| 工具域分类 | 同文件 `:104` `_tool_decision_domain` | 已将 `knowledge_search` 归入 `retrieval` 域、memory 系列归入 `memory` 域 |
| 来源集合 UI | `apps/desktop/shared/renderer/src/components/files/ContextBasket.tsx` | 可增删排序、估算 token |
| 桌面知识库 API | `apps/desktop/shared/api/desktopApi.ts:5368` 起 | list / create / index / search / preview 全套已定义 |

### 2.2 需要改造

| 项 | 位置 | 问题 |
| --- | --- | --- |
| 切块丢失位置信息 | `knowledge_registry.py` `_chunks()` | `re.sub(r"\s+", " ")` 压平全文后定长切分，页码/行号/标题层级 100% 丢失 |
| 文本抽取格式覆盖不足 | `knowledge_registry.py` `_extract_text()` | 仅 pypdf / python-docx；PDF 无页码，无 pptx / xlsx |
| 生产工具输出字段不足 | `gateway.py:866` | 仅返回 `{query, require_citations, evidence[]}`，缺 `knowledge_base_revision / document_path / corpus_complete / status / completed / supporting_match / relation / documents[]` |
| Office 位置元数据缺失 | `apps/desktop/shared/main/workspaceContext.ts` `extractOfficeText` | 手写 ZIP + XML 剥标签，标题层级 / 幻灯片号 / sheet 名全丢 |
| OAEP citations 无结构 | `cores/protocol/oaep/oaep.schema.json:168` | `{"type":"array","items":{"type":"object"}}`；`apps/desktop/shared/api/oaep.generated.ts:14` 为 `Record<string, unknown>[]` |

### 2.3 全新

- grounded 模式的显式触发识别与系统提示约束
- 引用生成契约（每条事实性结论挂编号）
- `CitationPart` 的生产者（目前 `apps/desktop/shared/main/oaepDigest.ts:32` 仅把 citations 补成 `[]`，无任何投影器）
- 语句级 claim support 校验（现有实现是 `source in final_content`，文件级、整答案级）
- 三态输出（可答 / 部分可答 / 不可答）与拒答结构
- 装载覆盖率 `load_coverage` 记录

### 2.4 必须先堵的两个洞

**洞一：本地旁路拦截 Agent。**

`apps/desktop/shared/renderer/src/adapters/useDesktopChatAdapter.ts:466`：只要存在 file 附件且命中 `isNaturalMaterialQueryIntent`（该正则第一条为 `/[?？]/`，**任何含问号的句子都命中**），即走 `desktopApi.queryMaterials`，完全不经过 Agent。

`workspaceContext.ts:513` `queryMaterials` 是确定性关键词打分器，答案为直接摘抄最高分片段，来源渲染成 markdown `### 来源` 列表。

后果：第 5 条因无 `knowledge_search` 调用、无 `CitationPart` 而失败；第 6 条**假通过**——它确实会输出"没有在已导入材料中找到…我不会编造来源或位置"，措辞合规、未编造，但拒答原因是关键词未命中，而非证据不足判定。

**洞二：静默截断。**

`apps/desktop/shared/main/chat.ts:2127` 的 `content.slice(0, remainingChars)`。上限为 5 文件 / 64KB 每文件 / 80k 字符总量；超出部分记 `reason: "truncated"`，但 `withAttachmentContext`（`:2167`）拼装提示时未将该 reason 传递给模型。模型看到的是一份表面完整、实则被截断的材料——这是第 6 条假通过的第二个来源。

---

## 3. 关键决策记录

| 编号 | 决策 | 取值 | 依据 |
| --- | --- | --- | --- |
| D1 | 语料入口形态 | **复用持久知识库注册表**：受控控制块 → 注册临时 kb → 索引 → `knowledge_search` 走生产路径 | 让评测与产品共用一条链路；`_controlled_knowledge_result` 由"伪造工具结果"退化为"语料来源" |
| D2 | grounded 生效方式 | **用户显式要求时生效** | 默认行为不变，对现有桌面用户零回归风险 |
| D3 | `corpus_complete` 来源 | 由索引结果推导：全部文件解析成功且全部单元入库才为 true | 非人工声明，前端只做展示 |
| D4 | `locator` 结构 | `{kind, page \| line_start/line_end \| heading_path \| slide \| sheet}` | PDF 到页、文本/代码到行、md 到标题路径、docx 到标题层级、pptx 到幻灯片号、xlsx 到 sheet 级 |
| D5 | grounded 下 memory 域 | `search_memory` / `retrieve_from_memory` 召回不进证据集合，仅作对话背景，并在 run journal 记录 | 防止模型从对话历史（含自身上轮输出）取证 |
| D6 | `queryMaterials` 处置 | 仅摘除 `useDesktopChatAdapter.ts:466` 的意图拦截，**保留 API 本身** | 该 API 疑似服务于 `skill.presentation` 链路，不应一并删除 |
| D7 | 超预算策略 | 明确告知部分装载 + 记录 `load_coverage`，本阶段不做拒绝加载 | 禁止静默截断是硬要求，拒绝加载可后置 |
| D8 | 触发识别实现 | 复用 `agent_kernel.py` 现有关键词表与 `_tool_decision_domain`，不新写正则 | `isNaturalMaterialQueryIntent` 已证明自建正则的失败模式 |

### 3.1 D2 的一个直接后果

两个 case 的输入均为**纯文本**，无任何 flag，触发语写在 prompt 内（"请仅根据知识库回答，并提供引用"）。

因此 grounded **必须支持自然语言触发**，不能只做成桌面 UI 开关。UI 开关可以做（更可控），但文本触发是验收硬需求，两者都要。

风险：意图识别漏判会导致 grounded 未生效，失败现象为"回答质量正常但无引用"，不易一眼归因到触发环节。需在 run journal 中显式记录 grounded 是否激活及其触发依据。

---

## 4. 分层设计

取证获取收敛为单一函数，作为第一/第二阶段的唯一接缝：

```
retrieve_evidence(query, corpus, budget) -> EvidenceBlock[]
```

第一阶段实现为"返回全部单元，score 恒为 1.0"；第二阶段替换为混合检索 + 重排，签名不变。该函数以上的所有内容（取证约束、引用生成、引用校验、充分性判定、拒答话术）在第二阶段一行不改。

### L0 解析与位置元数据

统一产出：

```
parse_document(path) -> { unit_id, text, locator, order, parse_status }[]
```

- PDF：复用 `drsai.content.pdf.presentation`，已有页码
- md / txt / 代码：行号 + markdown 标题路径
- docx / pptx / xlsx：新增 Python 侧解析（python-docx 标题层级、python-pptx 幻灯片号、openpyxl sheet + 单元格区间）
- 桌面 TS 侧 `extractOfficeText` 保留用于预览，**不再用于取证**
- 无文本层（扫描件）返回 `parse_status: no_text_layer`，进入完整性判定，**不静默入库空内容**

### L1 语料注册与完整性

- 复用 `knowledge_registry.py` 的资源形态（`type: local-files`）
- `index_local_files` 改为按结构切块并持久化 `locator`
- `corpus_complete` 由索引结果推导（D3）
- 受控控制块作为一种语料来源：`_controlled_knowledge_result` 改为注册临时 kb 而非直接返回伪造结果

### L2 检索契约

`_build_agent_knowledge_tool` 输出对齐 `_controlled_knowledge_result` 的结构：

```json
{
  "query": "...", "require_citations": true,
  "status": "completed", "completed": true,
  "corpus_complete": true, "supporting_match": false,
  "supporting_matches": [],
  "evidence": [{ "knowledge_id", "knowledge_base_revision", "document_id",
                 "document_path", "title", "source", "chunk_id", "locator",
                 "score", "content", "content_sha256",
                 "supporting_match", "relation" }],
  "documents": [{ "knowledge_base_id", "knowledge_base_revision",
                  "document_path", "sha256", "source", "corpus_complete" }]
}
```

`relation` 取 `supports_claim` 或 `searched_scope`，直接服务于 `absent` case 的 `required_sources`。

### L3 grounded 触发与工具纪律

- 显式触发识别（D2 / D8），激活后写入 run journal
- grounded 下系统提示层禁止使用模型自身知识
- grounded 下从 workbench 摘除 `web_search`（对应 `web_search_calls: max 0`）
- grounded 下 memory 域召回不进证据集合（D5）
- `retrieval_policy` 在 grounded 下强制为 `always`

### L4 装配与预算

- 编号块注入，块头标注来源与位置：`[E3] source=opendrsai_runtime_overview_v1.md loc=第4页`
- token 预算核算
- 超预算不静默截断（D7）：明确告知哪些文件仅部分装载
- 每次运行记录 `load_coverage = 已装载单元 / 总单元`，写入 run journal（复用 `apps/desktop/shared/main/agentRunJournal.ts`）

### L5 引用生成与校验

- 输出契约：每条事实性结论后挂 `[E{n}]`，而非整段末尾挂一个
- OAEP `citations` schema 收紧为结构化定义：`citation_id / source_id / locator / excerpt_sha256 / claim_span`，同步 `oaep.generated.ts`
- 新增投影器将其转为 `CitationPart`（渲染端已就绪）
- `build_citation_evidence` 扩展语句级 claim support 校验，对应 `require_claim_support: true`
- 编造引用判定为硬失败，现有 `citation_evidence_incomplete` 警告通道升级为 error

### L6 三态与拒答

- `answerable` / `partial` / `unanswerable`
- 判定建立在**能否举证**上：要求模型先产出 support 片段并引至具体 `unit_id`，拿不出则判 `unanswerable`
- `partial` 必须将有资料与无资料部分分开陈述
- 拒答结构：说明检索了哪些来源（列出 source 与 `corpus_complete`）→ 明确缺什么 → 不做推测 → 补救建议
- **话术约束**：`absent` case 含 `forbidden_patterns: '\b(?:[1-9][0-9]{2,4})\b'`，拒答文本中不得出现任何 3–5 位数字
- 与覆盖率联动：`load_coverage < 1` 时的拒答标记 `low_confidence_refusal`，评测时单独复核

### L7 桌面呈现

- `CitationPart` 渲染复用现有实现
- `onOpenCitation` 接 FilePreviewer 定位：文本 / 代码可 `scrollIntoView` 到行
- PDF 页内定位受限：`apps/desktop/shared/renderer/src/components/files/file_previewer/PdfPreviewer.tsx:18` 明确禁用内联渲染（"Inline PDF rendering is disabled here to keep the desktop shell stable"）。本阶段验收语料为单个 md，不阻塞；产品化方案见第 7 节
- 摘除 `queryMaterials` 意图拦截（D6）

---

## 5. 实施阶段

| 里程碑 | 内容 | 交付物 |
| --- | --- | --- |
| M1 堵洞与基线 | 摘除 `queryMaterials` 意图拦截；堵 `chat.ts:2127` 静默截断；跑通两个 case 取得真实失败基线 | 基线报告（JSONL） |
| M2 语料与检索 | L0 解析位置元数据；L1 索引改造与 `corpus_complete`；L2 输出对齐；受控通道合流 | `knowledge_queries` / `retrieved_documents` / `require_corpus_complete` 断言转绿 |
| M3 取证约束与引用 | L3 触发与工具纪律；L5 引用生成、OAEP schema、`CitationPart` 投影、claim support 校验 | `knowledge.grounded` 转绿 |
| M4 拒答 | L6 三态、拒答话术、覆盖率联动 | `knowledge.absent` 转绿 |
| M5 可测性收尾 | 确定性配置、run journal 记录完善、补边界用例 | 两个 case 稳定通过，边界用例入库 |

UI 相关工作（知识库管理入口、引用跳转体验）安排在 M3–M5 之后。

### 5.1 验证方式

本地 Python 环境位于 `venv/Scripts/python.exe`。

> 注：`eval/regression/README.md` 中写的是 `.\.venv\Scripts\python.exe`，仓库中不存在该路径，README 需一并订正。

```powershell
.\venv\Scripts\python.exe eval\regression\run_regression.py validate
$env:OPENDRSAI_REGRESSION_GATEWAY_URL = "http://127.0.0.1:8000"
$env:OPENDRSAI_REGRESSION_GATEWAY_TOKEN = "<local-instance-token>"
.\venv\Scripts\python.exe eval\regression\run_regression.py run --case knowledge.grounded
.\venv\Scripts\python.exe eval\regression\run_regression.py run --case knowledge.absent
```

`--adapter fixture` 只验证 Runner 与断言链路，结果标记 `adapter=fixture` 且会被 P1 发布门禁拒绝，不能作为验收证据。

---

## 6. 验收口径

两个 case 的断言逐条映射到实现层：

| 断言 | 来源 case | 实现层 |
| --- | --- | --- |
| `required_capabilities: [knowledge_search]` | 两者 | L2 |
| `knowledge_queries: {min:1, max:3}` | 两者 | L3 工具纪律 |
| `retrieved_documents.required`（kb_id / revision / document_path / sha256） | grounded | L2 |
| `web_search_calls: max 0` | 两者 | L3 |
| `workspace_search_calls: max 0` | absent | L3 |
| `unrelated_tool_calls / skill_activations / approvals / external_writes: max 0` | 两者 | L3 |
| `require_completed` / `require_corpus_complete` / `require_no_supporting_match` | absent | L1 + L2 |
| `output.semantic_requirements` / `forbidden_claims` | grounded | L3 + L5 |
| `output.required_patterns` / `forbidden_patterns` | absent | L6 话术模板 |
| `citations: {min:1, presentation: interactive}` | 两者 | L5 + L7 |
| `required_sources`（grounded：文档；absent：`relation: searched_scope` + `corpus_complete`） | 两者 | L2 + L5 |
| `require_claim_support: true` | grounded | L5 语句级校验 |
| `oaep.require_citation_parts` / `stable_citation_id` / `markdown_relation` / `openable_target` / `bidirectional_navigation` | 两者 | L5 schema + L7 渲染 |
| `artifacts: max 0` | 两者 | L3 |
| `execution: timeout 60s, attempts 1, isolation required` | 两者 | 运行配置 |

---

## 7. 风险与待确认

### 7.1 待确认

| 编号 | 问题 | 影响 | 现状 |
| --- | --- | --- | --- |
| Q3 | 引用跳转在产品中做到什么粒度（是否引入 pdfjs-dist 恢复 PDF 内联渲染） | 影响 L7 产品化范围，不影响本阶段验收 | 未定，不阻塞 |
| Q5-a | grounded 下 memory 域工具是否应判为越权 | 两个 case 均未对 memory 域设限，属验收缺口 | 已按 D5 保守处理，建议与清单作者确认 |
| Q2-a | 产品场景下解析失败文件是否破坏 `corpus_complete` | 影响拒答可信度口径 | 已按 D3 处理（破坏），待产品侧确认 |

### 7.2 风险

- **触发漏判**：grounded 未激活时失败现象与正常回答相似，需靠 run journal 归因（见 3.1）
- **拒答话术数字约束**：`forbidden_patterns` 禁止 3–5 位数字，模板需专门规避
- **阈值过紧导致全面拒答**：需同时观测"该拒答时的拒答率"与"不该拒答时的误拒率"，两个指标成对看
- **受控通道合流的回归风险**：`_controlled_knowledge_result` 当前为评测唯一依赖，改造期间需保证既有受控路径不中断
