"""
remote.py — tui_gateway 中的远程 SSH 管理 RPC 处理器。

提供以下 JSON-RPC 方法:
  - remote.config.list    — 列出已保存的 SSH 配置
  - remote.config.save    — 保存/更新 SSH 配置
  - remote.config.delete  — 删除 SSH 配置
  - remote.test           — 测试 SSH 连接
  - remote.connect        — 连接远程服务器, 启动远程 tui_gateway, 建立隧道
  - remote.disconnect     — 断开远程连接
  - remote.cleanup        — 清理远程所有残留 gateway 进程和文件
  - remote.status         — 获取当前连接状态
  - remote.list_dirs      — 列出远程目录 (需已连接)
  - remote.list_files     — 列出远程文件 (需已连接)
  - remote.exec           — 在远程执行命令 (需已连接)
  - remote.browse_dirs    — 临时 SSH 连接浏览远程目录 (无需已连接)

连接成功后, 通过事件 `remote.connected` 通知 TUI,
TUI 可以使用返回的 `ws_attach_url` 切换 GatewayClient 到 WebSocket attach 模式。
"""

from __future__ import annotations

import logging
import threading
from typing import Optional

import os

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
    """测试 SSH 连接是否可用（不启动 gateway）。

    params:
      name: 配置名称 (从已保存配置加载)
      或直接传入 host/port/username/... 等连接参数
    """
    try:
        # 从名称加载配置, 或直接从 params 构建
        name = params.get("name", "")
        if name:
            cfg = get_ssh_config(name)
            if cfg is None:
                return _err(rid, -32000, f"配置 '{name}' 不存在")
            # 允许 params 覆盖配置中的字段
            for k, v in params.items():
                if k != "name" and hasattr(cfg, k) and v:
                    setattr(cfg, k, v)
        else:
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


@method("remote.cleanup")
def remote_cleanup(rid, params: dict) -> dict:
    """清理远程所有残留 gateway 进程和文件。

    可在已连接或未连接状态下调用。如果当前有活跃连接, 使用该连接
    执行清理; 否则尝试通过 params 中的 SSH 配置建立临时连接执行清理。
    """
    global _tunnel
    with _tunnel_lock:
        if _tunnel is not None and _tunnel.status.connected:
            result = _tunnel.cleanup_stale()
            return _ok(rid, result)

    # 没有活跃连接 — 尝试临时连接
    name = params.get("name", "")
    cfg = None
    if name:
        cfg = get_ssh_config(name)
    elif params.get("host"):
        cfg = SSHConfig.from_dict(params)

    if cfg is None:
        return _err(rid, -32000, "无活跃连接且未提供 SSH 配置, 无法清理")

    # 建立临时连接执行清理
    temp_tunnel = SSHTunnelManager()
    try:
        temp_tunnel.connect(cfg)
        if not temp_tunnel.status.connected:
            return _err(rid, -32000, f"临时连接失败: {temp_tunnel.status.error}")
        result = temp_tunnel.cleanup_stale()
        temp_tunnel.disconnect()
        return _ok(rid, result)
    except Exception as e:
        logger.exception("remote.cleanup failed")
        return _err(rid, -32000, str(e))


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


# ── 配置阶段目录浏览 (无需已连接) ────────────────────────────────────


@method("remote.browse_dirs")
def remote_browse_dirs(rid, params: dict) -> dict:
    """临时建立 SSH 连接来浏览远程目录，无需已连接远程 gateway。

    用于编辑 SSH 配置时选择 remote_workdir。
    接受完整配置参数或已保存的配置名。

    params:
      name: 配置名称 (可选, 用于加载已保存的配置)
      或直接传入 host/port/username/password/private_key_path 等
      path: 要浏览的远程目录路径 (默认 "~")

    返回:
      entries: [{name, path, is_dir, size}, ...]
    """
    try:
        from ..ssh_tunnel import SSHConfig, SSHTunnelManager, _HAS_PARAMIKO

        if not _HAS_PARAMIKO:
            return _err(rid, -32000, "paramiko 未安装")

        # 构建配置: 优先从 name 加载, 然后用 params 覆盖
        name = params.get("name", "")
        if name:
            cfg = get_ssh_config(name)
            if cfg is None:
                return _err(rid, -32000, f"配置 '{name}' 不存在")
            # 用 params 中的字段覆盖 (除了 name/path)
            for k, v in params.items():
                if k not in ("name", "path") and hasattr(cfg, k) and v:
                    setattr(cfg, k, v)
        else:
            cfg = SSHConfig.from_dict(params)

        # 浏览只需连接字段；编辑中的配置尚未保存、没有 name，
        # 因此不能用完整的 cfg.validate()（它强制要求 name）。
        errs = [e for e in cfg.validate() if e != "name 不能为空"]
        if errs:
            return _err(rid, -32000, "; ".join(errs))

        path = params.get("path", "~")

        # 临时建立 SSH 连接 (不启动 gateway, 不建立隧道)
        import paramiko

        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

        connect_kwargs: dict = {
            "hostname": cfg.host,
            "port": cfg.port,
            "username": cfg.username,
            "timeout": 10,
        }
        key_path = os.path.expanduser(cfg.private_key_path) if cfg.private_key_path else ""
        if key_path and os.path.exists(key_path):
            connect_kwargs["key_filename"] = key_path
        elif cfg.password:
            connect_kwargs["password"] = cfg.password
        else:
            connect_kwargs["allow_agent"] = True
            connect_kwargs["look_for_keys"] = True

        try:
            client.connect(**connect_kwargs)
        except Exception as e:
            return _err(rid, -32000, f"SSH 连接失败: {e}")

        try:
            # 使用 SFTP 列出目录
            sftp = client.open_sftp()
            try:
                # 展开 ~ 为用户主目录
                if path.startswith("~"):
                    stdin, stdout, stderr = client.exec_command("echo $HOME")
                    home = stdout.read().decode().strip()
                    path = path.replace("~", home, 1)

                entries = []
                for attr in sftp.listdir_attr(path):
                    import stat as stat_module
                    is_dir = stat_module.S_ISDIR(attr.st_mode) if attr.st_mode else False
                    entries.append({
                        "name": attr.filename,
                        "path": path.rstrip("/") + "/" + attr.filename,
                        "is_dir": is_dir,
                        "size": str(attr.st_size) if attr.st_size else "",
                    })
                # 目录排在前面
                entries.sort(key=lambda e: (not e["is_dir"], e["name"].lower()))
                return _ok(rid, {"path": path, "entries": entries})
            finally:
                sftp.close()
        finally:
            client.close()

    except Exception as e:
        logger.exception("remote.browse_dirs failed")
        return _err(rid, -32000, str(e))
