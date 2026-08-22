from __future__ import annotations

import base64
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
import hashlib
import time
from urllib.parse import urlencode

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from drsai.relay.generated_contract import CAPABILITIES, PROTOCOL_VERSION
from drsai.relay.models import ResourceLifecycle, RuntimeStatus, Workspace
from drsai.relay.registry import RelayRegistry, RelayRegistryError
from drsai.oaep.selection import OAEP_REQUIRED


def b64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode()


def registered(registry: RelayRegistry):
    private = Ed25519PrivateKey.generate()
    public = private.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    code = registry.issue_registration_code()
    runtime_id, token = registry.register(code, "Office PC", "1.4.6", b64(public), f"register-{id(private)}")
    return private, runtime_id, token


def associate(
    registry: RelayRegistry,
    subject: str,
    code: str,
    device_id: str = "android-device-0001",
) -> str:
    private = Ed25519PrivateKey.generate()
    public = b64(
        private.public_key().public_bytes(
            serialization.Encoding.Raw,
            serialization.PublicFormat.Raw,
        )
    )
    return registry.associate(
        subject,
        code,
        device_id,
        "Android Test Device",
        public,
    )


def heartbeat(registry: RelayRegistry, private: Ed25519PrivateKey, runtime_id: str, token: str,
              instance: str = "instance-a", nonce: str = "nonce-a"):
    signature = b64(private.sign(f"{runtime_id}\n{instance}\n{nonce}".encode()))
    return registry.heartbeat(runtime_id, token, instance_id=instance, version="1.4.6",
                              capabilities=frozenset(CAPABILITIES), backend_health={"codex": "healthy"},
                              nonce=nonce, signature=signature)


def test_supported_runtime_capability_summary_fails_closed_until_full_oaep_profile() -> None:
    registry = RelayRegistry()
    private, runtime_id, token = registered(registry)
    assert registry.supported_runtime_capability_summary(OAEP_REQUIRED) == (1, 1)
    heartbeat(registry, private, runtime_id, token)
    assert registry.supported_runtime_capability_summary(OAEP_REQUIRED) == (1, 0)
    registry.revoke(runtime_id)
    assert registry.supported_runtime_capability_summary(OAEP_REQUIRED) == (0, 0)
    with pytest.raises(ValueError, match="required_runtime_capabilities_empty"):
        registry.supported_runtime_capability_summary(frozenset())


def test_registration_is_short_lived_single_use_and_idempotent() -> None:
    registry = RelayRegistry()
    private = Ed25519PrivateKey.generate()
    public = b64(private.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw))
    code = registry.issue_registration_code()
    first = registry.register(code, "PC", "1", public, "same-key-0001")
    assert registry.register("even-wrong-after-success", "PC", "1", public, "same-key-0001") == first
    with pytest.raises(RelayRegistryError, match="already used"):
        registry.register(code, "PC", "1", public, "different-key")


def test_access_grant_only_associates_existing_runtime_and_is_single_use() -> None:
    registry = RelayRegistry()
    _, runtime_id, token = registered(registry)
    grant_id, code, expires = registry.issue_access_grant(runtime_id, token)
    assert expires > datetime.now(UTC)
    assert registry.access_grant_status(runtime_id, token, grant_id)[0] == "pending"
    assert associate(registry, "alice", code) == runtime_id
    assert registry.access_grant_status(runtime_id, token, grant_id)[0] == "consumed"
    with pytest.raises(RelayRegistryError) as consumed:
        associate(registry, "bob", code)
    assert consumed.value.code == "access_grant_consumed"
    assert [x.runtime.runtime_id for x in registry.list_runtimes("alice")[0]] == [runtime_id]
    assert registry.list_runtimes("bob")[0] == []


