from __future__ import annotations

import json
import ast
import re
from typing import Any
from urllib.parse import urlsplit


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
    # OAEP stores citations on the assistant Message rather than as standalone
    # Items. Project them into the evidence collection without losing their
    # stable IDs or relation to the rendered Markdown part.
    for item in items:
        content = item.get("content") if isinstance(item.get("content"), dict) else {}
        if str(item.get("type") or "").lower() != "message":
            continue
        for raw in content.get("citations") or []:
            if not isinstance(raw, dict):
                continue
            url = str(raw.get("url") or raw.get("uri") or "")
            citation_id = str(raw.get("citation_id") or raw.get("citationId") or raw.get("id") or "")
            groups["citations"].append({
                **raw,
                "url": url,
                "citation_id": citation_id,
                "interactive": bool(url and url in str(content.get("text") or "")),
                "markdown_part_id": str(raw.get("markdown_part_id") or raw.get("markdownPartId") or f"{item.get('id')}:markdown"),
                "claim_ids": list(raw.get("claim_ids") or [str(item.get("id") or "assistant-message")]),
            })
    for artifact in groups["artifacts"]:
        if artifact.get("relative_path") is None and isinstance(artifact.get("path"), str):
            artifact["relative_path"] = artifact["path"]
    tool_calls = groups["tool_calls"]
    groups["skill_activations"].extend(
        item for item in tool_calls if str(item.get("tool_kind") or "") == "skill"
    )
    for item in tool_calls:
        if _name(item) != "Skill":
            continue
        arguments = item.get("arguments") if isinstance(item.get("arguments"), dict) else {}
        skill_id = str(arguments.get("skill") or "")
        if not skill_id:
            loaded = str(_tool_result(item).get("content") or "")
            match = re.search(r'<skill-loaded\s+name=["\']([A-Za-z0-9_.-]+)["\']', loaded)
            skill_id = match.group(1) if match else ""
        if skill_id:
            groups["skill_activations"].append({
                "skill_id": skill_id,
                "tool_name": skill_id,
                "status": "completed" if item.get("status") in {"completed", "success", None} else item.get("status"),
                "required_steps": ["instructions_loaded"],
                "call_id": item.get("call_id") or item.get("id"),
            })
    knowledge_calls = [item for item in tool_calls if _name(item) == "knowledge_search"]
    groups["knowledge_queries"].extend(knowledge_calls)
    for call in knowledge_calls:
        result = _tool_result(call)
        groups["retrieved_documents"].extend(
            item for item in result.get("documents") or [] if isinstance(item, dict)
        )
    operation_names = {
        "run_inspect": "run.inspect", "run_manifest_read": "run.manifest.read", "run_compare": "run.compare",
    }
    derived_references: list[dict[str, Any]] = []
    derived_comparison: dict[str, Any] | None = None
    derived_test_execution: dict[str, Any] | None = None
    fetched_urls: set[str] = set()
    retrieved_urls: set[str] = set()
    for call in tool_calls:
        name = _name(call)
        arguments = call.get("arguments") if isinstance(call.get("arguments"), dict) else {}
        result = _tool_result(call)
        if name in {"web_search", "web_fetch"}:
            serialized_result = json.dumps(result, ensure_ascii=False, sort_keys=True)
            urls = {
                value.rstrip(".,;:!?")
                for value in re.findall(r"https://[^\s<>\]\[(){}\"']+", serialized_result)
            }
            retrieved_urls.update(urls)
            if name == "web_fetch" and call.get("status") in {None, "completed", "success"}:
                fetched_urls.update(urls)
            inspection_value = _tool_inspection(call)
            inspected_urls = {
                str(inspection_value.get(key) or "")
                for key in ("requested_url", "final_url")
                if str(inspection_value.get(key) or "").startswith("https://")
            }
            retrieved_urls.update(inspected_urls)
            if name == "web_fetch" and call.get("status") in {None, "completed", "success"}:
                fetched_urls.update(inspected_urls)
        if name in {"run_read", "run_grep", "run_glob"}:
            groups["workspace_reads"].append({"tool": name, "arguments": arguments, "status": call.get("status")})
        if name in {"run_powershell", "run_bash"}:
            command = result.get("command") or arguments.get("command")
            groups["shell_commands"].append({
                "tool": name, "command": command, "argv": result.get("argv"),
                "exit_code": result.get("exit_code"), "output": result.get("output"),
                "policy": result.get("policy"),
            })
            inspection_value = _tool_inspection(call)
            if inspection_value.get("kind") == "test_execution":
                derived_test_execution = {
                    "command": {
                        "executable": (result.get("argv") or [None])[0],
                        "args": list(result.get("argv") or [])[1:],
                    },
                    "exit_code": result.get("exit_code"),
                    "output": result.get("output"),
                }
        operation = operation_names.get(_name(call))
        if operation is None:
            continue
        groups["operation_calls"].append({"operation": operation, **arguments})
        derived_references.extend(
            dict(item) for item in result.get("references") or [] if isinstance(item, dict)
        )
        if operation == "run.compare" and isinstance(result.get("comparison"), dict):
            derived_comparison = dict(result["comparison"])
    attempts = groups["tool_attempts"]
    if not attempts:
        attempts = [
            attempt
            for call in groups["tool_calls"]
            for attempt in ((call.get("attempts") or []) or (_tool_result(call).get("attempts") or []))
            if isinstance(attempt, dict)
        ]
    groups["tool_attempts"] = attempts
    capabilities = {_name(item) for item in groups["tool_calls"] + groups["skill_activations"]}
    if groups["knowledge_queries"]:
        capabilities.add("knowledge_search")
    capabilities.discard("")
    output = inspection.get("output") if "output" in inspection else run.get("output") if "output" in run else _last_assistant_text(items)
    generated_artifact_ids = {
        str(_tool_result(call).get("artifact_id"))
        for call in groups["tool_calls"] if _name(call) == "image_generation" and _tool_result(call).get("artifact_id")
    }
    for artifact in groups["artifacts"]:
        relative_path = str(artifact.get("relative_path") or artifact.get("path") or "")
        refs = artifact.get("resource_refs") if isinstance(artifact.get("resource_refs"), list) else []
        has_artifact_ref = any(
            isinstance(ref, dict)
            and ref.get("resource_type") == "artifact"
            and ref.get("resource_id") == artifact.get("artifact_id")
            for ref in refs
        )
        artifact["linked_in_output"] = bool(relative_path and isinstance(output, str) and relative_path in output)
        artifact["interactive"] = bool(
            artifact["linked_in_output"] and artifact.get("downloadable") is True and has_artifact_ref
        )
        artifact["run_relation"] = bool(artifact.get("run_id") and artifact.get("run_id") == run.get("run_id"))
        artifact["generation_call_relation"] = str(artifact.get("artifact_id") or "") in generated_artifact_ids
    for reference in derived_references:
        uri = str(reference.get("uri") or "")
        reference["interactive"] = bool(uri and isinstance(output, str) and uri in output)
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
        "comparison": inspection.get("comparison") or run.get("comparison") or derived_comparison,
        "references": [*(inspection.get("references") or []), *derived_references],
        "metrics": inspection.get("metrics") or {},
        "workspace": inspection.get("workspace") or {},
        "filesystem": inspection.get("filesystem") or {},
        "test_execution": inspection.get("test_execution") or derived_test_execution,
        "image": inspection.get("image"),
        "presentation": inspection.get("presentation"),
        "input_evidence": inspection.get("input_evidence"),
        "approval": inspection.get("approval"),
        "idempotency": inspection.get("idempotency"),
        "retry": inspection.get("retry") or _retry_evidence(attempts),
        "source_access": inspection.get("source_access") or ({
            "require_primary_source": bool(fetched_urls),
            "required_domains": sorted({
                str(urlsplit(url).hostname or "").lower()
                for url in fetched_urls if urlsplit(url).hostname
            }),
            "fetched_urls": sorted(fetched_urls),
            "retrieved_urls": sorted(retrieved_urls),
        } if retrieved_urls else None),
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


