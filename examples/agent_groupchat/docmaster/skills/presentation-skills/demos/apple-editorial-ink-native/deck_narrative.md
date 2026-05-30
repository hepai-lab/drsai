---
deck:
  title: "Apple 2021-2025 财报解读 · Editorial Ink Native Test"
  audience: "内部 skill 测试与财务材料审阅者"
  scenario: "原生 PPTX 风格迁移测试"
  objective: "验证 guizang HTML 电子杂志风能否迁移到可编辑、可验证的 native PowerPoint deck"
  source_context: "no_template"
  delivery_context: "hybrid_review_deck"
  communication_profile: "research_review"
  visual_profile: "editorial_ink"
  density_profile: "balanced_brief"
  editability_profile: "fully_editable"
  template_file: null
  theme_tokens:
    typography_profile: "editorial_ink_zh"
    domain_profile: "financial_report_review"
    hero_title_font_pt: 54
    section_title_font_pt: 34
    page_title_font_pt: 25
    subtitle_font_pt: 16
    minor_title_font_pt: 13
    body_font_pt: 11.5
    label_font_pt: 9.5
    caption_font_pt: 7.5
    title_line_spacing_multiple: 1.0
    body_line_spacing_multiple: 1.35
    title_paragraph_space_lines: 0.2
    body_paragraph_space_lines: 0.2
    latin_font_name: "Times New Roman"
    east_asia_font_name: "Songti SC"
    sans_font_name: "Helvetica Neue"
    mono_font_name: "Menlo"
    table_font_pt: 10.5
    table_line_spacing_multiple: 1.0
    table_paragraph_space_lines: 0
    table_header_alignment: "center"
    table_index_alignment: "left"
    table_text_alignment: "left"
    table_numeric_alignment: "right"
    canvas_width_in: 13.333
    canvas_height_in: 7.5
    left_margin_in: 0.56
    right_margin_in: 12.78
---

# Apple 2021-2025 财报解读 · Editorial Ink Native Test

## Global Narrative
- 这套 deck 的主判断：FY2025 是 Apple 从 2023 收缩区间走回新高的一年，收入、净利润和综合毛利率同步恢复，但恢复质量仍由 Services、高端 iPhone 与现金流共同支撑。
- 这套 deck 的风格目标：把 guizang HTML 的电子杂志大标题、深浅页面节奏、等宽元数据、ghost numerals、细线与流体背景感迁移为 PowerPoint 原生文本、形状、线条和表格。
- 这套 deck 的测试重点：不依赖 HTML 截图，尽量保持文本、图形、表格和数据图形可编辑，并用 preview 和 quality gates 验证。
- 这套 deck 的禁区：不使用 Apple logo，不做投资评级、目标价或买卖建议，不使用未在数据底稿出现的事实。

### S01 | 封面
```yaml slide_spec
slide_id: "S01"
title: "Apple 2021-2025 财报解读"
reader_question: "这份测试 deck 的研究对象、风格目标和数据边界是什么？"
page_task: "persuade"
reading_mode: "scan"
archetype: "hero-statement"
asset_mode: "text-layout-native"
validation_mode: "preview_only"
key_message: "一台现金机器在 FY2025 重新点亮增长曲线"
asset_slots:
  - slot_id: "s01_editorial_cover"
    asset_type: "native_text_and_shape"
    module: "text-layout-native"
    backend: "python-pptx"
    validation_mode: "preview_only"
    status: "ready"
```

**Narrative Role.** 封面定调为艺术化财报解读测试，强调 FY2021-FY2025、SEC/10-K 数据与非投资建议边界。

**Layout Notes.** 深靛蓝整页、超大衬线标题、右侧关键数字矩阵、ghost `25` 与流体线条背景。

### S02 | 核心判断
```yaml slide_spec
slide_id: "S02"
title: "FY2025 的恢复不是单点反弹，而是利润率、服务化与现金流共同支撑"
reader_question: "读者应该先记住哪几个高层判断？"
page_task: "persuade"
reading_mode: "decision"
archetype: "board-memo"
asset_mode: "mixed"
validation_mode: "preview_only"
key_message: "收入创新高、净利润重回千亿美元、综合毛利率继续上行，但 Greater China 与产品周期仍是观察变量"
asset_slots:
  - slot_id: "s02_financial_kpis"
    asset_type: "native_kpi_cards"
    module: "text-layout-native"
    backend: "python-pptx"
    validation_mode: "preview_only"
    status: "ready"
    input_files:
      - "data/processed/apple_financials_fy2021_fy2025.csv"
      - "data/processed/apple_region_net_sales_fy2021_fy2025.csv"
```

