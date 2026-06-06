"""
cc_bridge_v3.py — Zulip <-> Claude Code 桥接器（SDK 多轮版）
=============================================================
与 v2 的区别：
  - 修复多次输出拼接时缺少换行的问题：
    不同 AssistantMessage 之间自动补 \n\n

依赖：
  pip install zulip claude-code-sdk
"""

import asyncio
import os
import sys
import time
import threading
from collections import defaultdict

import zulip
from claude_code_sdk import query, ClaudeCodeOptions
from claude_code_sdk.types import AssistantMessage, ResultMessage, TextBlock


# ── 配置 ──────────────────────────────────────────────────────────────────────

ZULIPRC_PATH = os.environ.get("ZULIPRC", os.path.expanduser("~/.zuliprc"))
WORKDIR      = os.environ.get("CLAUDE_WORKDIR", os.path.expanduser("~/VSProjects/drsai"))

HELP_TEXT = (
    "**Claude Code Zulip Bridge v3**\n\n"
    "- 私聊：直接发消息即可\n"
    "- 频道：使用 `@**bot名**` 提及我\n\n"
    "命令：\n"
    "- `/help`  显示此帮助\n"
    "- `/ping`  连通性测试\n"
    "- `/reset` 清空当前会话（重新开始，新的 session）\n"
    "- `/clear` 同 /reset"
)


# ── 会话管理 ──────────────────────────────────────────────────────────────────

class Sessions:
    """存储 Zulip 对话 key → Claude session_id 的映射。"""

    def __init__(self):
        self._store: dict[str, str] = {}
        self._lock = threading.Lock()

    @staticmethod
    def key(msg: dict) -> str:
        if msg["type"] == "private":
            ids = sorted(r["id"] for r in msg["display_recipient"])
            return f"dm:{'-'.join(map(str, ids))}"
        return f"stream:{msg['stream_id']}:{msg['subject']}"

    def get(self, key: str) -> str | None:
        with self._lock:
            return self._store.get(key)

    def set(self, key: str, session_id: str) -> None:
        with self._lock:
            self._store[key] = session_id

    def reset(self, key: str) -> None:
        with self._lock:
            self._store.pop(key, None)


# ── Claude SDK 调用 ──────────────────────────────────────────────────────────

async def call_claude_sdk(prompt: str, session_id: str | None, workdir: str):
    """
    调用 claude_code_sdk.query()，async generator 产出 (text_chunk, final_session_id)。
    - session_id=None  → 开新会话
    - session_id=<id>  → 恢复已有会话（真正多轮）
    最后一条 yield 的 final_session_id 为本次会话 ID，之前的为 None。
    """
    options = ClaudeCodeOptions(
        resume=session_id,                    # None 表示新会话，有值表示恢复
        permission_mode="bypassPermissions",
        cwd=workdir,
        max_turns=10,                         # 允许 claude 自主多步操作
    )

    text_parts: list[str] = []
    new_session_id: str | None = None

    async for event in query(prompt=prompt, options=options):
        if isinstance(event, AssistantMessage):
            msg_chunks: list[str] = []
            for block in event.content:
                if isinstance(block, TextBlock) and block.text:
                    msg_chunks.append(block.text)
            if msg_chunks:
                # 上一条消息末尾若无换行，则补 \n\n 再拼本条
                sep = "\n\n" if text_parts and not text_parts[-1].endswith("\n") else ""
                combined = "".join(msg_chunks)
                text_parts.append(combined)
                yield sep + combined, None
        elif isinstance(event, ResultMessage):
            new_session_id = event.session_id
            if event.is_error and not text_parts:
                yield f"⚠️ Claude 执行出错 (session={event.session_id})", event.session_id
                return

    yield "", new_session_id  # 最后一条携带 session_id


# ── 消息处理 ─────────────────────────────────────────────────────────────────

def should_respond(msg: dict, bot_user_id: int) -> tuple[bool, str]:
    if msg["sender_id"] == bot_user_id:
        return False, ""

    content = msg["content"].strip()

    if msg["type"] == "private":
        return True, content

    if "is_mentioned" in msg.get("flags", []):
        cleaned, i = [], 0
        while i < len(content):
            if content[i:i+3] == "@**":
                end = content.find("**", i + 3)
                if end != -1:
                    i = end + 2
                    continue
            cleaned.append(content[i])
            i += 1
        return True, "".join(cleaned).strip()

    return False, ""


