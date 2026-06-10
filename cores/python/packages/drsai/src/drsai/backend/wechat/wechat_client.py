"""
wechat_client.py — ilink Bot API 异步封装（httpx 版）
=====================================================
将 wechat_api.py 的同步 requests 实现移植为 httpx 异步版本。

三个核心接口：
  1. POST /ilink/bot/getupdates     —— 长轮询拉取新消息
  2. POST /ilink/bot/sendmessage    —— 向用户发送消息
"""

import asyncio
import base64
import json
import os
import secrets
import time
import uuid

import httpx

from drsai.configs.constant import WECHAT_DIR

BASE_URL = "https://ilinkai.weixin.qq.com"
SYNC_BUF_FILE = os.path.join(WECHAT_DIR, "sync_buf.txt")

MAX_LEN = 2048          # 微信单条消息建议不超过 2048 字符
MAX_DEDUP_SIZE = 1000   # 最多缓存最近 N 条消息 ID 用于去重


# ── 消息类型常量 ──────────────────────────────────────────────────────────────

class MessageType:
    USER = 1   # 用户发来的消息
    BOT  = 2   # Bot 发出的消息


class MessageItemType:
    TEXT  = 1
    IMAGE = 2
    VOICE = 3
    FILE  = 4
    VIDEO = 5


class MessageState:
    NEW        = 0
    GENERATING = 1
    FINISH     = 2


# ── 工具函数 ──────────────────────────────────────────────────────────────────

def _gen_uin() -> str:
    """生成随机 X-WECHAT-UIN（4字节随机数的 base64），用于请求头。"""
    return base64.b64encode(secrets.token_bytes(4)).decode()


def _gen_client_id() -> str:
    """生成唯一 client_id，防止重复发送。"""
    return f"py-bot-{int(time.time() * 1000)}-{uuid.uuid4().hex[:8]}"


# ── sync_buf 游标持久化 ───────────────────────────────────────────────────────

def load_sync_buf() -> str:
    """从本地文件加载消息游标（程序重启后可从上次中断处继续）。"""
    try:
        with open(SYNC_BUF_FILE, encoding="utf-8") as f:
            return f.read().strip()
    except FileNotFoundError:
        return ""


def save_sync_buf(buf: str) -> None:
    """持久化消息游标，防止重启后重复收到历史消息。"""
    os.makedirs(WECHAT_DIR, exist_ok=True)
    with open(SYNC_BUF_FILE, "w", encoding="utf-8") as f:
        f.write(buf)


# ── 文字分段 ─────────────────────────────────────────────────────────────────

def split_text(text: str, max_len: int = MAX_LEN) -> list[str]:
    """将超长文字按段落拆分，优先从换行处切割。"""
    if len(text) <= max_len:
        return [text]
    chunks = []
    while text:
        if len(text) <= max_len:
            chunks.append(text)
            break
        split_at = text.rfind("\n", 0, max_len)
        if split_at < max_len * 0.3:
            split_at = max_len
        chunks.append(text[:split_at])
        text = text[split_at:].lstrip("\n")
    return chunks


# ── 核心异步 API 类 ───────────────────────────────────────────────────────────

class AsyncWeChatAPI:
    """
    封装 ilink Bot 的三个核心接口（异步 httpx 版）。

    使用方式：
        api = AsyncWeChatAPI(bot_token="your_token")
        resp = await api.get_updates()
        await api.send_text(account_id, to_user, ctx_token, "你好")
    """

    def __init__(self, bot_token: str, base_url: str = BASE_URL):
        self.bot_token = bot_token
        self.base_url = base_url.rstrip("/")

    def _headers(self) -> dict:
        """构造每次请求必需的认证头。"""
        return {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.bot_token}",
            "AuthorizationType": "ilink_bot_token",
            "X-WECHAT-UIN": _gen_uin(),
        }

    async def _post(self, path: str, body: dict, timeout: int = 40) -> dict:
        """通用异步 POST 请求，返回解析后的 JSON。"""
        url = f"{self.base_url}/{path}"
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(url, json=body, headers=self._headers())
            resp.raise_for_status()
            return resp.json()

    # ── 接口1：拉取消息（长轮询） ─────────────────────────────────────────────

    async def get_updates(self, sync_buf: str | None = None) -> dict:
        """
        长轮询拉取新消息，服务端最多等待 ~30 秒后返回。

        参数：
            sync_buf: 上次返回的游标字符串（首次传 None）

        返回：
            {
              "ret": 0,
              "get_updates_buf": "...",   # 下次调用时传入
              "msgs": [...]               # 新消息列表，可能为空
            }
        """
        body = {"get_updates_buf": sync_buf} if sync_buf else {}
        return await self._post("ilink/bot/getupdates", body, timeout=40)

    # ── 接口2：发送文字消息 ───────────────────────────────────────────────────

    async def send_text(
        self,
        bot_account_id: str,
        to_user_id: str,
        context_token: str,
        text: str,
    ) -> dict:
        """
        发送文字消息给指定用户。

        参数：
            bot_account_id: 登录后得到的 account_id（ilink_bot_id）
            to_user_id:     目标用户的 ilink_user_id
            context_token:  从收到的消息中取出，用于关联会话
            text:           要发送的文字内容
        """
        body = {
            "msg": {
                "from_user_id": bot_account_id,
                "to_user_id": to_user_id,
                "client_id": _gen_client_id(),
                "message_type": MessageType.BOT,
                "message_state": MessageState.FINISH,
                "context_token": context_token,
                "item_list": [
                    {
                        "type": MessageItemType.TEXT,
                        "text_item": {"text": text},
                    }
                ],
            }
        }
        return await self._post("ilink/bot/sendmessage", body)

    # ── 辅助：从消息 item_list 中提取文本 ────────────────────────────────────

    @staticmethod
    def extract_text(msg: dict) -> str:
        """从 WeixinMessage 对象中提取所有文字内容，拼接返回。"""
        texts = []
        for item in msg.get("item_list") or []:
            if item.get("type") == MessageItemType.TEXT:
                texts.append(item.get("text_item", {}).get("text", ""))
        return "\n".join(filter(None, texts))

    @staticmethod
    def split_text(text: str, max_len: int = MAX_LEN) -> list[str]:
        """将超长文字按段落拆分。"""
        return split_text(text, max_len)
