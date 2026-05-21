"""
DrSai TUI Display Module - Ported from Hermes-agent.

Core display functions:
- Tool preview generation (build_tool_preview)
- Inline diff rendering
- KawaiiSpinner animation
- Tool completion messages (get_cute_tool_message)

This module is intentionally I/O-only — no agent dependency.
"""

from __future__ import annotations

import logging
import os
import sys
import threading
import time
from dataclasses import dataclass, field
from difflib import unified_diff
from pathlib import Path
from typing import Callable, Optional

logger = logging.getLogger(__name__)

# ANSI escape codes
_ANSI_RESET = "\033[0m"

# =========================================================================
# Diff colors — lazy resolved from skin engine (when available)
# =========================================================================
_diff_colors_cached: dict[str, str] | None = None


def _diff_ansi() -> dict[str, str]:
    """Return ANSI escapes for diff display."""
    global _diff_colors_cached
    if _diff_colors_cached is not None:
        return _diff_colors_cached

    # Defaults that work on dark terminals
    dim = "\033[38;2;150;150;150m"
    file_c = "\033[38;2;180;160;255m"
    hunk = "\033[38;2;120;120;140m"
    minus = "\033[38;2;255;255;255;48;2;120;20;20m"
    plus = "\033[38;2;255;255;255;48;2;20;90;20m"

    _diff_colors_cached = {
        "dim": dim, "file": file_c, "hunk": hunk,
        "minus": minus, "plus": plus,
    }
    return _diff_colors_cached


def _diff_dim():   return _diff_ansi()["dim"]
def _diff_file():  return _diff_ansi()["file"]
def _diff_hunk():  return _diff_ansi()["hunk"]
def _diff_minus(): return _diff_ansi()["minus"]
def _diff_plus():  return _diff_ansi()["plus"]

_MAX_INLINE_DIFF_FILES = 6
_MAX_INLINE_DIFF_LINES = 80


# =========================================================================
# Configurable tool preview length (0 = no limit)
# =========================================================================
_tool_preview_max_len: int = 0


def set_tool_preview_max_len(n: int) -> None:
    """Set the global max length for tool call previews. 0 = no limit."""
    global _tool_preview_max_len
    _tool_preview_max_len = max(int(n), 0) if n else 0


def get_tool_preview_max_len() -> int:
    """Return the configured max preview length (0 = unlimited)."""
    return _tool_preview_max_len


# =========================================================================
# Safe JSON loader helper
# =========================================================================
def _safe_json_loads(s: str | None) -> dict | list | None:
    """Safely parse JSON string, return None on failure."""
    if not s:
        return None
    try:
        import json
        return json.loads(s)
    except (json.JSONDecodeError, TypeError):
        return None


# =========================================================================
# Local edit snapshot for diff rendering
# =========================================================================
@dataclass
class LocalEditSnapshot:
    """Pre-tool filesystem snapshot used to render diffs locally after writes."""
    paths: list[Path] = field(default_factory=list)
    before: dict[str, str | None] = field(default_factory=dict)


# =========================================================================
# Tool preview (one-line summary of a tool call's primary argument)
# =========================================================================

def _oneline(text: str) -> str:
    """Collapse whitespace (including newlines) to single spaces."""
    return " ".join(text.split())


