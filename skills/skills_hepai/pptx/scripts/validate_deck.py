from __future__ import annotations

import json
import sys
from pathlib import Path

from pptx import Presentation


def validate(path: Path) -> dict:
    presentation = Presentation(path)
    errors: list[str] = []
    ratio = presentation.slide_width / presentation.slide_height
    if abs(ratio - (16 / 9)) > 0.01:
        errors.append(f"aspect ratio is {ratio:.4f}, expected 16:9")
    if not presentation.slides:
        errors.append("presentation has no slides")
    width, height = presentation.slide_width, presentation.slide_height
    slide_text: list[list[str]] = []
    for index, slide in enumerate(presentation.slides, 1):
        texts: list[str] = []
        for shape in slide.shapes:
            if shape.left < 0 or shape.top < 0 or shape.left + shape.width > width or shape.top + shape.height > height:
                errors.append(f"slide {index} shape is outside slide bounds")
            text = str(getattr(shape, "text", "") or "").strip()
            if text:
                texts.append(text)
        if not texts:
            errors.append(f"slide {index} is blank")
        if str(index) not in texts:
            errors.append(f"slide {index} has no page number")
        slide_text.append(texts)
    return {"valid": not errors, "slide_count": len(presentation.slides), "slides": slide_text, "errors": errors}


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: validate_deck.py PRESENTATION.pptx", file=sys.stderr)
        return 2
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    result = validate(Path(sys.argv[1]).resolve())
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["valid"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
