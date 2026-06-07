"""
cc_bridge_v4.py — Zulip <-> Claude Code 桥接器（SDK 多轮 + Zulip 权限交互 + 并发保护）
========================================================================================
与 v3 的区别：
  - 每个对话 key 只允许同时运行一个 Claude 进程（per-key 互斥锁），
    新消息到达时若当前 key 正在处理，回复"正忙"提示。
  - Claude 调用设 5 分钟超时，避免永久挂起。
  - update_message / send_message 通过 run_in_executor 调用，不阻塞 async 事件循环。
  - 启动时清理残留的 bridge 用 Claude 子进程。
"""

import asyncio
import json
import os
import signal
import subprocess
import sys
import time
import threading

import zulip
from claude_code_sdk import ClaudeSDKClient, ClaudeCodeOptions
from claude_code_sdk._errors import ProcessError
from claude_code_sdk.types import (
    AssistantMessage, ResultMessage, TextBlock, ToolUseBlock,
    PermissionResultAllow, PermissionResultDeny,
)


# ── 配置 ──────────────────────────────────────────────────────────────────────

ZULIPRC_PATH    = os.environ.get("ZULIPRC", os.path.expanduser("~/.zuliprc"))
WORKDIR         = os.environ.get("CLAUDE_WORKDIR", os.path.expanduser("~/VSProjects/drsai"))
PERM_TIMEOUT    = int(os.environ.get("PERM_TIMEOUT", "300"))
CALL_TIMEOUT    = int(os.environ.get("CALL_TIMEOUT", "300"))   # Claude 整体超时（秒）
HEARTBEAT_INTERVAL = 8.0
EDIT_INTERVAL   = 0.8

HELP_TEXT = (
    "**Claude Code Zulip Bridge v4**\n\n"
    "- 私聊：直接发消息即可\n"
    "- 频道：使用 `@**bot名**` 提及我\n\n"
    "命令：\n"
    "- `/help`  显示此帮助\n"
    "- `/ping`  连通性测试\n"
    "- `/stop`  中断正在执行的任务\n"
    "- `/reset` 清空当前会话（重新开始，新的 session）\n"
    "- `/clear` 同 /reset\n\n"
    "**权限确认**：Claude 执行危险操作时会在此询问，回复 `yes`/`no` 即可。"
)

import re as _re
_DANGEROUS_PATTERNS = _re.compile(
    r"rm\s+-[a-z]*r[a-z]*\s+-[a-z]*f|"
    r"rm\s+-[a-z]*f[a-z]*\s+-[a-z]*r|"
    r"git\s+push\s+.*--force|"
    r"git\s+push\s+-f\b|"
    r"git\s+reset\s+--hard|"
    r"git\s+clean\s+-[a-z]*f|"
    r":\s*>\s*[^\s]|"
    r"dd\s+if=|"
    r"chmod\s+-[a-z]*R|"
    r"chown\s+-[a-z]*R|"
    r"DROP\s+(TABLE|DATABASE)|"
    r"pkill|killall",
    _re.IGNORECASE
)


def _is_dangerous_bash(cmd: str) -> bool:
    return bool(_DANGEROUS_PATTERNS.search(cmd))


# ── 会话管理 ──────────────────────────────────────────────────────────────────

_SESSIONS_FILE = os.path.expanduser("~/.claude/zulip_bridge_sessions.json")


class Sessions:
    def __init__(self):
        self._lock = threading.Lock()
        self._store: dict[str, str] = self._load()

    def _load(self) -> dict[str, str]:
        try:
            with open(_SESSIONS_FILE) as f:
                return json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            return {}

    def _save(self) -> None:
        os.makedirs(os.path.dirname(_SESSIONS_FILE), exist_ok=True)
        with open(_SESSIONS_FILE, "w") as f:
            json.dump(self._store, f, indent=2)

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
            self._save()

    def reset(self, key: str) -> None:
        with self._lock:
            self._store.pop(key, None)
            self._save()


# ── 并发保护：每个 key 同时只允许一个 Claude 调用 ─────────────────────────────

_conv_locks: dict[str, threading.Lock] = {}
_conv_locks_registry_lock = threading.Lock()


def _get_conv_lock(key: str) -> threading.Lock:
    with _conv_locks_registry_lock:
        if key not in _conv_locks:
            _conv_locks[key] = threading.Lock()
        return _conv_locks[key]


# ── 权限确认（Zulip 交互）────────────────────────────────────────────────────

