# Preset Style Guides for `word-polished-doc-collab`

**定位。** 本文档用于放入 `word-polished-doc-collab/references/`，作为三套可复用的咨询报告风格预设指南。它描述视觉特征、`style_profile` 配置、Markdown 语义、DOCX 构建路线、图表资产路线和交付前 QA。三套风格分别对应：`teal_consulting_report`、`red_private_equity_report`、`blue_editorial_article`。

**使用边界。** 这些 preset 提供版式和视觉语言的工程化近似方案。除非用户拥有授权资产，构建时不应嵌入或仿制任何公司 logo、商标、专有字体和受版权保护的原图。封面图、章节图和图标应由用户提供、由 Python 生成，或使用已授权素材。

**接入方式。** 当用户明确要求深青色双栏咨询报告、红色投资报告、蓝色 editorial article，或引用相似样例时，默认按精细模式读取本文档，再联读 `typography_profiles.md`、`technical_support.md`、`build_routes.md` 和 `quality_gates.md`。精细模式下，`meta.json` 中的 `style_profile` 应写入本文定义的 preset 名称；只有用户明确接受轻量近似时，才跳过完整 preset workspace。

**语言范围。** 本文三套 preset 默认服务英文咨询报告。凡是涉及双栏、窄栏、英文 serif/sans-serif 组合、`Notes`/`Source` 英文题注体系的条款，都以英文正文为前提，不应反向推导为中文正式文档默认规范。

**与默认中文正式文档规则的衔接。** preset 主要覆盖配色、页面结构、标题系统和资产路线。它可以显式覆盖正文首行缩进、`figure_title` 位置和 notes/source 的摆放方式，但必须把这些覆盖写成清楚的 profile 契约。没有显式声明的字段，继续继承默认中文正式文档规则；如果文档主体是中文，除非用户明确要求套用英文咨询 preset，否则仍优先使用中文正式文档 profile。

```json
{
  "source_docx": "original/source.docx",
  "markdown_file": "markdown/report/report.md",
  "assets_dir": "markdown/report/assets",
  "output_docx": "build/docx/report.docx",
  "style_profile": "teal_consulting_report"
}
```

## 1. 共用实现模型

**核心思路。** 三套 preset 都按 `block_role -> style token -> Word style / run properties` 落地。正文、标题、封面、图表、caption、source note 和页眉页脚都必须有独立 role，避免在 Markdown 中靠空行、加粗或手工缩进模拟视觉效果。

| role | 用途 | 默认实现 |
| --- | --- | --- |
| `cover_title` | 封面主标题 | 独立 Word paragraph style，必要时使用封面模板或图片叠字 |
| `cover_subtitle` | 封面副标题 | 与封面主标题同区块，字号小一级 |
| `eyebrow` | practice、报告系列、章节标签 | 小号无衬线、大写或半粗 |
| `doc_title` | 文档内主标题 | 正文页或 chapter opener 的主标题 |
| `heading_1` | 一级标题 | 章节标题或页面大标题 |
| `heading_2` | 二级标题 | 小节标题 |
| `heading_3` | 三级标题 | 段内小标题、重点段落开头 |
| `body` | 正文 | 英文正文可按 preset 切换单栏、窄单栏或双栏 |
| `lead` | 开篇导语 | 比正文略大或更重，段距更宽 |
| `at_a_glance` | 摘要要点 | 短句列表、符号或强调色 bullet |
| `quote_callout` | 大段引语或关键观点 | 大字号、窄栏、上下留白 |
| `figure_title` | 图题 | 位置由 preset 的 `caption_policy` 决定 |
| `figure_note` | Notes / Source | 小字号、浅灰或深灰 |
| `source_note` | 来源说明 | 可与 `figure_note` 分离，也可合并 |
| `exhibit_label` | Exhibit / Figure 编号 | 小号半粗，通常与图题绑定 |
| `table_title` | 表题 | 表上方 |
| `table_body` | 表格正文 | 独立字号和段距 |
| `footer_running` | 页脚/页眉信息 | 小号浅灰或深灰 |

**建议构建路线。** 普通文本和静态图表使用 `markdown -> docx`。需要封面大图压底、彩色大块背景、图文叠放、页眉横线、跨栏章节 opener 时，使用 `markdown -> docx -> ooxml patch` 或“预制 DOCX 模板 + 内容填充”。需要可编辑图表时使用 Office native chart；需要可编辑说明型插图时使用 Office native illustration；需要复杂定制图表时使用 Python figure 输出 PNG/SVG 后插入 DOCX。

