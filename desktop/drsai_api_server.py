"""
DrSai API Server — FastAPI SSE streaming server wrapping DrSai Assistant.

Provides an OpenAI-compatible /v1/chat/completions endpoint so the
Electron desktop app (modelled after hermes-desktop) can drive a local
DrSai agent via HTTP SSE instead of spawning CLI subprocesses.

Usage:
    python drsai_api_server.py                # default port 8642
    DRSAI_API_PORT=18642 python ...           # custom port
    DRSAI_API_HOST=0.0.0.0 python ...         # bind all interfaces

Protocol:
    POST /v1/chat/completions
        Content-Type: application/json
        Body: {
            "model": "drsai",                 // model alias from llm_mode_config
            "messages": [{"role":"user","content":"..."}],
            "stream": true,
            "thread_id": "optional-session-id",
            "work_dir": "/path/to/project"    // cwd for tool execution
        }

        Response (text/event-stream):
            data: {"choices":[{"delta":{"content":"Hello"},"index":0}]}

            data: {"choices":[{"delta":{"content":" world"},"index":0}]}

            event: tool.progress
            data: {"tool":"read_file","arguments":{"path":"..."}}

            event: tool.result
            data: {"content":"..."}

            data: {"choices":[{"delta":{},"usage":{"total_tokens":42}}]}

            data: [DONE]

    GET /health
        → {"status":"ok","agent":"ready"}

    GET /v1/models
        → {"object":"list","data":[...]}
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import traceback
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, Request
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

# ── Optional event types (may not be imported if module not available) ─────
try:
    from drsai.modules.agents.skills_agent.drsai_assistant import (
        ThoughtEvent,
        MemoryQueryEvent,
    )
except ImportError:
    ThoughtEvent = None
    MemoryQueryEvent = None


# ═══════════════════════════════════════════════════════════════════════════════
# Config
# ═══════════════════════════════════════════════════════════════════════════════

DEFAULT_PORT = int(os.environ.get("DRSAI_API_PORT", "8642"))
DEFAULT_HOST = os.environ.get("DRSAI_API_HOST", "127.0.0.1")

# ── Logging ──────────────────────────────────────────────────────────────────
logger.remove()
logger.add(
    sys.stderr,
    format="<green>{time:HH:mm:ss}</green> | <level>{level: <8}</level> | <level>{message}</level>",
    level="INFO",
)


# ═══════════════════════════════════════════════════════════════════════════════
# Pydantic models
# ═══════════════════════════════════════════════════════════════════════════════

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
    work_dir: Optional[str] = Field(
        default=None,
        description="Working directory for tool execution. "
                    "Defaults to the server's current working directory.",
    )


# ═══════════════════════════════════════════════════════════════════════════════
# Agent Manager — session-isolated agent pool
# ═══════════════════════════════════════════════════════════════════════════════

class AgentManager:
    """Manage DrSai agent instances keyed by thread_id for session isolation.

    Design decisions:
    - One agent per thread_id → full conversation history preserved per session
    - Single request lock per agent → no concurrent chat in same session
    - CancellationToken passed per request → HTTP disconnect cancels streaming
    - Model switching via model_alias → agent rebuilt with new model_client
    """

    def __init__(self) -> None:
        self._agents: dict[str, Any] = {}           # thread_id → agent
        self._model_aliases: dict[str, str] = {}    # thread_id → current model alias
        self._locks: dict[str, asyncio.Lock] = {}   # thread_id → request lock
        self._global_lock = asyncio.Lock()
        self._default_agent: Any | None = None      # fallback for no thread_id

    async def _get_lock(self, thread_id: str) -> asyncio.Lock:
        if thread_id not in self._locks:
            self._locks[thread_id] = asyncio.Lock()
        return self._locks[thread_id]

    async def get_or_create(
        self,
        thread_id: str | None = None,
        model_alias: str | None = None,
        work_dir: str | None = None,
    ) -> Any:
        """Get existing agent for thread_id, or create a new one.

        Rebuilds the agent if model_alias differs from the running one.
        """
        tid = thread_id or "__default__"

        async with self._global_lock:
            agent = self._agents.get(tid)
            current_alias = self._model_aliases.get(tid)

            # Rebuild if model changed or agent doesn't exist
            if agent is None or (model_alias and model_alias != current_alias):
                logger.info(
                    f"Creating agent: thread_id={tid}, model={model_alias}, work_dir={work_dir}"
                )
                # create_agent is sync (contains blocking I/O), run in thread
                agent = await asyncio.to_thread(
                    create_agent,
                    thread_id=thread_id,
                    work_dir=work_dir or os.getcwd(),
                    defult_config_name=model_alias or "hepai/minimax-m2.7-highspeed",
                )
                self._agents[tid] = agent
                self._model_aliases[tid] = model_alias

            return agent

    async def run_stream(
        self,
        task: str,
        thread_id: str | None = None,
        model_alias: str | None = None,
        work_dir: str | None = None,
        cancellation_token: CancellationToken | None = None,
    ):
        """Run agent.run_stream() for the given session, with concurrency guard."""
        tid = thread_id or "__default__"
        lock = await self._get_lock(tid)

        # Non-blocking: if another request is in-flight for this session, reject
        if lock.locked():
            raise HTTPException(
                status_code=503,
                detail=f"Session {tid} is busy. Wait for the current response to complete.",
            )

        async with lock:
            agent = await self.get_or_create(
                thread_id=thread_id,
                model_alias=model_alias,
                work_dir=work_dir,
            )
            async for event in agent.run_stream(
                task=task,
                cancellation_token=cancellation_token,
            ):
                yield event

    async def health(self) -> dict:
        """Check if any agent is alive."""
        if self._agents or self._default_agent:
            return {"status": "ok", "agent": "ready", "sessions": len(self._agents)}
        return {"status": "ok", "agent": "not_initialized", "sessions": 0}

    async def list_models(self) -> list[dict]:
        """Return available models from llm_mode_config."""
        try:
            llm_config = await asyncio.to_thread(load_llm_mode_config, None)
            return [
                {"id": alias, "object": "model"}
                for alias in llm_config
            ]
        except Exception:
            return [{"id": "drsai", "object": "model"}]


# ═══════════════════════════════════════════════════════════════════════════════
# FastAPI application
# ═══════════════════════════════════════════════════════════════════════════════

manager = AgentManager()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup/shutdown hooks."""
    logger.info(f"🚀 DrSai API Server starting on {DEFAULT_HOST}:{DEFAULT_PORT}")
    yield
    logger.info("👋 DrSai API Server shutting down")


