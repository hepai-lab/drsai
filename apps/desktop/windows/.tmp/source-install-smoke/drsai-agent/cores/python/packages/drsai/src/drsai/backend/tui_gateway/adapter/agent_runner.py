"""Agent lifecycle + asyncio bridge for the DrSai TUI gateway.

DrSaiCLIAssistant.run_stream is an *async* generator. The gateway dispatches
RPCs on threads (sync ``stdin`` loop + ``ThreadPoolExecutor``). This module
bridges the two:

- Each session owns a long-lived asyncio loop running on a daemon thread.
- :class:`AgentSession` exposes a thread-safe API used by RPC handlers:
  ``init()``, ``run_turn(text, on_event)``, ``pause()``, ``resume()``,
  ``save_state()``, ``close()``, ``inject_system_prompt()``, ``switch_model()``.
- RPC handlers call these via :func:`_run_coro`, which submits a coroutine to
  the session's loop and blocks (with timeout) on a ``concurrent.futures.Future``.

The single-loop-per-session model matches autogen's expectations: model
clients, workbenches, and ``CancellationToken`` instances all assume they're
created and used on the same event loop.
"""

from __future__ import annotations

import asyncio
import logging
import threading
import time
from concurrent.futures import Future
from typing import Any, Callable, Mapping, Optional

logger = logging.getLogger(__name__)


# ── Helpers ──────────────────────────────────────────────────────────


def _start_loop_thread() -> tuple[asyncio.AbstractEventLoop, threading.Thread]:
    """Start a fresh asyncio event loop on a daemon thread."""
    loop = asyncio.new_event_loop()
    ready = threading.Event()

    def _run() -> None:
        asyncio.set_event_loop(loop)
        ready.set()
        try:
            loop.run_forever()
        finally:
            try:
                # Cancel pending tasks on shutdown.
                pending = asyncio.all_tasks(loop=loop)
                for t in pending:
                    t.cancel()
                if pending:
                    loop.run_until_complete(
                        asyncio.gather(*pending, return_exceptions=True)
                    )
            except Exception:
                pass
            loop.close()

    th = threading.Thread(target=_run, name="drsai-agent-loop", daemon=True)
    th.start()
    ready.wait(timeout=2.0)
    return loop, th


def _run_coro(loop: asyncio.AbstractEventLoop, coro, timeout: Optional[float] = None) -> Any:
    """Submit *coro* to *loop* from another thread; block up to *timeout* seconds."""
    fut: Future = asyncio.run_coroutine_threadsafe(coro, loop)
    return fut.result(timeout=timeout)


# ── AgentSession ─────────────────────────────────────────────────────


