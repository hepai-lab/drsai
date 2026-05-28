# PPTX Package Preflight Report

- 输入文件：`/project/lisiyuan/Projects/AutoCausePanel/references/temp/apple_financial_report_review/build/pptx/apple_fy2025_financial_report_review.pptx`
- 错误数：`1`
- 警告数：`1`
- 未检查数：`0`

## 摘要

- `error` / `docprops_slide_count_mismatch`: 1
- `warning` / `mobile_compatibility_embedded_object`: 1

## 问题清单

### `error`

#### `docprops_slide_count_mismatch`

`docProps/app.xml` 中的 `Slides` 统计与实际 slide 数不一致，这对移动端解析器是高风险信号。

建议：在最终打包前重写 `docProps/app.xml` 的 slide 统计，保证和真实 deck 一致。

出现位置：
-

### `warning`

#### `mobile_compatibility_embedded_object`

deck 中存在嵌入对象，这类对象在微信预览与移动端 WPS 中兼容性更脆弱。

建议：如果外发目标包含微信或移动端 WPS，优先改为图片化 chart 或移除 workbook embedding。

出现位置：
-
