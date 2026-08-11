from __future__ import annotations

import json
import os
import sqlite3
from copy import deepcopy
from dataclasses import dataclass
from pathlib import Path
import asyncio
from typing import Any, Protocol
from urllib.parse import quote
from uuid import uuid4

import aiohttp

from drsai.backend.runtime.agent import AgentDefinitionStore, RuntimeExecutionError
from drsai.relay.security import redact_secrets


_OAEP_RELAY_BATCH_EVENTS = max(
    1, min(500, int(os.environ.get("OPENDRSAI_RELAY_OAEP_BATCH_EVENTS", "100")))
)
_OAEP_RELAY_BATCH_BYTES = max(
    64 * 1024,
    min(8 * 1024 * 1024, int(os.environ.get("OPENDRSAI_RELAY_OAEP_BATCH_BYTES", str(512 * 1024)))),
)
_OAEP_RELAY_SESSION_BUDGET = max(
    1, min(8, int(os.environ.get("OPENDRSAI_RELAY_OAEP_SESSION_BUDGET", "2")))
)
_OAEP_BASELINE_VERSION = "1"
_RUN_EVENT_TYPE_COMPAT = {
    "oaep.item.message.delta": "agent.message.delta",
    "oaep.item.reasoning.delta": "agent.item.reasoning.delta",
    "oaep.item.plan.delta": "agent.item.plan.delta",
    "oaep.item.command.delta": "agent.item.command.delta",
    "oaep.item.tool.delta": "agent.item.tool.delta",
    "oaep.item.subtask.delta": "agent.item.subtask.delta",
    "oaep.run.started": "agent.started",
    "oaep.run.completed": "agent.completed",
    "oaep.run.failed": "agent.failed",
    "oaep.run.cancelled": "agent.failed",
    "oaep.run.state": "agent.state",
}


class GatewayControlError(RuntimeError):
    def __init__(self, code: str, message: str, *, retryable: bool = False) -> None:
        super().__init__(message)
        self.code, self.retryable = code, retryable


class GatewayTransport(Protocol):
    async def request(self, method: str, path: str, *, body: dict[str, Any] | None = None,
                      headers: dict[str, str] | None = None) -> Any: ...


class AiohttpGatewayTransport:
    """Loopback-only transport used inside the registered Windows Runtime host."""

    def __init__(self, base_url: str, instance_token: str) -> None:
        if not base_url.startswith("http://127.0.0.1:"):
            raise ValueError("gateway_control_requires_loopback")
        self.base_url = base_url.rstrip("/")
        self.instance_token = instance_token

    async def request(self, method: str, path: str, *, body: dict[str, Any] | None = None,
                      headers: dict[str, str] | None = None) -> Any:
        status, result = await self.proxy(method, path, body=body, headers=headers)
        if status >= 400:
            detail = result.get("detail", result) if isinstance(result, dict) else {}
            if not isinstance(detail, dict):
                detail = {"message": str(detail)}
            raise GatewayControlError(str(detail.get("code") or f"runtime_http_{status}"),
                                      str(detail.get("message") or "Runtime request failed"),
                                      retryable=status >= 500)
        return result

    async def proxy(self, method: str, path: str, *, body: dict[str, Any] | None = None,
                    headers: dict[str, str] | None = None) -> tuple[int, Any]:
        values = {"X-OpenDrSai-Gateway-Token": self.instance_token, **(headers or {})}
        timeout = aiohttp.ClientTimeout(total=120)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.request(method, f"{self.base_url}{path}", json=body, headers=values) as response:
                try:
                    result = await response.json()
                except (aiohttp.ContentTypeError, json.JSONDecodeError) as exc:
                    raise GatewayControlError("runtime_response_invalid", "Runtime returned an invalid response") from exc
                return response.status, result


@dataclass(frozen=True)
class _SessionBinding:
    session_id: str
    subject: str
    workspace_id: str
    definition_id: str
    definition_version: str
    backend_id: str
    idempotency_key: str


