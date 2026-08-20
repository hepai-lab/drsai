"""
DOCX template inspection and filling tools.
"""

from pathlib import Path
from .. import get_pending_events


def _guard_template_path(template_path) -> dict | None:
    """Validate template_path before calling DocxTemplateSkill.

    Returns an error dict (to be returned directly to the agent) when the
    path is empty / relative / non-existent. Returns None when the path is
    acceptable. The error messages are intentionally directive — the LLM
    has a habit of falling back to run_glob / run_bash when a tool call
    fails, which can silently pick up the wrong copy of a template (e.g.
    a stray export under downloads/). Spelling out the recovery in the
    tool error lands in fresh attention and is followed reliably.
    """
    if not template_path or not isinstance(template_path, str):
        return {
            "success": False,
            "error": "Missing template_path",
            "message": (
                "template_path is required. If the user named a template, call "
                "get_template_path_tool first and use the absolute template_path "
                "it returns. Do NOT use run_glob / run_bash / run_read to find "
                "template files — those can pick the wrong copy of the template."
            ),
        }
    p = Path(template_path)
    if not p.is_absolute():
        return {
            "success": False,
            "error": "Relative template_path not accepted",
            "message": (
                f"template_path={template_path!r} is a relative path. Use the "
                "absolute path returned by get_template_path_tool (the same value "
                "you received earlier in this conversation — re-call "
                "get_template_path_tool with the template name if you lost it). "
                "Do NOT pass bare filenames like 'template.docx', and do NOT use "
                "run_glob / run_bash / run_read to search the filesystem for the "
                "template — it can find a stale duplicate under downloads/ and "
                "bypass the template library."
            ),
        }
    if not p.exists():
        return {
            "success": False,
            "error": "Template file not found",
            "message": (
                f"No file at {template_path}. If you got this path from "
                "get_template_path_tool, the catalog entry may be stale — call "
                "list_templates_tool then get_template_path_tool again. If the "
                "user uploaded the template earlier in the session, re-check the "
                "absolute path from the upload event. Do NOT use run_glob / "
                "run_bash / run_read to search for template files — those bypass "
                "the template library and can pick up an old export."
            ),
        }
    return None


def _build_files_event_data(file_path: str, description: str) -> dict | None:
    """
    Build a serialized FilesEvent payload for a generated/edited file.

    Tries to upload via HepAI filesystem (URL method) first.
    Falls back to base64 encoding if the upload fails.

    Returns a dict (serialized ``FilesContent``) to be appended to the
    pending files-events side-channel, or *None* if both methods fail.
    """
    import mimetypes
    import base64
    from drsai.modules.managers.messages import FileInfo, FilesContent
    from drsai.utils.utils import upload_to_hepai_filesystem

    file_path_obj = Path(file_path)
    if not file_path_obj.exists():
        return None

    file_name = file_path_obj.name
    file_size = file_path_obj.stat().st_size
    mime_type = mimetypes.guess_type(file_path)[0] or "application/octet-stream"

    file_info = None

    # --- Primary: upload to HepAI filesystem for a URL ---
    try:
        file_obj = upload_to_hepai_filesystem(file_path=file_path)
        url = file_obj["url"]
        file_info = FileInfo(
            name=file_name,
            url=url,
            description=description,
            download_method="url",
            size=file_size,
            mime_type=mime_type,
            path=file_path,
        )
        print(f"📤 File uploaded for FilesEvent (URL): {url}")
    except Exception as upload_err:
        print(f"⚠️ HepAI upload failed, falling back to base64: {upload_err}")

    # --- Fallback: base64 encode the file ---
    if file_info is None:
        try:
            with open(file_path, "rb") as f:
                encoded = base64.b64encode(f.read()).decode("utf-8")
            file_info = FileInfo(
                name=file_name,
                base64_content=encoded,
                description=description,
                download_method="base64",
                size=file_size,
                mime_type=mime_type,
                path=file_path,
            )
            print(f"📦 File encoded for FilesEvent (base64): {file_name}")
        except Exception as b64_err:
            print(f"❌ base64 fallback also failed: {b64_err}")
            return None

    files_content = FilesContent(
        files=[file_info],
        title=file_name,
        description=description,
    )
    return files_content.model_dump()


# Tool functions

