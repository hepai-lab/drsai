# Deck Workflow

**这份文档的定位。** 本文定义 deck 级工作的主流程、workspace 结构、`brief.md` / `deck_narrative.md` 模板、以及从总叙事文档派生 `slide_specs.yaml` 的默认方式。它是新 skill 最重要的执行文档之一。

## 目录

- 主链路
- Workspace
- `brief.md` 最小模板
- `deck_narrative.md` 最小模板
- 派生 `slide_specs.yaml`
- 字段约定
- 验证模式
- 交付底线

## 什么时候先读它

**只要任务是做一整套 deck，就先读这份文档。** 它回答的问题是“这套材料怎么组织、怎么落 workspace、怎么验证”，比具体页面长相更优先。

## 主链路

**默认主链路固定为：** `brief -> style/domain profile lock -> template audit(if pptx) -> narrative -> derive slide_specs -> assets -> build -> package_preflight -> structure_precheck -> module_validation -> preview -> render_review -> visual_review -> first_draft_checkpoint -> detailed_revision(optional) -> final`。

```mermaid
flowchart LR
  A[brief.md] --> P[Style / Domain Profile Lock]
  A --> T[Template Audit]
  T --> P
  P --> B[deck_narrative.md]
  B --> C[Derived slide_specs.yaml]
  C --> D[Assets]
  D --> E[Editable PPT Build]
  E --> F[Package Preflight]
  F --> G[Structure Precheck]
  G --> H[Module Validation]
  H --> I[Preview Export]
  I --> J[Render Review]
  J --> V[Visual Review / Contact Sheet]
  V --> K[First Draft Checkpoint]
  K --> L[Final Delivery]
  K --> M[Detailed Revision Optional]
  M --> E
```

**先锁两份主文档，再 build。** 没有 `brief.md` 和 `deck_narrative.md` 时，不应直接开始生成 PPT。否则全局约束、页面意图与文案想法都会漂。

**有参考 `pptx` 时，模板取证是前置动作。** 先判断页族、母版、layout 和字号系统，再写 narrative。否则很容易把“模板继承”做成“风格模仿”。

**无模板但有风格参考时，先锁 profile。** 如果用户没有给参考 `pptx`，但明确要求正式研报、仿券商研报、产品发布会、学术答辩或某类行业范式，应在 `brief.md` 中先固化 `typography_profile`、`domain_profile`、允许借鉴的视觉范式、禁止使用的品牌元素、免责声明和风险边界，再写 narrative。

**`slide_specs.yaml` 默认应派生，不应双写。** 机器执行仍然需要结构化字段，但默认应从 `deck_narrative.md` 生成，而不是要求人类长期维护第三份并行文档。

**在 narrative 阶段就要把增强资产选项告诉人类。** agent 应明确说明当前可用的 `icon system`、原生 `Office chart`、`Python figure`、diagram 与原生表格等路线，让人类按需指定更偏编辑性、更偏研究表达、还是更偏视觉节奏的方向。

**先 build 后 gate，再做模块验证。** 先确认文件包一致性和结构层排版没有明显失控，再去看 connector、chart 和模板细节。

**preview 之后还要补一次成图级 gate。** `render_review` 专门处理结构层看不到的边界触墨和扁平化图像风险，不要把逐页 preview 本身误当成结构化检查。

**final 前必须做 visual review。** `render_review` 通过只说明成图层没有触发自动阻断；它不证明页面已经像目标文体、版心已经稳定、表格语义对齐已经自然。final 前必须看逐页 preview 或 contact sheet，并按 `fatal -> warning -> preference` 记录人工 visual review 结论。

**初稿完成后要显式停一次。** 当 editable `pptx`、预览图、基础 validation 和 visual review 结论齐全时，应把它定义为“可审阅初稿”，并主动问人类是否要进入更细的详细修订。详细修订通常涉及逐页微调、图表路线切换、icon 节奏增强、模板细节对齐和措辞重写，token 消耗会明显更高。

**先结构验证，再视觉微调。** 如果某页同时有 connector 问题和版式问题，先修结构，再修样式。

## Workspace

**推荐工作空间如下。**

