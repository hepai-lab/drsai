# PPTX Structure Precheck Report

- 输入文件：`/project/lisiyuan/Projects/AutoCausePanel/references/temp/apple_financial_report_review/build/pptx/apple_fy2025_financial_report_review.pptx`
- 错误数：`0`
- 警告数：`0`
- 未检查数：`6`

## 摘要

- `not_checked` / `structured_chart_label_collision_not_checked`: 6

## 问题清单

### `not_checked`

#### `structured_chart_label_collision_not_checked`

首期 `structure_precheck` 还没有读取原生 chart 内部 label 的真实边界，因此该 chart 的内部标签碰撞未自动检查。

建议：当前先保留逐页预览复核；后续可补 chart title / axis / legend / data label 的结构化检查。

出现位置：
- slide 3 | shape 6
- slide 4 | shape 6
- slide 5 | shape 6
- slide 6 | shape 6
- slide 7 | shape 6
- slide 8 | shape 6
