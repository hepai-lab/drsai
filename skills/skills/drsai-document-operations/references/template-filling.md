# DOCX template filling

When the user names a template, query the template library before requesting an upload. If ambiguous, show candidates and ask the user to choose. Inspect every selected template before filling.

The inspector can find Jinja variables, uppercase-leading bracket tokens, and heuristic slots including highlighted text, underscores, label blanks, empty cells, angle brackets, hint text, empty section bodies, and Chinese option-choice groups. It also returns removal candidates. Slots and removals are proposals: show context and obtain confirmation. Skip signature/seal fields. Do not copy surrounding template prose into a slot value.

Fill to a new output path, normally with a `_filled.docx` suffix. Pass confirmed values as `context` or `slot_values`, and only confirmed removal ids as `removal_ids`. Report warnings, missing keys, skipped slots, and applied removals.