_pending_confirmations: dict[str, dict] = {}
_pending_lock = threading.Lock()

_active_tasks: dict[str, tuple] = {}
_active_lock = threading.Lock()


def _format_tool_request(tool_name: str, tool_input: dict) -> str:
    if tool_name == "Bash":
        cmd = tool_input.get("command", "").strip()
        detail = f"```bash\n{cmd[:500]}\n```"
    else:
        detail = f"```json\n{json.dumps(tool_input, ensure_ascii=False, indent=2)[:400]}\n```"
    return (
        f"⚠️ **权限请求** — `{tool_name}`\n\n"
        f"{detail}\n\n"
        f"回复 `yes`/`y` 允许，`no`/`n` 拒绝（{PERM_TIMEOUT}s 超时自动拒绝）"
    )


async def ask_permission_via_zulip(
    conv_key: str,
    zclient: zulip.Client,
    target: dict,
    tool_name: str,
    tool_input: dict,
) -> PermissionResultAllow | PermissionResultDeny:
    await _send_async(zclient, target, _format_tool_request(tool_name, tool_input))

    event = threading.Event()
    with _pending_lock:
        _pending_confirmations[conv_key] = {"event": event, "answer": None}

    loop = asyncio.get_event_loop()
    answered = await loop.run_in_executor(None, lambda: event.wait(PERM_TIMEOUT))

    with _pending_lock:
        entry = _pending_confirmations.pop(conv_key, None)

    if not answered or entry is None or entry["answer"] is None:
        return PermissionResultDeny(message="等待超时，操作已取消。")

    answer = entry["answer"].lower().strip()
    if answer in ("yes", "y", "是", "好", "允许", "ok"):
        return PermissionResultAllow()
    return PermissionResultDeny(message="用户拒绝了此操作。")


# ── Zulip API 辅助（非阻塞 async 包装）──────────────────────────────────────

def _send_message_sync(zclient: zulip.Client, target: dict, content: str) -> int | None:
    for attempt in range(3):
        resp = zclient.send_message({**target, "content": content})
        if resp.get("result") == "success":
            return resp["id"]
        retry_after = resp.get("retry-after", 1)
        if resp.get("code") == "RATE_LIMIT_HIT" and attempt < 2:
            time.sleep(float(retry_after) + 0.1)
            continue
        print(f"[错误] 发送失败: {resp}", flush=True)
        return None
    return None


def _update_message_sync(zclient: zulip.Client, msg_id: int, content: str) -> None:
    try:
        zclient.update_message({"message_id": msg_id, "content": content})
    except Exception as e:
        print(f"[错误] 更新消息失败: {e}", flush=True)


async def _send_async(zclient, target, content) -> int | None:
    return await asyncio.get_event_loop().run_in_executor(
        None, _send_message_sync, zclient, target, content
    )


async def _update_async(zclient, msg_id, content) -> None:
    await asyncio.get_event_loop().run_in_executor(
        None, _update_message_sync, zclient, msg_id, content
    )


# ── 工具调用状态提示 ──────────────────────────────────────────────────────────

def _tool_hint(name: str, inp: dict) -> str:
    if name == "Bash":
        cmd = inp.get("command", "").strip().splitlines()[0][:80]
        return f"_正在执行: `{cmd}`…_"
    if name == "Read":
        return f"_正在读取: `{inp.get('file_path', '')}`…_"
    if name in ("Edit", "Write", "MultiEdit"):
        return f"_正在编辑: `{inp.get('file_path', '')}`…_"
    if name == "WebSearch":
        return f"_正在搜索: `{inp.get('query', '')}`…_"
    if name == "WebFetch":
        url = inp.get("url", "")[:60]
        return f"_正在获取: `{url}`…_"
    return f"_正在调用工具: `{name}`…_"


# ── Claude SDK 调用 ──────────────────────────────────────────────────────────

