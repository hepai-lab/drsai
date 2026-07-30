"""PPT Derive Tools - Parse narrative and generate slide specs."""

import subprocess
import sys as _sys
import re as _re
from pathlib import Path


def _resolve_deck_workspace(deck_workspace: str) -> tuple[Path | None, dict | None]:
    """Validate a deck_workspace string."""
    if not deck_workspace or not isinstance(deck_workspace, str):
        return None, {
            "success": False,
            "error": "Missing deck_workspace",
            "message": (
                "deck_workspace is required. Call ppt_init_workspace_tool "
                "first and pass the returned `deck_workspace` value here."
            ),
        }
    p = Path(deck_workspace)
    if not p.is_absolute():
        return None, {
            "success": False,
            "error": "Relative deck_workspace not accepted",
            "message": (
                f"deck_workspace={deck_workspace!r} is a relative path. "
                "Use the absolute path returned by ppt_init_workspace_tool."
            ),
        }
    if not p.exists() or not p.is_dir():
        return None, {
            "success": False,
            "error": "deck_workspace not found",
            "message": (
                f"No directory at {deck_workspace}. Re-run "
                "ppt_init_workspace_tool to create it, or check the "
                "value you received from that tool earlier in the "
                "conversation."
            ),
        }
    return p, None


def ppt_derive_slide_specs_tool(
    deck_workspace: str,
    narrative_path: str | None = None,
    out_yaml: str | None = None,
    ppt_scripts_dir: Path = None,
) -> dict:
    """
    Parse deck_narrative.md and write a structured slide_specs.yaml
    ready for the build step.

    What the script does:
      - Reads YAML frontmatter as deck-level metadata.
      - Splits the body by `### Sxx | <title>` headings.
      - Pulls the first ```yaml slide_spec``` block from each section.
      - Validates the eight required fields per slide: title,
        reader_question, page_task, reading_mode, archetype,
        asset_mode, validation_mode, key_message.
      - Carries the remaining markdown as narrative_markdown.

    Defaults:
      narrative_path = <deck_workspace>/deck_narrative.md
      out_yaml       = <deck_workspace>/build/generated/slide_specs.yaml

    If the script fails with "missing field" errors, read the stderr
    tail to the user — those are authoring problems in
    deck_narrative.md (a slide section forgot its yaml block, the
    yaml block lacks a required field, etc.). Fix in the narrative,
    then re-run this tool.

    Args:
        deck_workspace: Value returned by ppt_init_workspace_tool.
        narrative_path: Optional override; defaults to deck_workspace/deck_narrative.md.
        out_yaml: Optional override; defaults to
            deck_workspace/build/generated/slide_specs.yaml.

    Returns dict with success / slide_specs_path / slide_count /
    stdout_tail / stderr_tail / message.
    """
    ws, err = _resolve_deck_workspace(deck_workspace)
    if err is not None:
        return err

    narr = Path(narrative_path) if narrative_path else (ws / "deck_narrative.md")
    if not narr.exists():
        return {
            "success": False,
            "error": "Narrative not found",
            "message": (
                f"deck_narrative.md not found at {narr}. Edit the "
                "narrative file produced by ppt_init_workspace_tool "
                "before deriving slide_specs."
            ),
        }
    out = Path(out_yaml) if out_yaml else (ws / "build" / "generated" / "slide_specs.yaml")
    out.parent.mkdir(parents=True, exist_ok=True)

    script_path = ppt_scripts_dir / "derive_slide_specs_from_narrative.py"
    if not script_path.exists():
        return {
            "success": False,
            "error": "Script not found",
            "message": f"derive_slide_specs_from_narrative.py not found at {script_path}",
        }

    try:
        proc = subprocess.run(
            [
                _sys.executable,
                str(script_path),
                "--narrative", str(narr),
                "--out-yaml", str(out),
            ],
            cwd=str(ppt_scripts_dir),
            capture_output=True,
            text=True,
            timeout=60,
        )
    except subprocess.TimeoutExpired:
        return {
            "success": False,
            "error": "Timeout",
            "message": "derive_slide_specs_from_narrative.py did not finish within 60s",
        }
    except Exception as exc:
        return {
            "success": False,
            "error": str(exc),
            "message": f"Failed to invoke derive_slide_specs_from_narrative.py: {exc}",
        }

    result = {
        "success": proc.returncode == 0,
        "returncode": proc.returncode,
        "stdout_tail": (proc.stdout or "")[-2000:],
        "stderr_tail": (proc.stderr or "")[-2000:],
    }

    slide_count = None
    if result.get("success"):
        m = _re.search(r"slides=(\d+)", result.get("stdout_tail") or "")
        if m:
            slide_count = int(m.group(1))
        result["slide_specs_path"] = str(out)
        result["slide_count"] = slide_count
        result["message"] = (
            f"Derived {slide_count if slide_count is not None else '?'} "
            f"slide spec(s) → {out}."
        )
    else:
        result["message"] = (
            "Derive failed. Common causes: deck_narrative.md is "
            "missing YAML frontmatter, a `### Sxx | <title>` heading, "
            "a ```yaml slide_spec``` block, or one of the required "
            "slide fields (title, reader_question, page_task, "
            "reading_mode, archetype, asset_mode, validation_mode, "
            "key_message). Read stderr_tail and fix the narrative, "
            "then call again."
        )
    return result
