"""Curated memory — bounded MEMORY.md store.

Hermes-style persistent memory: a §-delimited file the agent (and the
desktop UI) can both read and mutate.  ``MEMORY.md`` holds the agent's own
notes (environment facts, conventions, things learned about the project).

USER.md is no longer managed here — user profile content lives directly
inside AGENTS.md, which is the single source of truth for system prompt
configuration.

Design:
- Atomic writes via tempfile + os.replace so concurrent readers always see a
  complete file.
- Cross-process locks (fcntl / msvcrt) so the desktop UI and the agent can
  mutate the same files without clobbering each other.
- Drift detection — if a writer outside the store (manual edit, sister
  session) appended free-form content that wouldn't round-trip through our
  parser, we refuse to mutate and snapshot the file to ``.bak.<ts>`` so the
  operator can recover the appended bytes.
- Frozen snapshot for the system prompt: ``load_from_disk()`` captures the
  rendered block once at session start; mid-session writes update the file
  but NOT the snapshot, preserving the prefix cache.
"""

from __future__ import annotations

import logging
import os
import re
import tempfile
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

ENTRY_DELIMITER = "\n§\n"
DEFAULT_MEMORY_CHAR_LIMIT = 2200
DEFAULT_MAX_ENTRIES = 15          # hard cap on number of entries
# When char usage reaches this fraction of the limit, old entries are
# auto-condensed to make room for new ones.
_REFRESH_THRESHOLD = 0.80
# Number of most-recent entries to keep full-length during condensation.
_KEEP_FULL_RECENT = 5
# Condensed entries are truncated to this many characters.
_CONDENSED_LEN = 120

# fcntl is Unix-only; on Windows fall back to msvcrt
try:
    import fcntl  # type: ignore[import-not-found]
except ImportError:
    fcntl = None  # type: ignore[assignment]
try:
    import msvcrt  # type: ignore[import-not-found]
except ImportError:
    msvcrt = None  # type: ignore[assignment]


# ────────────────────────────────────────────────────────────────────────────
# Threat scanning — lightweight injection / exfiltration guard for content
# that ends up in the system prompt.
# ────────────────────────────────────────────────────────────────────────────

_MEMORY_THREAT_PATTERNS: List[tuple[str, str]] = [
    (r"ignore\s+(previous|all|above|prior)\s+instructions", "prompt_injection"),
    (r"you\s+are\s+now\s+", "role_hijack"),
    (r"do\s+not\s+tell\s+the\s+user", "deception_hide"),
    (r"system\s+prompt\s+override", "sys_prompt_override"),
    (r"disregard\s+(your|all|any)\s+(instructions|rules|guidelines)", "disregard_rules"),
    (
        r"curl\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)",
        "exfil_curl",
    ),
    (
        r"wget\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)",
        "exfil_wget",
    ),
    (r"cat\s+[^\n]*(\.env|credentials|\.netrc|\.pgpass|\.npmrc|\.pypirc)", "read_secrets"),
    (r"authorized_keys", "ssh_backdoor"),
]

_INVISIBLE_CHARS = {
    "​", "‌", "‍", "⁠", "﻿",
    "‪", "‫", "‬", "‭", "‮",
}


def _scan_content(content: str) -> Optional[str]:
    """Return an error string when the content looks like an injection payload."""
    for char in _INVISIBLE_CHARS:
        if char in content:
            return (
                f"Blocked: content contains invisible unicode U+{ord(char):04X} "
                f"(possible injection)."
            )
    for pattern, pid in _MEMORY_THREAT_PATTERNS:
        if re.search(pattern, content, re.IGNORECASE):
            return (
                f"Blocked: content matches threat pattern '{pid}'. "
                f"Memory entries are injected into the system prompt and must not "
                f"contain injection or exfiltration payloads."
            )
    return None


# ────────────────────────────────────────────────────────────────────────────
# Store
# ────────────────────────────────────────────────────────────────────────────


