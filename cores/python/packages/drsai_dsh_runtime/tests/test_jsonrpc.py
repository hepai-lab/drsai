from __future__ import annotations

import asyncio
from collections.abc import Mapping

import pytest

from opendrsai_dsh_runtime.jsonrpc import (
    JsonRpcConnectionClosed,
    JsonRpcNotification,
    JsonRpcPeer,
    JsonRpcProtocolError,
    JsonRpcRemoteError,
    decode_frame,
    encode_frame,
)


class MemoryLineTransport:
    def __init__(self) -> None:
        self.inbound: asyncio.Queue[bytes] = asyncio.Queue()
        self.outbound: asyncio.Queue[bytes] = asyncio.Queue()
        self.closed = False

    async def readline(self) -> bytes:
        return await self.inbound.get()

    async def write_line(self, line: bytes) -> None:
        if self.closed:
            raise JsonRpcConnectionClosed("fixture closed")
        await self.outbound.put(line)

    async def close(self) -> None:
        self.closed = True

    async def receive_outbound(self) -> dict[str, object]:
        return decode_frame(await self.outbound.get())

    async def send(self, frame: Mapping[str, object]) -> None:
        await self.inbound.put(encode_frame(frame))


def test_frame_codec_rejects_invalid_and_oversized_frames() -> None:
    with pytest.raises(JsonRpcProtocolError):
        decode_frame(b'{"jsonrpc":"1.0"}\n')
    with pytest.raises(JsonRpcProtocolError):
        decode_frame(b"{}")
    with pytest.raises(JsonRpcProtocolError):
        decode_frame(b'{"jsonrpc":"2.0"}\n', max_bytes=4)
    with pytest.raises(JsonRpcProtocolError):
        encode_frame({"jsonrpc": "2.0", "value": float("nan")})


@pytest.mark.asyncio
async def test_peer_routes_out_of_order_responses_and_notifications() -> None:
    transport = MemoryLineTransport()
    peer = JsonRpcPeer(transport, generation=7)
    first = asyncio.create_task(peer.request("first", {"n": 1}))
    second = asyncio.create_task(peer.request("second", {"n": 2}))
    one = await transport.receive_outbound()
    two = await transport.receive_outbound()
    assert (one["method"], two["method"]) == ("first", "second")
    await transport.send({"jsonrpc": "2.0", "id": two["id"], "result": {"ok": 2}})
    await transport.send({"jsonrpc": "2.0", "method": "session.status", "params": {"status": "running"}})
    await transport.send({"jsonrpc": "2.0", "id": one["id"], "result": {"ok": 1}})
    assert await first == {"ok": 1}
    assert await second == {"ok": 2}
    assert await peer.next_notification() == JsonRpcNotification(
        "session.status", {"status": "running"}, 7
    )
    await peer.close()


@pytest.mark.asyncio
async def test_remote_error_and_unknown_response_fail_closed() -> None:
    transport = MemoryLineTransport()
    peer = JsonRpcPeer(transport, generation=1)
    request = asyncio.create_task(peer.request("fails"))
    outbound = await transport.receive_outbound()
    await transport.send({
        "jsonrpc": "2.0",
        "id": outbound["id"],
        "error": {"code": -32001, "message": "safe failure", "data": {"kind": "fixture"}},
    })
    with pytest.raises(JsonRpcRemoteError) as captured:
        await request
    assert captured.value.code == -32001

    peer2_transport = MemoryLineTransport()
    peer2 = JsonRpcPeer(peer2_transport, generation=2)
    peer2.start()
    await peer2_transport.send({"jsonrpc": "2.0", "id": 999, "result": {}})
    with pytest.raises(JsonRpcProtocolError):
        await peer2.next_notification(timeout=1)
    await peer.close()
    await peer2.close()


@pytest.mark.asyncio
async def test_unsupported_server_request_gets_method_not_found() -> None:
    transport = MemoryLineTransport()
    peer = JsonRpcPeer(transport, generation=1)
    peer.start()
    await transport.send({"jsonrpc": "2.0", "id": "approval-1", "method": "approval/request", "params": {}})
    response = await transport.receive_outbound()
    assert response == {
        "jsonrpc": "2.0",
        "id": "approval-1",
        "error": {"code": -32601, "message": "Method not supported"},
    }
    await peer.close()


@pytest.mark.asyncio
async def test_production_server_request_handler_returns_correlated_answer() -> None:
    transport = MemoryLineTransport()
    calls = []

    async def handle(method, params):
        calls.append((method, params))
        return {"outcome": "accept"}

    peer = JsonRpcPeer(transport, generation=4, server_request_handler=handle)
    peer.start()
    await transport.send({
        "jsonrpc": "2.0",
        "id": "approval-1",
        "method": "approval/request",
        "params": {"approvalId": "approval-1"},
    })
    response = await transport.receive_outbound()
    assert calls == [("approval/request", {"approvalId": "approval-1"})]
    assert response == {
        "jsonrpc": "2.0",
        "id": "approval-1",
        "result": {"outcome": "accept"},
    }
    await peer.close()


@pytest.mark.asyncio
async def test_malformed_input_fails_all_pending_requests() -> None:
    transport = MemoryLineTransport()
    peer = JsonRpcPeer(transport, generation=1)
    pending = asyncio.create_task(peer.request("pending"))
    await transport.receive_outbound()
    await transport.inbound.put(b"not-json\n")
    with pytest.raises(JsonRpcProtocolError):
        await pending
    assert peer.closed
    await peer.close()
