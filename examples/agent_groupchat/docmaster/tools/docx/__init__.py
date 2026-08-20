"""
DOCX Tools Module
"""

from .editor import (
    edit_docx_tool,
    extract_docx_content_tool,
    delete_docx_content_tool,
    modify_docx_fonts_tool,
    create_docx_with_content_tool,
    add_bullet_list_tool,
    add_numbered_list_tool,
    convert_doc_to_docx_tool,
)
from .templater import (
    inspect_docx_template_tool,
    fill_docx_template_tool,
)
from .library import (
    list_templates_tool,
    get_template_path_tool,
    save_template_tool,
    delete_template_tool,
)
from .comment import (
    add_comment_tool,
    remove_comment_tool,
)
from .review import (
    review_contract_tool,
)
from .xml import (
    unpack_docx_tool,
    pack_docx_tool,
    validate_docx_tool,
    accept_tracked_changes_tool,
    add_xml_comment_tool,
)

__all__ = [
    "edit_docx_tool",
    "extract_docx_content_tool",
    "delete_docx_content_tool",
    "modify_docx_fonts_tool",
    "create_docx_with_content_tool",
    "inspect_docx_template_tool",
    "fill_docx_template_tool",
    "list_templates_tool",
    "get_template_path_tool",
    "save_template_tool",
    "delete_template_tool",
    "add_bullet_list_tool",
    "add_numbered_list_tool",
    "add_comment_tool",
    "remove_comment_tool",
    "review_contract_tool",
    "convert_doc_to_docx_tool",
    "unpack_docx_tool",
    "pack_docx_tool",
    "validate_docx_tool",
    "accept_tracked_changes_tool",
    "add_xml_comment_tool",
]
