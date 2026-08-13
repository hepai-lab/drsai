"""Durable, bounded and redacted logging for the packaged desktop Gateway."""
from __future__ import annotations

import io
import os
from pathlib import Path
import re
import sys
import threading
from typing import TextIO

_MAX_BYTES = 5 * 1024 * 1024
_SECRET_PATTERNS = (
    re.compile(r"(?i)(authorization\s*[:=]\s*bearer\s+)[A-Za-z0-9._~+/=-]+"),
    re.compile(r"(?i)([\"']?(?:access_token|refresh_token|id_token|api_key|password|secret)[\"']?\s*[:=]\s*[\"']?)[^\s,\"'}]+"),
    re.compile(r"(?i)(X-OpenDrSai-Gateway-Token\s*[:=]\s*)[A-Za-z0-9_-]+"),
)


def redact_runtime_log_text(value: object) -> str:
    text = str(value)
    for pattern in _SECRET_PATTERNS:
        text = pattern.sub(r"\1[redacted]", text)
    return text


def configure_runtime_file_logging(path: str | Path) -> TextIO:
    """Redirect stdout/stderr to a line-buffered append-only redacting sink."""

    target = Path(path).expanduser()
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and target.stat().st_size >= _MAX_BYTES:
        previous = target.with_suffix(target.suffix + ".1")
        previous.unlink(missing_ok=True)
        os.replace(target, previous)
    raw = target.open("a", encoding="utf-8", buffering=1)
    sink = _RedactingWriter(raw)
    sys.stdout = sink
    sys.stderr = sink
    return sink


class _RedactingWriter(io.TextIOBase):
    def __init__(self, raw: TextIO) -> None:
        self._raw = raw
        self._lock = threading.Lock()

    @property
    def encoding(self) -> str:
        return "utf-8"

    def writable(self) -> bool:
        return True

    def isatty(self) -> bool:
        return False

    def write(self, value: str) -> int:
        safe = redact_runtime_log_text(value)
        with self._lock:
            self._raw.write(safe)
        return len(value)

    def flush(self) -> None:
        with self._lock:
            self._raw.flush()

    def fileno(self) -> int:
        return self._raw.fileno()
