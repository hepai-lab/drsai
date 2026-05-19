"""Tests for detection enhancements added for CN ministry templates:

- Inline whitespace blanks bounded by label colons / currency symbols.
- Auto-numbered (w:numPr) section headings as section_body_empty triggers.
- Explicit removal markers like "应删除" / "此句话非正文".
- Suppression: a paragraph flagged as a full-paragraph removal should not
  also surface as a fillable highlighted slot.

Plain-assert style — runs with `python test_inline_blanks_and_removals.py`.
"""
from __future__ import annotations

import sys
import tempfile
from pathlib import Path

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE.parent))

from docx import Document  # type: ignore[import-not-found]
from docx.oxml import OxmlElement  # type: ignore[import-not-found]
from docx.oxml.ns import qn  # type: ignore[import-not-found]
from docx.enum.text import WD_COLOR_INDEX  # type: ignore[import-not-found]
import docx_template_skill as dts


def _add_numbered_paragraph(doc, text: str, num_id: int = 1, ilvl: int = 1):
    p = doc.add_paragraph(text)
    pPr = p._p.get_or_add_pPr()
    numPr = OxmlElement("w:numPr")
    ilvl_el = OxmlElement("w:ilvl")
    ilvl_el.set(qn("w:val"), str(ilvl))
    numId_el = OxmlElement("w:numId")
    numId_el.set(qn("w:val"), str(num_id))
    numPr.append(ilvl_el)
    numPr.append(numId_el)
    pPr.append(numPr)
    return p


# ── Inline whitespace blanks ─────────────────────────────────────────────


def test_inline_blank_between_colon_and_punctuation():
    """`交货地点：     ；rest` — whitespace gap bounded by '：' and '；'
    must be detected as a fillable slot."""
    tmp = Path(tempfile.mkdtemp())
    d = Document()
    d.add_paragraph("交货地点：         ；乙方负责运输。")
    tpl = tmp / "tpl.docx"
    d.save(str(tpl))
    skill = dts.DocxTemplateSkill(str(tmp))
    ins = skill.inspect_template(str(tpl))
    inline = [s for s in ins["slots"]
              if s["kind"] == "underscores" and "交货地点" in (s.get("label") or "")]
    assert inline, f"expected an inline blank slot for 交货地点; got {ins['slots']}"
    out = tmp / "out.docx"
    skill.fill_template(str(tpl), str(out),
                        slot_values={inline[0]["id"]: "北京市石景山区"})
    body = "\n".join(p.text for p in Document(str(out)).paragraphs)
    assert "交货地点：北京市石景山区；乙方负责运输" in body, body


def test_inline_blank_money_paragraph_two_gaps():
    """The 总经费 line has TWO whitespace gaps (`：    元` and `￥    元`)
    plus a highlighted drafting note at the tail. All three must be picked
    up — previously only the highlighted tail was emitted, and the fill
    leaked into the wrong position."""
    tmp = Path(tempfile.mkdtemp())
    d = Document()
    p = d.add_paragraph()
    p.add_run("（一）本项目总经费：")
    # First whitespace gap with underline (Word's "fill-in line" trick).
    r_gap1 = p.add_run("            ")
    r_gap1.font.underline = True
    p.add_run("元（元），即￥")
    r_gap2 = p.add_run("        ")
    r_gap2.font.underline = True
    p.add_run("元（小写）。报价明细表见本合同附件。")
    r_hl = p.add_run("（非标制造产品，通常应该提供报价明细）")
    r_hl.font.highlight_color = WD_COLOR_INDEX.YELLOW
    tpl = tmp / "tpl.docx"
    d.save(str(tpl))
    skill = dts.DocxTemplateSkill(str(tmp))
    ins = skill.inspect_template(str(tpl))
    # Find the two underscore-kind blanks pointing at this paragraph.
    blanks = [s for s in ins["slots"] if s["kind"] == "underscores"]
    assert len(blanks) >= 2, f"expected ≥2 inline blanks, got {len(blanks)}: {blanks}"
    # The highlighted span must still be emitted as a separate slot.
    hls = [s for s in ins["slots"] if s["kind"] == "highlighted"]
    assert hls, "expected highlighted drafting note to still surface as a slot"


