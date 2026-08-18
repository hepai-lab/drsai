"""SSH 隧道管理器 — 通过 SSH 启动远程 tui_gateway 并建立端口转发。

架构:
  本地 TUI                         远程服务器
  ┌──────────────┐    SSH tunnel  ┌──────────────────────────┐
  │ GatewayClient│◄───────────────│ tui_gateway (WS mode)    │
  │ (ws attach)  │  port forward  │ ws://127.0.0.1:{port}    │
  └──────────────┘                └──────────────────────────┘

流程:
  1. paramiko SSH 连接远程服务器
  2. 设置远程环境变量, nohup 启动 `python -m drsai.backend.tui_gateway`
     (带 DRSAI_TUI_ENABLE_WS=1, DRSAI_TUI_WS_PORT=port)
  3. paramiko transport.open_channel("direct-tcpip") 建立端口转发
  4. 本地 GatewayClient 通过 ws://127.0.0.1:{local_port}/attach 连接
  5. 断开时自动清理远程进程
"""

from __future__ import annotations

import base64
import logging
import os
import posixpath
import socket
import threading
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

try:
    import paramiko
    _HAS_PARAMIKO = True
except ImportError:
    _HAS_PARAMIKO = False
    paramiko = None  # type: ignore

# ── 远程路径常量 ─────────────────────────────────────────────────────

REMOTE_TMP_DIR = "/tmp/drsai_ssh_tui"


def _remote_log_path(port: int) -> str:
    """Port 级唯一的远程日志文件路径。"""
    return f"{REMOTE_TMP_DIR}/gateway_{port}.log"


def _remote_pid_file(port: int) -> str:
    """Port 级唯一的远程 PID 文件路径。"""
    return f"{REMOTE_TMP_DIR}/gateway_{port}.pid"


# ── 数据结构 ─────────────────────────────────────────────────────────


@dataclass
class SSHConfig:
    """一条 SSH 远程连接配置。

    远程服务器上只需能通过命令行执行 `opendrsai` (由 install_drsai.sh/ps1
    安装并加入 PATH)。后端通过 `command -v opendrsai` 定位启动器,
    查不到时兜底 `~/.drsai/bin/opendrsai`。
    """
    name: str = ""
    host: str = ""
    port: int = 22
    username: str = ""
    password: str = ""
    private_key_path: str = ""
    remote_gateway_port: int = 0           # 0 = 自动选择
    remote_workdir: str = ""               # 远程工作目录

    def validate(self) -> list[str]:
        errs: list[str] = []
        if not self.name: errs.append("name 不能为空")
        if not self.host: errs.append("host 不能为空")
        if not self.username: errs.append("username 不能为空")
        if not self.password and not self.private_key_path:
            errs.append("必须提供 password 或 private_key_path")
        return errs

    def masked(self) -> dict:
        d = asdict(self)
        if d.get("password"): d["password"] = "***"
        return d

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "SSHConfig":
        return cls(**{k: v for k, v in d.items() if k in cls.__dataclass_fields__})


@dataclass
class TunnelStatus:
    """隧道状态。"""
    connected: bool = False
    local_port: int = 0
    remote_port: int = 0
    remote_hostname: str = ""
    remote_cwd: str = ""
    remote_pid: int = 0
    remote_python_version: str = ""
    ws_attach_url: str = ""
    error: str = ""


# ── SSH 隧道管理器 ───────────────────────────────────────────────────