def test_device_proof_rotation_rejects_replay_and_old_key(tmp_path) -> None:
    registry = RelayRegistry()
    _, runtime_id, token = registered(registry)
    _, code, _ = registry.issue_access_grant(runtime_id, token)
    old_private = Ed25519PrivateKey.generate()
    old_public = b64(old_private.public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw,
    ))
    registry.associate(
        "alice", code, "android-device-0001", "Android Test Device", old_public,
    )
    access_token = "opaque-access-token"
    timestamp = str(int(time.time()))
    nonce = "nonce-device-proof-0001"
    path = f"/v1/runtimes/{runtime_id}/workspaces"
    query = urlencode([("cursor", "a b"), ("limit", "100")])

    def sign(private: Ed25519PrivateKey, request_nonce: str) -> str:
        canonical = "\n".join((
            "hai-runtime-relay-device-v1", "GET", path, query,
            hashlib.sha256(b"").hexdigest(), timestamp, request_nonce,
            hashlib.sha256(access_token.encode()).hexdigest(),
        )).encode()
        return b64(private.sign(canonical))

    signature = sign(old_private, nonce)
    assert registry.verify_device_request(
        "alice", "android-device-0001", runtime_id=runtime_id,
        method="GET", path=path, query=query, body=b"", timestamp=timestamp,
        nonce=nonce, signature=signature, access_token=access_token,
    ) == "android-device-0001"
    with pytest.raises(RelayRegistryError) as replay:
        registry.verify_device_request(
            "alice", "android-device-0001", runtime_id=runtime_id,
            method="GET", path=path, query=query, body=b"", timestamp=timestamp,
            nonce=nonce, signature=signature, access_token=access_token,
        )
    assert replay.value.code == "device_proof_replay"

    new_private = Ed25519PrivateKey.generate()
    new_public = b64(new_private.public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw,
    ))
    rotated = registry.rotate_association_device_key(
        "alice", runtime_id, "android-device-0001", new_public,
    )
    assert rotated["status"] == "active"
    old_nonce = "nonce-device-proof-old-0002"
    with pytest.raises(RelayRegistryError) as old_key:
        registry.verify_device_request(
            "alice", "android-device-0001", runtime_id=runtime_id,
            method="GET", path=path, query=query, body=b"", timestamp=timestamp,
            nonce=old_nonce, signature=sign(old_private, old_nonce), access_token=access_token,
        )
    assert old_key.value.code == "device_proof_invalid"
    new_nonce = "nonce-device-proof-new-0003"
    assert registry.verify_device_request(
        "alice", "android-device-0001", runtime_id=runtime_id,
        method="GET", path=path, query=query, body=b"", timestamp=timestamp,
        nonce=new_nonce, signature=sign(new_private, new_nonce), access_token=access_token,
    ) == "android-device-0001"


def test_runtime_pause_denies_access_but_resume_preserves_association() -> None:
    registry = RelayRegistry()
    _, runtime_id, token = registered(registry)
    _, code, _ = registry.issue_access_grant(runtime_id, token)
    associate(registry, "alice", code)

    paused = registry.set_enrollment_paused(runtime_id, token, paused=True)
    assert paused["status"] == "paused"
    assert registry.list_runtimes("alice")[0][0].runtime.status == RuntimeStatus.PAUSED
    with pytest.raises(RelayRegistryError) as denied:
        registry.identity("alice", runtime_id)
    assert denied.value.code == "runtime_paused"
    with pytest.raises(RelayRegistryError) as pairing_denied:
        registry.issue_access_grant(runtime_id, token)
    assert pairing_denied.value.code == "runtime_paused"
    assert registry.list_associations(runtime_id, token)[0]["status"] == "active"
    resumed = registry.set_enrollment_paused(runtime_id, token, paused=False)
    assert resumed["status"] == "active"
    assert registry.identity("alice", runtime_id).runtime_id == runtime_id
    assert registry.list_associations(runtime_id, token)[0]["status"] == "active"


def test_historical_unsafe_runtime_name_uses_safe_fallback() -> None:
    registry = RelayRegistry()
    _, runtime_id, token = registered(registry)
    _, code, _ = registry.issue_access_grant(runtime_id, token)
    associate(registry, "alice", code)
    registry._runtimes[runtime_id].display_name = r"C:\Users\owner"
    result, _ = registry.list_runtimes("alice")
    assert result[0].display_name == "Windows Runtime"
    assert "owner" not in result[0].display_name


