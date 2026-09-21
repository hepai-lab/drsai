"""Policy outcome computation, intentionally separate from Approval facts."""

from __future__ import annotations

from dataclasses import dataclass

from drsai.backend.runtime.security_boundary.hard_deny import HardDenyPolicy
from drsai.backend.runtime.security_boundary.models import ActionProposal, ResolvedCapabilityProfile


@dataclass(frozen=True)
class PolicyDecision:
    disposition: str
    reason_code: str
    reviewer_kind: str | None
    policy_version: str


class PolicyDecisionService:
    POLICY_VERSION = "authorization-policy/1"

    def evaluate(
        self,
        proposal: ActionProposal,
        profile: ResolvedCapabilityProfile,
        *,
        review_requirement: str,
    ) -> PolicyDecision:
        hard_deny = HardDenyPolicy().evaluate(proposal)
        if hard_deny.denied:
            return PolicyDecision("hard_deny", f"hard_deny.{hard_deny.category}", None, self.POLICY_VERSION)
        if not profile.permits(proposal):
            return PolicyDecision("capability_denied", "profile_capability_denied", None, self.POLICY_VERSION)
        if review_requirement == "none":
            return PolicyDecision("allow_without_review", "policy_review_not_required", None, self.POLICY_VERSION)
        if review_requirement not in {"human", "auto"}:
            return PolicyDecision("hard_deny", "review_requirement_invalid", None, self.POLICY_VERSION)
        return PolicyDecision("require_reviewer", f"policy_requires_{review_requirement}", review_requirement, self.POLICY_VERSION)

