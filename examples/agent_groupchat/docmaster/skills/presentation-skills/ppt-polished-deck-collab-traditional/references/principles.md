# Principles

**这份文档的定位。** 本文定义 `ppt-polished-deck-collab` 的核心业务逻辑与开发逻辑，并给出 references 的分层地图，让后续 workflow、page design、build route 和脚本都共享同一套对象定义。

## 核心对象

**`deck` 是最小业务对象。** `deck` 是围绕单一沟通任务组织起来的一组页面。它的核心问题是“这套材料要让谁在什么场景下理解、判断、行动”，不是“我能不能先画一张图”。

**`template` 是页面系统对象。** 当用户给一个参考 `pptx` 时，它承载的是封面页族、内容页族、末页页族、母版元素、layout 占位和字号梯度。它默认不是配色灵感板。

**`brief.md` 是最小全局任务文档。** 它只负责 deck 级别不会频繁变化的事实，例如目标读者、使用场景、交付标准、品牌约束、验证要求和主题边界。

**`deck_narrative.md` 是最小人类主文档。** 它统一承载全局叙事、核心判断、每页 reader question、页面意图、文案想法和版式设想。对默认 workspace 而言，这份文档是人类长期维护的 canonical narrative source。

**`slide_spec` 是派生出来的机器页面对象。** 每一页都应先定义 `reader_question`、`page_task`、`reading_mode`、`archetype`、`asset_mode`、`validation_mode`。这些字段仍然是页面构建的主键，但默认不再手工维护一份独立文档，而是从 `deck_narrative.md` 派生出来。

**`validation_bundle` 是最小验收对象。** 完整交付至少包含可编辑 `pptx`、逐页预览图、结构校验结果与必要的人工复核记录。没有验证证据的 deck 不算完成。

**`workspace` 是最小协作对象。** 人类与 agent 的长期协作应围绕稳定 workspace 展开，而不是每次生成一棵新的 run 目录。默认 workspace 的职责是让 `brief.md`、`deck_narrative.md`、assets、build、validation 和 final 始终可追溯。

## 文档分层

**核心文档现在分成四份。** 新 skill 的默认核心文档应当是：
- `principles.md`
- `deck_workflow.md`
- `technical_support.md`
- `design_support.md`

**专项文档按需读取。** 只有在需要看更细的实现路线或视觉细则时，才读取：
- `build_routes.md`
- `diagram_support.md`
- `office_chart_support.md`
- `python_figure_support.md`
- `slide_design_system.md`
- `icon_system.md`

**这样设计的原因很直接。** `technical_support` 和 `design_support` 是 skill 级主分层，分别回答“怎么实现”和“怎么表达”；专项文档再回答更细的 backend、视觉网格和 icon 细则。

## 顶层原则

**Deck-first。** 默认从整套 deck 的任务定义出发，再决定哪些页面需要 diagram、chart、icon、table 或纯文字结构。不要让单页复杂图反向支配整套 deck 的组织方式。

**Workspace-first。** 默认先建立稳定工作空间，再往里补页面、资产与脚本。不要把计划、源资产、中间产物和最终交付混在同一层目录。

**Lean-docs-by-default。** 默认只维护 `brief.md` 与 `deck_narrative.md` 两份人类主文档。不要把小型 demo 的全局定位、页面计划、叙事想法和术语说明拆成多份平级文档并长期双写。

**Template-as-system。** 当任务附带参考 `pptx` 时，默认目标是继承同一套页面系统，而不是只模仿颜色和背景。页族、母版元素、layout 占位和字号纪律都属于模板约束。

**Template audit 先于 build route。** 是否走模板改写、`master-first / layout-first` 还是品牌重建，建立在模板取证之上。取证至少覆盖预览页族、layout / master 结构、共享元素归属、真实文字与字号层级、最小 PoC 结论。

