from __future__ import annotations

import base64
import asyncio
import json
import statistics
import time
from pathlib import Path

import pytest

from drsai.owop.resource_service import (
    InMemoryObjectResourceHost,
    ResourceAccessContext,
    ResourceService,
    ResourceServiceError,
    ResourceServiceOperations,
    conversation_resource_state_semantics,
)
from drsai.owop import InProcessWorkspaceOperationsClient, OWOPProtocol


def context(**overrides) -> ResourceAccessContext:
    values = {
        "tenant_id": "tenant-a", "principal_id": "user-a", "session_id": "session-a",
        "authority_id": "runtime-a", "workspace_id": "workspace-a", "correlation_id": "corr-a",
    }
    values.update(overrides)
    return ResourceAccessContext(**values)


def test_python_consumes_shared_resource_state_semantics_vector():
    fixture_path = Path(__file__).resolve().parents[5] / "cores/protocol/owop/conversation-resource-states-p2.fixture.json"
    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
    for vector in fixture["cases"]:
        descriptor = vector["descriptor"]
        assert conversation_resource_state_semantics(
            descriptor["state"], descriptor["capabilities"],
            has_observed_version=descriptor["has_observed_version"],
        ) == vector["expected"], vector["id"]
    assert conversation_resource_state_semantics(
        "available", {"preview": True}, has_observed_version=False,
    )["status"] == "unsupported"


@pytest.fixture()
def service(tmp_path):
    audits = []
    host = InMemoryObjectResourceHost()
    svc = ResourceService(
        tmp_path / "resource.sqlite3", host,
        authorize=lambda ctx, action, key: (
            ctx.tenant_id == "tenant-a" and ctx.principal_id == "user-a"
            and ctx.session_id == "session-a" and ctx.authority_id == "runtime-a"
            and ctx.workspace_id == "workspace-a"
        ),
        audit_salt=b"test-only-salt", audit_sink=audits.append,
    )
    return host, svc, audits


def publish_and_register(host, service, *, data=b"hello", handle="object-1", idempotency="register-1", immutable=False):
    host.publish("tenant-a", handle, data, display_name="Plan.md", mime_type="text/plain", logical_path="docs/Plan.md")
    return service.register(context(), host_handle=handle, resource_type="artifact" if immutable else "file",
                            idempotency_key=idempotency, immutable=immutable)


def test_resources_v2_full_register_resolve_read_preview_download_subscribe_chain(service) -> None:
    host, svc, audits = service
    registered = publish_and_register(host, svc)
    key, version = registered["resource"], registered["version"]
    assert svc.register(context(), host_handle="object-1", resource_type="file", idempotency_key="register-1") == registered
    resolved = svc.resolve_batch(context(), [{"association_id": "assoc-1", "resource": key, "observed_version_id": version["version_id"]}])
    descriptor = resolved["results"][0]["descriptor"]
    assert descriptor["state"] == "available"
    assert descriptor["capabilities"]["reveal"] is False
    read = svc.read(context(), key, version_id=version["version_id"], offset=0, length=5, purpose="preview")
    assert base64.b64decode(read["content_base64"]) == b"hello" and read["eof"]
    preview = svc.preview(context(), key, version_id=version["version_id"], accept_kinds=["text"], max_bytes=1024)
    assert base64.b64decode(preview["content_base64"]) == b"hello"
    with pytest.raises(ResourceServiceError, match="preview_unsupported"):
        svc.preview(context(), key, version_id=version["version_id"], accept_kinds=["text"], max_bytes=1)
    prepared = svc.download_prepare(context(), key, version_id=version["version_id"])
    chunk = svc.download_chunk(context(), prepared["download_id"], offset=0, length=5)
    assert base64.b64decode(chunk["content_base64"]) == b"hello"
    assert svc.download_cancel(context(), prepared["download_id"]) == {"cancelled": True}
    with pytest.raises(ResourceServiceError, match="action_cancelled"):
        svc.download_chunk(context(), prepared["download_id"], offset=0, length=5)
    subscribed = svc.subscribe(context(), after_sequence=0)
    assert subscribed["events"][0]["type"] == "resource.registered"
    assert {entry["action"] for entry in audits} >= {
        "register", "resolve", "read", "preview", "download", "download.chunk", "download.cancel", "subscribe",
    }
    assert any(entry["action"] == "preview" and entry["result_code"] == "preview_unsupported" for entry in audits)
    assert all({
        "tenant_id", "principal_id", "session_id", "authority_id", "workspace_id",
        "resource_hash", "action", "version_id", "result_code", "correlation_id", "timestamp",
    } <= entry.keys() for entry in audits)
    assert all("path" not in str(entry).lower() and "object-1" not in str(entry) for entry in audits)


