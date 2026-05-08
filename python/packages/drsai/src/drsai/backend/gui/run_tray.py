"""DrSai Desktop Tray Application — main entry point.

Provides a Windows system tray icon that launches a tkinter chat window
for conversing with a DrSaiAssistant agent, similar to the CLI REPL.

Slash commands are dispatched here, mirroring run_cli.py's _run_repl logic.

Architecture:
    ┌─ Main thread (tkinter.mainloop) ──────────────────────┐
    │  DrSaiChatWindow (tkinter.Tk)                         │
    │  - Displays conversation                              │
    │  - Accepts user input (text + /commands)              │
    │  - root.after() for thread-safe GUI updates           │
    └────────────────────────────────────────────────────────│
    ┌─ Tray thread (pystray.Icon) ──────────────────────────│
    │  System tray icon                                     │
    │  - Double-click → show_window → root.after()          │
    │  - Menu "打开对话" → show_window                       │
    │  - Menu "退出" → quit_fn → os._exit()                │
    └────────────────────────────────────────────────────────│
    ┌─ Asyncio loop thread ─────────────────────────────────│
    │  DrSaiCLIAssistant (resident in memory)               │
    │  - create_agent() initialization                      │
    │  - agent.run_stream(task=user_input)                  │
    │  - GUIRenderer.render(stream) → append_fn → root.after│
    └────────────────────────────────────────────────────────┘

Usage:
    python -m drsai.backend.run_tray
    or:  drsai-tray  (if registered as entry point)

Requirements:
    pip install drsai[tray]  (pystray + Pillow)
"""

from __future__ import annotations

import asyncio
import os
import sys
import time
import threading
from pathlib import Path
from typing import Any, Optional

import tkinter as tk

from loguru import logger

from drsai.configs.constant import APPNAME, VERSION, FS_DIR
from drsai.backend.cli import config as cli_config
from drsai.backend.cli.commands import resolve_command, format_help
from drsai.backend.cli.stats import SessionStats
from drsai.backend.run_drsai_agent_factory import create_agent
from drsai.modules.agents.skills_agent import DrSaiCLIAssistant
from drsai.modules.managers.database import DatabaseManager
from drsai.modules.managers.datamodel import Thread
from drsai.modules.managers.datamodel.db import RunStatus
from drsai.modules.managers.datamodel.types import Response
from drsai.utils.utils import compress_state, decompress_state

from drsai.backend.gui.chat_window import DrSaiChatWindow
from drsai.backend.gui.gui_renderer import DrSaiGUIRenderer
from drsai.backend.gui.tray_icon import DrSaiTrayApp

# ── Setup dialog theme (Catppuccin Mocha dark theme, matching chat_window) ─
_SETUP_THEME = {
    "bg":              "#1e1e2e",
    "fg":              "#cdd6f4",
    "input_bg":        "#313244",
    "input_fg":        "#cdd6f4",
    "button_bg":       "#89b4fa",
    "button_fg":       "#1e1e2e",
    "label_fg":        "#a6adc8",
    "hint_fg":         "#6c7086",
    "error_fg":        "#f38ba8",
    "success_fg":      "#a6e3a1",
    "provider_active_bg": "#45475a",
    "provider_active_fg": "#89b4fa",
    "border_color":    "#45475a",
    "separator":       "#585b70",
}

_SETUP_FONT        = ("Segoe UI", 11)   if sys.platform == "win32" else ("Sans", 11)
_SETUP_FONT_BOLD   = ("Segoe UI", 12, "bold") if sys.platform == "win32" else ("Sans", 12, "bold")
_SETUP_FONT_SMALL  = ("Segoe UI", 9)    if sys.platform == "win32" else ("Sans", 9)
_SETUP_FONT_ENTRY  = ("Consolas", 11)   if sys.platform == "win32" else ("Monospace", 11)

# ── Setup Dialog ────────────────────────────────────────────────────────────

class DrSaiSetupDialog(tk.Toplevel):
    """First-time setup / environment variable configuration dialog.

    Automatically shown when required API key environment variables
    are not detected.  Allows the user to:

    1. Select an API provider (HepAI / Anthropic / OpenAI)
    2. Enter the API key (required)
    3. Optionally enter a custom base URL
    4. Optionally set user ID and default model

    After completion:
    - Configuration is saved to ~/.drsai/configs/cli_config.json
    - Environment variables are set for the current process
    - The app continues initialization
    """

    PROVIDERS = {
        "hepai": {
            "label":     "HepAI (推荐 — 国内高速模型)",
            "env_var":   "HEPAI_API_KEY",
            "cfg_key":   "api_key",
            "base_env":  "",
            "base_cfg":  "",
            "base_hint": "",
        },
        "anthropic": {
            "label":     "Anthropic (Claude 系列)",
            "env_var":   "ANTHROPIC_API_KEY",
            "cfg_key":   "anthropic_api_key",
            "base_env":  "ANTHROPIC_BASE_URL",
            "base_cfg":  "anthropic_base_url",
            "base_hint": "例: https://api.anthropic.com",
        },
        "openai": {
            "label":     "OpenAI (GPT 系列)",
            "env_var":   "OPENAI_API_KEY",
            "cfg_key":   "openai_api_key",
            "base_env":  "OPENAI_BASE_URL",
            "base_cfg":  "openai_base_url",
            "base_hint": "例: https://api.openai.com/v1",
        },
    }

    def __init__(self, parent: "tk.Tk", cfg: dict = None) -> None:
        super().__init__(parent)

        self.cfg = cfg or {}
        self.completed = False
        self.config_values: dict = {}

        # ── Window setup ──────────────────────────────────────────────────
        self.title("🤖 DrSai — 首次配置")
        self.geometry("560x560")
        self.configure(bg=_SETUP_THEME["bg"])
        self.resizable(False, False)

        # Center on screen
        self.update_idletasks()
        w = self.winfo_reqwidth()
        h = self.winfo_reqheight()
        x = (self.winfo_screenwidth() - w) // 2
        y = (self.winfo_screenheight() - h) // 2
        self.geometry(f"+{x}+{y}")

        # Modal: grab focus
        self.transient(parent)
        self.grab_set()
        self.protocol("WM_DELETE_WINDOW", self._on_cancel)

        # ── State ──────────────────────────────────────────────────────────
        self._selected_provider = "hepai"

        # ── Build UI ──────────────────────────────────────────────────────
        self._build_widgets()

        # Focus on API key entry after dialog is shown
        self.after(100, lambda: self._api_key_entry.focus_set())

    # ── Widget construction ──────────────────────────────────────────────────

    def _build_widgets(self) -> None:
        T = _SETUP_THEME

        # ── Main frame ────────────────────────────────────────────────────
        main_frame = tk.Frame(self, bg=T["bg"], padx=24, pady=20)
        main_frame.pack(fill=tk.BOTH, expand=True)

        # ── Welcome message ────────────────────────────────────────────────
        tk.Label(
            main_frame, text="🤖 欢迎使用 DrSai！",
            bg=T["bg"], fg=T["fg"], font=_SETUP_FONT_BOLD,
        ).pack(anchor=tk.W, pady=(0, 4))

        tk.Label(
            main_frame,
            text="首次使用需要配置 API Key。请选择提供商并输入密钥：",
            bg=T["bg"], fg=T["label_fg"], font=_SETUP_FONT, wraplength=500,
        ).pack(anchor=tk.W, pady=(0, 16))

        # ── Provider selection ─────────────────────────────────────────────
        provider_frame = tk.LabelFrame(
            main_frame, text=" API 提供商 ",
            bg=T["bg"], fg=T["label_fg"], font=_SETUP_FONT,
            padx=10, pady=8,
            highlightbackground=T["border_color"], highlightthickness=1,
        )
        provider_frame.pack(fill=tk.X, pady=(0, 16))

        self._provider_var = tk.StringVar(value=self._selected_provider)
        for prov_id, prov_info in self.PROVIDERS.items():
            tk.Radiobutton(
                provider_frame,
                text=prov_info["label"],
                variable=self._provider_var, value=prov_id,
                bg=T["bg"], fg=T["fg"],
                selectcolor=T["provider_active_bg"],
                activebackground=T["bg"], activeforeground=T["provider_active_fg"],
                font=_SETUP_FONT,
                command=self._on_provider_change,
            ).pack(anchor=tk.W, pady=2)

        # ── API Key ────────────────────────────────────────────────────────
        key_frame = tk.Frame(main_frame, bg=T["bg"])
        key_frame.pack(fill=tk.X, pady=(0, 10))

        tk.Label(
            key_frame, text="API Key *:",
            bg=T["bg"], fg=T["fg"], font=_SETUP_FONT,
        ).pack(side=tk.LEFT)

        self._api_key_entry = tk.Entry(
            key_frame,
            bg=T["input_bg"], fg=T["input_fg"],
            insertbackground=T["input_fg"],
            font=_SETUP_FONT_ENTRY,
            show="●",          # Mask the key like a password
            relief=tk.SUNKEN, borderwidth=2,
        )
        self._api_key_entry.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(8, 0))

        # ── Base URL ────────────────────────────────────────────────────────
        self._base_url_frame = tk.Frame(main_frame, bg=T["bg"])
        # Pack conditionally based on provider — see _on_provider_change

        self._base_url_label = tk.Label(
            self._base_url_frame, text="Base URL:",
            bg=T["bg"], fg=T["label_fg"], font=_SETUP_FONT,
        )
        self._base_url_label.pack(side=tk.LEFT)

        self._base_url_entry = tk.Entry(
            self._base_url_frame,
            bg=T["input_bg"], fg=T["input_fg"],
            insertbackground=T["input_fg"],
            font=_SETUP_FONT_ENTRY,
            relief=tk.SUNKEN, borderwidth=2,
        )
        self._base_url_entry.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(8, 0))

        # ── Separator ──────────────────────────────────────────────────────
        self._separator = tk.Frame(main_frame, bg=T["separator"], height=1)
        self._separator.pack(fill=tk.X, pady=(10, 10))

        # ── Other config ────────────────────────────────────────────────────
        other_frame = tk.LabelFrame(
            main_frame, text=" 其他配置（可选） ",
            bg=T["bg"], fg=T["label_fg"], font=_SETUP_FONT,
            padx=10, pady=8,
            highlightbackground=T["border_color"], highlightthickness=1,
        )
        other_frame.pack(fill=tk.X, pady=(0, 16))

        # User ID
        uid_row = tk.Frame(other_frame, bg=T["bg"])
        uid_row.pack(fill=tk.X, pady=(0, 8))

        tk.Label(
            uid_row, text="用户 ID:", width=10, anchor=tk.W,
            bg=T["bg"], fg=T["label_fg"], font=_SETUP_FONT,
        ).pack(side=tk.LEFT)

        self._user_id_entry = tk.Entry(
            uid_row,
            bg=T["input_bg"], fg=T["input_fg"],
            insertbackground=T["input_fg"],
            font=_SETUP_FONT_ENTRY,
            relief=tk.SUNKEN, borderwidth=2,
        )
        self._user_id_entry.pack(side=tk.LEFT, fill=tk.X, expand=True)
        self._user_id_entry.insert(0, self.cfg.get("user_id", "anonymous"))

        # Default model
        model_row = tk.Frame(other_frame, bg=T["bg"])
        model_row.pack(fill=tk.X)

        tk.Label(
            model_row, text="默认模型:", width=10, anchor=tk.W,
            bg=T["bg"], fg=T["label_fg"], font=_SETUP_FONT,
        ).pack(side=tk.LEFT)

        self._model_entry = tk.Entry(
            model_row,
            bg=T["input_bg"], fg=T["input_fg"],
            insertbackground=T["input_fg"],
            font=_SETUP_FONT_ENTRY,
            relief=tk.SUNKEN, borderwidth=2,
        )
        self._model_entry.pack(side=tk.LEFT, fill=tk.X, expand=True)
        default_model = self.cfg.get("defult_config_name") or "hepai/minimax-m2.7-highspeed"
        self._model_entry.insert(0, default_model)

        # ── Hint text ──────────────────────────────────────────────────────
        tk.Label(
            main_frame,
            text="💡 API Key 将保存到 ~/.drsai/configs/cli_config.json\n"
                 "   也可通过环境变量设置: HEPAI_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY",
            bg=T["bg"], fg=T["hint_fg"], font=_SETUP_FONT_SMALL,
            wraplength=500, justify=tk.LEFT,
        ).pack(anchor=tk.W, pady=(0, 16))

        # ── Error label ────────────────────────────────────────────────────
        self._error_label = tk.Label(
            main_frame, text="",
            bg=T["bg"], fg=T["error_fg"], font=_SETUP_FONT,
        )
        self._error_label.pack(anchor=tk.W, pady=(0, 10))

        # ── Buttons ────────────────────────────────────────────────────────
        btn_frame = tk.Frame(main_frame, bg=T["bg"])
        btn_frame.pack(fill=tk.X)

        tk.Button(
            btn_frame, text="✅ 保存并启动",
            bg=T["button_bg"], fg=T["button_fg"],
            font=_SETUP_FONT_BOLD, relief=tk.FLAT, borderwidth=0,
            padx=24, pady=8,
            activebackground="#74c7ec", command=self._on_save,
        ).pack(side=tk.LEFT, padx=(0, 12))

        tk.Button(
            btn_frame, text="退出",
            bg=T["border_color"], fg=T["fg"],
            font=_SETUP_FONT, relief=tk.FLAT, borderwidth=0,
            padx=16, pady=8,
            activebackground=T["border_color"], command=self._on_cancel,
        ).pack(side=tk.LEFT)

        # ── Initial provider state ─────────────────────────────────────────
        self._on_provider_change()

    # ── Provider change ────────────────────────────────────────────────────

    def _on_provider_change(self) -> None:
        """Update UI based on selected provider."""
        provider = self._provider_var.get()
        prov_info = self.PROVIDERS[provider]
        self._selected_provider = provider

        has_base_url = bool(prov_info["base_cfg"])

        if has_base_url:
            # Pack base_url_frame before the separator (they are siblings in main_frame)
            self._base_url_frame.pack(fill=tk.X, pady=(0, 10), before=self._separator)
            self._base_url_entry.delete(0, tk.END)
            # Pre-fill base URL from existing config
            existing_base = self.cfg.get(prov_info["base_cfg"], "")
            if existing_base:
                self._base_url_entry.insert(0, existing_base)
        else:
            self._base_url_frame.pack_forget()

    # ── Save ──────────────────────────────────────────────────────────────

    def _on_save(self) -> None:
        """Validate inputs and save configuration."""
        provider = self._selected_provider
        prov_info = self.PROVIDERS[provider]

        api_key = self._api_key_entry.get().strip()
        if not api_key:
            self._error_label.config(text="❌ API Key 不能为空！请输入您的密钥。")
            self._api_key_entry.focus_set()
            return

        # Clear any previous error
        self._error_label.config(text="")

        # Build config values
        values = {
            prov_info["cfg_key"]: api_key,
            "user_id": self._user_id_entry.get().strip() or "anonymous",
        }

        default_model = self._model_entry.get().strip()
        if default_model:
            values["defult_config_name"] = default_model

        # Base URL (if applicable)
        base_url = self._base_url_entry.get().strip()
        if base_url and prov_info["base_cfg"]:
            values[prov_info["base_cfg"]] = base_url

        self.config_values = values
        self.completed = True

        # Also set environment variables for current process
        os.environ[prov_info["env_var"]] = api_key
        if base_url and prov_info["base_env"]:
            os.environ[prov_info["base_env"]] = base_url

        # Close dialog (destroy triggers wait_window() to return)
        # NOTE: Do NOT call self.master.quit() here!
        # When the dialog is a Toplevel on the main chat_window root,
        # quit() would terminate the ENTIRE tkinter mainloop, causing
        # the GUI to freeze. Instead, we just destroy the dialog.
        # - In _show_setup_dialog (initial setup): the temporary root's
        #   mainloop() is exited by root.quit() called AFTER this dialog
        #   closes, in the _show_setup_dialog function.
        # - In _cmd_setup (re-configure): wait_window(dialog) detects
        #   the dialog destruction and returns to _cmd_setup.
        self.destroy()

    # ── Cancel ────────────────────────────────────────────────────────────

    def _on_cancel(self) -> None:
        """User cancelled setup — close dialog only."""
        self.completed = False
        # NOTE: Do NOT call self.master.quit() — same reason as _on_save.
        # Just destroy the dialog; wait_window() or the outer mainloop
        # will handle the rest.
        self.destroy()

