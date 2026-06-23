"""Scheduled task management for TUI gateway.

Provides RPC methods for creating, listing, canceling scheduled tasks
and emitting completion notifications via ``background.complete`` events.

Schedule format:
  - ``interval:N``  — run every N seconds
  - ``once``        — run immediately (one-shot)

( Future: ``cron:0 9 * * 1-5`` — requires croniter library )
"""

from __future__ import annotations

import logging
import threading
import time
import uuid
from datetime import datetime

from ..server import _emit, _err, _ok, method

logger = logging.getLogger(__name__)

# ── In-memory task registry (process-level, not persisted across restarts) ──
_scheduled_tasks: dict[str, dict] = {}
# Running thread handles
_running_threads: dict[str, threading.Thread] = {}


@method("scheduler.list")
def _scheduler_list(rid, params: dict) -> dict:
    """List all scheduled tasks."""
    tasks = []
    for tid, info in _scheduled_tasks.items():
        tasks.append({
            "id": tid,
            "name": info["name"],
            "prompt": info["prompt"][:100],
            "schedule": info["schedule"],
            "status": info["status"],
            "created_at": info["created_at"],
            "last_run": info.get("last_run"),
            "next_run": info.get("next_run"),
            "session_id": info.get("session_id"),
        })
    return _ok(rid, {"tasks": tasks})


@method("scheduler.create")
def _scheduler_create(rid, params: dict) -> dict:
    """Create a scheduled task.

    Params:
        name: Task name
        prompt: Prompt to execute
        schedule: Schedule rule (``interval:N`` or ``once``)
        session_id: Associated session ID (optional)
    """
    name = params.get("name", "").strip()
    prompt = params.get("prompt", "").strip()
    schedule = params.get("schedule", "").strip()
    session_id = params.get("session_id", "")

    if not prompt or not schedule:
        return _err(rid, -32602, "name, prompt, schedule are required")

    # Validate schedule format
    if schedule.startswith("interval:"):
        try:
            interval_s = int(schedule.split(":", 1)[1])
            if interval_s < 1:
                raise ValueError
        except (ValueError, IndexError):
            return _err(rid, -32602, "interval must be a positive integer (e.g. interval:3600)")
    elif schedule != "once":
        return _err(rid, -32602, f"Unsupported schedule format: '{schedule}'. Use 'interval:N' or 'once'.")

    tid = str(uuid.uuid4())[:8]
    task_info = {
        "id": tid,
        "name": name or f"task-{tid}",
        "prompt": prompt,
        "schedule": schedule,
        "status": "scheduled",
        "created_at": datetime.now().isoformat(),
        "session_id": session_id,
    }
    _scheduled_tasks[tid] = task_info

    # Start the scheduling thread
    _start_scheduler_thread(tid, task_info)

    logger.info("Scheduled task created: %s (%s) — %s", tid, task_info["name"], schedule)
    return _ok(rid, {"task_id": tid, "status": "scheduled"})


@method("scheduler.cancel")
def _scheduler_cancel(rid, params: dict) -> dict:
    """Cancel a scheduled task.

    Params:
        task_id: Task ID
    """
    tid = params.get("task_id", "")
    if tid not in _scheduled_tasks:
        return _err(rid, -32602, f"Task '{tid}' not found")

    _scheduled_tasks[tid]["status"] = "cancelled"
    # The thread will see the status change and exit on next check
    _scheduled_tasks.pop(tid, None)

    logger.info("Scheduled task cancelled: %s", tid)
    return _ok(rid, {"task_id": tid, "status": "cancelled"})


@method("scheduler.run")
def _scheduler_run(rid, params: dict) -> dict:
    """Immediately execute a scheduled task once.

    Params:
        task_id: Task ID
    """
    tid = params.get("task_id", "")
    if tid not in _scheduled_tasks:
        return _err(rid, -32602, f"Task '{tid}' not found")

    info = _scheduled_tasks[tid]
    info["status"] = "running"

    # Run in a background thread
    thread = threading.Thread(
        target=_run_task_once,
        args=(tid, info),
        name=f"scheduler-run-{tid}",
        daemon=True,
    )
    _running_threads[tid] = thread
    thread.start()

    return _ok(rid, {"task_id": tid, "status": "running"})


