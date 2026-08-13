import asyncio
from contextlib import contextmanager
from types import SimpleNamespace

from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

import drsai.backend.gateway as gateway
from drsai.config.model_catalog import ModelRef
from drsai.config.model_operation_adapters import ModelProtocolError
from drsai.config.streaming_audio_adapter import OpenAIStreamingTranscriptionAdapter, streaming_transcription_url
import aiohttp


class FakeStreamingAdapter:
    instances = []

    def __init__(self):
        self.connected = None
        self.controls = []
        self.audio = []
        self.closed = False
        self.audio_ready = asyncio.Event()
        type(self).instances.append(self)

    async def connect(self, resolved, start):
        self.connected = (resolved, dict(start))

    async def send_json(self, payload):
        self.controls.append(dict(payload))

    async def send_audio(self, audio):
        self.audio.append(bytes(audio))
        self.audio_ready.set()

    async def events(self):
        yield {"type": "accepted", "runtimeId": "provider", "authorization": "must-not-leak"}
        await self.audio_ready.wait()
        yield {"type": "ack", "sequence": 0, "bufferedAudioMs": 0}
        yield {"type": "partial", "text": "流式", "revision": 1}
        yield {"type": "final", "text": "流式语音", "revision": 2}
        yield {"type": "completed"}

    async def close(self):
        self.closed = True


def fake_resolve(_config, _policy, *, role, operation, require_credentials):
    assert (role, operation, require_credentials) == ("speech_to_text_model", "speech_to_text", True)
    return SimpleNamespace(ref=ModelRef("fixture", "streaming-stt"), model=SimpleNamespace(model="streaming-stt"))


client = TestClient(gateway.app)
originals = (
    gateway.verify_gateway_instance,
    gateway.load_model_provider_config,
    gateway.load_agent_model_policy,
    gateway.resolve_agent_operation,
    gateway._streaming_audio_adapter_factory,
    gateway.context_from_bearer,
    gateway.platform_auth_scope,
)
try:
    gateway.verify_gateway_instance = lambda token: token == "gateway-secret"
    gateway.load_model_provider_config = lambda: object()
    gateway.load_agent_model_policy = lambda _agent: SimpleNamespace(policy=object())
    gateway.resolve_agent_operation = fake_resolve
    gateway._streaming_audio_adapter_factory = FakeStreamingAdapter
    auth_scopes = []

    gateway.context_from_bearer = lambda authorization, principal: SimpleNamespace(
        access_token=authorization.removeprefix("Bearer "), subject=principal,
    )

    @contextmanager
    def capture_auth_scope(auth):
        auth_scopes.append(auth)
        yield

    gateway.platform_auth_scope = capture_auth_scope

    start = {
        "type": "start", "token": "gateway-secret", "protocolVersion": 2,
        "sessionId": "session-1", "turnId": "turn-1", "encoding": "pcm_s16le",
        "sampleRateHz": 16000, "channels": 1, "providerEndpointing": True,
    }
    with client.websocket_connect("/v1/audio/transcriptions/stream") as websocket:
        websocket.send_json(start)
        accepted = websocket.receive_json()
        assert accepted["type"] == "accepted" and accepted["eventSequence"] == 0
        assert "authorization" not in accepted
        audio = b"\x01\x02" * 320
        websocket.send_json({"type": "audio", "sequence": 0, "durationMs": 20, "byteLength": len(audio)})
        websocket.send_bytes(audio)
        events = [websocket.receive_json() for _ in range(4)]
        assert [event["type"] for event in events] == ["ack", "partial", "final", "completed"]
        assert [event["eventSequence"] for event in events] == [1, 2, 3, 4]
    adapter = FakeStreamingAdapter.instances[-1]
    assert adapter.audio == [audio] and adapter.closed
    assert "token" not in adapter.connected[1]  # consumed only by Gateway
    assert "authorization" not in adapter.connected[1]

    with client.websocket_connect("/v1/audio/transcriptions/stream") as websocket:
        websocket.send_json({
            **start,
            "sessionId": "session-auth",
            "turnId": "turn-auth",
            "authorization": "Bearer oidc-stream-token",
            "principalId": "user-1",
        })
        assert websocket.receive_json()["type"] == "accepted"
        audio = b"\x01\x02" * 320
        websocket.send_json({"type": "audio", "sequence": 0, "durationMs": 20, "byteLength": len(audio)})
        websocket.send_bytes(audio)
        for _ in range(4): websocket.receive_json()
    assert auth_scopes[-1].access_token == "oidc-stream-token"
    assert auth_scopes[-1].subject == "user-1"

    try:
        with client.websocket_connect("/v1/audio/transcriptions/stream") as websocket:
            websocket.send_json({**start, "token": "wrong"})
            websocket.receive_json()
        raise AssertionError("invalid Gateway token unexpectedly opened the stream")
    except WebSocketDisconnect as exc:
        assert exc.code == 4401

    try:
        with client.websocket_connect("/v1/audio/transcriptions/stream") as websocket:
            websocket.send_json({**start, "protocolVersion": 1})
            websocket.receive_json()
        raise AssertionError("legacy protocol unexpectedly opened the P2 stream")
    except WebSocketDisconnect as exc:
        assert exc.code == 4400
