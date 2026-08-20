"""Process-wide secret redaction for DocMaster console and logging output."""

from __future__ import annotations

import io
import logging
import os
import re
import sys
from typing import Any, Iterable, TextIO


REDACTED = "[REDACTED]"

_LABELED_SECRET_PATTERNS = (
    re.compile(
        r"(?i)(\b(?:[a-z0-9]+_)*(?:owner_key|api[_ -]?key|secret[_ -]?key|token)\b\s*[:=]\s*[`'\"]?)([^\s,`'\"}\)]+)"
    ),
    re.compile(r"(?i)(\bAuthorization\s*:\s*Bearer\s+)([^\s,`'\"}\)]+)"),
)

_SECRET_ENV_SUFFIXES = (
    "API_KEY",
    "APIKEY",
    "SECRET_KEY",
    "ACCESS_TOKEN",
    "AUTH_TOKEN",
    "OWNER_KEY",
)


def _environment_secrets(environ: dict[str, str] | None = None) -> tuple[str, ...]:
    source = os.environ if environ is None else environ
    values = {
        value
        for name, value in source.items()
        if value
        and len(value) >= 8
        and any(name.upper().endswith(suffix) for suffix in _SECRET_ENV_SUFFIXES)
    }
    return tuple(sorted(values, key=len, reverse=True))


def redact_secrets(text: str, *, known_secrets: Iterable[str] | None = None) -> str:
    """Redact labeled credentials and exact known secret values from text."""
    redacted = text
    secrets = _environment_secrets() if known_secrets is None else tuple(known_secrets)
    for secret in sorted((item for item in secrets if len(item) >= 8), key=len, reverse=True):
        redacted = redacted.replace(secret, REDACTED)
    for pattern in _LABELED_SECRET_PATTERNS:
        redacted = pattern.sub(lambda match: f"{match.group(1)}{REDACTED}", redacted)
    return redacted


class RedactingTextIO(io.TextIOBase):
    """Transparent text stream proxy that sanitizes every write."""

    def __init__(self, stream: TextIO, known_secrets: Iterable[str]) -> None:
        self._stream = stream
        self._known_secrets = tuple(known_secrets)

    def write(self, value: str) -> int:
        sanitized = redact_secrets(value, known_secrets=self._known_secrets)
        self._stream.write(sanitized)
        return len(value)

    def flush(self) -> None:
        self._stream.flush()

    def isatty(self) -> bool:
        return self._stream.isatty()

    def fileno(self) -> int:
        return self._stream.fileno()

    @property
    def encoding(self) -> str | None:
        return self._stream.encoding

    def __getattr__(self, name: str) -> Any:
        return getattr(self._stream, name)


_installed = False
_original_record_factory: Any = None


def install_secret_redaction() -> None:
    """Install idempotent redaction for console writes and logging records."""
    global _installed, _original_record_factory
    if _installed:
        return

    known_secrets = _environment_secrets()
    sys.stdout = RedactingTextIO(sys.stdout, known_secrets)
    sys.stderr = RedactingTextIO(sys.stderr, known_secrets)

    _original_record_factory = logging.getLogRecordFactory()

    def redacting_record_factory(*args: Any, **kwargs: Any) -> logging.LogRecord:
        record = _original_record_factory(*args, **kwargs)
        # Preserve the logging message template and argument shape.  Formatters
        # such as uvicorn.logging.AccessFormatter intentionally inspect the
        # five access-log arguments after LogRecord creation; eagerly calling
        # getMessage() and clearing ``record.args`` breaks that contract.
        if isinstance(record.msg, str):
            record.msg = redact_secrets(record.msg, known_secrets=known_secrets)
        if isinstance(record.args, tuple):
            record.args = tuple(
                redact_secrets(value, known_secrets=known_secrets)
                if isinstance(value, str) else value
                for value in record.args
            )
        elif isinstance(record.args, dict):
            record.args = {
                key: (
                    redact_secrets(value, known_secrets=known_secrets)
                    if isinstance(value, str) else value
                )
                for key, value in record.args.items()
            }
        return record

    logging.setLogRecordFactory(redacting_record_factory)
    _installed = True
