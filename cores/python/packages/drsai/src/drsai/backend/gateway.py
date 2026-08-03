"""

OpenDrSai API Server â FastAPI SSE streaming server wrapping OpenDrSai Assistant.



Provides an OpenAI-compatible /v1/chat/completions endpoint so the

Electron desktop app can drive a local OpenDrSai agent via HTTP SSE.



Also exposes session management, skills, memory, and agent control

(pause/resume/stop) endpoints â making it a full OpenDrSai Gateway.



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
import signal

import subprocess

import sys

import time

import traceback

import uuid

from contextlib import asynccontextmanager, nullcontext

from datetime import datetime

from pathlib import Path

from typing import Any, Optional

from urllib.parse import unquote, urlparse



from fastapi import FastAPI, File, Form, HTTPException, Query, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.exceptions import RequestValidationError
import httpx

from fastapi.responses import JSONResponse, Response as FastAPIResponse, StreamingResponse

from loguru import logger

from pydantic import BaseModel, ConfigDict, Field

from drsai.backend.remote_ssh.workspace import PROTOCOL_VERSION, canonical_workspace, ensure_protocol, workspace_child
from drsai.backend.remote_ssh.checkpoints import accept_checkpoint, create_checkpoint, list_checkpoints, preview_checkpoint, restore_checkpoint
from drsai.backend.runtime.registry import RuntimeRegistry
from drsai.backend.workspace.git_worktree_service import GitWorktreeError, GitWorktreeOWOPOperations, GitWorktreeService
from drsai.backend.runtime.terminal.state_service import TerminalStateService, TerminalWorkspaceBinding
from drsai.owop.local_workspace import LocalWorkspaceOperations, WorkspaceWatchJournal
from drsai.owop.process_pty import LocalProcessPtyOperations
from drsai.owop.protocol import OWOPProtocol
from drsai.owop.runtime_terminal import RuntimeTerminalOWOPOperations
from drsai.backend.runtime.engine import RuntimeEngine, RuntimeEngineIdentity
from drsai.backend.runtime.journal import SessionCursorExpired
from drsai.backend.runtime.artifacts import RuntimeArtifactStore
from drsai.backend.runtime.agent import (
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
from drsai.backend.runtime.conversation import StructuredConversationProjector
from drsai.backend.runtime.desktop_oaep_bridge import DesktopOaepJournalBridge
from drsai.backend.runtime.desktop_threads import DesktopThreadProjection
from drsai.backend.tui_gateway.adapter.event_translator import (
    TurnState as ConversationTranslationState,
    finalize as finalize_conversation_translation,
    translate as translate_conversation_event,
)
from drsai.backend.runtime.security import (
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
from drsai.config import (
    ConfigError as ModelProviderConfigError,
    ConfigConflict as ModelProviderConfigConflict,
    ConfigUpdateRequest,
    ProviderDraft,
    diagnose_model_config,
    discover_provider_models,
    guidance_for,
    last_known_good_path,
    list_provider_presets,
    latest_probe_result,
    probe_provider_draft,
    preview_update as preview_model_config_update,
    restore_last_known_good,
    commit_update as commit_model_config_update,
    config_revision as model_config_revision,
    load_user_config as load_model_provider_config,
    resolve_model_config,
    builtin_provider_names,
    test_provider_connection,
    telemetry_snapshot,
)
from drsai.config.loader import default_config_path as default_model_config_path

from drsai.modules.managers.database import DatabaseManager

from drsai.modules.managers.datamodel.db import Thread, RunStatus

from drsai.modules.managers.datamodel.types import Response as DBResponse
from drsai.modules.managers.messages import AgentLogEvent

from drsai.utils.utils import compress_state, decompress_state

from drsai.backend.cli.history import CLISessionStore
from drsai.platform_auth import (
    classify_model_error,
    context_from_bearer,
    get_platform_auth,
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
            return _normalize_default_model_alias(alias)
    except Exception as e:
        logger.debug(f"Failed to read default model alias from cli config: {e}")
    return DEFAULT_CONFIG_NAME


def _normalize_default_model_alias(alias: object) -> str:
    normalized = str(alias or "").strip()
    if normalized in {"deepseek-ai/deepseek-v4-pro", "hepai/deepseek-v4-pro"}:
        return "deepseek-v4-pro"
    return normalized or DEFAULT_CONFIG_NAME





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

    display_message: Optional[str] = Field(
        default=None,
        description="User-visible Desktop message mirrored into the OAEP journal.",
    )

    source_message_id: Optional[str] = Field(
        default=None,
        description="Stable client message identity used for cross-client deduplication.",
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
    from drsai.backend.integrations.hepai import discover_enabled_worker_tools
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


def _model_config_stamp() -> tuple[int, int] | None:
    """Cheap fingerprint used to detect manual config.toml edits."""
    try:
        stat = default_model_config_path().stat()
        return stat.st_mtime_ns, stat.st_size
    except OSError:
        return None


class AgentManager:

    """Manage OpenDrSai agent instances keyed by (user_id, thread_id) for session isolation.



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

        self._config_revisions: dict[str, int] = {}

        self._agent_config_revisions: dict[str, int] = {}

        self._agent_config_stamps: dict[str, tuple[int, int] | None] = {}
        self._agent_model_config_revisions: dict[str, str] = {}

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

            current_revision = self._config_revisions.get(uid, 0)

            agent_revision = self._agent_config_revisions.get(key, -1)

            active_config_stamp = _model_config_stamp()

            agent_config_stamp = self._agent_config_stamps.get(key)



            if (
                agent is None
                or agent_revision != current_revision
                or agent_config_stamp != active_config_stamp
                or (model_alias and model_alias != current_alias)
            ):

                previous_agent = agent

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

                self._agent_config_revisions[key] = current_revision

                self._agent_config_stamps[key] = active_config_stamp
                self._agent_model_config_revisions[key] = model_config_revision()

                if previous_agent is not None and previous_agent is not agent and hasattr(previous_agent, "close"):
                    try:
                        await previous_agent.close()
                    except Exception as exc:
                        logger.debug(f"close() after model config refresh failed for {key}: {exc}")



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
                self._agent_config_revisions.pop(k, None)
                self._agent_config_stamps.pop(k, None)
                self._agent_model_config_revisions.pop(k, None)
                if agent is not None and hasattr(agent, "close"):
                    try:
                        await agent.close()
                    except Exception as e:
                        logger.debug(f"close() during evict failed for {k}: {e}")
            return len(keys)

    async def mark_user_config_stale(self, user_id: str) -> int:
        """Apply model config on the next turn without interrupting active streams."""
        async with self._global_lock:
            revision = self._config_revisions.get(user_id, 0) + 1
            self._config_revisions[user_id] = revision
            return revision

    async def model_config_state(self, user_id: str) -> dict[str, object]:
        """Report configured versus live revisions without exposing session data."""
        configured = model_config_revision()
        async with self._global_lock:
            prefix = f"{user_id}:"
            runtime_count = sum(
                1 for key in self._agent_model_config_revisions if key.startswith(prefix)
            )
            active = sorted({
                revision
                for key, revision in self._agent_model_config_revisions.items()
                if key.startswith(prefix)
            })
        if not active:
            status = "not_started"
        elif active == [configured]:
            status = "applied"
        elif configured in active:
            status = "partially_applied"
        else:
            status = "pending_next_turn"
        return {
            "configured_revision": configured,
            "runtime_revisions": active,
            "runtime_status": status,
            "active_runtime_count": runtime_count,
        }



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

    logger.info(f"OpenDrSai API Server starting on {DEFAULT_HOST}:{DEFAULT_PORT}")

    # Initialize DB eagerly so first request doesn't pay the cost

    _get_db()

    _restore_runtime_workspaces()

    logger.info(f"Database ready: {_DB_URI}")

    logger.info(f"Default user: {_get_user_id()}")

    relay_stop, relay_task = await _start_runtime_relay_bridge()
    logger.info("OpenDrSai API Server startup hooks complete")

    yield

    logger.info("OpenDrSai API Server shutting down")

    if _runtime_agent_service_instance is not None:
        await _runtime_agent_service_instance.close()

    if _terminal_provider_instance is not None:
        _terminal_provider_instance.close()

    if relay_stop is not None:
        relay_stop.set()
    if relay_task is not None:
        try:
            await asyncio.wait_for(relay_task, timeout=5)
        except (TimeoutError, asyncio.CancelledError):
            relay_task.cancel()

    # Stop any cron schedulers we started so background tasks unwind cleanly
    for uid, sm in list(_schedulers.items()):
        try:
            await sm.stop()
            logger.info(f"Stopped ScheduledTaskManager for user {uid}")
        except Exception as e:
            logger.warning(f"Failed to stop scheduler for {uid}: {e}")





app = FastAPI(

    title="OpenDrSai API Server",

    version="0.2.0",

    lifespan=lifespan,

)

_REMOTE_PROTOCOL_VERSION = PROTOCOL_VERSION
_remote_workspaces: dict[str, Path] = {}
_runtime_registry_instance: RuntimeRegistry | None = None
_runtime_relay_connector: Any | None = None
_mobile_pairing_service_instance = None
_runtime_engine_instance: RuntimeEngine | None = None
_runtime_tool_dispatcher_instance: RuntimeToolDispatcher | None = None
_runtime_security_instance: RuntimeSecurity | None = None
_runtime_agent_service_instance: RuntimeAgentService | None = None
_git_worktree_service_instance: GitWorktreeService | None = None
_workspace_event_journal_instance: WorkspaceWatchJournal | None = None
_terminal_state_service_instance: TerminalStateService | None = None
_terminal_provider_instance: LocalProcessPtyOperations | None = None
_owop_protocol_instance: OWOPProtocol | None = None
_local_workspace_owop_instances: dict[str, LocalWorkspaceOperations] = {}
_runtime_artifact_store_instance: RuntimeArtifactStore | None = None
_REMOTE_CAPABILITY_VERSIONS = {
    "threads": 1,
    "chat": 1,
    "files": 2,
    "file-watch": 2,
    "git": 1,
    "approvals": 1,
    "hepai-worker": 1,
    "pty": 2,
    "owop": 1,
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
    "conversation.snapshot": 1,
    "session.event.resume": 1,
    "session.event.stream": 1,
    "session.event.cursor_expired": 1,
    "oaep.v1": 1,
    "oaep.session.snapshot": 1,
    "oaep.session.events": 1,
    "oaep.session.events.stream": 1,
    "event.cursor_expired": 1,
}

_RUNTIME_PROTOCOLS = {
    "oaep": {
        "version": "1.0",
        "profiles": ["oaep.session-stream/1"],
    },
    "owop": {
        "version": "1.0",
        "capabilities": [
            "workspace", "worktree", "files", "search", "watch", "git",
            "process", "pty", "checkpoint", "artifact",
        ],
    },
    "control": {"version": "1"},
    "relay": {"version": "2.0.0"},
}


async def _start_runtime_relay_bridge():
    """Start the optional Runtime-initiated Relay connection in this Full Runtime process."""
    from drsai.relay.device_identity import DeviceIdentityStore
    from drsai.relay.gateway_control import AiohttpGatewayTransport, GatewayRuntimeControlHandler
    from drsai.relay.runtime_client import (
        RuntimeCredentialStore,
        RuntimeOutboundConnector,
        resolve_runtime_version,
    )

    state_root = Path(os.environ.get("DRSAI_HOME", str(Path.home() / ".drsai"))).expanduser()
    relay_state = state_root / "runtime" / "relay"
    credential_path = relay_state / "credential.dpapi"
    url_path = relay_state / "relay-wss-url"
    configured_url = os.environ.get("OPENDRSAI_RELAY_WSS_URL", "").strip()
    if not configured_url and url_path.is_file():
        configured_url = url_path.read_text(encoding="utf-8").strip()
    if not configured_url or not credential_path.is_file():
        return None, None
    try:
        credential = RuntimeCredentialStore(credential_path).load()
        identity = DeviceIdentityStore(relay_state / "device-identity.dpapi").load_or_create()
        runtime = _runtime_registry().identity
        token = os.environ.get("OPENDRSAI_GATEWAY_INSTANCE_TOKEN", "").strip()
        if not token:
            raise RuntimeError("gateway_instance_token_required_for_relay")
        handler = GatewayRuntimeControlHandler(
            credential.runtime_id,
            AiohttpGatewayTransport(f"http://127.0.0.1:{DEFAULT_PORT}", token),
            state_root / "runtime",
        )
        connector = RuntimeOutboundConnector(
            configured_url, credential, identity, runtime.instance_id,
            resolve_runtime_version(os.environ.get("OPENDRSAI_RUNTIME_VERSION")),
            request_handler=handler,
            http_request_handler=handler.handle_http_request,
            event_provider=handler.relay_events,
            session_event_provider=handler.relay_session_events,
            oaep_event_provider=handler.relay_oaep_events,
            oaep_event_ack=handler.ack_relay_oaep_event,
            workspace_provider=handler.published_workspaces,
            backend_health={"opendrsai": "healthy"},
            wire_protocol=(
                "hai-http"
                if "/api/runtime-relay/" in urlparse(configured_url).path
                else "legacy-operation"
            ),
        )
        global _runtime_relay_connector
        _runtime_relay_connector = connector
        stop = asyncio.Event()

        async def run_after_server_startup() -> None:
            # Uvicorn opens the listening socket before the FastAPI lifespan
            # startup phase has completed.  The Relay connector immediately
            # polls this Gateway through that socket after WSS attach.  Give
            # Uvicorn one short startup window so those loopback requests do
            # not queue behind the still-running lifespan hook.
            await asyncio.sleep(10)
            await connector.run_forever(stop)

        task = asyncio.create_task(
            run_after_server_startup(),
            name="runtime-relay-bridge",
        )
        logger.info(f"Runtime Relay bridge enabled for {credential.runtime_id}")
        return stop, task
    except Exception as exc:
        logger.error(f"Runtime Relay bridge could not start: {exc}")
        return None, None