def test_inline_blank_not_triggered_in_normal_prose():
    """Plain prose with a colon and only a single space afterward must NOT
    be detected as a blank — the regex requires ≥3 whitespace chars."""
    tmp = Path(tempfile.mkdtemp())
    d = Document()
    d.add_paragraph("注意：本合同自双方签字盖章后生效。")
    tpl = tmp / "tpl.docx"
    d.save(str(tpl))
    skill = dts.DocxTemplateSkill(str(tmp))
    ins = skill.inspect_template(str(tpl))
    assert not any(s["kind"] == "underscores" for s in ins["slots"]), ins["slots"]


# ── Date scaffold (`__年__月__日` with whitespace gaps) ────────────────


def test_date_scaffold_year_month_day():
    """`签订日期：    年    月    日` — the whole scaffold (gaps + 年/月/日)
    becomes one slot whose fill replaces the entire span cleanly. Without
    this, only the leading gap is detected and the value gets sandwiched
    against leftover `年   月   日` template text."""
    tmp = Path(tempfile.mkdtemp())
    d = Document()
    d.add_paragraph("签订日期：       年     月     日")
    tpl = tmp / "tpl.docx"
    d.save(str(tpl))
    skill = dts.DocxTemplateSkill(str(tmp))
    ins = skill.inspect_template(str(tpl))
    date_slots = [s for s in ins["slots"]
                  if s["kind"] == "underscores" and "签订日期" in (s.get("label") or s.get("context") or "")]
    assert len(date_slots) == 1, f"expected single date slot; got {date_slots}"
    out = tmp / "out.docx"
    skill.fill_template(str(tpl), str(out), slot_values={date_slots[0]["id"]: "2026年5月18日"})
    body = "\n".join(p.text for p in Document(str(out)).paragraphs)
    # Clean replacement — no leftover template scaffolding.
    assert "签订日期：2026年5月18日" in body, body
    # No stray `年   月` text outside the value.
    assert "日年" not in body, f"leftover scaffold after fill: {body!r}"
    assert body.count("年") == 1
    assert body.count("月") == 1
    # `签订日期` itself contains a `日`, so the total count of 日 in
    # `签订日期：2026年5月18日` is two — one in the label, one in the value.
    assert body.count("日") == 2


def test_date_scaffold_year_month_only():
    """Two-segment scaffold `    年    月` (no 日) also becomes one slot."""
    tmp = Path(tempfile.mkdtemp())
    d = Document()
    d.add_paragraph("合同期限：       年     月")
    tpl = tmp / "tpl.docx"
    d.save(str(tpl))
    skill = dts.DocxTemplateSkill(str(tmp))
    ins = skill.inspect_template(str(tpl))
    date_slots = [s for s in ins["slots"]
                  if s["kind"] == "underscores" and "合同期限" in (s.get("label") or s.get("context") or "")]
    assert len(date_slots) == 1, f"expected single slot; got {date_slots}"
    out = tmp / "out.docx"
    skill.fill_template(str(tpl), str(out), slot_values={date_slots[0]["id"]: "2026年5月"})
    body = "\n".join(p.text for p in Document(str(out)).paragraphs)
    assert "合同期限：2026年5月" in body, body
    assert "月年" not in body, body


def test_date_scaffold_no_false_positive_for_normal_prose():
    """`2024年5月` written as normal prose (no whitespace gap before 年)
    must NOT be detected as a fillable scaffold."""
    tmp = Path(tempfile.mkdtemp())
    d = Document()
    d.add_paragraph("本合同自2024年5月起生效。")
    tpl = tmp / "tpl.docx"
    d.save(str(tpl))
    skill = dts.DocxTemplateSkill(str(tmp))
    ins = skill.inspect_template(str(tpl))
    assert not any(s["kind"] == "underscores" for s in ins["slots"]), ins["slots"]


# ── section_body_empty for auto-numbered headings ────────────────────────


