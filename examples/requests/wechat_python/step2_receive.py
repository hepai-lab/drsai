"""
step2_receive.py — 步骤二：长轮询接收微信消息
===============================================
原理：
  ilink bot 使用"长轮询"（Long Polling）模式推送消息：
    - 客户端发送 POST /ilink/bot/getupdates，服务端最多等待 ~30 秒
    - 如果有新消息立即返回，否则超时后返回空列表
    - 每次返回都包含新的 get_updates_buf（游标），下次请求必须带上它
    - 游标丢失会导致重复收到历史消息

  消息结构（WeixinMessage）：
    {
      "message_id":   123,           # 消息唯一 ID（用于去重）
      "from_user_id": "xxx",         # 发送方 ilink user ID
      "message_type": 1,             # 1=用户, 2=Bot
      "context_token": "yyy",        # 会话 token，回复时必须携带
      "item_list": [
        {
          "type": 1,                 # 1=文字, 2=图片, 3=语音, 4=文件
          "text_item": {"text": "你好"}
        }
      ]
    }

使用方式：
    # 先完成步骤一获取凭据
    python step2_receive.py
"""

import time
import os
import json
import signal
import sys

from wechat_api import WeChatAPI, MessageType
from step1_login import load_credentials

SYNC_BUF_FILE = os.path.join(os.path.dirname(__file__), "sync_buf.txt")

# 最多缓存最近 1000 条消息 ID 用于去重
MAX_DEDUP_SIZE = 1000

# 连续失败次数达到阈值后，延长重试间隔
BACKOFF_THRESHOLD = 3
BACKOFF_SHORT_MS = 3
BACKOFF_LONG_MS = 30


# ── 游标持久化 ─────────────────────────────────────────────────────────────────

def load_sync_buf() -> str:
    """从本地文件加载消息游标（程序重启后可从上次中断处继续）。"""
    try:
        with open(SYNC_BUF_FILE, encoding="utf-8") as f:
            return f.read().strip()
    except FileNotFoundError:
        return ""


def save_sync_buf(buf: str) -> None:
    """持久化消息游标，防止重启后重复收到历史消息。"""
    with open(SYNC_BUF_FILE, "w", encoding="utf-8") as f:
        f.write(buf)


# ── 消息处理回调 ───────────────────────────────────────────────────────────────

def handle_message(msg: dict, api: WeChatAPI, creds: dict) -> None:
    """
    处理收到的单条消息（在此自定义你的业务逻辑）。

    参数：
        msg   : WeixinMessage 字典
        api   : WeChatAPI 实例（用于回复）
        creds : 登录凭据（含 account_id、user_id）
    """
    # 只处理用户发来的消息，忽略 Bot 自己发的
    if msg.get("message_type") != MessageType.USER:
        return

    from_user = msg.get("from_user_id", "")
    context_token = msg.get("context_token", "")

    # 提取消息文本
    text = WeChatAPI.extract_text(msg)

    # 打印收到的消息
    msg_id = msg.get("message_id", "?")
    print(f"\n[消息 #{msg_id}]")
    print(f"  来自: {from_user}")
    print(f"  内容: {text!r}" if text else "  内容: [非文字消息]")
    print(f"  context_token: {context_token}")

    # ── 在这里添加你的处理逻辑 ──────────────────────────────────────
    # 示例：打印消息内容（后续步骤会扩展为自动回复）
    # api.send_text(creds["account_id"], from_user, context_token, f"收到: {text}")
    # ────────────────────────────────────────────────────────────────


# ── 主轮询循环 ─────────────────────────────────────────────────────────────────

def run_monitor(api: WeChatAPI, creds: dict) -> None:
    """
    持续长轮询，收到消息后调用 handle_message。

    关键细节：
      1. sync_buf（游标）每次响应后必须更新保存
      2. message_id 去重：同一条消息可能被重复推送
      3. ret == -14 表示 session 过期，需要重新扫码
      4. 连续失败时指数退避，避免刷流量
    """
    sync_buf = load_sync_buf()
    seen_ids: set[int] = set()
    consecutive_failures = 0

    print(f"开始监听消息（账号: {creds['account_id']}）")
    print("按 Ctrl+C 停止\n")

    while True:
        try:
            resp = api.get_updates(sync_buf or None)
        except KeyboardInterrupt:
            print("\n已停止。")
            break
        except Exception as e:
            consecutive_failures += 1
            wait = BACKOFF_LONG_MS if consecutive_failures >= BACKOFF_THRESHOLD else BACKOFF_SHORT_MS
            print(f"[错误] {e}（第{consecutive_failures}次失败，{wait}秒后重试）")
            time.sleep(wait)
            continue

        # ── 检查返回码 ──
        ret = resp.get("ret")
        if ret == -14:
            print("[警告] session 已过期，请重新运行 step1_login.py 扫码")
            time.sleep(3600)  # 1小时后重试（或手动重启）
            continue
        if ret not in (None, 0):
            print(f"[警告] getupdates 返回异常: ret={ret}, msg={resp.get('retmsg')}")

        # ── 更新游标（不管 ret 如何，只要有就保存） ──
        new_buf = resp.get("get_updates_buf")
        if new_buf:
            sync_buf = new_buf
            save_sync_buf(sync_buf)

        # ── 处理消息 ──
        msgs = resp.get("msgs") or []
        if msgs:
            print(f"[收到 {len(msgs)} 条消息]")

        for msg in msgs:
            msg_id = msg.get("message_id")

            # 去重
            if msg_id and msg_id in seen_ids:
                continue
            if msg_id:
                seen_ids.add(msg_id)
                if len(seen_ids) > MAX_DEDUP_SIZE:
                    # 删除最旧的一半（set 无序，取 list 后删前半）
                    to_remove = list(seen_ids)[:MAX_DEDUP_SIZE // 2]
                    seen_ids.difference_update(to_remove)

            try:
                handle_message(msg, api, creds)
            except Exception as e:
                print(f"[错误] 处理消息 {msg_id} 时出错: {e}")

        consecutive_failures = 0


def main():
    print("=" * 50)
    print("步骤二：接收微信消息")
    print("=" * 50)

    creds = load_credentials()
    api = WeChatAPI(creds["bot_token"], creds.get("base_url", "https://ilinkai.weixin.qq.com"))
    run_monitor(api, creds)


if __name__ == "__main__":
    main()
