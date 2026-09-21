from __future__ import annotations

from pathlib import Path

import pytest

from opendrsai_dsh_runtime.contracts import CONTROL_SCHEMA_SHA256, OAEP_SCHEMA_SHA256
from opendrsai_dsh_runtime.control import ControlError, RuntimeBinding, RuntimeControlService
from opendrsai_dsh_runtime.driver import NativeRunReceipt, NativeRuntimeIdentity
from opendrsai_dsh_runtime.oaep import OaepJournal
from opendrsai_dsh_runtime.profiles import CompatibilityDecision, ProtocolProfile
from opendrsai_dsh_runtime.store import RuntimeAuthorityStore


class FakeDriver:
    def __init__(self, *, fail_start: bool = False):
        self.fail_start = fail_start
        self.closed = False
        self.cancelled: list[tuple[str, str]] = []
        self.resumed: list[str] = []

    async def start_run(self, *, session_id: str, content_blocks):
        if self.fail_start:
            raise ConnectionError("receipt lost")
        return NativeRunReceipt(session_id, "message-1")

    async def cancel_run(self, *, session_id: str, message_id: str) -> None:
        self.cancelled.append((session_id, message_id))

    async def resume_session(self, *, session_id: str):
        self.resumed.append(session_id)
        return {"sessionId": session_id, "disposition": "resumed"}

    async def session_history(self, *, session_id: str, from_sequence: int = 0):
        return {"meta": {"id": session_id}, "events": [], "from_sequence": from_sequence}

    async def close(self) -> None:
        self.closed = True


def _profile(*, production: bool = True) -> ProtocolProfile:
    blockers = [] if production else ["test blocker"]
    return ProtocolProfile.from_mapping({
        "schema_version": 1,
        "profile_id": "dsh-sdk/test-v2",
        "server_name": "deepseek-harness-sdk-runtime",
        "supported_versions": ["test-v2"],
        "source_commits": ["a" * 40],
        "native_contract_sha256": "c" * 64,
        "required_methods": ["initialize"],
        "required_notifications": ["session.event"],
        "required_capabilities": ["run.cancel"],
        "mapping_version": "dsh-oaep/test-v2",
        "event_disposition_sha256": "d" * 64,
        "production_ready": production,
        "blockers": blockers,
    })


def _service(tmp_path: Path, *, production: bool = True, fail_start: bool = False):
    store = RuntimeAuthorityStore(tmp_path / "runtime.sqlite3")
    profile = _profile(production=production)
    compatibility = CompatibilityDecision(
        "production" if production else "probe_only",
        "compatible" if production else "profile_has_release_blockers",
        profile,
    )
    identity = NativeRuntimeIdentity(
        "deepseek-harness-sdk-runtime", "test-v2", "c" * 64,
        frozenset({"initialize"}), frozenset({"session.event"}), frozenset({"run.cancel"}),
    )
    driver = FakeDriver(fail_start=fail_start)
    service = RuntimeControlService(
        store=store,
        journal=OaepJournal(store),
        driver=driver,
        native_identity=identity,
        compatibility=compatibility,
        binding=RuntimeBinding(
            runtime_id="runtime-test",
            generation=1,
            workspace_root=tmp_path,
            workspace_id="workspace-1",
            workspace_fingerprint="f" * 64,
            native_profile=profile.profile_id,
            mapping_version=profile.mapping_version,
        ),
    )
    return service, store, driver


def _create(service: RuntimeControlService) -> dict:
    return service.create_session({"idempotency_key": "session-key"})


def test_initialize_negotiates_exact_public_contract_and_safe_health(tmp_path: Path) -> None:
    service, store, _ = _service(tmp_path)
    result = service.initialize({
        "control": {"version": "1", "schema_sha256": CONTROL_SCHEMA_SHA256},
        "oaep": {
            "version": "1.0", "profiles": ["oaep.session-stream/1"],
            "schema_sha256": OAEP_SCHEMA_SHA256,
        },
    })
    assert result["availability"] == "production"
    assert "session.create" in result["capabilities"]
    assert "workspace_root" not in str(service.health())
    assert service.initialize({
        "control": {"version": "1"},
        "oaep": {
            "version": "1.0", "profiles": ["oaep.session-stream/1"],
            "schema_sha256": OAEP_SCHEMA_SHA256,
        },
    })["availability"] == "production"
    with pytest.raises(ControlError, match="Control identity"):
        service.initialize({
            "control": {"version": "1", "schema_sha256": "0" * 64},
            "oaep": {
                "version": "1.0", "profiles": ["oaep.session-stream/1"],
                "schema_sha256": OAEP_SCHEMA_SHA256,
            },
        })
    with pytest.raises(ControlError, match="OAEP schema digest"):
        service.initialize({
            "control": {"version": "1", "schema_sha256": CONTROL_SCHEMA_SHA256},
            "oaep": {"version": "1.0", "profiles": ["oaep.session-stream/1"], "schema_sha256": "0" * 64},
        })
    store.close()


