"""Fail-closed automatic reviewer: deterministic policy before optional model judgment."""

from __future__ import annotations

import concurrent.futures
import re
import sqlite3
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, Protocol

from drsai.backend.runtime.security_boundary import ActionProposal, HardDenyPolicy
from drsai.backend.runtime.security_boundary.audit import SecurityEventJournal
from drsai.backend.runtime.security_boundary.models import redact_for_display
from drsai.backend.runtime.sqlite_connection import ClosingConnection

from .resolver import EffectivePermissionProfile


AUTO_REVIEW_RULE_VERSION = "auto-review-rules/1"
_REASON = re.compile(r"^[a-z][a-z0-9_.-]{1,127}$")
_OUTCOMES = frozenset({"approve", "deny", "escalate"})
_DENY_CATEGORIES = frozenset({
    "data_exfiltration", "prompt_injection_execution", "credential_theft",
    "security_control_tampering", "host_persistence", "cross_process_injection",
})
_SAFE_RISKS = frozenset({"read", "read_only", "local_read", "reversible_local"})
_BOUNDED_LOCAL_MUTATIONS = frozenset({"file.write", "file.edit"})
_CONTROL_PATH_PREFIXES = frozenset({".git", ".agents", ".codex", ".opendrsai-trash"})


class AutoReviewerModel(Protocol):
    model_version: str

    def review(self, context: Mapping[str, Any]) -> Mapping[str, Any]: ...


@dataclass(frozen=True)
class AutoReviewerConfig:
    enabled: bool = False
    rule_version: str = AUTO_REVIEW_RULE_VERSION
    allowed_model_versions: frozenset[str] = frozenset()
    minimum_confidence: float = 0.95
    timeout_seconds: float = 5

    def validate(self) -> None:
        if self.rule_version != AUTO_REVIEW_RULE_VERSION:
            raise ValueError("Unknown AutoReviewer rule version.")
        if not 0 <= self.minimum_confidence <= 1 or self.timeout_seconds <= 0 or self.timeout_seconds > 30:
            raise ValueError("AutoReviewer safety thresholds are invalid.")


@dataclass(frozen=True)
class AutoReviewDecision:
    review_id: str
    proposal_id: str
    proposal_digest: str
    profile_digest: str
    outcome: str
    reason_code: str
    confidence: float | None
    decision_source: str
    rule_version: str
    model_version: str | None
    idempotency_key: str
    created_at: float