# ── Helper: check API key availability without creating the app ────────────

def _check_setup_needed() -> tuple[bool, dict]:
    """Check if first-time setup is needed.

    Returns (needs_setup, current_config).
    """
    cfg = dict(cli_config.DEFAULT_CONFIG)
    if cli_config.CLI_CONFIG_PATH.exists():
        saved = cli_config.load_config()
        cfg = {**cli_config.DEFAULT_CONFIG, **saved}

    has_key = any([
        cfg.get("api_key"),
        cfg.get("anthropic_api_key"),
        cfg.get("openai_api_key"),
        os.environ.get("HEPAI_API_KEY"),
        os.environ.get("ANTHROPIC_API_KEY"),
        os.environ.get("OPENAI_API_KEY"),
    ])

    return (not has_key, cfg)

def _show_setup_dialog(cfg: dict) -> Optional[DrSaiSetupDialog]:
    """Show the setup dialog and return the dialog object after completion.

    Creates a temporary tk.Tk root for the dialog, then destroys it.
    Returns None if the user cancelled.
    """
    import tkinter as tk
    root = tk.Tk()
    root.withdraw()

    dialog = DrSaiSetupDialog(root, cfg=cfg)

    # After the dialog closes (self.destroy() in _on_save/_on_cancel),
    # quit the temporary root's mainloop so we can continue.
    def _on_dialog_closed():
        root.quit()

    # Bind to the dialog's <Destroy> event to quit the root mainloop
    # when the dialog closes. This replaces the old self.master.quit()
    # calls that were inside the dialog's _on_save/_on_cancel.
    dialog.bind("<Destroy>", lambda e: _on_dialog_closed())

    root.mainloop()

    if not dialog.completed:
        root.destroy()
        return None

    # Save configuration to disk
    cfg.update(dialog.config_values)
    cli_config.save_config(cfg)

    root.destroy()
    return dialog

# ── Desktop Application ────────────────────────────────────────────────────

