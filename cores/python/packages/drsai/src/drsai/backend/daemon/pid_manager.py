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
    """检查 daemon 是否仍在运行（PID 文件存在且进程存活）。

    如果 PID 文件丢失，会从 state 文件中回退读取 PID 并重建 PID 文件。
    """
    pid = read_pid(name)
    if pid is None:
        # PID 文件丢失，从 state 文件回退读取
        state = read_state(name)
        if state and "pid" in state:
            pid = state["pid"]
            # 如果进程确实存活，重建 PID 文件
            if _pid_alive(pid):
                write_pid(name, pid)
            else:
                return False
        else:
            return False
    return _pid_alive(pid)


def _pid_alive(pid: int) -> bool:
    """检查指定 PID 的进程是否仍在运行（跨平台兼容）。"""
    if sys.platform == "win32":
        # Windows: os.kill(pid, 0) 不可靠 —— 对 DETACHED_PROCESS 子进程
        # 会抛出 OSError [WinError 87]（参数错误）。
        # 使用 ctypes 调用 OpenProcess 来检查进程是否存在。
        import ctypes
        kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
        if handle:
            kernel32.CloseHandle(handle)
            return True
        return False
    else:
        # POSIX: signal 0 仅检查进程存在性，不发送信号
        try:
            os.kill(pid, 0)
            return True
        except (OSError, ProcessLookupError):
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


def _cleanup_orphan_daemons(name: str) -> list[int]:
    """检测并终止同名的孤儿 daemon 子进程。

    场景：之前的 bug（如 is_running() 在 Windows 误判）导致
    PID/state 文件被删除，但 daemon 子进程仍在运行。
    启动新 daemon 前需要清理这些孤儿进程，否则会出现重复回复等问题。

    Returns:
        被终止的孤儿进程 PID 列表
    """
    orphans: list[int] = []

    if sys.platform == "win32":
        # Windows: 通过 WMI 查找 python 进程，检查命令行是否匹配
        try:
            import ctypes
            import subprocess
            result = subprocess.run(
                [
                    "wmic", "process", "where",
                    "Name='python.exe'", "get",
                    "ProcessId,CommandLine", "/format:csv",
                ],
                capture_output=True, text=True, timeout=5,
            )
            for line in result.stdout.strip().splitlines():
                line = line.strip()
                if not line or line.startswith("Node"):
                    continue
                parts = line.split(",")
                # CSV 格式: Node,CommandLine,ProcessId
                if len(parts) >= 3:
                    cmdline = parts[-2]
                    pid_str = parts[-1].strip()
                    # 匹配 python -m drsai.backend.daemon 且环境变量中 DRSAI_DAEMON_NAME=name
                    # wmic 无法读取环境变量，通过端口监听判断
                    if "drsai.backend.daemon" in cmdline and pid_str.isdigit():
                        pid = int(pid_str)
                        # 排除当前 PID 文件中的进程（is_running 已正确识别的）
                        current_pid = read_pid(name)
                        if pid != current_pid and _pid_alive(pid):
                            orphans.append(pid)
        except Exception:
            pass
    else:
        # POSIX: 通过 /proc 查找
        try:
            for proc_dir in Path("/proc").glob("[0-9]*"):
                pid = int(proc_dir.name)
                try:
                    cmdline = (proc_dir / "cmdline").read_text("\0")
                    if "drsai.backend.daemon" in cmdline:
                        current_pid = read_pid(name)
                        if pid != current_pid and _pid_alive(pid):
                            # 检查环境变量中的 DAEMON_NAME
                            try:
                                environ = (proc_dir / "environ").read_text("\0")
                                if f"DRSAI_DAEMON_NAME={name}" in environ:
                                    orphans.append(pid)
                            except (OSError, ValueError):
                                orphans.append(pid)
                except (OSError, ValueError):
                    continue
        except Exception:
            pass

    # 终止孤儿进程
    for pid in orphans:
        try:
            os.kill(pid, signal.SIGTERM if sys.platform != "win32" else signal.SIGTERM)
            logger.warning("Killed orphan daemon process: PID=%d (name=%s)", pid, name)
        except (OSError, ProcessLookupError):
            pass

    return orphans


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

    # 清理孤儿 daemon 进程：同名的 daemon 子进程可能仍在运行，
    # 但 PID/state 文件已丢失（例如之前的 is_running() bug 导致误删）。
    _cleanup_orphan_daemons(name)

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
        # On Windows **all three** std handles must be provided when ANY
        # one is given, otherwise STARTF_USESTDHANDLES causes CreateProcess
        # to fail spuriously with ERROR_FILE_NOT_FOUND.
        proc = subprocess.Popen(
            [sys.executable, "-m", "drsai.backend.daemon"],
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
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

    # Windows: os.kill(pid, signal.SIGTERM) 映射为 TerminateProcess
    # Linux: SIGTERM 正常发送终止信号
    try:
        os.kill(pid, signal.SIGTERM)
    except (OSError, ProcessLookupError):
        # 进程可能在 is_running() 和 os.kill() 之间退出
        remove_pid(name)
        remove_state(name)
        return False

    # 等待进程退出
    deadline = time.time() + timeout
    while time.time() < deadline:
        if not _pid_alive(pid):
            break
        time.sleep(0.2)
    else:
        # 超时后强制杀死
        try:
            if sys.platform == "win32":
                # Windows 没有 SIGKILL，使用 SIGTERM 再次发送 (等同于 TerminateProcess)
                os.kill(pid, signal.SIGTERM)
            else:
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