def test_same_resource_version_change_and_delete_create_generation_rules(service) -> None:
    host, svc, _audits = service
    first = publish_and_register(host, svc)
    old_key, old_version = first["resource"], first["version"]
    current = host.publish("tenant-a", "object-1", b"changed", display_name="Plan.md", mime_type="text/plain",
                           logical_path="docs/Plan.md", object_identity="replacement-identity")
    continuous = svc.register(context(), host_handle="object-1", resource_type="file",
                              idempotency_key="atomic-save", continuity="continuous")
    assert continuous["resource"] == old_key and continuous["version"]["version_id"] == current.version_id
    changed = svc.resolve_batch(context(), [{"resource": old_key, "observed_version_id": old_version["version_id"]}])
    assert changed["results"][0]["descriptor"]["state"] == "changed"

    svc.set_state(context(), old_key, "deleted", dedupe_key="delete-old")
    # Even if the operating system reuses the same inode/object identity, a
    # confirmed tombstone prevents silent rebinding to the old key.
    host.publish("tenant-a", "object-1", b"new object", display_name="Plan.md", mime_type="text/plain",
                 logical_path="docs/Plan.md", object_identity="replacement-identity")
    replacement = svc.register(context(), host_handle="object-1", resource_type="file",
                               idempotency_key="delete-create", continuity="auto")
    assert replacement["resource"]["resource_id"] != old_key["resource_id"]
    assert replacement["resource"]["generation"] == old_key["generation"] + 1
    old = svc.resolve_batch(context(), [{"resource": old_key, "observed_version_id": old_version["version_id"]}])["results"][0]["descriptor"]
    assert old["state"] == "deleted"
    assert old["capabilities"]["read_current"] is False
    assert old["capabilities"]["read_snapshot"] is True
    retained = svc.preview(
        context(), old_key, version_id=old_version["version_id"], accept_kinds=["text"], max_bytes=1024,
    )
    assert base64.b64decode(retained["content_base64"]) == b"hello"


def test_version_bound_read_rejects_conflict_and_integrity_mismatch(service) -> None:
    host, svc, _audits = service
    registered = publish_and_register(host, svc)
    key, version = registered["resource"], registered["version"]
    with pytest.raises(ResourceServiceError, match="resource_version_conflict"):
        svc.read(context(), key, version_id="version-does-not-exist", offset=0, length=1, purpose="preview")
    host._objects[("tenant-a", "object-1")]["versions"][version["version_id"]] = b"tampered"
    with pytest.raises(ResourceServiceError, match="integrity_mismatch"):
        svc.read(context(), key, version_id=version["version_id"], offset=0, length=1, purpose="preview")


