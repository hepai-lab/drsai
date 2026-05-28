---
name: ppt-polished-deck-collab
description: Use when collaborating with humans to produce polished, editable, high-quality PPT decks across business, technical, research, education, product, and operations themes. Supports deck planning, slide archetype selection, diagram/chart/icon asset strategy, preview export, and validation for reusable PowerPoint deliverables.
---

# PPT Polished Deck Collab

## 概览
把“讲清楚任务 + 做出高质量页面 + 交付可编辑 PPT + 给出验证证据”作为同一个任务完成。
默认服务的是 **deck 级任务**，不是单页复杂图，也不是只会套模板。
这个 skill 的工作方式是轻量的 deck 编译系统：先把用户需求、模板约束、页面叙事和资产需求收敛成可执行合同，再让图表、Python figure、diagram、icon、图片和生图模块按 slot 生产资产，最后组装原生 `pptx` 并验证。
这个 skill 本身是高质量 PPT 的知识库。agent 必须主动使用里面的规范、经验、脚本和质量 gate；不能聊完需求后凭记忆直接动手，做到一半也不能忘记 deck contract、页面合同、资产 slot、typography / table policy、模板取证和验证链路。

## 核心概念

这些概念是本 skill 的主坐标。外部参考、风格样张和 demo 经验只能进入这些坐标，不能替代它们。

**`deck_contract` 是全局执行合同。** 它记录目标读者、使用场景、目标动作、模板约束、传播方式、材料类型、视觉方向、信息密度、可编辑性、typography / table policy 和验证要求。它通常写在 `brief.md` 或 `deck_narrative.md` frontmatter 里。

**profile 是组合坐标，不是风格孤岛。** `delivery_context` 先判断这份 PPT 是让人自己读、配合现场讲，还是讲完还要转发；`communication_profile` 判断它是商业汇报、技术说明、研究材料还是 keynote 叙事；`visual_profile` 判断视觉语言；`density_profile` 判断信息负载；`editability_profile` 判断可维护性。不要为“个人风格演讲”“设计感研报”另造概念，先用这些已有 profile 组合表达。

**`theme_tokens` 承载 deck 级视觉与排版策略。** `typography_profile` 管字体、字号、段落和表格基础排版；`domain_profile` 管券商研报、财报点评等行业文体纪律；`visual_theme_preset` 可以记录少数经过验证的主题预设。研报纪律和设计感可以叠加，例如 `domain_profile: financial_report_review` 与 `visual_profile: editorial_ink` 可以同时存在。

**`slide_contract` 把页面任务变成页面语法。** 每页至少要有 `reader_question`、`page_task`、`reading_mode`、`archetype`、`asset_mode`、`validation_mode` 和 `key_message`。复杂页再补 `layout_recipe`、`rhythm_role`、`asset_slots`、`visual_constraints` 和 `profile_validation_rules`。

**`layout_recipe` 和 `rhythm_role` 负责设计落地。** `archetype` 说明页面要解决什么问题，`layout_recipe` 说明这页采用什么原生 PPTX 页面配方，`rhythm_role` 说明它在整套 deck 里承担 opener、evidence、breath、transition、dense 或 closing 等节奏角色。强设计感页面也必须通过这两个字段进入主流程。

**`asset_slot` 是所有资产模块的统一接口。** Office chart、Python figure、原生表格、diagram、icon、普通图片和 GPT 生图都先登记为 slot，再由对应模块生产和验证。不要让任何模块绕过 slide contract 直接改 PPT。

**两类常见定位要用同一套概念表达。** 个人风格强烈、有人在旁边讲的演讲通常是 `speaker-led_stage_deck + keynote_story + editorial_ink/product_launch + low_density_stage`，页面主要承载背景、记忆点和视觉锚点。券商研报 / 财报点评通常启用 `research_review + domain_profile: financial_report_review`，要求来源、单位、图号、免责声明、稳定版心和表格语义；如果传播场景偏分享，也可以叠加 `visual_profile: editorial_ink`，但不能取消研报纪律。

## Planning 纪律

如果 agent 使用显式 plan、checklist 或任务追踪，计划必须写成本 skill 的工作范式，而不是泛泛写“制作 PPT / 调整设计 / 检查结果”。

**复杂 deck 的计划骨架应对齐主链路。** 推荐计划项按 `deck_contract -> narrative / slide_contracts -> asset_slots -> build route / native PPTX -> validation / preview -> human checkpoint` 展开。轻量任务可以压缩成两三项，但仍要看得出正在先锁合同、再处理资产、最后验证。