# ── Internal helpers ─────────────────────────────────────────────────────


def _start_scheduler_thread(tid: str, info: dict) -> None:
    """Start a background thread that executes the task on schedule."""
    schedule = info["schedule"]

    if schedule == "once":
        # One-shot: run immediately
        thread = threading.Thread(
            target=_run_task_once,
            args=(tid, info),
            name=f"scheduler-once-{tid}",
            daemon=True,
        )
        _running_threads[tid] = thread
        thread.start()
        return

    if schedule.startswith("interval:"):
        interval_s = int(schedule.split(":", 1)[1])
        thread = threading.Thread(
            target=_run_interval,
            args=(tid, info, interval_s),
            name=f"scheduler-interval-{tid}",
            daemon=True,
        )
        _running_threads[tid] = thread
        thread.start()
        return


def _run_interval(tid: str, info: dict, interval_s: int) -> None:
    """Run a task at fixed intervals, checking for cancellation."""
    while tid in _scheduled_tasks and _scheduled_tasks[tid].get("status") != "cancelled":
        _run_task_once(tid, info)
        # Sleep in small increments so we can detect cancellation
        elapsed = 0
        while elapsed < interval_s:
            if tid not in _scheduled_tasks or _scheduled_tasks[tid].get("status") == "cancelled":
                return
            time.sleep(min(1, interval_s - elapsed))
            elapsed += 1


def _run_task_once(tid: str, info: dict) -> None:
    """Execute the task prompt once and emit background.complete."""
    if tid not in _scheduled_tasks:
        return

    prompt = info["prompt"]
    session_id = info.get("session_id", "")
    task_name = info["name"]
    start_time = time.time()

    _scheduled_tasks[tid]["status"] = "running"
    _scheduled_tasks[tid]["last_run"] = datetime.now().isoformat()

    result_preview = ""
    status = "success"

    try:
        # Attempt to submit the prompt to the associated session
        if session_id:
            try:
                from . import session as session_module
                user_id = session_module._resolve_user_id()
                sess = session_module._ensure_agent_session(session_id, user_id)
                if sess and sess.agent:
                    # Run the agent turn synchronously
                    response = sess.agent.run(prompt)
                    if hasattr(response, "content"):
                        result_preview = str(response.content)[:500]
                    elif isinstance(response, str):
                        result_preview = response[:500]
                    else:
                        result_preview = str(response)[:500]
                else:
                    result_preview = "Session not found or agent not ready"
                    status = "error"
            except Exception as exc:
                logger.exception("scheduler task execution failed")
                result_preview = f"Error: {exc}"[:500]
                status = "error"
        else:
            result_preview = "No session associated with this task"
            status = "error"

    except Exception as exc:
        logger.exception("scheduler task failed")
        result_preview = f"Error: {exc}"[:500]
        status = "error"

    duration_ms = int((time.time() - start_time) * 1000)

    # Update task status
    if tid in _scheduled_tasks:
        if _scheduled_tasks[tid].get("schedule") == "once":
            _scheduled_tasks[tid]["status"] = "completed"
        else:
            _scheduled_tasks[tid]["status"] = "scheduled"
            # Calculate next run time
            schedule = _scheduled_tasks[tid].get("schedule", "")
            if schedule.startswith("interval:"):
                interval_s = int(schedule.split(":", 1)[1])
                next_run = datetime.fromtimestamp(time.time() + interval_s)
                _scheduled_tasks[tid]["next_run"] = next_run.isoformat()

    # Emit completion notification
    _emit("background.complete", session_id, {
        "task_id": tid,
        "task_name": task_name,
        "status": status,
        "result_preview": result_preview,
        "duration_ms": duration_ms,
        "session_id": session_id,
    })

    logger.info("Scheduled task %s completed: %s (%.1fs)", tid, status, duration_ms / 1000)
