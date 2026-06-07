"""
cc_bridge_v5.py — Zulip <-> Claude Code 桥接器（全面加固版）
========================================================================================
相对 v4 的修复（编号对应代码审查结论）：
  #1 线程安全：长轮询(读) 与 发送/更新(写) 使用独立的 zulip.Client，
     且所有写操作串行化（一把全局写锁），避免共享 requests.Session 并发串话。
  #2 安全清理：只清理「孤儿」(PPID==1) 且命令签名完全匹配本 bridge 的 Claude 子进程，
     绝不误杀其它工具或交互式 claude。
  #3 长消息：超过 Zulip 上限自动截断并提示。
  #4 session 失效自愈：resume 出错时清空该会话 session 并自动以全新会话重试一次。
  #5 /stop 唤醒权限确认：停止时同时取消挂起的权限等待。
  #6 并发用 busy-set（原子 check-and-set），不再为每个 key 泄漏 Lock 对象。
  #7 /stop 缩短兜底：interrupt + 可配置超时。
  #8 心跳：纯思考阶段也刷新「已运行 Ns」。
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
CALL_TIMEOUT    = int(os.environ.get("CALL_TIMEOUT", "600"))   # Claude 整体超时（秒）
HEARTBEAT_INTERVAL = 8.0
EDIT_INTERVAL   = 0.8
ZULIP_MAX_LEN   = 9000   # Zulip 单条上限约 1 万字符，留余量

HELP_TEXT = (
    "**Claude Code Zulip Bridge v5**\n\n"
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


def _truncate(text: str, limit: int = ZULIP_MAX_LEN) -> str:
    """#3 超长消息截断，保留首尾并提示。"""
    if len(text) <= limit:
        return text
    head = text[: limit - 200]
    return head + f"\n\n_…（回复过长，已截断，共 {len(text)} 字符）_"


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


# ── #6 并发保护：busy-set（原子 check-and-set，无对象泄漏）─────────────────────

_busy_keys: set[str] = set()
_busy_lock = threading.Lock()


def _try_acquire(key: str) -> bool:
    with _busy_lock:
        if key in _busy_keys:
            return False
        _busy_keys.add(key)
        return True


def _release(key: str) -> None:
    with _busy_lock:
        _busy_keys.discard(key)


# ── 权限确认（Zulip 交互）────────────────────────────────────────────────────

_pending_confirmations: dict[str, dict] = {}
_pending_lock = threading.Lock()

# conv_key -> (loop, client)
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
    target: dict,
    tool_name: str,
    tool_input: dict,
) -> PermissionResultAllow | PermissionResultDeny:
    await _send_async(target, _format_tool_request(tool_name, tool_input))

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
    return PermissionResultDeny(message="用户拒绝了此操作（或任务被 /stop 中断）。")


# ── #1 Zulip 写操作：独立 client + 全局写锁（线程安全）────────────────────────

_write_client: zulip.Client | None = None
_write_lock = threading.Lock()


def _set_write_client(client: zulip.Client) -> None:
    global _write_client
    _write_client = client


def _send_message_sync(target: dict, content: str) -> int | None:
    content = _truncate(content)
    for attempt in range(3):
        with _write_lock:
            resp = _write_client.send_message({**target, "content": content})
        if resp.get("result") == "success":
            return resp["id"]
        if resp.get("code") == "RATE_LIMIT_HIT" and attempt < 2:
            time.sleep(float(resp.get("retry-after", 1)) + 0.1)
            continue
        print(f"[错误] 发送失败: {resp}", flush=True)
        return None
    return None


def _update_message_sync(msg_id: int, content: str) -> None:
    content = _truncate(content)
    for attempt in range(3):
        try:
            with _write_lock:
                resp = _write_client.update_message(
                    {"message_id": msg_id, "content": content}
                )
        except Exception as e:
            print(f"[错误] 更新消息异常: {e}", flush=True)
            return
        if resp.get("result") == "success":
            return
        if resp.get("code") == "RATE_LIMIT_HIT" and attempt < 2:
            time.sleep(float(resp.get("retry-after", 1)) + 0.1)
            continue
        print(f"[错误] 更新消息失败: {resp}", flush=True)
        return


async def _send_async(target, content) -> int | None:
    return await asyncio.get_event_loop().run_in_executor(
        None, _send_message_sync, target, content
    )


