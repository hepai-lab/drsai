"""
wechat_bot.py — 微信 ilink Bot 主循环
======================================
负责：长轮询接收消息 → 命令路由 → 调用 OpenDrSai agent → 分段回复微信。

命令列表：
  /help            —— 显示帮助
  /newsession      —— 新建会话，开始与 agent 的全新对话
  /session         —— 列出该用户所有历史会话
  /session <id>    —— 切换到指定会话

其他文字消息 → 转发给当前会话的 OpenDrSai agent，逐条实时发送 TextMessage 回复。
"""

import asyncio
import json
import logging
import hashlib
from typing import TYPE_CHECKING

from .wechat_client import AsyncWeChatAPI, MessageType, split_text
from .session_manager import SessionManager

if TYPE_CHECKING:
    from drsai.backend.run import DrSaiWorkerModel

logger = logging.getLogger(__name__)

HELP_TEXT = """OpenDrSai Bot 命令列表：
/help                 —— 显示此帮助
/newsession           —— 新建对话（开始全新 session）
/session              —— 查看所有历史 session
/session <id>         —— 切换到指定 session（如 /session session_1）
其他文字         —— 与当前 session 的 AI 助手对话

模型与子智能体的切换请在 Desktop 设置中配置，微信频道不提供切换命令。""".strip()

# 连续失败退避阈值
BACKOFF_THRESHOLD = 3
BACKOFF_SHORT = 3
BACKOFF_LONG = 30

# 最多缓存最近 N 条消息 ID 用于去重
MAX_DEDUP_SIZE = 1000


class WeChatCredentialsExpired(RuntimeError):
    """Raised when iLink rejects the persisted login session."""


