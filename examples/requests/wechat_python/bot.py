"""
bot.py — 完整 Bot 示例：接收消息 + 自动回复
=============================================
原理：
  将步骤二（接收）和步骤三（发送）组合成一个可运行的 Bot。
  收到用户消息后，自动回复处理结果。

功能示例（可自定义扩展）：
  - /help       —— 显示帮助
  - /echo <内容> —— 复读消息
  - /ping       —— 回复 pong
  - 其他文字    —— 直接回显（可替换为调用 Claude API 等）

使用方式：
    # 先完成步骤一登录
    python step1_login.py

    # 然后运行 Bot
    python bot.py

架构图：
    微信手机 ──发消息──> ilink API ──长轮询──> bot.py ──处理──> 回复
                                                    |
                                              自定义逻辑
                                         （命令/AI接口/数据库等）
"""

import time
import os

from wechat_api import WeChatAPI, MessageType
from step1_login import load_credentials
from step2_receive import load_sync_buf, save_sync_buf, MAX_DEDUP_SIZE
from step3_send import _split_text, MAX_LEN

# ── Bot 配置 ───────────────────────────────────────────────────────────────────

BOT_NAME = "Python Bot"

HELP_TEXT = f"""
{BOT_NAME} 命令列表：
/help      —— 显示此帮助
/echo <内容> —— 复读你发的内容
/ping      —— 测试连通性
/info      —— 查看当前账号信息
其他内容   —— Bot 会原样回复（Echo 模式）
""".strip()


# ── 命令处理器 ─────────────────────────────────────────────────────────────────

def process_message(text: str, from_user: str, creds: dict) -> str:
    """
    处理用户消息，返回回复文字。
    在此替换或扩展你的业务逻辑。

    参数：
        text      : 用户发来的文字
        from_user : 用户的 ilink_user_id
        creds     : 登录凭据

    返回：
        要发送的回复文字
    """
    text = text.strip()

    # ── /help ──────────────────────────────────────────────────────────────────
    if text == "/help":
        return HELP_TEXT

    # ── /ping ──────────────────────────────────────────────────────────────────
    if text == "/ping":
        return "pong 🏓"

    # ── /info ──────────────────────────────────────────────────────────────────
    if text == "/info":
        return (
            f"Bot account_id : {creds['account_id']}\n"
            f"你的 user_id   : {from_user}"
        )

    # ── /echo <内容> ────────────────────────────────────────────────────────────
    if text.startswith("/echo "):
        return text[6:].strip() or "（echo 内容为空）"

    # ── 非命令：Echo 模式（替换为你的 AI 逻辑） ──────────────────────────────
    if not text:
        return "暂不支持此类消息类型，请发送文字。"

    # 默认：原样回复（可换成调用 Claude / OpenAI 等）
    return f"[Echo] {text}"


# ── 消息处理入口 ───────────────────────────────────────────────────────────────

def handle_message(msg: dict, api: WeChatAPI, creds: dict) -> None:
    """处理单条消息，自动路由并回复。"""
    # 只处理用户消息
    if msg.get("message_type") != MessageType.USER:
        return

    from_user = msg.get("from_user_id", "")
    context_token = msg.get("context_token", "")
    text = WeChatAPI.extract_text(msg)

    msg_id = msg.get("message_id", "?")
    print(f"\n[#{msg_id}] 来自 {from_user}: {text!r}")

    # 生成回复
    try:
        reply = process_message(text, from_user, creds)
    except Exception as e:
        reply = f"⚠️ 处理出错: {e}"

    # 发送回复（自动分段）
    chunks = _split_text(reply, MAX_LEN)
    for chunk in chunks:
        try:
            api.send_text(creds["account_id"], from_user, context_token, chunk)
            print(f"  -> 已回复: {chunk!r[:60]}{'...' if len(chunk) > 60 else ''}")
        except Exception as e:
            print(f"  [错误] 发送失败: {e}")


# ── 主循环 ─────────────────────────────────────────────────────────────────────

def run_bot():
    creds = load_credentials()
    api = WeChatAPI(creds["bot_token"], creds.get("base_url", "https://ilinkai.weixin.qq.com"))

    sync_buf = load_sync_buf()
    seen_ids: set[int] = set()
    consecutive_failures = 0

    print("=" * 50)
    print(f"{BOT_NAME} 启动")
    print(f"账号: {creds['account_id']}")
    print("发送 /help 给 Bot 查看命令列表")
    print("按 Ctrl+C 停止")
    print("=" * 50)

    while True:
        # ── 拉取消息 ──────────────────────────────────────────────────────────
        try:
            resp = api.get_updates(sync_buf or None)
        except KeyboardInterrupt:
            print("\nBot 已停止。")
            break
        except Exception as e:
            consecutive_failures += 1
            wait = 30 if consecutive_failures >= 3 else 3
            print(f"[错误] {e}（{wait}秒后重试）")
            time.sleep(wait)
            continue

        consecutive_failures = 0

        # ── 处理 session 过期 ─────────────────────────────────────────────────
        if resp.get("ret") == -14:
            print("[警告] session 过期，请重新运行 step1_login.py")
            time.sleep(3600)
            continue

        # ── 更新游标 ──────────────────────────────────────────────────────────
        if resp.get("get_updates_buf"):
            sync_buf = resp["get_updates_buf"]
            save_sync_buf(sync_buf)

        # ── 处理消息 ──────────────────────────────────────────────────────────
        for msg in resp.get("msgs") or []:
            msg_id = msg.get("message_id")
            if msg_id and msg_id in seen_ids:
                continue
            if msg_id:
                seen_ids.add(msg_id)
                if len(seen_ids) > MAX_DEDUP_SIZE:
                    to_rm = list(seen_ids)[:MAX_DEDUP_SIZE // 2]
                    seen_ids.difference_update(to_rm)
            try:
                handle_message(msg, api, creds)
            except Exception as e:
                print(f"[错误] 处理消息 {msg_id}: {e}")


if __name__ == "__main__":
    run_bot()
