"""
remote.py — tui_gateway 中的远程 SSH 管理 RPC 处理器。

提供以下 JSON-RPC 方法:
  - remote.config.list    — 列出已保存的 SSH 配置
  - remote.config.save    — 保存/更新 SSH 配置
  - remote.config.delete  — 删除 SSH 配置
  - remote.test           — 测试 SSH 连接
  - remote.connect        — 连接远程服务器, 启动远程 tui_gateway, 建立隧道
  - remote.disconnect     — 断开远程连接
  - remote.status         — 获取当前连接状态
  - remote.list_dirs      — 列出远程目录
  - remote.list_files     — 列出远程文件
  - remote.exec           — 在远程执行命令

连接成功后, 通过事件 `remote.connected` 通知 TUI,
TUI 可以使用返回的 `ws_attach_url` 切换 GatewayClient 到 WebSocket attach 模式。
"""

from __future__ import annotations

import logging
import threading
from typing import Optional

from ..server import _emit, _err, _ok, method
from ..ssh_tunnel import (
    SSHTunnelManager,
    SSHConfig,
    TunnelStatus,
    delete_ssh_config,
    get_ssh_config,
    list_ssh_configs,
    save_ssh_config,
)

logger = logging.getLogger(__name__)

# ── 全局隧道管理器 (单例) ───────────────────────────────────────────
# TUI 同一时间只连接一个远程服务器
_tunnel: Optional[SSHTunnelManager] = None
_tunnel_lock = threading.Lock()


def _get_tunnel() -> Optional[SSHTunnelManager]:
    return _tunnel


def _get_or_create_tunnel() -> SSHTunnelManager:
    global _tunnel
    with _tunnel_lock:
        if _tunnel is None:
            _tunnel = SSHTunnelManager()
        return _tunnel


# ── 配置管理 ─────────────────────────────────────────────────────────


@method("remote.config.list")
def remote_config_list(rid, params: dict) -> dict:
    """列出所有已保存的 SSH 配置（脱敏）。"""
    try:
        configs = list_ssh_configs()
        return _ok(rid, {"configs": configs})
    except Exception as e:
        return _err(rid, -32000, str(e))


@method("remote.config.save")
def remote_config_save(rid, params: dict) -> dict:
    """保存或更新一条 SSH 配置。"""
    try:
        cfg = SSHConfig.from_dict(params)
        errs = cfg.validate()
        if errs:
            return _err(rid, -32000, "; ".join(errs))
        save_ssh_config(cfg)
        return _ok(rid, {"saved": True, "name": cfg.name})
    except Exception as e:
        return _err(rid, -32000, str(e))


@method("remote.config.delete")
def remote_config_delete(rid, params: dict) -> dict:
    """删除一条 SSH 配置。"""
    name = params.get("name", "")
    if not name:
        return _err(rid, -32000, "name 不能为空")
    deleted = delete_ssh_config(name)
    return _ok(rid, {"deleted": deleted, "name": name})


# ── 连接测试 ─────────────────────────────────────────────────────────


@method("remote.test")
def remote_test(rid, params: dict) -> dict:
    """测试 SSH 连接是否可用（不启动 gateway）。"""
    try:
        cfg = SSHConfig.from_dict(params)
        ok, info = SSHTunnelManager.test_connection(cfg)
        return _ok(rid, {"ok": ok, "info": info})
    except Exception as e:
        return _err(rid, -32000, str(e))


# ── 连接管理 ─────────────────────────────────────────────────────────


