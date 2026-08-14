# 有据回答（grounded answering）共享后端改动交接

> 状态：代码完成，**桌面端已用真实模型跑通两个验收用例**（结果与遗留见第 9 节）
> 最近更新：2026-08-14
> 分支：`feature/desktop`
> 面向读者：TUI / Android 侧维护者，用于判断是否需要回归测试
> 相关文档：[迁移到共用路径](grounded-answering-migration-to-shared.md)

本文档持续更新。Desktop 与 TUI、Android 共用 `cores/python/packages/drsai`，本文列出这轮改动碰到的共享代码、影响判断和建议的回归范围。

---

## 1. 结论速览

| 提交 | 内容 | 影响 TUI / Android | 是否需要回归 |
| --- | --- | --- | --- |
| `113bf492` | 能力治理文档 | 否 | 否 |
| `8fca1c46` | 桌面附件装载可见性 | 否（纯 Electron/TS） | 否 |
| `7ffdc925` | 知识索引与检索（位置元数据、语料完整性） | **是** | **是** |
| `381d3f0f` | grounded 约束与引用投影（纯函数，当时未接线） | 否 | 否 |
| `f14967eb` | 桌面接线 grounded（触发、提示、工具、引用产出） | 否 | 否 |
| `c05b68df` | 逐句依据校验接入共享运行循环 | **是（仅代码位置）** | **建议冒烟** |
| `2dcee3d1` | 固定语料钉 LF | 否（仅回归资产） | 否 |
| `d1e892c3` | 引用记分修正（分句、来源归属行、引用继承、中文匹配） | **是** | **是** |
| `fbc6e641` | 解开 `{"content": ...}` 包裹后再读证据 | **是** | **是** |
| `e7efd2a1` | 并行知识检索不再因审批批次失败 | **是** | **是** |
| `316f329c` | 桌面引用就地展开原文 | 否（纯 TS） | 否 |

影响你们的共享改动集中在第 5 节。

---

## 2. 共享边界（已核实）

- TUI 走 `drsai.backend.tui_gateway`（stdio JSON-RPC），Desktop 走 `drsai.backend.gateway`（HTTP），**两者不是同一进程**。
- 共用：`config/` 配置层、`backend/runtime/agent_kernel.py`、`backend/runtime/mobile_core/`（共享 Agent 运行循环）、知识与引用契约。
- **Desktop 复用了 TUI 的事件翻译器**：`gateway.py` 将 `tui_gateway.adapter.event_translator.translate` 导入为 `translate_conversation_event`。改动该翻译器会同时影响两端。
- TUI **不使用** `desktop_agent_kernel_adapter.py` / `desktop_kernel_events.py` / `desktop_kernel_coordinator.py`。
- Android 通过 Chaquopy 直接加载同一份 Python 源码，`mobile_core` 下的模块必须支持独立源码集导入（见第 5 节）。

---

## 3. `7ffdc925` — 知识索引与检索

### 3.1 已有索引失效（最需要注意）

索引 schema 升到 v2。**升级前建好的本地知识库索引会被判为 `stale_index`，必须重建后才能检索。**

- `search_local_knowledge()` 抛 `ConfigError("Knowledge Base index is outdated; re-index the Knowledge Base")`
- `knowledge_status()` 返回 `status: "stale_index"`

不做兼容降级是有意的：旧索引没有位置信息，继续服务会让所有引用静默退化到文件级。

### 3.2 `knowledge_search` 返回结构扩展

新增顶层字段：`status`、`completed`、`corpus_complete`、`supporting_match`、`supporting_matches[]`、`documents[]`、`document_count`、`scope_truncated`、`documents_truncated`、`errors[]`。

`evidence[]` 每行新增：`locator`、`locator_label`、`document_path`、`document_sha256`、`knowledge_base_revision`、`supporting_match`、`relation`。

全部为新增，旧读取方不会崩。三处语义变化：

