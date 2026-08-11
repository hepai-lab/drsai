"""PPT Core Tools - Reference, environment, workspace initialization, and auditing."""

import re
import subprocess
import sys as _sys
import json as _json
from pathlib import Path


# ============================================================================
# Reference Tools
# ============================================================================

def ppt_read_skill_reference_tool(
    name: str,
    ppt_references_dir: Path,
    ppt_reference_names: set,
) -> dict:
    """
    Read one of the PPT skill's reference documents and return its text.

    Use this BEFORE planning a deck whenever you need methodology:
    page archetypes, slide design system, quality gate semantics, build
    routes, diagram / chart / icon / python figure rules.

    Args:
        name: One of:
            - "principles"
            - "deck_workflow"
            - "technical_support"
            - "design_support"
            - "slide_design_system"
            - "quality_gates"
            - "build_routes"
            - "diagram_support"
            - "office_chart_support"
            - "python_figure_support"
            - "icon_system"

    Returns dict with:
        success / name / path / content (full markdown) / message.
    """
    if name not in ppt_reference_names:
        return {
            "success": False,
            "error": "Unknown reference",
            "message": (
                f"name={name!r} is not a valid PPT skill reference. "
                f"Valid names: {sorted(ppt_reference_names)}"
            ),
        }
    ref_path = ppt_references_dir / f"{name}.md"
    if not ref_path.exists():
        return {
            "success": False,
            "error": "Reference file missing",
            "message": (
                f"{ref_path} does not exist. The PPT skill may be "
                "incomplete; check that "
                "skills/presentation-skills/ppt-polished-deck-collab-traditional/references/ "
                "is intact."
            ),
        }
    try:
        content = ref_path.read_text(encoding="utf-8")
    except Exception as exc:
        return {
            "success": False,
            "error": str(exc),
            "message": f"Failed to read {ref_path}: {exc}",
        }
    return {
        "success": True,
        "name": name,
        "path": str(ref_path),
        "content": content,
        "message": f"Loaded reference {name} ({len(content)} chars)",
    }


def ppt_check_environment_tool(
    deck_workspace: str | None = None,
    ppt_scripts_dir: Path = None,
    workdir: Path = None,
    user_id: str = None,
) -> dict:
    """
    Probe the local environment for the PPT skill's required tooling
    and return the set of available build / preview routes.

    Use this as the FIRST step of every PPT task — it tells you which
    preview backend (PowerPoint vs LibreOffice) you can actually use,
    and which optional capabilities (Python figure, Mermaid) are
    present. The agent should branch on the returned `routes` list
    instead of assuming a backend is available.

    Args:
        deck_workspace: Optional. When provided, the JSON env report is
            written to <deck_workspace>/validation/env_check.json so the
            deck has a durable record of which routes were available
            when it was built.

    Returns dict with:
        success / routes (list) / report (parsed JSON) / stdout_tail /
        stderr_tail / message.
    """
    json_out: Path
    if deck_workspace:
        ws = Path(deck_workspace).resolve()
        target_dir = ws / "validation"
        target_dir.mkdir(parents=True, exist_ok=True)
        json_out = target_dir / "env_check.json"
    else:
        # Fall back to a per-user scratch path so we can still read the
        # structured report even when the agent has not picked a deck
        # workspace yet.
        sub = user_id or "_default"
        scratch = (workdir / sub) / "_ppt_env_check.json"
        scratch.parent.mkdir(parents=True, exist_ok=True)
        json_out = scratch

    script_path = ppt_scripts_dir / "check_environment.py"
    if not script_path.exists():
        return {
            "success": False,
            "error": "Script not found",
            "message": f"check_environment.py not found at {script_path}",
        }

    try:
        proc = subprocess.run(
            [_sys.executable, str(script_path), "--json-out", str(json_out)],
            cwd=str(ppt_scripts_dir),
            capture_output=True,
            text=True,
            timeout=120,
        )
    except subprocess.TimeoutExpired:
        return {
            "success": False,
            "error": "Timeout",
            "message": "check_environment.py did not finish within 120s",
            "stderr_tail": "",
        }
    except Exception as exc:
        return {
            "success": False,
            "error": str(exc),
            "message": f"Failed to invoke check_environment.py: {exc}",
        }

    result = {
        "success": proc.returncode == 0,
        "returncode": proc.returncode,
        "stdout_tail": (proc.stdout or "")[-2000:],
        "stderr_tail": (proc.stderr or "")[-2000:],
    }

    if json_out.exists():
        try:
            result["report"] = _json.loads(json_out.read_text(encoding="utf-8"))
            result["report_path"] = str(json_out)
        except Exception as exc:
            result["report_read_error"] = str(exc)

    routes = []
    report = result.get("report") or {}
    if isinstance(report, dict):
        routes = list(report.get("routes") or [])
    result["routes"] = routes
    result["message"] = (
        f"Detected {len(routes)} available route(s): "
        + (", ".join(routes) if routes else "(none)")
    )
    return result


