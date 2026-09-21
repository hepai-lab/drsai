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
import binascii
import hashlib
import json
import os
import secrets
import time
import uuid
from urllib.parse import quote, urlparse

import httpx
from cryptography.hazmat.primitives import padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

from drsai.configs.constant import WECHAT_DIR

BASE_URL = "https://ilinkai.weixin.qq.com"
CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c"
SYNC_BUF_FILE = os.path.join(WECHAT_DIR, "sync_buf.txt")

MAX_IMAGE_BYTES = 20 * 1024 * 1024
MAX_IMAGE_CIPHERTEXT_BYTES = MAX_IMAGE_BYTES + 16

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
        parsed = urlparse(base_url)
        if parsed.scheme != "https" or parsed.hostname != "ilinkai.weixin.qq.com" or parsed.port not in (None, 443) or parsed.username or parsed.password:
            raise ValueError("Unsupported WeChat API origin")
        self.bot_token = bot_token
        self.base_url = BASE_URL
        self._typing_tickets: dict[str, tuple[str, float]] = {}

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

    async def download_image(self, item: dict) -> tuple[bytes, str]:
        """Download one trusted iLink image item and decrypt it in memory."""
        if item.get("type") != MessageItemType.IMAGE:
            raise ValueError("WeChat item is not an image")
        image = item.get("image_item") if isinstance(item.get("image_item"), dict) else {}
        media = image.get("media") if isinstance(image.get("media"), dict) else {}
        query = str(media.get("encrypt_query_param") or "")
        full_url = str(media.get("full_url") or "")
        if not query and not full_url:
            raise ValueError("WeChat image has no CDN reference")
        url = _trusted_cdn_url(full_url) if full_url else (
            f"{CDN_BASE_URL}/download?encrypted_query_param={quote(query, safe='')}"
        )
        encrypted = await self._download_bounded(url, MAX_IMAGE_CIPHERTEXT_BYTES)
        key = _image_aes_key(image, media)
        content = _decrypt_aes_ecb(encrypted, key) if key is not None else encrypted
        if not content or len(content) > MAX_IMAGE_BYTES:
            raise ValueError("WeChat image exceeds the supported size")
        return content, _image_mime(content)

    async def send_image(
        self,
        bot_account_id: str,
        to_user_id: str,
        context_token: str,
        content: bytes,
    ) -> dict:
        """Encrypt, upload and send one PNG/JPEG/GIF/WebP image."""
        if not content or len(content) > MAX_IMAGE_BYTES:
            raise ValueError("WeChat image exceeds the supported size")
        _image_mime(content)
        aes_key = secrets.token_bytes(16)
        ciphertext = _encrypt_aes_ecb(content, aes_key)
        file_key = secrets.token_hex(16)
        upload = await self._post(
            "ilink/bot/getuploadurl",
            {
                "filekey": file_key,
                "media_type": 1,
                "to_user_id": to_user_id,
                "rawsize": len(content),
                "rawfilemd5": hashlib.md5(content, usedforsecurity=False).hexdigest(),
                "filesize": len(ciphertext),
                "no_need_thumb": True,
                "aeskey": aes_key.hex(),
                "base_info": {"channel_version": "1.0.0"},
            },
            timeout=20,
        )
        upload_full_url = str(upload.get("upload_full_url") or "")
        upload_param = str(upload.get("upload_param") or "")
        if upload_full_url:
            upload_url = _trusted_cdn_url(upload_full_url)
        elif upload_param:
            upload_url = (
                f"{CDN_BASE_URL}/upload?encrypted_query_param={quote(upload_param, safe='')}"
                f"&filekey={quote(file_key, safe='')}"
            )
        else:
            raise RuntimeError("WeChat image upload URL is unavailable")
        async with httpx.AsyncClient(timeout=40, follow_redirects=False) as client:
            response = await client.post(
                upload_url,
                content=ciphertext,
                headers={"Content-Type": "application/octet-stream"},
            )
            response.raise_for_status()
        download_param = response.headers.get("x-encrypted-param", "")
        if not download_param or len(download_param) > 8192:
            raise RuntimeError("WeChat image upload response is invalid")
        return await self._post(
            "ilink/bot/sendmessage",
            {
                "msg": {
                    "from_user_id": bot_account_id,
                    "to_user_id": to_user_id,
                    "client_id": _gen_client_id(),
                    "message_type": MessageType.BOT,
                    "message_state": MessageState.FINISH,
                    "context_token": context_token,
                    "item_list": [{
                        "type": MessageItemType.IMAGE,
                        "image_item": {
                            "media": {
                                "encrypt_query_param": download_param,
                                "aes_key": base64.b64encode(aes_key.hex().encode("ascii")).decode("ascii"),
                                "encrypt_type": 1,
                            },
                            "mid_size": len(ciphertext),
                        },
                    }],
                },
                "base_info": {"channel_version": "1.0.0"},
            },
            timeout=20,
        )

    @staticmethod
    async def _download_bounded(url: str, maximum: int) -> bytes:
        async with httpx.AsyncClient(timeout=40, follow_redirects=False) as client:
            async with client.stream("GET", url) as response:
                response.raise_for_status()
                declared = response.headers.get("content-length")
                if declared and int(declared) > maximum:
                    raise ValueError("WeChat image exceeds the supported size")
                chunks: list[bytes] = []
                total = 0
                async for chunk in response.aiter_bytes():
                    total += len(chunk)
                    if total > maximum:
                        raise ValueError("WeChat image exceeds the supported size")
                    chunks.append(chunk)
        return b"".join(chunks)

    async def get_typing_ticket(self, user_id: str, context_token: str) -> str:
        """Fetch and briefly cache the provider ticket required by sendtyping."""
        cached = self._typing_tickets.get(user_id)
        if cached and cached[1] > time.monotonic():
            return cached[0]
        data = await self._post(
            "ilink/bot/getconfig",
            {
                "ilink_user_id": user_id,
                "context_token": context_token,
                "base_info": {"channel_version": "1.0.0"},
            },
            timeout=10,
        )
        ticket = data.get("typing_ticket")
        if data.get("ret") not in (None, 0) or not isinstance(ticket, str) or not ticket or len(ticket) > 8192:
            raise RuntimeError("WeChat typing ticket is unavailable")
        self._typing_tickets[user_id] = (ticket, time.monotonic() + 24 * 3600)
        return ticket

    async def send_typing(self, user_id: str, typing_ticket: str, *, active: bool) -> None:
        """Show or clear WeChat's native typing indicator."""
        data = await self._post(
            "ilink/bot/sendtyping",
            {
                "ilink_user_id": user_id,
                "typing_ticket": typing_ticket,
                "status": 1 if active else 2,
                "base_info": {"channel_version": "1.0.0"},
            },
            timeout=10,
        )
        if data.get("ret") not in (None, 0):
            raise RuntimeError("WeChat typing indicator was rejected")

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
    def extract_images(msg: dict) -> list[dict]:
        """Return image items without exposing their CDN credentials elsewhere."""
        return [
            item for item in (msg.get("item_list") or [])
            if isinstance(item, dict) and item.get("type") == MessageItemType.IMAGE
        ]

    @staticmethod
    def split_text(text: str, max_len: int = MAX_LEN) -> list[str]:
        """将超长文字按段落拆分。"""
        return split_text(text, max_len)


