"""
DOCX Template Fill Skill for DocMaster.

Lets DocMaster generate filled DOCX files from a user-uploaded template.
Supports three input styles:

- Jinja (via docxtpl): {{ name }}, {% for x in xs %}…{% endfor %},
  {%tr for row in rows %}…{%tr endtr %} for table rows.
- Bracket: [NAME], [DATE] — literal substitution via python-docx.
- Heuristic slots: for templates that don't use any placeholder syntax —
  underscore lines (`______`), "Label:" with empty tail, and empty table
  cells under a header. The skill returns slot candidates from
  inspect_template; the caller maps slot ids to values and passes
  `slot_values` to fill_template.

Formatting note: bracket and slot fills only modify the runs that span the
matched text; other runs in the same paragraph keep their original
formatting intact.

Public API:
    skill = DocxTemplateSkill(workspace_dir)
    skill.inspect_template(template_path)
    skill.fill_template(template_path, output_path, context, slot_values, mode="auto")
"""

from __future__ import annotations

import logging
import re
import zipfile
from collections import defaultdict
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional, Set, Tuple

logger = logging.getLogger(__name__)


_BRACKET_RE = re.compile(r"\[([A-Z][A-Z0-9_\-]*)\]")
_JINJA_VAR_RE = re.compile(r"\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)")
_JINJA_LOOP_TOKENS = ("{% for", "{%- for", "{%p for", "{%tr for")
_JINJA_IF_TOKENS = ("{% if", "{%- if", "{%p if", "{%tr if")

# Underscores eligible as fill markers. Includes ASCII '_' and full-width '＿',
# in runs of 3+. A second pattern catches spaced sequences like "_ _ _ _" or
# "＿ ＿ ＿" (2+ separated underscores) which are common in Chinese forms.
_UNDERSCORE_RUN_RE = re.compile(r"[_＿]{3,}|(?:[_＿](?:[ 　]+[_＿]){1,}){1}")
# Label preceding an underscore run, e.g. "Patient Name: ______".
# Captures the label text (without the trailing colon).
_LABEL_BEFORE_RE = re.compile(r"([^\s:：][^:：\n]{0,79})\s*[:：]\s*$")
# Whole paragraph ending in "Label:" with nothing after.
_LABEL_ONLY_RE = re.compile(r"^\s*(.{1,80}?)\s*[:：]\s*$")

# Signature / seal indicators — these slots must be LEFT BLANK rather than
# filled. Looked up against the label found before the underscore and against
# any short trailing text after it (e.g. "________  (signature)").
_SIGNATURE_RE = re.compile(
    r"(?:签\s*字|签\s*名|签\s*章|盖\s*章|落\s*款|手\s*印|"
    r"signature|signed\s*by|sign\s*here|signatory|autograph|initials?|seal)",
    re.IGNORECASE,
)

# <placeholder> or 《占位符》 — angle-bracketed slot tokens
_ANGLE_BRACKET_RE = re.compile(r"<([^<>\n]{1,80})>|《([^《》\n]{1,80})》")

# Phrase bank for placeholder-like prose (bilingual). Matched as whole paragraph
# OR as a parenthesised tail. Case-insensitive.
_PLACEHOLDER_PHRASES = [
    r"your\s+(?:text|name|content|answer|response|bio|title|address|email|phone)\s+(?:here|goes\s+here)?",
    r"insert\s+(?:your\s+)?[\w\s]{1,40}\s+here",
    r"provide\s+(?:your\s+|a\s+|the\s+)?[\w\s]{1,40}\s+here",
    r"replace\s+(?:this|with)\s+[\w\s]{1,40}",
    r"enter\s+(?:your\s+)?[\w\s]{1,40}\s+here",
    r"(?:click|tap)\s+(?:here\s+)?to\s+(?:enter|add)\s+[\w\s]{1,40}",
    r"to\s+be\s+(?:completed|filled|determined|added)",
    r"\bt\.?b\.?d\.?\b",
    r"\bt\.?o\.?d\.?o\b",
    r"lorem\s+ipsum[\w\s,\.]*",
    r"\[\s*(?:insert|enter|provide|placeholder|your)\b[^\]]{1,80}\]",
    r"\(\s*(?:insert|enter|provide|describe|fill\s+in|replace)\b[^)]{1,80}\)",
    # Chinese variants
    r"请\s*(?:填写|输入|填入|补充|说明|填空|完善)[一-鿿\w，。、\s]{0,40}",
    r"待\s*(?:填写|补充|完成|确定)",
    r"此处\s*(?:填写|输入|填入|添加|填空)[一-鿿\w，。、\s]{0,30}",
    r"（\s*(?:请填写|此处|填写|输入|示例)[一-鿿\w，。、\s]{0,40}\s*）",
]
_RE_PHRASE_BANK = re.compile(
    "|".join(f"(?:{p})" for p in _PLACEHOLDER_PHRASES),
    re.IGNORECASE,
)

# Phrase bank for instructional / meta text that should be removed before publishing.
_REMOVAL_PHRASES = [
    r"delete\s+(?:this|the\s+following|before|prior\s+to)\b[^.\n]{0,80}",
    r"remove\s+(?:this|the\s+following|before|prior\s+to|in\s+final)\b[^.\n]{0,80}",
    r"note\s+to\s+(?:author|reviewer|editor|self|reader)\b[^.\n]{0,200}",
    r"\b(?:template\s+)?instructions?\s*[:：]",
    r"this\s+section\s+is\s+(?:for|only|optional|a\s+placeholder|an\s+example)\b[^.\n]{0,200}",
    r"for\s+(?:internal|template)\s+use\s+only\b[^.\n]{0,80}",
    r"example\s+only[\s\-—:：]",
    r"sample\s+(?:text|content|paragraph)\b[^.\n]{0,80}",
    r"e\.g\.[\s\-—:：]",
    r"^\s*example\s*[:：]",
    # Chinese variants
    r"请\s*删除\s*(?:本段|此段|此句|本节|这段|本部分)?",
    r"模板\s*(?:说明|示例|提示|备注)",
    r"仅供参考",
    r"以下\s*(?:内容|部分)?\s*为?\s*示例",
    r"使用\s*前\s*请\s*删除",
    r"作者\s*备注\s*[:：]",
]
_RE_REMOVAL_BANK = re.compile(
    "|".join(f"(?:{p})" for p in _REMOVAL_PHRASES),
    re.IGNORECASE,
)

# Word's built-in heading style names; covers both English and Chinese variants.
_HEADING_STYLE_RE = re.compile(r"^(?:Heading\s*\d+|Title|Subtitle|标题|副标题)", re.IGNORECASE)

# Headings that *introduce* a following list/table — body text should NOT go
# directly after them; the structured content (rows / list items) is the right
# fill target. e.g. "一、甲方委托乙方提供以下维修服务：" → the table below.
_LIST_INTRO_RE = re.compile(
    r"(?:以下|如下|下表|下列|下面|"
    r"following|below|as\s+follows)",
    re.IGNORECASE,
)

# ── Scaffold patterns inside a highlighted span ──────────────────────────────
# When a highlighted span looks like "<variable><scaffold>" (e.g. "15个工作日",
# "¥850", "50%", "2025年5月14日"), we split it so the user's bare reply (just
# the number) still produces a correctly-scaffolded output ("20个工作日").
#
# Each entry: (compiled regex with named groups 'pre','var','suf', kind_label)
_SCAFFOLD_PATTERNS = [
    # Currency prefix + number  (¥850, $1,200, €99.50)
    (re.compile(r"^(?P<pre>[¥￥$€£])\s*(?P<var>[\d,]+(?:\.\d+)?)(?P<suf>)$"), "currency"),
    # Number + Chinese unit  (15个工作日, 30天, 5次, 100元)
    (re.compile(r"^(?P<pre>)(?P<var>\d+(?:\.\d+)?)\s*(?P<suf>[一-鿿]{1,8})$"), "number_zh_unit"),
    # Number + ASCII unit / percent  (50%, 10kg, 3 days, 12 hrs)
    (re.compile(
        r"^(?P<pre>)(?P<var>\d+(?:\.\d+)?)\s*"
        r"(?P<suf>%|kg|km|m|cm|mm|g|lbs?|days?|weeks?|months?|years?|hours?|hrs?|mins?|sec(?:ond)?s?)$",
        re.IGNORECASE), "number_unit"),
    # Date — YYYY年MM月DD日 — only the year/month/day numbers are variable;
    # we surface the whole thing as one scaffold (full string is the variable,
    # no auto-attach). Marked so the agent knows.
    (re.compile(r"^(?P<pre>)(?P<var>\d{4}年\d{1,2}月\d{1,2}日)(?P<suf>)$"), "date_zh"),
    (re.compile(r"^(?P<pre>)(?P<var>\d{4}-\d{1,2}-\d{1,2})(?P<suf>)$"), "date_iso"),
    (re.compile(r"^(?P<pre>)(?P<var>\d{4}/\d{1,2}/\d{1,2})(?P<suf>)$"), "date_slash"),
]

# A "bare variable" reply from the user (just digits, optionally with separators,
# decimals, or a single currency-style sign). If user-provided value matches
# this AND the original had non-empty scaffolding, we auto-attach the scaffold.
_BARE_NUMERIC_RE = re.compile(r"^[+-]?[\d,]+(?:\.\d+)?$")


def _split_scaffold(text: str) -> Optional[Dict[str, str]]:
    """If `text` matches one of the scaffold patterns, return
    {'kind': ..., 'pre': ..., 'var': ..., 'suf': ...}. Else None.
    """
    if not text:
        return None
    t = text.strip()
    if not t:
        return None
    for pat, kind in _SCAFFOLD_PATTERNS:
        m = pat.match(t)
        if m:
            return {
                "kind": kind,
                "pre": m.group("pre") or "",
                "var": m.group("var") or "",
                "suf": m.group("suf") or "",
            }
    return None