def inspect_docx_template_tool(template_path: str):
    """
    Inspect a DOCX template and discover its placeholders and fillable slots.

    Use this BEFORE asking the user to provide values for a template.
    Returns the detected placeholder style and the list of variables /
    tokens found, plus heuristic "slots" for templates that do not use
    any explicit placeholder syntax (e.g. underscore lines `_____`,
    "Label:" with empty tail, empty table cells under a header).

    Best for:
    - "I uploaded a template, what fields does it have?"
    - planning a conversational fill flow before generating a document
    - filling user-uploaded templates that don't use {{ }} or [TOKEN]

    Args:
        template_path: Path to the .docx template file.

    Returns a dict with:
        mode_detected: 'jinja' (uses {{ name }}), 'bracket' (uses [NAME]),
            'both', or 'none'
        jinja_variables: list of top-level Jinja variable names
        bracket_tokens: list of bracket tokens (without the brackets)
        has_loops, has_conditionals: True if {% for %} / {% if %} present
        slots: list of {id, kind, label, context, ...} dicts where kind
            is one of:
              - 'highlighted'         — run(s) with a Word highlight
              - 'underscores'         — run of 3+ underscores
              - 'label_blank'         — paragraph ending in "Label:"
              - 'empty_cell'          — empty table cell under a header
              - 'angle_bracketed'     — <token> or 《占位符》, OR per-marker `**` asterisk
              - 'placeholder_phrase'  — "your text here", "请填写", "TBD"…
              - 'hint_text'           — italic/grey instructional run
              - 'section_body_empty'  — empty body under a Heading
              - 'option_choice'       — 二选一 / 三选一 pattern
        removals: list of {id, kind, text, reason} dicts
        warnings: notes (e.g. mixed-mode template, ambiguous slots, removal candidates present)
    """
    from document_skills.docx_template_skill import DocxTemplateSkill

    try:
        from run_docmaster import WORKSPACE
    except ImportError:
        WORKSPACE = Path.cwd()

    guard = _guard_template_path(template_path)
    if guard is not None:
        return guard
    skill = DocxTemplateSkill(str(WORKSPACE))
    return skill.inspect_template(template_path)


def fill_docx_template_tool(
    template_path: str,
    output_path: str,
    context: dict = None,
    mode: str = "auto",
    slot_values: dict = None,
    removal_ids: list = None,
    force_fresh: bool = False,
    replace_prefilled: dict = None,
):
    """
    Fill a DOCX template with values and save to a new DOCX file.

    Supports three input styles, freely combinable:
    - Jinja (docxtpl): {{ name }}, {% for x in xs %}…{% endfor %},
      {%tr for row in rows %}…{%tr endtr %} for table rows.
      `context` is a regular nested dict matching the variables.
    - Bracket: [NAME], [DATE] — literal substitution across paragraphs,
      tables, and headers/footers. `context` keys are the token names
      without brackets, e.g. {"NAME": "Alice"} fills [NAME]. Bracket
      tokens must be uppercase-leading (alnum, underscore, dash).
    - Heuristic slots: for templates without placeholder syntax. Call
      inspect_docx_template_tool first to discover slot ids, confirm
      what each holds with the user, then pass slot_values using the
      ids returned VERBATIM.

    Chunked fills (large templates with many slots): prefer ONE call
    covering all slots. If you must split into multiple calls, the
    2nd+ calls MUST set `template_path` to the PREVIOUS call's
    `output_path` so prior fills are preserved.

    Run-level formatting (bold/italic/color/font) in the template is
    preserved — only the runs that span the matched placeholder text
    are edited; other runs in the same paragraph are left untouched.

    Use mode='auto' (default) to let the tool detect from the template.
    Force 'jinja' or 'bracket' only when the user explicitly asks.
    For mixed templates ({{ }} AND [TOKEN]) in auto mode, Jinja renders
    first, then a bracket pass runs over the rendered output. Slot
    fills always run last, on the rendered document.

    Best for:
    - "Fill this template with these values"
    - generating one or more documents from an uploaded template
    - filling templates whose authors didn't add placeholders

    Args:
        template_path: Path to the .docx template.
        output_path: Where to write the filled .docx. Use a different
            path from template_path to preserve the original (a
            `_filled.docx` suffix is conventional).
        context: Mapping of placeholder values (Jinja vars or bracket
            tokens). May be omitted/None if you're only filling slots.
        mode: 'auto' (default), 'jinja', or 'bracket'.
        slot_values: Optional {slot_id: value} from
            inspect_docx_template_tool's `slots` list.
        removal_ids: Optional list of `id`s from inspect's `removals`
            list. Each id corresponds to a paragraph or run that the
            user confirmed should be DELETED from the final document.
        force_fresh: When True, skip the implicit chunked-continuation
            auto-detect: even if `output_path` already exists, write
            a fresh fill from `template_path` and overwrite the
            output. Use this to recover from a botched previous
            fill — NEVER use run_bash to delete the file. Default
            False (preserve prior partial fills when re-running).
        replace_prefilled: Optional {slot_id: new_text} for slots
            inspect_docx_template_tool flagged with
            `is_prefilled: true`. A prefilled slot is one whose
            paragraph (or its body, for `label_blank` kind) already
            contains substantive content.
    """
    from document_skills.docx_template_skill import DocxTemplateSkill

    try:
        from run_docmaster import WORKSPACE
    except ImportError:
        WORKSPACE = Path.cwd()

    guard = _guard_template_path(template_path)
    if guard is not None:
        return guard
    skill = DocxTemplateSkill(str(WORKSPACE))
    result = skill.fill_template(
        template_path,
        output_path,
        context=context or {},
        mode=mode,
        slot_values=slot_values or {},
        removal_ids=removal_ids or [],
        force_fresh=force_fresh,
        replace_prefilled=replace_prefilled or {},
    )
    if result.get('success', False):
        fe_data = _build_files_event_data(
            output_path,
            f"Template-filled DOCX: {Path(output_path).name}",
        )
        if fe_data:
            get_pending_events().append(fe_data)
    return result
