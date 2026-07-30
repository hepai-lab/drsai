"""PPT Icon Tools - Search and render icons."""

import subprocess
import sys as _sys
from pathlib import Path


def ppt_icon_search_tool(
    query: str,
    pack: str | None = None,
    ppt_scripts_dir: Path = None,
) -> dict:
    """
    Search the PPT skill's Tabler-Outline icon registry.

    Use this when planning an icon-accent page (asset_mode=icon-accent)
    or when looking for a section header icon. Icons are SUPPORTING
    assets — they never carry primary information.

    Args:
        query: Space-separated keywords (English or Chinese aliases
            both work). Example: "risk safety" or "趋势 增长".
        pack: Optional pack id. One of:
            - "general-layout" (default scope — titles, cards, sections)
            - "llm-research" (ACL/EMNLP/LLM/Agent/RAG topics)
            Omit to search across all packs.

    Returns dict with success, matches (list of {score, id,
    source_name, packs, aliases, usage_note}), stdout_tail, message.
    """
    if not query or not isinstance(query, str) or not query.strip():
        return {
            "success": False,
            "error": "Missing query",
            "message": "query is required (space-separated keywords).",
        }
    args = ["search", "--query", query]
    if pack:
        args.extend(["--pack", str(pack)])

    script_path = ppt_scripts_dir / "icon_registry.py"
    if not script_path.exists():
        return {
            "success": False,
            "error": "Script not found",
            "message": f"icon_registry.py not found at {script_path}",
        }

    try:
        proc = subprocess.run(
            [_sys.executable, str(script_path), *args],
            cwd=str(ppt_scripts_dir),
            capture_output=True,
            text=True,
            timeout=30,
        )
    except subprocess.TimeoutExpired:
        return {
            "success": False,
            "error": "Timeout",
            "message": "icon_registry.py did not finish within 30s",
        }
    except Exception as exc:
        return {
            "success": False,
            "error": str(exc),
            "message": f"Failed to invoke icon_registry.py: {exc}",
        }

    result = {
        "success": proc.returncode == 0,
        "returncode": proc.returncode,
        "stdout_tail": (proc.stdout or "")[-2000:],
        "stderr_tail": (proc.stderr or "")[-2000:],
    }

    # Parse stdout's [MATCH ...] lines into a structured list.
    matches = []
    current = None
    for line in (result.get("stdout_tail") or "").splitlines():
        line = line.rstrip()
        if line.startswith("[MATCH]"):
            if current:
                matches.append(current)
            parts = line[len("[MATCH]"):].strip().split()
            rec = {"score": None, "id": None, "source_name": None, "packs": []}
            for p in parts:
                if "=" in p:
                    k, v = p.split("=", 1)
                    if k == "score":
                        try:
                            rec["score"] = int(v)
                        except ValueError:
                            rec["score"] = v
                    elif k == "packs":
                        rec["packs"] = [x for x in v.split(",") if x]
                    elif k in {"id", "source"}:
                        rec["id" if k == "id" else "source_name"] = v
            current = rec
        elif current and "aliases=" in line:
            current["aliases"] = [
                x for x in line.split("aliases=", 1)[1].split(",") if x
            ]
        elif current and "usage=" in line:
            current["usage_note"] = line.split("usage=", 1)[1]
    if current:
        matches.append(current)
    result["matches"] = matches
    result["message"] = (
        f"Found {len(matches)} icon match(es) for query={query!r}."
    )
    return result


