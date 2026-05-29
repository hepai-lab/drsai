# Icon System

**这份文档的定位。** 本文说明 `ppt-polished-deck-collab` 当前已经落地的 icon system，包括默认 family、topic packs、registry 字段、自动着色逻辑和可执行命令。它服务的目标是让 deck 排版更有节奏感，而不是把 icon 变成主角。

## 目录

- 当前实现
- asset slot 合同
- 两层 pack
- Registry 字段
- 使用命令
- 版式使用原则
- 渲染经验
- 当前边界

## 当前实现

**当前默认 family 是 `Tabler Outline`。** 这是一个统一的线性 icon family，适合高质量 deck 里的 section 标题、摘要卡片、evidence tile 和轻量导航元素。

**当前系统已经是可执行的。** skill 内已经包含：
- `assets/icons/tabler-outline/registry.json`
- `scripts/icon_registry.py`
- 已同步的 SVG 资产
- 已渲染的 128px PNG 资产

**当前不是开放式大图库。** 它是一个精选的 curated registry，目标是先把“真正常用且适合 deck 排版”的 icon 做稳，而不是一开始就追求无限覆盖。

**icon 是可选扩展，不是硬依赖。** 一个 deck 完全可以不使用 icon。只有在页面需要 section 节奏、卡片锚点、轻量导航或弱语义提示时，才应该启用 icon system。

## asset slot 合同

**slot 输入。** `module: icon-accent`，`backend: icon-registry`，`asset_type: icon`，`validation_mode: preview_only`。slot 应登记 icon id、pack、语义角色、背景色、accent 色和目标尺寸。

**artifact 输出。** `output_files` 应登记渲染后的 PNG 或 SVG 路径。当前稳定路线是 `SVG -> PNG -> PPT`，输出通常放在 deck workspace 的 `assets/icons/` 或临时主题目录。

**不能做什么。** icon 不能替代图表、diagram、结论标题或证据。不要混用多个 icon family，也不要只靠颜色表达风险、增长或优先级。

## 两层 pack

**`general-layout` 是泛用主库。** 它服务标题、卡片、摘要页、趋势页、风险页、目录页和交付物页，保证 skill 的泛用性不被研究主题绑死。

**`llm-research` 是主题子集。** 它是与泛用主库并列的一层 topic pack，服务 ACL、EMNLP、LLM、Agent、RAG、Memory、evaluation、graph relation 等你常做的话题，但不会替代泛用主库。

## Registry 字段

**每个 icon 至少包含这些字段。**
- `id`: skill 内稳定标识
- `source_name`: 上游 icon 名称
- `packs`: 所属 pack 列表
- `aliases`: 可搜索别名
- `usage_note`: 适合放在哪类页面或卡片里
- `recommended_color_role`: 推荐色彩角色
- `ppt_size_hint`: 推荐在 PPT 中使用的大致尺寸

**`recommended_color_role` 当前有三类。**
- `accent`: 跟 deck 的 accent 色走，适合 insight、growth、target、presentation 这类增强型 icon
- `muted`: 跟正文辅助色走，适合 team、engineering、database、route 这类结构型 icon
- `semantic`: 由 icon 语义自动落到安全绿或风险红，适合 shield、alert、quality gate 一类 icon

## 使用命令

**列出所有 pack。**

```bash
python scripts/icon_registry.py list-packs
```

**在全库里搜索。**

```bash
python scripts/icon_registry.py search --query "risk insight trend"
```

**只在研究主题 pack 里搜索。**

```bash
python scripts/icon_registry.py search \
  --pack llm-research \
  --query "rag retrieval memory agent graph eval"
```

**同步 SVG。**

```bash
python scripts/icon_registry.py sync
python scripts/icon_registry.py sync --pack llm-research
```

**渲染 PNG。**

```bash
python scripts/icon_registry.py render --size 128
python scripts/icon_registry.py render --pack llm-research --size 128
```

**按 slide 背景和主题色自动着色。**

```bash
python scripts/icon_registry.py render \
  --pack general-layout \
  --size 128 \
  --color-mode auto \
  --background-color "#F8FAFC" \
  --accent-color "#2563EB" \
  --theme-name light-blue
```

**渲染到 deck workspace 或测试目录。**

```bash
python scripts/icon_registry.py render \
  --pack llm-research \
  --size 128 \
  --color-mode auto \
  --background-color "#F8FAFC" \
  --accent-color "#2563EB" \
  --out-dir temp/test_icon_demo/theme_light_blue
```

## 版式使用原则

**icon 只做节奏增强，不做信息主载体。** 最适合的用法是 section 标题旁小图标、信息卡片角标、重点标签和轻量导航。

**同一套 deck 默认只用一个 family。** 当前 skill 默认就是 `Tabler Outline`。不要为了“更丰富”混入别的线宽和几何风格。

**icon 应靠近对应对象。** 不要让读者在页面左上角看一个图标，再去远处找说明文字。

**颜色只做辅助。** icon 的颜色不应成为唯一编码方式，应与文案、位置和卡片结构一起工作。

**icon 颜色必须服从 slide 背景。** 在浅底 slide 上，muted icon 应接近正文辅助色；在深底 slide 上，muted icon 应自动转为高对比浅色。accent 和 semantic icon 也必须先过对比度检查，再进入页面。

## 渲染经验

**主渲染路线是 `PyMuPDF`。** `scripts/icon_registry.py` 默认优先使用 Python 内的 `PyMuPDF` 把 SVG 渲染成透明背景 PNG，因为这条路线能正确尊重 SVG 的 `viewBox`。

**`qlmanage` 只保留为兜底 backend。** 我们实际验证过，某些 macOS 环境下 `qlmanage` 会把 SVG 笔画错误地压到左上角一小块区域，导致生成的 PNG 看起来“大部分是空白背景，原图只有左上角一点”。因此当前 skill 把 `fitz` 作为优先 backend。

**自动着色是 deck-aware 的。** `render --color-mode auto` 会结合 `recommended_color_role`、slide 背景色和主题 accent 色，为每个 icon 选择更合适的颜色，并把结果输出到独立主题目录，避免覆盖默认的中性 PNG。

## 当前边界

**当前系统优先保证稳定插入 PPT。** 现阶段 icon 的稳定落地方式是 `SVG -> PNG -> PPT`。这足以服务“让排版不枯燥”的目标，也便于在不同 workspace 里按主题生成变体。

**当前不承诺原生可编辑矢量 icon。** 如果后续真的需要 SVG 解析成 PowerPoint 原生形状，可以再增加新的路线，但这不属于当前发布版 skill 的硬要求。