def test_push_registration_is_device_scoped_rotatable_and_never_stores_raw_token() -> None:
    registry = RelayRegistry(supported_push_providers=frozenset({"fcm"}))
    _, runtime_id, runtime_token = registered(registry)
    _, code, _ = registry.issue_access_grant(runtime_id, runtime_token)
    device_id = "android-push-device-0001"
    associate(registry, "alice", code, device_id)
    token_v1 = "push-token-v1-" + "a" * 48
    token_v2 = "push-token-v2-" + "b" * 48

    first = registry.upsert_push_registration(
        "alice", runtime_id, device_id, "fcm", token_v1, 1,
    )
    replay = registry.upsert_push_registration(
        "alice", runtime_id, device_id, "fcm", token_v1, 1,
    )
    assert first["status"] == "active"
    assert replay["generation"] == 1
    assert first["device_summary"].startswith("dev_")

    with pytest.raises(RelayRegistryError) as conflict:
        registry.upsert_push_registration(
            "alice", runtime_id, device_id, "fcm", token_v2, 1,
        )
    assert conflict.value.code == "push_registration_conflict"

    rotated = registry.upsert_push_registration(
        "alice", runtime_id, device_id, "fcm", token_v2, 2,
    )
    assert rotated["generation"] == 2
    with pytest.raises(RelayRegistryError) as stale:
        registry.upsert_push_registration(
            "alice", runtime_id, device_id, "fcm", token_v1, 1,
        )
    assert stale.value.code == "push_registration_stale"

    association = registry._runtimes[runtime_id].associations[("alice", device_id)]
    assert association.push_token_digest == hashlib.sha256(token_v2.encode()).hexdigest()
    assert token_v1 not in repr(registry._runtimes)
    assert token_v2 not in repr(registry._runtimes)
    assert token_v1 not in repr(registry.audit)
    assert token_v2 not in repr(registry.audit)

    revoked = registry.revoke_push_registration("alice", runtime_id, device_id)
    assert revoked["status"] == "revoked"
    assert revoked["generation"] == 2
    assert association.push_provider is None
    assert association.push_token_digest is None
    with pytest.raises(RelayRegistryError) as missing:
        registry.revoke_push_registration("alice", runtime_id, device_id)
    assert missing.value.code == "push_registration_not_found"


def test_push_registration_fails_closed_without_provider_and_on_association_revoke() -> None:
    registry = RelayRegistry()
    _, runtime_id, runtime_token = registered(registry)
    _, code, _ = registry.issue_access_grant(runtime_id, runtime_token)
    device_id = "android-push-device-0002"
    associate(registry, "alice", code, device_id)
    raw_token = "push-token-unconfigured-" + "x" * 48

    with pytest.raises(RelayRegistryError) as unavailable:
        registry.upsert_push_registration(
            "alice", runtime_id, device_id, "fcm", raw_token, 1,
        )
    assert unavailable.value.code == "push_provider_unavailable"
    assert unavailable.value.retryable is True
    assert raw_token not in repr(registry._runtimes)
    assert raw_token not in repr(registry.audit)

    configured = RelayRegistry(supported_push_providers=frozenset({"fcm"}))
    _, configured_runtime, configured_token = registered(configured)
    _, configured_code, _ = configured.issue_access_grant(configured_runtime, configured_token)
    associate(configured, "alice", configured_code, device_id)
    configured.upsert_push_registration(
        "alice", configured_runtime, device_id, "fcm", raw_token, 1,
    )
    configured.revoke_association("alice", configured_runtime, device_id)
    association = configured._runtimes[configured_runtime].associations[("alice", device_id)]
    assert association.push_provider is None
    assert association.push_token_digest is None