**页面与分节。** 每套 preset 都建议使用多 section。封面、目录、正文、章节 opener、附录可以各自独立设置页面大小、页边距、页眉页脚、栏数和背景。Word 中的满版背景、图片压底和绝对定位对象需要模板或 OOXML patch，不能只依赖 `python-docx` 的段落流式布局。

**Markdown 语义约定。** 推荐在 Markdown 中使用标准标题、图片、表格，并直接写最终会出现在文面上的题注文本。不要把 `表题：` 这种调试式前缀写进长期维护源。

```md
# Executive Summary

导语：这一段进入 lead role。

表 1 关键指标
| 指标 | 数值 |
| --- | ---: |
| A | 90% |
表注：数据截至 2026 年。

![Exhibit 1](assets/exhibit_1.png)
Exhibit 1  The forces reshaping the market
图注：Source: internal analysis.
```

**资产路线应沿用 deck skill 的分流思路。** 在 preset 模式下，优先把数据插图分成 `office_native_chart`、`office_native_illustration` 和 `python_figure` 三类，再决定每一页或每一节使用哪条路线，并把这些决策写进 `asset_manifest`。

## 2. Preset A: `teal_consulting_report`

### 2.1 视觉目标

**整体气质。** 这套风格适合风险、AI、技术、韧性、供应链等主题。视觉重心是深色科技封面、青绿色标题、蓝青与暖橙点缀、大片场景图、双栏英文正文和信息图式 exhibit。

**版面结构。** 封面使用深色全幅主题图，白色大标题置于左上或上半区，右下保留品牌位。目录页极简，正文页采用上半页 hero image + 下半页内容的章节 opener，也可在普通英文正文页使用双栏排版。页脚放小号报告名、机构名和页码。

**图表语言。** Exhibit 采用流程图、关系图、矩阵或大数字组合。颜色以深青绿为主，辅以亮青、橙色和灰色。适合用 Python 生成静态 PNG/SVG，或用 Word 表格与形状做可维护版本。

### 2.2 `style_profile` 配置

```yaml
style_profile: teal_consulting_report
workflow_mode: refined
page:
  size: A4
  orientation: portrait
  margins:
    top: 0.55in
    bottom: 0.55in
    inner: 0.58in
    outer: 0.58in
  body_columns: 2
  column_gap: 0.28in
fonts:
  cover_latin: Arial
  cover_cjk: Microsoft YaHei
  heading_latin: Arial
  heading_cjk: Microsoft YaHei
  body_latin: Arial
  body_cjk: Microsoft YaHei
  fallback_cjk: SimHei
colors:
  dark_bg: "#061319"
  heading_green: "#16845F"
  cyan: "#12A7C8"
  warm_orange: "#E86F2E"
  text: "#5F666A"
  dark_text: "#30383D"
  light_gray: "#D8DEE2"
  white: "#FFFFFF"
roles:
  cover_title:
    font_size: 34pt
    bold: true
    color: "#FFFFFF"
    line_spacing: 1.0
    space_after: 8pt
  cover_subtitle:
    font_size: 18pt
    color: "#FFFFFF"
    line_spacing: 1.1
  cover_meta:
    font_size: 8.5pt
    bold: true
    color: "#FFFFFF"
  heading_1:
    font_size: 28pt
    bold: true
    color: "#16845F"
    line_spacing: 1.05
    space_before: 10pt
    space_after: 14pt
  heading_2:
    font_size: 14pt
    bold: true
    color: "#30383D"
    space_before: 10pt
    space_after: 5pt
  heading_3:
    font_size: 10pt
    bold: true
    color: "#30383D"
    space_before: 6pt
    space_after: 2pt
  body:
    font_size: 9.2pt
    color: "#5F666A"
    line_spacing: 1.08
    first_line_indent: 0
    space_before: 0pt
    space_after: 6pt
  lead:
    font_size: 10pt
    color: "#4D5559"
    line_spacing: 1.12
    space_after: 8pt
  bullet:
    font_size: 9.2pt
    bullet_color: "#16845F"
    hanging: 0.14in
  exhibit_label:
    font_size: 8pt
    bold: true
    all_caps: true
    color: "#30383D"
  figure_title:
    font_size: 11pt
    bold: true
    color: "#30383D"
    space_before: 8pt
    space_after: 2pt
  figure_note:
    font_size: 7pt
    color: "#6F777B"
  footer_running:
    font_size: 6.5pt
    all_caps: true
    color: "#A0A6AA"
caption_policy:
  table_title_position: above
  figure_title_position: above
  table_caption_position: below
  figure_note_position: below
  source_note_position: below
```

