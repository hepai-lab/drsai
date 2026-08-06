from __future__ import annotations

import hashlib
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
            slides = sorted(name for name in archive.namelist() if name.startswith("ppt/slides/slide") and name.endswith(".xml"))
            texts: list[list[str]] = []
            for name in slides:
                root = ET.fromstring(archive.read(name))
                texts.append([node.text or "" for node in root.iter() if node.tag.endswith("}t")])
    except (zipfile.BadZipFile, KeyError, ET.ParseError) as exc:
        raise ValueError(f"Invalid PPTX artifact: {path}: {exc}") from exc
    return {"format": "pptx", "slide_count": len(slides), "slide_text": texts, "editable": any(any(row) for row in texts), "editable_text": any(any(row) for row in texts)}


def inspect_png(path: Path) -> tuple[int, int, str]:
    header = path.read_bytes()[:29]
    if len(header) < 29 or header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR":
        raise ValueError(f"Invalid PNG artifact: {path}")
    width, height = struct.unpack(">II", header[16:24])
    color_type = header[25]
    modes = {0: "L", 2: "RGB", 3: "P", 4: "LA", 6: "RGBA"}
    return width, height, modes.get(color_type, "unknown")
