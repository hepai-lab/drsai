# DOCX Template Fill Skill

## Description
Generate filled `.docx` files from a user-uploaded template. The user authors a Word document, uploads it, tells DocMaster what to fill in, and DocMaster produces a new `.docx` with the values substituted. Supports three input styles so users can pick whichever is easiest to author in Word — including templates that contain **no placeholder syntax at all**.

## Skill Metadata
- **Skill Name**: docx_template_skill
- **Category**: Document Generation
- **Version**: 1.2.0
- **Author**: DocMaster
- **Dependencies**: `python-docx` (already required), `docxtpl` (Jinja-mode only), `jinja2`

## Functionality
1. **Template inspection** — discover Jinja variables, bracket tokens, **a rich set of heuristic slots** (underscore lines, `Label:` patterns, empty table cells, `<angle bracketed>` tokens, placeholder phrases like "Replace this with your bio", italic/grey hint text, and empty bodies under headings), **and removal candidates** (paragraphs that look like template instructions to be deleted before publishing) inside an uploaded `.docx`.
2. **Template filling** — render the template into a new `.docx`, substituting provided values. Headers, footers, and nested tables are covered.
3. **Removal pass** — optionally delete paragraphs/runs the user confirmed are template instructions ("Delete this before submitting", "Note to author: ...", "请删除本段").
4. **Auto mode detection** — picks Jinja vs bracket from the template contents. Mixed templates render Jinja-first, then bracket-substituted. Slot fills always run last; removals run after fills, on the saved output.
5. **Run-level formatting preservation** — only the runs that span the matched placeholder are edited; surrounding runs keep their bold/italic/color/font intact.

## Placeholder & slot styles

### 1. Jinja (via `docxtpl`)
Powerful: variables, loops, conditionals, table-row repetition.

```
{{ name }}                        — variable substitution
{% if vip %}…{% endif %}          — conditional block
{% for item in items %}…{% endfor %}   — loop (inline)
{%p for item in items %}…{%p endfor %} — paragraph-level loop
{%tr for row in rows %}…{%tr endtr %}  — repeats a TABLE ROW per item
```

The `context` argument is a regular Python dict matching the variable names.

### 2. Bracket (plain `python-docx`)
Simple literal substitution. Tokens must be **uppercase-leading** and contain only A–Z, 0–9, `_`, `-`. Examples that match: `[NAME]`, `[ORDER_ID]`, `[DATE_2026]`. Examples that DO NOT match (intentional, so prose like `[see fig.1]` is not replaced): `[name]`, `[see fig.1]`, `[Some Text]`.

```python
{"NAME": "Alice", "DATE": "2026-05-13"}   # fills [NAME] and [DATE]
```

### 3. Heuristic slots (no placeholder syntax required)
For templates that users authored without thinking about placeholders. The inspector scans the document and returns slot candidates of eight kinds:

| Kind | Trigger | Where the value goes |
|---|---|---|
| `highlighted` | One or more **consecutive runs with a Word highlight** (yellow, green, cyan, magenta, etc.). The strongest authoring signal — users often highlight exactly the spans they want changed. | The highlighted text is replaced AND the highlight is cleared on fill (final document looks clean). All other run formatting (font, size, bold/italic, color) is preserved. The slot also surfaces `span_text` (full original highlighted text) and, when applicable, a `scaffold` split — when the highlighted span matches `<number><unit>` (e.g. `15个工作日`, `¥850`, `50%`) and the user-provided `slot_values` reply is a bare number, the prefix/suffix scaffolding is auto-reattached so "20" becomes "20个工作日". |
| `underscores` | A run of 3+ underscores (`___+`) anywhere in a paragraph | The underscore characters are replaced in place |
| `label_blank` | A paragraph whose entire text is `Label:` (Chinese full-width `：` also OK) with nothing after | The value is appended after the label, inheriting the label's run formatting |
| `empty_cell` | A table cell with no text, where either the column header (row 0) or the row label (col 0) contains text | The value is written into the empty cell |
| `angle_bracketed` | `<your name>`, `<insert title>`, or full-width `《姓名》` | The bracketed token is replaced in place |
| `placeholder_phrase` | Bilingual phrase bank: "your text here", "lorem ipsum", "TBD", "TODO", "Replace this with…", "(insert …)", "请填写…", "待填写", etc. | Either the matched span (if short) or the whole paragraph (if the phrase covers ≥60% of the paragraph) is replaced |
| `hint_text` | A run that is italic **or** rendered in light grey / red AND looks instructional ("(your bio here)", "Example: …", "（请填写）") | Just the hint run is replaced; surrounding text and formatting stay intact |
| `section_body_empty` | A `Heading N` / `Title` / `标题 N` paragraph immediately followed by an empty body paragraph | Text is written into that empty body paragraph |

