"""Content-free mobile notification intents derived from accepted OAEP events."""

from __future__ import annotations

from collections import deque
from copy import deepcopy
from dataclasses import dataclass
import json
import sqlite3
import threading
import time
from pathlib import Path
from typing import Protocol
from typing import Any

from drsai.sqlite_connection import ClosingConnection


_KINDS = {
    "event.run.completed": "run_completed",
    "event.run.failed": "run_failed",
    "event.run.cancelled": "run_cancelled",
    "event.run.waiting": "approval_required",
}


@dataclass(frozen=True)
class OpaqueNotificationIntent:
    event_id: str
    payload: dict[str, str]


def notification_intent(
    runtime_id: str,
    workspace_id: str,
    session_id: str,
    event: dict[str, Any],
) -> OpaqueNotificationIntent | None:
    kind = _KINDS.get(str(event.get("type") or ""))
    if kind is None:
        return None
    event_id = str(event.get("event_id") or "")
    if not all((runtime_id, workspace_id, session_id, event_id)):
        raise ValueError("notification_identity_required")
    payload = {
        "version": "1",
        "kind": kind,
        "runtime_id": runtime_id,
        "workspace_id": workspace_id,
        "session_id": session_id,
        "event_id": event_id,
    }
    item_id = event.get("item_id")
    if isinstance(item_id, str) and item_id:
        payload["item_id"] = item_id
    return OpaqueNotificationIntent(event_id, payload)


class NotificationOutbox:
    """Bounded adapter boundary consumed by the HepAI push provider.

    The Relay never places message, command, reasoning, path or approval body
    content in this outbox.  Production delivery maps the Runtime to active
    device associations and forwards this exact opaque payload.
    """

    def __init__(self, capacity: int = 10_000) -> None:
        if capacity < 1:
            raise ValueError("notification_capacity_invalid")
        self._items: deque[OpaqueNotificationIntent] = deque(maxlen=capacity)
        self._seen: set[str] = set()

    def accept(self, runtime_id: str, workspace_id: str, session_id: str,
               event: dict[str, Any]) -> None:
        intent = notification_intent(runtime_id, workspace_id, session_id, event)
        if intent is None or intent.event_id in self._seen:
            return
        if len(self._items) == self._items.maxlen:
            evicted = self._items[0]
            self._seen.discard(evicted.event_id)
        self._items.append(intent)
        self._seen.add(intent.event_id)

    def snapshot(self) -> list[dict[str, str]]:
        return [deepcopy(item.payload) for item in self._items]


class OpaquePushProvider(Protocol):
    def send(self, device_id: str, payload: dict[str, str]) -> None: ...


class PushDeliveryError(RuntimeError):
    """Provider failure classified without retaining its response body."""

    def __init__(self, code: str, *, retryable: bool) -> None:
        if not code or len(code) > 64 or not all(ch.islower() or ch.isdigit() or ch == "_" for ch in code):
            raise ValueError("push_delivery_error_code_invalid")
        super().__init__(code)
        self.code = code
        self.retryable = retryable