def _reconstruct_with_scaffold(scaffold: Dict[str, str], user_value: str) -> str:
    """Given a scaffold split (pre/var/suf) and a user-provided value, decide
    whether to reattach the scaffolding.

    Rule: if the original variable was numeric/currency-like AND the user value
    is a bare number (no letters, no Chinese, no existing prefix/suffix), wrap
    it: pre + user_value + suf. Otherwise pass user_value through unchanged
    (the user gave us a full replacement on purpose).
    """
    pre, suf = scaffold.get("pre", ""), scaffold.get("suf", "")
    if not (pre or suf):
        return user_value
    val = user_value.strip()
    if not val:
        return user_value
    # If the user's reply already contains the scaffold parts, don't double-wrap
    if pre and val.startswith(pre):
        return user_value
    if suf and val.endswith(suf):
        return user_value
    # Only auto-wrap when the user gave a pure-number reply (the most common
    # source of the "lost units" bug). For dates (no pre/suf) this no-ops.
    if _BARE_NUMERIC_RE.match(val):
        return f"{pre}{val}{suf}"
    return user_value


class DocxTemplateSkill:
    """Fill a DOCX template to generate a new DOCX."""

    def __init__(self, workspace_dir: Optional[str] = None) -> None:
        if workspace_dir is None:
            workspace_dir = str(Path(__file__).resolve().parent.parent / "workspace")
        self.workspace_dir = Path(workspace_dir)
        self.workspace_dir.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------ #
    # Inspection                                                          #
    # ------------------------------------------------------------------ #

    def inspect_template(self, template_path: str) -> Dict[str, Any]:
        path = Path(template_path)
        if not path.exists():
            return {
                "success": False,
                "error": "File not found",
                "message": f"Template not found: {template_path}",
            }
        if path.suffix.lower() != ".docx":
            return {
                "success": False,
                "error": "Unsupported file type",
                "message": f"Template must be a .docx file (got {path.suffix})",
            }

        try:
            xml_blobs = _read_docx_text_xml(path)
        except Exception as exc:
            return {
                "success": False,
                "error": str(exc),
                "message": f"Could not read template XML: {exc}",
            }

        merged_xml = "\n".join(xml_blobs)
        jinja_vars = _scan_jinja_vars(merged_xml)
        has_loops = any(tok in merged_xml for tok in _JINJA_LOOP_TOKENS)
        has_conditionals = any(tok in merged_xml for tok in _JINJA_IF_TOKENS)

        try:
            from docx import Document
        except ImportError as exc:
            return {
                "success": False,
                "error": "python-docx not installed",
                "message": f"python-docx required for template inspection: {exc}",
            }

        try:
            doc = Document(str(path))
        except Exception as exc:
            return {
                "success": False,
                "error": str(exc),
                "message": f"Could not open template: {exc}",
            }

        paragraph_texts = ["".join((r.text or "") for r in p.runs)
                           for p in _iter_all_paragraphs(doc)]
        bracket_tokens = _scan_bracket_tokens(paragraph_texts)
        slots_full = _scan_slots(doc)
        slots_public = [_slot_public_view(s) for s in slots_full]
        removals_full = _scan_removals(doc)
        removals_public = [_slot_public_view(r) for r in removals_full]

        mode_detected = _detect_mode(jinja_vars, bracket_tokens, has_loops, has_conditionals)

        warnings: List[str] = []
        if mode_detected == "both":
            warnings.append(
                "Template contains both Jinja ({{ }}) and bracket ([TOKEN]) placeholders; "
                "auto mode will render Jinja first, then bracket-pass."
            )
        if mode_detected == "none" and not slots_public:
            warnings.append(
                "No placeholders or fillable slots detected. Ask the user to point out "
                "where values should go, or to mark fields with [TOKEN] / {{ var }} / underscores."
            )
        elif mode_detected == "none" and slots_public:
            warnings.append(
                f"No explicit placeholders found, but {len(slots_public)} heuristic slot(s) "
                "were detected. Confirm each with the user before filling."
            )
        if removals_public:
            warnings.append(
                f"{len(removals_public)} instructional/meta-text passage(s) detected as "
                "removal candidates. Read each to the user and confirm before deleting; "
                "pass the confirmed ids via fill_docx_template_tool's removal_ids."
            )

        return {
            "success": True,
            "template_path": str(path),
            "mode_detected": mode_detected,
            "jinja_variables": sorted(jinja_vars),
            "bracket_tokens": sorted(bracket_tokens),
            "has_loops": has_loops,
            "has_conditionals": has_conditionals,
            "slots": slots_public,
            "removals": removals_public,
            "warnings": warnings,
            "message": (
                f"mode={mode_detected}, "
                f"{len(jinja_vars)} jinja var(s), "
                f"{len(bracket_tokens)} bracket token(s), "
                f"{len(slots_public)} heuristic slot(s), "
                f"{len(removals_public)} removal candidate(s)"
            ),
        }

    # ------------------------------------------------------------------ #
    # Fill                                                                #
    # ------------------------------------------------------------------ #

    def fill_template(
        self,
        template_path: str,
        output_path: str,
        context: Optional[Dict[str, Any]] = None,
        mode: str = "auto",
        slot_values: Optional[Dict[str, Any]] = None,
        removal_ids: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        path = Path(template_path)
        if not path.exists():
            return {
                "success": False,
                "error": "File not found",
                "message": f"Template not found: {template_path}",
            }
        context = context or {}
        slot_values = slot_values or {}
        removal_ids = list(removal_ids) if removal_ids else []
        if not isinstance(context, dict):
            return {
                "success": False,
                "error": "Invalid context",
                "message": "context must be a dict",
            }
        if not isinstance(slot_values, dict):
            return {
                "success": False,
                "error": "Invalid slot_values",
                "message": "slot_values must be a dict of {slot_id: value}",
            }

        out_path = Path(output_path)
        out_path.parent.mkdir(parents=True, exist_ok=True)

        if mode not in ("auto", "jinja", "bracket"):
            return {
                "success": False,
                "error": "Invalid mode",
                "message": f"mode must be one of 'auto', 'jinja', 'bracket' (got {mode!r})",
            }

        inspect = self.inspect_template(str(path))
        if not inspect.get("success"):
            return inspect
        detected = inspect["mode_detected"]
        warnings: List[str] = list(inspect.get("warnings", []))
        # Selected removals: keep the original inspect ids so we can replay them
        # on a fresh scan of the output document after fill passes complete.
        selected_removal_keys: List[Tuple[str, str, str]] = []
        if removal_ids:
            by_id = {r["id"]: r for r in inspect.get("removals", [])}
            unknown = [rid for rid in removal_ids if rid not in by_id]
            if unknown:
                warnings.append(
                    f"Unknown removal id(s): {unknown}; they will be ignored."
                )
            for rid in removal_ids:
                r = by_id.get(rid)
                if r:
                    selected_removal_keys.append(
                        (r["kind"], r["reason"], r["text"])
                    )

        nothing_to_fill = (
            detected == "none"
            and not slot_values
            and not selected_removal_keys
            and mode == "auto"
        )
        if nothing_to_fill:
            return {
                "success": False,
                "template_path": str(path),
                "output_path": str(out_path),
                "mode_used": None,
                "warnings": warnings,
                "message": (
                    "No placeholders detected and no slot_values/removal_ids provided; "
                    "nothing to fill. Either add {{ name }} / [NAME] / underscore placeholders, "
                    "or call inspect_template and pass slot_values / removal_ids."
                ),
            }

        effective_mode = mode
        if effective_mode == "auto":
            if detected in ("jinja", "both"):
                effective_mode = "jinja"
            elif detected == "bracket":
                effective_mode = "bracket"
            else:
                effective_mode = "bracket"  # slot-only path uses bracket loader

        slot_report: Dict[str, Any] = {}

        if effective_mode == "jinja":
            jinja_result = self._fill_jinja(path, out_path, context)
            if not jinja_result.get("success"):
                return {**jinja_result, "warnings": warnings}
            if mode == "auto" and detected == "both":
                bracket_pass = self._fill_brackets(out_path, out_path, context, slot_values=None)
                if bracket_pass.get("success"):
                    bracket_filled = set(bracket_pass.get("filled_keys", []))
                    jinja_result["filled_keys"] = sorted(
                        set(jinja_result.get("filled_keys", [])) | bracket_filled
                    )
                    jinja_result["missing_keys"] = sorted(
                        set(jinja_result.get("missing_keys", []))
                        | set(bracket_pass.get("missing_keys", []))
                    )
                    jinja_result["unused_keys"] = sorted(
                        set(jinja_result.get("unused_keys", [])) - bracket_filled
                    )
                    jinja_result["mode_used"] = "both"
                else:
                    warnings.append(
                        f"Jinja render succeeded but bracket-pass failed: "
                        f"{bracket_pass.get('error', 'unknown error')}"
                    )
            if slot_values:
                slot_pass = self._fill_slots_in_place(out_path, slot_values)
                slot_report = slot_pass
                if not slot_pass.get("success"):
                    warnings.append(
                        f"Slot fill failed: {slot_pass.get('error', 'unknown error')}"
                    )
            if selected_removal_keys:
                removal_pass = _apply_removals_in_place(
                    out_path, selected_removal_keys, removal_ids
                )
                jinja_result["removals_applied"] = removal_pass.get("applied", [])
                jinja_result["removals_skipped"] = removal_pass.get("skipped", [])
            jinja_result["warnings"] = warnings
            if slot_report:
                jinja_result["slot_fill"] = slot_report
            return jinja_result

        # bracket / slot-only path: a single python-docx load handles both
        bracket_result = self._fill_brackets(path, out_path, context, slot_values=slot_values)
        if bracket_result.get("success") and selected_removal_keys:
            removal_pass = _apply_removals_in_place(
                out_path, selected_removal_keys, removal_ids
            )
            bracket_result["removals_applied"] = removal_pass.get("applied", [])
            bracket_result["removals_skipped"] = removal_pass.get("skipped", [])
        bracket_result["warnings"] = warnings
        return bracket_result

    # ------------------------------------------------------------------ #
    # Jinja path (docxtpl)                                                #
    # ------------------------------------------------------------------ #

    def _fill_jinja(self, template_path: Path, output_path: Path, context: Dict[str, Any]) -> Dict[str, Any]:
        try:
            from docxtpl import DocxTemplate
        except ImportError as exc:
            return {
                "success": False,
                "error": "docxtpl not installed",
                "message": (
                    "Jinja-mode template filling requires docxtpl. "
                    "Install with: pip install docxtpl"
                ),
                "import_error": str(exc),
            }

        try:
            tpl = DocxTemplate(str(template_path))
        except Exception as exc:
            return {
                "success": False,
                "error": str(exc),
                "message": f"Could not open template: {exc}",
            }

        try:
            declared: Set[str] = set(tpl.get_undeclared_template_variables())
        except Exception:
            declared = set()

        try:
            tpl.render(context)
            tpl.save(str(output_path))
        except Exception as exc:
            return {
                "success": False,
                "error": str(exc),
                "message": f"Jinja render failed: {exc}",
                "template_path": str(template_path),
                "output_path": str(output_path),
                "mode_used": "jinja",
            }

        provided = set(context.keys())
        filled = sorted(declared & provided)
        missing = sorted(declared - provided)
        unused = sorted(provided - declared)  # nested keys not introspected
        return {
            "success": True,
            "template_path": str(template_path),
            "output_path": str(output_path),
            "mode_used": "jinja",
            "filled_keys": filled,
            "missing_keys": missing,
            "unused_keys": unused,
            "message": f"Filled {len(filled)}/{max(len(declared), 1)} declared jinja variable(s).",
        }

    # ------------------------------------------------------------------ #
    # Bracket path (python-docx) + optional slot fill in same load        #
    # ------------------------------------------------------------------ #

    def _fill_brackets(
        self,
        template_path: Path,
        output_path: Path,
        context: Dict[str, Any],
        slot_values: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        try:
            from docx import Document
        except ImportError as exc:
            return {
                "success": False,
                "error": "python-docx not installed",
                "message": f"python-docx required for bracket-mode templates: {exc}",
            }

        try:
            doc = Document(str(template_path))
        except Exception as exc:
            return {
                "success": False,
                "error": str(exc),
                "message": f"Could not open template: {exc}",
            }

        mapping: Dict[str, str] = {str(k).upper(): "" if v is None else str(v) for k, v in context.items()}
        filled_keys: Set[str] = set()
        discovered: Set[str] = set()
        total_subs = 0

        # Bracket pass first (scans full paragraphs including tables and headers/footers)
        for paragraph in _iter_all_paragraphs(doc):
            full = "".join((r.text or "") for r in paragraph.runs)
            if "[" in full:
                for m in _BRACKET_RE.finditer(full):
                    discovered.add(m.group(1))
                total_subs += _replace_brackets_in_paragraph(paragraph, mapping, filled_keys)

        # Slot pass on the same doc, if any
        slot_outcome: Dict[str, Any] = {}
        if slot_values:
            slots = _scan_slots(doc)
            slot_outcome = _apply_slot_values(slots, slot_values)

        try:
            doc.save(str(output_path))
        except Exception as exc:
            return {
                "success": False,
                "error": str(exc),
                "message": f"Could not save filled document: {exc}",
            }

        provided_keys = {str(k).upper() for k in context.keys()}
        missing = sorted(discovered - provided_keys)
        unused = sorted(provided_keys - discovered)
        mode_used = "bracket"
        if slot_values and discovered:
            mode_used = "bracket+slots"
        elif slot_values:
            mode_used = "slots"

        result: Dict[str, Any] = {
            "success": True,
            "template_path": str(template_path),
            "output_path": str(output_path),
            "mode_used": mode_used,
            "filled_keys": sorted(filled_keys),
            "missing_keys": missing,
            "unused_keys": unused,
            "substitutions": total_subs,
            "message": (
                f"Performed {total_subs} bracket substitution(s); "
                f"{len(missing)} bracket placeholder(s) left unfilled."
            ),
        }
        if slot_outcome:
            result["slot_fill"] = slot_outcome
            result["message"] += (
                f" Filled {len(slot_outcome.get('filled_slot_ids', []))}/"
                f"{len(slot_values)} slot(s)."
            )
        return result

    def _fill_slots_in_place(self, docx_path: Path, slot_values: Dict[str, Any]) -> Dict[str, Any]:
        """Apply slot_values to a docx already on disk (used after Jinja pass)."""
        try:
            from docx import Document
        except ImportError as exc:
            return {"success": False, "error": "python-docx not installed", "message": str(exc)}
        try:
            doc = Document(str(docx_path))
        except Exception as exc:
            return {"success": False, "error": str(exc), "message": f"Could not open {docx_path}: {exc}"}
        slots = _scan_slots(doc)
        outcome = _apply_slot_values(slots, slot_values)
        try:
            doc.save(str(docx_path))
        except Exception as exc:
            return {"success": False, "error": str(exc), "message": f"Could not save: {exc}"}
        outcome["success"] = True
        return outcome


# ---------------------------------------------------------------------- #
# Helpers — XML / mode detection                                          #
# ---------------------------------------------------------------------- #

def _read_docx_text_xml(docx_path: Path) -> List[str]:
    """Return text-bearing XML parts (document, headers, footers) as strings."""
    blobs: List[str] = []
    with zipfile.ZipFile(str(docx_path)) as zf:
        for name in zf.namelist():
            if not name.startswith("word/"):
                continue
            if name == "word/document.xml" or name.startswith(("word/header", "word/footer")):
                if name.endswith(".xml"):
                    blobs.append(zf.read(name).decode("utf-8", errors="replace"))
    return blobs


def _scan_jinja_vars(xml_text: str) -> Set[str]:
    """Top-level Jinja variable names appearing in {{ ... }}."""
    return {m.group(1) for m in _JINJA_VAR_RE.finditer(xml_text)}


def _scan_bracket_tokens(paragraph_texts: Iterable[str]) -> Set[str]:
    tokens: Set[str] = set()
    for t in paragraph_texts:
        if "[" not in t:
            continue
        for m in _BRACKET_RE.finditer(t):
            tokens.add(m.group(1))
    return tokens


def _detect_mode(
    jinja_vars: Set[str],
    bracket_tokens: Set[str],
    has_loops: bool,
    has_conditionals: bool,
) -> str:
    has_jinja = bool(jinja_vars) or has_loops or has_conditionals
    has_bracket = bool(bracket_tokens)
    if has_jinja and has_bracket:
        return "both"
    if has_jinja:
        return "jinja"
    if has_bracket:
        return "bracket"
    return "none"


# ---------------------------------------------------------------------- #
# Helpers — document walking                                              #
# ---------------------------------------------------------------------- #

def _iter_all_paragraphs(doc):
    """Yield every paragraph reachable in a python-docx Document."""
    for p in doc.paragraphs:
        yield p
    for tbl in doc.tables:
        yield from _walk_table_paragraphs(tbl)
    for section in doc.sections:
        for hf in (
            section.header,
            getattr(section, "first_page_header", None),
            getattr(section, "even_page_header", None),
            section.footer,
            getattr(section, "first_page_footer", None),
            getattr(section, "even_page_footer", None),
        ):
            if hf is None:
                continue
            for p in hf.paragraphs:
                yield p
            for tbl in hf.tables:
                yield from _walk_table_paragraphs(tbl)


def _walk_table_paragraphs(tbl):
    for row in tbl.rows:
        for cell in row.cells:
            for p in cell.paragraphs:
                yield p
            for nested in cell.tables:
                yield from _walk_table_paragraphs(nested)


# ---------------------------------------------------------------------- #
# Helpers — format-preserving run edits                                   #
# ---------------------------------------------------------------------- #

def _replace_paragraph_span(paragraph, start: int, end: int, replacement: str) -> bool:
    """Replace the character span [start, end) in a paragraph's run text.

    Only runs that overlap the span are modified — runs entirely outside the
    span keep their text (and therefore their per-run formatting) untouched.
    The first run in the span absorbs the replacement text and inherits its
    own formatting; runs strictly inside the span get blanked.
    """
    runs = paragraph.runs
    if not runs:
        return False
    texts = [r.text or "" for r in runs]
    offsets = [0]
    for t in texts:
        offsets.append(offsets[-1] + len(t))
    total = offsets[-1]
    if start < 0 or end > total or start >= end:
        return False

    def pos_to_run(p: int) -> Tuple[int, int]:
        for i in range(len(texts)):
            if offsets[i] <= p < offsets[i + 1]:
                return i, p - offsets[i]
        return len(texts) - 1, len(texts[-1])

    r_start, o_start = pos_to_run(start)
    if end == total:
        r_end = len(texts) - 1
        o_end = len(texts[r_end])
    else:
        r_end, o_end = pos_to_run(end)

    if r_start == r_end:
        texts[r_start] = texts[r_start][:o_start] + replacement + texts[r_end][o_end:]
    else:
        texts[r_start] = texts[r_start][:o_start] + replacement
        for i in range(r_start + 1, r_end):
            texts[i] = ""
        texts[r_end] = texts[r_end][o_end:]

    for i, r in enumerate(runs):
        if r.text != texts[i]:
            r.text = texts[i]
    return True


def _replace_brackets_in_paragraph(paragraph, mapping: Dict[str, str], filled_keys: Set[str]) -> int:
    """Substitute [TOKEN] occurrences in a paragraph, preserving run formatting.

    Applies matches in reverse order so earlier-match offsets stay valid even
    when replacement lengths differ from match lengths.
    """
    if not paragraph.runs:
        return 0
    full = "".join((r.text or "") for r in paragraph.runs)
    if "[" not in full:
        return 0
    matches = list(_BRACKET_RE.finditer(full))
    fillable = [(m.start(), m.end(), m.group(1)) for m in matches if m.group(1) in mapping]
    if not fillable:
        return 0
    count = 0
    for start, end, token in reversed(fillable):
        if _replace_paragraph_span(paragraph, start, end, mapping[token]):
            count += 1
            filled_keys.add(token)
    return count


# ---------------------------------------------------------------------- #
# Helpers — slot detection                                                #
# ---------------------------------------------------------------------- #

def _slot_public_view(slot: Dict[str, Any]) -> Dict[str, Any]:
    """Strip internal _meta references before returning to the caller.

    Surfaces a couple of meta fields that are useful to the agent: the full
    original highlighted text, a scaffold-split summary when applicable, and
    an `is_signature` flag for slots that should be left blank.
    """
    public = {k: v for k, v in slot.items() if not k.startswith("_")}
    meta = slot.get("_meta", {})
    if meta.get("span_text"):
        public["span_text"] = meta["span_text"]
    scaffold = meta.get("scaffold")
    if scaffold:
        public["scaffold"] = {
            "kind": scaffold.get("kind"),
            "prefix": scaffold.get("pre", ""),
            "variable": scaffold.get("var", ""),
            "suffix": scaffold.get("suf", ""),
        }
    if meta.get("is_signature"):
        public["is_signature"] = True
        public["fill_policy"] = "leave_blank"
    return public


def _scan_slots(doc) -> List[Dict[str, Any]]:
    """Walk a python-docx Document and produce slot candidates with live refs.

    Slot kinds:
      - "underscores"  : a run of 3+ underscores; replaces in place
      - "label_blank"  : paragraph ending in "Label:"; value appended after
      - "empty_cell"   : table cell with no text, where row/column has a label
    """
    slots: List[Dict[str, Any]] = []
    counter = [0]

    def add(kind: str, label: Optional[str], context: str, meta: Dict[str, Any]) -> None:
        slot_id = f"slot_{counter[0]}"
        counter[0] += 1
        slots.append({
            "id": slot_id,
            "kind": kind,
            "label": label,
            "context": context,
            "_meta": meta,
        })

    # Body paragraphs (with neighbor lookahead for section_body_empty)
    body_paras = list(doc.paragraphs)
    seen_para_ids: Set[int] = set()
    for i, p in enumerate(body_paras):
        before = len(slots)
        _scan_paragraph_for_slots(p, add)
        if len(slots) > before:
            seen_para_ids.add(id(p))
    # section_body_empty: heading followed by empty body paragraph
    for i, p in enumerate(body_paras[:-1]):
        if not _is_heading(p):
            continue
        nxt = body_paras[i + 1]
        if id(nxt) in seen_para_ids:
            continue
        if not _paragraph_is_empty(nxt):
            continue
        heading_text = "".join((r.text or "") for r in p.runs).strip()
        if not heading_text:
            continue
        # Suppress: heading is a list/table introduction (以下/如下/following...).
        # The real fill target is the table or list below, not this empty
        # paragraph — emitting a slot here would dump body text where the
        # user wants a new row in the table that follows.
        if _LIST_INTRO_RE.search(heading_text):
            continue
        # Suppress: a table immediately follows (with at most one empty
        # paragraph between). Same reasoning — the table is the right target.
        if _table_follows_paragraph(p, nxt):
            continue
        add("section_body_empty", heading_text, f"(empty body under heading '{heading_text}')", {
            "paragraph": nxt,
            "start": 0,
            "end": 0,
        })
        seen_para_ids.add(id(nxt))
    # Border-line slots: a paragraph with a horizontal border (bottom border)
    # renders as a fillable "underline" line even though it has no underscore
    # characters. Two layouts to support:
    #   (a) Label paragraph immediately followed by an empty bordered paragraph
    #       ("Patient Name:" / [empty + bottom-border]). The label paragraph
    #       was already emitted as label_blank; we redirect its fill into the
    #       bordered paragraph below so the value sits over the line instead
    #       of being appended after the colon.
    #   (b) A standalone empty bordered paragraph with no leading label — emit
    #       a stray slot so the agent can confirm intent.
    # Border on the label paragraph itself ("Patient Name:    " all in one
    # bordered paragraph) is handled in (c): mark the label_blank slot so its
    # fill is centered into the same paragraph rather than appended after.
    slots_by_paragraph_id: Dict[int, Dict[str, Any]] = {}
    for s in slots:
        meta = s.get("_meta", {})
        para = meta.get("paragraph")
        if para is not None and s["kind"] == "label_blank":
            slots_by_paragraph_id[id(para)] = s
    for i, p in enumerate(body_paras):
        if not _paragraph_has_horizontal_border(p):
            continue
        if _paragraph_is_empty(p):
            # (a) link to a preceding label_blank slot if its paragraph is the
            # previous one in body order
            linked = False
            if i > 0:
                prev = body_paras[i - 1]
                prev_slot = slots_by_paragraph_id.get(id(prev))
                if prev_slot is not None:
                    prev_slot["_meta"]["border_target"] = p
                    seen_para_ids.add(id(p))
                    linked = True
            if linked or id(p) in seen_para_ids:
                continue
            # (b) standalone empty bordered paragraph — emit a stray slot.
            # Use the previous non-empty paragraph (if any) as a label hint.
            label_hint: Optional[str] = None
            for j in range(i - 1, -1, -1):
                t = "".join((r.text or "") for r in body_paras[j].runs).strip()
                if t:
                    label_hint = t[:60]
                    break
            add("underscores", label_hint, "(bordered empty line)", {
                "paragraph": p,
                "start": 0,
                "end": 0,
                "is_signature": _looks_like_signature(label_hint, label_hint or "", 0, 0),
                "border_only": True,
            })
            seen_para_ids.add(id(p))
        else:
            # (c) bordered paragraph that already has its own content. If we
            # emitted a label_blank slot for it, mark the slot so the fill is
            # centered in the same paragraph instead of bumping right after
            # the label.
            existing = slots_by_paragraph_id.get(id(p))
            if existing is not None:
                existing["_meta"]["bordered_paragraph"] = True
    # Body tables
    for tbl in doc.tables:
        _scan_table_for_slots(tbl, add)
    # Headers / footers
    for section in doc.sections:
        for hf in (
            section.header,
            getattr(section, "first_page_header", None),
            getattr(section, "even_page_header", None),
            section.footer,
            getattr(section, "first_page_footer", None),
            getattr(section, "even_page_footer", None),
        ):
            if hf is None:
                continue
            for p in hf.paragraphs:
                _scan_paragraph_for_slots(p, add)
            for tbl in hf.tables:
                _scan_table_for_slots(tbl, add)
    return slots


def _scan_paragraph_for_slots(paragraph, add: Callable[..., None]) -> None:
    text = "".join((r.text or "") for r in paragraph.runs)
    if not text:
        return
    # 0) Highlighted run spans — strongest authoring signal: "modify me".
    #    Consecutive highlighted runs merge into one slot. Highlight will be
    #    cleared on fill so the final document looks clean. If the span looks
    #    like "<variable><scaffold>" (15个工作日, ¥850, 50%, etc.), we record
    #    the scaffold split so a bare-number user reply still produces a
    #    correctly-scaffolded output.
    highlighted_spans = _find_highlighted_spans(paragraph)
    if highlighted_spans:
        for start, end, runs, span_text in highlighted_spans:
            label = _guess_label_before(text, start) or (span_text.strip() or None)
            ctx = _snippet(text, start, end)
            scaffold = _split_scaffold(span_text)
            add("highlighted", label, ctx, {
                "paragraph": paragraph,
                "start": start,
                "end": end,
                "runs": runs,
                "scaffold": scaffold,        # None if span isn't a known pattern
                "span_text": span_text,      # full original highlighted text
            })
        return
    # 0.5) Underlined whitespace spans — Word's "fill-in line" trick where the
    #      author selects a run of spaces and applies underline. There are no
    #      underscore characters in the document, but it looks like one to a
    #      human. Treat as an underscores-kind slot; centering pads with spaces
    #      (the inherited underline carries through so the line stays visible).
    uw_spans = _find_underlined_whitespace_spans(paragraph)
    if uw_spans:
        for start, end, runs, span_text in uw_spans:
            label = _guess_label_before(text, start)
            ctx = _snippet(text, start, end, radius=40)
            is_sig = _looks_like_signature(label, text, start, end)
            add("underscores", label, ctx, {
                "paragraph": paragraph,
                "start": start,
                "end": end,
                "is_signature": is_sig,
                "pad_char": " ",
                "source": "underlined_whitespace",
            })
        return
    # 1) underscore runs (may have multiple per paragraph)
    underscore_matches = list(_UNDERSCORE_RUN_RE.finditer(text))
    if underscore_matches:
        # Skip a paragraph that's *only* a long decorative underscore line
        # (e.g. a page divider) with no surrounding label or signature context.
        if _is_decorative_underscore_paragraph(text, underscore_matches):
            return
        # Composite check: when several underscore runs are separated only by
        # whitespace / decorators (the digit-cell pattern, e.g. "¥ ____ ____
        # ____" used for one logical amount field), merge them into a single
        # slot so the agent fills it ONCE — preventing the "85008500…" bug
        # where the same value lands in every position.
        if len(underscore_matches) >= 2 and _gaps_are_decorative(text, underscore_matches):
            positions = [(m.start(), m.end()) for m in underscore_matches]
            span_start = positions[0][0]
            span_end = positions[-1][1]
            label = _guess_label_before(text, span_start)
            ctx = _snippet(text, span_start, span_end, radius=60)
            is_sig = _looks_like_signature(label, text, span_start, span_end)
            add("underscores", label, ctx, {
                "paragraph": paragraph,
                "start": span_start,
                "end": span_end,
                "positions": positions,   # multi-position composite
                "composite": True,
                "is_signature": is_sig,
            })
        else:
            for m in underscore_matches:
                label = _guess_label_before(text, m.start())
                context = _snippet(text, m.start(), m.end())
                is_sig = _looks_like_signature(label, text, m.start(), m.end())
                add("underscores", label, context, {
                    "paragraph": paragraph,
                    "start": m.start(),
                    "end": m.end(),
                    "is_signature": is_sig,
                })
        return  # don't double-count this paragraph as label_blank
    # 2) angle-bracketed tokens like <your name> or 《姓名》
    angle_matches = list(_ANGLE_BRACKET_RE.finditer(text))
    if angle_matches:
        for m in angle_matches:
            inner = (m.group(1) or m.group(2) or "").strip()
            if not inner:
                continue
            ctx = _snippet(text, m.start(), m.end())
            add("angle_bracketed", inner, ctx, {
                "paragraph": paragraph,
                "start": m.start(),
                "end": m.end(),
            })
        return
    # 3) "Label:" at end of paragraph with no value after
    m = _LABEL_ONLY_RE.match(text)
    if m:
        # Skip when this paragraph is introducing a list/table — the content
        # belongs in the table or list that follows, not appended after the
        # heading's trailing colon.
        if _LIST_INTRO_RE.search(text):
            return
        label = m.group(1).strip()
        is_sig = _looks_like_signature(label, text, 0, len(text))
        add("label_blank", label, text, {"paragraph": paragraph, "is_signature": is_sig})
        return
    # 4) hint-text run (italic / grey) matching a placeholder-like phrase
    hint = _find_hint_run(paragraph)
    if hint is not None:
        run, run_start, run_end, snippet_text = hint
        label = _guess_label_before(text, run_start) or snippet_text.strip()
        ctx = _snippet(text, run_start, run_end)
        add("hint_text", label, ctx, {
            "paragraph": paragraph,
            "start": run_start,
            "end": run_end,
        })
        return
    # 5) whole-paragraph placeholder phrase (no italic required) — e.g.
    #    "Replace this with your bio." or "请填写姓名".
    pm = _RE_PHRASE_BANK.search(text)
    if pm:
        # If the matched phrase covers most of the paragraph, treat as a slot
        # that replaces the whole paragraph; otherwise just replace the span.
        cover = (pm.end() - pm.start()) / max(len(text.strip()), 1)
        if cover >= 0.6:
            label = _guess_label_before(text, pm.start()) or pm.group(0).strip()
            add("placeholder_phrase", label, _snippet(text, pm.start(), pm.end()), {
                "paragraph": paragraph,
                "start": 0,
                "end": len(text),
            })
        else:
            label = _guess_label_before(text, pm.start()) or pm.group(0).strip()
            add("placeholder_phrase", label, _snippet(text, pm.start(), pm.end()), {
                "paragraph": paragraph,
                "start": pm.start(),
                "end": pm.end(),
            })


def _scan_table_for_slots(tbl, add: Callable[..., None]) -> None:
    # Best-guess column headers from row 0 (text-only)
    header_labels: List[str] = []
    if tbl.rows:
        for cell in tbl.rows[0].cells:
            header_labels.append(_cell_text(cell).strip())

    for ri, row in enumerate(tbl.rows):
        first_cell_text = _cell_text(row.cells[0]).strip() if row.cells else ""
        for ci, cell in enumerate(row.cells):
            # Nested tables first so order is stable
            for nested in cell.tables:
                _scan_table_for_slots(nested, add)
            for p in cell.paragraphs:
                _scan_paragraph_for_slots(p, add)
            # Empty cell heuristic: no text and no nested tables
            if not _cell_text(cell).strip() and not cell.tables:
                column_label = header_labels[ci] if ci < len(header_labels) else ""
                row_label = first_cell_text if ci > 0 else ""
                label = column_label or row_label
                if not label:
                    continue
                if ri == 0 and column_label == "":
                    # top-left empty cell with no label — skip
                    continue
                ctx_bits = []
                if row_label:
                    ctx_bits.append(f"row='{row_label}'")
                if column_label and ci != 0:
                    ctx_bits.append(f"col='{column_label}'")
                context = "[empty cell, " + ", ".join(ctx_bits) + "]" if ctx_bits else "[empty cell]"
                add("empty_cell", label, context, {"cell": cell})


def _cell_text(cell) -> str:
    return "\n".join((p.text or "") for p in cell.paragraphs)


def _guess_label_before(text: str, pos: int) -> Optional[str]:
    """Look at text[:pos] for a 'Label:' segment and return the label."""
    prefix = text[:pos]
    m = _LABEL_BEFORE_RE.search(prefix)
    if m:
        return m.group(1).strip()
    # Fallback: take last 30 chars before pos as context-only label hint
    tail = prefix.strip()
    if tail:
        snippet = tail[-30:]
        return snippet.lstrip("·•-—-– \t") or None
    return None


def _snippet(text: str, start: int, end: int, radius: int = 40) -> str:
    a = max(0, start - radius)
    b = min(len(text), end + radius)
    prefix = "…" if a > 0 else ""
    suffix = "…" if b < len(text) else ""
    return prefix + text[a:b] + suffix


# ---------------------------------------------------------------------- #
# Helpers — slot fill application                                         #
# ---------------------------------------------------------------------- #

def _apply_slot_values(slots: List[Dict[str, Any]], slot_values: Dict[str, Any]) -> Dict[str, Any]:
    """Apply a {slot_id: value} mapping to a freshly scanned slot list.

    Underscore-kind slots are grouped by paragraph and applied in reverse
    text-position order so character offsets remain valid across multiple
    fills in the same paragraph.
    """
    by_id = {s["id"]: s for s in slots}
    filled_ids: List[str] = []
    unknown_ids: List[str] = []
    skipped_signature_ids: List[str] = []

    # Group span-based fills per paragraph (underscores, angle_bracketed,
    # placeholder_phrase, hint_text, highlighted). Per-batch tuple carries the
    # kind + meta so the highlighted post-step can clear w:highlight without
    # touching other formatting.
    span_by_paragraph: Dict[int, List[Tuple[Any, int, int, str, str, str, Dict[str, Any]]]] = defaultdict(list)
    deferred: List[Tuple[str, Dict[str, Any], str, str]] = []  # (kind, meta, value, slot_id)

    for sid, value in slot_values.items():
        slot = by_id.get(sid)
        if not slot:
            unknown_ids.append(sid)
            continue
        meta = slot.get("_meta", {})
        kind = slot["kind"]
        # Signature / seal fields are left blank regardless of the value the
        # caller supplied — guard against accidental fills of 签字 / signature
        # lines (the human signs on paper after printing).
        if meta.get("is_signature"):
            skipped_signature_ids.append(sid)
            continue
        val_str = "" if value is None else str(value)
        if kind in ("underscores", "angle_bracketed", "placeholder_phrase",
                    "hint_text", "highlighted"):
            paragraph = meta["paragraph"]
            # For highlighted slots with a recognized scaffold (number+unit,
            # currency prefix, percentage, etc.), auto-attach the scaffold when
            # the user-provided value is a bare number — fixes the "15个工作日 →
            # 20" data-loss bug.
            effective_val = val_str
            if kind == "highlighted":
                scaffold = meta.get("scaffold")
                if scaffold:
                    effective_val = _reconstruct_with_scaffold(scaffold, val_str)
            # Composite underscore slot (digit-cell pattern): expand to one
            # span replacement per underscore position — first gets the value,
            # rest are blanked. Prevents the "8500" concatenated-into-every-
            # underscore bug.
            if kind == "underscores" and meta.get("composite"):
                positions = meta.get("positions", [])
                for i, (pstart, pend) in enumerate(positions):
                    fill_val = effective_val if i == 0 else ""
                    span_by_paragraph[id(paragraph)].append(
                        (paragraph, pstart, pend, fill_val, sid if i == 0 else None,
                         kind, meta)
                    )
            else:
                # Border-only slot: paragraph has a horizontal border but no
                # underscore characters. Write the value into the paragraph
                # itself, centered, so it sits above the border line.
                if kind == "underscores" and meta.get("border_only"):
                    deferred.append(("border_line", meta, effective_val, sid))
                    continue
                # For single-span underscore fills, center the value within
                # the original underscore width so the line stays balanced
                # (e.g. "____ Alice ____") instead of leaving the value
                # bumped against one side of the line. Numbered-list bodies
                # like '(1) ____________' get left-aligned fill instead, so
                # the value follows the marker rather than floating in the
                # middle of the line.
                fill_val = effective_val
                if kind == "underscores":
                    paragraph_text = "".join((r.text or "") for r in paragraph.runs)
                    span_text = paragraph_text[meta["start"]:meta["end"]]
                    prefix = paragraph_text[:meta["start"]]
                    align = "left" if _prefix_is_only_list_marker(prefix) else "center"
                    fill_val = _center_in_underscore_span(
                        effective_val, span_text, meta.get("pad_char"), align=align
                    )
                span_by_paragraph[id(paragraph)].append(
                    (paragraph, meta["start"], meta["end"], fill_val, sid, kind, meta)
                )
        elif kind == "label_blank":
            deferred.append(("label_blank", meta, val_str, sid))
        elif kind == "empty_cell":
            deferred.append(("empty_cell", meta, val_str, sid))
        elif kind == "section_body_empty":
            deferred.append(("section_body_empty", meta, val_str, sid))
        else:
            unknown_ids.append(sid)

    for batch in span_by_paragraph.values():
        batch.sort(key=lambda x: x[1], reverse=True)  # latest start first
        for paragraph, start, end, val_str, sid, kind, meta in batch:
            if _replace_paragraph_span(paragraph, start, end, val_str):
                if kind == "highlighted":
                    # Clear highlight on every run that originally carried it
                    # in this span. Other run-level formatting (font, size,
                    # bold/italic/color) stays untouched.
                    for run in meta.get("runs", []):
                        _clear_highlight(run)
                if sid is not None:
                    filled_ids.append(sid)

    for kind, meta, val_str, sid in deferred:
        if kind == "label_blank":
            # Linked-border case: the next paragraph is an empty bordered line.
            # Write the value into THAT paragraph (centered) so it sits over
            # the visible line instead of appearing after the label's colon.
            target = meta.get("border_target")
            if target is not None:
                if _write_to_empty_paragraph(target, val_str):
                    _set_paragraph_centered(target)
                    filled_ids.append(sid)
                continue
            # Inline-border case: the label paragraph itself has a bottom
            # border. Center the whole paragraph so the value sits in the
            # middle of the line below the label.
            if meta.get("bordered_paragraph"):
                if _append_after_label(meta["paragraph"], val_str):
                    _set_paragraph_centered(meta["paragraph"])
                    filled_ids.append(sid)
                continue
            if _append_after_label(meta["paragraph"], val_str):
                filled_ids.append(sid)
        elif kind == "empty_cell":
            if _write_to_empty_cell(meta["cell"], val_str):
                filled_ids.append(sid)
        elif kind == "section_body_empty":
            if _write_to_empty_paragraph(meta["paragraph"], val_str):
                filled_ids.append(sid)
        elif kind == "border_line":
            if _write_to_empty_paragraph(meta["paragraph"], val_str):
                _set_paragraph_centered(meta["paragraph"])
                filled_ids.append(sid)

    requested = set(slot_values.keys())
    signatures = set(skipped_signature_ids)
    skipped = sorted(
        (requested - set(filled_ids) - set(unknown_ids) - signatures) | signatures
    )
    return {
        "filled_slot_ids": sorted(filled_ids),
        "unknown_slot_ids": sorted(unknown_ids),
        "skipped_slot_ids": skipped,
        "skipped_signature_slot_ids": sorted(signatures),
    }


def _append_after_label(paragraph, value: str) -> bool:
    runs = paragraph.runs
    if not runs:
        paragraph.add_run(" " + value)
        return True
    # Append to the last non-empty run so we inherit its formatting
    for r in reversed(runs):
        if r.text:
            sep = "" if r.text.endswith((" ", "\t")) else " "
            r.text = r.text + sep + value
            return True
    runs[0].text = (runs[0].text or "") + " " + value
    return True


def _write_to_empty_cell(cell, value: str) -> bool:
    if cell.paragraphs:
        p = cell.paragraphs[0]
        if p.runs:
            p.runs[0].text = value
            for extra in p.runs[1:]:
                extra.text = ""
        else:
            p.add_run(value)
        return True
    cell.add_paragraph(value)
    return True


def _write_to_empty_paragraph(paragraph, value: str) -> bool:
    """Write text into a paragraph that's currently empty (section_body_empty)."""
    if paragraph.runs:
        paragraph.runs[0].text = value
        for extra in paragraph.runs[1:]:
            extra.text = ""
    else:
        paragraph.add_run(value)
    return True


# ---------------------------------------------------------------------- #
# Helpers — highlighted runs                                              #
# ---------------------------------------------------------------------- #

def _run_is_highlighted(run) -> bool:
    """True if the run carries a Word highlight (yellow, green, cyan, etc.).

    `font.highlight_color` is a WD_COLOR_INDEX enum; None means no highlight,
    AUTO means an explicit "no highlight" — both are treated as not-highlighted.
    """
    try:
        hl = run.font.highlight_color
    except Exception:
        return False
    if hl is None:
        return False
    try:
        from docx.enum.text import WD_COLOR_INDEX
        if hl == WD_COLOR_INDEX.AUTO:
            return False
    except Exception:
        pass
    return True


def _clear_highlight(run) -> None:
    """Remove the w:highlight attribute from a run, preserving all other
    formatting (font, size, color, bold/italic, etc.). Idempotent.
    """
    try:
        from docx.enum.text import WD_COLOR_INDEX
        run.font.highlight_color = WD_COLOR_INDEX.AUTO
    except Exception:
        # Fall back to direct XML edit if the high-level setter isn't happy
        try:
            rPr = run._element.find(
                "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}rPr"
            )
            if rPr is not None:
                hl = rPr.find(
                    "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}highlight"
                )
                if hl is not None:
                    rPr.remove(hl)
        except Exception:
            pass


def _find_highlighted_spans(
    paragraph,
) -> List[Tuple[int, int, List[Any], str]]:
    """Find contiguous spans of highlighted runs in a paragraph.

    Returns a list of (start_offset, end_offset, runs, text) tuples in
    paragraph-text coordinates. Consecutive highlighted runs are merged into
    one span — a logical "edit this" region is often split into 2-3 runs by
    Word for unrelated reasons (e.g. autocorrect boundaries).
    """
    spans: List[Tuple[int, int, List[Any], str]] = []
    offset = 0
    cur_start: Optional[int] = None
    cur_runs: List[Any] = []
    cur_text: List[str] = []
    for run in paragraph.runs:
        rt = run.text or ""
        if _run_is_highlighted(run) and rt:
            if cur_start is None:
                cur_start = offset
            cur_runs.append(run)
            cur_text.append(rt)
        else:
            if cur_start is not None:
                spans.append((cur_start, offset, cur_runs, "".join(cur_text)))
                cur_start = None
                cur_runs = []
                cur_text = []
        offset += len(rt)
    if cur_start is not None:
        spans.append((cur_start, offset, cur_runs, "".join(cur_text)))
    return spans


# ---------------------------------------------------------------------- #
# Helpers — hint-text / heading / empty detection                         #
# ---------------------------------------------------------------------- #

def _is_heading(paragraph) -> bool:
    try:
        name = paragraph.style.name if paragraph.style else ""
    except Exception:
        name = ""
    return bool(name and _HEADING_STYLE_RE.match(name))


_GAP_DECORATIVE_RE = re.compile(r"^[\s 　.\-—–·•・|/\\,;:：（）()\[\]]*$")


def _gaps_are_decorative(text: str, matches) -> bool:
    """True when the inter-match text between consecutive underscore runs is
    purely whitespace / decorator characters (no Chinese, no letters, no digits).
    Examples that PASS: '¥ ____ ____ ____', '____.____.____', '____ - ____ - ____'.
    Examples that FAIL: '姓名: ____ 年龄: ____ 性别: ____' (real labels in between).
    """
    for i in range(len(matches) - 1):
        gap = text[matches[i].end():matches[i + 1].start()]
        if not _GAP_DECORATIVE_RE.match(gap):
            return False
        # Also reject very long gaps even if they happen to match — likely
        # separate fields with a punctuation-only label.
        if len(gap) > 12:
            return False
    return True


# A paragraph made up of only underscores plus pure decoration is a divider,
# not a fillable field. Removing underscore + decoration chars from such a
# paragraph leaves nothing behind.
_NON_UNDERSCORE_NON_DECOR_RE = re.compile(
    r"[_＿\s　.\-—–·•・|/\\,;:：（）()\[\]]+"
)


def _looks_like_signature(label: Optional[str], text: str, start: int, end: int) -> bool:
    """True if the slot's label or its near-context names a signature/seal field.

    Looks at the label, plus a small window of text on either side of the
    matched span (so '________ (signature)' is caught even though label
    detection only looks at text before the underscores).
    """
    if label and _SIGNATURE_RE.search(label):
        return True
    pre_window = text[max(0, start - 40):start]
    if _SIGNATURE_RE.search(pre_window):
        return True
    post_window = text[end:end + 40]
    if _SIGNATURE_RE.search(post_window):
        return True
    return False


def _is_decorative_underscore_paragraph(text: str, matches) -> bool:
    """True if the paragraph is a standalone underscore divider with no real
    label or signature context — i.e. content outside the underscores is only
    whitespace / punctuation. Avoids flagging dividers as fillable slots.
    """
    if not matches:
        return False
    stripped = text.strip()
    if not stripped:
        return False
    residue = _NON_UNDERSCORE_NON_DECOR_RE.sub("", stripped)
    if residue:
        return False
    total_underscores = sum(m.end() - m.start() for m in matches)
    return total_underscores >= 20


def _visual_width(s: str) -> int:
    """Approximate visual width of `s` in half-widths.

    Word renders proportional fonts: an ASCII space is ~1 half-width while a
    CJK ideograph / full-width punctuation glyph is ~2. Counting code points
    (len()) produces "centered" output that drifts off-center in the rendered
    document, especially in mixed Chinese / English contracts where a long
    Chinese value gets padded with too few ASCII spaces on each side.
    """
    w = 0
    for c in s:
        cp = ord(c)
        # CJK Unified Ideographs (incl. Ext A/B common ranges)
        if 0x4E00 <= cp <= 0x9FFF or 0x3400 <= cp <= 0x4DBF:
            w += 2
        # CJK symbols & punctuation, hiragana, katakana
        elif 0x3000 <= cp <= 0x33FF:
            w += 2
        # Full-width Latin / half-width katakana etc.
        elif 0xFF00 <= cp <= 0xFFEF:
            w += 2
        else:
            w += 1
    return w


# Enumeration / list markers at the very start of a paragraph. When a slot's
# paragraph begins with one of these, the underscore span is "the body of a
# numbered list item" and the value should sit *right after* the marker rather
# than be centered in the line.
#   (1), (a), （1）, （一）, 【1】, 1., 1)、, ①, 一、, 第一条, 1：
_LIST_MARKER_RE = re.compile(
    r"^\s*(?:"
    r"[（(【]\s*[0-9０-９一二三四五六七八九十百千零〇iIvVxXa-zA-Z]{1,6}\s*[)）】]"
    r"|[0-9０-９]{1,3}\s*[.、．:：)）]"
    r"|[一二三四五六七八九十百千零〇]{1,4}\s*[、.．:：)）]"
    r"|[①-⑳㈠-㈩❶-❿]"
    r"|第\s*[0-9０-９一二三四五六七八九十百千零〇]{1,4}\s*[条款项节章]"
    r")\s*"
)


def _prefix_is_only_list_marker(prefix: str) -> bool:
    """True if `prefix` consists solely of a list / enumeration marker plus
    optional whitespace — e.g. '（1）', '（1） ', '1. '. Used to switch
    underscore fills from centered to left-aligned only when the slot is
    the *body* of a numbered line (the marker is followed directly by the
    underscore span). Paragraphs like '2．研究开发经费由甲方 ___ ...' have
    real content between the marker and the slot, so they stay centered.
    """
    if not prefix:
        return False
    m = _LIST_MARKER_RE.match(prefix)
    if not m:
        return False
    return not prefix[m.end():].strip()


def _has_cjk(s: str) -> bool:
    for c in s:
        cp = ord(c)
        if 0x4E00 <= cp <= 0x9FFF or 0x3400 <= cp <= 0x4DBF or 0xF900 <= cp <= 0xFAFF:
            return True
    return False


def _build_space_padding(visual_half_widths: int, prefer_full_width: bool) -> str:
    """Produce a whitespace padding string that fills exactly `visual_half_widths`
    in Word. Uses ideographic spaces (each = 2 half-widths in Chinese fonts)
    when the value is CJK-heavy, with at most one trailing ASCII space to
    correct an odd parity. Falls back to plain ASCII spaces otherwise.
    """
    if visual_half_widths <= 0:
        return ""
    if prefer_full_width:
        fw = visual_half_widths // 2
        extra = visual_half_widths - fw * 2  # 0 or 1
        return ("　" * fw) + (" " * extra)
    return " " * visual_half_widths


def _center_in_underscore_span(
    value: str,
    span_text: str,
    pad_char: Optional[str] = None,
    align: str = "center",
) -> str:
    """Place `value` inside the span and pad to preserve the original line width.

    `align="center"` (default) splits padding on both sides; `align="left"`
    puts all padding on the right so the value sits at the start of the line
    — used for numbered-list bodies like '(1) ____________' where the value
    should appear right after the marker rather than floating in the middle.

    Padding is computed in **visual half-widths** (CJK / full-width glyphs = 2,
    ASCII = 1). For underline-character spans (`_`, `＿`) the same glyph is
    re-used as the pad. For underlined-whitespace spans the pad is regular
    spaces — but ideographic spaces when the value is CJK-heavy, because an
    ASCII space in a Chinese font renders narrower than half a CJK width and
    char-count centering drifts off in the rendered document. Falls back to
    the bare value when there is no room.
    """
    target_w = _visual_width(span_text)
    if target_w <= 0 or not value:
        return value
    value_w = _visual_width(value)
    # Reserve a single ASCII space on each side of the value for legibility.
    if value_w + 2 >= target_w:
        return value
    if pad_char is None:
        pad_char = "＿" if span_text.count("＿") > span_text.count("_") else "_"
    pad_visual = target_w - value_w - 2
    if align == "left":
        left_visual = 0
        right_visual = pad_visual
    else:
        left_visual = pad_visual // 2
        right_visual = pad_visual - left_visual
    is_space_pad = pad_char in (" ", "　", " ")
    if is_space_pad:
        use_fw = _has_cjk(value) or _has_cjk(span_text)
        left_pad = _build_space_padding(left_visual, use_fw)
        right_pad = _build_space_padding(right_visual, use_fw)
    else:
        pad_unit = _visual_width(pad_char) or 1
        left_pad = pad_char * (left_visual // pad_unit)
        right_pad = pad_char * (right_visual // pad_unit)
    return left_pad + " " + value + " " + right_pad


def _paragraph_has_horizontal_border(paragraph) -> bool:
    """True if the paragraph carries a visible bottom or between border
    (Word renders these as a horizontal rule, the most common author trick
    for 'fillable line' templates that contain no underscore characters).
    """
    try:
        from docx.oxml.ns import qn
    except Exception:
        return False
    try:
        pPr = paragraph._element.find(qn("w:pPr"))
        if pPr is None:
            return False
        pBdr = pPr.find(qn("w:pBdr"))
        if pBdr is None:
            return False
        for edge in ("w:bottom", "w:between", "w:top"):
            b = pBdr.find(qn(edge))
            if b is None:
                continue
            val = b.get(qn("w:val"))
            if val and val not in ("none", "nil"):
                return True
    except Exception:
        return False
    return False


def _find_underlined_whitespace_spans(
    paragraph,
) -> List[Tuple[int, int, List[Any], str]]:
    """Find consecutive runs whose visible text is only whitespace AND that
    carry an underline format. Word authors create fillable lines this way:
    select a long stretch of spaces / non-breaking spaces and apply underline.

    Returns (start_offset, end_offset, runs, text) tuples in paragraph-text
    coordinates. Requires total length ≥ 3 to filter incidental single-space
    underlines.
    """
    spans: List[Tuple[int, int, List[Any], str]] = []
    offset = 0
    cur_start: Optional[int] = None
    cur_runs: List[Any] = []
    cur_text: List[str] = []
    for run in paragraph.runs:
        rt = run.text or ""
        try:
            ul = bool(run.underline)
        except Exception:
            ul = False
        if ul and rt and not rt.strip():
            if cur_start is None:
                cur_start = offset
            cur_runs.append(run)
            cur_text.append(rt)
        else:
            if cur_start is not None:
                spans.append((cur_start, offset, cur_runs, "".join(cur_text)))
                cur_start = None
                cur_runs = []
                cur_text = []
        offset += len(rt)
    if cur_start is not None:
        spans.append((cur_start, offset, cur_runs, "".join(cur_text)))
    return [s for s in spans if len(s[3]) >= 3]


def _set_paragraph_centered(paragraph) -> None:
    """Best-effort: set paragraph horizontal alignment to CENTER. Used when
    filling a border-line slot so the value sits over the middle of the line.
    """
    try:
        from docx.enum.text import WD_ALIGN_PARAGRAPH
        paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    except Exception:
        pass


def _table_follows_paragraph(heading_p, empty_p) -> bool:
    """True if a <w:tbl> element is the next sibling after empty_p — or after
    skipping additional empty paragraphs. The heading's parent is the body /
    cell; we walk forward in document order and bail when we hit the first
    non-empty element.
    """
    try:
        from docx.oxml.ns import qn
        elem = empty_p._element
        parent = elem.getparent()
        if parent is None:
            return False
        children = list(parent)
        try:
            idx = children.index(elem)
        except ValueError:
            return False
        TBL = qn("w:tbl")
        P = qn("w:p")
        for sib in children[idx + 1:]:
            tag = sib.tag
            if tag == TBL:
                return True
            if tag == P:
                # Look at this paragraph's text content; skip if empty
                text = "".join(
                    (t.text or "")
                    for t in sib.iter(qn("w:t"))
                )
                if text.strip():
                    return False
                # else continue scanning past more empty paragraphs
                continue
            # Section properties or other XML — keep scanning
    except Exception:
        return False
    return False


def _paragraph_is_empty(paragraph) -> bool:
    return not "".join((r.text or "") for r in paragraph.runs).strip()


def _run_is_hintlike(run) -> bool:
    """A run looks like an instruction/hint: italic, or a light/grey font color."""
    if getattr(run, "italic", False):
        return True
    try:
        color = run.font.color
        if color is not None and color.rgb is not None:
            rgb = color.rgb
            # python-docx RGBColor is iterable as (r, g, b)
            r, g, b = int(rgb[0]), int(rgb[1]), int(rgb[2])
            # near-grey: channels close together and bright-ish (>= 0x80)
            if r >= 0x80 and abs(r - g) < 0x20 and abs(g - b) < 0x20 and abs(r - b) < 0x20:
                return True
            # explicit red-ish (often used for "delete me" notes) — caller
            # mostly cares about the phrase match, so we just treat red as
            # hint-eligible.
            if r >= 0xB0 and g < 0x60 and b < 0x60:
                return True
    except Exception:
        pass
    return False


def _find_hint_run(paragraph) -> Optional[Tuple[Any, int, int, str]]:
    """Find the first run in a paragraph that looks like instructional hint text.

    Returns (run, start_offset, end_offset, run_text) or None.
    """
    offset = 0
    for run in paragraph.runs:
        text = run.text or ""
        if not text:
            continue
        if _run_is_hintlike(run) and _looks_like_hint_text(text):
            return run, offset, offset + len(text), text
        offset += len(text)
    return None


def _looks_like_hint_text(text: str) -> bool:
    """True if a run's text matches the placeholder/hint phrase bank, or is
    a parenthesised / angle-bracketed snippet that reads like an instruction."""
    if not text or not text.strip():
        return False
    t = text.strip()
    if _RE_PHRASE_BANK.search(t):
        return True
    # parenthesised hints e.g. "(your bio here)" / "（请填写）" — short and starts/ends with bracket
    if (t.startswith(("(", "（", "[", "<", "《"))
        and t.endswith((")", "）", "]", ">", "》"))
        and len(t) <= 120):
        # Reject obvious citations like "(2024)" — must contain some letters
        inner = t[1:-1]
        if any(c.isalpha() for c in inner) or any("一" <= c <= "鿿" for c in inner):
            return True
    return False


# ---------------------------------------------------------------------- #
# Helpers — removal candidate scan                                        #
# ---------------------------------------------------------------------- #

def _scan_removals(doc) -> List[Dict[str, Any]]:
    """Find paragraphs that look like template instructions / meta-notes.

    Two kinds:
      - instruction_paragraph: whole paragraph matches the removal phrase bank.
      - instruction_run:       a paragraph whose hint-styled run (italic / grey
                               / red) contains removal-bank phrasing while the
                               surrounding runs are normal prose; the run is
                               flagged but the paragraph stays.
    """
    removals: List[Dict[str, Any]] = []
    counter = [0]

    def add(kind: str, text: str, reason: str, meta: Dict[str, Any]) -> None:
        rid = f"rm_{counter[0]}"
        counter[0] += 1
        removals.append({
            "id": rid,
            "kind": kind,
            "text": text,
            "reason": reason,
            "_meta": meta,
        })

    for p in _iter_all_paragraphs(doc):
        full = "".join((r.text or "") for r in p.runs)
        if not full.strip():
            continue
        m = _RE_REMOVAL_BANK.search(full)
        if not m:
            # Try styled-run-only removal: red/italic run with removal phrase
            for run in p.runs:
                rt = run.text or ""
                if not rt.strip():
                    continue
                if _run_is_hintlike(run) and _RE_REMOVAL_BANK.search(rt):
                    add(
                        "instruction_run",
                        _snippet(rt, 0, len(rt), radius=60),
                        "styled run with removal phrase",
                        {"paragraph": p, "run": run},
                    )
                    break
            continue
        # If the matched phrase covers most of the paragraph, mark it for full
        # deletion. Otherwise, treat the run containing the match as the
        # removal target — safer than nuking unrelated surrounding prose.
        cover = (m.end() - m.start()) / max(len(full.strip()), 1)
        if cover >= 0.5 or _all_runs_hintlike(p):
            add(
                "instruction_paragraph",
                _snippet(full, m.start(), m.end(), radius=80),
                m.group(0)[:60],
                {"paragraph": p},
            )
        else:
            # Find the run containing the match
            offset = 0
            target_run = None
            for run in p.runs:
                rt = run.text or ""
                if offset <= m.start() < offset + len(rt):
                    target_run = run
                    break
                offset += len(rt)
            if target_run is not None:
                add(
                    "instruction_run",
                    _snippet(full, m.start(), m.end(), radius=60),
                    m.group(0)[:60],
                    {"paragraph": p, "run": target_run},
                )
    return removals


def _all_runs_hintlike(paragraph) -> bool:
    runs = [r for r in paragraph.runs if (r.text or "").strip()]
    if not runs:
        return False
    return all(_run_is_hintlike(r) for r in runs)


def _apply_removals_in_place(
    docx_path: Path, selected_keys: List[Tuple[str, str, str]], requested_ids: List[str]
) -> Dict[str, Any]:
    """Re-scan removals on the saved doc, match by (kind, reason, text), delete.

    The original inspect ids are scan-relative; if intermediate Jinja/bracket
    passes shifted paragraph structure we can't trust the cached _meta refs.
    Re-scan, match each requested key to at most one fresh removal, then apply.
    """
    try:
        from docx import Document
    except ImportError:
        return {"applied": [], "skipped": list(requested_ids)}
    try:
        doc = Document(str(docx_path))
    except Exception:
        return {"applied": [], "skipped": list(requested_ids)}

    fresh = _scan_removals(doc)
    # Index fresh by (kind, reason, text) → list of removals (in scan order)
    bucket: Dict[Tuple[str, str, str], List[Dict[str, Any]]] = defaultdict(list)
    for r in fresh:
        bucket[(r["kind"], r["reason"], r["text"])].append(r)

    applied: List[str] = []
    skipped: List[str] = []
    for rid, key in zip(requested_ids, selected_keys):
        candidates = bucket.get(key, [])
        if not candidates:
            skipped.append(rid)
            continue
        fresh_r = candidates.pop(0)
        meta = fresh_r.get("_meta", {})
        if fresh_r["kind"] == "instruction_paragraph":
            paragraph = meta["paragraph"]
            if _drop_paragraph(paragraph):
                applied.append(rid)
            else:
                skipped.append(rid)
        elif fresh_r["kind"] == "instruction_run":
            run = meta["run"]
            try:
                run.text = ""
                # If paragraph is now effectively empty, drop it
                paragraph = meta["paragraph"]
                if _paragraph_is_empty(paragraph):
                    _drop_paragraph(paragraph)
                applied.append(rid)
            except Exception:
                skipped.append(rid)
        else:
            skipped.append(rid)

    try:
        doc.save(str(docx_path))
    except Exception:
        return {"applied": [], "skipped": list(requested_ids)}
    return {"applied": applied, "skipped": skipped}


def _drop_paragraph(paragraph) -> bool:
    """Remove a paragraph's XML element from its parent."""
    try:
        elem = paragraph._element
        parent = elem.getparent()
        if parent is None:
            return False
        parent.remove(elem)
        return True
    except Exception:
        return False


if __name__ == "__main__":  # pragma: no cover
    import tempfile
    from docx import Document as _Doc

    skill = DocxTemplateSkill()
    tmp = Path(tempfile.mkdtemp(prefix="docxtpl_smoke_"))
    tpl_path = tmp / "tpl.docx"
    out_path = tmp / "out.docx"

    from docx.enum.text import WD_COLOR_INDEX as _WD
    d = _Doc()
    d.add_paragraph("Hello [NAME], today is [DATE].")
    d.add_paragraph("Patient Name: __________")
    d.add_paragraph("Diagnosis:")
    # Highlighted (single run) — text marked yellow that the user will replace
    p_hl1 = d.add_paragraph("Summary: ")
    r_hl1 = p_hl1.add_run("ABSTRACT_GOES_HERE")
    r_hl1.font.highlight_color = _WD.YELLOW
    p_hl1.add_run(" — keep this trailing prose bold").bold = True
    # Highlighted (multi-run span) — bold + italic split into 2 runs, both highlighted
    p_hl2 = d.add_paragraph("Title: ")
    r_hl2a = p_hl2.add_run("PART_ONE ")
    r_hl2a.font.highlight_color = _WD.GREEN
    r_hl2a.bold = True
    r_hl2b = p_hl2.add_run("PART_TWO")
    r_hl2b.font.highlight_color = _WD.GREEN
    r_hl2b.italic = True
    p_hl2.add_run(" (footer text)")
    # Angle-bracketed
    d.add_paragraph("Dear <your name>, welcome.")
    # Placeholder-phrase
    d.add_paragraph("Replace this with your bio here.")
    # Hint text (italic)
    p_hint = d.add_paragraph("Author: ")
    r_hint = p_hint.add_run("(insert your full name)")
    r_hint.italic = True
    # Section heading + empty body
    d.add_heading("Background", level=1)
    d.add_paragraph("")
    # Removal — whole-paragraph instruction
    d.add_paragraph("Delete this paragraph before submitting.")
    # Removal — Chinese instruction
    d.add_paragraph("请删除本段使用前。")
    # Table
    tbl = d.add_table(rows=2, cols=2)
    tbl.rows[0].cells[0].text = "Field"
    tbl.rows[0].cells[1].text = "Value"
    tbl.rows[1].cells[0].text = "Age"
    # tbl.rows[1].cells[1] intentionally empty
    d.save(str(tpl_path))

    inspect = skill.inspect_template(str(tpl_path))
    print("Inspect:")
    print(f"  message: {inspect['message']}")
    print("  slots:")
    for s in inspect["slots"]:
        print("   ", s)
    print("  removals:")
    for r in inspect["removals"]:
        print("   ", r)
    print("  bracket tokens:", inspect["bracket_tokens"])

    slot_vals = {s["id"]: f"<{s['kind']}>" for s in inspect["slots"]}
    removal_ids = [r["id"] for r in inspect["removals"]]
    result = skill.fill_template(
        str(tpl_path), str(out_path),
        context={"NAME": "Alice", "DATE": "2026-05-13"},
        slot_values=slot_vals,
        removal_ids=removal_ids,
    )
    print("Fill result:")
    print(f"  message: {result.get('message')}")
    print(f"  filled_keys: {result.get('filled_keys')}")
    print(f"  removals_applied: {result.get('removals_applied')}")
    print(f"  removals_skipped: {result.get('removals_skipped')}")
    if result.get('slot_fill'):
        print(f"  slot_fill: {result['slot_fill']}")
    print("Output content:")
    out_doc = _Doc(str(out_path))
    for p in out_doc.paragraphs:
        print(" ", repr(p.text))
    # Verify the highlighted slots had their highlight cleared
    print("Highlight verification (should all be False/None):")
    for p in out_doc.paragraphs:
        for r in p.runs:
            if r.text and "<highlighted>" in r.text:
                hl = r.font.highlight_color
                print(
                    f"   run={r.text!r:30s} highlight={hl!r:18s} "
                    f"bold={r.bold} italic={r.italic}"
                )
    # Verify surrounding formatting preserved
    print("Surrounding formatting (should keep bold/italic on neighbors):")
    for p in out_doc.paragraphs:
        if "keep this trailing prose bold" in (p.text or ""):
            for r in p.runs:
                print(f"   run={r.text!r:50s} bold={r.bold}")
        if "(footer text)" in (p.text or ""):
            for r in p.runs:
                print(f"   run={r.text!r:50s} bold={r.bold} italic={r.italic}")
