from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Iterable

import yaml
from jsonschema import Draft202012Validator

from .models import RegressionCase, RegressionSuite
from .workspace_digest import directory_digest, directory_snapshot


class DefinitionError(ValueError):
    pass


class CaseCatalog:
    def __init__(self, root: str | Path):
        self.root = Path(root).resolve()
        self.schema_dir = self.root / "schemas"
        self.cases_dir = self.root / "cases"
        self.suites_dir = self.root / "suites"

    @staticmethod
    def _read_yaml(path: Path) -> dict[str, Any]:
        try:
            value = yaml.safe_load(path.read_text(encoding="utf-8"))
        except (OSError, yaml.YAMLError) as exc:
            raise DefinitionError(f"Cannot read {path}: {exc}") from exc
        if not isinstance(value, dict):
            raise DefinitionError(f"{path} must contain a YAML mapping")
        return value

    def _validate(self, data: dict[str, Any], schema_name: str, path: Path) -> None:
        schema = json.loads((self.schema_dir / schema_name).read_text(encoding="utf-8"))
        errors = sorted(Draft202012Validator(schema).iter_errors(data), key=lambda item: list(item.path))
        if errors:
            detail = "; ".join(f"{'.'.join(map(str, e.path)) or '<root>'}: {e.message}" for e in errors)
            raise DefinitionError(f"{path}: {detail}")

    def load_cases(self) -> dict[str, RegressionCase]:
        cases: dict[str, RegressionCase] = {}
        for path in sorted(self.cases_dir.rglob("*.yaml")):
            data = self._read_yaml(path)
            self._validate(data, "case.schema.json", path)
            self._validate_contract(data, path)
            self._validate_assets(data, path)
            case_id = str(data["id"])
            if case_id in cases:
                raise DefinitionError(f"Duplicate case id {case_id}: {cases[case_id].path} and {path}")
            cases[case_id] = RegressionCase(case_id, int(data["revision"]), str(data["title"]), str(path), data)
        return cases

    @staticmethod
    def _validate_contract(data: dict[str, Any], path: Path) -> None:
        environment_allowed = {
            "network", "session", "workspace", "required_capabilities", "forbidden_capabilities", "required_skills",
            "knowledge_bases", "tool_faults", "tool_fixtures", "tools", "approval_harness", "attachment_mapping",
            "process", "allowed_commands", "run_fixture", "allowed_operations", "forbidden_operations",
        }
        expect_allowed = {
            "run", "behavior", "output", "artifacts", "citations", "evidence", "input_evidence", "image",
            "presentation", "workspace", "test_execution", "approval", "idempotency", "filesystem", "comparison", "references",
        }
        behavior_allowed = {
            "required_capabilities", "tool_calls", "logical_tool_calls", "tool_attempts", "skill_activations", "knowledge_queries",
            "approvals", "artifacts", "web_search_calls", "image_generation_calls", "knowledge_search", "retrieved_documents",
            "unrelated_tool_calls", "unrelated_skill_activations", "external_writes", "external_network_calls", "network_calls",
            "unauthorized_writes", "writes_outside_allowed_root", "file_creations", "file_deletions", "patch_operations",
            "git_write_operations", "operation_calls", "forbidden_operation_calls", "shell_commands", "workspace_reads",
            "workspace_writes", "retry", "source_access", "require_successful_tool_result",
            "workspace_search_calls",
        }
        for label, value, allowed in (
            ("environment", data.get("environment") or {}, environment_allowed),
            ("expect", data.get("expect") or {}, expect_allowed),
            ("expect.behavior", (data.get("expect") or {}).get("behavior") or {}, behavior_allowed),
        ):
            unknown = sorted(set(value).difference(allowed))
            if unknown:
                raise DefinitionError(f"{path}: unsupported {label} field(s): {', '.join(unknown)}")

    def load_suite(self, suite_id: str, cases: dict[str, RegressionCase] | None = None) -> RegressionSuite:
        path = self.suites_dir / f"{suite_id}.yaml"
        if not path.is_file():
            raise DefinitionError(f"Suite not found: {suite_id}")
        data = self._read_yaml(path)
        self._validate(data, "suite.schema.json", path)
        if data["id"] != suite_id:
            raise DefinitionError(f"Suite filename/id mismatch: {suite_id} != {data['id']}")
        catalog = cases if cases is not None else self.load_cases()
        missing = [case_id for case_id in data["cases"] if case_id not in catalog]
        if missing:
            raise DefinitionError(f"Suite {suite_id} references missing cases: {', '.join(missing)}")
        return RegressionSuite(suite_id, str(path), tuple(data["cases"]), dict(data.get("defaults") or {}), data)

    def resolve(self, *, suite: str | None = None, case_ids: Iterable[str] = (), tags: Iterable[str] = ()) -> list[RegressionCase]:
        cases = self.load_cases()
        ordered: list[str] = []
        seen: set[str] = set()
        def add(values: Iterable[str]) -> None:
            for case_id in values:
                if case_id not in seen:
                    ordered.append(case_id)
                    seen.add(case_id)
        if suite:
            add(self.load_suite(suite, cases).cases)
        add(case_ids)
        wanted_tags = set(tags)
        if wanted_tags:
            add(case.id for case in cases.values() if wanted_tags.issubset(set(case.data.get("tags") or [])))
        if not ordered:
            add(cases)
        missing = seen.difference(cases)
        if missing:
            raise DefinitionError(f"Unknown cases: {', '.join(sorted(missing))}")
        return [cases[case_id] for case_id in ordered]

    def _validate_assets(self, data: dict[str, Any], case_path: Path) -> None:
        references: list[dict[str, Any]] = []
        for message in data.get("input", {}).get("messages", []):
            for part in message.get("parts", []):
                if part.get("path"):
                    references.append(part)
        for knowledge_base in data.get("environment", {}).get("knowledge_bases", []):
            references.extend(knowledge_base.get("documents") or [])
        presentation = data.get("baseline", {}).get("presentation")
        if isinstance(presentation, dict) and presentation.get("path"):
            references.append(presentation)
        run_fixture = data.get("environment", {}).get("run_fixture")
        if isinstance(run_fixture, dict) and run_fixture.get("path"):
            references.append(run_fixture)
        for reference in references:
            raw = reference.get("path")
            target = (case_path.parent / str(raw)).resolve()
            try:
                target.relative_to(self.root)
            except ValueError as exc:
                raise DefinitionError(f"Asset escapes regression root: {raw}") from exc
            if not target.is_file():
                raise DefinitionError(f"Asset not found: {raw}")
            digest = hashlib.sha256(target.read_bytes()).hexdigest()
            if digest != reference.get("sha256"):
                raise DefinitionError(f"Asset digest mismatch: {raw}")
        workspace = data.get("environment", {}).get("workspace")
        if isinstance(workspace, dict) and workspace.get("fixture") and workspace.get("fixture") != "dynamic_empty":
            fixture = (case_path.parent / str(workspace["fixture"])).resolve()
            try:
                fixture.relative_to(self.root)
            except ValueError as exc:
                raise DefinitionError(f"Workspace fixture escapes regression root: {workspace['fixture']}") from exc
            if not fixture.is_dir():
                raise DefinitionError(f"Workspace fixture not found: {workspace['fixture']}")
            actual_fixture_sha256 = directory_digest(fixture)
            expected_fixture_sha256 = workspace.get("fixture_sha256")
            if actual_fixture_sha256 != expected_fixture_sha256:
                fixture_entries = directory_snapshot(fixture)
                raise DefinitionError(
                    f"Workspace fixture digest mismatch: {workspace['fixture']}:"
                    f"expected={expected_fixture_sha256}:actual={actual_fixture_sha256}:"
                    f"files={','.join(f'{relative}={digest}' for relative, digest in fixture_entries.items())}"
                )
