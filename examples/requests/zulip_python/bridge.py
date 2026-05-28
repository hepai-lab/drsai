"""
bridge.py — Zulip <-> OpenDrSai 桥接器
======================================
原理：
  使用 Zulip 官方 Python SDK 的长轮询 (`call_on_each_message`) 监听消息，
  把消息转给 drsai 后端的 OpenAI ChatCompletions 接口，再把回复发回 Zulip。

支持：
  - 私聊 (private message): 自动回复
  - 频道消息 (stream): 仅在 @-mention 机器人时回复
  - 命令: /help /ping /reset
  - 每个会话独立维护短期上下文 (默认保留最近 20 轮)
  - 流式输出（边生成边 update_message）

使用方式：
  1. 在 Zulip Web → Personal settings → Bots 创建一个 Generic bot,
     下载 zuliprc 到本目录，命名为 `.zuliprc`。
  2. 启动 drsai 后端 (暴露 OpenAI 兼容接口):
        drsai backend --agent-config agent_config.yaml
  3. 设置环境变量 (或直接修改下方常量):
        export DRSAI_BASE_URL="http://localhost:8000/v1"
        export DRSAI_API_KEY="EMPTY"          # drsai 本地后端可填任意非空
        export DRSAI_MODEL="myassistant"      # agent_config.yaml 里的智能体名
  4. 运行: python bridge.py
"""

import os
import sys
import time
import threading
from collections import defaultdict, deque
from typing import Any

import zulip
from openai import OpenAI


# ── 配置 ───────────────────────────────────────────────────────────────────────

ZULIPRC_PATH = os.environ.get("ZULIPRC", os.path.join(os.path.dirname(__file__), ".zuliprc"))

# DRSAI_BASE_URL = os.environ.get("DRSAI_BASE_URL", "http://localhost:42858/apiv2")
DRSAI_BASE_URL = os.environ.get("DRSAI_BASE_URL", "https://aiapi.ihep.ac.cn/apiv2")
DRSAI_API_KEY = os.environ.get("HEPAI_API_KEY", "EMPTYxx")
DRSAI_MODEL = os.environ.get("DRSAI_MODEL", "My Dr.Sai")
print(f"API_KEY: {DRSAI_API_KEY}, BASE_URL: {DRSAI_BASE_URL}, MODEL: {DRSAI_MODEL}")

HISTORY_TURNS = int(os.environ.get("HISTORY_TURNS", "20"))   # 每个会话保留的最大消息条数
STREAM_REPLY = os.environ.get("STREAM_REPLY", "1") == "1"    # 是否开启流式编辑回复
STREAM_EDIT_INTERVAL = 0.6                                    # 流式编辑最小间隔 (秒)，避免触发 Zulip 限流

HELP_TEXT = (
    "**OpenDrSai Zulip Bot**\n\n"
    "- 私聊：直接发消息即可\n"
    "- 频道：使用 `@**bot-name**` 提及我\n\n"
    "命令：\n"
    "- `/help`  显示此帮助\n"
    "- `/ping`  连通性测试\n"
    "- `/reset` 清空当前会话上下文"
)


# ── 会话上下文 ─────────────────────────────────────────────────────────────────

class Conversations:
    """按会话维度维护短期消息历史。"""

    def __init__(self, max_turns: int):
        self.max_turns = max_turns
        self._store: dict[str, deque] = defaultdict(lambda: deque(maxlen=max_turns))
        self._lock = threading.Lock()

    @staticmethod
    def key(msg: dict) -> str:
        if msg["type"] == "private":
            ids = sorted(r["id"] for r in msg["display_recipient"])
            return f"dm:{'-'.join(map(str, ids))}"
        return f"stream:{msg['stream_id']}:{msg['subject']}"

    def append(self, key: str, role: str, content: str) -> None:
        with self._lock:
            self._store[key].append({"role": role, "content": content})

    def history(self, key: str) -> list[dict]:
        with self._lock:
            return list(self._store[key])

    def reset(self, key: str) -> None:
        with self._lock:
            self._store.pop(key, None)


# ── drsai 后端调用 ─────────────────────────────────────────────────────────────

def chat_completion_stream(client: OpenAI, messages: list[dict], chat_id: str, user: dict):
    """流式调用 drsai 后端，逐 chunk yield 文本。"""
    completion = client.chat.completions.create(
        model=DRSAI_MODEL,
        messages=messages,
        stream=True,
        extra_body={"chat_id": chat_id, "user": user},
    )
    for chunk in completion:
        if chunk.choices and chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content


# ── 消息处理 ───────────────────────────────────────────────────────────────────

