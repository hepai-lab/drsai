from __future__ import annotations

import hashlib

import pytest

from drsai.backend.runtime.agent_kernel import normalize_model_route_snapshot
from drsai.backend.runtime.mobile_core import MessageType, RuntimeEnvelope, create_mobile_agent_core


def route(model_id: str = "stable-model") -> dict:
    value = {
        "version": "p9-model-route-v1",
        "model_id": model_id,
        "provider_id": "provider-1",
        "upstream_model_id": "vendor/original",
        "base_url": "https://api.example/v1",
        "wire_api": "openai",
        "provider_revision": 7,
        "credential_kind": "api_key",
    }
    identity = "\0".join(str(value[key]) for key in (
        "version", "model_id", "provider_id", "upstream_model_id", "base_url", "wire_api",
        "provider_revision", "credential_kind",
    ))
    return {**value, "sha256": hashlib.sha256(identity.encode()).hexdigest()}


def envelope(message_type: MessageType, payload: dict, *, sequence: int = 0) -> RuntimeEnvelope:
    return RuntimeEnvelope(
        message_type=message_type,
        request_id=f"request-{sequence}",
        run_id="run-route",
        session_id="session-route",
        sequence=sequence,
        idempotency_key=f"key-{message_type.value}-{sequence}",
        payload=payload,
    )


def test_model_route_is_pinned_into_model_request_and_checkpoint_resume() -> None:
    original = route()
    core = create_mobile_agent_core()
    started = core.handle(envelope(MessageType.START_RUN, {
        "input": "hello", "model_id": "stable-model", "model_route_snapshot": original,
    }))
    first_request = next(item for item in started if item.message_type is MessageType.MODEL_REQUEST)
    assert first_request.payload["model_route_snapshot"] == original

    snapshot = core.snapshot("run-route")
    assert snapshot["model_route_snapshot"] == original
    recovered = create_mobile_agent_core().handle(envelope(MessageType.RESUME_RUN, {"state": snapshot}))
    resumed_request = next(item for item in recovered if item.message_type is MessageType.MODEL_REQUEST)
    assert resumed_request.payload["model_id"] == "stable-model"
    assert resumed_request.payload["model_route_snapshot"] == original


def test_model_route_tamper_and_model_switch_fail_closed() -> None:
    original = route()
    with pytest.raises(ValueError, match="model_route_snapshot_digest_invalid"):
        normalize_model_route_snapshot({**original, "upstream_model_id": "vendor/changed"}, "stable-model")
    with pytest.raises(ValueError, match="model_route_snapshot_model_mismatch"):
        normalize_model_route_snapshot(original, "different-default")
