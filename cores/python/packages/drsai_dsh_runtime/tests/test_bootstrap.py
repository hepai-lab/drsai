from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

import pytest

from opendrsai_dsh_runtime.bootstrap import BridgeRuntimeConfig, BridgeRuntimeHost


FAKE_NATIVE = r'''
import json
import sys

for line in sys.stdin:
    frame = json.loads(line)
    method = frame.get("method")
    if method == "initialize":
        result = {"serverInfo": {"name": "deepseek-harness-sdk-runtime", "version": "0.1.0-rc.5"}}
    elif method == "shutdown":
        result = {}
    elif method == "session/prompt":
        result = {"messageId": "message-fixture"}
    else:
        result = None
    if "id" in frame:
        sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": frame["id"], "result": result}) + "\n")
        sys.stdout.flush()
    if method == "shutdown":
        break
'''


@pytest.mark.asyncio
async def test_composition_root_hosts_probe_only_runtime_and_cleans_registration(tmp_path) -> None:
    workspace = tmp_path / "workspace"
    state = tmp_path / "state"
    registry = tmp_path / "registry"
    workspace.mkdir()
    native = tmp_path / "fake_native.py"
    native.write_text(FAKE_NATIVE, encoding="utf-8")
    host = BridgeRuntimeHost(BridgeRuntimeConfig(
        workspace_root=workspace,
        state_root=state,
        registry_root=registry,
        carrier=Path(sys.executable),
        carrier_args=(str(native),),
        provider="deepseek",
        model="fixture-model",
        profile_id="dsh-sdk/0.1.0-rc.5",
    ))

    try:
        result = await host.start()
        assert result["availability"] == "probe_only"
        manifests = list(registry.glob("*.json"))
        assert len(manifests) == 1
        manifest = json.loads(manifests[0].read_text(encoding="utf-8"))
        token = Path(manifest["endpoint"]["bearer_token_file"]).read_text(encoding="utf-8")
        endpoint = result["base_url"].removeprefix("http://")
        endpoint_host, endpoint_port = endpoint.rsplit(":", 1)
        reader, writer = await asyncio.open_connection(endpoint_host.strip("[]"), int(endpoint_port))
        writer.write(
            f"GET /v1/runtime/health HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer {token}\r\n\r\n".encode()
        )
        await writer.drain()
        response = await reader.read()
        writer.close()
        await writer.wait_closed()
        _, body = response.split(b"\r\n\r\n", 1)
        health = json.loads(body)
        assert health["status"] == "degraded"
        assert health["degraded_reason"] == "profile_requires_runtime_extension"
    finally:
        await host.close()
    assert not list(registry.glob("*.json"))
    assert not list(registry.glob("*.token"))


def test_composition_root_rejects_relative_or_missing_carrier(tmp_path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    with pytest.raises(ValueError, match="carrier"):
        BridgeRuntimeConfig(
            workspace_root=workspace,
            state_root=tmp_path / "state",
            registry_root=tmp_path / "registry",
            carrier=tmp_path / "missing",
            provider="deepseek",
            model="fixture-model",
            profile_id="dsh-sdk/0.1.0-rc.5",
        )