async def _update_async(msg_id, content) -> None:
    await asyncio.get_event_loop().run_in_executor(
        None, _update_message_sync, msg_id, content
    )


# ── 工具调用状态提示 ──────────────────────────────────────────────────────────

def _tool_hint(name: str, inp: dict) -> str:
    if name == "Bash":
        cmd = inp.get("command", "").strip().splitlines()[0][:80] if inp.get("command") else ""
        return f"_正在执行: `{cmd}`…_"
    if name == "Read":
        return f"_正在读取: `{inp.get('file_path', '')}`…_"
    if name in ("Edit", "Write", "MultiEdit"):
        return f"_正在编辑: `{inp.get('file_path', '')}`…_"
    if name == "WebSearch":
        return f"_正在搜索: `{inp.get('query', '')}`…_"
    if name == "WebFetch":
        return f"_正在获取: `{inp.get('url', '')[:60]}`…_"
    return f"_正在调用工具: `{name}`…_"


# ── Claude SDK 调用 ──────────────────────────────────────────────────────────

async def call_claude_sdk(
    prompt: str,
    session_id: str | None,
    workdir: str,
    conv_key: str,
    can_use_tool_cb=None,
):
    """逐事件 yield (chunk, session_id, hint)。结尾 yield ("", session_id, None)。
    若发生 resume 失效错误，抛出 _ResumeError 以便上层自愈重试。"""
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
            async for event in client.receive_response():
                if isinstance(event, AssistantMessage):
                    for block in event.content:
                        if isinstance(block, ToolUseBlock):
                            yield None, None, _tool_hint(block.name, block.input)
                        elif isinstance(block, TextBlock) and block.text:
                            sep = "\n\n" if text_parts and not text_parts[-1].endswith("\n") else ""
                            text_parts.append(block.text)
                            yield sep + block.text, None, None
                elif isinstance(event, ResultMessage):
                    new_session_id = event.session_id
                    if event.is_error and not text_parts:
                        # #4 判定是否 resume 失效
                        result_txt = (getattr(event, "result", "") or "").lower()
                        if session_id and ("resume" in result_txt or "session" in result_txt
                                           or "no conversation" in result_txt):
                            raise _ResumeError()
                        yield f"⚠️ Claude 执行出错 (session={event.session_id})", event.session_id, None
                        return
        finally:
            with _active_lock:
                _active_tasks.pop(conv_key, None)

    yield "", new_session_id, None


class _ResumeError(Exception):
    """resume 的 session_id 失效，需要以全新会话重试。"""


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


async def _run_one_turn(key, target, user_text, session_id, placeholder_id):
    """执行一次 Claude 调用，返回 (final_text, new_session_id)。
    可能抛出 _ResumeError / asyncio.TimeoutError / ProcessError。"""
    buf: list[str] = []
    state = {"last_edit": 0.0, "new_sid": None, "hint": ""}
    start_time = time.monotonic()
    heartbeat_stop = asyncio.Event()

    async def permission_callback(tool_name, tool_input, ctx):
        if tool_name == "Bash" and _is_dangerous_bash(tool_input.get("command", "")):
            return await ask_permission_via_zulip(key, target, tool_name, tool_input)
        return PermissionResultAllow()

    async def heartbeat():
        # #8 即使没有工具提示，也刷新「已运行 Ns」
        while not heartbeat_stop.is_set():
            await asyncio.sleep(HEARTBEAT_INTERVAL)
            if heartbeat_stop.is_set():
                break
            elapsed = int(time.monotonic() - start_time)
            base = "".join(buf)
            if state["hint"]:
                status = (base + "\n\n" + state["hint"]) if base else state["hint"]
            else:
                status = base if base else "_思考中..._"
            status += f" _(已运行 {elapsed}s)_"
            await _update_async(placeholder_id, status)

    hb_task = asyncio.get_event_loop().create_task(heartbeat())

    async def run_sdk():
        async for chunk, sid, hint in call_claude_sdk(
            user_text, session_id, WORKDIR, key, permission_callback
        ):
            if sid is not None:
                state["new_sid"] = sid
            if hint is not None:
                state["hint"] = hint
                base = "".join(buf)
                status = (base + "\n\n" + hint) if base else hint
                await _update_async(placeholder_id, status)
                state["last_edit"] = time.monotonic()
            if chunk:
                state["hint"] = ""
                buf.append(chunk)
                now = time.monotonic()
                if now - state["last_edit"] >= EDIT_INTERVAL:
                    await _update_async(placeholder_id, "".join(buf))
                    state["last_edit"] = now

    try:
        await asyncio.wait_for(run_sdk(), timeout=CALL_TIMEOUT)
    finally:
        heartbeat_stop.set()
        try:
            await hb_task
        except Exception:
            pass

    final = "".join(buf).strip()
    return final, state["new_sid"]


