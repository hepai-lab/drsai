from __future__ import annotations

import json
import sys
from pathlib import Path

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN
from pptx.util import Inches, Pt


BLUE = RGBColor(20, 74, 145)
NAVY = RGBColor(12, 35, 71)
CYAN = RGBColor(58, 190, 210)
WHITE = RGBColor(255, 255, 255)
PALE = RGBColor(232, 241, 252)


def _text_box(slide, left, top, width, height, text, *, size, color, bold=False, align=PP_ALIGN.LEFT):
    shape = slide.shapes.add_textbox(Inches(left), Inches(top), Inches(width), Inches(height))
    frame = shape.text_frame
    frame.clear()
    frame.word_wrap = True
    paragraph = frame.paragraphs[0]
    paragraph.text = str(text)
    paragraph.alignment = align
    run = paragraph.runs[0]
    run.font.name = "Microsoft YaHei"
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.color.rgb = color
    return shape


def _background(slide, color):
    fill = slide.background.fill
    fill.solid()
    fill.fore_color.rgb = color


def _page_number(slide, index, light=False):
    _text_box(slide, 12.1, 7.05, 0.7, 0.25, str(index), size=10, color=PALE if light else BLUE, align=PP_ALIGN.RIGHT)


def create(spec: dict, output: Path) -> None:
    slides = spec.get("slides")
    if not isinstance(slides, list) or not slides:
        raise ValueError("spec.slides must be a non-empty array")
    presentation = Presentation()
    presentation.slide_width = Inches(13.333333)
    presentation.slide_height = Inches(7.5)
    blank = presentation.slide_layouts[6]
    for index, item in enumerate(slides, 1):
        if not isinstance(item, dict):
            raise ValueError(f"slide {index} must be an object")
        kind = str(item.get("kind") or "content")
        title = str(item.get("title") or "").strip()
        if not title:
            raise ValueError(f"slide {index} title is required")
        slide = presentation.slides.add_slide(blank)
        if kind == "title":
            _background(slide, NAVY)
            accent = slide.shapes.add_shape(1, Inches(0.7), Inches(0.75), Inches(0.14), Inches(5.6))
            accent.fill.solid(); accent.fill.fore_color.rgb = CYAN; accent.line.fill.background()
            _text_box(slide, 1.2, 1.7, 10.8, 1.5, title, size=34, color=WHITE, bold=True)
            subtitle = str(item.get("subtitle") or spec.get("subtitle") or "").strip()
            if subtitle:
                _text_box(slide, 1.25, 3.45, 10.2, 0.9, subtitle, size=19, color=PALE)
            _page_number(slide, index, light=True)
        elif kind == "content":
            _background(slide, WHITE)
            header = slide.shapes.add_shape(1, Inches(0), Inches(0), Inches(13.333333), Inches(0.18))
            header.fill.solid(); header.fill.fore_color.rgb = CYAN; header.line.fill.background()
            _text_box(slide, 0.75, 0.55, 11.7, 0.7, title, size=27, color=NAVY, bold=True)
            bullets = item.get("bullets") or []
            if not isinstance(bullets, list) or not bullets:
                raise ValueError(f"content slide {index} requires bullets")
            if len(bullets) > 6:
                raise ValueError(f"content slide {index} has more than 6 bullets")
            box = slide.shapes.add_textbox(Inches(1.0), Inches(1.65), Inches(11.2), Inches(4.9))
            frame = box.text_frame
            frame.clear(); frame.word_wrap = True
            for bullet_index, bullet in enumerate(bullets):
                text = str(bullet).strip()
                if not text:
                    raise ValueError(f"content slide {index} has an empty bullet")
                paragraph = frame.paragraphs[0] if bullet_index == 0 else frame.add_paragraph()
                paragraph.text = text
                paragraph.level = 0
                paragraph.font.name = "Microsoft YaHei"
                paragraph.font.size = Pt(21)
                paragraph.font.color.rgb = BLUE
                paragraph.space_after = Pt(13)
                paragraph.text = f"•  {text}"
            _page_number(slide, index)
        else:
            raise ValueError(f"slide {index} has unsupported kind: {kind}")
    output.parent.mkdir(parents=True, exist_ok=True)
    presentation.save(output)


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: create_deck.py SPEC.json OUTPUT.pptx", file=sys.stderr)
        return 2
    spec = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    create(spec, Path(sys.argv[2]).resolve())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