class WeChatBot:
    """
    微信 Bot 主控类。

    - 持续长轮询拉取新消息
    - 按命令路由或转发 agent
    - 每个用户持有一把 asyncio.Lock，防止并发消息互相干扰
    """

    def __init__(
        self,
        model: "DrSaiWorkerModel | None",
        creds: dict,
        api_key: str,
        session_manager: SessionManager | None,
        runtime_bridge=None,
    ):
        self.model = model
        self.creds = creds
        self.api_key = api_key
        self.session_manager = session_manager
        self.runtime_bridge = runtime_bridge
        self.api = AsyncWeChatAPI(
            bot_token=creds["bot_token"],
            base_url=creds.get("base_url", "https://ilinkai.weixin.qq.com"),
        )
        self._user_locks: dict[str, asyncio.Lock] = {}
        self._seen_ids: set = set()

        self._user_context_tokens: dict[str, str] = {}

        self._msg_metadata = {}

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
                logger.error("WeChat credentials expired; scan a new QR code to reconnect.")
                raise WeChatCredentialsExpired("wechat_credentials_expired")

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

        # ✅ 缓存 context_token，用于后续主动推送
        context_token = msg.get("context_token", "")
        if user_id and context_token:
            self._user_context_tokens[user_id] = context_token

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
        image_items = AsyncWeChatAPI.extract_images(msg)

        logger.info("WeChat inbound message id=%s user=%s characters=%d", _safe_message_id(msg.get("message_id")), _safe_user_id(user_id), len(text))

        if not text and not image_items:
            await self._reply(user_id, context_token, "暂不支持此类消息，请发送文字。")
            return

        # ── 命令路由 ──────────────────────────────────────────────────────────
        if text == "/help" and not image_items:
            await self._reply(user_id, context_token, HELP_TEXT)
            return

        if text == "/newsession" and not image_items:
            if self.runtime_bridge is not None:
                chat_id = self.runtime_bridge.new_session(user_id)["title"]
            else:
                if self.session_manager is None:
                    raise RuntimeError("wechat_session_manager_unavailable")
                chat_id = self.session_manager.new_session(user_id)
            await self._reply(user_id, context_token,
                              f"✅ 已创建新会话 {chat_id}，后续对话将在此会话中进行。")
            return

        if text == "/session" and not image_items:
            if self.runtime_bridge is not None:
                session_rows, current = self.runtime_bridge.list_sessions(user_id)
                sessions = [str(row["session_id"]) for row in session_rows]
                labels = {str(row["session_id"]): str(row["title"]) for row in session_rows}
            else:
                if self.session_manager is None:
                    raise RuntimeError("wechat_session_manager_unavailable")
                sessions = self.session_manager.list_sessions(user_id)
                current = self.session_manager.get_current(user_id)
                labels = {sid: sid for sid in sessions}
            if not sessions:
                await self._reply(user_id, context_token, "暂无历史会话，发送任意消息即可自动创建。")
            else:
                lines = [f"历史会话列表（当前: {current}）："]
                for sid in sessions:
                    mark = " ←当前" if sid == current else ""
                    lines.append(f"  • {labels[sid]} ({sid}){mark}")
                lines.append("\n发送 /session <id> 切换会话。")
                await self._reply(user_id, context_token, "\n".join(lines))
            return

        if text.startswith("/session ") and not image_items:
            target = text[9:].strip()
            try:
                if self.runtime_bridge is not None:
                    selected = self.runtime_bridge.switch_session(user_id, target)
                    switched = True
                    target_label = str(selected["title"])
                else:
                    if self.session_manager is None:
                        raise RuntimeError("wechat_session_manager_unavailable")
                    switched = self.session_manager.switch_session(user_id, target)
                    target_label = target
            except KeyError:
                switched = False
                target_label = target
            if switched:
                await self._reply(user_id, context_token, f"✅ 已切换到会话 {target_label}。")
            else:
                await self._reply(user_id, context_token,
                                  f"❌ 会话 {target!r} 不存在或不属于你，请用 /session 查看列表。")
            return

        # ── 转发给 agent ──────────────────────────────────────────────────────
        if not image_items and (text.startswith("/models") or text.startswith("/model ")):
            await self._reply(user_id, context_token, "当前微信频道暂不支持切换模型，请在 Desktop 设置中配置默认模型。")
            return
        if self.runtime_bridge is not None:
            typing_task = asyncio.create_task(
                self._maintain_typing(user_id, context_token),
                name=f"wechat-typing-{_safe_user_id(user_id)}",
            )
            try:
                inbound_images: list[tuple[bytes, str]] = []
                for image_item in image_items:
                    inbound_images.append(await self.api.download_image(image_item))
                turn = await self.runtime_bridge.run_turn(
                    provider_user_id=user_id,
                    message_id=str(msg.get("message_id") or ""),
                    text=text or "请理解这张图片并回答。",
                    images=inbound_images,
                )
                delivery, created = self.runtime_bridge.begin_agent_reply_delivery(turn)
                if created:
                    try:
                        if turn.text:
                            await self._reply(user_id, context_token, turn.text)
                        for image in turn.images:
                            await self._reply_image(
                                user_id, context_token, image.content
                            )
                    except Exception as exc:
                        self.runtime_bridge.complete_outbound(
                            str(delivery["delivery_id"]), status="unknown",
                            error_code=f"wechat_send_{type(exc).__name__}",
                        )
                        raise
                    self.runtime_bridge.complete_outbound(
                        str(delivery["delivery_id"]), status="sent"
                    )
            except Exception as e:
                logger.exception(
                    "WeChat Runtime turn failed message=%s error_type=%s",
                    _safe_message_id(msg.get("message_id")), type(e).__name__,
                )
                await self._reply(user_id, context_token, "❌ Agent 处理失败，请在 Desktop 诊断中查看详情。")
            finally:
                typing_task.cancel()
                try:
                    await typing_task
                except asyncio.CancelledError:
                    pass
            return

        if self.session_manager is None or self.model is None:
            raise RuntimeError("wechat_legacy_runtime_unavailable")
        chat_id = self.session_manager.get_or_create_session(user_id)

        # 确保 agent 已初始化
        typing_task = asyncio.create_task(
            self._maintain_typing(user_id, context_token),
            name=f"wechat-typing-{_safe_user_id(user_id)}",
        )
        # 以 a_drsai_ui_completions 为核心，收到每条 TextMessage 立即发送
        messages = [
            {
                "type": "TextMessage",
                "source": "user",
                "content": text,
                "metadata": self._msg_metadata,
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
        daemon_buffer = ""  # 缓冲 daemon 的流式输出，完成后一次性发送
        try:
            await self._ensure_agent(chat_id, user_id)
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

                if event_type == "message.delta":
                    # AgentSessionAdapter (daemon) 路径：流式文本增量
                    # 缓冲所有 chunk，等 message.complete 或 TaskResult 时一次性发送
                    content = event.get("text", "")
                    if content:
                        daemon_buffer += content
                elif event_type == "subagent.thinking":
                    # 子智能体流式输出（daemon 委托路径）：
                    # 与 message.delta 同等处理，缓冲等待子智能体完成
                    content = event.get("text", "")
                    if content:
                        daemon_buffer += content
                elif event_type == "message.complete":
                    # Daemon 完整消息输出 — 发送缓冲的全部内容
                    if daemon_buffer.strip():
                        await self._reply(user_id, context_token, daemon_buffer)
                        replied = True
                    daemon_buffer = ""
                elif event_type == "subagent.complete":
                    # 子智能体完成 — 发送缓冲的全部内容
                    if daemon_buffer.strip():
                        await self._reply(user_id, context_token, daemon_buffer)
                        replied = True
                    daemon_buffer = ""
                elif event_type == "TextMessage":
                    # DrSaiAPP (旧 run_worker) 路径：完整消息
                    source = event.get("source", "")
                    content = event.get("content", "")
                    if source != "user" and content:
                        await self._reply(user_id, context_token, content)
                        replied = True
                elif event_type == "AgentLogEvent":
                    # DrSaiAPP (旧 run_worker) 路径：日志事件
                    title = event.get("title", "")
                    if title:
                        await self._reply(user_id, context_token, title)
                elif event_type == "error":
                    # 通用错误事件 — 先发送已缓冲的内容再报错
                    if daemon_buffer.strip():
                        await self._reply(user_id, context_token, daemon_buffer)
                        replied = True
                    daemon_buffer = ""
                    await self._reply(user_id, context_token, "❌ Agent 处理失败，请在 Desktop 诊断中查看详情。")
                    replied = True
                elif event_type == "TaskResult":
                    # 任务完成 — 发送缓冲的全部内容
                    if daemon_buffer.strip():
                        await self._reply(user_id, context_token, daemon_buffer)
                        replied = True
                    daemon_buffer = ""
                    break

        except Exception as e:
            logger.exception("WeChat Agent call failed chat_id=%s error_type=%s", chat_id, type(e).__name__)
            # 异常时发送已缓冲的 daemon 内容
            if daemon_buffer.strip():
                try:
                    await self._reply(user_id, context_token, daemon_buffer)
                except Exception:
                    pass
        finally:
            typing_task.cancel()
            try:
                await typing_task
            except asyncio.CancelledError:
                pass

        if not replied:
            await self._reply(user_id, context_token, "（Agent 未返回内容，请重试）")

        # 更新活跃时间
        self.session_manager.touch(chat_id)

    async def _maintain_typing(self, user_id: str, context_token: str) -> None:
        """Best-effort native typing indicator; never affects message delivery."""
        get_ticket = getattr(self.api, "get_typing_ticket", None)
        send_typing = getattr(self.api, "send_typing", None)
        if not callable(get_ticket) or not callable(send_typing):
            return
        ticket = None
        try:
            ticket = await get_ticket(user_id, context_token)
            while True:
                await send_typing(user_id, ticket, active=True)
                await asyncio.sleep(5)
        except asyncio.CancelledError:
            raise
        except Exception as error:
            logger.info(
                "WeChat native typing indicator unavailable user=%s error_type=%s",
                _safe_user_id(user_id),
                type(error).__name__,
            )
        finally:
            if ticket:
                try:
                    await send_typing(user_id, ticket, active=False)
                except Exception:
                    pass

    # ── 发送消息（自动分段） ──────────────────────────────────────────────────

    async def _reply(self, to_user_id: str, context_token: str, text: str) -> None:
        """将文本分段后逐条发送给用户。"""
        account_id = self.creds["account_id"]
        for chunk in split_text(text):
            try:
                await self.api.send_text(account_id, to_user_id, context_token, chunk)
            except Exception as e:
                logger.error("WeChat send failed user=%s error_type=%s", _safe_user_id(to_user_id), type(e).__name__)
                raise

    async def _reply_image(
        self, to_user_id: str, context_token: str, content: bytes
    ) -> None:
        try:
            await self.api.send_image(
                self.creds["account_id"], to_user_id, context_token, content
            )
        except Exception as error:
            logger.error(
                "WeChat image send failed user=%s error_type=%s",
                _safe_user_id(to_user_id), type(error).__name__,
            )
            raise

    def desktop_outbound_capability(self, session_id: str) -> dict:
        if self.runtime_bridge is None:
            return {"available": False, "reason": "runtime_session_unavailable"}
        user_id = self.runtime_bridge.provider_user_for_session(session_id)
        if not user_id:
            return {"available": False, "reason": "waiting_for_inbound"}
        if not self._user_context_tokens.get(user_id):
            return {"available": False, "reason": "waiting_for_inbound"}
        return {"available": True, "reason": None}

    async def send_desktop_outbound(
        self, session_id: str, *, text: str, idempotency_key: str
    ) -> dict:
        capability = self.desktop_outbound_capability(session_id)
        if not capability["available"]:
            raise RuntimeError(str(capability["reason"]))
        user_id = self.runtime_bridge.provider_user_for_session(session_id)
        context_token = self._user_context_tokens[str(user_id)]
        delivery, created = self.runtime_bridge.begin_outbound(
            session_id, idempotency_key=idempotency_key, text=text
        )
        if not created:
            return delivery
        try:
            await self._reply(str(user_id), context_token, text)
        except Exception as exc:
            return self.runtime_bridge.complete_outbound(
                str(delivery["delivery_id"]), status="unknown",
                error_code=f"wechat_send_{type(exc).__name__}",
            )
        return self.runtime_bridge.complete_outbound(
            str(delivery["delivery_id"]), status="sent"
        )

    # ── 主动推送通知 ───────────────────────────────────────────────────────

    async def push_notification(self, user_id: str, text: str) -> bool:
        """
        主动推送通知给微信用户（不需要用户先发消息）。
        使用缓存的 context_token 发送。

        Args:
            user_id: 微信用户的 from_user_id (ilink user ID)
            text: 要推送的文本内容

        Returns:
            是否成功推送
        """
        context_token = self._user_context_tokens.get(user_id)
        if not context_token:
            logger.warning("No cached context token for WeChat user %s", _safe_user_id(user_id))
            return False
        try:
            await self._reply(user_id, context_token, text)
            logger.info("WeChat notification sent user=%s", _safe_user_id(user_id))
            return True
        except Exception as e:
            logger.error("WeChat notification failed user=%s error_type=%s", _safe_user_id(user_id), type(e).__name__)
            return False

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


def _safe_user_id(value: str) -> str:
    return hashlib.sha256(str(value).encode("utf-8")).hexdigest()[:12]


def _safe_message_id(value) -> str:
    return hashlib.sha256(str(value or "").encode("utf-8")).hexdigest()[:12]