class DrSaiDesktopApp:
    """Top-level orchestrator: tray icon + chat window + agent lifecycle.

    Handles:
    - Normal chat messages → agent.run_stream() → GUI renderer
    - Slash commands (/help, /model, /new, /quit, etc.) → local dispatch
    - Tray icon: double-click/menu → show window
    - Window minimize → hide to tray
    """

    def __init__(self) -> None:
        # ── Load config ─────────────────────────────────────────────────────
        self.cfg: dict = self._load_or_setup_config()

        # ── Check API key ──────────────────────────────────────────────────
        self._needs_setup: bool = not self._has_any_api_key()

        # ── Core state ──────────────────────────────────────────────────────
        self.user_id: str = self.cfg.get("user_id", "anonymous")
        self.defult_config_name: str = self.cfg.get("defult_config_name", "hepai/minimax-m2.7-highspeed")
        self.db_manager: Optional[DatabaseManager] = None
        self.agent: Optional[DrSaiCLIAssistant] = None
        self.current_session_id: Optional[str] = None
        self.current_thread: Optional[Thread] = None
        self._show_reasoning: bool = self.cfg.get("show_reasoning", False)

        # ── Work directory (mirrors CLI's cwd-based session strategy) ────────
        # In CLI, workdir = Path.cwd().resolve() (user ran drsai from their project).
        # In Tray GUI, we read from config or fall back to cwd.
        self._work_dir: str = self.cfg.get("work_dir", "") or os.environ.get("DRSAI_WORK_DIR", "") or str(Path.home().resolve())

        # ── Stats tracking (mirrors run_cli.py's SessionStats) ──────────────
        self.stats: SessionStats = SessionStats(show_footer=True, ring_bell=False)

        # ── Asyncio loop (runs in background thread) ───────────────────────
        # Only start if we have API key; deferred init will start it later
        # if setup dialog provided a key.
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._loop_thread: Optional[threading.Thread] = None
        self._init_error: Optional[str] = None
        self._init_done = threading.Event()

        if not self._needs_setup:
            self._start_async_loop_and_init_agent()

        # ── GUI components (created later on tkinter thread) ────────────────
        self._chat_window: Optional[DrSaiChatWindow] = None
        self._tray_app: Optional[DrSaiTrayApp] = None

    # ── Chat task tracking (for interrupt/cancel support) ───────────────
        self._current_chat_task: Optional[asyncio.Future] = None
        self._interrupt_count: int = 0     # Ctrl+C counter: 1st=interrupt, 2nd=quit

    # ── Config loading ──────────────────────────────────────────────────────

    def _load_or_setup_config(self) -> dict:
        if cli_config.CLI_CONFIG_PATH.exists():
            return cli_config.load_config()
        cfg = dict(cli_config.DEFAULT_CONFIG)
        cfg["user_id"] = os.environ.get("DRSAI_USER_ID", "anonymous")
        cli_config.save_config(cfg)
        return cfg

    def _has_any_api_key(self) -> bool:
        return any([
            self.cfg.get("api_key"),
            self.cfg.get("anthropic_api_key"),
            self.cfg.get("openai_api_key"),
            os.environ.get("ANTHROPIC_API_KEY"),
            os.environ.get("OPENAI_API_KEY"),
            os.environ.get("HEPAI_API_KEY"),
        ])

    # ── Asyncio loop & agent init ──────────────────────────────────────

    def _start_async_loop_and_init_agent(self) -> None:
        """Start the asyncio loop thread and initialize the agent.

        Called from __init__ if API key is available, or from
        _deferred_init() after setup dialog provides a key.
        """
        self._loop = asyncio.new_event_loop()
        self._loop_thread = threading.Thread(
            target=self._run_async_loop,
            name="drsai-asyncio",
            daemon=True,
        )
        self._loop_thread.start()

        self._init_error = None
        self._init_done = threading.Event()
        asyncio.run_coroutine_threadsafe(self._init_agent(), self._loop)

    def _deferred_init(self, new_cfg: dict) -> None:
        """Deferred initialization after setup dialog completes.

        Updates config with values from setup dialog, then starts
        the asyncio loop and agent initialization that was skipped
        in __init__ due to missing API key.
        """
        logger.info("Deferred init: starting after setup dialog...")

        # Update cfg with new values
        for key, val in new_cfg.items():
            if val:
                self.cfg[key] = val

        # Update derived state from cfg
        self.user_id = self.cfg.get("user_id", "anonymous")
        self.defult_config_name = self.cfg.get("defult_config_name", "hepai/minimax-m2.7-highspeed")
        self._needs_setup = False

        # Save updated config to disk
        cli_config.save_config(self.cfg)

        # Start asyncio loop and agent
        self._start_async_loop_and_init_agent()

        # Wait for agent initialization
        self._init_done.wait(timeout=30)

        if self._init_error:
            if self._chat_window:
                self._chat_window.show_error(f"Agent 初始化失败: {self._init_error}")
            logger.error(f"Deferred init failed: {self._init_error}")
            return

        # Update GUI with initialized state
        if self._chat_window and not self._chat_window._destroyed:
            self._chat_window.set_status("就绪")
            self._chat_window.append_text(f"🤖 初始化完成！Model: {self.defult_config_name}\n\n", "system")
            self._update_status_bar()

    # ── Setup dialog command ────────────────────────────────────────────

    def _cmd_setup(self, args: str = "") -> None:
        """Re-open the setup dialog to change API key / configuration.

        This allows the user to reconfigure at any time via /setup
        command or tray menu "配置" option.

        IMPORTANT: After the dialog closes, re-initialization is done
        via scheduled root.after() callbacks — never blocking the
        tkinter main thread with time.sleep() or Event.wait(), which
        would cause 'main thread is not in main loop' errors.
        """
        if self._chat_window and not self._chat_window._destroyed:
            self._chat_window.append_text("📝 打开配置对话框...\n", "system")

            # DrSaiSetupDialog is a Toplevel on the existing root.
            # wait_window() enters a local event loop (nested mainloop),
            # so tkinter events are still processed during the dialog.
            dialog = DrSaiSetupDialog(self._chat_window, cfg=self.cfg)
            self._chat_window.wait_window(dialog)

            if not dialog.completed:
                self._chat_window.append_text("配置未更改。\n", "system")
                self._chat_window.append_text("──────────────────────────────────────────────\n", "separator")
                return

            # Apply the new configuration
            new_values = dialog.config_values
            self._chat_window.append_text("✅ 配置已保存！正在重新初始化...\n", "system")

            # Schedule the re-initialization steps via after() to keep
            # the tkinter main thread responsive (no blocking calls).
            self._chat_window.after(100, lambda: self._reinit_step1_close_agent(new_values))

    def _reinit_step1_close_agent(self, new_values: dict) -> None:
        """Step 1 of re-init: close the old agent and stop the asyncio loop."""
        if self.agent is not None and self._loop is not None:
            try:
                asyncio.run_coroutine_threadsafe(self._close_agent(), self._loop)
            except Exception:
                pass

            # Stop the old asyncio loop
            if self._loop and self._loop.is_running():
                self._loop.call_soon_threadsafe(self._loop.stop)

        # Schedule step 2 after giving asyncio loop time to shut down
        self._chat_window.after(1500, lambda: self._reinit_step2_reset_and_init(new_values))

    def _reinit_step2_reset_and_init(self, new_values: dict) -> None:
        """Step 2 of re-init: reset state and start new initialization."""
        # Reset state for re-initialization
        self.db_manager = None
        self.agent = None
        self.current_session_id = None
        self.current_thread = None

        # Do deferred initialization with new config
        self._deferred_init_async(new_values)

    def _deferred_init_async(self, new_cfg: dict) -> None:
        """Non-blocking version of _deferred_init for re-configuration.

        Instead of blocking with _init_done.wait(), we poll via root.after()
        to check if agent initialization has completed.
        """
        logger.info("Deferred init (async): starting after setup dialog...")

        # Update cfg with new values
        for key, val in new_cfg.items():
            if val:
                self.cfg[key] = val

        # Update derived state from cfg
        self.user_id = self.cfg.get("user_id", "anonymous")
        self.defult_config_name = self.cfg.get("defult_config_name", "hepai/minimax-m2.7-highspeed")
        self._needs_setup = False

        # Save updated config to disk
        cli_config.save_config(self.cfg)

        # Start asyncio loop and agent
        self._start_async_loop_and_init_agent()

        # Poll for completion every 500ms instead of blocking
        self._chat_window.after(500, self._poll_init_done)

    def _poll_init_done(self) -> None:
        """Poll whether agent initialization has completed (non-blocking)."""
        if self._init_done.is_set():
            # Initialization completed
            if self._init_error:
                if self._chat_window and not self._chat_window._destroyed:
                    self._chat_window.append_text(f"❌ Agent 初始化失败: {self._init_error}\n", "error")
                logger.error(f"Deferred init failed: {self._init_error}")
                return

            # Update GUI with initialized state
            if self._chat_window and not self._chat_window._destroyed:
                self._chat_window.set_status("就绪")
                self._chat_window.append_text(f"🤖 重新初始化完成！Model: {self.defult_config_name}\n\n", "system")
                self._update_status_bar()
                self._chat_window.append_text("──────────────────────────────────────────────\n", "separator")
            return

        # Not done yet — check elapsed time for timeout
        # (We started _start_async_loop_and_init_agent which sets _init_done)
        # Poll again after 500ms
        if self._chat_window and not self._chat_window._destroyed:
            self._chat_window.after(500, self._poll_init_done)

    # ── Asyncio loop ────────────────────────────────────────────────────────

    def _run_async_loop(self) -> None:
        asyncio.set_event_loop(self._loop)
        try:
            self._loop.run_forever()
        except Exception as e:
            logger.error(f"Asyncio loop error: {e}")

    # ── Agent lifecycle ─────────────────────────────────────────────────────

    async def _init_agent(self) -> None:
        try:
            WORKSPACE = Path(FS_DIR) / "workspace"
            WORKSPACE.mkdir(parents=True, exist_ok=True)
            DATASET = WORKSPACE / "drsai"
            DATASET.mkdir(parents=True, exist_ok=True)

            engine_uri = f"sqlite:///{DATASET}/drsai.db"
            self.db_manager = DatabaseManager(engine_uri=engine_uri, base_dir=str(DATASET))
            init_response = self.db_manager.initialize_database()
            if not init_response.status:
                self._init_error = f"DB init failed: {init_response.message}"
                self._init_done.set()
                return

            from drsai.backend.cli.history import CLISessionStore
            store = CLISessionStore(self.db_manager, self.user_id)

            desktop_sessions = store.search("desktop", limit=5)
            if desktop_sessions:
                info = desktop_sessions[0]
                self.current_session_id = info.thread_id
                logger.info(f"Resuming desktop session: {info.name}")
            else:
                self.current_session_id = store.create(name="desktop")
                logger.info("New desktop session: desktop")

            self.agent = create_agent(
                api_key=self.cfg.get("api_key") or None,
                thread_id=self.current_session_id,
                user_id=self.user_id,
                db_manager=self.db_manager,
                defult_config_name=self.defult_config_name,
                cli_cfg=self.cfg,
                work_dir=self._work_dir,
            )

            if hasattr(self.agent, "lazy_init"):
                await self.agent.lazy_init()

            # Update status bar to show work_dir

            state_dict = await self._load_thread_state(self.current_session_id)
            if state_dict and hasattr(self.agent, "load_state"):
                await self.agent.load_state(state_dict)

            self.current_thread = await self._get_or_create_thread(self.current_session_id)
            logger.info(f"Agent initialized (model: {self.defult_config_name})")

        except Exception as e:
            self._init_error = f"Agent init failed: {e}"
            logger.error(f"Agent init error: {e}", exc_info=True)

        self._init_done.set()

    async def _load_thread_state(self, thread_id: str) -> Optional[dict]:
        if not self.db_manager:
            return None
        response: Response = self.db_manager.get(
            Thread,
            filters={"user_id": self.user_id, "thread_id": thread_id},
            return_json=False,
        )
        if response.status and response.data:
            thread: Thread = response.data[0]
            state = thread.state
            if state:
                return decompress_state(state) if isinstance(state, str) else state
        return None

    async def _save_thread_state(self, thread_id: str, state_dict: dict) -> bool:
        if not self.db_manager:
            return False
        response: Response = self.db_manager.get(
            Thread,
            filters={"user_id": self.user_id, "thread_id": thread_id},
            return_json=False,
        )
        if response.status and response.data:
            thread: Thread = response.data[0]
            thread.state = compress_state(state_dict)
            thread.updated_at = time.time()
            return self.db_manager.upsert(thread).status
        return False

    async def _get_or_create_thread(self, thread_id: str) -> Thread:
        response: Response = self.db_manager.get(
            Thread,
            filters={"user_id": self.user_id, "thread_id": thread_id},
            return_json=False,
        )
        if response.status and response.data:
            return response.data[0]
        thread = Thread(
            user_id=self.user_id,
            thread_id=thread_id,
            status=RunStatus.CREATED,
            messages=[],
        )
        self.db_manager.upsert(thread)
        return thread

    async def _close_agent(self) -> None:
        """Save state and close the current agent."""
        if self.agent is not None:
            try:
                if hasattr(self.agent, "save_state"):
                    state_dict = await self.agent.save_state()
                    await self._save_thread_state(self.current_session_id, state_dict)
                await self.agent.close()
            except Exception:
                pass

    # ── Chat interaction ────────────────────────────────────────────────────

    async def _do_chat(self, user_input: str) -> None:
        """Run agent conversation turn and render to GUI."""
        if not self.agent:
            if self._chat_window:
                self._chat_window.show_error("Agent 未初始化，请重启。")
            return

        try:
            if self.current_thread:
                self.current_thread.status = RunStatus.ACTIVE

            renderer = DrSaiGUIRenderer(
                append_fn=self._chat_window.append_text,
                show_reasoning=self._show_reasoning,
            )

            # Set status to "思考中..."
            if self._chat_window:
                self._chat_window.set_status("思考中...")

            # Start stats tracking for this turn
            self.stats.start_turn()

            stream = self.agent.run_stream(task=user_input)
            stats_info = await renderer.render(stream)

            # ── Update session stats (mirrors run_cli.py) ──────────────────
            self.stats.end_turn(
                prompt_tokens=stats_info.get("prompt_tokens", 0),
                completion_tokens=stats_info.get("completion_tokens", 0),
                model=stats_info.get("model", ""),
            )

            # Update token_limit if model config has it
            model_alias = getattr(self.agent, '_defult_config_name', None) or self.defult_config_name
            try:
                from drsai.backend.run_drsai_agent_factory import load_llm_mode_config
                llm_config_path = os.environ.get("LLM_CONFIG_FILE") or self.cfg.get("llm_config_file")
                llm_mode_config = load_llm_mode_config(llm_config_path)
                entry = llm_mode_config.get(model_alias)
                if entry and hasattr(entry, "token_limit"):
                    self.stats.token_limit = entry.token_limit
            except Exception:
                pass

            if hasattr(self.agent, "save_state"):
                state_dict = await self.agent.save_state()
                await self._save_thread_state(self.current_session_id, state_dict)

            if self.current_thread:
                self.current_thread.status = RunStatus.COMPLETE
                self.current_thread.updated_at = time.time()
                self.db_manager.upsert(self.current_thread)

            if self._chat_window:
                # Pass enriched stats to finish_chat_turn
                finish_stats = {
                    "duration_seconds": stats_info.get("duration_seconds", 0),
                    "prompt_tokens": self.stats.prompt_tokens,
                    "completion_tokens": self.stats.completion_tokens,
                    "model": self.stats.last_model,
                    "turns": self.stats.turns,
                    "token_limit": self.stats.token_limit,
                }
                self._chat_window.finish_chat_turn(stats=finish_stats)
                # Update persistent status bar with session info
                self._update_status_bar()

        except asyncio.CancelledError:
            if self._chat_window:
                self._chat_window.append_text("\n⚠ 对话已中断\n", "system")
                self._chat_window.finish_chat_turn()
                self._chat_window.set_status("就绪")
                self._update_status_bar()
            if self.agent:
                try:
                    await self.agent.pause()
                    await asyncio.sleep(0.1)
                    await self.agent.resume()
                except Exception:
                    pass

        except Exception as e:
            logger.error(f"Chat error: {e}", exc_info=True)
            if self._chat_window:
                self._chat_window.show_error(f"对话出错: {e}")
                self._chat_window.set_status("就绪")
                self._update_status_bar()

    # ── Bottom toolbar & status bar (mirrors run_cli.py) ────────────────────

    def _bottom_toolbar(self) -> str:
        """Build a bottom toolbar string like run_cli.py's _bottom_toolbar."""
        model_name = getattr(self.agent, '_defult_config_name', None) or self.cfg.get("defult_config_name") or "auto"
        if len(model_name) > 40:
            model_name = model_name[:37] + "..."

        session_label = self.current_session_id[:8] if self.current_session_id else "N/A"
        # Show work_dir (abbreviated) — mirrors CLI's cwd in bottom_toolbar
        work_dir_short = Path(self._work_dir).name if len(self._work_dir) > 40 else self._work_dir
        parts = [f"{self.user_id} @ {model_name}  │  session: {session_label}  │  📂 {work_dir_short}"]

        if self.stats.turns:
            total_tok = self.stats.prompt_tokens + self.stats.completion_tokens
            parts.append(f"turns: {self.stats.turns}")
            parts.append(f"tok: {self.stats.prompt_tokens}→{self.stats.completion_tokens} ({total_tok})")

        if self._show_reasoning:
            parts.append("reasoning: on")

        injected_prefix = getattr(self.agent, '_injected_prefix', "") or ""
        if injected_prefix:
            parts.append("plan_mode: on")

        ws_enabled = getattr(self.agent, '_only_in_workspace', None)
        if ws_enabled is True:
            parts.append("🔒 ws:on")
        elif ws_enabled is False:
            parts.append("🔓 ws:off")

        dangerous_allowed = getattr(self.agent, '_get_dangerous_allowed', None)
        if dangerous_allowed is not None:
            da = dangerous_allowed()
            if da:
                parts.append("⚠️  dg:on")
            else:
                parts.append("🛡 dg:off")

        return "  ·  ".join(parts)

    def _update_status_bar(self) -> None:
        """Update the GUI status bar with bottom toolbar content."""
        if self._chat_window and not self._chat_window._destroyed:
            toolbar_text = self._bottom_toolbar()
            self._chat_window.set_status_info(toolbar_text)

    # ── Slash command dispatch ───────────────────────────────────────────────

    def _on_command(self, cmd_name: str, cmd_args: str) -> bool:
        """Dispatch a slash command from the GUI input.

        Returns True if the command was handled locally (no agent chat needed).
        Returns False if the command should be sent as a normal chat message.
        """
        # ── Local-only commands (no async needed) ────────────────────────────
        if cmd_name in ("help", "h", "?"):
            self._cmd_help()
            return True

        if cmd_name in ("quit", "exit", "q"):
            self._on_quit()
            return True

        if cmd_name in ("clear", "cls"):
            self._cmd_clear()
            return True

        if cmd_name in ("config",):
            self._cmd_config()
            return True

        if cmd_name in ("info",):
            self._cmd_info()
            return True

        if cmd_name in ("list", "ls"):
            asyncio.run_coroutine_threadsafe(self._cmd_list(), self._loop)
            return True

        if cmd_name in ("models", "listmodels"):
            self._cmd_models(cmd_args)
            return True

        if cmd_name in ("verbose",):
            self._cmd_verbose()
            return True

        if cmd_name in ("copy",):
            asyncio.run_coroutine_threadsafe(self._cmd_copy(cmd_args), self._loop)
            return True

        # ── Async commands (need asyncio loop) ──────────────────────────────
        if cmd_name in ("new",):
            asyncio.run_coroutine_threadsafe(self._cmd_new(cmd_args), self._loop)
            return True

        if cmd_name in ("switch",):
            asyncio.run_coroutine_threadsafe(self._cmd_switch(cmd_args), self._loop)
            return True

        if cmd_name in ("resume",):
            asyncio.run_coroutine_threadsafe(self._cmd_resume(cmd_args), self._loop)
            return True

        if cmd_name in ("model", "m"):
            asyncio.run_coroutine_threadsafe(self._cmd_model(cmd_args), self._loop)
            return True

        if cmd_name in ("model_global", "mg"):
            asyncio.run_coroutine_threadsafe(self._cmd_model_global(cmd_args), self._loop)
            return True

        if cmd_name in ("reasoning",):
            asyncio.run_coroutine_threadsafe(self._cmd_reasoning(cmd_args), self._loop)
            return True

        if cmd_name in ("status",):
            asyncio.run_coroutine_threadsafe(self._cmd_status(), self._loop)
            return True

        if cmd_name in ("plan_mode", "pm"):
            asyncio.run_coroutine_threadsafe(self._cmd_plan_mode(cmd_args), self._loop)
            return True

        if cmd_name in ("pm_global", "pmg"):
            asyncio.run_coroutine_threadsafe(self._cmd_plan_mode_global(cmd_args), self._loop)
            return True

        if cmd_name in ("retry",):
            self._cmd_retry()
            return True

        if cmd_name in ("history",):
            asyncio.run_coroutine_threadsafe(self._cmd_history(), self._loop)
            return True

        if cmd_name in ("search",):
            asyncio.run_coroutine_threadsafe(self._cmd_search(cmd_args), self._loop)
            return True

        if cmd_name in ("rename",):
            asyncio.run_coroutine_threadsafe(self._cmd_rename(cmd_args), self._loop)
            return True

        if cmd_name in ("install",):
            self._cmd_install(cmd_args)
            return True

        if cmd_name in ("setup", "env", "config_gui"):
            self._cmd_setup(cmd_args)
            return True

        if cmd_name in ("tray",):
            self._cmd_tray(cmd_args)
            return True

        if cmd_name in ("dangerous", "dg"):
            asyncio.run_coroutine_threadsafe(self._cmd_dangerous(cmd_args), self._loop)
            return True

        if cmd_name in ("workspace", "ws"):
            asyncio.run_coroutine_threadsafe(self._cmd_workspace(cmd_args), self._loop)
            return True

        if cmd_name in ("inject",):
            asyncio.run_coroutine_threadsafe(self._cmd_inject(cmd_args), self._loop)
            return True

        if cmd_name in ("bell",):
            self._cmd_bell(cmd_args)
            return True

        if cmd_name in ("fast",):
            asyncio.run_coroutine_threadsafe(self._cmd_fast(cmd_args), self._loop)
            return True

        if cmd_name in ("save",):
            self._cmd_save()
            return True

        if cmd_name in ("init",):
            self._cmd_init()
            return True

        if cmd_name in ("memory",):
            asyncio.run_coroutine_threadsafe(self._cmd_memory(cmd_args), self._loop)
            return True

        if cmd_name in ("cd", "workdir"):
            self._cmd_cd(cmd_args)
            return True

        # ── Unknown command → let it go as chat message ─────────────────────
        return False

    # ── Command implementations ──────────────────────────────────────────────

    def _cmd_help(self) -> None:
        """Show help text in the chat display."""
        help_text = format_help()
        for line in help_text.split("\n"):
            self._chat_window.append_text(line + "\n", "help")
        self._chat_window.append_text("──────────────────────────────────────────────\n", "separator")

    def _cmd_tray(self, args: str) -> None:
        """Check tray icon status or recreate it.

        Subcommands:
            status  — Show tray icon state (default)
            create  — Recreate tray icon (if it disappeared)
            hide    — Remove tray icon temporarily
        """
        arg = args.strip().lower()

        if arg in ("status", ""):
            # Show tray icon status
            if self._tray_app is None:
                self._chat_window.append_text("❌ 系统托盘图标未创建\n", "error")
                self._chat_window.append_text("   可能原因: pystray 未安装，或创建时出错\n", "system")
                self._chat_window.append_text("   修复: pip install drsai[tray]，然后输入 /tray create\n", "system")
            elif not self._tray_app.is_running:
                self._chat_window.append_text("⚠ 系统托盘图标已停止运行\n", "system")
                self._chat_window.append_text("   输入 /tray create 重新创建\n", "system")
            else:
                icon = self._tray_app._icon
                lines = [
                    "✅ 系统托盘图标运行中\n",
                ]
                if icon:
                    for attr, label in [
                        ("_visible", "可见性"),
                        ("_icon_valid", "图标有效性"),
                        ("_running", "运行状态"),
                    ]:
                        try:
                            val = getattr(icon, attr, "N/A")
                            lines.append(f"   {label}: {val}\n")
                        except Exception:
                            lines.append(f"   {label}: 无法检查\n")
                    if hasattr(icon, "_thread") and icon._thread:
                        lines.append(f"   线程活跃: {icon._thread.is_alive()}\n")
                lines.append(
                    "\n   💡 如果看不到图标，请点击任务栏右下角的 ↑ 箭头\n"
                    "   查看溢出区域（hidden icons overflow area）。\n\n"
                    "   Windows设置 → 任务栏 → 通知区域 → 选择哪些图标显示\n"
                    "   可以将 DrSai 设为「始终显示」。\n"
                )
                self._chat_window.append_text("\n".join(lines), "system")

        elif arg in ("create", "start", "restart"):
            # Recreate tray icon
            try:
                if self._tray_app:
                    self._tray_app.stop()
                    self._tray_app = None

                self._tray_app = DrSaiTrayApp(
                    show_window_fn=self._on_show_window,
                    setup_fn=self._on_setup_from_tray,
                    quit_fn=self._on_quit,
                    title=f"DrSai — {self.defult_config_name}",
                )
                self._tray_app.run_detached()
                self._chat_window.append_text("✅ 系统托盘图标已重新创建\n", "system")
            except Exception as e:
                self._chat_window.append_text(f"❌ 创建托盘图标失败: {e}\n", "error")
                self._tray_app = None

        elif arg in ("hide", "stop", "remove"):
            # Temporarily hide tray icon
            if self._tray_app:
                self._tray_app.stop()
                self._chat_window.append_text("⚠ 系统托盘图标已隐藏\n", "system")
                self._chat_window.append_text("   输入 /tray create 重新创建\n", "system")
            else:
                self._chat_window.append_text("托盘图标不存在\n", "system")

        else:
            self._chat_window.append_text(
                "Usage: /tray [status|create|hide]\n"
                "  /tray           — 显示托盘图标状态\n"
                "  /tray create    — 重新创建托盘图标\n"
                "  /tray hide      — 隐藏托盘图标\n",
                "system",
            )

        self._chat_window.append_text("──────────────────────────────────────────────\n", "separator")

    def _cmd_clear(self) -> None:
        """Clear the chat display."""
        # Clear ScrolledText content
        self._chat_window.after(0, lambda: (
            self._chat_window.chat_display.config(state="normal"),
            self._chat_window.chat_display.delete("1.0", tk.END),
            self._chat_window.chat_display.config(state="disabled"),
            self._chat_window.append_text("🤖 屏幕已清除。继续对话或输入 /help。\n\n", "system"),
        ))

    def _cmd_config(self) -> None:
        """Show current configuration."""
        cli_config.show_config(self.cfg)
        # Show in GUI - use config_as_dict_for_export for env-aware masking

        from drsai.backend.cli.config import config_as_dict_for_export
        safe_cfg = config_as_dict_for_export(self.cfg)
        lines = ["\n  Current configuration:\n"]
        for k, v in safe_cfg.items():
            lines.append(f"    {k}: {v}")
        lines.append("")
        self._chat_window.append_text("\n".join(lines), "system")
        self._chat_window.append_text("──────────────────────────────────────────────\n", "separator")

    def _cmd_info(self) -> None:
        """Show session configuration, tools and skills."""
        model_name = getattr(self.agent, '_defult_config_name', None) or self.cfg.get("defult_config_name") or "auto"
        tools = []
        if self.agent:
            if hasattr(self.agent, '_workbench') and hasattr(self.agent._workbench, '_tools'):
                tools = [t.name for t in self.agent._workbench._tools]
            elif hasattr(self.agent, '_tools'):
                tools = [t.name for t in self.agent._tools]

        lines = [
            f"\n  Session info:",
            f"    user_id:       {self.cfg.get('user_id', 'anonymous')}",
            f"    model:          {model_name}",
            f"    session_id:     {self.current_session_id[:8] if self.current_session_id else 'N/A'}",
            f"    tools count:    {len(tools)}",
            f"    tools:          {', '.join(tools[:10])}{'...' if len(tools) > 10 else ''}",
            f"    reasoning:      {'on' if self._show_reasoning else 'off'}",
            f"    plan_mode:      {'on' if getattr(self.agent, '_injected_prefix', '') else 'off'}",
            "",
        ]
        self._chat_window.append_text("\n".join(lines), "system")
        self._chat_window.append_text("──────────────────────────────────────────────\n", "separator")

    async def _cmd_list(self) -> None:
        """List all sessions."""
        from drsai.backend.cli.history import CLISessionStore
        store = CLISessionStore(self.db_manager, self.user_id)
        infos = store.list(limit=50)
        if not infos:
            self._chat_window.append_text("No sessions found.\n", "system")
            return

        lines = ["\n  Sessions:\n"]
        for info in infos:
            cur = " ← current" if info.thread_id == self.current_session_id else ""
            lines.append(f"    [{info.thread_id[:8]}] {info.name:<20} msgs={info.message_count:<3} {info.updated_at[:19]}{cur}")
        lines.append("")
        self._chat_window.append_text("\n".join(lines), "system")
        self._chat_window.append_text("──────────────────────────────────────────────\n", "separator")

    def _cmd_models(self, args: str) -> None:
        """List available models."""
        from drsai.backend.run_drsai_agent_factory import load_llm_mode_config

        llm_config_path = os.environ.get("LLM_CONFIG_FILE") or self.cfg.get("llm_config_file")
        llm_mode_config = load_llm_mode_config(llm_config_path)

        current = getattr(self.agent, '_defult_config_name', None) or self.cfg.get("defult_config_name") or "auto"

        lines = [f"\n  Available models ({len(llm_mode_config)} total):\n"]
        for alias in sorted(llm_mode_config.keys()):
            marker = "→" if alias == current else " "
            entry = llm_mode_config[alias]
            reasoning = entry.reasoning
            r_str = "✅" if reasoning.supported else "❌"
            lines.append(f"  {marker} {alias:<35} {r_str}")

        lines.append("")
        lines.append("  Usage: /model <alias>  to switch")
        lines.append("")
        self._chat_window.append_text("\n".join(lines), "help")
        self._chat_window.append_text("──────────────────────────────────────────────\n", "separator")

    def _cmd_verbose(self) -> None:
        """Toggle stats footer display."""
        # In GUI mode, stats are always shown; just acknowledge
        self._chat_window.append_text("Stats footer: always on in GUI mode\n", "system")
        self._chat_window.append_text("──────────────────────────────────────────────\n", "separator")

    async def _cmd_copy(self, args: str) -> None:
        """Copy assistant reply to clipboard."""
        try:
            n = int(args.strip()) if args.strip() else 1
        except ValueError:
            self._chat_window.append_text("Usage: /copy [n]\n", "system")
            return

        from drsai.backend.cli.history import CLISessionStore
        store = CLISessionStore(self.db_manager, self.user_id)
        msgs = store.load(self.current_session_id)
        assistant_msgs = [
            m for m in msgs
            if isinstance(m, dict)
            and (m.get("source") or m.get("role") or "").lower() not in ("user", "system")
        ]
        if n > len(assistant_msgs):
            self._chat_window.append_text(f"Only {len(assistant_msgs)} assistant message(s).\n", "system")
            return

        target = assistant_msgs[-n]
        text = target.get("content") or ""
        if isinstance(text, list):
            text = "\n".join(str(p) for p in text)

        try:
            import pyperclip
            pyperclip.copy(str(text))
            self._chat_window.append_text(f"Copied {len(str(text))} chars to clipboard.\n", "system")
        except Exception:
            self._chat_window.append_text(f"Clipboard unavailable. Text length: {len(str(text))} chars.\n", "system")

        self._chat_window.append_text("──────────────────────────────────────────────\n", "separator")

    def _cmd_retry(self) -> None:
        """Retry — last user message is re-sent as chat."""
        # Find last user message from history
        if self._chat_window and self._chat_window._input_history:
            last_msg = self._chat_window._input_history[-1]
            if not last_msg.startswith("/"):
                self._chat_window.append_text(f"Retrying: {last_msg[:60]}…\n", "system")
                asyncio.run_coroutine_threadsafe(self._do_chat(last_msg), self._loop)
            else:
                self._chat_window.append_text("Last input was a command, not a chat message.\n", "system")
        else:
            self._chat_window.append_text("Nothing to retry.\n", "system")
        self._chat_window.append_text("──────────────────────────────────────────────\n", "separator")

    async def _cmd_history(self) -> None:
        """Show conversation history."""
        from drsai.backend.cli.history import CLISessionStore
        store = CLISessionStore(self.db_manager, self.user_id)
        msgs = store.load(self.current_session_id)
        if not msgs:
            self._chat_window.append_text("(no conversation yet)\n", "system")
            return
        lines = [""]
        for i, m in enumerate(msgs, 1):
            if not isinstance(m, dict):
                continue
            role = (m.get("source") or m.get("role") or "?").lower()
            content = m.get("content") or ""
            if isinstance(content, list):
                content = " ".join(str(p) for p in content)
            truncated = str(content)[:80].replace("\n", " ")
            if len(str(content)) > 80:
                truncated += "…"
            lines.append(f"  [{i}] {role}: {truncated}")
        lines.append("")
        self._chat_window.append_text("\n".join(lines), "system")
        self._chat_window.append_text("──────────────────────────────────────────────\n", "separator")

    async def _cmd_search(self, args: str) -> None:
        """Search sessions."""
        if not args:
            self._chat_window.append_text("Usage: /search <query>\n", "system")
            return
        from drsai.backend.cli.history import CLISessionStore
        store = CLISessionStore(self.db_manager, self.user_id)
        hits = store.search(args.strip(), limit=15)
        if not hits:
            self._chat_window.append_text("No matches.\n", "system")
            return
        lines = ["\n  Search results:\n"]
        for info in hits:
            lines.append(f"    [{info.thread_id[:8]}] {info.name:<20} msgs={info.message_count} {info.preview[:50]}")
        lines.append("")
        self._chat_window.append_text("\n".join(lines), "system")
        self._chat_window.append_text("──────────────────────────────────────────────\n", "separator")

    async def _cmd_rename(self, args: str) -> None:
        """Rename current session."""
        if not args:
            self._chat_window.append_text("Usage: /rename <new name>\n", "system")
            return
        from drsai.backend.cli.history import CLISessionStore
        store = CLISessionStore(self.db_manager, self.user_id)
        if store.rename(self.current_session_id, args.strip()):
            self._chat_window.append_text(f"Session renamed to: {args.strip()}\n", "system")
        else:
            self._chat_window.append_text("Rename failed.\n", "error")
        self._chat_window.append_text("──────────────────────────────────────────────\n", "separator")

    def _cmd_install(self, args: str) -> None:
        """Create desktop shortcut or manage icon assets.

        Subcommands:
            shortcut  — Create desktop shortcut (.lnk) for drsai-tray
            icons     — Generate icon files only (no shortcut)
            uninstall — Remove desktop shortcut
        """
        arg = args.strip().lower()

        if arg in ("shortcut", ""):
            # Default: install shortcut
            from .shortcut_installer import install_desktop_shortcut
            result = install_desktop_shortcut()
            if result["status"] == "ok":
                self._chat_window.append_text(result["message"] + "\n", "system")
            else:
                self._chat_window.append_text(result["message"] + "\n", "error")

        elif arg in ("icons", "icon"):
            # Only generate icon files
            from .shortcut_installer import ensure_icon_files
            files = ensure_icon_files()
            lines = ["\n  Icon files generated:\n"]
            for key, path in files.items():
                lines.append(f"    {key}: {path}")
            lines.append("")
            self._chat_window.append_text("\n".join(lines), "system")

        elif arg in ("uninstall", "remove", "rm"):
            # Remove desktop shortcut
            from .shortcut_installer import uninstall_desktop_shortcut
            result = uninstall_desktop_shortcut()
            self._chat_window.append_text(result["message"] + "\n", "system")

        else:
            self._chat_window.append_text(
                "Usage: /install [shortcut|icons|uninstall]\n"
                "  /install           — Create desktop shortcut\n"
                "  /install icons     — Generate icon files only\n"
                "  /install uninstall — Remove desktop shortcut\n",
                "system",
            )

        self._chat_window.append_text("──────────────────────────────────────────────\n", "separator")

    async def _cmd_dangerous(self, args: str) -> None:
        """Toggle dangerous command execution permission on/off or show status.

        When disabled (default), both dangerous commands (sudo, rm -rf, etc.)
        and script execution (python, bash, sh) are blocked.
        When enabled (/dg on), all commands are allowed.
        """
        arg = args.strip().lower()
        if not self.agent:
            self._chat_window.append_text("Agent not initialized.\n", "error")
            return

        # Find toggle helpers
        toggle_funcs = getattr(self.agent, '_dangerous_toggle_funcs', [])
        set_fn = next((f for f in toggle_funcs if f.__name__ == "set_dangerous_allowed"), None)
        get_fn = next((f for f in toggle_funcs if f.__name__ == "get_dangerous_status"), None)

        if not set_fn or not get_fn:
            self._chat_window.append_text("Dangerous toggle functions not available.\n", "system")
            return

        if arg in ("on", "1", "true", "enable"):
            result = set_fn(True)
            self._chat_window.append_text("⚠️ Dangerous command execution allowed\n", "system")
            self._chat_window.append_text("  sudo, rm -rf, python, bash, sh 等命令将不再被拦截。\n", "system")
            self._chat_window.append_text("  使用 /dg off 重新启用保护。\n\n", "system")
            # Persist state
            state_dict = await self.agent.save_state()
            await self._save_thread_state(self.current_session_id, state_dict)

        elif arg in ("off", "0", "false", "disable"):
            result = set_fn(False)
            self._chat_window.append_text("🛡 Dangerous command protection enabled\n", "system")
            self._chat_window.append_text("  sudo, rm -rf, python, bash, sh 等命令将被拦截。\n", "system")
            # Persist state
            state_dict = await self.agent.save_state()
            await self._save_thread_state(self.current_session_id, state_dict)

        elif arg in ("status", ""):
            status = get_fn()
            allowed = status.get('dangerous_allowed', False)
            icon = "⚠️" if allowed else "🛡"
            state_str = 'ALLOWED' if allowed else 'BLOCKED (dangerous + script exec filtered)'
            self._chat_window.append_text(f"{icon} Dangerous command protection: {state_str}\n", "system")
            self._chat_window.append_text("\n  Usage: /dg [on|off|status]\n", "system")

        else:
            self._chat_window.append_text("Usage: /dg [on|off|status]\n", "system")
            self._chat_window.append_text("  on    — Allow all dangerous and script execution commands\n", "system")
            self._chat_window.append_text("  off   — Block dangerous commands (default)\n", "system")
            self._chat_window.append_text("  status — Show current status (default)\n", "system")

        self._chat_window.append_text("──────────────────────────────────────────────\n", "separator")
        self._update_status_bar()

    async def _cmd_workspace(self, args: str) -> None:
        """Toggle workspace restriction (only_in_workspace) on/off or show status."""
        arg = args.strip().lower()
        if not self.agent:
            self._chat_window.append_text("Agent not initialized.\n", "error")
            return

        # Find toggle helpers
        toggle_funcs = getattr(self.agent, '_workspace_toggle_funcs', [])
        set_fn = next((f for f in toggle_funcs if f.__name__ == "set_workspace_restriction"), None)
        get_fn = next((f for f in toggle_funcs if f.__name__ == "get_workspace_status"), None)

        if not set_fn or not get_fn:
            self._chat_window.append_text("Workspace toggle functions not available.\n", "system")
            return

        if arg in ("on", "1", "true", "enable"):
            result = set_fn(True)
            self.agent._only_in_workspace = True
            status = get_fn()
            self._chat_window.append_text("🔒 Workspace restriction enabled\n", "system")
            self._chat_window.append_text(f"  Work dir:  {status['work_dir']}\n", "system")
            allowed = status['allowed_dirs']
            if len(allowed) > 3:
                shown = allowed[:3]
                self._chat_window.append_text(f"  Allowed:   {', '.join(str(d) for d in shown)}, ... ({len(allowed)} dirs)\n", "system")
            else:
                self._chat_window.append_text(f"  Allowed:   {', '.join(str(d) for d in allowed)}\n", "system")
            # Persist state
            state_dict = await self.agent.save_state()
            await self._save_thread_state(self.current_session_id, state_dict)

        elif arg in ("off", "0", "false", "disable"):
            result = set_fn(False)
            self.agent._only_in_workspace = False
            self._chat_window.append_text("🔓 Workspace restriction disabled\n", "system")
            self._chat_window.append_text("  Agent can now access any path on the filesystem.\n", "system")
            # Persist state
            state_dict = await self.agent.save_state()
            await self._save_thread_state(self.current_session_id, state_dict)

        elif arg in ("status", ""):
            status = get_fn()
            enabled = status['only_in_workspace']
            icon = "🔒" if enabled else "🔓"
            state_str = 'enabled' if enabled else 'disabled'
            self._chat_window.append_text(f"{icon} Workspace restriction: {state_str}\n", "system")
            self._chat_window.append_text(f"  Work dir:  {status['work_dir']}\n", "system")
            allowed = status['allowed_dirs']
            self._chat_window.append_text(f"  Allowed:   {', '.join(str(d) for d in allowed[:3])}{'...' if len(allowed) > 3 else ''}\n", "system")
            self._chat_window.append_text("\n  Usage: /ws [on|off|status]\n", "system")

        else:
            self._chat_window.append_text("Usage: /ws [on|off|status]\n", "system")

        self._chat_window.append_text("──────────────────────────────────────────────\n", "separator")
        self._update_status_bar()

    async def _cmd_inject(self, args: str) -> None:
        """Inject custom prompt into system message."""
        if not self.agent:
            self._chat_window.append_text("Agent not initialized.\n", "error")
            return

        parts = args.strip().split(maxsplit=1)
        if not parts:
            self._chat_window.append_text("Usage: /inject [prefix|suffix|clear|status] [text]\n", "system")
            return

        action = parts[0].lower()
        text = parts[1] if len(parts) > 1 else ""
        needs_persist = False

        if action == "prefix":
            if not text:
                self._chat_window.append_text("Usage: /inject prefix <text>\n", "system")
                return
            self.agent.inject_system_prompt(prefix=text)
            needs_persist = True
            preview = text[:60] + "..." if len(text) > 60 else text
            self._chat_window.append_text(f"✓ Prefix injected: \"{preview}\"\n", "system")

        elif action == "suffix":
            if not text:
                self._chat_window.append_text("Usage: /inject suffix <text>\n", "system")
                return
            self.agent.inject_system_prompt(suffix=text)
            needs_persist = True
            preview = text[:60] + "..." if len(text) > 60 else text
            self._chat_window.append_text(f"✓ Suffix injected: \"{preview}\"\n", "system")

        elif action == "clear":
            self.agent.inject_system_prompt(prefix="", suffix="")
            needs_persist = True
            self._chat_window.append_text("⚠ All injected prompts cleared\n", "system")

        elif action == "status":
            prefix = getattr(self.agent, '_injected_prefix', "") or "(none)"
            suffix = getattr(self.agent, '_injected_suffix', "") or "(none)"
            if len(prefix) > 100:
                prefix = prefix[:100] + "..."
            if len(suffix) > 100:
                suffix = suffix[:100] + "..."
            self._chat_window.append_text("Current injected prompts:\n", "system")
            self._chat_window.append_text(f"  Prefix: \"{prefix}\"\n", "system")
            self._chat_window.append_text(f"  Suffix: \"{suffix}\"\n", "system")

        else:
            self._chat_window.append_text("Usage: /inject [prefix|suffix|clear|status] [text]\n", "system")

        if needs_persist:
            state_dict = await self.agent.save_state()
            await self._save_thread_state(self.current_session_id, state_dict)
            self._update_status_bar()

        self._chat_window.append_text("──────────────────────────────────────────────\n", "separator")

    def _cmd_save(self) -> None:
        """Save current session (auto-saved stub)."""
        session_label = f"[{self.current_session_id[:8]}]" if self.current_session_id else "N/A"
        self._chat_window.append_text(f"Session: {session_label} (auto-saved)\n", "system")
        self._chat_window.append_text("──────────────────────────────────────────────\n", "separator")

    def _cmd_bell(self, args: str) -> None:
        """Toggle bell notification when response finishes."""
        arg = args.strip().lower()
        if arg in ("on", "true", "1"):
            self.stats.ring_bell = True
        elif arg in ("off", "false", "0"):
            self.stats.ring_bell = False
        else:
            self.stats.ring_bell = not self.stats.ring_bell
        state_str = 'on' if self.stats.ring_bell else 'off'
        self._chat_window.append_text(f"Bell: {state_str}\n", "system")
        self._chat_window.append_text("──────────────────────────────────────────────\n", "separator")

    async def _cmd_fast(self, args: str) -> None:
        """Switch to the fastest model alias in the catalog (session-local)."""
        arg = args.strip().lower()
        from drsai.backend.run_drsai_agent_factory import load_llm_mode_config
        llm_config_path = os.environ.get("LLM_CONFIG_FILE") or self.cfg.get("llm_config_file")
        catalog = load_llm_mode_config(llm_config_path)
        fast_alias = next(
            (k for k in catalog if "highspeed" in k or "flash" in k or "haiku" in k),
            None,
        )
        if fast_alias is None:
            self._chat_window.append_text("No obviously-fast alias in the catalog; set one via /model.\n", "system")
            self._chat_window.append_text("──────────────────────────────────────────────\n", "separator")
            return

        if arg == "off":
            # Switch back to the default alias
            default_alias = next(iter(catalog))
            if self.agent is not None and hasattr(self.agent, '_set_model_client'):
                try:
                    new_client = self.agent._set_model_client(default_alias)
                    await self.agent.switch_model(new_client)
                    self.agent._defult_config_name = default_alias
                    self._chat_window.append_text(f"Fast mode off — switched back to {default_alias} (session-local)\n", "system")
                    entry = catalog.get(default_alias)
                    if entry and hasattr(entry, "token_limit"):
                        self.stats.token_limit = entry.token_limit
                    state_dict = await self.agent.save_state()
                    await self._save_thread_state(self.current_session_id, state_dict)
                except Exception as e:
                    self._chat_window.append_text(f"Warning: model switch failed: {e}\n", "system")
            else:
                self._chat_window.append_text(f"Fast mode off — alias back to {default_alias}\n", "system")
            self._update_status_bar()
            self._chat_window.append_text("──────────────────────────────────────────────\n", "separator")
            return

        # Switch to fast model (session-local)
        if self.agent is not None and hasattr(self.agent, '_set_model_client'):
            try:
                new_client = self.agent._set_model_client(fast_alias)
                await self.agent.switch_model(new_client)
                self.agent._defult_config_name = fast_alias
                self._chat_window.append_text(f"Fast mode on — switched to {fast_alias} (session-local)\n", "system")
                entry = catalog.get(fast_alias)
                if entry and hasattr(entry, "token_limit"):
                    self.stats.token_limit = entry.token_limit
                state_dict = await self.agent.save_state()
                await self._save_thread_state(self.current_session_id, state_dict)
            except Exception as e:
                self._chat_window.append_text(f"Warning: model switch failed: {e}\n", "system")
        else:
            self._chat_window.append_text(f"Fast mode on — alias set to {fast_alias}\n", "system")
        self._update_status_bar()
        self._chat_window.append_text("──────────────────────────────────────────────\n", "separator")

    def _cmd_init(self) -> None:
        """Create DRSAI.md project instructions file in current directory."""
        from drsai.backend.cli.drsaimd_loader import init_project_instructions
        filepath, is_new = init_project_instructions(self._work_dir)
        if is_new:
            self._chat_window.append_text(f"✓ Created project instructions at: {filepath}\n", "system")
            self._chat_window.append_text("  Edit this file to add project-specific instructions.\n", "system")
            self._chat_window.append_text("  Use /memory reload to apply changes to the current session.\n\n", "system")
            self._chat_window.append_text("  Tip: Add DRSAI.local.md for personal preferences (auto-ignored by git).\n", "system")
        else:
            self._chat_window.append_text(f"⚠ Project instructions already exists at: {filepath}\n", "system")
            self._chat_window.append_text("  Edit it manually. Use /memory reload after editing.\n", "system")
        self._chat_window.append_text("──────────────────────────────────────────────\n", "separator")

    async def _cmd_memory(self, args: str) -> None:
        """View/reload project-level instructions (DRSAI.md / CLAUDE.md)."""
        from drsai.backend.cli.drsaimd_loader import (
            load_project_instructions,
            get_memory_status,
        )

        arg = args.strip().lower()

        if arg == "reload":
            if not self.agent:
                self._chat_window.append_text("Agent not initialized.\n", "error")
                return

            project_instructions, loaded_paths = load_project_instructions(self._work_dir)
            prefix = getattr(self.agent, '_injected_prefix', '') or ''
            suffix = getattr(self.agent, '_injected_suffix', '') or ''
            self.agent.inject_system_prompt(
                prefix=prefix,
                suffix=suffix,
                project_instructions=project_instructions,
            )

            if loaded_paths:
                self._chat_window.append_text("✓ Project instructions reloaded:\n", "system")
                for p in loaded_paths:
                    short_path = os.path.basename(p)
                    try:
                        lines_count = len(Path(p).read_text(encoding="utf-8").split("\n"))
                        self._chat_window.append_text(f"    {short_path} ({lines_count} lines)\n", "system")
                    except Exception:
                        self._chat_window.append_text(f"    {short_path}\n", "system")
            else:
                self._chat_window.append_text("ℹ No project instruction files found.\n", "system")
                self._chat_window.append_text("  Use /init to create one.\n", "system")

            state_dict = await self.agent.save_state()
            await self._save_thread_state(self.current_session_id, state_dict)
            self._chat_window.append_text("──────────────────────────────────────────────\n", "separator")
            return

        if arg == "status":
            if not self.agent:
                self._chat_window.append_text("Agent not initialized.\n", "error")
                return

            prefix = getattr(self.agent, '_injected_prefix', "") or ""
            suffix = getattr(self.agent, '_injected_suffix', "") or ""
            project_instr = getattr(self.agent, '_project_instructions', '') or ""

            lines = [
                "\n  System prompt layers:",
                f"  {'─' * 60}",
                f"  ① Prefix (session):          {len(prefix)} chars",
            ]
            if prefix:
                preview = prefix[:80].replace("\n", " ")
                if len(prefix) > 80:
                    preview += "..."
                lines.append(f"     Preview: \"{preview}\"")
            lines.append(f"  ② Developer msg (hardcoded): {len(self.agent._developer_system_message)} chars")
            user_sys = self.agent._user_profile_manager.get_agent_system_prompt()
            lines.append(f"  ③ AGENTS.md (global):         {len(user_sys)} chars")
            lines.append(f"  ④ Project instructions:       {len(project_instr)} chars")
            if project_instr:
                mem_status = get_memory_status(self._work_dir)
                for f in mem_status.get("project_files", []):
                    lines.append(f"     Source: {f['path']} ({f['lines']} lines, {f['scope']})")
            lines.append(f"  ⑤ Session_ID:                 fixed")
            lines.append(f"  ⑥ Suffix (session):           {len(suffix)} chars")
            if suffix:
                preview = suffix[:80].replace("\n", " ")
                if len(suffix) > 80:
                    preview += "..."
                lines.append(f"     Preview: \"{preview}\"")
            lines.append(f"  {'─' * 60}")
            lines.append("")
            self._chat_window.append_text("\n".join(lines), "system")
            self._chat_window.append_text("──────────────────────────────────────────────\n", "separator")
            return

        # Default: show project instruction files
        mem_status = get_memory_status(self._work_dir)
        org = mem_status.get("org_file")
        project_files = mem_status.get("project_files", [])
        total_lines = mem_status.get("total_lines", 0)
        total_size_kb = mem_status.get("total_size_kb", 0.0)

        if not project_files and not org:
            self._chat_window.append_text("\n  No project instruction files found in current directory.\n\n", "system")
            self._chat_window.append_text("  Use /init to create one, or place DRSAI.md / CLAUDE.md in your project.\n", "system")
            self._chat_window.append_text("  Project instructions are loaded from:\n", "system")
            self._chat_window.append_text("    - .drsai/DRSAI.md  or  .drsai/CLAUDE.md\n", "system")
            self._chat_window.append_text("    - DRSAI.md         or  CLAUDE.md        (in project root)\n", "system")
            self._chat_window.append_text("    - DRSAI.local.md   or  CLAUDE.local.md  (personal, gitignored)\n\n", "system")
            self._chat_window.append_text("──────────────────────────────────────────────\n", "separator")
            return

        lines = [
            "\n  Project instruction files (loaded at session start):",
            f"  {'─' * 60}",
        ]
        if org:
            lines.append(f"  🏢 Organization: {org['path']} ({org['lines']} lines)")
        for f in project_files:
            icon = "🔒" if "local" in f["scope"] else "📁"
            lines.append(f"  {icon} {f['path']:<50} {f['lines']} lines  {f['size_kb']}KB  ({f['scope']})")
        lines.append(f"  {'─' * 60}")
        lines.append(f"  Total: {total_lines} lines, {total_size_kb}KB")
        lines.append("")
        lines.append("  Commands:")
        lines.append("    /memory reload  - Reload after editing DRSAI.md")
        lines.append("    /memory status  - Show all system prompt layers")
        lines.append("    /init           - Create DRSAI.md for this project")
        lines.append("")
        self._chat_window.append_text("\n".join(lines), "system")
        self._chat_window.append_text("──────────────────────────────────────────────\n", "separator")

    def _cmd_cd(self, args: str) -> None:
        """Switch working directory. Requires agent re-initialization.

        Usage:
            /cd <path>       — Switch to a new working directory
            /cd              — Show current working directory
        """
        arg = args.strip()
        if not arg:
            # Show current work_dir
            self._chat_window.append_text(f"Current work directory: {self._work_dir}\n", "system")
            self._chat_window.append_text("──────────────────────────────────────────────\n", "separator")
            return

        # Resolve the path
        new_dir = Path(arg).resolve()
        if not new_dir.exists():
            self._chat_window.append_text(f"❌ Directory not found: {new_dir}\n", "error")
            self._chat_window.append_text("──────────────────────────────────────────────\n", "separator")
            return
        if not new_dir.is_dir():
            self._chat_window.append_text(f"❌ Not a directory: {new_dir}\n", "error")
            self._chat_window.append_text("──────────────────────────────────────────────\n", "separator")
            return

        old_dir = self._work_dir
        self._work_dir = str(new_dir)

        # Persist to config
        self.cfg["work_dir"] = self._work_dir
        cli_config.save_config(self.cfg)

        self._chat_window.append_text(f"📂 Work directory changed:\n", "system")
        self._chat_window.append_text(f"   {old_dir} → {self._work_dir}\n", "system")
        self._chat_window.append_text("   ⚠ Re-initializing agent with new work_dir...\n\n", "system")

        # Re-init agent with new work_dir (async)
        asyncio.run_coroutine_threadsafe(self._reinit_agent_with_new_workdir(), self._loop)
        self._update_status_bar()

    async def _reinit_agent_with_new_workdir(self) -> None:
        """Re-initialize the agent after work_dir change (preserves session)."""
        await self._close_agent()
        try:
            self.agent = create_agent(
                api_key=self.cfg.get("api_key") or None,
                thread_id=self.current_session_id,
                user_id=self.user_id,
                db_manager=self.db_manager,
                defult_config_name=self.defult_config_name,
                cli_cfg=self.cfg,
                work_dir=self._work_dir,
            )
            if hasattr(self.agent, "lazy_init"):
                await self.agent.lazy_init()

            # Restore session state (conversation history, model, etc.)
            state_dict = await self._load_thread_state(self.current_session_id)
            if state_dict and hasattr(self.agent, "load_state"):
                await self.agent.load_state(state_dict)

            # Load project instructions from new work_dir
            from drsai.backend.cli.drsaimd_loader import load_project_instructions
            project_instructions, loaded_paths = load_project_instructions(self._work_dir)
            existing_project_instr = getattr(self.agent, '_project_instructions', '') or ''
            if project_instructions and not existing_project_instr:
                prefix = getattr(self.agent, '_injected_prefix', '') or ''
                suffix = getattr(self.agent, '_injected_suffix', '') or ''
                self.agent.inject_system_prompt(
                    prefix=prefix,
                    suffix=suffix,
                    project_instructions=project_instructions,
                )
                for p in loaded_paths:
                    self._chat_window.append_text(f"   ✓ Project instructions loaded: {Path(p).name}\n", "system")

            # Save updated state
            state_dict = await self.agent.save_state()
            await self._save_thread_state(self.current_session_id, state_dict)

            self.current_thread = await self._get_or_create_thread(self.current_session_id)
            self._chat_window.append_text("✅ Agent re-initialized with new work_dir\n", "system")
            self._chat_window.append_text("──────────────────────────────────────────────\n", "separator")
            self._update_status_bar()
        except Exception as e:
            self._chat_window.append_text(f"❌ Failed to re-init agent: {e}\n", "error")

    # ── Async command implementations ────────────────────────────────────────

    async def _cmd_new(self, args: str) -> None:
        """Create a new session."""
        await self._close_agent()
        name = args.strip() or None
        from drsai.backend.cli.history import CLISessionStore
        store = CLISessionStore(self.db_manager, self.user_id)
        new_id = store.create(name=name or "desktop-new")
        self.current_session_id = new_id
        self.current_thread = None
        try:
            self.agent = create_agent(
                api_key=self.cfg.get("api_key") or None,
                thread_id=new_id,
                user_id=self.user_id,
                db_manager=self.db_manager,
                defult_config_name=self.defult_config_name,
                cli_cfg=self.cfg,
                work_dir=self._work_dir,
            )
            if hasattr(self.agent, "lazy_init"):
                await self.agent.lazy_init()
            state_dict = await self.agent.save_state()
            await self._save_thread_state(new_id, state_dict)
            self.current_thread = await self._get_or_create_thread(new_id)
            self._chat_window.append_text(f"New session: [{new_id[:8]}]\n", "system")
            self._chat_window.append_text("──────────────────────────────────────────────\n", "separator")
            self._update_status_bar()
        except Exception as e:
            self._chat_window.append_text(f"Failed to create session: {e}\n", "error")

    async def _cmd_switch(self, args: str) -> None:
        """Switch to another session."""
        if not args:
            self._chat_window.append_text("Usage: /switch <session_id|name>\n", "system")
            return
        from drsai.backend.cli.history import CLISessionStore
        store = CLISessionStore(self.db_manager, self.user_id)
        info = store.resolve(args)
        if info is None:
            self._chat_window.append_text(f"No session matching: {args}\n", "error")
            return
        if info.thread_id == self.current_session_id:
            self._chat_window.append_text("Already in this session.\n", "system")
            return
        await self._close_agent()
        self.current_session_id = info.thread_id
        self.current_thread = None
        try:
            self.agent = create_agent(
                api_key=self.cfg.get("api_key") or None,
                thread_id=self.current_session_id,
                user_id=self.user_id,
                db_manager=self.db_manager,
                defult_config_name=self.defult_config_name,
                cli_cfg=self.cfg,
                work_dir=self._work_dir,
            )
            if hasattr(self.agent, "lazy_init"):
                await self.agent.lazy_init()
            state_dict = await self._load_thread_state(self.current_session_id)
            if state_dict and hasattr(self.agent, "load_state"):
                await self.agent.load_state(state_dict)
            self.current_thread = await self._get_or_create_thread(self.current_session_id)
            self._chat_window.append_text(f"Switched to: {info.name} [{info.thread_id[:8]}]\n", "system")
            self._chat_window.append_text("──────────────────────────────────────────────\n", "separator")
            self._update_status_bar()
        except Exception as e:
            self._chat_window.append_text(f"Failed to switch: {e}\n", "error")

    async def _cmd_resume(self, args: str) -> None:
        """Resume a previous session."""
        if not args:
            self._chat_window.append_text("Usage: /resume <session_id|name>\n", "system")
            return
        # Resume is same as switch in GUI mode
        await self._cmd_switch(args)

    async def _cmd_model(self, args: str) -> None:
        """Show or switch model (session-local)."""
        args = args.strip()
        if not args:
            current = getattr(self.agent, '_defult_config_name', None) or self.cfg.get("defult_config_name") or "auto"
            global_default = self.cfg.get("defult_config_name") or "<default>"
            if current != global_default:
                self._chat_window.append_text(f"Current model: {current} (session-local)\n", "system")
                self._chat_window.append_text(f"Global default: {global_default}\n", "system")
            else:
                self._chat_window.append_text(f"Current model: {current}\n", "system")
            self._chat_window.append_text("──────────────────────────────────────────────\n", "separator")
            return

        from drsai.backend.run_drsai_agent_factory import load_llm_mode_config
        llm_config_path = os.environ.get("LLM_CONFIG_FILE") or self.cfg.get("llm_config_file")
        llm_mode_config = load_llm_mode_config(llm_config_path)

        if args not in llm_mode_config:
            self._chat_window.append_text(f"Unknown model: {args}\n", "error")
            self._chat_window.append_text(f"Available: {', '.join(sorted(llm_mode_config.keys())[:20])}\n", "system")
            return

        if self.agent and hasattr(self.agent, '_set_model_client'):
            try:
                new_client = self.agent._set_model_client(args)
                await self.agent.switch_model(new_client)
                self.agent._defult_config_name = args
                # Update token_limit in stats
                entry = llm_mode_config.get(args)
                if entry and hasattr(entry, "token_limit"):
                    self.stats.token_limit = entry.token_limit
                state_dict = await self.agent.save_state()
                await self._save_thread_state(self.current_session_id, state_dict)
                self._chat_window.append_text(f"Model switched to: {args}\n", "system")
                self._update_status_bar()
            except Exception as e:
                self._chat_window.append_text(f"Model switch failed: {e}\n", "error")

        self._chat_window.append_text("──────────────────────────────────────────────\n", "separator")

    async def _cmd_model_global(self, args: str) -> None:
        """Switch model (session + global default)."""
        args = args.strip()
        if not args:
            self._chat_window.append_text(f"Global default: {self.cfg.get('defult_config_name', '<default>')}\n", "system")
            self._chat_window.append_text("──────────────────────────────────────────────\n", "separator")
            return

        # Switch session model first
        await self._cmd_model(args)

        # Then save as global default
        self.cfg["defult_config_name"] = args
        cli_config.save_config(self.cfg)
        self._chat_window.append_text(f"Global default set to: {args}\n", "system")
        self._update_status_bar()

    async def _cmd_reasoning(self, args: str) -> None:
        """Toggle reasoning display."""
        arg = args.strip().lower()
        if not arg or arg in ("toggle",):
            self._show_reasoning = not self._show_reasoning
        elif arg in ("show", "on"):
            self._show_reasoning = True
        elif arg in ("hide", "off"):
            self._show_reasoning = False
        elif arg in ("low", "medium", "high", "xhigh"):
            if self.agent:
                self.agent.reasoning_effort = arg
                state_dict = await self.agent.save_state()
                await self._save_thread_state(self.current_session_id, state_dict)
            self._show_reasoning = arg in ("high", "xhigh")
        else:
            self._chat_window.append_text("Usage: /reasoning show|hide|off|low|medium|high\n", "system")
            self._chat_window.append_text("──────────────────────────────────────────────\n", "separator")
            return

        self._chat_window.append_text(f"Reasoning: {'on' if self._show_reasoning else 'off'}\n", "system")
        self._chat_window.append_text("──────────────────────────────────────────────\n", "separator")
        self._update_status_bar()

    async def _cmd_status(self) -> None:
        """Show agent and session status."""
        model_name = getattr(self.agent, '_defult_config_name', None) or self.cfg.get("defult_config_name") or "auto"
        pm = "on" if getattr(self.agent, '_injected_prefix', '') else "off"

        lines = [
            f"\n  Status:",
            f"    session:   {self.current_session_id[:8] if self.current_session_id else 'N/A'}",
            f"    model:     {model_name}",
            f"    plan_mode: {pm}",
            f"    reasoning: {'on' if self._show_reasoning else 'off'}",
            f"    user:      {self.user_id}",
            f"    agent:     {'active' if self.agent else 'not initialized'}",
            "",
        ]
        self._chat_window.append_text("\n".join(lines), "system")
        self._chat_window.append_text("──────────────────────────────────────────────\n", "separator")

    async def _cmd_plan_mode(self, args: str) -> None:
        """Toggle plan mode (session-local)."""
        PLAN_MODE_PROMPT = """Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Ask the questions one at a time.

If a question can be answered by exploring the codebase, explore the codebase instead."""

        arg = args.strip().lower()
        current_prefix = getattr(self.agent, '_injected_prefix', "") or ""

        if arg in ("on", "") and not current_prefix:
            if self.agent and hasattr(self.agent, "inject_system_prompt"):
                self.agent.inject_system_prompt(prefix=PLAN_MODE_PROMPT)
                state_dict = await self.agent.save_state()
                await self._save_thread_state(self.current_session_id, state_dict)
                self._chat_window.append_text("⚡ Plan mode enabled\n", "system")
        elif arg in ("off",) and current_prefix:
            if self.agent and hasattr(self.agent, "inject_system_prompt"):
                self.agent.inject_system_prompt(prefix="")
                state_dict = await self.agent.save_state()
                await self._save_thread_state(self.current_session_id, state_dict)
                self._chat_window.append_text("Plan mode disabled\n", "system")
        elif arg in ("status",):
            self._chat_window.append_text(f"Plan mode: {'on' if current_prefix else 'off'}\n", "system")
        else:
            self._chat_window.append_text("Usage: /plan_mode on|off|status\n", "system")

        self._chat_window.append_text("──────────────────────────────────────────────\n", "separator")
        self._update_status_bar()

    async def _cmd_plan_mode_global(self, args: str) -> None:
        """Toggle plan mode (session + global default)."""
        await self._cmd_plan_mode(args)
        arg = args.strip().lower()
        if arg in ("on", "off"):
            self.cfg["plan_mode"] = arg == "on"
            cli_config.save_config(self.cfg)
            self._chat_window.append_text(f"Global plan_mode set to: {arg}\n", "system")
            self._update_status_bar()

    # ── Callbacks for GUI ────────────────────────────────────────────────────

    def _on_user_message(self, user_input: str) -> None:
        """Called by chat_window when user submits a normal (non-command) message."""
        self._current_chat_task = asyncio.run_coroutine_threadsafe(
            self._do_chat(user_input), self._loop
        )

    def _on_show_window(self) -> None:
        """Called by tray icon when user wants to see the chat window.

        Thread-safe: show_window() uses root.after() internally,
        so it can be called from the pystray thread.
        """
        if self._chat_window and not self._chat_window._destroyed:
            try:
                self._chat_window.show_window()
            except Exception as e:
                logger.warning(f"show_window failed: {e}")

    def _on_setup_from_tray(self) -> None:
        """Thread-safe setup callback for tray icon.

        pystray runs on its own thread, so we must schedule the
        setup dialog creation on the tkinter main thread via root.after().
        Also shows the window first (in case it was minimized to tray).
        """
        if self._chat_window and not self._chat_window._destroyed:
            # Show the window first (important if minimized to tray)
            try:
                self._chat_window.show_window()
            except Exception as e:
                logger.warning(f"show_window in _on_setup_from_tray failed: {e}")
            # Schedule _cmd_setup on the main thread
            self._chat_window.after(0, lambda: self._cmd_setup())

    def _on_interrupt_chat(self) -> None:
        """Interrupt current chat turn (triggered by Ctrl+C or Escape/Stop).

        This is the GUI equivalent of CLI's KeyboardInterrupt →
        _handle_interrupt() flow:

        Behavior (mirrors CLI):
        - 1st Ctrl+C: cancel current chat, let _do_chat's CancelledError
          handler do pause/resume + GUI update
        - 2nd Ctrl+C (within 3 seconds): quit entire application

        This method must be thread-safe (may be called from SIGINT handler
        on a signal thread, or from pystray thread, or from tkinter thread).
        """
        self._interrupt_count += 1
        logger.info(f"Interrupt requested (count: {self._interrupt_count})")

        # ── Double Ctrl+C → quit ──────────────────────────────────────
        if self._interrupt_count >= 2:
            logger.info("Second Ctrl+C — quitting application")
            self._on_quit()
            return

        # ── Single Ctrl+C → cancel chat task ──────────────────────────
        # Reset counter after 3 seconds (so next Ctrl+C is "first" again)
        if self._chat_window and not self._chat_window._destroyed:
            self._chat_window.after(3000, self._reset_interrupt_count)

        task = self._current_chat_task
        if task is not None and not task.done():
            # Cancel the asyncio Future — this raises CancelledError inside
            # _do_chat(), which handles pause/resume + GUI cleanup.
            task.cancel()
            self._current_chat_task = None
            logger.debug("Chat task cancelled — CancelledError handler will clean up")
        else:
            # No active chat task — just update GUI directly
            if self._chat_window and not self._chat_window._destroyed:
                self._chat_window.after(0, self._do_interrupt_gui_update)

    def _reset_interrupt_count(self) -> None:
        """Reset Ctrl+C counter after timeout (so next Ctrl+C is 'first')."""
        self._interrupt_count = 0

    def _do_interrupt_gui_update(self) -> None:
        """GUI update after chat interrupt (runs on tkinter main thread)."""
        if self._chat_window and not self._chat_window._destroyed:
            self._chat_window.append_text("\n⚠ 回复已中断（按 Ctrl+C 再次退出）\n", "system")
            self._chat_window.finish_chat_turn()
            self._chat_window.set_status("就绪")
            self._update_status_bar()

    def _on_minimize_window(self) -> None:
        """Called when chat window is minimized to tray."""
        logger.info("Chat window minimized to tray")
        if self._tray_app:
            try:
                self._tray_app.notify("窗口已最小化到托盘，双击图标或右键→打开对话恢复", "DrSai")
            except Exception as e:
                logger.debug(f"Balloon notification failed: {e}")

    def _on_quit(self) -> None:
        """Quit entire app (thread-safe).

        This method may be called from ANY thread:
        - pystray background thread (right-click tray → "退出")
        - tkinter main thread (Ctrl+Q or /quit command)
        - SIGINT handler thread

        Because Tkinter requires all widget operations to run on the main
        thread, we use root.after() to schedule the actual GUI teardown
        on the main thread. This prevents both:
        - "右键退出没反应" (operations silently ignored on wrong thread)
        - TclError (widget operations on destroyed widgets)

        Shutdown sequence (all Phase 3-5 on main thread):
        1. Mark _destroyed flag (stops all pending GUI callbacks)
        2. Stop tray icon (from any thread — pystray is thread-safe)
        3. Force-close the chat window via root.after() (main thread)
        4. Stop tkinter mainloop via root.after() (main thread)
        5. Shutdown asyncio + os._exit(0) (hard exit, any thread)
        """
        logger.info("DrSai desktop app shutting down...")

        # ── Phase 1: Mark destroyed (prevents all pending GUI callbacks) ────
        if self._chat_window and not self._chat_window._destroyed:
            self._chat_window._destroyed = True

        # ── Phase 2: Stop tray icon (thread-safe — pystray handles this) ───
        if self._tray_app:
            self._tray_app.stop()

        # ── Phase 3-4: GUI teardown on the main thread via root.after() ────
        # This is the KEY fix: all tkinter operations must run on the main
        # thread. root.after(0, ...) schedules them on the main thread's
        # event loop, which is guaranteed to be the correct thread.
        if self._chat_window:
            try:
                # Schedule the actual shutdown on the tkinter main thread
                self._chat_window.after(0, self._do_gui_shutdown)
            except RuntimeError:
                # Window already destroyed or mainloop not running —
                # fall back to direct call (will likely os._exit anyway)
                self._do_direct_shutdown()
        else:
            # No chat window — just hard exit
            self._do_direct_shutdown()

    def _do_gui_shutdown(self) -> None:
        """Actual GUI shutdown — runs on tkinter main thread via root.after().

        This is called from the tkinter event loop, so all widget operations
        are safe here.
        """
        if self._chat_window is None:
            os._exit(0)
            return

        # Destroy ScrolledText first (including its internal scrollbar)
        # This prevents TclError from pending yview/set commands
        try:
            self._chat_window.chat_display.destroy()
        except Exception:
            pass

        # Destroy the root window
        try:
            self._chat_window.destroy()
        except Exception:
            pass

        # Schedule the final hard exit after mainloop exits
        # tkinter.quit() stops mainloop, then we do os._exit(0)
        try:
            self._chat_window.quit()
        except Exception:
            pass

        # ── Phase 5: Shutdown asyncio and hard exit ────────────────────────
        async def _shutdown():
            await self._close_agent()
            self._loop.stop()

        asyncio.run_coroutine_threadsafe(_shutdown(), self._loop)

        try:
            sys.stdout.flush()
            sys.stderr.flush()
        except Exception:
            pass

        time.sleep(0.5)
        os._exit(0)

    def _do_direct_shutdown(self) -> None:
        """Fallback shutdown when root.after() is unavailable.

        Called when the mainloop is not running or window is already gone.
        Just does os._exit(0) since there's nothing to clean up.
        """
        async def _shutdown():
            await self._close_agent()
            self._loop.stop()

        asyncio.run_coroutine_threadsafe(_shutdown(), self._loop)

        try:
            sys.stdout.flush()
            sys.stderr.flush()
        except Exception:
            pass

        time.sleep(0.5)
        os._exit(0)

    # ── Main run ────────────────────────────────────────────────────────────

    def run(self) -> None:
        """Start the entire desktop application."""
        import tkinter as tk
        import tkinter.messagebox as messagebox

        # ── First-time setup: show dialog if no API key ──────────────────────
        if self._needs_setup:
            logger.info("No API key found — showing setup dialog...")
            result = _show_setup_dialog(self.cfg)
            if result is None:
                # User cancelled → exit
                logger.info("Setup cancelled — exiting.")
                sys.exit(0)

            # Apply configuration from setup dialog
            new_cfg = result.config_values
            self._deferred_init(new_cfg)

            if self._init_error:
                root = tk.Tk()
                root.withdraw()
                messagebox.showerror(
                    "DrSai 初始化失败",
                    f"Agent 初始化失败:\n{self._init_error}\n\n请检查 API Key 和配置。",
                )
                sys.exit(1)

        else:
            # Normal init — wait for agent
            logger.info("Waiting for agent initialization...")
            self._init_done.wait(timeout=30)

            if self._init_error:
                root = tk.Tk()
                root.withdraw()
                messagebox.showerror(
                    "DrSai 初始化失败",
                    f"Agent 初始化失败:\n{self._init_error}\n\n请检查 API Key 和配置。",
                )
                sys.exit(1)

        # ── Create chat window ──────────────────────────────────────────────
        self._chat_window = DrSaiChatWindow(
            send_message_fn=self._on_user_message,
            on_command_fn=self._on_command,
            on_minimize_fn=self._on_minimize_window,
            on_quit_fn=self._on_quit,
            on_interrupt_fn=self._on_interrupt_chat,
            title=f"DrSai Chat — {self.user_id} @ {self.defult_config_name}",
        )

        # ── Set initial status bar info ────────────────────────────────────
        self._update_status_bar()

        model_info = f"🤖 Model: {self.defult_config_name}\n"
        self._chat_window.append_text(model_info, "system")

        # ── Create tray icon ────────────────────────────────────────────────
        try:
            self._tray_app = DrSaiTrayApp(
                show_window_fn=self._on_show_window,
                setup_fn=self._on_setup_from_tray,
                quit_fn=self._on_quit,
                title=f"DrSai — {self.defult_config_name}",
            )
            self._tray_app.run_detached()
            logger.info("Tray icon started successfully")
            # ── Remind user about Windows overflow area ──────────────────────
            self._chat_window.append_text(
                "💡 提示：系统托盘图标已创建。\n"
                "   如果看不到图标，请点击任务栏右下角的 ↑ 箭头查看溢出区域。\n"
                "   双击图标或右键→「打开对话」恢复窗口。\n\n",
                "system",
            )
        except ImportError as e:
            logger.warning(f"Tray icon unavailable (missing pystray/Pillow): {e}")
            self._tray_app = None
        except Exception as e:
            # Catch ALL exceptions — not just ImportError.
            # Icon generation errors, threading issues, etc. should not
            # crash the entire application. The chat window still works
            # without a tray icon.
            logger.warning(f"Tray icon creation failed: {e}")
            self._chat_window.append_text(
                f"⚠ 系统托盘图标创建失败: {e}\n"
                f"   聊天窗口仍可正常使用，但没有托盘图标。\n",
                "system",
            )
            self._tray_app = None

        # ── Register SIGINT handler (Ctrl+C in terminal) ────────────────────
        # tkinter's mainloop on Windows swallows KeyboardInterrupt because it
        # uses Win32 GetMessage/DispatchMessage which never checks Python's
        # signal flag.  We must install a signal handler.
        #
        # Behavior mirrors CLI:
        #   1st Ctrl+C → interrupt current chat (cancel + pause/resume)
        #   2nd Ctrl+C → quit entire application
        import signal
        signal.signal(signal.SIGINT, lambda sig, frame: self._on_interrupt_chat())

        # ── Run tkinter mainloop ────────────────────────────────────────────
        logger.info("DrSai desktop app running (tkinter mainloop)")
        self._chat_window.mainloop()
        # NOTE: KeyboardInterrupt will NOT reach here on Windows.
        # The SIGINT handler above calls _on_interrupt_chat() which either
        # cancels the current chat or (2nd press) calls _on_quit().

