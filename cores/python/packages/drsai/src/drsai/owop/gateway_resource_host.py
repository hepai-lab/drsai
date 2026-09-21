"""Production ResourceHost adapter for Runtime Workspace files and Artifacts."""

from __future__ import annotations

import base64
import binascii
from datetime import datetime, timezone
from typing import Any

from drsai.backend.runtime.artifacts import RuntimeArtifactError, RuntimeArtifactStore
from drsai.owop.local_workspace import LocalWorkspaceOperations
from drsai.owop.protocol import OWOPError
from drsai.owop.resource_service import HostResourceVersion, ResourceServiceError


class GatewayResourceHost:
    """Resolve opaque ``file:``/``artifact:`` handles without exporting paths."""

    is_local = True

    def __init__(
        self,
        workspace_id: str,
        files: LocalWorkspaceOperations,
        artifacts: RuntimeArtifactStore,
    ) -> None:
        self.workspace_id = workspace_id
        self.files = files
        self.artifacts = artifacts

    @staticmethod
    def _handle(handle: str) -> tuple[str, str]:
        kind, separator, opaque_id = handle.partition(":")
        if separator != ":" or kind not in {"file", "artifact"} or not opaque_id:
            raise ResourceServiceError("resource_not_found")
        return kind, opaque_id

    @staticmethod
    def _version_id(digest: str) -> str:
        if not digest.startswith("sha256:") or len(digest) != 71:
            raise ResourceServiceError("integrity_mismatch", retryable=True)
        return f"version-{digest[7:]}"

    def _file(self, file_id: str) -> dict[str, Any]:
        try:
            descriptor = self.files.resolve_file({"file_id": file_id})["resource"]
        except (OWOPError, KeyError) as exc:
            raise ResourceServiceError("resource_not_found") from exc
        if descriptor.get("state") == "deleted" or descriptor.get("kind") != "file":
            raise ResourceServiceError("resource_not_found")
        return descriptor

    def _artifact(self, artifact_id: str) -> dict[str, Any]:
        try:
            return self.artifacts.metadata(self.workspace_id, artifact_id)
        except RuntimeArtifactError as exc:
            raise ResourceServiceError("resource_not_found") from exc

    def describe(self, _tenant_id: str, handle: str) -> HostResourceVersion:
        kind, opaque_id = self._handle(handle)
        if kind == "file":
            item = self._file(opaque_id)
            digest = str(item.get("digest") or "")
            modified = datetime.fromtimestamp(
                int(item.get("modified_ns") or 0) / 1_000_000_000,
                tz=timezone.utc,
            ).isoformat()
            return HostResourceVersion(
                version_id=self._version_id(digest), digest=digest,
                size=int(item["size"]), mime_type=item.get("mime_type"),
                modified_at=modified, object_identity=f"file:{opaque_id}",
                display_name=str(item.get("name") or opaque_id),
                logical_path=str(item.get("path") or "") or None,
            )
        item = self._artifact(opaque_id)
        digest = f"sha256:{item['sha256']}"
        return HostResourceVersion(
            version_id=self._version_id(digest), digest=digest,
            size=int(item["size"]), mime_type=item.get("mime_type"),
            modified_at=str(item.get("created_at") or datetime.now(timezone.utc).isoformat()),
            object_identity=f"artifact:{opaque_id}",
            display_name=str(item.get("display_name") or item.get("name") or opaque_id),
            logical_path=None,
        )

    def read_version(self, tenant_id: str, handle: str, version_id: str) -> bytes:
        current = self.describe(tenant_id, handle)
        if current.version_id != version_id:
            raise ResourceServiceError("resource_version_conflict")
        kind, opaque_id = self._handle(handle)
        if kind == "file":
            item = self._file(opaque_id)
            try:
                result = self.files.read_file({"path": item["path"], "offset": 0, "length": int(item["size"]) + 1})
                data = base64.b64decode(str(result["content_base64"]), validate=True)
            except (OWOPError, KeyError, ValueError, binascii.Error) as exc:
                raise ResourceServiceError("integrity_mismatch", retryable=True) from exc
        else:
            chunks: list[bytes] = []
            offset = 0
            while offset < current.size:
                try:
                    result = self.artifacts.chunk(
                        self.workspace_id, opaque_id, offset, min(1024 * 1024, current.size - offset),
                    )
                    chunk = base64.b64decode(str(result["content_base64"]), validate=True)
                except (RuntimeArtifactError, KeyError, ValueError, binascii.Error) as exc:
                    raise ResourceServiceError("integrity_mismatch", retryable=True) from exc
                if not chunk:
                    raise ResourceServiceError("integrity_mismatch", retryable=True)
                chunks.append(chunk)
                offset += len(chunk)
            data = b"".join(chunks)
        # Re-resolve after the read to close the path/metadata TOCTOU window.
        if self.describe(tenant_id, handle).version_id != version_id:
            raise ResourceServiceError("resource_version_conflict")
        return data

    def capabilities(self, _tenant_id: str, handle: str) -> dict[str, bool]:
        kind, opaque_id = self._handle(handle)
        if kind == "file":
            item = self._file(opaque_id)
            preview = bool(item.get("capabilities", {}).get("preview"))
            return {
                "read_current": True, "read_snapshot": False, "preview": preview,
                "download": True, "reveal": True, "open_external": True,
                "copy_logical_path": True,
            }
        item = self._artifact(opaque_id)
        return {
            "read_current": True, "read_snapshot": True,
            "preview": bool(item.get("previewable")), "download": bool(item.get("downloadable")),
            "reveal": False, "open_external": False, "copy_logical_path": False,
        }

    def capabilities_for_version(
        self,
        tenant_id: str,
        handle: str,
        mime_type: str | None,
    ) -> dict[str, bool]:
        """Project file capabilities without a second file-index lookup.

        ResourceService already resolved the session grant and immutable version
        row in the current transaction. Local file capabilities are policy plus
        MIME, so another resolve_file/stat call cannot add authorization value.
        Artifact capabilities remain Host-owned and use the live metadata path.
        """
        kind, _ = self._handle(handle)
        if kind != "file":
            return self.capabilities(tenant_id, handle)
        mt = mime_type or ""
        preview = bool(
            mt.startswith("text/")
            or mt in {"application/json", "application/pdf"}
            or mt.startswith("application/vnd.openxmlformats-officedocument")
            or mt.startswith("application/vnd.ms-excel")
            or mt.startswith("application/vnd.ms-powerpoint")
            or mt.startswith("application/msword")
        )
        return {
            "read_current": True, "read_snapshot": False, "preview": preview,
            "download": True, "reveal": True, "open_external": True,
            "copy_logical_path": True,
        }