def test_access_grant_has_exactly_one_winner_under_concurrent_consumption() -> None:
    registry = RelayRegistry()
    _, runtime_id, token = registered(registry)
    grant_id, code, _ = registry.issue_access_grant(runtime_id, token)

    def consume(index: int) -> tuple[str, str]:
        try:
            return "ok", associate(
                registry,
                f"subject-{index}",
                code,
                f"android-device-{index:04d}",
            )
        except RelayRegistryError as exc:
            return "error", exc.code

    with ThreadPoolExecutor(max_workers=32) as pool:
        results = list(pool.map(consume, range(100)))

    assert results.count(("ok", runtime_id)) == 1
    assert [result for result in results if result[0] == "error"] == [
        ("error", "access_grant_consumed")
    ] * 99
    assert registry.access_grant_status(runtime_id, token, grant_id)[0] == "consumed"
    assert len([entry for entry in registry.audit if entry["action"] == "runtime.associate"]) == 1


def test_association_revocation_is_subject_and_runtime_scoped() -> None:
    registry = RelayRegistry()
    _, runtime_a, token_a = registered(registry)
    _, runtime_b, token_b = registered(registry)
    grant_a, code_a, _ = registry.issue_access_grant(runtime_a, token_a)
    _, code_b, _ = registry.issue_access_grant(runtime_b, token_b)
    associate(registry, "alice", code_a)
    associate(registry, "alice", code_b)

    assert registry.access_grant_subject_summary(runtime_a, token_a, grant_a).startswith("sub_")
    association_a = registry.list_associations(runtime_a, token_a)[0]
    assert "subject" not in association_a
    with pytest.raises(RelayRegistryError) as cross_runtime:
        registry.revoke_runtime_association(
            runtime_b, token_b, str(association_a["association_id"])
        )
    assert cross_runtime.value.code == "association_not_found"

    revoked = registry.revoke_association(
        "alice",
        runtime_a,
        "android-device-0001",
    )
    assert revoked["status"] == "revoked"
    assert registry.list_runtimes("alice")[0][0].runtime.runtime_id == runtime_b
    with pytest.raises(RelayRegistryError) as repeated:
        registry.revoke_association(
            "alice",
            runtime_a,
            "android-device-0001",
        )
    assert repeated.value.code == "association_required"


def test_access_grant_refresh_revokes_previous_and_revoke_is_idempotent() -> None:
    registry = RelayRegistry()
    _, runtime_id, token = registered(registry)
    first_id, first_code, _ = registry.issue_access_grant(runtime_id, token)
    second_id, second_code, _ = registry.issue_access_grant(runtime_id, token)
    assert registry.access_grant_status(runtime_id, token, first_id)[0] == "revoked"
    assert registry.access_grant_status(runtime_id, token, second_id)[0] == "pending"
    with pytest.raises(RelayRegistryError) as revoked:
        associate(registry, "alice", first_code)
    assert revoked.value.code == "access_grant_revoked"
    assert registry.revoke_access_grant(runtime_id, token, second_id)[0] == "revoked"
    assert registry.revoke_access_grant(runtime_id, token, second_id)[0] == "revoked"
    with pytest.raises(RelayRegistryError) as revoked_second:
        associate(registry, "alice", second_code)
    assert revoked_second.value.code == "access_grant_revoked"


def test_access_grant_status_is_runtime_scoped_and_expires() -> None:
    registry = RelayRegistry()
    _, runtime_id, token = registered(registry)
    registry.code_ttl = timedelta(seconds=-1)
    grant_id, expired_code, _ = registry.issue_access_grant(runtime_id, token)
    assert registry.access_grant_status(runtime_id, token, grant_id)[0] == "expired"
    with pytest.raises(RelayRegistryError) as expired:
        associate(registry, "alice", expired_code)
    assert expired.value.code == "access_grant_expired"
    other = RelayRegistry()
    _, other_runtime, other_token = registered(other)
    with pytest.raises(RelayRegistryError, match="not found"):
        registry.access_grant_status(runtime_id, token, "ag_missing")
    with pytest.raises(RelayRegistryError):
        registry.access_grant_status(runtime_id, other_token, grant_id)


def test_signed_heartbeat_rejects_replay_and_rotates_instance_generation() -> None:
    registry = RelayRegistry()
    private, runtime_id, token = registered(registry)
    first = heartbeat(registry, private, runtime_id, token)
    assert first.status == RuntimeStatus.ONLINE and first.protocol_version == PROTOCOL_VERSION
    with pytest.raises(RelayRegistryError, match="already used"):
        heartbeat(registry, private, runtime_id, token)
    second = heartbeat(registry, private, runtime_id, token, "instance-b", "nonce-b")
    assert second.connection_generation == first.connection_generation + 1


