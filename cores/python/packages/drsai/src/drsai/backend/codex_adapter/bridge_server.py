"""Host-side authenticated bridge for Sandbox OpenDrSai acceptance."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import hashlib
import socket
from contextlib import suppress
from pathlib import Path

from drsai.backend.codex_adapter.app_server_process import CodexAppServerProcess
from drsai.backend.codex_adapter.binary_provider import CodexArtifactStore, CodexBinaryProvider, load_trusted_publishers
from drsai.backend.codex_adapter.bridge_transport import (MAX_BRIDGE_LINE_BYTES, BridgeReplayGuard,
    authenticate_bridge, validate_bridge_bind_host, validate_client_message)
from drsai.backend.codex_adapter.jsonl_frames import parse_jsonl_object, read_jsonl_frame


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
    development = os.environ.get("DRSAI_CODEX_DEVELOPMENT") == "1"
    validate_bridge_bind_host(host, development=development)
    active = asyncio.Lock()
    replay_guard = BridgeReplayGuard()

    async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        supervisor = _supervisor(state_root)
        try:
            binary = supervisor.binary_provider.resolve()
        except Exception:
            writer.close(); await writer.wait_closed(); return
        manifest = binary.manifest or {}
        identity = {
            "codexVersion": str(binary.version or "unknown"),
            "schemaDigest": str(binary.schema_digest or "unverified"),
            "binaryDigest": str(manifest.get("binary_digest") or hashlib.sha256(str(binary.path).encode()).hexdigest()),
            "hostId": hashlib.sha256(socket.gethostname().encode()).hexdigest()[:32],
        }
        if not await authenticate_bridge(reader, writer, token, identity=identity, replay_guard=replay_guard):
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
            process = None
            upstream_task = None
            try:
                process = await supervisor.start()

                async def upstream() -> None:
                    assert process and process.stdout
                    while line := await read_jsonl_frame(process.stdout, source="Codex App Server"):
                        writer.write(line)
                        await writer.drain()

                upstream_task = asyncio.create_task(upstream())
                assert process.stdin
                while raw := await read_jsonl_frame(reader, source="OpenDrSai Codex Bridge client"):
                    message = await parse_jsonl_object(raw, source="OpenDrSai Codex Bridge client")
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
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=18643)
    parser.add_argument("--token", default=os.environ.get("OPENDRSAI_CODEX_BRIDGE_TOKEN", ""))
    parser.add_argument("--state-root", default=os.environ.get("DRSAI_HOME", str(Path.home() / ".drsai")))
    args = parser.parse_args()
    asyncio.run(serve_bridge(args.host, args.port, args.token, Path(args.state_root)))


if __name__ == "__main__":
    main()
