from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from opendrsai_dsh_runtime.driver import (
    CURRENT_CAPABILITIES,
    CURRENT_NOTIFICATIONS,
    EXTENSION_CAPABILITIES,
    EXTENSION_METHODS,
    HarnessSdkDriver,
    NativeCapabilityUnavailable,
)
from opendrsai_dsh_runtime.jsonrpc import JsonRpcPeer, JsonRpcProtocolError, decode_frame, encode_frame
from opendrsai_dsh_runtime.profiles import ProtocolProfileRegistry


class DriverTransport:
    def __init__(self) -> None:
        self.inbound: asyncio.Queue[bytes] = asyncio.Queue()
        self.outbound: asyncio.Queue[bytes] = asyncio.Queue()

    async def readline(self) -> bytes:
        return await self.inbound.get()

    async def write_line(self, line: bytes) -> None:
        await self.outbound.put(line)

    async def close(self) -> None:
        return None

    async def request(self) -> dict[str, object]:
        return decode_frame(await self.outbound.get())

    async def respond(self, request: dict[str, object], result: object) -> None:
        await self.inbound.put(encode_frame({"jsonrpc": "2.0", "id": request["id"], "result": result}))


@pytest.mark.asyncio
async def test_driver_initializes_and_enqueues_prompt(tmp_path: Path) -> None:
    profile = ProtocolProfileRegistry.bundled().profiles[0]
    transport = DriverTransport()
    peer = JsonRpcPeer(transport, generation=3)
    driver = HarnessSdkDriver(peer, contract_sha256=profile.native_contract_sha256)

    initialize = asyncio.create_task(driver.initialize(cwd=tmp_path, provider="deepseek", model="deepseek-chat"))
    request = await transport.request()
    assert request["method"] == "initialize"
    assert request["params"] == {"cwd": str(tmp_path.resolve()), "provider": "deepseek", "model": "deepseek-chat"}
    await transport.respond(request, {"serverInfo": {"name": "deepseek-harness-sdk-runtime", "version": "0.0.1"}})
    identity = await initialize
    assert identity.capabilities == CURRENT_CAPABILITIES

    prompt = asyncio.create_task(driver.start_run(
        session_id="session-1", content_blocks=[{"type": "text", "text": "hello"}]
    ))
    request = await transport.request()
    assert request["method"] == "session/prompt"
    await transport.respond(request, {"messageId": "message-1"})
    receipt = await prompt
    assert receipt.session_id == "session-1" and receipt.message_id == "message-1"

    with pytest.raises(NativeCapabilityUnavailable):
        await driver.cancel_run(session_id="session-1", message_id="message-1")

    shutdown = asyncio.create_task(driver.close())
    request = await transport.request()
    assert request["method"] == "shutdown"
    await transport.respond(request, {})
    await shutdown


@pytest.mark.asyncio
async def test_extension_driver_negotiates_and_invokes_control_surface(tmp_path: Path) -> None:
    profile = next(
        item for item in ProtocolProfileRegistry.bundled().profiles
        if item.profile_id.endswith("+opendrsai.1")
    )
    transport = DriverTransport()
    driver = HarnessSdkDriver(
        JsonRpcPeer(transport, generation=4), contract_sha256=profile.native_contract_sha256
    )
    initialize = asyncio.create_task(driver.initialize(cwd=tmp_path, provider="deepseek", model="chat"))
    request = await transport.request()
    await transport.respond(request, {
        "serverInfo": {"name": "deepseek-harness-sdk-runtime", "version": "0.1.0-opendrsai.1"},
        "protocol": {
            "methods": sorted(EXTENSION_METHODS),
            "notifications": sorted(CURRENT_NOTIFICATIONS),
            "capabilities": sorted(EXTENSION_CAPABILITIES),
        },
    })
    identity = await initialize
    assert identity.methods == EXTENSION_METHODS
    assert identity.capabilities == EXTENSION_CAPABILITIES

    cancel = asyncio.create_task(driver.cancel_run(session_id="session-1", message_id="message-1"))
    request = await transport.request()
    assert request["method"] == "session/cancel"
    await transport.respond(request, {"disposition": "active-cancelling"})
    await cancel

    resume = asyncio.create_task(driver.resume_session(session_id="session-1"))
    request = await transport.request()
    await transport.respond(request, {"sessionId": "session-1", "disposition": "resumed"})
    assert (await resume)["disposition"] == "resumed"

    history = asyncio.create_task(driver.session_history(session_id="session-1", from_sequence=2))
    request = await transport.request()
    assert request["params"]["fromSequence"] == 2
    await transport.respond(request, {"meta": {"id": "session-1"}, "events": []})
    assert (await history)["events"] == []

    attestation = asyncio.create_task(driver.workspace_attestation(session_id="session-1"))
    request = await transport.request()
    await transport.respond(request, {
        "policy": {"mode": "workspace-write", "workspaceRoot": str(tmp_path)},
        "enforcement": "full", "contained": True,
    })
    assert (await attestation)["contained"] is True

    shutdown = asyncio.create_task(driver.close())
    request = await transport.request()
    await transport.respond(request, {})
    await shutdown


@pytest.mark.asyncio
async def test_driver_rejects_invalid_identity_and_unknown_notifications(tmp_path: Path) -> None:
    profile = ProtocolProfileRegistry.bundled().profiles[0]
    transport = DriverTransport()
    driver = HarnessSdkDriver(JsonRpcPeer(transport, generation=1), contract_sha256=profile.native_contract_sha256)
    initialize = asyncio.create_task(driver.initialize(cwd=tmp_path, provider="deepseek", model="deepseek-chat"))
    request = await transport.request()
    await transport.respond(request, {"serverInfo": {"name": "not-harness", "version": "0.0.1"}})
    with pytest.raises(JsonRpcProtocolError):
        await initialize

    transport2 = DriverTransport()
    peer2 = JsonRpcPeer(transport2, generation=2)
    driver2 = HarnessSdkDriver(peer2, contract_sha256=profile.native_contract_sha256)
    peer2.start()
    await transport2.inbound.put(encode_frame({"jsonrpc": "2.0", "method": "new.unknown", "params": {}}))
    with pytest.raises(JsonRpcProtocolError):
        await driver2.next_fact(timeout=1)
    await peer2.close()
