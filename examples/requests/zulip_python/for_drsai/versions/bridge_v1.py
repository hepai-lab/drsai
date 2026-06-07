"""
bridge_async.py — Zulip <-> OpenDrSai 桥接器（v1 异步优化版）
============================================================
这是 `bridge.py`（v0 baseline，串行）的优化版本，**保留 bridge.py 不动**，
本文件作为独立可运行的对照版本，便于未来用真实后端做 A/B 性能测试。

相对 v0 的改进（吸收自 drsai wechat daemon 与 github zulipchat-mcp 的成熟模式）：

  并发模型（对齐 wechat daemon）
    - asyncio 事件循环 + 每条消息一个 task（不再串行阻塞）
    - per-conversation asyncio.Lock：同一会话串行保序，不同会话并发
    - 同步的 OpenAI 流式调用放进 run_in_executor，不阻塞事件循环

  健壮性（吸收 zulipchat-mcp / wechat）
    - 后端调用 timeout（asyncio.wait_for），杜绝永久冻结（v0 的 P0-2）
    - getupdates/长轮询层面的指数退避重试（zulipchat-mcp 模式）
    - 看门狗：异常不杀全局，单消息失败隔离

  资源管理
    - 会话 LRU 淘汰（max_sessions），修复 v0 内存无界增长（P1-1）
    - 历史按"对话轮数"正确裁剪（修复 v0 的 maxlen 减半语义 bug，P1-2）
    - 消息去重（_seen_ids，借鉴 wechat），避免重复处理

  流式回复
    - 增大编辑间隔，且仅在内容实质变化时 update（降低 API 放大，P2-1）

接口/行为与 v0 保持一致：chat_id 规则、命令(/help /ping /reset)、mention 解析。

运行方式与 bridge.py 相同：
    export DRSAI_BASE_URL=...   DRSAI_MODEL=...   HEPAI_API_KEY=...
    python bridge_async.py
"""

from __future__ import annotations

import asyncio
import os
import sys
import time
from collections import OrderedDict, deque
from typing import Any, Optional

import zulip
from openai import OpenAI


# ── 配置 ───────────────────────────────────────────────────────────────────────

ZULIPRC_PATH = os.environ.get("ZULIPRC", os.path.join(os.path.dirname(__file__), ".zuliprc"))

DRSAI_BASE_URL = os.environ.get("DRSAI_BASE_URL", "https://aiapi.ihep.ac.cn/apiv2")
DRSAI_API_KEY = os.environ.get("HEPAI_API_KEY", "EMPTYxx")
DRSAI_MODEL = os.environ.get("DRSAI_MODEL", "My Dr.Sai")

HISTORY_TURNS = int(os.environ.get("HISTORY_TURNS", "20"))      # 每个会话保留的对话轮数
MSGS_PER_TURN = 2                                               # 1 轮 = user + assistant
MAX_SESSIONS = int(os.environ.get("MAX_SESSIONS", "1000"))     # 会话数上限（LRU 淘汰）
STREAM_REPLY = os.environ.get("STREAM_REPLY", "1") == "1"
STREAM_EDIT_INTERVAL = float(os.environ.get("STREAM_EDIT_INTERVAL", "1.0"))  # 放大编辑间隔
STREAM_EDIT_MIN_CHARS = int(os.environ.get("STREAM_EDIT_MIN_CHARS", "40"))   # 字符增量阈值
BACKEND_TIMEOUT = float(os.environ.get("BACKEND_TIMEOUT", "60"))             # 后端总超时
MAX_WORKERS = int(os.environ.get("MAX_WORKERS", "16"))         # 并发处理上限
MAX_DEDUP_SIZE = 1000                                          # 去重缓存上限

# 长轮询指数退避（借鉴 zulipchat-mcp MessageListener）
BACKOFF_BASE = 2.0
BACKOFF_MAX = 60.0

