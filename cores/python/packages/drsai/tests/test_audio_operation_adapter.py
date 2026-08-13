from __future__ import annotations

import httpx
import pytest

from drsai.config.audio_operation_adapter import OpenAIAudioOperationAdapter
from drsai.config.loader import parse_user_config
from drsai.config.model_catalog import AgentModelPolicy, AgentModelSelection, ModelRef
from drsai.config.model_operation_adapters import ModelProtocolError
from drsai.config.model_operation_routing import resolve_agent_operation
from drsai.platform_auth import PlatformAuthContext, platform_auth_scope


def _resolved(role, model, operation):
    config = parse_user_config({"model_providers": {"zhizengzeng": {
        "base_url": "https://provider.example/v1", "requires_api_key": False,
        "models": {
            "tts-1": {"input_modalities": ["text"], "output_modalities": ["audio"], "capabilities": ["text_to_speech"]},
            "whisper-1": {"input_modalities": ["audio"], "output_modalities": ["text"], "capabilities": ["speech_to_text"]},
        },
    }}})
    selection = AgentModelSelection("explicit", ModelRef("zhizengzeng", model))
    policy = AgentModelPolicy(
        agent_id="my-drsai",
        text_to_speech_model=selection if role == "text_to_speech_model" else None,
        speech_to_text_model=selection if role == "speech_to_text_model" else None,
    )
    return resolve_agent_operation(config, policy, role=role, operation=operation, require_credentials=False)


def _resolved_hepai(role, model, operation):
    config = parse_user_config({"model_providers": {"hepai": {
        "base_url": "https://configured.invalid/apiv2/v1", "requires_api_key": False,
        "models": {
            "tts-1": {"input_modalities": ["text"], "output_modalities": ["audio"], "capabilities": ["text_to_speech"]},
            "whisper-1": {"input_modalities": ["audio"], "output_modalities": ["text"], "capabilities": ["speech_to_text"]},
        },
    }}})
    selection = AgentModelSelection("explicit", ModelRef("hepai", model))
    policy = AgentModelPolicy(
        agent_id="my-drsai",
        text_to_speech_model=selection if role == "text_to_speech_model" else None,
        speech_to_text_model=selection if role == "speech_to_text_model" else None,
    )
    return resolve_agent_operation(config, policy, role=role, operation=operation, require_credentials=False)


def test_tts_uses_bound_model_and_validates_audio() -> None:
    seen = {}
    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        seen["body"] = request.content
        return httpx.Response(200, content=b"ID3\x04\x00\x00audio")
    result = OpenAIAudioOperationAdapter(transport=httpx.MockTransport(handler)).synthesize(
        _resolved("text_to_speech_model", "tts-1", "text_to_speech"),
        text="OpenDrSai capability test 42",
    )
    assert seen["path"] == "/v1/audio/speech" and b'"model":"tts-1"' in seen["body"]
    assert result.media_type == "audio/mpeg" and result.content.startswith(b"ID3")


def test_stt_uses_multipart_bound_model_and_normalizes_language() -> None:
    seen = {}
    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        seen["content_type"] = request.headers["content-type"]
        seen["body"] = request.content
        return httpx.Response(200, json={"text": "OpenDrSai capability test 42", "language": "en", "confidence": 0.99})
    result = OpenAIAudioOperationAdapter(transport=httpx.MockTransport(handler)).transcribe(
        _resolved("speech_to_text_model", "whisper-1", "speech_to_text"),
        audio=b"RIFFxxxxWAVEaudio", language="en-US",
    )
    assert seen["path"] == "/v1/audio/transcriptions"
    assert "multipart/form-data" in seen["content_type"]
    assert b'whisper-1' in seen["body"] and b'en' in seen["body"]
    assert result.text.endswith("42") and result.confidence == 0.99


@pytest.mark.parametrize(
    ("role", "model", "operation", "path"),
    [
        ("speech_to_text_model", "whisper-1", "speech_to_text", "/apiv2/v1/audio/transcriptions"),
        ("text_to_speech_model", "tts-1", "text_to_speech", "/apiv2/v1/audio/speech"),
    ],
)
def test_hepai_audio_uses_request_scoped_oidc(role, model, operation, path) -> None:
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        seen["authorization"] = request.headers.get("authorization")
        return (
            httpx.Response(200, json={"text": "transcribed"})
            if operation == "speech_to_text"
            else httpx.Response(200, content=b"ID3\x04\x00\x00audio")
        )

    auth = PlatformAuthContext(
        access_token="oidc-audio-token",
        subject="user-1",
        issuer="https://issuer.example",
        expires_at=4_102_444_800,
        model_base_url="https://ai-dev.example/apiv2/v1",
    )
    adapter = OpenAIAudioOperationAdapter(transport=httpx.MockTransport(handler))
    with platform_auth_scope(auth):
        if operation == "speech_to_text":
            adapter.transcribe(_resolved_hepai(role, model, operation), audio=b"RIFFxxxxWAVEaudio")
        else:
            adapter.synthesize(_resolved_hepai(role, model, operation), text="hello")

    assert seen == {"path": path, "authorization": "Bearer oidc-audio-token"}


def test_tts_invalid_container_and_stt_empty_text_fail_closed() -> None:
    tts = OpenAIAudioOperationAdapter(transport=httpx.MockTransport(lambda _r: httpx.Response(200, content=b"not-mp3")))
    with pytest.raises(ModelProtocolError) as invalid_audio:
        tts.synthesize(_resolved("text_to_speech_model", "tts-1", "text_to_speech"), text="test")
    assert invalid_audio.value.code == "invalid_provider_response"

    stt = OpenAIAudioOperationAdapter(transport=httpx.MockTransport(lambda _r: httpx.Response(200, json={"text": ""})))
    with pytest.raises(ModelProtocolError) as invalid_text:
        stt.transcribe(_resolved("speech_to_text_model", "whisper-1", "speech_to_text"), audio=b"RIFFxxxxWAVEaudio")
    assert invalid_text.value.code == "invalid_provider_response"


@pytest.mark.parametrize(("status", "code"), [(401, "authentication_failed"), (403, "permission_denied"), (429, "quota_exceeded")])
def test_audio_errors_are_stable(status, code) -> None:
    adapter = OpenAIAudioOperationAdapter(transport=httpx.MockTransport(lambda _r: httpx.Response(status)))
    with pytest.raises(ModelProtocolError) as raised:
        adapter.synthesize(_resolved("text_to_speech_model", "tts-1", "text_to_speech"), text="test")
    assert raised.value.code == code
