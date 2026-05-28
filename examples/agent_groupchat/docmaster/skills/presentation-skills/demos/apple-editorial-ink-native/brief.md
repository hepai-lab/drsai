# Apple 历年财报解读 · Editorial Ink Native PPT Test

## 任务定义
- 目标读者：用于测试 `ppt-polished-deck-collab` 原生 PPTX 构建能力的内部评审者，默认具备 Finance 和 AI/CS 背景。
- 主使用场景：测试 guizang-ppt-skill 的 HTML 视觉语言迁移到可编辑原生 PowerPoint 的效果，兼顾可复核财务数据展示。
- 目标动作：审阅视觉风格迁移、页面系统、原生对象可编辑性、预览导出与 validation bundle 是否闭环。
- 是否需要无人讲解也能读懂：需要；页面标题直接承载判断，页脚保留数据来源与免责声明。
- 参考模板文件：无可继承 PPTX 模板。
- 模板 / 品牌约束：不使用 Apple logo、机构 logo、受保护品牌素材或可能造成背书误解的标识。
- 交付物要求：`brief.md`、`deck_narrative.md`、派生 `slide_specs.yaml`、可编辑 `pptx`、逐页预览图、质量 gate 结果、visual review 记录。
- 验证要求：运行 workspace lint、package preflight、structure precheck、preview export、render review，并人工查看 contact sheet。

## Deck Contract
- source_context：no_template
- delivery_context：hybrid_review_deck
- communication_profile：research_review
- visual_profile：editorial_ink
- density_profile：balanced_brief
- editability_profile：fully_editable
- typography / table policy：中文标题与重点句使用 Songti SC / Times New Roman 的衬线系统，正文使用 Helvetica Neue / Songti SC；标题类 1.0 倍行距，正文类约 1.35 到 1.5 倍行距；表格使用 10.5pt，表头居中，类目列左对齐，财务数值列右对齐，上下居中。

## 风格与边界
- 风格参考：guizang-ppt-skill Style A “电子杂志 × 电子墨水”，重点迁移大号衬线标题、深色 / 纸色翻页节奏、等宽元数据、巨型数字、细线、ghost numerals、杂志式留白和流体背景感。
- 主题选择：Style A 的“靛蓝瓷”，原生 PPTX 中映射为深靛蓝、瓷白、浅纸灰、铜金强调和少量胭脂红语义色。
- 可借鉴边界：借鉴视觉语言与版式节奏，不复制 HTML 模板源码、不用 WebGL、不把 HTML 页面截图贴进 PPT。
- 允许使用的素材：本 workspace 中的 SEC/Apple 10-K 处理后 CSV、原生 PowerPoint 形状、线条、文本框、表格和必要图形。
- 禁止使用的品牌元素：Apple logo、第三方机构 logo、未授权图片、投资评级、目标价、买卖建议。
- 免责声明 / 风险边界：仅供学术交流和 skill 测试使用，不代表任何组织机构，机构和个人的观点和立场，不构成投资建议。
- 不允许发生的错误：数据与来源不一致、页面标题无判断、文本越界、关键内容被装饰层遮挡、输出缺少预览图或 validation 证据。

## 数据口径
- 财务数据覆盖 FY2021 至 FY2025，FY2025 指 fiscal year ended September 27, 2025，对应 10-K filed October 31, 2025。
- 核心三表指标来自 SEC companyfacts；产品线、地区与 Products / Services 毛利率来自 Apple 10-K HTML 表格抽取结果。
- 金额默认单位为十亿美元，产品线与地区源表原始单位为百万美元，构建脚本统一换算。
- 总债务口径为 commercial paper + current long-term debt + non-current long-term debt。
