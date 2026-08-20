"""Append-only persistence for Runtime security proposals and profiles."""

from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path
from typing import Any

from drsai.backend.runtime.sqlite_connection import ClosingConnection

from .models import ActionProposal, ResolvedCapabilityProfile, canonical_json


class SecurityBoundaryStoreError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class SecurityBoundaryStore:
    """Stores immutable facts without persisting original proposal secrets."""

    def __init__(self, database: Path):
        self.database = Path(database)
        self.database.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS runtime_security_profiles(
                    profile_digest TEXT PRIMARY KEY,
                    profile_id TEXT NOT NULL,
                    version INTEGER NOT NULL,
                    profile_json TEXT NOT NULL,
                    created_at REAL NOT NULL,
                    UNIQUE(profile_id, version)
                );
                CREATE TABLE IF NOT EXISTS runtime_action_proposals(
                    proposal_id TEXT PRIMARY KEY,
                    run_id TEXT NOT NULL,
                    operation TEXT NOT NULL,
                    payload_digest TEXT NOT NULL,
                    display_json TEXT NOT NULL,
                    risk TEXT NOT NULL,
                    capabilities_json TEXT NOT NULL,
                    created_at REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS runtime_run_security_profiles(
                    binding_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    run_id TEXT NOT NULL,
                    profile_digest TEXT NOT NULL REFERENCES runtime_security_profiles(profile_digest),
                    reason TEXT NOT NULL,
                    bound_at REAL NOT NULL,
                    UNIQUE(run_id, profile_digest)
                );
                CREATE TRIGGER IF NOT EXISTS runtime_security_profiles_no_update
                BEFORE UPDATE ON runtime_security_profiles BEGIN SELECT RAISE(ABORT, 'security profile is immutable'); END;
                CREATE TRIGGER IF NOT EXISTS runtime_security_profiles_no_delete
                BEFORE DELETE ON runtime_security_profiles BEGIN SELECT RAISE(ABORT, 'security profile is immutable'); END;
                CREATE TRIGGER IF NOT EXISTS runtime_action_proposals_no_update
                BEFORE UPDATE ON runtime_action_proposals BEGIN SELECT RAISE(ABORT, 'action proposal is immutable'); END;
                CREATE TRIGGER IF NOT EXISTS runtime_action_proposals_no_delete
                BEFORE DELETE ON runtime_action_proposals BEGIN SELECT RAISE(ABORT, 'action proposal is immutable'); END;
                CREATE TRIGGER IF NOT EXISTS runtime_run_security_profiles_no_update
                BEFORE UPDATE ON runtime_run_security_profiles BEGIN SELECT RAISE(ABORT, 'profile binding is immutable'); END;
                CREATE TRIGGER IF NOT EXISTS runtime_run_security_profiles_no_delete
                BEFORE DELETE ON runtime_run_security_profiles BEGIN SELECT RAISE(ABORT, 'profile binding is immutable'); END;
            """)
            proposal_columns = {
                str(row[1]) for row in db.execute("PRAGMA table_info(runtime_action_proposals)").fetchall()
            }
            if "categories_json" not in proposal_columns:
                db.execute(
                    "ALTER TABLE runtime_action_proposals ADD COLUMN categories_json TEXT NOT NULL DEFAULT '[]'",
                )

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database, timeout=30, factory=ClosingConnection)
        connection.row_factory = sqlite3.Row
        return connection

    @staticmethod
    def _profile_from_json(value: str) -> ResolvedCapabilityProfile:
        raw = json.loads(value)
        return ResolvedCapabilityProfile(
            profile_id=str(raw["profile_id"]),
            version=int(raw["version"]),
            workspace_root=str(raw["workspace_root"]),
            capabilities=frozenset(str(item) for item in raw["capabilities"]),
            writable_roots=tuple(str(item) for item in raw["writable_roots"]),
            network_rules=tuple(str(item) for item in raw["network_rules"]),
            credential_refs=frozenset(str(item) for item in raw["credential_refs"]),
            hard_denies=frozenset(str(item) for item in raw["hard_denies"]),
            trusted_workspace=bool(raw["trusted_workspace"]),
        )

    def save_profile(self, profile: ResolvedCapabilityProfile, *, now: float | None = None) -> None:
        payload = canonical_json(profile.as_security_payload())
        try:
            with self._connect() as db:
                db.execute(
                    "INSERT INTO runtime_security_profiles VALUES(?,?,?,?,?)",
                    (profile.digest, profile.profile_id, profile.version, payload, time.time() if now is None else now),
                )
        except sqlite3.IntegrityError as error:
            with self._connect() as db:
                row = db.execute(
                    "SELECT profile_digest FROM runtime_security_profiles WHERE profile_id=? AND version=?",
                    (profile.profile_id, profile.version),
                ).fetchone()
            if row is not None and str(row["profile_digest"]) == profile.digest:
                return
            raise SecurityBoundaryStoreError(
                "profile_version_conflict", "A profile ID/version is already bound to different security content.",
            ) from error

    def get_profile(self, profile_digest: str) -> ResolvedCapabilityProfile:
        with self._connect() as db:
            row = db.execute(
                "SELECT profile_json FROM runtime_security_profiles WHERE profile_digest=?", (profile_digest,),
            ).fetchone()
        if row is None:
            raise SecurityBoundaryStoreError("profile_missing", "Security profile does not exist.")
        profile = self._profile_from_json(str(row["profile_json"]))
        if profile.digest != profile_digest:
            raise SecurityBoundaryStoreError("profile_integrity_failed", "Stored security profile digest is invalid.")
        return profile

    def save_proposal(self, proposal: ActionProposal, *, now: float | None = None) -> None:
        with self._connect() as db:
            self.save_proposal_in_transaction(db, proposal, now=now)

    def save_proposal_in_transaction(
        self,
        db: sqlite3.Connection,
        proposal: ActionProposal,
        *,
        now: float | None = None,
    ) -> None:
        values = (
            proposal.proposal_id,
            proposal.run_id,
            proposal.operation,
            proposal.payload_digest,
            canonical_json(proposal.display_payload),
            proposal.risk,
            canonical_json(sorted(proposal.required_capabilities)),
            canonical_json(sorted(proposal.effect_categories)),
            time.time() if now is None else now,
        )
        try:
            db.execute(
                "INSERT INTO runtime_action_proposals("
                "proposal_id,run_id,operation,payload_digest,display_json,risk,capabilities_json,categories_json,created_at"
                ") VALUES(?,?,?,?,?,?,?,?,?)",
                values,
            )
        except sqlite3.IntegrityError as error:
            row = db.execute(
                "SELECT * FROM runtime_action_proposals WHERE proposal_id=?", (proposal.proposal_id,),
            ).fetchone()
            existing = self._proposal_from_row(row) if row is not None else None
            if existing == proposal:
                return
            raise SecurityBoundaryStoreError(
                "proposal_identity_conflict", "Proposal ID is already bound to different content.",
            ) from error

    @staticmethod
    def _proposal_from_row(row: sqlite3.Row) -> ActionProposal:
        return ActionProposal(
            proposal_id=str(row["proposal_id"]),
            run_id=str(row["run_id"]),
            operation=str(row["operation"]),
            payload_digest=str(row["payload_digest"]),
            display_payload=json.loads(str(row["display_json"])),
            risk=str(row["risk"]),
            required_capabilities=frozenset(json.loads(str(row["capabilities_json"]))),
            effect_categories=frozenset(json.loads(str(row["categories_json"]))),
        )

    def get_proposal(self, proposal_id: str) -> ActionProposal:
        with self._connect() as db:
            row = db.execute(
                "SELECT * FROM runtime_action_proposals WHERE proposal_id=?", (proposal_id,),
            ).fetchone()
        if row is None:
            raise SecurityBoundaryStoreError("proposal_missing", "Action proposal does not exist.")
        return self._proposal_from_row(row)

    def bind_run_profile(
        self,
        run_id: str,
        profile: ResolvedCapabilityProfile,
        *,
        reason: str,
        now: float | None = None,
    ) -> None:
        if not run_id or not reason:
            raise ValueError("Run ID and profile binding reason are required.")
        self.save_profile(profile, now=now)
        with self._connect() as db:
            current = db.execute(
                "SELECT p.version FROM runtime_run_security_profiles b "
                "JOIN runtime_security_profiles p ON p.profile_digest=b.profile_digest "
                "WHERE b.run_id=? ORDER BY b.binding_id DESC LIMIT 1",
                (run_id,),
            ).fetchone()
            if current is not None and profile.version <= int(current["version"]):
                raise SecurityBoundaryStoreError(
                    "profile_version_not_monotonic", "A Run security profile version must increase.",
                )
            db.execute(
                "INSERT INTO runtime_run_security_profiles(run_id,profile_digest,reason,bound_at) VALUES(?,?,?,?)",
                (run_id, profile.digest, reason, time.time() if now is None else now),
            )

    def active_profile(self, run_id: str) -> ResolvedCapabilityProfile:
        with self._connect() as db:
            row = db.execute(
                "SELECT profile_digest FROM runtime_run_security_profiles WHERE run_id=? "
                "ORDER BY binding_id DESC LIMIT 1",
                (run_id,),
            ).fetchone()
        if row is None:
            raise SecurityBoundaryStoreError("run_profile_missing", "Run has no active security profile.")
        return self.get_profile(str(row["profile_digest"]))
