from __future__ import annotations

import asyncio
from types import SimpleNamespace

from fastapi.testclient import TestClient

from drsai.backend import gateway
from drsai.config.model_catalog import AgentModelPolicy, AgentModelSelection, ModelRef


class FakeRealtimeAdapter:
    def __init__(self) -> None:
        self.connected = None
        self.sent: list[dict] = []
        self.closed = False

    async def connect(self, resolved) -> None:
        self.connected = resolved

    async def send_json(self, payload) -> None:
        self.sent.append(dict(payload))

    async def events(self):
        yield {"type": "session.updated", "session": {"id": "provider-session"}}
        await asyncio.Event().wait()

    async def close(self) -> None:
        self.closed = True


def configure_gateway(monkeypatch):
    created: list[FakeRealtimeAdapter] = []
    policy = AgentModelPolicy(
        "my-drsai",
        realtime_voice_model=AgentModelSelection("explicit", ModelRef("zhizengzeng", "gpt-realtime-2")),
    )
    monkeypatch.setattr(gateway, "verify_gateway_instance", lambda token: token == "gateway-token")
    monkeypatch.setattr(gateway, "current_agent_name", lambda: "my-drsai")
    monkeypatch.setattr(gateway, "load_agent_model_policy", lambda _name: SimpleNamespace(policy=policy))
    monkeypatch.setattr(gateway, "load_model_provider_config", lambda: object())
    monkeypatch.setattr(gateway, "resolve_model_ref", lambda *_args, **_kwargs: SimpleNamespace(model="gpt-realtime-2"))
    monkeypatch.setattr(gateway, "_realtime_audio_adapter_factory", lambda: created.append(FakeRealtimeAdapter()) or created[-1])
    return created


def test_duplex_gateway_binds_policy_and_emits_bounded_audio_ack(monkeypatch) -> None:
    created = configure_gateway(monkeypatch)
    client = TestClient(gateway.app)
    with client.websocket_connect("/v1/audio/duplex") as socket:
        socket.send_json({"type": "start", "token": "gateway-token", "protocolVersion": 1, "sessionId": "session-1", "providerId": "zhizengzeng", "modelId": "gpt-realtime-2"})
        assert socket.receive_json()["type"] == "session.updated"
        socket.send_json({"type": "input_audio_buffer.append", "event_id": "opendrsai_audio_7", "audio": "AA=="})
        assert socket.receive_json() == {"type": "opendrsai.input_audio_ack", "sequence": 7, "buffered_audio_ms": 0}
    client.close()
    assert created[0].sent[0]["type"] == "input_audio_buffer.append"
    assert created[0].closed is True


def test_duplex_gateway_rejects_model_binding_mismatch_without_connecting(monkeypatch) -> None:
    created = configure_gateway(monkeypatch)
    client = TestClient(gateway.app)
    with client.websocket_connect("/v1/audio/duplex") as socket:
        socket.send_json({"type": "start", "token": "gateway-token", "protocolVersion": 1, "sessionId": "session-1", "providerId": "zhizengzeng", "modelId": "other-model"})
        event = socket.receive_json()
        assert event["type"] == "error"
        assert event["error"]["code"] == "model_binding_mismatch"
    client.close()
    assert created == []


def test_duplex_gateway_rejects_bad_instance_token(monkeypatch) -> None:
    configure_gateway(monkeypatch)
    client = TestClient(gateway.app)
    with client.websocket_connect("/v1/audio/duplex") as socket:
        socket.send_json({"type": "start", "token": "wrong", "protocolVersion": 1, "sessionId": "session-1", "providerId": "zhizengzeng", "modelId": "gpt-realtime-2"})
        message = socket.receive()
        assert message["type"] == "websocket.close"
        assert message["code"] == 4401
    client.close()