### 2.3 DOCX 落地方案

**封面。** 最稳定方案是生成一张封面背景图，大小按 A4 比例裁切，然后在 Word 首节使用满页图片。标题、副标题、日期和作者可用文本框叠加；如果宿主脚本暂不支持文本框叠加，就把封面作为完整 PNG 输出。右下角 logo 位应作为可选合法资产，不内置到 preset。

**章节 opener。** 每个一级章节可以使用半页 hero image。实现上创建独立 section，顶部插入满宽图片，高度约为页面 42% 到 46%；图片下方进入双栏英文正文，`heading_1` 使用绿色大标题，正文为紧凑双栏。若 Word 对跨栏标题支持不稳定，使用“标题单栏 section + 正文双栏 section”的拆分法。

**正文页。** 默认双栏英文正文。段落短、图表多时保持两栏；长推理段落可切为单栏 `body_single_column`，但同一章节内不要频繁切换。项目符号使用绿色圆点或短横，项目正文中可加粗关键词。

**Exhibit。** 关系图、矩阵、流程图建议走 Python figure。当前 preset 的 `caption_policy` 明确把 `figure_title` 放在图上方，`figure_note/source_note` 放在图下方。若要做深青色咨询风格的大数字与矩阵，可以在 Python 中定义色板：绿色主色、亮青连线、暖橙强调、浅灰背景。图像宽度默认 100% 页面文本区，密集图可独占整页。

**QA。** 检查封面图是否满版、标题是否压在安全区内、章节 opener 的 hero image 是否被拉伸、双栏栏距是否稳定、页脚是否在所有正文页一致、Exhibit 文本是否小到不可读。

## 3. Preset B: `red_private_equity_report`

### 3.1 视觉目标

**整体气质。** 这套风格适合金融、投资、交易、市场年度报告。视觉重心是红色品牌带、白底长文、少量强红强调、灰红图表、细横线页眉、清晰的 Figure 编号。

**版面结构。** 封面通常由顶部留白、居中大图、底部大面积红色标题带组成，可附加横向细线装饰。正文页为 Letter 纸、单栏为主，页眉有小号 running title 和细线，页码在底部居中。章节 opener 可使用横幅图片，上面叠放白色标题卡片。

**图表语言。** 图表以浅灰柱、红色强调柱、红色线、黑色标题和小号 Notes / Source 组成。大量 Figure 标题位于图上方，图表说明细、密度高，适合 Office native chart 或 Python figure。

### 3.2 `style_profile` 配置

```yaml
style_profile: red_private_equity_report
workflow_mode: refined
page:
  size: Letter
  orientation: portrait
  margins:
    top: 0.70in
    bottom: 0.68in
    inner: 0.78in
    outer: 0.78in
  body_columns: 1
fonts:
  cover_latin: Arial
  cover_cjk: Microsoft YaHei
  heading_latin: Arial
  heading_cjk: Microsoft YaHei
  body_latin: Times New Roman
  body_cjk: SimSun
  chart_latin: Arial
  chart_cjk: Microsoft YaHei
colors:
  accent_red: "#E40000"
  red_dark: "#B80000"
  black: "#111111"
  text: "#222222"
  mid_gray: "#777777"
  light_gray: "#D9D9D9"
  rule_gray: "#8B8B8B"
  white: "#FFFFFF"
roles:
  cover_title:
    font_size: 18pt
    bold: true
    color: "#FFFFFF"
    line_spacing: 1.0
  header_brand:
    font_size: 6.5pt
    bold: true
    all_caps: true
    color: "#E40000"
  chapter_title_card:
    font_size: 20pt
    bold: true
    color: "#111111"
    line_spacing: 1.0
  chapter_subtitle:
    font_size: 9.5pt
    color: "#111111"
    space_after: 6pt
  heading_1:
    font_size: 16pt
    bold: true
    color: "#111111"
    space_before: 12pt
    space_after: 7pt
  heading_2:
    font_size: 12pt
    bold: true
    color: "#111111"
    space_before: 10pt
    space_after: 5pt
  body:
    font_size: 10pt
    color: "#222222"
    line_spacing: 1.08
    first_line_indent: 0
    space_before: 0pt
    space_after: 7pt
  at_a_glance:
    font_size: 9pt
    color: "#222222"
    bullet_shape: triangle
    bullet_color: "#E40000"
  quote_callout:
    font_size: 15pt
    color: "#111111"
    line_spacing: 1.12
    space_before: 14pt
    space_after: 14pt
  figure_title:
    font_size: 10pt
    bold: true
    color: "#111111"
    red_prefix: true
    space_before: 10pt
    space_after: 4pt
  figure_note:
    font_size: 6.8pt
    color: "#555555"
  footer_running:
    font_size: 7pt
    color: "#555555"
caption_policy:
  table_title_position: above
  figure_title_position: above
  table_caption_position: below
  figure_note_position: below
  source_note_position: below
```

