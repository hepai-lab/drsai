"""
DocMaster tools module - centralized tool management and registration.

This module provides:
- Global pending events management
- Tool registration and collection
- Common utilities for all tools
"""

from typing import List, Dict, Any, Callable

# Global state for pending file events
_PENDING_EVENTS: List[Dict[str, Any]] = []


def set_pending_events(events: List[Dict[str, Any]]) -> None:
    """Set the pending events list (typically called at agent initialization).

    Args:
        events: List to use for collecting file events from tools.
    """
    global _PENDING_EVENTS
    _PENDING_EVENTS = events


def get_pending_events() -> List[Dict[str, Any]]:
    """Get the current pending events list.

    Returns:
        The list used for collecting file events from tools.
    """
    return _PENDING_EVENTS


def get_all_tools(pending_events: List[Dict[str, Any]], user_id: str | None = None) -> List[Any]:
    """Collect all available DocMaster tools.

    This function imports and registers all tool functions from the tools submodules.
    It should be called during agent initialization to populate the agent's tool list.

    Args:
        pending_events: List for collecting file events from tools.
        user_id: Optional user ID for GFS integration.

    Returns:
        List of all registered tool functions and objects.
    """
    # Set the global pending events
    set_pending_events(pending_events)

    # Wire user_id into template tools
    try:
        from .docx.library import set_template_user_id
        set_template_user_id(user_id)
    except ImportError:
        pass

    tools = []

    # Import docx tools
    try:
        from .docx import (
            edit_docx_tool, extract_docx_content_tool, delete_docx_content_tool,
            create_docx_with_content_tool, modify_docx_fonts_tool, convert_doc_to_docx_tool,
            inspect_docx_template_tool, fill_docx_template_tool,
            list_templates_tool, get_template_path_tool, save_template_tool, delete_template_tool,
            add_bullet_list_tool, add_numbered_list_tool,
            add_comment_tool, remove_comment_tool,
            review_contract_tool,
            unpack_docx_tool, pack_docx_tool, validate_docx_tool,
            accept_tracked_changes_tool, add_xml_comment_tool,
        )
        tools.extend([
            edit_docx_tool, extract_docx_content_tool, delete_docx_content_tool,
            create_docx_with_content_tool, modify_docx_fonts_tool, convert_doc_to_docx_tool,
            inspect_docx_template_tool, fill_docx_template_tool,
            list_templates_tool, get_template_path_tool, save_template_tool, delete_template_tool,
            add_bullet_list_tool, add_numbered_list_tool,
            add_comment_tool, remove_comment_tool,
            review_contract_tool,
            unpack_docx_tool, pack_docx_tool, validate_docx_tool,
            accept_tracked_changes_tool, add_xml_comment_tool,
        ])
    except ImportError as e:
        print(f"⚠️ Failed to import docx tools: {e}")

    # Import PDF tools
    try:
        from .pdf import extract_scanned_pdf_tool
        tools.append(extract_scanned_pdf_tool)
    except ImportError as e:
        print(f"⚠️ Failed to import pdf tools: {e}")

    # PPT tools are NOT registered here anymore. PPT generation now uses the
    # ppt-master skill (skills/ppt-master/skills/ppt-master/): the agent loads
    # it via Skill(skill="ppt-master") and runs the skill's own scripts
    # (svg_to_pptx.py, finalize_svg.py, project_manager.py, ...) directly
    # through run_bash. The old tools/ppt/* wrappers and the
    # ppt-polished-deck-collab skill are retired — see system_prompt.py's
    # 【PPT / 演示文档任务的标准流程（ppt-master skill）】 section.

    # Import business tools
    try:
        from .business import (
            recommend_experts_tool,
            generate_expert_opinion_forms_tool,
            audit_application_materials_tool,
        )
        tools.extend([
            recommend_experts_tool,
            generate_expert_opinion_forms_tool,
            audit_application_materials_tool,
        ])
    except ImportError as e:
        print(f"⚠️ Failed to import business tools: {e}")

    return tools


__all__ = [
    'set_pending_events',
    'get_pending_events',
    'get_all_tools',
]
