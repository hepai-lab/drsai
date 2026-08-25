"""Speech-to-text (feature 3.4). STT only -- no TTS, no realtime duplex.

The legacy handler is only 40 lines but reaches ``load_model_provider_config``
-> ``load_agent_model_policy`` -> ``resolve_agent_operation``, which is the
provider-configuration machine that 19 config routes exist to maintain. Keeping
those 40 lines verbatim would drag all of it in.

So the route resolves its provider from the same place the chat model comes
from -- ``cli_config.json`` plus the OIDC session -- and hands
:class:`OpenAIAudioOperationAdapter` a ``ResolvedAgentOperation`` built here.
The adapter itself is unchanged: when the provider is ``hepai`` it prefers the
signed-in user's access token and model base URL over any static key, so a
signed-in desktop transcribes against the user's own HepAI account.

Capability gating (the 能力位门控 in the feature table) has two halves:
``GET /v1/runtime`` advertises ``speech_to_text`` because this surface has the
route at all, and :func:`stt_available` answers whether a provider actually
resolves right now. The renderer hides the microphone unless both hold, rather
than offering a button that always fails.
"""

from __future__ import annotations

import asyncio
import os
from typing import Any, Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from drsai.config.audio_operation_adapter import OpenAIAudioOperationAdapter
from drsai.config.model_catalog import ModelRef
from drsai.config.model_operation_adapters import ModelProtocolError
from drsai.config.model_operation_routing import (
    ModelOperationRoute,
    ModelOperationRoutePlan,
    ResolvedAgentOperation,
)
from drsai.config.schema import ModelCapabilities, ProviderConfig, ResolvedModelConfig, SecretValue
from drsai.platform_auth import get_platform_auth

api = APIRouter(tags=["audio"])

MAX_AUDIO_BYTES = 10 * 1024 * 1024
DEFAULT_STT_MODEL = os.environ.get("DRSAI_STT_MODEL", "whisper-1")

_STATUS_BY_CODE = {
    "configuration_invalid": 409,
    "credential_unavailable": 401,
    "authentication_failed": 401,
    "permission_denied": 403,
    "request_rejected": 400,
    "quota_exceeded": 429,
    "provider_timeout": 504,
    "provider_unreachable": 502,
    "endpoint_not_found": 502,
    "invalid_provider_response": 502,
}


def resolve_stt_operation(model: str | None = None) -> ResolvedAgentOperation:
    """Build the STT binding from the same config the chat Agent uses."""
    from drsai.backend.cli.config import load_config
    from drsai.backend.run_drsai_agent_factory import (
        _DEFAULT_OPENAI_BASE_URL,
        _resolve,
    )

    cli_cfg = load_config()
    base_url = _resolve(
        cli_cfg, "openai_base_url", "OPENAI_BASE_URL", default=_DEFAULT_OPENAI_BASE_URL,
    )
    api_key = _resolve(cli_cfg, "openai_api_key", "OPENAI_API_KEY", "HEPAI_API_KEY")
    signed_in = get_platform_auth() is not None
    if not api_key and not signed_in:
        raise ModelProtocolError(
            "credential_unavailable",
            "Speech-to-text requires a signed-in HepAI session or a configured API key.",
        )
    model_id = model or DEFAULT_STT_MODEL
    # Named "hepai" on purpose: that is the switch the adapter uses to prefer
    # the OIDC access token and the user's model base URL over a static key.
    provider = ProviderConfig(
        name="hepai",
        base_url=base_url,
        requires_api_key=not signed_in,
        api_key=SecretValue(api_key) if api_key else None,
        api_key_source="cli_config" if api_key else None,
    )
    ref = ModelRef(provider_id="hepai", model_id=model_id)
    return ResolvedAgentOperation(
        role="speech_to_text_model",
        ref=ref,
        model=ResolvedModelConfig(
            model=model_id,
            provider=provider,
            capabilities=ModelCapabilities(),
            known_model=False,
            metadata_source="drsai_cli_config",
            model_id=model_id,
        ),
        route_plan=ModelOperationRoutePlan(
            ref=ref,
            operation="speech_to_text",
            routes=(ModelOperationRoute(protocol="openai_audio_transcriptions", priority=1),),
        ),
    )


@api.post("/v1/audio/transcriptions", operation_id="transcribeAudio")
async def audio_transcriptions(
    file: UploadFile = File(...),
    model: str = Form(DEFAULT_STT_MODEL),
    language: Optional[str] = Form(None),
) -> dict[str, Any]:
    """Transcribe one recording. The renderer inserts the text into the composer."""
    # Read one byte past the limit so an oversize upload is rejected without
    # buffering the whole thing.
    audio = await file.read(MAX_AUDIO_BYTES + 1)
    if not audio:
        raise HTTPException(status_code=400, detail="The uploaded audio file is empty.")
    if len(audio) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="The uploaded audio exceeds the 10 MB limit.")
    try:
        resolved = await asyncio.to_thread(resolve_stt_operation, model)
        result = await asyncio.to_thread(
            OpenAIAudioOperationAdapter().transcribe,
            resolved,
            audio=audio,
            filename=file.filename or "recording.webm",
            media_type=file.content_type or "application/octet-stream",
            language=language,
        )
    except ModelProtocolError as exc:
        raise _http_error(exc) from exc
    return {
        "text": result.text,
        "language": result.language,
        "confidence": result.confidence,
        "model_ref": resolved.ref.public_dict(include_revision=False),
        "protocol": "openai_audio_transcriptions",
    }


def _http_error(exc: Exception) -> HTTPException:
    code = str(getattr(exc, "code", "audio_provider_failed"))
    return HTTPException(
        status_code=_STATUS_BY_CODE.get(code, 502),
        detail={
            "code": code,
            "message": "The configured speech-to-text operation failed.",
            "retryable": bool(getattr(exc, "retryable", False)),
        },
    )


def stt_available() -> bool:
    """Capability bit for the microphone button (feature 3.4 能力位门控)."""
    try:
        resolve_stt_operation()
    except Exception:
        return False
    return True


def router() -> APIRouter:
    return api
