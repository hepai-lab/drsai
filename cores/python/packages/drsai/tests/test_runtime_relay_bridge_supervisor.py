from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace

import pytest

from drsai.backend import gateway
from drsai.relay.runtime_client import RuntimeCredential


def test_gateway_instance_token_file_fallback_is_bounded_and_env_wins(
    tmp_path: Path, monkeypatch,
) -> None:
    token_path = tmp_path / "runtime" / "instance-token"
    token_path.parent.mkdir(parents=True)
    token_path.write_text("a" * 43, encoding="ascii")
    monkeypatch.delenv("OPENDRSAI_GATEWAY_INSTANCE_TOKEN", raising=False)
    monkeypatch.setenv("DRSAI_HOME", str(tmp_path))
    assert gateway._runtime_gateway_instance_token(tmp_path) == "a" * 43
    token_path.write_text("private token with spaces", encoding="ascii")
    with pytest.raises(RuntimeError, match="gateway_instance_token_file_invalid"):
        gateway._runtime_gateway_instance_token(tmp_path)
    token_path.write_bytes(b"x" * 257)
    with pytest.raises(RuntimeError, match="gateway_instance_token_file_invalid"):
        gateway._runtime_gateway_instance_token(tmp_path)

    monkeypatch.setenv("OPENDRSAI_GATEWAY_INSTANCE_TOKEN", "b" * 43)
    assert gateway._runtime_gateway_instance_token(tmp_path) == "b" * 43


def test_runtime_relay_bridge_retries_transient_construction_failure(
    tmp_path: Path, monkeypatch,
) -> None:
    async def scenario() -> None:
        relay_state = tmp_path / "runtime" / "relay"
        relay_state.mkdir(parents=True)
        (relay_state / "credential.dpapi").write_bytes(b"fixture")
        (relay_state / "relay-wss-url").write_text(
            "wss://relay.example/api/runtime-relay/v1/runtime-connect",
            encoding="utf-8",
        )
        monkeypatch.setenv("DRSAI_HOME", str(tmp_path))
        monkeypatch.setenv("OPENDRSAI_GATEWAY_INSTANCE_TOKEN", "fixture-instance-token")

        attempts = 0

        class CredentialStore:
            def __init__(self, _path):
                pass

            def load(self):
                nonlocal attempts
                attempts += 1
                if attempts == 1:
                    raise OSError("private-transient-detail")
                return RuntimeCredential("runtime-fixture", "registration-token")

        class IdentityStore:
            def __init__(self, _path):
                pass

            def load_or_create(self):
                return object()

        class Handler:
            def __init__(self, *_args):
                pass

            def __getattr__(self, _name):
                async def operation(*_args, **_kwargs):
                    return []
                return operation

        ready = asyncio.Event()

        class Connector:
            def __init__(self, *_args, **_kwargs):
                pass

            async def run_forever(self, stop):
                ready.set()
                await stop.wait()

        import drsai.relay.device_identity as device_identity
        import drsai.relay.gateway_control as gateway_control
        import drsai.relay.runtime_client as runtime_client

        monkeypatch.setattr(device_identity, "DeviceIdentityStore", IdentityStore)
        monkeypatch.setattr(gateway_control, "AiohttpGatewayTransport", lambda *_args: object())
        monkeypatch.setattr(gateway_control, "GatewayRuntimeControlHandler", Handler)
        monkeypatch.setattr(runtime_client, "RuntimeCredentialStore", CredentialStore)
        monkeypatch.setattr(runtime_client, "RuntimeOutboundConnector", Connector)
        monkeypatch.setattr(runtime_client, "resolve_runtime_version", lambda *_args: "1.5.7")
        monkeypatch.setattr(
            gateway, "_runtime_registry",
            lambda: SimpleNamespace(identity=SimpleNamespace(instance_id="instance-fixture")),
        )
        monkeypatch.setattr(gateway, "_read_tools_config", lambda: {})
        monkeypatch.setattr(gateway, "_runtime_execution_capabilities", lambda _value: frozenset())
        monkeypatch.setattr(
            gateway, "_runtime_engine",
            lambda: SimpleNamespace(observability=object()),
        )

        original_sleep = asyncio.sleep

        async def immediate_sleep(_delay):
            await original_sleep(0)

        monkeypatch.setattr(gateway.asyncio, "sleep", immediate_sleep)
        gateway._runtime_relay_connector = None
        stop, task = await gateway._start_runtime_relay_bridge()
        await asyncio.wait_for(ready.wait(), timeout=2.0)
        assert attempts == 2
        assert gateway._runtime_relay_bridge_state == {
            "state": "running", "stage": "connector",
            "error_code": "none", "error_type": "none",
        }
        stop.set()
        await asyncio.wait_for(task, timeout=1.0)
        assert gateway._runtime_relay_connector is None
        assert gateway._runtime_relay_bridge_state["state"] == "stopped"

    asyncio.run(scenario())


def test_mobile_pairing_diagnostics_uses_live_transport_not_object_presence(monkeypatch) -> None:
    class Pairing:
        def readiness(self):
            return {"state": "ready"}

    class Connector:
        def __init__(self, connection: str, heartbeat: str):
            self.connection = connection
            self.heartbeat = heartbeat

        def diagnostic_state(self):
            return {"connection": self.connection, "heartbeat": self.heartbeat}

    monkeypatch.setattr(gateway, "_mobile_pairing_service", lambda: Pairing())
    gateway._runtime_relay_bridge_state.update({
        "state": "running", "stage": "connector",
        "error_code": "none", "error_type": "none",
    })
    gateway._runtime_relay_connector = Connector("retrying", "stale")
    degraded = asyncio.run(gateway.runtime_mobile_pairing_diagnostics())
    assert degraded["status"] == "action_required"
    assert degraded["checks"]["wss"] == "failed"
    assert degraded["checks"]["heartbeat"] == "stale"

    gateway._runtime_relay_connector = Connector("connected", "ok")
    healthy = asyncio.run(gateway.runtime_mobile_pairing_diagnostics())
    assert healthy["status"] == "healthy"
    assert healthy["checks"]["wss"] == "ok"
    gateway._runtime_relay_connector = None
