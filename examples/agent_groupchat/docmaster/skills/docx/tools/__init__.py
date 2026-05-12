"""
Skill tools for DOCX operations.
These wrap the underlying script implementations and expose them as proper agent tools.
"""

from .unpack import unpack_docx_tool
from .pack import pack_docx_tool
from .validate import validate_docx_tool
from .comment import add_xml_comment_tool
from .accept_changes import accept_tracked_changes_tool

__all__ = [
    "unpack_docx_tool",
    "pack_docx_tool",
    "validate_docx_tool",
    "add_xml_comment_tool",
    "accept_tracked_changes_tool",
]
