# PPT Polished Deck Demo | AI Market Intelligence

**项目定位。** 这个 demo 用一个 6 页的 AI 行业市场分析 deck，完整展示 `ppt-polished-deck-collab` 从 `brief.md`、`deck_narrative.md`、图表和 diagram 资产、editable `pptx`、preview export 到 validation bundle 的闭环能力。

**主题定位。** 内容采用顶级咨询公司常见的管理层判断句写法，主题是 “AI 的价值捕获正在从 foundation-model capex 转向 workflow monetization”。所有数据都是 illustrative / fabricated，用于展示 skill 的业务表达能力和 PPT 工程能力。

**能力覆盖。** 本项目覆盖了 image hero、native Office chart、Python figure、connector diagram、diagram visual、table-like matrix 和 icon system，并保留完整 workspace 文档。

## Workspace 结构

```text
old/demos/ppt-polished-deck-collab-ai-market-intelligence/
  brief.md
  deck_narrative.md
  data/
  assets/
  build/
  validation/
  final/
```

## 快速 CLI 参考

**构建 deck。**

```bash
python build/build_deck.py
```

**从总叙事文档派生结构化 slide specs。**

```bash
python ../../ppt-polished-deck-collab/scripts/derive_slide_specs_from_narrative.py \
  --narrative deck_narrative.md \
  --out-yaml build/generated/slide_specs.yaml
```

**检查 workspace 关键输入。**

```bash
python ../../ppt-polished-deck-collab/scripts/lint_deck_assets.py \
  --workspace-dir .
```

**校验 connector 页。**

```bash
python ../../ppt-polished-deck-collab/scripts/check_pptx_connectors.py \
  --pptx build/pptx/ai_market_intelligence_demo.pptx \
  --slide 4 \
  --json-out validation/structure/connector_report.json \
  --min-connectors 8
```

**导出逐页预览图。**

```bash
python ../../ppt-polished-deck-collab/scripts/export_pptx_previews.py \
  --pptx build/pptx/ai_market_intelligence_demo.pptx \
  --out-dir build/rendered/ppt_preview \
  --backend auto \
  --json-out validation/manifests/preview_manifest.json
```

## 关键文件

**任务定义。** `brief.md`

**总叙事与页面设想。** `deck_narrative.md`

**机器执行入口。** `build/generated/slide_specs.yaml`

**构建入口。** `build/build_deck.py`

**数据输入。** `data/processed/*.csv`

## 输出说明

**构建输出。** `build/pptx/ai_market_intelligence_demo.pptx`

**Python figure 输出。** `build/rendered/python_figures/`

**验证 manifest。** `validation/manifests/build_manifest.json`

**预览图输出。** `build/rendered/ppt_preview/`

## 说明

**正确失败。** 如果 icon 渲染、PPT 构建、connector 校验或 preview 导出失败，这个 demo 会显式失败，而不是静默跳过某个模块。

**交付目标。** 这不是一份“只看结果图”的 demo，而是一套可以被人类和不同 agent 继续共同维护的 deck workspace。