### 3.3 DOCX 落地方案

**封面。** 使用 Letter 纸。顶部保留白色空间，居中放横向主题图，底部插入红色大块背景。实现方式优先为“封面整页背景 PNG”或 DOCX 模板；如果用脚本拼装，可用 1 列 3 行无边框表格模拟：上方品牌区、中间图片区、下方红色标题区。左右横线装饰建议作为矢量/PNG 资产，不在 Word 中手工绘制多条线。

**目录。** 目录页保持极简，标题为 `Contents`，条目左对齐，页码右对齐，中间使用点引导线。若需要自动目录，走 Word TOC 域和 OOXML patch；若只是静态报告，使用普通段落更稳定。

**章节 opener。** 顶部插入横幅图，高度约 2.2in 到 2.6in，图片下方或图片上叠加白色标题卡片。卡片内包括章节标题、副标题、作者和 `At a Glance`。`At a Glance` 使用红色三角 bullet，正文短句不超过两行。

**正文页。** 单栏长文为主，页眉顶部加入细横线，横线上方或下方居中放小号 running title。正文使用衬线字体，标题和图表使用无衬线。重点短句可用较大 quote callout 独占一段。

**Figure。** 当前 preset 的 `caption_policy` 把 `figure_title` 放在图上方，`Figure 1:` 使用红色或红色前缀，标题正文黑色。图表主体建议用 Office native chart 以便后续编辑；不可编辑需求可用 Python figure。柱状图默认浅灰主系列、红色强调系列；折线图用红线；图例小号无边框；Notes 和 Source 位于图下方。

**QA。** 检查页眉细线是否贯穿正文页、Figure 编号是否连续、红色强调是否只用于编号/重点数据/封面区、图表 Notes 是否没有溢出、章节 opener 的白色标题卡片是否覆盖在安全区内。

## 4. Preset C: `blue_editorial_article`

### 4.1 视觉目标

**整体气质。** 这套风格适合观点文章、研究简报、管理议题和 AI/数字化主题。视觉重心是大量留白、深海军蓝 serif 标题、简洁单栏正文、蓝色主题图和极简 exhibit。

**版面结构。** 封面顶部放机构名或品牌位，中部偏左放 practice 标签、超大 serif 标题、副标题、作者说明，下半页放横向蓝色主题图。正文页使用窄单栏，页脚右侧放文章标题和页码。Exhibit 位于正文中间，周围留白充足。

**图表语言。** Exhibit 以白底、深蓝标题、蓝色环形图、图标和流程模块为主。图形不追求满版密度，强调可读性、留白和结构清楚。

### 4.2 `style_profile` 配置