**Narrative Role.** 用一页把全部财务判断压缩成“结果、机制、风险、下一步”的管理层摘要。

**Layout Notes.** 纸色底、左侧 answer title 和短段落，右侧四张杂志式 KPI 卡，底部一条五年时间轴。

### S03 | 收入与利润
```yaml slide_spec
slide_id: "S03"
title: "收入创五年新高，净利润恢复到 1120 亿美元"
reader_question: "FY2025 的收入与利润位置是否足够强？"
page_task: "evidence"
reading_mode: "decision"
archetype: "chart-spotlight"
asset_mode: "mixed"
validation_mode: "preview_only"
key_message: "FY2025 收入同比增长 6.4%，净利润同比增长 19.5%，恢复强度明显高于 FY2024"
asset_slots:
  - slot_id: "s03_revenue_profit_shape_chart"
    asset_type: "native_shape_chart"
    module: "text-layout-native"
    backend: "python-pptx"
    validation_mode: "preview_only"
    status: "ready"
    input_files:
      - "data/processed/apple_financials_fy2021_fy2025.csv"
```

**Narrative Role.** 用五年趋势证明 FY2025 的恢复有连续数据支撑。

**Layout Notes.** 大数字页，左侧巨型 `416.2B`，右侧原生 shape 柱线图，底部列出 revenue / net income / margin。

### S04 | 产品结构
```yaml slide_spec
slide_id: "S04"
title: "iPhone 仍是收入中枢，Services 是最稳定的第二曲线"
reader_question: "收入增长来自哪些产品线？"
page_task: "evidence"
reading_mode: "guided"
archetype: "chart-spotlight"
asset_mode: "mixed"
validation_mode: "preview_only"
key_message: "FY2025 iPhone 收入约 2096 亿美元，Services 收入约 1092 亿美元并同比增长 13.5%"
asset_slots:
  - slot_id: "s04_product_mix_shape_chart"
    asset_type: "native_shape_chart"
    module: "text-layout-native"
    backend: "python-pptx"
    validation_mode: "preview_only"
    status: "ready"
    input_files:
      - "data/processed/apple_product_net_sales_fy2021_fy2025.csv"
```

**Narrative Role.** 拆产品线，解释增长依赖与服务化逻辑。

**Layout Notes.** 深色正文页，横向 stacked strip 表示 FY2025 产品收入构成，旁边用五年小趋势展示 iPhone 和 Services。

### S05 | 毛利率引擎
```yaml slide_spec
slide_id: "S05"
title: "Services 的 75.4% 毛利率继续抬升整体质量"
reader_question: "利润率改善的结构性来源是什么？"
page_task: "explain"
reading_mode: "guided"
archetype: "research-note"
asset_mode: "mixed"
validation_mode: "preview_only"
key_message: "Services 毛利率比 Products 高约 38.6pct，综合毛利率五年提升 5.1pct"
asset_slots:
  - slot_id: "s05_margin_mechanism"
    asset_type: "native_shape_chart"
    module: "text-layout-native"
    backend: "python-pptx"
    validation_mode: "preview_only"
    status: "ready"
    input_files:
      - "data/processed/apple_gross_margin_by_type_fy2021_fy2025.csv"
      - "data/processed/apple_financials_fy2021_fy2025.csv"
```

**Narrative Role.** 解释利润率韧性来自 Services mix 与高毛利生态。

**Layout Notes.** 纸色页，三条毛利率趋势线用原生线条和节点绘制，右侧机制卡片展示 Products / Services split。

### S06 | 地区结构
```yaml slide_spec
slide_id: "S06"
title: "美欧日及亚太扩张，大中华区仍是结构性压力点"
reader_question: "地区维度的增长质量和风险暴露如何？"
page_task: "compare"
reading_mode: "decision"
archetype: "comparison-matrix"
asset_mode: "mixed"
validation_mode: "preview_only"
key_message: "FY2025 Greater China 收入同比下降 3.8%，其他主要地区均为正增长"
asset_slots:
  - slot_id: "s06_region_bar_matrix"
    asset_type: "native_shape_chart"
    module: "text-layout-native"
    backend: "python-pptx"
    validation_mode: "preview_only"
    status: "ready"
    input_files:
      - "data/processed/apple_region_net_sales_fy2021_fy2025.csv"
```

