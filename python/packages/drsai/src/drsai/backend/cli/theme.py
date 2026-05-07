"""Unified color theme for the DrSai CLI.

All visual elements — user echoes, assistant output borders, tool
messages, system notifications, separators, and footers — reference
constants defined here.  This replaces the ad-hoc ANSI escape codes
that were previously scattered across run_cli.py, renderer.py, and
display.py.

Two theme variants are provided:

- ``DarkTheme``  — optimised for dark-background terminals (the default)
- ``LightTheme`` — optimised for light-background terminals

The active theme can be swapped at runtime via :func:`set_theme`,
which propagates the change to Rich Console styles and prompt_toolkit
Style dicts.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from rich.color import Color
from rich.console import Console
from rich.style import Style

__all__ = [
    "CLITheme",
    "DarkTheme",
    "LightTheme",
    "get_theme",
    "set_theme",
]


# ─────────────────────────────────────────────────────────────────────────────
# Theme definition
# ─────────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class CLITheme:
    """Immutable palette — every CLI component references a named slot."""

    # ── Role colours ────────────────────────────────────────────────────────
    # Who is speaking?
    user_echo:       str = ""    # Colour for re-displaying user input after submit
    assistant_text:  str = ""    # Colour applied to streaming assistant text
    assistant_panel_border: str = ""  # Rich Panel border colour for completed messages
    assistant_panel_title:  str = ""  # Rich Panel title colour (agent name)

    # ── Tool / reasoning ────────────────────────────────────────────────────
    tool_prefix:     str = ""    # 🔧 icon + tool name colour
    tool_preview:    str = ""    # One-line preview of tool arguments
    reasoning_border: str = ""  # Reasoning-box ┌─/└─ border

    # ── System / slash-command feedback ─────────────────────────────────────
    system_info:     str = ""    # "Initializing agent…", session labels
    system_success:  str = ""    # "✓ 已连接", green confirmation
    system_warning:  str = ""    # "⚠ 中断", yellow caution
    system_error:    str = ""    # "✗ 失败", red error

    # ── Structural elements ─────────────────────────────────────────────────
    separator:       str = ""    # Turn-boundary line (between user ↔ assistant)
    footer:          str = ""    # Stats footer (● 1.2s · 3k tok)
    dim:             str = ""    # General dimmed text

    # ── Prompt-toolkit prompt bar ────────────────────────────────────────────
    prompt_bracket:  str = ""    # [ ] around session label
    prompt_label:    str = ""    # Session name inside brackets
    prompt_arrow:    str = ""    # ❯ input arrow

    # ── Notification ────────────────────────────────────────────────────────
    notify_success:  str = ""    # ✅ 定时任务成功
    notify_error:    str = ""    # ❌ 定时任务失败
    # Convenience aliases used in run_cli.py
    notify_ok:       str = ""    # Same as notify_success (✓ confirmations)
    notify_warn:     str = ""    # Same as system_warning (⚠ cautions)
    notify_info:     str = ""    # Same as system_info (ℹ informational)


# ─────────────────────────────────────────────────────────────────────────────
# Concrete themes
# ─────────────────────────────────────────────────────────────────────────────

DarkTheme = CLITheme(
    # ── Role colours ──────────────────────────────────────────────────────
    user_echo            = "#6EC6FF",          # soft cyan-blue — distinct from white
    assistant_text       = "",                 # default terminal foreground (no override)
    assistant_panel_border = "#FFD700",        # gold border (legacy, preserved)
    assistant_panel_title  = "cyan",           # cyan title (legacy, preserved)

    # ── Tool / reasoning ──────────────────────────────────────────────────
    tool_prefix          = "yellow",           # 🔧 icon
    tool_preview         = "cyan",             # tool-name + preview text
    reasoning_border     = "dim",              # ┌─/└─ border

    # ── System ────────────────────────────────────────────────────────────
    system_info          = "color(240)",       # muted grey-blue
    system_success       = "green",            # ✓ confirmations
    system_warning       = "yellow",           # ⚠ cautions
    system_error         = "red bold",         # ✗ errors

    # ── Structural ────────────────────────────────────────────────────────
    separator            = "color(236)",       # very dim ─── turn separator
    footer               = "dim",              # ● 1.2s · 3k tok
    dim                  = "dim",              # generic dim

    # ── Prompt ────────────────────────────────────────────────────────────
    prompt_bracket       = "#888888",
    prompt_label         = "#FFD700 bold",
    prompt_arrow         = "#6EC6FF bold",     # matches user_echo for visual coherence

    # ── Notification ──────────────────────────────────────────────────────
    notify_success       = "green",
    notify_error         = "red",
    notify_ok            = "green",            # alias: ✓ confirmations
    notify_warn          = "yellow",           # alias: ⚠ cautions
    notify_info          = "color(240)",       # alias: ℹ informational
)

LightTheme = CLITheme(
    # ── Role colours ──────────────────────────────────────────────────────
    user_echo            = "#005FAF",          # dark blue on white bg
    assistant_text       = "",
    assistant_panel_border = "#8B6914",        # dark gold
    assistant_panel_title  = "dark_cyan",

    # ── Tool / reasoning ──────────────────────────────────────────────────
    tool_prefix          = "dark_goldenrod",
    tool_preview         = "dark_cyan",
    reasoning_border     = "grey50",

    # ── System ────────────────────────────────────────────────────────────
    system_info          = "grey37",
    system_success       = "dark_green",
    system_warning       = "dark_goldenrod",
    system_error         = "dark_red bold",

    # ── Structural ────────────────────────────────────────────────────────
    separator            = "grey62",
    footer               = "grey37",
    dim                  = "grey37",

    # ── Prompt ────────────────────────────────────────────────────────────
    prompt_bracket       = "grey37",
    prompt_label         = "dark_goldenrod bold",
    prompt_arrow         = "#005FAF bold",

    # ── Notification ──────────────────────────────────────────────────────
    notify_success       = "dark_green",
    notify_error         = "dark_red",
    notify_ok            = "dark_green",       # alias: ✓ confirmations
    notify_warn          = "dark_goldenrod",   # alias: ⚠ cautions
    notify_info          = "grey37",           # alias: ℹ informational
)


# ─────────────────────────────────────────────────────────────────────────────
# Runtime theme selection
# ─────────────────────────────────────────────────────────────────────────────

_active_theme: CLITheme = DarkTheme


def get_theme() -> CLITheme:
    """Return the currently active CLI theme."""
    return _active_theme


def set_theme(theme: CLITheme | str | None = None) -> CLITheme:
    """Switch the active theme.

    Args:
        theme: ``"dark"`` / ``"light"`` / a ``CLITheme`` instance / ``None``
               (None → auto-detect from ``TERM_PROGRAM`` / terminal background).

    Returns:
        The newly active theme.
    """
    global _active_theme
    if theme is None:
        _active_theme = _auto_detect_theme()
    elif isinstance(theme, str):
        _active_theme = {"dark": DarkTheme, "light": LightTheme}.get(
            theme.lower(), DarkTheme
        )
    elif isinstance(theme, CLITheme):
        _active_theme = theme
    else:
        _active_theme = DarkTheme
    return _active_theme


def _auto_detect_theme() -> CLITheme:
    """Heuristic: try to detect dark vs light terminal background."""
    # iTerm2 / macOS Terminal set TERM_PROGRAM; some terminals expose
    # COLORFGBG (e.g. "15;0" → light fg on dark bg → dark theme).
    import os
    colorfgbg = os.environ.get("COLORFGBG", "")
    if ";" in colorfgbg:
        fg, bg = colorfgbg.split(";", 1)
        # Low bg number → dark background → use DarkTheme
        try:
            if int(bg) < 8:
                return DarkTheme
            else:
                return LightTheme
        except ValueError:
            pass
    # Default to DarkTheme (the vast majority of developer terminals are dark)
    return DarkTheme


# ─────────────────────────────────────────────────────────────────────────────
# Helper: convert theme slot → ANSI escape
# ─────────────────────────────────────────────────────────────────────────────

def ansi(slot: str, theme: Optional[CLITheme] = None) -> str:
    """Convert a theme slot name to a foreground ANSI escape sequence.

    Rich Style strings like ``"cyan"`` or ``"#FFD700"`` are parsed and
    converted to ``\\033[38;2;R;G;Bm`` (24-bit) or ``\\033[38;5;Nm``
    (256-colour) escape codes.

    Args:
        slot: Theme attribute name (e.g. ``"user_echo"``).
        theme: Theme to use; defaults to the active theme.

    Returns:
        ANSI foreground escape string (empty string if colour is "").
    """
    t = theme or get_theme()
    colour_spec = getattr(t, slot, "")
    if not colour_spec:
        return ""
    s = Style.parse(colour_spec)
    color = s.color
    if color is None:
        if s.dim:
            return "\033[2m"
        if s.bold:
            return "\033[1m"
        return ""
    return _color_to_ansi(color)


def ansi_reset() -> str:
    """Return the ANSI reset sequence ``\\033[0m``."""
    return "\033[0m"


def _color_to_ansi(color: Color) -> str:
    """Convert a Rich ``Color`` to an ANSI foreground escape."""
    from rich.color import ColorSystem
    if color.type == ColorSystem.STANDARD:
        # Standard 0-7 ANSI colours → use bold-bright variant (38;5;8-15)
        number = color.number + 8  # bright variant
        return f"\033[38;5;{number}m"
    elif color.type == ColorSystem.EIGHT_BIT:
        return f"\033[38;5;{color.number}m"
    elif color.type == ColorSystem.TRUECOLOR:
        r, g, b = color.triplet
        return f"\033[38;2;{r};{g};{b}m"
    return ""


# ─────────────────────────────────────────────────────────────────────────────
# Helper: convert theme → prompt_toolkit Style dict
# ─────────────────────────────────────────────────────────────────────────────

def _rich_to_prompt_toolkit_color(color_spec: str) -> str:
    """Convert a Rich color format string to prompt_toolkit-compatible format.

    prompt_toolkit only accepts:
    - Named colors from its own fixed palette (e.g. ``cyan``, ``red``, ``green``)
    - Hex codes like ``#FFD700``
    - Style modifiers like ``bold``, ``italic``, ``underline``, ``reverse``, ``dim``
    - ``bg:`` prefix for background

    Rich supports additional formats that prompt_toolkit doesn't:
    - ``color(N)`` for 256-colour palette codes
    - Extended named colors (``grey37``, ``dark_goldenrod``, etc.)

    We convert ALL Rich color specs by parsing them through ``Style.parse``
    and emitting hex codes.  Style modifiers (``bold``, etc.) are preserved
    alongside the hex color.
    """
    if not color_spec:
        return ""

    # Try to parse as a Rich Style.  If successful, convert the color to hex
    # and re-append any modifiers (bold, italic, underline, reverse).
    # If parsing fails, return the spec as-is (it may already be prompt_toolkit
    # compatible).
    try:
        s = Style.parse(color_spec)
    except Exception:
        return color_spec

    # Collect modifiers
    mods: list[str] = []
    if s.bold:
        mods.append("bold")
    if s.italic:
        mods.append("italic")
    if s.underline:
        mods.append("underline")
    if s.reverse:
        mods.append("reverse")

    # Convert color to hex
    color = s.color
    if color is not None:
        hex_color = _color_to_hex(color)
        parts = [hex_color] + mods
        return " ".join(parts)
    elif s.dim and not mods:
        # "dim" alone — prompt_toolkit treats this as no-color + dim modifier
        return "dim"
    else:
        # No color, only modifiers
        return " ".join(mods)


def _color_to_hex(color: Color) -> str:
    """Convert a Rich ``Color`` to ``#RRGGBB`` hex format.

    Used by ``_rich_to_prompt_toolkit_color`` to produce output that
    prompt_toolkit can parse regardless of the original Rich colour type.
    """
    from rich.color import ColorSystem

    if color.type == ColorSystem.TRUECOLOR:
        r, g, b = color.triplet
        return f"#{r:02x}{g:02x}{b:02x}"
    elif color.type == ColorSystem.EIGHT_BIT:
        # 256-colour: convert by requesting the true-color representation
        tc = color.get_truecolor()
        if tc is not None:
            r, g, b = tc
            return f"#{r:02x}{g:02x}{b:02x}"
        # Fallback: use ANSI 256 → approximated RGB
        return _ansi256_to_hex(color.number)
    elif color.type == ColorSystem.STANDARD:
        # Standard 0-7 ANSI colours → convert to truecolor
        tc = color.get_truecolor()
        if tc is not None:
            r, g, b = tc
            return f"#{r:02x}{g:02x}{b:02x}"
        return _ansi256_to_hex(color.number)
    return "#ffffff"


def _ansi256_to_hex(n: int) -> str:
    """Convert an 256-color palette index to ``#RRGGBB`` hex.

    Covers:
    - 0-7:   Standard ANSI colours (mapped to bright variants 8-15)
    - 8-15:  Bright ANSI colours
    - 16-231: 6×6×6 colour cube
    - 232-255: 24-step greyscale ramp
    """
    if n < 16:
        # Standard + bright ANSI — approximate with common values
        _ANSI_16_HEX = [
            "#000000", "#800000", "#008000", "#808000",
            "#000080", "#800080", "#008080", "#c0c0c0",
            "#808080", "#ff0000", "#00ff00", "#ffff00",
            "#0000ff", "#ff00ff", "#00ffff", "#ffffff",
        ]
        return _ANSI_16_HEX[n]
    elif 16 <= n <= 231:
        # 6×6×6 colour cube
        n -= 16
        b_idx = n % 6
        g_idx = (n // 6) % 6
        r_idx = n // 36
        _CUBE = [0, 0x5f, 0x87, 0xaf, 0xd7, 0xff]
        r, g, b = _CUBE[r_idx], _CUBE[g_idx], _CUBE[b_idx]
        return f"#{r:02x}{g:02x}{b:02x}"
    else:
        # 232-255: greyscale ramp
        level = (n - 232) * 10 + 8
        return f"#{level:02x}{level:02x}{level:02x}"


def prompt_toolkit_style(theme: Optional[CLITheme] = None) -> dict:
    """Return a ``prompt_toolkit.styles.Style.from_dict`` dict for the given theme."""
    t = theme or get_theme()
    return {
        # Default input text colour — what the user types in the prompt
        "":                _rich_to_prompt_toolkit_color(t.user_echo),
        "prompt.bracket":  _rich_to_prompt_toolkit_color(t.prompt_bracket),
        "prompt.label":    _rich_to_prompt_toolkit_color(t.prompt_label),
        "prompt.arrow":    _rich_to_prompt_toolkit_color(t.prompt_arrow),
        "bottom-toolbar":  f"bg:#222222 {_rich_to_prompt_toolkit_color(t.system_info)}",
        # Interactive prompt colours (Hermes-style)
        "interactive.header":  _rich_to_prompt_toolkit_color(t.prompt_label),
        "interactive.choice":  _rich_to_prompt_toolkit_color(t.tool_preview),
        "interactive.selected": _rich_to_prompt_toolkit_color(t.system_success) + " bold",
    }