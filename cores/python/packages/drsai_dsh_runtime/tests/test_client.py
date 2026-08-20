from __future__ import annotations

from pathlib import Path

import pytest

from opendrsai_dsh_runtime.client import OaepRuntimeClient, RuntimeClientError, RuntimeEndpoint
from opendrsai_dsh_runtime.control import RuntimeBinding, RuntimeControlService
from opendrsai_dsh_runtime.driver import NativeRunReceipt, NativeRuntimeIdentity
from opendrsai_dsh_runtime.oaep import OaepJournal
from opendrsai_dsh_runtime.profiles import CompatibilityDecision, ProtocolProfile
from opendrsai_dsh_runtime.store import RuntimeAuthorityStore
from opendrsai_dsh_runtime.transport import AsyncioLoopbackServer, ControlHttpApplication


TOKEN = "portable-client-test-token-" + "a" * 32


class Driver:
    def __init__(self) -> None:
        self.cancelled: list[tuple[str, str]] = []

    async def start_run(self, *, session_id: str, content_blocks):
        return NativeRunReceipt(session_id, "native-message-1")

    async def cancel_run(self, *, session_id: str, message_id: str) -> None:
        self.cancelled.append((session_id, message_id))

    async def resume_session(self, *, session_id: str):
        return {"sessionId": session_id, "disposition": "resumed"}

    async def session_history(self, *, session_id: str, from_sequence: int = 0):
        return {"meta": {"id": session_id}, "events": []}

    async def close(self) -> None:
        pass


def _service(tmp_path: Path):
    profile = ProtocolProfile.from_mapping({
        "schema_version": 1,
        "profile_id": "dsh-sdk/client-test",
        "server_name": "deepseek-harness-sdk-runtime",
        "supported_versions": ["client-test"],
        "source_commits": ["a" * 40],
        "native_contract_sha256": "c" * 64,
        "required_methods": ["initialize"],
        "required_notifications": ["session.event"],
        "required_capabilities": ["run.cancel"],
        "mapping_version": "dsh-oaep/client-test",
        "event_disposition_sha256": "d" * 64,
        "production_ready": True,
        "blockers": [],
    })
    store = RuntimeAuthorityStore(tmp_path / "runtime.sqlite3")
    driver = Driver()
    service = RuntimeControlService(
        store=store,
        journal=OaepJournal(store),
        driver=driver,
        native_identity=NativeRuntimeIdentity(
            profile.server_name, "client-test", profile.native_contract_sha256,
            frozenset(profile.required_methods), frozenset(profile.required_notifications),
            frozenset(profile.required_capabilities),
        ),
        compatibility=CompatibilityDecision("production", "compatible", profile),
        binding=RuntimeBinding(
            runtime_id="runtime-client-test", generation=1, workspace_root=tmp_path,
            workspace_id="workspace-client", workspace_fingerprint="f" * 64,
            native_profile=profile.profile_id, mapping_version=profile.mapping_version,
        ),
    )
    return service, store, driver


@pytest.mark.asyncio
async def test_portable_client_drives_control_and_validates_oaep(tmp_path: Path) -> None:
    service, store, driver = _service(tmp_path)
    server = AsyncioLoopbackServer(ControlHttpApplication(service, bearer_token=TOKEN))
    host, port = await server.start()
    client = OaepRuntimeClient(RuntimeEndpoint(f"http://{host}:{port}", TOKEN))
    try:
        initialized = await client.initialize()
        assert initialized["availability"] == "production"
        created = await client.create_session(idempotency_key="session-key")
        session_id = created["session"]["id"]
        started = await client.start_run(
            session_id, idempotency_key="run-key", content_blocks=[{"type": "text", "text": "hello"}]
        )
        page = await client.events(session_id)
        assert [event["type"] for event in page["data"]] == ["event.session.created", "event.run.created"]
        stream = client.watch(session_id, after_sequence=0, wait_seconds=0)
        first = await anext(stream)
        assert first["sequence"] == 1
        await stream.aclose()
        snapshot = await client.snapshot(session_id)
        assert snapshot["snapshot_sequence"] == 2
        await client.cancel_run(started["run_id"])
        assert driver.cancelled == [(session_id, "native-message-1")]
        resumed = await client.resume_session(session_id)
        assert resumed["snapshot"]["session"]["id"] == session_id
    finally:
        await server.close()
        store.close()


@pytest.mark.asyncio
async def test_client_rejects_wrong_secret_and_non_loopback_endpoint(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="loopback"):
        RuntimeEndpoint("http://192.0.2.1:8080", TOKEN)
    service, store, _ = _service(tmp_path)
    server = AsyncioLoopbackServer(ControlHttpApplication(service, bearer_token=TOKEN))
    host, port = await server.start()
    try:
        client = OaepRuntimeClient(RuntimeEndpoint(f"http://{host}:{port}", "b" * 48))
        with pytest.raises(RuntimeClientError) as rejected:
            await client.health()
        assert (rejected.value.status, rejected.value.code) == (401, "unauthorized")
    finally:
        await server.close()
        store.close()
