"""Per-(user, session) OpenDrSai Agent instances.

This replaces ``gateway_legacy.AgentManager`` (~900 lines).
It keeps the four things that make a conversation work and drops everything
that existed to serve config surfaces this gateway does not have.

Kept:
  1. one Agent per ``(user_id, session_id)``, so a session's history and
     compressed state stay together
  2. a per-key lock, so two windows cannot drive the same session at once
  3. ``load_state`` / ``save_state`` around every turn, so a restart resumes
  4. rebuild when the selected model alias changes (feature 3.2)
  5. bounded waits around Agent construction and close, so one stalled
     provider degrades a single turn instead of the whole gateway

Dropped, and why:
  - Agent model policy / provider config resolution -- the alias comes from
    the request (``run_drsai_agent_factory.build_model_catalog`` is the only
    catalog), so ``load_model_provider_config`` and friends are unreachable.
  - tool / skill / knowledge registry policies -- no management UI in the 11
    features, so the Agent loads its built-in set.
  - pause / resume / evict / model_config_state -- no route reaches them.

The Agent's own tools (web search, skills, file work) are unaffected: they live
inside ``DrSaiAssistant`` and cost zero routes.
"""

from __future__ import annotations

import asyncio
import inspect
import os
import time
from pathlib import Path
from typing import Any, Iterable, Mapping, Optional

from loguru import logger

# ARCHIVED(2026-09-02): Desktop now reuses the TUI legacy path
# (kernel_surface="tui" below). The desktop-kernel middle layer in
# backend/runtime (desktop_agent_kernel_adapter.py, desktop_autogen_ports.py,
# desktop_kernel_coordinator.py, desktop_kernel_run_stream.py,
# desktop_kernel_events.py, desktop_manager_ports.py) is archived: Desktop no
# longer executes it. Delegate/subagents are handled directly by
# DrSaiAssistant._process_model_result / _execute_subagent, same as the TUI.
from drsai.backend.cli.config import load_config
from drsai.backend.run_drsai_agent_factory import DEFAULT_CONFIG_NAME, PLAN_MODE_SYSTEM_PROMPT, create_agent
from drsai.backend.prompt_registry import (
    SURFACE_DESKTOP,
    build_selected_skill_suffix,
    build_selected_skill_task_prefix,
    build_turn_prefix,
    build_turn_suffix,
)
from drsai.backend.runtime.agent import RuntimeExecutionError
from drsai.modules.managers.database import DatabaseManager
from drsai.modules.managers.datamodel.db import RunStatus, Thread
from drsai.modules.managers.datamodel.types import Response as DBResponse
from drsai.utils.utils import compress_state, decompress_state

from ._turn_wait import TurnWaitTimeout, wait_bounded, wait_turn_event
from ._artifacts import deliver_artifact
from ._auth import effective_user_id
from ._image_tools import IMAGE_GENERATION_HOST_POLICY, image_edit, image_generation

_db_manager: DatabaseManager | None = None


def _env_seconds(name: str, default: float) -> float:
    """Read a positive timeout (in seconds), ignoring unset/invalid values."""
    raw = os.getenv(name)
    if not raw:
        return default
    try:
        value = float(raw)
    except ValueError:
        logger.warning("Ignoring invalid {}={!r}; using {}s instead", name, raw, default)
        return default
    if value <= 0:
        logger.warning("Ignoring non-positive {}={!r}; using {}s instead", name, raw, default)
        return default
    return value


# Building an Agent touches the provider catalog, the database and the tool
# registry; closing one talks to the model client. Any of those can stall on the
# network, and a stalled call used to hang the whole gateway with nothing in the
# logs to explain it. Bound both directions: a stuck rebuild now fails visibly
# (and retryably) instead of leaving the composer spinning forever.
_AGENT_CREATE_TIMEOUT_SECONDS = _env_seconds("OPENDRSAI_AGENT_CREATE_TIMEOUT_SECONDS", 90.0)
_AGENT_CLOSE_TIMEOUT_SECONDS = _env_seconds("OPENDRSAI_AGENT_CLOSE_TIMEOUT_SECONDS", 5.0)
_AGENT_REBUILD_WAIT_TIMEOUT_SECONDS = _env_seconds("OPENDRSAI_AGENT_REBUILD_WAIT_TIMEOUT_SECONDS", 120.0)
# A turn is only "running" while events keep flowing. A model call that hangs
# without emitting anything (provider wedged, cancellation ignored) used to
# hold the per-session turn lock *forever*: every later send on that session
# got "session_busy" until the gateway was restarted. Both bounds below break
# the turn loop when the stream goes silent, releasing the lock.
#   idle  — max seconds without any event while the turn is running normally
#   grace — max seconds of silence *after* a stop/cancel was requested before
#           the lock is force-abandoned (the Agent's token may be unobserved)
_AGENT_TURN_IDLE_TIMEOUT_SECONDS = _env_seconds("OPENDRSAI_AGENT_TURN_IDLE_TIMEOUT_SECONDS", 600.0)
_AGENT_TURN_CANCEL_GRACE_SECONDS = _env_seconds("OPENDRSAI_AGENT_TURN_CANCEL_GRACE_SECONDS", 30.0)


