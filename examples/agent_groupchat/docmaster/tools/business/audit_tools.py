"""
audit_application_materials_tool — entry point for 申请资料审查.

Thin wrapper around ``document_skills.application_review_skill``. The
underlying skill does the deterministic extraction + checklist work; this
module exposes it as a FunctionTool so the LLM can call it directly with one
tool call instead of fanning out to extract_docx_content_tool /
extract_scanned_pdf_tool / run_read sequences.

The return value's ``report_markdown`` field is the human-facing audit
report. The LLM is instructed to copy that field verbatim into its reply.
"""

from typing import Optional


def audit_application_materials_tool(
    file_paths: list[str],
    template: Optional[str] = None,
) -> dict:
    """Audit a batch of uploaded application materials in one shot.

    Use this when the user uploads a set of documents (申报书 / 承诺书 / 合同 /
    报价单 / 资质证明 / 评审意见 etc.) and asks for 申请资料审查 / 申请材料完整性
    审核 / 立项材料体检. The tool:

      1. Reads every file with the right extractor:
         - .docx → python-docx
         - .pdf  → PyMuPDF, OCR fallback only on image-based pages
         - .png/.jpg/.jpeg/.bmp/.tiff/.webp → RapidOCR
      2. Classifies each by content (申报书 / 承诺书 / 合同 / 报价单 /
         资质证明 / 专家评审 / 其他).
      3. Runs a checklist keyed by ``template``:
         - "guanlianyewu"  关联业务申请材料完整性核查
         - "generic"       通用申请材料体检
         - omit / None     auto-detect from document content
      4. Returns a single Markdown report ready for direct display, plus
         structured ``missing`` / ``warnings`` / ``passed`` arrays.

    Do NOT chain extract_docx_content_tool / extract_scanned_pdf_tool /
    run_read in addition to this — that produces the same data twice and
    fills the chat with redundant processing messages. Call this tool once
    with all uploaded file paths and let it own the extraction.

    Args:
        file_paths: absolute paths to every file in the packet, in any order.
        template: optional checklist name. Pass "guanlianyewu" for
            related-party business packets, "generic" for everything else.
            Omit to auto-detect.

    Returns:
        dict with keys:
          - success (bool)
          - template (str): which checklist actually ran
          - report_markdown (str): the human-facing audit report
          - missing (list[dict]): items the auditor flagged as ❌
          - warnings (list[dict]): items flagged as ⚠️
          - passed (list[dict]): items flagged as ✅
          - files (list[dict]): per-file extraction summary
          - message (str): one-line status
    """
    from ...document_skills.application_review_skill import audit_application_materials

    return audit_application_materials(file_paths=file_paths, template=template)
