---
name: ppt-polished-deck-collab
description: Use when collaborating with humans to produce polished, editable, high-quality PPT decks across business, technical, research, education, product, and operations themes. Supports deck planning, slide archetype selection, diagram/chart/icon asset strategy, preview export, and validation for reusable PowerPoint deliverables.
---

# PPT Polished Deck Collab

## 概览
把“讲清楚任务 + 做出高质量页面 + 交付可编辑 PPT + 给出验证证据”作为同一个任务完成。
默认服务的是 **deck 级任务**，不是单页复杂图，也不是只会套模板。

## 什么时候用

- 用户要做高质量 PPT、演示稿、汇报 deck、路演稿、研究汇报、技术方案 deck、教学或培训材料。
- 用户希望输出是 **可编辑 `pptx`**，而不是截图拼图或不可维护的导出物。
- 任务需要在流程图、架构图、图表页、证据页、管理层摘要页之间切换，并保持整套 deck 的一致性。
- 任务需要 **预览导出、结构校验、视觉复核**，而不是只生成脚本后口头说“应该可以”。

## 默认工作流

按下面顺序执行，避免把 PPT 任务退化成“边画边想”。

1. **先锁 deck 任务与工作空间**
- 明确目标读者、使用场景、页面数量级、交付时间、是否有模板/品牌约束。
- 如果没有参考 `pptx` 但有明确风格参考，先锁 `typography_profile` 与 `domain_profile`，并写清允许借鉴的视觉范式、禁止使用的品牌元素、免责声明和风险边界。
- 如果用户没有现成 workspace，先按 `references/deck_workflow.md` 建立 `brief.md`、`deck_narrative.md`、`assets/`、`data/`、`build/`、`validation/`、`final/` 结构。

2. **有参考 `pptx` 时先做模板取证**
- 先导出模板预览图，识别封面页族、正式页族、章节页族和末页页族。
- 再读 `slide layout` 与 `slide master`，确认哪些元素属于母版、哪些属于 layout、哪些只是页面内容。
- 读取模板里的真实文字与字号层级，至少覆盖封面标题、正式页标题、正文、图注、页脚和页码。中文正文小四约 `12pt` 是无模板约束时的回退基线，英文或现代商务风格可按 style profile 使用更大的正文主档位。
- 用最小 PoC 验证继承关系，例如新建一张 `Blank` layout 页，只放一段普通文本，确认 logo、角标、页码是否自动出现。
- 不要把“照着模板做”理解成配色模仿。默认应理解为继承同一套页面系统。

3. **先收敛 narrative，再做页面**
- 先写 `brief.md`，再在 `deck_narrative.md` 里收敛整套叙事、每页 intent 与页面想法，然后由脚本派生 `slide_specs.yaml`。
- 如果存在强模板，叙事和 `slide_specs` 要围绕模板页族来写，而不是先写一套与模板脱钩的页面想象。
- 默认 typography policy 需要显式区分标题类文本与正文类文本：标题类默认 `1.0` 倍行距并保留 `0.5` 行段前 / 段后，正文类默认 `1.5` 倍行距。
- 中文任务在没有模板或品牌约束时，默认采用中文宋体、英文 Times New Roman；正文小四约 `12pt`、首行缩进 2 个中文字符、段前段后各 `0.5` 行、`1.5` 倍行距；表格五号约 `10.5pt`、单倍行距、段前段后 `0`、无特殊缩进、上下居中、表头居中、index / 类目列与文本列居左、财务数值列靠右。
- `typography_profile` 管字体、字号、段落和表格基础排版；`domain_profile` 管研报、答辩、发布会等题材范式，不要把某个 domain 的配色和版心规则写成所有中文 deck 的默认。
- 在页面规划阶段，应主动告诉人类当前可用的增强资产路线，包括 `icon system`、原生 `Office chart`、`Python figure` 和 diagram 资产。如果人类对图表风格、可编辑性、图标节奏或研究图路线有偏好，应在这一阶段就明确。
- 每页先定义 `reader question`、`page task`、`reading mode`、`archetype`、`asset mode`、`validation mode`。
- 页面原型、图表 / diagram / 语言选择先看 `references/design_support.md`。
- 页面级视觉底线与网格规则再看 `references/slide_design_system.md`。

