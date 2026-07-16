"""Transport-neutral Worktree and Terminal resource contracts."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping
import re


WORKTREE_STATUSES = frozenset({
    "creating", "active", "review", "merge_pending", "merged", "archived", "removing", "removed",
})
TERMINAL_STATUSES = frozenset({"starting", "running", "detached", "reconnecting", "exited", "lost"})

WORKTREE_TRANSITIONS = {
    "creating": frozenset({"active", "archived", "removing"}),
    "active": frozenset({"review", "merge_pending", "archived", "removing"}),
    "review": frozenset({"active", "merge_pending", "merged", "archived", "removing"}),
    "merge_pending": frozenset({"active", "review", "merged", "archived", "removing"}),
    "merged": frozenset({"removing"}),
    "archived": frozenset({"active", "removing"}),
    "removing": frozenset({"removed"}),
    "removed": frozenset(),
}
TERMINAL_TRANSITIONS = {
    "starting": frozenset({"running", "exited", "lost"}),
    "running": frozenset({"detached", "reconnecting", "exited", "lost"}),
    "detached": frozenset({"running", "reconnecting", "exited", "lost"}),
    "reconnecting": frozenset({"running", "detached", "exited", "lost"}),
    "exited": frozenset(),
    "lost": frozenset(),
}

_ID_PATTERNS = {
    "worktree": re.compile(r"^worktree-[A-Za-z0-9][A-Za-z0-9-]{0,127}$"),
    "terminal": re.compile(r"^terminal-[A-Za-z0-9][A-Za-z0-9-]{0,127}$"),
    "terminal_lease": re.compile(r"^terminal-lease-[A-Za-z0-9][A-Za-z0-9-]{0,127}$"),
    "host_profile": re.compile(r"^host-profile-[A-Za-z0-9][A-Za-z0-9-]{0,127}$"),
    "port_forward": re.compile(r"^port-forward-[A-Za-z0-9][A-Za-z0-9-]{0,127}$"),
}


class WorkspaceResourceError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def is_resource_id(kind: str, value: object) -> bool:
    pattern = _ID_PATTERNS.get(kind)
    return bool(pattern and isinstance(value, str) and pattern.fullmatch(value))


def can_transition_worktree(source: str, target: str) -> bool:
    return source == target or target in WORKTREE_TRANSITIONS.get(source, ())


def can_transition_terminal(source: str, target: str) -> bool:
    return source == target or target in TERMINAL_TRANSITIONS.get(source, ())


def terminal_status_after_transport_loss(status: str) -> str:
    return "reconnecting" if status in {"running", "detached", "reconnecting"} else status


@dataclass(frozen=True)
class WorktreeResource:
    worktree_id: str
    source_workspace_id: str
    workspace_id: str
    repo_root: str
    canonical_path: str
    branch: str
    base_commit: str
    status: str
    location: str
    created_at: str
    updated_at: str

    def __post_init__(self) -> None:
        if not is_resource_id("worktree", self.worktree_id):
            raise WorkspaceResourceError("worktree_id_invalid", "Worktree ID is invalid.")
        if not all((self.source_workspace_id, self.workspace_id, self.repo_root, self.canonical_path, self.branch, self.base_commit, self.created_at, self.updated_at)):
            raise WorkspaceResourceError("worktree_resource_invalid", "Worktree fields must be non-empty strings.")
        if self.source_workspace_id == self.workspace_id:
            raise WorkspaceResourceError("worktree_workspace_identity_invalid", "Worktree Workspace must differ from its Source Workspace.")
        if self.status not in WORKTREE_STATUSES:
            raise WorkspaceResourceError("worktree_status_invalid", "Worktree status is invalid.")
        if self.location not in {"local", "remote"}:
            raise WorkspaceResourceError("worktree_location_invalid", "Worktree location is invalid.")

    def as_dict(self) -> dict[str, Any]:
        return {
            "worktreeId": self.worktree_id,
            "sourceWorkspaceId": self.source_workspace_id,
            "workspaceId": self.workspace_id,
            "repoRoot": self.repo_root,
            "canonicalPath": self.canonical_path,
            "branch": self.branch,
            "baseCommit": self.base_commit,
            "status": self.status,
            "location": self.location,
            "createdAt": self.created_at,
            "updatedAt": self.updated_at,
        }

    @classmethod
    def from_dict(cls, raw: Mapping[str, Any]) -> "WorktreeResource":
        allowed = {"worktreeId", "sourceWorkspaceId", "workspaceId", "repoRoot", "canonicalPath", "branch", "baseCommit", "status", "location", "createdAt", "updatedAt"}
        _require_exact_fields(raw, allowed, allowed)
        return cls(*(str(raw[key]) for key in ("worktreeId", "sourceWorkspaceId", "workspaceId", "repoRoot", "canonicalPath", "branch", "baseCommit", "status", "location", "createdAt", "updatedAt")))


@dataclass(frozen=True)
class TerminalResource:
    terminal_id: str
    runtime_id: str
    workspace_id: str
    status: str
    generation: int
    last_sequence: int
    created_at: str
    worktree_id: str | None = None
    exited_at: str | None = None

    def __post_init__(self) -> None:
        if not is_resource_id("terminal", self.terminal_id):
            raise WorkspaceResourceError("terminal_id_invalid", "Terminal ID is invalid.")
        if not self.runtime_id or not self.workspace_id or not self.created_at:
            raise WorkspaceResourceError("terminal_resource_invalid", "Terminal identity fields are required.")
        if self.worktree_id is not None and not is_resource_id("worktree", self.worktree_id):
            raise WorkspaceResourceError("terminal_worktree_id_invalid", "Terminal Worktree ID is invalid.")
        if self.status not in TERMINAL_STATUSES:
            raise WorkspaceResourceError("terminal_status_invalid", "Terminal status is invalid.")
        if isinstance(self.generation, bool) or not isinstance(self.generation, int) or self.generation < 1:
            raise WorkspaceResourceError("terminal_generation_invalid", "Terminal generation must be positive.")
        if isinstance(self.last_sequence, bool) or not isinstance(self.last_sequence, int) or self.last_sequence < 0:
            raise WorkspaceResourceError("terminal_sequence_invalid", "Terminal sequence must be non-negative.")

    def as_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "terminalId": self.terminal_id,
            "runtimeId": self.runtime_id,
            "workspaceId": self.workspace_id,
            "status": self.status,
            "generation": self.generation,
            "lastSequence": self.last_sequence,
            "createdAt": self.created_at,
        }
        if self.worktree_id is not None:
            result["worktreeId"] = self.worktree_id
        if self.exited_at is not None:
            result["exitedAt"] = self.exited_at
        return result

    @classmethod
    def from_dict(cls, raw: Mapping[str, Any]) -> "TerminalResource":
        required = {"terminalId", "runtimeId", "workspaceId", "status", "generation", "lastSequence", "createdAt"}
        allowed = required | {"worktreeId", "exitedAt"}
        _require_exact_fields(raw, allowed, required)
        return cls(
            terminal_id=str(raw["terminalId"]), runtime_id=str(raw["runtimeId"]), workspace_id=str(raw["workspaceId"]),
            status=str(raw["status"]), generation=raw["generation"], last_sequence=raw["lastSequence"], created_at=str(raw["createdAt"]),
            worktree_id=str(raw["worktreeId"]) if raw.get("worktreeId") is not None else None,
            exited_at=str(raw["exitedAt"]) if raw.get("exitedAt") is not None else None,
        )


def _require_exact_fields(raw: Mapping[str, Any], allowed: set[str], required: set[str]) -> None:
    if set(raw) - allowed or required - set(raw):
        raise WorkspaceResourceError("workspace_resource_shape_invalid", "Workspace resource fields are invalid.")