def test_download_resume_is_version_bound_and_all_failures_are_audited(service) -> None:
    host, svc, audits = service
    data = bytes(range(256)) * 1024
    registered = publish_and_register(host, svc, data=data)
    key, version = registered["resource"], registered["version"]
    resume_offset = 65_536
    prepared = svc.download_prepare(
        context(), key, version_id=version["version_id"], resume_offset=resume_offset,
    )
    with pytest.raises(ResourceServiceError, match="resource_version_conflict"):
        svc.download_chunk(context(), prepared["download_id"], offset=0, length=65_536)
    resumed = svc.download_chunk(
        context(), prepared["download_id"], offset=resume_offset, length=65_536,
    )
    resumed_bytes = base64.b64decode(resumed["content_base64"])
    assert resumed_bytes == data[resume_offset:resume_offset + 65_536]
    assert resumed["chunk_digest"].startswith("sha256:")

    host.publish(
        "tenant-a", "object-1", b"new current version", display_name="Plan.md",
        mime_type="text/plain", logical_path="docs/Plan.md",
    )
    svc.register(
        context(), host_handle="object-1", resource_type="file",
        idempotency_key="resume-version-change", continuity="continuous",
    )
    with pytest.raises(ResourceServiceError, match="resource_version_conflict"):
        svc.download_prepare(
            context(), key, version_id=version["version_id"], resume_offset=resume_offset,
        )
    with pytest.raises(ResourceServiceError, match="resource_not_found"):
        svc.download_chunk(context(), "download-unknown", offset=0, length=65_536)

    failed = [entry for entry in audits if entry["result_code"] != "ok" and entry["result_code"] != "prepared"]
    assert {entry["result_code"] for entry in failed} >= {"resource_version_conflict", "resource_not_found"}
    assert all(entry["correlation_id"] == "corr-a" for entry in audits)
    assert all("object-1" not in str(entry) and "docs/Plan.md" not in str(entry) for entry in audits)


def test_150_mib_download_resumes_at_same_version(service) -> None:
    host, svc, _audits = service
    size = 150 * 1024 * 1024
    data = b"r" * size
    registered = publish_and_register(host, svc, data=data, handle="large-150", idempotency="large-150")
    key, version = registered["resource"], registered["version"]
    resume_offset = size - 65_536
    # Reconstruct the service to prove resume state is derived from the
    # persistent version index, not an in-memory download ticket.
    restarted = ResourceService(
        svc.database, host,
        authorize=lambda ctx, _action, _key: (
            ctx.tenant_id == "tenant-a" and ctx.principal_id == "user-a"
            and ctx.session_id == "session-a" and ctx.authority_id == "runtime-a"
            and ctx.workspace_id == "workspace-a"
        ),
        audit_salt=b"test-only-salt",
    )
    prepared = restarted.download_prepare(
        context(), key, version_id=version["version_id"], resume_offset=resume_offset,
    )
    final_chunk = restarted.download_chunk(
        context(), prepared["download_id"], offset=resume_offset, length=65_536,
    )
    assert final_chunk["offset"] == resume_offset
    assert final_chunk["length"] == 65_536
    assert final_chunk["eof"] is True
    assert base64.b64decode(final_chunk["content_base64"]) == data[resume_offset:]


def test_registration_and_resource_events_are_idempotent_after_restart(tmp_path) -> None:
    host = InMemoryObjectResourceHost()
    host.publish("tenant-a", "stable", b"stable", display_name="stable.txt", mime_type="text/plain")
    database = tmp_path / "restart-idempotency.sqlite3"
    create = lambda: ResourceService(
        database, host, authorize=lambda *_: True,
        audit_salt=b"restart-idempotency-test",
    )
    first_service = create()
    first = first_service.register(
        context(), host_handle="stable", resource_type="file",
        idempotency_key="stable-register",
    )
    before = first_service.subscribe(context(), after_sequence=0, limit=100)
    restarted = create()
    replayed = restarted.register(
        context(), host_handle="stable", resource_type="file",
        idempotency_key="stable-register",
    )
    after = restarted.subscribe(context(), after_sequence=0, limit=100)
    assert replayed == first
    assert after["events"] == before["events"]
    assert len(after["events"]) == 1


