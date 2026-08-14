"""
Tool wrapper for pack.py - repacks XML back into DOCX/PPTX/XLSX.
"""

import sys
from pathlib import Path

# Ensure scripts directory is in path for imports
_SCRIPT_DIR = Path(__file__).parent.parent / "scripts"
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))

from office.pack import pack as _pack


def pack_docx_tool(input_dir: str, output_file: str, original_file: str = None, run_validation: bool = True) -> dict:
    """
    Repack an unpacked XML directory back into a DOCX/PPTX/XLSX file.
    
    Use this after editing the XML files from an unpacked Office document.
    The tool validates and auto-repairs common issues before creating the output file.
    
    Auto-repair fixes:
    - Invalid paraId/durableId values (>= 0x7FFFFFFF)
    - Missing xml:space="preserve" on <w:t> elements with whitespace
    
    Args:
        input_dir: Directory containing unpacked XML files
        output_file: Path for the output Office file
        original_file: (optional) Original file for validation comparison
        run_validation: Whether to run validation (default: True)
    
    Returns:
        dict with 'success' (bool), 'message' (str), and 'output_file' (str)
    """
    err, msg = _pack(
        input_directory=input_dir,
        output_file=output_file,
        original_file=original_file,
        validate=run_validation,
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
        "output_file": output_file,
    }
