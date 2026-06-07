"""
cc_bridge.py — Zulip <-> Claude Code 桥接器
=============================================
原理：
  使用 Zulip 官方 Python SDK 的长轮询监听消息，
  把消息通过 `claude -p` 调用 Claude Code CLI，
  再把回复发回 Zulip。

支持：
  - 私聊 (private message): 自动回复
  - 频道消息 (stream): 仅在 @-mention bot 时回复
  - 流式输出（边生成边 update_message）
  - 命令: /help /ping /reset /clear

使用方式：
  1. 确保 ~/.zuliprc 存在（bot 配置）
  2. 确保 claude CLI 可用 (which claude)
  3. 运行: python cc_bridge.py
     或指定配置: ZULIPRC=~/.zuliprc python cc_bridge.py
"""

import os
import sys
import signal
import time
import subprocess
import threading
from collections import defaultdict, deque

import zulip


# ── 配置 ───────────────────────────────────────────────────────────────────────

ZULIPRC_PATH = os.environ.get("ZULIPRC", os.path.expanduser("~/.zuliprc"))
CLAUDE_BIN = os.environ.get("CLAUDE_BIN", "claude")
CLAUDE_FLAGS = os.environ.get("CLAUDE_FLAGS", "--dangerously-skip-permissions").split()
WORKDIR = os.environ.get("CLAUDE_WORKDIR", os.path.expanduser("~/VSProjects/drsai"))

HISTORY_TURNS = int(os.environ.get("HISTORY_TURNS", "20"))
STREAM_EDIT_INTERVAL = 0.8  # 流式编辑最小间隔（秒），避免 Zulip 限流

HELP_TEXT = (
    "**Claude Code Zulip Bridge**\n\n"
    "- 私聊：直接发消息即可\n"
    "- 频道：使用 `@**bot名**` 提及我\n\n"
    "命令：\n"
    "- `/help`  显示此帮助\n"
    "- `/ping`  连通性测试\n"
    "- `/reset` 清空当前会话上下文\n"
    "- `/clear` 同 /reset"
)


# ── 会话上下文 ─────────────────────────────────────────────────────────────────

class Conversations:
    """按会话维护对话历史，传给 claude --append-system-prompt 模拟多轮上下文。"""

    def __init__(self, max_turns: int):
        self._store: dict[str, deque] = defaultdict(lambda: deque(maxlen=max_turns * 2))
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

    def history_prompt(self, key: str) -> str:
        """把历史拼成 system prompt 追加，让 claude 知道上下文。"""
        with self._lock:
            items = list(self._store[key])
        if not items:
            return ""
        lines = ["以下是本次会话的历史对话，请参考上下文继续回答：\n"]
        for item in items:
            prefix = "用户" if item["role"] == "user" else "助手"
            lines.append(f"{prefix}: {item['content']}")
        return "\n".join(lines)

    def reset(self, key: str) -> None:
        with self._lock:
            self._store.pop(key, None)


# ── 调用 Claude Code CLI ───────────────────────────────────────────────────────

def call_claude(prompt: str, history_prompt: str = "") -> tuple[str, bool]:
    """
    调用 `claude -p <prompt>`，返回 (输出文本, 是否成功)。
    流式输出通过 subprocess 的 stdout 逐行读取。
    """
    cmd = [CLAUDE_BIN, "-p", prompt] + CLAUDE_FLAGS
    if history_prompt:
        cmd += ["--append-system-prompt", history_prompt]

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            cwd=WORKDIR,
            timeout=300,
        )
        output = result.stdout.strip()
        if result.returncode != 0 and not output:
            error = result.stderr.strip()
            return f"⚠️ Claude 执行出错:\n```\n{error}\n```", False
        return output or "_(空回复)_", True
    except subprocess.TimeoutExpired:
        return "⚠️ Claude 响应超时（>5分钟）", False
    except FileNotFoundError:
        return f"⚠️ 找不到 claude 命令: {CLAUDE_BIN}", False
    except Exception as e:
        return f"⚠️ 调用失败: {e}", False


def call_claude_stream(prompt: str, history_prompt: str = ""):
    """调用 claude -p，yield 最终输出（一次性读取，避免流式缓冲问题）。"""
    cmd = [CLAUDE_BIN, "-p", prompt] + CLAUDE_FLAGS
    if history_prompt:
        cmd += ["--append-system-prompt", history_prompt]

    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd=WORKDIR,
            preexec_fn=lambda: signal.signal(signal.SIGINT, signal.SIG_IGN),
        )
        stdout, stderr = proc.communicate(timeout=300)
        if stdout.strip():
            yield stdout
        elif proc.returncode != 0:
            yield f"⚠️ Claude 执行出错:\n```\n{stderr.strip()}\n```"
        else:
            yield "_(空回复)_"
    except subprocess.TimeoutExpired:
        proc.kill()
        yield "⚠️ Claude 响应超时（>5分钟）"
    except FileNotFoundError:
        yield f"⚠️ 找不到 claude 命令: {CLAUDE_BIN}"
    except Exception as e:
        yield f"⚠️ 调用失败: {e}"