finally:
    (
        gateway.verify_gateway_instance,
        gateway.load_model_provider_config,
        gateway.load_agent_model_policy,
        gateway.resolve_agent_operation,
        gateway._streaming_audio_adapter_factory,
        gateway.context_from_bearer,
        gateway.platform_auth_scope,
    ) = originals

print("Streaming voice Gateway tests passed (auth, v2 negotiation, model binding, binary relay, ordered events, redaction, and cleanup).")


class FakeUpstreamSocket:
    def __init__(self):
        self.sent_text = []
        self.sent_bytes = []
        self.closed = False

    async def send_str(self, value): self.sent_text.append(value)
    async def send_bytes(self, value): self.sent_bytes.append(bytes(value))
    async def close(self): self.closed = True
    def __aiter__(self):
        async def messages():
            yield SimpleNamespace(type=aiohttp.WSMsgType.TEXT, data='{"type":"partial","text":"hello","revision":1}')
        return messages()


class FakeClientSession:
    def __init__(self):
        self.socket = FakeUpstreamSocket()
        self.connect_call = None

    async def ws_connect(self, url, **kwargs):
        self.connect_call = (url, kwargs)
        return self.socket


async def verify_production_adapter():
    session = FakeClientSession()
    adapter = OpenAIStreamingTranscriptionAdapter(session=session)
    provider = SimpleNamespace(
        name="custom",
        base_url="https://speech.example.test/v1",
        requires_api_key=True,
        api_key=SimpleNamespace(reveal=lambda: "provider-secret"),
    )
    resolved_provider = SimpleNamespace(model=SimpleNamespace(model="streaming-stt", provider=provider))
    await adapter.connect(resolved_provider, {
        "token": "gateway-secret", "sessionId": "s", "turnId": "t",
        "encoding": "pcm_s16le", "sampleRateHz": 16000, "channels": 1,
    })
    assert session.connect_call[0] == "wss://speech.example.test/v1/audio/transcriptions/stream"
    assert session.connect_call[1]["headers"] == {"Authorization": "Bearer provider-secret"}
    upstream_start = session.socket.sent_text[0]
    assert "gateway-secret" not in upstream_start and "provider-secret" not in upstream_start
    await adapter.send_json({"type": "audio", "sequence": 0, "byteLength": 2, "durationMs": 20})
    await adapter.send_audio(b"\x00\x01")
    assert session.socket.sent_bytes == [b"\x00\x01"]
    assert [event["type"] async for event in adapter.events()] == ["partial"]
    await adapter.close()
    assert session.socket.closed


asyncio.run(verify_production_adapter())
assert streaming_transcription_url("http://127.0.0.1:9999/v1") == "ws://127.0.0.1:9999/v1/audio/transcriptions/stream"
try:
    streaming_transcription_url("http://speech.example.test/v1")
    raise AssertionError("insecure non-loopback streaming Provider URL was accepted")
except ModelProtocolError as exc:
    assert exc.code == "configuration_invalid"

print("Production streaming audio Adapter tests passed (WSS derivation, server-side auth, protocol mapping, binary frames, events, TLS policy, and cleanup).")