```text
deck_workspace/
  brief.md
  deck_narrative.md
  assets/
    diagrams/
    charts/
    icons/
    images/
    tables/
  build/
    generated/
    pptx/
    rendered/
      ppt_preview/
  validation/
  final/
```

**`brief.md` 放全局任务输入。** 目标读者、使用场景、模板约束、品牌要求、交付标准和验证要求都应在这里固定。它回答的是“为什么做这套 deck”和“哪些约束不能碰”。

**模板取证结果默认回写到 `brief.md`。** 不默认新增一份长期维护的 `template_audit.md`。页族判断、母版元素、字号系统和路线选择应作为 deck 级事实沉淀回主文档。

**`deck_narrative.md` 放整套叙事与页面想法。** 全局 narrative、核心判断、每页 reader question、文案想法、资产设想和版式意图都在这一份文档里，不再拆成 `deck_plan + content + terminology` 多份平级文档长期双写。

**`build/generated/slide_specs.yaml` 放派生结构化输入。** 它是机器友好的 build 入口，但默认不应手写维护，而应从 `deck_narrative.md` 自动派生。

**`theme_tokens` 应承载 deck 级 typography 与版心策略。** 至少建议显式定义 `typography_profile`、`domain_profile`、`hero_title_font_pt`、`section_title_font_pt`、`page_title_font_pt`、`subtitle_font_pt`、`minor_title_font_pt`、`body_font_pt`、`label_font_pt`、`caption_font_pt`、`title_line_spacing_multiple`、`body_line_spacing_multiple`、`title_paragraph_space_lines`、`body_first_line_indent_chars`、`body_paragraph_space_lines`、`latin_font_name`、`east_asia_font_name`、表格 token 和稳定边距。有参考模板时，这些 token 应优先来自模板取证；没有品牌约束时，中文任务默认采用中文宋体、英文 Times New Roman、正文小四约 `12pt`、首行缩进 2 个中文字符、段前段后各 `0.5` 行、正文 `1.5` 倍行距、标题 `1.0` 倍行距的策略。

**`typography_profile` 和 `domain_profile` 各司其职。** `typography_profile` 管字体、字号、段落和表格基础排版，例如 `zh_formal`；`domain_profile` 管题材文体与页面范式，例如 `financial_report_review` 需要图号、单位、来源注、免责声明、低饱和配色和稳定页眉页脚。不要把研报视觉纪律写进所有中文 deck 的 typography 默认。

**表格 token 应显式写入 theme。** 中文任务默认表格 token 包括 `table_font_pt: 10.5`、`table_line_spacing_multiple: 1.0`、`table_paragraph_space_lines: 0`、`table_first_line_indent_chars: 0`、`table_vertical_anchor: middle`、`table_header_alignment: center`、`table_index_alignment: left`、`table_text_alignment: left`、`table_numeric_alignment: right`。财务报表、经营指标和百分比列应显式进入 `numeric_columns` 或等价字段。

**`assets/` 放源资产。** diagram、chart、icon、image、table 是平级类型。不要让 Mermaid 变成一切页面的默认起点。

**`asset_mode` 是 workflow 的桥接字段。** 设计支持通过它决定页面该用哪类资产，技术支持通过它决定该走哪条实现路线和验证模式。

**`build/` 放可重建产物。** 当前 `pptx`、派生 `slide_specs.yaml`、中间 PDF 和逐页预览图都应放在这里。

**`validation/` 放证据。** connector 报告、preview manifest、review note、asset lint 结果都应集中落在这里。

**`validation/` 还应承载 deck 级 quality gates。** 至少建议固定 `package_preflight/` 与 `structure_precheck/` 两个目录，让文件级问题和页面结构问题分开沉淀，不要混成一份大杂烩报告。
**preview 导出后还应有 `render_review/`。** 它服务成图层问题，不应再塞回 `structure_precheck/`。

**`final/` 放交付物。** 给用户和评审会看的最终 deck 与 handoff 说明只放在这里。final 前应能指向最新 preview、三段质量 gate 和 visual review 结论。

## Deck 级 Quality Gates

**`package_preflight` 先看文件包是否干净。** 这一步关注 slide 数与包内元信息一致性、section 扩展是否残留旧引用、是否存在移动端高风险嵌入对象，以及其他会让微信 / WPS 这类脆弱解析器直接拒绝打开的信号。

