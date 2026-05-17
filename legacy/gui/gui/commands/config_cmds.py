"""ConfigCommands — configuration-related slash command implementations.

Commands: /config, /models, /verbose, /bell
(Note: /setup is handled by DrSaiDesktopApp directly — lifecycle concern)
"""

from __future__ import annotations

import os

from drsai.backend.gui.app_context import AppContext
from drsai.backend.gui.lazy_imports import (
    get_load_llm_mode_config, get_config_as_dict_for_export,
    get_messagebox,
)
from drsai.backend.gui.ui_formatter import SEPARATOR


class ConfigCommands:
    """Configuration command implementations for DrSai desktop app."""

    def __init__(self, ctx: AppContext) -> None:
        self.ctx = ctx

    def cmd_config(self, args: str = "") -> None:
        """Show current configuration."""
        from drsai.backend.cli import config as cli_config
        cli_config.show_config(self.ctx.cfg)

        config_as_dict_for_export = get_config_as_dict_for_export()
        safe_cfg = config_as_dict_for_export(self.ctx.cfg)
        lines = ["\n  Current configuration:\n"]
        for k, v in safe_cfg.items():
            lines.append(f"    {k}: {v}")
        lines.append("")
        self.ctx.ui.raw("\n".join(lines), "system")
        self.ctx.ui.section_end()

    def cmd_models(self, args: str = "") -> None:
        """List all available models with reasoning support status."""
        try:
            load_llm_mode_config = get_load_llm_mode_config()
            llm_config_path = os.environ.get("LLM_CONFIG_FILE") or self.ctx.cfg.get("llm_config_file")
            llm_mode_config = load_llm_mode_config(llm_config_path)
        except Exception as e:
            self.ctx.ui.error(f"无法加载模型配置: {e}")
            self.ctx.ui.section_end()
            return

        current_model = getattr(self.ctx.agent, '_defult_config_name', None) or self.ctx.defult_config_name

        lines = ["\n  Available models:\n"]
        for alias, entry in llm_mode_config.items():
            marker = " ← current" if alias == current_model else ""
            reasoning = ""
            if hasattr(entry, 'reasoning') and entry.reasoning:
                supported = "supported" if entry.reasoning.supported else "not supported"
                reasoning = f"  (reasoning: {supported})"
            lines.append(f"    {alias}{marker}{reasoning}")
        lines.append("")
        self.ctx.ui.raw("\n".join(lines), "system")
        self.ctx.ui.section_end()

    def cmd_verbose(self, args: str = "") -> None:
        """Toggle verbose output (per-turn stats footer)."""
        arg = args.strip().lower()
        if arg in ("off", "false", "0"):
            self.ctx.cfg["verbose"] = False
        elif arg in ("on", "true", "1"):
            self.ctx.cfg["verbose"] = True
        else:
            # Default: toggle
            self.ctx.cfg["verbose"] = not self.ctx.cfg.get("verbose", False)

        state_str = "on" if self.ctx.cfg["verbose"] else "off"
        self.ctx.ui.info(f"Verbose: {state_str}\n")
        self.ctx.ui.section_end()

    def cmd_bell(self, args: str = "") -> None:
        """Toggle bell notification when response finishes."""
        arg = args.strip().lower()
        if arg in ("on", "true", "1"):
            self.ctx.stats.ring_bell = True
        elif arg in ("off", "false", "0"):
            self.ctx.stats.ring_bell = False
        else:
            self.ctx.stats.ring_bell = not self.ctx.stats.ring_bell

        state_str = "on" if self.ctx.stats.ring_bell else "off"
        self.ctx.ui.info(f"Bell: {state_str}\n")
        self.ctx.ui.section_end()