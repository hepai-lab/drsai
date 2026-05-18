"""

DrSai API Server â FastAPI SSE streaming server wrapping DrSai Assistant.



Provides an OpenAI-compatible /v1/chat/completions endpoint so the

Electron desktop app can drive a local DrSai agent via HTTP SSE.



Also exposes session management, skills, memory, and agent control

(pause/resume/stop) endpoints â making it a full DrSai Gateway.



Usage:

    python drsai_api_server.py                # default port 8642

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

import json

import os

import sys

import time

import traceback

import uuid

from contextlib import asynccontextmanager

from pathlib import Path

from typing import Any, Optional



from fastapi import FastAPI, HTTPException, Query, Request

from fastapi.responses import StreamingResponse

from loguru import logger

from pydantic import BaseModel, Field



from autogen_agentchat.base import Response, TaskResult

from autogen_agentchat.messages import (

    BaseChatMessage,

    ModelClientStreamingChunkEvent,

    TextMessage,

    ToolCallExecutionEvent,

    ToolCallRequestEvent,

)

from autogen_core import CancellationToken



from drsai.backend.run_drsai_agent_factory import create_agent, load_llm_mode_config

from drsai.configs.constant import FS_DIR

from drsai.modules.managers.database import DatabaseManager

from drsai.modules.managers.datamodel.db import Thread, RunStatus

from drsai.modules.managers.datamodel.types import Response as DBResponse

from drsai.utils.utils import compress_state, decompress_state

from drsai.backend.cli.history import CLISessionStore



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



DEFAULT_PORT = int(os.environ.get("DRSAI_API_PORT", "8642"))

DEFAULT_HOST = os.environ.get("DRSAI_API_HOST", "127.0.0.1")



# ââ Database paths (aligned with run_cli.py conventions) âââââââââââââââââââââ

_WORKSPACE = Path(FS_DIR) / "workspace"

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





class UserNameRequest(BaseModel):

    user_name: str = Field(..., description="Custom user name for the desktop session.")





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



    async def _get_or_create_thread(self, thread_id: str, user_id: str) -> Thread:

        """Get or create a Thread record."""

        db = _get_db()

        resp: DBResponse = db.get(

            Thread,

            filters={"user_id": user_id, "thread_id": thread_id},

            return_json=False,

        )

        if resp.status and resp.data:

            return resp.data[0]

        thread = Thread(

            user_id=user_id,

            thread_id=thread_id,

            status=RunStatus.CREATED,

            messages=[],

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

                agent = await asyncio.to_thread(

                    create_agent,

                    thread_id=tid,

                    user_id=uid,

                    db_manager=_get_db(),

                    defult_config_name=model_alias or "hepai/minimax-m2.7-highspeed",

                    work_dir=work_dir or os.getcwd(),

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

                await self._get_or_create_thread(tid, uid)



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

    logger.info(f"Database ready: {_DB_URI}")

    logger.info(f"Default user: {_get_user_id()}")

    yield

    logger.info("DrSai API Server shutting down")





app = FastAPI(

    title="DrSai API Server",

    version="0.2.0",

    lifespan=lifespan,

)





# ââ Health âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ



@app.get("/health")

async def health():

    """Health check endpoint. Desktop polls this to detect API readiness."""

    return await manager.health()





# ââ Models âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ



@app.get("/v1/models")

async def list_models():

    """List available models. OpenAI-compatible format."""

    models = await manager.list_models()

    return {"object": "list", "data": models}





# âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

# Chat (streaming)

# âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ



@app.post("/v1/chat/completions")

async def chat_completions(request: ChatRequest, raw_request: Request):

    """OpenAI-compatible chat completions with SSE streaming.



    Only streaming mode is supported. The caller MUST set stream=true.



    The agent internally manages full conversation history via its

    SQLite-based model_context. Only the LAST user message is passed

    as task â the agent's internal context handles the rest.

    """

    # Extract the last user message as the task

    user_msgs = [m for m in request.messages if m.role == "user"]

    if not user_msgs:

        raise HTTPException(status_code=400, detail="No user message found")

    task = user_msgs[-1].content



    thread_id = request.thread_id

    user_id = request.user_id or _get_user_id()

    work_dir = request.work_dir or os.getcwd()



    cancel_token = CancellationToken()



    async def generate_sse():

        """Generate SSE events from agent.run_stream()."""

        session_id = thread_id or str(uuid.uuid4())

        has_content = False



        try:

            async for event in manager.run_stream(

                task=task,

                thread_id=thread_id,

                user_id=user_id,

                model_alias=request.model if request.model != "drsai" else None,

                work_dir=work_dir,

                cancellation_token=cancel_token,

            ):

                sse = _event_to_sse(event)

                if sse:

                    if sse.startswith("data:") and "[DONE]" not in sse:

                        has_content = True

                    yield sse



        except asyncio.CancelledError:

            logger.info(f"Request cancelled for session {session_id}")

            yield "data: [DONE]\n\n"

            return



        except HTTPException:

            raise



        except Exception as e:

            logger.error(f"Agent error for session {session_id}: {e}")

            logger.error(traceback.format_exc())

            yield f"data: {json.dumps({'error': {'message': str(e)}})}\n\n"

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

            "X-Drsai-Session-Id": thread_id or "default",

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

):

    """List sessions for the given user, newest first."""

    store = _get_store(user_id)

    infos = store.list(limit=limit)

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

    """Get messages for a specific session."""

    store = _get_store(user_id)

    msgs = store.load(thread_id)

    info = store.resolve(thread_id)

    return {

        "thread_id": thread_id,

        "name": info.name if info else "",

        "messages": msgs,

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

    return Path(WORKDIR) / uid / "skills"





@app.get("/v1/skills")

async def list_skills(

    user_id: str | None = Query(default=None),

):

    """List installed skills for the given user."""

    skills_dir = _get_skills_dir(user_id)

    skills: list[dict] = []



    if skills_dir.exists():

        for category_dir in sorted(skills_dir.iterdir()):

            if not category_dir.is_dir():

                continue

            for skill_dir in sorted(category_dir.iterdir()):

                if not skill_dir.is_dir():

                    continue

                skill_md = skill_dir / "SKILL.md"

                if not skill_md.exists():

                    continue

                try:

                    content = skill_md.read_text(encoding="utf-8", errors="replace")[:4000]

                    name, description = _parse_skill_frontmatter(content)

                    skills.append({

                        "name": name or skill_dir.name,

                        "category": category_dir.name,

                        "description": description or "",

                        "path": str(skill_dir),

                    })

                except Exception:

                    skills.append({

                        "name": skill_dir.name,

                        "category": category_dir.name,

                        "description": "",

                        "path": str(skill_dir),

                    })



    return {"object": "list", "data": sorted(skills, key=lambda s: (s["category"], s["name"]))}





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





def _parse_skill_frontmatter(content: str) -> tuple[str, str]:

    """Parse SKILL.md frontmatter for name and description."""

    name, description = "", ""

    if not content.startswith("---"):

        # Fall back to first heading and paragraph

        import re

        heading = re.search(r"^#\s+(.+)", content, re.MULTILINE)

        if heading:

            name = heading.group(1).strip()

        para = re.search(r"^(?!#)(?!---).+", content, re.MULTILINE)

        if para:

            description = para.group(0).strip()[:120]

        return name, description



    end_idx = content.find("---", 3)

    if end_idx == -1:

        return name, description



    frontmatter = content[3:end_idx]

    import re

    name_match = re.search(r"^\s*name:\s*[\"']?([^\"'\n]+)[\"']?\s*$", frontmatter, re.MULTILINE)

    if name_match:

        name = name_match.group(1).strip()

    desc_match = re.search(r"^\s*description:\s*[\"']?([^\"'\n]+)[\"']?\s*$", frontmatter, re.MULTILINE)

    if desc_match:

        description = desc_match.group(1).strip()



    return name, description





# âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

# Memory

# âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ



def _get_memory_dir(user_id: str | None = None) -> Path:

    """Resolve the memories directory for a user."""

    uid = user_id or _get_user_id()

    from drsai.backend.run_drsai_agent_factory import WORKDIR

    return Path(WORKDIR) / uid / "memories"





@app.get("/v1/memory")

async def get_memory(

    user_id: str | None = Query(default=None),

):

    """Get memory entries and user profile for the given user."""

    mem_dir = _get_memory_dir(user_id)

    memory_file = mem_dir / "MEMORY.md"

    user_file = mem_dir / "USER.md"



    result = {

        "memory": {"content": "", "exists": False, "charCount": 0},

        "user": {"content": "", "exists": False, "charCount": 0},

    }



    if memory_file.exists():

        content = memory_file.read_text(encoding="utf-8", errors="replace")

        result["memory"] = {

            "content": content,

            "exists": True,

            "charCount": len(content),

        }



    if user_file.exists():

        content = user_file.read_text(encoding="utf-8", errors="replace")

        result["user"] = {

            "content": content,

            "exists": True,

            "charCount": len(content),

        }



    return result





# âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

# Entry point

# âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ



if __name__ == "__main__":

    import uvicorn

    uvicorn.run(app, host=DEFAULT_HOST, port=DEFAULT_PORT)





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




# âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
# Entry point
# âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

def main():
    """Start the DrSai API gateway (uvicorn)."""
    import uvicorn
    uvicorn.run(app, host=DEFAULT_HOST, port=DEFAULT_PORT)


if __name__ == "__main__":
    main()