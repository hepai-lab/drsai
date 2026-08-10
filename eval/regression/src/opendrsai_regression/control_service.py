from __future__ import annotations

import json
import os
import threading
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .case_loader import DefinitionError
from .catalog_api import RegressionCatalogApi


TERMINAL_STATES = {"passed", "failed", "blocked", "cancelled"}
ALLOWED_TRANSITIONS = {
    "preflighting": {"preparing_session", "blocked", "cancelled"},
    "preparing_session": {"filling_composer", "blocked", "cancelled"},
    "filling_composer": {"ready_to_send", "blocked", "cancelled"},
    "ready_to_send": {"sending", "blocked", "cancelled"},
    "sending": {"running", "blocked", "cancelled"},
    "running": {"collecting_evidence", "failed", "blocked", "cancelled"},
    "collecting_evidence": {"evaluating", "failed", "blocked", "cancelled"},
    "evaluating": {"passed", "failed", "blocked", "cancelled"},
}


@dataclass
class EvaluationRecord:
    evaluation_id: str
    suite_id: str
    case_id: str
    case_revision: int
    definition_sha256: str
    catalog_revision: str
    status: str = "preflighting"
    created_at: str = field(default_factory=lambda: _now())
    updated_at: str = field(default_factory=lambda: _now())
    thread_id: str | None = None
    run_id: str | None = None
    input_sha256: str | None = None
    attempt: int = 1
    result: dict[str, Any] | None = None
    error_code: str | None = None
    error_message: str | None = None


class RegressionControlService:
    """Persistent single-machine P4 evaluation lifecycle.

    This service never sends an Agent message.  Desktop must visibly prepare
    and submit the real Composer, then attach the resulting thread/run IDs.
    """

    def __init__(self, catalog_root: str | Path, output_root: str | Path):
        self.catalog_api = RegressionCatalogApi(catalog_root)
        self.output_root = Path(output_root).resolve()
        self.output_root.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()

    def begin_evaluation(
        self,
        *,
        suite_id: str,
        case_id: str,
        case_revision: int,
        definition_sha256: str,
    ) -> dict[str, Any]:
        listing = self.catalog_api.list_cases(suite_id)
        summary = next((item for item in listing["cases"] if item["id"] == case_id), None)
        if summary is None:
            raise DefinitionError(f"Suite {suite_id} does not contain case {case_id}")
        if int(summary["revision"]) != int(case_revision) or summary["definition_sha256"] != definition_sha256:
            raise DefinitionError("regression_case_definition_changed")
        record = EvaluationRecord(
            evaluation_id=f"eval-{uuid.uuid4()}",
            suite_id=suite_id,
            case_id=case_id,
            case_revision=int(case_revision),
            definition_sha256=definition_sha256,
            catalog_revision=listing["catalog_revision"],
        )
        with self._lock:
            self._write(record)
            self._append_event(record.evaluation_id, "evaluation_started", {"status": record.status})
        return asdict(record)

    def transition(self, evaluation_id: str, status: str, **updates: Any) -> dict[str, Any]:
        with self._lock:
            record = self._read(evaluation_id)
            allowed = ALLOWED_TRANSITIONS.get(record.status, set())
            if status not in allowed:
                raise ValueError(f"Invalid evaluation transition: {record.status} -> {status}")
            safe_updates = {key: value for key, value in updates.items() if key in {
                "thread_id", "run_id", "input_sha256", "attempt", "result", "error_code", "error_message"
            }}
            for key, value in safe_updates.items():
                setattr(record, key, value)
            record.status = status
            record.updated_at = _now()
            self._write(record)
            self._append_event(evaluation_id, "evaluation_status", {"status": status})
            return asdict(record)

    def attach_run(
        self,
        evaluation_id: str,
        *,
        thread_id: str,
        run_id: str,
        input_sha256: str,
    ) -> dict[str, Any]:
        if not thread_id or not run_id or not input_sha256:
            raise ValueError("regression_run_identity_incomplete")
        return self.transition(
            evaluation_id,
            "running",
            thread_id=thread_id,
            run_id=run_id,
            input_sha256=input_sha256,
        )

    def cancel(self, evaluation_id: str) -> dict[str, Any]:
        record = self.get(evaluation_id)
        if record["status"] in TERMINAL_STATES:
            return record
        return self.transition(evaluation_id, "cancelled")

    def get(self, evaluation_id: str) -> dict[str, Any]:
        with self._lock:
            return asdict(self._read(evaluation_id))

    def list_events(self, evaluation_id: str) -> list[dict[str, Any]]:
        self._safe_id(evaluation_id)
        path = self.output_root / evaluation_id / "events.jsonl"
        if not path.is_file():
            return []
        values: list[dict[str, Any]] = []
        for line in path.read_text(encoding="utf-8").splitlines():
            value = json.loads(line)
            if isinstance(value, dict):
                values.append(value)
        return values

    def list_history(self, *, limit: int = 100) -> list[dict[str, Any]]:
        if limit < 1 or limit > 500:
            raise ValueError("regression_history_limit_invalid")
        records: list[dict[str, Any]] = []
        for path in self.output_root.glob("eval-*/evaluation.json"):
            try:
                value = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if isinstance(value, dict):
                records.append(value)
        return sorted(records, key=lambda item: str(item.get("updated_at") or ""), reverse=True)[:limit]

    def _read(self, evaluation_id: str) -> EvaluationRecord:
        path = self.output_root / self._safe_id(evaluation_id) / "evaluation.json"
        if not path.is_file():
            raise KeyError(f"Unknown evaluation: {evaluation_id}")
        value = json.loads(path.read_text(encoding="utf-8"))
        return EvaluationRecord(**value)

    def _write(self, record: EvaluationRecord) -> None:
        directory = self.output_root / self._safe_id(record.evaluation_id)
        directory.mkdir(parents=True, exist_ok=True)
        destination = directory / "evaluation.json"
        temporary = directory / "evaluation.json.tmp"
        temporary.write_text(json.dumps(asdict(record), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.replace(temporary, destination)

    def _append_event(self, evaluation_id: str, event_type: str, data: dict[str, Any]) -> None:
        directory = self.output_root / self._safe_id(evaluation_id)
        directory.mkdir(parents=True, exist_ok=True)
        event = {"type": event_type, "at": _now(), "data": data}
        with (directory / "events.jsonl").open("a", encoding="utf-8", newline="\n") as handle:
            handle.write(json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n")
            handle.flush()
            os.fsync(handle.fileno())

    @staticmethod
    def _safe_id(evaluation_id: str) -> str:
        value = str(evaluation_id)
        if not value.startswith("eval-") or any(char not in "abcdefghijklmnopqrstuvwxyz0123456789-" for char in value):
            raise ValueError("regression_evaluation_id_invalid")
        return value


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()
