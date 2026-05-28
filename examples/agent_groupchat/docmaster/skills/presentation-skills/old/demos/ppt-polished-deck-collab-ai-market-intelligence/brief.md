# AI Market Intelligence Demo Brief

**项目定位。** 这个 demo 用一个 6 页的 AI 行业市场分析 deck，同时展示 `ppt-polished-deck-collab` 在 business narrative、自动版式、editable PPT、native chart、Python figure、connector diagram、icon system、preview export 与 validation bundle 上的完整能力。

**目标读者。** 目标读者是 AI 创业公司 CEO、投资机构合伙人、企业战略负责人，以及需要快速验证“这套 skill 能否产出 board-ready 材料”的内部使用者。

**使用场景。** 使用场景是技能展示、售前 proof-of-capability、方法论样板和后续 deck archetype 回归样本。它不是对真实市场的研究结论，而是一个为技能展示而设计的高质量咨询风格项目。

**交付目标。** 最终交付应包含 `brief.md`、`deck_narrative.md`、派生 `build/generated/slide_specs.yaml`、可编辑 `pptx`、逐页预览图、connector 校验结果、visual review 记录和 handoff 说明。

**内容边界。** 内容和数据允许是 illustrative / fabricated，但必须满足三条要求：一是叙事完整且内部一致，二是 headline 风格接近顶级咨询公司的判断句写法，三是每一页都承担清晰的 reader question。

**视觉目标。** 风格参考 board-level consulting deck，采用浅底高对比、强标题、克制配色、统一 icon family 和稳定网格，不做炫技模板，也不做花哨背景拼贴。

**能力覆盖要求。** 这套 deck 需要覆盖 `text-layout-native`、`image-hero`、`office-chart-native`、`python-figure-image`、`diagram-connector`、`diagram-visual`、`table-native` 和 `icon-accent` 这些当前 skill 已落地的主能力。

**文档约束。** 这个 workspace 默认只维护两份人类主文档：`brief.md` 与 `deck_narrative.md`。不再长期手写 `deck_plan.md`、`content/narrative.md`、`content/key_claims.md`、`content/terminology.md` 这类平行文档。

**正确失败要求。** 如果 icon 渲染、ppt 构建、connector 校验或 preview 导出失败，项目必须显式暴露失败原因，不允许静默跳过某个模块后仍声称 demo 完成。