async def handle_async(sessions: Sessions, bot_user_id: int, msg: dict) -> None:
    respond, user_text = should_respond(msg, bot_user_id)
    print(f"[msg] type={msg.get('type')} from={msg.get('sender_email')} respond={respond}", flush=True)

    if not respond:
        return

    key = Sessions.key(msg)
    target = reply_target(msg)

    # ── 内置命令（不受并发锁影响）────────────────────────────────────────────
    if user_text in ("/help",):
        await _send_async(target, HELP_TEXT)
        return
    if user_text in ("/ping",):
        await _send_async(target, "pong 🏓")
        return
    if user_text in ("/stop",):
        # #5 唤醒挂起的权限确认（视为拒绝）
        with _pending_lock:
            pend = _pending_confirmations.get(key)
            if pend:
                pend["answer"] = "no"
                pend["event"].set()
        with _active_lock:
            task = _active_tasks.get(key)
        if task:
            task_loop, task_client = task
            try:
                asyncio.run_coroutine_threadsafe(task_client.interrupt(), task_loop)
            except Exception as e:
                print(f"[stop] interrupt 失败: {e}", flush=True)
            await _send_async(target, "⏹️ 已发送中断信号。")
        elif pend:
            await _send_async(target, "⏹️ 已取消等待中的权限确认。")
        else:
            await _send_async(target, "_(当前没有正在运行的任务)_")
        return
    if user_text in ("/reset", "/clear"):
        old = sessions.get(key)
        sessions.reset(key)
        await _send_async(target, f"✅ 已清空会话上下文（旧 session: `{old}`）。")
        return
    if not user_text:
        await _send_async(target, "_(消息为空，发送 `/help` 查看用法)_")
        return

    # ── #6 并发保护 ──────────────────────────────────────────────────────────
    if not _try_acquire(key):
        await _send_async(target, "_⏳ 正忙，请等当前任务完成后再发送。_")
        return

    placeholder_id = None
    try:
        session_id = sessions.get(key)
        print(f"[claude] key={key} resume={session_id} prompt={repr(user_text[:60])}", flush=True)

        placeholder_id = await _send_async(target, "_思考中..._")
        if placeholder_id is None:
            return

        # #4 resume 失效自愈：先用已存 session，失败则清空后以全新会话重试一次
        try:
            final, new_sid = await _run_one_turn(
                key, target, user_text, session_id, placeholder_id
            )
        except _ResumeError:
            print(f"[claude] resume 失效，重置 session 重试 key={key}", flush=True)
            sessions.reset(key)
            await _update_async(placeholder_id, "_(历史会话已失效，正在以新会话重试…)_")
            final, new_sid = await _run_one_turn(
                key, target, user_text, None, placeholder_id
            )

        final = final or "_(空回复)_"
        await _update_async(placeholder_id, final)
        print(f"[claude] done session={new_sid} reply={repr(final[:80])}", flush=True)
        if new_sid:
            sessions.set(key, new_sid)

    except asyncio.TimeoutError:
        print(f"[claude] timeout key={key}", flush=True)
        if placeholder_id:
            await _update_async(placeholder_id, f"⏰ 超时（>{CALL_TIMEOUT}s），任务已中断。")
    except ProcessError as e:
        stderr_part = f"\n\nStderr:\n```\n{e.stderr.strip()}\n```" if e.stderr else ""
        err = f"⚠️ Claude 进程出错 (exit_code={e.exit_code}){stderr_part}"
        print(err, flush=True)
        if placeholder_id:
            await _update_async(placeholder_id, err)
    except Exception as e:
        err = f"⚠️ 处理出错: {e}"
        print(err, flush=True)
        if placeholder_id:
            try:
                await _update_async(placeholder_id, err)
            except Exception:
                pass
    finally:
        _release(key)


