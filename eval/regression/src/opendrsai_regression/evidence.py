from __future__ import annotations

import re
from typing import Any


SECRET_KEYS = {"authorization", "access_token", "api_key", "password", "secret", "token", "gateway_token", "idempotency_key"}
SECRET_NAME = re.compile(r"(^|_)(token|secret|password|api_?key|authorization)($|_)", re.IGNORECASE)
SECRET_TEXT = (
    (re.compile(r"Bearer\s+[A-Za-z0-9._~+/=-]+", re.IGNORECASE), "Bearer [REDACTED]"),
    (re.compile(r"\b(?:token|password|secret|api[_-]?key|credential)\s*[:=]\s*[^\s,;]+", re.IGNORECASE), "credential=[REDACTED]"),
    (re.compile(r"\bCookie\s*:\s*[^\r\n]+", re.IGNORECASE), "Cookie: [REDACTED]"),
    (re.compile(r"([a-z][a-z0-9+.-]*://)[^/@\s]+@", re.IGNORECASE), r"\1[REDACTED]@"),
)


def redact(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: "[REDACTED]" if key.lower() in SECRET_KEYS or SECRET_NAME.search(key) else redact(item) for key, item in value.items()}
    if isinstance(value, list):
        return [redact(item) for item in value]
    if isinstance(value, tuple):
        return [redact(item) for item in value]
    if isinstance(value, str):
        for pattern, replacement in SECRET_TEXT:
            value = pattern.sub(replacement, value)
        return value if len(value) <= 8_000 else value[:8_000] + "[TRUNCATED]"
    return value


def collect_evidence(*, run: dict[str, Any], inspection: dict[str, Any], snapshot: dict[str, Any], manifest: dict[str, Any]) -> dict[str, Any]:
    timeline, timeline_available = _items(inspection)
    snapshot_items, snapshot_available = _items(snapshot)
    items = timeline if timeline_available else snapshot_items
    type_groups = {
        "tool_calls": {"tool", "tool_call", "tool.call"},
        "tool_attempts": {"tool_attempt", "tool.attempt"},
        "citations": {"citation", "citation.added"},
        "artifacts": {"artifact", "artifact.created"},
        "skill_activations": {"skill", "skill_activation", "skill.activated"},
        "knowledge_queries": {"knowledge_query", "knowledge.search", "knowledge_retrieval"},
        "approvals": {"approval", "approval_required", "approval.decided"},
        "operation_calls": {"operation", "operation_call", "run.operation"},
        "shell_commands": {"shell_command", "command"},
        "workspace_reads": {"workspace_read", "file.read"},
        "workspace_writes": {"workspace_write", "file.write"},
        "retrieved_documents": {"retrieved_document", "knowledge.document"},
        "external_writes": {"external_write"},
        "external_network_calls": {"external_network_call"},
        "network_calls": {"network_call"},
        "unauthorized_writes": {"unauthorized_write"},
        "writes_outside_allowed_root": {"write_outside_allowed_root"},
        "file_creations": {"file_create"},
        "file_deletions": {"file_delete"},
        "patch_operations": {"patch"},
        "git_write_operations": {"git_write"},
        "workspace_search_calls": {"workspace_search"},
        "unrelated_tool_calls": {"unrelated_tool_call"},
        "unrelated_skill_activations": {"unrelated_skill_activation"},
    }
    groups = {name: _of_types(items, types) for name, types in type_groups.items()}
    for artifact in groups["artifacts"]:
        if artifact.get("relative_path") is None and isinstance(artifact.get("path"), str):
            artifact["relative_path"] = artifact["path"]
    tool_calls = groups["tool_calls"]
    groups["skill_activations"].extend(
        item for item in tool_calls if str(item.get("tool_kind") or "") == "skill"
    )
    knowledge_calls = [item for item in tool_calls if _name(item) == "knowledge_search"]
    groups["knowledge_queries"].extend(knowledge_calls)
    for call in knowledge_calls:
        result = call.get("result") if isinstance(call.get("result"), dict) else {}
        groups["retrieved_documents"].extend(
            item for item in result.get("documents") or [] if isinstance(item, dict)
        )
    attempts = groups["tool_attempts"]
    if not attempts:
        attempts = [attempt for call in groups["tool_calls"] for attempt in (call.get("attempts") or []) if isinstance(attempt, dict)]
    groups["tool_attempts"] = attempts
    capabilities = {_name(item) for item in groups["tool_calls"] + groups["skill_activations"]}
    if groups["knowledge_queries"]:
        capabilities.add("knowledge_search")
    capabilities.discard("")
    output = inspection.get("output") if "output" in inspection else run.get("output") if "output" in run else _last_assistant_text(items)
    missing = []
    if not run:
        missing.append("run")
    if not manifest:
        missing.append("manifest")
    if not (timeline_available or snapshot_available):
        missing.append("items")
    if inspection.get("_pagination_required") and inspection.get("page", {}).get("complete") is not True:
        missing.append("inspection_pagination")
    if snapshot.get("_pagination_required") and snapshot.get("window", {}).get("complete") is not True:
        missing.append("snapshot_pagination")
    evidence = {
        "run": run,
        "output": output,
        "items": items,
        **groups,
        "logical_tool_call_count": len(groups["tool_calls"]),
        "capabilities": sorted(capabilities),
        "manifest": manifest,
        "comparison": inspection.get("comparison") or run.get("comparison"),
        "references": inspection.get("references") or [],
        "metrics": inspection.get("metrics") or {},
        "workspace": inspection.get("workspace") or {},
        "filesystem": inspection.get("filesystem") or {},
        "test_execution": inspection.get("test_execution"),
        "image": inspection.get("image"),
        "presentation": inspection.get("presentation"),
        "input_evidence": inspection.get("input_evidence"),
        "approval": inspection.get("approval"),
        "idempotency": inspection.get("idempotency"),
        "retry": inspection.get("retry"),
        "source_access": inspection.get("source_access"),
        "available": {
            "run": bool(run), "manifest": bool(manifest), "items": timeline_available or snapshot_available,
            "inspection": bool(inspection), "snapshot": bool(snapshot),
        },
        "missing": missing,
        "evidence_complete": not missing,
    }
    return redact(evidence)


def _items(source: dict[str, Any]) -> tuple[list[dict[str, Any]], bool]:
    for key in ("timeline", "items", "data"):
        if key in source:
            value = source[key]
            return ([item for item in value if isinstance(item, dict)] if isinstance(value, list) else []), isinstance(value, list)
    return [], False


def _of_types(items: list[dict[str, Any]], types: set[str]) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for item in items:
        if str(item.get("type") or item.get("kind") or "").lower() not in types:
            continue
        content = item.get("content") if isinstance(item.get("content"), dict) else {}
        output.append({**item, **content})
    return output


def _name(item: dict[str, Any]) -> str:
    return str(item.get("tool") or item.get("tool_name") or item.get("skill") or item.get("skill_id") or item.get("operation") or item.get("name") or "")


def _last_assistant_text(items: list[dict[str, Any]]) -> str:
    for item in reversed(items):
        content = item.get("content") if isinstance(item.get("content"), dict) else item
        if content.get("role") == "assistant" and isinstance(content.get("text"), str):
            return content["text"]
    return ""