class AgentSession:
    """Owns one DrSaiCLIAssistant + its asyncio loop + DB persistence."""

    def __init__(
        self,
        *,
        session_id: str,
        user_id: str,
        cli_cfg: dict[str, Any],
        db_manager: Any,
    ) -> None:
        self.session_id = session_id
        self.user_id = user_id
        self.cli_cfg = cli_cfg
        self.db_manager = db_manager

        self._loop, self._loop_thread = _start_loop_thread()
        self.agent: Any = None  # set by init()
        self._closed = False
        self._init_lock = threading.Lock()
        self._initialized = False
        self._workdir: str = ""

    # ── Initialization ────────────────────────────────────────────

    def init(self, *, defult_config_name: Optional[str] = None) -> None:
        """Create + lazy_init the agent; load persisted state if present."""
        with self._init_lock:
            if self._initialized:
                return
            # Surface init progress so the UI can show "loading..." while the
            # agent does its (potentially slow) skill loader / tool discovery.
            try:
                from .. import server
                server._emit("status.update", self.session_id, {
                    "kind": "agent.init",
                    "text": "initialising agent (loading skills + tools)…",
                })
            except Exception:
                pass
            _run_coro(
                self._loop,
                self._async_init(defult_config_name=defult_config_name),
                timeout=300.0,  # First-time skill loading can take ~1-2 minutes.
            )
            self._initialized = True
            try:
                from .. import server
                server._emit("status.update", self.session_id, {
                    "kind": "agent.ready",
                    "text": "agent ready",
                })
            except Exception:
                pass

    async def _async_init(self, *, defult_config_name: Optional[str]) -> None:
        from drsai.backend.run_drsai_agent_factory import create_agent

        agent = create_agent(
            api_key=self.cli_cfg.get("api_key") or None,
            thread_id=self.session_id,
            user_id=self.user_id,
            db_manager=self.db_manager,
            defult_config_name=defult_config_name or self.cli_cfg.get("defult_config_name"),
            cli_cfg=self.cli_cfg,
        )

        if hasattr(agent, "lazy_init"):
            await agent.lazy_init()

        self.agent = agent

        # Load persisted thread state (history, injected prompts, model, etc.)
        state_dict = await self._load_thread_state_async()
        if state_dict and hasattr(agent, "load_state"):
            await agent.load_state(state_dict)

        # Resolve the user-facing workdir.
        #
        # `agent._work_dir` is the agent's INTERNAL storage path (typically
        # ``~/.drsai/workspace/runs/<sid>/<user_id>``) — useful to the agent
        # but not what the user sees as "their cwd".
        #
        # The user-facing workdir is stored in ``Thread.meta['workdir']`` and
        # reflects where ``drsai`` was launched from. Prefer that, fall back
        # to the agent's path only if absent.
        meta_workdir = await self._load_thread_meta_workdir_async()
        self._workdir = str(meta_workdir or getattr(agent, "_work_dir", "") or "")

    # ── Thread state persistence (DB-backed) ──────────────────────

    async def _load_thread_state_async(self) -> Optional[dict]:
        from drsai.modules.managers.datamodel.db import Thread
        from drsai.utils.utils import decompress_state

        resp = self.db_manager.get(
            Thread,
            filters={"user_id": self.user_id, "thread_id": self.session_id},
            return_json=False,
        )
        if not resp.status or not resp.data:
            return None
        thread = resp.data[0]
        state = thread.state
        if not state:
            return None
        if isinstance(state, str):
            try:
                return decompress_state(state)
            except Exception:
                logger.exception("decompress_state failed")
                return None
        return state

    async def _load_thread_meta_workdir_async(self) -> Optional[str]:
        """Return Thread.meta['workdir'] for this session, or None."""
        from drsai.modules.managers.datamodel.db import Thread

        try:
            resp = self.db_manager.get(
                Thread,
                filters={"user_id": self.user_id, "thread_id": self.session_id},
                return_json=False,
            )
            if not resp.status or not resp.data:
                return None
            meta = getattr(resp.data[0], "meta", None) or {}
            if isinstance(meta, dict):
                return meta.get("workdir") or None
        except Exception:
            logger.exception("_load_thread_meta_workdir_async failed")
        return None

    def save_state(self) -> Optional[dict]:
        """Snapshot agent state and persist to Thread.state."""
        if not self._initialized or self.agent is None:
            return None
        return _run_coro(self._loop, self._async_save_state(), timeout=30.0)

    async def _async_save_state(self) -> Optional[dict]:
        from datetime import datetime
        from drsai.modules.managers.datamodel.db import Thread, RunStatus
        from drsai.utils.utils import compress_state

        if not hasattr(self.agent, "save_state"):
            return None
        state_dict = await self.agent.save_state()

        resp = self.db_manager.get(
            Thread,
            filters={"user_id": self.user_id, "thread_id": self.session_id},
            return_json=False,
        )
        if resp.status and resp.data:
            thread = resp.data[0]
            thread.state = compress_state(state_dict)
            thread.updated_at = datetime.now()
            save_resp = self.db_manager.upsert(thread)
            if not save_resp.status:
                logger.warning("save_state upsert failed: %s", save_resp.message)
        return state_dict

    # ── Conversation turn ────────────────────────────────────────

    def run_turn(
        self,
        text: str,
        on_event: Callable[[str, dict], None],
        *,
        images: Optional[list[dict]] = None,
    ) -> str:
        """Run one prompt turn, calling *on_event(event_type, payload)* for each event.

        Args:
            text: The user's text prompt.
            on_event: Callback for streaming events.
            images: Optional list of image dicts ``[{path, base64, mime_type}]``.
                    When provided, a ``MultiModalMessage`` is constructed instead
                    of a plain ``TextMessage`` so the model receives image data.

        Blocks the calling thread until the turn finishes (or is interrupted).
        Returns the final status: ``complete`` / ``interrupted`` / ``error``.
        """
        if self._closed:
            raise RuntimeError("session closed")
        if not self._initialized:
            raise RuntimeError("session not initialised")

        return _run_coro(
            self._loop,
            self._async_run_turn(text, on_event, images=images),
            timeout=None,  # Conversation duration is unbounded.
        )

    @staticmethod
    def _build_multimodal_task(text: str, images: list[dict]) -> Any:
        """Build a ``MultiModalMessage`` from text + image dicts.

        Each image dict must contain ``base64`` (raw base64 string, no
        data-URI prefix) and ``mime_type`` (e.g. ``"image/png"``).
        """
        from autogen_core import Image
        from autogen_agentchat.messages import MultiModalMessage

        content: list[str | Image] = [text]
        for img in images:
            try:
                data_uri = f"data:{img['mime_type']};base64,{img['base64']}"
                image_obj = Image.from_uri(data_uri)
                content.append(image_obj)
            except Exception:
                logger.exception("Failed to decode image from %s", img.get("path", "?"))
        return MultiModalMessage(content=content, source="user")

    async def _async_run_turn(
        self,
        text: str,
        on_event: Callable[[str, dict], None],
        *,
        images: Optional[list[dict]] = None,
    ) -> str:
        from .event_translator import TurnState, finalize, translate

        state = TurnState()
        status = "complete"

        try:
            on_event("message.start", {"role": "assistant"})

            # ── Vision capability check ────────────────────────────────
            # If images are attached but the current model does not support
            # vision, warn the user and fall back to text-only.  Without this
            # check, the Agent's _get_compatible_context would silently strip
            # the images via remove_images(), leaving the user confused.
            if images:
                model_vision = True
                try:
                    model_client = getattr(self.agent, "_model_client", None)
                    if model_client is not None:
                        model_vision = bool(model_client.model_info.get("vision", True))
                except Exception:
                    pass  # If we can't check, assume vision is supported

                if not model_vision:
                    model_name = ""
                    try:
                        model_name = getattr(
                            getattr(self.agent, "_model_client", None),
                            "_create_args", {},
                        ).get("model", "")
                    except Exception:
                        pass
                    filenames = [img.get("path", "") for img in images]
                    warning = (
                        f"⚠ 当前模型 {model_name!r} 不支持图像输入 (vision=false)，"
                        f"已忽略 {len(images)} 张图片："
                        + "、".join(f"「{f}」" for f in filenames if f)
                        + "。请在 llm_mode_config 中将 vision 设为 true 或切换到支持多模态的模型。"
                    )
                    on_event("message.delta", {"text": warning + "\n\n"})
                    logger.warning("Images dropped: model %r does not support vision", model_name)
                    images = None  # Fall back to text-only

            # Construct the task: MultiModalMessage if images are attached,
            # otherwise plain text string.
            if images:
                task = self._build_multimodal_task(text, images)
            else:
                task = text
            stream = self.agent.run_stream(task=task)
            async for message in stream:
                events = translate(message, state)
                for ev_type, payload in events:
                    try:
                        on_event(ev_type, payload)
                    except Exception:
                        logger.exception("on_event callback raised")
        except asyncio.CancelledError:
            status = "interrupted"
            # The task was cancelled (via interrupt() → _cancel_all_tasks).
            # agent.pause() has already set is_paused=True on the DrSaiAgent.
            # We MUST call resume() here to clear is_paused before re-raising,
            # otherwise the agent will refuse all future turns with
            # "The agent is paused." (see on_messages_stream guard at top).
            try:
                if self.agent is not None and hasattr(self.agent, "resume"):
                    await self.agent.resume()
                    logger.debug("_async_run_turn: agent resumed after CancelledError")
            except Exception:
                logger.exception("_async_run_turn: agent.resume() failed after cancel")
            raise
        except Exception as e:
            logger.exception("run_turn failed")
            status = "error"
            on_event("error", {"message": f"{type(e).__name__}: {e}"})
        finally:
            # Belt-and-suspenders: ensure the agent is never left in a
            # paused state after a turn, even when the agent layer silently
            # swallows CancelledError (as DrSaiAgent.on_messages_stream /
            # LongToolAgent.on_messages_stream do — they catch CancelledError,
            # yield a Response, and return normally without re-raising).
            # Without this guard the agent stays paused permanently,
            # refusing all future turns with 「The agent is paused.」
            # (metadata.internal="yes" → hidden by event_translator, so the
            # user sees only "in=0 out=0" with no explanation).
            try:
                if self.agent is not None and hasattr(self.agent, "resume"):
                    await self.agent.resume()
            except Exception:
                pass
            ev_type, payload = finalize(state, status=status)
            try:
                on_event(ev_type, payload)
            except Exception:
                logger.exception("on_event finalize raised")

        # Persist updated state after each turn so a crash doesn't lose progress.
        try:
            await self._async_save_state()
        except Exception:
            logger.exception("post-turn save_state failed")

        return status

    # ── Control ───────────────────────────────────────────────────

    def pause(self) -> None:
        if not self._initialized or self.agent is None:
            return
        if hasattr(self.agent, "pause"):
            try:
                _run_coro(self._loop, self.agent.pause(), timeout=5.0)
            except Exception:
                logger.exception("agent.pause failed")

    def resume(self) -> None:
        if not self._initialized or self.agent is None:
            return
        if hasattr(self.agent, "resume"):
            try:
                _run_coro(self._loop, self.agent.resume(), timeout=5.0)
            except Exception:
                logger.exception("agent.resume failed")

    def interrupt(self) -> None:
        """Interrupt a running turn by cancelling all asyncio Tasks on the agent loop.

        The old implementation used ``pause()`` + ``sleep(0.05)`` + ``resume()``.
        That 50 ms window is far too short: when the agent is awaiting an HTTP
        response from the LLM API, the event loop is blocked on IO and the
        CancellationToken check inside ``run_stream`` may not fire before
        ``resume()`` clears ``is_paused``.

        New approach:
          1. Call ``agent.pause()`` to set ``is_paused=True`` and cancel the
             ``CancellationToken``.  This is still useful for the LLM-streaming
             path that checks ``cancellation_token.is_cancelled()``.
          2. Cancel **all** pending asyncio Tasks on the agent loop directly
             via ``loop.call_soon_threadsafe``.  This reliably interrupts the
             ``async for message in stream`` loop even while the event loop is
             waiting on network IO — asyncio raises ``CancelledError`` into the
             task at the next ``await`` boundary.
          3. ``resume()`` is NOT called here.  It is called inside
             ``_async_run_turn``'s ``except asyncio.CancelledError`` block,
             where it runs on the agent's own event loop (the correct thread).
             This clears ``is_paused`` so the agent accepts the next prompt.
        """
        # Step 1: set CancellationToken + is_paused flag on the agent.
        self.pause()

        # Step 2: cancel all live asyncio tasks on the agent's event loop.
        # We use call_soon_threadsafe because the loop runs on a different thread.
        def _cancel_all_tasks() -> None:
            try:
                for task in asyncio.all_tasks(self._loop):
                    if not task.done():
                        task.cancel()
            except Exception:
                logger.exception("interrupt: task cancellation failed")

        self._loop.call_soon_threadsafe(_cancel_all_tasks)

        # Step 3: give the event loop a brief moment to process the cancellation
        # before returning, so the caller sees a clean state.
        # 200 ms is enough for one asyncio tick even under high load.
        time.sleep(0.2)

    def inject_system_prompt(
        self,
        *,
        prefix: Optional[str] = None,
        suffix: Optional[str] = None,
        project_instructions: Optional[str] = None,
    ) -> None:
        if self.agent is None or not hasattr(self.agent, "inject_system_prompt"):
            return
        kwargs: dict[str, Any] = {}
        if prefix is not None:
            kwargs["prefix"] = prefix
        if suffix is not None:
            kwargs["suffix"] = suffix
        if project_instructions is not None:
            kwargs["project_instructions"] = project_instructions
        if kwargs:
            self.agent.inject_system_prompt(**kwargs)

    def switch_model(self, alias: str) -> bool:
        """Switch the agent's model client. Returns True on success."""
        if self.agent is None:
            return False
        set_fn = getattr(self.agent, "_set_model_client", None)
        if set_fn is None:
            return False
        try:
            new_client = set_fn(alias)
            _run_coro(self._loop, self.agent.switch_model(new_client), timeout=10.0)
            self.agent._defult_config_name = alias
            return True
        except Exception:
            logger.exception("switch_model failed")
            return False

    def info(self) -> dict:
        """Snapshot session metadata for ``session.info`` event."""
        agent = self.agent
        info: dict[str, Any] = {
            "session_id": self.session_id,
            "user_id": self.user_id,
            "workdir": str(self._workdir) if self._workdir else "",
            "model": getattr(agent, "_defult_config_name", "?") if agent else "?",
            "plan_mode": bool(getattr(agent, "_injected_prefix", "") if agent else False),
            "workspace_enabled": bool(getattr(agent, "_only_in_workspace", True) if agent else True),
            "allow_dangerous_commands": bool(getattr(agent, "_allow_dangerous_commands", False) if agent else False),
            "default_subagent": self.get_state_value("default_subagent", ""),
            "max_agent_concurrent": getattr(agent, "_max_agent_concurrent", 5) if agent else 5,
            "has_injected_prefix": bool(self.get_state_value("inject_prefix", "")),
            "has_injected_suffix": bool(self.get_state_value("inject_suffix", "")),
        }
        # Tool list (best effort) — coerce names to strings to keep payload JSON-safe.
        tools: list[str] = []
        if agent is not None:
            wb = getattr(agent, "_workbench", None)
            wb_tools = getattr(wb, "_tools", None) if wb else None
            if wb_tools:
                tools = [str(getattr(t, "name", "?")) for t in wb_tools]
        info["tools"] = tools
        return info

    def get_state_value(self, key: str, default: Any = None) -> Any:
        """Get a value from agent's session-local state (Thread.state)."""
        if self.agent is None:
            return default
        state = getattr(self.agent, "_thread_state", None)
        if state is None:
            return default
        return state.get(key, default)

    def set_state_value(self, key: str, value: Any) -> None:
        """Set a value in agent's session-local state (Thread.state)."""
        if self.agent is None:
            return
        state = getattr(self.agent, "_thread_state", None)
        if state is None:
            # Initialize _thread_state if missing
            self.agent._thread_state = {}
            state = self.agent._thread_state
        state[key] = value
        # Apply certain keys directly to agent attributes
        if key == "plan_mode":
            # Inject the real PLAN_MODE_SYSTEM_PROMPT (not a placeholder string).
            # Import lazily to avoid a circular import at module load time.
            from drsai.backend.run_drsai_agent_factory import PLAN_MODE_SYSTEM_PROMPT
            self.agent._injected_prefix = PLAN_MODE_SYSTEM_PROMPT if value else ""
            # Rebuild the system message so the prefix takes effect on the next turn.
            try:
                if hasattr(self.agent, "update_system_prompt"):
                    self.agent.update_system_prompt()
            except Exception:
                logger.exception("update_system_prompt after plan_mode toggle failed")
        elif key == "only_in_workspace":
            # Keep both the agent attribute used by UI badges and the operator
            # function closure used by filesystem/shell tools in sync.
            self.agent._only_in_workspace = value
            toggle_funcs = getattr(self.agent, "_workspace_toggle_funcs", [])
            set_ws_fn = next((f for f in toggle_funcs if f.__name__ == "set_workspace_restriction"), None)
            if set_ws_fn:
                set_ws_fn(value)
        elif key == "allow_dangerous_commands":
            # Keep both the UI-facing attribute and the shell-tool closure in sync.
            self.agent._allow_dangerous_commands = value
            toggle_funcs = getattr(self.agent, "_dangerous_toggle_funcs", [])
            set_fn = next((f for f in toggle_funcs if f.__name__ == "set_dangerous_allowed"), None)
            if set_fn:
                set_fn(value)
        elif key == "reasoning_effort":
            if hasattr(self.agent, "_reasoning_effort"):
                self.agent._reasoning_effort = value
        elif key == "inject_prefix":
            if hasattr(self.agent, "_injected_prefix"):
                self.agent._injected_prefix = value
                if hasattr(self.agent, "update_system_prompt"):
                    try:
                        self.agent.update_system_prompt()
                    except Exception:
                        logger.exception("update_system_prompt after inject_prefix failed")
        elif key == "inject_suffix":
            if hasattr(self.agent, "_injected_suffix"):
                self.agent._injected_suffix = value
                if hasattr(self.agent, "update_system_prompt"):
                    try:
                        self.agent.update_system_prompt()
                    except Exception:
                        logger.exception("update_system_prompt after inject_suffix failed")
        elif key == "default_subagent":
            # Sync to UserProfileManager (THREAD_CONFIG.json) so on_messages_stream
            # can pick it up via get_default_subagent(thread_id).
            upm = getattr(self.agent, "_user_profile_manager", None)
            thread_id = getattr(self.agent, "_thread_id", None)
            if upm is not None and thread_id is not None:
                try:
                    if value:
                        upm.set_default_subagent(thread_id, value)
                    else:
                        upm.clear_default_subagent(thread_id)
                except Exception:
                    logger.exception("set_state_value: failed to sync default_subagent to THREAD_CONFIG.json")
        elif key == "max_agent_concurrent":
            if hasattr(self.agent, "_max_agent_concurrent"):
                try:
                    value = int(value)
                    if value < 1:
                        value = 1
                    self.agent._max_agent_concurrent = value
                except (ValueError, TypeError):
                    pass

    # ── Shutdown ──────────────────────────────────────────────────

    def close(self, *, save: bool = True) -> None:
        if self._closed:
            return
        self._closed = True
        try:
            if save and self._initialized:
                try:
                    _run_coro(self._loop, self._async_save_state(), timeout=10.0)
                except Exception:
                    logger.exception("close: final save_state failed")
            if self.agent is not None and hasattr(self.agent, "close"):
                try:
                    _run_coro(self._loop, self.agent.close(), timeout=5.0)
                except Exception:
                    logger.exception("close: agent.close failed")
        finally:
            try:
                self._loop.call_soon_threadsafe(self._loop.stop)
            except Exception:
                pass
            self._loop_thread.join(timeout=2.0)
