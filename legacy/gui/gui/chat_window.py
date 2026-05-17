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

    Multi-window support:
        When ``parent`` is provided, the window is created as a ``tk.Toplevel``
        child of the root Tk window, enabling multiple independent chat windows.
        When ``parent`` is None (default), it acts as the root ``tk.Tk`` window.
    """

    def __new__(
        cls,
        *,
        parent: Optional[tk.Tk] = None,
        **kwargs,
    ):
        """Create the appropriate widget class based on parent parameter.

        - parent=None → returns instance of DrSaiChatWindow (tk.Tk subclass)
        - parent=Tk   → returns instance of DrSaiChatTopLevel (tk.Toplevel subclass)

        This allows the same interface (send_message_fn, etc.) for both
        root and child windows, while correctly inheriting from the
        appropriate tkinter widget class.
        """
        if parent is not None:
            return DrSaiChatTopLevel(parent=parent, **kwargs)
        return super().__new__(cls)

    def __init__(
        self,
        *,
        send_message_fn: Callable[[str], None],
        on_command_fn: Callable[[str, str], bool],
        on_minimize_fn: Optional[Callable[[], None]] = None,
        on_quit_fn: Optional[Callable[[], None]] = None,
        on_interrupt_fn: Optional[Callable[[], None]] = None,
        on_setup_fn: Optional[Callable[[], None]] = None,
        title: str = "DrSai Chat",
        geometry: str = "800x600",
        parent: Optional[tk.Tk] = None,
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
            on_setup_fn: Called when user opens config/setup dialog from menu.
            parent: If provided, create as tk.Toplevel (multi-window mode).
                    If None, create as tk.Tk (root window, single-window mode).
        """
        # Note: When parent is not None, __new__ returns a DrSaiChatTopLevel
        # instance, and DrSaiChatWindow.__init__ is NOT called (Python skips
        # __init__ when __new__ returns a different class instance).
        # DrSaiChatTopLevel handles its own __init__ via _init_chat_window().
        super().__init__()

        self._send_message_fn = send_message_fn
        self._on_command_fn = on_command_fn
        self._on_minimize_fn = on_minimize_fn
        self._on_quit_fn = on_quit_fn
        self._on_interrupt_fn = on_interrupt_fn
        self._on_setup_fn = on_setup_fn
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
        # ── Menu bar ────────────────────────────────────────────────────────
        self._build_menu_bar()

        # ── PanedWindow: display + input (user can drag sash to resize) ──────
        self._paned = tk.PanedWindow(self, orient=tk.VERTICAL, bg=_THEME["bg"],
                                     sashwidth=6, sashrelief=tk.FLAT,
                                     sashpad=2, opaqueresize=True)
        self._paned.pack(fill=tk.BOTH, expand=True, padx=8, pady=(8, 4))

        # ── Display area ────────────────────────────────────────────────────
        self._display_frame = tk.Frame(self._paned, bg=_THEME["bg"])

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

        # ── Status bar (inside display pane) ────────────────────────────────
        self._status_frame = tk.Frame(self._display_frame, bg=_THEME["status_bg"])
        self._status_frame.pack(fill=tk.X, pady=(2, 0))

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

        self._paned.add(self._display_frame, stretch="always", minsize=120)

        # ── Input area (Text widget for multi-line) ─────────────────────────
        self._input_pane = tk.Frame(self._paned, bg=_THEME["bg"])

        self.input_box = tk.Text(
            self._input_pane,
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
        self.input_box.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

        # Key bindings on input
        self.input_box.bind("<Return>", self._on_return)
        self.input_box.bind("<Shift-Return>", lambda e: None)  # default newline
        self.input_box.bind("<Up>", self._on_history_up)
        self.input_box.bind("<Down>", self._on_history_down)
        # Auto-resize input height based on content
        self.input_box.bind("<KeyRelease>", self._auto_resize_input)

        self.send_btn = tk.Button(
            self._input_pane,
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
            self._input_pane,
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

        self._paned.add(self._input_pane, stretch="never", minsize=60)

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

    # ── Menu bar (organized by COMMAND_REGISTRY categories) ──────────────────

    def _build_menu_bar(self) -> None:
        """Build the top-level menu bar organized by command categories.

        Categories (from COMMAND_REGISTRY):
            Session / Display / Configuration / Plan / Project / Workspace / Desktop / Info

        Commands that need specific values use popup dialogs instead of
        just dispatching text — this provides a GUI-native experience.
        """
        T = _THEME
        menubar = tk.Menu(
            self, bg=T["status_bg"], fg=T["fg"],
            activebackground=T["button_bg"], activeforeground=T["button_fg"],
            font=_UI_FONT, relief=tk.FLAT,
        )
        menu_cfg = dict(
            tearoff=0, bg=T["input_bg"], fg=T["fg"],
            activebackground=T["button_bg"], activeforeground=T["button_fg"],
            font=_UI_FONT,
        )

        # ── 会话管理 (Session) ────────────────────────────────────────
        session_menu = tk.Menu(menubar, **menu_cfg)
        session_menu.add_command(label="新建会话", command=lambda: self._dispatch_command("new", ""))
        session_menu.add_command(label="会话列表", command=lambda: self._dispatch_command("list", ""))
        session_menu.add_command(label="切换会话…", command=lambda: self._popup_switch_session())
        session_menu.add_command(label="重命名…", command=lambda: self._popup_rename())
        session_menu.add_command(label="恢复会话", command=lambda: self._dispatch_command("resume", ""))
        session_menu.add_command(label="搜索会话…", command=lambda: self._popup_search_session())
        session_menu.add_separator()
        session_menu.add_command(label="复制回复", command=lambda: self._dispatch_command("copy", ""))
        session_menu.add_command(label="清除屏幕", command=lambda: self._dispatch_command("clear", ""))
        menubar.add_cascade(label="会话管理", menu=session_menu)

        # ── 模型管理 (Configuration — model subset) ──────────────────
        model_menu = tk.Menu(menubar, **menu_cfg)
        model_menu.add_command(label="选择模型…", command=lambda: self._popup_model_select())
        model_menu.add_command(label="保存为默认模型…", command=lambda: self._popup_model_global())
        model_menu.add_command(label="快速模型", command=lambda: self._dispatch_command("fast", ""))
        model_menu.add_command(label="模型列表", command=lambda: self._dispatch_command("models", ""))
        menubar.add_cascade(label="模型管理", menu=model_menu)

        # ── 配置 (Configuration — non-model) ──────────────────────────
        config_menu = tk.Menu(menubar, **menu_cfg)
        config_menu.add_command(label="🔑 配置 API Key…", command=self._on_menu_setup)
        config_menu.add_command(label="查看配置", command=lambda: self._dispatch_command("config", ""))
        config_menu.add_separator()
        config_menu.add_command(label="推理模式…", command=lambda: self._popup_reasoning())
        config_menu.add_command(label="统计开关", command=lambda: self._dispatch_command("verbose", ""))
        config_menu.add_command(label="铃声开关", command=lambda: self._dispatch_command("bell", ""))
        menubar.add_cascade(label="配置管理", menu=config_menu)

        # ── 计划模式 (Plan) ───────────────────────────────────────────────
        plan_menu = tk.Menu(menubar, **menu_cfg)
        plan_menu.add_command(label="计划模式…", command=lambda: self._popup_toggle("plan_mode", "计划模式", ["开启 (on)", "关闭 (off)", "查看状态"]))
        plan_menu.add_command(label="全局计划模式…", command=lambda: self._popup_toggle("pm_global", "全局计划模式", ["开启 (on)", "关闭 (off)"]))
        plan_menu.add_command(label="注入提示…", command=lambda: self._popup_input("inject", "注入系统提示", "输入要注入的系统提示内容："))
        menubar.add_cascade(label="计划模式", menu=plan_menu)

        # ── 项目管理 (Project) ────────────────────────────────────────────
        project_menu = tk.Menu(menubar, **menu_cfg)
        project_menu.add_command(label="初始化项目", command=lambda: self._dispatch_command("init", ""))
        project_menu.add_command(label="记忆管理…", command=lambda: self._popup_toggle("memory", "记忆管理", ["查看状态", "显示内容", "清除记忆"]))
        menubar.add_cascade(label="项目管理", menu=project_menu)

        # ── 权限管理 (Permission — workspace/dangerous) ──────────────
        permission_menu = tk.Menu(menubar, **menu_cfg)
        permission_menu.add_command(label="目录限制…", command=lambda: self._popup_toggle("workspace", "目录限制", ["开启限制 (on)", "解除限制 (off)", "查看状态"]))
        permission_menu.add_command(label="危险命令…", command=lambda: self._popup_toggle("dangerous", "危险命令权限", ["开启 (on)", "关闭 (off)", "切换"]))
        permission_menu.add_command(label="切换目录…", command=lambda: self._popup_input("cd", "切换工作目录", "输入新的工作目录路径："))
        menubar.add_cascade(label="权限管理", menu=permission_menu)

        # ── 窗口管理 (Window) ─────────────────────────────────────────
        window_menu = tk.Menu(menubar, **menu_cfg)
        window_menu.add_command(label="新建窗口", command=lambda: self._dispatch_command("win_new", ""))
        window_menu.add_command(label="窗口列表…", command=lambda: self._popup_window_list())
        window_menu.add_command(label="关闭当前窗口", command=lambda: self._dispatch_command("win_close", ""))
        menubar.add_cascade(label="窗口管理", menu=window_menu)

        # ── 桌面管理 (Desktop) ────────────────────────────────────────────
        desktop_menu = tk.Menu(menubar, **menu_cfg)
        desktop_menu.add_command(label="创建快捷方式", command=lambda: self._dispatch_command("install", "shortcut"))
        desktop_menu.add_command(label="托盘图标…", command=lambda: self._popup_toggle("tray", "托盘图标", ["查看状态", "重新创建", "隐藏"]))
        menubar.add_cascade(label="桌面管理", menu=desktop_menu)

        # ── 帮助信息 (Info) ───────────────────────────────────────────────
        info_menu = tk.Menu(menubar, **menu_cfg)
        info_menu.add_command(label="系统状态", command=lambda: self._dispatch_command("status", ""))
        info_menu.add_command(label="详细信息", command=lambda: self._dispatch_command("info", ""))
        info_menu.add_command(label="命令帮助", command=lambda: self._dispatch_command("help", ""))
        info_menu.add_separator()
        info_menu.add_command(label="退出", command=lambda: self._on_quit_fn() if self._on_quit_fn else self.destroy())
        menubar.add_cascade(label="帮助信息", menu=info_menu)

        self.config(menu=menubar)

    # ── Menu-triggered popup dialogs ────────────────────────────────────

    def _on_menu_setup(self) -> None:
        """Menu: 配置 API Key → open setup dialog."""
        if self._on_setup_fn:
            self._on_setup_fn()
        else:
            self._dispatch_command("setup", "")

    def _dispatch_command(self, cmd_name: str, cmd_args: str) -> None:
        """Dispatch a slash command triggered from the menu bar."""
        self._on_command_fn(cmd_name, cmd_args)

    # ── Popup: Model selection ──────────────────────────────────────────

    def _popup_model_select(self) -> None:
        """Show model selection dialog with clickable model list."""
        try:
            load_llm_mode_config = __import__(
                "drsai.backend.gui.lazy_imports", fromlist=["get_load_llm_mode_config"]
            ).get_load_llm_mode_config()
            llm_config_path = os.environ.get("LLM_CONFIG_FILE") or ""
            if not llm_config_path:
                # Try to get from app context
                try:
                    llm_config_path = self._on_command_fn.__self__.ctx.cfg.get("llm_config_file", "")
                except Exception:
                    pass
            catalog = load_llm_mode_config(llm_config_path)
            current = ""
            try:
                current = self._on_command_fn.__self__.ctx.agent._defult_config_name or \
                          self._on_command_fn.__self__.ctx.defult_config_name
            except Exception:
                pass
        except Exception as e:
            self._do_append_text(f"❌ 无法加载模型配置: {e}\n", "error")
            return

        if not catalog:
            self._do_append_text("⚠ 模型配置为空\n", "error")
            return

        # Build dialog
        T = _THEME
        dialog = tk.Toplevel(self)
        dialog.title("选择模型")
        dialog.geometry("520x480")
        dialog.configure(bg=T["bg"])
        dialog.resizable(True, True)
        dialog.transient(self)
        dialog.grab_set()

        # Center
        dialog.update_idletasks()
        x = (dialog.winfo_screenwidth() - 520) // 2
        y = (dialog.winfo_screenheight() - 480) // 2
        dialog.geometry(f"+{x}+{y}")

        # Header
        tk.Label(dialog, text="🤖 选择模型", bg=T["bg"], fg=T["fg"],
                 font=_UI_FONT_BOLD).pack(anchor=tk.W, padx=16, pady=(12, 4))
        tk.Label(dialog, text=f"当前模型: {current}", bg=T["bg"], fg=T["status_fg"],
                 font=_UI_FONT).pack(anchor=tk.W, padx=16, pady=(0, 8))

        # ── Model listbox ────────────────────────────────────────────────
        listbox_frame = tk.Frame(dialog, bg=T["bg"])
        listbox_frame.pack(fill=tk.BOTH, expand=True, padx=16, pady=4)

        listbox = tk.Listbox(
            listbox_frame,
            bg=T["input_bg"], fg=T["fg"],
            selectbackground=T["button_bg"], selectforeground=T["button_fg"],
            font=_UI_FONT, relief=tk.FLAT, borderwidth=2,
            activestyle="none",
            highlightthickness=0,
        )
        scrollbar = tk.Scrollbar(listbox_frame, orient=tk.VERTICAL, command=listbox.yview)
        listbox.configure(yscrollcommand=scrollbar.set)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
        listbox.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

        # Populate listbox
        model_aliases = list(catalog.keys())
        current_idx = 0
        for i, alias in enumerate(model_aliases):
            entry = catalog[alias]
            reasoning_info = ""
            if hasattr(entry, 'reasoning') and entry.reasoning:
                reasoning_info = " 🧠" if entry.reasoning.supported else " 📝"
            display = f"{alias}{reasoning_info}"
            if alias == current:
                display += "  ← 当前"
                current_idx = i
            listbox.insert(tk.END, display)

        # Select the current model
        if current_idx < len(model_aliases):
            listbox.selection_set(current_idx)
            listbox.see(current_idx)

        # Buttons
        btn_frame = tk.Frame(dialog, bg=T["bg"])
        btn_frame.pack(fill=tk.X, padx=16, pady=(8, 12))

        def _on_confirm():
            sel = listbox.curselection()
            dialog.destroy()
            if sel:
                chosen = model_aliases[sel[0]]
                if chosen != current:
                    self._dispatch_command("model", chosen)

        def _on_cancel():
            dialog.destroy()

        tk.Button(btn_frame, text="✅ 确认", bg=T["button_bg"], fg=T["button_fg"],
                  font=_UI_FONT_BOLD, relief=tk.FLAT, padx=16, pady=6,
                  command=_on_confirm).pack(side=tk.LEFT, padx=(0, 8))
        tk.Button(btn_frame, text="取消", bg=T["separator_color"],
                  fg=T["fg"], font=_UI_FONT, relief=tk.FLAT, padx=12, pady=6,
                  command=_on_cancel).pack(side=tk.LEFT)

        # Double-click → confirm
        listbox.bind("<Double-Button-1>", lambda e: _on_confirm())

    def _popup_model_global(self) -> None:
        """Show model selection dialog with option to save as global default."""
        try:
            load_llm_mode_config = __import__(
                "drsai.backend.gui.lazy_imports", fromlist=["get_load_llm_mode_config"]
            ).get_load_llm_mode_config()
            llm_config_path = os.environ.get("LLM_CONFIG_FILE") or ""
            if not llm_config_path:
                try:
                    llm_config_path = self._on_command_fn.__self__.ctx.cfg.get("llm_config_file", "")
                except Exception:
                    pass
            catalog = load_llm_mode_config(llm_config_path)
            current = ""
            try:
                current = self._on_command_fn.__self__.ctx.agent._defult_config_name or \
                          self._on_command_fn.__self__.ctx.defult_config_name
            except Exception:
                pass
        except Exception as e:
            self._do_append_text(f"❌ 无法加载模型配置: {e}\n", "error")
            return

        if not catalog:
            self._do_append_text("⚠ 模型配置为空\n", "error")
            return

        T = _THEME
        dialog = tk.Toplevel(self)
        dialog.title("选择默认模型（全局保存）")
        dialog.geometry("520x480")
        dialog.configure(bg=T["bg"])
        dialog.resizable(True, True)
        dialog.transient(self)
        dialog.grab_set()

        dialog.update_idletasks()
        x = (dialog.winfo_screenwidth() - 520) // 2
        y = (dialog.winfo_screenheight() - 480) // 2
        dialog.geometry(f"+{x}+{y}")

        tk.Label(dialog, text="🤖 选择默认模型", bg=T["bg"], fg=T["fg"],
                 font=_UI_FONT_BOLD).pack(anchor=tk.W, padx=16, pady=(12, 4))
        tk.Label(dialog, text=f"当前模型: {current}\n选择后将保存为全局默认模型。",
                 bg=T["bg"], fg=T["status_fg"], font=_UI_FONT).pack(anchor=tk.W, padx=16, pady=(0, 8))

        # ── Model listbox ────────────────────────────────────────────────
        listbox_frame = tk.Frame(dialog, bg=T["bg"])
        listbox_frame.pack(fill=tk.BOTH, expand=True, padx=16, pady=4)

        listbox = tk.Listbox(
            listbox_frame,
            bg=T["input_bg"], fg=T["fg"],
            selectbackground=T["button_bg"], selectforeground=T["button_fg"],
            font=_UI_FONT, relief=tk.FLAT, borderwidth=2,
            activestyle="none", highlightthickness=0,
        )
        scrollbar = tk.Scrollbar(listbox_frame, orient=tk.VERTICAL, command=listbox.yview)
        listbox.configure(yscrollcommand=scrollbar.set)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
        listbox.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

        model_aliases = list(catalog.keys())
        current_idx = 0
        for i, alias in enumerate(model_aliases):
            entry = catalog[alias]
            reasoning_info = ""
            if hasattr(entry, 'reasoning') and entry.reasoning:
                reasoning_info = " 🧠" if entry.reasoning.supported else " 📝"
            display = f"{alias}{reasoning_info}"
            if alias == current:
                display += "  ← 当前"
                current_idx = i
            listbox.insert(tk.END, display)

        if current_idx < len(model_aliases):
            listbox.selection_set(current_idx)
            listbox.see(current_idx)

        btn_frame = tk.Frame(dialog, bg=T["bg"])
        btn_frame.pack(fill=tk.X, padx=16, pady=(8, 12))

        def _on_confirm():
            sel = listbox.curselection()
            dialog.destroy()
            if sel:
                chosen = model_aliases[sel[0]]
                if chosen != current:
                    self._dispatch_command("model_global", chosen)

        def _on_cancel():
            dialog.destroy()

        tk.Button(btn_frame, text="✅ 确认并保存", bg=T["button_bg"], fg=T["button_fg"],
                  font=_UI_FONT_BOLD, relief=tk.FLAT, padx=16, pady=6,
                  command=_on_confirm).pack(side=tk.LEFT, padx=(0, 8))
        tk.Button(btn_frame, text="取消", bg=T["separator_color"],
                  fg=T["fg"], font=_UI_FONT, relief=tk.FLAT, padx=12, pady=6,
                  command=_on_cancel).pack(side=tk.LEFT)

        listbox.bind("<Double-Button-1>", lambda e: _on_confirm())

    # ── Popup: Toggle (on/off/status selection) ────────────────────────

    def _popup_toggle(self, cmd_name: str, title: str, options: list[str]) -> None:
        """Show a toggle/selection dialog using styled buttons (not Radiobuttons).

        Each option is a tk.Button that highlights when clicked.
        This avoids the Windows dark-theme Radiobutton rendering issue
        where all indicators appear as selected.

        Maps option labels to command args:
            "开启 (on)" → args="on"
            "关闭 (off)" → args="off"
            "查看状态" → args="status"
            "切换" → args=""            (toggle)
            "重新创建" → args="create"
            "隐藏" → args="hide"
        """
        T = _THEME
        args_map = {
            "开启 (on)": "on", "开启限制 (on)": "on",
            "关闭 (off)": "off", "解除限制 (off)": "off",
            "查看状态": "status", "显示状态": "status",
            "切换": "",
            "重新创建": "create", "重新开始": "create",
            "隐藏": "hide", "停止": "hide",
            "查看内容": "show", "显示内容": "dump",
            "清除记忆": "clear",
        }

        dialog = tk.Toplevel(self)
        dialog.title(title)
        dialog.configure(bg=T["bg"])
        dialog.resizable(False, False)
        dialog.transient(self)
        dialog.grab_set()

        # Calculate size based on number of options
        btn_height = 44
        header_height = 60
        footer_height = 60
        total_height = header_height + len(options) * btn_height + footer_height
        total_width = 340
        dialog.geometry(f"{total_width}x{total_height}")

        dialog.update_idletasks()
        x = (dialog.winfo_screenwidth() - total_width) // 2
        y = (dialog.winfo_screenheight() - total_height) // 2
        dialog.geometry(f"+{x}+{y}")

        tk.Label(dialog, text=title, bg=T["bg"], fg=T["fg"],
                 font=_UI_FONT_BOLD).pack(anchor=tk.W, padx=16, pady=(12, 8))

        # ── Option buttons ──────────────────────────────────────────────
        self._toggle_selection = None

        options_frame = tk.Frame(dialog, bg=T["bg"])
        options_frame.pack(fill=tk.BOTH, expand=True, padx=16, pady=4)

        option_btns = []
        for opt in options:
            btn = tk.Button(
                options_frame, text=opt,
                bg=T["input_bg"], fg=T["fg"],
                font=_UI_FONT, relief=tk.FLAT,
                borderwidth=2, padx=12, pady=6,
                activebackground=T["button_bg"], activeforeground=T["button_fg"],
                cursor="hand2",
                command=lambda o=opt: self._toggle_select_option(o, option_btns, T),
            )
            btn.pack(fill=tk.X, pady=2)
            option_btns.append(btn)

        btn_frame = tk.Frame(dialog, bg=T["bg"])
        btn_frame.pack(fill=tk.X, padx=16, pady=(8, 12))

        def _on_confirm():
            chosen = self._toggle_selection
            dialog.destroy()
            if chosen is not None:
                args = args_map.get(chosen, chosen)
                self._dispatch_command(cmd_name, args)

        def _on_cancel():
            dialog.destroy()

        tk.Button(btn_frame, text="✅ 确认", bg=T["button_bg"], fg=T["button_fg"],
                  font=_UI_FONT_BOLD, relief=tk.FLAT, padx=16, pady=6,
                  command=_on_confirm).pack(side=tk.LEFT, padx=(0, 8))
        tk.Button(btn_frame, text="取消", bg=T["separator_color"],
                  fg=T["fg"], font=_UI_FONT, relief=tk.FLAT, padx=12, pady=6,
                  command=_on_cancel).pack(side=tk.LEFT)

    def _toggle_select_option(self, opt: str, btns: list, T: dict) -> None:
        """Highlight the selected option button and deselect others."""
        self._toggle_selection = opt
        for btn in btns:
            btn_text = btn.cget("text")
            if btn_text == opt:
                btn.configure(bg=T["button_bg"], fg=T["button_fg"], relief=tk.SUNKEN)
            else:
                btn.configure(bg=T["input_bg"], fg=T["fg"], relief=tk.FLAT)

    # ── Popup: Reasoning mode (multi-level) ────────────────────────────

    def _popup_reasoning(self) -> None:
        """Show reasoning mode selection dialog with specific levels (button-style)."""
        T = _THEME
        options = [
            ("开启推理 (show)", "show"),
            ("关闭推理 (off)", "off"),
            ("低级别 (low)", "low"),
            ("中级别 (medium)", "medium"),
            ("高级别 (high)", "high"),
        ]

        dialog = tk.Toplevel(self)
        dialog.title("推理模式")
        dialog.configure(bg=T["bg"])
        dialog.resizable(False, False)
        dialog.transient(self)
        dialog.grab_set()

        btn_height = 44
        header_height = 60
        footer_height = 60
        total_height = header_height + len(options) * btn_height + footer_height
        total_width = 340
        dialog.geometry(f"{total_width}x{total_height}")

        dialog.update_idletasks()
        x = (dialog.winfo_screenwidth() - total_width) // 2
        y = (dialog.winfo_screenheight() - total_height) // 2
        dialog.geometry(f"+{x}+{y}")

        tk.Label(dialog, text="🧠 推理模式", bg=T["bg"], fg=T["fg"],
                 font=_UI_FONT_BOLD).pack(anchor=tk.W, padx=16, pady=(12, 8))

        # ── Option buttons ──────────────────────────────────────────────
        self._toggle_selection = None
        option_btns = []
        options_frame = tk.Frame(dialog, bg=T["bg"])
        options_frame.pack(fill=tk.BOTH, expand=True, padx=16, pady=4)

        for label, value in options:
            btn = tk.Button(
                options_frame, text=label,
                bg=T["input_bg"], fg=T["fg"],
                font=_UI_FONT, relief=tk.FLAT,
                borderwidth=2, padx=12, pady=6,
                activebackground=T["button_bg"], activeforeground=T["button_fg"],
                cursor="hand2",
                command=lambda v=value, b=None, bs=option_btns: self._toggle_select_option_value(v, bs, options, T),
            )
            btn.pack(fill=tk.X, pady=2)
            option_btns.append(btn)

        btn_frame = tk.Frame(dialog, bg=T["bg"])
        btn_frame.pack(fill=tk.X, padx=16, pady=(8, 12))

        def _on_confirm():
            chosen = self._toggle_selection
            dialog.destroy()
            if chosen is not None:
                self._dispatch_command("reasoning", chosen)

        def _on_cancel():
            dialog.destroy()

        tk.Button(btn_frame, text="✅ 确认", bg=T["button_bg"], fg=T["button_fg"],
                  font=_UI_FONT_BOLD, relief=tk.FLAT, padx=16, pady=6,
                  command=_on_confirm).pack(side=tk.LEFT, padx=(0, 8))
        tk.Button(btn_frame, text="取消", bg=T["separator_color"],
                  fg=T["fg"], font=_UI_FONT, relief=tk.FLAT, padx=12, pady=6,
                  command=_on_cancel).pack(side=tk.LEFT)

    def _toggle_select_option_value(self, value: str, btns: list, options: list, T: dict) -> None:
        """Highlight the selected option button (value-based, not label-based)."""
        self._toggle_selection = value
        for i, btn in enumerate(btns):
            _, opt_value = options[i]
            if opt_value == value:
                btn.configure(bg=T["button_bg"], fg=T["button_fg"], relief=tk.SUNKEN)
            else:
                btn.configure(bg=T["input_bg"], fg=T["fg"], relief=tk.FLAT)

    # ── Popup: Input (free-text entry) ─────────────────────────────────

    def _popup_input(self, cmd_name: str, title: str, prompt: str) -> None:
        """Show a text input dialog for commands that need a free-text value."""
        T = _THEME
        dialog = tk.Toplevel(self)
        dialog.title(title)
        dialog.geometry("420x200")
        dialog.configure(bg=T["bg"])
        dialog.resizable(False, False)
        dialog.transient(self)
        dialog.grab_set()

        dialog.update_idletasks()
        x = (dialog.winfo_screenwidth() - 420) // 2
        y = (dialog.winfo_screenheight() - 200) // 2
        dialog.geometry(f"+{x}+{y}")

        tk.Label(dialog, text=title, bg=T["bg"], fg=T["fg"],
                 font=_UI_FONT_BOLD).pack(anchor=tk.W, padx=16, pady=(12, 4))
        tk.Label(dialog, text=prompt, bg=T["bg"], fg=T["status_fg"],
                 font=_UI_FONT).pack(anchor=tk.W, padx=16, pady=(0, 8))

        entry = tk.Entry(
            dialog, bg=T["input_bg"], fg=T["input_fg"],
            insertbackground=T["input_fg"], font=_FONT,
            relief=tk.SUNKEN, borderwidth=2,
        )
        entry.pack(fill=tk.X, padx=16, pady=(0, 12))
        entry.focus_set()

        btn_frame = tk.Frame(dialog, bg=T["bg"])
        btn_frame.pack(fill=tk.X, padx=16, pady=(4, 12))

        def _on_confirm():
            value = entry.get().strip()
            dialog.destroy()
            if value:
                self._dispatch_command(cmd_name, value)

        def _on_cancel():
            dialog.destroy()

        tk.Button(btn_frame, text="✅ 确认", bg=T["button_bg"], fg=T["button_fg"],
                  font=_UI_FONT_BOLD, relief=tk.FLAT, padx=16, pady=6,
                  command=_on_confirm).pack(side=tk.LEFT, padx=(0, 8))
        tk.Button(btn_frame, text="取消", bg=T["separator_color"],
                  fg=T["fg"], font=_UI_FONT, relief=tk.FLAT, padx=12, pady=6,
                  command=_on_cancel).pack(side=tk.LEFT)

        # Enter key → confirm
        entry.bind("<Return>", lambda e: _on_confirm())

    # ── Popup: Switch session ──────────────────────────────────────────

    def _popup_switch_session(self) -> None:
        """Show session list for switching to a different session."""
        try:
            CLISessionStore = __import__(
                "drsai.backend.gui.lazy_imports", fromlist=["get_CLISessionStore"]
            ).get_CLISessionStore()
            # CLISessionStore requires (db_manager, user_id) — instance-based API
            ctx = self._on_command_fn.__self__.ctx
            store = CLISessionStore(ctx.db_manager, ctx.user_id)
            current_id = ""
            try:
                current_id = ctx.current_session_id or ""
            except Exception:
                pass
            sessions = store.list(limit=30)
        except Exception as e:
            self._do_append_text(f"❌ 无法加载会话列表: {e}\n", "error")
            return

        T = _THEME
        dialog = tk.Toplevel(self)
        dialog.title("切换会话")
        dialog.geometry("480x380")
        dialog.configure(bg=T["bg"])
        dialog.resizable(True, True)
        dialog.transient(self)
        dialog.grab_set()

        dialog.update_idletasks()
        x = (dialog.winfo_screenwidth() - 480) // 2
        y = (dialog.winfo_screenheight() - 380) // 2
        dialog.geometry(f"+{x}+{y}")

        tk.Label(dialog, text="📋 切换会话", bg=T["bg"], fg=T["fg"],
                 font=_UI_FONT_BOLD).pack(anchor=tk.W, padx=16, pady=(12, 8))

        if not sessions:
            tk.Label(dialog, text="没有找到历史会话", bg=T["bg"], fg=T["status_fg"],
                     font=_UI_FONT).pack(anchor=tk.W, padx=16)
            tk.Button(dialog, text="关闭", bg=T["separator_color"],
                      fg=T["fg"], font=_UI_FONT, relief=tk.FLAT, padx=12, pady=6,
                      command=dialog.destroy).pack(padx=16, pady=12)
            return

        # ── Session listbox ────────────────────────────────────────────
        listbox_frame = tk.Frame(dialog, bg=T["bg"])
        listbox_frame.pack(fill=tk.BOTH, expand=True, padx=16, pady=4)

        listbox = tk.Listbox(
            listbox_frame,
            bg=T["input_bg"], fg=T["fg"],
            selectbackground=T["button_bg"], selectforeground=T["button_fg"],
            font=_UI_FONT, relief=tk.FLAT, borderwidth=2,
            activestyle="none", highlightthickness=0,
        )
        scrollbar = tk.Scrollbar(listbox_frame, orient=tk.VERTICAL, command=listbox.yview)
        listbox.configure(yscrollcommand=scrollbar.set)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
        listbox.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

        session_ids = []
        current_idx = 0
        for i, s in enumerate(sessions[:30]):
            name = getattr(s, 'name', '') or s.thread_id[:8]
            display = f"{name}  ({s.thread_id[:12]})"
            if s.thread_id == current_id:
                display += "  ← 当前"
                current_idx = i
            listbox.insert(tk.END, display)
            session_ids.append(s.thread_id)

        if current_idx < len(session_ids):
            listbox.selection_set(current_idx)
            listbox.see(current_idx)

        btn_frame = tk.Frame(dialog, bg=T["bg"])
        btn_frame.pack(fill=tk.X, padx=16, pady=(8, 12))

        def _on_confirm():
            sel = listbox.curselection()
            dialog.destroy()
            if sel:
                chosen = session_ids[sel[0]]
                self._dispatch_command("switch", chosen)

        def _on_cancel():
            dialog.destroy()

        tk.Button(btn_frame, text="✅ 切换", bg=T["button_bg"], fg=T["button_fg"],
                  font=_UI_FONT_BOLD, relief=tk.FLAT, padx=16, pady=6,
                  command=_on_confirm).pack(side=tk.LEFT, padx=(0, 8))
        tk.Button(btn_frame, text="取消", bg=T["separator_color"],
                  fg=T["fg"], font=_UI_FONT, relief=tk.FLAT, padx=12, pady=6,
                  command=_on_cancel).pack(side=tk.LEFT)

        listbox.bind("<Double-Button-1>", lambda e: _on_confirm())

    # ── Popup: Rename ──────────────────────────────────────────────────

    def _popup_rename(self) -> None:
        """Show rename dialog for current session."""
        self._popup_input("rename", "重命名会话", "输入新的会话名称：")

    # ── Popup: Search session ──────────────────────────────────────────

    def _popup_search_session(self) -> None:
        """Show search dialog for finding sessions."""
        self._popup_input("search", "搜索会话", "输入搜索关键词：")

    # ── Popup: Window list ────────────────────────────────────────────

    def _popup_window_list(self) -> None:
        """Show window list dialog for switching between chat windows."""
        try:
            ctx = self._on_command_fn.__self__.ctx
            sessions = ctx._sessions
            windows = ctx._windows
            active_id = ctx._active_session_id
        except Exception:
            self._do_append_text("❌ 无法获取窗口信息\n", "error")
            return

        if not sessions:
            self._do_append_text("⚠ 暂无打开的窗口\n", "system")
            return

        T = _THEME
        dialog = tk.Toplevel(self)
        dialog.title("窗口列表")
        dialog.geometry("480x380")
        dialog.configure(bg=T["bg"])
        dialog.resizable(True, True)
        dialog.transient(self)
        dialog.grab_set()

        dialog.update_idletasks()
        x = (dialog.winfo_screenwidth() - 480) // 2
        y = (dialog.winfo_screenheight() - 380) // 2
        dialog.geometry(f"+{x}+{y}")

        tk.Label(dialog, text="🪟 窗口列表", bg=T["bg"], fg=T["fg"],
                 font=_UI_FONT_BOLD).pack(anchor=tk.W, padx=16, pady=(12, 8))

        # ── Window listbox ────────────────────────────────────────────
        listbox_frame = tk.Frame(dialog, bg=T["bg"])
        listbox_frame.pack(fill=tk.BOTH, expand=True, padx=16, pady=4)

        listbox = tk.Listbox(
            listbox_frame,
            bg=T["input_bg"], fg=T["fg"],
            selectbackground=T["button_bg"], selectforeground=T["button_fg"],
            font=_UI_FONT, relief=tk.FLAT, borderwidth=2,
            activestyle="none", highlightthickness=0,
        )
        scrollbar = tk.Scrollbar(listbox_frame, orient=tk.VERTICAL, command=listbox.yview)
        listbox.configure(yscrollcommand=scrollbar.set)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
        listbox.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

        session_ids = []
        current_idx = 0
        for i, (sid, sctx) in enumerate(sessions.items()):
            name = sctx.session_name or sid[:8]
            model = sctx.defult_config_name or "?"
            has_window = "🪟" if (sid in windows and windows[sid] and windows[sid].winfo_exists()) else "  "
            display = f"{has_window} {name}  @{model}"
            if sid == active_id:
                display += "  ← 当前"
                current_idx = i
            listbox.insert(tk.END, display)
            session_ids.append(sid)

        if current_idx < len(session_ids):
            listbox.selection_set(current_idx)
            listbox.see(current_idx)

        btn_frame = tk.Frame(dialog, bg=T["bg"])
        btn_frame.pack(fill=tk.X, padx=16, pady=(8, 12))

        def _on_switch():
            sel = listbox.curselection()
            dialog.destroy()
            if sel:
                chosen = session_ids[sel[0]]
                self._dispatch_command("switch", chosen)

        def _on_new():
            dialog.destroy()
            self._dispatch_command("win_new", "")

        def _on_cancel():
            dialog.destroy()

        tk.Button(btn_frame, text="✅ 切换", bg=T["button_bg"], fg=T["button_fg"],
                  font=_UI_FONT_BOLD, relief=tk.FLAT, padx=16, pady=6,
                  command=_on_switch).pack(side=tk.LEFT, padx=(0, 8))
        tk.Button(btn_frame, text="➕ 新建", bg=T["button_bg"], fg=T["button_fg"],
                  font=_UI_FONT_BOLD, relief=tk.FLAT, padx=16, pady=6,
                  command=_on_new).pack(side=tk.LEFT, padx=(0, 8))
        tk.Button(btn_frame, text="取消", bg=T["separator_color"],
                  fg=T["fg"], font=_UI_FONT, relief=tk.FLAT, padx=12, pady=6,
                  command=_on_cancel).pack(side=tk.LEFT)

        listbox.bind("<Double-Button-1>", lambda e: _on_switch())

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
        # Reset input height back to 2 lines after clearing
        try:
            self.input_box.configure(height=2)
        except Exception:
            pass
        return text

    # ── Input auto-resize ──────────────────────────────────────────────────

    _INPUT_MAX_HEIGHT = 12   # max lines before scrolling inside

    def _auto_resize_input(self, event=None) -> None:
        """Auto-resize input Text widget height based on content lines."""
        try:
            line_count = int(self.input_box.index("end-1c").split(".")[0])
            desired = max(2, min(line_count, self._INPUT_MAX_HEIGHT))
            if self.input_box.cget("height") != desired:
                self.input_box.configure(height=desired)
        except Exception:
            pass

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


# ── Toplevel variant for multi-window mode ──────────────────────────────

class DrSaiChatTopLevel(tk.Toplevel):
    """tk.Toplevel variant of DrSaiChatWindow for multi-window mode.

    Shares the same widget layout, menu bar, input handling, and
    appearance as DrSaiChatWindow, but inherits from tk.Toplevel
    instead of tk.Tk so multiple instances can coexist in the
    same process (each with its own agent session).

    Created via DrSaiChatWindow(parent=root_tk) — the __new__ method
    returns a DrSaiChatTopLevel instance when parent is provided.
    """

    def __init__(
        self,
        *,
        parent: tk.Tk,
        send_message_fn: Callable[[str], None],
        on_command_fn: Callable[[str, str], bool],
        on_minimize_fn: Optional[Callable[[], None]] = None,
        on_quit_fn: Optional[Callable[[], None]] = None,
        on_interrupt_fn: Optional[Callable[[], None]] = None,
        on_setup_fn: Optional[Callable[[], None]] = None,
        title: str = "DrSai Chat",
        geometry: str = "800x600",
    ) -> None:
        super().__init__(parent)

        self._send_message_fn = send_message_fn
        self._on_command_fn = on_command_fn
        self._on_minimize_fn = on_minimize_fn or (lambda: self.withdraw())
        self._on_quit_fn = on_quit_fn or (lambda: self.withdraw())
        self._on_interrupt_fn = on_interrupt_fn
        self._on_setup_fn = on_setup_fn
        self._is_chatting = False
        self._input_history: list[str] = []
        self._history_index = -1
        self._current_input = ""
        self._destroyed = False

        # ── Window setup ────────────────────────────────────────────────
        self.title(title)
        self.geometry(geometry)
        self.configure(bg=_THEME["bg"])
        self.minsize(600, 400)

        # Center on screen with slight offset from parent
        self.update_idletasks()
        w = self.winfo_width()
        h = self.winfo_height()
        # Offset from parent position for visual clarity
        px = parent.winfo_x() + 40
        py = parent.winfo_y() + 40
        # Keep within screen bounds
        x = min(px, self.winfo_screenwidth() - w - 10)
        y = min(py, self.winfo_screenheight() - h - 10)
        self.geometry(f"+{x}+{y}")

        # Close button → call on_quit_fn (which typically calls _on_win_close)
        self.protocol("WM_DELETE_WINDOW", self._on_quit_fn)

        # ── Build widgets (reuse DrSaiChatWindow's layout) ─────────────
        self._build_widgets()

        # ── Key bindings ────────────────────────────────────────────────
        self.bind("<Control-q>", lambda e: self._on_quit_fn())
        self.bind("<Escape>", lambda e: self._on_interrupt_chat_key(e))

        # ── Welcome message ─────────────────────────────────────────────
        self.append_text("🤖 DrSai Chat — 新窗口\n", "system")
        self.append_text("Enter 发送，Shift+Enter 换行，Escape/⏹ 中断回复。\n", "system")
        self.append_text("关闭窗口将结束此会话。\n", "system")
        self.append_text("输入 /help 或 /h 查看所有命令。\n\n", "system")

    # ── Reuse all widget building, popup, and interaction methods ───────
    # DrSaiChatWindow's methods work on Toplevel too because both use
    # the same tkinter widget API (after, config, etc.)

    # Delegate to DrSaiChatWindow methods — they work on Toplevel too
    # since they only use self.after(), self.chat_display, self.input_box, etc.
    _build_widgets = DrSaiChatWindow._build_widgets
    _configure_tags = DrSaiChatWindow._configure_tags
    _build_menu_bar = DrSaiChatWindow._build_menu_bar
    _on_menu_setup = DrSaiChatWindow._on_menu_setup
    _dispatch_command = DrSaiChatWindow._dispatch_command
    _popup_model_select = DrSaiChatWindow._popup_model_select
    _popup_model_global = DrSaiChatWindow._popup_model_global
    _popup_toggle = DrSaiChatWindow._popup_toggle
    _toggle_select_option = DrSaiChatWindow._toggle_select_option
    _popup_reasoning = DrSaiChatWindow._popup_reasoning
    _toggle_select_option_value = DrSaiChatWindow._toggle_select_option_value
    _popup_input = DrSaiChatWindow._popup_input
    _popup_switch_session = DrSaiChatWindow._popup_switch_session
    _popup_rename = DrSaiChatWindow._popup_rename
    _popup_search_session = DrSaiChatWindow._popup_search_session
    _popup_window_list = DrSaiChatWindow._popup_window_list
    append_text = DrSaiChatWindow.append_text
    _do_append_text = DrSaiChatWindow._do_append_text
    set_status = DrSaiChatWindow.set_status
    _do_set_status = DrSaiChatWindow._do_set_status
    set_status_info = DrSaiChatWindow.set_status_info
    _do_set_status_info = DrSaiChatWindow._do_set_status_info
    _get_input_text = DrSaiChatWindow._get_input_text
    _auto_resize_input = DrSaiChatWindow._auto_resize_input
    _on_return = DrSaiChatWindow._on_return
    _on_send_click = DrSaiChatWindow._on_send_click
    _on_stop_click = DrSaiChatWindow._on_stop_click
    _on_interrupt_chat_key = DrSaiChatWindow._on_interrupt_chat_key
    _submit_input = DrSaiChatWindow._submit_input
    _start_chat_turn = DrSaiChatWindow._start_chat_turn
    _on_history_up = DrSaiChatWindow._on_history_up
    _on_history_down = DrSaiChatWindow._on_history_down
    _on_minimize = DrSaiChatWindow._on_minimize
    show_window = DrSaiChatWindow.show_window
    _do_show_window = DrSaiChatWindow._do_show_window
    finish_chat_turn = DrSaiChatWindow.finish_chat_turn
    _do_finish_chat_turn = DrSaiChatWindow._do_finish_chat_turn