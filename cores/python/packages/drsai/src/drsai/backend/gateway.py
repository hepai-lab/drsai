"""

DrSai API Server â FastAPI SSE streaming server wrapping DrSai Assistant.



Provides an OpenAI-compatible /v1/chat/completions endpoint so the

Electron desktop app can drive a local DrSai agent via HTTP SSE.



Also exposes session management, skills, memory, and agent control

(pause/resume/stop) endpoints â making it a full DrSai Gateway.



Usage:

    python drsai_api_server.py                # default port 18642

    DRSAI_API_PORT=18642 python ...           # custom port

    DRSAI_API_HOST=0.0.0.0 python ...         # bind all interfaces



Endpoints:

    GET  /health

    GET  /v1/models

    POST /v1/chat/completions                  (SSE streaming)

    GET  /v1/threads                           (list sessions)

    GET  /v1/threads/{thread_id}               (get session messages)

    GET  /v1/threads/search                    (search sessions)

    POST /v1/threads/{thread_id}/pause         (pause agent)

    POST /v1/threads/{thread_id}/resume        (resume agent)

    POST /v1/threads/{thread_id}/stop          (stop & save state)

    GET  /v1/skills                            (list installed skills)

    GET  /v1/skills/{skill_path:path}          (get skill content)

    GET  /v1/memory                            (get memory/user profile)

    GET  /v1/config/user-name                  (get current user name)

    PUT  /v1/config/user-name                  (set current user name)

"""



from __future__ import annotations



import asyncio
import base64
from collections import deque
from fnmatch import fnmatch
import inspect

import hashlib
import mimetypes

import json

import os

import re

import subprocess

import sys

import time

import traceback

import uuid

from contextlib import asynccontextmanager, nullcontext

from datetime import datetime

from pathlib import Path

from typing import Any, Optional



from fastapi import FastAPI, File, Form, HTTPException, Query, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.exceptions import RequestValidationError
import httpx

from fastapi.responses import JSONResponse, StreamingResponse

from loguru import logger

from pydantic import BaseModel, Field

from drsai.backend.remote_workspace import PROTOCOL_VERSION, canonical_workspace, ensure_protocol, workspace_child
from drsai.backend.remote_checkpoints import accept_checkpoint, create_checkpoint, list_checkpoints, preview_checkpoint, restore_checkpoint
from drsai.backend.runtime_registry import RuntimeRegistry
from drsai.backend.runtime_engine import RuntimeEngine, RuntimeEngineIdentity
from drsai.backend.agent_runtime import (
    AgentDefinition,
    AgentDefinitionStore,
    HAIModelAdapter,
    ModelIdentity,
    OpenDrSaiAgentBackend,
    RuntimeAgentService,
    RuntimeExecutionError,
    RuntimeRunContext,
    RuntimeToolDispatcher,
)
from drsai.backend.codex_adapter import build_codex_adapter
from drsai.backend.runtime_security import (
    ApprovalRegistry,
    ApprovalRequired,
    AuditLog,
    OperationContext,
    RuntimePrincipal,
    RuntimeSecurity,
    SecureWorkspaceFS,
    SecurityError,
    WorkspacePermissionStore,
    redact_sensitive,
)



from autogen_agentchat.base import Response, TaskResult

from autogen_agentchat.messages import (

    BaseChatMessage,

    ModelClientStreamingChunkEvent,

    TextMessage,

    ToolCallExecutionEvent,

    ToolCallRequestEvent,

)

from autogen_core import CancellationToken



from drsai.backend.run_drsai_agent_factory import (
    create_agent,
    load_llm_mode_config,
    build_model_catalog,
    ModelEntry,
    ReasoningConfig,
    ensure_llm_config_file,
    save_llm_mode_config,
    get_llm_config_file_path,
    DEFAULT_CONFIG_NAME,
    _display_name_from_alias,
)

from drsai.configs.constant import FS_DIR, WORKSPACE_DIR

from drsai.modules.managers.database import DatabaseManager

from drsai.modules.managers.datamodel.db import Thread, RunStatus

from drsai.modules.managers.datamodel.types import Response as DBResponse
from drsai.modules.managers.messages import AgentLogEvent

from drsai.utils.utils import compress_state, decompress_state

from drsai.backend.cli.history import CLISessionStore
from drsai.platform_auth import (
    classify_model_error,
    context_from_bearer,
    platform_auth_scope,
    verify_gateway_instance,
)



# ââ Optional event types (may not be imported if module not available) âââââ

try:

    from drsai.modules.agents.skills_agent.drsai_assistant import (

        ThoughtEvent,

        MemoryQueryEvent,

    )

except ImportError:

    ThoughtEvent = None

    MemoryQueryEvent = None



try:

    from drsai.modules.agents.skills_agent.drsai_cli_assistant import (

        SessionInfo,

        _extract_messages_from_thread,

        _thread_to_info,

    )

except ImportError:

    SessionInfo = None

    _extract_messages_from_thread = None

    _thread_to_info = None





# âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

# Config

# âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ



DEFAULT_PORT = int(os.environ.get("DRSAI_API_PORT", "18642"))

DEFAULT_HOST = os.environ.get("DRSAI_API_HOST", "127.0.0.1")



# ââ Database paths (aligned with run_cli.py conventions) âââââââââââââââââââââ

_WORKSPACE = Path(WORKSPACE_DIR)

_WORKSPACE.mkdir(parents=True, exist_ok=True)

_DATASET = _WORKSPACE / "drsai"

_DATASET.mkdir(parents=True, exist_ok=True)

_DB_URI = f"sqlite:///{_DATASET}/drsai.db"



# Default desktop user â can be overridden via API

_DEFAULT_USER_ID = os.environ.get("DRSAI_DESKTOP_USER", os.environ.get("USER", os.environ.get("USERNAME", "desktop")))



# User-name override (set via /v1/config/user-name)

_desktop_user_name: str | None = None



def _get_user_id() -> str:

    """Resolve the effective user_id: API override > env var > system user."""

    return _desktop_user_name or _DEFAULT_USER_ID


def _get_default_model_alias() -> str:
    """Resolve the configured default model alias for desktop gateway callers."""
    try:
        from drsai.backend.cli.config import load_config

        alias = load_config().get("defult_config_name")
        if isinstance(alias, str) and alias.strip():
            normalized = alias.strip()
            return "deepseek-ai/deepseek-v4-pro" if normalized in {"deepseek-v4-pro", "hepai/deepseek-v4-pro"} else normalized
    except Exception as e:
        logger.debug(f"Failed to read default model alias from cli config: {e}")
    return DEFAULT_CONFIG_NAME





# ââ Logging ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

logger.remove()

logger.add(

    sys.stderr,

    format="<green>{time:HH:mm:ss}</green> | <level>{level: <8}</level> | <level>{message}</level>",

    level="INFO",

)





# âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

# Pydantic models

# âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ



class ChatMessage(BaseModel):

    role: str  # "user" | "assistant" | "system"

    content: str





class ChatRequest(BaseModel):

    model: str = "drsai"

    messages: list[ChatMessage]

    stream: bool = True

    thread_id: Optional[str] = Field(

        default=None,

        description="Session ID for multi-turn conversation isolation. "

                    "Same thread_id = same agent instance = conversation history preserved.",

    )

    user_id: Optional[str] = Field(

        default=None,

        description="User identifier for multi-user isolation. "

                    "Defaults to the server's configured desktop user.",

    )

    work_dir: Optional[str] = Field(

        default=None,

        description="Working directory for tool execution. "

                    "Defaults to the server's current working directory.",

    )

    workspace_id: Optional[str] = Field(
        default=None,
        description="Registered remote workspace used to constrain tool execution.",
    )

    metadata: dict[str, Any] = Field(

        default_factory=dict,

        description="Desktop request metadata, including chat runtime mode.",

    )





class UserNameRequest(BaseModel):

    user_name: str = Field(..., description="Custom user name for the desktop session.")


class ContentRequest(BaseModel):
    content: str = Field(..., description="File content to write")


class SkillInstallRequest(BaseModel):
    name: str = Field(..., description="Skill name (directory name)")
    content: str = Field(default="", description="SKILL.md content (optional if source is provided)")
    source: str | None = Field(default=None, description="Source collection name for installing from bundled skills")


class ToolEntry(BaseModel):
    """A single tool entry in TOOLS_CONFIG.json.

    type: ``mcp-std`` | ``mcp-sse`` | other (local). Anything else is treated
    as a free-form local-tool description that the agent surfaces to the LLM
    via tool prompts but does not invoke directly.
    """
    type: str = Field(..., description="Tool type: mcp-std | mcp-sse | <local>")
    config: dict = Field(default_factory=dict, description="Tool-specific config payload")
    name: str | None = Field(default=None, description="Optional display name (UI only)")
    enabled: bool = Field(default=True, description="UI-only flag; disabled entries are skipped on load")



# âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

# Shared Database Manager (initialized once, reused across all agents)

# âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ



_db_manager: DatabaseManager | None = None

_store_cache: dict[str, CLISessionStore] = {}  # user_id â store





def _get_db() -> DatabaseManager:

    """Get or initialize the shared DatabaseManager."""

    global _db_manager

    if _db_manager is None:

        _db_manager = DatabaseManager(engine_uri=_DB_URI, base_dir=str(_DATASET))

        init_response = _db_manager.initialize_database()

        if not init_response.status:

            logger.error(f"Database init failed: {init_response.message}")

            raise RuntimeError(f"Database initialization failed: {init_response.message}")

        logger.info(f"Database initialized: {_DB_URI}")

    return _db_manager





def _get_store(user_id: str | None = None) -> CLISessionStore:

    """Get or create a CLISessionStore for the given user_id."""

    uid = user_id or _get_user_id()

    if uid not in _store_cache:

        _store_cache[uid] = CLISessionStore(_get_db(), uid)

    return _store_cache[uid]





# âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

# Agent Manager â session-isolated agent pool with Thread.state persistence

# âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ




_remote_hepai_cache: tuple[float, list[Any], list[dict[str, Any]]] = (0.0, [], [])


def _remote_hepai_model_row(item: Any) -> dict[str, Any]:
    if isinstance(item, dict): return dict(item)
    if hasattr(item, "model_dump"): return dict(item.model_dump())
    if hasattr(item, "dict"): return dict(item.dict())
    return {key: value for key, value in vars(item).items() if not key.startswith("_")}


async def _load_remote_hepai_tools(force: bool = False) -> tuple[list[Any], list[dict[str, Any]]]:
    global _remote_hepai_cache
    cached_at, tools, rows = _remote_hepai_cache
    if not force and time.time() - cached_at < 60:
        return list(tools), [dict(row) for row in rows]
    from hepai import HepAI
    from hepai.tools.get_woker_functions import get_worker_sync_functions
    from drsai.backend.remote_hepai import discover_enabled_worker_tools
    api_key = os.environ.get("HEPAI_API_KEY")
    base_url = os.environ.get("HEPAI_BASE_URL")
    client = HepAI(api_key=api_key)
    models = await asyncio.wait_for(asyncio.to_thread(client.models.list), timeout=5)
    model_rows = [_remote_hepai_model_row(item) for item in getattr(models, "data", [])]
    def load(worker_id: str):
        return get_worker_sync_functions(name=worker_id, api_key=api_key, base_url=base_url)
    tools, rows = await discover_enabled_worker_tools(model_rows, load, Path.home()/".local"/"share"/"opendrsai"/"remote"/"hepai-workers.json", timeout=5)
    _remote_hepai_cache = (time.time(), list(tools), [dict(row) for row in rows])
    return tools, rows


class AgentManager:

    """Manage DrSai agent instances keyed by (user_id, thread_id) for session isolation.



    Lifecycle (mirrors run_cli.py):

    1. get_or_create â create_agent + lazy_init + load_state + get_or_create_thread

    2. run_stream â agent.run_stream(task=...)

    3. pause â agent.pause() + save_state + Thread.status=PAUSED

    4. resume â agent.resume() + Thread.status=ACTIVE

    5. stop â agent.save_state + save_state + agent.close() + cleanup

    """



    def __init__(self) -> None:

        self._agents: dict[str, Any] = {}            # "{user_id}:{thread_id}" â agent

        self._model_aliases: dict[str, str] = {}     # key â current model alias

        self._locks: dict[str, asyncio.Lock] = {}    # key â request lock

        self._global_lock = asyncio.Lock()



    @staticmethod

    def _make_key(user_id: str, thread_id: str) -> str:

        return f"{user_id}:{thread_id}"

    def _fake_stream(self, task: str):
        """Deterministic stream used only for desktop/API smoke tests."""

        async def _stream():
            from autogen_agentchat.messages import ModelClientStreamingChunkEvent
            from autogen_agentchat.base import TaskResult

            yield ModelClientStreamingChunkEvent(
                content=f"fake-agent: {task}",
                source="assistant",
            )
            yield TaskResult(messages=[], stop_reason="fake-agent-complete")

        return _stream()



    async def _get_lock(self, key: str) -> asyncio.Lock:

        if key not in self._locks:

            self._locks[key] = asyncio.Lock()

        return self._locks[key]



    # ââ Thread state persistence (mirrors run_cli.py) ââââââââââââââââââââââ



    async def _load_thread_state(self, thread_id: str, user_id: str) -> Optional[dict]:

        """Load Thread.state from database."""

        db = _get_db()

        resp: DBResponse = db.get(

            Thread,

            filters={"user_id": user_id, "thread_id": thread_id},

            return_json=False,

        )

        if resp.status and resp.data:

            thread: Thread = resp.data[0]

            state = thread.state

            if state:

                if isinstance(state, str):

                    return decompress_state(state)

                return state

        return None



    async def _save_thread_state(self, thread_id: str, user_id: str, state_dict: dict) -> bool:

        """Save agent state to Thread.state."""

        db = _get_db()

        resp: DBResponse = db.get(

            Thread,

            filters={"user_id": user_id, "thread_id": thread_id},

            return_json=False,

        )

        if resp.status and resp.data:

            thread: Thread = resp.data[0]

            thread.state = compress_state(state_dict)

            thread.updated_at = time.time()

            save_resp = db.upsert(thread)

            return save_resp.status

        return False



    async def _get_or_create_thread(self, thread_id: str, user_id: str, work_dir: str | None = None) -> Thread:

        """Get or create a Thread record."""

        db = _get_db()

        resp: DBResponse = db.get(

            Thread,

            filters={"user_id": user_id, "thread_id": thread_id},

            return_json=False,

        )

        if resp.status and resp.data:
            thread = resp.data[0]
            if work_dir:
                meta = dict(getattr(thread, "meta", None) or {})
                if meta.get("workdir") != work_dir:
                    meta["workdir"] = work_dir
                    thread.meta = meta
                    db.upsert(thread)
            return thread

        thread = Thread(

            user_id=user_id,

            thread_id=thread_id,

            status=RunStatus.CREATED,

            messages=[],

            meta={"workdir": work_dir} if work_dir else {},

        )

        db.upsert(thread)

        return thread



    async def _update_thread_status(

        self, thread_id: str, user_id: str, status: RunStatus

    ) -> None:

        """Update Thread.status."""

        db = _get_db()

        resp: DBResponse = db.get(

            Thread,

            filters={"user_id": user_id, "thread_id": thread_id},

            return_json=False,

        )

        if resp.status and resp.data:

            thread: Thread = resp.data[0]

            thread.status = status

            thread.updated_at = time.time()

            db.upsert(thread)



    # ââ Agent lifecycle ââââââââââââââââââââââââââââââââââââââââââââââââââââ



    async def get_or_create(

        self,

        thread_id: str,

        user_id: str | None = None,

        model_alias: str | None = None,

        work_dir: str | None = None,

    ) -> Any:

        """Get existing agent or create a new one with state loaded from DB.



        If the agent doesn't exist:

        1. Create via create_agent()

        2. Call lazy_init()

        3. Load saved state from Thread.state

        4. Get-or-create Thread record

        """

        uid = user_id or _get_user_id()

        tid = thread_id or "__default__"

        key = self._make_key(uid, tid)



        async with self._global_lock:

            agent = self._agents.get(key)

            current_alias = self._model_aliases.get(key)



            if agent is None or (model_alias and model_alias != current_alias):

                logger.info(

                    f"Creating agent: user_id={uid}, thread_id={tid}, "

                    f"model={model_alias}, work_dir={work_dir}"

                )



                # 1. Create agent (sync â run in thread)

                create_agent_kwargs = dict(
                    thread_id=tid,
                    user_id=uid,
                    db_manager=_get_db(),
                    defult_config_name=model_alias or _get_default_model_alias(),
                    work_dir=work_dir or os.getcwd(),
                )
                try:
                    remote_tools, _ = await _load_remote_hepai_tools()
                    if remote_tools: create_agent_kwargs["extra_tools"] = remote_tools
                except Exception as exc:
                    logger.warning(f"HepAI remote tools unavailable; creating core agent without them: {type(exc).__name__}")
                if inspect.iscoroutinefunction(create_agent):
                    agent = await create_agent(**create_agent_kwargs)
                else:
                    agent = await asyncio.to_thread(
                        create_agent,
                        **create_agent_kwargs,
                    )



                # 2. Lazy init

                if hasattr(agent, "lazy_init"):

                    await agent.lazy_init()



                # 3. Load saved state from Thread.state

                state_dict = await self._load_thread_state(tid, uid)

                if state_dict and hasattr(agent, "load_state"):

                    await agent.load_state(state_dict)

                    logger.info(f"Loaded saved state for {key}")



                # 4. Get-or-create Thread record

                await self._get_or_create_thread(tid, uid, work_dir)



                self._agents[key] = agent

                self._model_aliases[key] = model_alias



            return agent



    async def run_stream(

        self,

        task: str,

        thread_id: str | None = None,

        user_id: str | None = None,

        model_alias: str | None = None,

        work_dir: str | None = None,

        cancellation_token: CancellationToken | None = None,

    ):

        """Run agent.run_stream() for the given session, with concurrency guard."""

        uid = user_id or _get_user_id()

        tid = thread_id or "__default__"

        if os.environ.get("DRSAI_GATEWAY_FAKE_AGENT") == "1":
            async for event in self._fake_stream(task):
                yield event
            return

        key = self._make_key(uid, tid)

        lock = await self._get_lock(key)



        if lock.locked():

            raise HTTPException(

                status_code=503,

                detail=f"Session {tid} is busy. Wait for the current response to complete.",

            )



        async with lock:

            agent = await self.get_or_create(

                thread_id=tid,

                user_id=uid,

                model_alias=model_alias,

                work_dir=work_dir,

            )



            # Mark thread as ACTIVE

            await self._update_thread_status(tid, uid, RunStatus.ACTIVE)



            try:

                async for event in agent.run_stream(

                    task=task,

                    cancellation_token=cancellation_token,

                ):

                    yield event

            finally:

                # Save state after each turn (safe incremental persistence)

                if hasattr(agent, "save_state"):

                    try:

                        state_dict = await agent.save_state()

                        await self._save_thread_state(tid, uid, state_dict)

                    except Exception as e:

                        logger.warning(f"Failed to save state for {key}: {e}")



    async def pause_agent(self, thread_id: str, user_id: str | None = None) -> bool:

        """Pause a running agent and persist its state."""

        uid = user_id or _get_user_id()

        key = self._make_key(uid, thread_id)

        agent = self._agents.get(key)

        if agent is None:

            return False



        try:

            await agent.pause()

            if hasattr(agent, "save_state"):

                state_dict = await agent.save_state()

                await self._save_thread_state(thread_id, uid, state_dict)

            await self._update_thread_status(thread_id, uid, RunStatus.PAUSED)

            logger.info(f"Agent paused: {key}")

            return True

        except Exception as e:

            logger.error(f"Failed to pause agent {key}: {e}")

            return False



    async def resume_agent(self, thread_id: str, user_id: str | None = None) -> bool:

        """Resume a paused agent."""

        uid = user_id or _get_user_id()

        key = self._make_key(uid, thread_id)

        agent = self._agents.get(key)

        if agent is None:

            return False



        try:

            await agent.resume()

            await self._update_thread_status(thread_id, uid, RunStatus.ACTIVE)

            logger.info(f"Agent resumed: {key}")

            return True

        except Exception as e:

            logger.error(f"Failed to resume agent {key}: {e}")

            return False



    async def stop_agent(self, thread_id: str, user_id: str | None = None) -> bool:

        """Stop an agent, save its final state, and remove from pool."""

        uid = user_id or _get_user_id()

        key = self._make_key(uid, thread_id)

        agent = self._agents.pop(key, None)

        self._model_aliases.pop(key, None)

        if agent is None:

            return False



        try:

            if hasattr(agent, "save_state"):

                state_dict = await agent.save_state()

                await self._save_thread_state(thread_id, uid, state_dict)

            await agent.close()

            await self._update_thread_status(thread_id, uid, RunStatus.STOPPED)

            logger.info(f"Agent stopped: {key}")

            return True

        except Exception as e:

            logger.error(f"Failed to stop agent {key}: {e}")

            return False



    async def health(self) -> dict:

        """Check agent pool health."""

        return {

            "status": "ok",

            "agent": "ready",

            "sessions": len(self._agents),

            "db": _DB_URI,

            "user": _get_user_id(),

        }

    async def evict_user(self, user_id: str) -> int:
        """Drop every agent for ``user_id`` from the pool without saving state.

        Used after a config / env / model-catalog write so the next chat turn
        creates a fresh agent that re-reads the new values.  Saved Thread
        state will be re-loaded on the new agent.
        """
        async with self._global_lock:
            prefix = f"{user_id}:"
            keys = [k for k in self._agents if k.startswith(prefix)]
            for k in keys:
                agent = self._agents.pop(k, None)
                self._model_aliases.pop(k, None)
                if agent is not None and hasattr(agent, "close"):
                    try:
                        await agent.close()
                    except Exception as e:
                        logger.debug(f"close() during evict failed for {k}: {e}")
            return len(keys)



    async def list_models(self) -> list[dict]:

        """Return available models from llm_mode_config."""

        try:

            llm_config = await asyncio.to_thread(load_llm_mode_config, None)

            return [{"id": alias, "object": "model"} for alias in llm_config]

        except Exception:

            return [{"id": "drsai", "object": "model"}]





# âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

# FastAPI application

# âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ



manager = AgentManager()





@asynccontextmanager

async def lifespan(app: FastAPI):

    """Startup/shutdown hooks."""

    logger.info(f"DrSai API Server starting on {DEFAULT_HOST}:{DEFAULT_PORT}")

    # Initialize DB eagerly so first request doesn't pay the cost

    _get_db()

    _restore_runtime_workspaces()

    logger.info(f"Database ready: {_DB_URI}")

    logger.info(f"Default user: {_get_user_id()}")

    yield

    logger.info("DrSai API Server shutting down")

    if _runtime_agent_service_instance is not None:
        await _runtime_agent_service_instance.close()

    # Stop any cron schedulers we started so background tasks unwind cleanly
    for uid, sm in list(_schedulers.items()):
        try:
            await sm.stop()
            logger.info(f"Stopped ScheduledTaskManager for user {uid}")
        except Exception as e:
            logger.warning(f"Failed to stop scheduler for {uid}: {e}")





app = FastAPI(

    title="DrSai API Server",

    version="0.2.0",

    lifespan=lifespan,

)

_REMOTE_PROTOCOL_VERSION = PROTOCOL_VERSION
_remote_workspaces: dict[str, Path] = {}
_runtime_registry_instance: RuntimeRegistry | None = None
_runtime_engine_instance: RuntimeEngine | None = None
_runtime_tool_dispatcher_instance: RuntimeToolDispatcher | None = None
_runtime_security_instance: RuntimeSecurity | None = None
_runtime_agent_service_instance: RuntimeAgentService | None = None
_REMOTE_CAPABILITY_VERSIONS = {
    "threads": 1,
    "chat": 1,
    "files": 2,
    "file-watch": 2,
    "git": 1,
    "approvals": 1,
    "hepai-worker": 1,
    "pty": 2,
    "runtime-identity": 1,
    "workspace-registry": 1,
    "worktree": 1,
    "session-run-events": 1,
    "runtime-checkpoint": 1,
    "agent-backend": 1,
    "agent-backend-account": 1,
    "workspace-permissions": 1,
    "security-approval": 1,
    "runtime-audit": 1,
}


def _runtime_registry() -> RuntimeRegistry:
    global _runtime_registry_instance
    if _runtime_registry_instance is None:
        state_root = Path(os.environ.get("DRSAI_HOME", str(Path.home() / ".drsai"))).expanduser()
        _runtime_registry_instance = RuntimeRegistry(state_root / "runtime" / "runtime.sqlite3")
    return _runtime_registry_instance


def _runtime_engine() -> RuntimeEngine:
    global _runtime_engine_instance
    if _runtime_engine_instance is None:
        state_root = Path(os.environ.get("DRSAI_HOME", str(Path.home() / ".drsai"))).expanduser()
        registry = _runtime_registry()
        _runtime_engine_instance = RuntimeEngine(
            state_root / "runtime" / "engine.sqlite3",
            RuntimeEngineIdentity(registry.identity.runtime_id, registry.identity.instance_id),
            lambda workspace_id: bool((record := registry.get_workspace(workspace_id, include_closed=True)) and record.open),
        )
    return _runtime_engine_instance


def _runtime_tool_dispatcher() -> RuntimeToolDispatcher:
    global _runtime_tool_dispatcher_instance
    if _runtime_tool_dispatcher_instance is None:
        _runtime_tool_dispatcher_instance = RuntimeToolDispatcher(_runtime_engine())
    return _runtime_tool_dispatcher_instance


def _runtime_security() -> RuntimeSecurity:
    global _runtime_security_instance
    if _runtime_security_instance is None:
        state_root = Path(os.environ.get("DRSAI_HOME", str(Path.home() / ".drsai"))).expanduser() / "runtime"
        _runtime_security_instance = RuntimeSecurity(
            WorkspacePermissionStore(state_root / "permissions.sqlite3"),
            ApprovalRegistry(state_root / "security-approvals.sqlite3"),
            AuditLog(state_root / "audit.sqlite3"),
        )
    return _runtime_security_instance


def _security_enabled() -> bool:
    return os.environ.get("OPENDRSAI_ENFORCE_WORKSPACE_PERMISSIONS") == "1"


def _principal_from_request(request: Request) -> RuntimePrincipal:
    try:
        auth = context_from_bearer(request.headers.get("authorization"), request.headers.get("x-opendrsai-principal", ""))
        return RuntimePrincipal.from_platform_auth(auth)
    except (ValueError, SecurityError) as exc:
        code = getattr(exc, "code", str(exc))
        raise HTTPException(status_code=401, detail={"code": code, "message": "Runtime Principal identity is invalid.", "retryable": code in {"token_expired", "principal_expired"}}) from exc


def _authorize_request(request: Request, workspace_id: str, action: str, resource: dict[str, Any] | None = None) -> RuntimePrincipal | None:
    if not _security_enabled():
        return None
    principal = _principal_from_request(request)
    identity = _runtime_registry().identity
    context = OperationContext(
        principal.principal_id,
        identity.runtime_id,
        workspace_id,
        request.headers.get("x-opendrsai-session-id", ""),
        request.headers.get("x-opendrsai-run-id", ""),
        request.headers.get("x-opendrsai-tool-id", ""),
        getattr(request.state, "correlation_id", ""),
    )
    try:
        _runtime_security().authorize(principal, action, context, resource, request.headers.get("x-opendrsai-approval-id"))
    except ApprovalRequired as exc:
        raise HTTPException(status_code=428, detail={"code": exc.code, "message": exc.message, "retryable": True, "detail": {"approval_id": exc.approval_id}}) from exc
    except SecurityError as exc:
        raise HTTPException(status_code=403, detail={"code": exc.code, "message": exc.message, "retryable": False}) from exc
    return principal


def _controlled_runtime_model_turn(
    prompt: str,
    definition: AgentDefinition,
    _context: RuntimeRunContext,
    history: Any,
) -> dict[str, Any]:
    """Deterministic acceptance model; never enabled by a production default."""
    if os.environ.get("DRSAI_RUNTIME_CONTROLLED_MODEL") != "1":
        raise RuntimeExecutionError(
            "agent_model_unconfigured",
            "The OpenDrSai Agent Backend model adapter is not configured.",
        )
    plan = definition.raw.get("controlled_plan", {})
    if not isinstance(plan, dict):
        raise RuntimeExecutionError("agent_definition_invalid", "Controlled Agent plan is invalid.")
    delay_seconds = plan.get("delay_seconds", 0)
    if isinstance(delay_seconds, (int, float)) and delay_seconds > 0 and not history:
        time.sleep(min(float(delay_seconds), 30.0))
    if history:
        return {"content": str(plan.get("final_content") or "completed"), "done": True}
    calls = plan.get("calls", [])
    if not isinstance(calls, list):
        raise RuntimeExecutionError("agent_definition_invalid", "Controlled Agent calls are invalid.")
    return {
        "calls": calls,
        "content": str(plan.get("content") or ("" if calls else prompt)),
        "done": not calls,
    }


def _runtime_agent_service(auth_context: Any = None) -> RuntimeAgentService:
    """Return the process-owned Backend service; request identity is validated before dispatch."""
    global _runtime_agent_service_instance
    if _runtime_agent_service_instance is None:
        state_root = Path(os.environ.get("DRSAI_HOME", str(Path.home() / ".drsai"))).expanduser()
        _ensure_builtin_agent_definitions(state_root)
        backend = OpenDrSaiAgentBackend(_controlled_runtime_model_turn)
        codex_backend = build_codex_adapter(state_root, _runtime_engine())
        _runtime_agent_service_instance = RuntimeAgentService(
            _runtime_engine(),
            _runtime_registry(),
            AgentDefinitionStore(state_root / "assets" / "agents"),
            _runtime_tool_dispatcher(),
            {backend.backend_id: backend, codex_backend.backend_id: codex_backend},
        )
    return _runtime_agent_service_instance


def _ensure_builtin_agent_definitions(state_root: Path) -> None:
    path = state_root / "assets" / "agents" / "codex" / "1.json"
    if path.exists():
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "id": "codex", "version": "1", "backend": "codex", "model": "gpt-5.4",
        "instructions": "Work only inside the Runtime-authoritative Workspace and report verifiable results.",
        "permissions": ["workspace:read", "workspace:write", "files:write", "process:execute", "permissions:grant"],
        "backend_config": {"approvalPolicy": "on-request", "sandbox": "workspace-write"},
    }
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    os.replace(temporary, path)


def _restore_runtime_workspaces() -> None:
    _remote_workspaces.clear()
    for record in _runtime_registry().list_workspaces():
        root = Path(record.path)
        if root.is_dir():
            _remote_workspaces[record.workspace_id] = root


def _remote_audit(event: str, **fields: Any) -> None:
    """Best-effort local audit trail; command contents, tokens and credentials are never recorded."""
    try:
        path = Path.home()/".local"/"share"/"opendrsai"/"remote"/"audit.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists() and path.stat().st_size > 5_000_000:
            os.replace(path, path.with_suffix(".jsonl.1"))
        safe = redact_sensitive({key: value for key, value in fields.items() if key not in {"content", "data"}})
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps({"at": datetime.now().astimezone().isoformat(), "event": event, **safe}, ensure_ascii=False) + "\n")
    except OSError:
        pass


class RemoteHandshakeRequest(BaseModel):
    protocol_version: int = 1
    workspace_path: str
    client_version: str = ""


class RemoteWorkspaceOpenRequest(BaseModel):
    workspace_id: str
    path: str


class RuntimeWorkspaceOpenRequest(BaseModel):
    path: str = Field(min_length=1, max_length=4096)


class RemoteWorktreeRequest(BaseModel):
    intent: str = Field(default="subtask", max_length=240)


class RuntimeSessionCreateRequest(BaseModel):
    workspace_id: str = Field(min_length=1, max_length=160)
    title: str = Field(default="New session", max_length=240)


class RuntimeSessionUpdateRequest(BaseModel):
    title: str | None = Field(default=None, max_length=240)
    archived: bool | None = None


class RuntimeRunCreateRequest(BaseModel):
    agent_definition: str = Field(min_length=1, max_length=500)


class RuntimeRunTransitionRequest(BaseModel):
    status: str


class RuntimeRunExecuteRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=200_000)
    user_id: str | None = Field(default=None, max_length=200)


class BackendAccountLoginRequest(BaseModel):
    type: str = Field(default="chatgpt", pattern=r"^(chatgpt|chatgptDeviceCode)$")


class BackendAccountLoginCancelRequest(BaseModel):
    login_id: str = Field(min_length=1, max_length=256)


class RuntimeEventAppendRequest(BaseModel):
    type: str = Field(min_length=1, max_length=160)
    data: dict[str, Any] = Field(default_factory=dict)


class RuntimeApprovalRequest(BaseModel):
    request: dict[str, Any]
    deadline_at: str | None = None


class RuntimeApprovalDecisionRequest(BaseModel):
    decision: str
    detail: dict[str, Any] = Field(default_factory=dict)


class RuntimeCheckpointStateRequest(BaseModel):
    state: dict[str, Any]


class WorkspacePermissionRequest(BaseModel):
    principal_id: str = Field(min_length=1, max_length=200)
    role: str = Field(pattern=r"^(owner|editor|viewer|denied)$")


class SecurityApprovalDecisionRequest(BaseModel):
    decision: str = Field(pattern=r"^(approved|denied)$")


class RemoteGitFileRequest(BaseModel):
    path: str
    expected_diff_hash: str
    patch: str | None = None
    staged: bool = False


class RemoteGitCommitRequest(BaseModel):
    message: str = Field(min_length=1, max_length=240)
    body: str | None = Field(default=None, max_length=10000)


class RemoteGitPushRequest(BaseModel):
    remote: str = Field(default="origin", pattern=r"^[A-Za-z0-9_.-]{1,120}$")
    refspec: str = Field(default="HEAD", pattern=r"^[A-Za-z0-9_./:@{}^~+*-]{1,300}$")


class RemoteFileWriteRequest(BaseModel):
    path: str = Field(min_length=1, max_length=4096)
    content_base64: str = Field(max_length=16_000_000)
    expected_sha256: str | None = Field(default=None, pattern=r"^[a-fA-F0-9]{64}$")


class RemoteCheckpointRequest(BaseModel):
    label: str | None = None
    maxFiles: int | None = None
    maxBytesPerFile: int | None = None
    kind: str | None = None
    runId: str | None = None


class RemoteCheckpointActionRequest(BaseModel):
    checkpointId: str
    maxFiles: int | None = None
    maxCharsPerFile: int | None = None


def _canonical_workspace(path: str) -> Path:
    try:
        return canonical_workspace(path)
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _workspace_root(workspace_id: str) -> Path:
    root = _remote_workspaces.get(workspace_id)
    if root is None:
        record = _runtime_registry().get_workspace(workspace_id)
        if record and Path(record.path).is_dir():
            root = Path(record.path)
            _remote_workspaces[workspace_id] = root
    if root is None:
        raise HTTPException(status_code=404, detail="Workspace is not open")
    return root


def _workspace_child(workspace_id: str, path: str) -> Path:
    root = _workspace_root(workspace_id)
    try:
        return workspace_child(root, path)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail="Path escapes the workspace") from exc
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.middleware("http")
async def authenticate_desktop_gateway(request: Request, call_next):
    supplied_correlation = request.headers.get("x-correlation-id", "")
    correlation_id = supplied_correlation if re.fullmatch(r"[A-Za-z0-9._:-]{1,128}", supplied_correlation) else uuid.uuid4().hex
    request.state.correlation_id = correlation_id
    if not verify_gateway_instance(request.headers.get("x-opendrsai-gateway-token")):
        return JSONResponse(
            status_code=401,
            content={"error": {"code": "gateway_unauthorized", "message": "Gateway caller is not authorized.", "retryable": False, "correlation_id": correlation_id}},
            headers={"X-Correlation-ID": correlation_id},
        )
    response = await call_next(request)
    response.headers["X-Correlation-ID"] = correlation_id
    return response


def _protocol_error(
    request: Request,
    status: int,
    code: str,
    message: str,
    retryable: bool = False,
    detail: dict[str, Any] | None = None,
) -> JSONResponse:
    correlation_id = getattr(request.state, "correlation_id", uuid.uuid4().hex)
    error: dict[str, Any] = {"code": code, "message": message, "retryable": retryable, "correlation_id": correlation_id}
    if detail:
        error["detail"] = detail
    return JSONResponse(
        status_code=status,
        content={"error": error},
        headers={"X-Correlation-ID": correlation_id},
    )


@app.exception_handler(HTTPException)
async def remote_http_error(request: Request, exc: HTTPException):
    if isinstance(exc.detail, dict) and isinstance(exc.detail.get("code"), str):
        return _protocol_error(
            request,
            exc.status_code,
            exc.detail["code"],
            str(exc.detail.get("message") or "Runtime request failed."),
            bool(exc.detail.get("retryable", False)),
            exc.detail.get("detail") if isinstance(exc.detail.get("detail"), dict) else None,
        )
    return _protocol_error(request, exc.status_code, f"http_{exc.status_code}", str(exc.detail), exc.status_code in {408, 429, 502, 503, 504})


@app.exception_handler(RequestValidationError)
async def remote_validation_error(request: Request, exc: RequestValidationError):
    return _protocol_error(request, 422, "request_validation_failed", "Remote Gateway request validation failed.")





# ââ Health âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ



@app.get("/health")

async def health():

    """Health check endpoint. Desktop polls this to detect API readiness."""

    return await manager.health()


@app.get("/v1/runtime")
async def runtime_identity():
    registry = _runtime_registry()
    try:
        from drsai.version import __version__ as runtime_version
    except Exception:
        runtime_version = "unknown"
    return {
        "runtime_id": registry.identity.runtime_id,
        "instance_id": registry.identity.instance_id,
        "version": runtime_version,
        "protocol_version": _REMOTE_PROTOCOL_VERSION,
        "platform": sys.platform,
    }


@app.get("/v1/capabilities")
async def runtime_capabilities():
    return {
        "protocol_version": _REMOTE_PROTOCOL_VERSION,
        "capabilities": sorted(_REMOTE_CAPABILITY_VERSIONS),
        "capability_versions": _REMOTE_CAPABILITY_VERSIONS,
        "agent_backends": await _runtime_agent_service().health(),
    }


def _backend_account_http_error(exc: RuntimeExecutionError) -> HTTPException:
    status = 404 if exc.code == "agent_backend_not_found" else 503 if exc.retryable or exc.code in {
        "codex_backend_unavailable", "codex_app_server_start_failed", "codex_connection_eof",
    } else 409
    return HTTPException(status_code=status, detail=exc.as_dict())


@app.get("/v1/agent-backends/{backend_id}/account")
async def runtime_backend_account_status(backend_id: str, refresh: bool = False):
    try:
        return await _runtime_agent_service().backend_account_status(backend_id, refresh=refresh)
    except RuntimeExecutionError as exc:
        raise _backend_account_http_error(exc) from exc


@app.post("/v1/agent-backends/{backend_id}/account/login")
async def runtime_backend_account_login(backend_id: str, request: BackendAccountLoginRequest):
    try:
        return await _runtime_agent_service().backend_account_login_start(backend_id, request.type)
    except RuntimeExecutionError as exc:
        raise _backend_account_http_error(exc) from exc