```yaml
style_profile: blue_editorial_article
workflow_mode: refined
page:
  size: Letter
  orientation: portrait
  margins:
    top: 0.72in
    bottom: 0.65in
    inner: 1.32in
    outer: 1.08in
  body_columns: 1
fonts:
  cover_latin: Georgia
  cover_cjk: SimSun
  heading_latin: Georgia
  heading_cjk: SimSun
  body_latin: Arial
  body_cjk: Microsoft YaHei
  exhibit_latin: Arial
  exhibit_cjk: Microsoft YaHei
colors:
  navy: "#071828"
  blue: "#003A8C"
  bright_blue: "#1257D8"
  cyan: "#00A6D6"
  text: "#333333"
  mid_gray: "#6A6A6A"
  light_gray: "#DADADA"
  white: "#FFFFFF"
roles:
  brand_wordmark_slot:
    font_size: 24pt
    color: "#071828"
    line_spacing: 0.95
  eyebrow:
    font_size: 8pt
    bold: true
    color: "#071828"
    space_after: 8pt
  cover_title:
    font_size: 34pt
    bold: true
    color: "#071828"
    line_spacing: 0.96
    space_after: 8pt
  cover_subtitle:
    font_size: 12pt
    color: "#333333"
    line_spacing: 1.15
    space_after: 10pt
  author_note:
    font_size: 8.5pt
    italic: true
    color: "#555555"
  heading_1:
    font_size: 15pt
    bold: true
    color: "#071828"
    space_before: 14pt
    space_after: 8pt
  heading_2:
    font_size: 11.5pt
    bold: true
    color: "#071828"
    space_before: 10pt
    space_after: 5pt
  body:
    font_size: 10pt
    color: "#333333"
    line_spacing: 1.28
    first_line_indent: 0
    space_before: 0pt
    space_after: 8pt
  lead:
    font_size: 10.5pt
    color: "#333333"
    line_spacing: 1.30
    space_after: 9pt
  exhibit_label:
    font_size: 8pt
    color: "#333333"
    space_before: 14pt
    space_after: 8pt
  figure_title:
    font_size: 12pt
    bold: true
    color: "#071828"
    line_spacing: 1.1
    space_after: 8pt
  figure_note:
    font_size: 6.5pt
    color: "#666666"
  footer_running:
    font_size: 6.5pt
    color: "#333333"
caption_policy:
  table_title_position: above
  figure_title_position: above
  table_caption_position: below
  figure_note_position: below
  source_note_position: below
```

### 4.3 DOCX 落地方案

**封面。** 使用 Letter 纸。顶部品牌位保留为文本或合法图片资产；中部文本块从页面左侧约 1.3in 处开始，宽度约 5.3in。标题使用 serif，字号大、行距紧。下半页插入满宽蓝色主题图，高度约 3.1in。页底左侧放日期。

**正文页。** 使用窄单栏，正文宽度约 4.9in 到 5.3in。相比红色投资报告 preset，段落更松、留白更多。正文使用无衬线以提高屏幕阅读体验，标题使用 serif 保持出版感。这个 preset 显式覆盖默认中文正式文档规则，段落之间用段后距，不用首行缩进。

**Exhibit。** 当前 preset 的 `caption_policy` 把 `figure_title` 放在图上方。Exhibit 先写 `Exhibit 1`，再写一行较大的黑色标题，随后插入图像或 Office shape。环形图、流程模块和图标网格建议用 Python figure 或 SVG 资产；图标统一使用深蓝底白线或深蓝线框。Source 位于图下方左侧，小号浅灰。

**分页。** 尽量避免一页内出现过多图表。每个 Exhibit 上下至少保留 12pt 空白。长正文保持连续阅读，不使用双栏。页面底部孤行可通过手工 QA 或 keep-with-next 规则处理。

**QA。** 检查封面标题是否保持 serif 大标题效果、正文栏宽是否明显窄于红色投资报告 preset、蓝色主题图是否不失真、Exhibit 是否有充足留白、页脚文章名和页码是否位置稳定。

## 5. Preset 对照表

| 配置项 | `teal_consulting_report` | `red_private_equity_report` | `blue_editorial_article` |
| --- | --- | --- | --- |
| 适用内容 | 风险、技术、AI、韧性、供应链 | PE、金融、市场年度报告 | 管理观点、AI/数字化文章 |
| 页面 | A4 | Letter | Letter |
| 主体栏数 | 英文双栏为主 | 英文单栏 | 英文窄单栏 |
| 封面 | 深色满版图 + 白字 | 白底图片 + 红色标题带 | 大留白 + serif 标题 + 蓝色横图 |
| 标题字体 | 无衬线粗体 | 无衬线粗体 | serif 大标题 |
| 正文字体 | 无衬线紧凑 | 衬线长文 | 无衬线宽松 |
| 主色 | 青绿、深青、亮青、橙 | 红、灰、黑 | 深海军蓝、亮蓝、青蓝 |
| 图表 | 信息图、关系图、矩阵 | 数据图、柱线图 | 极简 exhibit、图标流程 |
| 推荐路线 | 模板或 OOXML patch + Python figure | 模板 + Office native chart | markdown -> docx + Python/SVG exhibit |
| QA 重点 | 满版图、双栏、绿色标题、Exhibit 清晰度 | 页眉横线、红色强调、Figure 编号 | 留白、窄栏、serif 标题、Exhibit 空间 |

