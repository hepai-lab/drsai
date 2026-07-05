"""
wechat_adapter.py — 在 Daemon 进程内驱动 WeChatBot

将现有的 WeChatBot（基于旧 DrSaiWorkerModel）适配到新的 AgentSession 架构。
通过创建一个适配器包装 AgentSession，使 WeChatBot 的接口调用可以正常工作。
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


class AgentSessionAdapter:
    """
    将 AgentSession 适配为 WeChatBot 所期望的 DrSaiWorkerModel 接口。

    WeChatBot 内部调用:
        - self.model.drsai.a_drsai_ui_completions(chat_id, api_key, messages, stream, user)
        - self.model.lazy_init(chat_id, api_key, run_info, stream)

    此适配器实现这两个接口，底层对接 AgentSession.run_turn()。
    """

    def __init__(self, sessions_dict: dict, daemon_config: Any):
        self._sessions = sessions_dict
        self._config = daemon_config
        self.drsai = self  # WeChatBot 访问 model.drsai

    async def lazy_init(
        self,
        *,
        chat_id: str,
        api_key: str,
        run_info: dict,
        stream: bool = True,
    ) -> dict:
        """确保 AgentSession 已初始化（懒加载）。"""
        import threading
        from drsai.backend.tui_gateway.adapter.agent_runner import AgentSession
        from drsai.backend.tui_gateway.handlers.session import _resolve_user_id
        from drsai.backend.tui_gateway.handlers.slash import get_config_manager
        from drsai.backend.tui_gateway.server import _get_db_manager

        if chat_id not in self._sessions:
            user_id = run_info.get("email", _resolve_user_id())
            cfg = get_config_manager(user_id)
            if api_key:
                cfg = dict(cfg)
                cfg["api_key"] = api_key
            sess = AgentSession(
                session_id=chat_id,
                user_id=user_id,
                cli_cfg=cfg,
                db_manager=_get_db_manager(),
            )
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, sess.init)
            self._sessions[chat_id] = {
                "agent_session": sess,
                "user_id": user_id,
                "history_lock": threading.Lock(),
                "running": False,
            }
        return {"status": True}

    async def a_drsai_ui_completions(
        self,
        *,
        chat_id: str,
        api_key: str,
        messages: list[dict],
        stream: bool = True,
        user: dict,
    ):
        """
        将消息转发给 AgentSession，以 SSE 格式 yield 事件。

        WeChatBot 消费格式: "data: {json}\\n"
        """
        state = self._sessions.get(chat_id)
        if not state:
            yield f'data: {{"type": "error", "message": "session not found"}}\n'
            return

        sess = state.get("agent_session")
        text = ""
        for msg in messages:
            if msg.get("type") == "TextMessage" and msg.get("source") == "user":
                text = msg.get("content", "")
                break

        if not text:
            return

        # 使用队列在同步 run_turn 与异步生成器之间桥接
        import json as _json
        import concurrent.futures
        event_queue: asyncio.Queue = asyncio.Queue()
        loop = asyncio.get_event_loop()

        def on_event(event_type: str, payload: dict) -> None:
            frame = _json.dumps({"type": event_type, **payload})
            loop.call_soon_threadsafe(event_queue.put_nowait, (event_type, frame))

        future = loop.run_in_executor(None, sess.run_turn, text, on_event)

        SENTINEL = object()

        async def _run_and_signal():
            try:
                await future
            finally:
                await event_queue.put(SENTINEL)

        asyncio.create_task(_run_and_signal())

        while True:
            item = await event_queue.get()
            if item is SENTINEL:
                break
            event_type, frame = item
            yield f"data: {frame}\n"
            if event_type == "message.complete":
                yield 'data: {"type": "TaskResult"}\n'
                break


async def start_wechat_bot(config: Any, sessions_dict: dict) -> None:
    """
    在 Daemon 进程内启动微信 Bot。

    复用现有的 WeChatBot，通过 AgentSessionAdapter 对接新架构。
    """
    import os
    try:
        from drsai.backend.wechat import (
            login_wechat_main,
            load_credentials,
            WeChatBot,
            SessionManager,
        )
        from drsai.configs.constant import WECHAT_DIR
    except ImportError:
        logger.error(
            "WeChatBot module not available. "
            "Install drsai[wechat] to enable WeChat integration."
        )
        return

    creds_file = os.path.join(WECHAT_DIR, "credentials.json")
    try:
        creds = load_credentials(creds_file)
    except Exception:
        creds = None

    if not creds:
        logger.warning(
            "WeChat credentials not found at %s. Attempting login flow...",
            creds_file,
        )
        try:
            await login_wechat_main()
            creds = load_credentials(creds_file)
        except Exception as e:
            logger.error(
                "WeChat login failed: %s. Run `drsai wechat login` manually.",
                e,
            )
            return

    api_key = (
        os.environ.get("HEPAI_API_KEY")
        or os.environ.get("ANTHROPIC_API_KEY")
        or os.environ.get("OPENAI_API_KEY")
        or ""
    )

    from drsai.configs.constant import WORKSPACE_DIR
    daemon_data_dir = Path(WORKSPACE_DIR) / "daemons" / config.name
    daemon_data_dir.mkdir(parents=True, exist_ok=True)
    sessions_file = str(daemon_data_dir / "wechat_sessions.json")

    session_manager = SessionManager(sessions_file)
    adapter = AgentSessionAdapter(sessions_dict, config)

    bot = WeChatBot(
        model=adapter,
        creds=creds,
        api_key=api_key,
        session_manager=session_manager,
    )

    logger.info(
        "WeChatBot starting for daemon '%s' (account: %s)",
        config.name,
        creds.get("account_id", "?"),
    )
    await bot.run()