def _trusted_cdn_url(value: str) -> str:
    parsed = urlparse(value)
    if (
        parsed.scheme != "https"
        or parsed.hostname != "novac2c.cdn.weixin.qq.com"
        or parsed.port not in (None, 443)
        or parsed.username
        or parsed.password
        or not parsed.path.startswith("/c2c/")
    ):
        raise ValueError("Unsupported WeChat CDN URL")
    return value


def _image_aes_key(image: dict, media: dict) -> bytes | None:
    legacy = image.get("aeskey")
    if isinstance(legacy, str) and legacy:
        try:
            key = bytes.fromhex(legacy)
        except ValueError as exc:
            raise ValueError("WeChat image AES key is invalid") from exc
        if len(key) != 16:
            raise ValueError("WeChat image AES key is invalid")
        return key
    encoded = media.get("aes_key")
    if not isinstance(encoded, str) or not encoded:
        return None
    try:
        decoded = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("WeChat image AES key is invalid") from exc
    if len(decoded) == 16:
        return decoded
    if len(decoded) == 32:
        try:
            key = bytes.fromhex(decoded.decode("ascii"))
        except (UnicodeDecodeError, ValueError) as exc:
            raise ValueError("WeChat image AES key is invalid") from exc
        if len(key) == 16:
            return key
    raise ValueError("WeChat image AES key is invalid")


def _encrypt_aes_ecb(content: bytes, key: bytes) -> bytes:
    padder = padding.PKCS7(128).padder()
    padded = padder.update(content) + padder.finalize()
    encryptor = Cipher(algorithms.AES(key), modes.ECB()).encryptor()
    return encryptor.update(padded) + encryptor.finalize()


def _decrypt_aes_ecb(content: bytes, key: bytes) -> bytes:
    if not content or len(content) % 16:
        raise ValueError("WeChat image ciphertext is invalid")
    decryptor = Cipher(algorithms.AES(key), modes.ECB()).decryptor()
    padded = decryptor.update(content) + decryptor.finalize()
    try:
        unpadder = padding.PKCS7(128).unpadder()
        return unpadder.update(padded) + unpadder.finalize()
    except ValueError as exc:
        raise ValueError("WeChat image ciphertext is invalid") from exc


def _image_mime(content: bytes) -> str:
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if content.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if content.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if len(content) >= 12 and content.startswith(b"RIFF") and content[8:12] == b"WEBP":
        return "image/webp"
    raise ValueError("WeChat image format is unsupported")
