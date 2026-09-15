"""
Tool wrapper for comment.py - adds comments to unpacked DOCX files.
"""

import sys
from pathlib import Path

# Ensure scripts directory is in path for imports
_SCRIPT_DIR = Path(__file__).parent.parent / "scripts"
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))

from comment import add_comment as _add_comment


def add_xml_comment_tool(
    unpacked_dir: str,
    comment_id: int,
    comment_text: str,
    author: str = "Claude",
    initials: str = "C",
    parent_comment_id: int = None,
) -> dict:
    """
    Add a comment to an unpacked DOCX document.
    
    After adding a comment, you must add markers to document.xml:
    - For a new comment: <w:commentRangeStart w:id="ID"/> ... <w:commentRangeEnd w:id="ID"/> <w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="ID"/></w:r>
    - For a reply: nest the reply's markers inside the parent's markers
    
    IMPORTANT: Use unpack_docx_tool first to extract the DOCX, then use this tool
    to add comments, then use pack_docx_tool to rebuild the file.
    
    Args:
        unpacked_dir: Directory containing unpacked DOCX XML files
        comment_id: Unique ID for this comment (use 0, 1, 2, etc. for sequential comments)
        comment_text: The comment text (plain text, special chars will be escaped)
        author: Author name for the comment (default: "Claude")
        initials: Author initials (default: "C")
        parent_comment_id: If set, this is a reply to that comment ID
    
    Returns:
        dict with 'success' (bool), 'message' (str), 'para_id' (str), and 'xml_markers' (str)
    """
    unpacked_path = Path(unpacked_dir)
    word_dir = unpacked_path / "word"
    
    if not word_dir.exists():
        return {
            "success": False,
            "error": f"Invalid unpacked directory: {unpacked_dir}",
            "message": f"Error: {word_dir} not found",
        }
    
    try:
        para_id, msg = _add_comment(
            unpacked_dir=unpacked_dir,
            comment_id=comment_id,
            text=comment_text,
            author=author,
            initials=initials,
            parent_id=parent_comment_id,
        )
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "message": f"Error adding comment: {e}",
        }
    
    if not para_id:
        return {
            "success": False,
            "error": "Comment addition failed",
            "message": msg,
        }
    
    # Generate XML markers for document.xml
    if parent_comment_id is not None:
        xml_markers = f"""<!-- Nest inside parent {parent_comment_id}'s markers -->
<w:commentRangeStart w:id="{parent_comment_id}"/><w:commentRangeStart w:id="{comment_id}"/>
... commented content ...
<w:commentRangeEnd w:id="{comment_id}"/><w:commentRangeEnd w:id="{parent_comment_id}"/>
<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="{parent_comment_id}"/></w:r>
<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="{comment_id}"/></w:r>"""
    else:
        xml_markers = f"""<!-- Add markers around the commented text in document.xml -->
<w:commentRangeStart w:id="{comment_id}"/>
... commented content ...
<w:commentRangeEnd w:id="{comment_id}"/>
<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="{comment_id}"/></w:r>"""
    
    return {
        "success": True,
        "message": msg,
        "para_id": para_id,
        "comment_id": comment_id,
        "xml_markers": xml_markers,
        "note": "Add the XML markers above to document.xml to attach the comment to specific text",
    }