1. **检索源失败时 `corpus_complete` 置 false** —— 避免在没读过的材料上断言"不存在"。
2. **无支撑时返回 `searched_scope` 行** —— 这些行 `content` 为空、`score` 为 0，用于说明"查了哪些文档"。按 `content` 非空过滤会把它们丢掉，拒答就失去引用。
3. **清单有上限** —— `searched_scope` 最多 20 条、`documents[]` 最多 50 条；截断时对应标志置 true，而 `document_count` 始终是真实总数。

### 3.3 解析行为变化

不支持的格式此前静默返回空串并被跳过；现在返回明确状态（`unsupported_format` / `parser_unavailable` / `no_text_layer` / `truncated` / `failed`）并计入不可读文档，从而拉低 `corpus_complete`。

`truncated` 指单文件超过 20 万解析单元。**超出部分不入库，已读部分仍可检索**，只是完整性被否定。

副作用：含扫描件 PDF 或超大文件的知识库，`corpus_complete` 会从"看起来正常"变为 false。此前那份"完整"是假的。

### 3.4 新增依赖

`python-docx>=1.1,<2`、`openpyxl>=3.1,<4`（`python-pptx` 此前已声明）。**TUI 环境需重装依赖。** 连带引入 `lxml`（含二进制扩展）、`Pillow`、`XlsxWriter`，独立打包链路体积会增加。

---

## 4. `f14967eb` — 桌面接线（不影响其他端）

只在桌面独有文件与共享配置结构上落地：

- `AgentRunConfig` 新增字段 `grounded: bool = False`，追加在末尾，**不进 schema 版本**
- 新增常量 `GROUNDED_PROMPT`、函数 `grounded_prompt_layer()`、公开函数 `tool_decision_domain()`（既有私有函数的薄封装）
- 触发判定、工具过滤、引用产出均在 `desktop_agent_kernel_adapter.py` / `desktop_kernel_events.py`

未设该字段的端产生**逐字节相同**的提示词，由 `test_agent_kernel_production_parity`、`test_p9_production_behavior_parity` 保证。

---

## 5. 改到共享运行循环与内核的提交

这一节汇总所有改到 `mobile_core/engine.py`、`agent_kernel.py`、`grounded.py` 的提交，是你们需要重点看的部分。

### 5.1 `c05b68df` — 逐句依据校验

#### 改了什么

在既有的引用校验环节追加一步：grounded 开启时逐句核对"这句话的 `[E<n>]` 证据块是否真的陈述了这句话"，不通过则**复用已有的引用重试通道**把答案退回模型重写；重试后仍不通过才降级为带告警完成。

#### 为什么不影响其他端

新逻辑整体圈在 `if state.grounded:` 内，该字段来自 Agent 配置，TUI 与 Android 不设置，恒为 false，走原分支。

已核实**不触发摘要不一致**：`kernel_sha256` 计算的是 `kernel_contract` 结构体（kernel_id、版本、提示词摘要、能力集），不是源码文件内容。本次未改这几项。

#### 仍建议冒烟的理由

改动落在所有端每轮都会执行的那段代码上。逻辑上走 else 分支，但状态机、检查点、重试计数都在同一函数内，建议跑一轮基本对话确认无异常。

### 5.2 `d1e892c3` — 引用记分修正（仅 grounded 路径）

`grounded.py` 的 `build_claim_support` 改了四处：分句不再切进引号内、来源归属行识别为引用装置而非结论、连续陈述继承上一句的引用标记、中文匹配从整段词改为字符二元组，并把段落重合度检查有意放宽（数字核对仍是承重的那一层）。

**只在 grounded 开启时调用**，其他端不受影响。列在这里是因为 `grounded.py` 同时被加进了 `_RUNTIME_EVIDENCE_SOURCE_FILES`：**改动该文件会改变 `runtime_source_digest`**，若你们有比对该摘要的流程需要同步。

### 5.3 `fbc6e641` — 解开 `{"content": ...}` 包裹

