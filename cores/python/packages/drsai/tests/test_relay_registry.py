from __future__ import annotations

import base64
from datetime import UTC, datetime, timedelta

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from drsai.relay.generated_contract import CAPABILITIES, PROTOCOL_VERSION
from drsai.relay.models import RuntimeStatus, Workspace
from drsai.relay.registry import RelayRegistry, RelayRegistryError


def b64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode()


def registered(registry: RelayRegistry):
    private = Ed25519PrivateKey.generate()
    public = private.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    code = registry.issue_registration_code()
    runtime_id, token = registry.register(code, "Office PC", "1.4.6", b64(public), f"register-{id(private)}")
    return private, runtime_id, token


def heartbeat(registry: RelayRegistry, private: Ed25519PrivateKey, runtime_id: str, token: str,
              instance: str = "instance-a", nonce: str = "nonce-a"):
    signature = b64(private.sign(f"{runtime_id}\n{instance}\n{nonce}".encode()))
    return registry.heartbeat(runtime_id, token, instance_id=instance, version="1.4.6",
                              capabilities=frozenset(CAPABILITIES), backend_health={"codex": "healthy"},
                              nonce=nonce, signature=signature)


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
    assert registry.associate("alice", code) == runtime_id
    assert registry.access_grant_status(runtime_id, token, grant_id)[0] == "consumed"
    with pytest.raises(RelayRegistryError) as consumed:
        registry.associate("bob", code)
    assert consumed.value.code == "access_grant_consumed"
    assert [x.runtime.runtime_id for x in registry.list_runtimes("alice")[0]] == [runtime_id]
    assert registry.list_runtimes("bob")[0] == []


def test_access_grant_refresh_revokes_previous_and_revoke_is_idempotent() -> None:
    registry = RelayRegistry()
    _, runtime_id, token = registered(registry)
    first_id, first_code, _ = registry.issue_access_grant(runtime_id, token)
    second_id, second_code, _ = registry.issue_access_grant(runtime_id, token)
    assert registry.access_grant_status(runtime_id, token, first_id)[0] == "revoked"
    assert registry.access_grant_status(runtime_id, token, second_id)[0] == "pending"
    with pytest.raises(RelayRegistryError) as revoked:
        registry.associate("alice", first_code)
    assert revoked.value.code == "access_grant_revoked"
    assert registry.revoke_access_grant(runtime_id, token, second_id)[0] == "revoked"
    assert registry.revoke_access_grant(runtime_id, token, second_id)[0] == "revoked"
    with pytest.raises(RelayRegistryError) as revoked_second:
        registry.associate("alice", second_code)
    assert revoked_second.value.code == "access_grant_revoked"


def test_access_grant_status_is_runtime_scoped_and_expires() -> None:
    registry = RelayRegistry()
    _, runtime_id, token = registered(registry)
    registry.code_ttl = timedelta(seconds=-1)
    grant_id, expired_code, _ = registry.issue_access_grant(runtime_id, token)
    assert registry.access_grant_status(runtime_id, token, grant_id)[0] == "expired"
    with pytest.raises(RelayRegistryError) as expired:
        registry.associate("alice", expired_code)
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
    registry.associate("alice", code_a)
    registry.associate("alice", code_b)
    registry.publish_workspaces(runtime_a, token_a, [Workspace(runtime_id=runtime_a, workspace_id="same", display_name="A")])
    registry.publish_workspaces(runtime_b, token_b, [Workspace(runtime_id=runtime_b, workspace_id="same", display_name="B")])
    assert registry.list_workspaces("alice", runtime_a)[0][0].display_name == "A"
    assert registry.list_workspaces("alice", runtime_b)[0][0].display_name == "B"
    with pytest.raises(Exception):
        Workspace(runtime_id=runtime_a, workspace_id="x", display_name="X", canonical_path="C:/secret")


def test_pagination_search_offline_and_revoke_audit() -> None:
    registry = RelayRegistry(offline_after_seconds=-1)
    private, runtime_id, token = registered(registry)
    _, grant, _ = registry.issue_access_grant(runtime_id, token)
    registry.associate("alice", grant)
    heartbeat(registry, private, runtime_id, token)
    assert registry.identity("alice", runtime_id).status == RuntimeStatus.OFFLINE
    registry.publish_workspaces(runtime_id, token, [
        Workspace(runtime_id=runtime_id, workspace_id=f"ws-{i}", display_name=f"Project {i}") for i in range(3)
    ])
    page, cursor = registry.list_workspaces("alice", runtime_id, limit=2, query="Project")
    assert len(page) == 2 and cursor == "2"
    assert len(registry.list_workspaces("alice", runtime_id, cursor=cursor, limit=2)[0]) == 1
    registry.revoke(runtime_id)
    with pytest.raises(RelayRegistryError):
        registry.identity("alice", runtime_id)
    assert registry.audit[-1] == {"action": "runtime.revoke", "runtime_id": runtime_id}
