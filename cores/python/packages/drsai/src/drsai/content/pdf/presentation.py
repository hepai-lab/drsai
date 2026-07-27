"""Safe, bounded text extraction for PDFs that may be slide decks."""

from __future__ import annotations

import argparse
import json
import re
import statistics
from pathlib import Path
from typing import Any

from pypdf import PdfReader

MAX_FILE_BYTES = 64 * 1024 * 1024
MAX_PAGES = 200
MAX_PAGE_CHARS = 12_000
MAX_OUTPUT_CHARS = 240_000


def _clean_text(value: str) -> str:
    value = value.replace("\x00", " ").replace("\ufffdC", "–")
    lines = [re.sub(r"\s+", " ", line).strip() for line in value.splitlines()]
    return "\n".join(line for line in lines if line)[:MAX_PAGE_CHARS]


def _page_role(page_number: int, page_count: int, text: str) -> str:
    lower = text.lower()
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if page_number == 1:
        return "cover"
    if any(token in lower for token in ("agenda", "contents", "outline")):
        return "agenda"
    if any(token in lower for token in ("questions?", "questions and answers", "q&a", "thank you")):
        return "questions"
    # A sparse "Conclusions" slide is a divider; the following detailed slide is
    # the actual summary.
    if len(lines) == 1 and len(text) <= 180:
        return "section"
    if any(token in lower for token in ("conclusions", "conclusion", "summary", "takeaways")):
        return "summary"
    # Slide decks often use a sparse title-only page as a chapter divider.
    if page_number == page_count and len(text) <= 240:
        return "questions"
    return "content"


def _meaningful_lines(text: str, labels: tuple[str, ...] = ()) -> list[str]:
    ignored = {label.casefold() for label in labels}
    result: list[str] = []
    for raw_line in text.splitlines():
        line = raw_line.strip().lstrip("-•–— ").strip()
        if not line or re.fullmatch(r"\d+", line) or line.casefold() in ignored:
            continue
        result.append(line)
    return result


def _group_bullets(text: str, labels: tuple[str, ...] = ()) -> list[str]:
    ignored = {label.casefold() for label in labels}
    points: list[str] = []
    current = ""
    for raw_line in text.splitlines():
        stripped = raw_line.strip()
        if not stripped or re.fullmatch(r"\d+", stripped) or stripped.casefold() in ignored:
            continue
        starts_bullet = bool(re.match(r"^[-•–—]\s*", stripped))
        clean = re.sub(r"^[-•–—]\s*", "", stripped).strip()
        if starts_bullet:
            if current:
                points.append(current)
            current = clean
        elif current:
            current = f"{current} {clean}"
        else:
            current = clean
    if current:
        points.append(current)
    return [point[:600] for point in points if point]