# ── CLI entry point ─────────────────────────────────────────────────────────

def main() -> None:
    """Entry point for ``drsai-tray`` command."""
    logger.remove()
    # In PyInstaller windowed mode (console=False), sys.stderr is None.
    if sys.stderr is not None:
        logger.add(sys.stderr, level="WARNING")
    try:
        log_file = Path(FS_DIR) / "logs" / "drsai-tray.log"
        log_file.parent.mkdir(parents=True, exist_ok=True)
        logger.add(str(log_file), level="WARNING", rotation="5 MB", retention=3)
    except Exception:
        pass  # never let logging setup crash the app

    # ── Check tkinter availability ──────────────────────────────────────────
    # Do NOT create a Tk root here — DrSaiChatWindow is itself a tk.Tk root.
    # A hidden "ghost" root window would conflict with the real one later.
    try:
        import tkinter as tk  # noqa: F401 — just check importability
    except ImportError as e:
        print(f"tkinter is not available: {e}")
        sys.exit(1)

    # ── Check pystray availability ──────────────────────────────────────────
    try:
        import pystray  # noqa: F401 — just check importability
    except ImportError:
        print("pystray not installed. Tray icon unavailable.")
        print("Install: pip install drsai[tray]")

    app = DrSaiDesktopApp()
    app.run()