def test_signed_heartbeat_nonce_has_one_winner_under_concurrency() -> None:
    registry = RelayRegistry()
    private, runtime_id, token = registered(registry)

    def send(_: int) -> str:
        try:
            heartbeat(registry, private, runtime_id, token, nonce="shared-nonce")
            return "ok"
        except RelayRegistryError as exc:
            return exc.code

    with ThreadPoolExecutor(max_workers=32) as pool:
        results = list(pool.map(send, range(100)))

    assert results.count("ok") == 1
    assert results.count("heartbeat_replay") == 99


def test_bad_signature_and_unknown_capability_are_rejected() -> None:
    registry = RelayRegistry()
    private, runtime_id, token = registered(registry)
    with pytest.raises(RelayRegistryError, match="unknown capability"):
        registry.heartbeat(runtime_id, token, instance_id="x", version="1", capabilities=frozenset({"root.shell"}),
                           backend_health={}, nonce="n", signature=b64(private.sign(f"{runtime_id}\nx\nn".encode())))
    other = Ed25519PrivateKey.generate()
    with pytest.raises(RelayRegistryError, match="invalid"):
        heartbeat(registry, other, runtime_id, token)


def test_key_rotation_requires_old_key_proof_and_rejects_replay() -> None:
    registry = RelayRegistry()
    old, runtime_id, token = registered(registry)
    new = Ed25519PrivateKey.generate()
    new_public = b64(new.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw))
    nonce = "rotate-once"
    signature = b64(old.sign(f"{runtime_id}\nrotate\n{new_public}\n{nonce}".encode()))
    registry.rotate_public_key(runtime_id, token, new_public_key=new_public, nonce=nonce, old_signature=signature)
    assert registry.audit[-1]["action"] == "runtime.key.rotate"
    with pytest.raises(RelayRegistryError, match="already used"):
        registry.rotate_public_key(runtime_id, token, new_public_key=new_public, nonce=nonce, old_signature=signature)
    assert heartbeat(registry, new, runtime_id, token, nonce="after-rotation").status == RuntimeStatus.ONLINE


def test_unhealthy_backend_sets_degraded_without_failing_remote_runs() -> None:
    registry = RelayRegistry()
    private, runtime_id, token = registered(registry)
    nonce = "degraded"
    signature = b64(private.sign(f"{runtime_id}\ninstance-a\n{nonce}".encode()))
    identity = registry.heartbeat(runtime_id, token, instance_id="instance-a", version="1",
                                  capabilities=frozenset(CAPABILITIES), backend_health={"codex": "unhealthy"},
                                  nonce=nonce, signature=signature)
    assert identity.status == RuntimeStatus.DEGRADED


def test_workspace_scope_is_runtime_qualified_and_client_path_is_absent() -> None:
    registry = RelayRegistry()
    _, runtime_a, token_a = registered(registry)
    _, runtime_b, token_b = registered(registry)
    _, code_a, _ = registry.issue_access_grant(runtime_a, token_a)
    _, code_b, _ = registry.issue_access_grant(runtime_b, token_b)
    associate(registry, "alice", code_a)
    associate(registry, "alice", code_b)
    registry.publish_workspaces(runtime_a, token_a, [Workspace(runtime_id=runtime_a, workspace_id="same", display_name="A")])
    registry.publish_workspaces(runtime_b, token_b, [Workspace(runtime_id=runtime_b, workspace_id="same", display_name="B")])
    assert registry.list_workspaces("alice", runtime_a)[0][0].display_name == "A"
    assert registry.list_workspaces("alice", runtime_b)[0][0].display_name == "B"
    with pytest.raises(Exception):
        Workspace(runtime_id=runtime_a, workspace_id="x", display_name="X", canonical_path="C:/secret")


