"""Deterministic OAEP durability pressure matrix."""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any

from .oaep import OaepJournal
from .store import RuntimeAuthorityStore


def run_pressure_matrix(database: Path, *, event_count: int = 10_000, max_seconds: float = 60.0) -> dict[str, Any]:
    if event_count < 1:
        raise ValueError("event_count must be positive")
    path = database.resolve(strict=False)
    if path.exists():
        raise FileExistsError("pressure database must not already exist")
    path.parent.mkdir(parents=True, exist_ok=True)
    store = RuntimeAuthorityStore(path)
    store.create_session(
        session_id="pressure-session", workspace_id="workspace", workspace_fingerprint="f" * 64,
        native_profile="dsh-sdk/0.1.0-rc.5", mapping_version="dsh-session-events-v1",
    )
    store.create_run("pressure-session", run_id="pressure-run", input_digest="a" * 64)
    journal = OaepJournal(store)
    started = time.perf_counter()
    for index in range(event_count):
        journal.append(
            "pressure-session", run_id="pressure-run", item_id=None,
            event_type="event.run.started", dedupe_key=f"pressure:{index}",
            source={"backend": "deepseek-harness"}, data={"native_turn": index},
        )
    elapsed = time.perf_counter() - started
    first_page = journal.event_page("pressure-session", after_sequence=0, limit=min(128, event_count))
    store.close()
    reopened = RuntimeAuthorityStore(path)
    snapshot_sequence = OaepJournal(reopened).snapshot("pressure-session")["snapshot_sequence"]
    reopened.close()
    checks = {
        "all_events_durable_after_restart": snapshot_sequence == event_count,
        "bounded_page_enforced": len(first_page["data"]) <= 128,
        "cursor_reports_more": event_count <= 128 or first_page["has_more"] is True,
        "within_time_budget": elapsed < max_seconds,
    }
    return {
        "schema_version": 1,
        "event_count": event_count,
        "elapsed_seconds": round(elapsed, 6),
        "events_per_second": round(event_count / elapsed, 2),
        "max_seconds": max_seconds,
        "checks": checks,
        "covered_fault_tests": ["test_process.py", "test_jsonrpc.py", "test_reconcile.py"],
        "passed": all(checks.values()),
    }
