---
deck:
  title: "AI Market Intelligence 2026 | Value Migration from Model Capex to Workflow Monetization"
  audience: "AI founders, investors, strategy leaders, and skill evaluators"
  scenario: "A polished deck demo that showcases consulting-grade content and editable PPT production"
  objective: "Show that the profit pool in AI migrates downstream and that the skill can render that logic as a validated editable deck"
  theme_tokens:
    body_font_pt: 14
    left_margin_in: 0.78
    right_margin_in: 15.22
    background_rgb: [248, 250, 252]
    accent_rgb: [37, 99, 235]
---

# AI Market Intelligence 2026 | Deck Narrative

## Global Narrative

**总体判断。** AI 行业的价值捕获正在从 foundation-model capex 转向 workflow monetization。供给侧依然重要，但 durable profit pool 正在向 workflow owner、distribution owner 和 feedback loop owner 迁移。

**这套 deck 最想让读者记住的三点。**
- AI 市场仍处在高速扩张期，但收入扩张和利润沉淀发生在不同层。
- 企业真正愿意持续付费的是能嵌入预算流程、替代人工步骤并形成反馈闭环的 workflow product。
- `ppt-polished-deck-collab` 不只是会画 slide，而是能把 brief、narrative、assets、editable build、preview 和 validation 做成一个稳定 workflow。

## Global Constraints

**数据口径。** 所有数字均为 illustrative / fabricated data，用于 skill demo，不对外宣称为真实研究结论，但必须保持叙事内部一致。

**风格约束。** 标题必须优先写成判断句，正文默认 `14pt`，左右边距统一，page-level badge 属于标题区对象，不与左侧 panel label 争抢空间。

**icon 约束。** 同一页的 PNG icon 要么跟随页面统一单色，要么显式跟随其所在 card / shape 的主题色，不采用中间态混色策略。

## Shared Terminology

**Foundation-model capex。** 指大模型训练和推理基础设施上的资本投入，包括 GPU cluster、模型训练、推理优化和底层平台建设。

**Workflow monetization。** 指围绕具体业务流程收费的商业模式，收入来源来自流程自动化、copilot seats、agent transaction fee 或结果导向付费。

**Control point。** 指在价值链里能够同时影响收入分配、客户锁定和反馈回流的关键位置，例如 agent orchestration、domain workflow integration 和 enterprise distribution。

**Domain-focused agent stack。** 指面向某一行业或职能场景，把模型、工具调用、数据连接、合规控制和业务 UI 组合成完整产品的一类公司。

## Slide Narrative

### S01 | AI value capture is moving from foundation-model capex to workflow monetization

```yaml slide_spec
title: "AI value capture is moving from foundation-model capex to workflow monetization"
reader_question: "What is the single market judgment this deck wants the reader to remember?"
page_task: "persuade"
reading_mode: "scan"
archetype: "hero-statement"
asset_mode: "image-hero"
validation_mode: "preview_only"
key_message: "Capital still scales the supply stack, but durable profit pools shift toward workflow owners."
required_assets:
  - "build/rendered/generated/hero_ai_market.png"
  - "data/processed/summary_cards.csv"
```

**Narrative Role.** 这页负责定调，让读者先接受“价值捕获迁移”这个主判断，而不是先掉进细节。

**Content Notes.** 标题直接给判断，正文解释为什么 workflow owner 才是 durable economics 的所在，四张 summary cards 负责把 deck 的关键数字一眼说清。

**Layout Notes.** 左侧是 headline 与 summary cards，右侧是 image-hero，整页服务于单一判断，不额外塞方法说明。

### S02 | Revenue scales fast, while profit pools migrate downstream

```yaml slide_spec
title: "Revenue scales fast, while profit pools migrate downstream"
reader_question: "How are revenue and EBIT pools moving across the AI stack?"
page_task: "evidence"
reading_mode: "decision"
archetype: "chart-spotlight"
asset_mode: "office-chart-native"
validation_mode: "chart_editable"
key_message: "The sector keeps growing, but the best economics migrate from model supply to application monetization."
required_assets:
  - "data/processed/market_layer_revenue.csv"
  - "data/processed/profit_pool_mix.csv"
```

**Narrative Role.** 这页负责给出最硬的数字证据，把 revenue growth 与 EBIT migration 放在同一页形成强对照。

**Content Notes.** 左图说明市场还在高速增长，右图说明利润池迁移到 apps/services，底部 insight strip 把图表语言翻译成 board-friendly judgment。

