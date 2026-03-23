"""
wechat_bot.py — 微信 ilink Bot 主循环
======================================
负责：长轮询接收消息 → 命令路由 → 调用 DrSai agent → 分段回复微信。

命令列表：
  /help            —— 显示帮助
  /newsession      —— 新建会话，开始与 agent 的全新对话
  /session         —— 列出该用户所有历史会话
  /session <id>    —— 切换到指定会话

其他文字消息 → 转发给当前会话的 DrSai agent，逐条实时发送 TextMessage 回复。
"""

import asyncio
import json
import logging
from typing import TYPE_CHECKING

from .wechat_client import AsyncWeChatAPI, MessageType, split_text
from .session_manager import SessionManager

if TYPE_CHECKING:
    from drsai.backend.run import DrSaiWorkerModel

logger = logging.getLogger(__name__)

# 等待提示：当 agent 处理时间可能较长时先发一条占位消息
THINKING_HINT = "⏳ 正在处理，请稍候..."

HELP_TEXT = """DrSai Bot 命令列表：
/help            —— 显示此帮助
/newsession      —— 新建对话（开始全新 session）
/session         —— 查看所有历史 session
/session <id>    —— 切换到指定 session（如 /session session_1）
其他文字         —— 与当前 session 的 AI 助手对话""".strip()

# 连续失败退避阈值
BACKOFF_THRESHOLD = 3
BACKOFF_SHORT = 3
BACKOFF_LONG = 30

# 最多缓存最近 N 条消息 ID 用于去重
MAX_DEDUP_SIZE = 1000


