"""
pid_manager.py — Daemon 进程生命周期管理

负责：
- PID 文件的读写
- daemon 进程的启动 / 停止 / 状态检查
- 端口可用性检测
"""

from __future__ import annotations

import json
import os
import secrets
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path
from typing import Optional

from drsai.configs.constant import FS_DIR
from drsai.backend.wechat.wechat_login import is_credentials_valid, login_wechat_main

DAEMONS_DIR = Path(FS_DIR) / "workspace" / "daemons"
LOGS_DIR = Path(FS_DIR) / "logs" / "daemons"


def _daemon_dir(name: str) -> Path:
    return DAEMONS_DIR / name


def _pid_file(name: str) -> Path:
    return DAEMONS_DIR / f"{name}.pid"


def _state_file(name: str) -> Path:
    return DAEMONS_DIR / f"{name}.json"


def _log_file(name: str) -> Path:
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    return LOGS_DIR / f"{name}.log"


# ── 端口检测 ─────────────────────────────────────────────────────────


def is_port_free(port: int, host: str = "127.0.0.1") -> bool:
    """检查端口是否空闲。"""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind((host, port))
            return True
        except OSError:
            return False


def find_free_port(start: int = 42500, end: int = 43000) -> int:
    """返回 [start, end) 内第一个可用端口。"""
    for port in range(start, end):
        if is_port_free(port):
            return port
    raise RuntimeError(f"No free port found in [{start}, {end})")


# ── PID 管理 ─────────────────────────────────────────────────────────


def read_pid(name: str) -> Optional[int]:
    """读取 PID 文件；文件不存在或内容无效返回 None。"""
    pid_path = _pid_file(name)
    if not pid_path.exists():
        return None
    try:
        return int(pid_path.read_text().strip())
    except (ValueError, OSError):
        return None


def write_pid(name: str, pid: int) -> None:
    DAEMONS_DIR.mkdir(parents=True, exist_ok=True)
    _pid_file(name).write_text(str(pid))


def remove_pid(name: str) -> None:
    _pid_file(name).unlink(missing_ok=True)


def remove_state(name: str) -> None:
    """Remove the daemon state file, if it exists."""
    _state_file(name).unlink(missing_ok=True)


def is_running(name: str) -> bool:
    """检查 daemon 是否仍在运行（PID 文件存在且进程存活）。"""
    pid = read_pid(name)
    if pid is None:
        return False
    try:
        os.kill(pid, 0)  # 发送 signal 0 检查进程是否存在
        return True
    except (OSError, ProcessLookupError):
        remove_pid(name)
        return False


# ── State 文件 ───────────────────────────────────────────────────────


def read_state(name: str) -> Optional[dict]:
    state_path = _state_file(name)
    if not state_path.exists():
        return None
    try:
        return json.loads(state_path.read_text())
    except (json.JSONDecodeError, OSError):
        return None


def write_state(name: str, state: dict) -> None:
    DAEMONS_DIR.mkdir(parents=True, exist_ok=True)
    _state_file(name).write_text(json.dumps(state, indent=2))


# ── Daemon 启动 ──────────────────────────────────────────────────────


def start_daemon(
    name: str,
    ws_port: Optional[int] = None,
    wechat_port: Optional[int] = None,
    wechat_enabled: bool = False,
    model: Optional[str] = None,
) -> dict:
    """
    启动 daemon 进程。

    Args:
        model: 可选，指定 daemon 使用的模型别名。通过 LLM_DEFAULT_ALIAS
               环境变量传递，优先级高于 CLI config 文件中的默认模型。

    Returns:
        dict with keys: name, pid, ws_port, wechat_port, api_token, log_file, model
    """
    if is_running(name):
        state = read_state(name)
        raise RuntimeError(
            f"Daemon '{name}' is already running (PID={state.get('pid')}). "
            f"Use `drsai daemon stop --name {name}` to stop it first."
        )

    # 端口分配
    if ws_port is None:
        ws_port = find_free_port(42500, 43000)
    elif not is_port_free(ws_port):
        raise RuntimeError(f"Port {ws_port} is already in use.")

    if wechat_enabled and wechat_port is None:
        wechat_port = find_free_port(9000, 9100)
    elif wechat_enabled and wechat_port is not None and not is_port_free(wechat_port, "0.0.0.0"):
        raise RuntimeError(f"WeChat port {wechat_port} is already in use.")

    # 微信登录：如果凭据不存在或已过期，在父进程（有终端）中触发扫码
    if wechat_enabled and not is_credentials_valid():
        import asyncio
        print("\n微信凭据不存在或已过期，正在进入扫码登录流程...\n")
        try:
            asyncio.run(login_wechat_main())
        except Exception as e:
            raise RuntimeError(f"微信登录失败: {e}")

    # 生成 API Token
    api_token = f"dsk_{secrets.token_hex(16)}"

    # 准备日志文件
    log_path = _log_file(name)

    # 启动子进程（脱离终端）
    env = os.environ.copy()
    env.update({
        "DRSAI_DAEMON_NAME": name,
        "DRSAI_DAEMON_WS_PORT": str(ws_port),
        "DRSAI_DAEMON_WECHAT_PORT": str(wechat_port or ""),
        "DRSAI_DAEMON_WECHAT_ENABLED": "1" if wechat_enabled else "0",
        "DRSAI_DAEMON_API_TOKEN": api_token,
        "DRSAI_DAEMON_MODEL": model or "",
        "LLM_DEFAULT_ALIAS": model or os.environ.get("LLM_DEFAULT_ALIAS", ""),
        "DRSAI_DAEMON_STARTED_AT": str(time.time()),
        "DRSAI_DAEMON_LOG_FILE": str(log_path),
    })

    if sys.platform == "win32":
        # Windows: Python opens files with O_NOINHERIT, so file handles from
        # open() are NOT inheritable by child processes.  Passing stdout=log_fd
        # together with close_fds=True causes _winapi.CreateProcess to fail
        # with ERROR_INVALID_HANDLE in PowerShell / GUI parent processes.
        #
        # Workaround: pass the log *path* via env var and let the daemon child
        # redirect its own stdout/stderr (see __main__.py).  Use
        # DETACHED_PROCESS (instead of POSIX start_new_session) to decouple
        # from the parent's console.
        proc = subprocess.Popen(
            [sys.executable, "-m", "drsai.backend.daemon"],
            env=env,
            stdin=subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP
            | subprocess.DETACHED_PROCESS,
            close_fds=False,
        )
    else:
        log_fd = open(log_path, "a")
        proc = subprocess.Popen(
            [sys.executable, "-m", "drsai.backend.daemon"],
            env=env,
            stdout=log_fd,
            stderr=log_fd,
            start_new_session=True,  # 脱离父进程组，TUI 退出后继续运行
            close_fds=True,
        )
        log_fd.close()

    # 等待就绪
    try:
        _wait_for_ready(proc, ws_port, timeout=15.0)
    except TimeoutError:
        # 尝试清理
        try:
            proc.terminate()
        except Exception:
            pass
        remove_pid(name)
        raise

    state = {
        "name": name,
        "pid": proc.pid,
        "ws_port": ws_port,
        "wechat_port": wechat_port,
        "wechat_enabled": wechat_enabled,
        "api_token": api_token,
        "model": model or "",
        "started_at": time.time(),
        "log_file": str(log_path),
    }
    write_state(name, state)
    write_pid(name, proc.pid)
    return state