@method("remote.connect")
def remote_connect(rid, params: dict) -> dict:
    """连接远程服务器, 启动远程 tui_gateway, 建立端口转发。

    params:
      name: 配置名称 (使用已保存的配置)
      或直接传入 host/port/username/... 等连接参数

    返回:
      connected: bool
      ws_attach_url: str  — 本地 WebSocket attach 地址
      remote_hostname: str
      remote_port: int
      local_port: int
      remote_pid: int
    """
    global _tunnel

    try:
        # 从名称加载配置, 或直接从 params 构建
        name = params.get("name", "")
        if name:
            cfg = get_ssh_config(name)
            if cfg is None:
                return _err(rid, -32000, f"配置 '{name}' 不存在")
            # 允许 params 覆盖配置中的字段 (如 remote_workdir)
            for k, v in params.items():
                if k != "name" and hasattr(cfg, k) and v:
                    setattr(cfg, k, v)
        else:
            cfg = SSHConfig.from_dict(params)

        errs = cfg.validate()
        if errs:
            return _err(rid, -32000, "; ".join(errs))

        # 如果已有连接, 先断开
        with _tunnel_lock:
            if _tunnel is not None and _tunnel.status.connected:
                _tunnel.disconnect()

        # 创建新隧道并连接
        tunnel = _get_or_create_tunnel()
        status = tunnel.connect(cfg)

        if not status.connected:
            return _err(rid, -32000, status.error or "连接失败")

        result = {
            "connected": True,
            "ws_attach_url": status.ws_attach_url,
            "remote_hostname": status.remote_hostname,
            "remote_cwd": status.remote_cwd,
            "remote_port": status.remote_port,
            "local_port": status.local_port,
            "remote_pid": status.remote_pid,
            "remote_python_version": status.remote_python_version,
        }

        # 发送 remote.connected 事件
        _emit("remote.connected", "", result)

        return _ok(rid, result)

    except Exception as e:
        logger.exception("remote.connect failed")
        return _err(rid, -32000, str(e))


@method("remote.disconnect")
def remote_disconnect(rid, params: dict) -> dict:
    """断开远程连接。"""
    global _tunnel
    with _tunnel_lock:
        if _tunnel is not None:
            _tunnel.disconnect()
            _tunnel = None
    _emit("remote.disconnected", "", {})
    return _ok(rid, {"disconnected": True})


@method("remote.status")
def remote_status(rid, params: dict) -> dict:
    """获取当前连接状态。"""
    tunnel = _get_tunnel()
    if tunnel is None or not tunnel.status.connected:
        return _ok(rid, {"connected": False})
    s = tunnel.status
    return _ok(rid, {
        "connected": s.connected,
        "ws_attach_url": s.ws_attach_url,
        "remote_hostname": s.remote_hostname,
        "remote_cwd": s.remote_cwd,
        "remote_port": s.remote_port,
        "local_port": s.local_port,
        "remote_pid": s.remote_pid,
        "remote_python_version": s.remote_python_version,
    })


# ── 远程文件浏览 ─────────────────────────────────────────────────────


@method("remote.list_dirs")
def remote_list_dirs(rid, params: dict) -> dict:
    """列出远程目录。"""
    tunnel = _get_tunnel()
    if tunnel is None or not tunnel.status.connected:
        return _err(rid, -32000, "未连接远程服务器")
    path = params.get("path", "~")
    try:
        dirs = tunnel.list_remote_dirs(path)
        return _ok(rid, {"path": path, "directories": dirs})
    except Exception as e:
        return _err(rid, -32000, str(e))


@method("remote.list_files")
def remote_list_files(rid, params: dict) -> dict:
    """列出远程文件和子目录。"""
    tunnel = _get_tunnel()
    if tunnel is None or not tunnel.status.connected:
        return _err(rid, -32000, "未连接远程服务器")
    path = params.get("path", "~")
    try:
        entries = tunnel.list_remote_files(path)
        return _ok(rid, {"path": path, "entries": entries})
    except Exception as e:
        return _err(rid, -32000, str(e))


# ── 远程命令执行 ─────────────────────────────────────────────────────


@method("remote.exec")
def remote_exec(rid, params: dict) -> dict:
    """在远程服务器执行 shell 命令。"""
    tunnel = _get_tunnel()
    if tunnel is None or not tunnel.status.connected:
        return _err(rid, -32000, "未连接远程服务器")
    command = params.get("command", "")
    if not command:
        return _err(rid, -32000, "command 不能为空")
    try:
        timeout = float(params.get("timeout", 30))
        out, err, code = tunnel._exec_remote(command, timeout=timeout)
        return _ok(rid, {
            "stdout": out,
            "stderr": err,
            "returncode": code,
            "host": tunnel.status.remote_hostname,
        })
    except Exception as e:
        return _err(rid, -32000, str(e))