def should_respond(msg: dict, bot_user_id: int) -> tuple[bool, str]:
    """返回 (是否回复, 清洗后的用户输入)。"""
    if msg["sender_id"] == bot_user_id:
        return False, ""

    content = msg["content"].strip()

    if msg["type"] == "private":
        return True, content

    # stream 类消息：必须 @mention 机器人才回复
    mention_token = f"@**{msg.get('bot_full_name', '')}**"
    if "is_mentioned" in msg.get("flags", []) or mention_token in content:
        # 去掉所有 @**...** 提及，避免把 mention 也喂给模型
        cleaned = []
        i = 0
        while i < len(content):
            if content[i:i + 3] == "@**":
                end = content.find("**", i + 3)
                if end != -1:
                    i = end + 2
                    continue
            cleaned.append(content[i])
            i += 1
        return True, "".join(cleaned).strip()

    return False, ""


def reply_target(msg: dict) -> dict:
    """根据来源消息构造回复用的 send_message payload (不含 content)。"""
    if msg["type"] == "private":
        recipients = [r["id"] for r in msg["display_recipient"] if r["id"] != msg["sender_id"]]
        # 把自己排除后再加上 sender，确保至少一个收件人
        recipients.append(msg["sender_id"])
        return {"type": "private", "to": list({*recipients})}
    return {"type": "stream", "to": msg["stream_id"], "topic": msg["subject"]}


def handle_command(text: str, conv: Conversations, key: str) -> str | None:
    """处理 /command。返回 None 表示不是命令。"""
    if text == "/help":
        return HELP_TEXT
    if text == "/ping":
        return "pong 🏓"
    if text == "/reset":
        conv.reset(key)
        return "✅ 已清空当前会话上下文。"
    return None


def stream_to_zulip(
    zclient: zulip.Client,
    target: dict,
    chunks,
) -> str:
    """把生成器流式写入 Zulip：先发占位消息，再周期性 update_message。"""
    placeholder = zclient.send_message({**target, "content": "_思考中..._"})
    if placeholder.get("result") != "success":
        raise RuntimeError(f"send_message failed: {placeholder}")
    msg_id = placeholder["id"]

    buf: list[str] = []
    last_edit = 0.0
    for piece in chunks:
        buf.append(piece)
        now = time.monotonic()
        if now - last_edit >= STREAM_EDIT_INTERVAL:
            zclient.update_message({"message_id": msg_id, "content": "".join(buf)})
            last_edit = now

    final = "".join(buf).strip() or "_（空回复）_"
    zclient.update_message({"message_id": msg_id, "content": final})
    return final


def send_to_zulip(zclient: zulip.Client, target: dict, content: str) -> None:
    resp = zclient.send_message({**target, "content": content})
    if resp.get("result") != "success":
        print(f"[错误] 发送失败: {resp}", file=sys.stderr)


# ── 主入口 ─────────────────────────────────────────────────────────────────────

def run_bot() -> None:
    if not os.path.exists(ZULIPRC_PATH):
        print(f"找不到 zuliprc 配置: {ZULIPRC_PATH}", file=sys.stderr)
        print("请到 Zulip → Personal settings → Bots 下载机器人配置文件。", file=sys.stderr)
        sys.exit(1)

    zclient = zulip.Client(config_file=ZULIPRC_PATH)
    profile = zclient.get_profile()
    bot_user_id = profile["user_id"]
    bot_full_name = profile["full_name"]

    ai_client = OpenAI(api_key=DRSAI_API_KEY, base_url=DRSAI_BASE_URL)
    conv = Conversations(max_turns=HISTORY_TURNS)

    print("=" * 60)
    print(f"OpenDrSai Zulip Bot 启动")
    print(f"  bot:     {bot_full_name} (id={bot_user_id})")
    print(f"  backend: {DRSAI_BASE_URL}  model={DRSAI_MODEL}")
    print(f"  stream:  {'on' if STREAM_REPLY else 'off'}")
    print("=" * 60)

    def on_message(msg: dict) -> None:
        msg["bot_full_name"] = bot_full_name
        respond, user_text = should_respond(msg, bot_user_id)
        if not respond:
            return

        key = Conversations.key(msg)
        target = reply_target(msg)

        cmd_reply = handle_command(user_text, conv, key)
        if cmd_reply is not None:
            send_to_zulip(zclient, target, cmd_reply)
            return

        if not user_text:
            send_to_zulip(zclient, target, "（消息为空，发送 `/help` 查看用法）")
            return

        conv.append(key, "user", user_text)
        messages = conv.history(key)

        user_info = {
            "name": msg.get("sender_full_name", ""),
            "email": msg.get("sender_email", ""),
        }

        try:
            chunks = chat_completion_stream(ai_client, messages, chat_id=key, user=user_info)
            if STREAM_REPLY:
                final = stream_to_zulip(zclient, target, chunks)
            else:
                final = "".join(chunks).strip() or "_（空回复）_"
                send_to_zulip(zclient, target, final)
            conv.append(key, "assistant", final)
        except Exception as e:
            err = f"⚠️ 调用 drsai 后端失败: {e}"
            print(err, file=sys.stderr)
            send_to_zulip(zclient, target, err)

    # 仅订阅消息事件；narrow=[] 接收所有可见消息（DM + 已订阅的 stream）
    zclient.call_on_each_message(on_message)


if __name__ == "__main__":
    try:
        run_bot()
    except KeyboardInterrupt:
        print("\nBot 已停止。")
