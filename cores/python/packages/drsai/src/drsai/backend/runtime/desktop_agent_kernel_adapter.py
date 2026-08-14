"""Bind a production-style Desktop Agent host to the shared Kernel stream."""

from __future__ import annotations

import asyncio
import ast
import json
import base64
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
import hashlib
from pathlib import Path
import re
import shlex
import subprocess
import tempfile
import sys
from typing import Any, AsyncIterator, Callable, Mapping, Sequence
import uuid

from autogen_agentchat.base import TaskResult
from autogen_agentchat.messages import BaseAgentEvent, BaseChatMessage, TextMessage
from autogen_core import CancellationToken, Image
from autogen_core.tools import FunctionTool

from ...config.knowledge_registry import (
    KnowledgeResource,
    canonical_knowledge_id,
    index_local_files,
    put_knowledge_resource,
    search_local_knowledge_scope,
)
from .desktop_autogen_ports import (
    AgentKernelCheckpointPort,
    AutogenDesktopModelPort,
    AutogenDesktopToolPort,
    autogen_messages_to_kernel_history,
    autogen_tools_to_kernel_schemas,
)
from .desktop_kernel_coordinator import (
    DesktopApprovalResult,
    DesktopKernelCoordinator,
    DesktopToolResult,
)
from .desktop_kernel_run_stream import DesktopKernelRunStream, build_desktop_start_envelope
from .desktop_manager_ports import DesktopAgentManagerPorts


_REGRESSION_CONTROL: ContextVar[dict[str, Any] | None] = ContextVar(
    "desktop_regression_control", default=None,
)
_TRUSTED_EVIDENCE_DOMAINS: ContextVar[tuple[str, ...]] = ContextVar(
    "desktop_trusted_evidence_domains", default=(),
)


def trusted_evidence_domains(resources: Sequence[Mapping[str, Any]]) -> tuple[str, ...]:
    """Read Gateway-owned satisfied domains without exposing the control resource to the model."""
    for resource in resources:
        if resource.get("kind") != "selection" or resource.get("name") != "OpenDrSai trusted evidence":
            continue
        try:
            evidence = json.loads(str(resource.get("content") or ""))
        except json.JSONDecodeError as exc:
            raise ValueError("desktop_trusted_evidence_invalid") from exc
        domains = evidence.get("satisfied_capability_domains") if isinstance(evidence, dict) else None
        if not isinstance(domains, list) or not all(isinstance(value, str) for value in domains):
            raise ValueError("desktop_trusted_evidence_invalid")
        return tuple(sorted(set(domains)))
    return ()


@contextmanager
def desktop_regression_control_scope(resources: Sequence[Mapping[str, Any]]):
    # The Gateway and Agent manager may both establish this scope.  An inner
    # call with no control resources must inherit the outer trusted state;
    # otherwise image/web evidence accepted by the Gateway is silently lost
    # before the Kernel builds its verification requirement.
    control: dict[str, Any] | None = _REGRESSION_CONTROL.get()
    satisfied_domains = trusted_evidence_domains(resources) or _TRUSTED_EVIDENCE_DOMAINS.get()
    for resource in resources:
        if resource.get("kind") == "selection" and resource.get("name") == "OpenDrSai trusted evidence":
            continue
        if resource.get("kind") != "selection" or resource.get("name") != "OpenDrSai regression control":
            continue
        try:
            value = json.loads(str(resource.get("content") or ""))
        except json.JSONDecodeError as exc:
            raise ValueError("desktop_regression_control_invalid") from exc
        if not isinstance(value, dict) or value.get("schema_version") != "opendrsai.regression-control/1":
            raise ValueError("desktop_regression_control_invalid")
        control = {**value, "_invocations": {}}
        break
    token = _REGRESSION_CONTROL.set(control)
    evidence_token = _TRUSTED_EVIDENCE_DOMAINS.set(satisfied_domains)
    try:
        yield
    finally:
        _TRUSTED_EVIDENCE_DOMAINS.reset(evidence_token)
        _REGRESSION_CONTROL.reset(token)


def _controlled_tool_result(name: str) -> Mapping[str, Any] | None:
    control = _REGRESSION_CONTROL.get()
    if control is None:
        return None
    fixtures = control.get("tool_fixtures")
    fixture = fixtures.get(name) if isinstance(fixtures, Mapping) else None
    if fixture is None:
        return None
    successful = fixture.get("successful_result") if isinstance(fixture, Mapping) else None
    if not isinstance(successful, Mapping):
        raise ValueError("desktop_regression_fixture_invalid")
    invocations = control["_invocations"]
    invocation = int(invocations.get(name, 0)) + 1
    invocations[name] = invocation
    attempts: list[dict[str, Any]] = []
    for fault in control.get("tool_faults") or []:
        if not isinstance(fault, Mapping) or fault.get("tool") != name or invocation not in (fault.get("fail_invocations") or []):
            continue
        error = fault.get("error") if isinstance(fault.get("error"), Mapping) else {}
        attempts.append({
            "tool": name, "status": "failed",
            "error_code": str(error.get("code") or "service_unavailable"),
            "retryable": error.get("retryable") is True,
        })
    attempts.append({"tool": name, "status": "completed"})
    return {**dict(successful), "attempts": attempts, "regression_fixture": True}


def _controlled_tool_allowed(name: str) -> bool:
    control = _REGRESSION_CONTROL.get()
    if control is None:
        return True
    workspace = control.get("workspace") if isinstance(control.get("workspace"), Mapping) else {}
    if workspace.get("permission") == "read_only" and name in {
        "run_write", "run_edit", "run_bash_background", "kill_bash_task",
        "kill_powershell_task",
    }:
        return False
    if name == "run_edit" and isinstance(workspace.get("allowed_write_paths"), list):
        # Regression writes use one complete UTF-8 replacement operation. The
        # legacy edit DSL has broader path and patch semantics and is not part
        # of the Case contract.
        return False
    if control.get("network") != "disabled":
        forbidden = set(control.get("forbidden_capabilities") or [])
        return not (name == "image_edit" and "image_generation" in forbidden)
    if name not in {"web_search", "web_fetch", "image_generation", "image_edit"}:
        return True
    if name == "image_edit" and "image_generation" in set(control.get("forbidden_capabilities") or []):
        # Keep the protocol endpoint visible only so the Host can return a
        # structured, side-effect-free "not a viewer" result. Removing a Tool
        # between Responses continuation turns can make compatible providers
        # repeat the prior call and violate the request snapshot.
        return "pptx" in set(control.get("required_skills") or [])
    fixtures = control.get("tool_fixtures")
    return isinstance(fixtures, Mapping) and name in fixtures


def _controlled_command(
    arguments: Mapping[str, Any],
    work_dir: str = ".",
    skill_roots: Mapping[str, Path] | None = None,
) -> tuple[str, list[str]]:
    """Validate one foreground shell call against the Case's exact argv allowlist."""
    control = _REGRESSION_CONTROL.get()
    allowed = control.get("allowed_commands") if isinstance(control, Mapping) else None
    if not isinstance(allowed, list) or not allowed:
        raise ValueError("desktop_regression_command_not_allowed")
    if arguments.get("run_in_background") is True:
        raise ValueError("desktop_regression_background_command_forbidden")
    command = str(arguments.get("command") or "").strip()
    parsed_command = re.sub(r"^&\s+", "", command, count=1)
    if not parsed_command or any(value in parsed_command for value in ("\n", "\r", ";", "|", "&", ">", "<", "`")):
        raise ValueError("desktop_regression_command_shell_control_denied")
    matches: list[list[str]] = []
    denial_reasons: set[str] = set()
    for item in allowed:
        if not isinstance(item, Mapping):
            continue
        skill_script = item.get("skill_script")
        if isinstance(skill_script, Mapping):
            try:
                tokens = [part[1:-1] if len(part) >= 2 and part[0] == part[-1] and part[0] in {'\"', "'"} else part for part in shlex.split(parsed_command, posix=False)]
            except ValueError:
                denial_reasons.add("parse")
                continue
            if len(tokens) < 2 or Path(tokens[0]).name.casefold() not in {"python", "python.exe"}:
                denial_reasons.add("python_entry")
                continue
            script_token = Path(tokens[1])
            wanted_relative = Path(str(skill_script.get("relative_path") or ""))
            skill_id = str(skill_script.get("skill_id") or "")
            wanted_parts = (skill_id, *wanted_relative.parts)
            if script_token.is_absolute():
                script = script_token.resolve()
            elif tuple(part.casefold() for part in script_token.parts) == tuple(
                part.casefold() for part in wanted_relative.parts
            ):
                root = (skill_roots or {}).get(skill_id)
                if root is None:
                    denial_reasons.add("script_identity")
                    continue
                resolved_root = Path(root).resolve()
                script = (resolved_root / wanted_relative).resolve()
                if not script.is_relative_to(resolved_root):
                    denial_reasons.add("script_identity")
                    continue
            else:
                script = script_token.resolve()
            if not script.is_file() or tuple(part.casefold() for part in script.parts[-len(wanted_parts):]) != tuple(part.casefold() for part in wanted_parts):
                denial_reasons.add("script_identity")
                continue
            if hashlib.sha256(script.read_bytes()).hexdigest() != str(skill_script.get("sha256") or ""):
                denial_reasons.add("script_digest")
                continue
            actual_args = tokens[2:]
            specs = item.get("args")
            if not isinstance(specs, list) or len(actual_args) != len(specs):
                denial_reasons.add("argument_count")
                continue
            root = Path(work_dir).resolve()
            accepted = True
            for actual, spec in zip(actual_args, specs):
                if not isinstance(spec, Mapping):
                    accepted = False; break
                if "exact" in spec:
                    candidate = (root / actual).resolve() if not Path(actual).is_absolute() else Path(actual).resolve()
                    expected = (root / str(spec["exact"])).resolve()
                    accepted = candidate == expected and candidate.is_relative_to(root)
                elif spec.get("workspace_input_extension"):
                    candidate = (root / actual).resolve() if not Path(actual).is_absolute() else Path(actual).resolve()
                    accepted = candidate.is_relative_to(root) and candidate.is_file() and candidate.suffix.casefold() == str(spec["workspace_input_extension"]).casefold()
                else:
                    accepted = False
                if not accepted:
                    break
            if accepted:
                tokens[1] = str(script)
                matches.append(tokens)
            else:
                denial_reasons.add("argument_scope")
            continue
        argv = [str(item.get("executable") or ""), *[str(part) for part in item.get("args") or []]]
        if command == " ".join(argv):
            matches.append(argv)
    if len(matches) != 1:
        reason = sorted(denial_reasons)[0] if denial_reasons else "scope"
        raise ValueError(f"desktop_regression_command_{reason}_denied")
    return command, matches[0]


