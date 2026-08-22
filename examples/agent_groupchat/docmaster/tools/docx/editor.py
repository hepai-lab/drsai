"""
DOCX editor module - unified document editing, list management, and format conversion.

Combines: edit_tools.py, list_tools.py, convert_tools.py
"""

import os
import json
from pathlib import Path
from .. import get_pending_events


# ==================== Path Guards ====================

_HALLUCINATED_PATH_HINTS = (
    "/Users/",           # macOS home — agent invents this from training priors
    "C:\\",              # Windows path — same
    "C:/",
    "/Desktop/",         # common desktop/downloads guess regardless of root
    "/Downloads/",
    "/Documents/",
)


def _guard_docx_file_path(file_path, *, tool_label: str) -> dict | None:
    """Reject obviously-hallucinated DOCX paths before tool execution.

    The LLM regularly invents paths like `/Users/jerry/Desktop/<filename>.docx`
    when the user mentions a template by name. The generic "File not found"
    response gives it no recovery target, so it falls back to `run_bash` /
    `run_glob` to "find" the file — which either misses entirely or pulls a
    stale duplicate. This guard returns a directive error that names the
    exact recovery path (get_template_path_tool or the upload event).
    """
    if not file_path or not isinstance(file_path, str):
        return {
            "success": False,
            "error": "Missing file_path",
            "message": (
                f"{tool_label} requires an absolute file_path. If the user "
                "referred to a template by name, call get_template_path_tool "
                "first; if the user uploaded a file, use the absolute path "
                "from the upload event. Do NOT guess paths, and do NOT use "
                "run_bash / run_glob / run_read to search for the file."
            ),
        }
    looks_hallucinated = any(hint in file_path for hint in _HALLUCINATED_PATH_HINTS)
    if looks_hallucinated and not os.path.exists(file_path):
        return {
            "success": False,
            "error": "Hallucinated file path",
            "message": (
                f"{tool_label}: the path {file_path!r} does not exist on this "
                "system and looks invented (macOS/Windows-style or "
                "Desktop/Downloads/Documents). This server is Linux and user "
                "files live under the docmaster workspace. NEVER guess "
                "filesystem paths. To recover: "
                "(1) if the user named a template (e.g. \"用 X 模板\"), call "
                "get_template_path_tool(template_ref=<user's words>) — it "
                "returns the canonical absolute path; "
                "(2) if the user just uploaded a file, re-read the upload "
                "event in the conversation for the absolute path; "
                "(3) if neither applies, ask the user — do NOT use "
                "run_bash / run_glob / run_read to search the filesystem."
            ),
        }
    if not os.path.exists(file_path):
        return {
            "success": False,
            "error": "File not found",
            "message": (
                f"{tool_label}: no file at {file_path!r}. If you got this "
                "path from get_template_path_tool the catalog may be stale — "
                "call list_templates_tool then get_template_path_tool again. "
                "If from an upload event, re-check the absolute path from "
                "that event. Do NOT use run_bash / run_glob / run_read to "
                "search for the file."
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


# ==================== Edit Tools ====================

def edit_docx_tool(file_path: str, edits: list):
    """
    Apply one or more structured edits to an existing DOCX file.

    This is the single general-purpose DOCX editing tool. Use it for
    exact replacements, semantic rewrites after inspection, adding
    headings or paragraphs, inserting tables, and style-related changes.

    Best for:
    - replace one phrase with another
    - append or insert new content
    - add headings or tables
    - run several planned edits in one call
    - execute semantic edits after reading the target content first

    This tool overwrites the original DOCX file.

    Args:
        file_path: Path to the DOCX file.
        edits: List of edit operations. Accepted examples:
            - {'type': 'replace_text', 'old_text': 'old', 'new_text': 'new'}
            - {'type': 'replace', 'target': 'old', 'replacement': 'new'}
            - {'type': 'add_paragraph', 'content': 'text', 'position': 'end', 'alignment': 'justify', 'spacing_after': 6}
            - {'type': 'add_heading', 'content': 'Section 2', 'level': 2, 'bold': True, 'color': '1F4E79'}
            - {'type': 'modify_style', 'style_name': 'Heading 2', 'font_name': 'Calibri', 'font_size': 14, 'bold': True, 'spacing_before': 12, 'spacing_after': 6}
            - {'type': 'format_text', 'target_text': 'important', 'bold': True, 'italic': True, 'underline': True, 'color': 'C00000'}
            - {'type': 'format_paragraph', 'position': 3, 'alignment': 'center', 'line_spacing': 1.5}
            - {'type': 'add_page_break', 'position': 'end'}
            - {'type': 'add_table', 'data': [['A', 'B'], ['1', '2']], 'table_style': 'Table Grid'}
            - {'type': 'set_table_style', 'table_index': 0, 'table_style': 'Light Grid Accent 1'}
            - {'type': 'set_cell_text', 'table_index': 0, 'row': 3, 'col': 5, 'value': '2550'}
            - {'type': 'replace_in_cell', 'table_index': 0, 'row': 3, 'col': 5, 'old_text': '850', 'new_text': '2550'}
            - {'type': 'add_table_row', 'table_index': 0, 'values': ['管理交换机', '型号X', '2', '12000', '24000'], 'position': 'end'}
            - {'type': 'delete_table_row', 'table_index': 0, 'row': 5}
            - {'type': 'add_bullet_list', 'items': ['要点一', '要点二'], 'position': 'end'}
            - {'type': 'add_numbered_list', 'items': ['第一步', '第二步'], 'position': 'end'}
            - {'type': 'insert_image', 'image_path': '/abs/path/to/image.png', 'position': 0, 'width_inches': 5.0}
            - {'type': 'add_footer', 'footer_type': 'page_number'}
            - {'type': 'add_footer', 'footer_type': 'page_x'}
            - {'type': 'add_footer', 'footer_type': 'custom', 'text': 'Confidential'}
            - {'type': 'add_header', 'header_type': 'custom', 'text': 'Document Title'}
            - {'type': 'add_header', 'header_type': 'title'}
            - {'type': 'add_header', 'header_type': 'filename', 'text': 'filename.docx'}
    """
    # ✅ 运行时追踪 - 证明使用的是重构后的代码
    import inspect
    _file_path = inspect.getfile(edit_docx_tool)
    print(f"\n🔍 【运行时确认】edit_docx_tool 来自重构后的代码:")
    print(f"   📁 文件: {_file_path}")
    print(f"   🏗️  模块: {__name__}")
    print(f"   ✅ 状态: 使用的是合并后的 editor.py 文件\n")

    from ...document_processor import DocumentProcessor

    try:
        from ...run_docmaster import WORKSPACE
    except ImportError:
        WORKSPACE = Path.cwd()

    print(f"🔧 edit_docx_tool called with:")
    print(f"   File: {file_path}")
    print(f"   Edits count: {len(edits)}")
    print(f"   First edit sample: {json.dumps(edits[0] if edits else {}, ensure_ascii=False, indent=2)[:200]}...")

    guard = _guard_docx_file_path(file_path, tool_label="edit_docx_tool")
    if guard is not None:
        print(f"❌ {guard.get('error')}: {guard.get('message')[:200]}")
        return guard

    standardized_edits = []
    conversion_stats = {'llm_format': 0, 'standard_format': 0, 'unknown': 0}

    for i, edit in enumerate(edits):
        if isinstance(edit, dict):
            edit_type = edit.get('type', '')

            if edit_type == 'replace':
                if 'target' in edit and 'replacement' in edit:
                    standardized_edits.append({
                        'type': 'replace_text',
                        'old_text': edit['target'],
                        'new_text': edit['replacement']
                    })
                    conversion_stats['llm_format'] += 1
                    continue
                elif 'old_text' in edit and 'new_text' in edit:
                    standardized_edits.append({
                        'type': 'replace_text',
                        'old_text': edit['old_text'],
                        'new_text': edit['new_text']
                    })
                    conversion_stats['llm_format'] += 1
                    continue

            if edit_type == 'replace_text' and 'old_text' in edit and 'new_text' in edit:
                standardized_edits.append(edit)
                conversion_stats['standard_format'] += 1
                continue

            if edit_type == 'add':
                if 'content' in edit:
                    standardized_edits.append({
                        'type': 'add_paragraph',
                        'content': edit['content'],
                        'position': edit.get('position', 'end')
                    })
                    conversion_stats['llm_format'] += 1
                    continue

            if edit_type in ['replace_text', 'add_paragraph', 'add_heading', 'modify_style', 'add_table', 'format_text', 'format_paragraph', 'add_page_break', 'set_table_style', 'insert_image', 'add_footer', 'add_header', 'add_bullet_list', 'add_numbered_list', 'delete_text', 'delete_paragraph']:
                standardized_edits.append(edit)
                conversion_stats['standard_format'] += 1
            else:
                standardized_edits.append(edit)
                conversion_stats['unknown'] += 1
                print(f"⚠️ Unknown edit format at index {i}: {edit_type}")
        else:
            standardized_edits.append(edit)
            conversion_stats['unknown'] += 1

    print(f"📊 Edit conversion stats: {conversion_stats}")
    print(f"📝 Standardized edits count: {len(standardized_edits)}")

    processor = DocumentProcessor(str(WORKSPACE))
    result = processor.edit_docx(file_path, standardized_edits, overwrite_original=True)

    print(f"✅ edit_docx_tool result: {result.get('success', False)}")
    if not result.get('success', False):
        print(f"❌ Error: {result.get('error', 'Unknown error')}")
        print(f"📝 Message: {result.get('message', 'No message')}")
    else:
        fe_data = _build_files_event_data(file_path, f"Edited DOCX: {Path(file_path).name}")
        if fe_data:
            get_pending_events().append(fe_data)

    def _truncate(s, maxlen=80):
        return s[:maxlen] + '...' if len(s) > maxlen else s

    changes_raw = result.get('changes', result.get('document_info', {}).get('changes_made', []))
    trimmed_changes = [_truncate(c) for c in changes_raw] if isinstance(changes_raw, list) else changes_raw

    return {
        'success': result.get('success', False),
        'message': result.get('message', ''),
        'file_path': result.get('file_path', file_path),
        'paragraph_count': result.get('document_info', {}).get('paragraph_count'),
        'table_count': result.get('document_info', {}).get('table_count'),
        'changes': trimmed_changes,
    }


def extract_docx_content_tool(file_path: str):
    """
    Extract detailed DOCX content for inspection before editing.

    Use this when you need the actual document text or structure, not
    just metadata. This is the preferred inspection tool before nontrivial
    rewrite, polish, shorten, reorganize, or section-level edits.

    Best for:
    - reading paragraphs and tables from a DOCX
    - locating target text before semantic edits
    - understanding document structure before applying changes

    Not for editing by itself.

    ⚠️ 表格里的合并单元格（merged cells）—— 读结果里 `tables[i].data` 是按
    **grid 坐标**返回的二维数组，所以一个合并单元格只在它的**锚点位置**
    出现一次，其它被合并进来的位置会显示为
    `'⟨merged with r{R}c{C}⟩'` 哨兵字符串（指向锚点）。同时
    `tables[i].merges` 会列出每一处合并区域：
        {anchor:[r,c], colspan, rowspan, text}

    合并单元格的使用规则：
    - **绝对不要**对哨兵位置写值（set_cell_text / replace_in_cell 之类）。
      那些位置和锚点共用同一个底层 <w:tc>，写过去会把整个合并块的文字
      一次性覆盖成你写的短字符串——这是上次"甲方开票信息"被改成
      "100049" 的根因。
    - 要修改合并块的内容，**只对锚点 (r, c) 写**。例如 `merges` 里有
      `{anchor:[6,1], colspan:3, ...}`，所有改动都用 row=6, col=1。
    - 合并块里的文本本身就是原模板的固定内容（例如 "甲方开票信息如下…"
      整段、印章占位 "合 同 章…年 月 日"、表头中"甲方/乙方"的标签）——
      通常这些是模板里**有意要保留的整段固定信息**，**不要**当成
      "重复 / 错位 / 需要清理"的脏数据去改。看到合并块里有连续多行
      prose（公司名/纳税人识别号/地址/账号 等），默认保留，**除非用户
      明确要求修改**。
    - 真正空的可填单元格（不是合并）会显示成空字符串 ''，和哨兵
      `'⟨merged with …⟩'` 是不同的；不要混淆。

    Args:
        file_path: Path to the DOCX file.
    """
    from ...document_processor import DocumentProcessor

    try:
        from ...run_docmaster import WORKSPACE
    except ImportError:
        WORKSPACE = Path.cwd()

    guard = _guard_docx_file_path(file_path, tool_label="extract_docx_content_tool")
    if guard is not None:
        return guard
    processor = DocumentProcessor(str(WORKSPACE))
    result = processor.extract_docx_content(file_path)
    return result


def delete_docx_content_tool(file_path: str):
    """
    Remove all content from an existing DOCX document.

    Use this only when the user clearly wants the document emptied,
    cleared, or reset. This is a destructive operation on the target file.

    Best for:
    - "clear this document"
    - "delete all text/content"
    - preparing an existing DOCX to be rebuilt

    Args:
        file_path: Path to the DOCX file.
    """
    from ...document_processor import DocumentProcessor

    try:
        from ...run_docmaster import WORKSPACE
    except ImportError:
        WORKSPACE = Path.cwd()

    processor = DocumentProcessor(str(WORKSPACE))
    result = processor.delete_docx_content(file_path)
    if result.get('success', False):
        fe_data = _build_files_event_data(file_path, f"Cleared DOCX: {Path(file_path).name}")
        if fe_data:
            get_pending_events().append(fe_data)
    return result


def modify_docx_fonts_tool(file_path: str, font_rules: dict = None):
    """
    Change DOCX fonts according to language or content-type rules.

    Use this when the request is specifically about typography rather than
    wording, for example changing Chinese text to 宋体 and English text to
    Times New Roman.

    Best for:
    - document-wide font normalization
    - Chinese/English font separation
    - formatting requests focused on font family rules

    Not for rewriting content.

    Args:
        file_path: Path to the DOCX file.
        font_rules: Mapping of content categories to fonts, e.g.
            {'chinese': '宋体', 'english': 'Times New Roman'}
    """
    from ...document_processor import DocumentProcessor

    try:
        from ...run_docmaster import WORKSPACE
    except ImportError:
        WORKSPACE = Path.cwd()

    processor = DocumentProcessor(str(WORKSPACE))
    result = processor.modify_docx_fonts(file_path, font_rules)
    if result.get('success', False):
        fe_data = _build_files_event_data(file_path, f"Font-modified DOCX: {Path(file_path).name}")
        if fe_data:
            get_pending_events().append(fe_data)
    return result


def create_docx_with_content_tool(output_path: str, content: list):
    """
    Create a new DOCX file from structured content elements.

    This is the single document-creation tool. Use it whenever the user
    wants a new Word document, whether simple or structured. If the user
    only gives plain text, convert it into a reasonable structured content
    list before calling this tool.

    Best for:
    - creating a new report or letter
    - building a document from headings and paragraphs
    - generating a formatted DOCX from an outline or structured data

    Args:
        output_path: Path where the new DOCX should be saved.
        content: List of structured content items, for example:
            - {'type': 'heading', 'text': 'Document Title', 'level': 0}
            - {'type': 'heading', 'text': 'Introduction', 'level': 1}
            - {'type': 'subheading', 'text': 'Background', 'level': 2}
            - {'type': 'paragraph', 'text': 'Body text', 'font_name': 'Times New Roman', 'font_size': 12, 'alignment': 'justify', 'spacing_after': 6}
            - {'type': 'page_break'}
            - {'type': 'table', 'data': [['A', 'B'], ['1', '2']], 'table_style': 'Table Grid'}
            Optional fields may include font/font_name, bold, italic, underline, font_size, color, alignment, and spacing.
    """
    from ...document_processor import DocumentProcessor

    try:
        from ...run_docmaster import WORKSPACE
    except ImportError:
        WORKSPACE = Path.cwd()

    processor = DocumentProcessor(str(WORKSPACE))
    result = processor.create_docx_with_content(output_path, content)
    if result.get('success', False):
        fe_data = _build_files_event_data(output_path, f"Created DOCX: {Path(output_path).name}")
        if fe_data:
            get_pending_events().append(fe_data)

    doc_info = result.get('document_info', {})
    elements = doc_info.get('created_elements', result.get('elements_created', []))
    return {
        'success': result.get('success', False),
        'message': result.get('message', ''),
        'file_path': result.get('file_path', output_path),
        'paragraph_count': doc_info.get('paragraph_count'),
        'table_count': doc_info.get('table_count'),
        'elements_created': len(elements) if elements else 0,
    }


# ==================== List Tools ====================

def add_bullet_list_tool(file_path: str, items: list, position: int | str = "end", style: str = "List Bullet"):
    """
    Add a bullet list to an existing DOCX file.

    Use this when the user wants to add a bulleted list — for example a list
    of key points, requirements, features, or any collection of items that
    should be visually grouped.

    Best for:
    - "add a bullet list of ..."
    - "insert a list of items"
    - "list the following points"
    - adding structured list content to a document

    Args:
        file_path: Path to the DOCX file.
        items: List of item strings, or list of dicts with 'text' and optional
               'level' (0=normal, 1+=nested), e.g.
               ['Item one', {'text': 'Item two', 'level': 1}, 'Item three']
        position: Integer index to insert before that paragraph, or 'end'
                  to append at the end of the document.
        style: Base list style to use; defaults to 'List Bullet'.
    """
    from ...document_processor import DocumentProcessor

    try:
        from ...run_docmaster import WORKSPACE
    except ImportError:
        WORKSPACE = Path.cwd()

    print(f"🔧 add_bullet_list_tool called:")
    print(f"   File: {file_path}")
    print(f"   Items: {json.dumps(items[:3], ensure_ascii=False)}...")

    if not os.path.exists(file_path):
        return {
            'success': False,
            'error': 'File not found',
            'message': f'File not found: {file_path}'
        }

    processor = DocumentProcessor(str(WORKSPACE))
    edits = [{
        'type': 'add_bullet_list',
        'items': items,
        'position': position,
        'style': style,
    }]
    result = processor.edit_docx(file_path, edits, overwrite_original=True)

    if result.get('success', False):
        fe_data = _build_files_event_data(file_path, f"Bullet list added to: {Path(file_path).name}")
        if fe_data:
            get_pending_events().append(fe_data)

    return {
        'success': result.get('success', False),
        'message': result.get('message', ''),
        'file_path': file_path,
        'items_added': len(items),
    }


def add_numbered_list_tool(file_path: str, items: list, position: int | str = "end", style: str = "List Number"):
    """
    Add a numbered list to an existing DOCX file.

    Use this when the user wants an ordered, sequential list — for example
    steps in a process, a ranked list, or an enumerated set of items.

    Best for:
    - "add a numbered list of ..."
    - "list the steps in order"
    - "add these items as a numbered sequence"
    - "insert a numbered sequence"

    Args:
        file_path: Path to the DOCX file.
        items: List of item strings, or list of dicts with 'text' and optional
               'level' (0=normal, 1+=nested), e.g.
               ['Step 1: Do X', {'text': 'Step 2: Do Y', 'level': 1}, 'Step 3: Do Z']
        position: Integer index to insert before that paragraph, or 'end'
                  to append at the end of the document.
        style: Base list style to use; defaults to 'List Number'.
    """
    from ...document_processor import DocumentProcessor

    try:
        from ...run_docmaster import WORKSPACE
    except ImportError:
        WORKSPACE = Path.cwd()

    print(f"🔧 add_numbered_list_tool called:")
    print(f"   File: {file_path}")
    print(f"   Items: {json.dumps(items[:3], ensure_ascii=False)}...")

    if not os.path.exists(file_path):
        return {
            'success': False,
            'error': 'File not found',
            'message': f'File not found: {file_path}'
        }

    processor = DocumentProcessor(str(WORKSPACE))
    edits = [{
        'type': 'add_numbered_list',
        'items': items,
        'position': position,
        'style': style,
    }]
    result = processor.edit_docx(file_path, edits, overwrite_original=True)

    if result.get('success', False):
        fe_data = _build_files_event_data(file_path, f"Numbered list added to: {Path(file_path).name}")
        if fe_data:
            get_pending_events().append(fe_data)

    return {
        'success': result.get('success', False),
        'message': result.get('message', ''),
        'file_path': file_path,
        'items_added': len(items),
    }


# ==================== Conversion Tools ====================

def convert_doc_to_docx_tool(file_path: str):
    """
    Convert a legacy Word .doc file to modern .docx via LibreOffice headless.

    Call this FIRST whenever the user uploads a .doc file — python-docx
    and every other DOCX tool here cannot read the legacy binary format.
    The result includes `output_path`; use that path for any follow-up
    tool calls (inspect_docx_template_tool, edit_docx_tool, etc.).

    If the input is already .docx, returns success with note="already .docx"
    and the same path — safe to call on any uploaded Word file.

    Requires `soffice` (LibreOffice) on PATH. If missing, returns a clear
    error with install instructions; stop and tell the user.

    Args:
        file_path: Path to the uploaded .doc (or .docx) file.

    Returns dict with: success, input_path, output_path, soffice_used,
        message. On failure: success=False, error=<reason>, message=<hint>.
    """
    from document_skills.doc_to_docx_skill import DocToDocxSkill

    try:
        from ...run_docmaster import WORKSPACE
    except ImportError:
        WORKSPACE = Path.cwd()

    skill = DocToDocxSkill(str(WORKSPACE))
    result = skill.convert(file_path)
    if (
        result.get('success')
        and result.get('soffice_used')
        and result.get('output_path') != file_path
    ):
        fe_data = _build_files_event_data(
            result['output_path'],
            f"Converted to DOCX: {Path(result['output_path']).name}",
        )
        if fe_data:
            get_pending_events().append(fe_data)
    return result
