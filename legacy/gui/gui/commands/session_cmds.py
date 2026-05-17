"""SessionCommands — session management slash command implementations.

Commands: /new, /switch, /resume, /history, /search, /rename, /list, /copy

CLISessionStore API:
    store = CLISessionStore(db_manager, user_id)
    store.create(name=None)         -> thread_id
    store.list(limit=50)            -> list[SessionInfo]
    store.search(query, limit=20)   -> list[SessionInfo]
    store.rename(thread_id, name)   -> bool
    store.resolve(token)            -> Optional[SessionInfo]
    store.load(thread_id)           -> list[dict]
    store.set_workdir(thread_id, wd) -> bool

Agent state persistence:
    await agent.save_state()    -> dict
    await agent.load_state(dict)
"""

from __future__ import annotations

from loguru import logger

from drsai.backend.gui.app_context import AppContext
from drsai.backend.gui.lazy_imports import (
    get_CLISessionStore, get_pyperclip,
)


class SessionCommands:
    """Session management command implementations for DrSai desktop app."""

    def __init__(self, ctx: AppContext) -> None:
        self.ctx = ctx

    def _get_store(self):
        """Create a CLISessionStore instance with correct API."""
        CLISessionStore = get_CLISessionStore()
        return CLISessionStore(self.ctx.db_manager, self.ctx.user_id)

    # ── /new ────────────────────────────────────────────────────────────────

    async def cmd_new(self, args: str = "") -> None:
        """Start a new chat session."""
        try:
            store = self._get_store()

            # Create new session
            name = args.strip() or None
            new_session_id = store.create(name=name)

            # Re-init agent for new session (saves old state automatically)
            if hasattr(self.ctx, '_app') and self.ctx._app:
                await self.ctx._app._reinit_agent_for_session(new_session_id)

            self.ctx.ui.success(f"New session created: {new_session_id}\n")
            self.ctx.ui.section_end()
            self.ctx._app._update_status_bar()

        except Exception as e:
            logger.error(f"cmd_new error: {e}", exc_info=True)
            self.ctx.ui.error(f"Failed to create session: {e}\n")
            self.ctx.ui.section_end()

    # ── /switch ─────────────────────────────────────────────────────────────

    async def cmd_switch(self, args: str = "") -> None:
        """Switch to a different session by ID or partial match."""
        target = args.strip()
        if not target:
            self.ctx.ui.error("Please specify a session ID or name. Usage: /switch <id_or_name>\n")
            self.ctx.ui.section_end()
            return

        try:
            store = self._get_store()

            # Resolve token to SessionInfo
            matched = store.resolve(target)
            if not matched:
                self.ctx.ui.error(f"Session not found: {target}\n")
                self.ctx.ui.hint("   Use /list to see all sessions\n")
                self.ctx.ui.section_end()
                return

            # Re-init agent for target session (saves current state automatically)
            if hasattr(self.ctx, '_app') and self.ctx._app:
                await self.ctx._app._reinit_agent_for_session(matched.thread_id)

            name_display = matched.name or matched.thread_id[:8]
            self.ctx.ui.success(f"Switched to session: {name_display}\n")
            self.ctx.ui.section_end()
            self.ctx._app._update_status_bar()

        except Exception as e:
            logger.error(f"cmd_switch error: {e}", exc_info=True)
            self.ctx.ui.error(f"Failed to switch session: {e}\n")
            self.ctx.ui.section_end()

    # ── /resume ─────────────────────────────────────────────────────────────

    async def cmd_resume(self, args: str = "") -> None:
        """Resume the most recent session."""
        try:
            store = self._get_store()

            sessions = store.list(limit=10)
            if not sessions:
                self.ctx.ui.warn("No previous sessions found\n")
                self.ctx.ui.section_end()
                return

            # Use the most recent session (first in sorted list)
            most_recent = sessions[0]

            if self.ctx.current_session_id == most_recent.thread_id:
                self.ctx.ui.info("Current session is already the most recent\n")
                self.ctx.ui.section_end()
                return

            # Re-init agent for most recent session (saves current state automatically)
            if hasattr(self.ctx, '_app') and self.ctx._app:
                await self.ctx._app._reinit_agent_for_session(most_recent.thread_id)

            name_display = most_recent.name or most_recent.thread_id[:8]
            self.ctx.ui.success(f"Resumed session: {name_display}\n")
            self.ctx.ui.section_end()
            self.ctx._app._update_status_bar()

        except Exception as e:
            logger.error(f"cmd_resume error: {e}", exc_info=True)
            self.ctx.ui.error(f"Failed to resume session: {e}\n")
            self.ctx.ui.section_end()

    # ── /history ────────────────────────────────────────────────────────────

    async def cmd_history(self, args: str = "") -> None:
        """Show session history."""
        try:
            store = self._get_store()
            sessions = store.list(limit=20)

            if not sessions:
                self.ctx.ui.info("No session history\n")
                self.ctx.ui.section_end()
                return

            lines = ["\n  Session history:\n"]
            for i, s in enumerate(sessions, 1):
                current_marker = " <-- current" if s.thread_id == self.ctx.current_session_id else ""
                name = s.name or s.thread_id[:8]
                preview = (s.preview or "")[:50]
                lines.append(f"    {i}. {name}{current_marker}  {preview}")

            lines.append("")
            self.ctx.ui.raw("\n".join(lines), "system")
            self.ctx.ui.section_end()

        except Exception as e:
            logger.error(f"cmd_history error: {e}", exc_info=True)
            self.ctx.ui.error(f"Failed to get history: {e}\n")
            self.ctx.ui.section_end()

    # ── /search ─────────────────────────────────────────────────────────────

    async def cmd_search(self, args: str = "") -> None:
        """Search session history by keyword."""
        keyword = args.strip()
        if not keyword:
            self.ctx.ui.error("Please specify a keyword. Usage: /search <keyword>\n")
            self.ctx.ui.section_end()
            return

        try:
            store = self._get_store()
            sessions = store.search(keyword, limit=20)

            if not sessions:
                self.ctx.ui.info(f"No sessions matching '{keyword}'\n")
                self.ctx.ui.section_end()
                return

            lines = [f"\n  Search results (keyword: '{keyword}'):\n"]
            for i, s in enumerate(sessions, 1):
                name = s.name or s.thread_id[:8]
                lines.append(f"    {i}. {name} ({s.thread_id[:8]}...)")

            lines.append("")
            self.ctx.ui.raw("\n".join(lines), "system")
            self.ctx.ui.section_end()

        except Exception as e:
            logger.error(f"cmd_search error: {e}", exc_info=True)
            self.ctx.ui.error(f"Search failed: {e}\n")
            self.ctx.ui.section_end()

    # ── /rename ─────────────────────────────────────────────────────────────

    async def cmd_rename(self, args: str = "") -> None:
        """Rename current session."""
        new_name = args.strip()
        if not new_name:
            self.ctx.ui.error("Please specify a new name. Usage: /rename <new_name>\n")
            self.ctx.ui.section_end()
            return

        try:
            store = self._get_store()
            ok = store.rename(self.ctx.current_session_id, new_name)
            if ok:
                self.ctx.ui.success(f"Session renamed to: {new_name}\n")
            else:
                self.ctx.ui.error("Rename failed - session may not exist\n")
            self.ctx.ui.section_end()

        except Exception as e:
            logger.error(f"cmd_rename error: {e}", exc_info=True)
            self.ctx.ui.error(f"Rename failed: {e}\n")
            self.ctx.ui.section_end()

    # ── /list ───────────────────────────────────────────────────────────────

    async def cmd_list(self, args: str = "") -> None:
        """List all sessions."""
        try:
            store = self._get_store()
            sessions = store.list(limit=30)

            if not sessions:
                self.ctx.ui.info("No sessions found\n")
                self.ctx.ui.section_end()
                return

            lines = ["\n  All sessions:\n"]
            for i, s in enumerate(sessions, 1):
                current_marker = " <-- current" if s.thread_id == self.ctx.current_session_id else ""
                name = s.name or ""
                tid_short = s.thread_id[:8]
                display = f"{tid_short}..." if not name else f"{name} ({tid_short}...)"
                lines.append(f"    {i}. {display}{current_marker}")

            lines.append("")
            self.ctx.ui.raw("\n".join(lines), "system")
            self.ctx.ui.section_end()

        except Exception as e:
            logger.error(f"cmd_list error: {e}", exc_info=True)
            self.ctx.ui.error(f"Failed to list sessions: {e}\n")
            self.ctx.ui.section_end()

    # ── /copy ───────────────────────────────────────────────────────────────

    async def cmd_copy(self, args: str = "") -> None:
        """Copy last assistant response to clipboard."""
        try:
            from autogen_core.models import AssistantMessage as _AssistantMessage

            pyperclip = get_pyperclip()

            if not self.ctx.agent:
                self.ctx.ui.warn("Agent not initialized\n")
                self.ctx.ui.section_end()
                return

            messages = list(self.ctx.agent._model_context._messages)
            last_text = None
            for msg in reversed(messages):
                if isinstance(msg, _AssistantMessage):
                    if isinstance(msg.content, str) and msg.content.strip():
                        last_text = msg.content
                        break

            if last_text:
                pyperclip.copy(last_text)
                self.ctx.ui.success("Copied to clipboard\n")
            else:
                self.ctx.ui.warn("No assistant response found\n")

            self.ctx.ui.section_end()

        except Exception as e:
            logger.error(f"cmd_copy error: {e}", exc_info=True)
            self.ctx.ui.error(f"Copy failed: {e}\n")
            self.ctx.ui.section_end()