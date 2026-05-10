"""WindowCommands — multi-window management slash command implementations.

Commands: /win_new, /win_close, /win_list, /win_switch

These commands manage multiple DrSai chat windows (Toplevel instances)
each bound to a different SessionContext with its own agent and conversation.

Key design constraint:
    Tkinter widget creation and manipulation MUST happen on the main thread
    (the thread running tkinter's mainloop).  Async operations (agent init,
    thread state loading) happen on the asyncio background thread.

    cmd_win_new is async because it needs to await agent.lazy_init() and
    thread state loading.  But the Tkinter window creation part must be
    deferred to the main thread via root.after().  This is why the method
    is split into two phases:
      Phase 1 (async thread): create session, init agent, load state
      Phase 2 (main thread):   create Toplevel window, attach to session
"""

from __future__ import annotations

import asyncio
from typing import Any, Optional

from loguru import logger

from drsai.backend.gui.app_context import AppContext
from drsai.backend.gui.session_context import SessionContext
from drsai.backend.gui.lazy_imports import (
    get_CLISessionStore, get_DrSaiChatWindow,
    get_create_agent, get_SessionStats,
)


class WindowCommands:
    """Multi-window management command implementations for DrSai desktop app."""

    def __init__(self, ctx: AppContext) -> None:
        self.ctx = ctx

    # ── /win_new ────────────────────────────────────────────────────────────

    async def cmd_win_new(self, args: str = "") -> None:
        """Create a new chat window with a fresh session and agent.

        This is split into two phases to respect Tkinter's main-thread rule:
          Phase 1 (async/asyncio thread): create session, init agent, load state
          Phase 2 (tkinter main thread):   create Toplevel window, attach, display

        The window creation is scheduled via root.after() so it runs on the
        tkinter mainloop thread, while the async agent init runs on the asyncio
        background thread.
        """
        try:
            app = self.ctx._app
            if app is None:
                ui = self.ctx.get_active_session_ui()
                if ui is not None:
                    ui.error("无法创建新窗口：缺少 AppContext 引用\n")
                    ui.section_end()
                else:
                    logger.error("cmd_win_new: no AppContext and no UIFormatter available")
                return

            # ── Phase 1: Async operations (run on asyncio thread) ───────────

            # Save the ORIGINAL window's UIFormatter BEFORE any state changes.
            orig_ui = self.ctx.get_active_session_ui()
            if orig_ui is None:
                orig_ui = self.ctx.ui

            # Save the ORIGINAL session's state BEFORE register_session()
            # changes ctx.agent, ctx.stats, ctx.current_thread, etc.
            # These are needed to create a SessionContext for the original
            # session when entering multi-window mode.
            orig_session_id = self.ctx.current_session_id
            orig_agent = self.ctx.agent
            orig_stats = self.ctx.stats
            orig_current_thread = self.ctx.current_thread
            orig_show_reasoning = self.ctx._show_reasoning

            # Create new session via CLISessionStore
            CLISessionStore = get_CLISessionStore()
            store = CLISessionStore(self.ctx.db_manager, self.ctx.user_id)
            name = args.strip() or None
            new_session_id = store.create(name=name)

            # Create SessionContext for the new window
            sctx = SessionContext(
                session_id=new_session_id,
                session_name=name or new_session_id[:8],
                app=app,
            )

            # Initialize stats for the new session
            SessionStats = get_SessionStats()
            sctx.stats = SessionStats(show_footer=True, ring_bell=False)

            # Initialize agent for the new session
            create_agent = get_create_agent()
            sctx.agent = create_agent(
                api_key=self.ctx.cfg.get("api_key") or None,
                thread_id=new_session_id,
                user_id=self.ctx.user_id,
                db_manager=self.ctx.db_manager,
                defult_config_name=self.ctx.defult_config_name,
                cli_cfg=self.ctx.cfg,
                work_dir=self.ctx._work_dir,
            )

            if hasattr(sctx.agent, "lazy_init"):
                await sctx.agent.lazy_init()

            # Load thread state
            state_dict = await app._load_thread_state(new_session_id)
            if state_dict and hasattr(sctx.agent, "load_state"):
                await sctx.agent.load_state(state_dict)

            # Get or create thread record
            sctx.current_thread = await app._get_or_create_thread(new_session_id)

            # Register session in AppContext — NOTE: this calls set_active_session()
            # which updates ctx.ui, ctx._chat_window, ctx.agent etc. to point to
            # the new session (which has no window yet, so ctx.ui becomes None).
            # We saved orig_ui above to still have access to the original window.
            self.ctx.register_session(new_session_id, sctx)

            # ── Phase 2: Tkinter operations (schedule on main thread) ────────
            # All Tkinter widget creation and manipulation MUST happen on the
            # main thread (where tkinter's mainloop runs).  We use root.after()
            # to schedule the window creation on the main thread.
            #
            # We do NOT block the asyncio thread waiting for the main thread
            # to finish, because that would prevent other chat sessions from
            # processing their async operations. Instead, the main-thread
            # callback reports success/error directly via UIFormatter.

            root_window = self.ctx._root or self.ctx._chat_window
            if root_window is None:
                logger.error("No Tk root window available for Toplevel creation")
                if orig_ui is not None:
                    orig_ui.error("创建新窗口失败：没有 Tk 根窗口\n")
                    orig_ui.section_end()
                # Clean up the session that was registered but has no window
                self.ctx.unregister_session(new_session_id)
                return

            # Schedule window creation on the tkinter main thread.
            # Pass original session data so we can create a SessionContext for it.
            root_window.after(0, self._create_window_on_main_thread,
                              new_session_id, sctx, app, name, orig_ui,
                              orig_session_id, orig_agent, orig_stats,
                              orig_current_thread, orig_show_reasoning)

            logger.info(f"New window creation scheduled for session: {new_session_id}")

        except Exception as e:
            logger.error(f"cmd_win_new error: {e}", exc_info=True)
            # Use get_active_session_ui() for safe UIFormatter retrieval
            ui = self.ctx.get_active_session_ui()
            if ui is not None:
                ui.error(f"创建新窗口失败: {e}\n")
                ui.section_end()
            else:
                logger.error(f"cmd_win_new: no ui available to report error: {e}")

    def _create_window_on_main_thread(
        self,
        session_id: str,
        sctx: SessionContext,
        app: Any,
        name: Optional[str],
        orig_ui: Any,
        orig_session_id: Optional[str] = None,
        orig_agent: Any = None,
        orig_stats: Any = None,
        orig_current_thread: Any = None,
        orig_show_reasoning: bool = False,
    ) -> None:
        """Create the Toplevel window on the tkinter main thread.

        This method is scheduled via root.after(0, ...) from the async
        cmd_win_new method, ensuring all Tkinter operations run on the
        main thread where tkinter's mainloop is running.

        After creating the window, it reports success/error directly
        via the original window's UIFormatter (orig_ui), without
        blocking the asyncio thread.

        IMPORTANT: This also ensures the ORIGINAL (root) window has a
        proper SessionContext with session-specific callbacks.  The root
        window starts with global callbacks (_on_user_message, _on_command)
        that use ctx.agent (a global pointer).  Once we enter multi-window
        mode, the root window MUST be rebound to session-specific callbacks
        so that each window independently talks to its own agent/session.
        """
        try:
            # ── Step 0: Ensure original session has a SessionContext ────────
            self._ensure_original_session_context(
                app, orig_session_id, orig_agent, orig_stats,
                orig_current_thread, orig_show_reasoning
            )

            # ── Step 1: Create the new Toplevel window ──────────────────────
            DrSaiChatWindow = get_DrSaiChatWindow()
            root_window = self.ctx._root or self.ctx._chat_window

            new_window = DrSaiChatWindow(
                parent=root_window,
                send_message_fn=app._on_user_message_for_session(sctx),
                on_command_fn=app._on_command_for_session(sctx),
                on_minimize_fn=lambda: new_window.withdraw(),
                on_quit_fn=lambda: app._on_win_close(session_id),
                on_interrupt_fn=app._on_interrupt_for_session(sctx),
                on_setup_fn=app._on_setup_from_tray,
                title=f"DrSai Chat — {self.ctx.user_id} @ {sctx.defult_config_name}",
            )

            # ── Step 2: Attach window to session ────────────────────────────
            sctx.attach_window(new_window)
            self.ctx.register_window(session_id, new_window)

            # Create UIFormatter for the new session
            from drsai.backend.gui.ui_formatter import UIFormatter
            sctx.ui = UIFormatter(new_window)

            # Update AppContext's legacy fields to reflect the new session
            self.ctx.set_active_session(session_id)

            # ── Step 3: Welcome message + status bar ────────────────────────
            new_window.append_text("🤖 DrSai Chat — 新窗口\n", "system")
            new_window.append_text(f"会话 ID: {session_id[:8]}...\n", "system")
            new_window.append_text("Enter 发送，Shift+Enter 换行，Escape/⏹ 中断回复。\n", "system")
            new_window.append_text("输入 /help 或 /h 查看所有命令。\n\n", "system")

            new_window.set_status_info(sctx.build_status_bar())

            logger.info(f"Window created on main thread for session: {session_id}")

            # ── Report success in the ORIGINAL window ────────────────────
            if orig_ui:
                orig_ui.success(f"🪟 新窗口已创建: {name or session_id[:8]}\n")
                orig_ui.hint(f"   会话 ID: {session_id}\n")
                orig_ui.section_end()
            else:
                logger.warning(f"No UIFormatter for original window, new session created: {session_id}")

        except Exception as e:
            logger.error(f"Window creation on main thread failed: {e}", exc_info=True)
            if orig_ui is not None:
                orig_ui.error(f"创建新窗口失败: {e}\n")
                orig_ui.section_end()
            self.ctx.unregister_session(session_id)

    def _ensure_original_session_context(
        self,
        app: Any,
        orig_session_id: Optional[str] = None,
        orig_agent: Any = None,
        orig_stats: Any = None,
        orig_current_thread: Any = None,
        orig_show_reasoning: bool = False,
    ) -> None:
        """Ensure the original (root) session has a proper SessionContext.

        The root window starts with global callbacks (_on_user_message,
        _on_command) that reference ctx.agent, ctx.stats, etc. (global
        pointers).  When set_active_session() switches to a new window's
        session, those global pointers change, making the original window
        "talk" to the wrong agent.

        This method creates a SessionContext for the original session
        (using saved references passed from Phase 1) and rebinds the
        root window to session-specific callbacks, so each window
        independently talks to its own agent/session.

        Called once when the FIRST new window is created.
        """
        if not orig_session_id:
            logger.warning("No original session_id — skipping SessionContext creation for root")
            return

        # Already has a SessionContext — just check if rebinding is needed
        if orig_session_id in self.ctx._sessions:
            orig_sctx = self.ctx._sessions[orig_session_id]
            root_win = self.ctx._root
            if root_win and hasattr(root_win, '_on_command_fn'):
                fn_name = getattr(root_win._on_command_fn, '__name__', '')
                if fn_name != '_fn':
                    app._rebind_window_callbacks(root_win, orig_sctx)
                    logger.info(f"Root window callbacks rebound: {orig_session_id}")
            return

        # ── Create SessionContext for the original session ──────────────
        # Use saved references from Phase 1 (before register_session
        # changed ctx.agent etc. to point to the new session).
        root_win = self.ctx._root

        orig_sctx = SessionContext(
            session_id=orig_session_id,
            session_name="desktop",
            app=app,
            agent=orig_agent,
            stats=orig_stats,
            current_thread=orig_current_thread,
            _chat_window=root_win,
            ui=self.ctx.ui,  # May be None if switched, but we recover below
            _show_reasoning=orig_show_reasoning,
        )

        # Recover the original UIFormatter if ctx.ui was switched to None
        if orig_sctx.ui is None and root_win is not None:
            from drsai.backend.gui.ui_formatter import UIFormatter
            orig_sctx.ui = UIFormatter(root_win)

        # Register in sessions dict WITHOUT calling set_active_session
        # (we don't want to change the global pointers right now)
        self.ctx._sessions[orig_session_id] = orig_sctx
        self.ctx._windows[orig_session_id] = root_win

        # ── Rebind root window to session-specific callbacks ────────────
        if root_win is not None:
            app._rebind_window_callbacks(root_win, orig_sctx)
            logger.info(f"Root window SessionContext created and callbacks rebound to: {orig_session_id}")

    # ── /win_close ──────────────────────────────────────────────────────────

    def cmd_win_close(self, args: str = "") -> None:
        """Close the current chat window.

        If only one window remains, minimize to tray instead of closing
        (to keep the app running).
        """
        try:
            app = self.ctx._app
            if app is None:
                ui = self.ctx.get_active_session_ui()
                if ui is not None:
                    ui.error("无法关闭窗口：缺少 AppContext 引用\n")
                    ui.section_end()
                return

            active_id = self.ctx._active_session_id
            num_windows = sum(
                1 for sid, win in self.ctx._windows.items()
                if win and win.winfo_exists() and win.state() != "withdrawn"
            )

            if num_windows <= 1:
                # Last visible window — minimize to tray instead of close
                ui = self.ctx.get_active_session_ui()
                if ui is not None:
                    ui.warn("⚠ 这是最后一个窗口，将最小化到托盘而非关闭\n")
                    ui.hint("   如需完全退出，请使用 /quit 或托盘菜单「退出」\n")
                    ui.section_end()
                if self.ctx._chat_window:
                    self.ctx._chat_window.withdraw()
                return

            # Close the window and remove from registry
            app._on_win_close(active_id)

        except Exception as e:
            logger.error(f"cmd_win_close error: {e}", exc_info=True)
            ui = self.ctx.get_active_session_ui()
            if ui is not None:
                ui.error(f"关闭窗口失败: {e}\n")
                ui.section_end()

    # ── /win_list ───────────────────────────────────────────────────────────

    def cmd_win_list(self, args: str = "") -> None:
        """List all open windows and their sessions."""
        try:
            sessions = self.ctx._sessions
            windows = self.ctx._windows
            active_id = self.ctx._active_session_id
            ui = self.ctx.get_active_session_ui()

            if not ui:
                logger.warning("win_list: no UIFormatter available")
                return

            if not sessions:
                ui.info("暂无打开的窗口\n")
                ui.section_end()
                return

            lines = ["\n  🪟 窗口列表:\n"]
            for i, (sid, sctx) in enumerate(sessions.items(), 1):
                name = sctx.session_name or sid[:8]
                model = sctx.defult_config_name or "?"
                has_win = sid in windows and windows[sid] and windows[sid].winfo_exists()
                state = "🪟 可见" if has_win else "  隐藏/无窗口"
                current = " ← 当前" if sid == active_id else ""
                lines.append(f"    {i}. {state} {name}  @{model}{current}")

            lines.append("")
            ui.raw("\n".join(lines), "system")
            ui.hint(
                "   /win_new    — 创建新窗口\n"
                "   /win_close  — 关闭当前窗口\n"
                "   /switch <id>— 切换到指定会话\n"
            )
            ui.section_end()

        except Exception as e:
            logger.error(f"cmd_win_list error: {e}", exc_info=True)
            ui = self.ctx.get_active_session_ui()
            if ui is not None:
                ui.error(f"窗口列表失败: {e}\n")
                ui.section_end()

    # ── /win_switch ─────────────────────────────────────────────────────────

    async def cmd_win_switch(self, args: str = "") -> None:
        """Switch focus to a different window / session by ID or name.

        Behavior:
        - If the target session has a visible window → focus that window
        - If the target session exists in _sessions but has no window → switch
          the current window's sctx to that session (using _switch_session_in_window)
        - If the target session doesn't exist at all → create a new SessionContext
          and switch the current window to it
        """
        target = args.strip()
        if not target:
            # Show window list dialog
            self.cmd_win_list()
            return

        try:
            app = self.ctx._app
            ui = self.ctx.get_active_session_ui()
            if app is None:
                if ui is not None:
                    ui.error("无法切换窗口：缺少 AppContext 引用\n")
                    ui.section_end()
                return

            # Resolve target to session ID
            store = self._get_store()
            matched = store.resolve(target)
            if not matched:
                if ui is not None:
                    ui.error(f"会话未找到: {target}\n")
                    ui.hint("   使用 /win_list 查看所有窗口\n")
                    ui.section_end()
                return

            target_sid = matched.thread_id
            name_display = matched.name or target_sid[:8]

            # ── Case 1: target session has a visible window → just focus it ──
            if self.ctx.focus_session_window(target_sid):
                ui = self.ctx.get_active_session_ui()
                if ui is not None:
                    ui.success(f"🪟 已切换到窗口: {name_display}\n")
                    ui.section_end()
                return

            # ── Cases 2 & 3: need to switch session within a window ──
            current_sctx = self.ctx.get_active_session()
            if current_sctx is None:
                if ui is not None:
                    ui.error("当前没有活跃会话\n")
                    ui.section_end()
                return

            target_sctx = self.ctx._sessions.get(target_sid)

            if target_sctx is not None:
                # ── Case 2: target session exists, has an agent, no window ──
                # Rebind current window to target session.
                # Schedule Tkinter operations on main thread via root.after()
                root_window = self.ctx._root or self.ctx._chat_window
                if root_window is None:
                    logger.error("No root window for session switch")
                    return

                orig_ui = self.ctx.get_active_session_ui()
                root_window.after(0, self._switch_to_existing_session_on_main_thread,
                                  target_sid, target_sctx, current_sctx, app,
                                  name_display, orig_ui)

            else:
                # ── Case 3: target session doesn't exist in _sessions ──
                # → First do async operations (create agent, load state),
                #   then schedule Tkinter operations on main thread.

                orig_ui = self.ctx.get_active_session_ui()
                if orig_ui is not None:
                    orig_ui.warn(f"该会话尚未加载，在当前窗口中切换并初始化\n")

                # Async phase: create agent and load state
                await app._switch_session_in_window(current_sctx, target_sid)

                # Re-register the session (session_id changed)
                self.ctx.unregister_session(current_sctx.session_id)
                self.ctx.register_session(target_sid, current_sctx)
                self.ctx.register_window(target_sid, self.ctx._chat_window)

                # Schedule Tkinter rebinding on main thread
                root_window = self.ctx._root or self.ctx._chat_window
                if root_window:
                    root_window.after(0, self._rebind_window_on_main_thread,
                                      self.ctx._chat_window, current_sctx, app,
                                      name_display, orig_ui)

                app._update_status_bar()

        except Exception as e:
            logger.error(f"cmd_win_switch error: {e}", exc_info=True)
            ui = self.ctx.get_active_session_ui()
            if ui is not None:
                ui.error(f"切换窗口失败: {e}\n")
                ui.section_end()

    def _switch_to_existing_session_on_main_thread(
        self,
        target_sid: str,
        target_sctx: SessionContext,
        current_sctx: SessionContext,
        app: Any,
        name_display: str,
        orig_ui: Any,
    ) -> None:
        """Rebind current window to an existing session — runs on tkinter main thread."""
        try:
            # Detach current window from old session
            old_sid = current_sctx.session_id
            current_sctx.detach_window()
            self.ctx.unregister_window(old_sid)

            # Attach current window to target session
            current_window = self.ctx._chat_window
            target_sctx.attach_window(current_window)
            self.ctx.register_window(target_sid, current_window)

            # Update AppContext active session
            self.ctx.set_active_session(target_sid)

            # Rebind the window's command/message callbacks to target_sctx
            app._rebind_window_callbacks(current_window, target_sctx)

            # Update window title and status bar
            current_window.title(
                f"DrSai Chat — {self.ctx.user_id} @ {target_sctx.defult_config_name}"
            )
            current_window.set_status_info(target_sctx.build_status_bar())

            # Report success in original window
            if orig_ui:
                orig_ui.success(f"已切换到会话: {name_display}\n")
                orig_ui.section_end()

            app._update_status_bar()

        except Exception as e:
            logger.error(f"Switch session on main thread failed: {e}", exc_info=True)
            if orig_ui:
                orig_ui.error(f"切换会话失败: {e}\n")
                orig_ui.section_end()

    def _rebind_window_on_main_thread(
        self,
        window: Any,
        sctx: SessionContext,
        app: Any,
        name_display: str,
        orig_ui: Any,
    ) -> None:
        """Rebind window callbacks after session switch — runs on tkinter main thread."""
        try:
            app._rebind_window_callbacks(window, sctx)

            window.title(
                f"DrSai Chat — {self.ctx.user_id} @ {sctx.defult_config_name}"
            )
            window.set_status_info(sctx.build_status_bar())

            if orig_ui:
                orig_ui.success(f"已切换到会话: {name_display}\n")
                orig_ui.section_end()

        except Exception as e:
            logger.error(f"Rebind window on main thread failed: {e}", exc_info=True)
            if orig_ui:
                orig_ui.error(f"切换会话失败: {e}\n")
                orig_ui.section_end()

    def _get_store(self):
        """Create a CLISessionStore instance with correct API."""
        CLISessionStore = get_CLISessionStore()
        return CLISessionStore(self.ctx.db_manager, self.ctx.user_id)