if __name__ == "__main__":
    # ── Crash-logging shim for windowed PyInstaller exe ─────────────────────
    # In windowed mode sys.stdout / sys.stderr are None and any unhandled
    # exception just kills the process silently. Capture EVERYTHING to a
    # crash log before invoking main().
    import datetime as _dt
    import traceback as _tb

    _crash_dir = Path.home() / ".drsai" / "logs"
    try:
        _crash_dir.mkdir(parents=True, exist_ok=True)
        _crash_log = _crash_dir / "drsai-tray-crash.log"
    except Exception:
        _crash_log = Path.home() / "drsai-tray-crash.log"

    _crash_fp = open(_crash_log, "a", encoding="utf-8", buffering=1)
    _crash_fp.write(f"\n=== {_dt.datetime.now().isoformat()} drsai-tray launching ===\n")
    _crash_fp.flush()

    # Redirect dead std streams so print() and tracebacks aren't lost
    if sys.stdout is None:
        sys.stdout = _crash_fp
    if sys.stderr is None:
        sys.stderr = _crash_fp

    def _excepthook(etype, evalue, etb):
        _crash_fp.write("\n=== Unhandled exception ===\n")
        _tb.print_exception(etype, evalue, etb, file=_crash_fp)
        _crash_fp.flush()
    sys.excepthook = _excepthook

    try:
        main()
    except SystemExit as _e:
        _crash_fp.write(f"\n=== sys.exit({_e.code}) called ===\n")
        _tb.print_stack(file=_crash_fp)
        _crash_fp.flush()
        raise
    except BaseException:
        _crash_fp.write("\n=== Top-level exception ===\n")
        _tb.print_exc(file=_crash_fp)
        _crash_fp.flush()
        raise