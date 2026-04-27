"""Prompt_toolkit-powered input for ``drsai-cli`` (hermes-inspired).

Features:

- Bottom-anchored, styled prompt line. ``Enter`` submits; ``Esc+Enter``
  (or ``Alt+Enter``) inserts a newline for multi-line messages.
- Persistent history at ``~/.drsai/configs/cli_history.txt`` (up/down arrows).
- Slash-command completion from ``COMMAND_REGISTRY`` + a dynamic hook for
  session names.
- ``Ctrl+D`` raises ``EOFError`` (quit); ``Ctrl+C`` raises ``KeyboardInterrupt``
  so the caller can decide cancel-vs-quit semantics.
- Streamed output prints above the prompt via ``patch_stdout``.

``prompt_toolkit`` is a required dep; when stdin isn't a TTY (piped / test)
we still fall back to plain ``input()`` so batch runs work.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from typing import Callable, Optional

from drsai.configs.constant import CONFIG_DIR

from .commands import COMMAND_REGISTRY

__all__ = ["DrSaiPrompt", "HAS_PROMPT_TOOLKIT"]


from prompt_toolkit import PromptSession
from prompt_toolkit.completion import Completer, Completion
from prompt_toolkit.formatted_text import FormattedText
from prompt_toolkit.history import FileHistory
from prompt_toolkit.key_binding import KeyBindings
from prompt_toolkit.patch_stdout import patch_stdout
from prompt_toolkit.styles import Style

try:
    from prompt_toolkit.cursor_shapes import CursorShape
    _CURSOR_SHAPE = CursorShape.BLOCK
except Exception:  # pragma: no cover
    _CURSOR_SHAPE = None

HAS_PROMPT_TOOLKIT = True


HISTORY_PATH = Path(CONFIG_DIR) / "cli_history.txt"


_STYLE = Style.from_dict({
    "prompt.bracket": "#888888",
    "prompt.label":   "#FFD700 bold",      # gold
    "prompt.arrow":   "#5FAFFF bold",      # cyan-ish
    "bottom-toolbar": "bg:#222222 #888888",
})


class DrSaiPrompt:
    """One instance per REPL. Call ``await prompt()`` to read a line."""

    def __init__(
        self,
        *,
        session_label_fn: Callable[[], str],
        completion_hook: Optional[Callable[[], list[str]]] = None,
        bottom_toolbar_fn: Optional[Callable[[], str]] = None,
    ) -> None:
        self._label_fn = session_label_fn
        self._completion_hook = completion_hook
        self._bottom_toolbar_fn = bottom_toolbar_fn
        self._use_toolkit = sys.stdin.isatty()
        self._session: Optional[PromptSession] = None
        if self._use_toolkit:
            self._setup_toolkit()

    def update_bottom_toolbar_fn(self, new_fn: Callable[[], str]) -> None:
        """Update the bottom toolbar function dynamically."""
        self._bottom_toolbar_fn = new_fn

    # ── prompt_toolkit setup ────────────────────────────────────────────────
    def _setup_toolkit(self) -> None:
        HISTORY_PATH.parent.mkdir(parents=True, exist_ok=True)
        completer = _SlashCompleter(
            static=[c.name for c in COMMAND_REGISTRY]
            + [alias for c in COMMAND_REGISTRY for alias in c.aliases],
            dynamic=self._completion_hook,
        )
        kb = KeyBindings()

        @kb.add("escape", "enter")
        def _(event):
            event.current_buffer.insert_text("\n")

        @kb.add("enter")
        def _(event):
            event.current_buffer.validate_and_handle()

        self._session = PromptSession(
            history=FileHistory(str(HISTORY_PATH)),
            completer=completer,
            complete_while_typing=True,
            multiline=False,
            key_bindings=kb,
            mouse_support=False,
            style=_STYLE,
            cursor=_CURSOR_SHAPE,
            enable_history_search=True,
            bottom_toolbar=self._bottom_toolbar,
        )

    def _bottom_toolbar(self):
        if self._bottom_toolbar_fn is None:
            return None
        try:
            text = self._bottom_toolbar_fn()
        except Exception:
            return None
        if not text:
            return None
        return FormattedText([("class:bottom-toolbar", f" {text} ")])

    def _prompt_fragments(self):
        label = self._label_fn()
        return FormattedText([
            ("class:prompt.bracket", "["),
            ("class:prompt.label", label),
            ("class:prompt.bracket", "] "),
            ("class:prompt.arrow", "❯ "),
        ])

    # ── Public API ──────────────────────────────────────────────────────────
    async def prompt(self) -> str:
        if self._use_toolkit and self._session is not None:
            with patch_stdout(raw=True):
                return await self._session.prompt_async(self._prompt_fragments)
        loop = asyncio.get_event_loop()
        label = self._label_fn()
        return await loop.run_in_executor(None, _blocking_input, f"[{label}] ❯ ")


def _blocking_input(prompt_text: str) -> str:
    return input(prompt_text)


# ── Completer ────────────────────────────────────────────────────────────────

class _SlashCompleter(Completer):
    def __init__(
        self,
        static: list[str],
        dynamic: Optional[Callable[[], list[str]]] = None,
    ) -> None:
        self._static = sorted(set(static))
        self._dynamic = dynamic

    def get_completions(self, document, complete_event):
        text = document.text_before_cursor
        if not text.startswith("/"):
            return
        head = text[1:]
        if " " in head:
            return
        head_lower = head.lower()
        for name in self._static:
            if name.startswith(head_lower):
                yield Completion(
                    name,
                    start_position=-len(head),
                    display=f"/{name}",
                )
        if self._dynamic:
            try:
                extras = self._dynamic() or []
            except Exception:
                extras = []
            for name in extras:
                if name.lower().startswith(head_lower):
                    yield Completion(
                        name,
                        start_position=-len(head),
                        display=f"/{name}",
                    )