def _mark_workspace_catalog_changed() -> None:
    connector = _runtime_relay_connector
    if connector is None:
        return
    try:
        connector.mark_workspaces_dirty()
    except Exception as exc:
        logger.warning(f"Runtime workspace catalog dirty mark failed: {type(exc).__name__}")


def _runtime_registry() -> RuntimeRegistry:
    global _runtime_registry_instance
    if _runtime_registry_instance is None:
        state_root = Path(os.environ.get("DRSAI_HOME", str(Path.home() / ".drsai"))).expanduser()
        _runtime_registry_instance = RuntimeRegistry(state_root / "runtime" / "runtime.sqlite3")
    return _runtime_registry_instance


def _mobile_pairing_service():
    global _mobile_pairing_service_instance
    if _mobile_pairing_service_instance is None:
        from drsai.relay.mobile_pairing import MobilePairingService
        state_root = Path(os.environ.get("DRSAI_HOME", str(Path.home() / ".drsai"))).expanduser()
        _mobile_pairing_service_instance = MobilePairingService(state_root)
    return _mobile_pairing_service_instance


def _git_worktree_service() -> GitWorktreeService:
    global _git_worktree_service_instance
    registry = _runtime_registry()
    if _git_worktree_service_instance is None or _git_worktree_service_instance.registry is not registry:
        state_root = Path(os.environ.get("DRSAI_HOME", str(Path.home() / ".drsai"))).expanduser()
        _git_worktree_service_instance = GitWorktreeService(
            registry, state_root / "runtime" / "worktrees",
            active_resource_probe=_active_worktree_resources,
            event_journal=_workspace_event_journal(),
        )
    return _git_worktree_service_instance


def _workspace_event_journal() -> WorkspaceWatchJournal:
    global _workspace_event_journal_instance
    if _workspace_event_journal_instance is None:
        state_root = Path(os.environ.get("DRSAI_HOME", str(Path.home() / ".drsai"))).expanduser()
        _workspace_event_journal_instance = WorkspaceWatchJournal(state_root / "runtime" / "workspace-events.sqlite3")
    return _workspace_event_journal_instance


def _terminal_state_service() -> TerminalStateService:
    global _terminal_state_service_instance, _terminal_provider_instance
    registry = _runtime_registry()
    if _terminal_state_service_instance is None:
        state_root = Path(os.environ.get("DRSAI_HOME", str(Path.home() / ".drsai"))).expanduser()
        provider_root = state_root / "runtime"
        provider_root.mkdir(parents=True, exist_ok=True)
        configured_node_pty = os.environ.get("OPENDRSAI_NODE_PTY_MODULE", "").strip()
        _terminal_provider_instance = LocalProcessPtyOperations(
            provider_root,
            node_pty_module=Path(configured_node_pty) if configured_node_pty else None,
        )

        def resolve(workspace_id: str) -> TerminalWorkspaceBinding | None:
            workspace = registry.get_workspace(workspace_id, include_closed=True)
            if workspace is None or not workspace.open:
                return None
            worktree = registry.get_worktree_by_workspace(workspace_id)
            return TerminalWorkspaceBinding(
                workspace_id, Path(workspace.path), worktree.worktree_id if worktree else None
            )

        _terminal_state_service_instance = TerminalStateService(
            provider_root / "terminals.sqlite3",
            registry.identity.runtime_id,
            _terminal_provider_instance,
            resolve,
        )
    return _terminal_state_service_instance


def _owop_protocol() -> OWOPProtocol:
    global _owop_protocol_instance
    if _owop_protocol_instance is None:
        _owop_protocol_instance = OWOPProtocol()
    return _owop_protocol_instance


def _active_worktree_resources(workspace_id: str) -> list[dict[str, Any]]:
    resources = _runtime_engine().active_workspace_resources(workspace_id)
    for terminal in _terminal_state_service().list(workspace_id):
        if terminal["status"] in {"starting", "running", "detached", "reconnecting"}:
            resources.append({"kind": "terminal", "id": terminal["terminal_id"]})
    remote_pty = sys.modules.get("drsai.backend.remote_ssh.pty")
    manager_instance = getattr(remote_pty, "manager", None) if remote_pty else None
    for terminal in getattr(manager_instance, "sessions", {}).values():
        if terminal.workspace_id == workspace_id and not terminal.exited:
            resources.append({"kind": "terminal", "id": terminal.id})
    return resources


def _runtime_engine() -> RuntimeEngine:
    global _runtime_engine_instance
    if _runtime_engine_instance is None:
        state_root = Path(os.environ.get("DRSAI_HOME", str(Path.home() / ".drsai"))).expanduser()
        registry = _runtime_registry()
        _runtime_engine_instance = RuntimeEngine(
            state_root / "runtime" / "engine.sqlite3",
            RuntimeEngineIdentity(registry.identity.runtime_id, registry.identity.instance_id),
            lambda workspace_id: bool((record := registry.get_workspace(workspace_id, include_closed=True)) and record.open),
            lambda workspace_id: (record.worktree_id if (record := registry.get_worktree_by_workspace(workspace_id)) else None),
        )
    return _runtime_engine_instance


def _desktop_thread_projection() -> DesktopThreadProjection:
    state_root = Path(os.environ.get("DRSAI_HOME", str(Path.home() / ".drsai"))).expanduser()
    return DesktopThreadProjection(state_root)


def _sync_desktop_sessions(workspace_id: str) -> tuple[DesktopThreadProjection, list[dict[str, Any]]]:
    projection = _desktop_thread_projection()
    workspace = _runtime_registry().get_workspace(workspace_id, include_closed=True)
    if workspace is None or not workspace.open:
        return projection, []
    rows = projection.threads_for_workspace(workspace.path)
    for row in rows:
        _runtime_engine().import_session(
            str(row["session_id"]),
            workspace_id,
            str(row["title"]),
            agent_definition=row.get("agent_definition"),
            backend_id=row.get("backend_id"),
            created_at=str(row.get("created_at") or ""),
            updated_at=str(row.get("updated_at") or ""),
            archived=bool(row.get("archived")),
        )
    return projection, rows


def _sync_desktop_session_id(session_id: str) -> DesktopThreadProjection:
    projection = _desktop_thread_projection()
    if not projection.has_thread(session_id):
        return projection
    for workspace in _runtime_registry().list_workspaces(include_closed=False):
        rows = projection.threads_for_workspace(workspace.path)
        row = next(
            (item for item in rows if item["session_id"] == session_id),
            None,
        )
        if row is None:
            continue
        _runtime_engine().import_session(
            session_id,
            workspace.workspace_id,
            str(row["title"]),
            agent_definition=row.get("agent_definition"),
            backend_id=row.get("backend_id"),
            created_at=str(row.get("created_at") or ""),
            updated_at=str(row.get("updated_at") or ""),
            archived=bool(row.get("archived")),
        )
        break
    return projection


def _runtime_tool_dispatcher() -> RuntimeToolDispatcher:
    global _runtime_tool_dispatcher_instance
    if _runtime_tool_dispatcher_instance is None:
        _runtime_tool_dispatcher_instance = RuntimeToolDispatcher(
            _runtime_engine(), tools={"artifact.publish": _publish_runtime_artifact}
        )
    return _runtime_tool_dispatcher_instance


def _runtime_artifact_store() -> RuntimeArtifactStore:
    global _runtime_artifact_store_instance
    if _runtime_artifact_store_instance is None:
        state_root = Path(os.environ.get("DRSAI_HOME", str(Path.home() / ".drsai"))).expanduser()
        _runtime_artifact_store_instance = RuntimeArtifactStore(
            state_root / "runtime" / "artifacts.sqlite3", lambda workspace_id: _workspace_root(workspace_id)
        )
    return _runtime_artifact_store_instance


def _publish_runtime_artifact(context: RuntimeRunContext, arguments: dict[str, Any]) -> dict[str, Any]:
    item = _runtime_artifact_store().publish(context, arguments)
    _runtime_engine().append_event(context.run_id, "artifact.created", item)
    return item


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


class GatewayOpenDrSaiAgentBackend:
    """Run the production Desktop OpenDrSai agent behind the Runtime contract."""

    backend_id = "opendrsai"

    def __init__(self, runner: Any = None):
        self._runner = runner
        self._closed = False
        self._cancellations: dict[str, CancellationToken] = {}

    async def execute(
        self,
        context: RuntimeRunContext,
        definition: AgentDefinition,
        prompt: str,
        services: Any,
    ) -> dict[str, Any]:
        if self._closed:
            raise RuntimeExecutionError("agent_backend_closed", "OpenDrSai Agent Backend is closed.")
        auth = get_platform_auth()
        if auth is None:
            raise RuntimeExecutionError(
                "model_unauthorized",
                "A valid HepAI identity is required.",
            )
        cancellation = CancellationToken()
        self._cancellations[context.run_id] = cancellation
        state = ConversationTranslationState()
        content_parts: list[str] = []
        services.emit(context, "agent.started", {
            "backend": self.backend_id,
            "prompt_length": len(prompt),
        })
        try:
            run_stream = self._runner or manager.run_stream
            events = run_stream(
                task=prompt,
                thread_id=context.session_id,
                user_id=auth.subject,
                model_alias=definition.model,
                work_dir=str(context.workspace_path),
                cancellation_token=cancellation,
            )
            async for event in events:
                for event_type, payload in translate_conversation_event(event, state):
                    normalized_type, normalized_payload = self._normalize_event(event_type, payload)
                    if normalized_type == "agent.message.delta":
                        content_parts.append(str(normalized_payload.get("delta") or ""))
                    services.emit(context, normalized_type, normalized_payload)
            content = "".join(content_parts)
            services.emit(context, "agent.completed", {"content": content})
            return {"content": content}
        except asyncio.CancelledError as exc:
            raise RuntimeExecutionError("run_cancelled", "Run was cancelled.") from exc
        except RuntimeExecutionError:
            raise
        except Exception as exc:
            error = classify_model_error(exc)
            raise RuntimeExecutionError(
                str(error.get("code") or "agent_execution_failed"),
                str(error.get("message") or "Agent execution failed."),
                retryable=bool(error.get("retryable")),
            ) from exc
        finally:
            self._cancellations.pop(context.run_id, None)

    @staticmethod
    def _normalize_event(event_type: str, payload: dict[str, Any]) -> tuple[str, dict[str, Any]]:
        if event_type == "message.delta":
            delta = str(payload.get("text") or payload.get("delta") or payload.get("content") or "")
            return "agent.message.delta", {
                **payload,
                "delta": delta,
                "content": delta,
            }
        if event_type == "tool.start":
            return "tool.started", payload
        if event_type == "tool.complete":
            return "tool.completed", payload
        return event_type, payload

    async def cancel(self, run_id: str) -> None:
        cancellation = self._cancellations.get(run_id)
        if cancellation is not None:
            cancellation.cancel()

    async def respond_approval(self, run_id: str, approval_id: str, decision: str) -> None:
        raise RuntimeExecutionError(
            "approval_not_found",
            "OpenDrSai Approval is no longer pending.",
        )

    async def recover(self, run_id: str) -> None:
        if self._closed:
            raise RuntimeExecutionError("agent_backend_closed", "OpenDrSai Agent Backend is closed.")

    async def health(self) -> dict[str, Any]:
        return {
            "backend_id": self.backend_id,
            "available": not self._closed,
            "reason": "closed" if self._closed else None,
        }

    async def close(self) -> None:
        self._closed = True
        for cancellation in self._cancellations.values():
            cancellation.cancel()
        self._cancellations.clear()


