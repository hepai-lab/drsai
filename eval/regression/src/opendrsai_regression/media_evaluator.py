from __future__ import annotations

import hashlib
import math
import re
import struct
import zipfile
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET


def inspect_artifact(path: str | Path) -> dict[str, Any]:
    value = Path(path)
    if not value.is_file():
        raise ValueError(f"Artifact not found: {value}")
    base = {
        "local_path": str(value), "extension": value.suffix.lower(), "size_bytes": value.stat().st_size,
        "sha256": hashlib.sha256(value.read_bytes()).hexdigest(), "sha256_required": True, "openable": True,
    }
    if value.suffix.lower() == ".pptx":
        return {**base, **inspect_pptx(value), "type": "presentation", "mime_type": "application/vnd.openxmlformats-officedocument.presentationml.presentation"}
    if value.suffix.lower() == ".png":
        width, height, color_mode = inspect_png(value)
        return {**base, "type": "image", "mime_type": "image/png", "width": width, "height": height, "color_mode": color_mode, "format": "png", "orientation": "landscape" if width > height else "portrait" if height > width else "square"}
    return base


def inspect_pptx(path: Path) -> dict[str, Any]:
    try:
        with zipfile.ZipFile(path) as archive:
            names = set(archive.namelist())
            if "[Content_Types].xml" not in names or "ppt/presentation.xml" not in names:
                raise ValueError("PPTX package is missing required Office parts")
            slides = sorted(
                (name for name in names if re.fullmatch(r"ppt/slides/slide\d+\.xml", name)),
                key=lambda name: int(re.search(r"\d+", name).group()),
            )
            texts: list[list[str]] = []
            for name in slides:
                root = ET.fromstring(archive.read(name))
                texts.append([node.text or "" for node in root.iter() if node.tag.endswith("}t")])
            presentation = ET.fromstring(archive.read("ppt/presentation.xml"))
            size = next((node for node in presentation.iter() if node.tag.endswith("}sldSz")), None)
            if size is None:
                raise ValueError("PPTX presentation has no slide size")
            width_emu, height_emu = int(size.attrib["cx"]), int(size.attrib["cy"])
    except (zipfile.BadZipFile, KeyError, ET.ParseError) as exc:
        raise ValueError(f"Invalid PPTX artifact: {path}: {exc}") from exc
    divisor = math.gcd(width_emu, height_emu)
    ratio_width, ratio_height = width_emu // divisor, height_emu // divisor
    page_numbers = [
        any(value.strip() in {str(index), f"{index:02d}"} for value in row)
        for index, row in enumerate(texts, 1)
    ]
    editable = any(any(value.strip() for value in row) for row in texts)
    return {
        "format": "pptx", "slide_count": len(slides), "slide_text": texts,
        "slides": [{"index": index, "text": row} for index, row in enumerate(texts, 1)],
        "editable": editable, "editable_text": editable,
        "aspect_ratio": {
            "width": ratio_width, "height": ratio_height,
            "value": width_emu / height_emu,
        },
        "page_numbers": {
            "required_on_all_slides": bool(page_numbers) and all(page_numbers),
            "slides": page_numbers,
        },
        "office_package_valid": True,
    }


def inspect_png(path: Path) -> tuple[int, int, str]:
    header = path.read_bytes()[:29]
    if len(header) < 29 or header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR":
        raise ValueError(f"Invalid PNG artifact: {path}")
    width, height = struct.unpack(">II", header[16:24])
    color_type = header[25]
    modes = {0: "L", 2: "RGB", 3: "P", 4: "LA", 6: "RGBA"}
    return width, height, modes.get(color_type, "unknown")