def build_tool_preview(tool_name: str, args: dict, max_len: int | None = None) -> str | None:
    """Build a short preview of a tool call's primary argument for display.

    Args:
        tool_name: Name of the tool being called
        args: Dictionary of tool arguments (or JSON string)
        max_len: Truncation limit (None = use global setting, 0 = no limit)

    Returns:
        A short preview string, or None if no preview available
    """
    if max_len is None:
        max_len = _tool_preview_max_len

    # Handle JSON string arguments
    if isinstance(args, str):
        args = _safe_json_loads(args)
        if args is None:
            return None

    if not args or not isinstance(args, dict):
        return None

    # Map tool names to their primary argument key
    primary_args = {
        "run_bash": "cmd", "terminal": "command", "web_search": "query", "web_extract": "urls",
        "read_file": "path", "write_file": "path", "patch": "path",
        "search_files": "pattern", "browser_navigate": "url",
        "browser_click": "ref", "browser_type": "text",
        "image_generate": "prompt", "text_to_speech": "text",
        "vision_analyze": "question", "mixture_of_agents": "user_prompt",
        "skill_view": "name", "skills_list": "category",
        "cronjob": "action",
        "execute_code": "code", "delegate_task": "goal",
        "clarify": "question", "skill_manage": "name",
    }

    # Special handling for specific tools
    if tool_name == "process":
        action = args.get("action", "")
        sid = args.get("session_id", "")
        data = args.get("data", "")
        timeout_val = args.get("timeout")
        parts = [action]
        if sid:
            parts.append(sid[:16])
        if data:
            parts.append(f'"{_oneline(data[:20])}"')
        if timeout_val and action == "wait":
            parts.append(f"{timeout_val}s")
        return " ".join(parts) if parts else None

    if tool_name == "todo":
        todos_arg = args.get("todos")
        merge = args.get("merge", False)
        if todos_arg is None:
            return "reading task list"
        elif merge:
            return f"updating {len(todos_arg)} task(s)"
        else:
            return f"planning {len(todos_arg)} task(s)"

    if tool_name == "session_search":
        query = _oneline(args.get("query", ""))
        return f"recall: \"{query[:25]}{'...' if len(query) > 25 else ''}\""

    if tool_name == "memory":
        action = args.get("action", "")
        target = args.get("target", "")
        if action == "add":
            content = _oneline(args.get("content", ""))
            return f"+{target}: \"{content[:25]}{'...' if len(content) > 25 else ''}\""
        elif action == "replace":
            old = _oneline(args.get("old_text") or "") or "<missing old_text>"
            return f"~{target}: \"{old[:20]}\""
        elif action == "remove":
            old = _oneline(args.get("old_text") or "") or "<missing old_text>"
            return f"-{target}: \"{old[:20]}\""
        return action

    if tool_name == "send_message":
        target = args.get("target", "?")
        msg = _oneline(args.get("message", ""))
        if len(msg) > 20:
            msg = msg[:17] + "..."
        return f"to {target}: \"{msg}\""

    # Get primary argument key
    key = primary_args.get(tool_name)
    if not key:
        for fallback_key in ("query", "text", "command", "path", "name", "prompt", "code", "goal"):
            if fallback_key in args:
                key = fallback_key
                break

    if not key or key not in args:
        return None

    value = args[key]
    if isinstance(value, list):
        value = value[0] if value else ""

    preview = _oneline(str(value))
    if not preview:
        return None
    if max_len > 0 and len(preview) > max_len:
        preview = preview[:max_len - 3] + "..."
    return preview


# =========================================================================
# Inline diff previews for write actions
# =========================================================================

def _resolved_path(path: str) -> Path:
    """Resolve a possibly-relative filesystem path against the current cwd."""
    candidate = Path(os.path.expanduser(path))
    if candidate.is_absolute():
        return candidate
    return Path.cwd() / candidate


def _snapshot_text(path: Path) -> str | None:
    """Return UTF-8 file content, or None for missing/unreadable files."""
    try:
        return path.read_text(encoding="utf-8")
    except (FileNotFoundError, IsADirectoryError, UnicodeDecodeError, OSError):
        return None


def _display_diff_path(path: Path) -> str:
    """Prefer cwd-relative paths in diffs when available."""
    try:
        return str(path.resolve().relative_to(Path.cwd().resolve()))
    except Exception:
        return str(path)


def capture_local_edit_snapshot(tool_name: str, function_args: dict | None) -> LocalEditSnapshot | None:
    """Capture before-state for local write previews."""
    if not isinstance(function_args, dict):
        return None

    paths: list[Path] = []
    if tool_name == "write_file":
        path = function_args.get("path")
        if path:
            paths = [_resolved_path(path)]
    elif tool_name == "patch":
        path = function_args.get("path")
        if path:
            paths = [_resolved_path(path)]

    if not paths:
        return None

    snapshot = LocalEditSnapshot(paths=paths)
    for path in paths:
        snapshot.before[str(path)] = _snapshot_text(path)
    return snapshot


