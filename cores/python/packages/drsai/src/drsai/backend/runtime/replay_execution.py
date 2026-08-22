from __future__ import annotations

import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Callable
from drsai.backend.runtime.sqlite_connection import ClosingConnection

from drsai.backend.runtime.experiments import ExperimentConflict, ExperimentError, RuntimeExperimentStore
from drsai.backend.runtime.replay_planner import ReplayPlanStore


class ReplayExecutionStore:
    """Materializes at most one immutable child Run from an approved Replay Plan."""

    def __init__(
        self,
        database: Path,
        experiments: RuntimeExperimentStore,
        plans: ReplayPlanStore,
        get_run: Callable[[str], dict[str, Any]],
        create_session: Callable[..., dict[str, Any]],
        create_run: Callable[..., tuple[dict[str, Any], bool]],
        set_run_input: Callable[..., dict[str, Any]],
        update_manifest: Callable[..., dict[str, Any]],
        append_event: Callable[[str, str, dict[str, Any]], dict[str, Any]],
        transition_run: Callable[..., dict[str, Any]],
        request_approval: Callable[..., dict[str, Any]],
        get_approval: Callable[[str], dict[str, Any]],
    ) -> None:
        self.database = Path(database)
        self.experiments = experiments
        self.plans = plans
        self._get_run = get_run
        self._create_session = create_session
        self._create_run = create_run
        self._set_run_input = set_run_input
        self._update_manifest = update_manifest
        self._append_event = append_event
        self._transition_run = transition_run
        self._request_approval = request_approval
        self._get_approval = get_approval
        self._lock = threading.RLock()
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.database, timeout=30, factory=ClosingConnection)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        return db

    def _initialize(self) -> None:
        with self._connect() as db:
            db.execute(
                """CREATE TABLE IF NOT EXISTS runtime_replay_executions (
                  replay_plan_id TEXT PRIMARY KEY REFERENCES runtime_replay_plans(replay_plan_id),
                  experiment_id TEXT NOT NULL REFERENCES runtime_run_experiments(experiment_id),
                  idempotency_key TEXT NOT NULL,
                  request_fingerprint TEXT NOT NULL,
                  replay_session_id TEXT,
                  replay_run_id TEXT UNIQUE REFERENCES runtime_runs(run_id),
                  runtime_approval_id TEXT,
                  execution_phase TEXT,
                  status TEXT NOT NULL,
                  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                  UNIQUE(replay_plan_id,idempotency_key)
                )"""
            )
            columns = {str(row[1]) for row in db.execute("PRAGMA table_info(runtime_replay_executions)").fetchall()}
            if "replay_session_id" not in columns:
                db.execute("ALTER TABLE runtime_replay_executions ADD COLUMN replay_session_id TEXT")
            if "runtime_approval_id" not in columns:
                db.execute("ALTER TABLE runtime_replay_executions ADD COLUMN runtime_approval_id TEXT")
            if "execution_phase" not in columns:
                db.execute("ALTER TABLE runtime_replay_executions ADD COLUMN execution_phase TEXT")

    def prepare(
        self,
        replay_plan_id: str,
        *,
        draft_version: int,
        plan_digest: str,
        base_manifest_digest: str,
        idempotency_key: str,
        approval_id: str | None = None,
        isolated_worktree_id: str | None = None,
        isolated_workspace_id: str | None = None,
    ) -> dict[str, Any]:
        self.preflight(
            replay_plan_id,
            draft_version=draft_version,
            plan_digest=plan_digest,
            base_manifest_digest=base_manifest_digest,
            idempotency_key=idempotency_key,
            approval_id=approval_id,
        )
        fingerprint = f"{draft_version}:{plan_digest}:{base_manifest_digest}:{approval_id or ''}:{isolated_worktree_id or ''}:{isolated_workspace_id or ''}"
        with self._lock:
            plan = self.plans.get(replay_plan_id)
            # The Gateway can require isolation for the execution as a whole
            # (notably rerun-from-start), even when no recorded step carries an
            # ``isolate`` decision.  A bound isolated workspace is therefore
            # authoritative execution input, not a value to recompute solely
            # from recorded steps here.
            requires_isolation = bool(isolated_worktree_id or isolated_workspace_id) or any(
                step["decision"] == "isolate" for step in plan["steps"]
            )
            if requires_isolation and (not isolated_worktree_id or not isolated_workspace_id):
                raise ExperimentConflict("Replay Plan requires an isolated experiment Worktree")
            base = self._get_run(plan["base_run_id"])
            reserved_session_id: str | None = None
            with self._connect() as db:
                existing = db.execute(
                    "SELECT * FROM runtime_replay_executions WHERE replay_plan_id=?", (replay_plan_id,)
                ).fetchone()
                if existing is not None:
                    if str(existing["idempotency_key"]) != idempotency_key or str(existing["request_fingerprint"]) != fingerprint:
                        raise ExperimentConflict("Replay Plan is already bound to another execution request")
                    if existing["replay_run_id"]:
                        run = self._get_run(str(existing["replay_run_id"]))
                        existing_draft = self.experiments.get(plan["experiment_id"])
                        existing_overrides = existing_draft.get("overrides") or {}
                        existing_model = (
                            existing_overrides.get("model")
                            if isinstance(existing_overrides.get("model"), dict) else {}
                        )
                        runtime_approval = (
                            self._get_approval(str(existing["runtime_approval_id"]))
                            if existing["runtime_approval_id"] else None
                        )
                        return {
                            "run": run, "created": False, "replay_plan_id": replay_plan_id,
                            "approval": runtime_approval,
                            "prompt": str(run.get("input_message") or ""),
                            "model_override": existing_model.get("model_id"),
                            "model_selection": dict(existing_model) if existing_model else None,
                        }
                    reserved_session_id = str(existing["replay_session_id"]) if existing["replay_session_id"] else None
                else:
                    db.execute(
                        "INSERT INTO runtime_replay_executions(replay_plan_id,experiment_id,idempotency_key,request_fingerprint,replay_session_id,replay_run_id,status) VALUES(?,?,?,?,NULL,NULL,'preparing')",
                        (replay_plan_id, plan["experiment_id"], idempotency_key, fingerprint),
                    )
            draft = self.experiments.get(plan["experiment_id"])
            replay_session_id = base["session_id"]
            parent_run_id = base["run_id"]
            if requires_isolation:
                if reserved_session_id:
                    replay_session_id = reserved_session_id
                else:
                    replay_session = self._create_session(
                        isolated_workspace_id,
                        f"Experiment: {draft['title']}",
                        agent_definition=base["agent_definition"],
                        backend_id=base["backend_id"],
                    )
                    replay_session_id = replay_session["session_id"]
                    with self._connect() as db:
                        db.execute(
                            "UPDATE runtime_replay_executions SET replay_session_id=? WHERE replay_plan_id=?",
                            (replay_session_id, replay_plan_id),
                        )
                parent_run_id = None
            replay_run, _ = self._create_run(
                replay_session_id, base["agent_definition"],
                f"replay:{replay_plan_id}:{idempotency_key}", base["backend_id"],
                parent_run_id=parent_run_id,
            )
            if isolated_worktree_id and replay_run.get("worktree_id") != isolated_worktree_id:
                raise ExperimentConflict("Replay Run is not bound to the reviewed isolated Worktree")
            overrides = draft["overrides"]
            prompt = str(overrides.get("input", {}).get("message", base.get("input_message") or ""))
            attachments = [
                str(item["reference"]) for item in overrides.get("attachments", [])
                if isinstance(item, dict) and item.get("reference")
            ] or list(base.get("attachment_refs") or [])
            model = overrides.get("model") if isinstance(overrides.get("model"), dict) else {}
            self._set_run_input(
                replay_run["run_id"], prompt, attachment_refs=attachments,
                model=model.get("model_id"), source_client="runtime",
                source_message_id=f"replay:{replay_plan_id}",
                evidence={"model": {
                    **({"provider": str(model["provider_id"])} if model.get("provider_id") else {}),
                }},
            )
            self._update_manifest(replay_run["run_id"], {"replay": {
                "replay_plan_id": replay_plan_id,
                "plan_digest": plan_digest,
                "base_manifest_digest": base_manifest_digest,
                "experiment_id": plan["experiment_id"],
                "draft_version": draft_version,
                "replay_mode": plan["replay_mode"],
                "parent_run_id": base["run_id"],
                "effective_configuration": {
                    "overrides_digest": draft["overrides_digest"],
                    "override_fields": sorted(overrides),
                    "attachment_count": len(attachments),
                    **({"model": {
                        "provider_id": str(model.get("provider_id") or ""),
                        "model_id": str(model.get("model_id") or ""),
                    }} if model else {}),
                },
            }})
            if plan["replay_mode"] == "reuse_recorded_results":
                self._append_event(replay_run["run_id"], "run.replay.context_reused", {"replay_plan_id": replay_plan_id})
            elif plan["replay_mode"] == "resume_from_checkpoint":
                checkpoint_step = next(step for step in plan["steps"] if step["kind"] == "runtime_checkpoint")
                self._append_event(replay_run["run_id"], "run.replay.checkpoint_restored", {"checkpoint_id": checkpoint_step["checkpoint_id"]})
            approval = None
            if plan["replay_mode"] == "reexecute_safe_steps":
                self._transition_run(replay_run["run_id"], "running")
                approval = self._request_approval(replay_run["run_id"], {
                    "operation": "run.replay.step.execute",
                    "risk_summary": "Review the first Replay Plan step before execution.",
                    "replay_plan_id": replay_plan_id,
                })
            self.experiments.mark_executed(plan["experiment_id"], replay_run["run_id"])
            with self._connect() as db:
                db.execute(
                    "UPDATE runtime_replay_executions SET replay_run_id=?,runtime_approval_id=?,status=? WHERE replay_plan_id=?",
                    (
                        replay_run["run_id"], approval["approval_id"] if approval else None,
                        "waiting_approval" if approval else "ready", replay_plan_id,
                    ),
                )
            return {
                "run": self._get_run(replay_run["run_id"]), "created": True,
                "replay_plan_id": replay_plan_id, "approval": approval,
                "prompt": prompt, "model_override": model.get("model_id"),
                "model_selection": dict(model) if model else None,
            }

    def preflight(
        self,
        replay_plan_id: str,
        *,
        draft_version: int,
        plan_digest: str,
        base_manifest_digest: str,
        idempotency_key: str,
        approval_id: str | None = None,
    ) -> dict[str, Any]:
        """Validate a reviewed request before creating Runs, Sessions or Worktrees."""
        if not idempotency_key or len(idempotency_key) > 200:
            raise ExperimentError("A valid Idempotency-Key is required")
        plan = self.plans.get(replay_plan_id)
        if plan["stale"]:
            raise ExperimentConflict("Replay Plan is stale and must be regenerated")
        if not plan["executable"]:
            raise ExperimentConflict("Replay Plan contains blocking steps")
        if (
            plan["draft_version"] != draft_version
            or plan["plan_digest"] != plan_digest
            or plan["base_manifest_digest"] != base_manifest_digest
        ):
            raise ExperimentConflict("Replay execution binding does not match the reviewed Plan")
        if plan["approval_requirement"] == "required" and not approval_id and plan["replay_mode"] != "reexecute_safe_steps":
            raise ExperimentConflict("Replay Plan requires an explicit approval")
        return {
            "requires_isolation": any(step["decision"] == "isolate" for step in plan["steps"]),
            "base_run_id": plan["base_run_id"],
            "replay_mode": plan["replay_mode"],
        }

    def claim_execution(self, replay_plan_id: str, *, runtime_approval_id: str | None = None) -> bool:
        """Atomically claim a prepared execution, after its step approval when required."""
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute(
                "SELECT * FROM runtime_replay_executions WHERE replay_plan_id=?", (replay_plan_id,)
            ).fetchone()
            if row is None or not row["replay_run_id"]:
                db.rollback()
                raise ExperimentConflict("Replay execution has not been prepared")
            status = str(row["status"])
            stored_approval_id = str(row["runtime_approval_id"] or "")
            if status == "waiting_approval":
                if not runtime_approval_id or runtime_approval_id != stored_approval_id:
                    db.rollback()
                    raise ExperimentConflict("Replay step approval binding does not match the prepared execution")
                approval = self._get_approval(stored_approval_id)
                if approval["status"] != "approved":
                    db.rollback()
                    raise ExperimentConflict("Replay step approval has not been approved")
            elif status != "ready":
                db.rollback()
                return False
            updated = db.execute(
                "UPDATE runtime_replay_executions SET status='executing',execution_phase='model_stream' WHERE replay_plan_id=? AND status=?",
                (replay_plan_id, status),
            )
            db.commit()
            return updated.rowcount == 1

    def mark_phase(self, replay_run_id: str, phase: str) -> None:
        if phase not in {"model_stream", "tool_execution", "terminal_finalization"}:
            raise ValueError("Replay execution phase is invalid")
        with self._lock, self._connect() as db:
            db.execute(
                "UPDATE runtime_replay_executions SET execution_phase=? "
                "WHERE replay_run_id=? AND status='executing'",
                (phase, replay_run_id),
            )

    def finish_execution(self, replay_plan_id: str) -> None:
        with self._lock, self._connect() as db:
            db.execute(
                "UPDATE runtime_replay_executions SET status='finished' WHERE replay_plan_id=? AND status='executing'",
                (replay_plan_id,),
            )

    def fail_execution(self, replay_plan_id: str, *, phase: str, code: str) -> bool:
        """Atomically terminalize a claimed execution exactly once."""
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute(
                "SELECT replay_run_id FROM runtime_replay_executions WHERE replay_plan_id=? AND status='executing'",
                (replay_plan_id,),
            ).fetchone()
            if row is None or not row["replay_run_id"]:
                db.rollback()
                return False
            claimed = db.execute(
                "UPDATE runtime_replay_executions SET status='finished',execution_phase=? "
                "WHERE replay_plan_id=? AND status='executing'",
                (phase, replay_plan_id),
            ).rowcount == 1
            db.commit()
        if not claimed:
            return False
        run_id = str(row["replay_run_id"])
        run = self._get_run(run_id)
        if run["status"] not in {"completed", "failed", "cancelled"}:
            self._append_event(run_id, "run.replay.execution_failed", {
                "replay_plan_id": replay_plan_id,
                "phase": phase,
                "code": code,
            })
            self._transition_run(run_id, "failed")
        return True

    def reconcile_interrupted(self) -> list[str]:
        """Fail executions owned by a vanished process instead of replaying side effects."""
        with self._lock, self._connect() as db:
            rows = db.execute(
                "SELECT replay_plan_id,replay_run_id,execution_phase,status FROM runtime_replay_executions "
                "WHERE status IN ('executing','interrupted')"
            ).fetchall()
        interrupted: list[str] = []
        for row in rows:
            run_id = str(row["replay_run_id"])
            run = self._get_run(run_id)
            terminal = run["status"] in {"completed", "failed", "cancelled"}
            if str(row["status"]) == "interrupted":
                # A concurrent Runtime won the execution-state claim and is
                # committing the Run terminal state. Its status change is
                # intentionally visible first, so late starters must join it.
                deadline = time.monotonic() + 5.0
                while not terminal and time.monotonic() < deadline:
                    time.sleep(0.01)
                    terminal = self._get_run(run_id)["status"] in {"completed", "failed", "cancelled"}
                continue
            with self._lock, self._connect() as db:
                claimed = db.execute(
                    "UPDATE runtime_replay_executions SET status=? WHERE replay_plan_id=? AND status='executing'",
                    ("finished" if terminal else "interrupted", str(row["replay_plan_id"])),
                ).rowcount == 1
            if not claimed:
                # Another Runtime instance already reconciled this execution.
                # Only the atomic status winner may emit evidence or fail the Run.
                # Do not let this Runtime finish startup while that winner is still
                # between the execution claim and the Run's terminal transaction.
                deadline = time.monotonic() + 5.0
                while time.monotonic() < deadline:
                    if self._get_run(run_id)["status"] in {"completed", "failed", "cancelled"}:
                        break
                    time.sleep(0.01)
                continue
            if not terminal:
                self._append_event(run_id, "run.replay.interrupted", {
                    "replay_plan_id": str(row["replay_plan_id"]),
                    "reason": "runtime_process_restarted",
                    "automatic_retry": False,
                    "phase": str(row["execution_phase"] or "model_stream"),
                })
                self._append_event(run_id, "agent.failed", {
                    "error": {
                        "code": "replay_interrupted",
                        "message": "Replay was interrupted because the Runtime process restarted. Automatic retry was not attempted.",
                        "retryable": False,
                    },
                    "phase": str(row["execution_phase"] or "model_stream"),
                })
                self._transition_run(run_id, "failed")
                interrupted.append(run_id)
        return interrupted
