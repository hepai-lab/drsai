"""UIFormatter — unified output API for DrSai desktop app commands.

Replaces the previous pattern of scattered `self._chat_window.append_text(...)`
calls with inconsistent message styles (some using "error" tag, some using
"❌" prefix, some using "⚠" prefix).  All command output now goes through
UIFormatter's standardized methods.

Usage in command implementations:
    ctx.ui.info("Configuration saved!")
    ctx.ui.error("API Key cannot be empty")
    ctx.ui.section_end()
"""

from __future__ import annotations

from typing import Optional

# ── Standard separator ────────────────────────────────────────────────────
SEPARATOR = "──────────────────────────────────────────────\n"


class UIFormatter:
    """Unified output formatting for command results in the GUI chat window.

    Wraps a DrSaiChatWindow instance and provides standardized output
    methods with consistent styling and message prefixes.
    """

    def __init__(self, chat_window) -> None:
        self._cw = chat_window

    # ── Core output methods ─────────────────────────────────────────────────

    def raw(self, text: str, tag: str = "system") -> None:
        """Output text with a specific tag (no prefix added)."""
        self._cw.append_text(text, tag)

    def info(self, text: str) -> None:
        """Normal informational output (system tag, no prefix)."""
        self._cw.append_text(text, "system")

    def error(self, text: str) -> None:
        """Error output with ❌ prefix (error tag)."""
        self._cw.append_text(f"❌ {text}", "error")

    def warn(self, text: str) -> None:
        """Warning output with ⚠ prefix (system tag)."""
        self._cw.append_text(f"⚠ {text}", "system")

    def success(self, text: str) -> None:
        """Success output with ✅ prefix (system tag)."""
        self._cw.append_text(f"✅ {text}", "system")

    def hint(self, text: str) -> None:
        """Hint/tip output with 💡 prefix (system tag)."""
        self._cw.append_text(f"💡 {text}", "system")

    def section_end(self) -> None:
        """Output the standard section separator line."""
        self._cw.append_text(SEPARATOR, "separator")

    def blank(self) -> None:
        """Output a blank line for spacing."""
        self._cw.append_text("\n", "system")

    # ── Convenience compound methods ────────────────────────────────────────

    def result(self, success_msg: str, error_msg: str, ok: bool) -> None:
        """Output a success or error message based on result, then separator."""
        if ok:
            self.success(success_msg)
        else:
            self.error(error_msg)
        self.section_end()

    def list_items(self, title: str, items: list[str], tag: str = "system") -> None:
        """Output a titled list of items, one per line."""
        self.info(title)
        for item in items:
            self.raw(f"  {item}\n", tag)
        self.section_end()