HELP_TEXT = (
    "**OpenDrSai Zulip Bot (async)**\n\n"
    "- 私聊：直接发消息即可\n"
    "- 频道：使用 `@**bot-name**` 提及我\n\n"
    "命令：\n"
    "- `/help`  显示此帮助\n"
    "- `/ping`  连通性测试\n"
    "- `/reset` 清空当前会话上下文"
)


# ── 会话上下文（LRU 淘汰 + 正确历史轮数 + per-key 锁）────────────────────────────

class Conversations:
    """按会话维度维护短期历史；带 LRU 会话淘汰与 per-key asyncio 锁。

    相对 v0：
      - maxlen = HISTORY_TURNS * MSGS_PER_TURN（修复减半 bug）
      - OrderedDict + max_sessions LRU 淘汰（修复内存无界增长）
      - 每个会话一把 asyncio.Lock，保证同会话串行、跨会话并发
    """

    def __init__(self, max_turns: int, max_sessions: int):
        self._maxlen = max_turns * MSGS_PER_TURN
        self._max_sessions = max_sessions
        self._store: "OrderedDict[str, deque]" = OrderedDict()
        self._locks: "OrderedDict[str, asyncio.Lock]" = OrderedDict()

    @staticmethod
    def key(msg: dict) -> str:
        if msg["type"] == "private":
            ids = sorted(r["id"] for r in msg["display_recipient"])
            return f"dm:{'-'.join(map(str, ids))}"
        return f"stream:{msg['stream_id']}:{msg['subject']}"

    def _touch(self, key: str) -> None:
        if key in self._store:
            self._store.move_to_end(key)
        else:
            self._store[key] = deque(maxlen=self._maxlen)
            while len(self._store) > self._max_sessions:
                old, _ = self._store.popitem(last=False)
                self._locks.pop(old, None)

    def lock(self, key: str) -> asyncio.Lock:
        lock = self._locks.get(key)
        if lock is None:
            lock = asyncio.Lock()
            self._locks[key] = lock
        return lock

    def append(self, key: str, role: str, content: str) -> None:
        self._touch(key)
        self._store[key].append({"role": role, "content": content})

    def history(self, key: str) -> list[dict]:
        self._touch(key)
        return list(self._store[key])

    def reset(self, key: str) -> None:
        self._store.pop(key, None)
        self._locks.pop(key, None)

    def __len__(self) -> int:
        return len(self._store)


# ── drsai 后端调用（同步生成器，将在 executor 中运行）──────────────────────────

def chat_completion_stream(client: OpenAI, messages: list[dict], chat_id: str, user: dict):
    """流式调用 drsai 后端，逐 chunk yield 文本（同步，executor 中跑）。"""
    completion = client.chat.completions.create(
        model=DRSAI_MODEL,
        messages=messages,
        stream=True,
        extra_body={"chat_id": chat_id, "user": user},
    )
    for chunk in completion:
        if chunk.choices and chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content


def collect_stream(client: OpenAI, messages: list[dict], chat_id: str, user: dict) -> list[str]:
    """在 executor 中把流式 chunk 收集为列表（供非流式或超时整体回收）。"""
    return list(chat_completion_stream(client, messages, chat_id, user))


# ── 消息处理辅助（与 v0 行为一致）──────────────────────────────────────────────

def should_respond(msg: dict, bot_user_id: int) -> tuple[bool, str]:
    if msg["sender_id"] == bot_user_id:
        return False, ""

    content = msg["content"].strip()
    if msg["type"] == "private":
        return True, content

    mention_token = f"@**{msg.get('bot_full_name', '')}**"
    if "is_mentioned" in msg.get("flags", []) or mention_token in content:
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
        recipients = [r["id"] for r in msg["display_recipient"] if r["id"] != msg["sender_id"]]
        recipients.append(msg["sender_id"])
        return {"type": "private", "to": list({*recipients})}
    return {"type": "stream", "to": msg["stream_id"], "topic": msg["subject"]}


