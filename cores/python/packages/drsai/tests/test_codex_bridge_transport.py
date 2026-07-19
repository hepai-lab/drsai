import asyncio

import pytest

from drsai.backend.codex_adapter.bridge_transport import (
    RemoteCodexSupervisor,
    authenticate_bridge,
    validate_client_message,
)


def test_bridge_method_allowlist():
    validate_client_message({"id": 1, "method": "thread/start", "params": {}})
    validate_client_message({"id": 1, "result": {}})
    with pytest.raises(ValueError):
        validate_client_message({"id": 1, "method": "filesystem/read", "params": {}})


def test_remote_supervisor_rejects_invalid_url_and_empty_token():
    with pytest.raises(ValueError):
        RemoteCodexSupervisor("http://127.0.0.1:1", "x" * 32)
    with pytest.raises(ValueError):
        RemoteCodexSupervisor("tcp://127.0.0.1:18643", "")


def test_bridge_authentication_uses_constant_time_token_check():
    async def exercise():
        expected = "a" * 32

        async def handler(reader, writer):
            accepted = await authenticate_bridge(reader, writer, expected)
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
            await supervisor.close()

    asyncio.run(exercise())
