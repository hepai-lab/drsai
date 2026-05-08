"""tkinter chat window for DrSai desktop tray application.

A self-contained tkinter window that provides:
- ScrolledText display area with colored text tags for different content types
- Multi-line input area (Text widget) with Enter→send, Shift+Enter→newline
- Slash command support (/help, /new, /model, /quit, etc.) mirroring run_cli.py
- Thread-safe text appending via ``root.after()`` (safe from asyncio threads)
- Minimize-to-tray behavior (WM_DELETE_WINDOW → hide, not quit)
- Streaming display of agent responses (token-by-token via GUIRenderer)

Slash commands:
    /help, /h        — Show available commands
    /quit, /q        — Save and exit
    /new [name]      — Create a new session
    /model [name]    — Show or switch model
    /models          — List available models
    /reasoning on|off — Toggle reasoning display
    /clear, /cls     — Clear display
    /status          — Show agent & session status
    /info            — Show configuration details
    /copy [n]        — Copy assistant reply to clipboard
    ... (see /help for full list)
"""

from __future__ import annotations

import os
import sys
import tkinter as tk
from tkinter.scrolledtext import ScrolledText
from typing import Any, Callable, Dict, List, Optional

from loguru import logger

from drsai.backend.cli.commands import COMMAND_REGISTRY, resolve_command, format_help


# ── Color theme (Catppuccin Mocha-inspired dark theme) ─────────────────────

_THEME = {
    "bg":              "#1e1e2e",
    "fg":              "#cdd6f4",
    "input_bg":        "#313244",
    "input_fg":        "#cdd6f4",
    "button_bg":       "#89b4fa",
    "button_fg":       "#1e1e2e",
    "status_bg":       "#1e1e2e",
    "status_fg":       "#a6adc8",
    "user_color":      "#89b4fa",
    "assistant_color": "#cdd6f4",
    "reasoning_color": "#6c7086",
    "reasoning_tag_color": "#585b70",
    "tool_name_color": "#f9e2af",
    "tool_preview_color": "#6c7086",
    "tool_result_color": "#a6e3a1",
    "tool_error_color": "#f38ba8",
    "system_color":    "#fab387",
    "error_color":     "#f38ba8",
    "stats_color":     "#6c7086",
    "separator_color": "#45475a",
    "help_color":      "#a6e3a1",
}

# Font selection per platform
_FONT = ("Consolas", 11) if sys.platform == "win32" else ("Monospace", 11)
_FONT_BOLD = ("Consolas", 11, "bold") if sys.platform == "win32" else ("Monospace", 11, "bold")
_UI_FONT = ("Segoe UI", 9) if sys.platform == "win32" else ("Sans", 9)
_UI_FONT_BOLD = ("Segoe UI", 10, "bold") if sys.platform == "win32" else ("Sans", 10, "bold")