def _runtime_agent_service(auth_context: Any = None) -> RuntimeAgentService:
    """Return the process-owned Backend service; request identity is validated before dispatch."""
    global _runtime_agent_service_instance
    if _runtime_agent_service_instance is None:
        state_root = Path(os.environ.get("DRSAI_HOME", str(Path.home() / ".drsai"))).expanduser()
        _ensure_builtin_agent_definitions(state_root)
        backend = (
            OpenDrSaiAgentBackend(_controlled_runtime_model_turn)
            if os.environ.get("DRSAI_RUNTIME_CONTROLLED_MODEL") == "1"
            else GatewayOpenDrSaiAgentBackend()
        )
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
    def ensure(payload: dict[str, Any]) -> None:
        path = (
            state_root
            / "assets"
            / "agents"
            / str(payload["id"])
            / f"{payload['version']}.json"
        )
        if path.exists():
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(".tmp")
        temporary.write_text(
            json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        os.replace(temporary, path)

    ensure({
        "id": "opendrsai", "version": "1", "backend": "opendrsai",
        "instructions": "Use the production OpenDrSai Agent in this Windows Runtime Workspace.",
        "permissions": [],
    })
    ensure({
        "id": "codex", "version": "1", "backend": "codex", "model": "gpt-5.4",
        "instructions": "Work only inside the Runtime-authoritative Workspace and report verifiable results.",
        "permissions": ["workspace:read", "workspace:write", "files:write", "process:execute", "permissions:grant"],
        "backend_config": {"approvalPolicy": "on-request", "sandbox": "workspace-write"},
    })
    if os.environ.get("DRSAI_RUNTIME_CONTROLLED_MODEL") == "1":
        ensure({
            "id": "mobile-acceptance",
            "version": "1",
            "name": "Mobile Acceptance",
            "backend": "opendrsai",
            "instructions": "Run only the controlled, read-only mobile acceptance plan.",
            "permissions": ["shell:python"],
            "controlled_plan": {
                "calls": [
                    {
                        "kind": "approval",
                        "name": "shell:python",
                        "arguments": {
                            "risk_summary": "Allow controlled read-only shell output",
                            "scope": "workspace",
                            "timeout_seconds": 300,
                        },
                    },
                    {
                        "kind": "shell",
                        "name": "python",
                        "arguments": {
                            "command": [
                                sys.executable,
                                "-c",
                                "print('opendrsai-mobile-acceptance')",
                            ]
                        },
                    },
                ],
                "content": "mobile acceptance completed",
            },
        })


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
    display_name: str | None = Field(default=None, min_length=1, max_length=120, pattern=r"^[^\r\n\x00]*\S[^\r\n\x00]*$")


class RuntimeWorkspaceRenameRequest(BaseModel):
    display_name: str = Field(min_length=1, max_length=120, pattern=r"^[^\r\n\x00]*\S[^\r\n\x00]*$")


class RemoteWorktreeRequest(BaseModel):
    intent: str = Field(default="subtask", max_length=240)
    idempotency_key: str | None = Field(default=None, min_length=1, max_length=256)
    location: str = Field(default="remote", pattern="^(local|remote)$")


class RuntimeWorktreeAdoptRequest(BaseModel):
    idempotency_key: str = Field(min_length=1, max_length=256)
    canonical_path: str = Field(min_length=1, max_length=4096)
    branch: str = Field(min_length=1, max_length=255)
    base_ref: str = Field(min_length=1, max_length=128)
    location: str = Field(pattern="^(local|remote)$")


class RuntimeWorktreeMergeRequest(BaseModel):
    idempotency_key: str = Field(min_length=1, max_length=256)
    expected_head: str | None = Field(default=None, min_length=7, max_length=128)


class RuntimeWorktreeRemoveRequest(BaseModel):
    idempotency_key: str = Field(min_length=1, max_length=256)
    expected_status: str = Field(pattern="^(merged|archived)$")


class RuntimeWorktreePruneRequest(BaseModel):
    idempotency_key: str = Field(min_length=1, max_length=256)
    dry_run: bool = True


class RuntimeWorktreeArchiveRequest(BaseModel):
    idempotency_key: str = Field(min_length=1, max_length=256)


class RuntimeSessionCreateRequest(BaseModel):
    workspace_id: str = Field(min_length=1, max_length=160)
    title: str = Field(default="New session", max_length=240)
    agent_definition: str | None = Field(default=None, min_length=1, max_length=500)
    backend_id: str | None = Field(default=None, min_length=1, max_length=128)


class RuntimeSessionUpdateRequest(BaseModel):
    title: str | None = Field(default=None, max_length=240)
    archived: bool | None = None
    lifecycle: str | None = Field(default=None, pattern="^(active|archived|removed)$")


class RuntimeRunCreateRequest(BaseModel):
    agent_definition: str = Field(min_length=1, max_length=500)


class RuntimeRunTransitionRequest(BaseModel):
    status: str


class RuntimeRunExecuteRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=200_000)
    user_id: str | None = Field(default=None, max_length=200)
    thread_id: str | None = Field(default=None, max_length=256)
    metadata: dict[str, Any] = Field(default_factory=dict)


class BackendAccountLoginRequest(BaseModel):
    type: str = Field(default="chatgpt", pattern=r"^(chatgpt|chatgptDeviceCode)$")


class BackendAccountLoginCancelRequest(BaseModel):
    login_id: str = Field(min_length=1, max_length=256)


class MobilePairingRegistrationRequest(BaseModel):
    registration_code: str = Field(min_length=16, max_length=2048, pattern=r"^[^\r\n\x00]+$")
    relay_https_url: str = Field(min_length=1, max_length=512)
    display_name: str = Field(min_length=1, max_length=120, pattern=r"^[^\r\n\x00]*\S[^\r\n\x00]*$")


class MobilePairingFaultRequest(BaseModel):
    ttl_seconds: int = Field(default=5, ge=1, le=30)


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
    idempotency_key: str | None = Field(default=None, pattern=r"^[A-Za-z0-9_.:-]{1,200}$")


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


def _chat_runtime_workspace_id(request: ChatRequest, raw_request: Request) -> str:
    """Resolve a Desktop chat request to one open, registered Workspace."""
    registry = _runtime_registry()
    explicit = (
        registry.get_workspace(request.workspace_id, include_closed=True)
        if request.workspace_id
        else None
    )
    if request.workspace_id and (explicit is None or not explicit.open):
        raise HTTPException(
            status_code=409,
            detail={
                "code": "workspace_not_open",
                "message": "Desktop OAEP mirroring requires an open registered Workspace.",
                "retryable": False,
            },
        )

    raw_header = raw_request.headers.get("x-opendrsai-workspace", "").strip()
    supplied_path = request.work_dir or (unquote(raw_header) if raw_header else "")
    candidate = _canonical_workspace(supplied_path) if supplied_path else None
    matches = []
    if candidate is not None:
        for record in registry.list_workspaces(include_closed=False):
            root = _canonical_workspace(record.path)
            try:
                candidate.relative_to(root)
            except ValueError:
                continue
            matches.append((len(root.parts), record))
    resolved = max(matches, key=lambda entry: entry[0])[1] if matches else explicit
    if resolved is None:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "workspace_not_registered",
                "message": "Desktop OAEP mirroring requires a registered Workspace.",
                "retryable": False,
            },
        )
    if explicit is not None and explicit.workspace_id != resolved.workspace_id:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "workspace_identity_mismatch",
                "message": "Desktop Workspace id and path identify different Workspaces.",
                "retryable": False,
            },
        )
    return str(resolved.workspace_id)


def _prepare_desktop_oaep_bridge(
    request: ChatRequest,
    raw_request: Request,
) -> DesktopOaepJournalBridge | None:
    metadata = request.metadata if isinstance(request.metadata, dict) else {}
    request_id = str(metadata.get("desktop_request_id") or "").strip()
    if not request_id:
        return None
    if not request.thread_id or request.display_message is None:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "desktop_oaep_identity_required",
                "message": "Desktop OAEP mirroring requires Session and display-message identities.",
                "retryable": False,
            },
        )
    workspace_id = _chat_runtime_workspace_id(request, raw_request)
    _sync_desktop_session_id(request.thread_id)
    engine = _runtime_engine()
    try:
        session = engine.get_session(request.thread_id)
    except KeyError:
        session, _ = engine.import_session(
            request.thread_id,
            workspace_id,
            str(request.display_message).strip()[:80] or "Desktop session",
            agent_definition="opendrsai@1",
            backend_id="opendrsai",
        )
    if str(session["workspace_id"]) != workspace_id:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "session_workspace_mismatch",
                "message": "Desktop Session belongs to another Workspace.",
                "retryable": False,
            },
        )
    try:
        return DesktopOaepJournalBridge.begin(
            engine,
            session_id=request.thread_id,
            request_id=request_id,
            display_message=request.display_message,
            source_message_id=str(request.source_message_id or request_id),
            correlation_id=str(metadata.get("correlation_id") or request_id),
            agent_definition=str(session.get("agent_definition") or "opendrsai@1"),
            backend_id=str(session.get("backend_id") or "opendrsai"),
            retry_attempt=int(metadata.get("network_retry_attempt") or 0),
            resume_from_chars=int(metadata.get("resume_from_chars") or 0),
        )
    except (KeyError, ValueError) as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "desktop_oaep_conflict",
                "message": str(exc),
                "retryable": False,
            },
        ) from exc


@app.middleware("http")
async def authenticate_desktop_gateway(request: Request, call_next):
    supplied_correlation = request.headers.get("x-correlation-id", "")
    correlation_id = supplied_correlation if re.fullmatch(r"[A-Za-z0-9._:-]{1,128}", supplied_correlation) else uuid.uuid4().hex
    request.state.correlation_id = correlation_id
    trace_id = request.headers.get("x-opendrsai-trace-id", "")
    span_id = request.headers.get("x-opendrsai-span-id", "")
    parent_span_id = request.headers.get("x-opendrsai-parent-span-id", "")
    request.state.diagnostic_trace_id = trace_id if re.fullmatch(r"[A-Za-z0-9._:-]{1,256}", trace_id) else ""
    request.state.diagnostic_span_id = span_id if re.fullmatch(r"[A-Za-z0-9._:-]{1,256}", span_id) else ""
    request.state.diagnostic_parent_span_id = parent_span_id if re.fullmatch(r"[A-Za-z0-9._:-]{1,256}", parent_span_id) else ""
    try:
        sent_at = int(request.headers.get("x-opendrsai-sent-at", "0"))
    except ValueError:
        sent_at = 0
    request.state.diagnostic_clock_offset_ms = int(time.time() * 1000) - sent_at if sent_at > 0 else 0
    if not verify_gateway_instance(request.headers.get("x-opendrsai-gateway-token")):
        return JSONResponse(
            status_code=401,
            content={"error": {"code": "gateway_unauthorized", "message": "Gateway caller is not authorized.", "retryable": False, "correlation_id": correlation_id}},
            headers={"X-Correlation-ID": correlation_id},
        )
    response = await call_next(request)
    response.headers["X-Correlation-ID"] = correlation_id
    if request.state.diagnostic_trace_id:
        response.headers["X-OpenDrSai-Trace-ID"] = request.state.diagnostic_trace_id
        response.headers["X-OpenDrSai-Clock-Offset-Ms"] = str(request.state.diagnostic_clock_offset_ms)
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
        "dev_managed": os.environ.get("DRSAI_GATEWAY_DEV_MANAGED") == "1",
    }


@app.post("/v1/runtime/shutdown")
async def runtime_shutdown():
    """Stop this authenticated Runtime instance after the response is flushed."""
    loop = asyncio.get_running_loop()
    loop.call_later(0.2, lambda: os.kill(os.getpid(), signal.SIGTERM))
    return {"stopping": True, "instance_id": _runtime_registry().identity.instance_id}


@app.get("/v1/capabilities")
async def runtime_capabilities():
    return {
        "protocol_version": _REMOTE_PROTOCOL_VERSION,
        "protocols": _RUNTIME_PROTOCOLS,
        "capabilities": sorted(_REMOTE_CAPABILITY_VERSIONS),
        "capability_versions": _REMOTE_CAPABILITY_VERSIONS,
        "agent_backends": await _runtime_agent_service().health(),
    }


