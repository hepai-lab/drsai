"""Reference multi-tenant OAEP/OWOP Resource Host for server products.

Services such as DocMaster can supply their own object-store implementation,
but this filesystem adapter defines the security boundary: a ResourceRef is a
locator, never a bearer credential.  Every operation is rebound to the current
tenant, principal, and Workspace and is authorized again at access time.
"""

from __future__ import annotations

import hashlib
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterator, Mapping

from drsai.owop.local_workspace import LocalWorkspaceOperations, WorkspaceWatchJournal
from drsai.owop.protocol import OWOPError


@dataclass(frozen=True)
class TenantResourceContext:
    tenant_id: str
    principal_id: str
    workspace_id: str
    session_id: str

    def __post_init__(self) -> None:
        if not all((self.tenant_id, self.principal_id, self.workspace_id, self.session_id)):
            raise OWOPError("resource_access_denied", "Resource security context is incomplete.", "operation")


class TenantFilesystemResourceHost:
    """Durable, tenant-isolated file Resource Host Adapter.

    ``workspace_root`` is the service-owned mapping from tenant/Workspace ids to
    storage.  ``authorize`` must return exactly ``True`` for granted actions.
    Resource ids are stored in a tenant-specific database and are additionally
    scoped by Workspace id, so guessing an id from another scope is harmless.
    """

    _PURPOSE_ACTIONS = {
        "read": "resource.read",
        "preview": "resource.preview",
        "download": "resource.download",
    }

    def __init__(
        self,
        state_root: Path,
        workspace_root: Callable[[str, str], Path],
        authorize: Callable[[str, str, str, str], bool],
    ) -> None:
        self._state_root = Path(state_root).resolve()
        self._state_root.mkdir(parents=True, exist_ok=True)
        self._workspace_root = workspace_root
        self._authorize = authorize

    def register(self, context: TenantResourceContext, arguments: Mapping[str, Any]) -> dict[str, Any]:
        self._require(context, "resource.register")
        params: dict[str, Any] = {"path": str(arguments.get("path") or "")}
        if arguments.get("expected_digest"):
            params["expected_digest"] = str(arguments["expected_digest"])
        with self._operations(context) as operations:
            resource = operations.register_file(params)["resource"]
        return {"resource": self._with_capabilities(context, resource)}

    def resolve(self, context: TenantResourceContext, file_id: str, *, expected_digest: str | None = None) -> dict[str, Any]:
        self._require(context, "resource.resolve")
        params: dict[str, Any] = {"file_id": file_id}
        if expected_digest:
            params["expected_digest"] = expected_digest
        with self._operations(context) as operations:
            resource = operations.resolve_file(params)["resource"]
        return {"resource": self._with_capabilities(context, resource)}

    def read(
        self,
        context: TenantResourceContext,
        file_id: str,
        offset: int,
        length: int,
        *,
        purpose: str = "read",
        expected_digest: str | None = None,
    ) -> dict[str, Any]:
        action = self._PURPOSE_ACTIONS.get(purpose)
        if action is None:
            raise OWOPError("resource_purpose_invalid", "Resource read purpose is invalid.", "operation")
        self._require(context, action)
        if offset < 0 or length < 1 or length > 8 * 1024 * 1024:
            raise OWOPError("resource_range_invalid", "Resource read range is invalid.", "operation")
        params: dict[str, Any] = {"file_id": file_id}
        if expected_digest:
            params["expected_digest"] = expected_digest
        with self._operations(context) as operations:
            resource = operations.resolve_file(params)["resource"]
            if resource["state"] == "deleted":
                raise OWOPError("resource_not_found", "File resource is unavailable.", "operation")
            if expected_digest and resource["state"] == "changed":
                raise OWOPError("resource_changed", "File resource changed before it was read.", "operation")
            if resource["kind"] != "file":
                raise OWOPError("resource_not_readable", "Resource is not a regular file.", "operation")
            result = operations.read_file({"path": resource["path"], "offset": offset, "length": length})
        return {"file_id": file_id, "state": resource["state"], **result}

    def resource_ref(
        self,
        context: TenantResourceContext,
        resource: Mapping[str, Any],
        *,
        relation: str,
        presentation: str,
    ) -> dict[str, Any]:
        reference: dict[str, Any] = {
            "protocol": "owop/1",
            "workspace_id": context.workspace_id,
            "resource_type": "file",
            "resource_id": str(resource["file_id"]),
            "label": str(resource.get("name") or resource["file_id"]),
            "relation": relation,
            "presentation": presentation,
        }
        if resource.get("digest"):
            reference["digest"] = str(resource["digest"])
        return reference

    def _with_capabilities(self, context: TenantResourceContext, resource: Mapping[str, Any]) -> dict[str, Any]:
        result = dict(resource)
        available = result.get("state") != "deleted" and result.get("kind") == "file"
        result["capabilities"] = {
            "read": available and self._allowed(context, "resource.read"),
            "preview": available and bool(resource.get("capabilities", {}).get("preview")) and self._allowed(context, "resource.preview"),
            "download": available and self._allowed(context, "resource.download"),
            "reveal": self._allowed(context, "resource.reveal"),
            # A server host never authorizes opening its filesystem path on a client.
            "open_external": False,
        }
        return result

    def _allowed(self, context: TenantResourceContext, action: str) -> bool:
        try:
            return self._authorize(
                context.tenant_id,
                context.principal_id,
                context.workspace_id,
                action,
            ) is True
        except Exception:
            return False

    def _require(self, context: TenantResourceContext, action: str) -> None:
        if not self._allowed(context, action):
            raise OWOPError("resource_access_denied", "Resource access was denied.", "operation")

    @contextmanager
    def _operations(self, context: TenantResourceContext) -> Iterator[LocalWorkspaceOperations]:
        try:
            root = Path(self._workspace_root(context.tenant_id, context.workspace_id)).resolve(strict=True)
        except Exception as exc:
            raise OWOPError("resource_access_denied", "Resource Workspace is unavailable.", "operation") from exc
        tenant_key = hashlib.sha256(context.tenant_id.encode("utf-8")).hexdigest()
        journal = WorkspaceWatchJournal(self._state_root / "tenants" / tenant_key / "workspace-events.sqlite3")
        operations = LocalWorkspaceOperations(context.workspace_id, root, journal)
        try:
            yield operations
        finally:
            operations.close()