class DrSaiChatWindow(tk.Tk):
    """tkinter-based chat window for DrSai agent conversation.

    Supports slash commands from COMMAND_REGISTRY, mirroring run_cli.py.
    Commands starting with ``/`` are dispatched to ``on_command_fn``;
    normal text is sent to ``send_message_fn`` for agent interaction.
    """

    def __init__(
        self,
        *,
        send_message_fn: Callable[[str], None],
        on_command_fn: Callable[[str, str], bool],
        on_minimize_fn: Optional[Callable[[], None]] = None,
        on_quit_fn: Optional[Callable[[], None]] = None,
        on_interrupt_fn: Optional[Callable[[], None]] = None,
        title: str = "DrSai Chat",
        geometry: str = "800x600",
    ) -> None:
        """
        Args:
            send_message_fn: Called when user submits a non-command message.
            on_command_fn: Called when user submits a slash command.
                           Receives (command_name, args). Returns True if
                           the command was handled (no agent chat needed).
            on_minimize_fn: Called when window is minimized to tray.
            on_quit_fn: Called when user quits (Ctrl+Q or /quit).
            on_interrupt_fn: Called when user interrupts chat (Escape or Stop button).
        """
        super().__init__()

        self._send_message_fn = send_message_fn
        self._on_command_fn = on_command_fn
        self._on_minimize_fn = on_minimize_fn
        self._on_quit_fn = on_quit_fn
        self._on_interrupt_fn = on_interrupt_fn
        self._is_chatting = False
        self._input_history: list[str] = []
        self._history_index = -1
        self._current_input = ""

        # Destroyed flag (prevents callbacks after window destruction)
        self._destroyed = False

        # ── Window setup ────────────────────────────────────────────────────
        self.title(title)
        self.geometry(geometry)
        self.configure(bg=_THEME["bg"])
        self.minsize(600, 400)

        # Center on screen
        self.update_idletasks()
        w = self.winfo_width()
        h = self.winfo_height()
        x = (self.winfo_screenwidth() - w) // 2
        y = (self.winfo_screenheight() - h) // 2
        self.geometry(f"+{x}+{y}")

        # Close button → minimize to tray
        self.protocol("WM_DELETE_WINDOW", self._on_minimize)

        # ── Build widgets ───────────────────────────────────────────────────
        self._build_widgets()

        # ── Key bindings ────────────────────────────────────────────────────
        self.bind("<Control-q>", lambda e: self._on_quit_fn() if self._on_quit_fn else self.destroy())
        # Escape → interrupt current chat (like Ctrl+C in CLI)
        self.bind("<Escape>", lambda e: self._on_interrupt_chat_key(e))

        # ── Welcome message ─────────────────────────────────────────────────
        self.append_text("🤖 DrSai Chat — 系统托盘桌面版\n", "system")
        self.append_text("Enter 发送，Shift+Enter 换行，Escape/⏹ 中断回复，Ctrl+Q 退出。\n", "system")
        self.append_text("⚠ 关闭窗口 → 最小化到托盘；双击/右键托盘图标恢复。\n", "system")
        self.append_text("输入 /help 或 /h 查看所有命令。\n\n", "system")

    # ── Widget construction ─────────────────────────────────────────────────

    def _build_widgets(self) -> None:
        # ── Display area ────────────────────────────────────────────────────
        self._display_frame = tk.Frame(self, bg=_THEME["bg"])
        self._display_frame.pack(fill=tk.BOTH, expand=True, padx=8, pady=(8, 4))

        self.chat_display = ScrolledText(
            self._display_frame,
            wrap=tk.WORD,
            state="disabled",
            bg=_THEME["bg"],
            fg=_THEME["fg"],
            insertbackground=_THEME["fg"],
            selectbackground=_THEME["input_bg"],
            font=_FONT,
            relief=tk.FLAT,
            borderwidth=0,
            padx=8,
            pady=8,
        )
        self.chat_display.pack(fill=tk.BOTH, expand=True)
        self._configure_tags()

        # ── Status bar ──────────────────────────────────────────────────────
        self._status_frame = tk.Frame(self, bg=_THEME["status_bg"])
        self._status_frame.pack(fill=tk.X, padx=8, pady=(0, 4))

        # Left: persistent session/model info
        self.status_info_label = tk.Label(
            self._status_frame,
            text="",
            bg=_THEME["status_bg"],
            fg=_THEME["status_fg"],
            font=_UI_FONT,
            anchor=tk.W,
        )
        self.status_info_label.pack(side=tk.LEFT, fill=tk.X, expand=True)

        # Right: transient state ("就绪" / "思考中...")
        self.status_label = tk.Label(
            self._status_frame,
            text="就绪",
            bg=_THEME["status_bg"],
            fg=_THEME["status_fg"],
            font=_UI_FONT,
            anchor=tk.E,
        )
        self.status_label.pack(side=tk.RIGHT)

        # ── Input area (Text widget for multi-line) ─────────────────────────
        self._input_frame = tk.Frame(self, bg=_THEME["bg"])
        self._input_frame.pack(fill=tk.X, padx=8, pady=(0, 8))

        self.input_box = tk.Text(
            self._input_frame,
            bg=_THEME["input_bg"],
            fg=_THEME["input_fg"],
            insertbackground=_THEME["input_fg"],
            selectbackground=_THEME["button_bg"],
            font=_FONT,
            relief=tk.FLAT,
            borderwidth=0,
            height=2,           # 2 lines default, auto-expands
            wrap=tk.WORD,
            padx=6,
            pady=4,
        )
        self.input_box.pack(side=tk.LEFT, fill=tk.X, expand=True)

        # Key bindings on input
        self.input_box.bind("<Return>", self._on_return)
        self.input_box.bind("<Shift-Return>", lambda e: None)  # default newline
        self.input_box.bind("<Up>", self._on_history_up)
        self.input_box.bind("<Down>", self._on_history_down)

        self.send_btn = tk.Button(
            self._input_frame,
            text="发送",
            bg=_THEME["button_bg"],
            fg=_THEME["button_fg"],
            font=_UI_FONT_BOLD,
            relief=tk.FLAT,
            borderwidth=0,
            padx=16,
            pady=4,
            command=self._on_send_click,
            activebackground="#74c7ec",
            activeforeground=_THEME["button_fg"],
        )
        self.send_btn.pack(side=tk.RIGHT, padx=(8, 0))

        # ── Stop button (shown during chat, replaces send_btn visually) ────
        self.stop_btn = tk.Button(
            self._input_frame,
            text="⏹ 停止",
            bg=_THEME["error_color"],
            fg=_THEME["fg"],
            font=_UI_FONT_BOLD,
            relief=tk.FLAT,
            borderwidth=0,
            padx=16,
            pady=4,
            command=self._on_stop_click,
            activebackground="#eba0ac",
            activeforeground=_THEME["fg"],
        )
        # Initially hidden — only shown when _is_chatting=True
        # We pack/unpack dynamically in _start_chat_turn / finish_chat_turn

    def _configure_tags(self) -> None:
        """Configure all text tags with colors from the theme."""
        tag_colors = {
            "user":         _THEME["user_color"],
            "assistant":    _THEME["assistant_color"],
            "reasoning":    _THEME["reasoning_color"],
            "reasoning_tag": _THEME["reasoning_tag_color"],
            "tool_name":    _THEME["tool_name_color"],
            "tool_preview": _THEME["tool_preview_color"],
            "tool_result":  _THEME["tool_result_color"],
            "tool_error":   _THEME["tool_error_color"],
            "system":       _THEME["system_color"],
            "error":        _THEME["error_color"],
            "stats":        _THEME["stats_color"],
            "separator":    _THEME["separator_color"],
            "help":         _THEME["help_color"],
        }
        for tag, color in tag_colors.items():
            font_cfg = {}
            if tag in ("user", "tool_name", "help"):
                font_cfg = {"font": _FONT_BOLD}
            self.chat_display.tag_configure(tag, foreground=color, **font_cfg)

    # ── Thread-safe text appending ──────────────────────────────────────────

    def append_text(self, text: str, tag: str = "assistant") -> None:
        """Append text to the display area (thread-safe via root.after)."""
        self.after(0, self._do_append_text, text, tag)

    def _do_append_text(self, text: str, tag: str) -> None:
        if self._destroyed:
            return
        try:
            self.chat_display.config(state="normal")
            self.chat_display.insert(tk.END, text, (tag,))
            self.chat_display.config(state="disabled")
            self.chat_display.see(tk.END)
        except tk.TclError:
            # Widget already destroyed — silently ignore
            self._destroyed = True

    # ── Status bar updates ──────────────────────────────────────────────────

    def set_status(self, text: str) -> None:
        """Update the right-side transient status label (thread-safe)."""
        if self._destroyed:
            return
        self.after(0, self._do_set_status, text)

    def _do_set_status(self, text: str) -> None:
        if self._destroyed:
            return
        try:
            self.status_label.config(text=text)
        except tk.TclError:
            self._destroyed = True

    def set_status_info(self, text: str) -> None:
        """Update the left-side persistent info label (session, model, tokens).

        This mirrors the CLI's bottom_toolbar and stays visible at all times,
        not just during chat turns.
        """
        if self._destroyed:
            return
        self.after(0, self._do_set_status_info, text)

    def _do_set_status_info(self, text: str) -> None:
        if self._destroyed:
            return
        try:
            self.status_info_label.config(text=text)
        except tk.TclError:
            self._destroyed = True

    # ── Input handling ──────────────────────────────────────────────────────

    def _get_input_text(self) -> str:
        """Get the current input text and clear the input box."""
        text = self.input_box.get("1.0", tk.END).strip()
        self.input_box.delete("1.0", tk.END)
        return text

    def _on_return(self, event=None) -> str:
        """Enter → submit message (unless Shift held → newline)."""
        # Shift+Enter is handled by default Text widget behavior (newline)
        if event and event.state & 0x1:  # Shift key held
            return  # Let default newline happen

        user_input = self._get_input_text()
        if not user_input:
            return "break"

        self._submit_input(user_input)
        return "break"

    def _on_send_click(self) -> None:
        """Send button click → submit message."""
        user_input = self._get_input_text()
        if not user_input or self._is_chatting:
            return
        self._submit_input(user_input)

    def _on_stop_click(self) -> None:
        """Stop button click → interrupt current chat."""
        if self._is_chatting and self._on_interrupt_fn:
            self._on_interrupt_fn()

    def _on_interrupt_chat_key(self, event=None) -> str:
        """Escape key → interrupt current chat (if chatting).

        If not currently chatting, Escape does nothing (or could minimize).
        """
        if self._is_chatting and self._on_interrupt_fn:
            self._on_interrupt_fn()
        return "break"

    def _submit_input(self, user_input: str) -> None:
        """Process a submitted user input — dispatch command or chat."""
        # Add to input history
        self._input_history.append(user_input)
        self._history_index = -1
        self._current_input = ""

        # ── Slash command dispatch ──────────────────────────────────────────
        if user_input.startswith("/"):
            # Display the command as user input
            self.append_text(f"▸ {user_input}\n", "user")

            # Parse command and args
            parts = user_input.split(maxsplit=1)
            cmd_name = parts[0].lstrip("/")
            cmd_args = parts[1] if len(parts) > 1 else ""

            # Try to resolve against COMMAND_REGISTRY
            cmd_def = resolve_command(cmd_name)
            if cmd_def is None:
                self.append_text(f"未知命令: /{cmd_name}\n输入 /help 查看可用命令。\n", "error")
                self.append_text("──────────────────────────────────────────────\n", "separator")
                return

            # Dispatch to the command handler (run_tray.py)
            handled = self._on_command_fn(cmd_name, cmd_args)
            if not handled:
                # Command not handled locally → send as chat message
                self._start_chat_turn(user_input)
            return

        # ── Normal chat message ────────────────────────────────────────────
        self.append_text(f"▸ {user_input}\n\n", "user")
        self._start_chat_turn(user_input)

    def _start_chat_turn(self, user_input: str) -> None:
        """Begin a chat turn — disable input, set status, send to agent."""
        self._is_chatting = True
        self.set_status("思考中...")
        # Swap buttons: hide send, show stop
        self.send_btn.pack_forget()
        self.stop_btn.pack(side=tk.RIGHT, padx=(8, 0))
        self.input_box.config(state=tk.DISABLED)

        try:
            self._send_message_fn(user_input)
        except Exception as e:
            logger.error(f"Error sending message: {e}")
            self.append_text(f"❌ 发送失败: {e}\n", "error")
            self.finish_chat_turn()

    # ── Input history navigation ────────────────────────────────────────────

    def _on_history_up(self, event=None) -> str:
        """Up arrow → previous input in history."""
        if not self._input_history:
            return "break"
        if self._history_index == -1:
            self._current_input = self.input_box.get("1.0", tk.END).strip()
            self._history_index = len(self._input_history) - 1
        elif self._history_index > 0:
            self._history_index -= 1

        self.input_box.delete("1.0", tk.END)
        self.input_box.insert("1.0", self._input_history[self._history_index])
        return "break"

    def _on_history_down(self, event=None) -> str:
        """Down arrow → next input in history."""
        if self._history_index == -1:
            return "break"
        if self._history_index < len(self._input_history) - 1:
            self._history_index += 1
            self.input_box.delete("1.0", tk.END)
            self.input_box.insert("1.0", self._input_history[self._history_index])
        else:
            self._history_index = -1
            self.input_box.delete("1.0", tk.END)
            self.input_box.insert("1.0", self._current_input)
        return "break"

    # ── Window behavior ──────────────────────────────────────────────────────

    def _on_minimize(self) -> None:
        """WM_DELETE_WINDOW → minimize to tray (hide window)."""
        self.withdraw()
        if self._on_minimize_fn:
            self._on_minimize_fn()

    def show_window(self) -> None:
        """Show/restore the window from tray (thread-safe)."""
        self.after(0, self._do_show_window)

    def _do_show_window(self) -> None:
        """Actually restore the window (must run on tkinter thread)."""
        if self._destroyed:
            return
        try:
            self.state("normal")
            self.deiconify()
            self.lift()
            self.focus_force()
            self.input_box.focus_set()
            # Briefly set topmost so user sees it on Windows
            self.attributes("-topmost", True)
            self.after(200, lambda: self.attributes("-topmost", False) if not self._destroyed else None)
        except tk.TclError:
            self._destroyed = True
        except Exception as e:
            logger.warning(f"Window restore error: {e}")

    # ── Chat turn lifecycle ──────────────────────────────────────────────────

    def finish_chat_turn(self, stats: Optional[dict] = None) -> None:
        """Mark the end of an agent response turn (thread-safe)."""
        self.after(0, self._do_finish_chat_turn, stats)

    def _do_finish_chat_turn(self, stats: Optional[dict] = None) -> None:
        if self._destroyed:
            return
        try:
            self._is_chatting = False
            # Swap buttons: hide stop, show send
            self.stop_btn.pack_forget()
            self.send_btn.pack(side=tk.RIGHT, padx=(8, 0))
            self.input_box.config(state=tk.NORMAL)
            self.input_box.focus_set()
        except tk.TclError:
            self._destroyed = True
            return

        if stats:
            duration = stats.get("duration_seconds", 0)
            prompt_t = stats.get("prompt_tokens", 0)
            completion_t = stats.get("completion_tokens", 0)
            total_t = prompt_t + completion_t
            model = stats.get("model", "")
            turns = stats.get("turns", 0)
            token_limit = stats.get("token_limit", 0)

            # Format duration
            if duration < 1:
                dur_str = f"{int(duration * 1000)}ms"
            elif duration < 60:
                dur_str = f"{duration:.1f}s"
            else:
                m, s = divmod(int(duration), 60)
                dur_str = f"{m}m{s:02d}s"

            # Format tokens with limit
            def _fmt_tok(n):
                if n < 1000:
                    return str(n)
                if n < 1_000_000:
                    return f"{n / 1000:.1f}k"
                return f"{n / 1_000_000:.2f}M"

            tok_str = f"{_fmt_tok(prompt_t)}→{_fmt_tok(completion_t)}"
            if token_limit > 0:
                tok_str += f" ({_fmt_tok(total_t)}/{_fmt_tok(token_limit)})"
            else:
                tok_str += f" ({_fmt_tok(total_t)})"

            line = f"  ⏱ {dur_str} │ {tok_str} │ turn {turns}"
            if model:
                line += f" │ {model}"
            line += "\n"
            self._do_append_text(line, "stats")

        self._do_append_text("──────────────────────────────────────────────\n", "separator")
        self._do_set_status("就绪")

    # ── Error handling ───────────────────────────────────────────────────────

    def show_error(self, message: str) -> None:
        """Display an error message (thread-safe)."""
        self.after(0, lambda: self._do_show_error(message))

    def _do_show_error(self, message: str) -> None:
        if self._destroyed:
            return
        self.append_text(f"❌ {message}\n", "error")
        self._do_finish_chat_turn()

    # ── Window close (forced) ───────────────────────────────────────────────

    def force_close(self) -> None:
        """Force close the window (called on app quit).

        Sets the _destroyed flag first to prevent any pending callbacks
        from accessing widgets that have already been torn down.
        Then destroys the ScrolledText widget explicitly before the
        root window, so the internal scrollbar's Tcl commands don't
        fire on a destroyed widget path.
        """
        self._destroyed = True

        try:
            # Destroy the ScrolledText first (including its scrollbar)
            # to prevent TclError from pending yview/set commands
            self.chat_display.destroy()
        except Exception:
            pass

        try:
            self.destroy()
        except Exception:
            pass