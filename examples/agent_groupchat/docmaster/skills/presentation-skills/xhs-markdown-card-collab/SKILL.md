---
name: xhs-markdown-card-collab
description: Use when collaborating with humans to turn Markdown or lightly structured text into publishable Xiaohongshu image-card posts with explicit cover metadata, stable Chinese typography, browser-based pagination, and visual QA. Supports Markdown cleanup, cover planning, style-direction selection, page-density review, and iteration while keeping proven type-size ranges stable.
---

# XHS Markdown Card Collab

## 概览

把“整理 Markdown 语义、定义封面信息、生成竖版卡片、检查分页和视觉问题”作为同一个任务完成。
默认服务 **小红书图文卡片**，不是普通海报，也不是可随意拉伸字号的一次性截图导出。

这个 skill 的核心不是“把 Markdown 转成图片”这件事本身，而是把它收敛成一条稳定工作流：
- 显式封面字段优先
- 浏览器真实排版优先
- 先调内容结构，再调视觉细节
- 版式参数有验证过的锁定区间，不要把大幅改字号当成默认手段

## 默认工作流

按下面顺序执行，避免把卡片任务退化成“调一版截图看运气”。

1. **先锁任务与宿主路线**
- 明确目标平台是不是小红书图文卡片，而不是 PPT 封面、海报或视频字幕图。
- 明确内容源是不是 Markdown；如果不是，先整理成 Markdown 或接近 Markdown 的语义文本。
- 优先寻找宿主仓库里现成的 Markdown-to-card 渲染器；如果已经存在稳定 CLI，不要重写实现。
- 默认目标尺寸使用 `1080x1440` 的 `3:4` 竖图。

2. **先最小化整理 Markdown 语义**
- 保留原文语义，只补最必要的 `#`、`##`、`-`、编号列表和少量 `**加粗**`。
- 如果原文本来只是松散段落，优先增加章节标题和标准列表，不要擅自重写内容。
- 不要为了排版好看把正文改写成另一篇文案。真实经验表明，这种做法最容易让内容漂移。
- 如果原文是已有发布文案，只在“标题层级、列表、少量重点强调”三个层面做轻改。

3. **显式定义封面元数据**
- 默认使用 Markdown 顶部 YAML front matter，而不是依赖启发式抽取封面信息。
- 优先显式提供 `title`、`xhs.footer` 和 `xhs.cover.*` 字段。
- 封面 headline、organization、role_line、badges、highlights 应视为发布配置，不应混进正文分页。
- 需要高信息密度封面时，先补封面字段，再考虑视觉调整；不要先用缩小字体解决信息缺失。

4. **锁定排版合同，再选视觉方向**
- 先读取 `references/typography_lock.md`，默认遵守已经验证过的字号、留白、边框和行高。
- 只在明确出现溢出、拥挤或空洞问题时，才在小范围内微调；不要一开始就大改字体。
- 页面风格的变化优先来自主题、色彩、装饰、信息组织和语气，而不是来自重写整套字号。
- 需要找变化方向时，再读取 `references/style_directions.md`。

5. **生成后先做真实视觉 QA**
- 必须产出逐页 PNG；如果宿主实现支持 `_preview.html`，必须同时查看它。
- 逐页检查封面密度、标题换行、页尾是否留出过多空白、是否出现标题孤立在页底、列表编号是否断裂、长邮箱或英文串是否压坏布局。
- 如果发现标题单独挂在页末，应优先通过分页规则或内容结构修复，而不是靠手工插空行遮掩。
- 如果边框和背景占比过大，应优先缩窄外留白和内容面板边距，而不是继续压缩正文尺寸。

6. **迭代顺序固定**
- 第一优先级：修内容结构和 front matter。
- 第二优先级：修分页与孤立标题。
- 第三优先级：修封面信息密度与边框占比。
- 第四优先级：在锁定字号范围内做小幅视觉微调。
- 不要反过来先大调字体，再回头补语义和封面字段。

7. **交付时带上可复核产物**
- 至少交付：原始 Markdown、带 front matter 的 canonical Markdown、逐页 PNG、预览 HTML（如果有）、元数据 JSON（如果有）。
- 没有逐页图的卡片任务不算完成。
- 只有命令成功、没有人工看过图片，也不算完成。

## 资源路由

**默认先读**
- `references/workflow.md`：看 front matter 结构、宿主 CLI 契约、QA 清单和常见返工顺序。

**排版固定规则**
- `references/typography_lock.md`：看已经验证过的字号、行高、边距、卡片尺寸与可接受的小范围微调带。

**风格变化方向**
- `references/style_directions.md`：看如何在不破坏已验证排版合同的前提下做出不趋同的页面风格。

## 质量标准

- 默认输出必须适合手机纵向滑读，不能把普通网页截图直接当卡片交付。
- 默认正文必须清晰、对比足够、列表和标题层级稳定，不能出现“看起来有设计，但读起来累”的情况。
- 风格允许变化，但不应靠随意压缩正文、过度缩小留白或大幅改字号来做假变化。
- 封面应承担“抓眼 + 定义任务”的职责，不能信息过空，也不能变成满屏贴标签。
- 当前验证过的排版合同优先级高于“临时想试试更大/更小字号”的冲动。

## 宿主 CLI 契约

如果宿主仓库已经有稳定实现，优先把 skill 路由到宿主 CLI，而不是在 skill 目录内重写一套实现。

一个已验证的宿主命令形态可以是：

```bash
python3 -m xhs_md_cards render INPUT.md -o <output_dir>
```

宿主实现理想上应具备这些能力：
- Markdown front matter 解析
- 显式封面字段渲染
- 浏览器真实排版
- 自动分页
- 逐页 PNG 导出
- HTML 预览和元数据输出

如果宿主实现暂时没有这些能力，应先补能力边界最明显的部分，不要对外假装“已经能稳定发布”。

## 已验证经验

- 显式 front matter 比启发式封面抽取稳定得多。
- 长中文标题适合强封面，但必须配合更窄外边距和更高首页信息密度。
- 正文语义只做轻量补标记，比大幅改写文案更稳。
- 小红书卡片的正文不是 print 文档，正文字号需要明显偏大，但一旦跑通就不应频繁重设。
- 风格去同质化应优先从主题 token、信息组织和装饰节奏入手，而不是频繁推翻字号体系。
