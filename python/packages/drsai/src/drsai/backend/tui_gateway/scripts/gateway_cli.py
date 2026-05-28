"""Headless JSON-RPC client for the DrSai TUI gateway.

A bare stdin/stdout test harness that simulates the Ink UI without rendering.
Used by Phase 1 verification to drive a complete conversation turn end-to-end.

Usage::

    python -m drsai.backend.tui_gateway.scripts.gateway_cli "你好"

    # or pipe a sequence of requests:
    echo '{"method":"session.list","params":{}}' | python -m ...

Output: human-readable timeline of RPC results + streamed events.
"""

from __future__ import annotations

import argparse
import json
import os
import queue
import subprocess
import sys
import threading
import time
from typing import Any


class GatewayProcess:
    """Spawn ``python -m drsai.backend.tui_gateway`` and demux frames."""

    def __init__(self) -> None:
        env = os.environ.copy()
        # Ensure the in-tree drsai package wins over any pip-installed copy.
        src_root = os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "..")
        )
        existing = env.get("PYTHONPATH", "")
        env["PYTHONPATH"] = (
            f"{src_root}{os.pathsep}{existing}" if existing else src_root
        )

        self.proc = subprocess.Popen(
            [sys.executable, "-u", "-m", "drsai.backend.tui_gateway"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            env=env,
        )

        self._req_id = 0
        self._pending: dict[str, queue.Queue[dict]] = {}
        self.events: queue.Queue[dict] = queue.Queue()
        self._stop = threading.Event()

        threading.Thread(target=self._drain_stdout, daemon=True).start()
        threading.Thread(target=self._drain_stderr, daemon=True).start()

    def _drain_stdout(self) -> None:
        for line in self.proc.stdout or []:  # type: ignore[union-attr]
            line = line.strip()
            if not line:
                continue
            try:
                frame = json.loads(line)
            except json.JSONDecodeError:
                print(f"[malformed] {line[:200]}", file=sys.stderr)
                continue

            if frame.get("method") == "event":
                self.events.put(frame.get("params") or {})
                continue

            rid = frame.get("id")
            if isinstance(rid, str) and rid in self._pending:
                self._pending[rid].put(frame)

    def _drain_stderr(self) -> None:
        for line in self.proc.stderr or []:  # type: ignore[union-attr]
            line = line.rstrip("\n")
            if not line:
                continue
            # Suppress noisy alembic info logs by default.
            if "INFO" in line and ("alembic" in line or "drsai.modules.managers.database" in line):
                continue
            print(f"[stderr] {line[:400]}", file=sys.stderr)

    def request(self, method: str, params: dict | None = None, *, timeout: float = 600.0) -> dict:
        self._req_id += 1
        rid = f"r{self._req_id}"
        q: queue.Queue[dict] = queue.Queue()
        self._pending[rid] = q

        payload = {"jsonrpc": "2.0", "id": rid, "method": method, "params": params or {}}
        self.proc.stdin.write(json.dumps(payload) + "\n")  # type: ignore[union-attr]
        self.proc.stdin.flush()  # type: ignore[union-attr]

        try:
            return q.get(timeout=timeout)
        finally:
            self._pending.pop(rid, None)

    def drain_events(self, max_seconds: float = 0.3) -> list[dict]:
        """Pull all events emitted within *max_seconds* (best-effort)."""
        deadline = time.time() + max_seconds
        out: list[dict] = []
        while True:
            remaining = deadline - time.time()
            if remaining <= 0:
                break
            try:
                out.append(self.events.get(timeout=remaining))
            except queue.Empty:
                break
        return out

    def wait_event(self, event_type: str, *, timeout: float = 30.0) -> dict | None:
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                ev = self.events.get(timeout=0.5)
            except queue.Empty:
                continue
            if ev.get("type") == event_type:
                return ev
        return None

    def close(self) -> None:
        self._stop.set()
        try:
            if self.proc.stdin and not self.proc.stdin.closed:
                self.proc.stdin.close()
            self.proc.wait(timeout=3.0)
        except Exception:
            try:
                self.proc.kill()
            except Exception:
                pass


# ── Pretty printers ──────────────────────────────────────────────────


def _short(s: str, n: int = 80) -> str:
    s = s.replace("\n", "\\n")
    return s if len(s) <= n else s[: n - 1] + "…"


def _print_event(ev: dict) -> None:
    t = ev.get("type", "?")
    payload = ev.get("payload") or {}
    sid_hint = (ev.get("session_id") or "")[:8]
    if t == "message.delta":
        text = payload.get("text") or ""
        sys.stdout.write(text)
        sys.stdout.flush()
    elif t == "message.start":
        print(f"\n[{sid_hint}] ── assistant ──")
    elif t == "message.complete":
        usage = payload.get("usage") or {}
        status = payload.get("status") or "complete"
        print(
            f"\n[{sid_hint}] ── done (status={status}, "
            f"in={usage.get('prompt_tokens', 0)} out={usage.get('completion_tokens', 0)}) ──"
        )
    elif t == "thinking.delta":
        print(f"\n[{sid_hint}] [thinking] {_short(payload.get('text', ''), 120)}")
    elif t == "tool.start":
        print(
            f"\n[{sid_hint}] [tool.start] {payload.get('name', '?')} "
            f"args={_short(json.dumps(payload.get('args') or {}), 80)}"
        )
    elif t == "tool.complete":
        print(
            f"\n[{sid_hint}] [tool.complete] {payload.get('name', '?')} "
            f"({payload.get('duration_ms', 0)}ms) → {_short(payload.get('result', ''), 80)}"
        )
    elif t == "approval.request":
        print(
            f"\n[{sid_hint}] [APPROVAL] command={_short(payload.get('command', ''), 60)} "
            f"choices={payload.get('choices')}"
        )
    elif t == "clarify.request":
        print(f"\n[{sid_hint}] [CLARIFY] {_short(payload.get('question', ''), 80)}")
    elif t == "gateway.ready":
        print(f"[gateway.ready] skin={list((payload.get('skin') or {}).keys())}")
    elif t == "session.info":
        print(f"[{sid_hint}] [session.info] model={payload.get('model')} tools={len(payload.get('tools') or [])}")
    elif t == "status.update":
        print(f"\n[{sid_hint}] [status:{payload.get('kind')}] {_short(payload.get('text', ''), 80)}")
    elif t == "error":
        print(f"\n[{sid_hint}] [ERROR] {payload.get('message', '?')}")
    else:
        print(f"\n[{sid_hint}] [{t}] {_short(json.dumps(payload), 100)}")


# ── Main flows ───────────────────────────────────────────────────────


def cmd_chat(args: argparse.Namespace) -> int:
    """Drive a complete conversation turn end-to-end."""
    gw = GatewayProcess()
    try:
        # Wait for gateway.ready
        ready = gw.wait_event("gateway.ready", timeout=15.0)
        if not ready:
            print("FAIL: never got gateway.ready", file=sys.stderr)
            return 1
        _print_event(ready)

        # Reuse existing session by default; create new on demand
        if args.new:
            resp = gw.request("session.create", {"name": args.name or "phase1-test"})
            session_id = (resp.get("result") or {}).get("session_id")
            print(f"[session.create] → {session_id}")
        else:
            # Try most_recent → fallback to first item in list
            resp = gw.request("session.most_recent", {})
            session = (resp.get("result") or {}).get("session")
            if session:
                session_id = session["session_id"]
                print(f"[session.most_recent] → {session_id[:8]} {session['name']!r}")
            else:
                lst = gw.request("session.list", {"limit": 1}).get("result") or {}
                sessions = lst.get("sessions") or []
                if not sessions:
                    resp = gw.request("session.create", {"name": "phase1-test"})
                    session_id = (resp.get("result") or {}).get("session_id")
                    print(f"[session.create] → {session_id}")
                else:
                    session_id = sessions[0]["session_id"]
                    print(f"[session.list[0]] → {session_id[:8]} {sessions[0]['name']!r}")

        # Resume (loads agent + state)
        resp = gw.request("session.resume", {"session_id": session_id}, timeout=300.0)
        if "error" in resp:
            print(f"FAIL: session.resume → {resp['error']}", file=sys.stderr)
            return 1
        info = (resp.get("result") or {}).get("info") or {}
        print(f"[session.resume] model={info.get('model')} workdir={info.get('workdir')}")

        # Drain any events that landed during resume (e.g. session.info)
        for ev in gw.drain_events(max_seconds=0.4):
            _print_event(ev)

        # Submit the prompt — start a background event drain so we see deltas live
        prompt_text = args.prompt or "Reply with a single short greeting."
        print(f"\n>> user: {prompt_text}")

        done = threading.Event()

        def _print_loop() -> None:
            while not done.is_set():
                try:
                    ev = gw.events.get(timeout=0.2)
                except queue.Empty:
                    continue
                _print_event(ev)
                if ev.get("type") == "message.complete":
                    # Keep draining briefly in case more events follow.
                    pass

        threading.Thread(target=_print_loop, daemon=True).start()

        resp = gw.request(
            "prompt.submit",
            {"session_id": session_id, "text": prompt_text},
            timeout=args.timeout,
        )
        # Wait a short tail for any trailing events.
        time.sleep(0.5)
        done.set()

        if "error" in resp:
            print(f"\nFAIL: prompt.submit → {resp['error']}", file=sys.stderr)
            return 1
        print(f"\n[prompt.submit result] {resp.get('result')}")
        return 0
    finally:
        gw.close()


def cmd_smoke(args: argparse.Namespace) -> int:
    """Lightweight protocol-only smoke test (no agent invocation)."""
    gw = GatewayProcess()
    try:
        ready = gw.wait_event("gateway.ready", timeout=15.0)
        if not ready:
            print("FAIL: no gateway.ready", file=sys.stderr)
            return 1
        print("OK: gateway.ready")

        resp = gw.request("ping", {"hi": 1})
        if "error" in resp:
            print(f"FAIL: ping → {resp['error']}", file=sys.stderr)
            return 1
        print(f"OK: ping → {resp['result']}")

        resp = gw.request("session.list", {"limit": 3})
        if "error" in resp:
            print(f"FAIL: session.list → {resp['error']}", file=sys.stderr)
            return 1
        result = resp["result"]
        print(f"OK: session.list → {len(result['sessions'])} sessions, user={result['user_id']}")
        return 0
    finally:
        gw.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="DrSai TUI gateway test harness")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_chat = sub.add_parser("chat", help="run a full conversation turn")
    p_chat.add_argument("prompt", nargs="?", default=None, help="user prompt")
    p_chat.add_argument("--new", action="store_true", help="create a new session")
    p_chat.add_argument("--name", default=None, help="new session name")
    p_chat.add_argument("--timeout", type=float, default=600.0)
    p_chat.set_defaults(func=cmd_chat)

    p_smoke = sub.add_parser("smoke", help="protocol-only smoke test (no agent)")
    p_smoke.set_defaults(func=cmd_smoke)

    args = parser.parse_args()
    sys.exit(args.func(args))


if __name__ == "__main__":
    main()
