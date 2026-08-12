from types import SimpleNamespace

from fastapi.testclient import TestClient

import drsai.backend.gateway as gateway
from drsai.config.audio_operation_adapter import SpeechSynthesisResult, SpeechTranscriptionResult
from drsai.config.model_catalog import ModelRef
from drsai.config.model_operation_adapters import ModelProtocolError


class FakeAudioAdapter:
    error = None
    last_call = None

    def synthesize(self, resolved, **kwargs):
        type(self).last_call = ("synthesize", resolved, kwargs)
        if type(self).error:
            raise type(self).error
        return SpeechSynthesisResult(b"ID3fixture", "audio/mpeg", "mp3")

    def transcribe(self, resolved, **kwargs):
        type(self).last_call = ("transcribe", resolved, kwargs)
        if type(self).error:
            raise type(self).error
        return SpeechTranscriptionResult("hello voice", "en", 0.99)


resolved = SimpleNamespace(
    ref=ModelRef("zhizengzeng", "whisper-1"),
    model=SimpleNamespace(model="whisper-1"),
)


def fake_resolve(_config, _policy, *, role, operation, require_credentials):
    assert require_credentials is True
    model = "tts-1" if role == "text_to_speech_model" else "whisper-1"
    return SimpleNamespace(ref=ModelRef("zhizengzeng", model), model=SimpleNamespace(model=model))


client = TestClient(gateway.app)
originals = (
    gateway.verify_gateway_instance,
    gateway.load_model_provider_config,
    gateway.load_agent_model_policy,
    gateway.resolve_agent_operation,
    gateway.OpenAIAudioOperationAdapter,
)
try:
    gateway.verify_gateway_instance = lambda _token: True
    gateway.load_model_provider_config = lambda: object()
    gateway.load_agent_model_policy = lambda _agent: SimpleNamespace(policy=object())
    gateway.resolve_agent_operation = fake_resolve
    gateway.OpenAIAudioOperationAdapter = FakeAudioAdapter

    response = client.post("/v1/audio/transcriptions", files={"file": ("voice.wav", b"", "audio/wav")})
    assert response.status_code == 400, response.text
    response = client.post("/v1/audio/transcriptions", files={"file": ("voice.wav", b"x" * (10 * 1024 * 1024 + 1), "audio/wav")})
    assert response.status_code == 413, response.text

    response = client.post("/v1/audio/transcriptions", files={"file": ("voice.wav", b"RIFFdata", "audio/wav")})
    assert response.status_code == 200 and response.json()["text"] == "hello voice", response.text
    assert response.json()["model_ref"] == {"provider_id": "zhizengzeng", "model_id": "whisper-1"}

    response = client.post(
        "/v1/audio/transcriptions", data={"language": "en-US"},
        files={"file": ("voice.webm", b"webm-data", "audio/webm")},
    )
    assert response.status_code == 200, response.text
    assert FakeAudioAdapter.last_call[2]["language"] == "en-US"

    response = client.post(
        "/v1/audio/transcriptions", data={"model": "other-model"},
        files={"file": ("voice.wav", b"RIFFdata", "audio/wav")},
    )
    assert response.status_code == 409, response.text

    FakeAudioAdapter.error = ModelProtocolError("quota_exceeded", "limited", retryable=True, status_code=429)
    response = client.post("/v1/audio/transcriptions", files={"file": ("voice.wav", b"RIFFdata", "audio/wav")})
    assert response.status_code == 429, response.text
    FakeAudioAdapter.error = ModelProtocolError("invalid_provider_response", "bad")
    response = client.post("/v1/audio/transcriptions", files={"file": ("voice.wav", b"RIFFdata", "audio/wav")})
    assert response.status_code == 502, response.text

    FakeAudioAdapter.error = None
    response = client.post("/v1/audio/speech", json={"text": "hello", "format": "mp3"})
    assert response.status_code == 200 and response.content == b"ID3fixture", response.text
    assert response.headers["X-OpenDrSai-Model-Id"] == "tts-1"
    response = client.post("/v1/audio/speech", json={"text": "", "format": "mp3"})
    assert response.status_code == 400, response.text
    response = client.post("/v1/audio/speech", json={"text": "hello", "speed": 3})
    assert response.status_code == 400, response.text

    FakeAudioAdapter.error = ModelProtocolError("credential_unavailable", "missing")
    response = client.post("/v1/audio/speech", json={"text": "hello"})
    assert response.status_code == 401, response.text
    FakeAudioAdapter.error = ModelProtocolError("permission_denied", "forbidden", status_code=403)
    response = client.post("/v1/audio/speech", json={"text": "hello"})
    assert response.status_code == 403, response.text
finally:
    (
        gateway.verify_gateway_instance,
        gateway.load_model_provider_config,
        gateway.load_agent_model_policy,
        gateway.resolve_agent_operation,
        gateway.OpenAIAudioOperationAdapter,
    ) = originals

print("Agent-bound voice provider behavior tests passed (12 cases).")
