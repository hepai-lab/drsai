# Local Pipeline Case Study

**这份文档的定位。** 本文总结当前宿主工作区里已经落地的 `Markdown <-> DOCX` 实践，说明它为什么是一个合格的起点，以及要把它提升成仓库级 skill 还缺哪些抽象。

## 已落地的好实践

**目录职责已经分清。** 当前工作区把：
- `original/` 用于保存原始 Word
- `markdown/` 用于长期编辑
- `build/docx/` 用于输出
- `scripts/` 用于转换脚本
- `temp/` 用于测试输出

**主流程已经成型。** 当前脚本已经支持：
- `docx-to-md`
- `md-to-docx`
- `rebuild-all`

**当前流程已经具备统一样式导出的意识。** 现有实现会在 Markdown 回写 `.docx` 时集中设置字体、字号、行距和表格样式，而不是依赖作者手工排版。

## 当前脚本已经覆盖的能力

**基础结构转换已经可用。** 当前本地 `scripts/doc_pipeline.py` 已能覆盖标题、正文、列表、表格、代码块和图片，并保留原始块顺序。

**字体槽位已经部分显式处理。** 现有实现会给正文和标题设置 `Times New Roman + 宋体`，并对表格做独立字体处理，这为进一步抽象成 `style_profile` 奠定了基础。

**工作区元数据已经存在。** 当前 `meta.json` 已经绑定来源文档、Markdown 文件和资产目录，这是后续加入 `style_profile`、`output_docx` 和构建配置的自然位置。

## 当前脚本距离仓库级 skill 还差什么

**版式 profile 仍然是硬编码。** 当前实现主要固定在 `宋体 + Times New Roman`，还没有把 `楷体 + Times New Roman`、`黑体 + Arial` 做成可切换 profile。

**表题、图题、表注语义还没有被系统化。** 当前实现能处理图片和表格，但还没有把“表题在上、图题在下、表注在下”的规则升格成稳定对象。

**标题梯度还不够制度化。** 当前标题字号已经有基本层级，但还没有把默认梯度、文档主标题、副标题和可选展示型标题 profile 文档化。

**图表路线还没有扩展。** 当前实现以文本、表格和静态图片为主，还没有把 Office 原生 chart 和 Python figure 接成 skill 级模块。

**质量 gate 还没有自动化。** 当前更像“脚本完成后人工看结果”，还没有形成字体槽位检查、caption 位置检查和 style contract 检查。

## 这份 case study 对新 skill 的意义

**它证明了核心 workflow 已经成立。** 当前工作区不是从零开始，而是已经跑通了一个足够真实的文档流水线。

**它也明确了下一步抽象方向。** 新 skill 不应该重写一份完全脱离现实的理论文档，而应该把当前可用流程抽象成 `style_profile + block_role + quality_gates + asset_routes` 这套更稳的体系。
