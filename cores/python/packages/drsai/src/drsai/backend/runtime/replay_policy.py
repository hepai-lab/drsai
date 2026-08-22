from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Literal, Mapping


TOOL_POLICY_VERSION = "replay-tool-policy/1"
ToolClassification = Literal["pure", "read_only_mutable", "workspace_write", "external_write", "unknown"]
ReplayDecision = Literal["reuse", "reexecute", "isolate", "block"]
_DIGEST = re.compile(r"^(?:sha256:)?[0-9a-f]{64}$")


@dataclass(frozen=True)
class ToolReplayDecision:
    decision: ReplayDecision
    reason_code: str
    reason: str
    approval_required: bool
    source_event_id: str | None = None
    external_change_possible: bool = False
    comparison_required: bool = False
    audit: dict[str, Any] | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "decision": self.decision,
            "reason_code": self.reason_code,
            "reason": self.reason,
            "approval_required": self.approval_required,
            "source_event_id": self.source_event_id,
            "external_change_possible": self.external_change_possible,
            "comparison_required": self.comparison_required,
            "policy_version": TOOL_POLICY_VERSION,
            "audit": self.audit or {},
        }


def _valid_digest(value: Any) -> bool:
    return isinstance(value, str) and bool(_DIGEST.fullmatch(value))


def decide_tool_replay(
    evidence: Mapping[str, Any],
    *,
    read_mode: Literal["historical", "reread", "compare"] = "compare",
    isolated_worktree_id: str | None = None,
    approval_id: str | None = None,
) -> ToolReplayDecision:
    classification = str(evidence.get("classification") or "unknown")
    if classification not in {"pure", "read_only_mutable", "workspace_write", "external_write", "unknown"}:
        classification = "unknown"
    audit = {
        "tool_reference": str(evidence.get("tool_reference") or "unknown")[:500],
        "classification": classification,
        "policy_version": TOOL_POLICY_VERSION,
    }
    if classification == "pure":
        required = ("input_digest", "implementation_digest", "schema_digest", "result_digest")
        current = evidence.get("current") if isinstance(evidence.get("current"), Mapping) else {}
        matches = all(
            _valid_digest(evidence.get(field))
            and _valid_digest(current.get(field))
            and evidence[field] == current[field]
            for field in required
        )
        source_event = evidence.get("source_event_id")
        if matches and isinstance(source_event, str) and source_event:
            return ToolReplayDecision(
                "reuse", "pure_evidence_match",
                "Input, implementation, schema, and result evidence all match.",
                False, source_event_id=source_event, audit=audit,
            )
        return ToolReplayDecision(
            "reexecute", "pure_evidence_mismatch",
            "Pure Tool evidence is incomplete or changed; the historical result cannot be reused.",
            False, audit=audit,
        )
    if classification == "read_only_mutable":
        if read_mode == "historical":
            source_event = evidence.get("source_event_id")
            if not isinstance(source_event, str) or not source_event:
                return ToolReplayDecision(
                    "block", "historical_result_missing",
                    "Historical read result has no authoritative source Event.", False, audit=audit,
                )
            return ToolReplayDecision(
                "reuse", "historical_read_selected",
                "The historical read is reused and may differ from the current external state.",
                False, source_event_id=source_event, external_change_possible=True, audit=audit,
            )
        return ToolReplayDecision(
            "reexecute", "mutable_read_refresh",
            "Read the mutable source again before comparison." if read_mode == "compare" else "Read the mutable source again.",
            False, external_change_possible=True, comparison_required=read_mode == "compare", audit=audit,
        )
    if classification == "workspace_write":
        if not isolated_worktree_id:
            return ToolReplayDecision(
                "block", "isolated_worktree_required",
                "Workspace writes are blocked until an isolated experiment Worktree exists.",
                True, audit=audit,
            )
        return ToolReplayDecision(
            "isolate", "workspace_write_isolated",
            "Execute only inside the bound experiment Worktree.",
            True, audit={**audit, "worktree_id": isolated_worktree_id},
        )
    if classification == "external_write":
        if not approval_id:
            return ToolReplayDecision(
                "block", "external_side_effect_requires_approval",
                "External writes are blocked by default and require an explicit operation approval.",
                True, audit=audit,
            )
        return ToolReplayDecision(
            "reexecute", "external_side_effect_approved",
            "Execute the external side effect once under the explicit approval.",
            True, audit={**audit, "approval_id": approval_id},
        )
    return ToolReplayDecision(
        "block", "unknown_tool_fail_closed",
        "The Tool is not classified by the active replay policy.",
        True, audit=audit,
    )