@app.post("/v1/agent-backends/{backend_id}/account/login/cancel")
async def runtime_backend_account_login_cancel(backend_id: str, request: BackendAccountLoginCancelRequest):
    try:
        await _runtime_agent_service().backend_account_login_cancel(backend_id, request.login_id)
        return {"cancelled": True}
    except RuntimeExecutionError as exc:
        raise _backend_account_http_error(exc) from exc


@app.post("/v1/agent-backends/{backend_id}/account/logout")
async def runtime_backend_account_logout(backend_id: str):
    try:
        await _runtime_agent_service().backend_account_logout(backend_id)
        return {"logged_out": True}
    except RuntimeExecutionError as exc:
        raise _backend_account_http_error(exc) from exc


@app.websocket("/v1/pty")
async def remote_pty_socket(websocket: WebSocket):
    await websocket.accept()
    try: authentication = await asyncio.wait_for(websocket.receive_json(), timeout=5)
    except (asyncio.TimeoutError, WebSocketDisconnect): await websocket.close(code=4401); return
    if authentication.get("type") != "auth" or not verify_gateway_instance(authentication.get("token")):
        await websocket.close(code=4401); return
    if sys.platform == "win32":
        await websocket.close(code=4400, reason="Remote PTY requires Linux"); return
    from drsai.backend.remote_pty import manager as pty_manager
    authorized_pty_scope: tuple[str, str, str] | None = None
    if _security_enabled():
        try:
            auth = context_from_bearer(str(authentication.get("authorization") or ""), str(authentication.get("principal_id") or ""))
            principal = RuntimePrincipal.from_platform_auth(auth)
            workspace_id = str(authentication.get("workspace_id") or "")
            identity = _runtime_registry().identity
            operation_context = OperationContext(
                principal.principal_id,
                identity.runtime_id,
                workspace_id,
                str(authentication.get("session_id") or ""),
                str(authentication.get("run_id") or ""),
                str(authentication.get("tool_id") or ""),
                str(authentication.get("correlation_id") or ""),
            )
            _runtime_security().authorize(
                principal,
                "pty.execute",
                operation_context,
                {"cwd": str(authentication.get("cwd") or "."), "shell": str(authentication.get("shell") or "default")},
                str(authentication.get("approval_id") or "") or None,
            )
            authorized_pty_scope = (workspace_id, str(authentication.get("cwd") or "."), str(authentication.get("shell") or "default"))
        except ApprovalRequired as exc:
            await websocket.send_json({"type": "approval_required", "approval_id": exc.approval_id}); await websocket.close(code=4428); return
        except (ValueError, SecurityError):
            await websocket.close(code=4403); return
    attached = None

    async def send(message: dict):
        await websocket.send_json(message)

    try:
        while True:
            message = await websocket.receive_json(); operation = message.get("type")
            if operation == "create":
                workspace_id = str(message.get("workspaceId") or ""); root = _workspace_root(workspace_id)
                if authorized_pty_scope and (workspace_id, str(message.get("cwd") or "."), str(message.get("shell") or "default")) != authorized_pty_scope:
                    raise PermissionError("PTY create scope differs from approved operation")
                raw_cwd = str(message.get("cwd") or str(root)); cwd = _workspace_child(workspace_id, raw_cwd)
                if not cwd.is_dir(): raise ValueError("PTY cwd must be a directory")
                session = pty_manager.create(workspace_id, root, cwd, int(message.get("cols") or 100), int(message.get("rows") or 30), message.get("shell"))
                session.listeners.add(send); attached = session.id
                _remote_audit("pty.create", workspace_id=workspace_id, session_id=session.id, cwd=session.cwd)
                await send({"type": "created", "id": session.id, "pid": session.pid, "cwd": session.cwd, "shell": session.shell, "buffer": "", "bufferTruncated": False})
            elif operation == "attach":
                session = pty_manager.sessions[str(message.get("id"))]
                session.listeners.add(send); attached = session.id
                _remote_audit("pty.attach", workspace_id=session.workspace_id, session_id=session.id)
                await send({"type": "attached", "id": session.id, "pid": session.pid, "cwd": session.cwd, "shell": session.shell, "buffer": bytes(session.buffer).decode("utf-8", "replace"), "bufferTruncated": session.buffer_truncated, "exited": session.exited})
            elif operation == "write":
                data = str(message.get("data") or ""); pty_manager.write(str(message.get("id")), data); _remote_audit("pty.write", session_id=str(message.get("id")), byte_count=len(data.encode("utf-8"))); await send({"type": "written", "id": str(message.get("id")), "byteCount": len(data.encode("utf-8"))})
            elif operation == "resize":
                cols=int(message.get("cols") or 100); rows=int(message.get("rows") or 30); pty_manager.resize(str(message.get("id")), cols, rows); _remote_audit("pty.resize", session_id=str(message.get("id")), cols=cols, rows=rows); await send({"type": "resized", "id": str(message.get("id")), "cols": max(20, min(cols, 500)), "rows": max(5, min(rows, 200))})
            elif operation == "kill":
                killed_id = str(message.get("id")); await send({"type": "killed", "id": killed_id}); pty_manager.kill(killed_id); _remote_audit("pty.kill", session_id=killed_id)
            else: await send({"type": "error", "message": "Unknown PTY operation"})
    except (WebSocketDisconnect, KeyError):
        pass
    finally:
        if attached and attached in pty_manager.sessions: pty_manager.sessions[attached].listeners.discard(send)


@app.post("/v1/remote/handshake")
async def remote_handshake(req: RemoteHandshakeRequest):
    try:
        ensure_protocol(req.protocol_version)
    except ValueError:
        raise HTTPException(status_code=409, detail="Remote protocol version is incompatible")
    root = _canonical_workspace(req.workspace_path)
    try:
        from drsai.version import __version__ as gateway_version
    except Exception:
        gateway_version = "unknown"
    return {
        "runtime_id": _runtime_registry().identity.runtime_id,
        "instance_id": _runtime_registry().identity.instance_id,
        "protocol_version": _REMOTE_PROTOCOL_VERSION,
        "gateway_version": gateway_version,
        "platform": sys.platform,
        "workspace_path": str(root),
        "capabilities": sorted(_REMOTE_CAPABILITY_VERSIONS),
        "capability_versions": _REMOTE_CAPABILITY_VERSIONS,
    }


