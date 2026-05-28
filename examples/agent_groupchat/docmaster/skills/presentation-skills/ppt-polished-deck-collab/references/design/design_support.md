# Design Support

**这份文档的定位。** 本文定义 `ppt-polished-deck-collab` 的设计支持体系，回答“这页该做成什么 archetype、该用什么图表或图形、标题该怎么说、什么时候该用 diagram / chart / table / icon / 纯语言”。它是 skill 的设计总索引，不负责替代更细的视觉规则文档。

## 目录

- 设计支持的边界
- 页面任务总表
- Archetype 与资产选择表
- profile-aware 页面决策
- 图表选择查表
- Diagram 选择查表
- 语言选择查表
- 什么时候该用 icon
- 什么时候该优先用语言
- 与现有设计细则的衔接
- 下一步设计扩展清单

## 什么时候先读它

**当你已经知道 deck 要讲什么，但还没决定每页应该如何阅读和呈现时，先读这份文档。** 它先回答“页面应该长成什么”，再把你路由到更细的设计细则。

## 设计支持的边界

**设计支持回答表达问题。** 它关心 reader question、page task、reading mode、archetype、证据形式、语言密度和视觉主次。

**设计支持不替代技术支持。** “这页适合原生 Office chart 还是 Python figure”先是设计选择，再交给技术支持去决定 SDK、脚本和验证方式。

**这些资产路线应主动向人类公开。** agent 不应把 `icon system`、原生 `Office chart`、`Python figure`、diagram 和原生表格当成内部实现细节，而应在页面规划或初稿 review 时明确告诉人类这些能力可用，让人类按需反馈和选择。

**页面决策要继承 deck contract。** 同一个 reader question 在 `self-contained_reading_deck` 里可能需要完整注释和来源，在 `speaker-led_stage_deck` 里可能只需要一个强记忆点。不要只凭 archetype 名称决定密度和风格。

## 页面任务总表

| `page_task` | 读者真正要解决的问题 | 推荐 `reading_mode` | 推荐 archetype | 优先资产 | 标题语言模式 |
| --- | --- | --- | --- | --- | --- |
| `persuade` | 我现在应该支持哪种判断或动作 | `decision` | `decision-logic` / `board-memo` | 比较矩阵、关键证据图、结论卡片 | 直接写判断句 |
| `explain` | 这件事为什么会这样、怎么运转 | `guided` | `research-note` / `process-flow` | 机制图、流程图、注释式结构图 | 写机制与因果 |
| `compare` | 这些选项的差别和权衡是什么 | `reference` / `decision` | `comparison-matrix` | 对比表、对比条形图、权衡矩阵 | 写结论 + 比较维度 |
| `evidence` | 证据是否支持这个观点 | `decision` | `chart-spotlight` | 原生图表、研究图、证据卡片 | 写核心发现 |
| `archive` | 需要查阅哪些细节 | `reference` | `appendix-dense` | 表格、补充图、明细列表 | 写范围和用途 |

## Archetype 与资产选择表

| Archetype | 页面角色 | 优先资产 | 最适合的语言密度 | 常见误用 |
| --- | --- | --- | --- | --- |
| `hero-statement` | 定调、开场、章节锚点 | 结论句、数字、高冲击图形 | 低 | 塞成一页摘要附录 |
| `decision-logic` | 管理层判断、路线选择 | 决策树、比较矩阵、关键证据 | 中 | 变成散点式 bullet 页 |
| `board-memo` | 摘要同步、管理层 brief | 摘要卡片、进展、风险、next step | 中 | 每块都一样重，没有主判断 |
| `research-note` | 机制解释、研究表达 | 结构图、注释图、局部图表 | 中到高 | 同时塞入太多平级结论 |
| `war-room-board` | 现场感、链路追踪 | 时序、状态、行动人、blocker | 中到高 | 变成没有主线的 dashboard |
| `process-flow` | 顺序、阶段、handoff | 流程图、泳道图、journey | 中 | 为了炫技硬上复杂网络图 |
| `chart-spotlight` | 用一张主图支撑一个结论 | 单主图 + 注释 + takeaways | 中 | 一页塞多张图没有主结论 |
| `comparison-matrix` | 比较、取舍、优劣 | 矩阵、表格、对比条形图 | 中 | 退化成普通 bullet 列表 |
| `appendix-dense` | 备查、存档 | 表格、密集图、明细 | 高 | 用附录页承担主叙事 |