def _result_succeeded(result: str | None) -> bool:
    """Conservatively detect whether a tool result represents success."""
    if not result:
        return False
    data = _safe_json_loads(result)
    if data is None:
        return False
    if not isinstance(data, dict):
        return False
    if data.get("error"):
        return False
    if "success" in data:
        return bool(data.get("success"))
    return True


def _diff_from_snapshot(snapshot: LocalEditSnapshot | None) -> str | None:
    """Generate unified diff text from a stored before-state and current files."""
    if not snapshot:
        return None

    chunks: list[str] = []
    for path in snapshot.paths:
        before = snapshot.before.get(str(path))
        after = _snapshot_text(path)
        if before == after:
            continue

        display_path = _display_diff_path(path)
        diff = "".join(
            unified_diff(
                [] if before is None else before.splitlines(keepends=True),
                [] if after is None else after.splitlines(keepends=True),
                fromfile=f"a/{display_path}",
                tofile=f"b/{display_path}",
            )
        )
        if diff:
            chunks.append(diff)

    if not chunks:
        return None
    return "".join(chunk if chunk.endswith("\n") else chunk + "\n" for chunk in chunks)


def _render_inline_unified_diff(diff: str) -> list[str]:
    """Render unified diff lines in Hermes' inline transcript style."""
    rendered: list[str] = []
    from_file = None
    to_file = None

    for raw_line in diff.splitlines():
        if raw_line.startswith("--- "):
            from_file = raw_line[4:].strip()
            continue
        if raw_line.startswith("+++ "):
            to_file = raw_line[4:].strip()
            if from_file or to_file:
                rendered.append(f"{_diff_file()}{from_file or 'a/?'} → {to_file or 'b/?'}{_ANSI_RESET}")
            continue
        if raw_line.startswith("@@"):
            rendered.append(f"{_diff_hunk()}{raw_line}{_ANSI_RESET}")
            continue
        if raw_line.startswith("-"):
            rendered.append(f"{_diff_minus()}{raw_line}{_ANSI_RESET}")
            continue
        if raw_line.startswith("+"):
            rendered.append(f"{_diff_plus()}{raw_line}{_ANSI_RESET}")
            continue
        if raw_line.startswith(" "):
            rendered.append(f"{_diff_dim()}{raw_line}{_ANSI_RESET}")
            continue
        if raw_line:
            rendered.append(raw_line)

    return rendered


def _split_unified_diff_sections(diff: str) -> list[str]:
    """Split a unified diff into per-file sections."""
    sections: list[list[str]] = []
    current: list[str] = []

    for line in diff.splitlines():
        if line.startswith("--- ") and current:
            sections.append(current)
            current = [line]
            continue
        current.append(line)

    if current:
        sections.append(current)

    return ["\n".join(section) for section in sections if section]


def _summarize_rendered_diff_sections(
    diff: str,
    *,
    max_files: int = _MAX_INLINE_DIFF_FILES,
    max_lines: int = _MAX_INLINE_DIFF_LINES,
) -> list[str]:
    """Render diff sections while capping file count and total line count."""
    sections = _split_unified_diff_sections(diff)
    rendered: list[str] = []
    omitted_files = 0
    omitted_lines = 0

    for idx, section in enumerate(sections):
        if idx >= max_files:
            omitted_files += 1
            omitted_lines += len(_render_inline_unified_diff(section))
            continue

        section_lines = _render_inline_unified_diff(section)
        remaining_budget = max_lines - len(rendered)
        if remaining_budget <= 0:
            omitted_lines += len(section_lines)
            omitted_files += 1
            continue

        if len(section_lines) <= remaining_budget:
            rendered.extend(section_lines)
            continue

        rendered.extend(section_lines[:remaining_budget])
        omitted_lines += len(section_lines) - remaining_budget
        omitted_files += 1 + max(0, len(sections) - idx - 1)
        for leftover in sections[idx + 1:]:
            omitted_lines += len(_render_inline_unified_diff(leftover))
        break

    if omitted_files or omitted_lines:
        summary = f"… omitted {omitted_lines} diff line(s)"
        if omitted_files:
            summary += f" across {omitted_files} additional file(s)/section(s)"
        rendered.append(f"{_diff_hunk()}{summary}{_ANSI_RESET}")

    return rendered


