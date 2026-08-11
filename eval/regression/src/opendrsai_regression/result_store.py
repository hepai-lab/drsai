from __future__ import annotations

import json
import os
import hashlib
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator


class ResultStore:
    def __init__(self, output_dir: str | Path, execution_id: str, schema_path: str | Path | None = None):
        self.root = Path(output_dir) / execution_id
        self.root.mkdir(parents=True, exist_ok=True)
        self.results_path = self.root / "results.jsonl"
        default_schema = Path(__file__).resolve().parents[2] / "schemas" / "result.schema.json"
        self.schema_path = Path(schema_path) if schema_path else default_schema
        self.validator = Draft202012Validator(json.loads(self.schema_path.read_text(encoding="utf-8")))

    def initialize(self, manifest: dict[str, Any], cases: list[Any]) -> None:
        manifest_path = self.root / "execution-manifest.json"
        if manifest_path.exists():
            existing = json.loads(manifest_path.read_text(encoding="utf-8"))
            if existing.get("execution_id") != manifest.get("execution_id"):
                raise ValueError("Execution manifest identity mismatch")
        else:
            manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        snapshot_dir = self.root / "cases"
        snapshot_dir.mkdir(exist_ok=True)
        for case in cases:
            source = Path(case.path)
            digest = hashlib.sha256(source.read_bytes()).hexdigest()
            snapshot = {"case_id": case.id, "revision": case.revision, "sha256": digest, "definition": case.data}
            (snapshot_dir / f"{case.id}-rev{case.revision}-{digest[:12]}.json").write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    def append(self, result: dict[str, Any]) -> None:
        errors = sorted(self.validator.iter_errors(result), key=lambda item: list(item.path))
        if errors:
            detail = "; ".join(f"{'.'.join(map(str, error.path)) or '<root>'}: {error.message}" for error in errors)
            raise ValueError(f"Invalid regression result: {detail}")
        line = json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n"
        with self.results_path.open("a", encoding="utf-8", newline="\n") as handle:
            handle.write(line)
            handle.flush()
            os.fsync(handle.fileno())

    def load(self, *, tolerate_truncated_tail: bool = True) -> list[dict[str, Any]]:
        if not self.results_path.exists():
            return []
        lines = self.results_path.read_text(encoding="utf-8").splitlines()
        results = []
        for index, line in enumerate(lines):
            try:
                value = json.loads(line)
            except json.JSONDecodeError:
                if tolerate_truncated_tail and index == len(lines) - 1:
                    break
                raise
            if isinstance(value, dict):
                results.append(value)
        return results

    def completed_case_ids(self) -> set[str]:
        return {str(item["case_id"]) for item in self.load() if item.get("status") in {"passed", "failed", "inconclusive"}}

    def resumable_case_ids(self, cases: dict[str, tuple[int, str]]) -> set[str]:
        latest: dict[str, dict[str, Any]] = {}
        for item in self.load():
            latest[str(item.get("case_id"))] = item
        valid = set()
        for case_id, (revision, digest) in cases.items():
            item = latest.get(case_id)
            if not item:
                continue
            if item.get("status") not in {"passed", "failed", "inconclusive"}:
                continue
            if item.get("case_revision") != revision or item.get("case_snapshot_sha256") != digest:
                continue
            if not item.get("evidence", {}).get("evidence_complete", False):
                continue
            valid.add(case_id)
        return valid