**计划项要使用本 skill 的主对象。** 例如“确认 `deck_contract` 与模板边界”“派生 `slide_contracts`”“登记 `image-generation` / chart / diagram `asset_slots`”“生成 editable `pptx` 并导出 preview”“跑 quality gates 并做 visual review”。如果计划是给用户看的，可以用自然语言解释这些对象，但不要退回到无结构的泛称。

**生图任务也要进入计划。** 需要 GPT 生图时，计划应写清 `image-generation asset_slot -> prompt / API backend -> output_files / metadata -> image_generated review`，不能让生图绕过 slot 合同直接成为页面素材。

**计划状态要随工作更新。** 每完成一个主阶段就更新状态；如果因为缺数据、缺权限、缺 API 或缺预览工具而阻塞，应把对应 slot 或 gate 标记为 `blocked` / `not_checked`，不要用占位文件伪装完成。

## 什么时候用

- 用户要做高质量 PPT、演示稿、汇报 deck、路演稿、研究汇报、技术方案 deck、教学或培训材料。
- 用户希望输出是 **可编辑 `pptx`**，而不是截图拼图或不可维护的导出物。
- 任务需要在流程图、架构图、图表页、证据页、管理层摘要页之间切换，并保持整套 deck 的一致性。
- 任务需要 **预览导出、结构校验、视觉复核**，而不是只生成脚本后口头说“应该可以”。

## 默认工作流

按下面顺序执行，避免把 PPT 任务退化成“边画边想”。

1. **用通俗语言确认需求，不把内部字段抛给用户**
- 先问清这份 PPT 是发给别人自己看懂，还是主要配合现场讲；有没有必须沿用的模板、旧 PPT 或品牌素材；更像商业汇报、技术说明、研究材料，还是发布会 / 分享型演示；后续是否还会频繁改数据、图表或结构。
- 内部可以记录 `source_context`、`delivery_context`、`communication_profile`、`visual_profile`、`density_profile`、`editability_profile`，但对用户应使用自然语言确认。
- 简单任务走轻量路径，不强制完整展开所有合同字段；整套 deck、强模板、多模块资产、正式外发或复杂图表任务才完整使用合同链路。
- 对于正式 deck、模板约束、多模块资产、强风格设计、复杂图表或外发材料，agent 必须按资源路由主动读取相关 reference，并在 build / validation 前回查对应规范。不要只读 `SKILL.md` 就开始画页面。

2. **先锁 source / template，再锁 deck contract**
- 如果用户给了模板、旧 PPT、品牌素材或风格样张，先判断它是 `template_locked`、`template_guided`、`content_migration`、`brand_assets_only` 还是 `no_template`。
- `template_locked` 必须先做模板取证：导出预览图，识别封面页族、正式页族、章节页族和末页页族；读取 slide layout / master；确认共享 logo、页脚、页码、装饰元素属于哪一层；读取真实字号系统；用最小 PoC 验证继承关系。
- 不要把“照着模板做”理解成配色模仿。默认应理解为继承同一套页面系统。
- 如果没有模板但有风格诉求，先锁 style / domain profile、可借鉴边界、禁止品牌元素、免责声明和风险边界。

3. **建立 workspace 与 deck contract**
- 如果用户没有现成 workspace，先按 `references/workflow/deck_workflow.md` 建立 `brief.md`、`deck_narrative.md`、`assets/`、`data/`、`build/`、`validation/`、`final/` 结构。
- `deck_contract` 应记录目标读者、使用场景、目标动作、模板约束、是否自解释、业务类型、视觉方向、信息密度、可编辑性要求、默认 typography / table policy 和验证要求。
- 默认 typography policy 需要显式区分标题类文本与正文类文本：标题类默认 `1.0` 倍行距并保留 `0.5` 行段前 / 段后，正文类默认 `1.5` 倍行距。
- 中文任务在没有模板或品牌约束时，默认采用中文宋体、英文 Times New Roman；正文小四约 `12pt`、首行缩进 2 个中文字符、段前段后各 `0.5` 行、`1.5` 倍行距；表格五号约 `10.5pt`、单倍行距、段前段后 `0`、无特殊缩进、上下居中、表头居中、index / 类目列与文本列居左、财务数值列靠右。
- 有模板时，模板真实字号系统优先于通用默认；中文默认只是无模板、无品牌约束时的回退基线。

