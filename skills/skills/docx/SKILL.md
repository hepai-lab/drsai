---
name: docx
description: "Use this skill whenever the user wants to create, read, edit, or manipulate Word documents (.docx files). Triggers include: any mention of 'Word doc', 'word document', '.docx', or requests to produce professional documents with formatting like tables of contents, headings, page numbers, or letterheads. Also use when extracting or reorganizing content from .docx files, inserting or replacing images in documents, performing find-and-replace in Word files, working with tracked changes or comments, or converting content into a polished Word document. If the user asks for a 'report', 'memo', 'letter', 'template', or similar deliverable as a Word or .docx file, use this skill. Do NOT use for PDFs, spreadsheets, Google Docs, or general coding tasks unrelated to document generation."
license: Proprietary. LICENSE.txt has complete terms
---

# DOCX creation, editing, and analysis

## Overview

A .docx file is a ZIP archive containing XML files.

**Skill location:** `skills/docx/` relative to the DocMaster working directory.

**Available tools:** When this skill is loaded, these tools are available to the agent:
- `unpack_docx_tool` - Extract DOCX to editable XML directory
- `pack_docx_tool` - Repack XML directory back to DOCX
- `validate_docx_tool` - Validate DOCX against OOXML schemas
- `accept_tracked_changes_tool` - Accept all tracked changes via LibreOffice
- `add_xml_comment_tool` - Add comments to unpacked DOCX XML

## Quick Reference

| Task | Approach |
|------|----------|
| Read/analyze content | `pandoc` for text extraction, or `unpack_docx_tool` for raw XML |
| Create new document | Use python-docx — see Creating New Documents below |
| Edit existing document | `edit_docx_tool` first, then unpack/edit/pack if needed — see Editing Existing Documents below |
| Insert image | Use `edit_docx_tool` with `insert_image` edit type |
| Unpack for XML editing | `unpack_docx_tool(file_path, output_dir)` |
| Repack after XML editing | `pack_docx_tool(input_dir, output_file, original_file)` |
| Accept tracked changes | `accept_tracked_changes_tool(input_file, output_file)` |

### Converting .doc to .docx

Legacy `.doc` files must be converted before editing using LibreOffice:
```bash
soffice --headless --convert-to docx document.doc
```

### Reading Content

```bash
# Text extraction
pandoc document.docx -o output.md

# Raw XML access - use the tool directly
# unpack_docx_tool(file_path="document.docx", output_dir="unpacked/")
```

### Converting to Images

```bash
soffice --headless --convert-to pdf document.docx
pdftoppm -jpeg -r 150 document.pdf page
```

### Accepting Tracked Changes

Use the `accept_tracked_changes_tool` to produce a clean document with all tracked changes accepted (requires LibreOffice):
```
accept_tracked_changes_tool(input_file="input.docx", output_file="output.docx")
```

---

## Creating New Documents

Use python-docx (already installed). Install: `pip install python-docx`

### Setup
```python
from docx import Document
from docx.shared import Pt, Inches, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH

doc = Document()

# Add a heading
doc.add_heading("Title", level=1)

# Add a paragraph
p = doc.add_paragraph("This is a paragraph of text.")
p.runs[0].font.name = "Arial"
p.runs[0].font.size = Pt(12)

# Add a table
table = doc.add_table(rows=2, cols=2)
table.cell(0, 0).text = "Header 1"
table.cell(0, 1).text = "Header 2"
table.cell(1, 0).text = "Data 1"
table.cell(1, 1).text = "Data 2"

# Add an image (width in inches)
from docx.shared import Inches
doc.add_picture("image.png", width=Inches(5))
doc.save("output.docx")
```

### Validation
After creating the file, validate it:
```
validate_docx_tool(path="output.docx", auto_repair=True)
```

### Page Size

```python
section = doc.sections[0]
# US Letter (8.5 x 11 inches)
section.page_width = Inches(8.5)
section.page_height = Inches(11)
section.left_margin = Inches(1)
section.right_margin = Inches(1)
section.top_margin = Inches(1)
section.bottom_margin = Inches(1)
```