def test_workspace_lifecycle_defaults_to_active_and_tombstones_do_not_reappear() -> None:
    registry = RelayRegistry()
    _, runtime_id, token = registered(registry)
    _, code, _ = registry.issue_access_grant(runtime_id, token)
    associate(registry, "alice", code)
    registry.publish_workspaces(runtime_id, token, [
        Workspace(runtime_id=runtime_id, workspace_id="active", display_name="Active"),
        Workspace(runtime_id=runtime_id, workspace_id="archived", display_name="Archived",
                  lifecycle=ResourceLifecycle.ARCHIVED, revision=2),
        Workspace(runtime_id=runtime_id, workspace_id="removed", display_name="Removed",
                  lifecycle=ResourceLifecycle.REMOVED, revision=3),
    ])

    assert [item.workspace_id for item in registry.list_workspaces("alice", runtime_id)[0]] == ["active"]
    assert [item.workspace_id for item in registry.list_workspaces(
        "alice", runtime_id, lifecycle=ResourceLifecycle.ARCHIVED)[0]] == ["archived"]
    with pytest.raises(RelayRegistryError) as archived:
        registry.authorize_workspace("alice", runtime_id, "archived")
    assert archived.value.code == "workspace_forbidden"
    with pytest.raises(RelayRegistryError):
        registry.authorize_workspace("alice", runtime_id, "removed")


def test_pagination_search_offline_and_revoke_audit() -> None:
    registry = RelayRegistry(offline_after_seconds=-1)
    private, runtime_id, token = registered(registry)
    _, grant, _ = registry.issue_access_grant(runtime_id, token)
    associate(registry, "alice", grant)
    heartbeat(registry, private, runtime_id, token)
    assert registry.identity("alice", runtime_id).status == RuntimeStatus.OFFLINE
    registry.publish_workspaces(runtime_id, token, [
        Workspace(runtime_id=runtime_id, workspace_id=f"ws-{i}", display_name=f"Project {i}") for i in range(3)
    ])
    page, cursor = registry.list_workspaces("alice", runtime_id, limit=2, query="Project")
    assert len(page) == 2 and cursor and cursor != "2"
    assert len(registry.list_workspaces(
        "alice", runtime_id, cursor=cursor, limit=2, query="Project"
    )[0]) == 1
    with pytest.raises(RelayRegistryError, match="cursor"):
        registry.list_workspaces("alice", runtime_id, cursor=cursor, limit=2)
    registry.revoke(runtime_id)
    with pytest.raises(RelayRegistryError):
        registry.identity("alice", runtime_id)
    assert registry.audit[-1] == {"action": "runtime.revoke", "runtime_id": runtime_id}


def test_workspace_keyset_cursor_is_opaque_bound_and_stable_across_catalog_mutation() -> None:
    registry = RelayRegistry(cursor_secret=b"k" * 32)
    _, runtime_id, token = registered(registry)
    _, grant, _ = registry.issue_access_grant(runtime_id, token)
    associate(registry, "alice", grant)
    original = [
        Workspace(runtime_id=runtime_id, workspace_id=f"ws-{index:03d}", display_name="Project")
        for index in range(5)
    ]
    registry.publish_workspaces(runtime_id, token, original)
    first, cursor = registry.list_workspaces(
        "alice", runtime_id, query="Project", limit=2
    )
    assert [item.workspace_id for item in first] == ["ws-000", "ws-001"]
    assert cursor and cursor != "2" and "ws-001" not in cursor

    # Delete the boundary item and insert an item before it. Keyset paging
    # still resumes strictly after the last observed key, with no duplicate.
    registry.publish_workspaces(runtime_id, token, [
        original[0],
        Workspace(runtime_id=runtime_id, workspace_id="ws-000a", display_name="Project"),
        *original[2:],
    ])
    second, _ = registry.list_workspaces(
        "alice", runtime_id, cursor=cursor, query="Project", limit=2
    )
    assert [item.workspace_id for item in second] == ["ws-002", "ws-003"]
    with pytest.raises(RelayRegistryError, match="cursor"):
        registry.list_workspaces(
            "alice", runtime_id, cursor=cursor[:-1] + ("A" if cursor[-1] != "A" else "B"),
            query="Project", limit=2,
        )
