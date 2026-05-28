# Python Figure Support

**这份文档的定位。** 本文定义 `ppt-polished-deck-collab` 中 Python figure 模块的使用边界、当前库栈和验证要求。它服务高复杂度、高信息密度、Office 原生 chart 难以稳妥表达的研究图和分析图。

## 目录

- 什么时候先读它
- 什么时候优先用 Python figure
- asset slot 合同
- 当前可用库栈
- 当前 helper
- 图形选择表
- 输出与插入规范
- 验证要求

## 什么时候先读它

**当图表复杂到不适合原生 Office chart，或者页面需要研究图、热力图、复杂排序图时，先读这份文档。** 它回答“什么时候该把图烤成高质量图片，以及当前 skill 如何稳定生成这类图片”。

## 什么时候优先用 Python figure

**研究图优先 Python figure。** 热力图、密集排序图、分布图、散点聚类图、时间条、复杂 small multiples，都更适合 Python figure。

**图表表达能力比 editable 更重要时，优先 Python figure。** 如果为了保持原生 chart 而让图失真、信息密度下降或版式极难控制，应直接转到 Python figure。

**一页只保留一两个高价值 figure。** Python figure 更像证据主图，不适合把一页塞成 dashboard 拼图。

## asset slot 合同

**slot 输入。** `module: python-figure-image`，`backend: matplotlib`、`seaborn` 或 `python`，`asset_type: figure`，`validation_mode: chart_image`。`input_files` 应登记数据文件或生成脚本，`constraints` 应说明 DPI、比例、字体和是否允许英文图内标签。

**artifact 输出。** `output_files` 应登记高 DPI PNG 路径，通常位于 `build/rendered/python_figures/`。如生成过程有中间 CSV、参数 JSON 或 notebook 导出，应一并保留在 workspace。

**不能做什么。** 不要用 Python figure 承担会后需要继续编辑数据的普通经营图表。不要把标题、长解释和结论都烤进图片；这些内容应优先由 PPT 原生文本承载。

## 当前可用库栈

**当前 skill 已经支持这套最小稳定栈。**
- `matplotlib`
- `seaborn`
- `pandas`
- `numpy`

**`plotly` 仍然属于后续扩展。** 当前技术支持文档会提到它，但 skill 内还没有统一 helper，因此不应写成已稳定支持。

## 当前 helper

**当前可复用 helper 位于 `scripts/python_figure_helpers.py`。**
- `prepare_figure_dir()`
- `set_chart_theme()`
- `save_ranked_bar()`
- `save_heatmap()`
- `save_timeline_barh()`

**这些 helper 默认输出 300 DPI PNG。** 这是为了让图插进 PPT 后在预览和投屏里都保持可读。

## 图形选择表

| 证据形状 | 推荐 Python figure | 为什么 |
| --- | --- | --- |
| 高密度排序比较 | Ranked bar | 标签多、排序强、原生 chart 容易挤 |
| 阶段覆盖或矩阵证据 | Heatmap | Office chart 对这类图支持弱 |
| 时长与阶段安排 | Timeline barh | 比普通甘特更轻、更稳 |
| 分布与离散结构 | Histogram / boxplot / density | 研究表达更自然 |
| 聚类与关系 | Scatter / embedding plot | 原生 chart 适配差 |

## 输出与插入规范

**输出目录应稳定。** 建议放在 `build/rendered/python_figures/`，并由 deck build 脚本引用绝对路径或稳定相对路径。

**插入 PPT 时必须保比例。** 不允许为了填满 panel 而强行拉伸图片。

**图题和结论仍然属于 slide。** 不要把长标题和大段解释硬写在图里，图本身主要负责证据表达。

## 字体与 glyph 策略

**Python figure 也必须服从 deck 的字体策略。** 不要接受“普通文本和 chart 都统一了，但 figure 里又换了一套字体”的状态。

**无品牌约束时，中文任务默认使用宋体与 Times New Roman。** 如果当前 Python plotting 栈没有正确加载中文字体，应显式配置 CJK 字体，或按 style profile 切换到可用的中文黑体 / 英文 Arial 组合，而不是默默回退到不支持中文 glyph 的默认字体。

**glyph warning 应视为失败信号。** 当 `matplotlib` / `seaborn` 因字体缺失而报出中文 glyph warning 时，不应视为无关紧要。应通过显式字体配置，或改成英文图内标签 + 中文 slide caption 的方式消除 warning。

## 验证要求

**当前验证重点是三件事。**
- 图片清晰度是否足够
- 插入 PPT 后比例是否保持
- 图旁标题与注释是否明确表达结论
- 生成过程是否没有字体缺失或 glyph fallback warning

**推荐验证顺序。**
- 生成 PNG
- 插入 PPT
- 导出逐页预览图
- 人工复核图在页面中的占位、文字可读性和裁切情况

**典型 build 方式。**

```python
from pathlib import Path
import pandas as pd

from scripts.python_figure_helpers import save_heatmap

frame = pd.DataFrame(
    [[93, 88, 81], [84, 79, 75]],
    index=["Guardrail", "Observability"],
    columns=["Week 1", "Week 2", "Week 3"],
)

save_heatmap(
    output_path=Path("build/rendered/python_figures/coverage_heatmap.png"),
    frame=frame,
    accent_rgb=(37, 99, 235),
    title="Coverage by Week",
)
```
