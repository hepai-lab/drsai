"""Helpers for user-facing tool / execution logs (chat UI and summaries)."""

from __future__ import annotations

import re
from collections import OrderedDict
from typing import Sequence

# Enough for typical logs; keeps WebSocket payloads and UI responsive.
_DEFAULT_PACKET_MAX = 16_000
_DEFAULT_PER_RESULT_MAX = 8_000


def format_tools_usage_log_title(tool_names: Sequence[str], *, prefix: str = "I am using tools: ") -> str:
    """Build a compact log title with per-tool counts, preserving first-seen order.

    Example: ``["run_bash", "run_bash"]`` → ``"I am using tools: run_bash ×2"``.
    """
    if not tool_names:
        return prefix.rstrip()
    counts: OrderedDict[str, int] = OrderedDict()
    for name in tool_names:
        counts[str(name)] = counts.get(str(name), 0) + 1
    parts: list[str] = []
    for name, n in counts.items():
        parts.append(name if n == 1 else f"{name} ×{n}")
    return prefix + " ".join(parts)


def _is_curl_progress_continuation(stripped: str) -> bool:
    """Heuristic: lines that belong to curl's progress table (not command stderr)."""
    if not stripped:
        return True
    if "Dload" in stripped and "Upload" in stripped and "Total" in stripped:
        return True
    if "--:--:--" in stripped or stripped.count("--:") >= 2:
        return True
    # Typical stat rows: digits, spaces, k/M suffixes, percent signs.
    if re.fullmatch(r"[\d\s\.\%kKM,\-:]+", stripped):
        return True
    return False


def strip_curl_progress_table(text: str) -> str:
    """Remove curl's default progress table lines from tool stdout."""
    if not text or "% Total" not in text or "% Received" not in text:
        return text
    lines = text.splitlines()
    out: list[str] = []
    i = 0
    n = len(lines)
    while i < n:
        line = lines[i]
        if "% Total" in line and "% Received" in line:
            i += 1
            while i < n and _is_curl_progress_continuation(lines[i].strip()):
                i += 1
            continue
        out.append(line)
        i += 1
    return "\n".join(out)


def truncate_text(text: str, max_chars: int, *, suffix: str) -> str:
    if max_chars <= 0 or len(text) <= max_chars:
        return text
    budget = max_chars - len(suffix)
    if budget <= 0:
        return suffix.strip()
    return text[:budget] + suffix


def sanitize_single_tool_result(
    text: str | object,
    *,
    max_chars: int = _DEFAULT_PER_RESULT_MAX,
) -> str:
    """Strip curl noise and cap length for one tool's ``result`` field in summaries."""
    s = text if isinstance(text, str) else str(text)
    s = strip_curl_progress_table(s)
    total = len(s)
    if total <= max_chars:
        return s
    suffix = f"\n\n… [truncated, {total} chars total]"
    return truncate_text(s, max_chars, suffix=suffix)


def sanitize_tool_summary_packet(
    text: str | object,
    *,
    max_chars: int = _DEFAULT_PACKET_MAX,
) -> str:
    """Apply curl cleanup and a final cap on the full summary message sent to the UI."""
    s = text if isinstance(text, str) else str(text)
    s = strip_curl_progress_table(s)
    total = len(s)
    if total <= max_chars:
        return s
    suffix = f"\n\n… [truncated, {total} chars total]"
    return truncate_text(s, max_chars, suffix=suffix)
