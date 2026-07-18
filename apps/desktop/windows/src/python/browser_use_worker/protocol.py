from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal


CommandType = Literal["task.start", "action.approve", "task.stop"]


@dataclass
class WorkerCommand:
    type: CommandType
    taskId: str
    payload: dict[str, Any]


def make_event(event_type: str, task_id: str, **payload: Any) -> dict[str, Any]:
    return {"type": event_type, "taskId": task_id, **payload}