def _token_cancelled(token: Any) -> bool:
    """Best-effort read of a cancellation token's cancelled flag."""
    if token is None:
        return False
    try:
        return bool(token.is_cancelled())
    except Exception:  # pragma: no cover - defensive
        return False


def _database() -> DatabaseManager:
    """Open the shared thread/message database (same file the CLI and TUI use)."""
    global _db_manager
    if _db_manager is None:
        from drsai.configs.constant import WORKSPACE_DIR

        dataset = Path(WORKSPACE_DIR) / "drsai"
        dataset.mkdir(parents=True, exist_ok=True)
        manager = DatabaseManager(engine_uri=f"sqlite:///{dataset}/drsai.db", base_dir=str(dataset))
        response = manager.initialize_database()
        if not response.status:
            raise RuntimeError(f"Database initialization failed: {response.message}")
        _db_manager = manager
    return _db_manager


def resolve_loaded_skill_name(skills: Mapping[str, Any], requested: str) -> str | None:
    """Match composer skill id to a loaded SkillLoader key (name or folder)."""
    wanted = (requested or "").strip()
    if not wanted or not isinstance(skills, Mapping):
        return None
    if wanted in skills:
        return wanted
    lower = wanted.lower()
    for name in skills:
        if isinstance(name, str) and name.lower() == lower:
            return name
    for name, skill in skills.items():
        if not isinstance(skill, Mapping):
            continue
        skill_dir = skill.get("dir")
        dir_name = getattr(skill_dir, "name", None) or ""
        if dir_name == wanted or str(dir_name).lower() == lower:
            return str(name)
        skill_name = skill.get("name")
        if isinstance(skill_name, str) and skill_name.lower() == lower:
            return str(name)
    return None


# Selected-skill prompt builders now live in drsai.backend.prompt_registry
# (single source of truth) and are re-imported above so existing callers keep
# working:
#   build_selected_skill_suffix      — turn-scoped system suffix
#   build_selected_skill_task_prefix — user-message prefix
#   build_turn_suffix / build_turn_prefix — the assembled turn injection


def annotate_task_with_selected_skill(task: Any, skill_name: str) -> Any:
    """Prepend a selected-skill reminder onto the Agent task (does not change UI text)."""
    prefix = build_selected_skill_task_prefix(skill_name)
    if isinstance(task, str):
        return prefix + task
    content = getattr(task, "content", None)
    if isinstance(content, str):
        try:
            task.content = prefix + content
        except Exception:  # pragma: no cover - immutable message types
            return task
        return task
    if isinstance(task, (list, tuple)) and task:
        last = task[-1]
        content = getattr(last, "content", None)
        if isinstance(content, str):
            try:
                last.content = prefix + content
            except Exception:  # pragma: no cover
                return task
        return task
    return task


def _disk_skills_loader_for_agent(agent: Any) -> Any | None:
    """Load installed skills from disk without Agent skill-policy filtering."""
    profile = getattr(agent, "_user_profile_manager", None)
    skills_dir = getattr(profile, "skills_dir", None) if profile is not None else None
    if skills_dir is None:
        return None
    path = Path(skills_dir)
    if not path.exists() or not any(path.glob("*/SKILL.md")):
        return None
    from drsai.modules.components.skills.skill_loader import SkillLoader

    return SkillLoader(skills_dir=str(path))