def render_edit_diff_with_delta(
    tool_name: str,
    result: str | None,
    *,
    function_args: dict | None = None,
    snapshot: LocalEditSnapshot | None = None,
    print_fn=None,
) -> bool:
    """Render an edit diff inline without taking over the terminal UI.

    Args:
        tool_name: Name of the tool
        result: Tool execution result
        function_args: Tool arguments dict
        snapshot: Pre-captured file snapshot
        print_fn: Optional print function (default: writes to sys.stdout)

    Returns:
        True if diff was rendered, False otherwise
    """
    if tool_name not in {"write_file", "patch"}:
        return False
    if not _result_succeeded(result):
        return False

    diff = _diff_from_snapshot(snapshot)
    if not diff:
        return False

    def _print(text: str) -> None:
        if print_fn:
            print_fn(text)
        else:
            sys.stdout.write(text + "\n")
            sys.stdout.flush()

    try:
        rendered_lines = _summarize_rendered_diff_sections(diff)
        _print("  ┊ review diff")
        for line in rendered_lines:
            _print(line)
        return True
    except Exception as exc:
        logger.debug("Could not render inline diff: %s", exc)
        return False


# =========================================================================
# KawaiiSpinner
# =========================================================================

class KawaiiSpinner:
    """Animated spinner with kawaii faces for CLI feedback during tool execution."""

    SPINNERS = {
        'dots': ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
        'bounce': ['⠁', '⠂', '⠄', '⡀', '⢀', '⠠', '⠐', '⠈'],
        'grow': ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█', '▇', '▆', '▅', '▄', '▃', '▂'],
        'arrows': ['←', '↖', '↑', '↗', '→', '↘', '↓', '↙'],
        'star': ['✶', '✷', '✸', '✹', '✺', '✹', '✸', '✷'],
        'pulse': ['◜', '◠', '◝', '◞', '◡', '◟'],
        'brain': ['🧠', '💭', '💡', '✨', '💫', '🌟', '💡', '💭'],
        'sparkle': ['⁺', '˚', '*', '✧', '✦', '✧', '*', '˚'],
    }

    KAWAII_WAITING = [
        "(｡◕‿◕｡)", "(◕‿◕✿)", "٩(◕‿◕｡)۶", "(✿◠‿◠)", "( ˘▽˘)っ",
        "♪(´ε` )", "(◕ᴗ◕✿)", "ヾ(＾∇＾)", "(≧◡≦)", "(★ω★)",
    ]

    KAWAII_THINKING = [
        "(｡•́︿•̀｡)", "(◔_◔)", "(¬‿¬)", "( •_•)>⌐■-■", "(⌐■_■)",
        "(´･_･`)", "◉_◉", "(°ロ°)", "( ˘⌣˘)♡", "ヽ(>∀<☆)☆",
    ]

    THINKING_VERBS = [
        "thinking", "contemplating", "processing", "analyzing",
        "reasoning", "computing", "considering",
    ]

    def __init__(
        self,
        message: str = "",
        spinner_type: str = 'dots',
        print_fn: Callable[[str], None] | None = None,
    ):
        """Initialize the spinner.

        Args:
            message: Message to display with the spinner
            spinner_type: Type of spinner animation (from SPINNERS)
            print_fn: Optional print function (for TUI integration)
        """
        self.message = message
        self.spinner_frames = self.SPINNERS.get(spinner_type, self.SPINNERS['dots'])
        self.running = False
        self.thread: threading.Thread | None = None
        self.frame_idx = 0
        self.start_time: float | None = None
        self.last_line_len = 0
        self._print_fn = print_fn
        # Capture stdout at creation time to handle redirect_stdout(devnull)
        self._out = sys.stdout

    def _write(self, text: str, end: str = '\n', flush: bool = False) -> None:
        """Write to the captured stdout or print_fn."""
        if self._print_fn is not None:
            try:
                self._print_fn(text + end)
            except Exception:
                pass
            return
        try:
            self._out.write(text + end)
            if flush:
                self._out.flush()
        except (ValueError, OSError):
            pass

    @property
    def _is_tty(self) -> bool:
        """Check if output is a real terminal."""
        try:
            return hasattr(self._out, 'isatty') and self._out.isatty()
        except (ValueError, OSError):
            return False

    def _is_patch_stdout_proxy(self) -> bool:
        """Return True when stdout is prompt_toolkit's StdoutProxy."""
        try:
            from prompt_toolkit.patch_stdout import StdoutProxy
            return isinstance(self._out, StdoutProxy)
        except ImportError:
            return False

    def _is_vscode_terminal(self) -> bool:
        """Return True when running inside VS Code's integrated terminal.

        VS Code's terminal doesn't correctly handle ANSI save/restore cursor
        sequences (\\0337/\\0338) — it renders them as visible characters
        instead of executing them.  On this platform we fall back to no spinner.
        """
        return os.getenv("TERM_PROGRAM", "").lower() == "vscode"

    def _animate(self) -> None:
        """Animation loop running in background thread."""
        # Non-TTY: just print once and wait
        if not self._is_tty:
            self._write(f"  [tool] {self.message}", flush=True)
            while self.running:
                time.sleep(0.5)
            return

        # Inside prompt_toolkit (patch_stdout active): use ANSI save/restore
        # cursor to anchor spinner at terminal bottom row.  StdoutProxy
        # (with raw=True) preserves ANSI escapes, and because the spinner
        # thread writes through the same self._out (captured StdoutProxy),
        # there is no stdout/stderr dual-stream race.
        # Exception: VS Code terminal does not correctly handle \\0337/\\0338
        # (it renders them as visible characters), so we fall back to no-op.
        if self._is_patch_stdout_proxy():
            if self._is_vscode_terminal():
                # VS Code: ANSI save/restore broken, show nothing during render
                while self.running:
                    time.sleep(0.5)
                return
            while self.running:
                frame = self.spinner_frames[self.frame_idx % len(self.spinner_frames)]
                elapsed = time.time() - self.start_time if self.start_time else 0
                line = f"  {frame} {self.message} ({elapsed:.1f}s)"
                # \0337 = save cursor, \033[999B = move to bottom,
                # \033[999D = move to col 0, \033[K = erase line,
                # \0338 = restore cursor
                self._write(
                    f"\0337\033[999B\033[999D\033[K{line}    \0338",
                    end='', flush=True
                )
                self.frame_idx += 1
                time.sleep(0.12)
            return

        # Normal TTY animation
        while self.running:
            if os.getenv("DURING_SPINNER_PAUSE"):
                time.sleep(0.1)
                continue
            frame = self.spinner_frames[self.frame_idx % len(self.spinner_frames)]
            elapsed = time.time() - self.start_time if self.start_time else 0
            line = f"  {frame} {self.message} ({elapsed:.1f}s)"
            pad = max(self.last_line_len - len(line), 0)
            self._write(f"\r{line}{' ' * pad}", end='', flush=True)
            self.last_line_len = len(line)
            self.frame_idx += 1
            time.sleep(0.12)

    def start(self) -> None:
        """Start the spinner animation."""
        if self.running:
            return
        self.running = True
        self.start_time = time.time()
        self.thread = threading.Thread(target=self._animate, daemon=True)
        self.thread.start()

    def update_text(self, new_message: str) -> None:
        """Update the message while spinning."""
        self.message = new_message

    def print_above(self, text: str) -> None:
        """Print a line above the spinner without disrupting animation."""
        if not self.running:
            self._write(f"  {text}", flush=True)
            return
        blanks = ' ' * max(self.last_line_len + 5, 40)
        self._write(f"\r{blanks}\r  {text}", flush=True)

    def stop(self, final_message: str | None = None) -> None:
        """Stop the spinner and optionally print a final message."""
        self.running = False
        if self.thread:
            self.thread.join(timeout=0.5)

        in_proxy = self._is_patch_stdout_proxy()
        is_vscode = self._is_vscode_terminal()
        is_tty = self._is_tty

        if in_proxy:
            if is_vscode:
                pass  # spinner was hidden, nothing to clear
            else:
                # Clear the bottom-anchored spinner row via same ANSI mechanism
                self._write("\0337\033[999B\033[999D\033[K\0338", end='', flush=True)
        elif is_tty:
            blanks = ' ' * max(self.last_line_len + 5, 40)
            self._write(f"\r{blanks}\r", end='', flush=True)

        if final_message:
            elapsed = f" ({time.time() - self.start_time:.1f}s)" if self.start_time else ""
            if in_proxy or is_tty:
                self._write(f"  {final_message}", flush=True)
            else:
                self._write(f"  [done] {final_message}{elapsed}", flush=True)

    def __enter__(self) -> "KawaiiSpinner":
        self.start()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> bool:
        self.stop()
        return False