def _agent_skill_roots(agent: Any) -> dict[str, Path]:
    """Return loader-owned Skill roots; never discover executable paths by search."""
    loader = getattr(agent, "_cached_skills_loader", None)
    skills = getattr(loader, "skills", None)
    roots: dict[str, Path] = {}
    if isinstance(skills, Mapping):
        for skill_id, skill in skills.items():
            if not isinstance(skill_id, str) or not isinstance(skill, Mapping):
                continue
            root = skill.get("dir")
            if isinstance(root, (str, Path)):
                candidate = Path(root).resolve()
                if candidate.is_dir():
                    roots[skill_id] = candidate
    profile = getattr(agent, "_user_profile_manager", None)
    profile_root = getattr(profile, "skills_dir", None)
    if isinstance(profile_root, (str, Path)):
        base = Path(profile_root).resolve()
        control = _REGRESSION_CONTROL.get() or {}
        for item in control.get("allowed_commands") or []:
            skill_script = item.get("skill_script") if isinstance(item, Mapping) else None
            skill_id = str(skill_script.get("skill_id") or "") if isinstance(skill_script, Mapping) else ""
            candidate = (base / skill_id).resolve() if skill_id else None
            if candidate is not None and candidate.is_dir() and candidate.is_relative_to(base):
                roots.setdefault(skill_id, candidate)
    return roots


def _controlled_command_templates() -> list[str]:
    """Expose only safe relative command shapes already declared by the Case."""
    control = _REGRESSION_CONTROL.get() or {}
    templates: list[str] = []
    for item in control.get("allowed_commands") or []:
        if not isinstance(item, Mapping):
            continue
        if not isinstance(item.get("skill_script"), Mapping):
            executable = str(item.get("executable") or "").strip()
            args = item.get("args")
            if executable and isinstance(args, list) and all(isinstance(value, str) for value in args):
                templates.append(" ".join((executable, *args)))
            continue
        script = str(item["skill_script"].get("relative_path") or "")
        specs = item.get("args")
        if not script or not isinstance(specs, list) or not all(
            isinstance(spec, Mapping) and isinstance(spec.get("exact"), str) for spec in specs
        ):
            continue
        templates.append(" ".join(["python", script, *[str(spec["exact"]) for spec in specs]]))
    return templates


def _controlled_basic_tool_names() -> list[str]:
    """Return the minimum basic-tool elevation declared by the active Case."""
    control = _REGRESSION_CONTROL.get()
    if not isinstance(control, Mapping):
        return []
    names: list[str] = []
    workspace = control.get("workspace") if isinstance(control.get("workspace"), Mapping) else {}
    if workspace.get("fixture") or workspace.get("permission") == "read_only":
        names.extend(("run_read", "run_grep", "run_glob"))
    if control.get("allowed_commands"):
        names.append("run_powershell" if sys.platform == "win32" else "run_bash")
    return list(dict.fromkeys(names))


def _is_controlled_skill_script(argv: Sequence[str]) -> bool:
    if len(argv) < 2:
        return False
    script = Path(argv[1]).resolve()
    control = _REGRESSION_CONTROL.get() or {}
    for item in control.get("allowed_commands") or []:
        skill_script = item.get("skill_script") if isinstance(item, Mapping) else None
        if not isinstance(skill_script, Mapping):
            continue
        relative = Path(str(skill_script.get("relative_path") or ""))
        if (
            script.is_file()
            and script.name.casefold() == relative.name.casefold()
            and hashlib.sha256(script.read_bytes()).hexdigest() == str(skill_script.get("sha256") or "")
        ):
            return True
    return False


def _agent_execution_root(agent: Any) -> str:
    runtime_root = getattr(agent, "_runtime_workspace_path", None)
    if isinstance(runtime_root, (str, Path)):
        candidate = Path(runtime_root).resolve()
        if candidate.is_dir():
            return str(candidate)
    return str(getattr(agent, "_work_dir", "."))


def _controlled_tool_available(name: str) -> bool:
    """Return whether the active test Runtime owns a complete tool fixture."""
    control = _REGRESSION_CONTROL.get()
    if control is None or control.get("network") != "disabled":
        return False
    fixtures = control.get("tool_fixtures")
    return isinstance(fixtures, Mapping) and isinstance(fixtures.get(name), Mapping)


def _controlled_write_spec() -> Mapping[str, Any] | None:
    """Return the single fail-closed write tool declared by a regression Case."""
    control = _REGRESSION_CONTROL.get()
    configured = control.get("tools") if isinstance(control, Mapping) else None
    if not isinstance(configured, list):
        return None
    matches = [
        item for item in configured
        if isinstance(item, Mapping) and item.get("id") == "regression_controlled_write"
    ]
    if not matches:
        return None
    if len(matches) != 1:
        raise ValueError("desktop_regression_write_tool_ambiguous")
    spec = matches[0]
    if (
        spec.get("revision") != 1
        or spec.get("effect") != "write_local_mutable"
        or spec.get("approval") != "always_required"
        or spec.get("idempotency") != "required"
    ):
        raise ValueError("desktop_regression_write_tool_invalid")
    root = str(spec.get("allowed_root") or "")
    if not root or Path(root).is_absolute() or ".." in Path(root).parts:
        raise ValueError("desktop_regression_write_root_invalid")
    return spec


def _controlled_write_result(arguments: Mapping[str, Any], work_dir: str) -> Mapping[str, Any]:
    spec = _controlled_write_spec()
    control = _REGRESSION_CONTROL.get()
    if spec is None or control is None:
        raise ValueError("desktop_regression_write_tool_missing")
    relative = str(arguments.get("relative_path") or "")
    content = arguments.get("content")
    if not relative or not isinstance(content, str) or Path(relative).is_absolute():
        raise ValueError("desktop_regression_write_arguments_invalid")
    target_spec = control.get("controlled_write_target")
    if isinstance(target_spec, Mapping):
        expected_path = str(target_spec.get("relative_path") or "")
        expected_content = target_spec.get("content_utf8")
        if (
            relative == expected_path
            and isinstance(expected_content, str)
            and expected_content.endswith("\n")
            and content == expected_content[:-1]
        ):
            content = expected_content
    workspace = Path(work_dir).resolve(strict=True)
    allowed = (workspace / str(spec["allowed_root"])).resolve()
    target = (workspace / relative).resolve()
    if not allowed.is_relative_to(workspace) or not target.is_relative_to(allowed):
        raise ValueError("desktop_regression_write_scope_denied")
    if not allowed.is_dir() or not target.parent.is_dir():
        raise ValueError("desktop_regression_write_parent_missing")
    raw = content.encode("utf-8")
    digest = hashlib.sha256(raw).hexdigest()
    writes = control.setdefault("_controlled_writes", {})
    previous = writes.get(relative)
    if previous is not None:
        if previous.get("content_sha256") != digest:
            raise ValueError("desktop_regression_write_idempotency_conflict")
        return {**dict(previous), "idempotent_replay": True}
    if target.exists():
        raise ValueError("desktop_regression_write_target_exists")
    target.write_bytes(raw)
    result = {
        "relative_path": relative,
        "content_sha256": digest,
        "size_bytes": len(raw),
        "handler_execution_count": 1,
        "idempotent_replay": False,
    }
    writes[relative] = result
    return result