def apply_selected_skill_to_agent(agent: Any, selected_skill_id: str | None) -> str:
    """Load and inject a composer-selected skill for this turn.

    Returns the injected system suffix (empty when none selected).
    Raises RuntimeExecutionError when a selection cannot be resolved.

    Composer selection is a thread override: even if the Agent skill policy
    hides the skill from the Skill tool catalog, a chip-selected skill must
    still load from the user's installed skills directory.
    """
    requested = (selected_skill_id or "").strip()
    if not requested:
        setattr(agent, "_selected_skill_for_turn", None)
        setattr(agent, "_selected_skill_required_tools", [])
        return ""

    if hasattr(agent, "update_user_skills"):
        try:
            agent.update_user_skills()
        except Exception as exc:  # pragma: no cover - best effort reload
            logger.warning(f"update_user_skills failed before selected skill apply: {exc}")

    loader = getattr(agent, "_cached_skills_loader", None)
    skills = getattr(loader, "skills", None) if loader is not None else None
    resolved = resolve_loaded_skill_name(skills or {}, requested)
    content_loader = loader

    # Thread override: policy may have filtered the skill out of the cached
    # loader; still resolve it from the installed skills directory on disk.
    if not resolved:
        disk_loader = _disk_skills_loader_for_agent(agent)
        disk_skills = getattr(disk_loader, "skills", None) if disk_loader is not None else None
        resolved = resolve_loaded_skill_name(disk_skills or {}, requested)
        if resolved and disk_loader is not None:
            content_loader = disk_loader
            # Keep Skill("name") usable this turn even when policy hid it.
            if loader is not None and isinstance(getattr(loader, "skills", None), dict):
                skill_meta = disk_skills.get(resolved) if isinstance(disk_skills, Mapping) else None
                if skill_meta is not None:
                    loader.skills[resolved] = skill_meta
            elif disk_loader is not None:
                agent._cached_skills_loader = disk_loader
                loader = disk_loader
            logger.info(
                "Composer skill '{}' resolved via disk override (policy catalog missed it)",
                resolved,
            )

    if not resolved or content_loader is None:
        available: list[str] = []
        if isinstance(skills, Mapping):
            available = sorted(str(name) for name in skills.keys())
        disk_loader = _disk_skills_loader_for_agent(agent)
        disk_skills = getattr(disk_loader, "skills", None) if disk_loader is not None else None
        if isinstance(disk_skills, Mapping):
            available = sorted(set(available) | {str(name) for name in disk_skills.keys()})
        raise RuntimeExecutionError(
            "thread_skill_unavailable",
            f"Selected skill '{requested}' is not available for this Agent.",
            detail={"skill_id": requested, "available": available},
        )

    content = content_loader.get_skill_content(resolved)
    if not content:
        raise RuntimeExecutionError(
            "thread_skill_unavailable",
            f"Selected skill '{requested}' has no SKILL.md content.",
            detail={"skill_id": requested, "resolved": resolved},
        )

    setattr(agent, "_selected_skill_for_turn", resolved)
    skill_meta = None
    if isinstance(getattr(content_loader, "skills", None), Mapping):
        skill_meta = content_loader.skills.get(resolved)
    required_tools: list[str] = []
    if isinstance(skill_meta, Mapping):
        raw_tools = skill_meta.get("required_tools") or []
        if isinstance(raw_tools, list):
            required_tools = [str(item) for item in raw_tools if str(item).strip()]
    setattr(agent, "_selected_skill_required_tools", required_tools)
    logger.info(
        "Composer skill applied for turn: skill={} required_tools={}",
        resolved,
        required_tools,
    )
    return build_selected_skill_suffix(resolved, content)


