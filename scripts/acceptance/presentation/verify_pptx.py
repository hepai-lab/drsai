"""Deterministic structural acceptance checks for generated PPTX deliverables."""

from __future__ import annotations

import argparse
import json
import re
import zipfile
from pathlib import Path
from typing import Any
from xml.etree import ElementTree

DRAWING_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"


def _natural_number(name: str) -> int:
    match = re.search(r"(\d+)(?=\.xml$)", name)
    return int(match.group(1)) if match else 0


def _xml_text(package: zipfile.ZipFile, name: str) -> str:
    root = ElementTree.fromstring(package.read(name))
    return "\n".join(
        node.text.strip()
        for node in root.iter(f"{{{DRAWING_NS}}}t")
        if node.text and node.text.strip()
    )


def inspect_pptx(path: Path, manifest_path: Path) -> dict[str, Any]:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    with zipfile.ZipFile(path) as package:
        bad_member = package.testzip()
        if bad_member:
            raise ValueError(f"PPTX ZIP member failed CRC validation: {bad_member}")
        names = set(package.namelist())
        slides = sorted(
            (name for name in names if re.fullmatch(r"ppt/slides/slide\d+\.xml", name)),
            key=_natural_number,
        )
        notes = sorted(
            (name for name in names if re.fullmatch(r"ppt/notesSlides/notesSlide\d+\.xml", name)),
            key=_natural_number,
        )
        media = sorted(name for name in names if name.startswith("ppt/media/") and not name.endswith("/"))
        slide_texts = [_xml_text(package, name) for name in slides]
        note_texts = [_xml_text(package, name) for name in notes]

    roles = {item["role"]: item for item in manifest["slides"]}
    content_roles = [
        item for item in manifest["slides"] if item["role"] not in {"cover", "sources"}
    ]
    notes_count = sum(bool(text.strip()) for text in note_texts)
    notes_coverage = notes_count / len(content_roles) if content_roles else 1.0
    all_text = "\n".join(slide_texts)
    required_facts = {
        "data_growth_10x": bool(re.search(r"(?:10\s*倍|10×)", all_text)),
        "minimal_4_8_tbps": "4.8 Tbps" in all_text,
        "flexible_9_6_tbps": "9.6 Tbps" in all_text,
        "dc_2027_50_percent": "2027" in all_text and "50%" in all_text,
        "dc_2029_100_percent_uncertain": "2029" in all_text and "100%" in all_text and "待确认" in all_text,
    }
    required_roles = {
        "cover",
        "executive_summary",
        "background",
        "wlcg",
        "asian_networks",
        "data_challenges",
        "hl_lhc_requirements",
        "conclusions",
        "sources",
    }
    source_mapping = {
        "hl_lhc_requirements_page_42": 42 in roles.get("hl_lhc_requirements", {}).get("sourcePages", []),
        "data_challenges_page_43": 43 in roles.get("data_challenges", {}).get("sourcePages", []),
        "conclusions_page_47": 47 in roles.get("conclusions", {}).get("sourcePages", []),
        "every_factual_slide_mapped": all(item.get("sourcePages") for item in manifest["slides"]),
    }
    checks = {
        "validZip": True,
        "contentTypesPresent": "[Content_Types].xml" in names,
        "presentationPartPresent": "ppt/presentation.xml" in names,
        "slideCountMatchesManifest": len(slides) == manifest["slideCount"],
        "slideCountInRange": 8 <= len(slides) <= 12,
        "allRequiredRoles": required_roles.issubset(roles),
        "speakerNotesCoverage": notes_coverage >= 0.8,
        "noWholePageScreenshots": len(media) == 0 and manifest.get("wholePageScreenshotReuse") is False,
        "noPlaceholders": not re.search(r"lorem ipsum|placeholder|待填写|TODO", all_text, re.IGNORECASE),
        "allGoldenFacts": all(required_facts.values()),
        "sourceMapping": all(source_mapping.values()),
    }
    return {
        "ok": all(checks.values()),
        "file": str(path),
        "slideCount": len(slides),
        "notesParts": len(notes),
        "nonEmptyNotes": notes_count,
        "speakerNotesCoverage": notes_coverage,
        "mediaCount": len(media),
        "checks": checks,
        "goldenFacts": required_facts,
        "sourceMapping": source_mapping,
        "slideTexts": slide_texts,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("pptx", type=Path)
    parser.add_argument("manifest", type=Path)
    args = parser.parse_args()
    result = inspect_pptx(args.pptx.resolve(), args.manifest.resolve())
    print(json.dumps(result, ensure_ascii=False))
    if not result["ok"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
