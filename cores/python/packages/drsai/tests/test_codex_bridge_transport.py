import asyncio
import json
import time

import pytest

from drsai.backend.codex_adapter.bridge_transport import (
    MAX_BRIDGE_LINE_BYTES,
    BRIDGE_PROTOCOL,
    BridgeReplayGuard,
    RemoteCodexSupervisor,
    authenticate_bridge,
    issue_bridge_token,
    token_not_expired,
    validate_bridge_bind_host,
    validate_client_message,
)


def test_bridge_method_allowlist():
    validate_client_message({"id": 1, "method": "thread/start", "params": {}})
    validate_client_message({"id": 2, "method": "thread/list", "params": {"cwd": "C:/workspace"}})
    validate_client_message({"id": 1, "result": {}})
    with pytest.raises(ValueError):
        validate_client_message({"id": 1, "method": "filesystem/read", "params": {}})
    assert MAX_BRIDGE_LINE_BYTES == 16 * 1024 * 1024


def test_remote_supervisor_rejects_invalid_url_and_empty_token():
    token = f"v1.{int(time.time()) + 60}.{'x' * 32}"
    with pytest.raises(ValueError):
        RemoteCodexSupervisor("http://127.0.0.1:1", token)
    with pytest.raises(ValueError):
        RemoteCodexSupervisor("tcp://127.0.0.1:18643", "")
    with pytest.raises(ValueError):
        RemoteCodexSupervisor("tcp://192.0.2.1:18643", token)


def test_bridge_tokens_and_bind_address_are_fail_closed():
    issued = issue_bridge_token(lifetime_seconds=60, now=100)
    assert token_not_expired(issued, now=159)
    assert not token_not_expired(issued, now=161)
    assert token_not_expired(f"v1.200.{'x' * 32}", now=100)
    assert not token_not_expired(f"v1.99.{'x' * 32}", now=100)
    assert not token_not_expired("legacy-secret")
    validate_bridge_bind_host("127.0.0.1")
    with pytest.raises(ValueError):
        validate_bridge_bind_host("0.0.0.0")
    validate_bridge_bind_host("0.0.0.0", development=True)


def test_bridge_authentication_uses_constant_time_token_check():
    async def exercise():
        expected = f"v1.{int(time.time()) + 60}.{'a' * 32}"
        replay_guard = BridgeReplayGuard()
        identity = {"codexVersion": "1.2.3", "schemaDigest": "sha256:schema",
                    "binaryDigest": "sha256:binary", "hostId": "host-a"}

        async def handler(reader, writer):
            accepted = await authenticate_bridge(reader, writer, expected, identity=identity, replay_guard=replay_guard)
            if not accepted:
                writer.write(b'{"op":"denied"}\n')
                await writer.drain()
            writer.close()

        server = await asyncio.start_server(handler, "127.0.0.1", 0)
        port = server.sockets[0].getsockname()[1]
        async with server:
            supervisor = RemoteCodexSupervisor(f"tcp://127.0.0.1:{port}", expected)
            process = await supervisor.start()
            assert process.returncode is None
            assert supervisor.binary is not None
            assert supervisor.binary.version == "1.2.3"
            assert process.identity["adapterProtocol"] == BRIDGE_PROTOCOL
            await supervisor.close()

    asyncio.run(exercise())


def test_bridge_rejects_replayed_nonce_and_wrong_host():
    async def exercise():
        expected = f"v1.{int(time.time()) + 60}.{'b' * 32}"
        guard = BridgeReplayGuard()
        identity = {"codexVersion": "1", "schemaDigest": "schema", "binaryDigest": "binary", "hostId": "host-a"}

        async def exchange(nonce: str, host_id: str | None = None) -> bool:
            result = False
            async def handler(reader, writer):
                nonlocal result
                result = await authenticate_bridge(reader, writer, expected, identity=identity, replay_guard=guard)
                writer.close()
            server = await asyncio.start_server(handler, "127.0.0.1", 0)
            port = server.sockets[0].getsockname()[1]
            async with server:
                reader, writer = await asyncio.open_connection("127.0.0.1", port)
                writer.write((__import__("json").dumps({"op": "authenticate", "token": expected,
                    "nonce": nonce, "adapterProtocol": BRIDGE_PROTOCOL,
                    **({"hostId": host_id} if host_id else {})}) + "\n").encode())
                await writer.drain(); await reader.readline(); writer.close(); await writer.wait_closed()
            return result

        nonce = "n" * 64
        assert await exchange(nonce)
        assert not await exchange(nonce)
        assert not await exchange("m" * 64, "host-b")

    asyncio.run(exercise())


def test_loopback_bridge_preserves_native_jsonrpc_semantics_byte_for_byte():
    async def exercise():
        token = f"v1.{int(time.time()) + 60}.{'c' * 32}"
        identity = {"codexVersion": "1.2.3", "schemaDigest": "sha256:schema",
                    "binaryDigest": "sha256:binary", "hostId": "linux-fixture-host"}
        guard = BridgeReplayGuard()
        native_result = {"thread": {"id": "same-thread", "turns": [{"id": "turn-1", "status": "completed"}]}}

        async def handler(reader, writer):
            if not await authenticate_bridge(reader, writer, token, identity=identity, replay_guard=guard):
                writer.close(); return
            raw = await reader.readline()
            request = json.loads(raw)
            validate_client_message(request)
            writer.write((json.dumps({"id": request["id"], "result": native_result},
                                     separators=(",", ":")) + "\n").encode())
            await writer.drain(); writer.close()

        server = await asyncio.start_server(handler, "127.0.0.1", 0)
        port = server.sockets[0].getsockname()[1]
        async with server:
            supervisor = RemoteCodexSupervisor(f"tcp://127.0.0.1:{port}", token,
                                               expected_host_id="linux-fixture-host")
            process = await supervisor.start()
            request = {"id": 7, "method": "thread/read", "params": {"threadId": "same-thread"}}
            process.stdin.write((json.dumps(request, separators=(",", ":")) + "\n").encode())
            await process.stdin.drain()
            bridged = json.loads(await process.stdout.readline())
            assert bridged == {"id": 7, "result": native_result}
            assert process.identity["hostId"] == "linux-fixture-host"
            await supervisor.close()

    asyncio.run(exercise())
