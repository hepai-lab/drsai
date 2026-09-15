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
from drsai.backend.run_drsai_agent_factory import DEFAULT_CONFIG_NAME, PLAN_MODE_SYSTEM_PROMPT, create_agent
from drsai.backend.runtime.agent import RuntimeExecutionError
from drsai.modules.managers.database import DatabaseManager
from drsai.modules.managers.datamodel.db import RunStatus, Thread
from drsai.modules.managers.datamodel.types import Response as DBResponse
from drsai.utils.utils import compress_state, decompress_state

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


def build_selected_skill_suffix(skill_name: str, skill_content: str) -> str:
    """Turn-scoped system suffix that forces the Agent to follow a selected skill."""
    return (
        f"CRITICAL — Composer skill selection for this turn.\n"
        f"The user explicitly selected skill `{skill_name}`. "
        "You MUST follow this skill's workflow and constraints to complete the request. "
        "Do not answer from general knowledge when the skill defines scripts, steps, or formats. "
        "If the skill lists scripts or resources, use those paths.\n\n"
        f"<skill-loaded name=\"{skill_name}\">\n{skill_content}\n</skill-loaded>"
    )


def build_selected_skill_task_prefix(skill_name: str) -> str:
    """User-message prefix so the selected skill stays salient in the turn context."""
    return (
        f"[Selected skill: {skill_name}] "
        f"Follow the <skill-loaded name=\"{skill_name}\"> instructions in your system prompt "
        "for this turn. Do not skip that skill's required steps.\n\n"
    )


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
        # Serializes Agent construction (create + init + state load). Separate
        # from ``_global_lock`` so the expensive work happens outside the
        # bookkeeping critical section, and acquired *with a timeout* so a
        # wedged rebuild cannot block other sessions forever.
        self._rebuild_lock = asyncio.Lock()
        # Strong references for detached ``close()`` calls. asyncio only holds a
        # weak reference to a running task, so a bare create_task() may be
        # garbage-collected mid-flight and skip its cleanup.
        self._closing_tasks: set[asyncio.Task[Any]] = set()

    @staticmethod
    def _key(user_id: str, session_id: str) -> str:
        return f"{user_id}::{session_id}"

    async def _lock_for(self, key: str) -> asyncio.Lock:
        async with self._global_lock:
            return self._locks.setdefault(key, asyncio.Lock())

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
        # Fast path: an Agent already built for exactly this alias. No lock --
        # the cache dicts are only mutated between awaits, so this read can
        # never observe a torn state.
        agent = self._agents.get(key)
        if agent is not None and self._aliases.get(key) == alias:
            return agent

        # Slow path: build (or rebuild) the Agent. The wait for the rebuild lock
        # is bounded, and so is the build itself, so one stalled Agent can no
        # longer wedge every other session in the process.
        try:
            await asyncio.wait_for(
                self._rebuild_lock.acquire(), timeout=_AGENT_REBUILD_WAIT_TIMEOUT_SECONDS
            )
        except asyncio.TimeoutError:
            raise RuntimeExecutionError(
                "agent_rebuild_busy",
                "Another session is still preparing its Agent. Retry in a moment.",
                retryable=True,
            )
        try:
            # Someone else may have built this exact Agent while we waited.
            agent = self._agents.get(key)
            if agent is not None and self._aliases.get(key) == alias:
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
            self._rebuild_lock.release()

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
        ``_rebuild_lock`` and enforces the timeout.
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
        try:
            await asyncio.wait_for(agent.close(), timeout=_AGENT_CLOSE_TIMEOUT_SECONDS)
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
            # Host image policy last in suffix so it outranks skill copy that
            # still tells the model to run image scripts.
            suffix_parts = [part for part in (skill_suffix, IMAGE_GENERATION_HOST_POLICY) if part]
            if hasattr(agent, "inject_system_prompt"):
                agent.inject_system_prompt(
                    prefix=PLAN_MODE_SYSTEM_PROMPT if plan_mode else "",
                    suffix="\n\n".join(suffix_parts),
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
            try:
                async for event in agent.run_stream(task=turn_task, cancellation_token=cancellation_token):
                    yield event
            finally:
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
                if hasattr(agent, "save_state"):
                    try:
                        await self._save_state(session_id, uid, await agent.save_state())
                    except Exception as exc:  # pragma: no cover - best effort
                        logger.warning(f"Failed to save state for {key}: {exc}")

    async def health(self) -> dict[str, Any]:
        return {"agents": len(self._agents), "sessions": sorted(self._agents)}

    async def close(self) -> None:
        # Shutdown must always finish: a stalled model client used to make this
        # loop hang, which is why closing the desktop left the Runtime behind.
        # The closes run concurrently and each is bounded by _close_bounded, so
        # the whole teardown costs one timeout no matter how many Agents hang.
        detached = list(self._agents.items())
        self._agents.clear()
        self._aliases.clear()
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
        ``_rebuild_lock``) across the ``close()`` that follows.
        """
        detached: list[tuple[str, Any]] = []
        for key in keys:
            agent = self._agents.pop(key, None)
            self._aliases.pop(key, None)
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
