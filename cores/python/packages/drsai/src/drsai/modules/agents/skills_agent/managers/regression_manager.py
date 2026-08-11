from __future__ import annotations

import importlib
import json
import os
import sys
from pathlib import Path
from typing import Any


class RegressionManager:
    """Read-only Agent adapter for the canonical regression catalog and history."""

    def __init__(self, storage_dir: str | Path):
        agent_storage = Path(storage_dir).resolve()
        profile = agent_storage.name
        self.workspace_path = agent_storage.parent
        data_home = os.environ.get("DRSAI_HOME")
        self.storage_dir = (
            Path(data_home).expanduser().resolve() / "regression" / "agent-p4" / profile
            if data_home else Path(storage_dir).resolve() / "regression" / "agent-p4"
        )
        self.storage_dir.mkdir(parents=True, exist_ok=True)

    def execute(self, tool_name: str, arguments: dict[str, Any]) -> str:
        api, service = self._services()
        if tool_name == "regression_list_suites":
            result = self._catalog_call("suites", api.list_suites)
        elif tool_name == "regression_list_cases":
            suite_id = str(arguments["suite_id"])
            result = self._catalog_call(f"suite-{suite_id}", lambda: api.list_cases(suite_id))
        elif tool_name == "regression_get_case":
            case_id = str(arguments["case_id"])
            result = self._catalog_call(f"case-{case_id}", lambda: api.get_case(case_id))
        elif tool_name == "regression_preflight":
            result = service.preflight(str(arguments["suite_id"]), list(arguments["case_ids"]))
        elif tool_name == "regression_start":
            result = service.start(str(arguments["suite_id"]), list(arguments["case_ids"]), str(arguments["catalog_revision"]), arguments.get("confirmation_token"), arguments.get("options"))
        elif tool_name == "regression_history":
            result = service.history(limit=int(arguments.get("limit", 50)))
        elif tool_name == "regression_get":
            result = service.get(str(arguments["evaluation_id"]))
        elif tool_name == "regression_events":
            result = service.events(str(arguments["evaluation_id"]), int(arguments.get("after_cursor", 0)))
        elif tool_name == "regression_cancel":
            result = service.cancel(str(arguments["evaluation_id"]))
        else:
            raise ValueError("regression_tool_not_supported")
        return json.dumps(result, ensure_ascii=False, separators=(",", ":"), sort_keys=True)

    def _catalog_call(self, cache_key: str, operation: Any) -> dict[str, Any]:
        cache_dir = self.storage_dir / "catalog-cache"
        cache_dir.mkdir(parents=True, exist_ok=True)
        cache_path = cache_dir / f"{cache_key}.json"
        try:
            result = operation()
        except Exception as exc:
            if not cache_path.is_file():
                raise
            result = json.loads(cache_path.read_text(encoding="utf-8"))
            result["catalog_stale"] = True
            result["catalog_warning"] = f"regression_catalog_invalid:{type(exc).__name__}"
            return result
        temporary = cache_path.with_suffix(".tmp")
        temporary.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temporary.replace(cache_path)
        result["catalog_stale"] = False
        return result

    def _services(self) -> tuple[Any, Any]:
        root = _resolve_regression_root()
        source = root / "src"
        if str(source) not in sys.path:
            sys.path.insert(0, str(source))
        catalog_module = importlib.import_module("opendrsai_regression.catalog_api")
        agent_module = importlib.import_module("opendrsai_regression.agent_service")
        return (
            catalog_module.RegressionCatalogApi(root),
            agent_module.AgentRegressionService(root, self.storage_dir, workspace_path=self.workspace_path),
        )


def _resolve_regression_root() -> Path:
    configured = os.environ.get("OPENDRSAI_REGRESSION_ROOT")
    candidates = [Path(configured)] if configured else []
    candidates.extend(Path.cwd().resolve().parents)
    candidates.append(Path.cwd().resolve())
    candidates.extend(Path(__file__).resolve().parents)
    seen: set[Path] = set()
    for base in candidates:
        for candidate in (base, base / "eval" / "regression"):
            try:
                resolved = candidate.resolve()
            except OSError:
                continue
            if resolved in seen:
                continue
            seen.add(resolved)
            if (resolved / "suites").is_dir() and (resolved / "src" / "opendrsai_regression").is_dir():
                return resolved
    raise RuntimeError("regression_catalog_unavailable")