app = FastAPI(
    title="DrSai API Server",
    version="0.1.0",
    lifespan=lifespan,
)


# ── Health ───────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    """Health check endpoint. Hermes Desktop polls this to detect API readiness."""
    return await manager.health()


# ── Models ───────────────────────────────────────────────────────────────────

@app.get("/v1/models")
async def list_models():
    """List available models. OpenAI-compatible format."""
    models = await manager.list_models()
    return {"object": "list", "data": models}


# ── Chat (streaming) ─────────────────────────────────────────────────────────

@app.post("/v1/chat/completions")
async def chat_completions(request: ChatRequest, raw_request: Request):
    """OpenAI-compatible chat completions with SSE streaming.

    Only streaming mode is supported. The caller MUST set stream=true.
    """
    # Extract the last user message as the task
    user_msgs = [m for m in request.messages if m.role == "user"]
    if not user_msgs:
        raise HTTPException(status_code=400, detail="No user message found")
    task = user_msgs[-1].content

    thread_id = request.thread_id
    work_dir = request.work_dir or os.getcwd()

    # Build cancellation token — cancels when HTTP client disconnects
    cancel_token = CancellationToken()

    async def generate_sse():
        """Generate SSE events from agent.run_stream()."""
        session_id = thread_id or str(uuid.uuid4())
        has_content = False

        try:
            async for event in manager.run_stream(
                task=task,
                thread_id=thread_id,
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

        finally:
            if not has_content:
                pass  # Don't double-send [DONE]

    # Watch for client disconnect → cancel agent
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
            "X-Accel-Buffering": "no",  # Disable nginx buffering
        },
    )


# ═══════════════════════════════════════════════════════════════════════════════
# Event → SSE mapping
# ═══════════════════════════════════════════════════════════════════════════════