@app.post("/v1/workspaces")
async def runtime_workspace_open(req: RuntimeWorkspaceOpenRequest, raw_request: Request):
    principal = _principal_from_request(raw_request) if _security_enabled() else None
    try:
        record = _runtime_registry().open_workspace(req.path)
    except (FileNotFoundError, OSError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    root = Path(record.path)
    _remote_workspaces[record.workspace_id] = root
    if principal:
        _runtime_security().permissions.set_role(record.workspace_id, principal.principal_id, "owner")
    _remote_audit("workspace.open", workspace_id=record.workspace_id, path=record.path)
    return record.as_dict()


@app.put("/v1/workspaces/{workspace_id}/permissions")
async def runtime_workspace_permission_set(workspace_id: str, request: WorkspacePermissionRequest, raw_request: Request):
    _authorize_request(raw_request, workspace_id, "permission.manage", {"target_principal_id": request.principal_id, "role": request.role})
    _runtime_security().permissions.set_role(workspace_id, request.principal_id, request.role)
    return {"workspace_id": workspace_id, "principal_id": request.principal_id, "role": request.role}


@app.get("/v1/workspaces/{workspace_id}/permissions/me")
async def runtime_workspace_permission_me(workspace_id: str, raw_request: Request):
    principal = _principal_from_request(raw_request)
    return {"workspace_id": workspace_id, "principal_id": principal.principal_id, "role": _runtime_security().permissions.role(workspace_id, principal.principal_id)}


@app.post("/v1/security/approvals/{approval_id}/decision")
async def runtime_security_approval_decide(approval_id: str, request: SecurityApprovalDecisionRequest, raw_request: Request):
    principal = _principal_from_request(raw_request)
    try:
        approval = _runtime_security().approvals.get(approval_id)
        if approval["principal_id"] != principal.principal_id and not _runtime_security().permissions.allowed(approval["workspace_id"], principal.principal_id, "permission.manage"):
            raise SecurityError("permission_denied", "Approval decision is not permitted.")
        _runtime_security().approvals.decide(approval_id, request.decision)
    except SecurityError as exc:
        raise HTTPException(status_code=403, detail={"code": exc.code, "message": exc.message, "retryable": False}) from exc
    return {"approval_id": approval_id, "decision": request.decision}


@app.get("/v1/security/audit")
async def runtime_security_audit(workspace_id: str, raw_request: Request):
    _authorize_request(raw_request, workspace_id, "permission.manage", {"operation": "audit.read"})
    return {"data": [row for row in _runtime_security().audit.list() if row["context"]["workspace_id"] == workspace_id]}


@app.get("/v1/workspaces")
async def runtime_workspace_list(include_closed: bool = False):
    return {"data": [record.as_dict() for record in _runtime_registry().list_workspaces(include_closed=include_closed)]}


@app.post("/v1/sessions")
async def runtime_session_create(request: RuntimeSessionCreateRequest):
    try:
        return _runtime_engine().create_session(request.workspace_id, request.title)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/v1/sessions")
async def runtime_session_list(workspace_id: str, offset: int = Query(default=0, ge=0), limit: int = Query(default=50, ge=1, le=200), archived: bool | None = False):
    return _runtime_engine().list_sessions(workspace_id, offset=offset, limit=limit, archived=archived)


@app.get("/v1/sessions/{session_id}")
async def runtime_session_get(session_id: str):
    try:
        return _runtime_engine().get_session(session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.patch("/v1/sessions/{session_id}")
async def runtime_session_update(session_id: str, request: RuntimeSessionUpdateRequest):
    try:
        return _runtime_engine().update_session(session_id, title=request.title, archived=request.archived)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/v1/sessions/{session_id}/runs")
async def runtime_run_create(session_id: str, request: RuntimeRunCreateRequest, http_request: Request):
    try:
        state_root = Path(os.environ.get("DRSAI_HOME", str(Path.home() / ".drsai"))).expanduser()
        definition = AgentDefinitionStore(state_root / "assets" / "agents").load(request.agent_definition)
        run, created = _runtime_engine().create_run(
            session_id,
            request.agent_definition,
            http_request.headers.get("idempotency-key", ""),
            definition.backend,
        )
        return JSONResponse(status_code=201 if created else 200, content=run)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeExecutionError as exc:
        raise HTTPException(status_code=400, detail=exc.as_dict()) from exc


@app.get("/v1/runs/{run_id}")
async def runtime_run_get(run_id: str):
    try:
        return _runtime_engine().get_run(run_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/v1/runs/{run_id}/transition")
async def runtime_run_transition(run_id: str, request: RuntimeRunTransitionRequest):
    try:
        return _runtime_engine().transition_run(run_id, request.status)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post("/v1/runs/{run_id}/execute")
async def runtime_run_execute(run_id: str, request: RuntimeRunExecuteRequest, raw_request: Request):
    auth_context = None
    if raw_request.headers.get("x-opendrsai-auth-mode") == "oidc":
        try:
            auth_context = context_from_bearer(raw_request.headers.get("authorization"), request.user_id or "")
        except ValueError as exc:
            code = str(exc)
            raise HTTPException(
                status_code=403 if code == "subject_mismatch" else 401,
                detail={"code": code, "message": "The HepAI authentication context is not valid.", "retryable": code == "token_expired"},
            ) from exc
    run_record = _runtime_engine().get_run(run_id)
    _authorize_request(raw_request, str(run_record["workspace_id"]), "run.execute", {"run_id": run_id})
    try:
        correlation_id = str(getattr(raw_request.state, "correlation_id", "")) or None
        _runtime_engine().append_event(run_id, "trace.request.accepted", {"correlation_id": correlation_id, "run_id": run_id})
        return await _runtime_agent_service(auth_context).execute(run_id, request.prompt, correlation_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RuntimeExecutionError as exc:
        status = 401 if exc.code in {"token_expired", "model_unauthorized"} else 403 if exc.code == "permission_denied" else 409
        raise HTTPException(status_code=status, detail=exc.as_dict()) from exc


@app.post("/v1/runs/{run_id}/cancel")
async def runtime_run_cancel(run_id: str):
    try:
        return await _runtime_agent_service().cancel(run_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post("/v1/runs/{run_id}/events")
async def runtime_event_append(run_id: str, request: RuntimeEventAppendRequest):
    try:
        return _runtime_engine().append_event(run_id, request.type, request.data)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/v1/runs/{run_id}/events")
async def runtime_event_list(run_id: str, after_sequence: int = Query(default=0, ge=0), limit: int = Query(default=500, ge=1, le=2000)):
    return {"data": _runtime_engine().list_events(run_id, after_sequence=after_sequence, limit=limit)}


@app.get("/v1/runs/{run_id}/diagnostics")
async def runtime_run_diagnostics(run_id: str, raw_request: Request):
    try:
        run = _runtime_engine().get_run(run_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    _authorize_request(raw_request, str(run["workspace_id"]), "workspace.read", {"run_id": run_id, "operation": "diagnostics.export"})
    events = _runtime_engine().list_events(run_id, after_sequence=0, limit=2000)
    correlations = sorted({str(event.get("data", {}).get("correlation_id")) for event in events if event.get("data", {}).get("correlation_id")})
    audit = [row for row in _runtime_security().audit.list() if row["context"].get("run_id") == run_id or row["context"].get("correlation_id") in correlations]
    bundle = redact_sensitive({
        "schema_version": 1,
        "runtime": _runtime_registry().identity.__dict__,
        "run": run,
        "trace": {"correlation_ids": correlations, "events": events, "audit": audit},
        "metrics": {"event_count": len(events), "audit_count": len(audit), "terminal": run["status"] in {"completed", "cancelled", "failed"}},
    })
    serialized = json.dumps(bundle, ensure_ascii=False)
    unsafe = bool(re.search(r"-----BEGIN [^-]*PRIVATE KEY-----|(?i:Bearer\s+(?!\[REDACTED\])\S+)|(?i:(?:password|secret|token|api[_-]?key)\s*[:=]\s*(?!\[REDACTED\])\S+)", serialized))
    if unsafe:
        raise HTTPException(status_code=500, detail="Diagnostic bundle secret scan failed")
    return {**bundle, "secret_scan": "passed"}


@app.post("/v1/runs/{run_id}/approvals")
async def runtime_approval_request(run_id: str, request: RuntimeApprovalRequest):
    try:
        return _runtime_engine().request_approval(run_id, request.request, request.deadline_at)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post("/v1/approvals/{approval_id}/decision")
async def runtime_approval_decision(approval_id: str, request: RuntimeApprovalDecisionRequest):
    try:
        return _runtime_engine().resolve_approval(approval_id, request.decision, request.detail)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post("/v1/runs/{run_id}/approvals/{approval_id}/decision")
async def runtime_backend_approval_decision(run_id: str, approval_id: str, request: RuntimeApprovalDecisionRequest):
    try:
        await _runtime_agent_service().respond_approval(run_id, approval_id, request.decision)
        return {"run_id": run_id, "approval_id": approval_id, "decision": request.decision}
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RuntimeExecutionError as exc:
        raise HTTPException(status_code=409, detail=exc.as_dict()) from exc


@app.post("/v1/runs/{run_id}/checkpoint")
async def runtime_checkpoint_save(run_id: str, request: RuntimeCheckpointStateRequest):
    try:
        return _runtime_engine().save_checkpoint(run_id, request.state)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/v1/runs/{run_id}/checkpoint")
async def runtime_checkpoint_latest(run_id: str):
    checkpoint = _runtime_engine().latest_checkpoint(run_id)
    if checkpoint is None:
        raise HTTPException(status_code=404, detail="Runtime Checkpoint not found")
    return checkpoint


@app.post("/v1/workspaces/open")
async def remote_workspace_open(req: RemoteWorkspaceOpenRequest):
    if not re.fullmatch(r"[A-Za-z0-9_.:-]{1,160}", req.workspace_id):
        raise HTTPException(status_code=400, detail="Invalid workspace id")
    root = _canonical_workspace(req.path)
    _remote_workspaces[req.workspace_id] = root
    return {"workspace_id": req.workspace_id, "path": str(root)}


@app.get("/v1/workspaces/{workspace_id}")
async def remote_workspace_info(workspace_id: str):
    root = _workspace_root(workspace_id)
    record = _runtime_registry().get_workspace(workspace_id, include_closed=True)
    return {"workspace_id": workspace_id, "path": str(root), "exists": root.is_dir(), **(record.as_dict() if record else {})}


@app.delete("/v1/workspaces/{workspace_id}")
async def runtime_workspace_close(workspace_id: str):
    record = _runtime_registry().close_workspace(workspace_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Workspace is not registered")
    _remote_workspaces.pop(workspace_id, None)
    _remote_audit("workspace.close", workspace_id=workspace_id)
    return record.as_dict()


@app.get("/v1/workspaces/{workspace_id}/context")
async def remote_workspace_context(workspace_id: str):
    root = _workspace_root(workspace_id); instructions = []
    for name in ("AGENTS.md", "DRSAI.md", "CLAUDE.md", "project.md"):
        path = root/name
        if path.is_file():
            raw = path.read_text("utf-8", errors="replace"); instructions.append({"name": name, "path": str(path), "content": raw[:8000], "truncated": len(raw) > 8000})
    completed = subprocess.run(["git", "-C", str(root), "status", "--porcelain=v1", "--branch"], capture_output=True, text=True, timeout=10, check=False)
    changed = []
    if completed.returncode == 0:
        for line in completed.stdout.splitlines()[1:]:
            if len(line) >= 4: changed.append({"path": line[3:], "status": "untracked" if line[:2] == "??" else "deleted" if "D" in line[:2] else "added" if "A" in line[:2] else "modified"})
    return {"workspacePath": str(root), "trusted": True, "git": {"hasChanges": bool(changed), "changedFiles": changed}, "instructions": instructions, "stats": {"instructionCount": len(instructions), "changedFileCount": len(changed)}}


@app.post("/v1/workspaces/{workspace_id}/worktrees")
async def remote_workspace_worktree_create(workspace_id: str, request: RemoteWorktreeRequest):
    root = _workspace_root(workspace_id)
    repo = subprocess.run(["git", "-C", str(root), "rev-parse", "--show-toplevel"], capture_output=True, text=True, timeout=15, check=False)
    if repo.returncode != 0:
        raise HTTPException(status_code=400, detail="Workspace is not a Git repository")
    repo_root = Path(repo.stdout.strip()).resolve()
    base = subprocess.run(["git", "-C", str(repo_root), "rev-parse", "--short=12", "HEAD"], capture_output=True, text=True, timeout=15, check=False)
    if base.returncode != 0:
        raise HTTPException(status_code=400, detail=base.stderr.strip() or "Unable to resolve the current Git commit")
    status = subprocess.run(["git", "-C", str(repo_root), "status", "--porcelain=v1"], capture_output=True, text=True, timeout=15, check=False)
    slug = re.sub(r"[^a-z0-9]+", "-", request.intent.lower()).strip("-")[:40] or "subtask"
    suffix = uuid.uuid4().hex[:8]
    branch = f"drsai/fork/{slug}-{suffix}"
    state_root = Path(os.environ.get("DRSAI_HOME", str(Path.home() / ".drsai"))).expanduser()
    worktree_path = state_root / "runtime" / "worktrees" / workspace_id / f"{slug}-{suffix}"
    worktree_path.parent.mkdir(parents=True, exist_ok=True)
    created = subprocess.run(["git", "-C", str(repo_root), "worktree", "add", "-b", branch, str(worktree_path), "HEAD"], capture_output=True, text=True, timeout=30, check=False)
    if created.returncode != 0:
        raise HTTPException(status_code=400, detail=created.stderr.strip() or "Unable to create an isolated Git worktree")
    record = _runtime_registry().open_workspace(str(worktree_path))
    _remote_audit("workspace.worktree.create", workspace_id=record.workspace_id, parent_workspace_id=workspace_id, path=record.path)
    return {
        "workspace_id": record.workspace_id,
        "source_workspace_path": str(root),
        "repo_root": str(repo_root),
        "worktree_path": record.path,
        "branch": branch,
        "base_ref": base.stdout.strip(),
        "source_has_changes": bool(status.stdout.strip()),
        "source_status_summary": status.stdout.strip()[:2000] or None,
        "location": "remote",
        "transport": "ssh",
    }


@app.get("/v1/workspaces/{workspace_id}/directories")
async def remote_workspace_directories(workspace_id: str, path: str = "."):
    directory = _workspace_child(workspace_id, path)
    if not directory.is_dir():
        raise HTTPException(status_code=400, detail="Path must be a directory")
    rows = []
    for entry in directory.iterdir():
        try:
            resolved = entry.resolve(strict=True)
            resolved.relative_to(_workspace_root(workspace_id))
        except (OSError, ValueError):
            continue
        if resolved.is_dir():
            rows.append({"name": entry.name, "path": str(resolved), "directory": True})
    return {"data": sorted(rows, key=lambda item: item["name"].lower())}


@app.get("/v1/workspaces/{workspace_id}/files")
async def remote_workspace_files(workspace_id: str, raw_request: Request, path: str = ".", depth: int = Query(default=2, ge=0, le=5), query: str = "", offset: int = Query(default=0, ge=0), max_entries: int = Query(default=500, ge=1, le=5000)):
    _authorize_request(raw_request, workspace_id, "workspace.read", {"path": path})
    root = _workspace_root(workspace_id)
    start = _workspace_child(workspace_id, path)
    if not start.is_dir():
        raise HTTPException(status_code=400, detail="Path must be a directory")

    matched: list[dict[str, Any]] = []
    git_statuses: dict[str, str] = {}
    completed = subprocess.run(["git", "-C", str(root), "status", "--porcelain=v1", "--untracked-files=all"], capture_output=True, text=True, timeout=10, check=False)
    if completed.returncode == 0:
        for line in completed.stdout.splitlines():
            if len(line) < 4: continue
            code, changed_path = line[:2], line[3:]
            if " -> " in changed_path: changed_path = changed_path.split(" -> ", 1)[1]
            changed_path = changed_path.strip('"').replace("\\", "/")
            git_statuses[changed_path] = "untracked" if code == "??" else "renamed" if "R" in code else "deleted" if "D" in code else "added" if "A" in code else "modified"

    ignored_directories = {".git", ".hg", ".svn", "node_modules", ".venv", "__pycache__", ".mypy_cache", ".pytest_cache"}
    try:
        ignore_patterns = [line.strip() for line in (root / ".gitignore").read_text("utf-8", errors="replace").splitlines() if line.strip() and not line.lstrip().startswith("#")]
    except OSError:
        ignore_patterns = []
    scanned = 0
    scan_limit = min(50_000, max(5_000, offset + max_entries + 1_000))
    scan_truncated = False

    def ignored(relative_path: str, directory: bool) -> bool:
        parts = Path(relative_path).parts
        if any(part in ignored_directories for part in parts):
            return True
        normalized = relative_path.replace("\\", "/")
        for raw_pattern in ignore_patterns:
            negate = raw_pattern.startswith("!")
            pattern = raw_pattern[1:] if negate else raw_pattern
            directory_only = pattern.endswith("/")
            pattern = pattern.rstrip("/")
            if directory_only and not directory:
                continue
            if fnmatch(normalized, pattern) or fnmatch(Path(normalized).name, pattern) or fnmatch(normalized, f"*/{pattern}"):
                if not negate:
                    return True
        return False

    def visit(directory: Path, remaining: int) -> list[dict[str, Any]]:
        nonlocal scanned, scan_truncated
        result = []
        for entry in sorted(directory.iterdir(), key=lambda item: (not item.is_dir(), item.name.lower())):
            if scanned >= scan_limit:
                scan_truncated = True
                break
            try:
                resolved = entry.resolve(strict=True)
                resolved.relative_to(root)
            except (OSError, ValueError):
                continue
            relative_path = str(resolved.relative_to(root)).replace("\\", "/")
            if ignored(relative_path, resolved.is_dir()):
                continue
            scanned += 1
            stat = resolved.stat()
            item = {"name": entry.name, "path": relative_path, "directory": resolved.is_dir(), "size": stat.st_size, "modified_at": stat.st_mtime}
            if resolved.is_dir() and remaining > 0:
                item["children"] = visit(resolved, remaining - 1)
                descendant = next((status for changed, status in git_statuses.items() if changed == relative_path or changed.startswith(relative_path + "/")), None)
                if descendant: item["git_status"] = descendant
            elif relative_path in git_statuses:
                item["git_status"] = git_statuses[relative_path]
            result.append(item)
        return result

    tree = visit(start, depth)
    needle = query.casefold().strip()
    def collect(rows: list[dict[str, Any]]) -> None:
        for row in rows:
            if not needle or needle in row["path"].casefold():
                matched.append({key: value for key, value in row.items() if key != "children"})
            collect(row.get("children", []))
    collect(tree)
    page = matched[offset:offset + max_entries]
    truncated = scan_truncated or offset + len(page) < len(matched)
    return {"workspace_id": workspace_id, "data": page if needle or offset or len(matched) > max_entries else tree, "total": len(matched), "offset": offset, "next_offset": offset + len(page) if truncated and len(page) else None, "truncated": truncated, "scan_limit": scan_limit}


@app.get("/v1/workspaces/{workspace_id}/file")
async def remote_workspace_file(workspace_id: str, raw_request: Request, path: str, max_bytes: int = Query(default=262144, ge=1, le=1048576)):
    _authorize_request(raw_request, workspace_id, "workspace.read", {"path": path})
    target = _workspace_child(workspace_id, path)
    if not target.is_file():
        raise HTTPException(status_code=400, detail="Path must be a file")
    size = target.stat().st_size
    with target.open("rb") as handle:
        raw = handle.read(max_bytes + 1)
    sample = raw[:max_bytes]
    mime = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
    try:
        content = sample.decode("utf-8")
        binary = b"\x00" in sample[:8192]
    except UnicodeDecodeError:
        content = ""
        binary = True
    common = {"path": str(target.relative_to(_workspace_root(workspace_id))).replace("\\", "/"), "mime": mime, "truncated": size > max_bytes, "size": size, "modified_at": target.stat().st_mtime}
    if binary:
        return {**common, "data_url": f"data:{mime};base64,{base64.b64encode(sample).decode('ascii')}", "binary": True, "encoding": None}
    return {**common, "content": content, "binary": False, "encoding": "utf-8"}


def _stream_file_sha256(target: Path) -> str:
    digest = hashlib.sha256()
    with target.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


@app.get("/v1/workspaces/{workspace_id}/file/stream")
async def remote_workspace_file_stream(workspace_id: str, raw_request: Request, path: str, offset: int = Query(default=0, ge=0), length: int = Query(default=1048576, ge=1, le=8388608)):
    _authorize_request(raw_request, workspace_id, "workspace.read", {"path": path, "offset": offset, "length": length})
    target = _workspace_child(workspace_id, path)
    if not target.is_file():
        raise HTTPException(status_code=400, detail="Path must be a file")
    size = target.stat().st_size
    if offset > size:
        raise HTTPException(status_code=416, detail="Offset exceeds file size")
    async def chunks():
        remaining = min(length, size - offset)
        with target.open("rb") as handle:
            handle.seek(offset)
            while remaining:
                block = handle.read(min(65536, remaining))
                if not block: break
                remaining -= len(block)
                yield block
    headers = {"X-File-Size": str(size), "X-File-SHA256": _stream_file_sha256(target), "X-Next-Offset": str(min(size, offset + length))}
    return StreamingResponse(chunks(), media_type=mimetypes.guess_type(target.name)[0] or "application/octet-stream", headers=headers)


@app.put("/v1/workspaces/{workspace_id}/file")
async def remote_workspace_file_write(workspace_id: str, request: RemoteFileWriteRequest, raw_request: Request):
    _authorize_request(raw_request, workspace_id, "file.write", {"path": request.path, "expected_sha256": request.expected_sha256})
    root = _workspace_root(workspace_id)
    try:
        target = (root / request.path).resolve(strict=False)
        target.relative_to(root)
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Path escapes the workspace") from exc
    if not target.parent.is_dir():
        raise HTTPException(status_code=400, detail="Parent directory does not exist")
    current = target.read_bytes() if target.is_file() else b""
    current_hash = hashlib.sha256(current).hexdigest()
    if request.expected_sha256 is not None and current_hash.lower() != request.expected_sha256.lower():
        raise HTTPException(status_code=409, detail={"code": "file_conflict", "message": "File changed since it was read", "current_sha256": current_hash})
    try:
        content = base64.b64decode(request.content_base64, validate=True)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="content_base64 is invalid") from exc
    try:
        SecureWorkspaceFS(root).atomic_write(request.path, content)
    except SecurityError as exc:
        raise HTTPException(status_code=403, detail={"code": exc.code, "message": exc.message, "retryable": False}) from exc
    return {"path": request.path.replace("\\", "/"), "size": len(content), "sha256": hashlib.sha256(content).hexdigest(), "modified_at": time.time()}


_workspace_watch_journals: dict[str, dict[str, Any]] = {}


def _workspace_snapshot(root: Path) -> dict[str, tuple[int, int, int]]:
    rows: dict[str, tuple[int, int, int]] = {}
    for index, candidate in enumerate(root.rglob("*")):
        if index >= 50_000:
            break
        try:
            resolved = candidate.resolve(strict=True)
            resolved.relative_to(root)
            relative = str(resolved.relative_to(root)).replace("\\", "/")
            if resolved.is_file() and not any(part in {".git", "node_modules", ".venv", "__pycache__"} for part in Path(relative).parts):
                stat = resolved.stat()
                rows[relative] = (stat.st_mtime_ns, stat.st_size, getattr(stat, "st_ino", 0))
        except (OSError, ValueError):
            continue
    return rows


def _workspace_watch_scan(workspace_id: str, root: Path) -> dict[str, Any]:
    current = _workspace_snapshot(root)
    state = _workspace_watch_journals.setdefault(workspace_id, {"snapshot": current, "sequence": 0, "events": deque(maxlen=5000)})
    previous = state["snapshot"]
    deleted = set(previous) - set(current)
    created = set(current) - set(previous)
    deleted_by_inode = {previous[path][2]: path for path in deleted if previous[path][2]}
    changes: list[dict[str, Any]] = []
    for path in sorted(created):
        old_path = deleted_by_inode.get(current[path][2]) if current[path][2] else None
        if old_path:
            deleted.discard(old_path)
            changes.append({"path": path, "old_path": old_path, "type": "renamed"})
        else:
            changes.append({"path": path, "type": "created"})
    changes.extend({"path": path, "type": "deleted"} for path in sorted(deleted))
    changes.extend({"path": path, "type": "modified"} for path in sorted(set(previous) & set(current)) if previous[path] != current[path])
    for change in changes:
        state["sequence"] += 1
        state["events"].append({"sequence": state["sequence"], **change})
    state["snapshot"] = current
    return state


@app.websocket("/v1/workspaces/{workspace_id}/watch")
async def remote_workspace_watch(websocket: WebSocket, workspace_id: str):
    await websocket.accept()
    try: authentication = await asyncio.wait_for(websocket.receive_json(), timeout=5)
    except (asyncio.TimeoutError, WebSocketDisconnect): await websocket.close(code=4401); return
    if authentication.get("type") != "auth" or not verify_gateway_instance(authentication.get("token")):
        await websocket.close(code=4401); return
    root = _workspace_root(workspace_id)
    after_sequence = max(0, int(authentication.get("after_sequence") or 0))
    state = _workspace_watch_scan(workspace_id, root)
    replay = [event for event in state["events"] if event["sequence"] > after_sequence]
    for index in range(0, len(replay), 200):
        batch = replay[index:index + 200]
        await websocket.send_json({"type": "changes", "workspace_id": workspace_id, "changes": batch, "sequence": batch[-1]["sequence"], "replayed": True})
    cursor = state["sequence"]
    await websocket.send_json({"type": "ready", "workspace_id": workspace_id, "sequence": cursor})
    try:
        while True:
            await asyncio.sleep(0.25)
            state = _workspace_watch_scan(workspace_id, root)
            pending = [event for event in state["events"] if event["sequence"] > cursor]
            for index in range(0, len(pending), 200):
                batch = pending[index:index + 200]
                await websocket.send_json({"type": "changes", "workspace_id": workspace_id, "changes": batch, "sequence": batch[-1]["sequence"], "replayed": False})
            if pending:
                cursor = pending[-1]["sequence"]
    except WebSocketDisconnect:
        pass


@app.get("/v1/workspaces/{workspace_id}/folder-summary")
async def remote_workspace_folder_summary(workspace_id: str, path: str = ".", max_entries: int = Query(default=500, ge=1, le=5000), max_sample_files: int = Query(default=20, ge=0, le=100), max_chars: int = Query(default=20000, ge=1000, le=200000)):
    root = _workspace_root(workspace_id); directory = _workspace_child(workspace_id, path)
    if not directory.is_dir(): raise HTTPException(status_code=400, detail="Path must be a directory")
    files = []; directory_count = 0; total = 0; truncated = False
    for candidate in directory.rglob("*"):
        if any(part in {".git", "node_modules", ".venv", "__pycache__"} for part in candidate.relative_to(directory).parts): continue
        total += 1
        if total > max_entries: truncated = True; break
        if candidate.is_dir(): directory_count += 1
        elif candidate.is_file() and len(files) < max_sample_files:
            size = candidate.stat().st_size; relative = str(candidate.relative_to(root)).replace("\\", "/")
            files.append({"path": str(candidate), "relativePath": relative, "kind": "text", "size": size})
    summary = "\n".join(f"- {item['relativePath']} ({item['size']} bytes)" for item in files)[:max_chars]
    return {"path": str(directory), "name": directory.name, "totalEntries": min(total, max_entries), "fileCount": len(files), "directoryCount": directory_count, "skippedDirectoryCount": 0, "truncated": truncated, "estimatedTokens": len(summary) // 4, "sampledFiles": files, "summary": summary}


@app.get("/v1/workspaces/{workspace_id}/git/file-at-ref")
async def remote_workspace_git_file_at_ref(workspace_id: str, raw_request: Request, ref: str, path: str, max_bytes: int = Query(default=262144, ge=1, le=1048576)):
    _authorize_request(raw_request, workspace_id, "workspace.read", {"ref": ref, "path": path})
    root = _workspace_root(workspace_id); target = (root / path).resolve(strict=False)
    try: relative = str(target.relative_to(root)).replace("\\", "/")
    except ValueError as exc: raise HTTPException(status_code=403, detail="Path escapes the workspace") from exc
    if not re.fullmatch(r"[A-Za-z0-9_./@{}^~:+-]{1,200}", ref): raise HTTPException(status_code=400, detail="Invalid Git ref")
    completed = subprocess.run(["git", "-C", str(root), "show", f"{ref}:{relative}"], capture_output=True, timeout=15, check=False)
    if completed.returncode != 0: return {"workspacePath": str(root), "ref": ref, "path": str(target), "content": "", "truncated": False, "missing": True, "message": "File does not exist at ref."}
    raw = completed.stdout; content = raw[:max_bytes].decode("utf-8", errors="replace")
    return {"workspacePath": str(root), "ref": ref, "path": str(target), "content": content, "contentHash": hashlib.sha256(raw).hexdigest(), "truncated": len(raw) > max_bytes, "missing": False, "message": "Remote Git file loaded."}


@app.get("/v1/workspaces/{workspace_id}/git/status")
async def remote_workspace_git_status(workspace_id: str, raw_request: Request):
    _authorize_request(raw_request, workspace_id, "workspace.read", {"operation": "git.status"})
    root = _workspace_root(workspace_id)
    completed = subprocess.run(
        ["git", "-C", str(root), "status", "--porcelain=v1", "-z", "--branch", "--untracked-files=all"],
        capture_output=True,
        timeout=15,
        check=False,
    )
    if completed.returncode != 0:
        raise HTTPException(status_code=400, detail={"code": "git_status_failed", "message": "Git status failed.", "retryable": False})
    parts = completed.stdout.decode("utf-8", "replace").split("\0")
    branch = None
    rows: list[dict[str, Any]] = []
    index = 0
    while index < len(parts) and parts[index]:
        row = parts[index]
        if row.startswith("## "):
            branch = row[3:]
            index += 1
            continue
        code, path = row[:2], row[3:]
        old_path = None
        if "R" in code or "C" in code:
            index += 1
            if index < len(parts):
                old_path = path
                path = parts[index]
        rows.append({
            "path": path.replace("\\", "/"),
            "old_path": old_path.replace("\\", "/") if old_path else None,
            "index_status": code[0],
            "worktree_status": code[1],
            "untracked": code == "??",
            "renamed": "R" in code,
        })
        index += 1
    return {"workspace_id": workspace_id, "branch": branch, "clean": not rows, "entries": rows}


@app.get("/v1/workspaces/{workspace_id}/git/diff")
async def remote_workspace_git_diff(workspace_id: str, raw_request: Request, staged: bool = False, path: str | None = None):
    _authorize_request(raw_request, workspace_id, "workspace.read", {"operation": "git.diff", "path": path, "staged": staged})
    root = _workspace_root(workspace_id)
    args = ["git", "-C", str(root), "diff"] + (["--cached"] if staged else [])
    if path:
        target = _workspace_child(workspace_id, path)
        args += ["--", str(target.relative_to(root))]
    completed = subprocess.run(args, capture_output=True, text=True, timeout=15, check=False)
    if completed.returncode != 0:
        raise HTTPException(status_code=400, detail=completed.stderr.strip() or "Git diff failed")
    return {"workspace_id": workspace_id, "diff": completed.stdout, "diff_hash": hashlib.sha256(completed.stdout.encode()).hexdigest(), "staged": staged}


@app.get("/v1/workspaces/{workspace_id}/checkpoints")
async def remote_workspace_checkpoints(workspace_id: str):
    _workspace_root(workspace_id)
    return {"data": list_checkpoints(workspace_id)}


@app.post("/v1/workspaces/{workspace_id}/checkpoints")
async def remote_workspace_checkpoint_create(workspace_id: str, request: RemoteCheckpointRequest):
    return create_checkpoint(workspace_id, _workspace_root(workspace_id), request.model_dump(exclude_none=True))


@app.post("/v1/workspaces/{workspace_id}/checkpoints/preview")
async def remote_workspace_checkpoint_preview(workspace_id: str, request: RemoteCheckpointActionRequest):
    try:
        return preview_checkpoint(workspace_id, _workspace_root(workspace_id), request.checkpointId, request.maxFiles or 20, request.maxCharsPerFile or 4000)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Checkpoint not found") from exc


@app.post("/v1/workspaces/{workspace_id}/checkpoints/restore")
async def remote_workspace_checkpoint_restore(workspace_id: str, request: RemoteCheckpointActionRequest, raw_request: Request):
    _authorize_request(raw_request, workspace_id, "workspace.restore", {"checkpoint_id": request.checkpointId})
    try:
        return restore_checkpoint(workspace_id, _workspace_root(workspace_id), request.checkpointId)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Checkpoint not found") from exc


@app.post("/v1/workspaces/{workspace_id}/checkpoints/accept")
async def remote_workspace_checkpoint_accept(workspace_id: str, request: RemoteCheckpointActionRequest):
    _workspace_root(workspace_id)
    try:
        return accept_checkpoint(workspace_id, request.checkpointId)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Checkpoint not found") from exc


def _verified_git_diff(workspace_id: str, request: RemoteGitFileRequest) -> tuple[Path, str]:
    root = _workspace_root(workspace_id)
    try:
        target = (root / request.path).resolve(strict=False)
        relative = str(target.relative_to(root)).replace("\\", "/")
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=403, detail="Path escapes the workspace") from exc
    args = ["git", "-C", str(root), "diff"] + (["--cached"] if request.staged else []) + ["--", relative]
    completed = subprocess.run(args, capture_output=True, text=True, timeout=15, check=False)
    if completed.returncode != 0:
        raise HTTPException(status_code=400, detail=completed.stderr.strip() or "Git diff failed")
    actual = hashlib.sha256(completed.stdout.encode()).hexdigest()
    if actual != request.expected_diff_hash:
        raise HTTPException(status_code=409, detail="Git diff changed; refresh before applying the operation")
    return root, relative


@app.post("/v1/workspaces/{workspace_id}/git/stage")
async def remote_workspace_git_stage(workspace_id: str, request: RemoteGitFileRequest, raw_request: Request):
    _authorize_request(raw_request, workspace_id, "git.write", {"operation": "stage", "path": request.path})
    root, relative = _verified_git_diff(workspace_id, request)
    completed = subprocess.run(["git", "-C", str(root), "add", "--", relative], capture_output=True, text=True, timeout=15, check=False)
    if completed.returncode != 0:
        raise HTTPException(status_code=400, detail=completed.stderr.strip() or "Git stage failed")
    return {"workspace_id": workspace_id, "path": relative, "staged": True}


@app.post("/v1/workspaces/{workspace_id}/git/unstage")
async def remote_workspace_git_unstage(workspace_id: str, request: RemoteGitFileRequest, raw_request: Request):
    _authorize_request(raw_request, workspace_id, "git.write", {"operation": "unstage", "path": request.path})
    request.staged = True
    root, relative = _verified_git_diff(workspace_id, request)
    completed = subprocess.run(["git", "-C", str(root), "restore", "--staged", "--", relative], capture_output=True, text=True, timeout=15, check=False)
    if completed.returncode != 0:
        raise HTTPException(status_code=400, detail={"code": "git_unstage_failed", "message": "Git unstage failed.", "retryable": False})
    return {"workspace_id": workspace_id, "path": relative, "staged": False}


@app.post("/v1/workspaces/{workspace_id}/git/commit")
async def remote_workspace_git_commit(workspace_id: str, request: RemoteGitCommitRequest, raw_request: Request):
    _authorize_request(raw_request, workspace_id, "git.write", {"operation": "commit", "message_hash": hashlib.sha256(request.message.encode()).hexdigest()})
    root = _workspace_root(workspace_id); args = ["git", "-C", str(root), "commit", "-m", request.message]
    if request.body and request.body.strip(): args += ["-m", request.body.strip()]
    completed = subprocess.run(args, capture_output=True, text=True, timeout=60, check=False)
    if completed.returncode != 0:
        combined = (completed.stderr.strip() or completed.stdout.strip() or "Git commit failed")[-4000:]
        raise HTTPException(status_code=409, detail={"code": "git_commit_failed", "message": combined, "retryable": False, "detail": {"exit_code": completed.returncode}})
    revision = subprocess.run(["git", "-C", str(root), "rev-parse", "HEAD"], capture_output=True, text=True, timeout=10, check=False).stdout.strip()
    return {"workspace_id": workspace_id, "committed": True, "revision": revision, "exit_code": completed.returncode, "stdout": completed.stdout[-4000:], "stderr": completed.stderr[-4000:]}


@app.post("/v1/workspaces/{workspace_id}/git/push")
async def remote_workspace_git_push(workspace_id: str, request: RemoteGitPushRequest, raw_request: Request):
    _authorize_request(raw_request, workspace_id, "git.push", {"remote": request.remote, "refspec": request.refspec})
    root = _workspace_root(workspace_id)
    completed = subprocess.run(["git", "-C", str(root), "push", "--porcelain", request.remote, request.refspec], capture_output=True, text=True, timeout=120, check=False)
    if completed.returncode != 0:
        raise HTTPException(status_code=409, detail={"code": "git_push_failed", "message": (completed.stderr.strip() or completed.stdout.strip() or "Git push failed")[-4000:], "retryable": False, "detail": {"exit_code": completed.returncode}})
    return {"workspace_id": workspace_id, "pushed": True, "remote": request.remote, "refspec": request.refspec, "stdout": completed.stdout[-4000:], "stderr": completed.stderr[-4000:]}


@app.post("/v1/workspaces/{workspace_id}/git/revert")
async def remote_workspace_git_revert(workspace_id: str, request: RemoteGitFileRequest, raw_request: Request):
    _authorize_request(raw_request, workspace_id, "git.write", {"operation": "revert", "path": request.path})
    root, relative = _verified_git_diff(workspace_id, request)
    tracked = subprocess.run(["git", "-C", str(root), "ls-files", "--error-unmatch", "--", relative], capture_output=True, timeout=10, check=False).returncode == 0
    if tracked:
        completed = subprocess.run(["git", "-C", str(root), "restore", "--worktree", "--", relative], capture_output=True, text=True, timeout=15, check=False)
    else:
        target = _workspace_child(workspace_id, relative)
        target.unlink()
        completed = subprocess.CompletedProcess([], 0, "", "")
    if completed.returncode != 0:
        raise HTTPException(status_code=400, detail=completed.stderr.strip() or "Git revert failed")
    return {"workspace_id": workspace_id, "path": relative, "reverted": True}


@app.post("/v1/workspaces/{workspace_id}/git/{operation}-hunk")
async def remote_workspace_git_hunk(workspace_id: str, operation: str, request: RemoteGitFileRequest, raw_request: Request):
    _authorize_request(raw_request, workspace_id, "git.write", {"operation": f"{operation}-hunk", "path": request.path})
    if operation == "unstage":
        request.staged = True
    root, relative = _verified_git_diff(workspace_id, request)
    if operation not in {"stage", "unstage", "revert"} or not request.patch or len(request.patch) > 1_000_000:
        raise HTTPException(status_code=400, detail="Invalid Git hunk operation")
    args = ["git", "-C", str(root), "apply", "--whitespace=nowarn"]
    if operation == "stage":
        args.append("--cached")
    elif operation == "unstage":
        args.extend(["--cached", "--reverse"])
    else:
        args.append("--reverse")
    completed = subprocess.run(args, input=request.patch, capture_output=True, text=True, timeout=15, check=False)
    if completed.returncode != 0:
        raise HTTPException(status_code=409, detail=completed.stderr.strip() or "Git hunk no longer applies")
    return {"workspace_id": workspace_id, "path": relative, "applied": True, "operation": operation}


@app.get("/v1/hepai/workers")
async def list_hepai_workers():
    """Return configured HepAI worker tools without making workspace access depend on HepAI."""
    try:
        tools, rows = await _load_remote_hepai_tools(force=True)
        _remote_audit("hepai.workers.discovered", worker_count=len(rows), callable_count=sum(len(row.get("callables", [])) for row in rows))
        return {"object": "list", "data": rows, "available": True, "registered_tool_count": len(tools)}
    except Exception as exc:
        _remote_audit("hepai.workers.degraded", error=type(exc).__name__)
        return {"object": "list", "data": [], "available": False, "error": type(exc).__name__}


class HepaiWorkerStateRequest(BaseModel):
    enabled: bool


@app.put("/v1/hepai/workers/{worker_id}/state")
async def set_hepai_worker_state(worker_id: str, request: HepaiWorkerStateRequest):
    global _remote_hepai_cache
    if not re.fullmatch(r"[A-Za-z0-9_.:/-]{1,200}", worker_id): raise HTTPException(status_code=400, detail="Invalid Worker id")
    path = Path.home()/".local"/"share"/"opendrsai"/"remote"/"hepai-workers.json"; path.parent.mkdir(parents=True, exist_ok=True)
    try: config = json.loads(path.read_text("utf-8"))
    except (OSError, ValueError): config = {}
    config[worker_id] = request.enabled; path.write_text(json.dumps(config, indent=2), "utf-8")
    _remote_hepai_cache = (0.0, [], [])
    _remote_audit("hepai.worker.state", worker_id=worker_id, enabled=request.enabled)
    await manager.evict_user(_get_user_id())
    return {"id": worker_id, "enabled": request.enabled}





# ââ Models âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ



@app.get("/v1/models")

async def list_models():

    """List available models. OpenAI-compatible format."""

    models = await manager.list_models()

    return {"object": "list", "data": models}


@app.post("/v1/audio/transcriptions")
async def audio_transcriptions(
    file: UploadFile = File(...),
    model: str = Form("whisper-1"),
    language: Optional[str] = Form(None),
):
    """Proxy bounded speech transcription requests to the configured provider."""
    api_key = os.environ.get("HEPAI_API_KEY", "").strip() or os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(status_code=401, detail="A transcription provider API key is required.")
    audio = await file.read(10 * 1024 * 1024 + 1)
    if not audio:
        raise HTTPException(status_code=400, detail="The uploaded audio file is empty.")
    if len(audio) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="The uploaded audio exceeds the 10 MB limit.")
    base_url = os.environ.get("OPENAI_BASE_URL", "https://aiapi.ihep.ac.cn/apiv2").rstrip("/")
    data = {"model": model}
    if language:
        data["language"] = language
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                f"{base_url}/audio/transcriptions",
                headers={"Authorization": f"Bearer {api_key}"},
                data=data,
                files={"file": (file.filename or "recording.webm", audio, file.content_type or "application/octet-stream")},
            )
    except httpx.TimeoutException as exc:
        raise HTTPException(status_code=504, detail="The transcription provider timed out.") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="The transcription provider is unreachable.") from exc
    try:
        payload = response.json()
    except ValueError as exc:
        raise HTTPException(status_code=502, detail="The transcription provider returned invalid JSON.") from exc
    if response.status_code >= 400:
        detail = payload.get("error", {}).get("message") if isinstance(payload.get("error"), dict) else payload.get("detail")
        raise HTTPException(status_code=response.status_code, detail=detail or "The transcription provider rejected the request.")
    text = payload.get("text") if isinstance(payload, dict) else None
    if not isinstance(text, str):
        raise HTTPException(status_code=502, detail="The transcription provider response omitted text.")
    return {
        "text": text,
        "language": payload.get("language") or language,
        "confidence": payload.get("confidence"),
    }


@app.get("/v1/config/model-catalog")
async def get_model_catalog():
    """Return the default model catalog for desktop setup UI."""
    llm_config = await asyncio.to_thread(load_llm_mode_config, None)
    return build_model_catalog(llm_config)


# ── Model Config CRUD helpers ────────────────────────────────────────────────

def _get_live_llm_config() -> tuple[dict[str, ModelEntry], str]:
    """Get current llm config + default_alias, resolving file path."""
    config_path = get_llm_config_file_path()
    llm_config = load_llm_mode_config(config_path)
    default_alias = _get_default_model_alias()
    if config_path:
        import yaml
        try:
            raw = yaml.safe_load(Path(config_path).read_text(encoding="utf-8")) or {}
            if "_default_alias" in raw:
                default_alias = raw["_default_alias"]
        except Exception:
            pass
    return llm_config, default_alias


# ── Model Config CRUD Pydantic models ────────────────────────────────────────

class ModelConfigCreate(BaseModel):
    alias: str
    model: str
    token_limit: int = 128000
    max_tokens: int = 0
    client_type: str = "auto"
    reasoning: dict | None = None
    vision: bool = True


class ModelConfigUpdate(BaseModel):
    model: str | None = None
    token_limit: int | None = None
    max_tokens: int | None = None
    client_type: str | None = None
    reasoning: dict | None = None
    vision: bool | None = None
    new_alias: str | None = None


# ── Model Config CRUD endpoints ──────────────────────────────────────────────

@app.get("/v1/models/config")
async def list_model_configs():
    """List all models with full ModelEntry configuration."""
    llm_config, default_alias = await asyncio.to_thread(_get_live_llm_config)
    return build_model_catalog(llm_config, default_alias=default_alias)


@app.get("/v1/models/config/{alias}")
async def get_model_config(alias: str):
    """Get single model configuration by alias."""
    llm_config, _ = await asyncio.to_thread(_get_live_llm_config)
    entry = llm_config.get(alias)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"Model '{alias}' not found")
    return {
        "alias": alias,
        "display_name": _display_name_from_alias(alias),
        **entry.to_dict(),
    }


@app.post("/v1/models/config")
async def create_model_config(body: ModelConfigCreate):
    """Create a new model configuration."""
    llm_config, default_alias = await asyncio.to_thread(_get_live_llm_config)

    if body.alias in llm_config:
        raise HTTPException(status_code=409, detail=f"Model '{body.alias}' already exists")

    reasoning = ReasoningConfig(
        supported=body.reasoning.get("supported", False) if body.reasoning else False,
        effort_levels=body.reasoning.get("effort_levels", []) if body.reasoning else [],
        param_type=body.reasoning.get("param_type", "none") if body.reasoning else "none",
    )

    llm_config[body.alias] = ModelEntry(
        model=body.model,
        token_limit=body.token_limit,
        max_tokens=body.max_tokens,
        client_type=body.client_type,
        reasoning=reasoning,
        vision=body.vision,
    )

    await asyncio.to_thread(save_llm_mode_config, llm_config, default_alias)
    return {
        "alias": body.alias,
        "display_name": _display_name_from_alias(body.alias),
        **llm_config[body.alias].to_dict(),
    }


@app.put("/v1/models/config/{alias}")
async def update_model_config(alias: str, body: ModelConfigUpdate):
    """Update an existing model configuration."""
    llm_config, default_alias = await asyncio.to_thread(_get_live_llm_config)

    if alias not in llm_config:
        raise HTTPException(status_code=404, detail=f"Model '{alias}' not found")

    entry = llm_config[alias]

    if body.model is not None:
        entry.model = body.model
    if body.token_limit is not None:
        entry.token_limit = body.token_limit
    if body.max_tokens is not None:
        entry.max_tokens = body.max_tokens
    if body.client_type is not None:
        entry.client_type = body.client_type
    if body.reasoning is not None:
        entry.reasoning = ReasoningConfig(
            supported=body.reasoning.get("supported", entry.reasoning.supported),
            effort_levels=body.reasoning.get("effort_levels", entry.reasoning.effort_levels),
            param_type=body.reasoning.get("param_type", entry.reasoning.param_type),
        )
    if body.vision is not None:
        entry.vision = body.vision

    # Handle rename
    if body.new_alias and body.new_alias != alias:
        if body.new_alias in llm_config:
            raise HTTPException(status_code=409, detail=f"Model '{body.new_alias}' already exists")
        llm_config[body.new_alias] = entry
        del llm_config[alias]
        if default_alias == alias:
            default_alias = body.new_alias

    await asyncio.to_thread(save_llm_mode_config, llm_config, default_alias)
    final_alias = body.new_alias or alias
    return {
        "alias": final_alias,
        "display_name": _display_name_from_alias(final_alias),
        **llm_config[final_alias].to_dict(),
    }


@app.delete("/v1/models/config/{alias}")
async def delete_model_config(alias: str):
    """Delete a model configuration."""
    llm_config, default_alias = await asyncio.to_thread(_get_live_llm_config)

    if alias not in llm_config:
        raise HTTPException(status_code=404, detail=f"Model '{alias}' not found")

    del llm_config[alias]

    new_default = default_alias
    if default_alias == alias:
        new_default = next(iter(llm_config)) if llm_config else DEFAULT_CONFIG_NAME

    await asyncio.to_thread(save_llm_mode_config, llm_config, new_default)
    return {"ok": True, "new_default_alias": new_default}


@app.put("/v1/models/config/default/{alias}")
async def set_default_model_config(alias: str):
    """Set the default model alias."""
    llm_config, _ = await asyncio.to_thread(_get_live_llm_config)

    if alias not in llm_config:
        raise HTTPException(status_code=404, detail=f"Model '{alias}' not found")

    await asyncio.to_thread(save_llm_mode_config, llm_config, alias)
    return {"default_alias": alias}







# âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

# Chat (streaming)

# âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ



_CHAT_RUNTIME_MODE_INSTRUCTIONS = {
    "plan": "Produce a concrete implementation plan before any execution steps. Call out assumptions, risks, verification, and the smallest safe next step.",
    "goal": "Track the user's objective, completion criteria, and remaining blockers explicitly. Keep the response oriented around goal progress.",
    "review": "Use code-review behavior: findings first, ordered by severity, with file and line references where possible. Keep summaries secondary.",
    "fix": "Implement or describe a focused fix path. Prefer minimal changes, include verification, and surface residual risk.",
    "test": "Prioritize relevant automated tests or verification commands before broader execution. Explain what each test proves.",
    "commit": "Prepare commit-ready output only after reviewing staged scope, risk, and test evidence. Do not claim a commit happened unless a commit tool actually ran.",
    "fork": "Plan work as an isolated fork or subtask. Identify what should happen in the child thread or worktree before touching shared state.",
}


def _runtime_mode_from_metadata(metadata: dict[str, Any] | None) -> dict[str, str] | None:

    if not isinstance(metadata, dict):

        return None

    raw_mode = metadata.get("runtime_mode")

    if not isinstance(raw_mode, dict):

        return None

    name = _safe_str(raw_mode.get("name")).strip().lower()

    if name not in _CHAT_RUNTIME_MODE_INSTRUCTIONS:

        return None

    mode: dict[str, str] = {"name": name}

    for key in ("label", "description", "intent", "activated_by"):

        value = _safe_str(raw_mode.get(key)).strip()

        if value:

            mode[key] = value[:600]

    return mode


def _task_with_runtime_mode(task: str, metadata: dict[str, Any] | None) -> str:

    runtime_mode = _runtime_mode_from_metadata(metadata)

    if not runtime_mode:

        return task

    lines = [
        "Desktop runtime mode:",
        f"Mode: {runtime_mode.get('label') or runtime_mode['name']} ({runtime_mode['name']})",
        f"Backend instruction: {_CHAT_RUNTIME_MODE_INSTRUCTIONS[runtime_mode['name']]}",
    ]

    if runtime_mode.get("description"):

        lines.append(f"Mode description: {runtime_mode['description']}")

    if runtime_mode.get("intent"):

        lines.append(f"User mode intent: {runtime_mode['intent']}")

    if runtime_mode.get("activated_by"):

        lines.append(f"Activated by: {runtime_mode['activated_by']}")

    lines.extend(["", "User task:", task])

    return "\n".join(lines)


def _task_with_remote_attachments(task: str, metadata: dict[str, Any] | None, workspace_id: str | None) -> str:
    if not workspace_id or not isinstance(metadata, dict): return task
    attachments = metadata.get("attachments")
    if not isinstance(attachments, list): return task
    blocks: list[str] = []
    total = 0
    for item in attachments[:20]:
        if not isinstance(item, dict): continue
        kind = str(item.get("kind") or ""); name = str(item.get("name") or "attachment")[:200]
        if kind in {"browser", "terminal", "selection"}:
            content = str(item.get("visibleText") or item.get("note") or "")[:12000]
        elif kind == "file":
            try:
                target = _workspace_child(workspace_id, str(item.get("path") or ""))
                raw = target.read_bytes()[:262144]
                content = raw.decode("utf-8", errors="replace") if b"\x00" not in raw[:8192] else "[binary file omitted]"
            except (HTTPException, OSError): content = "[file unavailable]"
        elif kind == "folder":
            try:
                directory = _workspace_child(workspace_id, str(item.get("path") or ""))
                content = "\n".join(str(path.relative_to(directory)) for path in directory.rglob("*") if path.is_file())[:24000]
            except (HTTPException, OSError): content = "[folder unavailable]"
        else: continue
        remaining = 50000 - total
        if remaining <= 0: break
        content = content[:remaining]; total += len(content); blocks.append(f"Attachment: {name} ({kind})\n{content}")
    return task if not blocks else f"{task}\n\nRemote workspace attachment context:\n" + "\n\n".join(blocks)


@app.post("/v1/chat/completions")

async def chat_completions(request: ChatRequest, raw_request: Request):

    """OpenAI-compatible chat completions with SSE streaming.



    Only streaming mode is supported. The caller MUST set stream=true.



    The agent internally manages full conversation history via its

    SQLite-based model_context. Only the LAST user message is passed

    as task â the agent's internal context handles the rest.

    """

    auth_context = None
    if raw_request.headers.get("x-opendrsai-auth-mode") == "oidc":
        try:
            auth_context = context_from_bearer(
                raw_request.headers.get("authorization"),
                request.user_id or "",
            )
        except ValueError as exc:
            code = str(exc)
            status_code = 403 if code == "subject_mismatch" else 401
            raise HTTPException(
                status_code=status_code,
                detail={
                    "code": code,
                    "message": "The HepAI authentication context is not valid.",
                    "retryable": code == "token_expired",
                },
            ) from exc

    # Extract the last user message as the task

    user_msgs = [m for m in request.messages if m.role == "user"]

    if not user_msgs:

        raise HTTPException(status_code=400, detail="No user message found")

    task = _task_with_runtime_mode(user_msgs[-1].content, request.metadata)



    thread_id = request.thread_id or str(uuid.uuid4())

    user_id = request.user_id or _get_user_id()

    if request.workspace_id:
        workspace_root = _workspace_root(request.workspace_id)
        if request.work_dir:
            work_dir = str(_workspace_child(request.workspace_id, request.work_dir))
            if not Path(work_dir).is_dir():
                raise HTTPException(status_code=400, detail="work_dir must be a directory")
        else:
            work_dir = str(workspace_root)
    else:
        work_dir = request.work_dir or os.getcwd()

    task = _task_with_remote_attachments(task, request.metadata, request.workspace_id)



    cancel_token = CancellationToken()



    async def generate_sse():

        """Generate SSE events from agent.run_stream()."""

        has_content = False
        sent_done = False



        try:

            with platform_auth_scope(auth_context) if auth_context else nullcontext():
                event_stream = manager.run_stream(
                    task=task,
                    thread_id=thread_id,
                    user_id=user_id,
                    model_alias=request.model if request.model != "drsai" else None,
                    work_dir=work_dir,
                    cancellation_token=cancel_token,
                )
                async for event in event_stream:

                    sse = _event_to_sse(event)

                    if sse:

                        if "[DONE]" in sse:
                            sent_done = True

                        if sse.startswith("data:") and "[DONE]" not in sse:

                            has_content = True

                        yield sse

            if not sent_done:
                yield "data: [DONE]\n\n"



        except asyncio.CancelledError:

            logger.info(f"Request cancelled for session {thread_id}")

            yield "data: [DONE]\n\n"

            return



        except HTTPException:

            raise



        except Exception as e:
            error = classify_model_error(e)
            logger.error(f"Agent error for session {thread_id}: code={error['code']}")
            logger.debug(traceback.format_exc())
            yield f"data: {json.dumps({'error': error})}\n\n"

            yield "data: [DONE]\n\n"

            return



    async def generate_with_disconnect():

        gen = generate_sse()

        try:

            async for chunk in gen:

                if await raw_request.is_disconnected():

                    cancel_token.cancel()

                    break

                yield chunk

        finally:

            await gen.aclose()



    return StreamingResponse(

        generate_with_disconnect(),

        media_type="text/event-stream",

        headers={

            "X-Drsai-Session-Id": thread_id,

            "Cache-Control": "no-cache",

            "Connection": "keep-alive",

            "X-Accel-Buffering": "no",

        },

    )





# âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

# Threads (sessions)

# âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ



@app.get("/v1/threads")

async def list_threads(

    user_id: str | None = Query(default=None),

    limit: int = Query(default=30, le=100),

    offset: int = Query(default=0, ge=0),

    workspace_id: str | None = Query(default=None),

):

    """List sessions for the given user, newest first."""

    store = _get_store(user_id)

    infos = store.list(limit=max(limit + offset, 100) if workspace_id else limit)
    if workspace_id:
        root = str(_workspace_root(workspace_id))
        infos = [info for info in infos if getattr(info, "workdir", None) == root]

    # Paginate in Python (CLISessionStore.list doesn't support offset natively)

    result = infos[offset:offset + limit]

    return {

        "object": "list",

        "data": [_session_info_to_dict(s) for s in result],

        "total": len(infos),

    }





@app.get("/v1/threads/search")

async def search_threads(

    query: str = Query(..., min_length=1),

    user_id: str | None = Query(default=None),

    limit: int = Query(default=20, le=50),

):

    """Search sessions by query string."""

    store = _get_store(user_id)

    results = store.search(query, limit=limit)

    return {

        "object": "list",

        "data": [_session_info_to_dict(s) for s in results],

    }





@app.get("/v1/threads/{thread_id}")

async def get_thread(

    thread_id: str,

    user_id: str | None = Query(default=None),

):

    """Get messages for a specific session.

    Returns messages normalized to a uniform {role, content, type} format

    so the desktop renderer does not need to understand autogen internals.

    """

    store = _get_store(user_id)

    msgs = store.load(thread_id)

    info = store.resolve(thread_id)

    normalized = [_normalize_message(m) for m in msgs]

    return {

        "thread_id": thread_id,

        "name": info.name if info else "",

        "messages": normalized,

    }





# ââ Agent control (pause / resume / stop) ââââââââââââââââââââââââââââââââââââ



@app.post("/v1/threads/{thread_id}/pause")

async def pause_thread(

    thread_id: str,

    user_id: str | None = Query(default=None),

):

    """Pause the running agent for this session."""

    success = await manager.pause_agent(thread_id, user_id)

    if not success:

        raise HTTPException(status_code=404, detail="Session not found or not running")

    return {"status": "paused", "thread_id": thread_id}





@app.post("/v1/threads/{thread_id}/resume")

async def resume_thread(

    thread_id: str,

    user_id: str | None = Query(default=None),

):

    """Resume a paused agent for this session."""

    success = await manager.resume_agent(thread_id, user_id)

    if not success:

        raise HTTPException(status_code=404, detail="Session not found or not paused")

    return {"status": "active", "thread_id": thread_id}





@app.post("/v1/threads/{thread_id}/stop")

async def stop_thread(

    thread_id: str,

    user_id: str | None = Query(default=None),

):

    """Stop the agent and persist its final state."""

    success = await manager.stop_agent(thread_id, user_id)

    if not success:

        raise HTTPException(status_code=404, detail="Session not found")

    return {"status": "stopped", "thread_id": thread_id}

@app.post("/v1/threads/{thread_id}/rename")
async def rename_thread(
    thread_id: str,
    user_id: str | None = Query(default=None),
    name: str = Query(..., min_length=1, description="New session name"),
):
    """Rename a session thread."""
    store = _get_store(user_id)
    success = store.rename(thread_id, name)
    if not success:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"status": "ok", "thread_id": thread_id, "name": name}







# âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

# Skills

# âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ



def _get_skills_dir(user_id: str | None = None) -> Path:

    """Resolve the skills directory for a user."""

    uid = user_id or _get_user_id()

    # Aligned with create_agent's storage_dir: WORKDIR / user_id

    from drsai.backend.run_drsai_agent_factory import WORKDIR

    # Aligned with UserProfileManager: skills_dir = config_path / "skills"
    #   where config_path = WORKDIR / user_id / "configs"
    return Path(WORKDIR) / uid / "configs" / "skills"


def _get_config_dir(user_id: str | None = None) -> Path:
    """Resolve the user config directory."""
    from drsai.backend.run_drsai_agent_factory import WORKDIR
    uid = user_id or _get_user_id()
    return Path(WORKDIR) / uid / "configs"


def _get_available_skills_dirs() -> list[Path]:
    """Find all available/bundled skill collection directories.

    Searches:
      1. ``SYSTEM_SKILLS_DIR`` env var (colon-separated list)
      2. ``AGENT_SKILLS_DIR`` env var (colon-separated list)
      3. Project-root ``agent_skills/`` collections
    """
    dirs: list[Path] = []

    for env_name in ("SYSTEM_SKILLS_DIR", "AGENT_SKILLS_DIR"):
        env_val = os.environ.get(env_name)
        if env_val:
            for d in env_val.split(":"):
                p = Path(d).expanduser()
                if p.exists() and p.is_dir():
                    dirs.append(p.resolve())

    # Also scan project-root agent_skills/ collections
    project_root_candidates = [
        Path(__file__).resolve().parents[6],  # gateway → backend → drsai → src → pkg → python → project
        Path.cwd(),
    ]
    for root in project_root_candidates:
        agent_skills_root = root / "agent_skills"
        if agent_skills_root.exists() and agent_skills_root.is_dir():
            for collection in sorted(agent_skills_root.iterdir()):
                if collection.is_dir() and not collection.name.startswith("."):
                    resolved = collection.resolve()
                    if resolved not in dirs:
                        dirs.append(resolved)

    return dirs


def _find_bundled_skill_md(name: str, source: str | None = None) -> Path | None:
    """Find a SKILL.md in the bundled skill collections.

    Args:
        name: Skill name (directory name).
        source: Optional collection name to restrict the search.
            If not provided, all collections are scanned.

    Returns:
        Path to SKILL.md if found, else None.
    """
    for skills_dir in _get_available_skills_dirs():
        if source and skills_dir.name != source:
            continue
        candidate = skills_dir / name / "SKILL.md"
        if candidate.exists():
            return candidate
    return None





@app.get("/v1/skills")

async def list_skills(

    user_id: str | None = Query(default=None),

):

    """List installed skills for the given user."""

    skills_dir = _get_skills_dir(user_id)

    skills: list[dict] = []



    if skills_dir.exists():

        for skill_dir in sorted(skills_dir.iterdir()):

            if not skill_dir.is_dir():

                continue

            skill_md = skill_dir / "SKILL.md"

            if not skill_md.exists():

                continue

            try:

                content = skill_md.read_text(encoding="utf-8", errors="replace")[:4000]

                name, description, category = _parse_skill_frontmatter(content)

                skills.append({

                    "name": name or skill_dir.name,

                    "category": category or "",

                    "description": description or "",

                    "path": str(skill_dir),

                })

            except Exception:

                skills.append({

                    "name": skill_dir.name,

                    "category": "",

                    "description": "",

                    "path": str(skill_dir),

                })



    return {"object": "list", "data": sorted(skills, key=lambda s: (s["category"], s["name"]))}


@app.get("/v1/skills/available")
async def list_available_skills(
    user_id: str | None = Query(default=None),
):
    """List bundled/available skills from agent_skills collections.

    Returns all skills from system collections with an ``installed`` flag
    indicating whether the skill already exists in the user's skills dir.
    """
    # Resolve installed set
    installed_names: set[str] = set()
    user_skills_dir = _get_skills_dir(user_id)
    if user_skills_dir.exists():
        for d in user_skills_dir.iterdir():
            if d.is_dir() and (d / "SKILL.md").exists():
                installed_names.add(d.name)

    results: list[dict] = []
    for skills_dir in _get_available_skills_dirs():
        source_name = skills_dir.name
        if not skills_dir.exists():
            continue
        for skill_dir in sorted(skills_dir.iterdir()):
            if not skill_dir.is_dir():
                continue
            skill_md = skill_dir / "SKILL.md"
            if not skill_md.exists():
                continue
            try:
                content = skill_md.read_text(encoding="utf-8", errors="replace")[:4000]
                name, description, _category = _parse_skill_frontmatter(content)
                name = name or skill_dir.name
                results.append({
                    "name": name,
                    "description": description or "",
                    "category": source_name,
                    "source": source_name,
                    "installed": name in installed_names,
                })
            except Exception:
                results.append({
                    "name": skill_dir.name,
                    "description": "",
                    "category": source_name,
                    "source": source_name,
                    "installed": skill_dir.name in installed_names,
                })

    # Deduplicate by name (first occurrence wins)
    seen: set[str] = set()
    deduped: list[dict] = []
    for r in results:
        if r["name"] not in seen:
            seen.add(r["name"])
            deduped.append(r)

    return {"object": "list", "data": sorted(deduped, key=lambda s: (s["category"], s["name"]))}


@app.get("/v1/skills/{skill_path:path}")

async def get_skill_content(skill_path: str):

    """Get the full SKILL.md content for a skill."""

    path = Path(skill_path)

    if not path.is_absolute():

        # Resolve relative to skills dir

        path = _get_skills_dir() / skill_path

    skill_md = path / "SKILL.md" if path.is_dir() else path

    if not skill_md.exists():

        raise HTTPException(status_code=404, detail="Skill not found")

    try:

        content = skill_md.read_text(encoding="utf-8", errors="replace")

        return {"path": str(skill_md), "content": content}

    except Exception as e:

        raise HTTPException(status_code=500, detail=str(e))


@app.post("/v1/skills/install")
async def install_skill(
    req: SkillInstallRequest,
    user_id: str | None = Query(default=None),
):
    """Install a skill by writing SKILL.md to the user's skills directory.

    If ``source`` is provided, the backend reads SKILL.md from the
    bundled ``agent_skills/{source}/{name}/`` directory and copies it.
    Otherwise, ``content`` is written directly.
    """
    skills_dir = _get_skills_dir(user_id)
    skill_dir = skills_dir / req.name

    # Determine content: from bundled source or from request body
    content = req.content
    if req.source and not content:
        # Install from a bundled collection
        bundled_skill_md = _find_bundled_skill_md(req.name, req.source)
        if bundled_skill_md is None:
            raise HTTPException(
                status_code=404,
                detail=f"Bundled skill '{req.name}' not found in source '{req.source}'",
            )
        content = bundled_skill_md.read_text(encoding="utf-8", errors="replace")

    if not content:
        raise HTTPException(status_code=400, detail="content must not be empty")

    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / "SKILL.md").write_text(content, encoding="utf-8")
    return {"status": "ok", "name": req.name, "path": str(skill_dir)}