class GatewayRuntimeControlHandler:
    """Maps Relay operations to the real Full Runtime owned by apps/desktop/windows."""

    def __init__(self, runtime_id: str, transport: GatewayTransport, state_dir: Path) -> None:
        self.runtime_id, self.transport = runtime_id, transport
        self.state_dir = Path(state_dir)
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self.database = self.state_dir / "relay-control.sqlite3"
        self.journal_database = self.state_dir / "engine.sqlite3"
        self.registry_database = self.state_dir / "runtime.sqlite3"
        self.definitions = AgentDefinitionStore(self.state_dir.parent / "assets" / "agents")
        self._execution_tasks: set[asyncio.Task[Any]] = set()
        self.execution_failures: dict[str, str] = {}
        self._relay_event_cursors: dict[str, int] = {}
        self._relay_session_event_cursors: dict[str, int] = {}
        self._relay_oaep_event_cursors: dict[str, int] = {}
        self._relay_session_scan_offsets: dict[str, int] = {}
        self._relay_terminal_runs: set[str] = set()
        self._session_waterlines_available = False
        self._oaep_waterlines_available = False
        self._approval_decision_lock = asyncio.Lock()
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.database, timeout=30)
        db.row_factory = sqlite3.Row
        return db

    def _initialize(self) -> None:
        with self._connect() as db:
            db.executescript("""
              CREATE TABLE IF NOT EXISTS relay_sessions(
                session_id TEXT PRIMARY KEY, subject TEXT NOT NULL, workspace_id TEXT NOT NULL,
                definition_id TEXT NOT NULL, definition_version TEXT NOT NULL, backend_id TEXT NOT NULL,
                idempotency_key TEXT NOT NULL, UNIQUE(subject,idempotency_key)
              );
              CREATE TABLE IF NOT EXISTS relay_runs(
                run_id TEXT PRIMARY KEY, subject TEXT NOT NULL, workspace_id TEXT NOT NULL, session_id TEXT NOT NULL,
                correlation_id TEXT NOT NULL, message TEXT NOT NULL, attachment_refs_json TEXT NOT NULL,
                retry_of TEXT, idempotency_key TEXT NOT NULL, source_message_id TEXT,
                UNIQUE(subject,idempotency_key)
              );
              CREATE TABLE IF NOT EXISTS relay_approval_decisions(
                subject TEXT NOT NULL, idempotency_key TEXT NOT NULL, approval_id TEXT NOT NULL,
                decision TEXT NOT NULL, result_json TEXT NOT NULL,
                PRIMARY KEY(subject,idempotency_key)
              );
              CREATE TABLE IF NOT EXISTS relay_session_event_cursors(
                session_id TEXT PRIMARY KEY,
                after_sequence INTEGER NOT NULL CHECK(after_sequence >= 0)
              );
              CREATE TABLE IF NOT EXISTS relay_oaep_event_cursors(
                session_id TEXT PRIMARY KEY,
                after_sequence INTEGER NOT NULL CHECK(after_sequence >= 0)
              );
              CREATE TABLE IF NOT EXISTS relay_run_event_cursors(
                run_id TEXT PRIMARY KEY,
                after_sequence INTEGER NOT NULL CHECK(after_sequence >= 0),
                terminal INTEGER NOT NULL DEFAULT 0 CHECK(terminal IN (0,1))
              );
              CREATE TABLE IF NOT EXISTS relay_metadata(
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
              );
            """)
            columns = {
                str(row["name"])
                for row in db.execute("PRAGMA table_info(relay_runs)")
            }
            if "source_message_id" not in columns:
                db.execute("ALTER TABLE relay_runs ADD COLUMN source_message_id TEXT")
            self._relay_session_event_cursors.update(
                {
                    str(row["session_id"]): int(row["after_sequence"])
                    for row in db.execute(
                        "SELECT session_id,after_sequence FROM relay_session_event_cursors"
                    )
                }
            )
            self._relay_oaep_event_cursors.update(
                {
                    str(row["session_id"]): int(row["after_sequence"])
                    for row in db.execute(
                        "SELECT session_id,after_sequence FROM relay_oaep_event_cursors"
                    )
                }
            )
            for row in db.execute(
                "SELECT run_id,after_sequence,terminal FROM relay_run_event_cursors"
            ):
                run_id = str(row["run_id"])
                self._relay_event_cursors[run_id] = int(row["after_sequence"])
                if int(row["terminal"]):
                    self._relay_terminal_runs.add(run_id)
        self._bootstrap_existing_session_cursors()

    def _bootstrap_existing_session_cursors(self) -> None:
        """Seed waterlines for Sessions that predate this connector process."""
        if not self.journal_database.is_file():
            return
        try:
            with sqlite3.connect(self.journal_database, timeout=5) as journal:
                legacy = [
                    (str(session_id), int(sequence))
                    for session_id, sequence in journal.execute(
                        "SELECT session_id,last_sequence FROM runtime_session_sequences"
                    )
                ]
                oaep = [
                    (str(session_id), int(sequence))
                    for session_id, sequence in journal.execute(
                        "SELECT q.session_id,COALESCE((SELECT MAX(o.session_sequence) "
                        "FROM runtime_oaep_events o WHERE o.session_id=q.session_id),0) "
                        "FROM runtime_session_sequences q"
                    )
                ]
                runs = [
                    (str(run_id), int(sequence), str(status))
                    for run_id, sequence, status in journal.execute(
                        "SELECT r.run_id,COALESCE((SELECT MAX(e.sequence) "
                        "FROM runtime_events e WHERE e.run_id=r.run_id),0),r.status "
                        "FROM runtime_runs r"
                    )
                ]
        except sqlite3.Error:
            return
        self._session_waterlines_available = True
        self._oaep_waterlines_available = True
        with self._connect() as control:
            baseline = control.execute(
                "SELECT value FROM relay_metadata WHERE key='oaep_replay_baseline'"
            ).fetchone()
            establishing_oaep_baseline = baseline is None
            control.executemany(
                "INSERT INTO relay_session_event_cursors(session_id,after_sequence) "
                "VALUES(?,?) ON CONFLICT(session_id) DO NOTHING",
                legacy,
            )
            control.executemany(
                "INSERT INTO relay_oaep_event_cursors(session_id,after_sequence) "
                "VALUES(?,?) ON CONFLICT(session_id) DO UPDATE SET "
                "after_sequence=MAX(relay_oaep_event_cursors.after_sequence,excluded.after_sequence)"
                if establishing_oaep_baseline else
                "INSERT INTO relay_oaep_event_cursors(session_id,after_sequence) "
                "VALUES(?,?) ON CONFLICT(session_id) DO NOTHING",
                oaep,
            )
            control.executemany(
                "INSERT INTO relay_run_event_cursors(run_id,after_sequence,terminal) "
                "VALUES(?,?,?) ON CONFLICT(run_id) DO NOTHING",
                [
                    (run_id, sequence, int(status in {"completed", "failed", "cancelled"}))
                    for run_id, sequence, status in runs
                ],
            )
            if establishing_oaep_baseline:
                control.execute(
                    "INSERT INTO relay_metadata(key,value) VALUES('oaep_replay_baseline',?)",
                    (_OAEP_BASELINE_VERSION,),
                )
        for session_id, sequence in legacy:
            self._relay_session_event_cursors.setdefault(session_id, sequence)
        for session_id, sequence in oaep:
            if establishing_oaep_baseline:
                self._relay_oaep_event_cursors[session_id] = max(
                    sequence, self._relay_oaep_event_cursors.get(session_id, 0)
                )
            else:
                self._relay_oaep_event_cursors.setdefault(session_id, sequence)
        for run_id, sequence, status in runs:
            self._relay_event_cursors.setdefault(run_id, sequence)
            if status in {"completed", "failed", "cancelled"}:
                self._relay_terminal_runs.add(run_id)

    def _store_run_event_cursor(
        self, run_id: str, sequence: int, *, terminal: bool,
    ) -> None:
        value = max(0, int(sequence))
        with self._connect() as db:
            db.execute(
                "INSERT INTO relay_run_event_cursors(run_id,after_sequence,terminal) "
                "VALUES(?,?,?) ON CONFLICT(run_id) DO UPDATE SET "
                "after_sequence=MAX(relay_run_event_cursors.after_sequence,excluded.after_sequence),"
                "terminal=MAX(relay_run_event_cursors.terminal,excluded.terminal)",
                (run_id, value, int(terminal)),
            )
        self._relay_event_cursors[run_id] = max(
            value, self._relay_event_cursors.get(run_id, 0)
        )
        if terminal:
            self._relay_terminal_runs.add(run_id)

    def _store_session_event_cursor(self, session_id: str, sequence: int) -> None:
        value = max(0, int(sequence))
        with self._connect() as db:
            db.execute(
                """
                INSERT INTO relay_session_event_cursors(session_id,after_sequence)
                VALUES(?,?)
                ON CONFLICT(session_id) DO UPDATE SET
                  after_sequence=MAX(relay_session_event_cursors.after_sequence,excluded.after_sequence)
                """,
                (session_id, value),
            )
            stored = db.execute(
                "SELECT after_sequence FROM relay_session_event_cursors WHERE session_id=?",
                (session_id,),
            ).fetchone()
        self._relay_session_event_cursors[session_id] = int(stored["after_sequence"])

    def _store_oaep_event_cursor(self, session_id: str, sequence: int) -> None:
        self._store_oaep_event_cursors({session_id: sequence})

    def _store_oaep_event_cursors(self, cursors: dict[str, int]) -> None:
        values = [
            (session_id, max(0, int(sequence)))
            for session_id, sequence in cursors.items()
            if session_id
        ]
        if not values:
            return
        with self._connect() as db:
            db.executemany(
                """
                INSERT INTO relay_oaep_event_cursors(session_id,after_sequence)
                VALUES(?,?)
                ON CONFLICT(session_id) DO UPDATE SET
                  after_sequence=MAX(relay_oaep_event_cursors.after_sequence,excluded.after_sequence)
                """,
                values,
            )
        for session_id, value in values:
            self._relay_oaep_event_cursors[session_id] = max(
                value, self._relay_oaep_event_cursors.get(session_id, 0)
            )

    def ack_relay_oaep_event(self, session_id: str, sequence: int) -> None:
        """Commit an OAEP cursor only after its WSS frame was written."""
        self._store_oaep_event_cursor(session_id, sequence)

    async def ack_relay_oaep_events(self, cursors: dict[str, int]) -> None:
        """Commit one monotonic OAEP cursor transaction per WSS provider batch."""
        await asyncio.to_thread(self._store_oaep_event_cursors, cursors)

    def _sessions_with_pending_journal_events(self) -> list[str]:
        """Read Runtime waterlines without scanning every Session over HTTP."""
        if not self.journal_database.is_file():
            return []
        try:
            with sqlite3.connect(self.journal_database, timeout=5) as db:
                rows = db.execute(
                    "SELECT session_id,last_sequence FROM runtime_session_sequences"
                ).fetchall()
        except sqlite3.Error:
            # The HTTP hot/cold scan remains the fail-safe fallback while a
            # migration or a short SQLite lock is in progress.
            return []
        pending_ids = [
            str(session_id) for session_id, last_sequence in rows
            if int(last_sequence) > self._relay_session_event_cursors.get(str(session_id), 0)
        ]
        if not pending_ids:
            return []
        placeholders = ",".join("?" for _ in pending_ids)
        try:
            with sqlite3.connect(self.journal_database, timeout=5) as db:
                latest_rows = dict(db.execute(
                    "SELECT session_id,MAX(rowid) FROM runtime_session_journal "
                    f"WHERE session_id IN ({placeholders}) GROUP BY session_id",
                    pending_ids,
                ))
        except sqlite3.Error:
            latest_rows = {}
        pending = [
            (int(latest_rows.get(session_id, 0)), session_id)
            for session_id in pending_ids
        ]
        pending.sort(reverse=True)
        return [session_id for _, session_id in pending]

    def _sessions_with_pending_oaep_events(self) -> list[str]:
        """Find canonical OAEP waterlines without translating legacy rows."""
        if not self.journal_database.is_file():
            return []
        try:
            with sqlite3.connect(self.journal_database, timeout=5) as db:
                rows = db.execute(
                    "SELECT session_id,last_sequence FROM runtime_session_sequences"
                ).fetchall()
        except sqlite3.Error:
            return []
        pending_ids = [
            str(session_id) for session_id, last_sequence in rows
            if int(last_sequence) > self._relay_oaep_event_cursors.get(str(session_id), 0)
        ]
        if not pending_ids:
            return []
        placeholders = ",".join("?" for _ in pending_ids)
        try:
            with sqlite3.connect(self.journal_database, timeout=5) as db:
                latest_rows = dict(db.execute(
                    "SELECT session_id,MAX(rowid) FROM runtime_oaep_events "
                    f"WHERE session_id IN ({placeholders}) GROUP BY session_id",
                    pending_ids,
                ))
        except sqlite3.Error:
            latest_rows = {}
        pending = [
            (int(latest_rows.get(session_id, 0)), session_id)
            for session_id in pending_ids
        ]
        pending.sort(reverse=True)
        return [session_id for _, session_id in pending]

    def _retire_unpublished_session_cursors(
        self,
        pending_session_ids: list[str],
        active_workspace_ids: set[str],
        *,
        oaep: bool,
    ) -> list[str]:
        """Exclude Sessions that Relay cannot route and persist their waterline.

        A Workspace outside the published catalog cannot receive Relay events.
        Keeping its Session marked pending causes a permanent database scan after
        compaction or migration creates a new sequence waterline. Its canonical
        local snapshot remains authoritative; if the Workspace is published again,
        later mutations advance beyond this stored baseline and are forwarded.
        """
        if not pending_session_ids or not self.journal_database.is_file():
            return pending_session_ids
        placeholders = ",".join("?" for _ in pending_session_ids)
        try:
            with sqlite3.connect(self.journal_database, timeout=5) as journal:
                rows = journal.execute(
                    "SELECT s.session_id,s.workspace_id,q.last_sequence "
                    "FROM runtime_sessions s JOIN runtime_session_sequences q "
                    "ON q.session_id=s.session_id "
                    f"WHERE s.session_id IN ({placeholders})",
                    pending_session_ids,
                ).fetchall()
        except sqlite3.Error:
            return pending_session_ids
        active_sessions: list[str] = []
        retired: dict[str, int] = {}
        for session_id, workspace_id, last_sequence in rows:
            normalized = str(session_id)
            if str(workspace_id) in active_workspace_ids:
                active_sessions.append(normalized)
            else:
                retired[normalized] = int(last_sequence)
        if oaep:
            self._store_oaep_event_cursors(retired)
        else:
            for session_id, sequence in retired.items():
                self._store_session_event_cursor(session_id, sequence)
        return active_sessions

    def _retire_reconstructed_oaep_cursors(
        self, pending_session_ids: list[str]
    ) -> None:
        """Skip only a proven contiguous prefix of upgrade-rebuilt OAEP rows.

        These rows mirror Runtime Events that an earlier Relay cursor already
        passed before Journal compaction. Re-sending them can be rejected as
        duplicate semantic events and otherwise creates an infinite retry loop.
        Any row without all three proofs stops the advance and is sent normally.
        """
        if not pending_session_ids or not self.journal_database.is_file():
            return
        advances: dict[str, int] = {}
        try:
            with sqlite3.connect(self.journal_database, timeout=5) as journal:
                for session_id in pending_session_ids:
                    after = self._relay_oaep_event_cursors.get(session_id, 0)
                    rows = journal.execute(
                        "SELECT j.session_sequence,j.dedupe_key,"
                        "json_extract(j.payload_json,'$.migrated'),"
                        "EXISTS(SELECT 1 FROM runtime_events e "
                        "WHERE e.event_id=substr(j.dedupe_key,length('runtime-event:')+1)) "
                        "FROM runtime_session_journal j "
                        "WHERE j.session_id=? AND j.session_sequence>? "
                        "ORDER BY j.session_sequence",
                        (session_id, after),
                    )
                    through = after
                    for sequence, dedupe_key, migrated, source_exists in rows:
                        if not (
                            str(dedupe_key or "").startswith("runtime-event:")
                            and int(migrated or 0) == 1
                            and int(source_exists or 0) == 1
                        ):
                            break
                        through = int(sequence)
                    if through > after:
                        advances[session_id] = through
        except sqlite3.Error:
            return
        self._store_oaep_event_cursors(advances)

    def _eligible_oaep_sessions(
        self,
        pending_session_ids: list[str],
        active_workspace_ids: set[str],
    ) -> list[dict[str, str]] | None:
        if not pending_session_ids or not active_workspace_ids or not self.journal_database.is_file():
            return []
        placeholders = ",".join("?" for _ in pending_session_ids)
        workspace_placeholders = ",".join("?" for _ in active_workspace_ids)
        try:
            with sqlite3.connect(self.journal_database, timeout=5) as journal:
                rows = journal.execute(
                    "SELECT session_id,workspace_id FROM runtime_sessions "
                    f"WHERE session_id IN ({placeholders}) "
                    f"AND workspace_id IN ({workspace_placeholders}) LIMIT ?",
                    (
                        *pending_session_ids,
                        *active_workspace_ids,
                        _OAEP_RELAY_SESSION_BUDGET,
                    ),
                ).fetchall()
        except sqlite3.Error:
            return None
        return [
            {"session_id": str(row[0]), "workspace_id": str(row[1])}
            for row in rows
        ]

    def _eligible_journal_sessions(
        self,
        pending_session_ids: list[str],
        active_workspace_ids: set[str],
    ) -> list[dict[str, str]] | None:
        """Bind pending legacy Journal sessions without blocking the event loop."""
        if not pending_session_ids or not active_workspace_ids or not self.journal_database.is_file():
            return []
        placeholders = ",".join("?" for _ in pending_session_ids)
        workspace_placeholders = ",".join("?" for _ in active_workspace_ids)
        try:
            with sqlite3.connect(self.journal_database, timeout=5) as journal:
                rows = journal.execute(
                    "SELECT session_id,workspace_id FROM runtime_sessions "
                    f"WHERE session_id IN ({placeholders}) "
                    f"AND workspace_id IN ({workspace_placeholders}) LIMIT 8",
                    (*pending_session_ids, *active_workspace_ids),
                ).fetchall()
        except sqlite3.Error:
            return None
        return [
            {"session_id": str(row[0]), "workspace_id": str(row[1])}
            for row in rows
        ]

    def _read_local_oaep_events(
        self, session_id: str, after_sequence: int
    ) -> list[dict[str, Any]]:
        """Read a count-and-byte-bounded OAEP page off the Gateway event loop."""
        if not self.journal_database.is_file():
            return []
        events: list[dict[str, Any]] = []
        encoded_bytes = 0
        with sqlite3.connect(self.journal_database, timeout=5) as journal:
            state = journal.execute(
                "SELECT earliest_retained_sequence,last_sequence "
                "FROM runtime_session_sequences WHERE session_id=?",
                (session_id,),
            ).fetchone()
            if state is None:
                return []
            earliest = int(state[0])
            if after_sequence < earliest - 1:
                raise GatewayControlError(
                    "cursor_expired", "OAEP replay cursor expired", retryable=True
                )
            cursor = journal.execute(
                "SELECT envelope_json FROM runtime_oaep_events "
                "WHERE session_id=? AND session_sequence>? "
                "ORDER BY session_sequence LIMIT ?",
                (session_id, after_sequence, _OAEP_RELAY_BATCH_EVENTS),
            )
            for row in cursor:
                encoded = str(row[0])
                size = len(encoded.encode("utf-8"))
                if events and encoded_bytes + size > _OAEP_RELAY_BATCH_BYTES:
                    break
                events.append(json.loads(encoded))
                encoded_bytes += size
        return events

    def _bind_oaep_public_runtime_identity(
        self, event: dict[str, Any]
    ) -> dict[str, Any]:
        """Bind a local canonical Event to its Relay enrollment identity.

        The Runtime database deliberately has a stable machine-local identity,
        while a Relay enrollment owns the externally routable Runtime id.  OAEP
        Events are persisted before the optional Relay connector exists, so the
        stored ``source.runtime_id`` can legitimately be the local identity.
        Export a copy under the authenticated enrollment identity; never mutate
        the authoritative Journal row or relax the connector's fail-closed
        identity check.
        """
        bound = deepcopy(event)
        source = bound.get("source")
        if isinstance(source, dict):
            source["runtime_id"] = self.runtime_id
        return bound

    def _read_local_session_events(
        self, session_id: str, after_sequence: int
    ) -> list[dict[str, Any]]:
        """Read the legacy Session Journal without a loopback HTTP request."""
        if not self.journal_database.is_file():
            return []
        with sqlite3.connect(self.journal_database, timeout=5) as journal:
            journal.row_factory = sqlite3.Row
            state = journal.execute(
                "SELECT earliest_retained_sequence,last_sequence "
                "FROM runtime_session_sequences WHERE session_id=?",
                (session_id,),
            ).fetchone()
            if state is None:
                return []
            if after_sequence < int(state["earliest_retained_sequence"]) - 1:
                raise GatewayControlError(
                    "cursor_expired", "Session replay cursor expired", retryable=True
                )
            rows = journal.execute(
                "SELECT * FROM runtime_session_journal "
                "WHERE session_id=? AND session_sequence>? "
                "ORDER BY session_sequence LIMIT 2000",
                (session_id, after_sequence),
            ).fetchall()
        return [
            {
                "event_id": str(row["event_id"]),
                "runtime_id": str(row["runtime_id"]),
                "workspace_id": str(row["workspace_id"]),
                "session_id": str(row["session_id"]),
                "run_id": str(row["run_id"]) if row["run_id"] is not None else None,
                "session_sequence": int(row["session_sequence"]),
                "kind": str(row["event_kind"]),
                "timestamp": str(row["created_at"]),
                "item_id": str(row["item_id"]) if row["item_id"] is not None else None,
                "item_revision": int(row["item_revision"]) if row["item_revision"] is not None else None,
                "payload": json.loads(str(row["payload_json"])),
            }
            for row in rows
        ]

    def _read_local_run_events(
        self, run_id: str, after_sequence: int
    ) -> list[dict[str, Any]]:
        """Read bounded Run events without consuming a Gateway request slot."""
        if not self.journal_database.is_file():
            return []
        with sqlite3.connect(self.journal_database, timeout=5) as journal:
            journal.row_factory = sqlite3.Row
            rows = journal.execute(
                "SELECT * FROM runtime_events WHERE run_id=? AND sequence>? "
                "ORDER BY sequence LIMIT 2000",
                (run_id, after_sequence),
            ).fetchall()
        events: list[dict[str, Any]] = []
        for row in rows:
            event_type = str(row["event_type"])
            if event_type.startswith("oaep.item.") and not event_type.endswith(".delta"):
                event_type = "agent.item." + event_type.removeprefix("oaep.item.")
            else:
                event_type = _RUN_EVENT_TYPE_COMPAT.get(event_type, event_type)
            event = {
                "event_id": str(row["event_id"]),
                "run_id": str(row["run_id"]),
                "sequence": int(row["sequence"]),
                "type": event_type,
                "data": json.loads(str(row["data_json"])),
                "created_at": str(row["created_at"]),
            }
            if row["backend_event_key"] is not None:
                event["backend_event_key"] = str(row["backend_event_key"])
            events.append(event)
        return events

    def _latest_local_session_sequence(self, session_id: str) -> int:
        if not self.journal_database.is_file():
            return 0
        try:
            with sqlite3.connect(self.journal_database, timeout=5) as journal:
                row = journal.execute(
                    "SELECT last_sequence FROM runtime_session_sequences WHERE session_id=?",
                    (session_id,),
                ).fetchone()
        except sqlite3.Error:
            return 0
        return int(row[0]) if row is not None else 0

    def _read_local_workspaces(self) -> list[dict[str, Any]] | None:
        """Read the Runtime registry directly; Relay must never call its own port."""
        if not self.registry_database.is_file():
            return None
        try:
            with sqlite3.connect(self.registry_database, timeout=5) as registry:
                registry.row_factory = sqlite3.Row
                rows = registry.execute(
                    "SELECT workspace_id,canonical_path,display_name,lifecycle,"
                    "revision,updated_at,last_opened_at,created_at "
                    "FROM workspaces ORDER BY last_opened_at DESC,workspace_id"
                ).fetchall()
        except sqlite3.Error:
            return None
        return [
            {
                "runtime_id": self.runtime_id,
                "workspace_id": str(row["workspace_id"]),
                "display_name": str(
                    row["display_name"] or Path(str(row["canonical_path"])).name
                    or row["workspace_id"]
                ),
                "lifecycle": str(row["lifecycle"]),
                "revision": int(row["revision"] or 1),
                "updated_at": row["updated_at"] or row["last_opened_at"] or row["created_at"],
            }
            for row in rows
        ]

    @staticmethod
    def _bounded_oaep_frames(frames: list[dict[str, Any]]) -> list[dict[str, Any]]:
        bounded: list[dict[str, Any]] = []
        encoded_bytes = 0
        for frame in frames:
            size = len(json.dumps(
                frame.get("event"), ensure_ascii=False, separators=(",", ":")
            ).encode("utf-8"))
            if bounded and (
                len(bounded) >= _OAEP_RELAY_BATCH_EVENTS
                or encoded_bytes + size > _OAEP_RELAY_BATCH_BYTES
            ):
                break
            bounded.append(frame)
            encoded_bytes += size
        return bounded

    async def _ensure_session_event_cursor(self, session_id: str) -> int:
        existing = self._relay_session_event_cursors.get(session_id)
        if existing is not None:
            return existing
        snapshot = await self.transport.request(
            "GET",
            f"/v1/sessions/{quote(session_id, safe='')}/conversation-snapshot",
        )
        sequence = int(snapshot.get("snapshot_sequence") or 0)
        self._store_session_event_cursor(session_id, sequence)
        return sequence

    async def _ensure_oaep_event_cursor(self, session_id: str) -> int:
        existing = self._relay_oaep_event_cursors.get(session_id)
        if existing is not None:
            return existing
        snapshot = await self.transport.request(
            "GET",
            f"/v1/sessions/{quote(session_id, safe='')}/oaep-snapshot",
        )
        sequence = int(snapshot.get("snapshot_sequence") or 0)
        self._store_oaep_event_cursor(session_id, sequence)
        return sequence

    async def __call__(self, operation: str, arguments: dict[str, Any]) -> Any:
        args, kwargs = arguments.get("args", []), arguments.get("kwargs", {})
        if not isinstance(args, list) or not isinstance(kwargs, dict) or operation.startswith("_"):
            raise GatewayControlError("runtime_request_invalid", "Runtime control arguments are invalid")
        method = getattr(self, operation, None)
        if method is None or operation not in {
            "list_agent_definitions", "list_sessions", "list_sessions_for_subject", "create_session", "get_session", "update_session",
            "authorize_session", "list_runs", "list_runs_for_subject", "authorize_run",
            "conversation_for_subject", "conversation_snapshot_for_subject",
            "session_events_for_subject", "oaep_snapshot_for_subject", "oaep_events_for_subject",
            "idempotency_result", "create_run", "get_run", "list_events", "cancel_run",
            "pending_approvals", "pending_approvals_for_subject", "audit_entries", "audit_entries_for_subject",
            "execute_owop", "decide_approval",
        }:
            raise GatewayControlError("runtime_operation_unsupported", "Runtime operation is unsupported")
        return await method(*args, **kwargs)

    async def handle_http_request(
        self,
        method: str,
        path: str,
        body: dict[str, Any] | None,
        correlation_id: str,
    ) -> tuple[int, Any]:
        """Proxy HAI's frozen HTTP-over-WSS frame to the loopback Runtime."""
        normalized_method = method.upper()
        if normalized_method not in {"GET", "POST", "PATCH", "PUT", "DELETE"}:
            raise GatewayControlError("runtime_method_invalid", "Runtime proxy method is invalid")
        if not path.startswith("/v1/") or "://" in path or "#" in path:
            raise GatewayControlError("runtime_path_invalid", "Runtime proxy path is invalid")
        proxy = getattr(self.transport, "proxy", None)
        if proxy is None:
            raise GatewayControlError("runtime_http_proxy_unsupported", "Runtime HTTP proxy is unavailable")
        status, result = await proxy(
            normalized_method,
            path,
            body=body,
            headers={"X-Correlation-ID": correlation_id},
        )
        if (
            status < 400
            and normalized_method == "GET"
            and path.partition("?")[0] == "/v1/workspaces"
            and isinstance(result, dict)
            and isinstance(result.get("data"), list)
        ):
            rows: list[dict[str, Any]] = []
            for item in result["data"]:
                if not isinstance(item, dict) or not item.get("workspace_id"):
                    continue
                workspace_id = str(item["workspace_id"])
                raw_path = str(item.get("path") or "")
                rows.append({
                    "runtime_id": self.runtime_id,
                    "workspace_id": workspace_id,
                    "display_name": str(item.get("display_name") or Path(raw_path).name or workspace_id),
                    "lifecycle": item.get("lifecycle") or (
                        "active" if item.get("open", True) else "archived"
                    ),
                    "revision": int(item.get("revision") or 1),
                    "updated_at": (
                        item.get("updated_at")
                        or item.get("last_opened_at")
                        or item.get("created_at")
                    ),
                })
            result = {"data": rows, "next_cursor": result.get("next_cursor")}
        return status, result

    async def list_agent_definitions(self) -> list[dict[str, Any]]:
        capabilities = await self.transport.request("GET", "/v1/capabilities")
        health = capabilities.get("agent_backends", {})
        rows: list[dict[str, Any]] = []
        root = self.definitions.root
        for path in sorted(root.glob("*/*.json")) if root.exists() else ():
            try:
                definition = self.definitions.load(f"{path.parent.name}@{path.stem}")
            except RuntimeExecutionError:
                continue
            backend = health.get(definition.backend, {})
            rows.append({
                "definition_id": definition.asset_id, "version": definition.version,
                "display_name": str(definition.raw.get("name") or definition.asset_id),
                "backend_id": definition.backend,
                "backend_health": "healthy" if backend.get("available") else "unavailable",
                "capabilities": sorted(definition.permissions),
            })
        return rows

    async def published_workspaces(self) -> list[dict[str, Any]]:
        local = await asyncio.to_thread(self._read_local_workspaces)
        if local is not None:
            return local
        page = await self.transport.request("GET", "/v1/workspaces?include_closed=true")
        return [{
            "runtime_id": self.runtime_id,
            "workspace_id": str(item["workspace_id"]),
            "display_name": str(item.get("display_name") or item["workspace_id"]),
            "lifecycle": item.get("lifecycle") or ("active" if item.get("open", True) else "archived"),
            "revision": int(item.get("revision") or 1),
            "updated_at": item.get("updated_at") or item.get("last_opened_at") or item.get("created_at"),
        } for item in page.get("data", [])]

    def _pending_run_event_rows(self) -> list[tuple[Any, ...]] | None:
        """Return only non-terminal Run waterlines without scanning terminal Events."""
        if not self.journal_database.is_file():
            return None
        try:
            with sqlite3.connect(self.journal_database, timeout=5) as journal:
                runs = list(journal.execute(
                    "SELECT run_id,session_id,workspace_id,backend_id,status,created_at "
                    "FROM runtime_runs"
                ))
                candidates = [
                    row for row in runs
                    if str(row[0]) not in self._relay_terminal_runs
                ]
                if not candidates:
                    return []
                run_ids = [str(row[0]) for row in candidates]
                placeholders = ",".join("?" for _ in run_ids)
                waterlines = {
                    str(run_id): (int(sequence), int(rowid))
                    for run_id, sequence, rowid in journal.execute(
                        "SELECT run_id,MAX(sequence),MAX(rowid) FROM runtime_events "
                        f"WHERE run_id IN ({placeholders}) GROUP BY run_id",
                        run_ids,
                    )
                }
        except sqlite3.Error:
            return None
        pending = [
            (*row, *waterlines.get(str(row[0]), (0, 0)))
            for row in candidates
            if waterlines.get(str(row[0]), (0, 0))[0]
            > self._relay_event_cursors.get(str(row[0]), 0)
        ]
        pending.sort(key=lambda row: int(row[7]), reverse=True)
        return pending

    async def relay_events(self) -> list[dict[str, Any]]:
        """Poll authoritative Runtime events for HAI's bounded SSE replay buffer."""
        if not self._session_waterlines_available:
            self._bootstrap_existing_session_cursors()
        forwarded: list[dict[str, Any]] = []
        indexed_rows = await asyncio.to_thread(self._pending_run_event_rows)

        if indexed_rows is not None:
            if not indexed_rows:
                return []
            active_workspace_ids = {
                str(workspace["workspace_id"])
                for workspace in await self.published_workspaces()
                if workspace["lifecycle"] == "active"
            }
            for row in [
                candidate for candidate in indexed_rows
                if str(candidate[2]) in active_workspace_ids
            ][:16]:
                run_id = str(row[0])
                after = self._relay_event_cursors.get(run_id, 0)
                if self.journal_database.is_file():
                    try:
                        event_items = await asyncio.to_thread(
                            self._read_local_run_events, run_id, after
                        )
                    except sqlite3.Error:
                        events = await self.transport.request(
                            "GET",
                            f"/v1/runs/{quote(run_id, safe='')}/events"
                            f"?after_sequence={after}&limit=2000",
                        )
                        event_items = list(events.get("data", []))
                else:
                    events = await self.transport.request(
                        "GET",
                        f"/v1/runs/{quote(run_id, safe='')}/events"
                        f"?after_sequence={after}&limit=2000",
                    )
                    event_items = list(events.get("data", []))
                item = {
                    "run_id": run_id,
                    "session_id": str(row[1]),
                    "workspace_id": str(row[2]),
                    "backend_id": str(row[3]),
                    "status": str(row[4]),
                    "created_at": str(row[5]),
                }
                projected = [
                    self._event_projection(event, self._run_binding_optional(run_id, item), run_id)
                    for event in event_items
                ]
                if projected:
                    terminal = (
                        item["status"] in {"completed", "failed", "cancelled"}
                        and len(projected) < 2000
                    )
                    self._store_run_event_cursor(
                        run_id, int(projected[-1]["sequence"]), terminal=terminal,
                    )
                    forwarded.extend(projected)
            return forwarded

        # Compatibility fallback for transports without the local Runtime DB.
        published = await self.published_workspaces()
        active_workspace_ids = {
            str(workspace["workspace_id"])
            for workspace in published
            if workspace["lifecycle"] == "active"
        }
        # The Runtime event table is the authoritative change index. Forward
        # newly appended events before walking historical Workspace catalogs;
        # otherwise a short controlled Run can finish before its SSE replay
        # buffer is populated.
        if active_workspace_ids:
            try:
                placeholders = ",".join("?" for _ in active_workspace_ids)
                with sqlite3.connect(self.journal_database, timeout=5) as journal:
                    changed_runs = list(
                        journal.execute(
                            "SELECT r.run_id,r.session_id,r.workspace_id,r.backend_id,"
                            "r.status,r.created_at,MAX(e.sequence) AS latest_sequence,"
                            "MAX(e.rowid) AS latest_rowid "
                            "FROM runtime_runs r JOIN runtime_events e ON e.run_id=r.run_id "
                            f"WHERE r.workspace_id IN ({placeholders}) "
                            "GROUP BY r.run_id ORDER BY latest_rowid DESC LIMIT 16",
                            tuple(active_workspace_ids),
                        )
                    )
            except sqlite3.Error:
                changed_runs = []
            for row in changed_runs:
                run_id = str(row[0])
                latest_sequence = int(row[6])
                after = self._relay_event_cursors.get(run_id, 0)
                if run_id in self._relay_terminal_runs or latest_sequence <= after:
                    continue
                events = await self.transport.request(
                    "GET",
                    f"/v1/runs/{quote(run_id, safe='')}/events"
                    f"?after_sequence={after}&limit=2000",
                )
                item = {
                    "run_id": run_id,
                    "session_id": str(row[1]),
                    "workspace_id": str(row[2]),
                    "backend_id": str(row[3]),
                    "status": str(row[4]),
                    "created_at": str(row[5]),
                }
                binding = self._run_binding_optional(run_id, item)
                projected = [
                    self._event_projection(event, binding, run_id)
                    for event in events.get("data", [])
                ]
                if projected:
                    self._relay_event_cursors[run_id] = int(projected[-1]["sequence"])
                    forwarded.extend(projected)
                if (
                    item["status"] in {"completed", "failed", "cancelled"}
                    and len(projected) < 2000
                ):
                    self._relay_terminal_runs.add(run_id)
            if forwarded:
                return forwarded

        for workspace in published:
            if workspace["lifecycle"] != "active":
                continue
            workspace_id = str(workspace["workspace_id"])
            sessions = await self.transport.request(
                "GET",
                f"/v1/sessions?workspace_id={quote(workspace_id, safe='')}&offset=0&limit=200",
            )
            for session in sessions.get("data", []):
                session_id = str(session["session_id"])
                runs = await self.transport.request(
                    "GET",
                    f"/v1/sessions/{quote(session_id, safe='')}/runs?offset=0&limit=200",
                )
                for run in runs.get("data", []):
                    run_id = str(run["run_id"])
                    if run_id in self._relay_terminal_runs:
                        continue
                    after = self._relay_event_cursors.get(run_id, 0)
                    events = await self.transport.request(
                        "GET",
                        f"/v1/runs/{quote(run_id, safe='')}/events?after_sequence={after}&limit=2000",
                    )
                    binding = self._run_binding_optional(run_id, run)
                    projected = [
                        self._event_projection(item, binding, run_id)
                        for item in events.get("data", [])
                    ]
                    if projected:
                        self._relay_event_cursors[run_id] = int(projected[-1]["sequence"])
                        forwarded.extend(projected)
                    if (
                        str(run.get("status")) in {"completed", "failed", "cancelled"}
                        and len(projected) < 2000
                    ):
                        self._relay_terminal_runs.add(run_id)
        return forwarded

    async def relay_session_events(self) -> list[dict[str, Any]]:
        """Poll authoritative Session Journal events for Relay fan-out/replay."""
        if not self._session_waterlines_available:
            self._bootstrap_existing_session_cursors()
        forwarded: list[dict[str, Any]] = []
        # Keep loopback polling parallel enough to avoid serial startup scans,
        # but bounded below the Gateway's shared DB/HTTP capacity.  A burst of
        # one request per historical Session can otherwise monopolize the
        # co-hosted server and delay interactive/mobile traffic.
        concurrency = asyncio.Semaphore(4)
        pending_session_ids = await asyncio.to_thread(
            self._sessions_with_pending_journal_events
        )
        if not pending_session_ids and self._session_waterlines_available:
            return []

        async def poll_session(session: dict[str, Any]) -> list[dict[str, Any]]:
            session_id = str(session["session_id"])
            async with concurrency:
                if session_id not in self._relay_session_event_cursors:
                    if self._session_waterlines_available:
                        self._store_session_event_cursor(session_id, 0)
                    else:
                        await self._ensure_session_event_cursor(session_id)
                        return []
                after = self._relay_session_event_cursors[session_id]
                try:
                    if self.journal_database.is_file():
                        try:
                            events = await asyncio.to_thread(
                                self._read_local_session_events, session_id, after
                            )
                            page = {"data": events}
                        except sqlite3.Error:
                            page = await self.transport.request(
                                "GET",
                                f"/v1/sessions/{quote(session_id, safe='')}/events"
                                f"?after_sequence={after}&limit=2000",
                            )
                    else:
                        page = await self.transport.request(
                            "GET",
                            f"/v1/sessions/{quote(session_id, safe='')}/events"
                            f"?after_sequence={after}&limit=2000",
                        )
                except GatewayControlError as exc:
                    if exc.code != "cursor_expired":
                        raise
                    if self.journal_database.is_file():
                        snapshot_sequence = await asyncio.to_thread(
                            self._latest_local_session_sequence, session_id
                        )
                    else:
                        snapshot = await self.transport.request(
                            "GET",
                            f"/v1/sessions/{quote(session_id, safe='')}/conversation-snapshot",
                        )
                        snapshot_sequence = int(snapshot["snapshot_sequence"])
                    self._store_session_event_cursor(
                        session_id, snapshot_sequence
                    )
                    return []
                events = page.get("data", [])
                if events:
                    self._store_session_event_cursor(
                        session_id, int(events[-1]["session_sequence"])
                    )
                return events

        published = await self.published_workspaces()
        active_workspace_ids = {
            str(workspace["workspace_id"])
            for workspace in published
            if workspace["lifecycle"] == "active"
        }
        if self._session_waterlines_available:
            pending_session_ids = await asyncio.to_thread(
                self._retire_unpublished_session_cursors,
                pending_session_ids,
                active_workspace_ids,
                oaep=False,
            )
            if not pending_session_ids:
                return []
        # Changed Sessions are the latency-sensitive path. The Runtime DB
        # already binds each Session to a Workspace, so avoid waiting for every
        # Workspace catalog and cold-session scan before forwarding a newly
        # committed Journal event.
        if pending_session_ids and active_workspace_ids:
            eligible = await asyncio.to_thread(
                self._eligible_journal_sessions,
                pending_session_ids,
                active_workspace_ids,
            )
            if eligible is not None:
                if eligible:
                    pages = await asyncio.gather(
                        *(poll_session(session) for session in eligible)
                    )
                    for events in pages:
                        forwarded.extend(events)
                return forwarded

        for workspace in published:
            if workspace["lifecycle"] != "active":
                continue
            workspace_id = str(workspace["workspace_id"])
            sessions = await self.transport.request(
                "GET",
                f"/v1/sessions?workspace_id={quote(workspace_id, safe='')}&offset=0&limit=200",
            )
            session_items = list(sessions.get("data", []))
            unknown = [
                session
                for session in session_items
                if str(session["session_id"]) not in self._relay_session_event_cursors
            ]
            sessions_by_id = {
                str(session["session_id"]): session for session in session_items
            }
            changed = [
                sessions_by_id[session_id]
                for session_id in pending_session_ids
                if session_id in sessions_by_id
            ][:4]
            hot = session_items[:4]
            cold = session_items[4:]
            cold_offset = self._relay_session_scan_offsets.get(workspace_id, 0)
            rotating = (
                [
                    cold[(cold_offset + index) % len(cold)]
                    for index in range(min(4, len(cold)))
                ]
                if cold
                else []
            )
            if cold:
                self._relay_session_scan_offsets[workspace_id] = (
                    cold_offset + len(rotating)
                ) % len(cold)
            selected: list[dict[str, Any]] = []
            selected_ids: set[str] = set()
            for session in [*changed, *hot, *rotating, *unknown]:
                session_id = str(session["session_id"])
                if session_id not in selected_ids:
                    selected.append(session)
                    selected_ids.add(session_id)
            pages = await asyncio.gather(
                *(poll_session(session) for session in selected)
            )
            for events in pages:
                forwarded.extend(events)
        return forwarded

    async def relay_oaep_events(self) -> list[dict[str, Any]]:
        """Poll canonical OAEP Events and return strict Runtime WSS envelopes.

        OAEP and V3 cursors are physically separate.  That keeps fallback
        clients operational while preventing a legacy payload from being
        relabelled as OAEP during rollout.
        """
        if not self._oaep_waterlines_available:
            self._bootstrap_existing_session_cursors()
        forwarded: list[dict[str, Any]] = []
        concurrency = asyncio.Semaphore(_OAEP_RELAY_SESSION_BUDGET)
        pending_session_ids = await asyncio.to_thread(
            self._sessions_with_pending_oaep_events
        )
        if pending_session_ids:
            await asyncio.to_thread(
                self._retire_reconstructed_oaep_cursors, pending_session_ids
            )
            pending_session_ids = await asyncio.to_thread(
                self._sessions_with_pending_oaep_events
            )
        if not pending_session_ids and self._oaep_waterlines_available:
            return []

        async def poll_session(session: dict[str, Any], workspace_id: str) -> list[dict[str, Any]]:
            session_id = str(session["session_id"])
            async with concurrency:
                if session_id not in self._relay_oaep_event_cursors:
                    if self._oaep_waterlines_available:
                        self._store_oaep_event_cursor(session_id, 0)
                    else:
                        await self._ensure_oaep_event_cursor(session_id)
                        return []
                after = self._relay_oaep_event_cursors[session_id]
                try:
                    if self.journal_database.is_file():
                        try:
                            events = await asyncio.to_thread(
                                self._read_local_oaep_events, session_id, after
                            )
                        except sqlite3.Error:
                            page = await self.transport.request(
                                "GET",
                                f"/v1/sessions/{quote(session_id, safe='')}/oaep-events"
                                f"?after_sequence={after}&limit={_OAEP_RELAY_BATCH_EVENTS}",
                            )
                            events = page.get("data", [])
                    else:
                        page = await self.transport.request(
                            "GET",
                            f"/v1/sessions/{quote(session_id, safe='')}/oaep-events"
                            f"?after_sequence={after}&limit={_OAEP_RELAY_BATCH_EVENTS}",
                        )
                        events = page.get("data", [])
                except GatewayControlError as exc:
                    if exc.code != "cursor_expired":
                        raise
                    if self.journal_database.is_file():
                        snapshot_sequence = await asyncio.to_thread(
                            self._latest_local_session_sequence, session_id
                        )
                    else:
                        snapshot = await self.transport.request(
                            "GET",
                            f"/v1/sessions/{quote(session_id, safe='')}/oaep-snapshot",
                        )
                        snapshot_sequence = int(snapshot["snapshot_sequence"])
                    self._store_oaep_event_cursor(
                        session_id, snapshot_sequence
                    )
                    return []
                return [
                    {
                        "runtime_id": self.runtime_id,
                        "workspace_id": workspace_id,
                        "session_id": session_id,
                        "sequence": int(event["sequence"]),
                        "event": self._bind_oaep_public_runtime_identity(event),
                    }
                    for event in events
                ]

        published = await self.published_workspaces()
        active = {
            str(workspace["workspace_id"]): workspace
            for workspace in published
            if workspace["lifecycle"] == "active"
        }
        if self._oaep_waterlines_available:
            pending_session_ids = await asyncio.to_thread(
                self._retire_unpublished_session_cursors,
                pending_session_ids,
                set(active),
                oaep=True,
            )
            if not pending_session_ids:
                return []
        # Pending canonical rows are the latency-sensitive path and are safe to
        # bind from the local Runtime DB before the rotating catalog scan.
        if pending_session_ids and active and self.journal_database.is_file():
            eligible = await asyncio.to_thread(
                self._eligible_oaep_sessions, pending_session_ids, set(active)
            )
            if eligible is not None:
                if eligible:
                    pages = await asyncio.gather(*(
                        poll_session(session, str(session["workspace_id"]))
                        for session in eligible
                    ))
                    for events in pages:
                        forwarded.extend(events)
                return self._bounded_oaep_frames(forwarded)

        for workspace_id in active:
            sessions = await self.transport.request(
                "GET",
                f"/v1/sessions?workspace_id={quote(workspace_id, safe='')}&offset=0&limit=200",
            )
            session_items = list(sessions.get("data", []))
            unknown = [
                session for session in session_items
                if str(session["session_id"]) not in self._relay_oaep_event_cursors
            ]
            sessions_by_id = {
                str(session["session_id"]): session for session in session_items
            }
            changed = [
                sessions_by_id[session_id]
                for session_id in pending_session_ids
                if session_id in sessions_by_id
            ][:4]
            hot = session_items[:4]
            cold = session_items[4:]
            offset_key = f"oaep:{workspace_id}"
            cold_offset = self._relay_session_scan_offsets.get(offset_key, 0)
            rotating = (
                [
                    cold[(cold_offset + index) % len(cold)]
                    for index in range(min(4, len(cold)))
                ]
                if cold else []
            )
            if cold:
                self._relay_session_scan_offsets[offset_key] = (
                    cold_offset + len(rotating)
                ) % len(cold)
            selected: list[dict[str, Any]] = []
            selected_ids: set[str] = set()
            for session in [*changed, *hot, *rotating, *unknown]:
                session_id = str(session["session_id"])
                if session_id not in selected_ids:
                    selected.append(session)
                    selected_ids.add(session_id)
            pages = await asyncio.gather(*(
                poll_session(session, workspace_id)
                for session in selected[:_OAEP_RELAY_SESSION_BUDGET]
            ))
            for events in pages:
                forwarded.extend(events)
        return self._bounded_oaep_frames(forwarded)

    async def create_session(self, subject: str, workspace_id: str, *, title: str, definition_id: str,
                             definition_version: str, idempotency_key: str) -> dict[str, Any]:
        existing = self._binding_by_idempotency("relay_sessions", subject, idempotency_key)
        if existing:
            return await self.get_session(workspace_id, str(existing["session_id"]))
        definition = self.definitions.load(f"{definition_id}@{definition_version}")
        capabilities = await self.transport.request("GET", "/v1/capabilities")
        if not capabilities.get("agent_backends", {}).get(definition.backend, {}).get("available"):
            raise GatewayControlError("backend_unavailable", "Selected Backend is not healthy", retryable=True)
        item = await self.transport.request(
            "POST",
            "/v1/sessions",
            body={
                "workspace_id": workspace_id,
                "title": title,
                "agent_definition": f"{definition_id}@{definition_version}",
                "backend_id": definition.backend,
            },
        )
        with self._connect() as db:
            db.execute("INSERT INTO relay_sessions VALUES(?,?,?,?,?,?,?)", (
                item["session_id"], subject, workspace_id, definition_id, definition_version,
                definition.backend, idempotency_key,
            ))
        await self._ensure_session_event_cursor(str(item["session_id"]))
        return self._session(item, self._binding(str(item["session_id"])))

    async def get_session(self, workspace_id: str, session_id: str) -> dict[str, Any]:
        item = await self.transport.request("GET", f"/v1/sessions/{session_id}")
        if str(item["workspace_id"]) != workspace_id:
            raise GatewayControlError("session_not_found", "Session was not found in this Workspace")
        return self._session(item, self._binding_optional(session_id))

    async def authorize_session(self, subject: str, workspace_id: str, session_id: str) -> None:
        item = await self.transport.request("GET", f"/v1/sessions/{session_id}")
        if str(item["workspace_id"]) != workspace_id or bool(item.get("archived")):
            raise GatewayControlError("session_forbidden", "Session is not authorized")

    async def update_session(self, subject: str, workspace_id: str, session_id: str, *,
                             title: str | None = None, lifecycle: Any | None = None) -> dict[str, Any]:
        current = await self.get_session(workspace_id, session_id)
        wanted = getattr(lifecycle, "value", lifecycle)
        if wanted not in {None, "active", "archived"}:
            raise GatewayControlError("session_lifecycle_invalid", "Session lifecycle transition is invalid")
        body: dict[str, Any] = {}
        if title is not None:
            normalized = title.strip()
            if not normalized or len(normalized) > 200 or any(ch in normalized for ch in ("\x00", "\r", "\n")):
                raise GatewayControlError("session_title_invalid", "Session title is invalid")
            body["title"] = normalized
        if wanted is not None:
            body["lifecycle"] = wanted
        if not body:
            raise GatewayControlError("session_update_empty", "Session update requires title or lifecycle")
        updated = await self.transport.request("PATCH", f"/v1/sessions/{quote(session_id, safe='')}", body=body)
        if str(updated.get("workspace_id")) != workspace_id:
            raise GatewayControlError("session_not_found", "Session was not found in this Workspace")
        return self._session(updated, self._binding_optional(session_id))

    async def list_sessions_for_subject(self, subject: str, workspace_id: str, *, cursor: str | None = None,
                                        limit: int = 20, query: str | None = None, lifecycle: Any = "active"):
        # The Full Runtime Session store is authoritative. A Runtime association
        # grants visibility to its active Sessions, including Sessions created
        # earlier by Windows; relay_sessions is only creation/idempotency metadata.
        return await self.list_sessions(workspace_id, cursor=cursor, limit=limit, query=query, lifecycle=lifecycle)

    async def list_sessions(self, workspace_id: str, *, cursor: str | None = None, limit: int = 20,
                            query: str | None = None, lifecycle: Any = "active"):
        offset = max(0, int(cursor or 0))
        wanted = getattr(lifecycle, "value", lifecycle)
        archived = "true" if wanted == "archived" else "false"
        page = await self.transport.request("GET", f"/v1/sessions?workspace_id={workspace_id}&offset={offset}&limit={limit}&archived={archived}")
        mapped = []
        for item in page.get("data", []):
            if not query or query.casefold() in str(item.get("title", "")).casefold():
                mapped.append(self._session(item, self._binding_optional(str(item["session_id"]))))
        consumed = offset + len(page.get("data", []))
        return [mapped, str(consumed) if consumed < int(page.get("total", consumed)) else None]

    async def create_run(self, subject: str, workspace_id: str, session_id: str, *, message: str,
                         attachment_refs: list[str], idempotency_key: str, correlation_id: str,
                         retry_of: str | None = None, source_message_id: str | None = None,
                         _authorization: str | None = None) -> dict[str, Any]:
        # A retry is one logical command across Desktop and Mobile.  Deriving
        # its key from the failed Run prevents two clients racing to create two
        # replacement Runs even when they supplied different request ids.
        idempotency_key = f"retry:{retry_of}" if retry_of else idempotency_key
        existing = self._binding_by_idempotency("relay_runs", subject, idempotency_key)
        if existing:
            return await self.get_run(str(existing["run_id"]))
        session = await self.transport.request("GET", f"/v1/sessions/{session_id}")
        binding = await self._ensure_session_binding(subject, session)
        if binding.workspace_id != workspace_id:
            raise GatewayControlError("session_not_found", "Session was not found in this Workspace")
        reference = f"{binding.definition_id}@{binding.definition_version}"
        item = await self.transport.request("POST", f"/v1/sessions/{session_id}/runs",
                                            body={"agent_definition": reference},
                                            headers={"Idempotency-Key": idempotency_key})
        with self._connect() as db:
            db.execute(
                "INSERT INTO relay_runs("
                "run_id,subject,workspace_id,session_id,correlation_id,message,"
                "attachment_refs_json,retry_of,idempotency_key,source_message_id"
                ") VALUES(?,?,?,?,?,?,?,?,?,?)",
                (
                item["run_id"], subject, workspace_id, session_id, correlation_id, redact_secrets(message),
                json.dumps(attachment_refs), retry_of, idempotency_key,
                source_message_id or idempotency_key,
                ),
            )
        task = asyncio.create_task(self._execute_run(
            str(item["run_id"]), message, subject, correlation_id, _authorization))
        self._execution_tasks.add(task)
        task.add_done_callback(self._execution_tasks.discard)
        return await self.get_run(str(item["run_id"]))

    async def _execute_run(self, run_id: str, message: str, subject: str, correlation_id: str,
                           authorization: str | None) -> None:
        try:
            headers = {"X-Correlation-ID": correlation_id}
            if authorization and authorization.startswith("Bearer "):
                headers.update({"Authorization": authorization, "X-OpenDrSai-Auth-Mode": "oidc"})
            await self.transport.request("POST", f"/v1/runs/{run_id}/execute",
                                         body={
                                             "prompt": message,
                                             "user_id": subject,
                                             "metadata": {
                                                 "attachment_refs": self._run_binding(run_id)["attachment_refs"],
                                                 "source_client": "android",
                                                 "source_message_id": str(
                                                     self._run_binding(run_id)["source_message_id"]
                                                     or self._run_binding(run_id)["idempotency_key"]
                                                 ),
                                             },
                                         },
                                         headers=headers)
        except Exception as exc:
            # Keep a bounded diagnostic projection for health/acceptance. The
            # Full Runtime remains authoritative for the Run's durable status.
            self.execution_failures[run_id] = f"{type(exc).__name__}: {exc}"[:1000]
            if len(self.execution_failures) > 100:
                self.execution_failures.pop(next(iter(self.execution_failures)))
            return

    async def get_run(self, run_id: str) -> dict[str, Any]:
        item = await self.transport.request("GET", f"/v1/runs/{run_id}")
        return self._run(item, self._run_binding_optional(run_id, item))

    async def list_runs(self, workspace_id: str, session_id: str, *, cursor: str | None = None, limit: int = 20):
        # Runtime has an authoritative point lookup; Relay metadata indexes only IDs it created.
        offset = max(0, int(cursor or 0))
        with self._connect() as db:
            rows = db.execute("SELECT run_id FROM relay_runs WHERE workspace_id=? AND session_id=? ORDER BY rowid LIMIT ? OFFSET ?",
                              (workspace_id, session_id, limit + 1, offset)).fetchall()
        items = [await self.get_run(str(row["run_id"])) for row in rows[:limit]]
        return [items, str(offset + limit) if len(rows) > limit else None]

    async def list_runs_for_subject(self, subject: str, workspace_id: str, session_id: str, *,
                                    cursor: str | None = None, limit: int = 20):
        await self.authorize_session(subject, workspace_id, session_id)
        offset = max(0, int(cursor or 0))
        page = await self.transport.request(
            "GET", f"/v1/sessions/{session_id}/runs?offset={offset}&limit={limit}")
        rows = [self._run(item, self._run_binding_optional(str(item["run_id"]), item))
                for item in page.get("data", [])]
        consumed = offset + len(rows)
        return [rows, str(consumed) if consumed < int(page.get("total", consumed)) else None]

    async def authorize_run(self, subject: str, run_id: str) -> None:
        item = await self.transport.request("GET", f"/v1/runs/{run_id}")
        await self.authorize_session(subject, str(item["workspace_id"]), str(item["session_id"]))

    async def conversation_for_subject(
        self,
        subject: str,
        workspace_id: str,
        session_id: str,
        *,
        cursor: str | None = None,
        limit: int = 100,
    ):
        await self.authorize_session(subject, workspace_id, session_id)
        query = f"?limit={limit}"
        if cursor:
            query += f"&cursor={quote(cursor, safe='')}"
        page = await self.transport.request(
            "GET",
            f"/v1/sessions/{session_id}/conversation{query}",
        )
        items: list[dict[str, Any]] = []
        for raw in page.get("data", []):
            kind = str(raw["kind"])
            payload = dict(raw.get("payload", {}))
            if kind == "agent.message.delta":
                kind = "message.delta"
                payload["delta"] = str(payload.get("delta", payload.get("content", "")))
            elif kind == "tool.completed":
                kind = "tool.finished"
            items.append({
                "item_id": str(raw["item_id"]),
                "sequence": int(raw["sequence"]),
                "kind": kind,
                "timestamp": str(raw["timestamp"]),
                "payload": payload,
            })
        return [items, page.get("next_cursor")]

    async def conversation_snapshot_for_subject(
        self,
        subject: str,
        workspace_id: str,
        session_id: str,
        *,
        limit: int = 500,
    ) -> dict[str, Any]:
        await self.authorize_session(subject, workspace_id, session_id)
        return await self.transport.request(
            "GET",
            f"/v1/sessions/{quote(session_id, safe='')}/conversation-snapshot"
            f"?limit={max(1, min(2000, int(limit)))}",
        )

    async def session_events_for_subject(
        self,
        subject: str,
        workspace_id: str,
        session_id: str,
        *,
        after_sequence: int = 0,
        limit: int = 500,
    ) -> dict[str, Any]:
        await self.authorize_session(subject, workspace_id, session_id)
        return await self.transport.request(
            "GET",
            f"/v1/sessions/{quote(session_id, safe='')}/events"
            f"?after_sequence={max(0, int(after_sequence))}"
            f"&limit={max(1, min(2000, int(limit)))}",
        )

    async def oaep_snapshot_for_subject(
        self,
        subject: str,
        workspace_id: str,
        session_id: str,
        *,
        cursor: str | None = None,
        limit: int = 100,
    ) -> dict[str, Any]:
        await self.authorize_session(subject, workspace_id, session_id)
        query: list[str] = []
        bounded_limit = max(1, min(500, int(limit)))
        if bounded_limit != 100:
            query.append(f"limit={bounded_limit}")
        if cursor:
            query.append(f"cursor={quote(cursor, safe='')}")
        return await self.transport.request(
            "GET",
            f"/v1/sessions/{quote(session_id, safe='')}/oaep-snapshot"
            + (f"?{'&'.join(query)}" if query else ""),
        )

    async def oaep_events_for_subject(
        self,
        subject: str,
        workspace_id: str,
        session_id: str,
        *,
        after_sequence: int = 0,
        limit: int = 500,
    ) -> dict[str, Any]:
        await self.authorize_session(subject, workspace_id, session_id)
        return await self.transport.request(
            "GET",
            f"/v1/sessions/{quote(session_id, safe='')}/oaep-events"
            f"?after_sequence={max(0, int(after_sequence))}"
            f"&limit={max(1, min(2000, int(limit)))}",
        )

    async def idempotency_result(self, subject: str, operation: str, idempotency_key: str) -> dict[str, Any]:
        table = {"session.create": "relay_sessions", "run.create": "relay_runs"}.get(operation)
        if table is None:
            raise GatewayControlError("idempotency_operation_invalid", "Idempotency operation is invalid")
        row = self._binding_by_idempotency(table, subject, idempotency_key)
        if row is None:
            raise GatewayControlError("idempotency_result_not_found", "Idempotency result was not found")
        return await (self.get_run(str(row["run_id"])) if table == "relay_runs"
                      else self.get_session(str(row["workspace_id"]), str(row["session_id"])))

    async def list_events(self, run_id: str, *, after_sequence: int = 0, limit: int = 500):
        item = await self.transport.request("GET", f"/v1/runs/{run_id}")
        run = self._run_binding_optional(run_id, item)
        page = await self.transport.request("GET", f"/v1/runs/{run_id}/events?after_sequence={after_sequence}&limit={limit}")
        items = [self._event_projection(item, run, run_id) for item in page.get("data", [])]
        return [items, str(items[-1]["sequence"]) if len(items) == limit else None]

    def _event_projection(self, item: dict[str, Any], run: dict[str, Any], run_id: str) -> dict[str, Any]:
        kind = str(item["type"])
        payload = dict(item.get("data", {}))
        if kind == "agent.message.delta":
            kind = "message.delta"
            payload = {**payload, "delta": str(payload.get("delta", payload.get("content", "")))}
        elif kind == "tool.completed":
            kind = "tool.finished"
        return {
            "event_id": item["event_id"], "sequence": item["sequence"], "runtime_id": self.runtime_id,
            "workspace_id": run["workspace_id"], "session_id": run["session_id"], "run_id": run_id,
            "kind": kind, "timestamp": item["created_at"], "payload": payload,
        }

    async def cancel_run(self, workspace_id: str, run_id: str) -> dict[str, Any]:
        binding = self._run_binding(run_id)
        if binding["workspace_id"] != workspace_id:
            raise GatewayControlError("run_scope_mismatch", "Run belongs to another Workspace")
        await self.transport.request("POST", f"/v1/runs/{run_id}/cancel", body={})
        return await self.get_run(run_id)

    async def pending_approvals(self, workspace_id: str) -> list[dict[str, Any]]:
        page = await self.transport.request("GET", "/v1/approvals?status=pending")
        rows = page.get("data", page if isinstance(page, list) else [])
        return [self._approval(item) for item in rows
                if self._run_binding(str(item["run_id"]))["workspace_id"] == workspace_id]

    async def pending_approvals_for_subject(self, subject: str, workspace_id: str) -> list[dict[str, Any]]:
        return [item for item in await self.pending_approvals(workspace_id)
                if self._run_binding(item["run_id"])["subject"] == subject]

    async def decide_approval(
        self, subject: str, approval_id: str, decision: str, idempotency_key: str | None = None
    ) -> dict[str, Any]:
        mapped = {"approve": "approved", "deny": "denied", "cancel": "denied"}.get(decision)
        if mapped is None:
            raise GatewayControlError("approval_decision_invalid", "Invalid approval decision")
        stable_key = idempotency_key or f"legacy:{approval_id}:{decision}"
        async with self._approval_decision_lock:
            with self._connect() as db:
                prior = db.execute(
                    "SELECT * FROM relay_approval_decisions WHERE subject=? AND idempotency_key=?",
                    (subject, stable_key),
                ).fetchone()
            if prior is not None:
                if str(prior["approval_id"]) != approval_id or str(prior["decision"]) != decision:
                    raise GatewayControlError("idempotency_conflict", "Idempotency key was reused with another decision")
                return json.loads(str(prior["result_json"]))
            page = await self.transport.request("GET", "/v1/approvals?status=pending")
            candidates = page.get("data", page if isinstance(page, list) else [])
            candidate = next((item for item in candidates if str(item.get("approval_id")) == approval_id), None)
            if candidate is None:
                try:
                    candidate = await self.transport.request("GET", f"/v1/approvals/{approval_id}")
                except GatewayControlError as exc:
                    if exc.code == "runtime_http_404":
                        raise GatewayControlError("approval_not_found", "Approval is no longer pending") from exc
                    raise
            await self.authorize_run(subject, str(candidate["run_id"]))
            detail = {"subject": subject, "idempotency_key": stable_key}
            try:
                await self.transport.request(
                    "POST", f"/v1/runs/{candidate['run_id']}/approvals/{approval_id}/decision",
                    body={"decision": mapped, "detail": detail},
                )
            except GatewayControlError as exc:
                if exc.code not in {"approval_not_found", "approval_not_supported"}:
                    raise
                item = await self.transport.request(
                    "POST", f"/v1/approvals/{approval_id}/decision",
                    body={"decision": mapped, "detail": detail},
                )
            else:
                item = await self.transport.request("GET", f"/v1/approvals/{approval_id}")
            result = self._approval(item)
            with self._connect() as db:
                db.execute(
                    "INSERT INTO relay_approval_decisions VALUES(?,?,?,?,?)",
                    (subject, stable_key, approval_id, decision, json.dumps(result, separators=(",", ":"))),
                )
            return result

    async def audit_entries(self, workspace_id: str, run_id: str | None = None) -> list[dict[str, Any]]:
        run_ids = [run_id] if run_id else self._workspace_run_ids(workspace_id)
        entries = []
        for current in run_ids:
            events, _ = await self.list_events(current, limit=500)
            binding = self._run_binding(current)
            for event in events:
                if event["kind"] in {"run.created", "run.cancelled", "approval.requested", "approval.approved", "approval.denied"}:
                    entries.append({
                        "audit_id": f"audit:{event['event_id']}", "runtime_id": self.runtime_id,
                        "workspace_id": workspace_id, "session_id": binding["session_id"], "run_id": current,
                        "action": event["kind"], "actor_label": "已授权设备",
                        "timestamp": event["timestamp"],
                        "correlation_id": binding["correlation_id"],
                        "approval_id": event["payload"].get("approval_id"),
                    })
        return entries

    async def audit_entries_for_subject(self, subject: str, workspace_id: str,
                                        run_id: str | None = None) -> list[dict[str, Any]]:
        if run_id is not None:
            await self.authorize_run(subject, run_id)
        return [item for item in await self.audit_entries(workspace_id, run_id)
                if self._run_binding(item["run_id"])["subject"] == subject]

    async def execute_owop(self, workspace_id: str, operation: str, params: dict[str, Any]) -> dict[str, Any]:
        allowed = {"workspace.describe", "files.list", "files.stat", "files.read", "search.query",
                   "git.status", "git.diff", "git.file_at_ref", "artifact.metadata", "artifact.chunk"}
        if operation not in allowed:
            raise GatewayControlError("owop_operation_forbidden", "OWOP operation is not allowed on Android")
        request_id, correlation_id = str(uuid4()), str(uuid4())
        response = await self.transport.request("POST", "/v1/owop", body={
            "version": "1.0", "request_id": request_id, "correlation_id": correlation_id,
            "workspace_id": workspace_id, "operation": operation, "params": params,
            # Relay is the outer transport; once inside this Full Runtime the
            # authoritative Workspace adapter is the Runtime's local binding.
            "binding": {"kind": "in_process"},
        })
        if response.get("ok") is not True:
            error = response.get("error", {})
            raise GatewayControlError(str(error.get("code") or "owop_failed"), str(error.get("message") or "OWOP failed"))
        result = response.get("result", {})
        if operation == "files.list":
            if isinstance(result.get("items"), list):
                return result
            entries = result.get("entries", [])
            return {"items": [{
                "token": str(item.get("path", "")), "relative_path": str(item.get("path", "")),
                "type": str(item.get("kind", "file")), "size": item.get("size"), "modified_at": None,
                "git_status": None, "truncated": False,
            } for item in entries], "next_cursor": result.get("cursor"), "truncated": False,
                    "ignored_hint": ".git, .drsai, node_modules and __pycache__ are hidden"}
        if operation == "search.query":
            matches = result.get("matches", [])
            return {"items": [{"token": str(item.get("path", "")), "relative_path": str(item.get("path", "")),
                                "type": "file", "size": None, "modified_at": None, "git_status": None,
                                "truncated": False} for item in matches],
                    "next_cursor": result.get("cursor"), "truncated": False}
        return result

    def _binding(self, session_id: str) -> _SessionBinding:
        with self._connect() as db:
            row = db.execute("SELECT * FROM relay_sessions WHERE session_id=?", (session_id,)).fetchone()
        if row is None:
            raise GatewayControlError("session_not_found", "Session was not created through this Relay")
        return _SessionBinding(**dict(row))

    def _binding_optional(self, session_id: str) -> _SessionBinding | None:
        try:
            return self._binding(session_id)
        except GatewayControlError as exc:
            if exc.code != "session_not_found":
                raise
            return None

    async def _ensure_session_binding(self, subject: str, item: dict[str, Any]) -> _SessionBinding:
        session_id = str(item["session_id"])
        existing = self._binding_optional(session_id)
        if existing is not None:
            await self._ensure_session_event_cursor(session_id)
            return existing
        definitions = await self.list_agent_definitions()
        healthy = [row for row in definitions if row["backend_health"] == "healthy"]
        reference = str(item.get("agent_definition") or "")
        backend_id = str(item.get("backend_id") or "")
        selected = None
        if "@" in reference:
            definition_id, definition_version = reference.rsplit("@", 1)
            selected = next(
                (
                    row for row in healthy
                    if row["definition_id"] == definition_id
                    and row["version"] == definition_version
                    and (not backend_id or row["backend_id"] == backend_id)
                ),
                None,
            )
            if selected is None:
                raise GatewayControlError(
                    "session_agent_definition_unavailable",
                    "Session Agent Definition is unavailable or unhealthy",
                    retryable=True,
                )
        else:
            # Legacy Sessions created before authoritative Agent metadata can
            # migrate only when the choice is unambiguous. Prefer the
            # Runtime-owned backend binding when it exists; unrelated healthy
            # backends must not make an otherwise exact migration ambiguous.
            candidates = [
                row for row in healthy
                if not backend_id or row["backend_id"] == backend_id
            ]
            if len(candidates) == 1:
                selected = candidates[0]
            else:
                raise GatewayControlError(
                    "session_agent_definition_required",
                    "Existing Session has no unambiguous healthy Agent Definition",
                )
        binding = _SessionBinding(
            session_id=session_id,
            subject=subject,
            workspace_id=str(item["workspace_id"]),
            definition_id=str(selected["definition_id"]),
            definition_version=str(selected["version"]),
            backend_id=str(selected["backend_id"]),
            idempotency_key=f"discovered:{session_id}",
        )
        with self._connect() as db:
            db.execute(
                "INSERT OR IGNORE INTO relay_sessions VALUES(?,?,?,?,?,?,?)",
                (
                    binding.session_id, binding.subject, binding.workspace_id,
                    binding.definition_id, binding.definition_version,
                    binding.backend_id, binding.idempotency_key,
                ),
            )
        await self._ensure_session_event_cursor(session_id)
        return self._binding(session_id)

    def _run_binding(self, run_id: str) -> dict[str, Any]:
        with self._connect() as db:
            row = db.execute("SELECT * FROM relay_runs WHERE run_id=?", (run_id,)).fetchone()
        if row is None:
            raise GatewayControlError("run_not_found", "Run was not created through this Relay")
        result = dict(row)
        result["attachment_refs"] = json.loads(result.pop("attachment_refs_json"))
        return result

    def _run_binding_optional(self, run_id: str, item: dict[str, Any]) -> dict[str, Any]:
        try:
            return self._run_binding(run_id)
        except GatewayControlError as exc:
            if exc.code != "run_not_found":
                raise
            return {
                "run_id": run_id,
                "subject": "runtime",
                "workspace_id": str(item["workspace_id"]),
                "session_id": str(item["session_id"]),
                "correlation_id": str(item.get("correlation_id") or f"runtime:{run_id}"),
                "message": str(item.get("input_message") or ""),
                "attachment_refs": (
                    json.loads(str(item.get("attachment_refs_json") or "[]"))
                    if not isinstance(item.get("attachment_refs"), list)
                    else item["attachment_refs"]
                ),
                "retry_of": None,
                "idempotency_key": str(item.get("idempotency_key") or f"runtime:{run_id}"),
            }

    def _binding_by_idempotency(self, table: str, subject: str, key: str):
        with self._connect() as db:
            return db.execute(f"SELECT * FROM {table} WHERE subject=? AND idempotency_key=?", (subject, key)).fetchone()

    def _workspace_run_ids(self, workspace_id: str) -> list[str]:
        with self._connect() as db:
            return [str(row[0]) for row in db.execute("SELECT run_id FROM relay_runs WHERE workspace_id=?", (workspace_id,))]

    def _session(self, item: dict[str, Any], binding: _SessionBinding | None) -> dict[str, Any]:
        reference = str(item.get("agent_definition") or "")
        definition_id, definition_version = ("", "")
        if "@" in reference:
            definition_id, definition_version = reference.rsplit("@", 1)
        return {"runtime_id": self.runtime_id, "workspace_id": str(item["workspace_id"]),
                "session_id": str(item["session_id"]), "title": item["title"],
                "agent_definition_id": binding.definition_id if binding else definition_id,
                "agent_definition_version": binding.definition_version if binding else definition_version,
                "backend_id": binding.backend_id if binding else str(item.get("backend_id") or ""),
                "updated_at": item["updated_at"],
                "lifecycle": str(item.get("lifecycle") or ("archived" if item.get("archived") else "active")),
                "last_run_status": None}

    def _run(self, item: dict[str, Any], binding: dict[str, Any]) -> dict[str, Any]:
        return {"runtime_id": self.runtime_id, "workspace_id": binding["workspace_id"],
                "session_id": binding["session_id"], "run_id": item["run_id"], "backend_id": item["backend_id"],
                "status": item["status"], "correlation_id": binding["correlation_id"],
                "created_at": item["created_at"], "retry_of": binding["retry_of"], "message": binding["message"],
                "attachment_refs": binding["attachment_refs"]}

    def _approval(self, item: dict[str, Any]) -> dict[str, Any]:
        run = self._run_binding(str(item["run_id"]))
        request = item.get("request", {})
        binding = self._binding(str(run["session_id"]))
        return {"runtime_id": self.runtime_id, "workspace_id": run["workspace_id"],
                "session_id": run["session_id"], "run_id": item["run_id"], "approval_id": item["approval_id"],
                "agent_definition_id": binding.definition_id, "backend_id": binding.backend_id,
                "operation": str(request.get("operation") or request.get("tool") or "runtime.operation"),
                "risk_summary": str(request.get("risk_summary") or request.get("reason") or "Review required"),
                "scope": str(request.get("scope") or "workspace"), "expires_at": item.get("deadline_at") or "",
                "correlation_id": run["correlation_id"], "status": item["status"]}