# ============================================================================
# Workspace Tools
# ============================================================================

_PPT_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9\-]{0,62}$")


def _ppt_brief_md(deck_title: str) -> str:
    """Return a filled-in brief.md template (matches deck_workflow.md)."""
    return (
        f"# {deck_title}\n\n"
        "## 任务定义\n"
        "- 目标读者：\n"
        "- 主使用场景：\n"
        "- 目标动作：\n"
        "- 参考模板文件：\n"
        "- 模板 / 品牌约束：\n"
        "- 交付物要求：\n"
        "- 验证要求：\n\n"
        "## 模板取证\n"
        "- 页面系统判断：\n"
        "- 关键母版 / layout 元素：\n"
        "- 字号系统：\n"
        "- 计划采用的构建路线：\n"
        "- 最小 PoC 结论：\n\n"
        "## 风格与边界\n"
        "- 风格参考：\n"
        "- typography_profile：zh_formal\n"
        "- domain_profile：\n"
        "- 允许使用的素材：\n"
        "- 禁止使用的品牌元素：\n"
        "- 免责声明 / 风险边界：\n"
        "- 不允许发生的错误：\n"
    )


def _ppt_narrative_md(deck_title: str) -> str:
    """Return a starter deck_narrative.md (zh_formal theme_tokens).

    The YAML frontmatter is built via ``yaml.safe_dump`` rather than
    string concatenation: hand-rolled f-string injection broke on
    titles containing ``"`` (which closed the double-quoted scalar
    prematurely) or ``\\`` (PyYAML treats it as an escape lead-in
    and raises ``ScannerError`` on ``\\p`` / ``\\n`` etc.). Routing
    through ``safe_dump`` lets PyYAML pick the right quoting style.
    """
    import yaml as _yaml

    frontmatter = {
        "deck": {
            "title": deck_title,
            "audience": "<target audience>",
            "scenario": "<primary scenario>",
            "objective": "<primary decision or action>",
            "theme_tokens": {
                "typography_profile": "zh_formal",
                "domain_profile": None,
                "hero_title_font_pt": 24,
                "section_title_font_pt": 20,
                "page_title_font_pt": 24,
                "subtitle_font_pt": 16,
                "minor_title_font_pt": 14,
                "body_font_pt": 12,
                "label_font_pt": 10.5,
                "caption_font_pt": 9,
                "title_line_spacing_multiple": 1.0,
                "body_line_spacing_multiple": 1.5,
                "title_paragraph_space_lines": 0.5,
                "body_first_line_indent_chars": 2,
                "body_paragraph_space_lines": 0.5,
                "latin_font_name": "Times New Roman",
                "east_asia_font_name": "宋体",
                "table_font_pt": 10.5,
                "table_line_spacing_multiple": 1.0,
                "table_paragraph_space_lines": 0,
                "table_first_line_indent_chars": 0,
                "table_vertical_anchor": "middle",
                "table_header_alignment": "center",
                "table_index_alignment": "left",
                "table_text_alignment": "left",
                "table_numeric_alignment": "right",
            },
        }
    }
    yaml_body = _yaml.safe_dump(
        frontmatter,
        allow_unicode=True,
        sort_keys=False,
        default_flow_style=False,
    )
    # Also defang the H1 line: a deck_title containing a real
    # newline would split the heading into two lines and confuse
    # tools that treat the first line as the H1.
    h1_safe = " ".join((deck_title or "").splitlines()).strip() or "Deck"
    return (
        "---\n"
        f"{yaml_body}"
        "---\n\n"
        f"# {h1_safe}\n\n"
        "## Global Narrative\n"
        "- 这套 deck 的主判断：\n"
        "- 这套 deck 的论证主线：\n"
        "- 这套 deck 的主题词和禁区：\n\n"
        "### S01 | <slide title>\n"
        "```yaml slide_spec\n"
        "title: '<slide title>'\n"
        "reader_question: '<what this page should answer>'\n"
        "page_task: 'persuade'\n"
        "reading_mode: 'decision'\n"
        "archetype: 'hero-statement'\n"
        "asset_mode: 'text-layout-native'\n"
        "validation_mode: 'preview_only'\n"
        "key_message: '<single core message>'\n"
        "required_assets: []\n"
        "```\n\n"
        "**Narrative Role.** 这页为什么存在、要帮助读者完成什么判断。\n\n"
        "**Content Notes.** 这页准备放什么内容、什么判断句、什么证据。\n\n"
        "**Layout Notes.** 这页倾向使用什么版式、什么 icon 或图表策略。\n"
    )


