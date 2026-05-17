"""FileCommands — file/workspace slash command implementations.

Commands: /cd, /init, /save, /install
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path

from loguru import logger

from drsai.backend.gui.app_context import AppContext
from drsai.backend.gui.lazy_imports import (
    get_init_project_instructions, get_load_project_instructions,
)


class FileCommands:
    """File/workspace command implementations for DrSai desktop app."""

    def __init__(self, ctx: AppContext) -> None:
        self.ctx = ctx

    def cmd_cd(self, args: str = "") -> None:
        """Change current working directory."""
        target = args.strip()
        if not target:
            # Show current working directory
            self.ctx.ui.info(f"Current directory: {self.ctx._work_dir}\n")
            self.ctx.ui.section_end()
            return

        # Resolve path
        if not os.path.isabs(target):
            target = os.path.normpath(os.path.join(self.ctx._work_dir, target))

        if not os.path.isdir(target):
            self.ctx.ui.error(f"目录不存在: {target}\n")
            self.ctx.ui.section_end()
            return

        try:
            self.ctx._work_dir = target
            if self.ctx.agent:
                if hasattr(self.ctx.agent, '_work_dir'):
                    self.ctx.agent._work_dir = target
                if hasattr(self.ctx.agent, '_workbench'):
                    self.ctx.agent._workbench._work_dir = target

            self.ctx.ui.success(f"✅ 工作目录已更改: {target}\n")
            self.ctx.ui.section_end()

        except Exception as e:
            self.ctx.ui.error(f"更改目录失败: {e}\n")
            self.ctx.ui.section_end()

    def cmd_init(self, args: str = "") -> None:
        """Initialize project instructions for the current workspace."""
        try:
            init_project_instructions = get_init_project_instructions()
            result = init_project_instructions(self.ctx._work_dir)
            self.ctx.ui.success(f"✅ 项目指令已初始化\n")
            if result:
                self.ctx.ui.info(f"   {result}\n")
            self.ctx.ui.section_end()

        except Exception as e:
            self.ctx.ui.error(f"初始化项目指令失败: {e}\n")
            self.ctx.ui.section_end()

    async def cmd_save(self, args: str = "") -> None:
        """Save current session state to database."""
        try:
            if not self.ctx.current_session_id:
                self.ctx.ui.warn("没有活跃会话可保存\n")
                self.ctx.ui.section_end()
                return

            if self.ctx.agent and hasattr(self.ctx.agent, 'save_state'):
                # Use agent.save_state() — the new persistence API
                state_dict = await self.ctx.agent.save_state()
                # Delegate to the app's _save_thread_state for database persistence
                if hasattr(self.ctx, '_app') and self.ctx._app:
                    ok = await self.ctx._app._save_thread_state(self.ctx.current_session_id, state_dict)
                    if ok:
                        self.ctx.ui.success("✅ 会话已保存\n")
                    else:
                        self.ctx.ui.error("保存会话到数据库失败\n")
                else:
                    self.ctx.ui.warn("无法保存：应用实例不可用\n")
            else:
                self.ctx.ui.warn("没有活跃 Agent 可保存\n")

            self.ctx.ui.section_end()

        except Exception as e:
            self.ctx.ui.error(f"保存会话失败: {e}\n")
            self.ctx.ui.section_end()

    def cmd_install(self, args: str = "") -> None:
        """Install project instructions from a file."""
        source = args.strip()
        if not source:
            self.ctx.ui.error("请指定文件路径。用法: /install <file_path>\n")
            self.ctx.ui.section_end()
            return

        try:
            load_project_instructions = get_load_project_instructions()
            combined_text, loaded_paths, md_warnings = load_project_instructions(source)
            if combined_text:
                self.ctx.ui.success("✅ 项目指令已安装\n")
                for p in loaded_paths:
                    short_path = Path(p).name
                    self.ctx.ui.info(f"   已加载: {short_path}\n")
            else:
                self.ctx.ui.warn("没有找到项目指令文件\n")
            for w in md_warnings:
                self.ctx.ui.warn(f"   {w}\n")
            self.ctx.ui.section_end()

        except Exception as e:
            self.ctx.ui.error(f"安装项目指令失败: {e}\n")
            self.ctx.ui.section_end()