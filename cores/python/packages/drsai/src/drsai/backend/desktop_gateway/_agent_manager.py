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
from typing import Any, Optional

from loguru import logger

from drsai.backend.run_drsai_agent_factory import DEFAULT_CONFIG_NAME, PLAN_MODE_SYSTEM_PROMPT, create_agent
from drsai.modules.managers.database import DatabaseManager
from drsai.modules.managers.datamodel.db import RunStatus, Thread
from drsai.modules.managers.datamodel.types import Response as DBResponse
from drsai.utils.utils import compress_state, decompress_state

from ._artifacts import deliver_artifact
from ._auth import effective_user_id

_db_manager: DatabaseManager | None = None


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


class DesktopAgentManager:
    """Cache and drive the production OpenDrSai Agent for desktop sessions."""

    def __init__(self) -> None:
        self._agents: dict[str, Any] = {}
        self._aliases: dict[str, str | None] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self._global_lock = asyncio.Lock()

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
        work_dir: str | None = None,
    ) -> Any:
        uid = effective_user_id(user_id)
        key = self._key(uid, session_id)
        alias = model_alias or DEFAULT_CONFIG_NAME
        async with self._global_lock:
            agent = self._agents.get(key)
            if agent is not None and self._aliases.get(key) == alias:
                return agent
            previous = agent
            logger.info(f"Creating agent: user={uid} session={session_id} model={alias}")
            kwargs = dict(
                thread_id=session_id,
                user_id=uid,
                db_manager=_database(),
                # The alias is the model catalog key the renderer picked. It is
                # the *only* model input -- there is no policy layer that
                # could silently override it.
                defult_config_name=alias,
                work_dir=work_dir or os.getcwd(),
                # Artifact delivery is a host capability, not a user-toggled
                # tool: every Agent must be able to publish a file it created.
                extra_tools=[deliver_artifact],
            )
            if inspect.iscoroutinefunction(create_agent):
                agent = await create_agent(**kwargs)
            else:
                agent = await asyncio.to_thread(create_agent, **kwargs)
            if hasattr(agent, "lazy_init"):
                await agent.lazy_init()
            state = await self._load_state(session_id, uid)
            if state and hasattr(agent, "load_state"):
                await agent.load_state(state)
            await self._ensure_thread(session_id, uid, work_dir)
            self._agents[key] = agent
            self._aliases[key] = alias
            if previous is not None and previous is not agent and hasattr(previous, "close"):
                try:
                    await previous.close()
                except Exception as exc:  # pragma: no cover - best effort
                    logger.debug(f"close() after model change failed for {key}: {exc}")
            return agent

    async def run_stream(
        self,
        task: Any,
        *,
        session_id: str,
        user_id: str,
        model_alias: str | None = None,
        work_dir: str | None = None,
        workspace_id: str | None = None,
        cancellation_token: Any = None,
        plan_mode: bool = False,
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
            from drsai.backend.runtime.agent import RuntimeExecutionError

            raise RuntimeExecutionError(
                "session_busy",
                "This session is already running a turn. Wait for it to finish or stop it.",
                retryable=True,
            )
        async with lock:
            agent = await self.get_or_create(
                session_id, uid, model_alias=model_alias, work_dir=work_dir,
            )
            # Apply plan mode: set or clear PLAN_MODE_SYSTEM_PROMPT as the
            # injected prefix.  Called every turn so a prior plan-mode turn
            # does not leak into a normal turn (the Agent is cached per key).
            if hasattr(agent, "inject_system_prompt"):
                agent.inject_system_prompt(
                    prefix=PLAN_MODE_SYSTEM_PROMPT if plan_mode else ""
                )
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
                async for event in agent.run_stream(task=task, cancellation_token=cancellation_token):
                    yield event
            finally:
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
        for agent in list(self._agents.values()):
            if hasattr(agent, "close"):
                try:
                    await agent.close()
                except Exception:  # pragma: no cover - shutdown best effort
                    pass
        self._agents.clear()
        self._aliases.clear()

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

    async def evict_user(self, user_id: str | None = None) -> None:
        """Drop cached agents for one user so skill/tool registry changes take effect."""
        uid = effective_user_id(user_id)
        prefix = f"{uid}::"
        async with self._global_lock:
            for key in list(self._agents):
                if not key.startswith(prefix):
                    continue
                agent = self._agents.pop(key, None)
                self._aliases.pop(key, None)
                if agent is not None and hasattr(agent, "close"):
                    try:
                        await agent.close()
                    except Exception as exc:  # pragma: no cover - best effort
                        logger.debug("close() during evict_user failed for %s: %s", key, exc)


__all__ = ["DesktopAgentManager"]
