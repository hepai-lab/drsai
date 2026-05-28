# Office Chart Support

**这份文档的定位。** 本文定义 `ppt-polished-deck-collab` 中原生 Office chart 模块的使用边界、实现方式和验证要求。它服务“图表需要继续编辑”的页面，而不是所有图表页。

## 目录

- 什么时候先读它
- 什么时候优先用原生 Office chart
- asset slot 合同
- 当前可用实现
- 图表选择表
- 标题与注释语言
- 验证要求

## 什么时候先读它

**当页面核心是趋势、比较、构成、排名，而且会后高概率继续改数时，先读这份文档。** 它回答“哪些图表应当保持原生可编辑，以及当前 skill 怎么稳定生成它们”。

## 什么时候优先用原生 Office chart

**数字会继续改时，优先原生 chart。** 管理层汇报、周报、经营复盘、项目节奏图这类页面，后续常会改 series、换类目、调标签，因此应尽量保持为 PowerPoint 原生图表。

**证据结构简单而稳定时，优先原生 chart。** 条形图、柱状图、折线图、堆叠图、简单组合图，只要 Office chart 足够表达，就不必先走 Python figure。

**重点是 editable，不是炫技。** 一张可继续编辑的普通条形图，通常优于一张看起来更花但会后没法改数的图片图表。

## asset slot 合同

**slot 输入。** `module: office-chart-native`，`backend: python-pptx`，`asset_type: chart`，`validation_mode: chart_editable`。`input_files` 应登记 CSV、Excel、JSON 或明确的数据来源；财务数值和百分比列应保留原始单位。

**artifact 输出。** 输出主要是可编辑 `pptx` 内的原生 chart，对应 slot 可以登记生成脚本、数据快照或预览图路径。不要把最终 chart 只登记成 PNG。

**不能做什么。** 不要用原生 chart 硬拼热力图、复杂散点、超密排序图或需要精细研究图语法的页面。不要为了风格牺牲可编辑性，除非 deck contract 已明确允许 `mixed_assets` 或 `snapshot_allowed`。

## 当前可用实现

**当前 skill 已经有可复用 helper。** `scripts/ppt_asset_helpers.py` 内的 `add_native_chart_card()` 可以直接把原生 chart 放进一个标准 panel 卡片里。

**当前依赖只需要 `python-pptx`。** 这意味着 native chart 在本 skill 中已经是 `available`，不再只是规划状态。

**当前 helper 适合这些图表。**
- `BAR_CLUSTERED`
- `COLUMN_CLUSTERED`
- `LINE`
- `BAR_STACKED`
- 其他 `python-pptx` 支持且不依赖特殊格式设置的标准 chart type

## 字体一致性

**原生 Office chart 也必须服从 deck 字体策略。** 不要让普通文本是一套字体，chart title、轴标签、图例和数据标签又是另一套字体。图表仍然是页面的一部分，而不是外来对象。

**无品牌约束时的中文默认策略是。** 中文使用宋体，英文使用 Times New Roman。对 mixed-language deck，应至少保证 category / value axis、legend、data labels 和 chart title 遵守同一策略。现代商务、产品或强模板任务可以通过 style profile 切换到中文黑体、英文 Arial。

**只写 `font.name` 往往不够。** 某些实现路径只能稳定写入 latin 字体槽位。遇到中文仍然漂移的情况，应在最终 `pptx` 上补做字体槽位修正，把 East Asian 字体也显式写进去，而不是放任 Office 或系统自行猜测。

## 图表选择表

| 证据形状 | 推荐原生 chart | 为什么 |
| --- | --- | --- |
| 类别比较 | 条形图 / 柱状图 | 最稳、最易读、最易改数 |
| 时间趋势 | 折线图 | 管理层和运营页最常见 |
| 构成变化 | 堆叠柱 / 100% 堆叠 | Office 原生足够表达 |
| 小规模 before / after | 双 series 对比图 | editable 且注释简单 |
| 单页 KPI 对比 | 横向条形图 | 与结论卡片搭配自然 |

**这些场景不应优先走原生 chart。**
- 高密度热力图
- 密集散点和复杂分布图
- 排序很多、标注很密的研究图

这些更适合走 `python-figure-image` 路线。

## 标题与注释语言

**标题应先给发现，再让图表支撑。** 推荐写法如：
- “Coverage gap 集中在执行后期”
- “方案 B 在成本与速度之间最平衡”
- “Q3 的增长主要来自两条产品线”

**注释应只写图上最关键的两三处。** 不要把图例、标签和正文讲成三遍同样的话。

**正式研报 / 财报点评图表应补齐读图结构。** 这类页面默认需要图号、发现式图题、单位说明、来源注和必要的数据表。图表下方数据表按中文 table policy 处理：五号约 `10.5pt`、单倍行距、上下居中、表头居中、文本列居左、财务数值列靠右。

## 验证要求

**当前自动验证重点是 preview，不是 XML 级 chart 解析。** 原生 chart 页至少要有逐页预览图，并人工确认 chart 仍然可选中、可编辑、图例和标签没有漂移。

**推荐验证顺序。**
- 导出逐页预览图
- 在 PowerPoint 中点选 chart，确认不是图片
- 抽检一页修改数据或系列颜色，确认图仍可编辑
- 抽检一页 chart 的标题、轴标签、图例和数据标签，确认它们遵守当前 deck 的字体策略

**当前相关脚本。**
- `scripts/ppt_asset_helpers.py`
- `scripts/export_pptx_previews.py`

**典型 build 方式。**

```python
from pptx.enum.chart import XL_CHART_TYPE
from scripts.ppt_asset_helpers import add_native_chart_card

add_native_chart_card(
    slide=slide,
    title="Weekly Coverage by Phase",
    left=0.7,
    top=1.3,
    width=6.2,
    height=3.1,
    accent_rgb=(37, 99, 235),
    categories=["Phase 1", "Phase 2", "Phase 3"],
    series_list=[("Coverage", [92, 88, 73])],
    chart_type=XL_CHART_TYPE.BAR_CLUSTERED,
)
```
