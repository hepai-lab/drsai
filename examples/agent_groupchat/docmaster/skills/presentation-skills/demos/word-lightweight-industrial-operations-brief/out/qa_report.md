# DOCX QA Report

- 自动检查是否全部通过：`True`
- 全部检查是否通过：`True`
- style profile：`cn_song_times`
- workflow mode：`lightweight`
- Markdown：`/project/lisiyuan2/Projects/AgenticMoe/references/presentation-skills/demos/word-lightweight-industrial-operations-brief/doc.md`
- DOCX：`/project/lisiyuan2/Projects/AgenticMoe/references/presentation-skills/demos/word-lightweight-industrial-operations-brief/out/industrial_operations_brief.docx`
- Asset manifest：`None`
- Visual review：`/project/lisiyuan2/Projects/AgenticMoe/references/presentation-skills/demos/word-lightweight-industrial-operations-brief/out/visual_review.md`

## source_integrity

- passed: `True`
- detail: Markdown、DOCX 与图片资产完整，基础 source 契约通过。

## style_contract

- passed: `True`
- detail: 段落、缩进、表题加粗和表格对齐契约通过，共检查 40 个段落样本。

## font_slot_integrity

- passed: `True`
- detail: 全部 131 个文本 run 都具备完整字体槽位。

## block_sequence

- passed: `True`
- detail: 文档 block 顺序与 Markdown 一致，共检查 44 个 block。

## section_contract

- passed: `True`
- detail: section 栏数契约通过，全部为单栏：[1]。

## asset_manifest_integrity

- passed: `True`
- detail: 当前不是精细模式，因此跳过 asset manifest 强制检查。

## visual_review_status

- passed: `True`
- detail: 已发现 visual review 记录: /project/lisiyuan2/Projects/AgenticMoe/references/presentation-skills/demos/word-lightweight-industrial-operations-brief/out/visual_review.md

