"""
PDF Tools Module
"""

from .. import get_pending_events
from .ocr_tools import create_extract_scanned_pdf_tool

# Create the tool instance with the pending events getter
extract_scanned_pdf_tool = create_extract_scanned_pdf_tool(get_pending_events)

__all__ = [
    "create_extract_scanned_pdf_tool",
    "extract_scanned_pdf_tool",
]