def test_old_client_without_requested_action_remains_resolve_compatible(service) -> None:
    host, svc, audits = service
    key = publish_and_register(host, svc)["resource"]
    result = svc.resolve_batch(context(), [{"resource": key}])["results"][0]
    assert result["descriptor"]["state"] == "available"
    assert audits[-1]["action"] == "resolve"


def test_transport_disconnect_and_restart_do_not_synthesize_deleted_state(tmp_path) -> None:
    host = InMemoryObjectResourceHost()
    host.publish("tenant-a", "online", b"online", display_name="online.txt", mime_type="text/plain")
    database = tmp_path / "disconnect.sqlite3"
    create = lambda: ResourceService(
        database, host, authorize=lambda *_: True, audit_salt=b"disconnect-test",
    )
    before = create()
    key = before.register(
        context(), host_handle="online", resource_type="file", idempotency_key="online-register",
    )["resource"]
    cursor = int(before.subscribe(context(), after_sequence=0)["cursor"])

    # A dropped subscription has no ResourceService mutation API. Recreating
    # the transport/service from the durable database must preserve state and
    # must not fabricate a resource.deleted event.
    restarted = create()
    descriptor = restarted.resolve_batch(context(), [{"resource": key}])["results"][0]["descriptor"]
    assert descriptor["state"] == "available"
    assert restarted.subscribe(context(), after_sequence=cursor)["events"] == []


def test_cross_tenant_workspace_authority_and_principal_are_indistinguishable(service) -> None:
    host, svc, audits = service
    key = publish_and_register(host, svc)["resource"]
    denied_contexts = (
        context(tenant_id="tenant-b"), context(principal_id="user-b"), context(session_id="session-b"),
        context(workspace_id="workspace-b"), context(authority_id="runtime-b"),
    )
    payloads = []
    for denied in denied_contexts:
        result = svc.resolve_batch(denied, [{"resource": key}])["results"][0]
        payloads.append(result["error"])
    assert payloads == [{"code": "resource_not_found", "retryable": False}] * 5
    assert all(entry.get("result_code") == "resource_not_found" for entry in audits[-5:])


def test_cross_scope_and_unknown_resource_failure_timings_are_equivalent(service) -> None:
    host, svc, _ = service
    key = publish_and_register(host, svc)["resource"]
    foreign = {**key, "workspace_id": "workspace-b"}
    unknown = {**key, "resource_id": "resource-does-not-exist"}

    for _ in range(20):
        svc.resolve_batch(context(), [{"resource": foreign}])
        svc.resolve_batch(context(), [{"resource": unknown}])

    samples = {"foreign": [], "unknown": []}
    for _ in range(250):
        for label, candidate in (("foreign", foreign), ("unknown", unknown)):
            started = time.perf_counter_ns()
            result = svc.resolve_batch(context(), [{"resource": candidate}])["results"][0]
            samples[label].append((time.perf_counter_ns() - started) / 1_000_000)
            assert result["error"] == {"code": "resource_not_found", "retryable": False}

    medians = {label: statistics.median(values) for label, values in samples.items()}
    slower, faster = max(medians.values()), min(medians.values())
    assert slower - faster <= 1.0, medians
    assert slower / max(faster, 0.001) <= 2.0, medians


def test_requested_host_action_is_reauthorized_capability_checked_and_audited(service) -> None:
    host, svc, audits = service
    key = publish_and_register(host, svc)["resource"]
    copied = svc.resolve_batch(context(), [{
        "resource": key, "requested_action": "copy_logical_path",
    }])["results"][0]
    assert copied["descriptor"]["logical_path"] == "docs/Plan.md"
    assert audits[-1]["action"] == "copy_logical_path" and audits[-1]["result_code"] == "ok"

    reveal = svc.resolve_batch(context(), [{
        "resource": key, "requested_action": "reveal",
    }])["results"][0]
    assert reveal["error"] == {"code": "resource_not_found", "retryable": False}
    assert audits[-1]["action"] == "reveal" and audits[-1]["result_code"] == "resource_not_found"


