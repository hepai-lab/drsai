from __future__ import annotations

import threading

import pytest

from drsai.owop.object_storage_resource_host import ObjectStorageResourceHost, TemporaryResourceUrlService
from drsai.owop.resource_service import ResourceAccessContext, ResourceService, ResourceServiceError
from drsai.owop.web_resource_actions import WebResourceActionService
from drsai.owop.web_resource_preview import isolated_preview_headers


class MemoryBlobs:
    def __init__(self):
        self.values: dict[str, bytes] = {}

    def put(self, key: str, content: bytes) -> None:
        self.values[key] = bytes(content)

    def get(self, key: str) -> bytes:
        return self.values[key]

    def delete(self, key: str) -> None:
        self.values.pop(key, None)


def test_object_storage_host_is_tenant_version_and_quota_scoped(tmp_path):
    blobs = MemoryBlobs()
    audits: list[dict] = []
    host = ObjectStorageResourceHost(tmp_path / "objects.sqlite3", blobs, tenant_quota_bytes=20, object_limit_bytes=12, audit=audits.append)
    first = host.publish("tenant-a", "handle-a", b"one", display_name="Plan.md", mime_type="text/markdown")
    second = host.publish("tenant-a", "handle-a", b"two", display_name="Plan.md", mime_type="text/markdown")
    assert host.describe("tenant-a", "handle-a") == second
    assert host.read_version("tenant-a", "handle-a", first.version_id) == b"one"
    assert host.capabilities("tenant-a", "handle-a")["reveal"] is False
    assert host.capabilities("tenant-a", "handle-a")["open_external"] is False
    with pytest.raises(ResourceServiceError, match="resource_not_found"):
        host.describe("tenant-b", "handle-a")
    with pytest.raises(ResourceServiceError, match="resource_too_large"):
        host.publish("tenant-a", "large", b"x" * 13, display_name="large.bin")
    assert all("object_key" not in audit and "handle" not in audit and "tenant_id" not in audit for audit in audits)
    assert not any("handle-a" in key or "tenant-a" in key for key in blobs.values.keys())


def test_object_storage_host_detects_backend_corruption(tmp_path):
    blobs = MemoryBlobs()
    host = ObjectStorageResourceHost(tmp_path / "objects.sqlite3", blobs)
    version = host.publish("tenant", "handle", b"safe", display_name="safe.txt", mime_type="text/plain")
    blobs.values[host.internal_object_key("tenant", "handle", version.version_id)] = b"evil"
    with pytest.raises(ResourceServiceError, match="integrity_mismatch"):
        host.read_version("tenant", "handle", version.version_id)


def test_object_storage_host_passes_resource_service_register_resolve_preview_download(tmp_path):
    blobs = MemoryBlobs()
    host = ObjectStorageResourceHost(tmp_path / "objects.sqlite3", blobs)
    host.publish("tenant-a", "handle-a", b"hello", display_name="hello.txt", mime_type="text/plain")
    service = ResourceService(tmp_path / "resources.sqlite3", host, authorize=lambda *_: True, audit_salt=b"object-host-test-salt")
    context = ResourceAccessContext("tenant-a", "alice", "session-a", "docmaster-a", "workspace-a", "corr-a")
    registered = service.register(context, host_handle="handle-a", resource_type="artifact", idempotency_key="register-a", immutable=True)
    key, version = registered["resource"], registered["version"]
    descriptor = service.resolve_batch(context, [{"association_id": "assoc-a", "resource": key, "observed_version_id": version["version_id"]}])["results"][0]["descriptor"]
    assert descriptor["state"] == "available" and descriptor["capabilities"]["reveal"] is False
    assert service.preview(context, key, version_id=version["version_id"], accept_kinds=["text"], max_bytes=1024)["kind"] == "text"
    prepared = service.download_prepare(context, key, version_id=version["version_id"])
    chunk = service.download_chunk(context, prepared["download_id"], offset=0, length=5)
    assert chunk["eof"] is True