@app.get("/v1/agent-definitions")
async def runtime_agent_definitions():
    """Publish only immutable, selectable Agent Definition metadata."""
    service = _runtime_agent_service()
    health = await service.health()
    rows = []
    root = service.definitions.root
    for path in sorted(root.glob("*/*.json")) if root.exists() else ():
        try:
            definition = service.definitions.load(f"{path.parent.name}@{path.stem}")
        except RuntimeExecutionError:
            continue
        backend = health.get(definition.backend, {})
        rows.append(
            {
                "definition_id": definition.asset_id,
                "version": definition.version,
                "display_name": str(
                    definition.raw.get("name") or definition.asset_id
                ),
                "backend_id": definition.backend,
                "backend_health": (
                    "healthy" if backend.get("available") else "unavailable"
                ),
                "capabilities": sorted(definition.permissions),
            }
        )
    return {"items": rows}


def _mobile_pairing_http_error(exc):
    status = 404 if exc.code in {"runtime_not_registered", "access_grant_not_found"} else \
        401 if exc.code == "runtime_credential_invalid" else \
        403 if exc.code in {"runtime_access_forbidden", "fault_injection_disabled"} else \
        429 if exc.code == "pairing_rate_limited" else \
        503 if exc.retryable else 409
    return HTTPException(status_code=status, detail={
        "code": exc.code, "message": exc.message, "retryable": exc.retryable,
        "correlation_id": exc.correlation_id,
        "detail": {"action": exc.action},
    })


def _trusted_mobile_pairing_relay(value: str) -> tuple[str, str]:
    parsed = urlparse(value.strip())
    host = (parsed.hostname or "").lower()
    try:
        port = parsed.port
    except ValueError:
        port = -1
    if (parsed.scheme != "https" or parsed.username or parsed.password or
            port not in {None, 443} or host not in {"ai.ihep.ac.cn", "ai-dev.ihep.ac.cn"} or
            parsed.path.rstrip("/") != "/api/runtime-relay" or parsed.query or parsed.fragment):
        raise HTTPException(status_code=400, detail={"code": "relay_url_not_trusted",
                                                    "message": "Runtime Relay URL is not trusted."})
    root = f"https://{host}/api/runtime-relay"
    return root, f"wss://{host}/api/runtime-relay/v1/runtime-connect"


@app.post("/v1/mobile-pairing/register")
async def runtime_mobile_pairing_register(request: MobilePairingRegistrationRequest):
    """Consume a short-lived code locally; the HepAI OIDC token never enters Runtime."""
    from drsai.relay.device_identity import DeviceIdentityStore
    from drsai.relay.runtime_client import (
        AiohttpRegistrationTransport,
        RuntimeCredentialStore,
        RuntimeEnrollmentClient,
        resolve_runtime_version,
    )

    relay_https, relay_wss = _trusted_mobile_pairing_relay(request.relay_https_url)
    state_root = Path(os.environ.get("DRSAI_HOME", str(Path.home() / ".drsai"))).expanduser()
    relay_state = state_root / "runtime" / "relay"
    try:
        enrollment = RuntimeEnrollmentClient(
            DeviceIdentityStore(relay_state / "device-identity.dpapi"),
            AiohttpRegistrationTransport(relay_https),
        )
        credential = await enrollment.enroll(
            request.registration_code,
            request.display_name.strip(),
            resolve_runtime_version(os.environ.get("OPENDRSAI_RUNTIME_VERSION")),
        )
        RuntimeCredentialStore(relay_state / "credential.dpapi").save(credential)
        relay_state.mkdir(parents=True, exist_ok=True)
        temporary = relay_state / "relay-wss-url.tmp"
        temporary.write_text(relay_wss, encoding="utf-8")
        temporary.replace(relay_state / "relay-wss-url")
        return {"registered": True, "runtime_id": credential.runtime_id}
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Runtime Relay enrollment failed")
        raise HTTPException(status_code=502, detail={"code": "runtime_registration_failed",
                                                    "message": "Runtime Relay registration failed."}) from exc


@app.get("/v1/mobile-pairing/status")
async def runtime_mobile_pairing_status():
    result = _mobile_pairing_service().readiness()
    # Relay enrollment identity and Gateway process identity serve different
    # scopes. Exposing both lets Desktop prove that pairing was routed to the
    # Runtime that owns the selected Workspace without disclosing credentials.
    result["gateway_runtime_id"] = _runtime_registry().identity.runtime_id
    return result


@app.get("/v1/mobile-pairing/diagnostics/workspace-lifecycles")
async def runtime_mobile_pairing_workspace_lifecycles():
    """Return path-free Runtime lifecycle counts for local acceptance tooling."""
    counts = {"active": 0, "archived": 0, "removed": 0}
    for record in _runtime_registry().list_workspaces(include_closed=True):
        if record.lifecycle not in counts:
            raise HTTPException(
                status_code=500,
                detail={"code": "workspace_lifecycle_invalid"},
            )
        counts[record.lifecycle] += 1
    return {"counts": counts, "total": sum(counts.values())}


@app.post("/v1/mobile-pairing/grants")
async def runtime_mobile_pairing_create():
    from drsai.relay.mobile_pairing import MobilePairingError
    try:
        return (await _mobile_pairing_service().create()).public()
    except MobilePairingError as exc:
        raise _mobile_pairing_http_error(exc) from exc


@app.get("/v1/mobile-pairing/grants/{grant_id}")
async def runtime_mobile_pairing_read(grant_id: str):
    from drsai.relay.mobile_pairing import MobilePairingError
    try:
        return (await _mobile_pairing_service().read(grant_id)).public()
    except MobilePairingError as exc:
        raise _mobile_pairing_http_error(exc) from exc


@app.delete("/v1/mobile-pairing/grants/{grant_id}")
async def runtime_mobile_pairing_revoke(grant_id: str):
    from drsai.relay.mobile_pairing import MobilePairingError
    try:
        return (await _mobile_pairing_service().revoke(grant_id)).public()
    except MobilePairingError as exc:
        raise _mobile_pairing_http_error(exc) from exc


@app.get("/v1/mobile-pairing/associations")
async def runtime_mobile_pairing_associations():
    from drsai.relay.mobile_pairing import MobilePairingError
    try:
        return {"items": [
            item.public() for item in await _mobile_pairing_service().associations()
        ]}
    except MobilePairingError as exc:
        raise _mobile_pairing_http_error(exc) from exc


@app.delete("/v1/mobile-pairing/associations/{association_id}")
async def runtime_mobile_pairing_revoke_association(association_id: str):
    from drsai.relay.mobile_pairing import MobilePairingError
    try:
        return (
            await _mobile_pairing_service().revoke_association(association_id)
        ).public()
    except MobilePairingError as exc:
        raise _mobile_pairing_http_error(exc) from exc


@app.delete("/v1/mobile-pairing/enrollment")
async def runtime_mobile_pairing_revoke_enrollment():
    from drsai.relay.mobile_pairing import MobilePairingError
    try:
        return await _mobile_pairing_service().revoke_enrollment()
    except MobilePairingError as exc:
        raise _mobile_pairing_http_error(exc) from exc


@app.post(
    "/v1/mobile-pairing/fault-injections/connection-owner-restart",
    status_code=202,
)
async def runtime_mobile_pairing_inject_connection_owner_restart(
    request: MobilePairingFaultRequest,
):
    """Test-only relay fault; local instance-token middleware remains mandatory."""
    from drsai.relay.mobile_pairing import MobilePairingError
    try:
        return await _mobile_pairing_service().inject_connection_owner_restart(
            request.ttl_seconds
        )
    except MobilePairingError as exc:
        raise _mobile_pairing_http_error(exc) from exc


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


@app.post("/v1/agent-backends/{backend_id}/restart")
async def runtime_backend_restart(backend_id: str):
    try:
        return await _runtime_agent_service().restart_backend(backend_id)
    except RuntimeExecutionError as exc:
        raise _backend_account_http_error(exc) from exc


@app.post("/v1/workspaces/{workspace_id}/agent-backends/{backend_id}/sessions/sync")
async def runtime_backend_session_sync(workspace_id: str, backend_id: str):
    try:
        return await _runtime_agent_service().sync_backend_sessions(backend_id, workspace_id)
    except RuntimeExecutionError as exc:
        raise _backend_account_http_error(exc) from exc


@app.post("/v1/sessions/{session_id}/agent-backend/history/sync")
async def runtime_backend_session_history_sync(session_id: str):
    try:
        return await _runtime_agent_service().sync_backend_session_history(session_id)
    except RuntimeExecutionError as exc:
        raise _backend_account_http_error(exc) from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Session not found") from exc
    except Exception:
        logger.exception(f"Backend session history sync failed for {session_id}")
        raise