def _numeric_highlights(pages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    highlights: list[dict[str, Any]] = []
    seen: set[str] = set()
    signal = re.compile(
        r"(?:\b\d+(?:\.\d+)?\s*(?:%|Tbps|Gbps|PB|GB/s|times?|years?)\b|"
        r"\bfactor\s+of\s+\d+(?:\.\d+)?\b|\b20\d{2}\b)",
        re.IGNORECASE,
    )
    for page in pages:
        lines = _meaningful_lines(page["text"])
        for index, line in enumerate(lines):
            if not signal.search(line):
                continue
            if re.search(r"factor\s+of\s+\d", line, re.IGNORECASE):
                line = " ".join(lines[max(0, index - 4):index + 1])
            normalized = line.casefold()
            if normalized in seen:
                continue
            seen.add(normalized)
            highlights.append({"text": line[:500], "page": page["page"]})
            if len(highlights) >= 32:
                return highlights
    return highlights


def _section_tag(title: str, index: int) -> str:
    lower = title.casefold()
    if "challenge" in lower:
        return "data_challenges"
    if "asia" in lower:
        return "asian_networks"
    if "wlcg" in lower or "distributed computing" in lower:
        return "wlcg"
    if "conclusion" in lower or "summary" in lower:
        return "conclusions"
    return "background" if index == 0 else "section"


def _manager_title(tag: str, source_title: str) -> str:
    titles = {
        "background": "为什么这项工作需要全球协同计算",
        "wlcg": "全球算力需要作为一套协作体系运行",
        "asian_networks": "亚洲网络是全球科研协作的关键链路",
        "data_challenges": "数据挑战正在提前验证未来就绪度",
        "hl_lhc_requirements": "数据增长正在转化为明确的网络需求",
        "conclusions": "管理层需要同时关注容量、成本与跨机构协同",
    }
    return titles.get(tag, source_title)


def build_manager_deck_blueprint(
    pages: list[dict[str, Any]],
    analysis: dict[str, Any],
) -> dict[str, Any]:
    sections = analysis.get("storySections", [])
    highlights = analysis.get("numericHighlights", [])
    summary_points = analysis.get("summaryPoints", [])
    slides: list[dict[str, Any]] = []

    def add_slide(
        role: str,
        title: str,
        source_pages: list[int],
        evidence: list[str],
        notes_required: bool = True,
    ) -> None:
        slides.append(
            {
                "slide": len(slides) + 1,
                "role": role,
                "title": title,
                "sourcePages": sorted(set(source_pages)),
                "evidence": [item[:500] for item in evidence if item][:6],
                "speakerNotesRequired": notes_required,
            }
        )

    add_slide(
        "cover",
        analysis.get("title") or "演示报告",
        [1],
        ["面向非专业管理者的中文重组版"],
        notes_required=False,
    )
    executive_sources = [item["page"] for item in summary_points[:4]] + [
        item["page"] for item in highlights[:8]
    ]
    add_slide(
        "executive_summary",
        "管理层摘要：变化、影响与准备工作",
        executive_sources,
        [item["text"] for item in summary_points[:4]],
    )

    non_conclusion_sections = [
        (index, section, _section_tag(section["title"], index))
        for index, section in enumerate(sections)
        if _section_tag(section["title"], index) != "conclusions"
    ][:5]
    for index, section, tag in non_conclusion_sections:
        start = int(section["page"])
        next_pages = [int(candidate["page"]) for candidate in sections if int(candidate["page"]) > start]
        end = min(next_pages) - 1 if next_pages else len(pages)
        section_highlights = [item for item in highlights if start <= int(item["page"]) <= end]
        highlight_pages = list(dict.fromkeys(int(item["page"]) for item in section_highlights))[:3]
        source_pages = [start] + highlight_pages
        evidence = [item["text"] for item in section_highlights[:4]]
        if not evidence:
            evidence = _meaningful_lines(pages[start - 1]["text"])[:3]
        add_slide(tag, _manager_title(tag, section["title"]), source_pages, evidence)

    requirement_highlights = [
        item
        for item in highlights
        if re.search(r"(?:factor|%|Tbps|Gbps|PB|GB/s|requirement|bandwidth)", item["text"], re.IGNORECASE)
    ]
    add_slide(
        "hl_lhc_requirements",
        _manager_title("hl_lhc_requirements", "关键规模与资源需求"),
        [int(item["page"]) for item in requirement_highlights[-8:]],
        [item["text"] for item in requirement_highlights[-8:]],
    )
    add_slide(
        "conclusions",
        _manager_title("conclusions", "结论"),
        [int(item["page"]) for item in summary_points],
        [item["text"] for item in summary_points],
    )
    all_sources = sorted({page for slide in slides for page in slide["sourcePages"]})
    add_slide(
        "sources",
        "来源与页码",
        all_sources,
        [f"原始演示报告第 {page} 页" for page in all_sources],
        notes_required=False,
    )
    for number, slide in enumerate(slides, start=1):
        slide["slide"] = number
    return {
        "schemaVersion": 1,
        "audience": "non_expert_managers",
        "language": "zh-CN",
        "format": "pptx",
        "slideCount": len(slides),
        "slides": slides,
        "minimumSpeakerNotesCoverage": 0.8,
        "wholePageScreenshotReuseAllowed": False,
        "sourceMappingRequired": True,
    }


def analyze_presentation(pages: list[dict[str, Any]], metadata: dict[str, str]) -> dict[str, Any]:
    cover_lines = _meaningful_lines(pages[0]["text"]) if pages else []
    title = metadata.get("title") or (cover_lines[0] if cover_lines else "")
    if not metadata.get("title") and len(cover_lines) >= 2:
        second = cover_lines[1]
        if not re.search(r"(?:visit|conference|workshop|meeting|\b20\d{2}\b|@)", second, re.IGNORECASE):
            title = f"{cover_lines[0]} {second}"
    agenda: list[dict[str, Any]] = []
    story_sections: list[dict[str, Any]] = []
    summary_points: list[dict[str, Any]] = []
    for page in pages:
        if page["role"] == "agenda":
            for item in _meaningful_lines(page["text"], ("agenda", "contents", "outline")):
                agenda.append({"text": item, "page": page["page"]})
        if page["role"] == "section":
            lines = _meaningful_lines(page["text"])
            if lines:
                story_sections.append({"title": lines[0], "page": page["page"]})
        if page["role"] == "summary":
            for point in _group_bullets(page["text"], ("summary", "conclusions", "conclusion")):
                summary_points.append({"text": point, "page": page["page"]})
    analysis = {
        "title": title,
        "agenda": agenda[:12],
        "storySections": story_sections[:24],
        "summaryPoints": summary_points[:12],
        "numericHighlights": _numeric_highlights(pages),
        "sourcePageCount": len(pages),
    }
    analysis["managerDeckBlueprint"] = build_manager_deck_blueprint(pages, analysis)
    return analysis


def extract_presentation_pdf(path: Path) -> dict[str, Any]:
    size = path.stat().st_size
    if size > MAX_FILE_BYTES:
        raise ValueError(f"PDF exceeds the {MAX_FILE_BYTES}-byte safety limit")

    # pypdf parses data objects but does not execute JavaScript, links, launch actions,
    # forms, or embedded files. strict=False tolerates common producer quirks.
    reader = PdfReader(str(path), strict=False)
    if reader.is_encrypted:
        try:
            if reader.decrypt("") == 0:
                raise ValueError("Encrypted PDF requires a password")
        except Exception as exc:
            raise ValueError("Encrypted PDF requires a password") from exc

    total_pages = len(reader.pages)
    if total_pages > MAX_PAGES:
        raise ValueError(f"PDF exceeds the {MAX_PAGES}-page safety limit")

    pages: list[dict[str, Any]] = []
    landscape_pages = 0
    page_lengths: list[int] = []
    for index, page in enumerate(reader.pages):
        width = float(page.mediabox.width)
        height = float(page.mediabox.height)
        landscape_pages += int(width > height)
        text = _clean_text(page.extract_text() or "")
        page_lengths.append(len(text))
        pages.append(
            {
                "page": index + 1,
                "role": _page_role(index + 1, total_pages, text),
                "width": round(width, 2),
                "height": round(height, 2),
                "text": text,
            }
        )

    landscape_ratio = landscape_pages / total_pages if total_pages else 0.0
    median_text_chars = statistics.median(page_lengths) if page_lengths else 0
    presentation_like = total_pages >= 3 and landscape_ratio >= 0.6 and median_text_chars <= 2_000
    raw_metadata = reader.metadata or {}
    metadata = {
        "title": raw_metadata.get("/Title") or "",
        "author": raw_metadata.get("/Author") or "",
        "subject": raw_metadata.get("/Subject") or "",
        "creator": raw_metadata.get("/Creator") or "",
        "producer": raw_metadata.get("/Producer") or "",
    }
    result: dict[str, Any] = {
        "schemaVersion": 1,
        "type": "presentation_pdf" if presentation_like else "document_pdf",
        "fileName": path.name,
        "sizeBytes": size,
        "pageCount": total_pages,
        "landscapeRatio": round(landscape_ratio, 3),
        "medianTextChars": median_text_chars,
        "metadata": metadata,
        "pages": pages,
        "safety": {
            "javascriptExecuted": False,
            "linksOpened": False,
            "attachmentsExtracted": False,
            "networkAccessed": False,
        },
    }
    if presentation_like:
        result["analysis"] = analyze_presentation(pages, metadata)
    encoded = json.dumps(result, ensure_ascii=False)
    if len(encoded) > MAX_OUTPUT_CHARS:
        for page in pages:
            page["text"] = page["text"][:3_000]
    return result


def format_agent_context(result: dict[str, Any], max_chars: int = 120_000) -> str:
    metadata = result["metadata"]
    header = [
        f"PDF type: {result['type']}",
        f"Pages: {result['pageCount']}",
        f"Title: {metadata.get('title') or '(not set)'}",
        f"Creator: {metadata.get('creator') or '(not set)'}",
        "Safety: text and page geometry only; PDF scripts, links, forms, and attachments were not executed or opened.",
    ]
    analysis = result.get("analysis") or {}
    blueprint = analysis.get("managerDeckBlueprint") or {}
    outline = [
        "Presentation analysis:",
        "Agenda: " + "; ".join(f"{item['text']} (p.{item['page']})" for item in analysis.get("agenda", [])),
        "Story sections: " + "; ".join(
            f"{item['title']} (p.{item['page']})" for item in analysis.get("storySections", [])
        ),
        "Summary: " + " | ".join(
            f"{item['text']} (p.{item['page']})" for item in analysis.get("summaryPoints", [])
        ),
        "Numeric highlights: " + " | ".join(
            f"{item['text']} (p.{item['page']})" for item in analysis.get("numericHighlights", [])
        ),
        "Manager PPTX blueprint: " + " | ".join(
            f"{slide['slide']}. {slide['title']} [{slide['role']}] "
            f"(sources: {', '.join(f'p.{page}' for page in slide['sourcePages'])})"
            for slide in blueprint.get("slides", [])
        ),
    ] if analysis else []
    sections = [
        f"[Page {page['page']} | {page['role']}]\n{page['text']}"
        for page in result["pages"]
        if page["text"]
    ]
    return "\n".join(header + [line for line in outline if not line.endswith(": ")] + sections)[:max_chars]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("path", type=Path)
    parser.add_argument("--format", choices=("json", "context"), default="json")
    parser.add_argument("--max-chars", type=int, default=120_000)
    args = parser.parse_args()
    result = extract_presentation_pdf(args.path.resolve())
    if args.format == "context":
        print(format_agent_context(result, max(1_000, min(args.max_chars, MAX_OUTPUT_CHARS))))
    else:
        print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
