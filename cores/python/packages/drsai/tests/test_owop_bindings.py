from __future__ import annotations

import asyncio
from pathlib import Path

from drsai.owop import (
    InProcessWorkspaceOperationsClient,
    LocalIPCWorkspaceOperationsClient,
    LocalIPCWorkspaceOperationsServer,
    OWOPProtocol,
)


SCHEMA = Path(__file__).resolve().parents[5] / "protocol" / "owop" / "owop.schema.json"
DIGEST = "sha256:" + "b" * 64


def sample_params(schema: dict) -> dict:
    values = {}
    for name in schema.get("required", []):
        field = schema["properties"][name]
        reference = field.get("$ref", "")
        if reference.endswith("relativePath"):
            value = "."
        elif reference.endswith("digest"):
            value = DIGEST
        elif reference.endswith("id"):
            value = f"{name}-1"
        elif field.get("type") == "array":
            item = field.get("items", {})
            value = ["file.txt" if item.get("$ref", "").endswith("relativePath") else "value"]
        elif field.get("type") == "integer":
            value = max(1, field.get("minimum", 0))
            if name in {"offset", "after_offset", "after_sequence"}:
                value = 0
        elif field.get("type") == "boolean":
            value = False
        elif name == "argv":
            value = ["python", "-V"]
        elif name == "content_base64":
            value = "dGVzdA=="
        else:
            value = f"{name}-value"
        values[name] = value
    return values


def request(operation: str, params: dict) -> dict:
    return {
        "version": "1.0",
        "request_id": f"request-{operation.replace('.', '-')}",
        "correlation_id": "correlation-bindings",
        "workspace_id": "workspace-bindings",
        "operation": operation,
        "params": params,
        "binding": {"kind": "in_process"},
    }


def test_in_process_and_local_ipc_run_same_compliance_suite() -> None:
    async def scenario() -> None:
        protocol = OWOPProtocol(SCHEMA)
        handlers = {
            operation: (lambda params, selected=operation: {"operation": selected, "params": dict(params)})
            for operation in protocol.operations
        }
        in_process = InProcessWorkspaceOperationsClient(protocol, handlers)
        server = LocalIPCWorkspaceOperationsServer(protocol, handlers)
        await server.start()
        ipc = LocalIPCWorkspaceOperationsClient(protocol, *server.address, server.token)
        try:
            for operation, operation_schema in protocol.operations.items():
                operation_request = request(operation, sample_params(operation_schema))
                direct, framed = await asyncio.gather(
                    in_process.execute(operation_request), ipc.execute(operation_request)
                )
                assert direct == framed, operation
                assert direct["ok"] is True

            invalid = request("files.stat", {"path": "../escape"})
            direct, framed = await asyncio.gather(in_process.execute(invalid), ipc.execute(invalid))
            assert direct == framed
            assert direct["error"]["code"] == "owop_params_invalid"
        finally:
            await in_process.close()
            await ipc.close()
            await server.close()

    asyncio.run(scenario())


def test_local_ipc_rejects_non_loopback_and_bad_token() -> None:
    protocol = OWOPProtocol(SCHEMA)
    try:
        LocalIPCWorkspaceOperationsClient(protocol, "0.0.0.0", 1, "token")
        raise AssertionError("non-loopback Local IPC endpoint was accepted")
    except ValueError:
        pass

    async def scenario() -> None:
        server = LocalIPCWorkspaceOperationsServer(protocol, {"workspace.describe": lambda _: {}})
        await server.start()
        client = LocalIPCWorkspaceOperationsClient(protocol, *server.address, "wrong-token")
        try:
            response = await client.execute(request("workspace.describe", {}))
            assert response["error"]["code"] == "owop_ipc_unauthorized"
        finally:
            await client.close()
            await server.close()

    asyncio.run(scenario())
