"""DrSaiDesktopApp — thin orchestrator for the desktop tray application.

Architecture (方案B: AppContext + collaboration components):
    AppContext          — shared state container (cfg, agent, chat_window, loop, etc.)
    DrSaiDesktopApp     — orchestrator: creates AppContext + wires components + lifecycle
    CommandDispatcher   — registry-driven /command dispatch (from commands/ package)
    DrSaiSetupDialog    — first-time setup dialog (from setup_dialog.py)
    UIFormatter         — unified output API (from ui_formatter.py)

Thread model:
    Main thread  → tkinter.mainloop (all GUI operations)
    Async thread → asyncio event loop (agent.run_stream, async commands)
    Tray thread  → pystray.Icon (system tray icon)

Thread bridge:
    _call_async(coro)  → schedule coro on asyncio loop from any thread
    _call_gui(fn)      → schedule fn on tkinter main thread from any thread
"""

from __future__ import annotations

import asyncio
import os
import sys
import time
import threading
from pathlib import Path
from typing import Any, Optional, Callable

from loguru import logger

from drsai.configs.constant import APPNAME, VERSION, FS_DIR
from drsai.backend.cli import config as cli_config
from drsai.backend.cli.commands import resolve_command, format_help, COMMAND_REGISTRY

from drsai.backend.gui.app_context import AppContext
from drsai.backend.gui.ui_formatter import UIFormatter, SEPARATOR
from drsai.backend.gui.lazy_imports import (
    get_create_agent, get_load_llm_mode_config, get_DatabaseManager,
    get_SessionStats, get_CLISessionStore, get_config_as_dict_for_export,
    get_DrSaiChatWindow, get_DrSaiGUIRenderer, get_DrSaiTrayApp,
    get_datamodel, get_Thread, get_RunStatus, get_Response,
    get_compress_state, get_decompress_state,
    get_messagebox, get_pyperclip, get_shortcut_installer,
    get_init_project_instructions, get_load_project_instructions, get_signal,
)
from drsai.backend.gui.setup_dialog import DrSaiSetupDialog
from drsai.backend.gui.commands.dispatcher import CommandDispatcher