4. **再选技术路线**
- 先看 `references/technical_support.md`，明确这页对应的实现模块和验证要求。
- 再看 `references/build_routes.md`，确认当前环境能走哪条具体 backend 路线。
- 对强模板任务，优先在 `master-first / layout-first` 与 `branded rebuild` 之间做选择，不要默认重画。
- 不要把某一条路线写死为唯一正解。模板改写、空白页直生、品牌重建、PowerPoint 导出、LibreOffice 导出都可以是有效选项。

5. **再生成 editable PPT**
- 优先保留文本、形状、图表、connector 的可编辑性。
- 不是所有页面都需要 Mermaid，也不是所有 diagram 页都需要 connector。
- 如果页面属于复杂结构图并且后续要拖动维护，必须使用真正绑定的 connector。
- 一旦确认某个元素来自母版或 layout，就不要在页面层重复画一份。

6. **强制跑 build 后质量 gate**
- 所有 deck 在 `build` 之后都应先跑 `package_preflight`，检查包结构一致性、移动端兼容风险和外发安全信号。
- 所有 deck 在 `package_preflight` 之后都应再跑 `structure_precheck`，检查文本框 fit、文字遮挡和结构化对象排版边界。
- `package_preflight` 与 `structure_precheck` 都属于 deck 级 gate，不是某一页的局部验证。
- `not_checked` 必须显式写入报告，不能当成“通过”。

7. **再做模块验证与预览**
- 所有 deck 都必须导出逐页预览图。
- diagram 页按需要执行 connector 校验。
- 强模板页要额外检查母版元素是否稳定继承、页面层是否出现重复 logo / 页脚 / 装饰。

8. **强制跑 preview 后质量 gate**
- 预览图导出后，应按需要运行 `render_review`，处理结构层看不到的边界触墨和扁平化图像内部风险。
- `render_review` 不是对 `structure_precheck` 的重复，而是成图层补位。
- `render_review` 之后必须看逐页 preview 或 contact sheet 做人工 visual review，复核顺序固定为 `fatal -> warning -> preference`。

9. **完成初稿后给人类一个修订 checkpoint**
- 当 editable `pptx`、预览图、基础 validation 和 visual review 结论都已经齐全时，应把它明确为“可审阅的初稿”，而不是默认继续无限打磨。
- 这时应主动告诉人类：如果需要进入更细的页面级修订，例如逐页措辞微调、视觉节奏重排、icon 补强、chart 路线切换、研究图重绘或模板细节对齐，可以继续做，但这一步通常会显著增加 token 消耗。
- 如果人类暂时不需要详细修订，就直接交付当前初稿 bundle；如果人类要继续修订，再围绕具体页面和问题进入下一轮。

## 资源路由

**核心文档**
- 需要统一定义 deck、slide spec、validation bundle 和文档分层时，读取 `references/principles.md`。
- 需要建立 workspace、起草 `brief.md` / `deck_narrative.md`、派生 `slide_specs`、执行主流程和确认验证证据时，读取 `references/deck_workflow.md`。
- 需要决定页面该用什么 archetype、图表、diagram、语言模式时，读取 `references/design_support.md`。
- 需要决定某类资产该用什么 SDK、脚本、验证方式时，读取 `references/technical_support.md`。

**专项文档**
- 需要统一标题区、网格、留白、视觉复核底线时，读取 `references/slide_design_system.md`。
- 需要理解 deck 级质量 gate、移动端兼容预检查、结构排版预检查与 validation bundle 时，读取 `references/quality_gates.md`。
- 需要在模板改写、空白页直生、PowerPoint / LibreOffice 预览导出、diagram connector 路线之间做选择时，读取 `references/build_routes.md`。
- 需要做系统架构图、dataflow、dependency map、Mermaid 草稿层和 connector 策略时，读取 `references/diagram_support.md`。
- 需要做原生 PowerPoint chart，并判断何时优先保持 editable chart 时，读取 `references/office_chart_support.md`。
- 需要做高 DPI Python figure、研究图、热力图和排序图时，读取 `references/python_figure_support.md`。
- 只有在页面需要额外节奏增强、导航锚点或主题 icon 资产时，才读取 `references/icon_system.md`。

## 质量标准

- 默认交付物至少包含：`brief.md`、`deck_narrative.md`、派生 `slide_specs.yaml`、可编辑 `pptx`、验证结果、逐页预览图。
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