def ppt_icon_render_tool(
    deck_workspace: str,
    pack: str | None = None,
    size: int = 128,
    color_mode: str = "auto",
    background_color: str = "#F8FAFC",
    accent_color: str = "#2563EB",
    theme_name: str = "default",
    icon_color: str | None = None,
    ppt_scripts_dir: Path = None,
) -> dict:
    """
    Render icon PNGs into the deck workspace, with deck-aware
    recoloring (auto mode picks colors from the icon's role + the
    slide background + the accent color, then enforces WCAG ≥3.0
    contrast).

    Output goes to:
      <deck_workspace>/assets/icons/<pack or 'all'>/<theme_name>/

    so a build can later reference these PNGs by relative path
    without polluting the skill directory.

    Args:
        deck_workspace: Value returned by ppt_init_workspace_tool.
        pack: Optional. 'general-layout' / 'llm-research'. Omit to
            render every pack.
        size: Square PNG side in pixels (default 128).
        color_mode: 'auto' (default — recommend per icon), 'original'
            (keep SVG default colors), or 'fixed' (use icon_color).
        background_color: Slide background hex, used by 'auto' mode.
            Default '#F8FAFC'.
        accent_color: Deck accent hex, used by 'auto' mode. Default
            '#2563EB'.
        theme_name: Sub-directory name under assets/icons/<pack>/
            (so multiple light/dark variants can coexist).
        icon_color: Required when color_mode='fixed'; ignored
            otherwise.

    Returns dict with success, out_dir, stdout_tail, stderr_tail,
    message.
    """
    ws = Path(deck_workspace).resolve()
    if not ws.exists() or not ws.is_dir():
        return {
            "success": False,
            "error": "deck_workspace not found",
            "message": f"No directory at {deck_workspace}",
        }

    if color_mode not in {"auto", "original", "fixed"}:
        return {
            "success": False,
            "error": "Invalid color_mode",
            "message": "color_mode must be one of: auto, original, fixed.",
        }
    if color_mode == "fixed" and not icon_color:
        return {
            "success": False,
            "error": "Missing icon_color",
            "message": "icon_color is required when color_mode='fixed'.",
        }

    scope = pack or "all"
    out_dir = ws / "assets" / "icons" / scope / theme_name
    out_dir.mkdir(parents=True, exist_ok=True)

    args = [
        "render",
        "--size", str(int(size)),
        "--color-mode", color_mode,
        "--background-color", background_color,
        "--accent-color", accent_color,
        "--theme-name", theme_name,
        "--out-dir", str(out_dir),
    ]
    if pack:
        args.extend(["--pack", pack])
    if icon_color:
        args.extend(["--icon-color", icon_color])

    script_path = ppt_scripts_dir / "icon_registry.py"
    if not script_path.exists():
        return {
            "success": False,
            "error": "Script not found",
            "message": f"icon_registry.py not found at {script_path}",
        }

    try:
        proc = subprocess.run(
            [_sys.executable, str(script_path), *args],
            cwd=str(ppt_scripts_dir),
            capture_output=True,
            text=True,
            timeout=120,
        )
    except subprocess.TimeoutExpired:
        return {
            "success": False,
            "error": "Timeout",
            "message": "icon_registry.py did not finish within 120s",
        }
    except Exception as exc:
        return {
            "success": False,
            "error": str(exc),
            "message": f"Failed to invoke icon_registry.py: {exc}",
        }

    result = {
        "success": proc.returncode == 0,
        "returncode": proc.returncode,
        "stdout_tail": (proc.stdout or "")[-2000:],
        "stderr_tail": (proc.stderr or "")[-2000:],
    }

    result["out_dir"] = str(out_dir)
    # The script may exit non-zero if a single SVG is missing — be
    # explicit so the agent can advise running `icon_registry.py sync`
    # (the agent can't run sync directly; this is a skill-maintenance
    # operation handled out-of-band).
    if result.get("success"):
        pngs = sorted(out_dir.glob("*.png"))
        result["icon_count"] = len(pngs)
        result["message"] = (
            f"Rendered {len(pngs)} icon(s) under {out_dir}."
        )
    else:
        result["message"] = (
            "Icon render failed. If stderr mentions a missing .svg, "
            "the icon registry needs `icon_registry.py sync` first — "
            "this is a one-off skill-maintenance task (it downloads "
            "SVGs from the Tabler GitHub repo). Tell the user; this "
            "tool does not auto-sync."
        )
    return result