# ── 消息处理 ───────────────────────────────────────────────────────────────────

def should_respond(msg: dict, bot_user_id: int, bot_full_name: str) -> tuple[bool, str]:
    """返回 (是否回复, 清洗后的用户输入)。"""
    if msg["sender_id"] == bot_user_id:
        return False, ""

    content = msg["content"].strip()

    if msg["type"] == "private":
        return True, content

    # stream 消息：必须 @mention bot
    if "is_mentioned" in msg.get("flags", []):
        # 去掉 @**...** 提及
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
    if msg["type"] == "private":
        recipients = list({r["id"] for r in msg["display_recipient"]})
        return {"type": "private", "to": recipients}
    return {"type": "stream", "to": msg["stream_id"], "topic": msg["subject"]}


def send_message(zclient: zulip.Client, target: dict, content: str) -> None:
    resp = zclient.send_message({**target, "content": content})
    if resp.get("result") != "success":
        print(f"[错误] 发送失败: {resp}", file=sys.stderr)


def stream_reply(zclient: zulip.Client, target: dict, chunks) -> str:
    """先发占位消息，再周期性 update_message 实现流式效果。"""
    placeholder = zclient.send_message({**target, "content": "_思考中..._"})
    if placeholder.get("result") != "success":
        raise RuntimeError(f"send_message 失败: {placeholder}")
    msg_id = placeholder["id"]

    buf = []
    last_edit = 0.0
    for piece in chunks:
        buf.append(piece)
        now = time.monotonic()
        if now - last_edit >= STREAM_EDIT_INTERVAL:
            zclient.update_message({"message_id": msg_id, "content": "".join(buf)})
            last_edit = now

    final = "".join(buf).strip() or "_(空回复)_"
    zclient.update_message({"message_id": msg_id, "content": final})
    return final


# ── 主入口 ─────────────────────────────────────────────────────────────────────

def run_bot() -> None:
    if not os.path.exists(ZULIPRC_PATH):
        print(f"找不到 zuliprc: {ZULIPRC_PATH}", file=sys.stderr)
        sys.exit(1)

    zclient = zulip.Client(config_file=ZULIPRC_PATH)
    profile = zclient.get_profile()
    bot_user_id = profile["user_id"]
    bot_full_name = profile["full_name"]
    conv = Conversations(max_turns=HISTORY_TURNS)

    print("=" * 60)
    print(f"Claude Code Zulip Bridge 启动")
    print(f"  bot:     {bot_full_name} (id={bot_user_id})")
    print(f"  claude:  {CLAUDE_BIN} {' '.join(CLAUDE_FLAGS)}")
    print(f"  workdir: {WORKDIR}")
    print("=" * 60)

    def handle(msg: dict) -> None:
        respond, user_text = should_respond(msg, bot_user_id, bot_full_name)
        print(f"[msg] type={msg.get('type')} from={msg.get('sender_email')} respond={respond}", flush=True)
        if not respond:
            return

        key = Conversations.key(msg)
        target = reply_target(msg)

        if user_text in ("/help",):
            send_message(zclient, target, HELP_TEXT)
            return
        if user_text in ("/ping",):
            send_message(zclient, target, "pong 🏓")
            return
        if user_text in ("/reset", "/clear"):
            conv.reset(key)
            send_message(zclient, target, "✅ 已清空当前会话上下文。")
            return
        if not user_text:
            send_message(zclient, target, "_(消息为空，发送 `/help` 查看用法)_")
            return

        history = conv.history_prompt(key)
        conv.append(key, "user", user_text)
        print(f"[claude] invoking for: {repr(user_text[:50])}", flush=True)

        try:
            chunks = call_claude_stream(user_text, history)
            final = stream_reply(zclient, target, chunks)
            print(f"[claude] replied: {repr(final[:80])}", flush=True)
            conv.append(key, "assistant", final)
        except Exception as e:
            err = f"⚠️ 处理出错: {e}"
            print(err, file=sys.stderr, flush=True)
            send_message(zclient, target, err)

    def on_message(msg: dict) -> None:
        t = threading.Thread(target=handle, args=(msg,), daemon=True)
        t.start()

    while True:
        try:
            zclient.call_on_each_message(on_message)
        except KeyboardInterrupt:
            print("[bridge] SIGINT ignored, reconnecting...", flush=True)
        except Exception as e:
            print(f"[bridge] error: {e}, reconnecting in 5s...", flush=True)
            time.sleep(5)


if __name__ == "__main__":
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    run_bot()
