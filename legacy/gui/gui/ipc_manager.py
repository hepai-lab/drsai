"""IPC single-instance manager for DrSai desktop app.

Ensures only one DrSai desktop process runs at a time (unless
--new-instance is used).  Uses a local TCP socket + lock file:

    ~/.drsai/instance.lock  →  PORT / PID / STARTED timestamp

Flow:
  Process A (first):
    1. Check lock file → PID alive? → If port still connectable, forward; else cleanup
    2. Bind 127.0.0.1:0 (OS chooses port) → write lock file
    3. Start TCP listener → when "NEW_SESSION" received, call callback
    4. On exit → delete lock file

  Process B (second, no --new-instance):
    1. Read lock file → connect to PORT
    2. Send "NEW_SESSION"
    3. Disconnect → sys.exit(0)

  Process C (second, --new-instance or Shift held):
    1. Bypass IPC check → start independent process with unique lock file
"""

from __future__ import annotations

import os
import sys
import json
import socket
import threading
import time
from pathlib import Path
from typing import Callable, Optional

from loguru import logger

from drsai.configs.constant import FS_DIR


# ── Constants ────────────────────────────────────────────────────────────────

LOCK_FILE = Path(FS_DIR) / "instance.lock"
MAX_LOCK_AGE_SECONDS = 86400  # 24h — stale lock cleanup


# ── Lock file helpers ────────────────────────────────────────────────────────

def _read_lock() -> Optional[dict]:
    """Read instance.lock, return dict or None."""
    if not LOCK_FILE.exists():
        return None
    try:
        raw = LOCK_FILE.read_text(encoding="utf-8").strip()
        if not raw:
            return None
        return json.loads(raw)
    except (json.JSONDecodeError, OSError):
        return None


def _write_lock(port: int, pid: int) -> None:
    """Write lock file atomically."""
    data = {
        "port": port,
        "pid": pid,
        "started": time.time(),
        "version": 1,
    }
    tmp = LOCK_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(data), encoding="utf-8")
    tmp.replace(LOCK_FILE)


def _delete_lock() -> None:
    """Remove lock file (idempotent)."""
    try:
        LOCK_FILE.unlink(missing_ok=True)
    except Exception:
        pass


def _is_pid_alive(pid: int) -> bool:
    """Check if a process with given PID is still running."""
    try:
        import ctypes
        import ctypes.wintypes
        SYNCHRONIZE = 0x00100000
        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        handle = ctypes.windll.kernel32.OpenProcess(
            PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, False, pid
        )
        if handle == 0:
            return False
        exit_code = ctypes.wintypes.DWORD()
        ctypes.windll.kernel32.GetExitCodeProcess(handle, ctypes.byref(exit_code))
        ctypes.windll.kernel32.CloseHandle(handle)
        return exit_code.value == 259  # STILL_ACTIVE
    except Exception:
        return False


def _is_port_connectable(port: int, host: str = "127.0.0.1", timeout: float = 0.5) -> bool:
    """Check if a TCP port is accepting connections."""
    try:
        s = socket.create_connection((host, port), timeout=timeout)
        s.close()
        return True
    except (socket.timeout, ConnectionRefusedError, OSError):
        return False


def _send_to_existing(port: int, message: str = "NEW_SESSION", timeout: float = 3.0) -> bool:
    """Send a message to an existing instance. Returns True on success."""
    try:
        s = socket.create_connection(("127.0.0.1", port), timeout=timeout)
        s.sendall(message.encode("utf-8"))
        # Read acknowledgment
        s.settimeout(2.0)
        response = s.recv(1024).decode("utf-8").strip()
        s.close()
        return response == "OK"
    except Exception as e:
        logger.debug(f"IPC send failed: {e}")
        return False


# ── IPC Server ────────────────────────────────────────────────────────────────

