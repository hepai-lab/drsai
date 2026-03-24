"""
wechat_api.py — ilink Bot API 核心封装
========================================
原理：
  微信个人号通过 ilink bot 协议开放了一套 REST API（ilinkai.weixin.qq.com）。
  每次请求需要携带 bot_token（通过扫码登录获取），使用 Bearer 认证。

三个核心接口：
  1. POST /ilink/bot/getupdates     —— 长轮询拉取新消息
  2. POST /ilink/bot/sendmessage    —— 向用户发送消息
  3. GET  /ilink/bot/get_bot_qrcode —— 获取登录二维码（登录时使用）
"""

import secrets
import base64
import time
import uuid
import requests
from typing import Optional


BASE_URL = "https://ilinkai.weixin.qq.com"

# ── 消息类型常量 ──────────────────────────────────────────────────────────────

class MessageType:
    USER = 1   # 用户发来的消息
    BOT  = 2   # Bot（我们）发出的消息

class MessageItemType:
    TEXT  = 1  # 文字
    IMAGE = 2  # 图片
    VOICE = 3  # 语音
    FILE  = 4  # 文件
    VIDEO = 5  # 视频

class MessageState:
    NEW        = 0
    GENERATING = 1
    FINISH     = 2  # 发送时设为 FINISH 表示完整消息


def _gen_uin() -> str:
    """生成随机 X-WECHAT-UIN（4字节随机数的 base64），用于请求头。"""
    return base64.b64encode(secrets.token_bytes(4)).decode()


def _gen_client_id() -> str:
    """生成唯一 client_id，防止重复发送。"""
    return f"py-bot-{int(time.time() * 1000)}-{uuid.uuid4().hex[:8]}"


class WeChatAPI:
    """
    封装 ilink Bot 的三个核心接口。

    使用方式：
        api = WeChatAPI(bot_token="your_token")
        resp = api.get_updates()          # 拉消息
        api.send_text(to, ctx, "你好")    # 发消息
    """

    def __init__(self, bot_token: str, base_url: str = BASE_URL):
        self.bot_token = bot_token
        self.base_url = base_url.rstrip("/")
        self._session = requests.Session()

    def _headers(self) -> dict:
        """构造每次请求必需的认证头。"""
        return {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.bot_token}",
            "AuthorizationType": "ilink_bot_token",
            "X-WECHAT-UIN": _gen_uin(),
        }

    def _post(self, path: str, body: dict, timeout: int = 15) -> dict:
        """通用 POST 请求，返回解析后的 JSON。"""
        url = f"{self.base_url}/{path}"
        resp = self._session.post(url, json=body, headers=self._headers(), timeout=timeout)
        resp.raise_for_status()
        return resp.json()

    # ── 接口1：拉取消息（长轮询） ─────────────────────────────────────────────

    def get_updates(self, sync_buf: Optional[str] = None) -> dict:
        """
        长轮询拉取新消息，服务端最多等待 ~30 秒后返回。

        参数：
            sync_buf: 上次返回的游标字符串（首次传 None）

        返回示例：
            {
              "ret": 0,
              "get_updates_buf": "...",   # 下次调用时传入
              "msgs": [...]               # 新消息列表，可能为空
            }

        重要：get_updates_buf 必须持久化，下次调用时传回，否则会重复收到历史消息。
        """
        body = {"get_updates_buf": sync_buf} if sync_buf else {}
        return self._post("ilink/bot/getupdates", body, timeout=40)

    # ── 接口2：发送文字消息 ───────────────────────────────────────────────────

    def send_text(self, bot_account_id: str, to_user_id: str,
                  context_token: str, text: str) -> dict:
        """
        发送文字消息给指定用户。

        参数：
            bot_account_id: 登录后得到的 accountId（ilink_bot_id）
            to_user_id:     目标用户的 ilink_user_id
            context_token:  从收到的消息中取出，用于关联会话
            text:           要发送的文字内容
        """
        body = {
            "msg": {
                "from_user_id": bot_account_id,    # Bot 自己的 ID
                "to_user_id": to_user_id,           # 接收方用户 ID
                "client_id": _gen_client_id(),      # 唯一消息 ID，防重
                "message_type": MessageType.BOT,
                "message_state": MessageState.FINISH,
                "context_token": context_token,     # 从入站消息里取
                "item_list": [
                    {
                        "type": MessageItemType.TEXT,
                        "text_item": {"text": text},
                    }
                ],
            }
        }
        return self._post("ilink/bot/sendmessage", body)

    # ── 辅助：从消息 item_list 中提取文本 ────────────────────────────────────

    @staticmethod
    def extract_text(msg: dict) -> str:
        """从 WeixinMessage 对象中提取所有文字内容，拼接返回。"""
        texts = []
        for item in msg.get("item_list") or []:
            if item.get("type") == MessageItemType.TEXT:
                texts.append(item.get("text_item", {}).get("text", ""))
        return "\n".join(filter(None, texts))