class CuratedMemoryStore:
    """Single-file curated memory (MEMORY.md) with bounded §-delimited entries.

    USER.md is no longer managed by this store.  User profile content is
    embedded directly in AGENTS.md, which is the unified system-prompt file
    managed by ``UserProfileManager``.

    Args:
        memory_path: Path to MEMORY.md.
        memory_char_limit: Whole-file char budget for MEMORY.md.
    """

    def __init__(
        self,
        memory_path: Path,
        memory_char_limit: int = DEFAULT_MEMORY_CHAR_LIMIT,
        max_entries: int = DEFAULT_MAX_ENTRIES,
    ) -> None:
        self.memory_path = Path(memory_path)
        self.memory_char_limit = memory_char_limit
        self.max_entries = max_entries

        self.memory_entries: List[str] = []
        self._system_prompt_snapshot: str = ""

    # ── load / snapshot ────────────────────────────────────────────────

    def load_from_disk(self) -> None:
        """Read MEMORY.md into entries; capture frozen system-prompt snapshot."""
        self.memory_path.parent.mkdir(parents=True, exist_ok=True)
        self.memory_entries = list(dict.fromkeys(self._read_entries(self.memory_path)))
        self._system_prompt_snapshot = self._render_memory_block(self.memory_entries)

    def system_prompt_block(self) -> str:
        """Return the frozen MEMORY block for system-prompt injection.

        Only MEMORY entries are returned.  User profile is part of AGENTS.md
        and is injected separately by the agent.
        """
        if self._system_prompt_snapshot.strip():
            return "## MEMORY (agent notes)\n" + self._system_prompt_snapshot
        return ""

    def get_display_block(self) -> str:
        """Return a human-readable rendering of MEMORY.md for TUI display."""
        entries = self._read_entries(self.memory_path)
        return self._render_memory_block(entries)

    def get_display_summary(self) -> str:
        """Return a compact one-line summary for TUI startup banner.

        Shows the file path (shortened with ``~``) and entry count, e.g.::

            ~/.drsai/workspace/runs/xiongdb/configs/MEMORY.md (2/15 entries)

        This avoids flooding the terminal with full MEMORY.md content on
        every startup.  Users can open the file directly to see details.
        """
        entries = self._read_entries(self.memory_path)
        n = len(entries)
        if n == 0:
            return ""
        path_str = str(self.memory_path)
        home = str(Path.home())
        if path_str.startswith(home):
            path_str = "~" + path_str[len(home):]
        return f"{path_str} ({n}/{self.max_entries} entries)"

    @staticmethod
    def _render_memory_block(entries: List[str]) -> str:
        """Render entries as a clean, numbered list with separators.

        Used both for system-prompt injection and TUI display.  Each entry
        is prefixed with ``[N]`` (1-based index) and entries are separated
        by a blank line for readability.
        """
        if not entries:
            return ""
        lines = []
        for i, e in enumerate(entries, 1):
            # Indent multi-line entries for visual continuity
            formatted = e.replace("\n", "\n  ")
            lines.append(f"[{i}] {formatted}")
        return "\n\n".join(lines)

    # ── public API: MEMORY.md entries ──────────────────────────────────

    def list_entries(self) -> List[Dict[str, Any]]:
        """Return current MEMORY.md entries as ``[{index, content}, ...]``."""
        # Refresh from disk so the UI sees what other writers (LLM tool) added.
        entries = self._read_entries(self.memory_path)
        return [{"index": i, "content": e} for i, e in enumerate(entries)]

    def add_entry(self, content: str) -> Dict[str, Any]:
        """Append a new entry to MEMORY.md.

        If the addition would exceed the char or entry-count limit, older
        entries are auto-condensed (truncated with ``…``) to make room.
        Only fails if condensation cannot free enough space.
        """
        content = (content or "").strip()
        if not content:
            return {"success": False, "error": "Content cannot be empty."}
        scan = _scan_content(content)
        if scan:
            return {"success": False, "error": scan}

        with self._file_lock(self.memory_path):
            bak = self._detect_drift(self.memory_path, self.memory_char_limit)
            if bak:
                return _drift_error(self.memory_path, bak)

            entries = list(dict.fromkeys(self._read_entries(self.memory_path)))
            if content in entries:
                return {"success": True, "noop": True, "message": "Entry already exists."}

            entries.append(content)
            # Auto-condense old entries if we're over limits
            entries = self._refresh_entries(entries)

            new_total = len(ENTRY_DELIMITER.join(entries))
            if new_total > self.memory_char_limit:
                return {
                    "success": False,
                    "error": (
                        f"Memory at {self._char_count(entries):,}/"
                        f"{self.memory_char_limit:,} chars and {len(entries)}/"
                        f"{self.max_entries} entries. Even after condensation, "
                        f"adding this entry ({len(content)} chars) exceeds the limit."
                    ),
                }

            self._write_entries(self.memory_path, entries)
            self.memory_entries = entries
            return {"success": True, "index": len(entries) - 1}

    def update_entry(self, index: int, content: str) -> Dict[str, Any]:
        """Replace MEMORY.md entry at ``index``."""
        content = (content or "").strip()
        if not content:
            return {"success": False, "error": "Content cannot be empty."}
        scan = _scan_content(content)
        if scan:
            return {"success": False, "error": scan}

        with self._file_lock(self.memory_path):
            bak = self._detect_drift(self.memory_path, self.memory_char_limit)
            if bak:
                return _drift_error(self.memory_path, bak)

            entries = self._read_entries(self.memory_path)
            if index < 0 or index >= len(entries):
                return {"success": False, "error": f"Entry index {index} not found."}

            test = entries.copy()
            test[index] = content
            new_total = len(ENTRY_DELIMITER.join(test))
            if new_total > self.memory_char_limit:
                return {
                    "success": False,
                    "error": (
                        f"Replacement would put memory at {new_total:,}/"
                        f"{self.memory_char_limit:,} chars."
                    ),
                }

            entries[index] = content
            self._write_entries(self.memory_path, entries)
            self.memory_entries = entries
            return {"success": True}

    def remove_entry(self, index: int) -> Dict[str, Any]:
        """Delete MEMORY.md entry at ``index``."""
        with self._file_lock(self.memory_path):
            bak = self._detect_drift(self.memory_path, self.memory_char_limit)
            if bak:
                return _drift_error(self.memory_path, bak)

            entries = self._read_entries(self.memory_path)
            if index < 0 or index >= len(entries):
                return {"success": False, "error": f"Entry index {index} not found."}
            entries.pop(index)
            self._write_entries(self.memory_path, entries)
            self.memory_entries = entries
            return {"success": True}

    def replace_by_text(self, old_text: str, new_content: str) -> Dict[str, Any]:
        """Hermes-style substring replace — used by the LLM tool surface."""
        old_text = (old_text or "").strip()
        new_content = (new_content or "").strip()
        if not old_text:
            return {"success": False, "error": "old_text cannot be empty."}
        if not new_content:
            return {
                "success": False,
                "error": "new_content cannot be empty. Use remove to delete entries.",
            }
        scan = _scan_content(new_content)
        if scan:
            return {"success": False, "error": scan}

        with self._file_lock(self.memory_path):
            bak = self._detect_drift(self.memory_path, self.memory_char_limit)
            if bak:
                return _drift_error(self.memory_path, bak)

            entries = self._read_entries(self.memory_path)
            matches = [(i, e) for i, e in enumerate(entries) if old_text in e]
            if not matches:
                return {"success": False, "error": f"No entry matched '{old_text}'."}
            if len(matches) > 1 and len({e for _, e in matches}) > 1:
                previews = [e[:80] + ("..." if len(e) > 80 else "") for _, e in matches]
                return {
                    "success": False,
                    "error": f"Multiple entries matched '{old_text}'. Be more specific.",
                    "matches": previews,
                }

            idx = matches[0][0]
            test = entries.copy()
            test[idx] = new_content
            new_total = len(ENTRY_DELIMITER.join(test))
            if new_total > self.memory_char_limit:
                return {
                    "success": False,
                    "error": (
                        f"Replacement would put memory at {new_total:,}/"
                        f"{self.memory_char_limit:,} chars."
                    ),
                }
            entries[idx] = new_content
            # Auto-condense if replacement pushed us over limits
            entries = self._refresh_entries(entries)
            self._write_entries(self.memory_path, entries)
            self.memory_entries = entries
            return {"success": True, "index": idx}

    def remove_by_text(self, old_text: str) -> Dict[str, Any]:
        """Hermes-style substring remove."""
        old_text = (old_text or "").strip()
        if not old_text:
            return {"success": False, "error": "old_text cannot be empty."}
        with self._file_lock(self.memory_path):
            bak = self._detect_drift(self.memory_path, self.memory_char_limit)
            if bak:
                return _drift_error(self.memory_path, bak)
            entries = self._read_entries(self.memory_path)
            matches = [(i, e) for i, e in enumerate(entries) if old_text in e]
            if not matches:
                return {"success": False, "error": f"No entry matched '{old_text}'."}
            if len(matches) > 1 and len({e for _, e in matches}) > 1:
                previews = [e[:80] + ("..." if len(e) > 80 else "") for _, e in matches]
                return {
                    "success": False,
                    "error": f"Multiple entries matched '{old_text}'.",
                    "matches": previews,
                }
            idx = matches[0][0]
            entries.pop(idx)
            self._write_entries(self.memory_path, entries)
            self.memory_entries = entries
            return {"success": True}

    # ── stats ──────────────────────────────────────────────────────────

    def char_counts(self) -> Dict[str, int]:
        entries = self._read_entries(self.memory_path)
        return {"memory": self._char_count(entries)}

    def char_limits(self) -> Dict[str, int]:
        return {"memory": self.memory_char_limit}

    def entry_counts(self) -> Dict[str, int]:
        """Return current entry count and max for MEMORY.md."""
        entries = self._read_entries(self.memory_path)
        return {"memory": len(entries), "memory_max": self.max_entries}

    def last_modified(self) -> Dict[str, Optional[int]]:
        def mtime(p: Path) -> Optional[int]:
            try:
                return int(p.stat().st_mtime) if p.exists() else None
            except OSError:
                return None
        return {"memory": mtime(self.memory_path)}

    # ── internals ──────────────────────────────────────────────────────

    @staticmethod
    def _char_count(entries: List[str]) -> int:
        if not entries:
            return 0
        return len(ENTRY_DELIMITER.join(entries))

    def _refresh_entries(self, entries: List[str]) -> List[str]:
        """Condense old entries to make room within char and count limits.

        Strategy:
        1. If entry count exceeds ``max_entries``, drop the oldest entries
           beyond ``max_entries``.
        2. If char usage exceeds ``_REFRESH_THRESHOLD * char_limit``,
           condense all entries except the most recent ``_KEEP_FULL_RECENT``
           by truncating to ``_CONDENSED_LEN`` chars with a ``…`` suffix.
        3. Repeat step 2 with increasingly aggressive truncation until
           the total fits within ``char_limit``.

        Returns the condensed list (caller persists to disk).
        """
        if not entries:
            return entries

        # Step 1: enforce entry count limit
        if len(entries) > self.max_entries:
            entries = entries[-(self.max_entries):]

        # Step 2+3: condense old entries to fit char budget
        total = self._char_count(entries)
        if total <= int(self.memory_char_limit * _REFRESH_THRESHOLD):
            return entries

        keep_full = _KEEP_FULL_RECENT
        condensed_len = _CONDENSED_LEN
        for _ in range(10):  # max 10 condensation rounds
            result = []
            n = len(entries)
            for i, e in enumerate(entries):
                if i >= n - keep_full:
                    result.append(e)  # keep recent entries full
                else:
                    if len(e) > condensed_len:
                        result.append(e[:condensed_len].rstrip() + "…")
                    else:
                        result.append(e)
            total = self._char_count(result)
            if total <= self.memory_char_limit:
                entries = result
                break
            # More aggressive: reduce kept-full count and condensed length
            keep_full = max(1, keep_full - 1)
            condensed_len = max(60, condensed_len - 20)
            entries = result
        return entries

    @staticmethod
    def _read_entries(path: Path) -> List[str]:
        if not path.exists():
            return []
        try:
            raw = path.read_text(encoding="utf-8")
        except (OSError, IOError):
            return []
        if not raw.strip():
            return []
        parts = [e.strip() for e in raw.split(ENTRY_DELIMITER)]
        return [e for e in parts if e]

    @staticmethod
    def _read_text(path: Path) -> str:
        if not path.exists():
            return ""
        try:
            return path.read_text(encoding="utf-8")
        except (OSError, IOError):
            return ""

    @staticmethod
    def _write_entries(path: Path, entries: List[str]) -> None:
        content = ENTRY_DELIMITER.join(entries) if entries else ""
        CuratedMemoryStore._write_text_atomic(path, content)

    @staticmethod
    def _write_text_atomic(path: Path, content: str) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_path = tempfile.mkstemp(
            dir=str(path.parent), suffix=".tmp", prefix=".mem_"
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(content)
                f.flush()
                try:
                    os.fsync(f.fileno())
                except OSError:
                    pass
            os.replace(tmp_path, path)
        except BaseException:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise

    @staticmethod
    def _detect_drift(path: Path, char_limit: int) -> Optional[str]:
        """Return a ``.bak.<ts>`` path if on-disk content shows external drift."""
        if not path.exists():
            return None
        try:
            raw = path.read_text(encoding="utf-8")
        except (OSError, IOError):
            return None
        if not raw.strip():
            return None
        parsed = [e.strip() for e in raw.split(ENTRY_DELIMITER) if e.strip()]
        roundtrip = ENTRY_DELIMITER.join(parsed)
        max_entry_len = max((len(e) for e in parsed), default=0)
        if raw.strip() == roundtrip and max_entry_len <= char_limit:
            return None
        bak_path = path.with_suffix(path.suffix + f".bak.{int(time.time())}")
        try:
            bak_path.write_text(raw, encoding="utf-8")
        except (OSError, IOError):
            return str(bak_path) + " (BACKUP FAILED)"
        return str(bak_path)

    @staticmethod
    @contextmanager
    def _file_lock(path: Path):
        lock_path = path.with_suffix(path.suffix + ".lock")
        lock_path.parent.mkdir(parents=True, exist_ok=True)
        if fcntl is None and msvcrt is None:
            yield
            return
        fd = open(lock_path, "a+", encoding="utf-8")
        try:
            if fcntl is not None:
                fcntl.flock(fd, fcntl.LOCK_EX)
            elif msvcrt is not None:
                fd.seek(0)
                msvcrt.locking(fd.fileno(), msvcrt.LK_LOCK, 1)
            yield
        finally:
            try:
                if fcntl is not None:
                    fcntl.flock(fd, fcntl.LOCK_UN)
                elif msvcrt is not None:
                    fd.seek(0)
                    msvcrt.locking(fd.fileno(), msvcrt.LK_UNLCK, 1)
            except (OSError, IOError):
                pass
            fd.close()


def _drift_error(path: Path, bak_path: str) -> Dict[str, Any]:
    return {
        "success": False,
        "error": (
            f"Refusing to write {path.name}: file on disk has content that "
            f"wouldn't round-trip through CuratedMemoryStore (likely added by a "
            f"manual edit, shell append, or concurrent session). A snapshot was "
            f"saved to {bak_path}. Resolve the drift first."
        ),
        "drift_backup": bak_path,
    }