def ppt_init_workspace_tool(
    deck_slug: str,
    deck_title: str,
    workdir: Path,
    user_id: str,
) -> dict:
    """
    Create a deck workspace under the current user's work dir, with
    `brief.md` + `deck_narrative.md` (zh_formal theme_tokens already
    filled in) and the six standard sub-directories required by the
    `ppt-polished-deck-collab` skill.

    Call this as the FIRST PPT tool of every deck task. All subsequent
    PPT tools should pass the returned `deck_workspace` value as their
    `--workspace-dir` — never assemble the path yourself.

    Args:
        deck_slug: kebab-case identifier for this deck (a–z, 0–9, '-';
            max 63 chars). Used as the directory name. Example:
            "ihep-2026-q2-safety".
        deck_title: Human-readable deck title — appears in brief.md
            and the narrative document's YAML frontmatter `deck.title`.

    Returns dict with:
        success / deck_workspace (abs path) / brief_path /
        narrative_path / created (list of created paths) /
        already_exists (bool) / message.
    """
    slug = (deck_slug or "").strip().lower()
    if not _PPT_SLUG_RE.match(slug):
        return {
            "success": False,
            "error": "Invalid deck_slug",
            "message": (
                f"deck_slug={deck_slug!r} must be kebab-case "
                "(a-z, 0-9, '-', start with alnum, max 63 chars). "
                "Examples: 'ihep-2026-safety', 'q2-product-review'."
            ),
        }
    if not deck_title or not deck_title.strip():
        return {
            "success": False,
            "error": "Missing deck_title",
            "message": "deck_title is required and must be non-empty.",
        }

    sub = user_id or "_default"
    base = workdir / sub / "decks" / slug
    already_exists = base.exists()
    base.mkdir(parents=True, exist_ok=True)

    sub_dirs = [
        "data",
        "assets/diagrams",
        "assets/charts",
        "assets/icons",
        "assets/images",
        "assets/tables",
        "build/generated",
        "build/pptx",
        "build/rendered/ppt_preview",
        "build/rendered/python_figures",
        "validation/template_audit",
        "validation/package_preflight/history",
        "validation/structure_precheck/history",
        "validation/render_review/history",
        "validation/visual",
        "final",
    ]
    created: list[str] = []
    for rel in sub_dirs:
        target = base / rel
        if not target.exists():
            target.mkdir(parents=True, exist_ok=True)
            created.append(str(target))

    brief_path = base / "brief.md"
    narrative_path = base / "deck_narrative.md"
    if not brief_path.exists():
        brief_path.write_text(
            _ppt_brief_md(deck_title.strip()), encoding="utf-8"
        )
        created.append(str(brief_path))
    if not narrative_path.exists():
        narrative_path.write_text(
            _ppt_narrative_md(deck_title.strip()), encoding="utf-8"
        )
        created.append(str(narrative_path))

    return {
        "success": True,
        "deck_workspace": str(base),
        "brief_path": str(brief_path),
        "narrative_path": str(narrative_path),
        "created": created,
        "already_exists": already_exists,
        "message": (
            f"Deck workspace ready at {base}. "
            f"{'Re-used existing structure.' if already_exists else 'Created fresh.'} "
            "Next: edit brief.md and deck_narrative.md, then call "
            "ppt_derive_slide_specs_tool."
        ),
    }