**Narrative Role.** 呈现地区结构，不把总体增长误读成所有区域同步向上。

**Layout Notes.** 横向排序条形图 + 同比色条，Greater China 用胭脂红强调，其他地区用低饱和铜金 / 青绿。

### S07 | 现金机器
```yaml slide_spec
slide_id: "S07"
title: "自由现金流仍厚，资本回报强度没有明显退场"
reader_question: "利润是否转化为现金，资本配置是否维持稳定？"
page_task: "evidence"
reading_mode: "decision"
archetype: "chart-spotlight"
asset_mode: "mixed"
validation_mode: "preview_only"
key_message: "FY2025 自由现金流约 987.7 亿美元，回购与分红合计约 1061.3 亿美元"
asset_slots:
  - slot_id: "s07_cash_return_shape_chart"
    asset_type: "native_shape_chart"
    module: "text-layout-native"
    backend: "python-pptx"
    validation_mode: "preview_only"
    status: "ready"
    input_files:
      - "data/processed/apple_financials_fy2021_fy2025.csv"
```

**Narrative Role.** 用 cash flow 与 capital return 解释 Apple 的财务底座。

**Layout Notes.** 深色页，左侧现金流大数字，右侧两组柱形对比，底部小注释说明资本回报口径。

### S08 | 数据管线
```yaml slide_spec
slide_id: "S08"
title: "从 SEC 原始披露到页面判断，数据链路必须可复跑"
reader_question: "这套 PPT 的数据如何从来源流到页面？"
page_task: "explain"
reading_mode: "guided"
archetype: "process-flow"
asset_mode: "diagram-visual"
validation_mode: "diagram_visual"
key_message: "数据管线由 SEC companyfacts、10-K HTML 表格抽取、处理后 CSV、页面合同和 native PPTX 构建组成"
asset_slots:
  - slot_id: "s08_data_pipeline"
    asset_type: "diagram_visual"
    module: "diagram-visual"
    backend: "python-pptx"
    validation_mode: "diagram_visual"
    status: "ready"
    input_files:
      - "data/processed/sources.md"
```

**Narrative Role.** 回应测试任务中“参考 apple-financial-report-review 数据管线”的要求，展示但不复用旧 PPT 表现。

**Layout Notes.** 原生流程图，无复杂 connector，重点是 stage、artifact 和质量 gate。

### S09 | 后续观察变量
```yaml slide_spec
slide_id: "S09"
title: "财务质量已经修复，再加速要看 AI 终端、服务生态与区域竞争"
reader_question: "财报之后应继续观察哪些变量？"
page_task: "explain"
reading_mode: "guided"
archetype: "decision-logic"
asset_mode: "diagram-visual"
validation_mode: "diagram_visual"
key_message: "下一段增长需要产品周期与服务生态共振，同时管理监管与区域竞争压力"
asset_slots:
  - slot_id: "s09_watchlist_framework"
    asset_type: "diagram_visual"
    module: "diagram-visual"
    backend: "python-pptx"
    validation_mode: "diagram_visual"
    status: "ready"
```

**Narrative Role.** 从历史财务转入未来研究框架。

**Layout Notes.** hero light 问题页，三条观察主线用大号编号和极简卡片表达。

### S10 | 来源与风险
```yaml slide_spec
slide_id: "S10"
title: "来源、口径与风险声明"
reader_question: "材料的合规边界、数据来源和风险口径是什么？"
page_task: "archive"
reading_mode: "reference"
archetype: "appendix-dense"
asset_mode: "table-native"
validation_mode: "table_native"
key_message: "本材料仅供学术交流和 skill 测试使用，不构成投资建议"
asset_slots:
  - slot_id: "s10_source_risk_table"
    asset_type: "native_table"
    module: "table-native"
    backend: "python-pptx"
    validation_mode: "table_native"
    status: "ready"
    input_files:
      - "data/processed/sources.md"
      - "data/processed/apple_10k_sources.csv"
```

**Narrative Role.** 收束全 deck，保留可复核来源和风险声明。

**Layout Notes.** 纸色密集页，左侧来源清单，右侧风险矩阵和免责声明。