class AutoReviewerService:
    """Records review advice only; it has no Grant or Effect dependency."""

    def __init__(self, database: Path, config: AutoReviewerConfig, model: AutoReviewerModel | None = None):
        self.database = Path(database)
        self.config = config
        self.config.validate()
        self.model = model
        self.audit = SecurityEventJournal(self.database)
        with self._connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS runtime_auto_review_decisions(
                    review_id TEXT PRIMARY KEY,
                    proposal_id TEXT NOT NULL,
                    proposal_digest TEXT NOT NULL,
                    profile_digest TEXT NOT NULL,
                    outcome TEXT NOT NULL CHECK(outcome IN ('approve','deny','escalate')),
                    reason_code TEXT NOT NULL,
                    confidence REAL,
                    decision_source TEXT NOT NULL CHECK(decision_source IN ('rule','model','system')),
                    rule_version TEXT NOT NULL,
                    model_version TEXT,
                    idempotency_key TEXT NOT NULL UNIQUE,
                    created_at REAL NOT NULL
                );
                CREATE TRIGGER IF NOT EXISTS runtime_auto_review_decisions_no_update
                BEFORE UPDATE ON runtime_auto_review_decisions
                BEGIN SELECT RAISE(ABORT, 'auto review decision is immutable'); END;
                CREATE TRIGGER IF NOT EXISTS runtime_auto_review_decisions_no_delete
                BEFORE DELETE ON runtime_auto_review_decisions
                BEGIN SELECT RAISE(ABORT, 'auto review decision is append-only'); END;
            """)

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database, timeout=30, isolation_level=None, factory=ClosingConnection)
        connection.row_factory = sqlite3.Row
        return connection

    @staticmethod
    def _from_row(row: sqlite3.Row) -> AutoReviewDecision:
        return AutoReviewDecision(
            str(row["review_id"]), str(row["proposal_id"]), str(row["proposal_digest"]),
            str(row["profile_digest"]), str(row["outcome"]), str(row["reason_code"]),
            float(row["confidence"]) if row["confidence"] is not None else None,
            str(row["decision_source"]), str(row["rule_version"]),
            str(row["model_version"]) if row["model_version"] is not None else None,
            str(row["idempotency_key"]), float(row["created_at"]),
        )

    def _deterministic(
        self, proposal: ActionProposal, effective: EffectivePermissionProfile,
    ) -> tuple[str, str, float | None, str] | None:
        if not self.config.enabled:
            return "escalate", "auto_reviewer_disabled", None, "system"
        if effective.mode.mode_id != "auto_reviewed" or effective.reviewer_route != "auto":
            return "escalate", "auto_reviewer_mode_mismatch", None, "system"
        hard_deny = HardDenyPolicy().evaluate(proposal)
        if hard_deny.denied:
            return "deny", hard_deny.reason_code, 1.0, "rule"
        if not effective.capability_profile.permits(proposal):
            return "deny", "profile_capability_denied", 1.0, "rule"
        categories = proposal.effect_categories
        denied = categories & _DENY_CATEGORIES
        if denied:
            return "deny", f"auto_deny.{sorted(denied)[0]}", 1.0, "rule"
        mandatory = categories & effective.mandatory_human_categories
        if mandatory:
            return "escalate", f"mandatory_human.{sorted(mandatory)[0]}", 1.0, "rule"
        if not proposal.display_payload or not proposal.operation or not proposal.risk:
            return "escalate", "mandatory_human.proposal_incomplete", 1.0, "rule"
        if proposal.risk in {"critical", "production", "irreversible", "unknown"}:
            return "escalate", f"risk_requires_human.{proposal.risk}", 1.0, "rule"
        if proposal.risk in _SAFE_RISKS and not categories:
            return "approve", "deterministic_safe_read", 1.0, "rule"
        mutation_fields = {
            "file.write": {"relative_path", "content_digest", "size_bytes"},
            "file.edit": {
                "relative_path", "source_content_digest", "result_content_digest",
                "result_size_bytes", "match_count",
            },
        }
        required_fields = mutation_fields.get(proposal.operation, set())
        relative_path = str(proposal.display_payload.get("relative_path") or "").replace("\\", "/")
        if (
            proposal.operation in _BOUNDED_LOCAL_MUTATIONS
            and relative_path.split("/", 1)[0].casefold() in _CONTROL_PATH_PREFIXES
        ):
            return "deny", "auto_deny.control_path", 1.0, "rule"
        if (
            proposal.operation in _BOUNDED_LOCAL_MUTATIONS
            and proposal.risk == "write"
            and proposal.required_capabilities == frozenset({"filesystem.write"})
            and not categories
            and required_fields.issubset(proposal.display_payload)
        ):
            # The Runtime execution broker still enforces writable roots,
            # protected paths, exact payload binding and single-use Grant.
            # This rule only removes redundant human review for a fully
            # specified local mutation in the explicitly selected auto mode.
            return "approve", "deterministic_bounded_local_mutation", 1.0, "rule"
        return None

    def _model_decision(self, proposal: ActionProposal, effective: EffectivePermissionProfile) -> tuple[str, str, float | None, str, str | None]:
        if self.model is None:
            return "escalate", "auto_reviewer_model_unavailable", None, "system", None
        model_version = str(getattr(self.model, "model_version", ""))
        if not model_version or model_version not in self.config.allowed_model_versions:
            return "escalate", "auto_reviewer_model_version_untrusted", None, "system", model_version or None
        context = {
            "proposal": {
                "operation": proposal.operation, "risk": proposal.risk,
                "effect_categories": sorted(proposal.effect_categories),
                "required_capabilities": sorted(proposal.required_capabilities),
                "display_payload": redact_for_display(proposal.display_payload),
            },
            "policy": {
                "mode_id": effective.mode.mode_id,
                "effective_capabilities": sorted(effective.capability_profile.capabilities),
                "mandatory_human_categories": sorted(effective.mandatory_human_categories),
                "rule_version": self.config.rule_version,
            },
        }
        executor = concurrent.futures.ThreadPoolExecutor(max_workers=1, thread_name_prefix="auto-review")
        future = executor.submit(self.model.review, context)
        try:
            value = future.result(timeout=self.config.timeout_seconds)
        except concurrent.futures.TimeoutError:
            future.cancel()
            return "escalate", "auto_reviewer_model_timeout", None, "system", model_version
        except Exception:
            return "escalate", "auto_reviewer_model_failed", None, "system", model_version
        finally:
            executor.shutdown(wait=False, cancel_futures=True)
        try:
            outcome = str(value["outcome"])
            reason_code = str(value["reason_code"])
            confidence = float(value["confidence"])
        except (KeyError, TypeError, ValueError):
            return "escalate", "auto_reviewer_model_output_invalid", None, "system", model_version
        if outcome not in _OUTCOMES or not _REASON.fullmatch(reason_code) or not 0 <= confidence <= 1:
            return "escalate", "auto_reviewer_model_output_invalid", None, "system", model_version
        if outcome == "approve" and confidence < self.config.minimum_confidence:
            return "escalate", "auto_reviewer_low_confidence", confidence, "model", model_version
        return outcome, reason_code, confidence, "model", model_version

    def review(
        self,
        proposal: ActionProposal,
        effective: EffectivePermissionProfile,
        *,
        idempotency_key: str,
        now: float | None = None,
    ) -> AutoReviewDecision:
        created_at = float(time.time() if now is None else now)
        if not idempotency_key:
            raise ValueError("AutoReviewer idempotency key is required.")
        deterministic = self._deterministic(proposal, effective)
        model_version: str | None = None
        if deterministic is not None:
            outcome, reason_code, confidence, source = deterministic
        else:
            outcome, reason_code, confidence, source, model_version = self._model_decision(proposal, effective)
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            prior = db.execute(
                "SELECT * FROM runtime_auto_review_decisions WHERE idempotency_key=?", (idempotency_key,),
            ).fetchone()
            if prior is not None:
                stored = self._from_row(prior)
                expected = (proposal.proposal_id, proposal.payload_digest, effective.capability_profile.digest)
                actual = (stored.proposal_id, stored.proposal_digest, stored.profile_digest)
                db.rollback()
                if actual == expected:
                    return stored
                raise ValueError("AutoReviewer idempotency key was reused for another authorization scope.")
            review_id = f"auto-review-{uuid.uuid4()}"
            db.execute(
                "INSERT INTO runtime_auto_review_decisions VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    review_id, proposal.proposal_id, proposal.payload_digest,
                    effective.capability_profile.digest, outcome, reason_code, confidence, source,
                    self.config.rule_version, model_version, idempotency_key, created_at,
                ),
            )
            self.audit.append_in_transaction(db, "auto_reviewer.decided", review_id, {
                "outcome": outcome, "reason_code": reason_code, "decision_source": source,
                "rule_version": self.config.rule_version, "model_version": model_version or "none",
                "confidence_bucket": self._confidence_bucket(confidence),
            }, now=created_at)
            db.commit()
        return AutoReviewDecision(
            review_id, proposal.proposal_id, proposal.payload_digest, effective.capability_profile.digest,
            outcome, reason_code, confidence, source, self.config.rule_version, model_version,
            idempotency_key, created_at,
        )

    @staticmethod
    def _confidence_bucket(confidence: float | None) -> str:
        if confidence is None:
            return "none"
        if confidence < 0.5:
            return "low"
        if confidence < 0.95:
            return "medium"
        return "high"
