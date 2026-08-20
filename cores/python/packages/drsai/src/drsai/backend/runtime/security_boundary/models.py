"""Immutable proposal and capability models.

Authorization digests are always computed from the original canonical payload.
Redacted display data is a separate representation and is never authoritative.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping, Sequence


_SECRET_KEY = re.compile(
    r"(?:authorization|cookie|credential|password|passwd|private[_-]?key|secret|session|token)",
    re.IGNORECASE,
)
_BEARER = re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]+")
_PRIVATE_KEY = re.compile(
    r"-----BEGIN [^-]*PRIVATE KEY-----.*?-----END [^-]*PRIVATE KEY-----",
    re.DOTALL,
)


class CanonicalizationError(ValueError):
    """Raised when an action cannot be represented without ambiguity."""


def _canonical_value(value: Any) -> Any:
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise CanonicalizationError("Non-finite numbers are not valid proposal values.")
        return value
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, Mapping):
        normalized: dict[str, Any] = {}
        for key, item in value.items():
            if not isinstance(key, str):
                raise CanonicalizationError("Proposal object keys must be strings.")
            normalized[key] = _canonical_value(item)
        return normalized
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        return [_canonical_value(item) for item in value]
    raise CanonicalizationError(f"Unsupported proposal value type: {type(value).__name__}")


def canonical_json(value: Any) -> str:
    """Return stable, type-preserving JSON for security decisions."""

    return json.dumps(
        _canonical_value(value),
        ensure_ascii=False,
        allow_nan=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def canonical_digest(value: Any) -> str:
    return "sha256:" + hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def redact_for_display(value: Any, key: str = "") -> Any:
    """Create bounded UI/audit data without changing authorization identity."""

    if _SECRET_KEY.search(key):
        return "[REDACTED]"
    if isinstance(value, Mapping):
        return {str(item_key): redact_for_display(item, str(item_key)) for item_key, item in value.items()}
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        return [redact_for_display(item, key) for item in list(value)[:100]]
    if isinstance(value, str):
        cleaned = _PRIVATE_KEY.sub("[REDACTED PRIVATE KEY]", value)
        cleaned = _BEARER.sub("Bearer [REDACTED]", cleaned)
        return cleaned if len(cleaned) <= 4096 else cleaned[:4096] + "...[TRUNCATED]"
    return value


@dataclass(frozen=True)
class ActionProposal:
    proposal_id: str
    run_id: str
    operation: str
    payload_digest: str
    display_payload: Mapping[str, Any]
    risk: str
    required_capabilities: frozenset[str] = field(default_factory=frozenset)
    effect_categories: frozenset[str] = field(default_factory=frozenset)

    @classmethod
    def create(
        cls,
        *,
        proposal_id: str,
        run_id: str,
        operation: str,
        payload: Mapping[str, Any],
        risk: str,
        required_capabilities: Sequence[str] = (),
        effect_categories: Sequence[str] = (),
    ) -> "ActionProposal":
        if not proposal_id or not run_id or not operation:
            raise ValueError("Proposal identity, Run identity and operation are required.")
        return cls(
            proposal_id=proposal_id,
            run_id=run_id,
            operation=operation,
            payload_digest=canonical_digest(payload),
            display_payload=redact_for_display(payload),
            risk=risk,
            required_capabilities=frozenset(required_capabilities),
            effect_categories=frozenset(effect_categories),
        )

    def matches_payload(self, payload: Mapping[str, Any]) -> bool:
        return self.payload_digest == canonical_digest(payload)


@dataclass(frozen=True)
class ResolvedCapabilityProfile:
    profile_id: str
    version: int
    workspace_root: str
    capabilities: frozenset[str]
    writable_roots: tuple[str, ...] = ()
    network_rules: tuple[str, ...] = ()
    credential_refs: frozenset[str] = field(default_factory=frozenset)
    hard_denies: frozenset[str] = field(default_factory=frozenset)
    trusted_workspace: bool = False

    def as_security_payload(self) -> dict[str, Any]:
        return {
            "profile_id": self.profile_id,
            "version": self.version,
            "workspace_root": self.workspace_root,
            "capabilities": sorted(self.capabilities),
            "writable_roots": list(self.writable_roots),
            "network_rules": list(self.network_rules),
            "credential_refs": sorted(self.credential_refs),
            "hard_denies": sorted(self.hard_denies),
            "trusted_workspace": self.trusted_workspace,
        }

    @property
    def digest(self) -> str:
        return canonical_digest(self.as_security_payload())

    def permits(self, proposal: ActionProposal) -> bool:
        return (
            proposal.operation not in self.hard_denies
            and not proposal.effect_categories.intersection(self.hard_denies)
            and proposal.required_capabilities.issubset(self.capabilities)
        )