class NotificationDeliveryQueue:
    """Durable per-device delivery state; device_id is opaque, never a token."""

    def __init__(self, path: Path, *, max_attempts: int = 8) -> None:
        if max_attempts < 1:
            raise ValueError("notification_attempts_invalid")
        self.path, self.max_attempts, self._lock = path, max_attempts, threading.RLock()
        path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as db:
            db.execute("""CREATE TABLE IF NOT EXISTS notification_delivery (
                delivery_id TEXT PRIMARY KEY, event_id TEXT NOT NULL, device_id TEXT NOT NULL,
                payload TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
                next_attempt_at REAL NOT NULL DEFAULT 0, lease_until REAL,
                UNIQUE(event_id, device_id)
            )""")

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self.path, timeout=5, factory=ClosingConnection)

    @staticmethod
    def _safe_device_id(value: str) -> str:
        if not value or len(value) > 128 or any(ch not in "-_:.0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ" for ch in value):
            raise ValueError("notification_device_id_invalid")
        return value

    def enqueue(self, intent: OpaqueNotificationIntent, device_ids: list[str]) -> int:
        encoded = json.dumps(intent.payload, sort_keys=True, separators=(",", ":"))
        inserted = 0
        with self._lock, self._connect() as db:
            for device_id in sorted(set(device_ids)):
                safe = self._safe_device_id(device_id)
                delivery_id = f"{intent.event_id}:{safe}"
                cursor = db.execute("""INSERT OR IGNORE INTO notification_delivery
                    (delivery_id,event_id,device_id,payload,status) VALUES(?,?,?,?, 'pending')""",
                    (delivery_id, intent.event_id, safe, encoded))
                inserted += cursor.rowcount
        return inserted

    def claim(self, *, now: float | None = None, lease_seconds: float = 30, limit: int = 100) -> list[dict[str, Any]]:
        instant = time.time() if now is None else now
        if lease_seconds <= 0 or not 1 <= limit <= 500:
            raise ValueError("notification_claim_invalid")
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            rows = db.execute("""SELECT delivery_id,event_id,device_id,payload,attempts
                FROM notification_delivery WHERE status IN ('pending','retry','sending')
                AND next_attempt_at <= ? AND (status != 'sending' OR lease_until <= ?)
                ORDER BY delivery_id LIMIT ?""", (instant, instant, limit)).fetchall()
            for row in rows:
                db.execute("UPDATE notification_delivery SET status='sending',lease_until=? WHERE delivery_id=?",
                           (instant + lease_seconds, row[0]))
            db.commit()
        return [{"delivery_id": row[0], "event_id": row[1], "device_id": row[2],
                 "payload": json.loads(row[3]), "attempts": row[4]} for row in rows]

    def settle(self, delivery_id: str, *, delivered: bool, permanent: bool = False,
               now: float | None = None) -> None:
        instant = time.time() if now is None else now
        with self._lock, self._connect() as db:
            row = db.execute("SELECT attempts,status FROM notification_delivery WHERE delivery_id=?", (delivery_id,)).fetchone()
            if row is None or row[1] != "sending":
                raise ValueError("notification_delivery_not_claimed")
            attempts = int(row[0]) + 1
            if delivered:
                db.execute("UPDATE notification_delivery SET status='delivered',attempts=?,lease_until=NULL WHERE delivery_id=?",
                           (attempts, delivery_id))
            elif permanent or attempts >= self.max_attempts:
                db.execute("UPDATE notification_delivery SET status='dead',attempts=?,lease_until=NULL WHERE delivery_id=?",
                           (attempts, delivery_id))
            else:
                delay = min(300.0, float(2 ** min(attempts, 8)))
                db.execute("""UPDATE notification_delivery SET status='retry',attempts=?,next_attempt_at=?,lease_until=NULL
                    WHERE delivery_id=?""", (attempts, instant + delay, delivery_id))

    def dispatch_once(self, provider: OpaquePushProvider, *, now: float | None = None) -> dict[str, int]:
        rows = self.claim(now=now)
        result = {"claimed": len(rows), "delivered": 0, "retrying": 0, "dead": 0}
        for row in rows:
            try:
                provider.send(row["device_id"], deepcopy(row["payload"]))
            except PushDeliveryError as failure:
                self.settle(row["delivery_id"], delivered=False,
                            permanent=not failure.retryable, now=now)
                result["retrying" if failure.retryable else "dead"] += 1
            except Exception:
                # Unknown transport failures are treated as transient, but the
                # bounded max_attempts policy still prevents a busy loop.
                self.settle(row["delivery_id"], delivered=False, now=now)
                result["retrying"] += 1
            else:
                self.settle(row["delivery_id"], delivered=True, now=now)
                result["delivered"] += 1
        return result

    def status_counts(self) -> dict[str, int]:
        with self._lock, self._connect() as db:
            rows = db.execute("SELECT status,COUNT(*) FROM notification_delivery GROUP BY status").fetchall()
        return {str(status): int(count) for status, count in rows}


class NotificationFanoutSink:
    """Maps an accepted OAEP terminal event to active opaque device IDs."""

    def __init__(self, queue: NotificationDeliveryQueue, device_resolver) -> None:
        self.queue, self.device_resolver = queue, device_resolver

    def accept(self, runtime_id: str, workspace_id: str, session_id: str, event: dict[str, Any]) -> None:
        intent = notification_intent(runtime_id, workspace_id, session_id, event)
        if intent is not None:
            self.queue.enqueue(intent, list(self.device_resolver(runtime_id)))
