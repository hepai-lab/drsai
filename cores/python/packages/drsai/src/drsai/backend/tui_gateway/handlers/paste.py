"""Paste-related RPC handlers for the TUI.

Large pasted code/log blocks should not be rendered inline in the composer.
The frontend asks ``paste.collapse`` to persist such text to a temporary txt
file and then displays a compact file reference token instead.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

from drsai.configs.constant import FILE_DIR

from ..server import _err, _ok, method

_paste_counter = 0


def _paste_dir() -> Path:
    path = Path(FILE_DIR) / "tui_pastes"
    path.mkdir(parents=True, exist_ok=True)
    return path


@method("paste.collapse")
def _paste_collapse(rid, params: dict) -> dict:
    """Persist a large pasted text block and return a compact placeholder.

    Args:
        params: {text: str}

    Returns:
        {placeholder, path, lines, chars}
    """
    global _paste_counter

    text = params.get("text", "")
    if not isinstance(text, str) or not text:
        return _err(rid, 4004, "empty paste")

    _paste_counter += 1
    line_count = text.count("\n") + 1
    char_count = len(text)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    paste_file = _paste_dir() / f"paste_{_paste_counter}_{ts}.txt"
    paste_file.write_text(text, encoding="utf-8")

    placeholder = (
        f"[[ Pasted #{_paste_counter}: {char_count} chars, "
        f"{line_count} lines → {paste_file} ]]"
    )
    return _ok(
        rid,
        {
            "placeholder": placeholder,
            "path": str(paste_file),
            "lines": line_count,
            "chars": char_count,
        },
    )
