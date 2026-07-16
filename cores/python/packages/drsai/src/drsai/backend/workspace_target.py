"""Transport-neutral Workspace Target schema shared by Local and Remote Runtime flows."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping


class WorkspaceTargetError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class WorkspaceConnectionMetadata:
    location: str
    transport: str
    runtime_id: str | None = None
    instance_id: str | None = None
    host_alias: str | None = None

    def __post_init__(self) -> None:
        if self.location == "local":
            if self.transport != "in-process" or self.host_alias is not None:
                raise WorkspaceTargetError(
                    "workspace_transport_invalid",
                    "Local Workspace must use in-process transport and cannot contain SSH metadata.",
                )
        elif self.location == "remote":
            if self.transport != "ssh" or not self.host_alias:
                raise WorkspaceTargetError(
                    "workspace_transport_invalid",
                    "Remote Workspace must use SSH transport with a host alias.",
                )
        else:
            raise WorkspaceTargetError("workspace_location_invalid", "Workspace location must be local or remote.")

    def as_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {"location": self.location, "transport": self.transport}
        for key, value in (
            ("runtimeId", self.runtime_id),
            ("instanceId", self.instance_id),
            ("hostAlias", self.host_alias),
        ):
            if value is not None:
                result[key] = value
        return result

    @classmethod
    def from_dict(cls, raw: Mapping[str, Any]) -> "WorkspaceConnectionMetadata":
        allowed = {"location", "transport", "runtimeId", "instanceId", "hostAlias"}
        if set(raw) - allowed:
            raise WorkspaceTargetError("workspace_target_invalid", "Workspace connection contains unknown fields.")
        return cls(
            location=str(raw.get("location") or ""),
            transport=str(raw.get("transport") or ""),
            runtime_id=_optional_string(raw.get("runtimeId")),
            instance_id=_optional_string(raw.get("instanceId")),
            host_alias=_optional_string(raw.get("hostAlias")),
        )


@dataclass(frozen=True)
class WorkspaceTarget:
    workspace_id: str
    canonical_path: str
    connection: WorkspaceConnectionMetadata

    def __post_init__(self) -> None:
        if not self.workspace_id or not self.canonical_path:
            raise WorkspaceTargetError("workspace_target_invalid", "Workspace identity and canonical path are required.")

    def as_dict(self) -> dict[str, Any]:
        return {
            "workspaceId": self.workspace_id,
            "canonicalPath": self.canonical_path,
            "connection": self.connection.as_dict(),
        }

    @classmethod
    def from_dict(cls, raw: Mapping[str, Any]) -> "WorkspaceTarget":
        allowed = {"workspaceId", "canonicalPath", "connection"}
        if set(raw) - allowed or not isinstance(raw.get("connection"), Mapping):
            raise WorkspaceTargetError("workspace_target_invalid", "Workspace Target shape is invalid.")
        return cls(
            workspace_id=str(raw.get("workspaceId") or ""),
            canonical_path=str(raw.get("canonicalPath") or ""),
            connection=WorkspaceConnectionMetadata.from_dict(raw["connection"]),
        )


@dataclass(frozen=True)
class AgentBackendMetadata:
    backend_id: str
    backend_version: str | None = None

    def __post_init__(self) -> None:
        if self.backend_id not in {"opendrsai", "codex"}:
            raise WorkspaceTargetError("agent_backend_invalid", "Agent Backend must be opendrsai or codex.")

    def as_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {"backendId": self.backend_id}
        if self.backend_version is not None:
            result["backendVersion"] = self.backend_version
        return result


@dataclass(frozen=True)
class WorkspaceExecutionTarget:
    workspace: WorkspaceTarget
    agent_backend: AgentBackendMetadata

    def as_dict(self) -> dict[str, Any]:
        return {"workspace": self.workspace.as_dict(), "agentBackend": self.agent_backend.as_dict()}


def _optional_string(value: Any) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or not value:
        raise WorkspaceTargetError("workspace_target_invalid", "Optional Workspace metadata must be a non-empty string.")
    return value
