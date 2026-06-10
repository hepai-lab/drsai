"""
daemon_subagent.py — Daemon 子智能体包装器

将运行中的 daemon 包装为与 DrSaiAssistant/_execute_subagent 兼容的子智能体接口，
使 daemon 可以通过 LLM Delegate 工具和 /agent 命令两种方式被调用。

协议：WebSocket JSON-RPC（与 daemon_server.py 的 /ws 端点通信）

连接复用：
    为避免每次调用都重新建立 WebSocket 连接和创建 session，
    DaemonSubagent 会复用现有连接和 session。当 _session_id 已存在
    且 WebSocket 存活时，跳过 session.create 和 session.subscribe，
    直接使用现有 session 发送 prompt.submit。
"""

from __future__ import annotations

import asyncio
import json as _json
import logging
import threading
from typing import AsyncGenerator, Sequence

from autogen_agentchat.base import Response
from autogen_agentchat.messages import (
    BaseAgentEvent,
    BaseChatMessage,
    TextMessage,
)
from autogen_core import CancellationToken

logger = logging.getLogger(__name__)

# WebSocket recv 超时（秒），避免 recv() 无限阻塞
_WS_RECV_TIMEOUT = 1.0

# 最大复用次数，超过后重新建立连接（避免 daemon 端 session 泄漏）
_MAX_REUSE_COUNT = 50

# 类级别连接池：key=(ws_port, api_token) → DaemonSubagent
# 当 _create_daemon_subagent 创建新实例时，优先从池中获取复用
_connection_pool: dict[str, "DaemonSubagent"] = {}
_pool_lock = threading.Lock()


def _pool_key(ws_port: int, api_token: str) -> str:
    return f"{ws_port}:{api_token[:8]}"