def test_probe_only_profile_is_observable_but_refuses_admission(tmp_path: Path) -> None:
    service, store, _ = _service(tmp_path, production=False)
    assert service.health()["status"] == "degraded"
    assert "session.create" not in service.initialize()["capabilities"]
    with pytest.raises(ControlError) as rejected:
        _create(service)
    assert rejected.value.code == "native_profile_not_production"
    store.close()


@pytest.mark.asyncio
async def test_session_create_and_resume_are_idempotent_and_binding_exact(tmp_path: Path) -> None:
    service, store, driver = _service(tmp_path)
    first = _create(service)
    assert _create(service) == first
    session_id = first["session"]["id"]
    resumed = await service.resume_session({"session_id": session_id})
    assert resumed["snapshot"]["snapshot_sequence"] == 1
    assert resumed["snapshot"]["session"] == first["session"]
    assert resumed["native_history"]["meta"]["id"] == session_id
    assert driver.resumed == [session_id]
    store.close()


@pytest.mark.asyncio
async def test_session_archive_is_idempotent_flushes_projection_and_stops_admission(tmp_path: Path) -> None:
    service, store, _ = _service(tmp_path)
    session_id = _create(service)["session"]["id"]
    params = {"session_id": session_id, "idempotency_key": "archive-key"}
    result = service.archive_session(params)
    assert result["session"]["status"] == "archived"
    assert service.archive_session(params) == result
    snapshot = service.journal.snapshot(session_id)
    assert snapshot["session"]["status"] == "archived"
    assert service.journal.event_page(session_id)["data"][-1]["type"] == "event.session.archived"
    with pytest.raises(ControlError) as resume:
        await service.resume_session({"session_id": session_id})
    assert resume.value.code == "session_resume_incompatible"
    store.close()


@pytest.mark.asyncio
async def test_run_start_persists_receipt_without_inventing_terminal(tmp_path: Path) -> None:
    service, store, driver = _service(tmp_path)
    session_id = _create(service)["session"]["id"]
    result = await service.start_run({
        "session_id": session_id,
        "idempotency_key": "run-key",
        "content_blocks": [{"type": "text", "text": "hello"}],
    })
    assert result["status"] == "starting"
    assert await service.start_run({
        "session_id": session_id,
        "idempotency_key": "run-key",
        "content_blocks": [{"type": "text", "text": "hello"}],
    }) == result
    binding = store.require_native_run_binding(result["run_id"])
    assert binding["native_message_id"] == "message-1"
    assert store.require_run(result["run_id"])["status"] == "starting"
    assert service.journal.event_page(session_id)["data"][-1]["type"] == "event.run.created"
    await service.cancel_run({"run_id": result["run_id"]})
    assert driver.cancelled == [(session_id, "message-1")]
    assert store.require_run(result["run_id"])["status"] == "starting"
    store.close()


@pytest.mark.asyncio
async def test_lost_native_receipt_is_outcome_unknown_and_never_blindly_retried(tmp_path: Path) -> None:
    service, store, _ = _service(tmp_path, fail_start=True)
    session_id = _create(service)["session"]["id"]
    params = {
        "session_id": session_id,
        "idempotency_key": "uncertain",
        "content_blocks": [{"type": "text", "text": "hello"}],
    }
    with pytest.raises(ConnectionError):
        await service.start_run(params)
    operation = store.unresolved_operations()[0]
    assert operation["state"] == "outcome_unknown"
    assert store.require_run(operation["run_id"])["status"] == "outcome_unknown"
    with pytest.raises(ControlError) as replay:
        await service.start_run(params)
    assert replay.value.code == "operation_outcome_unknown"
    store.close()


@pytest.mark.asyncio
async def test_shutdown_is_bounded_at_control_boundary_and_idempotent(tmp_path: Path) -> None:
    service, store, driver = _service(tmp_path)
    assert await service.shutdown() == {"status": "stopped"}
    assert await service.shutdown() == {"status": "stopped"}
    assert driver.closed
    with pytest.raises(ControlError, match="stopped"):
        _create(service)
    store.close()