def test_requested_action_does_not_reuse_a_previously_resolved_authorization(tmp_path) -> None:
    allowed = {"value": True}
    audits = []
    host = InMemoryObjectResourceHost()
    host.publish(
        "tenant-a", "revoked", b"safe", display_name="safe.txt",
        mime_type="text/plain", logical_path="docs/safe.txt",
    )
    svc = ResourceService(
        tmp_path / "revoked-action.sqlite3", host,
        authorize=lambda *_: allowed["value"], audit_salt=b"revoked-action-test",
        audit_sink=audits.append,
    )
    key = svc.register(
        context(), host_handle="revoked", resource_type="file",
        idempotency_key="revoked-register",
    )["resource"]
    assert "descriptor" in svc.resolve_batch(context(), [{"resource": key}])["results"][0]
    allowed["value"] = False
    denied = svc.resolve_batch(context(), [{
        "resource": key, "requested_action": "copy_logical_path",
    }])["results"][0]
    assert denied["error"] == {"code": "resource_not_found", "retryable": False}
    assert audits[-1]["action"] == "copy_logical_path"


@pytest.mark.parametrize("display_name,mime_type,logical_path", [
    ("x" * 513, "text/plain", "safe.txt"),
    ("evil\nname.txt", "text/plain", "safe.txt"),
    ("safe.txt", "text/plain\r\nX-Evil: yes", "safe.txt"),
    ("safe.txt", "text/plain", "C:/Users/alice/secret.txt"),
    ("safe.txt", "text/plain", "../outside/secret.txt"),
    ("safe.txt", "text/plain", "\\\\server\\share\\secret.txt"),
])
def test_host_metadata_cannot_inject_headers_or_absolute_paths(
    tmp_path, display_name: str, mime_type: str, logical_path: str,
) -> None:
    host = InMemoryObjectResourceHost()
    host.publish(
        "tenant-a", "malicious", b"payload", display_name=display_name,
        mime_type=mime_type, logical_path=logical_path,
    )
    svc = ResourceService(
        tmp_path / "malicious-host.sqlite3", host, authorize=lambda *_: True,
        audit_salt=b"malicious-host-metadata-test",
    )
    with pytest.raises(ResourceServiceError, match="unsupported"):
        svc.register(
            context(), host_handle="malicious", resource_type="file",
            idempotency_key="malicious-host-register",
        )


def test_same_workspace_other_session_requires_an_explicit_resource_grant(tmp_path) -> None:
    host = InMemoryObjectResourceHost()
    svc = ResourceService(
        tmp_path / "session-grants.sqlite3", host,
        authorize=lambda ctx, _action, _key: (
            ctx.tenant_id == "tenant-a" and ctx.principal_id == "user-a"
            and ctx.authority_id == "runtime-a" and ctx.workspace_id == "workspace-a"
        ),
        audit_salt=b"session-grant-test-salt",
    )
    host.publish("tenant-a", "shared", b"shared", display_name="shared.txt", mime_type="text/plain")
    owner = context(session_id="session-owner")
    other = context(session_id="session-other")
    first = svc.register(owner, host_handle="shared", resource_type="file", idempotency_key="owner-register")
    denied = svc.resolve_batch(other, [{"resource": first["resource"]}])["results"][0]
    assert denied["error"] == {"code": "resource_not_found", "retryable": False}
    with pytest.raises(ResourceServiceError, match="resource_not_found"):
        svc.register(other, host_handle="shared", resource_type="file", idempotency_key="owner-register")

    granted = svc.register(other, host_handle="shared", resource_type="file", idempotency_key="other-register")
    assert granted["resource"] == first["resource"]
    resolved = svc.resolve_batch(other, [{"resource": first["resource"]}])["results"][0]
    assert resolved["descriptor"]["state"] == "available"