## profile-aware 页面决策

**先继承 profile 坐标。** 页面决策不得只看 `visual_profile`。同样是 `editorial_ink`，`speaker-led_stage_deck + keynote_story + low_density_stage` 应把页面做成背景、记忆点和视觉锚点；`hybrid_review_deck + research_review + balanced_brief` 则需要保留证据、来源、单位和必要解释。

**商业汇报默认走清晰稳定。** `business_report + corporate_clear` 可以使用多形状、多图表、多表格和复杂注释，但每页仍需要明确主判断、稳定标题区和可编辑对象。

**强设计感 deck 默认走节奏和主视觉。** `keynote_story + editorial_ink / swiss_modernist / product_launch` 可以降低正文密度，使用强图片槽、巨大数字、硬网格和留白，但不能牺牲基本可读性和最终 preview 验证。

**设计感研究 deck 要融合 domain 纪律。** 当 `communication_profile=research_review` 且 `visual_profile=editorial_ink/swiss_modernist` 时，不要把它改造成纯舞台海报。图表页、数据页和来源页仍要继承 `domain_profile` 的图号、单位、来源注、免责声明、表格语义和可追责边界。

**无人讲解材料默认补足上下文。** `self-contained_reading_deck` 的图表需要单位、来源、注释、边界条件和必要解释。页面可以更密，但必须方便扫描和复读。

**有人讲的材料默认降低页面负担。** `speaker-led_stage_deck` 的页面应减少正文和表格，把复杂解释移到讲稿、备注或备份页。页面本身负责节奏、记忆点和视觉锚点。

**页面合同应写清 layout 与节奏。** 复杂任务建议显式填写 `layout_recipe` 和 `rhythm_role`，例如 `chart-spotlight-with-takeaways`、`business-summary-grid`、`image-hero-strip`、`technical-layered-architecture`、`editorial-product-mix-strip`、`editorial-big-number`、`swiss-kpi-tower`，以及 `opener`、`breath`、`dense`、`evidence`、`transition`、`closing`。

## 图表选择查表

| 你想表达的证据 | 推荐图表 / 视觉形式 | 最适合的页面 archetype | 标题应像什么 | 应避免什么 |
| --- | --- | --- | --- | --- |
| 时间趋势、阶段变化 | 折线图、斜率图、时间条 | `chart-spotlight` | “X 在 Y 之后出现拐点” | 用饼图讲时间变化 |
| 类别比较、方案高低 | 条形图、柱状图、点图 | `chart-spotlight` / `comparison-matrix` | “A 在三个关键维度上领先” | 类别过多还强行竖柱 |
| 排名、Top N | 排序条形图、lollipop | `chart-spotlight` | “前两项贡献了主要差异” | 不排序导致读者自己找排名 |
| 构成关系、份额 | 堆叠条形图、100% 堆叠、瀑布图 | `chart-spotlight` | “份额变化主要来自 X” | 默认使用饼图 |
| 分布、离散程度 | 直方图、箱线图、密度图 | `research-note` | “分布呈双峰，均值不代表真实情况” | 用平均值掩盖分布结构 |
| 相关性、聚类 | 散点图、二维嵌入图 | `research-note` | “样本分成两簇，异常点集中在右上” | 用条形图讲相关性 |
| before / after | 双列对比、差值条、small multiples | `comparison-matrix` | “调整后最大改善出现在 X” | 把 before 和 after 混在一张难读图里 |
| 流程阶段、转化漏斗 | 漏斗图、阶段条、路径图 | `process-flow` / `chart-spotlight` | “流失主要发生在第二阶段” | 把流程和组织结构图混在一起 |
| 系统架构、依赖关系 | 分层架构图、依赖图、dataflow | `research-note` / `process-flow` | “系统主路径由三层协作完成” | 一上来画 hairball 网络图 |
| 决策取舍、能力对比 | 对比矩阵、评分表、象限图 | `decision-logic` / `comparison-matrix` | “方案 B 在可维护性和速度之间最平衡” | 用纯 bullet 隐式比较 |
| 主视觉和场景情绪 | 真实图片、授权图、GPT 生图 | `hero-statement` / `research-note` | “先用标题承载观点，图片只做视觉锚点” | 让图片生成精确数字或长文字 |

