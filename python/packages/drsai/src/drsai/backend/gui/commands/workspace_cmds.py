"""WorkspaceCommands — workspace and advanced slash command implementations.

Commands: /workspace, /dangerous, /inject, /memory, /status, /plan_mode, /pm_global
"""

from __future__ import annotations

import asyncio

from loguru import logger

from drsai.backend.gui.app_context import AppContext
from drsai.backend.gui.lazy_imports import get_DatabaseManager


class WorkspaceCommands:
    """Workspace and advanced command implementations for DrSai desktop app."""

    def __init__(self, ctx: AppContext) -> None:
        self.ctx = ctx

    def cmd_workspace(self, args: str = "") -> None:
        """Set workspace restriction mode."""
        arg = args.strip().lower()

        # Use closure function to properly sync the mutable state
        toggle_funcs = getattr(self.ctx.agent, '_workspace_toggle_funcs', []) if self.ctx.agent else []
        set_fn = next((f for f in toggle_funcs if f.__name__ == "set_workspace_restriction"), None)

        if arg in ("restrict", "restricted", "on", "true", "1"):
            if set_fn:
                set_fn(True)
            if self.ctx.agent:
                self.ctx.agent._only_in_workspace = True
            self.ctx.cfg["only_in_workspace"] = True
            self.ctx.ui.success("🔒 工作空间已设置为受限模式\n")
            self.ctx.ui.hint("   Agent 只能在工作目录内操作文件\n")

        elif arg in ("open", "unrestrict", "off", "false", "0"):
            if set_fn:
                set_fn(False)
            if self.ctx.agent:
                self.ctx.agent._only_in_workspace = False
            self.ctx.cfg["only_in_workspace"] = False
            self.ctx.ui.success("🔓 工作空间已设置为开放模式\n")
            self.ctx.ui.hint("   Agent 可以在任意目录操作文件\n")

        elif arg in ("status", ""):
            ws_fn = getattr(self.ctx.agent, '_only_in_workspace', None) if self.ctx.agent else None
            if ws_fn is True:
                mode = "restricted (ws:on)"
            elif ws_fn is False:
                mode = "open (ws:off)"
            else:
                mode = "restricted" if self.ctx.cfg.get("only_in_workspace", False) else "open"
            self.ctx.ui.info(f"当前工作空间模式: {mode}\n")
            self.ctx.ui.info(f"工作目录: {self.ctx._work_dir}\n")

        else:
            self.ctx.ui.error(
                "无效参数。用法: /workspace [restrict|open|status]\n"
                "  /workspace restrict — 限制在工作目录内\n"
                "  /workspace open    — 允许任意目录操作\n"
                "  /workspace status  — 显示当前模式\n"
            )

        # Update status bar to reflect change
        if self.ctx._app:
            self.ctx._app._update_status_bar()
        self.ctx.ui.section_end()

    def cmd_dangerous(self, args: str = "") -> None:
        """Toggle dangerous mode (allows risky operations)."""
        arg = args.strip().lower()

        # Use closure function to properly sync the mutable state
        toggle_funcs = getattr(self.ctx.agent, '_dangerous_toggle_funcs', []) if self.ctx.agent else []
        set_fn = next((f for f in toggle_funcs if f.__name__ == "set_dangerous_allowed"), None)

        if arg in ("on", "true", "1"):
            if set_fn:
                set_fn(True)
            elif self.ctx.agent and hasattr(self.ctx.agent, '_dangerous'):
                self.ctx.agent._dangerous = True
            self.ctx.cfg["dangerous"] = True
            self.ctx.ui.warn("⚠️ 危险模式已开启 — Agent 可以执行风险操作\n")
            self.ctx.ui.hint("   包括: 无确认删除文件、执行任意命令等\n")

        elif arg in ("off", "false", "0"):
            if set_fn:
                set_fn(False)
            elif self.ctx.agent and hasattr(self.ctx.agent, '_dangerous'):
                self.ctx.agent._dangerous = False
            self.ctx.cfg["dangerous"] = False
            self.ctx.ui.success("🛡️ 危险模式已关闭\n")

        else:
            # Toggle
            current_fn = getattr(self.ctx.agent, '_get_dangerous_allowed', None) if self.ctx.agent else None
            current = current_fn() if current_fn else self.ctx.cfg.get("dangerous", False)
            new_val = not current
            if set_fn:
                set_fn(new_val)
            elif self.ctx.agent and hasattr(self.ctx.agent, '_dangerous'):
                self.ctx.agent._dangerous = new_val
            self.ctx.cfg["dangerous"] = new_val
            state = "on" if new_val else "off"
            self.ctx.ui.info(f"危险模式: {state}\n")

        # Update status bar to reflect change
        if self.ctx._app:
            self.ctx._app._update_status_bar()
        self.ctx.ui.section_end()

    def cmd_inject(self, args: str = "") -> None:
        """Inject a message directly into the agent conversation."""
        content = args.strip()
        if not content:
            self.ctx.ui.error("请指定注入内容。用法: /inject <message>\n")
            self.ctx.ui.section_end()
            return

        try:
            if not self.ctx.agent:
                self.ctx.ui.error("Agent 未初始化\n")
                self.ctx.ui.section_end()
                return

            msg = {"role": "system", "content": content}
            if hasattr(self.ctx.agent, '_history'):
                self.ctx.agent._history.append(msg)

            self.ctx.ui.success(f"✅ 已注入系统消息\n")
            self.ctx.ui.hint(f"   内容: {content[:50]}...\n")
            self.ctx.ui.section_end()

        except Exception as e:
            self.ctx.ui.error(f"注入消息失败: {e}\n")
            self.ctx.ui.section_end()

    def cmd_memory(self, args: str = "") -> None:
        """Show or manage agent memory."""
        arg = args.strip().lower()

        if arg in ("status", ""):
            if not self.ctx.agent:
                self.ctx.ui.error("Agent 未初始化\n")
                self.ctx.ui.section_end()
                return

            if hasattr(self.ctx.agent, '_memory_state') and self.ctx.agent._memory_state:
                mem = self.ctx.agent._memory_state
                count = len(mem) if isinstance(mem, (list, dict)) else 0
                self.ctx.ui.info(f"Agent memory: {count} entries\n")
            else:
                self.ctx.ui.info("Agent memory: empty\n")

        elif arg in ("clear", "reset"):
            if self.ctx.agent and hasattr(self.ctx.agent, '_memory_state'):
                self.ctx.agent._memory_state = {}
                self.ctx.ui.success("✅ Agent memory 已清除\n")
            else:
                self.ctx.ui.warn("没有可清除的 memory\n")

        elif arg in ("dump", "show"):
            if not self.ctx.agent or not hasattr(self.ctx.agent, '_memory_state'):
                self.ctx.ui.warn("没有 memory 数据\n")
                self.ctx.ui.section_end()
                return

            mem = self.ctx.agent._memory_state
            if isinstance(mem, dict):
                for k, v in list(mem.items())[:10]:
                    self.ctx.ui.raw(f"  {k}: {str(v)[:100]}\n", "system")
            elif isinstance(mem, list):
                for i, item in enumerate(list(mem)[:10], 1):
                    self.ctx.ui.raw(f"  {i}. {str(item)[:100]}\n", "system")
            else:
                self.ctx.ui.raw(f"  {str(mem)[:200]}\n", "system")

        else:
            self.ctx.ui.info(
                "Usage: /memory [status|clear|dump]\n"
                "  /memory status — 显示 memory 状态\n"
                "  /memory clear  — 清除 memory\n"
                "  /memory dump   — 显示 memory 内容\n"
            )

        self.ctx.ui.section_end()

    def cmd_status(self, args: str = "") -> None:
        """Show system status."""
        lines = []

        # Agent status
        if self.ctx.agent:
            model = getattr(self.ctx.agent, '_defult_config_name', None) or self.ctx.defult_config_name
            lines.append(f"  Agent:           initialized (model: {model})")
        else:
            lines.append("  Agent:           not initialized")

        # Session status
        lines.append(f"  Session ID:      {self.ctx.current_session_id or 'none'}")
        lines.append(f"  User ID:         {self.ctx.user_id}")

        # Database status
        try:
            DatabaseManager = get_DatabaseManager()
            db = DatabaseManager()
            lines.append(f"  Database:        connected")
        except Exception:
            lines.append("  Database:        not available")

        # Loop status
        if self.ctx._loop and self.ctx._loop.is_running():
            lines.append("  Async loop:      running")
        else:
            lines.append("  Async loop:      not running")

        # Tray status
        if self.ctx._tray_app and self.ctx._tray_app.is_running:
            lines.append("  Tray icon:       running")
        else:
            lines.append("  Tray icon:       not running")

        self.ctx.ui.raw("\n  System status:\n" + "\n".join(lines) + "\n", "system")
        self.ctx.ui.section_end()

    def cmd_plan_mode(self, args: str = "") -> None:
        """Toggle plan mode for current session."""
        arg = args.strip().lower()

        if arg in ("on", "true", "1"):
            self.ctx.cfg["plan_mode"] = True
            if self.ctx.agent and hasattr(self.ctx.agent, '_plan_mode'):
                self.ctx.agent._plan_mode = True
            # Inject plan mode prompt if not already injected
            PLAN_MODE_PROMPT = "Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.\n\nAsk the questions one at a time.\n\nIf a question can be answered by exploring the codebase, explore the codebase instead."
            if self.ctx.agent and hasattr(self.ctx.agent, 'inject_system_prompt'):
                existing_prefix = getattr(self.ctx.agent, '_injected_prefix', "") or ""
                if not existing_prefix:
                    self.ctx.agent.inject_system_prompt(prefix=PLAN_MODE_PROMPT)
            self.ctx.ui.success("📋 Plan mode: on\n")
            self.ctx.ui.hint("   Agent 将先制定计划再执行\n")

        elif arg in ("off", "false", "0"):
            self.ctx.cfg["plan_mode"] = False
            if self.ctx.agent and hasattr(self.ctx.agent, '_plan_mode'):
                self.ctx.agent._plan_mode = False
            # Remove plan mode prompt
            if self.ctx.agent and hasattr(self.ctx.agent, 'inject_system_prompt'):
                self.ctx.agent.inject_system_prompt(prefix="")
            self.ctx.ui.success("📋 Plan mode: off\n")

        else:
            # Toggle
            current = self.ctx.cfg.get("plan_mode", False)
            self.ctx.cfg["plan_mode"] = not current
            if self.ctx.agent and hasattr(self.ctx.agent, '_plan_mode'):
                self.ctx.agent._plan_mode = not current
            state = "on" if not current else "off"
            self.ctx.ui.info(f"Plan mode: {state}\n")

        # Update status bar to reflect change
        if self.ctx._app:
            self.ctx._app._update_status_bar()
        self.ctx.ui.section_end()

    def cmd_pm_global(self, args: str = "") -> None:
        """Toggle plan mode globally (persists across sessions)."""
        arg = args.strip().lower()

        PLAN_MODE_PROMPT = "Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.\n\nAsk the questions one at a time.\n\nIf a question can be answered by exploring the codebase, explore the codebase instead."

        if arg in ("on", "true", "1"):
            self.ctx.cfg["plan_mode"] = True
            if self.ctx.agent and hasattr(self.ctx.agent, '_plan_mode'):
                self.ctx.agent._plan_mode = True
            if self.ctx.agent and hasattr(self.ctx.agent, 'inject_system_prompt'):
                existing_prefix = getattr(self.ctx.agent, '_injected_prefix', "") or ""
                if not existing_prefix:
                    self.ctx.agent.inject_system_prompt(prefix=PLAN_MODE_PROMPT)
            # Save to config file
            self.ctx._save_cfg_global("plan_mode", True)
            self.ctx.ui.success("📋 Plan mode: on (global)\n")

        elif arg in ("off", "false", "0"):
            self.ctx.cfg["plan_mode"] = False
            if self.ctx.agent and hasattr(self.ctx.agent, '_plan_mode'):
                self.ctx.agent._plan_mode = False
            if self.ctx.agent and hasattr(self.ctx.agent, 'inject_system_prompt'):
                self.ctx.agent.inject_system_prompt(prefix="")
            self.ctx._save_cfg_global("plan_mode", False)
            self.ctx.ui.success("📋 Plan mode: off (global)\n")

        else:
            self.ctx.ui.error(
                "请指定 on 或 off。用法: /pm_global [on|off]\n"
                "   此设置将持久化到配置文件\n"
            )

        # Update status bar to reflect change
        if self.ctx._app:
            self.ctx._app._update_status_bar()
        self.ctx.ui.section_end()