class SSHTunnelManager:
    """管理 SSH 连接 + 远程 tui_gateway 启动 + 端口转发。"""

    def __init__(self):
        if not _HAS_PARAMIKO:
            raise RuntimeError(
                "paramiko 未安装。请运行: pip install paramiko"
            )
        self._client: Optional[paramiko.SSHClient] = None
        self._transport: Optional[paramiko.Transport] = None
        self._tunnel_thread: Optional[threading.Thread] = None
        self._tunnel_stop = threading.Event()
        self._local_socket: Optional[socket.socket] = None
        self._forward_threads: list[threading.Thread] = []
        self._opendrsai: str = ""          # 远程 opendrsai 可执行文件 (connect 时解析)
        self.status = TunnelStatus()

    # ── 连接 ────────────────────────────────────────────────────────

    def connect(self, cfg: SSHConfig, local_port: int = 0) -> TunnelStatus:
        """建立 SSH 连接，启动远程 tui_gateway，建立端口转发。

        Args:
            cfg: SSH 连接配置
            local_port: 本地绑定端口，0 表示自动选择

        Returns:
            TunnelStatus
        """
        try:
            self._client = paramiko.SSHClient()
            self._client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

            connect_kwargs: dict = {
                "hostname": cfg.host,
                "port": cfg.port,
                "username": cfg.username,
                "timeout": 15,
            }
            key_path = os.path.expanduser(cfg.private_key_path) if cfg.private_key_path else ""
            if key_path and os.path.exists(key_path):
                connect_kwargs["key_filename"] = key_path
                logger.info("SSH 使用私钥: %s", key_path)
            elif cfg.password:
                connect_kwargs["password"] = cfg.password
                logger.info("SSH 使用密码认证")
            else:
                connect_kwargs["allow_agent"] = True
                connect_kwargs["look_for_keys"] = True

            logger.info("SSH 连接 %s@%s:%s ...", cfg.username, cfg.host, cfg.port)
            try:
                self._client.connect(**connect_kwargs)
            except Exception as e:
                raise RuntimeError(
                    f"SSH 连接失败 (host={cfg.host}, port={cfg.port}, user={cfg.username}): {e}"
                ) from e
            self._transport = self._client.get_transport()

            # 启用 SSH Transport keepalive，防止 NAT/防火墙静默断开空闲连接。
            # 每 30 秒发送一个 SSH keepalive 包；如果连续 3 次未收到响应，
            # paramiko 会抛出 EOFError，我们可以据此检测断链。
            if self._transport is not None:
                self._transport.set_keepalive(30)
                logger.info("SSH keepalive 已启用 (间隔 30s)")

            logger.info("SSH 连接成功")

            # 获取远程主机信息
            try:
                self.status.remote_hostname = self._exec_remote("hostname")[0].strip()
                self.status.remote_cwd = self._exec_remote("pwd")[0].strip()
            except Exception as e:
                raise RuntimeError(f"远程命令执行失败 (hostname/pwd): {e}") from e

            # 定位远程 opendrsai 可执行文件 (PATH → 默认安装目录)
            self._opendrsai = self._resolve_opendrsai()
            logger.info("远程 opendrsai: %s", self._opendrsai)

            try:
                py_ver_out, _, _ = self._exec_remote(f"{self._opendrsai} --version 2>&1 || true", timeout=30)
            except Exception as e:
                raise RuntimeError(f"远程 opendrsai --version 执行超时或失败: {e}") from e
            self.status.remote_python_version = py_ver_out.strip().splitlines()[0] if py_ver_out.strip() else ""

            # 选择远程 gateway 端口
            remote_port = cfg.remote_gateway_port or self._find_free_remote_port(cfg)
            self.status.remote_port = remote_port

            # 启动远程 tui_gateway
            self._start_remote_gateway(cfg, remote_port)
            logger.info("远程 tui_gateway 已启动 (PID=%s, port=%s)",
                        self.status.remote_pid, remote_port)

            # 建立端口转发
            self._start_tunnel(local_port, remote_port)
            self.status.ws_attach_url = f"ws://127.0.0.1:{self.status.local_port}/attach"
            logger.info("端口转发: 127.0.0.1:%s → %s:%s",
                        self.status.local_port, cfg.host, remote_port)

            self.status.connected = True
            return self.status

        except Exception as e:
            self.status.error = str(e) or repr(e)
            self.status.connected = False
            logger.exception("SSH 隧道连接失败")
            # 连接失败时清理: 杀掉已启动的远程 gateway 进程, 关闭 SSH 连接
            self._cleanup_on_failure()
            return self.status

    # ── 远程操作 ────────────────────────────────────────────────────

    def _resolve_opendrsai(self) -> str:
        """定位远程 `opendrsai` 可执行文件。

        解析顺序:
          1. `command -v opendrsai` — 远程 PATH 中查找 (install_drsai.sh
             会把安装目录的 bin/ 写入 ~/.bashrc 等, ssh 非交互式 shell
             在多数发行版上也会 source ~/.bashrc, 因此通常能命中)
          2. 兜底: 默认安装目录 `~/.drsai/bin/opendrsai` — 检查文件存在

        Returns:
            可直接在远程 shell 中执行的命令字符串
            (PATH 命中时为 'opendrsai', 否则为完整路径)

        Raises:
            RuntimeError: 两种方式都找不到 opendrsai
        """
        out, _, _ = self._exec_remote("command -v opendrsai 2>/dev/null || true")
        launcher = out.strip().splitlines()[0].strip() if out.strip() else ""
        if launcher:
            return launcher

        fallback = "~/.drsai/bin/opendrsai"
        out, _, _ = self._exec_remote(f"test -x {fallback} && echo FOUND || true")
        if "FOUND" in out:
            return fallback

        raise RuntimeError(
            "远程服务器上找不到 opendrsai 可执行文件 (PATH 和 ~/.drsai/bin/ 均未命中)。\n"
            "请先在远程服务器上运行 scripts/install_drsai.sh 完成安装。"
        )

    def _exec_remote(self, cmd: str, timeout: float = 15) -> tuple[str, str, int]:
        """执行远程命令，返回 (stdout, stderr, returncode)。

        Raises:
            TimeoutError: 远程命令在 *timeout* 秒内未完成，错误信息中
                包含被截断的命令文本以便定位超时来源。
        """
        assert self._client is not None
        stdin, stdout, stderr = self._client.exec_command(cmd, timeout=timeout)
        try:
            out = stdout.read().decode("utf-8", errors="replace")
            err = stderr.read().decode("utf-8", errors="replace")
            code = stdout.channel.recv_exit_status()
        except (socket.timeout, TimeoutError) as exc:
            # socket.timeout 是 TimeoutError 的别名 (Python 3.10+)；
            # 无参数时 str() 为空，补充命令上下文方便排查。
            preview = cmd.strip().replace("\n", " ")[:120]
            raise TimeoutError(
                f"远程命令执行超时 ({timeout}s): {preview}"
            ) from exc
        return out, err, code

    def _find_free_remote_port(self, cfg: SSHConfig) -> int:
        """在远程找一个可用端口 (通过远程 python, 由安装环境自带)。"""
        # 安装环境自带便携 Python, venv 路径固定在安装目录内;
        # 但此处不依赖具体路径 — 优先用 PATH 中的 python3。
        out, _, code = self._exec_remote(
            "python3 -c \"import socket; s=socket.socket(); s.bind(('127.0.0.1',0)); "
            "print(s.getsockname()[1]); s.close()\" 2>/dev/null || true"
        )
        if code == 0:
            try:
                return int(out.strip().splitlines()[-1])
            except (ValueError, IndexError):
                pass
        return 8765  # fallback

    def _start_remote_gateway(self, cfg: SSHConfig, remote_port: int) -> None:
        """在远程启动 tui_gateway 进程（nohup 后台运行, WebSocket 模式）。"""
        log_path = _remote_log_path(remote_port)
        pid_file = _remote_pid_file(remote_port)

        # 连接前清理: 杀掉同 port 上的残留 gateway 进程 + 清理旧 PID 文件
        # 使用 [t]ui.gateway pattern 避免匹配到 pkill 自身的命令行
        self._exec_remote(
            f"pkill -f '[t]ui.gateway.*{remote_port}' 2>/dev/null; "
            f"sleep 0.2; "
            f"rm -f {pid_file} 2>/dev/null; "
            f"true"
        )
        self._exec_remote(f"mkdir -p {REMOTE_TMP_DIR}")

        # 构建环境变量
        env_updates: dict[str, str] = {
            "DRSAI_TUI_ENABLE_WS": "1",
            "DRSAI_TUI_WS_PORT": str(remote_port),
        }
        if cfg.remote_workdir:
            env_updates["DRSAI_USER_CWD"] = cfg.remote_workdir
        # Propagate local user_id to remote gateway so session DB queries
        # match the same user's sessions (remote machine's cli_config
        # may have a different user_id).
        local_user_id = os.environ.get("DRSAI_USER_ID", "")
        if not local_user_id:
            try:
                from drsai.backend.cli import config as cli_config
                local_user_id = cli_config.load_config().get("user_id") or ""
            except Exception:
                pass
        if local_user_id:
            env_updates["DRSAI_USER_ID"] = local_user_id

        # 启动远程 gateway — 使用 Python subprocess.Popen 替代 shell nohup。
        #
        # 根本原因: `nohup cmd </dev/null >log 2>&1 &` 虽然重定向了 fd 0/1/2,
        # 但子进程仍会继承 SSH channel 的更高编号 fd (如 socket fd)。
        # paramiko 的 stdout.read() 等待 channel EOF, 而后台进程持有这些 fd
        # 导致 channel 无法关闭 → 30s 超时。
        #
        # 修复: subprocess.Popen(close_fds=True) 关闭所有 fd > 2,
        # start_new_session=True 等价于 setsid (创建新会话)。
        # launcher 脚本启动 gateway 后立即退出, channel 正常关闭。
        #
        # 使用 base64 编码 launcher 源码, 避免 shell 引号转义问题。
        launcher_code = (
            "import subprocess, os, sys\n"
            "env = os.environ.copy()\n"
            f"env.update({env_updates!r})\n"
            f"log = open({log_path!r}, 'w')\n"
            # expanduser: subprocess.Popen 不做 shell 展开, 需手动展开 ~
            f"exe = os.path.expanduser({self._opendrsai!r})\n"
            "p = subprocess.Popen(\n"
            "    [exe, 'tui-gateway'],\n"
            "    env=env,"
            + (f" cwd=os.path.expanduser({cfg.remote_workdir!r}),\n" if cfg.remote_workdir else "\n")
            + "    stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,\n"
            "    close_fds=True, start_new_session=True,\n"
            ")\n"
            f"open({pid_file!r}, 'w').write(str(p.pid))\n"
            "print(p.pid)\n"
            "sys.stdout.flush()\n"
        )
        encoded = base64.b64encode(launcher_code.encode()).decode()
        start_cmd = (
            f"python3 -c \"import base64;exec(base64.b64decode('{encoded}'))\""
        )
        stdout, stderr, code = self._exec_remote(start_cmd, timeout=15)
        if code != 0:
            raise RuntimeError(f"远程启动命令失败 (code={code}): {stderr or stdout}")

        pid_str = stdout.strip().split("\n")[-1].strip()
        try:
            self.status.remote_pid = int(pid_str)
        except ValueError:
            log = self._read_remote_log(remote_port)
            raise RuntimeError(f"无法获取远程 PID (got '{pid_str}')。日志:\n{log}")

        # 等待端口就绪 — 直接通过 SSH transport 尝试建立 direct-tcpip
        # channel 来探测远程端口, 不依赖 ss/netstat 命令 (跨平台、
        # 无需额外远程命令执行, 避免 channel 拥塞导致的超时)。
        #
        # 修复: 仅 open_channel + close 可能产生假阳性 — SSH channel
        # 创建成功不代表远程 TCP 端口有进程监听。  改为发送一个 HTTP
        # upgrade 请求并读取响应, 确认远端确实有 WebSocket 服务器在监听。
        ready = False
        for i in range(30):  # 30 × 0.3s = 9s
            time.sleep(0.3)
            try:
                chan = self._transport.open_channel(
                    "direct-tcpip",
                    ("127.0.0.1", remote_port),
                    ("127.0.0.1", 22),
                )
                # 发送 HTTP 升级请求, 验证远端确实有 WS 服务器在监听。
                # 如果端口无人监听, SSH 服务端会返回 channel EOF 或
                # 连接拒绝异常, recv() 会抛错或返回空。
                chan.send(
                    b"GET /attach HTTP/1.1\r\n"
                    b"Host: 127.0.0.1\r\n"
                    b"Upgrade: websocket\r\n"
                    b"Connection: Upgrade\r\n"
                    b"\r\n"
                )
                # 等待响应 (最多 1s)
                chan.settimeout(1.0)
                data = chan.recv(1024)
                chan.close()
                if data:
                    # 收到任何响应都说明端口有进程在监听
                    ready = True
                    break
                else:
                    # 空响应 = 端口已关闭
                    chan.close()
            except Exception:
                pass  # 端口未就绪或连接被拒, 继续等待

            # 检查进程是否还活着 (第 5 次和第 15 次各检查一次)
            if i == 5 or i == 15:
                alive_out, _, _ = self._exec_remote(
                    f"kill -0 {self.status.remote_pid} 2>&1 && echo ALIVE || echo DEAD"
                )
                if "DEAD" in alive_out:
                    log = self._read_remote_log(remote_port)
                    raise RuntimeError(
                        f"远程 tui_gateway 进程已退出 (PID={self.status.remote_pid})。日志:\n{log}"
                    )

        if not ready:
            log = self._read_remote_log(remote_port)
            raise RuntimeError(
                f"远程 tui_gateway 端口 {remote_port} 未就绪 (等待 9s)。日志:\n{log}"
            )

        # 端口探测通过后, 再等待 1s 并检查进程是否仍然存活。
        # 这可以捕获 "进程绑定端口后立即崩溃" 的情况 (例如依赖缺失、
        # 配置错误等导致 uvicorn 启动后马上退出)。
        time.sleep(1.0)
        alive_out, _, _ = self._exec_remote(
            f"kill -0 {self.status.remote_pid} 2>&1 && echo ALIVE || echo DEAD"
        )
        if "DEAD" in alive_out:
            log = self._read_remote_log(remote_port)
            raise RuntimeError(
                f"远程 tui_gateway 进程在启动后立即退出 (PID={self.status.remote_pid})。日志:\n{log}"
            )

    def _read_remote_log(self, port: int = 0) -> str:
        """读取远程 gateway 日志。"""
        log_path = _remote_log_path(port) if port else f"{REMOTE_TMP_DIR}/gateway_*.log"
        try:
            out, _, _ = self._exec_remote(f"cat {log_path} 2>&1")
            return out
        except Exception:
            return "(无法读取日志)"

    # ── 端口转发 ────────────────────────────────────────────────────

    def _find_free_local_port(self) -> int:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(("127.0.0.1", 0))
            return s.getsockname()[1]

    def _start_tunnel(self, local_port: int, remote_port: int) -> None:
        """建立 SSH 端口转发: local_port → remote:remote_port。"""
        assert self._transport is not None

        if local_port == 0:
            local_port = self._find_free_local_port()

        self.status.local_port = local_port

        self._local_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._local_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self._local_socket.bind(("127.0.0.1", local_port))
        self._local_socket.listen(5)
        self._local_socket.settimeout(1.0)

        def tunnel_worker():
            while not self._tunnel_stop.is_set():
                try:
                    client_sock, _ = self._local_socket.accept()
                except socket.timeout:
                    continue
                except OSError:
                    break

                try:
                    dest_addr = ("127.0.0.1", remote_port)
                    chan = self._transport.open_channel(
                        "direct-tcpip", dest_addr, client_sock.getpeername()
                    )
                except Exception as e:
                    logger.warning("tunnel: 创建 channel 失败: %s", e)
                    client_sock.close()
                    continue

                t = threading.Thread(
                    target=self._forward_pair,
                    args=(client_sock, chan),
                    daemon=True,
                )
                t.start()
                self._forward_threads.append(t)

        self._tunnel_stop.clear()
        self._tunnel_thread = threading.Thread(target=tunnel_worker, daemon=True,
                                               name="ssh-tunnel")
        self._tunnel_thread.start()

    def _forward_pair(self, client_sock: socket.socket, chan) -> None:
        """双向转发: client_sock ↔ SSH channel。

        socket.socket 和 paramiko.Channel 都有 recv()/sendall()/close() 接口，
        所以可以直接对称转发。当任一端关闭/出错时，关闭另一端。
        """
        def _forward(src, dst):
            try:
                while not self._tunnel_stop.is_set():
                    data = src.recv(65536)
                    if not data:
                        break
                    dst.sendall(data)
            except Exception:
                pass
            finally:
                try: src.close()
                except Exception: pass
                try: dst.close()
                except Exception: pass

        t1 = threading.Thread(target=_forward, args=(client_sock, chan), daemon=True)
        t2 = threading.Thread(target=_forward, args=(chan, client_sock), daemon=True)
        t1.start(); t2.start(); t1.join(); t2.join()

    # ── 远程目录浏览 ────────────────────────────────────────────────

    def list_remote_dirs(self, path: str = "~") -> list[dict]:
        """列出远程目录。"""
        out, err, code = self._exec_remote(
            f'ls -d {path}/*/ 2>/dev/null | head -50'
        )
        if code != 0:
            return []
        dirs = []
        for line in out.strip().split("\n"):
            line = line.strip().rstrip("/")
            if line:
                dirs.append({"name": posixpath.basename(line), "path": line, "is_dir": True})
        return dirs

    def list_remote_files(self, path: str = "~") -> list[dict]:
        """列出远程目录中的文件和子目录。"""
        out, _, code = self._exec_remote(
            f'ls -la {path} 2>/dev/null | tail -n +2'
        )
        if code != 0:
            return []
        entries = []
        for line in out.strip().split("\n"):
            parts = line.split()
            if len(parts) >= 9:
                is_dir = parts[0].startswith("d")
                name = " ".join(parts[8:])
                if name in (".", ".."):
                    continue
                entries.append({
                    "name": name,
                    "path": posixpath.join(path, name),
                    "is_dir": is_dir,
                    "size": parts[4] if not is_dir else "",
                })
        return entries

    # ── 断开 ────────────────────────────────────────────────────────

    def _cleanup_on_failure(self) -> None:
        """连接失败时清理: 杀远程 gateway 进程 + 关闭 SSH 连接。"""
        if self._client and self.status.remote_pid:
            try:
                remote_port = self.status.remote_port
                pid_file = _remote_pid_file(remote_port) if remote_port else ""
                log_path = _remote_log_path(remote_port) if remote_port else ""
                cleanup_cmd = (
                    f"kill {self.status.remote_pid} 2>/dev/null; "
                    f"sleep 0.3; "
                    f"kill -9 {self.status.remote_pid} 2>/dev/null; "
                )
                if pid_file:
                    cleanup_cmd += f"rm -f {pid_file} 2>/dev/null; "
                if log_path:
                    cleanup_cmd += f"rm -f {log_path} 2>/dev/null; "
                cleanup_cmd += "true"
                self._exec_remote(cleanup_cmd, timeout=5)
            except Exception:
                pass
        if self._client:
            try: self._client.close()
            except Exception: pass
        self._client = None
        self._transport = None

    def disconnect(self) -> None:
        """断开 SSH 连接，清理远程进程和隧道。"""
        logger.info("正在断开 SSH 隧道...")

        # 停止隧道
        self._tunnel_stop.set()
        if self._local_socket:
            try: self._local_socket.close()
            except Exception: pass
        if self._tunnel_thread:
            self._tunnel_thread.join(timeout=2)

        # 杀远程 gateway 进程 + 清理 PID/log 文件
        remote_port = self.status.remote_port
        pid_file = _remote_pid_file(remote_port) if remote_port else ""
        log_path = _remote_log_path(remote_port) if remote_port else ""

        if self._client and self.status.remote_pid:
            try:
                logger.info("终止远程进程 PID=%s (port=%s)", self.status.remote_pid, remote_port)
                # 杀进程 + 清理 PID/log 文件
                cleanup_cmd = (
                    f"kill {self.status.remote_pid} 2>/dev/null; "
                    f"sleep 0.3; "
                    f"kill -9 {self.status.remote_pid} 2>/dev/null; "
                )
                if pid_file:
                    cleanup_cmd += f"rm -f {pid_file} 2>/dev/null; "
                if log_path:
                    cleanup_cmd += f"rm -f {log_path} 2>/dev/null; "
                cleanup_cmd += "true"
                self._exec_remote(cleanup_cmd)
            except Exception:
                pass

        # 关闭 SSH 连接
        if self._client:
            try: self._client.close()
            except Exception: pass

        self.status.connected = False
        self._client = None
        self._transport = None
        logger.info("SSH 隧道已断开")

    # ── 残留进程清理 ────────────────────────────────────────────────

    def cleanup_stale(self) -> dict:
        """清理远程所有残留 gateway 进程和文件。

        扫描 /tmp/drsai_ssh_tui/ 下的 PID 文件, 检查对应进程是否存活,
        杀掉所有残留进程并删除 PID/log 文件。

        Returns:
            {"killed_pids": [...], "removed_files": [...]}
        """
        result: dict = {"killed_pids": [], "removed_files": []}
        if not self._client:
            return result

        try:
            # 列出所有 PID 文件并读取 PID
            out, _, _ = self._exec_remote(
                f"for f in {REMOTE_TMP_DIR}/gateway_*.pid; do "
                f"[ -f \"$f\" ] && echo \"$(cat \"$f\" 2>/dev/null) $f\"; "
                f"done 2>/dev/null || true"
            )

            for line in out.strip().split("\n"):
                line = line.strip()
                if not line:
                    continue
                parts = line.split()
                if len(parts) < 2:
                    continue
                try:
                    pid = int(parts[0])
                except ValueError:
                    continue
                pid_f = parts[1]

                # 检查进程是否存活
                alive_out, _, _ = self._exec_remote(
                    f"kill -0 {pid} 2>&1 && echo ALIVE || echo DEAD"
                )
                if "ALIVE" in alive_out:
                    # 杀进程
                    self._exec_remote(
                        f"kill {pid} 2>/dev/null; "
                        f"sleep 0.2; "
                        f"kill -9 {pid} 2>/dev/null; "
                        f"true"
                    )
                    result["killed_pids"].append(pid)
                    logger.info("清理残留进程 PID=%s", pid)

                # 删除 PID 文件
                self._exec_remote(f"rm -f {pid_f} 2>/dev/null; true")
                result["removed_files"].append(pid_f)

            # 清理无 PID 文件对应的残留 tui_gateway 进程
            self._exec_remote(
                f"pkill -f '[t]ui.gateway.*DRSAI_TUI_ENABLE_WS' 2>/dev/null; true"
            )

            # 列出并清理残留 log 文件
            out, _, _ = self._exec_remote(
                f"ls {REMOTE_TMP_DIR}/gateway_*.log 2>/dev/null || true"
            )
            for line in out.strip().split("\n"):
                line = line.strip()
                if line:
                    self._exec_remote(f"rm -f {line} 2>/dev/null; true")
                    result["removed_files"].append(line)

        except Exception as e:
            logger.warning("cleanup_stale 出错: %s", e)

        return result

    # ── 测试连接 ────────────────────────────────────────────────────

    @staticmethod
    def test_connection(cfg: SSHConfig) -> tuple[bool, str]:
        """测试 SSH 连接是否可用（不启动 gateway）。"""
        if not _HAS_PARAMIKO:
            return False, "paramiko 未安装"
        try:
            client = paramiko.SSHClient()
            client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            connect_kwargs: dict = {
                "hostname": cfg.host, "port": cfg.port,
                "username": cfg.username, "timeout": 10,
            }
            key_path = os.path.expanduser(cfg.private_key_path) if cfg.private_key_path else ""
            if key_path and os.path.exists(key_path):
                connect_kwargs["key_filename"] = key_path
            elif cfg.password:
                connect_kwargs["password"] = cfg.password
            else:
                connect_kwargs["allow_agent"] = True
                connect_kwargs["look_for_keys"] = True
            client.connect(**connect_kwargs)

            def _exec(cmd: str) -> str:
                _, so, _ = client.exec_command(cmd, timeout=10)
                return so.read().decode("utf-8", errors="replace").strip()

            hostname = _exec("hostname")

            # 定位 opendrsai 可执行文件 (PATH → 默认安装目录)
            launcher = _exec("command -v opendrsai 2>/dev/null || true").splitlines()
            opendrsai = launcher[0].strip() if launcher and launcher[0].strip() else ""
            if not opendrsai:
                if "FOUND" in _exec("test -x ~/.drsai/bin/opendrsai && echo FOUND || true"):
                    opendrsai = "~/.drsai/bin/opendrsai"

            if not opendrsai:
                client.close()
                return False, (
                    f"SSH 连接成功 (host: {hostname}), 但远程找不到 opendrsai。\n"
                    "PATH 和 ~/.drsai/bin/ 均未命中。\n"
                    "请先在远程服务器上运行 scripts/install_drsai.sh 完成安装。"
                )

            version = _exec(f"{opendrsai} --version 2>&1 || true").splitlines()
            client.close()
            return True, (
                f"{hostname}\n"
                f"opendrsai: {opendrsai}\n"
                + (version[0] if version else "")
            )
        except Exception as e:
            return False, str(e)