**`structure_precheck` 再看结构层排版是否失控。** 这一步关注文本框 fit、文字遮挡和结构化对象内部标签风险。它属于 fail-fast 检查，不替代最终 preview review。

**`render_review` 最后补成图层问题。** 这一步在 preview 图导出后执行，关注边界触墨和扁平化图像内部文字风险。它和结构预检不是替代关系。

**推荐目录如下。**

```text
validation/
  package_preflight/
    history/
      package_preflight_YYYYMMDD_HHMMSS.json
      package_preflight_YYYYMMDD_HHMMSS.md
  structure_precheck/
    history/
      structure_precheck_YYYYMMDD_HHMMSS.json
      structure_precheck_YYYYMMDD_HHMMSS.md
    shape_inventory.json
  render_review/
    history/
      render_review_YYYYMMDD_HHMMSS.json
      render_review_YYYYMMDD_HHMMSS.md
```

**推荐命令如下。**

```bash
python scripts/check_pptx_package_preflight.py \
  --pptx <path/to/deck.pptx> \
  --workspace-dir <path/to/deck_workspace> \
  --fail-on error

python scripts/check_pptx_structure_precheck.py \
  --pptx <path/to/deck.pptx> \
  --workspace-dir <path/to/deck_workspace> \
  --inventory-out <path/to/deck_workspace/validation/structure_precheck/shape_inventory.json> \
  --fail-on error

python scripts/check_pptx_render_review.py \
  --pptx <path/to/deck.pptx> \
  --preview-dir <path/to/deck_workspace/build/rendered/ppt_preview> \
  --workspace-dir <path/to/deck_workspace> \
  --fail-on error
```

## 模板取证最小要求

**模板取证的目标是确认页面系统。** 需要回答“哪些是模板级约束，哪些只是原页面内容”，而不是只记录颜色看起来像什么。

**最小检查固定为五项。**
- 导出模板逐页预览，识别封面页族、正式页族、章节页族和末页页族。
- 读取 `slide layout` 与 `slide master`，确认共享 logo、页脚、装饰角、页码和标题区属于哪一层。
- 读取模板里的真实文字与字号层级，至少覆盖封面标题、正式页标题、正文、图注、页脚和页码。
- 做最小 PoC 验证继承关系，例如新建一张 `Blank` layout 页，只放普通文本，检查关键母版元素是否自动出现。
- 明确当前任务采用 `master-first / layout-first`、混合复用还是 `branded rebuild`。

**优先用脚本把模板审计结果落盘。** 推荐先运行下面的命令，把模板取证结果沉淀到 `validation/template_audit/`，再把关键结论回写进 `brief.md`。

```bash
python scripts/audit_pptx_template.py \
  --pptx <path/to/reference_template.pptx> \
  --json-out <path/to/deck_workspace/validation/template_audit/template_audit.json> \
  --md-out <path/to/deck_workspace/validation/template_audit/template_audit.md>
```

## `brief.md` 最小模板

```md
# <Deck Title>

## 任务定义
- 目标读者：
- 主使用场景：
- 目标动作：
- 参考模板文件：
- 模板 / 品牌约束：
- 交付物要求：
- 验证要求：

## 模板取证
- 页面系统判断：
- 关键母版 / layout 元素：
- 字号系统：
- 计划采用的构建路线：
- 最小 PoC 结论：

## 风格与边界
- 风格参考：
- typography_profile：
- domain_profile：
- 允许使用的素材：
- 禁止使用的品牌元素：
- 免责声明 / 风险边界：
- 不允许发生的错误：
```

## `deck_narrative.md` 最小模板