async def call_claude_sdk(
    prompt: str,
    session_id: str | None,
    workdir: str,
    conv_key: str,
    can_use_tool_cb=None,
):
    options = ClaudeCodeOptions(
        resume=session_id,
        permission_mode="bypassPermissions",
        cwd=workdir,
        max_turns=20,
        can_use_tool=can_use_tool_cb,
    )

    text_parts: list[str] = []
    new_session_id: str | None = None
    loop = asyncio.get_event_loop()

    async with ClaudeSDKClient(options=options) as client:
        with _active_lock:
            _active_tasks[conv_key] = (loop, client)
        try:
            await client.query(prompt)
            # receive_response() 在收到 ResultMessage 后自动终止，
            # 避免 receive_messages() 在响应结束后无限等待下一条消息。
            async for event in client.receive_response():
                if isinstance(event, AssistantMessage):
                    for block in event.content:
                        if isinstance(block, ToolUseBlock):
                            yield None, None, _tool_hint(block.name, block.input)
                        elif isinstance(block, TextBlock) and block.text:
                            sep = "\n\n" if text_parts and not text_parts[-1].endswith("\n") else ""
                            combined = sep + block.text
                            text_parts.append(block.text)
                            yield combined, None, None
                elif isinstance(event, ResultMessage):
                    new_session_id = event.session_id
                    if event.is_error and not text_parts:
                        yield f"⚠️ Claude 执行出错 (session={event.session_id})", event.session_id, None
                        return
                    # receive_response() 会在本次迭代后自动 return
        finally:
            with _active_lock:
                _active_tasks.pop(conv_key, None)

    yield "", new_session_id, None


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


async def handle_async(
    zclient: zulip.Client,
    sessions: Sessions,
    bot_user_id: int,
    msg: dict,
) -> None:
    respond, user_text = should_respond(msg, bot_user_id)
    print(f"[msg] type={msg.get('type')} from={msg.get('sender_email')} respond={respond}", flush=True)

    if not respond:
        return

    key = Sessions.key(msg)
    target = reply_target(msg)

    # ── 内置命令（不受并发锁影响）────────────────────────────────────────────
    if user_text in ("/help",):
        await _send_async(zclient, target, HELP_TEXT)
        return
    if user_text in ("/ping",):
        await _send_async(zclient, target, "pong 🏓")
        return
    if user_text in ("/stop",):
        with _active_lock:
            task = _active_tasks.get(key)
        if task:
            task_loop, task_client = task
            asyncio.run_coroutine_threadsafe(task_client.interrupt(), task_loop)
            await _send_async(zclient, target, "⏹️ 已发送中断信号。")
        else:
            await _send_async(zclient, target, "_(当前没有正在运行的任务)_")
        return
    if user_text in ("/reset", "/clear"):
        old = sessions.get(key)
        sessions.reset(key)
        await _send_async(zclient, target, f"✅ 已清空会话上下文（旧 session: `{old}`）。")
        return
    if not user_text:
        await _send_async(zclient, target, "_(消息为空，发送 `/help` 查看用法)_")
        return

    # ── 并发保护 ─────────────────────────────────────────────────────────────
    conv_lock = _get_conv_lock(key)
    if not conv_lock.acquire(blocking=False):
        await _send_async(zclient, target, "_⏳ 正忙，请等当前任务完成后再发送。_")
        return

    # 所有需要在 except 块中访问的变量先初始化
    heartbeat_stop = asyncio.Event()
    hb_task = None
    placeholder_id = None

    try:
        session_id = sessions.get(key)
        print(f"[claude] key={key} resume={session_id} prompt={repr(user_text[:60])}", flush=True)

        placeholder_id = await _send_async(zclient, target, "_思考中..._")
        if placeholder_id is None:
            return

        async def permission_callback(tool_name: str, tool_input: dict, ctx):
            if tool_name == "Bash" and _is_dangerous_bash(tool_input.get("command", "")):
                return await ask_permission_via_zulip(key, zclient, target, tool_name, tool_input)
            return PermissionResultAllow()

        buf: list[str] = []
        last_edit = 0.0
        new_session_id: str | None = None
        current_hint: str = ""
        start_time = time.monotonic()

        async def heartbeat():
            while not heartbeat_stop.is_set():
                await asyncio.sleep(HEARTBEAT_INTERVAL)
                if heartbeat_stop.is_set():
                    break
                if current_hint:
                    elapsed = int(time.monotonic() - start_time)
                    status = ("".join(buf) + "\n\n" + current_hint) if buf else current_hint
                    status += f" _(已运行 {elapsed}s)_"
                    await _update_async(zclient, placeholder_id, status)

        hb_task = asyncio.get_event_loop().create_task(heartbeat())

        async def run_sdk():
            nonlocal new_session_id, current_hint, last_edit
            async for chunk, sid, hint in call_claude_sdk(
                user_text, session_id, WORKDIR, key, permission_callback
            ):
                if sid is not None:
                    new_session_id = sid
                if hint is not None:
                    current_hint = hint
                    status = ("".join(buf) + "\n\n" + hint) if buf else hint
                    await _update_async(zclient, placeholder_id, status)
                    last_edit = time.monotonic()
                if chunk:
                    current_hint = ""
                    buf.append(chunk)
                    now = time.monotonic()
                    if now - last_edit >= EDIT_INTERVAL:
                        await _update_async(zclient, placeholder_id, "".join(buf))
                        last_edit = now

        try:
            await asyncio.wait_for(run_sdk(), timeout=CALL_TIMEOUT)
        except asyncio.TimeoutError:
            heartbeat_stop.set()
            if hb_task:
                await hb_task
            timeout_msg = f"⏰ 超时（>{CALL_TIMEOUT}s），任务已中断。"
            if placeholder_id:
                await _update_async(zclient, placeholder_id, timeout_msg)
            print(f"[claude] timeout key={key}", flush=True)
            return

        heartbeat_stop.set()
        if hb_task:
            await hb_task
        final = "".join(buf).strip() or "_(空回复)_"
        await _update_async(zclient, placeholder_id, final)
        print(f"[claude] done session={new_session_id} reply={repr(final[:80])}", flush=True)

        if new_session_id:
            sessions.set(key, new_session_id)

    except ProcessError as e:
        heartbeat_stop.set()
        if hb_task:
            await hb_task
        stderr_part = f"\n\nStderr:\n```\n{e.stderr.strip()}\n```" if e.stderr else ""
        err = f"⚠️ Claude 进程出错 (exit_code={e.exit_code}){stderr_part}"
        print(err, flush=True)
        if placeholder_id:
            await _update_async(zclient, placeholder_id, err)
    except Exception as e:
        heartbeat_stop.set()
        if hb_task:
            try:
                await hb_task
            except Exception:
                pass
        err = f"⚠️ 处理出错: {e}"
        print(err, flush=True)
        if placeholder_id:
            try:
                await _update_async(zclient, placeholder_id, err)
            except Exception:
                pass
    finally:
        conv_lock.release()