def test_temporary_url_is_short_lived_bound_revocable_and_single_use():
    now = [1_000.0]
    broker = TemporaryResourceUrlService(b"s" * 32, clock=lambda: now[0])
    url = broker.issue(tenant_id="tenant-a", principal_id="alice", resource_id="resource-a", version_id="v1", ttl_seconds=300)
    assert "tenant-a" not in url and "alice" not in url and "resource-a" not in url
    assert "." not in url.rsplit("/", 1)[-1]  # not a decodable JWT/signed payload
    assert broker.consume(url, tenant_id="tenant-a", principal_id="alice", resource_id="resource-a", version_id="v1") == {
        "resource_id": "resource-a", "version_id": "v1",
    }
    with pytest.raises(ResourceServiceError, match="resource_not_found"):
        broker.consume(url, tenant_id="tenant-a", principal_id="alice", resource_id="resource-a", version_id="v1")

    wrong = broker.issue(tenant_id="tenant-a", principal_id="alice", resource_id="resource-a", version_id="v1")
    with pytest.raises(ResourceServiceError, match="resource_not_found"):
        broker.consume(wrong, tenant_id="tenant-a", principal_id="bob", resource_id="resource-a", version_id="v1")
    revoked = broker.issue(tenant_id="tenant-a", principal_id="alice", resource_id="resource-a", version_id="v1")
    broker.revoke(revoked)
    with pytest.raises(ResourceServiceError, match="resource_not_found"):
        broker.consume(revoked, tenant_id="tenant-a", principal_id="alice", resource_id="resource-a", version_id="v1")
    expiring = broker.issue(tenant_id="tenant-a", principal_id="alice", resource_id="resource-a", version_id="v1", ttl_seconds=1)
    now[0] += 1
    with pytest.raises(ResourceServiceError, match="resource_not_found"):
        broker.consume(expiring, tenant_id="tenant-a", principal_id="alice", resource_id="resource-a", version_id="v1")
    with pytest.raises(ResourceServiceError, match="resource_download_url_invalid"):
        broker.issue(tenant_id="tenant-a", principal_id="alice", resource_id="resource-a", version_id="v1", ttl_seconds=301)


def test_temporary_url_concurrent_consume_allows_exactly_one():
    broker = TemporaryResourceUrlService(b"s" * 32)
    url = broker.issue(tenant_id="tenant", principal_id="alice", resource_id="resource", version_id="v1")
    barrier = threading.Barrier(8)
    outcomes: list[bool] = []

    def consume() -> None:
        barrier.wait()
        try:
            broker.consume(url, tenant_id="tenant", principal_id="alice", resource_id="resource", version_id="v1")
            outcomes.append(True)
        except ResourceServiceError:
            outcomes.append(False)

    threads = [threading.Thread(target=consume) for _ in range(8)]
    for thread in threads: thread.start()
    for thread in threads: thread.join()
    assert outcomes.count(True) == 1


def test_web_preview_headers_enforce_isolated_origin_csp_and_nosniff():
    headers = isolated_preview_headers(
        mime_type="image/svg+xml", filename='evil";script.svg',
        app_origin="https://app.example.test", preview_origin="https://preview.example.test",
    )
    assert headers["Content-Type"] == "application/octet-stream"
    assert "script-src 'none'" in headers["Content-Security-Policy"]
    assert "connect-src 'none'" in headers["Content-Security-Policy"]
    assert "sandbox" in headers["Content-Security-Policy"]
    assert headers["X-Content-Type-Options"] == "nosniff"
    assert '"' not in headers["Content-Disposition"].removeprefix('inline; filename="').removesuffix('"')
    with pytest.raises(ResourceServiceError, match="preview_origin_invalid"):
        isolated_preview_headers(mime_type="text/plain", filename="x", app_origin="https://same.test", preview_origin="https://same.test")
    assert isolated_preview_headers(
        mime_type="application/pdf", filename="bomb.pdf",
        app_origin="https://app.example.test", preview_origin="https://preview.example.test",
    )["Content-Type"] == "application/octet-stream"


def _web_actions(tmp_path, *, authorize=lambda *_: True, max_concurrent=1, max_workspace_concurrent=10):
    blobs = MemoryBlobs()
    host = ObjectStorageResourceHost(tmp_path / "object-actions.sqlite3", blobs)
    host.publish("tenant-a", "handle-a", b"hello web", display_name='hello";.txt', mime_type="text/plain")
    service = ResourceService(
        tmp_path / "resource-actions.sqlite3", host, authorize=authorize,
        audit_salt=b"web-action-test-salt",
    )
    context = ResourceAccessContext("tenant-a", "alice", "session-a", "docmaster-a", "workspace-a", "corr-a")
    registered = service.register(
        context, host_handle="handle-a", resource_type="artifact",
        idempotency_key="web-action-register", immutable=True,
    )
    actions = WebResourceActionService(
        service, TemporaryResourceUrlService(b"w" * 32),
        app_origin="https://app.example.test", preview_origin="https://preview.example.test",
        max_concurrent_downloads_per_principal=max_concurrent,
        max_concurrent_downloads_per_workspace=max_workspace_concurrent,
    )
    return service, actions, context, registered["resource"], registered["version"]


def test_web_action_urls_reauthorize_stream_and_apply_safe_headers(tmp_path):
    _, actions, context, key, version = _web_actions(tmp_path)
    download = actions.create_download_action(context, key, version_id=version["version_id"])
    assert set(download) == {"kind", "url", "expires_at", "size", "version_id"}
    assert key["resource_id"] not in download["url"] and context.tenant_id not in download["url"]
    response = actions.consume_download(context, download["url"])
    assert b"".join(response.body) == b"hello web"
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert '";' not in response.headers["Content-Disposition"]
    with pytest.raises(ResourceServiceError, match="resource_not_found"):
        actions.consume_download(context, download["url"])

    preview = actions.create_preview_action(context, key, version_id=version["version_id"])
    preview_response = actions.consume_preview(context, preview["url"])
    assert b"".join(preview_response.body) == b"hello web"
    assert "sandbox" in preview_response.headers["Content-Security-Policy"]
    assert preview_response.headers["Cache-Control"] == "private, no-store"