# ── 配置持久化 ───────────────────────────────────────────────────────


def _ssh_config_path() -> Path:
    """SSH 配置文件路径。"""
    from drsai.configs.constant import CONFIG_DIR
    return Path(CONFIG_DIR) / "ssh_configs.json"


def list_ssh_configs() -> list[dict]:
    """列出所有已保存的 SSH 配置（脱敏）。"""
    path = _ssh_config_path()
    if not path.exists():
        return []
    try:
        import json
        configs = json.loads(path.read_text("utf-8"))
        return [SSHConfig.from_dict(c).masked() for c in configs]
    except Exception:
        return []


def get_ssh_config(name: str) -> Optional[SSHConfig]:
    """按名称获取配置（含密码明文）。"""
    path = _ssh_config_path()
    if not path.exists():
        return None
    try:
        import json
        configs = json.loads(path.read_text("utf-8"))
        for c in configs:
            if c.get("name") == name:
                return SSHConfig.from_dict(c)
        return None
    except Exception:
        return None


def save_ssh_config(cfg: SSHConfig) -> None:
    """保存或更新一条配置。"""
    import json
    path = _ssh_config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    configs = []
    if path.exists():
        try:
            configs = json.loads(path.read_text("utf-8"))
        except Exception:
            configs = []
    configs = [c for c in configs if c.get("name") != cfg.name]
    configs.append(cfg.to_dict())
    path.write_text(json.dumps(configs, indent=2, ensure_ascii=False), "utf-8")


def delete_ssh_config(name: str) -> bool:
    """删除一条配置，返回是否删除成功。"""
    import json
    path = _ssh_config_path()
    if not path.exists():
        return False
    try:
        configs = json.loads(path.read_text("utf-8"))
        before = len(configs)
        configs = [c for c in configs if c.get("name") != name]
        path.write_text(json.dumps(configs, indent=2, ensure_ascii=False), "utf-8")
        return len(configs) < before
    except Exception:
        return False