# =========================================================================
# Cute tool message (completion line that replaces the spinner)
# =========================================================================

def _detect_tool_failure(tool_name: str, result: str | None) -> tuple[bool, str]:
    """Inspect a tool result string for signs of failure.

    Returns (is_failure, suffix) where suffix is an informational tag
    like " [exit 1]" for terminal failures, or " [error]" for generic failures.
    """
    if result is None:
        return False, ""

    # Terminal-specific: check for common error patterns
    if tool_name == "terminal":
        # Try JSON format first
        data = _safe_json_loads(result)
        if isinstance(data, dict):
            exit_code = data.get("exit_code")
            if exit_code is not None and exit_code != 0:
                return True, f" [exit {exit_code}]"
        
        # Check common terminal error patterns
        result_lower = result.lower()
        error_patterns = [
            "no such file",
            "permission denied",
            "cannot access",
            "command not found",
            "error:",
            "failed:",
            "exit code",
            "non-zero",
        ]
        for pattern in error_patterns:
            if pattern in result_lower:
                return True, " [error]"
        
        # Check for is_error field in result
        if '"is_error": true' in result_lower or '"is_error":true' in result_lower:
            return True, " [error]"
        
        return False, ""

    # Generic heuristic for other tools
    lower = result[:500].lower()
    if '"error"' in lower or '"failed"' in lower:
        return True, " [error]"
    if "error" in lower and any(x in lower for x in [":", " - ", "!"]):
        return True, " [error]"

    return False, ""