def test_section_body_empty_under_auto_numbered_heading():
    """An empty paragraph immediately after a numbered (w:numPr) heading
    must surface as a section_body_empty slot. Previously these were
    missed because `_is_heading` only checked Heading-style names."""
    tmp = Path(tempfile.mkdtemp())
    d = Document()
    _add_numbered_paragraph(d, "技术指标及要求")
    d.add_paragraph("")  # empty body — should become a fillable slot
    _add_numbered_paragraph(d, "双方协作内容")
    d.add_paragraph("")
    tpl = tmp / "tpl.docx"
    d.save(str(tpl))
    skill = dts.DocxTemplateSkill(str(tmp))
    ins = skill.inspect_template(str(tpl))
    labels = [s.get("label") for s in ins["slots"] if s["kind"] == "section_body_empty"]
    assert "技术指标及要求" in labels, labels
    assert "双方协作内容" in labels, labels


def test_auto_numbered_body_text_not_a_heading():
    """A LONG numbered paragraph (body sub-item, not a section title) must
    NOT be treated as a heading — otherwise the empty paragraph after it
    would wrongly emit a section_body_empty slot."""
    tmp = Path(tempfile.mkdtemp())
    d = Document()
    _add_numbered_paragraph(
        d,
        "本合同技术开发风险责任由乙方承担，乙方需按时交付符合标准的产品。",
        ilvl=4,
    )
    d.add_paragraph("")
    tpl = tmp / "tpl.docx"
    d.save(str(tpl))
    skill = dts.DocxTemplateSkill(str(tmp))
    ins = skill.inspect_template(str(tpl))
    assert not any(s["kind"] == "section_body_empty" for s in ins["slots"]), ins["slots"]


# ── Removal markers ──────────────────────────────────────────────────────


def test_removal_marker_yingshanchu():
    """`应删除` / `此句话非正文` in a fully-parenthesized paragraph must
    be detected as a whole-paragraph removal, not a fillable highlighted
    slot."""
    tmp = Path(tempfile.mkdtemp())
    d = Document()
    p = d.add_paragraph()
    r = p.add_run("（全文排版确保下表不跨页。此句话非正文，应删除）")
    r.font.highlight_color = WD_COLOR_INDEX.YELLOW
    tpl = tmp / "tpl.docx"
    d.save(str(tpl))
    skill = dts.DocxTemplateSkill(str(tmp))
    ins = skill.inspect_template(str(tpl))
    # Removal emitted as full-paragraph.
    rms = [r for r in ins["removals"] if r["kind"] == "instruction_paragraph"]
    assert rms, f"expected an instruction_paragraph removal; got {ins['removals']}"
    # No duplicate highlighted slot for the same paragraph.
    hls = [s for s in ins["slots"]
           if s["kind"] == "highlighted" and "应删除" in (s.get("context") or "")]
    assert not hls, f"highlighted slot should be suppressed; got {hls}"


def test_run_level_removal_unsuppressed():
    """A run-level removal (instruction_run) inside otherwise-normal prose
    must NOT suppress fillable slots elsewhere in that paragraph."""
    tmp = Path(tempfile.mkdtemp())
    d = Document()
    p = d.add_paragraph()
    r_hl = p.add_run("HT-PLACEHOLDER")
    r_hl.font.highlight_color = WD_COLOR_INDEX.YELLOW
    p.add_run(" 合同编号请填写完整 ")
    # Add a non-italic run-level removal phrase that won't dominate the paragraph.
    p.add_run("应删除")
    tpl = tmp / "tpl.docx"
    d.save(str(tpl))
    skill = dts.DocxTemplateSkill(str(tmp))
    ins = skill.inspect_template(str(tpl))
    # The highlighted slot should still surface.
    hls = [s for s in ins["slots"] if s["kind"] == "highlighted"]
    assert hls, f"expected highlighted slot to remain; got {ins['slots']}"


# ── Runner ───────────────────────────────────────────────────────────────


def _run_all():
    failed = []
    fns = [(name, fn) for name, fn in globals().items()
           if name.startswith("test_") and callable(fn)]
    for name, fn in fns:
        try:
            fn()
            print(f"  OK   {name}")
        except AssertionError as exc:
            print(f"  FAIL {name}: {exc}")
            failed.append(name)
        except Exception as exc:
            import traceback
            print(f"  ERR  {name}: {type(exc).__name__}: {exc}")
            traceback.print_exc()
            failed.append(name)
    print()
    if failed:
        print(f"{len(failed)} of {len(fns)} test(s) failed: {failed}")
        return 1
    print(f"All {len(fns)} tests passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(_run_all())