Each slot comes back with:
- `id` — opaque string like `"slot_3"`. Use this as the key in `slot_values`.
- `kind` — one of the seven above.
- `label` — best-guess field name (e.g. "Patient Name"), or `None` for a stray underscore line with no surrounding label.
- `context` — surrounding text snippet for disambiguation.

**Slots are *candidates*, not commitments.** A long underscore line could be a decorative separator; "Notes:" with nothing after could be intentionally blank; an italic note could be intentional prose. DocMaster should confirm each slot with the user before passing it in `slot_values`.

### 4. Removal candidates (template instructions to be deleted)
Many templates contain instructions to the author that should not survive in the final document — "Delete this paragraph before submitting", "Note to reviewer: ...", "仅供参考", "使用前请删除". The inspector returns these as a separate `removals` list with two kinds:

| Kind | Trigger | What gets deleted |
|---|---|---|
| `instruction_paragraph` | A paragraph whose text matches the removal phrase bank for ≥50% of its length, **or** every run in the paragraph is styled like a hint (italic / grey / red) and the bank matches anywhere | The entire paragraph is removed from the document |
| `instruction_run` | The removal-bank phrase only covers part of a paragraph (so the rest is real content), or it lives in a hint-styled run inside otherwise normal prose | Only the matched run is blanked; the paragraph is removed only if it becomes empty |

Removal entries have `{id, kind, text, reason}` — the agent should read each to the user and confirm before passing approved ids via `fill_docx_template_tool`'s `removal_ids`. **Never auto-delete.**

## Tools exposed to DocMaster

### `inspect_docx_template_tool(template_path)`
Returns the detected style, the list of placeholders, and the list of slot candidates.

```python
{
  "success": True,
  "template_path": "...",
  "mode_detected": "bracket",        # or "jinja" / "both" / "none"
  "jinja_variables": [],
  "bracket_tokens":  ["NAME", "DATE"],
  "has_loops":       False,
  "has_conditionals": False,
  "slots": [
    {"id": "slot_0", "kind": "underscores",
     "label": "Patient Name", "context": "Patient Name: __________"},
    {"id": "slot_1", "kind": "label_blank",
     "label": "Diagnosis",    "context": "Diagnosis:"},
    {"id": "slot_2", "kind": "angle_bracketed",
     "label": "your name",    "context": "Dear <your name>, welcome."},
    {"id": "slot_3", "kind": "placeholder_phrase",
     "label": "Replace this with your bio here",
     "context": "Replace this with your bio here."},
    {"id": "slot_4", "kind": "hint_text",
     "label": "Author",       "context": "Author: (insert your full name)"},
    {"id": "slot_5", "kind": "section_body_empty",
     "label": "Background",
     "context": "(empty body under heading 'Background')"},
    {"id": "slot_6", "kind": "empty_cell",
     "label": "Value",        "context": "[empty cell, row='Age', col='Value']"},
  ],
  "removals": [
    {"id": "rm_0", "kind": "instruction_paragraph",
     "text": "Delete this paragraph before submitting.",
     "reason": "Delete this paragraph before submitting"},
    {"id": "rm_1", "kind": "instruction_paragraph",
     "text": "请删除本段使用前。",
     "reason": "请删除本段"},
  ],
  "warnings": [
    "2 instructional/meta-text passage(s) detected as removal candidates. "
    "Read each to the user and confirm before deleting; pass the confirmed ids "
    "via fill_docx_template_tool's removal_ids."
  ],
  "message":  "mode=bracket, 0 jinja var(s), 2 bracket token(s), 7 heuristic slot(s), 2 removal candidate(s)"
}
```

### `fill_docx_template_tool(template_path, output_path, context, mode="auto", slot_values=None, removal_ids=None)`
Renders the template into `output_path`. If `removal_ids` is provided, the listed removal candidates from the inspect output are deleted after the fill passes complete.