**Style / domain profile 先于 narrative。** 没有参考 `pptx` 时，如果用户给的是“仿正式研报”“产品发布会风格”“学术答辩风格”这类文体参考，也应先把 `typography_profile`、`domain_profile`、可借鉴边界、禁止使用的品牌元素和免责声明写进 `brief.md`，再进入页面叙事。

**High-quality 是标准，不是题材。** 这个 skill 服务的是高质量 PPT 交付标准，不限制题材。商业、技术、研究、教育、产品、运营等主题都应适配同一套质量体系。

**技术支持与设计支持显式分层。** `design_support` 负责决定页面如何被读懂、该用什么图表与语言，`technical_support` 负责决定这些设计如何以可编辑、可验证的方式落地。

**Editable-by-default。** 默认优先交付可编辑对象，包括文本、形状、图表和必要的 connector。截图、整页位图和不可维护导出物只能是明确受限场景下的例外。

**Typography 是 deck 级策略。** 在没有品牌模板或既有母版约束时，中英混排 deck 的默认字体策略应在 deck 级 theme tokens 中显式定义，并同时覆盖普通文本、原生表格、Office chart、Python figure 与最终 `pptx` 的字体槽位。默认至少应定义 `hero_title`、`section_title`、`page_title`、`subtitle`、`minor_title`、`body`、`label`、`caption`、`table` 与 paragraph policy。中文任务的全局默认是中文宋体、英文 Times New Roman、正文小四约 `12pt`、首行缩进 2 个中文字符、段前段后各 `0.5` 行、`1.5` 倍正文行距；标题按页面层级适当放大。

**标题和正文的行距职责不同。** 标题类文本的职责是建立阅读节奏、信息层级和视觉锚点，它不是连续阅读段落，因此默认应使用 `1.0` 倍行距，并保留 `0.5` 行的段前与段后空间来控制节奏。正文类文本承担连续阅读与信息吸收，默认应使用 `1.5` 倍行距，不应因为容器紧张就回退到更挤的行距。

**中文默认与风格 profile 分层。** 中文任务默认采用中文 `宋体`、英文 `Times New Roman`。当任务明确要求更现代的产品、运营或品牌展示气质，或参考模板已经形成黑体 / sans-serif 系统时，可以在 style profile 中切换到中文 `黑体`、英文 `Arial`，并把切换原因写入 `brief.md` 或 `deck_narrative.md` 的 theme tokens。

**有模板时先继承字号系统。** 只要参考 `pptx` 已经有稳定的标题、正文、图注、页脚和页码字号梯度，就应优先沿用模板自己的层级。中文正文小四约 `12pt` 是没有明确模板纪律时的回退值；英文或强现代商务 deck 可以按 style profile 使用更大的正文主档位。

**表格排版属于 typography policy。** 中文任务的原生表格默认使用五号约 `10.5pt`、单倍行距、段前段后 `0`、无特殊缩进、单元格上下居中；表头居中，index / 类目列居左，文本列居左，财务数值列靠右。图表下方的数据表、附录表和正文里的明细表都应复用同一套 table policy。

**研报型 deck 是 domain profile。** 财报点评、行业研究、卖方研报和正式研究材料可以启用 `domain_profile: financial_report_review` 或同类 profile。它在 `typography_profile: zh_formal` 与 table policy 之上增加页眉页脚、图号、单位、来源、免责声明、低饱和配色和稳定版心等视觉纪律。

**Validation-by-default。** 预览导出不是可选锦上添花，而是默认要求。diagram 页的结构校验、chart 页的比例与可编辑性检查、模板页的视觉回归都属于基本交付义务。

**Deck-level quality gates 先于 final delivery。** `package_preflight` 负责文件包一致性、移动端兼容风险与外发安全信号；`structure_precheck` 负责结构层的文本边界、遮挡与布局风险；`render_review` 负责预览导出后的边界触墨与扁平化图像内部风险。它们共同构成 final delivery 前的质量 gate。