def _resolve_deck_workspace(deck_workspace: str) -> tuple[Path | None, dict | None]:
    """Validate a deck_workspace string.

    Returns (path, None) on success or (None, error_dict) when the
    input is missing, not absolute, or does not exist. Phase 2 tools
    short-circuit on the error dict so the agent gets a directive
    recovery hint instead of a generic OS error.
    """
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


def ppt_lint_workspace_tool(deck_workspace: str, ppt_scripts_dir: Path) -> dict:
    """
    Check that a deck workspace has the required directories, the two
    human-authored markdown files, and a derived slide_specs.yaml.

    Use this as a pre-flight before build to catch missing inputs
    without trying to compile a half-finished deck. The script also
    reports asset-folder occupancy (diagrams / charts / icons /
    images / tables) so the agent can spot under-supplied assets.

    Args:
        deck_workspace: Value returned by ppt_init_workspace_tool.

    Returns dict with success, report (parsed JSON), errors,
    warnings, message.
    """
    ws, err = _resolve_deck_workspace(deck_workspace)
    if err is not None:
        return err

    json_out = ws / "validation" / "workspace_lint.json"
    script_path = ppt_scripts_dir / "lint_deck_assets.py"
    if not script_path.exists():
        return {
            "success": False,
            "error": "Script not found",
            "message": f"lint_deck_assets.py not found at {script_path}",
        }

    try:
        proc = subprocess.run(
            [
                _sys.executable,
                str(script_path),
                "--workspace-dir", str(ws),
                "--json-out", str(json_out),
            ],
            cwd=str(ppt_scripts_dir),
            capture_output=True,
            text=True,
            timeout=30,
        )
    except subprocess.TimeoutExpired:
        return {
            "success": False,
            "error": "Timeout",
            "message": "lint_deck_assets.py did not finish within 30s",
        }
    except Exception as exc:
        return {
            "success": False,
            "error": str(exc),
            "message": f"Failed to invoke lint_deck_assets.py: {exc}",
        }

    result = {
        "success": proc.returncode == 0,
        "returncode": proc.returncode,
        "stdout_tail": (proc.stdout or "")[-2000:],
        "stderr_tail": (proc.stderr or "")[-2000:],
    }

    if json_out.exists():
        try:
            result["report"] = _json.loads(json_out.read_text(encoding="utf-8"))
        except Exception as exc:
            result["report_read_error"] = str(exc)

    report = result.get("report") or {}
    result["errors"] = list(report.get("errors") or [])
    result["warnings"] = list(report.get("warnings") or [])
    if result.get("success"):
        result["message"] = (
            "Workspace lint passed."
            + (f" Warnings: {len(result['warnings'])}."
               if result["warnings"] else "")
        )
    else:
        result["message"] = (
            f"Workspace lint failed with {len(result['errors'])} "
            "error(s). Fix the missing directories/files, then re-run."
        )
    return result


# ============================================================================
# Audit Tools
# ============================================================================

def _resolve_pptx_path(pptx_path: str, label: str = "pptx_path") -> tuple[Path | None, dict | None]:
    """Validate a .pptx path argument."""
    if not pptx_path or not isinstance(pptx_path, str):
        return None, {
            "success": False,
            "error": f"Missing {label}",
            "message": f"{label} is required.",
        }
    p = Path(pptx_path)
    if not p.is_absolute():
        return None, {
            "success": False,
            "error": f"Relative {label} not accepted",
            "message": (
                f"{label}={pptx_path!r} is relative. Use the absolute "
                "path returned by your previous build step."
            ),
        }
    if not p.exists():
        return None, {
            "success": False,
            "error": "File not found",
            "message": f"{label}: no file at {pptx_path}.",
        }
    if p.suffix.lower() != ".pptx":
        return None, {
            "success": False,
            "error": "Not a .pptx file",
            "message": f"{label}={pptx_path!r} is not a .pptx file.",
        }
    return p, None