`_grounded_evidence_rows`（engine.py）与 `build_citation_evidence`（agent_kernel.py）此前只认两种形态：`knowledge_search` 结果直接是对象，或是一层 JSON 字符串。宿主把结果再包一层 `{"content": "<json>"}` 时读不到 `evidence`，于是**引用要求被静默取消**，正确答案的引用全被当成编造。

现在两处都做最多三层的解包，只在外层没有 `evidence` 且有 `content` 时下钻。

**这条对你们是行为变化**：如果 TUI 的工具结果也是包裹形态，此前不生效的引用校验现在会生效；如果不是，逻辑等价。**建议确认一次 TUI 侧 `knowledge_search` 工具结果的实际形态。**

### 5.4 `e7efd2a1` — 审批批次与只读名单

三处，都在共享路径上：

1. **`knowledge_search` 加入 `_DESKTOP_READ_ONLY_TOOLS`** —— 此前落到未知工具默认值，被判为有外部副作用、需要审批。名单变量名带 Desktop 前缀但位于共享的 `drsai_assistant.py`，**其他端走同一个 Assistant 时会一并生效**：该工具从"需审批"变为"免审批"。这是有意的，它只读本地索引。
2. **内核路径接受同构审批批次**（`allow_homogeneous_approval_batch=True`）—— 同一个工具的两次调用只承载一个审批决定。Assistant 路径本就允许，内核路径此前更严，导致同样的模型行为在这里失败。**这条放宽了共享内核的校验，是本轮对你们最需要留意的一处。**
3. **批次组织错误可恢复重试** —— 仅 `approval_tool_must_be_single` 一种错误，且只重试一次，此时尚未执行任何工具。重复 call id、未注册工具仍然直接失败。错误信息现在带上模型请求的工具名。

### Android 注意

`mobile_core` 下的模块必须能在 Chaquopy 独立源码集下加载，**不能使用跨包相对导入**。本次通过 `mobile_core/context.py` 既有的双路导入（`try: from drsai...` / `except ImportError: from ...`）引入新函数。该约束由 `test_agent_kernel_production_parity` 守护。

---

## 6. 建议的回归范围

**TUI**

1. 已有知识库检索：预期报索引过期 → 重建 → 恢复正常
2. 新建知识库并检索，确认返回结构可解析
3. 检索无命中时的表现（`searched_scope` 行不被误过滤）
4. 含无法解析文件的知识库，确认 `corpus_complete` 为 false 且提示可读
5. 依赖重装后正常启动
6. 一轮普通对话冒烟（对应第 5.1 节）
7. 一轮会并行发起两次工具调用的对话，确认审批批次放宽后行为符合预期（对应第 5.4 节）
8. 确认 TUI 侧 `knowledge_search` 工具结果的实际形态，判断解包是否改变了引用校验是否生效（对应第 5.3 节）
9. 确认 `knowledge_search` 由需审批改为免审批符合 TUI 的审批预期（对应第 5.4 节第 1 条）

**Android**

1. 一轮普通对话冒烟
2. 确认 Python 运行时绑定正常（`agent_kernel_id` / 版本校验）

---

## 7. 待对齐的设计交互

远程近期把 `build_citation_evidence` 推到 `p9-citation-policy-v3`，**新增 `memory_sources`**——让记忆来源的结论也需要挂引用。

而本轮的 grounded 模式**把 memory 域工具整个收走**，即让记忆"不可用作证据"。理由是对话历史可能含模型自己上一轮的输出，一次编造会变成下一轮的"出处"。

两者不冲突（grounded 是更严格的模式），但接线后可能出现"grounded 下 memory 被排除、引用校验却仍按 v3 期待 memory 引用"的错配。建议与 v3 作者确认预期。

---

## 8. 已知既有问题（非本轮引入）

以下问题在本轮改动前即存在，列出以免混淆归因。**前两条 TUI 在 Windows 上同样会撞到。**

### 8.1 回归 harness 在干净检出上完全跑不起来