def handle_command(text: str, conv: Conversations, key: str) -> Optional[str]:
    if text == "/help":
        return HELP_TEXT
    if text == "/ping":
        return "pong 🏓"
    if text == "/reset":
        conv.reset(key)
        return "✅ 已清空当前会话上下文。"
    return None


# ── 流式写回 Zulip（异步，仅在内容实质变化时 update）────────────────────────────

async def stream_to_zulip(zclient: zulip.Client, target: dict, chunks: list[str]) -> str:
    """先发占位消息，按间隔 + 字符增量阈值周期性 update_message。

    相对 v0：增大间隔 + 仅在新增字符达到阈值时才 update，降低 API 放大。
    zclient 调用是同步的，放进 executor 避免阻塞事件循环。
    """
    loop = asyncio.get_event_loop()

    placeholder = await loop.run_in_executor(
        None, lambda: zclient.send_message({**target, "content": "_思考中..._"})
    )
    if placeholder.get("result") != "success":
        raise RuntimeError(f"send_message failed: {placeholder}")
    msg_id = placeholder["id"]

    buf: list[str] = []
    last_edit = 0.0
    last_len = 0
    for piece in chunks:
        buf.append(piece)
        now = time.monotonic()
        cur_len = sum(len(x) for x in buf)
        if (now - last_edit >= STREAM_EDIT_INTERVAL) and (cur_len - last_len >= STREAM_EDIT_MIN_CHARS):
            content = "".join(buf)
            await loop.run_in_executor(
                None, lambda c=content: zclient.update_message({"message_id": msg_id, "content": c})
            )
            last_edit = now
            last_len = cur_len

    final = "".join(buf).strip() or "_（空回复）_"
    await loop.run_in_executor(
        None, lambda: zclient.update_message({"message_id": msg_id, "content": final})
    )
    return final


async def send_to_zulip(zclient: zulip.Client, target: dict, content: str) -> None:
    loop = asyncio.get_event_loop()
    resp = await loop.run_in_executor(
        None, lambda: zclient.send_message({**target, "content": content})
    )
    if resp.get("result") != "success":
        print(f"[错误] 发送失败: {resp}", file=sys.stderr)


# ── 单条消息处理（带 per-key 锁 + 超时隔离）─────────────────────────────────────

