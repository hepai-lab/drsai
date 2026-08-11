"""Deterministic shared Plan state machine used by every Agent Kernel surface."""

from __future__ import annotations

import hashlib
import json
from typing import Any, Mapping, Sequence


PLAN_SCHEMA_VERSION = "p9-plan-state-v1"
STEP_STATUSES = frozenset({"pending", "in_progress", "completed", "failed"})
_TERMINAL_STEP_STATUSES = frozenset({"completed", "failed"})


def _canonical(value: Mapping[str, Any]) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _digest(value: Mapping[str, Any]) -> str:
    return hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()


def empty_plan() -> dict[str, Any]:
    return {}


def normalize_plan_update(current: Mapping[str, Any] | None, raw: Mapping[str, Any]) -> dict[str, Any]:
    previous = normalize_plan_state(current)
    expected_version = raw.get("expected_version")
    if not isinstance(expected_version, int) or isinstance(expected_version, bool) or expected_version < 0:
        raise ValueError("core_plan_expected_version_invalid")
    current_version = int(previous.get("version", 0))
    if expected_version != current_version:
        raise ValueError("core_plan_version_conflict")
    steps = _normalize_steps(raw.get("steps"))
    _validate_transition(previous.get("steps", []), steps)
    body = {
        "schema_version": PLAN_SCHEMA_VERSION,
        "item_id": str(previous.get("item_id") or raw.get("item_id") or "plan")[:160],
        "version": current_version + 1,
        "text": str(raw.get("text", ""))[:4_000],
        "explanation": str(raw.get("explanation", ""))[:2_000],
        "status": _plan_status(steps),
        "steps": steps,
    }
    if not body["item_id"]:
        raise ValueError("core_plan_item_id_invalid")
    return {**body, "sha256": _digest(body)}


def normalize_plan_state(raw: Mapping[str, Any] | None) -> dict[str, Any]:
    if not raw:
        return empty_plan()
    if raw.get("schema_version") != PLAN_SCHEMA_VERSION:
        raise ValueError("core_plan_schema_invalid")
    version = raw.get("version")
    if not isinstance(version, int) or isinstance(version, bool) or version <= 0:
        raise ValueError("core_plan_version_invalid")
    steps = _normalize_steps(raw.get("steps"))
    body = {
        "schema_version": PLAN_SCHEMA_VERSION,
        "item_id": str(raw.get("item_id", "")),
        "version": version,
        "text": str(raw.get("text", "")),
        "explanation": str(raw.get("explanation", "")),
        "status": _plan_status(steps),
        "steps": steps,
    }
    if not body["item_id"] or raw.get("status") != body["status"] or raw.get("sha256") != _digest(body):
        raise ValueError("core_plan_state_mismatch")
    return {**body, "sha256": raw["sha256"]}


def event_kind(plan: Mapping[str, Any]) -> str:
    if plan["status"] == "completed":
        return "plan.completed"
    if plan["status"] == "failed":
        return "plan.failed"
    return "plan.started" if plan["version"] == 1 else "plan.updated"


def _normalize_steps(raw: Any) -> list[dict[str, str]]:
    if not isinstance(raw, Sequence) or isinstance(raw, (str, bytes)) or not raw or len(raw) > 50:
        raise ValueError("core_plan_steps_invalid")
    result: list[dict[str, str]] = []
    seen: set[str] = set()
    in_progress = 0
    for index, value in enumerate(raw):
        if not isinstance(value, Mapping):
            raise ValueError("core_plan_step_invalid")
        step_id = str(value.get("id", f"step-{index + 1}"))[:128]
        title = value.get("title")
        status = value.get("status", "pending")
        if not step_id or step_id in seen or not isinstance(title, str) or not title.strip() or len(title) > 500:
            raise ValueError("core_plan_step_invalid")
        if status not in STEP_STATUSES:
            raise ValueError("core_plan_status_invalid")
        seen.add(step_id)
        in_progress += status == "in_progress"
        result.append({"id": step_id, "title": title.strip(), "status": status})
    if in_progress > 1:
        raise ValueError("core_plan_multiple_in_progress")
    return result


def _validate_transition(previous: Sequence[Mapping[str, Any]], current: Sequence[Mapping[str, Any]]) -> None:
    if not previous:
        return
    before = {str(step["id"]): step for step in previous}
    after = {str(step["id"]): step for step in current}
    if not before.keys() <= after.keys():
        raise ValueError("core_plan_step_removed")
    for step_id, old in before.items():
        new_status = after[step_id]["status"]
        old_status = old["status"]
        if old_status in _TERMINAL_STEP_STATUSES and new_status != old_status:
            raise ValueError("core_plan_terminal_step_changed")
        if old_status == "in_progress" and new_status == "pending":
            raise ValueError("core_plan_step_regressed")


def _plan_status(steps: Sequence[Mapping[str, Any]]) -> str:
    if any(step["status"] == "failed" for step in steps):
        return "failed"
    if all(step["status"] == "completed" for step in steps):
        return "completed"
    return "running"