def _controlled_workspace_write(arguments: Mapping[str, Any], work_dir: str) -> Mapping[str, Any]:
    """Write UTF-8 text only inside Case-declared isolated output roots."""
    control = _REGRESSION_CONTROL.get()
    workspace_spec = control.get("workspace") if isinstance(control, Mapping) else None
    allowed_paths = workspace_spec.get("allowed_write_paths") if isinstance(workspace_spec, Mapping) else None
    if not isinstance(allowed_paths, list) or not allowed_paths:
        raise ValueError("desktop_regression_workspace_write_not_allowed")
    relative = str(arguments.get("path") or "")
    content = arguments.get("content")
    if not relative or Path(relative).is_absolute() or not isinstance(content, str):
        raise ValueError("desktop_regression_workspace_write_arguments_invalid")
    raw = content.encode("utf-8")
    if len(raw) > 2 * 1024 * 1024:
        raise ValueError("desktop_regression_workspace_write_too_large")
    root = Path(work_dir).resolve(strict=True)
    target = (root / relative).resolve()
    if not target.is_relative_to(root):
        raise ValueError("desktop_regression_workspace_write_scope_denied")
    allowed_roots = []
    for value in allowed_paths:
        if not isinstance(value, str) or not value or Path(value).is_absolute() or ".." in Path(value).parts:
            raise ValueError("desktop_regression_workspace_write_policy_invalid")
        allowed = (root / value).resolve()
        if not allowed.is_relative_to(root):
            raise ValueError("desktop_regression_workspace_write_policy_invalid")
        allowed_roots.append(allowed)
    if not any(target.is_relative_to(allowed) for allowed in allowed_roots):
        raise ValueError("desktop_regression_workspace_write_scope_denied")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(raw)
    return {
        "relative_path": target.relative_to(root).as_posix(),
        "content_sha256": hashlib.sha256(raw).hexdigest(),
        "size_bytes": len(raw),
        "policy": "regression_workspace_allowlist",
    }


def _controlled_knowledge_result(query: str, work_dir: str) -> Mapping[str, Any] | None:
    """Answer `knowledge_search` for a harness-provisioned corpus.

    This used to synthesize the tool result directly, so the regression corpus
    never went through the parser, the chunker or the retriever a real Knowledge
    Base uses, and its evidence could not fail the way production evidence
    fails. It now provisions the declared documents as an ordinary local-files
    Knowledge Base and searches that, keeping only the harness's identity and
    completeness claims.
    """

    prepared = _controlled_knowledge_corpus(work_dir)
    if prepared is None:
        return None
    config_dir, entries = prepared

    evidence: list[dict[str, Any]] = []
    documents: list[dict[str, Any]] = []
    corpus_complete = True
    supporting_match = False
    for resource, declared in entries:
        scope = search_local_knowledge_scope(
            config_dir, resource, query,
            top_k=_CONTROLLED_KNOWLEDGE_TOP_K,
            knowledge_base_revision=declared["revision"],
        )
        supporting_match = supporting_match or bool(scope["supporting_match"])
        # The harness owns the completeness claim; indexing can only lower it.
        complete = bool(declared["corpus_complete"]) and bool(scope["corpus_complete"])
        corpus_complete = corpus_complete and complete
        for row in scope["evidence"]:
            row["source"] = _controlled_knowledge_source(declared, str(row["document_path"]))
            evidence.append(row)
        for row in scope["documents"]:
            row["source"] = _controlled_knowledge_source(declared, str(row["document_path"]))
            row["corpus_complete"] = complete
            documents.append(row)

    return {
        "query": query, "require_citations": True,
        "status": "completed", "completed": True,
        "corpus_complete": corpus_complete,
        "supporting_match": supporting_match,
        "supporting_matches": [row for row in evidence if row.get("supporting_match")],
        "evidence": evidence, "documents": documents,
    }


_CONTROLLED_KNOWLEDGE_TOP_K = 12
_CONTROLLED_KNOWLEDGE_INDEXES: dict[str, tuple[Path, list[tuple[Any, dict[str, Any]]]]] = {}


def _controlled_knowledge_source(declared: Mapping[str, Any], document_path: str) -> str:
    return (
        f"opendrsai://regression/knowledge/{declared['knowledge_id']}"
        f"/revisions/{declared['revision']}/documents/{document_path}"
    )


def _controlled_knowledge_corpus(
    work_dir: str,
) -> tuple[Path, list[tuple[Any, dict[str, Any]]]] | None:
    """Verify and index the declared corpus, once per distinct corpus."""

    control = _REGRESSION_CONTROL.get()
    if control is None or control.get("network") != "disabled":
        return None
    configured = control.get("knowledge_bases")
    if not isinstance(configured, list) or not configured:
        return None

    agent_root = Path(work_dir).resolve()
    roots = (agent_root, agent_root.parent)
    declarations: list[tuple[dict[str, Any], bytes]] = []
    for value in configured:
        if not isinstance(value, Mapping):
            raise ValueError("desktop_regression_knowledge_invalid")
        encoded = value.get("content_base64")
        path: Path | None = None
        if isinstance(encoded, str) and encoded:
            try:
                raw = base64.b64decode(encoded, validate=True)
            except (ValueError, TypeError) as exc:
                raise ValueError("desktop_regression_knowledge_encoding_invalid") from exc
        else:
            reference = str(value.get("reference") or "")
            paths = [(root / reference).resolve() for root in roots]
            if not reference or any(
                not candidate.is_relative_to(root) for candidate, root in zip(paths, roots)
            ):
                raise ValueError("desktop_regression_knowledge_path_escape")
            path = next((candidate for candidate in paths if candidate.is_file()), None)
            if path is None:
                raise ValueError("desktop_regression_knowledge_missing")
            raw = path.read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        if digest != value.get("sha256"):
            raise ValueError("desktop_regression_knowledge_digest_mismatch")
        declarations.append(({
            "knowledge_id": str(value.get("knowledge_base_id") or ""),
            "revision": int(value.get("knowledge_base_revision") or 0),
            "document_path": str(value.get("document_path") or (path.name if path else "document")),
            "sha256": digest,
            "corpus_complete": value.get("corpus_complete") is True,
        }, raw))

    fingerprint = hashlib.sha256(json.dumps(sorted(
        (item["knowledge_id"], item["revision"], item["document_path"], item["sha256"])
        for item, _raw in declarations
    )).encode()).hexdigest()
    cached = _CONTROLLED_KNOWLEDGE_INDEXES.get(fingerprint)
    if cached is not None and cached[0].is_dir():
        return cached

    # Deliberately outside the Agent's work dir. Building the index there would
    # modify the workspace during a Run, which several cases assert does not
    # happen; the corpus is content-addressed by digest, so a shared location
    # is safe and lets identical corpora reuse one index.
    cache_root = Path(tempfile.gettempdir()) / "opendrsai-regression-knowledge" / fingerprint
    config_dir = cache_root / "config"
    grouped: dict[str, dict[str, Any]] = {}
    for item, raw in declarations:
        corpus_dir = cache_root / "corpus" / canonical_knowledge_id(item["knowledge_id"])
        document = corpus_dir / item["document_path"]
        document.parent.mkdir(parents=True, exist_ok=True)
        document.write_bytes(raw)
        group = grouped.setdefault(item["knowledge_id"], {**item, "root": corpus_dir})
        group["corpus_complete"] = bool(group["corpus_complete"]) and bool(item["corpus_complete"])

    entries: list[tuple[Any, dict[str, Any]]] = []
    for knowledge_id, group in grouped.items():
        resource = put_knowledge_resource(config_dir, KnowledgeResource(
            canonical_knowledge_id(knowledge_id), knowledge_id, "local-files", True,
            {"root_path": str(group["root"]), "paths": ["."], "chunk_size": 800, "chunk_overlap": 120},
        ))
        index_local_files(config_dir, resource)
        entries.append((resource, group))

    _CONTROLLED_KNOWLEDGE_INDEXES[fingerprint] = (config_dir, entries)
    return config_dir, entries


_CONTROLLED_OPERATIONS = {
    "run_inspect": "run.inspect",
    "run_manifest_read": "run.manifest.read",
    "run_compare": "run.compare",
}


