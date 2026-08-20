from __future__ import annotations

from pathlib import Path
from datetime import date

import pytest

from drsai.backend.runtime.security_boundary.static_scan import (
    load_exception_baseline,
    scan_python_files,
    unapproved_findings,
)


REPOSITORY = Path(__file__).parents[5]
RUNTIME = REPOSITORY / "cores/python/packages/drsai/src/drsai/backend/runtime"
OPERATIONS = REPOSITORY / "cores/python/packages/drsai/src/drsai/modules/agents/skills_agent/managers/operater_funs.py"
BASELINE = REPOSITORY / "cores/python/packages/drsai/security-boundary-unsafe-call-exceptions.json"


def test_no_new_unreviewed_host_side_effect_calls() -> None:
    files = [
        *RUNTIME.glob("*.py"),
        OPERATIONS,
    ]
    findings = scan_python_files(REPOSITORY, files)
    violations = unapproved_findings(findings, load_exception_baseline(BASELINE))
    assert violations == [], "New host-side effect APIs must use SandboxBroker or receive a reviewed exception:\n" + "\n".join(violations)


def test_exception_baseline_does_not_use_line_numbers_and_requires_ownership() -> None:
    baseline = load_exception_baseline(BASELINE)
    assert baseline
    assert all(record["owner"] == "runtime-security" for record in baseline.values())
    assert all(record["expires_on"] for record in baseline.values())
    assert all(":observability:" not in key for key in baseline)


def test_scanner_detects_path_mutation_and_write_mode_open_without_flagging_read(tmp_path: Path) -> None:
    source = tmp_path / "sample.py"
    source.write_text(
        "from pathlib import Path\n"
        "import aiofiles\n"
        "def mutate(path):\n"
        "    Path(path).write_text('x')\n"
        "    Path(path).unlink()\n"
        "    open(path, 'a')\n"
        "    aiofiles.open(path, mode='w')\n"
        "    open(path, 'r')\n",
        encoding="utf-8",
    )
    calls = [finding.call for finding in scan_python_files(tmp_path, [source])]
    assert calls == ["aiofiles.open[write-mode]", "open[write-mode]", "unlink", "write_text"]


def test_exception_baseline_rejects_expired_entries(tmp_path: Path) -> None:
    baseline = tmp_path / "baseline.json"
    baseline.write_text(
        '{"sample.py:f:open[write-mode]":{"count":1,"owner":"security",'
        '"reason":"migration pending","expires_on":"2026-08-15"}}',
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="exception expired"):
        load_exception_baseline(baseline, today=date(2026, 8, 16))
