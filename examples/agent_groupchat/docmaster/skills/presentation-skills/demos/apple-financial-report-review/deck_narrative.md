---
deck:
  title: "Apple Inc. FY2025 财报点评"
  audience: "学术交流读者"
  scenario: "正式财报点评 PPT 初稿"
  objective: "用可复核数据解释 FY2025 业绩恢复、结构变化与风险边界"
  theme_tokens:
    hero_title_font_pt: 28
    section_title_font_pt: 22
    page_title_font_pt: 19
    subtitle_font_pt: 13
    minor_title_font_pt: 12
    body_font_pt: 12
    label_font_pt: 10.5
    caption_font_pt: 6.6
    title_line_spacing_multiple: 1.0
    body_line_spacing_multiple: 1.5
    title_paragraph_space_lines: 0.5
    body_paragraph_space_lines: 0.5
    body_first_line_indent_in: 0.24
    table_font_pt: 10.5
    table_line_spacing_multiple: 1.0
    table_paragraph_space_lines: 0
    table_header_alignment: "center"
    table_index_alignment: "left"
    table_text_alignment: "left"
    table_numeric_alignment: "right"
    latin_font_name: "Times New Roman"
    east_asia_font_name: "宋体"
    left_margin_in: 0.46
    right_margin_in: 12.87
---

# Apple Inc. FY2025 财报点评

## Global Narrative
- 这套 deck 的主判断：FY2025 是 Apple 收入与利润恢复的一年，Services 增长和毛利率上行继续改善经营韧性，但 iPhone 依赖、Greater China 下滑、AI 终端节奏和监管压力仍是核心观察变量。
- 这套 deck 的论证主线：先给出经营结论，再拆收入、利润率、地区、现金流与资本回报，最后明确风险和免责声明。
- 这套 deck 的主题词和禁区：主题词为“稳健恢复、服务化、现金流、结构性风险”；禁区为投资评级、目标价、侵权 logo、未披露数据和无来源判断。

### S01 | 封面
```yaml slide_spec
slide_id: "S01"
title: "Apple Inc. FY2025 财报点评"
reader_question: "这份材料的研究对象、口径和边界是什么？"
page_task: "persuade"
reading_mode: "scan"
archetype: "hero-statement"
asset_mode: "text-layout-native"
validation_mode: "preview_only"
key_message: "稳健恢复延续，服务化与现金流仍是核心护城河"
required_assets: []
```

**Narrative Role.** 封面承担研究口径说明，明确 FY2025 10-K、学术交流和非机构观点边界。

**Content Notes.** 放主标题、副标题、数据口径、生成日期和免责声明短句。

**Layout Notes.** 深色标题带、右侧关键数字组，不放任何公司或机构 logo。

### S02 | 核心观点
```yaml slide_spec
slide_id: "S02"
title: "FY2025 经营恢复明确，结构改善主要来自服务化和利润率"
reader_question: "读者应先记住哪几个结论？"
page_task: "persuade"
reading_mode: "decision"
archetype: "board-memo"
asset_mode: "mixed"
validation_mode: "preview_only"
key_message: "收入、利润和毛利率同步修复，但业务结构风险仍未消失"
required_assets: ["apple_financials_fy2021_fy2025.csv", "apple_product_net_sales_fy2021_fy2025.csv"]
```

**Narrative Role.** 用研报摘要页方式压缩全套判断。

**Content Notes.** 四个要点：收入恢复、利润率提升、Services 增长、Greater China 与资本回报边界。

**Layout Notes.** 左侧主判断，右侧四个关键指标卡片。

### S03 | 财务摘要
```yaml slide_spec
slide_id: "S03"
title: "收入创五年新高，净利润恢复至千亿美元以上"
reader_question: "FY2025 的三表核心指标处于什么位置？"
page_task: "evidence"
reading_mode: "decision"
archetype: "chart-spotlight"
asset_mode: "office-chart-native"
validation_mode: "chart_editable"
key_message: "FY2025 收入同比增长 6.4%，净利润同比增长 19.5%"
required_assets: ["apple_financials_fy2021_fy2025.csv"]
```

**Narrative Role.** 用五年时间序列证明恢复不是单点描述。

**Content Notes.** 主图展示收入与净利润，旁边列示经营利润率、自由现金流和资本回报。

**Layout Notes.** 原生组合图，柱形为收入，折线为净利润。

### S04 | 收入结构
```yaml slide_spec
slide_id: "S04"
title: "iPhone 仍是收入中枢，Services 成为最稳定的增量来源"
reader_question: "收入增长来自哪些业务？"
page_task: "evidence"
reading_mode: "guided"
archetype: "chart-spotlight"
asset_mode: "office-chart-native"
validation_mode: "chart_editable"
key_message: "FY2025 Services 收入同比增长 13.5%，收入占比提升至 26.2%"
required_assets: ["apple_product_net_sales_fy2021_fy2025.csv"]
```

**Narrative Role.** 拆解 Apple 的产品线结构，解释增长来源和依赖项。

**Content Notes.** 堆叠柱展示产品线收入，注释 iPhone、Services、Wearables 的趋势差异。

**Layout Notes.** 原生堆叠柱 + 右侧观察要点。

