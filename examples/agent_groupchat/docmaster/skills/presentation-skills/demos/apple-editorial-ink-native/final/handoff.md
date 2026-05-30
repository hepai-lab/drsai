# Handoff

## 交付物
- 可编辑 PPTX：`final/apple_editorial_ink_native_test.pptx`
- 逐页预览：`build/rendered/ppt_preview/`
- Contact sheet：`build/rendered/contact_sheet.png`
- 构建脚本：`scripts/build_editorial_ink_pptx.py`
- Deck contract：`brief.md`
- Narrative 与 slide contracts：`deck_narrative.md`、`build/generated/slide_specs.yaml`
- 数据底稿：`data/processed/*.csv`
- 验证记录：`validation/`

## 构建路线
- 风格路线：guizang-ppt-skill Style A “电子杂志 × 电子墨水”迁移到 native PPTX。
- 技术路线：`python-pptx` 空白页直生，使用原生文本框、矩形、椭圆、线条、表格和 shape chart。
- 数据路线：复用 apple-financial-report-review 的处理后数据底稿，不复用其具体 PPT 表现。

## 验证摘要
- workspace lint：通过。
- package preflight：通过，最新报告位于 `validation/package_preflight/history/package_preflight_20260513_120904.md`。
- structure precheck：通过，最新报告位于 `validation/structure_precheck/history/structure_precheck_20260513_120904.md`。
- preview export：通过，LibreOffice + pdftoppm 导出 10 页 PNG。
- render review：通过，最新报告位于 `validation/render_review/history/render_review_20260513_120944.md`。
- visual review：通过，记录位于 `validation/visual/review_log.md`。

## 残余取舍
- 本稿为风格迁移测试稿，shape chart 的视觉可编辑性优先于 Office chart 数据表可编辑性。
- 如果下一轮要测试 `office-chart-native`，建议将 S03、S05、S07 切换为原生 Office chart，并接受 embedded workbook 的移动端兼容 warning。