def reply_target(msg: dict) -> dict:
    if msg["type"] == "private":
        return {"type": "private", "to": list({r["id"] for r in msg["display_recipient"]})}
    return {"type": "stream", "to": msg["stream_id"], "topic": msg["subject"]}


def send_message(zclient: zulip.Client, target: dict, content: str) -> int | None:
    resp = zclient.send_message({**target, "content": content})
    if resp.get("result") != "success":
        print(f"[错误] 发送失败: {resp}", file=sys.stderr)
        return None
    return resp["id"]


def update_message(zclient: zulip.Client, msg_id: int, content: str) -> None:
    zclient.update_message({"message_id": msg_id, "content": content})


async def handle_async(zclient: zulip.Client, sessions: Sessions, msg: dict) -> None:
    bot_user_id = zclient.get_profile()["user_id"]
    respond, user_text = should_respond(msg, bot_user_id)
    print(f"[msg] type={msg.get('type')} from={msg.get('sender_email')} respond={respond}", flush=True)

    if not respond:
        return

    key = Sessions.key(msg)
    target = reply_target(msg)

    if user_text in ("/help",):
        send_message(zclient, target, HELP_TEXT)
        return
    if user_text in ("/ping",):
        send_message(zclient, target, "pong 🏓")
        return
    if user_text in ("/reset", "/clear"):
        old = sessions.get(key)
        sessions.reset(key)
        send_message(zclient, target, f"✅ 已清空会话上下文（旧 session: `{old}`）。")
        return
    if not user_text:
        send_message(zclient, target, "_(消息为空，发送 `/help` 查看用法)_")
        return

    session_id = sessions.get(key)
    print(f"[claude] key={key} resume={session_id} prompt={repr(user_text[:60])}", flush=True)

    # 发占位消息，之后流式更新
    placeholder_id = send_message(zclient, target, "_思考中..._")
    if placeholder_id is None:
        return

    buf: list[str] = []
    last_edit = 0.0
    EDIT_INTERVAL = 0.8
    new_session_id: str | None = None

    try:
        async for chunk, sid in call_claude_sdk(user_text, session_id, WORKDIR):
            if sid is not None:
                new_session_id = sid
            if chunk:
                buf.append(chunk)
                now = time.monotonic()
                if now - last_edit >= EDIT_INTERVAL:
                    update_message(zclient, placeholder_id, "".join(buf))
                    last_edit = now

        final = "".join(buf).strip() or "_(空回复)_"
        update_message(zclient, placeholder_id, final)
        print(f"[claude] done session={new_session_id} reply={repr(final[:80])}", flush=True)

        if new_session_id:
            sessions.set(key, new_session_id)

    except Exception as e:
        err = f"⚠️ 处理出错: {e}"
        print(err, file=sys.stderr, flush=True)
        update_message(zclient, placeholder_id, err)


def handle(zclient: zulip.Client, sessions: Sessions, msg: dict) -> None:
    """在独立线程中运行 async 处理逻辑。"""
    asyncio.run(handle_async(zclient, sessions, msg))


# ── 主入口 ────────────────────────────────────────────────────────────────────

def run_bot() -> None:
    if not os.path.exists(ZULIPRC_PATH):
        print(f"找不到 zuliprc: {ZULIPRC_PATH}", file=sys.stderr)
        sys.exit(1)

    zclient  = zulip.Client(config_file=ZULIPRC_PATH)
    profile  = zclient.get_profile()
    sessions = Sessions()

    print("=" * 60)
    print(f"Claude Code Zulip Bridge v3 (SDK 多轮版) 启动")
    print(f"  bot:     {profile['full_name']} (id={profile['user_id']})")
    print(f"  workdir: {WORKDIR}")
    print("=" * 60)

    def on_message(msg: dict) -> None:
        t = threading.Thread(
            target=handle, args=(zclient, sessions, msg), daemon=True
        )
        t.start()

    while True:
        try:
            zclient.call_on_each_message(on_message)
        except KeyboardInterrupt:
            print("[bridge] 收到 Ctrl+C，退出。", flush=True)
            break
        except Exception as e:
            print(f"[bridge] error: {e}, reconnecting in 5s...", flush=True)
            time.sleep(5)


if __name__ == "__main__":
    run_bot()