class DesktopAgentManager:
    """Cache and drive the production OpenDrSai Agent for desktop sessions."""

    def __init__(self) -> None:
        self._agents: dict[str, Any] = {}
        self._aliases: dict[str, str | None] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        # Guards the bookkeeping dicts above only -- never held across
        # create_agent()/lazy_init()/load_state()/close(). Those are the slow,
        # network-facing calls, and holding one process-wide lock across them
        # meant a single stalled Agent froze *every* session in the gateway.
        self._global_lock = asyncio.Lock()
        # Serializes Agent construction (create + init + state load) *per
        # Session key*. Separate from ``_global_lock`` so the expensive work
        # happens outside the bookkeeping critical section, and acquired *with
        # a timeout* so a wedged rebuild cannot block that Session forever.
        #
        # This used to be one process-wide lock. Different Sessions build
        # different Agents with no shared state between them, but a single lock
        # made every first send queue behind every other in-flight build: with
        # three Sessions already constructing, the fourth waited out the whole
        # back-queue and tripped the wait timeout, so its composer looked dead.
        # Per-key locking keeps same-Session rebuilds serialized (the actual
        # invariant: one Agent per key) without coupling unrelated Sessions.
        self._rebuild_locks: dict[str, asyncio.Lock] = {}
        # Strong references for detached ``close()`` calls. asyncio only holds a
        # weak reference to a running task, so a bare create_task() may be
        # garbage-collected mid-flight and skip its cleanup.
        self._closing_tasks: set[asyncio.Task[Any]] = set()
        self._quarantined_tasks: dict[str, asyncio.Task[Any]] = {}

    @staticmethod
    def _key(user_id: str, session_id: str) -> str:
        return f"{user_id}::{session_id}"

    async def _lock_for(self, key: str) -> asyncio.Lock:
        async with self._global_lock:
            return self._locks.setdefault(key, asyncio.Lock())

    async def _rebuild_lock_for(self, key: str) -> asyncio.Lock:
        """Return the per-Session construction lock.

        Kept out of ``_locks`` so a rebuild lock cannot be handed to the turn
        path, which assumes it exclusively guards one Session's turn.
        """
        async with self._global_lock:
            return self._rebuild_locks.setdefault(key, asyncio.Lock())

    # ── Agent lifecycle ──────────────────────────────────────────────────

    async def get_or_create(
        self,
        session_id: str,
        user_id: str,
        *,
        model_alias: str | None = None,
        model_provider: str | None = None,
        model_id: str | None = None,
        work_dir: str | None = None,
    ) -> Any:
        uid = effective_user_id(user_id)
        key = self._key(uid, session_id)
        # Keep the structured provider/model identity intact for the factory.
        # The alias remains only as a backward-compatible fallback and cache key.
        alias = (
            f"{model_provider}/{model_id}"
            if model_provider and model_id
            else model_alias or DEFAULT_CONFIG_NAME
        )
        pending = self._quarantined_tasks.get(key)
        if pending is not None and not pending.done():
            raise RuntimeExecutionError(
                "session_recovering",
                "The previous execution has not stopped safely. Wait or restart the runtime.",
                retryable=True,
            )
        self._quarantined_tasks.pop(key, None)
        # Fast path: an Agent already built for exactly this alias. No lock --
        # the cache dicts are only mutated between awaits, so this read can
        # never observe a torn state.
        agent = self._agents.get(key)
        if agent is not None and self._aliases.get(key) == alias:
            return agent

        # Slow path: build (or rebuild) the Agent. The wait for this Session's
        # rebuild lock is bounded, and so is the build itself, so one stalled
        # Agent can no longer wedge every other session in the process.
        rebuild_lock = await self._rebuild_lock_for(key)
        try:
            await asyncio.wait_for(
                rebuild_lock.acquire(), timeout=_AGENT_REBUILD_WAIT_TIMEOUT_SECONDS
            )
        except asyncio.TimeoutError:
            raise RuntimeExecutionError(
                "agent_rebuild_busy",
                "This session is already preparing its Agent. Retry in a moment.",
                retryable=True,
            )
        try:
            # Someone else may have built this exact Agent while we waited.
            agent = self._agents.get(key)
            if agent is not None and self._aliases.get(key) == alias:
                return agent
            if agent is not None and await self._try_hot_swap_model(key, agent, alias):
                return agent
            previous = agent
            logger.info(
                "Creating agent: user=%s session=%s model=%s provider=%s model_id=%s",
                uid, session_id, alias, model_provider, model_id,
            )
            # Detach the superseded Agent *before* the (slow) build so no other
            # turn can pick it up, then stop its in-flight turn and hand its
            # close() to a bounded background task. close() reaches the model
            # client and used to be awaited right here, without any timeout --
            # that is what turned a slow provider into a permanent hang.
            self._agents.pop(key, None)
            self._aliases.pop(key, None)
            if previous is not None:
                self._supersede(key, previous)
            try:
                agent = await asyncio.wait_for(
                    self._build_agent(
                        session_id=session_id,
                        uid=uid,
                        alias=alias,
                        model_provider=model_provider,
                        model_id=model_id,
                        work_dir=work_dir,
                    ),
                    timeout=_AGENT_CREATE_TIMEOUT_SECONDS,
                )
            except asyncio.TimeoutError as exc:
                raise RuntimeExecutionError(
                    "agent_create_timeout",
                    f"Preparing the Agent took longer than {_AGENT_CREATE_TIMEOUT_SECONDS:.0f}s.",
                    retryable=True,
                ) from exc
            self._agents[key] = agent
            self._aliases[key] = alias
            return agent
        finally:
            rebuild_lock.release()

    async def _try_hot_swap_model(self, key: str, agent: Any, alias: str) -> bool:
        """Swap one cached Agent's model client in place instead of rebuilding.

        A model change no longer forces ``_build_agent`` (lazy_init + project
        instructions + load_state) when the Agent can switch clients itself:
        ``DrSaiAgent.switch_model`` replaces ``_model_client``, syncs the
        client into ``model_context`` (token counting / compression / summary),
        closes the old client, and sanitizes cross-provider tool_call history.
        The ``set_model_client`` factory re-reads config.toml on every call, so
        a policy committed through the Gateway is picked up here.

        Runs under this Session's rebuild lock from ``get_or_create``, which is
        only entered between turns (``run_stream`` holds the turn lock), so the
        swap can never race an in-flight turn.

        Any failure falls back to the rebuild path -- the worst case is
        exactly today's behaviour.
        """
        set_fn = getattr(agent, "_set_model_client", None)
        if set_fn is None or not callable(set_fn):
            return False
        if not getattr(agent, "_owns_model_client", True):
            return False
        switch = getattr(agent, "switch_model", None)
        if switch is None or not callable(switch):
            return False
        try:
            new_client = set_fn(alias)
            await asyncio.wait_for(switch(new_client), timeout=_AGENT_CREATE_TIMEOUT_SECONDS)
        except Exception as exc:
            logger.warning(
                "Hot model swap failed for {} ({}); falling back to Agent rebuild",
                key, exc,
            )
            return False
        self._aliases[key] = alias
        logger.info("Hot model swap succeeded: session=%s model=%s", key, alias)
        return True

    async def _build_agent(
        self,
        *,
        session_id: str,
        uid: str,
        alias: str,
        model_provider: str | None,
        model_id: str | None,
        work_dir: str | None,
    ) -> Any:
        """Create and initialize one Agent.

        Runs outside ``_global_lock`` (see ``get_or_create``); the caller holds
        this Session's rebuild lock and enforces the timeout.
        """
        kwargs = dict(
            thread_id=session_id,
            user_id=uid,
            db_manager=_database(),
            # The alias is the model catalog key the renderer picked. It is
            # the *only* model input -- there is no policy layer that
            # could silently override it.
            defult_config_name=alias,
            model_provider=model_provider,
            model_id=model_id,
            work_dir=work_dir or os.getcwd(),
            # Pass the live CLI config the same way the TUI does. Without it
            # the factory falls back to load_config() at import-adjacent time,
            # which can disagree with the config the user is actually editing
            # (and with the TUI on the same machine) for keys like plan_mode.
            cli_cfg=load_config(),
            # Host capabilities: artifact delivery + image generation/edit.
            # Image tools resolve the Agent's image_generation_model policy
            # and never take credentials as arguments.
            extra_tools=[deliver_artifact, image_generation, image_edit],
            # ARCHIVED(2026-09-02): Desktop reuses the TUI legacy path.
            # run_drsai_agent_factory sets _shared_agent_kernel=None for
            # kernel_surface=="tui", so DrSaiAssistant.run_stream() falls
            # back to its own tool loop and handles Delegate/subagents
            # directly. The backend/runtime desktop-kernel middle layer
            # (desktop_agent_kernel_adapter.py etc.) is archived and no
            # longer executes for Desktop.
            kernel_surface="tui",
        )
        if inspect.iscoroutinefunction(create_agent):
            agent = await create_agent(**kwargs)
        else:
            agent = await asyncio.to_thread(create_agent, **kwargs)
        if hasattr(agent, "lazy_init"):
            await agent.lazy_init()
        # Project instructions (DRSAI.md / CLAUDE.md, discovered from cwd
        # upwards) reach the prompt the same way they do in the TUI. Desktop
        # previously skipped this layer entirely, so a repository's own
        # instructions never applied to Desktop sessions.
        await self._apply_project_instructions(agent, work_dir)
        try:
            workbench = getattr(agent, "_workbench", None)
            listed = list(getattr(workbench, "_tools", None) or getattr(agent, "_tools", []) or [])
            tool_names = []
            for tool in listed:
                name = getattr(tool, "name", None)
                if not isinstance(name, str) or not name:
                    schema = getattr(tool, "schema", None)
                    if isinstance(schema, Mapping):
                        name = schema.get("name")
                if isinstance(name, str) and name:
                    tool_names.append(name)
            gfs_names = [name for name in tool_names if name.startswith("gfs_")]
            logger.info(
                "Agent ready: user={} session={} tools={} gfs_tools={}",
                uid, session_id, len(tool_names), gfs_names,
            )
        except Exception as exc:  # pragma: no cover - diagnostics only
            logger.debug("Unable to list tools after create_agent: %s", exc)
        state = await self._load_state(session_id, uid)
        if state and hasattr(agent, "load_state"):
            await agent.load_state(state)
        await self._ensure_thread(session_id, uid, work_dir)
        return agent

    @staticmethod
    async def _apply_project_instructions(agent: Any, work_dir: str | None) -> None:
        """Inject DRSAI.md / CLAUDE.md for the session's cwd, as the TUI does.

        ``/memory reload`` in the TUI re-runs this on demand; Desktop has no
        such command, so it is applied once at Agent build time from the
        session's own working directory.

        Failures are logged and swallowed: a malformed project file must not
        stop a session from starting, and the loader already degrades to an
        empty string when nothing is found.
        """
        if not hasattr(agent, "inject_system_prompt"):
            return
        try:
            from drsai.backend.cli.drsaimd_loader import load_project_instructions

            content, loaded_paths, warnings = await asyncio.to_thread(
                load_project_instructions, str(work_dir or os.getcwd()),
            )
            if warnings:
                for warning in warnings:
                    logger.warning("Project instructions: {}", warning)
            if not content:
                return
            agent.inject_system_prompt(project_instructions=content)
            logger.info("Injected project instructions from {}", loaded_paths)
        except Exception as exc:  # pragma: no cover - best effort
            logger.warning("Failed to load project instructions: {}", exc)

    def _supersede(self, key: str, agent: Any) -> None:
        """Stop a replaced Agent's in-flight turn and close it off the hot path.

        Deliberately synchronous and fire-and-forget: callers hold a lock, and
        an unbounded ``await agent.close()`` under that lock is exactly the
        stall this module used to have.
        """
        canceller = getattr(getattr(agent, "_cancellation_token", None), "cancel", None)
        if callable(canceller):
            try:
                # close() would do this too, but only once it gets scheduled;
                # cancelling first stops the previous turn immediately.
                canceller()
            except Exception as exc:  # pragma: no cover - best effort
                logger.debug("Cancelling superseded Agent turn failed for {}: {}", key, exc)
        if not hasattr(agent, "close"):
            return
        task = asyncio.create_task(self._close_bounded(key, agent))
        self._closing_tasks.add(task)
        task.add_done_callback(self._closing_tasks.discard)

    async def _close_bounded(self, key: str, agent: Any) -> None:
        """Close one Agent, never waiting forever for it.

        Used both when an Agent is superseded by a model switch and when the
        gateway shuts down: an Agent whose model client never answers must not
        be able to block either path.
        """
        closing = asyncio.create_task(agent.close())
        self._closing_tasks.add(closing)
        closing.add_done_callback(self._observe_background_task)
        try:
            await wait_bounded(closing, _AGENT_CLOSE_TIMEOUT_SECONDS)
        except asyncio.TimeoutError:
            logger.warning(
                "close() for Agent {} did not finish within {}s; abandoning it "
                "(a stuck model client must not block a rebuild or shutdown)",
                key,
                _AGENT_CLOSE_TIMEOUT_SECONDS,
            )
        except asyncio.CancelledError:  # pragma: no cover - shutdown
            raise
        except Exception as exc:  # pragma: no cover - best effort
            logger.debug("close() for superseded Agent failed for {}: {}", key, exc)

    def _observe_background_task(self, task: asyncio.Task[Any]) -> None:
        self._closing_tasks.discard(task)
        if not task.cancelled():
            task.exception()  # Retrieve errors from abandoned cleanup/provider tasks.

    def _quarantine(self, key: str, agent: Any, task: asyncio.Task[Any] | None) -> None:
        if self._agents.get(key) is agent:
            self._agents.pop(key, None)
            self._aliases.pop(key, None)
        if task is not None and not task.done():
            self._quarantined_tasks[key] = task
            self._closing_tasks.add(task)
            task.add_done_callback(self._observe_background_task)
            # Do not allow another Agent to mutate the same SQLite context until
            # the old coroutine is actually done. Full process fencing is separate.
            task.add_done_callback(lambda _: self._supersede(key, agent))
            task.cancel()
        else:
            self._supersede(key, agent)

    async def run_stream(
        self,
        task: Any,
        *,
        session_id: str,
        user_id: str,
        model_alias: str | None = None,
        model_provider: str | None = None,
        model_id: str | None = None,
        work_dir: str | None = None,
        workspace_id: str | None = None,
        cancellation_token: Any = None,
        reasoning_effort: str | None = None,
        plan_mode: bool = False,
        selected_skill_id: str | None = None,
    ):
        """Drive one turn, yielding raw autogen events.

        Refuses a second concurrent turn on the same session rather than
        queueing it: two runs sharing one Agent's state would interleave their
        history writes, and the renderer has a stop button for the first one.
        """
        uid = effective_user_id(user_id)
        key = self._key(uid, session_id)
        lock = await self._lock_for(key)
        if lock.locked():
            raise RuntimeExecutionError(
                "session_busy",
                "This session is already running a turn. Wait for it to finish or stop it.",
                retryable=True,
            )
        async with lock:
            agent = await self.get_or_create(
                session_id,
                uid,
                model_alias=model_alias,
                model_provider=model_provider,
                model_id=model_id,
                work_dir=work_dir,
            )
            # Apply plan mode + composer skill selection every turn so a prior
            # turn cannot leak into a normal turn (the Agent is cached per key).
            skill_suffix = apply_selected_skill_to_agent(agent, selected_skill_id)
            # build_turn_suffix keeps the host image policy last so it outranks
            # skill copy that still tells the model to run image scripts.
            suffix = build_turn_suffix(
                surface=SURFACE_DESKTOP,
                selected_skill_suffix=skill_suffix,
            )
            if hasattr(agent, "inject_system_prompt"):
                agent.inject_system_prompt(
                    prefix=build_turn_prefix(plan_mode=plan_mode),
                    suffix=suffix,
                )
            # Reasoning is applied per turn because the Agent is cached per
            # session.  Never let a previous turn's effort leak into a later
            # turn when the setting is cleared.
            if hasattr(agent, "_reasoning_effort"):
                agent._reasoning_effort = reasoning_effort
            elif reasoning_effort is not None:
                logger.debug("Agent does not expose _reasoning_effort; ignoring requested effort")
            turn_task = task
            selected_name = getattr(agent, "_selected_skill_for_turn", None)
            if selected_name:
                turn_task = annotate_task_with_selected_skill(task, str(selected_name))
            await self._set_status(session_id, uid, RunStatus.ACTIVE)
            # The Workspace binding is turn-scoped: one long-lived Agent serves
            # many Runs, and a leaked workspace path would let a later Run write
            # into the previous Run's directory.
            had_path = hasattr(agent, "_runtime_workspace_path")
            previous_path = getattr(agent, "_runtime_workspace_path", None)
            had_id = hasattr(agent, "_runtime_workspace_id")
            previous_id = getattr(agent, "_runtime_workspace_id", None)
            if work_dir:
                agent._runtime_workspace_path = Path(work_dir).resolve()
            agent._runtime_workspace_id = workspace_id
            pending_event = None
            completed_normally = False
            cancel_deadline: list[float | None] = [None]
            try:
                event_stream = agent.run_stream(
                    task=turn_task, cancellation_token=cancellation_token
                )
                iterator = event_stream.__aiter__()
                while True:
                    pending_event = asyncio.create_task(anext(iterator))
                    try:
                        event = await wait_turn_event(
                            pending_event, lambda: _token_cancelled(cancellation_token),
                            _AGENT_TURN_IDLE_TIMEOUT_SECONDS,
                            _AGENT_TURN_CANCEL_GRACE_SECONDS, cancel_deadline,
                        )
                    except StopAsyncIteration:
                        completed_normally = True
                        break
                    except TurnWaitTimeout as exc:
                        raise RuntimeExecutionError(
                            "agent_cancel_timeout" if exc.cancelled else "agent_turn_idle_timeout",
                            str(exc), retryable=True,
                        ) from exc
                    yield event
            finally:
                # A quarantined provider may still be using its turn binding.
                # Never reset those fields underneath a live coroutine.
                if pending_event is None or pending_event.done():
                    setattr(agent, "_selected_skill_for_turn", None)
                    setattr(agent, "_selected_skill_required_tools", [])
                    if had_path:
                        agent._runtime_workspace_path = previous_path
                    elif hasattr(agent, "_runtime_workspace_path"):
                        delattr(agent, "_runtime_workspace_path")
                    if had_id:
                        agent._runtime_workspace_id = previous_id
                    elif hasattr(agent, "_runtime_workspace_id"):
                        delattr(agent, "_runtime_workspace_id")
                if not completed_normally:
                    self._quarantine(key, agent, pending_event)
                elif hasattr(agent, "save_state"):
                    saving = asyncio.create_task(agent.save_state())
                    try:
                        state = await wait_bounded(saving, _AGENT_CLOSE_TIMEOUT_SECONDS)
                        # Do not combine save_state and persistence in the detached
                        # task: a late save result must never overwrite a newer turn.
                        await self._save_state(session_id, uid, state)
                    except asyncio.CancelledError:
                        self._quarantine(key, agent, saving)
                        raise
                    except TimeoutError:
                        self._quarantine(key, agent, saving)
                        logger.warning("State capture timed out for {}; Agent quarantined", key)
                    except Exception as exc:
                        logger.warning(f"Failed to save state for {key}: {exc}")
                final_status = (
                    RunStatus.COMPLETE if completed_normally and not _token_cancelled(cancellation_token)
                    else RunStatus.STOPPED
                )
                try:
                    await self._set_status(session_id, uid, final_status)
                except Exception as exc:  # pragma: no cover - best effort
                    logger.warning(f"Failed to reset thread status for {key}: {exc}")

    async def health(self) -> dict[str, Any]:
        return {"agents": len(self._agents), "sessions": sorted(self._agents)}

    def reset_stale_active_threads(self) -> int:
        """Reset threads still marked ACTIVE (called once at gateway startup).

        The gateway process runs no turn before startup completes, so any
        ``active`` Thread row is residue from a previous process: a crash, a
        force-kill, or a turn abandoned by the old no-timeout lock. Left in
        place, every session view for that thread claims a turn is running.
        Best effort; a database error must not block startup.
        """
        try:
            response: DBResponse = _database().get(
                Thread, filters={"status": RunStatus.ACTIVE}, return_json=False,
            )
            threads = list(response.data or [])
            for thread in threads:
                thread.status = RunStatus.COMPLETE
                thread.updated_at = time.time()
                _database().upsert(thread)
            if threads:
                logger.info(
                    "Reset {} thread(s) left ACTIVE by a previous gateway process",
                    len(threads),
                )
            return len(threads)
        except Exception as exc:  # pragma: no cover - startup best effort
            logger.warning("Failed to reset stale ACTIVE threads at startup: {}", exc)
            return 0

    async def close(self) -> None:
        # Shutdown must always finish: a stalled model client used to make this
        # loop hang, which is why closing the desktop left the Runtime behind.
        # The closes run concurrently and each is bounded by _close_bounded, so
        # the whole teardown costs one timeout no matter how many Agents hang.
        detached = list(self._agents.items())
        self._agents.clear()
        self._aliases.clear()
        self._rebuild_locks.clear()
        if detached:
            await asyncio.gather(*(self._close_bounded(key, agent) for key, agent in detached))
        # Let detached close() calls finish (bounded) instead of logging
        # "Task was destroyed but it is pending" at shutdown.
        if self._closing_tasks:
            try:
                await asyncio.wait(set(self._closing_tasks), timeout=_AGENT_CLOSE_TIMEOUT_SECONDS)
            except Exception:  # pragma: no cover - shutdown best effort
                pass

    # ── Thread persistence ───────────────────────────────────────────────

    async def _thread(self, session_id: str, user_id: str) -> Optional[Thread]:
        response: DBResponse = _database().get(
            Thread, filters={"user_id": user_id, "thread_id": session_id}, return_json=False,
        )
        if response.status and response.data:
            return response.data[0]
        return None

    async def _load_state(self, session_id: str, user_id: str) -> Optional[dict]:
        thread = await self._thread(session_id, user_id)
        state = getattr(thread, "state", None) if thread else None
        if not state:
            return None
        return decompress_state(state) if isinstance(state, str) else state

    async def _save_state(self, session_id: str, user_id: str, state: dict) -> bool:
        thread = await self._thread(session_id, user_id)
        if thread is None:
            return False
        thread.state = compress_state(state)
        thread.updated_at = time.time()
        return _database().upsert(thread).status

    async def _ensure_thread(self, session_id: str, user_id: str, work_dir: str | None) -> Thread:
        thread = await self._thread(session_id, user_id)
        if thread is not None:
            if work_dir:
                meta = dict(getattr(thread, "meta", None) or {})
                if meta.get("workdir") != work_dir:
                    meta["workdir"] = work_dir
                    thread.meta = meta
                    _database().upsert(thread)
            return thread
        thread = Thread(
            user_id=user_id,
            thread_id=session_id,
            status=RunStatus.CREATED,
            messages=[],
            meta={"workdir": work_dir} if work_dir else {},
        )
        _database().upsert(thread)
        return thread

    async def _set_status(self, session_id: str, user_id: str, status: RunStatus) -> None:
        thread = await self._thread(session_id, user_id)
        if thread is None:
            return
        thread.status = status
        thread.updated_at = time.time()
        _database().upsert(thread)

    def _detach(self, keys: Iterable[str]) -> list[tuple[str, Any]]:
        """Drop ``keys`` from the cache and return the Agents that were there.

        Synchronous on purpose: the caller must not hold ``_global_lock`` (or
        this Session's rebuild lock) across the ``close()`` that follows.
        """
        detached: list[tuple[str, Any]] = []
        for key in keys:
            agent = self._agents.pop(key, None)
            self._aliases.pop(key, None)
            # The rebuild lock is created lazily per key, so a Session that is
            # gone would otherwise leave one idle Lock behind forever.
            self._rebuild_locks.pop(key, None)
            if agent is not None:
                detached.append((key, agent))
        return detached

    async def evict_user(self, user_id: str | None = None) -> None:
        """Drop cached agents for one user so skill/tool registry changes take effect."""
        uid = effective_user_id(user_id)
        prefix = f"{uid}::"
        async with self._global_lock:
            detached = self._detach([key for key in self._agents if key.startswith(prefix)])
        # close() reaches the model client; keeping it out of the lock and
        # bounded means toggling a skill can never freeze other sessions.
        for key, agent in detached:
            self._supersede(key, agent)

    async def evict_all(self) -> int:
        """Drop every cached Agent (process-wide tool/config changes such as GFS)."""
        async with self._global_lock:
            detached = self._detach(list(self._agents))
        for key, agent in detached:
            self._supersede(key, agent)
        return len(detached)


__all__ = ["DesktopAgentManager"]
