# DOCX editing

Inspect first for non-trivial changes. Use dedicated tools for extraction, creation, editing, fonts, deletion, and comments. For several edits, put the complete edit list in one `edit_docx_tool` call.

For replacement, copy `old_text` exactly from extraction, including whitespace and punctuation. Prefer position-aware insertion. Use `set_cell_text` or `replace_in_cell` for table cells, and `delete_paragraph` for real deletion. Do not manipulate comments XML.

For vague requests, identify the file and target section, inspect it, then ask for missing intent or present a concrete edit plan. If `changes` is empty, say no edit was performed.