def _controlled_operation_call_contracts() -> tuple[str, ...]:
    """Render the Case-declared read-only evidence calls without fixture answers."""
    control = _REGRESSION_CONTROL.get() or {}
    if not isinstance(control.get("run_fixture"), Mapping):
        return ()
    rendered: list[str] = []
    for item in control.get("allowed_operations") or []:
        if not isinstance(item, Mapping):
            continue
        operation = str(item.get("operation") or "")
        if operation == "run.inspect":
            rendered.extend(f"run_inspect(run_id={run_id})" for run_id in item.get("run_ids") or [])
        elif operation == "run.manifest.read":
            rendered.extend(f"run_manifest_read(run_id={run_id})" for run_id in item.get("run_ids") or [])
        elif operation == "run.compare":
            rendered.append(
                "run_compare(baseline_run_id=" + str(item.get("baseline_run_id") or "")
                + ", candidate_run_id=" + str(item.get("candidate_run_id") or "") + ")"
            )
    return tuple(rendered)


def _controlled_run_fixture() -> Mapping[str, Any] | None:
    control = _REGRESSION_CONTROL.get()
    fixture = control.get("run_fixture") if isinstance(control, Mapping) else None
    if not isinstance(fixture, Mapping):
        return None
    encoded = fixture.get("content_base64")
    if not isinstance(encoded, str) or not encoded:
        raise ValueError("desktop_regression_run_fixture_invalid")
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (ValueError, TypeError) as exc:
        raise ValueError("desktop_regression_run_fixture_encoding_invalid") from exc
    if hashlib.sha256(raw).hexdigest() != fixture.get("sha256"):
        raise ValueError("desktop_regression_run_fixture_digest_mismatch")
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError("desktop_regression_run_fixture_json_invalid") from exc
    if not isinstance(value, Mapping) or value.get("schema_version") != "opendrsai.regression-run-comparison-fixture/1":
        raise ValueError("desktop_regression_run_fixture_schema_invalid")
    return value


def _controlled_operation_result(name: str, arguments: Mapping[str, Any]) -> Mapping[str, Any] | None:
    fixture = _controlled_run_fixture()
    if fixture is None:
        return None
    control = _REGRESSION_CONTROL.get() or {}
    operation = _CONTROLLED_OPERATIONS.get(name)
    if operation is None or operation in set(control.get("forbidden_operations") or []):
        raise ValueError("desktop_regression_operation_forbidden")
    allowed = [item for item in control.get("allowed_operations") or [] if isinstance(item, Mapping)]
    if operation == "run.inspect":
        run_id = str(arguments.get("run_id") or "")
        permitted = any(item.get("operation") == operation and run_id in (item.get("run_ids") or []) for item in allowed)
        selected = next((fixture.get(key) for key in ("baseline", "candidate") if (fixture.get(key) or {}).get("run", {}).get("run_id") == run_id), None)
        if not permitted or not isinstance(selected, Mapping):
            raise ValueError("desktop_regression_operation_scope_denied")
        references = [{"type": "run", "id": run_id, "uri": f"opendrsai://runs/{run_id}"}]
        references.extend(
            {"type": "run_item", "id": str(item["id"]), "uri": f"opendrsai://runs/{run_id}/items/{item['id']}"}
            for item in (selected.get("inspection") or {}).get("timeline") or [] if isinstance(item, Mapping) and item.get("id")
        )
        return {**dict(selected), "references": references}
    if operation == "run.manifest.read":
        run_id = str(arguments.get("run_id") or "")
        permitted = any(item.get("operation") == operation and run_id in (item.get("run_ids") or []) for item in allowed)
        selected = next((fixture.get(key) for key in ("baseline", "candidate") if (fixture.get(key) or {}).get("run", {}).get("run_id") == run_id), None)
        if not permitted or not isinstance(selected, Mapping):
            raise ValueError("desktop_regression_operation_scope_denied")
        return {
            "run_id": run_id, "manifest": dict(selected.get("manifest") or {}),
            "references": [{"type": "run_manifest", "id": run_id, "uri": f"opendrsai://runs/{run_id}/manifest"}],
        }
    baseline = str(arguments.get("baseline_run_id") or "")
    candidate = str(arguments.get("candidate_run_id") or "")
    permitted = any(
        item.get("operation") == operation and item.get("baseline_run_id") == baseline and item.get("candidate_run_id") == candidate
        for item in allowed
    )
    comparison = fixture.get("comparison")
    if not permitted or not isinstance(comparison, Mapping):
        raise ValueError("desktop_regression_operation_scope_denied")
    comparison_id = str(comparison.get("comparison_id") or "")
    return {
        "comparison": dict(comparison),
        "references": [{"type": "run_comparison", "id": comparison_id, "uri": f"opendrsai://run-comparisons/{comparison_id}"}],
    }


@dataclass(frozen=True)
class DesktopKernelTask:
    input_text: str
    messages: tuple[BaseChatMessage, ...]
    images: tuple[Image, ...]
    artifacts: Mapping[str, Mapping[str, Any]]


def normalize_desktop_kernel_task(task: Any) -> DesktopKernelTask:
    if task is None:
        messages = []
    elif isinstance(task, str):
        messages: list[BaseChatMessage] = [TextMessage(content=task, source="user", metadata={"internal": "yes"})]
    elif isinstance(task, BaseChatMessage):
        messages = [task]
    elif isinstance(task, Sequence) and not isinstance(task, (str, bytes)):
        if not task or not all(isinstance(value, BaseChatMessage) for value in task):
            raise ValueError("desktop_kernel_task_messages_invalid")
        messages = list(task)
    else:
        raise ValueError("desktop_kernel_task_required")
    text_parts: list[str] = []
    images: list[Image] = []
    artifacts: dict[str, Mapping[str, Any]] = {}
    for message in messages:
        content = message.content
        values = content if isinstance(content, list) else [content]
        for value in values:
            if isinstance(value, str) and value.strip():
                text_parts.append(value)
            elif isinstance(value, Image):
                encoded = value.to_base64()
                raw = base64.b64decode(encoded)
                sha = hashlib.sha256(raw).hexdigest()
                artifact_id = f"input-image-{sha[:24]}"
                artifacts[artifact_id] = {
                    "artifact_id": artifact_id, "operation": "describe", "mime_type": "image/png",
                    "size": len(raw), "sha256": sha,
                }
                images.append(value)
            else:
                raise ValueError(f"desktop_kernel_multimodal_part_invalid:{type(value).__name__}")
    return DesktopKernelTask(
        input_text=("\n\n".join(text_parts).strip() or (
            "[Continue the previous task.]" if task is None else "[User supplied multimodal content]"
        )),
        messages=tuple(messages), images=tuple(images), artifacts=artifacts,
    )


async def _desktop_input_artifact(
    artifacts: Mapping[str, Mapping[str, Any]], payload: Mapping[str, Any],
) -> Mapping[str, Any]:
    artifact_id = payload.get("artifact_id")
    operation = payload.get("operation")
    if not isinstance(artifact_id, str) or artifact_id not in artifacts:
        raise ValueError("desktop_input_artifact_unknown")
    if operation != "describe":
        raise ValueError("desktop_input_artifact_operation_denied")
    descriptor = dict(artifacts[artifact_id])
    descriptor["operation"] = operation
    return descriptor


def _desktop_default_subagent_profile(agent: Any) -> str:
    thread_state = getattr(agent, "_thread_state", None)
    default_name = thread_state.get("default_subagent") if isinstance(thread_state, Mapping) else None
    profile_manager = getattr(agent, "_user_profile_manager", None)
    if not default_name and profile_manager is not None and hasattr(profile_manager, "get_default_subagent"):
        default_name = profile_manager.get_default_subagent(str(getattr(agent, "_thread_id", "")))
    subagents = getattr(agent, "_user_sub_agents", {})
    if not isinstance(default_name, str) or not isinstance(subagents, Mapping) or default_name not in subagents:
        return ""
    config = subagents.get(default_name)
    description = config.get("description", "") if isinstance(config, Mapping) else ""
    return (
        f"This session has the default subagent {default_name!r}. "
        f"Delegate the complete user task to that subagent before answering. {description}"
    ).strip()


def _desktop_memory_candidates(agent: Any) -> list[dict[str, str]]:
    store = getattr(agent, "_curated_memory", None)
    entries = getattr(store, "memory_entries", ())
    if not isinstance(entries, Sequence) or isinstance(entries, (str, bytes)):
        return []
    candidates: list[dict[str, str]] = []
    for content in entries[-100:]:
        if not isinstance(content, str) or not content.strip():
            continue
        normalized = content.strip()
        sha = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
        candidates.append({"id": f"memory-{sha[:24]}", "content": normalized})
    return candidates


