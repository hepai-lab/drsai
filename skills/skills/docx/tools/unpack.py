"""
Tool wrapper for unpack.py - extracts DOCX/PPTX/XLSX to editable XML.
"""

import sys
from pathlib import Path

# Ensure scripts directory is in path for imports
_SCRIPT_DIR = Path(__file__).parent.parent / "scripts"
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))

from office.unpack import unpack as _unpack


def unpack_docx_tool(file_path: str, output_dir: str, merge_runs: bool = True, simplify_redlines: bool = True) -> dict:
    """
    Unpack a DOCX/PPTX/XLSX file for XML editing.
    
    Use this when you need to directly edit the XML inside an Office file,
    such as for tracked changes, complex comments, or advanced formatting.
    
    After unpacking, you can use run_read/run_edit to modify the XML files,
    then use pack_docx_tool to rebuild the Office file.
    
    Args:
        file_path: Path to the Office file (.docx, .pptx, .xlsx)
        output_dir: Directory where XML files will be extracted
        merge_runs: Whether to merge adjacent runs with identical formatting (DOCX only)
        simplify_redlines: Whether to simplify adjacent tracked changes (DOCX only)
    
    Returns:
        dict with 'success' (bool), 'message' (str), and 'output_dir' (str)
    """
    err, msg = _unpack(
        input_file=file_path,
        output_directory=output_dir,
        merge_runs=merge_runs,
        simplify_redlines=simplify_redlines,
    )
    
    if err:
        return {
            "success": False,
            "error": err,
            "message": msg,
        }
    
    return {
        "success": True,
        "message": msg,
        "output_dir": output_dir,
    }