@app.delete("/v1/skills/{skill_name}")
async def uninstall_skill(
    skill_name: str,
    user_id: str | None = Query(default=None),
):
    """Uninstall a skill by removing its directory."""
    import shutil
    skills_dir = _get_skills_dir(user_id)
    skill_dir = skills_dir / skill_name
    if not skill_dir.exists():
        raise HTTPException(status_code=404, detail=f"Skill '{skill_name}' not found")
    shutil.rmtree(skill_dir)
    return {"status": "ok", "name": skill_name}


def _parse_skill_frontmatter(content: str) -> tuple[str, str, str]:

    """Parse SKILL.md frontmatter for name, description, and category."""

    name, description, category = "", "", ""

    if not content.startswith("---"):

        # Fall back to first heading and paragraph

        import re

        heading = re.search(r"^#\s+(.+)", content, re.MULTILINE)

        if heading:

            name = heading.group(1).strip()

        para = re.search(r"^(?!#)(?!---).+", content, re.MULTILINE)

        if para:

            description = para.group(0).strip()[:120]

        return name, description, category



    end_idx = content.find("---", 3)

    if end_idx == -1:

        return name, description, category



    frontmatter = content[3:end_idx]

    import re

    name_match = re.search(r"^\s*name:\s*[\"']?([^\"'\n]+)[\"']?\s*$", frontmatter, re.MULTILINE)

    if name_match:

        name = name_match.group(1).strip()

    desc_match = re.search(r"^\s*description:\s*[\"']?([^\"'\n]+)[\"']?\s*$", frontmatter, re.MULTILINE)

    if desc_match:

        description = desc_match.group(1).strip()

    cat_match = re.search(r"^\s*category:\s*[\"']?([^\"'\n]+)[\"']?\s*$", frontmatter, re.MULTILINE)

    if cat_match:

        category = cat_match.group(1).strip()



    return name, description, category