class IPCServer:
    """Lightweight TCP server to receive commands from new process instances.

    Runs in its own thread.  Only handles one connection at a time
    (simple loop: accept → read → callback → close).  For the desktop
    single-instance use case this is more than sufficient.
    """

    def __init__(
        self,
        *,
        on_new_session: Callable[[], None],
        host: str = "127.0.0.1",
    ) -> None:
        self._on_new_session = on_new_session
        self._host = host
        self._port: int = -1
        self._sock: Optional[socket.socket] = None
        self._thread: Optional[threading.Thread] = None
        self._running = False

    @property
    def port(self) -> int:
        return self._port

    def start(self) -> bool:
        """Bind, start listener thread. Returns True on success."""
        if self._running:
            logger.warning("IPC server already running")
            return True

        try:
            self._sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self._sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            self._sock.bind((self._host, 0))  # OS chooses port
            self._port = self._sock.getsockname()[1]
            self._sock.listen(1)
            self._sock.settimeout(2.0)  # 2s accept timeout → check _running
        except OSError as e:
            logger.error(f"IPC server bind failed: {e}")
            return False

        self._running = True
        self._thread = threading.Thread(target=self._listen_loop, daemon=True)
        self._thread.start()
        logger.info(f"IPC server started on {self._host}:{self._port}")
        return True

    def _listen_loop(self) -> None:
        """Accept loop — runs in background thread."""
        while self._running:
            try:
                conn, addr = self._sock.accept()
            except socket.timeout:
                continue  # Just check _running flag
            except OSError:
                break  # Socket closed

            try:
                data = conn.recv(1024).decode("utf-8").strip()
                logger.info(f"IPC received: {data!r} from {addr}")

                if data == "NEW_SESSION":
                    conn.sendall(b"OK")
                    # Callback on main thread via the AppContext's GUI bridge
                    try:
                        self._on_new_session()
                    except Exception as e:
                        logger.error(f"IPC new_session callback failed: {e}")
                else:
                    conn.sendall(b"UNKNOWN")

            except Exception as e:
                logger.debug(f"IPC connection error: {e}")
                try:
                    conn.sendall(b"ERROR")
                except Exception:
                    pass
            finally:
                try:
                    conn.close()
                except Exception:
                    pass

    def stop(self) -> None:
        """Shutdown IPC server."""
        self._running = False
        if self._sock:
            try:
                self._sock.close()
            except Exception:
                pass
            self._sock = None
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=3.0)
        self._port = -1
        logger.info("IPC server stopped")


# ── Entry-point helper ────────────────────────────────────────────────────────

def check_and_handle_instance(
    on_new_session: Callable[[], None],
    force_new_instance: bool = False,
) -> tuple[Optional[IPCServer], bool]:
    """Check for existing instance and handle accordingly.

    Called once at app startup (before creating GUI).

    Args:
        on_new_session: Callback to create a new session window (called
                        in the existing instance when a new process sends
                        NEW_SESSION).
        force_new_instance: If True, bypass IPC check and start a new
                            independent instance (Shift+click / --new-instance).

    Returns:
        (ipc_server_or_None, should_continue)
        - (ipc_server, True): This is the first (or forced) instance — continue startup.
        - (None, False): Another instance is running — forwarded and this process
                         should exit immediately.
    """
    if force_new_instance:
        logger.info("Force new instance — bypassing IPC check")
        ipc = IPCServer(on_new_session=on_new_session)
        if ipc.start():
            _write_lock(ipc.port, os.getpid())
            return ipc, True
        logger.warning("IPC server start failed for forced instance")
        return None, True  # Continue anyway without IPC

    # ── Check existing lock ────────────────────────────────────────────────
    lock_data = _read_lock()

    if lock_data:
        port = lock_data.get("port", 0)
        pid = lock_data.get("pid", 0)

        if pid and _is_pid_alive(pid):
            # PID alive → try to connect
            if port and _is_port_connectable(port):
                # Existing instance is running and reachable → forward
                logger.info(f"Existing instance found (PID={pid}, PORT={port}) — forwarding")
                success = _send_to_existing(port, "NEW_SESSION")
                if success:
                    logger.info("Successfully forwarded to existing instance")
                    return None, False
                logger.warning("Failed to forward to existing instance — starting new")
            else:
                # PID alive but port dead → stale lock, cleanup
                logger.warning(f"Stale lock (PID={pid} alive but port={port} dead) — cleaning up")
                _delete_lock()
        else:
            # PID dead → stale lock
            logger.info(f"Stale lock (PID={pid} dead) — cleaning up")
            _delete_lock()

    # ── Start as first instance ─────────────────────────────────────────────
    ipc = IPCServer(on_new_session=on_new_session)
    if not ipc.start():
        logger.error("Failed to start IPC server — continuing without IPC")
        return None, True  # Continue without IPC (degraded)

    _write_lock(ipc.port, os.getpid())
    return ipc, True


def cleanup_instance(ipc: Optional[IPCServer] = None) -> None:
    """Cleanup lock file and IPC server on exit."""
    if ipc:
        ipc.stop()
    _delete_lock()
    logger.info("Instance lock cleaned up")


def detect_new_instance_flag() -> bool:
    """Detect if user wants a new instance via CLI args or Shift key.

    Returns True if --new-instance is in sys.argv OR Shift is currently held.
    """
    # CLI flag
    if "--new-instance" in sys.argv:
        return True

    # Shift key held (Windows only)
    if sys.platform == "win32":
        try:
            import ctypes
            # VK_SHIFT = 0x10, GetAsyncKeyState returns high bit if held
            SHIFT_PRESSED = 0x10
            state = ctypes.windll.user32.GetAsyncKeyState(SHIFT_PRESSED)
            if state & 0x8000:  # High bit → key is currently held down
                return True
        except Exception:
            pass

    return False
