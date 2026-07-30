"""
Constants module for DocMaster.
Centralized configuration and path constants for the entire application.
"""

import re
import queue as _queue
import threading
from pathlib import Path


# ── Path Constants ────────────────────────────────────────────────────────
# From paths.py

HERE = Path(__file__).parent.parent
"""Root directory of the docmaster module."""

WORKSPACE = HERE / "workspace"
"""Base workspace directory for all docmaster sessions and temporary files."""

WORKDIR = WORKSPACE / "runs"
"""Working directory for individual run sessions."""

# ── PPT Skill directories ─────────────────────────────────────────────────

PPT_SKILL_ROOT = (
    HERE / "skills" / "presentation-skills" / "ppt-polished-deck-collab-traditional"
)
"""Root directory for PPT polished deck collaboration skill."""

PPT_SCRIPTS_DIR = PPT_SKILL_ROOT / "scripts"
"""Directory containing PPT generation scripts."""

PPT_REFERENCES_DIR = PPT_SKILL_ROOT / "references"
"""Directory containing PPT reference templates and guidelines."""

# ── Office/DOCX Skill directories ─────────────────────────────────────────

SKILL_SCRIPTS_DIR = HERE / "skills" / "docx" / "scripts"
"""Root directory for DOCX skill scripts."""

OFFICE_SCRIPTS_DIR = SKILL_SCRIPTS_DIR / "office"
"""Directory containing Office-specific scripts (docx, doc conversion, etc.)."""

# ── GFS (File Storage) paths ──────────────────────────────────────────────

GFS_GENERATED_PREFIX = "docmaster/generated"
"""GFS bucket prefix for DocMaster-generated files."""


def ensure_workspace_dirs():
    """Create all workspace directories if they don't exist."""
    WORKSPACE.mkdir(parents=True, exist_ok=True)
    WORKDIR.mkdir(parents=True, exist_ok=True)


# ── Settings & Configuration ──────────────────────────────────────────────
# From settings.py

# ─── File System Tracking ──────────────────────────────────────────────────

# File extensions tracked for FilesEvent emission
TRACKED_EXTENSIONS = {
    '.docx', '.pdf', '.pptx', '.xlsx', '.csv',
    '.txt', '.md', '.rtf', '.tex', '.json', '.yaml', '.yml',
    '.ini', '.cfg', '.conf', '.log', '.html', '.htm', '.css', '.js',
}
"""
Extensions to monitor for document changes.
NOTE: .xml is excluded because unpacked DOCX/PPTX/XLSX files create many
intermediate XML files that are internal to Office documents.
"""

# Directories excluded from workspace scanning
EXCLUDED_DIRS = {'skills', 'configs', 'document_skills', 'scripts', '__pycache__', '.git'}
"""
Directories to skip during filesystem scanning.
NOTE: skills/ and configs/ are excluded because:
- skills/ contains copied skill files (SKILL.md etc.) from first_time_setup
- configs/ contains system config files (AGENTS.md, TOOLS.md, USER.md etc.)
These are internal DrSai files, not user documents.
"""

# ─── Hallucinated Path Detection ───────────────────────────────────────────

HALLUCINATED_PATH_HINTS = (
    "/Users/",           # macOS home — agent invents this from training priors
    "C:\\",              # Windows path — same
    "C:/",
    "/Desktop/",         # common desktop/downloads guess regardless of root
    "/Downloads/",
    "/Documents/",
)
"""
Path prefixes that indicate hallucinated/invented filesystem paths.
Used to detect when LLM makes up paths like /Users/jerry/Desktop/<filename>.docx
"""

# Template hunting tokens for filesystem tool guards
TEMPLATE_HUNT_TOKENS = (
    ".docx",
    ".doc",
    "template",
    "模板",
    "合同",
    "contract",
    "workspace/templates",
    "/templates/",
)
"""
Tokens used to detect when LLM tries to find templates via run_glob/run_bash.
These patterns trigger redirection to the proper template library tools.
"""

# PPT allowlist patterns (NOT template hunts)
PPT_ALLOWLIST_PATTERNS = (
    "skills/presentation-skills",
    "ppt-polished-deck-collab",
    "/decks/",                          # per-user deck workspaces
    "validation/template_audit",        # audit reports under decks
)
"""
Path patterns that should NOT trigger template-hunt blocking.
Used to allow legitimate PPT-related filesystem operations.
"""

# ─── PPT Configuration ─────────────────────────────────────────────────────

PPT_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9\-]{0,62}$")
"""Regex pattern for valid PPT slug names (lowercase alphanumeric and hyphens)."""

