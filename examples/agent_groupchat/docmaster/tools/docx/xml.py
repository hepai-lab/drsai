"""
XML-level DOCX manipulation tools for advanced formatting-safe editing.
"""

from pathlib import Path
from .. import get_pending_events


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

def unpack_docx_tool(file_path: str, output_dir: str, merge_runs: bool = True, simplify_redlines: bool = True):
    """
    Unpack a DOCX file into a directory of editable XML files.

    This is the first step of the formatting-safe editing workflow.
    It extracts the ZIP archive, pretty-prints XML, merges adjacent
    runs with identical formatting, simplifies tracked changes, and
    escapes smart quotes for safe editing.

    Use this when you need to make advanced edits that python-docx
    cannot handle without formatting loss, such as:
    - Complex tracked changes (deletions + insertions with author attribution)
    - Advanced comments via the comment.py script
    - Preserving every formatting detail during text edits

    After unpacking, edit the XML files in output_dir/word/ directly,
    then use pack_docx_tool to reassemble.

    Args:
        file_path: Path to the DOCX file to unpack.
        output_dir: Directory to extract into (will be created).
        merge_runs: Merge adjacent runs with identical formatting (default True).
        simplify_redlines: Simplify adjacent tracked changes from same author (default True).
    """
    import sys as _sys

    try:
        from run_docmaster import WORKSPACE
        _OFFICE_SCRIPTS_DIR = Path(WORKSPACE).parent / "skills" / "docx" / "scripts" / "office"
    except ImportError:
        _OFFICE_SCRIPTS_DIR = Path(__file__).parent.parent.parent / "skills" / "docx" / "scripts" / "office"

    _saved = _sys.path[:]
    _sys.path.insert(0, str(_OFFICE_SCRIPTS_DIR))
    try:
        from unpack import unpack
        _, message = unpack(file_path, output_dir, merge_runs=merge_runs, simplify_redlines=simplify_redlines)
        success = "Error" not in message
        return {'success': success, 'message': message, 'output_dir': output_dir}
    except Exception as e:
        return {'success': False, 'error': str(e), 'message': f'Failed to unpack: {e}'}
    finally:
        _sys.path[:] = _saved


def pack_docx_tool(input_dir: str, output_file: str, original_file: str = None, validate: bool = True):
    """
    Pack an unpacked directory back into a DOCX file.

    This is the final step of the formatting-safe editing workflow.
    It validates the XML with auto-repair, condenses formatting, and
    creates the output DOCX.

    Auto-repair fixes:
    - durableId values that exceed OOXML limits (regenerates valid IDs)
    - Missing xml:space="preserve" on <w:t> elements with whitespace

    Args:
        input_dir: Path to the unpacked directory (from unpack_docx_tool).
        output_file: Path for the output DOCX file.
        original_file: (Optional) Path to the original DOCX for validation comparison.
        validate: Run schema validation with auto-repair (default True).
    """
    import sys as _sys

    try:
        from run_docmaster import WORKSPACE
        _OFFICE_SCRIPTS_DIR = Path(WORKSPACE).parent / "skills" / "docx" / "scripts" / "office"
    except ImportError:
        _OFFICE_SCRIPTS_DIR = Path(__file__).parent.parent.parent / "skills" / "docx" / "scripts" / "office"

    _saved = _sys.path[:]
    _sys.path.insert(0, str(_OFFICE_SCRIPTS_DIR))
    try:
        from pack import pack
        _, message = pack(input_dir, output_file, original_file=original_file, validate=validate)
        success = "Error" not in message
        if success:
            fe_data = _build_files_event_data(output_file, f"Packed DOCX: {Path(output_file).name}")
            if fe_data:
                get_pending_events().append(fe_data)
        return {'success': success, 'message': message, 'output_file': output_file}
    except Exception as e:
        return {'success': False, 'error': str(e), 'message': f'Failed to pack: {e}'}
    finally:
        _sys.path[:] = _saved


def validate_docx_tool(path: str, original: str = None, auto_repair: bool = True):
    """
    Validate a DOCX file or unpacked directory against OOXML schemas.

    Can validate either a packed .docx file or an unpacked directory.
    Optionally compares against the original file to check for
    tracked-change consistency.

    Args:
        path: Path to the unpacked directory or packed DOCX file.
        original: (Optional) Path to the original DOCX for comparison.
        auto_repair: Automatically repair common issues (default True).
    """
    import sys as _sys
    import tempfile
    import zipfile

    try:
        from run_docmaster import WORKSPACE
        _OFFICE_SCRIPTS_DIR = Path(WORKSPACE).parent / "skills" / "docx" / "scripts" / "office"
    except ImportError:
        _OFFICE_SCRIPTS_DIR = Path(__file__).parent.parent.parent / "skills" / "docx" / "scripts" / "office"

    _saved = _sys.path[:]
    _sys.path.insert(0, str(_OFFICE_SCRIPTS_DIR))
    try:
        from validators import DOCXSchemaValidator, RedliningValidator
        unpacked_dir = Path(path)
        original_file = Path(original) if original else None

        # If path is a .docx file, unpack to temp dir
        if unpacked_dir.is_file() and unpacked_dir.suffix.lower() == '.docx':
            temp_dir = tempfile.mkdtemp()
            with zipfile.ZipFile(unpacked_dir, 'r') as zf:
                zf.extractall(temp_dir)
            unpacked_dir = Path(temp_dir)

        validators = [DOCXSchemaValidator(unpacked_dir, original_file)]
        if original_file and original_file.exists():
            validators.append(RedliningValidator(unpacked_dir, original_file, author="DocMaster"))

        output_lines = []
        if auto_repair:
            total_repairs = sum(v.repair() for v in validators)
            if total_repairs:
                output_lines.append(f"Auto-repaired {total_repairs} issue(s)")

        success = all(v.validate() for v in validators)
        if success:
            output_lines.append("All validations PASSED!")

        return {'success': success, 'message': '\n'.join(output_lines)}
    except Exception as e:
        return {'success': False, 'error': str(e), 'message': f'Validation failed: {e}'}
    finally:
        _sys.path[:] = _saved


