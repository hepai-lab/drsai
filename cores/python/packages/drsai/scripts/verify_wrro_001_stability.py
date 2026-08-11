"""Generate a production-scale WRRO-001 fixture and verify Relay isolation."""

from __future__ import annotations

import argparse
import asyncio
from contextlib import closing
import json
from pathlib import Path
import shutil
import sqlite3
import statistics
import sys
import tempfile
import time
from typing import Any


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
if str(PACKAGE_ROOT / "src") not in sys.path:
    sys.path.insert(0, str(PACKAGE_ROOT / "src"))

from drsai.relay.gateway_control import GatewayRuntimeControlHandler  # noqa: E402


class WorkspaceTransport:
    def __init__(self, workspace_ids: list[str]) -> None:
        self.workspace_ids = workspace_ids
        self.calls: list[str] = []

    async def request(
        self,
        method: str,
        path: str,
        *,
        body: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> Any:
        self.calls.append(path)
        if method == "GET" and path == "/v1/workspaces?include_closed=true":
            return {"data": [
                {
                    "workspace_id": workspace_id,
                    "display_name": workspace_id,
                    "lifecycle": "active",
                    "revision": 1,
                    "updated_at": "2026-08-04T00:00:00Z",
                }
                for workspace_id in self.workspace_ids
            ]}
        raise AssertionError((method, path, body, headers))


def _event(runtime_id: str, session_id: str, sequence: int, padding: str) -> str:
    return json.dumps({
        "version": "1.0",
        "event_id": f"event-{session_id}-{sequence}",
        "session_id": session_id,
        "run_id": None,
        "sequence": sequence,
        "type": "event.session.updated",
        "timestamp": "2026-08-04T00:00:00Z",
        "dedupe_key": f"event-{session_id}-{sequence}",
        "source": {"backend": "runtime", "runtime_id": runtime_id},
        "data": {"padding": padding},
    }, separators=(",", ":"))


def build_fixture(
    state_dir: Path,
    *,
    historical_events: int,
    backlog_events: int,
    session_count: int,
    payload_bytes: int,
) -> tuple[list[str], dict[str, int]]:
    state_dir.mkdir(parents=True, exist_ok=True)
    database = state_dir / "engine.sqlite3"
    sessions = [f"session-{index:04d}" for index in range(session_count)]
    workspaces = [f"workspace-{index:02d}" for index in range(8)]
    padding = "h" * payload_bytes
    waterlines: dict[str, int] = {session_id: 0 for session_id in sessions}
    with closing(sqlite3.connect(database)) as connection:
        connection.executescript(
            "PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA temp_store=MEMORY;"
            "CREATE TABLE runtime_sessions("
            "session_id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL);"
            "CREATE TABLE runtime_session_sequences("
            "session_id TEXT PRIMARY KEY,last_sequence INTEGER NOT NULL,"
            "earliest_retained_sequence INTEGER NOT NULL DEFAULT 1);"
            "CREATE TABLE runtime_session_journal("
            "event_id TEXT PRIMARY KEY,session_id TEXT,session_sequence INTEGER);"
            "CREATE TABLE runtime_oaep_events("
            "event_id TEXT PRIMARY KEY,session_id TEXT,session_sequence INTEGER,"
            "envelope_json TEXT NOT NULL);"
            "CREATE TABLE runtime_runs("
            "run_id TEXT PRIMARY KEY,session_id TEXT,workspace_id TEXT,backend_id TEXT,"
            "status TEXT,created_at TEXT);"
            "CREATE TABLE runtime_events("
            "event_id TEXT PRIMARY KEY,run_id TEXT,sequence INTEGER);"
        )
        connection.executemany(
            "INSERT INTO runtime_sessions VALUES(?,?)",
            ((session_id, workspaces[index % len(workspaces)]) for index, session_id in enumerate(sessions)),
        )
        batch: list[tuple[str, str, int, str]] = []
        for index in range(historical_events):
            session_id = sessions[index % session_count]
            waterlines[session_id] += 1
            sequence = waterlines[session_id]
            event_id = f"event-{session_id}-{sequence}"
            batch.append((event_id, session_id, sequence, _event("runtime-one", session_id, sequence, padding)))
            if len(batch) >= 2_000:
                connection.executemany("INSERT INTO runtime_oaep_events VALUES(?,?,?,?)", batch)
                batch.clear()
        if batch:
            connection.executemany("INSERT INTO runtime_oaep_events VALUES(?,?,?,?)", batch)
        connection.executemany(
            "INSERT INTO runtime_session_sequences VALUES(?,?,1)",
            ((session_id, waterlines[session_id]) for session_id in sessions),
        )
        connection.executescript(
            "CREATE UNIQUE INDEX idx_runtime_oaep_events_replay "
            "ON runtime_oaep_events(session_id,session_sequence);"
            "CREATE INDEX idx_runtime_sessions_workspace "
            "ON runtime_sessions(workspace_id,session_id);"
        )
        connection.commit()

    # The handler is created by the caller at this historical waterline. Add
    # backlog later so the baseline cannot skip it.
    return workspaces, waterlines


def append_backlog(
    database: Path,
    waterlines: dict[str, int],
    *,
    backlog_events: int,
    payload_bytes: int,
) -> None:
    sessions = list(waterlines)
    hot_sessions = sessions[:3]
    padding = "n" * payload_bytes
    rows: list[tuple[str, str, int, str]] = []
    for index in range(backlog_events):
        session_id = hot_sessions[index % len(hot_sessions)]
        waterlines[session_id] += 1
        sequence = waterlines[session_id]
        rows.append((
            f"event-{session_id}-{sequence}",
            session_id,
            sequence,
            _event("runtime-one", session_id, sequence, padding),
        ))
    with closing(sqlite3.connect(database)) as connection:
        connection.executemany("INSERT INTO runtime_oaep_events VALUES(?,?,?,?)", rows)
        connection.executemany(
            "UPDATE runtime_session_sequences SET last_sequence=? WHERE session_id=?",
            ((waterlines[session_id], session_id) for session_id in hot_sessions),
        )
        connection.commit()


async def verify(
    state_dir: Path,
    workspaces: list[str],
    waterlines: dict[str, int],
    *,
    backlog_events: int,
    payload_bytes: int,
) -> dict[str, Any]:
    transport = WorkspaceTransport(workspaces)
    started = time.perf_counter()
    handler = GatewayRuntimeControlHandler("runtime-one", transport, state_dir)
    baseline_seconds = time.perf_counter() - started
    baseline = dict(handler._relay_oaep_event_cursors)
    if baseline != waterlines:
        raise AssertionError("Historical OAEP waterline was not established exactly once")
    if await handler.relay_oaep_events():
        raise AssertionError("Historical OAEP events flooded the Relay after baseline")

    append_backlog(
        state_dir / "engine.sqlite3", waterlines,
        backlog_events=backlog_events, payload_bytes=payload_bytes,
    )
    loop_delays: list[float] = []
    stop_ticker = asyncio.Event()

    async def ticker() -> None:
        previous = time.perf_counter()
        while not stop_ticker.is_set():
            await asyncio.sleep(0.005)
            current = time.perf_counter()
            loop_delays.append(max(0.0, current - previous - 0.005))
            previous = current

    ticker_task = asyncio.create_task(ticker())
    forwarded = 0
    batches = 0
    cursor_history: dict[str, list[int]] = {}
    try:
        while forwarded < backlog_events:
            frames = await handler.relay_oaep_events()
            if not frames:
                raise AssertionError(f"Relay cursor stalled after {forwarded} events")
            encoded = sum(len(json.dumps(frame["event"]).encode("utf-8")) for frame in frames)
            if len(frames) > 100 or encoded > 600_000:
                raise AssertionError(f"Unbounded Relay batch: events={len(frames)} bytes={encoded}")
            cursors: dict[str, int] = {}
            for frame in frames:
                session_id = str(frame["session_id"])
                sequence = int(frame["sequence"])
                cursors[session_id] = max(sequence, cursors.get(session_id, 0))
            await handler.ack_relay_oaep_events(cursors)
            for session_id, sequence in cursors.items():
                history = cursor_history.setdefault(session_id, [])
                if history and sequence <= history[-1]:
                    raise AssertionError("OAEP cursor was not monotonic")
                history.append(sequence)
            forwarded += len(frames)
            batches += 1
            await asyncio.sleep(0)
    finally:
        stop_ticker.set()
        await ticker_task

    if any("/oaep-events" in path for path in transport.calls):
        raise AssertionError("OAEP hot path called the Gateway through loopback HTTP")
    sorted_delays = sorted(loop_delays)
    p99 = sorted_delays[min(len(sorted_delays) - 1, int(len(sorted_delays) * 0.99))]
    maximum = max(loop_delays, default=0.0)
    if p99 >= 0.250 or maximum >= 0.500:
        raise AssertionError(f"Gateway event-loop budget exceeded: p99={p99:.3f}s max={maximum:.3f}s")
    return {
        "issue": "WRRO-001",
        "database_bytes": (state_dir / "engine.sqlite3").stat().st_size,
        "historical_sessions": len(waterlines),
        "backlog_events_forwarded": forwarded,
        "relay_batches": batches,
        "baseline_seconds": round(baseline_seconds, 3),
        "event_loop_delay_p99_ms": round(p99 * 1000, 3),
        "event_loop_delay_max_ms": round(maximum * 1000, 3),
        "loopback_oaep_requests": 0,
        "cursor_monotonic": True,
        "passed": True,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--historical-events", type=int, default=680_000)
    parser.add_argument("--backlog-events", type=int, default=11_162)
    parser.add_argument("--sessions", type=int, default=181)
    parser.add_argument("--payload-bytes", type=int, default=1_800)
    parser.add_argument("--keep-fixture", action="store_true")
    args = parser.parse_args()
    fixture = Path(tempfile.mkdtemp(prefix="opendrsai-wrro-001-"))
    try:
        workspaces, waterlines = build_fixture(
            fixture,
            historical_events=args.historical_events,
            backlog_events=args.backlog_events,
            session_count=args.sessions,
            payload_bytes=args.payload_bytes,
        )
        report = asyncio.run(verify(
            fixture, workspaces, waterlines,
            backlog_events=args.backlog_events,
            payload_bytes=args.payload_bytes,
        ))
        report.update({
            "historical_events": args.historical_events,
            "payload_bytes": args.payload_bytes,
        })
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0
    finally:
        if args.keep_fixture:
            print(f"Fixture retained at {fixture}", file=sys.stderr)
        else:
            shutil.rmtree(fixture, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