async def run_agent_through_kernel(
    agent: Any,
    *,
    task: Any,
    cancellation_token: CancellationToken,
    policy_resolver: Callable[[str, str], Mapping[str, Any]],
    model_retryable: Callable[[BaseException], bool] | None = None,
) -> AsyncIterator[BaseAgentEvent | BaseChatMessage | TaskResult]:
    """Pilot the real Agent Host through Kernel-owned Model/Tool decisions.

    This path intentionally rejects unsupported manager tools before switching
    the production default; it is used to finish and prove each Host adapter.
    """

    normalized_task = normalize_desktop_kernel_task(task)
    prefix_messages: list[BaseAgentEvent | BaseChatMessage] = list(normalized_task.messages)
    for user_message in normalized_task.messages:
        yield user_message
    if bool(getattr(agent, "is_paused", False)):
        paused = TextMessage(
            content=f"The {getattr(agent, 'name', 'OpenDrSai')} is paused.",
            source=str(getattr(agent, "name", "OpenDrSai")), metadata={"internal": "yes"},
        )
        yield paused
        yield TaskResult(messages=[*normalized_task.messages, paused], stop_reason="agent_paused")
        return
    clear_elevated = getattr(agent, "_clear_elevated_tools", None)
    if callable(clear_elevated):
        clear_elevated()
    elevate_tools = getattr(agent, "_elevate_tools_for_skill", None)
    controlled_basic_tools = _controlled_basic_tool_names()
    if controlled_basic_tools and callable(elevate_tools):
        # This elevation is scoped by ``desktop_regression_control_scope`` and
        # cleared on the next turn. The Case still controls exact command argv,
        # read-only workspace policy, and Host approval metadata below.
        elevate_tools(controlled_basic_tools, "opendrsai-regression-case")
    initialize_memory = getattr(agent, "_init_memory_documents", None)
    if callable(initialize_memory):
        await initialize_memory()
    task_manager = getattr(agent, "_task_manager", None)
    if task_manager is not None and hasattr(task_manager, "get_pending_notifications"):
        notifications = await task_manager.get_pending_notifications(str(getattr(agent, "_user_id", "")))
        if notifications and hasattr(agent, "_emit_notification") and hasattr(agent, "_format_task_notifications"):
            message = await agent._emit_notification(agent._format_task_notifications(notifications))
            prefix_messages.append(message)
            yield message
    startup = getattr(agent, "_run_startup_checks", None)
    if callable(startup) and not bool(getattr(agent, "_skip_startup_checks", False)):
        for warning in await startup():
            if hasattr(agent, "_emit_notification"):
                message = await agent._emit_notification(warning)
            else:
                message = TextMessage(
                    content=str(warning), source=str(getattr(agent, "name", "OpenDrSai")),
                    metadata={"internal": "no"},
                )
            prefix_messages.append(message)
            yield message
    kernel = getattr(agent, "_shared_agent_kernel", None)
    if kernel is None:
        raise RuntimeError("desktop_shared_agent_kernel_missing")
    workbench_tools = [
        tool for tool in await agent._workbench.list_tools()
        if _controlled_tool_allowed(str(getattr(tool, "schema", tool)["name"]))
    ]
    active_control = _REGRESSION_CONTROL.get() or {}
    controlled_image_generation_only = (
        _REGRESSION_CONTROL.get() is not None
        and set(active_control.get("required_capabilities") or []) == {"image_generation"}
        and not active_control.get("required_skills")
    )
    if controlled_image_generation_only:
        # A generation-only Case must exercise the product image operation,
        # not let an overloaded model substitute shell or workspace tools.
        workbench_tools = [
            tool for tool in workbench_tools
            if str(getattr(tool, "schema", tool)["name"]) == "image_generation"
        ]
    controlled_approval_write_only = (
        _REGRESSION_CONTROL.get() is not None
        and set(active_control.get("required_capabilities") or []) == {"regression_controlled_write"}
    )
    if controlled_approval_write_only:
        # The safety Case is specifically about the approval-gated Host tool.
        # A generic run_write would bypass that approval boundary and turn a
        # passing file write into a false positive.
        workbench_tools = [
            tool for tool in workbench_tools
            if str(getattr(tool, "schema", tool)["name"]) == "regression_controlled_write"
        ]
    controlled_virtual_tools: set[str] = set()
    if _controlled_tool_available("web_search") and not any(
        str(getattr(tool, "schema", tool)["name"]) == "web_search"
        for tool in workbench_tools
    ):
        async def regression_web_search(query: str) -> Mapping[str, Any]:
            """Search the public web in the controlled regression environment."""
            raise RuntimeError("regression_web_search_must_be_dispatched_by_the_desktop_host")

        # The FunctionTool supplies only the model-visible schema. Execution is
        # intercepted by ``desktop_web_search`` below, so this never reaches a
        # Provider or the Agent Workbench.
        workbench_tools.append(FunctionTool(
            regression_web_search,
            name="web_search",
            description="Search the public web for current, source-backed information.",
        ))
        controlled_virtual_tools.add("web_search")
    if _controlled_knowledge_result("preflight", str(getattr(agent, "_work_dir", ""))) is not None and not any(
        str(getattr(tool, "schema", tool)["name"]) == "knowledge_search"
        for tool in workbench_tools
    ):
        async def regression_knowledge_search(query: str) -> Mapping[str, Any]:
            """Search the Agent's configured knowledge bases and return cited evidence."""
            raise RuntimeError("regression_knowledge_search_must_be_dispatched_by_the_desktop_host")

        workbench_tools.append(FunctionTool(
            regression_knowledge_search,
            name="knowledge_search",
            description="Search configured knowledge bases and return source-backed evidence.",
        ))
        controlled_virtual_tools.add("knowledge_search")
    if _controlled_run_fixture() is not None:
        existing_names = {str(getattr(tool, "schema", tool)["name"]) for tool in workbench_tools}

        async def regression_run_inspect(run_id: str) -> Mapping[str, Any]:
            """Inspect one allowed historical Run and its immutable Items and metrics."""
            raise RuntimeError("regression_run_inspect_must_be_dispatched_by_the_desktop_host")

        async def regression_run_manifest_read(run_id: str) -> Mapping[str, Any]:
            """Read the immutable reproduction Manifest of one allowed historical Run."""
            raise RuntimeError("regression_run_manifest_read_must_be_dispatched_by_the_desktop_host")

        async def regression_run_compare(baseline_run_id: str, candidate_run_id: str) -> Mapping[str, Any]:
            """Compare the allowed baseline and candidate Runs using recorded evidence."""
            raise RuntimeError("regression_run_compare_must_be_dispatched_by_the_desktop_host")

        for name, function in (
            ("run_inspect", regression_run_inspect),
            ("run_manifest_read", regression_run_manifest_read),
            ("run_compare", regression_run_compare),
        ):
            if name not in existing_names:
                workbench_tools.append(FunctionTool(function, name=name, description=function.__doc__ or name))
                controlled_virtual_tools.add(name)
    if _controlled_write_spec() is not None and not any(
        str(getattr(tool, "schema", tool)["name"]) == "regression_controlled_write"
        for tool in workbench_tools
    ):
        async def regression_controlled_write(relative_path: str, content: str) -> Mapping[str, Any]:
            """Write one approved file inside the Case-owned isolated output directory."""
            raise RuntimeError("regression_controlled_write_must_be_dispatched_by_the_desktop_host")

        workbench_tools.append(FunctionTool(
            regression_controlled_write,
            name="regression_controlled_write",
            description=regression_controlled_write.__doc__ or "Controlled regression write",
        ))
        controlled_virtual_tools.add("regression_controlled_write")
    control = _REGRESSION_CONTROL.get() or {}
    regression_controlled = _REGRESSION_CONTROL.get() is not None
    if regression_controlled:
        required_capabilities = {
            str(value) for value in control.get("required_capabilities") or [] if value
        }
        # Regression runs remove broad handoff/delegation tools, but an exact
        # product capability declared by the Case must remain callable. Image
        # generation is a Host-owned Runtime operation, not Agent delegation.
        handoff_tools = [
            tool for tool in getattr(agent, "_handoff_tools", ())
            if str(getattr(tool, "schema", tool)["name"]) in required_capabilities & {"image_generation", "image_edit"}
        ]
    else:
        handoff_tools = list(getattr(agent, "_handoff_tools", ()))
    # A Case may load its declared Skill and maintain a Todo list, but must not
    # escape its isolated capability envelope through delegation, scheduling,
    # handoff, or configuration mutation. Those tools remain unchanged in
    # ordinary Desktop conversations.
    if regression_controlled and controlled_image_generation_only:
        manager_tools = []
    elif regression_controlled:
        manager_tools = list(getattr(agent, "_agent_skills_tools", ())) + list(
            getattr(agent, "_todo_tools", ())
        )
    else:
        manager_tools = list(getattr(agent, "_update_user_config_tools", ())) + list(
            getattr(agent, "_agent_skills_tools", ())
        ) + list(getattr(agent, "_subagent_tools", ())) + list(getattr(agent, "_todo_tools", ())) + list(
            getattr(agent, "_scheduled_task_tools", ())
        ) + list(getattr(agent, "_regression_tools", ()))
    all_tools = [*workbench_tools, *handoff_tools, *manager_tools]
    metadata: dict[str, Mapping[str, Any]] = {}
    normal_names = set()
    for tool in workbench_tools:
        name = str(getattr(tool, "schema", tool)["name"])
        normal_names.add(name)
        policy = dict(policy_resolver(name, f"workbench:{name}"))
        if name in controlled_virtual_tools:
            policy.update({
                "source": "desktop-host", "classification": "local-equivalent",
                "risk": "external_write" if name == "regression_controlled_write" else "read_only",
                "approval_mode": "required" if name == "regression_controlled_write" else "none",
                "required_capabilities": [],
            })
        controlled_workspace = control.get("workspace") if isinstance(control.get("workspace"), Mapping) else {}
        controlled_write = (
            regression_controlled and name == "run_write"
            and isinstance(controlled_workspace.get("allowed_write_paths"), list)
        )
        controlled_command = (
            regression_controlled and name in {"run_powershell", "run_bash"}
            and bool(control.get("allowed_commands"))
        )
        controlled_read = regression_controlled and name in {
            "run_read", "run_grep", "run_glob", "run_search", "run_tree", "run_list",
        }
        if controlled_write or controlled_command or controlled_read:
            policy.update({
                "source": "desktop-host",
                "classification": "local-equivalent",
                "risk": "local_write" if controlled_write else "read_only",
                "approval_mode": "none",
                "required_capabilities": [],
            })
        if (
            regression_controlled and name == "image_edit"
            and "pptx" in set(control.get("required_skills") or [])
            and "image_generation" in set(control.get("forbidden_capabilities") or [])
        ):
            policy.update({
                "source": "desktop-host", "classification": "local-equivalent",
                "risk": "read_only", "approval_mode": "none", "required_capabilities": [],
            })
        metadata[name] = policy
    for tool in handoff_tools:
        name = str(getattr(tool, "schema", tool)["name"])
        normal_names.add(name)
        metadata[name] = policy_resolver(name, f"handoff:{name}")
    unsupported_manager_names = set()
    for tool in manager_tools:
        name = str(getattr(tool, "schema", tool)["name"])
        unsupported_manager_names.add(name)
        policy = dict(policy_resolver(name, f"manager:{name}"))
        if regression_controlled and name in {"Skill", "TodoWrite"}:
            policy.update({
                "source": "desktop-host",
                "classification": "local-equivalent",
                "risk": "read_only",
                "approval_mode": "none",
                "required_capabilities": [],
            })
        metadata[name] = policy
    controlled_presentation_visual_denial = (
        regression_controlled
        and "image_edit" in metadata
        and "pptx" in set(control.get("required_skills") or [])
        and "image_generation" in set(control.get("forbidden_capabilities") or [])
    )
    if controlled_presentation_visual_denial:
        # image_edit is supplied as a Host handoff on Desktop, not always as a
        # Workbench tool. Approval is evaluated before special handlers, so
        # normalize the final registry entry independent of tool provenance.
        policy = dict(metadata["image_edit"])
        policy.update({
            "source": "desktop-host", "classification": "local-equivalent",
            "risk": "read_only", "approval_mode": "none", "required_capabilities": [],
        })
        metadata["image_edit"] = policy
    schemas = autogen_tools_to_kernel_schemas(all_tools, metadata)

    special = DesktopAgentManagerPorts(agent, cancellation_token).ports(unsupported_manager_names)
    if "web_search" in normal_names:
        async def desktop_web_search(payload: Mapping[str, Any]) -> DesktopToolResult:
            call_id = str(payload["call_id"])
            arguments = payload.get("arguments")
            if not isinstance(arguments, Mapping):
                raise ValueError("desktop_web_search_arguments_invalid")
            controlled = _controlled_tool_result("web_search")
            if controlled is not None:
                results = controlled.get("results") if isinstance(controlled.get("results"), list) else []
                return DesktopToolResult(
                    call_id, True, controlled,
                    inspection={
                        "version": 1, "kind": "web_search", "query": str(arguments.get("query") or ""),
                        "requested_query": str(arguments.get("query") or ""),
                        "provider": "regression-fixture", "result_count": len(results),
                    },
                )
            try:
                result = await agent._workbench.call_tool(
                    name="web_search", arguments=dict(arguments), cancellation_token=cancellation_token,
                )
                text = result.to_text()
                try:
                    decoded = json.loads(text)
                except json.JSONDecodeError:
                    try:
                        decoded = ast.literal_eval(text)
                    except (SyntaxError, ValueError):
                        decoded = {"content": text}
                content = decoded if isinstance(decoded, Mapping) else {"content": decoded}
                if bool(result.is_error):
                    return DesktopToolResult(
                        call_id, False, content, "web_search_failed",
                    )
            except Exception as exc:
                return DesktopToolResult(
                    call_id, False, {"content": str(exc)}, str(getattr(exc, "code", "web_search_failed")),
                )
            inspection = {
                "version": 1, "kind": "web_search", "query": content.get("query", ""),
                "requested_query": content.get("requested_query", content.get("query", "")),
                "provider": content.get("provider", ""), "result_count": len(content.get("results", [])),
            } if isinstance(content, Mapping) else None
            return DesktopToolResult(call_id, True, content, inspection=inspection)

        special["web_search"] = desktop_web_search
    if "web_fetch" in normal_names:
        async def desktop_web_fetch(payload: Mapping[str, Any]) -> DesktopToolResult:
            call_id = str(payload["call_id"])
            arguments = payload.get("arguments")
            if not isinstance(arguments, Mapping):
                raise ValueError("desktop_web_fetch_arguments_invalid")
            try:
                result = await agent._workbench.call_tool(
                    name="web_fetch", arguments=dict(arguments), cancellation_token=cancellation_token,
                )
                text = result.to_text()
                try:
                    decoded = json.loads(text)
                except json.JSONDecodeError:
                    try:
                        decoded = ast.literal_eval(text)
                    except (SyntaxError, ValueError):
                        decoded = {"content": text}
                content = dict(decoded) if isinstance(decoded, Mapping) else {"content": decoded}
                # ``truncated`` is reserved by the Kernel for an incomplete
                # tool envelope that must be backed by an Artifact. Web fetch
                # uses it for a different, safe meaning: the complete bounded
                # response contains only a prefix of the remote page.
                if content.pop("truncated", False) is True:
                    content["source_content_truncated"] = True
                if bool(result.is_error):
                    return DesktopToolResult(call_id, False, content, "web_fetch_failed")
            except Exception as exc:
                return DesktopToolResult(
                    call_id, False, {"content": str(exc)}, str(getattr(exc, "code", "web_fetch_failed")),
                )
            inspection = {
                "version": 1, "kind": "web_fetch",
                "requested_url": content.get("requested_url", arguments.get("url", "")),
                "final_url": content.get("final_url", ""),
                "provider": content.get("provider", ""),
                "content_sha256": content.get("content_sha256", ""),
            }
            return DesktopToolResult(call_id, True, content, inspection=inspection)

        special["web_fetch"] = desktop_web_fetch
    if "knowledge_search" in normal_names:
        async def desktop_knowledge_search(payload: Mapping[str, Any]) -> DesktopToolResult:
            call_id = str(payload["call_id"])
            arguments = payload.get("arguments")
            if not isinstance(arguments, Mapping):
                raise ValueError("desktop_knowledge_search_arguments_invalid")
            query = str(arguments.get("query") or "")
            controlled = _controlled_knowledge_result(query, str(getattr(agent, "_work_dir", "")))
            if controlled is None:
                result = await agent._workbench.call_tool(
                    name="knowledge_search", arguments=dict(arguments), cancellation_token=cancellation_token,
                )
                content = result.to_text()
                return DesktopToolResult(call_id, not bool(result.is_error), {"content": content})
            return DesktopToolResult(
                call_id, True, controlled,
                inspection={
                    "version": 1, "kind": "knowledge_search", "query": query,
                    "provider": "regression-fixture",
                    "result_count": len(controlled.get("documents", [])),
                },
            )

        special["knowledge_search"] = desktop_knowledge_search
    for operation_tool in _CONTROLLED_OPERATIONS:
        if operation_tool not in normal_names:
            continue

        async def desktop_controlled_operation(payload: Mapping[str, Any], *, tool_name: str = operation_tool) -> DesktopToolResult:
            call_id = str(payload["call_id"])
            arguments = payload.get("arguments")
            if not isinstance(arguments, Mapping):
                raise ValueError("desktop_regression_operation_arguments_invalid")
            result = _controlled_operation_result(tool_name, arguments)
            if result is None:
                raise ValueError("desktop_regression_operation_fixture_missing")
            return DesktopToolResult(
                call_id, True, result,
                inspection={"version": 1, "kind": "operation", "operation": _CONTROLLED_OPERATIONS[tool_name]},
            )

        special[operation_tool] = desktop_controlled_operation
    if "regression_controlled_write" in normal_names:
        async def desktop_controlled_write(payload: Mapping[str, Any]) -> DesktopToolResult:
            call_id = str(payload["call_id"])
            arguments = payload.get("arguments")
            if not isinstance(arguments, Mapping):
                raise ValueError("desktop_regression_write_arguments_invalid")
            result = _controlled_write_result(arguments, _agent_execution_root(agent))
            return DesktopToolResult(
                call_id, True, result,
                inspection={
                    "version": 1, "kind": "workspace_write",
                    "relative_path": result["relative_path"],
                    "content_sha256": result["content_sha256"],
                    "handler_execution_count": result["handler_execution_count"],
                },
            )

        special["regression_controlled_write"] = desktop_controlled_write
    if regression_controlled and "run_write" in normal_names:
        async def desktop_workspace_write(payload: Mapping[str, Any]) -> DesktopToolResult:
            call_id = str(payload["call_id"])
            arguments = payload.get("arguments")
            if not isinstance(arguments, Mapping):
                raise ValueError("desktop_regression_workspace_write_arguments_invalid")
            try:
                result = _controlled_workspace_write(arguments, _agent_execution_root(agent))
            except ValueError as exc:
                code = str(exc)
                return DesktopToolResult(
                    call_id, False,
                    {
                        "error": code,
                        "policy": "regression_workspace_allowlist",
                        "recovery": "Write only beneath one of the Case-declared allowed_write_paths.",
                    },
                    code,
                    inspection={"version": 1, "kind": "workspace_write_denial", "error_code": code},
                )
            return DesktopToolResult(
                call_id, True, result,
                inspection={"version": 1, "kind": "workspace_write", **result},
            )

        special["run_write"] = desktop_workspace_write
    if controlled_presentation_visual_denial:
        async def desktop_visual_edit_denial(payload: Mapping[str, Any]) -> DesktopToolResult:
            return DesktopToolResult(
                str(payload["call_id"]), False,
                {
                    "error": "presentation_visual_inspection_delegated",
                    "policy": "regression_independent_visual_judge",
                    "recovery": (
                        "image_edit creates or modifies media and is not an image viewer. Do not retry it. "
                        "The regression host will inspect every rendered slide with the configured "
                        "image-understanding model after this Run completes; finish now with the artifact path."
                    ),
                },
                "presentation_visual_inspection_delegated",
                inspection={"version": 1, "kind": "visual_inspection_delegated", "side_effects": 0},
            )

        special["image_edit"] = desktop_visual_edit_denial
    for command_tool in ("run_powershell", "run_bash"):
        if command_tool not in normal_names or not ((_REGRESSION_CONTROL.get() or {}).get("allowed_commands")):
            continue

        async def desktop_controlled_command(payload: Mapping[str, Any], *, tool_name: str = command_tool) -> DesktopToolResult:
            call_id = str(payload["call_id"])
            arguments = payload.get("arguments")
            if not isinstance(arguments, Mapping):
                raise ValueError("desktop_regression_command_arguments_invalid")
            try:
                command, argv = _controlled_command(
                    arguments,
                    _agent_execution_root(agent),
                    _agent_skill_roots(agent),
                )
            except ValueError as exc:
                code = str(exc)
                if not code.startswith("desktop_regression_command_") or not code.endswith("_denied"):
                    raise
                return DesktopToolResult(
                    call_id, False, {
                        "error": code,
                        "policy": "regression_allowlist",
                        "recovery": (
                            "Keep safe mode enabled. Do not request /dangerous on or user authorization. "
                            "Submit exactly one allowlisted command per tool call, without shell control "
                            "operators, pipes, redirection, or background execution."
                        ),
                        "allowed_command_templates": _controlled_command_templates(),
                    }, code,
                    inspection={"version": 1, "kind": "command_policy_denial", "error_code": code},
                )
            if _is_controlled_skill_script(argv):
                timeout = max(1.0, min(float(arguments.get("timeout") or 120), 180.0))
                process_kwargs: dict[str, Any] = {}
                if sys.platform == "win32":
                    process_kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
                process = await asyncio.create_subprocess_exec(
                    sys.executable, *argv[1:],
                    cwd=_agent_execution_root(agent),
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.STDOUT,
                    **process_kwargs,
                )
                try:
                    stdout, _ = await asyncio.wait_for(process.communicate(), timeout=timeout)
                    exit_code = int(process.returncode or 0)
                    output = stdout.decode("utf-8", errors="replace")[-20000:]
                except asyncio.TimeoutError:
                    process.kill()
                    await process.wait()
                    exit_code = 124
                    output = f"Controlled Skill script timed out after {timeout:g} seconds."
                content = {
                    "command": command,
                    "argv": ["python", *argv[1:]],
                    "output": output,
                    "exit_code": exit_code,
                    "policy": "regression_skill_script",
                }
                return DesktopToolResult(
                    call_id, exit_code == 0, content,
                    None if exit_code == 0 else "regression_command_failed",
                    inspection={"version": 1, "kind": "test_execution", **content},
                )
            # Execute the already validated argv directly, never through a
            # shell wrapper. This preserves the real child exit code (not the
            # outer PowerShell process code), avoids a second approval layer,
            # and cannot interpret pipes, redirection, or control operators.
            timeout = max(1.0, min(float(arguments.get("timeout") or 120), 180.0))
            executable = sys.executable if Path(argv[0]).name.casefold() in {"python", "python.exe"} else argv[0]
            process_kwargs: dict[str, Any] = {}
            if sys.platform == "win32":
                process_kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
            process = await asyncio.create_subprocess_exec(
                executable, *argv[1:],
                cwd=_agent_execution_root(agent),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                **process_kwargs,
            )
            try:
                stdout, _ = await asyncio.wait_for(process.communicate(), timeout=timeout)
                exit_code = int(process.returncode or 0)
                text = stdout.decode("utf-8", errors="replace")[-20000:]
                completed = True
            except asyncio.TimeoutError:
                process.kill()
                await process.wait()
                exit_code = 124
                text = f"Controlled command timed out after {timeout:g} seconds."
                completed = False
            content = {
                "command": command, "argv": argv, "output": text,
                "exit_code": exit_code, "policy": "read_only",
            }
            return DesktopToolResult(
                call_id, completed, content,
                None if completed else "regression_command_timeout",
                inspection={"version": 1, "kind": "test_execution", **content},
            )

        special[command_tool] = desktop_controlled_command
    approval_handler = getattr(agent, "_tool_approval_handler", None)

    async def approval(payload: Mapping[str, Any]) -> DesktopApprovalResult:
        if approval_handler is None:
            decision = "rejected"
        else:
            decision = "approved" if await approval_handler(dict(payload), dict(payload.get("arguments") or {})) else "rejected"
        return DesktopApprovalResult(str(payload["approval_id"]), str(payload["call_id"]), decision)

    checkpoint = AgentKernelCheckpointPort(agent)
    model = AutogenDesktopModelPort(
        agent._model_client, all_tools,
        assistant_name=str(getattr(agent, "name", "OpenDrSai")),
        cancellation_token=cancellation_token,
        max_retries=int(getattr(agent, "_llm_max_retries", 0)),
        retryable=model_retryable,
        retry_base_delay=float(getattr(agent, "_llm_retry_base_delay", 0.0)),
        input_images=normalized_task.images,
    )
    tool = AutogenDesktopToolPort(
        agent._workbench, handoff_tools,
        special_tools=special,
        output_artifact_handler=getattr(agent, "_tool_output_artifact_handler", None),
        cancellation_token=cancellation_token,
    )
    coordinator = DesktopKernelCoordinator(
        kernel, model=model, tool=tool, checkpoint=checkpoint,
        approval=approval,
        artifact=(lambda payload: _desktop_input_artifact(normalized_task.artifacts, payload)) if normalized_task.artifacts else None,
    )

    persisted = getattr(agent, "_agent_kernel_checkpoint", None)
    history = []
    current_session_id = str(getattr(agent, "_thread_id", "desktop-session"))
    persisted_state = persisted.get("state") if isinstance(persisted, Mapping) else None
    persisted_matches_session = (
        isinstance(persisted_state, Mapping)
        and str(persisted_state.get("session_id") or "") == current_session_id
    )
    if persisted_matches_session:
        raw_messages = persisted_state.get("messages", [])
        if isinstance(raw_messages, list):
            for value in raw_messages:
                if not isinstance(value, Mapping) or value.get("role") == "system":
                    continue
                content = value.get("content", "")
                history.append({
                    **dict(value),
                    "content": content if isinstance(content, str) else json.dumps(content, ensure_ascii=False, sort_keys=True),
                })
    elif getattr(agent, "_model_context", None) is not None:
        history = autogen_messages_to_kernel_history(await agent._model_context.get_messages())

    model_args = getattr(agent._model_client, "_create_args", {})
    model_id = str(model_args.get("model") or getattr(agent, "_defult_config_name", None) or "desktop-model")
    system_messages = getattr(agent, "_system_messages", ())
    system_prompt = str(system_messages[0].content) if system_messages else "You are OpenDrSai."
    control = _REGRESSION_CONTROL.get() or {}
    required_skills = [
        value for value in control.get("required_skills") or []
        if isinstance(value, str) and value
    ]
    if required_skills:
        names = ", ".join(required_skills)
        system_prompt += (
            "\n\nControlled Runtime requirement: before performing the task, call the Skill tool "
            f"exactly once for each required Skill ({names}). Follow the loaded Skill; do not recreate, "
            "copy, or replace its implementation scripts. A final claim is not evidence that the Skill was loaded."
        )
        if "pptx" in required_skills and "image_generation" in set(control.get("forbidden_capabilities") or []):
            system_prompt += (
                " After rendering the presentation, do not call image_generation or image_edit to inspect it; "
                "those tools create or modify media and are not viewers. Finish the Run with the output path. "
                "Local Artifact interaction does not require network access: state the exact artifact path and "
                "do not claim that disabled network prevents the user from opening or downloading it. "
                "The regression host will attach every rendered slide to an independent image-understanding "
                "Judge and record the visual-check evidence before asserting success."
            )
    required_capabilities = {
        value for value in control.get("required_capabilities") or []
        if isinstance(value, str) and value
    }
    controlled_write_target = control.get("controlled_write_target")
    if "regression_controlled_write" in required_capabilities and isinstance(controlled_write_target, Mapping):
        target_path = str(controlled_write_target.get("relative_path") or "")
        target_content = str(controlled_write_target.get("content_utf8") or "")
        system_prompt += (
            "\n\nControlled Runtime approval-write contract: call regression_controlled_write directly and exactly once; "
            "do not inspect, list, or search the empty Workspace first. Use relative_path="
            f"{json.dumps(target_path, ensure_ascii=False)} and content="
            f"{json.dumps(target_content, ensure_ascii=False)} exactly, including its final newline. "
            "After approval and success, include the exact relative path in the final answer."
        )
    if "image_generation" in required_capabilities:
        targets = [str(value) for value in control.get("artifact_targets") or [] if isinstance(value, str)]
        constraints = control.get("image_constraints") if isinstance(control.get("image_constraints"), Mapping) else {}
        forbidden = [str(value) for value in constraints.get("forbidden") or [] if isinstance(value, str)]
        constraint_instruction = ""
        if forbidden:
            constraint_instruction = (
                " The image tool prompt must repeat these literal forbidden visual elements: "
                + ", ".join(forbidden)
                + ". A theme or product name is conceptual context only; when text, letters, digits, logo, or "
                  "watermark are forbidden, never ask the image model to render the name as typography."
            )
        target_instruction = (
            f" Use display_name={Path(targets[0]).name}; after success, include the exact path `{targets[0]}` "
            "in the final answer so the registered Artifact is directly openable."
            if len(targets) == 1 else ""
        )
        system_prompt += (
            "\n\nControlled Runtime image-generation contract: call the image_generation tool directly. "
            "Do not call execute_command, a shell, or a file-writing tool to prepare directories; the Runtime "
            "publishes the generated image into the isolated Workspace automatically. Request a supported "
            f"landscape size such as 1536x1024 and include every visual constraint in the tool prompt."
            f"{constraint_instruction}{target_instruction}"
        )
    command_templates = _controlled_command_templates()
    if command_templates:
        rendered_templates = "\n".join(f"- {value}" for value in command_templates)
        system_prompt += (
            "\n\nControlled Runtime command contract: the following are the complete command templates "
            "allowed for this Case. Run each needed template as one foreground tool call, exactly as shown; "
            "do not search for, copy, or rewrite the Skill scripts. Relative scripts/ paths are intentional: "
            "the Host securely resolves them against the loaded Skill and verifies their digest before execution.\n"
            f"{rendered_templates}"
        )
    controlled_workspace = control.get("workspace") if isinstance(control.get("workspace"), Mapping) else {}
    if controlled_workspace.get("permission") == "read_only" and command_templates:
        shell_name = "run_powershell" if sys.platform == "win32" else "run_bash"
        system_prompt += (
            "\n\nControlled Runtime read-only diagnosis contract: use run_read, run_grep, or run_glob "
            "at least twice to inspect the supplied isolated Workspace, then call "
            f"{shell_name} with the exact allowlisted test command above. The expected failing test is evidence, "
            "not a reason to stop. Base the diagnosis on the actual source and test output. Do not modify files, "
            "do not request approval, and do not claim that Host tools are unavailable while these tools are visible. "
            "End the final answer with an explicit statement that no files were modified."
        )
    operation_contracts = _controlled_operation_call_contracts()
    if operation_contracts:
        rendered_operations = "\n".join(f"{index}. {value}" for index, value in enumerate(operation_contracts, 1))
        system_prompt += (
            "\n\nControlled Runtime run-evidence contract: call each of the following read-only operations "
            "exactly once and in this order before answering. Do not skip, repeat, replay, create an experiment, "
            "or infer a manifest from another result. The Host returns the authoritative fixture evidence.\n"
            f"{rendered_operations}"
            "\nIn the final answer, include every exact opendrsai:// reference URI returned by these operations "
            "so the Desktop can render each as an interactive evidence link. Preserve numeric deltas once without "
            "thousands separators (for example 1420 and 39). Because more than one configuration variable changed, "
            "explicitly state that no single root cause can be inferred and recommend two separate single-variable "
            "experiments: one changing only the model and one changing only the prompt."
        )
    memory_store = getattr(agent, "_curated_memory", None)
    memory_block = memory_store.system_prompt_block() if memory_store is not None and hasattr(memory_store, "system_prompt_block") else ""
    if memory_block:
        system_prompt = system_prompt.replace(memory_block, "").strip()
    kernel_host_port = getattr(agent, "_kernel_host_port", None)
    if not isinstance(kernel_host_port, Mapping):
        raise RuntimeError("desktop_kernel_host_port_missing")
    host_capabilities = kernel_host_port.get("capabilities")
    if not isinstance(host_capabilities, Sequence) or isinstance(host_capabilities, (str, bytes)):
        raise RuntimeError("desktop_kernel_host_capabilities_missing")
    run_id = f"desktop-{uuid.uuid4()}"
    start = build_desktop_start_envelope(
        run_id=run_id,
        session_id=current_session_id,
        input_text=normalized_task.input_text,
        model_id=model_id,
        tools=schemas,
        host_port=kernel_host_port,
        artifacts=list(normalized_task.artifacts),
        history=history,
        context_budget=getattr(agent, "_p9_context_budget", None),
        memory_candidates=_desktop_memory_candidates(agent),
        satisfied_capability_domains=(
            tuple(getattr(agent, "_trusted_evidence_domains", ()))
            or _TRUSTED_EVIDENCE_DOMAINS.get()
        ),
        agent={
            "schema_version": 1,
            "prompt_version": "p9-agent-kernel-v1",
            "system_prompt": system_prompt,
            "tool_policy": (
                "Use tools when required for correctness; never invent Tool results or citations. "
                "For changeable facts, directly open authoritative primary sources when available. "
                "When the answer contains multiple distinct events, products, or factual groups, verify and cite "
                "a primary source for each group instead of treating one source as support for every claim. "
                "Include the exact full HTTPS URL of every cited source in the final answer so each citation can "
                "be opened and bound to the claim it supports."
            ),
            "agent_profile": _desktop_default_subagent_profile(agent),
        },
    )
    async for event in DesktopKernelRunStream(
        coordinator, assistant_name=str(getattr(agent, "name", "OpenDrSai")),
    ).execute(start):
        if isinstance(event, TaskResult):
            yield TaskResult(messages=[*prefix_messages, *event.messages], stop_reason=event.stop_reason)
        else:
            yield event