### S05 | 利润率结构
```yaml slide_spec
slide_id: "S05"
title: "Services 高毛利扩张继续抬升综合毛利率"
reader_question: "毛利率提升的结构性来源是什么？"
page_task: "explain"
reading_mode: "guided"
archetype: "research-note"
asset_mode: "office-chart-native"
validation_mode: "chart_editable"
key_message: "FY2025 Services 毛利率 75.4%，综合毛利率提升至 46.9%"
required_assets: ["apple_gross_margin_by_type_fy2021_fy2025.csv"]
```

**Narrative Role.** 解释利润率韧性的主要机制。

**Content Notes.** 折线展示 Products、Services 和综合毛利率，并补充 R&D ratio。

**Layout Notes.** 左侧毛利率趋势图，右侧机制说明。

### S06 | 地区表现
```yaml slide_spec
slide_id: "S06"
title: "美欧日及亚太恢复支撑增长，大中华区延续承压"
reader_question: "地区维度的增长质量如何？"
page_task: "compare"
reading_mode: "decision"
archetype: "comparison-matrix"
asset_mode: "mixed"
validation_mode: "preview_only"
key_message: "FY2025 Greater China 收入同比下降 3.8%，其他主要地区均增长"
required_assets: ["apple_region_net_sales_fy2021_fy2025.csv"]
```

**Narrative Role.** 呈现地区结构与风险暴露。

**Content Notes.** 地区收入和同比矩阵，重点标出 Greater China 的连续下滑。

**Layout Notes.** 左侧排序条形图，右侧地区风险与观察变量。

### S07 | 现金流与资本回报
```yaml slide_spec
slide_id: "S07"
title: "自由现金流仍然厚实，资本回报维持高强度"
reader_question: "利润是否转化为真实现金流，资本配置是否稳定？"
page_task: "evidence"
reading_mode: "decision"
archetype: "chart-spotlight"
asset_mode: "office-chart-native"
validation_mode: "chart_editable"
key_message: "FY2025 自由现金流约 987.7 亿美元，回购与分红合计约 1061.3 亿美元"
required_assets: ["apple_financials_fy2021_fy2025.csv"]
```

**Narrative Role.** 证明 Apple 的现金创造和股东回报能力。

**Content Notes.** 展示经营现金流、自由现金流、回购与分红。

**Layout Notes.** 双柱图 + 现金回报说明卡片。

### S08 | 资产负债表
```yaml slide_spec
slide_id: "S08"
title: "净现金收敛但仍为正，资产负债表保持弹性"
reader_question: "财务安全边际是否仍然充足？"
page_task: "evidence"
reading_mode: "decision"
archetype: "chart-spotlight"
asset_mode: "office-chart-native"
validation_mode: "chart_editable"
key_message: "FY2025 现金及可出售证券约 1324.2 亿美元，净现金约 337.6 亿美元"
required_assets: ["apple_financials_fy2021_fy2025.csv"]
```

**Narrative Role.** 补充偿债和资本配置边界。

**Content Notes.** 展示现金及可出售证券、债务、净现金的五年变化。

**Layout Notes.** 条形图 + 观察要点。

### S09 | 关键观察变量
```yaml slide_spec
slide_id: "S09"
title: "后续跟踪重点落在 AI 终端、服务生态和区域竞争"
reader_question: "财报之后应跟踪哪些变量？"
page_task: "explain"
reading_mode: "guided"
archetype: "decision-logic"
asset_mode: "diagram-visual"
validation_mode: "diagram_visual"
key_message: "FY2025 财务质量较强，但增长再加速需要产品周期与服务生态共振"
required_assets: []
```

**Narrative Role.** 从财务结果过渡到后续研究框架。

**Content Notes.** 三条主线：AI 终端换机、Services monetization、China/监管/供应链。

**Layout Notes.** 三列逻辑框架，不用复杂 connector。

### S10 | 风险声明
```yaml slide_spec
slide_id: "S10"
title: "风险声明：强现金流不消除经营、监管和估值波动风险"
reader_question: "这份点评的风险边界是什么？"
page_task: "archive"
reading_mode: "reference"
archetype: "appendix-dense"
asset_mode: "table-native"
validation_mode: "preview_only"
key_message: "核心风险包括创新周期、竞争、区域需求、监管、汇率、税务和市场风险"
required_assets: []
```

**Narrative Role.** 按正式研报习惯集中列示风险。

**Content Notes.** 风险按经营、外部环境、财务市场和数据口径四组展开。

**Layout Notes.** 原生表格，信息密度高但保持可读。

### S11 | 免责声明与来源
```yaml slide_spec
slide_id: "S11"
title: "免责声明与数据来源"
reader_question: "材料的合规边界和可复核来源是什么？"
page_task: "archive"
reading_mode: "reference"
archetype: "appendix-dense"
asset_mode: "table-native"
validation_mode: "preview_only"
key_message: "仅供学术交流使用，不代表任何组织机构，机构和个人的观点和立场"
required_assets: ["sources.md", "apple_10k_sources.csv"]
```

**Narrative Role.** 明确学术交流、非评级、非投资建议和数据来源。

**Content Notes.** 放完整免责声明、SEC API、五份 10-K 链接摘要和脚本输出路径。

**Layout Notes.** 左侧免责声明，右侧来源表。