### Lists (NEVER manually insert bullet characters)

```python
# Add a bullet list
for item in ["First item", "Second item", "Third item"]:
    p = doc.add_paragraph(item, style="List Bullet")

# Add a numbered list
for item in ["Step 1", "Step 2", "Step 3"]:
    p = doc.add_paragraph(item, style="List Number")
```

### Tables

```python
table = doc.add_table(rows=3, cols=3)
table.style = "Table Grid"

# Access cells
cell = table.cell(0, 0)
cell.text = "Header"

# Apply formatting to cell
from docx.oxml.ns import qn
from docx.shared import RGBColor

# Set cell background color
tc = cell._tc
tcPr = tc.get_or_add_tcPr()
shd = OxmlElement('w:shd')
shd.set(qn('w:fill'), 'D5E8F0')  # Light blue background
tcPr.append(shd)

# Set cell margins (padding)
tc = cell._tc
tcPr = tc.get_or_add_tcPr()
tcMar = OxmlElement('w:tcMar')
for side in ['top', 'bottom', 'left', 'right']:
    mar = OxmlElement(f'w:{side}')
    mar.set(qn('w:w'), '80')   # DXA units (1440 = 1 inch)
    mar.set(qn('w:type'), 'dxa')
    tcMar.append(mar)
tcPr.append(tcMar)
```

### Images

```python
# Add image with specific width (proportional scaling)
run = doc.add_paragraph().add_run()
run.add_picture("image.png", width=Inches(5))

# Center the image paragraph
doc.add_paragraph().alignment = WD_ALIGN_PARAGRAPH.CENTER
```

### Page Breaks

```python
doc.add_page_break()
# Or in a paragraph
doc.add_paragraph()
doc.paragraphs[-1].add_run().add_break(WD_BREAK.PAGE)
```

### Headers / Footers

```python
from docx.shared import Pt
section = doc.sections[0]

# Header
header = section.header
header.is_linked_to_previous = False
h_para = header.paragraphs[0]
h_para.text = "Document Title"
h_para.alignment = WD_ALIGN_PARAGRAPH.CENTER

# Footer with page number
footer = section.footer
f_para = footer.paragraphs[0]
f_para.text = "Page "
f_para.add_run().add_field("PAGE")
f_para.add_run(" of ")
f_para.add_run().add_field("NUMPAGES")
f_para.alignment = WD_ALIGN_PARAGRAPH.CENTER
```

### Critical Rules

- **Always set page size explicitly** - defaults vary by platform
- **Use `List Bullet` / `List Number` styles** - never manually insert bullet characters
- **Use DXA units for XML-level sizing** - 1440 DXA = 1 inch
- **Table width: set on the table element** - also set width on each cell
- **Always add cell margins** - prevents text from touching cell borders
- **Use `ShadingType.CLEAR` equivalent** - set `w:fill` on `w:shd` element, not SOLID

---

## Editing Existing Documents

### Use `edit_docx_tool` FIRST for ALL modifications

`edit_docx_tool` is the primary tool for editing DOCX files. It handles:
- Text replacement with `replace_text` type
- Adding paragraphs, headings, tables, lists at specific positions
- Page headers and footers
- Font and style modifications
- Image insertion

**Image insertion** must use `edit_docx_tool`:
```json
{
  "type": "insert_image",
  "image_path": "/absolute/path/to/image.png",
  "position": 0,
  "width_inches": 5.0
}
```

### When NOT to use `replace_text`

`replace_text` replaces **ALL matching occurrences** in the document. This causes problems when the same text (like "1. xxx") appears in multiple sections.

**Prefer using positions for targeted edits:**
- Use `extract_docx_content_tool` to see document structure with paragraph indices
- Use `add_paragraph` or `add_heading` with `position` parameter to insert at a specific location
- Avoid `replace_text` when the target text might appear in multiple places

### Direct XML Editing — ONLY as last resort

