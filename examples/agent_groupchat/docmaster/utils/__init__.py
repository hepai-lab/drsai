"""
Utility functions for DocMaster.
Provides file handling, validation, workspace management, and OCR pool operations.
"""

# File utilities (merged from file_utils + validation)
from .files import (
    build_files_event_data,
    upload_generated_to_gfs,
    guard_docx_file_path,
    guard_template_path,
)

# Workspace utilities
from .workspace import (
    snapshot_workspace,
    detect_changed_files,
)

# RapidOCR pool management (renamed from rapidocr)
from .ocr import (
    ensure_rapidocr_pool_lock,
    warmup_rapidocr_at_boot,
    borrow_engine,
    return_engine,
)

# Dependency management
from .deps import (
    ensure_python_deps,
)

__all__ = [
    # File utilities
    "build_files_event_data",
    "upload_generated_to_gfs",
    # Validation
    "guard_docx_file_path",
    "guard_template_path",
    # Workspace
    "snapshot_workspace",
    "detect_changed_files",
    # RapidOCR
    "ensure_rapidocr_pool_lock",
    "warmup_rapidocr_at_boot",
    "borrow_engine",
    "return_engine",
    # Dependencies
    "ensure_python_deps",
]