## 6. 资源路由与可用 `style_profile`

**资源路由规则。** 这部分定义 preset 进入主 skill 后的推荐路由：

```md
- 当用户要求套用深青咨询、红色投资、蓝色 editorial article 或其他同类咨询报告视觉 preset 时，读取 `references/preset_style_guides.md`。
- 这类 preset 请求默认走精细模式，因为它已经显式引入模板化 style contract、caption override 和资产路线。
- 只有当用户明确要求轻量近似、接受不追求完整模板还原与验证证据时，才允许走轻量模式并只读取目标 preset 的配置块。
- 如果用户要求长期复用、批量生成、可编辑图表、封面模板或自动 QA，走精细模式，并联读 `build_routes.md`、`technical_support.md`、`quality_gates.md`。
```

**可用 style profile 名称。** 构建器允许以下值：

```yaml
allowed_style_profiles:
  - cn_song_times
  - cn_kaiti_times
  - cn_heiti_arial
  - teal_consulting_report
  - red_private_equity_report
  - blue_editorial_article
```

## 7. 构建器实现清单

**样式注册。** 构建器需要为每个 preset 注册 Word paragraph styles 和 character styles，至少包括 `cover_title`、`cover_subtitle`、`eyebrow`、`heading_1`、`heading_2`、`heading_3`、`body`、`lead`、`figure_title`、`figure_note`、`table_title`、`table_body`、`footer_running`。

**字体槽位。** 所有 run 必须显式设置 `w:ascii`、`w:hAnsi`、`w:eastAsia`、`w:cs`。CJK 与 Latin 字体按 role 分别设置。图表中的文字如果由 Python 生成，应使用同一组可用字体或以 SVG/PNG 固化。

**页眉页脚。** 红色投资报告 preset 需要页眉横线和居中 running title；深青咨询 preset 需要左右页脚信息；蓝色 editorial article 需要右下文章名和页码。页眉页脚建议使用独立 section 管理，避免封面继承正文页眉。

**多栏。** 深青咨询 preset 的正文需要 section columns，且双栏策略默认只用于英文咨询正文。`python-docx` 对 columns 支持不足时，应使用 OOXML patch 写入 `w:cols`。章节 opener 可拆为标题/图片 section 和正文双栏 section。

**背景与图文叠放。** 封面、红色大色块、白色标题卡片和图片压底属于高精度视觉对象。稳定实现优先顺序是：DOCX 模板占位符、封面整页 PNG、OOXML 文本框/形状 patch、普通段落和表格模拟。

**图表资产。** 红色投资报告 preset 的图表优先 Office native chart；深青咨询和蓝色 editorial article 的复杂 exhibit 优先 Python figure 或 SVG。所有图表都要有 `figure_title`、`figure_note`、`source_note`、连续编号，并在 `asset_manifest` 中登记来源和可编辑性。

## 8. 交付前 QA

**结构 QA。** 检查 `meta.json` 中的 `style_profile` 是否存在，`asset_manifest` 是否存在，Markdown 是否有显式图题、表题、图注、来源说明和表注，所有图片路径是否存在。

**版式 QA。** 检查页面尺寸、页边距、栏数、标题字号、正文行距、页眉页脚、Figure/Exhibit 标题位置、Notes/Source 字号和颜色，并确认它们符合该 preset 的 `caption_policy`。

**视觉 QA。** 检查封面是否进入安全区，图片是否变形，图表文字是否清晰，红色或绿色强调是否过度使用，分页是否出现孤行、断图或表格跨页失控。

**能力边界。** 如果宿主脚本没有模板填充、OOXML shape patch、Office native chart 或多栏 patch，就应把对应 preset 降级为“内容可读的近似 DOCX”，并在交付说明中写清楚哪些视觉元素通过静态图片实现，哪些元素保留为可编辑 Word 对象。
