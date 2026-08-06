from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path

import pytest

from assemble_remote_workspace_secret_scan_p5 import BOUNDARY_SOURCES, assemble


def _report(boundary: str) -> dict:
    value = {
        "schema_version": "p5-secret/1", "boundary": boundary,
        "environment_id": "ai-dev-one", "canary_run_id": "canary-one",
        "passed": True, "matches": 0, "raw_artifacts_exported": False,
        "sources": [
            {"name": name, "status": "clean", "bytes_scanned": 10, "files_scanned": 1}
            for name in sorted(BOUNDARY_SOURCES[boundary])
        ],
    }
    if boundary == "android":
        value["artifact_sha256"] = "a" * 64
    return value


def _paths(tmp_path: Path, mutate=None) -> dict[str, Path]:
    result = {}
    for boundary in BOUNDARY_SOURCES:
        value = _report(boundary)
        if mutate is not None:
            mutate(boundary, value)
        path = tmp_path / f"{boundary}.json"
        path.write_text(json.dumps(value), encoding="utf-8")
        result[boundary] = path
    return result


def test_all_eleven_sources_are_bound_to_one_environment_and_canary(tmp_path: Path) -> None:
    result = assemble(_paths(tmp_path), environment_id="ai-dev-one", canary_run_id="canary-one")
    assert result["passed"] is True and result["matches"] == 0
    assert len(result["sources"]) == 11
    assert result["raw_artifacts_crossed_trust_boundary"] is False


@pytest.mark.parametrize("case", ["missing", "empty", "leaked", "mixed_environment", "mixed_canary", "raw_export"])
def test_boundary_failures_are_closed(tmp_path: Path, case: str) -> None:
    def mutate(boundary: str, value: dict) -> None:
        if boundary != "android":
            return
        if case == "missing": value["sources"].pop()
        elif case == "empty": value["sources"][0]["bytes_scanned"] = 0
        elif case == "leaked": value.update(passed=False, matches=1)
        elif case == "mixed_environment": value["environment_id"] = "other"
        elif case == "mixed_canary": value["canary_run_id"] = "other"
        elif case == "raw_export": value["raw_artifacts_exported"] = True
    with pytest.raises(RuntimeError):
        assemble(_paths(tmp_path, mutate), environment_id="ai-dev-one", canary_run_id="canary-one")
