"""
daemon_server.py — OpenDrSai 后台常驻 Gateway 服务

独立于 TUI 子进程运行，通过 WebSocket 提供 JSON-RPC 接口。
协议与现有 stdin/stdout 模式完全兼容。
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import signal
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Optional

import uvicorn
from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from drsai.backend.tui_gateway.server import (
    dispatch,
    _methods,
    _sessions,
)
from drsai.backend.tui_gateway.transport import Transport
from .config import DaemonConfig

logger = logging.getLogger(__name__)


# ── WebSocket Transport ───────────────────────────────────────────────


class WebSocketTransport(Transport):
    """将 JSON-RPC 帧发送到 WebSocket 客户端。"""

    def __init__(self, ws: WebSocket):
        self.ws = ws
        self._closed = False
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    def _get_loop(self) -> asyncio.AbstractEventLoop:
        if self._loop is None:
            self._loop = asyncio.get_event_loop()
        return self._loop

    def write(self, obj: dict) -> bool:
        if self._closed:
            return False
        try:
            line = json.dumps(obj, ensure_ascii=False, default=str)
            loop = self._get_loop()
            coro = self.ws.send_text(line)
            if loop.is_running():
                asyncio.ensure_future(coro, loop=loop)
            else:
                loop.run_until_complete(coro)
            return True
        except Exception as exc:
            logger.warning("WebSocketTransport.write failed: %s", exc)
            self._closed = True
            return False

    def close(self) -> None:
        self._closed = True


# ── Connection Registry ───────────────────────────────────────────────


class ConnectionRegistry:
    """管理活跃的 WebSocket 连接。"""

    def __init__(self):
        self._conns: dict[str, WebSocketTransport] = {}  # conn_id → transport
        self._subscriptions: dict[str, set[str]] = {}    # session_id → {conn_id}

    def register(self, conn_id: str, transport: WebSocketTransport) -> None:
        self._conns[conn_id] = transport

    def unregister(self, conn_id: str) -> None:
        self._conns.pop(conn_id, None)
        for subs in self._subscriptions.values():
            subs.discard(conn_id)

    def subscribe(self, conn_id: str, session_id: str) -> None:
        self._subscriptions.setdefault(session_id, set()).add(conn_id)

    def get_transports_for_session(self, session_id: str) -> list[WebSocketTransport]:
        conn_ids = self._subscriptions.get(session_id, set())
        return [self._conns[cid] for cid in conn_ids if cid in self._conns]

    def broadcast(self, obj: dict) -> None:
        for transport in list(self._conns.values()):
            transport.write(obj)


_registry = ConnectionRegistry()

# Runtime model override — set via /api/model POST endpoint.
# When non-empty, all new sessions use this model. Already-running
# sessions are switched immediately via switch_model().
_daemon_model: str = ""


# ── FastAPI Application ───────────────────────────────────────────────


def create_app(config: DaemonConfig) -> FastAPI:
    """创建 FastAPI 应用。"""

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        global _daemon_model
        _daemon_model = config.model or ""
        logger.info("Daemon '%s' starting (PID=%d, model=%s)", config.name, os.getpid(),
                     _daemon_model or "(default)")
        if config.wechat_enabled:
            asyncio.create_task(_start_wechat(config))
        yield
        logger.info("Daemon '%s' shutting down", config.name)

    app = FastAPI(title=f"OpenDrSai Daemon [{config.name}]", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ── Health / Info endpoints ───────────────────────────────────────

    @app.get("/api/health")
    async def health():
        return {"status": "ok", "name": config.name, "pid": os.getpid()}

    @app.get("/api/info")
    async def info():
        return {
            "name": config.name,
            "pid": os.getpid(),
            "ws_port": config.ws_port,
            "wechat_port": config.wechat_port,
            "wechat_enabled": config.wechat_enabled,
            "model": _daemon_model or "(default)",
            "started_at": config.started_at,
            "session_count": len(_sessions),
            "uptime_seconds": time.time() - config.started_at,
        }

    @app.get("/api/sessions")
    async def list_sessions():
        result = []
        for sid, state in _sessions.items():
            sess = state.get("agent_session")
            result.append({
                "session_id": sid,
                "running": state.get("running", False),
                "model": getattr(getattr(sess, "agent", None),
                                 "_defult_config_name", "?") if sess else "?",
            })
        return {"sessions": result}

    # ── Model management endpoint ──────────────────────────────────

    @app.post("/api/model")
    async def set_model(request):
        """Set the daemon's default model.

        Request body: {"model": "claude-sonnet-4-5"}

        All *new* sessions created after this call will use the new model.
        *Existing* sessions are switched immediately via switch_model().
        """
        global _daemon_model
        try:
            body = await request.json()
        except Exception:
            return {"error": "invalid JSON body"}

        new_model = (body or {}).get("model", "")
        if not new_model:
            return {"error": "model is required"}

        _daemon_model = new_model
        # Update env vars so new sessions pick up the model
        os.environ["DRSAI_DAEMON_MODEL"] = new_model
        os.environ["LLM_DEFAULT_ALIAS"] = new_model

        # Switch existing sessions to the new model
        switched = 0
        for state in list(_sessions.values()):
            sess = state.get("agent_session")
            if sess is not None and hasattr(sess, "switch_model"):
                try:
                    sess.switch_model(new_model)
                    switched += 1
                except Exception:
                    logger.warning("Failed to switch session %s model", getattr(sess, "session_id", "?"), exc_info=True)

        logger.info("Daemon model changed to '%s' (%d sessions switched)", new_model, switched)
        return {
            "model": new_model,
            "sessions_switched": switched,
        }

    # ── WebSocket endpoint ────────────────────────────────────────────

    @app.websocket("/ws")
    async def ws_endpoint(ws: WebSocket, token: str = Query(...)):
        # Token 验证
        if token != config.api_token:
            await ws.close(code=4001, reason="Unauthorized")
            return

        conn_id = uuid.uuid4().hex[:8]
        transport = WebSocketTransport(ws)
        _registry.register(conn_id, transport)
        await ws.accept()

        logger.info("WebSocket client connected: conn_id=%s", conn_id)

        # 发送 gateway.ready（与 stdio 模式一致）
        transport.write({
            "jsonrpc": "2.0",
            "method": "event",
            "params": {
                "type": "gateway.ready",
                "payload": {
                    "skin": {"branding": {"name": f"OpenDrSai Daemon [{config.name}]"}},
                    "daemon": {
                        "name": config.name,
                        "pid": os.getpid(),
                        "ws_port": config.ws_port,
                    },
                },
            },
        })

        try:
            async for raw in ws.iter_text():
                raw = raw.strip()
                if not raw:
                    continue
                try:
                    req = json.loads(raw)
                except json.JSONDecodeError:
                    transport.write({
                        "jsonrpc": "2.0",
                        "error": {"code": -32700, "message": "parse error"},
                        "id": None,
                    })
                    continue

                # session.subscribe：将 conn 绑定到 session
                if isinstance(req, dict) and req.get("method") == "session.subscribe":
                    sid = (req.get("params") or {}).get("session_id", "")
                    if sid:
                        _registry.subscribe(conn_id, sid)
                        # Always set transport — create a stub _sessions entry if
                        # the session hasn't been loaded yet (e.g. when DaemonSubagent
                        # calls session.subscribe before prompt.submit).
                        if sid not in _sessions:
                            _sessions[sid] = {}
                        _sessions[sid]["transport"] = transport
                    transport.write({
                        "jsonrpc": "2.0",
                        "id": req.get("id"),
                        "result": {"subscribed": sid},
                    })
                    continue

                # 普通 RPC：dispatch（与 stdio 模式共用同一个 _methods 注册表）
                resp = dispatch(req, transport=transport)
                if resp is not None:
                    transport.write(resp)

        except WebSocketDisconnect:
            logger.info("WebSocket client disconnected: conn_id=%s", conn_id)
        finally:
            _registry.unregister(conn_id)
            transport.close()

    # ── 企业微信 Webhook（可选）──────────────────────────────────────

    @app.post("/wechat/work")
    async def work_wechat(request):
        """企业微信 Bot Webhook 入口（选实现）。"""
        try:
            from .work_wechat_adapter import handle_work_webhook
            body = await request.json()
            asyncio.create_task(handle_work_webhook(body, _sessions))
        except ImportError:
            logger.warning("work_wechat_adapter not available")
        return {"errcode": 0, "errmsg": "ok"}

    return app


async def _start_wechat(config: DaemonConfig) -> None:
    """在后台启动微信 ilink Bot。"""
    from .wechat_adapter import start_wechat_bot
    try:
        await start_wechat_bot(config, _sessions)
    except Exception:
        logger.exception("WeChatBot crashed")


def run_daemon(config: DaemonConfig) -> None:
    """启动 Daemon 进程主循环（阻塞）。"""
    app = create_app(config)

    # 信号处理：优雅退出
    def _on_signal(signum, frame):
        logger.info("Daemon received signal %d, shutting down", signum)
        raise SystemExit(0)

    signal.signal(signal.SIGTERM, _on_signal)
    signal.signal(signal.SIGINT, _on_signal)

    uvicorn.run(
        app,
        host="127.0.0.1",
        port=config.ws_port,
        log_level="info",
        access_log=False,
    )
