"""
Tool wrapper for validate.py - validates DOCX/PPTX/XLSX files.
"""

import sys
import tempfile
import zipfile
from pathlib import Path

# Ensure scripts directory is in path for imports
_SCRIPT_DIR = Path(__file__).parent.parent / "scripts"
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))

from office.validators import DOCXSchemaValidator, PPTXSchemaValidator, RedliningValidator


def validate_docx_tool(path: str, original: str = None, auto_repair: bool = False, author: str = "Claude") -> dict:
    """
    Validate an Office file's XML structure against schemas.
    
    Use this to check if an unpacked DOCX is structurally valid, or to compare
    changes in an unpacked directory against the original file.
    
    For unpacked directories, if original_file is provided, also validates tracked changes
    and redlining against the author attribution.
    
    Args:
        path: Path to unpacked directory OR packed Office file (.docx/.pptx/.xlsx)
        original: (optional) Original file for comparison/validation
        auto_repair: Whether to auto-repair common issues (default: False)
        author: Author name for redlining validation (default: "Claude")
    
    Returns:
        dict with 'success' (bool), 'message' (str), 'repairs' (int if any), and 'details' (str)
    """
    path_obj = Path(path)
    
    if not path_obj.exists():
        return {
            "success": False,
            "error": f"Path not found: {path}",
            "message": f"Error: {path} does not exist",
        }
    
    # Determine file type
    if path_obj.is_file():
        file_ext = path_obj.suffix.lower()
    elif original:
        file_ext = Path(original).suffix.lower()
    else:
        return {
            "success": False,
            "error": "Cannot determine file type",
            "message": "Provide either a .docx/.pptx/.xlsx file or an unpacked directory with --original",
        }
    
    if file_ext not in [".docx", ".pptx", ".xlsx"]:
        return {
            "success": False,
            "error": f"Unsupported file type: {file_ext}",
            "message": f"Error: Must be .docx, .pptx, or .xlsx file",
        }
    
    # Handle packed file by unpacking to temp dir
    if path_obj.is_file() and path_obj.suffix.lower() in [".docx", ".pptx", ".xlsx"]:
        temp_dir = tempfile.mkdtemp()
        try:
            with zipfile.ZipFile(path_obj, "r") as zf:
                zf.extractall(temp_dir)
            unpacked_dir = Path(temp_dir)
        except zipfile.BadZipFile:
            return {
                "success": False,
                "error": "Invalid ZIP file",
                "message": f"Error: {path} is not a valid Office file",
            }
    else:
        unpacked_dir = path_obj
        if not (unpacked_dir / "[Content_Types].xml").exists():
            return {
                "success": False,
                "error": "Invalid unpacked directory",
                "message": f"Error: {path} does not look like an unpacked Office directory",
            }
    
    # Set up validators
    validators = []
    original_file = Path(original) if original else None
    
    if file_ext == ".docx":
        validators.append(DOCXSchemaValidator(unpacked_dir, original_file))
        if original_file:
            validators.append(RedliningValidator(unpacked_dir, original_file, author=author))
    elif file_ext == ".pptx":
        validators.append(PPTXSchemaValidator(unpacked_dir, original_file))
    
    # Auto-repair if requested
    repairs = 0
    if auto_repair:
        repairs = sum(v.repair() for v in validators)
    
    # Validate
    results = []
    all_valid = True
    for v in validators:
        is_valid = v.validate()
        if not is_valid:
            all_valid = False
            if hasattr(v, 'errors') and v.errors:
                results.extend([str(e) for e in v.errors])
    
    # Cleanup temp dir if we created one
    if path_obj.is_file():
        import shutil
        shutil.rmtree(temp_dir, ignore_errors=True)
    
    if all_valid:
        msg = "All validations PASSED!"
        if repairs:
            msg = f"Auto-repaired {repairs} issue(s). {msg}"
        return {
            "success": True,
            "message": msg,
            "repairs": repairs if auto_repair else 0,
            "valid": True,
        }
    else:
        return {
            "success": False,
            "message": "Validation failed",
            "details": "; ".join(results) if results else "Unknown validation errors",
            "repairs": repairs if auto_repair else 0,
            "valid": False,
        }
