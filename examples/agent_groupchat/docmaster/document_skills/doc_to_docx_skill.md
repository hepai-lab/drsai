# Legacy .doc → .docx Conversion Skill

## Description
Convert uploaded legacy Word `.doc` files (the pre-2007 OLE binary format) into modern `.docx` so DocMaster's other DOCX tools (`python-docx`, template fill, comments, etc.) can work with them. Without this step, `python-docx` cannot open `.doc` files and every downstream tool will fail.

## Skill Metadata
- **Skill Name**: doc_to_docx_skill
- **Category**: Document Conversion
- **Version**: 1.0.0
- **Author**: DocMaster
- **Dependencies**: LibreOffice (`soffice` on PATH). Install: `sudo apt install libreoffice-core libreoffice-writer` (Debian/Ubuntu) or `brew install --cask libreoffice` (macOS). No new Python deps.

## Functionality
- `DocToDocxSkill.convert(input_path, output_path=None)` returns a dict with `success`, `input_path`, `output_path`, and a `message`.
- If the input is already `.docx`, returns success with `note: "already .docx"` and no file changes — safe to call indiscriminately on any uploaded Word file.
- If `soffice` is not installed, returns `success: False` with a clear install hint. Never raises.
- Uses the existing socket-sandbox-aware helper at `skills/docx/scripts/office/soffice.py` so it works in sandboxed VMs that block AF_UNIX sockets.
- Validates the produced file is a real `.docx` (zipfile containing `word/document.xml`) before reporting success.

## Tools exposed to DocMaster

### `convert_doc_to_docx_tool(file_path)`
Convert `.doc` → `.docx`. Returns:

```python
{
  "success": True,
  "input_path":  ".../report.doc",
  "output_path": ".../report.docx",
  "soffice_used": True,
  "message": "Converted report.doc → report.docx"
}
```

If LibreOffice is missing:
```python
{
  "success": False,
  "error": "soffice not found",
  "message": "LibreOffice (soffice) not found on PATH. Install with: `sudo apt install libreoffice-core libreoffice-writer` ..."
}
```

## Recommended conversational flow
1. User uploads a `.doc` file.
2. DocMaster calls `convert_doc_to_docx_tool` with the uploaded path.
3. The agent reads `output_path` from the result and uses that for any subsequent tools (`inspect_docx_template_tool`, `edit_docx_tool`, etc.).
4. If conversion fails (no LibreOffice), DocMaster tells the user and stops — the downstream tools cannot work on `.doc`.

## Limitations
1. **Requires LibreOffice** — there is no pure-Python `.doc` parser that preserves formatting reliably.
2. **Formatting fidelity follows LibreOffice's converter** — usually very good, but exotic features (legacy field codes, embedded OLE objects) may not survive.
3. **No `.rtf` / `.odt`** — this skill only routes `.doc`. Extending to other formats is a one-line `if suffix in (...)` change but not done by default.
