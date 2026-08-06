from __future__ import annotations

import hashlib
import json
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Mapping

from drsai.backend.runtime.experiments import (
    ExperimentConflict,
    ExperimentError,
    ExperimentNotFound,
    RuntimeExperimentStore,
)
from drsai.backend.runtime.replay_policy import decide_tool_replay
from drsai.backend.runtime.sqlite_connection import ClosingConnection


REPLAY_PLAN_SCHEMA_VERSION = "opendrsai.replay-plan/1"
POLICY_VERSION = "replay-policy/1"
RUNTIME_CHECKPOINT_SCHEMA_VERSION = "opendrsai.runtime-checkpoint/1"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _canonical(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def _digest(value: Any) -> str:
    return "sha256:" + hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()


def checkpoint_compatibility(state: Mapping[str, Any], run: Mapping[str, Any]) -> tuple[bool, list[str]]:
    missing: list[str] = []
    if state.get("schema_version") != RUNTIME_CHECKPOINT_SCHEMA_VERSION:
        missing.append("schema_version")
    digest = state.get("agent_state_digest")
    if not isinstance(digest, str) or not digest.startswith("sha256:") or len(digest) != 71:
        missing.append("agent_state_digest")
    if not isinstance(state.get("model_context"), Mapping):
        missing.append("model_context")
    resume_payload = state.get("resume_payload")
    if not isinstance(resume_payload, Mapping):
        missing.append("resume_payload")
    elif state.get("agent_state_digest") != _digest(resume_payload):
        missing.append("agent_state_digest_mismatch")
    compatibility = state.get("compatibility")
    if not isinstance(compatibility, Mapping):
        missing.append("compatibility")
    else:
        if compatibility.get("backend_id") != run.get("backend_id"):
            missing.append("compatibility.backend_id")
        if compatibility.get("agent_definition") != run.get("agent_definition"):
            missing.append("compatibility.agent_definition")
    return not missing, missing


class ReplayPlanStore:
    """Immutable, expiring plans bound to one draft and one manifest digest."""

    def __init__(
        self,
        database: Path,
        experiments: RuntimeExperimentStore,
        encrypt: Callable[[dict[str, Any]], str],
        decrypt: Callable[[str], dict[str, Any]],
        get_manifest: Callable[[str], dict[str, Any]],
        inspect_run: Callable[..., dict[str, Any]],
        latest_checkpoint: Callable[[str], dict[str, Any] | None],
        get_run: Callable[[str], dict[str, Any]],
        tool_replay_evidence: Callable[[str], list[dict[str, Any]]],
    ) -> None:
        self.database = Path(database)
        self.experiments = experiments
        self._encrypt = encrypt
        self._decrypt = decrypt
        self._get_manifest = get_manifest
        self._inspect_run = inspect_run
        self._latest_checkpoint = latest_checkpoint
        self._get_run = get_run
        self._tool_replay_evidence = tool_replay_evidence
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.database, timeout=30, isolation_level=None, factory=ClosingConnection)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        return db

    def _initialize(self) -> None:
        with self._connect() as db:
            db.executescript(
                """
                CREATE TABLE IF NOT EXISTS runtime_replay_plans (
                  replay_plan_id TEXT PRIMARY KEY,
                  schema_version TEXT NOT NULL,
                  experiment_id TEXT NOT NULL REFERENCES runtime_run_experiments(experiment_id),
                  draft_version INTEGER NOT NULL,
                  base_manifest_digest TEXT NOT NULL,
                  plan_json_encrypted TEXT NOT NULL,
                  safe_plan_json TEXT NOT NULL,
                  plan_digest TEXT NOT NULL,
                  policy_version TEXT NOT NULL,
                  approval_requirement TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  expires_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_runtime_replay_plans_experiment
                  ON runtime_replay_plans(experiment_id,created_at DESC);
                """
            )

    def boundaries(self, run_id: str) -> dict[str, Any]:
        run = self._get_run(run_id)
        inspection = self._inspect_run(run_id, limit=500)
        checkpoint = self._latest_checkpoint(run_id)
        checkpoint_entry = None
        if checkpoint:
            compatible, missing = checkpoint_compatibility(checkpoint["state"], run)
            checkpoint_entry = {
                "checkpoint_id": checkpoint["checkpoint_id"],
                "event_sequence": checkpoint["event_sequence"],
                "resumable": compatible,
                "missing_or_incompatible": missing,
            }
        return {
            "run_id": run_id,
            "items": [
                {
                    "item_id": item["id"],
                    "item_type": item["type"],
                    "resumable": False,
                    "reason": "Only a compatible Runtime Checkpoint can restore Agent state.",
                }
                for item in inspection["timeline"]
            ],
            "runtime_checkpoint": checkpoint_entry,
        }

    def create(
        self,
        experiment_id: str,
        *,
        expected_draft_version: int,
        expires_in_seconds: int = 86_400,
        availability: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        draft = self.experiments.get(experiment_id)
        if draft["status"] != "draft":
            raise ExperimentConflict("Executed experiment cannot produce another plan")
        if draft["draft_version"] != expected_draft_version:
            raise ExperimentConflict("Experiment draft changed before planning")
        run = self._get_run(draft["base_run_id"])
        manifest = self._get_manifest(draft["base_run_id"])
        base_manifest_digest = str(manifest["manifest_digest"])
        inspection = self._inspect_run(draft["base_run_id"], limit=500)
        checkpoint = self._latest_checkpoint(draft["base_run_id"])
        replay_evidence = self._tool_replay_evidence(draft["base_run_id"])
        raw_by_call = {str(entry.get("call_id") or ""): entry for entry in replay_evidence}
        availability = dict(availability or {})
        blockers = self._validate_overrides(draft["overrides"], availability)
        steps: list[dict[str, Any]] = []
        if draft["overrides"]:
            steps.append({
                "step_id": "apply-overrides", "kind": "configuration", "decision": "reexecute",
                "reason": "Typed experiment overrides must be resolved for the Replay Run.",
            })
        for item in inspection["timeline"]:
            item_type = str(item["type"])
            tool_payload: dict[str, Any] = {}
            if item_type in {"message", "reasoning", "plan"}:
                decision, reason = "reuse", "Deterministic historical context can be referenced without a side effect."
            elif item_type in {"command_execution", "file_change"}:
                decision, reason = "isolate", "Workspace writes must execute in an isolated Worktree."
            elif item_type == "tool_call":
                content = item.get("content") if isinstance(item.get("content"), Mapping) else {}
                evidence = content.get("replay_policy") if isinstance(content.get("replay_policy"), Mapping) else {}
                raw_tool = raw_by_call.get(str(content.get("call_id") or ""), {})
                reviewed_arguments = (
                    raw_tool.get("arguments") if isinstance(raw_tool.get("arguments"), Mapping)
                    else content.get("arguments") if isinstance(content.get("arguments"), Mapping)
                    else None
                )
                if raw_tool and isinstance(raw_tool.get("policy"), Mapping):
                    evidence = raw_tool["policy"]
                tool_decision = decide_tool_replay(
                    evidence,
                    read_mode="compare",
                    isolated_worktree_id=("planned-experiment-worktree" if evidence.get("classification") == "workspace_write" else None),
                )
                decision, reason = tool_decision.decision, tool_decision.reason
                tool_payload = tool_decision.as_dict()
                if (
                    draft["replay_mode"] in {"rerun_from_start", "reexecute_safe_steps"}
                    and decision == "reuse"
                ):
                    decision = "reexecute"
                    reason = "The selected Replay mode requires a fresh invocation of this safe Tool."
                    tool_payload.update({
                        "decision": decision,
                        "reason": reason,
                        "reason_code": "replay_mode_requires_reexecution",
                        "source_event_id": None,
                    })
                if draft["replay_mode"] == "resume_from_checkpoint" and checkpoint:
                    source_event_sequence = raw_tool.get("source_event_sequence")
                    if (
                        isinstance(source_event_sequence, int)
                        and source_event_sequence <= int(checkpoint["event_sequence"])
                    ):
                        decision = "reuse"
                        reason = "This Tool completed before the restored Runtime Checkpoint and will not be invoked again."
                        tool_payload.update({
                            "decision": decision, "reason": reason,
                            "reason_code": "checkpoint_state_covers_step",
                            "source_event_id": None, "checkpoint_covered": True,
                        })
            elif item_type in {"interaction", "subtask"}:
                decision, reason = "block", "Tool side-effect classification is not proven; fail closed."
            else:
                decision, reason = "reuse", "The evidence item is read-only run context."
            steps.append({
                "step_id": f"item:{item['id']}", "kind": item_type, "item_id": item["id"],
                "decision": decision, "reason": reason,
                **tool_payload,
                **({
                    "tool_kind": str(content.get("tool_kind") or "tool"),
                    "tool_name": str(content.get("tool_name") or ""),
                } if item_type == "tool_call" else {}),
                **({"_replay_capability": {
                    "tool_kind": str(content.get("tool_kind") or raw_tool.get("kind") or "tool"),
                    "tool_name": str(content.get("tool_name") or raw_tool.get("name") or ""),
                    "arguments": dict(reviewed_arguments or {}),
                    "historical_result": raw_tool.get("result"),
                    "input_digest": evidence.get("input_digest"),
                    "implementation_digest": evidence.get("implementation_digest"),
                    "schema_digest": evidence.get("schema_digest"),
                    "classification": evidence.get("classification"),
                    "policy_version": tool_payload.get("policy_version"),
                }} if item_type == "tool_call" and decision in {"reuse", "reexecute"} and not tool_payload.get("checkpoint_covered") else {}),
            })
            if item_type == "tool_call" and decision == "reuse" and (
                not isinstance(raw_tool.get("arguments"), Mapping)
                or not isinstance(raw_tool.get("result"), Mapping)
                or _digest(raw_tool.get("arguments")) != evidence.get("input_digest")
                or _digest(raw_tool.get("result")) != evidence.get("result_digest")
            ):
                steps[-1]["decision"] = "block"
                steps[-1].pop("_replay_capability", None)
                steps[-1]["reason"] = "Historical Pure Tool arguments or result do not match their evidence digests."
                decision = "block"
                blockers.append({"code": "pure_tool_reuse_evidence_invalid", "item_id": item["id"]})
            if item_type == "tool_call" and decision == "reexecute" and not isinstance(reviewed_arguments, Mapping):
                steps[-1]["decision"] = "block"
                steps[-1].pop("_replay_capability", None)
                steps[-1]["reason"] = "The reviewed Tool arguments are unavailable; safe re-execution cannot be bound."
                decision = "block"
                blockers.append({"code": "tool_call_binding_missing", "item_id": item["id"]})
            if decision == "block":
                blockers.append({
                    "code": (tool_decision.reason_code if item_type == "tool_call" else "unclassified_side_effect"),
                    "item_id": item["id"],
                })
        if draft["replay_mode"] == "resume_from_checkpoint":
            compatible, missing = checkpoint_compatibility(checkpoint["state"], run) if checkpoint else (False, ["runtime_checkpoint"])
            if not compatible:
                blockers.append({"code": "checkpoint_incompatible", "detail": missing})
            steps.insert(0, {
                "step_id": "restore-checkpoint", "kind": "runtime_checkpoint",
                "decision": "reuse" if compatible else "block",
                "reason": "Compatible Runtime state is available." if compatible else "No compatible Runtime state is available.",
                **({"checkpoint_id": checkpoint["checkpoint_id"]} if checkpoint else {}),
            })
            if availability.get("checkpoint_restore") is False:
                blockers.append({"code": "checkpoint_restore_unavailable"})
                steps[0]["decision"] = "block"
                steps[0]["reason"] = "The selected Agent Backend cannot restore Runtime Checkpoint state."
        if availability.get("worktree") is False:
            for step in steps:
                if step["decision"] == "isolate":
                    step["decision"] = "block"
                    step["reason"] = "This Runtime cannot create an isolated Worktree; Replay is limited to read-only review."
                    blockers.append({"code": "worktree_capability_unavailable", "item_id": step.get("item_id")})
        risks = [step for step in steps if step["decision"] in {"isolate", "block"}]
        usage = inspection.get("summary", {}).get("usage", {})
        known_usage = any(int(usage.get(key) or 0) > 0 for key in ("input_tokens", "output_tokens", "total_tokens"))
        estimate = {
            "token_usage": dict(usage) if known_usage else None,
            "token_usage_known": known_usage,
            "monetary_cost": None,
            "monetary_cost_known": False,
            "external_calls": sum(1 for step in steps if step["kind"] in {"tool_call", "subtask"}),
            "workspace_writes": sum(1 for step in steps if step["decision"] == "isolate"),
        }
        created = _now()
        expires = created + timedelta(seconds=max(60, min(expires_in_seconds, 7 * 86_400)))
        plan = {
            "schema_version": REPLAY_PLAN_SCHEMA_VERSION,
            "experiment_id": experiment_id,
            "draft_version": expected_draft_version,
            "base_run_id": draft["base_run_id"],
            "base_manifest_digest": base_manifest_digest,
            "overrides_digest": draft["overrides_digest"],
            "replay_mode": draft["replay_mode"],
            "policy_version": POLICY_VERSION,
            "steps": steps,
            "blockers": blockers,
            "risks": risks,
            "estimate": estimate,
        }
        plan_digest = _digest(plan)
        plan_id = f"replay-plan-{uuid.uuid4()}"
        safe_plan = {
            **plan,
            "steps": [{key: value for key, value in step.items() if key != "_replay_capability"} for step in steps],
            "plan_digest": plan_digest,
        }
        with self._connect() as db:
            db.execute(
                "INSERT INTO runtime_replay_plans VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    plan_id, REPLAY_PLAN_SCHEMA_VERSION, experiment_id, expected_draft_version,
                    base_manifest_digest, self._encrypt(plan), _canonical(safe_plan), plan_digest,
                    POLICY_VERSION, "required" if risks else "none", created.isoformat(), expires.isoformat(),
                ),
            )
        return self.get(plan_id)

    def get(self, replay_plan_id: str) -> dict[str, Any]:
        with self._connect() as db:
            row = db.execute(
                "SELECT * FROM runtime_replay_plans WHERE replay_plan_id=?", (replay_plan_id,)
            ).fetchone()
        if row is None:
            raise ExperimentNotFound("Replay Plan not found")
        safe_plan = json.loads(str(row["safe_plan_json"]))
        stale_reasons: list[str] = []
        draft = self.experiments.get(str(row["experiment_id"]))
        if draft["draft_version"] != int(row["draft_version"]):
            stale_reasons.append("draft_version_changed")
        manifest = self._get_manifest(draft["base_run_id"])
        if str(manifest["manifest_digest"]) != str(row["base_manifest_digest"]):
            stale_reasons.append("base_manifest_changed")
        if str(row["policy_version"]) != POLICY_VERSION:
            stale_reasons.append("policy_version_changed")
        if datetime.fromisoformat(str(row["expires_at"])) <= _now():
            stale_reasons.append("expired")
        return {
            "replay_plan_id": replay_plan_id,
            **safe_plan,
            "approval_requirement": str(row["approval_requirement"]),
            "created_at": str(row["created_at"]),
            "expires_at": str(row["expires_at"]),
            "stale": bool(stale_reasons),
            "stale_reasons": stale_reasons,
            "executable": not stale_reasons and not safe_plan["blockers"],
        }

    def get_execution_plan(self, replay_plan_id: str) -> dict[str, Any]:
        """Return the encrypted execution capability; never expose this from an API."""
        public = self.get(replay_plan_id)
        if public["stale"]:
            raise ExperimentConflict("Replay Plan is stale")
        with self._connect() as db:
            row = db.execute(
                "SELECT plan_json_encrypted,plan_digest FROM runtime_replay_plans WHERE replay_plan_id=?",
                (replay_plan_id,),
            ).fetchone()
        if row is None:
            raise ExperimentNotFound("Replay Plan not found")
        plan = self._decrypt(str(row["plan_json_encrypted"]))
        if _digest(plan) != str(row["plan_digest"]):
            raise ExperimentConflict("Replay Plan execution capability failed integrity verification")
        return plan

    @staticmethod
    def _validate_overrides(overrides: Mapping[str, Any], availability: Mapping[str, Any]) -> list[dict[str, Any]]:
        blockers: list[dict[str, Any]] = []
        for field in ("attachments", "resources"):
            available = set(availability.get(field, []))
            for resource in overrides.get(field, []) if isinstance(overrides.get(field), list) else []:
                if resource.get("required", True) and resource["reference"] not in available:
                    blockers.append({"code": "resource_unavailable", "field": field, "reference": resource["reference"]})
        model = overrides.get("model")
        if isinstance(model, Mapping):
            identity = f"{model.get('provider_id')}/{model.get('model_id')}"
            if identity not in set(availability.get("models", [])):
                blockers.append({"code": "model_unavailable", "reference": identity})
        for field in ("prompt", "agent"):
            identity = overrides.get(field)
            if isinstance(identity, Mapping) and identity["reference"] not in set(availability.get(field, [])):
                blockers.append({"code": f"{field}_unavailable", "reference": identity["reference"]})
        for field in ("skills", "tools"):
            available = set(availability.get(field, []))
            for identity in overrides.get(field, []) if isinstance(overrides.get(field), list) else []:
                if identity["reference"] not in available:
                    blockers.append({"code": f"{field[:-1]}_unavailable", "reference": identity["reference"]})
        return blockers
