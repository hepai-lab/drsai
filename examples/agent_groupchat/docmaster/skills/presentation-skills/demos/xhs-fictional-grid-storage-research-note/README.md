# XHS Demo - Fictional Grid Storage Research Note

这个 demo 是一个**已经导出成品**的 `xhs-markdown-card-collab` 研究摘要型样例。内容完全虚构，只用于展示研究框架卡片的封面组织和正文层级。

## 这个 demo 展示什么

- 研究摘要 / 观点笔记型封面
- 结论先行的小标题结构
- 编号列表为主的正文展开
- highlights 承接研究问题、方法和结论
- 在不改字号合同的前提下切换到更深色的研究型风格

## 目录结构

```text
demos/xhs-fictional-grid-storage-research-note/
  README.md
  post.md
  out/
    post_01.png
    post_02.png
    post_03.png
    post_preview.html
    post_metadata.json
```

## 已导出的成品

- 源 Markdown：`post.md`
- 封面图：`out/post_01.png`
- 正文第 1 页：`out/post_02.png`
- 正文第 2 页：`out/post_03.png`
- 浏览器预览：`out/post_preview.html`
- 导出元数据：`out/post_metadata.json`

## 成品参数

- 主题：`ink`
- 尺寸：`1080x1440`
- 卡片数：`3`

## 复现命令

在仓库根目录执行：

```bash
python3 -m xhs_md_cards render \
  temp/presentation-skills/demos/xhs-fictional-grid-storage-research-note/post.md \
  -o temp/presentation-skills/demos/xhs-fictional-grid-storage-research-note/out \
  --theme ink
```

## 人工检查结论

- 深色主题下封面和正文对比度仍然足够。
- 研究摘要型正文在当前字号带下保持清晰，没有出现拥挤。
- 结论、问题定义和框架列表的层级区分明确。
- 这个 demo 证明风格变化可以来自主题和内容组织，而不是改小正文字号。

## 说明

示例里的数字、现象和结论均为虚构，不对应任何真实研究结果。