# ═══════════════════════════════════════════════════════════════════════════
# Config (AGENTS.md / user.md)
# ═══════════════════════════════════════════════════════════════════════════


@app.get("/v1/config/agents-md")
async def get_agents_md(
    user_id: str | None = Query(default=None),
):
    """Read AGENTS.md (SOUL) for the given user."""
    cfg_dir = _get_config_dir(user_id)
    agents_md = cfg_dir / "AGENTS.md"
    if agents_md.exists():
        content = agents_md.read_text(encoding="utf-8", errors="replace")
        return {"content": content, "exists": True}
    return {"content": "", "exists": False}


@app.put("/v1/config/agents-md")
async def put_agents_md(
    req: ContentRequest,
    user_id: str | None = Query(default=None),
):
    """Write AGENTS.md (SOUL) for the given user."""
    cfg_dir = _get_config_dir(user_id)
    cfg_dir.mkdir(parents=True, exist_ok=True)
    (cfg_dir / "AGENTS.md").write_text(req.content, encoding="utf-8")
    return {"status": "ok"}


@app.post("/v1/config/agents-md/reset")
async def reset_agents_md(user_id: str | None = Query(default=None)):
    """Reset AGENTS.md to the default template by re-running UserProfileManager init.

    Deletes the current file, then constructs a temporary UserProfileManager
    pointed at this user's storage so its ``_create_agents_md`` writes a
    fresh default. Returns the new content. Evicts cached agents so the
    next chat turn rebuilds the system prompt.
    """
    uid = user_id or _get_user_id()
    cfg_dir = _get_config_dir(uid)
    cfg_dir.mkdir(parents=True, exist_ok=True)
    agents_md = cfg_dir / "AGENTS.md"
    try:
        if agents_md.exists():
            agents_md.unlink()
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Failed to remove AGENTS.md: {e}")

    # Rebuild via UserProfileManager. work_dir is the parent of cfg_dir
    # ("configs"); UserProfileManager treats it as its storage root.
    from drsai.modules.agents.skills_agent.managers import UserProfileManager
    try:
        UserProfileManager(
            agent_name="Assistant",
            work_dir=cfg_dir.parent,
            user_id=uid,
            thread_id="__reset__",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Reset failed: {e}")

    content = agents_md.read_text(encoding="utf-8") if agents_md.exists() else ""
    # Evict cached agents so the next turn picks up the new prompt
    try:
        await manager.evict_user(uid)
    except Exception as e:
        logger.debug(f"evict_user during reset failed: {e}")
    return {"content": content, "exists": agents_md.exists()}


@app.get("/v1/config/user-md")
async def get_user_md(
    user_id: str | None = Query(default=None),
):
    """Read USER.md for the given user."""
    cfg_dir = _get_config_dir(user_id)
    user_md = cfg_dir / "USER.md"
    if user_md.exists():
        content = user_md.read_text(encoding="utf-8", errors="replace")
        return {"content": content, "exists": True}
    return {"content": "", "exists": False}


@app.put("/v1/config/user-md")
async def put_user_md(
    req: ContentRequest,
    user_id: str | None = Query(default=None),
):
    """Write USER.md for the given user."""
    cfg_dir = _get_config_dir(user_id)
    cfg_dir.mkdir(parents=True, exist_ok=True)
    (cfg_dir / "USER.md").write_text(req.content, encoding="utf-8")
    return {"status": "ok"}


# ── Tools (TOOLS_CONFIG.json — MCP servers + local tool descriptions) ────────

def _tools_config_path(user_id: str | None = None) -> Path:
    return _get_config_dir(user_id) / "TOOLS_CONFIG.json"


def _read_tools_config(user_id: str | None = None) -> list[dict]:
    p = _tools_config_path(user_id)
    if not p.exists():
        return []
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return data
        return []
    except Exception as e:
        logger.warning(f"Failed to parse TOOLS_CONFIG.json: {e}")
        return []


def _write_tools_config(entries: list[dict], user_id: str | None = None) -> None:
    p = _tools_config_path(user_id)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(entries, indent=4, ensure_ascii=False), encoding="utf-8")


@app.get("/v1/config/tools")
async def list_tools(user_id: str | None = Query(default=None)):
    """Return all configured tools (MCP servers + local tool descriptions)."""
    entries = _read_tools_config(user_id)
    return {"object": "list", "data": entries}


