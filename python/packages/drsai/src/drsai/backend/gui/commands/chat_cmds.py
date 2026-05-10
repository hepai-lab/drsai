"""ChatCommands — basic chat/view slash command implementations.

Commands: /help, /clear, /info, /tray, /retry
"""

from __future__ import annotations

import os
import tkinter as tk

from loguru import logger

from drsai.backend.cli.commands import format_help
from drsai.backend.gui.app_context import AppContext
from drsai.backend.gui.lazy_imports import (
    get_load_llm_mode_config, get_DrSaiTrayApp, get_CLISessionStore,
    get_compress_state, get_decompress_state,
)


class ChatCommands:
    """Basic chat command implementations for DrSai desktop app."""

    def __init__(self, ctx: AppContext) -> None:
        self.ctx = ctx

    def cmd_help(self, args: str = "") -> None:
        """Show help text in the chat display."""
        help_text = format_help()
        for line in help_text.split("\n"):
            self.ctx._chat_window.append_text(line + "\n", "help")
        self.ctx.ui.section_end()

    def cmd_clear(self, args: str = "") -> None:
        """Clear the chat display."""
        self.ctx._chat_window.after(0, lambda: (
            self.ctx._chat_window.chat_display.config(state="normal"),
            self.ctx._chat_window.chat_display.delete("1.0", tk.END),
            self.ctx._chat_window.chat_display.config(state="disabled"),
            self.ctx._chat_window.append_text("🤖 屏幕已清除。继续对话或输入 /help。\n\n", "system"),
        ))

    def cmd_info(self, args: str = "") -> None:
        """Show session configuration, tools and skills."""
        model_name = getattr(self.ctx.agent, '_defult_config_name', None) or self.ctx.defult_config_name
        tools = []
        if self.ctx.agent:
            if hasattr(self.ctx.agent, '_workbench') and hasattr(self.ctx.agent._workbench, '_tools'):
                tools = [t.name for t in self.ctx.agent._workbench._tools]

        skills = []
        if self.ctx.agent:
            if hasattr(self.ctx.agent, '_skill_registry'):
                skills = list(self.ctx.agent._skill_registry.keys())

        workspace = "restricted" if getattr(self.ctx.agent, '_only_in_workspace', False) else "open"

        lines = [
            f"\n  Session info:\n",
            f"    Model:          {model_name}\n",
            f"    Session ID:     {self.ctx.current_session_id}\n",
            f"    User ID:        {self.ctx.user_id}\n",
            f"    Work dir:       {self.ctx._work_dir}\n",
            f"    Workspace:      {workspace}\n",
            f"    Tools:          {len(tools)} registered\n",
        ]
        if tools:
            for t in tools[:20]:
                lines.append(f"      - {t}\n")
        if skills:
            lines.append(f"    Skills:         {len(skills)}\n")
            for s in skills[:10]:
                lines.append(f"      - {s}\n")

        lines.append("")
        self.ctx.ui.raw("\n".join(lines), "system")
        self.ctx.ui.section_end()

    def cmd_tray(self, args: str = "") -> None:
        """Check tray icon status or recreate it."""
        arg = args.strip().lower()

        if arg in ("status", ""):
            if self.ctx._tray_app is None:
                self.ctx.ui.error("系统托盘图标未创建\n")
                self.ctx.ui.info("   可能原因: pystray 未安装，或创建时出错\n")
                self.ctx.ui.hint("   修复: pip install drsai[tray]，然后输入 /tray create\n")
            elif not self.ctx._tray_app.is_running:
                self.ctx.ui.warn("系统托盘图标已停止运行\n")
                self.ctx.ui.hint("   输入 /tray create 重新创建\n")
            else:
                self.ctx.ui.success("系统托盘图标运行中\n")
                icon = self.ctx._tray_app._icon
                if icon:
                    for attr, label in [("_visible", "可见性"), ("_icon_valid", "图标有效性"), ("_running", "运行状态")]:
                        try:
                            val = getattr(icon, attr, "N/A")
                            self.ctx.ui.info(f"   {label}: {val}\n")
                        except Exception:
                            self.ctx.ui.info(f"   {label}: 无法检查\n")
                    if hasattr(icon, "_thread") and icon._thread:
                        self.ctx.ui.info(f"   线程活跃: {icon._thread.is_alive()}\n")
                self.ctx.ui.hint(
                    "如果看不到图标，请点击任务栏右下角的 ↑ 箭头\n"
                    "   查看溢出区域。Windows设置→任务栏→通知区域\n"
                    "   可以将 DrSai 设为「始终显示」。\n\n"
                )
            self.ctx.ui.section_end()

        elif arg in ("create", "start", "restart"):
            try:
                if self.ctx._tray_app:
                    self.ctx._tray_app.stop()
                    self.ctx._tray_app = None

                DrSaiTrayApp = get_DrSaiTrayApp()
                self.ctx._tray_app = DrSaiTrayApp(
                    show_window_fn=self.ctx._chat_window._on_show_window if hasattr(self.ctx._chat_window, '_on_show_window') else lambda: None,
                    setup_fn=self.ctx._chat_window._on_setup_from_tray if hasattr(self.ctx._chat_window, '_on_setup_from_tray') else lambda: None,
                    quit_fn=self.ctx._chat_window._on_quit if hasattr(self.ctx._chat_window, '_on_quit') else lambda: None,
                    title=f"DrSai — {self.ctx.defult_config_name}",
                )
                self.ctx._tray_app.run_detached()
                self.ctx.ui.success("系统托盘图标已重新创建\n")
            except Exception as e:
                self.ctx.ui.error(f"创建托盘图标失败: {e}\n")
                self.ctx._tray_app = None
            self.ctx.ui.section_end()

        elif arg in ("hide", "stop", "remove"):
            if self.ctx._tray_app:
                self.ctx._tray_app.stop()
                self.ctx.ui.warn("系统托盘图标已隐藏\n")
                self.ctx.ui.hint("   输入 /tray create 重新创建\n")
            else:
                self.ctx.ui.info("托盘图标不存在\n")
            self.ctx.ui.section_end()

        else:
            self.ctx.ui.info(
                "Usage: /tray [status|create|hide]\n"
                "  /tray           — 显示托盘图标状态\n"
                "  /tray create    — 重新创建托盘图标\n"
                "  /tray hide      — 隐藏托盘图标\n"
            )
            self.ctx.ui.section_end()

    def cmd_retry(self, args: str = "") -> None:
        """Retry the last user message."""
        if not self.ctx.agent:
            self.ctx.ui.error("Agent 未初始化\n")
            self.ctx.ui.section_end()
            return

        # Get last user message from chat history
        try:
            if hasattr(self.ctx.agent, '_history') and self.ctx.agent._history:
                last_user_msg = None
                for msg in reversed(self.ctx.agent._history):
                    if msg.get("role") == "user":
                        last_user_msg = msg.get("content", "")
                        break

                if last_user_msg:
                    self.ctx.ui.info("🔄 重试上一次消息...\n")
                    import asyncio
                    asyncio.run_coroutine_threadsafe(
                        self.ctx.agent_manager._do_chat(last_user_msg),
                        self.ctx._loop,
                    )
                else:
                    self.ctx.ui.warn("没有找到上一次用户消息\n")
            else:
                self.ctx.ui.warn("没有对话历史\n")
        except Exception as e:
            self.ctx.ui.error(f"重试失败: {e}\n")
        self.ctx.ui.section_end()