#!/usr/bin/env python3
"""Deterministic Codex App Server fixture used only by the P10 Linux transport gate."""

from __future__ import annotations

import json
import sys


THREAD_ID = "p10-linux-thread"
TURN_ID = "p10-linux-turn"
EVENTS = [
    {"method": "turn/started", "params": {"threadId": THREAD_ID, "turn": {"id": TURN_ID}}},
    {"method": "item/started", "params": {"threadId": THREAD_ID, "turnId": TURN_ID,
        "item": {"id": "reasoning-1", "type": "reasoning", "summary": "Inspecting synthetic input"}}},
    {"method": "item/started", "params": {"threadId": THREAD_ID, "turnId": TURN_ID,
        "item": {"id": "command-1", "type": "commandExecution", "command": "synthetic-read"}}},
    {"method": "item/commandExecution/outputDelta", "params": {"threadId": THREAD_ID, "turnId": TURN_ID,
        "itemId": "command-1", "delta": "synthetic-output\n", "stream": "stdout"}},
    {"method": "item/completed", "params": {"threadId": THREAD_ID, "turnId": TURN_ID,
        "item": {"id": "command-1", "type": "commandExecution", "exitCode": 0}}},
    {"method": "item/completed", "params": {"threadId": THREAD_ID, "turnId": TURN_ID,
        "item": {"id": "file-1", "type": "fileChange", "path": "synthetic.txt"}}},
    {"method": "item/started", "params": {"threadId": THREAD_ID, "turnId": TURN_ID,
        "item": {"id": "approval-1", "type": "hookPrompt", "prompt": "Allow synthetic action?",
                 "options": ["allow", "deny"]}}},
    {"method": "item/started", "params": {"threadId": THREAD_ID, "turnId": TURN_ID,
        "item": {"id": "answer-1", "type": "agentMessage", "phase": "final"}}},
    {"method": "item/agentMessage/delta", "params": {"threadId": THREAD_ID, "turnId": TURN_ID,
        "itemId": "answer-1", "delta": "P10 remote final."}},
    {"method": "item/completed", "params": {"threadId": THREAD_ID, "turnId": TURN_ID,
        "item": {"id": "answer-1", "type": "agentMessage", "phase": "final", "text": "P10 remote final."}}},
    {"method": "turn/completed", "params": {"threadId": THREAD_ID,
        "turn": {"id": TURN_ID, "status": "completed"}}},
]


def emit(value: dict) -> None:
    print(json.dumps(value, separators=(",", ":")), flush=True)


def main() -> None:
    for raw in sys.stdin:
        try:
            request = json.loads(raw)
        except json.JSONDecodeError:
            continue
        request_id = request.get("id")
        method = request.get("method")
        params = request.get("params") if isinstance(request.get("params"), dict) else {}
        if request_id is None:
            continue
        if method == "turn/start":
            for event in EVENTS:
                emit(event)
            emit({"id": request_id, "result": {"turn": {"id": TURN_ID, "status": "completed"}}})
        elif method == "model/list":
            emit({"id": request_id, "error": {"code": -32001, "message": "synthetic remote failure"}})
        elif method == "thread/read":
            emit({"id": request_id, "result": {"thread": {"id": THREAD_ID, "turns": [
                {"id": TURN_ID, "status": "completed", "items": [
                    {"id": "user-1", "type": "userMessage", "text": "P10 remote prompt"},
                    {"id": "answer-1", "type": "agentMessage", "phase": "final", "text": "P10 remote final."},
                ]}
            ]}}})
        else:
            emit({"id": request_id, "result": {}})


if __name__ == "__main__":
    main()
