from __future__ import annotations

import asyncio
import importlib.util
from pathlib import Path


MODULE = (
    Path(__file__).parents[1]
    / "src"
    / "drsai"
    / "backend"
    / "integrations"
    / "hepai.py"
)
SPEC = importlib.util.spec_from_file_location("remote_hepai", MODULE)
assert SPEC and SPEC.loader
remote_hepai = importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(remote_hepai)


def test_enabled_worker_tools_are_deduplicated_and_disabled_workers_are_skipped(tmp_path: Path) -> None:
    (tmp_path / "state.json").write_text('{"disabled": false}', "utf-8")
    def shared(): return "ok"
    calls: list[str] = []
    def load(worker_id: str): calls.append(worker_id); return [shared]
    tools, rows = asyncio.run(remote_hepai.discover_enabled_worker_tools([{"id": "one"}, {"id": "two"}, {"id": "disabled"}], load, tmp_path / "state.json"))
    assert tools == [shared]
    assert calls == ["one", "two"]
    assert rows[-1]["status"] == "disabled"


def test_worker_failure_degrades_without_failing_discovery(tmp_path: Path) -> None:
    def load(_worker_id: str): raise RuntimeError("offline")
    tools, rows = asyncio.run(remote_hepai.discover_enabled_worker_tools([{"id": "offline"}], load, tmp_path / "missing.json"))
    assert tools == []
    assert rows[0]["status"] == "unavailable"
    assert rows[0]["error"] == "RuntimeError"
