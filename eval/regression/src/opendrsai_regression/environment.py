from __future__ import annotations

import hashlib
import base64
import json
import shutil
import tempfile
import mimetypes
from datetime import datetime, timezone
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .case_loader import RegressionCase
from .workspace_digest import directory_digest, directory_snapshot


class EnvironmentError(RuntimeError):
    pass


@dataclass
class PreparedEnvironment:
    case_id: str
    root: Path
    workspace: Path
    attachment_refs: dict[str, str]
    manifest: dict[str, Any]
    workspace_snapshot_before: dict[str, str]
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
            snapshot_before = directory_snapshot(workspace)
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
            return PreparedEnvironment(case.id, root, workspace, refs, manifest, snapshot_before, temporary)
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
                    "sha256": digest, "corpus_complete": knowledge_base.get("corpus_complete") is True,
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
        run_fixture = environment.get("run_fixture")
        prepared_run_fixture: dict[str, Any] | None = None
        if isinstance(run_fixture, dict) and run_fixture.get("path"):
            source = self._case_resource(case, str(run_fixture["path"]))
            raw = source.read_bytes()
            digest = hashlib.sha256(raw).hexdigest()
            if digest != run_fixture.get("sha256"):
                raise EnvironmentError(f"Run fixture digest changed: {run_fixture['path']}")
            prepared_run_fixture = {
                "sha256": digest,
                "content_base64": base64.b64encode(raw).decode("ascii"),
            }
        control = {
            "schema_version": "opendrsai.regression-control/1", "case_id": case.id, "case_revision": case.revision,
            "network": environment.get("network", "unspecified"), "required_capabilities": environment.get("required_capabilities") or [],
            "forbidden_capabilities": environment.get("forbidden_capabilities") or [], "required_skills": environment.get("required_skills") or [],
            "tool_faults": environment.get("tool_faults") or [], "tool_fixtures": environment.get("tool_fixtures") or {},
            "knowledge_bases": [
                {
                    **item,
                    "content_base64": base64.b64encode(
                        (workspace / item["reference"]).read_bytes()
                    ).decode("ascii"),
                }
                for item in knowledge
            ],
            "tools": environment.get("tools") or [],
            "allowed_commands": environment.get("allowed_commands") or [],
            "run_fixture": prepared_run_fixture,
            "allowed_operations": environment.get("allowed_operations") or [],
            "forbidden_operations": environment.get("forbidden_operations") or [],
            "workspace": environment.get("workspace") or {},
            "artifact_targets": [
                str(item.get("relative_path"))
                for item in [((case.data.get("expect") or {}).get("artifacts") or {}).get("required")]
                if isinstance(item, dict) and item.get("relative_path")
            ],
            "image_constraints": {
                "required": list((((case.data.get("expect") or {}).get("image") or {}).get("visual_requirements") or [])),
                "forbidden": list((((case.data.get("expect") or {}).get("image") or {}).get("visual_forbidden") or [])),
            } if (case.data.get("expect") or {}).get("image") else {},
            "controlled_write_target": (
                dict((case.data.get("baseline") or {}).get("target") or {})
                if case.id == "safety.write_approval" else {}
            ),
        }
        # A plain conversational case must remain runnable against the normal
        # Desktop Runtime. Only attach the privileged regression envelope when
        # the case actually asks the test Runtime to inject or constrain a
        # capability; the network declaration alone is descriptive evidence.
        needs_control = any(control[key] for key in (
            "required_capabilities", "forbidden_capabilities", "required_skills",
            "tool_faults", "tool_fixtures", "knowledge_bases", "allowed_commands", "workspace",
            "tools",
            "artifact_targets",
            "image_constraints",
            "controlled_write_target",
            "run_fixture", "allowed_operations", "forbidden_operations",
        ))
        if needs_control:
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


def write_environment_manifest(environment: PreparedEnvironment, path: Path) -> None:
    path.write_text(json.dumps(environment.manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