@app.post("/v1/config/tools")
async def create_tool(
    req: ToolEntry,
    user_id: str | None = Query(default=None),
):
    """Append a new tool entry to TOOLS_CONFIG.json."""
    entries = _read_tools_config(user_id)
    entries.append(req.model_dump())
    _write_tools_config(entries, user_id)
    return {"index": len(entries) - 1, **req.model_dump()}


@app.put("/v1/config/tools/{index}")
async def update_tool(
    index: int,
    req: ToolEntry,
    user_id: str | None = Query(default=None),
):
    """Replace the tool entry at ``index``."""
    entries = _read_tools_config(user_id)
    if index < 0 or index >= len(entries):
        raise HTTPException(status_code=404, detail=f"Tool index {index} not found")
    entries[index] = req.model_dump()
    _write_tools_config(entries, user_id)
    return {"index": index, **entries[index]}


@app.delete("/v1/config/tools/{index}")
async def delete_tool(
    index: int,
    user_id: str | None = Query(default=None),
):
    """Remove the tool entry at ``index``."""
    entries = _read_tools_config(user_id)
    if index < 0 or index >= len(entries):
        raise HTTPException(status_code=404, detail=f"Tool index {index} not found")
    removed = entries.pop(index)
    _write_tools_config(entries, user_id)
    return {"status": "ok", "removed": removed}







# âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

# Memory

# âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ



from drsai.modules.components.memory import (
    CuratedMemoryStore,
    DEFAULT_MEMORY_CHAR_LIMIT,
    DEFAULT_USER_CHAR_LIMIT,
)


def _get_curated_store(user_id: str | None = None) -> CuratedMemoryStore:
    """Build a CuratedMemoryStore pointing at this user's MEMORY.md / USER.md.

    Files live in ``WORKDIR/<user_id>/configs/`` — the same directory the
    agent's UserProfileManager writes to, so reads/writes here are seen by
    the running agent on the next system-prompt rebuild.
    """
    cfg_dir = _get_config_dir(user_id)
    cfg_dir.mkdir(parents=True, exist_ok=True)
    return CuratedMemoryStore(
        memory_path=cfg_dir / "MEMORY.md",
        user_path=cfg_dir / "USER.md",
    )


def _memory_payload(user_id: str | None = None) -> dict:
    """Build the GET /v1/memory response payload (hermes-shaped)."""
    store = _get_curated_store(user_id)
    entries = store.list_entries()
    mem_path = store.memory_path
    user_path = store.user_path
    mtimes = store.last_modified()
    counts = store.char_counts()
    user_content = store.read_user()

    # Session / message stats from the shared DB
    total_sessions, total_messages = 0, 0
    try:
        db = _get_db()
        from drsai.modules.managers.datamodel.db import Thread as _Thread, SessionMessage as _SM
        uid = user_id or _get_user_id()
        s_resp = db.get(_Thread, filters={"user_id": uid}, return_json=False)
        if s_resp.status and s_resp.data:
            total_sessions = len(s_resp.data)
        m_resp = db.get(_SM, filters={"user_id": uid}, return_json=False)
        if m_resp.status and m_resp.data:
            total_messages = len(m_resp.data)
    except Exception as e:
        logger.debug(f"Memory stats unavailable: {e}")

    return {
        "memory": {
            "content": "\n§\n".join(e["content"] for e in entries) if entries else "",
            "exists": mem_path.exists(),
            "lastModified": mtimes["memory"],
            "entries": entries,
            "charCount": counts["memory"],
            "charLimit": store.memory_char_limit,
        },
        "user": {
            "content": user_content,
            "exists": user_path.exists(),
            "lastModified": mtimes["user"],
            "charCount": counts["user"],
            "charLimit": store.user_char_limit,
        },
        "stats": {
            "totalSessions": total_sessions,
            "totalMessages": total_messages,
        },
    }


@app.get("/v1/memory")
async def get_memory(user_id: str | None = Query(default=None)):
    """Get memory entries, user profile, and stats for the given user."""
    return _memory_payload(user_id)


# ── Memory mutation models ─────────────────────────────────────────────────


class MemoryEntryRequest(BaseModel):
    content: str = Field(..., description="Entry content (will be trimmed).")


class MemoryUserRequest(BaseModel):
    content: str = Field(..., description="Full USER.md replacement content.")


@app.post("/v1/memory/entries")
async def add_memory_entry(
    req: MemoryEntryRequest,
    user_id: str | None = Query(default=None),
):
    """Append a new entry to MEMORY.md."""
    store = _get_curated_store(user_id)
    result = store.add_entry(req.content)
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "Add failed"))
    return _memory_payload(user_id)


@app.put("/v1/memory/entries/{index}")
async def update_memory_entry(
    index: int,
    req: MemoryEntryRequest,
    user_id: str | None = Query(default=None),
):
    """Replace MEMORY.md entry at ``index``."""
    store = _get_curated_store(user_id)
    result = store.update_entry(index, req.content)
    if not result.get("success"):
        code = 404 if "not found" in result.get("error", "").lower() else 400
        raise HTTPException(status_code=code, detail=result.get("error", "Update failed"))
    return _memory_payload(user_id)


@app.delete("/v1/memory/entries/{index}")
async def delete_memory_entry(
    index: int,
    user_id: str | None = Query(default=None),
):
    """Delete MEMORY.md entry at ``index``."""
    store = _get_curated_store(user_id)
    result = store.remove_entry(index)
    if not result.get("success"):
        code = 404 if "not found" in result.get("error", "").lower() else 400
        raise HTTPException(status_code=code, detail=result.get("error", "Delete failed"))
    return _memory_payload(user_id)


@app.put("/v1/memory/user")
async def write_memory_user(
    req: MemoryUserRequest,
    user_id: str | None = Query(default=None),
):
    """Overwrite USER.md with ``content`` (bounded by user_char_limit)."""
    store = _get_curated_store(user_id)
    result = store.write_user(req.content)
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "Write failed"))
    return _memory_payload(user_id)


@app.get("/v1/memory/limits")
async def get_memory_limits():
    """Return curated-memory character limits (constants)."""
    return {
        "memoryCharLimit": DEFAULT_MEMORY_CHAR_LIMIT,
        "userCharLimit": DEFAULT_USER_CHAR_LIMIT,
    }





# âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

# Entry point

# âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ



# âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

# Config (desktop overrides)

# âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ



@app.get("/v1/config/user-name")

async def get_user_name():

    """Get the currently configured desktop user name."""

    return {"user_name": _get_user_id()}





@app.put("/v1/config/user-name")

async def set_user_name(req: UserNameRequest):

    """Override the desktop user name for this server session."""

    global _desktop_user_name

    name = req.user_name.strip()

    if not name:

        raise HTTPException(status_code=400, detail="user_name must not be empty")

    _desktop_user_name = name

    logger.info(f"Desktop user name set to: {name}")

    return {"user_name": name}


# ════════════════════════════════════════════════════════════════════════════
# Env file (.env) — read/write the agent's environment variables
# ════════════════════════════════════════════════════════════════════════════

_ENV_FILE = Path(FS_DIR) / ".env"
_ENV_KEY_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
# Keys whose values are masked in GET responses. Writes still accept the real
# value via PUT; the mask exists so the value isn't echoed back to the UI
# unmasked.
_SENSITIVE_ENV_KEYS = (
    "_API_KEY",
    "_TOKEN",
    "_SECRET",
    "_PASSWORD",
)


class EnvSetRequest(BaseModel):
    value: str = Field(..., description="Value to write. Single-line strings only.")


def _read_env_file() -> dict[str, str]:
    """Parse FS_DIR/.env into a plain dict. Missing file → empty dict."""
    out: dict[str, str] = {}
    if not _ENV_FILE.exists():
        return out
    try:
        raw = _ENV_FILE.read_text(encoding="utf-8")
    except OSError as e:
        logger.warning(f"Failed to read {_ENV_FILE}: {e}")
        return out
    for line in raw.splitlines():
        s = line.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        k, _, v = s.partition("=")
        k = k.strip()
        v = v.strip()
        if (v.startswith('"') and v.endswith('"')) or (
            v.startswith("'") and v.endswith("'")
        ):
            v = v[1:-1]
        out[k] = v
    return out


def _write_env_file(env: dict[str, str]) -> None:
    """Persist env dict to FS_DIR/.env. Atomic via tempfile + replace."""
    _ENV_FILE.parent.mkdir(parents=True, exist_ok=True)
    body = "\n".join(f"{k}={v}" for k, v in env.items()) + ("\n" if env else "")
    tmp = _ENV_FILE.with_suffix(_ENV_FILE.suffix + ".tmp")
    tmp.write_text(body, encoding="utf-8")
    os.replace(tmp, _ENV_FILE)


def _mask_env(env: dict[str, str]) -> dict[str, str]:
    """Replace sensitive values with a placeholder for display."""
    masked: dict[str, str] = {}
    for k, v in env.items():
        sensitive = any(suffix in k.upper() for suffix in _SENSITIVE_ENV_KEYS)
        if sensitive and v:
            masked[k] = f"***{v[-4:]}" if len(v) > 4 else "***"
        else:
            masked[k] = v
    return masked


@app.get("/v1/config/env")
async def get_env(
    masked: bool = Query(default=True, description="Mask sensitive values."),
):
    """Return the contents of FS_DIR/.env.

    Sensitive keys (containing API_KEY/TOKEN/SECRET/PASSWORD) are masked by
    default — pass ``masked=false`` only when the caller needs the real
    value (e.g. to populate a 'show key' modal).
    """
    env = _read_env_file()
    return {
        "path": str(_ENV_FILE),
        "env": _mask_env(env) if masked else env,
    }


@app.put("/v1/config/env/{key}")
async def set_env_value(
    key: str,
    req: EnvSetRequest,
):
    """Set or update a single env var, then evict cached agents so the next
    chat turn picks up the new value via :func:`load_dotenv`."""
    if not _ENV_KEY_RE.match(key):
        raise HTTPException(
            status_code=400,
            detail="Invalid env var name. Use letters, digits, and underscores, and do not start with a digit.",
        )
    if "\n" in req.value or "\r" in req.value or "\0" in req.value:
        raise HTTPException(
            status_code=400,
            detail="Env var values must be single-line strings.",
        )

    env = _read_env_file()
    env[key] = req.value
    _write_env_file(env)
    # Refresh the running process so the next agent creation sees it
    os.environ[key] = req.value
    evicted = await manager.evict_user(_get_user_id())
    return {"ok": True, "key": key, "evicted_sessions": evicted}


@app.delete("/v1/config/env/{key}")
async def delete_env_value(key: str):
    """Remove a single env var."""
    if not _ENV_KEY_RE.match(key):
        raise HTTPException(status_code=400, detail="Invalid env var name.")
    env = _read_env_file()
    if key not in env:
        raise HTTPException(status_code=404, detail=f"Env var '{key}' not found.")
    env.pop(key)
    _write_env_file(env)
    os.environ.pop(key, None)
    evicted = await manager.evict_user(_get_user_id())
    return {"ok": True, "evicted_sessions": evicted}


# ════════════════════════════════════════════════════════════════════════════
# CLI config (cli_config.json) — structured agent settings
# ════════════════════════════════════════════════════════════════════════════

# Keys writable through the API. ``api_key`` family is intentionally excluded
# — those should go through /v1/config/env instead so they live in .env and
# benefit from masking.
_CLI_CONFIG_WRITABLE = {
    "user_id",
    "defult_config_name",
    "plan_mode",
    "workspace_enabled",
    "dangerous_allowed",
}

# Keys masked when returned via GET.
_CLI_CONFIG_SENSITIVE = {
    "api_key",
    "anthropic_api_key",
    "openai_api_key",
}


class CliConfigSetRequest(BaseModel):
    value: Any = Field(..., description="New value. Booleans, ints, strings, or null.")


@app.get("/v1/config/cli")
async def get_cli_config():
    """Return cli_config.json with sensitive values masked."""
    from drsai.backend.cli.config import load_config, CLI_CONFIG_PATH

    cfg = load_config()
    safe = dict(cfg)
    for k in _CLI_CONFIG_SENSITIVE:
        v = safe.get(k)
        if isinstance(v, str) and v:
            safe[k] = f"***{v[-4:]}" if len(v) > 4 else "***"
    return {"path": str(CLI_CONFIG_PATH), "config": safe}


@app.put("/v1/config/cli/{key}")
async def set_cli_config(key: str, req: CliConfigSetRequest):
    """Update a single cli_config.json key, then evict cached agents."""
    if key not in _CLI_CONFIG_WRITABLE:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Key '{key}' is not writable. Writable keys: "
                f"{sorted(_CLI_CONFIG_WRITABLE)}"
            ),
        )
    from drsai.backend.cli.config import update_config

    update_config(**{key: req.value})
    evicted = await manager.evict_user(_get_user_id())
    return {"ok": True, "key": key, "value": req.value, "evicted_sessions": evicted}


# ════════════════════════════════════════════════════════════════════════════
# Platform toggles (telegram / discord / slack / whatsapp / signal)
# ════════════════════════════════════════════════════════════════════════════
#
# These are placeholder endpoints kept compatible with the desktop UI. drsai
# itself does not yet ship messaging-platform plugins; the on/off state is
# persisted in cli_config.json under ``platforms`` so it survives restarts
# and is available the moment plugins land.

_SUPPORTED_PLATFORMS = ("telegram", "discord", "slack", "whatsapp", "signal")


class PlatformToggleRequest(BaseModel):
    enabled: bool


@app.get("/v1/config/platforms")
async def list_platforms():
    """Return ``{platform: enabled}`` for every supported platform."""
    from drsai.backend.cli.config import load_config

    cfg = load_config()
    raw = cfg.get("platforms") or {}
    return {
        "platforms": {p: bool(raw.get(p, False)) for p in _SUPPORTED_PLATFORMS},
        "implemented": False,
        "note": (
            "Stored in cli_config.json[platforms]. drsai does not yet ship "
            "messaging-platform plugins; the toggles are persisted for future use."
        ),
    }


@app.put("/v1/config/platforms/{name}")
async def set_platform(name: str, req: PlatformToggleRequest):
    """Toggle a single platform on/off (persisted; not yet runtime-effective)."""
    if name not in _SUPPORTED_PLATFORMS:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown platform '{name}'. Supported: {list(_SUPPORTED_PLATFORMS)}",
        )
    from drsai.backend.cli.config import load_config, save_config

    cfg = load_config()
    platforms = dict(cfg.get("platforms") or {})
    platforms[name] = bool(req.enabled)
    cfg["platforms"] = platforms
    save_config(cfg)
    return {"ok": True, "name": name, "enabled": platforms[name]}


# ════════════════════════════════════════════════════════════════════════════
# Logs — tail FS_DIR/logs/*.log files
# ════════════════════════════════════════════════════════════════════════════
#
# drsai's default logger only writes to stderr; persistent log files are
# created by the desktop launcher (which captures stderr to disk) and by
# any opt-in ``logger.add(...)`` the application sets up. This endpoint
# returns the tail of whatever it finds in FS_DIR/logs/, defaulting to the
# names the desktop UI knows about.

_LOG_DIR = Path(FS_DIR) / "logs"
_ALLOWED_LOG_NAMES = ("agent.log", "errors.log", "gateway.log")


@app.get("/v1/logs")
async def get_logs(
    file: str = Query(default="agent.log", description="Log file name."),
    lines: int = Query(default=200, ge=1, le=5000),
):
    """Return the last ``lines`` lines of FS_DIR/logs/<file>.

    The ``file`` argument is restricted to a small allowlist to avoid path
    traversal. Missing files return an empty payload instead of 404 so the
    UI can render a "no logs yet" state.
    """
    if file not in _ALLOWED_LOG_NAMES:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown log file '{file}'. Allowed: {list(_ALLOWED_LOG_NAMES)}",
        )
    full_path = _LOG_DIR / file
    if not full_path.exists():
        return {"path": str(full_path), "content": "", "exists": False}
    try:
        # Tail without loading the whole file: read last ~64KB then split.
        with full_path.open("rb") as f:
            try:
                f.seek(-64 * 1024, os.SEEK_END)
            except OSError:
                f.seek(0)
            data = f.read().decode("utf-8", errors="replace")
        all_lines = data.splitlines()
        tail = "\n".join(all_lines[-lines:])
        return {"path": str(full_path), "content": tail, "exists": True}
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Failed to read log: {e}")


@app.get("/v1/logs/list")
async def list_log_files():
    """Return which of the well-known log files exist."""
    if not _LOG_DIR.exists():
        return {"path": str(_LOG_DIR), "files": []}
    files: list[dict[str, Any]] = []
    for name in _ALLOWED_LOG_NAMES:
        p = _LOG_DIR / name
        if p.exists():
            try:
                files.append({"name": name, "size": p.stat().st_size})
            except OSError:
                files.append({"name": name, "size": None})
    return {"path": str(_LOG_DIR), "files": files}


# ════════════════════════════════════════════════════════════════════════════
# Cron jobs — wraps modules.agents.skills_agent.managers.ScheduledTaskManager
# ════════════════════════════════════════════════════════════════════════════
#
# One manager per user_id, stored at WORKDIR/<user_id>/scheduler/. A single
# background scheduler-loop runs per manager and calls back into
# AgentManager.run_stream() when a task fires, so cron tasks share the same
# agent + Thread state machinery as interactive chat.

from drsai.modules.agents.skills_agent.managers.scheduled_task_manager import (
    ScheduledTaskManager,
    ScheduledTask,
    ScheduleType,
    TaskStatus,
    TaskNotification,
)


_schedulers: dict[str, ScheduledTaskManager] = {}
_scheduler_locks: dict[str, asyncio.Lock] = {}


async def _agent_executor_for(user_id: str):
    """Build the ``agent_executor`` callable that ScheduledTaskManager invokes
    when a task fires. The returned coroutine drains AgentManager.run_stream
    into a text result, mirroring how interactive chat consumes events.
    """
    async def _exec(
        uid: str,
        sid: str,
        prompt: str,
        output_file: Path,
        execution_context: dict | None = None,
    ) -> str:
        del execution_context  # captured at task creation; the run_stream call
                               # path uses the per-thread saved state already.
        result_parts: list[str] = []
        try:
            async for event in manager.run_stream(
                task=prompt,
                thread_id=sid,
                user_id=uid,
                cancellation_token=None,
            ):
                # Stream text deltas to the output file while collecting
                # them so the final string is the full assistant response.
                text = getattr(event, "content", None)
                if isinstance(text, str) and text:
                    result_parts.append(text)
                    try:
                        with open(output_file, "a", encoding="utf-8") as f:
                            f.write(text)
                    except OSError:
                        pass
        except Exception as e:
            logger.error(f"cron task {sid} agent_executor failed: {e}")
            return f"[error] {e}"
        return "".join(result_parts)
    return _exec


async def _scheduler_for(user_id: str | None = None) -> ScheduledTaskManager:
    """Get-or-create the per-user ScheduledTaskManager and ensure it's running."""
    uid = user_id or _get_user_id()
    if uid not in _scheduler_locks:
        _scheduler_locks[uid] = asyncio.Lock()
    async with _scheduler_locks[uid]:
        if uid in _schedulers:
            return _schedulers[uid]
        from drsai.backend.run_drsai_agent_factory import WORKDIR
        work_dir = Path(WORKDIR) / uid / "scheduler"
        work_dir.mkdir(parents=True, exist_ok=True)
        executor = await _agent_executor_for(uid)
        sm = ScheduledTaskManager(work_dir=work_dir, agent_executor=executor)
        await sm.start()
        _schedulers[uid] = sm
        logger.info(f"Started ScheduledTaskManager for user {uid}")
        return sm


