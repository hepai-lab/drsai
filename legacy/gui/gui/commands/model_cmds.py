"""ModelCommands — model selection slash command implementations.

Commands: /model, /model_global, /fast, /reasoning
"""

from __future__ import annotations

import os
import asyncio

from loguru import logger

from drsai.backend.gui.app_context import AppContext
from drsai.backend.gui.lazy_imports import get_load_llm_mode_config


class ModelCommands:
    """Model selection command implementations for DrSai desktop app."""

    def __init__(self, ctx: AppContext) -> None:
        self.ctx = ctx

    async def cmd_model(self, args: str = "") -> None:
        """Switch current session model."""
        model_name = args.strip()
        if not model_name:
            self.ctx.ui.error("请指定模型名称。用法: /model <model_name>\n")
            self.ctx.ui.hint("   输入 /models 查看所有可用模型\n")
            self.ctx.ui.section_end()
            return

        await self.ctx._app._switch_model(model_name)

    async def cmd_model_global(self, args: str = "") -> None:
        """Switch model and save as default for future sessions."""
        model_name = args.strip()
        if not model_name:
            self.ctx.ui.error("请指定模型名称。用法: /model_global <model_name>\n")
            self.ctx.ui.hint("   输入 /models 查看所有可用模型\n")
            self.ctx.ui.section_end()
            return

        await self.ctx._app._switch_model(model_name, global_=True)

    async def cmd_fast(self, args: str = "") -> None:
        """Quick switch to fast model (or toggle fast/normal)."""
        try:
            load_llm_mode_config = get_load_llm_mode_config()
            llm_config_path = os.environ.get("LLM_CONFIG_FILE") or self.ctx.cfg.get("llm_config_file")
            llm_mode_config = load_llm_mode_config(llm_config_path)

            current_model = getattr(self.ctx.agent, '_defult_config_name', None) or self.ctx.defult_config_name

            # Find fast model
            fast_model = None
            for alias, entry in llm_mode_config.items():
                if hasattr(entry, 'fast') and entry.fast:
                    fast_model = alias
                    break

            if not fast_model:
                # Try common fast model names
                for candidate in ("fast", "gpt-4o-mini", "claude-3-haiku"):
                    if candidate in llm_mode_config:
                        fast_model = candidate
                        break

            if not fast_model:
                self.ctx.ui.warn("未找到 fast 模型配置\n")
                self.ctx.ui.section_end()
                return

            # If already on fast model, switch back to default
            if current_model == fast_model:
                default_model = self.ctx.cfg.get("defult_config_name", "default")
                if default_model in llm_mode_config:
                    await self.ctx._app._switch_model(default_model)
                else:
                    self.ctx.ui.warn(f"默认模型 '{default_model}' 不在配置中\n")
                    self.ctx.ui.section_end()
            else:
                await self.ctx._app._switch_model(fast_model)

        except Exception as e:
            self.ctx.ui.error(f"快速切换失败: {e}\n")
            self.ctx.ui.section_end()

    def cmd_reasoning(self, args: str = "") -> None:
        """Toggle reasoning display mode."""
        arg = args.strip().lower()

        if arg in ("on", "true", "1", "show", "display"):
            self.ctx.cfg["show_reasoning"] = True
        elif arg in ("off", "false", "0", "hide"):
            self.ctx.cfg["show_reasoning"] = False
        elif arg in ("only", "reasoning_only"):
            self.ctx.cfg["show_reasoning"] = True
            self.ctx.cfg["show_reasoning_only"] = True
        else:
            # Default: toggle
            self.ctx.cfg["show_reasoning"] = not self.ctx.cfg.get("show_reasoning", False)

        # Sync app_context state
        self.ctx._show_reasoning = self.ctx.cfg.get("show_reasoning", False)
        state = "on" if self.ctx._show_reasoning else "off"
        self.ctx.ui.info(f"Reasoning display: {state}\n")

        # Update status bar to reflect change
        if self.ctx._app:
            self.ctx._app._update_status_bar()
        self.ctx.ui.section_end()