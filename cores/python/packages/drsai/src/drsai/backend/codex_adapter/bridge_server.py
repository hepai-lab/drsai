"""Host-side authenticated bridge for Sandbox OpenDrSai acceptance."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
from contextlib import suppress
from pathlib import Path

from drsai.backend.codex_adapter.app_server_process import CodexAppServerProcess
from drsai.backend.codex_adapter.binary_provider import CodexArtifactStore, CodexBinaryProvider, load_trusted_publishers
from drsai.backend.codex_adapter.bridge_transport import MAX_BRIDGE_LINE_BYTES, authenticate_bridge, validate_client_message


def _supervisor(state_root: Path) -> CodexAppServerProcess:
    codex_root = state_root / "runtime" / "codex"
    trust_path = codex_root / "trusted-publishers.json"
    publishers = load_trusted_publishers(trust_path) if trust_path.exists() else {}
    development = os.environ.get("DRSAI_CODEX_DEVELOPMENT") == "1"
    provider = CodexBinaryProvider(
        CodexArtifactStore(codex_root / "artifacts", publishers),
        mode="development" if development else "product", environ=os.environ,
    )
    return CodexAppServerProcess(provider, verify_binary=not development)


async def serve_bridge(host: str, port: int, token: str, state_root: Path) -> None:
    if len(token) < 32:
        raise ValueError("Bridge token must contain at least 32 characters.")
    active = asyncio.Lock()

    async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        if not await authenticate_bridge(reader, writer, token):
            writer.close()
            await writer.wait_closed()
            return
        if active.locked():
            writer.write(b'{"op":"error","code":"bridge_busy"}\n')
            await writer.drain()
            writer.close()
            await writer.wait_closed()
            return
        async with active:
            supervisor = _supervisor(state_root)
            process = None
            upstream_task = None
            try:
                process = await supervisor.start()

                async def upstream() -> None:
                    assert process and process.stdout
                    while line := await process.stdout.readline():
                        writer.write(line)
                        await writer.drain()

                upstream_task = asyncio.create_task(upstream())
                assert process.stdin
                while raw := await reader.readline():
                    if len(raw) > MAX_BRIDGE_LINE_BYTES:
                        break
                    message = json.loads(raw)
                    if not isinstance(message, dict):
                        break
                    validate_client_message(message)
                    process.stdin.write(raw)
                    await process.stdin.drain()
            except (OSError, json.JSONDecodeError, ValueError):
                pass
            finally:
                if upstream_task:
                    upstream_task.cancel()
                    with suppress(asyncio.CancelledError):
                        await upstream_task
                await supervisor.close()
                writer.close()
                with suppress(OSError):
                    await writer.wait_closed()

    server = await asyncio.start_server(handle, host, port, limit=MAX_BRIDGE_LINE_BYTES + 1)
    sockets = ", ".join(str(socket.getsockname()) for socket in server.sockets or ())
    print(json.dumps({"event": "codex_bridge.ready", "listen": sockets}), flush=True)
    async with server:
        await server.serve_forever()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=18643)
    parser.add_argument("--token", default=os.environ.get("OPENDRSAI_CODEX_BRIDGE_TOKEN", ""))
    parser.add_argument("--state-root", default=os.environ.get("DRSAI_HOME", str(Path.home() / ".drsai")))
    args = parser.parse_args()
    asyncio.run(serve_bridge(args.host, args.port, args.token, Path(args.state_root)))


if __name__ == "__main__":
    main()