`eval/regression/assets/runs/inspect_compare_v1/fixture.json` 从未提交。用例加载器在**加载阶段**就校验所有资产的存在性与摘要（`case_loader.py:143`），因此这一个缺失文件会让 `validate` 和**任何** `run --case` 直接失败——不是某一个用例失败，是一个用例都跑不了。

临时绕过：把 `eval/regression/cases/run_inspection/inspect_compare.yaml` 挪开再跑，用完还原。

### 8.2 固定语料在 Windows 上摘要不匹配（已修）

`eval/regression/assets/knowledge_bases/opendrsai_runtime_overview_v1.md` 的 sha256 按 LF 记录，而 git 在 Windows 检出时转成 CRLF，字节改变导致摘要对不上，`validate` 报 `Asset digest mismatch`。

已在 `.gitattributes` 补一行（沿用仓库既有的窄规则写法）：

```
eval/regression/assets/knowledge_bases/*.md text eol=lf
```

**已有本地检出需要重新拉取该文件**才会生效（删除后 `git checkout --` 即可）。

### 8.3 能力探测在 OIDC 模式下必然认证失败

能力探测接口 `POST /v1/config/model-providers/{name}/capability-probes`（`gateway.py:11989`）**未调用 `get_platform_auth()`**，只发 gateway 实例令牌，而模型目录发现（`:11773`）与实际运行（`:2633`）都调了。hepai 配置为 `requires_api_key = false`，凭据只能来自 OIDC 会话，因此探测等于带空凭据调上游，返回 401 `authentication_failed`。

影响不止测试：能力探测同时是界面判断模型可用性的依据，**在 OIDC 模式下该探测无法成功**，可能就是"界面显示无可用模型"的直接原因。它同时是自动化回归 run 的前置条件，因此回归目前只能手动验。**本轮未修。**

### 8.4 其他

- `test_oaep_codegen` 失败：已提交的生成类型（Python / TypeScript / Kotlin）与已提交的 schema 不一致
- `test_android_p9_acceptance_ledger` 失败：断言的 evidence 文件被 `.gitignore` 排除
- `test_codex_security` 若干并发用例不稳定，同一份代码不同跑法失败项不同
- `test_tool_verification_policy` 中一处断言与实现改名不同步（`required_tool_satisfied` vs `required_tool_selected`）

---

## 9. 端到端验证结果

代码级测试全部通过（154 项）。此前挡住验证的 403 `untrusted_worker`（平台拒绝把模型调用委托给源码启动的本地 runtime）**平台侧已放行**，两个验收用例已在桌面端用真实模型跑过（hepai / deepseek-v4-flash）。

验证前提：Gateway 起在 28642，且每次改完 Python 重启后都比对 `/v1/runtime` 的 `runtime_source_digest` 与本地 `_RUNTIME_EVIDENCE_SOURCE_DIGEST`，确认跑的是仓库源码而非旧字节码——这一步在验证过程中两次挡下了误判，建议你们照做。

**拒答用例（材料不足时不编）——完全通过。** 模型明确说明材料中没有相关内容、带引用、全文无任何编造的数字、不做推测。

**引用用例（逐句挂引用）——基本通过。** 强制检索生效，结论逐句挂 `[E1]`，内容正确，编造的引用能被逐句校验拦下。

遗留一处，属检索侧而非校验侧：固定语料整份被切成 1 个块（`chunk_count: 1`），因为 `index_local_files` 按锚点（页 / 幻灯片 / 标题段）切，而该文档只有一个标题。结果只有 `[E1]` 可用，模型为四个结论各配引用时编出了 `[E2][E3][E4]`，被判为 fabricated——校验的行为是对的，问题在切块粒度不足以支撑句级引用。修法是在锚点之外再按段落 / 句群细分，注意 `_pack_units` 里 `chunk_size` / `chunk_overlap` 与锚点边界的关系。

自动化回归仍跑不了，原因见第 8.1 与 8.3 节，均非本轮引入。