Use the unpack/edit/pack workflow only when `edit_docx_tool` genuinely cannot do the job:
- Adding tracked changes with author attribution (deletions + insertions)
- Complex multi-file XML manipulation that `edit_docx_tool` doesn't support

Do NOT use XML editing as a "fallback whenever `replace_text` is tricky."

### Direct XML Editing Workflow (advanced cases only)

If `edit_docx_tool` is insufficient, follow all 3 steps in order:

#### Direct XML Step 1: Unpack
```
unpack_docx_tool(file_path="document.docx", output_dir="unpacked/")
```
Extracts XML, pretty-prints, merges adjacent runs, and converts smart quotes to XML entities (`&#x201C;` etc.) so they survive editing.

#### Direct XML Step 2: Edit XML

Use `run_read` to view `unpacked/word/document.xml`, then use `run_edit` to modify. See XML Reference below for patterns.

**Use "Claude" as the author** for tracked changes and comments, unless the user explicitly requests use of a different name.

**Use the Edit tool directly for string replacement. Do not write Python scripts.** Scripts introduce unnecessary complexity. The Edit tool shows exactly what is being replaced.

**CRITICAL: Use smart quotes for new content.** When adding text with apostrophes or quotes, use XML entities to produce smart quotes:
```xml
<!-- Use these entities for professional typography -->
<w:t>Here&#x2019;s a quote: &#x201C;Hello&#x201D;</w:t>
```
| Entity | Character |
|--------|-----------|
| `&#x2018;` | ' (left single) |
| `&#x2019;` | ' (right single / apostrophe) |
| `&#x201C;` | " (left double) |
| `&#x201D;` | " (right double) |

**Adding comments:** Use the `add_xml_comment_tool` to handle boilerplate across multiple XML files (text must be pre-escaped XML):
```
add_xml_comment_tool(unpacked_dir="unpacked/", comment_id=0, text="Comment text with &amp; and &#x2019;", author="Claude", initials="C")
add_xml_comment_tool(unpacked_dir="unpacked/", comment_id=1, text="Reply text", author="Claude", initials="C", parent_id=0)  # reply to comment 0
```
Then add markers to document.xml (see Comments in XML Reference).

#### Direct XML Step 3: Pack
```
pack_docx_tool(input_dir="unpacked/", output_file="output.docx", original_file="document.docx", run_validation=True)
```
Validates with auto-repair, condenses XML, and creates DOCX.

**Auto-repair will fix:**
- `durableId` >= 0x7FFFFFFF (regenerates valid ID)
- Missing `xml:space="preserve"` on `<w:t>` with whitespace

**Auto-repair won't fix:**
- Malformed XML, invalid element nesting, missing relationships, schema violations

#### Accepting Tracked Changes

To produce a clean document with all tracked changes accepted (requires LibreOffice):
```
accept_tracked_changes_tool(input_file="document_with_changes.docx", output_file="clean_document.docx")
```

### Direct XML Common Pitfalls

- **Replace entire `<w:r>` elements**: When adding tracked changes, replace the whole `<w:r>...</w:r>` block with `<w:del>...<w:ins>...` as siblings. Don't inject tracked change tags inside a run.
- **Preserve `<w:rPr>` formatting**: Copy the original run's `<w:rPr>` block into your tracked change runs to maintain bold, font size, etc.

---

## XML Reference

### Document Structure

```
document.docx
├── [Content_Types].xml
├── _rels/
│   └── .rels
└── word/
    ├── document.xml        ← main content
    ├── styles.xml          ← style definitions
    ├── settings.xml        ← document settings
    ├── comments.xml        ← comments
    ├── commentsExtended.xml
    ├── people.xml
    ├── header1.xml         ← headers
    ├── footer1.xml         ← footers
    ├── media/              ← images
    │   └── image1.png
    ├── _rels/
    │   └── document.xml.rels
    └── theme/
        └── theme1.xml
```

### Paragraph XML

