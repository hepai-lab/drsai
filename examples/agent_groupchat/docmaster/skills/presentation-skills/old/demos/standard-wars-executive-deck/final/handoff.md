# Handoff

**交付物。** 最终 deck 为 `final/standard_wars_executive_deck.pptx`。构建中间产物保留在 `build/`，验证证据保留在 `validation/`。

**叙事主线。** 这套 deck 采用总分总结构。前两页先抛出“市场不是在做技术评测”与三条 `claim`，中间六页按 `claim 1 -> claim 2 -> claim 3` 逐条验证，最后三页把三条 `claim` 压成 cross-case matrix、management checklist 和 closing summary。

**图表说明。** slide 5 与 slide 7 的统计图表属于分析性合成评分，用于把案例中的机制差异显式化，不代表原始市场统计。评分逻辑与页面叙事一致，目的是展示 chart module 的表达能力而不是伪造数据结论。

**Python figure 说明。** slide 6 接入了一张由 `matplotlib + seaborn` 生成的热力图，路径位于 `build/rendered/python_figures/networking_factor_heatmap.png`。它用于展示 `python-figure-image` 路线已经被本 workspace 实际使用，而不是只存在于 skill 文档里。

**表格说明。** slide 6、slide 7、slide 10 的比较页已经改为 PowerPoint 原生表格，不再使用 shape grid 冒充表格。

**字体策略。** 最终 `pptx` 已增加字体后处理策略：英文槽位统一为 `Arial`，中文 East Asian 槽位统一为 `黑体`。这条策略同时覆盖普通文本和 Office chart 的标签、轴、图例与数据标签。

**结构图说明。** slide 3 的五因素框架使用真 connector，并已经通过 XML 级别的 connector 校验。

**关键命令。**

```bash
python old/demos/standard-wars-executive-deck/build/build_deck.py

python ppt-polished-deck-collab/scripts/check_pptx_connectors.py \
  --pptx old/demos/standard-wars-executive-deck/build/pptx/standard_wars_executive_deck.pptx \
  --slide 3 \
  --json-out old/demos/standard-wars-executive-deck/validation/structure/connector_report.json \
  --min-connectors 7

python ppt-polished-deck-collab/scripts/export_pptx_previews.py \
  --pptx old/demos/standard-wars-executive-deck/build/pptx/standard_wars_executive_deck.pptx \
  --out-dir old/demos/standard-wars-executive-deck/build/rendered/ppt_preview \
  --backend auto
```

**验证路径。**
- `validation/manifests/build_manifest.json`
- `validation/manifests/preview_manifest.json`
- `validation/structure/connector_report.json`
- `validation/visual/review_log.md`

**本次实际用到的 skill 能力。**
- `diagram-connector`：slide 3 五因素框架
- `office-chart-native`：slide 5 分析性合成评分条形图
- `python-figure-image`：slide 6 Networking heatmap
- `table-native`：slide 6、slide 7、slide 10 对比页
- `icon-accent`：claim、lesson、checklist 与 summary 卡片
- `preview export + visual review + connector check`：完整验证闭环

**继续迭代时优先看哪里。** 如果继续强化内容层，可以先改 `deck_narrative.md`。如果继续强化页面表达，可以先改 `build/build_deck.py` 里的 slide 级函数。只要 narrative 或 build 有改动，就建议重新跑一遍 preview export 和 visual review。