def accept_tracked_changes_tool(input_file: str, output_file: str):
    """
    Accept all tracked changes in a DOCX file using LibreOffice.

    Produces a clean document with all insertions accepted and
    deletions removed. Requires LibreOffice to be installed.

    Args:
        input_file: Path to the DOCX file with tracked changes.
        output_file: Path for the clean output DOCX.
    """
    import sys as _sys

    try:
        from run_docmaster import WORKSPACE
        _SKILL_SCRIPTS_DIR = Path(WORKSPACE).parent / "skills" / "docx" / "scripts"
        _OFFICE_SCRIPTS_DIR = _SKILL_SCRIPTS_DIR / "office"
    except ImportError:
        base = Path(__file__).parent.parent.parent
        _SKILL_SCRIPTS_DIR = base / "skills" / "docx" / "scripts"
        _OFFICE_SCRIPTS_DIR = _SKILL_SCRIPTS_DIR / "office"

    _saved = _sys.path[:]
    _sys.path.insert(0, str(_SKILL_SCRIPTS_DIR))
    _sys.path.insert(0, str(_OFFICE_SCRIPTS_DIR))
    try:
        from accept_changes import accept_changes
        _, message = accept_changes(input_file, output_file)
        success = "Error" not in message
        if success:
            fe_data = _build_files_event_data(output_file, f"Tracked changes accepted: {Path(output_file).name}")
            if fe_data:
                get_pending_events().append(fe_data)
        return {'success': success, 'message': message, 'output_file': output_file}
    except Exception as e:
        return {'success': False, 'error': str(e), 'message': f'Failed to accept changes: {e}'}
    finally:
        _sys.path[:] = _saved


def add_xml_comment_tool(unpacked_dir: str, comment_id: int, text: str, author: str = "DocMaster", initials: str = "DM", parent_id: int = None):
    """
    Add a comment to an unpacked DOCX directory (XML-level).

    This handles all the boilerplate across comments.xml,
    commentsExtended.xml, commentsIds.xml, and commentsExtensible.xml.

    After calling this, you still need to add markers to document.xml:
      <w:commentRangeStart w:id="ID"/>
      ...commented runs...
      <w:commentRangeEnd w:id="ID"/>
      <w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="ID"/></w:r>

    Args:
        unpacked_dir: Path to the unpacked DOCX directory.
        comment_id: Unique integer ID for this comment.
        text: Comment text (should be pre-escaped XML).
        author: Author name (default "DocMaster").
        initials: Author initials (default "DM").
        parent_id: (Optional) Parent comment ID for replies.
    """
    import sys as _sys

    try:
        from run_docmaster import WORKSPACE
        _SKILL_SCRIPTS_DIR = Path(WORKSPACE).parent / "skills" / "docx" / "scripts"
        _OFFICE_SCRIPTS_DIR = _SKILL_SCRIPTS_DIR / "office"
    except ImportError:
        base = Path(__file__).parent.parent.parent
        _SKILL_SCRIPTS_DIR = base / "skills" / "docx" / "scripts"
        _OFFICE_SCRIPTS_DIR = _SKILL_SCRIPTS_DIR / "office"

    _saved = _sys.path[:]
    _sys.path.insert(0, str(_SKILL_SCRIPTS_DIR))
    _sys.path.insert(0, str(_OFFICE_SCRIPTS_DIR))
    try:
        from comment import add_comment
        para_id, message = add_comment(unpacked_dir, comment_id, text, author, initials, parent_id)
        success = "Error" not in message
        result = {'success': success, 'message': message, 'para_id': para_id}
        if parent_id is not None:
            result['marker_hint'] = f'Nest markers: commentRangeStart id="{parent_id}" then id="{comment_id}"'
        else:
            result['marker_hint'] = f'Add markers: commentRangeStart/End id="{comment_id}" around target text'
        return result
    except Exception as e:
        return {'success': False, 'error': str(e), 'message': f'Failed to add comment: {e}'}
    finally:
        _sys.path[:] = _saved
