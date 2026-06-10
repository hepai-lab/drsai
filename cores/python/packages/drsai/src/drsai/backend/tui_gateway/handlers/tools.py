"""Tools / interactive prompt response handlers.

Methods registered:
    approval.respond   — UI delivers user's approval choice
    clarify.respond    — UI delivers user's clarification answer
    secret.respond     — UI delivers a secret value (API key, password)
    sudo.respond       — UI delivers a sudo password

All four follow the same shape: pop the pending Event by ``request_id``, store
the answer in :data:`server._answers`, set the Event so the blocked agent
thread can resume.
"""

from __future__ import annotations

from ..server import _answers, _err, _ok, _pending, method


def _respond(rid, params: dict, *, value_key: str = "choice") -> dict:
    request_id = params.get("request_id") or ""
    if not request_id:
        return _err(rid, 4002, "request_id is required")

    pending = _pending.get(request_id)
    if pending is None:
        return _err(rid, 4001, f"no pending request: {request_id}")

    value = params.get(value_key)
    if value is None:
        value = ""
    _answers[request_id] = str(value)
    _, ev = pending
    ev.set()
    return _ok(rid, {"ok": True})


@method("approval.respond")
def _approval_respond(rid, params: dict) -> dict:
    return _respond(rid, params, value_key="choice")


@method("clarify.respond")
def _clarify_respond(rid, params: dict) -> dict:
    return _respond(rid, params, value_key="answer")


@method("secret.respond")
def _secret_respond(rid, params: dict) -> dict:
    return _respond(rid, params, value_key="value")


@method("sudo.respond")
def _sudo_respond(rid, params: dict) -> dict:
    return _respond(rid, params, value_key="password")
