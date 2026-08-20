"""Web/DocMaster resource actions over the shared OWOP ResourceService."""

from __future__ import annotations

import base64
import binascii
import hashlib
import threading
from dataclasses import dataclass
from typing import Any, Iterable, Mapping

from drsai.owop.object_storage_resource_host import TemporaryResourceUrlService
from drsai.owop.resource_service import ResourceAccessContext, ResourceService, ResourceServiceError
from drsai.owop.web_resource_preview import isolated_preview_headers


def _safe_filename(value: str) -> str:
    cleaned = "".join(character for character in value if character >= " " and character not in {'"', "\\", ";", "/"})
    return cleaned[:255] or "resource"


@dataclass(frozen=True)
class WebResourceBody:
    headers: Mapping[str, str]
    body: Iterable[bytes]


class WebResourceActionService:
    """Creates opaque action URLs and redeems them with request-time auth.

    The caller authenticates HTTP requests and supplies a ResourceAccessContext.
    Resource keys live only in the ticket table; they never enter the URL.
    """

    CHUNK_SIZE = 1024 * 1024

    def __init__(
        self,
        resources: ResourceService,
        tickets: TemporaryResourceUrlService,
        *,
        app_origin: str,
        preview_origin: str,
        max_concurrent_downloads_per_principal: int = 3,
        max_concurrent_downloads_per_workspace: int = 10,
    ) -> None:
        if max_concurrent_downloads_per_principal < 1 or max_concurrent_downloads_per_workspace < 1:
            raise ValueError("resource_download_concurrency_invalid")
        self.resources = resources
        self.tickets = tickets
        # Validate deployment transport and origin isolation for every action,
        # including downloads that do not otherwise construct preview headers.
        isolated_preview_headers(
            mime_type="text/plain", filename="resource",
            app_origin=app_origin, preview_origin=preview_origin,
        )
        self.app_origin = app_origin
        self.preview_origin = preview_origin
        self.max_concurrent = max_concurrent_downloads_per_principal
        self.max_workspace_concurrent = max_concurrent_downloads_per_workspace
        self._active: dict[tuple[str, str], int] = {}
        self._active_workspaces: dict[tuple[str, str], int] = {}
        self._lock = threading.Lock()

    def create_download_action(
        self, context: ResourceAccessContext, key: Mapping[str, Any], *, version_id: str, ttl_seconds: int = 300,
    ) -> dict[str, Any]:
        descriptor = self._descriptor(context, key, version_id)
        prepared = self.resources.download_prepare(context, key, version_id=version_id)
        url = self.tickets.issue(
            tenant_id=context.tenant_id, principal_id=context.principal_id,
            resource_id=str(key["resource_id"]), version_id=version_id, ttl_seconds=ttl_seconds,
            metadata={"kind": "download", "key": dict(key), "download_id": prepared["download_id"],
                      "size": prepared["size"], "digest": prepared["digest"],
                      "display_name": descriptor["display_name"],
                      "mime_type": descriptor["current_version"].get("mime_type")},
        )
        return {"kind": "download", "url": url, "expires_at": prepared["expires_at"],
                "size": prepared["size"], "version_id": version_id}

    def consume_download(self, context: ResourceAccessContext, url: str) -> WebResourceBody:
        principal = (context.tenant_id, context.principal_id)
        workspace = (context.tenant_id, context.workspace_id)
        self._acquire(principal, workspace)
        try:
            ticket = self.tickets.consume_bound(url, tenant_id=context.tenant_id, principal_id=context.principal_id)
            if ticket.get("kind") != "download":
                raise ResourceServiceError("resource_not_found")
            # Re-resolve before returning response headers. This applies current
            # grants and authorization policy after a URL has been issued.
            self._descriptor(context, ticket["key"], str(ticket["version_id"]))
        except Exception:
            self._release(principal, workspace)
            raise

        filename = _safe_filename(str(ticket["display_name"]))
        headers = {
            "Content-Type": str(ticket.get("mime_type") or "application/octet-stream"),
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
            "Cache-Control": "private, no-store", "Content-Length": str(ticket["size"]),
        }
        return WebResourceBody(headers=headers, body=self._download_body(context, ticket, principal, workspace))

    def create_preview_action(
        self, context: ResourceAccessContext, key: Mapping[str, Any], *, version_id: str, ttl_seconds: int = 300,
    ) -> dict[str, Any]:
        descriptor = self._descriptor(context, key, version_id)
        self.resources.preview(context, key, version_id=version_id, accept_kinds=["text", "binary"],
                               max_bytes=ResourceService.MAX_PREVIEW)
        url = self.tickets.issue(
            tenant_id=context.tenant_id, principal_id=context.principal_id,
            resource_id=str(key["resource_id"]), version_id=version_id, ttl_seconds=ttl_seconds,
            metadata={"kind": "preview", "key": dict(key), "display_name": descriptor["display_name"]},
        )
        return {"kind": "preview", "url": url, "version_id": version_id}

    def consume_preview(self, context: ResourceAccessContext, url: str) -> WebResourceBody:
        ticket = self.tickets.consume_bound(url, tenant_id=context.tenant_id, principal_id=context.principal_id)
        if ticket.get("kind") != "preview":
            raise ResourceServiceError("resource_not_found")
        preview = self.resources.preview(
            context, ticket["key"], version_id=str(ticket["version_id"]),
            accept_kinds=["text", "binary"], max_bytes=ResourceService.MAX_PREVIEW,
        )
        try:
            content = base64.b64decode(preview["content_base64"], validate=True)
        except (ValueError, binascii.Error) as exc:
            raise ResourceServiceError("integrity_mismatch") from exc
        if f"sha256:{hashlib.sha256(content).hexdigest()}" != preview["digest"]:
            raise ResourceServiceError("integrity_mismatch")
        headers = isolated_preview_headers(
            mime_type=str(preview.get("mime_type") or "application/octet-stream"),
            filename=str(ticket["display_name"]), app_origin=self.app_origin, preview_origin=self.preview_origin,
        )
        return WebResourceBody(headers=headers, body=(content,))

    def _descriptor(self, context: ResourceAccessContext, key: Mapping[str, Any], version_id: str) -> Mapping[str, Any]:
        result = self.resources.resolve_batch(context, [{"resource": key, "observed_version_id": version_id}])["results"][0]
        if "error" in result:
            raise ResourceServiceError("resource_not_found")
        descriptor = result["descriptor"]
        versions = (descriptor.get("current_version"), descriptor.get("observed_version"))
        if version_id not in {version.get("version_id") for version in versions if isinstance(version, Mapping)}:
            raise ResourceServiceError("resource_not_found")
        return descriptor

    def _download_body(
        self, context: ResourceAccessContext, ticket: Mapping[str, Any], principal: tuple[str, str], workspace: tuple[str, str],
    ) -> Iterable[bytes]:
        def chunks() -> Iterable[bytes]:
            offset = 0
            digest = hashlib.sha256()
            try:
                while offset < int(ticket["size"]):
                    chunk = self.resources.download_chunk(
                        context, str(ticket["download_id"]), offset=offset,
                        length=min(self.CHUNK_SIZE, int(ticket["size"]) - offset),
                    )
                    if int(chunk["offset"]) != offset or int(chunk["length"]) < 1:
                        raise ResourceServiceError("integrity_mismatch")
                    try:
                        content = base64.b64decode(chunk["content_base64"], validate=True)
                    except (ValueError, binascii.Error) as exc:
                        raise ResourceServiceError("integrity_mismatch") from exc
                    if len(content) != int(chunk["length"]) or f"sha256:{hashlib.sha256(content).hexdigest()}" != chunk["chunk_digest"]:
                        raise ResourceServiceError("integrity_mismatch")
                    offset += len(content)
                    digest.update(content)
                    yield content
                if offset != int(ticket["size"]) or f"sha256:{digest.hexdigest()}" != ticket["digest"]:
                    raise ResourceServiceError("integrity_mismatch")
            finally:
                try:
                    self.resources.download_cancel(context, str(ticket["download_id"]))
                except ResourceServiceError:
                    pass
                self._release(principal, workspace)
        return chunks()

    def _acquire(self, principal: tuple[str, str], workspace: tuple[str, str]) -> None:
        with self._lock:
            active = self._active.get(principal, 0)
            workspace_active = self._active_workspaces.get(workspace, 0)
            if active >= self.max_concurrent or workspace_active >= self.max_workspace_concurrent:
                raise ResourceServiceError("rate_limited", retryable=True, retry_after_ms=1000)
            self._active[principal] = active + 1
            self._active_workspaces[workspace] = workspace_active + 1

    def _release(self, principal: tuple[str, str], workspace: tuple[str, str]) -> None:
        with self._lock:
            active = self._active.get(principal, 0)
            if active <= 1:
                self._active.pop(principal, None)
            else:
                self._active[principal] = active - 1
            workspace_active = self._active_workspaces.get(workspace, 0)
            if workspace_active <= 1:
                self._active_workspaces.pop(workspace, None)
            else:
                self._active_workspaces[workspace] = workspace_active - 1
