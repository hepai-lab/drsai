"""
申请资料审查 — deterministic auditor for uploaded application packets.

Single entry point ``audit_application_materials`` that:

1. Classifies each input by extension (DOCX / PDF / image).
2. Extracts text via the same code paths the existing DocMaster tools use:
     - DOCX: ``python-docx`` (paragraphs + tables, flattened).
     - PDF:  PyMuPDF native text; per-page OCR fallback through the shared
             RapidOCR pool when native text is too short.
     - Images: RapidOCR.
3. Runs a checklist keyed by ``template`` over the extracted text.
4. Returns a dict containing a fully-formed Markdown audit report plus
   structured ``missing`` / ``warnings`` arrays.

The output is consumed by ``audit_application_materials_tool`` (the tool
wrapper). The tool's ``report_markdown`` field is copied verbatim into the
LLM's reply.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

# OCR pool is owned by the existing extract_scanned_pdf_tool. We reuse the
# same module-global queue so we don't double the RAM footprint with a
# parallel pool — borrow / return through the same primitives.
from .tools.pdf import ocr_tools as _ocr_tools


# ────────────────────────────────────────────────────────────────────────────
# Extraction
# ────────────────────────────────────────────────────────────────────────────


_DOCX_EXT = {".docx"}
_PDF_EXT = {".pdf"}
_IMAGE_EXT = {".png", ".jpg", ".jpeg", ".bmp", ".tiff", ".tif", ".webp"}


@dataclass
class ExtractedDoc:
    path: str
    kind: str  # "docx" | "pdf" | "image" | "unknown"
    text: str = ""
    page_count: int = 0
    ocr_confidence: float | None = None  # average over OCR pages, if any
    warnings: list[str] = field(default_factory=list)
    error: str | None = None


def _extract_docx(path: Path) -> ExtractedDoc:
    try:
        from docx import Document
    except ImportError as e:
        return ExtractedDoc(str(path), "docx", error=f"python-docx missing: {e}")

    try:
        doc = Document(str(path))
    except Exception as e:
        return ExtractedDoc(str(path), "docx", error=f"open failed: {e}")

    chunks: list[str] = []
    for p in doc.paragraphs:
        t = (p.text or "").strip()
        if t:
            chunks.append(t)
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                t = (cell.text or "").strip()
                if t:
                    chunks.append(t)
    return ExtractedDoc(str(path), "docx", text="\n".join(chunks))


def _ocr_image_array(img_array) -> tuple[str, float | None, list[str]]:
    """Borrow an engine from the shared pool and OCR one image array."""
    pool = _ocr_tools._RAPIDOCR_POOL
    lock = _ocr_tools._ensure_rapidocr_pool_lock()
    if pool.empty():
        try:
            from rapidocr_onnxruntime import RapidOCR
        except ImportError as e:
            return "", None, [f"rapidocr missing: {e}"]
        with lock:
            if pool.empty():
                pool.put(RapidOCR())
    engine = pool.get()
    try:
        result, _elapsed = engine(img_array)
    finally:
        pool.put(engine)
    if not result:
        return "", None, ["OCR returned no text regions"]
    lines, confs = [], []
    for _box, txt, conf in result:
        if txt:
            lines.append(txt)
            try:
                confs.append(float(conf))
            except (TypeError, ValueError):
                pass
    text = "\n".join(lines)
    avg = sum(confs) / len(confs) if confs else None
    warns = [f"low avg OCR confidence {avg:.2f}"] if (avg is not None and avg < 0.70) else []
    return text, avg, warns


def _extract_pdf(path: Path, min_text_chars_per_page: int = 40, dpi: int = 150) -> ExtractedDoc:
    try:
        import fitz
    except ImportError as e:
        return ExtractedDoc(str(path), "pdf", error=f"pymupdf missing: {e}")
    try:
        import numpy as np
    except ImportError as e:
        return ExtractedDoc(str(path), "pdf", error=f"numpy missing: {e}")

    try:
        doc = fitz.open(str(path))
    except Exception as e:
        return ExtractedDoc(str(path), "pdf", error=f"open failed: {e}")

    chunks: list[str] = []
    confs: list[float] = []
    warnings: list[str] = []
    try:
        with _ocr_tools._OCR_TOOL_SEMAPHORE:
            for idx in range(len(doc)):
                page = doc[idx]
                native = page.get_text() or ""
                if len(native.strip()) >= min_text_chars_per_page:
                    chunks.append(native)
                    continue
                try:
                    pix = page.get_pixmap(dpi=dpi, alpha=False)
                    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(
                        pix.height, pix.width, pix.n
                    )
                    if pix.n == 4:
                        img = img[:, :, :3]
                    elif pix.n == 1:
                        img = np.repeat(img, 3, axis=2)
                    img = np.ascontiguousarray(img)
                    del pix
                except Exception as e:
                    warnings.append(f"page {idx+1}: render failed: {e}")
                    continue
                text, avg, warns = _ocr_image_array(img)
                if text:
                    chunks.append(text)
                if avg is not None:
                    confs.append(avg)
                for w in warns:
                    warnings.append(f"page {idx+1}: {w}")
        return ExtractedDoc(
            path=str(path),
            kind="pdf",
            text="\n\f\n".join(chunks),
            page_count=len(doc),
            ocr_confidence=(sum(confs) / len(confs)) if confs else None,
            warnings=warnings,
        )
    finally:
        doc.close()


def _extract_image(path: Path) -> ExtractedDoc:
    try:
        import numpy as np
        from PIL import Image
    except ImportError as e:
        return ExtractedDoc(str(path), "image", error=f"pillow/numpy missing: {e}")
    try:
        img = np.array(Image.open(str(path)).convert("RGB"))
    except Exception as e:
        return ExtractedDoc(str(path), "image", error=f"open failed: {e}")
    with _ocr_tools._OCR_TOOL_SEMAPHORE:
        text, avg, warns = _ocr_image_array(img)
    return ExtractedDoc(
        path=str(path),
        kind="image",
        text=text,
        page_count=1,
        ocr_confidence=avg,
        warnings=warns,
    )


def extract_one(file_path: str) -> ExtractedDoc:
    p = Path(file_path)
    if not p.is_file():
        return ExtractedDoc(file_path, "unknown", error=f"no file at {file_path!r}")
    ext = p.suffix.lower()
    if ext in _DOCX_EXT:
        return _extract_docx(p)
    if ext in _PDF_EXT:
        return _extract_pdf(p)
    if ext in _IMAGE_EXT:
        return _extract_image(p)
    return ExtractedDoc(str(p), "unknown", error=f"unsupported extension {ext!r}")


# ────────────────────────────────────────────────────────────────────────────
# Checklist primitives
# ────────────────────────────────────────────────────────────────────────────


@dataclass
class Finding:
    """One row in the audit report."""

    section: str         # e.g. "申报书", "承诺书", "合同", "一致性核查"
    item: str            # e.g. "联系电话", "课题负责人签字"
    status: str          # "pass" | "warn" | "missing"
    note: str = ""

    @property
    def icon(self) -> str:
        return {"pass": "✅", "warn": "⚠️", "missing": "❌"}.get(self.status, "·")


def _has_any(text: str, needles: Iterable[str]) -> bool:
    return any(n in text for n in needles)


def _find_amount(text: str) -> str | None:
    """Pull the first 'X万元' or '¥X' number-y span."""
    m = re.search(r"([\d.,]+)\s*万元", text)
    if m:
        return f"{m.group(1)}万元"
    m = re.search(r"[¥￥]\s*([\d,]+(?:\.\d+)?)", text)
    if m:
        return f"¥{m.group(1)}"
    return None


def _classify_role(doc: ExtractedDoc) -> str:
    """Heuristic — what kind of document is this within an application packet?"""
    t = doc.text
    if _has_any(t, ["申报书", "申请书", "立项申请"]):
        return "申报书"
    if _has_any(t, ["承诺书", "承诺函"]):
        return "承诺书"
    if _has_any(t, ["合同", "协议书", "技术协议"]) and _has_any(t, ["甲方", "乙方"]):
        return "合同"
    if _has_any(t, ["报价单", "报价表", "询价单"]):
        return "报价单"
    if _has_any(t, ["营业执照", "统一社会信用代码"]):
        return "资质证明"
    if _has_any(t, ["评审意见", "专家评审", "论证意见"]):
        return "专家评审"
    return "其他"


# ────────────────────────────────────────────────────────────────────────────
# Template checklists
# ────────────────────────────────────────────────────────────────────────────


def _check_signed(text: str) -> bool:
    """A signed承诺书/申报书should mention a 年/月/日 dated line AND show signs
    of an actual name (Chinese name patterns or the literal '签字' followed by
    something other than whitespace). OCR rarely captures handwriting, so the
    most we can do is flag the *absence* of a date or name area."""
    has_date = bool(re.search(r"20\d{2}\s*[年\-\.]\s*\d{1,2}\s*[月\-\.]\s*\d{1,2}", text))
    return has_date


def _checklist_guanlianyewu(docs: list[ExtractedDoc]) -> list[Finding]:
    """关联业务 (related-party business) packet checklist.

    Required pieces:
      - 申报书 (DOCX), 承诺书 (any), 合同 (PDF), 三家报价单, 关联方资质证明.
      - 金额一致, 关联方名称一致, 课题编号体现在承诺书与合同里.
      - 合同金额 ≥ 10 万元 → 必须有专家评审材料.
    """
    findings: list[Finding] = []
    by_role: dict[str, list[ExtractedDoc]] = {}
    for d in docs:
        by_role.setdefault(_classify_role(d), []).append(d)

    def _need(role: str, hint: str = "") -> ExtractedDoc | None:
        items = by_role.get(role) or []
        if not items:
            findings.append(Finding("文件清单", role, "missing", hint or f"未检测到{role}"))
            return None
        findings.append(Finding("文件清单", role, "pass", items[0].path))
        return items[0]

    appl = _need("申报书")
    promise = _need("承诺书")
    contract = _need("合同")
    if "报价单" not in by_role:
        findings.append(
            Finding("文件清单", "三家报价单", "missing",
                    "未上传独立的三家报价单文件；申报书中的数字不能替代正式报价单")
        )
    if "资质证明" not in by_role:
        findings.append(
            Finding("文件清单", "关联方资质证明", "missing",
                    "未上传营业执照 / 资质证书")
        )

    # 承诺书签字 (OCR can verify only the date line)
    if promise and not _check_signed(promise.text):
        findings.append(
            Finding("承诺书", "签字 / 日期", "missing",
                    "未识别到完整的『年月日』签署行；请确认签字与日期已落款")
        )
    elif promise:
        findings.append(
            Finding("承诺书", "签字 / 日期", "warn",
                    "检测到日期行；OCR 无法判读手写签名，请人工确认签名是否完整")
        )

    # Amount consistency
    amounts: dict[str, str] = {}
    for label, doc in [("申报书", appl), ("承诺书", promise), ("合同", contract)]:
        if doc:
            amt = _find_amount(doc.text)
            if amt:
                amounts[label] = amt
    if len(set(amounts.values())) > 1:
        findings.append(
            Finding("一致性核查", "金额一致", "warn",
                    "； ".join(f"{k}: {v}" for k, v in amounts.items()))
        )
    elif amounts:
        findings.append(
            Finding("一致性核查", "金额一致", "pass",
                    f"三处一致：{next(iter(amounts.values()))}")
        )

    # 课题编号 — typically only承诺书 carries it explicitly
    has_project_code = bool(re.search(r"[A-Z]\d{3}[A-Z0-9]{3,}", (promise.text if promise else "")))
    if promise and has_project_code:
        findings.append(Finding("一致性核查", "课题编号", "pass", "承诺书载明课题编号"))
        if contract and not re.search(r"[A-Z]\d{3}[A-Z0-9]{3,}", contract.text):
            findings.append(
                Finding("一致性核查", "合同 — 课题编号", "warn",
                        "合同未载明承诺书中的课题编号；建议补充以建立明确关联")
            )
    elif promise:
        findings.append(
            Finding("一致性核查", "课题编号", "warn", "承诺书未明确识别到课题编号")
        )

    # ≥10 万 → expert review required
    threshold_amount = None
    if contract:
        threshold_amount = _find_amount(contract.text) or _find_amount(promise.text if promise else "")
    if threshold_amount and "万" in threshold_amount:
        try:
            num = float(re.sub(r"[^\d.]", "", threshold_amount))
            if num >= 10 and "专家评审" not in by_role:
                findings.append(
                    Finding("专家评审", "评审材料", "missing",
                            f"合同金额 {threshold_amount} ≥ 10 万元，需提交专家评审意见表")
                )
        except ValueError:
            pass

    return findings


def _checklist_generic(docs: list[ExtractedDoc]) -> list[Finding]:
    """Lightweight checks usable for any application packet.

    Surfaces: file inventory, extraction errors, low-OCR-confidence pages,
    a coarse 金额一致 cross-check when amounts appear in multiple files.
    """
    findings: list[Finding] = []
    for d in docs:
        if d.error:
            findings.append(Finding("文件清单", Path(d.path).name, "missing", d.error))
            continue
        role = _classify_role(d)
        suffix = f"({role}, {d.page_count} 页)" if d.page_count else f"({role})"
        if d.ocr_confidence is not None and d.ocr_confidence < 0.70:
            findings.append(
                Finding("文件清单", Path(d.path).name, "warn",
                        f"OCR 置信度仅 {d.ocr_confidence:.2f} {suffix}")
            )
        else:
            findings.append(Finding("文件清单", Path(d.path).name, "pass", suffix))
        for w in d.warnings:
            findings.append(Finding("提取告警", Path(d.path).name, "warn", w))

    # cross-file amount sniff
    amount_per_file: dict[str, str] = {}
    for d in docs:
        amt = _find_amount(d.text)
        if amt:
            amount_per_file[Path(d.path).name] = amt
    if len(set(amount_per_file.values())) > 1:
        findings.append(
            Finding("一致性核查", "金额一致", "warn",
                    "； ".join(f"{k}: {v}" for k, v in amount_per_file.items()))
        )
    elif amount_per_file:
        findings.append(
            Finding("一致性核查", "金额一致", "pass",
                    f"统一金额：{next(iter(amount_per_file.values()))}")
        )

    return findings


_TEMPLATES = {
    "guanlianyewu": _checklist_guanlianyewu,
    "generic": _checklist_generic,
}


def _detect_template(docs: list[ExtractedDoc]) -> str:
    blob = "\n".join(d.text for d in docs)
    if _has_any(blob, ["关联业务", "关联交易", "关联方", "关联单位"]):
        return "guanlianyewu"
    return "generic"


# ────────────────────────────────────────────────────────────────────────────
# Report rendering
# ────────────────────────────────────────────────────────────────────────────


def _render_report(
    template: str,
    docs: list[ExtractedDoc],
    findings: list[Finding],
) -> str:
    """Produce the human-facing Markdown report shown in the chat canvas."""
    title_map = {
        "guanlianyewu": "关联业务申请材料完整性审核报告",
        "generic": "申请材料完整性审核报告",
    }
    title = title_map.get(template, "申请材料完整性审核报告")

    lines: list[str] = [f"# {title}", ""]

    # File identification
    lines.append("## 一、文件识别结果")
    lines.append("")
    lines.append("| 序号 | 文件 | 类型 | 读取方式 | 备注 |")
    lines.append("| ---- | ---- | ---- | -------- | ---- |")
    for i, d in enumerate(docs, 1):
        if d.error:
            method = "—"
            note = d.error
        elif d.kind == "docx":
            method = "DOCX 原生"
            note = "—"
        elif d.kind == "pdf":
            note = f"OCR 置信度 {d.ocr_confidence:.2%}" if d.ocr_confidence else "原生文本"
            method = "PDF + OCR 回退"
        elif d.kind == "image":
            method = "OCR"
            note = f"置信度 {d.ocr_confidence:.2%}" if d.ocr_confidence else "—"
        else:
            method = "—"
            note = "未识别的文件类型"
        lines.append(f"| {i} | {Path(d.path).name} | {_classify_role(d)} | {method} | {note} |")
    lines.append("")

    # Findings by section
    by_section: dict[str, list[Finding]] = {}
    for f in findings:
        by_section.setdefault(f.section, []).append(f)

    lines.append("## 二、逐项审核")
    lines.append("")
    for sec, items in by_section.items():
        lines.append(f"### {sec}")
        lines.append("")
        lines.append("| 检查项 | 状态 | 说明 |")
        lines.append("| ------ | ---- | ---- |")
        for it in items:
            lines.append(f"| {it.item} | {it.icon} | {it.note or '—'} |")
        lines.append("")

    # Summary
    missing = [f for f in findings if f.status == "missing"]
    warns = [f for f in findings if f.status == "warn"]
    passed = [f for f in findings if f.status == "pass"]
    lines.append("## 三、汇总")
    lines.append("")
    lines.append(f"- ✅ 通过: **{len(passed)}** 项")
    lines.append(f"- ⚠️ 需关注: **{len(warns)}** 项")
    lines.append(f"- ❌ 缺失: **{len(missing)}** 项")
    if missing:
        lines.append("")
        lines.append("**建议优先补充：**")
        for f in missing:
            lines.append(f"- ({f.section}) {f.item} — {f.note}")
    return "\n".join(lines)


# ────────────────────────────────────────────────────────────────────────────
# Public entry point
# ────────────────────────────────────────────────────────────────────────────


def audit_application_materials(
    file_paths: list[str],
    template: str | None = None,
) -> dict[str, Any]:
    """Run the deterministic application-materials audit.

    Args:
        file_paths: absolute paths to the uploaded files (DOCX / PDF / image).
        template: which checklist to run. ``None`` (default) auto-detects
            based on document content; explicit values: ``"guanlianyewu"``,
            ``"generic"``.

    Returns:
        ``{"success": bool, "template": str, "report_markdown": str,
           "missing": [...], "warnings": [...], "passed": [...],
           "files": [{...}], "message": str}``
    """
    if not file_paths:
        return {
            "success": False,
            "template": template or "generic",
            "report_markdown": "",
            "missing": [],
            "warnings": [],
            "passed": [],
            "files": [],
            "message": "no file paths provided",
        }

    docs = [extract_one(fp) for fp in file_paths]

    chosen = template if template in _TEMPLATES else _detect_template(docs)
    checklist = _TEMPLATES[chosen]

    findings = checklist(docs)
    report_md = _render_report(chosen, docs, findings)

    def _pack(fs: list[Finding]) -> list[dict[str, str]]:
        return [{"section": f.section, "item": f.item, "note": f.note} for f in fs]

    return {
        "success": True,
        "template": chosen,
        "report_markdown": report_md,
        "missing": _pack([f for f in findings if f.status == "missing"]),
        "warnings": _pack([f for f in findings if f.status == "warn"]),
        "passed": _pack([f for f in findings if f.status == "pass"]),
        "files": [
            {
                "path": d.path,
                "kind": d.kind,
                "role": _classify_role(d),
                "ocr_confidence": d.ocr_confidence,
                "error": d.error,
            }
            for d in docs
        ],
        "message": (
            f"audited {len(docs)} file(s) via '{chosen}' template; "
            f"{sum(1 for f in findings if f.status == 'missing')} missing, "
            f"{sum(1 for f in findings if f.status == 'warn')} warnings"
        ),
    }


__all__ = ["audit_application_materials", "extract_one", "ExtractedDoc", "Finding"]
