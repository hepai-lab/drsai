"""DrSaiSetupDialog — first-time setup / environment variable configuration dialog.

Extracted from run_tray.py for modular organization.  This is a
standalone tk.Toplevel dialog that collects API key configuration
on first launch.

Usage:
    dialog = DrSaiSetupDialog(parent_tk_root, cfg=current_cfg)
    parent.wait_window(dialog)  # blocks until dialog closes
    if dialog.completed:
        new_cfg = dialog.config_values
"""

from __future__ import annotations

import os
import sys

import tkinter as tk

# ── Setup dialog theme (Catppuccin Mocha dark, matching chat_window) ──────

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

    IMPORTANT: This dialog is a Toplevel, NOT a separate Tk root.
    Never call self.master.quit() — it would kill the entire mainloop.
    Just destroy the dialog; wait_window() detects destruction.
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

    def __init__(self, parent: "tk.Tk", cfg: dict = None, env_provider: str = None) -> None:
        super().__init__(parent)

        self.cfg = cfg or {}
        self.completed = False
        self.config_values: dict = {}
        self.env_provider = env_provider  # detected env provider for pre-fill

        # ── Window setup ──────────────────────────────────────────────────
        if env_provider:
            self.title("🤖 DrSai — 配置确认")
        else:
            self.title("🤖 DrSai — 首次配置")
        # Use a minimum size that guarantees all content (including buttons)
        # is visible.  The actual window height will auto-expand after
        # content is built via update_idletasks + winfo_reqheight.
        self.minsize(560, 620)
        self.configure(bg=_SETUP_THEME["bg"])
        self.resizable(True, True)

        # Center on screen — will be re-calculated after content is built
        self.update_idletasks()
        sw = self.winfo_screenwidth()
        sh = self.winfo_screenheight()
        # Start centered with a reasonable default; will adjust later
        x = (sw - 560) // 2
        y = max(0, (sh - 620) // 2 - 30)  # shift up slightly for taskbar
        self.geometry(f"560x620+{x}+{y}")

        # Modal: grab focus
        self.transient(parent)
        self.grab_set()
        self.protocol("WM_DELETE_WINDOW", self._on_cancel)

        # ── State ──────────────────────────────────────────────────────────
        # Auto-select provider based on detected env var
        if env_provider and env_provider in self.PROVIDERS:
            self._selected_provider = env_provider
        else:
            self._selected_provider = "hepai"

        # ── Build UI ──────────────────────────────────────────────────────
        self._build_widgets()

        # Focus on API key entry after dialog is shown
        self.after(100, lambda: self._api_key_entry.focus_set())

    # ── Widget construction ──────────────────────────────────────────────

    def _build_widgets(self) -> None:
        T = _SETUP_THEME

        # ── Bottom-fixed button bar (pack FIRST so it stays visible) ──────
        # By packing the button bar before the scrollable content area,
        # tkinter allocates space for buttons first, guaranteeing they
        # remain visible even if the content area is tall.
        btn_frame = tk.Frame(self, bg=T["bg"])
        btn_frame.pack(side=tk.BOTTOM, fill=tk.X, padx=24, pady=(8, 12))

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

        # ── Error label (also bottom-fixed, above buttons) ────────────────
        self._error_label = tk.Label(
            self, text="",
            bg=T["bg"], fg=T["error_fg"], font=_SETUP_FONT, padx=24,
        )
        self._error_label.pack(side=tk.BOTTOM, fill=tk.X, before=btn_frame)

        # ── Main scrollable content area ──────────────────────────────────
        main_frame = tk.Frame(self, bg=T["bg"], padx=24, pady=20)
        main_frame.pack(fill=tk.BOTH, expand=True)

        # ── Welcome message ────────────────────────────────────────────────
        tk.Label(
            main_frame, text="🤖 欢迎使用 DrSai！",
            bg=T["bg"], fg=T["fg"], font=_SETUP_FONT_BOLD,
        ).pack(anchor=tk.W, pady=(0, 4))

        welcome_text = (
            "检测到环境变量中已有 API Key，已为您预填充。您可以确认或修改配置："
            if self.env_provider
            else "首次使用需要配置 API Key。请选择提供商并输入密钥："
        )
        tk.Label(
            main_frame,
            text=welcome_text,
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
        hint_text = "💡 API Key 将保存到 ~/.drsai/configs/cli_config.json\n"
        if self.env_provider:
            hint_text += "   API Key 已从环境变量预填充，保存后将同时写入配置文件。\n"
        hint_text += "   也可通过环境变量设置: HEPAI_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY"
        tk.Label(
            main_frame,
            text=hint_text,
            bg=T["bg"], fg=T["hint_fg"], font=_SETUP_FONT_SMALL,
            wraplength=500, justify=tk.LEFT,
        ).pack(anchor=tk.W, pady=(0, 16))

        # ── Initial provider state ─────────────────────────────────────────
        self._on_provider_change()

        # ── Pre-fill API key from environment variable if detected ────────
        if self.env_provider and self.env_provider in self.PROVIDERS:
            env_var = self.PROVIDERS[self.env_provider]["env_var"]
            env_key = os.environ.get(env_var, "")
            if env_key:
                self._api_key_entry.delete(0, tk.END)
                self._api_key_entry.insert(0, env_key)

        # ── Auto-fit window height to content ─────────────────────────────
        # After all widgets are built, recalculate the window size so that
        # buttons are never hidden behind content overflow.
        self.update_idletasks()
        req_h = self.winfo_reqheight()
        req_w = self.winfo_reqwidth()
        # Clamp to screen size (leave margin for taskbar)
        max_h = self.winfo_screenheight() - 60
        max_w = self.winfo_screenwidth() - 40
        final_w = min(max(req_w, 560), max_w)
        final_h = min(max(req_h, 620), max_h)
        sw = self.winfo_screenwidth()
        sh = self.winfo_screenheight()
        x = max(0, (sw - final_w) // 2)
        y = max(0, (sh - final_h) // 2 - 30)
        self.geometry(f"{final_w}x{final_h}+{x}+{y}")

    # ── Provider change ──────────────────────────────────────────────────

    def _on_provider_change(self) -> None:
        """Update UI based on selected provider."""
        provider = self._provider_var.get()
        prov_info = self.PROVIDERS[provider]
        self._selected_provider = provider

        has_base_url = bool(prov_info["base_cfg"])

        if has_base_url:
            self._base_url_frame.pack(fill=tk.X, pady=(0, 10), before=self._separator)
            self._base_url_entry.delete(0, tk.END)
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

        self._error_label.config(text="")

        # Build config values
        values = {
            prov_info["cfg_key"]: api_key,
            "user_id": self._user_id_entry.get().strip() or "anonymous",
        }

        default_model = self._model_entry.get().strip()
        if default_model:
            values["defult_config_name"] = default_model

        base_url = self._base_url_entry.get().strip()
        if base_url and prov_info["base_cfg"]:
            values[prov_info["base_cfg"]] = base_url

        self.config_values = values
        self.completed = True

        # Set environment variables for current process
        os.environ[prov_info["env_var"]] = api_key
        if base_url and prov_info["base_env"]:
            os.environ[prov_info["base_env"]] = base_url

        # Just destroy the dialog (never call self.master.quit())
        self.destroy()

    # ── Cancel ────────────────────────────────────────────────────────────

    def _on_cancel(self) -> None:
        """User cancelled setup — close dialog only."""
        self.completed = False
        self.destroy()