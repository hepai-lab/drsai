from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Mapping
from collections import defaultdict, deque
import time

from drsai.backend.runtime.artifacts import RuntimeArtifactError, RuntimeArtifactStore
from drsai.backend.workspace.paths import WorkspacePathError, resolve_workspace_path


@dataclass(frozen=True)
class TenantArtifactContext:
    """Immutable server-side identity bound to one Artifact operation."""

    tenant_id: str
    principal_id: str
    workspace_id: str
    session_id: str
    run_id: str

    def __post_init__(self) -> None:
        if not all((self.tenant_id, self.principal_id, self.workspace_id, self.session_id, self.run_id)):
            raise RuntimeArtifactError("artifact_access_denied", "Artifact security context is incomplete")


class TenantFilesystemArtifactHost:
    """Reference multi-tenant Artifact Host Adapter for services such as DocMaster.

    Tenant databases and payload roots are physically separated.  Every
    operation re-authorizes the principal and scopes lookup by tenant plus
    Workspace; an Artifact ID alone is never an access credential.
    """

    def __init__(
        self,
        state_root: Path,
        workspace_root: Callable[[str, str], Path],
        authorize: Callable[[str, str, str, str], bool],
        *,
        max_file_bytes: int = 256 * 1024 * 1024,
        max_artifacts_per_run: int = 32,
        max_tenant_bytes: int | None = None,
        max_deliveries_per_minute: int | None = None,
        admit: Callable[[TenantArtifactContext, str, Mapping[str, Any]], bool] | None = None,
        scan: Callable[[TenantArtifactContext, Path, str], bool] | None = None,
    ) -> None:
        self._state_root = Path(state_root).resolve()
        self._state_root.mkdir(parents=True, exist_ok=True)
        self._workspace_root = workspace_root
        self._authorize = authorize
        self._max_file_bytes = max_file_bytes
        self._max_artifacts_per_run = max_artifacts_per_run
        self._max_tenant_bytes = max_tenant_bytes
        self._max_deliveries_per_minute = max_deliveries_per_minute
        self._admit = admit
        self._scan = scan
        self._stores: dict[str, RuntimeArtifactStore] = {}
        self._delivery_times: dict[str, deque[float]] = defaultdict(deque)

    def deliver(self, context: TenantArtifactContext, arguments: Mapping[str, Any]) -> dict[str, Any]:
        self._require(context, "artifact.write")
        store = self._store(context.tenant_id)
        if arguments.get("idempotency_key") is not None:
            replay = store.replay(context, str(arguments["idempotency_key"]))
            if replay is not None:
                return replay
        self._enforce_rate(context.tenant_id)
        if self._admit is not None and self._admit(context, "artifact.write", arguments) is not True:
            raise RuntimeArtifactError("artifact_quota_exceeded", "Tenant Artifact admission was denied")
        source = self._source(context, arguments)
        declared_mime = str(arguments.get("mime_type") or "")
        self._validate_mime(source, str(arguments.get("destination_name") or source.name), declared_mime)
        if self._scan is not None and self._scan(context, source, declared_mime) is not True:
            raise RuntimeArtifactError("artifact_source_invalid", "Artifact content validation failed")
        return store.deliver(context, arguments)

    def _enforce_rate(self, tenant_id: str) -> None:
        if self._max_deliveries_per_minute is None:
            return
        now = time.monotonic()
        window = self._delivery_times[tenant_id]
        while window and window[0] <= now - 60:
            window.popleft()
        if len(window) >= max(1, self._max_deliveries_per_minute):
            raise RuntimeArtifactError("artifact_quota_exceeded", "Tenant Artifact rate limit was reached")
        window.append(now)

    def metadata(self, context: TenantArtifactContext, artifact_id: str) -> dict[str, Any]:
        self._require(context, "artifact.read")
        return self._store(context.tenant_id).metadata(context.workspace_id, artifact_id)

    def chunk(self, context: TenantArtifactContext, artifact_id: str, offset: int, length: int) -> dict[str, Any]:
        self._require(context, "artifact.read")
        return self._store(context.tenant_id).chunk(context.workspace_id, artifact_id, offset, length)

    def _require(self, context: TenantArtifactContext, action: str) -> None:
        try:
            allowed = self._authorize(
                context.tenant_id, context.principal_id, context.workspace_id, action,
            )
        except Exception as exc:
            raise RuntimeArtifactError("artifact_access_denied", "Artifact access was denied") from exc
        if allowed is not True:
            raise RuntimeArtifactError("artifact_access_denied", "Artifact access was denied")

    def _source(self, context: TenantArtifactContext, arguments: Mapping[str, Any]) -> Path:
        root = Path(self._workspace_root(context.tenant_id, context.workspace_id)).resolve(strict=True)
        try:
            source = resolve_workspace_path(root, str(arguments.get("source_path") or ""), strict=True)
        except (WorkspacePathError, OSError) as exc:
            raise RuntimeArtifactError("artifact_source_invalid", "Artifact source is invalid") from exc
        if not source.is_file():
            raise RuntimeArtifactError("artifact_source_invalid", "Artifact source must be a regular file")
        return source

    @staticmethod
    def _validate_mime(source: Path, destination_name: str, declared_mime: str) -> None:
        """Reject an explicit media type that contradicts both file extensions."""
        if not declared_mime:
            return
        import mimetypes

        source_mime = mimetypes.guess_type(source.name)[0]
        destination_mime = mimetypes.guess_type(destination_name)[0]
        known = {value for value in (source_mime, destination_mime) if value}
        if known and declared_mime not in known:
            raise RuntimeArtifactError("artifact_source_invalid", "Artifact MIME type does not match its extension")

    def _store(self, tenant_id: str) -> RuntimeArtifactStore:
        # Tenant IDs never become paths directly; the digest prevents path
        # traversal and avoids leaking account identifiers in host storage.
        import hashlib

        tenant_key = hashlib.sha256(tenant_id.encode("utf-8")).hexdigest()
        store = self._stores.get(tenant_key)
        if store is None:
            tenant_state = self._state_root / "tenants" / tenant_key
            store = RuntimeArtifactStore(
                tenant_state / "artifacts.sqlite3",
                lambda workspace_id, bound_tenant=tenant_id: self._workspace_root(bound_tenant, workspace_id),
                max_file_bytes=self._max_file_bytes,
                max_artifacts_per_run=self._max_artifacts_per_run,
                max_total_bytes=self._max_tenant_bytes,
            )
            self._stores[tenant_key] = store
        return store