def handle(sessions, bot_user_id, msg):
    asyncio.run(handle_async(sessions, bot_user_id, msg))


# ── #2 安全清理残留 Claude 子进程 ─────────────────────────────────────────────

# SDK 启动 Claude CLI 的命令特征（用于在启动时识别孤儿进程）
_SDK_SIGNATURE = "--input-format stream-json"
_SDK_SIGNATURE2 = "--permission-mode bypassPermissions"


def _ppid_of(pid: int) -> int | None:
    try:
        with open(f"/proc/{pid}/stat") as f:
            parts = f.read().split()
        # stat: pid (comm) state ppid ...  —— comm 可能含空格/括号，取最后一个 ')' 后定位
        rparen = " ".join(parts).rfind(")")
        after = " ".join(parts)[rparen + 1:].split()
        return int(after[1])  # state, ppid
    except Exception:
        return None


def _cleanup_orphan_claude_procs():
    """#2 仅清理「孤儿」(PPID==1) 且命令签名完全匹配本 bridge 的 Claude 子进程。
    交互式 claude / 其它工具起的进程不匹配签名或有存活父进程，均不会被误杀。"""
    try:
        result = subprocess.run(
            ["pgrep", "-f", _SDK_SIGNATURE],
            capture_output=True, text=True
        )
        pids = [int(p) for p in result.stdout.split() if p.strip().isdigit()]
        own_pid = os.getpid()
        killed = []
        for pid in pids:
            if pid == own_pid:
                continue
            # 校验签名完整性
            try:
                with open(f"/proc/{pid}/cmdline", "rb") as f:
                    cmdline = f.read().replace(b"\x00", b" ").decode(errors="ignore")
            except Exception:
                continue
            if _SDK_SIGNATURE not in cmdline or _SDK_SIGNATURE2 not in cmdline:
                continue
            # 只杀孤儿（父进程已死，被 init 收养）
            if _ppid_of(pid) != 1:
                continue
            try:
                os.kill(pid, signal.SIGTERM)
                killed.append(pid)
            except ProcessLookupError:
                pass
        if killed:
            print(f"[bridge] 清理孤儿 Claude 进程: {killed}", flush=True)
            time.sleep(1)
    except Exception as e:
        print(f"[bridge] 清理孤儿进程失败: {e}", flush=True)


# ── 主入口 ────────────────────────────────────────────────────────────────────

def run_bot() -> None:
    if not os.path.exists(ZULIPRC_PATH):
        print(f"找不到 zuliprc: {ZULIPRC_PATH}", file=sys.stderr)
        sys.exit(1)

    _cleanup_orphan_claude_procs()

    # #1 读(长轮询) 与 写 使用两个独立 client / Session
    read_client  = zulip.Client(config_file=ZULIPRC_PATH)
    write_client = zulip.Client(config_file=ZULIPRC_PATH)
    _set_write_client(write_client)

    profile      = read_client.get_profile()
    bot_user_id  = profile["user_id"]
    sessions     = Sessions()

    print("=" * 60)
    print("Claude Code Zulip Bridge v5 (全面加固版) 启动")
    print(f"  bot:     {profile['full_name']} (id={bot_user_id})")
    print(f"  workdir: {WORKDIR}")
    print(f"  timeout: {CALL_TIMEOUT}s per call")
    print("=" * 60, flush=True)

    def on_message(msg: dict) -> None:
        if msg.get("sender_id") == bot_user_id:
            return

        key = Sessions.key(msg)
        content = msg.get("content", "").strip()

        # /stop 优先级最高
        if content in ("/stop",):
            threading.Thread(
                target=handle, args=(sessions, bot_user_id, msg), daemon=True
            ).start()
            return

        # 权限确认回复
        with _pending_lock:
            if key in _pending_confirmations:
                entry = _pending_confirmations[key]
                entry["answer"] = content
                entry["event"].set()
                return

        threading.Thread(
            target=handle, args=(sessions, bot_user_id, msg), daemon=True
        ).start()

    while True:
        try:
            read_client.call_on_each_message(on_message)
        except KeyboardInterrupt:
            print("[bridge] 收到 Ctrl+C，退出。", flush=True)
            break
        except Exception as e:
            print(f"[bridge] error: {e}, reconnecting in 5s...", flush=True)
            time.sleep(5)


if __name__ == "__main__":
    run_bot()
