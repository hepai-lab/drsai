from __future__ import annotations

import asyncio
import json
import os
import sys
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any


@dataclass
class ActiveTask:
    task_id: str
    cancelled: bool = False


active_tasks: dict[str, ActiveTask] = {}
active_tasks_lock = threading.Lock()
task_threads: list[threading.Thread] = []
task_threads_lock = threading.Lock()
approval_decisions: dict[str, bool] = {}
approval_lock = threading.Lock()


def emit(event: dict[str, Any]) -> None:
    event.setdefault("timestamp", datetime.now(timezone.utc).isoformat())
    sys.stdout.write(json.dumps(event, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def mark_cancelled(task_id: str) -> None:
    with active_tasks_lock:
        task = active_tasks.get(task_id)
        if task:
            task.cancelled = True


def is_cancelled(task_id: str) -> bool:
    with active_tasks_lock:
        task = active_tasks.get(task_id)
        return bool(task and task.cancelled)


def remove_task(task_id: str) -> None:
    with active_tasks_lock:
        active_tasks.pop(task_id, None)

def set_approval(action_id: str, approved: bool) -> None:
    with approval_lock:
        approval_decisions[action_id] = approved


def wait_for_approval(action_id: str, timeout_seconds: float = 5.0) -> bool | None:
    deadline = datetime.now(timezone.utc).timestamp() + timeout_seconds
    while datetime.now(timezone.utc).timestamp() < deadline:
        with approval_lock:
            if action_id in approval_decisions:
                return approval_decisions.pop(action_id)
        threading.Event().wait(0.05)
    return None


def start_task(command: dict[str, Any]) -> None:
    task_id = str(command.get("taskId") or "")
    if not task_id:
        emit({"type": "task.failed", "taskId": "unknown", "error": "Missing taskId."})
        return
    instruction = str(command.get("instruction") or "").strip()
    if not instruction:
        emit({"type": "task.failed", "taskId": task_id, "error": "Missing browser task instruction."})
        return
    with active_tasks_lock:
        active_tasks[task_id] = ActiveTask(task_id=task_id)
    thread = threading.Thread(target=run_task_thread, args=(task_id, command), daemon=False)
    with task_threads_lock:
        task_threads.append(thread)
    thread.start()


def run_task_thread(task_id: str, command: dict[str, Any]) -> None:
    emit({"type": "task.started", "taskId": task_id, "engine": "browser-use"})
    try:
        if os.environ.get("OPENDRSAI_BROWSER_USE_FAKE_REAL") == "1":
            run_fake_browser_use_task(task_id, command)
            return
        asyncio.run(run_browser_use_task(task_id, command))
    except Exception as exc:
        if not is_cancelled(task_id):
            emit({"type": "task.failed", "taskId": task_id, "error": str(exc)})
    finally:
        remove_task(task_id)


def run_fake_browser_use_task(task_id: str, command: dict[str, Any]) -> None:
    url = str(command.get("url") or "about:blank")
    if is_cancelled(task_id):
        emit({"type": "task.cancelled", "taskId": task_id})
        return
    emit({"type": "page.observed", "taskId": task_id, "url": url, "title": "Fake browser-use fixture"})
    action_id = f"{task_id}:inspect"
    emit({
        "type": "action.proposed",
        "taskId": task_id,
        "actionId": action_id,
        "action": "snapshot",
        "target": url,
        "requiresApproval": False,
    })
    emit({
        "type": "action.completed",
        "taskId": task_id,
        "actionId": action_id,
        "ok": True,
        "message": "Fake browser-use observation completed.",
    })
    action_id = f"{task_id}:approve-click"
    emit({
        "type": "action.proposed",
        "taskId": task_id,
        "actionId": action_id,
        "action": "click",
        "target": "#fixture-run",
        "requiresApproval": True,
    })
    approved = wait_for_approval(action_id)
    if approved is None:
        emit({
            "type": "task.failed",
            "taskId": task_id,
            "error": "Timed out waiting for browser-use action approval.",
        })
        return
    if not approved:
        emit({
            "type": "action.completed",
            "taskId": task_id,
            "actionId": action_id,
            "ok": False,
            "message": "Fake browser-use click rejected.",
        })
        emit({"type": "task.cancelled", "taskId": task_id})
        return
    emit({
        "type": "action.completed",
        "taskId": task_id,
        "actionId": action_id,
        "ok": True,
        "message": "Fake browser-use approved click executed.",
    })
    emit({
        "type": "screenshot",
        "taskId": task_id,
        "dataUrl": "data:image/png;base64,",
    })
    emit({
        "type": "task.completed",
        "taskId": task_id,
        "result": "Fake browser-use task completed.",
    })


async def run_browser_use_task(task_id: str, command: dict[str, Any]) -> None:
    if not os.environ.get("BROWSER_USE_API_KEY"):
        emit({
            "type": "task.failed",
            "taskId": task_id,
            "error": "browser-use is not configured. Set BROWSER_USE_API_KEY and install browser-use browsers before running real tasks.",
        })
        return
    try:
        from browser_use import Agent, ChatBrowserUse
    except Exception as exc:
        emit({
            "type": "task.failed",
            "taskId": task_id,
            "error": f"browser-use package unavailable: {exc}",
        })
        return

    instruction = str(command.get("instruction") or "").strip()
    url = str(command.get("url") or "").strip()
    task = f"{instruction}\n\nStart URL: {url}" if url else instruction
    emit({"type": "page.observed", "taskId": task_id, "url": url or "about:blank", "title": "browser-use task"})

    if is_cancelled(task_id):
        emit({"type": "task.cancelled", "taskId": task_id})
        return

    agent = Agent(task=task, llm=ChatBrowserUse())
    result = await agent.run()
    if is_cancelled(task_id):
        emit({"type": "task.cancelled", "taskId": task_id})
        return
    final_result = extract_final_result(result)
    emit({"type": "task.completed", "taskId": task_id, "result": final_result})


def extract_final_result(result: Any) -> str:
    final_result = getattr(result, "final_result", None)
    if callable(final_result):
        try:
            value = final_result()
            if value:
                return str(value)
        except Exception:
            pass
    if result is None:
        return "browser-use task completed."
    return str(result)


def handle_command(command: dict[str, Any]) -> None:
    command_type = command.get("type")
    task_id = str(command.get("taskId") or "")
    if command_type == "task.start":
        start_task(command)
        return
    if not task_id:
        emit({"type": "task.failed", "taskId": "unknown", "error": "Missing taskId."})
        return
    if command_type == "task.stop":
        mark_cancelled(task_id)
        emit({"type": "task.cancelled", "taskId": task_id})
        return
    if command_type == "action.approve":
        set_approval(str(command.get("actionId") or ""), bool(command.get("approved")))
        return
    emit({"type": "task.failed", "taskId": task_id, "error": f"Unsupported command: {command_type}"})


def main() -> int:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            handle_command(json.loads(line))
        except Exception as exc:
            emit({"type": "task.failed", "taskId": "unknown", "error": str(exc)})
    with task_threads_lock:
        threads = list(task_threads)
    for thread in threads:
        thread.join(timeout=30)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