**Visual review 是 final 前证据。** 自动 gate 通过只证明没有触发对应规则的失败信号，不证明页面已经符合目标文体。final 前必须看逐页 preview 或 contact sheet，并记录 fatal / warning / preference 结论；中文正式材料还应检查 typography profile 与 table profile 是否兑现。

**Correct-failure。** 缺少依赖、环境不满足、模板结构不稳定、页数不匹配、connector 非真绑定时，应明确失败并暴露原因。禁止静默降级和“看起来差不多”的自我安慰。

## 页面层原则

**先定义页面任务，再谈视觉。** 一页首先要回答它是 `说服`、`解释`、`比较`、`证据` 还是 `存档`。只有任务清楚，阅读方式、信息密度和页面原型才有稳定依据。

**一页只选一个主原型。** 一页可以混合图、数、文，但不应同时承担两个主 archetype。`decision logic` 页不应偷偷兼做 dashboard，`war-room board` 也不应再塞成 appendix。

**原型比模板更重要。** archetype 是稳定的页面语法，模板只是某个视觉实例。skill 应优先沉淀 archetype，而不是堆积大量长得不一样但逻辑重复的样板页。

**强模板任务先继承再映射原型。** archetype 仍然决定页面任务，但封面、正式页、章节页和末页要先落到模板已有页族，再在该页族内完成表达。

## 资产层原则

**资产按类型平级组织。** diagram、chart、icon、image、table 都是合法源资产。不要再让 Mermaid 冒充所有页面的默认起点。

**icon 是可选增强资产。** icon 的职责是给 section、卡片和弱语义提示增加节奏感，不是每套 deck 的必需输入，也不是信息主载体。

**数据表语义优先原生 table。** 只要页面本质是在展示结构化数据、行列关系、明细表头或附录数据，优先使用 Office 原生表格。shape grid 只应用在真正不是数据表语义的卡片阵列、视觉分组或轻量比较矩阵。

**图表与 diagram 都应先归类再实现。** `office-chart-native`、`python-figure-image`、`diagram-connector`、`diagram-visual` 这些类型必须在 `slide_spec.asset_mode` 中显式表达，不能在脚本里临时决定。

**技术路线按场景选择。** 空白页直生、模板改写、品牌重建、PowerPoint 预览导出、LibreOffice 预览导出都可以成立。skill 应给出选择标准，而不是写死唯一通道。

**图页是专项能力，不是默认入口。** 复杂 diagram 是 skill 的强能力之一，但它只是 deck 的某一页类型。不要让所有任务都退化成复杂图任务。

## 文档层原则

**`SKILL.md` 只保留核心工作流。** 触发条件、默认工作流、资源路由和最小命令留在 `SKILL.md`。详细规范与路线说明进入 `references/`。

**`references/` 承载真正的 requirements 与方法论。** requirements、技术路线、视觉系统、页面原型、模板和环境基线都应进入 `references/`，并由 `SKILL.md` 明确指向。

**机器执行入口应从叙事文档派生。** `slide_specs.yaml` 仍然是 build 友好的结构化对象，但默认应当由 `deck_narrative.md` 自动派生，而不是要求人类长期手工维护第三份平行文档。

**规范文档必须能单独工作。** 一个不了解 `demo_draft` 的 agent，只看新 skill 的 `references/`，也应能理解 deck 如何规划、如何生成、如何验证。

## 交付底线

**最低交付物。** 一次完整 deck 任务至少要有 `brief.md`、`deck_narrative.md`、派生 `slide_specs.yaml`、可编辑 `pptx`、逐页预览图、验证结果和 final 前 visual review 结论。

**最低可读性。** 弱信息不能抢标题区，正文与背景必须高对比，同类对象必须挂到公共网格，一页必须存在清晰的第一视觉中心。

**最低可维护性。** 后续需要迭代的节点、图表、文本和品牌元素应尽量保持可编辑。对于 connector 页面，必须能回答“拖动后是否仍然绑定”。
