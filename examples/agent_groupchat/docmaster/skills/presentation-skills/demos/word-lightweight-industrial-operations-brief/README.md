# 星澜工业服务运营改善与区域协同简报

这个 demo 注册了一套完整但克制的 `word-polished-doc-collab` 轻量模式 workspace，用来展示当前 skill 在中文正式文档场景下的最小闭环能力：Markdown 语义清楚、正文首行缩进落地、表题加粗、表格对齐稳定、图片题注顺序清楚，并且可以在不引入重型 `meta.json + asset_manifest + 强制 QA bundle` 的前提下交出一份内容丰富的 Word 文档。

## 这个 Demo 覆盖什么

- 中文正式文档默认 profile `cn_song_times`
- 正文 `12pt + 首行缩进 2 字符 + 1.5 倍行距`
- 表题加粗、表头居中、左侧索引列左对齐、右侧数值列右对齐
- 轻量模式下的静态图片插入、图题与图注摆放
- `build -> preview` 的最小交付链路
- 可选的 lint / QA 展示，但不把 review 伪装成轻量模式默认动作

## Workspace Structure

```text
demos/word-lightweight-industrial-operations-brief/
  doc.md
  assets/
  out/
  README.md
```

## Quick CLI

Build the `.docx`:

```bash
python word-polished-doc-collab/scripts/build_docx.py \
  --markdown demos/word-lightweight-industrial-operations-brief/doc.md \
  --output demos/word-lightweight-industrial-operations-brief/out/industrial_operations_brief.docx \
  --style-profile cn_song_times \
  --json-out demos/word-lightweight-industrial-operations-brief/out/build_report.json
```

Export the preview bundle:

```bash
python word-polished-doc-collab/scripts/export_docx_preview.py \
  --docx demos/word-lightweight-industrial-operations-brief/out/industrial_operations_brief.docx \
  --preview-dir demos/word-lightweight-industrial-operations-brief/out/preview \
  --json-out demos/word-lightweight-industrial-operations-brief/out/preview_report.json
```

Optional source lint:

```bash
python word-polished-doc-collab/scripts/lint_doc_markdown.py \
  --markdown demos/word-lightweight-industrial-operations-brief/doc.md \
  --style-profile cn_song_times \
  --workflow-mode lightweight \
  --json-out demos/word-lightweight-industrial-operations-brief/out/markdown_lint.json \
  --md-out demos/word-lightweight-industrial-operations-brief/out/markdown_lint.md
```

Optional DOCX QA showcase:

```bash
python word-polished-doc-collab/scripts/run_docx_qa.py \
  --markdown demos/word-lightweight-industrial-operations-brief/doc.md \
  --docx demos/word-lightweight-industrial-operations-brief/out/industrial_operations_brief.docx \
  --style-profile cn_song_times \
  --workflow-mode lightweight \
  --visual-review demos/word-lightweight-industrial-operations-brief/out/visual_review.md \
  --json-out demos/word-lightweight-industrial-operations-brief/out/qa_report.json \
  --md-out demos/word-lightweight-industrial-operations-brief/out/qa_report.md
```

## Key Outputs

- Source Markdown: `doc.md`
- Final DOCX: `out/industrial_operations_brief.docx`
- Preview PDF: `out/preview/industrial_operations_brief.pdf`
- Optional lint report: `out/markdown_lint.md`
- Optional QA report: `out/qa_report.md`

## Notes

轻量模式默认不强制 `meta.json`、`asset_manifest.json` 和自动 review。这个 demo 额外保留了 lint / QA 命令与一份人工 visual review 记录，是为了演示新脚本链路在轻量模式下也能被显式调用，而不是改变轻量模式本身的默认路由。