@app.websocket("/v1/pty")
async def remote_pty_socket(websocket: WebSocket):
    await websocket.accept()
    try: authentication = await asyncio.wait_for(websocket.receive_json(), timeout=5)
    except (asyncio.TimeoutError, WebSocketDisconnect): await websocket.close(code=4401); return
    if authentication.get("type") != "auth" or not verify_gateway_instance(authentication.get("token")):
        await websocket.close(code=4401); return
    if sys.platform == "win32":
        await websocket.close(code=4400, reason="Remote PTY requires Linux"); return
    from drsai.backend.remote_ssh.pty import manager as pty_manager
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
        record = _runtime_registry().open_workspace(req.path, display_name=req.display_name)
    except (FileNotFoundError, OSError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    root = Path(record.path)
    _remote_workspaces[record.workspace_id] = root
    if principal:
        _runtime_security().permissions.set_role(record.workspace_id, principal.principal_id, "owner")
    _remote_audit("workspace.open", workspace_id=record.workspace_id, path=record.path)
    _mark_workspace_catalog_changed()
    return record.as_dict()


@app.put("/v1/workspaces/{workspace_id}/display-name")
async def runtime_workspace_display_name_update(workspace_id: str, req: RuntimeWorkspaceRenameRequest, raw_request: Request):
    if _security_enabled():
        _authorize_request(raw_request, workspace_id, "workspace.write", {"operation": "workspace.rename"})
    try:
        record = _runtime_registry().update_workspace_display_name(workspace_id, req.display_name)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    _remote_audit("workspace.rename", workspace_id=record.workspace_id)
    _mark_workspace_catalog_changed()
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
        return _runtime_engine().create_session(
            request.workspace_id,
            request.title,
            agent_definition=request.agent_definition,
            backend_id=request.backend_id,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/v1/sessions")
async def runtime_session_list(workspace_id: str, offset: int = Query(default=0, ge=0), limit: int = Query(default=50, ge=1, le=200), archived: bool | None = False):
    try:
        # Desktop Threads are one producer of authoritative Runtime Sessions,
        # not a replacement catalog. Import their latest metadata first, then
        # list the unified engine store so Sessions created by Android/SDK
        # remain visible to every client.
        _sync_desktop_sessions(workspace_id)
        return _runtime_engine().list_sessions(
            workspace_id, offset=offset, limit=limit, archived=archived
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/v1/sessions/{session_id}")
async def runtime_session_get(session_id: str):
    try:
        _sync_desktop_session_id(session_id)
        return _runtime_engine().get_session(session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/v1/sessions/{session_id}/runs")
async def runtime_session_run_list(
    session_id: str,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
):
    try:
        _sync_desktop_session_id(session_id)
        rows = _runtime_engine().list_session_runs(session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    page = rows[offset:offset + limit]
    return {"object": "list", "data": page, "total": len(rows), "offset": offset}


@app.get("/v1/sessions/{session_id}/conversation")
async def runtime_session_conversation(
    session_id: str,
    cursor: str | None = None,
    limit: int = Query(default=100, ge=1, le=500),
):
    try:
        projection = _sync_desktop_session_id(session_id)
        if projection.has_thread(session_id):
            desktop_items = projection.conversation(session_id)
            runtime_items: list[dict[str, Any]] = []
            runtime_cursor = None
            while len(runtime_items) < 5_000:
                runtime_page = _runtime_engine().list_conversation(
                    session_id, cursor=runtime_cursor, limit=500
                )
                runtime_items.extend(runtime_page["data"])
                runtime_cursor = runtime_page.get("next_cursor")
                if not runtime_cursor:
                    break
            combined = desktop_items + runtime_items
            for sequence, item in enumerate(combined, start=1):
                item["sequence"] = sequence
            start = projection.decode_cursor(cursor)
            page = combined[start:start + limit]
            next_cursor = (
                projection.encode_cursor(start + len(page))
                if start + len(page) < len(combined) else None
            )
            return {"object": "list", "data": page, "next_cursor": next_cursor}
        return _runtime_engine().list_conversation(session_id, cursor=cursor, limit=limit)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/v1/sessions/{session_id}/conversation-snapshot")
async def runtime_session_conversation_snapshot(session_id: str):
    """Return the authoritative Item projection plus its Session waterline."""
    try:
        _sync_desktop_session_id(session_id)
        return _runtime_engine().conversation_snapshot(session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/v1/sessions/{session_id}/oaep-snapshot")
async def runtime_session_oaep_snapshot(session_id: str):
    """Return the OAEP v1 Session/Run/Item projection for one Runtime Session."""
    try:
        _sync_desktop_session_id(session_id)
        return _runtime_engine().oaep_snapshot(session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


def _session_cursor_expired(exc: SessionCursorExpired) -> HTTPException:
    return HTTPException(
        status_code=409,
        detail={
            "code": "cursor_expired",
            "message": str(exc),
            "retryable": False,
            "details": exc.details,
        },
    )


@app.get("/v1/sessions/{session_id}/events")
async def runtime_session_event_list(
    session_id: str,
    after_sequence: int = Query(default=0, ge=0),
    limit: int = Query(default=500, ge=1, le=2000),
):
    """Replay durable Session events after an exclusive sequence cursor."""
    try:
        _sync_desktop_session_id(session_id)
        events = _runtime_engine().list_session_events(
            session_id,
            after_sequence=after_sequence,
            limit=limit,
        )
        return {
            "object": "list",
            "data": events,
            "next_sequence": (
                int(events[-1]["session_sequence"]) if events else after_sequence
            ),
        }
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except SessionCursorExpired as exc:
        raise _session_cursor_expired(exc) from exc


@app.get("/v1/sessions/{session_id}/oaep-events")
async def runtime_session_oaep_event_list(
    session_id: str,
    after_sequence: int = Query(default=0, ge=0),
    limit: int = Query(default=500, ge=1, le=2000),
):
    """Replay durable OAEP v1 Events after an exclusive Session sequence cursor."""
    try:
        _sync_desktop_session_id(session_id)
        events = _runtime_engine().list_oaep_events(
            session_id,
            after_sequence=after_sequence,
            limit=limit,
        )
        return {
            "version": "1.0",
            "object": "list",
            "data": events,
            "next_sequence": int(events[-1]["sequence"]) if events else after_sequence,
            "has_more": len(events) == limit,
        }
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except SessionCursorExpired as exc:
        raise _session_cursor_expired(exc) from exc


@app.get("/v1/sessions/{session_id}/events/stream")
async def runtime_session_event_stream(
    session_id: str,
    raw_request: Request,
    after_sequence: int = Query(default=0, ge=0),
):
    """Resume a Session Event stream without a snapshot/subscribe race."""
    try:
        _sync_desktop_session_id(session_id)
        # Validate existence and retention before sending HTTP 200 headers.
        _runtime_engine().list_session_events(
            session_id,
            after_sequence=after_sequence,
            limit=1,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except SessionCursorExpired as exc:
        raise _session_cursor_expired(exc) from exc

    async def stream():
        cursor = after_sequence
        while not await raw_request.is_disconnected():
            try:
                events = await asyncio.to_thread(
                    _runtime_engine().wait_session_events,
                    session_id,
                    after_sequence=cursor,
                    timeout=15.0,
                    limit=500,
                )
            except SessionCursorExpired:
                # A connected client fell behind retention. Closing forces a
                # reconnect, where the pre-header check returns cursor_expired.
                return
            if not events:
                yield ": heartbeat\n\n"
                continue
            for event in events:
                cursor = int(event["session_sequence"])
                payload = json.dumps(
                    event, ensure_ascii=False, separators=(",", ":")
                )
                yield f"id: {cursor}\nevent: session.event\ndata: {payload}\n\n"

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )

@app.get("/v1/sessions/{session_id}/oaep-events/stream")
async def runtime_session_oaep_event_stream(
    session_id: str,
    raw_request: Request,
    after_sequence: int = Query(default=0, ge=0),
):
    """Resume an OAEP v1 Session Event stream without a snapshot/subscribe race."""
    try:
        _sync_desktop_session_id(session_id)
        _runtime_engine().list_oaep_events(
            session_id,
            after_sequence=after_sequence,
            limit=1,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except SessionCursorExpired as exc:
        raise _session_cursor_expired(exc) from exc

    async def stream():
        cursor = after_sequence
        while not await raw_request.is_disconnected():
            try:
                events = await asyncio.to_thread(
                    _runtime_engine().wait_oaep_events,
                    session_id,
                    after_sequence=cursor,
                    timeout=15.0,
                    limit=500,
                )
            except SessionCursorExpired:
                return
            if not events:
                yield ": heartbeat\n\n"
                continue
            for event in events:
                cursor = int(event["sequence"])
                payload = json.dumps(
                    event, ensure_ascii=False, separators=(",", ":")
                )
                yield f"id: {cursor}\nevent: oaep.event\ndata: {payload}\n\n"

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.patch("/v1/sessions/{session_id}")
async def runtime_session_update(session_id: str, request: RuntimeSessionUpdateRequest):
    try:
        session = _runtime_engine().get_session(session_id)
        wanted_lifecycle = request.lifecycle or (
            "archived" if request.archived is True else
            "active" if request.archived is False else
            session["lifecycle"]
        )
        if wanted_lifecycle in {"active", "archived"} and wanted_lifecycle != session["lifecycle"]:
            # Mirror to the owning Agent Backend first.  If its remote archive
            # request fails, the Runtime Session remains unchanged and retryable.
            await _runtime_agent_service().archive_session(
                session_id,
                archived=wanted_lifecycle == "archived",
            )
        return _runtime_engine().update_session(
            session_id,
            title=request.title,
            archived=request.archived,
            lifecycle=request.lifecycle,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RuntimeExecutionError as exc:
        raise HTTPException(status_code=400, detail=exc.as_dict()) from exc


@app.post("/v1/sessions/{session_id}/runs")
async def runtime_run_create(session_id: str, request: RuntimeRunCreateRequest, http_request: Request):
    try:
        _sync_desktop_session_id(session_id)
        state_root = Path(os.environ.get("DRSAI_HOME", str(Path.home() / ".drsai"))).expanduser()
        # Run creation can be the first Agent API call made by a freshly
        # installed remote Runtime. Seed the built-ins before resolving the
        # requested definition instead of relying on AgentService startup.
        _ensure_builtin_agent_definitions(state_root)
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
    except RuntimeExecutionError as exc:
        raise HTTPException(status_code=409, detail=exc.as_dict()) from exc


@app.post("/v1/runs/{run_id}/execute")
async def runtime_run_execute(run_id: str, request: RuntimeRunExecuteRequest, raw_request: Request):
    metadata = request.metadata if isinstance(request.metadata, dict) else {}
    fixture_request_id = str(metadata.get("desktop_request_id") or "")
    packaged_recovery_fixture = (
        os.getenv("OPENDRSAI_PACKAGED_CHAT_RECOVERY_FIXTURE") == "1"
        and os.getenv("OPENDRSAI_DEV_AUTH_BYPASS") == "1"
        and raw_request.headers.get("x-opendrsai-auth-mode") == "offline"
        and request.user_id == "packaged-l5-user"
        and fixture_request_id == "packaged_chat_recovery_001"
        and metadata.get("packaged_recovery_fixture") is True
    )
    if packaged_recovery_fixture:
        fixture_run = _runtime_engine().get_run(run_id)
        _runtime_engine().set_run_input(
            run_id,
            request.prompt,
            source_client="windows",
            source_message_id=str(metadata.get("source_message_id") or fixture_request_id),
        )
        if fixture_run["status"] == "queued":
            _runtime_engine().transition_run(run_id, "running")
        _runtime_engine().append_backend_event(
            run_id, "agent.message.delta", {"text": "alpha"}, f"fixture:{run_id}:alpha",
        )
        _runtime_engine().append_backend_event(
            run_id, "agent.message.delta", {"text": " beta"}, f"fixture:{run_id}:beta",
        )
        completed_run = _runtime_engine().transition_run(run_id, "completed")
        return {"run": completed_run, "result": {"fixture": "remote-runtime-events"}}

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
        attachment_refs = metadata.get("attachment_refs")
        if not isinstance(attachment_refs, list) or not all(isinstance(item, str) for item in attachment_refs):
            attachment_refs = []
        _runtime_engine().set_run_input(
            run_id,
            request.prompt,
            attachment_refs=attachment_refs,
            correlation_id=correlation_id,
            source_client=(
                str(metadata.get("source_client"))
                if metadata.get("source_client") in {"windows", "android"}
                else "runtime"
            ),
            source_message_id=(
                str(metadata.get("source_message_id"))
                if isinstance(metadata.get("source_message_id"), str)
                and metadata.get("source_message_id")
                else None
            ),
        )
        _runtime_engine().append_event(run_id, "trace.request.accepted", {
            "correlation_id": correlation_id,
            "run_id": run_id,
            "trace_id": str(getattr(raw_request.state, "diagnostic_trace_id", "")) or None,
            "span_id": str(getattr(raw_request.state, "diagnostic_span_id", "")) or None,
            "parent_span_id": str(getattr(raw_request.state, "diagnostic_parent_span_id", "")) or None,
            "clock_offset_ms": int(getattr(raw_request.state, "diagnostic_clock_offset_ms", 0)),
        })
        with platform_auth_scope(auth_context) if auth_context else nullcontext():
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
    except RuntimeExecutionError as exc:
        raise HTTPException(status_code=409, detail=exc.as_dict()) from exc


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


@app.get("/v1/approvals/{approval_id}")
async def runtime_approval_read(approval_id: str):
    try:
        return _runtime_engine().get_approval(approval_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/v1/approvals")
async def runtime_approval_list(status: str | None = None, run_id: str | None = None):
    if status not in {None, "pending"}:
        raise HTTPException(status_code=400, detail="Only pending Approval listing is supported")
    rows = _runtime_engine().list_pending_approvals(run_id)
    return {"object": "list", "data": rows, "total": len(rows)}


@app.get("/v1/workspaces/{workspace_id}/approvals")
async def runtime_workspace_approval_list(workspace_id: str):
    workspace = _runtime_registry().get_workspace(workspace_id)
    if workspace is None or not workspace.open:
        raise HTTPException(status_code=404, detail="Unknown or closed Workspace")
    engine = _runtime_engine()
    rows = []
    for approval in engine.list_pending_approvals():
        try:
            run = engine.get_run(str(approval["run_id"]))
        except KeyError as exc:
            raise HTTPException(
                status_code=500, detail="Approval references an unknown Run"
            ) from exc
        if run["workspace_id"] != workspace_id:
            continue
        request = approval.get("request")
        if not isinstance(request, dict):
            raise HTTPException(status_code=500, detail="Approval request is invalid")
        rows.append(
            {
                "runtime_id": run["runtime_id"],
                "workspace_id": run["workspace_id"],
                "session_id": run["session_id"],
                "run_id": run["run_id"],
                "approval_id": approval["approval_id"],
                "backend_id": run["backend_id"],
                "operation": str(
                    request.get("operation") or request.get("tool") or "runtime.operation"
                ),
                "risk_summary": str(
                    request.get("risk_summary")
                    or request.get("reason")
                    or "Review required"
                ),
                "scope": str(request.get("scope") or "workspace"),
                "expires_at": approval.get("deadline_at") or "",
                "correlation_id": run.get("correlation_id") or "",
                "status": approval["status"],
            }
        )
    return {"items": rows}


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
    _mark_workspace_catalog_changed()
    return record.as_dict()


@app.post("/v1/workspaces/{workspace_id}/remove")
async def runtime_workspace_remove(workspace_id: str):
    active = _runtime_engine().active_workspace_resources(workspace_id)
    if active:
        raise HTTPException(
            status_code=409,
            detail={"code": "workspace_has_active_resources", "resources": active[:100]},
        )
    record = _runtime_registry().remove_workspace(workspace_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Workspace is not registered")
    _remote_workspaces.pop(workspace_id, None)
    _remote_audit("workspace.remove", workspace_id=workspace_id)
    _mark_workspace_catalog_changed()
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


@app.post("/v1/owop")
async def runtime_owop_execute(payload: dict[str, Any], raw_request: Request):
    """Execute the same typed Workspace operation over local HTTP or an SSH tunnel."""
    workspace_id = str(payload.get("workspace_id") or "")
    operation = str(payload.get("operation") or "")
    root = _workspace_root(workspace_id)
    params = payload.get("params") if isinstance(payload.get("params"), dict) else {}
    read_only_operations = {
        "workspace.describe", "files.list", "files.stat", "files.read", "search.query",
        "git.status", "git.diff", "git.file_at_ref", "git.worktree.list", "git.worktree.describe",
        "pty.list", "pty.describe", "checkpoint.preview", "artifact.metadata", "artifact.chunk",
    }
    read_only = operation in read_only_operations or (operation == "pty.attach" and params.get("mode") == "reader")
    permission = "workspace.read" if read_only else "pty.execute" if operation.startswith("pty.") else "workspace.write"
    _authorize_request(raw_request, workspace_id, permission, {
        "operation": operation,
        "terminal_id": params.get("pty_id"),
        "lease_id": params.get("lease_id"),
    })
    local = _local_workspace_owop_instances.get(workspace_id)
    if local is None or local.root != root:
        if local is not None:
            local.close()
        worktrees = GitWorktreeOWOPOperations(_git_worktree_service(), workspace_id, _workspace_event_journal())
        local = LocalWorkspaceOperations(
            workspace_id, root, _workspace_event_journal(), worktree_handlers=worktrees.handlers()
        )
        _local_workspace_owop_instances[workspace_id] = local
    handlers = local.handlers()
    handlers.update(RuntimeTerminalOWOPOperations(_terminal_state_service(), workspace_id).handlers())
    handlers.update(_runtime_artifact_store().handlers(workspace_id))
    if operation not in handlers:
        raise HTTPException(status_code=400, detail={"code": "owop_operation_unavailable"})
    response = await _owop_protocol().dispatch(payload, handlers)
    if response.get("ok"):
        result = response.get("result") if isinstance(response.get("result"), dict) else {}
        terminal = result.get("terminal") if isinstance(result.get("terminal"), dict) else {}
        _remote_audit(
            operation,
            workspace_id=workspace_id,
            terminal_id=terminal.get("terminal_id") or params.get("pty_id"),
            correlation_id=payload.get("correlation_id"),
        )
    return response


@app.post("/v1/workspaces/{workspace_id}/worktrees")
async def remote_workspace_worktree_create(workspace_id: str, request: RemoteWorktreeRequest, raw_request: Request):
    _authorize_request(raw_request, workspace_id, "worktree.write", {
        "operation": "create", "intent": request.intent,
        "idempotency_key": request.idempotency_key, "location": request.location,
    })
    root = _workspace_root(workspace_id)
    try:
        worktree = _git_worktree_service().create(
            source_workspace_id=workspace_id,
            idempotency_key=request.idempotency_key or f"legacy-{uuid.uuid4()}",
            intent=request.intent,
            location=request.location,
        )
    except GitWorktreeError as exc:
        raise HTTPException(
            status_code=409 if exc.code.endswith("conflict") or exc.code.endswith("exists") else 400,
            detail={"code": exc.code, "message": str(exc), "retryable": exc.retryable, "detail": exc.detail},
        ) from exc
    if not worktree.workspace_id:
        raise HTTPException(status_code=503, detail="Worktree Workspace registration is incomplete")
    _remote_workspaces[worktree.workspace_id] = Path(worktree.canonical_path)
    _remote_audit(
        "workspace.worktree.create", workspace_id=worktree.workspace_id,
        parent_workspace_id=workspace_id, worktree_id=worktree.worktree_id,
        path=worktree.canonical_path,
    )
    _mark_workspace_catalog_changed()
    return {
        "worktree_id": worktree.worktree_id,
        "workspace_id": worktree.workspace_id,
        "source_workspace_path": str(root),
        "repo_root": worktree.repo_root,
        "worktree_path": worktree.canonical_path,
        "branch": worktree.branch,
        "base_ref": worktree.base_commit[:12],
        "source_has_changes": worktree.source_dirty,
        "source_status_summary": worktree.source_status_summary,
        "location": worktree.location,
        **({"transport": "ssh"} if worktree.location == "remote" else {}),
    }


def _worktree_http_error(exc: GitWorktreeError) -> HTTPException:
    status = 404 if exc.code in {"workspace_not_found", "worktree_not_found"} else 409 if (
        exc.code == "worktree_active_resources" or exc.code.endswith("conflict") or exc.code.endswith("exists") or exc.code.endswith("dirty")
    ) else 400
    return HTTPException(
        status_code=status,
        detail={"code": exc.code, "message": str(exc), "retryable": exc.retryable, "detail": exc.detail},
    )


@app.post("/v1/workspaces/{workspace_id}/worktrees/adopt")
async def runtime_worktree_adopt(workspace_id: str, request: RuntimeWorktreeAdoptRequest, raw_request: Request):
    _authorize_request(raw_request, workspace_id, "worktree.write", {
        "operation": "adopt", "canonical_path": request.canonical_path,
        "branch": request.branch, "idempotency_key": request.idempotency_key,
    })
    _workspace_root(workspace_id)
    try:
        record = _git_worktree_service().adopt(
            source_workspace_id=workspace_id,
            idempotency_key=request.idempotency_key,
            canonical_path=request.canonical_path,
            branch=request.branch,
            base_ref=request.base_ref,
            location=request.location,
        )
    except GitWorktreeError as exc:
        raise _worktree_http_error(exc) from exc
    if record.workspace_id:
        _remote_workspaces[record.workspace_id] = Path(record.canonical_path)
        _mark_workspace_catalog_changed()
    _remote_audit(
        "workspace.worktree.adopt", workspace_id=workspace_id,
        worktree_id=record.worktree_id, path=record.canonical_path,
    )
    return {"worktree": _git_worktree_service().project(record)}


@app.get("/v1/workspaces/{workspace_id}/worktrees")
async def runtime_worktree_list(workspace_id: str, raw_request: Request, include_removed: bool = False):
    _authorize_request(raw_request, workspace_id, "workspace.read", {"operation": "worktree.list", "include_removed": include_removed})
    _workspace_root(workspace_id)
    try:
        records = _git_worktree_service().list(workspace_id, include_removed=include_removed)
    except GitWorktreeError as exc:
        raise _worktree_http_error(exc) from exc
    service = _git_worktree_service()
    return {"worktrees": [service.project(record) for record in records]}


@app.get("/v1/workspaces/{workspace_id}/events")
async def runtime_workspace_events(
    workspace_id: str,
    raw_request: Request,
    after_sequence: int = Query(default=0, ge=0),
    limit: int = Query(default=200, ge=1, le=1000),
):
    _authorize_request(raw_request, workspace_id, "workspace.read", {
        "operation": "workspace.events", "after_sequence": after_sequence,
    })
    _workspace_root(workspace_id)
    events = _workspace_event_journal().list(workspace_id, after_sequence, limit)
    return {"events": events, "next_sequence": events[-1]["sequence"] if events else after_sequence}


@app.post("/v1/workspaces/{workspace_id}/worktrees/prune")
async def runtime_worktree_prune(workspace_id: str, request: RuntimeWorktreePruneRequest, raw_request: Request):
    _authorize_request(raw_request, workspace_id, "workspace.read" if request.dry_run else "worktree.write", {
        "operation": "prune", "dry_run": request.dry_run,
        "idempotency_key": request.idempotency_key,
    })
    _workspace_root(workspace_id)
    try:
        candidates, pruned = _git_worktree_service().prune(workspace_id, dry_run=request.dry_run)
    except GitWorktreeError as exc:
        raise _worktree_http_error(exc) from exc
    _remote_audit("workspace.worktree.prune", workspace_id=workspace_id, candidates=candidates, pruned=pruned)
    return {"candidates": candidates, "pruned": pruned}


@app.get("/v1/workspaces/{workspace_id}/worktrees/{worktree_id}")
async def runtime_worktree_describe(workspace_id: str, worktree_id: str, raw_request: Request):
    _authorize_request(raw_request, workspace_id, "workspace.read", {"operation": "worktree.describe", "worktree_id": worktree_id})
    _workspace_root(workspace_id)
    try:
        record = _git_worktree_service().describe(workspace_id, worktree_id)
    except GitWorktreeError as exc:
        raise _worktree_http_error(exc) from exc
    return {"worktree": _git_worktree_service().project(record)}


@app.post("/v1/workspaces/{workspace_id}/worktrees/{worktree_id}/merge")
async def runtime_worktree_merge(workspace_id: str, worktree_id: str, request: RuntimeWorktreeMergeRequest, raw_request: Request):
    _authorize_request(raw_request, workspace_id, "worktree.write", {
        "operation": "merge", "worktree_id": worktree_id, "expected_head": request.expected_head,
        "idempotency_key": request.idempotency_key,
    })
    _workspace_root(workspace_id)
    try:
        record = _git_worktree_service().merge(workspace_id, worktree_id, expected_head=request.expected_head)
    except GitWorktreeError as exc:
        raise _worktree_http_error(exc) from exc
    _remote_audit(
        "workspace.worktree.merge", workspace_id=workspace_id, worktree_id=worktree_id,
        status=record.status, derived_workspace_id=record.workspace_id,
    )
    _mark_workspace_catalog_changed()
    return {"worktree": _git_worktree_service().project(record)}


@app.post("/v1/workspaces/{workspace_id}/worktrees/{worktree_id}/archive")
async def runtime_worktree_archive(workspace_id: str, worktree_id: str, request: RuntimeWorktreeArchiveRequest, raw_request: Request):
    _authorize_request(raw_request, workspace_id, "worktree.write", {"operation": "archive", "worktree_id": worktree_id, "idempotency_key": request.idempotency_key})
    _workspace_root(workspace_id)
    try:
        record = _git_worktree_service().archive(workspace_id, worktree_id)
    except GitWorktreeError as exc:
        raise _worktree_http_error(exc) from exc
    _remote_audit(
        "workspace.worktree.archive", workspace_id=workspace_id,
        worktree_id=worktree_id, branch=record.branch,
    )
    _mark_workspace_catalog_changed()
    return {"worktree": _git_worktree_service().project(record)}


@app.delete("/v1/workspaces/{workspace_id}/worktrees/{worktree_id}")
async def runtime_worktree_remove(workspace_id: str, worktree_id: str, request: RuntimeWorktreeRemoveRequest, raw_request: Request):
    _authorize_request(raw_request, workspace_id, "worktree.write", {
        "operation": "remove", "worktree_id": worktree_id, "expected_status": request.expected_status,
        "idempotency_key": request.idempotency_key,
    })
    _workspace_root(workspace_id)
    try:
        record = _git_worktree_service().remove(
            workspace_id, worktree_id, expected_status=request.expected_status
        )
    except GitWorktreeError as exc:
        raise _worktree_http_error(exc) from exc
    _remote_workspaces.pop(record.workspace_id or "", None)
    _remote_audit(
        "workspace.worktree.remove", workspace_id=workspace_id,
        worktree_id=worktree_id, derived_workspace_id=record.workspace_id,
    )
    _mark_workspace_catalog_changed()
    return {"worktree": _git_worktree_service().project(record)}


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
    common = {"path": str(target.relative_to(_workspace_root(workspace_id))).replace("\\", "/"), "mime": mime, "truncated": size > max_bytes, "size": size, "modified_at": target.stat().st_mtime, "sha256": _stream_file_sha256(target)}
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
    root = _workspace_root(workspace_id)
    marker = f"OpenDrSai-Approval: {request.idempotency_key}" if request.idempotency_key else None
    if marker:
        history = subprocess.run(["git", "-C", str(root), "log", "--all", "-n", "200", "--format=%H%x00%B%x00"], capture_output=True, text=True, timeout=15, check=False)
        if history.returncode == 0:
            parts = history.stdout.split("\x00")
            for index in range(0, len(parts) - 1, 2):
                if any(line.strip() == marker for line in parts[index + 1].splitlines()):
                    return {"workspace_id": workspace_id, "committed": True, "replayed": True, "revision": parts[index].strip(), "exit_code": 0, "stdout": "", "stderr": ""}
    args = ["git", "-C", str(root), "commit", "-m", request.message]
    if request.body and request.body.strip(): args += ["-m", request.body.strip()]
    if marker: args += ["-m", marker]
    completed = subprocess.run(args, capture_output=True, text=True, timeout=60, check=False)
    if completed.returncode != 0:
        combined = (completed.stderr.strip() or completed.stdout.strip() or "Git commit failed")[-4000:]
        raise HTTPException(status_code=409, detail={"code": "git_commit_failed", "message": combined, "retryable": False, "detail": {"exit_code": completed.returncode}})
    revision = subprocess.run(["git", "-C", str(root), "rev-parse", "HEAD"], capture_output=True, text=True, timeout=10, check=False).stdout.strip()
    return {"workspace_id": workspace_id, "committed": True, "replayed": False, "revision": revision, "exit_code": completed.returncode, "stdout": completed.stdout[-4000:], "stderr": completed.stderr[-4000:]}


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
        # OpenAI-compatible transcription APIs expect ISO-639-1, while the
        # desktop UI stores BCP-47 locale tags such as en-US and zh-CN.
        data["language"] = language.split("-", 1)[0].lower()
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


class AudioSpeechRequest(BaseModel):
    text: str
    language: Optional[str] = None
    voice: Optional[str] = None
    speed: float = 1.0
    format: str = "mp3"


@app.post("/v1/audio/speech")
async def audio_speech(request: AudioSpeechRequest):
    """Proxy bounded whole-response speech synthesis to the configured provider."""
    api_key = os.environ.get("HEPAI_API_KEY", "").strip() or os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(status_code=401, detail="A speech synthesis provider API key is required.")
    text = request.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Speech synthesis text is required.")
    if len(text) > 12_000:
        raise HTTPException(status_code=413, detail="Speech synthesis text exceeds the 12000 character limit.")
    if request.speed < 0.5 or request.speed > 2.0:
        raise HTTPException(status_code=400, detail="Speech synthesis speed must be between 0.5 and 2.")
    if request.format not in {"mp3", "wav", "opus"}:
        raise HTTPException(status_code=400, detail="Unsupported speech synthesis format.")
    base_url = os.environ.get("OPENAI_BASE_URL", "https://aiapi.ihep.ac.cn/apiv2").rstrip("/")
    payload = {
        "model": os.environ.get("OPENDRSAI_TTS_MODEL", "gpt-4o-mini-tts"),
        "input": text,
        "voice": request.voice or os.environ.get("OPENDRSAI_TTS_VOICE", "alloy"),
        "speed": request.speed,
        "response_format": request.format,
    }
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            provider_response = await client.post(
                f"{base_url}/audio/speech",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json=payload,
            )
    except httpx.TimeoutException as exc:
        raise HTTPException(status_code=504, detail="The speech synthesis provider timed out.") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="The speech synthesis provider is unreachable.") from exc
    if provider_response.status_code >= 400:
        try:
            error_payload = provider_response.json()
        except ValueError:
            error_payload = {}
        detail = error_payload.get("error", {}).get("message") if isinstance(error_payload.get("error"), dict) else error_payload.get("detail")
        raise HTTPException(status_code=provider_response.status_code, detail=detail or "The speech synthesis provider rejected the request.")
    audio = provider_response.content
    if not audio:
        raise HTTPException(status_code=502, detail="The speech synthesis provider returned empty audio.")
    if len(audio) > 10 * 1024 * 1024:
        raise HTTPException(status_code=502, detail="The speech synthesis response exceeds the 10 MB limit.")
    media_types = {"mp3": "audio/mpeg", "wav": "audio/wav", "opus": "audio/ogg"}
    return FastAPIResponse(content=audio, media_type=media_types[request.format])


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
                default_alias = _normalize_default_model_alias(raw["_default_alias"])
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

    metadata = request.metadata if isinstance(request.metadata, dict) else {}
    fixture_request_id = str(metadata.get("desktop_request_id") or "")
    packaged_recovery_fixture = (
        os.getenv("OPENDRSAI_PACKAGED_CHAT_RECOVERY_FIXTURE") == "1"
        and os.getenv("OPENDRSAI_DEV_AUTH_BYPASS") == "1"
        and raw_request.headers.get("x-opendrsai-auth-mode") == "offline"
        and request.user_id == "packaged-l5-user"
        and fixture_request_id == "packaged_chat_recovery_001"
        and metadata.get("packaged_recovery_fixture") is True
    )
    if packaged_recovery_fixture:
        retry_attempt = metadata.get("network_retry_attempt")
        resume_from_chars = metadata.get("resume_from_chars")
        if (retry_attempt, resume_from_chars) not in {(0, 0), (1, 5)}:
            raise HTTPException(status_code=409, detail="Packaged Chat recovery attempt/cursor pair is inconsistent.")

        async def packaged_chat_recovery_sse():
            if retry_attempt == 0:
                yield f"data: {json.dumps({'choices': [{'delta': {'content': 'alpha'}}]})}\n\n"
                # End the real HTTP response without [DONE] so Desktop recovery
                # must resume from the persisted five-character cursor.
                return
            yield f"data: {json.dumps({'choices': [{'delta': {'content': ' beta'}}]})}\n\n"
            yield "data: [DONE]\n\n"

        return StreamingResponse(
            packaged_chat_recovery_sse(),
            media_type="text/event-stream",
            headers={
                "X-Drsai-Session-Id": request.thread_id or fixture_request_id,
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
                "X-OpenDrSai-Packaged-Recovery-Fixture": "1",
            },
        )

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

    desktop_oaep_bridge = _prepare_desktop_oaep_bridge(request, raw_request)

    controlled_desktop_turn = metadata.get("v4_controlled_desktop_turn") is True
    if controlled_desktop_turn and not (
        os.environ.get("DRSAI_RUNTIME_CONTROLLED_MODEL") == "1"
        and raw_request.headers.get("x-opendrsai-auth-mode") == "offline"
        and request.user_id == "v4-acceptance-windows"
        and desktop_oaep_bridge is not None
    ):
        raise HTTPException(
            status_code=403,
            detail={
                "code": "controlled_desktop_turn_forbidden",
                "message": "The deterministic Desktop turn is available only to the V4 acceptance launcher.",
                "retryable": False,
                "details": {
                    "controlled_model_enabled": os.environ.get("DRSAI_RUNTIME_CONTROLLED_MODEL") == "1",
                    "offline_auth": raw_request.headers.get("x-opendrsai-auth-mode") == "offline",
                    "acceptance_user": request.user_id == "v4-acceptance-windows",
                    "bridge_ready": desktop_oaep_bridge is not None,
                },
            },
        )



    async def generate_sse():

        """Generate SSE events from agent.run_stream()."""

        has_content = False
        sent_done = False
        conversation_state = ConversationTranslationState()
        conversation_turn_id = _safe_str(
            request.metadata.get("run_id") or request.metadata.get("desktop_request_id")
        ).strip() or str(uuid.uuid4())
        conversation_projector = StructuredConversationProjector(conversation_turn_id)



        try:

            for frame in conversation_projector.encode(conversation_projector.start()):
                yield frame

            if controlled_desktop_turn:
                controlled_events = [
                    ("message.delta", {"text": "controlled desktop response"}),
                    (
                        "tool.start",
                        {
                            "tool_id": f"tool:{conversation_turn_id}",
                            "name": "shell",
                            "args": {"command": "controlled-read-only"},
                        },
                    ),
                    (
                        "tool.complete",
                        {
                            "tool_id": f"tool:{conversation_turn_id}",
                            "name": "shell",
                            "result": "completed",
                        },
                    ),
                    (
                        "agent.item.file_change",
                        {
                            "backend_metadata": {
                                "item_id": f"file-change:{conversation_turn_id}",
                            },
                            "phase": "completed",
                            "item": {
                                "path": "acceptance/controlled-result.txt",
                                "operation": "modify",
                                "summary": "Controlled acceptance file-change metadata",
                            },
                        },
                    ),
                ]
                for semantic_type, semantic_payload in controlled_events:
                    desktop_oaep_bridge.record(semantic_type, semantic_payload)
                    for frame in conversation_projector.encode(
                        conversation_projector.project(semantic_type, semantic_payload)
                    ):
                        yield frame
                complete_payload = {"text": "controlled desktop response"}
                desktop_oaep_bridge.record("message.complete", complete_payload)
                desktop_oaep_bridge.complete(complete_payload)
                yield f"data: {json.dumps({'choices': [{'delta': {'content': 'controlled desktop response'}}]})}\n\n"
                yield "data: [DONE]\n\n"
                return

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

                    try:
                        semantic_events = translate_conversation_event(event, conversation_state)
                        for semantic_type, semantic_payload in semantic_events:
                            if desktop_oaep_bridge is not None:
                                desktop_oaep_bridge.record(semantic_type, semantic_payload)
                            structured_events = conversation_projector.project(semantic_type, semantic_payload)
                            for frame in conversation_projector.encode(structured_events):
                                yield frame
                    except Exception:
                        logger.exception("Structured conversation projection failed; legacy stream continues")

                    sse = _event_to_sse(event)

                    if sse:

                        if "[DONE]" in sse:
                            sent_done = True

                            continue

                        if sse.startswith("data:") and "[DONE]" not in sse:

                            has_content = True

                        yield sse

            complete_type, complete_payload = finalize_conversation_translation(conversation_state)
            if desktop_oaep_bridge is not None:
                desktop_oaep_bridge.record(complete_type, complete_payload)
            for frame in conversation_projector.encode(
                conversation_projector.project(complete_type, complete_payload)
            ):
                yield frame

            if desktop_oaep_bridge is not None:
                desktop_oaep_bridge.complete(complete_payload)

            yield "data: [DONE]\n\n"



        except asyncio.CancelledError:

            logger.info(f"Request cancelled for session {thread_id}")

            if desktop_oaep_bridge is not None:
                desktop_oaep_bridge.cancel()

            for frame in conversation_projector.encode(
                conversation_projector.complete(status="cancelled")
            ):
                yield frame

            yield "data: [DONE]\n\n"

            return



        except HTTPException as exc:

            if desktop_oaep_bridge is not None:
                desktop_oaep_bridge.fail({
                    "code": "desktop_gateway_error",
                    "message": str(exc.detail),
                    "retryable": exc.status_code >= 500,
                })

            raise



        except Exception as e:
            error = classify_model_error(e)
            diagnostic_parts: list[str] = []
            current_error: BaseException | None = e
            seen_errors: set[int] = set()
            while current_error is not None and id(current_error) not in seen_errors and len(diagnostic_parts) < 4:
                seen_errors.add(id(current_error))
                status_code = getattr(current_error, "status_code", None)
                diagnostic_parts.append(
                    f"{type(current_error).__name__}"
                    + (f"(HTTP {status_code})" if status_code is not None else "")
                )
                current_error = current_error.__cause__ or current_error.__context__
            diagnostic = " <- ".join(diagnostic_parts)
            error = {**error, "message": f"{error['message']} [{diagnostic}]"}
            logger.error(
                "Agent error for session %s: code=%s diagnostic=%s",
                thread_id,
                error["code"],
                diagnostic,
            )
            logger.debug(traceback.format_exc())
            if desktop_oaep_bridge is not None:
                desktop_oaep_bridge.fail(error)
            for frame in conversation_projector.encode(
                conversation_projector.complete(
                    {"message": error.get("message") or "Agent turn failed."},
                    status="error",
                )
            ):
                yield frame
            yield f"data: {json.dumps({'error': error})}\n\n"

            yield "data: [DONE]\n\n"

            return

        finally:
            # Async-generator close does not always enter CancelledError. Never
            # leave a mirrored Runtime Run indefinitely in the running state.
            if desktop_oaep_bridge is not None:
                desktop_oaep_bridge.cancel()



    async def generate_with_disconnect():

        gen = generate_sse()

        try:
            while True:
                next_chunk = asyncio.create_task(gen.__anext__())
                try:
                    while not next_chunk.done():
                        await asyncio.wait({next_chunk}, timeout=0.25)
                        if await raw_request.is_disconnected():
                            cancel_token.cancel()
                            next_chunk.cancel()
                            await asyncio.gather(next_chunk, return_exceptions=True)
                            return
                    yield next_chunk.result()
                except StopAsyncIteration:
                    break

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
)


def _get_curated_store(user_id: str | None = None) -> CuratedMemoryStore:
    """Build a CuratedMemoryStore pointing at this user's MEMORY.md.

    Files live in ``WORKDIR/<user_id>/configs/`` — the same directory the
    agent's UserProfileManager writes to, so reads/writes here are seen by
    the running agent on the next system-prompt rebuild.
    """
    cfg_dir = _get_config_dir(user_id)
    cfg_dir.mkdir(parents=True, exist_ok=True)
    return CuratedMemoryStore(
        memory_path=cfg_dir / "MEMORY.md",
    )


def _memory_payload(user_id: str | None = None) -> dict:
    """Build the GET /v1/memory response payload."""
    store = _get_curated_store(user_id)
    entries = store.list_entries()
    mem_path = store.memory_path
    mtimes = store.last_modified()
    counts = store.char_counts()

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


@app.get("/v1/memory/limits")
async def get_memory_limits():
    """Return curated-memory character limits (constants)."""
    return {
        "memoryCharLimit": DEFAULT_MEMORY_CHAR_LIMIT,
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


class ActiveModelConfigRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    model: str = Field(..., min_length=1, max_length=256)
    model_provider: str = Field(..., min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    expected_revision: Optional[str] = Field(default=None, min_length=64, max_length=64)
    base_url: Optional[str] = Field(default=None, min_length=1, max_length=2048)
    api_key: Optional[str] = Field(default=None, min_length=1, max_length=8192, repr=False)
    api_key_env: Optional[str] = Field(default=None, min_length=1, max_length=256)
    api_key_credential: Optional[str] = Field(default=None, min_length=1, max_length=512)
    wire_api: str = Field(default="openai", pattern=r"^(openai|anthropic)$")
    requires_api_key: bool = True


class ModelProviderConfigRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    base_url: str = Field(..., min_length=1, max_length=2048)
    api_key: Optional[str] = Field(default=None, min_length=1, max_length=8192)
    api_key_env: Optional[str] = Field(default=None, min_length=1, max_length=256)
    api_key_credential: Optional[str] = Field(default=None, min_length=1, max_length=512)
    wire_api: str = Field(default="openai", pattern=r"^(openai|anthropic)$")
    requires_api_key: bool = True
    expected_revision: Optional[str] = Field(default=None, min_length=64, max_length=64)


class ModelProviderTestRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    model: Optional[str] = Field(default=None, min_length=1, max_length=256)


class ModelProviderDraftTestRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(..., min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    base_url: str = Field(..., min_length=1, max_length=2048)
    model: str = Field(..., min_length=1, max_length=256)
    wire_api: str = Field(default="openai", pattern=r"^(openai|anthropic)$")
    requires_api_key: bool = True
    api_key: Optional[str] = Field(default=None, min_length=1, max_length=8192, repr=False)
    api_key_env: Optional[str] = Field(default=None, min_length=1, max_length=256)
    mode: str = Field(default="basic", pattern=r"^(basic|model)$")


class ModelConfigRestoreRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: Optional[str] = Field(default=None, min_length=64, max_length=64)


class ModelDoctorRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    online: bool = False


class ModelDiscoveryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider: str = Field(..., min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    refresh: bool = False


def _commit_metadata(committed: object) -> dict[str, object]:
    return {
        "changed_fields": list(getattr(committed, "changed_fields", ())),
        "restart_required": bool(getattr(committed, "restart_required", False)),
        "apply_strategy": str(getattr(committed, "apply_strategy", "next_turn_atomic_client_swap")),
    }


@app.get("/v1/config/model")
async def get_active_model_config():
    """Return the effective compact model configuration without secrets."""
    try:
        config = await asyncio.to_thread(load_model_provider_config)
        resolved = resolve_model_config(config, environ=os.environ, require_credentials=False)
        result = resolved.public_dict()
        result["path"] = config.source_path
        result["revision"] = model_config_revision()
        return result
    except ModelProviderConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/v1/config/model-state")
async def get_model_config_state():
    """Return effective state and recovery metadata, never credentials."""
    try:
        config = await asyncio.to_thread(load_model_provider_config)
        resolved = resolve_model_config(config, environ=os.environ, require_credentials=False)
        target = default_model_config_path()
        runtime = await manager.model_config_state(_get_user_id())
        return {
            "path": str(target),
            "revision": model_config_revision(target),
            "last_known_good_available": last_known_good_path(target).is_file(),
            "effective": resolved.public_dict(),
            "runtime": runtime,
            "last_test": latest_probe_result(resolved.provider.name),
            "telemetry": telemetry_snapshot(),
        }
    except ModelProviderConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/v1/config/model/doctor")
async def doctor_model_config(req: ModelDoctorRequest = ModelDoctorRequest()):
    """Run offline configuration and credential diagnostics."""
    return await asyncio.to_thread(diagnose_model_config, online=req.online)


@app.post("/v1/config/model/restore")
async def restore_model_config(req: ModelConfigRestoreRequest):
    """Restore the last-known-good configuration with optimistic concurrency."""
    try:
        committed = await asyncio.to_thread(
            restore_last_known_good,
            expected_revision=req.expected_revision,
        )
    except ModelProviderConfigConflict as exc:
        raise HTTPException(
            status_code=409,
            detail={**guidance_for("config_conflict"), "message": str(exc)},
        ) from exc
    except ModelProviderConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    revision = await manager.mark_user_config_stale(_get_user_id())
    return {
        "ok": True,
        "effective": committed.resolved.public_dict(),
        "revision": committed.revision,
        "config_revision": revision,
        **_commit_metadata(committed),
    }


@app.put("/v1/config/model")
async def set_active_model_config(req: ActiveModelConfigRequest):
    """Persist the selected model and Provider, preserving unrelated TOML."""
    try:
        provider_values = None
        if req.base_url is not None:
            provider_values = {
                "base_url": req.base_url,
                "wire_api": req.wire_api,
                "requires_api_key": req.requires_api_key,
                **({"api_key_env": req.api_key_env} if req.api_key_env else {}),
                **({"api_key_credential": req.api_key_credential} if req.api_key_credential else {}),
            }
        committed = await asyncio.to_thread(
            commit_model_config_update,
            ConfigUpdateRequest(
                model=req.model,
                model_provider=req.model_provider,
                provider_name=req.model_provider if provider_values is not None else None,
                provider_values=provider_values,
                provider_secret=req.api_key,
            ),
            expected_revision=req.expected_revision,
        )
        resolved = committed.resolved
    except ModelProviderConfigConflict as exc:
        raise HTTPException(status_code=409, detail={"code": "config_conflict", "message": str(exc)}) from exc
    except ModelProviderConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    revision = await manager.mark_user_config_stale(_get_user_id())
    return {"ok": True, **resolved.public_dict(), "evicted_sessions": 0, "config_revision": revision, "revision": committed.revision, "warnings": list(committed.warnings), **_commit_metadata(committed)}


@app.post("/v1/config/model/preview")
async def preview_active_model_config(req: ActiveModelConfigRequest):
    """Validate and render an atomic model/provider change without persistence."""
    try:
        provider_values = None
        if req.base_url is not None:
            provider_values = {
                "base_url": req.base_url,
                "wire_api": req.wire_api,
                "requires_api_key": req.requires_api_key,
                **({"api_key_env": req.api_key_env} if req.api_key_env else {}),
                **({"api_key_credential": req.api_key_credential} if req.api_key_credential else {}),
            }
        preview = await asyncio.to_thread(
            preview_model_config_update,
            ConfigUpdateRequest(
                model=req.model,
                model_provider=req.model_provider,
                provider_name=req.model_provider if provider_values is not None else None,
                provider_values=provider_values,
                provider_secret=req.api_key,
            ),
            environ=os.environ,
        )
        if req.expected_revision and req.expected_revision != preview.base_revision:
            raise ModelProviderConfigConflict("Model configuration changed; reload it before saving")
        return {
            "ok": True,
            "persisted": False,
            "base_revision": preview.base_revision,
            "effective": preview.resolved.public_dict(),
        }
    except ModelProviderConfigConflict as exc:
        raise HTTPException(status_code=409, detail={**guidance_for("config_conflict"), "message": str(exc)}) from exc
    except ModelProviderConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/v1/config/model-providers")
async def list_model_provider_configs():
    """List user-defined Providers and the effective built-in Provider."""
    try:
        config = await asyncio.to_thread(load_model_provider_config)
        providers: list[dict[str, object]] = []
        names = set(config.providers)
        names.update(builtin_provider_names())
        names.add(config.model_provider or "hepai")
        for name in sorted(names):
            try:
                resolved = resolve_model_config(
                    config,
                    environ=os.environ,
                    provider=name,
                    require_credentials=False,
                )
            except ModelProviderConfigError:
                continue
            providers.append(resolved.provider.public_dict())
        return {"providers": providers, "active": config.model_provider or "hepai"}
    except ModelProviderConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/v1/config/model-providers/presets")
async def get_model_provider_presets():
    """List user-facing presets whose invariant fields stay out of TOML."""
    return {"presets": list_provider_presets()}


@app.post("/v1/config/model-providers/models")
async def discover_model_provider_models(req: ModelDiscoveryRequest):
    """Discover models with a short-lived in-memory cache."""
    try:
        config = await asyncio.to_thread(load_model_provider_config)
        resolved = resolve_model_config(
            config,
            environ=os.environ,
            provider=req.provider,
            require_credentials=True,
        )
    except ModelProviderConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return await discover_provider_models(resolved, refresh=req.refresh)


@app.put("/v1/config/model-providers/{name}")
async def put_model_provider_config(name: str, req: ModelProviderConfigRequest):
    """Create or replace a user Provider without returning its secret."""
    try:
        values = req.model_dump(exclude_none=True, exclude={"expected_revision"})
        raw_key = values.pop("api_key", None)
        committed = await asyncio.to_thread(
            commit_model_config_update,
            ConfigUpdateRequest(
                provider_name=name,
                provider_values=values,
                provider_secret=raw_key if isinstance(raw_key, str) else None,
            ),
            expected_revision=req.expected_revision or model_config_revision(),
        )
        resolved = resolve_model_config(
            committed.config,
            environ=os.environ,
            provider=name,
            require_credentials=False,
        )
    except ModelProviderConfigConflict as exc:
        raise HTTPException(status_code=409, detail={"code": "config_conflict", "message": str(exc)}) from exc
    except ModelProviderConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    revision = await manager.mark_user_config_stale(_get_user_id())
    return {"ok": True, "provider": resolved.provider.public_dict(), "evicted_sessions": 0, "config_revision": revision, "revision": committed.revision, "warnings": list(committed.warnings), **_commit_metadata(committed)}


@app.delete("/v1/config/model-providers/{name}")
async def remove_model_provider_config(
    name: str,
    expected_revision: Optional[str] = None,
    delete_credential: bool = True,
):
    """Delete a user Provider and safely fall back to HepAI if it was active."""
    try:
        base_revision = expected_revision or model_config_revision()
        config = await asyncio.to_thread(load_model_provider_config)
        active = (config.model_provider or "hepai") == name
        committed = await asyncio.to_thread(
            commit_model_config_update,
            ConfigUpdateRequest(
                delete_provider_name=name,
                delete_provider_credential=delete_credential,
                model=config.model or DEFAULT_CONFIG_NAME if active else None,
                model_provider="hepai" if active else None,
            ),
            expected_revision=base_revision,
        )
    except ModelProviderConfigConflict as exc:
        raise HTTPException(status_code=409, detail={"code": "config_conflict", "message": str(exc)}) from exc
    except ModelProviderConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    revision = await manager.mark_user_config_stale(_get_user_id())
    return {"ok": True, "active": "hepai" if active else config.model_provider, "evicted_sessions": 0, "config_revision": revision, "revision": committed.revision}


@app.post("/v1/config/model-providers/{name}/test")
async def test_model_provider_config(name: str, req: ModelProviderTestRequest):
    """Perform a bounded, authenticated protocol check against a Provider."""
    try:
        config = await asyncio.to_thread(load_model_provider_config)
        resolved = resolve_model_config(
            config,
            environ=os.environ,
            provider=name,
            model=req.model,
        )
    except ModelProviderConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return await test_provider_connection(resolved)


@app.post("/v1/config/model-providers/test")
async def test_model_provider_draft(req: ModelProviderDraftTestRequest):
    """Test an unsaved Provider draft without writing TOML or credentials."""
    try:
        return await probe_provider_draft(
            ProviderDraft(
                name=req.name,
                base_url=req.base_url,
                model=req.model,
                wire_api=req.wire_api,  # type: ignore[arg-type]
                requires_api_key=req.requires_api_key,
                api_key=req.api_key,
                api_key_env=req.api_key_env,
            ),
            mode=req.mode,  # type: ignore[arg-type]
            environ=os.environ,
        )
    except ModelProviderConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


# ════════════════════════════════════════════════════════════════════════════
# Platform toggles (telegram / discord / slack / whatsapp / signal)
# ════════════════════════════════════════════════════════════════════════════
#
# These are placeholder endpoints kept compatible with the desktop UI. OpenDrSai
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
            "Stored in cli_config.json[platforms]. OpenDrSai does not yet ship "
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
# OpenDrSai has no native kanban runtime; this is a thin JSON-file store keyed by
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

    """Map an OpenDrSai event to an SSE-formatted string. Returns None if skip."""



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
    """Start the OpenDrSai API gateway (uvicorn).

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