4. **收敛 narrative，再派生 slide contracts**
- 先写 `brief.md` 和 `deck_narrative.md`，再派生 `slide_specs.yaml`。叙事必须服从 deck contract，不能绕开模板、传播场景和可编辑性要求重新想象页面。
- 每页至少定义 `reader_question`、`page_task`、`reading_mode`、`archetype`、`asset_mode`、`validation_mode`、`key_message`。
- 需要更完整控制时，再补 `layout_recipe`、`rhythm_role`、`asset_slots`、`visual_constraints`、`profile_validation_rules`。
- source / delivery / communication / visual / density / editability profile 先看 `references/core/style_profiles.md`；页面原型、图表 / diagram / 语言选择再看 `references/design/design_support.md`；页面级视觉底线、强设计感 native PPTX 语法与网格规则再看 `references/design/slide_design_system.md`。

5. **统一做 asset plan，不让模块各自抢入口**
- 所有图表、Python figure、diagram、icon、表格、普通图片和 GPT 生图都通过 `asset_slot` 进入页面。
- 准确数据且会后要改数，优先 `office-chart-native` 或 `table-native`；复杂研究图、热力图、排序图，优先 `python-figure-image`；后续要拖动维护的流程图 / 架构图 / dataflow，走 `diagram-connector`；只服务解释的结构图，走 `diagram-visual`；节奏增强用 `icon-accent`；氛围图、场景图、产品情境图和强风格 hero 图走 `image-generation`。
- GPT 生图有两条 backend：`gpt-image-api` backend 直接生成图片和元数据；`manual-web` backend 由 agent 写出 prompt 文档，标记为 `pending_user_generation`，等用户把图片放回 workspace 后再登记为同一个 slot 的 output。具体命令和参数看 `references/modules/image_generation_support.md`。

6. **再选 build route 与生成 editable PPT**
- 先看 `references/modules/technical_support.md`，明确每个 slot 对应的实现模块、backend 和验证要求。
- 再看 `references/workflow/build_routes.md`，确认当前环境能走哪条具体 backend 路线。
- 优先保留文本、形状、表格、图表和必要 connector 的可编辑性。整页位图和不可维护导出物只能是明确受限场景下的例外。
- 一旦确认某个元素来自母版或 layout，就不要在页面层重复画一份。

7. **强制跑 build 后质量 gate**
- 所有 deck 在 `build` 之后都应先跑 `package_preflight`，检查包结构一致性、移动端兼容风险和外发安全信号。
- 所有 deck 在 `package_preflight` 之后都应再跑 `structure_precheck`，检查文本框 fit、文字遮挡和结构化对象排版边界。
- `not_checked` 必须显式写入报告，不能当成“通过”。

8. **做模块验证、预览和 preview 后质量 gate**
- 所有 deck 都必须导出逐页预览图。
- diagram connector 页必须执行 connector 校验；原生 chart 页必须确认 chart 仍可编辑；Python figure 页必须检查比例、清晰度和字体 / glyph 风险；image-generation 页必须保留 prompt / 参数 / 输出记录并检查图片没有自带页眉页脚、页码、标题栏或事实错误。
- 预览图导出后，应按需要运行 `render_review`，处理结构层看不到的边界触墨和扁平化图像内部风险。
- `render_review` 之后必须看逐页 preview 或 contact sheet 做人工 visual review，复核顺序固定为 `fatal -> warning -> preference`。

9. **完成初稿后给人类一个修订 checkpoint**
- 当 editable `pptx`、预览图、基础 validation 和 visual review 结论都已经齐全时，应把它明确为“可审阅的初稿”，而不是默认继续无限打磨。
- 这时应主动告诉人类：如果需要进入更细的页面级修订，例如逐页措辞微调、视觉节奏重排、icon 补强、chart 路线切换、研究图重绘、生图替换或模板细节对齐，可以继续做，但这一步通常会显著增加 token 消耗。
- 如果人类暂时不需要详细修订，就直接交付当前初稿 bundle；如果人类要继续修订，再围绕具体页面和问题进入下一轮。

## 资源路由

**核心文档**
- 需要统一定义 workspace、deck contract、slide contract、asset slot、validation bundle 和文档分层时，读取 `references/core/principles.md` 与 `references/core/schema_contract.md`。
- 需要决定 source / delivery / communication / visual / density / editability profile 时，读取 `references/core/style_profiles.md`。
- 需要建立 workspace、起草 `brief.md` / `deck_narrative.md`、派生 `slide_specs`、执行主流程和确认验证证据时，读取 `references/workflow/deck_workflow.md`。
- 需要决定页面该用什么 archetype、图表、diagram、语言模式时，读取 `references/design/design_support.md`。
- 需要决定某类 asset slot 该用什么模块、SDK、backend、脚本、验证方式时，读取 `references/modules/technical_support.md`。