PPT_ARCHETYPES = {
    "hero-statement",
    "decision-logic",
    "board-memo",
    "chart-spotlight",
    "comparison-matrix",
    "process-flow",
    "research-note",
    "appendix-dense",
}
"""8 supported PPT slide archetypes for ppt_build_pptx_tool rendering."""

PPT_ASSET_MODES = {
    "text-layout-native",
    "office-chart-native",
    "python-figure-image",
    "table-native",
    "diagram-connector",
    "diagram-visual",
    "icon-accent",
    "image-hero",
    "mixed",
}
"""Asset rendering modes for PPT slides."""

# ─── RapidOCR Configuration ────────────────────────────────────────────────

RAPIDOCR_POOL_SIZE = 4
"""Number of RapidOCR engines to maintain in the shared pool."""

RAPIDOCR_POOL: _queue.Queue = _queue.Queue()
"""Module-global RapidOCR engine pool, shared across every session."""

RAPIDOCR_POOL_LOCK = None  # Set to threading.Lock at module init
"""Lock protecting RapidOCR pool initialization."""

OCR_TOOL_SEMAPHORE = threading.Semaphore(2)
"""
Limits concurrent extract_scanned_pdf_tool invocations to 2 (saves RAM).
The LLM routinely fans out 8+ scanner calls; without this gate each call
pins per-thread OCR buffers and we exhaust system memory.
"""

# ─── Model Configuration ───────────────────────────────────────────────────

LLM_MODE_CONFIG = {
    "minimax-m2.7": "hepai/minimax-m2.7",
    "minimax-m2.7-highspeed": "hepai/minimax-m2.7-highspeed",
    "deepseek-v4-pro": "hepai/deepseek-v4-pro",
    "deepseek-v4-flash(Fast)": "hepai/deepseek-v4-flash",
    "qwen3_30b": "hepai/qwen3_30b",
}
"""
Supported LLM models and their HepAI identifiers.
deepseek-v4-pro is the default choice (highest context window).
"""

MODEL_CLIENT_PARAMS = {
    "temperature": 0.3,          # Low temperature for stable outputs
    "max_tokens": 16000,         # Output token limit
    "timeout": 120.0,            # Timeout in seconds
    "max_retries": 2,            # Retry attempts
}
"""Default parameters for model client initialization."""

# ─── Dependencies Check ────────────────────────────────────────────────────

OPTIONAL_DEPENDENCIES = {
    'docx': ('python-docx', 'docx'),
    'pdf': ('PyPDF2', 'PyPDF2'),
    'pptx': ('python-pptx', 'pptx'),
    'excel': ('pandas', 'pandas') and ('openpyxl', 'openpyxl'),
}
"""Optional dependencies and their pip package names for document processing."""

# ─── GFS Configuration ─────────────────────────────────────────────────────

GFS_ENABLED_ENV_VAR = "DRSAI_GFS_ENABLED"
"""Environment variable to enable/disable GFS integration."""

GFS_OPENAPI_KEY_ENV_VAR = "GFS_OPENAPI_KEY"
"""Environment variable for GFS API key."""


# ── Public API ────────────────────────────────────────────────────────────

__all__ = [
    # Paths
    "HERE",
    "WORKSPACE",
    "WORKDIR",
    "PPT_SKILL_ROOT",
    "PPT_SCRIPTS_DIR",
    "PPT_REFERENCES_DIR",
    "SKILL_SCRIPTS_DIR",
    "OFFICE_SCRIPTS_DIR",
    "GFS_GENERATED_PREFIX",
    "ensure_workspace_dirs",
    # File tracking
    "TRACKED_EXTENSIONS",
    "EXCLUDED_DIRS",
    # Hallucinated paths & template hunting
    "HALLUCINATED_PATH_HINTS",
    "TEMPLATE_HUNT_TOKENS",
    "PPT_ALLOWLIST_PATTERNS",
    # PPT configuration
    "PPT_SLUG_RE",
    "PPT_ARCHETYPES",
    "PPT_ASSET_MODES",
    # RapidOCR
    "RAPIDOCR_POOL_SIZE",
    "RAPIDOCR_POOL",
    "RAPIDOCR_POOL_LOCK",
    "OCR_TOOL_SEMAPHORE",
    # Models
    "LLM_MODE_CONFIG",
    "MODEL_CLIENT_PARAMS",
    "OPTIONAL_DEPENDENCIES",
    # GFS
    "GFS_ENABLED_ENV_VAR",
    "GFS_OPENAPI_KEY_ENV_VAR",
]
