"""Durable, privacy-bounded intake and triage for Desktop user feedback.

The intake path deliberately does not depend on a model or mail provider. A
report is committed first and receives a stable id; triage and notifications
are durable follow-up jobs that may be retried independently.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import sqlite3
import threading
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Literal

from cryptography.fernet import Fernet, InvalidToken
from fastapi import APIRouter, Header, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator

from drsai.configs.constant import FS_DIR

FeedbackCategory = Literal["bug", "usability", "suggestion", "feature_request"]
FeedbackSource = Literal["global", "error", "message", "tool", "crash", "recovery"]
FeedbackStatus = Literal[
    "received", "triaged", "investigating", "needs_info", "planned", "fixed", "closed"
]

MAX_DESCRIPTION = 8_000
MAX_SUMMARY = 1_000
MAX_DIAGNOSTICS_BYTES = 1_000_000
MAX_SCREENSHOT_BYTES = 5_000_000
MAX_CRASH_DUMP_BYTES = 10_000_000
MAX_BREADCRUMBS = 100
SECRET_KEY = re.compile(
    r"token|secret|password|cookie|authorization|api.?key|credential|private.?key",
    re.IGNORECASE,
)
SECRET_VALUE = re.compile(
    r"\bBearer\s+[^\s\"']+|(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{8,}|"
    r"https?://[^\s/@:]+:[^\s/@]+@|"
    r"\b(?:token|secret|password|api[_-]?key)\s*[=:]\s*[^\s,;]+",
    re.IGNORECASE,
)
ABSOLUTE_PATH = re.compile(r"(?:[A-Za-z]:\\Users\\[^\\\s]+|/Users/[^/\s]+|/home/[^/\s]+)")
EMAIL = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)
IP_ADDRESS = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")


class FeedbackContextModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    module: str = Field(default="unknown", max_length=120)
    page: str = Field(default="unknown", max_length=120)
    app_version: str = Field(default="unknown", max_length=80)
    runtime_version: str = Field(default="unknown", max_length=80)
    electron_version: str = Field(default="unknown", max_length=80)
    platform: str = Field(default="unknown", max_length=40)
    locale: str = Field(default="unknown", max_length=30)
    workspace_id: str | None = Field(default=None, max_length=160)
    thread_id: str | None = Field(default=None, max_length=160)
    run_id: str | None = Field(default=None, max_length=160)
    trace_id: str | None = Field(default=None, max_length=160)
    error_code: str | None = Field(default=None, max_length=240)
    error_type: str | None = Field(default=None, max_length=240)
    breadcrumbs: list[dict[str, Any]] = Field(default_factory=list, max_length=MAX_BREADCRUMBS)


class FeedbackConsentModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    diagnostics: bool = True
    screenshot: bool = False
    conversation_context: bool = False
    detailed_logs: bool = False
    contact: bool = False


class FeedbackSubmitModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    client_feedback_id: str = Field(min_length=8, max_length=160, pattern=r"^[A-Za-z0-9_.:-]+$")
    category: FeedbackCategory
    source: FeedbackSource
    user_description: str = Field(default="", max_length=MAX_DESCRIPTION)
    contact_address: str | None = Field(default=None, max_length=320)
    context: FeedbackContextModel = Field(default_factory=FeedbackContextModel)
    consent: FeedbackConsentModel = Field(default_factory=FeedbackConsentModel)
    diagnostics: dict[str, Any] | None = None
    screenshot_data_url: str | None = Field(default=None, max_length=7_000_000)
    crash_dump_base64: str | None = Field(default=None, max_length=14_000_000)
    crash_dump_name: str | None = Field(default=None, max_length=200)
    attachment_manifest: list[dict[str, Any]] = Field(default_factory=list, max_length=20)

    @field_validator("user_description")
    @classmethod
    def require_description_for_ideas(cls, value: str, info) -> str:
        category = info.data.get("category")
        value = value.strip()
        if category in {"suggestion", "feature_request"} and not value:
            raise ValueError("A short description is required for suggestions and feature requests.")
        return value

    @field_validator("contact_address")
    @classmethod
    def normalize_contact(cls, value: str | None) -> str | None:
        return value.strip() if value and value.strip() else None


class FeedbackStatusUpdateModel(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: FeedbackStatus
    fixed_in_version: str | None = Field(default=None, max_length=80)
    note: str = Field(default="", max_length=2_000)
    recommended_owner: str | None = Field(default=None, max_length=160)


@dataclass(frozen=True)
class RedactedValue:
    value: Any
    removed: int


class FeedbackStore:
    """SQLite metadata store plus encrypted diagnostic object storage."""

    def __init__(self, root: Path):
        self.root = root
        self.database = root / "feedback.sqlite3"
        self.attachments = root / "attachments"
        self.key_path = root / "feedback.key"
        self._lock = threading.RLock()
        self.root.mkdir(parents=True, exist_ok=True)
        self.attachments.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA foreign_keys=ON")
        return connection

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS feedback (
                  feedback_id TEXT PRIMARY KEY,
                  client_feedback_id TEXT NOT NULL UNIQUE,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL,
                  category TEXT NOT NULL,
                  source TEXT NOT NULL,
                  user_description TEXT NOT NULL,
                  contact_allowed INTEGER NOT NULL,
                  contact_address TEXT,
                  context_json TEXT NOT NULL,
                  consent_json TEXT NOT NULL,
                  diagnostic_object_id TEXT,
                  diagnostic_sha256 TEXT,
                  diagnostic_bytes INTEGER NOT NULL DEFAULT 0,
                  sensitive_matches_removed INTEGER NOT NULL DEFAULT 0,
                  error_fingerprint TEXT,
                  status TEXT NOT NULL,
                  duplicate_of TEXT,
                  fixed_in_version TEXT,
                  triage_json TEXT,
                  FOREIGN KEY(duplicate_of) REFERENCES feedback(feedback_id)
                );
                CREATE TABLE IF NOT EXISTS feedback_events (
                  event_id TEXT PRIMARY KEY,
                  feedback_id TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  actor TEXT NOT NULL,
                  action TEXT NOT NULL,
                  detail TEXT NOT NULL,
                  FOREIGN KEY(feedback_id) REFERENCES feedback(feedback_id)
                );
                CREATE TABLE IF NOT EXISTS feedback_jobs (
                  job_id TEXT PRIMARY KEY,
                  feedback_id TEXT NOT NULL,
                  kind TEXT NOT NULL,
                  state TEXT NOT NULL,
                  attempts INTEGER NOT NULL DEFAULT 0,
                  available_at REAL NOT NULL,
                  last_error TEXT,
                  UNIQUE(feedback_id, kind),
                  FOREIGN KEY(feedback_id) REFERENCES feedback(feedback_id)
                );
                CREATE TABLE IF NOT EXISTS feedback_attachments (
                  attachment_id TEXT PRIMARY KEY,
                  feedback_id TEXT NOT NULL,
                  kind TEXT NOT NULL,
                  object_id TEXT NOT NULL,
                  byte_length INTEGER NOT NULL,
                  sha256 TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  UNIQUE(feedback_id, kind),
                  FOREIGN KEY(feedback_id) REFERENCES feedback(feedback_id)
                );
                CREATE TABLE IF NOT EXISTS feedback_audit (
                  audit_id TEXT PRIMARY KEY,
                  feedback_id TEXT,
                  created_at TEXT NOT NULL,
                  actor TEXT NOT NULL,
                  action TEXT NOT NULL,
                  result TEXT NOT NULL,
                  detail TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS feedback_fingerprint_idx
                  ON feedback(error_fingerprint, created_at);
                CREATE INDEX IF NOT EXISTS feedback_jobs_ready_idx
                  ON feedback_jobs(state, available_at);
                """
            )

    def submit(self, report: FeedbackSubmitModel) -> tuple[dict[str, Any], bool]:
        redacted_description = redact(report.user_description)
        redacted_context = redact(report.context.model_dump(mode="json"))
        removed = redacted_description.removed + redacted_context.removed
        diagnostics: RedactedValue | None = None
        if report.consent.diagnostics and report.diagnostics is not None:
            raw_diagnostics = canonical_json(report.diagnostics).encode("utf-8")
            if len(raw_diagnostics) > MAX_DIAGNOSTICS_BYTES:
                raise FeedbackError("diagnostics_too_large", "Diagnostic data exceeds the 1 MB limit.")
            diagnostics = redact(report.diagnostics)
            removed += diagnostics.removed
            encoded = canonical_json(diagnostics.value).encode("utf-8")
            if len(encoded) > MAX_DIAGNOSTICS_BYTES:
                raise FeedbackError("diagnostics_too_large", "Diagnostic data exceeds the 1 MB limit.")
        screenshot = decode_screenshot(report.screenshot_data_url, report.consent.screenshot)
        crash_dump = decode_crash_dump(report.crash_dump_base64, report.source == "recovery" and report.consent.diagnostics)
        now = utc_now()
        feedback_id = new_feedback_id()
        fingerprint = error_fingerprint(report, redacted_context.value)
        with self._lock, self._connect() as connection:
            existing = connection.execute(
                "SELECT * FROM feedback WHERE client_feedback_id = ?", (report.client_feedback_id,)
            ).fetchone()
            if existing:
                return public_record(existing), False
            object_id = None
            diagnostic_hash = None
            diagnostic_bytes = 0
            if diagnostics is not None:
                payload = canonical_json(diagnostics.value).encode("utf-8")
                object_id = f"{feedback_id}.odfeedback"
                diagnostic_hash = hashlib.sha256(payload).hexdigest()
                diagnostic_bytes = len(payload)
                self._write_encrypted(object_id, payload)
            screenshot_attachment: tuple[str, bytes, str] | None = None
            if screenshot is not None:
                screenshot_object_id = f"{feedback_id}.screenshot"
                screenshot_hash = hashlib.sha256(screenshot).hexdigest()
                self._write_encrypted(screenshot_object_id, screenshot)
                screenshot_attachment = (screenshot_object_id, screenshot, screenshot_hash)
            crash_attachment: tuple[str, bytes, str] | None = None
            if crash_dump is not None:
                crash_object_id = f"{feedback_id}.minidump"
                crash_hash = hashlib.sha256(crash_dump).hexdigest()
                self._write_encrypted(crash_object_id, crash_dump)
                crash_attachment = (crash_object_id, crash_dump, crash_hash)
            connection.execute(
                """INSERT INTO feedback (
                  feedback_id, client_feedback_id, created_at, updated_at, category, source,
                  user_description, contact_allowed, contact_address, context_json, consent_json,
                  diagnostic_object_id, diagnostic_sha256, diagnostic_bytes,
                  sensitive_matches_removed, error_fingerprint, status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'received')""",
                (
                    feedback_id, report.client_feedback_id, now, now, report.category, report.source,
                    redacted_description.value, int(report.consent.contact),
                    self._encrypt_text(report.contact_address) if report.consent.contact and report.contact_address else None,
                    canonical_json(redacted_context.value), canonical_json(report.consent.model_dump()),
                    object_id, diagnostic_hash, diagnostic_bytes, removed, fingerprint,
                ),
            )
            self._event(connection, feedback_id, "desktop", "received", "Feedback committed before asynchronous processing.")
            if screenshot_attachment is not None:
                screenshot_object_id, screenshot_payload, screenshot_hash = screenshot_attachment
                connection.execute(
                    "INSERT INTO feedback_attachments VALUES (?, ?, 'screenshot', ?, ?, ?, ?)",
                    (str(uuid.uuid4()), feedback_id, screenshot_object_id, len(screenshot_payload), screenshot_hash, now),
                )
            if crash_attachment is not None:
                crash_object_id, crash_payload, crash_hash = crash_attachment
                connection.execute("INSERT INTO feedback_attachments VALUES (?, ?, 'crash_dump', ?, ?, ?, ?)", (str(uuid.uuid4()), feedback_id, crash_object_id, len(crash_payload), crash_hash, now))
            for kind in ("triage", "notify"):
                connection.execute(
                    "INSERT INTO feedback_jobs VALUES (?, ?, ?, 'pending', 0, ?, NULL)",
                    (str(uuid.uuid4()), feedback_id, kind, time.time()),
                )
            row = connection.execute("SELECT * FROM feedback WHERE feedback_id = ?", (feedback_id,)).fetchone()
            assert row is not None
            return public_record(row), True

    def get(self, feedback_id: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute("SELECT * FROM feedback WHERE feedback_id = ?", (feedback_id,)).fetchone()
            return public_record(row) if row else None

    def list(self, *, status: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
        query = "SELECT * FROM feedback"
        parameters: list[Any] = []
        if status:
            query += " WHERE status = ?"
            parameters.append(status)
        query += " ORDER BY created_at DESC LIMIT ?"
        parameters.append(min(max(limit, 1), 500))
        with self._connect() as connection:
            return [public_record(row) for row in connection.execute(query, parameters).fetchall()]

    def update_status(self, feedback_id: str, update: FeedbackStatusUpdateModel) -> dict[str, Any] | None:
        with self._lock, self._connect() as connection:
            row = connection.execute("SELECT status FROM feedback WHERE feedback_id = ?", (feedback_id,)).fetchone()
            if not row:
                return None
            if not valid_transition(row["status"], update.status):
                raise FeedbackError("invalid_status_transition", f"Cannot move from {row['status']} to {update.status}.")
            triage = json.loads(connection.execute("SELECT triage_json FROM feedback WHERE feedback_id = ?", (feedback_id,)).fetchone()[0] or "{}")
            recommended_owner = getattr(update, "recommended_owner", None)
            if recommended_owner is not None:
                triage["recommended_owner"] = redact(recommended_owner).value
                triage["human_owner_confirmed"] = True
            connection.execute("UPDATE feedback SET status = ?, fixed_in_version = ?, triage_json = ?, updated_at = ? WHERE feedback_id = ?", (update.status, update.fixed_in_version, canonical_json(triage) if triage else None, utc_now(), feedback_id))
            self._event(connection, feedback_id, "operator", f"status.{update.status}", redact(update.note).value)
            result = connection.execute("SELECT * FROM feedback WHERE feedback_id = ?", (feedback_id,)).fetchone()
            assert result is not None
            return public_record(result)

    def run_pending_jobs(
        self,
        triage: Callable[[dict[str, Any]], dict[str, Any]] | None = None,
        notify: Callable[[dict[str, Any]], None] | None = None,
        limit: int = 20,
    ) -> dict[str, int]:
        counts = {"completed": 0, "failed": 0, "deferred": 0}
        with self._lock, self._connect() as connection:
            jobs = connection.execute(
                "SELECT * FROM feedback_jobs WHERE state IN ('pending', 'retry') AND available_at <= ? ORDER BY available_at LIMIT ?",
                (time.time(), max(1, min(limit, 100))),
            ).fetchall()
            for job in jobs:
                report_row = connection.execute(
                    "SELECT * FROM feedback WHERE feedback_id = ?", (job["feedback_id"],)
                ).fetchone()
                if not report_row:
                    continue
                report = internal_record(report_row)
                handler = triage if job["kind"] == "triage" else notify
                if handler is None:
                    counts["deferred"] += 1
                    continue
                try:
                    result = handler(report)
                    if job["kind"] == "triage":
                        analysis = validate_triage(result)
                        duplicate_of = find_duplicate(connection, report["feedback_id"], report.get("error_fingerprint"))
                        connection.execute(
                            "UPDATE feedback SET triage_json = ?, duplicate_of = ?, status = 'triaged', updated_at = ? WHERE feedback_id = ?",
                            (canonical_json(analysis), duplicate_of, utc_now(), report["feedback_id"]),
                        )
                        self._event(connection, report["feedback_id"], "agent", "triaged", analysis["summary"])
                    else:
                        self._event(connection, report["feedback_id"], "notification", "notification.sent", "Notification provider accepted the message.")
                    connection.execute("UPDATE feedback_jobs SET state = 'completed', attempts = attempts + 1, last_error = NULL WHERE job_id = ?", (job["job_id"],))
                    counts["completed"] += 1
                except Exception as exc:  # durable retry is the intended degradation path
                    attempts = int(job["attempts"]) + 1
                    delay = min(3600, 2 ** min(attempts, 10))
                    connection.execute(
                        "UPDATE feedback_jobs SET state = 'retry', attempts = ?, available_at = ?, last_error = ? WHERE job_id = ?",
                        (attempts, time.time() + delay, redact(str(exc)).value[:500], job["job_id"]),
                    )
                    counts["failed"] += 1
            return counts

    def diagnostic_payload(self, feedback_id: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT diagnostic_object_id, diagnostic_sha256 FROM feedback WHERE feedback_id = ?", (feedback_id,)
            ).fetchone()
        if not row or not row["diagnostic_object_id"]:
            return None
        payload = self._read_encrypted(row["diagnostic_object_id"])
        if hashlib.sha256(payload).hexdigest() != row["diagnostic_sha256"]:
            raise FeedbackError("diagnostic_integrity_failed", "Diagnostic attachment integrity verification failed.")
        return json.loads(payload)

    def attachment_payload(self, feedback_id: str, kind: str) -> bytes | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT object_id, sha256 FROM feedback_attachments WHERE feedback_id = ? AND kind = ?",
                (feedback_id, kind),
            ).fetchone()
        if not row:
            return None
        payload = self._read_encrypted(row["object_id"])
        if hashlib.sha256(payload).hexdigest() != row["sha256"]:
            raise FeedbackError("attachment_integrity_failed", "Feedback attachment integrity verification failed.")
        return payload

    def audited_attachment_payload(self, feedback_id: str, kind: str, actor: str) -> bytes | None:
        with self._lock, self._connect() as connection:
            try:
                payload = self.attachment_payload(feedback_id, kind)
                self._audit(connection, feedback_id, actor, f"attachment.read.{kind}", "allowed", "Authorized attachment read.")
                return payload
            except Exception as exc:
                self._audit(connection, feedback_id, actor, f"attachment.read.{kind}", "failed", str(redact(str(exc)).value))
                raise

    def audited_contact_address(self, feedback_id: str, actor: str) -> str | None:
        """Reveal contact details only through an explicit, audited operator action."""
        with self._lock, self._connect() as connection:
            row = connection.execute(
                "SELECT contact_allowed, contact_address FROM feedback WHERE feedback_id = ?",
                (feedback_id,),
            ).fetchone()
            if not row:
                return None
            if not row["contact_allowed"] or not row["contact_address"]:
                self._audit(connection, feedback_id, actor, "contact.read", "denied", "User did not authorize follow-up contact.")
                connection.commit()
                raise FeedbackError("contact_not_authorized", "The user did not authorize follow-up contact.")
            try:
                value = self._decrypt_text(row["contact_address"])
                self._audit(connection, feedback_id, actor, "contact.read", "allowed", "Authorized contact reveal.")
                return value
            except Exception as exc:
                self._audit(connection, feedback_id, actor, "contact.read", "failed", str(redact(str(exc)).value))
                connection.commit()
                raise

    def delete_feedback(self, feedback_id: str, actor: str) -> bool:
        with self._lock, self._connect() as connection:
            row = connection.execute("SELECT diagnostic_object_id FROM feedback WHERE feedback_id = ?", (feedback_id,)).fetchone()
            if not row:
                return False
            objects = [item[0] for item in connection.execute("SELECT object_id FROM feedback_attachments WHERE feedback_id = ?", (feedback_id,)).fetchall()]
            if row["diagnostic_object_id"]:
                objects.append(row["diagnostic_object_id"])
            self._audit(connection, feedback_id, actor, "feedback.delete", "allowed", "Feedback and encrypted attachments deleted.")
            connection.execute("DELETE FROM feedback_jobs WHERE feedback_id = ?", (feedback_id,))
            connection.execute("DELETE FROM feedback_events WHERE feedback_id = ?", (feedback_id,))
            connection.execute("DELETE FROM feedback_attachments WHERE feedback_id = ?", (feedback_id,))
            connection.execute("UPDATE feedback SET duplicate_of = NULL WHERE duplicate_of = ?", (feedback_id,))
            connection.execute("DELETE FROM feedback WHERE feedback_id = ?", (feedback_id,))
            for object_id in objects:
                (self.attachments / object_id).unlink(missing_ok=True)
            return True

    def enforce_retention(self, retention_days: int = 30) -> int:
        cutoff = time.time() - max(1, min(retention_days, 365)) * 86_400
        removed = 0
        for record in self.list(limit=500):
            try:
                created = datetime.fromisoformat(record["created_at"].replace("Z", "+00:00")).timestamp()
            except ValueError:
                continue
            if created < cutoff and self.delete_feedback(record["feedback_id"], "retention-worker"):
                removed += 1
        return removed

    def audit(self, feedback_id: str | None = None, limit: int = 200) -> list[dict[str, Any]]:
        query = "SELECT * FROM feedback_audit"
        params: list[Any] = []
        if feedback_id:
            query += " WHERE feedback_id = ?"; params.append(feedback_id)
        query += " ORDER BY created_at DESC LIMIT ?"; params.append(max(1, min(limit, 500)))
        with self._connect() as connection:
            return [dict(row) for row in connection.execute(query, params).fetchall()]

    def _event(self, connection: sqlite3.Connection, feedback_id: str, actor: str, action: str, detail: str) -> None:
        connection.execute(
            "INSERT INTO feedback_events VALUES (?, ?, ?, ?, ?, ?)",
            (str(uuid.uuid4()), feedback_id, utc_now(), actor, action, detail[:2_000]),
        )

    def _audit(self, connection: sqlite3.Connection, feedback_id: str | None, actor: str, action: str, result: str, detail: str) -> None:
        connection.execute("INSERT INTO feedback_audit VALUES (?, ?, ?, ?, ?, ?, ?)", (str(uuid.uuid4()), feedback_id, utc_now(), actor[:160], action[:160], result[:40], detail[:2_000]))

    def _key(self) -> bytes:
        if self.key_path.exists():
            return self.key_path.read_bytes()
        key = Fernet.generate_key()
        self.key_path.write_bytes(key)
        try:
            self.key_path.chmod(0o600)
        except OSError:
            pass
        return key

    def _write_encrypted(self, object_id: str, payload: bytes) -> None:
        destination = self.attachments / object_id
        temporary = destination.with_suffix(f".tmp-{uuid.uuid4().hex}")
        temporary.write_bytes(Fernet(self._key()).encrypt(payload))
        temporary.replace(destination)

    def _read_encrypted(self, object_id: str) -> bytes:
        try:
            return Fernet(self._key()).decrypt((self.attachments / object_id).read_bytes())
        except (InvalidToken, OSError) as exc:
            raise FeedbackError("diagnostic_unavailable", "Diagnostic attachment cannot be opened.") from exc

    def _encrypt_text(self, value: str) -> str:
        return Fernet(self._key()).encrypt(value.encode("utf-8")).decode("ascii")

    def _decrypt_text(self, value: str | None) -> str | None:
        if not value:
            return None
        try:
            return Fernet(self._key()).decrypt(value.encode("ascii")).decode("utf-8")
        except (InvalidToken, ValueError) as exc:
            raise FeedbackError("contact_unavailable", "Encrypted contact information cannot be opened.") from exc


class FeedbackError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


_default_feedback_store: FeedbackStore | None = None


def get_default_feedback_store() -> FeedbackStore:
    global _default_feedback_store
    if _default_feedback_store is None:
        _default_feedback_store = FeedbackStore(Path(FS_DIR) / "feedback")
    return _default_feedback_store


def create_router(store: FeedbackStore | None = None, worker_status: Callable[[], dict[str, Any]] | None = None) -> APIRouter:
    service = store or get_default_feedback_store()
    api = APIRouter(prefix="/v1/feedback", tags=["feedback"])

    def require_admin(request: Request) -> None:
        expected = os.getenv("OPENDRSAI_FEEDBACK_ADMIN_TOKEN", "").strip()
        supplied = request.headers.get("x-opendrsai-feedback-admin", "")
        if not expected or not hmac.compare_digest(expected, supplied):
            raise HTTPException(status_code=403, detail={"code": "feedback_admin_required", "message": "Feedback operator authorization is required."})

    @api.post("", status_code=201)
    async def submit(
        report: FeedbackSubmitModel,
        request: Request,
        idempotency_key: str = Header(alias="Idempotency-Key", min_length=8, max_length=160),
    ) -> dict[str, Any]:
        if idempotency_key != report.client_feedback_id:
            raise HTTPException(status_code=400, detail={"code": "idempotency_mismatch", "message": "Idempotency key must match client_feedback_id."})
        is_loopback = not request.client or request.client.host in {"127.0.0.1", "::1", "testclient"}
        if not is_loopback:
            allow_remote = os.getenv("OPENDRSAI_FEEDBACK_ALLOW_REMOTE", "") == "1"
            expected = os.getenv("OPENDRSAI_FEEDBACK_INTAKE_TOKEN", "").strip()
            supplied = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
            if not allow_remote or not expected or not hmac.compare_digest(expected, supplied):
                raise HTTPException(status_code=403, detail={"code": "remote_intake_denied", "message": "Remote feedback intake is not authorized."})
        try:
            record, created = service.submit(report)
        except FeedbackError as exc:
            too_large = exc.code in {"diagnostics_too_large", "screenshot_too_large", "crash_dump_too_large"}
            raise HTTPException(status_code=413 if too_large else 400, detail={"code": exc.code, "message": str(exc)}) from exc
        return {**record, "idempotent_replay": not created}

    @api.get("/{feedback_id}")
    async def get_feedback(feedback_id: str, request: Request) -> dict[str, Any]:
        require_admin(request)
        record = service.get(feedback_id)
        if not record:
            raise HTTPException(status_code=404, detail={"code": "feedback_not_found", "message": "Feedback was not found."})
        return record

    @api.get("")
    async def list_feedback(request: Request, status: FeedbackStatus | None = None, limit: int = Query(default=100, ge=1, le=500)) -> dict[str, Any]:
        require_admin(request)
        items = service.list(status=status, limit=limit)
        return {"items": items, "count": len(items)}

    @api.post("/{feedback_id}/status")
    async def update_status(feedback_id: str, update: FeedbackStatusUpdateModel, request: Request) -> dict[str, Any]:
        require_admin(request)
        try:
            record = service.update_status(feedback_id, update)
        except FeedbackError as exc:
            raise HTTPException(status_code=409, detail={"code": exc.code, "message": str(exc)}) from exc
        if not record:
            raise HTTPException(status_code=404, detail={"code": "feedback_not_found", "message": "Feedback was not found."})
        return record

    @api.delete("/{feedback_id}")
    async def delete_feedback(feedback_id: str, request: Request) -> dict[str, Any]:
        require_admin(request)
        actor = request.headers.get("x-opendrsai-principal", "local-operator")[:160]
        if not service.delete_feedback(feedback_id, actor):
            raise HTTPException(status_code=404, detail={"code": "feedback_not_found", "message": "Feedback was not found."})
        return {"deleted": True, "feedback_id": feedback_id}

    @api.get("/{feedback_id}/attachments/{kind}")
    async def read_attachment(feedback_id: str, kind: Literal["screenshot"], request: Request):
        require_admin(request)
        from fastapi.responses import Response
        actor = request.headers.get("x-opendrsai-principal", "local-operator")[:160]
        payload = service.audited_attachment_payload(feedback_id, kind, actor)
        if payload is None:
            raise HTTPException(status_code=404, detail={"code": "attachment_not_found", "message": "Attachment was not found."})
        return Response(payload, media_type="image/png", headers={"Cache-Control": "no-store"})

    @api.get("/{feedback_id}/contact")
    async def reveal_contact(feedback_id: str, request: Request) -> dict[str, Any]:
        require_admin(request)
        actor = request.headers.get("x-opendrsai-principal", "local-operator")[:160]
        try:
            address = service.audited_contact_address(feedback_id, actor)
        except FeedbackError as exc:
            raise HTTPException(status_code=403, detail={"code": exc.code, "message": str(exc)}) from exc
        if address is None:
            raise HTTPException(status_code=404, detail={"code": "feedback_not_found", "message": "Feedback was not found."})
        return {"feedback_id": feedback_id, "contact_address": address}

    @api.get("/internal/audit")
    async def list_audit(request: Request, feedback_id: str | None = None, limit: int = Query(default=200, ge=1, le=500)) -> dict[str, Any]:
        require_admin(request)
        items = service.audit(feedback_id, limit)
        return {"items": items, "count": len(items)}

    @api.get("/internal/worker/status")
    async def get_worker_status(request: Request) -> dict[str, Any]:
        require_admin(request)
        return worker_status() if worker_status else {"running": False, "triage_configured": False, "mail_configured": False}

    return api


def redact(value: Any, key: str = "") -> RedactedValue:
    removed = 0

    def visit(item: Any, field: str = "") -> Any:
        nonlocal removed
        if SECRET_KEY.search(field):
            removed += 1
            return "[REDACTED]"
        if isinstance(item, str):
            result = item
            for pattern, replacement in (
                (SECRET_VALUE, "[REDACTED]"),
                (ABSOLUTE_PATH, "[USER_PATH]"),
                (EMAIL, "[EMAIL]"),
                (IP_ADDRESS, "[IP]"),
            ):
                result, count = pattern.subn(replacement, result)
                removed += count
            return result[:64_000]
        if isinstance(item, list):
            return [visit(child, field) for child in item[:5_000]]
        if isinstance(item, dict):
            return {str(child_key)[:200]: visit(child, str(child_key)) for child_key, child in list(item.items())[:5_000]}
        if item is None or isinstance(item, (bool, int, float)):
            return item
        removed += 1
        return "[UNSUPPORTED]"

    return RedactedValue(visit(value, key), removed)


def error_fingerprint(report: FeedbackSubmitModel, context: dict[str, Any]) -> str | None:
    if report.category != "bug" and report.source not in {"error", "crash", "recovery", "tool"}:
        return None
    basis = "|".join(
        str(context.get(name) or "").strip().lower()
        for name in ("module", "error_code", "error_type", "platform")
    )
    return hashlib.sha256(basis.encode("utf-8")).hexdigest()[:24]


def validate_triage(value: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError("Triage result must be an object.")
    summary = str(value.get("summary") or "").strip()[:MAX_SUMMARY]
    if not summary:
        raise ValueError("Triage result requires a summary.")
    severity = str(value.get("severity") or "unknown")
    if severity not in {"low", "medium", "high", "critical", "unknown"}:
        severity = "unknown"
    return {
        "summary": redact(summary).value,
        "category": value.get("category") if value.get("category") in {"bug", "usability", "suggestion", "feature_request"} else "bug",
        "module": redact(str(value.get("module") or "unknown")).value[:120],
        "severity": severity,
        "needs_human_review": True,
        "recommended_owner": redact(str(value.get("recommended_owner") or "unassigned")).value[:160],
        "needs_more_info": bool(value.get("needs_more_info", False)),
    }


def valid_transition(current: str, target: str) -> bool:
    transitions = {
        "received": {"triaged", "closed"},
        "triaged": {"investigating", "needs_info", "planned", "closed"},
        "investigating": {"needs_info", "planned", "fixed", "closed"},
        "needs_info": {"investigating", "closed"},
        "planned": {"investigating", "fixed", "closed"},
        "fixed": {"closed", "investigating"},
        "closed": {"investigating"},
    }
    return target == current or target in transitions.get(current, set())


def find_duplicate(connection: sqlite3.Connection, feedback_id: str, fingerprint: str | None) -> str | None:
    if not fingerprint:
        return None
    row = connection.execute(
        "SELECT feedback_id FROM feedback WHERE error_fingerprint = ? AND feedback_id != ? ORDER BY created_at LIMIT 1",
        (fingerprint, feedback_id),
    ).fetchone()
    return str(row["feedback_id"]) if row else None


def public_record(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "feedback_id": row["feedback_id"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "category": row["category"],
        "source": row["source"],
        "user_description": row["user_description"],
        "context": json.loads(row["context_json"]),
        "consent": json.loads(row["consent_json"]),
        "diagnostics": {
            "attached": bool(row["diagnostic_object_id"]),
            "byte_length": row["diagnostic_bytes"],
            "sha256": row["diagnostic_sha256"],
            "sensitive_matches_removed": row["sensitive_matches_removed"],
        },
        "error_fingerprint": row["error_fingerprint"],
        "status": row["status"],
        "duplicate_of": row["duplicate_of"],
        "fixed_in_version": row["fixed_in_version"],
        "triage": json.loads(row["triage_json"]) if row["triage_json"] else None,
        "contact_allowed": bool(row["contact_allowed"]),
    }


def internal_record(row: sqlite3.Row) -> dict[str, Any]:
    value = public_record(row)
    # Worker email notifications intentionally do not receive user contact
    # details. A dedicated audited communication flow may decrypt them later.
    return value


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def new_feedback_id() -> str:
    date = datetime.now(timezone.utc).strftime("%Y%m%d")
    return f"FB-{date}-{uuid.uuid4().hex[:8].upper()}"


def decode_screenshot(data_url: str | None, consent: bool) -> bytes | None:
    if not consent or not data_url:
        return None
    match = re.fullmatch(r"data:image/(png|jpeg);base64,([A-Za-z0-9+/]*={0,2})", data_url)
    if not match:
        raise FeedbackError("invalid_screenshot", "Screenshot must be a PNG or JPEG data URL.")
    import base64
    try:
        payload = base64.b64decode(match.group(2), validate=True)
    except ValueError as exc:
        raise FeedbackError("invalid_screenshot", "Screenshot encoding is invalid.") from exc
    if not payload or len(payload) > MAX_SCREENSHOT_BYTES:
        raise FeedbackError("screenshot_too_large", "Screenshot exceeds the 5 MB limit.")
    if match.group(1) == "png" and not payload.startswith(b"\x89PNG\r\n\x1a\n"):
        raise FeedbackError("invalid_screenshot", "Screenshot PNG signature is invalid.")
    if match.group(1) == "jpeg" and not payload.startswith(b"\xff\xd8"):
        raise FeedbackError("invalid_screenshot", "Screenshot JPEG signature is invalid.")
    return payload


def decode_crash_dump(encoded: str | None, consent: bool) -> bytes | None:
    if not consent or not encoded:
        return None
    import base64
    try:
        payload = base64.b64decode(encoded, validate=True)
    except ValueError as exc:
        raise FeedbackError("invalid_crash_dump", "Crash dump encoding is invalid.") from exc
    if not payload or len(payload) > MAX_CRASH_DUMP_BYTES:
        raise FeedbackError("crash_dump_too_large", "Crash dump exceeds the 10 MB limit.")
    # Windows minidumps begin MDMP. Crashpad may use platform-specific dumps on
    # macOS, so signature validation is intentionally recorded but not blocked.
    return payload