def test_web_action_rejects_cross_tenant_and_permission_revocation_without_leakage(tmp_path):
    allowed = {"value": True}
    _, actions, context, key, version = _web_actions(tmp_path, authorize=lambda *_: allowed["value"])
    action = actions.create_download_action(context, key, version_id=version["version_id"])
    attacker = ResourceAccessContext("tenant-b", "alice", "session-a", "docmaster-a", "workspace-a", "corr-b")
    with pytest.raises(ResourceServiceError) as cross_tenant:
        actions.consume_download(attacker, action["url"])
    assert cross_tenant.value.safe_payload() == {"code": "resource_not_found", "retryable": False}

    allowed["value"] = False
    with pytest.raises(ResourceServiceError) as revoked:
        actions.consume_download(context, action["url"])
    assert revoked.value.safe_payload() == {"code": "resource_not_found", "retryable": False}


def test_web_actions_require_tls_and_fail_closed_for_active_or_rich_documents(tmp_path):
    service, _, context, _, _ = _web_actions(tmp_path)
    with pytest.raises(ResourceServiceError, match="preview_origin_invalid"):
        WebResourceActionService(
            service, TemporaryResourceUrlService(b"t" * 32),
            app_origin="http://app.example.test", preview_origin="https://preview.example.test",
        )

    for index, mime_type in enumerate((
        "text/html", "image/svg+xml",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/pdf",
    )):
        handle = f"bomb-{index}"
        service.host.publish(
            context.tenant_id, handle, b"active-or-compressed-content",
            display_name=f"bomb-{index}", mime_type=mime_type,
        )
        registered = service.register(
            context, host_handle=handle, resource_type="artifact",
            idempotency_key=f"bomb-register-{index}", immutable=True,
        )
        with pytest.raises(ResourceServiceError, match="preview_unsupported"):
            _web_actions_for_service = WebResourceActionService(
                service, TemporaryResourceUrlService(bytes([65 + index]) * 32),
                app_origin="https://app.example.test", preview_origin="https://preview.example.test",
            )
            _web_actions_for_service.create_preview_action(
                context, registered["resource"], version_id=registered["version"]["version_id"],
            )


def test_web_download_enforces_per_principal_concurrency_limit(tmp_path):
    _, actions, context, key, version = _web_actions(tmp_path, max_concurrent=1)
    first = actions.create_download_action(context, key, version_id=version["version_id"])
    second = actions.create_download_action(context, key, version_id=version["version_id"])
    first_response = actions.consume_download(context, first["url"])
    first_iterator = iter(first_response.body)
    assert next(first_iterator) == b"hello web"
    with pytest.raises(ResourceServiceError) as limited:
        actions.consume_download(context, second["url"])
    assert limited.value.safe_payload() == {"code": "rate_limited", "retryable": True, "retry_after_ms": 1000}
    with pytest.raises(StopIteration):
        next(first_iterator)
    assert b"".join(actions.consume_download(context, second["url"]).body) == b"hello web"


def test_web_download_defaults_and_workspace_concurrency_limit(tmp_path):
    service, _, alice, key, version = _web_actions(tmp_path)
    defaults = WebResourceActionService(
        service, TemporaryResourceUrlService(b"d" * 32),
        app_origin="https://app.example.test", preview_origin="https://preview.example.test",
    )
    assert defaults.max_concurrent == 3
    assert defaults.max_workspace_concurrent == 10

    bob = ResourceAccessContext(
        alice.tenant_id, "bob", "session-b", alice.authority_id,
        alice.workspace_id, "corr-b",
    )
    bob_registered = service.register(
        bob, host_handle="handle-a", resource_type="artifact",
        idempotency_key="web-action-register-bob", immutable=True,
    )
    assert bob_registered["resource"] == key
    limited_actions = WebResourceActionService(
        service, TemporaryResourceUrlService(b"l" * 32),
        app_origin="https://app.example.test", preview_origin="https://preview.example.test",
        max_concurrent_downloads_per_principal=3,
        max_concurrent_downloads_per_workspace=1,
    )
    alice_action = limited_actions.create_download_action(alice, key, version_id=version["version_id"])
    bob_action = limited_actions.create_download_action(bob, key, version_id=version["version_id"])
    alice_response = limited_actions.consume_download(alice, alice_action["url"])
    alice_iterator = iter(alice_response.body)
    assert next(alice_iterator) == b"hello web"
    with pytest.raises(ResourceServiceError) as limited:
        limited_actions.consume_download(bob, bob_action["url"])
    assert limited.value.safe_payload() == {
        "code": "rate_limited", "retryable": True, "retry_after_ms": 1000,
    }
    with pytest.raises(StopIteration):
        next(alice_iterator)
    assert b"".join(limited_actions.consume_download(bob, bob_action["url"]).body) == b"hello web"
