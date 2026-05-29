# Handoff

**项目名称。** `ppt-polished-deck-collab-ai-market-intelligence`

**当前主交付。**
- `final/ai_market_intelligence_demo.pptx`
- `brief.md`
- `deck_narrative.md`
- `build/generated/slide_specs.yaml`
- `validation/structure/connector_report.json`
- `validation/manifests/build_manifest.json`
- `validation/manifests/preview_manifest.json`
- `build/rendered/ppt_preview/slide_001.png` 到 `slide_006.png`

**当前构建路线。**
- deck build: `python build/build_deck.py`
- connector validation: `python ../../ppt-polished-deck-collab/scripts/check_pptx_connectors.py ...`
- preview export: `python ../../ppt-polished-deck-collab/scripts/export_pptx_previews.py --backend libreoffice ...`

**为什么当前预览走 LibreOffice。** 当前 skill 的 PowerPoint AppleScript PDF 导出链路在这台机器上没有稳定落盘 PDF，因此本次预览证据切换到 skill 文档明确支持的 LibreOffice backend。

**剩余风险。** PowerPoint 对较早版本文件给出过“内容有问题，是否修复”的提示。当前结构检查没有定位到确定坏对象，但建议对 `final/ai_market_intelligence_demo.pptx` 再做一次最新版本的人工打开验证。

**建议下一步。**
- 如果最新文件在 PowerPoint 中仍提示修复，优先按 slide/object 做二分法缩小问题范围。
- 如果准备把这个 demo 对外展示，建议把根 README 中的 demos 列表同步更新。