def handle(zclient, sessions, bot_user_id, msg):
    asyncio.run(handle_async(zclient, sessions, bot_user_id, msg))


# ── 清理残留 Claude 子进程 ────────────────────────────────────────────────────

def _cleanup_orphan_claude_procs():
    """启动时终止残留的 bridge 用 Claude CLI 子进程。"""
    try:
        result = subprocess.run(
            ["pgrep", "-f", "bypassPermissions"],
            capture_output=True, text=True
        )
        pids = [int(p) for p in result.stdout.split() if p.strip().isdigit()]
        own_pid = os.getpid()
        killed = []
        for pid in pids:
            if pid == own_pid:
                continue
            try:
                os.kill(pid, signal.SIGTERM)
                killed.append(pid)
            except ProcessLookupError:
                pass
        if killed:
            print(f"[bridge] 清理残留 Claude 进程: {killed}", flush=True)
            time.sleep(1)  # 等待进程退出
    except Exception as e:
        print(f"[bridge] 清理残留进程失败: {e}", flush=True)


# ── 主入口 ────────────────────────────────────────────────────────────────────

def run_bot() -> None:
    if not os.path.exists(ZULIPRC_PATH):
        print(f"找不到 zuliprc: {ZULIPRC_PATH}", file=sys.stderr)
        sys.exit(1)

    _cleanup_orphan_claude_procs()

    zclient      = zulip.Client(config_file=ZULIPRC_PATH)
    profile      = zclient.get_profile()
    bot_user_id  = profile["user_id"]
    sessions     = Sessions()

    print("=" * 60)
    print("Claude Code Zulip Bridge v4 (SDK 多轮 + 并发保护) 启动")
    print(f"  bot:     {profile['full_name']} (id={bot_user_id})")
    print(f"  workdir: {WORKDIR}")
    print(f"  timeout: {CALL_TIMEOUT}s per call")
    print("=" * 60)

    def on_message(msg: dict) -> None:
        if msg.get("sender_id") == bot_user_id:
            return

        key = Sessions.key(msg)
        content = msg.get("content", "").strip()

        if content in ("/stop",):
            threading.Thread(
                target=handle, args=(zclient, sessions, bot_user_id, msg), daemon=True
            ).start()
            return

        with _pending_lock:
            if key in _pending_confirmations:
                entry = _pending_confirmations[key]
                entry["answer"] = content
                entry["event"].set()
                return

        threading.Thread(
            target=handle, args=(zclient, sessions, bot_user_id, msg), daemon=True
        ).start()

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
