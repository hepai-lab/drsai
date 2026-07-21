from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any, Callable


def read_worker_states(path: Path) -> dict[str, bool]:
    try:
        value = json.loads(path.read_text("utf-8"))
    except (OSError, ValueError):
        return {}
    return {str(key): bool(enabled) for key, enabled in value.items()} if isinstance(value, dict) else {}


async def discover_enabled_worker_tools(
    model_rows: list[Any],
    load_functions: Callable[[str], list[Callable[..., Any]]],
    state_path: Path,
    timeout: float = 5.0,
) -> tuple[list[Callable[..., Any]], list[dict[str, Any]]]:
    """Resolve enabled HepAI remote callables with timeout, dedupe and graceful degradation."""
    states = read_worker_states(state_path)
    tools: list[Callable[..., Any]] = []
    rows: list[dict[str, Any]] = []
    names: set[str] = set()
    for raw in model_rows:
        row = dict(raw) if isinstance(raw, dict) else dict(vars(raw))
        worker_id = str(row.get("id") or row.get("model") or "")
        if not worker_id:
            continue
        enabled = states.get(worker_id, True)
        functions: list[Callable[..., Any]] = []
        error: str | None = None
        if enabled:
            try:
                functions = await asyncio.wait_for(asyncio.to_thread(load_functions, worker_id), timeout=timeout)
            except Exception as exc:  # one worker must never disable the Gateway
                error = type(exc).__name__
        accepted: list[str] = []
        for function in functions:
            name = str(getattr(function, "__name__", ""))
            if not name or name in names:
                continue
            names.add(name); accepted.append(name); tools.append(function)
        row.update({"id": worker_id, "enabled": enabled, "callables": accepted, "status": "available" if accepted else "disabled" if not enabled else "unavailable"})
        if error: row["error"] = error
        rows.append(row)
    return tools, rows
