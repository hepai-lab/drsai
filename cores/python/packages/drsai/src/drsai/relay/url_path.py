from __future__ import annotations

from collections.abc import Iterable
from urllib.parse import quote, urlencode


def encoded_path(
    *segments: str,
    query: Iterable[tuple[str, str | int]] = (),
) -> str:
    """Build an HTTP path without treating opaque identifiers as path syntax."""
    if not segments:
        raise ValueError("relay_path_segments_invalid")
    normalized: list[str] = []
    for value in segments:
        if not isinstance(value, str) or not value or "\x00" in value:
            raise ValueError("relay_path_segments_invalid")
        normalized.append(value)
    pairs: list[tuple[str, str]] = []
    for name, value in query:
        rendered = str(value)
        if not isinstance(name, str) or not name or "\x00" in name or "\x00" in rendered:
            raise ValueError("relay_query_invalid")
        pairs.append((name, rendered))
    path = "/" + "/".join(quote(value, safe="") for value in normalized)
    return path + ("?" + urlencode(pairs) if pairs else "")
