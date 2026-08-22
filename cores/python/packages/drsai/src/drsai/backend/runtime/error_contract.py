"""Backend-neutral, redacted error and recovery contract."""

from __future__ import annotations

import re
import uuid
from typing import Any, Mapping


ERROR_CATEGORIES = frozenset({
    "binding", "auth", "transport", "contract", "model", "approval",
    "resource", "history", "runtime", "backend", "unknown",
})
RECOVERY_ACTIONS = frozenset({
    "retry", "login", "sync", "repair", "new_task", "select_model",
    "remove_resource", "reconnect", "diagnostics",
})
_SECRET = re.compile(r"(?:token|secret|password|cookie|authorization|api.?key|credential|path|command|prompt)", re.I)
_SAFE_DETAIL_KEYS = frozenset({
    "request_id", "run_id", "event", "method", "bound_model", "requested_model",
    "maximum_queue_length", "received_bytes", "maximum_bytes", "reason",
    "approval_id",
})


def error_category(code: str) -> str:
    value = code.lower()
    if any(part in value for part in ("binding", "resume_required", "session_recovery", "session_model", "session_workspace")):
        return "binding"
    if any(part in value for part in ("auth", "token", "logged_in", "permission_denied")):
        return "auth"
    if "approval" in value:
        return "approval"
    if any(part in value for part in ("resource", "attachment", "workspace_escape", "disk_", "path_")):
        return "resource"
    if any(part in value for part in ("history", "cursor", "snapshot")):
        return "history"
    if "model" in value:
        return "model"
    if any(part in value for part in ("connection", "transport", "eof", "timeout", "network", "bridge")):
        return "transport"
    if any(part in value for part in ("contract", "schema", "protocol", "jsonrpc", "jsonl", "response_invalid")):
        return "contract"
    if any(part in value for part in ("runtime", "gateway", "run_")):
        return "runtime"
    if code:
        return "backend"
    return "unknown"


def recovery_actions(category: str, retryable: bool) -> list[str]:
    values: dict[str, list[str]] = {
        "binding": ["sync", "new_task", "diagnostics"],
        "auth": ["login", "retry", "diagnostics"],
        "transport": ["reconnect", "retry", "diagnostics"],
        "contract": ["repair", "diagnostics"],
        "model": ["select_model", "new_task", "diagnostics"],
        "approval": ["retry", "diagnostics"],
        "resource": ["remove_resource", "retry", "diagnostics"],
        "history": ["sync", "retry", "diagnostics"],
        "runtime": ["retry", "repair", "diagnostics"],
        "backend": ["retry", "diagnostics"],
        "unknown": ["diagnostics"],
    }
    actions = list(values.get(category, values["unknown"]))
    if not retryable and "retry" in actions:
        actions.remove("retry")
    return actions


def error_envelope(
    code: str,
    *,
    retryable: bool,
    details: Mapping[str, Any] | None = None,
    diagnostic_reference: str | None = None,
) -> dict[str, Any]:
    category = error_category(code)
    redacted = {
        str(key): value
        for key, value in dict(details or {}).items()
        if key in _SAFE_DETAIL_KEYS and not _SECRET.search(str(key))
        and isinstance(value, (str, int, float, bool, type(None)))
    }
    return {
        "code": code or "unexpected_error",
        "category": category,
        "retryable": bool(retryable),
        "user_message_key": f"errors.{category}.{code or 'unexpected_error'}",
        "recovery_actions": recovery_actions(category, retryable),
        "diagnostic_reference": diagnostic_reference or f"diag-{uuid.uuid4().hex[:16]}",
        "redacted_details": redacted,
    }