def _tool_result(call: dict[str, Any]) -> dict[str, Any]:
    value = call.get("result")
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            return {}
    if not isinstance(value, dict):
        return {}
    nested = value.get("result")
    if isinstance(nested, dict):
        return nested
    content = value.get("content")
    if isinstance(content, str):
        try:
            decoded = json.loads(content)
        except json.JSONDecodeError:
            try:
                decoded = ast.literal_eval(content)
            except (SyntaxError, ValueError):
                decoded = None
        if isinstance(decoded, dict):
            return decoded
    return value


def _tool_inspection(call: dict[str, Any]) -> dict[str, Any]:
    direct = call.get("inspection")
    if isinstance(direct, dict):
        return dict(direct)
    value = call.get("result")
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            return {}
    return dict(value.get("_inspection") or {}) if isinstance(value, dict) and isinstance(value.get("_inspection"), dict) else {}


def _retry_evidence(attempts: list[dict[str, Any]]) -> dict[str, Any] | None:
    failed = [item for item in attempts if item.get("status") == "failed"]
    completed = [item for item in attempts if item.get("status") == "completed"]
    if not failed or not completed:
        return None
    tools = {str(item.get("tool") or "") for item in attempts}
    return {
        "initiated_by": "runtime_policy", "exact": len(failed),
        "same_logical_operation": len(tools) == 1 and "" not in tools,
    }


def _last_assistant_text(items: list[dict[str, Any]]) -> str:
    for item in reversed(items):
        content = item.get("content") if isinstance(item.get("content"), dict) else item
        if content.get("role") == "assistant" and isinstance(content.get("text"), str):
            return content["text"]
    return ""