**Layout Notes.** 两张 native chart 必须保持可编辑，底部三条 insight 保持单句、短句，不用过度解释。

### S03 | Enterprise demand is broad, but monetization concentrates in budget-rich workflows

```yaml slide_spec
title: "Enterprise demand is broad, but monetization concentrates in budget-rich workflows"
reader_question: "Where is real enterprise willingness-to-pay emerging first?"
page_task: "explain"
reading_mode: "guided"
archetype: "research-note"
asset_mode: "python-figure-image"
validation_mode: "chart_image"
key_message: "The early revenue pool is driven by a narrow set of workflows with budget authority and clear ROI owners."
required_assets:
  - "data/processed/enterprise_budget_rank.csv"
  - "data/processed/sector_adoption_heatmap.csv"
```

**Narrative Role.** 这页负责把“采用很广”和“真正付费”拆开，避免读者用 adoption 热度替代 monetization 判断。

**Content Notes.** 左图排出预算优先级，右图说明 adoption by sector，底部三句总结清楚预算 owner 与 workflow package 的关系。

**Layout Notes.** 这页正文密度较高，必须维持 `14pt` 正文并保证底部总结区可读，不允许回退到小字。

### S04 | Control points sit where model capability, proprietary data and distribution create feedback loops

```yaml slide_spec
title: "Control points sit where model capability, proprietary data and distribution create feedback loops"
reader_question: "What does the AI industry value chain look like when drawn as control points instead of buzzwords?"
page_task: "explain"
reading_mode: "guided"
archetype: "process-flow"
asset_mode: "diagram-connector"
validation_mode: "diagram_connector"
key_message: "The winning layer is the one that compounds model access with enterprise data, governance and user distribution."
required_assets:
  - "assets/diagrams/ai_value_chain.mmd"
```

**Narrative Role.** 这页负责把行业 buzzword 压缩成 control architecture，让读者看到真正的 control points 在哪里。

**Content Notes.** 左侧 connector diagram 是主资产，右栏只保留三条经济含义 callout，不再让指标卡和 diagram 抢主次。

**Layout Notes.** 这页必须使用真 connector，并通过 XML 级别校验；同时 page badge 必须归入标题区，避免和左侧 diagram panel label 重叠。

### S05 | The best risk-adjusted play is a domain-focused agent stack, not another general model lab

```yaml slide_spec
title: "The best risk-adjusted play is a domain-focused agent stack, not another general model lab"
reader_question: "Which AI archetype offers the best mix of growth, margin, moat and capital efficiency?"
page_task: "compare"
reading_mode: "decision"
archetype: "comparison-matrix"
asset_mode: "mixed"
validation_mode: "chart_image"
key_message: "Domain agent stacks win because they pair software economics with differentiated data and workflow embedment."
required_assets:
  - "data/processed/strategy_archetype_scores.csv"
  - "data/processed/capability_rollout_timeline.csv"
```

**Narrative Role.** 这页是 recommendation page，直接回答“该投什么”。

**Content Notes.** 左侧 scorecard 负责比较 archetype，右上 thesis 负责给出一句推荐，右下 timeline 负责说明更合理的进入顺序。

**Layout Notes.** 矩阵内的 badge 必须短，不能再出现 `Recommended` 这种挤压到两行的长标签。

### S06 | One workflow auto-produces a board-ready deck with validation evidence

```yaml slide_spec
title: "One workflow auto-produces a board-ready deck with validation evidence"
reader_question: "Why is this skill useful beyond writing one-off slides?"
page_task: "persuade"
reading_mode: "guided"
archetype: "board-memo"
asset_mode: "diagram-visual"
validation_mode: "diagram_visual"
key_message: "This demo itself is the proof that planning, asset build, PPT generation and validation can be one reproducible workflow."
required_assets:
  - "assets/diagrams/skill_workflow.mmd"
  - "validation/manifests/build_manifest.json"
```

**Narrative Role.** 这页把内容层能力切换成 workflow 层能力，让读者看到这不是一次性手工出图，而是一条可复跑的 production path。

**Content Notes.** 左侧 workflow 区说明从 brief 到 delivery 的链路，右侧 capability cards 说明资产覆盖，底部统计条说明本次交付规模。

**Layout Notes.** 这页是当前最容易被小字和窄容器拖垮的一页，因此 workflow 容器必须优先服务 `14pt` 正文，而不是反过来让正文字号退步。
