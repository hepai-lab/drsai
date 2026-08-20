"""System hard-deny rules that no Approval or permission mode can override."""

from __future__ import annotations

import re
import shlex
from dataclasses import dataclass
from pathlib import PurePath
from typing import Any, Mapping, Sequence

from .models import ActionProposal


HARD_DENY_POLICY_VERSION = "hard-deny/1"
MANDATORY_HARD_DENIES = frozenset({
    "security_control_tampering",
    "credential_theft",
    "host_persistence",
    "cross_process_injection",
    "audit_disable",
    "host_control_plane",
})

_OPERATION_RULES = {
    "security.policy.modify": "security_control_tampering",
    "security.boundary.disable": "security_control_tampering",
    "credential.export": "credential_theft",
    "credential.dump": "credential_theft",
    "host.persistence.install": "host_persistence",
    "process.inject": "cross_process_injection",
    "audit.disable": "audit_disable",
    "audit.delete": "audit_disable",
    "host.control_plane.access": "host_control_plane",
}


class HardDenyError(PermissionError):
    def __init__(self, category: str, reason_code: str):
        super().__init__(f"Operation is blocked by mandatory policy: {category}")
        self.code = "hard_deny"
        self.category = category
        self.reason_code = reason_code
        self.policy_version = HARD_DENY_POLICY_VERSION


@dataclass(frozen=True)
class HardDenyDecision:
    denied: bool
    category: str | None
    reason_code: str
    policy_version: str = HARD_DENY_POLICY_VERSION


def _command_argv(payload: Mapping[str, Any]) -> tuple[str, ...]:
    value: Any = payload.get("command")
    arguments = payload.get("arguments")
    if value is None and isinstance(arguments, Mapping):
        value = arguments.get("command")
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        return tuple(str(item) for item in value)
    if isinstance(value, str):
        try:
            return tuple(shlex.split(value, posix=False))
        except ValueError:
            return ()
    return ()


def infer_effect_categories(operation: str, payload: Mapping[str, Any]) -> frozenset[str]:
    """Conservative defense-in-depth inference; declared categories remain authoritative."""

    categories: set[str] = set()
    normalized_operation = operation.strip().lower()
    mapped = _OPERATION_RULES.get(normalized_operation)
    if mapped:
        categories.add(mapped)
    argv = _command_argv(payload)
    if not argv:
        return frozenset(categories)
    executable = PurePath(argv[0].strip('"')).name.lower()
    lowered = [part.strip('"').lower() for part in argv[1:]]
    joined = " ".join(lowered)
    if executable in {"schtasks", "schtasks.exe"} and any(item in {"/create", "/change"} for item in lowered):
        categories.add("host_persistence")
    if executable in {"sc", "sc.exe"} and any(item in {"create", "config"} for item in lowered):
        categories.add("host_persistence")
    if executable in {"reg", "reg.exe"} and "add" in lowered and re.search(r"\\run(?:once)?(?:\\|\s|$)", joined):
        categories.add("host_persistence")
    if executable in {"wevtutil", "wevtutil.exe"} and "cl" in lowered:
        categories.add("audit_disable")
    if executable in {"auditpol", "auditpol.exe"} and any(item.startswith("/clear") for item in lowered):
        categories.add("audit_disable")
    if executable in {"procdump", "procdump.exe", "procdump64.exe"} and "lsass" in joined:
        categories.add("credential_theft")
    if executable in {"mimikatz", "mimikatz.exe"}:
        categories.add("credential_theft")
    return frozenset(categories)


class HardDenyPolicy:
    def evaluate(self, proposal: ActionProposal) -> HardDenyDecision:
        categories = proposal.effect_categories.intersection(MANDATORY_HARD_DENIES)
        if categories:
            category = sorted(categories)[0]
            return HardDenyDecision(True, category, "declared_effect_category")
        mapped = _OPERATION_RULES.get(proposal.operation.strip().lower())
        if mapped:
            return HardDenyDecision(True, mapped, "protected_operation")
        # Display payload is suitable only for non-secret command inference.
        # Secret-bearing fields are redacted, and category declarations remain
        # required for semantic cases that cannot be determined structurally.
        inferred = infer_effect_categories(proposal.operation, proposal.display_payload)
        mandatory = inferred.intersection(MANDATORY_HARD_DENIES)
        if mandatory:
            category = sorted(mandatory)[0]
            return HardDenyDecision(True, category, "deterministic_command_rule")
        return HardDenyDecision(False, None, "not_hard_denied")

    def enforce(self, proposal: ActionProposal) -> None:
        decision = self.evaluate(proposal)
        if decision.denied and decision.category is not None:
            raise HardDenyError(decision.category, decision.reason_code)

