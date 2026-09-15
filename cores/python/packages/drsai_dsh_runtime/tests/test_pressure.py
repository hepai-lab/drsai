from __future__ import annotations

from pathlib import Path

from opendrsai_dsh_runtime.pressure import run_pressure_matrix


def test_ten_thousand_event_pressure_restart_and_bounded_replay(tmp_path: Path) -> None:
    report = run_pressure_matrix(tmp_path / "pressure.sqlite3")
    assert report["event_count"] == 10_000
    assert report["passed"] is True
    assert all(report["checks"].values())