def _event_to_sse(event: Any) -> str | None:
    """Map a DrSai event to an SSE-formatted string. Returns None if skip."""

    # ── Streaming token chunk (per-token, confirmed by user) ──────────────
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

    # ── Tool call request (e.g. read_file, search) ───────────────────────
    if isinstance(event, ToolCallRequestEvent):
        payload = json.dumps({
            "tool": _safe_str(event.content),
            "arguments": _safe_json(getattr(event, 'arguments', None)),
        }, ensure_ascii=False)
        return f"event: tool.progress\ndata: {payload}\n\n"

    # ── Tool call result ─────────────────────────────────────────────────
    if isinstance(event, ToolCallExecutionEvent):
        payload = json.dumps({
            "tool": _safe_str(event.content),
            "result": _safe_str(getattr(event, 'result', None)),
        }, ensure_ascii=False)
        return f"event: tool.result\ndata: {payload}\n\n"

    # ── Thought/reasoning event ───────────────────────────────────────────
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

    # ── User message echo (skip: contains internal metadata) ──────────────
    if isinstance(event, TextMessage) and event.source == "user":
        return None

    # ── Assistant text message (skip when streaming chunks already sent) ──
    if isinstance(event, TextMessage) and event.source != "user":
        return None  # Content already delivered via ModelClientStreamingChunkEvent

    # ── Final Response → extract usage info ──────────────────────────────
    if isinstance(event, Response):
        inner = getattr(event, 'inner_messages', None) or []
        usage = getattr(event, 'usage', None)
        if usage:
            chunk = json.dumps({
                "choices": [{
                    "delta": {},
                    "index": 0,
                }],
                "usage": {
                    "prompt_tokens": getattr(usage, 'prompt_tokens', 0),
                    "completion_tokens": getattr(usage, 'completion_tokens', 0),
                    "total_tokens": getattr(usage, 'total_tokens', 0),
                }
            })
            return f"data: {chunk}\n\n"
        return None

    # ── TaskResult → end of stream ───────────────────────────────────────
    if isinstance(event, TaskResult):
        return "data: [DONE]\n\n"

    # ── Unknown event → log and skip ─────────────────────────────────────
    logger.debug(f"Unhandled event type: {type(event).__name__}")
    return None


# ── Helpers ──────────────────────────────────────────────────────────────────

def _safe_str(value: Any) -> str:
    """Safe string conversion for SSE payloads."""
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    try:
        return str(value)
    except Exception:
        return repr(value)


def _safe_json(value: Any) -> Any:
    """Ensure value is JSON-serializable."""
    if value is None:
        return None
    try:
        json.dumps(value)
        return value
    except (TypeError, ValueError):
        return str(value)


# ── Sessions ─────────────────────────────────────────────────────────────────

@app.get("/v1/sessions")
async def list_sessions(limit: int = 50):
    """List all saved sessions."""
    try:
        agent = await manager.get_or_create()
        sessions = await asyncio.to_thread(agent.list_sessions, limit)
        return {"object": "list", "data": [s._asdict() if hasattr(s, '_asdict') else s for s in sessions]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/v1/sessions/search")
async def search_sessions(q: str = "", limit: int = 20):
    """Search sessions by query substring."""
    try:
        agent = await manager.get_or_create()
        results = await asyncio.to_thread(agent.search_sessions, q, limit)
        return {"object": "list", "data": [s._asdict() if hasattr(s, '_asdict') else s for s in results]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class RenameRequest(BaseModel):
    name: str

@app.put("/v1/sessions/{thread_id}/name")
async def rename_session(thread_id: str, body: RenameRequest):
    """Rename a session."""
    try:
        agent = await manager.get_or_create(thread_id=thread_id)
        ok = await asyncio.to_thread(agent.set_session_name, thread_id, body.name)
        return {"ok": ok}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/v1/sessions/{thread_id}/history")
async def session_history(thread_id: str):
    """Load conversation history for a session."""
    try:
        agent = await manager.get_or_create(thread_id=thread_id)
        history = await asyncio.to_thread(agent.load_history, thread_id)
        return {"object": "list", "data": history}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Usage / Stats ────────────────────────────────────────────────────────────

@app.get("/v1/usage")
async def usage():
    """Get token usage stats for the current/default agent."""
    try:
        agent = await manager.get_or_create()
        stats = agent.token_stats
        return {
            "prompt_tokens": stats.prompt_tokens,
            "completion_tokens": stats.completion_tokens,
            "total_tokens": stats.prompt_tokens + stats.completion_tokens,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Reasoning ─────────────────────────────────────────────────────────────────

class ReasoningRequest(BaseModel):
    effort: str  # "show" | "hide" | "off" | "low" | "medium" | "high"

@app.get("/v1/reasoning")
async def get_reasoning():
    """Get current reasoning effort setting."""
    try:
        agent = await manager.get_or_create()
        return {"effort": agent.reasoning_effort}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/v1/reasoning")
async def set_reasoning(body: ReasoningRequest):
    """Set reasoning effort."""
    try:
        agent = await manager.get_or_create()
        agent.reasoning_effort = body.effort
        return {"effort": agent.reasoning_effort}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ═══════════════════════════════════════════════════════════════════════════════
# Entry point
# ═══════════════════════════════════════════════════════════════════════════════

def main():
    """Start the DrSai API server."""
    import uvicorn

    logger.info(f"DrSai API Server v0.1.0")
    logger.info(f"Listening on http://{DEFAULT_HOST}:{DEFAULT_PORT}")
    logger.info(f"Health check: http://{DEFAULT_HOST}:{DEFAULT_PORT}/health")

    uvicorn.run(
        app,
        host=DEFAULT_HOST,
        port=DEFAULT_PORT,
        log_level="info",
        timeout_keep_alive=120,  # Long keep-alive for SSE
    )


if __name__ == "__main__":
    main()
