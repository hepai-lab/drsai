from __future__ import annotations

import hashlib
import json
import shutil
import tempfile
import mimetypes
from datetime import datetime, timezone
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .case_loader import RegressionCase


class EnvironmentError(RuntimeError):
    pass


@dataclass
class PreparedEnvironment:
    case_id: str
    root: Path
    workspace: Path
    attachment_refs: dict[str, str]
    manifest: dict[str, Any]
    _temporary: tempfile.TemporaryDirectory[str]

    def cleanup(self) -> None:
        self._temporary.cleanup()

    def __enter__(self) -> "PreparedEnvironment":
        return self

    def __exit__(self, *_: object) -> None:
        self.cleanup()


class EnvironmentProvisioner:
    """Prepare case-owned files without mutating repository or user workspaces."""

    def __init__(self, regression_root: str | Path, temp_parent: str | Path | None = None):
        self.regression_root = Path(regression_root).resolve()
        self.temp_parent = None if temp_parent is None else str(Path(temp_parent).resolve())

    def prepare(self, case: RegressionCase, attempt: int = 1) -> PreparedEnvironment:
        temporary = tempfile.TemporaryDirectory(prefix=f"opendrsai-regression-{case.id.replace('.', '-')}-a{attempt}-", dir=self.temp_parent)
        root = Path(temporary.name)
        workspace = root / "workspace"
        workspace.mkdir()
        try:
            self._prepare_workspace(case, workspace)
            refs = self._prepare_attachments(case, workspace)
            knowledge = self._prepare_knowledge(case, workspace)
            input_resources = self._input_resources(case, workspace, refs, knowledge)
            manifest = {
                "schema_version": "opendrsai.regression-environment/1",
                "case_id": case.id,
                "case_revision": case.revision,
                "attempt": attempt,
                "workspace_digest_before": directory_digest(workspace),
                "attachment_digests": {key: sha256_file(workspace / value) for key, value in refs.items()},
                "network": (case.data.get("environment") or {}).get("network", "unspecified"),
                "faults": (case.data.get("environment") or {}).get("tool_faults") or [],
                "approval_harness": (case.data.get("environment") or {}).get("approval_harness"),
                "knowledge_bases": knowledge,
                "input_resources": input_resources,
            }
            return PreparedEnvironment(case.id, root, workspace, refs, manifest, temporary)
        except Exception:
            temporary.cleanup()
            raise

    def _prepare_workspace(self, case: RegressionCase, target: Path) -> None:
        spec = (case.data.get("environment") or {}).get("workspace") or {}
        fixture = spec.get("fixture")
        if fixture and fixture != "dynamic_empty":
            source = self._case_resource(case, str(fixture))
            if not source.is_dir():
                raise EnvironmentError(f"Workspace fixture is not a directory: {fixture}")
            shutil.copytree(source, target, dirs_exist_ok=True)
        for relative in spec.get("initial_directories") or []:
            destination = safe_join(target, str(relative))
            destination.mkdir(parents=True, exist_ok=True)

    def _prepare_attachments(self, case: RegressionCase, workspace: Path) -> dict[str, str]:
        refs: dict[str, str] = {}
        target = workspace / ".opendrsai" / "attachments" / "regression"
        target.mkdir(parents=True, exist_ok=True)
        index = 0
        for message in case.data["input"]["messages"]:
            for part in message["parts"]:
                if not part.get("path"):
                    continue
                source = self._case_resource(case, str(part["path"]))
                digest = sha256_file(source)
                if digest != part.get("sha256"):
                    raise EnvironmentError(f"Attachment digest changed: {part['path']}")
                index += 1
                destination = target / f"{index:02d}-{source.name}"
                shutil.copy2(source, destination)
                refs[str(part["path"])] = destination.relative_to(workspace).as_posix()
        return refs

    def _prepare_knowledge(self, case: RegressionCase, workspace: Path) -> list[dict[str, Any]]:
        prepared: list[dict[str, Any]] = []
        for knowledge_base in (case.data.get("environment") or {}).get("knowledge_bases") or []:
            kb_id = str(knowledge_base["id"])
            revision = int(knowledge_base["revision"])
            for document in knowledge_base.get("documents") or []:
                source = self._case_resource(case, str(document["path"]))
                digest = sha256_file(source)
                if digest != document.get("sha256"):
                    raise EnvironmentError(f"Knowledge document digest changed: {document['path']}")
                target = workspace / ".opendrsai" / "regression" / "knowledge" / kb_id / source.name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, target)
                prepared.append({
                    "knowledge_base_id": kb_id, "knowledge_base_revision": revision,
                    "document_path": source.name, "reference": target.relative_to(workspace).as_posix(),
                    "sha256": digest,
                })
        return prepared

    def _input_resources(self, case: RegressionCase, workspace: Path, attachments: dict[str, str], knowledge: list[dict[str, Any]]) -> list[dict[str, Any]]:
        captured_at = datetime.now(timezone.utc).isoformat()
        resources: list[dict[str, Any]] = []
        for index, reference in enumerate([*attachments.values(), *(item["reference"] for item in knowledge)], 1):
            path = workspace / reference
            resources.append({
                "protocol": "oaep.input/1", "resource_id": f"regression-file-{index}", "kind": "file",
                "name": path.name, "reference": reference, "mime": mimetypes.guess_type(path.name)[0] or "application/octet-stream",
                "size_bytes": path.stat().st_size, "sha256": sha256_file(path), "permission": "read", "status": "encoded",
            })
        environment = case.data.get("environment") or {}
        control = {
            "schema_version": "opendrsai.regression-control/1", "case_id": case.id, "case_revision": case.revision,
            "network": environment.get("network", "unspecified"), "required_capabilities": environment.get("required_capabilities") or [],
            "forbidden_capabilities": environment.get("forbidden_capabilities") or [], "required_skills": environment.get("required_skills") or [],
            "tool_faults": environment.get("tool_faults") or [], "tool_fixtures": environment.get("tool_fixtures") or {},
            "allowed_commands": environment.get("allowed_commands") or [],
            "workspace": environment.get("workspace") or {},
        }
        resources.append({
            "protocol": "oaep.input/1", "resource_id": "regression-control", "kind": "selection",
            "name": "OpenDrSai regression control", "content": json.dumps(control, ensure_ascii=False, separators=(",", ":"), sort_keys=True),
            "captured_at": captured_at, "permission": "read", "status": "encoded",
        })
        return resources

    def _case_resource(self, case: RegressionCase, relative: str) -> Path:
        value = (Path(case.path).parent / relative).resolve()
        try:
            value.relative_to(self.regression_root)
        except ValueError as exc:
            raise EnvironmentError(f"Resource escapes regression root: {relative}") from exc
        return value


def safe_join(root: Path, relative: str) -> Path:
    value = (root / relative).resolve()
    try:
        value.relative_to(root.resolve())
    except ValueError as exc:
        raise EnvironmentError(f"Path escapes isolated workspace: {relative}") from exc
    return value


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def directory_digest(root: Path) -> str:
    aggregate = hashlib.sha256()
    for item in sorted(path for path in root.rglob("*") if path.is_file()):
        aggregate.update(item.relative_to(root).as_posix().encode("utf-8"))
        aggregate.update(b"\0")
        aggregate.update(hashlib.sha256(item.read_bytes()).digest())
        aggregate.update(b"\0")
    return aggregate.hexdigest()


def write_environment_manifest(environment: PreparedEnvironment, path: Path) -> None:
    path.write_text(json.dumps(environment.manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