def test_descriptor_capabilities_fail_closed(service) -> None:
    host, svc, _audits = service
    registered = publish_and_register(host, svc)
    host._objects[("tenant-a", "object-1")]["capabilities"] = {"preview": True}
    descriptor = svc.resolve_batch(context(), [{"resource": registered["resource"]}])["results"][0]["descriptor"]
    assert not any(descriptor["capabilities"].values())


def test_batch_limit_and_event_dedupe(service) -> None:
    host, svc, _audits = service
    key = publish_and_register(host, svc)["resource"]
    with pytest.raises(ResourceServiceError, match="resource_too_large"):
        svc.resolve_batch(context(), [{"resource": key}] * 101)
    svc.set_state(context(), key, "moved", logical_path="docs/Renamed.md", dedupe_key="move-1")
    svc.set_state(context(), key, "moved", logical_path="docs/Renamed.md", dedupe_key="move-1")
    events = svc.subscribe(context(), after_sequence=0)["events"]
    assert [event["dedupe_key"] for event in events].count("move-1") == 1


def test_case_sensitive_logical_names_are_distinct_resources(service) -> None:
    host, svc, _audits = service
    host.publish("tenant-a", "upper", b"upper", display_name="Plan.md", mime_type="text/plain", logical_path="docs/Plan.md")
    host.publish("tenant-a", "lower", b"lower", display_name="plan.md", mime_type="text/plain", logical_path="docs/plan.md")
    upper = svc.register(context(), host_handle="upper", resource_type="file", idempotency_key="upper")
    lower = svc.register(context(), host_handle="lower", resource_type="file", idempotency_key="lower")
    assert upper["resource"]["resource_id"] != lower["resource"]["resource_id"]


def test_resources_v2_owop_dispatcher_uses_out_of_band_authorization_context(service) -> None:
    host, svc, _audits = service
    host.publish("tenant-a", "object-1", b"hello", display_name="Plan.md", mime_type="text/plain", logical_path="docs/Plan.md")
    protocol = OWOPProtocol(Path(__file__).resolve().parents[5] / "cores" / "protocol" / "owop" / "owop.schema.json")
    operations = ResourceServiceOperations(svc, context)
    client = InProcessWorkspaceOperationsClient(protocol, operations.handlers())

    async def call(operation, params):
        return await client.execute({
            "version": "1.0", "request_id": f"request-{operation}", "correlation_id": "corr-a",
            "workspace_id": "workspace-a", "operation": operation, "params": params,
            "binding": {"kind": "in_process"},
        })

    registered = asyncio.run(call("resources.register", {
        "authority_id": "runtime-a", "resource_type": "file", "host_handle": "object-1",
        "idempotency_key": "dispatcher-register",
    }))
    assert registered["ok"]
    key = registered["result"]["resource"]
    version_id = registered["result"]["version"]["version_id"]
    resolved = asyncio.run(call("resources.resolve_batch", {"observations": [{"association_id": "assoc-1", "resource": key}]}))
    assert resolved["ok"] and resolved["result"]["results"][0]["descriptor"]["state"] == "available"
    assert asyncio.run(call("resources.read", {
        "resource": key, "version_id": version_id, "offset": 0, "length": 5, "purpose": "preview",
    }))["ok"]
    assert asyncio.run(call("resources.preview", {
        "resource": key, "version_id": version_id, "accept_kinds": ["text"], "max_bytes": 1024,
    }))["ok"]
    prepared = asyncio.run(call("resources.download.prepare", {"resource": key, "version_id": version_id}))
    download_id = prepared["result"]["download_id"]
    assert asyncio.run(call("resources.download.chunk", {
        "download_id": download_id, "offset": 0, "length": 65536,
    }))["ok"]
    assert asyncio.run(call("resources.download.cancel", {"download_id": download_id}))["ok"]
    assert asyncio.run(call("resources.subscribe", {"after_sequence": 0, "limit": 100}))["ok"]