def ppt_audit_template_tool(
    pptx_path: str,
    deck_workspace: str,
    sample_limit: int = 3,
    text_preview_limit: int = 90,
    ppt_scripts_dir: Path = None,
) -> dict:
    """
    Audit a reference .pptx template — discover its layout family,
    master/layout/slide text inventory and font-size distribution.

    Use this when the user provides an existing .pptx and wants the
    new deck to inherit its page system. Run BEFORE writing
    deck_narrative.md so the narrative can be anchored to the
    template's real font sizes and layout names, not a guess.

    Outputs are written to:
      <deck_workspace>/validation/template_audit/template_audit.json
      <deck_workspace>/validation/template_audit/template_audit.md

    After running, fold the key findings (font-size ladder, layout
    family, shared master elements, build-route choice) back into
    brief.md so subsequent steps treat them as deck-level facts.

    Args:
        pptx_path: Absolute path to the reference .pptx.
        deck_workspace: Value returned by ppt_init_workspace_tool.
        sample_limit: How many sample text strings to retain per
            font-size bucket (default 3).
        text_preview_limit: Max characters per retained sample
            (default 90).

    Returns dict with success, json_path, md_path, report (parsed
    JSON), stdout_tail, stderr_tail, message.
    """
    pptx, err = _resolve_pptx_path(pptx_path)
    if err is not None:
        return err
    ws, err = _resolve_deck_workspace(deck_workspace)
    if err is not None:
        return err

    target_dir = ws / "validation" / "template_audit"
    target_dir.mkdir(parents=True, exist_ok=True)
    json_out = target_dir / "template_audit.json"
    md_out = target_dir / "template_audit.md"

    script_path = ppt_scripts_dir / "audit_pptx_template.py"
    if not script_path.exists():
        return {
            "success": False,
            "error": "Script not found",
            "message": f"audit_pptx_template.py not found at {script_path}",
        }

    try:
        proc = subprocess.run(
            [
                _sys.executable,
                str(script_path),
                "--pptx", str(pptx),
                "--json-out", str(json_out),
                "--md-out", str(md_out),
                "--sample-limit", str(sample_limit),
                "--text-preview-limit", str(text_preview_limit),
            ],
            cwd=str(ppt_scripts_dir),
            capture_output=True,
            text=True,
            timeout=180,
        )
    except subprocess.TimeoutExpired:
        return {
            "success": False,
            "error": "Timeout",
            "message": "audit_pptx_template.py did not finish within 180s",
        }
    except Exception as exc:
        return {
            "success": False,
            "error": str(exc),
            "message": f"Failed to invoke audit_pptx_template.py: {exc}",
        }

    result = {
        "success": proc.returncode == 0,
        "returncode": proc.returncode,
        "stdout_tail": (proc.stdout or "")[-2000:],
        "stderr_tail": (proc.stderr or "")[-2000:],
    }

    if json_out.exists():
        try:
            result["report"] = _json.loads(json_out.read_text(encoding="utf-8"))
        except Exception as exc:
            result["report_read_error"] = str(exc)

    result["json_path"] = str(json_out) if json_out.exists() else None
    result["md_path"] = str(md_out) if md_out.exists() else None
    if result.get("success"):
        summary = (result.get("report") or {}).get("summary") or {}
        result["message"] = (
            f"Template audit OK. slides={summary.get('slide_count', '?')}, "
            f"masters={summary.get('master_count', '?')}, "
            f"layouts={summary.get('default_slide_layout_count', '?')}. "
            f"Findings written to {target_dir}."
        )
    else:
        result["message"] = (
            "Template audit failed. Check stderr_tail for details; "
            "if soffice / pptx parsing complains, confirm the file is "
            "a real .pptx (not .ppt — convert via Office or LibreOffice first)."
        )
    return result