# Renderer-facing shape — preserves desktop's existing field names.
def _task_to_desktop(t: ScheduledTask) -> dict:
    state_map = {
        TaskStatus.ENABLED: "active",
        TaskStatus.RUNNING: "active",
        TaskStatus.DISABLED: "paused",
        TaskStatus.ERROR: "active",
    }
    return {
        "id": t.task_id,
        "name": t.task_name,
        "schedule": t.schedule_config,
        "prompt": t.prompt,
        "state": state_map.get(t.status, "active"),
        "enabled": t.status != TaskStatus.DISABLED,
        "next_run_at": t.next_run,
        "last_run_at": t.last_run,
        "last_status": "error" if t.error_count and (t.last_error or "") else (
            "success" if t.run_count else None
        ),
        "last_error": t.last_error,
        "repeat": None,
        "deliver": [],
        "skills": [],
        "script": None,
    }


class CronCreateRequest(BaseModel):
    schedule: str = Field(..., description="cron expression / interval seconds / ISO datetime")
    prompt: str = Field(..., min_length=1)
    name: str | None = None
    deliver: str | None = None
    schedule_type: str | None = Field(
        default=None,
        description="cron | interval | datetime. Inferred from ``schedule`` if omitted.",
    )


def _infer_schedule_type(schedule: str) -> ScheduleType:
    s = (schedule or "").strip()
    # Pure integer → interval seconds
    if s.isdigit():
        return ScheduleType.INTERVAL
    # ISO datetime-ish
    if re.match(r"^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}", s):
        return ScheduleType.DATETIME
    return ScheduleType.CRON


@app.get("/v1/cronjobs")
async def list_cron_jobs(
    include_disabled: bool = Query(default=True),
    user_id: str | None = Query(default=None),
):
    """List the user's cron jobs."""
    sm = await _scheduler_for(user_id)
    tasks = await sm.list_tasks(user_id=user_id or _get_user_id())
    if not include_disabled:
        tasks = [t for t in tasks if t.status != TaskStatus.DISABLED]
    return [_task_to_desktop(t) for t in tasks]


@app.post("/v1/cronjobs")
async def create_cron_job(
    req: CronCreateRequest,
    user_id: str | None = Query(default=None),
):
    """Schedule a new cron job."""
    uid = user_id or _get_user_id()
    sm = await _scheduler_for(uid)
    sched_type = (
        ScheduleType(req.schedule_type)
        if req.schedule_type in {st.value for st in ScheduleType}
        else _infer_schedule_type(req.schedule)
    )
    task = ScheduledTask(
        user_id=uid,
        session_id=f"cron-{uuid.uuid4().hex[:8]}",
        task_name=req.name or req.prompt[:40],
        prompt=req.prompt,
        schedule_type=sched_type,
        schedule_config=req.schedule,
    )
    await sm.add_task(task)
    return _task_to_desktop(task)


@app.delete("/v1/cronjobs/{job_id}")
async def delete_cron_job(
    job_id: str,
    user_id: str | None = Query(default=None),
):
    sm = await _scheduler_for(user_id)
    ok = await sm.remove_task(job_id)
    if not ok:
        raise HTTPException(status_code=404, detail=f"Cron job '{job_id}' not found")
    return {"ok": True}


@app.post("/v1/cronjobs/{job_id}/pause")
async def pause_cron_job(
    job_id: str,
    user_id: str | None = Query(default=None),
):
    sm = await _scheduler_for(user_id)
    task = await sm.get_task(job_id)
    if not task:
        raise HTTPException(status_code=404, detail=f"Cron job '{job_id}' not found")
    await sm.update_task_status(job_id, TaskStatus.DISABLED)
    return _task_to_desktop(await sm.get_task(job_id))


@app.post("/v1/cronjobs/{job_id}/resume")
async def resume_cron_job(
    job_id: str,
    user_id: str | None = Query(default=None),
):
    sm = await _scheduler_for(user_id)
    task = await sm.get_task(job_id)
    if not task:
        raise HTTPException(status_code=404, detail=f"Cron job '{job_id}' not found")
    await sm.update_task_status(job_id, TaskStatus.ENABLED)
    return _task_to_desktop(await sm.get_task(job_id))


@app.post("/v1/cronjobs/{job_id}/trigger")
async def trigger_cron_job(
    job_id: str,
    user_id: str | None = Query(default=None),
):
    """Fire a cron job immediately (out of band)."""
    sm = await _scheduler_for(user_id)
    task = await sm.get_task(job_id)
    if not task:
        raise HTTPException(status_code=404, detail=f"Cron job '{job_id}' not found")
    asyncio.create_task(sm._execute_task(task))
    return _task_to_desktop(task)


# ════════════════════════════════════════════════════════════════════════════
# Kanban — file-backed boards / tasks
# ════════════════════════════════════════════════════════════════════════════
#
# drsai has no native kanban runtime; this is a thin JSON-file store keyed by
# user_id so the desktop Kanban screen has somewhere to persist state until a
# real backend lands. Lives at WORKDIR/<user_id>/kanban/{boards,tasks}.json.

_KANBAN_LOCKS: dict[str, asyncio.Lock] = {}


def _kanban_dir(user_id: str | None = None) -> Path:
    from drsai.backend.run_drsai_agent_factory import WORKDIR
    uid = user_id or _get_user_id()
    d = Path(WORKDIR) / uid / "kanban"
    d.mkdir(parents=True, exist_ok=True)
    return d


async def _kanban_lock(user_id: str | None = None) -> asyncio.Lock:
    uid = user_id or _get_user_id()
    if uid not in _KANBAN_LOCKS:
        _KANBAN_LOCKS[uid] = asyncio.Lock()
    return _KANBAN_LOCKS[uid]


def _read_kanban(user_id: str | None = None) -> dict:
    """Load the JSON store; bootstrap a single default board on first use."""
    p = _kanban_dir(user_id) / "store.json"
    if not p.exists():
        data = {
            "current_board": "default",
            "boards": {
                "default": {
                    "slug": "default",
                    "name": "Default",
                    "archived": False,
                    "created_at": datetime.now().isoformat(),
                }
            },
            "tasks": {},
        }
        p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        return data
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"current_board": "default", "boards": {}, "tasks": {}}


def _write_kanban(data: dict, user_id: str | None = None) -> None:
    p = _kanban_dir(user_id) / "store.json"
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, p)


class KanbanBoardCreate(BaseModel):
    slug: str
    name: str | None = None
    switch: bool = False


class KanbanTaskCreate(BaseModel):
    title: str
    body: str | None = None
    assignee: str | None = None
    priority: int = 0
    tenant: str | None = None
    workspace: str | None = None
    triage: bool = False
    skills: list[str] = Field(default_factory=list)
    max_retries: int = 0
    board: str | None = None


@app.get("/v1/kanban/boards")
async def kanban_list_boards(
    include_archived: bool = Query(default=False),
    user_id: str | None = Query(default=None),
):
    lock = await _kanban_lock(user_id)
    async with lock:
        data = _read_kanban(user_id)
    boards = list(data.get("boards", {}).values())
    if not include_archived:
        boards = [b for b in boards if not b.get("archived")]
    return boards


@app.get("/v1/kanban/board")
async def kanban_current_board(user_id: str | None = Query(default=None)):
    lock = await _kanban_lock(user_id)
    async with lock:
        data = _read_kanban(user_id)
    slug = data.get("current_board") or "default"
    return data.get("boards", {}).get(slug) or {"slug": slug, "name": slug}


@app.post("/v1/kanban/boards")
async def kanban_create_board(
    req: KanbanBoardCreate,
    user_id: str | None = Query(default=None),
):
    lock = await _kanban_lock(user_id)
    async with lock:
        data = _read_kanban(user_id)
        if req.slug in data.get("boards", {}):
            raise HTTPException(status_code=409, detail=f"Board '{req.slug}' already exists")
        board = {
            "slug": req.slug,
            "name": req.name or req.slug,
            "archived": False,
            "created_at": datetime.now().isoformat(),
        }
        data.setdefault("boards", {})[req.slug] = board
        if req.switch:
            data["current_board"] = req.slug
        _write_kanban(data, user_id)
    return board


@app.delete("/v1/kanban/boards/{slug}")
async def kanban_remove_board(
    slug: str,
    hard_delete: bool = Query(default=False),
    user_id: str | None = Query(default=None),
):
    lock = await _kanban_lock(user_id)
    async with lock:
        data = _read_kanban(user_id)
        boards = data.get("boards", {})
        if slug not in boards:
            raise HTTPException(status_code=404, detail=f"Board '{slug}' not found")
        if hard_delete:
            boards.pop(slug, None)
            data["tasks"] = {
                tid: t for tid, t in data.get("tasks", {}).items() if t.get("board") != slug
            }
        else:
            boards[slug]["archived"] = True
        if data.get("current_board") == slug:
            remaining = [s for s, b in boards.items() if not b.get("archived")]
            data["current_board"] = remaining[0] if remaining else "default"
        _write_kanban(data, user_id)
    return {"ok": True}


@app.post("/v1/kanban/boards/{slug}/switch")
async def kanban_switch_board(
    slug: str,
    user_id: str | None = Query(default=None),
):
    lock = await _kanban_lock(user_id)
    async with lock:
        data = _read_kanban(user_id)
        if slug not in data.get("boards", {}):
            raise HTTPException(status_code=404, detail=f"Board '{slug}' not found")
        data["current_board"] = slug
        _write_kanban(data, user_id)
    return data["boards"][slug]


@app.get("/v1/kanban/tasks")
async def kanban_list_tasks(
    board: str | None = Query(default=None),
    status: str | None = Query(default=None),
    assignee: str | None = Query(default=None),
    include_archived: bool = Query(default=False),
    user_id: str | None = Query(default=None),
):
    lock = await _kanban_lock(user_id)
    async with lock:
        data = _read_kanban(user_id)
    board_slug = board or data.get("current_board") or "default"
    tasks = [
        t for t in data.get("tasks", {}).values()
        if (t.get("board") or "default") == board_slug
    ]
    if status:
        tasks = [t for t in tasks if t.get("status") == status]
    if assignee:
        tasks = [t for t in tasks if t.get("assignee") == assignee]
    if not include_archived:
        tasks = [t for t in tasks if not t.get("archived")]
    tasks.sort(key=lambda t: (t.get("created_at") or ""))
    return tasks


@app.get("/v1/kanban/tasks/{task_id}")
async def kanban_get_task(
    task_id: str,
    user_id: str | None = Query(default=None),
):
    lock = await _kanban_lock(user_id)
    async with lock:
        data = _read_kanban(user_id)
    task = data.get("tasks", {}).get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail=f"Task '{task_id}' not found")
    return task


@app.post("/v1/kanban/tasks")
async def kanban_create_task(
    req: KanbanTaskCreate,
    user_id: str | None = Query(default=None),
):
    lock = await _kanban_lock(user_id)
    async with lock:
        data = _read_kanban(user_id)
        board_slug = req.board or data.get("current_board") or "default"
        task = {
            "id": f"k-{uuid.uuid4().hex[:8]}",
            "board": board_slug,
            "title": req.title,
            "body": req.body or "",
            "assignee": req.assignee,
            "priority": req.priority,
            "tenant": req.tenant,
            "workspace": req.workspace,
            "skills": req.skills,
            "max_retries": req.max_retries,
            "status": "triage" if req.triage else "open",
            "blocked": False,
            "block_reason": None,
            "archived": False,
            "comments": [],
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat(),
        }
        data.setdefault("tasks", {})[task["id"]] = task
        _write_kanban(data, user_id)
    return task


class KanbanTaskUpdate(BaseModel):
    title: str | None = None
    body: str | None = None
    assignee: str | None = None
    status: str | None = None
    archived: bool | None = None
    blocked: bool | None = None
    block_reason: str | None = None


@app.patch("/v1/kanban/tasks/{task_id}")
async def kanban_update_task(
    task_id: str,
    req: KanbanTaskUpdate,
    user_id: str | None = Query(default=None),
):
    lock = await _kanban_lock(user_id)
    async with lock:
        data = _read_kanban(user_id)
        task = data.get("tasks", {}).get(task_id)
        if not task:
            raise HTTPException(status_code=404, detail=f"Task '{task_id}' not found")
        for k, v in req.model_dump(exclude_unset=True).items():
            task[k] = v
        task["updated_at"] = datetime.now().isoformat()
        _write_kanban(data, user_id)
    return task


class KanbanCommentCreate(BaseModel):
    body: str


@app.post("/v1/kanban/tasks/{task_id}/comments")
async def kanban_comment_task(
    task_id: str,
    req: KanbanCommentCreate,
    user_id: str | None = Query(default=None),
):
    lock = await _kanban_lock(user_id)
    async with lock:
        data = _read_kanban(user_id)
        task = data.get("tasks", {}).get(task_id)
        if not task:
            raise HTTPException(status_code=404, detail=f"Task '{task_id}' not found")
        comment = {
            "id": f"c-{uuid.uuid4().hex[:6]}",
            "body": req.body,
            "created_at": datetime.now().isoformat(),
        }
        task.setdefault("comments", []).append(comment)
        task["updated_at"] = comment["created_at"]
        _write_kanban(data, user_id)
    return comment





# âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

# Event â SSE mapping

# âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ



def _event_to_sse(event: Any) -> str | None:

    """Map a DrSai event to an SSE-formatted string. Returns None if skip."""



    # ââ Streaming token chunk ââââââââââââââââââââââââââââââââââââââââââââ

    if isinstance(event, ModelClientStreamingChunkEvent):

        if event.content:

            chunk = json.dumps({

                "choices": [{

                    "delta": {"content": event.content},

                    "index": 0,

                }]

            }, ensure_ascii=False)

            return f"data: {chunk}\n\n"

        return None



    # ââ Tool call request âââââââââââââââââââââââââââââââââââââââââââââââââ

    # Agent status/log updates, e.g. LLM retry warnings.
    if isinstance(event, AgentLogEvent):
        level = getattr(event, "send_level", "INFO")
        payload = json.dumps({
            "title": _safe_str(getattr(event, "title", "")),
            "content": _safe_str(getattr(event, "content", "")),
            "level": _safe_str(getattr(level, "value", level)),
            "content_type": _safe_str(getattr(event, "content_type", "")),
        }, ensure_ascii=False)

        return f"event: agent.log\ndata: {payload}\n\n"

    if isinstance(event, ToolCallRequestEvent):

        payload = json.dumps({

            "tool": _safe_str(event.content),

            "arguments": _safe_json(getattr(event, 'arguments', None)),

        }, ensure_ascii=False)

        return f"event: tool.progress\ndata: {payload}\n\n"



    # ââ Tool call result ââââââââââââââââââââââââââââââââââââââââââââââââââ

    if isinstance(event, ToolCallExecutionEvent):

        payload = json.dumps({

            "tool": _safe_str(event.content),

            "result": _safe_str(getattr(event, 'result', None)),

        }, ensure_ascii=False)

        return f"event: tool.result\ndata: {payload}\n\n"



    # ââ Thought/reasoning event âââââââââââââââââââââââââââââââââââââââââââ

    if ThoughtEvent and isinstance(event, ThoughtEvent):

        if event.content:

            chunk = json.dumps({

                "choices": [{

                    "delta": {"content": event.content, "role": "thinking"},

                    "index": 0,

                }]

            }, ensure_ascii=False)

            return f"data: {chunk}\n\n"

        return None



    # ââ User message echo (skip) ââââââââââââââââââââââââââââââââââââââââââ

    if isinstance(event, TextMessage) and event.source == "user":

        return None



    # ââ Final response with usage âââââââââââââââââââââââââââââââââââââââââ

    if isinstance(event, Response):

        payload = json.dumps({

            "choices": [{"delta": {}, "index": 0}],

            "usage": {

                "prompt_tokens": getattr(event, 'prompt_tokens', 0) or 0,

                "completion_tokens": getattr(event, 'completion_tokens', 0) or 0,

                "total_tokens": getattr(event, 'prompt_tokens', 0) + getattr(event, 'completion_tokens', 0),

            } if hasattr(event, 'prompt_tokens') else None,

        }, ensure_ascii=False)

        return f"data: {payload}\n\n"



    # ââ TaskResult (final) â [DONE] âââââââââââââââââââââââââââââââââââââââ

    if isinstance(event, TaskResult):

        return "data: [DONE]\n\n"



    return None





def _safe_str(val: Any) -> str:

    """Coerce a value to a safe string."""

    if val is None:

        return ""

    if isinstance(val, str):

        return val

    try:

        return str(val)

    except Exception:

        return "<unrepresentable>"





def _safe_json(val: Any) -> Any:

    """Coerce a value to a JSON-safe representation."""

    if val is None:

        return None

    if isinstance(val, (str, int, float, bool, list, dict)):

        try:

            json.dumps(val)

            return val

        except (TypeError, ValueError):

            return _safe_str(val)

    return _safe_str(val)





def _session_info_to_dict(info) -> dict:

    """Convert a SessionInfo (or dict) to a JSON-safe dict."""

    if isinstance(info, dict):

        return info

    if hasattr(info, '__dict__'):

        return {k: v for k, v in info.__dict__.items() if not k.startswith('_')}

    # Fallback: try to extract known fields

    result = {}

    for attr in ('thread_id', 'name', 'updated_at', 'message_count', 'preview', 'workdir'):

        if hasattr(info, attr):

            result[attr] = getattr(info, attr)

    return result





def _normalize_message(msg: dict) -> dict:

    """Normalize an autogen message dict to a uniform {role, content, type, ...} format.



    Autogen messages are stored with a ``type`` field (e.g. ``TextMessage``,

    ``ToolCallExecutionEvent``, ``FunctionExecutionResultMessage``) and a

    ``source`` field (``"user"`` / ``"assistant"``).  This helper maps those

    to a simplified role that the desktop renderer understands:

    - ``user``      â user bubble

    - ``assistant``  â agent bubble (Markdown)

    - ``tool``       â tool execution result

    - ``tool_request``â tool call request

    - ``thinking``   â thought/reasoning (collapsible)

    """

    msg_type = msg.get("type", "")

    source = msg.get("source", "")

    content = msg.get("content", "")



    # Normalize content to string

    if isinstance(content, str):

        content_str = content

    elif isinstance(content, (list, dict)):

        try:

            content_str = json.dumps(content, ensure_ascii=False)

        except (TypeError, ValueError):

            content_str = _safe_str(content)

    elif content is None:

        content_str = ""

    else:

        content_str = _safe_str(content)



    # Map type + source â role

    if msg_type == "TextMessage":

        role = "user" if source == "user" else "assistant"

    elif msg_type in ("ToolCallExecutionEvent", "FunctionExecutionResultMessage"):

        role = "tool"

    elif msg_type == "ToolCallRequestEvent":

        role = "tool_request"

    elif msg_type == "ThoughtEvent":

        role = "thinking"

    else:

        # Best-effort fallback: use source if available

        role = source if source in ("user", "assistant") else "assistant"



    return {

        "role": role,

        "content": content_str,

        "type": msg_type,

        "source": source,

        "timestamp": _safe_json(msg.get("timestamp")),

    }




# âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
# Entry point
# âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

def main():
    """Start the DrSai API gateway (uvicorn).

    NOTE: This is the legacy OpenAI-compatible SSE gateway used by the
    Electron desktop app. The new TUI uses ``drsai.backend.tui_gateway``
    (JSON-RPC). This module is preserved for desktop compatibility and
    wil
    l be deprecated when the Electron client migrates to JSON-RPC.
    """
    import sys
    sys.stderr.write(
        "\n"
        "================================================================\n"
        "  WARNING: gateway.py is the LEGACY SSE gateway (desktop only).\n"
        "  The new TUI uses drsai.backend.tui_gateway (JSON-RPC).\n"
        "  This module will be removed once the Electron client migrates.\n"
        "================================================================\n\n"
    )
    sys.stderr.flush()
    import uvicorn
    uvicorn.run(app, host=DEFAULT_HOST, port=DEFAULT_PORT)


if __name__ == "__main__":
    main()
