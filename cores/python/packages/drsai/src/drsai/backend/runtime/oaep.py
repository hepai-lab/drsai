from __future__ import annotations

import copy
import re
from pathlib import PurePosixPath, PureWindowsPath
from typing import Any

from drsai.backend.runtime.security import redact_sensitive
from drsai.relay.security import redact_credentials, redact_secrets


OAEP_VERSION = "1.0"
_WINDOWS_ABSOLUTE = re.compile(r"^[A-Za-z]:[\\/]")
_URI_SCHEME = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*:")


def _safe_text(value: Any, *, limit: int = 1_048_576) -> str:
    # Preserve stable diagnostic fields such as ``error_code`` inside JSON
    # text while still removing credentials. ``redact_secrets`` treats every
    # generic ``code`` value as OAuth-sensitive and corrupts public Runtime
    # error contracts (for example service_unavailable).
    redacted = redact_sensitive(redact_credentials("" if value is None else str(value)), "", "content")
    text = str(redacted)
    return text if len(text) <= limit else f"{text[:limit]}[TRUNCATED {len(text) - limit} CHARS]"


def _safe_mapping(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    result: dict[str, Any] = {}
    for key, child in value.items():
        safe_key = str(key)
        if _is_sensitive_public_key(safe_key):
            continue
        if safe_key in {"path", "old_path", "new_path", "relative_path"}:
            path = _relative_path(child)
            if path:
                result[safe_key] = path
            continue
        result[safe_key] = _safe_value(child, key=safe_key)
    return result


def _safe_value(value: Any, *, key: str = "") -> Any:
    if _is_sensitive_public_key(key):
        return "[REDACTED]"
    if isinstance(value, dict):
        return _safe_mapping(value)
    if isinstance(value, (list, tuple)):
        return [_safe_value(item) for item in list(value)[:100]]
    if isinstance(value, str):
        return _safe_text(value)
    return redact_sensitive(value, key, "content")


def safe_error(value: Any) -> dict[str, Any]:
    """Project a backend error with credentials redacted and prose preserved."""
    result = _safe_mapping(value)
    raw_message = value.get("message") if isinstance(value, dict) else None
    if isinstance(raw_message, str):
        # Error response bodies are the primary debugging evidence.  Preserve
        # them in full while replacing only credential values.
        result["message"] = redact_credentials(raw_message)
    return result


def _is_sensitive_public_key(key: str) -> bool:
    return bool(re.search(
        r"(?:token|password|secret|private.?key|authorization|api.?key|credential|cookie|idempotency.?key|"
        r"command|raw.?arguments|file.?content)",
        key,
        re.I,
    ))


def _relative_path(value: Any) -> str | None:
    raw = str(value or "").replace("\\", "/").strip()
    if not raw:
        return None
    if raw.startswith("/") or _WINDOWS_ABSOLUTE.match(raw) or _URI_SCHEME.match(raw):
        return PureWindowsPath(raw).name or PurePosixPath(raw).name or None
    path = PurePosixPath(raw)
    if any(part in {"", ".", ".."} for part in path.parts):
        return PurePosixPath(raw).name or None
    return path.as_posix()


def _safe_command(value: Any) -> list[str]:
    if isinstance(value, list):
        return [_safe_text(part, limit=1000) for part in value[:100]]
    if value is None:
        return []
    return [_safe_text(value, limit=4000)]


def _safe_stream_output(payload: dict[str, Any]) -> str:
    return _safe_text(
        payload.get("output")
        or payload.get("stdout_tail")
        or payload.get("stderr_tail")
        or payload.get("delta")
        or payload.get("summary")
        or payload.get("result")
        or ""
    )


def _safe_attachment_ref(value: Any) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    if _WINDOWS_ABSOLUTE.match(raw) or raw.startswith("/"):
        name = PureWindowsPath(raw.replace("\\", "/")).name or PurePosixPath(raw).name
        suffix = PurePosixPath(name).suffix
        safe = _safe_text(name)
        # Generic credential redaction intentionally consumes until a delimiter;
        # preserve the harmless file extension needed by attachment renderers.
        if suffix and not safe.lower().endswith(suffix.lower()):
            safe = f"{safe}{suffix}"
        return safe
    return _safe_text(raw, limit=1000)


def _safe_operation_ref(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    required = ("operation_id", "workspace_id", "operation", "correlation_id")
    if value.get("protocol") not in {None, "owop/1"} or not all(value.get(key) for key in required):
        return None
    # Historical adapters could persist free-form tool names here.  An invalid
    # optional OWOP reference must not invalidate the entire OAEP Snapshot.
    # Drop the reference at the projection boundary; the Tool Item remains
    # authoritative and its content is preserved.
    operation = str(value["operation"]).strip()
    if len(operation) > 128 or re.fullmatch(r"[a-z][a-z0-9_]*\.[a-z][a-z0-9_.]*", operation) is None:
        return None
    return {
        "protocol": "owop/1",
        **{key: _safe_text(value[key], limit=256) for key in required},
    }


def sanitize_persisted_item(value: Any) -> dict[str, Any]:
    """Normalize optional references on a canonical Item loaded from storage.

    Older Runtime versions allowed free-form OWOP operation names and extra
    reference properties.  Those rows are still valid conversation history,
    but their optional reference does not satisfy the frozen OAEP schema.  A
    read-boundary repair keeps the Item authoritative while omitting an
    unusable reference, and avoids mutating the durable journal in place.
    """
    if not isinstance(value, dict):
        return {}
    item = copy.deepcopy(value)
    content = item.get("content")
    if not isinstance(content, dict) or "operation_ref" not in content:
        return item
    operation_ref = _safe_operation_ref(content.get("operation_ref"))
    if operation_ref is None:
        content.pop("operation_ref", None)
    else:
        content["operation_ref"] = operation_ref
    return item


def _safe_resource_refs(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    allowed_types = {"workspace", "worktree", "file", "git", "process", "pty", "checkpoint", "artifact"}
    result: list[dict[str, Any]] = []
    for raw in value[:100]:
        if not isinstance(raw, dict) or raw.get("protocol") not in {None, "owop/1"}:
            continue
        if not raw.get("workspace_id") or not raw.get("resource_id") or raw.get("resource_type") not in allowed_types:
            continue
        ref = {
            "protocol": "owop/1",
            "workspace_id": _safe_text(raw["workspace_id"], limit=256),
            "resource_type": str(raw["resource_type"]),
            "resource_id": _safe_text(raw["resource_id"], limit=256),
        }
        for key in ("operation_id", "label", "digest"):
            if raw.get(key):
                ref[key] = _safe_text(raw[key], limit=512)
        result.append(ref)
    return result


def _safe_interaction_options(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    options: list[dict[str, Any]] = []
    for index, option in enumerate(value[:100]):
        if isinstance(option, dict):
            options.append(_safe_mapping(option))
            continue
        label = _safe_text(option, limit=512)
        if label:
            options.append({"id": label[:256] or f"option-{index + 1}", "label": label})
    return options


def _status(value: str | None) -> str:
    mapping = {
        "active": "active",
        "archived": "archived",
        "removed": "deleted",
        "queued": "queued",
        "running": "running",
        "waiting_approval": "waiting",
        "cancel_requested": "cancelled",
        "completed": "completed",
        "failed": "failed",
        "cancelled": "cancelled",
    }
    return mapping.get(str(value or ""), "active")


def _text(payload: dict[str, Any]) -> str:
    value = (
        payload.get("content")
        or payload.get("text")
        or payload.get("output")
        or payload.get("delta")
        or payload.get("summary")
        or payload.get("message")
        or payload.get("name")
        or ""
    )
    return _safe_text(value)


def _delta_text(payload: dict[str, Any]) -> str:
    value = payload.get("delta")
    if value is None:
        value = payload.get("content") or payload.get("text") or ""
    return _safe_text(value)


def _item_type(kind: str, payload: dict[str, Any]) -> str:
    normalized = str(payload.get("normalized_item_type") or "")
    if normalized in {
        "message", "reasoning", "plan", "command_execution", "file_change",
        "tool_call", "artifact", "interaction", "subtask", "notice",
    }:
        return normalized
    if kind in {"message", "reasoning", "plan", "artifact", "file_change", "subtask"}:
        return kind
    if kind == "approval":
        return "interaction"
    if kind == "error":
        return "notice"
    if kind == "tool":
        name = str(payload.get("name") or payload.get("tool_name") or "").lower()
        if (
            payload.get("command") is not None
            or str(payload.get("event_type") or "").startswith("agent.item.command")
            or name in {"shell", "terminal", "command", "powershell", "cmd"}
        ):
            return "command_execution"
        return "tool_call"
    return "notice"


def _item_status(payload: dict[str, Any]) -> str:
    raw = str(payload.get("status") or "").lower()
    if raw in {"pending", "running", "waiting", "completed", "failed", "cancelled"}:
        return raw
    if raw in {"streaming", "started", "progress"}:
        return "running"
    if raw in {"approved", "declined", "denied"}:
        return "completed"
    if raw in {"error"}:
        return "failed"
    return "completed" if raw else "running"


def _source(item: dict[str, Any] | None = None, event: dict[str, Any] | None = None) -> dict[str, Any]:
    source: dict[str, Any] = {"backend": "runtime"}
    if item is not None:
        source["backend_item_id"] = str(item.get("item_id") or "")
        if item.get("source_client") and str(item.get("source_client")) != "runtime":
            source["client"] = _safe_text(item.get("source_client"), limit=80)
        if item.get("source_message_id"):
            source["message_id"] = _safe_text(item.get("source_message_id"), limit=256)
    if event is not None:
        source["backend_event_id"] = str(event.get("event_id") or "")
        if event.get("runtime_id"):
            source["runtime_id"] = str(event["runtime_id"])
    return {key: value for key, value in source.items() if value}


def project_session(session: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(session["session_id"]),
        "workspace_id": str(session["workspace_id"]),
        "title": str(session.get("title") or ""),
        "status": _status(str(session.get("lifecycle") or "active")),
        "backend": str(session.get("backend_id") or session.get("agent_definition") or "runtime"),
        "created_at": str(session["created_at"]),
        "updated_at": str(session["updated_at"]),
    }


def project_run(run: dict[str, Any]) -> dict[str, Any]:
    result = {
        "id": str(run["run_id"]),
        "session_id": str(run["session_id"]),
        "parent_run_id": str(run["parent_run_id"]) if run.get("parent_run_id") else None,
        **({"sequence": int(run["backend_run_index"]) + 1}
           if run.get("backend_run_index") is not None else {}),
        "source": {
            "backend": str(run.get("backend_id") or "runtime"),
            **({"backend_run_id": str(run["backend_run_id"])} if run.get("backend_run_id") else {}),
            **({"backend_run_index": int(run["backend_run_index"])} if run.get("backend_run_index") is not None else {}),
            **({"mapping_version": str(run["mapping_version"])} if run.get("mapping_version") else {}),
        },
        "status": _status(str(run.get("status") or "queued")),
        "created_at": str(run["created_at"]),
        "updated_at": str(run.get("completed_at") or run.get("started_at") or run["created_at"]),
        "completed_at": str(run["completed_at"]) if run.get("completed_at") else None,
    }
    if run.get("correlation_id"):
        result["correlation_id"] = _safe_text(run.get("correlation_id"), limit=256)
    if run.get("attachment_refs"):
        refs = run.get("attachment_refs")
        if isinstance(refs, list):
            result["attachment_refs"] = [ref for ref in (_safe_attachment_ref(item) for item in refs[:100]) if ref]
        else:
            ref = _safe_attachment_ref(refs)
            result["attachment_refs"] = [ref] if ref else []
    return result


def project_item(item: dict[str, Any]) -> dict[str, Any]:
    payload = item.get("payload") if isinstance(item.get("payload"), dict) else {}
    kind = str(item.get("kind") or "")
    item_type = _item_type(kind, payload)
    content: dict[str, Any]
    if item_type == "message":
        raw_parts = payload.get("parts") if isinstance(payload.get("parts"), list) else []
        parts = []
        for raw_part in raw_parts[:100]:
            if not isinstance(raw_part, dict):
                continue
            part_type = str(raw_part.get("type") or "")
            if part_type not in {"text", "image", "audio", "file", "resource_ref"}:
                continue
            part = {"type": part_type}
            for key in ("text", "url", "name", "mime_type"):
                if isinstance(raw_part.get(key), str) and raw_part.get(key):
                    part[key] = _safe_text(raw_part[key], limit=16384 if key == "url" else 8000)
            resource_ref = _safe_resource_refs([raw_part.get("resource_ref")])
            if resource_ref:
                part["resource_ref"] = resource_ref[0]
            parts.append(part)
        content = {
            "role": item.get("role") if item.get("role") in {"user", "assistant", "system"} else "assistant",
            "phase": str(payload.get("phase") or "final"),
            "text": _text(payload),
            "parts": parts,
            "citations": payload.get("citations") if isinstance(payload.get("citations"), list) else [],
        }
    elif item_type == "reasoning":
        raw_segments = payload.get("segments") if isinstance(payload.get("segments"), list) else []
        segments = []
        for index, raw_segment in enumerate(raw_segments[:100]):
            if not isinstance(raw_segment, dict):
                continue
            segment_text = _safe_text(raw_segment.get("text") or "")
            if segment_text:
                segments.append({
                    "id": _safe_text(raw_segment.get("id") or f"{item['item_id']}:segment:{index + 1}", limit=256),
                    "text": segment_text,
                })
        if not segments and _text(payload):
            segments.append({"id": f"{item['item_id']}:text", "text": _text(payload)})
        content = {"segments": segments}
    elif item_type == "plan":
        steps = []
        for index, step in enumerate(payload.get("steps") if isinstance(payload.get("steps"), list) else []):
            if not isinstance(step, dict):
                continue
            status = str(step.get("status") or "pending")
            if status == "inProgress":
                status = "running"
            if status not in {"pending", "running", "completed", "failed", "cancelled"}:
                status = "pending"
            steps.append({
                "id": _safe_text(step.get("id") or f"{item['item_id']}:step:{index + 1}", limit=256),
                "title": _safe_text(step.get("title") or step.get("step") or "", limit=2000),
                "status": status,
            })
        content = {
            "explanation": _safe_text(payload.get("explanation") or ""),
            "text": _text(payload),
            "steps": steps,
        }
    elif item_type == "command_execution":
        command = payload.get("command")
        display_command = (
            payload.get("display_command")
            or payload.get("summary")
            or (" ".join(str(part) for part in command) if isinstance(command, list) else command)
            or payload.get("name")
            or ""
        )
        content = {
            "command": _safe_command(command),
            "display_command": _safe_text(display_command),
            "cwd": _relative_path(payload.get("cwd")) or ".",
            "output": _safe_stream_output(payload),
            "stdout_tail": _safe_text(payload.get("stdout_tail") or ""),
            "stderr_tail": _safe_text(payload.get("stderr_tail") or ""),
            "exit_code": payload.get("exit_code"),
            "duration_ms": payload.get("duration_ms"),
            "replay_policy": _safe_mapping(payload.get("replay_policy")),
        }
    elif item_type == "tool_call":
        content = {
            "tool_kind": str(payload.get("tool_kind") or payload.get("kind") or "tool"),
            "tool_name": str(payload.get("tool_name") or payload.get("name") or "tool"),
            "server": payload.get("server"),
            "call_id": str(payload.get("call_id") or payload.get("tool_id") or item["item_id"]),
            # OAEP v1 froze these public field names as ``arguments`` and
            # ``result``.  Keep the values bounded/redacted here rather than
            # exposing the pre-OAEP ``*_summary`` compatibility names.
            "arguments": _safe_mapping(payload.get("arguments")),
            "result": _safe_value(payload.get("result", payload.get("output", payload.get("summary")))),
            "duration_ms": payload.get("duration_ms"),
            "replay_policy": _safe_mapping(payload.get("replay_policy")),
        }
    elif item_type == "interaction":
        request = payload.get("request") if isinstance(payload.get("request"), dict) else payload
        decision = payload.get("decision") if isinstance(payload.get("decision"), dict) else None
        content = {
            "interaction_type": str(payload.get("interaction_type") or request.get("interaction_type") or "approval"),
            "approval_id": payload.get("approval_id"),
            "operation": _safe_text(request.get("operation") or request.get("tool") or request.get("name") or "", limit=256),
            "prompt": _safe_text(
                payload.get("prompt")
                or request.get("prompt")
                or request.get("risk_summary")
                or payload.get("summary")
                or payload.get("message")
                or "Approval requested"
            ),
            "options": _safe_interaction_options(payload.get("options") or request.get("options") or []),
            "request_summary": _safe_mapping(request),
            "related_item_id": payload.get("related_item_id"),
            "response": _safe_value(decision),
            "deadline_at": payload.get("deadline_at"),
        }
    elif item_type == "artifact":
        content = {
            "artifact_id": str(payload.get("artifact_id") or payload.get("id") or item["item_id"]),
            "artifact_type": str(payload.get("artifact_type") or "file"),
            "name": _safe_text(payload.get("name") or item["item_id"], limit=512),
            "path": _relative_path(payload.get("relative_path") or payload.get("path")),
            "mime_type": _safe_text(payload.get("mime_type") or "", limit=256) or None,
            "summary": _safe_text(payload.get("summary") or ""),
            "size": payload.get("size"),
            "sha256": _safe_text(payload.get("sha256") or "", limit=128) or None,
            "previewable": bool(payload.get("previewable", False)),
            "downloadable": bool(payload.get("downloadable", False)),
        }
    elif item_type == "file_change":
        changes = []
        if isinstance(payload.get("changes"), list):
            for change in payload["changes"][:200]:
                if not isinstance(change, dict):
                    continue
                changes.append({
                    **{
                        key: _safe_text(value, limit=1000)
                        for key, value in change.items()
                        if key not in {"path", "old_path", "new_path", "diff", "content"}
                        and not _is_sensitive_public_key(str(key))
                    },
                    **({"path": path} if (path := _relative_path(change.get("path"))) else {}),
                    **({"old_path": path} if (path := _relative_path(change.get("old_path"))) else {}),
                    **({"new_path": path} if (path := _relative_path(change.get("new_path"))) else {}),
                    **({"diff_summary": _safe_text(change.get("diff_summary") or change.get("diff") or "", limit=4000)}
                       if change.get("diff_summary") or change.get("diff") else {}),
                })
        content = {
            "changes": changes,
            "summary": str(payload.get("summary") or payload.get("description") or _text(payload)),
        }
    elif item_type == "subtask":
        content = {
            "title": _safe_text(payload.get("title") or payload.get("prompt") or payload.get("tool") or "Subtask"),
            "agent_name": _safe_text(payload.get("agent_name") or payload.get("agentName") or "", limit=256) or None,
            "child_run_id": _safe_text(
                payload.get("child_run_id") or payload.get("newThreadId") or payload.get("receiverThreadId") or "",
                limit=256,
            ) or None,
            "summary": _safe_text(payload.get("summary") or payload.get("result") or ""),
            "result": _safe_value(payload.get("result")),
        }
    else:
        details = _safe_mapping(payload.get("details"))
        content = {
            "level": str(payload.get("level") or ("error" if kind == "error" else "info")),
            "code": _safe_text(payload.get("code") or kind or "runtime_notice", limit=200),
            "message": _text(payload),
            "error": {
                "code": _safe_text(payload.get("code") or kind or "runtime_notice", limit=200),
                "message": _text(payload) or "Runtime notice",
                "retryable": bool(details.get("retryable", payload.get("retryable", False))),
                "source": _safe_text(payload.get("source") or "agent_core", limit=128),
                "safe_details": details,
            },
            "details": details,
        }
    operation_ref = _safe_operation_ref(payload.get("operation_ref"))
    if operation_ref is not None:
        content["operation_ref"] = operation_ref
    resource_refs = _safe_resource_refs(payload.get("resource_refs"))
    if resource_refs:
        content["resource_refs"] = resource_refs
    source = _source(item=item)
    if payload.get("backend"):
        source["backend"] = _safe_text(payload["backend"], limit=128)
    for key in ("mapping_version", "adapter", "adapter_version", "backend_version", "backend_run_id"):
        if payload.get(key):
            source[key] = _safe_text(payload[key], limit=512)
    if payload.get("backend_run_index") is not None:
        source["backend_run_index"] = int(payload["backend_run_index"])
    return {
        "id": str(item["item_id"]),
        "session_id": str(item["session_id"]),
        "run_id": str(item["run_id"]) if item.get("run_id") else "",
        "type": item_type,
        "status": _item_status(payload),
        "sequence": int(
            item.get("oaep_item_sequence")
            or item.get("sequence")
            or item.get("session_sequence")
            or 1
        ),
        "created_at": str(item["created_at"]),
        "updated_at": str(item["updated_at"]),
        "source": source,
        "content": content,
    }


def _delta_kind(item_type: str) -> str:
    return {
        "message": "message.text.append",
        "reasoning": "reasoning.text.append",
        "plan": "plan.text.append",
        "command_execution": "command.output.append",
        "tool_call": "tool.output.append",
        "subtask": "subtask.summary.append",
    }.get(item_type, "message.text.append")


def _event_type(kind: str, payload: dict[str, Any]) -> str:
    if kind.startswith("conversation.item.") and not payload.get("item_id"):
        return "event.run.resumed"
    if kind == "session.archived":
        return "event.session.archived"
    if kind == "session.removed":
        return "event.session.deleted"
    if kind == "session.updated":
        return "event.session.updated"
    if kind == "run.created":
        return "event.run.created"
    if kind == "run.state.changed":
        status = _status(str(payload.get("status") or ""))
        if status == "running" and payload.get("reason") in {"approval_resolved", "resumed"}:
            return "event.run.resumed"
        return {
            "running": "event.run.started",
            "waiting": "event.run.waiting",
            "completed": "event.run.completed",
            "failed": "event.run.failed",
            "cancelled": "event.run.cancelled",
        }.get(status, "event.run.resumed")
    if kind == "conversation.item.delta":
        return "event.item.delta"
    if kind == "conversation.item.created":
        item_payload = payload.get("payload") if isinstance(payload.get("payload"), dict) else {}
        status = _item_status(item_payload)
        if status == "completed":
            return "event.item.completed"
        if status == "failed":
            return "event.item.failed"
        if status == "cancelled":
            return "event.item.cancelled"
        return "event.item.started"
    if kind == "conversation.item.upsert":
        item_payload = payload.get("payload") if isinstance(payload.get("payload"), dict) else {}
        if item_payload.get("projection_correction") is True:
            return "event.item.updated"
        status = _item_status(item_payload)
        if status == "completed":
            return "event.item.completed"
        if status == "failed":
            return "event.item.failed"
        if status == "cancelled":
            return "event.item.cancelled"
        return "event.item.updated"
    if kind == "approval.created":
        return "event.run.waiting"
    if kind in {"approval.decided", "tool.state.changed", "artifact.created"}:
        return "event.item.updated"
    return "event.session.updated"


def project_event(event: dict[str, Any]) -> dict[str, Any]:
    payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
    event_type = _event_type(str(event.get("kind") or ""), payload)
    data: dict[str, Any] = {}
    item_id = event.get("item_id") or payload.get("item_id")
    if event_type.startswith("event.item.") and item_id:
        pseudo_item = {
            "item_id": str(item_id),
            "session_id": event["session_id"],
            "run_id": event.get("run_id") or "",
            "kind": str(payload.get("kind") or "notice"),
            "role": payload.get("role"),
            "source_client": payload.get("source_client") or event.get("source_client"),
            "source_message_id": payload.get("source_message_id") or event.get("source_message_id"),
            "session_sequence": event["session_sequence"],
            "created_at": payload.get("created_at") or event["timestamp"],
            "updated_at": payload.get("updated_at") or event["timestamp"],
            "payload": payload.get("payload") if isinstance(payload.get("payload"), dict) else {},
        }
        item = project_item(pseudo_item)
        if event_type == "event.item.delta":
            stream = pseudo_item["payload"].get("stream")
            reasoning_kind = pseudo_item["payload"].get("reasoning_kind")
            visibility = pseudo_item["payload"].get("visibility")
            reasoning_source = pseudo_item["payload"].get("reasoning_source")
            data["delta"] = {
                "kind": str(pseudo_item["payload"].get("delta_kind") or _delta_kind(item["type"])),
                "text": _delta_text(pseudo_item["payload"]),
                **({"segment_id": str(pseudo_item["payload"]["segment_id"])} if pseudo_item["payload"].get("segment_id") else {}),
                **({"stream": str(stream)} if stream in {"stdout", "stderr", "combined"} else {}),
                **({"reasoning_kind": str(reasoning_kind)} if reasoning_kind in {"summary", "commentary", "analysis"} else {}),
                **({"visibility": str(visibility)} if visibility in {"user", "diagnostic", "hidden"} else {}),
                **({"reasoning_source": str(reasoning_source)} if reasoning_source in {"backend", "adapter", "runtime"} else {}),
            }
        else:
            data["item"] = item
            if event_type == "event.item.failed":
                error = pseudo_item["payload"].get("error")
                if isinstance(error, dict):
                    code = _safe_text(
                        error.get("code") or "workspace_operation_failed", limit=200
                    )
                    data["error"] = {
                        "code": code,
                        "message": _safe_text(
                            error.get("message") or "Workspace operation failed."
                        ),
                        "retryable": bool(error.get("retryable", False)),
                        "details": _safe_mapping(
                            error.get("detail") or error.get("details")
                        ),
                        "source": (
                            "owop"
                            if code.startswith(("owop_", "process_", "pty_", "workspace_"))
                            else "agent_core"
                        ),
                    }
    elif event_type.startswith("event.run."):
        data = {
            "status": payload.get("status"),
            **({"reason": _safe_text(payload.get("reason"), limit=200)} if payload.get("reason") else {}),
            **({"error": safe_error(payload.get("error"))} if isinstance(payload.get("error"), dict) else {}),
        }
    elif event_type.startswith("event.session."):
        data = payload
    envelope = {
        "version": OAEP_VERSION,
        "event_id": str(event["event_id"]),
        "session_id": str(event["session_id"]),
        "sequence": int(event["session_sequence"]),
        "type": event_type,
        "timestamp": str(event["timestamp"]),
        **({"item_id": str(item_id)} if item_id else {}),
        **({"item_revision": int(event["item_revision"])} if event.get("item_revision") else {}),
        "dedupe_key": str(payload.get("runtime_event_id") or event["event_id"]),
        "source": _source(event=event),
        "data": data,
    }
    if event.get("run_id"):
        envelope["run_id"] = str(event["run_id"])
    return envelope


def project_snapshot(
    session: dict[str, Any],
    runs: list[dict[str, Any]],
    conversation_snapshot: dict[str, Any],
) -> dict[str, Any]:
    items = conversation_snapshot.get("items", [])
    return {
        "version": OAEP_VERSION,
        "session": project_session(session),
        "runs": [
            project_run(run)
            for run in sorted(
                runs,
                key=lambda value: (
                    int(value["backend_run_index"])
                    if value.get("backend_run_index") is not None else 2**63 - 1,
                    str(value.get("created_at") or ""), str(value.get("run_id") or ""),
                ),
            )
        ],
        "items": [
            item
            if isinstance(item, dict)
            and {"id", "type", "status", "source", "content"} <= set(item)
            else project_item(item)
            for item in items
        ],
        "snapshot_sequence": int(conversation_snapshot.get("snapshot_sequence") or 0),
    }


def project_openai_chat_completion_chunks(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Project OAEP message deltas to OpenAI-compatible chat completion chunks.

    This is a compatibility view only. It intentionally ignores tool,
    approval, file, artifact and notice semantics that only OAEP can express.
    """
    chunks: list[dict[str, Any]] = []
    for event in events:
        if event.get("type") == "event.item.delta":
            delta = event.get("data", {}).get("delta")
            if not isinstance(delta, dict) or delta.get("kind") != "message.text.append":
                continue
            text = str(delta.get("text") or "")
            if text:
                chunks.append({"choices": [{"delta": {"content": text}}]})
        elif event.get("type") == "event.item.completed":
            item = event.get("data", {}).get("item")
            if not isinstance(item, dict) or item.get("type") != "message":
                continue
            content = item.get("content") if isinstance(item.get("content"), dict) else {}
            if content.get("role") == "assistant":
                chunks.append({"choices": [{"finish_reason": "stop", "delta": {}}]})
    return chunks


def reduce_oaep_events(events: list[dict[str, Any]]) -> dict[str, Any]:
    """Deterministically rebuild an OAEP Snapshot from Session Event history."""
    session: dict[str, Any] | None = None
    runs: dict[str, dict[str, Any]] = {}
    items: dict[str, dict[str, Any]] = {}
    terminal_runs: set[str] = set()
    last_sequence = 0
    for event in events:
        sequence = int(event["sequence"])
        if sequence <= last_sequence:
            raise ValueError("OAEP Event sequence must be strictly increasing")
        last_sequence = sequence
        data = event.get("data") if isinstance(event.get("data"), dict) else {}
        event_type = str(event.get("type") or "")
        event_run_id = str(event.get("run_id") or "")
        if event_type in {"event.run.completed", "event.run.failed", "event.run.cancelled"}:
            if event_run_id in terminal_runs:
                raise ValueError("OAEP Run has more than one terminal Event")
            terminal_runs.add(event_run_id)
        if isinstance(data.get("session"), dict):
            session = copy.deepcopy(data["session"])
        if isinstance(data.get("run"), dict):
            run = copy.deepcopy(data["run"])
            runs[str(run["id"])] = run
        if isinstance(data.get("item"), dict):
            item = copy.deepcopy(data["item"])
            existing = items.get(str(item["id"]))
            if existing is not None and existing.get("type") != item.get("type"):
                raise ValueError("OAEP Item type is immutable")
            items[str(item["id"])] = item
        delta = data.get("delta")
        item_id = event.get("item_id")
        if isinstance(delta, dict) and item_id and str(item_id) not in items:
            kind = str(delta.get("kind") or "")
            item_type = {
                "message.text.append": "message",
                "reasoning.segment.added": "reasoning",
                "reasoning.text.append": "reasoning",
                "plan.text.append": "plan",
                "command.output.append": "command_execution",
                "tool.output.append": "tool_call",
                "subtask.summary.append": "subtask",
            }.get(kind)
            if item_type:
                content = {
                    "message": {"role": "assistant", "phase": "final", "text": "", "parts": [], "citations": []},
                    "reasoning": {"segments": []},
                    "plan": {"text": "", "steps": []},
                    "command_execution": {"command": [], "display_command": "", "cwd": ".", "output": "", "stdout_tail": "", "stderr_tail": "", "exit_code": None, "duration_ms": None},
                    "tool_call": {"tool_kind": "tool", "tool_name": "tool", "call_id": str(item_id), "arguments": {}, "result": ""},
                    "subtask": {"title": "Subtask", "summary": ""},
                }[item_type]
                items[str(item_id)] = {
                    "id": str(item_id), "session_id": str(event.get("session_id") or ""),
                    "run_id": event_run_id, "type": item_type, "status": "running",
                    "sequence": sequence, "created_at": str(event["timestamp"]),
                    "updated_at": str(event["timestamp"]), "source": copy.deepcopy(event.get("source") or {}),
                    "content": content,
                }
        if isinstance(delta, dict) and item_id and str(item_id) in items:
            item = items[str(item_id)]
            if item.get("status") in {"completed", "failed", "cancelled"}:
                raise ValueError("OAEP Item Delta cannot follow terminal state")
            content = item.get("content") if isinstance(item.get("content"), dict) else {}
            text = str(delta.get("text") or "")
            kind = str(delta.get("kind") or "")
            if kind == "message.text.append":
                content["text"] = str(content.get("text") or "") + text
            elif kind == "reasoning.segment.added":
                segments = content.setdefault("segments", [])
                segment_id = str(delta.get("segment_id") or f"{item_id}:segment:{len(segments) + 1}")
                if not any(isinstance(segment, dict) and str(segment.get("id")) == segment_id for segment in segments):
                    segments.append({
                        "id": segment_id, "text": text,
                        "kind": str(delta.get("reasoning_kind") or "summary"),
                        "visibility": str(delta.get("visibility") or "user"),
                        "source": str(delta.get("reasoning_source") or "backend"),
                    })
            elif kind == "reasoning.text.append":
                segments = content.setdefault("segments", [])
                segment_id = str(delta.get("segment_id") or f"{item_id}:text")
                target = next((segment for segment in segments if isinstance(segment, dict) and str(segment.get("id")) == segment_id), None)
                if target is None:
                    target = {
                        "id": segment_id, "text": "",
                        "kind": str(delta.get("reasoning_kind") or "summary"),
                        "visibility": str(delta.get("visibility") or "user"),
                        "source": str(delta.get("reasoning_source") or "backend"),
                    }
                    segments.append(target)
                target["text"] = str(target.get("text") or "") + text
            elif kind in {
                "plan.text.append",
                "command.output.append",
                "tool.output.append",
                "subtask.summary.append",
            }:
                if kind == "subtask.summary.append":
                    field = "summary"
                elif kind == "plan.text.append":
                    field = "text"
                elif kind == "tool.output.append":
                    field = "result"
                else:
                    field = "output"
                content[field] = str(content.get(field) or "") + text
                if kind == "command.output.append":
                    content.setdefault("stdout_tail", "")
                    content.setdefault("stderr_tail", "")
            item["content"] = content
            item["status"] = "running"
            item["updated_at"] = str(event["timestamp"])
    if session is None:
        raise ValueError("OAEP Event history does not contain Session state")
    return {
        "version": OAEP_VERSION,
        "session": session,
        "runs": sorted(runs.values(), key=lambda run: (run["created_at"], run["id"])),
        "items": sorted(
            items.values(), key=lambda item: (item["run_id"], item["sequence"], item["id"])
        ),
        "snapshot_sequence": last_sequence,
    }
