"""
Legacy .doc → .docx conversion skill for DocMaster.

Wraps `soffice --headless --convert-to docx` via the existing socket-sandbox-
aware helper at skills/docx/scripts/office/soffice.py.

Public API:
    skill = DocToDocxSkill(workspace_dir)
    skill.convert(input_path, output_path=None)

If `soffice` (LibreOffice) is not on PATH, returns a clear error with an
install hint — does not raise.
"""

from __future__ import annotations

import importlib.util
import logging
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)


_INSTALL_HINT = (
    "LibreOffice (soffice) not found on PATH. "
    "Install with: `sudo apt install libreoffice-core libreoffice-writer` (Debian/Ubuntu) "
    "or `brew install --cask libreoffice` (macOS)."
)


class DocToDocxSkill:
    """Convert legacy Word .doc files to modern .docx."""

    def __init__(self, workspace_dir: Optional[str] = None) -> None:
        if workspace_dir is None:
            workspace_dir = str(Path(__file__).resolve().parent.parent / "workspace")
        self.workspace_dir = Path(workspace_dir)
        self.workspace_dir.mkdir(parents=True, exist_ok=True)

    def convert(self, input_path: str, output_path: Optional[str] = None) -> Dict[str, Any]:
        in_path = Path(input_path)
        if not in_path.exists():
            return {
                "success": False,
                "error": "File not found",
                "message": f"Input not found: {input_path}",
            }

        suffix = in_path.suffix.lower()
        # Already a .docx — short-circuit so the agent can call this on any
        # uploaded Word file without branching.
        if suffix == ".docx":
            return {
                "success": True,
                "input_path": str(in_path),
                "output_path": str(in_path),
                "soffice_used": False,
                "note": "already .docx",
                "message": "Input is already a .docx file; no conversion performed.",
            }
        if suffix != ".doc":
            return {
                "success": False,
                "error": "Unsupported file type",
                "message": f"Expected .doc or .docx (got {in_path.suffix}).",
            }

        # Decide output path
        if output_path is None:
            out_path = in_path.with_suffix(".docx")
        else:
            out_path = Path(output_path)
            if out_path.suffix.lower() != ".docx":
                out_path = out_path.with_suffix(".docx")
        out_path.parent.mkdir(parents=True, exist_ok=True)

        if shutil.which("soffice") is None:
            return {
                "success": False,
                "error": "soffice not found",
                "input_path": str(in_path),
                "output_path": str(out_path),
                "soffice_used": False,
                "message": _INSTALL_HINT,
            }

        # Run soffice in headless mode into a temp dir, then move the result.
        try:
            run_soffice = _load_soffice_helper()
        except Exception as exc:
            logger.warning("Could not load soffice helper, falling back to plain subprocess: %s", exc)
            run_soffice = _plain_run_soffice

        with tempfile.TemporaryDirectory(prefix="doc2docx_") as td:
            args = [
                "--headless",
                "--convert-to", "docx",
                "--outdir", td,
                str(in_path),
            ]
            try:
                result = run_soffice(args, capture_output=True, text=True, timeout=180)
            except subprocess.TimeoutExpired:
                return {
                    "success": False,
                    "error": "soffice timeout",
                    "input_path": str(in_path),
                    "output_path": str(out_path),
                    "soffice_used": True,
                    "message": "soffice conversion exceeded 180s timeout.",
                }
            except Exception as exc:
                return {
                    "success": False,
                    "error": str(exc),
                    "input_path": str(in_path),
                    "output_path": str(out_path),
                    "soffice_used": True,
                    "message": f"soffice invocation failed: {exc}",
                }

            if result.returncode != 0:
                return {
                    "success": False,
                    "error": "soffice non-zero exit",
                    "input_path": str(in_path),
                    "output_path": str(out_path),
                    "soffice_used": True,
                    "returncode": result.returncode,
                    "stderr": (result.stderr or "")[-2000:],
                    "message": f"soffice returned {result.returncode}: {(result.stderr or '').strip()[:300]}",
                }

            produced = Path(td) / (in_path.stem + ".docx")
            if not produced.exists():
                # Fallback: pick any .docx soffice produced (some versions
                # rename based on the document title).
                candidates = list(Path(td).glob("*.docx"))
                if not candidates:
                    return {
                        "success": False,
                        "error": "no output produced",
                        "input_path": str(in_path),
                        "output_path": str(out_path),
                        "soffice_used": True,
                        "message": "soffice exited cleanly but produced no .docx file.",
                    }
                produced = candidates[0]

            shutil.move(str(produced), str(out_path))

        if not _is_valid_docx(out_path):
            return {
                "success": False,
                "error": "invalid docx",
                "input_path": str(in_path),
                "output_path": str(out_path),
                "soffice_used": True,
                "message": "Converted file is not a valid .docx (missing word/document.xml).",
            }

        return {
            "success": True,
            "input_path": str(in_path),
            "output_path": str(out_path),
            "soffice_used": True,
            "message": f"Converted {in_path.name} → {out_path.name}",
        }


def _load_soffice_helper():
    """Load the project's soffice helper from skills/docx/scripts/office/soffice.py.

    Falls back to a plain subprocess.run if the helper can't be loaded.
    """
    helper_path = (
        Path(__file__).resolve().parent.parent
        / "skills" / "docx" / "scripts" / "office" / "soffice.py"
    )
    if not helper_path.exists():
        raise FileNotFoundError(f"soffice helper not at {helper_path}")
    spec = importlib.util.spec_from_file_location("_docmaster_soffice_helper", str(helper_path))
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module.run_soffice


def _plain_run_soffice(args, **kwargs):
    return subprocess.run(["soffice"] + list(args), **kwargs)


def _is_valid_docx(path: Path) -> bool:
    if not path.exists():
        return False
    try:
        with zipfile.ZipFile(str(path)) as zf:
            names = zf.namelist()
        return any(n == "word/document.xml" for n in names)
    except Exception:
        return False


if __name__ == "__main__":  # pragma: no cover
    import sys
    if len(sys.argv) < 2:
        print("Usage: python doc_to_docx_skill.py <input.doc> [output.docx]")
        sys.exit(1)
    skill = DocToDocxSkill()
    out = sys.argv[2] if len(sys.argv) >= 3 else None
    print(skill.convert(sys.argv[1], out))