```md
---
deck:
  title: "<deck title>"
  audience: "<target audience>"
  scenario: "<primary scenario>"
  objective: "<primary decision or action>"
  theme_tokens:
    typography_profile: "zh_formal"
    domain_profile: null
    hero_title_font_pt: 24
    section_title_font_pt: 20
    page_title_font_pt: 24
    subtitle_font_pt: 16
    minor_title_font_pt: 14
    body_font_pt: 12
    label_font_pt: 10.5
    caption_font_pt: 9
    title_line_spacing_multiple: 1.0
    body_line_spacing_multiple: 1.5
    title_paragraph_space_lines: 0.5
    body_first_line_indent_chars: 2
    body_paragraph_space_lines: 0.5
    latin_font_name: "Times New Roman"
    east_asia_font_name: "宋体"
    table_font_pt: 10.5
    table_line_spacing_multiple: 1.0
    table_paragraph_space_lines: 0
    table_first_line_indent_chars: 0
    table_vertical_anchor: "middle"
    table_header_alignment: "center"
    table_index_alignment: "left"
    table_text_alignment: "left"
    table_numeric_alignment: "right"
    left_margin_in: 0.78
    right_margin_in: 15.22
---

# <Deck Title>

## Global Narrative
- 这套 deck 的主判断：
- 这套 deck 的论证主线：
- 这套 deck 的主题词和禁区：

### S01 | <slide title>
```yaml slide_spec
title: "<slide title>"
reader_question: "<what this page should answer>"
page_task: "persuade"
reading_mode: "decision"
archetype: "decision-logic"
asset_mode: "text-layout-native"
validation_mode: "preview_only"
key_message: "<single core message>"
required_assets: []
```

**Narrative Role.** 这页为什么存在、要帮助读者完成什么判断。

**Content Notes.** 这页准备放什么内容、什么判断句、什么证据。

**Layout Notes.** 这页倾向使用什么版式、什么 icon 或图表策略。
```

## 派生 `slide_specs.yaml`

**默认不要手写维护。** 推荐从 `deck_narrative.md` 派生：

```bash
python scripts/derive_slide_specs_from_narrative.py \
  --narrative <path/to/deck_narrative.md> \
  --out-yaml <path/to/build/generated/slide_specs.yaml>
```

**build 脚本应优先读取派生文件。** 如果派生文件不存在，build 脚本应先生成它，再继续执行。

## 字段约定

**`page_task`。** 推荐使用 `persuade`、`explain`、`compare`、`evidence`、`archive`。

**`reading_mode`。** 推荐使用 `scan`、`decision`、`guided`、`reference`。

**`asset_mode`。** 推荐使用以下显式枚举：
- `text-layout-native`
- `diagram-connector`
- `diagram-visual`
- `office-chart-native`
- `python-figure-image`
- `table-native`
- `image-hero`
- `icon-accent`
- `mixed`

**`validation_mode`。** 推荐使用 `preview_only`、`diagram_connector`、`diagram_visual`、`chart_editable`、`chart_image`、`template_locked`。

**`asset_mode` 和 `validation_mode` 应成对思考。** 例如 `diagram-connector -> diagram_connector`，`office-chart-native -> chart_editable`，`python-figure-image -> chart_image`，而不是 build 完再临时猜测怎么验收。

## 验证模式

**`preview_only`。** 纯文本结构页、摘要页、章节页。要求逐页预览图与人工复核。

**`diagram_connector`。** 后续需要拖动维护的 diagram 页。要求 connector 校验与预览导出。

**`diagram_visual`。** 无 connector 的结构图。要求显式说明不依赖 connector，并检查主方向与层级。

**`chart_editable`。** 原生 Office chart 页。要求确认图表仍可编辑，并检查标签、图例和字体策略。

**`chart_image`。** 高 DPI 图表页。要求检查比例、清晰度与卡片内留白。

**`template_locked`。** 强模板页。要求确认关键品牌元素未漂移，通过预览做高保真复核，并检查页面层没有重复插入母版元素。

**`visual_review`。** 所有 deck 都需要 final 前 visual review。正式中文材料还应检查 typography profile 与 table profile 是否兑现；研报型 deck 还应检查图号、单位、来源注、免责声明、页眉页脚、低饱和配色和版心纪律。

## 交付底线

**完整交付至少包含七项。** `brief.md`、`deck_narrative.md`、派生 `slide_specs.yaml`、可编辑 `pptx`、逐页预览图、与页面验证模式相匹配的验证结果、final 前 visual review 结论。

**每次修改都要有新证据。** 修复后必须能指出新的 `pptx`、新的 preview，或新的结构校验结果。