```python
{
  "success": True,
  "template_path": "...",
  "output_path":   "...",
  "mode_used":     "bracket+slots",   # or "jinja" / "bracket" / "slots" / "both"
  "filled_keys":   ["DATE", "NAME"],
  "missing_keys":  [],
  "unused_keys":   [],
  "substitutions": 2,
  "slot_fill": {
    "filled_slot_ids":  ["slot_0", "slot_1", "slot_2"],
    "unknown_slot_ids": [],
    "skipped_slot_ids": [],
  },
  "removals_applied": ["rm_0", "rm_1"],
  "removals_skipped": [],
  "warnings":      [],
  "message":       "Performed 2 bracket substitution(s); 0 placeholder(s) left unfilled. Filled 3/3 slot(s).",
}
```

## Usage examples

### Bracket + slots (a user-uploaded form)
Template `intake_form.docx` (no Jinja syntax, just a Word form):
```
Patient Name: ____________
Date of Visit: [DATE]
Diagnosis:
```
+ a table with header row `Field | Value` and a row `Age | <empty>`.

```python
inspect = inspect_docx_template_tool(".../intake_form.docx")
# inspect["slots"] tells DocMaster: slot_0=underscores ("Patient Name"),
# slot_1=label_blank ("Diagnosis"), slot_2=empty_cell ("Value" under "Age" row).
# DocMaster confirms each with the user.

fill_docx_template_tool(
    template_path=".../intake_form.docx",
    output_path  =".../intake_form_filled.docx",
    context      ={"DATE": "2026-05-13"},
    slot_values  ={"slot_0": "Alice Wong", "slot_1": "Mild hypertension", "slot_2": "42"},
)
```

### Jinja template
Template `contract_tpl.docx`:
```
Party A: {{ party_a }}
Party B: {{ party_b }}
Date: {{ date }}

Items (in a table):
{%tr for item in items %}
| {{ item.sku }} | {{ item.price }} |
{%tr endtr %}
```

```python
fill_docx_template_tool(
    template_path=".../contract_tpl.docx",
    output_path  =".../contract_filled.docx",
    context={
        "party_a": "张三",
        "party_b": "李四",
        "date":    "2026-05-13",
        "items":   [{"sku": "A1", "price": "100"},
                    {"sku": "B2", "price": "200"}],
    },
)
```

## Formatting preservation

Bracket and slot fills are run-aware: only the runs that overlap the matched span are modified. Concretely:

- A paragraph like **`Patient: `**`[NAME]`** — confirmed.** (bold/italic/red on the `[NAME]` run) becomes **`Patient: `***Alice*** — confirmed.** with the bold/italic/color staying exactly where they were.
- A paragraph with bold `Name:`, a plain `__________`, and italic ` (please print)` keeps the bold label and the italic hint after the underscore is replaced.

This replaces the previous behavior, which collapsed the entire paragraph into the first run whenever any token was touched.

## Limitations
1. **Replacements span ≥1 run** — when a placeholder is split across multiple runs by Word (often after edits/spellcheck), the replacement text adopts the *first* spanned run's formatting. Adjacent unrelated runs are untouched.
2. **No image substitution** — `{{ logo }}` resolving to an image requires `docxtpl.InlineImage`; not implemented here.
3. **No rich-text injection** — substituted values are plain text. For bold/italic spans inside an inserted value, use `docxtpl.RichText` in Jinja mode.
4. **No textbox / shape text** — `python-docx` does not expose those; tokens or slots inside textboxes or shapes will not be replaced.
5. **Nested-key unused detection (Jinja)** — `unused_keys` only checks top-level context keys.
6. **Bracket tokens are case-sensitive and uppercase-leading** — by design, to avoid rewriting prose that uses square brackets normally.
7. **Heuristic slots are guesses** — stray underscore lines, decorative separators, or genuinely-empty cells can all surface as slots. Always confirm with the user before passing a slot id in `slot_values`.

## Recommended conversational flow
1. User uploads a `.docx` template.
2. DocMaster calls `inspect_docx_template_tool` to discover placeholders, slots, **and removal candidates**.
3. For each variable / token / slot, DocMaster asks the user for the value (skipping anything the user already provided in conversation). For ambiguous slots, DocMaster shows the `context` snippet and confirms intent.
4. For each entry in `removals`, DocMaster reads the text aloud and asks "should this be deleted from the final document?" Approved ids are collected.
5. DocMaster calls `fill_docx_template_tool` with `context` (for placeholders), `slot_values` (for heuristic slots), and `removal_ids` (for approved removals), using a `_filled.docx` suffix on the template's original name so the template is not overwritten.
6. The generated file appears in the UI downloads panel via the existing FilesEvent pipeline.