class Bot:
    """异步 Bot：封装客户端与会话状态，便于 harness 复用与测试。"""

    def __init__(self, zclient: zulip.Client, ai_client: OpenAI, bot_user_id: int, bot_full_name: str):
        self.zclient = zclient
        self.ai_client = ai_client
        self.bot_user_id = bot_user_id
        self.bot_full_name = bot_full_name
        self.conv = Conversations(HISTORY_TURNS, MAX_SESSIONS)
        self._seen_ids: set = set()
        self._sem = asyncio.Semaphore(MAX_WORKERS)

    def _dedup(self, msg: dict) -> bool:
        """返回 True 表示重复，应跳过。"""
        mid = msg.get("id")
        if mid is None:
            return False
        if mid in self._seen_ids:
            return True
        self._seen_ids.add(mid)
        if len(self._seen_ids) > MAX_DEDUP_SIZE:
            for old in list(self._seen_ids)[: MAX_DEDUP_SIZE // 2]:
                self._seen_ids.discard(old)
        return False

    async def handle_message(self, msg: dict) -> None:
        """处理单条消息：per-key 锁保序 + 后端超时隔离。"""
        msg["bot_full_name"] = self.bot_full_name
        respond, user_text = should_respond(msg, self.bot_user_id)
        if not respond:
            return

        key = Conversations.key(msg)
        target = reply_target(msg)

        cmd_reply = handle_command(user_text, self.conv, key)
        if cmd_reply is not None:
            await send_to_zulip(self.zclient, target, cmd_reply)
            return

        if not user_text:
            await send_to_zulip(self.zclient, target, "（消息为空，发送 `/help` 查看用法）")
            return

        # 同一会话串行保序；不同会话并发
        async with self._sem, self.conv.lock(key):
            self.conv.append(key, "user", user_text)
            messages = self.conv.history(key)
            user_info = {
                "name": msg.get("sender_full_name", ""),
                "email": msg.get("sender_email", ""),
            }

            loop = asyncio.get_event_loop()
            try:
                # 同步流式收集放 executor，加 asyncio 超时（杜绝永久冻结）
                chunks = await asyncio.wait_for(
                    loop.run_in_executor(
                        None, collect_stream, self.ai_client, messages, key, user_info
                    ),
                    timeout=BACKEND_TIMEOUT,
                )
                if STREAM_REPLY:
                    final = await stream_to_zulip(self.zclient, target, chunks)
                else:
                    final = "".join(chunks).strip() or "_（空回复）_"
                    await send_to_zulip(self.zclient, target, final)
                self.conv.append(key, "assistant", final)
            except asyncio.TimeoutError:
                err = f"⚠️ 调用 drsai 后端超时（>{BACKEND_TIMEOUT}s）"
                print(err, file=sys.stderr)
                await send_to_zulip(self.zclient, target, err)
            except Exception as e:
                err = f"⚠️ 调用 drsai 后端失败: {e}"
                print(err, file=sys.stderr)
                await send_to_zulip(self.zclient, target, err)


# ── 主入口：异步长轮询 + 并发派发 + 指数退避 ───────────────────────────────────

async def run_bot_async() -> None:
    if not os.path.exists(ZULIPRC_PATH):
        print(f"找不到 zuliprc 配置: {ZULIPRC_PATH}", file=sys.stderr)
        sys.exit(1)

    zclient = zulip.Client(config_file=ZULIPRC_PATH)
    profile = zclient.get_profile()
    bot = Bot(zclient, OpenAI(api_key=DRSAI_API_KEY, base_url=DRSAI_BASE_URL, timeout=BACKEND_TIMEOUT),
              profile["user_id"], profile["full_name"])

    print("=" * 60)
    print("OpenDrSai Zulip Bot (async) 启动")
    print(f"  bot:     {bot.bot_full_name} (id={bot.bot_user_id})")
    print(f"  backend: {DRSAI_BASE_URL}  model={DRSAI_MODEL}")
    print(f"  并发:    max_workers={MAX_WORKERS}  timeout={BACKEND_TIMEOUT}s")
    print(f"  会话:    history_turns={HISTORY_TURNS}  max_sessions={MAX_SESSIONS}")
    print("=" * 60)

    loop = asyncio.get_event_loop()
    queue: asyncio.Queue = asyncio.Queue()

    # zulip SDK 的 call_on_each_message 是阻塞长轮询，放线程里，
    # 通过 call_soon_threadsafe 把消息塞进异步队列。
    def _on_message_threadsafe(msg: dict) -> None:
        loop.call_soon_threadsafe(queue.put_nowait, msg)

    def _poll_loop() -> None:
        consecutive = 0
        while True:
            try:
                zclient.call_on_each_message(_on_message_threadsafe)
            except Exception as e:
                consecutive += 1
                delay = min(BACKOFF_BASE ** consecutive, BACKOFF_MAX)
                print(f"[长轮询出错 第{consecutive}次] {e}，{delay:.0f}s 后重试", file=sys.stderr)
                time.sleep(delay)
            else:
                consecutive = 0

    import threading
    threading.Thread(target=_poll_loop, daemon=True).start()

    # 消费队列：每条消息派一个 task（并发，单条失败隔离）
    while True:
        msg = await queue.get()
        if bot._dedup(msg):
            continue
        asyncio.create_task(_guarded(bot.handle_message(msg)))


async def _guarded(coro) -> None:
    """包裹单条消息处理，异常隔离，不影响其他消息与主循环。"""
    try:
        await coro
    except Exception as e:
        print(f"[消息处理异常] {e}", file=sys.stderr)


if __name__ == "__main__":
    try:
        asyncio.run(run_bot_async())
    except KeyboardInterrupt:
        print("\nBot 已停止。")