def _wait_for_ready(proc, port: int, timeout: float = 15.0) -> None:
    """轮询直到 daemon HTTP 端就绪。

    Args:
        proc: ``subprocess.Popen`` instance (used for exit-code diagnostics).
    """
    import socket
    import urllib.request
    import urllib.error

    deadline = time.time() + timeout
    url = f"http://127.0.0.1:{port}/api/health"
    last_error = None
    tcp_open = False

    while time.time() < deadline:
        # Did the child crash already?
        rc = proc.poll()
        if rc is not None:
            raise TimeoutError(
                f"Daemon process exited prematurely (exit code {rc}). "
                f"Check the log file for details."
            )

        # ── Phase 1: raw TCP check (fast, tells us whether uvicorn has bound) ──
        if not tcp_open:
            try:
                sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                sock.settimeout(1.0)
                result = sock.connect_ex(("127.0.0.1", port))
                sock.close()
                if result == 0:
                    tcp_open = True
                    # Fall through to phase 2 immediately
                else:
                    time.sleep(0.3)
                    continue
            except OSError as e:
                last_error = f"TCP: {type(e).__name__}({e})"
                time.sleep(0.3)
                continue

        # ── Phase 2: HTTP health-check ───────────────────────────────────
        try:
            with urllib.request.urlopen(url, timeout=1) as r:
                if r.status == 200:
                    return
                # Got a non-200 — maybe lifespan hasn't yielded yet
                last_error = f"HTTP {r.status}"
        except (urllib.error.URLError, OSError) as e:
            last_error = f"HTTP: {type(e).__name__}({e})"
        time.sleep(0.3)

    # ── 超时 ─────────────────────────────────────────────────────────────
    rc = proc.poll()
    if rc is not None:
        raise TimeoutError(
            f"Daemon process exited prematurely (exit code {rc}). "
            f"Check the log file for details."
        )
    if tcp_open:
        raise TimeoutError(
            f"TCP port {port} is open but HTTP health-check failed "
            f"within {timeout}s.  Last error: {last_error}.  "
            f"Check the log file for errors."
        )
    raise TimeoutError(
        f"Daemon did not become ready within {timeout}s "
        f"(TCP port {port} never opened, PID={proc.pid}). "
        f"Last error: {last_error}.  "
        f"Check the log file for errors."
    )


# ── Daemon 停止 ──────────────────────────────────────────────────────


def stop_daemon(name: str, timeout: float = 10.0) -> bool:
    """
    停止 daemon 进程。

    Returns True if stopped, False if was not running.
    """
    pid = read_pid(name)
    if pid is None or not is_running(name):
        remove_pid(name)
        return False

    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        remove_pid(name)
        return False

    # 等待进程退出
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            os.kill(pid, 0)
            time.sleep(0.2)
        except (OSError, ProcessLookupError):
            break
    else:
        # 超时后强制杀死
        try:
            os.kill(pid, signal.SIGKILL)
        except (OSError, ProcessLookupError):
            pass

    remove_pid(name)
    remove_state(name)
    return True


# ── 列出所有 daemon ───────────────────────────────────────────────────


def list_daemons() -> list[dict]:
    """返回所有 daemon 的状态信息（含运行状态）。"""
    if not DAEMONS_DIR.exists():
        return []

    result = []
    for state_file in DAEMONS_DIR.glob("*.json"):
        try:
            state = json.loads(state_file.read_text())
        except (json.JSONDecodeError, OSError):
            continue
        name = state.get("name", state_file.stem)
        state["alive"] = is_running(name)
        state["uptime_seconds"] = (
            time.time() - state.get("started_at", time.time())
            if state["alive"] else 0
        )
        result.append(state)

    result.sort(key=lambda d: d.get("started_at", 0))
    return result