class DaemonSubagent:
    """将后台 daemon 包装成子智能体接口的轻量包装器。

    daemon 本身是一个独立进程（FastAPI + WebSocket），不需要 lazy_init。
    通过 WebSocket 创建会话、提交任务、流式读取响应。

    支持连接复用：如果已有活跃的 WebSocket 连接和 session_id，
    后续调用直接复用，跳过 session.create 握手，减少延迟。

    类级别连接池：通过 _connection_pool 在多次 _create_daemon_subagent
    调用之间共享 WebSocket 连接，避免每次新建连接的开销。
    """

    @classmethod
    def get_from_pool(cls, ws_port: int, api_token: str) -> "DaemonSubagent | None":
        """从连接池获取可复用的 DaemonSubagent，如果存在且连接存活则返回。"""
        key = _pool_key(ws_port, api_token)
        with _pool_lock:
            existing = _connection_pool.get(key)
            if existing is not None:
                if existing._is_alive():
                    return existing
                else:
                    # 连接已断开，清理
                    del _connection_pool[key]
        return None

    @classmethod
    def put_to_pool(cls, instance: "DaemonSubagent") -> None:
        """将 DaemonSubagent 放入连接池供后续复用。"""
        key = _pool_key(instance._ws_port, instance._api_token)
        with _pool_lock:
            _connection_pool[key] = instance

    @classmethod
    def remove_from_pool(cls, ws_port: int, api_token: str) -> None:
        """从连接池中移除。"""
        key = _pool_key(ws_port, api_token)
        with _pool_lock:
            _connection_pool.pop(key, None)

    def __init__(
        self,
        name: str,
        ws_port: int,
        api_token: str,
        daemon_name: str,
    ):
        self.name = name
        self._ws_port = ws_port
        self._api_token = api_token
        self._daemon_name = daemon_name
        self._ws = None
        self._session_id: str = ""  # 复用 session
        self._reuse_count: int = 0
        self._context_type = None  # 无 SQLite cleanup 需求
        self._closed: bool = False

    def _is_alive(self) -> bool:
        """检查 WebSocket 连接是否存活。"""
        if self._closed:
            return False
        if self._ws is None:
            return False
        try:
            # 尝试 ping（非阻塞检查）
            self._ws.ping()
            return self._ws.connected
        except Exception:
            return False

    async def lazy_init(self) -> None:
        """Daemon 已独立运行，无需初始化。"""
        pass

    async def close(self) -> None:
        """关闭 WebSocket 连接并清理 session。

        注意：如果连接是复用的（来自连接池），
        只有显式调用 full_close 才会彻底清理。
        _safe_close_subagent 中的 close() 用于常规清理，
        不会断开复用连接（除非连接已出问题）。
        """
        if self._closed:
            return
        # 检查连接是否仍然健康
        if not self._is_alive():
            self._force_close()
            self.remove_from_pool(self._ws_port, self._api_token)

    def _force_close(self) -> None:
        """强制关闭连接（不检查存活状态）。"""
        self._session_id = ""
        self._reuse_count = 0
        self._closed = True
        if self._ws:
            try:
                self._ws.close()
            except Exception:
                pass
            self._ws = None

    async def full_close(self) -> None:
        """完全关闭并从连接池中移除。用于切换 agent 或 daemon 停止时。"""
        self._force_close()
        self.remove_from_pool(self._ws_port, self._api_token)

    async def on_messages_stream(
        self,
        messages: Sequence[BaseChatMessage],
        cancellation_token: CancellationToken,
    ) -> AsyncGenerator[BaseAgentEvent | BaseChatMessage | Response, None]:
        """通过 WebSocket 向 daemon 提交任务并流式返回结果。

        协议：
        1. ws://127.0.0.1:{port}/ws?token={token}
        2. ← gateway.ready
        3. → session.create → ← session_id（首次或重连时）
        4. → session.subscribe（首次或重连时）
        5. → prompt.submit → ← 事件流
        6. 事件: message.delta / thinking.delta / message.complete / error

        连接复用：如果 _session_id 已存在且 WebSocket 存活，
        跳过步骤 2-4，直接发送 prompt.submit。
        """

        # 提取用户提示词（取第一条 text 消息）
        prompt = ""
        for m in messages:
            if hasattr(m, "content") and isinstance(m.content, str):
                prompt = m.content
                break

        if not prompt:
            yield TextMessage(
                content="[DaemonSubagent] Empty task — nothing to do.",
                source=self.name,
            )
            yield Response(
                chat_message=TextMessage(
                    content="[DaemonSubagent] Empty task.",
                    source=self.name,
                )
            )
            return

        queue: asyncio.Queue = asyncio.Queue(maxsize=256)

        # 判断是否需要建立新连接
        need_new_session = not self._session_id or self._reuse_count >= _MAX_REUSE_COUNT

        def _ws_runner():
            """在后台线程中运行同步 WebSocket 通信。"""
            nonlocal need_new_session
            try:
                import websocket

                if self._ws and not need_new_session:
                    # 复用现有连接
                    ws = self._ws
                    sid = self._session_id
                else:
                    # 需要新连接：清理旧连接
                    if self._ws:
                        try:
                            self._ws.close()
                        except Exception:
                            pass
                        self._ws = None

                    url = f"ws://127.0.0.1:{self._ws_port}/ws?token={self._api_token}"
                    ws = websocket.create_connection(url, timeout=10)
                    ws.settimeout(_WS_RECV_TIMEOUT)
                    self._ws = ws
                    self._reuse_count = 0

                    # 1. 接收 gateway.ready
                    ws.recv()

                    # 2. 创建会话
                    ws.send(_json.dumps({
                        "jsonrpc": "2.0", "id": "da1",
                        "method": "session.create",
                        "params": {"name": f"daemon-{self._daemon_name}"},
                    }))
                    resp = _json.loads(ws.recv())
                    sid = (resp.get("result") or {}).get("session_id", "")

                    if not sid:
                        queue.put_nowait(("error", "session.create returned empty session_id"))
                        return

                    # 3. Subscribe transport — CRITICAL: tells the daemon to route
                    #    events for this session through THIS WebSocket connection.
                    ws.send(_json.dumps({
                        "jsonrpc": "2.0", "id": "da1b",
                        "method": "session.subscribe",
                        "params": {"session_id": sid},
                    }))
                    sub_resp = _json.loads(ws.recv())
                    if not (sub_resp.get("result") or {}).get("subscribed"):
                        queue.put_nowait(("error", f"session.subscribe failed: {sub_resp}"))
                        return

                    self._session_id = sid

                # 4. 提交任务
                self._reuse_count += 1
                ws.send(_json.dumps({
                    "jsonrpc": "2.0", "id": "da2",
                    "method": "prompt.submit",
                    "params": {"session_id": sid, "text": prompt},
                }))

                # 5. 流式读取（跳过 status.update / session.info 等管理事件）
                accumulated = ""
                while True:
                    try:
                        frame = _json.loads(ws.recv())
                    except Exception:
                        # Timeout 或连接关闭 → 继续等待
                        continue

                    params = frame.get("params") or {}
                    event_type = params.get("type", "")
                    payload = params.get("payload") or {}

                    if event_type == "message.delta":
                        chunk = payload.get("text", "")
                        accumulated += chunk
                        queue.put_nowait(("chunk", chunk))
                    elif event_type == "message.complete":
                        queue.put_nowait(("done", accumulated))
                        break
                    elif event_type == "error":
                        err = payload.get("message", "Unknown error")
                        queue.put_nowait(("error", err))
                        break
                    # else: thinking.delta, status.update, session.info → skip

                # 不关闭连接——复用模式下保持 WebSocket 存活

            except Exception as exc:
                logger.exception("DaemonSubagent WS runner failed")
                # 异常时清理连接和 session，从连接池移除，下次调用将重新建立连接
                self._session_id = ""
                self._reuse_count = 0
                self.remove_from_pool(self._ws_port, self._api_token)
                if self._ws:
                    try:
                        self._ws.close()
                    except Exception:
                        pass
                    self._ws = None
                try:
                    queue.put_nowait(("error", str(exc)))
                except asyncio.QueueFull:
                    pass

        # 启动后台 WS 线程
        thread = threading.Thread(
            target=_ws_runner,
            name=f"daemon-subagent-{self._daemon_name}",
            daemon=True,
        )
        thread.start()

        # 5. 异步消费队列 → 转为 TextMessage 流
        accumulated = ""
        while True:
            # 检查取消
            if cancellation_token.is_cancelled():
                yield TextMessage(
                    content=f"[DaemonSubagent] Task cancelled.\n\n{accumulated}",
                    source=self.name,
                )
                yield Response(
                    chat_message=TextMessage(
                        content=f"[DaemonSubagent] Cancelled.",
                        source=self.name,
                    )
                )
                break

            try:
                kind, data = await asyncio.wait_for(queue.get(), timeout=0.2)
            except asyncio.TimeoutError:
                continue

            if kind == "chunk":
                accumulated += data
                yield TextMessage(
                    content=data,
                    source=f"daemon:{self._daemon_name}",
                    metadata={"internal": "no"},
                )
            elif kind == "done":
                # Warn if daemon returned an empty response so the user
                # gets a clear signal instead of silent nothing.
                if not accumulated.strip():
                    yield TextMessage(
                        content=f"⚠️ Daemon [{self._daemon_name}] returned an empty response.",
                        source="system",
                    )
                # 输出完整响应 + Response 通知 _execute_subagent 停止
                yield Response(
                    chat_message=TextMessage(
                        content=accumulated if accumulated.strip() else f"[Daemon {self._daemon_name}: empty response]",
                        source=f"daemon:{self._daemon_name}",
                        metadata={"internal": "no"},
                    )
                )
                break
            elif kind == "error":
                yield TextMessage(
                    content=f"❌ Daemon [{self._daemon_name}] error: {data}",
                    source="system",
                )
                yield Response(
                    chat_message=TextMessage(
                        content=f"❌ Daemon error: {data}",
                        source="system",
                    )
                )
                break

        thread.join(timeout=5)
