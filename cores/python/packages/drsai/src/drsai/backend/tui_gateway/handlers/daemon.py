"""
daemon.py — tui_gateway 中的 daemon 管理 RPC 处理器

通过读取状态文件 / HTTP 调用 daemon 管理 API，将结果转换为 RPC 响应返回给 TUI。
"""

from __future__ import annotations

import json
import logging
import threading
import urllib.error
import urllib.request

from ..server import _err, _ok, method

logger = logging.getLogger(__name__)


# ── HTTP helper ───────────────────────────────────────────────────────────────


def _daemon_http(name: str, path: str, method_: str = "GET", body: dict | None = None):
    """向 daemon 管理 API 发起 HTTP 请求。"""
    from drsai.backend.daemon.pid_manager import read_state
    state = read_state(name)
    if not state:
        raise RuntimeError(f"Daemon '{name}' state not found")

    url = f"http://127.0.0.1:{state['ws_port']}{path}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(
        url,
        data=data,
        method=method_,
        headers={"Content-Type": "application/json"} if data else {},
    )
    with urllib.request.urlopen(req, timeout=5) as r:
        return json.loads(r.read())


# ── RPC 方法 ──────────────────────────────────────────────────────────────────


@method("daemon.list")
def daemon_list(rid, params: dict) -> dict:
    """列出所有 daemon 信息。"""
    from drsai.backend.daemon.pid_manager import list_daemons
    try:
        daemons = list_daemons()
        for d in daemons:
            if d.get("alive"):
                try:
                    info = _daemon_http(d["name"], "/api/info")
                    d["session_count"] = info.get("session_count", 0)
                    d["uptime_seconds"] = info.get("uptime_seconds", d.get("uptime_seconds", 0))
                except Exception:
                    pass
        return _ok(rid, {"daemons": daemons})
    except Exception as e:
        return _err(rid, -32000, str(e))


@method("daemon.start")
def daemon_start(rid, params: dict) -> dict:
    """启动 daemon。"""
    from drsai.backend.daemon.pid_manager import start_daemon
    try:
        name = params.get("name", "default")
        state = start_daemon(
            name=name,
            ws_port=params.get("port"),
            wechat_port=params.get("wechat_port"),
            wechat_enabled=bool(params.get("wechat", False)),
        )
        return _ok(rid, state)
    except Exception as e:
        return _err(rid, -32000, str(e))


@method("daemon.stop")
def daemon_stop(rid, params: dict) -> dict:
    """停止 daemon。"""
    from drsai.backend.daemon.pid_manager import stop_daemon
    name = params.get("name", "default")
    try:
        stopped = stop_daemon(name)
        return _ok(rid, {"stopped": stopped, "name": name})
    except Exception as e:
        return _err(rid, -32000, str(e))


@method("daemon.logs")
def daemon_logs(rid, params: dict) -> dict:
    """读取 daemon 日志尾部。"""
    from drsai.backend.daemon.pid_manager import _log_file
    name = params.get("name", "default")
    tail = int(params.get("tail", 50))
    log_path = _log_file(name)
    if not log_path.exists():
        return _err(rid, -32000, f"Log file not found: {log_path}")
    try:
        lines = log_path.read_text(errors="replace").splitlines()
        return _ok(rid, {"lines": lines[-tail:], "log_file": str(log_path)})
    except Exception as e:
        return _err(rid, -32000, str(e))


@method("daemon.status")
def daemon_status_rpc(rid, params: dict) -> dict:
    """获取单个 daemon 状态详情。"""
    from drsai.backend.daemon.pid_manager import read_state, is_running
    name = params.get("name", "default")
    state = read_state(name)
    if not state:
        return _err(rid, -32000, f"Daemon '{name}' not found")
    state["alive"] = is_running(name)
    if state["alive"]:
        try:
            info = _daemon_http(name, "/api/info")
            state.update(info)
        except Exception:
            pass
    return _ok(rid, state)


@method("subagent.invoke")
def subagent_invoke(rid, params: dict) -> dict:
    """向 daemon 提交子任务（非阻塞，通过事件回调通知结果）。"""
    import uuid
    from ..server import _emit

    daemon_name = params.get("daemon_name", "default")
    message = params.get("message", "")
    caller_session = params.get("caller_session_id", "")
    task_id = uuid.uuid4().hex[:8]

    def _run():
        try:
            from drsai.backend.daemon.pid_manager import read_state
            import websocket
            import json as _json

            state = read_state(daemon_name)
            if not state:
                _emit("subagent.complete", caller_session, {
                    "task_id": task_id,
                    "source": daemon_name,
                    "error": f"Daemon '{daemon_name}' not found",
                })
                return

            url = f"ws://127.0.0.1:{state['ws_port']}/ws?token={state['api_token']}"
            ws = websocket.create_connection(url, timeout=30)
            ws.recv()  # gateway.ready

            ws.send(_json.dumps({
                "jsonrpc": "2.0", "id": "sa1",
                "method": "session.create",
                "params": {"name": f"subagent-{task_id}"}
            }))
            resp = _json.loads(ws.recv())
            sid = (resp.get("result") or {}).get("session_id", "")

            _emit("subagent.start", caller_session, {
                "task_id": task_id,
                "source": daemon_name,
                "goal": message[:100],
            })

            ws.send(_json.dumps({
                "jsonrpc": "2.0", "id": "sa2",
                "method": "prompt.submit",
                "params": {"session_id": sid, "text": message}
            }))

            result_text = ""
            while True:
                try:
                    frame = _json.loads(ws.recv())
                except Exception:
                    break
                p = (frame.get("params") or {})
                et = p.get("type", "")
                pl = p.get("payload") or {}
                if et == "message.delta":
                    chunk = pl.get("text", "")
                    result_text += chunk
                    _emit("subagent.thinking", caller_session, {
                        "source": daemon_name,
                        "text": chunk,
                    })
                elif et == "message.complete":
                    break
                elif et == "error":
                    result_text = pl.get("message", "Error")
                    break

            _emit("subagent.complete", caller_session, {
                "task_id": task_id,
                "source": daemon_name,
                "text": result_text,
                "session_id": sid,
            })
            ws.close()

        except Exception as exc:
            logger.exception("subagent.invoke failed")
            _emit("subagent.complete", caller_session, {
                "task_id": task_id,
                "source": daemon_name,
                "error": str(exc),
            })

    threading.Thread(target=_run, name=f"subagent-{task_id}", daemon=True).start()
    return _ok(rid, {"task_id": task_id, "status": "submitted", "daemon_name": daemon_name})