class WeChatBot:
    """
    微信 Bot 主控类。

    - 持续长轮询拉取新消息
    - 按命令路由或转发 agent
    - 每个用户持有一把 asyncio.Lock，防止并发消息互相干扰
    """

    def __init__(
        self,
        model: "DrSaiWorkerModel",
        creds: dict,
        api_key: str,
        session_manager: SessionManager,
    ):
        self.model = model
        self.creds = creds
        self.api_key = api_key
        self.session_manager = session_manager
        self.api = AsyncWeChatAPI(
            bot_token=creds["bot_token"],
            base_url=creds.get("base_url", "https://ilinkai.weixin.qq.com"),
        )
        self._user_locks: dict[str, asyncio.Lock] = {}
        self._seen_ids: set = set()

    # ── 主循环 ────────────────────────────────────────────────────────────────

    async def run(self) -> None:
        """长轮询主循环，持续拉取并处理新消息。"""
        from .wechat_client import load_sync_buf, save_sync_buf

        sync_buf = load_sync_buf()
        consecutive_failures = 0

        logger.info("WeChatBot 已启动，账号: %s", self.creds.get("account_id"))

        while True:
            try:
                resp = await self.api.get_updates(sync_buf or None)
            except asyncio.CancelledError:
                logger.info("WeChatBot 收到取消信号，退出。")
                break
            except Exception as e:
                consecutive_failures += 1
                wait = BACKOFF_LONG if consecutive_failures >= BACKOFF_THRESHOLD else BACKOFF_SHORT
                logger.warning("getupdates 出错（第%d次）: %s，%ds 后重试", consecutive_failures, e, wait)
                await asyncio.sleep(wait)
                continue

            consecutive_failures = 0

            # session 过期
            if resp.get("ret") == -14:
                logger.error("微信 session 已过期，Bot 暂停。请重新启动后端并扫码登录。")
                await asyncio.sleep(3600)
                continue

            # 更新游标
            new_buf = resp.get("get_updates_buf")
            if new_buf:
                sync_buf = new_buf
                save_sync_buf(sync_buf)

            # 分发消息（各消息并发处理，同一用户串行）
            tasks = []
            for msg in resp.get("msgs") or []:
                msg_id = msg.get("message_id")
                if msg_id and msg_id in self._seen_ids:
                    continue
                if msg_id:
                    self._seen_ids.add(msg_id)
                    if len(self._seen_ids) > MAX_DEDUP_SIZE:
                        to_rm = list(self._seen_ids)[: MAX_DEDUP_SIZE // 2]
                        self._seen_ids.difference_update(to_rm)
                tasks.append(asyncio.create_task(self._dispatch(msg)))

            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)

    # ── 消息分发（带用户级锁） ────────────────────────────────────────────────

    async def _dispatch(self, msg: dict) -> None:
        """确保同一用户的消息串行处理，避免乱序。"""
        if msg.get("message_type") != MessageType.USER:
            return

        user_id = msg.get("from_user_id", "")
        if not user_id:
            return

        lock = self._user_locks.setdefault(user_id, asyncio.Lock())
        async with lock:
            try:
                await self.handle_message(msg)
            except Exception as e:
                logger.exception("处理消息 %s 时出错: %s", msg.get("message_id"), e)

    # ── 消息处理 ─────────────────────────────────────────────────────────────

    async def handle_message(self, msg: dict) -> None:
        user_id = msg.get("from_user_id", "")
        context_token = msg.get("context_token", "")
        text = AsyncWeChatAPI.extract_text(msg).strip()

        logger.info("[msg#%s] from=%s text=%r", msg.get("message_id"), user_id, text[:80])

        if not text:
            await self._reply(user_id, context_token, "暂不支持此类消息，请发送文字。")
            return

        # ── 命令路由 ──────────────────────────────────────────────────────────
        if text == "/help":
            await self._reply(user_id, context_token, HELP_TEXT)
            return

        if text == "/newsession":
            chat_id = self.session_manager.new_session(user_id)
            await self._reply(user_id, context_token,
                              f"✅ 已创建新会话 {chat_id}，后续对话将在此会话中进行。")
            return

        if text == "/session":
            sessions = self.session_manager.list_sessions(user_id)
            current = self.session_manager.get_current(user_id)
            if not sessions:
                await self._reply(user_id, context_token, "暂无历史会话，发送任意消息即可自动创建。")
            else:
                lines = [f"历史会话列表（当前: {current}）："]
                for sid in sessions:
                    mark = " ←当前" if sid == current else ""
                    lines.append(f"  • {sid}{mark}")
                lines.append("\n发送 /session <id> 切换会话。")
                await self._reply(user_id, context_token, "\n".join(lines))
            return

        if text.startswith("/session "):
            target = text[9:].strip()
            if self.session_manager.switch_session(user_id, target):
                await self._reply(user_id, context_token, f"✅ 已切换到会话 {target}。")
            else:
                await self._reply(user_id, context_token,
                                  f"❌ 会话 {target!r} 不存在或不属于你，请用 /session 查看列表。")
            return

        # ── 转发给 agent ──────────────────────────────────────────────────────
        chat_id = self.session_manager.get_or_create_session(user_id)

        # 先发"处理中"占位消息
        await self._reply(user_id, context_token, THINKING_HINT)

        # 确保 agent 已初始化
        await self._ensure_agent(chat_id, user_id)

        # 以 a_drsai_ui_completions 为核心，收到每条 TextMessage 立即发送
        messages = [
            {
                "type": "TextMessage",
                "source": "user",
                "content": text,
                "models_usage": None,
            }
        ]
        kwargs = dict(
            chat_id=chat_id,
            api_key=self.api_key,
            messages=messages,
            stream=True,
            user={"email": user_id},
        )

        replied = False
        try:
            async for line in self.model.drsai.a_drsai_ui_completions(**kwargs):
                if not isinstance(line, str):
                    continue
                line = line.strip()
                if not line.startswith("data: "):
                    continue
                try:
                    event = json.loads(line[6:])
                except json.JSONDecodeError:
                    continue

                event_type = event.get("type", "")

                if event_type == "TextMessage":
                    source = event.get("source", "")
                    content = event.get("content", "")
                    if source != "user" and content:
                        await self._reply(user_id, context_token, content)
                        replied = True

                elif event_type == "TaskResult":
                    break

        except Exception as e:
            logger.exception("agent 调用出错 (chat_id=%s): %s", chat_id, e)

        if not replied:
            await self._reply(user_id, context_token, "（Agent 未返回内容，请重试）")

        # 更新活跃时间
        self.session_manager.touch(chat_id)

    # ── 发送消息（自动分段） ──────────────────────────────────────────────────

    async def _reply(self, to_user_id: str, context_token: str, text: str) -> None:
        """将文本分段后逐条发送给用户。"""
        account_id = self.creds["account_id"]
        for chunk in split_text(text):
            try:
                await self.api.send_text(account_id, to_user_id, context_token, chunk)
            except Exception as e:
                logger.error("发送消息失败 to=%s: %s", to_user_id, e)

    # ── 确保 agent 已初始化 ───────────────────────────────────────────────────

    async def _ensure_agent(self, chat_id: str, user_id: str) -> None:
        """调用 lazy_init 确保对应 chat_id 的 agent 实例已创建。"""
        run_info = {"email": user_id}
        result = await self.model.lazy_init(
            chat_id=chat_id,
            api_key=self.api_key,
            run_info=run_info,
            stream=True,
        )
        if not result.get("status"):
            raise RuntimeError(f"lazy_init 失败: {result.get('message')}")

