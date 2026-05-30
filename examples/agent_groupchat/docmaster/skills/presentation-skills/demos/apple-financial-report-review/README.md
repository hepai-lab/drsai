# Apple Inc. FY2025 财报点评 Demo

**项目定位。** 这个 demo 展示 `ppt-polished-deck-collab` 如何把一个中文正式财报点评任务做成可编辑、可复跑、可验证的 PowerPoint 交付物。它覆盖 SEC 数据采集、财务表格抽取、deck narrative、原生 Office chart、原生表格、研报型版心、预览导出和三段式质量 gate。

## 交付物
- 可编辑 PPT：`final/apple_fy2025_financial_report_review.pptx`
- 快速审阅 PDF：`final/apple_fy2025_financial_report_review.pdf`
- 逐页预览图：`build/rendered/ppt_preview/slide_001.png` 至 `slide_011.png`
- 预览 contact sheet：`build/rendered/contact_sheet.png`
- 数据底稿：`data/processed/*.csv`
- 已下载 10-K 原文：`data/reports/FY2021_*.htm` 至 `FY2025_*.htm`

## 数据来源
- SEC submissions API: https://data.sec.gov/submissions/CIK0000320193.json
- SEC companyfacts API: https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json
- FY2025 10-K: https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm
- FY2024 10-K: https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-20240928.htm
- FY2023 10-K: https://www.sec.gov/Archives/edgar/data/320193/000032019323000106/aapl-20230930.htm
- FY2022 10-K: https://www.sec.gov/Archives/edgar/data/320193/000032019322000108/aapl-20220924.htm
- FY2021 10-K: https://www.sec.gov/Archives/edgar/data/320193/000032019321000105/aapl-20210925.htm

## 页面预览

![Apple FY2025 财报点评 contact sheet](build/rendered/contact_sheet.png)

| S01 | S02 |
| --- | --- |
| ![S01 封面](build/rendered/ppt_preview/slide_001.png) | ![S02 核心结论](build/rendered/ppt_preview/slide_002.png) |

| S03 | S04 |
| --- | --- |
| ![S03 收入与净利润](build/rendered/ppt_preview/slide_003.png) | ![S04 产品收入结构](build/rendered/ppt_preview/slide_004.png) |

| S05 | S06 |
| --- | --- |
| ![S05 区域收入结构](build/rendered/ppt_preview/slide_005.png) | ![S06 毛利率](build/rendered/ppt_preview/slide_006.png) |

| S07 | S08 |
| --- | --- |
| ![S07 费用率](build/rendered/ppt_preview/slide_007.png) | ![S08 现金流](build/rendered/ppt_preview/slide_008.png) |

| S09 | S10 |
| --- | --- |
| ![S09 资产负债](build/rendered/ppt_preview/slide_009.png) | ![S10 财务表格](build/rendered/ppt_preview/slide_010.png) |

| S11 |
| --- |
| ![S11 来源与声明](build/rendered/ppt_preview/slide_011.png) |

## 构建流程
以下命令默认在 `demos/apple-financial-report-review/` 目录下执行。

```bash
python scripts/collect_apple_sec_data.py
python scripts/extract_segment_tables.py
python ../../ppt-polished-deck-collab/scripts/derive_slide_specs_from_narrative.py \
  --narrative deck_narrative.md \
  --out-yaml build/generated/slide_specs.yaml \
  --json-out build/generated/slide_specs.json
python scripts/build_apple_report_pptx.py
```

## 验证命令
以下命令默认在 `references/presentation-skills/` 目录下执行。

```bash
python ppt-polished-deck-collab/scripts/check_pptx_package_preflight.py \
  --pptx demos/apple-financial-report-review/final/apple_fy2025_financial_report_review.pptx \
  --workspace-dir demos/apple-financial-report-review \
  --fail-on error

python ppt-polished-deck-collab/scripts/check_pptx_structure_precheck.py \
  --pptx demos/apple-financial-report-review/final/apple_fy2025_financial_report_review.pptx \
  --workspace-dir demos/apple-financial-report-review \
  --inventory-out demos/apple-financial-report-review/validation/structure_precheck/shape_inventory.json \
  --fail-on error

python ppt-polished-deck-collab/scripts/check_pptx_render_review.py \
  --pptx demos/apple-financial-report-review/final/apple_fy2025_financial_report_review.pptx \
  --preview-dir demos/apple-financial-report-review/build/rendered/ppt_preview \
  --workspace-dir demos/apple-financial-report-review \
  --fail-on error
```

## 验证结果
- `package_preflight`：通过；保留 1 个 `mobile_compatibility_embedded_object` warning，原因是 6 个原生 Office chart 包含可编辑 workbook，属于可编辑性与移动端兼容性的取舍。
- `structure_precheck`：通过；6 个原生 chart 内部 label collision 标记为 `not_checked`，后续由 LibreOffice 预览和 render review 复核。
- `preview_export`：通过；LibreOffice + `pdftoppm` 导出 11 张 PNG，页数与 PPT 一致。
- `render_review`：通过；未发现边界触墨或成图层 error。
- `workspace lint`：通过；未使用 icon/diagram 资产，相关空目录 warning 可忽略。

## 口径说明
- FY2025 指 fiscal year ended September 27, 2025，对应 10-K filed October 31, 2025。
- 核心三表数据来自 SEC companyfacts；产品线、地区和 Products/Services 毛利率来自 Apple 10-K HTML 表格。
- 总债务口径为 commercial paper + current long-term debt + non-current long-term debt。
- 本材料不使用 Apple、中信或其他机构 logo，不构成投资建议、评级或目标价。
- 版式风格采用正式券商研报的深红、暗金和浅米灰体系；中文字体为宋体，英文字体为 Times New Roman；正文小四、首行缩进、段前段后 0.5 行、1.5 倍行距；表格五号、单倍行距、段前段后 0、上下居中，表头居中，index / 类目列居左，文本列居左，数值列靠右。

## 强制声明
仅供学术交流使用，不代表任何组织机构，机构和个人的观点和立场。