class DrSaiDesktopApp:
    """Top-level orchestrator: creates AppContext, wires components, manages lifecycle."""

    def __init__(self) -> None:
        # ── Create shared state container ──────────────────────────────────
        self.ctx = AppContext()
        self.ctx._app = self  # Register orchestrator for cross-component calls

        # ── Load config ─────────────────────────────────────────────────────
        self.ctx.cfg = self._load_or_setup_config()
        self.ctx.sync_from_cfg()

        # ── Determine setup behavior ──────────────────────────────────────────
        # _needs_setup: show setup dialog on first run (config file was auto-generated)
        # _setup_is_optional: user can cancel setup and still run (env key exists)
        has_any_key = self._has_any_api_key()
        self.ctx._needs_setup = self.ctx._config_file_is_new
        self.ctx._setup_is_optional = has_any_key

        # ── Stats tracking ──────────────────────────────────────────────────
        SessionStats = get_SessionStats()
        self.ctx.stats = SessionStats(show_footer=True, ring_bell=False)

        # ── Asyncio loop (runs in background thread) ────────────────────────
        # (fields already initialized in AppContext.__init__)

        # Start agent if any API key is available (env var or config file)
        if has_any_key:
            self._start_async_loop_and_init_agent()

    # ── Config loading ──────────────────────────────────────────────────────

    def _load_or_setup_config(self) -> dict:
        """Load config or create default. Also tracks whether config file was auto-generated."""
        self.ctx._config_file_is_new = not cli_config.CLI_CONFIG_PATH.exists()

        if not self.ctx._config_file_is_new:
            return cli_config.load_config()

        cfg = dict(cli_config.DEFAULT_CONFIG)
        cfg["user_id"] = os.environ.get("DRSAI_USER_ID", "anonymous")
        cli_config.save_config(cfg)
        return cfg

    def _has_any_api_key(self) -> bool:
        cfg = self.ctx.cfg
        return bool(
            cfg.get("api_key") or os.environ.get("HEPAI_API_KEY")
            or cfg.get("anthropic_api_key") or os.environ.get("ANTHROPIC_API_KEY")
            or cfg.get("openai_api_key") or os.environ.get("OPENAI_API_KEY")
        )

    def _detect_env_provider(self) -> Optional[str]:
        """Detect which API provider has an env key available for pre-fill."""
        for prov_id, env_var in [
            ("hepai", "HEPAI_API_KEY"),
            ("anthropic", "ANTHROPIC_API_KEY"),
            ("openai", "OPENAI_API_KEY"),
        ]:
            if os.environ.get(env_var):
                return prov_id
        return None

    # ── Async infrastructure ────────────────────────────────────────────────

    def _start_async_loop_and_init_agent(self) -> None:
        self.ctx._loop = asyncio.new_event_loop()
        self.ctx._loop_thread = threading.Thread(
            target=self._run_async_loop, daemon=True,
        )
        self.ctx._loop_thread.start()
        asyncio.run_coroutine_threadsafe(self._init_agent(), self.ctx._loop)

    def _run_async_loop(self) -> None:
        asyncio.set_event_loop(self.ctx._loop)
        try:
            self.ctx._loop.run_forever()
        except Exception as e:
            logger.error(f"Asyncio loop error: {e}")

    # ── Thread bridge helpers ──────────────────────────────────────────────

    def _call_async(self, coro) -> None:
        """Schedule an async coroutine on the background asyncio loop."""
        if self.ctx._loop and self.ctx._loop.is_running():
            asyncio.run_coroutine_threadsafe(coro, self.ctx._loop)

    def _call_gui(self, fn, *args) -> None:
        """Schedule a GUI call on the tkinter main thread."""
        # Use _root (stable Tk root reference) instead of _chat_window
        # (which may change in multi-window mode when sessions switch).
        root = self.ctx._root or self.ctx._chat_window
        if root:
            root.after(0, lambda: fn(*args))

    # ── Agent lifecycle ─────────────────────────────────────────────────────

    async def _init_agent(self) -> None:
        try:
            DatabaseManager = get_DatabaseManager()
            create_agent = get_create_agent()

            WORKSPACE = Path(FS_DIR) / "workspace"
            WORKSPACE.mkdir(parents=True, exist_ok=True)
            DATASET = WORKSPACE / "drsai"
            DATASET.mkdir(parents=True, exist_ok=True)

            engine_uri = f"sqlite:///{DATASET}/drsai.db"
            self.ctx.db_manager = DatabaseManager(engine_uri=engine_uri, base_dir=str(DATASET))
            init_response = self.ctx.db_manager.initialize_database()
            if not init_response.status:
                self.ctx._init_error = f"DB init failed: {init_response.message}"
                self.ctx._init_done.set()
                return

            CLISessionStore = get_CLISessionStore()
            store = CLISessionStore(self.ctx.db_manager, self.ctx.user_id)

            desktop_sessions = store.search("desktop", limit=5)
            if desktop_sessions:
                info = desktop_sessions[0]
                self.ctx.current_session_id = info.thread_id
                logger.info(f"Resuming desktop session: {info.name}")
            else:
                self.ctx.current_session_id = store.create(name="desktop")
                logger.info("New desktop session: desktop")

            self.ctx.agent = create_agent(
                api_key=self.ctx.cfg.get("api_key") or None,
                thread_id=self.ctx.current_session_id,
                user_id=self.ctx.user_id,
                db_manager=self.ctx.db_manager,
                defult_config_name=self.ctx.defult_config_name,
                cli_cfg=self.ctx.cfg,
                work_dir=self.ctx._work_dir,
            )

            if hasattr(self.ctx.agent, "lazy_init"):
                await self.ctx.agent.lazy_init()

            # Set token_limit from model config at init time
            self._update_token_limit()

            state_dict = await self._load_thread_state(self.ctx.current_session_id)
            if state_dict and hasattr(self.ctx.agent, "load_state"):
                await self.ctx.agent.load_state(state_dict)

            self.ctx.current_thread = await self._get_or_create_thread(self.ctx.current_session_id)
            logger.info(f"Agent initialized (model: {self.ctx.defult_config_name})")

        except Exception as e:
            self.ctx._init_error = f"Agent init failed: {e}"
            logger.error(f"Agent init error: {e}", exc_info=True)

        self.ctx._init_done.set()

    def _update_token_limit(self) -> None:
        """Update stats.token_limit from current model config."""
        try:
            load_llm_mode_config = get_load_llm_mode_config()
            llm_config_path = os.environ.get("LLM_CONFIG_FILE") or self.ctx.cfg.get("llm_config_file")
            catalog = load_llm_mode_config(llm_config_path)
            model_alias = getattr(self.ctx.agent, '_defult_config_name', None) or self.ctx.defult_config_name
            entry = catalog.get(model_alias)
            if entry and hasattr(entry, "token_limit"):
                self.ctx.stats.token_limit = entry.token_limit
        except Exception as e:
            logger.warning(f"Failed to update token_limit: {e}")

    async def _load_thread_state(self, thread_id: str) -> Optional[dict]:
        if not self.ctx.db_manager:
            return None
        Thread, RunStatus, Response = get_datamodel()
        decompress_state = get_decompress_state()
        response: Response = self.ctx.db_manager.get(
            Thread, filters={"user_id": self.ctx.user_id, "thread_id": thread_id}, return_json=False,
        )
        if response.status and response.data:
            thread: Thread = response.data[0]
            state = thread.state
            if state:
                return decompress_state(state) if isinstance(state, str) else state
        return None

    async def _save_thread_state(self, thread_id: str, state_dict: dict) -> bool:
        if not self.ctx.db_manager:
            return False
        Thread, RunStatus, Response = get_datamodel()
        compress_state = get_compress_state()
        response: Response = self.ctx.db_manager.get(
            Thread, filters={"user_id": self.ctx.user_id, "thread_id": thread_id}, return_json=False,
        )
        if response.status and response.data:
            thread: Thread = response.data[0]
            thread.state = compress_state(state_dict)
            thread.updated_at = time.time()
            return self.ctx.db_manager.upsert(thread).status
        return False

    async def _get_or_create_thread(self, thread_id: str) -> None:
        Thread, RunStatus, Response = get_datamodel()
        response: Response = self.ctx.db_manager.get(
            Thread, filters={"user_id": self.ctx.user_id, "thread_id": thread_id}, return_json=False,
        )
        if response.status and response.data:
            return response.data[0]
        thread = Thread(user_id=self.ctx.user_id, thread_id=thread_id, status=RunStatus.CREATED, messages=[])
        self.ctx.db_manager.upsert(thread)
        return thread

    async def _close_agent(self) -> None:
        """Save state and close the current agent."""
        if self.ctx.agent is not None:
            try:
                if hasattr(self.ctx.agent, "save_state"):
                    state_dict = await self.ctx.agent.save_state()
                    await self._save_thread_state(self.ctx.current_session_id, state_dict)
                await self.ctx.agent.close()
            except Exception:
                logger.warning("Agent close failed", exc_info=True)

    # ── Session / Agent switching ───────────────────────────────────────

    async def _switch_session_in_window(
        self, sctx: Any, new_session_id: str
    ) -> None:
        """Switch to a different session *within a specific window's sctx*.

        In multi-window mode, each window has its own SessionContext (sctx)
        with its own agent.  This method:

        1. Saves the *sctx's* current agent state to DB
        2. Closes the *sctx's* current agent
        3. Creates a fresh agent for ``new_session_id`` on the same sctx
        4. Loads saved state for the new session
        5. Updates sctx fields (session_id, session_name, current_thread)

        IMPORTANT: This only affects the given sctx.  Other windows' agents
        are untouched — they keep running their own sessions independently.

        After switching, the caller should:
        - Update AppContext._active_session_id via set_active_session()
        - Update the window's status bar
        - Rebind on_command_fn / send_message_fn if needed
        """
        # ── 1. Save current agent state ─────────────────────────────────
        old_session_id = sctx.session_id
        if sctx.agent is not None:
            try:
                state_dict = await sctx.agent.save_state()
                await self._save_thread_state(old_session_id, state_dict)
            except Exception as e:
                logger.warning(f"Failed to save sctx state before switch: {e}")
            try:
                await sctx.agent.close()
            except Exception:
                logger.warning("Agent close failed during session switch", exc_info=True)

        # ── 2. Update sctx session identity ──────────────────────────────
        sctx.session_id = new_session_id
        # Try to resolve a display name from the session store
        try:
            CLISessionStore = get_CLISessionStore()
            store = CLISessionStore(self.ctx.db_manager, self.ctx.user_id)
            info = store.resolve(new_session_id[:8])
            sctx.session_name = (info.name if info else None) or new_session_id[:8]
        except Exception:
            sctx.session_name = new_session_id[:8]

        # ── 3. Create fresh agent for the new session ────────────────────
        try:
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

            # ── 4. Load saved state for the new session ──────────────────
            state_dict = await self._load_thread_state(new_session_id)
            if state_dict and hasattr(sctx.agent, "load_state"):
                await sctx.agent.load_state(state_dict)

            # ── 5. Get or create thread record ──────────────────────────
            sctx.current_thread = await self._get_or_create_thread(new_session_id)

            logger.info(f"Session switched in window: {old_session_id} → {new_session_id} "
                        f"(model: {sctx.defult_config_name})")

        except Exception as e:
            logger.error(f"Session switch failed: {old_session_id} → {new_session_id}: {e}",
                         exc_info=True)
            if sctx.ui:
                sctx.ui.error(f"会话切换失败: {e}\n")

    async def _reinit_agent_for_session(self, new_session_id: str) -> None:
        """Legacy compat: switch session using the *active* sctx.

        Delegates to _switch_session_in_window(sctx, new_session_id)
        where sctx = AppContext.get_active_session().

        This is called by single-window commands (/new, /switch, /resume)
        that don't have a specific sctx reference.

        After switching:
        - Updates _sessions/_windows dicts with new key
        - Rebinds window callbacks to the new session
        - Syncs AppContext legacy fields
        """
        sctx = self.ctx.get_active_session()
        if sctx is None:
            # No active session — create one
            from drsai.backend.gui.session_context import SessionContext
            sctx = SessionContext(session_id=new_session_id, app=self)
            self.ctx.register_session(new_session_id, sctx)

        old_session_id = sctx.session_id

        await self._switch_session_in_window(sctx, new_session_id)

        # Update _sessions and _windows dict keys (session_id changed)
        if old_session_id != new_session_id:
            self.ctx._sessions.pop(old_session_id, None)
            self.ctx._sessions[new_session_id] = sctx

            window = self.ctx._windows.pop(old_session_id, None)
            if window:
                self.ctx._windows[new_session_id] = window

            # Rebind window callbacks to new session
            if window:
                self._rebind_window_callbacks(window, sctx)
                window.title(
                    f"DrSai Chat — {self.ctx.user_id} @ {sctx.defult_config_name}"
                )

        # Sync AppContext legacy fields
        self.ctx.set_active_session(new_session_id)
        self._update_token_limit()
        self._update_status_bar()

    async def _switch_model(self, alias: str, global_: bool = False) -> bool:
        """Switch agent model, update token_limit, save state. Returns True on success."""
        # Load model catalog
        try:
            load_llm_mode_config = get_load_llm_mode_config()
            llm_config_path = os.environ.get("LLM_CONFIG_FILE") or self.ctx.cfg.get("llm_config_file")
            catalog = load_llm_mode_config(llm_config_path)
        except Exception as e:
            self.ctx.ui.error(f"无法加载模型配置: {e}")
            self.ctx.ui.section_end()
            return False

        if alias not in catalog:
            self.ctx.ui.error(f"模型 '{alias}' 不在配置中\n")
            self.ctx.ui.hint("   输入 /models 查看所有可用模型\n")
            self.ctx.ui.section_end()
            return False

        if self.ctx.agent and hasattr(self.ctx.agent, '_set_model_client'):
            try:
                new_client = self.ctx.agent._set_model_client(alias)
                await self.ctx.agent.switch_model(new_client)
                self.ctx.agent._defult_config_name = alias
                entry = catalog.get(alias)
                if entry and hasattr(entry, "token_limit"):
                    self.ctx.stats.token_limit = entry.token_limit

                # Save state
                state_dict = await self.ctx.agent.save_state()
                await self._save_thread_state(self.ctx.current_session_id, state_dict)

                # If global, save as default
                if global_:
                    self.ctx.cfg["defult_config_name"] = alias
                    cli_config.save_config(self.ctx.cfg)
                    self.ctx.defult_config_name = alias

                self.ctx.ui.success(f"✅ 模型已切换: {alias}\n")
                if global_:
                    self.ctx.ui.info("   (已保存为默认模型)\n")
                self.ctx.ui.section_end()
                self._update_status_bar()
                return True
            except Exception as e:
                self.ctx.ui.error(f"模型切换失败: {e}\n")
                self.ctx.ui.section_end()
                return False

        self.ctx.ui.error("Agent 不支持模型切换\n")
        self.ctx.ui.section_end()
        return False

    # ── Chat interaction ─────────────────────────────────────────────────────

    async def _do_chat(self, user_input: str) -> None:
        """Run agent conversation turn and render to GUI."""
        if not self.ctx.agent:
            if self.ctx._chat_window:
                self.ctx.ui.error("Agent 未初始化，请重启。")
            return

        Thread, RunStatus, Response = get_datamodel()

        try:
            if self.ctx.current_thread:
                self.ctx.current_thread.status = RunStatus.ACTIVE

            DrSaiGUIRenderer = get_DrSaiGUIRenderer()
            renderer = DrSaiGUIRenderer(
                append_fn=self.ctx._chat_window.append_text,
                show_reasoning=self.ctx._show_reasoning,
            )

            if self.ctx._chat_window:
                self.ctx._chat_window.set_status("思考中...")

            self.ctx.stats.start_turn()

            stream = self.ctx.agent.run_stream(task=user_input)
            stats_info = await renderer.render(stream)

            self.ctx.stats.end_turn(
                prompt_tokens=stats_info.get("prompt_tokens", 0),
                completion_tokens=stats_info.get("completion_tokens", 0),
                model=stats_info.get("model", ""),
            )

            if hasattr(self.ctx.agent, "save_state"):
                state_dict = await self.ctx.agent.save_state()
                await self._save_thread_state(self.ctx.current_session_id, state_dict)

            if self.ctx.current_thread:
                self.ctx.current_thread.status = RunStatus.COMPLETE
                self.ctx.current_thread.updated_at = time.time()
                self.ctx.db_manager.upsert(self.ctx.current_thread)

            if self.ctx._chat_window:
                finish_stats = {
                    "duration_seconds": stats_info.get("duration_seconds", 0),
                    "prompt_tokens": self.ctx.stats.prompt_tokens,
                    "completion_tokens": self.ctx.stats.completion_tokens,
                    "model": self.ctx.stats.last_model,
                    "turns": self.ctx.stats.turns,
                    "token_limit": self.ctx.stats.token_limit,
                }
                self.ctx._chat_window.finish_chat_turn(stats=finish_stats)
                self._update_status_bar()

        except asyncio.CancelledError:
            if self.ctx._chat_window:
                self.ctx.ui.info("\n⚠ 对话已中断\n")
                self.ctx._chat_window.finish_chat_turn()
                self.ctx._chat_window.set_status("就绪")
                self._update_status_bar()
            if self.ctx.agent:
                try:
                    await self.ctx.agent.pause()
                    await asyncio.sleep(0.1)
                    await self.ctx.agent.resume()
                except Exception:
                    logger.warning("Agent pause/resume failed after interrupt")

        except Exception as e:
            logger.error(f"Chat error: {e}", exc_info=True)
            if self.ctx._chat_window:
                self.ctx.ui.error(f"对话出错: {e}")
                self.ctx._chat_window.set_status("就绪")
                self._update_status_bar()

    # ── Deferred init (for setup dialog) ────────────────────────────────────

    def _deferred_init(self, new_cfg: dict) -> None:
        """Blocking deferred init — only used in __init__ context."""
        for key, value in new_cfg.items():
            self.ctx.cfg[key] = value
            if key in ("api_key", "anthropic_api_key", "openai_api_key"):
                env_map = {"api_key": "HEPAI_API_KEY", "anthropic_api_key": "ANTHROPIC_API_KEY", "openai_api_key": "OPENAI_API_KEY"}
                os.environ[env_map.get(key, key)] = value

        self.ctx.sync_from_cfg()
        cli_config.save_config(self.ctx.cfg)
        self.ctx._needs_setup = False
        self._start_async_loop_and_init_agent()
        self.ctx._init_done.wait(timeout=120)

    def _deferred_init_async(self, new_cfg: dict) -> None:
        """Non-blocking deferred init via root.after() polling."""
        self._reinit_step1_close_agent(new_cfg)

    def _reinit_step1_close_agent(self, new_values: dict) -> None:
        """Step 1: close old agent, then schedule step 2."""
        if self.ctx.agent is not None:
            self._call_async(self._close_agent())

        # Schedule step 2 on main thread after a short delay
        self._call_gui(self._reinit_step2_reset_and_init, new_values)

    def _reinit_step2_reset_and_init(self, new_values: dict) -> None:
        """Step 2: apply new config, re-init agent, poll for completion."""
        for key, value in new_values.items():
            self.ctx.cfg[key] = value
            env_map = {"api_key": "HEPAI_API_KEY", "anthropic_api_key": "ANTHROPIC_API_KEY", "openai_api_key": "OPENAI_API_KEY"}
            if key in env_map:
                os.environ[env_map[key]] = value

        self.ctx.sync_from_cfg()
        cli_config.save_config(self.ctx.cfg)
        self.ctx._needs_setup = False

        # Reset init state
        self.ctx._init_done = threading.Event()
        self.ctx._init_error = None
        self.ctx.agent = None
        self.ctx.db_manager = None

        # Start new async loop + init
        self._start_async_loop_and_init_agent()
        self._poll_init_done()

    def _poll_init_done(self) -> None:
        """Non-blocking poll for agent init completion."""
        if self.ctx._init_done.is_set():
            if self.ctx._init_error:
                self.ctx.ui.error(f"初始化失败: {self.ctx._init_error}")
            else:
                self.ctx.ui.success("Agent 初始化完成！")
                self._update_status_bar()
            return

        # Still waiting — poll again after 500ms
        if self.ctx._chat_window:
            self.ctx._chat_window.after(500, self._poll_init_done)

    # ── Command dispatch ─────────────────────────────────────────────────────

    def _on_command(self, cmd_name: str, cmd_args: str) -> bool:
        """Dispatch a slash command from the GUI input."""
        # ── Special: quit (handled by lifecycle, not CommandDispatcher) ──
        if cmd_name in ("quit", "exit", "q"):
            self._on_quit()
            return True

        # ── Special: setup (lifecycle concern — needs re-init) ──
        if cmd_name in ("setup", "env", "config_gui"):
            self._cmd_setup(cmd_args)
            return True

        # ── Registry-driven dispatch ────────────────────────────────────
        return self.ctx.command_dispatcher.dispatch(cmd_name, cmd_args)

    # ── Setup dialog ─────────────────────────────────────────────────────────

    def _cmd_setup(self, args: str = "") -> None:
        """Re-open setup dialog for configuration changes."""
        dialog = DrSaiSetupDialog(self.ctx._chat_window, cfg=self.ctx.cfg)
        self.ctx._chat_window.wait_window(dialog)

        if not dialog.completed:
            return

        self._deferred_init_async(dialog.config_values)

    # ── Status bar & toolbar ────────────────────────────────────────────────

    def _bottom_toolbar(self) -> str:
        """Persistent status bar — mirrors CLI's _bottom_toolbar().

        Shows: user_id @ model · turns · reasoning · plan_mode · workdir-only/any-path · safe-cmd/all-cmd
        """
        user_id = self.ctx.user_id
        model_name = getattr(self.ctx.agent, '_defult_config_name', None) or self.ctx.defult_config_name or "auto"
        if len(model_name) > 40:
            model_name = model_name[:37] + "..."

        parts = [f"{user_id} @ {model_name}"]

        if self.ctx.stats and self.ctx.stats.turns:
            parts.append(f"turns: {self.ctx.stats.turns}")
        if self.ctx._show_reasoning:
            parts.append("R+")

        # Read plan_mode from agent (injected_prefix = PLAN_MODE_PROMPT)
        agent = self.ctx.agent
        injected_prefix = getattr(agent, '_injected_prefix', "") or ""
        if injected_prefix:
            parts.append("plan:on")

        # Read workspace restriction from agent
        ws_enabled = getattr(agent, '_only_in_workspace', None)
        if ws_enabled is True:
            parts.append("🔒 workdir-only")
        elif ws_enabled is False:
            parts.append("⚠️ any-path")

        # Read dangerous command permission from agent
        dangerous_allowed_fn = getattr(agent, '_get_dangerous_allowed', None)
        if dangerous_allowed_fn is not None:
            da = dangerous_allowed_fn()
            if da:
                parts.append("⚠️ all-cmd")
            else:
                parts.append("🛡 safe-cmd")

        return "  ·  ".join(parts)

    def _update_status_bar(self) -> None:
        """Update the persistent status_info label (left) and keep transient label (right)."""
        if self.ctx._chat_window:
            self.ctx._chat_window.set_status_info(self._bottom_toolbar())

    # ── Event handlers ──────────────────────────────────────────────────────

    def _on_user_message(self, user_input: str) -> None:
        """User sent a message from the chat window."""
        self._call_async(self._do_chat(user_input))

    def _on_show_window(self) -> None:
        """Tray icon: show/restore the chat window."""
        self._call_gui(self._do_show_window)

    def _do_show_window(self) -> None:
        if self.ctx._chat_window:
            self.ctx._chat_window.deiconify()
            self.ctx._chat_window.lift()
            self.ctx._chat_window.focus_force()

    def _on_setup_from_tray(self) -> None:
        """Tray icon: open setup dialog.

        Guarded against re-opening during the initial first-time setup dialog.
        """
        if self.ctx._in_initial_setup:
            logger.info("Tray setup requested during initial setup dialog — ignoring (dialog already open)")
            return
        self._call_gui(self._cmd_setup)

    def _on_interrupt_chat(self) -> None:
        """Interrupt current chat or quit on double-press."""
        self.ctx._interrupt_count += 1

        if self.ctx._interrupt_count >= 2:
            self._on_quit()
            return

        # Cancel current chat task
        if self.ctx._current_chat_task and not self.ctx._current_chat_task.done():
            self.ctx._current_chat_task.cancel()

        # Reset interrupt count after 3 seconds
        self._call_gui(self._do_interrupt_gui_update)
        if self.ctx._chat_window:
            self.ctx._chat_window.after(3000, self._reset_interrupt_count)

    # ── Multi-window management ──────────────────────────────────────────

    def _on_user_message_for_session(self, sctx: Any) -> Callable:
        """Return a send_message_fn bound to a specific SessionContext."""
        def _fn(user_input: str) -> None:
            self._call_async(self._do_chat_for_session(sctx, user_input))
        return _fn

    def _on_command_for_session(self, sctx: Any) -> Callable:
        """Return an on_command_fn bound to a specific SessionContext.

        Uses a per-session CommandDispatcher (or delegates to the global one
        after temporarily switching the active session).
        """
        def _fn(cmd_name: str, cmd_args: str) -> bool:
            # Switch active session context to this window's session
            # so that command modules (which access self.ctx.agent, etc.)
            # operate on the correct session.
            self.ctx.set_active_session(sctx.session_id)

            # Special: quit
            if cmd_name in ("quit", "exit", "q"):
                self._on_win_close(sctx.session_id)
                return True

            result = self.ctx.command_dispatcher.dispatch(cmd_name, cmd_args)

            # After dispatch, keep the session that the command operated on
            # as the active session.  In multi-window mode, the window that
            # issued the command should remain "active" — other windows'
            # sessions are independent and untouched.

            return result
        return _fn

    def _on_interrupt_for_session(self, sctx: Any) -> Callable:
        """Return an on_interrupt_fn bound to a specific SessionContext."""
        def _fn() -> None:
            # Cancel chat task for this session if any
            chat_task = getattr(sctx, '_current_chat_task', None)
            if chat_task and not chat_task.done():
                chat_task.cancel()

            # Update GUI for this session's window
            if sctx._chat_window and not getattr(sctx._chat_window, '_destroyed', False):
                sctx._chat_window.set_status("就绪")
                sctx._chat_window.finish_chat_turn()
        return _fn

    async def _do_chat_for_session(self, sctx: Any, user_input: str) -> None:
        """Run agent conversation turn for a specific SessionContext."""
        if not sctx.agent:
            if sctx._chat_window:
                from drsai.backend.gui.ui_formatter import UIFormatter
                ui = UIFormatter(sctx._chat_window)
                ui.error("Agent 未初始化，请重启。")
            return

        try:
            if sctx.current_thread:
                Thread, RunStatus, Response = get_datamodel()
                sctx.current_thread.status = RunStatus.ACTIVE

            DrSaiGUIRenderer = get_DrSaiGUIRenderer()
            renderer = DrSaiGUIRenderer(
                append_fn=sctx._chat_window.append_text,
                show_reasoning=sctx._show_reasoning,
            )

            if sctx._chat_window:
                sctx._chat_window.set_status("思考中...")

            sctx.stats.start_turn()

            stream = sctx.agent.run_stream(task=user_input)
            stats_info = await renderer.render(stream)

            sctx.stats.end_turn(
                prompt_tokens=stats_info.get("prompt_tokens", 0),
                completion_tokens=stats_info.get("completion_tokens", 0),
                model=stats_info.get("model", ""),
            )

            if hasattr(sctx.agent, "save_state"):
                state_dict = await sctx.agent.save_state()
                await self._save_thread_state(sctx.session_id, state_dict)

            Thread, RunStatus, Response = get_datamodel()
            if sctx.current_thread:
                sctx.current_thread.status = RunStatus.COMPLETE
                sctx.current_thread.updated_at = time.time()
                self.ctx.db_manager.upsert(sctx.current_thread)

            if sctx._chat_window:
                finish_stats = {
                    "duration_seconds": stats_info.get("duration_seconds", 0),
                    "prompt_tokens": sctx.stats.prompt_tokens,
                    "completion_tokens": sctx.stats.completion_tokens,
                    "model": sctx.stats.last_model,
                    "turns": sctx.stats.turns,
                    "token_limit": sctx.stats.token_limit,
                }
                sctx._chat_window.finish_chat_turn(stats=finish_stats)
                # Update status bar for this session
                sctx._chat_window.set_status_info(sctx.build_status_bar())

        except asyncio.CancelledError:
            if sctx._chat_window:
                from drsai.backend.gui.ui_formatter import UIFormatter
                ui = UIFormatter(sctx._chat_window)
                ui.info("\n⚠ 对话已中断\n")
                sctx._chat_window.finish_chat_turn()
                sctx._chat_window.set_status("就绪")
                sctx._chat_window.set_status_info(sctx.build_status_bar())
            if sctx.agent:
                try:
                    await sctx.agent.pause()
                    await asyncio.sleep(0.1)
                    await sctx.agent.resume()
                except Exception:
                    logger.warning("Agent pause/resume failed after interrupt")

        except Exception as e:
            logger.error(f"Chat error for session {sctx.session_id}: {e}", exc_info=True)
            if sctx._chat_window:
                from drsai.backend.gui.ui_formatter import UIFormatter
                ui = UIFormatter(sctx._chat_window)
                ui.error(f"对话出错: {e}")
                sctx._chat_window.set_status("就绪")
                sctx._chat_window.set_status_info(sctx.build_status_bar())

    def _rebind_window_callbacks(self, window: Any, sctx: Any) -> None:
        """Rebind a window's send_message / command / interrupt callbacks to a new sctx.

        Called when a window switches to a different session (via /win_switch
        or /switch) — the window widget stays the same, but its agent, session,
        and conversation context change.

        Also updates the window title to reflect the new session.
        """
        window._send_message_fn = self._on_user_message_for_session(sctx)
        window._on_command_fn = self._on_command_for_session(sctx)
        window._on_interrupt_fn = self._on_interrupt_for_session(sctx)
        # Update quit/minimize handlers to use the new session
        window._on_quit_fn = lambda: self._on_win_close(sctx.session_id)
        window._on_minimize_fn = lambda: window.withdraw()

        logger.info(f"Window callbacks rebinded to session: {sctx.session_id}")

    def _on_win_close(self, session_id: str) -> None:
        """Close a specific session's window and clean up its resources.

        If the window being closed is the root (Tk) window, minimize to tray.
        For Toplevel windows, destroy the window and unregister the session.
        """
        window = self.ctx._windows.get(session_id)
        sctx = self.ctx._sessions.get(session_id)

        # Check if this is the root Tk window (main chat window)
        # The main window IS a tk.Tk, new windows are tk.Toplevel.
        # Use ctx._root (which is always the original tk.Tk) for comparison
        # instead of isinstance, to avoid import issues.
        is_root_window = (window is self.ctx._root)

        if is_root_window:
            # Root window — minimize to tray (don't destroy it)
            logger.info(f"Root window close requested for session {session_id} — minimizing to tray")
            if window:
                window.withdraw()
            return

        # Toplevel window — can safely destroy
        logger.info(f"Closing Toplevel window for session {session_id}")

        # Destroy the window
        if window:
            try:
                if not getattr(window, '_destroyed', False):
                    window._destroyed = True
                    window.destroy()
            except Exception:
                pass

        # Close agent for this session
        if sctx and sctx.agent:
            try:
                self._call_async(self._close_session_agent(sctx))
            except Exception:
                logger.warning(f"Failed to close agent for session {session_id}")

        # Unregister from AppContext
        self.ctx.unregister_window(session_id)
        self.ctx.unregister_session(session_id)

        # Activate another session if available
        remaining = list(self.ctx._sessions.keys())
        if remaining:
            self.ctx.set_active_session(remaining[-1])
            self._update_status_bar()

    async def _close_session_agent(self, sctx: Any) -> None:
        """Close agent for a specific session context."""
        if sctx.agent is not None:
            try:
                if hasattr(sctx.agent, "save_state"):
                    state_dict = await sctx.agent.save_state()
                    await self._save_thread_state(sctx.session_id, state_dict)
                await sctx.agent.close()
                sctx.agent = None
            except Exception:
                logger.warning(f"Agent close failed for session {sctx.session_id}", exc_info=True)

    def _reset_interrupt_count(self) -> None:
        self.ctx._interrupt_count = 0

    def _do_interrupt_gui_update(self) -> None:
        if self.ctx._chat_window:
            self.ctx._chat_window.set_status("就绪")
            self._update_status_bar()

    def _on_minimize_window(self) -> None:
        """Hide window to tray on minimize."""
        if self.ctx._chat_window:
            self.ctx._chat_window.withdraw()

    # ── Shutdown ─────────────────────────────────────────────────────────────

    def _on_quit(self) -> None:
        """Quit entire app (thread-safe)."""
        logger.info("DrSai desktop app shutting down...")

        # Mark destroyed
        if self.ctx._chat_window and not self.ctx._chat_window._destroyed:
            self.ctx._chat_window._destroyed = True

        # Stop tray
        if self.ctx._tray_app:
            self.ctx._tray_app.stop()

        # Schedule GUI shutdown on main thread
        if self.ctx._chat_window:
            try:
                self.ctx._chat_window.after(0, self._do_gui_shutdown)
            except RuntimeError:
                self._hard_exit()
        else:
            self._hard_exit()

    def _do_gui_shutdown(self) -> None:
        """GUI teardown — runs on tkinter main thread."""
        if self.ctx._chat_window is None:
            os._exit(0)
            return

        try:
            self.ctx._chat_window.chat_display.destroy()
        except Exception:
            pass

        try:
            self.ctx._chat_window.destroy()
        except Exception:
            pass

        try:
            self.ctx._chat_window.quit()
        except Exception:
            pass

        self._hard_exit()

    def _hard_exit(self) -> None:
        """Close agent + stop asyncio + os._exit(0) — the final step."""
        async def _shutdown():
            await self._close_agent()
            self.ctx._loop.stop()

        if self.ctx._loop:
            asyncio.run_coroutine_threadsafe(_shutdown(), self.ctx._loop)

        try:
            sys.stdout.flush()
            sys.stderr.flush()
        except Exception:
            pass

        time.sleep(0.5)
        os._exit(0)

    # ── Main run ─────────────────────────────────────────────────────────────

    def run(self) -> None:
        """Start the entire desktop application."""
        # ── Create UIFormatter ──────────────────────────────────────────
        # (will be set after chat_window creation)

        # ── Create chat window ──────────────────────────────────────────
        DrSaiChatWindow = get_DrSaiChatWindow()

        self.ctx._chat_window = DrSaiChatWindow(
            send_message_fn=self._on_user_message,
            on_command_fn=self._on_command,
            on_minimize_fn=self._on_minimize_window,
            on_quit_fn=self._on_quit,
            on_interrupt_fn=self._on_interrupt_chat,
            on_setup_fn=self._on_setup_from_tray,
            title=f"DrSai Chat — {self.ctx.user_id} @ {self.ctx.defult_config_name}",
        )

        # ── Save Tk root window reference ────────────────────────────────
        # In multi-window mode, ctx._chat_window may point to different
        # Toplevel windows as sessions switch.  ctx._root always points
        # to the original tk.Tk root window, which is needed for:
        #   - root.after() to schedule tasks on the main thread
        #   - Creating Toplevel children (they need a parent Tk root)
        #   - Thread-safe GUI operations
        self.ctx._root = self.ctx._chat_window

        # ── Create UIFormatter ──────────────────────────────────────────
        self.ctx.ui = UIFormatter(self.ctx._chat_window)

        # ── Create CommandDispatcher ────────────────────────────────────
        self.ctx.command_dispatcher = CommandDispatcher(self.ctx)

        # ── Create tray icon BEFORE setup dialog ────────────────────────
        # This ensures the icon is visible during the first-time setup
        # dialog, and gives pystray's setup_thread ample time to set
        # _visible=True before any diagnostic checks occur.
        self._create_tray_icon()

        # ── First-time setup or normal init ─────────────────────────────
        self._handle_initial_setup()

        # ── Register SIGINT handler ─────────────────────────────────────
        signal = get_signal()
        signal.signal(signal.SIGINT, lambda sig, frame: self._on_interrupt_chat())

        # ── Run tkinter mainloop ────────────────────────────────────────
        logger.info("DrSai desktop app running (tkinter mainloop)")
        self.ctx._chat_window.mainloop()

    def _handle_initial_setup(self) -> None:
        """Handle first-time setup or normal agent init.

        Three scenarios:
        1. No key at all → mandatory setup dialog, cancel = quit
        2. Env key but new config → optional setup dialog (pre-filled), cancel = continue
        3. Config key exists → normal startup, no dialog
        """
        messagebox = get_messagebox()

        if self.ctx._needs_setup:
            # ── Guard: prevent tray "配置" from opening a second dialog ──
            self.ctx._in_initial_setup = True

            env_provider = self._detect_env_provider()

            if env_provider:
                # Env key detected — setup is for confirmation/optional customization
                logger.info(f"Env key detected ({env_provider}) — showing setup dialog for confirmation...")
                self.ctx.ui.info("🤖 欢迎使用 DrSai！检测到环境变量中已有 API Key。\n\n")
                self.ctx.ui.info("📝 正在打开配置确认对话框，您可以确认或修改配置...\n")
            else:
                # No key at all — setup is mandatory
                logger.info("No API key found — showing setup dialog...")
                self.ctx.ui.info("🤖 欢迎使用 DrSai！首次使用需要配置 API Key。\n\n")
                self.ctx.ui.info("📝 正在打开配置对话框...\n")

            dialog = DrSaiSetupDialog(
                self.ctx._chat_window, cfg=self.ctx.cfg,
                env_provider=env_provider,
            )
            self.ctx._chat_window.wait_window(dialog)

            if not dialog.completed:
                if self.ctx._setup_is_optional:
                    # User cancelled but env key exists — continue without setup
                    logger.info("Setup cancelled — continuing with environment variable API key.")
                    self.ctx._in_initial_setup = False
                    self.ctx._needs_setup = False
                    self._update_status_bar()
                    model_info = f"🤖 Model: {self.ctx.defult_config_name}\n"
                    self.ctx.ui.info(model_info)
                    self.ctx.ui.hint(
                        "💡 提示: 您可以随时通过 /setup 命令或托盘菜单修改配置。\n\n"
                    )
                    if self.ctx._tray_app:
                        self.ctx._tray_app.update_title(f"DrSai — {self.ctx.defult_config_name}")
                    self.ctx._chat_window.after(500, self._poll_init_done)
                    return
                else:
                    # No key, user cancelled — can't run without API key
                    logger.info("Setup cancelled — no API key available, exiting.")
                    self.ctx._in_initial_setup = False
                    self._on_quit()
                    return

            # Setup completed — apply new config and re-init agent
            self.ctx._in_initial_setup = False
            self.ctx.ui.success("配置已保存！正在初始化...\n")
            self._deferred_init_async(dialog.config_values)

            # ── Update tray icon and show tray hint ──────────────────────
            if self.ctx._tray_app:
                self.ctx._tray_app.update_title(f"DrSai — {self.ctx.defult_config_name}")
            self.ctx.ui.hint(
                "系统托盘图标已创建。\n"
                "   如果看不到图标，请点击任务栏右下角的 ↑ 箭头查看溢出区域。\n"
                "   双击图标或右键→「打开对话」恢复窗口。\n\n"
            )

        else:
            logger.info("Waiting for agent initialization...")

            if self.ctx._init_done.is_set() and self.ctx._init_error:
                messagebox.showerror("DrSai 初始化失败", f"Agent 初始化失败:\n{self.ctx._init_error}")
                self._on_quit()
                return

            self._update_status_bar()
            model_info = f"🤖 Model: {self.ctx.defult_config_name}\n"
            self.ctx.ui.info(model_info)
            if self.ctx._tray_app:
                self.ctx.ui.hint(
                    "系统托盘图标已创建。\n"
                    "   如果看不到图标，请点击任务栏右下角的 ↑ 箭头查看溢出区域。\n"
                    "   双击图标或右键→「打开对话」恢复窗口。\n\n"
                )
            self.ctx._chat_window.after(500, self._poll_init_done)

    def _create_tray_icon(self) -> None:
        """Create system tray icon (non-critical — app works without it).

        Called early in the startup sequence (before the first-time setup
        dialog) so that the icon is visible during configuration.  The
        tray icon's "配置" menu item is guarded against re-opening while
        the initial setup dialog is active (see _in_initial_setup flag).
        """
        DrSaiTrayApp = get_DrSaiTrayApp()

        try:
            self.ctx._tray_app = DrSaiTrayApp(
                show_window_fn=self._on_show_window,
                setup_fn=self._on_setup_from_tray,
                quit_fn=self._on_quit,
                title=f"DrSai — {self.ctx.defult_config_name}",
            )
            self.ctx._tray_app.run_detached()
            logger.info("Tray icon started successfully (before setup dialog)")
        except ImportError as e:
            logger.warning(f"Tray icon unavailable (missing pystray/Pillow): {e}")
            self.ctx._tray_app = None
        except Exception as e:
            logger.warning(f"Tray icon creation failed: {e}")
            self.ctx.ui.warn(f"系统托盘图标创建失败: {e}\n   聊天窗口仍可正常使用。\n")
            self.ctx._tray_app = None