```xml
<w:p>
  <w:pPr>                        ← paragraph properties
    <w:jc w:val="left"/>         ← alignment: left/center/right/both
    <w:spacing w:before="240" w:after="120"/>
    <w:ind w:left="720" w:hanging="360"/>
  </w:pPr>
  <w:r>                          ← run (text with formatting)
    <w:rPr>                      ← run properties
      <w:b/>                     ← bold
      <w:i/>                     ← italic
      <w:sz w:val="24"/>         ← font size (half-points)
      <w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="宋体"/>
      <w:color w:val="FF0000"/>  ← red text
    </w:rPr>
    <w:t xml:space="preserve">   ← text content
      Hello World
    </w:t>
  </w:r>
</w:p>
```

### Table XML

```xml
<w:tbl>
  <w:tblPr>
    <w:tblW w:w="9360" w:type="dxa"/>  ← width in DXA
    <w:tblBorders>
      <w:top w:val="single" w:sz="4" w:color="CCCCCC"/>
      <w:bottom w:val="single" w:sz="4" w:color="CCCCCC"/>
      <w:left w:val="single" w:sz="4" w:color="CCCCCC"/>
      <w:right w:val="single" w:sz="4" w:color="CCCCCC"/>
    </w:tblBorders>
  </w:tblPr>
  <w:tr>
    <w:tc>
      <w:tcPr>
        <w:tcW w:w="4680" w:type="dxa"/>
      </w:tcPr>
      <w:p><w:r><w:t>Cell content</w:t></w:r></w:p>
    </w:tc>
  </w:tr>
</w:tbl>
```

### Image / Media Reference

Images are stored in `word/media/`. Add a reference in `word/_rels/document.xml.rels`:
```xml
<Relationship Id="rId99"
  Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
  Target="media/image1.png"/>
```

Insert in document.xml:
```xml
<w:drawing>
  <wp:inline>
    <wp:extent cx="4572000" cy="3429000"/>  ← EMU units (914400 EMU = 1 inch)
    <a:graphic>
      <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
        <pic:pic>
          <pic:blipFill>
            <a:blip r:embed="rId99"/>
          </pic:blipFill>
        </pic:pic>
      </a:graphicData>
    </a:graphic>
  </wp:inline>
</w:drawing>
```

### Tracked Changes

Insertion:
```xml
<w:ins w:id="1" w:author="Author Name" w:date="2025-01-01T00:00:00Z">
  <w:r><w:t>inserted text</w:t></w:r>
</w:ins>
```

Deletion:
```xml
<w:del w:id="2" w:author="Author Name" w:date="2025-01-01T00:00:00Z">
  <w:r><w:delText>deleted text</w:delText></w:r>
</w:del>
```

### Comments

```xml
<!-- In document.xml where comment marker should appear: -->
<w:commentRangeStart w:id="0"/>
<w:r><w:t>commented text</w:t></w:r>
<w:commentRangeEnd w:id="0"/>
<w:r><w:commentReference w:id="0"/>
```

### Page Breaks

```xml
<w:p>
  <w:r>
    <w:br w:type="page"/>
  </w:r>
</w:p>
```

### Section Properties (Page Layout)

```xml
<w:sectPr>
  <w:pgSz w:w="12240" w:h="15840"/>   ← US Letter in DXA
  <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"
           w:header="720" w:footer="720" w:gutter="0"/>
</w:sectPr>
```

### Common Measurement Units

| Unit | Description | Conversions |
|------|-------------|-------------|
| DXA | Twentieths of a point | 1440 DXA = 1 inch |
| EMU | English Metric Units | 914400 EMU = 1 inch |
| Half-points | Font size units | 24 half-points = 12pt |

---

## Dependencies

| Tool | Install | Purpose |
|------|---------|---------|
| python-docx | `pip install python-docx` | Create/edit docx files |
| pandoc | `sudo apt install pandoc` | Extract text from docx |
| libreoffice | `sudo apt install libreoffice` | Convert .doc to .docx, accept tracked changes |
| poppler-utils | `sudo apt install poppler-utils` | PDF to image conversion |
