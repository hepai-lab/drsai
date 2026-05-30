# Python Figure Support

**这份文档的定位。** 本文定义 `word-polished-doc-collab` 中 Python figure 模块的使用边界、字体要求和接入方式。它服务高复杂度、高信息密度和 Office 原生 visual 难以妥善表达的图形资产。

## 什么时候使用 Python figure

**研究图和复杂统计图优先 Python figure。** 典型场景包括：
- 热力图
- 排序条形图
- 机制图
- 时间线
- 多面板统计图

**Python figure 与 Office 原生 visual 是并列资产模式。** 当重点是编辑性时优先 Office 原生 visual；当重点是高复杂度表达时优先 Python figure。

**业务材料里也可以使用，但必须控制风格。** Python figure 可以进入正式 Word 文档，但它的字体、配色和留白仍应与文档主版式一致。

## 资产约定

**Python figure 应作为独立资产生成。** 推荐把生成结果放在：
- `markdown/<doc>/assets/generated/`
- 或宿主工作区统一的 `build/rendered/`

**Markdown 只引用资产，不嵌代码。** 文档的 canonical source 仍然是 Markdown。生成图的 Python 脚本单独维护，Markdown 通过相对路径引用最终图像。精细模式下，生成图还应进入 `asset_manifest`。

## 字体和版式要求

**默认沿用文档 profile。** 如果正文是 `宋体 + Times New Roman`，图中的中文、英文、数字也应尽量对齐这套组合。

**展示型图可以切到 `黑体 + Arial`。** 如果文档标题或图表系统本来就走现代商务风格，可以把图内标题、轴标签和图例切到 `cn_heiti_arial`。

**题注仍然受文档规则约束。** `figure_title`、`figure_note`、`source_note` 的位置跟随 active `caption_policy`，不应由 Python 图像自己烘焙进标题文字。

## 输出格式建议

**默认优先高分辨率 PNG。** 它兼容性最好，适合大多数 `python-docx` 流程。

**需要矢量时再评估 SVG/EMF。** 如果宿主工具链、Word 版本和接入脚本都能稳定处理，再考虑更高保真的矢量路线。

## 验证要求

**至少验证五件事。**
- 图片路径存在且能被构建器读取。
- 图中文字在目标机器上不会因为字体缺失而乱掉。
- 图片插入后不会模糊或被异常压缩。
- 图题、图注和来源说明的位置符合 active `caption_policy`。
- `asset_manifest` 对该资产的模式和来源声明是完整的。
