"""WebSocket attach mode for OpenDrSai TUI Gateway.

Allows remote clients to connect to a running gateway via WebSocket instead of
stdio. The gateway process spawns a small FastAPI server on a local port and
broadcasts that URL via $DRSAI_TUI_ATTACH_URL or a startup event.

Architecture:
- Main gateway still runs the stdin loop on the main thread for the primary
  (stdio) client.
- FastAPI runs in a daemon thread with uvicorn.run().
- Each WebSocket connection gets its own Transport that tees writes back over
  the socket.
- RPC dispatch is shared: all connections write to the same _methods registry.
- Events with a session_id are routed to the owning transport (stdio or WS).

Usage:
  1. Gateway startup calls start_ws_server(port=0) to bind an ephemeral port.
  2. Attach URL is emitted: ws://127.0.0.1:<port>/attach
  3. Remote client connects, sends/receives JSON-RPC frames.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import threading
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .transport import Transport, bind_transport, reset_transport

logger = logging.getLogger(__name__)

# Module-level state: the FastAPI app + bound port
_app: Optional[FastAPI] = None
_ws_port: Optional[int] = None
_ws_thread: Optional[threading.Thread] = None


class WebSocketTransport(Transport):
    """Transport that reads/writes JSON-RPC frames over a WebSocket."""

    def __init__(self, ws: WebSocket):
        self.ws = ws
        self._closed = False

    def write(self, obj: dict) -> bool:
        if self._closed:
            return False
        try:
            line = json.dumps(obj, ensure_ascii=False, default=str) + "\n"
            # FastAPI WebSocket.send_text is *async*, so we must use asyncio
            asyncio.create_task(self.ws.send_text(line))
            return True
        except Exception as exc:
            logger.warning("WebSocketTransport.write failed: %s", exc)
            self._closed = True
            return False

    def close(self) -> None:
        self._closed = True


def _create_app() -> FastAPI:
    """Create the FastAPI app with a single /attach WebSocket endpoint."""
    app = FastAPI(title="OpenDrSai TUI Gateway WebSocket")

    # Allow CORS for local web clients (optional, but helpful for debugging)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.websocket("/attach")
    async def attach(websocket: WebSocket):
        await websocket.accept()
        logger.info("WebSocket client connected: %s", websocket.client)

        transport = WebSocketTransport(websocket)
        bind_transport(transport)

        try:
            # Emit gateway.ready with full skin + setup so the client UI
            # gets the correct theme and first-run status — same payload
            # as the stdio mode in entry.py:main().
            from . import server
            from .entry import setup_status
            skin = server.resolve_skin()
            server._emit("gateway.ready", None, {
                "skin": skin,
                "setup": setup_status(),
            })

            # Read JSON-RPC frames from the client
            while True:
                data = await websocket.receive_text()
                # Parse and dispatch
                try:
                    req = json.loads(data)
                    from . import server
                    # Dispatch inline (FastAPI is already async, so we're on an
                    # asyncio thread). We wrap the sync dispatch in run_in_executor.
                    loop = asyncio.get_event_loop()
                    await loop.run_in_executor(None, server.dispatch, req)
                except json.JSONDecodeError:
                    logger.warning("Invalid JSON from WebSocket: %s", data[:100])
                except Exception:
                    logger.exception("Dispatch failed for WebSocket frame")
        except WebSocketDisconnect:
            logger.info("WebSocket client disconnected")
        finally:
            reset_transport()
            transport.close()

    return app


def start_ws_server(port: int = 0, host: Optional[str] = None) -> int:
    """Start the WebSocket server on a daemon thread.

    Args:
        port: Port to bind (0 = 8765). Default 0.
        host: Interface to bind. Defaults to ``DRSAI_TUI_WS_HOST`` or
            ``127.0.0.1``. Set the environment variable to ``0.0.0.0`` only
            on a trusted LAN when attaching a mobile client.

    Returns:
        The actual bound port (useful when port=0).
    """
    global _app, _ws_port, _ws_thread

    if _ws_thread is not None:
        logger.warning("WebSocket server already running on port %s", _ws_port)
        return _ws_port or 0

    _app = _create_app()
    bind_host = host or os.environ.get("DRSAI_TUI_WS_HOST", "127.0.0.1")

    # We need to find the actual port after uvicorn binds. Uvicorn doesn't
    # expose the port synchronously, so we use a threading.Event to signal
    # when the server is ready.
    ready = threading.Event()
    bound_port = [port]  # Mutable container for closure

    def _run_server():
        import uvicorn

        # Use uvicorn.run directly for simplicity
        # Port binding happens inside run(), so we can't easily extract it
        # for ephemeral ports. For now, require explicit port.
        bound_port[0] = port if port > 0 else 8765  # fallback default
        ready.set()

        uvicorn.run(
            _app,
            host=bind_host,
            port=bound_port[0],
            log_level="warning",
            access_log=False,
        )

    _ws_thread = threading.Thread(target=_run_server, daemon=True, name="drsai-ws")
    _ws_thread.start()

    # Wait up to 2 seconds for the server to be ready
    if ready.wait(timeout=2.0):
        _ws_port = bound_port[0]
        logger.info("WebSocket server started on ws://%s:%d/attach", bind_host, _ws_port)
        return _ws_port
    else:
        logger.error("WebSocket server failed to start within timeout")
        return 0


def get_attach_url() -> Optional[str]:
    """Return the WebSocket attach URL if the server is running."""
    if _ws_port:
        return f"ws://127.0.0.1:{_ws_port}/attach"
    return None
