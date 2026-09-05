"""
Tool wrapper for accept_changes.py - accepts all tracked changes in DOCX.
"""

import sys
from pathlib import Path

# Ensure scripts directory is in path for imports
_SCRIPT_DIR = Path(__file__).parent.parent / "scripts"
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))

from accept_changes import accept_changes as _accept_changes


def accept_tracked_changes_tool(input_file: str, output_file: str) -> dict:
    """
    Accept all tracked changes in a DOCX file, producing a clean version.
    
    This uses LibreOffice to process the document and accept all:
    - Insertions (keeps the inserted text)
    - Deletions (removes the deleted text)
    - Format changes
    
    The result is a clean DOCX with no tracked changes, suitable for final distribution.
    
    Note: Requires LibreOffice (soffice) to be installed.
    
    Args:
        input_file: Path to the DOCX file with tracked changes
        output_file: Path for the clean output DOCX (without tracked changes)
    
    Returns:
        dict with 'success' (bool) and 'message' (str)
    """
    input_path = Path(input_file)
    output_path = Path(output_file)
    
    if not input_path.exists():
        return {
            "success": False,
            "error": f"Input file not found: {input_file}",
            "message": f"Error: {input_file} does not exist",
        }
    
    if input_path.suffix.lower() != ".docx":
        return {
            "success": False,
            "error": f"Not a DOCX file: {input_file}",
            "message": f"Error: {input_file} is not a DOCX file",
        }
    
    err, msg = _accept_changes(input_file=input_file, output_file=output_file)
    
    if err:
        return {
            "success": False,
            "error": err,
            "message": msg,
        }
    
    return {
        "success": True,
        "message": msg,
        "output_file": output_file,
    }
