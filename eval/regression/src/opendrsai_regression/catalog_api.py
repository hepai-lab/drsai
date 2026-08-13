from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from .case_loader import CaseCatalog, DefinitionError
from .models import RegressionCase


CATALOG_SCHEMA_VERSION = "opendrsai.regression-catalog/1"


class RegressionCatalogApi:
    """Safe, UI-oriented projection of the regression definition catalog.

    YAML and JSON Schema validation remain owned by :class:`CaseCatalog`.
    Renderer clients never receive definition file paths or unrestricted asset
    paths, and Suite ordering is preserved exactly.
    """

    def __init__(self, root: str | Path):
        self.root = Path(root).resolve()
        self.catalog = CaseCatalog(self.root)

    def list_suites(self) -> dict[str, Any]:
        cases = self.catalog.load_cases()
        suites: list[dict[str, Any]] = []
        for path in sorted(self.catalog.suites_dir.glob("*.yaml")):
            value = self.catalog._read_yaml(path)
            self.catalog._validate(value, "suite.schema.json", path)
            suite_id = str(value["id"])
            suite = self.catalog.load_suite(suite_id, cases)
            suites.append({
                "id": suite.id,
                "title": str(suite.data.get("title") or suite.id),
                "description": str(suite.data.get("description") or ""),
                "case_count": len(suite.cases),
                "catalog_revision": self._suite_revision(suite.cases, cases, path),
            })
        return {"schema_version": CATALOG_SCHEMA_VERSION, "suites": suites}

    def list_cases(self, suite_id: str) -> dict[str, Any]:
        cases = self.catalog.load_cases()
        suite = self.catalog.load_suite(_validate_id(suite_id, "suite"), cases)
        suite_path = Path(suite.path)
        return {
            "schema_version": CATALOG_SCHEMA_VERSION,
            "suite": {
                "id": suite.id,
                "title": str(suite.data.get("title") or suite.id),
                "description": str(suite.data.get("description") or ""),
            },
            "catalog_revision": self._suite_revision(suite.cases, cases, suite_path),
            "cases": [self._summary(cases[case_id]) for case_id in suite.cases],
        }

    def get_case(self, case_id: str) -> dict[str, Any]:
        cases = self.catalog.load_cases()
        safe_id = _validate_id(case_id, "case")
        try:
            case = cases[safe_id]
        except KeyError as exc:
            raise DefinitionError(f"Unknown case: {safe_id}") from exc
        data = case.data
        return {
            "schema_version": CATALOG_SCHEMA_VERSION,
            **self._summary(case),
            "input": _project_input(data.get("input") or {}),
            "expect": _json_value(data.get("expect") or {}),
            "expectation_summary": _expectation_summary(data.get("expect") or {}),
            "environment": _project_environment(data.get("environment") or {}),
            "execution": _json_value(data.get("execution") or {}),
        }

    def definition_sha256(self, case: RegressionCase) -> str:
        return hashlib.sha256(Path(case.path).read_bytes()).hexdigest()

    def _summary(self, case: RegressionCase) -> dict[str, Any]:
        data = case.data
        return {
            "id": case.id,
            "revision": case.revision,
            "definition_sha256": self.definition_sha256(case),
            "title": case.title,
            "description": str(data.get("description") or ""),
            "owner": str(data.get("owner") or ""),
            "tags": [str(item) for item in data.get("tags") or []],
            "input_preview": _input_preview(data.get("input") or {}),
            "timeout_seconds": int((data.get("execution") or {}).get("timeout_seconds") or 0),
        }

    def _suite_revision(
        self,
        ordered_case_ids: tuple[str, ...],
        cases: dict[str, RegressionCase],
        suite_path: Path,
    ) -> str:
        aggregate = hashlib.sha256()
        aggregate.update(suite_path.read_bytes())
        for case_id in ordered_case_ids:
            aggregate.update(case_id.encode("utf-8"))
            aggregate.update(self.definition_sha256(cases[case_id]).encode("ascii"))
        for schema in sorted(self.catalog.schema_dir.glob("*.json")):
            aggregate.update(schema.name.encode("utf-8"))
            aggregate.update(schema.read_bytes())
        return aggregate.hexdigest()


def _validate_id(value: str, kind: str) -> str:
    candidate = str(value).strip()
    if not candidate or any(char not in "abcdefghijklmnopqrstuvwxyz0123456789_.-" for char in candidate):
        raise DefinitionError(f"Invalid regression {kind} id")
    return candidate


def _json_value(value: Any) -> Any:
    """Clone only JSON data so arbitrary YAML objects cannot cross IPC."""
    return json.loads(json.dumps(value, ensure_ascii=False))


def _project_input(value: dict[str, Any]) -> dict[str, Any]:
    messages: list[dict[str, Any]] = []
    for message in value.get("messages") or []:
        parts: list[dict[str, Any]] = []
        for part in message.get("parts") or []:
            projected = {key: item for key, item in part.items() if key not in {"sha256", "path"}}
            if part.get("path"):
                projected["asset_name"] = Path(str(part["path"])).name
            parts.append(_json_value(projected))
        messages.append({"role": str(message.get("role") or "user"), "parts": parts})
    return {"messages": messages}


def _project_environment(value: dict[str, Any]) -> dict[str, Any]:
    projected = _json_value(value)
    workspace = projected.get("workspace")
    if isinstance(workspace, dict) and workspace.get("fixture"):
        workspace["fixture"] = Path(str(workspace["fixture"])).name
    for knowledge_base in projected.get("knowledge_bases") or []:
        if not isinstance(knowledge_base, dict):
            continue
        for document in knowledge_base.get("documents") or []:
            if isinstance(document, dict) and document.get("path"):
                document["path"] = Path(str(document["path"])).name
            if isinstance(document, dict):
                document.pop("sha256", None)
    return projected


def _input_preview(value: dict[str, Any], limit: int = 180) -> str:
    text = "\n".join(
        str(part.get("text") or "")
        for message in value.get("messages") or []
        for part in message.get("parts") or []
        if part.get("type") == "text"
    ).strip()
    return text if len(text) <= limit else f"{text[: limit - 1]}…"


def _expectation_summary(expect: dict[str, Any]) -> list[dict[str, str]]:
    labels = {
        "run": "运行终态",
        "behavior": "行为与工具",
        "output": "输出内容",
        "artifacts": "产物",
        "citations": "引用",
        "evidence": "证据",
        "image": "图片",
        "presentation": "演示文稿",
        "workspace": "工作区",
        "approval": "审批",
        "filesystem": "文件系统",
        "comparison": "运行比较",
    }
    summaries: list[dict[str, str]] = []
    for key, value in expect.items():
        summaries.append({
            "group": str(key),
            "label": labels.get(str(key), str(key).replace("_", " ")),
            "summary": _compact(value),
        })
    return summaries


def _compact(value: Any, limit: int = 360) -> str:
    if isinstance(value, dict):
        text = "；".join(f"{key}: {_compact(item, 120)}" for key, item in value.items())
    elif isinstance(value, list):
        text = "；".join(_compact(item, 120) for item in value)
    elif isinstance(value, bool):
        text = "是" if value else "否"
    elif value is None:
        text = "无"
    else:
        text = str(value)
    return text if len(text) <= limit else f"{text[: limit - 1]}…"