## Diagram 选择查表

| 你想讲的结构 | 推荐图形 | 什么时候最合适 | 不合适的情况 |
| --- | --- | --- | --- |
| 稳定层次、系统分层 | Layered architecture | 架构总览、平台能力、责任边界 | 节点之间交互太频繁且同层很多 |
| 数据经过哪些阶段 | Dataflow / pipeline | ETL、RAG、训练 / 推理流程 | 读者更关心组织责任而不是数据流 |
| 谁和谁交接 | Handoff flow / journey | 运营交接、Agent tool routing、审批流 | 节点关系不是顺序而是依赖网络 |
| 谁依赖谁 | Dependency map | roadmap、模块依赖、交付关系 | 读者只需要单一路径解释 |
| 为什么会产生某个结果 | Causal / mechanism sketch | 研究机制、error analysis、agent memory 机制 | 没有明确因果，只是结构并列 |

## 语言选择查表

| 页面角色 | 推荐标题语言 | 推荐正文语言 | 不推荐语言 |
| --- | --- | --- | --- |
| 管理层判断页 | 判断句、结论句、动作句 | 只保留支撑判断的证据 | 只有主题名词没有结论 |
| 研究解释页 | 机制句、因果句、条件句 | 用注释解释图中关系 | 大段抽象术语堆叠 |
| 图表证据页 | 发现句、变化句、对比句 | 图旁只写关键发现，不复述所有数据 | 标题只写 “Results” |
| 比较页 | 取舍句、优劣句、适用场景句 | 每个维度都有明确评判标准 | 把结论藏在脚注 |
| 附录页 | 范围句、数据来源句、索引句 | 保留检索友好表达 | 仍然使用强结论语言 |

## 什么时候该用 icon

**icon 适合做节奏增强。** 标题旁、摘要卡片、章节锚点、轻语义提示都适合使用 icon。

**icon 不适合承载主信息。** 当页面的核心是趋势、比较、流程、机制、架构或证据时，icon 不能替代图表、diagram 和语言本体。

## 什么时候该优先用语言

**判断页优先用语言。** 当页面的核心价值是“让人立刻记住一句判断”，标题和关键句的价值高于额外图形。

**图表页也先写结论再放图。** 图本身不是 message，图是证据，message 必须先由标题和注释明确说出来。

**比较页优先显式矩阵、原生表格或明确对比图。** 当页面任务是 `compare`，应优先让比较关系被显式看见。数据型比较适合原生表格，轻决策矩阵也可以用卡片矩阵或对比图，不应退化成 bullet 列表或 shape 伪表格。

## 与现有设计细则的衔接

**页面视觉底线继续看 `references/design/slide_design_system.md`。** 它负责标题区、网格、留白、颜色预算、fatal / warning / preference 的复核底线。

**强设计感 native PPTX 的页面语法也看 `references/design/slide_design_system.md`。** 它负责把 `editorial_ink`、`swiss_modernist` 这类 visual profile 翻译成 PowerPoint 原生对象可执行的 `layout_recipe`、主题节奏和 visual review 规则。

**diagram 的专项图形语法继续看 `references/modules/diagram_support.md`。** 它负责层级图、dataflow、dependency map、edge budget 和 connector / visual 两条路线。

**原生 Office chart 的使用边界继续看 `references/modules/office_chart_support.md`。** 它负责什么时候优先保 editable chart，以及当前 helper 怎么落地。

**Python figure 的使用边界继续看 `references/modules/python_figure_support.md`。** 它负责哪些研究图和高密度图适合直接用 Python 生成高 DPI 图片。

**icon 细则继续看 `references/modules/icon_system.md`。** 它负责 family、registry、自动着色和 icon 作为辅助资产的使用边界。

**GPT 生图和 prompt-driven 图片继续看 `references/modules/image_generation_support.md`。** 它负责图片 slot、prompt、backend、安全区和事实复核。

## 下一步设计扩展清单

**下一步最值得补的是三类设计知识。**
- 更细的系统架构图、复杂 diagram、研究机制图图形语法模板
- 原生 Office chart 的版式模板与注释语言模板
- Python figure 的页面组合模板和 research-note 套路

**这些扩展都应继续服从同一原则。** 先从 `reader_question -> page_task -> archetype -> asset choice -> language pattern` 推导页面，再决定具体工具和代码。
