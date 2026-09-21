"""Shared Reviewer protocol envelopes and client adapters."""

from __future__ import annotations

import json
import unicodedata
from dataclasses import asdict, dataclass
from typing import Any, Mapping, Protocol

from .approval_service import ApprovalDecision, ApprovalRequest, ApprovalService, ApprovalServiceError


REVIEW_PROTOCOL_VERSION = "approval-review/1"
_ADAPTER_KINDS = frozenset({"codex", "tui", "oaep"})
_DECISIONS = frozenset({"approved", "denied", "cancelled"})
_MAX_WIRE_BYTES = 64 * 1024


def _safe_display(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {str(key): _safe_display(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_safe_display(item) for item in value[:100]]
    if isinstance(value, str):
        bounded = value[:4096]
        return "".join(
            character
            if unicodedata.category(character) not in {"Cc", "Cf"} or character in {"\n", "\t"}
            else f"\\u{ord(character):04x}"
            for character in bounded
        )
    return value


@dataclass(frozen=True)
class ReviewerRequestEnvelope:
    schema_version: str
    adapter_kind: str
    request_id: str
    proposal_id: str
    proposal_digest: str
    run_id: str
    operation: str
    risk: str
    required_capabilities: tuple[str, ...]
    effect_categories: tuple[str, ...]
    display_payload: Mapping[str, Any]
    reviewer_kind: str
    reason_code: str
    deadline_at: float | None
    approval_scope: str = "once"


@dataclass(frozen=True)
class ReviewerDecisionEnvelope:
    schema_version: str
    adapter_kind: str
    request_id: str
    decision: str
    reason_code: str
    idempotency_key: str
    detail: Mapping[str, Any]


def serialize_reviewer_request(envelope: ReviewerRequestEnvelope) -> str:
    """Return the canonical, versioned request representation shared by clients."""

    payload = asdict(envelope)
    payload["required_capabilities"] = list(envelope.required_capabilities)
    payload["effect_categories"] = list(envelope.effect_categories)
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def serialize_reviewer_decision(envelope: ReviewerDecisionEnvelope) -> str:
    """Return the canonical decision fact without adding authorization semantics."""

    return json.dumps(asdict(envelope), sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def parse_reviewer_decision(payload: str | bytes) -> ReviewerDecisionEnvelope:
    raw = payload.encode("utf-8") if isinstance(payload, str) else payload
    if len(raw) > _MAX_WIRE_BYTES:
        raise ApprovalServiceError("review_payload_too_large", "Reviewer Decision exceeds the wire limit.")
    try:
        value = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ApprovalServiceError("review_payload_invalid", "Reviewer Decision is not valid JSON.") from error
    if not isinstance(value, dict):
        raise ApprovalServiceError("review_payload_invalid", "Reviewer Decision must be a JSON object.")
    required = {
        "schema_version", "adapter_kind", "request_id", "decision",
        "reason_code", "idempotency_key", "detail",
    }
    if set(value) != required or not all(isinstance(value[key], str) for key in required - {"detail"}):
        raise ApprovalServiceError("review_payload_invalid", "Reviewer Decision fields are invalid.")
    if value["schema_version"] != REVIEW_PROTOCOL_VERSION or value["adapter_kind"] not in _ADAPTER_KINDS:
        raise ApprovalServiceError("review_protocol_mismatch", "Reviewer Decision protocol is unsupported.")
    if value["decision"] not in _DECISIONS or not isinstance(value["detail"], dict):
        raise ApprovalServiceError("review_payload_invalid", "Reviewer Decision content is invalid.")
    if not value["request_id"] or not value["reason_code"] or not value["idempotency_key"]:
        raise ApprovalServiceError("review_payload_invalid", "Reviewer Decision identity fields are required.")
    return ReviewerDecisionEnvelope(**value)


class Reviewer(Protocol):
    def review(self, request: ReviewerRequestEnvelope) -> ReviewerDecisionEnvelope: ...


class ApprovalProtocolAdapter:
    def __init__(self, adapter_kind: str):
        if adapter_kind not in _ADAPTER_KINDS:
            raise ValueError("Approval adapter kind is invalid.")
        self.adapter_kind = adapter_kind

    def present(self, service: ApprovalService, request_id: str) -> ReviewerRequestEnvelope:
        request = service.get_request(request_id)
        proposal = service.proposals.get_proposal(request.proposal_id)
        return ReviewerRequestEnvelope(
            schema_version=REVIEW_PROTOCOL_VERSION,
            adapter_kind=self.adapter_kind,
            request_id=request.request_id,
            proposal_id=proposal.proposal_id,
            proposal_digest=proposal.payload_digest,
            run_id=proposal.run_id,
            operation=_safe_display(proposal.operation),
            risk=_safe_display(proposal.risk),
            required_capabilities=tuple(sorted(proposal.required_capabilities)),
            effect_categories=tuple(sorted(proposal.effect_categories)),
            display_payload=_safe_display(proposal.display_payload),
            reviewer_kind=request.reviewer_kind,
            reason_code=request.reason_code,
            deadline_at=request.deadline_at,
        )

    def submit(
        self,
        service: ApprovalService,
        envelope: ReviewerDecisionEnvelope,
        *,
        reviewer_id: str,
        reviewer_kind: str,
        now: float | None = None,
    ) -> ApprovalDecision:
        try:
            if envelope.schema_version != REVIEW_PROTOCOL_VERSION or envelope.adapter_kind != self.adapter_kind:
                raise ApprovalServiceError(
                    "review_protocol_mismatch", "Reviewer Decision protocol does not match adapter.",
                )
            return service.decide(
                envelope.request_id,
                envelope.decision,
                reviewer_kind=reviewer_kind,
                reviewer_id=reviewer_id,
                reason_code=envelope.reason_code,
                idempotency_key=envelope.idempotency_key,
                detail=envelope.detail,
                now=now,
            )
        except ApprovalServiceError as error:
            category = {
                "review_protocol_mismatch": "protocol",
                "approval_expired": "expired",
                "approval_decision_conflict": "conflict",
                "approval_decision_invalid": "invalid_decision",
            }.get(error.code, "internal")
            try:
                service.audit.append("approval.adapter_failed", envelope.request_id, {
                    "adapter_kind": self.adapter_kind,
                    "failure_category": category,
                }, now=now)
            except Exception:
                # Telemetry cannot replace the original reviewer error or grant authority.
                pass
            raise


class CodexApprovalAdapter(ApprovalProtocolAdapter):
    def __init__(self):
        super().__init__("codex")


class TuiApprovalAdapter(ApprovalProtocolAdapter):
    def __init__(self):
        super().__init__("tui")


class OaepApprovalAdapter(ApprovalProtocolAdapter):
    def __init__(self):
        super().__init__("oaep")
