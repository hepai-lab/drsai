"""The identical ResourceHost conformance suite runs against every Host kind."""

from __future__ import annotations

import pytest

from drsai.owop.object_storage_resource_host import ObjectStorageResourceHost
from drsai.owop.resource_service import InMemoryObjectResourceHost, ResourceAccessContext, ResourceService, ResourceServiceError


class MemoryBlobs:
    def __init__(self) -> None:
        self.values: dict[str, bytes] = {}

    def put(self, key: str, content: bytes) -> None:
        self.values[key] = bytes(content)

    def get(self, key: str) -> bytes:
        return self.values[key]

    def delete(self, key: str) -> None:
        self.values.pop(key, None)


@pytest.mark.parametrize("host_kind", ["reference", "object-storage"])
def test_resource_host_shared_conformance_suite(tmp_path, host_kind):
    host = (
        InMemoryObjectResourceHost()
        if host_kind == "reference"
        else ObjectStorageResourceHost(tmp_path / "objects.sqlite3", MemoryBlobs())
    )
    first = host.publish("tenant-a", "report", b"version one", display_name="report.txt", mime_type="text/plain")
    second = host.publish("tenant-a", "report", b"version two", display_name="report.txt", mime_type="text/plain")
    assert host.describe("tenant-a", "report") == second
    assert host.read_version("tenant-a", "report", first.version_id) == b"version one"
    assert host.capabilities("tenant-a", "report") == {
        "read_current": True, "read_snapshot": True, "preview": True, "download": True,
        "reveal": False, "open_external": False, "copy_logical_path": False,
    }
    with pytest.raises(ResourceServiceError, match="resource_not_found"):
        host.describe("tenant-b", "report")

    service = ResourceService(
        tmp_path / f"resources-{host_kind}.sqlite3", host,
        authorize=lambda *_: True, audit_salt=b"shared-host-conformance",
    )
    context = ResourceAccessContext("tenant-a", "alice", "session-a", "docmaster", "workspace-a", "corr-a")
    registered = service.register(
        context, host_handle="report", resource_type="artifact",
        idempotency_key=f"register-{host_kind}", immutable=True,
    )
    key = registered["resource"]
    descriptor = service.resolve_batch(context, [{
        "association_id": "association-report", "resource": key,
        "observed_version_id": second.version_id,
    }])["results"][0]["descriptor"]
    assert descriptor["state"] == "available"
    assert descriptor["capabilities"]["preview"] is True
    assert descriptor["capabilities"]["reveal"] is False
    preview = service.preview(context, key, version_id=second.version_id, accept_kinds=["text"], max_bytes=1024)
    assert preview["digest"] == second.digest
    prepared = service.download_prepare(context, key, version_id=second.version_id)
    chunk = service.download_chunk(context, prepared["download_id"], offset=0, length=1024)
    assert chunk["eof"] is True and chunk["length"] == len(b"version two")