def get_cute_tool_message(
    tool_name: str,
    args: dict,
    duration: float,
    result: str | None = None,
) -> str:
    """Generate a formatted tool completion line for CLI.

    Format: ``┊ {emoji} {verb:9} {detail}  {duration}`` (compact, single-line).

    Args:
        tool_name: Name of the tool
        args: Tool arguments dict
        duration: Execution duration in seconds
        result: Optional result for failure detection

    Returns:
        Formatted completion line string
    """
    dur = f"{duration:.1f}s"
    is_failure, failure_suffix = _detect_tool_failure(tool_name, result)

    def _trunc(s: str, n: int = 40) -> str:
        s = str(s)
        if _tool_preview_max_len == 0:
            return s
        return (s[:n-3] + "...") if len(s) > n else s

    def _path(p: str, n: int = 35) -> str:
        p = str(p)
        if _tool_preview_max_len == 0:
            return p
        return ("..." + p[-(n-3):]) if len(p) > n else p

    def _wrap(line: str) -> str:
        """Apply failure suffix."""
        if not is_failure:
            return line
        return f"{line}{failure_suffix}"

    # Tool-specific formatting
    if tool_name == "web_search":
        return _wrap(f"┊ 🔍 search    {_trunc(args.get('query', ''), 42)}  {dur}")
    if tool_name == "run_bash":
        # DrSai uses run_bash instead of terminal
        cmd = args.get('cmd', args.get('command', ''))
        return _wrap(f"┊ 💻 $         {_trunc(cmd, 42)}  {dur}")
    if tool_name == "terminal":
        return _wrap(f"┊ 💻 $         {_trunc(args.get('command', ''), 42)}  {dur}")
    if tool_name == "web_extract":
        urls = args.get("urls", [])
        if urls:
            url = urls[0] if isinstance(urls, list) else str(urls)
            domain = url.replace("https://", "").replace("http://", "").split("/")[0]
            extra = f" +{len(urls)-1}" if len(urls) > 1 else ""
            return _wrap(f"┊ 📄 fetch     {_trunc(domain, 35)}{extra}  {dur}")
        return _wrap(f"┊ 📄 fetch     pages  {dur}")
    if tool_name == "read_file":
        return _wrap(f"┊ 📖 read      {_path(args.get('path', ''))}  {dur}")
    if tool_name == "write_file":
        return _wrap(f"┊ ✍️  write     {_path(args.get('path', ''))}  {dur}")
    if tool_name == "patch":
        return _wrap(f"┊ 🔧 patch     {_path(args.get('path', ''))}  {dur}")
    if tool_name == "search_files":
        pattern = _trunc(args.get("pattern", ""), 35)
        target = args.get("target", "content")
        verb = "find" if target == "files" else "grep"
        return _wrap(f"┊ 🔎 {verb:9} {pattern}  {dur}")
    if tool_name == "browser_navigate":
        url = args.get("url", "")
        domain = url.replace("https://", "").replace("http://", "").split("/")[0]
        return _wrap(f"┊ 🌐 navigate  {_trunc(domain, 35)}  {dur}")
    if tool_name == "todo":
        todos_arg = args.get("todos")
        merge = args.get("merge", False)
        if todos_arg is None:
            return _wrap(f"┊ 📋 plan      reading tasks  {dur}")
        elif merge:
            return _wrap(f"┊ 📋 plan      update {len(todos_arg)} task(s)  {dur}")
        else:
            return _wrap(f"┊ 📋 plan      {len(todos_arg)} task(s)  {dur}")
    if tool_name == "session_search":
        return _wrap(f"┊ 🔍 recall    \"{_trunc(args.get('query', ''), 35)}\"  {dur}")
    if tool_name == "memory":
        action = args.get("action", "?")
        target = args.get("target", "")
        if action == "add":
            return _wrap(f"┊ 🧠 memory    +{target}: \"{_trunc(args.get('content', ''), 30)}\"  {dur}")
        elif action == "replace":
            old = args.get("old_text") or ""
            old = old if old else "<missing old_text>"
            return _wrap(f"┊ 🧠 memory    ~{target}: \"{_trunc(old, 20)}\"  {dur}")
        elif action == "remove":
            old = args.get("old_text") or ""
            old = old if old else "<missing old_text>"
            return _wrap(f"┊ 🧠 memory    -{target}: \"{_trunc(old, 20)}\"  {dur}")
        return _wrap(f"┊ 🧠 memory    {action}  {dur}")
    if tool_name == "skills_list":
        return _wrap(f"┊ 📚 skills    list {args.get('category', 'all')}  {dur}")
    if tool_name == "skill_view":
        return _wrap(f"┊ 📚 skill     {_trunc(args.get('name', ''), 30)}  {dur}")
    if tool_name == "image_generate":
        return _wrap(f"┊ 🎨 create    {_trunc(args.get('prompt', ''), 35)}  {dur}")
    if tool_name == "vision_analyze":
        return _wrap(f"┊ 👁️  vision    {_trunc(args.get('question', ''), 30)}  {dur}")
    if tool_name == "execute_code":
        code = args.get("code", "")
        first_line = code.strip().split("\n")[0] if code.strip() else ""
        return _wrap(f"┊ 🐍 exec      {_trunc(first_line, 35)}  {dur}")
    if tool_name == "delegate_task":
        tasks = args.get("tasks")
        if tasks and isinstance(tasks, list):
            return _wrap(f"┊ 🔀 delegate  {len(tasks)} parallel tasks  {dur}")
        return _wrap(f"┊ 🔀 delegate  {_trunc(args.get('goal', ''), 35)}  {dur}")

    # Generic fallback
    preview = build_tool_preview(tool_name, args) or ""
    return _wrap(f"┊ ⚡ {tool_name[:9]:9} {_trunc(preview, 35)}  {dur}")


# =========================================================================
# Tool prefix (configurable, like Hermes' skin system)
# =========================================================================
_tool_prefix = "┊"


def get_tool_prefix() -> str:
    """Get the current tool output prefix character."""
    return _tool_prefix


def set_tool_prefix(prefix: str) -> None:
    """Set the tool output prefix character."""
    global _tool_prefix
    _tool_prefix = prefix