**专项文档**
- 需要统一标题区、网格、留白、视觉复核底线时，读取 `references/design/slide_design_system.md`。
- 需要理解 deck 级质量 gate、移动端兼容预检查、结构排版预检查与 validation bundle 时，读取 `references/workflow/quality_gates.md`。
- 需要在模板改写、空白页直生、PowerPoint / LibreOffice 预览导出、diagram connector 路线之间做选择时，读取 `references/workflow/build_routes.md`。
- 需要做系统架构图、dataflow、dependency map、Mermaid 草稿层和 connector 策略时，读取 `references/modules/diagram_support.md`。
- 需要做原生 PowerPoint chart，并判断何时优先保持 editable chart 时，读取 `references/modules/office_chart_support.md`。
- 需要做高 DPI Python figure、研究图、热力图和排序图时，读取 `references/modules/python_figure_support.md`。
- 只有在页面需要额外节奏增强、导航锚点或主题 icon 资产时，才读取 `references/modules/icon_system.md`。
- 需要 GPT 生图、网页端生图 prompt、截图再设计或强风格图片 slot 时，读取 `references/modules/image_generation_support.md`。

## 质量标准

- 默认交付物至少包含：`brief.md`、`deck_narrative.md`、派生 `slide_specs.yaml`、必要 asset slot 记录、可编辑 `pptx`、验证结果、逐页预览图。
- 没有预览图的 deck 不算完成。
- 需要 connector 的页面，没有结构校验结果不算完成。
- 页面风格允许多样，但弱信息、标题层级、网格稳定性和高对比文本是底线。
- 高质量是交付标准，不是题材限制。这个 skill 既可以做商业汇报，也可以做技术、研究、教育、运营等主题。

## 快速命令

```bash
# 1) 检查环境与可用路线
python scripts/check_environment.py

# 2) 对参考模板做取证审计
python scripts/audit_pptx_template.py \
  --pptx <path/to/reference_template.pptx> \
  --json-out <path/to/validation/template_audit/template_audit.json> \
  --md-out <path/to/validation/template_audit/template_audit.md>

# 3) 跑 deck 级 package preflight
python scripts/check_pptx_package_preflight.py \
  --pptx <path/to/deck.pptx> \
  --workspace-dir <path/to/deck_workspace> \
  --fail-on error

# 4) 跑 deck 级 structure precheck
python scripts/check_pptx_structure_precheck.py \
  --pptx <path/to/deck.pptx> \
  --workspace-dir <path/to/deck_workspace> \
  --inventory-out <path/to/deck_workspace/validation/structure_precheck/shape_inventory.json> \
  --fail-on error

# 5) 校验 diagram 页 connector
python scripts/check_pptx_connectors.py \
  --pptx <path/to/deck.pptx> \
  --slide 3 \
  --json-out <path/to/connector_report.json> \
  --min-connectors 1

# 6) 导出逐页预览图
python scripts/export_pptx_previews.py \
  --pptx <path/to/deck.pptx> \
  --out-dir <path/to/ppt_preview> \
  --backend auto

# 7) 跑 preview 后 render review
python scripts/check_pptx_render_review.py \
  --pptx <path/to/deck.pptx> \
  --preview-dir <path/to/ppt_preview> \
  --workspace-dir <path/to/deck_workspace> \
  --fail-on error

# 8) 检查 workspace 关键输入是否齐全
python scripts/lint_deck_assets.py \
  --workspace-dir <path/to/deck_workspace>

# 8b) 检查派生 specs 与 asset slot 合同
python scripts/lint_deck_assets.py \
  --workspace-dir <path/to/deck_workspace> \
  --check-contract

# 9) 从总叙事文档派生 slide specs
python scripts/derive_slide_specs_from_narrative.py \
  --narrative <path/to/deck_narrative.md> \
  --out-yaml <path/to/build/generated/slide_specs.yaml>

# 10) 检查 diagram / chart / python figure 等模块可用性
python scripts/check_environment.py \
  --json-out <path/to/env_check.json>
```

## 额外说明

- 如果任务是“只做复杂图、重点在 connector 维护”，这个 skill 仍然适用，但应把 diagram module 当成专项路线处理，而不是让整个 deck 都退化成复杂图思维。
- 如果用户给了品牌模板或既有 `pptx`，先做模板取证，再在模板改写与 branded rebuild 之间选择，不要机械重做全部页面。
- 如果环境里没有某个推荐工具，应该显式切换到备选路线并记录，而不是静默降级。
